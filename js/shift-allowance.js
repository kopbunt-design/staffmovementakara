// ===== คำนวณค่ากะ (Shift Allowance) =====
// อ้างอิงสเปค shift_allowance_calculation_spec.md
// Input: ไฟล์ Excel (sheet "Clean_Data") 1 แถว = 1 คน-1 วัน
// เรต: ใช้ครบ 3 ตระกูลกะ (เช้า/บ่าย/ดึก) = 1,800/เดือน, 2 ตระกูล = 1,200, ≤1 = 0
//      ยกเว้นกะที่ตั้ง solo_rate ไว้ (เช่น N03) ทำกะเดียวทั้งเดือนก็ยังได้ — ตั้งค่าที่ master_shift_codes
// จ่ายแบบ pro-rate รายวัน: daily_rate = monthly_rate / 30 คงที่ทุกเดือน (ไม่ใช่วันจริงในเดือน)
//      แล้วบวกทุกวันที่ "จ่าย" (payable) โดยยอดรวมทั้งเดือนต้องไม่เกิน monthly_rate
// ตัดวันนอกช่วงการจ้าง (ก่อน join_date / ตั้งแต่ end_date) ออกก่อนคำนวณเสมอ
// เกณฑ์เพิ่ม: จ่ายเฉพาะพนักงานระดับ O (O1/O2/O3) — เช็คจาก job_level ในตาราง employees
// กติกาทั้งหมดนี้ผู้ใช้ยืนยัน 2026-08-18 หลังเทียบกับเฉลยที่คิดมือของ ก.ค. 2026
import { esc, toast, userRole, allEmployees, currentUser } from "./app.js";
import { supabase } from "./supabase-config.js";

// shift code (upper-case) -> ตระกูลกะ
const FAMILY_MAP = {
  D01:"DAY", D02:"DAY", D03:"DAY", NOR:"DAY", F03:"DAY", F04:"DAY",
  A01:"AFT", A02:"AFT", A03:"AFT",
  N01:"NIT", N02:"NIT", N03:"NIT", N05:"NIT", N07:"NIT",
};
const FAMILY_TH = { DAY:"เช้า", AFT:"บ่าย", NIT:"ดึก" };
const PAYABLE = new Set(["WORKED","WEEKLY_OFF_DAY","HOLIDAY","PAID_LEAVE"]);
const ELIGIBLE_LEVELS = new Set(["O1","O2","O3"]); // เฉพาะระดับ O ได้ค่ากะ

// อัตรารายวัน = อัตราเดือน ÷ 30 คงที่ ทุกเดือน (ยอดรวมทั้งเดือนไม่เกินอัตราเดือน)
const DAILY_DIVISOR = 30;
// กะที่จ่ายแม้ทำกะเดียวทั้งเดือน (ปกติกะเดียว = 0) — ค่าเริ่มต้น เผื่อยังไม่ได้ตั้งใน DB
const SOLO_RATE = { N03: 1200 };
// ลาป่วยติดต่อกันกี่วันขึ้นไปถึงจะเด้งเตือนให้ HR ตรวจ
const SICK_RUN_WARN = 3;
// คู่กะที่จ่าย "เฉพาะวันที่เข้ากะจริง" ไม่ใช่เฉลี่ยทั้งเดือน
// NOR = เวลางานปกติ ไม่ถือเป็นการเข้ากะ จึงไม่จ่ายวัน NOR (ผู้ใช้ยืนยัน 2026-08-18)
// ใช้เฉพาะคู่นี้เท่านั้น — NOR คู่กับกะอื่นยังใช้กติกาเฉลี่ยทั้งเดือนตามปกติ
const PAY_ON_SHIFT_ONLY = { codes: ["NOR","N03"], payCode: "N03" };
// ...แต่ถ้าเข้า N03 (รวมวันหยุด/วันลาที่จ่ายได้) เกินจำนวนนี้ = ถือว่าอยู่กะดึกทั้งเดือน จ่ายเต็มอัตราไปเลย
const N03_FULL_THRESHOLD = 15;
// คู่รหัสกะที่ "ไม่คิดค่ากะเลย" ถ้าทั้งเดือนใช้แค่รหัสในชุดนี้
// เช็คจากรหัสตรง ๆ ไม่ผ่านตระกูลกะ -> ไม่ว่าจะจัด F01 เป็นตระกูลไหน ผลก็ยังเป็น 0 เหมือนเดิม
const NO_PAY_CODE_SETS = [["NOR","F01"]];
// พนักงานสาย Process ไม่ได้ค่ากะสำหรับวันที่เข้า N03 (วันกะอื่นยังได้ตามปกติ)
const PROCESS_WORDS = ["process"];
const PROCESS_NO_PAY_CODE = "N03";

// ดูจากข้อมูลพนักงานใน DB (จับคู่ด้วยรหัสพนักงาน) ว่าอยู่สาย Process ไหม
export function isProcessEmp(emp) {
  if (!emp) return false;
  const t = [emp.division, emp.department, emp.section, emp.team, emp.position]
    .map(v => String(v ?? "").toLowerCase()).join(" | ");
  return PROCESS_WORDS.some(w => t.includes(w));
}

// มีค่าจริงในเซลล์ไหม (ไม่ใช่ NaT/ว่าง) — 0 ถือว่ามีค่า (เช่น เวลาเที่ยงคืน = 0.0)
const has = v => v !== "" && v !== null && v !== undefined;

// แปลงเซลล์เป็นตัวเลข (รองรับ "1,234.50") — คืน null ถ้าไม่ใช่ตัวเลข
const num = v => {
  if (!has(v)) return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
};
// ต่างกันไม่เกิน 1 บาท = ถือว่าตรง (ต่างแค่การปัดเศษ)
const MATCH_TOL = 1;

// ===== อ่าน "ไฟล์เฉลย" ที่คิดมือ (คนละไฟล์กับไฟล์ลงเวลา) =====
// ไฟล์เฉลยมักเป็นไฟล์สรุป 1 บรรทัด/คน และตั้งชื่อคอลัมน์ได้หลายแบบ จึงต้องเดาให้
const norm = s => String(s).toLowerCase().replace(/[\s_\-.()]/g, "");
const COL_EMP = ["employeeid","empcode","empid","employeecode","employeeno","รหัสพนักงาน","รหัสพนง","รหัส","code","id"];
const COL_AMT = ["shiftallowance","ยอดค่ากะ","ค่ากะ","เบี้ยกะ","ยอดรวม","รวม","total","amount","จำนวนเงิน","ยอด"];
const COL_MON = ["month","เดือน","period","งวด","yearmonth","date","วันที่"];

// หาคอลัมน์แรกที่ชื่อ "ตรงเป๊ะ" ก่อน แล้วค่อยยอมให้ชื่อมีคำนั้นอยู่ข้างใน
function findCol(cols, cands) {
  for (const c of cands) { const hit = cols.find(k => norm(k) === c); if (hit) return hit; }
  for (const c of cands) { const hit = cols.find(k => norm(k).includes(c)); if (hit) return hit; }
  return null;
}

