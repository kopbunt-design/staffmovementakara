import { supabase } from "./supabase-config.js";
import { esc, toast, can, currentUser, allEmployees } from "./app.js";
import { renderMail, mailList, downloadEml } from "./hr-letters.js";
import { tplEditorHTML, wireTplEditor } from "./mail-templates.js";
import { contractHTML, LOC, fill, probationEnd, thLong, idValid } from "./emp-contract-doc.js";
import { readIdCard, readRegion, complete } from "./idcard-read.js";

// ============================================================================
// สัญญาจ้างงาน (AKR-OHR-FM-006) — งานเอกสาร HR · sql/schema_emp_contract.sql
//   ผู้สมัครยังไม่อยู่ในทะเบียน → กรอกเอง หรืออ่านจากรูปบัตรประชาชน (Tesseract ในเบราว์เซอร์ รูปไม่ถูกส่งขึ้นไหน)
//   ⚠️ เก็บเลขบัตรแค่ 5 ตัวท้าย — พิมพ์ฉบับจริงต้องใส่เลขเต็มอีกครั้ง (ระบบตรวจกับ 5 ตัวท้าย + เลขตรวจสอบ)
//   ลงนามออนไลน์: ผู้แทนบริษัท + พยาน (ec_sign) → ครบสองคน = ลงนามแล้ว → HR พิมพ์ให้พนักงานเซ็นมือ
//   ไม่รันเลขเอกสาร · อีเมลใช้แบบ ec_sign / ec_signed / ec_rejected (แก้ได้ที่แท็บตั้งค่า)
// ============================================================================

const ST = { draft: ["ร่าง", "var(--muted)", "#f1f5f9"], pending: ["รอลงนาม", "var(--amber)", "var(--amber-light)"], signed: ["ลงนามแล้ว", "var(--green)", "var(--green-light)"],
  rejected: ["ส่งกลับแก้ไข", "var(--red)", "var(--red-light)"], cancelled: ["ยกเลิก", "var(--muted)", "#f1f5f9"] };
const badge = s => { const [t, c, b] = ST[s] || [s, "var(--muted)", "#f1f5f9"]; return `<span class="badge" style="color:${c};background:${b};">${t}</span>`; };
const canWrite = () => can("data.empcontract.write"), canSign = () => can("data.empcontract.sign");
const DEFAULT_MAIL = [{ key: "ec_sign", label: "ขอลงนามสัญญาจ้าง", subject: "[ขอลงนาม] สัญญาจ้างงาน — {{person}}", html: `<p>มีสัญญาจ้างงานรอลงนามจากท่าน: {{person}} · {{kind}}</p><p><a href="{{link}}">เปิดสัญญา</a></p>` }];
const MAIL_TO = { ec_sign: "ผู้แทนบริษัทและพยานที่ยังไม่ได้ลงนาม", ec_signed: "HR คนที่ส่งลงนาม", ec_rejected: "HR คนที่ส่งลงนาม" };

let rows = [], signers = [], mailCfg = { mode: "outlook" }, mailTpl = [], tab = "all", tplKey = "ec_sign", search = "";
const nameOf = uid => signers.find(s => s.user_id === uid)?.name || "—";
const who = r => `${r.title_th || ""}${r.name_th || ""}`;

