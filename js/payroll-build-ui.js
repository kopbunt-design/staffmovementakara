// ===== หน้าสร้าง Payroll Report จากไฟล์ดิบ =====
// โยนไฟล์เข้ามาพร้อมกันหลายไฟล์ ระบบดูจากหัวตารางเองว่าไฟล์ไหนเป็นอะไร
// แล้วประกอบเป็นรายงาน -> ดูตัวอย่างบนจอ -> ดาวน์โหลด Excel / พิมพ์ PDF
//
// ⚠️ ไฟล์ดิบมีเงินเดือนรายคนทั้งบริษัท — อ่านในเบราว์เซอร์เท่านั้น
//    ที่ส่งขึ้นเซิร์ฟเวอร์มีแค่ "ยอดรวมระดับแผนก" ตอนกดบันทึก ซึ่งเป็นสิ่งที่ตาราง
//    payroll_summary ออกแบบมารองรับอยู่แล้ว — ไม่มีแถวรายคนถูกส่งขึ้นไปเลย
//    ส่วน localStorage จำแค่ "คนนี้ลงแผนกไหน" ซึ่งเป็นการจัดประเภท ไม่ใช่ตัวเงิน
import { esc, toast, can, allEmployees, currentUser } from "./app.js";
import { supabase } from "./supabase-config.js";
import * as PB from "./payroll-build.js";

const ASSIGN_KEY = "payroll_build_assign";

let files = [];          // [{name, role, aoa}]
let rep = null;          // ผลลัพธ์จาก buildReport
let month = "";
let assign = load();
let savedMonths = [];     // เดือนที่เคยบันทึกไว้ ใช้ดึงย้อนหลัง
let loadedFrom = "";      // เดือนที่กำลังเปิดดูจากประวัติ ("" = เพิ่งสร้างจากไฟล์)

