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
           COST_CODES, COST_CODE_DOUBTS, toSummaryRows, repFromRows, columnList,
           SECTION_LABEL, groupHc, deptHeadcount, HC_SECTIONS, LEVEL_TYPE,
           deptDed, deptDeduction, deptNet, DED_LINES };`)();

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
eq(M.LEVEL_TYPE.M1, "senior", "M = Senior Staff");
eq(M.LEVEL_TYPE.S1, "senior", "S = Senior Staff");
eq(M.LEVEL_TYPE.O1, "staff",  "O = Staff");
eq(Object.keys(M.LEVEL_TYPE).filter(k => M.LEVEL_TYPE[k] === "senior").sort().join(","),
   "M1,M2,M3,M4,S1,S2,S3", "Senior Staff = M ทุกระดับ + S ทุกระดับ");
eq(Object.keys(M.LEVEL_TYPE).filter(k => M.LEVEL_TYPE[k] === "staff").sort().join(","),
   "O1,O2,O3", "Staff = O ทุกระดับ");
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
  // DAY ที่อยู่ในทะเบียนพนักงาน ต้องดึงแผนกมาใช้ได้เอง ไม่ต้องถาม — แต่ยังนับเป็นแรงงานรายวัน
  const r0 = M.buildReport({ payroll:[H, R("DAY77","รายวัน",9000,0,0,0)],
    employees:[...EMPS, { emp_code:"DAY77", division:"Sustainability",
      department:"Community Relations & Development", section:"Community Relations & Development",
      team:"Community Relations & Development", job_level:"O1" }] });
  eq(r0.unassigned.length, 0, "DAY ที่มีสังกัดในทะเบียน ไม่ต้องถาม");
  eq(r0.get("casual","Amount","CRD"), 9000, "ลงหมวดแรงงานรายวันที่แผนกตามทะเบียน");
  eq(r0.get("staff","Basic Salary","CRD"), 0, "ถึงจะมีระดับ O1 ในทะเบียน ก็ต้องไม่นับเป็นพนักงานประจำ");
}
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

// ---------- คนที่ถูกจัดด้วยมือ ต้องคืนออกมาให้แก้ได้ ----------
// เดิมพอเลือกแผนกเสร็จ แถวหายจากหน้าจอทันที เลือกผิดแล้วกลับไปแก้ไม่ได้เลย
eq(rep.assigned.length, 2, "คืนรายการที่ผู้ใช้เลือกเอง (DAY สองคน)");
eq(rep.assigned.map(a => a.code).sort(), ["DAY01","DAY02"], "บอกว่าเป็นใครบ้าง");
eq([rep.assigned[0].dept, rep.assigned[0].section], ["CRD","casual"], "บอกว่าถูกจัดไปไว้ที่ไหน");
eq(rep.assigned[0].amount, 11000, "บอกยอดด้วย จะได้ตรวจได้ว่าจัดถูกคน");
{
  // ล้างการเลือกแล้ว ต้องกลับไปอยู่ในรายการรอเลือก ไม่ใช่หายไปเฉย ๆ
  const r = M.buildReport({ payroll:[H, R("DAY01","รายวัน1",11000,0,0,0)], employees:EMPS, assign:{} });
  eq([r.assigned.length, r.unassigned.length], [0, 1], "ไม่มีการเลือก = กลับไปรอเลือก");
  eq(M.grandExpense(r), 0, "ยอดไม่ถูกนับจนกว่าจะเลือกใหม่");
}
{
  // ที่ปรึกษาที่ผู้ใช้เลือกแผนกให้ ก็ต้องคืนออกมาแก้ได้เหมือนกัน
  const CH = ["ID Card No.","Project/Team","Department/Position","Payment Type.","Name","Surname","Income","LED","WHT 3%"];
  const cons = [[],[],[],CH,["SUB9","Consultant","Senior Surveyor","Monthly","A","B",75000,0,2250]];
  const r = M.buildReport({ payroll:[H], employees:EMPS, consultants:cons,
                            assign:{ SUB9:{ dept:"Mining", section:"consultants" } } });
  eq(r.assigned.length, 1, "ที่ปรึกษาที่เลือกแผนกแล้ว ต้องคืนออกมา");
  eq([r.assigned[0].dept, r.assigned[0].section], ["Mining","consultants"], "จัดไปที่ Mining เป็นที่ปรึกษา");
  eq(r.get("consultants","Amount","Mining"), 75000, "ยอดเข้ารายงานแล้ว");
}
{
  // ที่ปรึกษาที่ยังไม่ระบุแผนก ต้องพกหมวดที่เดาได้ไปด้วย ช่องบนหน้าจอจะได้ตั้งต้นถูก
  const CH = ["ID Card No.","Project/Team","Department/Position","Payment Type.","Name","Surname","Income","LED","WHT 3%"];
  const cons = [[],[],[],CH,["SUB8","Consultant","Senior Surveyor","Monthly","A","B",75000,0,2250]];
  const r = M.buildReport({ payroll:[H], employees:EMPS, consultants:cons });
  eq(r.unassigned[0].section, "consultants", "จ่ายรายเดือน = เดาว่าเป็นที่ปรึกษา ไม่ใช่แรงงานรายวัน");
}

// ---------- ย้ายพนักงานที่ระบบจัดไปแล้ว ไปเป็นจ้างเหมา ----------
// คนที่มีครบทั้งสังกัดและระดับ ระบบจะจัดเป็น Senior/Staff ให้เอง
// แต่บางคนเป็นสัญญาจ้าง ต้องเปลี่ยนหมวดได้ และต้องไม่เหลือยอดค้างอยู่ในแถวเงินเดือน
{
  const r = M.buildReport({ payroll:[H, R("E2","สอง",30000,2000,1800,900)], employees:EMPS,
                            assign:{ E2:{ dept:"Processing", section:"contractors", type:"contractors" } } });
  eq(r.get("contractors","Amount","Processing"), 30000, "ยอดไปอยู่ในจ้างเหมาเป็นก้อนเดียว");
  eq(r.headcount("contractors","Processing"), 1, "นับหัวในหมวดจ้างเหมา");
  eq(r.get("staff","Basic Salary","Processing"), 0, "ต้องไม่เหลือในแถวเงินเดือน");
  eq(r.get("staff","Overtime","Processing"), 0, "ค่าโอทีก็ต้องไม่เหลือ");
  eq(r.headcount("staff","Processing"), 0, "ต้องไม่ถูกนับเป็นพนักงานประจำอีก");
  eq(M.deptHeadcount(r, "Processing"), 1, "นับรวมแล้วยังเป็น 1 คน ไม่ซ้ำ");
}
{
  // รายชื่อสำหรับให้หน้าจอค้นหา ต้องมีทุกคนที่จัดได้ และต้องไม่มีตัวเงินติดไปด้วย
  const r = M.buildReport({ payroll:[H, ...ROWS], employees:EMPS,
                            assign:{ DAY01:{dept:"CRD",type:"casual"}, DAY02:{dept:"CRD",type:"casual"} } });
  eq(r.people.length, 8, "มีครบทุกคนในไฟล์");
  eq(r.people.every(p => !("amount" in p)), true, "ไม่ส่งตัวเงินรายคนออกไปกับรายชื่อ");
  const e1 = r.people.find(p => p.code === "E1");
  eq([e1.dept, e1.section, e1.level], ["Processing","senior","S2"], "บอกว่าตอนนี้ระบบจัดไว้ที่ไหน");
}
{
  // คนจากไฟล์ที่ปรึกษาต้องค้นเจอด้วย — บางคนเป็นสัญญาจ้างที่ต้องย้ายไป Contractors
  const CH = ["ID Card No.","Project/Team","Department/Position","Payment Type.","คำนำหน้า","ชื่อ","นามสกุล","Name","Surname","Income","LED","WHT 3%"];
  const cons = [[],[],[],CH,
    ["SUB2620","Consultant","Administration","Monthly","นางสาว","กษิษฐา","เมืองแป้น","Kasittha","Meangpaen",20000,0,600]];
  const r = M.buildReport({ payroll:[H], employees:EMPS, consultants:cons });
  eq(r.people.map(p => p.code), ["SUB2620"], "คนจากไฟล์ที่ปรึกษาอยู่ในรายชื่อค้นหา");
  eq(r.people[0].section, "consultants", "ตั้งต้นเป็นที่ปรึกษาตามที่เดาได้");
  eq(r.people[0].name, "กษิษฐา เมืองแป้น", "ชื่อไทยขึ้นก่อน");
  eq(r.unassigned.length, 0, "ระบบจัดให้เองได้ จึงไม่ขึ้นในรายการที่ต้องระบุ");
  // ย้ายไปจ้างเหมา
  const r2 = M.buildReport({ payroll:[H], employees:EMPS, consultants:cons,
                             assign:{ SUB2620:{ dept:"Administration", section:"contractors" } } });
  eq(r2.get("contractors","Amount","Administration"), 20000, "ย้ายไป Contractors — Other ได้");
  eq(r2.get("consultants","Amount","Administration"), 0, "ไม่เหลือค้างในที่ปรึกษา");
  eq(r2.headcount("contractors","Administration"), 1, "นับหัวในหมวดใหม่");
}
{
  // ต้องเก็บชื่อทั้งสองภาษา — ช่องค้นหาเทียบจาก label + sub ถ้าเก็บแต่อังกฤษ พิมพ์ไทยจะหาไม่เจอ
  const CH = ["ID Card No.","Project/Team","Department/Position","Payment Type.","คำนำหน้า","ชื่อ","นามสกุล","Name","Surname","Income","LED","WHT 3%"];
  const cons = [[],[],[],CH,
    ["SUB2620","Consultant","Administration","Monthly","นางสาว","กษิษฐา","เมืองแป้น","Kasittha","Meangpaen",20000,0,600]];
  const r = M.buildReport({ payroll:[H], employees:EMPS, consultants:cons });
  eq(r.people[0].name,  "กษิษฐา เมืองแป้น", "แสดงชื่อไทยเป็นหลัก");
  eq(r.people[0].alias, "Kasittha Meangpaen", "เก็บชื่ออังกฤษไว้ให้ค้นเจอด้วย");
}
{
  // ไฟล์ที่ปรึกษาบางเดือนไม่มีคอลัมน์ Name/Surname ภาษาอังกฤษ ต้องถอยไปใช้ชื่อไทย
  const CH = ["ID Card No.","Project/Team","Department/Position","Payment Type.","คำนำหน้า","ชื่อ","นามสกุล","Income","LED","WHT 3%"];
  const cons = [[],[],[],CH,["SUB9","Consultant","Senior Surveyor","Monthly","นางสาว","กษิษฐา","เมืองแป้น",20000,0,600]];
  const r = M.buildReport({ payroll:[H], employees:EMPS, consultants:cons });
  eq(r.unassigned[0].name, "กษิษฐา เมืองแป้น", "ไม่มีชื่ออังกฤษก็ยังใช้ชื่อไทยได้");
}

// ---------- ค่าตอบแทนกรรมการ — หมวดของตัวเอง ไม่ใช่ที่ปรึกษาหรือจ้างเหมา ----------
{
  const CH = ["ID Card No.","Project/Team","Department/Position","Payment Type.","Name","Surname","Income","LED","WHT 3%"];
  const cons = [[],[],[],CH,["SUB1258","Consultant","Sustainability","Monthly","Charunmas","R",150000,0,4500]];
  const r = M.buildReport({ payroll:[H], employees:EMPS, consultants:cons,
                            assign:{ SUB1258:{ dept:"BKK Office", section:"director" } } });
  eq(r.get("director","Amount","BKK Office"), 150000, "ลงหมวดกรรมการที่ BKK Office");
  eq(r.headcount("director","BKK Office"), 1, "นับหัวในหมวดกรรมการ");
  eq(r.get("consultants","Amount","BKK Office"), 0, "ต้องไม่ไปอยู่ในที่ปรึกษา");
  eq(M.deptTotal(r, "BKK Office"), 150000, "ยอดรวมแผนกต้องนับหมวดกรรมการด้วย");
  eq(M.grandHeadcount(r), 1, "จำนวนคนรวมต้องนับหมวดกรรมการด้วย");
}
{
  // ค่าตอบแทนกรรมการที่จ่ายให้พนักงานประจำ — นับแต่ยอด ห้ามนับหัวซ้ำ
  const H2 = [...H, "ค่าตอบแทนกรรมการ"];
  const r = M.buildReport({ payroll:[H2, [...R("E1","หนึ่ง",100000,0,0,0), 80000]], employees:EMPS });
  eq(r.get("director","Amount","Processing"), 80000, "ยอดเข้าหมวดกรรมการ");
  eq(r.headcount("director","Processing"), 0, "ไม่นับหัวซ้ำ เพราะนับไปแล้วในแถว Senior");
  eq(r.get("senior","Other Income","Processing"), 0, "ต้องไม่ปนอยู่ใน Other Income อีก");
  eq(M.deptHeadcount(r, "Processing"), 1, "จำนวนคนรวมของแผนกยังเป็น 1");
}

// ---------- คนที่ไม่มีเงินเดือน มีแต่ค่าตอบแทนกรรมการ ----------
// เคสจริง ก.ย. 2026: KCN010 เงินเดือน 0 · ค่าตอบแทนกรรมการ 80,000 · รวมรายได้ 80,000
// ถ้าคิดยอดจากเงินเดือนอย่างเดียวจะได้ 0 แล้วเงินหายทั้งก้อนโดยไม่มีใครรู้
{
  const H2 = [...H, "ค่าตอบแทนกรรมการ", "รวมรายได้"];
  const row = [...R("KCN010","กรรมการ",0,0,0,0), 80000, 80000];
  const r = M.buildReport({ payroll:[H2, row], employees:EMPS,
                            assign:{ KCN010:{ dept:"BKK Office", section:"director" } } });
  eq(r.get("director","Amount","BKK Office"), 80000, "ใช้ยอดรายได้รวม ไม่ใช่เงินเดือน");
  eq(r.headcount("director","BKK Office"), 1, "นับหัว");
  eq(M.grandExpense(r), 80000, "เงินไม่หาย");
  eq(r.assigned[0].amount, 80000, "ตารางบนหน้าจอก็ต้องโชว์ยอดจริง");
}
{
  // ยังไม่ได้ระบุแผนก ก็ต้องบอกยอดที่ค้างให้ถูก ไม่ใช่ 0
  const H2 = [...H, "ค่าตอบแทนกรรมการ", "รวมรายได้"];
  const r = M.buildReport({ payroll:[H2, [...R("KCN010","กรรมการ",0,0,0,0), 80000, 80000]], employees:EMPS });
  eq(r.unassigned[0].amount, 80000, "ยอดที่ค้างต้องเป็นยอดจริง");
}
{
  // แรงงานรายวันที่เงินเดือน = รวมรายได้ ต้องได้เท่าเดิม ไม่เปลี่ยนเพราะเปลี่ยนสูตร
  const H2 = [...H, "รวมรายได้"];
  const r = M.buildReport({ payroll:[H2, [...R("DAY01","รายวัน",11000,0,0,0), 11000]], employees:EMPS,
                            assign:{ DAY01:{ dept:"CRD", type:"casual", section:"casual" } } });
  eq(r.get("casual","Amount","CRD"), 11000, "แรงงานรายวันได้เท่าเดิม");
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
{
  // ไฟล์ดิบไม่มี Ref.2 — ถ้าช่อง Department/Position เป็นชื่อแผนกตรง ๆ ก็ใช้ได้เลย
  const CH = ["ID Card No.","Project/Team","Department/Position","Payment Type.","Name","Surname","Income","LED","WHT 3%"];
  const cons = [[],[],[],CH,
    ["S1","Consultant","Regulatory Affairs","Monthly","A","B",17000,0,510],
    ["S2","Consultant","Community Relations & Development","Monthly","C","D",60000,0,1800],
    ["S3","Consultant","Senior Surveyor","Monthly","E","F",75000,0,2250]];
  const r = M.buildReport({ payroll:[H], employees:EMPS, consultants:cons });
  eq(r.get("consultants","Amount","Regulatory Affairs"), 17000, "ชื่อแผนกตรง ๆ ใช้ได้");
  eq(r.get("consultants","Amount","CRD"), 60000, "ชื่อยาวย่อเป็น CRD ได้");
  eq(r.unassigned.map(u => u.code), ["S3"], "เหลือถามเฉพาะแถวที่บอกแค่ตำแหน่ง");
  eq(r.unassigned[0].org, "Senior Surveyor", "แสดงสิ่งที่ไฟล์บอกมา เพื่อให้เลือกได้ถูก");
}

// ---------- จับคู่สังกัดแบบถอยหลังทีละขั้น ----------
// ตารางคีย์เต็มครอบคลุมเฉพาะเส้นทางที่มีอยู่ตอนทำ ref_dept — ทีมที่ตั้งใหม่ภายหลังต้องยังจับคู่ได้
{
  const rd = new Function(`${SRC} return resolveDept;`)();
  eq(rd({ division:"Operations", department:"Mining", section:"Chatree North", team:"Chatree North" }), "Mining",
     "ทีมใหม่ที่ไม่มีในตาราง ถอยไปใช้ชื่อ department");
  eq(rd({ division:"Operations", department:"Processing", section:"Maintenance", team:"ทีมใหม่" }), "Maintenance",
     "ชื่อ section ที่เป็นคอลัมน์ในรายงาน มาก่อน department");
  eq(rd({ division:"Sustainability", department:"Community Relations & Development",
          section:"หน่วยใหม่", team:"หน่วยใหม่" }), "CRD", "ชื่อยาวย่อเป็น CRD");
  eq(rd({ division:"Operations", department:"Occupational Health & Safety", section:"ใหม่", team:"ใหม่" }), "OH & S",
     "Occupational Health & Safety ย่อเป็น OH & S");
  eq(rd({ division:"Kingsgate", department:"อะไรก็ตาม", section:"x", team:"y" }), "Legal", "Kingsgate ลง Legal");
  // คีย์ที่เจาะจงกว่าต้องมาก่อนเสมอ ไม่งั้นคนที่ถูกแยกไป BKK Office จะโดนกลืนกลับ
  eq(rd({ division:"Sustainability", department:"Community Relations & Development",
          section:"Community Relations & Development", team:"Community Relations & Development",
          firstname_en:"Cherdsak" }), "BKK Office", "คีย์+ชื่อ ชนะคีย์แผนก");
  // ทะเบียนไม่ได้กรอกสังกัด -> ต้องคืน null เพื่อไปถามผู้ใช้ ไม่ใช่เดา
  eq(rd({ division:"-", department:"-", section:"-", team:"-" }), null, "ไม่มีสังกัด ต้องไม่เดา");
  eq(rd({ division:"Commercial", department:"-", section:"-", team:"-" }), null, "มีแต่ Division ยังไม่พอ");
}

// ---------- บอกสังกัดที่ระบบเห็น เวลาจับคู่ไม่ได้ ----------
{
  const r = M.buildReport({ payroll:[H, R("Z1","ใครสักคน",50000,0,0,0)],
    employees:[{ emp_code:"Z1", division:"Commercial", department:"-", section:"-", team:"-", job_level:"O1" }] });
  eq(r.unassigned.length, 1, "คนที่สังกัดไม่ครบ ต้องถูกถาม");
  eq(r.unassigned[0].org, "Commercial", "แสดงสังกัดเท่าที่มี เพื่อให้รู้ว่าทำไมจับคู่ไม่ได้");
  eq(r.unassigned[0].level, "O1", "แสดงระดับพนักงานด้วย");
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
eq(M.COST_CODES["Processing"].length, 9, "รหัสบัญชีครบทุกหมวดของแต่ละแผนก (รวมค่าตอบแทนกรรมการ)");
eq(M.ALL_DEPTS.length, 20, "คอลัมน์แผนกในรายงาน 18 แผนก + BKK Office + Legal");
eq(Object.keys(M.COST_CODES).length, M.ALL_DEPTS.length, "ทุกแผนกมีรหัสบัญชี");
eq(M.COST_CODE_DOUBTS.length, 1, "เหลือช่องที่ยังสงสัยอยู่หนึ่งช่อง (Mining · Senior)");
// ที่ปรึกษาของ Science & Health เคยใช้ฐานของ Maintenance ทำให้ลงบัญชีผิดแผนก
// ผู้ใช้ยืนยันแล้วว่าผิด จึงแก้ — เทสนี้กันไม่ให้เผลอกลับไปใช้ค่าเดิมตอนอัปเดตตารางรอบหน้า
eq(M.COST_CODES["Science & Health"][5], "507856301950", "ที่ปรึกษา Science & Health ใช้ฐานของตัวเอง");
eq(M.COST_CODES["Science & Health"][5].startsWith("5050038"), false, "ต้องไม่ใช่ฐานของ Maintenance อีก");

// ---------- ประกันสังคมฝั่งนายจ้าง ----------
{
  const H2 = [...H, "ประกันสังคมบริษัทสมทบ"];
  const r = M.buildReport({ payroll:[H2, [...R("E1","หนึ่ง",100000,0,0,0,{ sso:750 }), 750],
                                          [...R("E2","สอง",30000,0,0,0,{ sso:750 }), 750]], employees:EMPS });
  eq(r.ded.ssoEmployer, 1500, "รวมประกันสังคมฝั่งนายจ้าง");
  eq(M.totalDeduction(r), 1500, "เป็นเงินสมทบของบริษัท ไม่นับเป็นรายการหักของพนักงาน");
  eq(r.unknownCols.length, 0, "คอลัมน์นี้ระบบรู้จักแล้ว");
  const back = M.repFromRows(M.toSummaryRows(r, "2026-08"), "2026-08");
  eq(back.ded.ssoEmployer, 1500, "บันทึกแล้วอ่านกลับได้เท่าเดิม");
}

// ---------- รายการหักแยกรายแผนก เหมือนต้นฉบับ ----------
// ต้นฉบับแสดงยอดหักทุกบรรทัด + ยอดหักรวม + สุทธิ แยกตามคอลัมน์แผนก ไม่ใช่รวมบรรทัดเดียว
eq(M.deptDed(rep, "Processing", "pnd1"), 5000 + 100, "ภาษีของพนักงานใน Processing");
eq(M.deptDed(rep, "Supply", "led"), 2000, "บังคับคดีลงแผนกของคนนั้น");
eq(M.deptDed(rep, "CRD", "pvdEmployer"), 4500, "เงินสมทบบริษัทแยกรายแผนกด้วย");
eq(M.deptDeduction(rep, "Processing"), 5100 + 1500 + 3900 + 1000, "ยอดหักรวมของแผนก ไม่รวมเงินสมทบบริษัท");
eq(M.deptNet(rep, "Processing"), M.deptTotal(rep, "Processing") - M.deptDeduction(rep, "Processing"), "สุทธิรายแผนก");
// ผลรวมรายแผนกต้องเท่ากับยอดรวมทั้งบริษัท เมื่อทุกคนถูกจัดแผนกครบ
eq(M.ALL_DEPTS.reduce((t, d) => t + M.deptDeduction(rep, d), 0), M.totalDeduction(rep), "รวมรายแผนกเท่ากับยอดรวมทั้งบริษัท");
{
  // ภาษี 3% กับบังคับคดีของที่ปรึกษา ต้องลงแผนกของที่ปรึกษาคนนั้น
  const CH = ["ID Card No.","Project/Team","Department/Position","Payment Type.","Name","Surname","Income","LED","WHT 3%"];
  const cons = [[],[],[],CH,["S1","Consultant","Regulatory Affairs","Monthly","A","B",17000,16490,510]];
  const r = M.buildReport({ payroll:[H], employees:EMPS, consultants:cons });
  eq([M.deptDed(r, "Regulatory Affairs", "pnd3"), M.deptDed(r, "Regulatory Affairs", "led")], [510, 16490],
     "PND 3 และบังคับคดีของที่ปรึกษาลงแผนกที่ถูก");
}

// ---------- เก็บลงฐานข้อมูลแล้วอ่านกลับ ต้องได้ตัวเลขเดิม ----------
// นี่คือสิ่งที่ทำให้ "ดึงย้อนหลัง" เชื่อถือได้ — ถ้าแปลงไป-กลับแล้วเพี้ยน รายงานเก่าจะผิดเงียบ ๆ
{
  const rows = M.toSummaryRows(rep, "2026-08");
  eq(rows.every(r => r.month === "2026-08"), true, "ทุกแถวติดเดือนกำกับ");
  eq(rows.some(r => r.section === "SENIOR STAFF" && r.line_item === "Basic Salary"), true, "ใช้ชื่อหมวดชุดเดียวกับหน้าค่าใช้จ่ายเงินเดือน");
  eq(rows.some(r => r.col_kind === "group_total"), true, "มีคอลัมน์รวมกลุ่ม");
  eq(rows.some(r => r.col_kind === "grand_total"), true, "มีคอลัมน์รวมใหญ่");

  const back = M.repFromRows(rows, "2026-08");
  eq(back.get("senior","Basic Salary","Processing"), rep.get("senior","Basic Salary","Processing"), "อ่านกลับ: เงินเดือน Senior");
  eq(back.get("staff","Overtime","Processing"),      rep.get("staff","Overtime","Processing"),      "อ่านกลับ: โอที");
  eq(back.get("casual","Amount","CRD"),              rep.get("casual","Amount","CRD"),              "อ่านกลับ: แรงงานรายวัน");
  eq(back.headcount("senior","Processing"),          rep.headcount("senior","Processing"),          "อ่านกลับ: จำนวนคน");
  eq(back.ded.pnd1, rep.ded.pnd1, "อ่านกลับ: ภาษี");
  eq(back.ded.pvdEmployer, rep.ded.pvdEmployer, "อ่านกลับ: เงินสมทบบริษัท");
  eq(M.grandExpense(back),  M.grandExpense(rep),  "อ่านกลับแล้วยอดรวมใหญ่ต้องเท่าเดิม");
  eq(M.totalDeduction(back), M.totalDeduction(rep), "อ่านกลับแล้วยอดหักรวมต้องเท่าเดิม");
  eq(M.netSalary(back),      M.netSalary(rep),      "อ่านกลับแล้วยอดสุทธิต้องเท่าเดิม");
  eq(M.grandHeadcount(back), M.grandHeadcount(rep), "อ่านกลับแล้วจำนวนคนต้องเท่าเดิม");
  eq(back.fromHistory, true, "ติดธงว่ามาจากประวัติ ไม่ใช่เพิ่งคำนวณ");
  eq(M.deptDeduction(back, "Processing"), M.deptDeduction(rep, "Processing"), "อ่านกลับ: ยอดหักรายแผนกเท่าเดิม");
  eq(M.deptNet(back, "Processing"), M.deptNet(rep, "Processing"), "อ่านกลับ: สุทธิรายแผนกเท่าเดิม");
  eq(back.dedByDept, true, "ข้อมูลใหม่มียอดหักรายแผนก");
  // เดือนที่บันทึกก่อนมีการแยก: มีแต่แถวคอลัมน์รวมใหญ่ ต้องรู้ตัวว่าไม่มีข้อมูลรายแผนก ไม่ใช่ถือว่าเป็น 0
  const old = rows.filter(r => !(["DEDUCTION — STAFF EXPENSES","PROVIDENT FUND","SOCIAL SECURITY"].includes(r.section) && r.col_kind !== "grand_total"));
  const legacy = M.repFromRows(old, "2026-08");
  eq(legacy.dedByDept, false, "เดือนเก่ารู้ว่าไม่มียอดหักรายแผนก");
  eq(legacy.ded.pnd1, rep.ded.pnd1, "ยอดหักรวมทั้งบริษัทของเดือนเก่ายังอ่านได้");

  // คอลัมน์รวมที่เก็บไว้ ต้องเท่ากับผลรวมของแผนกในกลุ่ม ไม่ใช่เลขที่พิมพ์แยกกันไว้
  const gt = rows.find(r => r.col_kind === "group_total" && r.section === "SENIOR STAFF"
                         && r.line_item === "Basic Salary" && r.department === "OPERATIONS Total");
  eq(gt.value, M.groupTotal(rep, "senior", "Basic Salary", M.GROUPS[0]), "ยอดรวมกลุ่มคิดจากแผนกในกลุ่ม");
}

// ---------- ย้ายที่นั่งตั้งแต่เดือนหนึ่ง: แผนกเปลี่ยน แต่เดือนก่อนหน้าต้องเหมือนเดิม ----------
{
  const emp = [{ emp_code:"AKR24011081", division:"Operations", department:"Processing",
                 section:"Process", team:"Process", job_level:"M1" }];
  const pay = [H, R("AKR24011081","สมมติ",50000,0,0,0,{ sso:750 })];
  const who = m => M.buildReport({ payroll:pay, employees:emp, month:m }).people[0];
  eq([who("2026-08").dept, who("2026-08").section], ["Processing","senior"], "ส.ค. ยังลงแผนกเดิม");
  eq([who("2026-09").dept, who("2026-09").section], ["BKK Office","senior"], "ก.ย. ลง BKK Office ระดับยังมาจากทะเบียน");
  eq(who("2026-12").dept, "BKK Office", "เดือนหลังจากนั้นยังอยู่ BKK Office");
  const sep = M.buildReport({ payroll:pay, employees:emp, month:"2026-09" });
  eq(sep.get("ded","sso","BKK Office"), 750, "ยอดหักตามไปลงแผนกใหม่ด้วย");
  const man = M.buildReport({ payroll:pay, employees:emp, month:"2026-09",
                              assign:{ AKR24011081:{ dept:"Mining", section:"senior" } } }).people[0];
  eq(man.dept, "Mining", "ผู้ใช้เลือกเองบนหน้าจอยังชนะเสมอ");
}

console.log(F === 0 ? `ผ่านทั้งหมด ${P} เคส` : `ผ่าน ${P} · ตก ${F}`);
