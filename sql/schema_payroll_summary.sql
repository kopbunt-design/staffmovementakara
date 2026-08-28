-- รายงานค่าใช้จ่ายเงินเดือนรายเดือน (Payroll Expense Report)
-- รันใน Supabase SQL editor — รันซ้ำได้ปลอดภัย (idempotent)
--
-- ============================================================================
-- ความลับของข้อมูล — อ่านก่อนแก้
-- ============================================================================
-- ตารางนี้เก็บ "ยอดรวมระดับแผนก" เท่านั้น ไม่มีเงินเดือนรายบุคคลเด็ดขาด
-- ไฟล์ Excel ต้นทางมีชีต Stafflist / BeforeProcessYDP ที่มีเงินเดือนรายคน
-- ตัวอัปโหลด (js/payroll-summary.js) อ่านเฉพาะชีต 'Payroll Report' ชีตเดียว
-- และไม่เคยส่งชีตอื่นขึ้น Supabase — ถ้าจะแก้ตัวอัปโหลด ต้องรักษาข้อนี้ไว้
--
-- ต่างจากตารางอื่นในระบบ: อ่านได้เฉพาะ HR + Admin (ตารางอื่นให้ทุกคนที่ล็อกอินอ่านได้)
-- เพราะยอดค่าใช้จ่ายเงินเดือนรวมก็ยังเป็นข้อมูลลับของบริษัท
-- ============================================================================

-- ---------- หัวรายงานรายเดือน (1 แถวต่อ 1 เดือน) ----------
create table if not exists payroll_period (
  month            text primary key,      -- 'YYYY-MM'
  report_date      date,
  total_expense    numeric,
  total_deduction  numeric,
  net_salary       numeric,
  total_headcount  int,
  prepared_by      text, prepared_position text,
  reviewed_by      text, reviewed_position text,
  approved_by      text, approved_position text,
  source_file      text,                  -- ชื่อไฟล์ที่อัปโหลด ไว้ตรวจย้อนหลัง
  uploaded_at      timestamptz default now(),
  uploaded_by      uuid
);

-- ---------- ยอดแยกแผนก x รายการ ----------
create table if not exists payroll_summary (
  id             bigint generated always as identity primary key,
  month          text not null references payroll_period(month) on delete cascade,
  business_group text not null,           -- OPERATIONS / SUSTAINABILITY / COMMERCIAL / EXPLORATION / BKK Office / Legal
  department     text not null,           -- ชื่อแผนก หรือชื่อคอลัมน์รวม
  col_kind       text not null default 'dept'
                 check (col_kind in ('dept','group_total','grand_total')),
  section        text not null,           -- SENIOR STAFF / STAFF / DEDUCTION — STAFF EXPENSES / ...
  line_item      text not null,           -- Basic Salary / Shift Allowance / Headcount / ...
  cost_code      text,
  value          numeric,
  value_kind     text not null default 'amount'
                 check (value_kind in ('amount','headcount')),
  row_order      int,                     -- ลำดับแถวตามต้นฉบับ ใช้เรียงตอนแสดงผล
  col_order      int,                     -- ลำดับคอลัมน์ตามต้นฉบับ
  unique (month, department, section, line_item)
);

create index if not exists payroll_summary_month_idx on payroll_summary (month);
create index if not exists payroll_summary_month_group_idx on payroll_summary (month, business_group);

-- ---------- RLS ----------
alter table payroll_period  enable row level security;
alter table payroll_summary enable row level security;

-- อ่าน/เขียน เฉพาะ HR + Admin (ใช้ helper get_my_role() ตัวเดิมใน schema.sql)
drop policy if exists "payroll_period_read"   on payroll_period;
drop policy if exists "payroll_period_write"  on payroll_period;
drop policy if exists "payroll_summary_read"  on payroll_summary;
drop policy if exists "payroll_summary_write" on payroll_summary;

create policy "payroll_period_read"   on payroll_period  for select using (get_my_role() in ('hr','admin'));
create policy "payroll_period_write"  on payroll_period  for all    using (get_my_role() in ('hr','admin'));
create policy "payroll_summary_read"  on payroll_summary for select using (get_my_role() in ('hr','admin'));
create policy "payroll_summary_write" on payroll_summary for all    using (get_my_role() in ('hr','admin'));

-- ===== ตรวจผล =====
select month, report_date, total_expense, total_deduction, net_salary, total_headcount, uploaded_at
from payroll_period order by month desc;
