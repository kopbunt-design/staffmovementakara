-- ============================================================================
-- สัญญาจ้างงาน (AKR-OHR-FM-006) — หน้า "สัญญาจ้างงาน" (js/emp-contract.js) · ผู้ใช้ขอ 2026-10-15
-- รันใน Supabase SQL editor · รันซ้ำได้ปลอดภัย (idempotent)
--
--   ผู้สมัครยังไม่อยู่ในทะเบียน → HR กรอกเอง หรืออ่านจากรูปบัตรประชาชน (อ่านในเบราว์เซอร์ รูปไม่ถูกส่งขึ้นไหน)
--   ไม่รันเลขเอกสาร · 2 สถานที่: สำนักงานกรุงเทพ / พิจิตร (เวลาทำงานและสถานที่ต่างกัน)
--   ลงนามออนไลน์: ผู้แทนบริษัท + พยาน (ลายเซ็นจาก letter_signers) · พนักงานเซ็นมือบนฉบับพิมพ์
--   ⚠️ เก็บเลขบัตรประชาชนแค่ 5 ตัวท้าย (ผู้ใช้เลือก) — พิมพ์ฉบับจริงต้องใส่เลขเต็มอีกครั้ง (ระบบตรวจกับ 5 ตัวท้าย)
--   ⚠️ มีเงินเดือน → อ่านได้เฉพาะ HR ที่แก้สัญญาได้ และผู้ลงนาม/พยานของฉบับนั้น
-- ============================================================================

