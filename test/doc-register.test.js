// เทสตัวอ่านไฟล์ "01 ลำดับเอกสาร HR.xlsx" เดิม — ดึงฟังก์ชันจริงจาก js/doc-register.js
// รัน:  osascript -l JavaScript test/doc-register.test.js
// ⚠️ ข้อมูลสมมติล้วน (ชื่อในเทสไม่ใช่ของใคร)
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;
const SRC = read(`${ROOT}/js/doc-register.js`).split("\n").filter(l => !/^\s*import\s/.test(l)).join("\n").replace(/^export /gm, "");
const M = new Function(`${SRC}\nreturn { parseLogDate, mapDocType, parseDocLog };`)();

let P = 0, F = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) === JSON.stringify(b)) P++; else { F++; console.log("FAIL " + m + "\n  got =" + JSON.stringify(a) + "\n  want=" + JSON.stringify(b)); } };

// ---------- วันที่หลายรูปแบบในไฟล์เดิม ----------
eq(M.parseLogDate("6 กุมภาพันธ์ 2568"), "2025-02-06", "วันที่ภาษาไทย พ.ศ.");
eq(M.parseLogDate(46294), "2026-09-29", "เลข serial ของ Excel (number) — 45658 = 1 ม.ค. 2025");
eq(M.parseLogDate("46295"), "2026-09-30", "เลข serial ที่เป็นข้อความ");
eq(M.parseLogDate("16/1/2026"), "2026-01-16", "d/m/yyyy");
eq(M.parseLogDate("16/16/2026"), null, "เดือน 16 ไม่มีจริง → null ไม่เดา");
eq(M.parseLogDate("31 กุมภาพันธ์ 2568"), null, "31 ก.พ. ไม่มีจริง");
eq(M.parseLogDate(""), null, "ว่าง");

// ---------- ประเภท ----------
eq(M.mapDocType("หนังสือรับรองการทำงาน (ภาษาอังกฤษ)"), "หนังสือรับรองการทำงาน (ภาษาอังกฤษ)", "รับรองการทำงาน EN");
eq(M.mapDocType("หนังสือรับรองการทำงาน "), "หนังสือรับรองการทำงาน (ภาษาไทย)", "ไม่ระบุภาษา = ไทย");
eq(M.mapDocType("หนังสือรับรองเงินเดือน (ทดสอบ หนึ่ง)"), "หนังสือรับรองเงินเดือน (ภาษาไทย)", "มีชื่อในวงเล็บ ไม่ใช่ภาษา");
eq(M.mapDocType("Offer Letter"), "Offer Letter (จดหมายจ้างงาน)", "Offer");
eq(M.mapDocType("Terminate"), "หนังสือเลิกจ้าง (Terminate)", "Terminate");
eq(M.mapDocType("ปรับตำแหน่ง 38"), "หนังสือปรับตำแหน่ง", "ปรับตำแหน่ง");
eq(M.mapDocType("ปรับเงิน 26"), "หนังสือปรับเงินเดือน", "ปรับเงิน");
eq(M.mapDocType("แจ้งผลนักศึกษาฝึกงาน คณะทดสอบ"), "แจ้งผลนักศึกษาฝึกงาน", "ฝึกงาน");
eq(M.mapDocType("แก้ไขรายงานค่าจ้างประจำปี"), "อื่น ๆ", "อื่น ๆ");

// ---------- ทั้งไฟล์ ----------
const HR = [
  ["ทะเบียนควบคุมเลขที่หนังสือ ฝ่ายทรัพยากรบุคคล (HR Document Control Log)"],
  ["รหัส","เลขที่","ปี","เลขที่เอกสาร","รายละเอียดของเอกสาร","ชื่อ","นามสกุล","วันที่ออกเอกสาร","","เลขที่เอกสารอ้างอิง","รายละเอียด","วันที่"],
  ["HR","001","2025","HR-001-2025","หนังสือรับรองเงินเดือน","สมมติ","หนึ่ง","6 กุมภาพันธ์ 2568","","","",""],
  ["HR","002","2025","HR-002-2025","หนังสือรับรองการทำงาน (ทดสอบ สอง)","","",46294,"","","",""],
  ["HR","018","2025","HR-018-2025","แจ้งผลนักศึกษาฝึกงาน วิทยาลัยทดสอบ","","","24 กุมภาพันธ์ 2568","","HR-018-2025","แจ้งผลนักศึกษา วิทยาลัยทดสอบ","24 กุมภาพันธ์ 2568"],
  ["HR","(96-98)","2025","HR-(96-98)-2025","ปรับตำแหน่ง 3","","","","","","",""],
  ["HR","099","2025","HR-099-2025","","","","","","","",""],
  ["HR","114","2026","HR-114-2026","Offer Letter","","","16/16/2026","","","",""],
];
const Memo = [["Memo","HR","001","2026","Memo-HR-001-2026","ปรับ Job Level ตำแหน่งทดสอบ"], ["Memo","HR","002","2026","Memo-HR-002-2026"]];
const r = M.parseDocLog({ HR, Memo });
eq(r.rows.map(x => `${x.series_code}-${x.seq}-${x.year}`), ["HR-1-2025","HR-2-2025","HR-18-2025","HR-96-2025","HR-97-2025","HR-98-2025","HR-114-2026","MEMO-1-2026"],
   "แถวที่ใช้แล้วทั้งหมด · ช่วง (96-98) ขยายเป็น 3 เลข · เลขว่างและ Memo ว่างข้าม");
eq([r.rows[0].person_name, r.rows[0].subject, r.rows[0].issued_date], ["สมมติ หนึ่ง", "", "2025-02-06"], "ชื่อจากคอลัมน์ · หัวเรื่องซ้ำประเภทไม่เก็บซ้ำ");
eq([r.rows[1].person_name, r.rows[1].issued_date], ["ทดสอบ สอง", "2026-09-29"], "ไม่มีชื่อในคอลัมน์ → เอาจากวงเล็บ");
eq([r.rows[2].ref_doc_no, r.rows[2].note.startsWith("อ้างอิง:")], ["HR-018-2025", true], "เลขอ้างอิง + รายละเอียดอ้างอิงลงหมายเหตุ");
eq(r.rows[3].note.includes("96–98"), true, "เลขในช่วงจดว่าออกเป็นชุด");
eq([r.rows[6].issued_date, r.rows[6].note], ["", "วันที่ในไฟล์เดิม: 16/16/2026"], "วันที่ผิด → เว้นว่าง เก็บข้อความเดิมไว้");
eq([r.rows[7].type_label, r.rows[7].subject], ["บันทึกภายใน", "ปรับ Job Level ตำแหน่งทดสอบ"], "Memo");
eq(r.skipped, [], "ไม่มีแถวที่อ่านไม่ออก");

console.log(F === 0 ? `ผ่านทั้งหมด ${P} เคส` : `ผ่าน ${P} · ตก ${F}`);
