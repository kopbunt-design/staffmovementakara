// เทสตรวจโอที — ดึงฟังก์ชันจริงจาก js/otaudit-calc.js (+ diligence-calc.js) · ข้อมูลสมมติล้วน
// รัน:  osascript -l JavaScript test/otaudit.test.js
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;
const strip = f => read(`${ROOT}/js/${f}`).replace(/^import[^;]*;/gm, "").replace(/^export \{[^}]*\};?/gm, "").replace(/^export /gm, "");
const DC = new Function(strip("diligence-calc.js") + "; return { parseProcessed, serialToISO, durMin };")();
const M = new Function("parseProcessed", "serialToISO", "durMin", strip("otaudit-calc.js") + "; return { parseRequests, audit, unionLen, hhmm, clockOf, isoToDay, expectedOT, inferShiftTimes };")(DC.parseProcessed, DC.serialToISO, DC.durMin);
let P = 0, F = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) === JSON.stringify(b)) P++; else { F++; console.log("FAIL " + m + "\n  got =" + JSON.stringify(a) + "\n  want=" + JSON.stringify(b)); } };

// รายงานการขอโอที (โครงตามไฟล์จริง ค่าสมมติ)
const reqRow = (code, typ, io, a, b, tot, note) => { const r = new Array(27).fill(null); r[4] = code + " นายทดสอบ"; r[11] = typ; r[14] = io; r[17] = a; r[20] = b; r[22] = tot; r[26] = note; return r; };
const dateRow = s => { const r = new Array(27).fill(null); r[3] = s; r[6] = "ส่วน X"; return r; };
const reqs = M.parseRequests([["บริษัท"], dateRow("01-Sep-26"), reqRow("AKR00000001", "E", "I", "17:00", "18:00", "01:00", "งานเอกสาร"), dateRow("02-Sep-26"), reqRow("DAY0009", "S", "O", "06:00", "08:00", "02:00", "")]);
eq(reqs.map(r => [r.emp, r.date, r.typ, r.io, r.start, r.end, r.hours, r.note]), [["AKR00000001", "2026-09-01", "E", "I", 1020, 1080, 60, "งานเอกสาร"], ["DAY0009", "2026-09-02", "S", "O", 360, 480, 120, ""]], "อ่านรายงานการขอโอที");
eq(M.unionLen([[0, 60], [30, 90], [200, 260]]), 150, "รวมช่วงไม่บวกซ้ำ");

// วันจากรายงานหลังประมวล (โครงที่ parseProcessed คืน) — สร้างตรง ๆ
const day0 = M.isoToDay("2026-09-01");
const at = (d, h) => (day0 + d) * 1440 + Math.round(h * 60);
const mkProc = days => new Map([["AKR1", { code: "AKR1", name: "นายทดสอบ", days }]]);
const D = (d, o = {}) => ({ date: DC.serialToISO(day0 + d), shift: "Nor", dayType: "N", inMin: at(d, 7.5), outMin: at(d, 18), ot: { "1": 0, "1.5": 0 }, note: "", ...o });
const Q = (d, typ, a, b, hours, o = {}) => ({ emp: "AKR1", name: "นายทดสอบ", date: DC.serialToISO(day0 + d), typ, io: "I", start: Math.round(a * 60), end: Math.round(b * 60), hours: Math.round(hours * 60), note: "", ...o });
const run = (days, qs, lv = "O2") => M.audit(mkProc(days), qs, () => lv, "2026-09");
const kinds = r => r.issues.map(i => i.kind).sort();

