import { supabase } from "./supabase-config.js";
import { esc as escText, toast, can, currentUser, allEmployees, addMasterPosition } from "./app.js";
import { renderMail, mailList, downloadEml } from "./hr-letters.js";
import { tplEditorHTML, wireTplEditor } from "./mail-templates.js";
import { comboHTML, bindCombo, toItems } from "./combobox.js";
import { masterDivisions, masterDepartments, masterSections, masterTeams, masterPositions, masterJobLevels } from "./masterdata-admin.js";
import { pafHTML, conditionLines, suggestMovType, SUBJECTS, STEPS, MOV_LABEL, thLong } from "./paf-doc.js";

// ============================================================================
// Personnel Action Form (AKR-OHR-FM-031) — งานเอกสาร HR · sql/schema_paf.sql · user 2026-10-16
//   HR ยื่น → ขั้น 1 HR Manager → ขั้น 2 GM · ผู้อนุมัติกดจากลิงก์ในอีเมล (/paf/approve.html) ไม่ต้อง login
//   เลขที่ PAF-###-ปี จากทะเบียนเลขที่เอกสาร (ออกตอนส่งครั้งแรก) · อนุมัติครบ → Movement + อัปเดตทะเบียนพนักงาน (SQL paf_apply)
//   พนักงานเซ็นรับทราบบนกระดาษ → HR บันทึกวันที่
// ============================================================================

const esc = v => escText(v == null ? "" : String(v));   // esc ของ app.js รับแต่ข้อความ (เงินเดือนเป็นตัวเลข)
const ST = { draft: ["ร่าง", "var(--muted)", "#f1f5f9"], pending: ["รออนุมัติ", "var(--amber)", "var(--amber-light)"], approved: ["อนุมัติแล้ว", "var(--green)", "var(--green-light)"],
  rejected: ["ส่งกลับแก้ไข", "var(--red)", "var(--red-light)"], cancelled: ["ยกเลิก", "var(--muted)", "#f1f5f9"] };
const badge = (s, step) => { const [t, c, b] = ST[s] || [s, "var(--muted)", "#f1f5f9"]; return `<span class="badge" style="color:${c};background:${b};">${t}${s === "pending" && step ? ` ขั้น ${step}` : ""}</span>`; };
const canWrite = () => can("data.paf.write");
const MAIL_TO = { paf_request: "ผู้อนุมัติขั้นที่รออยู่ ({{link}} = ลิงก์อนุมัติไม่ต้อง login)", paf_approved: "HR คนที่ส่งอนุมัติ", paf_rejected: "HR คนที่ส่งอนุมัติ" };
const DEFAULT_MAIL = [{ key: "paf_request", label: "ขออนุมัติ PAF", subject: "[ขออนุมัติ] {{doc_no}} {{kind}} — {{person}}", html: `<p>มี PAF รอการพิจารณาจากท่าน: {{doc_no}} · {{person}}</p><p><a href="{{link}}">เปิด PAF</a></p>` }];
const empNameTH = e => [e.firstname_th, e.lastname_th].filter(Boolean).join(" ");

let rows = [], approvers = [], mailCfg = { mode: "outlook" }, mailTpl = [], tab = "all", tplKey = "paf_request", search = "";