function load() {
  try { return JSON.parse(localStorage.getItem(ASSIGN_KEY)) || {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(ASSIGN_KEY, JSON.stringify(assign)); } catch {}
}

const fmt  = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmtI = n => Number(n || 0).toLocaleString("en-US");

// ---------- หน้าเว็บ ----------
async function loadSavedMonths() {
  const { data } = await supabase.from("payroll_period").select("month").order("month", { ascending:false });
  savedMonths = (data || []).map(r => r.month);
}

export function renderPayrollBuild() {
  const pg = document.getElementById("pagePayrollbuild");
  if (!can("data.payroll.read")) { pg.innerHTML = ""; return; }
  // โหลดรายชื่อเดือนครั้งเดียวตอนเปิดหน้า แล้ววาดซ้ำเมื่อได้ผล
  if (!savedMonths.length && !loadedFrom) loadSavedMonths().then(() => { if (savedMonths.length) renderPayrollBuild(); });

  pg.innerHTML = `
  <div class="page-header">
    <div><div class="page-heading">สร้าง Payroll Report</div>
    <div class="page-sub">อัปโหลดไฟล์เงินเดือนดิบ + ไฟล์ที่ปรึกษา แล้วระบบประกอบรายงานให้</div></div>
    <div class="header-actions">
      ${savedMonths.length ? `<select class="filter-select" onchange="window._pbOpen(this.value)">
        <option value="">— ดึงรายงานย้อนหลัง —</option>
        ${savedMonths.map(m => `<option value="${esc(m)}" ${m === loadedFrom ? "selected" : ""}>${esc(m)}</option>`).join("")}
      </select>` : ""}
      ${rep && !rep.fromHistory && !rep.unassigned.length
        ? `<button class="btn btn-secondary" onclick="window._pbSave()">💾 บันทึกเข้าระบบ</button>` : ""}
      ${rep ? `<button class="btn btn-secondary" onclick="window._pbExcel()">📥 ดาวน์โหลด Excel</button>
               <button class="btn btn-gold" onclick="window._pbPrint()">🖨 พิมพ์ PDF</button>` : ""}
    </div>
  </div>
  <div class="section mt-4 pb-4">
    ${rep?.fromHistory ? `<div class="pa-ok" style="margin-bottom:14px;">
      กำลังดูรายงานเดือน <b>${esc(loadedFrom)}</b> ที่บันทึกไว้ — พิมพ์หรือดาวน์โหลดได้เลยโดยไม่ต้องอัปโหลดไฟล์ใหม่
      · ถ้าจะสร้างใหม่ให้เลือกไฟล์ด้านล่าง
    </div>` : ""}
    ${uploadCard()}
    ${rep ? assignCard() + warnCard() + summaryCard() : ""}
  </div>`;
  wire();
}

function uploadCard() {
  return `<div class="card card-body">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div><div class="card-title" style="margin:0;">ไฟล์ต้นทาง</div>
        <div class="text-sm text-muted">เลือกได้หลายไฟล์พร้อมกัน — ระบบดูจากหัวตารางเองว่าไฟล์ไหนเป็นอะไร
          · อ่านในเครื่องคุณเท่านั้น ไม่ส่งขึ้นเซิร์ฟเวอร์</div></div>
      <div>
        <input type="file" id="pbFiles" accept=".xlsx,.xls" multiple onchange="window._pbUpload(this)"
               style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;border:0;overflow:hidden;clip:rect(0 0 0 0);">
        <label for="pbFiles" class="btn btn-primary" style="cursor:pointer;">📁 เลือกไฟล์</label>
        ${files.length ? `<button class="btn btn-secondary" onclick="window._pbClear()">ล้าง</button>` : ""}
      </div>
    </div>
    ${files.length ? `<div class="pb-files mt-3">${files.map(f => `
      <div class="pb-file ${f.role ? "" : "pb-file-bad"}">
        <span class="pb-file-n">${esc(f.name)}</span>
        <span class="pb-file-r">${esc(ROLE_TH[f.role] || "ไม่รู้จัก — ไม่ถูกใช้")}</span>
      </div>`).join("")}</div>
      <div class="pb-period mt-3">
        <label class="form-label">งวดเงินเดือน</label>
        <input type="month" class="form-input" style="max-width:190px;" value="${esc(month)}"
               onchange="window._pbMonth(this.value)">
      </div>`
    : `<div class="pb-empty mt-3">ยังไม่ได้เลือกไฟล์<br>
        <span class="text-sm">ไฟล์ที่ต้องใช้: <b>BeforeProcessYDP</b> (เงินเดือนดิบ) และ <b>Consultant</b> (ที่ปรึกษา/จ้างเหมา)</span></div>`}
  </div>`;
}

const ROLE_TH = { payroll:"เงินเดือนดิบ", consultant:"ที่ปรึกษา / จ้างเหมา",
                  stafflist:"ทะเบียนพนักงาน (ไม่จำเป็น — ใช้ของในเว็บอยู่แล้ว)",
                  refDept:"ตารางแผนก", refJobLevel:"ตารางระดับงาน" };

// ---------- การลงแผนกด้วยมือ ----------
// แสดงทั้งคนที่ยังไม่ได้เลือก และคนที่เลือกไปแล้ว ไว้ในตารางเดียวกัน
// เดิมพอเลือกเสร็จแถวหายจากหน้าจอทันที ถ้าเลือกผิดจะไม่มีทางกลับไปแก้ได้เลย
function assignCard() {
  const rows = [
    ...rep.unassigned.map(u => ({ ...u, done:false })),
    ...rep.assigned.map(a => ({ ...a, done:true, why:"" })),
  ];
  if (!rows.length) return "";

  const deptOpts = sel => `<option value="">— เลือก —</option>` + PB.ALL_DEPTS.map(d =>
    `<option value="${esc(d)}" ${d === sel ? "selected" : ""}>${esc(d)}</option>`).join("");
  const secOpts = sel => [["casual","แรงงานรายวัน"],["consultants","ที่ปรึกษา"],["contractors","จ้างเหมาอื่น"]]
    .map(([v,l]) => `<option value="${v}" ${v === sel ? "selected" : ""}>${l}</option>`).join("");
  const held = rep.unassigned.reduce((s, u) => s + u.amount, 0);
  const nDone = rep.assigned.length;

  return `<div class="card card-body mt-4">
    <div class="card-title">การลงแผนกด้วยมือ (${rep.unassigned.length} รอเลือก · ${nDone} เลือกแล้ว)</div>
    <div class="text-sm text-muted mt-1">
      ระบบหาแผนกจาก <b>Division / Department / Section / Team</b> ในทะเบียนพนักงานให้อัตโนมัติแล้ว
      เหลือเฉพาะคนที่ทะเบียนยังไม่ได้กรอกสังกัด ไม่มีในทะเบียน หรือไฟล์ไม่ได้บอกว่าลงแผนกไหน<br>
      ${held ? `<b>ยอดรวม ${fmt(held)} บาท ยังไม่ถูกนับเข้ารายงาน</b>จนกว่าจะเลือกให้ครบ · ` : ""}
      เลือกแล้วแถวยังอยู่ แก้หรือกดล้างได้ · ระบบจำไว้ใช้เดือนถัดไป
      · ถ้าเป็นพนักงานประจำ การไปเติมสังกัดในหน้าข้อมูลพนักงานจะแก้ได้ถาวรกว่า
    </div>
    <table class="pb-tbl mt-3">
      <thead><tr><th></th><th>รหัส</th><th>ชื่อ</th><th>สังกัดในทะเบียน</th><th>ระดับ</th>
        <th class="text-right">ยอด</th><th>สาเหตุ</th><th>ลงแผนก</th><th>หมวด</th><th></th></tr></thead>
      <tbody>${rows.map(u => `<tr class="${u.done ? "pb-done" : ""}">
        <td>${u.done ? `<span class="pb-tick" title="ลงแผนกแล้ว">✓</span>` : ""}</td>
        <td><b>${esc(u.code)}</b></td>
        <td>${esc(u.name || "-")}</td>
        <td class="text-muted" style="font-size:11.5px;">${esc(u.org || "—")}</td>
        <td class="text-muted">${esc(u.level || "—")}</td>
        <td class="text-right">${fmt(u.amount)}</td>
        <td class="text-muted" style="font-size:11.5px;">${esc(u.why || "")}</td>
        <td><select class="filter-select" onchange="window._pbAssign('${esc(u.code)}','dept',this.value)">
          ${deptOpts(assign[u.code]?.dept || (u.done ? u.dept : ""))}</select></td>
        <td><select class="filter-select" onchange="window._pbAssign('${esc(u.code)}','section',this.value)">
          ${secOpts(assign[u.code]?.section || u.section || "casual")}</select></td>
        <td>${u.done ? `<button class="btn btn-secondary btn-sm" title="ล้างการเลือก กลับไปให้ระบบจัดเอง"
          onclick="window._pbUnassign('${esc(u.code)}')">ล้าง</button>` : ""}</td>
      </tr>`).join("")}</tbody>
    </table>
  </div>`;
}

function warnCard() {
  const bits = [];
  if (rep.unknownCols.length)
    bits.push(`<div class="pa-warn">มีคอลัมน์ที่ระบบยังไม่รู้จัก ${rep.unknownCols.length} คอลัมน์ —
      ${rep.unknownCols.map(c => `${esc(c.col)} (${fmt(c.total)})`).join(" · ")}
      <br>ยอดพวกนี้<b>ไม่ได้ถูกนับ</b>ในรายงาน ถ้าควรนับบอกผมเพื่อเพิ่มเข้าไป</div>`);
  if (PB.COST_CODE_DOUBTS.length)
    bits.push(`<div class="pa-warn">รหัสบัญชี ${PB.COST_CODE_DOUBTS.length} ช่องที่คัดมาจากไฟล์เดิมยังน่าสงสัย แต่คงไว้ตามเดิม —
      ${PB.COST_CODE_DOUBTS.map(d => `${esc(d.dept)} · ${esc(d.section)} = ${esc(d.code)} (${esc(d.note)})`).join(" · ")}</div>`);
  return bits.length ? `<div class="mt-4" style="display:flex;flex-direction:column;gap:8px;">${bits.join("")}</div>` : "";
}

// ---------- ตัวอย่างรายงาน ----------
function summaryCard() {
  const exp = PB.grandExpense(rep), ded = PB.totalDeduction(rep), net = PB.netSalary(rep);
  const row = (label, val, cls = "") => `<tr class="${cls}"><td>${esc(label)}</td><td class="text-right">${fmt(val)}</td></tr>`;

  return `<div class="card card-body mt-4">
    <div class="card-title">สรุปรายงาน${month ? ` · งวด ${esc(month)}` : ""}</div>
    <div class="pb-kpis mt-3">
      <div class="pb-kpi"><div class="pb-kpi-l">ค่าใช้จ่ายรวม</div><div class="pb-kpi-n">${fmt(exp)}</div></div>
      <div class="pb-kpi"><div class="pb-kpi-l">รายการหักรวม</div><div class="pb-kpi-n">${fmt(ded)}</div></div>
      <div class="pb-kpi"><div class="pb-kpi-l">จ่ายสุทธิ</div><div class="pb-kpi-n pb-net">${fmt(net)}</div></div>
      <div class="pb-kpi"><div class="pb-kpi-l">จำนวนคนรวม</div><div class="pb-kpi-n">${fmtI(PB.grandHeadcount(rep))}</div></div>
    </div>

    <div class="pb-two mt-4">
      <div>
        <div class="pa-sub">ค่าใช้จ่ายตามสายงาน</div>
        <table class="pb-tbl">
          <thead><tr><th>สายงาน</th><th class="text-right">จำนวนคน</th><th class="text-right">ค่าใช้จ่าย</th></tr></thead>
          <tbody>
            ${PB.GROUPS.map(g => {
              const hc = ["senior","staff","consultants","contractors","casual"]
                .reduce((s, sec) => s + PB.groupHc(rep, sec, g), 0);
              const amt = g.depts.reduce((s, d) => s + PB.deptTotal(rep, d), 0);
              return `<tr><td>${esc(g.name)}</td><td class="text-right">${fmtI(hc)}</td><td class="text-right">${fmt(amt)}</td></tr>`;
            }).join("")}
            ${PB.STANDALONE.map(d => {
              const hc = ["senior","staff","consultants","contractors","casual"]
                .reduce((s, sec) => s + rep.headcount(sec, d), 0);
              return `<tr><td>${esc(d)}</td><td class="text-right">${fmtI(hc)}</td><td class="text-right">${fmt(PB.deptTotal(rep, d))}</td></tr>`;
            }).join("")}
            <tr class="pb-tot"><td>รวมทั้งหมด</td><td class="text-right">${fmtI(PB.grandHeadcount(rep))}</td><td class="text-right">${fmt(exp)}</td></tr>
          </tbody>
        </table>
      </div>
      <div>
        <div class="pa-sub">รายการหัก</div>
        <table class="pb-tbl">
          <thead><tr><th>รายการ</th><th class="text-right">จำนวนเงิน</th></tr></thead>
          <tbody>
            ${row("Provident Fund", rep.ded.pvd)}
            ${row("Social Security", rep.ded.sso)}
            ${row("Student Loan (general)", rep.ded.studentLoan)}
            ${row("Legal Execution Department", rep.ded.led)}
            ${row("Clearing Account — Employee W/Tax (PND 1)", rep.ded.pnd1)}
            ${row("CL ACC EXP — Clearing Account W/Tax (PND 3)", rep.ded.pnd3)}
            ${row("GRAND TOTAL — DEDUCTION", ded, "pb-tot")}
            ${row("NET SALARY", net, "pb-tot")}
          </tbody>
        </table>
        <div class="pa-sub mt-4">PROVIDENT FUND : K MASTER POOL FUND</div>
        <table class="pb-tbl"><tbody>${row("Provident Fund Employer Contribution", rep.ded.pvdEmployer)}</tbody></table>
      </div>
    </div>
  </div>`;
}

// ---------- event ----------
function wire() {
  window._pbMonth = v => { month = v; renderPayrollBuild(); };
  window._pbClear = () => { files = []; rep = null; loadedFrom = ""; renderPayrollBuild(); };
  window._pbAssign = (code, k, v) => {
    if (k === "dept" && !v) return window._pbUnassign(code);   // เลือกกลับเป็น "— เลือก —" = ล้าง
    assign[code] = { ...(assign[code] || {}), [k]: v };
    if (k === "section") assign[code].type = v === "casual" ? "casual" : v;
    save();
    rebuild();
  };
  window._pbUnassign = code => { delete assign[code]; save(); rebuild(); };

  window._pbUpload = async inputEl => {
    const picked = [...(inputEl.files || [])];
    inputEl.value = "";
    if (!picked.length) return;
    if (!window.XLSX) { toast("กรุณารอโหลด library", "error"); return; }
    for (const f of picked) {
      try {
        const buf = await f.arrayBuffer();
        const wb = window.XLSX.read(buf, { type:"array" });
        for (const name of wb.SheetNames) {
          const aoa = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header:1, defval:"", raw:true });
          const role = PB.sheetRole(aoa);
          if (role) files.push({ name: `${f.name} › ${name}`, role, aoa });
        }
        // ไม่มีชีตไหนในไฟล์นี้ที่ระบบรู้จักเลย — บอกไว้ ไม่ใช่เงียบ
        if (!files.some(x => x.name.startsWith(f.name)))
          files.push({ name: f.name, role: null, aoa: null });
      } catch (err) {
        toast(`อ่าน ${f.name} ไม่ได้: ${err.message}`, "error");
      }
    }
    loadedFrom = "";
    if (!month) month = guessMonth();
    rebuild();
  };

  window._pbSave = async () => {
    if (!rep || rep.fromHistory) return;
    if (!month) { toast("เลือกงวดเงินเดือนก่อน", "error"); return; }
    if (rep.unassigned.length) { toast("ยังมีคนที่ยังไม่ได้ลงแผนก", "error"); return; }
    const per = {
      month, report_date: new Date().toISOString().slice(0, 10),
      total_expense: PB.grandExpense(rep), total_deduction: PB.totalDeduction(rep),
      net_salary: PB.netSalary(rep), total_headcount: PB.grandHeadcount(rep),
      source_file: files.filter(f => f.role).map(f => f.name.split(" › ")[0]).join(" + ") || null,
      uploaded_by: currentUser?.id || null, uploaded_at: new Date().toISOString(),
    };
    const { error: e1 } = await supabase.from("payroll_period").upsert(per, { onConflict:"month" });
    if (e1) { toast("บันทึกไม่สำเร็จ: " + e1.message, "error"); return; }
    // ลบของเดือนนั้นก่อนเสมอ — ถ้า upsert ทับอย่างเดียว แถวเก่าที่เดือนใหม่ไม่มีจะค้างอยู่
    await supabase.from("payroll_summary").delete().eq("month", month);
    const rows = PB.toSummaryRows(rep, month);
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("payroll_summary").insert(rows.slice(i, i + 500));
      if (error) { toast("บันทึกรายละเอียดไม่สำเร็จ: " + error.message, "error"); return; }
    }
    toast(`บันทึกรายงานเดือน ${month} แล้ว (${rows.length} แถว)`, "success");
    await loadSavedMonths();
    renderPayrollBuild();
  };

  window._pbOpen = async m => {
    if (!m) return;
    const { data, error } = await supabase.from("payroll_summary").select("*").eq("month", m);
    if (error) { toast("ดึงข้อมูลไม่สำเร็จ: " + error.message, "error"); return; }
    if (!data?.length) { toast("ไม่พบข้อมูลของเดือนนี้", "error"); return; }
    rep = PB.repFromRows(data, m);
    month = m; loadedFrom = m; files = [];
    renderPayrollBuild();
  };

  window._pbExcel = () => exportExcel();
  window._pbPrint = () => printReport();
}

