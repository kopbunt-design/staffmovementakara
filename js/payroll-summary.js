import { supabase } from "./supabase-config.js";
import { currentUser, can, esc, toast } from "./app.js";

// ============================================================================
// รายงานค่าใช้จ่ายเงินเดือน (Payroll Expense Report)
//
// ความลับของข้อมูล — อ่านก่อนแก้:
//   ไฟล์ Excel ต้นทางมีชีต Stafflist / BeforeProcessYDP ที่มี "เงินเดือนรายคน"
//   โมดูลนี้อ่านเฉพาะชีต SHEET_NAME ชีตเดียว และส่งขึ้น Supabase เฉพาะยอดรวม
//   ระดับแผนกเท่านั้น ห้ามเพิ่มการอ่านชีตอื่นแล้วอัปโหลดโดยเด็ดขาด
//   (ดู sql/schema_payroll_summary.sql ประกอบ)
// ============================================================================

const SHEET_NAME = "Payroll Report";

// ---------- โครงของชีต (คอลัมน์ 1-based ตามที่เห็นใน Excel) ----------
const GROUPS = [
  { name:"OPERATIONS",     depts:[3,4,5,6,7,8,9,10], total:11 },
  { name:"SUSTAINABILITY", depts:[12,13,14,15,16],   total:17 },
  { name:"COMMERCIAL",     depts:[18,19,20],         total:21 },
  { name:"EXPLORATION",    depts:[22,23],            total:24 },
];
const STANDALONE = [{ name:"BKK Office", col:25 }, { name:"Legal", col:26 }];
const GRAND_COL = 27;
const HDR_GROUP_ROW = 7, HDR_DEPT_ROW = 8;

const S_SENIOR = "SENIOR STAFF", S_STAFF = "STAFF";
const S_DED = "DEDUCTION — STAFF EXPENSES", S_SUM = "SUMMARY", S_PF = "PROVIDENT FUND";

// แถวในชีต: [row, kind, label, section]
//   kind: sec = แถวหัวข้อที่พก cost code · hc = จำนวนคน · amt = เงิน
//         tot = ยอดรวมย่อย · gt = ยอดรวมใหญ่ · ded = แถวหักที่มี cost code ในคอลัมน์ B
const ROWS = [
  [9,  "sec", S_SENIOR, S_SENIOR],
  [10, "hc",  "Headcount", S_SENIOR],
  [11, "amt", "Basic Salary", S_SENIOR],
  [12, "amt", "Shift Allowance", S_SENIOR],
  [13, "amt", "ERT Training", S_SENIOR],
  [14, "amt", "Other Income", S_SENIOR],
  [15, "tot", "Total — Senior Staff", S_SENIOR],
  [16, "sec", S_STAFF, S_STAFF],
  [17, "hc",  "Headcount", S_STAFF],
  [18, "amt", "Basic Salary", S_STAFF],
  [19, "amt", "Shift Allowance", S_STAFF],
  [20, "amt", "Transportation", S_STAFF],
  [21, "amt", "Overtime", S_STAFF],
  [22, "amt", "ERT Training", S_STAFF],
  [23, "amt", "Other Income", S_STAFF],
  [24, "tot", "Total — Staff", S_STAFF],
  [25, "sec", "ANNUAL LEAVE (RESIGNED) & COMPENSATE", "ANNUAL LEAVE (RESIGNED) & COMPENSATE"],
  [26, "amt", "Amount", "ANNUAL LEAVE (RESIGNED) & COMPENSATE"],
  [27, "sec", "EMPLOYEES BONUS", "EMPLOYEES BONUS"],
  [28, "amt", "Amount", "EMPLOYEES BONUS"],
  [29, "sec", "PROVISION FOR SEVERANCE PAYMENTS", "PROVISION FOR SEVERANCE PAYMENTS"],
  [30, "amt", "Amount", "PROVISION FOR SEVERANCE PAYMENTS"],
  [31, "sec", "CONSULTANTS — TECHNICAL", "CONSULTANTS — TECHNICAL"],
  [32, "hc",  "Headcount", "CONSULTANTS — TECHNICAL"],
  [33, "amt", "Amount", "CONSULTANTS — TECHNICAL"],
  [34, "sec", "CONTRACTORS — OTHER", "CONTRACTORS — OTHER"],
  [35, "hc",  "Headcount", "CONTRACTORS — OTHER"],
  [36, "amt", "Amount", "CONTRACTORS — OTHER"],
  [37, "sec", "CASUAL LABOUR", "CASUAL LABOUR"],
  [38, "hc",  "Headcount", "CASUAL LABOUR"],
  [39, "amt", "Amount", "CASUAL LABOUR"],
  [40, "gt",  "GRAND TOTAL — PAYROLL EXPENSE", S_SUM],
  [41, "gt",  "TOTAL HEADCOUNT", S_SUM],
  [44, "ded", "Provident Fund", S_DED],
  [45, "ded", "Social Security", S_DED],
  [46, "ded", "Student Loan (general)", S_DED],
  [47, "ded", "Legal Execution Department", S_DED],
  [48, "ded", "Clearing Account — Employee W/Tax (PND 1)", S_DED],
  [49, "ded", "CL ACC EXP — Clearing Account W/Tax (PND 3)", S_DED],
  [50, "gt",  "GRAND TOTAL — DEDUCTION", S_SUM],
  [51, "gt",  "NET SALARY", S_SUM],
  [54, "ded", "Provident Fund Employer Contribution", S_PF],
];

// แถวที่ต้องมีข้อความตรงนี้ ไม่งั้นถือว่าไฟล์ผิดโครง แล้วปฏิเสธการอัปโหลด
// (กันกรณีมีคนแทรก/ลบแถวใน template แล้วตัวเลขเลื่อนไปทั้งแผง โดยไม่มีใครรู้)
const GUARD = [
  [9,  "SENIOR STAFF"], [16, "STAFF"],
  [40, "GRAND TOTAL — PAYROLL EXPENSE"], [41, "TOTAL HEADCOUNT"],
  [43, "DEDUCTION — STAFF EXPENSES"], [50, "GRAND TOTAL — DEDUCTION"],
  [51, "NET SALARY"], [54, "Provident Fund Employer Contribution"],
];
const SIGN_ROW = 57, SIGN_NAME_ROW = 62, SIGN_POS_ROW = 63;

