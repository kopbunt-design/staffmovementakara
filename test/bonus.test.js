// เทสโบนัส 2569 — ดึงฟังก์ชันจริงจาก js/bonus-calc.js (+ diligence-calc.js ที่มันใช้) · ตัวอย่างจากเอกสารแนบท้ายประกาศ HR-152-2026
// รัน:  osascript -l JavaScript test/bonus.test.js
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;
const strip = s => s.replace(/^import .*$/gm, "").replace(/^export \{[^}]*\};?$/gm, "").replace(/^export /gm, "");
const src = `const { parseProcessed, leaveKinds, durMin, serialToISO } = (() => { ${strip(read(`${ROOT}/js/diligence-calc.js`))}; return { parseProcessed, leaveKinds, durMin, serialToISO }; })();\n` + strip(read(`${ROOT}/js/bonus-calc.js`));
const M = new Function(`${src}; return { PARAMS_2026, round2, suggestClass, durDays, dayEvent, eligibility, workedDays, deductions, money, compute, explain, readTime };`)();
let P = 0, F = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) === JSON.stringify(b)) P++; else { F++; console.log("FAIL " + m + "\n  got =" + JSON.stringify(a) + "\n  want=" + JSON.stringify(b)); } };
const ev = (kind, d0, n, days = 1) => Array.from({ length: n }, (_, i) => { const t = new Date(Date.parse(d0 + "T00:00:00Z") + i * 864e5).toISOString().slice(0, 10); return { d: t, kind, days }; });
const pay = (salary, eligible, worked = 365) => { const m = M.money(salary, eligible, worked); return [m.bonus, m.special, M.round2(m.bonus + m.special), m.cut]; };

// ---- ข้อ 6 ตัวอย่างในเอกสารแนบ (เงินเดือน 15,000)
eq(pay(15000, 365), [38700, 12000, 50700, 0], "ตัวอย่าง 1 ครบปี ไม่ปรับลด");
eq(M.workedDays("2026-03-01"), 306, "ตัวอย่าง 2 เริ่ม 1 มี.ค. = 306 วัน");
eq(pay(15000, 306, 306).slice(0, 3), [32444.38, 10060.27, 42504.65], "ตัวอย่าง 2 เงิน");
eq(pay(15000, 306, 306)[3], 0, "เริ่มกลางปีไม่ถือเป็นยอดปรับลด");
eq(M.workedDays("2026-07-01"), 184, "ตัวอย่าง 3 เริ่ม 1 ก.ค. = 184 วัน");
eq(pay(15000, 184, 184).slice(0, 3), [19509.04, 6049.32, 25558.36], "ตัวอย่าง 3 เงิน");
eq(M.workedDays("2025-05-01"), 365, "เริ่มก่อนปี = 365");

const D = (events, adj = [], level = "O1") => M.deductions({ events, adj, level });
const e4 = D(ev("พักงาน", "2026-05-04", 7));
eq(e4.total, 7, "ตัวอย่าง 4 พักงาน 7 วัน = หัก 7");
eq(pay(15000, 358), [37957.81, 11769.86, 49727.67, 972.33], "ตัวอย่าง 4 เงิน + ยอดปรับลด");
const e5 = D([...ev("ลาป่วย", "2026-02-02", 14), ...ev("ลากิจ", "2026-06-01", 2)]);
eq(e5.total, 4, "ตัวอย่าง 5 ลาป่วย 14 + ลากิจ 2 = หัก 4");
eq(pay(15000, 361), [38275.89, 11868.49, 50144.38, 555.62], "ตัวอย่าง 5 เงิน");
const e6 = D(ev("ลาคลอด", "2026-03-01", 120));
eq(e6.total, 30, "ตัวอย่าง 6 ลาคลอด 120 วัน = หัก 30");
eq(pay(15000, 335), [35519.18, 11013.70, 46532.88, 4167.12], "ตัวอย่าง 6 เงิน");
const e7 = D(ev("ลาเพื่อช่วยเหลือคู่สมรสในการคลอดบุตร", "2026-04-01", 15));
eq(e7.total, 7.5, "ตัวอย่าง 7 ลาช่วยภริยาคลอด 15 วัน = หัก 7.5");
eq(pay(15000, 357.5).slice(0, 3), [37904.79, 11753.42, 49658.21], "ตัวอย่าง 7 เงิน");
const e8 = D([...ev("ลาพักร้อน", "2026-01-05", 10), ...ev("ลาหยุดชดเชย", "2026-02-05", 3), ...ev("ลาฌาปนกิจ", "2026-03-05", 3), ...ev("ลาป่วย", "2026-04-05", 3)]);
eq(e8.total, 0, "ตัวอย่าง 8 พักร้อน/ชดเชย/งานศพ/ป่วย 3 วัน = ไม่หัก");
eq(M.round2(972.33 + 555.62 + 4167.12 + 1041.79), 6736.86, "ตัวอย่าง 9 ยอดปรับลด 4–7");

