# TODO / สถานะงาน

อัปเดตล่าสุด: 2026-08-18

## 🐛 บั๊กค้างรอแก้
ไม่มีบั๊กค้างแล้ว ✅

## ⏸️ พักไว้ก่อน (ผู้ใช้ขอชะลอ 2026-08-18)
- **ซ่อม status ที่เป็นชื่อจังหวัด** — `sql/fix_employee_status.sql`
  - โค้ดฝั่งเว็บกันค่าผิดตอน import แล้ว (ของใหม่จะไม่เพี้ยนอีก) เหลือแค่ล้างของเดิมที่ค้างใน DB
  - ไฟล์ทำเป็น review-first: **STEP 1 = SELECT ดูก่อน** ว่ากระทบใครบ้าง, STEP 2 = UPDATE (comment ไว้ ต้องเปิดเอง)
  - คนที่มี `end_date` อยู่แล้วต้องดูเป็นราย ๆ ว่าควรเป็น Resigned / Terminated / Retired — ไม่เดาแทน เพราะมีผลต่อรายงาน
  - จนกว่าจะซ่อม: หน้า Employees จะยังเห็น badge สถานะเป็นชื่อจังหวัดในบางแถว และตัวกรอง "ทุกสถานะ" จะกรองคนกลุ่มนี้ไม่เจอ

## 🔍 รอผู้ใช้ตรวจตัวเลขจริง (ยังไม่มีใครยืนยัน)
Dashboard ใหม่ + กฎวันที่ push ขึ้น production แล้ว (commit `e7ebf63`) แต่ยังไม่ได้เทียบกับข้อมูลจริง:
- เดือน **ก.ค. พ้นสภาพ +1 / ส.ค. −1** เทียบกับก่อนเปลี่ยนกฎ
- Dashboard / Headcount Report / Movement Report / Workforce Overview ต้องได้เลข **ตรงกันทั้ง 4 หน้า**
- Console ไม่มี error

## ✅ เสร็จ + push ขึ้น production แล้ว

### Dashboard ผู้บริหาร + รวมกฎวันที่ (2026-08-11, commit `e7ebf63`)
- **Dashboard เขียนใหม่ทั้งหน้า** สไตล์ Premium Executive (navy/ทอง, การ์ดมุมโค้ง 16px, design tokens `--exec-*`)
  1. KPI: การ์ด Headcount เด่น + เทียบเดือนก่อน (จำนวน+%) + progress เทียบแผน · เข้าใหม่ / พ้นสภาพ / อัตราลาออก
  2. ข้อมูลเชิงลึกกำลังคน + กำลังพ้นสภาพ 30/60/90 วัน
  3. กราฟแนวโน้ม 6 เดือน — เส้นกำลังคน + แท่งเข้า/ออก + เส้นประแผน + tooltip
  4. Waterfall (ยกมา+เข้า−ออก=ยกไป) + แผนก Actual/Plan/Gap (เกณฑ์ ครบ/เฝ้าระวัง ≤10%/วิกฤต >10%) + ประเภทสัญญา
  5. Timeline ความเคลื่อนไหว + ปุ่มดูทั้งหมด
- **Approved Plan** มาจากตาราง `position_quota` (โหลดเข้า state กลาง `allPosQuota`)
- **กฎวันที่รวมไว้ที่ `js/app.js` จุดเดียว** — `sepYM` / `isActiveAtMonthEnd` / `hcAtMonthEnd` / `lastDayOfMonth`
  ทุกรายงาน import ไปใช้ (เดิมก๊อป 4 ไฟล์ = ต้นเหตุ regression 8 ครั้ง)
  **termination 1/8 → ทำงานถึง 31 ก.ค. → พ้นสภาพนับ ก.ค. และหลุดจาก headcount ก.ค.** (ยืนยัน 2026-08-03)
- เทสต์ `test/headcount-date.test.js` (46) + `test/dashboard.test.js` (33) — ดึงฟังก์ชันจริงจาก app.js มารัน
- `index.html` ใส่ `css/style.css?v=N` กัน browser cache CSS เก่า (แก้ CSS แล้วหน้าไม่เปลี่ยน = บวกเลขนี้)

### เอกสารแนบ + กันบันทึกซ้ำ + ค้นหา (2026-08-18, commit `a9e1427`) ✅
- **แนบเอกสารใน Staff Movement** — เก็บใน Supabase Storage bucket `movement-docs` แบบ private,
  เปิดดูผ่าน signed URL อายุ 60 วินาที · อัปโหลด/ลบเฉพาะ HR+Admin · ไฟล์ไม่เกิน 10 MB
  · ตารางแสดง 📎 กดเปิดได้ · แก้ไขรายการเดิมเปลี่ยน/ถอดไฟล์ได้
  · ต้องรัน `sql/schema_movement_attachment.sql` (รันแล้ว 2026-08-18)
