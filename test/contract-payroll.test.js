// เทสการคำนวณค่าจ้างเหมา — ดึง calcItem/runTotals จริงจาก js/contract-payroll.js
// รัน:  osascript -l JavaScript test/contract-payroll.test.js
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const src  = read('js/contract-payroll.js');
const body = src.slice(src.indexOf('const round2 ='), src.indexOf('// ---------------------------------------------------------------------------\n// state'))
  .replace(/^export /gm, '');
const { calcItem, runTotals, recurringFor, adjustFromRecurring } = new Function(`${body}; return { calcItem, runTotals, recurringFor, adjustFromRecurring };`)();

let P=0,F=0;
const t=(n,got,want)=>{ if(JSON.stringify(got)===JSON.stringify(want)) P++;
  else { F++; console.log(`FAIL · ${n}\n   got =${JSON.stringify(got)}\n   want=${JSON.stringify(want)}`);} };
const W = (rate, apply=true, pct=3) => ({ monthly_rate:rate, wht_apply:apply, wht_percent:pct });

// ===== ตัวเลขจริงจาก Payroll Report ส.ค. 2569 (ยืนยันแล้วว่าหัก 3% เป๊ะ) =====
t("Administration ที่ปรึกษา 46,550 → ภาษี 1,396.50", calcItem(W(46550)).wht_amount, 1396.50);
t("Mining 75,000 → 2,250",            calcItem(W(75000)).wht_amount, 2250);
t("Communications 15,000 → 450",      calcItem(W(15000)).wht_amount, 450);
t("CRD ที่ปรึกษา 60,000 → 1,800",     calcItem(W(60000)).wht_amount, 1800);
t("Regulatory 27,000 → 810",          calcItem(W(27000)).wht_amount, 810);
t("BKK Office 150,000 → 4,500",       calcItem(W(150000)).wht_amount, 4500);
t("Supply ลูกจ้างชั่วคราว 20,618.56 → 618.56", calcItem(W(20618.56)).wht_amount, 618.56);

// CRD ลูกจ้างชั่วคราว 55,218.75 ไม่ถูกหัก (ต่างจาก Supply) — ต้องปิดเป็นรายคนได้
t("ปิดหักภาษีรายคน → ภาษี 0", calcItem(W(55218.75, false)).wht_amount, 0);
t("ปิดหักภาษี สุทธิ = ยอดเต็ม", calcItem(W(55218.75, false)).net_amount, 55218.75);

// ===== ยอดสุทธิ =====
t("สุทธิ = จ้าง − ภาษี", calcItem(W(50000)).net_amount, 48500);

// ===== รายการครั้งเดียว =====
const bonus = [{kind:"earning", amount:10000, taxable:true}];
t("โบนัสเข้าฐานภาษี → ภาษี 3% ของ 60,000", calcItem(W(50000), bonus).wht_amount, 1800);
t("โบนัสเข้าสุทธิ", calcItem(W(50000), bonus).net_amount, 58200);

const reimburse = [{kind:"earning", amount:10000, taxable:false}];
t("เบิกคืนไม่เข้าฐานภาษี → ภาษียังเท่าเดิม", calcItem(W(50000), reimburse).wht_amount, 1500);
t("เบิกคืนยังเข้าสุทธิ", calcItem(W(50000), reimburse).net_amount, 58500);

const fine = [{kind:"deduction", amount:2000}];
t("รายการหักไม่ลดฐานภาษี", calcItem(W(50000), fine).wht_amount, 1500);
t("รายการหักลดยอดสุทธิ",   calcItem(W(50000), fine).net_amount, 46500);

const mixed = [{kind:"earning",amount:10000,taxable:true},
               {kind:"earning",amount:5000,taxable:false},
               {kind:"deduction",amount:3000}];
const m = calcItem(W(50000), mixed);
t("ผสม: ฐานภาษี = 50,000+10,000 → 1,800", m.wht_amount, 1800);
t("ผสม: ได้เพิ่มรวม 15,000", m.extra_amount, 15000);
t("ผสม: หัก 3,000", m.deduct_amount, 3000);
t("ผสม: สุทธิ 50,000+15,000−1,800−3,000", m.net_amount, 60200);

// ===== รายหักที่ลดฐานภาษี (หักขาดงาน) =====
const absent = [{kind:"deduction", amount:5000, cuts_tax_base:true}];
t("หักขาดงานลดฐานภาษี → 3% ของ 45,000", calcItem(W(50000), absent).wht_amount, 1350);
t("หักขาดงาน: สุทธิ 50,000−1,350−5,000", calcItem(W(50000), absent).net_amount, 43650);
t("ฐานภาษีเก็บไว้ในผล", calcItem(W(50000), absent).tax_base, 45000);
t("ฐานภาษีไม่ติดลบ", calcItem(W(1000), [{kind:"deduction", amount:5000, cuts_tax_base:true}]).tax_base, 0);
t("รายการหักแบบเก่า (ไม่มีธง) ไม่ลดฐาน", calcItem(W(50000), [{kind:"deduction", amount:2000, taxable:true}]).wht_amount, 1500);

