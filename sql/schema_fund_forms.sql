-- ============================================================================
-- แบบฟอร์มกองทุน ให้พนักงานที่ HR เชิญกรอกออนไลน์
--   pvd = กองทุนสำรองเลี้ยงชีพ (AKR-OHR-FM-020 Rev.01)
--   wef = กองทุนสงเคราะห์ลูกจ้าง — แบบ สกล.๕ (หนังสือกำหนดผู้รับเงิน กรณีลูกจ้างตาย)
--
-- วิธีใช้: Supabase Dashboard > SQL Editor > วางทั้งไฟล์ > Run (รันซ้ำได้)
--
-- ใครกรอกได้: เฉพาะคนที่ HR เชิญ (fund_form_invite) — ไม่ใช่พนักงานทุกคน
--   แต่ละคำเชิญมีลิงก์ส่วนตัว (token สุ่ม) + ระบุว่ากรอกฟอร์มไหนได้บ้าง
--   เช่น คนที่ยังไม่ผ่านโปร หรือเคยลาออกจากกองทุนสำรองฯ มาแล้ว ได้แค่ wef
--   เข้าหน้าได้ต้องครบ 3 อย่าง: ลิงก์ของตัวเอง + รหัสพนักงาน + เลขบัตรประชาชน 5 ตัวท้าย
--
-- ⚠️ หน้าที่พนักงานกรอก (/fund.html) ไม่ต้อง login จึงแตะตารางตรง ๆ ไม่ได้เลย
--    ทุกอย่างผ่าน 2 ฟังก์ชัน security definer ด้านล่างเท่านั้น:
--      fund_form_lookup  — ยืนยันตัวตนแล้วคืนชื่อ/สังกัด/ฟอร์มที่กรอกได้
--      fund_form_submit  — ยืนยันซ้ำ ตรวจข้อมูล แล้วบันทึก
--    anon ไม่มีสิทธิ์ select ตารางใด ๆ ในไฟล์นี้
--    อย่าเพิ่ม policy ให้ anon อ่านตาราง — เลขบัตรผู้รับประโยชน์อยู่ในนี้ (PDPA)
--    เก็บเลขบัตรพนักงานแค่ 5 ตัวท้าย ไม่เก็บเลขเต็ม
-- ============================================================================

-- ------------------------------------------------------------ 1. คำเชิญ
create table if not exists fund_form_invite (
  id          bigint generated always as identity primary key,
  token       text not null unique default replace(gen_random_uuid()::text, '-', ''),
  emp_code    text not null,
  title       text,
  emp_name    text,
  department  text,
  id_last5    text not null check (id_last5 ~ '^[0-9]{5}$'),
  forms       text[] not null check (forms <@ array['pvd','wef'] and cardinality(forms) > 0),
  expires_at  timestamptz not null default now() + interval '30 days',
  cancelled   boolean not null default false,
  opened_at   timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);
-- เชิญซ้ำคนเดิมได้ (เช่น ลิงก์หมดอายุ) แต่ต้องมีคำเชิญที่ยังใช้ได้ไม่เกิน 1 อันต่อคน
create unique index if not exists fund_form_invite_live_idx
  on fund_form_invite (emp_code) where not cancelled;

-- ------------------------------------------------------------ 2. คำขอที่ส่งเข้ามา
create table if not exists fund_form_submission (
  id            bigint generated always as identity primary key,
  form_type     text not null check (form_type in ('pvd','wef')),
  emp_code      text not null,
  emp_name      text,
  department    text,
  payload       jsonb not null,          -- ข้อมูลทั้งหมดในฟอร์ม (โครงตามแต่ละแบบ)
  status        text not null default 'submitted'
                check (status in ('submitted','accepted','received','approved','sent','rejected','cancelled')),
  hr_note       text,
  submitted_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id)
);
-- accepted = HR รับเรื่องที่เซ็นออนไลน์ · received = HR รับเอกสารตัวจริงที่เซ็นสด (ตารางที่สร้างไปแล้วต้องเปลี่ยน check)
alter table fund_form_submission drop constraint if exists fund_form_submission_status_check;
alter table fund_form_submission add constraint fund_form_submission_status_check
  check (status in ('submitted','accepted','received','approved','sent','rejected','cancelled'));
alter table fund_form_submission add column if not exists invite_id bigint references fund_form_invite(id) on delete set null;
create index if not exists fund_form_submission_emp_idx
  on fund_form_submission (form_type, emp_code, submitted_at desc);

