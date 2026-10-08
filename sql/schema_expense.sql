-- ============================================================================
-- HR Invoice Hub — ใบแจ้งหนี้ HR (HRIN) และค่าใช้จ่ายฝ่าย HR · เว็บ /expense
-- ใช้ Supabase โปรเจกต์เดียวกับระบบ HR (บัญชี / สิทธิ์ / ลายเซ็นชุดเดียวกัน)
-- รันหลัง schema_rbac.sql และ schema_hr_letters.sql · รันซ้ำได้ปลอดภัย
--
-- ลำดับใบ: ร่าง → ตรวจ (review) → อนุมัติ (approval) → อนุมัติแล้ว (approved) → ส่งบัญชีแล้ว (received)
--   เลขที่ HRIN###/YYYY ออกตอนส่งตรวจครั้งแรก (ต่อจากเลขสูงสุดของปีนั้น รวมที่นำเข้าจาก Excel)
--   ลายเซ็นผู้จัดทำ / ผู้ตรวจ / ผู้อนุมัติ ลงในใบเมื่อแต่ละคนกดยืนยัน (letter_signers ชุดเดียวกับหนังสือ HR)
--   เปลี่ยนสถานะ / ผู้ตรวจ / ผู้อนุมัติ / ลายเซ็น ได้ผ่านฟังก์ชันเท่านั้น (trigger บังคับ)
-- ============================================================================

-- ------------------------------------------------------------------ 1. ข้อมูลหลัก
create table if not exists exp_categories (
  id         bigint generated always as identity primary key,
  name       text unique not null,                 -- ชื่อหมวดตามไฟล์เดิม เช่น Canteen, Funeral
  name_th    text,
  cost_code  text,                                 -- ใส่ทีหลังได้ — ใช้เป็นค่าตั้งต้นของรหัสบัญชีในบรรทัด
  sort_order int not null default 100,
  is_active  boolean not null default true,
  updated_at timestamptz default now()
);
create table if not exists exp_vendors (
  id         bigint generated always as identity primary key,
  code       text unique not null,                 -- V_Code เดิม เช่น T0009
  name       text not null,
  address    text,
  bank       text,                                 -- เช่น "GSB 020418732630 (สาขาวังโป่ง)"
  tax_id     text,
  is_active  boolean not null default true,
  updated_at timestamptz default now()
);

-- ------------------------------------------------------------------ 2. ใบแจ้งหนี้ + บรรทัด
create table if not exists exp_invoices (
  id            bigint generated always as identity primary key,
  inv_no        text unique,                       -- HRIN332/2026 (ว่างตอนเป็นร่าง)
  inv_year      int,
  inv_seq       int,
  inv_date      date not null default current_date,
  vendor_id     bigint references exp_vendors(id) on delete restrict,
  vendor        jsonb,                             -- สำเนา code/name/address/bank/tax_id ณ ตอนออก (ผู้ขายแก้ทีหลัง ใบเก่าไม่เปลี่ยน)
  category      text,                              -- ชื่อหมวด ณ ตอนออก
  ref_no        text,                              -- เลขใบแจ้งหนี้/ใบเสร็จของผู้ขาย
  ref_date      date,
  po_no         text,
  wht_rate      numeric not null default 0 check (wht_rate in (0,1,2,3,5)),
  amount        numeric not null default 0,        -- รวมก่อน VAT
  vat           numeric not null default 0,
  wht           numeric not null default 0,
  net           numeric not null default 0,        -- ยอดชำระ = amount + vat − wht
  status        text not null default 'draft'
                check (status in ('draft','review','approval','approved','received','rejected','cancelled')),
  note          text,
  reject_reason text,
  reviewer_id   uuid, approver_id uuid,
  preparer      jsonb, reviewer jsonb, approver jsonb,   -- {name, title, signature_path, at} ณ ตอนลงนาม
  prepared_by   uuid, submitted_at timestamptz,
  reviewed_by   uuid, reviewed_at  timestamptz,
  approved_by   uuid, approved_at  timestamptz,
  received_name text, received_at date,
  imported      boolean not null default false,    -- มาจาก Excel เดิม (ลงนามบนกระดาษแล้ว)
  created_by    uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (inv_year, inv_seq)
);
create index if not exists exp_inv_date_idx on exp_invoices (inv_date);
create index if not exists exp_inv_status_idx on exp_invoices (status);

create table if not exists exp_invoice_lines (
  id          bigint generated always as identity primary key,
  invoice_id  bigint not null references exp_invoices(id) on delete cascade,
  line_no     int not null default 1,
  cost_code   text,
  detail      text not null,
  detail2     text,                                -- บรรทัดที่ 2 (เดิม "Home No. & Detail_line 2")
  amount      numeric not null default 0,
  vat_rate    numeric not null default 0 check (vat_rate in (0,7)),
  vat         numeric not null default 0,
  wht         numeric not null default 0,
  net         numeric not null default 0
);
create index if not exists exp_lines_inv_idx on exp_invoice_lines (invoice_id);

