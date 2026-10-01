-- ============================================================================
-- ทะเบียนเลขที่เอกสาร HR (หมวด "งานเอกสาร HR")
--   แทนไฟล์ "01 ลำดับเอกสาร HR.xlsx"
--
-- วิธีใช้: Supabase Dashboard > SQL Editor > วางทั้งไฟล์ > Run (รันซ้ำได้)
--
-- เลขที่เอกสาร:  <prefix>-<ลำดับ 3 หลัก>-<ปี ค.ศ.>   เช่น HR-115-2026 · Memo-HR-002-2026
--   ลำดับเริ่ม 001 ใหม่ทุกปี · แต่ละชุด (series) นับแยกกัน
--
-- ⚠️ ออกเลขได้ทางเดียวคือฟังก์ชัน doc_issue() — ล็อกชุด+ปีไว้ระหว่างออก
--    สองคนกดพร้อมกันจึงได้เลขต่อกัน ไม่มีทางได้เลขซ้ำ (ที่ Excel พลาดได้)
-- ⚠️ เลขที่ออกแล้วลบไม่ได้และไม่นำกลับมาใช้ใหม่ — ออกผิดให้ "ยกเลิก" พร้อมเหตุผล
--    ทะเบียนต้องตรวจย้อนหลังได้ว่าเลขแต่ละเลขเคยออกให้อะไร
-- ============================================================================

-- ------------------------------------------------------------ 1. ชุดเลข
create table if not exists doc_series (
  code        text primary key,                 -- 'HR' | 'MEMO'
  label       text not null,
  prefix      text not null,                    -- ข้อความหน้าลำดับ เช่น 'HR' → HR-115-2026
  sort_order  int not null default 100,
  is_active   boolean not null default true
);
insert into doc_series (code, label, prefix, sort_order) values
  ('HR',   'หนังสือ HR',     'HR',      1),
  ('MEMO', 'บันทึกภายใน (Memo)', 'Memo-HR', 2)
on conflict (code) do update set label = excluded.label, prefix = excluded.prefix;

-- ------------------------------------------------------------ 2. ประเภทเอกสาร
create table if not exists doc_types (
  id           bigint generated always as identity primary key,
  series_code  text not null references doc_series(code),
  label        text not null,
  -- เผื่อเฟสถัดไป: ระบบสร้างตัวหนังสือจากแบบ (หนังสือรับรอง / Offer Letter) — ว่าง = ยังไม่มีแบบ
  template_key text,
  sort_order   int not null default 100,
  is_active    boolean not null default true,
  unique (series_code, label)
);
insert into doc_types (series_code, label, sort_order) values
  ('HR', 'หนังสือรับรองการทำงาน (ภาษาไทย)',     10),
  ('HR', 'หนังสือรับรองการทำงาน (ภาษาอังกฤษ)',  11),
  ('HR', 'หนังสือรับรองเงินเดือน (ภาษาไทย)',    20),
  ('HR', 'หนังสือรับรองเงินเดือน (ภาษาอังกฤษ)', 21),
  ('HR', 'Offer Letter (จดหมายจ้างงาน)',        30),
  ('HR', 'หนังสือเลิกจ้าง (Terminate)',          40),
  ('HR', 'หนังสือปรับตำแหน่ง',                  50),
  ('HR', 'หนังสือปรับเงินเดือน',                51),
  ('HR', 'แจ้งผลนักศึกษาฝึกงาน',                60),
  ('HR', 'อื่น ๆ',                              99),
  ('MEMO', 'บันทึกภายใน',                       10)
on conflict (series_code, label) do nothing;