drop trigger if exists fund_form_submission_updated_at on fund_form_submission;
create trigger fund_form_submission_updated_at before update on fund_form_submission
  for each row execute function set_updated_at();

-- กันเดาเลข 5 ตัวรัว ๆ : จดครั้งที่ยืนยันไม่ผ่านต่อคำเชิญ
create table if not exists fund_invite_attempt (
  id         bigint generated always as identity primary key,
  invite_id  bigint not null references fund_form_invite(id) on delete cascade,
  at         timestamptz not null default now()
);
create index if not exists fund_invite_attempt_idx on fund_invite_attempt (invite_id, at desc);

-- รุ่นแรกยืนยันด้วยวันเกิด — ไม่ใช้แล้ว
drop function if exists fund_form_lookup(text, date);
drop function if exists fund_form_submit(text, date, text, jsonb);
drop function if exists fund_verify_emp(text, date);
drop table if exists fund_form_attempt;


-- ------------------------------------------------------------------ 3. RLS
alter table fund_form_invite     enable row level security;
alter table fund_form_submission enable row level security;
alter table fund_invite_attempt  enable row level security;   -- ไม่มี policy = ไม่มีใครอ่านตรงได้

drop policy if exists "fund_invite_read"   on fund_form_invite;
drop policy if exists "fund_invite_write"  on fund_form_invite;
create policy "fund_invite_read"  on fund_form_invite for select using (has_perm('page.fundforms'));
create policy "fund_invite_write" on fund_form_invite for all
  using (has_perm('data.fundforms.write')) with check (has_perm('data.fundforms.write'));

drop policy if exists "fund_form_read"   on fund_form_submission;
drop policy if exists "fund_form_update" on fund_form_submission;
drop policy if exists "fund_form_delete" on fund_form_submission;
create policy "fund_form_read"   on fund_form_submission for select using (has_perm('page.fundforms'));
create policy "fund_form_update" on fund_form_submission for update using (has_perm('data.fundforms.write'));
create policy "fund_form_delete" on fund_form_submission for delete using (has_perm('data.fundforms.write'));
-- ไม่มี insert policy โดยตั้งใจ — insert ได้ทางเดียวคือ fund_form_submit()


-- -------------------------------------------------------- 4. ตัวช่วยตรวจข้อมูล
-- เลขบัตรประชาชนไทย 13 หลัก + ตรวจหลักสุดท้าย (checksum)
create or replace function fund_valid_thai_id(p text)
returns boolean language plpgsql immutable as $$
declare s int := 0; i int;
begin
  if p is null or p !~ '^[0-9]{13}$' then return false; end if;
  for i in 1..12 loop
    s := s + substr(p, i, 1)::int * (14 - i);
  end loop;
  return ((11 - s % 11) % 10) = substr(p, 13, 1)::int;
end $$;

-- หาคำเชิญจาก ลิงก์ + รหัสพนักงาน + 5 ตัวท้ายบัตร
-- คืน null ถ้าไม่ตรง · raise LOCKED / EXPIRED ให้หน้าเว็บบอกเหตุผลได้
create or replace function fund_verify_invite(p_token text, p_emp_code text, p_last5 text)
returns fund_form_invite language plpgsql security definer set search_path = public as $$
declare inv fund_form_invite;
begin
  select * into inv from fund_form_invite where token = trim(coalesce(p_token, '')) limit 1;
  -- ลิงก์ผิด: ไม่มีคำเชิญให้ล็อก และ token สุ่ม 122 บิต เดาไม่ได้อยู่แล้ว
  if inv.id is null then return null; end if;
  if inv.cancelled then raise exception 'CANCELLED'; end if;
  if inv.expires_at < now() then raise exception 'EXPIRED'; end if;

  -- ลองผิดเกิน 8 ครั้งใน 30 นาที ล็อกลิงก์นี้ไว้ก่อน
  if (select count(*) from fund_invite_attempt
       where invite_id = inv.id and at > now() - interval '30 minutes') >= 8 then
    raise exception 'LOCKED';
  end if;

  if upper(trim(coalesce(p_emp_code, ''))) <> upper(inv.emp_code)
     or trim(coalesce(p_last5, '')) <> inv.id_last5 then
    insert into fund_invite_attempt (invite_id) values (inv.id);
    return null;
  end if;
  return inv;
end $$;
revoke all on function fund_verify_invite(text, text, text) from public, anon, authenticated;