export function renderEmpContract() { boot(); }
async function boot() {
  const pg = document.getElementById("pageEmpcontract");
  pg.innerHTML = `<div class="section mt-4"><div class="card"><div class="card-body">กำลังโหลด…</div></div></div>`;
  const [c, sg, mc, mt] = await Promise.all([supabase.from("emp_contracts").select("*").order("created_at", { ascending: false }).limit(1000), supabase.rpc("ec_signers"),
    supabase.from("mail_settings").select("*").eq("id", 1).maybeSingle(), supabase.from("mail_templates").select("*").like("key", "ec_%")]);
  if (c.error) { pg.innerHTML = `<div class="section mt-4"><div class="card"><div class="card-body"><b>โหลดข้อมูลไม่สำเร็จ</b><div class="text-muted" style="margin-top:6px;">${esc(c.error.message)}</div>
    <div class="text-muted" style="margin-top:10px;font-size:12px;">ต้องรัน <code>sql/schema_emp_contract.sql</code> ใน Supabase ก่อน</div></div></div></div>`; return; }
  rows = c.data || []; signers = sg.data || []; if (!mc.error && mc.data) mailCfg = mc.data;
  mailTpl = !mt.error && mt.data?.length ? mt.data.sort((a, b) => a.key.localeCompare(b.key)) : DEFAULT_MAIL;
  if (!canWrite()) tab = "sign";
  draw();
  const deep = +new URLSearchParams(location.search).get("econtract");
  if (deep) { history.replaceState(null, "", location.pathname); const x = rows.find(r => r.id === deep); x ? openContract(x) : toast("ไม่พบสัญญานี้ หรือไม่มีสิทธิ์ดู", "info"); }
}
const mineToSign = () => rows.filter(r => r.status === "pending" && ((r.signer_id === currentUser?.id && !r.signed_at) || (r.witness_id === currentUser?.id && !r.witnessed_at)));
function draw() {
  const pg = document.getElementById("pageEmpcontract"), q = search.trim().toLowerCase(), mine = mineToSign();
  const list = (tab === "sign" ? mine : rows).filter(r => !q || [who(r), r.name_en, r.position_th, r.position_en, r.emp_code].join(" ").toLowerCase().includes(q));
  pg.innerHTML = `
  <div class="page-header"><div><div class="page-heading">สัญญาจ้างงาน</div>
    <div class="page-sub">AKR-OHR-FM-006 · สำนักงานกรุงเทพ / พิจิตร · ผู้แทนบริษัทและพยานลงนามออนไลน์ · ไม่รันเลขเอกสาร</div></div>
    <div class="header-actions">${canWrite() ? `<button class="btn btn-primary" id="ecNew">+ ทำสัญญาจ้าง</button>` : ""}</div></div>
  <div class="section" style="padding-top:12px;padding-bottom:0;"><div class="cp-tabs">
    ${canWrite() ? `<button class="cp-tab${tab === "all" ? " on" : ""}" data-tab="all">สัญญาทั้งหมด (${rows.length})</button>` : ""}
    ${canSign() || mine.length ? `<button class="cp-tab${tab === "sign" ? " on" : ""}" data-tab="sign">รอฉันลงนาม${mine.length ? ` <b style="color:var(--red);">(${mine.length})</b>` : ""}</button>` : ""}
    ${canWrite() ? `<button class="cp-tab${tab === "settings" ? " on" : ""}" data-tab="settings">ตั้งค่าอีเมล</button>` : ""}</div></div>
  ${tab === "settings" ? `<div class="section mt-4"><div class="card"><div class="card-body">
      <div style="font-weight:700;color:var(--navy);margin-bottom:6px;">แบบอีเมลแจ้งลงนาม</div>
      <div class="text-muted" style="font-size:12.5px;margin-bottom:10px;">โหมดส่ง: <b>${mailCfg.mode === "auto" ? "ส่งอัตโนมัติจากอีเมลกลาง" : "ดาวน์โหลดไฟล์เมลเปิดใน Outlook"}</b> (ตั้งที่หน้าออกหนังสือ HR → ตั้งค่า) ·
        ลายเซ็นของผู้ลงนาม/พยาน ตั้งที่ “ลายเซ็นของฉัน” หน้าออกหนังสือ HR · ผู้แทนบริษัทต้องมีสิทธิ์ “ลงนามสัญญาจ้างงาน” · พยานจะเป็นคนออกสัญญา (HR ที่มีสิทธิ์ทำสัญญา) ก็ได้</div>
      ${tplEditorHTML(mailTpl, tplKey, k => MAIL_TO[k] || "-")}</div></div></div>` : `
  <div class="section" style="padding-top:12px;padding-bottom:0;"><input class="form-control" id="ecSearch" placeholder="ค้นหา ชื่อ / ตำแหน่ง" value="${esc(search)}" style="max-width:280px;"></div>
  <div class="section mt-4"><div class="card"><div class="table-wrap">
  ${list.length ? `<table class="data-table"><thead><tr><th>พนักงาน</th><th>ตำแหน่ง</th><th>สถานที่</th><th>เริ่มงาน</th><th>สถานะ</th><th>ลงนาม</th><th></th></tr></thead><tbody>
    ${list.map(r => `<tr><td><b>${esc(who(r))}</b>${r.name_en ? `<div class="text-muted" style="font-size:11.5px;">${esc(r.name_en)}</div>` : ""}</td>
      <td>${esc(r.position_th)}<div class="text-muted" style="font-size:11.5px;">${esc(r.job_level || "")}</div></td><td>${esc(LOC[r.location]?.label || r.location)}</td><td style="white-space:nowrap;">${thLong(r.start_date)}</td>
      <td>${badge(r.status)}${r.status === "rejected" && r.reject_reason ? `<div style="font-size:11.5px;color:var(--red);">${esc(r.reject_reason)}</div>` : ""}</td>
      <td style="font-size:12px;">${r.signer_id ? `${r.signed_at ? "✓" : "○"} ${esc(nameOf(r.signer_id))}<br>${r.witnessed_at ? "✓" : "○"} พยาน ${esc(nameOf(r.witness_id))}` : `<span class="text-muted">—</span>`}</td>
      <td style="white-space:nowrap;"><button class="btn btn-sm ${tab === "sign" ? "btn-primary" : "btn-secondary"}" data-open="${r.id}">${tab === "sign" ? "เปิดดู / ลงนาม" : ["draft", "rejected"].includes(r.status) ? "แก้ไข" : "เปิด"}</button></td></tr>`).join("")}</tbody></table>`
    : `<div class="card-body" style="padding:40px;text-align:center;"><div class="empty-title">${tab === "sign" ? "ไม่มีสัญญารอลงนาม" : "ยังไม่มีสัญญา"}</div></div>`}
  </div></div></div>`}<div class="pb-4"></div>`;
  pg.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; draw(); });
  pg.querySelector("#ecNew")?.addEventListener("click", () => openContract(null));
  pg.querySelectorAll("[data-open]").forEach(b => b.onclick = () => openContract(rows.find(r => r.id === +b.dataset.open)));
  const s = pg.querySelector("#ecSearch"); if (s) s.oninput = () => { search = s.value; const p = s.selectionStart; draw(); const n = document.getElementById("ecSearch"); n.focus(); n.setSelectionRange(p, p); };
  if (tab === "settings") wireTplEditor(pg, mailTpl, { sample: { person: "นายทดสอบ สมมติ", kind: "สัญญาจ้างงาน · เจ้าหน้าที่", emp_code: "เริ่มงาน 2026-11-01",
    link: `${location.origin}/?econtract=1`, reason: "แก้เงินเดือน", requester: "HR", approver: "ผู้แทนบริษัท" }, onSwitch: k => { tplKey = k; draw(); } });
}