// ===== รายการประจำ =====
const rec = [{id:1, worker_id:9, amount:3000, start_period:"2026-09", end_period:"2026-12", is_active:true},
             {id:2, worker_id:9, amount:500,  start_period:"2026-11", end_period:null,      is_active:true},
             {id:3, worker_id:9, amount:700,  start_period:"2026-01", end_period:null,      is_active:false}];
t("ประจำ: ก.ย. ได้เฉพาะรายการที่เริ่มแล้ว", recurringFor(rec, "2026-09").map(i=>i.id), [1]);
t("ประจำ: พ.ย. ได้ทั้งสอง", recurringFor(rec, "2026-11").map(i=>i.id), [1,2]);
t("ประจำ: ม.ค. ปีหน้า รายการที่หมดแล้วไม่มา", recurringFor(rec, "2027-01").map(i=>i.id), [2]);
t("ประจำ: ปิดใช้งานไม่มา", recurringFor(rec, "2026-06").map(i=>i.id), []);
const led = adjustFromRecurring(rec[0], {id:7, kind:"deduction", name_th:"บังคับคดี (LED)", tax_effect:false}, 55);
t("ประจำ→งวด: บังคับคดี", [led.kind, led.label, led.amount, led.source, led.cuts_tax_base, led.run_id], ["deduction","บังคับคดี (LED)",3000,"recurring",false,55]);
const ot = adjustFromRecurring(rec[1], {id:8, kind:"earning", name_th:"ค่าเดินทาง", tax_effect:true}, 55);
t("ประจำ→งวด: รายได้เข้าฐานภาษี", [ot.taxable, ot.cuts_tax_base], [true, false]);
const re = adjustFromRecurring(rec[1], {id:8, kind:"earning", name_th:"เบิกคืน", tax_effect:false}, 55);
t("ประจำ→งวด: เบิกคืนไม่เข้าฐาน", calcItem(W(50000), [re]).wht_amount, 1500);
const ab = adjustFromRecurring(rec[1], {id:8, kind:"deduction", name_th:"หักขาดงาน", tax_effect:true}, 55);
t("ประจำ→งวด: หักขาดงานลดฐาน", calcItem(W(50000), [ab]).wht_amount, 1485);

// ===== ปัดเศษ =====
t("ปัด 2 ตำแหน่ง", calcItem(W(33333.33)).wht_amount, 1000);
t("ไม่มีทศนิยมลอย", Number.isInteger(calcItem(W(10000)).wht_amount * 100), true);

// ===== รวมทั้งงวด =====
const its = [calcItem(W(46550)), calcItem(W(75000)), calcItem(W(20618.56))];
const tot = runTotals(its);
t("รวมงวด: จำนวนคน", tot.count, 3);
t("รวมงวด: ยอดจ้าง", tot.base, 142168.56);
t("รวมงวด: ภาษีรวม", tot.wht, 4265.06);
t("รวมงวด: สุทธิ = จ้าง − ภาษี", tot.net, Math.round((142168.56-4265.06)*100)/100);
t("งวดว่าง", runTotals([]).count, 0);

console.log(F ? `ไม่ผ่าน ${F} เคส (ผ่าน ${P})` : `ผ่านทั้งหมด ${P} เคส`);

// ===== จำนวนเงินเป็นตัวหนังสือ (ใช้ใน 50 ทวิ) =====
const dsrc = read('js/contract-docs.js');
const dbody = dsrc.slice(dsrc.indexOf('export function bahtText'), dsrc.indexOf('const CSS =')).replace(/^export /gm,'');
const { bahtText } = new Function(`${dbody}; return { bahtText };`)();
t("ศูนย์",        bahtText(0),        "ศูนย์บาทถ้วน");
t("หนึ่งบาท",     bahtText(1),        "หนึ่งบาทถ้วน");
t("ยี่สิบ",       bahtText(20),       "ยี่สิบบาทถ้วน");
t("ยี่สิบเอ็ด",   bahtText(21),       "ยี่สิบเอ็ดบาทถ้วน");
t("สิบเอ็ด",      bahtText(11),       "สิบเอ็ดบาทถ้วน");
t("หนึ่งร้อย",    bahtText(100),      "หนึ่งร้อยบาทถ้วน");
t("1,800",        bahtText(1800),     "หนึ่งพันแปดร้อยบาทถ้วน");
t("2,250",        bahtText(2250),     "สองพันสองร้อยห้าสิบบาทถ้วน");
t("618.56",       bahtText(618.56),   "หกร้อยสิบแปดบาทห้าสิบหกสตางค์");
t("1,396.50",     bahtText(1396.50),  "หนึ่งพันสามร้อยเก้าสิบหกบาทห้าสิบสตางค์");
t("หนึ่งล้าน",    bahtText(1000000),  "หนึ่งล้านบาทถ้วน");
t("1,234,567",    bahtText(1234567),  "หนึ่งล้านสองแสนสามหมื่นสี่พันห้าร้อยหกสิบเจ็ดบาทถ้วน");
console.log(F ? `ไม่ผ่าน ${F} เคส (ผ่าน ${P})` : `ผ่านทั้งหมด ${P} เคส`);
