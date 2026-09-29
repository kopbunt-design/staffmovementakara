// เทสการอ่านไฟล์รายชื่อเชิญกรอกแบบฟอร์มกองทุน — ดึงฟังก์ชันจริงจาก js/fund-forms.js
// รัน:  osascript -l JavaScript test/fund-forms.test.js
//
// ⚠️ ข้อมูลสมมติล้วน — เลขบัตรในเทสผ่าน checksum แต่ไม่ใช่ของใคร
// ที่ต้องกันไว้:
//   - คอลัมน์ "เงื่อนไข" ตัดสินว่าใครกรอกฟอร์มไหนได้ ถ้าอ่านสลับ คนที่ยังไม่ผ่านโปรจะสมัครกองทุนสำรองฯ ได้
//   - เลขบัตรเต็มห้ามหลุดออกจากตัวอ่าน — เก็บแค่ 5 ตัวท้าย
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;

const SRC = read(`${ROOT}/js/fund-forms.js`).split("\n").filter(l => !/^\s*import\s/.test(l)).join("\n").replace(/^export /gm, "");
const M = new Function(`${SRC}\nreturn { parseInviteSheet, formsFromCondition };`)();
// หน้าพนักงาน — แค่ตรวจว่า parse ได้ (ไม่มี syntax error)
new Function(read(`${ROOT}/js/fund-public.js`).split("\n").filter(l => !/^\s*import\s/.test(l)).join("\n")
  .replace(/^export /gm, "").replace(/^render\(\);$/m, ""));

let P = 0, F = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) === JSON.stringify(b)) P++; else { F++; console.log("FAIL " + m + "\n  got =" + JSON.stringify(a) + "\n  want=" + JSON.stringify(b)); } };

// ---------- เงื่อนไข -> ฟอร์ม ----------
eq(M.formsFromCondition("กองทุนสำรองเลี้ยงชีพ / กองทุนสงเคราะห์ลูกจ้าง"), ["pvd", "wef"], "ทั้งสองกองทุน");
eq(M.formsFromCondition("กองทุนสงเคราะห์ลูกจ้าง"), ["wef"], "สงเคราะห์อย่างเดียว = สกล.5 เท่านั้น ห้ามได้ PVD");
eq(M.formsFromCondition("กองทุนสำรองเลี้ยงชีพ"), ["pvd"], "สำรองเลี้ยงชีพอย่างเดียว");
eq(M.formsFromCondition(""), [], "ว่าง = ไม่รู้ ต้องไม่เดา");

// ---------- ไฟล์หน้าตาเหมือนไฟล์จริง (หัวคอลัมน์ตามไฟล์ 2026-09-28) ----------
const H = ["คำนำหน้า","ชื่อ","ชื่อสกุล","สัญชาติ","เลขบัตรประชาชน/เลขหนังสือเดินทาง","ประเภทค่าจ้าง","เงื่อนไข","รหัสพนักงาน"];
const aoa = [H,
  ["นาย","หนึ่ง","ทดสอบ","ไทย","1101700230708","รายเดือน","กองทุนสำรองเลี้ยงชีพ / กองทุนสงเคราะห์ลูกจ้าง","AKR00000001"],
  ["นางสาว","สอง","ทดสอบ","ไทย",1101700230708,"รายเดือน","กองทุนสงเคราะห์ลูกจ้าง","akr00000002 "],   // เลขเป็น number + รหัสตัวเล็ก
  ["นาย","สาม","รายวัน","ไทย","1-1017-00230-70-8","รายวัน","กองทุนสงเคราะห์ลูกจ้าง","DAY0001"],
  ["นาย","สี่","ไม่มีเงื่อนไข","ไทย","1101700230708","รายเดือน","","AKR00000004"],
  ["นาย","ห้า","ไม่มีบัตร","ไทย","","รายเดือน","กองทุนสงเคราะห์ลูกจ้าง","AKR00000005"],
  [],
];
const r = M.parseInviteSheet(aoa);
eq(r.ok.map(x => x.emp_code), ["AKR00000001","AKR00000002","DAY0001"], "อ่านได้ 3 คน รหัสเป็นตัวใหญ่ ตัดช่องว่าง");
eq(r.ok.map(x => x.forms), [["pvd","wef"],["wef"],["wef"]], "ฟอร์มตามเงื่อนไข");
eq(r.ok.map(x => x.id_last5), ["30708","30708","30708"], "5 ตัวท้าย ทั้งข้อความ / ตัวเลข / มีขีด");
eq(r.ok[1].title + " " + r.ok[1].emp_name, "นางสาว สอง ทดสอบ", "คำนำหน้า + ชื่อ");
eq(r.bad.map(x => x.emp_code), ["AKR00000004","AKR00000005"], "แถวที่อ่านไม่ได้ถูกรายงาน ไม่หายเงียบ");
eq(JSON.stringify(r).includes("1101700230708"), false, "เลขบัตรเต็มไม่อยู่ในผลลัพธ์เลย");
eq(r.dups, [], "ไม่มีรหัสซ้ำ");