// เดางวดจากไฟล์ที่ปรึกษา ซึ่งเขียนเดือนไว้ที่หัวชีต
function guessMonth() {
  const c = files.find(f => f.role === "consultant");
  for (const row of (c?.aoa || []).slice(0, 4)) {
    for (const v of row) {
      const d = new Date(String(v) + " 1");
      if (String(v).trim() && !isNaN(d)) return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    }
  }
  return "";
}

function rebuild() {
  const payroll = files.find(f => f.role === "payroll")?.aoa;
  if (!payroll) { rep = null; renderPayrollBuild(); return; }
  try {
    rep = PB.buildReport({
      payroll,
      consultants: files.find(f => f.role === "consultant")?.aoa || null,
      employees: allEmployees,
      assign, month,
    });
  } catch (err) {
    rep = null;
    toast("สร้างรายงานไม่สำเร็จ: " + err.message, "error");
  }
  renderPayrollBuild();
}

// ============================================================================
// ไฟล์ออก
// ============================================================================
// โครงใหม่ตามที่ตกลง: ชีตสรุป 1 ชีต แล้วแยกชีตตามสายงาน
// ของเดิมเป็นตารางเดียวกว้าง 27 คอลัมน์ ซึ่งพิมพ์ออกมาแล้วอ่านยาก
const LINES = [
  ["sec",  "SENIOR STAFF",   "senior"],
  ["hc",   "Headcount",      "senior"],
  ...PB.SENIOR_LINES.map(l => ["amt", l, "senior"]),
  ["tot",  "Total — Senior Staff", "senior"],
  ["sec",  "STAFF",          "staff"],
  ["hc",   "Headcount",      "staff"],
  ...PB.STAFF_LINES.map(l => ["amt", l, "staff"]),
  ["tot",  "Total — Staff",  "staff"],
  ["sec",  "ANNUAL LEAVE (RESIGNED) & COMPENSATE", "annualLeave"],
  ["amt",  "Amount",         "annualLeave"],
  ["sec",  "EMPLOYEES BONUS", "bonus"],
  ["amt",  "Amount",         "bonus"],
  ["sec",  "PROVISION FOR SEVERANCE PAYMENTS", "severance"],
  ["amt",  "Amount",         "severance"],
  ["sec",  "CONSULTANTS — TECHNICAL", "consultants"],
  ["hc",   "Headcount",      "consultants"],
  ["amt",  "Amount",         "consultants"],
  ["sec",  "CONTRACTORS — OTHER", "contractors"],
  ["hc",   "Headcount",      "contractors"],
  ["amt",  "Amount",         "contractors"],
  ["sec",  "CASUAL LABOUR",  "casual"],
  ["hc",   "Headcount",      "casual"],
  ["amt",  "Amount",         "casual"],
];
const SECTION_LINES = { senior:PB.SENIOR_LINES, staff:PB.STAFF_LINES };