- **กันบันทึกการพ้นสภาพซ้ำ** — คนที่มี Resignation/Termination/Retirement อยู่แล้ว บันทึกซ้ำไม่ได้
  แจ้งชื่อ + วันที่มีผล + คนบันทึกของรายการเดิม (แก้รายการเดิมยังทำได้ปกติ)
- **ค้นหาพนักงาน** — ครอบคลุมทุกฟิลด์ในตาราง + พิมพ์หลายคำได้ (ต้องเจอครบทุกคำ) + ปุ่ม × ล้างคำค้น
- **กัน Status เพี้ยน** — import รับเฉพาะ Active/Resigned/Terminated/Retired/Transferred
  ค่าอื่นจะไม่เขียนทับและเด้ง toast บอกจำนวนที่ข้าม (ต้นเหตุที่เคยมีชื่อจังหวัดโผล่ในช่องสถานะ)

### แก้ Position Quota บันทึกไม่เข้า (2026-08-11, commit `e9bc0c7`) ✅
- **ต้นเหตุ:** ตาราง `position_quota` สร้างมือใน Supabase โดย**ไม่มีคอลัมน์ `fiscal_year`** แต่ `js/vacancy.js`
  ส่ง `fiscal_year` ไปทุกครั้ง → Postgres ปฏิเสธ insert ทั้งหมด → ตารางว่าง 0 แถวมาตลอด
  (และทำให้ Dashboard ขึ้นว่า "ยังไม่ได้ตั้งแผนอัตรากำลัง")
- **ที่ทำให้หายาก:** `loadPosQuota()` กลืน error เงียบ ๆ ไม่แจ้งอะไรเลย — แก้แล้วให้เด้ง toast + log
- **แก้:** `sql/schema_position_quota.sql` เติมคอลัมน์ที่โค้ดใช้ + unique index + RLS (อ่าน=authenticated,
  เขียน=hr/admin ให้ตรงกับที่ UI จำกัดไว้ เดิมเป็น `Allow all for authenticated` ซึ่งหลวมเกิน)
- รันใน Supabase แล้ว ทดสอบเพิ่ม quota ผ่านหน้าเว็บได้จริง (ยืนยัน 2026-08-11)

### สิทธิ์ระดับฐานข้อมูล — รันใน Supabase แล้ว ✅ (ยืนยัน 2026-08-11)
- `movements_update` / `movements_delete` = `created_by = auth.uid() OR get_my_role() = 'admin'`
- `roles_update` / `roles_delete` = `get_my_role() = 'admin'` (HR/user แก้สิทธิ์ admin ไม่ได้แล้ว)

