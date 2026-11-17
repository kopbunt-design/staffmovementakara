// เทสทะเบียนรายได้และภาษี — ดึงฟังก์ชันจริงจาก js/tax-calc.js · ข้อมูลสมมติ
// รัน:  osascript -l JavaScript test/tax.test.js
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;
const src = read(`${ROOT}/js/tax-calc.js`).replace(/^export /gm, "");
const T = new Function(`${src}; return { readPayroll, parsePnd, validTaxId, matchPnd, yearTotals, reconcileMonth, certStale, certChecks, leaverAlerts, pnd1kRows, bahtText, income, taxAll, split, colList, suggestType, reType, UNEXPLAINED, parsePndSheet, pndCode, guessPart, groupOf };`)();
let P = 0, F = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) === JSON.stringify(b)) P++; else { F++; console.log("FAIL " + m + "\n  got =" + JSON.stringify(a) + "\n  want=" + JSON.stringify(b)); } };
const pick = (x, ...k) => Object.fromEntries(k.map(f => [f, x[f]]));

// TigerSoft BeforeProcessYDP
const ydp = [["รหัสพนักงาน", "ชื่อ-นามสกุล", "สถานะคนลาออก", "เงินเดือน", "โอที 1", "เงินชดเชย1", "ค่าตอบแทนกรรมการ", "ขาด", "ลา", "พักงาน", "ภาษี", "ภาษีเงินชดเชย", "ประกันสังคม", "กองทุนสำรองเลี้ยงชีพ", "รวมรายได้"],
  ["AKR1", "ก   ข", "ปกติ", 30000, 1000, 0, 0, 0, 500, 0, 800, 0, 875, 1500, 31000],
  ["AKR2", "ค ง", "ลาออก", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],                       // ลาออกแล้ว ยอดศูนย์ → ข้าม
  ["DAY0001", "จ ฉ", "ปกติ", 9000, 0, 0, 0, 300, 0, 0, 0, 0, 435, 0, 9000],            // รายวันก็อยู่ใน ภ.ง.ด.1
  ["KCN001", "ช ซ", "ปกติ", 0, 0, 0, 50000, 0, 0, 0, 2500, 0, 0, 0, 50000],            // ค่าตอบแทนกรรมการ = 40(2)
  ["AKR3", "ฌ ญ", "ปกติ", 20000, 0, 120000, 0, 0, 0, 0, 300, 4000, 750, 0, 140000],    // เงินชดเชยแยก
  [null, "รวม"]];
const r1 = T.readPayroll({ BeforeProcessYDP: ydp });
eq([r1.format, [...r1.rows.keys()], r1.skipped], ["ydp", ["AKR1", "DAY0001", "KCN001", "AKR3"], 1], "ydp: รู้จักไฟล์ · ข้ามแถวศูนย์และแถวรวม");
eq(pick(r1.rows.get("AKR1"), "name", "inc401", "tax", "sso", "pvd"), { name: "ก ข", inc401: 30500, tax: 800, sso: 875, pvd: 1500 }, "40(1) = รวมรายได้ − ลา");
eq(pick(r1.rows.get("DAY0001"), "inc401"), { inc401: 8700 }, "หักขาดงาน");
eq(pick(r1.rows.get("KCN001"), "inc401", "inc402", "tax"), { inc401: 0, inc402: 50000, tax: 2500 }, "กรรมการ 40(2)");
eq(pick(r1.rows.get("AKR3"), "inc401", "sev", "tax", "sev_tax"), { inc401: 20000, sev: 120000, tax: 300, sev_tax: 4000 }, "เงินชดเชยแยกจาก 40(1)");

// Excel เงินเดือนเดิม (แผ่น Salary Final หัวตารางอยู่แถว 5)
const xl = [["Akara Resources"], [" January 2026"], ["Item"], ["Administration"],
  ["CGM", "Employee No.", "คำนำหน้า", "ชื่อ", "นามสกุล", "Salary", "Total Income", "PVD", "SSO", "WHT", "Senior Staff", "Total Income"],
  ["CGM1", "AKR1", "นาย", "ก", "ข", 30000, 31000, 1500, 875, 800, "x", 999], ["", "Total", "", "", "", 1, 1, 1, 1, 1]];
