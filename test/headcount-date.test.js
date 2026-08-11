// เทสต์กฎการนับเดือนของรายงาน (ดึงฟังก์ชันจริงจาก js/app.js มารัน ไม่ได้เขียน logic ซ้ำ)
//
// กฎ (ยืนยันกับผู้ใช้ 2026-08-03): end_date / movement date = "วันแรกที่พ้นสภาพ" (termination date)
//   เดือนที่นับการพ้นสภาพ = เดือนของวันทำงานวันสุดท้าย = termination date ลบ 1 วัน (sepYM)
//   และหลุดจาก Headcount ตั้งแต่เดือนเดียวกันนั้น (ใช้ sepYM ตัวเดียวกัน -> สมการ balance ลงตัวเสมอ)
//   ตัวอย่าง termination 2026-08-01 -> ทำงานถึง 31 ก.ค. -> พ้นสภาพนับ ก.ค. / ไม่อยู่ใน Headcount ก.ค. / ยังอยู่ใน มิ.ย.
//
// รัน: osascript -l JavaScript test/headcount-date.test.js
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;

function extract(src, name){
  const i = src.indexOf(`function ${name}(`);
  if(i < 0) return null;
  let d = 0, started = false;
  for(let j = i; j < src.length; j++){
    if(src[j] === "{"){ d++; started = true; }
    else if(src[j] === "}"){ d--; if(started && d === 0) return src.slice(i, j+1); }
  }
  return null;
}
let P = 0, F = 0;
const eq = (a, b, m) => { if(JSON.stringify(a) === JSON.stringify(b)) P++; else { F++; console.log("FAIL " + m + "\n  got =" + JSON.stringify(a) + "\n  want=" + JSON.stringify(b)); } };

// ดึงค่าของ `export const NAME = ...;` โดยไล่นับวงเล็บ (รองรับ arrow แบบหลายบรรทัด)
function extractConst(src, name){
  const key = `export const ${name} = `;
  const i = src.indexOf(key);
  if(i < 0) return null;
  let j = i + key.length, d = 0;
  for(; j < src.length; j++){
    const c = src[j];
    if(c === "{" || c === "(" || c === "[") d++;
    else if(c === "}" || c === ")" || c === "]") d--;
    else if(c === ";" && d === 0) break;
  }
  return src.slice(i + key.length, j);
}

const APP = read(`${ROOT}/js/app.js`);
// helper กลางอยู่ใน app.js: lastDayOfMonth (arrow) + isActiveAtMonthEnd (function) + sepYM (arrow)
const lastDaySrc = extractConst(APP, "lastDayOfMonth");
const sepYMSrc   = extractConst(APP, "sepYM");
const isActiveSrc = extract(APP, "isActiveAtMonthEnd");
eq(lastDaySrc !== null, true, "app.js มี lastDayOfMonth");
eq(sepYMSrc !== null, true, "app.js มี sepYM");
eq(isActiveSrc !== null, true, "app.js มี isActiveAtMonthEnd");

const lastDayOfMonth = new Function(`return ${lastDaySrc};`)();
const sepYM = new Function(`return ${sepYMSrc};`)();
const isActive = new Function("lastDayOfMonth", `${isActiveSrc}; return isActiveAtMonthEnd;`)(lastDayOfMonth);

// ---- 1) สิ้นเดือนถูกต้องทุกความยาวเดือน ----
eq(lastDayOfMonth("2026-07"), "2026-07-31", "ก.ค. -> 31");
eq(lastDayOfMonth("2026-02"), "2026-02-28", "ก.พ. ปกติ -> 28");
eq(lastDayOfMonth("2028-02"), "2028-02-29", "ก.พ. อธิกสุรทิน -> 29");
eq(lastDayOfMonth("2026-04"), "2026-04-30", "เม.ย. -> 30");

// ---- 2) เคสหลัก: termination_date = วันแรกของเดือน (2026-08-01) ----
const A = {emp_code:"A", join_date:"2020-01-01", end_date:"2026-08-01", status:"Resigned"};
eq(sepYM(A.end_date), "2026-07",  "1 ส.ค.: พ้นสภาพนับเดือน ก.ค. (เดือนที่ทำงานวันสุดท้าย)");
eq(isActive(A, "2026-06"), true,  "1 ส.ค.: ยังนับใน Headcount มิ.ย.");
eq(isActive(A, "2026-07"), false, "1 ส.ค.: ไม่นับใน Headcount ก.ค. (เดือนเดียวกับที่พ้นสภาพ)");
eq(isActive(A, "2026-08"), false, "1 ส.ค.: ไม่นับใน Headcount ส.ค.");

// วันแรกของเดือนอื่น ๆ ต้องเป็นแบบเดียวกัน (รวมข้ามปี/อธิกสุรทิน)
eq(sepYM("2026-01-01"), "2025-12", "1 ม.ค.: พ้นสภาพนับ ธ.ค. ปีก่อน");
eq(isActive({join_date:"2020-01-01", end_date:"2026-01-01"}, "2025-11"), true,  "1 ม.ค.: ยังนับใน พ.ย.");
eq(isActive({join_date:"2020-01-01", end_date:"2026-01-01"}, "2025-12"), false, "1 ม.ค.: ไม่นับใน ธ.ค.");
eq(sepYM("2028-03-01"), "2028-02", "อธิกสุรทิน: 1 มี.ค. 2028 -> ก.พ. 2028 (29 ก.พ.)");
eq(isActive({join_date:"2020-01-01", end_date:"2028-03-01"}, "2028-01"), true,  "อธิกสุรทิน: ยังนับใน ม.ค.");
eq(isActive({join_date:"2020-01-01", end_date:"2028-03-01"}, "2028-02"), false, "อธิกสุรทิน: ไม่นับใน ก.พ.");