export function renderPaf() { boot(); }
async function boot() {
  const pg = document.getElementById("pagePaf");
  pg.innerHTML = `<div class="section mt-4"><div class="card"><div class="card-body">กำลังโหลด…</div></div></div>`;
  const [f, a, mc, mt] = await Promise.all([supabase.from("paf_forms").select("*").order("created_at", { ascending: false }).limit(2000),
    supabase.from("paf_approvers").select("*").order("step").order("name_th"), supabase.from("mail_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("mail_templates").select("*").like("key", "paf_%")]);
  if (f.error) { pg.innerHTML = `<div class="section mt-4"><div class="card"><div class="card-body"><b>โหลดข้อมูลไม่สำเร็จ</b><div class="text-muted" style="margin-top:6px;">${esc(f.error.message)}</div>
    <div class="text-muted" style="margin-top:10px;font-size:12px;">ต้องรัน <code>sql/schema_paf.sql</code> ใน Supabase ก่อน (หลัง schema_doc_register.sql)</div></div></div></div>`; return; }
  rows = f.data || []; approvers = a.data || []; if (!mc.error && mc.data) mailCfg = mc.data;
  mailTpl = !mt.error && mt.data?.length ? mt.data.sort((x, y) => x.key.localeCompare(y.key)) : DEFAULT_MAIL;
  draw();
  const deep = +new URLSearchParams(location.search).get("paf");
  if (deep) { history.replaceState(null, "", location.pathname); const x = rows.find(r => r.id === deep); x ? openForm(x) : toast("ไม่พบ PAF นี้ หรือไม่มีสิทธิ์ดู", "info"); }
}

function draw() {
  const pg = document.getElementById("pagePaf"), q = search.trim().toLowerCase();
  const list = rows.filter(r => !q || [r.doc_no, r.emp_code, r.name_th, r.name_en, r.subject_th].join(" ").toLowerCase().includes(q));
  const tabs = [["all", `PAF ทั้งหมด (${rows.length})`], ["approvers", `ผู้อนุมัติ (${approvers.filter(a => a.is_active).length})`], ["mail", "ตั้งค่าอีเมล"]];
  pg.innerHTML = `
  <div class="page-header"><div><div class="page-heading">Personnel Action Form</div>
    <div class="page-sub">AKR-OHR-FM-031 · HR ยื่น → HR Manager → GM (อนุมัติจากลิงก์ในอีเมล) · เลขที่จากทะเบียนเลขที่เอกสาร · อนุมัติครบบันทึก Movement ให้</div></div>
    <div class="header-actions">${canWrite() ? `<button class="btn btn-primary" id="pfNew">+ ทำ PAF</button>` : ""}</div></div>
  <div class="section" style="padding-top:12px;padding-bottom:0;"><div class="cp-tabs">${tabs.map(([k, t]) => `<button class="cp-tab${tab === k ? " on" : ""}" data-tab="${k}">${t}</button>`).join("")}</div></div>
  ${tab === "mail" ? `<div class="section mt-4"><div class="card"><div class="card-body">
      <div style="font-weight:700;color:var(--navy);margin-bottom:6px;">แบบอีเมล PAF</div>
      <div class="text-muted" style="font-size:12.5px;margin-bottom:10px;">โหมดส่ง: <b>${mailCfg.mode === "auto" ? "ส่งอัตโนมัติจากอีเมลกลาง" : "ดาวน์โหลดไฟล์เมลเปิดใน Outlook"}</b> (ตั้งที่หน้าออกหนังสือ HR → ตั้งค่า) ·
        โหมด Outlook: พอขั้น 1 อนุมัติ ระบบแจ้งกระดิ่ง → เปิด PAF แล้วกด “ส่งอีเมลขอขั้นถัดไป”</div>
      ${tplEditorHTML(mailTpl, tplKey, k => MAIL_TO[k] || "-")}</div></div></div>`
  : tab === "approvers" ? approversHTML() : `
  <div class="section" style="padding-top:12px;padding-bottom:0;"><input class="form-control" id="pfSearch" placeholder="ค้นหา เลขที่ / ชื่อ / รหัส / เรื่อง" value="${esc(search)}" style="max-width:320px;"></div>
  <div class="section mt-4"><div class="card"><div class="table-wrap">
  ${list.length ? `<table class="data-table"><thead><tr><th>เลขที่</th><th>พนักงาน</th><th>เรื่อง</th><th>มีผล</th><th>สถานะ</th><th></th></tr></thead><tbody>
    ${list.map(r => `<tr><td style="white-space:nowrap;"><b>${esc(r.doc_no || "—")}</b></td>
      <td><b>${esc(r.name_th || r.emp_code)}</b><div class="text-muted" style="font-size:11.5px;">${esc(r.emp_code)} · ${esc(r.position || "")}</div></td>
      <td>${esc(r.subject_th || "")}</td><td style="white-space:nowrap;">${thLong(r.effective_date)}</td>
      <td>${badge(r.status, r.cur_step)}${r.status === "rejected" && r.reject_reason ? `<div style="font-size:11.5px;color:var(--red);">${esc(r.reject_reason)}</div>` : ""}
        ${r.status === "approved" ? `<div style="font-size:11.5px;" class="text-muted">${r.ack_date ? "✓ พนักงานรับทราบแล้ว" : "รอพนักงานเซ็นรับทราบ"}</div>` : ""}</td>
      <td style="white-space:nowrap;"><button class="btn btn-sm btn-secondary" data-open="${r.id}">${["draft", "rejected"].includes(r.status) ? "แก้ไข" : "เปิด"}</button></td></tr>`).join("")}</tbody></table>`
    : `<div class="card-body" style="padding:40px;text-align:center;"><div class="empty-title">ยังไม่มี PAF</div></div>`}
  </div></div></div>`}<div class="pb-4"></div>`;
  pg.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; draw(); });
  pg.querySelector("#pfNew")?.addEventListener("click", () => openForm(null));
  pg.querySelectorAll("[data-open]").forEach(b => b.onclick = () => openForm(rows.find(r => r.id === +b.dataset.open)));
  const s = pg.querySelector("#pfSearch"); if (s) s.oninput = () => { search = s.value; const p = s.selectionStart; draw(); const n = document.getElementById("pfSearch"); n.focus(); n.setSelectionRange(p, p); };
  if (tab === "mail") wireTplEditor(pg, mailTpl, { sample: { doc_no: "PAF-001-2026", person: "นายทดสอบ สมมติ", kind: "พิจารณาอนุมัติปรับเงินเดือน", emp_code: "(AKR00000000)",
    link: `${location.origin}/paf/approve.html?t=…`, reason: "แก้วันที่มีผล", requester: "HR", approver: "ผู้จัดการฝ่ายทรัพยากรบุคคล" }, onSwitch: k => { tplKey = k; draw(); } });
  if (tab === "approvers") wireApprovers(pg);
}

// ---------------------------------------------------------------- ผู้อนุมัติ (ไม่ต้องเป็นผู้ใช้ระบบ — กดจากลิงก์ในอีเมล)
function approversHTML() {
  return `<div class="section mt-4"><div class="card"><div class="card-body">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
      <div class="text-muted" style="font-size:12.5px;">ผู้อนุมัติแต่ละขั้น — ชื่อ/ตำแหน่งนี้ขึ้นในบันทึกการอนุมัติบนใบ · ต้องมีอีเมล (ลิงก์อนุมัติส่งไปที่อีเมลนี้) · “ค่าเริ่มต้น” = เลือกไว้ให้ตอนส่ง</div>
      ${canWrite() ? `<button class="btn btn-primary btn-sm" data-anew>+ เพิ่มผู้อนุมัติ</button>` : ""}</div>
    ${STEPS.map(s => { const list = approvers.filter(a => a.step === s.step);
      return `<div style="font-weight:700;color:var(--navy);margin:14px 0 6px;">ขั้น ${s.step} · ${s.label} <span class="text-muted" style="font-weight:400;">(${s.label_th})</span></div>
      ${list.length ? `<table class="data-table"><thead><tr><th>ชื่อ</th><th>ตำแหน่ง</th><th>อีเมล</th><th></th></tr></thead><tbody>${list.map(a => `<tr style="${a.is_active ? "" : "opacity:.5"}">
        <td><b>${esc(a.name_th)}</b>${a.is_default ? ' <span class="badge" style="color:var(--green);background:var(--green-light);">ค่าเริ่มต้น</span>' : ""}${a.is_active ? "" : ' <span class="text-muted">(ปิดใช้)</span>'}
          <div class="text-muted" style="font-size:11.5px;">${esc([a.emp_code, a.name_en].filter(Boolean).join(" · "))}</div></td>
        <td>${esc(a.title_th || "")}<div class="text-muted" style="font-size:11.5px;">${esc(a.title_en || "")}</div></td><td>${esc(a.email)}</td>
        <td>${canWrite() ? `<button class="btn btn-sm btn-secondary" data-aed="${a.id}">แก้ไข</button>` : ""}</td></tr>`).join("")}</tbody></table>`
        : `<div class="text-muted" style="font-size:13px;">ยังไม่มี — กด “+ เพิ่มผู้อนุมัติ”</div>`}`; }).join("")}
  </div></div></div>`;
}
function wireApprovers(pg) {
  pg.querySelector("[data-anew]")?.addEventListener("click", () => approverForm(null));
  pg.querySelectorAll("[data-aed]").forEach(b => b.onclick = () => approverForm(approvers.find(a => a.id === +b.dataset.aed)));
}
function approverForm(a) {
  const d = a ? { ...a } : { step: 1, is_active: true, is_default: !approvers.some(x => x.step === 1 && x.is_default) };
  const el = document.createElement("div"); el.className = "modal-overlay";
  const fld = (k, l, ph = "") => `<label class="lt-f"><span>${l}</span><input class="form-control" data-k="${k}" value="${esc(d[k] ?? "")}" placeholder="${esc(ph)}"></label>`;
  el.innerHTML = `<div class="modal" style="max-width:560px;"><div class="modal-header"><div class="modal-title">${a ? "แก้ไขผู้อนุมัติ" : "เพิ่มผู้อนุมัติ"}</div><button class="modal-close" data-x>✕</button></div>
    <div class="modal-body">
      <label class="lt-f"><span>ขั้น</span><select class="form-control" data-k="step">${STEPS.map(s => `<option value="${s.step}" ${+d.step === s.step ? "selected" : ""}>ขั้น ${s.step} · ${s.label}</option>`).join("")}</select></label>
      <div class="lt-f"><span>ดึงจากทะเบียนพนักงาน (ไม่บังคับ)</span>${comboHTML("paEmp", [], d.emp_code || "", "พิมพ์ชื่อหรือรหัส")}</div>
      <div class="lt-2">${fld("name_th", "ชื่อ-สกุล (ไทย) *", "นางสาว…")}${fld("name_en", "Name (EN)", "Mr. …")}</div>
      <div class="lt-2">${fld("title_th", "ตำแหน่ง (ไทย)", "ผู้จัดการฝ่ายทรัพยากรบุคคล")}${fld("title_en", "Title (EN)", "HR Manager")}</div>
      <div class="lt-2">${fld("emp_code", "รหัสพนักงาน")}${fld("email", "อีเมล *", "name@akararesources.com")}</div>
      <label class="lt-f" style="flex-direction:row;align-items:center;gap:8px;"><input type="checkbox" id="paDef" ${d.is_default ? "checked" : ""}> เลือกไว้ให้เป็นค่าเริ่มต้นของขั้นนี้</label>
      <label class="lt-f" style="flex-direction:row;align-items:center;gap:8px;"><input type="checkbox" id="paAct" ${d.is_active ? "checked" : ""}> ใช้งาน</label>
    </div><div class="modal-footer">${a ? `<button class="btn btn-danger" data-del style="margin-right:auto;">ลบ</button>` : ""}<button class="btn btn-secondary" data-x>ยกเลิก</button><button class="btn btn-primary" data-ok>บันทึก</button></div></div>`;
  document.getElementById("modalPortal").appendChild(el);
  const $ = s => el.querySelector(s), close = () => el.remove();
  el.querySelectorAll("[data-x]").forEach(b => b.onclick = close);
  el.querySelectorAll("[data-k]").forEach(i => i.oninput = i.onchange = () => { d[i.dataset.k] = i.value; });
  bindCombo("paEmp", allEmployees.filter(e => e.emp_code).map(e => ({ value: e.emp_code, label: empNameTH(e) || e.emp_code, sub: [e.emp_code, e.position].filter(Boolean).join(" · ") })), code => {
    const e = allEmployees.find(x => x.emp_code === code); if (!e) return;
    const male = /^m/i.test(e.gender || ""), female = /^f/i.test(e.gender || "");
    Object.assign(d, { emp_code: e.emp_code, name_th: `${male ? "นาย" : female ? "นางสาว" : ""}${empNameTH(e)}`, name_en: `${male ? "Mr. " : female ? "Ms. " : ""}${[e.firstname_en, e.lastname_en].filter(Boolean).join(" ")}`.trim(), title_en: e.position || d.title_en || "" });
    for (const k of ["emp_code", "name_th", "name_en", "title_en"]) { const i = el.querySelector(`[data-k="${k}"]`); if (i) i.value = d[k] || ""; }
  });
  $("[data-ok]").onclick = async () => {
    const x = { step: +d.step, name_th: (d.name_th || "").trim(), name_en: d.name_en?.trim() || null, title_th: d.title_th?.trim() || null, title_en: d.title_en?.trim() || null,
      emp_code: d.emp_code?.trim() || null, email: (d.email || "").trim(), is_default: $("#paDef").checked, is_active: $("#paAct").checked };
    if (!x.name_th) return toast("กรอกชื่อ", "error"); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x.email)) return toast("กรอกอีเมลให้ถูกต้อง", "error");
    // ค่าเริ่มต้นมีได้ขั้นละคน
    if (x.is_default) await supabase.from("paf_approvers").update({ is_default: false }).eq("step", x.step).neq("id", a?.id || 0);
    const { error } = a ? await supabase.from("paf_approvers").update(x).eq("id", a.id) : await supabase.from("paf_approvers").insert(x);
    if (error) return toast(error.message, "error");
    close(); toast("บันทึกแล้ว", "success"); boot();
  };
  $("[data-del]")?.addEventListener("click", async () => {
    if (!confirm(`ลบ ${a.name_th}? (PAF ที่ส่งไปแล้วยังเก็บชื่อเดิมไว้)`)) return;
    const { error } = await supabase.from("paf_approvers").delete().eq("id", a.id); if (error) return toast(error.message, "error");
    close(); boot();
  });
}

