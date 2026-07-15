# TODO / สถานะงาน

อัปเดตล่าสุด: 2026-07-15

## ✅ เสร็จแล้ว — กระดิ่งแจ้งเตือน (Notification Bell)
Push ขึ้น main แล้ว (commit `dc97ba6`), Vercel deploy อัตโนมัติ

- กระดิ่งอยู่มุมขวาบนของ sidebar (ข้างโลโก้) มี badge นับที่ยังไม่อ่าน + dropdown panel
- เก็บ log ล่าสุด 60 รายการใน `localStorage` (key: `hr_notifications`)
- **เด้งเฉพาะการ "เพิ่มใหม่"** เท่านั้น (การแก้ไขยังเป็น toast ธรรมดา)
- จุดที่ hook ไว้: เพิ่ม Movement, เพิ่มพนักงาน, Import พนักงาน, เพิ่ม/Import Position Quota, เพิ่ม Master data
- แกนหลัก: `notify(title, detail, opts)` ใน `js/app.js` (export ให้โมดูลอื่นเรียก)
- ไฟล์ที่แก้: `js/app.js`, `index.html`, `css/style.css`, `js/employees.js`, `js/vacancy.js`, `js/masterdata-admin.js`

## ✅ เสร็จแล้ว — Alert เชิงรุก (ต่อยอดจากกระดิ่ง)
เขียนโค้ดแล้ว **ยังไม่ได้ push** — sandbox นี้ไม่มี Node/Python ให้รันแอปทดสอบจริง ต้องเปิดแอปจริงเช็คก่อน commit

- เพิ่ม `checkProactiveAlerts()` ใน `js/app.js` เรียกท้าย `loadEmployees()` ทุกครั้งที่โหลด/รีเฟรชข้อมูลพนักงาน
- ตรวจพนักงาน status Active ทุกคน หา 3 เหตุการณ์:
  - **สัญญาใกล้หมดอายุ** — `end_date` + `contract_type !== "Permanent"`, แจ้ง 2 ระดับ ≤60 วัน และ ≤30 วัน (`CONTRACT_ALERT_DAYS`)
  - **ใกล้พ้นทดลองงาน** — `contract_type === "Probation"`, วันครบ = `join_date + 119 วัน` (`PROBATION_DAYS`), แจ้งล่วงหน้า ≤14 วัน
  - **ใกล้เกษียณ** — `dob + 60 ปี` (`RETIRE_AGE`), แจ้งล่วงหน้า ≤90 วัน (`RETIRE_ALERT_DAYS`)
- กันแจ้งซ้ำด้วย `localStorage` key `hr_alert_seen` (เก็บ key ต่อคน/ต่อเกณฑ์ เช่น `contract30-E001`) — แจ้งครั้งเดียวตลอดไป ไม่ใช่ทุกครั้งที่เปิดแอป
- category ใหม่ `alert` สีแดง (`--red`/`--red-light`) แยกจาก log การเพิ่มปกติ — ใช้ panel/badge เดิมของกระดิ่ง
- ค่าคงที่ทั้งหมด (จำนวนวัน) อยู่บนสุดของบล็อกใน `js/app.js` (คอมเมนต์ `PROACTIVE ALERTS`) ปรับตามนโยบายบริษัทได้ภายหลัง — ยืนยันกับผู้ใช้แล้วเมื่อ 2026-07-15
- **ยังไม่ทดสอบกับข้อมูลจริง** — ต้องเปิดแอป, เช็คว่าไม่มี error ใน console, ลองพนักงานตัวอย่างที่ end_date/dob/join_date อยู่ในช่วงแจ้งเตือน แล้วดูว่ากระดิ่งขึ้น badge + toast ถูกต้อง ก่อน commit/push

## 💡 ไอเดียอื่นที่คุยไว้ (ทำทีหลัง)
2. ยกเครื่องหน้า Analytics — เพิ่ม turnover rate %, headcount trend 12 เดือน, สัดส่วนเพศ/อายุงาน/ไซต์ (`js/app.js:500` renderAnalytics ปัจจุบันบางมาก)
3. Audit log ถาวรใน DB — ตาราง `activity_log` (กระดิ่งตอนนี้เก็บแค่ localStorage หายเมื่อล้าง cache)
4. หน้าโปรไฟล์พนักงาน + timeline ประวัติการเคลื่อนไหวรายคน
5. Global search — ช่องค้นหาพนักงานจากทุกหน้า

## หมายเหตุ (ต่อเครื่องอื่น)
- ประวัติแชต Claude Code เก็บ local ที่ `~/.claude/projects/` ไม่ sync ข้ามเครื่อง — เปิดอีกเครื่องให้ `git pull` แล้วอ่านไฟล์นี้ต่อได้เลย
- Git identity ของ repo นี้ตั้ง local เป็น Kopbun Tungkasen <kopbun@akararesources.com> แล้ว
- ⚠️ GitHub token ที่ใช้ push รอบนี้เคยโพสต์ในแชต — ถ้ายังไม่ได้ regenerate ควรทำที่ https://github.com/settings/tokens