const r2 = T.readPayroll({ "Salary Final ": xl, Consultant: [["ID Card No."]] });
eq([r2.format, pick(r2.rows.get("AKR1"), "name", "inc401", "tax", "sso", "pvd")], ["excel", { name: "ก ข", inc401: 31000, tax: 800, sso: 875, pvd: 1500 }], "excel: ใช้คอลัมน์แรกที่ชื่อซ้ำ");

// TigerSoft ย้อนหลัง รายได้/รายหัก
const r3 = T.readPayroll({
  "รายได้": [["CGM", "รหัสพนักงาน", "เงินเดือน", "โอที 1", "เงินชดเชย1", "เงินชดเชย2"], ["CGM1", "AKR1", 30000, 1000, 0, 0], ["CGM3", "AKR3", 20000, 0, 100000, 20000], [null, null, 1, 1]],
  "รายหัก": [["CGM", "รหัสพนักงาน", "ภาษี", "ประกันสังคม", "กองทุนสำรองเลี้ยงชีพ", "ภาษีชดเชย", "ลา"], ["CGM1", "AKR1", 800, 875, 1500, 0, 500], ["CGM3", "AKR3", 300, 750, 0, 4000, 0]] });
eq([r3.format, pick(r3.rows.get("AKR1"), "inc401", "tax"), pick(r3.rows.get("AKR3"), "inc401", "sev", "sev_tax")],
   ["tshist", { inc401: 30500, tax: 800 }, { inc401: 20000, sev: 120000, sev_tax: 4000 }], "tshist: รวมรายได้ทุกช่อง หักลา แยกเงินชดเชย");
let err = ""; try { T.readPayroll({ Sheet1: [["a", "b"]] }); } catch (e) { err = e.message.slice(0, 20); }
eq(err !== "", true, "ไฟล์ไม่รู้จัก → error");

// ภ.ง.ด.1 (ข้อความคั่น |)
const line = (id, f, l, m, inc, tax) => `00|00000|0107556000582|0000000000|0000|${id}||นาย|${f}|${l}|1 หมู่ 2|ตำบล อำเภอ จังหวัด|66000|${m}|2569|1|25082569|0|${inc}|${tax}|1`;
const pnd = T.parsePnd([line("1101700203450", "ก", "ข", "08", "30500.00", "800.00"), line("3100600123459", "x", "y", "08", "1000.00", "0.00"), ""].join("\r\n"), "0107556000582");
eq([pnd.months, pnd.rows.length, pick(pnd.rows[0], "tax_id", "first", "zip", "ym", "income", "tax")],
   [["2026-08"], 2, { tax_id: "1101700203450", first: "ก", zip: "66000", ym: "2026-08", income: 30500, tax: 800 }], "อ่าน ภ.ง.ด.1");
eq([T.validTaxId("1101700203450"), T.validTaxId("1101700203452"), T.validTaxId("12345")], [true, false, false], "เลขตรวจสอบ 13 หลัก");
const m = T.matchPnd(pnd.rows, [{ emp_code: "AKR9", tax_id: "3100600123459" }], [{ emp_code: "AKR1", firstname_th: "ก", lastname_th: "ข" }]);
eq(m.map(x => x.emp_code), ["AKR1", "AKR9"], "จับคู่ด้วยชื่อ / เลขที่รู้แล้ว");
const dup = T.matchPnd(pnd.rows.slice(0, 1), [], [{ emp_code: "A", firstname_th: "ก", lastname_th: "ข" }, { emp_code: "B", firstname_th: "ก", lastname_th: "ข" }]);
eq(dup[0].emp_code, null, "ชื่อซ้ำสองคน → ไม่เดา");
{ // ชื่อซ้ำ (กลับเข้าทำงานใหม่) → คนที่มียอดเดือนนั้น · เปลี่ยนนามสกุล → ชื่อ + ยอดตรง · ชื่อจากไฟล์เงินเดือนของพนักงานที่เปลี่ยนนามสกุลในทะเบียน
  const emps = [{ emp_code: "OLD", firstname_th: "นิคม", lastname_th: "คันทอง" }, { emp_code: "NEW", firstname_th: "นิคม", lastname_th: "คันทอง" },
    { emp_code: "R", firstname_th: "รวิวรรณ", lastname_th: "สาดี" }, { emp_code: "W", firstname_th: "วัชระ", lastname_th: "จันทร์แจ่ม" }, { emp_code: "X", firstname_th: "สมชาย", lastname_th: "ใจดี" }];
  const ppl = [{ emp_code: "W", first_th: "วัชระ", last_th: "ดอกแก้ว" }];
  const rg = [{ emp_code: "NEW", inc401: 16313 }, { emp_code: "R", inc401: 39900 }, { emp_code: "W", inc401: 24463 }, { emp_code: "X", inc401: 39900 }];
  const rows = [{ title: "นาย", first: "นิคม", last: "คันทอง", income: 16313, tax: 0 }, { title: "นาง", first: "รวิวรรณ", last: "บุหงางาม", income: 39900, tax: 0 },
    { title: "นาย", first: "วัชระ", last: "ดอกแก้ว", income: 24463, tax: 0 }, { title: "", first: "นายสมศรี", last: "มีสุข", income: 39900, tax: 0 }];
  eq(T.matchPnd(rows, ppl, emps, rg).map(x => x.emp_code), ["NEW", "R", "W", null], "จับคู่ชื่อซ้ำ / เปลี่ยนนามสกุล / ชื่อจากไฟล์เงินเดือน · ยอดตรงแต่ชื่อไม่ตรง → ไม่เดา");
}

