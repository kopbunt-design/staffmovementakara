-- ============================================================================
-- ระบบสิทธิ์แบบกำหนดเองได้ (RBAC) — แอดมินสร้าง role เองได้ และติ๊กได้ว่า role ไหนเห็นอะไร
-- รันใน Supabase SQL editor · รันซ้ำได้ปลอดภัย (idempotent)
--
-- โครงสร้าง 3 ตาราง:
--   app_roles        = รายชื่อ role (เดิมเป็น CHECK ตายตัว user/hr/admin -> ย้ายมาเป็นข้อมูล)
--   permissions      = แคตตาล็อกสิทธิ์ที่ระบบรู้จัก (โค้ดเป็นคนกำหนด แอดมินแก้ไม่ได้)
--   role_permissions = ตารางติ๊ก (มีแถว = อนุญาต)
--
-- ⚠️ หลักการ: สิทธิ์จริงต้องบังคับที่ RLS ไม่ใช่แค่ซ่อนปุ่มบนหน้าเว็บ
--    ไฟล์นี้จึงเขียน policy ใหม่ให้อ่านจากตารางสิทธิ์ทั้งหมด
--
-- ⚠️ กันล็อกตัวเอง: has_perm() คืน true เสมอสำหรับ role 'admin'
--    ต่อให้เผลอติ๊กสิทธิ์ admin ออกหมด แอดมินก็ยังเข้าระบบไปแก้คืนได้
-- ============================================================================


-- ---------------------------------------------------------------- 1. ตาราง
create table if not exists app_roles (
  key        text primary key,                    -- 'admin' / 'hr' / 'user' / ที่สร้างใหม่
  label      text not null,                       -- ชื่อที่แสดงบนหน้าเว็บ
  description text,
  is_system  boolean not null default false,      -- true = ลบไม่ได้ (admin/hr/user)
  sort_order int not null default 100,
  created_at timestamptz default now()
);

create table if not exists permissions (
  key         text primary key,                   -- 'page.employees' / 'data.employee.write'
  category    text not null,                      -- 'page' | 'data' | 'field'
  label       text not null,
  description text,
  sort_order  int not null default 100
);

create table if not exists role_permissions (
  role_key text not null references app_roles(key)   on delete cascade,
  perm_key text not null references permissions(key) on delete cascade,
  primary key (role_key, perm_key)
);

create index if not exists role_permissions_role_idx on role_permissions (role_key);


-- ------------------------------------------- 2. ปลด CHECK เดิมของ user_roles
-- เดิม: check (role in ('user','hr','admin')) -- ทำให้สร้าง role ใหม่ไม่ได้
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'user_roles'::regclass and contype = 'c'
  loop
    execute format('alter table user_roles drop constraint %I', c.conname);
  end loop;
end $$;


-- ------------------------------------------------------ 3. seed role ที่มีอยู่
insert into app_roles (key, label, description, is_system, sort_order) values
  ('admin', 'Admin', 'ผู้ดูแลระบบ — เห็นและแก้ได้ทุกอย่าง ถอนสิทธิ์ไม่ได้', true, 1),
  ('hr',    'HR',    'ฝ่ายบุคคล — จัดการข้อมูลพนักงานและรายงาน',            true, 2),
  ('user',  'User',  'ผู้ใช้ทั่วไป — ดูข้อมูลภาพรวมได้ ไม่เห็นข้อมูลลับ',    true, 3)
on conflict (key) do update
  set label = excluded.label, description = excluded.description, is_system = true;

-- ผูก user_roles กับ app_roles หลังจาก seed แล้ว (ไม่งั้น FK จะพัง)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_roles_role_fkey' and conrelid = 'user_roles'::regclass
  ) then
    -- กันกรณีมี role แปลกปลอมค้างอยู่ใน user_roles
    update user_roles set role = 'user'
    where role is null or role not in (select key from app_roles);

    alter table user_roles
      add constraint user_roles_role_fkey
      foreign key (role) references app_roles(key) on update cascade;
  end if;
end $$;


