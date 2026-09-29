import { supabase } from "./supabase-config.js";
import { allEmployees, can, esc as escText, toast, currentUser } from "./app.js";
import { PVD_REQUESTS, PVD_POLICIES, FORM_NAME, printSubmission } from "./fund-print.js";

// ============================================================================
// หน้า HR: แบบฟอร์มกองทุน
//   - คำเชิญ: HR เลือกเองว่าใครกรอกได้ และกรอกฟอร์มไหนได้ (ไม่ใช่พนักงานทุกคน)
//     นำเข้าจากไฟล์ "รายชื่อพนักงานยังไม่เป็นสมาชิก" หรือเพิ่มทีละคน
//     แต่ละคนได้ลิงก์ส่วนตัว + ยืนยันตัวด้วยรหัสพนักงาน + เลขบัตร 5 ตัวท้าย
//   - คำขอที่ส่งเข้ามา: ดู / พิมพ์ฟอร์ม / เปลี่ยนสถานะ / หมายเหตุ / Export
//
// ⚠️ เลขบัตรประชาชนเต็มในไฟล์นำเข้า ไม่ออกจากเบราว์เซอร์ — ตัดเหลือ 5 ตัวท้ายก่อนบันทึก
// ข้อมูลเลขบัตรผู้รับประโยชน์อยู่ใน payload — ตารางนี้อ่านได้เฉพาะคนที่มีสิทธิ์ page.fundforms
// ============================================================================

// esc ใน app.js รับแค่ข้อความ — ในฟอร์มมีตัวเลข (อายุ ร้อยละ จำนวนส่วน) ส่งเข้าไปตรง ๆ จะ error
// แล้วหน้าต่างรายละเอียดเปิดไม่ขึ้น (ปุ่ม "ดู" ของ สกล.5 เคยกดไม่ได้เพราะช่องอายุ)
const esc = v => escText(v == null ? "" : String(v));

const STATUS = {
  submitted: { th: "ส่งออนไลน์แล้ว", c: "var(--amber)", bg: "var(--amber-light)" },
  accepted:  { th: "รับเรื่องแล้ว (เซ็นออนไลน์)", c: "var(--blue)", bg: "var(--blue-light)" },
  received:  { th: "รับเอกสารตัวจริงแล้ว", c: "var(--blue)", bg: "var(--blue-light)" },
  approved:  { th: "อนุมัติแล้ว",     c: "var(--green)", bg: "var(--green-light)" },
  sent:      { th: "ส่งหน่วยงานแล้ว", c: "var(--green)", bg: "var(--green-light)" },
  rejected:  { th: "ส่งกลับแก้ไข",   c: "var(--red)",   bg: "var(--red-light)" },
  cancelled: { th: "ยกเลิก",         c: "var(--muted)", bg: "#f1f5f9" },
};
const badge = s => { const x = STATUS[s] || {}; return `<span class="badge" style="color:${x.c};background:${x.bg};">${esc(x.th || s)}</span>`; };
const canEdit = () => can("data.fundforms.write");
// ขั้นถัดไปของเอกสาร — กดปุ่มเดียวเลื่อนสถานะ ไม่ต้องไปเลือกใน dropdown
// ตอนรับเรื่องมี 2 ทาง: เซ็นออนไลน์มาแล้ว (รับเรื่องได้เลย) หรือพิมพ์ไปเซ็นสดแล้วเอาตัวจริงมาส่ง
// หลัง HR รับเรื่องแล้ว พนักงานส่งฉบับใหม่ไม่ได้ (fund_form_submit กันไว้) จนกว่า HR จะส่งกลับให้แก้
const signedOnline = r => /^data:image\/png;base64,/.test(r.payload?.signature || "");
function nextSteps(r) {
  if (r.status === "submitted") return [
    ...(signedOnline(r) ? [{ to: "accepted", label: "รับเรื่อง (เซ็นออนไลน์)" }] : []),
    { to: "received", label: "รับเอกสารตัวจริง (เซ็นสด)" }];
  return { accepted: [{ to: "approved", label: "อนุมัติแล้ว" }], received: [{ to: "approved", label: "อนุมัติแล้ว" }],
           approved: [{ to: "sent", label: "ส่งหน่วยงานแล้ว" }] }[r.status] || [];
}
// ปุ่มขั้นถัดไป — เฉพาะฉบับล่าสุดของคนนั้น ฉบับที่ถูกแทนแล้วไม่ต้องรับ
const stepBtns = (r, small) => canEdit() && isLatest(r) ? nextSteps(r).map((x, i) =>
  `<button class="btn ${small ? "btn-sm " : ""}${i === nextSteps(r).length - 1 ? "btn-primary" : "btn-secondary"}" data-next="${r.id}" data-to="${x.to}">✓ ${x.label}</button>`).join(" ") : "";

async function setStatus(r, status, note) {
  const upd = { status, updated_by: currentUser?.id || null };
  if (note !== undefined) upd.hr_note = note;
  const { error } = await supabase.from("fund_form_submission").update(upd).eq("id", r.id);
  if (error) { toast("บันทึกไม่สำเร็จ: " + error.message, "error"); return false; }
  Object.assign(r, upd, { updated_at: new Date().toISOString() });
  // ส่งกลับให้แก้ แต่ลิงก์หมด/ใกล้หมดอายุ → ต่อให้อีก 14 วัน ไม่งั้นพนักงานเข้าไปแก้ไม่ได้
  if (status === "rejected") {
    const inv = invites.find(i => i.emp_code === r.emp_code && !i.cancelled);
    const soon = Date.now() + 3 * 864e5;
    if (inv && new Date(inv.expires_at) < soon) {
      const expires_at = new Date(Date.now() + 14 * 864e5).toISOString();
      const { error: e2 } = await supabase.from("fund_form_invite").update({ expires_at }).eq("id", inv.id);
      if (!e2) inv.expires_at = expires_at;
    }
    if (!inv) toast("คนนี้ไม่มีคำเชิญที่ใช้ได้ — ต้องเชิญใหม่ก่อน พนักงานถึงจะเข้าไปแก้ได้", "error");
  }
  return true;
}
async function sendBack(r) {
  const was = STATUS[r.status]?.th || r.status;
  const note = prompt(`ยกเลิกคำขอ #${r.id} ของ ${r.emp_name} (ตอนนี้: ${was}) ให้พนักงานแก้แล้วส่งใหม่\nเหตุผล (พนักงานจะเห็นข้อความนี้):`, r.hr_note || "");
  if (note === null) return false;
  return setStatus(r, "rejected", note.trim() || null);
}
const dt = s => s ? new Date(s).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "-";
const dOnly = s => s ? new Date(s).toLocaleDateString("th-TH", { dateStyle: "medium" }) : "-";
const empName = e => [e.firstname_th, e.lastname_th].filter(Boolean).join(" ");
const linkOf = inv => `${location.origin}/fund.html?t=${inv.token}`;
const SHORT = { pvd: "สำรองเลี้ยงชีพ", wef: "สกล.5" };

