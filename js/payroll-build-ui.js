// ===== หน้าสร้าง Payroll Register จากไฟล์ดิบ =====
// โยนไฟล์เข้ามาพร้อมกันหลายไฟล์ ระบบดูจากหัวตารางเองว่าไฟล์ไหนเป็นอะไร
// แล้วประกอบเป็นรายงาน -> ดูตัวอย่างบนจอ -> ดาวน์โหลด Excel / พิมพ์ PDF
//
// ⚠️ ไฟล์ดิบมีเงินเดือนรายคนทั้งบริษัท — อ่านในเบราว์เซอร์เท่านั้น
//    ที่ส่งขึ้นเซิร์ฟเวอร์มีแค่ "ยอดรวมระดับแผนก" ตอนกดบันทึก ซึ่งเป็นสิ่งที่ตาราง
//    payroll_summary ออกแบบมารองรับอยู่แล้ว — ไม่มีแถวรายคนถูกส่งขึ้นไปเลย
//    ส่วน localStorage จำแค่ "คนนี้ลงแผนกไหน" ซึ่งเป็นการจัดประเภท ไม่ใช่ตัวเงิน
import { esc, toast, can, allEmployees, currentUser } from "./app.js";
import { comboHTML, bindCombo } from "./combobox.js";
import { supabase } from "./supabase-config.js";
import * as PB from "./payroll-build.js";
import { LINES, SECTION_LINES, valueOf as valueAt, costCodeOf, monthLabel, registerDoc, fmt, fmtI, ssoKnown, cropInk } from "./payroll-register-doc.js";

const ASSIGN_KEY = "payroll_build_assign";

let files = [];          // [{name, role, aoa}]
let rep = null;          // ผลลัพธ์จาก buildReport
let month = "";
let assign = load();
let savedMonths = [];     // เดือนที่เคยบันทึกไว้ ใช้ดึงย้อนหลัง
let loadedFrom = "";      // เดือนที่กำลังเปิดดูจากประวัติ ("" = เพิ่งสร้างจากไฟล์)

// ผู้ลงนามท้ายรายงาน — แก้ได้ในหน้าจอ เก็บไว้ใช้รอบถัดไป
const SIGN_KEY = "payroll_build_signers";
const DEFAULT_SIGNERS = [
  { role:"Prepared by", dept:"Human Resources", name:"Kopbun Tungkasen",     title:"HRIS Supervisor" },
  { role:"Reviewed by", dept:"HR Manager",      name:"Chalita Kongpradab",   title:"Compensation & Benefit Supervisor" },
  { role:"Approved by", dept:"HR Manager",      name:"Suphachoke Phanthumitr", title:"Human Resources Manager" },
];
let signers = (() => {
  try { const v = JSON.parse(localStorage.getItem(SIGN_KEY)); return Array.isArray(v) && v.length ? v : DEFAULT_SIGNERS; }
  catch { return DEFAULT_SIGNERS; }
})();
const saveSigners = () => { try { localStorage.setItem(SIGN_KEY, JSON.stringify(signers)); } catch {} };

// ---------- เซ็นออนไลน์ (sql/schema_payroll_sign.sql · user 2026-10-21) ----------
// ส่งได้เฉพาะเดือนที่บันทึกในระบบแล้ว · ผู้ตรวจ/ผู้อนุมัติกดเซ็นจากลิงก์อีเมล (/payroll/sign.html) ไม่ต้อง login
// อัปโหลดเดือนนั้นใหม่แล้วบันทึกทับ = ลายเซ็นทั้งหมดถูกล้าง (trigger ใน DB) ต้องส่งเซ็นใหม่
// ค่าจ้างเหมา 3% ดึงจากงวดค่าจ้างเหมา (/contract) ของเดือนเดียวกันเอง ไม่ต้องอัปโหลดไฟล์ Consultant (user 2026-10-21)
// ถ้าอัปโหลดไฟล์ Consultant มาเอง ใช้ไฟล์นั้นแทน · ส่งเข้า buildReport เป็น "ไฟล์" ที่สร้างจากระบบ (fromContract)
let ctInfo = null;        // { month, status, count } | { month, none:true } | { month, err }
async function pullContract() {
  files = files.filter(f => !f.fromContract);
  if (!month || files.some(f => f.role === "consultant")) { ctInfo = null; return rebuild(); }
  try {
    const { data: run, error } = await supabase.from("contract_pay_run").select("id,status").eq("period", month).maybeSingle();
    if (error) throw error;
    if (!run) { ctInfo = { month, none:true }; return rebuild(); }
    const [it, ad] = await Promise.all([
      supabase.from("contract_pay_item").select("worker_id,worker_code,tax_id,name_th,name_en,worker_type,department,base_amount,extra_amount,wht_amount").eq("run_id", run.id),
      supabase.from("contract_pay_adjust").select("worker_id,kind,label,amount").eq("run_id", run.id),
    ]);
    if (it.error) throw it.error;
    files.push({ name: `งวดค่าจ้างเหมา ${month} (ดึงจากระบบ)`, role: "consultant", fromContract: true,
                 aoa: PB.contractToConsultantAoa(it.data || [], ad.data || []) });
    ctInfo = { month, status: run.status, count: (it.data || []).length };
  } catch (e) { ctInfo = { month, err: e.message || String(e) }; }
  rebuild();
}
const CT_ST = { draft:"ร่าง", calculated:"คำนวณแล้ว", pending:"รออนุมัติ", approved:"อนุมัติแล้ว", locked:"ล็อกแล้ว" };
function ctNote() {
  if (!ctInfo || ctInfo.month !== month) return files.some(f => f.role === "consultant" && !f.fromContract)
    ? `<div class="text-sm text-muted mt-2">ค่าจ้างเหมา 3%: ใช้ไฟล์ Consultant ที่อัปโหลด (ไม่ได้ดึงจากงวดค่าจ้างเหมา)</div>` : "";
  if (ctInfo.err) return `<div class="pa-warn mt-2">ดึงงวดค่าจ้างเหมาไม่ได้: ${esc(ctInfo.err)} — อัปโหลดไฟล์ Consultant แทนได้</div>`;
  if (ctInfo.none) return `<div class="pa-warn mt-2">ยังไม่มีงวดค่าจ้างเหมาเดือน ${esc(month)} — รายงานจะไม่มีที่ปรึกษา/จ้างเหมา (สร้างงวดที่ <a href="/contract/#/runs" style="text-decoration:underline">ค่าจ้างเหมา</a> หรืออัปโหลดไฟล์ Consultant)</div>`;
  const final = ["approved","locked"].includes(ctInfo.status);
  return `<div class="${final ? "text-sm text-muted" : "pa-warn"} mt-2">ค่าจ้างเหมา 3%: ดึงจากงวดค่าจ้างเหมา ${esc(month)} · ${ctInfo.count} คน · สถานะ <b>${esc(CT_ST[ctInfo.status] || ctInfo.status)}</b>${final ? "" : " — งวดยังไม่อนุมัติ ตัวเลขอาจเปลี่ยน เลือกงวดเงินเดือนใหม่อีกครั้งเพื่อดึงล่าสุด"}</div>`;
}
// แจกแจง Other Income (General) ที่ HR กรอกเอง (user 2026-10-22) — เก็บในหน่วยความจำ ไม่ลง localStorage (เป็นตัวเงิน)
let oiGen = { month:"", rows:[], loading:false };
const genTotal = () => rep ? (PB.oiTotals(rep).find(x => x[0] === PB.OI_GENERAL)?.[1] || 0) : 0;
const genSum = () => PB.oiGenMerge(oiGen.rows).reduce((t, x) => t + x.amount, 0);
const genLocked = () => inSystem() && sign.month === month && ["pending","approved"].includes(sign.row?.status);
function syncGen() {
  if (!rep) return;
  if (oiGen.month !== month) {
    // เดือนที่เคยบันทึกไว้ → ดึงแจกแจงเดิมมาตั้งต้น · เดือนใหม่ → ว่าง
    oiGen = { month, rows: rep.fromHistory ? (rep.oiGeneral || []).map(x => ({ ...x })) : [], loading: !rep.fromHistory && savedMonths.includes(month) };
    if (oiGen.loading) supabase.from("payroll_summary").select("line_item,value,row_order").eq("month", month).eq("section", PB.OI_GEN_LABEL)
      .then(({ data }) => { if (oiGen.month !== month) return;
        oiGen = { month, rows: (data || []).sort((a, b) => a.row_order - b.row_order).map(r => ({ label: r.line_item, amount: Number(r.value) || 0 })), loading:false };
        renderPayrollBuild(); });
  }
  rep.oiGeneral = oiGen.rows;
}
// บรรทัดเทียบยอด — อัปเดตเฉพาะบรรทัดนี้ตอนพิมพ์ (ถ้าวาดทั้งหน้าใหม่ ปุ่มที่กำลังกดจะหายก่อนคลิกถึง)
const genStatus = (total, diff) => `<div id="pbGenSum" class="${Math.abs(diff) < 0.01 ? "pa-ok" : "pa-warn"} mt-3">กรอกแล้ว ${fmt(genSum())} / ${fmt(total)} บาท
      ${Math.abs(diff) < 0.01 ? "— ตรงกับไฟล์ ✓" : `— ยังขาด ${fmt(diff)} บาท (จะขึ้นเป็น Not itemised)`}</div>`;
