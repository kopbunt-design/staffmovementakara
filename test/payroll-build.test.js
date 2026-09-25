// เทสตัวสร้าง Payroll Report จากไฟล์ดิบ — ดึงฟังก์ชันจริงจาก js/payroll-build.js
// รัน:  osascript -l JavaScript test/payroll-build.test.js
//
// ⚠️ ข้อมูลในไฟล์นี้เป็นข้อมูลสมมติล้วน — ห้ามเอาเงินเดือนจริงมาใส่เทส
//    (ตัวเลขจริงถูกตรวจแยกต่างหากโดยเทียบกับ Payroll Report_2026-08_rev2.xlsx ในเครื่อง
//     ผลคือ 429 ช่อง ตรงทั้งหมด แต่ไฟล์นั้นเป็นความลับจึงไม่ commit)
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;

const SRC = read(`${ROOT}/js/payroll-build.js`).replace(/^export /gm, "");
const M = new Function(`${SRC}
  return { buildReport, groupTotal, grandTotal, grandExpense, grandHeadcount, totalDeduction,
           netSalary, deptTotal, sheetRole, findHeaderRow, GROUPS, ALL_DEPTS, DEPT_KEY, LEVEL_TYPE,
           COST_CODES, COST_CODE_DOUBTS };`)();

let P = 0, F = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) === JSON.stringify(b)) P++; else { F++; console.log("FAIL " + m + "\n  got =" + JSON.stringify(a) + "\n  want=" + JSON.stringify(b)); } };

// ---------- ไฟล์เงินเดือนจำลอง ----------
const H = ["รหัสพนักงาน","ชื่อ-นามสกุล","สถานะคนลาออก","เงินเดือน","โอที 1","ค่ากะ","ค่าเดินทาง",
           "เงินจ่ายคืนวันลา","โบนัส","ค่าฝึกอบรม ERT","รายได้อื่นๆ","ขาด","ลา","พักงาน",
           "ภาษี","ประกันสังคม","กองทุนสำรองเลี้ยงชีพ","กยศ./กรอ.","บังคับคดี","กองทุนบริษัทสมทบ"];
//        รหัส      ชื่อ    สถานะ  เงินเดือน  ot1  ค่ากะ  เดินทาง  คืนลา โบนัส ERT  อื่นๆ ขาด ลา พักงาน ภาษี  สปส  กองทุน กยศ บังคับ กองทุนบ.
const R = (c,n,sal,ot,shift,tr,extra={}) => [c,n,"ปกติ",sal,ot,shift,tr,
  extra.leave||0, extra.bonus||0, extra.ert||0, extra.other||0,
  extra.absent||0, extra.lv||0, extra.susp||0,
  extra.tax||0, extra.sso||0, extra.pvd||0, extra.loan||0, extra.led||0, extra.pvdEr||0];

const EMPS = [
  { emp_code:"E1", division:"Operations", department:"Processing", section:"Process", team:"Process", job_level:"S2" },
  { emp_code:"E2", division:"Operations", department:"Processing", section:"Process", team:"Process", job_level:"O1" },
  { emp_code:"E3", division:"Commercial", department:"Supply",     section:"Purchasing", team:"Purchasing", job_level:"O3" },
  { emp_code:"E4", division:"Kingsgate",  department:"Legal",      section:"Legal",   team:"Legal",   job_level:"M1" },
  // คนที่ถูกแยกไป BKK Office ทั้งที่สังกัดเดียวกับ CRD — คีย์ต่อท้ายด้วยชื่อจริง
  { emp_code:"E5", division:"Sustainability", department:"Community Relations & Development",
    section:"Community Relations & Development", team:"Community Relations & Development",
    job_level:"M2", firstname_en:"Cherdsak" },
  { emp_code:"E6", division:"Sustainability", department:"Community Relations & Development",
    section:"Community Relations & Development", team:"Community Relations & Development", job_level:"M2" },
];
const ROWS = [
  R("E1","หนึ่ง",  100000, 0,    0,    0, { ert:1000, other:500, tax:5000, sso:750, pvd:3000 }),
  R("E2","สอง",     30000, 2000, 1800, 900, { tax:100, sso:750, pvd:900, loan:1000 }),
  R("E3","สาม",     20000, 500,  1200, 900, { absent:1000, lv:500, susp:250, led:2000 }),
  R("E4","สี่",    150000, 0,    0,    0,   { bonus:50000 }),
  R("E5","ห้า",    120000, 0,    0,    0,   { leave:3000 }),
  R("E6","หก",      90000, 0,    0,    0,   { pvdEr:4500 }),
  R("DAY01","รายวัน1", 11000, 0, 0, 0),
  R("DAY02","รายวัน2", 12000, 0, 0, 0),
];
const payroll = [H, ...ROWS];

