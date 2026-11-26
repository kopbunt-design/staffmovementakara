// เทส Akara Canteen — ดึงฟังก์ชันจริงจาก js/canteen-calc.js · ข้อมูลสมมติ (รูปแบบไฟล์ตามไฟล์สแกนจริง พ.ย. 2026)
// รัน:  osascript -l JavaScript test/canteen.test.js
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;
const M = new Function(read(`${ROOT}/js/canteen-calc.js`).replace(/^export /gm, "") +
  "; return { boxOfFile, dateOfFile, parseScan, indexPeople, mapCard, resolveCode, unitLines, dayChecks, periodOf, docNo, catOf, lineOf };")();
let P = 0, F = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) === JSON.stringify(b)) P++; else { F++; console.log("FAIL " + m + "\n  got =" + JSON.stringify(a) + "\n  want=" + JSON.stringify(b)); } };

// ---- ชื่อไฟล์ → กล่อง + วันที่
eq(["รายชื่อสแกนบัตร1 Akara 01.11.26.xlsx", "รายชื่อสแกนบัตร2 Akara 02.11.26.xlsx", "รายชื่อสแกนบัตร Chatree North 01.11.26.xlsx",
    "รายชื่อสแกนบัตร 2 Chatree North 02.11.26.xlsx", "อื่น ๆ.xlsx"].map(n => M.boxOfFile(n)), ["A1", "A2", "N1", "N2", null], "กล่องจากชื่อไฟล์");
eq(M.boxOfFile("export.xlsx", "Canteen 2"), "A2", "ชื่อไฟล์ไม่บอก → ดูหัวคอลัมน์ Canteen 2");
eq(["x 01.11.26.xlsx", "x 3.11.2569.xlsx", "x 24-11-2026.xlsx", "ไม่มีวันที่.xlsx", "x 31.13.26.xlsx"].map(M.dateOfFile),
  ["2026-11-01", "2026-11-03", "2026-11-24", null, null], "วันที่จากชื่อไฟล์ (ปี 2 หลัก/พ.ศ./ค.ศ.)");

// ---- อ่านไฟล์: แถวไม่มีรหัส, แถว Total, รหัสซ้ำในไฟล์
const aoa = [["EMP No.", "Name", "Canteen 1"], ["AKR25061290", "Worayod  Reanmee", 1], ["SUB2378", "Worawut Wongkanha", 1],
  ["AKR23020833", "Boonpraserd Srichot", 3], ["TEM294", "TEMPORARY", 1], [null, null, 2], ["akr25061290", "Worayod Reanmee", 1],
  ["Total", null, 129], [null, null, null]];
const s = M.parseScan(aoa, "รายชื่อสแกนบัตร1 Akara 01.11.26.xlsx");
eq([s.box, s.d, s.unknown, s.fileTotal, s.sum], ["A1", "2026-11-01", 2, 129, 9], "หัวไฟล์ + Total ท้ายไฟล์ ≠ ผลรวมจริง");
eq(s.rows.map(r => [r.code, r.name, r.scans]), [["AKR25061290", "Worayod Reanmee", 2], ["SUB2378", "Worawut Wongkanha", 1], ["AKR23020833", "Boonpraserd Srichot", 3], ["TEM294", "TEMPORARY", 1]],
  "รวมรหัสเดียวกัน (ตัวพิมพ์เล็ก/ใหญ่) · ชื่อเว้นวรรคเดียว");
let err = ""; try { M.parseScan([["a", "b"]], "x"); } catch (e) { err = e.message; }
eq(err.includes("EMP No."), true, "ไม่ใช่ไฟล์สแกน");

// ---- ทะเบียน + บัตรรหัสไม่ตรง + ใบลืมบัตรเขียนเลขท้าย
const ix = M.indexPeople([
  { code: "AKR24051167", name: "ใกล้รุ่ง เพ็ชรโพธิ์", name_en: "Klairung Phetpho", kind: "akr" },
  { code: "AKR25101315", name: "วีรภาพ กาวิน", name_en: "Wiraphap Gawin", kind: "akr" },
  { code: "AKR23020861", name: "พงษ์เทพ ชัยชนะ", name_en: "Pongthep Chaichana", kind: "akr" },
  { code: "AKR19010861", name: "คนเก่า ออกแล้ว", name_en: "Old Left", kind: "akr", left: true },
  { code: "SUB1949", name: "Intira Chomwanich", name_en: "Intira Chomwanich", kind: "sub", ac: "9445" },
  { code: "SUB861", name: "Sub Eight", name_en: "Sub Eight", kind: "sub", ac: "7001" }]);
