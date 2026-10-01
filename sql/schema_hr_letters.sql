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
create policy "ls_read"  on letter_signers for select using (has_perm('page.letters'));
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
  using (bucket_id = 'letter-assets' and (has_perm('data.letters.write') or has_perm('data.letters.approve')));
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
