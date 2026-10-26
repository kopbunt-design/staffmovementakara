-- ============================================================================
-- ย้ายไป Azure — ลิงก์ลงนามที่ยังค้าง (หน้าเว็บอ่านตารางพวกนี้ไม่ได้โดยตั้งใจ)
-- รันใน Supabase → SQL Editor → Run → Download CSV → อัปโหลดที่หน้า /migrate/ ปุ่ม "2b) นำเข้าไฟล์ลิงก์ค้าง"
-- ไฟล์นี้มีลิงก์อนุมัติที่ยังใช้ได้ — เก็บในเครื่องตัวเอง อย่าส่งต่อ ลบทิ้งหลังนำเข้า
-- ============================================================================
select json_build_object(
  'ec_sign_tokens',      (select coalesce(json_agg(t), '[]') from ec_sign_tokens t),
  'exp_approve_tokens',  (select coalesce(json_agg(t), '[]') from exp_approve_tokens t),
  'paf_tokens',          (select coalesce(json_agg(t), '[]') from paf_tokens t),
  'payroll_sign_tokens', (select coalesce(json_agg(t), '[]') from payroll_sign_tokens t),
  'fund_invite_attempt', (select coalesce(json_agg(t), '[]') from fund_invite_attempt t)
) as tokens;
