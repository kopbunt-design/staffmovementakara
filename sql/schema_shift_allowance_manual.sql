-- ค่ากะ: เพิ่มการแก้ไขยอดด้วยมือ + จำนวนวันขาด
-- รันใน Supabase SQL editor — รันซ้ำได้ปลอดภัย (idempotent)
--
-- หลักคิด: ยอดที่ระบบคำนวณกับยอดที่คนแก้ ต้องอยู่คนละช่อง ห้ามเขียนทับกัน
--   total        = ยอดที่ระบบคำนวณได้ (ความหมายเดิม ไม่เปลี่ยน — ของเก่าที่บันทึกไว้แล้วยังอ่านได้เหมือนเดิม)
--   manual_total = ยอดที่ HR แก้มือ (null = ไม่ได้แก้)
--   final_total  = ยอดที่ใช้จริง = manual_total ถ้ามี ไม่งั้นใช้ total
--
-- ทำไมต้องแยก: หน้าคำนวณสร้างยอดจากไฟล์ทุกครั้งที่อัปโหลด ถ้าเก็บช่องเดียว
-- อัปโหลดเดือนเดิมซ้ำทีเดียวยอดที่แก้มือหายหมด และตรวจย้อนหลังไม่ได้ว่าเลขมาจากไหน
-- (PostgREST upsert เขียนเฉพาะคอลัมน์ที่ส่งมา — หน้าคำนวณไม่ส่ง manual_* ค่าที่แก้ไว้จึงอยู่ครบ)

alter table shift_allowance add column if not exists absent_days   int;
alter table shift_allowance add column if not exists manual_total  numeric;
alter table shift_allowance add column if not exists manual_reason text;
alter table shift_allowance add column if not exists manual_by     uuid;
alter table shift_allowance add column if not exists manual_at     timestamptz;

-- ยอดที่ใช้จริง — ให้ DB คิดให้ จะได้ไม่มีใครลืม coalesce แล้วรายงานตัวเลขคนละชุดกัน
alter table shift_allowance add column if not exists final_total numeric
  generated always as (coalesce(manual_total, total)) stored;

-- แก้มือต้องมีเหตุผลเสมอ — ไม่งั้นอีกสามเดือนไม่มีใครรู้ว่าทำไมเลขไม่ตรงกับที่คำนวณ
alter table shift_allowance drop constraint if exists shift_allow_manual_reason;
alter table shift_allowance add  constraint shift_allow_manual_reason
  check (manual_total is null or (manual_reason is not null and btrim(manual_reason) <> ''));

-- ยอดค่ากะติดลบไม่ได้
alter table shift_allowance drop constraint if exists shift_allow_manual_nonneg;
alter table shift_allowance add  constraint shift_allow_manual_nonneg
  check (manual_total is null or manual_total >= 0);

-- หน้าเปรียบเทียบดึงทีละสองเดือนของทุกคน — ดัชนีตามเดือนช่วยได้ตรง ๆ
create index if not exists shift_allow_month_idx on shift_allowance (month);

-- RLS เดิมครอบคลุมอยู่แล้ว (อ่านได้ทุกคนที่ล็อกอิน · เขียนเฉพาะ hr/admin)
-- คอลัมน์ใหม่จึงถูกคุมด้วย policy เดียวกันโดยอัตโนมัติ ไม่ต้องเพิ่ม policy