let rows = [], invites = [], tab = "invite", fStatus = "", search = "", onlyLatest = true;
let iSearch = "", iFilter = "";

function topic(r) {
  const p = r.payload || {};
  if (r.form_type === "pvd") return (p.requests || []).map(k => PVD_REQUESTS.find(x => x.key === k)?.label || k).join(", ");
  return `ผู้รับประโยชน์ ${(p.beneficiaries || []).length} คน`;
}


export function renderFundForms() { boot(); }

async function boot() {
  const pg = document.getElementById("pageFundforms");
  pg.innerHTML = `<div class="section mt-4"><div class="card"><div class="card-body">กำลังโหลด…</div></div></div>`;
  const [sub, inv] = await Promise.all([
    supabase.from("fund_form_submission").select("*").order("submitted_at", { ascending: false }),
    supabase.from("fund_form_invite").select("id,token,emp_code,title,emp_name,department,forms,expires_at,cancelled,opened_at,created_at")
      .order("created_at", { ascending: false }),
  ]);
  const error = sub.error || inv.error;
  if (error) {
    pg.innerHTML = `<div class="section mt-4"><div class="card"><div class="card-body">
      <b>โหลดข้อมูลไม่สำเร็จ</b><div class="text-muted" style="margin-top:6px;">${esc(error.message)}</div>
      <div class="text-muted" style="margin-top:10px;font-size:12px;">ถ้ายังไม่ได้รัน <code>sql/schema_fund_forms.sql</code> ใน Supabase ให้รันก่อน</div>
    </div></div></div>`;
    return;
  }
  rows = sub.data || [];
  invites = inv.data || [];
  draw();
}

// หนึ่งคนยึดฉบับล่าสุดฉบับเดียว ไม่ว่าจะเป็นฟอร์มไหน — คนที่ได้ทั้งสองกองทุนต้องเลือกอย่างใดอย่างหนึ่ง
// (สมาชิกกองทุนสำรองเลี้ยงชีพไม่ต้องเข้ากองทุนสงเคราะห์ลูกจ้าง) ส่งแบบใหม่มา = เปลี่ยนใจ ฉบับเก่าถูกแทน
// rows เรียงใหม่ → เก่าอยู่แล้ว
function latestByEmp() {
  const m = new Map();
  for (const r of rows) if (r.status !== "cancelled" && !m.has(r.emp_code)) m.set(r.emp_code, r);
  return m;
}
const isLatest = r => latestByEmp().get(r.emp_code)?.id === r.id;
function latestOnly(list) { const m = latestByEmp(); return list.filter(r => m.get(r.emp_code)?.id === r.id); }

function filtered() {
  let list = rows.filter(r => r.form_type === tab);
  if (onlyLatest) list = latestOnly(list);
  if (fStatus) list = list.filter(r => r.status === fStatus);
  if (search) { const q = search.toLowerCase(); list = list.filter(r => [r.emp_code, r.emp_name, r.department].join(" ").toLowerCase().includes(q)); }
  return list;
}


function draw() {
  const pg = document.getElementById("pageFundforms");
  const cnt = t => latestOnly(rows.filter(r => r.form_type === t)).length;
  const waiting = rows.filter(r => r.status === "submitted" && isLatest(r)).length;
  const live = invites.filter(i => !i.cancelled).length;
  pg.innerHTML = `
  <div class="page-header">
    <div><div class="page-heading">แบบฟอร์มกองทุน</div>
      <div class="page-sub">เฉพาะพนักงานที่เชิญ · แต่ละคนได้ลิงก์ส่วนตัว ยืนยันตัวด้วยรหัสพนักงาน + เลขบัตร 5 ตัวท้าย
        ${waiting ? ` · <b style="color:var(--amber);">รอรับเรื่อง ${waiting} คน</b>` : ""}</div></div>
    <div class="header-actions">
      ${tab === "invite"
        ? `${canEdit() ? `<button class="btn btn-secondary" id="ffAdd">+ เชิญทีละคน</button>
           <label class="btn btn-primary" style="cursor:pointer;">นำเข้ารายชื่อ (Excel)<input type="file" id="ffImport" accept=".xlsx,.xls" hidden></label>` : ""}
           <button class="btn btn-secondary" id="ffLinks">Export ลิงก์</button>`
        : `<button class="btn btn-primary" id="ffExport">Export Excel</button>`}
    </div>
  </div>
  <div class="section" style="padding-top:12px;padding-bottom:0;">
    <div class="cp-tabs">
      <button class="cp-tab${tab === "invite" ? " on" : ""}" data-tab="invite">คำเชิญ (${live})</button>
      <button class="cp-tab${tab === "pvd" ? " on" : ""}" data-tab="pvd">กองทุนสำรองเลี้ยงชีพ (${cnt("pvd")})</button>
      <button class="cp-tab${tab === "wef" ? " on" : ""}" data-tab="wef">กองทุนสงเคราะห์ลูกจ้าง สกล.5 (${cnt("wef")})</button>
    </div>
  </div>
  ${tab === "invite" ? inviteHTML() : listHTML()}
  <div class="pb-4"></div>`;
  wire();
}

