-- ============================================================================
-- ยืนยันการพ้นสภาพ (ลาออก / เลิกจ้าง / เกษียณ) ก่อนเปลี่ยนสถานะพนักงาน — user 2026-10-16
--   วิธีใช้: Supabase Dashboard > SQL Editor > วางทั้งไฟล์ > Run (รันซ้ำได้)
--
--   เดิม: บันทึก Resignation ล่วงหน้า → สถานะพนักงานเป็น Resigned ทันที ทั้งที่ยังไม่ถึงวันที่มีผล
--   ใหม่: บันทึกแล้วเก็บ "วันพ้นสภาพ" (employees.end_date) แต่สถานะยัง Active
--         → รายการขึ้นใน "รอยืนยันการพ้นสภาพ" หน้า Staff Movement → ถึงวันที่มีผล HR กดยืนยัน → สถานะเปลี่ยน
--   รายงานกำลังคนนับจาก end_date + รายการ movement อยู่แล้ว (ไม่ดูสถานะ) → ตัวเลขรายงานไม่เปลี่ยน
-- ============================================================================
alter table movements add column if not exists sep_confirmed_at timestamptz;
alter table movements add column if not exists sep_confirmed_by text;

-- รายการพ้นสภาพเดิมที่ถึงวันที่มีผลแล้ว = ถือว่ายืนยันแล้ว (ไม่ให้ขึ้นรอยืนยันย้อนหลังทั้งหมด)
update movements set sep_confirmed_at = coalesce(updated_at, created_at, now()), sep_confirmed_by = '(ก่อนมีขั้นยืนยัน)'
 where type in ('Resignation','Termination','Retirement') and sep_confirmed_at is null
   and (date is null or date <= current_date);

-- คนที่ถูกเปลี่ยนเป็นพ้นสภาพไปก่อนวันที่มีผล → กลับเป็น Active (วันพ้นสภาพยังอยู่) · ผลลัพธ์แสดงรายชื่อที่เปลี่ยน
update employees e set status = 'Active', updated_at = now()
  from movements m
 where m.emp_code = e.emp_code and m.type in ('Resignation','Termination','Retirement')
   and m.sep_confirmed_at is null and m.date > current_date
   and e.status in ('Resigned','Terminated','Retired')
returning e.emp_code, e.firstname_th, e.lastname_th, e.end_date as "วันพ้นสภาพ", m.type;