const rep = M.buildReport({ payroll, employees:EMPS, month:"2026-08",
  assign:{ DAY01:{ dept:"CRD", type:"casual" }, DAY02:{ dept:"CRD", type:"casual" } } });

// ---------- แยก Senior / Staff ตามระดับงาน ----------
eq(rep.headcount("senior","Processing"), 1, "S2 = Senior Staff");
eq(rep.headcount("staff","Processing"),  1, "O1 = Staff");
eq(rep.get("senior","Basic Salary","Processing"), 100000, "เงินเดือน Senior");
eq(rep.get("staff","Basic Salary","Processing"),   30000, "เงินเดือน Staff");

// ---------- Basic Salary ต้องหัก ขาด/ลา/พักงาน ----------
// ถ้าลืมหักตัวใดตัวหนึ่ง ยอดจะเกินจริงโดยไม่มีใครรู้ — เคยพลาดเรื่อง "ลา" มาแล้วตอนถอดสูตร
eq(rep.get("staff","Basic Salary","Supply"), 20000 - 1000 - 500 - 250, "เงินเดือน ลบ ขาด+ลา+พักงาน");

// ---------- บรรทัดที่มีเฉพาะฝั่ง Staff ----------
eq(rep.get("staff","Transportation","Processing"), 900,  "ค่าเดินทางอยู่ฝั่ง Staff");
eq(rep.get("staff","Overtime","Processing"),      2000,  "โอทีอยู่ฝั่ง Staff");
eq(rep.get("staff","Shift Allowance","Processing"), 1800, "ค่ากะ");
// Senior ไม่มีบรรทัดค่าเดินทาง/โอที ถ้ามียอดต้องไปโผล่ที่ Other Income ไม่ใช่หายไป
{
  const r2 = M.buildReport({ payroll:[H, R("E1","หนึ่ง",100000,700,0,300)], employees:EMPS });
  eq(r2.get("senior","Other Income","Processing"), 1000, "โอที+ค่าเดินทางของ Senior ไปรวมที่ Other Income");
}

// ---------- คีย์สังกัดที่ต่อท้ายด้วยชื่อ ต้องมาก่อนคีย์แผนก ----------
// ถ้าค้นคีย์แผนกก่อน คนที่ถูกแยกไป BKK Office จะโดนกลืนกลับเข้า CRD
eq(rep.get("senior","Basic Salary","BKK Office"), 120000, "คนที่ระบุชื่อไว้ ไปลง BKK Office");
eq(rep.get("senior","Basic Salary","CRD"),         90000, "คนอื่นในสังกัดเดียวกันยังอยู่ CRD");
eq(rep.headcount("senior","BKK Office"), 1, "นับคนที่ BKK Office แยกจาก CRD");

// ---------- Kingsgate -> Legal ----------
eq(rep.get("senior","Basic Salary","Legal"), 150000, "Kingsgate/Legal ลงคอลัมน์ Legal");
eq(rep.get("bonus","Amount","Legal"), 50000, "โบนัสแยกเป็นบรรทัดของตัวเอง");
eq(rep.get("annualLeave","Amount","BKK Office"), 3000, "เงินจ่ายคืนวันลาแยกเป็นบรรทัด");

