-- ============================================================
-- AKARA HR SYSTEM — Supabase Database Schema
-- วิธีใช้: ไปที่ Supabase Dashboard > SQL Editor > วางโค้ดนี้ทั้งหมด > Run
-- ============================================================

-- 1. EMPLOYEES TABLE
create table if not exists employees (
  emp_code        text primary key,
  status          text default 'Active',
  firstname_th    text,
  lastname_th     text,
  firstname_en    text,
  lastname_en     text,
  gender          text,
  nationality     text,
  dob             date,
  phone           text,
  division        text,
  department      text,
  section         text,
  team            text,
  position        text,
  job_level       text,
  site            text,
  contract_type   text,
  join_date       date,
  effective_date  date,
  end_date        date,
  salary          numeric,
  remark          text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- 2. MOVEMENTS TABLE
create table if not exists movements (
  id            uuid primary key default gen_random_uuid(),
  emp_code      text,
  name          text not null,
  type          text not null,
  date          date,
  from_dept     text,
  to_dept       text,
  reason        text,
  salary        numeric,
  cost_center   text,
  recorded_by   text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- 3. USER ROLES TABLE
create table if not exists user_roles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  name        text,
  email       text,
  role        text default 'user' check (role in ('user','hr','admin')),
  created_at  timestamptz default now()
);

-- 4. PENDING ROLES (สำหรับกำหนดสิทธิ์ล่วงหน้าก่อน user สมัคร)
create table if not exists pending_roles (
  email_key   text primary key,
  name        text,
  email       text,
  role        text default 'user',
  created_at  timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

alter table employees  enable row level security;
alter table movements  enable row level security;
alter table user_roles enable row level security;
alter table pending_roles enable row level security;

-- HELPER: check role
create or replace function get_my_role()
returns text language sql security definer stable as $$
  select role from user_roles where user_id = auth.uid()
$$;

-- EMPLOYEES: ทุกคนอ่านได้ เฉพาะ hr/admin แก้ไขได้
create policy "employees_read"   on employees for select using (auth.role() = 'authenticated');
create policy "employees_write"  on employees for all    using (get_my_role() in ('hr','admin'));

-- MOVEMENTS: ทุกคนอ่านได้, ใครก็บันทึกได้, แก้/ลบได้เฉพาะตัวเอง
create policy "movements_read"   on movements for select using (auth.role() = 'authenticated');
create policy "movements_insert" on movements for insert with check (auth.role() = 'authenticated');
create policy "movements_update" on movements for update using (created_by = auth.uid());
create policy "movements_delete" on movements for delete using (created_by = auth.uid());

-- USER_ROLES: ทุกคนอ่านได้, สมัครตัวเองได้, admin แก้ role คนอื่นได้
create policy "roles_read"   on user_roles for select using (auth.role() = 'authenticated');
create policy "roles_insert" on user_roles for insert with check (user_id = auth.uid());
create policy "roles_update" on user_roles for update using (get_my_role() = 'admin');
create policy "roles_delete" on user_roles for delete using (get_my_role() = 'admin');

-- PENDING_ROLES: admin จัดการ, ทุกคนอ่านได้
create policy "pending_read"   on pending_roles for select using (auth.role() = 'authenticated');
create policy "pending_write"  on pending_roles for all    using (get_my_role() = 'admin');
create policy "pending_delete_self" on pending_roles for delete using (auth.role() = 'authenticated');

-- ============================================================
-- TRIGGER: auto-update updated_at
-- ============================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger employees_updated_at before update on employees for each row execute function set_updated_at();
create trigger movements_updated_at before update on movements for each row execute function set_updated_at();

-- ============================================================
-- REALTIME: เปิด realtime สำหรับตารางที่ต้องการ
-- ============================================================
alter publication supabase_realtime add table movements;
alter publication supabase_realtime add table employees;
alter publication supabase_realtime add table user_roles;