-- งบประมาณรายปี (ปีงบ ก.ค.–มิ.ย. แบบหน้า Position Quota: fy 2027 = ก.ค. 2026 – มิ.ย. 2027)
create table if not exists exp_budgets (
  fy          int not null,
  category    text not null,
  amount      numeric not null default 0,
  updated_at  timestamptz default now(),
  primary key (fy, category)
);

-- ------------------------------------------------------------------ 3. กันแก้นอกขั้นตอน
create or replace function exp_inv_guard() returns trigger language plpgsql as $$
declare ok boolean := current_setting('exp.flow', true) = 'on';
begin
  if tg_op = 'INSERT' then
    if not ok and (new.status <> 'draft' or new.inv_no is not null or new.preparer is not null or new.imported) then
      raise exception 'ใบใหม่ต้องเริ่มจากร่าง';
    end if;
    return new;
  end if;
  if ok then return new; end if;
  if new.status is distinct from old.status or new.inv_no is distinct from old.inv_no
     or new.preparer is distinct from old.preparer or new.reviewer is distinct from old.reviewer or new.approver is distinct from old.approver
     or new.reviewer_id is distinct from old.reviewer_id or new.approver_id is distinct from old.approver_id then
    raise exception 'สถานะ เลขที่ และลายเซ็น เปลี่ยนได้ผ่านปุ่มในขั้นตอนเท่านั้น';
  end if;
  if old.status not in ('draft','rejected') and (new.vendor_id is distinct from old.vendor_id or new.amount <> old.amount
     or new.vat <> old.vat or new.wht <> old.wht or new.net <> old.net or new.inv_date <> old.inv_date
     or new.wht_rate <> old.wht_rate or new.category is distinct from old.category) then
    raise exception 'ใบนี้ส่งตรวจแล้ว — แก้ได้เมื่อถูกส่งกลับ หรือดึงกลับเป็นร่าง';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists exp_inv_guard on exp_invoices;
create trigger exp_inv_guard before insert or update on exp_invoices for each row execute function exp_inv_guard();

-- บรรทัดแก้ได้เฉพาะใบที่เป็นร่าง / ถูกส่งกลับ (หรือระหว่างนำเข้า)
create or replace function exp_line_guard() returns trigger language plpgsql as $$
declare st text;
begin
  if current_setting('exp.flow', true) = 'on' then return coalesce(new, old); end if;
  select status into st from exp_invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if st not in ('draft','rejected') then raise exception 'ใบนี้ส่งตรวจแล้ว แก้รายการไม่ได้'; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists exp_line_guard on exp_invoice_lines;
create trigger exp_line_guard before insert or update or delete on exp_invoice_lines for each row execute function exp_line_guard();

-- ------------------------------------------------------------------ 4. ขั้นตอน
-- ลายเซ็นของคนที่กด ณ ตอนกด
create or replace function exp_sig(uid uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', coalesce(nullif(g.name_en,''), g.name_th), 'name_th', g.name_th, 'title', coalesce(nullif(g.title_en,''), g.title_th),
                            'signature_path', g.signature_path, 'at', now())
    from letter_signers g where g.user_id = uid and g.signature_path is not null;
$$;

-- ส่งตรวจ: ออกเลข (ครั้งแรก) + ลายเซ็นผู้จัดทำ · ผู้ตรวจ/ผู้อนุมัติต้องมีสิทธิ์และลายเซ็น
create or replace function exp_submit(p_id bigint, p_reviewer uuid, p_approver uuid)
returns exp_invoices language plpgsql security definer set search_path = public as $$
declare v exp_invoices; s jsonb; y int; n int;
begin
  if not has_perm('data.expense.write') then raise exception 'ไม่มีสิทธิ์ออกใบแจ้งหนี้'; end if;
  select * into v from exp_invoices where id = p_id for update;
  if v.id is null then raise exception 'ไม่พบใบแจ้งหนี้'; end if;
  if v.status not in ('draft','rejected') then raise exception 'ใบนี้ส่งตรวจแล้ว'; end if;
  if v.vendor_id is null then raise exception 'เลือกผู้ขายก่อน'; end if;
  if not exists (select 1 from exp_invoice_lines where invoice_id = p_id) then raise exception 'ยังไม่มีรายการ'; end if;
  if p_reviewer is null or not user_has_perm(p_reviewer, 'data.expense.review') then raise exception 'ผู้ตรวจที่เลือกไม่มีสิทธิ์ตรวจ'; end if;
  if p_approver is null or not user_has_perm(p_approver, 'data.expense.approve') then raise exception 'ผู้อนุมัติที่เลือกไม่มีสิทธิ์อนุมัติ'; end if;
  if exp_sig(p_reviewer) is null or exp_sig(p_approver) is null then raise exception 'ผู้ตรวจ/ผู้อนุมัติยังไม่ได้ตั้งลายเซ็น'; end if;
  s := exp_sig(auth.uid());
  if s is null then raise exception 'ท่านยังไม่ได้ตั้งลายเซ็น (ใช้ลงช่องผู้จัดทำ)'; end if;
  perform set_config('exp.flow', 'on', true);
  if v.inv_no is null then
    y := extract(year from v.inv_date)::int;
    perform pg_advisory_xact_lock(hashtext('exp_inv_no'), y);
    select coalesce(max(inv_seq), 0) + 1 into n from exp_invoices where inv_year = y;
    update exp_invoices set inv_year = y, inv_seq = n, inv_no = 'HRIN' || lpad(n::text, 3, '0') || '/' || y where id = p_id;
  end if;
  update exp_invoices set status = 'review', reviewer_id = p_reviewer, approver_id = p_approver, preparer = s,
         reviewer = null, approver = null, prepared_by = auth.uid(), submitted_at = now(), reject_reason = null
   where id = p_id returning * into v;
  return v;
