-- แนบเอกสารประกอบรายการ Staff Movement (เช่น ใบลาออก หนังสืออนุมัติ)
-- รันใน Supabase SQL editor — รันซ้ำได้ปลอดภัย (idempotent)

-- 1) คอลัมน์เก็บที่อยู่ไฟล์ในตาราง movements
alter table movements add column if not exists attachment_path text;  -- path ใน storage bucket
alter table movements add column if not exists attachment_name text;  -- ชื่อไฟล์เดิมไว้แสดงผล

-- 2) ที่เก็บไฟล์ — ตั้งเป็น private ไม่ให้เดา URL เข้าถึงได้
--    การเปิดดูใช้ signed URL อายุสั้นที่สร้างจากฝั่งแอป (js/app.js _movDoc)
insert into storage.buckets (id, name, public)
values ('movement-docs', 'movement-docs', false)
on conflict (id) do nothing;

-- 3) สิทธิ์เข้าถึงไฟล์ — อ่านได้ทุกคนที่ล็อกอิน, อัปโหลด/ลบเฉพาะ HR + Admin
--    (ให้ตรงกับสิทธิ์บันทึก movement ในหน้าเว็บ)
drop policy if exists "movdoc_read"   on storage.objects;
drop policy if exists "movdoc_write"  on storage.objects;
drop policy if exists "movdoc_delete" on storage.objects;
create policy "movdoc_read" on storage.objects for select
  using (bucket_id = 'movement-docs' and auth.role() = 'authenticated');
create policy "movdoc_write" on storage.objects for insert
  with check (bucket_id = 'movement-docs' and get_my_role() in ('hr','admin'));
create policy "movdoc_delete" on storage.objects for delete
  using (bucket_id = 'movement-docs' and get_my_role() in ('hr','admin'));
