-- Job Level ใหม่ของรายการ Staff Movement (ตำแหน่งเปลี่ยน ระดับมักเปลี่ยนด้วย) — รันซ้ำได้ปลอดภัย
-- ว่าง = ไม่เปลี่ยนระดับ · บันทึกแล้วระบบอัปเดต employees.job_level ให้ (Transfer / Promotion / Demotion / New Hire)
alter table movements add column if not exists job_level text;