end $$;

-- ผู้ตรวจ / ผู้อนุมัติ: ผ่าน (ลงลายเซ็น) หรือส่งกลับพร้อมเหตุผล — เฉพาะคนที่ถูกเลือก
create or replace function exp_decide(p_id bigint, p_ok boolean, p_reason text)
returns exp_invoices language plpgsql security definer set search_path = public as $$
declare v exp_invoices; s jsonb;
begin
  select * into v from exp_invoices where id = p_id for update;
  if v.id is null then raise exception 'ไม่พบใบแจ้งหนี้'; end if;
  perform set_config('exp.flow', 'on', true);
  if v.status = 'review' then
    if v.reviewer_id is distinct from auth.uid() or not has_perm('data.expense.review') then raise exception 'ใบนี้รอผู้ตรวจท่านอื่น'; end if;
    if p_ok then
      s := exp_sig(auth.uid()); if s is null then raise exception 'ท่านยังไม่ได้ตั้งลายเซ็น'; end if;
      update exp_invoices set status = 'approval', reviewer = s, reviewed_by = auth.uid(), reviewed_at = now() where id = p_id returning * into v;
    else
      update exp_invoices set status = 'rejected', reject_reason = nullif(trim(p_reason), '') where id = p_id returning * into v;
    end if;
  elsif v.status = 'approval' then
    if v.approver_id is distinct from auth.uid() or not has_perm('data.expense.approve') then raise exception 'ใบนี้รอผู้อนุมัติท่านอื่น'; end if;
    if p_ok then
      s := exp_sig(auth.uid()); if s is null then raise exception 'ท่านยังไม่ได้ตั้งลายเซ็น'; end if;
      update exp_invoices set status = 'approved', approver = s, approved_by = auth.uid(), approved_at = now() where id = p_id returning * into v;
    else
      update exp_invoices set status = 'rejected', reject_reason = nullif(trim(p_reason), ''), reviewer = null where id = p_id returning * into v;
    end if;
  else
    raise exception 'ใบนี้ไม่ได้รอตรวจ/อนุมัติ';
  end if;
  return v;
end $$;

-- HR: ดึงกลับเป็นร่าง (ก่อนอนุมัติ) · ส่งบัญชีแล้ว · ยกเลิก
create or replace function exp_action(p_id bigint, p_action text, p_text text default null, p_date date default null)
returns exp_invoices language plpgsql security definer set search_path = public as $$
declare v exp_invoices;
begin
  if not has_perm('data.expense.write') then raise exception 'ไม่มีสิทธิ์จัดการใบแจ้งหนี้'; end if;
  select * into v from exp_invoices where id = p_id for update;
  if v.id is null then raise exception 'ไม่พบใบแจ้งหนี้'; end if;
  perform set_config('exp.flow', 'on', true);
  if p_action = 'recall' then
    if v.status not in ('review','approval') then raise exception 'ดึงกลับได้เฉพาะใบที่รอตรวจ/รออนุมัติ'; end if;
    update exp_invoices set status = 'draft', reviewer = null, approver = null where id = p_id returning * into v;
  elsif p_action = 'receive' then
    if v.status <> 'approved' then raise exception 'ส่งบัญชีได้เมื่ออนุมัติแล้ว'; end if;
    update exp_invoices set status = 'received', received_name = nullif(trim(p_text), ''), received_at = coalesce(p_date, current_date)
     where id = p_id returning * into v;
  elsif p_action = 'cancel' then
    if v.status in ('cancelled') then raise exception 'ยกเลิกไปแล้ว'; end if;
    update exp_invoices set status = 'cancelled', reject_reason = nullif(trim(p_text), '') where id = p_id returning * into v;
  else raise exception 'action ไม่ถูกต้อง';
  end if;
  return v;
end $$;

