-- ============================================================================
-- แบบฟอร์มกองทุนสำรองเลี้ยงชีพ: คณะกรรมการกองทุนลงนามอนุมัติออนไลน์
-- รันหลัง schema_fund_forms.sql และ schema_hr_letters.sql · รันซ้ำได้ปลอดภัย
--
-- ลำดับ: พนักงานส่ง → HR รับเรื่อง (accepted / received) → HR ส่งให้กรรมการ (pending_approval)
--        → กรรมการที่ถูกเลือกกดอนุมัติ → ลายเซ็นของกรรมการลงช่อง "คณะกรรมการกองทุนลงนามอนุมัติ" (approved)
-- ลายเซ็นใช้ชุดเดียวกับหนังสือ HR (letter_signers + bucket letter-assets) — ตั้งที่ ออกหนังสือ HR → ตั้งค่า
-- สถานะ / ผู้อนุมัติ / ลายเซ็น เปลี่ยนได้ผ่านฟังก์ชันด้านล่างเท่านั้น (trigger บังคับ ไม่ใช่แค่ซ่อนปุ่ม)
-- ============================================================================

alter table fund_form_submission add column if not exists approver_id           uuid;
alter table fund_form_submission add column if not exists approval_requested_at timestamptz;
alter table fund_form_submission add column if not exists approval_requested_by uuid;
alter table fund_form_submission add column if not exists approval_prev_status  text;   -- กลับไปสถานะนี้เมื่อกรรมการส่งกลับ / HR ดึงกลับ
alter table fund_form_submission add column if not exists approval_note         text;   -- เหตุผลที่กรรมการส่งกลับ (HR เห็น พนักงานไม่เห็น)
alter table fund_form_submission add column if not exists approved_by           uuid;
alter table fund_form_submission add column if not exists approved_at           timestamptz;
alter table fund_form_submission add column if not exists committee             jsonb;  -- ชื่อ ตำแหน่ง path ลายเซ็น ณ ตอนอนุมัติ
alter table fund_form_submission add column if not exists approval_requested_email text; -- ส่งผลกลับในโหมด Outlook (หน้าเว็บอ่านอีเมลคนอื่นไม่ได้)

alter table fund_form_submission drop constraint if exists fund_form_submission_status_check;
alter table fund_form_submission add constraint fund_form_submission_status_check
  check (status in ('submitted','accepted','received','pending_approval','approved','sent','rejected','cancelled'));

-- ------------------------------------------------------------------ กันแก้ตรงในตาราง
create or replace function fund_approval_guard() returns trigger language plpgsql as $$
declare ok boolean := current_setting('fund.approving', true) = 'on';
begin
  if ok then return new; end if;
  if new.committee is distinct from old.committee or new.approved_by is distinct from old.approved_by
     or new.approver_id is distinct from old.approver_id then
    raise exception 'ผู้อนุมัติและลายเซ็นกรรมการเปลี่ยนได้ผ่านปุ่มส่งลงนาม / อนุมัติเท่านั้น';
  end if;
  if new.status = 'pending_approval' and old.status <> 'pending_approval' then
    raise exception 'ส่งให้กรรมการลงนามได้ผ่านปุ่ม "ส่งให้กรรมการลงนาม" เท่านั้น';
  end if;
  -- ระหว่างรอกรรมการ: HR ยกเลิก/ส่งกลับให้พนักงานได้ (เช่นพนักงานขอแก้) แต่ข้ามไปอนุมัติเองไม่ได้
  if old.status = 'pending_approval' and new.status not in ('pending_approval','rejected','cancelled') then
    raise exception 'รอกรรมการลงนามอยู่ — ดึงกลับก่อน หรือรอกรรมการอนุมัติ';
  end if;
  return new;
end $$;
drop trigger if exists fund_approval_guard on fund_form_submission;
create trigger fund_approval_guard before update on fund_form_submission
  for each row execute function fund_approval_guard();

