import { supabase } from "./supabase-config.js";
import { allEmployees, can, esc as escText, toast, currentUser, navigate } from "./app.js";
import { comboHTML, bindCombo } from "./combobox.js";

// ============================================================================
// ทะเบียนเลขที่เอกสาร (หมวด "งานเอกสาร HR") — แทนไฟล์ "01 ลำดับเอกสาร HR.xlsx"
//   ออกเลขผ่าน doc_issue() ใน DB เท่านั้น (ล็อกกันเลขซ้ำ) · เลขที่ออกแล้วลบไม่ได้ ยกเลิกได้
//   นำเข้าประวัติจาก Excel เดิมผ่าน doc_import() — นำเข้าซ้ำได้ เลขที่มีแล้วข้าม
//   เลขที่ของหนังสือรับรอง/Offer Letter มีปุ่ม "สร้างหนังสือ" ส่งต่อไปหน้าออกหนังสือ HR
// ============================================================================

const esc = v => escText(v == null ? "" : String(v));
const canWrite = () => can("data.docregister.write");
const TH_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const thDate = iso => { if (!iso) return "-"; const d = new Date(iso + "T00:00:00");
  return `${d.getDate()} ${TH_MONTHS[d.getMonth()].slice(0, 3)}. ${d.getFullYear() + 543}`; };
// วันที่ออกในตาราง: วันที่ตัวใหญ่ + เดือนปี และวันในสัปดาห์ (อ่านไล่ตาได้เร็วกว่าข้อความยาว)
const TH_DAYS = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];
const dateCell = iso => {
  if (!iso) return `<span class="dr-date-none">ไม่ระบุ</span>`;
  const d = new Date(iso + "T00:00:00");
  return `<div class="dr-date"><b>${d.getDate()}</b><span>${TH_MONTHS[d.getMonth()].slice(0, 3)}. ${d.getFullYear() + 543}<small>วัน${TH_DAYS[d.getDay()]}</small></span></div>`;
};
const todayISO = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const empName = e => [e.firstname_th, e.lastname_th].filter(Boolean).join(" ");

// ประเภทในทะเบียนที่ระบบ "ออกหนังสือ HR" สร้างตัวหนังสือให้ได้ → ปุ่ม "สร้างหนังสือ" ที่แถวเลขที่
const LETTER_KIND = {
  "หนังสือรับรองการทำงาน (ภาษาไทย)": "cert_th", "หนังสือรับรองการทำงาน (ภาษาอังกฤษ)": "cert_en",
  "หนังสือรับรองเงินเดือน (ภาษาไทย)": "salary_th", "หนังสือรับรองเงินเดือน (ภาษาอังกฤษ)": "salary_en",
  "Offer Letter (จดหมายจ้างงาน)": "offer_en",
};
let linked = new Set();   // เลขที่ที่มีหนังสือในระบบแล้ว (ปุ่มเป็น "เปิดหนังสือ")
let cancelled = new Map(); // เลขที่ → เหตุผลของหนังสือที่ยกเลิกแล้วแต่เก็บเลขไว้ (ประวัติในทะเบียน)

// ---------------------------------------------------------------- อ่านไฟล์ Excel เดิม (pure — มีเทส)
const TH_MONTH_IDX = Object.fromEntries(TH_MONTHS.map((m, i) => [m, i]));
// วันที่ในไฟล์เดิมมีหลายแบบ: เลข serial ของ Excel · "6 กุมภาพันธ์ 2568" · "16/1/2026" — ที่อ่านไม่ออกคืน null
export function parseLogDate(v) {
  if (v == null || v === "") return null;
  const iso = (y, m, d) => {
    const dt = new Date(Date.UTC(y, m, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
  };
  const n = typeof v === "number" ? v : (/^\d{5}(\.\d+)?$/.test(String(v).trim()) ? +v : NaN);
  if (!isNaN(n)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5); return d.toISOString().slice(0, 10); }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\s+(\S+)\s+(\d{4})$/);
  if (m && m[2] in TH_MONTH_IDX) { let y = +m[3]; if (y > 2400) y -= 543; return iso(y, TH_MONTH_IDX[m[2]], +m[1]); }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) { let y = +m[3]; if (y > 2400) y -= 543; return iso(y, +m[2] - 1, +m[1]); }
  return null;
}

// คำอธิบายพิมพ์เองในไฟล์เดิม → ประเภทมาตรฐาน
export function mapDocType(desc) {
  const s = String(desc || ""), en = /อังกฤษ|english/i.test(s);
  if (s.includes("รับรองการทำงาน")) return en ? "หนังสือรับรองการทำงาน (ภาษาอังกฤษ)" : "หนังสือรับรองการทำงาน (ภาษาไทย)";
  if (s.includes("รับรองเงินเดือน")) return en ? "หนังสือรับรองเงินเดือน (ภาษาอังกฤษ)" : "หนังสือรับรองเงินเดือน (ภาษาไทย)";
  if (/offer/i.test(s)) return "Offer Letter (จดหมายจ้างงาน)";
  if (/terminat/i.test(s) || s.includes("เลิกจ้าง")) return "หนังสือเลิกจ้าง (Terminate)";
  if (s.includes("ปรับตำแหน่ง")) return "หนังสือปรับตำแหน่ง";
  if (s.includes("ปรับเงิน")) return "หนังสือปรับเงินเดือน";
  if (s.includes("ฝึกงาน")) return "แจ้งผลนักศึกษาฝึกงาน";
  return "อื่น ๆ";
}
const PLAIN = /^(หนังสือรับรองการทำงาน|หนังสือรับรองเงินเดือน|offer letter|terminate)$/i;

