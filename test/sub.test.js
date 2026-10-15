// เทสทะเบียนผู้รับเหมา (SUB) — ดึงฟังก์ชันจริงจาก js/sub-calc.js · ข้อมูลสมมติล้วน
// รัน:  osascript -l JavaScript test/sub.test.js
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;
const M = new Function(read(`${ROOT}/js/sub-calc.js`).replace(/^export /gm, "") + "; return { normTitle, noteFlags, parseSheet, pickLatest, diffImport, monthly, expiring, activeAt };")();
let P = 0, F = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) === JSON.stringify(b)) P++; else { F++; console.log("FAIL " + m + "\n  got =" + JSON.stringify(a) + "\n  want=" + JSON.stringify(b)); } };

eq(["Mr", "Mr.", "Miss.", "Mrss.", "Ms", ""].map(M.normTitle), ["Mr.", "Mr.", "Miss", "Mrs.", "Ms.", ""], "คำนำหน้าเขียนหลายแบบ → แบบเดียว");
eq([M.noteFlags("ออกแล้ว").left, M.noteFlags("ลาออก").left, M.noteFlags("Former Employee – Training Card Returned").left, M.noteFlags("Active Employee – Training Card Active (x)").left,
    M.noteFlags("", "ได้พ้นสภาพจากการเป็นพนักงาน").left, M.noteFlags("", "0012345678").left], [true, true, true, false, true, false], "หมายเหตุ/ช่องเลขบัตร → ออกแล้ว");
eq([M.noteFlags("ชาวต่างชาติ").foreign, M.noteFlags("KM.20").area, M.noteFlags("km 20").area, M.noteFlags("HQ").area, M.noteFlags("ซ้ำ").dup], [true, "KM.20", "KM.20", "HQ", true], "สัญชาติ/พื้นที่/ซ้ำ");

const HEAD = ["No.", "SUB No.", "AC NO.", "Card Back Number", "Title", "Name", "Surname", "Company", "หมู่", "ตำบล", "อำเภอ", "จังหวัด", "หมายเหตุ"];
const rows = [HEAD,
  ["1", "sub0001", "1234", "0011111111", "Mr", "Somchai", "Test", "Alpha", "3", "A", "B", "C", ""],
  ["2", "SUB0002", "1235", "0022222222", "Miss.", "Suda", "Test", "Beta", "", "", "", "", "ออก"],
  ["3", "SUB0003", "1236", "0033333333", "Mr.", "John", "Doe", "Alpha Team X", "", "", "", "", "ชาวต่างชาติ"],
  ["4", "SUB0004", "1237", "0044444444", "Mrs", "Malee", "Test", "ALPHA CO., LTD.", "", "", "", "", "KM.20"],
  [null, null, "", "", "", "", "", "Alpha Night Team"],
  ["", "", "", "", "", "", "", "", ""]];
const p = M.parseSheet(rows, "Alpha", ["Alpha", "Beta"]);
eq(p.rows.length, 4, "4 คน (แถวคั่นกลุ่มและแถวว่างไม่นับ)");
eq(p.rows.map(r => [r.sub_no, r.title, r.company, r.status, r.nationality, r.team, r.area, r.legal_name]), [
  ["SUB0001", "Mr.", "Alpha", "active", "Thai", null, null, null],
  ["SUB0002", "Miss", "Beta", "left", "Thai", null, null, null],
  ["SUB0003", "Mr.", "Alpha", "active", "Foreign", "Team X", null, null],
  ["SUB0004", "Mrs.", "Alpha", "active", "Thai", null, "KM.20", "ALPHA CO., LTD."]], "อ่านแถว: บริษัทอื่น/ทีม/ชื่อเต็ม/สถานะ");
eq(p.rows[1].movedFrom, "Alpha", "ช่อง Company เป็นบริษัทอื่น = บอกว่ามาจากโฟลเดอร์ไหน");
eq(M.parseSheet([["a", "b"]], "X").error, "ไม่พบหัวตาราง (SUB No. / Name)", "ไม่มีหัวตาราง");

