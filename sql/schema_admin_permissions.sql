-- สิทธิ์ระดับฐานข้อมูล (RLS) — รันใน Supabase SQL editor (idempotent รันซ้ำได้)
-- 1) admin แก้/ลบ movement ได้ทุกรายการ (ไม่ใช่เฉพาะที่ตัวเองสร้าง)
-- 2) ย้ำว่าเฉพาะ admin เท่านั้นที่แก้/ลบ role ได้ (กัน HR/user แก้สิทธิ admin)

-- movements: เจ้าของ หรือ admin แก้/ลบได้
drop policy if exists "movements_update" on movements;
drop policy if exists "movements_delete" on movements;
create policy "movements_update" on movements for update using (created_by = auth.uid() or get_my_role() = 'admin');
create policy "movements_delete" on movements for delete using (created_by = auth.uid() or get_my_role() = 'admin');

-- user_roles: เฉพาะ admin แก้/ลบ role ได้
drop policy if exists "roles_update" on user_roles;
drop policy if exists "roles_delete" on user_roles;
create policy "roles_update" on user_roles for update using (get_my_role() = 'admin');
create policy "roles_delete" on user_roles for delete using (get_my_role() = 'admin');
