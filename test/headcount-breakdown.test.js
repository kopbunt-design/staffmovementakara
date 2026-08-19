// เทสต์ตาราง "แยกตามหน่วยงาน" ของ Headcount Report
// จุดสำคัญ: ยอดรวมของตารางแยก ต้องตรงกับตารางหลักเสมอ (ใช้รายชื่อชุดเดียวกัน ไม่ได้นับใหม่)
// รัน: osascript -l JavaScript test/headcount-breakdown.test.js
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;
const HC = read(`${ROOT}/js/headcount.js`);
const APP = read(`${ROOT}/js/app.js`);

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
function extractConst(src, name){
  const m = new RegExp(`(?:export )?const ${name}\\s*=\\s*`).exec(src);
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
let P = 0, F = 0;
const eq = (a,b,m) => { if(JSON.stringify(a)===JSON.stringify(b)) P++; else { F++; console.log("FAIL "+m+"\n  got ="+JSON.stringify(a)+"\n  want="+JSON.stringify(b)); } };

// ประกอบฟังก์ชันจริงจาก source (ไม่ก๊อปตรรกะมาเขียนใหม่)
const M = new Function(`
  const GRP = ${extractConst(HC,"GRP")};
  ${extractFn(HC,"grp")}
  const ORG_LEVELS = ${extractConst(HC,"ORG_LEVELS")};
  const UNSET = ${extractConst(HC,"UNSET")};
  const orgOf = ${extractConst(HC,"orgOf")};
  ${extractFn(HC,"buildBreakdown")}
  const lastDayOfMonth = ${extractConst(APP,"lastDayOfMonth")};
  ${extractFn(APP,"isActiveAtMonthEnd")}
  const sepYM = ${extractConst(APP,"sepYM")};
  return { buildBreakdown, orgOf, UNSET, ORG_LEVELS, GRP, isActiveAtMonthEnd, sepYM };
`)();

// ---------- ระดับหน่วยงานครบ 4 ระดับ ----------
eq(M.ORG_LEVELS.map(l=>l.key), ["division","department","section","team"],
   "มีครบ 4 ระดับ เรียงจากใหญ่ไปเล็ก");

// ---------- อ่านชื่อหน่วยงาน ----------
eq(M.orgOf({division:"Operations"},"division"), "Operations", "อ่านชื่อหน่วยงานได้");
eq(M.orgOf({division:"  Mining  "},"division"), "Mining",     "ตัดช่องว่างหัวท้าย");
eq(M.orgOf({division:""},"division"),  M.UNSET, "ค่าว่าง -> (ไม่ระบุ)");
eq(M.orgOf({},"division"),             M.UNSET, "ไม่มีฟิลด์ -> (ไม่ระบุ)");
eq(M.orgOf(null,"division"),           M.UNSET, "ไม่มีตัวพนักงาน -> ไม่พัง");

// ---------- ตัวช่วยสร้าง rows จำลอง (โครงเดียวกับที่ buildData คืนมา) ----------
const e = (code, div, lvl) => ({emp_code:code, division:div, department:div+" Dept", job_level:lvl});
const mkRow = (ym, month, o) => ({
  ym, month, future:false,
  _new:o.n||[], _vol:o.v||[], _inv:o.i||[], _act:o.a||[],
  nT:(o.n||[]).length, vT:(o.v||[]).length, iT:(o.i||[]).length,
  rT:(o.v||[]).length+(o.i||[]).length, hT:(o.a||[]).length,
});

const A1=e("A1","Mining","O1"), A2=e("A2","Mining","S2"), A3=e("A3","Mining","M1");
const B1=e("B1","Operations","O2"), B2=e("B2","Operations","O3");
const X1=e("X1","","O1"); // ไม่ระบุหน่วยงาน

{
  const rows=[
    mkRow("2026-01","January",{n:[A1],           a:[A1,A2,A3,B1]}),
    mkRow("2026-02","February",{n:[B2], v:[A3],  a:[A1,A2,B1,B2]}),
  ];
  const bd=M.buildBreakdown(rows,"division");
  const by=n=>bd.units.find(u=>u.name===n);

  eq(bd.months, 2,          "นับ 2 เดือน");
  eq(bd.lastYM, "2026-02",  "headcount อ้างเดือนล่าสุด");
  eq(bd.lastMonth,"February","บอกชื่อเดือนล่าสุดไว้แสดงผล");

  eq(by("Mining").nT, 1,  "Mining: เข้าใหม่ 1 คน");
  eq(by("Mining").vT, 1,  "Mining: ลาออก 1 คน");
  eq(by("Mining").rT, 1,  "Mining: ออกรวม 1 คน");
  eq(by("Mining").bT, 0,  "Mining: balance = 1 - 1 = 0");
  eq(by("Mining").hT, 2,  "Mining: headcount สิ้น ก.พ. = 2 (A3 ออกแล้ว)");
  eq(by("Operations").nT, 1, "Operations: เข้าใหม่ 1 คน");
  eq(by("Operations").hT, 2, "Operations: headcount = 2");

  // แยกตาม job level ภายในหน่วยงาน
  eq(by("Mining").hG, {M:0,S:1,O:1}, "Mining: แยก M/S/O ของ headcount");
  eq(by("Mining").vG, {M:1,S:0,O:0}, "Mining: คนที่ออกเป็นระดับ M");
  eq(by("Operations").hG, {M:0,S:0,O:2}, "Operations: O 2 คน");
}

// ---------- ⭐ ยอดรวมต้องตรงกับตารางหลัก ----------
{
  const rows=[
    mkRow("2026-01","January",{n:[A1,B1],       v:[A2], a:[A1,A3,B1,B2,X1]}),
    mkRow("2026-02","February",{n:[B2],  i:[A3],        a:[A1,B1,B2,X1]}),
    mkRow("2026-03","March",{n:[],  v:[B2], i:[],       a:[A1,B1,X1]}),
  ];
  const main={
    nT:rows.reduce((s,r)=>s+r.nT,0), vT:rows.reduce((s,r)=>s+r.vT,0),
    iT:rows.reduce((s,r)=>s+r.iT,0), hT:rows[rows.length-1].hT,
  };
  for(const lv of ["division","department"]){
    const bd=M.buildBreakdown(rows,lv);
    const sum=f=>bd.units.reduce((s,u)=>s+f(u),0);
    eq(sum(u=>u.nT), main.nT, `${lv}: ยอดเข้าใหม่รวม ตรงกับตารางหลัก`);
    eq(sum(u=>u.vT), main.vT, `${lv}: ยอดลาออกรวม ตรงกับตารางหลัก`);
    eq(sum(u=>u.iT), main.iT, `${lv}: ยอดให้ออกรวม ตรงกับตารางหลัก`);
    eq(sum(u=>u.hT), main.hT, `${lv}: headcount รวม ตรงกับตารางหลัก`);
    eq(sum(u=>u.bT), main.nT-main.vT-main.iT, `${lv}: balance รวมลงตัว`);
  }
}

// ---------- คนที่ไม่ระบุหน่วยงาน ต้องไม่หายไปจากยอดรวม ----------
{
  const rows=[mkRow("2026-01","January",{n:[X1], a:[A1,X1]})];
  const bd=M.buildBreakdown(rows,"division");
  eq(bd.units.some(u=>u.name===M.UNSET), true, "มีแถว (ไม่ระบุ)");
  eq(bd.units.reduce((s,u)=>s+u.hT,0), 2,      "headcount รวมยังครบ 2 คน");
  eq(bd.units[bd.units.length-1].name, M.UNSET,"(ไม่ระบุ) อยู่แถวสุดท้ายเสมอ");
}

// ---------- การเรียงลำดับ ----------
{
  const C1=e("C1","Zeta","O1"), C2=e("C2","Zeta","O1"), D1=e("D1","Alpha","O1");
  const rows=[mkRow("2026-01","January",{a:[C1,C2,D1]})];
  const bd=M.buildBreakdown(rows,"division");
  eq(bd.units.map(u=>u.name), ["Zeta","Alpha"], "เรียงตามจำนวนคนมาก -> น้อย");
}

// ---------- turnover รายหน่วยงาน ----------
{
  // Mining: headcount 2 คนทั้ง 2 เดือน (เฉลี่ย 2) · ออก 1 คน -> 50%
  const rows=[
    mkRow("2026-01","January",{a:[A1,A2]}),
    mkRow("2026-02","February",{v:[A2], a:[A1,A2]}),
  ];
  const bd=M.buildBreakdown(rows,"division");
  eq(bd.units[0].tr, "50.00%", "turnover = ออก ÷ headcount เฉลี่ยของหน่วยงานนั้น");
}
{
  // หน่วยงานที่ไม่มีคนอยู่แล้ว ต้องไม่หารด้วยศูนย์
  const rows=[mkRow("2026-01","January",{v:[A1], a:[]})];
  const bd=M.buildBreakdown(rows,"division");
  eq(bd.units[0].tr, "0.00%", "headcount 0 -> 0.00% ไม่ใช่ NaN/Infinity");
}

// ---------- เดือนอนาคตต้องไม่ถูกนับ ----------
{
  const rows=[
    mkRow("2026-01","January",{n:[A1], a:[A1]}),
    {...mkRow("2026-02","February",{n:[A2,A3], a:[A1,A2,A3]}), future:true},
  ];
  const bd=M.buildBreakdown(rows,"division");
  eq(bd.months, 1,            "นับเฉพาะเดือนที่มีข้อมูลจริง");
  eq(bd.lastYM, "2026-01",    "headcount อ้างเดือนล่าสุดที่ไม่ใช่อนาคต");
  eq(bd.units[0].nT, 1,       "ไม่นับคนเข้าใหม่ของเดือนอนาคต");
}

// ---------- ไม่มีข้อมูลเลย ต้องไม่พัง ----------
{
  const bd=M.buildBreakdown([],"division");
  eq([bd.units.length,bd.lastYM,bd.months], [0,null,0], "ไม่มีข้อมูล -> คืนค่าว่าง ไม่ error");
  const bd2=M.buildBreakdown([{...mkRow("2026-01","January",{}),future:true}],"division");
  eq(bd2.units.length, 0, "มีแต่เดือนอนาคต -> ว่าง");
}

// ---------- ต้องไม่นิยามกฎวันที่ซ้ำในไฟล์นี้ (กันบั๊กเดิมกลับมา) ----------
eq(/function\s+(lastWorkYM|sepYM|isActiveAtMonthEnd|hcAtMonthEnd)\s*\(/.test(HC), false,
   "js/headcount.js ต้องไม่นิยามกฎวันที่เอง ให้ import จาก app.js เท่านั้น");
eq(HC.includes("buildBreakdown(rows,orgLevel)"), true,
   "หน้าเว็บเรียก buildBreakdown ด้วย rows ชุดเดียวกับตารางหลัก");

console.log(`\n${P} passed, ${F} failed`);
if (F > 0) throw new Error(F + " test(s) failed");
