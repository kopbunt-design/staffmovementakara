-- ตารางแผนอัตรากำลังที่อนุมัติ (Position Quota / Approved Headcount Plan)
-- รันใน Supabase SQL editor — รันซ้ำได้ปลอดภัย (idempotent)
--
-- ที่มา: ตารางนี้ถูกสร้างด้วยมือใน Supabase โดยไม่มีคอลัมน์ fiscal_year แต่โค้ดใน
-- js/vacancy.js ส่ง fiscal_year ไปทุกครั้งที่บันทึก ทำให้ insert ล้มเหลวทั้งหมด
-- ("เพิ่ม/แก้ quota แล้วไม่เข้า") และ Dashboard ขึ้นว่ายังไม่ได้ตั้งแผน
-- ไฟล์นี้เติมคอลัมน์ที่โค้ดต้องใช้ให้ครบ โดยไม่ลบข้อมูลเดิม

create table if not exists position_quota (
  id bigint generated always as identity primary key
);

-- คอลัมน์ที่ js/vacancy.js ใช้ (add ทีละคอลัมน์ เผื่อบางอันมีอยู่แล้ว)
alter table position_quota add column if not exists fiscal_year int;
alter table position_quota add column if not exists division    text;
alter table position_quota add column if not exists department  text;
alter table position_quota add column if not exists position    text;
alter table position_quota add column if not exists job_level   text;
alter table position_quota add column if not exists quota       int  default 0;
alter table position_quota add column if not exists created_at  timestamptz default now();
alter table position_quota add column if not exists updated_at  timestamptz default now();

-- กันข้อมูลซ้ำระดับฐานข้อมูล (โค้ดเช็คซ้ำในฝั่ง JS อยู่แล้ว แต่กันไว้อีกชั้น
-- เผื่อผู้ใช้สองคนกดพร้อมกัน หรือ import ซ้ำ)
create unique index if not exists position_quota_unique
  on position_quota (fiscal_year, division, department, position, job_level);

alter table position_quota enable row level security;

-- อ่านได้ทุกคนที่ล็อกอิน, เขียนเฉพาะ HR + Admin — ให้ตรงกับที่หน้าเว็บจำกัดไว้
-- (js/vacancy.js: canEdit = userRole เป็น hr หรือ admin) และตรงกับตารางอื่นในระบบ
drop policy if exists "Allow all for authenticated" on position_quota;
drop policy if exists "posquota_read"  on position_quota;
drop policy if exists "posquota_write" on position_quota;
create policy "posquota_read"  on position_quota for select using (auth.role() = 'authenticated');
create policy "posquota_write" on position_quota for all    using (get_my_role() in ('hr','admin'));
