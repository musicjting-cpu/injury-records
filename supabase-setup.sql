-- =============================================================
-- 傷病紀錄系統 — Supabase 資料庫初始化
-- 使用方式：Supabase 專案 → SQL Editor → 貼上本檔全部內容 → Run
-- =============================================================

-- 1. 建立資料表
create table if not exists public.records (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,          -- 姓名
  date_minguo text not null,          -- 日期（民國年月日，例如「115年10月3日」）
  reason      text not null,          -- 原因（疾病/受傷，自行輸入）
  class       text not null,          -- 目前就讀班級
  note        text,                   -- 備註（選填）
  date_iso    text,                   -- 西元可排序日期 YYYY-MM-DD（供區間查詢）
  created_at  timestamptz not null default now()
);

-- 2. 開啟 Row Level Security（未開啟前任何人可讀寫，務必執行）
alter table public.records enable row level security;

-- 3. 權限：只有「已登入」使用者可存取（RLS 擋掉未登入者）
drop policy if exists "auth_read" on public.records;
create policy "auth_read" on public.records
  for select using (auth.uid() is not null);

drop policy if exists "auth_insert" on public.records;
create policy "auth_insert" on public.records
  for insert with check (auth.uid() is not null);

drop policy if exists "auth_update" on public.records;
create policy "auth_update" on public.records
  for update using (auth.uid() is not null);

drop policy if exists "auth_delete" on public.records;
create policy "auth_delete" on public.records
  for delete using (auth.uid() is not null);

-- =============================================================
-- 4. 建立管理員帳號（二擇一）
-- =============================================================

-- 方式 A（推薦）：到 Supabase 後台
--   Authentication → Users → Add user → 填 Email + Password
--   → 勾選「Auto Confirm User」→ Create User

-- 方式 B：用 SQL 建立（下方把 email 與密碼換成你自己的後，取消註解並執行）
-- select auth.admin.create_user(
--   email        := 'your_email@example.com',
--   password     := '在此填寫高強度密碼',
--   email_confirm := true
-- );
