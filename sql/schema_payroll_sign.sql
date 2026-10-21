-- ============================================================================
-- Payroll Register — เซ็นออนไลน์ (user 2026-10-21)
--   ผู้จัดทำกดส่ง (ลงนามช่องแรกทันที) → ผู้ตรวจ / ผู้อนุมัติ ได้ลิงก์เฉพาะของขั้นตัวเอง กดเซ็นได้โดยไม่ต้อง login
--   ลิงก์ใช้ได้ครั้งเดียว 14 วัน (payroll_sign_tokens ไม่มี policy → อ่านได้เฉพาะฟังก์ชัน/Edge Function)
--   ลายเซ็นมาจาก letter_signers (ชุดเดียวกับหนังสือ HR / Invoice Hub) · ชื่อในรายงานใช้ name_en ก่อน
--   อัปโหลดรายงานเดือนนั้นใหม่ (payroll_period เปลี่ยน) → ลายเซ็นทั้งหมดของเดือนนั้นถูกล้าง ต้องส่งเซ็นใหม่ (user เลือก)
-- รันหลัง schema_payroll_summary.sql / schema_rbac.sql / schema_hr_letters.sql / schema_notifications.sql · รันซ้ำได้
-- ============================================================================

create table if not exists payroll_sign (
  month         text primary key references payroll_period(month) on delete cascade,
  status        text not null check (status in ('pending','approved','rejected')),
  -- [{step, role, dept, user_id, name, title, email, signature_path, signed_at, via}] · step 1 = ผู้จัดทำ
  steps         jsonb not null,
  cur_step      int,
  reject_reason text,
  submitted_by  uuid,
  submitted_at  timestamptz not null default now(),
  approved_at   timestamptz,
  updated_at    timestamptz not null default now()
);

create table if not exists payroll_sign_tokens (
  month      text not null references payroll_sign(month) on delete cascade,
  step       int not null,
  token      text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  primary key (month, step)
);

alter table payroll_sign enable row level security;
alter table payroll_sign_tokens enable row level security;
revoke all on payroll_sign_tokens from anon, authenticated;
drop policy if exists "payroll_sign_read" on payroll_sign;
create policy "payroll_sign_read" on payroll_sign for select using (has_perm('data.payroll.read'));
-- เขียนได้ผ่านฟังก์ชัน pr_* เท่านั้น (ไม่มี policy insert/update/delete)

-- อัปโหลดรายงานใหม่ทับเดือนเดิม = ตัวเลขเปลี่ยน → ลายเซ็นเดิมใช้ไม่ได้ ล้างทิ้ง
create or replace function pr_reset_on_reupload() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.uploaded_at is distinct from old.uploaded_at then delete from payroll_sign where month = new.month; end if;
  return new;
end $$;
drop trigger if exists pr_reset_on_reupload on payroll_period;
create trigger pr_reset_on_reupload after update on payroll_period for each row execute function pr_reset_on_reupload();

-- รายชื่อคนที่เลือกเป็นผู้ตรวจ/ผู้อนุมัติได้ = มีลายเซ็นในระบบแล้ว
create or replace function pr_signers() returns table (user_id uuid, name text, title text, email text)
language sql stable security definer set search_path = public as $$
  select g.user_id, coalesce(nullif(g.name_en, ''), g.name_th), coalesce(nullif(g.title_en, ''), g.title_th),
         coalesce(nullif(g.email, ''), u.email)
    from letter_signers g left join auth.users u on u.id = g.user_id
   where g.signature_path is not null and has_perm('data.payroll.read')
   order by 2;
$$;

create or replace function pr_issue_token(p_month text, p_step int) returns void
language sql security definer set search_path = public as $$
  insert into payroll_sign_tokens (month, step, token, expires_at)
  values (p_month, p_step, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), now() + interval '14 days')
  on conflict (month, step) do update set token = excluded.token, expires_at = excluded.expires_at, used_at = null, created_at = now();
$$;
revoke all on function pr_issue_token(text, int) from public, anon, authenticated;