-- ------------------------------------------------ 4. แคตตาล็อกสิทธิ์
-- ทุก key ต้องมีที่ใช้จริงในโค้ด ถ้าเพิ่ม key ที่โค้ดไม่ได้เช็ค = สิทธิ์หลอก
insert into permissions (key, category, label, description, sort_order) values
  -- หน้าจอ (ตรงกับ data-page ใน index.html)
  ('page.dashboard',  'page', 'Dashboard',            'ภาพรวมกำลังคน',                    10),
  ('page.employees',  'page', 'Employees',            'ทะเบียนพนักงาน',                   11),
  ('page.movements',  'page', 'Staff Movement',       'บันทึกการเคลื่อนไหว',              12),
  ('page.vacancy',    'page', 'Position Quota',       'แผนอัตรากำลัง',                    13),
  ('page.workforce',  'page', 'Workforce Overview',   'ภาพรวมโครงสร้างกำลังคน',           14),
  ('page.headcount',  'page', 'Headcount Report',     'รายงานกำลังคน',                    15),
  ('page.movreport',  'page', 'Movement Report',      'รายงานการเคลื่อนไหว',              16),
  ('page.analytics',  'page', 'Analytics',            'วิเคราะห์ข้อมูล',                  17),
  ('page.payroll',    'page', 'Payroll Report',       'รายการ movement พร้อมเงินเดือนรายคน', 18),
  ('page.payrollexp', 'page', 'ค่าใช้จ่ายเงินเดือน',   'ยอดค่าใช้จ่ายรวมรายเดือน',         19),
  ('page.shiftallow', 'page', 'คำนวณค่ากะ',            'คำนวณและดูประวัติค่ากะ',           20),
  ('page.users',      'page', 'User Management',      'จัดการผู้ใช้และสิทธิ์',            21),
  ('page.settings',   'page', 'Settings',             'ตั้งค่าข้อมูลหลักและสิทธิ์',        22),

  -- ข้อมูล (ใช้บังคับที่ RLS จริง)
  ('data.employee.read',      'data', 'อ่านข้อมูลพนักงาน',        'ดึงทะเบียนพนักงานได้',                    30),
  ('data.employee.write',     'data', 'แก้ข้อมูลพนักงาน',         'เพิ่ม/แก้/ลบ/import พนักงาน',             31),
  ('data.movement.read',      'data', 'อ่าน movement',            'ดูรายการเคลื่อนไหวทั้งหมด',               32),
  ('data.movement.create',    'data', 'บันทึก movement',          'สร้างรายการใหม่ (แก้ของตัวเองได้เสมอ)',   33),
  ('data.movement.manage_any','data', 'แก้/ลบ movement ของคนอื่น','ไม่ใช่แค่รายการที่ตัวเองสร้าง',           34),
  ('data.quota.write',        'data', 'แก้แผนอัตรากำลัง',         'ตั้ง/แก้ position quota',                 35),
  ('data.masterdata.write',   'data', 'แก้ข้อมูลหลัก',            'หน่วยงาน ตำแหน่ง ระดับ รหัสกะ',           36),
  ('data.shiftallow.write',   'data', 'บันทึกผลค่ากะ',            'อัปโหลดและบันทึกประวัติค่ากะ',            37),
  ('data.payroll.read',       'data', 'อ่านยอดค่าใช้จ่ายเงินเดือน','ตาราง payroll_period / payroll_summary',  38),
  ('data.payroll.write',      'data', 'อัปโหลดค่าใช้จ่ายเงินเดือน','นำเข้ายอดรวมรายเดือน',                   39),
  ('data.roles.manage',       'data', 'จัดการสิทธิ์',             'เปลี่ยน role ของผู้ใช้ · สร้าง/แก้ role',  40),

  -- ระดับช่องข้อมูล
  ('field.salary.read', 'field', 'เห็นเงินเดือนรายคน',
   'ช่องเงินเดือนในทะเบียนพนักงานและฟอร์ม movement', 50)
on conflict (key) do update
  set category = excluded.category, label = excluded.label,
      description = excluded.description, sort_order = excluded.sort_order;


-- --------------------------------------- 5. seed สิทธิ์ให้ตรงกับพฤติกรรมเดิม
-- ตั้งใจให้ "รันไฟล์นี้แล้วทุกอย่างเหมือนเดิมเป๊ะ" จะได้ไม่มีใครสิทธิ์หายกะทันหัน
-- แอดมินค่อยไปปรับเองทีหลังจากหน้า Settings

-- admin = ทุกสิทธิ์
insert into role_permissions (role_key, perm_key)
select 'admin', key from permissions
on conflict do nothing;

-- hr = ทุกอย่าง ยกเว้นหน้า Users/Settings และการจัดการสิทธิ์
insert into role_permissions (role_key, perm_key)
select 'hr', key from permissions
where key not in ('page.users','page.settings','data.roles.manage')
on conflict do nothing;

