-- ============================================================================
-- ค่าจ้างเหมา: รายการรายได้ / รายหัก (ต่อจาก schema_contract_payroll.sql — รันไฟล์นั้นก่อน)
-- รันใน Supabase SQL editor · รันซ้ำได้ปลอดภัย (idempotent)
--
--   1. contract_pay_codes   — ตั้งค่ารายการ (HR เพิ่มเองได้ ไม่ต้องแก้โค้ด)
--   2. contract_worker_items — รายการประจำรายคน (เช่น บังคับคดีเดือนละ 3,000 ถึง ธ.ค.)
--                              ตอนคำนวณงวด ระบบคัดลอกลง contract_pay_adjust ของงวดนั้น (source = 'recurring')
--                              งวดเก่าจึงเก็บตัวเลข ณ วันนั้นไว้ แม้แก้รายการประจำทีหลัง
--   3. contract_pay_adjust  — เพิ่ม code_id / source / cuts_tax_base (แถวเก่ายังใช้ได้ตามเดิม)
--   4. contract_pay_item    — เพิ่ม tax_base (ฐานภาษีจริงของงวด ใช้ใน 50 ทวิ / ภ.ง.ด.3)
-- ============================================================================

-- ---------------------------------------------------------- 1. ตั้งค่ารายการ
create table if not exists contract_pay_codes (
  id          bigint generated always as identity primary key,
  code        text unique not null,
  kind        text not null check (kind in ('earning','deduction')),
  name_th     text not null,
  name_en     text,
  -- รายได้: เข้าฐานภาษีหัก ณ ที่จ่ายไหม (เบิกคืนค่าใช้จ่าย = ไม่เข้า)
  -- รายหัก: ลดฐานภาษีไหม (หักขาดงาน = ลด เพราะคือค่าจ้างที่ไม่ได้จ่ายจริง · บังคับคดี/เบิกล่วงหน้า = ไม่ลด)
  tax_effect  boolean not null default true,
  is_active   boolean not null default true,
  sort_order  int not null default 100,
  note        text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

insert into contract_pay_codes (code, kind, name_th, name_en, tax_effect, sort_order) values
  ('E01','earning',  'ค่าล่วงเวลา (OT)',      'Overtime',              true,  10),
  ('E02','earning',  'ค่าเดินทาง',            'Travel allowance',      true,  20),
  ('E03','earning',  'โบนัส',                 'Bonus',                 true,  30),
  ('E04','earning',  'ตกเบิก',                'Back pay',              true,  40),
  ('E05','earning',  'เบิกคืนค่าใช้จ่าย',      'Expense reimbursement', false, 50),
  ('E99','earning',  'รายได้อื่น ๆ',           'Other income',          true,  99),
  ('D01','deduction','บังคับคดี (LED)',        'Legal execution (LED)', false, 10),
  ('D02','deduction','หักขาดงาน',             'Absence deduction',     true,  20),
  ('D03','deduction','หักเงินเบิกล่วงหน้า',    'Advance repayment',     false, 30),
  ('D99','deduction','หักอื่น ๆ',              'Other deduction',       false, 99)
on conflict (code) do nothing;

-- ---------------------------------------------------------- 2. รายการประจำรายคน
create table if not exists contract_worker_items (
  id           bigint generated always as identity primary key,
  worker_id    bigint not null references contract_workers(id) on delete cascade,
  code_id      bigint not null references contract_pay_codes(id) on delete restrict,
  amount       numeric not null check (amount > 0),
  start_period text not null check (start_period ~ '^\d{4}-\d{2}$'),   -- งวดแรกที่ใส่ 'YYYY-MM'
  end_period   text check (end_period ~ '^\d{4}-\d{2}$'),             -- งวดสุดท้าย (ว่าง = ไม่มีกำหนด)
  note         text,
  is_active    boolean not null default true,
  created_at   timestamptz default now(),
  created_by   uuid,
  check (end_period is null or end_period >= start_period)
);
create index if not exists cwi_worker_idx on contract_worker_items (worker_id);

-- ---------------------------------------------------------- 3. รายการในงวด
alter table contract_pay_adjust add column if not exists code_id bigint references contract_pay_codes(id) on delete set null;
alter table contract_pay_adjust add column if not exists source text not null default 'once';
alter table contract_pay_adjust add column if not exists cuts_tax_base boolean not null default false;
alter table contract_pay_adjust add column if not exists worker_item_id bigint;
do $$ begin
  alter table contract_pay_adjust add constraint cpa_source_chk check (source in ('once','recurring'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------- 4. ฐานภาษีของงวด
alter table contract_pay_item add column if not exists tax_base numeric;

-- ---------------------------------------------------------- 5. RLS (สิทธิ์ชุดเดียวกับค่าจ้างเหมา)
alter table contract_pay_codes    enable row level security;
alter table contract_worker_items enable row level security;
do $$
declare t text;
begin
  foreach t in array array['contract_pay_codes','contract_worker_items'] loop
    execute format('drop policy if exists "%s_read"  on %I', t, t);
    execute format('drop policy if exists "%s_write" on %I', t, t);
    execute format('create policy "%s_read"  on %I for select using (has_perm(''data.payroll.read''))',  t, t);
    execute format('create policy "%s_write" on %I for all    using (has_perm(''data.payroll.write''))', t, t);
  end loop;
end $$;

select 'contract_pay_codes' as ตาราง, count(*) as แถว from contract_pay_codes
union all select 'contract_worker_items', count(*) from contract_worker_items;