let r = run([D(0, { ot: { "1.5": 60 } })], [Q(0, "E", 17, 18, 1)]);
eq([r.requests[0].scan, r.days[0].result, kinds(r)], ["ครบ", "ตรง", []], "โอทีหลังเลิกงาน สแกนครบ ยอดตรง");
r = run([D(0, { outMin: at(0, 17.5), ot: { "1.5": 30 } })], [Q(0, "E", 17, 18, 1)]);
eq([r.requests[0].scan, r.days[0].result], ["สแกนครอบคลุม 0:30 จาก 1:00", "ต่างไม่เกิน 1 ชม. (พัก/ปัดเศษ)"], "สแกนออกก่อนจบโอที");
r = run([D(0, { outMin: at(0, 17.97), ot: { "1.5": 60 } })], [Q(0, "E", 17, 18, 1)]);
eq(r.requests[0].scan, "ครบ", "สแกนขาด 2 นาที = ครบ (คลาดได้ 5 นาที)");
r = run([D(0, { shift: "A01", inMin: at(0, 14), outMin: at(1, 6.05), ot: { "1.5": 360 } })], [Q(0, "E", 0, 6, 6)]);
eq([r.requests[0].scan, r.days.length, r.days[0].result], ["ครบ", 1, "ตรง"], "กะบ่ายขอ 00:00–06:00 = หลังเที่ยงคืนของกะวันที่ขอ");
r = run([D(0), D(1, { ot: { "1.5": 60 } })], [Q(0, "E", 17, 18, 1)]);
eq(r.days.find(d => d.date === "2026-09-01").reqs.length, 1, "คำขอติดวันที่ขอ ไม่ย้ายไปวันถัดไป");
r = run([D(0)], [Q(0, "E", 17, 19, 2)]);
eq(r.days[0].result, "TigerSoft ไม่ขึ้นโอที", "TigerSoft ไม่ขึ้น");
r = run([D(0, { ot: { "1.5": 60 } })], [Q(0, "E", 17, 21, 4, { })].map(q => ({ ...q })).concat([]), "O1");
eq(r.days[0].result, "TigerSoft ขึ้นน้อยกว่าที่ขอ", "TigerSoft ขึ้นน้อยกว่า");
r = run([D(0, { ot: { "1.5": 120 } })], []);
eq(r.days[0].result, "มีโอทีใน TigerSoft แต่ไม่มีคำขอ", "มีโอทีแต่ไม่มีคำขอ");
r = run([D(0, { ot: { "1.5": 120 } })], [Q(0, "E", 17, 19, 2), Q(0, "E", 17, 19, 2)]);
eq([r.days[0].asked, r.days[0].result, r.issues.find(i => i.kind === "overlap").sev], [120, "ตรง", "warn"], "ขอซ้ำ: ตัดซ้อน ยอดตรง แต่ขึ้นให้ลบ");
r = run([D(0, { ot: { "1.5": 120 } })], [Q(0, "E", 17, 19, 2), Q(0, "E", 18, 19, 1)]);
eq([r.days[0].asked, r.issues.find(i => i.kind === "overlap").sev], [120, "info"], "ช่วงซ้อนกัน (ไม่ซ้ำ) ตัดก่อนเทียบ");
r = run([D(0, { dayType: "H", ot: { "1": 60 } })], [Q(0, "E", 17, 18, 1)]);
eq(kinds(r), ["holiday"], "วันหยุดขอชนิดหลังเลิกงาน = ผิด");
r = run([D(0, { dayType: "H", inMin: at(0, 8), outMin: at(0, 17), ot: { "1": 480 } })], [Q(0, "S", 8, 17, 8)]);
eq(kinds(r), [], "วันหยุดขอชนิดก่อนเริ่มงาน = ถูก");
r = run([D(0, { ot: { "1.5": 60 } })], [Q(0, "E", 17, 18, 1, { io: "O" })], "O2");
eq(kinds(r), ["level"], "ระดับ O ขอแบบลา = ผิด");
r = run([D(0, { ot: { "1.5": 60 } })], [Q(0, "E", 17, 18, 1, { io: "I" })], "S1");
eq(kinds(r), ["level"], "ระดับ S ขอแบบจ่ายเงิน = ผิด");
r = run([D(0, { ot: { "1.5": 60 } })], [Q(0, "E", 17, 18, 1, { io: "O" })], "M2");
eq(kinds(r), [], "ระดับ M ขอแบบลา = ถูก");
r = run([D(0, { ot: { "1.5": 30 } })], [Q(0, "B", 12.5, 13, 0.5)]);
eq([r.requests[0].scan, kinds(r)], ["พักเที่ยง — สแกนตรวจไม่ได้", ["lunch"]], "พักเที่ยง = เตือน ไม่ตรวจสแกน");
r = run([D(0, { shift: "F01", dayType: "H", ot: { "1": 570 } })], [Q(0, "S", 8, 17.5, 9.5)]);
eq(kinds(r), ["f01"], "F01 วันหยุด OT1 9:30 = ยังไม่หักพัก");
r = run([D(0, { shift: "F01", dayType: "H", ot: { "1": 510 } })], [Q(0, "S", 8, 17.5, 9.5)]);
eq(kinds(r).includes("f01"), false, "F01 วันหยุด OT1 8:30 = ถูก");
r = run([D(3), D(4, { dayType: "H", inMin: at(4, 13), outMin: at(4, 16), ot: { "1": 180 } })], [Q(3, "S", 13, 16, 3)]);
eq(kinds(r).includes("wrongday"), true, "ขอวันที่ 4 แต่ TigerSoft ขึ้นวันที่ 5 = อาจลงวันผิด");
eq(M.clockOf(at(1, 6.05), day0), "06:03 (+1)", "แสดงเวลาข้ามวัน (ไม่ผ่านเขตเวลา)");

