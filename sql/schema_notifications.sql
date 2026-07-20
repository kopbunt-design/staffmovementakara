-- ตารางแจ้งเตือน (กระดิ่ง) แบบ shared ทุก user เห็นเหมือนกัน
-- แทนที่ localStorage เดิมซึ่งแยกเครื่อง/แยกเบราว์เซอร์ ทำให้ user อื่นไม่เห็นสิ่งที่คนอื่นเพิ่ม
-- รันใน Supabase SQL editor ครั้งเดียว
create table if not exists notifications (
  id          bigint generated always as identity primary key,
  title       text not null,
  detail      text,
  category    text default 'default',
  dedup_key   text unique,          -- ใช้กันแจ้งซ้ำแบบ global (proactive alerts) — null ได้สำหรับรายการที่ user กดเพิ่มเอง
  created_at  timestamptz default now(),
  created_by  uuid
);

alter table notifications enable row level security;

-- อ่านได้ทุกคนที่ล็อกอิน, เพิ่มได้ทุกคนที่ล็อกอิน (ไม่มีแก้/ลบ — เป็น log แจ้งเตือนอย่างเดียว)
create policy "notif_read"   on notifications for select using (auth.role() = 'authenticated');
create policy "notif_insert" on notifications for insert with check (auth.role() = 'authenticated');
-- upsert (สำหรับ proactive alerts ที่ชน dedup_key) ต้องมีสิทธิ์ update แถวเดิมของตัวเองด้วย
create policy "notif_update" on notifications for update using (auth.role() = 'authenticated');

alter publication supabase_realtime add table notifications;
