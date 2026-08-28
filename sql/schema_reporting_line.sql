-- ============================================================================
-- สายบังคับบัญชา (Reporting Line) — ใครเป็นหัวหน้าใคร
-- รันใน Supabase SQL editor · รันซ้ำได้ปลอดภัย (idempotent)
--
-- โมเดล: เก็บ "หัวหน้าโดยตรง" ไว้ที่โปรไฟล์พนักงานแต่ละคน
--        แล้วให้ผังองค์กรวาดตัวเองจากข้อมูลนี้ — ไม่เก็บผังเป็นข้อมูลแยก
--        (ผังที่เก็บแยกจะล้าสมัยทันทีที่มีคนย้าย)
--
-- ⚠️ อย่าให้ระบบเดาหัวหน้าจากหน่วยงานอัตโนมัติ
--    คนใน Team เดียวกันอาจมีหัวหน้าคนละคน (เช่นสลับกะ) และหัวหน้าอาจอยู่คนละ Section
--    หน่วยงาน + ระดับงาน ใช้ "ตรวจ" ว่าที่ HR กรอกสมเหตุสมผลเท่านั้น ไม่ใช้ "เดา"
-- ============================================================================


-- ---------------------------------------------------- 1. ช่องหัวหน้า
alter table employees add column if not exists manager_code text;
alter table employees add column if not exists dotted_manager_code text;

comment on column employees.manager_code is
  'emp_code ของหัวหน้าโดยตรง (เส้นทึบ) — คนที่ประเมินผลงาน/เซ็นใบลา';
comment on column employees.dotted_manager_code is
  'emp_code ของสายงานตามหน้าที่/โครงการ (เส้นประ matrix) — ไม่บังคับ เช่นสาย OH&S';

create index if not exists employees_manager_idx on employees (manager_code);
create index if not exists employees_dotted_idx  on employees (dotted_manager_code);


-- --------------------------------------------- 2. ลำดับศักดิ์ของระดับงาน
-- ⚠️ master_job_levels.sort_order เรียงตามตัวอักษร (M1→M4→O1→O3→S1→S3)
--    ใช้ตรวจว่าใครสูงกว่าใครไม่ได้ ต้องมีคอลัมน์ rank แยก
--
-- ลำดับที่ HR ยืนยัน 2026-08-29:  O ต่ำสุด → S → M สูงสุด · ภายในแบนด์ เลขมากกว่า = สูงกว่า
-- หลักฐานที่สอดคล้อง: Leading Hand = O3 (หัวหน้าชุดปฏิบัติการ)
--                    Senior Supervisor = S3 สูงกว่า Supervisor = S2
--                    Manager = M2
alter table master_job_levels add column if not exists rank int;

comment on column master_job_levels.rank is
  'ลำดับศักดิ์ — เลขมากกว่า = สูงกว่า · ใช้ตรวจว่าหัวหน้าอยู่สูงกว่าลูกน้องจริงไหม
   (ห้ามใช้ sort_order ที่เรียงตามตัวอักษรเพื่อการนี้)';

update master_job_levels set rank = v.rank
from (values
  ('O1',1),('O2',2),('O3',3),
  ('S1',4),('S2',5),('S3',6),
  ('M1',7),('M2',8),('M3',9),('M4',10)
) as v(code, rank)
where master_job_levels.code = v.code;


-- ------------------------------------ 3. กันข้อมูลพัง (บังคับที่ฐานข้อมูล)
-- 3.1 ห้ามเป็นหัวหน้าตัวเอง — ตรวจที่ DB ด้วย ไม่ใช่แค่หน้าเว็บ
--     เพราะ import Excel เขียนตรงเข้าตาราง ไม่ผ่านฟอร์ม
alter table employees drop constraint if exists employees_not_self_manager;
alter table employees add constraint employees_not_self_manager
  check (manager_code is null or manager_code <> emp_code);

alter table employees drop constraint if exists employees_not_self_dotted;
alter table employees add constraint employees_not_self_dotted
  check (dotted_manager_code is null or dotted_manager_code <> emp_code);


-- ------------------------------------------- 4. ตรวจวงกลมในสายบังคับบัญชา
-- ก→ข→ก ทำให้ผังวนไม่รู้จบตอนวาด · CHECK ธรรมดาตรวจข้ามแถวไม่ได้ ต้องใช้ trigger
create or replace function check_manager_cycle()
returns trigger
language plpgsql
as $$
declare
  cur text := new.manager_code;
  hops int := 0;
begin
  -- ไล่ขึ้นไปตามสายจนสุด ถ้าวนกลับมาเจอตัวเอง = เป็นวงกลม
  while cur is not null and hops < 50 loop
    if cur = new.emp_code then
      raise exception 'สายบังคับบัญชาวนเป็นวงกลม: % ไม่สามารถขึ้นตรงกับ % ได้',
        new.emp_code, new.manager_code;
    end if;
    select manager_code into cur from employees where emp_code = cur;
    hops := hops + 1;
  end loop;
  return new;
end $$;

drop trigger if exists employees_manager_cycle on employees;
create trigger employees_manager_cycle
  before insert or update of manager_code on employees
  for each row when (new.manager_code is not null)
  execute function check_manager_cycle();


-- ============================================================================
-- 5. ตรวจผล
-- ============================================================================
select code, name, sort_order as "sort_order (ตัวอักษร)", rank as "rank (ศักดิ์จริง)"
from master_job_levels
order by rank;
-- ที่ควรได้: O1=1 … O3=3 · S1=4 … S3=6 · M1=7 … M4=10