-- สิทธิ์ของผู้ใช้คนอื่น (has_perm ดูได้แค่ของคนที่เรียก)
create or replace function user_has_perm(p_uid uuid, p text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from user_roles ur where ur.user_id = p_uid and (ur.role = 'admin'
           or exists (select 1 from role_permissions rp where rp.role_key = ur.role and rp.perm_key = p)));
$$;
revoke all on function user_has_perm(uuid, text) from public, anon;

-- ระหว่างรอกรรมการ พนักงานส่งฉบับใหม่ไม่ได้ (fund_form_submit เดิมกันเฉพาะสถานะอื่น — กันเพิ่มที่นี่)
create or replace function fund_block_resubmit() returns trigger language plpgsql as $$
begin
  if (select s.status from fund_form_submission s where s.emp_code = new.emp_code and s.status <> 'cancelled'
       order by s.submitted_at desc limit 1) = 'pending_approval' then
    raise exception 'ALREADY_SUBMITTED';
  end if;
  return new;
end $$;
drop trigger if exists fund_block_resubmit on fund_form_submission;
create trigger fund_block_resubmit before insert on fund_form_submission
  for each row execute function fund_block_resubmit();

-- กรรมการที่เลือกได้: มีสิทธิ์อนุมัติ + ตั้งลายเซ็นแล้ว
create or replace function fund_approvers()
returns table (user_id uuid, name_th text, title_th text, email text)
language sql security definer stable set search_path = public as $$
  select g.user_id, g.name_th, g.title_th, g.email from letter_signers g
   where has_perm('page.fundforms') and g.signature_path is not null and user_has_perm(g.user_id, 'data.fundforms.approve')
   order by g.name_th;
$$;
revoke all on function fund_approvers() from public, anon;
grant execute on function fund_approvers() to authenticated;

-- ------------------------------------------------------------------ ฟังก์ชัน
-- HR ส่งให้กรรมการ: ต้องรับเรื่องแล้ว · เป็นฉบับล่าสุดของคนนั้น · กรรมการต้องมีสิทธิ์และตั้งลายเซ็นแล้ว
create or replace function fund_request_approval(p_id bigint, p_approver uuid)
returns fund_form_submission language plpgsql security definer set search_path = public as $$
declare s fund_form_submission;
begin
  if not has_perm('data.fundforms.write') then raise exception 'ไม่มีสิทธิ์จัดการคำขอกองทุน'; end if;
  select * into s from fund_form_submission where id = p_id for update;
  if s.id is null then raise exception 'ไม่พบคำขอ'; end if;
  if s.form_type <> 'pvd' then raise exception 'ส่งลงนามได้เฉพาะแบบฟอร์มกองทุนสำรองเลี้ยงชีพ'; end if;
  if s.status not in ('accepted','received') then raise exception 'ต้องรับเรื่องก่อน จึงส่งให้กรรมการลงนามได้'; end if;
  if exists (select 1 from fund_form_submission x where x.emp_code = s.emp_code and x.status <> 'cancelled'
               and x.submitted_at > s.submitted_at) then raise exception 'มีฉบับใหม่กว่านี้ — ส่งฉบับล่าสุดแทน'; end if;
  if p_approver is null or not user_has_perm(p_approver, 'data.fundforms.approve') then
    raise exception 'ผู้ที่เลือกไม่มีสิทธิ์อนุมัติแบบฟอร์มกองทุน'; end if;
  if not exists (select 1 from letter_signers where user_id = p_approver and signature_path is not null) then
    raise exception 'กรรมการที่เลือกยังไม่ได้ตั้งลายเซ็น'; end if;
  perform set_config('fund.approving', 'on', true);
  update fund_form_submission set status = 'pending_approval', approval_prev_status = s.status, approver_id = p_approver,
         approval_requested_at = now(), approval_requested_by = auth.uid(), approval_requested_email = auth.jwt()->>'email',
         approval_note = null, updated_by = auth.uid()
   where id = p_id returning * into s;
  return s;