// ---------- utils ----------
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const cell = (aoa, r, c) => (aoa[r - 1] || [])[c - 1] ?? null;
const norm = s => String(s ?? "").replace(/[\s ]+/g, " ").trim().toLowerCase();

const money = v => (v == null || Math.round(num(v) * 100) === 0)
  ? "–" : num(v).toLocaleString("en-US", { minimumFractionDigits:2, maximumFractionDigits:2 });
const money0 = v => (v == null || Math.round(num(v)) === 0)
  ? "–" : Math.round(num(v)).toLocaleString("en-US");
const cnt = v => (v == null || num(v) === 0) ? "–" : Math.round(num(v)).toLocaleString("en-US");
const compact = v => {
  const n = Math.abs(num(v));
  if (n >= 1e6) return (num(v) / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return Math.round(num(v) / 1e3) + "k";
  return String(Math.round(num(v)));
};
const monthLabel = ym => {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1)
    .toLocaleDateString("th-TH", { month:"long", year:"numeric" });
};
const monthLabelEn = ym => {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1)
    .toLocaleDateString("en-GB", { month:"long", year:"numeric" });
};
const shortMonth = ym => {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1)
    .toLocaleDateString("th-TH", { month:"short", year:"2-digit" });
};
const prevYM = ym => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// ---------- module state ----------
let months = [], selMonth = "", period = null, rows = [], prevPeriod = null, allPeriods = [];