function listHTML() {
  const list = filtered();
  return `<div class="section" style="padding-top:12px;padding-bottom:0;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <input class="form-control" id="ffSearch" placeholder="ค้นหา รหัส / ชื่อ / ฝ่าย" value="${esc(search)}" style="max-width:260px;">
      <select class="form-control" id="ffStatus" style="max-width:180px;"><option value="">ทุกสถานะ</option>
        ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${fStatus === k ? "selected" : ""}>${v.th}</option>`).join("")}</select>
      <label style="display:flex;gap:6px;align-items:center;font-size:13px;"><input type="checkbox" id="ffLatest" ${onlyLatest ? "checked" : ""}> เฉพาะฉบับล่าสุดของแต่ละคน</label>
    </div>
    <div class="section mt-4"><div class="card"><div class="table-wrap">
    ${list.length ? `<table class="data-table">
      <thead><tr><th>#</th><th>ส่งเมื่อ</th><th>รหัส</th><th>ชื่อ-สกุล</th><th>ฝ่าย/แผนก</th><th>เรื่อง</th><th>สถานะ</th><th></th></tr></thead>
      <tbody>${list.map(r => `<tr>
        <td>${r.id}</td><td style="white-space:nowrap;">${dt(r.submitted_at)}</td>
        <td style="white-space:nowrap;">${esc(r.emp_code)}</td><td>${esc(r.emp_name)}</td><td>${esc(r.department)}</td>
        <td style="max-width:260px;">${esc(topic(r))}</td><td>${badge(r.status)}${isLatest(r) || r.status === "cancelled" ? ""
          : `<div class="text-muted" style="font-size:11px;">ถูกแทนด้วยฉบับใหม่ #${latestByEmp().get(r.emp_code)?.id}</div>`}</td>
        <td style="white-space:nowrap;">${stepBtns(r, true)} <button class="btn btn-sm btn-secondary" data-view="${r.id}">ดู</button>
          ${canEdit() && isLatest(r) && r.status !== "rejected" ? `<button class="btn btn-sm btn-secondary" data-back="${r.id}" style="color:var(--red);" title="ยกเลิกรายการนี้ ให้พนักงานแก้แล้วส่งใหม่ (ใช้ได้แม้อนุมัติแล้ว)">ยกเลิก ให้แก้ไข</button>` : ""}
          <button class="btn btn-sm btn-secondary" data-print="${r.id}">พิมพ์</button></td></tr>`).join("")}</tbody></table>`
      : `<div class="card-body" style="padding:40px;text-align:center;"><div class="empty-title">ยังไม่มีคำขอ</div>
         <div class="empty-sub">ส่งลิงก์ให้พนักงานกรอกได้เลย</div></div>`}
    </div></div></div>`;
}


// ---------------------------------------------------------------- คำเชิญ
// คำขอล่าสุดของคนนี้ในฟอร์มนี้ (ถ้ามี)
const latestSub = (code, form) => rows.find(r => r.emp_code === code && r.form_type === form && r.status !== "cancelled");
const expired = inv => new Date(inv.expires_at) < new Date();
// ฉบับที่ HR ส่งกลับให้แก้ ยังไม่นับว่าส่งแล้ว
// ส่งแล้ว = ฉบับล่าสุดของคนนั้น (ฟอร์มใดก็ได้ในที่เปิดให้) และไม่ได้ถูกส่งกลับ — กรอกฟอร์มเดียวก็ครบ
const doneAll = inv => { const s = latestByEmp().get(inv.emp_code); return !!s && s.status !== "rejected"; };
function invState(inv) {
  if (inv.cancelled) return "cancelled";
  if (doneAll(inv)) return "done";
  if (expired(inv)) return "expired";
  return inv.opened_at ? "opened" : "new";
}
const INV_STATE = {
  new:       { th: "ยังไม่เปิดลิงก์",      c: "var(--muted)", bg: "#f1f5f9" },
  opened:    { th: "เปิดแล้ว ยังไม่ส่ง", c: "var(--amber)", bg: "var(--amber-light)" },
  done:      { th: "ส่งแล้ว",              c: "var(--green)", bg: "var(--green-light)" },
  expired:   { th: "ลิงก์หมดอายุ",         c: "var(--red)",   bg: "var(--red-light)" },
  cancelled: { th: "ยกเลิกแล้ว",          c: "var(--muted)", bg: "#f1f5f9" },
};
const stBadge = k => { const x = INV_STATE[k]; return `<span class="badge" style="color:${x.c};background:${x.bg};">${x.th}</span>`; };

function inviteHTML() {
  let list = invites.filter(i => iFilter === "cancelled" ? i.cancelled : !i.cancelled);
  if (iFilter && iFilter !== "cancelled") list = list.filter(i => invState(i) === iFilter);
  if (iSearch) { const q = iSearch.toLowerCase(); list = list.filter(i => [i.emp_code, i.emp_name, i.department].join(" ").toLowerCase().includes(q)); }
  const all = invites.filter(i => !i.cancelled);
  const n = k => all.filter(i => invState(i) === k).length;
  const formCell = inv => inv.forms.map(f => { const s = latestSub(inv.emp_code, f);
    return `<div style="white-space:nowrap;margin:2px 0;"><span style="display:inline-block;min-width:92px;">${SHORT[f]}</span>
      ${s ? `${badge(s.status)} <a href="#" data-view="${s.id}" style="font-size:12px;color:var(--blue);">#${s.id}</a>${isLatest(s) ? "" : ` <span class="text-muted" style="font-size:11px;">ถูกแทนแล้ว</span>`}` : `<span class="text-muted" style="font-size:12px;">ยังไม่ส่ง</span>`}</div>`; }).join("");
  return `<div class="section" style="padding-top:12px;padding-bottom:0;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <input class="form-control" id="ffISearch" placeholder="ค้นหา รหัส / ชื่อ / ฝ่าย" value="${esc(iSearch)}" style="max-width:260px;">
      <select class="form-control" id="ffIFilter" style="max-width:220px;">
        <option value="">ทุกคน (${all.length})</option>
        ${["new", "opened", "done", "expired"].map(k => `<option value="${k}" ${iFilter === k ? "selected" : ""}>${INV_STATE[k].th} (${n(k)})</option>`).join("")}
        <option value="cancelled" ${iFilter === "cancelled" ? "selected" : ""}>ยกเลิกแล้ว</option></select>
    </div>
    <div class="section mt-4"><div class="card"><div class="table-wrap">
    ${list.length ? `<table class="data-table">
      <thead><tr><th>รหัส</th><th>ชื่อ-สกุล</th><th>ฝ่าย/แผนก</th><th>ฟอร์มที่เปิดให้ · สถานะ</th><th>สถานะลิงก์</th><th>หมดอายุ</th><th></th></tr></thead>
      <tbody>${list.map(i => `<tr>
        <td style="white-space:nowrap;">${esc(i.emp_code)}</td>
        <td>${esc([i.title, i.emp_name].filter(Boolean).join(" "))}</td>
        <td>${esc(i.department || "-")}</td>
        <td>${formCell(i)}</td>
        <td>${stBadge(invState(i))}${i.opened_at ? `<div class="text-muted" style="font-size:11px;">เปิด ${dt(i.opened_at)}</div>` : ""}</td>
        <td style="white-space:nowrap;${expired(i) ? "color:var(--red);" : ""}">${dOnly(i.expires_at)}</td>
        <td style="white-space:nowrap;">${i.cancelled ? "" : `<button class="btn btn-sm btn-primary" data-copy="${i.id}">คัดลอกข้อความ+ลิงก์</button>
          ${canEdit() ? `<button class="btn btn-sm btn-secondary" data-edit="${i.id}">แก้ไข</button>` : ""}`}</td></tr>`).join("")}</tbody></table>`
      : `<div class="card-body" style="padding:40px;text-align:center;"><div class="empty-title">${invites.length ? "ไม่มีรายการตามตัวกรอง" : "ยังไม่ได้เชิญใคร"}</div>
         <div class="empty-sub">${invites.length ? "" : "กด “นำเข้ารายชื่อ (Excel)” แล้วเลือกไฟล์รายชื่อพนักงานยังไม่เป็นสมาชิก"}</div></div>`}
    </div></div></div>`;
}

// ข้อความพร้อมส่งทาง LINE / อีเมล — ย้ำเรื่องกองทุนสงเคราะห์ลูกจ้างเริ่มหักงวด ต.ค. 2569
// (บริษัทแจ้งไปแล้ว แต่กันพนักงานไม่เข้าใจว่าทำไมต้องกรอก) · ข้อความแยกตามสิทธิ์ของแต่ละคน
export function inviteMessage(inv) {
  // ถ้อยคำตามที่ผู้ใช้ร่างให้ (2026-09-29) — corporate กระชับ
  const wef = "บริษัทขอแจ้งว่า กองทุนสงเคราะห์ลูกจ้างจะเริ่มหักเงินสะสมตั้งแต่งวดเงินเดือนตุลาคม 2569 "
            + "ในอัตรา 0.25% ของค่าจ้าง และบริษัทจะสมทบในอัตราเดียวกัน\n";
  const body = inv.forms.includes("pvd") && inv.forms.includes("wef")
    ? wef + "ทั้งนี้ ท่านมีสิทธิ์เลือกเป็นสมาชิกกองทุนสำรองเลี้ยงชีพแทนได้ กรุณาเลือก 1 กองทุนและกรอกแบบฟอร์มผ่านลิงก์ด้านล่างค่ะ (มีตารางเปรียบเทียบให้ในลิงก์)"
    : inv.forms.includes("wef") ? wef + "กรุณากรอกแบบ สกล.5 เพื่อระบุผู้รับผลประโยชน์ผ่านลิงก์ด้านล่างค่ะ"
    : "บริษัทขอเชิญท่านสมัครสมาชิกกองทุนสำรองเลี้ยงชีพ กรุณากรอกแบบฟอร์มผ่านลิงก์ด้านล่างค่ะ";
  const due = new Date(inv.expires_at).toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" });
  return `เรียน คุณ${inv.emp_name || inv.emp_code}\n\n` + body + `\n\n` +
    `${linkOf(inv)}\n` +
    `เข้าสู่ระบบด้วยรหัสพนักงานและเลขบัตรประชาชน 5 หลักสุดท้าย โดยสามารถลงลายมือชื่อบนหน้าจอได้เลยค่ะ\n\n` +
    `กรุณากรอกและส่งแบบฟอร์มกลับภายในวันที่ ${due}\n\n` +
    `ลิงก์นี้เฉพาะท่าน กรุณาอย่าส่งต่อ`;
}

// ---- อ่านไฟล์รายชื่อ (ทำในเบราว์เซอร์ทั้งหมด — เลขบัตรเต็มไม่ถูกส่งออกไปไหน)
const cleanId = v => typeof v === "number" ? String(Math.round(v)) : String(v ?? "").replace(/[\s-]/g, "");
export function formsFromCondition(text) {
  const t = String(text || "");
  const out = [];
  if (t.includes("สำรองเลี้ยงชีพ")) out.push("pvd");
  if (t.includes("สงเคราะห์")) out.push("wef");
  return out;
}
export function parseInviteSheet(aoa) {
  const norm = v => String(v ?? "").trim();
  const hr = aoa.findIndex(r => (r || []).some(c => norm(c) === "รหัสพนักงาน"));
  if (hr < 0) throw new Error("ไม่พบคอลัมน์ “รหัสพนักงาน” ในไฟล์");
  const head = aoa[hr].map(norm);
  const col = test => head.findIndex(test);
  const c = {
    code: col(h => h === "รหัสพนักงาน"), title: col(h => h === "คำนำหน้า"),
    first: col(h => h === "ชื่อ"), last: col(h => h === "ชื่อสกุล" || h === "นามสกุล"),
    id: col(h => h.includes("เลขบัตร") || h.includes("เลขประจำตัว")), cond: col(h => h.includes("เงื่อนไข")),
  };
  if (c.id < 0) throw new Error("ไม่พบคอลัมน์เลขบัตรประชาชน");
  if (c.cond < 0) throw new Error("ไม่พบคอลัมน์ “เงื่อนไข” (บอกว่าแต่ละคนกรอกฟอร์มไหนได้)");
  const ok = [], bad = [];
  for (const r of aoa.slice(hr + 1)) {
    if (!r || !r.some(v => norm(v))) continue;
    const code = norm(r[c.code]).toUpperCase();
    const name = [norm(r[c.first]), norm(r[c.last])].filter(Boolean).join(" ");
    const id = cleanId(r[c.id]);
    const forms = formsFromCondition(r[c.cond]);
    const why = !code ? "ไม่มีรหัสพนักงาน"
              : !/\d{5}$/.test(id) ? "เลขบัตรไม่มี 5 ตัวท้ายที่เป็นตัวเลข"
              : !forms.length ? `อ่านเงื่อนไขไม่ออก: “${norm(r[c.cond])}”` : "";
    const row = { emp_code: code, title: c.title >= 0 ? norm(r[c.title]) : "", emp_name: name, id_last5: id.slice(-5), forms };
    (why ? bad : ok).push(why ? { ...row, why, id_last5: undefined } : row);
  }
  const seen = new Map();
  for (const r of ok) seen.set(r.emp_code, (seen.get(r.emp_code) || 0) + 1);
  return { ok, bad, dups: [...seen].filter(([, n]) => n > 1).map(([k]) => k) };
}

const deptOf = code => { const e = allEmployees.find(x => x.emp_code === code);
  return e ? [e.division, e.department].filter(v => v && v !== "-").join(" / ") : ""; };

async function importFile(file) {
  let parsed;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    parsed = parseInviteSheet(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" }));
  } catch (e) { toast("อ่านไฟล์ไม่ได้: " + e.message, "error"); return; }
  const { ok, bad, dups } = parsed;
  const live = new Map(invites.filter(i => !i.cancelled).map(i => [i.emp_code, i]));
  const nPvd = ok.filter(r => r.forms.includes("pvd")).length;
  const el = modal(`นำเข้ารายชื่อ · ${esc(file.name)}`, `
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px;">
      <div><b style="font-size:20px;">${ok.length}</b> คนที่จะเชิญ</div>
      <div><b>${nPvd}</b> คนกรอกได้ทั้ง 2 ฟอร์ม · <b>${ok.length - nPvd}</b> คนได้แค่ สกล.5</div>
      <div><b>${ok.filter(r => live.has(r.emp_code)).length}</b> คนมีคำเชิญอยู่แล้ว (จะอัปเดตฟอร์ม/เลขบัตร ใช้ลิงก์เดิม)</div>
    </div>
    ${bad.length ? `<div class="uni-alert" style="margin-bottom:10px;"><b>ข้าม ${bad.length} แถว</b>
      <span>${bad.map(b => `${esc(b.emp_code || "?")} ${esc(b.emp_name)} — ${esc(b.why)}`).join("<br>")}</span></div>` : ""}
    ${dups.length ? `<div class="uni-alert" style="margin-bottom:10px;"><b>รหัสซ้ำในไฟล์</b><span>${dups.map(esc).join(", ")} — ใช้แถวล่างสุด</span></div>` : ""}
    <div class="text-muted" style="font-size:12px;margin-bottom:8px;">บันทึกเฉพาะเลขบัตร 5 ตัวท้าย เลขเต็มไม่ถูกส่งออกจากเครื่องนี้</div>
    <div class="form-group" style="max-width:220px;"><label class="form-label">ลิงก์ใช้ได้ถึง</label>
      <input type="date" class="form-control" id="ffExp" value="${new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)}"></div>
    <div class="table-wrap" style="max-height:340px;overflow:auto;"><table class="data-table">
      <thead><tr><th>รหัส</th><th>ชื่อ-สกุล</th><th>ฟอร์ม</th><th></th></tr></thead>
      <tbody>${ok.map(r => `<tr><td>${esc(r.emp_code)}</td><td>${esc([r.title, r.emp_name].filter(Boolean).join(" "))}</td>
        <td>${r.forms.map(f => SHORT[f]).join(" + ")}</td><td class="text-muted" style="font-size:12px;">${live.has(r.emp_code) ? "อัปเดต" : "ใหม่"}</td></tr>`).join("")}</tbody></table></div>`,
    `<button class="btn btn-secondary" data-x>ยกเลิก</button><button class="btn btn-primary" data-ok ${ok.length ? "" : "disabled"}>เชิญ ${ok.length} คน</button>`);
  el.querySelector("[data-ok]").onclick = async e => {
    e.target.disabled = true; e.target.textContent = "กำลังบันทึก…";
    const exp = new Date(el.querySelector("#ffExp").value + "T23:59:59").toISOString();
    const last = new Map(ok.map(r => [r.emp_code, r]));   // รหัสซ้ำ: แถวล่างสุดชนะ
    const ins = [], upd = [];
    for (const r of last.values()) {
      const rec = { title: r.title || null, emp_name: r.emp_name || null, department: deptOf(r.emp_code) || null,
                    id_last5: r.id_last5, forms: r.forms, expires_at: exp };
      const cur = live.get(r.emp_code);
      if (cur) upd.push(supabase.from("fund_form_invite").update(rec).eq("id", cur.id));
      else ins.push({ ...rec, emp_code: r.emp_code, created_by: currentUser?.id || null });
    }
    const res = await Promise.all([...upd, ins.length ? supabase.from("fund_form_invite").insert(ins) : null]);
    const err = res.find(x => x?.error)?.error;
    if (err) { toast("บันทึกไม่สำเร็จ: " + err.message, "error"); e.target.disabled = false; e.target.textContent = "ลองอีกครั้ง"; return; }
    el.remove(); toast(`เชิญแล้ว ${last.size} คน`, "success"); tab = "invite"; boot();
  };
}

function openInvite(inv) {
  const isNew = !inv;
  inv = inv || { forms: ["wef"], expires_at: new Date(Date.now() + 30 * 864e5).toISOString() };
  const live = new Set(invites.filter(i => !i.cancelled).map(i => i.emp_code));
  const el = modal(isNew ? "เชิญพนักงานทีละคน" : `แก้ไขคำเชิญ · ${esc(inv.emp_code)} ${esc(inv.emp_name)}`, `
    ${isNew ? `<div class="form-group"><label class="form-label">พนักงาน</label>
      <input class="form-control" id="ffEmp" list="ffEmpList" placeholder="พิมพ์รหัสหรือชื่อ" autocomplete="off">
      <datalist id="ffEmpList">${allEmployees.filter(e => e.emp_code && !live.has(e.emp_code) && (!e.status || e.status === "Active"))
        .map(e => `<option value="${esc(e.emp_code)}">${esc(empName(e))}</option>`).join("")}</datalist>
      <div class="text-muted" style="font-size:12px;margin-top:4px;">ไม่มีในทะเบียน (เช่น รหัส DAY) พิมพ์รหัสเองได้ แล้วกรอกชื่อด้านล่าง</div></div>
      <div class="form-group"><label class="form-label">ชื่อ-สกุล (ภาษาไทย)</label><input class="form-control" id="ffName"></div>` : ""}
    <div class="form-group"><label class="form-label">เลขบัตรประชาชน 5 ตัวท้าย ${isNew ? "" : `<span class="text-muted">(เว้นว่าง = ใช้เลขเดิม)</span>`}</label>
      <input class="form-control" id="ffLast5" inputmode="numeric" maxlength="5" style="max-width:160px;" autocomplete="off"></div>
    <div class="form-group"><label class="form-label">ฟอร์มที่กรอกได้</label>
      <label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" id="ffFw" ${inv.forms.includes("wef") ? "checked" : ""}> กองทุนสงเคราะห์ลูกจ้าง (สกล.5)</label>
      <label style="display:flex;gap:8px;align-items:center;margin-top:4px;"><input type="checkbox" id="ffFp" ${inv.forms.includes("pvd") ? "checked" : ""}> กองทุนสำรองเลี้ยงชีพ</label>
      <div class="text-muted" style="font-size:12px;margin-top:4px;">ยังไม่ผ่านโปร หรือเคยลาออกจากกองทุนสำรองฯ → ติ๊กแค่ สกล.5</div></div>
    <div class="form-group"><label class="form-label">ลิงก์ใช้ได้ถึง</label>
      <input type="date" class="form-control" id="ffExp" style="max-width:200px;" value="${new Date(inv.expires_at).toISOString().slice(0, 10)}"></div>`,
    `${isNew ? "" : `<button class="btn btn-danger" data-cancel style="margin-right:auto;">ยกเลิกคำเชิญ</button>`}
     <button class="btn btn-secondary" data-x>ปิด</button><button class="btn btn-primary" data-ok>${isNew ? "เชิญ" : "บันทึก"}</button>`);
  if (isNew) el.querySelector("#ffEmp").oninput = ev => {
    const e = allEmployees.find(x => x.emp_code === ev.target.value.trim().toUpperCase());
    if (e) el.querySelector("#ffName").value = empName(e);
  };
  el.querySelector("[data-ok]").onclick = async () => {
    const last5 = el.querySelector("#ffLast5").value.trim();
    const forms = [el.querySelector("#ffFp").checked && "pvd", el.querySelector("#ffFw").checked && "wef"].filter(Boolean);
    const rec = { forms, expires_at: new Date(el.querySelector("#ffExp").value + "T23:59:59").toISOString() };
    if (!forms.length) { toast("เลือกอย่างน้อย 1 ฟอร์ม", "error"); return; }
    if (last5 || isNew) { if (!/^\d{5}$/.test(last5)) { toast("เลขบัตร 5 ตัวท้ายต้องเป็นตัวเลข 5 หลัก", "error"); return; } rec.id_last5 = last5; }
    let q;
    if (isNew) {
      const code = el.querySelector("#ffEmp").value.trim().toUpperCase();
      if (!code) { toast("เลือกพนักงานก่อน", "error"); return; }
      if (live.has(code)) { toast("คนนี้มีคำเชิญอยู่แล้ว ให้แก้ไขจากรายการแทน", "error"); return; }
      Object.assign(rec, { emp_code: code, emp_name: el.querySelector("#ffName").value.trim() || null,
                           department: deptOf(code) || null, created_by: currentUser?.id || null });
      q = supabase.from("fund_form_invite").insert(rec);
    } else q = supabase.from("fund_form_invite").update(rec).eq("id", inv.id);
    const { error } = await q;
    if (error) { toast("บันทึกไม่สำเร็จ: " + error.message, "error"); return; }
    el.remove(); toast(isNew ? "เชิญแล้ว — กดคัดลอกข้อความ+ลิงก์ไปส่งได้เลย" : "บันทึกแล้ว", "success"); boot();
  };
  el.querySelector("[data-cancel]")?.addEventListener("click", async () => {
    if (!confirm(`ยกเลิกคำเชิญของ ${inv.emp_name || inv.emp_code}? ลิงก์เดิมจะใช้ไม่ได้ทันที (คำขอที่ส่งมาแล้วยังอยู่)`)) return;
    const { error } = await supabase.from("fund_form_invite").update({ cancelled: true }).eq("id", inv.id);
    if (error) { toast("ยกเลิกไม่สำเร็จ: " + error.message, "error"); return; }
    el.remove(); toast("ยกเลิกคำเชิญแล้ว", "success"); boot();
  });
}

function exportLinks() {
  const list = invites.filter(i => !i.cancelled);
  if (!list.length) { toast("ยังไม่มีคำเชิญ"); return; }
  const data = list.map(i => ({ "รหัสพนักงาน": i.emp_code, "ชื่อ-สกุล": [i.title, i.emp_name].filter(Boolean).join(" "),
    "ฝ่าย/แผนก": i.department || "", "ฟอร์มที่กรอกได้": i.forms.map(f => FORM_NAME[f]).join(" + "),
    "สถานะ": INV_STATE[invState(i)].th, "ลิงก์": linkOf(i), "หมดอายุ": dOnly(i.expires_at), "ข้อความสำหรับส่ง": inviteMessage(i) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "ลิงก์");
  XLSX.writeFile(wb, `fund_invite_links_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function modal(title, body, foot) {
  const el = document.createElement("div");
  el.className = "modal-overlay";
  el.innerHTML = `<div class="modal modal-lg"><div class="modal-header"><div class="modal-title">${title}</div>
    <button class="modal-close" data-x>✕</button></div><div class="modal-body">${body}</div>
    <div class="modal-footer">${foot}</div></div>`;
  document.getElementById("modalPortal").appendChild(el);
  el.querySelectorAll("[data-x]").forEach(b => b.onclick = () => el.remove());
  el.onclick = e => { if (e.target === el) el.remove(); };
  return el;
}

