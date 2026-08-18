// ===== คำนวณค่ากะ (Shift Allowance) =====
// อ้างอิงสเปค shift_allowance_calculation_spec.md
// Input: ไฟล์ Excel (sheet "Clean_Data") 1 แถว = 1 คน-1 วัน
// เรต: ใช้ครบ 3 ตระกูลกะ (เช้า/บ่าย/ดึก) = 1,800/เดือน, 2 ตระกูล = 1,200, ≤1 หรือไม่มีสิทธิ์ = 0
// จ่ายแบบ pro-rate รายวัน: daily_rate = monthly_rate / วันในเดือน แล้วบวกทุกวันที่ "จ่าย" (payable)
// เกณฑ์เพิ่ม: จ่ายเฉพาะพนักงานระดับ O (O1/O2/O3) — เช็คจาก job_level ในตาราง employees
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
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const fmtB = n => Number(n).toLocaleString("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2});

// หา day_status ตามสเปค §4 (ลำดับเงื่อนไขสำคัญ)
function dayStatus(row) {
  if (has(row.Deduct_Day))      return "ABSENT";        // ขาดงาน / หักวันเหมือนกัน
  if (has(row.Leave_Deduct))    return "UNPAID_LEAVE";  // ลาไม่รับค่าจ้าง
  if (row.Day_Type === "H")     return "WEEKLY_OFF_DAY"; // วันหยุดประจำสัปดาห์
  if (row.Day_Type === "HD")    return "HOLIDAY";        // วันหยุดนักขัตฤกษ์
  if (has(row.Leave_No_Deduct)) return "PAID_LEAVE";     // ลาได้เงิน
  if (has(row.Check_In))        return "WORKED";         // เข้างาน
  return "CHECK_NOTE";                                   // ไม่มีข้อมูล → ต้อง review
}

// คำนวณจาก rows ทั้งหมด + map พนักงาน (emp_code -> {job_level}) -> { summary:[], detail:[] }
export function computeShiftAllowance(rows, empMap) {
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
    const dim = daysInMonth(g.y, g.m);
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

    // เตรียม status + family ของแต่ละแถว
    const days = g.rows.map(row => ({
      row,
      family: FAMILY_MAP[String(row.Shift || "").toUpperCase()] || null,
      status: dayStatus(row),
    }));

    // Pass 1: นับตระกูลกะที่ใช้ในวันที่จ่ายได้ (นับไว้แสดงเสมอเพื่อความโปร่งใส)
    const famUsed = new Set();
    for (const d of days) if (PAYABLE.has(d.status) && d.family) famUsed.add(d.family);
    const shiftRate = famUsed.size >= 3 ? 1800 : famUsed.size === 2 ? 1200 : 0;
    const monthlyRate = eligible ? shiftRate : 0; // ไม่เข้าเกณฑ์ระดับ → 0
    const dailyRate = monthlyRate / dim;

    // Pass 2: pro-rate รายวัน + เก็บ row-level
    // ถ้าไฟล์มีคอลัมน์ Shift_Allowance มาด้วย = "เฉลย" ที่คิดมือไว้แล้ว -> เก็บไว้เทียบ
    let total = 0, payDays = 0, noPayDays = 0, checkDays = 0;
    let manual = 0, hasManualRow = false;
    for (const d of days) {
      const payable = PAYABLE.has(d.status);
      const amt = payable ? dailyRate : 0;
      if (payable) { total += amt; payDays++; }
      else { noPayDays++; if (d.status === "CHECK_NOTE") checkDays++; }
      const mv = num(d.row.Shift_Allowance);
      if (mv !== null) { manual += mv; hasManualRow = true; }
      detail.push({
        Employee_ID: d.row.Employee_ID, Employee_Name: d.row.Employee_Name,
        Department: d.row.Department, Date: d.row.Date, Shift: d.row.Shift,
        Day_Type: d.row.Day_Type, day_status: d.status,
        family: d.family || "", job_level: jobLevel, eligible,
        Shift_Allowance: round2(amt),
        เฉลยในไฟล์: hasManualRow ? (mv ?? "") : "",
        ส่วนต่าง: mv === null ? "" : round2(amt - mv),
      });
    }

    summary.push({
      Employee_ID: empId, Employee_Name: first.Employee_Name, Department: first.Department,
      month: g.ym, job_level: jobLevel, eligible, granted, reason,
      families: [...famUsed].map(f => FAMILY_TH[f] || f).join("+") || "-",
      familyCount: famUsed.size, monthlyRate,
      payDays, noPayDays, checkDays,
      total: round2(total),
      manual: hasManualRow ? round2(manual) : null,
      diff:   hasManualRow ? round2(total - manual) : null,
    });
  }

  summary.sort((a,b) => (a.Employee_ID>b.Employee_ID?1:-1) || (a.month>b.month?1:-1));
  const hasManual = summary.some(r => r.manual !== null);
  return { summary, detail, hasManual };
}

