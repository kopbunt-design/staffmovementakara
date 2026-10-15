-- ============================================================================
-- ค่าจ้างเหมา 3% — เว็บแยก /contract (contract/ct.js) · ต่อจาก schema_contract_payroll.sql + schema_contract_items.sql
-- รันใน Supabase SQL editor · รันซ้ำได้ปลอดภัย (idempotent)
--
--   1. ข้อมูลที่ 50 ทวิ ต้องมี: ที่อยู่ / อีเมล / ชื่ออังกฤษของผู้รับจ้าง + สำเนาลงงวด (เอกสารงวดเก่าต้องนิ่ง)
--   2. ตั้งค่าบริษัท (เลขผู้เสียภาษี ที่อยู่ บัญชีที่ตัดเงินในไฟล์ธนาคาร) — แก้ได้ที่หน้า "ตั้งค่า"
--   3. ขั้นตอนอนุมัติ: ร่าง → ประมวลผลแล้ว → รออนุมัติ → อนุมัติแล้ว → ล็อก
--      อนุมัติได้เฉพาะผู้ลงนามที่ HR เลือก (ผ่าน ct_decide เท่านั้น) · กดอนุมัติ = ลงนาม 50 ทวิ ของทุกคนในงวด
--      ส่งขออนุมัติแล้ว / อนุมัติแล้ว ตัวเลขในงวดแก้ไม่ได้ (ต้องถอนคำขอหรือให้ผู้อนุมัติส่งกลับก่อน)
-- ============================================================================

-- ------------------------------------------------------------- 1. ข้อมูลผู้รับจ้าง
alter table contract_workers add column if not exists email   text;
alter table contract_workers add column if not exists address text;            -- ที่อยู่ตามบัตร (ช่องผู้ถูกหักภาษีใน 50 ทวิ)
alter table contract_pay_item add column if not exists name_en text;
alter table contract_pay_item add column if not exists tax_id  text;
alter table contract_pay_item add column if not exists address text;
alter table contract_pay_item add column if not exists email   text;

-- ------------------------------------------------------------- 2. ตั้งค่าบริษัท
create table if not exists contract_settings (
  id               int primary key default 1 check (id = 1),
  company_name_th  text not null default 'บริษัท อัครา รีซอร์สเซส จำกัด (มหาชน)',
  company_tax_id   text not null default '0107556000582',
  company_address  text not null default 'เลขที่ 99 ตำบลเขาเจ็ดลูก อำเภอทับคล้อ จังหวัดพิจิตร 66230',
  bank_account     text not null default '2371009208',      -- บัญชีกสิกรไทยที่ตัดเงิน (หัวไฟล์ PCT)
  bank_company     text not null default 'บริษัท อัครา รีซอร์สเซส จำกัด (มหาชน)',
  updated_at       timestamptz default now()
);
insert into contract_settings (id) values (1) on conflict do nothing;

-- ------------------------------------------------------------- 3. งวด: ผู้อนุมัติ + ลายเซ็น
alter table contract_pay_run add column if not exists pay_date      date;          -- วันที่โอน (วันที่จ่ายใน 50 ทวิ / ไฟล์ธนาคาร)
alter table contract_pay_run add column if not exists approver_id   uuid;
alter table contract_pay_run add column if not exists submitted_at  timestamptz;
alter table contract_pay_run add column if not exists submitted_by  uuid;
alter table contract_pay_run add column if not exists signer        jsonb;         -- สำเนาชื่อ/ตำแหน่ง/ลายเซ็น ณ ตอนอนุมัติ
alter table contract_pay_run add column if not exists reject_reason text;
alter table contract_pay_run add column if not exists variance_ok   jsonb not null default '[]';   -- worker_id ที่ HR ยืนยันยอดต่างจากเดือนก่อนแล้ว
alter table contract_pay_run drop constraint if exists contract_pay_run_status_check;
alter table contract_pay_run add constraint contract_pay_run_status_check
  check (status in ('draft','calculated','pending','approved','locked'));

-- ตัวเลขในงวดแก้ได้เฉพาะตอนร่าง/ประมวลผลแล้ว
create or replace function block_locked_run() returns trigger language plpgsql as $$
declare rid bigint; st text;
begin
  rid := coalesce(new.run_id, old.run_id);
  select status into st from contract_pay_run where id = rid;
  if st = 'locked' then raise exception 'งวดนี้ล็อกแล้ว แก้ไขไม่ได้ — ถ้าต้องแก้ให้เปิดงวดแก้ไขใหม่'; end if;
  if st in ('pending','approved') then raise exception 'งวดนี้ส่งขออนุมัติ/อนุมัติแล้ว แก้ตัวเลขไม่ได้ — ถอนคำขอหรือให้ผู้อนุมัติส่งกลับก่อน'; end if;
  return coalesce(new, old);
end $$;