// กระทบยอด
const reg = [{ emp_code: "AKR1", inc401: 30500, inc402: 0, sev: 0, tax: 800, sev_tax: 0 }, { emp_code: "AKR2", inc401: 100, inc402: 0, sev: 0, tax: 0, sev_tax: 0 }];
const rc = T.reconcileMonth(reg, [{ ...m[0], tax: 900 }, m[1]]);
eq(rc.issues.map(i => [i.kind, i.emp_code]), [["diff", "AKR1"], ["not_in_pnd", "AKR2"], ["not_in_reg", "AKR9"]], "กระทบยอดรายเดือน");
eq(rc.totals, { reg: { n: 2, income: 30600, tax: 800 }, pnd: { n: 2, income: 31500, tax: 900 } }, "ยอดรวม");

// รวมทั้งปี + 50 ทวิ
const yt = T.yearTotals([{ ym: "2026-02", emp_code: "A", inc401: 100.1, tax: 1, sso: 875 }, { ym: "2026-01", emp_code: "A", inc401: 200.2, tax: 2, sso: 875 }]);
eq(pick(yt.get("A"), "inc401", "tax", "sso", "months", "last"), { inc401: 300.3, tax: 3, sso: 1750, months: ["2026-01", "2026-02"], last: "2026-02" }, "รวมทั้งปี");
eq([T.certStale({ inc401: 300.3, tax: 3, sso: 1750 }, yt.get("A")), T.certStale({ inc401: 300, tax: 3, sso: 1750 }, yt.get("A"))], [false, true], "ใบเก่าเมื่อยอดเปลี่ยน");
eq(T.certChecks({ tax_id: "1101700203452", address: "" }, { inc401: 1, sev: 5 }).map(c => c.level), ["warn", "info", "info"], "ตรวจก่อนออกใบ");
const la = T.leaverAlerts([{ emp_code: "A", end_date: "2026-10-01" }, { emp_code: "B", end_date: "2026-11-10" }, { emp_code: "C", end_date: "2026-12-31" }, { emp_code: "D", end_date: "2026-03-01" }],
  [{ emp_code: "D", status: "signed" }], 2026, "2026-11-13");
eq(la.map(x => [x.emp_code, x.due, x.overdue]), [["A", "2026-11-01", true], ["B", "2026-12-10", false]], "คนลาออกต้องได้ใบภายใน 1 เดือน");
eq(T.pnd1kRows([{ seq: 1, emp_code: "A", person: { tax_id: "1" }, tot: { inc401: 10, tax: 1, sev: 5, sev_tax: 0, inc402: 0 } }]).map(r => [r[7], r[8], r[9]]),
   [["40(1) เงินเดือน ค่าจ้าง", 10, 1], ["40(1) จ่ายครั้งเดียวเพราะเหตุออกจากงาน", 5, 0]], "ใบงาน ภ.ง.ด.1ก แยกประเภทเงินได้");
eq([T.bahtText(1234.5), T.bahtText(21), T.bahtText(11000000), T.bahtText(0.25)], ["หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์", "ยี่สิบเอ็ดบาทถ้วน", "สิบเอ็ดล้านบาทถ้วน", "ยี่สิบห้าสตางค์"], "จำนวนเงินตัวอักษร");

