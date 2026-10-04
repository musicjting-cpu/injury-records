/* =============================================================
   傷病紀錄系統 — 前端邏輯
   後端：Supabase（登入驗證 + 資料庫 + RLS）
   ============================================================= */

const SUPABASE_URL = 'https://tnswydndzoaaclfkzojm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_OgoBGcubJgYtC8m6k8WaGg_bTVUTpGC';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;

/* ---------- 工具 ---------- */
function $(sel) { return document.querySelector(sel); }

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function show(el, visible) {
  el.classList.toggle('hidden', !visible);
}

function setError(el, msg) {
  el.textContent = msg || '';
  show(el, !!msg);
}

/* 民國日期驗證：格式「115年10月3日」 */
function validateMinguoDate(str) {
  const s = String(str || '').trim();
  const m = /^(\d{1,3})年(\d{1,2})月(\d{1,2})日$/.exec(s);
  if (!m) return { ok: false, msg: '格式需為「民國年月日」，例如：115年10月3日' };
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (month < 1 || month > 12) return { ok: false, msg: '月份需介於 1～12' };
  if (day < 1 || day > 31) return { ok: false, msg: '日期需介於 1～31' };
  return { ok: true, value: s };
}

/* 班級下拉選單 */
const CLASS_OPTIONS = ['BA', 'BB', 'BO A', 'BO B', 'WA A', 'WA B'];
function classOptions(selected) {
  return CLASS_OPTIONS.map((c) =>
    `<option value="${c}"${c === selected ? ' selected' : ''}>${c}</option>`).join('');
}

/* 民國日期 → 西元可排序日期（YYYY-MM-DD），供區間查詢 */
function minguoToIso(dateStr) {
  const m = /^(\d{1,3})年(\d{1,2})月(\d{1,2})日$/.exec(String(dateStr || '').trim());
  if (!m) return null;
  const year = parseInt(m[1], 10) + 1911;
  const month = String(parseInt(m[2], 10)).padStart(2, '0');
  const day = String(parseInt(m[3], 10)).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/* ---------- 閒置自動登出（停滯 3 分鐘未操作） ---------- */
const IDLE_MS = 3 * 60 * 1000;
const IDLE_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
let lastActivity = Date.now();
let idleCheckId = null;

function markActivity() { lastActivity = Date.now(); }

function startIdleWatcher() {
  if (idleCheckId) return;
  lastActivity = Date.now();
  IDLE_EVENTS.forEach((ev) => window.addEventListener(ev, markActivity, { passive: true }));
  idleCheckId = setInterval(() => {
    if (currentUser && Date.now() - lastActivity >= IDLE_MS) {
      stopIdleWatcher();
      sb.auth.signOut().then(() => alert('已超過 3 分鐘未操作，已自動登出。'));
    }
  }, 5000);
}

function stopIdleWatcher() {
  if (idleCheckId) { clearInterval(idleCheckId); idleCheckId = null; }
  IDLE_EVENTS.forEach((ev) => window.removeEventListener(ev, markActivity));
}

/* ---------- 登入 / 登出 ---------- */
function showLogin() {
  show($('#login-view'), true);
  show($('#app-view'), false);
  stopIdleWatcher();
}

function showApp() {
  show($('#login-view'), false);
  show($('#app-view'), true);
  startIdleWatcher();
}

async function init() {
  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user || null;
  if (currentUser) {
    $('#user-email').textContent = currentUser.email;
    showApp();
    loadBrowse();
  } else {
    showLogin();
  }
}

sb.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user || null;
  if (currentUser) {
    $('#user-email').textContent = currentUser.email;
    showApp();
    loadBrowse();
  } else {
    showLogin();
  }
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn');
  const err = $('#login-error');
  setError(err, '');
  btn.disabled = true;
  btn.textContent = '登入中…';
  const { error } = await sb.auth.signInWithPassword({
    email: $('#login-email').value.trim(),
    password: $('#login-password').value,
  });
  btn.disabled = false;
  btn.textContent = '登入';
  if (error) {
    setError(err, '登入失敗：' + (error.message || '帳號或密碼錯誤'));
  } else {
    $('#login-password').value = '';
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await sb.auth.signOut();
});

/* ---------- 分頁切換 ---------- */
const tabs = document.querySelectorAll('.tab');
const panels = {
  add: $('#tab-add'),
  search: $('#tab-search'),
  browse: $('#tab-browse'),
  edit: $('#tab-edit'),
};

function switchTab(name) {
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  Object.entries(panels).forEach(([key, el]) => show(el, key === name));
  if (name === 'browse') loadBrowse();
}

tabs.forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

