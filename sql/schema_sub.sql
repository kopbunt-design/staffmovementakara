-- ============================================================================
-- ทะเบียนผู้รับเหมา (SUB) — คนจากบริษัทผู้รับเหมามาทำงานที่ไซต์ · เว็บแยก /sub (sub/sb.js)
-- รันใน Supabase SQL editor · รันซ้ำได้ปลอดภัย (idempotent)
--
-- ⚠️ ไม่ใช่พนักงาน และไม่ใช่ค่าจ้างเหมา 3% (contract_workers) — เก็บไว้ทำรายงานจำนวนคนแยกบริษัทรายเดือน
-- ⚠️ HR เป็นคนอัปเดตเท่านั้น (ผู้ใช้ 2026-10-15) · นำเข้าจากไฟล์ "ข้อมูลบัตรผู้รับเหมา" โฟลเดอร์ละบริษัท ใช้ไฟล์ล่าสุด
-- เลขบัตรประชาชน / passport เก็บแค่ 5 ตัวท้าย (เลขเต็มไม่ออกจากเบราว์เซอร์ — นโยบายเดียวกับข้อมูลพนักงาน)
-- วันที่ออก (left_on) = วันทำงานวันสุดท้าย → นับเป็นคนออกของเดือนนั้น และไม่อยู่ในยอดสิ้นเดือนนั้น
-- ============================================================================

create table if not exists sub_companies (
  id             bigint generated always as identity primary key,
  name           text not null unique,                -- ชื่อตามโฟลเดอร์ เช่น Lotus hall
  legal_name     text,                                -- ชื่อเต็ม เช่น GLD ENVIRONMENTAL CO., LTD.
  tax_id         text,
  contact_name   text, contact_phone text, contact_email text,
  contract_no    text, contract_start date, contract_end date,
  scope          text,                                -- งานที่รับ เช่น รปภ. แม่บ้าน ขนส่ง
  is_active      boolean not null default true,
  remark         text,
  created_at     timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists sub_workers (
  id               bigint generated always as identity primary key,
  company_id       bigint not null references sub_companies(id) on delete restrict,
  sub_no           text unique,                       -- SUB No. (ว่างได้ระหว่างรอออกเลข)
  ac_no            text,                              -- เลขในระบบประตู (access control)
  card_no          text,                              -- เลขหลังบัตร
  title            text, first_name text not null, last_name text,
  nationality      text not null default 'Thai',
  id_last5         text check (id_last5 is null or id_last5 ~ '^\d{5}$'),   -- 5 ตัวท้ายบัตรประชาชน
  passport_last5   text,
  birth_date       date,
  phone            text, emergency_name text, emergency_phone text,
  position         text, team text, area text,        -- area เช่น HQ / KM.20
  village text, subdistrict text, district text, province text,   -- หมู่ / ตำบล / อำเภอ / จังหวัด
  status           text not null default 'active' check (status in ('active','left','banned')),
  start_date       date,                              -- วันเริ่มเข้าพื้นที่ (ว่าง = มีชื่อก่อนนำเข้าครั้งแรก)
  left_on          date,                              -- วันทำงานวันสุดท้าย
  left_reason      text,
  card_issued      date, card_expiry date, card_returned date,
  induction_date   date, induction_expiry date,
  medical_date     date, medical_expiry date,
  work_permit_no   text, work_permit_expiry date, visa_expiry date,
  licenses         jsonb not null default '[]',       -- [{name, no, expiry}] เช่น ใบขับขี่ ปั้นจั่น ทำงานที่สูง
  remark           text,
  source_file      text,                              -- ไฟล์ที่นำเข้าล่าสุด
  created_at       timestamptz default now(), updated_at timestamptz default now(),
  check (status = 'active' or left_on is not null)          -- ออก / ห้ามเข้า ต้องมีวันสุดท้าย (รายงานรายเดือนใช้วันนี้)
);
create index if not exists sw_company_idx on sub_workers (company_id, status);

-- ประวัติการแก้ (ใครแก้อะไรเมื่อไร) — trigger บันทึกเอง ไม่ต้องพึ่งหน้าเว็บ
create table if not exists sub_worker_log (
  id         bigint generated always as identity primary key,
  worker_id  bigint not null references sub_workers(id) on delete cascade,
  at         timestamptz not null default now(),
  by_user    uuid default auth.uid(),
  action     text not null,                           -- insert / update
  changes    jsonb                                    -- {field: [ก่อน, หลัง]}
);
create index if not exists swl_worker_idx on sub_worker_log (worker_id, at desc);

create or replace function log_sub_worker() returns trigger language plpgsql security definer set search_path = public as $$
declare ch jsonb := '{}'; k text; o jsonb; n jsonb;
begin
  if tg_op = 'INSERT' then
    insert into sub_worker_log (worker_id, action) values (new.id, 'insert');
    return new;
  end if;
  o := to_jsonb(old); n := to_jsonb(new);
  for k in select jsonb_object_keys(n) loop
    if k not in ('updated_at','created_at') and (o -> k) is distinct from (n -> k) then ch := ch || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k)); end if;
  end loop;
  if ch <> '{}' then insert into sub_worker_log (worker_id, action, changes) values (new.id, 'update', ch); end if;
  return new;
end $$;
drop trigger if exists sw_log on sub_workers;
create trigger sw_log after insert or update on sub_workers for each row execute function log_sub_worker();

-- ------------------------------------------------------------- RLS + สิทธิ์
alter table sub_companies  enable row level security;
alter table sub_workers    enable row level security;
alter table sub_worker_log enable row level security;
do $$
declare t text;
begin
  foreach t in array array['sub_companies','sub_workers','sub_worker_log'] loop
    execute format('drop policy if exists "%s_read"  on %I', t, t);
    execute format('drop policy if exists "%s_write" on %I', t, t);
    execute format('create policy "%s_read"  on %I for select using (has_perm(''page.sub''))', t, t);
  end loop;
end $$;
create policy "sub_companies_write" on sub_companies for all using (has_perm('data.sub.write')) with check (has_perm('data.sub.write'));
create policy "sub_workers_write"   on sub_workers   for all using (has_perm('data.sub.write')) with check (has_perm('data.sub.write'));
-- log เขียนโดย trigger (security definer) เท่านั้น

insert into permissions (key, category, label, description, sort_order) values
  ('page.sub',       'page', 'ทะเบียนผู้รับเหมา (SUB)', 'ดูทะเบียนคนจากบริษัทผู้รับเหมาและรายงานจำนวนคนรายเดือน', 24),
  ('data.sub.write', 'data', 'แก้ทะเบียนผู้รับเหมา',     'เพิ่ม แก้ นำเข้าไฟล์ทะเบียนผู้รับเหมา', 42)
on conflict (key) do update set label = excluded.label, description = excluded.description, sort_order = excluded.sort_order;
insert into role_permissions (role_key, perm_key)
select r.key, p.key from app_roles r cross join (values ('page.sub'), ('data.sub.write')) as p(key)
where r.key in ('admin', 'hr')
on conflict do nothing;

select key, label from permissions where key in ('page.sub', 'data.sub.write');
