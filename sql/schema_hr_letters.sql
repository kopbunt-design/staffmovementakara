-- ============================================================================
-- ออกหนังสือ HR (หนังสือรับรองการทำงาน/เงินเดือน ไทย-อังกฤษ · Offer Letter)
-- ต่อจาก sql/schema_doc_register.sql (ต้องรันไฟล์นั้นก่อน)
--
-- วิธีใช้: Supabase Dashboard > SQL Editor > วางทั้งไฟล์ > Run (รันซ้ำได้)
--
-- ขั้นตอน: HR ร่างหนังสือ → ส่งขออนุมัติ (ได้เลขที่จากทะเบียนตอนนี้) → HR Manager อนุมัติ
--         → ลายเซ็นของผู้อนุมัติ + ตราบริษัท ลงในหนังสือ → พิมพ์/บันทึก PDF ได้
--
-- ⚠️ ตัวหนังสือมีเงินเดือนรายคน (ผู้ใช้ยืนยัน 2026-10-01 ว่าเก็บได้) — อ่านได้เฉพาะ
--    ผู้มีสิทธิ์ออกหนังสือ (data.letters.write) และผู้อนุมัติ (data.letters.approve) เท่านั้น
-- ⚠️ ลายเซ็นใส่ได้ทางเดียวคือ letter_approve() ซึ่งใช้ลายเซ็นของ "คนที่กดอนุมัติ" เอง
--    HR ที่ออกหนังสือจึงใส่ลายเซ็นของคนอื่นเองไม่ได้
-- ============================================================================

-- ------------------------------------------------------------ 1. รายการเงินได้ที่แสดงในหนังสือ
-- เพิ่มรายการใหม่ได้ในอนาคต (ติ๊กเลือกตอนออกหนังสือ)
create table if not exists letter_income_items (
  key        text primary key,
  label_th   text not null,
  label_en   text not null,
  sort_order int not null default 100,
  is_active  boolean not null default true
);
insert into letter_income_items (key, label_th, label_en, sort_order) values
  ('salary',    'อัตราเงินเดือน',           'Current Monthly Base Salary', 1),
  ('transport', 'เงินทดแทนการจัดรถรับส่ง', 'Transportation Allowance',    2)
on conflict (key) do nothing;

-- ------------------------------------------------------------ 2. ผู้ลงนาม (ลายเซ็น) + ตราบริษัท
-- แต่ละคนอัปโหลดลายเซ็นของตัวเอง · ตราบริษัทเก็บแถวเดียว (user_id ว่าง, kind = 'seal')
create table if not exists letter_signers (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  name_th        text, title_th text,
  name_en        text, title_en text,
  email          text,                    -- ที่อยู่ส่งเมลขออนุมัติ
  signature_path text,                    -- path ใน bucket letter-assets
  updated_at     timestamptz not null default now()
);
create table if not exists letter_settings (
  id          int primary key default 1 check (id = 1),
  seal_path   text,                       -- ตราบริษัท
  hr_contact_email text default 'chalita@akararesources.com',   -- อีเมลใน Offer Letter
  updated_at  timestamptz not null default now()
);
insert into letter_settings (id) values (1) on conflict do nothing;

