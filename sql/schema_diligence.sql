-- ============================================================================
-- เบี้ยขยัน — ผลรายคนรายเดือน (ใช้นับ "เดือนต่อเนื่อง" ของเดือนถัดไป) · หน้า js/diligence.js
-- รันหลัง schema_rbac.sql · รันซ้ำได้ปลอดภัย
--   ym = เดือนของข้อมูลเวลา (เวลา ก.ย. 2569 → ym 2026-09 → จ่ายงวด ต.ค. 2569)
--   เก็บเฉพาะคนที่อยู่ในขอบเขต (พนักงานประจำ O/S ครบเดือน พ้นทดลองงาน) ทั้งที่ได้และไม่ได้ พร้อมเหตุผล
-- ============================================================================
create table if not exists diligence_runs (
  ym          text primary key check (ym ~ '^\d{4}-\d{2}$'),
  pay_ym      text not null,
  files       jsonb,                 -- ชื่อไฟล์ที่ใช้คิด
  in_scope    int, qualified int, total numeric,
  saved_by    uuid, saved_at timestamptz default now()
);

create table if not exists diligence_results (
  ym          text not null references diligence_runs(ym) on delete cascade,
  emp_code    text not null,
  emp_name    text, department text, job_level text,
  qualified   boolean not null,
  streak      int not null default 0,          -- เดือนต่อเนื่องที่ได้ (0 = เดือนนี้ไม่ได้)
  amount      numeric not null default 0,
  edit_days   int not null default 0,          -- จำนวนวันแก้เวลาที่นับตามข้อ 4.6
  reasons     jsonb not null default '[]',     -- เหตุที่ไม่ได้
  flags       jsonb not null default '[]',     -- ข้อที่ HR ตรวจ / ตัดสินเอง
  manual      jsonb,                           -- HR ตัดสิทธิ์ / ให้สิทธิ์ {action, note}
  primary key (ym, emp_code)
);
create index if not exists diligence_results_emp_idx on diligence_results (emp_code, ym);

alter table diligence_runs    enable row level security;
alter table diligence_results enable row level security;
drop policy if exists "dil_runs_read"  on diligence_runs;
drop policy if exists "dil_runs_write" on diligence_runs;
drop policy if exists "dil_res_read"   on diligence_results;
drop policy if exists "dil_res_write"  on diligence_results;
create policy "dil_runs_read"  on diligence_runs    for select using (has_perm('page.diligence'));
create policy "dil_runs_write" on diligence_runs    for all    using (has_perm('data.diligence.write')) with check (has_perm('data.diligence.write'));
create policy "dil_res_read"   on diligence_results for select using (has_perm('page.diligence'));
create policy "dil_res_write"  on diligence_results for all    using (has_perm('data.diligence.write')) with check (has_perm('data.diligence.write'));

-- บันทึกทั้งเดือนในคราวเดียว (แทนของเดิม) — ห้ามแก้เดือนที่มีเดือนถัดไปบันทึกแล้ว
-- เพราะเดือนต่อเนื่องของเดือนหลังนับจากเดือนนี้ แก้ย้อนหลังแล้วเดือนหลังจะผิดเงียบ ๆ
create or replace function diligence_save(p_ym text, p_pay_ym text, p_files jsonb, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not has_perm('data.diligence.write') then raise exception 'ไม่มีสิทธิ์บันทึกเบี้ยขยัน'; end if;
  if exists (select 1 from diligence_runs where ym > p_ym) then
    raise exception 'มีเดือนหลังจากนี้บันทึกไว้แล้ว — ลบเดือนหลังก่อน แล้วค่อยบันทึกเดือนนี้ใหม่ (เดือนต่อเนื่องจะได้นับถูก)';
  end if;
  delete from diligence_runs where ym = p_ym;
  insert into diligence_runs (ym, pay_ym, files, in_scope, qualified, total, saved_by)
  select p_ym, p_pay_ym, p_files, count(*), count(*) filter (where (r->>'qualified')::boolean),
         coalesce(sum((r->>'amount')::numeric), 0), auth.uid()
    from jsonb_array_elements(p_rows) r;
  insert into diligence_results (ym, emp_code, emp_name, department, job_level, qualified, streak, amount, edit_days, reasons, flags, manual)
  select p_ym, r->>'code', r->>'name', r->>'department', r->>'job_level', (r->>'qualified')::boolean,
         coalesce((r->>'streak')::int, 0), coalesce((r->>'amount')::numeric, 0), coalesce((r->>'edit_days')::int, 0),
         coalesce(r->'reasons', '[]'), coalesce(r->'flags', '[]'), r->'manual'
    from jsonb_array_elements(p_rows) r;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function diligence_save(text, text, jsonb, jsonb) from public, anon;
grant execute on function diligence_save(text, text, jsonb, jsonb) to authenticated;

-- สิทธิ์: เมนูอยู่กลุ่มเงินเดือน · ใครเห็นหน้าคำนวณค่ากะ ได้เห็นหน้านี้ด้วยตั้งแต่แรก
insert into permissions (key, category, label, description, sort_order) values
  ('page.diligence',       'page', 'เบี้ยขยัน',        'คำนวณเบี้ยขยันจากไฟล์เวลา TigerSoft และดูประวัติ', 21),
  ('data.diligence.write', 'data', 'บันทึกผลเบี้ยขยัน', 'อัปโหลด คำนวณ และบันทึกผลเบี้ยขยันรายเดือน',      38)
on conflict (key) do update set label = excluded.label, description = excluded.description, sort_order = excluded.sort_order;

insert into role_permissions (role_key, perm_key)
select r.key, p.key from app_roles r cross join (values ('page.diligence'), ('data.diligence.write')) as p(key)
where r.key = 'admin' or exists (select 1 from role_permissions rp where rp.role_key = r.key and rp.perm_key = 'data.shiftallow.write')
on conflict do nothing;
