// เทสกองทุนสำรองเลี้ยงชีพ — ดึงฟังก์ชันจริงจาก js/pvd-calc.js · ข้อมูลสมมติ
// รัน:  osascript -l JavaScript test/pvd.test.js
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;
const src = read(`${ROOT}/js/pvd-calc.js`).replace(/^export /gm, "");
const M = new Function(`${src}; return { barred, yearsAt, capOf, erCapFor, erRateFor, vestOf, tierAlerts, registerAlerts, parsePayroll, checkMonth, uploadRows, payDateBE, parseMaster, probationEnd, addYears, ymAdd };`)();
let P = 0, F = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) === JSON.stringify(b)) P++; else { F++; console.log("FAIL " + m + "\n  got =" + JSON.stringify(a) + "\n  want=" + JSON.stringify(b)); } };

// อายุงาน
eq(M.yearsAt("2023-07-10", "2026-07-09"), 2, "ก่อนวันครบ 1 วัน");
eq(M.yearsAt("2023-07-10", "2026-07-10"), 3, "วันครบรอบ = ครบ");
eq(M.addYears("2024-02-29", 1), "2025-03-01", "29 ก.พ. ปีถัดไป");
eq(M.ymAdd("2026-12", 1), "2027-01", "ข้ามปี");
// เพดานสมทบ — เดือนที่ครบเลย (user แก้ 2026-11-13 · AKR23101073 ครบ 3 ต.ค. → 7% รอบ ต.ค.)
eq(M.erCapFor("2023-10-03", "2026-09"), 0.05, "เดือนก่อนครบ ยัง 5%");
eq(M.erCapFor("2023-10-03", "2026-10"), 0.07, "เดือนที่ครบ 7%");
eq(M.erCapFor("2023-10-31", "2026-10"), 0.07, "ครบวันสุดท้ายของเดือนก็ได้เดือนนั้น");
eq(M.erCapFor("2017-03-01", "2026-11"), 0.10, "9 ปี → 10%");
eq(M.erCapFor("2016-03-01", "2026-04"), 0.12, "10 ปี → 12%");
eq(M.erRateFor(0.15, "2017-03-01", "2026-11"), 0.10, "สะสม 15% สมทบเพดาน 10%");
eq(M.erRateFor(0.05, "2016-01-01", "2026-11"), 0.05, "สมทบเท่าเงินสะสมถ้าต่ำกว่าเพดาน");
// สิทธิ์ในเงินสมทบ
eq(M.vestOf("2023-03-01", "2026-03-01"), { years: 3, pct: 0.75 }, "ทำงานครบ 3 ปีพอดี (พ้นสภาพ 1 มี.ค.) → 75%");
eq(M.vestOf("2023-03-01", "2026-02-28"), { years: 2, pct: 0.5 }, "ขาดวันเดียว → 50%");
eq(M.vestOf("2026-01-01", "2026-10-01"), { years: 0, pct: 0 }, "ไม่ถึงปี → 0");
eq(M.vestOf("2020-01-01", "2026-10-01").pct, 1, "4 ปีขึ้นไป 100%");
// แจ้งเตือนขั้นสมทบ
const emps = new Map([["A1", { emp_code: "A1", join_date: "2023-12-05" }], ["A2", { emp_code: "A2", join_date: "2020-12-20" }],
                      ["A3", { emp_code: "A3", join_date: "2023-12-01", end_date: "2026-11-01" }]]);
const al = M.tierAlerts([{ emp_code: "A1", emp_rate: 0.07, status: "active" }, { emp_code: "A2", emp_rate: 0.05, status: "active" },
                         { emp_code: "A3", emp_rate: 0.1, status: "active" }], emps, "2026-11", 3);
eq(al.map(a => [a.emp_code, a.years, a.eff, a.changes]), [["A1", 3, "2026-12", true], ["A2", 6, "2026-12", false]], "ครบ ธ.ค. → มีผล ธ.ค. · สะสม 5% ไม่เปลี่ยน · คนออกไม่ขึ้น");
// ทะเบียน
eq(M.probationEnd("2026-01-01"), "2026-04-29", "พ้นทดลองงานวันที่ 119");
const ra = M.registerAlerts([{ emp_code: "B1", status: "active", member_code: "CGM1", id_card: "1234567890123", dob: "01012540", sec_code: "SEC01", emp_rate: 0.05 },
                             { emp_code: "B3", status: "declined" }],
  [{ emp_code: "B1", join_date: "2020-01-01", end_date: "2026-10-01", contract_type: "Permanent" }, { emp_code: "B2", join_date: "2026-01-01", contract_type: "Permanent" },
   { emp_code: "B3", join_date: "2026-01-01", contract_type: "Permanent" }, { emp_code: "B4", join_date: "2026-10-01", contract_type: "Permanent" }], "2026-11-13");