-- ---------------------------------------------- 5. ฟังก์ชันที่หน้าเว็บเรียกได้
create or replace function fund_form_lookup(p_token text, p_emp_code text, p_last5 text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare inv fund_form_invite; e employees;
begin
  inv := fund_verify_invite(p_token, p_emp_code, p_last5);
  if inv.id is null then return null; end if;
  update fund_form_invite set opened_at = coalesce(opened_at, now()) where id = inv.id;
  -- รายวัน (DAY*) บางคนยังไม่มีในทะเบียน — ใช้ชื่อจากคำเชิญเป็นหลัก ทะเบียนแค่เติมส่วนที่มี
  select * into e from employees where upper(trim(emp_code)) = upper(inv.emp_code) limit 1;
  return jsonb_build_object(
    'emp_code',    inv.emp_code,
    'title',       inv.title,
    'name',        coalesce(nullif(inv.emp_name, ''), concat_ws(' ', e.firstname_th, e.lastname_th)),
    'department',  coalesce(nullif(inv.department, ''), concat_ws(' / ', nullif(e.division,''), nullif(e.department,''))),
    'gender',      e.gender,
    'dob',         e.dob,
    'phone',       e.phone,
    -- อายุงาน → เพดานเงินสมทบกองทุนสำรองเลี้ยงชีพของบริษัท (หน้าฟอร์มบอกพนักงานว่าบริษัทสมทบเท่าไร)
    'join_date',   e.join_date,
    'forms',       to_jsonb(inv.forms),
    'expires_at',  inv.expires_at,
    -- คำขอที่เคยส่ง (ให้พนักงานเห็นว่าส่งไปแล้ว ไม่ต้องส่งซ้ำ) — ไม่คืนเนื้อหาในฟอร์ม
    -- ฉบับที่ HR ส่งกลับ แนบเหตุผลไปด้วย พนักงานจะได้รู้ว่าต้องแก้อะไร
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'form_type', s.form_type,
               'status', s.status, 'submitted_at', s.submitted_at,
               'hr_note', case when s.status = 'rejected' then s.hr_note end) order by s.submitted_at desc)
        from fund_form_submission s where s.emp_code = inv.emp_code), '[]'::jsonb),
    -- ฉบับล่าสุด (ฟอร์มใดก็ได้) พร้อมเนื้อหา ให้พนักงานกลับมาดาวน์โหลด PDF ได้ทุกเมื่อ
    'latest', (select jsonb_build_object('id', s.id, 'form_type', s.form_type, 'status', s.status,
                                         'submitted_at', s.submitted_at, 'payload', s.payload)
                 from fund_form_submission s
                where s.emp_code = inv.emp_code and s.status <> 'cancelled'
                order by s.submitted_at desc limit 1),
    -- ฟอร์มที่ฉบับล่าสุดถูกส่งกลับ: คืนข้อมูลเดิมให้แก้ต่อ ไม่ต้องกรอกใหม่หมด (ลายเซ็นไม่คืน ต้องเซ็นใหม่)
    -- เป็นข้อมูลของพนักงานเอง และผ่านการยืนยันลิงก์ + รหัส + เลขบัตรแล้ว
    'drafts', coalesce((
      select jsonb_object_agg(x.form_type, x.payload - 'signature' - 'consent')
        from (select distinct on (form_type) form_type, status, payload
                from fund_form_submission
               where emp_code = inv.emp_code and status <> 'cancelled'
               order by form_type, submitted_at desc) x
       where x.status = 'rejected'), '{}'::jsonb)
  );
end $$;

