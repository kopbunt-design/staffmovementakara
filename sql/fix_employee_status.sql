-- ซ่อมข้อมูล: คอลัมน์ status ของพนักงานบางคนมีค่าที่ไม่ใช่สถานะ (เช่นชื่อจังหวัด "Nakhonsawan")
-- สถานะที่ถูกต้องมีแค่: Active / Resigned / Terminated / Retired / Transferred
--
-- ⚠️ ไฟล์นี้แก้ข้อมูลจริง — ให้รัน STEP 1 ดูก่อนเสมอ แล้วค่อยรัน STEP 2
-- (โค้ดฝั่งเว็บกันค่าผิดตอน import แล้ว ไฟล์นี้ใช้ล้างของเดิมที่ค้างอยู่)

-- ========== STEP 1: ดูว่ามีแถวไหนผิดบ้าง (ยังไม่แก้อะไร) ==========
select emp_code,
       firstname_th, lastname_th,
       status      as สถานะปัจจุบัน_ที่ผิด,
       province    as จังหวัดปัจจุบัน,
       end_date,
       case when end_date is null then 'Active' else 'ต้องตรวจเอง' end as จะเปลี่ยนเป็น
from employees
where status is not null
  and status not in ('Active','Resigned','Terminated','Retired','Transferred')
order by emp_code;


-- ========== STEP 2: แก้ (รันเมื่อดู STEP 1 แล้วโอเค) ==========
-- 2.1 ถ้าค่าที่ผิดคือชื่อจังหวัด และช่อง province ยังว่าง -> ย้ายไปเก็บที่ province ก่อน จะได้ไม่เสียข้อมูล
-- update employees
-- set province = status
-- where status is not null
--   and status not in ('Active','Resigned','Terminated','Retired','Transferred')
--   and (province is null or province = '');

-- 2.2 ตั้งสถานะให้ถูก: ไม่มีวันพ้นสภาพ = ยังทำงานอยู่
-- update employees
-- set status = 'Active', updated_at = now()
-- where status is not null
--   and status not in ('Active','Resigned','Terminated','Retired','Transferred')
--   and end_date is null;

-- 2.3 คนที่มี end_date อยู่แล้ว ให้ตรวจเป็นราย ๆ ว่าควรเป็น Resigned / Terminated / Retired
--     (ไม่เดาแทน เพราะเหตุผลการพ้นสภาพต่างกันมีผลต่อรายงาน)
-- select emp_code, firstname_th, lastname_th, status, end_date from employees
-- where status not in ('Active','Resigned','Terminated','Retired','Transferred') and end_date is not null;


-- ========== STEP 3: ตรวจซ้ำว่าไม่มีค่าผิดเหลือแล้ว ==========
-- select status, count(*) from employees group by status order by count(*) desc;
