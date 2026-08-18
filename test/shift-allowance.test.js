// เทสต์ตรรกะคำนวณค่ากะ (ดึงฟังก์ชันจริงจาก js/shift-allowance.js มารัน)
// รัน: osascript -l JavaScript test/shift-allowance.test.js
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;
const SRC = read(`${ROOT}/js/shift-allowance.js`);

// ตัดส่วนที่ต้องใช้เบราว์เซอร์ (import / renderXxx / window.*) ออก แล้วโหลดเฉพาะตรรกะ
const logic = SRC
  .split("\nlet lastResult")[0]          // ทุกอย่างก่อนส่วน UI
  .split("\n").filter(l => !/^\s*import\s/.test(l)).join("\n")
  .replace(/^export /gm, "");
const M = new Function(`${logic}
  return { computeShiftAllowance, dayStatus, MATCH_TOL, num, FAMILY_MAP, PAYABLE, ELIGIBLE_LEVELS,
           parseKeyFile, applyKeyFile, toYM, findCol };`)();

let P = 0, F = 0;
const eq = (a,b,m) => { if(JSON.stringify(a)===JSON.stringify(b)) P++; else { F++; console.log("FAIL "+m+"\n  got ="+JSON.stringify(a)+"\n  want="+JSON.stringify(b)); } };

// ---------- helper สร้างเดือนจำลอง ----------
// shifts = อาร์เรย์รหัสกะ 1 ตัว/วัน (null = วันหยุดประจำสัปดาห์)
function month(empId, y, m, shifts, extra = {}) {
  return shifts.map((sh, i) => ({
    Employee_ID: empId, Employee_Name: "ทดสอบ", Department: "Mining",
    Date: `${y}-${String(m).padStart(2,"0")}-${String(i+1).padStart(2,"0")}`,
    Shift: sh || "", Day_Type: sh ? "" : "H",
    Check_In: sh ? "08:00" : "", Check_Out: sh ? "17:00" : "",
    ...extra,
  }));
}
const empMap = new Map([
  ["E1", { emp_code:"E1", job_level:"O2" }],
  ["E2", { emp_code:"E2", job_level:"S2" }],                                   // ไม่ใช่ระดับ O
  ["E3", { emp_code:"E3", job_level:"S2", shift_allowance_override:true }],    // HR ให้พิเศษ
]);
const run = rows => M.computeShiftAllowance(rows, empMap);
const one = rows => run(rows).summary[0];

// ---------- เรตตามจำนวนตระกูลกะ ----------
// ก.ค. 31 วัน, ทำครบทุกวัน -> ได้เต็มอัตรา
const jul31 = n => Array.from({length:31}, (_,i) => n[i % n.length]);
eq(one(month("E1",2026,7, jul31(["D01","A01","N01"]))).monthlyRate, 1800, "ครบ 3 ตระกูล -> 1,800");
eq(one(month("E1",2026,7, jul31(["D01","A01"]))).monthlyRate,       1200, "2 ตระกูล -> 1,200");
eq(one(month("E1",2026,7, jul31(["D01"]))).monthlyRate,                0, "ตระกูลเดียว -> 0");

// ทำครบทุกวัน = ได้เต็มเดือนพอดี (pro-rate ต้องไม่ทำให้ขาด/เกิน)
eq(one(month("E1",2026,7, jul31(["D01","A01","N01"]))).total, 1800, "ทำครบเดือน ก.ค. -> 1,800 พอดี");
eq(one(month("E1",2026,2, Array.from({length:28},(_,i)=>["D01","A01","N01"][i%3]))).total, 1800,
   "ก.พ. 28 วัน ทำครบ -> 1,800 พอดี (หารด้วยวันในเดือนจริง)");

// ---------- สิทธิ์ตามระดับ ----------
eq(one(month("E2",2026,7, jul31(["D01","A01","N01"]))).total, 0, "ระดับ S2 ไม่ได้ค่ากะ");
const e3 = one(month("E3",2026,7, jul31(["D01","A01","N01"])));
eq([e3.total, e3.granted], [1800, true], "S2 + override ของ HR -> ได้ 1,800 และติดธง granted");
eq(one(month("E9",2026,7, jul31(["D01","A01","N01"]))).reason, "ไม่พบใน DB", "รหัสไม่มีใน DB -> แจ้งเตือน");