create or replace function fund_form_submit(p_token text, p_emp_code text, p_last5 text, p_form_type text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  inv fund_form_invite; b jsonb; tot numeric := 0; n int := 0; req jsonb; id_out bigint;
begin
  inv := fund_verify_invite(p_token, p_emp_code, p_last5);
  if inv.id is null then raise exception 'VERIFY_FAILED'; end if;
  if not (p_form_type = any(inv.forms)) then raise exception 'FORM_NOT_ALLOWED'; end if;
  -- HR รับเรื่องฉบับล่าสุดไปแล้ว → ส่งใหม่ไม่ได้ จนกว่า HR จะส่งกลับให้แก้ (status = rejected)
  if (select s.status from fund_form_submission s
       where s.emp_code = inv.emp_code and s.status <> 'cancelled'
       order by s.submitted_at desc limit 1) in ('accepted','received','approved','sent') then
    raise exception 'ALREADY_RECEIVED';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'BAD_PAYLOAD'; end if;
  if coalesce((p_payload->>'consent')::boolean, false) is not true then raise exception 'NO_CONSENT'; end if;

  if p_form_type = 'pvd' then
    req := coalesce(p_payload->'requests', '[]'::jsonb);
    if jsonb_array_length(req) = 0 then raise exception 'PVD_NO_REQUEST'; end if;

    -- ส่วนที่ 2 ผู้รับผลประโยชน์ ≤ 3 คน ร้อยละรวม = 100
    if req ? 'apply' or req ? 'beneficiary' then
      for b in select * from jsonb_array_elements(coalesce(p_payload->'beneficiaries','[]'::jsonb)) loop
        n := n + 1;
        if coalesce(trim(b->>'name'),'') = '' or coalesce(trim(b->>'relation'),'') = '' then
          raise exception 'PVD_BENEF_INCOMPLETE';
        end if;
        tot := tot + coalesce((b->>'percent')::numeric, 0);
      end loop;
      if n < 1 or n > 3 then raise exception 'PVD_BENEF_COUNT'; end if;
      if tot <> 100 then raise exception 'PVD_PERCENT_SUM'; end if;
    end if;

    -- ส่วนที่ 3 อัตราสะสม 2–15%
    if req ? 'apply' or req ? 'rate' then
      if coalesce((p_payload->>'rate')::numeric, 0) not between 2 and 15 then
        raise exception 'PVD_RATE';
      end if;
    end if;

    -- ส่วนที่ 4 นโยบายการลงทุน
    if req ? 'apply' or req ? 'policy' then
      if coalesce(p_payload->>'policy','') not in ('PF1103','PF4103','PF6103','PFM103','PF2103') then
        raise exception 'PVD_POLICY';
      end if;
    end if;

  elsif p_form_type = 'wef' then
    -- is_thai มาจากหน้าเว็บ (สัญชาติไทย → ต้องมีเลขบัตร 13 หลัก · ไม่ใช่ไทย → เลขพาสปอร์ต)
    if coalesce((p_payload->>'is_thai')::boolean, true) then
      if not fund_valid_thai_id(p_payload->>'id_card') then raise exception 'WEF_ID_CARD'; end if;
      -- เลขบัตรที่กรอกในฟอร์มต้องเป็นใบเดียวกับที่ใช้ยืนยันตัว
      if right(p_payload->>'id_card', 5) <> inv.id_last5 then raise exception 'WEF_ID_MISMATCH'; end if;
    elsif coalesce(trim(p_payload->>'passport'),'') = '' then
      raise exception 'WEF_PASSPORT';
    end if;

    for b in select * from jsonb_array_elements(coalesce(p_payload->'beneficiaries','[]'::jsonb)) loop
      n := n + 1;
      if coalesce(trim(b->>'name'),'') = '' or coalesce(trim(b->>'relation'),'') = ''
         or coalesce(trim(b->>'address'),'') = '' then
        raise exception 'WEF_BENEF_INCOMPLETE';
      end if;
      if not fund_valid_thai_id(b->>'id_card') then raise exception 'WEF_BENEF_ID'; end if;
    end loop;
    if n < 1 or n > 8 then raise exception 'WEF_BENEF_COUNT'; end if;

  else
    raise exception 'BAD_FORM_TYPE';
  end if;

  insert into fund_form_submission (form_type, emp_code, emp_name, department, payload, invite_id)
  values (p_form_type, inv.emp_code, inv.emp_name, inv.department, p_payload, inv.id)
  returning id into id_out;

  return jsonb_build_object('id', id_out, 'submitted_at', now());
end $$;

grant execute on function fund_form_lookup(text, text, text)               to anon, authenticated;
grant execute on function fund_form_submit(text, text, text, text, jsonb)  to anon, authenticated;


-- ------------------------------------------------------------------ 6. สิทธิ์
insert into permissions (key, category, label, description, sort_order) values
  ('page.fundforms',        'page', 'แบบฟอร์มกองทุน', 'ดูคำเชิญและคำขอกองทุนสำรองเลี้ยงชีพ / กองทุนสงเคราะห์ที่พนักงานส่งเข้ามา', 24),
  ('data.fundforms.write',  'data', 'จัดการคำขอกองทุน', 'เชิญพนักงาน เปลี่ยนสถานะ ใส่หมายเหตุ และลบคำขอ', 42)
on conflict (key) do update
  set label = excluded.label, description = excluded.description, sort_order = excluded.sort_order;

insert into role_permissions (role_key, perm_key)
select r.key, p.key from app_roles r
  cross join (values ('page.fundforms'),('data.fundforms.write')) as p(key)
where r.key in ('admin','hr')
on conflict do nothing;