// ============================================================================
// อ่านไฟล์ Excel  →  แถวสรุป (ไม่แตะชีตอื่นเลย)
// ============================================================================
// export ไว้เพื่อให้เขียนเทสต์เรียกตรงได้โดยไม่ต้องผ่าน UI
export function parseWorkbook(wb, fileName) {
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) throw new Error(`ไม่พบชีต "${SHEET_NAME}" ในไฟล์นี้`);
  const aoa = window.XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:null });

  // กันไฟล์ผิดโครง
  // เทียบแบบ "ขึ้นต้นด้วย" เพราะหลายหัวข้อมีวงเล็บภาษาไทยต่อท้าย
  // (เช่น "TOTAL HEADCOUNT (จำนวนคนทั้งหมด)") ซึ่งแก้ถ้อยคำได้โดยโครงไม่เปลี่ยน
  const bad = GUARD.filter(([r, want]) => !norm(cell(aoa, r, 1)).startsWith(norm(want)))
                   .map(([r, want]) => `แถว ${r} ควรขึ้นต้นด้วย "${want}" แต่เจอ "${cell(aoa, r, 1) ?? ""}"`);
  if (bad.length) {
    throw new Error("โครงไฟล์ไม่ตรงกับ template ที่รองรับ จึงไม่อัปโหลด:\n• " + bad.join("\n• "));
  }

  // เดือน: อ่านจากช่อง PAYROLL PERIOD (แถว 1 คอลัมน์ 23)
  const periodRaw = cell(aoa, 1, 23);
  let month = null, reportDate = null;
  const toDate = v => {
    if (v instanceof Date) return v;
    if (typeof v === "number" && window.XLSX?.SSF) {
      const o = window.XLSX.SSF.parse_date_code(v);
      if (o) return new Date(o.y, o.m - 1, o.d);
    }
    if (typeof v === "string") { const d = new Date(v); if (!isNaN(d)) return d; }
    return null;
  };
  const pd = toDate(periodRaw);
  if (pd) month = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, "0")}`;
  else if (typeof periodRaw === "string") {
    // "August 2026"
    const d = new Date(periodRaw + " 1");
    if (!isNaN(d)) month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  if (!month) throw new Error("อ่านเดือนของรายงานไม่ได้ (ช่อง PAYROLL PERIOD)");
  const rd = toDate(cell(aoa, 2, 23));
  if (rd) reportDate = rd.toISOString().slice(0, 10);

  // คอลัมน์ทั้งหมด พร้อมกลุ่มธุรกิจและชนิดคอลัมน์
  const cols = [];
  let ci = 0;
  for (const g of GROUPS) {
    for (const c of g.depts)
      cols.push({ col:c, group:g.name, dept:String(cell(aoa, HDR_DEPT_ROW, c) || "").replace(/\n/g," ").trim(), kind:"dept", order:ci++ });
    cols.push({ col:g.total, group:g.name, dept:String(cell(aoa, HDR_DEPT_ROW, g.total) || `${g.name} Total`).replace(/\n/g," ").trim(), kind:"group_total", order:ci++ });
  }
  for (const s of STANDALONE)
    cols.push({ col:s.col, group:s.name, dept:s.name, kind:"dept", order:ci++ });
  cols.push({ col:GRAND_COL, group:"GRAND TOTAL", dept:"GRAND TOTAL", kind:"grand_total", order:ci++ });

  // แถวข้อมูล
  const out = [];
  let rowOrder = 0;
  for (const [r, kind, label, section] of ROWS) {
    const codeB = kind === "ded" ? cell(aoa, r, 2) : null;
    for (const c of cols) {
      if (kind === "sec") {
        const code = cell(aoa, r, c.col);
        // แถวหัวข้อพกได้แค่ cost code (ข้อความ) — ถ้าเป็นตัวเลขแปลว่าอ่านผิดตำแหน่ง
        if (code == null || code === "" || typeof code === "number") continue;
        out.push({ month, business_group:c.group, department:c.dept, col_kind:c.kind,
                   section, line_item:"__cost_code__", cost_code:String(code).trim(),
                   value:null, value_kind:"amount", row_order:rowOrder, col_order:c.order });
      } else {
        const v = cell(aoa, r, c.col);
        if (v == null || v === "") continue;
        out.push({ month, business_group:c.group, department:c.dept, col_kind:c.kind,
                   section, line_item:label,
                   cost_code: codeB ? String(codeB).trim() : null,
                   value: num(v), value_kind: kind === "hc" || /headcount/i.test(label) ? "headcount" : "amount",
                   row_order:rowOrder, col_order:c.order });
      }
    }
    rowOrder++;
  }

  const sign = [];
  for (let c = 1; c <= 27; c++) {
    const role = cell(aoa, SIGN_ROW, c);
    if (role) sign.push({
      role: String(role).trim(),
      name: String(cell(aoa, SIGN_NAME_ROW, c) ?? "").replace(/^\s*Name\s*:\s*/i, "").trim(),
      position: String(cell(aoa, SIGN_POS_ROW, c) ?? "").replace(/^\s*Position\s*:\s*/i, "").trim(),
    });
  }

  const per = {
    month, report_date: reportDate,
    total_expense: num(cell(aoa, 5, 1)),
    total_deduction: num(cell(aoa, 5, 8)),
    net_salary: num(cell(aoa, 5, 14)),
    total_headcount: Math.round(num(cell(aoa, 5, 21))),
    prepared_by: sign[0]?.name || null, prepared_position: sign[0]?.position || null,
    reviewed_by: sign[1]?.name || null, reviewed_position: sign[1]?.position || null,
    approved_by: sign[2]?.name || null, approved_position: sign[2]?.position || null,
    source_file: fileName || null,
    uploaded_by: currentUser?.id || null,
  };

  // ตรวจยอด: รายจ่าย − หัก = สุทธิ  (คลาดเคลื่อนได้ไม่เกิน 1 สตางค์)
  const diff = Math.abs((per.total_expense - per.total_deduction) - per.net_salary);
  const warn = diff > 0.01
    ? `ยอดในไฟล์ไม่สมดุล: รายจ่าย − หัก = ${(per.total_expense - per.total_deduction).toLocaleString()} แต่ NET SALARY = ${per.net_salary.toLocaleString()}`
    : null;

  return { period: per, summaryRows: out, warn };
}

// ============================================================================
// DB
// ============================================================================
async function loadMonths() {
  const { data, error } = await supabase.from("payroll_period")
    .select("*").order("month", { ascending:false });
  if (error) throw error;
  allPeriods = data || [];
  months = allPeriods.map(p => p.month);
}

async function loadMonth(ym) {
  if (!ym) { period = null; rows = []; prevPeriod = null; return; }
  period = allPeriods.find(p => p.month === ym) || null;
  prevPeriod = allPeriods.find(p => p.month === prevYM(ym)) || null;
  const { data, error } = await supabase.from("payroll_summary")
    .select("*").eq("month", ym).order("row_order").order("col_order");
  if (error) throw error;
  rows = data || [];
}

async function saveUpload(parsed) {
  const { error: e1 } = await supabase.from("payroll_period")
    .upsert(parsed.period, { onConflict:"month" });
  if (e1) throw e1;
  // ลบของเดิมเดือนนั้นก่อน แล้วใส่ใหม่ — กันแถวค้างเวลา template เปลี่ยน
  const { error: e2 } = await supabase.from("payroll_summary")
    .delete().eq("month", parsed.period.month);
  if (e2) throw e2;
  for (let i = 0; i < parsed.summaryRows.length; i += 500) {
    const { error } = await supabase.from("payroll_summary")
      .insert(parsed.summaryRows.slice(i, i + 500));
    if (error) throw error;
  }
}

// ============================================================================
// การหาค่าในตาราง
// ============================================================================
const pick = (section, line, dept) =>
  rows.find(r => r.section === section && r.line_item === line && r.department === dept);
const val = (section, line, dept) => num(pick(section, line, dept)?.value);

const groupNames = () => [...GROUPS.map(g => g.name), ...STANDALONE.map(s => s.name)];
const groupTotalDept = gname => {
  const g = GROUPS.find(x => x.name === gname);
  if (!g) return gname; // BKK Office / Legal เป็นคอลัมน์เดี่ยว
  const r = rows.find(x => x.business_group === gname && x.col_kind === "group_total");
  return r?.department || gname;
};
const deptsOf = gname => {
  const seen = new Map();
  rows.filter(r => r.business_group === gname && r.col_kind === "dept")
      .forEach(r => { if (!seen.has(r.department)) seen.set(r.department, r.col_order); });
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]);
};

const expenseOf = d => val(S_SUM, "GRAND TOTAL — PAYROLL EXPENSE", d);
const dedOf     = d => val(S_SUM, "GRAND TOTAL — DEDUCTION", d);
const netOf     = d => val(S_SUM, "NET SALARY", d);
const hcOf      = d => val(S_SUM, "TOTAL HEADCOUNT", d);

// องค์ประกอบค่าใช้จ่าย (รวมทั้งบริษัท) เรียงจากมากไปน้อย
function expenseBreakdown() {
  const G = "GRAND TOTAL";
  const items = [
    ["เงินเดือน Senior Staff", val(S_SENIOR, "Basic Salary", G)],
    ["เงินเดือน Staff",        val(S_STAFF,  "Basic Salary", G)],
    ["ค่าล่วงเวลา (OT)",       val(S_STAFF,  "Overtime", G)],
    ["ค่าเดินทาง",             val(S_STAFF,  "Transportation", G)],
    ["ค่ากะ",                  val(S_SENIOR, "Shift Allowance", G) + val(S_STAFF, "Shift Allowance", G)],
    ["ที่ปรึกษา",              val("CONSULTANTS — TECHNICAL", "Amount", G)],
    ["ลาพักร้อนคงเหลือ",       val("ANNUAL LEAVE (RESIGNED) & COMPENSATE", "Amount", G)],
    ["ลูกจ้างชั่วคราว",        val("CASUAL LABOUR", "Amount", G)],
    ["ERT Training",           val(S_SENIOR, "ERT Training", G) + val(S_STAFF, "ERT Training", G)],
    ["รายได้อื่น",             val(S_SENIOR, "Other Income", G) + val(S_STAFF, "Other Income", G)],
    ["โบนัส",                  val("EMPLOYEES BONUS", "Amount", G)],
    ["ผู้รับเหมา",             val("CONTRACTORS — OTHER", "Amount", G)],
    ["สำรองเลิกจ้าง",          val("PROVISION FOR SEVERANCE PAYMENTS", "Amount", G)],
  ];
  return items.filter(i => Math.abs(i[1]) > 0.005).sort((a, b) => b[1] - a[1]);
}
function deductionBreakdown() {
  const G = "GRAND TOTAL";
  return rows.filter(r => r.section === S_DED && r.department === G && Math.abs(num(r.value)) > 0.005)
             .sort((a, b) => num(b.value) - num(a.value))
             .map(r => [r.line_item, num(r.value), r.cost_code]);
}

export function renderPayrollExpense() { boot(); }

// ============================================================================
// UI
// ============================================================================
const canView  = () => can("page.payrollexp");
const canWrite = () => can("data.payroll.write");

async function boot() {
  const pg = document.getElementById("pagePayrollexp");
  if (!canView()) {
    pg.innerHTML = `<div class="empty-state" style="padding-top:80px;">
      <div class="empty-title">ไม่มีสิทธิ์เข้าถึง</div>
      <div class="empty-sub">รายงานค่าใช้จ่ายเงินเดือนเปิดให้เฉพาะ HR และ Admin</div></div>`;
    return;
  }
  pg.innerHTML = `<div class="section mt-4"><div class="card"><div class="card-body">กำลังโหลด…</div></div></div>`;
  try {
    await loadMonths();
    if (!selMonth || !months.includes(selMonth)) selMonth = months[0] || "";
    await loadMonth(selMonth);
  } catch (e) {
    pg.innerHTML = `<div class="section mt-4"><div class="card"><div class="card-body">
      <b>โหลดข้อมูลไม่สำเร็จ</b><div class="text-muted" style="margin-top:6px;">${esc(e.message || String(e))}</div>
      <div class="text-muted" style="margin-top:10px;font-size:12px;">ถ้ายังไม่เคยรัน <code>sql/schema_payroll_summary.sql</code> ใน Supabase ให้รันก่อน</div>
    </div></div></div>`;
    return;
  }
  draw();
}

function draw() {
  const pg = document.getElementById("pagePayrollexp");
  pg.innerHTML = `
    ${headerHTML()}
    ${!period ? emptyHTML() : `
      ${confidentialHTML()}
      ${kpiHTML()}
      <div class="section pl-grid2">
        <div class="card"><div class="card-body">
          <div class="card-title">ค่าใช้จ่ายตามกลุ่มธุรกิจ</div>
          ${barsHTML(groupNames().map(g => [g, expenseOf(groupTotalDept(g))]), "THB")}
        </div></div>
        <div class="card"><div class="card-body">
          <div class="card-title">องค์ประกอบค่าใช้จ่าย</div>
          ${barsHTML(expenseBreakdown(), "THB")}
        </div></div>
      </div>
      ${trendHTML()}
      ${tableHTML()}
      ${deductionHTML()}
    `}
    <div class="pb-4"></div>`;
  wire();
}

function headerHTML() {
  return `<div class="page-header">
    <div>
      <div class="page-heading">รายงานค่าใช้จ่ายเงินเดือน</div>
      <div class="page-sub">${period
        ? `${esc(monthLabel(period.month))} · อัปเดตล่าสุด ${esc(new Date(period.uploaded_at).toLocaleDateString("th-TH"))}`
        : "ยังไม่มีข้อมูล"}</div>
    </div>
    <div class="header-actions">
      ${months.length ? `<select class="filter-select" id="plMonth">
        ${months.map(m => `<option value="${m}" ${m === selMonth ? "selected" : ""}>${esc(monthLabel(m))}</option>`).join("")}
      </select>` : ""}
      ${period ? `<button class="btn btn-secondary" id="plPrint">🖨 พิมพ์ฉบับเซ็น</button>` : ""}
      <button class="btn btn-gold" id="plUploadBtn">📤 อัปโหลดไฟล์เดือนใหม่</button>
      <input type="file" id="plFile" accept=".xlsx,.xls" style="display:none;">
    </div>
  </div>`;
}

function emptyHTML() {
  return `<div class="section mt-4"><div class="card"><div class="card-body" style="padding:40px;text-align:center;">
    <div class="empty-title">ยังไม่มีรายงานในระบบ</div>
    <div class="empty-sub" style="margin-top:6px;">กด “อัปโหลดไฟล์เดือนใหม่” แล้วเลือกไฟล์ <b>Payroll Report_YYYY-MM_revN.xlsx</b></div>
    <div class="text-muted" style="margin-top:14px;font-size:12px;line-height:1.7;">
      ระบบจะอ่านเฉพาะชีต <b>“${esc(SHEET_NAME)}”</b> และเก็บเฉพาะยอดรวมระดับแผนก<br>
      ชีตที่มีเงินเดือนรายคน (Stafflist, BeforeProcessYDP) จะไม่ถูกอ่านและไม่ถูกอัปโหลด
    </div>
  </div></div></div>`;
}

function confidentialHTML() {
  return `<div class="section mt-4"><div class="pl-conf">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    <span><b>ข้อมูลลับ · เฉพาะ HR และ Admin</b> — หน้านี้เก็บเฉพาะยอดรวมระดับแผนก ไม่มีเงินเดือนรายบุคคลอยู่ในระบบ</span>
  </div></div>`;
}

function deltaHTML(cur, prev, fmt, neutral) {
  if (prev == null || !Number.isFinite(prev) || prev === 0) return `<div class="pl-delta muted">— เทียบเดือนก่อนไม่ได้</div>`;
  const d = cur - prev, p = (d / Math.abs(prev)) * 100;
  const up = d > 0, flat = Math.abs(p) < 0.05;
  const cls = (flat || neutral) ? "muted" : (up ? "up" : "down");
  const arrow = flat ? "→" : (up ? "▲" : "▼");
  return `<div class="pl-delta ${cls}">${arrow} ${flat ? "0.0" : Math.abs(p).toFixed(1)}% <span>(${fmt(Math.abs(d))} จากเดือนก่อน)</span></div>`;
}

function kpiHTML() {
  const p = period, q = prevPeriod;
  const t = (label, value, sub, prev, cur, fmt, tone) => `
    <div class="pl-kpi ${tone === "neutral" ? "" : (tone || "")}">
      <div class="pl-kpi-label">${label}</div>
      <div class="pl-kpi-value">${value}</div>
      <div class="pl-kpi-unit">${sub}</div>
      ${deltaHTML(cur, prev, fmt, tone === "neutral")}
    </div>`;
  return `<div class="section pl-kpis">
    ${t("ค่าใช้จ่ายรวม", money0(p.total_expense), "บาท", q?.total_expense, num(p.total_expense), money0)}
    ${t("ยอดหักรวม", money0(p.total_deduction), "บาท", q?.total_deduction, num(p.total_deduction), money0)}
    ${t("เงินเดือนสุทธิ", money0(p.net_salary), "บาท", q?.net_salary, num(p.net_salary), money0, "accent")}
    ${t("จำนวนพนักงาน", cnt(p.total_headcount), "คน", q?.total_headcount, num(p.total_headcount), v => Math.round(v) + " คน", "neutral")}
  </div>`;
}

// แท่งแนวนอนชุดเดียว — สีเดียวทั้งชุด ความยาวคือค่าที่สื่อ ไม่ใช้สีแทนอันดับ
function barsHTML(pairs, unit) {
  const max = Math.max(...pairs.map(p => Math.abs(p[1])), 1);
  const tot = pairs.reduce((s, p) => s + Math.abs(p[1]), 0) || 1;
  return `<div class="pl-bars">${pairs.map(([label, v]) => {
    const pct = (Math.abs(v) / max) * 100, share = (Math.abs(v) / tot) * 100;
    return `<div class="pl-bar" title="${esc(label)} · ${money(v)} ${unit} · ${share.toFixed(1)}% ของยอดรวม">
      <div class="pl-bar-label">${esc(label)}</div>
      <div class="pl-bar-track"><div class="pl-bar-fill" style="width:${pct.toFixed(2)}%"></div></div>
      <div class="pl-bar-val">${compact(v)}</div>
      <div class="pl-bar-share">${share.toFixed(1)}%</div>
    </div>`;
  }).join("")}</div>`;
}

// แนวโน้มรายเดือน — เส้นชุดเดียว
// ใช้เส้นไม่ใช่แท่ง เพราะยอดรวมแกว่งแค่ไม่กี่ % รอบ ~18M
// แท่งต้องเริ่มจากศูนย์เสมอ ซึ่งจะทำให้ทุกเดือนสูงเท่ากันจนดูไม่ออก
// เส้นไม่ผูกกับศูนย์ จึงซูมช่วงที่ข้อมูลอยู่จริงได้
function trendHTML() {
  const hist = [...allPeriods].sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  if (hist.length < 2) return "";
  const vals = hist.map(h => num(h.total_expense));
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.18 || Math.abs(hi) * 0.02 || 1;
  const y0 = lo - pad, y1 = hi + pad;
  const px = i => hist.length === 1 ? 50 : (i / (hist.length - 1)) * 100;
  const py = v => ((y1 - v) / (y1 - y0)) * 100;

  const pts = vals.map((v, i) => `${px(i).toFixed(3)},${py(v).toFixed(3)}`).join(" ");
  const dots = hist.map((h, i) => {
    const on = h.month === selMonth;
    const v = num(h.total_expense);
    return `<div class="pl-pt${on ? " on" : ""}" style="left:${px(i)}%;top:${py(v)}%"
      title="${esc(monthLabel(h.month))} · ${money(v)} บาท · ${cnt(h.total_headcount)} คน"></div>`;
  }).join("");
  // ติดป้ายเฉพาะจุดต่ำสุด สูงสุด และเดือนที่เลือก — ไม่ติดทุกจุด
  const mark = new Set([vals.indexOf(lo), vals.indexOf(hi), hist.findIndex(h => h.month === selMonth)]);
  const edge = i => i === 0 ? " lead" : (i === hist.length - 1 ? " trail" : "");
  const labels = hist.map((h, i) => !mark.has(i) ? "" : `<div class="pl-ptlab${h.month === selMonth ? " on" : ""}${edge(i)}"
      style="left:${px(i)}%;top:${py(num(h.total_expense))}%">${compact(h.total_expense)}</div>`).join("");
  const axis = hist.map((h, i) => `<div class="pl-xlab${edge(i)}" style="left:${px(i)}%">${esc(shortMonth(h.month))}</div>`).join("");

  return `<div class="section"><div class="card"><div class="card-body">
    <div class="card-title">แนวโน้มค่าใช้จ่ายรวม ${hist.length} เดือนล่าสุด</div>
    <div class="pl-line">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points="${pts}" vector-effect="non-scaling-stroke"/>
      </svg>
      ${dots}${labels}
    </div>
    <div class="pl-xaxis">${axis}</div>
    <div class="pl-scale">ช่วงแกน ${compact(y0)} – ${compact(y1)} บาท · ไม่ได้เริ่มจากศูนย์</div>
  </div></div></div>`;
}

function tableHTML() {
  const body = groupNames().map(g => {
    const td = groupTotalDept(g);
    const kids = deptsOf(g).filter(d => d !== td);
    const head = `<tr class="pl-grp" data-grp="${esc(g)}">
      <td><span class="pl-caret">${kids.length ? "▸" : ""}</span> <b>${esc(g)}</b></td>
      <td class="num">${money(expenseOf(td))}</td>
      <td class="num">${money(dedOf(td))}</td>
      <td class="num strong">${money(netOf(td))}</td>
      <td class="num">${cnt(hcOf(td))}</td>
      <td class="num">${hcOf(td) ? money0(expenseOf(td) / hcOf(td)) : "–"}</td>
    </tr>`;
    const children = kids.map(d => `<tr class="pl-dept" data-of="${esc(g)}" style="display:none;">
      <td class="pl-sub">${esc(d)}</td>
      <td class="num">${money(expenseOf(d))}</td>
      <td class="num">${money(dedOf(d))}</td>
      <td class="num">${money(netOf(d))}</td>
      <td class="num">${cnt(hcOf(d))}</td>
      <td class="num">${hcOf(d) ? money0(expenseOf(d) / hcOf(d)) : "–"}</td>
    </tr>`).join("");
    return head + children;
  }).join("");

  return `<div class="section"><div class="card"><div class="card-body">
    <div class="card-title">แยกตามกลุ่มธุรกิจ · คลิกแถวเพื่อดูรายแผนก</div>
    <div class="table-wrap"><table class="data-table pl-table">
      <thead><tr>
        <th>กลุ่มธุรกิจ / แผนก</th><th class="num">ค่าใช้จ่าย</th><th class="num">ยอดหัก</th>
        <th class="num">สุทธิ</th><th class="num">คน</th><th class="num">เฉลี่ย/คน</th>
      </tr></thead>
      <tbody>${body}
        <tr class="pl-total">
          <td><b>รวมทั้งบริษัท</b></td>
          <td class="num">${money(period.total_expense)}</td>
          <td class="num">${money(period.total_deduction)}</td>
          <td class="num strong">${money(period.net_salary)}</td>
          <td class="num">${cnt(period.total_headcount)}</td>
          <td class="num">${period.total_headcount ? money0(num(period.total_expense) / num(period.total_headcount)) : "–"}</td>
        </tr>
      </tbody>
    </table></div>
  </div></div></div>`;
}

function deductionHTML() {
  const items = deductionBreakdown();
  if (!items.length) return "";
  return `<div class="section"><div class="card"><div class="card-body">
    <div class="card-title">รายการหัก</div>
    <div class="table-wrap"><table class="data-table pl-table">
      <thead><tr><th>รายการ</th><th>Cost Code</th><th class="num">จำนวนเงิน</th><th class="num">สัดส่วน</th></tr></thead>
      <tbody>${items.map(([n, v, c]) => `<tr>
        <td>${esc(n)}</td>
        <td class="text-muted" style="font-variant-numeric:tabular-nums;">${esc(c || "–")}</td>
        <td class="num">${money(v)}</td>
        <td class="num text-muted">${((v / num(period.total_deduction)) * 100).toFixed(1)}%</td>
      </tr>`).join("")}
      <tr class="pl-total"><td colspan="2"><b>รวม</b></td>
        <td class="num strong">${money(period.total_deduction)}</td><td class="num">100.0%</td></tr>
      </tbody>
    </table></div>
  </div></div></div>`;
}

// ---------- events ----------
function wire() {
  document.getElementById("plMonth")?.addEventListener("change", async e => {
    selMonth = e.target.value;
    await loadMonth(selMonth);
    draw();
  });
  document.getElementById("plUploadBtn")?.addEventListener("click", () =>
    document.getElementById("plFile").click());
  document.getElementById("plFile")?.addEventListener("change", onUpload);
  document.getElementById("plPrint")?.addEventListener("click", openPrintView);

  document.querySelectorAll(".pl-grp").forEach(tr => tr.addEventListener("click", () => {
    const g = tr.dataset.grp;
    const kids = document.querySelectorAll(`.pl-dept[data-of="${CSS.escape(g)}"]`);
    if (!kids.length) return;
    const open = kids[0].style.display !== "none";
    kids.forEach(k => k.style.display = open ? "none" : "");
    const c = tr.querySelector(".pl-caret");
    if (c) c.textContent = open ? "▸" : "▾";
  }));
}

async function onUpload(input) {
  const file = (input.target || input).files?.[0];
  if (!file) return;
  if (!window.XLSX) { toast("กรุณารอโหลด library แล้วลองใหม่", "error"); return; }
  const btn = document.getElementById("plUploadBtn");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ กำลังอ่านไฟล์…"; }

  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const wb = window.XLSX.read(ev.target.result, { type:"binary" });
      const parsed = parseWorkbook(wb, file.name);
      if (btn) btn.textContent = "⏳ กำลังบันทึก…";
      await saveUpload(parsed);
      await loadMonths();
      selMonth = parsed.period.month;
      await loadMonth(selMonth);
      draw();
      toast(`อัปโหลด ${monthLabel(parsed.period.month)} สำเร็จ · ${parsed.summaryRows.length} รายการ`, "success");
      if (parsed.warn) toast(parsed.warn, "error");
    } catch (e) {
      console.error(e);
      toast(e.message || String(e), "error");
      if (btn) { btn.disabled = false; btn.textContent = "📤 อัปโหลดไฟล์เดือนใหม่"; }
    } finally {
      (input.target || input).value = "";
    }
  };
  reader.readAsBinaryString(file);
}

// ============================================================================
// ฉบับพิมพ์เซ็น — A4 แนวนอน 4 หน้า (เปิดหน้าต่างใหม่ที่มี CSS ของตัวเอง
// เพื่อไม่ให้ CSS ของแอปเข้าไปกวนการจัดหน้ากระดาษ)
// ============================================================================
const PRINT_PAGES = [
  ["OPERATIONS"],
  ["SUSTAINABILITY", "COMMERCIAL"],
  ["EXPLORATION", "_STANDALONE", "_GRAND"],
];

function printColumns(spec) {
  const cols = [], bands = [];
  for (const key of spec) {
    if (key === "_STANDALONE") {
      for (const s of STANDALONE) { bands.push([s.name, 1]); cols.push([s.name, false]); }
    } else if (key === "_GRAND") {
      bands.push(["", 1]); cols.push(["GRAND TOTAL", true]);
    } else {
      const kids = deptsOf(key).filter(d => d !== groupTotalDept(key));
      bands.push([key, kids.length + 1]);
      kids.forEach(d => cols.push([d, false]));
      cols.push([groupTotalDept(key), true]);
    }
  }
  return { cols, bands };
}

function openPrintView() {
  const p = period;
  const esc2 = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
  const nPages = PRINT_PAGES.length + 1;

  // ---- หน้า 1: สรุป + ช่องเซ็น ----
  const divRows = groupNames().map(g => {
    const d = groupTotalDept(g);
    return `<tr><th>${esc2(g)}</th><td>${money(expenseOf(d))}</td><td>${money(dedOf(d))}</td>
      <td>${money(netOf(d))}</td><td>${cnt(hcOf(d))}</td></tr>`;
  }).join("") + `<tr class="gt"><th>GRAND TOTAL</th><td>${money(p.total_expense)}</td>
      <td>${money(p.total_deduction)}</td><td>${money(p.net_salary)}</td><td>${cnt(p.total_headcount)}</td></tr>`;

  const signers = [
    ["PREPARED BY", "Human Resources", p.prepared_by, p.prepared_position],
    ["REVIEWED BY", "HR Manager", p.reviewed_by, p.reviewed_position],
    ["APPROVED BY", "HR Manager", p.approved_by, p.approved_position],
  ];
  const signHTML = signers.map(([role, unit, name, pos]) => `<div class="sig">
      <div class="sig-role">${esc2(role)}</div><div class="sig-unit">${esc2(unit)}</div>
      <div class="sig-line"></div>
      <div class="sig-name">${esc2(name || "")}</div><div class="sig-pos">${esc2(pos || "")}</div>
      <div class="sig-date">Date <span class="rule"></span></div>
    </div>`).join("");

  let body = `<section class="page">
    <header class="masthead">
      <div class="brand"><h1>AKARA RESOURCES</h1><p>Payroll Report — Employees &amp; Consultants</p></div>
      <div class="meta">
        <div><span>Payroll Period</span><strong>${esc2(monthLabelEn(p.month))}</strong></div>
        <div><span>Report Date</span><strong>${p.report_date ? esc2(new Date(p.report_date).toLocaleDateString("en-GB", { day:"2-digit", month:"long", year:"numeric" })) : "—"}</strong></div>
      </div>
    </header>
    <div class="kpis">
      <div class="kpi"><span>Total Payroll Expense</span><strong>${money(p.total_expense)}</strong><em>THB</em></div>
      <div class="kpi"><span>Total Deduction</span><strong>${money(p.total_deduction)}</strong><em>THB</em></div>
      <div class="kpi accent"><span>Net Salary Payroll</span><strong>${money(p.net_salary)}</strong><em>THB</em></div>
      <div class="kpi"><span>Total Headcount</span><strong>${cnt(p.total_headcount)}</strong><em>persons</em></div>
    </div>
    <h2 class="sec-title">Summary by Business Group</h2>
    <table class="summary"><thead><tr><th>Business Group</th><th>Payroll Expense</th>
      <th>Deduction</th><th>Net Salary</th><th>Headcount</th></tr></thead><tbody>${divRows}</tbody></table>
    <h2 class="sec-title">Approval</h2>
    <div class="signs">${signHTML}</div>
    <footer class="foot"><span>Payroll Report — ${esc2(monthLabelEn(p.month))}</span><span>Page 1 of ${nPages}</span></footer>
  </section>`;

  // ---- หน้า 2..n: รายละเอียดตามกลุ่ม ----
  PRINT_PAGES.forEach((spec, i) => {
    const { cols, bands } = printColumns(spec);
    let head = `<tr><th class="item" rowspan="2">Item</th>` +
      bands.map(([t, span]) => `<th class="band" colspan="${span}">${esc2(t)}</th>`).join("") +
      `</tr><tr>` +
      cols.map(([d, isTot]) => `<th class="dept${isTot ? " total" : ""}">${esc2(d)}</th>`).join("") + `</tr>`;

    // หัวข้อคั่นที่ไม่มี cost code รายคอลัมน์ (DEDUCTION / PROVIDENT FUND)
    // ต้องแทรกก่อนแถวแรกของ section นั้น
    const BANNER_BEFORE = { [S_DED]:"DEDUCTION — STAFF EXPENSES", [S_PF]:"PROVIDENT FUND : K MASTER POOL FUND" };
    const bannerDone = new Set();

    const tbody = ROWS.map(([r, kind, label, section]) => {
      let pre = "";
      if (BANNER_BEFORE[section] && !bannerDone.has(section)) {
        bannerDone.add(section);
        pre = `<tr class="sec"><th>${esc2(BANNER_BEFORE[section])}</th>` +
              `<td class="code" colspan="${cols.length}"></td></tr>`;
      }
      if (kind === "sec") {
        return pre + `<tr class="sec"><th>${esc2(label)}</th>` + cols.map(([d]) => {
          const c = pick(section, "__cost_code__", d);
          return `<td class="code">${esc2(c?.cost_code || "")}</td>`;
        }).join("") + `</tr>`;
      }
      const isHc = kind === "hc" || /headcount/i.test(label);
      const cls = { hc:"hc", amt:"amt", tot:"amt sub", gt:"amt gt", ded:"amt" }[kind];
      const netCls = label === "NET SALARY" ? " net" : "";
      const code = kind === "ded" ? (rows.find(x => x.section === section && x.line_item === label)?.cost_code || "") : "";
      const lbl = esc2(label) + (isHc ? ' <span class="cc">(จำนวนคน)</span>' : "") +
                  (code ? ` <span class="cc">${esc2(code)}</span>` : "");
      return pre + `<tr class="${cls}${netCls}"><th>${lbl}</th>` + cols.map(([d, isTot]) => {
        const v = pick(section, label, d)?.value;
        return `<td${isTot ? ' class="totcol"' : ""}>${isHc ? cnt(v) : money(v)}</td>`;
      }).join("") + `</tr>`;
    }).join("");

    const titles = bands.filter(b => b[0]).map(b => esc2(b[0])).join(" &amp; ");

    body += `<section class="page">
      <header class="masthead compact">
        <div class="brand"><h1>AKARA RESOURCES</h1><p>Payroll Report — ${titles}</p></div>
        <div class="meta"><div><span>Payroll Period</span><strong>${esc2(monthLabelEn(p.month))}</strong></div></div>
      </header>
      <div class="tablewrap"><table class="grid"><thead>${head}</thead><tbody>${tbody}</tbody></table></div>
      <footer class="foot"><span>Payroll Report — ${esc2(monthLabelEn(p.month))}</span><span>Page ${i + 2} of ${nPages}</span></footer>
    </section>`;
  });

  const w = window.open("", "_blank");
  if (!w) { toast("เบราว์เซอร์บล็อกป็อปอัป — อนุญาตแล้วลองใหม่", "error"); return; }
  w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8">
    <title>Payroll Report — ${esc2(monthLabelEn(p.month))}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>${PRINT_CSS}</style></head><body>${body}
    <div class="noprint"><button onclick="window.print()">🖨 พิมพ์ / บันทึกเป็น PDF</button>
    <span>A4 · แนวนอน · ขอบกระดาษ Default</span></div></body></html>`);
  w.document.close();
}