function wire() {
  const pg = document.getElementById("pageFundforms");
  pg.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; draw(); });
  pg.querySelector("#ffExport")?.addEventListener("click", () => exportExcel(tab));
  pg.querySelector("#ffLinks")?.addEventListener("click", exportLinks);
  pg.querySelector("#ffAdd")?.addEventListener("click", () => openInvite(null));
  const imp = pg.querySelector("#ffImport");
  if (imp) imp.onchange = () => { const f = imp.files[0]; imp.value = ""; if (f) importFile(f); };
  const keep = (id, fn) => { const s = pg.querySelector(id); if (s) s.oninput = () => { fn(s.value); const pos = s.selectionStart; draw();
    const n = document.querySelector(id); n.focus(); n.setSelectionRange(pos, pos); }; };
  keep("#ffSearch", v => search = v);
  keep("#ffISearch", v => iSearch = v);
  const st = pg.querySelector("#ffStatus"); if (st) st.onchange = () => { fStatus = st.value; draw(); };
  const lt = pg.querySelector("#ffLatest"); if (lt) lt.onchange = () => { onlyLatest = lt.checked; draw(); };
  const itf = pg.querySelector("#ffIFilter"); if (itf) itf.onchange = () => { iFilter = itf.value; draw(); };
  pg.querySelectorAll("[data-next]").forEach(b => b.onclick = async () => {
    const r = rows.find(x => x.id === +b.dataset.next), to = b.dataset.to;
    b.disabled = true; if (await setStatus(r, to)) { draw(); toast(`#${r.id} ${STATUS[to].th}`, "success"); } else b.disabled = false;
  });
  pg.querySelectorAll("[data-back]").forEach(b => b.onclick = async () => {
    const r = rows.find(x => x.id === +b.dataset.back);
    if (await sendBack(r)) { draw(); toast(`#${r.id} ยกเลิกแล้ว — พนักงานเปิดลิงก์เดิมแล้วแก้จากข้อมูลเดิมได้เลย`, "success"); }
  });
  pg.querySelectorAll("[data-view]").forEach(b => b.onclick = e => { e.preventDefault(); openDetail(+b.dataset.view); });
  pg.querySelectorAll("[data-print]").forEach(b => b.onclick = () => printSubmission(rows.find(r => r.id === +b.dataset.print)));
  pg.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => openInvite(invites.find(i => i.id === +b.dataset.edit)));
  pg.querySelectorAll("[data-copy]").forEach(b => b.onclick = async () => {
    const msg = inviteMessage(invites.find(i => i.id === +b.dataset.copy));
    try { await navigator.clipboard.writeText(msg); toast("คัดลอกแล้ว — วางใน LINE / อีเมลได้เลย", "success"); }
    catch { prompt("คัดลอกข้อความนี้", msg); }
  });
}