end $$;

-- กรรมการอนุมัติ: เฉพาะคนที่ถูกเลือก · ลายเซ็นของคนที่กดเท่านั้น
create or replace function fund_approve(p_id bigint)
returns fund_form_submission language plpgsql security definer set search_path = public as $$
declare s fund_form_submission; g letter_signers;
begin
  if not has_perm('data.fundforms.approve') then raise exception 'ไม่มีสิทธิ์อนุมัติแบบฟอร์มกองทุน'; end if;
  select * into s from fund_form_submission where id = p_id for update;
  if s.status is distinct from 'pending_approval' then raise exception 'คำขอนี้ไม่ได้รอกรรมการลงนาม'; end if;
  if s.approver_id is distinct from auth.uid() then raise exception 'คำขอนี้ส่งถึงกรรมการท่านอื่น'; end if;
  select * into g from letter_signers where user_id = auth.uid();
  if g.signature_path is null then raise exception 'ยังไม่ได้อัปโหลดลายเซ็น — ตั้งค่าที่ ออกหนังสือ HR → ตั้งค่า'; end if;
  perform set_config('fund.approving', 'on', true);
  update fund_form_submission set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_by = auth.uid(),
         committee = jsonb_build_object('name_th', g.name_th, 'title_th', g.title_th, 'signature_path', g.signature_path)
   where id = p_id returning * into s;
  return s;
end $$;

-- กรรมการส่งกลับให้ HR (ไม่ใช่ส่งกลับพนักงาน) — กลับไปสถานะก่อนส่งลงนาม พร้อมเหตุผล
create or replace function fund_reject_approval(p_id bigint, p_reason text)
returns fund_form_submission language plpgsql security definer set search_path = public as $$
declare s fund_form_submission;
begin
  if not has_perm('data.fundforms.approve') then raise exception 'ไม่มีสิทธิ์อนุมัติแบบฟอร์มกองทุน'; end if;
  select * into s from fund_form_submission where id = p_id for update;
  if s.status is distinct from 'pending_approval' then raise exception 'คำขอนี้ไม่ได้รอกรรมการลงนาม'; end if;
  if s.approver_id is distinct from auth.uid() then raise exception 'คำขอนี้ส่งถึงกรรมการท่านอื่น'; end if;
  perform set_config('fund.approving', 'on', true);
  update fund_form_submission set status = coalesce(approval_prev_status, 'accepted'), approval_note = nullif(trim(p_reason), ''),
         updated_by = auth.uid()
   where id = p_id returning * into s;
  return s;
end $$;

-- HR ดึงกลับ (เช่นกรรมการไม่อยู่ จะส่งใหม่ถึงอีกท่าน)
create or replace function fund_recall_approval(p_id bigint)
returns fund_form_submission language plpgsql security definer set search_path = public as $$
declare s fund_form_submission;
begin
  if not has_perm('data.fundforms.write') then raise exception 'ไม่มีสิทธิ์จัดการคำขอกองทุน'; end if;
  select * into s from fund_form_submission where id = p_id for update;
  if s.status is distinct from 'pending_approval' then raise exception 'คำขอนี้ไม่ได้รอกรรมการลงนาม'; end if;
  perform set_config('fund.approving', 'on', true);
  update fund_form_submission set status = coalesce(approval_prev_status, 'accepted'), approver_id = null, updated_by = auth.uid()
   where id = p_id returning * into s;
  return s;
end $$;

revoke all on function fund_request_approval(bigint, uuid) from public, anon;
revoke all on function fund_approve(bigint)                from public, anon;
revoke all on function fund_reject_approval(bigint, text)  from public, anon;
revoke all on function fund_recall_approval(bigint)        from public, anon;
grant execute on function fund_request_approval(bigint, uuid) to authenticated;
grant execute on function fund_approve(bigint)                to authenticated;
grant execute on function fund_reject_approval(bigint, text)  to authenticated;
grant execute on function fund_recall_approval(bigint)        to authenticated;