const PRINT_CSS = `
  @page { size: A4 landscape; margin: 9mm 10mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin:0; background:#eef0f3; font-family:"Sarabun","Helvetica Neue",Arial,sans-serif; color:#14181f; }
  .page { width:277mm; min-height:190mm; margin:6mm auto; background:#fff;
          box-shadow:0 1px 6px rgba(0,0,0,.18); display:flex; flex-direction:column; }
  .noprint { position:fixed; right:12px; bottom:12px; display:flex; align-items:center; gap:10px;
             background:#14181f; color:#fff; padding:10px 14px; border-radius:8px; font-size:12px; }
  .noprint button { background:#fff; color:#14181f; border:0; border-radius:6px; padding:7px 12px;
                    font-weight:700; cursor:pointer; font-family:inherit; }
  @media print { body{background:#fff;} .noprint{display:none;}
    .page{width:auto;min-height:0;margin:0;box-shadow:none;page-break-after:always;break-after:page;}
    .page:last-of-type{page-break-after:auto;break-after:auto;} }
  .masthead{display:flex;justify-content:space-between;align-items:flex-end;
            border-bottom:2.2pt solid #14181f;padding-bottom:2.5mm;margin-bottom:3.5mm;}
  .brand h1{margin:0;font-size:15pt;font-weight:700;letter-spacing:.14em;}
  .brand p{margin:.6mm 0 0;font-size:8.5pt;color:#4a5260;font-weight:500;}
  .meta{display:flex;gap:9mm;text-align:right;}
  .meta span{display:block;font-size:6.4pt;letter-spacing:.13em;text-transform:uppercase;color:#6b7280;}
  .meta strong{font-size:9.5pt;font-weight:600;}
  .compact{padding-bottom:1.6mm;margin-bottom:2.2mm;border-bottom-width:1.6pt;}
  .compact .brand h1{font-size:10.5pt;} .compact .brand p{font-size:7.4pt;}
  .compact .meta strong{font-size:8.5pt;}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;margin-bottom:5mm;}
  .kpi{border:.8pt solid #c9ced8;border-top:2.4pt solid #14181f;padding:3mm 3.5mm 3.2mm;}
  .kpi.accent{border-top-color:#1c5d3f;background:#f2f8f4;}
  .kpi span{display:block;font-size:6.6pt;letter-spacing:.12em;text-transform:uppercase;color:#5b6472;margin-bottom:1.6mm;}
  .kpi strong{display:block;font-size:15pt;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.01em;}
  .kpi.accent strong{color:#144c32;}
  .kpi em{font-style:normal;font-size:6.6pt;color:#6b7280;letter-spacing:.1em;}
  .sec-title{font-size:7.6pt;letter-spacing:.16em;text-transform:uppercase;margin:0 0 2mm;
             padding-bottom:1.2mm;border-bottom:.8pt solid #14181f;font-weight:700;}
  table{border-collapse:collapse;width:100%;}
  .summary{font-size:8.5pt;margin-bottom:5mm;}
  .summary th,.summary td{padding:1.8mm 3mm;border-bottom:.5pt solid #dfe3ea;}
  .summary thead th{font-size:6.8pt;letter-spacing:.1em;text-transform:uppercase;color:#4a5260;
                    text-align:right;border-bottom:1pt solid #9aa3b2;}
  .summary thead th:first-child{text-align:left;}
  .summary tbody th{text-align:left;font-weight:500;}
  .summary td{text-align:right;font-variant-numeric:tabular-nums;}
  .summary tr.gt th,.summary tr.gt td{font-weight:700;border-top:1pt solid #14181f;
                                      border-bottom:2.2pt double #14181f;background:#f5f6f8;}
  .signs{display:grid;grid-auto-columns:1fr;grid-auto-flow:column;gap:7mm;margin-bottom:5mm;}
  .sig{border:.8pt solid #c9ced8;padding:3mm 3.5mm;}
  .sig-role{font-size:7pt;letter-spacing:.14em;text-transform:uppercase;font-weight:700;}
  .sig-unit{font-size:7pt;color:#6b7280;margin-bottom:13mm;}
  .sig-line{border-bottom:.8pt solid #14181f;margin-bottom:1.8mm;}
  .sig-name{font-size:8.5pt;font-weight:600;}
  .sig-pos{font-size:7.2pt;color:#4a5260;margin-bottom:2.5mm;}
  .sig-date{font-size:7.2pt;color:#4a5260;display:flex;align-items:flex-end;gap:1.5mm;}
  .sig-date .rule{flex:1;border-bottom:.6pt dotted #8a92a0;height:3mm;}
  .tablewrap{flex:1;}
  .grid{font-size:5.6pt;table-layout:fixed;line-height:1.28;}
  .grid th,.grid td{border:.35pt solid #d5dae2;padding:.26mm 1mm;font-variant-numeric:tabular-nums;}
  .grid thead th{background:#14181f;color:#fff;font-weight:600;text-align:center;vertical-align:middle;line-height:1.15;}
  .grid thead .band{font-size:6.3pt;letter-spacing:.1em;text-transform:uppercase;border-color:#3a4150;}
  .grid thead .dept{font-size:5.5pt;font-weight:500;background:#2b323e;border-color:#3a4150;}
  .grid thead .dept.total{background:#47505f;font-weight:700;}
  .grid thead .item{width:41mm;text-align:left;padding-left:1.7mm;font-size:6.3pt;
                    letter-spacing:.08em;text-transform:uppercase;}
  .grid tbody th{text-align:left;font-weight:400;padding-left:2.2mm;background:#fbfcfd;hyphens:none;}
  .grid tr.gt th{line-height:1.15;}
  .grid tbody td{text-align:right;}
  .grid tbody td.totcol{background:#f1f3f6;font-weight:600;}
  .grid tr.sec th{background:#dfe3ea;font-weight:700;font-size:5.4pt;letter-spacing:.03em;
                  text-transform:uppercase;padding-left:1.1mm;padding-top:.55mm;padding-bottom:.55mm;}
  .grid tr.sec td.code{background:#eef1f5;color:#58616f;font-size:4.9pt;text-align:center;}
  .grid tr.hc td,.grid tr.hc th{color:#3a4150;}
  .grid tr.sub th,.grid tr.sub td{font-weight:700;background:#f4f6f8;}
  .grid tr.sub td.totcol{background:#e8ecf1;}
  .grid tr.gt th,.grid tr.gt td{font-weight:700;background:#14181f;color:#fff;border-color:#2b323e;}
  .grid tr.gt td.totcol{background:#2b323e;}
  .grid tr.net th,.grid tr.net td{font-weight:700;background:#144c32;color:#fff;border-color:#1c5d3f;}
  .grid tr.net td.totcol{background:#1c5d3f;}
  .cc{font-size:4.9pt;color:#7b8492;letter-spacing:.02em;white-space:nowrap;}
  .grid tr.gt .cc{color:#aeb6c2;}
  .foot{margin-top:auto;padding-top:1.6mm;border-top:.6pt solid #c9ced8;display:flex;
        justify-content:space-between;font-size:6.4pt;color:#6b7280;letter-spacing:.08em;}
`;
