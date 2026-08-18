-- ตารางรหัสกะ: ย้ายรหัสกะออกจากโค้ดมาเก็บใน DB
-- เพื่อให้เพิ่มกะใหม่ได้เองจากหน้าเว็บ (หน้าคำนวณค่ากะ) โดยไม่ต้องแก้โค้ดและ deploy ใหม่
--
-- รันไฟล์นี้ทั้งไฟล์ใน Supabase SQL Editor ได้เลย — รันซ้ำได้ ไม่พัง

create table if not exists master_shift_codes (
  id         bigserial primary key,
  code       text not null,                                   -- รหัสกะในไฟล์ลงเวลา เช่น D01
  family     text not null check (family in ('DAY','AFT','NIT')), -- ตระกูล: เช้า/บ่าย/ดึก
  note       text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- กันรหัสซ้ำ โดยไม่สนตัวพิมพ์เล็ก/ใหญ่ (ไฟล์ลงเวลาเขียนมาไม่แน่นอน)
create unique index if not exists master_shift_codes_code_uidx
  on master_shift_codes (upper(code));

-- ===== สิทธิ์: ทุกคนที่ล็อกอินอ่านได้ · เฉพาะ HR/Admin แก้ได้ =====
alter table master_shift_codes enable row level security;

drop policy if exists master_shift_codes_read   on master_shift_codes;
drop policy if exists master_shift_codes_insert on master_shift_codes;
drop policy if exists master_shift_codes_update on master_shift_codes;
drop policy if exists master_shift_codes_delete on master_shift_codes;

create policy master_shift_codes_read   on master_shift_codes for select
  to authenticated using (true);
create policy master_shift_codes_insert on master_shift_codes for insert
  to authenticated with check (get_my_role() in ('hr','admin'));
create policy master_shift_codes_update on master_shift_codes for update
  to authenticated using (get_my_role() in ('hr','admin'));
create policy master_shift_codes_delete on master_shift_codes for delete
  to authenticated using (get_my_role() = 'admin');

-- ===== ใส่รหัสกะที่ระบบใช้อยู่เดิม (เท่ากับที่ hardcode ไว้ใน js/shift-allowance.js) =====
insert into master_shift_codes (code, family, note) values
  ('D01','DAY','กะเช้า'), ('D02','DAY','กะเช้า'), ('D03','DAY','กะเช้า'),
  ('NOR','DAY','เวลางานปกติ'), ('F03','DAY','กะเช้า'), ('F04','DAY','กะเช้า'),
  ('A01','AFT','กะบ่าย'), ('A02','AFT','กะบ่าย'), ('A03','AFT','กะบ่าย'),
  ('N01','NIT','กะดึก'), ('N02','NIT','กะดึก'), ('N03','NIT','กะดึก'),
  ('N05','NIT','กะดึก'), ('N07','NIT','กะดึก')
on conflict do nothing;

-- ===== ตรวจผล =====
select family, count(*) as จำนวนรหัส, string_agg(code, ', ' order by code) as รหัส
from master_shift_codes where is_active
group by family order by family;
