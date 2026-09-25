// ===== สร้าง Payroll Report จากไฟล์ดิบ =====
// รับไฟล์เงินเดือนดิบ (BeforeProcessYDP) + ไฟล์ที่ปรึกษา แล้วประกอบเป็นรายงานค่าใช้จ่ายเงินเดือน
// ถอดวิธีคิดมาจากไฟล์ Payroll Report_2026-08_rev2.xlsx โดยเทียบผลทีละช่องจนตรงครบทั้งใบ
//
// ⚠️ ความลับของข้อมูล
// ไฟล์ดิบมีเงินเดือนรายคนทั้งบริษัท โมดูลนี้คำนวณในเบราว์เซอร์แล้วคืนเฉพาะยอดรวมระดับแผนก
// ไม่มีฟังก์ชันไหนคืนตัวเลขรายคนออกไป และไม่มีการเรียก Supabase ในไฟล์นี้เลย
//
// สิ่งที่ไฟล์ดิบ "ไม่มี" และต้องหามาจากที่อื่น (HR เคยเติมด้วยมือในไฟล์ rev2):
//   · แผนก + ระดับพนักงาน -> ดึงจากทะเบียนพนักงานในเว็บ (emp_code ตรงกัน 489/489 เมื่อ ส.ค. 2026)
//   · หมวด/แผนกของที่ปรึกษาและแรงงานรายวัน -> ให้ผู้ใช้เลือกบนหน้าจอ แล้วจำไว้ใช้เดือนถัดไป

// ---------- คอลัมน์ของรายงาน ----------
export const GROUPS = [
  { name:"OPERATIONS",     depts:["Administration","Human Resources","Laboratory","Geology","Mining","OH & S","Processing","Maintenance"] },
  { name:"SUSTAINABILITY", depts:["Communications","CRD","Environment","Regulatory Affairs","Science & Health"] },
  { name:"COMMERCIAL",     depts:["Finance & Accounting","Information Technology","Supply"] },
  { name:"EXPLORATION",    depts:["Exploration","Land Management"] },
];
export const STANDALONE = ["BKK Office", "Legal"];
export const ALL_DEPTS = [...GROUPS.flatMap(g => g.depts), ...STANDALONE];

// ---------- รหัสบัญชี ----------
// ดึงมาจากไฟล์ rev2 ทั้ง 160 ช่อง — ไม่ได้มาจากสูตร (เช่น Mining ระดับ Senior ใช้ฐาน 5040020
// แต่ช่องอื่นของ Mining ใช้ 5040023) จึงต้องเก็บเป็นตาราง ถ้าผังบัญชีเปลี่ยนต้องแก้ตรงนี้
// ลำดับ: senior · staff · annualLeave · bonus · severance · consultants · contractors · casual · director
// ช่อง director (ค่าตอบแทนกรรมการ) ใช้ฐานเดียวกับแรงงานรายวันแล้วเปลี่ยนท้ายเป็น 1090
// ยืนยันกับฝ่ายบัญชีแล้วเฉพาะ BKK Office: 507856001090 "BK OFC SS - Director's Fees"
// แผนกอื่นได้จากกฎเดียวกัน ถ้าผังบัญชีจริงไม่ตรงต้องแก้ที่นี่
export const SECTION_KEYS = ["senior","staff","annualLeave","bonus","severance","consultants","contractors","casual","director"];
export const COST_CODES = {
  "Administration":         ["506005001010","506005001020","509979109200","506005001040","509979109210","506005001950","506805801620","506005001030", "506005001090"],
  "Human Resources":        ["506005051010","506005051020","509979109200","506005051040","509979109210","506005051950","506005051620","506005051030", "506005051090"],
  "Laboratory":             ["505003601010","505003601020","509979109200","505003601040","509979109210","505003601950","505003601620","505003601030", "505003601090"],
  "Geology":                ["503001401010","503001401020","509979109200","503001401040","509979109210","503001401950","503001401620","503001401030", "503001401090"],
  "Mining":                 ["504002001010","504002301020","509979109200","504002301040","509979109210","504002301950","504002301620","504002301030", "504002301090"],
  "OH & S":                 ["506005601010","506005601020","509979109200","506005601040","509979109210","506005601950","506005601620","506005601030", "506005601090"],
  "Processing":             ["505003701010","505003701020","509979109200","505003701040","509979109210","505003701950","505003401620","505003701030", "505003701090"],
  "Maintenance":            ["505003801010","505003801020","509979109200","505003801040","509979109210","505003801950","505003801620","505003801030", "505003801090"],
  "Communications":         ["507856201010","507856201020","509979109200","507856201040","509979109210","507856201950","507856201620","507856201030", "507856201090"],
  "CRD":                    ["506005151010","506005151020","509979109200","506005151040","509979109210","506005151950","506005151620","506005151030", "506005151090"],
  "Environment":            ["506005501010","506005501020","509979109200","506005501040","509979109210","506005501950","506005501620","506005501030", "506005501090"],
  "Regulatory Affairs":     ["507856101010","507856101020","509979109200","507856101040","509979109210","507856101950","507856101620","507856101030", "507856101090"],
  "Science & Health":       ["507856301010","507856301020","509979109200","507856301040","509979109210","507856301950","507856301620","507856301030", "507856301090"],
  "Finance & Accounting":   ["506005301010","506005301020","509979109200","506005301040","509979109210","506005301950","n/a","506005301030", "506005301090"],
  "Information Technology": ["506005401010","506005401020","509979109200","506005401040","509979109210","506005401950","506005401620","506005401030", "506005401090"],
  "Supply":                 ["506005201010","506005201020","509979109200","506005201040","509979109210","509979101950","506005201620","506005201030", "506005201090"],
  "Exploration":            ["502004001010","502004001020","509979109200","502004001040","509979109210","n/a","n/a","502004001030", "502004001090"],
  "Land Management":        ["506805901010","506805901020","509979109200","506805901040","509979109210","506805901950","506805901620","506805901030", "506805901090"],
  "BKK Office":             ["507856001010","507856001020","509979109200","507856001040","509979109210","507856001950","507856001620","507856001030", "507856001090"],
  "Legal":                  ["507856401010","507856401020","509979109200","507856401040","509979109210","507856401950","n/a","507856401030", "507856401090"],
};
export const DED_CODES = {
  pvd:"509979059165", sso:"509979059160", studentLoan:"509979059100",
  led:"509957307204", pnd1:"509979059155", pnd3:"509979059150", pvdEmployer:"509979059165",
};
// ⚠️ ต่างจากไฟล์ต้นฉบับหนึ่งช่องโดยตั้งใจ
// Science & Health · ที่ปรึกษา ในไฟล์เดิมเป็น 505003801950 ซึ่งเป็นฐานของ Maintenance
// ทำให้ที่ปรึกษาของแผนกนี้ถูกลงบัญชี Maintenance — ผู้ใช้ยืนยัน 2026-09-25 ว่าเป็นที่ผิด
// แก้เป็น 507856301950 ซึ่งเป็นฐานของ Science & Health เอง
// (เดือน ส.ค. 2026 ยังไม่มีที่ปรึกษาในแผนกนี้ ยอดจึงเป็น 0 ความผิดพลาดเลยยังไม่เคยแสดงผล)