// หัวตารางไม่ได้อยู่แถวแรก + รหัสซ้ำ
{
  const x = M.parseInviteSheet([["รายชื่อพนักงาน"], [], H,
    ["นาย","ก","ข","ไทย","1101700230708","รายเดือน","กองทุนสงเคราะห์ลูกจ้าง","AKR1"],
    ["นาย","ก","ข","ไทย","1101700230708","รายเดือน","กองทุนสำรองเลี้ยงชีพ / กองทุนสงเคราะห์ลูกจ้าง","AKR1"]]);
  eq(x.ok.length, 2, "หาแถวหัวตารางเจอแม้ไม่ใช่แถวแรก");
  eq(x.dups, ["AKR1"], "รายงานรหัสซ้ำ");
}
// ไฟล์ผิดแบบ
{
  let msg = ""; try { M.parseInviteSheet([["ชื่อ","นามสกุล"]]); } catch (e) { msg = e.message; }
  eq(msg.includes("รหัสพนักงาน"), true, "ไม่มีคอลัมน์รหัสพนักงาน ต้องบอก");
  msg = ""; try { M.parseInviteSheet([["รหัสพนักงาน","เลขบัตรประชาชน"]]); } catch (e) { msg = e.message; }
  eq(msg.includes("เงื่อนไข"), true, "ไม่มีคอลัมน์เงื่อนไข ต้องไม่เดาว่าได้ทุกฟอร์ม");
}

// ---------- เงินสมทบบริษัท (ระเบียบข้อ 14.2.2) ----------
{
  const PR = new Function("fetch", read(`${ROOT}/js/fund-print.js`).replace(/^export /gm, "")
    + "\nreturn { serviceYears, matchTier, employerMatch };")(() => Promise.reject());
  const at = new Date(2026, 8, 29);   // 29 ก.ย. 2026
  eq(PR.serviceYears("2023-09-29", at), 3, "ครบ 3 ปีวันนี้พอดี = 3 ปี");
  eq(PR.serviceYears("2023-09-30", at), 2, "ขาดอีก 1 วัน ยังเป็น 2 ปี");
  eq(PR.serviceYears(null, at), null, "ไม่มีวันเริ่มงาน = ไม่รู้ ไม่เดา");
  eq([0, 2, 3, 5, 6, 9, 10, 25].map(y => PR.matchTier(y).cap), [5, 5, 7, 7, 10, 10, 12, 12], "เพดานตามช่วงอายุงาน");
  eq(PR.employerMatch(3, 1), 3, "สะสม 3% อายุงาน 1 ปี → บริษัทสมทบ 3% (เท่ากับที่สะสม)");
  eq(PR.employerMatch(8, 1), 5, "สะสม 8% อายุงาน 1 ปี → สมทบแค่เพดาน 5%");
  eq(PR.employerMatch(15, 12), 12, "สะสม 15% อายุงาน 12 ปี → สมทบเพดาน 12%");
  eq(PR.employerMatch(10, 7), 10, "สะสม 10% อายุงาน 7 ปี → 10% พอดีเพดาน");
  eq(PR.employerMatch(5, null), null, "ไม่รู้อายุงาน = ไม่บอกตัวเลข");
}

console.log(F === 0 ? `ผ่านทั้งหมด ${P} เคส` : `ผ่าน ${P} · ตก ${F}`);
