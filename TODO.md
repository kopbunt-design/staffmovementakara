# TODO / สถานะงาน

อัปเดตล่าสุด: 2026-07-20

## ✅ เสร็จ + push ขึ้น production แล้ว

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
1. `sql/schema_notifications.sql` — ตารางกระดิ่ง shared
2. `sql/schema_shift_allowance.sql` — ตารางประวัติค่ากะ + คอลัมน์ `shift_allowance_override` ในตาราง employees

## 🗺️ Roadmap (ยังไม่เริ่ม เรียงตามความสำคัญ)
1. **RLS + ข้อมูลเงินเดือน** — ตอนนี้ user ที่ล็อกอินอ่าน `salary` ผ่าน API ได้ แม้หน้า Payroll ซ่อนไว้ → แยกตาราง/จำกัด RLS (สำคัญสุด)
2. **pending_roles + จำกัดการสมัคร** — กัน user ลบของคนอื่น, จำกัดโดเมนอีเมล/เชิญโดย admin
3. **Audit log ถาวรใน DB** — ตาราง activity log (ใครแก้/เพิ่ม/ลบ + ค่าเดิม/ใหม่)
4. **Validation + DB constraints** — ลำดับวันที่, เงินเดือนห้ามติดลบ, status/type ในลิสต์
5. **Movement + Employee update เป็น transaction เดียว** (ย้ายไป Supabase RPC)
6. **Automated tests ขั้นต่ำ** — business logic (headcount, effective date, alerts) + RLS
7. **ต่อยอด** — Employee profile + timeline, Global search, Analytics (turnover rate, headcount trend)

## 📝 เรื่องค้าง/ยังไม่ทดสอบเต็ม
- คำนวณค่ากะ: ควรเทียบยอดจริงกับคอลัมน์ `Shift_Allowance` (เฉลยมือ) ในไฟล์ Test_Report ให้ครบ
- §7.3 ลาเศษวัน = คิดเต็มวัน (ตาม pseudocode ที่ผู้ใช้เลือก 2026-07-20)

## หมายเหตุ (ต่อเครื่องอื่น)
- ประวัติแชต Claude Code เก็บ local ที่ `~/.claude/projects/` ไม่ sync ข้ามเครื่อง — เปิดอีกเครื่อง `git pull` แล้วอ่านไฟล์นี้ต่อได้
- Git identity ของ repo ตั้ง local เป็น Kopbun Tungkasen <kopbun@akararesources.com>
- Local test server: `python3 -m http.server 8000 --directory "<repo>"` แล้วเปิด http://localhost:8000 (login ต้องผ่าน http ไม่ใช่ file://)
- ⚠️ GitHub token ที่เคย push เคยโพสต์ในแชต — ถ้ายังไม่ regenerate ควรทำที่ https://github.com/settings/tokens