-- นำเข้าจาก Excel เดิม (ครั้งละหลายใบ) — ใบที่มีเลขแล้วข้าม · สถานะ = ส่งบัญชีแล้ว (ลงนามบนกระดาษแล้ว)
-- p_rows: [{inv_no, inv_date, category, vendor_code, wht_rate, lines:[{cost_code, detail, detail2, amount, vat, wht}]}]
create or replace function exp_import(p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare r jsonb; l jsonb; vid bigint; iid bigint; n int := 0; vend exp_vendors; a numeric; va numeric; w numeric; i int;
begin
  if not has_perm('data.expense.write') then raise exception 'ไม่มีสิทธิ์นำเข้า'; end if;
  perform set_config('exp.flow', 'on', true);
  for r in select * from jsonb_array_elements(p_rows) loop
    if exists (select 1 from exp_invoices where inv_no = r->>'inv_no') then continue; end if;
    select * into vend from exp_vendors where code = r->>'vendor_code';
    insert into exp_invoices (inv_no, inv_year, inv_seq, inv_date, vendor_id, vendor, category, wht_rate, status, imported, received_at, created_by)
    values (r->>'inv_no', split_part(r->>'inv_no', '/', 2)::int, nullif(regexp_replace(split_part(r->>'inv_no', '/', 1), '\D', '', 'g'), '')::int,
            (r->>'inv_date')::date, vend.id,
            case when vend.id is null then jsonb_build_object('code', r->>'vendor_code') else jsonb_build_object('code', vend.code, 'name', vend.name, 'address', vend.address, 'bank', vend.bank, 'tax_id', vend.tax_id) end,
            r->>'category', coalesce((r->>'wht_rate')::numeric, 0), 'received', true, (r->>'inv_date')::date, auth.uid())
    returning id into iid;
    a := 0; va := 0; w := 0; i := 0;
    for l in select * from jsonb_array_elements(r->'lines') loop
      i := i + 1;
      insert into exp_invoice_lines (invoice_id, line_no, cost_code, detail, detail2, amount, vat_rate, vat, wht, net)
      values (iid, i, nullif(l->>'cost_code', ''), coalesce(l->>'detail', ''), nullif(l->>'detail2', ''),
              coalesce((l->>'amount')::numeric, 0), case when coalesce((l->>'vat')::numeric, 0) > 0 then 7 else 0 end,
              coalesce((l->>'vat')::numeric, 0), coalesce((l->>'wht')::numeric, 0),
              coalesce((l->>'amount')::numeric, 0) + coalesce((l->>'vat')::numeric, 0) - coalesce((l->>'wht')::numeric, 0));
      a := a + coalesce((l->>'amount')::numeric, 0); va := va + coalesce((l->>'vat')::numeric, 0); w := w + coalesce((l->>'wht')::numeric, 0);
    end loop;
    update exp_invoices set amount = a, vat = va, wht = w, net = a + va - w where id = iid;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function exp_submit(bigint, uuid, uuid)            from public, anon;
revoke all on function exp_decide(bigint, boolean, text)          from public, anon;
revoke all on function exp_action(bigint, text, text, date)       from public, anon;
revoke all on function exp_import(jsonb)                          from public, anon;
revoke all on function exp_sig(uuid)                              from public, anon;
grant execute on function exp_submit(bigint, uuid, uuid)          to authenticated;
grant execute on function exp_decide(bigint, boolean, text)       to authenticated;
grant execute on function exp_action(bigint, text, text, date)    to authenticated;
grant execute on function exp_import(jsonb)                       to authenticated;

-- คนที่เลือกเป็นผู้ตรวจ / ผู้อนุมัติได้ (มีสิทธิ์ + ตั้งลายเซ็นแล้ว)
create or replace function exp_signers()
returns table (user_id uuid, name text, title text, email text, can_review boolean, can_approve boolean)
language sql security definer stable set search_path = public as $$
  select g.user_id, coalesce(nullif(g.name_th,''), g.name_en), coalesce(nullif(g.title_th,''), g.title_en), g.email,
         user_has_perm(g.user_id, 'data.expense.review'), user_has_perm(g.user_id, 'data.expense.approve')
    from letter_signers g
   where has_perm('page.expense') and g.signature_path is not null
     and (user_has_perm(g.user_id, 'data.expense.review') or user_has_perm(g.user_id, 'data.expense.approve'))
   order by 2;
$$;
revoke all on function exp_signers() from public, anon;
grant execute on function exp_signers() to authenticated;

-- ------------------------------------------------------------------ 5. RLS
alter table exp_categories    enable row level security;
alter table exp_vendors       enable row level security;
alter table exp_invoices      enable row level security;
alter table exp_invoice_lines enable row level security;
alter table exp_budgets       enable row level security;
do $$
declare t text;
begin
  foreach t in array array['exp_categories','exp_vendors','exp_invoices','exp_invoice_lines','exp_budgets'] loop
    execute format('drop policy if exists "%s_read"  on %I', t, t);
    execute format('drop policy if exists "%s_write" on %I', t, t);
    execute format('create policy "%s_read"  on %I for select using (has_perm(''page.expense''))', t, t);
    execute format('create policy "%s_write" on %I for all using (has_perm(''data.expense.write'')) with check (has_perm(''data.expense.write''))', t, t);
  end loop;
end $$;

-- ------------------------------------------------------------------ 6. ลายเซ็น: ให้ผู้ใช้ HR Invoice Hub อ่าน/ตั้งของตัวเองได้
--   (ชุดเดียวกับ schema_hr_letters.sql ข้อ 12 และ schema_fund_approval.sql — แก้ให้ตรงกันทุกไฟล์)
drop policy if exists "ls_read" on letter_signers;
create policy "ls_read" on letter_signers for select using (has_perm('page.letters') or has_perm('page.fundforms') or has_perm('page.expense'));
drop policy if exists "la_read" on storage.objects;
create policy "la_read" on storage.objects for select
  using (bucket_id = 'letter-assets' and (has_perm('data.letters.write') or has_perm('data.letters.approve')
         or has_perm('page.fundforms') or has_perm('page.expense')));
drop policy if exists "ls_write" on letter_signers;
create policy "ls_write" on letter_signers for all
  using ((user_id = auth.uid() and (has_perm('data.letters.approve') or has_perm('data.fundforms.write') or has_perm('data.fundforms.approve')
          or has_perm('data.expense.write') or has_perm('data.expense.review') or has_perm('data.expense.approve'))) or get_my_role() = 'admin')
  with check ((user_id = auth.uid() and (has_perm('data.letters.approve') or has_perm('data.fundforms.write') or has_perm('data.fundforms.approve')
          or has_perm('data.expense.write') or has_perm('data.expense.review') or has_perm('data.expense.approve'))) or get_my_role() = 'admin');
drop policy if exists "la_write"  on storage.objects;
drop policy if exists "la_update" on storage.objects;
drop policy if exists "la_delete" on storage.objects;
create policy "la_write" on storage.objects for insert with check (bucket_id = 'letter-assets' and (
  ((storage.foldername(name))[1] = 'seal' and has_perm('data.letters.approve'))
  or ((storage.foldername(name))[1] = 'signatures' and (get_my_role() = 'admin' or ((storage.foldername(name))[2] = auth.uid()::text
      and (has_perm('data.letters.approve') or has_perm('data.fundforms.write') or has_perm('data.fundforms.approve')
           or has_perm('data.expense.write') or has_perm('data.expense.review') or has_perm('data.expense.approve')))))));
create policy "la_update" on storage.objects for update using (bucket_id = 'letter-assets' and (
  ((storage.foldername(name))[1] = 'seal' and has_perm('data.letters.approve'))
  or ((storage.foldername(name))[1] = 'signatures' and (get_my_role() = 'admin' or ((storage.foldername(name))[2] = auth.uid()::text
      and (has_perm('data.letters.approve') or has_perm('data.fundforms.write') or has_perm('data.fundforms.approve')
           or has_perm('data.expense.write') or has_perm('data.expense.review') or has_perm('data.expense.approve')))))));
create policy "la_delete" on storage.objects for delete using (bucket_id = 'letter-assets' and (
  ((storage.foldername(name))[1] = 'seal' and has_perm('data.letters.approve'))
  or ((storage.foldername(name))[1] = 'signatures' and (get_my_role() = 'admin' or ((storage.foldername(name))[2] = auth.uid()::text
      and (has_perm('data.letters.approve') or has_perm('data.fundforms.write') or has_perm('data.fundforms.approve')
           or has_perm('data.expense.write') or has_perm('data.expense.review') or has_perm('data.expense.approve')))))));

-- ------------------------------------------------------------------ 7. สิทธิ์
insert into permissions (key, category, label, description, sort_order) values
  ('page.expense',         'page', 'HR Invoice Hub (ใบแจ้งหนี้)', 'เปิดเว็บ HR Invoice Hub — ใบแจ้งหนี้ HR และค่าใช้จ่ายฝ่าย HR', 25),
  ('data.expense.write',   'data', 'ออกใบแจ้งหนี้ HR',       'สร้าง/แก้ใบแจ้งหนี้ ผู้ขาย หมวด งบ และนำเข้าจาก Excel (ลงนามช่องผู้จัดทำ)', 44),
  ('data.expense.review',  'data', 'ตรวจใบแจ้งหนี้ HR',      'ลงนามช่อง Reviewed by', 45),
  ('data.expense.approve', 'data', 'อนุมัติใบแจ้งหนี้ HR',   'ลงนามช่อง Approved by', 46)
on conflict (key) do update set label = excluded.label, description = excluded.description, sort_order = excluded.sort_order;

insert into role_permissions (role_key, perm_key)
select r.key, p.key from app_roles r cross join (values ('page.expense'), ('data.expense.write'), ('data.expense.review')) as p(key)
where r.key in ('admin', 'hr')
on conflict do nothing;

-- ------------------------------------------------------------------ 8. อีเมลแจ้งเตือน (ผ่าน Edge Function letter-notify · โหมด Outlook = ไฟล์ .eml)
--   ตัวแปร: {{doc_no}}=เลขที่ · {{person}}=ผู้ขาย · {{kind}}=รายการแรก/หมวด · {{emp_code}}=ยอดชำระ · {{requester}} {{approver}} {{reason}} {{link}}
alter table mail_templates drop constraint if exists mail_templates_key_check;
alter table mail_templates add constraint mail_templates_key_check check (key in ('request','approved','rejected','fund_request','fund_approved','fund_rejected','exp_review','exp_approve','exp_approved','exp_rejected'));
insert into mail_templates (key, label, subject, html) values
('exp_review', 'HR Invoice Hub: ขอให้ตรวจ', '[ขอตรวจ] ใบแจ้งหนี้ {{doc_no}} — {{person}}', $h$<!-- akara-exp-v1 · Outlook-safe -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EEF2F7" style="background:#EEF2F7;"><tr><td align="center" style="padding:28px 12px;">
 <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:560px;background:#FFFFFF;border:1px solid #E2E8F0;">
  <tr><td bgcolor="#0F1C4D" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#0F1C4D;color:#FFFFFF;padding:16px 28px;font-size:14px;line-height:150%;">HR Invoice Hub · Akara Resources</td></tr>
  <tr><td align="center" style="padding:26px 28px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#EEF3FB" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#EEF3FB;color:#2B5AC7;font-size:13px;font-weight:bold;line-height:150%;padding:5px 16px;">● รอท่านตรวจ</td></tr></table></td></tr>
  <tr><td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:14px 36px 4px;color:#0F1C4D;font-size:22px;font-weight:bold;line-height:150%;">ใบแจ้งหนี้รอท่านตรวจ</td></tr>
  <tr><td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:4px 36px 22px;color:#64748B;font-size:15px;line-height:160%;">จัดทำโดย {{requester}}</td></tr>
  <tr><td style="padding:0 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F8FAFC" style="background:#F8FAFC;border:1px solid #E2E8F0;"><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;color:#64748B;font-size:14px;line-height:150%;" valign="top">เลขที่</td><td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;color:#1E293B;font-size:15px;line-height:150%;"><b>{{doc_no}}</b></td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">ผู้ขาย</td><td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;">{{person}}</td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">รายการ</td><td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;">{{kind}}</td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">ยอดชำระ</td><td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;"><b>{{emp_code}}</b></td></tr></table></td></tr>
  <tr><td align="center" style="padding:28px 28px 6px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#2B5AC7" style="background:#2B5AC7;padding:14px 32px;">
   <a href="{{link}}" target="_blank" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;color:#FFFFFF;text-decoration:none;font-size:16px;font-weight:bold;line-height:150%;display:block;">เปิดใบแจ้งหนี้เพื่อตรวจ</a></td></tr></table></td></tr>
  <tr><td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 28px 0;color:#94A3B8;font-size:12px;line-height:160%;">หากปุ่มไม่ทำงาน คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์<br><a href="{{link}}" style="color:#2B5AC7;">{{link}}</a></td></tr>
  <tr><td style="padding:22px 28px 30px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#F5F3FF" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#F5F3FF;border-left:4px solid #6D28D9;padding:12px 16px;color:#4C1D95;font-size:13px;line-height:160%;">🔒 ต้องเข้าสู่ระบบก่อนเปิดดู · ลายเซ็นของท่านลงช่อง Reviewed by เมื่อกดยืนยัน</td></tr></table></td></tr>
 </table></td></tr></table>$h$),
('exp_approve', 'HR Invoice Hub: ขอให้อนุมัติ', '[ขออนุมัติ] ใบแจ้งหนี้ {{doc_no}} — {{person}}', $h$<!-- akara-exp-v1 · Outlook-safe -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EEF2F7" style="background:#EEF2F7;"><tr><td align="center" style="padding:28px 12px;">
 <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:560px;background:#FFFFFF;border:1px solid #E2E8F0;">
  <tr><td bgcolor="#0F1C4D" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#0F1C4D;color:#FFFFFF;padding:16px 28px;font-size:14px;line-height:150%;">HR Invoice Hub · Akara Resources</td></tr>
  <tr><td align="center" style="padding:26px 28px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#EDE9FE" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#EDE9FE;color:#6D28D9;font-size:13px;font-weight:bold;line-height:150%;padding:5px 16px;">● รอท่านอนุมัติ</td></tr></table></td></tr>
  <tr><td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:14px 36px 4px;color:#0F1C4D;font-size:22px;font-weight:bold;line-height:150%;">ใบแจ้งหนี้รอท่านอนุมัติ</td></tr>
  <tr><td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:4px 36px 22px;color:#64748B;font-size:15px;line-height:160%;">ตรวจแล้วโดย {{requester}}</td></tr>
  <tr><td style="padding:0 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F8FAFC" style="background:#F8FAFC;border:1px solid #E2E8F0;"><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;color:#64748B;font-size:14px;line-height:150%;" valign="top">เลขที่</td><td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;color:#1E293B;font-size:15px;line-height:150%;"><b>{{doc_no}}</b></td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">ผู้ขาย</td><td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;">{{person}}</td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">รายการ</td><td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;">{{kind}}</td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">ยอดชำระ</td><td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;"><b>{{emp_code}}</b></td></tr></table></td></tr>
  <tr><td align="center" style="padding:28px 28px 6px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#2B5AC7" style="background:#2B5AC7;padding:14px 32px;">
   <a href="{{link}}" target="_blank" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;color:#FFFFFF;text-decoration:none;font-size:16px;font-weight:bold;line-height:150%;display:block;">เปิดใบแจ้งหนี้เพื่ออนุมัติ</a></td></tr></table></td></tr>
  <tr><td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 28px 0;color:#94A3B8;font-size:12px;line-height:160%;">หากปุ่มไม่ทำงาน คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์<br><a href="{{link}}" style="color:#2B5AC7;">{{link}}</a></td></tr>
  <tr><td style="padding:22px 28px 30px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#F5F3FF" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#F5F3FF;border-left:4px solid #6D28D9;padding:12px 16px;color:#4C1D95;font-size:13px;line-height:160%;">🔒 ต้องเข้าสู่ระบบก่อนเปิดดู · ลายเซ็นของท่านลงช่อง Approved by เมื่อกดอนุมัติ</td></tr></table></td></tr>
 </table></td></tr></table>$h$),
('exp_approved', 'HR Invoice Hub: แจ้งอนุมัติแล้ว', '[อนุมัติแล้ว] ใบแจ้งหนี้ {{doc_no}} — {{person}}', $h$<!-- akara-exp-v1 · Outlook-safe -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EEF2F7" style="background:#EEF2F7;"><tr><td align="center" style="padding:28px 12px;">
 <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:560px;background:#FFFFFF;border:1px solid #E2E8F0;">
  <tr><td bgcolor="#0F1C4D" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#0F1C4D;color:#FFFFFF;padding:16px 28px;font-size:14px;line-height:150%;">HR Invoice Hub · Akara Resources</td></tr>
  <tr><td align="center" style="padding:26px 28px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#E6F5EE" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#E6F5EE;color:#0D7C4B;font-size:13px;font-weight:bold;line-height:150%;padding:5px 16px;">✓ อนุมัติแล้ว</td></tr></table></td></tr>
  <tr><td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:14px 36px 4px;color:#0F1C4D;font-size:22px;font-weight:bold;line-height:150%;">ใบแจ้งหนี้อนุมัติแล้ว</td></tr>
  <tr><td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:4px 36px 22px;color:#64748B;font-size:15px;line-height:160%;">อนุมัติโดย {{approver}}</td></tr>
  <tr><td style="padding:0 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F8FAFC" style="background:#F8FAFC;border:1px solid #E2E8F0;"><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;color:#64748B;font-size:14px;line-height:150%;" valign="top">เลขที่</td><td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;color:#1E293B;font-size:15px;line-height:150%;"><b>{{doc_no}}</b></td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">ผู้ขาย</td><td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;">{{person}}</td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">รายการ</td><td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;">{{kind}}</td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">ยอดชำระ</td><td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;"><b>{{emp_code}}</b></td></tr></table></td></tr>
  <tr><td align="center" style="padding:28px 28px 6px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#2B5AC7" style="background:#2B5AC7;padding:14px 32px;">
   <a href="{{link}}" target="_blank" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;color:#FFFFFF;text-decoration:none;font-size:16px;font-weight:bold;line-height:150%;display:block;">เปิดใบแจ้งหนี้ / พิมพ์</a></td></tr></table></td></tr>
  <tr><td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 28px 0;color:#94A3B8;font-size:12px;line-height:160%;">หากปุ่มไม่ทำงาน คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์<br><a href="{{link}}" style="color:#2B5AC7;">{{link}}</a></td></tr>
  <tr><td style="padding:22px 28px 30px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#F5F3FF" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#F5F3FF;border-left:4px solid #6D28D9;padding:12px 16px;color:#4C1D95;font-size:13px;line-height:160%;">พิมพ์ใบที่มีลายเซ็นครบ แล้วส่งฝ่ายบัญชี จากนั้นกด “ส่งบัญชีแล้ว” ในระบบ</td></tr></table></td></tr>
 </table></td></tr></table>$h$),
('exp_rejected', 'HR Invoice Hub: แจ้งส่งกลับแก้ไข', '[ส่งกลับ] ใบแจ้งหนี้ {{doc_no}} — {{person}}', $h$<!-- akara-exp-v1 · Outlook-safe -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EEF2F7" style="background:#EEF2F7;"><tr><td align="center" style="padding:28px 12px;">
 <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:560px;background:#FFFFFF;border:1px solid #E2E8F0;">
  <tr><td bgcolor="#0F1C4D" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#0F1C4D;color:#FFFFFF;padding:16px 28px;font-size:14px;line-height:150%;">HR Invoice Hub · Akara Resources</td></tr>
  <tr><td align="center" style="padding:26px 28px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#FDECEA" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#FDECEA;color:#C0392B;font-size:13px;font-weight:bold;line-height:150%;padding:5px 16px;">↩ ส่งกลับแก้ไข</td></tr></table></td></tr>
  <tr><td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:14px 36px 4px;color:#0F1C4D;font-size:22px;font-weight:bold;line-height:150%;">ใบแจ้งหนี้ถูกส่งกลับให้แก้ไข</td></tr>
  <tr><td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:4px 36px 22px;color:#64748B;font-size:15px;line-height:160%;">โดย {{approver}}</td></tr>
  <tr><td style="padding:0 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F8FAFC" style="background:#F8FAFC;border:1px solid #E2E8F0;"><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;color:#64748B;font-size:14px;line-height:150%;" valign="top">เลขที่</td><td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;color:#1E293B;font-size:15px;line-height:150%;"><b>{{doc_no}}</b></td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">ผู้ขาย</td><td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;">{{person}}</td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">รายการ</td><td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;">{{kind}}</td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">ยอดชำระ</td><td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;"><b>{{emp_code}}</b></td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">เหตุผล</td><td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;"><span style="color:#C0392B;">{{reason}}</span></td></tr></table></td></tr>
  <tr><td align="center" style="padding:28px 28px 6px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#2B5AC7" style="background:#2B5AC7;padding:14px 32px;">
   <a href="{{link}}" target="_blank" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;color:#FFFFFF;text-decoration:none;font-size:16px;font-weight:bold;line-height:150%;display:block;">เปิดใบแจ้งหนี้</a></td></tr></table></td></tr>
  <tr><td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 28px 0;color:#94A3B8;font-size:12px;line-height:160%;">หากปุ่มไม่ทำงาน คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์<br><a href="{{link}}" style="color:#2B5AC7;">{{link}}</a></td></tr>
  <tr><td style="padding:22px 28px 30px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#F5F3FF" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#F5F3FF;border-left:4px solid #6D28D9;padding:12px 16px;color:#4C1D95;font-size:13px;line-height:160%;">แก้ไขแล้วกดส่งตรวจใหม่ได้ เลขที่ใบเดิมยังใช้ต่อ</td></tr></table></td></tr>
 </table></td></tr></table>$h$)
on conflict (key) do nothing;

-- แบบอีเมล: แต่ละระบบอ่าน/แก้แบบของตัวเอง (ชุดเดียวกันทุกไฟล์ — ต้องอยู่ท้ายไฟล์)
drop policy if exists "ms_read"  on mail_settings;
create policy "ms_read"  on mail_settings for select using (has_perm('page.letters') or has_perm('page.fundforms') or has_perm('page.expense'));
drop policy if exists "mt_read"  on mail_templates;
drop policy if exists "mt_write" on mail_templates;
create policy "mt_read"  on mail_templates for select using (has_perm('page.letters') or (key like 'fund\_%' and has_perm('page.fundforms')) or (key like 'exp\_%' and has_perm('page.expense')));
create policy "mt_write" on mail_templates for update using (has_perm('data.letters.approve') or (key like 'fund\_%' and has_perm('data.fundforms.write')) or (key like 'exp\_%' and has_perm('data.expense.write')));

-- ------------------------------------------------------------------ 9. ไฟล์แนบ (ใบเสร็จร้านค้า / รายชื่อ ฯลฯ) — เก็บแบบส่วนตัว
create table if not exists exp_files (
  id          bigint generated always as identity primary key,
  invoice_id  bigint not null references exp_invoices(id) on delete cascade,
  path        text not null,                        -- path ใน bucket expense-files
  name        text not null,
  size        bigint,
  uploaded_by uuid, uploaded_at timestamptz default now()
);
create index if not exists exp_files_inv_idx on exp_files (invoice_id);
alter table exp_files enable row level security;
drop policy if exists "exp_files_read"  on exp_files;
drop policy if exists "exp_files_write" on exp_files;
create policy "exp_files_read"  on exp_files for select using (has_perm('page.expense'));
create policy "exp_files_write" on exp_files for all using (has_perm('data.expense.write')) with check (has_perm('data.expense.write'));

insert into storage.buckets (id, name, public) values ('expense-files', 'expense-files', false) on conflict (id) do nothing;
drop policy if exists "ef_read"   on storage.objects;
drop policy if exists "ef_write"  on storage.objects;
drop policy if exists "ef_delete" on storage.objects;
create policy "ef_read"   on storage.objects for select using (bucket_id = 'expense-files' and has_perm('page.expense'));
create policy "ef_write"  on storage.objects for insert with check (bucket_id = 'expense-files' and has_perm('data.expense.write'));
create policy "ef_delete" on storage.objects for delete using (bucket_id = 'expense-files' and has_perm('data.expense.write'));

-- ------------------------------------------------------------------ 10. ชื่อระบบ: HR Spend → HR Invoice Hub (2026-10-08)
--   แบบอีเมลที่มีอยู่แล้ว (insert ... do nothing ไม่ทับ) — เปลี่ยนเฉพาะคำว่า HR Spend ข้อความที่ HR แก้เองยังอยู่
update mail_templates set label = replace(label, 'HR Spend', 'HR Invoice Hub'), html = replace(html, 'HR Spend', 'HR Invoice Hub'),
       subject = replace(subject, 'HR Spend', 'HR Invoice Hub')
 where key like 'exp\_%' and (label like '%HR Spend%' or html like '%HR Spend%' or subject like '%HR Spend%');