-- สถานะเปลี่ยนได้ตามขั้นเท่านั้น · "อนุมัติแล้ว" ต้องมาจาก ct_decide
create or replace function guard_contract_run() returns trigger language plpgsql as $$
begin
  if old.status = 'locked' then raise exception 'งวดที่ล็อกแล้วแก้ไขไม่ได้'; end if;
  if new.status is distinct from old.status then
    if new.status = 'approved' then
      if old.status <> 'pending' or current_setting('contract.deciding', true) is distinct from 'on' then raise exception 'อนุมัติได้เฉพาะผู้ลงนามผ่านปุ่มอนุมัติ'; end if;
    elsif not ((old.status = 'draft' and new.status = 'calculated') or (old.status = 'calculated' and new.status in ('draft','pending'))
            or (old.status = 'pending' and new.status = 'calculated') or (old.status = 'approved' and new.status = 'locked')) then
      raise exception 'เปลี่ยนสถานะจาก % เป็น % ไม่ได้', old.status, new.status;
    end if;
  end if;
  -- ลายเซ็น/เวลาอนุมัติแก้ตรง ๆ ไม่ได้
  if current_setting('contract.deciding', true) is distinct from 'on'
     and (new.signer is distinct from old.signer or new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by) then
    raise exception 'ข้อมูลการอนุมัติแก้ไขไม่ได้';
  end if;
  return new;
end $$;
drop trigger if exists cpr_no_unlock on contract_pay_run;
drop trigger if exists cpr_guard on contract_pay_run;
create trigger cpr_guard before update on contract_pay_run for each row execute function guard_contract_run();

-- ผู้อนุมัติกดอนุมัติ / ส่งกลับ
create or replace function ct_decide(p_run bigint, p_approve boolean, p_reason text default null)
returns contract_pay_run language plpgsql security definer set search_path = public as $$
declare r contract_pay_run; s letter_signers; st letter_settings;
begin
  if not has_perm('data.contract.approve') then raise exception 'ไม่มีสิทธิ์อนุมัติงวดค่าจ้างเหมา'; end if;
  select * into r from contract_pay_run where id = p_run for update;
  if r.status is distinct from 'pending' then raise exception 'งวดนี้ไม่ได้อยู่ในสถานะรออนุมัติ'; end if;
  if r.approver_id is distinct from auth.uid() then raise exception 'งวดนี้ส่งถึงผู้อนุมัติคนอื่น'; end if;
  perform set_config('contract.deciding', 'on', true);
  if p_approve then
    select * into s from letter_signers where user_id = auth.uid();
    if s.signature_path is null then raise exception 'ยังไม่ได้อัปโหลดลายเซ็น — ตั้งค่าที่ “ลายเซ็นของฉัน” ก่อน'; end if;
    select * into st from letter_settings where id = 1;
    update contract_pay_run set status = 'approved', approved_by = auth.uid(), approved_at = now(), reject_reason = null,
           signer = jsonb_build_object('name_th', s.name_th, 'title_th', s.title_th, 'signature_path', s.signature_path, 'seal_path', st.seal_path)
     where id = p_run returning * into r;
  else
    update contract_pay_run set status = 'calculated', reject_reason = coalesce(nullif(trim(p_reason), ''), 'ส่งกลับแก้ไข')
     where id = p_run returning * into r;
  end if;
  return r;
end $$;
revoke all on function ct_decide(bigint, boolean, text) from public, anon;
grant execute on function ct_decide(bigint, boolean, text) to authenticated;

-- ------------------------------------------------------------- 4. สิทธิ์
insert into permissions (key, category, label, description, sort_order) values
  ('data.contract.approve', 'data', 'อนุมัติงวดค่าจ้างเหมา', 'อนุมัติการจ่ายและลงนาม 50 ทวิ ของงวดค่าจ้างเหมา', 39)
on conflict (key) do update set label = excluded.label, description = excluded.description;
insert into role_permissions (role_key, perm_key) select 'admin', 'data.contract.approve' on conflict do nothing;

-- ผู้อนุมัติเห็นงวด/ตัวเลขได้แม้ไม่มีสิทธิ์ค่าใช้จ่ายเงินเดือน · ตั้งค่าบริษัทแก้ได้เฉพาะคนที่แก้ค่าจ้างเหมาได้
do $$
declare t text;
begin
  foreach t in array array['contract_workers','contract_pay_run','contract_pay_item','contract_pay_adjust','contract_pay_codes','contract_worker_items','contract_settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "%s_read"  on %I', t, t);
    execute format('drop policy if exists "%s_write" on %I', t, t);
    execute format('create policy "%s_read"  on %I for select using (has_perm(''data.payroll.read'') or has_perm(''data.contract.approve''))', t, t);
    execute format('create policy "%s_write" on %I for all using (has_perm(''data.payroll.write'')) with check (has_perm(''data.payroll.write''))', t, t);
  end loop;
end $$;

-- ------------------------------------------------------------- 5. ลายเซ็น (ชุดเดียวกับท้าย schema_hr_letters.sql / schema_fund_approval.sql / schema_expense.sql / schema_emp_contract.sql — แก้ให้ตรงกันทุกไฟล์)
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

-- รายชื่อผู้อนุมัติให้ HR เลือก (เฉพาะคนที่มีสิทธิ์อนุมัติและอัปโหลดลายเซ็นแล้ว)
create or replace function ct_signers()
returns table (user_id uuid, name text, title text, email text)
language sql security definer stable set search_path = public as $$
  select g.user_id, coalesce(nullif(g.name_th,''), g.name_en), coalesce(nullif(g.title_th,''), g.title_en), g.email
    from letter_signers g
   where (has_perm('page.contractpay') or has_perm('data.contract.approve')) and g.signature_path is not null
     and user_has_perm(g.user_id, 'data.contract.approve')
   order by 2;
$$;
revoke all on function ct_signers() from public, anon;
grant execute on function ct_signers() to authenticated;

select key, label from permissions where key in ('page.contractpay', 'data.contract.approve');