create table if not exists emp_contracts (
  id             bigint generated always as identity primary key,
  location       text not null default 'phichit' check (location in ('bkk','phichit')),
  contract_date  date not null default current_date,    -- สัญญาทำขึ้นเมื่อวันที่
  title_th       text,                                   -- นาย / นาง / นางสาว
  name_th        text not null,                          -- ชื่อ-สกุล (ไม่รวมคำนำหน้า)
  name_en        text,
  id_last5       text check (id_last5 is null or id_last5 ~ '^\d{5}$'),
  birth_date     date,
  address        text,
  start_date     date not null,
  position_th    text not null, position_en text,
  job_level      text,
  salary         numeric not null check (salary > 0),
  work_days      text, work_hours text, break_time text, workplace text,   -- ว่าง = ตามสถานที่
  probation_end  date,                                   -- ว่าง = วันที่ 119 นับวันเริ่มงานเป็นวันที่ 1
  emp_code       text,                                   -- ใส่ทีหลังเมื่อมีรหัสพนักงาน
  remark         text,
  status         text not null default 'draft' check (status in ('draft','pending','signed','rejected','cancelled')),
  signer_id      uuid, witness_id uuid,
  signer         jsonb, witness jsonb,                   -- สำเนาชื่อ/ลายเซ็น ณ ตอนลงนาม
  signed_at      timestamptz, witnessed_at timestamptz,
  reject_reason  text,
  requested_by   uuid, requested_email text, submitted_at timestamptz,
  created_by     uuid default auth.uid(),
  created_at     timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists ec_status_idx on emp_contracts (status, created_at desc);
-- ไม่มีทดลองงาน (แบบ Word มีกรณีนี้ เช่นผู้บริหาร) — ข้อ 7 ขึ้นว่า "ไม่มีทดลองงาน"
alter table emp_contracts add column if not exists no_probation boolean not null default false;
-- เลขบัตรเต็ม 13 หลัก — เดิมเก็บแค่ 5 ตัวท้าย ผู้ใช้ขอให้เก็บเต็ม (2026-10-15) · อ่านได้เฉพาะ HR ที่ทำสัญญา + ผู้ลงนาม/พยานของฉบับนั้น (RLS เดียวกับเงินเดือน)
alter table emp_contracts add column if not exists id_card text check (id_card is null or id_card ~ '^\d{13}$');

-- เนื้อหาแก้ได้เฉพาะร่าง/ส่งกลับ · สถานะและลายเซ็นเปลี่ยนผ่าน ec_* เท่านั้น
create or replace function emp_contracts_guard() returns trigger language plpgsql as $$
begin
  if current_setting('ec.deciding', true) = 'on' then return new; end if;
  if new.status is distinct from old.status and not (new.status = 'cancelled' or (old.status = 'rejected' and new.status = 'draft')) then
    raise exception 'เปลี่ยนสถานะสัญญาได้ผ่านปุ่มในระบบเท่านั้น';
  end if;
  if (new.signer, new.witness, new.signed_at, new.witnessed_at, new.signer_id, new.witness_id)
     is distinct from (old.signer, old.witness, old.signed_at, old.witnessed_at, old.signer_id, old.witness_id) then
    raise exception 'ข้อมูลการลงนามแก้ไขไม่ได้';
  end if;
  if old.status in ('pending','signed','cancelled') and new.status <> 'cancelled'
     and (to_jsonb(new) - 'updated_at' - 'emp_code' - 'remark' - 'id_card') is distinct from (to_jsonb(old) - 'updated_at' - 'emp_code' - 'remark' - 'id_card') then
    raise exception 'สัญญาที่ส่งลงนาม/ลงนามแล้วแก้เนื้อหาไม่ได้ — ให้ผู้ลงนามส่งกลับ หรือยกเลิกแล้วทำฉบับใหม่';
  end if;
  -- ฉบับเก่าที่มีแค่ 5 ตัวท้าย: เติมเลขเต็มทีหลังได้ ถ้า 5 ตัวท้ายตรงกัน · มีเลขเต็มแล้วแก้ไม่ได้
  if old.status in ('pending','signed','cancelled') and new.id_card is distinct from old.id_card
     and (old.id_card is not null or right(new.id_card, 5) is distinct from old.id_last5) then
    raise exception 'สัญญาที่ส่งลงนาม/ลงนามแล้วแก้เนื้อหาไม่ได้ — ให้ผู้ลงนามส่งกลับ หรือยกเลิกแล้วทำฉบับใหม่';
  end if;
  return new;
end $$;
drop trigger if exists ec_guard on emp_contracts;
create trigger ec_guard before update on emp_contracts for each row execute function emp_contracts_guard();

create or replace function ec_submit(p_id bigint, p_signer uuid, p_witness uuid)
returns emp_contracts language plpgsql security definer set search_path = public as $$
declare c emp_contracts;
begin
  if not has_perm('data.empcontract.write') then raise exception 'ไม่มีสิทธิ์ทำสัญญาจ้าง'; end if;
  if p_signer is null or p_witness is null then raise exception 'เลือกผู้ลงนามและพยานก่อน'; end if;
  if p_signer = p_witness then raise exception 'ผู้ลงนามกับพยานต้องเป็นคนละคน'; end if;
  if not user_has_perm(p_signer, 'data.empcontract.sign') then raise exception 'ผู้แทนบริษัทที่เลือกไม่มีสิทธิ์ลงนามสัญญาจ้าง'; end if;
  -- พยาน: ผู้มีสิทธิ์ลงนาม หรือ HR ที่ทำสัญญา (คนออกสัญญาเป็นพยานได้ — user 2026-10-15)
  if not (user_has_perm(p_witness, 'data.empcontract.sign') or user_has_perm(p_witness, 'data.empcontract.write')) then raise exception 'พยานที่เลือกไม่มีสิทธิ์'; end if;
  perform set_config('ec.deciding', 'on', true);
  update emp_contracts set status = 'pending', signer_id = p_signer, witness_id = p_witness, signer = null, witness = null,
         signed_at = null, witnessed_at = null, reject_reason = null, requested_by = auth.uid(),
         requested_email = (select email from auth.users where id = auth.uid()), submitted_at = now(), updated_at = now()
   where id = p_id and status in ('draft','rejected') returning * into c;
  if c.id is null then raise exception 'ส่งได้เฉพาะสัญญาที่เป็นร่างหรือถูกส่งกลับ'; end if;
  return c;
end $$;

-- ลงนาม: ผู้ที่ถูกเลือก (ผู้แทนบริษัท หรือ พยาน) · ครบทั้งสองคน = ลงนามแล้ว
create or replace function ec_sign(p_id bigint)
returns emp_contracts language plpgsql security definer set search_path = public as $$
declare c emp_contracts; s letter_signers; snap jsonb;
begin
  select * into c from emp_contracts where id = p_id for update;
  if not (has_perm('data.empcontract.sign') or (c.witness_id = auth.uid() and has_perm('data.empcontract.write'))) then raise exception 'ไม่มีสิทธิ์ลงนามสัญญาจ้าง'; end if;
  if c.status is distinct from 'pending' then raise exception 'สัญญานี้ไม่ได้รอลงนาม'; end if;
  select * into s from letter_signers where user_id = auth.uid();
  if s.signature_path is null then raise exception 'ยังไม่ได้อัปโหลดลายเซ็น — ตั้งค่าที่ “ลายเซ็นของฉัน” ก่อน'; end if;
  snap := jsonb_build_object('name_th', s.name_th, 'title_th', s.title_th, 'signature_path', s.signature_path);
  perform set_config('ec.deciding', 'on', true);
  if c.signer_id = auth.uid() and c.signed_at is null then
    update emp_contracts set signer = snap, signed_at = now() where id = p_id;
  elsif c.witness_id = auth.uid() and c.witnessed_at is null then
    update emp_contracts set witness = snap, witnessed_at = now() where id = p_id;
  else raise exception 'สัญญานี้ไม่ได้รอลายเซ็นของคุณ'; end if;
  update emp_contracts set status = 'signed', updated_at = now() where id = p_id and signed_at is not null and witnessed_at is not null;
  select * into c from emp_contracts where id = p_id;
  return c;
end $$;

create or replace function ec_reject(p_id bigint, p_reason text)
returns emp_contracts language plpgsql security definer set search_path = public as $$
declare c emp_contracts;
begin
  select * into c from emp_contracts where id = p_id for update;
  if not (has_perm('data.empcontract.sign') or (c.witness_id = auth.uid() and has_perm('data.empcontract.write'))) then raise exception 'ไม่มีสิทธิ์'; end if;
  if c.status is distinct from 'pending' or auth.uid() not in (c.signer_id, c.witness_id) then raise exception 'สัญญานี้ไม่ได้รอลายเซ็นของคุณ'; end if;
  perform set_config('ec.deciding', 'on', true);
  update emp_contracts set status = 'rejected', reject_reason = coalesce(nullif(trim(p_reason), ''), 'ส่งกลับแก้ไข'),
         signer = null, witness = null, signed_at = null, witnessed_at = null, updated_at = now() where id = p_id returning * into c;
  return c;
end $$;

-- can_sign = ลงนามในนามบริษัทได้ · ที่เหลือ (HR ที่ทำสัญญา) เป็นพยานได้อย่างเดียว · ต้องตั้งลายเซ็นแล้ว
drop function if exists ec_signers();
create or replace function ec_signers()
returns table (user_id uuid, name text, title text, email text, can_sign boolean)
language sql security definer stable set search_path = public as $$
  select g.user_id, coalesce(nullif(g.name_th,''), g.name_en), coalesce(nullif(g.title_th,''), g.title_en), g.email, user_has_perm(g.user_id, 'data.empcontract.sign')
    from letter_signers g
   where (has_perm('data.empcontract.write') or has_perm('data.empcontract.sign')) and g.signature_path is not null
     and (user_has_perm(g.user_id, 'data.empcontract.sign') or user_has_perm(g.user_id, 'data.empcontract.write'))
   order by 2;
$$;
revoke all on function ec_submit(bigint, uuid, uuid), ec_sign(bigint), ec_reject(bigint, text), ec_signers() from public, anon;
grant execute on function ec_submit(bigint, uuid, uuid), ec_sign(bigint), ec_reject(bigint, text), ec_signers() to authenticated;

-- ------------------------------------------------------------------ ลิงก์ลงนามสำหรับผู้แทนบริษัท — กดจากอีเมลได้เลยไม่ต้อง login (user 2026-10-15)
--   แบบเดียวกับ HR Invoice Hub (exp_approve_tokens): ส่งลงนามเมื่อไร ออกลิงก์ลับใหม่ /econtract/sign.html?t=<token>
--   ใช้ได้ครั้งเดียว · 14 วัน · ใช้ไม่ได้ทันทีถ้าสัญญาถูกส่งกลับ/ยกเลิก หรือผู้แทนลงนามในระบบแล้ว
--   ลายเซ็นที่ลง = ของผู้แทนบริษัทที่ HR เลือก → ลิงก์ต้องไปถึงผู้แทนคนเดียว (พยานลงนามในระบบ)
--   ตาราง token ไม่มี policy → อ่านได้เฉพาะฟังก์ชันด้านล่างและ Edge Function · หน้าลิงก์ไม่เห็นเลขบัตรเต็ม
create table if not exists ec_sign_tokens (
  contract_id bigint primary key references emp_contracts(id) on delete cascade,
  token       text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz default now()
);
alter table ec_sign_tokens enable row level security;
revoke all on ec_sign_tokens from anon, authenticated;

create or replace function ec_token_issue() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' and old.status is distinct from 'pending' then
    insert into ec_sign_tokens (contract_id, token, expires_at)
    values (new.id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), now() + interval '14 days')
    on conflict (contract_id) do update set token = excluded.token, expires_at = excluded.expires_at, used_at = null, created_at = now();
  end if;
  return new;
