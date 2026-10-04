-- =============================================================
-- 傷病紀錄系統 — 資料庫遷移（在已有資料表上執行）
-- 用途：新增「備註」欄位，並新增可排序日期欄位供「區間查詢」使用
-- 使用方式：Supabase 專案 → SQL Editor → 貼上全部 → Run
-- =============================================================

-- 1. 新增備註欄位
alter table public.records add column if not exists note text;

-- 2. 新增可排序日期欄位（民國 → 西元 YYYY-MM-DD，供區間查詢）
alter table public.records add column if not exists date_iso text;

-- 3. 將既有資料的 date_minguo 轉成 date_iso（一次性補值）
update public.records
set date_iso =
    ((substring(date_minguo from '^[0-9]+')::int + 1911)::text
     || '-'
     || lpad(substring(date_minguo from '年([0-9]+)月'), 2, '0')
     || '-'
     || lpad(substring(date_minguo from '月([0-9]+)日'), 2, '0'))
where date_iso is null;