// ---------------------------------------------------------------- detail
function detailBody(r) {
  const p = r.payload || {}, kv = (k, v) => `<div style="display:flex;gap:12px;padding:6px 0;border-bottom:1px solid var(--border);">
    <div style="width:150px;flex:none;color:var(--muted);">${k}</div><div>${v}</div></div>`;
  if (r.form_type === "pvd") return [
    kv("เรื่องที่ขอ", esc(topic(r))),
    p.beneficiaries ? kv("ผู้รับผลประโยชน์", p.beneficiaries.map(b => `${esc(b.name)} (${esc(b.relation)}) ${b.percent}%`).join("<br>")) : "",
    p.rate ? kv("อัตราเงินสะสม", `${p.rate}%`) : "",
    p.policy ? kv("นโยบายการลงทุน", `${esc(PVD_POLICIES.find(x => x.key === p.policy)?.label)} (${esc(p.policy)})`) : "",
  ].join("");
  const a = p.addr || {}, tot = (p.beneficiaries || []).reduce((s, b) => s + (b.shares || 0), 0);
  return [
    kv("ผู้แสดงเจตนา", `${esc(p.title)} ${esc(r.emp_name)} · อายุ ${esc(p.age)} ปี · สัญชาติ${esc(p.nationality)}`),
    kv(p.is_thai === false ? "เลขหนังสือเดินทาง" : "เลขประจำตัวประชาชน", esc(p.is_thai === false ? p.passport : p.id_card)),
    kv("ที่อยู่", esc([a.no, a.moo && "ม." + a.moo, a.soi, a.road, a.subdistrict, a.district, a.province, a.zip].filter(Boolean).join(" "))),
    kv("โทรศัพท์", esc(p.phone)),
    kv("ผู้รับประโยชน์", (p.beneficiaries || []).map((b, i) => `${i + 1}. ${esc(b.name)} (${esc(b.relation)}) — ${tot ? `${b.shares}/${tot} ส่วน` : "ส่วนเท่ากัน"}
      <div class="text-muted" style="font-size:12px;">${esc(b.id_card)} · ${esc(b.address)}</div>`).join("")),
  ].join("");
}