-- ------------------------------------------------------------ 3. ทะเบียน
create table if not exists doc_register (
  id           bigint generated always as identity primary key,
  series_code  text not null references doc_series(code),
  year         int  not null,                    -- ปี ค.ศ.
  seq          int  not null check (seq > 0),
  doc_no       text not null unique,             -- เลขเต็ม เก็บไว้ค้นหา/อ้างอิงตรง ๆ
  type_id      bigint references doc_types(id),
  type_label   text,                             -- สำเนาชื่อประเภท ณ วันออก (เปลี่ยนชื่อประเภททีหลัง ทะเบียนเก่าไม่เพี้ยน)
  subject      text,                             -- เรื่อง / รายละเอียด
  emp_code     text,                             -- ถ้าออกให้พนักงาน
  person_name  text,                             -- ชื่อผู้รับ (พนักงาน หรือคนนอก เช่น ผู้สมัคร มหาวิทยาลัย)
  issued_date  date,
  ref_doc_no   text,                             -- อ้างอิงเอกสารเลขอื่น
  note         text,
  batch_id     uuid,                             -- ออกพร้อมกันหลายเลขในครั้งเดียว
  status       text not null default 'active' check (status in ('active','void')),
  void_reason  text,
  voided_at    timestamptz, voided_by uuid,
  imported     boolean not null default false,   -- มาจากไฟล์ Excel เดิม
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  unique (series_code, year, seq)
);
create index if not exists doc_register_year_idx on doc_register (series_code, year, seq desc);

drop trigger if exists doc_register_updated_at on doc_register;
create trigger doc_register_updated_at before update on doc_register
  for each row execute function set_updated_at();

-- เลขที่ ชุด ปี ลำดับ แก้ไม่ได้หลังออกแล้ว — แก้ได้แค่รายละเอียด / ยกเลิก
create or replace function doc_register_guard() returns trigger language plpgsql as $$
begin
  if new.doc_no <> old.doc_no or new.series_code <> old.series_code
     or new.year <> old.year or new.seq <> old.seq then
    raise exception 'เลขที่เอกสารที่ออกแล้วแก้ไม่ได้ — ถ้าออกผิดให้ยกเลิกแล้วออกเลขใหม่';
  end if;
  if old.status = 'void' and new.status <> 'void' then
    raise exception 'เลขที่ยกเลิกแล้วนำกลับมาใช้ไม่ได้';
  end if;
  return new;
end $$;
drop trigger if exists doc_register_guard on doc_register;
create trigger doc_register_guard before update on doc_register
  for each row execute function doc_register_guard();

-- ------------------------------------------------------------ 4. RLS
alter table doc_series   enable row level security;
alter table doc_types    enable row level security;
alter table doc_register enable row level security;

drop policy if exists "doc_series_read"  on doc_series;
drop policy if exists "doc_types_read"   on doc_types;
drop policy if exists "doc_types_write"  on doc_types;
drop policy if exists "doc_reg_read"     on doc_register;
drop policy if exists "doc_reg_update"   on doc_register;
create policy "doc_series_read" on doc_series for select using (has_perm('page.docregister'));
create policy "doc_types_read"  on doc_types  for select using (has_perm('page.docregister'));
create policy "doc_types_write" on doc_types  for all
  using (has_perm('data.docregister.write')) with check (has_perm('data.docregister.write'));
create policy "doc_reg_read"    on doc_register for select using (has_perm('page.docregister'));
create policy "doc_reg_update"  on doc_register for update using (has_perm('data.docregister.write'));
-- ไม่มี insert/delete policy โดยตั้งใจ: ออกเลขผ่าน doc_issue() / นำเข้าผ่าน doc_import() เท่านั้น · ลบไม่ได้เลย

-- ------------------------------------------------------------ 5. ออกเลข
-- p_count เลขต่อกันในครั้งเดียว (เช่น หนังสือปรับตำแหน่ง 38 ฉบับ)
-- p_people (ไม่บังคับ): [{emp_code, person_name}, ...] ยาวเท่า p_count → ใส่ชื่อให้แต่ละเลข
create or replace function doc_issue(p_series text, p_count int, p_type_id bigint, p_subject text,
                                     p_issued_date date, p_ref text, p_note text, p_people jsonb)
returns setof doc_register language plpgsql security definer set search_path = public as $$
declare
  y int := extract(year from coalesce(p_issued_date, current_date))::int;
  pre text; start int; tl text; b uuid := gen_random_uuid(); i int; p jsonb;