// ---------------------------------------------------------------- ฟอร์ม PAF (ซ้าย) + ใบจริง (ขวา)
const firstOfNextMonth = () => { const t = new Date(); return new Date(Date.UTC(t.getFullYear(), t.getMonth() + 1, 1)).toISOString().slice(0, 10); };
async function openForm(r) {
  const editable = canWrite() && (!r || ["draft", "rejected"].includes(r.status));
  let d = r ? { ...r } : { subject_th: SUBJECTS[0].th, subject_en: SUBJECTS[0].en, effective_date: firstOfNextMonth() };
  let log = r ? (await supabase.from("paf_log").select("*").eq("paf_id", r.id).order("at")).data || [] : [];
  const el = document.createElement("div"); el.className = "modal-overlay";
  el.innerHTML = `<div class="modal lt-modal"><div class="modal-header"><div class="modal-title">${r ? `${esc(r.doc_no || "ร่าง PAF")} · ${esc(r.name_th || "")} ${badge(r.status, r.cur_step)}` : "ทำ Personnel Action Form"}</div><button class="modal-close" data-x>✕</button></div>
    <div class="lt-body"><div class="lt-form" id="pfForm"></div><div class="lt-preview"><iframe id="pfFrame" title="ตัวอย่าง PAF"></iframe></div></div><div class="modal-footer" id="pfFoot" style="flex-wrap:wrap;"></div></div>`;
  document.getElementById("modalPortal").appendChild(el);
  const $ = s => el.querySelector(s), close = () => el.remove();
  el.querySelector("[data-x]").onclick = close;
  const html = () => pafHTML(d, log, { logo: new URL("/assets/logo.png", location.href).href, draft: d.status === "approved" ? "" : d.status === "pending" ? "รออนุมัติ" : d.status === "cancelled" ? "ยกเลิก" : "ร่าง" });
  const preview = () => { $("#pfFrame").srcdoc = html(); };
  const dis = editable ? "" : "disabled";
  const f = (k, label, type = "text", extra = "") => `<label class="lt-f"><span>${label}</span><input class="form-control" data-k="${k}" type="${type}" value="${esc(d[k] ?? "")}" ${dis} ${extra}></label>`;
  const was = k => d[k] ? `<span class="text-muted" style="font-weight:400;"> · เดิม ${esc(d[k])}</span>` : "";
  const items = {
    pos: toItems(masterPositions), lv: toItems(masterJobLevels), div: toItems(masterDivisions), dep: toItems(masterDepartments), sec: toItems(masterSections), team: toItems(masterTeams) };
  const combo = (id, k, label, list) => `<div class="lt-f"><span>${label}${was(k.replace(/_to$/, ""))}</span>${editable ? comboHTML(id, list, d[k] || "",
    k === "position_to" ? "ว่าง = ไม่เปลี่ยน · ตำแหน่งใหม่พิมพ์ได้เลย" : "ว่าง = ไม่เปลี่ยน") : `<input class="form-control" value="${esc(d[k] || "")}" disabled>`}</div>`;
  const form = () => {
    const sug = suggestMovType(d), mt = d.mov_type || sug, { rev } = conditionLines(d);
    $("#pfForm").innerHTML = `
      ${editable && !r?.doc_no ? `<div class="lt-f"><span>พนักงาน *</span>${comboHTML("pfEmp", [], d.emp_code || "", "พิมพ์ชื่อไทย/อังกฤษ หรือรหัส")}</div>`
        : `<div class="lt-hint" style="margin-top:0;"><b>${esc(d.name_th || "")}</b> · ${esc(d.emp_code || "")}<br>${esc([d.position, d.job_level, d.department].filter(Boolean).join(" · "))}</div>`}
      ${d.emp_code ? `<div class="lt-2">${f("name_th", "ชื่อ-สกุล (ไทย)")}${f("name_en", "Name (EN)")}</div>` : ""}
      <div class="lt-sub">เรื่อง</div>
      ${editable ? `<label class="lt-f"><span>เลือกเรื่องที่ใช้บ่อย</span><select class="form-control" id="pfSubj"><option value="">— เลือก —</option>${SUBJECTS.map((s, i) => `<option value="${i}">${esc(s.th)}</option>`).join("")}</select></label>` : ""}
      ${f("subject_th", "เรื่อง (ไทย)")}${f("subject_en", "Subject (EN)")}
      <div class="lt-sub">สภาพการจ้างใหม่ <span class="text-muted" style="font-weight:400;">(กรอกเฉพาะที่เปลี่ยน)</span></div>
      ${can("field.salary.read") || editable ? `<div class="lt-2">${f("salary_from", "เงินเดือนเดิม (บาท)", "number", 'step="0.01" min="0"')}${f("salary_to", "เงินเดือนใหม่ (บาท)", "number", 'step="0.01" min="0"')}</div>` : ""}
      <div class="lt-2">${combo("pfPos", "position_to", "ตำแหน่งใหม่", items.pos)}${combo("pfLv", "job_level_to", "ระดับใหม่", items.lv)}</div>
      <div class="lt-2">${combo("pfDiv", "division_to", "ฝ่าย (Division) ใหม่", items.div)}${combo("pfDep", "department_to", "Department ใหม่", items.dep)}</div>
      <div class="lt-2">${combo("pfSec", "section_to", "แผนก (Section) ใหม่", items.sec)}${combo("pfTeam", "team_to", "ทีมงานใหม่", items.team)}</div>
      <label class="lt-f"><span>หมายเหตุ / เหตุผล (EN)</span><textarea class="form-control" data-k="note_en" rows="3" ${dis}>${esc(d.note_en || "")}</textarea></label>
      <label class="lt-f"><span>หมายเหตุ / เหตุผล (ไทย)</span><textarea class="form-control" data-k="note_th" rows="3" ${dis}>${esc(d.note_th || "")}</textarea></label>
      ${f("effective_date", "วันที่มีผล *", "date")}
      <div class="lt-sub">หลังอนุมัติครบ</div>
      <label class="lt-f"><span>บันทึก Movement เป็น <span class="text-muted" style="font-weight:400;">(ระบบแนะนำ: ${esc(MOV_LABEL[sug])})</span></span>
        <select class="form-control" data-k="mov_type" ${dis}>${Object.entries(MOV_LABEL).map(([k, v]) => `<option value="${k}" ${mt === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
      <div class="lt-hint">อนุมัติครบแล้วระบบบันทึก Movement วันที่มีผล ${esc(thLong(d.effective_date) || "—")} และอัปเดตทะเบียนพนักงาน (${rev.length ? `${rev.length} รายการที่เปลี่ยน` : "ยังไม่ได้กรอกสิ่งที่เปลี่ยน"}) ให้อัตโนมัติ</div>
      ${r?.movement_id ? `<div class="lt-hint" style="color:var(--green);">✓ บันทึก Movement แล้ว (${esc(MOV_LABEL[r.mov_type] || r.mov_type)})</div>` : ""}`;
    el.querySelectorAll("#pfForm [data-k]").forEach(i => i.oninput = i.onchange = () => { d[i.dataset.k] = i.value; if (["salary_from", "salary_to"].includes(i.dataset.k)) { d[i.dataset.k] = i.value === "" ? null : Number(i.value); } if (i.dataset.k === "effective_date") form(); preview(); });
    $("#pfSubj")?.addEventListener("change", e => { const s = SUBJECTS[+e.target.value]; if (!s) return; d.subject_th = s.th; d.subject_en = s.en; form(); preview(); });
    if ($("#pfEmp")) bindCombo("pfEmp", allEmployees.filter(e => e.emp_code).map(e => ({ value: e.emp_code, label: empNameTH(e) || e.emp_code,
      sub: [e.emp_code, [e.firstname_en, e.lastname_en].filter(Boolean).join(" "), e.position].filter(Boolean).join(" · ") })), code => {
      const e = allEmployees.find(x => x.emp_code === code); if (!e) return;
      const male = /^m/i.test(e.gender || ""), female = /^f/i.test(e.gender || "");
      Object.assign(d, { emp_code: e.emp_code, name_th: `${male ? "นาย" : female ? "นางสาว" : ""}${empNameTH(e)}`, name_en: `${male ? "Mr. " : female ? "Ms. " : ""}${[e.firstname_en, e.lastname_en].filter(Boolean).join(" ")}`.trim(),
        division: e.division || "", department: e.department || "", section: e.section || "", team: e.team || "", position: e.position || "", job_level: e.job_level || "",
        salary_from: can("field.salary.read") && e.salary ? Number(e.salary) : d.salary_from ?? null });
      form(); preview();
    });
    if ($("#pfEmp_txt") && d.emp_code) { const e = allEmployees.find(x => x.emp_code === d.emp_code); if (e) $("#pfEmp_txt").value = empNameTH(e); }
    for (const [id, k, list] of [["pfPos", "position_to", items.pos], ["pfLv", "job_level_to", items.lv], ["pfDiv", "division_to", items.div], ["pfDep", "department_to", items.dep], ["pfSec", "section_to", items.sec], ["pfTeam", "team_to", items.team]])
      if ($(`#${id}`)) {
        // ตำแหน่งที่ยังไม่มี: พิมพ์เองได้ (allowFree) · ผู้ดูแลข้อมูลหลักกดเพิ่มเข้า master ได้จากรายการ
        bindCombo(id, list, v => { d[k] = v || null; form(); preview(); },
          { allowFree: true, ...(k === "position_to" && can("data.masterdata.write") ? { onCreate: addMasterPosition } : {}) });
        // พิมพ์เองแล้วกดออก ช่องจะไม่เรียก onChange — อ่านค่าเองหลังช่องเก็บข้อความ (ไม่วาดฟอร์มใหม่ จะได้ไม่เสียโฟกัสช่องถัดไป)
        $(`#${id}_txt`)?.addEventListener("blur", () => setTimeout(() => { const v = $(`#${id}`)?.value?.trim() || null; if (v !== (d[k] || null)) { d[k] = v; preview(); } }, 160));
      }
  };
  const steps = () => STEPS.map(s => { const a = approvers.find(x => x.id === +$(`#pfAp${s.step}`)?.value);
    return a ? { step: s.step, label: s.label, name_th: a.name_th, name_en: a.name_en, title_th: a.title_th, title_en: a.title_en, emp_code: a.emp_code, email: a.email } : null; });
  const row = () => ({ emp_code: d.emp_code, name_th: d.name_th || null, name_en: d.name_en || null, division: d.division || null, department: d.department || null, section: d.section || null,
    team: d.team || null, position: d.position || null, job_level: d.job_level || null, salary_from: d.salary_from ?? null, salary_to: d.salary_to ?? null,
    position_to: d.position_to || null, job_level_to: d.job_level_to || null, division_to: d.division_to || null, department_to: d.department_to || null, section_to: d.section_to || null, team_to: d.team_to || null,
    subject_th: d.subject_th || null, subject_en: d.subject_en || null, note_th: d.note_th || null, note_en: d.note_en || null, effective_date: d.effective_date || null,
    mov_type: d.mov_type || suggestMovType(d), updated_at: new Date().toISOString() });
  const check = () => { if (!d.emp_code) return "เลือกพนักงาน"; if (!d.subject_th) return "กรอกเรื่อง"; if (!d.effective_date) return "กรอกวันที่มีผล";
    if (!conditionLines(d).rev.length) return "กรอกสิ่งที่เปลี่ยนอย่างน้อย 1 อย่าง (เงินเดือน / ตำแหน่ง / ระดับ / หน่วยงาน)"; return ""; };
  const save = async () => { const e = check(); if (e) { toast(e, "error"); return null; }
    const x = row();
    const res = r ? await supabase.from("paf_forms").update(x).eq("id", r.id).select().single() : await supabase.from("paf_forms").insert(x).select().single();
    if (res.error) { toast("บันทึกไม่สำเร็จ: " + res.error.message, "error"); return null; }
    if (r) Object.assign(r, res.data); else { r = res.data; rows.unshift(r); }
    d = { ...r }; return r; };
  const reload = async () => { const { data } = await supabase.from("paf_forms").select("*").eq("id", r.id).single(); if (data) { Object.assign(r, data); d = { ...r }; }
    log = (await supabase.from("paf_log").select("*").eq("paf_id", r.id).order("at")).data || []; };
  const print = () => { const w = window.open("", "_blank"); if (!w) return toast("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต pop-up แล้วลองใหม่", "error");
    w.document.open(); w.document.write(html()); w.document.close(); setTimeout(async () => { try { await w.document.fonts?.ready; } catch {} w.focus(); w.print(); }, 700); };
  const done = msg => { toast(msg, "success"); close(); draw(); };
  const foot = () => {
    const st = r?.status || "draft", cur = (d.steps || []).find(s => s.step === d.cur_step);
    const sel = s => { const list = approvers.filter(a => a.step === s.step && a.is_active), prev = (d.steps || []).find(x => x.step === s.step);
      const pick = list.find(a => prev && a.email === prev.email) || list.find(a => a.is_default) || list[0];
      return `<select class="form-control" id="pfAp${s.step}" style="max-width:220px;">${list.map(a => `<option value="${a.id}" ${pick?.id === a.id ? "selected" : ""}>ขั้น ${s.step}: ${esc(a.name_th)}</option>`).join("") || `<option value="">ขั้น ${s.step}: ยังไม่มีผู้อนุมัติ</option>`}</select>`; };
    $("#pfFoot").innerHTML = editable ? `${r?.doc_no ? `<button class="btn btn-danger" data-cancel style="margin-right:auto;">ยกเลิก PAF</button>` : r ? `<button class="btn btn-danger" data-del style="margin-right:auto;">ลบร่าง</button>` : ""}
        <button class="btn btn-secondary" data-save>บันทึกร่าง</button><button class="btn btn-secondary" data-print>พิมพ์ร่าง</button>${STEPS.map(sel).join("")}
        <button class="btn btn-primary" data-submit>${st === "rejected" ? "ส่งอนุมัติอีกครั้ง" : "ส่งอนุมัติ"}</button>`
      : st === "pending" ? `<span class="text-muted" style="margin-right:auto;">รอขั้น ${d.cur_step}: ${esc(cur?.name_th || "-")} (${esc(cur?.email || "")})</span>
        <button class="btn btn-secondary" data-print>พิมพ์</button>${canWrite() ? `<button class="btn btn-secondary" data-renew title="ลิงก์เดิมใช้ไม่ได้ทันที">ออกลิงก์ใหม่</button>
        <button class="btn btn-primary" data-resend>ส่งอีเมล${d.cur_step > 1 ? "ขอขั้นถัดไป" : "เตือน"}</button><button class="btn btn-danger" data-cancel>ยกเลิก PAF</button>` : ""}`
      : st === "approved" ? `${canWrite() ? `<span style="margin-right:auto;display:flex;gap:6px;align-items:center;font-size:13px;">พนักงานลงนามรับทราบเมื่อ
          <input type="date" class="form-control" id="pfAck" value="${esc(d.ack_date || "")}" style="width:160px;"><button class="btn btn-secondary btn-sm" data-ack>บันทึก</button></span>` : ""}
        <button class="btn btn-primary" data-print>พิมพ์ให้พนักงานเซ็นรับทราบ</button>`
      : `<button class="btn btn-secondary" data-print>พิมพ์</button><button class="btn btn-secondary" data-x2>ปิด</button>`;
    el.querySelector("[data-x2]")?.addEventListener("click", close);
    el.querySelector("[data-print]")?.addEventListener("click", print);
    el.querySelector("[data-save]")?.addEventListener("click", async () => { if (await save()) done("บันทึกร่างแล้ว"); });
    el.querySelector("[data-del]")?.addEventListener("click", async () => { if (!confirm("ลบร่างนี้?")) return;
      const { error } = await supabase.from("paf_forms").delete().eq("id", r.id); if (error) return toast(error.message, "error"); rows = rows.filter(x => x.id !== r.id); done("ลบร่างแล้ว"); });
    el.querySelector("[data-submit]")?.addEventListener("click", async () => {
      const s = steps(); if (s.some(x => !x)) return toast("เลือกผู้อนุมัติให้ครบ 2 ขั้น (เพิ่มได้ที่แท็บ “ผู้อนุมัติ”)", "error");
      if (!(await save())) return;
      if (!confirm(`ส่ง PAF ของ ${d.name_th} ให้ ${s[0].name_th} (ขั้น 1) → ${s[1].name_th} (ขั้น 2)?${r.doc_no ? "" : "\nระบบจะออกเลขที่ PAF ในทะเบียนเลขที่เอกสาร"}`)) return;
      const { data, error } = await supabase.rpc("paf_submit", { p_id: r.id, p_steps: s }); if (error) return toast(error.message, "error");
      Object.assign(r, data); done(`${data.doc_no} ส่งอนุมัติแล้ว · ${await sendMail(r, "paf_request")}`);
    });
    el.querySelector("[data-resend]")?.addEventListener("click", async () => toast(await sendMail(r, "paf_request"), "success"));
    el.querySelector("[data-renew]")?.addEventListener("click", async () => {
      if (!confirm("ออกลิงก์ใหม่ให้ขั้นที่รออยู่? ลิงก์ในอีเมลเดิมจะใช้ไม่ได้ทันที")) return;
      const { error } = await supabase.rpc("paf_renew_link", { p_id: r.id }); if (error) return toast(error.message, "error");
      toast(`ออกลิงก์ใหม่แล้ว · ${await sendMail(r, "paf_request")}`, "success");
    });
    el.querySelector("[data-cancel]")?.addEventListener("click", async () => {
      const why = prompt(`เหตุผลที่ยกเลิก${r.doc_no ? ` (เลขที่ ${r.doc_no} จะถูกยกเลิกในทะเบียนด้วย)` : ""}`); if (!why) return;
      const { data, error } = await supabase.rpc("paf_cancel", { p_id: r.id, p_reason: why }); if (error) return toast(error.message, "error");
      Object.assign(r, data); done("ยกเลิก PAF แล้ว");
    });
    el.querySelector("[data-ack]")?.addEventListener("click", async () => {
      const v = $("#pfAck").value; if (!v) return toast("เลือกวันที่", "error");
      const { data, error } = await supabase.rpc("paf_ack", { p_id: r.id, p_date: v }); if (error) return toast(error.message, "error");
      Object.assign(r, data); await reload(); foot(); preview(); toast("บันทึกวันที่รับทราบแล้ว", "success"); draw();
    });
  };
  form(); foot(); preview();
}