// ---------- วันที่จ่าย / ไม่จ่าย ----------
eq(M.dayStatus({ Deduct_Day:1, Check_In:"08:00" }), "ABSENT",        "หักวัน มาก่อนทุกเงื่อนไข");
eq(M.dayStatus({ Leave_Deduct:1, Check_In:"08:00" }), "UNPAID_LEAVE","ลาไม่รับค่าจ้าง มาก่อนการเข้างาน");
eq(M.dayStatus({ Day_Type:"H" }),  "WEEKLY_OFF_DAY", "H = วันหยุดประจำสัปดาห์ (จ่าย)");
eq(M.dayStatus({ Day_Type:"HD" }), "HOLIDAY",        "HD = วันหยุดนักขัตฤกษ์ (จ่าย)");
eq(M.dayStatus({ Leave_No_Deduct:1 }), "PAID_LEAVE", "ลาได้เงิน (จ่าย)");
eq(M.dayStatus({ Check_In:"08:00" }),  "WORKED",     "มีเวลาเข้างาน = ทำงาน");
eq(M.dayStatus({}), "CHECK_NOTE",                    "ไม่มีข้อมูลเลย -> ต้องตรวจ ไม่นับเป็นวันจ่าย");

// ขาดงาน 1 วันใน ก.ค. -> หายไป 1/31 ของอัตรา
const absent1 = month("E1",2026,7, jul31(["D01","A01","N01"]));
absent1[0] = { ...absent1[0], Deduct_Day:1 };
const a1 = one(absent1);
eq([a1.payDays, a1.total], [30, Math.round(1800/31*30*100)/100], "ขาด 1 วัน -> จ่าย 30 วัน");

// วันหยุด/ลาได้เงิน ไม่ทำให้เสียตระกูลกะ (Pass 1 นับเฉพาะวันที่จ่ายได้)
eq(one(month("E1",2026,7, jul31([null,null,null]))).familyCount, 0, "หยุดทั้งเดือน -> ไม่มีตระกูลกะ -> 0");

// ---------- เทียบกับเฉลยในไฟล์ ----------
eq(run(month("E1",2026,7, jul31(["D01","A01","N01"]))).hasManual, false,
   "ไฟล์ไม่มีคอลัมน์ Shift_Allowance -> ไม่เข้าโหมดเทียบ");

// ใส่เฉลยรายวันให้ตรงกับที่ควรได้ (1800/31 ต่อวัน)
const withKey = month("E1",2026,7, jul31(["D01","A01","N01"]))
  .map(r => ({ ...r, Shift_Allowance: 1800/31 }));
const okRun = run(withKey);
eq(okRun.hasManual, true, "มีคอลัมน์ Shift_Allowance -> เข้าโหมดเทียบ");
eq(okRun.summary[0].manual, 1800, "รวมเฉลยรายวันได้ 1,800");
eq(Math.abs(okRun.summary[0].diff) <= M.MATCH_TOL, true, "ส่วนต่างอยู่ในเกณฑ์ = ถือว่าตรง");

// เฉลยผิดไป 500 บาท -> ต้องจับได้
const badKey = withKey.map((r,i) => i === 0 ? { ...r, Shift_Allowance: 1800/31 + 500 } : r);
eq(run(badKey).summary[0].diff, -500, "เฉลยเกินจริง 500 -> ส่วนต่าง -500");
eq(Math.abs(run(badKey).summary[0].diff) > M.MATCH_TOL, true, "ส่วนต่าง 500 -> ตีเป็นไม่ตรง");

// เฉลยเขียนเป็นข้อความมีลูกน้ำ ต้องอ่านเป็นตัวเลขได้
eq(M.num("1,234.50"), 1234.5, "อ่าน '1,234.50' เป็นตัวเลข");
eq(M.num(""), null,           "ช่องว่าง = ไม่มีเฉลย");
eq(M.num("N/A"), null,        "ข้อความที่ไม่ใช่ตัวเลข = ไม่มีเฉลย");
eq(M.num(0), 0,               "เลข 0 ถือว่ามีค่า (ไม่ใช่ว่าง)");

// เฉลยใส่มาแค่บางคน -> คนที่ไม่มีเฉลยต้องเป็น null ไม่ใช่ 0 (จะได้ไม่ถูกนับว่าไม่ตรง)
const mixed = [
  ...month("E1",2026,7, jul31(["D01","A01","N01"])).map(r=>({ ...r, Shift_Allowance: 1800/31 })),
  ...month("E3",2026,7, jul31(["D01","A01","N01"])),
];
const mixedSum = run(mixed).summary;
eq(mixedSum.find(r=>r.Employee_ID==="E3").manual, null, "คนที่ไม่มีเฉลย -> manual = null");
eq(mixedSum.find(r=>r.Employee_ID==="E3").diff,   null, "คนที่ไม่มีเฉลย -> ไม่คิดส่วนต่าง");