// sheets: { HR: aoa, Memo: aoa } (ชื่อชีตตามไฟล์เดิม) → แถวพร้อมส่ง doc_import + สรุป
export function parseDocLog(sheets) {
  const out = [], skipped = [];
  const hr = sheets.HR || [];
  const h = hr.findIndex(r => (r || []).some(c => String(c ?? "").trim() === "เลขที่เอกสาร"));
  for (const r0 of hr.slice(h + 1)) {
    const r = [...(r0 || []), ...Array(12).fill("")];
    const desc = String(r[4] ?? "").trim();
    if (!desc) continue;                                     // เลขที่เตรียมไว้แต่ยังไม่ได้ใช้
    const year = parseInt(r[2], 10);
    const first = String(r[5] ?? "").trim(), last = String(r[6] ?? "").trim();
    let person = [first, last].filter(Boolean).join(" ");
    const paren = desc.match(/\(([^)]*)\)/g)?.map(x => x.slice(1, -1).trim()).find(x => x && !/ภาษา/.test(x)) || "";
    if (!person && paren) person = paren;
    let subject = desc.replace(/\s+/g, " ");
    const bare = subject.replace(/\((ภาษา[^)]*|[^)]*)\)/g, "").trim();
    if (PLAIN.test(bare)) subject = "";
    const issued = parseLogDate(r[7]);
    const notes = [];
    if (!issued && String(r[7] ?? "").trim()) notes.push(`วันที่ในไฟล์เดิม: ${String(r[7]).trim()}`);
    const refNo = String(r[9] ?? "").trim();
    if (refNo && String(r[10] ?? "").trim()) notes.push(`อ้างอิง: ${String(r[10]).trim()}${r[11] ? ` (${String(r[11]).trim()})` : ""}`);
    const base = { series_code: "HR", year, type_label: mapDocType(desc), subject, person_name: person,
                   issued_date: issued || "", ref_doc_no: refNo, note: notes.join(" · ") };
    // แถวจองเลขเป็นช่วง เช่น "(96-133)" → ขยายเป็นทีละเลข
    const range = String(r[1] ?? "").match(/^\(?\s*(\d+)\s*-\s*(\d+)\s*\)?$/);
    const seq = parseInt(r[1], 10);
    if (range && !/^\d+$/.test(String(r[1]).trim())) {
      for (let s = +range[1]; s <= +range[2]; s++) out.push({ ...base, seq: s, note: [base.note, `ออกเป็นชุด ${range[1]}–${range[2]}`].filter(Boolean).join(" · ") });
    } else if (seq > 0 && year > 2000) out.push({ ...base, seq });
    else skipped.push(r.slice(0, 5).join(" | "));
  }
  for (const r of sheets.Memo || []) {
    const desc = String((r || [])[5] ?? "").trim(), seq = parseInt((r || [])[2], 10), year = parseInt((r || [])[3], 10);
    if (!desc || !(seq > 0) || !(year > 2000)) continue;
    out.push({ series_code: "MEMO", year, seq, type_label: "บันทึกภายใน", subject: desc, person_name: "",
               issued_date: "", ref_doc_no: "", note: "" });
  }
  return { rows: out, skipped };
}

// ---------------------------------------------------------------- หน้าเว็บ
let rows = [], types = [], series = [], fSeries = "HR", fYear = "", fType = "", search = "", showVoid = false;

export function renderDocRegister() { boot(); }

async function boot() {
  const pg = document.getElementById("pageDocregister");
  pg.innerHTML = `<div class="section mt-4"><div class="card"><div class="card-body">กำลังโหลด…</div></div></div>`;
  const [s, t, r] = await Promise.all([
    supabase.from("doc_series").select("*").order("sort_order"),
    supabase.from("doc_types").select("*").order("sort_order"),
    supabase.from("doc_register").select("*").order("year", { ascending: false }).order("seq", { ascending: false }).limit(5000),
  ]);
  const err = s.error || t.error || r.error;
  if (err) {
    pg.innerHTML = `<div class="section mt-4"><div class="card"><div class="card-body"><b>โหลดข้อมูลไม่สำเร็จ</b>
      <div class="text-muted" style="margin-top:6px;">${esc(err.message)}</div>
      <div class="text-muted" style="margin-top:10px;font-size:12px;">ถ้ายังไม่ได้รัน <code>sql/schema_doc_register.sql</code> ใน Supabase ให้รันก่อน</div></div></div></div>`;
    return;
  }
  series = s.data || []; types = t.data || []; rows = r.data || [];
  if (can("data.letters.write")) {
    const hl = await supabase.from("hr_letters").select("doc_id,status,cancel_reason,cancelled_at").not("doc_id", "is", null).order("cancelled_at");
    linked = new Set((hl.data || []).filter(x => x.status !== "cancelled").map(x => x.doc_id));
    cancelled = new Map();
    for (const x of hl.data || []) if (x.status === "cancelled")
      cancelled.set(x.doc_id, [...(cancelled.get(x.doc_id) || []), x.cancel_reason || "ไม่ระบุเหตุผล"]);
  }
  if (!fYear) fYear = String(new Date().getFullYear());
  draw();
}