// ประเภทเงินได้ทีละคอลัมน์ (user 2026-11-16): ข้อ 1 เงินเดือน / ข้อ 6 ออกจากงาน / ข้อ 2 40(2) / ไม่นับ · ขาด/ลาเป็นค่าลบ
const yx = [["รหัสพนักงาน", "ชื่อ-นามสกุล", "เงินเดือน", "เบิกเงินล่วงหน้า", "เงินชดเชย1", "ค่าตอบแทนกรรมการ", "ค่าเดินทางตามจริง", "ขาด", "ลา", "ภาษี", "รวมรายได้"],
  ["AKR1", "ก ข", 30000, 5000, 0, 0, 1200, 0, 500, 800, 36200], ["AKR2", "ค ง", 20000, 0, 100000, 0, 0, 0, 0, 0, 120100]];
const y0 = T.readPayroll({ S: yx });
eq(pick(y0.rows.get("AKR1"), "inc401", "sev"), { inc401: 29500, sev: 0 }, "ไม่ยืนยัน = ใช้ที่ระบบเสนอ (เบิกเงินล่วงหน้า/ตามจริง = ไม่นับ)");
eq(y0.rows.get("AKR1").items, { "เงินเดือน": 30000, "เบิกเงินล่วงหน้า": 5000, "ค่าเดินทางตามจริง": 1200, "ลา": -500 }, "เก็บยอดทีละคอลัมน์ · ลาเป็นค่าลบ");
eq([y0.rows.get("AKR2").inc401, y0.rows.get("AKR2").sev, y0.rows.get("AKR2").items[T.UNEXPLAINED]], [20100, 100000, 100], "เงินชดเชย → ข้อ 6 · ส่วนต่างแยกบรรทัด");
const y1 = T.readPayroll({ S: yx }, { types: { "เบิกเงินล่วงหน้า": "inc", "เงินชดเชย1": "inc", "ค่าเดินทางตามจริง": "inc402" } });
eq(pick(y1.rows.get("AKR1"), "inc401", "inc402"), { inc401: 34500, inc402: 1200 }, "HR ยืนยันประเภทเอง ทับที่ระบบเสนอ");
eq(pick(y1.rows.get("AKR2"), "inc401", "sev"), { inc401: 120100, sev: 0 }, "เงินชดเชยตั้งเป็นข้อ 1 ได้");
T.reType(y1.rows, {}); eq(y1.rows.get("AKR2").sev, 100000, "reType คิดใหม่ไม่ต้องอ่านไฟล์ซ้ำ");
eq(T.colList(y0.cols, { "เงินเดือน": "inc" }).filter(c => c.kind === "col").map(c => [c.col, c.type, c.isNew]).sort(),
   [["ค่าเดินทางตามจริง", "off", true], ["เงินชดเชย1", "sev", true], ["เงินเดือน", "inc", false], ["เบิกเงินล่วงหน้า", "off", true]].sort(), "คอลัมน์ที่ยังไม่ยืนยัน = ใหม่");
eq(["Severance Pay/Advance Notice", "AL & Compensate (Resigned)", "ค่าตอบแทนเลขานุการบริษัท", "ค่าตอบแทนกรรมการ", "เงินจ่ายคืนวันลา", "เบี้ยขยัน"].map(c => T.suggestType(c).type),
   ["sev", "inc", "inc", "inc402", "inc", "inc"], "ระบบเสนอประเภทจากชื่อ");
const xx = [["x"], ["CGM", "Employee No.", "ชื่อ", "นามสกุล", "Join Date", "Salary", "Shift Allowance", "Income", "ERT Training", "Total Income", "PVD", "SSO", "WHT"],
  ["C1", "AKR1", "ก", "ข", 1, 30000, 1000, 31000, 500, 31500, 0, 750, 100]];
const xr = T.readPayroll({ "Salary Final": xx }, { types: { "ERT Training": "off" } });
eq([xr.rows.get("AKR1").inc401, xr.rows.get("AKR1").items], [31000, { Salary: 30000, "Shift Allowance": 1000, "ERT Training": 500 }], "Excel: ไม่นับคอลัมน์ Income (ยอดย่อย) ซ้ำ");
// กระทบยอดแยกประเภท: ยอดรวมตรงแต่ยื่นเป็นเงินออกจากงาน
const rcT = T.reconcileMonth([{ emp_code: "A", inc401: 100, sev: 0, inc402: 0, tax: 1, sev_tax: 0 }], [{ emp_code: "A", type: "3", income: 100, tax: 1 }]);
eq(rcT.issues.map(i => i.kind), ["type"], "ภ.ง.ด.1 ประเภทเงินได้ไม่ตรง");