// ---------- ตระกูลกะครอบคลุมรหัสที่ใช้จริง ----------
["D01","D02","D03","NOR","F03","F04"].forEach(c => eq(M.FAMILY_MAP[c], "DAY", `${c} = กะเช้า`));
["A01","A02","A03"].forEach(c => eq(M.FAMILY_MAP[c], "AFT", `${c} = กะบ่าย`));
["N01","N02","N03","N05","N07"].forEach(c => eq(M.FAMILY_MAP[c], "NIT", `${c} = กะดึก`));
eq(one(month("E1",2026,7, jul31(["d01","a01","n01"]))).monthlyRate, 1800, "รหัสกะพิมพ์เล็ก ต้องอ่านได้");

// ---------- ไฟล์เฉลยแยก (ไฟล์สรุป 1 บรรทัด/คน) ----------
eq(M.toYM("2026-07"), "2026-07", "อ่าน '2026-07'");
eq(M.toYM("2026-07-15"), "2026-07", "อ่านวันที่เต็ม -> เดือน");
eq(M.toYM("7/2026"), "2026-07", "อ่าน '7/2026' (เดือน/ปี)");
eq(M.toYM("2026/7"), "2026-07", "อ่าน '2026/7' และเติม 0 หน้าเดือน");
eq(M.toYM("ไม่ใช่วันที่"), null, "ข้อความมั่ว -> null");

// เดาชื่อคอลัมน์: ตรงเป๊ะต้องมาก่อนการเดาแบบมีคำนั้นอยู่ข้างใน
eq(M.findCol(["Employee_Name","Employee_ID"], ["employeeid"]), "Employee_ID", "จับ Employee_ID ไม่ใช่ Employee_Name");
eq(M.findCol(["รหัสพนักงาน","ชื่อ"], ["employeeid","empcode","รหัสพนักงาน"]), "รหัสพนักงาน", "จับหัวคอลัมน์ภาษาไทยได้");
eq(M.findCol(["ชื่อ","แผนก"], ["employeeid"]), null, "ไม่มีคอลัมน์ที่ต้องการ -> null");

const calc = () => run([
  ...month("E1",2026,7, jul31(["D01","A01","N01"])),   // 1,800
  ...month("E3",2026,7, jul31(["D01","A01"])),         // 1,200 (override)
]).summary;

// แบบมีคอลัมน์เดือน + หัวคอลัมน์ภาษาไทย
{
  const s = calc();
  const k = M.parseKeyFile([
    { รหัสพนักงาน:"E1", เดือน:"2026-07", ยอดค่ากะ:1800 },
    { รหัสพนักงาน:"E3", เดือน:"2026-07", ยอดค่ากะ:"1,200.00" },
  ]);
  eq([k.empCol,k.amtCol,k.monCol], ["รหัสพนักงาน","ยอดค่ากะ","เดือน"], "เดาคอลัมน์ไฟล์เฉลยภาษาไทยถูก");
  eq(k.hasMonth, true, "มีคอลัมน์เดือน -> จับคู่ด้วยคน+เดือน");
  const res = M.applyKeyFile(s, k);
  eq([res.matched,res.missing,res.extra], [2,0,0], "จับคู่ครบ 2 รายการ");
  eq(s.map(r=>r.diff), [0,0], "ตรงกับเฉลยทั้งคู่");
}

// แบบไม่มีคอลัมน์เดือน -> จับคู่ด้วยรหัสอย่างเดียว
{
  const s = calc();
  const k = M.parseKeyFile([{ emp_code:"E1", total:1800 }, { emp_code:"E3", total:1000 }]);
  eq(k.hasMonth, false, "ไม่มีคอลัมน์เดือน");
  const res = M.applyKeyFile(s, k);
  eq(res.matched, 2, "ยังจับคู่ได้ด้วยรหัส");
  eq(s.find(r=>r.Employee_ID==="E3").diff, 200, "E3 เฉลย 1,000 แต่ระบบได้ 1,200 -> ต่าง +200");
}