// ช่องที่ยังสงสัยแต่ยังไม่ได้แก้ — คงไว้ตามไฟล์เดิมจนกว่าจะมีคนยืนยัน
export const COST_CODE_DOUBTS = [
  { dept:"Mining", section:"senior", code:"504002001010", note:"ช่องอื่นของ Mining ใช้ฐาน 5040023" },
];

// ---------- สังกัด -> คอลัมน์ในรายงาน (ref_dept) ----------
// คีย์ = Division + Department + Section + Team ต่อกันตรง ๆ
// บางคีย์ต่อท้ายด้วยชื่อจริง เพราะมีบางคนถูกแยกไปลงที่ BKK Office ทั้งที่สังกัดเดียวกับคนอื่น
export const DEPT_KEY = {
  "OperationsAdministrationAdministrationAdministration":"Administration",
  "OperationsHuman ResourcesCompensation & BenefitsCompensation & Benefits":"Human Resources",
  "OperationsHuman ResourcesHuman Resources DevelopmentHuman Resources Development":"Human Resources",
  "OperationsHuman ResourcesHuman Resources ManagementHuman Resources":"Human Resources",
  "OperationsLaboratoryLaboratoryLaboratory":"Laboratory",
  "OperationsMiningGeologyGeology":"Geology",
  "OperationsMiningMining OperationMining Operation":"Mining",
  "OperationsMiningMine PlanningMine Planning":"Mining",
  "OperationsMiningMine PlanningCivil":"Mining",
  "OperationsOccupational Health & SafetyOccupational Health & SafetyOccupational Health & Safety":"OH & S",
  "OperationsProcessingProcessProcess":"Processing",
  "OperationsProcessingMetallurgyMetallurgy":"Processing",
  "OperationsProcessingMaintenanceMechanical":"Maintenance",
  "OperationsProcessingMaintenanceElectrical":"Maintenance",
  "OperationsProcessingMaintenancePlanning":"Maintenance",
  "OperationsProcessingMaintenanceProject":"Maintenance",
  "SustainabilityCommunicationsCommunicationsCommunications":"Communications",
  "SustainabilityCommunity Relations & DevelopmentCommunity Relations & DevelopmentCommunity Relations & Development":"CRD",
  "SustainabilityCommunity Relations & DevelopmentSustainable DevelopmentSustainable Development":"CRD",
  "SustainabilityEnvironmentEnvironmentEnvironment":"Environment",
  "SustainabilityRegulatory AffairsPermittingPermitting":"Regulatory Affairs",
  "SustainabilityRegulatory AffairsGovernment RelationsGovernment Relations":"Regulatory Affairs",
  "SustainabilityScience & HealthScience & HealthScience & Health":"Science & Health",
  "CommercialFinance & AccountingFinance & AccountingFinance & Accounting":"Finance & Accounting",
  "CommercialInformation TechnologyInformation TechnologyInformation Technology":"Information Technology",
  "CommercialInformation TechnologyInformation TechnologyNetwork Infrastructure":"Information Technology",
  "CommercialInformation TechnologyInformation TechnologyDigital Transformation":"Information Technology",
  "CommercialSupplyPurchasingPurchasing":"Supply",
  "CommercialSupplyWarehouseWarehouse":"Supply",
  "ExplorationExplorationExplorationExploration":"Exploration",
  "ExplorationLand ManagementLand ManagementLand Management":"Land Management",
  "KingsgateLegalLegalLegal":"Legal",
  "SustainabilityCommunity Relations & DevelopmentCommunity Relations & DevelopmentCommunity Relations & DevelopmentCherdsak":"BKK Office",
  "SustainabilityCommunity Relations & DevelopmentCommunity Relations & DevelopmentCommunity Relations & DevelopmentThanwat":"BKK Office",
};

