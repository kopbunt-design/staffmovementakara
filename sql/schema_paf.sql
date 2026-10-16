-- ============================================================================
-- Personnel Action Form (แบบปฏิบัติการด้านทรัพยากรบุคคล) — AKR-OHR-FM-031 Rev. 00 · user 2026-10-16
--   วิธีใช้: Supabase Dashboard > SQL Editor > วางทั้งไฟล์ > Run (รันซ้ำได้) · ต้องรัน schema_doc_register.sql มาก่อน
--
--   ลำดับ: HR ยื่น → ขั้น 1 HR Manager → ขั้น 2 GM (ผู้อนุมัติแต่ละขั้นเลือกตอนส่ง จากรายชื่อในหน้าตั้งค่า)
--   ผู้อนุมัติกดจากลิงก์ในอีเมล ไม่ต้อง login (/paf/approve.html?t=<token>) — ไม่ต้องมีบัญชีในระบบ
--   เลขที่: ชุด PAF ในทะเบียนเลขที่เอกสาร (PAF-001-2026) ออกตอนส่งครั้งแรก · ส่งกลับแก้แล้วส่งใหม่ใช้เลขเดิม
--   อนุมัติครบ → สร้างรายการ Movement + อัปเดตทะเบียนพนักงานให้อัตโนมัติ (paf_apply)
--   พนักงานลงนามรับทราบบนกระดาษ — HR บันทึกวันที่รับทราบในระบบ
-- ============================================================================

-- ------------------------------------------------------------ 1. ชุดเลข PAF ในทะเบียนเลขที่เอกสาร
insert into doc_series (code, label, prefix, sort_order) values ('PAF', 'Personnel Action Form', 'PAF', 3)
on conflict (code) do nothing;
insert into doc_types (series_code, label, sort_order) values ('PAF', 'Personnel Action Form', 10)
on conflict (series_code, label) do nothing;