-- ------------------------------------------------------------ 3. หนังสือ
create table if not exists hr_letters (
  id            bigint generated always as identity primary key,
  kind          text not null check (kind in ('cert_th','cert_en','salary_th','salary_en','offer_en')),
  emp_code      text,
  person_name   text,
  data          jsonb not null default '{}'::jsonb,   -- ทุกช่องในหนังสือ (ชื่อ ตำแหน่ง รายการเงินได้ ตาราง Schedule ฯลฯ)
  status        text not null default 'draft' check (status in ('draft','pending','approved','rejected','cancelled')),
  doc_id        bigint references doc_register(id),
  doc_no        text,
  requested_by  uuid, requested_at timestamptz,
  approver_id   uuid,                                  -- คนที่ถูกขอให้อนุมัติ
  approved_by   uuid, approved_at timestamptz,
  signer        jsonb,                                 -- สำเนาชื่อ/ตำแหน่ง/ลายเซ็นของผู้อนุมัติ ณ วันอนุมัติ
  reject_reason text,
  created_by    uuid, created_at timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists hr_letters_status_idx on hr_letters (status, requested_at desc);
drop trigger if exists hr_letters_updated_at on hr_letters;
create trigger hr_letters_updated_at before update on hr_letters for each row execute function set_updated_at();

-- กติกาสถานะ (ที่ DB ไม่ใช่แค่ซ่อนปุ่ม):
--   · สร้างใหม่ต้องเป็นร่าง ไม่มีลายเซ็น ไม่มีเลขที่
--   · เป็น "อนุมัติแล้ว" ได้ทางเดียวคือ letter_approve() (ใส่ลายเซ็นของผู้กด)
--   · รออนุมัติอยู่ แก้เนื้อหาไม่ได้ — ต้องดึงกลับเป็นร่างก่อน (ผู้อนุมัติต้องอนุมัติฉบับที่เห็นจริง)
--   · อนุมัติแล้วแก้ไม่ได้ ยกเลิกได้อย่างเดียว
create or replace function hr_letters_guard() returns trigger language plpgsql as $$
declare approving boolean := current_setting('hr_letters.approving', true) = 'on';
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.signer is not null or new.doc_id is not null or new.approved_by is not null then
      raise exception 'หนังสือใหม่ต้องเริ่มจากร่าง';
    end if;
    return new;
  end if;
  if not approving and (new.signer is distinct from old.signer or new.approved_by is distinct from old.approved_by
                        or (new.status = 'approved' and old.status <> 'approved')) then
    raise exception 'อนุมัติและใส่ลายเซ็นได้ผ่านปุ่มอนุมัติของผู้อนุมัติเท่านั้น';
  end if;
  if new.doc_id is distinct from old.doc_id and old.doc_id is not null then
    raise exception 'เลขที่หนังสือเปลี่ยนไม่ได้';
  end if;
  if old.status = 'pending' and new.status = 'pending' and (new.data is distinct from old.data or new.kind <> old.kind) then
    raise exception 'หนังสือรออนุมัติอยู่ — ดึงกลับเป็นร่างก่อนแก้ไข';
  end if;
  if old.status = 'approved' and (new.data is distinct from old.data or new.kind <> old.kind
       or new.signer is distinct from old.signer or new.status not in ('approved','cancelled')) then
    raise exception 'หนังสือที่อนุมัติแล้วแก้ไขไม่ได้ — ถ้าต้องแก้ให้ยกเลิกแล้วออกฉบับใหม่';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'หนังสือที่ยกเลิกแล้วนำกลับมาใช้ไม่ได้';
  end if;
  return new;
end $$;
drop trigger if exists hr_letters_guard on hr_letters;
create trigger hr_letters_guard before insert or update on hr_letters for each row execute function hr_letters_guard();

-- ------------------------------------------------------------ 4. RLS
alter table letter_income_items enable row level security;
alter table letter_signers      enable row level security;
alter table letter_settings     enable row level security;
alter table hr_letters          enable row level security;

drop policy if exists "lii_read"  on letter_income_items;
drop policy if exists "lii_write" on letter_income_items;
create policy "lii_read"  on letter_income_items for select using (has_perm('page.letters'));
create policy "lii_write" on letter_income_items for all using (has_perm('data.letters.write')) with check (has_perm('data.letters.write'));

drop policy if exists "ls_read"  on letter_signers;
drop policy if exists "ls_write" on letter_signers;
create policy "ls_read"  on letter_signers for select using (has_perm('page.letters') or has_perm('page.fundforms'));
-- แก้ได้แค่ข้อมูลผู้ลงนามของตัวเอง (ลายเซ็นของใครของมัน)
create policy "ls_write" on letter_signers for all using (user_id = auth.uid() and has_perm('data.letters.approve'))
  with check (user_id = auth.uid() and has_perm('data.letters.approve'));

drop policy if exists "lset_read"  on letter_settings;
drop policy if exists "lset_write" on letter_settings;
create policy "lset_read"  on letter_settings for select using (has_perm('page.letters'));
create policy "lset_write" on letter_settings for update using (has_perm('data.letters.approve'));

drop policy if exists "hl_read"   on hr_letters;
drop policy if exists "hl_insert" on hr_letters;
drop policy if exists "hl_update" on hr_letters;
create policy "hl_read"   on hr_letters for select using (has_perm('data.letters.write') or has_perm('data.letters.approve'));
create policy "hl_insert" on hr_letters for insert with check (has_perm('data.letters.write'));
create policy "hl_update" on hr_letters for update using (has_perm('data.letters.write') or has_perm('data.letters.approve'));

-- ------------------------------------------------------------ 5. ที่เก็บลายเซ็น/ตรา (private)
insert into storage.buckets (id, name, public) values ('letter-assets', 'letter-assets', false)
on conflict (id) do nothing;
drop policy if exists "la_read"   on storage.objects;
drop policy if exists "la_write"  on storage.objects;
drop policy if exists "la_update" on storage.objects;
drop policy if exists "la_delete" on storage.objects;
-- อ่านได้เฉพาะคนที่ใช้งานหนังสือ (ต้องใช้แสดงลายเซ็นในหนังสือที่อนุมัติแล้ว)
create policy "la_read" on storage.objects for select
  using (bucket_id = 'letter-assets' and (has_perm('data.letters.write') or has_perm('data.letters.approve')
         or has_perm('page.fundforms')));   -- ลายเซ็นกรรมการในแบบฟอร์มกองทุน (schema_fund_approval.sql)
-- อัปโหลดได้เฉพาะผู้อนุมัติ และเฉพาะโฟลเดอร์ของตัวเอง (signatures/<user_id>/...) หรือตราบริษัท (seal/...)
create policy "la_write" on storage.objects for insert with check (bucket_id = 'letter-assets' and has_perm('data.letters.approve')
  and ((storage.foldername(name))[1] = 'seal' or ((storage.foldername(name))[1] = 'signatures' and (storage.foldername(name))[2] = auth.uid()::text)));
create policy "la_update" on storage.objects for update using (bucket_id = 'letter-assets' and has_perm('data.letters.approve')
  and ((storage.foldername(name))[1] = 'seal' or ((storage.foldername(name))[1] = 'signatures' and (storage.foldername(name))[2] = auth.uid()::text)));
create policy "la_delete" on storage.objects for delete using (bucket_id = 'letter-assets' and has_perm('data.letters.approve')
  and ((storage.foldername(name))[1] = 'seal' or ((storage.foldername(name))[1] = 'signatures' and (storage.foldername(name))[2] = auth.uid()::text)));

-- ------------------------------------------------------------ 6. ส่งขออนุมัติ / อนุมัติ / ส่งกลับ
-- ส่งขออนุมัติ: ออกเลขที่จากทะเบียน (ครั้งแรกเท่านั้น — ส่งกลับมาแก้แล้วส่งใหม่ใช้เลขเดิม)
create or replace function letter_submit(p_id bigint, p_approver uuid, p_type_label text)
returns hr_letters language plpgsql security definer set search_path = public as $$
declare l hr_letters; d doc_register; tid bigint;
begin
  if not has_perm('data.letters.write') then raise exception 'ไม่มีสิทธิ์ออกหนังสือ'; end if;
  select * into l from hr_letters where id = p_id for update;
  if l.id is null then raise exception 'ไม่พบหนังสือ'; end if;
  if l.status not in ('draft','rejected') then raise exception 'หนังสือนี้ส่งไปแล้ว'; end if;
  if l.doc_id is null then
    select id into tid from doc_types where series_code = 'HR' and label = p_type_label;
    select * into d from doc_issue('HR', 1, tid, null, current_date, null, 'ออกจากระบบออกหนังสือ',
                                   jsonb_build_array(jsonb_build_object('emp_code', l.emp_code, 'person_name', l.person_name)));
    l.doc_id := d.id; l.doc_no := d.doc_no;
  end if;
  update hr_letters set status = 'pending', doc_id = l.doc_id, doc_no = l.doc_no, approver_id = p_approver,
         requested_by = auth.uid(), requested_at = now(), reject_reason = null
   where id = p_id returning * into l;
  return l;
end $$;

create or replace function letter_approve(p_id bigint)
returns hr_letters language plpgsql security definer set search_path = public as $$
declare l hr_letters; s letter_signers; st letter_settings;
begin
  if not has_perm('data.letters.approve') then raise exception 'ไม่มีสิทธิ์อนุมัติหนังสือ'; end if;
  select * into l from hr_letters where id = p_id for update;
  if l.status <> 'pending' then raise exception 'หนังสือนี้ไม่ได้อยู่ในสถานะรออนุมัติ'; end if;
  select * into s from letter_signers where user_id = auth.uid();
  if s.signature_path is null then raise exception 'ยังไม่ได้อัปโหลดลายเซ็น — ตั้งค่าที่ “ลายเซ็นของฉัน” ก่อน'; end if;
  select * into st from letter_settings where id = 1;
  perform set_config('hr_letters.approving', 'on', true);
  update hr_letters set status = 'approved', approved_by = auth.uid(), approved_at = now(),
         signer = jsonb_build_object('name_th', s.name_th, 'title_th', s.title_th, 'name_en', s.name_en, 'title_en', s.title_en,
                                     'signature_path', s.signature_path, 'seal_path', st.seal_path)
   where id = p_id returning * into l;
  return l;
end $$;

create or replace function letter_reject(p_id bigint, p_reason text)
returns hr_letters language plpgsql security definer set search_path = public as $$
declare l hr_letters;
begin
  if not has_perm('data.letters.approve') then raise exception 'ไม่มีสิทธิ์อนุมัติหนังสือ'; end if;
  update hr_letters set status = 'rejected', reject_reason = nullif(trim(p_reason), '')
   where id = p_id and status = 'pending' returning * into l;
  if l.id is null then raise exception 'หนังสือนี้ไม่ได้อยู่ในสถานะรออนุมัติ'; end if;
  return l;
end $$;

revoke all on function letter_submit(bigint, uuid, text) from public, anon;
revoke all on function letter_approve(bigint)            from public, anon;
revoke all on function letter_reject(bigint, text)       from public, anon;
grant execute on function letter_submit(bigint, uuid, text) to authenticated;
grant execute on function letter_approve(bigint)            to authenticated;
grant execute on function letter_reject(bigint, text)       to authenticated;

-- ------------------------------------------------------------ 7. สิทธิ์
insert into permissions (key, category, label, description, sort_order) values
  ('page.letters',          'page', 'ออกหนังสือ HR',   'หนังสือรับรองการทำงาน/เงินเดือน และ Offer Letter', 26),
  ('data.letters.write',    'data', 'ร่างและส่งหนังสือ', 'ร่างหนังสือ ส่งขออนุมัติ พิมพ์หนังสือที่อนุมัติแล้ว (เห็นเงินเดือนในหนังสือ)', 44),
  ('data.letters.approve',  'data', 'อนุมัติหนังสือ',    'อนุมัติ/ส่งกลับหนังสือ และใช้ลายเซ็นของตัวเองลงในหนังสือ (HR Manager)', 45)
on conflict (key) do update
  set label = excluded.label, description = excluded.description, sort_order = excluded.sort_order;

-- HR ออกหนังสือได้ · สิทธิ์อนุมัติให้ admin ไว้ก่อน — มอบให้ HR Manager ที่หน้า User Management
insert into role_permissions (role_key, perm_key)
select r.key, p.key from app_roles r
  cross join (values ('page.letters'),('data.letters.write')) as p(key)
where r.key in ('admin','hr')
on conflict do nothing;
insert into role_permissions (role_key, perm_key)
select 'admin', 'data.letters.approve' from app_roles where key = 'admin'
on conflict do nothing;

-- ============================================================================
-- 8. การส่งอีเมล (ตั้งค่าเองในเว็บได้ แบบ TigerSoft) + แบบอีเมล (แก้ HTML ได้)
--    mode = 'outlook' → เว็บสร้างไฟล์เมล (.eml) ให้เปิดใน Outlook แล้วกดส่งเอง
--    mode = 'auto'    → ส่งอัตโนมัติจากอีเมลกลางผ่าน Microsoft Graph (แอปเดียวกับที่ TigerSoft ใช้ได้)
-- ⚠️ Client Secret เก็บแยกตาราง mail_secret ที่ไม่มี policy เลย — หน้าเว็บอ่านไม่ได้
--    เขียนได้ทางเดียวผ่าน mail_set_secret() · อ่านได้เฉพาะ Edge Function (service role) ตอนส่งเมล
-- ============================================================================
create table if not exists mail_settings (
  id         int primary key default 1 check (id = 1),
  mode       text not null default 'outlook' check (mode in ('outlook','auto')),
  tenant_id  text, client_id text, sender text,
  has_secret boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into mail_settings (id) values (1) on conflict do nothing;
create table if not exists mail_secret (id int primary key default 1 check (id = 1), client_secret text);
alter table mail_settings enable row level security;
alter table mail_secret   enable row level security;     -- ไม่มี policy = ไม่มีใครอ่าน/เขียนตรงได้
drop policy if exists "ms_read"  on mail_settings;
drop policy if exists "ms_write" on mail_settings;
create policy "ms_read"  on mail_settings for select using (has_perm('page.letters'));
create policy "ms_write" on mail_settings for update using (has_perm('data.letters.approve'));

create or replace function mail_set_secret(p_secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('data.letters.approve') then raise exception 'ไม่มีสิทธิ์ตั้งค่าอีเมล'; end if;
  insert into mail_secret (id, client_secret) values (1, nullif(trim(p_secret), ''))
  on conflict (id) do update set client_secret = excluded.client_secret;
  update mail_settings set has_secret = nullif(trim(p_secret), '') is not null, updated_at = now() where id = 1;
end $$;
revoke all on function mail_set_secret(text) from public, anon;
grant execute on function mail_set_secret(text) to authenticated;

-- แบบอีเมล — ตัวแปร: {{doc_no}} {{kind}} {{person}} {{emp_code}} {{link}} {{reason}} {{requester}} {{approver}}
create table if not exists mail_templates (
  key        text primary key check (key in ('request','approved','rejected')),
  label      text not null,
  subject    text not null,
  html       text not null,
  updated_at timestamptz not null default now()
);
alter table mail_templates enable row level security;
drop policy if exists "mt_read"  on mail_templates;
drop policy if exists "mt_write" on mail_templates;
create policy "mt_read"  on mail_templates for select using (has_perm('page.letters'));
create policy "mt_write" on mail_templates for update using (has_perm('data.letters.approve'));
insert into mail_templates (key, label, subject, html) values
('request', 'ขออนุมัติหนังสือ', '[ขออนุมัติ] {{doc_no}} {{kind}} — {{person}}',
$h$<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;color:#1e293b;max-width:560px">
  <div style="border-top:4px solid #2160C4;padding:18px 0 4px"><b style="font-size:16px;color:#0F1C4D">มีหนังสือรอการอนุมัติจากท่าน</b></div>
  <table style="border-collapse:collapse;margin:12px 0;font-size:14px">
    <tr><td style="padding:5px 18px 5px 0;color:#64748b">เลขที่</td><td><b>{{doc_no}}</b></td></tr>
    <tr><td style="padding:5px 18px 5px 0;color:#64748b">ประเภท</td><td>{{kind}}</td></tr>
    <tr><td style="padding:5px 18px 5px 0;color:#64748b">ออกให้</td><td>{{person}} {{emp_code}}</td></tr>
    <tr><td style="padding:5px 18px 5px 0;color:#64748b">ผู้ขอ</td><td>{{requester}}</td></tr>
  </table>
  <a href="{{link}}" style="display:inline-block;background:#2B5AC7;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:bold">เปิดหนังสือเพื่ออนุมัติ</a>
  <p style="color:#94a3b8;font-size:12px;margin-top:22px">ส่งจากระบบ HR · รายละเอียดหนังสือดูได้ในระบบเท่านั้น</p></div>$h$),
('approved', 'แจ้งอนุมัติแล้ว', '[อนุมัติแล้ว] {{doc_no}} — {{person}}',
$h$<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;color:#1e293b;max-width:560px">
  <div style="border-top:4px solid #0D7C4B;padding:18px 0 4px"><b style="font-size:16px;color:#0D7C4B">หนังสือได้รับการอนุมัติแล้ว</b></div>
  <p>{{doc_no}} · {{kind}} · {{person}} — อนุมัติโดย {{approver}} พิมพ์/บันทึก PDF ได้ในระบบ</p>
  <a href="{{link}}" style="display:inline-block;background:#0D7C4B;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:bold">เปิดหนังสือ</a>
  <p style="color:#94a3b8;font-size:12px;margin-top:22px">ส่งจากระบบ HR</p></div>$h$),
('rejected', 'แจ้งส่งกลับแก้ไข', '[ส่งกลับแก้ไข] {{doc_no}} — {{person}}',
$h$<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;color:#1e293b;max-width:560px">
  <div style="border-top:4px solid #C0392B;padding:18px 0 4px"><b style="font-size:16px;color:#C0392B">หนังสือถูกส่งกลับให้แก้ไข</b></div>
  <p>{{doc_no}} · {{kind}} · {{person}}</p>
  <p style="background:#FDECEA;border-radius:8px;padding:10px 14px">เหตุผล: {{reason}}</p>
  <a href="{{link}}" style="display:inline-block;background:#2B5AC7;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:bold">เปิดหนังสือเพื่อแก้ไข</a>
  <p style="color:#94a3b8;font-size:12px;margin-top:22px">ส่งจากระบบ HR</p></div>$h$)
on conflict (key) do nothing;

-- อีเมลของคนส่งขออนุมัติ (ไว้ส่งผลกลับในโหมด Outlook — หน้าเว็บอ่านอีเมลจาก auth.users ไม่ได้)
alter table hr_letters add column if not exists requested_email text;

-- ============================================================================
-- 9. สร้างหนังสือจากเลขที่ที่ออกในทะเบียนแล้ว (ปุ่ม "สร้างหนังสือ" ในทะเบียนเลขที่เอกสาร)
--    หนึ่งเลขที่ผูกได้หนังสือเดียว (ไม่นับฉบับที่ยกเลิก) — กดซ้ำจะได้ฉบับเดิม
-- ============================================================================
create unique index if not exists hr_letters_doc_live_idx on hr_letters (doc_id) where status <> 'cancelled' and doc_id is not null;

create or replace function hr_letters_guard() returns trigger language plpgsql as $$
declare approving boolean := current_setting('hr_letters.approving', true) = 'on';
        fromdoc   boolean := current_setting('hr_letters.fromdoc', true) = 'on';
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.signer is not null or new.approved_by is not null
       or (new.doc_id is not null and not fromdoc) then
      raise exception 'หนังสือใหม่ต้องเริ่มจากร่าง';
    end if;
    return new;
  end if;
  if not approving and (new.signer is distinct from old.signer or new.approved_by is distinct from old.approved_by
                        or (new.status = 'approved' and old.status <> 'approved')) then
    raise exception 'อนุมัติและใส่ลายเซ็นได้ผ่านปุ่มอนุมัติของผู้อนุมัติเท่านั้น';
  end if;
  if new.doc_id is distinct from old.doc_id and old.doc_id is not null then
    raise exception 'เลขที่หนังสือเปลี่ยนไม่ได้';
  end if;
  if old.status = 'pending' and new.status = 'pending' and (new.data is distinct from old.data or new.kind <> old.kind) then
    raise exception 'หนังสือรออนุมัติอยู่ — ดึงกลับเป็นร่างก่อนแก้ไข';
  end if;
  if old.status = 'approved' and (new.data is distinct from old.data or new.kind <> old.kind
       or new.signer is distinct from old.signer or new.status not in ('approved','cancelled')) then
    raise exception 'หนังสือที่อนุมัติแล้วแก้ไขไม่ได้ — ถ้าต้องแก้ให้ยกเลิกแล้วออกฉบับใหม่';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'หนังสือที่ยกเลิกแล้วนำกลับมาใช้ไม่ได้';
  end if;
  return new;
end $$;

create or replace function letter_from_doc(p_doc_id bigint, p_kind text)
returns hr_letters language plpgsql security definer set search_path = public as $$
declare d doc_register; l hr_letters;
begin
  if not has_perm('data.letters.write') then raise exception 'ไม่มีสิทธิ์ออกหนังสือ'; end if;
  select * into l from hr_letters where doc_id = p_doc_id and status <> 'cancelled' limit 1;
  if l.id is not null then return l; end if;                     -- มีหนังสือของเลขนี้แล้ว → เปิดฉบับเดิม
  select * into d from doc_register where id = p_doc_id;
  if d.id is null or d.status <> 'active' then raise exception 'เลขที่นี้ใช้ไม่ได้ (ไม่พบ หรือถูกยกเลิกแล้ว)'; end if;
  perform set_config('hr_letters.fromdoc', 'on', true);
  insert into hr_letters (kind, emp_code, person_name, doc_id, doc_no, created_by)
  values (p_kind, d.emp_code, d.person_name, d.id, d.doc_no, auth.uid()) returning * into l;
  return l;
end $$;
revoke all on function letter_from_doc(bigint, text) from public, anon;
grant execute on function letter_from_doc(bigint, text) to authenticated;

-- ============================================================================
-- 10. ผู้รับเพิ่มเติมของแต่ละแบบอีเมล (แก้ได้ในหน้าตั้งค่า) — ผู้รับหลักยังใส่ให้อัตโนมัติ
--     to_extra / cc: อีเมลคั่นด้วยจุลภาค
-- ============================================================================
alter table mail_templates add column if not exists to_extra text;
alter table mail_templates add column if not exists cc text;

-- ============================================================================
-- 11. ยกเลิกหนังสือ — เลือกได้ว่าจะยกเลิกเลขที่ด้วย หรือเก็บเลขไว้ออกฉบับใหม่ในเลขเดิม
--     ทั้งสองแบบเก็บประวัติไว้: หนังสือที่ยกเลิกยังอยู่ในตาราง (สถานะ cancelled + เหตุผล)
--     และทะเบียนแสดงว่าเลขนี้เคยมีหนังสือยกเลิกกี่ฉบับ
-- ============================================================================
alter table hr_letters add column if not exists cancel_reason text;
alter table hr_letters add column if not exists cancelled_at  timestamptz;
alter table hr_letters add column if not exists cancelled_by  uuid;

create or replace function letter_cancel(p_id bigint, p_reason text, p_void_number boolean)
returns hr_letters language plpgsql security definer set search_path = public as $$
declare l hr_letters;
begin
  if not has_perm('data.letters.write') then raise exception 'ไม่มีสิทธิ์ยกเลิกหนังสือ'; end if;
  select * into l from hr_letters where id = p_id for update;
  if l.id is null then raise exception 'ไม่พบหนังสือ'; end if;
  if l.status = 'cancelled' then raise exception 'หนังสือนี้ยกเลิกไปแล้ว'; end if;
  update hr_letters set status = 'cancelled', cancel_reason = nullif(trim(p_reason), ''),
         cancelled_at = now(), cancelled_by = auth.uid()
   where id = p_id returning * into l;
  if p_void_number and l.doc_id is not null then
    update doc_register set status = 'void', voided_at = now(), voided_by = auth.uid(),
           void_reason = 'ยกเลิกหนังสือ' || coalesce(': ' || nullif(trim(p_reason), ''), '')
     where id = l.doc_id and status <> 'void';
  end if;
  return l;
end $$;
revoke all on function letter_cancel(bigint, text, boolean) from public, anon;
grant execute on function letter_cancel(bigint, text, boolean) to authenticated;

-- ยกเลิกเลขในทะเบียน → หนังสือที่ผูกกับเลขนั้นถูกยกเลิกตาม (เลขที่ยกเลิกแล้วจะมีหนังสือที่ใช้งานอยู่ไม่ได้)
create or replace function doc_void_cascade() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'void' and old.status <> 'void' then
    update hr_letters set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
           cancel_reason = coalesce(cancel_reason, 'ยกเลิกเลขในทะเบียน' || coalesce(': ' || new.void_reason, ''))
     where doc_id = new.id and status <> 'cancelled';
  end if;
  return new;
end $$;
drop trigger if exists doc_void_cascade on doc_register;
create trigger doc_void_cascade after update on doc_register
  for each row execute function doc_void_cascade();

-- ============================================================================
-- 12. Admin ตั้งลายเซ็นแทนผู้อนุมัติได้ (ผู้อนุมัติส่งไฟล์ให้แอดมินอัปโหลดให้)
--     ลายเซ็นยังใช้ได้เฉพาะตอนเจ้าของกดอนุมัติเอง (letter_approve ใช้ลายเซ็นของ auth.uid())
--     แอดมินจึงตั้งให้ได้ แต่เอาไปเซ็นแทนไม่ได้ · set_by เก็บไว้ว่าใครเป็นคนตั้ง
-- ============================================================================
alter table letter_signers add column if not exists set_by uuid;

drop policy if exists "ls_write" on letter_signers;
create policy "ls_write" on letter_signers for all
  using ((user_id = auth.uid() and has_perm('data.letters.approve')) or get_my_role() = 'admin')
  with check ((user_id = auth.uid() and has_perm('data.letters.approve')) or get_my_role() = 'admin');

drop policy if exists "la_write"  on storage.objects;
drop policy if exists "la_update" on storage.objects;
drop policy if exists "la_delete" on storage.objects;
create policy "la_write" on storage.objects for insert with check (bucket_id = 'letter-assets' and has_perm('data.letters.approve')
  and ((storage.foldername(name))[1] = 'seal' or ((storage.foldername(name))[1] = 'signatures'
       and ((storage.foldername(name))[2] = auth.uid()::text or get_my_role() = 'admin'))));
create policy "la_update" on storage.objects for update using (bucket_id = 'letter-assets' and has_perm('data.letters.approve')
  and ((storage.foldername(name))[1] = 'seal' or ((storage.foldername(name))[1] = 'signatures'
       and ((storage.foldername(name))[2] = auth.uid()::text or get_my_role() = 'admin'))));
create policy "la_delete" on storage.objects for delete using (bucket_id = 'letter-assets' and has_perm('data.letters.approve')
  and ((storage.foldername(name))[1] = 'seal' or ((storage.foldername(name))[1] = 'signatures'
       and ((storage.foldername(name))[2] = auth.uid()::text or get_my_role() = 'admin'))));

-- ============================================================================
-- 13. อนุมัติ / ส่งกลับ ได้เฉพาะผู้อนุมัติที่ถูกเลือกตอนส่ง (ยืนยันกับผู้ใช้ 2026-10-02)
--     ผู้อนุมัติคนอื่นเห็นหนังสือได้แต่กดไม่ได้ · ถ้าคนที่เลือกไม่อยู่ ให้ผู้ส่งดึงกลับแล้วส่งใหม่ถึงอีกคน
--     ส่งกลับ (rejected) ก็ต้องผ่านฟังก์ชันเท่านั้น — กันการแก้สถานะตรงในตาราง
-- ============================================================================
create or replace function letter_submit(p_id bigint, p_approver uuid, p_type_label text)
returns hr_letters language plpgsql security definer set search_path = public as $$
declare l hr_letters; d doc_register; tid bigint;
begin
  if not has_perm('data.letters.write') then raise exception 'ไม่มีสิทธิ์ออกหนังสือ'; end if;
  if p_approver is null or not exists (select 1 from letter_signers where user_id = p_approver and signature_path is not null) then
    raise exception 'เลือกผู้อนุมัติที่ตั้งลายเซ็นไว้แล้ว';
  end if;
  select * into l from hr_letters where id = p_id for update;
  if l.id is null then raise exception 'ไม่พบหนังสือ'; end if;
  if l.status not in ('draft','rejected') then raise exception 'หนังสือนี้ส่งไปแล้ว'; end if;
  if l.doc_id is null then
    select id into tid from doc_types where series_code = 'HR' and label = p_type_label;
    select * into d from doc_issue('HR', 1, tid, null, current_date, null, 'ออกจากระบบออกหนังสือ',
                                   jsonb_build_array(jsonb_build_object('emp_code', l.emp_code, 'person_name', l.person_name)));
    l.doc_id := d.id; l.doc_no := d.doc_no;
  end if;
  update hr_letters set status = 'pending', doc_id = l.doc_id, doc_no = l.doc_no, approver_id = p_approver,
         requested_by = auth.uid(), requested_at = now(), reject_reason = null
   where id = p_id returning * into l;
  return l;
end $$;

create or replace function letter_approve(p_id bigint)
returns hr_letters language plpgsql security definer set search_path = public as $$
declare l hr_letters; s letter_signers; st letter_settings;
begin
  if not has_perm('data.letters.approve') then raise exception 'ไม่มีสิทธิ์อนุมัติหนังสือ'; end if;
  select * into l from hr_letters where id = p_id for update;
  if l.status <> 'pending' then raise exception 'หนังสือนี้ไม่ได้อยู่ในสถานะรออนุมัติ'; end if;
  if l.approver_id is distinct from auth.uid() then raise exception 'หนังสือนี้ส่งถึงผู้อนุมัติคนอื่น — อนุมัติได้เฉพาะคนที่ถูกเลือก'; end if;
  select * into s from letter_signers where user_id = auth.uid();
  if s.signature_path is null then raise exception 'ยังไม่ได้อัปโหลดลายเซ็น — ตั้งค่าที่ “ลายเซ็นของฉัน” ก่อน'; end if;
  select * into st from letter_settings where id = 1;
  perform set_config('hr_letters.approving', 'on', true);
  update hr_letters set status = 'approved', approved_by = auth.uid(), approved_at = now(),
         signer = jsonb_build_object('name_th', s.name_th, 'title_th', s.title_th, 'name_en', s.name_en, 'title_en', s.title_en,
                                     'signature_path', s.signature_path, 'seal_path', st.seal_path)
   where id = p_id returning * into l;
  return l;
end $$;

create or replace function letter_reject(p_id bigint, p_reason text)
returns hr_letters language plpgsql security definer set search_path = public as $$
declare l hr_letters;
begin
  if not has_perm('data.letters.approve') then raise exception 'ไม่มีสิทธิ์อนุมัติหนังสือ'; end if;
  select * into l from hr_letters where id = p_id for update;
  if l.status is distinct from 'pending' then raise exception 'หนังสือนี้ไม่ได้อยู่ในสถานะรออนุมัติ'; end if;
  if l.approver_id is distinct from auth.uid() then raise exception 'หนังสือนี้ส่งถึงผู้อนุมัติคนอื่น — ส่งกลับได้เฉพาะคนที่ถูกเลือก'; end if;
  perform set_config('hr_letters.approving', 'on', true);
  update hr_letters set status = 'rejected', reject_reason = nullif(trim(p_reason), '')
   where id = p_id returning * into l;
  return l;
end $$;

create or replace function hr_letters_guard() returns trigger language plpgsql as $$
declare approving boolean := current_setting('hr_letters.approving', true) = 'on';
        fromdoc   boolean := current_setting('hr_letters.fromdoc', true) = 'on';
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.signer is not null or new.approved_by is not null
       or (new.doc_id is not null and not fromdoc) then
      raise exception 'หนังสือใหม่ต้องเริ่มจากร่าง';
    end if;
    return new;
  end if;
  if not approving and (new.signer is distinct from old.signer or new.approved_by is distinct from old.approved_by
                        or (new.status = 'approved' and old.status <> 'approved')
                        or (new.status = 'rejected' and old.status <> 'rejected')) then
    raise exception 'อนุมัติ / ส่งกลับ ได้ผ่านปุ่มของผู้อนุมัติที่ถูกเลือกเท่านั้น';
  end if;
  -- ผู้อนุมัติเปลี่ยนได้ตอนส่ง (letter_submit) เท่านั้น ไม่ใช่ระหว่างรออนุมัติ
  if old.status = 'pending' and new.status = 'pending' and new.approver_id is distinct from old.approver_id then
    raise exception 'เปลี่ยนผู้อนุมัติไม่ได้ระหว่างรอ — ดึงกลับแล้วส่งใหม่';
  end if;
  if new.doc_id is distinct from old.doc_id and old.doc_id is not null then
    raise exception 'เลขที่หนังสือเปลี่ยนไม่ได้';
  end if;
  if old.status = 'pending' and new.status = 'pending' and (new.data is distinct from old.data or new.kind <> old.kind) then
    raise exception 'หนังสือรออนุมัติอยู่ — ดึงกลับเป็นร่างก่อนแก้ไข';
  end if;
  if old.status = 'approved' and (new.data is distinct from old.data or new.kind <> old.kind
       or new.signer is distinct from old.signer or new.status not in ('approved','cancelled')) then
    raise exception 'หนังสือที่อนุมัติแล้วแก้ไขไม่ได้ — ถ้าต้องแก้ให้ยกเลิกแล้วออกฉบับใหม่';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'หนังสือที่ยกเลิกแล้วนำกลับมาใช้ไม่ได้';
  end if;
  return new;
end $$;