-- ------------------------------------------------------------------ ลายเซ็น: ให้หน้าแบบฟอร์มกองทุนอ่านได้ด้วย
drop policy if exists "la_read" on storage.objects;
create policy "la_read" on storage.objects for select
  using (bucket_id = 'letter-assets' and (has_perm('data.letters.write') or has_perm('data.letters.approve')
         or has_perm('page.fundforms')));
-- รายชื่อผู้ลงนาม: ให้ HR กองทุนเห็นเพื่อเลือกกรรมการ
drop policy if exists "ls_read" on letter_signers;
create policy "ls_read" on letter_signers for select using (has_perm('page.letters') or has_perm('page.fundforms'));

-- ------------------------------------------------------------------ แบบอีเมล
alter table mail_templates drop constraint if exists mail_templates_key_check;
alter table mail_templates add constraint mail_templates_key_check
  check (key in ('request','approved','rejected','fund_request','fund_approved','fund_rejected'));
insert into mail_templates (key, label, subject, html) values
('fund_request', 'กองทุน: ขอให้กรรมการลงนาม', '[ขอลงนาม] แบบฟอร์มกองทุนสำรองเลี้ยงชีพ — {{person}} {{emp_code}}',
 $h$<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;color:#1e293b;max-width:560px">
  <p style="font-size:16px;font-weight:bold;color:#0F1C4D;margin:0 0 12px">มีแบบฟอร์มกองทุนรอท่านลงนามอนุมัติ</p>
  <table style="border-collapse:collapse;font-size:14px;margin-bottom:16px">
    <tr><td style="padding:4px 16px 4px 0;color:#64748b">คำขอ</td><td><b>{{doc_no}}</b></td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#64748b">เรื่อง</td><td>{{kind}}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#64748b">พนักงาน</td><td>{{person}} {{emp_code}}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#64748b">ส่งโดย</td><td>{{requester}}</td></tr></table>
  <a href="{{link}}" style="display:inline-block;background:#2B5AC7;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:bold">เปิดแบบฟอร์มเพื่อลงนาม</a>
  <p style="color:#94a3b8;font-size:12px;margin-top:22px">ส่งจากระบบ HR · ต้องเข้าสู่ระบบก่อนเปิดดู</p></div>$h$),
('fund_approved', 'กองทุน: แจ้งกรรมการอนุมัติแล้ว', '[อนุมัติแล้ว] แบบฟอร์มกองทุน {{doc_no}} — {{person}}',
 $h$<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px"><p><b>คณะกรรมการกองทุนลงนามอนุมัติแล้ว</b></p>
  <p>{{doc_no}} · {{kind}} · {{person}} {{emp_code}}<br>ลงนามโดย {{approver}}</p><p><a href="{{link}}">เปิดแบบฟอร์ม</a></p></div>$h$),
('fund_rejected', 'กองทุน: แจ้งกรรมการส่งกลับ', '[ส่งกลับ] แบบฟอร์มกองทุน {{doc_no}} — {{person}}',
 $h$<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px"><p><b>กรรมการส่งแบบฟอร์มกลับมาให้ HR</b></p>
  <p>{{doc_no}} · {{kind}} · {{person}} {{emp_code}}</p><p>เหตุผล: {{reason}}</p><p><a href="{{link}}">เปิดแบบฟอร์ม</a></p></div>$h$)
on conflict (key) do nothing;

-- ------------------------------------------------------------------ สิทธิ์
insert into permissions (key, category, label, description, sort_order) values
  ('data.fundforms.approve', 'data', 'ลงนามอนุมัติแบบฟอร์มกองทุน', 'คณะกรรมการกองทุน — ลงลายเซ็นอนุมัติแบบฟอร์มที่ HR ส่งมา (ต้องมีสิทธิ์เปิดหน้าแบบฟอร์มกองทุนด้วย)', 43)
on conflict (key) do update set label = excluded.label, description = excluded.description, sort_order = excluded.sort_order;