// ค่าของช่องหนึ่งในตาราง (คืน null เมื่อบรรทัดนั้นไม่มีค่า เช่นแถวหัวข้อ)
function valueOf(kind, line, section, dept) {
  if (kind === "hc")  return rep.headcount(section, dept);
  if (kind === "amt") return rep.get(section, line, dept);
  if (kind === "tot") return (SECTION_LINES[section] || []).reduce((s, l) => s + rep.get(section, l, dept), 0);
  return null;
}
const costCodeOf = (section, dept) => {
  const i = PB.SECTION_KEYS.indexOf(section);
  const c = PB.COST_CODES[dept]?.[i];
  return c && c !== "n/a" ? c : "";
};

async function exportExcel() {
  if (!window.ExcelJS) { toast("กรุณารอโหลด library", "error"); return; }
  const wb = new window.ExcelJS.Workbook();
  const money = '#,##0.00', count = '#,##0';

  // ---- ชีตสรุป ----
  const s = wb.addWorksheet("Summary");
  s.columns = [{ width:34 }, { width:14 }, { width:18 }];
  s.addRow(["AKARA RESOURCES — Payroll Report"]).font = { bold:true, size:14 };
  s.addRow([`งวด ${month || "-"}`]).font = { color:{ argb:"FF667085" } };
  s.addRow([]);
  const head = s.addRow(["สายงาน", "จำนวนคน", "ค่าใช้จ่าย (THB)"]);
  head.font = { bold:true }; head.eachCell(c => c.border = { bottom:{ style:"thin" } });
  const hcOf = g => ["senior","staff","consultants","contractors","casual"].reduce((t, sec) => t + PB.groupHc(rep, sec, g), 0);
  for (const g of PB.GROUPS)
    s.addRow([g.name, hcOf(g), g.depts.reduce((t, d) => t + PB.deptTotal(rep, d), 0)]);
  for (const d of PB.STANDALONE)
    s.addRow([d, ["senior","staff","consultants","contractors","casual"].reduce((t, sec) => t + rep.headcount(sec, d), 0), PB.deptTotal(rep, d)]);
  const tot = s.addRow(["รวมทั้งหมด", PB.grandHeadcount(rep), PB.grandExpense(rep)]);
  tot.font = { bold:true }; tot.eachCell(c => c.border = { top:{ style:"thin" } });
  s.addRow([]);
  const dh = s.addRow(["รายการหัก", "", "จำนวนเงิน (THB)"]); dh.font = { bold:true };
  for (const [l, v] of [["Provident Fund", rep.ded.pvd], ["Social Security", rep.ded.sso],
                        ["Student Loan (general)", rep.ded.studentLoan], ["Legal Execution Department", rep.ded.led],
                        ["Clearing Account — Employee W/Tax (PND 1)", rep.ded.pnd1],
                        ["CL ACC EXP — Clearing Account W/Tax (PND 3)", rep.ded.pnd3]])
    s.addRow([l, "", v]);
  const dt = s.addRow(["GRAND TOTAL — DEDUCTION", "", PB.totalDeduction(rep)]); dt.font = { bold:true };
  const ns = s.addRow(["NET SALARY", "", PB.netSalary(rep)]); ns.font = { bold:true };
  s.addRow([]);
  s.addRow(["Provident Fund Employer Contribution", "", rep.ded.pvdEmployer]);
  s.eachRow(r => { r.getCell(2).numFmt = count; r.getCell(3).numFmt = money; });

  // ---- ชีตละสายงาน ----
  const sheets = [...PB.GROUPS.map(g => ({ name:g.name, depts:g.depts })),
                  { name:"OTHER", depts:PB.STANDALONE }];
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name.slice(0, 31));
    ws.columns = [{ width:38 }, { width:16 }, ...sh.depts.map(() => ({ width:16 })), { width:16 }];
    ws.addRow([`AKARA RESOURCES — Payroll Report · ${sh.name}`]).font = { bold:true, size:13 };
    ws.addRow([`งวด ${month || "-"}`]).font = { color:{ argb:"FF667085" } };
    ws.addRow([]);
    const hr = ws.addRow(["ITEM", "COST CODE", ...sh.depts, "TOTAL"]);
    hr.font = { bold:true };
    hr.eachCell(c => { c.border = { bottom:{ style:"medium" } }; c.alignment = { horizontal:"center", wrapText:true }; });
    hr.getCell(1).alignment = { horizontal:"left" };

    for (const [kind, line, section] of LINES) {
      if (kind === "sec") {
        const r = ws.addRow([line, "", ...sh.depts.map(d => costCodeOf(section, d)), ""]);
        r.font = { bold:true };
        r.eachCell(c => c.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFEEF1F8" } });
        continue;
      }
      const vals = sh.depts.map(d => valueOf(kind, line, section, d));
      const r = ws.addRow([line, kind === "hc" ? "คน" : "", ...vals, vals.reduce((a, b) => a + b, 0)]);
      if (kind === "tot") { r.font = { bold:true }; r.eachCell(c => c.border = { top:{ style:"thin" } }); }
      r.eachCell((c, i) => { if (i > 2) c.numFmt = kind === "hc" ? count : money; });
    }
    const gt = ws.addRow(["GRAND TOTAL — PAYROLL EXPENSE", "",
      ...sh.depts.map(d => PB.deptTotal(rep, d)), sh.depts.reduce((t, d) => t + PB.deptTotal(rep, d), 0)]);
    gt.font = { bold:true };
    gt.eachCell((c, i) => { c.border = { top:{ style:"medium" } }; if (i > 2) c.numFmt = money; });
    ws.views = [{ state:"frozen", xSplit:2, ySplit:4 }];
  }

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url; a.download = `Payroll Report_${month || "draft"}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("ดาวน์โหลด Excel แล้ว", "success");
}

// ---------- PDF ----------
function printReport() {
  const w = window.open("", "_blank");
  if (!w) { toast("เบราว์เซอร์บล็อกป็อปอัป — อนุญาตแล้วลองใหม่", "error"); return; }
  const logo = new URL("assets/logo.png", location.href).href;
  const page = (title, depts) => `
    <div class="sheet">
      <div class="top"><img class="logo" src="${logo}" alt=""><div class="site">Chatree Gold Mine</div></div>
      <div class="rule"></div>
      <h1>PAYROLL REPORT — ${esc(title)}</h1>
      <div class="period">งวด ${esc(month || "-")}</div>
      <table class="grid">
        <tr><th class="l">ITEM</th><th>COST CODE</th>${depts.map(d => `<th>${esc(d)}</th>`).join("")}<th>TOTAL</th></tr>
        ${LINES.map(([kind, line, section]) => {
          if (kind === "sec") return `<tr class="sec"><td class="l">${esc(line)}</td><td></td>${
            depts.map(d => `<td class="cc">${esc(costCodeOf(section, d))}</td>`).join("")}<td></td></tr>`;
          const vals = depts.map(d => valueOf(kind, line, section, d));
          return `<tr class="${kind === "tot" ? "tot" : ""}"><td class="l">${esc(line)}</td>
            <td class="c">${kind === "hc" ? "คน" : ""}</td>
            ${vals.map(v => `<td class="n">${kind === "hc" ? fmtI(v) : fmt(v)}</td>`).join("")}
            <td class="n">${kind === "hc" ? fmtI(vals.reduce((a,b)=>a+b,0)) : fmt(vals.reduce((a,b)=>a+b,0))}</td></tr>`;
        }).join("")}
        <tr class="gt"><td class="l">GRAND TOTAL — PAYROLL EXPENSE</td><td></td>
          ${depts.map(d => `<td class="n">${fmt(PB.deptTotal(rep, d))}</td>`).join("")}
          <td class="n">${fmt(depts.reduce((t, d) => t + PB.deptTotal(rep, d), 0))}</td></tr>
      </table>
    </div>`;

  const summary = `
    <div class="sheet">
      <div class="top"><img class="logo" src="${logo}" alt=""><div class="site">Chatree Gold Mine</div></div>
      <div class="rule"></div>
      <h1>PAYROLL REPORT — SUMMARY</h1>
      <div class="period">งวด ${esc(month || "-")}</div>
      <table class="grid">
        <tr><th class="l">สายงาน</th><th>จำนวนคน</th><th>ค่าใช้จ่าย (THB)</th></tr>
        ${PB.GROUPS.map(g => `<tr><td class="l">${esc(g.name)}</td>
          <td class="c">${fmtI(["senior","staff","consultants","contractors","casual"].reduce((t,s)=>t+PB.groupHc(rep,s,g),0))}</td>
          <td class="n">${fmt(g.depts.reduce((t,d)=>t+PB.deptTotal(rep,d),0))}</td></tr>`).join("")}
        ${PB.STANDALONE.map(d => `<tr><td class="l">${esc(d)}</td>
          <td class="c">${fmtI(["senior","staff","consultants","contractors","casual"].reduce((t,s)=>t+rep.headcount(s,d),0))}</td>
          <td class="n">${fmt(PB.deptTotal(rep, d))}</td></tr>`).join("")}
        <tr class="gt"><td class="l">รวมทั้งหมด</td><td class="c">${fmtI(PB.grandHeadcount(rep))}</td>
          <td class="n">${fmt(PB.grandExpense(rep))}</td></tr>
      </table>
      <h2>DEDUCTION — STAFF EXPENSES</h2>
      <table class="grid">
        ${[["Provident Fund", PB.DED_CODES.pvd, rep.ded.pvd],
           ["Social Security", PB.DED_CODES.sso, rep.ded.sso],
           ["Student Loan (general)", PB.DED_CODES.studentLoan, rep.ded.studentLoan],
           ["Legal Execution Department", PB.DED_CODES.led, rep.ded.led],
           ["Clearing Account — Employee W/Tax (PND 1)", PB.DED_CODES.pnd1, rep.ded.pnd1],
           ["CL ACC EXP — Clearing Account W/Tax (PND 3)", PB.DED_CODES.pnd3, rep.ded.pnd3]]
          .map(([l, c, v]) => `<tr><td class="l">${esc(l)}</td><td class="cc">${esc(c)}</td><td class="n">${fmt(v)}</td></tr>`).join("")}
        <tr class="gt"><td class="l">GRAND TOTAL — DEDUCTION</td><td></td><td class="n">${fmt(PB.totalDeduction(rep))}</td></tr>
        <tr class="gt"><td class="l">NET SALARY</td><td></td><td class="n">${fmt(PB.netSalary(rep))}</td></tr>
      </table>
      <h2>PROVIDENT FUND : K MASTER POOL FUND</h2>
      <table class="grid">
        <tr><td class="l">Provident Fund Employer Contribution</td><td class="cc">${esc(PB.DED_CODES.pvdEmployer)}</td>
        <td class="n">${fmt(rep.ded.pvdEmployer)}</td></tr>
      </table>
    </div>`;

  const pages = [summary,
    ...PB.GROUPS.map(g => page(g.name, g.depts)),
    page("BKK OFFICE & LEGAL", PB.STANDALONE)];

  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8">
    <title>Payroll Report ${esc(month)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
    <style>${PRINT_CSS}</style></head><body>${pages.join("")}
    <div class="noprint"><button onclick="window.print()">🖨 พิมพ์ / บันทึกเป็น PDF</button>
      <div class="tip">ตั้ง Paper size = A4 · Layout = Landscape · ปิด Headers and footers</div></div>
    </body></html>`);
  w.document.close();
}