// ชื่อสังกัดยาว ๆ ที่รายงานเรียกสั้นกว่า
export const DEPT_ALIAS = {
  "Community Relations & Development": "CRD",
  "Occupational Health & Safety": "OH & S",
};

// หาว่าพนักงานคนนี้ควรอยู่คอลัมน์ไหนของรายงาน
// ตารางคีย์เต็ม (DEPT_KEY) ครอบคลุมเฉพาะเส้นทางที่เคยมีอยู่ตอนทำ ref_dept — ทีม/แผนกที่ตั้งใหม่
// หลังจากนั้นจะไม่มีในตาราง ถ้าจับคู่แบบตรงตัวอย่างเดียวคนกลุ่มนั้นจะตกไปให้กรอกมือทุกเดือน
// จึงไล่จากเจาะจงที่สุดลงมา แล้วค่อยถอยไปดูชื่อ section / department ตรง ๆ
// ตรวจกับทะเบียนจริง 503 คนแล้ว: ไม่มีใครที่ตัวถอยหลังไปทับผลที่คีย์เต็มเคยให้ไว้
export function resolveDept(e) {
  const div  = norm(e.division), dept = norm(e.department);
  const sect = norm(e.section),  team = norm(e.team);
  const key  = div + dept + sect + team;
  const first = norm(e.firstname_en);
  if (first && DEPT_KEY[key + first]) return DEPT_KEY[key + first];
  if (DEPT_KEY[key]) return DEPT_KEY[key];
  const s = DEPT_ALIAS[sect] || sect;
  if (ALL_DEPTS.includes(s)) return s;
  const d = DEPT_ALIAS[dept] || dept;
  if (ALL_DEPTS.includes(d)) return d;
  if (div === "Kingsgate") return "Legal";
  return null;
}

export const orgPath = e => [e.division, e.department, e.section, e.team]
  .map(norm).filter(v => v && v !== "-").join(" / ") || "—";

// ระดับงาน -> Senior Staff / Staff (ref_joblevel)
export const LEVEL_TYPE = {
  M4:"senior", M3:"senior", M2:"senior", M1:"senior",
  S3:"senior", S2:"senior", S1:"senior",
  O3:"staff",  O2:"staff",  O1:"staff",
};

// ---------- คอลัมน์ในไฟล์ดิบ -> บรรทัดในรายงาน ----------
// ชื่อคอลัมน์ไม่คงที่ระหว่างการ export แต่ละครั้ง (เจอทั้ง "ค่าเดินทาง" และ "เงินทดแทนการจัดรถรับส่ง"
// ซึ่งเป็นค่าเดียวกัน) จึงรับได้หลายชื่อต่อหนึ่งบรรทัด
export const COL_ALIAS = {
  basic:        ["เงินเดือน","ตกเบิกเงินเดือน"],
  basicMinus:   ["ขาด","ลา","มาสาย","ออกก่อน","พักงาน"],   // หักออกจากเงินเดือน
  overtime:     ["โอที 1","โอที 1.5","โอที 2","โอที 2.5","โอที 3","โอทีเหมาชม.","ตกเบิกโอที"],
  shift:        ["ค่ากะ","ค่ากะปกติ","ค่ากะโอที","ค่ากะเกินโอที"],
  transport:    ["ค่าเดินทาง","เงินทดแทนการจัดรถรับส่ง"],
  ert:          ["ค่าฝึกอบรม ERT"],
  director:     ["ค่าตอบแทนกรรมการ"],
  otherIncome:  ["รายได้อื่นๆ","ค่าตอบแทนเลขานุการบริษัท","เงินช่วยเหลือค่าเช่าที่พักอาศัย",
                 "รายการได้พิเศษ","รายการได้พิเศษ 1","รายการได้พิเศษ 2","รายการได้พิเศษ 3",
                 "รายการได้ 12","รายการได้ 13","รายการได้ 14","รายการได้ 15","รายการได้ 16",
                 "รายการได้ 17","รายการได้ 18","รายการได้ 19","รายการได้ 20"],
  annualLeave:  ["เงินจ่ายคืนวันลา"],
  bonus:        ["โบนัส"],
  severance:    ["เงินชดเชย1","เงินชดเชย2"],
  // รายการหัก
  pnd1:         ["ภาษี","ภาษีเงินชดเชย"],
  sso:          ["ประกันสังคม"],
  pvd:          ["กองทุนสำรองเลี้ยงชีพ"],
  studentLoan:  ["กยศ./กรอ."],
  led:          ["บังคับคดี"],
  pvdEmployer:  ["กองทุนบริษัทสมทบ"],
};