### Staff Movement + Admin controls (2026-07-31, commit `5375873`)
- **Import Excel ปรับตำแหน่งหลายคน (bulk)** หน้า Staff Movement (HR/Admin) — สร้าง movement + อัปเดตพนักงาน (ตำแหน่ง/แผนก/**job_level** จากคอลัมน์ "ระดับใหม่") · รองรับ date serial ของ Excel · helper ร่วม `empUpdateFromMovement`
- **ปุ่มลบทุกแถว** ใน Staff Movement (admin ลบ/แก้ได้ทุกรายการ)
- **User Management เฉพาะ Admin** (guard) + RLS กัน HR/user แก้ role
- **ไม่เด้งกลับ Dashboard** เมื่อ token refresh/สลับแท็บ (boot ครั้งเดียวต่อ session — `appBooted`)
- **Export พนักงานเพิ่มคอลัมน์ Province** (เดิมหาย ทำ column เลื่อนไปปนกับ Status)

### กระดิ่งแจ้งเตือน (Notification Bell)
- กระดิ่งมุมขวาบน sidebar + badge นับที่ยังไม่อ่าน + dropdown panel
- **เก็บใน Supabase (ตาราง `notifications`) + realtime — shared ทุก user** (เดิม localStorage แยกเครื่อง user อื่นไม่เห็น) commit `29187af`
- เด้งเฉพาะ "เพิ่มใหม่": Movement, พนักงาน, Import, Position Quota, Master data
- **Proactive alerts** — สัญญาใกล้หมด / พ้นโปร / ใกล้เกษียณ (กันแจ้งซ้ำแบบ global ด้วย `dedup_key`)
- ปุ่ม "อ่านแล้วทั้งหมด" (สถานะอ่านเป็นราย browser, ไม่ลบ log ของคนอื่น)

### คำนวณค่ากะ (Shift Allowance) — หน้าใหม่ HR/Admin
- อัปโหลด Excel (sheet Clean_Data) → คำนวณตาม `shift_allowance_calculation_spec.md` (Pass1 นับตระกูลกะ→เรต, Pass2 pro-rate รายวัน)
- **กรองระดับ O** (O1/O2/O3) อัตโนมัติ จาก job_level ใน DB — match Employee_ID↔emp_code
- **ยกเว้นรายคน (grandfather)** — checkbox "ได้รับค่ากะ (กำหนดเอง)" ในฟอร์มพนักงาน (คอลัมน์ `shift_allowance_override`) สำหรับ S/M ที่ HR ให้ต่อ → badge "พิเศษ" commit `511c646`
- **เก็บประวัติรายเดือน** ตาราง `shift_allowance` (upsert emp_code+month) + แท็บดูย้อนหลัง
- แจ้งเตือน: ไม่พบใน DB / ไม่ใช่ระดับ O / วัน CHECK_NOTE

### แก้บั๊ก
- realtime subscribe ซ้ำ (`cannot add postgres_changes...`) — guard ด้วย `realtimeChannel`
- SQL scripts idempotent (รันซ้ำไม่ error) commit `db873c4`

## ⚠️ ต้องทำใน Supabase (ถ้ายังไม่ได้ทำในโปรเจกต์จริง)
รันใน SQL Editor (ทีละไฟล์, idempotent):
1. ✅ `sql/schema_notifications.sql` — ตารางกระดิ่ง shared
2. ✅ `sql/schema_shift_allowance.sql` — ตารางประวัติค่ากะ + คอลัมน์ `shift_allowance_override` ในตาราง employees
3. ✅ `sql/schema_admin_permissions.sql` — รันแล้ว ยืนยันด้วย pg_policies เมื่อ 2026-08-11
4. ✅ `sql/schema_position_quota.sql` — เติมคอลัมน์ fiscal_year ฯลฯ + RLS hr/admin (รันแล้ว 2026-08-11)
5. ✅ `sql/schema_movement_attachment.sql` — คอลัมน์ไฟล์แนบ + storage bucket + สิทธิ์ (รันแล้ว 2026-08-18)
6. ⏸️ `sql/fix_employee_status.sql` — ซ่อม status ที่เป็นชื่อจังหวัด (พักไว้ก่อน ดูหัวข้อด้านบน)
7. ✅ `sql/schema_shift_codes.sql` — ย้ายรหัสกะมาเก็บใน DB เพิ่มกะใหม่ได้จากหน้าเว็บ (รันแล้ว 2026-08-18 · ยืนยัน 14 รหัส: DAY 6, AFT 3, NIT 5)

## 🗺️ Roadmap (ยังไม่เริ่ม เรียงตามความสำคัญ)
1. **RLS + ข้อมูลเงินเดือน** — ตอนนี้ user ที่ล็อกอินอ่าน `salary` ผ่าน API ได้ แม้หน้า Payroll ซ่อนไว้ → แยกตาราง/จำกัด RLS (สำคัญสุด)
2. **pending_roles + จำกัดการสมัคร** — กัน user ลบของคนอื่น, จำกัดโดเมนอีเมล/เชิญโดย admin
3. **Audit log ถาวรใน DB** — ตาราง activity log (ใครแก้/เพิ่ม/ลบ + ค่าเดิม/ใหม่)
4. **Validation + DB constraints** — ลำดับวันที่, เงินเดือนห้ามติดลบ, status/type ในลิสต์
5. **Movement + Employee update เป็น transaction เดียว** (ย้ายไป Supabase RPC)
6. **Automated tests ขั้นต่ำ** — business logic (headcount, effective date, alerts) + RLS
7. **ต่อยอด** — Employee profile + timeline, Global search, Analytics (turnover rate, headcount trend)

## 📝 เรื่องค้าง/ยังไม่ทดสอบเต็ม
- คำนวณค่ากะ: หน้าเว็บเทียบกับคอลัมน์ `Shift_Allowance` (เฉลยมือ) ในไฟล์ให้อัตโนมัติแล้ว — เหลือให้ผู้ใช้อัปโหลด Test_Report จริงแล้วดูว่ามีรายการไม่ตรงไหม
- §7.3 ลาเศษวัน = คิดเต็มวัน (ตาม pseudocode ที่ผู้ใช้เลือก 2026-07-20)

## หมายเหตุ (ต่อเครื่องอื่น)
- ประวัติแชต Claude Code เก็บ local ที่ `~/.claude/projects/` ไม่ sync ข้ามเครื่อง — เปิดอีกเครื่อง `git pull` แล้วอ่านไฟล์นี้ต่อได้
- Git identity ของ repo ตั้ง local เป็น Kopbun Tungkasen <kopbun@akararesources.com>
- Local test server: `python3 -m http.server 8000 --directory "<repo>"` แล้วเปิด http://localhost:8000 (login ต้องผ่าน http ไม่ใช่ file://)
- ⚠️ GitHub token ที่เคย push เคยโพสต์ในแชต — ถ้ายังไม่ regenerate ควรทำที่ https://github.com/settings/tokens
