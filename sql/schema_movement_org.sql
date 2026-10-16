-- ============================================================================
-- หน่วยงานก่อนย้ายของรายการ Movement (user 2026-10-16: "แยก division/department/section/team ให้ยึดวันที่มีผล")
--   วิธีใช้: Supabase Dashboard > SQL Editor > วางทั้งไฟล์ > Run (รันซ้ำได้)
--   org_from = {division, department, section, team, position, job_level} ของพนักงาน "ก่อน" รายการนี้มีผล
--   บันทึกให้อัตโนมัติตอนเพิ่ม Transfer / Promotion / Demotion / Secondment (ฟอร์ม · นำเข้า Excel · PAF)
--   รายงานย้อนหลัง (makeOrgAt ใน js/app.js) ใช้ย้อนว่าก่อนวันที่มีผลคนนี้อยู่หน่วยงานไหน
--   รายการเก่าที่ไม่มี org_from: ย้อนได้แค่แผนก + ตำแหน่ง จาก from_dept ("แผนก / ตำแหน่ง")
-- ============================================================================
alter table movements add column if not exists org_from jsonb;