-- ------------------------------------------------------------ 2. ผู้อนุมัติ (ตั้งในหน้า PAF → ตั้งค่า) — ไม่ต้องเป็นผู้ใช้ระบบ
create table if not exists paf_approvers (
  id         bigint generated always as identity primary key,
  step       int  not null check (step in (1, 2)),          -- 1 = HR Manager · 2 = General Manager
  name_th    text not null,
  name_en    text,
  title_th   text,                                          -- ตำแหน่ง (แสดงในบันทึกการอนุมัติ)
  title_en   text,
  emp_code   text,
  email      text not null,
  is_default boolean not null default false,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------ 3. แบบฟอร์ม
create table if not exists paf_forms (
  id            bigint generated always as identity primary key,
  status        text not null default 'draft' check (status in ('draft','pending','approved','rejected','cancelled')),
  doc_id        bigint references doc_register(id),
  doc_no        text,
  -- พนักงาน (สำเนา ณ ตอนทำ = สภาพการจ้างเดิม)
  emp_code      text not null,
  name_th       text, name_en text,
  division      text, department text, section text, team text, position text, job_level text,
  salary_from   numeric,
  -- สิ่งที่เปลี่ยน · ว่าง = ไม่เปลี่ยน
  salary_to     numeric,
  position_to   text, job_level_to text, division_to text, department_to text, section_to text, team_to text,
  subject_th    text, subject_en text,
  note_th       text, note_en text,                        -- เหตุผล/หมายเหตุ ใต้สภาพการจ้างใหม่
  effective_date date,
  mov_type      text check (mov_type is null or mov_type in ('Transfer','Promotion','Demotion','Salary Adjustment','none')),
  -- ผู้อนุมัติ: [{step, label, name_th, name_en, title_th, title_en, emp_code, email}] · สำเนา ณ ตอนส่ง
  steps         jsonb not null default '[]',
  cur_step      int,
  requested_by  uuid, requested_name text, requested_email text, requested_at timestamptz,
  approved_at   timestamptz,
  reject_reason text,
  ack_date      date,                                      -- พนักงานลงนามรับทราบ (บนกระดาษ)
  movement_id   uuid,
  cancel_reason text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists paf_status_idx on paf_forms (status, created_at desc);

-- บันทึกการอนุมัติ (แสดงในใบ) — เขียนได้ทางฟังก์ชันเท่านั้น
create table if not exists paf_log (
  id           bigint generated always as identity primary key,
  paf_id       bigint not null references paf_forms(id) on delete cascade,
  at           timestamptz not null default now(),
  action       text not null check (action in ('submit','approve','reject','cancel','ack')),
  step         int,
  actor_name   text,
  actor_detail text,                                       -- รหัสพนักงาน · ตำแหน่ง
  remark       text,
  via          text                                        -- 'email_link' | 'app'
);
create index if not exists paf_log_idx on paf_log (paf_id, at);

-- ลิงก์อนุมัติ (ไม่ต้อง login) — ขั้นละลิงก์ ใช้ได้ครั้งเดียว 14 วัน · ไม่มี policy → อ่านได้เฉพาะฟังก์ชัน/Edge Function
create table if not exists paf_tokens (
  paf_id     bigint not null references paf_forms(id) on delete cascade,
  step       int not null,
  token      text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  primary key (paf_id, step)
);
alter table paf_tokens enable row level security;
revoke all on paf_tokens from anon, authenticated;

-- เนื้อหาแก้ได้เฉพาะร่าง/ส่งกลับ · สถานะ เลขที่ ผู้อนุมัติ เปลี่ยนผ่านฟังก์ชัน paf_* เท่านั้น
create or replace function paf_guard() returns trigger language plpgsql as $$
begin
  if current_setting('paf.flow', true) = 'on' then return new; end if;
  if (new.status, new.doc_id, new.doc_no, new.steps, new.cur_step, new.approved_at, new.movement_id, new.requested_by)
     is distinct from (old.status, old.doc_id, old.doc_no, old.steps, old.cur_step, old.approved_at, old.movement_id, old.requested_by) then
    raise exception 'สถานะ/เลขที่/ผู้อนุมัติ เปลี่ยนได้ผ่านปุ่มในระบบเท่านั้น';
  end if;
  if old.status not in ('draft','rejected')
     and (to_jsonb(new) - 'updated_at' - 'ack_date') is distinct from (to_jsonb(old) - 'updated_at' - 'ack_date') then
    raise exception 'PAF ที่ส่งอนุมัติแล้วแก้เนื้อหาไม่ได้ — ให้ผู้อนุมัติส่งกลับ หรือยกเลิกแล้วทำฉบับใหม่';
  end if;
  return new;
end $$;
drop trigger if exists paf_guard on paf_forms;
create trigger paf_guard before update on paf_forms for each row execute function paf_guard();

-- ------------------------------------------------------------ 4. RLS (มีเงินเดือน → เฉพาะผู้มีสิทธิ์ทำ PAF)
alter table paf_approvers enable row level security;
alter table paf_forms     enable row level security;
alter table paf_log       enable row level security;
drop policy if exists "paf_appr_read"  on paf_approvers;
drop policy if exists "paf_appr_write" on paf_approvers;
drop policy if exists "paf_read"   on paf_forms;
drop policy if exists "paf_insert" on paf_forms;
drop policy if exists "paf_update" on paf_forms;
drop policy if exists "paf_log_read" on paf_log;
create policy "paf_appr_read"  on paf_approvers for select using (has_perm('data.paf.write'));
create policy "paf_appr_write" on paf_approvers for all using (has_perm('data.paf.write')) with check (has_perm('data.paf.write'));
create policy "paf_read"   on paf_forms for select using (has_perm('data.paf.write'));
create policy "paf_insert" on paf_forms for insert with check (has_perm('data.paf.write'));
create policy "paf_update" on paf_forms for update using (has_perm('data.paf.write')) with check (has_perm('data.paf.write'));
create policy "paf_log_read" on paf_log for select using (has_perm('data.paf.write'));

-- ------------------------------------------------------------ 5. ขั้นตอน
create or replace function paf_issue_token(p_id bigint, p_step int) returns void
language sql security definer set search_path = public as $$
  insert into paf_tokens (paf_id, step, token, expires_at)
  values (p_id, p_step, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), now() + interval '14 days')
  on conflict (paf_id, step) do update set token = excluded.token, expires_at = excluded.expires_at, used_at = null, created_at = now();
$$;
revoke all on function paf_issue_token(bigint, int) from public, anon, authenticated;

-- ส่งอนุมัติ: p_steps = [{step:1, ...ผู้อนุมัติ}, {step:2, ...}] · ออกเลขครั้งแรก · ส่งใหม่หลังถูกส่งกลับใช้เลขเดิม
create or replace function paf_submit(p_id bigint, p_steps jsonb) returns paf_forms
language plpgsql security definer set search_path = public as $$
declare f paf_forms; d doc_register; tid bigint; me text; s jsonb;
begin
  if not has_perm('data.paf.write') then raise exception 'ไม่มีสิทธิ์ทำ PAF'; end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) <> 2 then raise exception 'เลือกผู้อนุมัติให้ครบ 2 ขั้น'; end if;
  for s in select * from jsonb_array_elements(p_steps) loop
    if coalesce(trim(s->>'email'), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'ผู้อนุมัติ % ไม่มีอีเมล', coalesce(s->>'name_th', ''); end if;
  end loop;
  select * into f from paf_forms where id = p_id for update;
  if f.id is null then raise exception 'ไม่พบ PAF'; end if;
  if f.status not in ('draft','rejected') then raise exception 'PAF นี้ส่งไปแล้ว'; end if;
  if f.effective_date is null then raise exception 'กรอกวันที่มีผล'; end if;
  if f.doc_id is null then
    select id into tid from doc_types where series_code = 'PAF' order by sort_order limit 1;
    select * into d from doc_issue('PAF', 1, tid, f.subject_th, current_date, null, 'ออกจากระบบ Personnel Action Form',
                                   jsonb_build_array(jsonb_build_object('emp_code', f.emp_code, 'person_name', f.name_th)));
    f.doc_id := d.id; f.doc_no := d.doc_no;
  end if;
  select coalesce(nullif(g.name_th, ''), nullif(r.name, ''), u.email) into me
    from auth.users u left join letter_signers g on g.user_id = u.id left join user_roles r on r.user_id = u.id where u.id = auth.uid();
  perform set_config('paf.flow', 'on', true);
  update paf_forms set status = 'pending', doc_id = f.doc_id, doc_no = f.doc_no, steps = p_steps, cur_step = 1,
         requested_by = auth.uid(), requested_name = me, requested_email = (select email from auth.users where id = auth.uid()),
         requested_at = now(), reject_reason = null, approved_at = null, updated_at = now()
   where id = p_id returning * into f;
  insert into paf_log (paf_id, action, step, actor_name, actor_detail, via)
  values (p_id, 'submit', 0, me, (select nullif(g.title_th, '') from letter_signers g where g.user_id = auth.uid()), 'app');
  delete from paf_tokens where paf_id = p_id;
  perform paf_issue_token(p_id, 1);
  return f;
end $$;

-- อนุมัติครบ → Movement + อัปเดตทะเบียนพนักงาน (ภายในเท่านั้น)
create or replace function paf_apply(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare f paf_forms; mid uuid; frm text; dst text;
begin
  select * into f from paf_forms where id = p_id;
  if f.mov_type is null or f.mov_type = 'none' then return; end if;
  frm := concat_ws(' / ', nullif(f.department, ''), nullif(f.position, ''));
  dst := concat_ws(' / ', coalesce(nullif(f.department_to, ''), nullif(f.department, '')), coalesce(nullif(f.position_to, ''), nullif(f.position, '')));
  insert into movements (emp_code, name, type, date, from_dept, to_dept, reason, salary, job_level, recorded_by, created_by)
  values (f.emp_code, coalesce(f.name_th, f.emp_code), f.mov_type, f.effective_date, nullif(frm, ''), nullif(dst, ''),
          concat_ws(' · ', f.doc_no, nullif(f.subject_th, '')), f.salary_to, nullif(f.job_level_to, ''), concat('PAF ', f.doc_no), f.requested_by)
  returning id into mid;
  update employees set
    position   = coalesce(nullif(f.position_to, ''), position),
    job_level  = coalesce(nullif(f.job_level_to, ''), job_level),
    division   = coalesce(nullif(f.division_to, ''), division),
    department = coalesce(nullif(f.department_to, ''), department),
    section    = coalesce(nullif(f.section_to, ''), section),
    team       = coalesce(nullif(f.team_to, ''), team),
    salary     = coalesce(f.salary_to, salary),
    effective_date = f.effective_date,
    updated_at = now()
   where emp_code = f.emp_code;
  update paf_forms set movement_id = mid where id = p_id;
end $$;
revoke all on function paf_apply(bigint) from public, anon, authenticated;

-- หน้าอนุมัติ (ไม่ login): state = open | expired | closed
create or replace function paf_link_get(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t paf_tokens; f paf_forms;
begin
  if coalesce(length(p_token), 0) < 40 then return jsonb_build_object('error', 'ลิงก์ไม่ถูกต้อง'); end if;
  select * into t from paf_tokens where token = p_token;
  if t.paf_id is null then return jsonb_build_object('error', 'ลิงก์ไม่ถูกต้อง หรือมีการส่งลิงก์ใหม่แทนแล้ว'); end if;
  select * into f from paf_forms where id = t.paf_id;
  return (to_jsonb(f) - 'requested_email' - 'created_by' - 'requested_by') || jsonb_build_object(
    'state', case when f.status = 'pending' and f.cur_step = t.step and t.used_at is null and t.expires_at > now() then 'open'
                  when f.status = 'pending' and f.cur_step = t.step and t.used_at is null then 'expired' else 'closed' end,
    'link_step', t.step, 'expires_at', t.expires_at,
    'log', coalesce((select jsonb_agg(to_jsonb(l) - 'paf_id' order by l.at, l.id) from paf_log l where l.paf_id = f.id), '[]'::jsonb));
end $$;

-- กดอนุมัติ / ส่งกลับจากลิงก์ — ในนามผู้อนุมัติของขั้นนั้น
create or replace function paf_link_decide(p_token text, p_ok boolean, p_remark text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t paf_tokens; f paf_forms; a jsonb; n int;
begin
  select * into t from paf_tokens where token = p_token for update;
  if t.paf_id is null then raise exception 'ลิงก์ไม่ถูกต้อง หรือมีการส่งลิงก์ใหม่แทนแล้ว'; end if;
  if t.used_at is not null then raise exception 'ลิงก์นี้ใช้ไปแล้ว'; end if;
  if t.expires_at <= now() then raise exception 'ลิงก์หมดอายุแล้ว — ติดต่อ HR ให้ส่งลิงก์ใหม่'; end if;
  select * into f from paf_forms where id = t.paf_id for update;
  if f.status <> 'pending' or f.cur_step is distinct from t.step then raise exception 'PAF นี้ไม่ได้รอการพิจารณาขั้นนี้แล้ว'; end if;
  a := (select x from jsonb_array_elements(f.steps) x where (x->>'step')::int = t.step limit 1);
  n := jsonb_array_length(f.steps);
  if not p_ok and nullif(trim(p_remark), '') is null then raise exception 'กรุณาระบุเหตุผลที่ส่งกลับ'; end if;
  perform set_config('paf.flow', 'on', true);
  insert into paf_log (paf_id, action, step, actor_name, actor_detail, remark, via)
  values (f.id, case when p_ok then 'approve' else 'reject' end, t.step, a->>'name_th',
          nullif(concat_ws(' · ', nullif(a->>'emp_code', ''), nullif(a->>'title_th', '')), ''), nullif(trim(p_remark), ''), 'email_link');
  update paf_tokens set used_at = now() where paf_id = f.id and step = t.step;
  if not p_ok then
    update paf_forms set status = 'rejected', reject_reason = trim(p_remark), cur_step = null, updated_at = now() where id = f.id;
  elsif t.step < n then
    update paf_forms set cur_step = t.step + 1, updated_at = now() where id = f.id;
    perform paf_issue_token(f.id, t.step + 1);
  else
    update paf_forms set status = 'approved', cur_step = null, approved_at = now(), updated_at = now() where id = f.id;
    perform paf_apply(f.id);
  end if;
  select * into f from paf_forms where id = f.id;
  -- กระดิ่งในระบบ HR (ไม่มีชื่อ/เงินเดือน — แค่เลขที่) · โหมด Outlook ใช้รู้ว่าต้องส่งเมลขอขั้นถัดไป
  insert into notifications (title, detail, category, created_by, link)
  values (case when f.status = 'approved' then 'PAF อนุมัติครบแล้ว' when f.status = 'rejected' then 'PAF ถูกส่งกลับแก้ไข'
               else 'PAF ผ่านขั้น ' || t.step || ' แล้ว — ส่งขอขั้นถัดไป' end, f.doc_no, 'default', f.requested_by, 'paf?paf=' || f.id);
  return jsonb_build_object('status', f.status, 'cur_step', f.cur_step, 'doc_no', f.doc_no, 'name', f.name_th);
end $$;

-- ลิงก์ของขั้นที่รออยู่ — ให้ HR ใส่ในไฟล์เมล (.eml) / ส่งเตือน
create or replace function paf_pending_link(p_id bigint) returns text
language sql stable security definer set search_path = public as $$
  select t.token from paf_tokens t join paf_forms f on f.id = t.paf_id
   where f.id = p_id and f.status = 'pending' and t.step = f.cur_step and t.used_at is null and t.expires_at > now()
     and has_perm('data.paf.write');
$$;
-- ออกลิงก์ใหม่ให้ขั้นที่รออยู่ (ลิงก์เดิมหมดอายุ / ส่งผิดคน)
create or replace function paf_renew_link(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare f paf_forms;
begin
  if not has_perm('data.paf.write') then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into f from paf_forms where id = p_id;
  if f.status <> 'pending' then raise exception 'PAF นี้ไม่ได้รออนุมัติ'; end if;
  perform paf_issue_token(p_id, f.cur_step);
  return (select token from paf_tokens where paf_id = p_id and step = f.cur_step);
end $$;

create or replace function paf_cancel(p_id bigint, p_reason text) returns paf_forms
language plpgsql security definer set search_path = public as $$
declare f paf_forms;
begin
  if not has_perm('data.paf.write') then raise exception 'ไม่มีสิทธิ์'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'ระบุเหตุผลที่ยกเลิก'; end if;
  select * into f from paf_forms where id = p_id for update;
  if f.status in ('approved','cancelled') then raise exception 'PAF ที่อนุมัติแล้ว/ยกเลิกแล้ว ยกเลิกไม่ได้'; end if;
  perform set_config('paf.flow', 'on', true);
  update paf_forms set status = 'cancelled', cancel_reason = trim(p_reason), cur_step = null, updated_at = now() where id = p_id returning * into f;
  delete from paf_tokens where paf_id = p_id;
  insert into paf_log (paf_id, action, actor_name, remark, via)
  values (p_id, 'cancel', (select coalesce(nullif(g.name_th, ''), u.email) from auth.users u left join letter_signers g on g.user_id = u.id where u.id = auth.uid()), trim(p_reason), 'app');
  -- เลขที่ที่ออกไปแล้วยกเลิกในทะเบียนด้วย (ไม่นำกลับมาใช้)
  if f.doc_id is not null then
    update doc_register set status = 'void', void_reason = 'ยกเลิก PAF: ' || trim(p_reason), voided_at = now(), voided_by = auth.uid()
     where id = f.doc_id and status = 'active';
  end if;
  return f;
end $$;

-- พนักงานลงนามรับทราบบนกระดาษแล้ว
create or replace function paf_ack(p_id bigint, p_date date) returns paf_forms
language plpgsql security definer set search_path = public as $$
declare f paf_forms;
begin
  if not has_perm('data.paf.write') then raise exception 'ไม่มีสิทธิ์'; end if;
  update paf_forms set ack_date = p_date, updated_at = now() where id = p_id and status = 'approved' returning * into f;
  if f.id is null then raise exception 'บันทึกรับทราบได้เฉพาะ PAF ที่อนุมัติแล้ว'; end if;
  insert into paf_log (paf_id, action, actor_name, remark, via) values (p_id, 'ack', f.name_th, 'พนักงานลงนามรับทราบ ' || to_char(p_date, 'DD/MM/YYYY'), 'app');
  return f;
end $$;

revoke all on function paf_submit(bigint, jsonb), paf_link_get(text), paf_link_decide(text, boolean, text),
  paf_pending_link(bigint), paf_renew_link(bigint), paf_cancel(bigint, text), paf_ack(bigint, date) from public;
grant execute on function paf_link_get(text), paf_link_decide(text, boolean, text) to anon, authenticated;
grant execute on function paf_submit(bigint, jsonb), paf_pending_link(bigint), paf_renew_link(bigint), paf_cancel(bigint, text), paf_ack(bigint, date) to authenticated;

-- ------------------------------------------------------------ 6. สิทธิ์
insert into permissions (key, category, label, description, sort_order) values
  ('page.paf',       'page', 'Personnel Action Form', 'ทำ PAF ส่งอนุมัติ HR Manager → GM', 27),
  ('data.paf.write', 'data', 'ทำ PAF',                'สร้าง แก้ ส่งอนุมัติ พิมพ์ PAF (เห็นเงินเดือนใน PAF) — ต้องมีสิทธิ์ออกเลขเอกสารด้วย', 45)
on conflict (key) do update set label = excluded.label, description = excluded.description, sort_order = excluded.sort_order;
insert into role_permissions (role_key, perm_key)
select r.key, p.key from app_roles r cross join (values ('page.paf'), ('data.paf.write')) as p(key)
where r.key = 'admin' on conflict do nothing;

-- ------------------------------------------------------------ 7. แบบอีเมล (แก้ได้ในหน้า PAF → ตั้งค่า)
-- ตาราง mail_templates จำกัดชื่อแบบไว้ — ชุดเดียวกับ schema_expense / schema_fund_approval / schema_emp_contract (เพิ่มแบบใหม่ต้องแก้ทุกไฟล์)
alter table mail_templates drop constraint if exists mail_templates_key_check;
alter table mail_templates add constraint mail_templates_key_check
  check (key in ('request','approved','rejected','fund_request','fund_approved','fund_rejected','exp_review','exp_approve','exp_approved','exp_rejected','ec_sign','ec_signed','ec_rejected','paf_request','paf_approved','paf_rejected'));
insert into mail_templates (key, label, subject, html) values
  ('paf_request', 'ขออนุมัติ PAF', '[ขออนุมัติ] {{doc_no}} {{kind}} — {{person}}',
   '<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;color:#1e293b"><p><b>มี Personnel Action Form รอการพิจารณาจากท่าน</b></p><p>เลขที่ <b>{{doc_no}}</b> · {{kind}} · {{person}} {{emp_code}}</p><p><a href="{{link}}">เปิด PAF เพื่ออนุมัติ</a> (ไม่ต้องเข้าสู่ระบบ · ลิงก์ใช้ได้ครั้งเดียว)</p><p style="color:#64748b;font-size:12px">ส่งโดย {{requester}}</p></div>'),
  ('paf_approved', 'แจ้ง PAF อนุมัติครบแล้ว', '[อนุมัติแล้ว] {{doc_no}} — {{person}}',
   '<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px"><p><b>PAF อนุมัติครบทุกขั้นแล้ว</b> — ระบบบันทึก Movement และอัปเดตทะเบียนพนักงานให้แล้ว</p><p>{{doc_no}} · {{kind}} · {{person}}</p><p><a href="{{link}}">เปิด PAF เพื่อพิมพ์ให้พนักงานลงนามรับทราบ</a></p></div>'),
  ('paf_rejected', 'แจ้ง PAF ส่งกลับแก้ไข', '[ส่งกลับแก้ไข] {{doc_no}} — {{person}}',
   '<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px"><p><b>PAF ถูกส่งกลับให้แก้ไข</b> โดย {{approver}}</p><p>{{doc_no}} · {{kind}} · {{person}}</p><p>เหตุผล: {{reason}}</p><p><a href="{{link}}">เปิด PAF</a></p></div>')
on conflict (key) do nothing;

-- ============================================================================
-- สิทธิ์ลายเซ็น + แบบอีเมลรวมทุกระบบ — ชุดเดียวกันทุกไฟล์ (schema_hr_letters / schema_fund_approval / schema_expense / schema_contract_web / schema_emp_contract / schema_paf)
-- ============================================================================
drop policy if exists "mt_read"  on mail_templates;
drop policy if exists "mt_write" on mail_templates;
create policy "mt_read"  on mail_templates for select using (has_perm('page.letters') or (key like 'fund\_%' and has_perm('page.fundforms')) or (key like 'exp\_%' and has_perm('page.expense')) or (key like 'ec\_%' and has_perm('data.empcontract.write')) or (key like 'paf\_%' and has_perm('data.paf.write')));
create policy "mt_write" on mail_templates for update using (has_perm('data.letters.approve') or (key like 'fund\_%' and has_perm('data.fundforms.write')) or (key like 'exp\_%' and has_perm('data.expense.write')) or (key like 'ec\_%' and has_perm('data.empcontract.write')) or (key like 'paf\_%' and has_perm('data.paf.write')));
drop policy if exists "ls_read" on letter_signers;
create policy "ls_read" on letter_signers for select using (has_perm('page.letters') or has_perm('page.fundforms') or has_perm('page.expense')
  or has_perm('page.contractpay') or has_perm('data.contract.approve') or has_perm('page.empcontract') or has_perm('data.empcontract.sign'));
drop policy if exists "la_read" on storage.objects;
create policy "la_read" on storage.objects for select
  using (bucket_id = 'letter-assets' and (has_perm('data.letters.write') or has_perm('data.letters.approve')
         or has_perm('page.fundforms') or has_perm('page.expense') or has_perm('page.contractpay') or has_perm('data.contract.approve')
         or has_perm('data.empcontract.write') or has_perm('data.empcontract.sign')));
drop policy if exists "ls_write" on letter_signers;
create policy "ls_write" on letter_signers for all
  using ((user_id = auth.uid() and (has_perm('data.letters.approve') or has_perm('data.fundforms.write') or has_perm('data.fundforms.approve')
          or has_perm('data.expense.write') or has_perm('data.expense.review') or has_perm('data.expense.approve') or has_perm('data.contract.approve') or has_perm('data.empcontract.sign'))) or get_my_role() = 'admin')
  with check ((user_id = auth.uid() and (has_perm('data.letters.approve') or has_perm('data.fundforms.write') or has_perm('data.fundforms.approve')
          or has_perm('data.expense.write') or has_perm('data.expense.review') or has_perm('data.expense.approve') or has_perm('data.contract.approve') or has_perm('data.empcontract.sign'))) or get_my_role() = 'admin');
drop policy if exists "la_write"  on storage.objects;
drop policy if exists "la_update" on storage.objects;
drop policy if exists "la_delete" on storage.objects;
create policy "la_write" on storage.objects for insert with check (bucket_id = 'letter-assets' and (
  ((storage.foldername(name))[1] = 'seal' and has_perm('data.letters.approve'))
  or ((storage.foldername(name))[1] = 'signatures' and (get_my_role() = 'admin' or ((storage.foldername(name))[2] = auth.uid()::text
      and (has_perm('data.letters.approve') or has_perm('data.fundforms.write') or has_perm('data.fundforms.approve')
           or has_perm('data.expense.write') or has_perm('data.expense.review') or has_perm('data.expense.approve') or has_perm('data.contract.approve') or has_perm('data.empcontract.sign')))))));
create policy "la_update" on storage.objects for update using (bucket_id = 'letter-assets' and (
  ((storage.foldername(name))[1] = 'seal' and has_perm('data.letters.approve'))
  or ((storage.foldername(name))[1] = 'signatures' and (get_my_role() = 'admin' or ((storage.foldername(name))[2] = auth.uid()::text
      and (has_perm('data.letters.approve') or has_perm('data.fundforms.write') or has_perm('data.fundforms.approve')
           or has_perm('data.expense.write') or has_perm('data.expense.review') or has_perm('data.expense.approve') or has_perm('data.contract.approve') or has_perm('data.empcontract.sign')))))));
create policy "la_delete" on storage.objects for delete using (bucket_id = 'letter-assets' and (
  ((storage.foldername(name))[1] = 'seal' and has_perm('data.letters.approve'))
  or ((storage.foldername(name))[1] = 'signatures' and (get_my_role() = 'admin' or ((storage.foldername(name))[2] = auth.uid()::text
      and (has_perm('data.letters.approve') or has_perm('data.fundforms.write') or has_perm('data.fundforms.approve')
           or has_perm('data.expense.write') or has_perm('data.expense.review') or has_perm('data.expense.approve') or has_perm('data.contract.approve') or has_perm('data.empcontract.sign')))))));

select key, label from permissions where key like '%paf%';
