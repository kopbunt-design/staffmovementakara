-- ============================================================================
-- ค่าจ้างเหมา (Contract Payroll) — ที่ปรึกษา / ลูกจ้างชั่วคราว / ผู้รับเหมา
-- รันใน Supabase SQL editor · รันซ้ำได้ปลอดภัย (idempotent)
--
-- ⚠️ คนกลุ่มนี้ "ไม่ใช่พนักงาน" — อยู่คนละตารางกับ employees โดยตั้งใจ
--    ห้ามเอาไปรวมในรายงานนับกำลังคน (Dashboard / Headcount / Movement / Workforce)
--    ตาราง employees เป็นฐานของรายงานพวกนั้น ถ้าเอาคนกลุ่มนี้ยัดเข้าไป ยอดจะพองทุกหน้า
--
-- โครงตามโปรแกรมเงินเดือนมาตรฐาน:
--   1. ตั้งคนไว้ครั้งเดียว (contract_workers) พร้อมค่าจ้างประจำ
--   2. เปิดงวดรายเดือน (contract_pay_run) -> คำนวณ -> อนุมัติ -> ล็อก
--   3. งวดที่ล็อกแล้วแก้ไม่ได้ (trigger บังคับ) — จ่ายเงินไปแล้วต้องตรวจย้อนหลังได้
--      ถ้าจะแก้ต้องเปิดงวดแก้ไขใหม่ ไม่ใช่ทับของเดิม
-- ============================================================================


-- ---------------------------------------------------------- 1. คน
create table if not exists contract_workers (
  id            bigint generated always as identity primary key,
  worker_code   text unique not null,              -- รหัสของกลุ่มนี้เอง ไม่ปนกับ emp_code
  name_th       text not null,
  name_en       text,
  worker_type   text not null default 'consultant'
                check (worker_type in ('consultant','casual','contractor')),
  tax_id        text,                              -- เลขผู้เสียภาษี 13 หลัก (ไว้ออก 50 ทวิ)
  phone         text,
  division      text,
  department    text,
  cost_code     text,                              -- ผูกกับผังบัญชีเดียวกับพนักงาน
  monthly_rate  numeric not null default 0,        -- ค่าจ้างเหมาต่อเดือน (รายการประจำ)
  -- ⚠️ หัก ณ ที่จ่าย 3% เป็นรายคน ไม่ใช่รายประเภท
  --    ตรวจจากไฟล์จริง ส.ค. 2026: CRD หักเฉพาะที่ปรึกษา ไม่หักลูกจ้างชั่วคราว
  --    แต่ Supply หักลูกจ้างชั่วคราว — สองแผนกขัดกัน จึงต้องกำหนดรายคน
  wht_percent   numeric not null default 3,
  wht_apply     boolean not null default true,
  -- บัญชีธนาคาร — ใช้ออกไฟล์โอนเงิน ถ้าไม่กรอกจะโอนให้ไม่ได้
  bank_name     text,
  bank_account  text,
  start_date    date,
  end_date      date,                              -- วันสิ้นสุดสัญญา (ว่าง = ยังไม่กำหนด)
  is_active     boolean not null default true,
  remark        text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  created_by    uuid
);
create index if not exists cw_active_idx on contract_workers (is_active, worker_type);

-- เผื่อเคยรัน schema เวอร์ชันก่อนหน้าไปแล้ว (create table if not exists จะข้ามคอลัมน์ใหม่)
alter table contract_workers add column if not exists bank_name    text;
alter table contract_workers add column if not exists bank_account text;



-- ---------------------------------------------------------- 2. งวดจ่าย
create table if not exists contract_pay_run (
  id           bigint generated always as identity primary key,
  period       text unique not null,               -- 'YYYY-MM'
  status       text not null default 'draft'
               check (status in ('draft','calculated','approved','locked')),
  note         text,
  calculated_at timestamptz, calculated_by uuid,
  approved_at   timestamptz, approved_by   uuid,
  locked_at     timestamptz, locked_by     uuid,
  created_at   timestamptz default now(),
  created_by   uuid
);


-- ------------------------------------------------- 3. บรรทัดในงวด
-- เก็บตัวเลขไว้กับตัวเอง ไม่ไปอ่านจาก contract_workers ตอนแสดงผล
-- เพราะถ้าปีหน้าขึ้นค่าจ้าง งวดเก่าต้องยังโชว์ตัวเลขเดิมตลอดไป
create table if not exists contract_pay_item (
  id           bigint generated always as identity primary key,
  run_id       bigint not null references contract_pay_run(id) on delete cascade,
  worker_id    bigint not null references contract_workers(id) on delete restrict,
  -- สำเนาข้อมูลคน ณ ตอนคำนวณ (คนอาจย้ายแผนก/เปลี่ยนชื่อทีหลัง)
  worker_code  text not null,
  name_th      text not null,
  worker_type  text not null,
  department   text,
  cost_code    text,
  base_amount  numeric not null default 0,         -- ค่าจ้างเหมาประจำเดือนนั้น
  extra_amount numeric not null default 0,         -- รวมรายการได้เพิ่มครั้งเดียว
  deduct_amount numeric not null default 0,        -- รวมรายการหักครั้งเดียว
  wht_percent  numeric not null default 0,
  wht_amount   numeric not null default 0,         -- ภาษีหัก ณ ที่จ่าย
  net_amount   numeric not null default 0,         -- ยอดโอนจริง
  created_at   timestamptz default now(),
  unique (run_id, worker_id)
);
create index if not exists cpi_run_idx on contract_pay_item (run_id);