function openDetail(id) {
  const r = rows.find(x => x.id === id); if (!r) return;
  const el = document.createElement("div");
  el.className = "modal-overlay"; el.id = "ffModal";
  el.innerHTML = `<div class="modal modal-lg">
    <div class="modal-header"><div class="modal-title">#${r.id} · ${esc(FORM_NAME[r.form_type])}</div>
      <button class="modal-close" data-x>✕</button></div>
    <div class="modal-body">
      <div style="margin-bottom:10px;"><b>${esc(r.emp_code)} ${esc(r.emp_name)}</b> · ${esc(r.department)}
        <div class="text-muted" style="font-size:12px;">ส่งเมื่อ ${dt(r.submitted_at)} · อัปเดต ${dt(r.updated_at)}</div></div>
      ${detailBody(r)}
      <div style="display:flex;gap:12px;padding:6px 0;border-bottom:1px solid var(--border);align-items:center;">
        <div style="width:150px;flex:none;color:var(--muted);">ลายเซ็นพนักงาน</div>
        <div>${/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(r.payload?.signature || "")
          ? `<img src="${r.payload.signature}" alt="" style="height:56px;border:1px solid var(--border);border-radius:6px;background:#fff;"> <span class="text-muted" style="font-size:12px;">เซ็นออนไลน์</span>`
          : `<span class="text-muted">ไม่ได้เซ็นออนไลน์ — ต้องเซ็นบนกระดาษ</span>`}</div></div>
      <div class="form-grid" style="margin-top:14px;">
        <div class="form-group"><label class="form-label">สถานะ</label>
          <select class="form-control" id="ffSt" ${canEdit() ? "" : "disabled"}>${Object.entries(STATUS).map(([k, v]) =>
            `<option value="${k}" ${r.status === k ? "selected" : ""}>${v.th}</option>`).join("")}</select></div>
        <div class="form-group"><label class="form-label">หมายเหตุ HR</label>
          <textarea class="form-control" id="ffNote" ${canEdit() ? "" : "disabled"}>${esc(r.hr_note)}</textarea></div>
      </div>
    </div>
    <div class="modal-footer">
      ${canEdit() ? `<button class="btn btn-danger" data-del style="margin-right:auto;">ลบ</button>` : ""}
      ${canEdit() && isLatest(r) && r.status !== "rejected" ? `<button class="btn btn-secondary" data-back style="color:var(--red);">ยกเลิก ให้พนักงานแก้ไข</button>` : ""}
      <button class="btn btn-secondary" data-print>พิมพ์ฟอร์ม</button>
      ${canEdit() ? `<button class="btn btn-secondary" data-save>บันทึก</button>` : ""}
      ${stepBtns(r, false)}
    </div></div>`;
  document.getElementById("modalPortal").appendChild(el);
  const close = () => el.remove();
  el.querySelector("[data-x]").onclick = close;
  el.onclick = e => { if (e.target === el) close(); };
  el.querySelector("[data-print]").onclick = () => printSubmission(r);
  el.querySelector("[data-save]")?.addEventListener("click", async () => {
    const upd = { status: el.querySelector("#ffSt").value, hr_note: el.querySelector("#ffNote").value.trim() || null,
                  updated_by: currentUser?.id || null };
    const { error } = await supabase.from("fund_form_submission").update(upd).eq("id", r.id);
    if (error) { toast("บันทึกไม่สำเร็จ: " + error.message, "error"); return; }
    Object.assign(r, upd, { updated_at: new Date().toISOString() }); close(); draw(); toast("บันทึกแล้ว", "success");
  });
  el.querySelectorAll("[data-next]").forEach(b => b.addEventListener("click", async () => {
    const to = b.dataset.to;
    if (await setStatus(r, to, el.querySelector("#ffNote").value.trim() || null)) { close(); draw(); toast(STATUS[to].th, "success"); }
  }));
  el.querySelector("[data-back]")?.addEventListener("click", async () => {
    if (await sendBack(r)) { close(); draw(); toast("ยกเลิกแล้ว — พนักงานเปิดลิงก์เดิมแล้วแก้จากข้อมูลเดิมได้เลย", "success"); }
  });
  el.querySelector("[data-del]")?.addEventListener("click", async () => {
    if (!confirm(`ลบคำขอ #${r.id} ของ ${r.emp_name}? ย้อนกลับไม่ได้ (ถ้าแค่ไม่ใช้แล้ว ให้เปลี่ยนสถานะเป็น "ยกเลิก" แทน)`)) return;
    const { error } = await supabase.from("fund_form_submission").delete().eq("id", r.id);
    if (error) { toast("ลบไม่สำเร็จ: " + error.message, "error"); return; }
    rows = rows.filter(x => x.id !== r.id); close(); draw(); toast("ลบแล้ว", "success");
  });
}

