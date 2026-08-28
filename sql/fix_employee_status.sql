-- ซ่อมข้อมูล: คอลัมน์ status ของพนักงานบางคนมีค่าที่ไม่ใช่สถานะ (เช่นชื่อจังหวัด "Nakhonsawan")
-- สถานะที่ถูกต้องมีแค่: Active / Resigned / Terminated / Retired / Transferred
--
-- ⚠️ ไฟล์นี้แก้ข้อมูลจริง — รัน STEP 1 ดูก่อนเสมอ แล้วค่อยเปิด comment STEP 2 ทีละข้อ
-- (โค้ดฝั่งเว็บกันค่าผิดตอน import แล้ว — js/employees.js รับเฉพาะค่าใน EMP_STATUSES
--  ของใหม่จะไม่เพี้ยนอีก ไฟล์นี้ใช้ล้างของเดิมที่ค้างใน DB เท่านั้น)
--
-- แนวคิด: คนที่ไม่มี end_date = ยังทำงานอยู่ → Active ได้เลย
--         คนที่มี end_date = ต้องรู้ว่าออกเพราะอะไร ซึ่ง **ตาราง movements รู้อยู่แล้ว**
--         (Resignation/Termination/Retirement) จึงดึงมาเติมให้อัตโนมัติ
--         เหลือเฉพาะคนที่มี end_date แต่ไม่มี movement เท่านั้นที่ต้องตัดสินใจเอง
--
-- ============================================================================
-- ผลการตรวจจริง 2026-08-27 — รัน STEP 1.2 แล้วเจอ 4 คน:
--   AKR26071368 Nakhonsawan  | AKR26071370 Phichit
--   AKR26071371 Phitsanulok  | AKR26071372 Phichit
--   emp_code ติดกันเกือบหมด (…1368/1370/1371/1372) น่าจะมาจาก import ชุดเดียว
--
--   * ทุกคน end_date = NULL  -> เป็น Active ทั้งหมด ไม่มีใครต้องตัดสินใจ
--   * ทุกคน province มีค่าถูกต้องอยู่แล้ว และตรงกับค่าที่ปนมาในช่อง status
--     -> **ไม่ต้องรัน 2.1 และ 2.2** เพราะไม่มีข้อมูลจะเสีย
--        (2.1 จะทำให้ remark ของ 4 คนนี้เปื้อนเปล่า ๆ · 2.2 ข้ามอยู่แล้วเพราะ province ไม่ว่าง)
--   * ไม่มีแถวไหนมี end_date -> **ไม่ต้องรัน 2.4 และ 2.5**
--
--   สรุปเคสนี้: มีแต่ 2.3 ที่ทำงานจริง (4 แถว) · 2.1/2.4 กระทบ 0 แถว
--
--   ไฟล์เปิดใช้ 2.1 / 2.3 / 2.4 ไว้ให้รันทั้งไฟล์ได้เลย เผื่อรอบหน้าเจออีก
--   เหลือ 2.2 (ย้ายค่าไป province) ที่ยัง comment ไว้ เพราะเป็นการตัดสินใจว่า
--   ค่าที่ปนมาเป็นชื่อจังหวัดจริงหรือเปล่า — ต้องดู STEP 1.1 ก่อนทุกครั้ง
-- ============================================================================


-- ========== STEP 1: ดูของจริงก่อน (ไม่แก้อะไรทั้งสิ้น) ==========

-- 1.1 สรุปว่ามีค่าผิดอะไรบ้าง อย่างละกี่คน
select status as ค่าผิดที่พบ,
       count(*) as จำนวนคน,
       count(*) filter (where end_date is null)     as ยังทำงานอยู่,
       count(*) filter (where end_date is not null) as มีวันพ้นสภาพ,
       count(*) filter (where province is null or province = '') as ช่องจังหวัดว่าง
from employees
where status is not null
  and status not in ('Active','Resigned','Terminated','Retired','Transferred')
group by status
order by count(*) desc;

-- 1.2 รายคน พร้อมสถานะที่ระบบเสนอ (ดึงเหตุผลการออกจากตาราง movements)
select e.emp_code,
       trim(coalesce(e.firstname_th,'') || ' ' || coalesce(e.lastname_th,'')) as ชื่อ,
       e.status   as ค่าผิดที่พบ,
       e.province as จังหวัดปัจจุบัน,
       e.end_date,
       m.type     as movement_ที่เจอ,
       m.date     as วันที่_movement,
       case
         when e.end_date is null      then 'Active'
         when m.type = 'Resignation'  then 'Resigned'
         when m.type = 'Termination'  then 'Terminated'
         when m.type = 'Retirement'   then 'Retired'
         else '*** ต้องตัดสินใจเอง ***'
       end as จะเปลี่ยนเป็น
