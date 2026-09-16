-- ============================================================================
-- สต๊อกยูนิฟอร์มพนักงาน
-- รันใน Supabase SQL editor · รันซ้ำได้ปลอดภัย (idempotent)
--
-- แนวคิด: ยอดคงเหลือ "คำนวณจากรายการเคลื่อนไหว" ไม่เก็บเป็นตัวเลขนิ่ง ๆ
--   ถ้าเก็บคอลัมน์ qty แล้วบวกลบทับไปเรื่อย ๆ วันใดวันหนึ่งมันจะเพี้ยนโดยไม่มีใครรู้
--   (อัปเดตล้มเหลวกลางทาง / สองคนกดพร้อมกัน) แล้วย้อนไม่ได้ว่าเพี้ยนตั้งแต่เมื่อไหร่
--   เก็บเป็นสมุดรายการแทน ยอดคงเหลือ = ผลรวม จึงตรงเสมอและตรวจย้อนได้ทุกใบ
--
-- 1 แถวใน uniform_item = 1 ประเภท+ไซส์ (เสื้อ M คนละรายการกับ เสื้อ L)
-- ============================================================================


-- ------------------------------------------------------- 1. รายการของ
create table if not exists uniform_item (
  id         bigint generated always as identity primary key,
  item_type  text not null,                  -- เสื้อ / กางเกง / รองเท้าเซฟตี้ / หมวก
  size       text not null,                  -- S M L XL · หรือเบอร์รองเท้า 39-46
  min_qty    int  not null default 0,        -- ต่ำกว่านี้ให้เตือนสั่งเพิ่ม (0 = ไม่เตือน)
  is_active  boolean not null default true,
  remark     text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (item_type, size)                   -- กันสร้าง "เสื้อ M" ซ้ำสองรายการ
);
create index if not exists uni_item_type_idx on uniform_item (item_type, size);


-- --------------------------------------------- 2. รายการเคลื่อนไหว (สมุด)
-- qty เก็บเป็นเลขมีเครื่องหมาย: รับเข้า/คืน = บวก · จ่ายออก = ลบ
-- ทำแบบนี้เพื่อให้ยอดคงเหลือ = sum(qty) ตรง ๆ ไม่ต้องมาแยกบวกลบทีหลังให้ผิดง่าย
create table if not exists uniform_move (
  id        bigint generated always as identity primary key,
  item_id   bigint not null references uniform_item(id) on delete restrict,
  move_type text not null check (move_type in ('receive','issue','return','adjust')),
  qty       int  not null check (qty <> 0),
  moved_on  date not null default current_date,
  -- เฉพาะจ่ายออก/รับคืน — เก็บสำเนาชื่อไว้ด้วย เพราะพนักงานอาจลาออกหรือเปลี่ยนชื่อทีหลัง
  -- แต่ประวัติการเบิกต้องยังอ่านออกว่าใครเบิก
  emp_code  text,
  emp_name  text,
  note      text,
  created_at timestamptz default now(),
  created_by uuid,
  -- ทิศทางต้องตรงกับชนิดรายการ · adjust เป็นได้ทั้งบวกและลบ (นับสต๊อกแล้วปรับ)
  constraint uniform_move_dir check (
    (move_type in ('receive','return') and qty > 0)
    or (move_type = 'issue' and qty < 0)
    or (move_type = 'adjust')
  ),
  -- จ่ายออกต้องรู้ว่าจ่ายให้ใคร ไม่งั้นของหายโดยไม่มีใครรับผิดชอบ
  constraint uniform_move_emp check (move_type <> 'issue' or emp_code is not null)
);
create index if not exists uni_move_item_idx on uniform_move (item_id);
create index if not exists uni_move_emp_idx  on uniform_move (emp_code);
create index if not exists uni_move_date_idx on uniform_move (moved_on desc);


-- ------------------------------------------- 3. กันจ่ายเกินของที่มี
-- ตรวจหลังบันทึกแล้ว (AFTER) เพราะต้องนับแถวใหม่รวมเข้าไปด้วย
-- ใช้ constraint trigger เพื่อให้ผลตรวจอยู่ใน transaction เดียวกัน — ถ้าไม่ผ่าน rollback ทั้งก้อน
create or replace function check_uniform_balance()
returns trigger language plpgsql as $$
declare bal int; nm text;
begin
  select coalesce(sum(qty), 0) into bal
    from uniform_move where item_id = coalesce(new.item_id, old.item_id);
  if bal < 0 then
    select item_type || ' ไซส์ ' || size into nm
      from uniform_item where id = coalesce(new.item_id, old.item_id);
    raise exception 'จ่ายเกินของที่มี: % คงเหลือจะติดลบ (%)', nm, bal;
  end if;
  return null;