// บรรทัดที่แสดงในตารางของแต่ละกลุ่มพนักงาน
export const SENIOR_LINES = ["Basic Salary","Shift Allowance","ERT Training","Other Income"];
export const STAFF_LINES  = ["Basic Salary","Shift Allowance","Transportation","Overtime","ERT Training","Other Income"];
const LINE_OF = { basic:"Basic Salary", shift:"Shift Allowance", transport:"Transportation",
                  overtime:"Overtime", ert:"ERT Training", otherIncome:"Other Income" };

// ---------- ตัวช่วย ----------
export const norm = s => String(s ?? "").replace(/\s+/g, " ").trim();
export const num = v => {
  if (v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/,/g, "").trim());
  return isFinite(n) ? n : 0;
};
export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ---------- รู้จักไฟล์ ----------
// ดูจากหัวตารางว่าชีตนี้คืออะไร ผู้ใช้จะได้โยนไฟล์เข้ามาพร้อมกันโดยไม่ต้องบอกว่าอันไหนเป็นอันไหน
export function sheetRole(aoa) {
  const flat = (aoa.slice(0, 6).flat() || []).map(norm);
  const has = s => flat.includes(s);
  if (has("รหัสพนักงาน") && has("เงินเดือน")) return "payroll";
  if (has("รหัสพนักงาน") && (has("ระดับพนักงาน (รหัส)") || has("ส่วน (อังกฤษ)"))) return "stafflist";
  if (has("ID Card No.") && has("WHT 3%")) return "consultant";
  if (has("Job Level") && has("Type")) return "refJobLevel";
  if (has("Division") && has("Item")) return "refDept";
  return null;
}

// แถวหัวตารางของชีตเงินเดือน — ไฟล์ดิบหัวอยู่แถวแรก แต่สำเนาที่ HR เติมคำอธิบายอังกฤษไว้
// จะมีหัวไทยอยู่แถวสอง จึงต้องหาว่าแถวไหนคือหัวจริง
export function findHeaderRow(aoa) {
  for (let i = 0; i < Math.min(aoa.length, 5); i++)
    if ((aoa[i] || []).map(norm).includes("รหัสพนักงาน")) return i;
  return -1;
}