// แปลงค่าในคอลัมน์เดือนให้เป็น "YYYY-MM" (รับได้ทั้ง "2026-07", "07/2026", วันที่, serial)
function toYM(v) {
  const s = String(v ?? "").trim();
  let m = /^(\d{4})[-/](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${String(+m[2]).padStart(2,"0")}`;
  m = /^(\d{1,2})[-/](\d{4})$/.exec(s);
  if (m) return `${m[2]}-${String(+m[1]).padStart(2,"0")}`;
  const ymd = parseYMD(v);
  return ymd ? `${ymd.y}-${String(ymd.m).padStart(2,"0")}` : null;
}

// rows ของไฟล์เฉลย -> { byKey:Map("emp||ym"->ยอด), byEmp:Map(emp->ยอด), hasMonth, empCol, amtCol, monCol }
export function parseKeyFile(rows) {
  const cols = Object.keys(rows[0] || {});
  const empCol = findCol(cols, COL_EMP);
  const amtCol = findCol(cols, COL_AMT);
  const monCol = findCol(cols, COL_MON);
  if (!empCol || !amtCol) return { error: "หาคอลัมน์ไม่เจอ", cols, empCol, amtCol };

  const byKey = new Map(), byEmp = new Map();
  let counted = 0;
  for (const r of rows) {
    const emp = String(r[empCol] ?? "").trim();
    const amt = num(r[amtCol]);
    if (!emp || amt === null) continue;
    counted++;
    byEmp.set(emp, round2((byEmp.get(emp) || 0) + amt));
    const ym = monCol ? toYM(r[monCol]) : null;
    if (ym) { const k = `${emp}||${ym}`; byKey.set(k, round2((byKey.get(k) || 0) + amt)); }
  }
  return { byKey, byEmp, hasMonth: byKey.size > 0, empCol, amtCol, monCol, counted, cols };
}

// ===== เดาสาเหตุที่ยอดไม่ตรงกับเฉลย =====
// เฉลยที่คิดมือคิดอัตรารายวัน = อัตราเดือน ÷ 30 เสมอ (ยืนยันจากข้อมูลจริง ก.ค. 2026: ลงตัว 9/9 ราย)
// ระบบหารด้วยจำนวนวันจริงในเดือน จึงเอา "อัตรา ÷ 30" มาถอดกลับว่าเฉลยคิดกี่วัน แล้วเทียบกับที่ระบบคิด
const KEY_DIVISOR = DAILY_DIVISOR;
const REASON_TH = {
  "base30":        "ตัวหารต่างกัน",
  "days":          "จำนวนวันที่คิดไม่ตรงกัน",
  "single-family": "เกณฑ์กะเดียว",
  "zero-key":      "เฉลยไม่จ่ายเลย",
  "other":         "ยังไม่รู้สาเหตุ",
};
export function classifyDiff(r, tol = MATCH_TOL) {
  if (r.diff === null || Math.abs(r.diff) <= tol) return null;
  const rate = r.monthlyRate, perDay = rate / KEY_DIVISOR;

  // ระบบนับได้ตระกูลเดียว (อัตรา 0) แต่เฉลยยังจ่าย -> เกณฑ์จำนวนตระกูลไม่ตรงกัน
  if (rate === 0 && r.manual > 0)
    return { key:"single-family", label:`เฉลยจ่ายทั้งที่ระบบนับได้กะเดียว (${r.families})` };
  // เฉลยไม่จ่ายเลยทั้งที่ระบบจ่าย -> คนละเกณฑ์สิทธิ์ หรือไม่อยู่ในรอบจ่าย
  if (r.manual === 0)
    return { key:"zero-key", label:"เฉลยไม่จ่ายเลย (ระบบมองว่าเข้าเกณฑ์)" };

  if (rate) {
    // วันเท่ากัน ต่างแค่ตัวหาร (30 vs วันจริงในเดือน)
    if (Math.abs(r.manual - Math.min(perDay * r.payDays, rate)) <= tol)
      return { key:"base30", label:`วันเท่ากัน ต่างที่ตัวหาร (เฉลยหารด้วย ${KEY_DIVISOR})` };
    // จำนวนวันไม่ตรง -> ถอดกลับว่าเฉลยคิดกี่วัน
    const d = r.manual / perDay;
    if (Math.abs(d - Math.round(d)) < 0.02) {
      const n = Math.round(d);
      const hint = dateInMonth(r.endDate, r.month)  ? ` · พ้นสภาพ ${r.endDate}`
                 : dateInMonth(r.joinDate, r.month) ? ` · เข้าใหม่ ${r.joinDate}` : "";
      return { key:"days", label:`เฉลยคิด ${n} วัน · ระบบคิด ${r.payDays} วัน${hint}`, keyDays:n };
    }
  }
  return { key:"other", label:"ยังไม่เข้ารูปแบบที่รู้จัก" };
}
const dateInMonth = (d, ym) => !!d && String(d).substring(0,7) === ym;

// เอาเฉลยไปแปะลง summary ที่คำนวณไว้แล้ว -> { matched, missing, extra }
export function applyKeyFile(summary, key) {
  const used = new Set();
  let matched = 0, missing = 0;
  for (const r of summary) {
    const k = `${r.Employee_ID}||${r.month}`;
    // มีคอลัมน์เดือน = จับคู่ด้วยคน+เดือน · ไม่มี = จับคู่ด้วยรหัสคนอย่างเดียว
    let v = key.hasMonth ? key.byKey.get(k) : key.byEmp.get(r.Employee_ID);
    if (v === undefined) { r.manual = null; r.diff = null; missing++; continue; }
    used.add(key.hasMonth ? k : r.Employee_ID);
    r.manual = v; r.diff = round2(r.total - v); matched++;
  }
  const total = key.hasMonth ? key.byKey.size : key.byEmp.size;
  return { matched, missing, extra: total - used.size };
}

// แปลงเซลล์วันที่ (serial number / string / Date) -> {y,m,d}
function parseYMD(v) {
  if (!has(v)) return null;
  if (typeof v === "number" && window.XLSX?.SSF) {
    const o = window.XLSX.SSF.parse_date_code(v);
    return o ? { y:o.y, m:o.m, d:o.d } : null;
  }
  const s = String(v);
  const m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { y:+m[1], m:+m[2], d:+m[3] };
  const dt = new Date(s);
  return isNaN(dt) ? null : { y:dt.getFullYear(), m:dt.getMonth()+1, d:dt.getDate() };
}
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
// วันที่ของแถวในรูป "YYYY-MM-DD" (ใช้เทียบกับ join_date / end_date ที่เก็บเป็นข้อความ)
function rowDate(row) {
  const d = parseYMD(row.Date);
  return d ? `${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}` : null;
}
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const fmtB = n => Number(n).toLocaleString("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2});

// ===== คอลัมน์เสริมที่ไฟล์ลงเวลาอาจมี (ชื่อไม่แน่นอน จึงต้องตรวจจับ) =====
// เจอ = ใช้เป็นเงื่อนไขเพิ่ม · ไม่เจอ = ข้ามไป ระบบยังทำงานได้เหมือนเดิม
const COL_SUSPEND   = ["suspend","suspended","suspension","พักงาน","ถูกพักงาน","standdown"];
const COL_LEAVETYPE = ["leavetype","typeofleave","leavecode","ประเภทการลา","ประเภทลา","ชนิดการลา"];
// ปกติพักงาน/ลาป่วยไม่มีคอลัมน์เฉพาะ แต่เขียนไว้ในช่องหมายเหตุแบบข้อความอิสระ
const COL_NOTE      = ["note","notes","หมายเหตุ","remark","remarks","comment","comments"];
const SICK_WORDS    = ["sick","ป่วย"];
const SUSPEND_WORDS = ["พักงาน","suspend","suspension"];
// หมายเหตุที่บอกเองว่าวันนั้นไม่ได้เงิน — สำคัญกว่าชนิดการลา เช่น "ลาป่วยไม่จ่ายเงินหักเงิน"
const UNPAID_WORDS  = ["ไม่จ่ายเงิน","ไม่รับค่าจ้าง","ไม่ได้รับค่าจ้าง","หักเงิน","unpaid"];
// คอลัมน์ที่ระบบใช้อยู่แล้ว — กันไม่ให้การเดาชื่อไปทับของเดิม (เช่น "leave" ไปโดน Leave_Deduct)
const KNOWN_COLS = new Set(["leavededuct","leavenodeduct","deductday","daytype","checkin","checkout","shift"]);

export function detectExtraCols(cols) {
  const pick = cands => {
    for (const c of cands) { const h = cols.find(k => norm(k) === c); if (h) return h; }
    for (const c of cands) { const h = cols.find(k => norm(k).includes(c) && !KNOWN_COLS.has(norm(k))); if (h) return h; }
    return null;
  };
  return { suspendCol: pick(COL_SUSPEND), leaveTypeCol: pick(COL_LEAVETYPE), noteCol: pick(COL_NOTE) };
}

const noteText = (row, cols) => cols?.noteCol ? String(row[cols.noteCol] ?? "").trim() : "";
const hitWords = (txt, words) => { const t = txt.toLowerCase(); return words.some(w => t.includes(w)); };

// พักงานไหม — คอลัมน์เฉพาะก่อน ถ้าไม่มีให้จับคำในช่องหมายเหตุ
export function isSuspendRow(row, cols) {
  if (cols?.suspendCol && has(row[cols.suspendCol])) return true;
  const t = noteText(row, cols);
  return !!t && hitWords(t, SUSPEND_WORDS);
}

// ลาป่วยไหม — คอลัมน์ประเภทการลาก่อน ถ้าไม่มีให้จับคำในช่องหมายเหตุ
export function isSickRow(row, cols) {
  if (cols?.leaveTypeCol) {
    const v = String(row[cols.leaveTypeCol] ?? "").toLowerCase();
    if (v && SICK_WORDS.some(w => v.includes(w))) return true;
  }
  const t = noteText(row, cols);
  return !!t && hitWords(t, SICK_WORDS);
}

// หมายเหตุระบุเองว่าวันนั้นไม่ได้เงิน (ไม่ว่าจะลาชนิดไหน)
export function isUnpaidNote(row, cols) {
  const t = noteText(row, cols);
  return !!t && hitWords(t, UNPAID_WORDS);
}

// หา day_status ตามสเปค §4 (ลำดับเงื่อนไขสำคัญ)
function dayStatus(row, cols) {
  // พักงาน = ไม่จ่ายวันนั้น ต้องมาก่อนทุกเงื่อนไข (แม้จะมีเวลาเข้างานติดมา)
  if (isSuspendRow(row, cols)) return "SUSPENDED";
  // หมายเหตุบอกเองว่าไม่ได้เงิน -> เชื่อหมายเหตุ ก่อนจะไปดูว่าลาชนิดไหน
  if (isUnpaidNote(row, cols))  return "UNPAID_LEAVE";
  if (has(row.Deduct_Day))      return "ABSENT";        // ขาดงาน / หักวันเหมือนกัน
  if (has(row.Leave_Deduct))    return "UNPAID_LEAVE";  // ลาไม่รับค่าจ้าง
  if (row.Day_Type === "H")     return "WEEKLY_OFF_DAY"; // วันหยุดประจำสัปดาห์
  if (row.Day_Type === "HD")    return "HOLIDAY";        // วันหยุดนักขัตฤกษ์
  if (has(row.Leave_No_Deduct)) return "PAID_LEAVE";     // ลาได้เงิน
  if (has(row.Check_In))        return "WORKED";         // เข้างาน
  return "CHECK_NOTE";                                   // ไม่มีข้อมูล → ต้อง review
}

// คำนวณจาก rows ทั้งหมด + map พนักงาน (emp_code -> {job_level}) -> { summary:[], detail:[] }
// famMap: รหัสกะ (ตัวใหญ่) -> ตระกูล — ปกติมาจากตาราง master_shift_codes ใน DB
// ส่งไม่มา = ใช้ค่าเริ่มต้นในโค้ด (เผื่อยังไม่ได้สร้างตาราง)
// approvedNoWork = เซ็ตของ "รหัส||เดือน" ที่ HR กดอนุมัติให้จ่ายทั้งที่ไม่มีวันทำงานจริง (ลาป่วยยาว)
export function computeShiftAllowance(rows, empMap, famMap = FAMILY_MAP, soloMap = SOLO_RATE,
                                      approvedNoWork = new Set()) {
  const unknown = new Map(); // รหัสกะที่ไม่รู้จัก -> จำนวนวัน/คน (ทำให้นับตระกูลขาด ต้องเตือน)
  const clipped = [];        // คนที่มีวันนอกช่วงการจ้างถูกตัดออก (ต้องขึ้นเตือนให้ตรวจ)
  const sickRuns = [];       // คนที่ลาป่วยติดต่อกันหลายวัน (ให้ HR ตรวจก่อนจ่าย)
  const noWork = [];         // คนที่ไม่มีวันทำงานจริงเลยทั้งเดือน -> ไม่จ่ายจนกว่าจะอนุมัติ
  const processEmps = new Map(); // คนที่ระบบมองว่าเป็นสาย Process (ให้ตรวจว่าจับถูก)
  const cols = detectExtraCols(Object.keys(rows[0] || {}));
  // การจับคำในช่องหมายเหตุอาจจับผิด — เก็บข้อความที่จับได้ไว้ให้คนตรวจว่าถูกจริง
  const noteHits = { suspend: new Map(), sick: new Map(), unpaid: new Map() };
  const bump = (m, t) => m.set(t, (m.get(t) || 0) + 1);
  const groups = new Map();
  for (const row of rows) {
    const ymd = parseYMD(row.Date);
    if (!ymd) continue;
    const ym = `${ymd.y}-${String(ymd.m).padStart(2,"0")}`;
    const key = `${row.Employee_ID}||${ym}`;
    if (!groups.has(key)) groups.set(key, { ym, y:ymd.y, m:ymd.m, rows:[] });
    groups.get(key).rows.push(row);
  }

  const summary = [], detail = [];
  for (const g of groups.values()) {
    const first = g.rows[0] || {};
    const empId = String(first.Employee_ID || "").trim();

    // เช็คสิทธิ์จากระดับตำแหน่ง (DB) — ระดับ O ได้อัตโนมัติ, ระดับอื่นต้อง HR ติ๊ก override รายคน
    const emp = empMap.get(empId);
    const jobLevel = emp?.job_level || "";
    const found = !!emp;
    const override = emp?.shift_allowance_override === true;
    const levelOk = ELIGIBLE_LEVELS.has(jobLevel);
    const eligible = found && (levelOk || override);
    const granted = eligible && !levelOk; // ได้เพราะ HR ให้พิเศษ (ไม่ใช่ระดับ O)
    const reason = !found ? "ไม่พบใน DB" : (levelOk || override) ? "" : `ระดับ ${jobLevel || "-"}`;

    // ตัดวันที่อยู่นอกช่วงการจ้างออกก่อน — ไฟล์ลงเวลามักมีแถวยาวถึงสิ้นเดือนแม้คนออกไปแล้ว
    // end_date = "วันแรกที่พ้นสภาพ" (ตามกฎเดียวกับรายงานอื่น) วันทำงานวันสุดท้ายจึงเป็นวันก่อนหน้า
    const joinDate = emp?.join_date || "", endDate = emp?.end_date || "";
    const outOfPeriod = [];
    const inPeriod = g.rows.filter(row => {
      const d = rowDate(row);
      if (!d) return true;                                   // อ่านวันที่ไม่ได้ ให้ผ่านไปก่อน
      if (joinDate && d < joinDate)  { outOfPeriod.push({ row, why:"ก่อนเข้าทำงาน" }); return false; }
      if (endDate  && d >= endDate)  { outOfPeriod.push({ row, why:"หลังพ้นสภาพ" });  return false; }
      return true;
    });
    if (outOfPeriod.length) clipped.push({ empId, name:first.Employee_Name, month:g.ym,
      days:outOfPeriod.length, joinDate, endDate });
    for (const o of outOfPeriod) detail.push({
      Employee_ID: o.row.Employee_ID, Employee_Name: o.row.Employee_Name,
      Department: o.row.Department, Date: o.row.Date, Shift: o.row.Shift,
      Day_Type: o.row.Day_Type, day_status: "OUT_OF_PERIOD", family: "",
      job_level: jobLevel, eligible, Shift_Allowance: 0,
      เฉลยในไฟล์: "", ส่วนต่าง: "", หมายเหตุ: o.why,
    });

    // เตรียม status + family ของแต่ละแถว · รหัสกะที่ไม่รู้จักให้เก็บไว้เตือน
    const days = inPeriod.map(row => {
      const raw = String(row.Shift || "").trim();
      const code = raw.toUpperCase();
      const family = famMap[code] || null;
      const status = dayStatus(row, cols);
      if (raw && !family) {
        const u = unknown.get(code) || { code, days:0, payDays:0, emps:new Set() };
        u.days++;
        if (PAYABLE.has(status)) u.payDays++; // เฉพาะวันที่จ่ายได้เท่านั้นที่มีผลกับการนับตระกูล
        u.emps.add(empId);
        unknown.set(code, u);
      }
      const sick = isSickRow(row, cols);
      const note = noteText(row, cols);
      if (status === "SUSPENDED" && note) bump(noteHits.suspend, note);
      else if (status === "UNPAID_LEAVE" && note && isUnpaidNote(row, cols)) bump(noteHits.unpaid, note);
      if (sick && note)                   bump(noteHits.sick, note);
      return { row, family, status, code, sick, date: rowDate(row) };
    });

    // ===== ลาป่วยติดต่อกัน =====
    // ติดกันตั้งแต่ SICK_RUN_WARN วันขึ้นไป -> วันลาป่วยในช่วงนั้นไม่จ่าย (จ่ายเฉพาะวันที่ไม่ได้ลา)
    // สำคัญ: วันหยุดประจำสัปดาห์/วันหยุดนักขัตฤกษ์ที่คั่นกลาง ต้อง "ไม่ตัด" ช่วงให้ขาดตอน
    // มิฉะนั้น ป่วย-ป่วย-หยุด-ป่วย-ป่วย จะกลายเป็น 2+2 วัน แล้วหลุดเกณฑ์ทั้งที่ลายาว 4 วัน
    const byDate = [...days].sort((a,b) => String(a.date||"").localeCompare(String(b.date||"")));
    const isOffDay = d => d.status === "WEEKLY_OFF_DAY" || d.status === "HOLIDAY";
    let maxSickRun = 0;
    const sickDays = byDate.filter(d => d.sick).length;
    for (let i = 0; i < byDate.length; ) {
      if (!byDate[i].sick) { i++; continue; }
      let j = i, lastSick = i, count = 0;
      while (j < byDate.length) {
        if (byDate[j].sick)        { count++; lastSick = j; j++; }
        else if (isOffDay(byDate[j])) j++;        // วันหยุดคั่นกลาง = ข้ามไป ไม่ตัดช่วง
        else break;
      }
      maxSickRun = Math.max(maxSickRun, count);
      // ลายาวเกินเกณฑ์ -> วันลาป่วยในช่วง i..lastSick ไม่จ่าย (วันหยุดที่คั่นยังจ่ายตามปกติ)
      if (count >= SICK_RUN_WARN)
        for (let k = i; k <= lastSick; k++) if (byDate[k].sick) byDate[k].unpaidSick = true;
      i = lastSick + 1;
    }
    const unpaidSickDays = byDate.filter(d => d.unpaidSick).length;
    const suspendDays = days.filter(d => d.status === "SUSPENDED").length;

    // Pass 1: นับตระกูลกะที่ใช้ในวันที่จ่ายได้ (นับไว้แสดงเสมอเพื่อความโปร่งใส)
    const famUsed = new Set(), codesUsed = new Set();
    for (const d of days) if (PAYABLE.has(d.status)) {
      if (d.family) famUsed.add(d.family);
      if (d.code) codesUsed.add(d.code);
    }
    // ปกติกะเดียว = 0 แต่บางกะจ่ายแม้ทำกะเดียวทั้งเดือน (เช่น N03) — ตั้งค่าได้ที่ master_shift_codes.solo_rate
    const soloCode = codesUsed.size === 1 ? [...codesUsed][0] : null;
    const soloRate = soloCode ? (soloMap[soloCode] || 0) : 0;
    // ทั้งเดือนใช้แค่คู่รหัสที่ไม่คิดค่ากะ (เช่น NOR + F01) -> 0 ไม่ต้องดูตระกูลกะ
    const noPayPair = NO_PAY_CODE_SETS.find(set =>
      set.length === codesUsed.size && set.every(c => codesUsed.has(c)));

    const baseRate = famUsed.size >= 3 ? 1800 : famUsed.size === 2 ? 1200 : soloRate;
    const shiftRate = noPayPair ? 0 : baseRate;
    const solo = !noPayPair && famUsed.size <= 1 && soloRate > 0;  // ได้เพราะกฎกะเดี่ยว ไม่ใช่เพราะหมุนกะ

    // ต้องมีวันทำงานจริงอย่างน้อย 1 วัน — ลา/หยุดทั้งเดือน (เช่น ลาป่วยยาว) ไม่ได้ค่ากะ
    const workedDays = days.filter(d => d.status === "WORKED").length;
    const noWorkedDay = days.length > 0 && workedDays === 0;
    const approved = approvedNoWork.has(`${empId}||${g.ym}`);
    if (noWorkedDay && eligible && shiftRate > 0)
      noWork.push({ empId, name:first.Employee_Name, month:g.ym, days:days.length, sickDays, approved });
    if (maxSickRun >= SICK_RUN_WARN)
      sickRuns.push({ empId, name:first.Employee_Name, month:g.ym, run:maxSickRun,
                      sickDays, unpaidSickDays, approved });

    // ไม่เข้าเกณฑ์ระดับ → 0 · ไม่มีวันทำงานจริงเลย → 0 จนกว่า HR จะกดอนุมัติรายคน
    const monthlyRate = (eligible && (!noWorkedDay || approved)) ? shiftRate : 0;

    // ทำ NOR สลับ N03 เท่านั้น -> ปกติจ่ายเฉพาะวันที่เข้า N03 (วัน NOR ไม่จ่าย)
    // แต่ถ้า N03 + วันหยุด/วันลาที่จ่ายได้ เกิน 15 วัน = อยู่กะดึกทั้งเดือน -> จ่ายเต็มอัตราไปเลย
    const shiftOnly = PAY_ON_SHIFT_ONLY.codes.length === codesUsed.size
      && PAY_ON_SHIFT_ONLY.codes.every(c => codesUsed.has(c));
    const n03AndOff = days.filter(d => PAYABLE.has(d.status)
      && (d.code === PAY_ON_SHIFT_ONLY.payCode || !d.code)).length;
    const shiftOnlyFull = shiftOnly && n03AndOff > N03_FULL_THRESHOLD;
    const payShiftDaysOnly = shiftOnly && !shiftOnlyFull;

    // สาย Process: วันที่เข้า N03 ไม่จ่าย (วันกะอื่นยังจ่ายตามปกติ)
    const isProc = isProcessEmp(emp);
    if (isProc) processEmps.set(empId, { empId, name:first.Employee_Name,
      where: [emp?.division, emp?.department, emp?.section, emp?.team].filter(Boolean).join(" / ") });

    const earns = d => PAYABLE.has(d.status)
      && (!d.unpaidSick || approved)                     // ลาป่วยยาว -> ไม่จ่าย เว้นแต่ HR อนุมัติ
      && (!payShiftDaysOnly || d.code === PAY_ON_SHIFT_ONLY.payCode)
      && !(isProc && d.code === PROCESS_NO_PAY_CODE);

    // Pass 2: pro-rate รายวัน + เก็บ row-level
    // อัตรารายวัน = อัตราเดือน ÷ 30 คงที่ (ไม่ใช่วันจริงในเดือน) แต่รวมทั้งเดือนต้องไม่เกินอัตราเดือน
    // ผู้ใช้ยืนยันกติกานี้ 2026-08-18 หลังเทียบกับเฉลยที่คิดมือของ ก.ค. 2026
    const payDays = days.filter(earns).length;
    // อยู่กะดึกเกิน 15 วัน = จ่ายเต็มอัตราไปเลย ไม่ pro-rate
    const dailyRate = !payDays ? 0
      : shiftOnlyFull ? monthlyRate / payDays
      : Math.min(monthlyRate / DAILY_DIVISOR, monthlyRate / payDays);
    const capped = !shiftOnlyFull && payDays > DAILY_DIVISOR && monthlyRate > 0;

    // ถ้าไฟล์มีคอลัมน์ Shift_Allowance มาด้วย = "เฉลย" ที่คิดมือไว้แล้ว -> เก็บไว้เทียบ
    let total = 0, noPayDays = 0, checkDays = 0;
    let manual = 0, hasManualRow = false;
    for (const d of days) {
      const payable = earns(d);
      const amt = payable ? dailyRate : 0;
      if (payable) total += amt;
      else { noPayDays++; if (d.status === "CHECK_NOTE") checkDays++; }
      const mv = num(d.row.Shift_Allowance);
      if (mv !== null) { manual += mv; hasManualRow = true; }
      detail.push({
        Employee_ID: d.row.Employee_ID, Employee_Name: d.row.Employee_Name,
        Department: d.row.Department, Date: d.row.Date, Shift: d.row.Shift,
        Day_Type: d.row.Day_Type, day_status: d.unpaidSick ? `${d.status} (ลาป่วยยาว-ไม่จ่าย)` : d.status,
        family: d.family || "", job_level: jobLevel, eligible,
        Shift_Allowance: round2(amt),
        เฉลยในไฟล์: hasManualRow ? (mv ?? "") : "",
        ส่วนต่าง: mv === null ? "" : round2(amt - mv),
      });
    }

    summary.push({
      Employee_ID: empId, Employee_Name: first.Employee_Name, Department: first.Department,
      month: g.ym, job_level: jobLevel, eligible, granted, reason,
      joinDate: emp?.join_date || "", endDate: emp?.end_date || "",
      families: [...famUsed].map(f => FAMILY_TH[f] || f).join("+") || "-",
      familyCount: famUsed.size, monthlyRate, solo, soloCode: solo ? soloCode : "", capped,
      clippedDays: outOfPeriod.length, sickDays, maxSickRun, unpaidSickDays,
      suspendDays, workedDays, noWorkedDay,
      shiftOnly: payShiftDaysOnly, shiftOnlyFull, isProcess: isProc, approvedNoWork: approved,
      noPayPair: noPayPair ? noPayPair.join(" + ") : "",
      payDays, noPayDays, checkDays,
      total: round2(total),
      manual: hasManualRow ? round2(manual) : null,
      diff:   hasManualRow ? round2(total - manual) : null,
    });
  }

  summary.sort((a,b) => (a.Employee_ID>b.Employee_ID?1:-1) || (a.month>b.month?1:-1));
  const hasManual = summary.some(r => r.manual !== null);
  const unknownCodes = [...unknown.values()]
    .map(u => ({ code:u.code, days:u.days, payDays:u.payDays, emps:u.emps.size }))
    .sort((a,b) => b.payDays - a.payDays || b.days - a.days);
  const topHits = m => [...m.entries()].map(([text,count])=>({text,count}))
    .sort((a,b)=>b.count-a.count).slice(0,8);
  return { summary, detail, hasManual, unknownCodes, clipped, sickRuns, noWork, cols,
           processEmps: [...processEmps.values()],
           noteHits: { suspend: topHits(noteHits.suspend), sick: topHits(noteHits.sick),
                       unpaid: topHits(noteHits.unpaid) } };
}

let lastResult = null;
let lastMeta = null; // {sheetName, rowCount, notFound, ineligible}
let onlyDiff = false; // โหมดเทียบเฉลย: แสดงเฉพาะรายการที่ไม่ตรง
let lastRows = null;  // แถวดิบจากไฟล์ลงเวลา — เก็บไว้คำนวณใหม่เมื่อเพิ่มรหัสกะ
let lastKey = null;   // เฉลยที่อ่านไว้ — เอามาแปะซ้ำหลังคำนวณใหม่
let approvedNoWork = new Set(); // "รหัส||เดือน" ที่ HR อนุมัติให้จ่ายทั้งที่ไม่มีวันทำงาน (ลาป่วยยาว)

// รหัสกะเก็บใน DB (master_shift_codes) เพื่อให้เพิ่มกะใหม่ได้เองโดยไม่ต้องแก้โค้ด
// ถ้ายังไม่ได้สร้างตาราง/อ่านไม่ได้ ให้ถอยไปใช้ค่าเริ่มต้นในโค้ด ระบบจะได้ไม่พัง
let shiftFamilyMap = null;
let shiftSoloMap = null;
let shiftCodesFromDB = false;
async function ensureShiftCodes() {
  if (shiftFamilyMap) return shiftFamilyMap;
  try {
    const { data, error } = await supabase
      .from("master_shift_codes").select("code,family,solo_rate").eq("is_active", true);
    if (error) throw error;
    if (data?.length) {
      shiftFamilyMap = {}; shiftSoloMap = {};
      for (const r of data) {
        const c = String(r.code).trim().toUpperCase();
        shiftFamilyMap[c] = r.family;
        if (Number(r.solo_rate) > 0) shiftSoloMap[c] = Number(r.solo_rate);
      }
      shiftCodesFromDB = true;
      return shiftFamilyMap;
    }
    console.warn("[ค่ากะ] ตาราง master_shift_codes ว่าง — ใช้รหัสกะเริ่มต้นในโค้ด");
  } catch (e) {
    console.warn("[ค่ากะ] อ่าน master_shift_codes ไม่ได้ ใช้รหัสกะเริ่มต้นในโค้ด:", e.message);
  }
  shiftFamilyMap = { ...FAMILY_MAP };
  shiftSoloMap = { ...SOLO_RATE };
  shiftCodesFromDB = false;
  return shiftFamilyMap;
}

export function renderShiftAllowance() {
  const pg = document.getElementById("pageShiftallow");
  if (userRole !== "hr" && userRole !== "admin") {
    pg.innerHTML = `<div class="empty-state" style="padding-top:80px;"><div class="empty-title">ไม่มีสิทธิ์เข้าถึง</div><div class="empty-sub">เฉพาะ HR และ Admin</div></div>`;
    return;
  }
  pg.innerHTML = `
  <div class="page-header">
    <div><div class="page-heading">คำนวณค่ากะ</div><div class="page-sub">อัปโหลดไฟล์ลงเวลา (sheet Clean_Data) เพื่อคำนวณเบี้ยกะรายเดือน</div></div>
    <div class="header-actions">
      <button class="btn ${''}" id="saTabCalc" onclick="window._saTab('calc')">คำนวณใหม่</button>
      <button class="btn" id="saTabHist" onclick="window._saTab('hist')">ประวัติที่บันทึก</button>
    </div>
  </div>

  <div id="saCalcTab" class="section mt-4 pb-4">
    <div class="card card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div class="card-title" style="margin:0;">อัปโหลดไฟล์</div>
        <div>
          <!-- ใช้ <label for> แทนการสั่ง .click() ด้วย JS — Safari บล็อก .click() บน input ที่ display:none -->
          <input type="file" id="saFile" accept=".xlsx,.xls" onchange="window._saUpload(this)"
                 style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;border:0;overflow:hidden;clip:rect(0 0 0 0);">
          <label for="saFile" class="btn btn-primary" style="cursor:pointer;">📁 เลือกไฟล์ Excel</label>
          <input type="file" id="saKeyFile" accept=".xlsx,.xls" onchange="window._saKeyUpload(this)"
                 style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;border:0;overflow:hidden;clip:rect(0 0 0 0);">
          <label for="saKeyFile" class="btn btn-secondary" id="saKeyBtn" style="cursor:pointer;display:none;">📋 เทียบกับไฟล์เฉลย</label>
          <button class="btn btn-secondary" id="saSaveBtn" onclick="window._saSave()" style="display:none;">💾 บันทึกเดือนนี้</button>
          <button class="btn btn-gold" id="saExportBtn" onclick="window._saExport()" style="display:none;">📤 Export</button>
        </div>
      </div>
      <div style="font-size:13px;color:var(--muted);line-height:1.8;margin-top:10px;">
        • จ่ายเฉพาะพนักงาน <b>ระดับ O</b> (O1/O2/O3) — ตรวจจาก job_level ในระบบ · ระดับอื่น/ไม่พบ = ฿0<br>
        • ครบ <b>3 ตระกูลกะ</b> = <b>1,800</b>/เดือน · <b>2 ตระกูล</b> = <b>1,200</b> · กะเดียว = <b>0</b> (ยกเว้นกะที่ตั้ง "กะเดี่ยว" ไว้ เช่น N03 = 1,200)<br>
        • อัตรารายวัน = อัตราเดือน <b>÷ 30 คงที่</b> ทุกเดือน · ยอดรวมทั้งเดือนไม่เกินอัตราเดือน · <b>ตัดวันนอกช่วงการจ้างออก</b>ก่อนคำนวณ<br>
        • <b>เทียบกับที่คิดมือ:</b> ถ้าไฟล์ลงเวลามีคอลัมน์ <b>Shift_Allowance</b> อยู่แล้ว ระบบเทียบให้เอง —
          ถ้าเฉลยอยู่คนละไฟล์ (ไฟล์สรุป 1 บรรทัด/คน) ให้คำนวณก่อน แล้วกด <b>📋 เทียบกับไฟล์เฉลย</b>
      </div>
    </div>
    <div id="saResults" class="mt-4"></div>
  </div>

  <div id="saHistTab" class="section mt-4 pb-4" style="display:none;">
    <div class="card card-body" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <div class="card-title" style="margin:0;">ประวัติการบันทึก</div>
      <select class="filter-select" id="saHistMonth" onchange="window._saHistMonth(this.value)">
        <option value="">-- เลือกเดือน --</option>
      </select>
    </div>
    <div id="saHistResults" class="mt-4"></div>
  </div>`;

  window._saTab = (t) => {
    document.getElementById("saCalcTab").style.display = t==="calc" ? "" : "none";
    document.getElementById("saHistTab").style.display = t==="hist" ? "" : "none";
    document.getElementById("saTabCalc").classList.toggle("btn-primary", t==="calc");
    document.getElementById("saTabHist").classList.toggle("btn-primary", t==="hist");
    if (t==="hist") loadHistMonths();
  };
  window._saTab("calc");

  window._saUpload = (inputEl) => {
    const file = inputEl.files?.[0];
    inputEl.value = "";
    if (!file) return;
    if (!window.XLSX) { toast("กรุณารอโหลด library","error"); return; }
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const famMap = await ensureShiftCodes();
        const wb = window.XLSX.read(ev.target.result, { type:"binary" });
        const sheetName = wb.SheetNames.find(n => /clean/i.test(n)) || wb.SheetNames[0];
        const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval:"", raw:true });
        if (!rows.length) { toast(`sheet "${sheetName}" ไม่มีข้อมูล (ชีตในไฟล์: ${wb.SheetNames.join(", ")})`,"error"); return; }
        const cols = Object.keys(rows[0]);
        const missing = ["Employee_ID","Date"].filter(c => !cols.includes(c));
        if (missing.length) {
          // บอกให้ชัดว่าขาดอะไร และไฟล์มีคอลัมน์อะไรบ้าง จะได้แก้ไฟล์ถูก
          console.warn("[ค่ากะ] sheet:", sheetName, "คอลัมน์ที่พบ:", cols);
          toast(`sheet "${sheetName}" ขาดคอลัมน์ ${missing.join(" / ")} — ที่พบคือ: ${cols.slice(0,8).join(", ")}${cols.length>8?" …":""}`,"error");
          return;
        }
        // map emp_code -> employee (จาก state ที่โหลดไว้แล้ว)
        const empMap = new Map();
        for (const e of allEmployees) empMap.set(String(e.emp_code||"").trim(), e);
        lastRows = rows; lastKey = null; approvedNoWork = new Set(); // ไฟล์ใหม่ = เริ่มอนุมัติใหม่
        lastResult = computeShiftAllowance(rows, empMap, famMap, shiftSoloMap, approvedNoWork);
        const notFound = lastResult.summary.filter(r=>r.reason==="ไม่พบใน DB").length;
        const ineligible = lastResult.summary.filter(r=>!r.eligible && r.reason!=="ไม่พบใน DB").length;
        lastMeta = { sheetName, rowCount: rows.length, notFound, ineligible };
        onlyDiff = false;
        renderResults();
        if (lastResult.hasManual) {
          const bad = lastResult.summary.filter(r => r.diff !== null && Math.abs(r.diff) > MATCH_TOL).length;
          toast(bad ? `พบไม่ตรงกับเฉลย ${bad} รายการ` : "ตรงกับเฉลยในไฟล์ทุกรายการ ✅", bad ? "error" : "success");
        } else {
          toast(`คำนวณเสร็จ: ${lastResult.summary.length} คน-เดือน`,"success");
        }
      } catch (err) {
        toast("อ่านไฟล์ไม่ได้: " + err.message, "error");
      }
    };
    reader.readAsBinaryString(file);
  };

  window._saOnlyDiff = () => { onlyDiff = !onlyDiff; renderResults(); };

  // อนุมัติ/ยกเลิกอนุมัติจ่ายรายคน สำหรับคนที่ไม่มีวันทำงานจริงเลย (ลาป่วยยาว)
  window._saApprove = async (empId, month) => {
    const k = `${empId}||${month}`;
    if (approvedNoWork.has(k)) approvedNoWork.delete(k); else approvedNoWork.add(k);
    await recalc();
    toast(approvedNoWork.has(k) ? `อนุมัติจ่าย ${empId} แล้ว` : `ยกเลิกอนุมัติ ${empId}`,
          approvedNoWork.has(k) ? "success" : "info");
  };

  // คำนวณใหม่จากแถวเดิม (ใช้หลังเพิ่มรหัสกะ) แล้วแปะเฉลยเดิมกลับเข้าไป
  const recalc = async () => {
    if (!lastRows) return;
    const famMap = await ensureShiftCodes();
    const empMap = new Map();
    for (const e of allEmployees) empMap.set(String(e.emp_code||"").trim(), e);
    lastResult = computeShiftAllowance(lastRows, empMap, famMap, shiftSoloMap, approvedNoWork);
    lastMeta.notFound   = lastResult.summary.filter(r=>r.reason==="ไม่พบใน DB").length;
    lastMeta.ineligible = lastResult.summary.filter(r=>!r.eligible && r.reason!=="ไม่พบใน DB").length;
    if (lastKey) {
      const res = applyKeyFile(lastResult.summary, lastKey);
      lastResult.hasManual = res.matched > 0;
      lastMeta.keyFile = { ...lastMeta.keyFile, ...res };
    }
    renderResults();
  };

  // เพิ่มรหัสกะที่ระบบยังไม่รู้จัก เข้าตาราง master_shift_codes แล้วคำนวณใหม่ทันที
  window._saAddCode = async (code, idx) => {
    const sel = document.getElementById(`saFam${idx}`);
    if (!sel?.value) { toast("เลือกตระกูลกะก่อน","error"); return; }
    const { error } = await supabase.from("master_shift_codes")
      .insert({ code, family: sel.value, note: "เพิ่มจากหน้าคำนวณค่ากะ" });
    if (error) {
      toast(error.message.includes("row-level security")
        ? "ไม่มีสิทธิ์เพิ่มรหัสกะ (เฉพาะ HR/Admin)"
        : "เพิ่มไม่สำเร็จ: " + error.message, "error");
      return;
    }
    shiftFamilyMap = null;              // ล้าง cache ให้ไปอ่านใหม่
    await recalc();
    toast(`เพิ่มรหัสกะ ${code} = ${FAMILY_TH[sel.value]} แล้ว — คำนวณใหม่ให้เรียบร้อย`,"success");
  };

  // อัปโหลด "ไฟล์เฉลย" ที่คิดมือไว้ (คนละไฟล์กับไฟล์ลงเวลา) มาเทียบกับผลที่คำนวณไว้แล้ว
  window._saKeyUpload = (inputEl) => {
    const file = inputEl.files?.[0];
    inputEl.value = "";
    if (!file) return;
    if (!lastResult) { toast("ให้อัปโหลดไฟล์ลงเวลาแล้วคำนวณก่อน","error"); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb = window.XLSX.read(ev.target.result, { type:"binary" });
        // เลือกชีตแรกที่หาคอลัมน์รหัสพนักงาน+ยอดเงินเจอ
        let picked = null;
        for (const sn of wb.SheetNames) {
          const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval:"", raw:true });
          if (!rows.length) continue;
          const k = parseKeyFile(rows);
          if (!k.error) { picked = { sheet: sn, key: k, rowCount: rows.length }; break; }
        }
        if (!picked) {
          const first = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval:"", raw:true });
          const cols = Object.keys(first[0] || {});
          console.warn("[ค่ากะ] ไฟล์เฉลย — ชีต:", wb.SheetNames, "คอลัมน์ชีตแรก:", cols);
          toast(`ไฟล์เฉลยต้องมีคอลัมน์รหัสพนักงาน + ยอดค่ากะ — ที่พบคือ: ${cols.slice(0,8).join(", ")||"(ว่าง)"}`,"error");
          return;
        }
        lastKey = picked.key;
        const res = applyKeyFile(lastResult.summary, picked.key);
        lastResult.hasManual = res.matched > 0;
        if (!res.matched) { toast("จับคู่รหัสพนักงานไม่ได้เลย — ตรวจว่ารหัสในไฟล์เฉลยตรงกับ Employee_ID","error"); return; }
        lastMeta.keyFile = {
          name: file.name, sheet: picked.sheet, empCol: picked.key.empCol,
          amtCol: picked.key.amtCol, monCol: picked.key.monCol, ...res,
        };
        onlyDiff = false;
        renderResults();
        const bad = lastResult.summary.filter(r => r.diff !== null && Math.abs(r.diff) > MATCH_TOL).length;
        toast(bad ? `เทียบแล้ว: ไม่ตรง ${bad} รายการ` : `เทียบแล้ว: ตรงทุกรายการ ✅ (${res.matched})`, bad ? "error" : "success");
      } catch (err) {
        toast("อ่านไฟล์เฉลยไม่ได้: " + err.message, "error");
      }
    };
    reader.readAsBinaryString(file);
  };

  window._saSave = async () => {
    if (!lastResult) { toast("ยังไม่มีข้อมูลให้บันทึก","error"); return; }
    const rows = lastResult.summary
      .filter(r => r.Employee_ID)
      .map(r => ({
        emp_code:r.Employee_ID, employee_name:r.Employee_Name, department:r.Department,
        month:r.month, job_level:r.job_level, eligible:r.eligible,
        family_count:r.familyCount, monthly_rate:r.monthlyRate,
        pay_days:r.payDays, no_pay_days:r.noPayDays, check_days:r.checkDays,
        total:r.total, created_by: currentUser?.id || null,
      }));
    if (!rows.length) { toast("ไม่มีรายการที่มี emp_code","error"); return; }
    const btn = document.getElementById("saSaveBtn");
    btn.disabled = true; btn.textContent = "กำลังบันทึก...";
    const { error } = await supabase.from("shift_allowance").upsert(rows, { onConflict:"emp_code,month" });
    btn.disabled = false; btn.textContent = "💾 บันทึกเดือนนี้";
    if (error) { toast("บันทึกไม่สำเร็จ: " + error.message, "error"); return; }
    const months = [...new Set(rows.map(r=>r.month))].join(", ");
    toast(`บันทึกแล้ว ${rows.length} รายการ (เดือน ${months})`, "success");
  };

  window._saExport = () => {
    if (!lastResult || !window.XLSX) { toast("ยังไม่มีข้อมูลให้ export","error"); return; }
    const s = lastResult.summary.map(r => ({
      Employee_ID:r.Employee_ID, Employee_Name:r.Employee_Name, Department:r.Department,
      เดือน:r.month, ระดับ:r.job_level, เข้าเกณฑ์:r.eligible?"ใช่":"ไม่", หมายเหตุ:r.granted?"HR กำหนดพิเศษ":r.reason,
      ตระกูลกะ:r.families, จำนวนตระกูล:r.familyCount, อัตราต่อเดือน:r.monthlyRate,
      วันจ่าย:r.payDays, วันไม่จ่าย:r.noPayDays, ต้องตรวจสอบ:r.checkDays, ยอดค่ากะ:r.total,
      ...(lastResult.hasManual ? { เฉลยในไฟล์:r.manual, ส่วนต่าง:r.diff, สาเหตุที่น่าจะเป็น:classifyDiff(r)?.label || "" } : {}),
    }));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(s), "สรุปค่ากะ");
    // แยกชีตเฉพาะรายการที่ไม่ตรงกับเฉลย — ใช้ไล่หาสาเหตุได้เร็ว
    if (lastResult.hasManual) {
      const bad = s.filter(r => r.ส่วนต่าง !== null && Math.abs(r.ส่วนต่าง) > MATCH_TOL);
      window.XLSX.utils.book_append_sheet(wb,
        window.XLSX.utils.json_to_sheet(bad.length ? bad : [{ ผล:"ตรงกับเฉลยทุกรายการ" }]), "ไม่ตรงกับเฉลย");
    }
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(lastResult.detail), "รายวัน");
    window.XLSX.writeFile(wb, `shift_allowance_${new Date().toISOString().substring(0,10)}.xlsx`);
    toast("Export เสร็จสิ้น","success");
  };
}

// บอกว่าเงื่อนไขนี้อ่านจากไหน — คอลัมน์เฉพาะ, ช่องหมายเหตุ (จับคำ), หรือยังใช้ไม่ได้
function srcTxt(ownCol, noteCol, words) {
  if (ownCol)  return `คอลัมน์ <b>${esc(ownCol)}</b>`;
  if (noteCol) return `จับคำ <b>${words.map(esc).join(" / ")}</b> ในช่อง <b>${esc(noteCol)}</b>`;
  return `<b style="color:#b91c1c;">ไม่พบคอลัมน์ — กฎนี้ยังไม่มีผล</b>`;
}

function renderResults() {
  const el = document.getElementById("saResults");
  document.getElementById("saExportBtn").style.display = "inline-flex";
  document.getElementById("saSaveBtn").style.display = "inline-flex";
  document.getElementById("saKeyBtn").style.display = "inline-flex";
  const all = lastResult.summary;
  const cmp = lastResult.hasManual;                       // ไฟล์มีคอลัมน์เฉลยมาด้วยไหม
  const isBad = r => r.diff !== null && Math.abs(r.diff) > MATCH_TOL;
  const badRows = all.filter(isBad);
  const cmpCount = all.filter(r => r.diff !== null).length;   // เทียบได้จริงกี่รายการ
  const rows = (cmp && onlyDiff) ? badRows : all;

  const grand = round2(all.reduce((s,r)=>s+r.total, 0));
  const grandManual = round2(all.reduce((s,r)=>s+(r.manual||0), 0));
  const totalCheck = all.reduce((s,r)=>s+r.checkDays, 0);
  const { sheetName, rowCount, notFound, ineligible, keyFile: kf } = lastMeta;

  // สรุปว่าที่ไม่ตรงทั้งหมด เกิดจากสาเหตุไหนบ้าง กี่รายการ
  const reasonCount = {};
  for (const r of badRows) { const c = classifyDiff(r); if (c) reasonCount[c.key] = (reasonCount[c.key]||0)+1; }
  const reasons = Object.entries(reasonCount).sort((a,b)=>b[1]-a[1]);

  const unk  = lastResult.unknownCodes || [];
  const clip = lastResult.clipped || [];
  const clipSum = clip.reduce((s,c)=>s+c.days, 0);
  const granted = all.filter(r=>r.granted).length;
  const soloN   = all.filter(r=>r.solo).length;
  const sickR = lastResult.sickRuns || [];
  const noWk  = lastResult.noWork || [];
  const xcols = lastResult.cols || {};
  const hits  = lastResult.noteHits || { suspend:[], sick:[], unpaid:[] };
  const proc  = lastResult.processEmps || [];
  const suspendN = all.reduce((s,r)=>s+(r.suspendDays||0), 0);
  const warns = [];
  if (soloN)     warns.push(`${soloN} คนได้ค่ากะจากกฎกะเดี่ยว (ทำกะเดียวทั้งเดือนแต่กะนั้นจ่าย)`);
  const shiftOnlyN = all.filter(r=>r.shiftOnly).length;
  if (shiftOnlyN) warns.push(`${shiftOnlyN} คนทำ NOR สลับ N03 → จ่ายเฉพาะวันที่เข้า N03`);
  if (suspendN)  warns.push(`${suspendN} วันถูกพักงาน ไม่นับเป็นวันจ่าย`);
  const noPayN = all.filter(r=>r.noPayPair).length;
  if (noPayN) warns.push(`${noPayN} คนใช้แค่ ${NO_PAY_CODE_SETS[0].join("+")} ทั้งเดือน → ไม่คิดค่ากะ`);
  const shiftFullN = all.filter(r=>r.shiftOnlyFull).length;
  if (shiftFullN) warns.push(`${shiftFullN} คนอยู่ N03 เกิน ${N03_FULL_THRESHOLD} วัน → จ่ายเต็มอัตรา`);
  if (notFound)    warns.push(`${notFound} คนไม่พบใน DB (ตรวจว่า Employee_ID ตรงกับ emp_code)`);
  if (ineligible)  warns.push(`${ineligible} คนไม่ใช่ระดับ O → ฿0`);
  if (granted)     warns.push(`${granted} คนระดับไม่ใช่ O แต่ได้ค่ากะ (HR กำหนดพิเศษ)`);
  if (totalCheck)  warns.push(`${totalCheck} วันสถานะไม่ชัด (CHECK_NOTE) ไม่นับเป็นวันจ่าย`);

  el.innerHTML = `
  <div class="card">
    <div class="card-body" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;border-bottom:1px solid var(--border);">
      <div>
        <div class="card-title" style="margin:0;">ผลการคำนวณ · ${all.length} คน-เดือน <span style="font-weight:400;color:var(--muted);font-size:12px;">(sheet "${esc(sheetName)}" ${rowCount} แถว)</span></div>
        <div class="text-muted" style="font-size:11px;margin-top:2px;">
          พักงาน: ${srcTxt(xcols.suspendCol, xcols.noteCol, SUSPEND_WORDS)}
          · ลาป่วย: ${srcTxt(xcols.leaveTypeCol, xcols.noteCol, SICK_WORDS)}
        </div>
      </div>
      <div style="font-size:13px;">รวมค่ากะ: <b style="color:var(--green);font-size:16px;">${fmtB(grand)}</b> บาท</div>
    </div>
    ${cmp ? `<div class="card-body" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);background:${badRows.length?"var(--gold-light)":"rgba(22,163,74,.08)"};">
      <div style="font-size:13px;">
        ${badRows.length
          ? `<b style="color:var(--gold-dark);">⚠️ ไม่ตรงกับเฉลย ${badRows.length} รายการ</b> <span class="text-muted">· ตรง ${cmpCount-badRows.length} รายการ (ต่างไม่เกิน ${MATCH_TOL} บาท = ถือว่าตรง)</span>`
          : `<b style="color:var(--green);">✅ ตรงกับเฉลยทุกรายการที่เทียบได้ (${cmpCount})</b>`}
        <span class="text-muted"> · เฉลยรวม ${fmtB(grandManual)} · แอปคำนวณ ${fmtB(grand)} · ส่วนต่าง ${fmtB(round2(grand-grandManual))}</span>
        ${reasons.length ? `<div style="font-size:12px;margin-top:5px;color:var(--text);">
          <b>สาเหตุที่จับได้:</b> ${reasons.map(([k,n])=>`${esc(REASON_TH[k]||k)} <b>${n}</b>`).join(" · ")}
        </div>` : ""}
        ${kf ? `<div class="text-muted" style="font-size:11px;margin-top:3px;">
          เฉลยจาก "${esc(kf.name)}" · ชีต "${esc(kf.sheet)}" · อ่านรหัสจากคอลัมน์ <b>${esc(kf.empCol)}</b> · ยอดจาก <b>${esc(kf.amtCol)}</b>${kf.monCol?` · เดือนจาก <b>${esc(kf.monCol)}</b>`:" · ไม่มีคอลัมน์เดือน จับคู่ด้วยรหัสอย่างเดียว"}
          ${kf.missing?` · <b>${kf.missing} รายการในระบบไม่มีในเฉลย</b>`:""}${kf.extra?` · <b>${kf.extra} รายการในเฉลยไม่มีในระบบ</b>`:""}
        </div>` : ""}
      </div>
      ${badRows.length ? `<button class="btn btn-sm ${onlyDiff?"btn-primary":"btn-secondary"}" onclick="window._saOnlyDiff()">${onlyDiff?"แสดงทั้งหมด":"แสดงเฉพาะที่ไม่ตรง"}</button>` : ""}
    </div>` : ""}
    ${warns.length ? `<div class="card-body" style="background:var(--gold-light);color:var(--gold-dark);font-size:12px;padding:8px 16px;">⚠️ ${warns.map(esc).join(" · ")}</div>` : ""}
    ${noWk.length ? `<div class="card-body" style="background:#fef2f2;border-bottom:1px solid var(--border);padding:11px 16px;">
      <div style="font-size:13px;color:#b91c1c;font-weight:700;margin-bottom:2px;">🛑 ไม่มีวันทำงานจริงเลยทั้งเดือน ${noWk.length} คน — รออนุมัติรายคน</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:7px;">
        ส่วนใหญ่คือลาป่วยยาว · ระบบตั้งไว้ที่ <b>฿0 ก่อน</b> ถ้าจะจ่ายให้กด "อนุมัติจ่าย" เป็นรายคน แล้วยอดจะคิดใหม่ทันที
      </div>
      <div class="table-wrap" style="max-height:170px;overflow:auto;">
        <table class="data-table" style="font-size:11px;">
          <thead><tr><th>รหัส</th><th>ชื่อ</th><th class="text-right">ลาป่วย</th><th class="text-right">วันทั้งหมด</th><th></th></tr></thead>
          <tbody>${noWk.map(c=>`<tr${c.approved?' style="background:rgba(22,163,74,.09);"':''}>
            <td><b>${esc(c.empId)}</b></td><td>${esc(c.name||"-")}</td>
            <td class="text-right">${c.sickDays} วัน</td><td class="text-right">${c.days} วัน</td>
            <td class="text-right"><button class="btn btn-sm ${c.approved?"btn-secondary":"btn-primary"}"
              onclick="window._saApprove('${esc(c.empId)}','${esc(c.month)}')">${c.approved?"✓ อนุมัติแล้ว (กดเพื่อยกเลิก)":"อนุมัติจ่าย"}</button></td>
          </tr>`).join("")}</tbody>
        </table>
      </div>
    </div>` : ""}
    ${proc.length ? `<div class="card-body" style="background:var(--bg);border-bottom:1px solid var(--border);padding:10px 16px;">
      <div style="font-size:12px;font-weight:700;margin-bottom:3px;">🏭 พนักงานสาย Process ${proc.length} คน — วันที่เข้า ${PROCESS_NO_PAY_CODE} ไม่จ่าย (วันกะอื่นจ่ายปกติ)</div>
      <div class="text-muted" style="font-size:11px;">
        จับจากรหัสพนักงาน → ดูคำว่า "process" ในสังกัดที่บันทึกไว้ในระบบ · ถ้ามีคนที่ไม่ควรอยู่ในลิสต์นี้ (หรือขาดไป) บอกได้<br>
        ${proc.slice(0,12).map(p=>`<span style="display:inline-block;margin-right:12px;">• <b>${esc(p.empId)}</b> ${esc(p.name||"")} <span class="text-muted">(${esc(p.where||"-")})</span></span>`).join("")}
        ${proc.length>12?`<span class="text-muted">…และอีก ${proc.length-12} คน</span>`:""}
      </div>
    </div>` : ""}
    ${(hits.suspend.length || hits.sick.length || hits.unpaid.length) ? `<div class="card-body" style="background:var(--bg);border-bottom:1px solid var(--border);padding:10px 16px;">
      <div style="font-size:12px;font-weight:700;margin-bottom:4px;">🔎 ข้อความในช่องหมายเหตุที่ระบบตีความ — ตรวจว่าถูกต้องไหม</div>
      <div style="display:flex;gap:22px;flex-wrap:wrap;font-size:11px;">
        ${["unpaid","suspend","sick"].map(k => hits[k].length ? `<div>
          <div class="text-muted" style="margin-bottom:2px;">${
            k==="unpaid"  ? 'ตีความว่า <b style="color:#b91c1c;">ไม่ได้เงินวันนั้น</b> (หมายเหตุบอกเอง)' :
            k==="suspend" ? "ตีความว่า <b>พักงาน</b> (ไม่จ่ายวันนั้น)" : "ตีความว่า <b>ลาป่วย</b>"}</div>
          ${hits[k].map(h=>`<div>• "${esc(h.text)}" <span class="text-muted">— ${h.count} วัน</span></div>`).join("")}
        </div>` : "").join("")}
      </div>
      <div class="text-muted" style="font-size:11px;margin-top:5px;">ถ้ามีข้อความที่ไม่ควรถูกนับ (หรือมีคำอื่นที่ควรนับแต่ไม่อยู่ในลิสต์) บอกได้ จะปรับคำที่ใช้จับให้</div>
    </div>` : ""}
    ${sickR.length ? `<div class="card-body" style="background:#fff7ed;border-bottom:1px solid var(--border);padding:11px 16px;">
      <div style="font-size:13px;color:#c2410c;font-weight:700;margin-bottom:2px;">🩺 ลาป่วยติดต่อกันตั้งแต่ ${SICK_RUN_WARN} วันขึ้นไป ${sickR.length} คน — <b>ไม่จ่ายวันลาในช่วงนั้น</b></div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:7px;">
        จ่ายเฉพาะวันที่ไม่ได้ลา · <b>วันหยุดประจำสัปดาห์ที่คั่นกลางไม่ตัดช่วง</b> (ป่วย-ป่วย-หยุด-ป่วย = ติดกัน 3 วัน)
        แต่ตัววันหยุดเองยังจ่ายตามปกติ · ลาป่วยไม่ถึง ${SICK_RUN_WARN} วันติด ยังจ่ายเหมือนเดิม
      </div>
      <div class="table-wrap" style="max-height:140px;overflow:auto;">
        <table class="data-table" style="font-size:11px;">
          <thead><tr><th>รหัส</th><th>ชื่อ</th><th class="text-right">ป่วยติดกันสูงสุด</th><th class="text-right">ลาป่วยรวม</th><th class="text-right">วันที่ไม่จ่าย</th><th></th></tr></thead>
          <tbody>${sickR.map(c=>`<tr${c.approved?' style="background:rgba(22,163,74,.09);"':''}>
            <td><b>${esc(c.empId)}</b></td><td>${esc(c.name||"-")}</td>
            <td class="text-right"><b>${c.run}</b> วัน</td><td class="text-right">${c.sickDays} วัน</td>
            <td class="text-right" style="${c.approved?"color:var(--muted);text-decoration:line-through;":"color:#b91c1c;font-weight:700;"}">${c.unpaidSickDays} วัน</td>
            <td class="text-right"><button class="btn btn-sm ${c.approved?"btn-secondary":"btn-primary"}"
              onclick="window._saApprove('${esc(c.empId)}','${esc(c.month)}')">${c.approved?"✓ จ่ายให้แล้ว (กดเพื่อยกเลิก)":"อนุมัติจ่ายวันลา"}</button></td></tr>`).join("")}</tbody>
        </table>
      </div>
    </div>` : ""}
    ${clip.length ? `<div class="card-body" style="background:var(--gold-light);border-bottom:1px solid var(--border);padding:11px 16px;">
      <div style="font-size:13px;color:var(--gold-dark);font-weight:700;margin-bottom:2px;">✂️ ตัดวันนอกช่วงการจ้างออก ${clip.length} คน (รวม ${clipSum} วัน)</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:${clip.length?"7px":"0"};">
        ไฟล์ลงเวลามีแถวของคนเหล่านี้เลยวันเข้าทำงาน/วันพ้นสภาพไป — ระบบไม่นับวันนอกช่วงเป็นวันจ่าย
        · <b>ถ้าวันในระบบพนักงานไม่ถูกต้อง ยอดจะผิดตามไปด้วย ให้ตรวจก่อนบันทึก</b>
      </div>
      <div class="table-wrap" style="max-height:150px;overflow:auto;">
        <table class="data-table" style="font-size:11px;">
          <thead><tr><th>รหัส</th><th>ชื่อ</th><th class="text-right">วันที่ตัด</th><th>เข้าทำงาน</th><th>พ้นสภาพ</th></tr></thead>
          <tbody>${clip.map(c=>`<tr><td><b>${esc(c.empId)}</b></td><td>${esc(c.name||"-")}</td>
            <td class="text-right">${c.days}</td><td>${esc(c.joinDate||"-")}</td><td>${esc(c.endDate||"-")}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    </div>` : ""}
    ${unk.length ? `<div class="card-body" style="background:#fef2f2;border-bottom:1px solid var(--border);padding:12px 16px;">
      <div style="font-size:13px;color:#b91c1c;font-weight:700;margin-bottom:2px;">🚨 พบรหัสกะที่ระบบไม่รู้จัก ${unk.length} รหัส — ยอดค่ากะอาจต่ำกว่าที่ควรเป็น</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">
        รหัสที่ไม่รู้จักจะ<b>ไม่ถูกนับเป็นตระกูลกะ</b> ทำให้บางคนนับได้ 2 ตระกูลแทน 3 (ขาด 600 บาท) หรือ 1 แทน 2
        · เลือกตระกูลแล้วกดเพิ่ม ระบบจะจำไว้และคำนวณใหม่ให้ทันที
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${unk.map((u,i)=>`<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <b style="font-family:monospace;font-size:13px;min-width:70px;">${esc(u.code)}</b>
          <span class="text-muted" style="font-size:12px;min-width:190px;">${u.days} วัน · ${u.emps} คน · กระทบวันจ่าย ${u.payDays} วัน</span>
          <select class="form-control" id="saFam${i}" style="width:auto;padding:4px 8px;font-size:12px;">
            <option value="">-- เลือกตระกูลกะ --</option>
            <option value="DAY">เช้า</option><option value="AFT">บ่าย</option><option value="NIT">ดึก</option>
          </select>
          <button class="btn btn-sm btn-primary" onclick="window._saAddCode('${esc(u.code)}',${i})">+ เพิ่ม</button>
        </div>`).join("")}
      </div>
      ${!shiftCodesFromDB ? `<div class="text-muted" style="font-size:11px;margin-top:9px;">
        ⓘ ยังไม่ได้สร้างตาราง <b>master_shift_codes</b> ใน Supabase — ตอนนี้ใช้รหัสกะเริ่มต้นในโค้ด และ<b>ยังเพิ่มรหัสใหม่ไม่ได้</b> (ต้องรัน <code>sql/schema_shift_codes.sql</code> ก่อน)
      </div>` : ""}
    </div>` : ""}
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>รหัส</th><th>ชื่อ</th><th>แผนก</th><th>เดือน</th><th>ระดับ</th><th>ตระกูลกะ</th>
          <th class="text-right">อัตรา/เดือน</th><th class="text-right">วันจ่าย</th><th class="text-right">ต้องตรวจ</th><th class="text-right">ยอดค่ากะ</th>
          ${cmp ? `<th class="text-right">เฉลยในไฟล์</th><th class="text-right">ส่วนต่าง</th><th>สาเหตุที่น่าจะเป็น</th>` : ""}
        </tr></thead>
        <tbody>
        ${rows.length===0 ? `<tr><td colspan="${cmp?12:10}" class="text-center text-muted" style="padding:32px;">ไม่มีข้อมูล</td></tr>` :
          rows.map(r=>`<tr${r.eligible?"":' style="opacity:0.6;"'}>
            <td><b>${esc(r.Employee_ID||"-")}</b></td>
            <td>${esc(r.Employee_Name||"-")}</td>
            <td class="text-muted">${esc(r.Department||"-")}</td>
            <td>${esc(r.month)}</td>
            <td>${r.eligible ? (r.granted ? `<span class="badge badge-gold">${esc(r.job_level||"-")} · พิเศษ</span>` : esc(r.job_level)) : `<span class="badge badge-gray">${esc(r.reason||r.job_level||"-")}</span>`}</td>
            <td>${esc(r.families)} <span class="text-muted">(${r.familyCount})</span>${r.solo?` <span class="badge badge-gold" title="ทำกะเดียวทั้งเดือน แต่กะนี้จ่าย">กะเดี่ยว ${esc(r.soloCode)}</span>`:""}${r.shiftOnly?` <span class="badge badge-blue" title="ทำ NOR สลับ N03 — จ่ายเฉพาะวันที่เข้า N03">เฉพาะวัน N03</span>`:""}${r.shiftOnlyFull?` <span class="badge badge-blue" title="อยู่ N03 เกิน ${N03_FULL_THRESHOLD} วัน (รวมวันหยุด) — จ่ายเต็มอัตรา">N03 เต็มเดือน</span>`:""}${r.noPayPair?` <span class="badge badge-gray" title="ทั้งเดือนใช้แค่ ${esc(r.noPayPair)} — ไม่คิดค่ากะ">${esc(r.noPayPair)} ไม่คิดค่ากะ</span>`:""}${r.isProcess?` <span class="badge badge-gray" title="สาย Process — วัน ${PROCESS_NO_PAY_CODE} ไม่จ่าย">Process</span>`:""}${r.approvedNoWork?` <span class="badge badge-green" title="HR อนุมัติจ่ายทั้งที่ไม่มีวันทำงานจริง">อนุมัติแล้ว</span>`:""}</td>
            <td class="text-right">${r.monthlyRate.toLocaleString("th-TH")}</td>
            <td class="text-right">${r.payDays}</td>
            <td class="text-right ${r.checkDays?'':'text-muted'}" ${r.checkDays?'style="color:var(--gold-dark);font-weight:700;"':''}>${r.checkDays||"-"}</td>
            <td class="text-right"><b>${fmtB(r.total)}</b></td>
            ${cmp ? `<td class="text-right ${r.manual===null?"text-muted":""}">${r.manual===null?"-":fmtB(r.manual)}</td>
            <td class="text-right${isBad(r)?"":" text-muted"}"${isBad(r)?' style="color:#dc2626;font-weight:700;"':""}>${r.diff===null?"-":(isBad(r)?(r.diff>0?"+":"")+fmtB(r.diff):"✓")}</td>
            <td style="font-size:11px;">${(()=>{const c=classifyDiff(r);return c?`<span class="badge ${c.key==="other"?"badge-gray":"badge-gold"}">${esc(c.label)}</span>`:'<span class="text-muted">-</span>';})()}</td>` : ""}
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  </div>`;
}

// ===== ประวัติที่บันทึก =====
async function loadHistMonths() {
  const sel = document.getElementById("saHistMonth");
  if (!sel) return;
  const { data } = await supabase.from("shift_allowance").select("month");
  const months = [...new Set((data||[]).map(r=>r.month))].sort().reverse();
  const cur = sel.value;
  sel.innerHTML = `<option value="">-- เลือกเดือน --</option>` +
    months.map(m=>`<option value="${esc(m)}" ${m===cur?"selected":""}>${esc(m)}</option>`).join("");
}

window._saHistMonth = async (m) => {
  const el = document.getElementById("saHistResults");
  if (!el) return;
  if (!m) { el.innerHTML = ""; return; }
  const { data, error } = await supabase.from("shift_allowance").select("*").eq("month", m).order("emp_code");
  if (error) { toast("โหลดไม่สำเร็จ: " + error.message, "error"); return; }
  const rows = data || [];
  const grand = round2(rows.reduce((s,r)=>s+Number(r.total||0), 0));
  el.innerHTML = `
  <div class="card">
    <div class="card-body" style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);">
      <div class="card-title" style="margin:0;">เดือน ${esc(m)} · ${rows.length} รายการ</div>
      <div style="font-size:13px;">รวม: <b style="color:var(--green);font-size:16px;">${fmtB(grand)}</b> บาท</div>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>รหัส</th><th>ชื่อ</th><th>แผนก</th><th>ระดับ</th><th class="text-right">อัตรา/เดือน</th><th class="text-right">วันจ่าย</th><th class="text-right">ยอดค่ากะ</th><th>บันทึกเมื่อ</th></tr></thead>
        <tbody>
        ${rows.length===0 ? `<tr><td colspan="8" class="text-center text-muted" style="padding:32px;">ไม่มีข้อมูล</td></tr>` :
          rows.map(r=>`<tr${r.eligible?"":' style="opacity:0.6;"'}>
            <td><b>${esc(r.emp_code||"-")}</b></td>
            <td>${esc(r.employee_name||"-")}</td>
            <td class="text-muted">${esc(r.department||"-")}</td>
            <td>${esc(r.job_level||"-")}</td>
            <td class="text-right">${Number(r.monthly_rate||0).toLocaleString("th-TH")}</td>
            <td class="text-right">${r.pay_days??"-"}</td>
            <td class="text-right"><b>${fmtB(r.total||0)}</b></td>
            <td class="text-muted" style="font-size:11px;">${r.created_at?String(r.created_at).substring(0,10):"-"}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  </div>`;
};