-- ส่งเซ็น: p_steps = [{role, dept, user_id}] ตามลำดับช่อง · ช่องแรกต้องเป็นคนกดส่ง (ลงนามทันที)
create or replace function pr_submit(p_month text, p_steps jsonb) returns payroll_sign
language plpgsql security definer set search_path = public as $$
declare r payroll_sign; s jsonb := '[]'::jsonb; x jsonb; g letter_signers; i int := 0; n int; em text;
begin
  if not has_perm('data.payroll.write') then raise exception 'ไม่มีสิทธิ์ส่งเซ็น Payroll Register'; end if;
  if not exists (select 1 from payroll_period where month = p_month) then raise exception 'ยังไม่ได้บันทึกรายงานเดือน %', p_month; end if;
  n := jsonb_array_length(coalesce(p_steps, '[]'::jsonb));
  if n < 2 then raise exception 'ต้องมีอย่างน้อย 2 ช่อง (ผู้จัดทำ + ผู้อนุมัติ)'; end if;
  for x in select * from jsonb_array_elements(p_steps) loop
    i := i + 1;
    if i = 1 and (x->>'user_id')::uuid is distinct from auth.uid() then raise exception 'ช่องแรก (ผู้จัดทำ) ต้องเป็นคนที่กดส่ง'; end if;
    select * into g from letter_signers where user_id = (x->>'user_id')::uuid;
    if g.user_id is null or g.signature_path is null then raise exception 'ช่องที่ % ยังไม่ได้เลือกคน หรือคนนั้นยังไม่มีลายเซ็นในระบบ', i; end if;
    select email into em from auth.users where id = g.user_id;
    s := s || jsonb_build_object('step', i, 'role', x->>'role', 'dept', x->>'dept', 'user_id', g.user_id,
      'name', coalesce(nullif(g.name_en, ''), g.name_th), 'title', coalesce(nullif(g.title_en, ''), g.title_th),
      'email', coalesce(nullif(g.email, ''), em),
      'signature_path', case when i = 1 then g.signature_path end,
      'signed_at', case when i = 1 then now() end, 'via', case when i = 1 then 'app' end);
  end loop;
  delete from payroll_sign where month = p_month;
  insert into payroll_sign (month, status, steps, cur_step, submitted_by)
  values (p_month, 'pending', s, 2, auth.uid()) returning * into r;
  perform pr_issue_token(p_month, 2);
  return r;
end $$;

