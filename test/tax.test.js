// เทสทะเบียนรายได้และภาษี — ดึงฟังก์ชันจริงจาก js/tax-calc.js · ข้อมูลสมมติ
// รัน:  osascript -l JavaScript test/tax.test.js
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;
const src = read(`${ROOT}/js/tax-calc.js`).replace(/^export /gm, "");
const T = new Function(`${src}; return { readPayroll, parsePnd, validTaxId, matchPnd, yearTotals, reconcileMonth, certStale, certChecks, leaverAlerts, pnd1kRows, bahtText, income, taxAll };`)();
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
console.log(F ? `ไม่ผ่าน ${F} / ${P + F}` : `ผ่านทั้งหมด ${P} เคส`);
