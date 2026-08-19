// เทสต์ logic ของหน้า Dashboard (ดึงฟังก์ชันจริงจาก js/app.js มารัน)
// รัน: osascript -l JavaScript test/dashboard.test.js
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;
const APP = read(`${ROOT}/js/app.js`);

// ดึงค่าของ `const NAME = ...;` (รองรับ export/ไม่ export, arrow หลายบรรทัด)
function extractConst(src, name){
  const m = new RegExp(`(?:export )?const ${name} = `).exec(src);
  if(!m) return null;
  let j = m.index + m[0].length, d = 0;
  for(; j < src.length; j++){
    const c = src[j];
    if(c === "{" || c === "(" || c === "[") d++;
    else if(c === "}" || c === ")" || c === "]") d--;
    else if(c === ";" && d === 0) break;
  }
  return src.slice(m.index + m[0].length, j);
}
function extractFn(src, name){
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
const eq = (a,b,m) => { if(JSON.stringify(a)===JSON.stringify(b)) P++; else { F++; console.log("FAIL "+m+"\n  got ="+JSON.stringify(a)+"\n  want="+JSON.stringify(b)); } };

const mk = n => new Function(`return ${extractConst(APP,n)};`)();
const dashFY = mk("dashFY"), prevYMof = mk("prevYMof"), planStatus = mk("planStatus");
const lastDayOfMonth = mk("lastDayOfMonth"), sepYM = mk("sepYM");
const isActive = new Function("lastDayOfMonth", `${extractFn(APP,"isActiveAtMonthEnd")}; return isActiveAtMonthEnd;`)(lastDayOfMonth);

// ---- ปีงบประมาณ (เริ่ม ก.ค.) ----
eq(dashFY("2026-07"), 2027, "ก.ค. 2026 -> FY2027");
eq(dashFY("2026-06"), 2026, "มิ.ย. 2026 -> FY2026");
eq(dashFY("2026-12"), 2027, "ธ.ค. 2026 -> FY2027");
eq(dashFY("2026-01"), 2026, "ม.ค. 2026 -> FY2026");

// ---- เดือนก่อนหน้า (ข้ามปีถูกต้อง) ----
eq(prevYMof("2026-01"), "2025-12", "ม.ค. -> ธ.ค. ปีก่อน");
eq(prevYMof("2026-08"), "2026-07", "ส.ค. -> ก.ค.");
eq(prevYMof("2026-10"), "2026-09", "รักษารูปแบบเลข 2 หลัก");

// ---- เกณฑ์สถานะแผนกำลังคน ----
eq(planStatus(10,10).key, "healthy",  "มีจริง = แผน -> ครบตามแผน");
eq(planStatus(12,10).key, "healthy",  "มีจริง > แผน -> ครบตามแผน");
eq(planStatus(9,10).key,  "watch",    "ขาด 10% พอดี -> เฝ้าระวัง");
eq(planStatus(95,100).key,"watch",    "ขาด 5% -> เฝ้าระวัง");
eq(planStatus(89,100).key,"critical", "ขาด 11% -> วิกฤต");
eq(planStatus(0,10).key,  "critical", "ไม่มีคนเลย -> วิกฤต");
eq(planStatus(5,0), null,             "ไม่มีแผน -> ไม่แสดงสถานะ");

// ---- KPI: เดือนที่ไม่มีความเคลื่อนไหวเลย ต้องไม่พัง และ headcount ต้องคงที่ ----
const EMPS = [
  {emp_code:"A", join_date:"2020-01-01", status:"Active"},
  {emp_code:"B", join_date:"2020-01-01", status:"Active"},
  {emp_code:"C", join_date:"2020-01-01", end_date:"2026-08-01", status:"Resigned"},
];
const hc = ym => EMPS.filter(e=>isActive(e,ym)).length;
eq(hc("2026-05"), 3, "พ.ค. (ไม่มีความเคลื่อนไหว) = 3 คน");
eq(hc("2026-06"), 3, "มิ.ย. (ไม่มีความเคลื่อนไหว) = 3 คน");
eq(hc("2026-06") - hc("2026-05"), 0, "เดือนที่ไม่มีความเคลื่อนไหว: ส่วนต่าง = 0");
eq(hc("2026-07"), 2, "ก.ค.: C (termination 1 ส.ค. = ทำงานถึง 31 ก.ค.) ถูกตัดออกตั้งแต่ ก.ค.");
eq(hc("2026-08"), 2, "ส.ค.: คงเหลือ 2 คน");

// turnover ต้องไม่หารด้วยศูนย์เมื่อไม่มีพนักงาน
const turnover = (resigned, total) => total ? (resigned/total*100) : 0;
eq(turnover(0, 0), 0, "ไม่มีพนักงาน -> อัตราการลาออก 0 (ไม่ใช่ NaN)");
eq(Number(turnover(1, 3).toFixed(2)), 33.33, "1 จาก 3 = 33.33%");

// ---- waterfall: ยกมา + เข้าใหม่ − พ้นสภาพ = ยกไป ----
const newIn = ym => EMPS.filter(e=>(e.join_date||"").substring(0,7)===ym).length;
const sepIn = ym => EMPS.filter(e=>sepYM(e.end_date)===ym).length;
eq(sepIn("2026-07"), 1, "ก.ค.: พ้นสภาพ 1 คน (C)");
eq(hc("2026-06") + newIn("2026-07") - sepIn("2026-07"), hc("2026-07"), "waterfall ก.ค. ลงตัว (เดือนที่มีคนออก)");
eq(sepIn("2026-08"), 0, "ส.ค.: ไม่นับ C ซ้ำ");
eq(hc("2026-07") + newIn("2026-08") - sepIn("2026-08"), hc("2026-08"), "waterfall ส.ค. ลงตัว (เดือนที่ไม่มีคนออก)");

// ---- ประเภทที่ถือว่าพ้นสภาพ ต้องตรงกันทุกที่ที่ใช้ (กันบันทึกซ้ำ vs การนับในรายงาน) ----
const SEPARATION_TYPES = new Function(`return ${extractConst(APP,"SEPARATION_TYPES")};`)();
eq(SEPARATION_TYPES.sort(), ["Resignation","Retirement","Termination"], "SEPARATION_TYPES ครบ 3 ชนิด");
// getMonthStats นับพ้นสภาพด้วยชนิดเดียวกัน — ถ้าเพิ่มชนิดใหม่ที่เดียวจะจับได้ตรงนี้
const statsSrc = extractFn(APP, "getMonthStats");
SEPARATION_TYPES.forEach(t =>
  eq(statsSrc.includes(`"${t}"`), true, `getMonthStats นับ ${t} เป็นการพ้นสภาพด้วย`));

// ---- ป้ายไทยของประเภทความเคลื่อนไหว ครอบคลุมทุกชนิดที่ระบบใช้ ----
const MOV_TH = new Function(`return ${extractConst(APP,"MOV_TH")};`)();
["New Hire","Resignation","Termination","Retirement","Transfer","Promotion","Demotion","Secondment"]
  .forEach(t => eq(typeof MOV_TH[t], "string", `MOV_TH มีป้ายไทยของ ${t}`));

// ---- แผนก/ตำแหน่งใหม่: รวมเป็นค่าเดียวลงคอลัมน์ to_dept ----
const combineToDept = new Function(`${extractFn(APP,"combineToDept")}; return combineToDept;`)();
const FROM = "Supply / Senior Purchasing Supervisor";
eq(combineToDept("Mining","Mining Engineer",FROM), "Mining / Mining Engineer", "ย้ายทั้งแผนกและตำแหน่ง");
eq(combineToDept("","Purchasing Manager",FROM),    "Supply / Purchasing Manager",
   "ปรับแค่ตำแหน่ง -> เติมแผนกเดิมให้เอง");
eq(combineToDept("Mining","",FROM),                "Mining", "ย้ายแผนกอย่างเดียว");
eq(combineToDept("","",FROM),                      "",       "ไม่กรอกอะไรเลย -> ว่าง ไม่ไปหยิบแผนกเดิมมั่ว");
eq(combineToDept("","Manager",""),                 "Manager","ไม่มีแผนกเดิม -> ใส่แค่ตำแหน่ง");
eq(combineToDept("  Mining  ","  Engineer  ",FROM),"Mining / Engineer", "ตัดช่องว่างหัวท้าย");
eq(combineToDept("","Manager","Supply"),           "Supply / Manager", "แผนกเดิมไม่มี ' / ' ก็ใช้ได้");
eq(combineToDept(null,null,null),                  "",       "ค่า null -> ว่าง ไม่พัง");

console.log(`\n${P} passed, ${F} failed`);
if(F > 0) throw new Error(F + " test(s) failed");