// ---- เงินจัดสรรพิเศษ: หารเท่ากันทุกคนที่มีสิทธิ ยกเว้น M
const emps = [
  { emp_code: "A", join_date: "2020-01-01", job_level: "O1", salary: 15000 },
  { emp_code: "B", join_date: "2020-01-01", job_level: "O1", salary: 15000 },
  { emp_code: "C", join_date: "2020-01-01", job_level: "M1", salary: 50000 },
  { emp_code: "D", join_date: "2026-10-01", job_level: "O1", salary: 15000 },
];
const r = M.compute({ emps, events: [...ev("ลากิจ", "2026-06-01", 2).map(x => ({ ...x, emp_code: "B" })), ...ev("ขาดงาน", "2026-06-01", 5).map(x => ({ ...x, emp_code: "C" }))] });
const by = Object.fromEntries(r.rows.map(x => [x.code, x]));
eq([by.A.ok, by.B.ok, by.C.ok, by.D.ok], [true, true, true, false], "เริ่มงานหลัง 31 ส.ค. ไม่มีสิทธิ์");
eq(by.C.ded.total, 0, "ระดับ M ไม่ถูกปรับลด");
eq(by.C.alloc, 0, "ระดับ M ไม่ได้เงินจัดสรร");
eq(r.nShare, 2, "ผู้ได้ส่วนแบ่ง = มีสิทธิ์และไม่ใช่ M");
eq(r.pool, by.B.m.cut, "กองเงินจัดสรร = ยอดปรับลดรวม");
eq([by.A.alloc, by.B.alloc], [M.round2(r.pool / 2), M.round2(r.pool / 2)], "คนถูกปรับลดก็ได้ส่วนแบ่งเท่ากัน");

// ---- สิทธิ์ (ข้อ 2)
eq(M.eligibility({ join_date: "2026-08-31" }).length, 1, "เริ่ม 31 ส.ค. วันที่ 119 เลยวันจ่าย → ยังไม่พ้นทดลองงาน");
eq(M.eligibility({ join_date: "2026-08-29" }), [], "เริ่ม 29 ส.ค. พ้นทดลองงาน 25 ธ.ค. พอดี");
eq(M.eligibility({ join_date: "2020-01-01", end_date: "2026-12-01" }).length, 1, "ออกก่อนวันจ่าย");
eq(M.eligibility({ join_date: "2020-01-01", end_date: "2027-01-15" }, [{ type: "Resignation", date: "2027-01-15" }])[0].slice(0, 13), "ยื่นลาออกแล้ว", "ยื่นลาออกแล้ว แม้ยังทำงานอยู่");
eq(M.eligibility({ join_date: "1990-01-01", end_date: "2027-01-01" }, [{ type: "Retirement", date: "2027-01-01" }]), [], "เกษียณ 1 ม.ค. 2570 ได้สิทธิ์");

// ---- รายละเอียดการปรับลด
eq(D(ev("ลาป่วย", "2026-01-05", 6).concat(ev("ลาป่วยไม่จ่ายเงินหักเงิน", "2026-02-05", 8))).total, 2, "ลาป่วยไม่จ่ายเงินใช้สิทธิ 10 วันร่วมกับลาป่วย");
eq(D(ev("ขาดงาน", "2026-12-02", 3)).total, 0, "ธันวาคมไม่นับ (เก็บสถิติถึง 30 พ.ย.)");
eq(D(ev("ลากิจ", "2026-03-02", 4), [{ d_from: "2026-03-02", d_to: "2026-03-05", kind: "ลาป่วย", days: 4 }]).total, 0, "HR แก้เป็นลาป่วย แทนที่ข้อมูล TigerSoft");
eq(D([], [{ d_from: "2026-11-25", d_to: "2026-12-10", kind: "พักงาน", days: 16 }]).total, 16, "พักงานเริ่มใน พ.ย. ต่อเนื่อง นับทั้งหมด (2.4)");
eq(D([], [{ d_from: "2026-11-21", d_to: "2026-12-10", kind: "ลากิจ", days: 20 }]).total, 10, "ลาอื่นข้ามเดือน ธ.ค. นับเฉพาะส่วนใน พ.ย.");
eq(D(ev("ขาดงาน", "2026-03-02", 2), [], "M2").total, 0, "M ไม่หัก");
eq(M.deductions({ events: ev("ขาดงาน", "2026-03-02", 2), offMonths: new Set(["2026-03"]) }).total, 0, "เดือนที่ปิดการนับขาดงาน");
eq(M.deductions({ events: ev("ลากิจ", "2026-03-02", 2), join: "2026-03-03" }).total, 1, "ก่อนวันเริ่มงานไม่นับ");
eq(D(ev("ลาคลอด", "2026-01-05", 70).concat(ev("ลาคลอด", "2026-10-01", 50))).total, 5, "ลาคลอด 2 ครั้ง สิทธิ 60 วันต่อครั้ง");
eq(D(ev("ลาบวช", "2026-05-01", 15)).total, 15, "ลาบวช หักเต็ม");
eq(D(ev("ลาเนื่องจากอุบัติเหตุจากการทำงาน", "2026-05-01", 5)).total, 0, "เจ็บจากงาน ไม่หัก");
eq(D(ev("ลาสิ่งที่ไม่รู้จัก", "2026-05-01", 2)).total, 2, "ประเภทอื่นที่ไม่ระบุ = หักเต็ม");

