-- ตารางแจ้งเตือน (กระดิ่ง) แบบ shared ทุก user เห็นเหมือนกัน
-- แทนที่ localStorage เดิมซึ่งแยกเครื่อง/แยกเบราว์เซอร์ ทำให้ user อื่นไม่เห็นสิ่งที่คนอื่นเพิ่ม
-- รันใน Supabase SQL editor — รันซ้ำได้ปลอดภัย (idempotent)
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

-- อ่านได้ทุกคนที่ล็อกอิน, เพิ่ม/อัปเดตได้ทุกคนที่ล็อกอิน (ไม่มีลบ — เป็น log แจ้งเตือน)
drop policy if exists "notif_read"   on notifications;
drop policy if exists "notif_insert" on notifications;
drop policy if exists "notif_update" on notifications;
create policy "notif_read"   on notifications for select using (auth.role() = 'authenticated');
create policy "notif_insert" on notifications for insert with check (auth.role() = 'authenticated');
create policy "notif_update" on notifications for update using (auth.role() = 'authenticated');

-- เพิ่มเข้า realtime publication (กันซ้ำถ้าเคยเพิ่มแล้ว)
do $$ begin
  alter publication supabase_realtime add table notifications;
exception when duplicate_object then null;
end $$;