-- user = ดูภาพรวมได้ ไม่เห็นเงินเดือน ไม่เห็นหน้าลับ
insert into role_permissions (role_key, perm_key)
select 'user', key from permissions
where key in (
  'page.dashboard','page.employees','page.movements','page.vacancy',
  'page.workforce','page.headcount','page.movreport','page.analytics',
  'data.employee.read','data.movement.read','data.movement.create'
)
on conflict do nothing;


-- ------------------------------------------------------------ 6. ฟังก์ชัน
-- has_perm(): ใช้ทั้งใน RLS และให้หน้าเว็บเรียกผ่าน RPC ได้
-- security definer เพราะต้องอ่าน user_roles/role_permissions ข้าม RLS
create or replace function has_perm(p text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    case
      when auth.uid() is null then false
      -- admin ผ่านเสมอ — กันเผลอถอนสิทธิ์ตัวเองจนเข้าระบบไม่ได้
      when get_my_role() = 'admin' then true
      else exists (
        select 1
        from user_roles ur
        join role_permissions rp on rp.role_key = ur.role
        where ur.user_id = auth.uid() and rp.perm_key = p
      )
    end;
$$;

-- my_permissions(): หน้าเว็บเรียกครั้งเดียวตอน login แล้วเก็บไว้ใช้
create or replace function my_permissions()
returns setof text
language sql
security definer
stable
set search_path = public
as $$
  select p.key
  from permissions p
  where get_my_role() = 'admin'
  union
  select rp.perm_key
  from user_roles ur
  join role_permissions rp on rp.role_key = ur.role
  where ur.user_id = auth.uid();
$$;


-- ------------------------------------------------------------- 7. RLS
alter table app_roles        enable row level security;
alter table permissions      enable row level security;
alter table role_permissions enable row level security;

-- ทุกคนที่ล็อกอินอ่านตารางสิทธิ์ได้ (หน้าเว็บต้องรู้ว่าตัวเองทำอะไรได้)
-- แต่แก้ได้เฉพาะคนที่มีสิทธิ์ data.roles.manage
drop policy if exists "app_roles_read"  on app_roles;
drop policy if exists "app_roles_write" on app_roles;
create policy "app_roles_read"  on app_roles for select using (auth.role() = 'authenticated');
create policy "app_roles_write" on app_roles for all    using (has_perm('data.roles.manage'));

drop policy if exists "permissions_read"  on permissions;
drop policy if exists "permissions_write" on permissions;
create policy "permissions_read"  on permissions for select using (auth.role() = 'authenticated');
-- แคตตาล็อกสิทธิ์แก้จากหน้าเว็บไม่ได้ ต้องแก้ที่ไฟล์ SQL นี้เท่านั้น
-- (ถ้าปล่อยให้เพิ่ม key เองได้ จะได้ key ที่โค้ดไม่รู้จัก = สิทธิ์หลอก)
create policy "permissions_write" on permissions for all using (false) with check (false);

drop policy if exists "role_perm_read"  on role_permissions;
drop policy if exists "role_perm_write" on role_permissions;
create policy "role_perm_read"  on role_permissions for select using (auth.role() = 'authenticated');
create policy "role_perm_write" on role_permissions for all    using (has_perm('data.roles.manage'));


-- ============================================================================
-- 8. เขียน RLS ของตารางเดิมใหม่ ให้อ่านจากตารางสิทธิ์แทนการฝัง role ไว้ในนโยบาย
--
-- ผลลัพธ์หลังรัน = เหมือนเดิมเป๊ะ เพราะข้อ 5 seed สิทธิ์ให้ตรงพฤติกรรมเดิมแล้ว
-- ต่างกันตรงที่ตอนนี้แอดมินเปลี่ยนได้จากหน้าเว็บโดยไม่ต้องแก้ SQL อีก
--
-- หมายเหตุ has_perm() เป็น security definer จึงอ่าน user_roles ได้โดยไม่ติด RLS
-- ของตัวมันเอง (ไม่เกิด recursion)
-- ============================================================================

-- ---------- employees ----------
drop policy if exists "employees_read"  on employees;
drop policy if exists "employees_write" on employees;
create policy "employees_read"  on employees for select using (has_perm('data.employee.read'));
create policy "employees_write" on employees for all    using (has_perm('data.employee.write'));

-- ---------- movements ----------
-- อ่าน/สร้าง ตามสิทธิ์ · แก้-ลบ ของตัวเองได้เสมอ ส่วนของคนอื่นต้องมี manage_any
drop policy if exists "movements_read"   on movements;
drop policy if exists "movements_insert" on movements;
drop policy if exists "movements_update" on movements;
drop policy if exists "movements_delete" on movements;
create policy "movements_read"   on movements for select using (has_perm('data.movement.read'));
create policy "movements_insert" on movements for insert with check (has_perm('data.movement.create'));
create policy "movements_update" on movements for update
  using (created_by = auth.uid() or has_perm('data.movement.manage_any'));
create policy "movements_delete" on movements for delete
  using (created_by = auth.uid() or has_perm('data.movement.manage_any'));

-- ---------- position_quota ----------
drop policy if exists "posquota_read"  on position_quota;
drop policy if exists "posquota_write" on position_quota;
create policy "posquota_read"  on position_quota for select using (auth.role() = 'authenticated');
create policy "posquota_write" on position_quota for all    using (has_perm('data.quota.write'));

-- ---------- ข้อมูลหลัก (master_*) ----------
do $$
declare t text;
begin
  foreach t in array array[
    'master_divisions','master_departments','master_sections',
    'master_teams','master_positions','master_job_levels','master_shift_codes'
  ] loop
    if to_regclass(t) is not null then
      execute format('drop policy if exists "master_read" on %I', t);
      execute format('drop policy if exists "master_write" on %I', t);
      execute format(
        'create policy "master_read" on %I for select using (auth.role() = ''authenticated'')', t);
      execute format(
        'create policy "master_write" on %I for all using (has_perm(''data.masterdata.write''))', t);
    end if;
  end loop;
end $$;

-- ---------- shift_allowance ----------
drop policy if exists "shift_allow_read"  on shift_allowance;
drop policy if exists "shift_allow_write" on shift_allowance;
create policy "shift_allow_read"  on shift_allowance for select using (auth.role() = 'authenticated');
create policy "shift_allow_write" on shift_allowance for all    using (has_perm('data.shiftallow.write'));

-- ---------- payroll (ยอดรวมค่าใช้จ่ายเงินเดือน) ----------
drop policy if exists "payroll_period_read"   on payroll_period;
drop policy if exists "payroll_period_write"  on payroll_period;
drop policy if exists "payroll_summary_read"  on payroll_summary;
drop policy if exists "payroll_summary_write" on payroll_summary;
create policy "payroll_period_read"   on payroll_period  for select using (has_perm('data.payroll.read'));
create policy "payroll_period_write"  on payroll_period  for all    using (has_perm('data.payroll.write'));
create policy "payroll_summary_read"  on payroll_summary for select using (has_perm('data.payroll.read'));
create policy "payroll_summary_write" on payroll_summary for all    using (has_perm('data.payroll.write'));

-- ---------- user_roles ----------
-- อ่านได้ทุกคน (หน้าเว็บต้องรู้ว่าตัวเองเป็น role อะไร) · สมัครตัวเองได้ · แก้ role คนอื่นต้องมีสิทธิ์
drop policy if exists "roles_read"   on user_roles;
drop policy if exists "roles_insert" on user_roles;
drop policy if exists "roles_update" on user_roles;
drop policy if exists "roles_delete" on user_roles;
create policy "roles_read"   on user_roles for select using (auth.role() = 'authenticated');
create policy "roles_insert" on user_roles for insert with check (user_id = auth.uid());
create policy "roles_update" on user_roles for update using (has_perm('data.roles.manage'));
create policy "roles_delete" on user_roles for delete using (has_perm('data.roles.manage'));

-- ---------- pending_roles ----------
drop policy if exists "pending_read"        on pending_roles;
drop policy if exists "pending_write"       on pending_roles;
drop policy if exists "pending_delete_self" on pending_roles;
create policy "pending_read"        on pending_roles for select using (auth.role() = 'authenticated');
create policy "pending_write"       on pending_roles for all    using (has_perm('data.roles.manage'));
create policy "pending_delete_self" on pending_roles for delete using (auth.role() = 'authenticated');


-- ============================================================================
-- 9. ตรวจผล
-- ============================================================================
select r.key as role, r.label, r.is_system,
       count(rp.perm_key) as สิทธิ์ที่มี,
       (select count(*) from permissions) as สิทธิ์ทั้งหมด
from app_roles r
left join role_permissions rp on rp.role_key = r.key
group by r.key, r.label, r.is_system, r.sort_order
order by r.sort_order;
-- ที่ควรได้: admin 25/25 · hr 22/25 · user 11/25
