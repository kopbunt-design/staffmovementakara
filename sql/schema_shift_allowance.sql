-- ตารางเก็บผลคำนวณค่ากะรายเดือน (เก็บประวัติการจ่าย)
-- รันใน Supabase SQL editor — รันซ้ำได้ปลอดภัย (idempotent)
create table if not exists shift_allowance (
  id            bigint generated always as identity primary key,
  emp_code      text not null,
  employee_name text,
  department    text,
  month         text not null,          -- 'YYYY-MM'
  job_level     text,
  eligible      boolean default true,    -- ผ่านเกณฑ์ระดับ O ไหม
  family_count  int,
  monthly_rate  numeric,
  pay_days      int,
  no_pay_days   int,
  check_days    int,
  total         numeric,
  created_at    timestamptz default now(),
  created_by    uuid,
  unique (emp_code, month)               -- อัปโหลดเดือนเดิมซ้ำ = อัปเดตทับ (ไม่เกิดแถวซ้ำ)
);

alter table shift_allowance enable row level security;

-- อ่านได้ทุกคนที่ล็อกอิน, เขียน/แก้/ลบเฉพาะ HR + Admin (ใช้ helper get_my_role() ตัวเดิมใน schema.sql)
drop policy if exists "shift_allow_read"  on shift_allowance;
drop policy if exists "shift_allow_write" on shift_allowance;
create policy "shift_allow_read"  on shift_allowance for select using (auth.role() = 'authenticated');
create policy "shift_allow_write" on shift_allowance for all    using (get_my_role() in ('hr','admin'));
