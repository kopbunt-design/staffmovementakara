-- ============================================================================
-- สารบัญเอกสาร HR (เว็บแยก /docs) — ต่อจากทะเบียนเลขที่เอกสาร · user 2026-10-16
--   วิธีใช้: Supabase Dashboard > SQL Editor > วางทั้งไฟล์ > Run (รันซ้ำได้) · ต้องรัน schema_doc_register.sql มาก่อน
--
--   ทุกเลขที่ออกจากที่ไหนก็ตาม (ออกเลขเอง / ออกหนังสือ HR / PAF) อยู่ในตาราง doc_register ตารางเดียว → สารบัญเห็นอัตโนมัติ
--   เพิ่ม: ทะเบียนรับ (ชุด IN → RCV-###-ปี) · ชั้นความลับ · ไฟล์แนบ (bucket doc-files) · บันทึกการเปิด/แนบ/ลบไฟล์
--   เอกสารลับ: ทั้งแถวและไฟล์เห็นได้เฉพาะผู้มีสิทธิ์ data.doc.confidential (ประเภทที่ตั้งเป็นลับ → เลขใหม่เป็นลับอัตโนมัติ)
--   ยังไม่มีอายุการเก็บ (retention) — ผู้ใช้ขอไว้ก่อน 2026-10-16
-- ============================================================================

-- ------------------------------------------------------------ 1. ทะเบียนรับ + คอลัมน์ใหม่
alter table doc_series add column if not exists direction text not null default 'out';
alter table doc_series drop constraint if exists doc_series_direction_check;
alter table doc_series add constraint doc_series_direction_check check (direction in ('out','in'));
insert into doc_series (code, label, prefix, sort_order, direction) values ('IN', 'หนังสือรับเข้า', 'RCV', 9, 'in')
on conflict (code) do update set direction = 'in';

alter table doc_types add column if not exists confidential boolean not null default false;
alter table doc_types add column if not exists form_code text;          -- รหัสแบบฟอร์ม เช่น AKR-OHR-FM-031 Rev. 00
insert into doc_types (series_code, label, sort_order) values
  ('IN', 'หนังสือจากหน่วยงานราชการ', 10),
  ('IN', 'หนังสือจากบริษัท / หน่วยงานภายนอก', 20),
  ('IN', 'หนังสือจากพนักงาน', 30),
  ('IN', 'อื่น ๆ', 99)
on conflict (series_code, label) do nothing;
-- ลับโดยค่าเริ่มต้น: เงินเดือน / เลิกจ้าง / PAF (แก้ได้ในหน้าตั้งค่า)
update doc_types set confidential = true
 where label in ('หนังสือรับรองเงินเดือน (ภาษาไทย)', 'หนังสือรับรองเงินเดือน (ภาษาอังกฤษ)', 'หนังสือเลิกจ้าง (Terminate)', 'หนังสือปรับเงินเดือน', 'Personnel Action Form')
   and not confidential;
update doc_types set form_code = 'AKR-OHR-FM-031 Rev. 00' where series_code = 'PAF' and form_code is null;

-- (คอลัมน์ confidential + doc_visible + policy อ่าน อยู่ใน schema_doc_register.sql ด้วย — ชุดเดียวกัน แก้ให้ตรงกันทั้งสองไฟล์)
alter table doc_register add column if not exists confidential boolean not null default false;
alter table doc_register add column if not exists form_code text;
alter table doc_register add column if not exists sender text;          -- ทะเบียนรับ: หนังสือจากใคร
alter table doc_register add column if not exists received_date date;   -- ทะเบียนรับ: วันที่ได้รับ (issued_date = วันลงรับ)

-- เลขใหม่รับชั้นความลับ/รหัสแบบฟอร์มจากประเภท
create or replace function doc_register_defaults() returns trigger language plpgsql as $$
declare c boolean; fc text;
begin
  select t.confidential, t.form_code into c, fc from doc_types t where t.id = new.type_id;
  new.confidential := coalesce(new.confidential, false) or coalesce(c, false);
  new.form_code := coalesce(new.form_code, fc);
  return new;
end $$;
drop trigger if exists doc_register_defaults on doc_register;
create trigger doc_register_defaults before insert on doc_register for each row execute function doc_register_defaults();
update doc_register r set confidential = true from doc_types t where r.type_id = t.id and t.confidential and not r.confidential;
update doc_register r set form_code = t.form_code from doc_types t where r.type_id = t.id and r.form_code is null and t.form_code is not null;

-- ปลดความลับได้เฉพาะผู้มีสิทธิ์ดูเอกสารลับ (ตั้งให้ลับได้ทุกคนที่แก้ทะเบียนได้)
create or replace function doc_register_conf_guard() returns trigger language plpgsql as $$
begin
  if old.confidential and not new.confidential and not has_perm('data.doc.confidential') then
    raise exception 'ปลดชั้นความลับได้เฉพาะผู้มีสิทธิ์ดูเอกสารลับ';
  end if;
  return new;
end $$;
drop trigger if exists doc_register_conf_guard on doc_register;
create trigger doc_register_conf_guard before update on doc_register for each row execute function doc_register_conf_guard();

-- ------------------------------------------------------------ 2. ใครเห็นอะไร (ชุดเดียวกับ schema_doc_register.sql)
create or replace function doc_visible(p_confidential boolean) returns boolean
language sql stable set search_path = public as $$
  select has_perm('page.docregister') and (not coalesce(p_confidential, false) or has_perm('data.doc.confidential'));
$$;
drop policy if exists "doc_reg_read"   on doc_register;
drop policy if exists "doc_reg_update" on doc_register;
create policy "doc_reg_read"   on doc_register for select using (doc_visible(confidential));
create policy "doc_reg_update" on doc_register for update using (has_perm('data.docregister.write') and doc_visible(confidential));

-- ------------------------------------------------------------ 3. ไฟล์แนบ (storage: doc-files/<doc_id>/<ไฟล์>)
create table if not exists doc_files (
  id            bigint generated always as identity primary key,
  doc_id        bigint not null references doc_register(id) on delete cascade,
  name          text not null,
  path          text not null unique,
  size          bigint,
  mime          text,
  note          text,
  uploaded_by   uuid default auth.uid(),
  uploaded_name text,
  uploaded_at   timestamptz not null default now()
);
create index if not exists doc_files_doc_idx on doc_files (doc_id);
alter table doc_files enable row level security;
drop policy if exists "docf_read"   on doc_files;
drop policy if exists "docf_insert" on doc_files;
drop policy if exists "docf_delete" on doc_files;
create policy "docf_read"   on doc_files for select using (exists (select 1 from doc_register r where r.id = doc_id and doc_visible(r.confidential)));
create policy "docf_insert" on doc_files for insert with check (has_perm('data.docregister.write') and exists (select 1 from doc_register r where r.id = doc_id and doc_visible(r.confidential)));
create policy "docf_delete" on doc_files for delete using (has_perm('data.docregister.write') and exists (select 1 from doc_register r where r.id = doc_id and doc_visible(r.confidential)));

insert into storage.buckets (id, name, public) values ('doc-files', 'doc-files', false) on conflict (id) do nothing;
drop policy if exists "docfs_read"   on storage.objects;
drop policy if exists "docfs_insert" on storage.objects;
drop policy if exists "docfs_delete" on storage.objects;
create policy "docfs_read" on storage.objects for select using (bucket_id = 'doc-files'
  and exists (select 1 from doc_register r where r.id::text = (storage.foldername(name))[1] and doc_visible(r.confidential)));
create policy "docfs_insert" on storage.objects for insert with check (bucket_id = 'doc-files' and has_perm('data.docregister.write')
  and exists (select 1 from doc_register r where r.id::text = (storage.foldername(name))[1] and doc_visible(r.confidential)));
create policy "docfs_delete" on storage.objects for delete using (bucket_id = 'doc-files' and has_perm('data.docregister.write')
  and exists (select 1 from doc_register r where r.id::text = (storage.foldername(name))[1] and doc_visible(r.confidential)));

-- ------------------------------------------------------------ 4. บันทึกการเปิด / แนบ / ลบไฟล์ (เขียนผ่าน doc_log เท่านั้น)
create table if not exists doc_access_log (
  id         bigint generated always as identity primary key,
  doc_id     bigint not null references doc_register(id) on delete cascade,
  file_id    bigint,
  file_name  text,
  action     text not null check (action in ('open','upload','delete')),
  user_id    uuid,
  user_name  text,
  at         timestamptz not null default now()
);
create index if not exists doc_access_log_idx on doc_access_log (doc_id, at desc);
alter table doc_access_log enable row level security;
drop policy if exists "docl_read" on doc_access_log;
create policy "docl_read" on doc_access_log for select using (exists (select 1 from doc_register r where r.id = doc_id and doc_visible(r.confidential)));

create or replace function doc_log(p_doc_id bigint, p_file_id bigint, p_file_name text, p_action text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from doc_register r where r.id = p_doc_id and doc_visible(r.confidential)) then raise exception 'ไม่มีสิทธิ์'; end if;
  insert into doc_access_log (doc_id, file_id, file_name, action, user_id, user_name)
  values (p_doc_id, p_file_id, p_file_name, p_action, auth.uid(),
          (select coalesce(nullif(g.name_th, ''), nullif(r.name, ''), u.email) from auth.users u
             left join letter_signers g on g.user_id = u.id left join user_roles r on r.user_id = u.id where u.id = auth.uid()));
end $$;

-- ------------------------------------------------------------ 5. เลขนี้มาจากระบบไหน (หนังสือ HR / PAF) — เฉพาะเลขที่ผู้เรียกเห็นได้
create or replace function doc_sources() returns table (doc_id bigint, kind text, source_id bigint, status text, decided_at timestamptz)
language sql stable security definer set search_path = public as $$
  select * from (select distinct on (l.doc_id) l.doc_id, 'letter'::text, l.id, l.status, l.approved_at
                   from hr_letters l join doc_register r on r.id = l.doc_id
                  where doc_visible(r.confidential) order by l.doc_id, (l.status = 'cancelled'), l.id desc) a
  union all
  select * from (select distinct on (f.doc_id) f.doc_id, 'paf'::text, f.id, f.status, f.approved_at
                   from paf_forms f join doc_register r on r.id = f.doc_id
                  where doc_visible(r.confidential) order by f.doc_id, (f.status = 'cancelled'), f.id desc) b;
$$;

revoke all on function doc_log(bigint, bigint, text, text), doc_sources() from public, anon;
grant execute on function doc_log(bigint, bigint, text, text), doc_sources() to authenticated;

-- ------------------------------------------------------------ 6. สิทธิ์
insert into permissions (key, category, label, description, sort_order) values
  ('data.doc.confidential', 'data', 'ดูเอกสารลับ', 'เห็นเลขที่และเปิดไฟล์ของเอกสารลับในสารบัญ (เงินเดือน เลิกจ้าง PAF) · ปลดความลับได้', 44)
on conflict (key) do update set label = excluded.label, description = excluded.description;
insert into role_permissions (role_key, perm_key)
select r.key, 'data.doc.confidential' from app_roles r where r.key = 'admin' on conflict do nothing;

select code, prefix, direction from doc_series order by sort_order;