function oiGenCard() {
  const total = genTotal();
  if (!total && !oiGen.rows.length) return "";
  const lock = genLocked(), diff = Math.round((total - genSum()) * 100) / 100;
  return `<div class="card card-body mt-4">
    <div class="card-title" style="margin:0;">แจกแจง Other Income (General) · รายได้อื่นๆ</div>
    <div class="text-sm text-muted">ในไฟล์เป็นก้อนเดียว ${fmt(total)} บาท — กรอกรายการจากข้อมูลหลังบ้าน (ชื่อภาษาอังกฤษ) ขึ้นใต้บรรทัด Other Income (General) ในหน้า Summary ของ PDF/Excel ·
      ส่วนที่ยังไม่ได้กรอกขึ้นเป็น “Not itemised”</div>
    ${oiGen.loading ? `<div class="text-sm text-muted mt-2">กำลังโหลดรายการที่บันทึกไว้…</div>` : `
    <div class="pb-gen mt-3">${oiGen.rows.map((x, i) => `<div class="pb-gen-row">
      <input class="form-input" value="${esc(x.label || "")}" placeholder="เช่น Telephone Allowance" ${lock ? "disabled" : ""} oninput="window._pbGen(${i},'label',this.value)">
      <input class="form-input text-right" type="number" step="0.01" value="${x.amount === "" ? "" : esc(x.amount)}" placeholder="0.00" ${lock ? "disabled" : ""} oninput="window._pbGen(${i},'amount',this.value)">
      ${lock ? "" : `<button class="pb-x" title="ลบ" onclick="window._pbGenDel(${i})">×</button>`}</div>`).join("")}</div>
    ${lock ? "" : `<button class="btn btn-secondary btn-sm mt-2" onclick="window._pbGenAdd()">+ เพิ่มรายการ</button>`}
    ${genStatus(total, diff)}
    ${lock ? `<div class="text-sm text-muted mt-2">ล็อกอยู่ เพราะส่งเซ็นออนไลน์แล้ว — ยกเลิกการส่งเซ็นก่อนถ้าจะแก้</div>`
      : inSystem() ? `<button class="btn btn-primary btn-sm mt-2" onclick="window._pbGenSave()">💾 บันทึกแจกแจง</button>`
      : `<div class="text-sm text-muted mt-2">บันทึกไปพร้อมรายงานตอนกด 💾 บันทึกเข้าระบบ</div>`}`}
  </div>`;
}
let savedNow = "";        // เดือนที่เพิ่งกดบันทึกในรอบนี้ (rep บนจอ = ข้อมูลที่อยู่ในระบบ)
let sign = { month:"", row:null, img:{}, loading:false };   // payroll_sign ของเดือนที่เปิดอยู่ + รูปลายเซ็น (data URL)
let prSignerList = null;  // [{user_id,name,title,email}] คนที่มีลายเซ็นในระบบ
const enDate = iso => iso ? new Date(iso).toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric", timeZone:"Asia/Bangkok" }) : "";
const inSystem = () => month && (loadedFrom === month || savedNow === month);
async function loadSign(force = false) {
  if (!inSystem()) { sign = { month:"", row:null, img:{}, loading:false }; return; }
  if (!force && (sign.month === month || sign.loading)) return;
  sign = { month, row:null, img:{}, loading:true };
  const [r, list] = await Promise.all([
    supabase.from("payroll_sign").select("*").eq("month", month).maybeSingle(),
    prSignerList ? { data: prSignerList } : supabase.rpc("pr_signers"),
  ]);
  prSignerList = list.data || [];
  sign = { month, row: r.data || null, img:{}, loading:false };
  if (sign.row?.steps?.some(x => x.signed_at)) {
    try {
      const { data: x } = await supabase.functions.invoke("letter-notify", { body: { pr_month: month, action: "pr_files" } });
      await Promise.all(Object.entries(x?.sig || {}).map(async ([k, u]) => {
        if (!u) return;
        const b = await fetch(u).then(r => r.ok ? r.blob() : null).catch(() => null);
        if (b) sign.img[k] = await cropInk(await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }));
      }));
    } catch {}
  }
  renderPayrollBuild();
}
// ผู้ลงนามที่ใช้ในเอกสาร: ส่งเซ็นออนไลน์แล้ว → ตามที่ส่ง (+รูปลายเซ็น/วันที่ของช่องที่เซ็นแล้ว) · ยังไม่ส่ง → ตามที่กรอกในหน้าจอ
function docSigners() {
  const r = sign.month === month ? sign.row : null;
  if (!r || r.status === "rejected") return signers;
  return r.steps.map(x => ({ role:x.role, dept:x.dept, name:x.name, title:x.title,
    sig: x.signed_at ? sign.img[String(x.step)] || "" : "", date: x.signed_at ? enDate(x.signed_at) : "" }));
}