-- เก็บสำเนาบัญชีไว้ในงวดด้วย — คนอาจเปลี่ยนบัญชีทีหลัง แต่งวดเก่าต้องรู้ว่าโอนเข้าบัญชีไหน
-- (ต้องอยู่หลัง create table เสมอ ไม่งั้น alter จะหาตารางไม่เจอ)
alter table contract_pay_item add column if not exists bank_name    text;
alter table contract_pay_item add column if not exists bank_account text;


-- --------------------------------------- 4. รายการครั้งเดียว (เพิ่ม/หัก)
create table if not exists contract_pay_adjust (
  id         bigint generated always as identity primary key,
  run_id     bigint not null references contract_pay_run(id) on delete cascade,
  worker_id  bigint not null references contract_workers(id) on delete cascade,
  kind       text not null check (kind in ('earning','deduction')),
  label      text not null,                        -- เช่น 'โบนัส', 'หักค่าอุปกรณ์'
  amount     numeric not null check (amount >= 0),
  taxable    boolean not null default true,        -- รายได้เพิ่มนี้เอาไปคิดภาษี 3% ด้วยไหม
  remark     text,
  created_at timestamptz default now(),
  created_by uuid
);
create index if not exists cpa_run_idx on contract_pay_adjust (run_id, worker_id);


-- ================================================= 5. กันแก้งวดที่ล็อกแล้ว
-- บังคับที่ DB ไม่ใช่แค่ซ่อนปุ่มบนหน้าเว็บ — งวดที่จ่ายเงินไปแล้วต้องแตะไม่ได้จริง ๆ
create or replace function block_locked_run()
returns trigger language plpgsql as $$
declare rid bigint; st text;
begin
  rid := coalesce(new.run_id, old.run_id);
  select status into st from contract_pay_run where id = rid;
  if st = 'locked' then
    raise exception 'งวดนี้ล็อกแล้ว แก้ไขไม่ได้ — ถ้าต้องแก้ให้เปิดงวดแก้ไขใหม่';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists cpi_locked on contract_pay_item;
create trigger cpi_locked before insert or update or delete on contract_pay_item
  for each row execute function block_locked_run();

drop trigger if exists cpa_locked on contract_pay_adjust;
create trigger cpa_locked before insert or update or delete on contract_pay_adjust
  for each row execute function block_locked_run();

-- งวดที่ล็อกแล้วห้ามย้อนสถานะกลับ
create or replace function block_unlock_run()
returns trigger language plpgsql as $$
begin
  if old.status = 'locked' and new.status <> 'locked' then
    raise exception 'ปลดล็อกงวดที่ล็อกแล้วไม่ได้';
  end if;
  return new;
end $$;
drop trigger if exists cpr_no_unlock on contract_pay_run;
create trigger cpr_no_unlock before update on contract_pay_run
  for each row execute function block_unlock_run();


-- ---------------------------------------------------------- 6. RLS
-- ใช้สิทธิ์ชุดเดียวกับรายงานค่าใช้จ่ายเงินเดือน (data.payroll.*) ไม่ต้องเพิ่มสิทธิ์ใหม่
alter table contract_workers    enable row level security;
alter table contract_pay_run    enable row level security;
alter table contract_pay_item   enable row level security;
alter table contract_pay_adjust enable row level security;

do $$
declare t text;
begin
  foreach t in array array['contract_workers','contract_pay_run','contract_pay_item','contract_pay_adjust'] loop
    execute format('drop policy if exists "%s_read"  on %I', t, t);
    execute format('drop policy if exists "%s_write" on %I', t, t);
    execute format('create policy "%s_read"  on %I for select using (has_perm(''data.payroll.read''))',  t, t);
    execute format('create policy "%s_write" on %I for all    using (has_perm(''data.payroll.write''))', t, t);
  end loop;
end $$;


-- ============================================================================
-- 7. ตรวจผล
-- ============================================================================
select 'contract_workers' as ตาราง, count(*) as แถว from contract_workers
union all select 'contract_pay_run',    count(*) from contract_pay_run
union all select 'contract_pay_item',   count(*) from contract_pay_item
union all select 'contract_pay_adjust', count(*) from contract_pay_adjust;


-- ============================================================================
-- 8. สิทธิ์เปิดหน้า — router ใน app.js เช็ค page.<key> ก่อนเสมอ
--    ให้ role ที่มีสิทธิ์อ่านค่าใช้จ่ายเงินเดือนอยู่แล้ว เห็นหน้านี้ด้วย
-- ============================================================================
insert into permissions (key, category, label, description, sort_order) values
  ('page.contractpay','page','ค่าจ้างเหมา','ที่ปรึกษา ลูกจ้างชั่วคราว ผู้รับเหมา — คิดค่าจ้างเป็นงวด', 19)
on conflict (key) do update set label = excluded.label, description = excluded.description;

insert into role_permissions (role_key, perm_key)
select r.key, 'page.contractpay' from app_roles r
where r.key = 'admin' or exists (
  select 1 from role_permissions rp where rp.role_key = r.key and rp.perm_key = 'page.payrollexp')
on conflict do nothing;