from employees e
left join lateral (
  select type, date
  from movements
  where emp_code = e.emp_code
    and type in ('Resignation','Termination','Retirement')
  order by date desc nulls last
  limit 1
) m on true
where e.status is not null
  and e.status not in ('Active','Resigned','Terminated','Retired','Transferred')
order by (case when e.end_date is not null and m.type is null then 0 else 1 end),
         e.emp_code;
-- แถวที่ขึ้น '*** ต้องตัดสินใจเอง ***' จะถูกเรียงไว้บนสุด — คุยกันก่อนว่าจะให้เป็นอะไร


-- ========== STEP 2: แก้ (เปิด comment ทีละข้อ หลังดู STEP 1 แล้ว) ==========
--
-- ⚠️ ลำดับสำคัญ: 2.1 -> 2.3 -> 2.4 (เรียงไว้ถูกแล้วในไฟล์ ห้ามสลับ)
--    ทุกข้อหาแถวด้วยเงื่อนไข "status ยังเป็นค่าผิดอยู่" พอ 2.3/2.4 เขียนสถานะที่ถูกลงไป
--    แถวนั้นจะหลุดจากเงื่อนไขทันที — ถ้ารัน 2.3 ก่อน 2.1 ค่าเดิมของคนที่ province ว่างจะหายถาวร
--
-- ไฟล์นี้รันทั้งไฟล์ได้และรันซ้ำได้ (idempotent): ถ้าไม่มีค่าผิดค้างอยู่ ทุก update จะกระทบ 0 แถว
--
-- แนะนำให้ครอบด้วย begin; ... commit; จะได้ยกเลิกได้ถ้าผลไม่ตรงที่คิด
--   begin;
--     <วางคำสั่ง 2.x ที่ต้องการ>
--     <รัน STEP 3 ดูผลก่อน>
--   commit;   -- หรือ rollback; ถ้าผลไม่ถูก

-- 2.1 กันข้อมูลหาย — เก็บค่าเดิมลง remark *เฉพาะแถวที่ช่อง province ว่าง*
--     ถ้า province มีค่าอยู่แล้ว (เคส 2026-08-27) ไม่ต้องเก็บ เพราะข้อมูลไม่ได้หายไปไหน
--     เงื่อนไข not like กันเขียนซ้ำถ้าเผลอรันข้อนี้สองรอบ
update employees
set remark = trim(both ' ' from coalesce(remark,'') || ' [status เดิมที่ผิด: ' || status || ']')
where status is not null
  and status not in ('Active','Resigned','Terminated','Retired','Transferred')
  and (province is null or province = '')
  and coalesce(remark,'') not like '%[status เดิมที่ผิด: ' || status || ']%';

-- 2.2 (ทำเฉพาะถ้า STEP 1.1 ยืนยันว่าค่าที่ปนมาเป็นชื่อจังหวัดจริง และช่องจังหวัดว่าง)
--     ย้ายไปเก็บที่ province ให้ถูกช่อง
-- update employees
-- set province = status
-- where status is not null
--   and status not in ('Active','Resigned','Terminated','Retired','Transferred')
--   and (province is null or province = '');

-- 2.3 ไม่มีวันพ้นสภาพ = ยังทำงานอยู่   <<< ข้อเดียวที่เคสปี 2026-08-27 ต้องใช้ (เปิดไว้แล้ว)
update employees
set status = 'Active', updated_at = now()
where status is not null
  and status not in ('Active','Resigned','Terminated','Retired','Transferred')
  and end_date is null;

-- 2.4 มีวันพ้นสภาพ + มี movement บอกเหตุผล -> ตั้งตาม movement
update employees e
set status = case m.type
               when 'Resignation' then 'Resigned'
               when 'Termination' then 'Terminated'
               when 'Retirement'  then 'Retired'
             end,
    updated_at = now()
from (
  select distinct on (emp_code) emp_code, type
  from movements
  where type in ('Resignation','Termination','Retirement')
  order by emp_code, date desc nulls last
) m
where m.emp_code = e.emp_code
  and e.status is not null
  and e.status not in ('Active','Resigned','Terminated','Retired','Transferred')
  and e.end_date is not null;

-- 2.5 เหลือใคร = มี end_date แต่ไม่มี movement -> ต้องตัดสินใจเอง อย่าเดาแทน
--     เพราะเหตุผลการพ้นสภาพมีผลต่อรายงาน Movement / Turnover
--     ผลว่าง = แก้ครบแล้ว
select emp_code, firstname_th, lastname_th, status, end_date, remark
from employees
where status is not null
  and status not in ('Active','Resigned','Terminated','Retired','Transferred')
order by emp_code;


-- ========== STEP 3: ตรวจซ้ำว่าไม่มีค่าผิดเหลือแล้ว ==========
select status, count(*) from employees group by status order by count(*) desc;
-- ผลที่ควรได้: มีแค่ Active / Resigned / Terminated / Retired / Transferred