function load() {
  try { return JSON.parse(localStorage.getItem(ASSIGN_KEY)) || {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(ASSIGN_KEY, JSON.stringify(assign)); } catch {}
}


// ---------- หน้าเว็บ ----------
async function loadSavedMonths() {
  const { data } = await supabase.from("payroll_period").select("month").order("month", { ascending:false });
  savedMonths = (data || []).map(r => r.month);
}

export function renderPayrollBuild() {
  const pg = document.getElementById("pagePayrollbuild");
  if (!can("data.payroll.read")) { pg.innerHTML = ""; return; }
  syncGen();
  // โหลดรายชื่อเดือนครั้งเดียวตอนเปิดหน้า แล้ววาดซ้ำเมื่อได้ผล
  if (!savedMonths.length && !loadedFrom) loadSavedMonths().then(() => { if (savedMonths.length) renderPayrollBuild(); });

  pg.innerHTML = `
  <div class="page-header">
    <div><div class="page-heading">สร้าง Payroll Register</div>
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
    ${rep?.fromHistory && !rep.dedByDept ? `<div class="pa-bad" style="margin-bottom:14px;">
      เดือน <b>${esc(loadedFrom)}</b> ถูกบันทึกไว้ก่อนที่ระบบจะเก็บยอดหักแยกรายแผนก — ในระบบจึงมีแค่ยอดหักรวมทั้งบริษัท
      ช่องหักรายแผนกในรายงานจะแสดงเป็น “—” ไม่ใช่ 0<br>
      แก้ได้โดยอัปโหลดไฟล์ของเดือนนี้อีกครั้ง แล้วกด 💾 บันทึกเข้าระบบ ทับของเดิม
    </div>` : ""}
    ${rep?.fromHistory ? `<div class="pa-ok" style="margin-bottom:14px;">
      กำลังดูรายงานเดือน <b>${esc(loadedFrom)}</b> ที่บันทึกไว้ — พิมพ์หรือดาวน์โหลดได้เลยโดยไม่ต้องอัปโหลดไฟล์ใหม่
      · ถ้าจะสร้างใหม่ให้เลือกไฟล์ด้านล่าง
    </div>` : ""}
    ${uploadCard()}
    ${rep ? assignCard() + warnCard() + summaryCard() + oiGenCard() + signCard() : ""}
  </div>`;
  wire();
  bindFind();
  if (rep && inSystem() && sign.month !== month && !sign.loading) loadSign();
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
      </div>${ctNote()}`
    : `<div class="pb-empty mt-3">ยังไม่ได้เลือกไฟล์<br>
        <span class="text-sm">ไฟล์ที่ต้องใช้: <b>BeforeProcessYDP</b> (เงินเดือนดิบ) — ค่าจ้างเหมา 3% ดึงจากงวดค่าจ้างเหมาเดือนเดียวกันให้เอง
          (มีไฟล์ <b>Consultant</b> ก็อัปโหลดแทนได้)</span></div>`}
  </div>`;
}

const ROLE_TH = { payroll:"เงินเดือนดิบ", consultant:"ที่ปรึกษา / จ้างเหมา",
                  stafflist:"ทะเบียนพนักงาน (ไม่จำเป็น — ใช้ของในเว็บอยู่แล้ว)",
                  refDept:"ตารางแผนก", refJobLevel:"ตารางระดับงาน" };

// ---------- การลงแผนกด้วยมือ ----------
// แสดงทั้งคนที่ยังไม่ได้เลือก และคนที่เลือกไปแล้ว ไว้ในตารางเดียวกัน
// เดิมพอเลือกเสร็จแถวหายจากหน้าจอทันที ถ้าเลือกผิดจะไม่มีทางกลับไปแก้ได้เลย
// รายชื่อทุกคนในไฟล์ ไว้ให้ค้นหาเพื่อเปลี่ยนหมวด — ไม่มีตัวเงินติดมากับรายการ
const SECTION_TH = { senior:"SENIOR STAFF", staff:"STAFF", casual:"CASUAL LABOUR",
                     consultants:"CONSULTANTS — TECHNICAL", contractors:"CONTRACTORS — OTHER",
                     director:"DIRECTOR'S FEE" };
const peopleItems = () => (rep?.people || [])
  .filter(p => !assign[p.code])
  .map(p => ({ value:p.code, label:`${p.code} — ${p.name || ""}`,
               // ใส่ชื่ออีกภาษาลงใน sub ด้วย เพราะ combobox ค้นจาก label + sub
               sub:[p.alias, p.org, p.level, SECTION_TH[p.section] || p.section].filter(Boolean).join(" · ") }));

// ผูก combobox หลังวาดหน้าเสร็จทุกครั้ง เพราะหน้าถูกวาดใหม่ทั้งหน้าเมื่อมีการเปลี่ยนแปลง
function bindFind() {
  if (!document.getElementById("pbFind_txt")) return;
  bindCombo("pbFind", peopleItems(), code => {
    if (!code) return;
    const p = (rep?.people || []).find(x => x.code === code);
    if (!p) return;
    // ตั้งต้นด้วยที่ระบบจัดไว้ให้ก่อน แล้วผู้ใช้ค่อยเปลี่ยนหมวดในตารางข้างล่าง
    assign[code] = { dept:p.dept, section:p.section, type:p.section };
    save();
    rebuild();
  });
}

function assignCard() {
  const rows = [
    ...rep.unassigned.map(u => ({ ...u, done:false })),
    ...rep.assigned.map(a => ({ ...a, done:true, why:"" })),
  ];
  const deptOpts = sel => `<option value="">— เลือก —</option>` + PB.ALL_DEPTS.map(d =>
    `<option value="${esc(d)}" ${d === sel ? "selected" : ""}>${esc(d)}</option>`).join("");
  // ใช้ชื่อเดียวกับหัวข้อในรายงานเป๊ะ ๆ แล้วต่อท้ายด้วยคำไทย
  // ก่อนหน้านี้ตั้งชื่อว่า "จ้างเหมาอื่น" ซึ่งไม่ตรงกับ CONTRACTORS — OTHER ในรายงาน หาไม่เจอกัน
  const secOpts = sel => [
      ["senior","SENIOR STAFF (พนักงานระดับ M · S)"],
      ["staff","STAFF (พนักงานระดับ O)"],
      ["consultants","CONSULTANTS — TECHNICAL (ที่ปรึกษา)"],
      ["contractors","CONTRACTORS — OTHER (สัญญาจ้าง / จ้างเหมา)"],
      ["casual","CASUAL LABOUR (แรงงานรายวัน)"],
      ["director","DIRECTOR'S FEE (กรรมการบริษัท)"]]
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
    <div class="pb-find mt-3">
      <label class="form-label">ย้ายคนที่ระบบจัดไปแล้ว — เช่น พนักงานสัญญาจ้างที่ต้องลง CONTRACTORS — OTHER<br>พิมพ์ชื่อไทย ชื่ออังกฤษ หรือรหัสก็ได้</label>
      ${comboHTML("pbFind", peopleItems(), "", "พิมพ์ชื่อหรือรหัสพนักงาน")}
    </div>
    ${rows.length ? `<table class="pb-tbl mt-3">
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
    </table>` : ""}
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

// ---------- ผู้ลงนาม ----------
function signCard() {
  return `<div class="card card-body mt-4">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
      <div><div class="card-title" style="margin:0;">ผู้ลงนามท้ายรายงาน (${signers.length} ช่อง)</div>
        <div class="text-sm text-muted">ขึ้นที่หน้าสรุปของ PDF และชีต Summary ของ Excel · ช่องวันที่เว้นว่างไว้ให้เซ็นด้วยมือ</div></div>
      <button class="btn btn-secondary btn-sm" onclick="window._pbSignAdd()">+ เพิ่มผู้ลงนาม</button>
    </div>
    <div class="pb-signs mt-3">${signers.map((sg, i) => `<div class="pb-sign">
      <div class="pb-sign-h">
        <span>ช่องที่ ${i + 1}</span>
        ${signers.length > 1 ? `<button class="pb-x" title="ลบช่องนี้" onclick="window._pbSignDel(${i})">×</button>` : ""}
      </div>
      <input class="form-input" value="${esc(sg.role || "")}" placeholder="หัวข้อ เช่น Prepared by"
             onchange="window._pbSigner(${i},'role',this.value)">
      <input class="form-input mt-2" value="${esc(sg.dept || "")}" placeholder="หน่วยงาน (บรรทัดเล็กใต้หัวข้อ)"
             onchange="window._pbSigner(${i},'dept',this.value)">
      <input class="form-input mt-2" value="${esc(sg.name || "")}" placeholder="ชื่อ-นามสกุล"
             onchange="window._pbSigner(${i},'name',this.value)">
      <input class="form-input mt-2" value="${esc(sg.title || "")}" placeholder="ตำแหน่ง"
             onchange="window._pbSigner(${i},'title',this.value)">
      ${pickable() ? (i === 0
        ? `<div class="text-sm text-muted mt-2">เซ็นออนไลน์: ช่องนี้ = คุณ (ลงนามทันทีตอนกดส่ง)</div>`
        : `<select class="form-input mt-2" onchange="window._pbSignUser(${i},this.value)">
            <option value="">— เลือกผู้ลงนามในระบบ (เซ็นออนไลน์) —</option>
            ${(prSignerList || []).map(u => `<option value="${esc(u.user_id)}" ${u.user_id === sg.user_id ? "selected" : ""}>${esc(u.name)}${u.title ? " · " + esc(u.title) : ""}</option>`).join("")}
          </select>`) : ""}
    </div>`).join("")}</div>
    ${onlineSignHTML()}
  </div>`;
}
const pickable = () => inSystem() && sign.month === month && !sign.loading && (!sign.row || sign.row.status === "rejected");

function onlineSignHTML() {
  if (!month) return "";
  if (!inSystem()) return `<div class="pa-warn mt-3">เซ็นออนไลน์: กด 💾 บันทึกเข้าระบบ ก่อน แล้วจึงส่งเซ็นได้ (ผู้ลงนามเห็นรายงานตามที่บันทึกไว้ในระบบ)</div>`;
  if (sign.month !== month || sign.loading) return `<div class="text-sm text-muted mt-3">กำลังโหลดสถานะการเซ็นออนไลน์…</div>`;
  const r = sign.row, w = can("data.payroll.write");
  if (!r || r.status === "rejected") {
    const me = (prSignerList || []).find(u => u.user_id === currentUser?.id);
    return `<div class="pb-online mt-3">
      ${r?.status === "rejected" ? `<div class="pa-bad" style="margin-bottom:10px;">↩ ถูกส่งกลับ: ${esc(r.reject_reason || "-")} — แก้แล้วบันทึกใหม่ หรือส่งเซ็นใหม่</div>` : ""}
      <div class="text-sm">✍️ <b>เซ็นออนไลน์</b> — เลือกผู้ลงนามในระบบของแต่ละช่องด้านบน แล้วกดส่ง ระบบส่งลิงก์ให้ทีละคนตามลำดับ (กดเซ็นได้โดยไม่ต้อง login)</div>
      ${me ? "" : `<div class="pa-warn mt-2">คุณยังไม่มีลายเซ็นในระบบ — ตั้งได้ที่ ออกหนังสือ HR → ตั้งค่า → ลายเซ็น (ใช้ชื่อภาษาอังกฤษในรายงาน)</div>`}
      ${w ? `<button class="btn btn-primary btn-sm mt-2" onclick="window._pbSignSend()" ${me ? "" : "disabled"}>✍️ ส่งเซ็นออนไลน์</button>` : ""}
    </div>`;
  }
  const row = x => `<div class="pb-step"><i>${x.signed_at ? "✓" : x.step === r.cur_step ? "●" : "○"}</i>
    <b>${esc(x.role || "")}</b> ${esc(x.name || "")} <span class="text-muted">· ${x.signed_at ? esc(enDate(x.signed_at)) + (x.via === "email_link" ? " (ลิงก์อีเมล)" : "") : x.step === r.cur_step ? "รอลงนาม" : "—"}</span></div>`;
  return `<div class="pb-online mt-3">
    <div class="text-sm"><b>${r.status === "approved" ? "✅ ลงนามครบแล้ว — PDF/Excel มีลายเซ็นและวันที่" : "⏳ รอลงนาม"}</b></div>
    ${r.steps.map(row).join("")}
    ${w ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
      ${r.status === "pending" ? `<button class="btn btn-secondary btn-sm" onclick="window._pbSignMail()">✉️ ส่งอีเมลขอลงนาม</button>
        <button class="btn btn-secondary btn-sm" onclick="window._pbSignCopy()">📋 คัดลอกลิงก์ขั้นที่รอ</button>
        <button class="btn btn-secondary btn-sm" onclick="window._pbSignRenew()">🔄 ออกลิงก์ใหม่</button>` : ""}
      <button class="btn btn-secondary btn-sm" onclick="window._pbSignCancel()">${r.status === "approved" ? "ล้างลายเซ็น" : "ยกเลิกการส่งเซ็น"}</button></div>` : ""}
  </div>`;
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
  window._pbMonth = v => { month = v; if (files.some(f => f.role === "payroll")) pullContract(); else renderPayrollBuild(); };
  window._pbClear = () => { files = []; rep = null; loadedFrom = ""; ctInfo = null; renderPayrollBuild(); };
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
    if (!month) month = guessMonth() || new Date().toISOString().slice(0, 7);
    await pullContract();
  };

  window._pbSave = async () => {
    if (!rep || rep.fromHistory) return;
    if (!month) { toast("เลือกงวดเงินเดือนก่อน", "error"); return; }
    if (rep.unassigned.length) { toast("ยังมีคนที่ยังไม่ได้ลงแผนก", "error"); return; }
    syncGen();
    { const diff = Math.round((genTotal() - genSum()) * 100) / 100;
      if (genTotal() && Math.abs(diff) >= 0.01 && !confirm(`แจกแจง Other Income (General) ยังไม่ครบ (ขาด ${fmt(diff)} บาท) — บันทึกต่อไหม? ส่วนที่ขาดจะขึ้นเป็น Not itemised`)) return; }
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
    savedNow = month; sign.month = "";      // ลายเซ็นเดิมของเดือนนี้ถูกล้างแล้ว (ตัวเลขเปลี่ยน) — โหลดสถานะใหม่
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

  window._pbSigner = (i, k, v) => { signers[i] = { ...signers[i], [k]: v }; saveSigners(); };
  window._pbGen = (i, k, v) => {
    oiGen.rows[i] = { ...oiGen.rows[i], [k]: k === "amount" ? (v === "" ? "" : Number(v)) : v };
    const el = document.getElementById("pbGenSum"), total = genTotal();
    if (el) el.outerHTML = genStatus(total, Math.round((total - genSum()) * 100) / 100);
  };
  window._pbGenAdd = () => { oiGen.rows = [...oiGen.rows, { label:"", amount:"" }]; renderPayrollBuild(); };
  window._pbGenDel = i => { oiGen.rows = oiGen.rows.filter((_, j) => j !== i); renderPayrollBuild(); };
  // เดือนที่อยู่ในระบบแล้ว: บันทึกเฉพาะแจกแจง ไม่แตะตัวเลขรายงาน (ลายเซ็นไม่ถูกล้าง)
  window._pbGenSave = async () => {
    if (genLocked()) return;
    const diff = Math.round((genTotal() - genSum()) * 100) / 100;
    if (Math.abs(diff) >= 0.01 && !confirm(`ยอดที่กรอกยังไม่เท่ายอดในไฟล์ (ขาด ${fmt(diff)} บาท) — บันทึกไปก่อน ส่วนที่ขาดขึ้นเป็น Not itemised?`)) return;
    rep.oiGeneral = oiGen.rows;
    const del = await supabase.from("payroll_summary").delete().eq("month", month).eq("section", PB.OI_GEN_LABEL);
    if (del.error) { toast("บันทึกไม่สำเร็จ: " + del.error.message, "error"); return; }
    const rows = PB.oiGenRows(rep, month, 900);
    if (rows.length) { const { error } = await supabase.from("payroll_summary").insert(rows);
      if (error) { toast("บันทึกไม่สำเร็จ: " + error.message, "error"); return; } }
    toast(`บันทึกแจกแจงแล้ว (${rows.length} รายการ)`, "success");
  };
  window._pbSignUser = (i, uid) => {
    const u = (prSignerList || []).find(x => x.user_id === uid);
    signers[i] = { ...signers[i], user_id: uid || "", ...(u ? { name: u.name, title: u.title || signers[i].title } : {}) };
    saveSigners(); renderPayrollBuild();
  };
  const signLink = t => `${location.origin}/payroll/sign.html?t=${t}`;
  const mailNext = async () => {
    const { data, error } = await supabase.functions.invoke("letter-notify", { body: { pr_month: month, action: "pr_request" } });
    if (error || data?.error) return "ส่งอีเมลไม่สำเร็จ — กดคัดลอกลิงก์ส่งเองได้";
    if (data?.sent) return `ส่งอีเมลถึง ${data.to} แล้ว`;
    return data?.reason === "outlook_mode" ? "โหมด Outlook — กด 📋 คัดลอกลิงก์ แล้วส่งอีเมลเอง" : "ยังไม่ได้ตั้งค่าการส่งอีเมล — กด 📋 คัดลอกลิงก์ แล้วส่งเอง";
  };
  window._pbSignSend = async () => {
    const steps = signers.map((sg, i) => ({ role: sg.role || "", dept: sg.dept || "", user_id: i === 0 ? currentUser?.id : sg.user_id }));
    const miss = steps.findIndex(x => !x.user_id);
    if (miss >= 0) { toast(`ช่องที่ ${miss + 1} ยังไม่ได้เลือกผู้ลงนามในระบบ`, "error"); return; }
    if (!confirm(`ส่ง Payroll Register ${month} ให้ลงนามออนไลน์ ${steps.length} ช่อง?\nช่องแรก (คุณ) ลงนามทันที แล้วระบบส่งลิงก์ให้ช่องที่ 2`)) return;
    const { error } = await supabase.rpc("pr_submit", { p_month: month, p_steps: steps });
    if (error) { toast("ส่งเซ็นไม่สำเร็จ: " + error.message, "error"); return; }
    toast(`ส่งเซ็นแล้ว · ${await mailNext()}`, "success");
    await loadSign(true);
  };
  window._pbSignMail = async () => toast(await mailNext(), "info");
  window._pbSignCopy = async () => {
    const { data, error } = await supabase.rpc("pr_pending_link", { p_month: month });
    if (error || !data) { toast("ไม่มีลิงก์ที่ใช้ได้ — กด 🔄 ออกลิงก์ใหม่", "error"); return; }
    try { await navigator.clipboard.writeText(signLink(data)); toast("คัดลอกลิงก์แล้ว — ส่งให้ผู้ลงนามคนเดียว (ใช้ได้ครั้งเดียว 14 วัน)", "success"); }
    catch { prompt("คัดลอกลิงก์นี้:", signLink(data)); }
  };
  window._pbSignRenew = async () => {
    if (!confirm("ออกลิงก์ใหม่ให้ขั้นที่รออยู่? ลิงก์เดิมจะใช้ไม่ได้")) return;
    const { error } = await supabase.rpc("pr_renew_link", { p_month: month });
    if (error) { toast("ไม่สำเร็จ: " + error.message, "error"); return; }
    toast("ออกลิงก์ใหม่แล้ว · " + await mailNext(), "success");
  };
  window._pbSignCancel = async () => {
    if (!confirm(sign.row?.status === "approved" ? "ล้างลายเซ็นทั้งหมดของเดือนนี้?" : "ยกเลิกการส่งเซ็น? ลายเซ็นที่มีแล้วจะหายและลิงก์ใช้ไม่ได้")) return;
    const { error } = await supabase.rpc("pr_cancel", { p_month: month });
    if (error) { toast("ไม่สำเร็จ: " + error.message, "error"); return; }
    await loadSign(true);
  };
  window._pbSignAdd = () => { signers = [...signers, { role:"", dept:"", name:"", title:"" }]; saveSigners(); renderPayrollBuild(); };
  window._pbSignDel = i => { signers = signers.filter((_, j) => j !== i); saveSigners(); renderPayrollBuild(); };
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

async function exportExcel() {
  if (!window.ExcelJS) { toast("กรุณารอโหลด library", "error"); return; }
  syncGen();
  const wb = new window.ExcelJS.Workbook();
  wb.creator = "Akara Resources HR System";
  wb.created = new Date();

  // สีและรูปแบบชุดเดียวกับ PDF เพื่อให้ไฟล์สองแบบดูเป็นรายงานฉบับเดียวกัน
  const NAVY = "FF0F1C4D", BAND = "FFEEF1F8", TINT = "FFF7FAFC",
        LINE = "FFE4E7EC", MUTED = "FF98A2B3", GREEN = "FF0D7C4B";
  const MONEY = '#,##0.00', COUNT = '#,##0';
  const fill = argb => ({ type:"pattern", pattern:"solid", fgColor:{ argb } });
  const thin = { style:"thin", color:{ argb:LINE } };

  const titleBlock = (ws, sub, span) => {
    ws.mergeCells(1, 1, 1, span);
    const t = ws.getCell(1, 1);
    t.value = "AKARA RESOURCES  ·  Chatree Gold Mine";
    t.font = { bold:true, size:13, color:{ argb:NAVY } };
    ws.mergeCells(2, 1, 2, span);
    const u = ws.getCell(2, 1);
    u.value = `PAYROLL REGISTER — ${sub}${month ? `  ·  ${monthLabel(month)}` : ""}`;
    u.font = { size:10, color:{ argb:"FF667085" } };
    ws.getRow(1).height = 20; ws.getRow(2).height = 15;
    ws.addRow([]);
  };
  const setup = (ws, span) => {
    ws.pageSetup = { orientation:"landscape", paperSize:9, fitToPage:true, fitToWidth:1, fitToHeight:0,
                     margins:{ left:0.4, right:0.4, top:0.5, bottom:0.5, header:0.2, footer:0.2 } };
    ws.headerFooter = { oddFooter:"&L&8Akara Resources — Payroll Register&R&8Page &P of &N" };
    ws.views = [{ state:"frozen", xSplit:2, ySplit:5 }];
  };

  // ---------- ชีตสรุป ----------
  const s1 = wb.addWorksheet("Summary", { properties:{ tabColor:{ argb:NAVY } } });
  s1.columns = [{ width:46 }, { width:16 }, { width:20 }];
  titleBlock(s1, "Summary", 3);
  const kh = s1.addRow(["DIVISION", "HEADCOUNT (persons)", "PAYROLL EXPENSE (THB)"]);
  kh.eachCell(c => { c.font = { bold:true, color:{ argb:"FFFFFFFF" }, size:10 }; c.fill = fill(NAVY);
                     c.alignment = { horizontal:"center" }; });
  kh.getCell(1).alignment = { horizontal:"left" };
  const hcOf = g => ["senior","staff","consultants","contractors","casual"].reduce((t, k) => t + PB.groupHc(rep, k, g), 0);
  for (const g of PB.GROUPS)
    s1.addRow([g.name, hcOf(g), g.depts.reduce((t, d) => t + PB.deptTotal(rep, d), 0)]);
  for (const d of PB.STANDALONE)
    s1.addRow([d, ["senior","staff","consultants","contractors","casual"].reduce((t, k) => t + rep.headcount(k, d), 0),
               PB.deptTotal(rep, d)]);
  const gt = s1.addRow(["GRAND TOTAL", PB.grandHeadcount(rep), PB.grandExpense(rep)]);
  gt.eachCell(c => { c.font = { bold:true, color:{ argb:NAVY } }; c.border = { top:{ style:"medium", color:{ argb:NAVY } } }; });
  // แจกแจง Other Income (รวมทั้งบริษัท) ให้บัญชีเห็น
  const oiT = PB.oiTotals(rep);
  if (oiT.length) {
    s1.addRow([]);
    const oh = s1.addRow(["OTHER INCOME — DETAIL", "", "THB"]);
    oh.eachCell(c => { c.font = { bold:true, color:{ argb:"FFFFFFFF" }, size:10 }; c.fill = fill(NAVY); });
    for (const [l, v] of oiT) {
      s1.addRow([l, "", v]);
      if (l !== PB.OI_GENERAL) continue;
      const g = PB.oiGenMerge(rep.oiGeneral), rest = PB.round2(v - g.reduce((t, x) => t + x.amount, 0));
      if (g.length) for (const x of [...g, ...(Math.abs(rest) >= 0.01 ? [{ label:"Not itemised", amount: rest }] : [])]) {
        const r = s1.addRow(["    – " + x.label, "", x.amount]);
        r.eachCell(c => c.font = { size:9, color:{ argb:MUTED } });
      }
    }
    const ot = s1.addRow(["TOTAL — OTHER INCOME (Senior + Staff)", "", PB.round2(oiT.reduce((t, x) => t + x[1], 0))]);
    ot.eachCell(c => { c.font = { bold:true }; c.fill = fill(TINT); });
  }

  s1.addRow([]);
  const dh = s1.addRow(["DEDUCTION — STAFF EXPENSES", "COST CODE", "THB"]);
  dh.eachCell(c => { c.font = { bold:true, color:{ argb:"FFFFFFFF" }, size:10 }; c.fill = fill(NAVY);
                     c.alignment = { horizontal:"center" }; });
  dh.getCell(1).alignment = { horizontal:"left" };
  for (const [l, c, v] of [["Provident Fund", PB.DED_CODES.pvd, rep.ded.pvd],
       ["Social Security", PB.DED_CODES.sso, rep.ded.sso],
       ["Student Loan (general)", PB.DED_CODES.studentLoan, rep.ded.studentLoan],
       ["Legal Execution Department", PB.DED_CODES.led, rep.ded.led],
       ["Clearing Account — Employee W/Tax (PND 1)", PB.DED_CODES.pnd1, rep.ded.pnd1],
       ["CL ACC EXP — Clearing Account W/Tax (PND 3)", PB.DED_CODES.pnd3, rep.ded.pnd3]]) {
    const r = s1.addRow([l, c, v]);
    r.getCell(2).font = { size:8, color:{ argb:MUTED } };
    r.getCell(2).alignment = { horizontal:"center" };
  }
  const dt = s1.addRow(["GRAND TOTAL — DEDUCTION", "", PB.totalDeduction(rep)]);
  dt.font = { bold:true }; dt.eachCell(c => c.border = { top:thin });
  const ns = s1.addRow(["NET SALARY", "", PB.netSalary(rep)]);
  ns.eachCell(c => { c.font = { bold:true, color:{ argb:GREEN } }; c.border = { top:{ style:"medium", color:{ argb:NAVY } } }; });
  s1.addRow([]);
  const pf = s1.addRow(["Provident Fund Employer Contribution", PB.DED_CODES.pvdEmployer, rep.ded.pvdEmployer]);
  pf.getCell(2).font = { size:8, color:{ argb:MUTED } };
  pf.getCell(2).alignment = { horizontal:"center" };
  s1.addRow(["Social Security Employer Contribution", "", rep.ded.ssoEmployer || 0]);
  s1.eachRow(r => { r.getCell(2).numFmt = r.getCell(2).numFmt || COUNT; r.getCell(3).numFmt = MONEY; });
  s1.getColumn(2).alignment = { horizontal:"right" };

  // ลายเซ็นท้ายชีตสรุป
  s1.addRow([]); s1.addRow([]);
  const sgs = docSigners();
  const sr = s1.addRow(sgs.map(sg => (sg.role || "").toUpperCase()));
  sr.eachCell(c => c.font = { bold:true, size:9 });
  const sd = s1.addRow(sgs.map(sg => sg.dept || ""));
  sd.eachCell(c => c.font = { size:9, color:{ argb:"FFB7791F" } });
  s1.addRow([]); s1.addRow([]);
  const sl = s1.addRow(sgs.map(() => ""));
  // ลายเซ็นออนไลน์ (ช่องที่เซ็นแล้ว) — วางรูปเหนือเส้นเซ็น
  sgs.forEach((sg, i) => {
    const m = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(sg.sig || "");
    if (!m) return;
    const id = wb.addImage({ base64: m[2], extension: m[1] === "png" ? "png" : "jpeg" });
    s1.addImage(id, { tl: { col: i + 0.3, row: sl.number - 2.6 }, ext: { width: 120, height: 44 } });   // ประมาณกึ่งกลางช่อง
  });
  sl.eachCell(c => c.border = { bottom:{ style:"thin", color:{ argb:"FF101828" } } });
  const sn = s1.addRow(sgs.map(sg => sg.name || ""));
  sn.eachCell(c => c.font = { bold:true, size:10 });
  const st = s1.addRow(sgs.map(sg => sg.title || ""));
  st.eachCell(c => c.font = { size:9, color:{ argb:"FF667085" } });
  const sdt = s1.addRow(sgs.map(sg => "Date  " + (sg.date || "______________________")));
  sdt.eachCell(c => c.font = { size:9, color:{ argb:"FF667085" } });
  setup(s1, 3);

  // ---------- ชีตละสายงาน ----------
  const sheets = [...PB.GROUPS.map(g => ({ name:g.name, depts:g.depts })),
                  { name:"BKK Office & Legal", depts:PB.STANDALONE }];
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name.slice(0, 31));
    ws.columns = [{ width:38 }, { width:11 }, ...sh.depts.map(() => ({ width:15 })), { width:16 }];
    titleBlock(ws, sh.name, sh.depts.length + 3);

    const hr = ws.addRow(["ITEM", "COST CODE", ...sh.depts, "TOTAL"]);
    hr.height = 28;
    hr.eachCell(c => { c.font = { bold:true, color:{ argb:"FFFFFFFF" }, size:9 }; c.fill = fill(NAVY);
                       c.alignment = { horizontal:"right", vertical:"bottom", wrapText:true }; });
    hr.getCell(1).alignment = { horizontal:"left", vertical:"bottom" };
    hr.getCell(2).alignment = { horizontal:"center", vertical:"bottom" };

    for (const [kind, line, section] of LINES) {
      if (kind === "sec") {
        const r = ws.addRow([line, "", ...sh.depts.map(d => costCodeOf(section, d)), ""]);
        r.eachCell((c, i) => {
          c.fill = fill(BAND);
          c.font = i <= 2 ? { bold:true, size:10 } : { size:7.5, color:{ argb:MUTED } };
          if (i > 2) c.alignment = { horizontal:"right" };
        });
        continue;
      }
      const vals = sh.depts.map(d => valueAt(rep, kind, line, section, d));
      const sum = vals.reduce((a, b) => a + b, 0);
      const r = ws.addRow([line, kind === "hc" ? "persons" : "", ...vals, sum]);
      r.eachCell((c, i) => {
        c.border = { bottom:thin };
        if (i > 2) c.numFmt = kind === "hc" ? COUNT : MONEY;
        if (kind === "tot") { c.font = { bold:true }; c.fill = fill(TINT); }
      });
      r.getCell(2).font = { size:8, color:{ argb:MUTED } };
      r.getCell(2).alignment = { horizontal:"center" };
      r.getCell(sh.depts.length + 3).font = { bold:true };
    }
    const hcRow = ws.addRow(["TOTAL HEADCOUNT", "persons",
      ...sh.depts.map(d => PB.deptHeadcount(rep, d)), sh.depts.reduce((t, d) => t + PB.deptHeadcount(rep, d), 0)]);
    hcRow.eachCell((c, i) => { c.font = { bold:true }; c.fill = fill(TINT);
      c.border = { top:thin, bottom:thin }; if (i > 2) c.numFmt = COUNT; });
    hcRow.getCell(2).font = { size:8, color:{ argb:MUTED } };
    hcRow.getCell(2).alignment = { horizontal:"center" };

    const g = ws.addRow(["GRAND TOTAL — PAYROLL EXPENSE", "",
      ...sh.depts.map(d => PB.deptTotal(rep, d)), sh.depts.reduce((t, d) => t + PB.deptTotal(rep, d), 0)]);
    g.eachCell((c, i) => {
      c.font = { bold:true, color:{ argb:NAVY }, size:10.5 };
      c.border = { top:{ style:"medium", color:{ argb:NAVY } } };
      if (i > 2) c.numFmt = MONEY;
    });

    // รายการหักแยกรายแผนก เหมือนต้นฉบับ
    const secRow = label => {
      const r = ws.addRow([label, "", ...sh.depts.map(() => ""), ""]);
      r.eachCell(c => { c.fill = fill(BAND); c.font = { bold:true, size:10 }; });
    };
    const dedRow = (label, code, fn, style, knownIf = true) => {
      const known = rep.dedByDept !== false && knownIf;
      const vals = sh.depts.map(d => known ? fn(d) : "—");
      const r = ws.addRow([label, code || "", ...vals, known ? vals.reduce((a, b) => a + b, 0) : "—"]);
      r.eachCell((c, i) => {
        c.border = { bottom:thin };
        if (i > 2) c.numFmt = MONEY;
        if (style === "tot") { c.font = { bold:true }; c.fill = fill(TINT); }
        if (style === "gt")  { c.font = { bold:true, color:{ argb:NAVY } };
                               c.border = { top:{ style:"medium", color:{ argb:NAVY } } }; }
      });
      r.getCell(2).font = { size:8, color:{ argb:MUTED } };
      r.getCell(2).alignment = { horizontal:"center" };
      r.getCell(sh.depts.length + 3).font = { bold:true, ...(style === "gt" ? { color:{ argb:NAVY } } : {}) };
    };
    ws.addRow([]);
    secRow("DEDUCTION — STAFF EXPENSES");
    for (const [k, l] of PB.DED_LINES) dedRow(l, PB.DED_CODES[k], d => PB.deptDed(rep, d, k));
    dedRow("GRAND TOTAL — DEDUCTION", "", d => PB.deptDeduction(rep, d), "tot");
    dedRow("NET SALARY", "", d => PB.deptNet(rep, d), "gt");
    ws.addRow([]);
    secRow("PROVIDENT FUND : K MASTER POOL FUND");
    dedRow("Provident Fund Employer Contribution", PB.DED_CODES.pvdEmployer, d => PB.deptDed(rep, d, "pvdEmployer"));
    ws.addRow([]);
    secRow("SOCIAL SECURITY");
    dedRow("Social Security Employer Contribution", "", d => PB.deptDed(rep, d, "ssoEmployer"), undefined, ssoKnown(rep));
    setup(ws, sh.depts.length + 3);
  }

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url; a.download = `Payroll Register_${month || "draft"}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("ดาวน์โหลด Excel แล้ว", "success");
}

// ---------- PDF ----------
function printReport() {
  const w = window.open("", "_blank");
  if (!w) { toast("เบราว์เซอร์บล็อกป็อปอัป — อนุญาตแล้วลองใหม่", "error"); return; }
  syncGen();
  w.document.write(registerDoc(rep, month, docSigners(), { toolbar: true }));
  w.document.close();
}
