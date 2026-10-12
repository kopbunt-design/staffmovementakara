-- ============================================================================
-- ตรวจโอที (js/otaudit.js) — เวลากะ + สถานะ "แก้ใน TigerSoft แล้ว" ที่ทีมเห็นร่วมกัน · รันซ้ำได้ปลอดภัย
-- ============================================================================

-- เวลากะสำหรับตรวจโอที — แยกจาก master_shift_codes (ตารางนั้นใช้คิดค่ากะ และบังคับตระกูลกะ
-- ถ้าเพิ่มกะอย่าง F01 เข้าไปที่นั่น ค่ากะจะเปลี่ยน) · หน้าเว็บเดาเวลาจากคำขอโอที/เวลาสแกนให้ HR ยืนยัน
--   นาทีนับจาก 00:00 ของวันที่กะเริ่ม · end_min / break_* เกิน 1440 ได้ (กะข้ามคืน เช่น N01 23:30–08:00 = 1410–1920)
create table if not exists ot_shift_times (
  code         text primary key,                 -- ตัวใหญ่ เช่น NOR, D01, N01
  start_min    int not null check (start_min between 0 and 1439),
  end_min      int not null check (end_min > start_min and end_min <= start_min + 1440),
  break_start  int, break_end int,
  check ((break_start is null) = (break_end is null)),
  check (break_start is null or (break_end > break_start and break_start >= start_min and break_end <= end_min)),
  note         text,
  updated_by   text, updated_at timestamptz default now()
);

-- สถานะรายการที่ต้องตรวจ: ติ๊กแก้แล้ว / หมายเหตุ — key = รหัส|วันserial (1 แถวต่อคน-วันในหน้าเว็บ)
create table if not exists ot_audit_marks (
  ym         text not null check (ym ~ '^\d{4}-\d{2}$'),
  key        text not null,
  done       boolean not null default false,
  note       text,
  by_name    text, at timestamptz default now(),
  primary key (ym, key)
);

alter table ot_shift_times enable row level security;
alter table ot_audit_marks enable row level security;
drop policy if exists "ot_times_read"  on ot_shift_times;
drop policy if exists "ot_times_write" on ot_shift_times;
drop policy if exists "ot_marks_read"  on ot_audit_marks;
drop policy if exists "ot_marks_write" on ot_audit_marks;
-- หน้าตรวจโอทียืมสิทธิ์ของหน้าค่ากะ (PERM_ALIAS ใน js/app.js)
create policy "ot_times_read"  on ot_shift_times for select using (has_perm('page.shiftallow'));
create policy "ot_times_write" on ot_shift_times for all    using (has_perm('data.shiftallow.write')) with check (has_perm('data.shiftallow.write'));
create policy "ot_marks_read"  on ot_audit_marks for select using (has_perm('page.shiftallow'));
create policy "ot_marks_write" on ot_audit_marks for all    using (has_perm('data.shiftallow.write')) with check (has_perm('data.shiftallow.write'));

-- กะนับชั่วโมง (ผู้ใช้ยืนยัน 2026-10-12): ไม่ดูเวลาเข้า–เลิกตามนาฬิกา นับจากเวลาเข้างานจริง
--   ทำครบ "ชั่วโมงงานปกติ" แล้ว ส่วนที่เกินเป็นโอที (ไม่เกินที่ขอ)
--   hours_span = 510 (8.5 ชม. รวมพัก ไม่หักพัก) หรือ 570 (9.5 ชม. รวมพัก หักพัก 1 ชม.)
alter table ot_shift_times add column if not exists by_hours   boolean not null default false;
alter table ot_shift_times add column if not exists hours_span int check (hours_span is null or hours_span in (510, 570));
