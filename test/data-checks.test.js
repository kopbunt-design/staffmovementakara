// เทสตรวจข้อมูล "เอ๊ะใจ" — ดึงฟังก์ชันจริงจาก js/data-checks.js + กฎวันที่กลางจาก js/app.js · ข้อมูลสมมติล้วน
// รัน:  osascript -l JavaScript test/data-checks.test.js
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;
const APP = read(`${ROOT}/js/app.js`);
const grab = name => { const m = APP.match(new RegExp(`export const ${name} = ([\\s\\S]*?\\n};|[^\\n]*;)`)); return m[1]; };
const M = new Function(`${read(`${ROOT}/js/data-checks.js`).replace(/^export /gm, "")}
  const lastDayOfMonth = ${grab("lastDayOfMonth")}
  const sepYM = ${grab("sepYM")}
  return { runChecks, checksPanelHTML, lastDayOfMonth, sepYM };`)();
let P = 0, F = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) === JSON.stringify(b)) P++; else { F++; console.log("FAIL " + m + "\n  got =" + JSON.stringify(a) + "\n  want=" + JSON.stringify(b)); } };
const movYM = m => String(m.date || m.created_at || "").slice(0, 7);
const H = { sepYM: M.sepYM, movYM, lastDayOfMonth: M.lastDayOfMonth };
const keys = r => r.map(x => x.key + ":" + x.items.map(i => i.emp_code).join(","));
const base = { status: "Active", join_date: "2024-01-01", division: "Mining", department: "Mining Ops", position: "Operator", job_level: "O1" };

// โอนย้ายแล้วทะเบียนไม่เปลี่ยน · ลาออกล่วงหน้าแต่ขึ้นออกก่อน · ถึงวันแล้วยังไม่ยืนยัน · วันไม่ตรงกัน
const emps = [
  { ...base, emp_code: "A1", firstname_th: "โอน", lastname_th: "ไม่แก้", department: "Exploration", division: "Exploration" },
  { ...base, emp_code: "A2", firstname_th: "ออก", lastname_th: "ก่อนวัน", status: "Resigned", end_date: "2026-11-01" },
  { ...base, emp_code: "A3", firstname_th: "รอ", lastname_th: "ยืนยัน", end_date: "2026-10-01" },
  { ...base, emp_code: "A4", firstname_th: "วัน", lastname_th: "ไม่ตรง", status: "Resigned", end_date: "2026-09-01" },
  { ...base, emp_code: "A5", firstname_th: "ปกติ", lastname_th: "ดี" },
  { ...base, emp_code: "A6", firstname_th: "ไม่มี", lastname_th: "วันออก", status: "Resigned" },
];
const movs = [
  { id: 1, emp_code: "A1", type: "Transfer", date: "2026-08-01", to_dept: "Mining Ops / Operator", created_at: "2026-07-20T00:00:00Z" },
  { id: 2, emp_code: "A3", type: "Resignation", date: "2026-10-01", sep_confirmed_at: null, created_at: "2026-09-01T00:00:00Z" },
  { id: 3, emp_code: "A4", type: "Resignation", date: "2026-10-15", sep_confirmed_at: "2026-10-15", created_at: "2026-09-01T00:00:00Z" },
  { id: 4, emp_code: "A5", type: "Transfer", date: "2026-07-01", org_to: { division: "Mining", department: "Mining Ops", position: "Operator" }, sep_confirmed_at: null, created_at: "2026-06-20T00:00:00Z" },
  { id: 5, emp_code: "ZZ", type: "Transfer", date: "2026-07-01", created_at: "2026-11-02T00:00:00Z" },
];
const r = M.runChecks({ employees: emps, movements: movs, masters: { departments: [{ name: "Mining Ops", master_divisions: { name: "Mining" } }] }, today: "2026-10-16" }, H);
const k = keys(r);
eq(k.includes("sep_due:A3"), true, "ถึงวันพ้นสภาพแล้วยังไม่กดยืนยัน");
eq(k.includes("left_future:A2"), true, "ขึ้นลาออกก่อนวันที่มีผล");
eq(k.includes("left_no_end:A6"), true, "สถานะลาออกแต่ไม่มีวันพ้นสภาพ");
eq(k.includes("sep_mismatch:A4"), true, "วันลาออกในรายการกับทะเบียนคนละเดือน");
eq(k.includes("move_not_applied:A1"), true, "โอนย้ายแล้วทะเบียนไม่เปลี่ยน (รายการเก่า to_dept)");
eq(r.find(x => x.key === "move_not_applied").items.length, 1, "คนที่ทะเบียนตรงกับ org_to ไม่ถูกจับ");
eq(k.includes("mov_no_emp:ZZ"), true, "รายการที่ไม่พบรหัสพนักงาน");
eq(k.some(x => x.startsWith("active_past_end")), false, "Active + วันออกผ่านแล้ว แต่มีรายการรอยืนยัน → อยู่ใน sep_due ไม่ซ้ำ");
eq(r[0].level, "error", "เรียงต้องแก้ขึ้นก่อน");
// เฉพาะเดือน: บันทึกหลังสิ้นเดือน
const r2 = M.runChecks({ employees: emps, movements: movs, today: "2026-11-05", ym: "2026-07" }, H);
eq(keys(r2).find(x => x.startsWith("late_entry")), "late_entry:ZZ", "รายการเดือน ก.ค. ที่บันทึกหลังสิ้นเดือน");
// ไม่มีปัญหา → แผงสีเขียว
eq(M.checksPanelHTML([]).includes("ไม่พบจุดที่ขัดกัน"), true, "ไม่มีปัญหา = ข้อความผ่าน");
eq(M.checksPanelHTML(r).includes("ต้องแก้"), true, "มีปัญหา = แสดงสรุป");
console.log(F === 0 ? `ผ่านทั้งหมด ${P} เคส` : `ผ่าน ${P} · ตก ${F}`);