// ---- เวลากะ: คิดโอทีที่ควรได้ + ตรวจชนิดกับเวลากะ
const NOR = { NOR: { start: 450, end: 1020, brk: [720, 780] } };
const runS = (days, qs, lv = "O2") => M.audit(mkProc(days), qs, () => lv, "2026-09", NOR);
r = runS([D(0, { outMin: at(0, 19.1), ot: { "1.5": 120 } })], [Q(0, "E", 17, 19, 2)]);
eq([r.days[0].expected, r.days[0].result], [120, "ตรง"], "วันทำงาน: หลังเลิกงาน 17–19 = 2:00");
r = runS([D(0, { outMin: at(0, 18.75), ot: { "1.5": 90 } })], [Q(0, "E", 17, 19, 2)]);
eq([r.days[0].expected, r.days[0].result], [90, "ตรง"], "สแกนออก 18:45 → ควรได้ 1:30 (ปัดลง 30 นาที)");
r = runS([D(0, { outMin: at(0, 19.1), ot: { "1.5": 150 } })], [Q(0, "E", 17, 19, 2)]);
eq(r.days[0].result, "TigerSoft ขึ้นมากกว่าที่ควร", "ต่าง 30 นาทีก็ขึ้น");
r = runS([D(0, { inMin: at(0, 6.4), ot: { "1.5": 90 } })], [Q(0, "S", 6.5, 7.5, 1), Q(0, "B", 12.5, 13, 0.5)]);
eq(r.days[0].expected, 90, "วันทำงาน: ก่อนเริ่มงาน 1:00 + พักเที่ยงที่ขอ 0:30 = 1:30");
r = runS([D(0, { ot: { "1.5": 30 } })], [Q(0, "S", 6.5, 7.5, 1), Q(0, "B", 12.5, 13, 0.5)]);
eq(r.days[0].expected, 30, "สแกนเข้า 7:30 → ก่อนเริ่มงานไม่ได้ เหลือพักเที่ยง 0:30");
const holD = o => D(0, { dayType: "H", inMin: at(0, 6.4), outMin: at(0, 20.05), ...o });
r = runS([holD({ ot: { "1": 510, "3": 210 } })], [Q(0, "S", 6.5, 20, 13.5)]);
eq(r.days[0].expected, 750, "วันหยุด: 6:30–20:00 หักพัก 1 ชม. = 12:30");
r = runS([holD({ ot: { "1": 510, "3": 270 } })], [Q(0, "S", 6.5, 20, 13.5), Q(0, "B", 12.5, 13, 0.5)]);
eq(r.days[0].expected, 780, "วันหยุด + ขอพักเที่ยง 12:30–13:00 → หักพักแค่ 30 นาที = 13:00");
r = runS([D(0, { ot: { "1.5": 60 } })], [Q(0, "S", 7, 8.5, 1.5)]);
eq(kinds(r).includes("position"), true, "ก่อนเริ่มงานแต่เลยเวลาเข้ากะ");
r = runS([D(0, { ot: { "1.5": 60 } })], [Q(0, "E", 16, 18, 2)]);
eq(kinds(r).includes("position"), true, "หลังเลิกงานแต่เริ่มก่อนเลิกกะ");
r = runS([D(0, { leaveOk: true, note: "ลาพักร้อน", ot: { "1.5": 60 } })], [Q(0, "E", 17, 18, 1)]);
eq(kinds(r).includes("leaveday"), true, "ขอโอทีวันที่ลา");
// เดาเวลากะจากคำขอ (≥ 3 คำขอ) + เวลาพักจากวันหยุด
const many = []; const pdays = [];
for (let i = 0; i < 6; i++) { pdays.push(D(i)); many.push(Q(i, "S", 6.5, 7.5, 1), Q(i, "E", 17, 18, 1)); }
for (let i = 7; i < 10; i++) { pdays.push(holD({ date: DC.serialToISO(day0 + i), inMin: at(i, 7.4), outMin: at(i, 17.05), ot: { "1": 510 } })); many.push(Q(i, "S", 7.5, 17, 9.5)); }
const g = M.inferShiftTimes(mkProc(pdays), many).NOR;
eq([g.start, g.end, g.brk], [450, 1020, [720, 780]], "เดาเวลากะ NOR 07:30–17:00 พัก 12:00–13:00");