eq(M.pickLatest([{ path: "SUB/Alpha/a.xlsx", lastModified: 1 }, { path: "SUB/Alpha/Copy of a.xlsx", lastModified: 5 }, { path: "SUB/Alpha/~$a.xlsx", lastModified: 9 },
  { path: "SUB/Beta/b.xlsx", lastModified: 2 }, { path: "SUB/Beta/note.txt", lastModified: 9 }]).map(x => [x.folder, x.file.path]),
  [["Alpha", "SUB/Alpha/Copy of a.xlsx"], ["Beta", "SUB/Beta/b.xlsx"]], "ไฟล์ล่าสุดของแต่ละโฟลเดอร์ (ไม่เอาไฟล์ล็อก ~$)");

const ids = { Alpha: 1, Beta: 2 }, cid = n => ids[n];
const existing = [{ id: 10, company_id: 1, sub_no: "SUB0001", first_name: "Somchai", last_name: "Test", ac_no: "9999", status: "active", nationality: "Thai" },
  { id: 11, company_id: 2, sub_no: "SUB0002", first_name: "Suda", last_name: "Test", status: "active", nationality: "Thai" },
  { id: 12, company_id: 1, sub_no: null, first_name: "Old", last_name: "Person", status: "active" }];
const d = M.diffImport(existing, p.rows, cid);
eq([d.add.map(r => r.sub_no), d.update.map(u => [u.id, u.changes]), d.missing.map(w => w.id)],
  [["SUB0003", "SUB0004"], [[10, { ac_no: "1234", card_no: "0011111111", title: "Mr.", village: "3", subdistrict: "A", district: "B", province: "C" }], [11, { ac_no: "1235", card_no: "0022222222", title: "Miss", status: "left" }]], [12]],
  "นำเข้าซ้ำ: เพิ่ม/แก้/ไม่อยู่ในไฟล์แล้ว");
eq(M.diffImport([], [p.rows[0], { ...p.rows[0] }], cid).dupInFile.length, 1, "SUB No. ซ้ำในไฟล์");

// รายงานรายเดือน: ต้นเดือน + เข้าใหม่ − ออก = สิ้นเดือน · ออกวันสุดท้ายของเดือน = นับออกเดือนนั้น
const W = [{ company_id: 1, nationality: "Thai" }, { company_id: 1, start_date: "2026-10-05", nationality: "Foreign" },
  { company_id: 1, left_on: "2026-10-31", nationality: "Thai" }, { company_id: 1, left_on: "2026-11-01", nationality: "Thai" },
  { company_id: 1, start_date: "2026-10-03", left_on: "2026-10-20", nationality: "Thai" }, { company_id: 2, start_date: "2026-11-01", nationality: "Thai" }];
const r = M.monthly(W, [{ id: 1, name: "Alpha" }, { id: 2, name: "Beta" }], "2026-10");
eq(r.rows.map(x => [x.name, x.opening, x.joined, x.left, x.ending, x.thai, x.foreign]), [["Alpha", 3, 2, 2, 3, 2, 1]], "ต.ค.: ต้นเดือน 3 + เข้า 2 − ออก 2 = 3 · บริษัทที่ไม่มีคนไม่ขึ้น");
eq(r.total.opening + r.total.joined - r.total.left, r.total.ending, "ยอดสมดุล");

eq(M.expiring({ status: "active", card_expiry: "2026-11-01", induction_expiry: "2027-06-01", medical_expiry: "2026-10-01", licenses: [{ name: "ปั้นจั่น", expiry: "2026-10-20" }] }, "2026-10-15").map(x => [x.label, x.left]),
  [["ใบรับรองแพทย์", -14], ["ปั้นจั่น", 5], ["บัตรเข้าพื้นที่", 17]], "เอกสารหมด/ใกล้หมด เรียงจากด่วนสุด");
eq(M.expiring({ status: "left", card_expiry: "2026-10-01" }, "2026-10-15"), [], "คนออกแล้วไม่เตือน");

console.log(F === 0 ? `ผ่านทั้งหมด ${P} เคส` : `ผ่าน ${P} · ตก ${F}`);