// ---------- แกนกลาง ----------
// คืนเฉพาะยอดรวมระดับแผนก — ไม่มีตัวเลขรายคนหลุดออกไป
export function buildReport(input) {
  const { payroll, consultants = null, employees = [], assign = {}, month = "" } = input;

  const hr = findHeaderRow(payroll);
  if (hr < 0) throw new Error("ไม่พบคอลัมน์ “รหัสพนักงาน” ในไฟล์เงินเดือน");
  const head = (payroll[hr] || []).map(norm);
  const body = payroll.slice(hr + 1).filter(r => norm(r[0]));

  const colIdx = {};
  for (const [key, names] of Object.entries(COL_ALIAS))
    colIdx[key] = names.map(n => head.indexOf(n)).filter(i => i >= 0);
  const sum = (row, key) => colIdx[key].reduce((s, i) => s + num(row[i]), 0);

  // คอลัมน์ที่ไม่มีในตารางแปลเลย — บอกไว้ ไม่ปล่อยให้ยอดหายเงียบ ๆ
  const claimed = new Set(Object.values(COL_ALIAS).flat().map(norm));
  const IGNORE = new Set(["รหัสพนักงาน","ชื่อ-นามสกุล","สถานะคนลาออก","รายได้สุทธิ","รวมรายได้","รวมรายหัก","สุทธิ",
                          "ประกันสังคมบริษัทสมทบ","กองทุนสงเคราะห์ลูกจ้าง","กองทุนสงเคราะห์บริษัทสมทบ",
                          "หักเบิกเงินล่วงหน้า","เบิกเงินล่วงหน้า","ภาษีบริษัทจ่ายให้",
                          "ค่าอาหารปกติ","ค่าอาหารโอที","ค่าอาหารเกินโอที"]);
  const unknownCols = [];
  head.forEach((h, i) => {
    if (!h || claimed.has(h) || IGNORE.has(h) || /^รายการหัก/.test(h)) return;
    const t = round2(body.reduce((s, r) => s + num(r[i]), 0));
    if (t) unknownCols.push({ col:h, total:t });
  });

  // ทะเบียนพนักงาน -> แผนก + ระดับ
  const empMap = new Map();
  for (const e of employees) {
    if (!e.emp_code) continue;
    empMap.set(norm(e.emp_code), {
      dept: resolveDept(e),
      type: LEVEL_TYPE[norm(e.job_level).toUpperCase()] || null,
      org:  orgPath(e),
      level: norm(e.job_level) || "",
    });
  }

  // ---------- ตัวเก็บยอด ----------
  const cells = new Map();                       // "section|line|dept" -> number
  const add = (section, line, dept, v) => {
    if (!dept || !v) return;
    const k = `${section}|${line}|${dept}`;
    cells.set(k, round2((cells.get(k) || 0) + v));
  };
  const hc = new Map();                          // "section|dept" -> จำนวนคน
  const addHc = (section, dept, n = 1) => {
    if (!dept) return;
    hc.set(`${section}|${dept}`, (hc.get(`${section}|${dept}`) || 0) + n);
  };

  // หมวดที่ไม่ได้คิดเป็นพนักงานประจำ — ลงเป็นยอดก้อนเดียวในบรรทัด Amount ของหมวดนั้น
  const LUMP = new Set(["casual", "consultants", "contractors", "director"]);

  const unassigned = [];   // คนที่ยังไม่รู้ว่าลงแผนกไหน — ต้องให้ผู้ใช้เลือก
  // ทุกคนที่ประมวลผลได้ ไว้ให้หน้าจอค้นหาเพื่อเปลี่ยนหมวดทีหลัง — ไม่มีตัวเงินติดไปด้วย
  const people = [];
  // คนที่ลงแผนกได้เพราะผู้ใช้เลือกเอง — ต้องคืนออกไปด้วย ไม่งั้นพอเลือกแล้วแถวหายจากหน้าจอ
  // แล้วถ้าเลือกผิดจะไม่มีทางกลับไปแก้ได้เลย
  const assigned = [];
  const ded = { pnd1:0, sso:0, pvd:0, studentLoan:0, led:0, pnd3:0, pvdEmployer:0 };

  for (const row of body) {
    const code = norm(row[0]);
    const manual = assign[code];
    const known = empMap.get(code);

    // รายการหักเก็บรวมทั้งบริษัท ไม่แยกแผนก (รายงานก็แสดงรวมบรรทัดเดียว)
    ded.pnd1        += sum(row, "pnd1");
    ded.sso         += sum(row, "sso");
    ded.pvd         += sum(row, "pvd");
    ded.studentLoan += sum(row, "studentLoan");
    ded.led         += sum(row, "led");
    ded.pvdEmployer += sum(row, "pvdEmployer");

    // รหัส DAY* คือแรงงานรายวัน — นับเป็นหมวด casual เสมอ ไม่ใช่พนักงานประจำ
    // แต่แผนกยังดึงจากทะเบียนพนักงานได้ถ้ามี (ส.ค. 2026 ทั้งห้าคนอยู่ในทะเบียนและลง CRD ตรงกับรายงานจริง)
    // ที่ต้องถามคือเฉพาะคนที่ทะเบียนไม่มีหรือไม่ได้กรอกสังกัดไว้
    const isDay = /^DAY/i.test(code);
    const dept = manual?.dept || known?.dept || null;
    const type = isDay ? "casual" : (manual?.type || known?.type || null);

    if (!dept || !type) {
      unassigned.push({ code, name: norm(row[1]), kind: isDay ? "แรงงานรายวัน" : "พนักงาน",
                        amount: round2(sum(row, "basic") - sum(row, "basicMinus")),
                        org: known?.org || "—", level: known?.level || "",
                        why: !known ? (isDay ? "แรงงานรายวัน ไม่มีในทะเบียนพนักงาน" : "ไม่พบใน ทะเบียนพนักงาน")
                           : !known.dept ? "ทะเบียนพนักงานไม่ได้ระบุสังกัด หรือสังกัดยังไม่มีในผังรายงาน"
                           : "ทะเบียนพนักงานไม่ได้ระบุระดับพนักงาน" });
      continue;
    }

    const amount = round2(sum(row, "basic") - sum(row, "basicMinus"));
    if (manual?.dept)
      assigned.push({ code, name: norm(row[1]), kind: isDay ? "แรงงานรายวัน" : "พนักงาน",
                      amount, dept, section: type, org: known?.org || "—", level: known?.level || "" });

    people.push({ code, name: norm(row[1]), dept, section: type,
                  org: known?.org || "—", level: known?.level || "" });

    if (LUMP.has(type)) {
      addHc(type, dept);
      add(type, "Amount", dept, amount);
      continue;
    }

    addHc(type, dept);
    add(type, "Basic Salary",    dept, round2(sum(row, "basic") - sum(row, "basicMinus")));
    add(type, "Shift Allowance", dept, sum(row, "shift"));
    add(type, "ERT Training",    dept, sum(row, "ert"));
    add(type, "Other Income",    dept, sum(row, "otherIncome"));
    if (type === "staff") {
      add(type, "Transportation", dept, sum(row, "transport"));
      add(type, "Overtime",       dept, sum(row, "overtime"));
    } else {
      // ระดับ Senior ไม่มีบรรทัดค่าเดินทาง/โอทีในรายงาน ถ้ามียอดต้องบอก ไม่ใช่ทิ้งเงียบ ๆ
      const spill = sum(row, "transport") + sum(row, "overtime");
      if (spill) add(type, "Other Income", dept, spill);
    }
    // ค่าตอบแทนกรรมการของพนักงานที่เป็นกรรมการด้วย — นับแต่ยอด ไม่นับหัว
    // เพราะคนคนนั้นถูกนับไปแล้วในแถว Senior/Staff จะนับซ้ำไม่ได้
    add("director", "Amount", dept, sum(row, "director"));
    add("annualLeave", "Amount", dept, sum(row, "annualLeave"));
    add("bonus",       "Amount", dept, sum(row, "bonus"));
    add("severance",   "Amount", dept, sum(row, "severance"));
  }

  // ---------- ที่ปรึกษา / เหมาช่วง / แรงงานรายวัน จากไฟล์ที่ปรึกษา ----------
  const consRows = [];
  if (consultants) {
    const chr = consultants.findIndex(r => (r || []).map(norm).includes("ID Card No."));
    if (chr >= 0) {
      const ch = consultants[chr].map(norm);
      const ci = n => ch.indexOf(n);
      for (const r of consultants.slice(chr + 1)) {
        const id = norm(r[ci("ID Card No.")]);
        if (!id) continue;
        const a = assign[id] || {};
        // Ref.1/Ref.2 มีเฉพาะในไฟล์ที่ HR เติมเอง — ไฟล์ดิบไม่มี จึงเดาหมวดจาก Payment Type
        const refCat  = ci("Ref.1") >= 0 ? norm(r[ci("Ref.1")]) : "";
        const refDept = ci("Ref.2") >= 0 ? norm(r[ci("Ref.2")]) : "";
        const guessed = /service/i.test(norm(r[ci("Payment Type.")])) ? "casual" : "consultants";
        const section = a.section || ({ "CONSULTANTS — TECHNICAL":"consultants",
                                        "CONTRACTORS — OTHER":"contractors",
                                        "CASUAL LABOUR":"casual" }[refCat]) || guessed;
        // ไฟล์ที่ปรึกษาที่ HR เติมเองมีคอลัมน์ Ref.2 บอกแผนกไว้ ไฟล์ดิบไม่มี
        // จึงลองอ่านจากช่อง Department/Position ต่อ — บางแถวเป็นชื่อแผนกตรง ๆ ใช้ได้เลย
        // ที่เหลือเป็นชื่อตำแหน่ง (เช่น "Senior Surveyor") หรือชื่อสายงานกว้าง ๆ ซึ่งเดาไม่ได้ ต้องถาม
        const role = norm(r[ci("Department/Position")]);
        const byRole = DEPT_ALIAS[role] || role;
        const dept = a.dept
          || (ALL_DEPTS.includes(refDept) ? refDept : null)
          || (ALL_DEPTS.includes(byRole) ? byRole : null);
        // บางเดือนไฟล์ไม่มีคอลัมน์ Name/Surname ภาษาอังกฤษ ต้องถอยไปใช้ชื่อไทย
        const who = [norm(r[ci("Name")]), norm(r[ci("Surname")])].filter(Boolean).join(" ")
                    || [norm(r[ci("ชื่อ")]), norm(r[ci("นามสกุล")])].filter(Boolean).join(" ");
        const income = num(r[ci("Income")]);
        consRows.push({ id, name:[norm(r[ci("Name")]), norm(r[ci("Surname")])].filter(Boolean).join(" "),
                        role, section, dept, income });
        ded.pnd3 += num(r[ci("WHT 3%")]);
        ded.led  += num(r[ci("LED")]);
        if (!dept) {
          unassigned.push({ code:id, name:who,
                            kind:"ที่ปรึกษา / จ้างเหมา", amount:round2(income), section,
                            org: role || "—", level:"",
                            why:"ไฟล์บอกแค่ตำแหน่ง ไม่ได้บอกแผนกในรายงาน" });
          continue;
        }
        // ใส่ในรายชื่อค้นหาด้วย คนจากไฟล์ที่ปรึกษาก็ต้องย้ายหมวดได้ เช่นสัญญาจ้างที่ต้องลง Contractors
        people.push({ code:id, name:who, dept, section, org: role || "—", level:"" });
        if (a.dept)
          assigned.push({ code:id, name:who, kind:"ที่ปรึกษา / จ้างเหมา", amount:round2(income),
                          dept, section, org: role || "—", level:"" });
        addHc(section, dept);
        add(section, "Amount", dept, income);
      }
    }
  }

  for (const k of Object.keys(ded)) ded[k] = round2(ded[k]);

  return { month, cells, hc, ded, unassigned, assigned, people, unknownCols, consRows,
           get: (section, line, dept) => cells.get(`${section}|${line}|${dept}`) || 0,
           headcount: (section, dept) => hc.get(`${section}|${dept}`) || 0 };
}