begin
  if not has_perm('data.docregister.write') then raise exception 'ไม่มีสิทธิ์ออกเลขเอกสาร'; end if;
  if p_count is null or p_count < 1 or p_count > 500 then raise exception 'จำนวนต้องอยู่ระหว่าง 1–500'; end if;
  select prefix into pre from doc_series where code = p_series and is_active;
  if pre is null then raise exception 'ไม่พบชุดเลข %', p_series; end if;
  select label into tl from doc_types where id = p_type_id;

  -- ล็อกชุด+ปีนี้จนจบธุรกรรม — คนที่กดพร้อมกันจะรอคิวแล้วได้เลขถัดไป
  perform pg_advisory_xact_lock(hashtext('doc_issue:' || p_series || ':' || y));
  select coalesce(max(seq), 0) + 1 into start from doc_register where series_code = p_series and year = y;

  for i in 0 .. p_count - 1 loop
    p := case when p_people is not null and jsonb_typeof(p_people) = 'array' then p_people -> i end;
    return query
    insert into doc_register (series_code, year, seq, doc_no, type_id, type_label, subject,
                              emp_code, person_name, issued_date, ref_doc_no, note, batch_id, created_by)
    values (p_series, y, start + i, format('%s-%s-%s', pre, lpad((start + i)::text, 3, '0'), y),
            p_type_id, tl, nullif(trim(p_subject), ''),
            nullif(trim(p ->> 'emp_code'), ''), nullif(trim(p ->> 'person_name'), ''),
            coalesce(p_issued_date, current_date), nullif(trim(p_ref), ''), nullif(trim(p_note), ''),
            case when p_count > 1 then b end, auth.uid())
    returning *;
  end loop;
end $$;
revoke all on function doc_issue(text, int, bigint, text, date, text, text, jsonb) from public, anon;
grant execute on function doc_issue(text, int, bigint, text, date, text, text, jsonb) to authenticated;

-- ------------------------------------------------------------ 6. นำเข้าประวัติจาก Excel เดิม
-- รับเลขที่ตามไฟล์ (ไม่ออกเลขใหม่) · เลขที่มีอยู่แล้วข้าม — นำเข้าซ้ำได้ไม่เบิ้ล
create or replace function doc_import(p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; pre text;
begin
  if not has_perm('data.docregister.write') then raise exception 'ไม่มีสิทธิ์นำเข้า'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    select prefix into pre from doc_series where code = r ->> 'series_code';
    if pre is null then continue; end if;
    insert into doc_register (series_code, year, seq, doc_no, type_id, type_label, subject, person_name,
                              issued_date, ref_doc_no, note, imported, created_by)
    values (r ->> 'series_code', (r ->> 'year')::int, (r ->> 'seq')::int,
            format('%s-%s-%s', pre, lpad(r ->> 'seq', 3, '0'), r ->> 'year'),
            (select id from doc_types t where t.series_code = r ->> 'series_code' and t.label = r ->> 'type_label'),
            r ->> 'type_label', nullif(r ->> 'subject', ''), nullif(r ->> 'person_name', ''),
            nullif(r ->> 'issued_date', '')::date, nullif(r ->> 'ref_doc_no', ''), nullif(r ->> 'note', ''),
            true, auth.uid())
    on conflict do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function doc_import(jsonb) from public, anon;
grant execute on function doc_import(jsonb) to authenticated;

-- ------------------------------------------------------------ 7. สิทธิ์
insert into permissions (key, category, label, description, sort_order) values
  ('page.docregister',       'page', 'ทะเบียนเลขที่เอกสาร', 'ดูทะเบียนเลขที่หนังสือ HR และ Memo', 25),
  ('data.docregister.write', 'data', 'ออกเลขเอกสาร',       'ออกเลข แก้รายละเอียด ยกเลิกเลข นำเข้าประวัติ', 43)
on conflict (key) do update
  set label = excluded.label, description = excluded.description, sort_order = excluded.sort_order;

insert into role_permissions (role_key, perm_key)
select r.key, p.key from app_roles r
  cross join (values ('page.docregister'),('data.docregister.write')) as p(key)
where r.key in ('admin','hr')
on conflict do nothing;