// ---------- แรงงานรายวัน (รหัส DAY) ----------
// ไม่มีในทะเบียนพนักงาน ต้องให้ผู้ใช้บอกแผนก และต้องไม่ถูกนับรวมกับพนักงานประจำ
eq(rep.headcount("casual","CRD"), 2, "DAY สองคนลงที่ CRD ตามที่ผู้ใช้เลือก");
eq(rep.get("casual","Amount","CRD"), 23000, "ยอดแรงงานรายวัน");
eq(rep.get("staff","Basic Salary","CRD"), 0, "DAY ต้องไม่ถูกนับเป็นพนักงานประจำ");
{
  // ไม่ได้บอกแผนก -> ต้องขึ้นรายการให้ผู้ใช้เลือก ไม่ใช่เงียบหายหรือเดาเอง
  const r3 = M.buildReport({ payroll:[H, R("DAY09","ใครไม่รู้",9000,0,0,0)], employees:EMPS });
  eq(r3.unassigned.length, 1, "DAY ที่ยังไม่ระบุแผนก ต้องถูกรายงาน");
  eq([r3.unassigned[0].code, r3.unassigned[0].amount], ["DAY09", 9000], "บอกรหัสและยอดที่ค้างอยู่");
  eq(M.grandExpense(r3), 0, "ยอดของคนที่ยังไม่ระบุแผนก ต้องไม่ถูกนับเข้ารายงาน");
}
{
  // พนักงานที่ไม่มีในทะเบียน ก็ต้องขึ้นเตือนเหมือนกัน
  const r4 = M.buildReport({ payroll:[H, R("ไม่มีคนนี้","ผี",50000,0,0,0)], employees:EMPS });
  eq(r4.unassigned.length, 1, "พนักงานที่ไม่พบในทะเบียน ต้องถูกรายงาน");
  eq(r4.unassigned[0].why, "ไม่พบใน ทะเบียนพนักงาน", "บอกสาเหตุ");
}

// ---------- รายการหัก เก็บรวมทั้งบริษัท ----------
eq(rep.ded.pnd1, 5100, "ภาษี");
eq(rep.ded.sso,  1500, "ประกันสังคม");
eq(rep.ded.pvd,  3900, "กองทุนสำรองเลี้ยงชีพ");
eq(rep.ded.studentLoan, 1000, "กยศ.");
eq(rep.ded.led,  2000, "บังคับคดี");
eq(rep.ded.pvdEmployer, 4500, "เงินสมทบฝั่งบริษัท แยกจากฝั่งพนักงาน");

// ---------- ยอดรวมกลุ่มและทั้งบริษัท ----------
eq(M.groupTotal(rep,"senior","Basic Salary",M.GROUPS[0]), 100000, "รวมกลุ่ม OPERATIONS");
eq(M.grandTotal(rep,"senior","Basic Salary"), 100000+150000+120000+90000, "รวมทั้งบริษัท");
eq(M.grandHeadcount(rep), 6 + 2, "จำนวนคนรวม นับแรงงานรายวันด้วย");
eq(M.totalDeduction(rep), 5100+1500+3900+1000+2000, "ยอดหักรวม ไม่รวมเงินสมทบบริษัท");
eq(M.netSalary(rep), M.grandExpense(rep) - M.totalDeduction(rep), "สุทธิ = รายจ่าย − หัก");

// ---------- ที่ปรึกษา ----------
{
  const CH = ["ID Card No.","Project/Team","Department/Position","Payment Type.","Name","Surname",
              "Income","LED","WHT 3%","Ref.1","Ref.2"];
  const cons = [["Consultant (Monthly)"],["August 2026"],[],CH,
    ["SUB1","Consultant","Regulatory Affairs","Monthly","A","B",17000,16490,510,"CONSULTANTS — TECHNICAL","Regulatory Affairs"],
    ["DAY9","","Supply","Service Agreement","C","D",10000,0,300,"CASUAL LABOUR","Supply"],
    ["SUB2","Consultant","Senior Surveyor","Monthly","E","F",75000,0,2250,"",""]];
  const rc = M.buildReport({ payroll:[H], employees:EMPS, consultants:cons });
  eq(rc.get("consultants","Amount","Regulatory Affairs"), 17000, "ที่ปรึกษาเข้าแผนกตาม Ref.2");
  eq(rc.get("casual","Amount","Supply"), 10000, "แรงงานรายวันจากไฟล์ที่ปรึกษา");
  eq(rc.ded.pnd3, 510+300+2250, "PND 3 มาจากไฟล์ที่ปรึกษา");
  eq(rc.ded.led, 16490, "บังคับคดีของที่ปรึกษารวมเข้าบรรทัดเดียวกัน");
  // แถวที่ไม่มี Ref.2 (เช่น "Senior Surveyor" ซึ่งไม่ใช่ชื่อแผนก) ต้องให้คนเลือกเอง
  eq(rc.unassigned.length, 1, "ที่ปรึกษาที่ไม่ระบุแผนก ต้องถูกรายงาน");
  eq(rc.unassigned[0].code, "SUB2", "บอกว่าเป็นใคร");
}