create or replace function pr_link_get(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t payroll_sign_tokens; r payroll_sign;
begin
  if coalesce(length(p_token), 0) < 40 then return jsonb_build_object('error', 'ลิงก์ไม่ถูกต้อง'); end if;
  select * into t from payroll_sign_tokens where token = p_token;
  if t.month is null then return jsonb_build_object('error', 'ลิงก์ไม่ถูกต้อง หรือมีการส่งลิงก์ใหม่แทนแล้ว'); end if;
  select * into r from payroll_sign where month = t.month;
  return jsonb_build_object(
    'month', r.month, 'status', r.status, 'cur_step', r.cur_step, 'reject_reason', r.reject_reason, 'link_step', t.step,
    'state', case when r.status = 'pending' and r.cur_step = t.step and t.used_at is null and t.expires_at > now() then 'open'
                  when r.status = 'pending' and r.cur_step = t.step and t.used_at is null then 'expired' else 'closed' end,
    'steps', (select jsonb_agg(e - 'email' - 'user_id' - 'signature_path' order by (e->>'step')::int) from jsonb_array_elements(r.steps) e),
    'rows', coalesce((select jsonb_agg(to_jsonb(p) - 'id') from payroll_summary p where p.month = r.month), '[]'::jsonb));
end $$;

-- เซ็น / ส่งกลับ จากลิงก์ — ในนามคนของขั้นนั้น
create or replace function pr_link_decide(p_token text, p_ok boolean, p_remark text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t payroll_sign_tokens; r payroll_sign; a jsonb; n int; sig text;
begin
  select * into t from payroll_sign_tokens where token = p_token for update;
  if t.month is null then raise exception 'ลิงก์ไม่ถูกต้อง หรือมีการส่งลิงก์ใหม่แทนแล้ว'; end if;
  if t.used_at is not null then raise exception 'ลิงก์นี้ใช้ไปแล้ว'; end if;
  if t.expires_at <= now() then raise exception 'ลิงก์หมดอายุแล้ว — ติดต่อ HR ให้ส่งลิงก์ใหม่'; end if;
  select * into r from payroll_sign where month = t.month for update;
  if r.status <> 'pending' or r.cur_step is distinct from t.step then raise exception 'รายงานนี้ไม่ได้รอการลงนามขั้นนี้แล้ว'; end if;
  if not p_ok and nullif(trim(p_remark), '') is null then raise exception 'กรุณาระบุเหตุผลที่ส่งกลับ'; end if;
  a := (select e from jsonb_array_elements(r.steps) e where (e->>'step')::int = t.step);
  n := jsonb_array_length(r.steps);
  update payroll_sign_tokens set used_at = now() where month = t.month and step = t.step;
  if not p_ok then
    update payroll_sign set status = 'rejected', reject_reason = trim(p_remark), cur_step = null, updated_at = now() where month = r.month;
  else
    select signature_path into sig from letter_signers where user_id = (a->>'user_id')::uuid;
    if sig is null then raise exception 'ยังไม่มีลายเซ็นของผู้ลงนามขั้นนี้ในระบบ — ติดต่อ HR'; end if;
    update payroll_sign set
      steps = (select jsonb_agg(case when (e->>'step')::int = t.step
                 then e || jsonb_build_object('signature_path', sig, 'signed_at', now(), 'via', 'email_link') else e end
                 order by (e->>'step')::int) from jsonb_array_elements(r.steps) e),
      status = case when t.step < n then 'pending' else 'approved' end,
      cur_step = case when t.step < n then t.step + 1 end,
      approved_at = case when t.step < n then null else now() end,
      updated_at = now()
    where month = r.month;
    if t.step < n then perform pr_issue_token(r.month, t.step + 1); end if;
  end if;
  select * into r from payroll_sign where month = r.month;
  insert into notifications (title, detail, category, created_by, link)
  values (case when r.status = 'approved' then 'Payroll Register ลงนามครบแล้ว'
               when r.status = 'rejected' then 'Payroll Register ถูกส่งกลับ'
               else 'Payroll Register ผ่านขั้น ' || t.step || ' แล้ว' end, r.month, 'default', r.submitted_by, 'payrollbuild');
  return jsonb_build_object('status', r.status, 'cur_step', r.cur_step, 'month', r.month);
end $$;

-- ลิงก์ของขั้นที่รออยู่ — ให้ HR คัดลอกไปส่งเอง (โหมด Outlook) · ออกลิงก์ใหม่ · ยกเลิกการส่งเซ็น
create or replace function pr_pending_link(p_month text) returns text
language sql stable security definer set search_path = public as $$
  select t.token from payroll_sign_tokens t join payroll_sign r on r.month = t.month
   where r.month = p_month and r.status = 'pending' and t.step = r.cur_step and t.used_at is null and t.expires_at > now()
     and has_perm('data.payroll.write');
$$;
create or replace function pr_renew_link(p_month text) returns text
language plpgsql security definer set search_path = public as $$
declare r payroll_sign;
begin
  if not has_perm('data.payroll.write') then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into r from payroll_sign where month = p_month;
  if r.status is distinct from 'pending' then raise exception 'รายงานเดือนนี้ไม่ได้รอลงนาม'; end if;
  perform pr_issue_token(p_month, r.cur_step);
  return (select token from payroll_sign_tokens where month = p_month and step = r.cur_step);
end $$;
create or replace function pr_cancel(p_month text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('data.payroll.write') then raise exception 'ไม่มีสิทธิ์'; end if;
  delete from payroll_sign where month = p_month;
end $$;

revoke all on function pr_signers(), pr_submit(text, jsonb), pr_link_get(text), pr_link_decide(text, boolean, text),
  pr_pending_link(text), pr_renew_link(text), pr_cancel(text) from public;
grant execute on function pr_link_get(text), pr_link_decide(text, boolean, text) to anon, authenticated;
grant execute on function pr_signers(), pr_submit(text, jsonb), pr_pending_link(text), pr_renew_link(text), pr_cancel(text) to authenticated;

-- ตรวจผล
select 'payroll_sign' as ตาราง, count(*) from payroll_sign
union all select 'payroll_sign_tokens', count(*) from payroll_sign_tokens;