end $$;

drop trigger if exists uni_move_balance on uniform_move;
create constraint trigger uni_move_balance
  after insert or update or delete on uniform_move
  deferrable initially immediate
  for each row execute function check_uniform_balance();


-- ----------------------------------------------------- 4. ยอดคงเหลือ
-- security_invoker = RLS ของตารางข้างใต้ยังบังคับใช้กับคนที่เรียก view นี้
-- ถ้าไม่ใส่ view จะรันด้วยสิทธิ์เจ้าของ = ข้าม RLS ทั้งหมด (ช่องโหว่)
drop view if exists uniform_balance;
create view uniform_balance
with (security_invoker = true) as
select i.id, i.item_type, i.size, i.min_qty, i.is_active, i.remark,
       coalesce(sum(m.qty), 0)::int as qty,
       coalesce(sum(m.qty) filter (where m.move_type = 'issue'), 0)::int * -1 as issued_total,
       max(m.moved_on) as last_move
from uniform_item i
left join uniform_move m on m.item_id = i.id
group by i.id, i.item_type, i.size, i.min_qty, i.is_active, i.remark;


-- ---------------------------------------------------------- 5. RLS
alter table uniform_item enable row level security;
alter table uniform_move enable row level security;

-- อ่านได้ทุกคนที่มีสิทธิ์เปิดหน้านี้ · แก้ได้เฉพาะคนที่มีสิทธิ์จัดการสต๊อก
drop policy if exists "uniform_item_read"  on uniform_item;
drop policy if exists "uniform_item_write" on uniform_item;
drop policy if exists "uniform_move_read"  on uniform_move;
drop policy if exists "uniform_move_write" on uniform_move;
create policy "uniform_item_read"  on uniform_item for select using (has_perm('page.uniform'));
create policy "uniform_item_write" on uniform_item for all    using (has_perm('data.uniform.write'));
create policy "uniform_move_read"  on uniform_move for select using (has_perm('page.uniform'));
create policy "uniform_move_write" on uniform_move for all    using (has_perm('data.uniform.write'));


-- ------------------------------------------------------- 6. สิทธิ์
insert into permissions (key, category, label, description, sort_order) values
  ('page.uniform',       'page', 'สต๊อกยูนิฟอร์ม', 'ดูยอดคงเหลือและประวัติการเบิก', 23),
  ('data.uniform.write', 'data', 'จัดการสต๊อกยูนิฟอร์ม', 'รับเข้า จ่ายออก ปรับยอด และแก้รายการของ', 41)
on conflict (key) do update
  set label = excluded.label, description = excluded.description, sort_order = excluded.sort_order;

-- ให้ admin และ hr ใช้ได้ทันที · role อื่นแอดมินไปติ๊กเองที่หน้า Settings
insert into role_permissions (role_key, perm_key)
select r.key, p.key from app_roles r cross join (values ('page.uniform'),('data.uniform.write')) as p(key)
where r.key in ('admin','hr')
on conflict do nothing;


-- ------------------------------------ 7. ตั้งรายการเริ่มต้นให้พอเริ่มใช้ได้
-- เสื้อ/กางเกง = S-XXL · รองเท้าเซฟตี้ = เบอร์ 39-46 · หมวก = Free Size
insert into uniform_item (item_type, size, min_qty)
select t.name, s.size, t.minq
from (values ('เสื้อ', 20), ('กางเกง', 20)) as t(name, minq)
cross join (values ('S'),('M'),('L'),('XL'),('XXL')) as s(size)
on conflict (item_type, size) do nothing;

insert into uniform_item (item_type, size, min_qty)
select 'รองเท้าเซฟตี้', g::text, 5 from generate_series(39, 46) g
on conflict (item_type, size) do nothing;

insert into uniform_item (item_type, size, min_qty) values ('หมวก', 'Free Size', 10)
on conflict (item_type, size) do nothing;


-- ============================================================================
-- 8. ตรวจผล
-- ============================================================================
select item_type as ประเภท, count(*) as จำนวนไซส์,
       string_agg(size, ', ' order by id) as ไซส์
from uniform_item group by item_type order by min(id);
