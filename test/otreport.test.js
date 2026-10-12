// เทสรายงานโอที & เบี้ยขยัน — ดึงฟังก์ชันจริงจาก js/otreport-calc.js · ข้อมูลสมมติล้วน
// รัน:  osascript -l JavaScript test/otreport.test.js
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;
const src = read(`${ROOT}/js/otreport-calc.js`).replace(/^import[^;]*;/gm, "").replace(/^export /gm, "");
const M = new Function(`${src}; return { reportGroup, buildReport, reasonsEn, hm };`)();
let P = 0, F = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) === JSON.stringify(b)) P++; else { F++; console.log("FAIL " + m + "\n  got =" + JSON.stringify(a) + "\n  want=" + JSON.stringify(b)); } };

// กลุ่มรายงานตามโฟลเดอร์ของ HR
const G = (department, section, team = "") => M.reportGroup({ department, section, team });
eq(G("Processing", "Process", "Process"), "Process", "Processing / Process");
eq(G("Processing", "Metallurgy", "Metallurgy"), "Metallurgy", "Processing / Metallurgy");
eq(G("Processing", "Maintenance", "Electrical"), "Maintenance-Electrical", "Maintenance แยกตาม Team");
eq(G("Mining", "Mining Operation"), "Mining-Mine Operation", "Mining ชื่อตามรายงานเดิม");
eq(G("Mining", "Mine Planning"), "Mining-Mining Planning", "Mining Planning");
eq(G("Mining", "Geology"), "Mining-Geology", "Mining Geology");
eq(G("Community Relations & Development", "Sustainable Development"), "CRD", "ย่อ CRD");
eq(G("Finance & Accounting", "Finance & Accounting"), "Finance-Accounting", "Finance-Accounting");
eq(G("Laboratory", "Laboratory"), "Laboratory", "แผนกอื่นใช้ชื่อแผนก");

// ป้ายเหตุผลเบี้ยขยัน
eq(M.reasonsEn(["มาสาย 2 วัน (1/8, 4/8)", "ลาป่วย 1 วัน (9/8)", "มาสาย 1 วัน"]), "Late, Sick leave", "แปลเหตุผล ไม่ซ้ำ");
eq(M.reasonsEn(["HR ตัดสิทธิ์: พักงาน (ข้อ 4.9)", "แก้เวลา 3 ครั้ง (เกิน 2)"]), "HR denied, Time edits > 2", "HR + แก้เวลา");

// รวมรายงาน
const emp = (code, lv, o = {}) => ({ emp_code: code, job_level: lv, firstname_en: "Test", lastname_en: code, division: "Operations", department: "Processing", section: "Process", team: "Process", join_date: "2020-01-01", end_date: null, ...o });
const days = (code, ots) => ({ code, name: code, days: ots.map((ot, i) => ({ date: `2026-08-${String(i + 1).padStart(2, "0")}`, ot })) });
const procMap = new Map([["AKR00000001", days("AKR00000001", [{ "1.5": 60 }, { "1": 510, "3": 120 }])], ["AKR00000002", days("AKR00000002", [{}])],
  ["AKR00000009", days("AKR00000009", [{ "1.5": 30 }])]]);
const employees = [emp("AKR00000001", "O2"), emp("AKR00000002", "O1", { join_date: "2026-08-14" }), emp("AKR00000003", "O3", { end_date: "2026-08-01" }),
  emp("AKR00000004", "S1"), emp("AKR00000005", "M1")];
const dil = new Map([["AKR00000001", { qualified: true, streak: 1, amount: 300, reasons: [] }], ["AKR00000004", { qualified: false, streak: 0, amount: 0, reasons: ["มาสาย 1 วัน"] }]]);
const r = M.buildReport({ procMap, employees, dil, ym: "2026-08" });
const o = r.groupsO[0].rows;
eq(o.map(x => x.code), ["AKR00000001", "AKR00000002"], "ระดับ O ที่เป็นพนักงานในเดือน (ออก 1 ส.ค. = ไม่นับ) · มีหรือไม่มีโอทีก็ขึ้น");
eq([o[0].ot1, o[0].ot15, o[0].ot3, o[0].total], [510, 60, 120, 690], "รวมโอทีรายวันตามอัตรา");
eq(o[1].status, ["Joined 14/08"], "เข้ากลางเดือน = ต้องดู");
eq([o[0].dil.amount, o[1].dil.why], [300, "Not eligible"], "เบี้ยขยัน: ได้ / ไม่อยู่ในขอบเขต");
eq([r.groupsS[0].rows.length, r.groupsS[0].rows[0].dil.why], [1, "Late"], "ระดับ S แยก มีแต่เบี้ยขยัน");
eq([r.totalsO.employees, r.totalsO.withOT, r.totalsO.dil], [2, 1, 300], "ยอดรวมระดับ O");
eq(r.notInMaster, ["AKR00000009"], "รหัสในไฟล์ที่ไม่มีในทะเบียน");
eq(M.buildReport({ procMap, employees, dil: null, ym: "2026-08" }).groupsO[0].rows[0].dil, null, "ยังไม่บันทึกเบี้ยขยัน = ว่าง");
eq(M.hm(1135 * 60 + 30), "1135:30", "รูปแบบชั่วโมง");

console.log(F === 0 ? `ผ่านทั้งหมด ${P} เคส` : `ผ่าน ${P} · ตก ${F}`);