// ---------- ยอดรวมของกลุ่มและทั้งบริษัท ----------
export const groupTotal = (rep, section, line, group) =>
  round2(group.depts.reduce((s, d) => s + rep.get(section, line, d), 0));
export const grandTotal = (rep, section, line) =>
  round2(ALL_DEPTS.reduce((s, d) => s + rep.get(section, line, d), 0));
export const groupHc = (rep, section, group) =>
  group.depts.reduce((s, d) => s + rep.headcount(section, d), 0);
export const grandHc = (rep, section) =>
  ALL_DEPTS.reduce((s, d) => s + rep.headcount(section, d), 0);

// ยอดรวมค่าใช้จ่ายทั้งรายงานของแผนกหนึ่ง
export function deptTotal(rep, dept) {
  let t = 0;
  for (const l of SENIOR_LINES) t += rep.get("senior", l, dept);
  for (const l of STAFF_LINES)  t += rep.get("staff",  l, dept);
  for (const s of ["annualLeave","bonus","severance","consultants","contractors","casual","director"])
    t += rep.get(s, "Amount", dept);
  return round2(t);
}
export const grandExpense = rep => round2(ALL_DEPTS.reduce((s, d) => s + deptTotal(rep, d), 0));
export const HC_SECTIONS = ["senior","staff","consultants","contractors","casual","director"];
export const grandHeadcount = rep =>
  HC_SECTIONS.reduce((s, sec) => s + grandHc(rep, sec), 0);