eq(M.mapCard("AKR24051167", "x", ix), { reg: "AKR24051167", how: "code" }, "รหัสตรงทะเบียน");
eq(M.mapCard("AKR25081315", "Wiraphap  Gawin", ix), { reg: "AKR25101315", how: "name" }, "บัตร AKR2508… ทะเบียน AKR2510… → จับด้วยชื่อ");
eq(M.mapCard("SUB9999", "Nobody", ix), { reg: null, how: "none" }, "ไม่อยู่ในทะเบียน");
eq(M.resolveCode("1167", ix).map(p => p.code), ["AKR24051167"], "เขียน 1167 → AKR24051167");
eq(M.resolveCode("861", ix).map(p => p.code), ["AKR23020861", "SUB861", "AKR19010861"], "861 กำกวม → ให้เลือก (คนที่ยังอยู่ก่อน)");
eq(M.resolveCode("SUB861", ix).map(p => p.code), ["SUB861"], "เขียน SUB นำหน้า = เฉพาะ SUB");
eq(M.resolveCode("akr861", ix).map(p => p.code), ["AKR23020861", "AKR19010861"], "AKR นำหน้า = เฉพาะพนักงาน");
eq(M.resolveCode("9445", ix).map(p => p.code), ["SUB1949"], "เลข AC ของ SUB");
eq(M.resolveCode("abc", ix), [], "อ่านไม่ออก");

// ---- บรรทัดในใบ: แตะซ้ำนับตาม billed (ค่าเริ่มต้น 1) · ผู้ติดต่อนับทุกครั้ง · ยกยอด
const meals = [
  { cat: "akr", billed: 1 }, { cat: "akr", billed: 1, dup: "pending", scans: 3 }, { cat: "sub", billed: 1 },
  { cat: "tem", billed: 1 }, { cat: "unk", billed: 2 }, { cat: "forgot", billed: 1 }, { cat: "forgot", billed: 0 }, { cat: "group", billed: 17 }];
const u = M.unitLines(meals, [{ extra: 1 }, { extra: 1 }]);
eq(u.lines.map(l => [l.k, l.n]), [["akr", 2], ["sub", 1], ["forgot", 1], ["visit", 3], ["group", 17], ["carry", 2]], "บรรทัดในใบ");
eq(u.meals, 26, "รวมอิ่ม");
eq(M.unitLines([{ cat: "akr", billed: 5 }]).lines.map(l => l.k), ["akr", "sub"], "บรรทัดที่เป็น 0 ไม่ขึ้น (ยกเว้นสแกนบัตร 2 บรรทัดหลัก)");

// ---- เช็กรายวัน
const day = [
  { d: "2026-11-01", box: "A1", cat: "akr", code: "AKR24051167", reg_code: "AKR24051167", src: "scan", billed: 1 },
  { d: "2026-11-01", box: "A2", cat: "akr", code: "AKR24051167", reg_code: "AKR24051167", src: "scan", billed: 1 },
  { d: "2026-11-01", box: "A1", cat: "akr", code: "AKR25081315", reg_code: "AKR25101315", src: "scan", billed: 1, dup: "pending" },
  { d: "2026-11-01", box: "A1", cat: "sub", code: "SUB9999", reg_code: null, src: "scan", billed: 1 },
  { d: "2026-11-01", box: "A1", cat: "forgot", code: "AKR23020861", reg_code: "AKR23020861", src: "sheet", billed: 1 },
  { d: "2026-11-01", box: "A2", cat: "akr", code: "AKR23020861", reg_code: "AKR23020861", src: "scan", billed: 1 },
  { d: "2026-11-01", box: "A1", cat: "akr", code: "AKR19010861", reg_code: "AKR19010861", src: "scan", billed: 1 }];
const c = M.dayChecks(day, ix, [{ box: "A1", file_total: 129, scans: 128 }, { box: "A2", file_total: 50, scans: 50 }]);
eq([c.dup.length, c.mapped.length, c.notReg.length, c.left.length, c.fileDiff.length], [1, 1, 1, 1, 1], "แตะซ้ำ/บัตรรหัสไม่ตรง/ไม่อยู่ทะเบียน/ออกแล้ว/Total ไม่ตรง");
eq(c.twoBox.map(x => x.reg).sort(), ["AKR23020861", "AKR24051167"], "ทานทั้งกล่อง 1 และ 2 วันเดียวกัน");
eq(c.forgotScanned.map(x => x.reg), ["AKR23020861"], "ลงชื่อลืมบัตรแต่มีสแกนด้วย");

// ---- รอบบิล + เลขที่
eq([M.periodOf("2026-11-01"), M.periodOf("2026-11-15"), M.periodOf("2026-11-16"), M.periodOf("2026-02-20")].map(p => [p.from, p.to]),
  [["2026-11-01", "2026-11-15"], ["2026-11-01", "2026-11-15"], ["2026-11-16", "2026-11-30"], ["2026-02-16", "2026-02-28"]], "รอบบิล 1–15 / 16–สิ้นเดือน");
eq(M.docNo("CTS1", 2026, 328), "CTS12026/328", "เลขที่แบบเดิม (CTS12026/327)");
eq(M.docNo("CTN", 2026, 7), "CTN2026/007", "เลขที่ 3 หลัก");

console.log(F === 0 ? `ผ่านทั้งหมด ${P} เคส` : `ผ่าน ${P} · ตก ${F}`);