/* ---------- 1. 新增 ---------- */
$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#add-error');
  setError(err, '');

  const name = $('#add-name').value.trim();
  const dateCheck = validateMinguoDate($('#add-date').value);
  const reason = $('#add-reason').value.trim();
  const cls = $('#add-class').value;
  const note = $('#add-note').value.trim();

  if (!name) return setError(err, '請輸入姓名');
  if (!dateCheck.ok) return setError(err, dateCheck.msg);
  if (!reason) return setError(err, '請輸入原因');
  if (!cls) return setError(err, '請選擇目前就讀班級');

  const { error } = await sb.from('records').insert({
    name, date_minguo: dateCheck.value, reason, class: cls, note,
    date_iso: minguoToIso(dateCheck.value),
  });
  if (error) {
    setError(err, '新增失敗：' + error.message);
    return;
  }
  $('#add-form').reset();
  setError(err, '');
  alert('新增成功');
});

/* ---------- 2. 檢索 / 查詢（多欄位 + 日期區間） ---------- */
$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch('search');
});
$('#search-clear').addEventListener('click', () => {
  $('#search-form').reset();
  show($('#search-result'), false);
});

function gatherFilters(prefix) {
  return {
    name: $(`#${prefix}-name`).value.trim(),
    reason: $(`#${prefix}-reason`).value.trim(),
    class: $(`#${prefix}-class`).value,
    note: $(`#${prefix}-note`).value.trim(),
    dateFrom: $(`#${prefix}-date-from`).value.trim(),
    dateTo: $(`#${prefix}-date-to`).value.trim(),
  };
}

function buildQuery(filters) {
  let q = sb.from('records').select('*');
  if (filters.name) q = q.ilike('name', '%' + filters.name + '%');
  if (filters.reason) q = q.ilike('reason', '%' + filters.reason + '%');
  if (filters.class) q = q.eq('class', filters.class);
  if (filters.note) q = q.ilike('note', '%' + filters.note + '%');
  // 日期區間改在取得資料後於前端比對（不受 date_iso 是否補值影響）
  return q.order('created_at', { ascending: false });
}

function isPureNameSearch(f) {
  return f.name && !f.reason && !f.class && !f.note && !f.dateFrom && !f.dateTo;
}

async function runSearch(target) {
  const prefix = target === 'search' ? 'q' : 'eq';
  const errEl = target === 'search' ? $('#search-error') : $('#edit-search-error');
  const resultEl = target === 'search' ? $('#search-result') : $('#edit-result');
  setError(errEl, '');
  show(resultEl, false);

  const filters = gatherFilters(prefix);

  // 未輸入任何條件時，預設查詢全部資料
  if (filters.dateFrom && !validateMinguoDate(filters.dateFrom).ok) {
    setError(errEl, '日期（起）：' + validateMinguoDate(filters.dateFrom).msg);
    return;
  }
  if (filters.dateTo && !validateMinguoDate(filters.dateTo).ok) {
    setError(errEl, '日期（迄）：' + validateMinguoDate(filters.dateTo).msg);
    return;
  }

  const { data, error } = await buildQuery(filters);
  if (error) {
    setError(errEl, '查詢失敗：' + error.message);
    return;
  }

  // 日期區間：於前端以民國日期換算比對（含界線）
  const from = filters.dateFrom ? minguoToIso(filters.dateFrom) : null;
  const to = filters.dateTo ? minguoToIso(filters.dateTo) : null;
  let results = data || [];
  if (from || to) {
    results = results.filter((r) => {
      const iso = r.date_iso || minguoToIso(r.date_minguo);
      if (!iso) return false;
      if (from && iso < from) return false;
      if (to && iso > to) return false;
      return true;
    });
  }

  if (!results || results.length === 0) {
    if (target === 'search' && isPureNameSearch(filters)) {
      switchTab('add');
      $('#add-name').value = filters.name;
      alert('查無此人，已為您跳轉至「新增」頁面（姓名已預填）。');
    } else {
      setError(errEl, '查無相關紀錄');
    }
    return;
  }

  if (target === 'search') {
    renderSearchResults(results, filters);
  } else {
    renderEditResults(results);
  }
}

function renderSearchResults(records, filters) {
  const el = $('#search-result');
  const rows = records.map((r) => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.date_minguo)}</td>
      <td>${escapeHtml(r.reason)}</td>
      <td>${escapeHtml(r.class)}</td>
      <td>${escapeHtml(r.note || '')}</td>
    </tr>`).join('');
  const addBtnText = isPureNameSearch(filters)
    ? `為「${escapeHtml(filters.name)}」新增一筆紀錄`
    : '新增一筆紀錄';
  el.innerHTML = `
    <div class="card">
      <p class="ok">查到 ${records.length} 筆紀錄。</p>
      <div class="form-actions">
        <button class="btn btn-primary" id="search-add-more">${addBtnText}</button>
      </div>
      <table>
        <thead><tr><th>姓名</th><th>日期</th><th>原因</th><th>目前就讀班級</th><th>備註</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  show(el, true);

  $('#search-add-more').addEventListener('click', () => {
    switchTab('add');
    if (isPureNameSearch(filters)) $('#add-name').value = filters.name;
  });
}