// ---- 3) เคสอื่นที่ไม่ใช่วันแรกของเดือน (เดือนไม่ขยับ) ----
const B = {emp_code:"B", join_date:"2020-01-01", end_date:"2026-08-15", status:"Terminated"};
eq(sepYM(B.end_date), "2026-08",  "15 ส.ค.: พ้นสภาพเดือน ส.ค.");
eq(isActive(B, "2026-07"), true,  "15 ส.ค.: นับใน ก.ค.");
eq(isActive(B, "2026-08"), false, "15 ส.ค.: ไม่นับใน ส.ค.");
const C = {emp_code:"C", join_date:"2020-01-01", end_date:"2026-07-31", status:"Resigned"};
eq(sepYM(C.end_date), "2026-07",  "31 ก.ค.: พ้นสภาพเดือน ก.ค.");
eq(isActive(C, "2026-06"), true,  "31 ก.ค.: นับใน มิ.ย.");
eq(isActive(C, "2026-07"), false, "31 ก.ค.: ไม่นับใน ก.ค.");

// ---- 4) ไม่มี end_date / เข้าใหม่ ----
eq(isActive({join_date:"2020-01-01"}, "2026-08"), true, "ไม่มี end_date = นับตลอด");
eq(isActive({join_date:"2026-09-01"}, "2026-08"), false, "เข้างานเดือนหน้า = ยังไม่นับ");
eq(isActive({join_date:"2026-08-31"}, "2026-08"), true, "เข้างานวันสุดท้ายของเดือน = นับ");
eq(isActive({join_date:"2026-09-01"}, "2026-09"), true, "เข้างานวันแรกของเดือน = นับเดือนนั้น");
eq(sepYM(""), "", "ไม่มีวันที่ -> ว่าง");

// ---- 5) สมการต้องลงตัว: ยกมา + เข้าใหม่ − พ้นสภาพ = ยกไป ----
const EMPS = [
  {emp_code:"P1", join_date:"2020-01-01", status:"Active"},                          // อยู่ตลอด
  {emp_code:"P2", join_date:"2020-01-01", end_date:"2026-08-01", status:"Resigned"}, // พ้นสภาพ 1 ส.ค.
  {emp_code:"P3", join_date:"2026-08-10", status:"Active"},                          // เข้าใหม่ ส.ค.
];
const hc = ym => EMPS.filter(e => isActive(e, ym)).length;
const sepIn = ym => EMPS.filter(e => sepYM(e.end_date) === ym && ["Resigned","Terminated","Retired"].includes(e.status)).length;
const newIn = ym => EMPS.filter(e => (e.join_date||"").substring(0,7) === ym).length;
// เดือน ก.ค. — เดือนที่ P2 พ้นสภาพ (termination 1 ส.ค.)
eq(sepIn("2026-07"), 1, "ก.ค.: พ้นสภาพ 1 คน (P2 ที่ termination 1 ส.ค.)");
eq(hc("2026-06"), 2, "ยกมา ก.ค. = 2 (P1,P2)");
eq(hc("2026-07"), 1, "ยกไป ก.ค. = 1 (เหลือ P1)");
eq(hc("2026-06") + newIn("2026-07") - sepIn("2026-07"), hc("2026-07"), "ก.ค.: ยกมา + เข้าใหม่ − พ้นสภาพ = ยกไป");
// เดือน ส.ค. — ต้องไม่นับ P2 ซ้ำ
eq(sepIn("2026-08"), 0, "ส.ค.: ต้องไม่นับ P2 ซ้ำอีก");
eq(newIn("2026-08"), 1, "เข้าใหม่ ส.ค. = 1 (P3)");
eq(hc("2026-08"), 2, "ยกไป ส.ค. = 2 (P1,P3)");
eq(hc("2026-07") + newIn("2026-08") - sepIn("2026-08"), hc("2026-08"), "ส.ค.: ยกมา + เข้าใหม่ − พ้นสภาพ = ยกไป");

// ---- 6) ทุกรายงานต้องใช้กฎกลาง ไม่นิยามซ้ำเอง (กัน regression เดิมที่ก๊อป logic 4 ที่) ----
["js/headcount.js","js/movement-report.js","js/workforce-overview.js"].forEach(f => {
  const src = read(`${ROOT}/${f}`);
  eq(/function\s+hcAtMonth\s*\(/.test(src), false, `${f} ไม่นิยาม hcAtMonth เอง`);
  eq(/function\s+lastWorkYM\s*\(/.test(src), false, `${f} ไม่มี lastWorkYM (กฎเก่า) หลงเหลือ`);
  eq(src.includes("hcAtMonthEnd"), true, `${f} ใช้ helper กลาง hcAtMonthEnd`);
});
eq(/function\s+lastWorkYM\s*\(/.test(APP), false, "app.js ไม่มี lastWorkYM หลงเหลือ");

console.log(`\n${P} passed, ${F} failed`);
if(F > 0) throw new Error(F + " test(s) failed");