eq([ra.eligible.map(x => x.emp_code), ra.left.map(x => [x.emp_code, x.pct])], [["B2"], [["B1", 1]]], "ครบสิทธิ์สมัคร / ออกแล้วยัง active");
// ไฟล์เงินเดือน + ตรวจยอด
const aoa = [["รหัสพนักงาน", "ชื่อ-นามสกุล", "เงินเดือน", "ลา", "พักงาน", "กองทุนสำรองเลี้ยงชีพ", "กองทุนบริษัทสมทบ"],
  ["C1", "a", 13555, 0, 1355.5, 853.97, 853.97],       // หักพักงาน → ฐาน 12,199.50 · 7% (ข้อมูลจริง ต.ค.)
  ["C2", "b", 20000, 0, 0, 1400, 1000],                // ครบ 3 ปีเดือน ต.ค. → ต.ค. ต้อง 7% แต่ยัง 5%
  ["C3", "c", 30000, 0, 0, 3000, 2100],                // ไม่อยู่ในทะเบียน
  ["C4", "d", 10000, 0, 0, 0, 0]];
const pay = M.parsePayroll(aoa);
eq(pay.get("C1").base, 12199.5, "ฐาน = เงินเดือน − พักงาน");
const mems = [{ emp_code: "C1", status: "active", emp_rate: 0.07, member_code: "CGM1", id_card: "1234567890123", dob: "01012540", sec_code: "SEC01" },
              { emp_code: "C2", status: "active", emp_rate: 0.07, member_code: "CGM2", id_card: "1234567890124", dob: "01012540", sec_code: "SEC01" },
              { emp_code: "C4", status: "active", emp_rate: 0.05, member_code: "CGM4", id_card: "1234567890125", dob: "01012540", sec_code: "SEC01" }];
const em2 = new Map([["C1", { join_date: "2023-03-01" }], ["C2", { join_date: "2023-10-15" }], ["C3", { join_date: "2015-01-01" }], ["C4", { join_date: "2020-01-01" }]]);
const ck = M.checkMonth({ pay, members: mems, emps: em2, ym: "2026-10" });
eq(ck.issues.map(i => [i.emp_code, i.kind]), [["C2", "tier_not_applied"], ["C3", "not_member"], ["C4", "no_deduct"]], "ตรวจยอด");
eq(ck.totals, { members: 3, emp: 5253.97, er: 3953.97 }, "ยอดรวม");
const up = M.uploadRows(ck.items, mems, "2026-10-22");
eq(up[0], [2958, "SEC01", "CGM1", "1234567890123", "01012540", "", "", "", 22102569, 853.97, 853.97, null, null], "แถวไฟล์ส่งกองทุน");
eq(up.length, 2, "คนไม่อยู่ในทะเบียนไม่ลงไฟล์");
// นำเข้าไฟล์ทะเบียนเดิม
const pm = M.parseMaster({
  "รหัสสังกัด": [["รหัสสังกัด", "Section"], ["SEC04", "Community Relations & Development"]],
  DataPVD: [[null], ["รหัสบริษัท", "รหัสสังกัด", "รหัสสมาชิก", "รหัสพนักงาน", "เลขบัตรประชาชน"],
            [2958, "SEC04", "CGM317", "AKR17030317", "3660800400771", "21012526", "นางสาว", "ก", "ข", "", "", "", 42795, "", 42795, null, 0.1, 0.1, null, null, true, null],
            [2958, "SEC07", "CGM775", "AKR23020775", 1660800035383, "23012516", "นาย", "ค", "ง", "", "", "", "01/10/2025", "", "#N/A", 46203, 0.07, 0.07, "PF1103", null, true, "x"]],
  Record: [[null, null, null, null, null, null, null, null, null, null, null, null, 46265], ["รหัสบริษัท", "รหัสสังกัด", "รหัสสมาชิก", "รหัสพนักงาน"],
           [2958, "SEC04", "CGM317", "AKR17030317", "", "", "", "", "", "", "", "", "", 9, null, null, 0.1, 0.1, null, 7, 18169.5, 18169.5, null]] });
eq(pm.members.map(m => [m.emp_code, m.id_card, m.member_date, m.left_date, m.status, m.policy]),
   [["AKR17030317", "3660800400771", "2017-03-01", null, "active", null], ["AKR23020775", "1660800035383", null, "2026-06-30", "left", "PF1103"]], "นำเข้าสมาชิก");
eq(pm.history, [{ ym: "2026-07", emp_code: "AKR17030317", member_code: "CGM317", emp_amt: 18169.5, er_amt: 18169.5, emp_rate: 0.1, note: null }], "นำเข้าประวัติ");
eq(pm.sections, [{ sec_code: "SEC04", name: "Community Relations & Development" }], "รหัสสังกัด");

// ลาออกจากกองทุนระหว่างเป็นพนักงาน → สมัครใหม่ไม่ได้
eq(M.barred({ status: "left", left_date: "2026-08-06" }, { end_date: null }, "2026-11-13"), true, "ออกจากกองทุนแต่ยังทำงาน = ห้ามกลับ");
eq(M.barred({ status: "left", left_date: "2026-10-31" }, { end_date: "2026-11-01" }, "2026-11-13"), false, "ออกเพราะลาออกจากงาน");
eq(M.barred({ status: "declined", no_rejoin: true }, { end_date: null }, "2026-11-13"), true, "ติ๊กไว้");
eq(M.barred({ status: "active" }, { end_date: null }, "2026-11-13"), false, "สมาชิกปกติ");
console.log(F ? `ไม่ผ่าน ${F} / ${P + F}` : `ผ่านทั้งหมด ${P} เคส`);