const prefixOf = code => series.find(x => x.code === code)?.prefix || code;
// เลขถัดไป (แสดงให้เห็นก่อนกด — เลขจริงมาจาก DB ตอนออก ถ้ามีคนออกตัดหน้าจะได้เลขถัดไปอีก)
function nextNo(code, year) {
  const max = rows.filter(r => r.series_code === code && r.year === +year).reduce((m, r) => Math.max(m, r.seq), 0);
  return `${prefixOf(code)}-${String(max + 1).padStart(3, "0")}-${year}`;
}

function filtered() {
  const q = search.trim().toLowerCase();
  return rows.filter(r => r.series_code === fSeries && (!fYear || r.year === +fYear) && (showVoid || r.status !== "void")
    && (!fType || r.type_label === fType)
    && (!q || [r.doc_no, r.type_label, r.subject, r.person_name, r.emp_code, r.ref_doc_no, r.note].join(" ").toLowerCase().includes(q)));
}

function draw() {
  const pg = document.getElementById("pageDocregister");
  const years = [...new Set([new Date().getFullYear(), ...rows.map(r => r.year)])].sort((a, b) => b - a);
  const list = filtered();
  const typeOpts = [...new Set(rows.filter(r => r.series_code === fSeries).map(r => r.type_label).filter(Boolean))].sort();
  const cur = new Date().getFullYear();
  pg.innerHTML = `
  <div class="page-header">
    <div><div class="page-heading">ทะเบียนเลขที่เอกสาร</div>
      <div class="page-sub">เลขถัดไป: ${series.map(s => `<b>${esc(nextNo(s.code, cur))}</b>`).join(" · ")}</div></div>
    <div class="header-actions">
      ${canWrite() ? `<label class="btn btn-secondary" style="cursor:pointer;">นำเข้าจาก Excel เดิม<input type="file" id="drImport" accept=".xlsx,.xls" hidden></label>
        <button class="btn btn-secondary" id="drTypes">ประเภทเอกสาร</button>` : ""}
      <button class="btn btn-secondary" id="drExport">Export Excel</button>
      ${canWrite() ? `<button class="btn btn-primary" id="drIssue">+ ออกเลขเอกสาร</button>` : ""}
    </div>
  </div>
  <div class="section" style="padding-top:12px;padding-bottom:0;">
    <div class="cp-tabs">${series.map(s => `<button class="cp-tab${fSeries === s.code ? " on" : ""}" data-series="${esc(s.code)}">${esc(s.label)}
      (${rows.filter(r => r.series_code === s.code && r.status !== "void" && (!fYear || r.year === +fYear)).length})</button>`).join("")}</div>
  </div>
  <div class="section" style="padding-top:12px;padding-bottom:0;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    <input class="form-control" id="drSearch" placeholder="ค้นหา เลขที่ / ชื่อ / เรื่อง" value="${esc(search)}" style="max-width:260px;">
    <select class="form-control" id="drYear" style="max-width:130px;"><option value="">ทุกปี</option>
      ${years.map(y => `<option value="${y}" ${String(y) === fYear ? "selected" : ""}>${y} (${y + 543})</option>`).join("")}</select>
    <select class="form-control" id="drType" style="max-width:280px;"><option value="">ทุกประเภท</option>
      ${typeOpts.map(t => `<option ${t === fType ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
    <label style="display:flex;gap:6px;align-items:center;font-size:13px;"><input type="checkbox" id="drVoid" ${showVoid ? "checked" : ""}> แสดงเลขที่ยกเลิก</label>
    <span class="text-muted" style="font-size:12.5px;margin-left:auto;">${list.length} รายการ</span>
  </div>
  <div class="section mt-4"><div class="card"><div class="table-wrap">
  ${list.length ? `<table class="data-table">
    <thead><tr><th>เลขที่</th><th>วันที่ออก</th><th>ประเภท</th><th>เรื่อง / รายละเอียด</th><th>ออกให้</th><th>อ้างอิง</th><th></th></tr></thead>
    <tbody>${list.map(r => `<tr style="${r.status === "void" ? "opacity:.55;" : ""}">
      <td style="white-space:nowrap;"><b ${r.status === "void" ? 'style="text-decoration:line-through;"' : ""}>${esc(r.doc_no)}</b>
        ${r.status === "void" ? `<div style="font-size:11px;color:var(--red);">ยกเลิก${r.void_reason ? `: ${esc(r.void_reason)}` : ""}</div>` : ""}
        ${r.batch_id ? `<div class="text-muted" style="font-size:11px;">ออกเป็นชุด</div>` : ""}
        ${r.status !== "void" && cancelled.has(r.id) ? `<div class="dr-cxl" title="${esc(cancelled.get(r.id).map((w, i) => `${i + 1}. ${w}`).join("\n"))}">ยกเลิกหนังสือ ${cancelled.get(r.id).length} ฉบับ · ใช้เลขเดิม</div>` : ""}</td>
      <td style="white-space:nowrap;">${dateCell(r.issued_date)}</td>
      <td>${esc(r.type_label || "-")}</td>
      <td style="max-width:300px;">${esc(r.subject || "")}${r.note ? `<div class="text-muted" style="font-size:11.5px;">${esc(r.note)}</div>` : ""}</td>
      <td>${esc(r.person_name || "")}${r.emp_code ? `<div class="text-muted" style="font-size:11.5px;">${esc(r.emp_code)}</div>` : ""}</td>
      <td style="white-space:nowrap;">${esc(r.ref_doc_no || "")}</td>
      <td style="white-space:nowrap;">${LETTER_KIND[r.type_label] && r.status !== "void" && can("data.letters.write")
          ? `<button class="btn btn-sm btn-primary" data-letter="${r.id}">${linked.has(r.id) ? "เปิดหนังสือ" : "สร้างหนังสือ"}</button> ` : ""}<button class="btn btn-sm btn-secondary" data-copy="${esc(r.doc_no)}">คัดลอก</button>
        ${canWrite() && r.status !== "void" ? `<button class="btn btn-sm btn-secondary" data-edit="${r.id}">แก้ไข</button>` : ""}</td></tr>`).join("")}</tbody></table>`
    : `<div class="card-body" style="padding:40px;text-align:center;"><div class="empty-title">${rows.length ? "ไม่มีรายการตามตัวกรอง" : "ยังไม่มีเลขในทะเบียน"}</div>
       <div class="empty-sub">${rows.length ? "" : "กด “นำเข้าจาก Excel เดิม” เพื่อนำประวัติจากไฟล์ 01 ลำดับเอกสาร HR เข้ามา แล้วค่อยเริ่มออกเลข"}</div></div>`}
  </div></div></div><div class="pb-4"></div>`;
  wire();
}

function wire() {
  const pg = document.getElementById("pageDocregister");
  pg.querySelectorAll("[data-series]").forEach(b => b.onclick = () => { fSeries = b.dataset.series; fType = ""; draw(); });
  const s = pg.querySelector("#drSearch");
  s.oninput = () => { search = s.value; const pos = s.selectionStart; draw(); const n = document.getElementById("drSearch"); n.focus(); n.setSelectionRange(pos, pos); };
  pg.querySelector("#drYear").onchange = e => { fYear = e.target.value; draw(); };
  pg.querySelector("#drType").onchange = e => { fType = e.target.value; draw(); };
  pg.querySelector("#drVoid").onchange = e => { showVoid = e.target.checked; draw(); };
  pg.querySelector("#drIssue")?.addEventListener("click", issueForm);
  pg.querySelector("#drTypes")?.addEventListener("click", typesForm);
  pg.querySelector("#drExport").onclick = exportExcel;
  const imp = pg.querySelector("#drImport");
  if (imp) imp.onchange = () => { const f = imp.files[0]; imp.value = ""; if (f) importFile(f); };
  pg.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => copy(b.dataset.copy));
  // ส่งต่อไปหน้าออกหนังสือ — หน้านั้นสร้างร่างผูกกับเลขนี้ (หรือเปิดฉบับเดิมถ้ามีแล้ว)
  pg.querySelectorAll("[data-letter]").forEach(b => b.onclick = () => {
    const r = rows.find(x => x.id === +b.dataset.letter);
    try { sessionStorage.setItem("letter_from_doc", JSON.stringify({ doc_id: r.id, kind: LETTER_KIND[r.type_label] })); } catch {}
    navigate("letters");
  });
  pg.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => editForm(rows.find(r => r.id === +b.dataset.edit)));
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast(`คัดลอก ${text} แล้ว`, "success"); } catch { prompt("คัดลอกเลขที่", text); }
}

function modal(title, body, foot) {
  const el = document.createElement("div");
  el.className = "modal-overlay";
  el.innerHTML = `<div class="modal modal-lg"><div class="modal-header"><div class="modal-title">${title}</div>
    <button class="modal-close" data-x>✕</button></div><div class="modal-body">${body}</div><div class="modal-footer">${foot}</div></div>`;
  document.getElementById("modalPortal").appendChild(el);
  el.querySelectorAll("[data-x]").forEach(b => b.onclick = () => el.remove());
  el.onclick = e => { if (e.target === el) el.remove(); };
  return el;
}

// ช่องค้นหาพนักงาน: พิมพ์ชื่อไทย ชื่ออังกฤษ หรือรหัสก็เจอ (ช่อง datalist ของเบราว์เซอร์ค้นได้แค่ต้นข้อความ
// ใน Safari พิมพ์ชื่อแล้วไม่เจอ) · คนนอก (ผู้สมัคร มหาวิทยาลัย) พิมพ์ชื่อเองได้ — allowFree
export const empItems = () => allEmployees.filter(e => e.emp_code).map(e => ({ value: e.emp_code, label: empName(e) || e.emp_code,
  sub: [e.emp_code, [e.firstname_en, e.lastname_en].filter(Boolean).join(" "), e.department].filter(Boolean).join(" · ") }));
const PERSON_PH = "พิมพ์ชื่อไทย/อังกฤษ หรือรหัส · คนนอกพิมพ์ชื่อได้เลย";
// ค่าจากช่องผู้รับ: รหัสพนักงาน (เลือกจากรายการ) · "รหัส · ชื่อ" (บรรทัดในรายชื่อ) · หรือชื่อคนนอกที่พิมพ์เอง
function personOf(text) {
  const t = String(text || "").trim(); if (!t) return {};
  const byCode = allEmployees.find(x => x.emp_code === t);
  if (byCode) return { emp_code: byCode.emp_code, person_name: empName(byCode) };
  const m = t.match(/^(\S+)\s*·\s*(.+)$/);
  const e = m && allEmployees.find(x => x.emp_code === m[1]);
  return e ? { emp_code: e.emp_code, person_name: empName(e) } : { person_name: t };
}

function issueForm() {
  const cur = new Date().getFullYear();
  const typeOpts = code => types.filter(t => t.series_code === code && t.is_active)
    .map(t => `<option value="${t.id}">${esc(t.label)}</option>`).join("");
  const el = modal("ออกเลขเอกสาร", `
    <div class="form-grid">
      <div class="form-group"><label class="form-label">ชุดเลข</label>
        <select class="form-control" id="isSeries">${series.filter(s => s.is_active).map(s =>
          `<option value="${esc(s.code)}" ${s.code === fSeries ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></div>
      <div class="form-group"><label class="form-label">ประเภท</label><select class="form-control" id="isType">${typeOpts(fSeries)}</select></div>
      <div class="form-group" style="grid-column:1/-1;"><label class="form-label">เรื่อง / รายละเอียด <span class="text-muted">(ไม่บังคับ)</span></label>
        <input class="form-control" id="isSubject" placeholder="เช่น ยื่นธนาคาร, แจ้งผลฝึกงาน ม.เชียงใหม่"></div>
      <div class="form-group"><label class="form-label">วันที่ออก</label><input type="date" class="form-control" id="isDate" value="${todayISO()}"></div>
      <div class="form-group"><label class="form-label">จำนวนเลข</label><input type="number" class="form-control" id="isCount" min="1" max="500" value="1"></div>
      <div class="form-group" id="isOneWrap" style="grid-column:1/-1;"><label class="form-label">ออกให้ <span class="text-muted">(พิมพ์รหัส/ชื่อพนักงาน หรือชื่อคนนอก)</span></label>
        ${comboHTML("isPerson", [], "", PERSON_PH)}</div>
      <div class="form-group" id="isManyWrap" style="grid-column:1/-1;display:none;"><label class="form-label">รายชื่อ <span class="text-muted">(ไม่บังคับ · บรรทัดละ 1 คน เรียงตามเลข · ใส่รหัสพนักงานได้)</span></label>
        <textarea class="form-control" id="isPeople" rows="5"></textarea></div>
      <div class="form-group"><label class="form-label">อ้างอิงเลขที่ <span class="text-muted">(ไม่บังคับ)</span></label><input class="form-control" id="isRef" placeholder="เช่น HR-018-2025"></div>
      <div class="form-group"><label class="form-label">หมายเหตุ</label><input class="form-control" id="isNote"></div>
    </div>
    <div class="uni-alert" style="margin-top:6px;"><b id="isPreview"></b><span>เลขจริงออกตอนกดยืนยัน — ถ้ามีคนออกเลขก่อนหน้าในเวลาเดียวกัน จะได้เลขถัดไป</span></div>`,
    `<button class="btn btn-secondary" data-x>ยกเลิก</button><button class="btn btn-primary" data-ok>ออกเลข</button>`);
  bindCombo("isPerson", empItems(), null, { allowFree: true });
  const g = id => el.querySelector("#" + id);
  const preview = () => {
    const n = Math.max(1, Math.min(500, +g("isCount").value || 1)), y = +(g("isDate").value || "").slice(0, 4) || cur;
    const first = nextNo(g("isSeries").value, y);
    g("isPreview").textContent = n === 1 ? `จะได้เลข ${first}` : `จะได้ ${n} เลข เริ่มที่ ${first}`;
    g("isOneWrap").style.display = n === 1 ? "" : "none"; g("isManyWrap").style.display = n === 1 ? "none" : "";
  };
  g("isSeries").onchange = () => { g("isType").innerHTML = typeOpts(g("isSeries").value); preview(); };
  g("isCount").oninput = preview; g("isDate").onchange = preview; preview();
  el.querySelector("[data-ok]").onclick = async e => {
    const n = Math.max(1, Math.min(500, +g("isCount").value || 1));
    let people = null;
    if (n === 1) { const p = personOf(g("isPerson").value); if (p.person_name) people = [p]; }
    else {
      const lines = g("isPeople").value.split("\n").map(x => x.trim()).filter(Boolean);
      if (lines.length && lines.length !== n) { toast(`รายชื่อมี ${lines.length} บรรทัด แต่จะออก ${n} เลข — ให้เท่ากัน หรือเว้นว่าง`, "error"); return; }
      if (lines.length) people = lines.map(l => { const e2 = allEmployees.find(x => x.emp_code === l.split(/\s/)[0]); return e2 ? { emp_code: e2.emp_code, person_name: empName(e2) } : personOf(l); });
    }
    e.target.disabled = true; e.target.textContent = "กำลังออกเลข…";
    const { data, error } = await supabase.rpc("doc_issue", {
      p_series: g("isSeries").value, p_count: n, p_type_id: +g("isType").value || null, p_subject: g("isSubject").value,
      p_issued_date: g("isDate").value || null, p_ref: g("isRef").value, p_note: g("isNote").value, p_people: people });
    if (error) { toast("ออกเลขไม่สำเร็จ: " + error.message, "error"); e.target.disabled = false; e.target.textContent = "ออกเลข"; return; }
    el.remove();
    rows = [...(data || []), ...rows].sort((a, b) => b.year - a.year || b.seq - a.seq);
    fSeries = g("isSeries").value; draw();
    const nos = (data || []).map(r => r.doc_no);
    const done = modal("ออกเลขแล้ว", `<div style="text-align:center;padding:10px 0;">
      <div style="font-size:${nos.length > 1 ? 20 : 30}px;font-weight:700;color:var(--navy);letter-spacing:.5px;">${esc(nos.length > 1 ? `${nos[0]} – ${nos[nos.length - 1]}` : nos[0])}</div>
      <div class="text-muted" style="margin-top:6px;">${nos.length} เลข · บันทึกในทะเบียนแล้ว</div></div>`,
      `<button class="btn btn-secondary" data-x>ปิด</button><button class="btn btn-primary" data-cp>คัดลอกเลขที่</button>`);
    done.querySelector("[data-cp]").onclick = () => copy(nos.join("\n"));
  };
}

function editForm(r) {
  const el = modal(`แก้ไข ${esc(r.doc_no)}`, `
    <div class="form-grid">
      <div class="form-group"><label class="form-label">ประเภท</label><select class="form-control" id="edType">
        ${types.filter(t => t.series_code === r.series_code).map(t => `<option value="${t.id}" ${t.id === r.type_id ? "selected" : ""}>${esc(t.label)}</option>`).join("")}
        ${r.type_id ? "" : `<option value="" selected>${esc(r.type_label || "-")}</option>`}</select></div>
      <div class="form-group"><label class="form-label">วันที่ออก</label><input type="date" class="form-control" id="edDate" value="${esc(r.issued_date || "")}"></div>
      <div class="form-group" style="grid-column:1/-1;"><label class="form-label">เรื่อง / รายละเอียด</label><input class="form-control" id="edSubject" value="${esc(r.subject || "")}"></div>
      <div class="form-group" style="grid-column:1/-1;"><label class="form-label">ออกให้</label>
        ${comboHTML("edPerson", [], "", PERSON_PH)}</div>
      <div class="form-group"><label class="form-label">อ้างอิงเลขที่</label><input class="form-control" id="edRef" value="${esc(r.ref_doc_no || "")}"></div>
      <div class="form-group"><label class="form-label">หมายเหตุ</label><input class="form-control" id="edNote" value="${esc(r.note || "")}"></div>
    </div>
    <div class="text-muted" style="font-size:12px;">เลขที่ ${esc(r.doc_no)} แก้ไม่ได้ — ถ้าออกผิดเลข ให้ยกเลิกแล้วออกเลขใหม่</div>`,
    `<button class="btn btn-danger" data-void style="margin-right:auto;">ยกเลิกเลขนี้</button>
     <button class="btn btn-secondary" data-x>ปิด</button><button class="btn btn-primary" data-ok>บันทึก</button>`);
  bindCombo("edPerson", empItems(), null, { allowFree: true });
  { // ค่าเดิม: พนักงาน = รหัส · คนนอก = ชื่อที่พิมพ์ไว้
    const e = r.emp_code && allEmployees.find(x => x.emp_code === r.emp_code);
    el.querySelector("#edPerson").value = e ? e.emp_code : (r.person_name || "");
    el.querySelector("#edPerson_txt").value = e ? empName(e) : (r.person_name || ""); }
  const g = id => el.querySelector("#" + id);
  el.querySelector("[data-ok]").onclick = async () => {
    const t = types.find(x => x.id === +g("edType").value), p = personOf(g("edPerson").value);
    const upd = { type_id: t?.id || r.type_id, type_label: t?.label || r.type_label, issued_date: g("edDate").value || null,
                  subject: g("edSubject").value.trim() || null, emp_code: p.emp_code || null, person_name: p.person_name || null,
                  ref_doc_no: g("edRef").value.trim() || null, note: g("edNote").value.trim() || null };
    const { error } = await supabase.from("doc_register").update(upd).eq("id", r.id);
    if (error) { toast("บันทึกไม่สำเร็จ: " + error.message, "error"); return; }
    Object.assign(r, upd); el.remove(); draw(); toast("บันทึกแล้ว", "success");
  };
  el.querySelector("[data-void]").onclick = async () => {
    const why = prompt(`ยกเลิกเลข ${r.doc_no}? เลขนี้จะไม่ถูกนำกลับมาใช้อีก${linked.has(r.id) ? "\n⚠️ เลขนี้มีหนังสือในระบบออกหนังสือ — หนังสือฉบับนั้นจะถูกยกเลิกด้วย" : ""}\nเหตุผล:`, "");
    if (why === null) return;
    const upd = { status: "void", void_reason: why.trim() || null, voided_at: new Date().toISOString(), voided_by: currentUser?.id || null };
    const { error } = await supabase.from("doc_register").update(upd).eq("id", r.id);
    if (error) { toast("ยกเลิกไม่สำเร็จ: " + error.message, "error"); return; }
    Object.assign(r, upd); linked.delete(r.id); el.remove(); draw(); toast(`ยกเลิก ${r.doc_no} แล้ว`, "success");
  };
}

function typesForm() {
  const list = () => types.map(t => `<tr><td>${esc(series.find(s => s.code === t.series_code)?.label || t.series_code)}</td>
    <td><input class="form-control" data-tl="${t.id}" value="${esc(t.label)}"></td>
    <td style="text-align:center;"><input type="checkbox" data-ta="${t.id}" ${t.is_active ? "checked" : ""}></td></tr>`).join("");
  const el = modal("ประเภทเอกสาร", `
    <div class="table-wrap" style="max-height:360px;overflow:auto;"><table class="data-table"><thead><tr><th>ชุดเลข</th><th>ชื่อประเภท</th><th>ใช้งาน</th></tr></thead>
      <tbody id="tyBody">${list()}</tbody></table></div>
    <div style="display:flex;gap:8px;margin-top:12px;"><select class="form-control" id="tyS" style="max-width:200px;">${series.map(s => `<option value="${esc(s.code)}">${esc(s.label)}</option>`).join("")}</select>
      <input class="form-control" id="tyNew" placeholder="ชื่อประเภทใหม่"><button class="btn btn-secondary" id="tyAdd">+ เพิ่ม</button></div>
    <div class="text-muted" style="font-size:12px;margin-top:8px;">เปลี่ยนชื่อประเภทไม่กระทบเลขที่ออกไปแล้ว (ทะเบียนเก็บชื่อ ณ วันออกไว้) · ปิด "ใช้งาน" = ไม่โผล่ในรายการตอนออกเลข</div>`,
    `<button class="btn btn-secondary" data-x>ปิด</button><button class="btn btn-primary" data-ok>บันทึก</button>`);
  el.querySelector("#tyAdd").onclick = async () => {
    const label = el.querySelector("#tyNew").value.trim(); if (!label) return;
    const { data, error } = await supabase.from("doc_types").insert({ series_code: el.querySelector("#tyS").value, label, sort_order: 90 }).select().single();
    if (error) { toast("เพิ่มไม่สำเร็จ: " + error.message, "error"); return; }
    types.push(data); el.querySelector("#tyBody").innerHTML = list(); el.querySelector("#tyNew").value = "";
  };
  el.querySelector("[data-ok]").onclick = async () => {
    const ch = types.map(t => ({ t, label: el.querySelector(`[data-tl="${t.id}"]`).value.trim(), act: el.querySelector(`[data-ta="${t.id}"]`).checked }))
      .filter(x => x.label && (x.label !== x.t.label || x.act !== x.t.is_active));
    for (const x of ch) {
      const { error } = await supabase.from("doc_types").update({ label: x.label, is_active: x.act }).eq("id", x.t.id);
      if (error) { toast("บันทึกไม่สำเร็จ: " + error.message, "error"); return; }
      Object.assign(x.t, { label: x.label, is_active: x.act });
    }
    el.remove(); toast("บันทึกแล้ว", "success");
  };
}

async function importFile(file) {
  let parsed;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheets = Object.fromEntries(wb.SheetNames.map(n => [n.trim(), XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" })]));
    parsed = parseDocLog(sheets);
  } catch (e) { toast("อ่านไฟล์ไม่ได้: " + e.message, "error"); return; }
  const have = new Set(rows.map(r => `${r.series_code}|${r.year}|${r.seq}`));
  const fresh = parsed.rows.filter(r => !have.has(`${r.series_code}|${r.year}|${r.seq}`));
  const by = (k, l) => { const m = {}; l.forEach(r => { const v = typeof k === "function" ? k(r) : r[k]; m[v] = (m[v] || 0) + 1; }); return m; };
  const perYear = by(r => `${r.series_code === "MEMO" ? "Memo" : "HR"} ${r.year}`, parsed.rows);
  const last = s => { const l = parsed.rows.filter(r => r.series_code === s); const y = Math.max(...l.map(r => r.year));
    return l.length ? `${prefixOf(s)}-${String(Math.max(...l.filter(r => r.year === y).map(r => r.seq))).padStart(3, "0")}-${y}` : "-"; };
  const noDate = parsed.rows.filter(r => !r.issued_date).length;
  const el = modal(`นำเข้าจาก ${esc(file.name)}`, `
    <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:10px;">
      <div><b style="font-size:20px;">${parsed.rows.length}</b> เลขที่ใช้แล้วในไฟล์</div>
      <div><b style="font-size:20px;">${fresh.length}</b> เลขที่ยังไม่มีในระบบ (จะนำเข้า)</div></div>
    <div class="text-muted" style="font-size:13px;">${Object.entries(perYear).map(([k, v]) => `${k}: ${v}`).join(" · ")}
      · เลขล่าสุดในไฟล์ ${esc(last("HR"))} / ${esc(last("MEMO"))}</div>
    ${noDate ? `<div class="text-muted" style="font-size:12.5px;margin-top:6px;">${noDate} รายการไม่มีวันที่ หรือวันที่อ่านไม่ออก — นำเข้าโดยเว้นวันที่ไว้ (ข้อความเดิมเก็บในหมายเหตุ)</div>` : ""}
    ${parsed.skipped.length ? `<div class="uni-alert" style="margin-top:8px;"><b>ข้าม ${parsed.skipped.length} แถว</b><span>${parsed.skipped.map(esc).join("<br>")}</span></div>` : ""}
    <div class="table-wrap" style="max-height:300px;overflow:auto;margin-top:10px;"><table class="data-table">
      <thead><tr><th>เลขที่</th><th>ประเภท</th><th>เรื่อง</th><th>ออกให้</th><th>วันที่</th></tr></thead>
      <tbody>${fresh.slice(0, 300).map(r => `<tr><td>${esc(`${prefixOf(r.series_code)}-${String(r.seq).padStart(3, "0")}-${r.year}`)}</td>
        <td>${esc(r.type_label)}</td><td>${esc(r.subject)}</td><td>${esc(r.person_name)}</td><td>${r.issued_date ? thDate(r.issued_date) : "-"}</td></tr>`).join("")}</tbody></table></div>`,
    `<button class="btn btn-secondary" data-x>ยกเลิก</button><button class="btn btn-primary" data-ok ${fresh.length ? "" : "disabled"}>นำเข้า ${fresh.length} รายการ</button>`);
  el.querySelector("[data-ok]").onclick = async e => {
    e.target.disabled = true; e.target.textContent = "กำลังนำเข้า…";
    let n = 0;
    for (let i = 0; i < fresh.length; i += 200) {
      const { data, error } = await supabase.rpc("doc_import", { p_rows: fresh.slice(i, i + 200) });
      if (error) { toast("นำเข้าไม่สำเร็จ: " + error.message, "error"); e.target.disabled = false; e.target.textContent = "ลองอีกครั้ง"; return; }
      n += data || 0;
    }
    el.remove(); toast(`นำเข้าแล้ว ${n} รายการ`, "success"); boot();
  };
}

function exportExcel() {
  const list = filtered();
  if (!list.length) { toast("ไม่มีรายการให้ export"); return; }
  const data = list.map(r => ({ "เลขที่เอกสาร": r.doc_no, "ปี": r.year, "ลำดับ": r.seq, "วันที่ออก": r.issued_date || "",
    "ประเภท": r.type_label || "", "เรื่อง / รายละเอียด": r.subject || "", "รหัสพนักงาน": r.emp_code || "", "ออกให้": r.person_name || "",
    "อ้างอิงเลขที่": r.ref_doc_no || "", "หมายเหตุ": r.note || "", "สถานะ": r.status === "void" ? `ยกเลิก${r.void_reason ? ": " + r.void_reason : ""}` : "ใช้งาน",
    "หนังสือที่ยกเลิก (ใช้เลขเดิม)": r.status !== "void" && cancelled.has(r.id) ? cancelled.get(r.id).join(" / ") : "" }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), fSeries === "MEMO" ? "Memo" : "HR");
  XLSX.writeFile(wb, `ทะเบียนเลขที่เอกสาร_${fSeries}_${fYear || "ทุกปี"}.xlsx`);
}
