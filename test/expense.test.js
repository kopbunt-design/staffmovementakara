// เทส HR Invoice Hub — ดึงฟังก์ชันจริงจาก expense/calc.js · ข้อมูลสมมติล้วน
// รัน:  osascript -l JavaScript test/expense.test.js
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;
const src = read(`${ROOT}/expense/calc.js`).replace(/^export /gm, "");
const M = new Function(`${src}; return { round2, lineCalc, invoiceTotals, fiscalYear, amountWords, inferWhtRate, parseInvoiceDb };`)();
let P = 0, F = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) === JSON.stringify(b)) P++; else { F++; console.log("FAIL " + m + "\n  got =" + JSON.stringify(a) + "\n  want=" + JSON.stringify(b)); } };

// ยอดต่อบรรทัด: VAT จากจำนวนเงิน · หัก ณ ที่จ่ายจากจำนวนเงินก่อน VAT
eq(M.lineCalc({ amount: 10000, vat_rate: 7 }, 3), { amount: 10000, vat: 700, wht: 300, net: 10400 }, "VAT 7% + WHT 3%");
eq(M.lineCalc({ amount: 10000, vat_rate: 0 }, 3), { amount: 10000, vat: 0, wht: 300, net: 9700 }, "ไม่มี VAT");
eq(M.lineCalc({ amount: 10000, vat_rate: 7 }, 5), { amount: 10000, vat: 700, wht: 500, net: 10200 }, "WHT 5%");
eq(M.lineCalc({ amount: 1234.55, vat_rate: 7 }, 3), { amount: 1234.55, vat: 86.42, wht: 37.04, net: 1283.93 }, "ปัด 2 ตำแหน่งต่อบรรทัด");
eq(M.lineCalc({ amount: 5000, vat_rate: 0 }, 0), { amount: 5000, vat: 0, wht: 0, net: 5000 }, "ไม่มีภาษี (เช่นเงินช่วยงานศพ)");
eq(M.invoiceTotals([{ amount: 10000, vat_rate: 7 }, { amount: 1234.55, vat_rate: 7 }], 3), { amount: 11234.55, vat: 786.42, wht: 337.04, net: 11683.93 }, "รวมทั้งใบ = ผลรวมของบรรทัดที่ปัดแล้ว");

// ปีงบ ก.ค.–มิ.ย.
eq(M.fiscalYear("2026-06-30"), 2026, "มิ.ย. 2026 = FY2026");
eq(M.fiscalYear("2026-07-01"), 2027, "ก.ค. 2026 = FY2027");

// ตัวอักษร (รูปแบบเดียวกับใบเดิม)
eq(M.amountWords(44075.2), "Forty Four Thousand Seventy Five Baht and Twenty Satang Only", "มีสตางค์");
eq(M.amountWords(68550), "Sixty Eight Thousand Five Hundred Fifty Baht Only", "จำนวนเต็ม");
eq(M.amountWords(1000000), "One Million Baht Only", "ล้าน");
eq(M.amountWords(0.5), "Fifty Satang Only", "มีแต่สตางค์");
eq(M.amountWords(115), "One Hundred Fifteen Baht Only", "เลขสิบห้า");

// อัตราหัก ณ ที่จ่ายของใบ
eq(M.inferWhtRate(10000, 300), 3, "3%"); eq(M.inferWhtRate(10000, 500), 5, "5%");
eq(M.inferWhtRate(10000, 0), 0, "ไม่หัก"); eq(M.inferWhtRate(1500, 45), 3, "ยอดเล็ก 3%");