/* ---------- 3. 瀏覽 ---------- */
async function loadBrowse() {
  const el = $('#browse-result');
  const { data, error } = await sb
    .from('records')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    el.innerHTML = `<p class="error">讀取失敗：${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!data || data.length === 0) {
    el.innerHTML = '<p class="empty">目前尚無紀錄</p>';
    return;
  }
  const rows = data.map((r) => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.date_minguo)}</td>
      <td>${escapeHtml(r.reason)}</td>
      <td>${escapeHtml(r.class)}</td>
      <td>${escapeHtml(r.note || '')}</td>
    </tr>`).join('');
  el.innerHTML = `
    <table>
      <thead><tr><th>姓名</th><th>日期</th><th>原因</th><th>目前就讀班級</th><th>備註</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="hint" style="margin-top:8px;">共 ${data.length} 筆紀錄</p>`;
}

/* ---------- 4. 刪除 / 修改 ---------- */
$('#edit-search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch('edit');
});
$('#edit-search-clear').addEventListener('click', () => {
  $('#edit-search-form').reset();
  show($('#edit-result'), false);
});

function renderEditResults(records) {
  const el = $('#edit-result');
  const rows = records.map((r) => `
    <tr data-id="${r.id}">
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.date_minguo)}</td>
      <td>${escapeHtml(r.reason)}</td>
      <td>${escapeHtml(r.class)}</td>
      <td>${escapeHtml(r.note || '')}</td>
      <td class="actions">
        <button class="btn btn-sm btn-primary" data-act="edit">修改</button>
        <button class="btn btn-sm btn-danger" data-act="del">刪除</button>
      </td>
    </tr>`).join('');
  el.innerHTML = `
    <div class="card">
      <table>
        <thead><tr><th>姓名</th><th>日期</th><th>原因</th><th>目前就讀班級</th><th>備註</th><th>操作</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  show(el, true);

  el.querySelectorAll('button[data-act]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('tr');
      const id = row.dataset.id;
      if (btn.dataset.act === 'del') {
        await deleteRecord(id);
      } else {
        editRecord(row, id);
      }
    });
  });
}

async function deleteRecord(id) {
  if (!confirm('確定要刪除這筆紀錄嗎？此動作無法復原。')) return;
  const { error } = await sb.from('records').delete().eq('id', id);
  if (error) { alert('刪除失敗：' + error.message); return; }
  alert('刪除成功');
  runSearch('edit');
}

function editRecord(row, id) {
  const name = row.cells[0].textContent;
  const date = row.cells[1].textContent;
  const reason = row.cells[2].textContent;
  const cls = row.cells[3].textContent;
  const note = row.cells[4].textContent;

  row.innerHTML = `
    <td colspan="6">
      <form class="inline-form edit-form">
        <label>姓名 <input type="text" name="name" value="${escapeHtml(name)}"></label>
        <label>日期（民國年月日） <input type="text" name="date" value="${escapeHtml(date)}"></label>
        <label>原因 <input type="text" name="reason" value="${escapeHtml(reason)}"></label>
        <label>目前就讀班級
          <select name="class">
            <option value="">請選擇</option>
            ${classOptions(cls)}
          </select>
        </label>
        <label>備註 <input type="text" name="note" value="${escapeHtml(note)}"></label>
        <p class="error hidden edit-err"></p>
        <div style="display:flex; gap:8px; margin-top:4px;">
          <button type="submit" class="btn btn-sm btn-primary">儲存</button>
          <button type="button" class="btn btn-sm btn-ghost edit-cancel">取消</button>
        </div>
      </form>
    </td>`;

  const form = row.querySelector('.edit-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = row.querySelector('.edit-err');
    const newName = form.elements['name'].value.trim();
    const dateCheck = validateMinguoDate(form.elements['date'].value);
    const newReason = form.elements['reason'].value.trim();
    const newClass = form.elements['class'].value;
    const newNote = form.elements['note'].value.trim();
    if (!newName) return setError(err, '請輸入姓名');
    if (!dateCheck.ok) return setError(err, dateCheck.msg);
    if (!newReason) return setError(err, '請輸入原因');
    if (!newClass) return setError(err, '請選擇目前就讀班級');

    const { error } = await sb.from('records').update({
      name: newName, date_minguo: dateCheck.value, reason: newReason, class: newClass, note: newNote,
      date_iso: minguoToIso(dateCheck.value),
    }).eq('id', id);
    if (error) { setError(err, '修改失敗：' + error.message); return; }
    alert('修改成功');
    runSearch('edit');
  });

  row.querySelector('.edit-cancel').addEventListener('click', () => {
    runSearch('edit');
  });
}

/* ---------- 啟動 ---------- */
init();