// ---------------------------------------------------------------- export
function exportExcel(type) {
  const list = latestOnly(rows.filter(r => r.form_type === type));
  if (!list.length) { toast("ยังไม่มีข้อมูลให้ export"); return; }
  const base = r => ({ "เลขที่คำขอ": r.id, "ส่งเมื่อ": dt(r.submitted_at), "รหัสพนักงาน": r.emp_code,
    "ชื่อ-สกุล": r.emp_name, "ฝ่าย/แผนก": r.department, "สถานะ": STATUS[r.status]?.th || r.status, "หมายเหตุ HR": r.hr_note || "" });
  let data;
  if (type === "pvd") data = list.map(r => { const p = r.payload || {}, o = base(r);
    o["เรื่องที่ขอ"] = topic(r); o["อัตราสะสม (%)"] = p.rate ?? ""; o["นโยบาย"] = p.policy ?? "";
    for (let i = 0; i < 3; i++) { const b = (p.beneficiaries || [])[i] || {};
      o[`ผู้รับ${i + 1} ชื่อ`] = b.name || ""; o[`ผู้รับ${i + 1} ความสัมพันธ์`] = b.relation || ""; o[`ผู้รับ${i + 1} ร้อยละ`] = b.percent ?? ""; }
    return o; });
  else data = list.map(r => { const p = r.payload || {}, a = p.addr || {}, o = base(r);
    Object.assign(o, { "คำนำหน้า": p.title, "อายุ": p.age, "สัญชาติ": p.nationality,
      "เลขบัตร/พาสปอร์ต": p.is_thai === false ? p.passport : p.id_card,
      "ที่อยู่": [a.no, a.moo && "ม." + a.moo, a.soi, a.road, a.subdistrict, a.district, a.province, a.zip].filter(Boolean).join(" "),
      "โทรศัพท์": p.phone, "จำนวนผู้รับ": (p.beneficiaries || []).length });
    const n = Math.max(...list.map(x => (x.payload?.beneficiaries || []).length), 1);
    for (let i = 0; i < n; i++) { const b = (p.beneficiaries || [])[i] || {};
      o[`ผู้รับ${i + 1} ชื่อ`] = b.name || ""; o[`ผู้รับ${i + 1} เกี่ยวข้อง`] = b.relation || "";
      o[`ผู้รับ${i + 1} เลขบัตร`] = b.id_card || ""; o[`ผู้รับ${i + 1} ที่อยู่`] = b.address || ""; o[`ผู้รับ${i + 1} ส่วน`] = b.shares ?? ""; }
    return o; });
  const ws = XLSX.utils.json_to_sheet(data);
  // เลขบัตร 13 หลักต้องเป็นข้อความ ไม่งั้น Excel ปัดเป็น 1.1E+12
  Object.keys(ws).forEach(k => { if (k[0] !== "!" && typeof ws[k].v === "string" && /^\d{13}$/.test(ws[k].v)) ws[k].t = "s"; });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, type === "pvd" ? "PVD" : "สกล5");
  XLSX.writeFile(wb, `fund_${type}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