// ---- อ่านค่าเวลาจาก TigerSoft
eq([M.durDays("1-00:00"), M.durDays("0-04:15"), M.durDays("0-04:00"), M.durDays("2-00:00"), M.durDays("0-02:00")], [1, .5, .5, 2, .25], "ช่วงเวลา → วัน");
eq(M.dayEvent({ leaveOk: true, leaveOkV: "1-00:00", note: "ลาป่วย ไข้ ปวดตามตัว" }), { kind: "ลาป่วย", days: 1 }, "ลาป่วย = คำแรก");
eq(M.dayEvent({ leaveOk: true, leaveOkV: "1-00:00", note: "พักงานไม่รับค่าจ้าง เป่าแอลกอฮอล์ไม่ผ่าน" }), { kind: "พักงาน", days: 1 }, "พักงาน");
eq(M.dayEvent({ leaveDed: true, leaveDedV: "1-00:00", note: "ลาป่วยไม่จ่ายเงินหักเงิน" }), { kind: "ลาป่วยไม่จ่ายเงินหักเงิน", days: 1 }, "ลาป่วยไม่จ่ายเงิน");
eq(M.dayEvent({ deduct: "1-00:00", note: "ขาดงาน" }), { kind: "ขาดงาน", days: 1 }, "ขาดงาน");
eq(M.dayEvent({ deduct: "0-04:00", note: "ครึ่งแรกไม่ได้รูดบัตร" }), { kind: "ไม่ได้รูดบัตร (หักวัน)", days: .5 }, "ไม่ได้รูดบัตรครึ่งวัน");
eq(M.dayEvent({ note: "(ลงเวลาลืมบัตร เพิ่มเวลาLevel M)" }), null, "ลงเวลา/เพิ่มเวลา ไม่ใช่การลา");
eq(["ลาพักร้อน", "ลาหยุดชดเชย", "ลาฌาปณกิจ", "ลาป่วย", "ลากิจ", "ลาคลอดบุตร", "ลาเพื่อช่วยเหลือคู่สมรสในการคลอดบุตร", "ลารับราชการทหาร", "ขาดงาน", "ลาอุปสมบท"].map(M.suggestClass),
   ["none", "none", "none", "sick", "full", "mat", "half", "half", "full", "full"], "เดาน้ำหนักจากชื่อ");
const rows = [["บริษัท"], [], ["", "", "", "", "", "", "เข้า", "", "ออก", "", "", "สาย", "ออกก่อน", "ลาไม่หัก", "ลาหัก", "หักวัน", "นับวัน", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "หมายเหตุ", "จำนวนพนักงาน"],
  ["AKR001 นายทดสอบ"], ["", 46296, "", "Nor", "", "N", "", "", "", "", "", "0:12", "", "", "", "", "1-00:00"], ["", 46297, "", "Nor", "", "N", "", "", "", "", "", "", "", "1-00:00", "", "", "1-00:00", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "ลาป่วย ไข้"]];
const tm = M.readTime(rows).get("2026-10")[0];
eq([tm.code, tm.agg.late_n, tm.agg.late_min, tm.events], ["AKR001", 1, 12, [{ d: "2026-10-02", kind: "ลาป่วย", days: 1, note: "ลาป่วย ไข้" }]], "อ่านไฟล์ดิบ TigerSoft");

console.log(F ? `ผ่าน ${P} ไม่ผ่าน ${F}` : `ผ่านทั้งหมด ${P} เคส`);