// ---------------------------------------------------------------- อ่านบัตรประชาชน: js/idcard-read.js · อ่านไม่ครบ → HR ลากกรอบที่บัตรเอง
function cropPicker(canvas, onPick) {
  const el = document.createElement("div"); el.className = "modal-overlay"; el.style.zIndex = 1100;
  el.innerHTML = `<div class="modal" style="max-width:min(900px,96vw);"><div class="modal-header"><div class="modal-title">ลากกรอบรอบหน้าบัตร</div><button class="modal-close" data-x>✕</button></div>
    <div class="modal-body"><div class="text-muted" style="font-size:12.5px;margin-bottom:8px;">ลากเมาส์ (หรือนิ้ว) คลุมเฉพาะหน้าบัตรที่มีชื่อ เลขบัตร ที่อยู่ — ไม่ต้องรวมด้านหลังบัตรหรือลายมือ</div>
      <div id="cpWrap" style="position:relative;touch-action:none;user-select:none;max-height:70vh;overflow:auto;"><img id="cpImg" style="display:block;width:100%;" draggable="false">
      <div id="cpBox" style="position:absolute;border:2px solid #2563eb;background:rgba(37,99,235,.12);display:none;pointer-events:none;"></div></div></div>
    <div class="modal-footer"><button class="btn btn-secondary" data-x>ยกเลิก</button><button class="btn btn-primary" id="cpGo" disabled>อ่านส่วนที่เลือก</button></div></div>`;
  document.getElementById("modalPortal").appendChild(el);
  const $ = s => el.querySelector(s), img = $("#cpImg"), box = $("#cpBox"); let st = null, rect = null;
  img.src = canvas.toDataURL("image/jpeg", .85);
  el.querySelectorAll("[data-x]").forEach(b => b.onclick = () => el.remove());
  const pos = e => { const r = img.getBoundingClientRect(); return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)) }; };
  const wrap = $("#cpWrap");
  wrap.onpointerdown = e => { st = pos(e); wrap.setPointerCapture(e.pointerId); };
  wrap.onpointermove = e => { if (!st) return; const q = pos(e), x = Math.min(st.x, q.x), y = Math.min(st.y, q.y), w = Math.abs(q.x - st.x), h = Math.abs(q.y - st.y);
    Object.assign(box.style, { display: "block", left: x + img.offsetLeft + "px", top: y + img.offsetTop + "px", width: w + "px", height: h + "px" });
    const k = canvas.width / img.getBoundingClientRect().width; rect = { x: x * k, y: y * k, w: w * k, h: h * k }; $("#cpGo").disabled = !(w > 20 && h > 20); };
  wrap.onpointerup = () => { st = null; };
  $("#cpGo").onclick = () => { el.remove(); onPick(rect); };
}