// นำเข้า Excel: หัวตารางหาจากชื่อ · รวมบรรทัดเป็นใบ · ผู้ขายที่ไม่มีในชีตเตือน
const vend = [["Vendor List"], [], ["V_Code", "Vendor", "Address", "Bank ", "Column1"], ["X0001", "ร้านทดสอบ", "1 ถนนทดสอบ", "TEST 123 (สาขาทดสอบ)"], ["X0002", "ผู้รับเงินทดสอบ", "2 หมู่ 3", 0]];
const data = [["Invoice Information"], [null, null, null, null, null, null, null, 999], ["InvAuto", "Invoice No.", "Date", "Category", "V_Code", "Cost Code", "Detail_line 1", "Amount (THB)", "VAT", "WHT", null, "Home No. & Detail_line 2"],
  ["1HRIN001/2025", "HRIN001/2025", 45672, "Canteen", "X0001", 506005051500, "Meal test 1-15", 10000, 700, 300, null, null],
  ["2HRIN001/2025", "HRIN001/2025", 45672, "Canteen", "X0001", 506005051500, "Meal test extra", 2000, 140, 60, null, "บ้านเลขที่ 9"],
  ["1HRIN002/2025", "HRIN002/2025", 45680, "Funeral ", "X0009", "506005051050", "Funeral grant test", 5000, 0, 0, null, null],
  ["", "รวม", null, null, null, null, null, 1, 0, 0]];
const r = M.parseInvoiceDb(vend, data);
eq(r.vendors.length, 2, "ผู้ขาย 2 ราย"); eq(r.vendors[1].bank, null, "บัญชีเป็น 0 = ไม่มี");
eq(r.invoices.length, 2, "2 ใบ (แถวไม่ใช่เลข HRIN ถูกข้าม)");
eq(r.invoices[0].lines.length, 2, "ใบแรกมี 2 บรรทัด");
eq(r.invoices[0].inv_date, "2025-01-15", "วันที่จากเลข serial ของ Excel");
eq(r.invoices[0].wht_rate, 3, "อัตราหักของใบ");
eq(r.invoices[0].lines[0].cost_code, "506005051500", "รหัสบัญชีตัวเลขยาวไม่เพี้ยน");
eq(r.invoices[0].lines[1].detail2, "บ้านเลขที่ 9", "รายละเอียดบรรทัด 2");
eq(r.invoices[1].category, "Funeral", "ตัดช่องว่างท้ายชื่อหมวด");
eq(r.categories, ["Canteen", "Funeral"], "หมวดไม่ซ้ำ");
eq(r.warn.some(w => w.includes("X0009")), true, "เตือนรหัสผู้ขายที่ไม่มีในชีต");

// ใบ A4 แบ่งหน้า: หน้าละไม่เกิน 10 รายการ เฉลี่ยเท่า ๆ กัน · ยอดรวม + ลายเซ็นอยู่หน้าสุดท้ายเท่านั้น (doc.js)
const dsrc = read(`${ROOT}/expense/doc.js`);
const pg = new Function(dsrc.match(/export const PER_PAGE[^\n]*\n/)[0].replace("export ", "") + dsrc.match(/export function paginate[\s\S]*?\n}\n/)[0].replace("export ", "") + "return paginate;")();
const sizes = n => pg(Array.from({ length: n }, (_, i) => i)).map(p => p.length);
eq(sizes(0), [0], "ไม่มีรายการ = 1 หน้า"); eq(sizes(1), [1], "1 รายการ"); eq(sizes(10), [10], "10 รายการ จบหน้าเดียว");
eq(sizes(11), [6, 5], "11 → 6+5"); eq(sizes(12), [6, 6], "12 → 6+6"); eq(sizes(15), [8, 7], "15 → 8+7");
eq(sizes(20), [10, 10], "20 → 10+10"); eq(sizes(21), [7, 7, 7], "21 → 7+7+7");
eq(pg(Array.from({ length: 23 }, (_, i) => i)).flat(), Array.from({ length: 23 }, (_, i) => i), "ไม่มีรายการหาย/สลับลำดับ");
eq((dsrc.match(/\$\{last \? end : ""\}/g) || []).length, 1, "ยอดรวม + ลายเซ็นพิมพ์เฉพาะหน้าสุดท้าย");
console.log(F === 0 ? `ผ่านทั้งหมด ${P} เคส` : `ผ่าน ${P} · ตก ${F}`);