// โอทีเกิน 36 ชม./สัปดาห์ (จันทร์ 7 ก.ย. = day0+6)
const wkDays = [6, 7, 8, 9, 10].map(i => D(i, { ot: { "1.5": 450 } }));            // 5 วัน × 7:30 = 37:30
r = runS(wkDays, []);
eq(kinds(r).filter(k => k === "week36").length, 1, "โอที 37:30 ใน 1 สัปดาห์ = เกิน 36");
r = runS([6, 7, 8, 9].map(i => D(i, { ot: { "1.5": 450 } })).concat([D(12, { dayType: "H", ot: { "1": 510 } })]), []);
eq(kinds(r).includes("week36"), false, "ทำงานวันหยุดในเวลาปกติ (1 เท่า) ไม่นับ");

// กะนับชั่วโมง: นับจากเวลาเข้างานจริง · 9.5 ชม. (หักพัก 1 ชม.) / 8.5 ชม. (ไม่หักพัก) · ไม่เกินที่ขอ
const FX = sp => ({ F01: { start: 1200, end: 1920, brk: null, byHours: true, span: sp } });
const runH = (days, qs, sp) => M.audit(mkProc(days), qs, () => "O2", "2026-09", FX(sp));
const FD = (o = {}) => D(0, { shift: "F01", inMin: at(0, 19.75), outMin: at(1, 8.1), ...o });      // 19:45 – 08:06 = 12:21
r = runH([FD({ ot: { "1.5": 150 } })], [Q(0, "E", 5.5, 8, 2.5)], 570);
eq([r.days[0].expected, r.days[0].result], [150, "ตรง"], "9.5 ชม.: ทำ 12:21 → เกิน 2:51 → 2:30 (= ที่ขอ)");
r = runH([FD({ ot: { "1.5": 180 } })], [Q(0, "E", 5.5, 8, 2.5)], 570);
eq([kinds(r), r.issues[0].sev], [["manual"], "info"], "ได้เกินที่ขอ = HR แก้มือแล้ว (ข้อสังเกต ไม่ใช่ข้อผิดพลาด)");
r = runH([FD({ ot: { "1.5": 30 } })], [Q(0, "E", 5.5, 8, 2.5), Q(0, "B", 0.5, 1, 0.5)], 570);
eq(kinds(r), ["lunch", "lunchblock"], "F01 มีพักเที่ยง TigerSoft ขึ้นแค่พักเที่ยง = ต้องแก้มือ");
r = runH([FD({ ot: { "1.5": 150 } })], [Q(0, "E", 5.5, 8, 2.5), Q(0, "B", 0.5, 1, 0.5)], 570);
eq(kinds(r).includes("lunchblock"), false, "F01 มีพักเที่ยงแต่แก้มือครบแล้ว = ไม่ขึ้น");
r = runH([FD({ ot: { "1.5": 180 } })], [Q(0, "E", 4, 8, 4)], 510);
eq(r.days[0].expected, 210, "8.5 ชม.: ทำ 12:21 → เกิน 3:51 → 3:30 (ขอ 4:00)");
r = runH([FD({ dayType: "H", ot: { "1": 510, "3": 150 } })], [Q(0, "S", 20, 8, 12)], 570);
eq(r.days[0].expected, 660, "วันหยุด 9.5 ชม.: 12:21 − พัก 1 ชม. = 11:21 → 11:00");
r = runH([FD({ ot: { "1.5": 150 } })], [Q(0, "S", 18, 19, 1)], 570);
eq(kinds(r).includes("position"), false, "กะนับชั่วโมง ไม่ตรวจชนิดกับเวลากะ");

console.log(F === 0 ? `ผ่านทั้งหมด ${P} เคส` : `ผ่าน ${P} · ตก ${F}`);