// ---------------------------------------------------------------- ตัวแก้สัญญา (ฟอร์มซ้าย · ตัวอย่างขวา)
async function sigData(path) {
  if (!path) return "";
  const { data } = await supabase.storage.from("letter-assets").download(path); if (!data) return "";
  return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(data); });
}
function openContract(r) {
  const editable = !r || (canWrite() && ["draft", "rejected"].includes(r.status));
  let d = r ? { ...r } : { location: "phichit", contract_date: new Date().toISOString().slice(0, 10), title_th: "นาย", salary: "" };
  let idFull = "", sig = null, read = new Set();
  const el = document.createElement("div"); el.className = "modal-overlay";
  el.innerHTML = `<div class="modal lt-modal"><div class="modal-header"><div class="modal-title">${r ? `สัญญาจ้าง · ${esc(who(r))} ${badge(r.status)}` : "ทำสัญญาจ้างงาน"}</div><button class="modal-close" data-x>✕</button></div>
    <div class="lt-body"><div class="lt-form" id="ecForm"></div><div class="lt-preview"><iframe id="ecFrame" title="ตัวอย่างสัญญา"></iframe></div></div><div class="modal-footer" id="ecFoot"></div></div>`;
  document.getElementById("modalPortal").appendChild(el);
  const $ = s => el.querySelector(s), close = () => el.remove();
  el.querySelector("[data-x]").onclick = close;
  const loadSig = async () => { if (!r || (!r.signer && !r.witness)) return;
    sig = { signer: r.signer ? { name: r.signer.name_th, img: await sigData(r.signer.signature_path) } : null, witness: r.witness ? { name: r.witness.name_th, img: await sigData(r.witness.signature_path) } : null }; preview(); };
  const html = (forPrint = false) => contractHTML(d, { idFull: idFull || undefined, sig, logo: new URL("/assets/logo.png", location.href).href,
    draft: forPrint && r?.status === "signed" ? "" : r?.status === "signed" ? "" : r?.status === "pending" ? "รอลงนาม" : "ร่าง" });
  const preview = () => { $("#ecFrame").srcdoc = html(); };
  const f = (k, label, type = "text", extra = "") => `<label class="lt-f"><span>${label}${read.has(k) ? ' <b style="color:var(--amber);">· อ่านจากบัตร ตรวจด้วย</b>' : ""}</span>
    <input class="form-control" data-k="${k}" type="${type}" value="${esc(d[k] ?? "")}" ${editable ? "" : "disabled"} ${extra} ${read.has(k) ? 'style="background:#FFFBEB;border-color:#FCD34D;"' : ""}></label>`;
  const L = () => LOC[d.location] || LOC.phichit;
  const positions = [...new Set(allEmployees.map(e => e.position).filter(Boolean))].sort();
  const form = () => {
    const idOk = idFull && idValid(idFull), match = idFull && d.id_last5 && idFull.replace(/\D/g, "").slice(-5) !== d.id_last5;
    $("#ecForm").innerHTML = `
      ${editable ? `<div class="lt-hint" style="margin-top:0;"><b>อ่านจากบัตรประชาชน</b> (รูปถ่าย หรือ PDF สำเนาบัตร) — อ่านในเครื่องนี้ ไฟล์ไม่ถูกส่งขึ้นที่ไหน · อ่านแล้วตรวจช่องสีเหลืองทุกช่อง
        <div style="margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><label class="btn btn-sm btn-secondary" style="cursor:pointer;">📷 เลือกรูป / PDF บัตร<input type="file" id="ecImg" accept="image/*,application/pdf,.pdf" hidden></label><span id="ecOcr" class="text-muted"></span></div></div>` : ""}
      <label class="lt-f"><span>สถานที่ทำงาน</span><select class="form-control" data-k="location" ${editable ? "" : "disabled"}>${Object.entries(LOC).map(([k, v]) => `<option value="${k}" ${d.location === k ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
      ${f("contract_date", "สัญญาทำขึ้นเมื่อวันที่", "date")}
      <div class="lt-sub">พนักงาน</div>
      <div class="lt-2"><label class="lt-f"><span>คำนำหน้า${read.has("title_th") ? ' <b style="color:var(--amber);">·</b>' : ""}</span><select class="form-control" data-k="title_th" ${editable ? "" : "disabled"}>${["นาย", "นาง", "นางสาว"].map(t => `<option ${d.title_th === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>${f("name_th", "ชื่อ-สกุล (ไทย)")}</div>
      ${f("name_en", "ชื่อ-สกุล (อังกฤษ)")}
      <label class="lt-f"><span>เลขบัตรประชาชน 13 หลัก${read.has("id") ? ' <b style="color:var(--amber);">· อ่านจากบัตร ตรวจด้วย</b>' : ""}</span>
        <input class="form-control" id="ecId" inputmode="numeric" value="${esc(idFull)}" placeholder="${d.id_last5 ? `ที่บันทึกไว้: …${esc(d.id_last5)} (พิมพ์เลขเต็มเพื่อพิมพ์ฉบับจริง)` : "พิมพ์หรืออ่านจากรูปบัตร"}" ${read.has("id") ? 'style="background:#FFFBEB;border-color:#FCD34D;"' : ""}>
        <span style="font-weight:400;font-size:11.5px;color:${idFull ? (idOk && !match ? "var(--green)" : "var(--red)") : "var(--muted)"};">${idFull ? (match ? "✕ ไม่ตรงกับ 5 ตัวท้ายที่บันทึกไว้" : idOk ? "✓ เลขถูกต้อง (ตรวจเลขหลักสุดท้ายแล้ว)" : "✕ เลขไม่ถูกต้อง — ตรวจอีกครั้ง") : "ระบบเก็บแค่ 5 ตัวท้าย เลขเต็มใช้ตอนพิมพ์เท่านั้น"}</span></label>
      ${f("birth_date", "วันเกิด", "date")}
      <label class="lt-f"><span>ที่อยู่ (ตามบัตร)${read.has("address") ? ' <b style="color:var(--amber);">· อ่านจากบัตร ตรวจด้วย</b>' : ""}</span><textarea class="form-control" data-k="address" rows="2" ${editable ? "" : "disabled"} ${read.has("address") ? 'style="background:#FFFBEB;border-color:#FCD34D;"' : ""}>${esc(d.address || "")}</textarea></label>
      <div class="lt-sub">ตำแหน่ง · ค่าตอบแทน</div>
      ${f("start_date", "วันเริ่มงาน", "date")}
      <div class="lt-2">${f("position_th", "ตำแหน่ง (ไทย)")}${f("position_en", "Position (EN)", "text", 'list="ecPos"')}</div><datalist id="ecPos">${positions.map(p => `<option value="${esc(p)}">`).join("")}</datalist>
      <div class="lt-2">${f("job_level", "ระดับตำแหน่งงาน", "text", 'placeholder="เช่น O1, S3"')}${f("salary", "เงินเดือนพื้นฐาน (บาท)", "number", 'step="0.01" min="0"')}</div>
      <div class="lt-sub">วันเวลา · สถานที่ <span class="text-muted" style="font-weight:400;">(ว่าง = ตาม${esc(L().label)})</span></div>
      <div class="lt-2">${f("work_days", "วันทำงาน", "text", `placeholder="${esc(L().days)}"`)}${f("work_hours", "เวลาทำงาน", "text", `placeholder="${esc(L().hours)}"`)}</div>
      ${f("workplace", "สถานที่ทำงาน", "text", `placeholder="${esc(L().workplace)}"`)}
      <label class="lt-f" style="flex-direction:row;align-items:center;gap:8px;"><input type="checkbox" id="ecNoProb" ${d.no_probation ? "checked" : ""} ${editable ? "" : "disabled"}> ไม่มีทดลองงาน</label>
      ${d.no_probation ? "" : `${f("probation_end", "ทดลองงานถึงวันที่", "date", `placeholder="${probationEnd(d.start_date)}"`)}
      <div class="lt-hint">ทดลองงาน 119 วัน: ว่าง = ${d.start_date ? thLong(probationEnd(d.start_date)) : "คำนวณจากวันเริ่มงาน"} (วันที่ 119 นับวันเริ่มงานเป็นวันที่ 1)</div>`}
      ${r?.status === "signed" || r?.status === "pending" ? `<div class="lt-sub">การลงนาม</div><div style="font-size:13px;margin-top:6px;">${r.signed_at ? "✓" : "○"} ผู้แทนบริษัท: ${esc(nameOf(r.signer_id))}${r.signed_at ? ` · ${new Date(r.signed_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}` : ""}<br>
        ${r.witnessed_at ? "✓" : "○"} พยาน: ${esc(nameOf(r.witness_id))}${r.witnessed_at ? ` · ${new Date(r.witnessed_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}` : ""}</div>` : ""}
      ${r ? `<label class="lt-f"><span>รหัสพนักงาน (ใส่เมื่อมีรหัสแล้ว)</span><input class="form-control" id="ecEmp" value="${esc(r.emp_code || "")}" ${canWrite() ? "" : "disabled"}></label>` : ""}`;
    el.querySelectorAll("[data-k]").forEach(i => i.oninput = i.onchange = () => { d[i.dataset.k] = i.value; if (["location", "start_date"].includes(i.dataset.k)) { form(); } preview(); });
    $("#ecNoProb")?.addEventListener("change", e => { d.no_probation = e.target.checked; form(); preview(); });
    $("#ecId").oninput = e => { idFull = e.target.value.replace(/\D/g, "").slice(0, 13); const p = e.target.selectionStart; form(); preview(); const n = $("#ecId"); n.focus(); n.setSelectionRange(p, p); };
    $("#ecImg")?.addEventListener("change", async e => {
      const file = e.target.files[0]; if (!file) return; e.target.value = ""; const st = $("#ecOcr"); st.textContent = "กำลังโหลดตัวอ่านภาพ… (ครั้งแรกประมาณ 10–20 วินาที)";
      try { ocrDone(await readIdCard(file, t => { $("#ecOcr").textContent = `กำลังอ่าน · ${t}`; })); } catch (er) { st.textContent = "อ่านไม่สำเร็จ: " + er.message + " — กรอกเองได้"; }
    });
    $("#ecEmp")?.addEventListener("change", async e => { const { error } = await supabase.from("emp_contracts").update({ emp_code: e.target.value.trim() || null }).eq("id", r.id); if (error) toast(error.message, "error"); else { r.emp_code = e.target.value.trim() || null; toast("บันทึกรหัสพนักงานแล้ว", "success"); } });
  };
  // ผลอ่านบัตร → ใส่ช่อง (ทับเฉพาะช่องที่อ่านได้) · ยังไม่ครบ → ปุ่มลากกรอบเอง
  let lastPage = null;
  const ocrDone = x => {
    const got = { title_th: x.title_th, name_th: x.name_th, name_en: x.name_en, birth_date: x.birth_date, address: x.address };
    const filled = Object.entries(got).filter(([, v]) => v); for (const [k, v] of filled) { d[k] = v; read.add(k); }
    if (x.id && (x.idOk || !idValid(idFull))) { idFull = x.id; read.add("id"); }
    if (x.pages?.length) lastPage = x.pages[(x.page || 1) - 1]?.canvas || x.pages[0].canvas; else if (x.canvas) lastPage = x.canvas;
    form(); preview();
    const ok = complete({ ...d, id: idFull, idOk: idValid(idFull) });
    $("#ecOcr").innerHTML = `${filled.length || x.id ? `อ่านได้ ${filled.length + (x.id ? 1 : 0)} ช่อง${x.page > 1 ? ` (หน้า ${x.page})` : ""}${x.id && !x.idOk ? " · เลขบัตรอ่านไม่ชัด ตรวจอีกครั้ง" : ""} — ตรวจช่องสีเหลืองทุกช่อง`
      : "อ่านข้อมูลบัตรไม่ออก"}${lastPage ? ` ${ok ? "· ยังผิดอยู่?" : "·"} <button class="btn btn-sm ${ok ? "btn-secondary" : "btn-primary"}" id="ecCrop" type="button">✂ ลากกรอบที่บัตรแล้วอ่านใหม่</button>` : ""}
      <details style="margin-top:4px;"><summary style="cursor:pointer;">ดูข้อความที่ระบบอ่านได้</summary><pre style="white-space:pre-wrap;font-size:11px;max-height:160px;overflow:auto;background:#fff;padding:6px;border-radius:6px;">${esc(x.raw || "(ว่าง)")}</pre></details>`;
    $("#ecCrop")?.addEventListener("click", () => cropPicker(lastPage, async rect => {
      $("#ecOcr").textContent = "กำลังอ่านส่วนที่เลือก…";
      try { ocrDone({ ...(await readRegion(lastPage, rect, t => { $("#ecOcr").textContent = t; })), pages: null, canvas: lastPage }); } catch (er) { $("#ecOcr").textContent = "อ่านไม่สำเร็จ: " + er.message; }
    }));
  };
  const row = () => { const x = { location: d.location, contract_date: d.contract_date, title_th: d.title_th, name_th: (d.name_th || "").trim(), name_en: d.name_en?.trim() || null,
    birth_date: d.birth_date || null, address: d.address?.trim() || null, start_date: d.start_date, position_th: (d.position_th || "").trim(), position_en: d.position_en?.trim() || null,
    job_level: d.job_level?.trim() || null, salary: Number(d.salary), work_days: d.work_days || null, work_hours: d.work_hours || null, workplace: d.workplace || null,
    probation_end: d.no_probation ? null : d.probation_end || null, no_probation: !!d.no_probation, updated_at: new Date().toISOString() };
    if (idFull) x.id_last5 = idFull.slice(-5); return x; };
  const check = () => { const x = row();
    if (!x.name_th) return "กรอกชื่อ"; if (!x.start_date) return "กรอกวันเริ่มงาน"; if (!x.position_th) return "กรอกตำแหน่ง"; if (!(x.salary > 0)) return "กรอกเงินเดือน";
    if (idFull && !idValid(idFull)) return "เลขบัตรประชาชนไม่ถูกต้อง"; if (!idFull && !d.id_last5) return "กรอกเลขบัตรประชาชน"; return ""; };
  const save = async () => { const e = check(); if (e) { toast(e, "error"); return null; }
    const x = row();
    const res = r ? await supabase.from("emp_contracts").update(x).eq("id", r.id).select().single() : await supabase.from("emp_contracts").insert(x).select().single();
    if (res.error) { toast("บันทึกไม่สำเร็จ: " + res.error.message, "error"); return null; }
    if (r) Object.assign(r, res.data); else { r = res.data; rows.unshift(r); }
    d = { ...r }; return r; };
  const sendMail = async (c, action) => {
    if (mailCfg.mode === "auto") { try { const { data, error } = await supabase.functions.invoke("letter-notify", { body: { ec_id: c.id, action } }); if (error) throw error; if (data?.sent) return `ส่งอีเมลถึง ${data.to} แล้ว`; } catch { /* ใช้ไฟล์เมล */ } }
    const t = mailTpl.find(x => x.key === action); if (!t) return "แจ้งในระบบแล้ว";
    const to = action === "ec_sign" ? [c.signed_at ? "" : signers.find(s => s.user_id === c.signer_id)?.email, c.witnessed_at ? "" : signers.find(s => s.user_id === c.witness_id)?.email].join(",") : c.requested_email || "";
    const v = { doc_no: "", kind: `สัญญาจ้างงาน · ${c.position_th}`, person: who(c), emp_code: `เริ่มงาน ${thLong(c.start_date)}`, link: `${location.origin}/?econtract=${c.id}`,
      reason: c.reject_reason || "-", requester: currentUser?.email || "", approver: action === "ec_sign" ? [nameOf(c.signer_id), nameOf(c.witness_id)].join(" และ ") : (signers.find(s => s.user_id === currentUser?.id)?.name || "") };
    downloadEml(mailList(to, t.to_extra || ""), renderMail(t.subject, v, false), renderMail(t.html, v, true), `สัญญาจ้าง ${who(c)}.eml`, mailList(t.cc || ""));
    return "ดาวน์โหลดไฟล์เมลแล้ว — เปิดใน Outlook แล้วกด Send";
  };
  const done = (msg) => { toast(msg, "success"); close(); draw(); };
  const foot = () => {
    // ผู้แทนบริษัท = มีสิทธิ์ลงนาม · พยาน = ผู้มีสิทธิ์ลงนาม หรือ HR ที่ทำสัญญา (ค่าเริ่มต้น = คนออกสัญญาเอง ถ้าตั้งลายเซ็นแล้ว)
    const sgList = signers.filter(s => s.can_sign !== false), me0 = currentUser?.id;
    const sgSel = r?.signer_id || (sgList.find(s => s.user_id !== me0) || sgList[0])?.user_id || "";
    const wtSel = r?.witness_id || (signers.find(s => s.user_id === me0 && s.user_id !== sgSel) || signers.find(s => s.user_id !== sgSel))?.user_id || "";
    const canPair = sgList.length > 0 && signers.some(s => s.user_id !== sgSel);
    const noPair = !sgList.length ? "ยังไม่มีผู้แทนบริษัท — ให้ Admin ให้สิทธิ์ “ลงนามสัญญาจ้างงาน” และให้คนนั้นตั้งลายเซ็นก่อน"
      : sgList.length === 1 && sgList[0].user_id === me0 ? "ส่งไม่ได้: ผู้แทนบริษัทกับพยานต้องเป็นคนละคน — ต้องมีผู้แทนบริษัทอีกคน (มีสิทธิ์ “ลงนามสัญญาจ้างงาน” + ตั้งลายเซ็นแล้ว)"
      : "ต้องมีพยานอีกคน — คนออกสัญญาเป็นพยานได้ ตั้งลายเซ็นของคุณก่อน";
    const st = r?.status || "draft", me = currentUser?.id, myTurn = st === "pending" && ((r.signer_id === me && !r.signed_at) || (r.witness_id === me && !r.witnessed_at));
    $("#ecFoot").innerHTML = editable ? `${r ? `<button class="btn btn-danger" data-cancel style="margin-right:auto;">ยกเลิกสัญญา</button>` : ""}
      <button class="btn btn-secondary" data-save>บันทึกร่าง</button><button class="btn btn-secondary" data-print>พิมพ์ร่าง</button>
      <select class="form-control" id="ecSg" style="max-width:220px;">${sgList.map(s => `<option value="${s.user_id}" ${sgSel === s.user_id ? "selected" : ""}>ผู้แทนบริษัท: ${esc(s.name)}</option>`).join("") || `<option value="">ยังไม่มีผู้ลงนาม</option>`}</select>
      <select class="form-control" id="ecWt" style="max-width:200px;">${signers.map(s => `<option value="${s.user_id}" ${wtSel === s.user_id ? "selected" : ""}>พยาน: ${s.user_id === me ? "ฉัน · " : ""}${esc(s.name)}</option>`).join("") || `<option value="">ยังไม่มีพยาน</option>`}</select>
      ${canPair ? "" : `<span style="font-size:12px;color:var(--red);max-width:260px;line-height:1.35;">${esc(noPair)}</span>`}
      <button class="btn btn-primary" data-submit ${canPair ? "" : "disabled"}>ส่งลงนาม</button>`
    : myTurn ? `<button class="btn btn-danger" data-reject style="margin-right:auto;">ส่งกลับแก้ไข</button><button class="btn btn-primary" data-sign>✓ ลงนาม${r.signer_id === me && !r.signed_at ? "ในนามบริษัท" : "เป็นพยาน"}</button>`
    : st === "signed" && canWrite() ? `<button class="btn btn-danger" data-cancel style="margin-right:auto;">ยกเลิกสัญญา</button><span class="text-muted" style="font-size:12.5px;">ใส่เลขบัตรเต็มด้านซ้ายก่อนพิมพ์ฉบับจริง</span><button class="btn btn-primary" data-print>พิมพ์ฉบับลงนาม / PDF</button>`
    : st === "pending" && canWrite() ? `<span class="text-muted" style="margin-right:auto;">รอ ${[!r.signed_at && nameOf(r.signer_id), !r.witnessed_at && "พยาน " + nameOf(r.witness_id)].filter(Boolean).join(" และ ")} ลงนาม</span>
      <button class="btn btn-secondary" data-resend>ส่งอีเมลเตือน</button><button class="btn btn-danger" data-cancel>ยกเลิกสัญญา</button>`
    : `<button class="btn btn-secondary" data-x2>ปิด</button>`;
    el.querySelector("[data-x2]")?.addEventListener("click", close);
    el.querySelector("[data-save]")?.addEventListener("click", async () => { if (await save()) done("บันทึกร่างแล้ว"); });
    el.querySelector("[data-print]")?.addEventListener("click", async () => {
      if (r?.status === "signed") { if (!idFull || !idValid(idFull)) { toast("ใส่เลขบัตรประชาชนเต็ม 13 หลักก่อนพิมพ์ฉบับจริง", "error"); $("#ecId")?.focus(); return; }
        if (r.id_last5 && idFull.slice(-5) !== r.id_last5) { toast("เลขบัตรไม่ตรงกับ 5 ตัวท้ายที่บันทึกไว้", "error"); return; } }
      const w = window.open("", "_blank"); if (!w) { toast("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต pop-up แล้วลองใหม่", "error"); return; }
      w.document.open(); w.document.write(html(true)); w.document.close(); setTimeout(async () => { try { await w.document.fonts?.ready; } catch {} w.focus(); w.print(); }, 700);
    });
    el.querySelector("[data-submit]")?.addEventListener("click", async () => {
      const sg = $("#ecSg").value, wt = $("#ecWt").value; if (!sg || !wt) return toast("เลือกผู้แทนบริษัทและพยาน", "error"); if (sg === wt) return toast("ผู้แทนบริษัทกับพยานต้องเป็นคนละคน", "error");
      if (!(await save())) return;
      const { data, error } = await supabase.rpc("ec_submit", { p_id: r.id, p_signer: sg, p_witness: wt }); if (error) return toast(error.message, "error");
      Object.assign(r, data);
      // คนออกสัญญาเป็นพยานเอง → ลงนามพยานเลย อีเมลไปถึงผู้แทนบริษัทคนเดียว
      if (wt === currentUser?.id && confirm("คุณเป็นพยานของสัญญานี้ — ลงนามพยานด้วยลายเซ็นที่ตั้งไว้เลยไหม?")) {
        const s2 = await supabase.rpc("ec_sign", { p_id: r.id }); if (s2.error) toast(s2.error.message, "error"); else Object.assign(r, s2.data); }
      done(`ส่งลงนามแล้ว · ${await sendMail(r, "ec_sign")}`);
    });
    el.querySelector("[data-resend]")?.addEventListener("click", async () => toast(await sendMail(r, "ec_sign"), "success"));
    el.querySelector("[data-sign]")?.addEventListener("click", async () => {
      if (!confirm(`ลงนามสัญญาจ้างของ ${who(r)} ด้วยลายเซ็นที่ตั้งไว้?`)) return;
      const { data, error } = await supabase.rpc("ec_sign", { p_id: r.id }); if (error) return toast(error.message, "error");
      Object.assign(r, data); done(data.status === "signed" ? `ลงนามครบแล้ว · ${await sendMail(r, "ec_signed")}` : "ลงนามแล้ว · รออีกคนลงนาม");
    });
    el.querySelector("[data-reject]")?.addEventListener("click", async () => {
      const why = prompt("เหตุผลที่ส่งกลับ"); if (why == null) return;
      const { data, error } = await supabase.rpc("ec_reject", { p_id: r.id, p_reason: why }); if (error) return toast(error.message, "error");
      Object.assign(r, data); done(`ส่งกลับแล้ว · ${await sendMail(r, "ec_rejected")}`);
    });
    el.querySelector("[data-cancel]")?.addEventListener("click", async () => {
      if (!confirm("ยกเลิกสัญญาฉบับนี้? (ประวัติยังอยู่)")) return;
      const { data, error } = await supabase.from("emp_contracts").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", r.id).select().single();
      if (error) return toast(error.message, "error"); Object.assign(r, data); done("ยกเลิกแล้ว");
    });
  };
  form(); foot(); preview(); loadSig();
}