end $$;
drop trigger if exists ec_token_issue on emp_contracts;
create trigger ec_token_issue after update on emp_contracts for each row execute function ec_token_issue();

-- หน้าลงนาม (ไม่ login): state = open | expired | closed · ไม่ส่งเลขบัตรเต็ม / อีเมลผู้ส่ง
create or replace function ec_link_get(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t ec_sign_tokens; c emp_contracts;
begin
  if coalesce(length(p_token), 0) < 40 then return jsonb_build_object('error', 'ลิงก์ไม่ถูกต้อง'); end if;
  select * into t from ec_sign_tokens where token = p_token;
  if t.contract_id is null then return jsonb_build_object('error', 'ลิงก์ไม่ถูกต้อง หรือมีการส่งลิงก์ใหม่แทนแล้ว'); end if;
  select * into c from emp_contracts where id = t.contract_id;
  return (to_jsonb(c) - 'id_card' - 'requested_email' - 'signer' - 'witness') || jsonb_build_object(
    'state', case when c.status = 'pending' and c.signed_at is null and t.used_at is null and t.expires_at > now() then 'open'
                  when c.status = 'pending' and c.signed_at is null and t.used_at is null then 'expired' else 'closed' end,
    'signer_name', (select coalesce(nullif(g.name_th,''), g.name_en) from letter_signers g where g.user_id = c.signer_id),
    'witness_name', (select coalesce(nullif(g.name_th,''), g.name_en) from letter_signers g where g.user_id = c.witness_id),
    'signer', c.signer - 'signature_path', 'witness', c.witness - 'signature_path', 'expires_at', t.expires_at);
end $$;

-- ลงนาม / ส่งกลับจากลิงก์ — ในนามผู้แทนบริษัทที่ HR เลือก
create or replace function ec_link_decide(p_token text, p_ok boolean, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t ec_sign_tokens; c emp_contracts; s letter_signers;
begin
  select * into t from ec_sign_tokens where token = p_token for update;
  if t.contract_id is null then raise exception 'ลิงก์ไม่ถูกต้อง หรือมีการส่งลิงก์ใหม่แทนแล้ว'; end if;
  if t.used_at is not null then raise exception 'ลิงก์นี้ใช้ไปแล้ว'; end if;
  if t.expires_at <= now() then raise exception 'ลิงก์หมดอายุแล้ว — เข้าสู่ระบบเพื่อลงนามแทน'; end if;
  select * into c from emp_contracts where id = t.contract_id for update;
  if c.status <> 'pending' or c.signed_at is not null then raise exception 'สัญญานี้ไม่ได้รอลายเซ็นผู้แทนบริษัทแล้ว'; end if;
  if not user_has_perm(c.signer_id, 'data.empcontract.sign') then raise exception 'ผู้แทนบริษัทของสัญญานี้ไม่มีสิทธิ์ลงนามแล้ว — ติดต่อ HR'; end if;
  perform set_config('ec.deciding', 'on', true);
  if p_ok then
    select * into s from letter_signers where user_id = c.signer_id;
    if s.signature_path is null then raise exception 'ผู้แทนบริษัทยังไม่ได้ตั้งลายเซ็น — ติดต่อ HR'; end if;
    update emp_contracts set signer = jsonb_build_object('name_th', s.name_th, 'title_th', s.title_th, 'signature_path', s.signature_path, 'via', 'email_link'),
           signed_at = now(), updated_at = now() where id = c.id;
    update emp_contracts set status = 'signed' where id = c.id and witnessed_at is not null;
  else
    if nullif(trim(p_reason), '') is null then raise exception 'กรุณาระบุเหตุผลที่ส่งกลับ'; end if;
    update emp_contracts set status = 'rejected', reject_reason = trim(p_reason), signer = null, witness = null,
           signed_at = null, witnessed_at = null, updated_at = now() where id = c.id;
  end if;
  update ec_sign_tokens set used_at = now() where contract_id = c.id;
  select * into c from emp_contracts where id = c.id;
  return jsonb_build_object('status', c.status, 'name', coalesce(c.title_th, '') || c.name_th);
end $$;

-- ลิงก์สำหรับใส่เมลแบบ Outlook (.eml) — ให้เฉพาะ HR คนที่ส่งลงนาม หรือตัวผู้แทนเอง
create or replace function ec_sign_link(p_id bigint) returns text
language sql stable security definer set search_path = public as $$
  select t.token from ec_sign_tokens t join emp_contracts c on c.id = t.contract_id
   where c.id = p_id and c.status = 'pending' and c.signed_at is null and t.used_at is null and t.expires_at > now()
     and auth.uid() in (c.requested_by, c.signer_id);
$$;
revoke all on function ec_link_get(text), ec_link_decide(text, boolean, text), ec_sign_link(bigint) from public;
grant execute on function ec_link_get(text), ec_link_decide(text, boolean, text) to anon, authenticated;
grant execute on function ec_sign_link(bigint) to authenticated;
-- สัญญาที่รอลงนามอยู่แล้วตอนรันไฟล์นี้: ออกลิงก์ให้ด้วย (กด "ส่งอีเมลเตือน" ได้)
insert into ec_sign_tokens (contract_id, token, expires_at)
select id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), now() + interval '14 days'
  from emp_contracts where status = 'pending' and signed_at is null
on conflict (contract_id) do nothing;

alter table emp_contracts enable row level security;
drop policy if exists "ec_read"   on emp_contracts;
drop policy if exists "ec_insert" on emp_contracts;
drop policy if exists "ec_update" on emp_contracts;
create policy "ec_read"   on emp_contracts for select using (has_perm('data.empcontract.write') or auth.uid() in (signer_id, witness_id));
create policy "ec_insert" on emp_contracts for insert with check (has_perm('data.empcontract.write'));
create policy "ec_update" on emp_contracts for update using (has_perm('data.empcontract.write')) with check (has_perm('data.empcontract.write'));

insert into permissions (key, category, label, description, sort_order) values
  ('page.empcontract',       'page', 'สัญญาจ้างงาน',        'ทำสัญญาจ้างงานและลงนามออนไลน์', 26),
  ('data.empcontract.write', 'data', 'ทำสัญญาจ้างงาน',      'สร้าง แก้ ส่งลงนาม พิมพ์สัญญาจ้าง (เห็นเงินเดือนในสัญญา)', 43),
  ('data.empcontract.sign',  'data', 'ลงนามสัญญาจ้างงาน',   'ลงนามในนามบริษัทหรือเป็นพยานในสัญญาจ้าง', 44)
on conflict (key) do update set label = excluded.label, description = excluded.description, sort_order = excluded.sort_order;
insert into role_permissions (role_key, perm_key)
select r.key, p.key from app_roles r cross join (values ('page.empcontract'), ('data.empcontract.write'), ('data.empcontract.sign')) as p(key)
where r.key = 'admin' on conflict do nothing;

-- แบบอีเมล (แก้ได้ในหน้าสัญญาจ้าง → ตั้งค่า) · ตัวแปรชุดเดียวกับแบบอื่น
-- ตาราง mail_templates จำกัดชื่อแบบไว้ (ชุดเดียวกับ schema_expense.sql / schema_fund_approval.sql — เพิ่มแบบใหม่ต้องแก้ทุกไฟล์)
alter table mail_templates drop constraint if exists mail_templates_key_check;
alter table mail_templates add constraint mail_templates_key_check
  check (key in ('request','approved','rejected','fund_request','fund_approved','fund_rejected','exp_review','exp_approve','exp_approved','exp_rejected','ec_sign','ec_signed','ec_rejected'));
insert into mail_templates (key, label, subject, html) values
  ('ec_sign', 'ขอลงนามสัญญาจ้าง', '[ขอลงนาม] สัญญาจ้างงาน — {{person}}',
   '<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;color:#1e293b"><p><b>มีสัญญาจ้างงานรอลงนามจากท่าน</b></p><p>{{person}} · {{kind}} · {{emp_code}}</p><p><a href="{{link}}">เปิดสัญญาเพื่อลงนาม</a></p><p style="color:#64748b;font-size:12px">ส่งโดย {{requester}}</p></div>'),
  ('ec_signed', 'แจ้งลงนามครบแล้ว', '[ลงนามแล้ว] สัญญาจ้างงาน — {{person}}',
   '<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px"><p><b>สัญญาจ้างงานลงนามครบแล้ว</b> (ผู้แทนบริษัทและพยาน)</p><p>{{person}} · {{kind}}</p><p><a href="{{link}}">เปิดสัญญาเพื่อพิมพ์ให้พนักงานลงนาม</a></p></div>'),
  ('ec_rejected', 'แจ้งส่งกลับแก้ไขสัญญา', '[ส่งกลับแก้ไข] สัญญาจ้างงาน — {{person}}',
   '<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px"><p><b>สัญญาจ้างงานถูกส่งกลับให้แก้ไข</b> โดย {{approver}}</p><p>{{person}} · {{kind}}</p><p>เหตุผล: {{reason}}</p><p><a href="{{link}}">เปิดสัญญา</a></p></div>')
on conflict (key) do nothing;

-- ============================================================================
-- สิทธิ์ลายเซ็น + แบบอีเมลรวมทุกระบบ — ชุดเดียวกันทุกไฟล์ (schema_hr_letters / schema_fund_approval / schema_expense / schema_contract_web / schema_emp_contract)
-- ============================================================================
drop policy if exists "mt_read"  on mail_templates;
drop policy if exists "mt_write" on mail_templates;
create policy "mt_read"  on mail_templates for select using (has_perm('page.letters') or (key like 'fund\_%' and has_perm('page.fundforms')) or (key like 'exp\_%' and has_perm('page.expense')) or (key like 'ec\_%' and has_perm('data.empcontract.write')));
create policy "mt_write" on mail_templates for update using (has_perm('data.letters.approve') or (key like 'fund\_%' and has_perm('data.fundforms.write')) or (key like 'exp\_%' and has_perm('data.expense.write')) or (key like 'ec\_%' and has_perm('data.empcontract.write')));
drop policy if exists "ls_read" on letter_signers;
create policy "ls_read" on letter_signers for select using (has_perm('page.letters') or has_perm('page.fundforms') or has_perm('page.expense')
  or has_perm('page.contractpay') or has_perm('data.contract.approve') or has_perm('page.empcontract') or has_perm('data.empcontract.sign'));
drop policy if exists "la_read" on storage.objects;
create policy "la_read" on storage.objects for select
  using (bucket_id = 'letter-assets' and (has_perm('data.letters.write') or has_perm('data.letters.approve')
         or has_perm('page.fundforms') or has_perm('page.expense') or has_perm('page.contractpay') or has_perm('data.contract.approve')
         or has_perm('data.empcontract.write') or has_perm('data.empcontract.sign')));
drop policy if exists "ls_write" on letter_signers;
create policy "ls_write" on letter_signers for all
  using ((user_id = auth.uid() and (has_perm('data.letters.approve') or has_perm('data.fundforms.write') or has_perm('data.fundforms.approve')
          or has_perm('data.expense.write') or has_perm('data.expense.review') or has_perm('data.expense.approve') or has_perm('data.contract.approve') or has_perm('data.empcontract.sign'))) or get_my_role() = 'admin')
  with check ((user_id = auth.uid() and (has_perm('data.letters.approve') or has_perm('data.fundforms.write') or has_perm('data.fundforms.approve')
          or has_perm('data.expense.write') or has_perm('data.expense.review') or has_perm('data.expense.approve') or has_perm('data.contract.approve') or has_perm('data.empcontract.sign'))) or get_my_role() = 'admin');
drop policy if exists "la_write"  on storage.objects;
drop policy if exists "la_update" on storage.objects;
drop policy if exists "la_delete" on storage.objects;
create policy "la_write" on storage.objects for insert with check (bucket_id = 'letter-assets' and (
  ((storage.foldername(name))[1] = 'seal' and has_perm('data.letters.approve'))
  or ((storage.foldername(name))[1] = 'signatures' and (get_my_role() = 'admin' or ((storage.foldername(name))[2] = auth.uid()::text
      and (has_perm('data.letters.approve') or has_perm('data.fundforms.write') or has_perm('data.fundforms.approve')
           or has_perm('data.expense.write') or has_perm('data.expense.review') or has_perm('data.expense.approve') or has_perm('data.contract.approve') or has_perm('data.empcontract.sign')))))));
create policy "la_update" on storage.objects for update using (bucket_id = 'letter-assets' and (
  ((storage.foldername(name))[1] = 'seal' and has_perm('data.letters.approve'))
  or ((storage.foldername(name))[1] = 'signatures' and (get_my_role() = 'admin' or ((storage.foldername(name))[2] = auth.uid()::text
      and (has_perm('data.letters.approve') or has_perm('data.fundforms.write') or has_perm('data.fundforms.approve')
           or has_perm('data.expense.write') or has_perm('data.expense.review') or has_perm('data.expense.approve') or has_perm('data.contract.approve') or has_perm('data.empcontract.sign')))))));
create policy "la_delete" on storage.objects for delete using (bucket_id = 'letter-assets' and (
  ((storage.foldername(name))[1] = 'seal' and has_perm('data.letters.approve'))
  or ((storage.foldername(name))[1] = 'signatures' and (get_my_role() = 'admin' or ((storage.foldername(name))[2] = auth.uid()::text
      and (has_perm('data.letters.approve') or has_perm('data.fundforms.write') or has_perm('data.fundforms.approve')
           or has_perm('data.expense.write') or has_perm('data.expense.review') or has_perm('data.expense.approve') or has_perm('data.contract.approve') or has_perm('data.empcontract.sign')))))));

select key, label from permissions where key like '%empcontract%';