let lastResult = null;
let lastMeta = null; // {sheetName, rowCount, notFound, ineligible}
let onlyDiff = false; // โหมดเทียบเฉลย: แสดงเฉพาะรายการที่ไม่ตรง

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
        • ครบ <b>3 ตระกูลกะ</b> = <b>1,800</b>/เดือน · <b>2 ตระกูล</b> = <b>1,200</b> · น้อยกว่า = <b>0</b> · จ่าย pro-rate รายวัน<br>
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
    reader.onload = ev => {
      try {
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
        lastResult = computeShiftAllowance(rows, empMap);
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
      ...(lastResult.hasManual ? { เฉลยในไฟล์:r.manual, ส่วนต่าง:r.diff } : {}),
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

  const granted = all.filter(r=>r.granted).length;
  const warns = [];
  if (notFound)    warns.push(`${notFound} คนไม่พบใน DB (ตรวจว่า Employee_ID ตรงกับ emp_code)`);
  if (ineligible)  warns.push(`${ineligible} คนไม่ใช่ระดับ O → ฿0`);
  if (granted)     warns.push(`${granted} คนระดับไม่ใช่ O แต่ได้ค่ากะ (HR กำหนดพิเศษ)`);
  if (totalCheck)  warns.push(`${totalCheck} วันสถานะไม่ชัด (CHECK_NOTE) ไม่นับเป็นวันจ่าย`);

  el.innerHTML = `
  <div class="card">
    <div class="card-body" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;border-bottom:1px solid var(--border);">
      <div class="card-title" style="margin:0;">ผลการคำนวณ · ${all.length} คน-เดือน <span style="font-weight:400;color:var(--muted);font-size:12px;">(sheet "${esc(sheetName)}" ${rowCount} แถว)</span></div>
      <div style="font-size:13px;">รวมค่ากะ: <b style="color:var(--green);font-size:16px;">${fmtB(grand)}</b> บาท</div>
    </div>
    ${cmp ? `<div class="card-body" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);background:${badRows.length?"var(--gold-light)":"rgba(22,163,74,.08)"};">
      <div style="font-size:13px;">
        ${badRows.length
          ? `<b style="color:var(--gold-dark);">⚠️ ไม่ตรงกับเฉลย ${badRows.length} รายการ</b> <span class="text-muted">· ตรง ${cmpCount-badRows.length} รายการ (ต่างไม่เกิน ${MATCH_TOL} บาท = ถือว่าตรง)</span>`
          : `<b style="color:var(--green);">✅ ตรงกับเฉลยทุกรายการที่เทียบได้ (${cmpCount})</b>`}
        <span class="text-muted"> · เฉลยรวม ${fmtB(grandManual)} · แอปคำนวณ ${fmtB(grand)} · ส่วนต่าง ${fmtB(round2(grand-grandManual))}</span>
        ${kf ? `<div class="text-muted" style="font-size:11px;margin-top:3px;">
          เฉลยจาก "${esc(kf.name)}" · ชีต "${esc(kf.sheet)}" · อ่านรหัสจากคอลัมน์ <b>${esc(kf.empCol)}</b> · ยอดจาก <b>${esc(kf.amtCol)}</b>${kf.monCol?` · เดือนจาก <b>${esc(kf.monCol)}</b>`:" · ไม่มีคอลัมน์เดือน จับคู่ด้วยรหัสอย่างเดียว"}
          ${kf.missing?` · <b>${kf.missing} รายการในระบบไม่มีในเฉลย</b>`:""}${kf.extra?` · <b>${kf.extra} รายการในเฉลยไม่มีในระบบ</b>`:""}
        </div>` : ""}
      </div>
      ${badRows.length ? `<button class="btn btn-sm ${onlyDiff?"btn-primary":"btn-secondary"}" onclick="window._saOnlyDiff()">${onlyDiff?"แสดงทั้งหมด":"แสดงเฉพาะที่ไม่ตรง"}</button>` : ""}
    </div>` : ""}
    ${warns.length ? `<div class="card-body" style="background:var(--gold-light);color:var(--gold-dark);font-size:12px;padding:8px 16px;">⚠️ ${warns.map(esc).join(" · ")}</div>` : ""}
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>รหัส</th><th>ชื่อ</th><th>แผนก</th><th>เดือน</th><th>ระดับ</th><th>ตระกูลกะ</th>
          <th class="text-right">อัตรา/เดือน</th><th class="text-right">วันจ่าย</th><th class="text-right">ต้องตรวจ</th><th class="text-right">ยอดค่ากะ</th>
          ${cmp ? `<th class="text-right">เฉลยในไฟล์</th><th class="text-right">ส่วนต่าง</th>` : ""}
        </tr></thead>
        <tbody>
        ${rows.length===0 ? `<tr><td colspan="${cmp?12:10}" class="text-center text-muted" style="padding:32px;">ไม่มีข้อมูล</td></tr>` :
          rows.map(r=>`<tr${r.eligible?"":' style="opacity:0.6;"'}>
            <td><b>${esc(r.Employee_ID||"-")}</b></td>
            <td>${esc(r.Employee_Name||"-")}</td>
            <td class="text-muted">${esc(r.Department||"-")}</td>
            <td>${esc(r.month)}</td>
            <td>${r.eligible ? (r.granted ? `<span class="badge badge-gold">${esc(r.job_level||"-")} · พิเศษ</span>` : esc(r.job_level)) : `<span class="badge badge-gray">${esc(r.reason||r.job_level||"-")}</span>`}</td>
            <td>${esc(r.families)} <span class="text-muted">(${r.familyCount})</span></td>
            <td class="text-right">${r.monthlyRate.toLocaleString("th-TH")}</td>
            <td class="text-right">${r.payDays}</td>
            <td class="text-right ${r.checkDays?'':'text-muted'}" ${r.checkDays?'style="color:var(--gold-dark);font-weight:700;"':''}>${r.checkDays||"-"}</td>
            <td class="text-right"><b>${fmtB(r.total)}</b></td>
            ${cmp ? `<td class="text-right ${r.manual===null?"text-muted":""}">${r.manual===null?"-":fmtB(r.manual)}</td>
            <td class="text-right${isBad(r)?"":" text-muted"}"${isBad(r)?' style="color:#dc2626;font-weight:700;"':""}>${r.diff===null?"-":(isBad(r)?(r.diff>0?"+":"")+fmtB(r.diff):"✓")}</td>` : ""}
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