// จำนวนคนรวมของแผนกเดียว — ใช้ทำแถว TOTAL HEADCOUNT ในทุกหน้า
export const deptHeadcount = (rep, dept) => HC_SECTIONS.reduce((s, k) => s + rep.headcount(k, dept), 0);
export const totalDeduction = rep =>
  round2(rep.ded.pvd + rep.ded.sso + rep.ded.studentLoan + rep.ded.led + rep.ded.pnd1 + rep.ded.pnd3);
export const netSalary = rep => round2(grandExpense(rep) - totalDeduction(rep));

// ---------- แปลงเป็นแถวสำหรับเก็บลงฐานข้อมูล ----------
// ใช้ชื่อหมวด/บรรทัดชุดเดียวกับหน้า "ค่าใช้จ่ายเงินเดือน" (js/payroll-summary.js) โดยตั้งใจ
// รายงานที่สร้างจากไฟล์ดิบจะได้ไปโผล่ในหน้านั้นด้วย ไม่ต้องมีประวัติสองชุดที่ไม่ตรงกัน
export const SECTION_LABEL = {
  senior:"SENIOR STAFF", staff:"STAFF",
  annualLeave:"ANNUAL LEAVE (RESIGNED) & COMPENSATE",
  bonus:"EMPLOYEES BONUS", severance:"PROVISION FOR SEVERANCE PAYMENTS",
  consultants:"CONSULTANTS — TECHNICAL", contractors:"CONTRACTORS — OTHER", casual:"CASUAL LABOUR",
  director:"DIRECTOR'S FEE",
};
const DED_LABEL = [
  ["pvd","Provident Fund"], ["sso","Social Security"], ["studentLoan","Student Loan (general)"],
  ["led","Legal Execution Department"], ["pnd1","Clearing Account — Employee W/Tax (PND 1)"],
  ["pnd3","CL ACC EXP — Clearing Account W/Tax (PND 3)"],
];

// รายชื่อคอลัมน์พร้อมชนิด ใช้ทั้งตอนเก็บและตอนอ่านกลับ
export function columnList() {
  const out = []; let i = 0;
  for (const g of GROUPS) {
    for (const d of g.depts) out.push({ group:g.name, dept:d, kind:"dept", order:i++ });
    out.push({ group:g.name, dept:`${g.name} Total`, kind:"group_total", order:i++ });
  }
  for (const d of STANDALONE) out.push({ group:d, dept:d, kind:"dept", order:i++ });
  out.push({ group:"GRAND TOTAL", dept:"GRAND TOTAL", kind:"grand_total", order:i++ });
  return out;
}