// ---------------------------------------------------------------- อีเมล — โหมดอัตโนมัติผ่าน letter-notify (paf_id) · ไม่งั้นไฟล์ .eml
async function sendMail(c, action) {
  if (mailCfg.mode === "auto") { try { const { data, error } = await supabase.functions.invoke("letter-notify", { body: { paf_id: c.id, action } }); if (error) throw error; if (data?.sent) return `ส่งอีเมลถึง ${data.to} แล้ว`; } catch { /* ใช้ไฟล์เมล */ } }
  const t = mailTpl.find(x => x.key === action); if (!t) return "แจ้งในระบบแล้ว";
  const cur = (c.steps || []).find(s => s.step === c.cur_step);
  let link = `${location.origin}/?paf=${c.id}`;
  if (action === "paf_request") { const { data: tk } = await supabase.rpc("paf_pending_link", { p_id: c.id }); if (tk) link = `${location.origin}/paf/approve.html?t=${tk}`; }
  const to = action === "paf_request" ? cur?.email || "" : c.requested_email || "";
  const v = { doc_no: c.doc_no || "", kind: c.subject_th || "Personnel Action Form", person: c.name_th || "", emp_code: `(${c.emp_code})`, link, reason: c.reject_reason || "-",
    requester: c.requested_name || currentUser?.email || "", approver: cur?.name_th || "" };
  const direct = link.includes("/paf/approve.html");   // ลิงก์อนุมัติไปถึงผู้อนุมัติคนเดียว ไม่ใส่ผู้รับเพิ่ม/สำเนา
  downloadEml(mailList(to, direct ? "" : t.to_extra || ""), renderMail(t.subject, v, false), renderMail(t.html, v, true), `${c.doc_no || "PAF"} ขั้น ${c.cur_step || ""}.eml`, direct ? "" : mailList(t.cc || ""));
  return "ดาวน์โหลดไฟล์เมลแล้ว — เปิดใน Outlook แล้วกด Send";
}
