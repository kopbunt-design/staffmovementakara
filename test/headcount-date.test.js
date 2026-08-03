// เทสต์กฎการนับเดือนของรายงาน (ดึงฟังก์ชันจริงจากไฟล์ source มารัน ไม่ได้เขียน logic ซ้ำ)
//
// กฎ: end_date / movement date = "วันที่มีผลพ้นสภาพ" (วันแรกที่ไม่ได้ทำงาน)
//     เดือนที่นับ = เดือนของวันทำงานวันสุดท้าย (effective date ลบ 1 วัน)
//     เช่น effective 1 ส.ค. 2026 -> วันทำงานวันสุดท้าย 31 ก.ค. -> ลาออกขึ้นเดือน ก.ค. และตัดออกจาก headcount ก.ค.
//
// รัน: osascript -l JavaScript test/headcount-date.test.js
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;

// ดึงตัวฟังก์ชันออกมาจากไฟล์ โดยไล่นับวงเล็บปีกกาให้สมดุล
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

const FILES = ["js/headcount.js", "js/movement-report.js", "js/workforce-overview.js", "js/app.js"];
const srcs = {}; FILES.forEach(f => srcs[f] = read(`${ROOT}/${f}`));

// ---- 1) ทุกไฟล์ต้องมี lastWorkYM และให้ผลตรงกันทุกไฟล์ ----
const DATES = ["2026-08-01","2026-07-31","2026-01-01","2026-03-01","2028-03-01","2026-12-31","2026-02-01",""];
const outs = {};
for(const f of FILES){
  const fn = extract(srcs[f], "lastWorkYM");
  eq(fn !== null, true, `${f} มีฟังก์ชัน lastWorkYM`);
  if(!fn) continue;
  const impl = new Function(`${fn}; return lastWorkYM;`)();
  outs[f] = DATES.map(d => impl(d));
}
const base = outs[FILES[0]];
FILES.slice(1).forEach(f => eq(outs[f], base, `${f} ให้ผลตรงกับ headcount.js (หลักเดียวกันทั้งระบบ)`));

// ---- 2) เคสที่ผู้ใช้ระบุ: effective 1/8/2026 -> ต้องเป็นเดือน July 2026 ----
const lastWorkYM = new Function(`${extract(srcs["js/headcount.js"], "lastWorkYM")}; return lastWorkYM;`)();
eq(lastWorkYM("2026-08-01"), "2026-07", "effective 1 ส.ค. 2026 -> ลาออกนับเดือน 2026-07");
eq(lastWorkYM("2026-01-01"), "2025-12", "effective 1 ม.ค. -> ข้ามปี -> ธ.ค. ปีก่อน");
eq(lastWorkYM("2026-03-01"), "2026-02", "effective 1 มี.ค. -> ก.พ.");
eq(lastWorkYM("2028-03-01"), "2028-02", "อธิกสุรทิน: 1 มี.ค. 2028 -> ก.พ. 2028");
eq(lastWorkYM("2026-07-15"), "2026-07", "กลางเดือน -> เดือนเดิม");
eq(lastWorkYM("2026-07-31"), "2026-07", "สิ้นเดือน -> เดือนเดิม");
eq(lastWorkYM(""), "", "ไม่มีวันที่ -> ว่าง");

// ---- 3) hcAtMonth ของแต่ละรายงาน ต้องตัดคนออกตั้งแต่เดือนวันทำงานวันสุดท้าย ----
const EMPS = [
  {emp_code:"A", join_date:"2020-01-01", end_date:"2026-08-01", status:"Resigned"}, // ทำถึง 31 ก.ค.
  {emp_code:"B", join_date:"2020-01-01", status:"Active"},                          // อยู่ตลอด
  {emp_code:"C", join_date:"2026-08-10", status:"Active"},                          // เข้า ส.ค.
];
const codes = list => list.map(e => e.emp_code).sort();
for(const f of ["js/headcount.js","js/movement-report.js","js/workforce-overview.js"]){
  const fnL = extract(srcs[f], "lastWorkYM"), fnH = extract(srcs[f], "hcAtMonth");
  eq(fnH !== null, true, `${f} มี hcAtMonth`);
  if(!fnH) continue;
  const hc = new Function("allEmployees", `${fnL}; ${fnH}; return hcAtMonth;`)(EMPS);
  eq(codes(hc("2026-06")), ["A","B"], `${f}: มิ.ย. ยังนับ A`);
  eq(codes(hc("2026-07")), ["B"],     `${f}: ก.ค. ตัด A ออกแล้ว (ตามที่ผู้ใช้เลือก)`);
  eq(codes(hc("2026-08")), ["B","C"], `${f}: ส.ค. มี C เข้าใหม่`);
}

// ---- 4) สมการต้องลงตัว: ยกมา + เข้าใหม่ − ลาออก = ยกไป ----
const fnL0 = extract(srcs["js/headcount.js"], "lastWorkYM"), fnH0 = extract(srcs["js/headcount.js"], "hcAtMonth");
const hc0 = new Function("allEmployees", `${fnL0}; ${fnH0}; return hcAtMonth;`)(EMPS);
const openJul = hc0("2026-06").length;                                            // ยกมาของ ก.ค. = ยกไปของ มิ.ย.
const endJul  = hc0("2026-07").length;
const newJul  = EMPS.filter(e => (e.join_date||"").substring(0,7) === "2026-07").length;
const sepJul  = EMPS.filter(e => lastWorkYM(e.end_date) === "2026-07" && ["Resigned","Terminated","Retired"].includes(e.status)).length;
eq(sepJul, 1, "ก.ค. มีลาออก 1 คน (คือ A)");
eq(openJul + newJul - sepJul, endJul, "ก.ค.: ยกมา + เข้าใหม่ − ลาออก = ยกไป");
const endAug = hc0("2026-08").length;
const newAug = EMPS.filter(e => (e.join_date||"").substring(0,7) === "2026-08").length;
const sepAug = EMPS.filter(e => lastWorkYM(e.end_date) === "2026-08" && ["Resigned","Terminated","Retired"].includes(e.status)).length;
eq(sepAug, 0, "ส.ค. ไม่มีลาออกซ้ำ");
eq(endJul + newAug - sepAug, endAug, "ส.ค.: ยกมา + เข้าใหม่ − ลาออก = ยกไป");

// ---- 5) กันของเก่ากลับมา: ต้องไม่มีการนับลาออกด้วยเดือนของ effective date ตรง ๆ ----
eq(/end_date\|\|""\)\.substring\(0,7\)===ym/.test(srcs["js/headcount.js"]), false,
   "headcount.js ไม่นับลาออกด้วยเดือน end_date ตรง ๆ แล้ว");
eq(srcs["js/app.js"].includes("const em=(e.end_date||\"\").substring(0,7);"), false,
   "Dashboard ไม่ใช้เดือน end_date ตรง ๆ ในการนับ headcount แล้ว");

console.log(`\n${P} passed, ${F} failed`);
if(F > 0) throw new Error(F + " test(s) failed");
