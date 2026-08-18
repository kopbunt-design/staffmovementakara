-- กะที่จ่ายค่ากะแม้พนักงานทำ "กะเดียว" ทั้งเดือน
--
-- กติกาปกติ: ต้องหมุนเวียนกะถึงจะได้ค่ากะ — 3 ตระกูล = 1,800 · 2 ตระกูล = 1,200 · กะเดียว = 0
-- แต่บางกะจ่ายแม้ทำกะเดียวทั้งเดือน (ผู้ใช้ยืนยัน 2026-08-18 ว่า N03 เข้ากรณีนี้ ได้ 1,200)
--
-- เก็บเป็นค่าใน DB ไม่ฝังในโค้ด เพื่อให้เพิ่ม/แก้กะยกเว้นได้เองในอนาคต
-- ต้องรัน sql/schema_shift_codes.sql ก่อน · รันซ้ำได้ ไม่พัง

alter table master_shift_codes
  add column if not exists solo_rate integer not null default 0;

comment on column master_shift_codes.solo_rate is
  'ถ้า > 0 = ทำกะนี้กะเดียวทั้งเดือนก็ยังได้ค่ากะเท่านี้/เดือน · 0 = ใช้กติกาปกติ (กะเดียว = ไม่ได้)';

-- N03: ทำกะเดียวทั้งเดือน ได้ 1,200/เดือน
update master_shift_codes
set solo_rate = 1200, updated_at = now()
where upper(code) = 'N03';

-- ===== ตรวจผล =====
select code, family, solo_rate,
       case when solo_rate > 0
            then 'ทำกะเดียวทั้งเดือนก็ได้ ' || solo_rate
            else 'กติกาปกติ (กะเดียว = ไม่ได้)' end as กติกา
from master_shift_codes
where is_active
order by (solo_rate > 0) desc, family, code;