const PRINT_CSS = `
@page { size: A4 landscape; margin: 10mm 11mm; }
*{box-sizing:border-box;}
body{font-family:'Sarabun',system-ui,sans-serif;font-size:7.4pt;color:#000;background:#fff;margin:0;}
.sheet{page-break-after:always;}
.sheet:last-of-type{page-break-after:auto;}
.top{display:flex;align-items:flex-end;justify-content:space-between;}
.logo{height:8.5mm;}
.site{font-size:9pt;font-weight:700;color:#1a3e9a;}
.rule{height:1.2pt;background:#1a3e9a;margin:1mm 0 2mm;}
h1{font-size:10pt;text-align:center;margin:0;}
h2{font-size:8pt;margin:2.6mm 0 1mm;}
.period{text-align:center;font-size:7.4pt;color:#667085;margin:.6mm 0 2mm;}
table.grid{border-collapse:collapse;width:100%;}
.grid th,.grid td{border:.5pt solid #333;padding:.5mm 1.3mm;line-height:1.25;}
.grid th{background:#eef1f8;font-weight:700;text-align:center;}
.l{text-align:left;} .c{text-align:center;} .n{text-align:right;font-variant-numeric:tabular-nums;}
.cc{text-align:center;font-size:6pt;color:#475467;}
tr.sec td{background:#f4f6fb;font-weight:700;}
tr.tot td{font-weight:700;background:#fafbfd;}
tr.gt td{font-weight:700;border-top:1.2pt solid #000;}
.noprint{margin:6mm 0;text-align:center;}
.noprint button{font:inherit;padding:8px 18px;cursor:pointer;border:1px solid #1a3e9a;background:#1a3e9a;color:#fff;border-radius:6px;}
.noprint .tip{font-size:8pt;color:#667085;margin-top:3mm;}
@media print{.noprint{display:none;}}
`;