// เฉลยมีคนที่ระบบไม่มี / ระบบมีคนที่เฉลยไม่มี -> ต้องรายงาน ไม่ใช่นับเป็นไม่ตรง
{
  const s = calc();
  const k = M.parseKeyFile([{ Employee_ID:"E1", Shift_Allowance:1800 }, { Employee_ID:"E9", Shift_Allowance:900 }]);
  const res = M.applyKeyFile(s, k);
  eq([res.matched,res.missing,res.extra], [1,1,1], "จับคู่ 1 · ระบบมีแต่เฉลยไม่มี 1 · เฉลยมีแต่ระบบไม่มี 1");
  eq(s.find(r=>r.Employee_ID==="E3").diff, null, "คนที่เฉลยไม่ครอบคลุม -> ไม่คิดส่วนต่าง");
}

// เฉลยแยกหลายบรรทัดต่อคน (เช่นแตกรายกะ) ต้องรวมยอดให้
{
  const s = calc();
  const k = M.parseKeyFile([
    { Employee_ID:"E1", เดือน:"2026-07", ค่ากะ:800 },
    { Employee_ID:"E1", เดือน:"2026-07", ค่ากะ:1000 },
  ]);
  M.applyKeyFile(s, k);
  eq(s.find(r=>r.Employee_ID==="E1").manual, 1800, "รวมหลายบรรทัดของคนเดียวกันเป็น 1,800");
}

// ไฟล์ที่หาคอลัมน์ไม่เจอ ต้องคืน error พร้อมรายชื่อคอลัมน์ (ไว้ขึ้นข้อความบอกผู้ใช้)
{
  const k = M.parseKeyFile([{ ชื่อ:"ก", แผนก:"ข" }]);
  eq(k.error, "หาคอลัมน์ไม่เจอ", "ไม่มีคอลัมน์ที่ต้องการ -> error");
  eq(k.cols, ["ชื่อ","แผนก"], "คืนรายชื่อคอลัมน์ที่พบมาด้วย");
}

// ---------- รหัสกะที่ไม่รู้จัก ----------
{
  const r = run(month("E1",2026,7, jul31(["D01","A01","N01"])));
  eq(r.unknownCodes, [], "รหัสที่รู้จักทั้งหมด -> ไม่มีอะไรให้เตือน");
}
{
  // N04 ยังไม่มีในระบบ -> นับได้แค่ 2 ตระกูล ยอดตกจาก 1,800 เหลือ 1,200
  const r = run(month("E1",2026,7, jul31(["D01","A01","N04"])));
  eq(r.summary[0].monthlyRate, 1200, "รหัสไม่รู้จักทำให้นับตระกูลขาด");
  eq(r.unknownCodes.length, 1, "เตือน 1 รหัส");
  eq([r.unknownCodes[0].code, r.unknownCodes[0].emps], ["N04", 1], "บอกรหัสและจำนวนคนที่ใช้");
  eq(r.unknownCodes[0].days, 10, "นับจำนวนวันที่เจอรหัสนั้น");
  eq(r.unknownCodes[0].payDays, 10, "นับเฉพาะวันจ่ายที่ได้รับผลกระทบด้วย");
}
{
  // พอใส่ N04 = ดึก เข้า famMap ยอดต้องกลับมาเต็ม และคำเตือนต้องหาย
  const rows = month("E1",2026,7, jul31(["D01","A01","N04"]));
  const fixed = M.computeShiftAllowance(rows, empMap, { ...M.FAMILY_MAP, N04:"NIT" });
  eq(fixed.summary[0].monthlyRate, 1800, "เพิ่มรหัสแล้วนับได้ 3 ตระกูล");
  eq(fixed.unknownCodes, [], "เพิ่มรหัสแล้วไม่เตือนอีก");
}
{
  // ช่องกะว่าง = วันหยุด ไม่ใช่รหัสไม่รู้จัก ต้องไม่เตือน
  const r = run(month("E1",2026,7, jul31([null,"A01","N01"])));
  eq(r.unknownCodes, [], "ช่องกะว่าง ไม่ใช่รหัสไม่รู้จัก");
}
{
  // เรียงรหัสที่กระทบวันจ่ายมากที่สุดขึ้นก่อน
  const rows = [
    ...month("E1",2026,7, Array.from({length:31},(_,i)=> i<20 ? "ZZ1" : "ZZ2")),
  ];
  const r = run(rows);
  eq(r.unknownCodes.map(u=>u.code), ["ZZ1","ZZ2"], "เรียงตามผลกระทบมาก -> น้อย");
}

console.log(`\n${P} passed, ${F} failed`);
if (F > 0) throw new Error(F + " test(s) failed");