// ภ.ง.ด.1 แบบ Excel ของกรมสรรพากร (user 2026-11-16): ปี พ.ศ. ในเซลล์วันที่ · รหัส 401N/402I · หลายชุดต่อเดือน
const serial = (y, m, d) => (Date.UTC(y, m - 1, d) / 864e5) + 25569;
const px = [["ลำดับ", "บัตร ปชช", "คำหน้า", "ชื่อ ", "สกุล", "เงินได้ตามมาตรา", "วันเดือนปีที่จ่าย", "เงินได้", "ภาษี", "เงื่อนไข"],
  [1, "0991007801192", "นาย", "รอส", "สมิธ", "401N", serial(2569, 2, 13), 320000, 43000, 1],
  [2, 3529900306155, "นาง", "ณุชรีย์", "ไศละสูต", "402I", "13/02/2569", 160000, 1600, 1], [null, "รวม", null, null, null, null, null, 480000, 44600]];
const pr = T.parsePndSheet(px);
eq([pr.months, pr.rows.map(r => [r.tax_id, r.type, r.ym, r.income])], [["2026-02"], [["0991007801192", "1", "2026-02", 320000], ["3529900306155", "4", "2026-02", 160000]]], "อ่าน ภ.ง.ด.1 Excel");
eq([T.pndCode("401N").type, T.pndCode("402E").type, T.pndCode("3").type, T.pndCode("401X").known, T.pndCode("4012").type], ["1", "5", "3", false, "3"], "รหัสประเภทเงินได้");
eq(["PND1 February 2026 Directors 1.xlsx", "PND1 January 2026 Staff.xlsx", "ยื่นเพิ่มเติม ก.พ.xlsx"].map(T.guessPart), ["กรรมการ", "พนักงาน", "ยื่นเพิ่มเติม"], "เดาชุดที่ยื่นจากชื่อไฟล์");
// ชื่อคอลัมน์ต่างแหล่งที่เป็นรายการเดียวกัน → บรรทัดเดียวในหน้าจัดประเภท
eq(["Salary","เงินเดือน","OT","โอที 1.5","โอที 3","Transportion Allowance","เงินทดแทนการจัดรถรับส่ง","Shift Allowance","ค่ากะ","ERT Training","ค่าฝึกอบรม ERT","AL & Compensate (Resigned)","เงินจ่ายคืนวันลา","Severance Pay/Advance Notice","เงินชดเชย1","ค่าตอบแทนเลขานุการบริษัท","รายได้อื่นๆ"].map(T.groupOf),
  ["เงินเดือน / Salary","เงินเดือน / Salary","ค่าล่วงเวลา / OT","ค่าล่วงเวลา / OT","ค่าล่วงเวลา / OT","ค่ารถรับส่ง / Transportation","ค่ารถรับส่ง / Transportation","ค่ากะ / Shift Allowance","ค่ากะ / Shift Allowance","ค่าฝึกอบรม ERT / ERT Training","ค่าฝึกอบรม ERT / ERT Training","เงินคืนวันลา / AL & Compensate","เงินคืนวันลา / AL & Compensate","เงินชดเชย / Severance Pay","เงินชดเชย / Severance Pay","ค่าตอบแทนเลขานุการบริษัท","รายได้อื่นๆ"], "groupOf");

// ภ.ง.ด.1 แบบ CSV (ค่าเป็นข้อความทั้งหมด · วันที่ พ.ศ.)
{ const r = T.parsePndSheet([["ลำดับ","บัตร ปชช","คำหน้า","ชื่อ ","สกุล","เงินได้ตามมาตรา","วันเดือนปีที่จ่าย","เงินได้","ภาษี","เงื่อนไข",""],
    ["1","1234567890121","นาย","ก","ข","401N","14/08/2569","320000","43000","1",""]]);
  eq([r.months, r.rows.map(x => [x.tax_id, x.first, x.type, x.income, x.tax])], [["2026-08"], [["1234567890121","ก","1",320000,43000]]], "parsePndSheet csv"); }

console.log(F ? `ไม่ผ่าน ${F} / ${P + F}` : `ผ่านทั้งหมด ${P} เคส`);
