-- ============================================================================
-- HR Invoice Hub — เปลี่ยนชื่อใต้ลายเซ็นในใบที่ลงนามไปแล้วเป็นภาษาอังกฤษ (user 2026-10-21)
--   ชื่อในใบเป็นสำเนา ณ ตอนกดลงนาม (exp_sig: name_en ถ้ามี ไม่งั้น name_th)
--   คนที่ลงนามตอนยังไม่ได้ตั้ง Name (EN) ชื่อในใบจึงเป็นภาษาไทย
--   ⚠️ ตั้ง Name (EN) ที่หน้า ตั้งค่า ของ Invoice Hub ให้ครบทุกคนก่อน แล้วค่อยรันไฟล์นี้ (รันซ้ำได้)
--   แตะเฉพาะชื่อในช่อง Prepared / Reviewed / Approved — ลายเซ็น วันที่ สถานะ เลขที่ ไม่เปลี่ยน
-- ============================================================================
alter table exp_invoices disable trigger exp_inv_guard;
alter table exp_invoices disable trigger exp_token_issue;

update exp_invoices i set preparer = jsonb_set(i.preparer, '{name}', to_jsonb(g.name_en))
  from letter_signers g
 where g.user_id = i.prepared_by and coalesce(g.name_en, '') <> ''
   and i.preparer is not null and i.preparer->>'name' is distinct from g.name_en;

update exp_invoices i set reviewer = jsonb_set(i.reviewer, '{name}', to_jsonb(g.name_en))
  from letter_signers g
 where g.user_id = i.reviewer_id and coalesce(g.name_en, '') <> ''
   and i.reviewer is not null and i.reviewer->>'name' is distinct from g.name_en;

update exp_invoices i set approver = jsonb_set(i.approver, '{name}', to_jsonb(g.name_en))
  from letter_signers g
 where g.user_id = i.approver_id and coalesce(g.name_en, '') <> ''
   and i.approver is not null and i.approver->>'name' is distinct from g.name_en;

alter table exp_invoices enable trigger exp_token_issue;
alter table exp_invoices enable trigger exp_inv_guard;

-- ตรวจผล: ใบที่ยังมีชื่อภาษาไทยเหลืออยู่ (คนนั้นยังไม่ได้ตั้ง Name (EN))
select inv_no, preparer->>'name' as prepared, reviewer->>'name' as reviewed, approver->>'name' as approved
  from exp_invoices
 where coalesce(preparer->>'name','') ~ '[ก-๙]' or coalesce(reviewer->>'name','') ~ '[ก-๙]' or coalesce(approver->>'name','') ~ '[ก-๙]'
 order by inv_no;