// ---------- รู้จักไฟล์จากหัวตาราง ----------
eq(M.sheetRole([H]), "payroll", "รู้ว่าเป็นไฟล์เงินเดือน");
eq(M.sheetRole([["ID Card No.","WHT 3%"]]), "consultant", "รู้ว่าเป็นไฟล์ที่ปรึกษา");
eq(M.sheetRole([["รหัสพนักงาน","ส่วน (อังกฤษ)"]]), "stafflist", "รู้ว่าเป็น Stafflist");
eq(M.sheetRole([["Job Level","Type"]]), "refJobLevel", "รู้ว่าเป็นตารางระดับงาน");
eq(M.sheetRole([["อะไรไม่รู้"]]), null, "ไฟล์ที่ไม่รู้จัก คืน null");

// หัวตารางอาจอยู่แถวสอง ถ้าเป็นสำเนาที่ HR เติมคำแปลอังกฤษไว้ข้างบน
eq(M.findHeaderRow([["Emp. Code","Basic Salary"], H]), 1, "หาแถวหัวตารางเจอแม้ไม่ได้อยู่แถวแรก");
{
  const r5 = M.buildReport({ payroll:[["Emp. Code","Name","Status","Basic Salary"], H, ...ROWS], employees:EMPS,
                             assign:{ DAY01:{dept:"CRD",type:"casual"}, DAY02:{dept:"CRD",type:"casual"} } });
  eq(r5.get("senior","Basic Salary","Processing"), 100000, "อ่านไฟล์ที่มีแถวคำแปลข้างบนได้");
}

// ---------- ชื่อคอลัมน์ที่ไม่คงที่ระหว่างการ export ----------
{
  const H2 = H.map(h => h === "ค่าเดินทาง" ? "เงินทดแทนการจัดรถรับส่ง" : h);
  const r6 = M.buildReport({ payroll:[H2, R("E2","สอง",30000,0,0,900)], employees:EMPS });
  eq(r6.get("staff","Transportation","Processing"), 900, "รับชื่อคอลัมน์ค่าเดินทางได้ทั้งสองแบบ");
}

// ---------- คอลัมน์ที่ระบบไม่รู้จัก ต้องถูกรายงาน ----------
{
  const r7 = M.buildReport({ payroll:[[...H,"เบี้ยขยันแบบใหม่"], [...R("E1","หนึ่ง",100000,0,0,0), 250]], employees:EMPS });
  eq(r7.unknownCols.length, 1, "เจอคอลัมน์ที่ยังไม่มีในตารางแปล");
  eq([r7.unknownCols[0].col, r7.unknownCols[0].total], ["เบี้ยขยันแบบใหม่", 250], "บอกชื่อและยอดที่ยังไม่ถูกนับ");
}

// ---------- รหัสบัญชี ----------
eq(M.COST_CODES["Processing"].length, 8, "รหัสบัญชีครบทุกหมวดของแต่ละแผนก");
eq(M.ALL_DEPTS.length, 20, "คอลัมน์แผนกในรายงาน 18 แผนก + BKK Office + Legal");
eq(Object.keys(M.COST_CODES).length, M.ALL_DEPTS.length, "ทุกแผนกมีรหัสบัญชี");
eq(M.COST_CODE_DOUBTS.length, 2, "ยังคงบันทึกไว้ว่ามีสองช่องที่น่าจะพิมพ์ผิดในไฟล์ต้นฉบับ");

console.log(F === 0 ? `ผ่านทั้งหมด ${P} เคส` : `ผ่าน ${P} · ตก ${F}`);
