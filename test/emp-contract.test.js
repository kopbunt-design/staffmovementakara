// เทสสัญญาจ้างงาน — ดึงฟังก์ชันจริงจาก js/emp-contract-doc.js (+ bahtText จาก contract-calc.js) · ข้อมูลสมมติล้วน
// รัน:  osascript -l JavaScript test/emp-contract.test.js
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;
const strip = s => s.replace(/^import[^;]*;/gm, "").replace(/^export /gm, "");
const calc = strip(read(`${ROOT}/js/contract-calc.js`));
const M = new Function(`${calc}\n${strip(read(`${ROOT}/js/emp-contract-doc.js`))}; return { probationEnd, idValid, parseIdCard, contractHTML, fill, thLong, LOC };`)();
let P = 0, F = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) === JSON.stringify(b)) P++; else { F++; console.log("FAIL " + m + "\n  got =" + JSON.stringify(a) + "\n  want=" + JSON.stringify(b)); } };
const has = (s, x, m) => eq(s.includes(x), true, m);

eq(M.probationEnd("2026-09-14"), "2027-01-10", "ทดลองงานถึงวันที่ 119 (ตรงกับสัญญาตัวอย่าง 14 ก.ย. 69 → 10 ม.ค. 70)");
eq(M.thLong("2027-01-10"), "10 มกราคม 2570", "วันที่ไทยเต็ม");
// เลขสมมติ: 12 หลักแรก 110000000000 → เลขตรวจสอบ
const base = "110000000000"; let sum = 0; for (let i = 0; i < 12; i++) sum += +base[i] * (13 - i); const good = base + ((11 - sum % 11) % 10), bad = base + (((11 - sum % 11) % 10 + 1) % 10);
eq([M.idValid(good), M.idValid(bad), M.idValid("123")], [true, false, false], "เลขตรวจสอบบัตรประชาชน");

const ocr = `บัตรประจำตัวประชาชน Thai National ID Card
เลขประจำตัวประชาชน ${good.slice(0, 1)} ${good.slice(1, 5)} ${good.slice(5, 10)} ${good.slice(10, 12)} ${good.slice(12)}
Identification Number
ชื่อตัวและชื่อสกุล นาย ทดสอบ สมมติ
Name Mr. Test
Last name Sample
เกิดวันที่ 7 ม.ค. 2518
Date of Birth 7 Jan. 1975
ศาสนา พุทธ
ที่อยู่ 12/3 หมู่ 4 ต.เขาทราย
อ.ทับคล้อ จ.พิจิตร
1 ก.พ. 2565 วันออกบัตร`;
eq(M.parseIdCard(ocr), { id: good, idOk: true, title_th: "นาย", name_th: "ทดสอบ สมมติ", name_en: "Test Sample", birth_date: "1975-01-07", address: "12/3 หมู่ 4 ต.เขาทราย อ.ทับคล้อ จ.พิจิตร" }, "อ่านข้อความบัตร");
// ข้อความจาก Tesseract จริง (บัตรสมมติ): ป้ายชื่อไทยอ่านเพี้ยน · ำ แยกเป็นนิคหิต+า · วันออกบัตรอยู่ก่อนป้าย
const raw = "บัตรประจ\u0E4D\u0E32ตัวประชาชน Thai National ID Card\n\nเลขประจ\u0E4D\u0E32ตัวประชาชน     1  1000 00000 01  1\nIdentification Number\na ๓     a                           =\nขอตวและชซอสกุล นาย ทดสอบ สมมต\n\nName Mr. Test\n\nLast name Sample\n\nเกิดวันที่ 7 ม.ค. 2518\n\nDate of Birth 7 Jan. 1975\n\nศาสนา พุทธ\nที่อยู่ 12/3 หมู่ 4 ต.เขาทราย\n\nอ.ทับคล้อ จ.พิจิตร\n\n1 n.w. 2565";
const R = M.parseIdCard(raw);
eq([R.id, R.title_th, R.name_th, R.name_en, R.birth_date, R.address], ["1100000000011", "นาย", "ทดสอบ สมมต", "Test Sample", "1975-01-07", "12/3 หมู่ 4 ต.เขาทราย อ.ทับคล้อ จ.พิจิตร"], "ผล OCR จริง: ป้ายเพี้ยนก็ยังได้ชื่อ · ที่อยู่ไม่กินวันออกบัตร");
// PDF สำเนาบัตร (Tesseract จริง): ป้ายที่อยู่อ่านเป็น "fing" → หาจาก ต./อ./จ. แทน
const raw2 = "ชือตัวและชื่อสกุล นาง ใจดี มีสุข\n\nName Mrs. Jaidee\n\nLast name Meesuk\n\nเกิดวันที่ 9 มี.ค. 2530\n\nDate of Birth 9 Mar. 1987\nfing 5 ny 2 ต.ท้ายดง\n\nอ.วังโป่ง จ.เพชรบูรณ์";
const R2 = M.parseIdCard(raw2);
eq([R2.title_th, R2.name_th, R2.name_en, R2.birth_date, R2.address], ["นาง", "ใจดี มีสุข", "Jaidee Meesuk", "1987-03-09", "5 ny 2 ต.ท้ายดง อ.วังโป่ง จ.เพชรบูรณ์"], "ป้ายที่อยู่เพี้ยน → ยังหาที่อยู่เจอ");
eq(M.parseIdCard("เกิดวันที่ 9 มี.ค. 2530\nนางสาว ใจดี มีสุข\n9999 99999 9999").birth_date, "1987-03-09", "วันเกิดภาษาไทย (พ.ศ. → ค.ศ.)");
eq(M.parseIdCard(`${bad}\n${good}`).id, good, "หลายชุดเลข → เลือกชุดที่เลขตรวจสอบถูก");

const d = { location: "bkk", contract_date: "2026-09-14", title_th: "นาย", name_th: "ทดสอบ สมมติ", id_last5: good.slice(-5), address: "12/3 หมู่ 4",
  start_date: "2026-09-14", position_th: "เจ้าหน้าที่", position_en: "Officer", job_level: "S1", salary: 25500 };
const h = M.contractHTML(d, { idFull: good });
has(h, `บัตรประจำตัวประชาชนเลขที่ <span class="v">${good}</span>`, "เลขบัตรเต็มเมื่อพิมพ์ฉบับจริง");
has(h, "25,500 บาท (สองหมื่นห้าพันห้าร้อยบาทถ้วน)", "เงินเดือนพร้อมตัวหนังสือ");
has(h, "8.30 น. – 17.30 น.", "กรุงเทพ: เวลาทำงาน 8.30–17.30");
has(h, "อาคารสปริงทาวเวอร์", "กรุงเทพ: สถานที่ทำงาน");
has(h, "10 มกราคม 2570", "วันสิ้นสุดทดลองงาน");
has(h, "Page 4 of 4", "4 หน้า");
const p = M.contractHTML({ ...d, location: "phichit" });
has(p, "7.30 น. – 17.00 น.", "พิจิตร: เวลาทำงาน 7.30–17.00");
has(p, `xxxxxxxx${good.slice(-5)}`, "ไม่มีเลขเต็ม → แสดงแค่ 5 ตัวท้าย");
eq(M.fill({ location: "phichit", work_hours: "8.00 น. – 17.00 น." }).work_hours, "8.00 น. – 17.00 น.", "แก้เวลาทำงานรายฉบับได้");

console.log(F === 0 ? `ผ่านทั้งหมด ${P} เคส` : `ผ่าน ${P} · ตก ${F}`);