export function toSummaryRows(rep, month) {
  const cols = columnList();
  const rows = [];
  let rowOrder = 0;
  const push = (c, section, line, value, kind, code) => rows.push({
    month, business_group:c.group, department:c.dept, col_kind:c.kind,
    section, line_item:line, cost_code:code || null,
    value: round2(value), value_kind:kind, row_order:rowOrder, col_order:c.order,
  });
  // ยอดของคอลัมน์รวม คิดจากแผนกในกลุ่มนั้น ไม่ได้เก็บซ้ำจากที่อื่น
  const valueAt = (c, fn) => {
    if (c.kind === "dept") return fn(c.dept);
    if (c.kind === "grand_total") return ALL_DEPTS.reduce((s, d) => s + fn(d), 0);
    const g = GROUPS.find(g => `${g.name} Total` === c.dept);
    return g ? g.depts.reduce((s, d) => s + fn(d), 0) : 0;
  };

  for (const [key, label] of Object.entries(SECTION_LABEL)) {
    const lines = key === "senior" ? SENIOR_LINES : key === "staff" ? STAFF_LINES : ["Amount"];
    const hasHc = HC_SECTIONS.includes(key);
    if (hasHc) {
      for (const c of cols) push(c, label, "Headcount", valueAt(c, d => rep.headcount(key, d)), "headcount");
      rowOrder++;
    }
    for (const line of lines) {
      for (const c of cols) push(c, label, line, valueAt(c, d => rep.get(key, line, d)), "amount",
        COST_CODES[c.dept]?.[SECTION_KEYS.indexOf(key)]);
      rowOrder++;
    }
    if (key === "senior" || key === "staff") {
      const total = d => lines.reduce((s, l) => s + rep.get(key, l, d), 0);
      const lbl = key === "senior" ? "Total — Senior Staff" : "Total — Staff";
      for (const c of cols) push(c, label, lbl, valueAt(c, total), "amount");
      rowOrder++;
    }
  }
  // รายการหักและยอดสรุป เก็บไว้ที่คอลัมน์รวมใหญ่คอลัมน์เดียว เพราะรายงานก็แสดงรวมบรรทัดเดียว
  const grand = cols[cols.length - 1];
  for (const [k, label] of DED_LABEL) {
    push(grand, "DEDUCTION — STAFF EXPENSES", label, rep.ded[k], "amount", DED_CODES[k]);
    rowOrder++;
  }
  push(grand, "PROVIDENT FUND", "Provident Fund Employer Contribution", rep.ded.pvdEmployer, "amount", DED_CODES.pvdEmployer);
  rowOrder++;
  for (const c of cols) push(c, "SUMMARY", "GRAND TOTAL — PAYROLL EXPENSE", valueAt(c, d => deptTotal(rep, d)), "amount");
  rowOrder++;
  for (const c of cols) push(c, "SUMMARY", "TOTAL HEADCOUNT", valueAt(c, d => deptHeadcount(rep, d)), "headcount");
  rowOrder++;
  push(grand, "SUMMARY", "GRAND TOTAL — DEDUCTION", totalDeduction(rep), "amount");
  rowOrder++;
  push(grand, "SUMMARY", "NET SALARY", netSalary(rep), "amount");
  return rows;
}

// ---------- อ่านกลับจากฐานข้อมูล ----------
// คืนวัตถุหน้าตาเดียวกับที่ buildReport คืน เพื่อให้ตัวพิมพ์/ตัว export ใช้ได้โดยไม่ต้องรู้ว่ามาจากไหน
export function repFromRows(rows, month) {
  const cells = new Map(), hc = new Map();
  const ded = { pnd1:0, sso:0, pvd:0, studentLoan:0, led:0, pnd3:0, pvdEmployer:0 };
  const BY_LABEL = Object.fromEntries(Object.entries(SECTION_LABEL).map(([k, v]) => [v, k]));
  const DED_BY_LABEL = Object.fromEntries(DED_LABEL.map(([k, v]) => [v, k]));
  for (const r of rows) {
    if (r.section === "DEDUCTION — STAFF EXPENSES") { const k = DED_BY_LABEL[r.line_item]; if (k) ded[k] = Number(r.value) || 0; continue; }
    if (r.section === "PROVIDENT FUND") { ded.pvdEmployer = Number(r.value) || 0; continue; }
    const key = BY_LABEL[r.section];
    if (!key || r.col_kind !== "dept") continue;     // คอลัมน์รวมคิดใหม่ได้ ไม่ต้องอ่านกลับ
    if (r.value_kind === "headcount") hc.set(`${key}|${r.department}`, Number(r.value) || 0);
    else cells.set(`${key}|${r.line_item}|${r.department}`, Number(r.value) || 0);
  }
  return { month, cells, hc, ded, unassigned:[], assigned:[], people:[], unknownCols:[], consRows:[],
           fromHistory:true,
           get:(s, l, d) => cells.get(`${s}|${l}|${d}`) || 0,
           headcount:(s, d) => hc.get(`${s}|${d}`) || 0 };
}
