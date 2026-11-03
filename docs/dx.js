// ============================================================================
// ระบบสารบรรณและควบคุมเอกสาร HR (เว็บ /docs) — ต่อยอดจากสารบัญเอกสาร (2026-10-16) · user 2026-11-03
//   หน้า: #/my งานของฉัน · #/index ทะเบียน · #/issue สร้าง · #/receive รับ · #/approvals รออนุมัติ/ลงนาม ·
//         #/delivery ติดตามการส่ง/รับทราบ · #/archive คลัง · #/reports รายงาน · #/settings ตั้งค่า
//   เลขทุกเลขยังมาจาก doc_issue → doc_register (ทะเบียนเดิม) · ขั้นตอน ผู้รับผิดชอบ ไฟล์ฉบับจริง การส่ง/รับทราบ อายุเก็บ
//   เปลี่ยนผ่าน rpc dms_* (azure-app/dms.py) เท่านั้น — เซิร์ฟเวอร์ตรวจสิทธิ์และลำดับขั้นทุกครั้ง หน้านี้แค่ซ่อนปุ่มที่ทำไม่ได้
//   ห้าม import js/app.js
// ============================================================================
import { supabase } from "../js/supabase-config.js";
import { parseDocLog, nextNo, filterDocs, storageName } from "../js/doc-register-calc.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TH_M = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const thDate = iso => { if (!iso) return "—"; const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return `${d} ${TH_M[m - 1]} ${String(y + 543).slice(2)}`; };
const thTime = ts => ts ? new Date(ts).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }) : "";
const todayISO = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);     // วันที่ไทย
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
const kb = n => !n ? "" : n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;
const $ = s => document.querySelector(s);
const IC = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>', dl: '<svg viewBox="0 0 24 24"><path d="M12 15V3"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  inb: '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>', x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  clip: '<svg viewBox="0 0 24 24"><path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.95 8.83l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M16 16l-4-4-4 4M12 12v9"/><path d="M20.4 18.4A5 5 0 0 0 18 9h-1.3A8 8 0 1 0 3 16.3"/></svg>',
  pen: '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
};
const MAX_FILE = 20 * 1048576;
const LETTER_KIND = { "หนังสือรับรองการทำงาน (ภาษาไทย)": "cert_th", "หนังสือรับรองการทำงาน (ภาษาอังกฤษ)": "cert_en",
  "หนังสือรับรองเงินเดือน (ภาษาไทย)": "salary_th", "หนังสือรับรองเงินเดือน (ภาษาอังกฤษ)": "salary_en", "Offer Letter (จดหมายจ้างงาน)": "offer_en" };
const SRC_ST = { draft: ["ร่าง", "n", ""], pending: ["รออนุมัติ/ลงนาม", "w", "wait"], approved: ["อนุมัติแล้ว", "g", "ok"], signed: ["ลงนามครบแล้ว", "g", "ok"], rejected: ["ส่งกลับแก้ไข", "r", "no"], cancelled: ["ยกเลิก", "r", "no"] };
const SRC_NAME = { letter: ["ออกหนังสือ HR", "หนังสือ HR", x => `/?letter=${x}`], paf: ["Personnel Action Form", "PAF", x => `/?paf=${x}`], contract: ["สัญญาจ้างงาน", "สัญญาจ้าง", x => `/?econtract=${x}`] };
const CONTRACT_TYPE = "สัญญาจ้างงาน";

// ---- คำและสีสถานะ (ชุดเดียวทั้งระบบ — ตรงกับ azure-app/dms_core.py)
const STAGE = {
  reserved: ["จองเลขไว้", "s-res"], registered: ["ลงทะเบียนรับ", "s-new"], draft: ["ร่าง", "s-draft"], review: ["รอตรวจทาน", "s-wait"],
  approval: ["รออนุมัติ", "s-wait"], signing: ["รอลงนาม", "s-wait"], to_issue: ["รอออกฉบับจริง", "s-wait"], issued: ["ออกฉบับจริงแล้ว", "s-iss"],
  in_progress: ["กำลังดำเนินการ", "s-new"], closed: ["ปิดเรื่อง", "s-done"], archived: ["จัดเก็บแล้ว", "s-arc"], disposed: ["ทำลายแล้ว", "s-gone"],
  rejected: ["ไม่อนุมัติ", "s-bad"], cancelled: ["ยกเลิก", "s-bad"],
};
const FSTATE = { complete: ["ไฟล์ครบ", "f-ok"], need_draft: ["รอไฟล์ร่าง", "f-need"], need_signed: ["รอฉบับลงนาม/สแกน", "f-need"],
  need_received: ["รอสแกนฉบับรับ", "f-need"], not_required: ["ไม่ต้องแนบ", "f-na"], in_module: ["ฉบับอยู่ในระบบออกหนังสือ", "f-mod"],
  unknown: ["ข้อมูลเดิม · ยังไม่สำรวจ", "f-unk"], na: ["—", "f-na"] };
const ORIGIN = { system: "สร้างจากระบบ HR", manual: "ออกเลข/ลงทะเบียนเอง", import: "นำเข้าจาก Excel เดิม" };
const SENS = { general: "ทั่วไป", personal: "ข้อมูลส่วนบุคคล", confidential: "ลับ", salary: "ลับ · เงินเดือน", discipline: "ลับ · วินัย", health: "ลับ · สุขภาพ" };
const SENS_CAT = { salary: "doc.cat.salary", discipline: "doc.cat.discipline", health: "doc.cat.health" };
const PRIO = { normal: "ปกติ", urgent: "ด่วน", very_urgent: "ด่วนมาก" };
const FKIND = { draft: "ไฟล์ร่าง", signed: "ฉบับลงนาม/ฉบับจริง", received: "ฉบับที่ได้รับ", attachment: "เอกสารประกอบ", evidence: "หลักฐานส่ง/รับทราบ" };
const SIGNM = { wet_ink: "ลงนามด้วยมือบนกระดาษ (แนบสแกนฉบับลงนาม)", external: "ลงนามโดยหน่วยงาน/ผู้ลงนามภายนอกแล้ว",
  esign: "ลายมือชื่ออิเล็กทรอนิกส์จากระบบที่ตรวจสอบได้ (ระบุระบบ)", image: "ภาพลายเซ็นจากระบบ HR (ไม่ใช่ลายมือชื่ออิเล็กทรอนิกส์ที่ตรวจสอบได้)" };
const CHAN = { hand: "ส่งมอบด้วยตนเอง", email: "อีเมล", post: "ไปรษณีย์", internal: "ส่งภายใน", other: "อื่น ๆ" };
const ACKM = { signature: "ลงชื่อรับบนสำเนา", email_reply: "ตอบรับทางอีเมล", witness: "มีพยานยืนยัน", system: "ยืนยันในระบบ", refused: "ปฏิเสธการรับ" };
const LINKK = { related: "เกี่ยวข้อง", reply_to: "ตอบ/อ้างถึง", attachment_of: "เป็นเอกสารประกอบของ", supersedes: "แทนที่" };
const ACT_LABEL = { submit: "ส่งต่อ", review_ok: "ผ่านการตรวจทาน", approve: "อนุมัติ", sign: "บันทึกการลงนาม", return: "ส่งกลับแก้ไข", reject: "ไม่อนุมัติ",
  issue: "ออกฉบับจริง", register_official: "ลงทะเบียนฉบับจริง (ลงนามแล้ว)", accept: "รับเรื่อง", use_reserved: "ใช้เลขที่จอง", close: "ปิดเรื่อง",
  archive: "จัดเก็บ", reopen: "เปิดเรื่องใหม่", cancel: "ยกเลิกเรื่อง/เลข" };
const ACT_PRIMARY = ["submit", "review_ok", "approve", "sign", "issue", "accept", "close", "archive", "use_reserved"];
const EV_LABEL = { migrate: "เริ่มติดตามในระบบสารบรรณ", update: "แก้ข้อมูลเรื่อง", people: "แก้ผู้เกี่ยวข้อง", file_kind: "ระบุชนิดไฟล์",
  supersede_file: "แทนที่ฉบับจริง", superseded: "ถูกแทนที่ด้วยฉบับแก้ไข", revision_of: "สร้างเป็นฉบับแก้ไข", link: "เชื่อมโยงเอกสาร", unlink: "ลบการเชื่อมโยง",
  delegate: "มอบหมายแทน", deliver: "บันทึกการส่ง", ack: "บันทึกรับทราบ", deliver_cancel: "ยกเลิกรายการส่ง", hold: "ระงับทำลาย", unhold: "ปลดการระงับ",
  dispose_propose: "เสนอทำลาย", register_contract: "ออกเลขให้สัญญาจ้าง", from_movement: "ลงรับจาก Staff Movement", dispose: "ทำลาย", edit: "แก้ทะเบียน", void: "ยกเลิกเลข", export: "Export", retention_save: "บันทึกนโยบายอายุเก็บ",
  rule_save: "ตั้งค่าขั้นตอนตามประเภท", dispose_decide: "พิจารณารายการทำลาย", ...ACT_LABEL };

const S = { user: null, perms: new Set(), series: [], types: [], rows: [], files: new Map(), sources: new Map(), emps: [], ov: new Map(),
  next: {}, me: null, f: { year: String(new Date().getFullYear()) }, bucket: "mine" };
const can = k => S.perms.has(k) || (S.perms.has("doc.manage") && k.startsWith("doc.") && !k.startsWith("doc.cat.")), canWrite = () => can("data.docregister.write");
const q = async p => { const { data, error } = await p; if (error) throw error; return data; };
const rpc = async (fn, args) => { const { data, error } = await supabase.rpc(fn, args); if (error) throw error; return data; };
const dirOf = code => S.series.find(s => s.code === code)?.direction || "out";
const prefixOf = code => S.series.find(s => s.code === code)?.prefix || code;
function toast(msg, type = "") { const el = document.createElement("div"); el.className = "toast " + type; el.textContent = msg; $("#spToasts").appendChild(el); setTimeout(() => el.remove(), 5000); }
const fail = (e, w = "ไม่สำเร็จ") => toast(`${w}: ${String(e?.message || e)}`, "err");
function modal(title, body, foot, wide) {
  const el = document.createElement("div"); el.className = "mo";
  el.innerHTML = `<div class="mo-c" ${wide ? 'style="max-width:860px"' : ""}><div class="mo-h">${title}<button class="btn btn-g btn-sm" data-x>✕</button></div><div class="mo-b">${body}</div><div class="mo-f">${foot}</div></div>`;
  $("#spModal").appendChild(el); el.querySelectorAll("[data-x]").forEach(b => b.onclick = () => el.remove()); el.onclick = e => { if (e.target === el) el.remove(); };
  return el;
}
async function fetchAll(f) { const out = []; for (let i = 0; ; i += 1000) { const d = await q(f().range(i, i + 999)); out.push(...d); if (d.length < 1000) break; } return out; }
async function copy(text) { try { await navigator.clipboard.writeText(text); toast(`คัดลอก ${text} แล้ว`, "ok"); } catch { prompt("คัดลอกเลขที่", text); } }
const pill = (map, k, extra = "") => { const [t, c] = map[k] || [k || "—", "f-na"]; return `<span class="bd ${c}${extra}">${esc(t)}</span>`; };
const O = id => S.ov.get(id) || {};

// ---------------------------------------------------------------- เริ่มต้น
async function boot() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { $("#spMain").innerHTML = `<div class="card card-b" style="max-width:460px;margin:60px auto;text-align:center"><div class="card-t" style="justify-content:center">กรุณาเข้าสู่ระบบ</div><p class="sp-sub" style="margin-bottom:16px">ใช้บัญชีเดียวกับระบบ HR</p><a class="btn btn-p" href="/">ไปหน้าเข้าสู่ระบบ HR</a></div>`; return; }
  S.user = session.user;
  const { data: perms } = await supabase.rpc("my_permissions");
  S.perms = new Set((perms || []).map(p => typeof p === "string" ? p : p.perm_key || p.key));
  const name = S.user.user_metadata?.full_name || S.user.email || "";
  const role = [canWrite() ? "HR · ออกเลขได้" : "ดูอย่างเดียว", can("doc.approve") && "อนุมัติ", can("doc.sign") && "ลงนาม", can("data.doc.confidential") && "ดูเอกสารลับ"].filter(Boolean).join(" · ");
  $("#spUser").innerHTML = `<div class="sp-av">${esc(name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase())}</div><div><b>${esc(name)}</b><span>${esc(role)}</span></div>`;
  if (!can("page.docregister")) { $("#spMain").innerHTML = `<div class="empty">บัญชีนี้ยังไม่มีสิทธิ์ใช้ระบบสารบรรณ — ให้ Admin เพิ่มสิทธิ์ “ทะเบียนเลขที่เอกสาร” ที่ User Management</div>`; return; }
  try { await loadAll(); } catch (e) { $("#spMain").innerHTML = `<div class="card card-b"><b>โหลดข้อมูลไม่สำเร็จ</b><p class="sp-sub">${esc(e.message)}</p></div>`; return; }
  document.querySelectorAll("#spNav a[data-p]").forEach(a => { if (!can(a.dataset.p)) a.style.display = "none"; });
  window.addEventListener("hashchange", route); route();
}
async function loadAll() {
  const [s, t, r, f, src, ov] = await Promise.all([q(supabase.from("doc_series").select("*").order("sort_order")), q(supabase.from("doc_types").select("*").order("sort_order")),
    fetchAll(() => supabase.from("doc_register").select("*").order("year", { ascending: false }).order("seq", { ascending: false })),
    fetchAll(() => supabase.from("doc_files").select("doc_id")), supabase.rpc("doc_sources"), supabase.rpc("dms_overview")]);
  S.series = s; S.types = t; S.rows = r;
  S.files = new Map(); for (const x of f) S.files.set(x.doc_id, (S.files.get(x.doc_id) || 0) + 1);
  S.sources = new Map((src.data || []).map(x => [x.doc_id, x]));
  if (ov.error) {   // ระบบสารบรรณใช้ไม่ได้ชั่วคราว → ยังเปิดทะเบียนเลขได้เหมือนเดิม (ไม่มีขั้นตอน/ผู้รับผิดชอบ)
    S.ov = new Map(); S.dmsDown = ov.error.message || String(ov.error);
    toast(`ข้อมูลขั้นตอนโหลดไม่ได้ — แสดงทะเบียนอย่างเดียว (${S.dmsDown})`, "err");
    return;
  }
  S.dmsDown = null;
  S.ov = new Map(ov.data.docs.map(x => [x.id, x])); S.next = ov.data.next_numbers || {}; S.me = ov.data.me; S.today = ov.data.today;
  for (const p of ov.data.perms || []) S.perms.add(p);
  S.rows = S.rows.filter(x => S.ov.has(x.id));             // เซิร์ฟเวอร์ตัดเรื่องหมวดลับที่ไม่มีสิทธิ์ออกแล้ว — ใช้ชุดเดียวกัน
  const mine = bucket("mine").length;
  $("#navMine").textContent = mine ? String(mine) : "";
  $("#navWait").textContent = String(S.rows.filter(x => ["review", "approval", "signing"].includes(O(x.id).stage)).length || "");
}
async function refreshOne(id) {
  try { const ov = await rpc("dms_overview"); S.ov = new Map(ov.docs.map(x => [x.id, x])); S.next = ov.next_numbers || S.next; } catch {}
  const { data } = await supabase.from("doc_register").select("*").eq("id", id).maybeSingle();
  if (data) { const i = S.rows.findIndex(x => x.id === id); if (i >= 0) S.rows[i] = data; else S.rows.unshift(data); }
}
async function loadEmps() {
  if (S.emps.length) return;
  const { data } = await supabase.from("employees").select("emp_code,firstname_th,lastname_th,firstname_en,lastname_en,department").order("emp_code").limit(5000);
  S.emps = (data || []).filter(e => e.emp_code);
}
const empName = e => [e.firstname_th, e.lastname_th].filter(Boolean).join(" ") || [e.firstname_en, e.lastname_en].filter(Boolean).join(" ");
const empList = () => `<datalist id="dxEmps">${S.emps.map(e => `<option value="${esc(e.emp_code)} · ${esc(empName(e))}">`).join("")}</datalist>`;
function personOf(text) {
  const t = String(text || "").trim(); if (!t) return {};
  const code = t.split(/\s*·\s*|\s+/)[0], e = S.emps.find(x => x.emp_code === code);
  return e ? { emp_code: e.emp_code, person_name: empName(e) } : { person_name: t };
}
const PAGES = { my: renderMy, index: renderIndex, approvals: renderApprovals, delivery: renderDelivery, archive: renderArchive, reports: renderReports, settings: renderSettings };
function route() {
  document.querySelectorAll(".dw,.mo").forEach(x => x.remove());
  let page = location.hash.replace(/^#\/?/, "").split("/")[0] || "my";
  if (page === "nofile") { S.f.fs = "need"; page = "index"; history.replaceState(null, "", "#/index"); }
  document.querySelectorAll("#spNav a").forEach(a => a.classList.toggle("on", a.dataset.r === page));
  if (page === "issue" || page === "receive") {
    (PAGES[S.last] || renderMy)();
    history.replaceState(null, "", `#/${S.last || "my"}`);
    document.querySelectorAll("#spNav a").forEach(a => a.classList.toggle("on", a.dataset.r === (S.last || "my")));
    if (!canWrite()) return toast("ไม่มีสิทธิ์ออกเลข/ลงรับ", "err");
    return page === "issue" ? issueForm() : receiveForm();
  }
  S.last = PAGES[page] ? page : "my";
  (PAGES[page] || renderMy)();
}
const rerender = () => (PAGES[S.last] || renderMy)();
const head = (t, s, a = "") => `<div class="sp-head"><div class="t"><div class="sp-title">${t}</div><div class="sp-sub">${s}</div></div>${a}</div>`;

// ---------------------------------------------------------------- ตาราง (ใช้ทุกหน้า)
function stageCell(r) {
  const o = O(r.id);
  return `${pill(STAGE, o.stage)}${o.returned && o.stage === "draft" ? ` <span class="bd r">ส่งกลับแก้ไข</span>` : ""}${o.hold ? ` <span class="bd p">ระงับ</span>` : ""}
    <div class="sub">${esc(ORIGIN[o.origin] || "")}${S.sources.get(r.id) ? ` · ${SRC_NAME[S.sources.get(r.id).kind]?.[1] || ""}` : ""}</div>`;
}
function ownerCell(r) {
  const o = O(r.id), t = (o.tasks || [])[0];
  const who = t ? `${{ review: "ตรวจ", approve: "อนุมัติ", sign: "ลงนาม" }[t.kind] || ""}: ${t.assignee_name || "ผู้มีสิทธิ์"}` : o.owner_name || "";
  const due = o.due_date ? `<span class="${o.overdue ? "due-late" : "due"}">${o.overdue ? "เกินกำหนด " : "กำหนด "}${thDate(o.due_date)}</span>` : "";
  return who || due ? `<div class="own">${esc(who || "—")}</div>${due}` : `<span class="muted">—</span>`;
}
function docTable(list, empty = "ไม่มีรายการ", limit = 500) {
  if (!list.length) return `<div class="empty">${empty}</div>`;
  return `<table class="tbl dx"><thead><tr><th>เลขที่ · วันที่</th><th>เรื่อง / ผู้เกี่ยวข้อง</th><th>ผู้รับผิดชอบ · กำหนด</th><th>สถานะ</th><th>ไฟล์</th></tr></thead><tbody>
    ${list.slice(0, limit).map(r => { const o = O(r.id), inn = dirOf(r.series_code) === "in", n = S.files.get(r.id) || 0;
      return `<tr class="click${r.status === "void" ? " void" : ""}" data-id="${r.id}">
        <td data-l="เลขที่"><span class="no"><b>${esc(r.doc_no)}</b>${r.confidential ? IC.lock : ""}</span><div class="sub">${thDate(r.issued_date)} · ${inn ? "รับเข้า" : "ส่งออก"}</div></td>
        <td data-l="เรื่อง"><div class="subj">${esc(r.status === "void" ? `ยกเลิก${r.void_reason ? ": " + r.void_reason : ""}` : r.subject || r.type_label || "—")}</div>
          <div class="sub">${esc([r.subject && r.type_label !== r.subject ? r.type_label : "", inn ? (r.sender ? "จาก " + r.sender : "") : [r.person_name, r.emp_code].filter(Boolean).join(" · ")].filter(Boolean).join(" · "))}</div></td>
        <td data-l="ผู้รับผิดชอบ">${ownerCell(r)}</td>
        <td data-l="สถานะ">${stageCell(r)}</td>
        <td data-l="ไฟล์">${o.file_state === "na" ? `<span class="muted">—</span>` : pill(FSTATE, o.file_state)}${n ? `<div class="sub fc">${IC.clip}${n}</div>` : ""}</td></tr>`; }).join("")}</tbody></table>
    ${list.length > limit ? `<div class="hint" style="padding:12px 16px;border-top:1px solid var(--line)">แสดง ${limit} จาก ${list.length} รายการ — ใช้ตัวกรองให้แคบลง</div>` : ""}`;
}
function wireRows(root = document) { root.querySelectorAll("tr[data-id]").forEach(tr => tr.onclick = () => openDoc(S.rows.find(r => r.id === +tr.dataset.id))); }

// ---------------------------------------------------------------- งานของฉัน
function myTaskHere(o) {
  return (o.tasks || []).some(t => t.assignee_id ? t.assignee_id === S.me : ({ review: "doc.review", approve: "doc.approve", sign: "doc.sign" }[t.kind] && can({ review: "doc.review", approve: "doc.approve", sign: "doc.sign" }[t.kind])));
}
function bucket(k) {
  const open = ["reserved", "registered", "draft", "review", "approval", "signing", "to_issue", "issued", "in_progress"];
  const soon = addDays(S.today || todayISO(), 90);
  const f = {
    mine: (r, o) => myTaskHere(o) || (o.owner_id === S.me && open.includes(o.stage))
      || (!(o.tasks || []).length && ((o.stage === "review" && can("doc.review")) || (o.stage === "approval" && can("doc.approve")) || (o.stage === "signing" && can("doc.sign")))),
    overdue: (r, o) => o.overdue,
    sign: (r, o) => o.stage === "signing" || o.stage === "approval",
    official: (r, o) => o.stage === "to_issue" || (o.stage === "issued" && ["need_signed"].includes(o.file_state)),
    ack: (r, o) => o.delivery === "wait_ack" || (o.stage === "issued" && o.delivery === "none" && !o.legacy),
    retention: (r, o) => o.retention_until && o.retention_until <= soon && !["disposed"].includes(o.stage),
  }[k];
  return S.rows.filter(r => r.status !== "void" || k === "retention").filter(r => f(r, O(r.id)));
}
function renderMy() {
  const tiles = [["mine", "รอฉันดำเนินการ", "งานที่มอบหมายให้ฉัน / เรื่องที่ฉันรับผิดชอบ"], ["overdue", "เกินกำหนด", "เลยวันกำหนดเสร็จแล้ว"],
    ["sign", "รออนุมัติ / ลงนาม", "อยู่ระหว่างผู้มีอำนาจพิจารณา"], ["official", "รอฉบับจริง", "ลงนามแล้วรอออก หรือรอสแกนฉบับลงนาม"],
    ["ack", "รอส่ง / รับทราบ", "ออกแล้วยังไม่ส่ง หรือรอหลักฐานรับทราบ"], ...(can("doc.retention") ? [["retention", "ใกล้ครบอายุเก็บ", "ภายใน 90 วัน (นโยบายที่เปิดใช้)"]] : [])];
  const cnt = Object.fromEntries(tiles.map(([k]) => [k, bucket(k)]));
  const list = cnt[S.bucket] || cnt.mine;
  $("#spMain").innerHTML = head("งานของฉัน", `สวัสดี ${esc(S.user.user_metadata?.full_name || S.user.email || "")} · รายการที่ต้องดำเนินการ เรียงตามกำหนดเสร็จ`,
      canWrite() ? `<button class="btn btn-s" data-go="receive">${IC.inb}รับเอกสาร</button><button class="btn btn-p" data-go="issue">${IC.plus}สร้างเอกสาร</button>` : "") + `
    <div class="wk-tiles">${tiles.map(([k, l, m]) => `<button class="wk${S.bucket === k ? " on" : ""}${k === "overdue" && cnt[k].length ? " alert" : ""}" data-b="${k}">
      <span class="l">${l}</span><span class="v">${cnt[k].length}</span><span class="m">${m}</span></button>`).join("")}</div>
    <div class="card"><div class="dch"><b>${esc(tiles.find(t => t[0] === S.bucket)?.[1] || "")}</b><span class="hint">${list.length} รายการ</span></div>
      <div class="tbl-wrap">${docTable([...list].sort((a, b) => (O(a.id).due_date || "9999").localeCompare(O(b.id).due_date || "9999")), "ไม่มีรายการ — เยี่ยมมาก")}</div></div>`;
  document.querySelectorAll("[data-b]").forEach(b => b.onclick = () => { S.bucket = b.dataset.b; renderMy(); });
  document.querySelectorAll("[data-go]").forEach(b => b.onclick = () => (b.dataset.go === "issue" ? issueForm() : receiveForm()));
  wireRows();
}

// ---------------------------------------------------------------- ทะเบียนเอกสาร
const STAGE_GROUP = { open: ["reserved", "registered", "draft", "in_progress"], wait: ["review", "approval", "signing", "to_issue"], issued: ["issued"],
  done: ["closed", "archived"], gone: ["disposed", "cancelled", "rejected"] };
function filtered() {
  let list = filterDocs(S.rows, S.f, dirOf, S.files);
  if (S.f.stage) list = list.filter(r => STAGE_GROUP[S.f.stage]?.includes(O(r.id).stage));
  if (S.f.fs === "need") list = list.filter(r => /^need_/.test(O(r.id).file_state));
  else if (S.f.fs) list = list.filter(r => O(r.id).file_state === S.f.fs);
  if (S.f.mine) list = list.filter(r => O(r.id).owner_id === S.me || myTaskHere(O(r.id)));
  return list;
}
function renderIndex() {
  const y = new Date().getFullYear(), list = filtered();
  const years = [...new Set([y, ...S.rows.map(r => r.year)])].sort((a, b) => b - a);
  const types = [...new Set(S.rows.filter(r => !S.f.series || r.series_code === S.f.series).map(r => r.type_label).filter(Boolean))].sort();
  const sel = (k, opts, all) => `<select class="in" data-f="${k}"><option value="">${all}</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(S.f[k] || "") === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  $("#spMain").innerHTML = head("ทะเบียนเอกสาร", `เลขถัดไป ${Object.entries(S.next).map(([c, n]) => `${dirOf(c) === "in" ? "รับ " : ""}${esc(n)}`).join(" · ")}`,
    `${can("doc.export") ? `<button class="btn btn-s" id="dxExport">${IC.dl}Export Excel</button>` : ""}${canWrite() ? `<button class="btn btn-s" data-go="receive">${IC.inb}รับเอกสาร</button><button class="btn btn-p" data-go="issue">${IC.plus}สร้างเอกสาร</button>` : ""}`) + `
    <div class="filters">
      <label class="fld" style="flex:1;min-width:220px"><span>ค้นหา</span><input class="in" id="dxQ" placeholder="เลขที่ / ชื่อ / เรื่อง / รหัสพนักงาน / ผู้ส่ง" value="${esc(S.f.q || "")}"></label>
      <label class="fld"><span>ทิศทาง</span>${sel("dir", [["out", "ส่งออก"], ["in", "รับเข้า"]], "ทั้งหมด")}</label>
      <label class="fld"><span>ชุดเลข</span>${sel("series", S.series.map(s => [s.code, s.label]), "ทุกชุด")}</label>
      <label class="fld"><span>ประเภท</span>${sel("type", types.map(t => [t, t]), "ทุกประเภท")}</label>
      <label class="fld"><span>สถานะ</span>${sel("stage", [["open", "ร่าง / กำลังดำเนินการ"], ["wait", "รอตรวจ/อนุมัติ/ลงนาม/ออก"], ["issued", "ออกฉบับจริงแล้ว"], ["done", "ปิด / จัดเก็บ"], ["gone", "ยกเลิก / ไม่อนุมัติ / ทำลาย"]], "ทุกสถานะ")}</label>
      <label class="fld"><span>ไฟล์</span>${sel("fs", [["need", "ยังไม่ครบ (ต้องแนบ)"], ["complete", "ไฟล์ครบ"], ["in_module", "ฉบับอยู่ในระบบออกหนังสือ"], ["unknown", "ข้อมูลเดิม · ยังไม่สำรวจ"], ["not_required", "ไม่ต้องแนบ"]], "ทั้งหมด")}</label>
      <label class="fld"><span>ปี</span>${sel("year", years.map(v => [v, `${v + 543}`]), "ทุกปี")}</label>
      <label class="chk"><input type="checkbox" id="dxMine" ${S.f.mine ? "checked" : ""}> ของฉัน</label>
      <label class="chk"><input type="checkbox" id="dxVoid" ${S.f.voided ? "checked" : ""}> แสดงเลขที่ยกเลิก</label></div>
    <div class="card"><div class="tbl-wrap">${docTable(list, S.rows.length ? "ไม่มีรายการตามตัวกรอง" : "ยังไม่มีเลขในทะเบียน — นำเข้าประวัติจาก Excel เดิมได้ที่หน้าตั้งค่า")}</div>
      <div class="hint" style="padding:10px 16px;border-top:1px solid var(--line)">${list.length} รายการ · กดแถวเพื่อดูขั้นตอน ไฟล์ การส่ง และประวัติ</div></div>`;
  const qi = $("#dxQ"); qi.oninput = () => { S.f.q = qi.value; const p = qi.selectionStart; renderIndex(); const n = $("#dxQ"); n.focus(); n.setSelectionRange(p, p); };
  document.querySelectorAll("[data-f]").forEach(s => s.onchange = () => { S.f[s.dataset.f] = s.value; if (s.dataset.f === "series") S.f.type = ""; renderIndex(); });
  $("#dxVoid").onchange = e => { S.f.voided = e.target.checked; renderIndex(); };
  $("#dxMine").onchange = e => { S.f.mine = e.target.checked; renderIndex(); };
  $("#dxExport")?.addEventListener("click", () => exportExcel(list));
  document.querySelectorAll("[data-go]").forEach(b => b.onclick = () => (b.dataset.go === "issue" ? issueForm() : receiveForm()));
  wireRows();
}

// ---------------------------------------------------------------- รออนุมัติ/ลงนาม · ติดตามการส่ง · คลัง
function section(title, sub, list, empty) {
  return `<div class="card" style="margin-bottom:16px"><div class="dch"><b>${title}</b><span class="hint">${sub ? sub + " · " : ""}${list.length} รายการ</span></div><div class="tbl-wrap">${docTable(list, empty)}</div></div>`;
}
function renderApprovals() {
  const at = st => S.rows.filter(r => O(r.id).stage === st);
  $("#spMain").innerHTML = head("รออนุมัติและลงนาม", "อนุมัติแล้ว ≠ ลงนามแล้ว ≠ ออกฉบับจริงแล้ว — แต่ละขั้นมีผู้ดำเนินการและหลักฐานของตัวเอง") +
    section("รอตรวจทาน", "ผู้มีสิทธิ์ตรวจทาน", at("review"), "ไม่มี") + section("รออนุมัติ", "ผู้มีสิทธิ์อนุมัติ", at("approval"), "ไม่มี") +
    section("รอลงนาม", "บันทึกการลงนาม + แนบฉบับลงนาม", at("signing"), "ไม่มี") + section("รอออกฉบับจริง", "เลือกไฟล์ฉบับจริงแล้วกดออก", at("to_issue"), "ไม่มี") +
    section("ส่งกลับแก้ไข", "รอผู้รับผิดชอบแก้แล้วส่งใหม่", S.rows.filter(r => O(r.id).stage === "draft" && O(r.id).returned), "ไม่มี");
  wireRows();
}
function renderDelivery() {
  const iss = S.rows.filter(r => O(r.id).stage === "issued");
  $("#spMain").innerHTML = head("ติดตามการส่งและรับทราบ", "บันทึกว่าส่งให้ใคร ทางไหน และหลักฐานรับทราบ (สำเนาลงชื่อรับ อีเมลตอบรับ ฯลฯ)") +
    section("ยังไม่ได้บันทึกการส่ง", "เรื่องเก่าที่อนุมานสถานะไม่แสดงที่นี่", iss.filter(r => O(r.id).delivery === "none" && !O(r.id).legacy), "ไม่มี") +
    section("ส่งแล้ว · รอรับทราบ", "", S.rows.filter(r => O(r.id).delivery === "wait_ack"), "ไม่มี") +
    section("ส่ง/รับทราบครบ · รอปิดเรื่อง", "", iss.filter(r => ["sent", "acked", "na"].includes(O(r.id).delivery) && !O(r.id).legacy), "ไม่มี");
  wireRows();
}
function renderArchive() {
  const pick = sts => S.rows.filter(r => sts.includes(O(r.id).stage));
  $("#spMain").innerHTML = head("คลังเอกสาร", "เรื่องที่ปิดแล้ว ที่เก็บต้นฉบับ อายุเก็บ และการระงับทำลาย") +
    section("ระงับทำลาย", "ห้ามทำลายจนกว่าจะปลดการระงับ", S.rows.filter(r => O(r.id).hold), "ไม่มี") +
    section("ปิดเรื่องแล้ว · รอจัดเก็บ", "ระบุที่เก็บต้นฉบับแล้วกดจัดเก็บ", pick(["closed"]), "ไม่มี") +
    section("จัดเก็บแล้ว", "", pick(["archived"]), "ไม่มี") + section("ทำลายแล้ว", "เลขยังอยู่ในทะเบียนเป็นหลักฐาน", pick(["disposed"]), "ไม่มี");
  wireRows();
}

// ---------------------------------------------------------------- รายละเอียดเรื่อง (แผงขวา · แท็บ)
async function openDoc(r) {
  if (!r) return;
  document.querySelectorAll(".dw").forEach(x => x.remove());
  const el = document.createElement("div"); el.className = "dw"; $("#spModal").appendChild(el);
  el.onclick = e => { if (e.target === el) el.remove(); };
  el.innerHTML = `<div class="dw-c dx-dw"><div class="sp-loading">กำลังโหลด…</div></div>`;
  let d, log = [], tab = S.tab || "main";
  const load = async () => {
    [d, log] = await Promise.all([rpc("dms_doc", { p_doc_id: r.id }),
      q(supabase.from("doc_access_log").select("*").eq("doc_id", r.id).order("at", { ascending: false }).limit(50)).catch(() => [])]);
    S.files.set(r.id, d.files.length);
  };
  const after = async res => { if (res && res.meta) d = { ...d, ...res }; await refreshOne(r.id); r = S.rows.find(x => x.id === r.id) || r; await load(); draw(); rerender(); };
  const run = async (fn, args, okMsg) => { try { const res = await rpc(fn, args); toast(okMsg || "บันทึกแล้ว", "ok"); await after(res); return res; } catch (e) { fail(e); } };
  const draw = () => {
    const m = d.meta, inn = dirOf(r.series_code) === "in", w = d.can.edit && !["disposed", "cancelled"].includes(m.stage);
    const tabs = [["main", "ภาพรวม"], ["files", `ไฟล์และรุ่น (${d.files.length})`], ["deliver", `ส่ง/รับทราบ (${d.deliveries.filter(x => x.status !== "cancelled").length})`],
      ["links", `เชื่อมโยง (${d.links.length})`], ["hist", "ประวัติ"], ["store", "จัดเก็บ/อายุเก็บ"]];
    el.innerHTML = `<div class="dw-c dx-dw"><div class="dw-h"><div class="t"><b style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${esc(r.doc_no)}
        ${pill(STAGE, m.stage)}${m.returned && m.stage === "draft" ? `<span class="bd r">ส่งกลับแก้ไข</span>` : ""}${m.hold ? `<span class="bd p">ระงับทำลาย</span>` : ""}
        ${m.sensitivity && m.sensitivity !== "general" ? `<span class="bd w">${esc(SENS[m.sensitivity] || "")}</span>` : r.confidential ? `<span class="bd w">เอกสารลับ</span>` : ""}</b>
        <span>${esc(r.type_label || "")} · ${inn ? "ลงรับ" : "ออกเลข"} ${thDate(r.issued_date)} · ${esc(ORIGIN[m.origin] || "")}${m.legacy ? " · สถานะอนุมานจากข้อมูลเดิม" : ""}</span></div>
        <button class="btn btn-g btn-sm" data-x>${IC.x}</button></div>
      <div class="dx-tabs">${tabs.map(([k, l]) => `<button class="${tab === k ? "on" : ""}" data-tab="${k}">${l}</button>`).join("")}</div>
      <div class="dw-b">${{ main: tMain, files: tFiles, deliver: tDeliver, links: tLinks, hist: tHist, store: tStore }[tab](m, inn, w)}</div>
      <div class="dw-f">${actionBar(m)}</div></div>`;
    el.querySelectorAll("[data-x]").forEach(b => b.onclick = () => el.remove());
    el.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tab = S.tab = b.dataset.tab; draw(); });
    el.querySelectorAll("[data-act]").forEach(b => b.onclick = () => actDialog(r, d, b.dataset.act, run));
    wireTab(m, inn, w);
  };
  // ---- ภาพรวม
  const stepper = m => {
    const rule = d.rule, done = s => m[s];
    const steps = rule.flow === "in"
      ? [["registered", "ลงทะเบียนรับ", true], ["in_progress", "ดำเนินการ", ["in_progress", "closed", "archived"].includes(m.stage)], ["closed", "ปิดเรื่อง", ["closed", "archived"].includes(m.stage)], ["archived", "จัดเก็บ", m.stage === "archived"]]
      : [["draft", "ร่าง", m.stage !== "reserved"], ...(rule.need_review ? [["review", "ตรวจทาน", !["reserved", "draft", "review"].includes(m.stage)]] : []),
         ...(rule.need_approval ? [["approval", "อนุมัติ", !!done("approved_at")]] : []), ...(rule.need_sign ? [["signing", "ลงนาม", !!done("signed_at")]] : []),
         ["issued", "ออกฉบับจริง", ["issued", "closed", "archived"].includes(m.stage)], ...(rule.need_delivery ? [["deliver", "ส่งมอบ", d.delivery !== "none" && d.delivery !== "na"]] : []),
         ...(rule.need_ack ? [["ack", "รับทราบ", d.delivery === "acked"]] : []), ["closed", "ปิดเรื่อง", ["closed", "archived"].includes(m.stage)], ["archived", "จัดเก็บ", m.stage === "archived"]];
    const cur = steps.findIndex(s => !s[2]);
    return `<ol class="stepper">${steps.map(([k, l, ok], i) => `<li class="${ok ? "done" : i === cur && !["cancelled", "rejected", "disposed"].includes(m.stage) ? "cur" : ""}"><i>${ok ? IC.check : i + 1}</i><span>${l}</span></li>`).join("")}</ol>`;
  };
  const tMain = (m, inn, w) => {
    const src = d.source, kv = (k, v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : "";
    return `${["cancelled", "rejected", "disposed"].includes(m.stage) ? `<div class="note r">${esc(STAGE[m.stage][0])}${r.void_reason ? ": " + esc(r.void_reason) : ""} — เลขนี้ไม่ถูกนำกลับมาใช้</div>` : ""}
      ${m.superseded_by ? `<div class="note">มีฉบับแก้ไขแทนแล้ว — ดูแท็บเชื่อมโยง</div>` : ""}
      ${stepper(m)}
      ${d.next ? `<div class="next"><span>ต้องทำต่อ</span><b>${esc(d.next)}</b>${d.blockers.length && ["issued", "in_progress"].includes(m.stage) ? `<em>ก่อนปิดเรื่อง: ${esc(d.blockers.join(" · "))}</em>` : ""}</div>` : ""}
      <div class="sec"><div class="h"><span>ข้อมูลเรื่อง</span>${w ? `<button class="btn btn-g btn-sm" data-meta>${IC.pen}แก้ไข</button>` : ""}</div><dl class="kv">
        ${kv("ผู้รับผิดชอบ", esc(m.owner_name || "—"))}${kv("กำหนดเสร็จ", m.due_date ? thDate(m.due_date) : "—")}${kv("ความเร่งด่วน", esc(PRIO[m.priority] || "ปกติ"))}
        ${kv("ชั้นข้อมูล", esc(SENS[m.sensitivity || (r.confidential ? "confidential" : "general")]))}${kv("วันที่มีผล", m.effective_date ? thDate(m.effective_date) : "")}${kv("แฟ้มเรื่อง", esc(m.case_ref || ""))}
        ${kv("อนุมัติ", m.approved_at ? `${esc(m.approved_by_name || (d.source ? "ในระบบต้นทาง" : ""))} · ${esc(thTime(m.approved_at))}` : "")}
        ${kv("ลงนาม", m.signed_at || m.sign_method ? `${esc(m.signed_by_name || "")}${m.signed_at ? " · " + esc(thTime(m.signed_at)) : ""}<div class="sub">${esc(SIGNM[m.sign_method] || "")}${m.sign_note ? " · " + esc(m.sign_note) : ""}</div>` : "")}
        ${kv("ออกฉบับจริง", m.issued_at ? esc(thTime(m.issued_at)) : "")}</dl></div>
      ${d.tasks.filter(t => t.status === "open").length ? `<div class="sec"><div class="h">งานที่รออยู่</div>${d.tasks.filter(t => t.status === "open").map(t => `<div class="fl"><div class="t"><b>${{ review: "ตรวจทาน", approve: "อนุมัติ", sign: "ลงนาม" }[t.kind] || t.kind} · ${esc(t.assignee_name || "ผู้มีสิทธิ์คนใดก็ได้")}</b><span>${t.due_date ? "กำหนด " + thDate(t.due_date) + " · " : ""}มอบหมายโดย ${esc(t.created_by_name || "—")}${t.note ? " · " + esc(t.note) : ""}</span></div>
        ${(t.assignee_id === S.me || can("doc.manage")) ? `<button class="btn btn-s btn-sm" data-deleg="${t.id}">มอบหมายแทน</button>` : ""}</div>`).join("")}</div>` : ""}
      <div class="sec"><div class="h"><span>รายละเอียดทะเบียน</span>${canWrite() && r.status !== "void" ? `<button class="btn btn-g btn-sm" data-ed>${IC.pen}แก้ไข</button>` : ""}</div><dl class="kv">
        <dt>เรื่อง</dt><dd>${esc(r.subject || "—")}</dd>
        ${inn ? `<dt>จาก</dt><dd>${esc(r.sender || "—")}</dd><dt>เลขที่หนังสือ</dt><dd>${esc(r.ref_doc_no || "—")}</dd><dt>วันที่ได้รับ</dt><dd>${thDate(r.received_date)}</dd>`
          : `<dt>ออกให้</dt><dd>${esc([r.person_name, r.emp_code].filter(Boolean).join(" · ") || "—")}</dd><dt>อ้างอิง</dt><dd>${esc(r.ref_doc_no || "—")}</dd>`}
        <dt>แบบฟอร์ม</dt><dd>${esc(r.form_code || "—")}</dd>${r.note ? `<dt>หมายเหตุ</dt><dd>${esc(r.note)}</dd>` : ""}</dl></div>
      <div class="sec"><div class="h"><span>ผู้เกี่ยวข้องเพิ่มเติม (${d.people.length})</span>${w && canWrite() ? `<button class="btn btn-g btn-sm" data-people>${IC.pen}แก้ไข</button>` : ""}</div>
        ${d.people.map(p => `<div class="lg"><b style="font-weight:500">${esc(p.name || "")}${p.emp_code ? ` · ${esc(p.emp_code)}` : ""}</b><span>${esc({ subject: "พนักงานที่เกี่ยวข้อง", recipient: "ผู้รับ", sender: "ผู้ส่ง", cc: "สำเนาถึง" }[p.role] || p.role)}${p.org ? " · " + esc(p.org) : ""}</span></div>`).join("") || `<div class="hint">— (ผู้รับหลักอยู่ในรายละเอียดทะเบียน)</div>`}</div>
      <div class="sec"><div class="h">ที่มา</div>${src ? `<div class="src ${(SRC_ST[src.status] || [])[2] || ""}"><div class="t"><b>${SRC_NAME[src.kind]?.[0] || ""} · ${(SRC_ST[src.status] || [src.status])[0]}</b>
          <span>${src.decided_at ? `${src.kind === "contract" ? "ลงนามครบ" : "อนุมัติในระบบ"}เมื่อ ${esc(thTime(src.decided_at))}` : "สร้างจากระบบ HR"}${src.kind !== "paf" ? " · ลายเซ็นบนเอกสารเป็นภาพจากระบบ ไม่ใช่ลายมือชื่ออิเล็กทรอนิกส์ที่ตรวจสอบได้" : ""}${src.kind === "contract" ? " · พนักงานลงนามบนกระดาษ — แนบสแกนฉบับที่ลงนามครบเป็นฉบับจริง" : ""}</span></div>
          <a class="btn btn-s btn-sm" href="${SRC_NAME[src.kind]?.[2](src.source_id) || "/"}" target="_blank" rel="noopener">เปิดเอกสาร</a></div>`
        : LETTER_KIND[r.type_label] && r.status !== "void" && canWrite() ? `<div class="src"><div class="t"><b>ยังไม่ได้สร้างตัวหนังสือ</b><span>เลขนี้สร้างหนังสือในระบบออกหนังสือ HR ได้</span></div><button class="btn btn-s btn-sm" data-mk>สร้างหนังสือ</button></div>`
        : `<div class="src"><div class="t"><b>${esc(ORIGIN[m.origin] || "")}</b><span>ตัวเอกสารคือไฟล์ในแท็บไฟล์และรุ่น</span></div></div>`}</div>`;
  };
  // ---- ไฟล์และรุ่น
  const tFiles = (m, inn, w) => {
    const W = canWrite() && !["disposed", "cancelled"].includes(m.stage), official = d.files.find(f => f.is_official);
    return `<div class="fsum">${pill(FSTATE, d.file_state)}<span>${{ unknown: "รายการนำเข้าจาก Excel เดิม ยังไม่ได้ตรวจว่ามีต้นฉบับ/สแกนที่ใด — ไม่ได้แปลว่าสูญหาย", in_module: "ตัวหนังสือสร้างและอนุมัติในระบบออกหนังสือ HR · ถ้าต้องการหลักฐานฉบับที่ส่งจริง ให้แนบสแกน",
        not_required: "ระบุว่าไม่ต้องแนบ: " + esc(m.file_note || ""), complete: official ? `ฉบับจริง: ${esc(official.name)}` : "มีไฟล์ตามที่ประเภทนี้ต้องการ" }[d.file_state] || "แนบไฟล์และระบุชนิดให้ตรง (ร่าง / ฉบับลงนาม / ประกอบ / หลักฐาน)"}</span></div>
      ${d.files.map(f => `<div class="fl${f.replaced_by ? " old" : ""}">${IC.file}<div class="t"><b>${esc(f.name)}</b>
          <span>${f.kind ? `<em class="k${f.is_official ? " off" : ""}">${f.is_official ? "ฉบับจริง" : esc(FKIND[f.kind])}${f.version ? " · รุ่น " + f.version : ""}</em>` : `<em class="k unk">ยังไม่ระบุชนิด</em>`}
          ${f.locked ? `<em class="k lk">${IC.lock}ล็อก</em>` : ""}${f.replaced_by ? `<em class="k">ถูกแทนที่แล้ว</em>` : ""} ${kb(f.size)} · ${esc(f.uploaded_name || "—")} · ${thDate(String(f.uploaded_at || "").slice(0, 10))}</span></div>
          ${d.can.files_open ? `<button class="btn btn-s btn-sm" data-open="${f.id}">เปิด</button>` : ""}
          ${W && !f.locked ? `<select class="in in-sm" data-kind="${f.id}" title="ชนิดไฟล์"><option value="">ชนิด…</option>${Object.entries(FKIND).map(([k, l]) => `<option value="${k}" ${f.kind === k ? "selected" : ""}>${l}</option>`).join("")}</select>
            <button class="btn btn-g btn-sm" data-del="${f.id}" title="ลบไฟล์">${IC.x}</button>` : ""}</div>`).join("") || `<div class="hint">ยังไม่มีไฟล์</div>`}
      ${!d.can.files_open && d.files.length ? `<div class="hint">บัญชีนี้ไม่มีสิทธิ์เปิดไฟล์</div>` : ""}
      ${W ? `<div class="up-row"><select class="in" id="upKind">${Object.entries(FKIND).map(([k, l]) => `<option value="${k}" ${k === (["draft", "review", "approval"].includes(m.stage) ? "draft" : inn ? "received" : "signed") ? "selected" : ""}>${l}</option>`).join("")}</select>
        <label class="dz" id="dxDz">${IC.up}<b>ลากไฟล์มาวาง หรือกดเพื่อเลือก</b><span>PDF / รูป / Word / Excel · ไม่เกิน 20 MB</span><input type="file" id="dxFile" multiple hidden></label></div>
        <div class="row" style="gap:8px;flex-wrap:wrap">${official && d.can.official ? `<button class="btn btn-s btn-sm" data-sup>แทนที่ฉบับจริง (มีเหตุผล)</button>` : ""}
          ${!official && m.stage === "issued" && d.can.official && d.files.length ? `<button class="btn btn-s btn-sm" data-act="register_official">กำหนดฉบับจริง</button>` : ""}
          <button class="btn btn-g btn-sm" data-nofile>${m.file_note ? "แก้เหตุผลที่ไม่ต้องแนบ" : "ไม่ต้องแนบไฟล์ (ระบุเหตุผล)"}</button></div>` : ""}
      <div class="hint">ฉบับจริงที่ออกแล้วถูกล็อก ลบหรือเขียนทับไม่ได้ · แก้หลังออกฉบับจริง = “แทนที่ฉบับจริง” (ฉบับเดิมยังอยู่) หรือ “ออกฉบับแก้ไข” เป็นเลขใหม่ในแท็บเชื่อมโยง</div>`;
  };
  // ---- ส่ง/รับทราบ
  const tDeliver = m => {
    const W = d.can.edit && ["issued", "closed", "in_progress"].includes(m.stage);
    return `<div class="fsum">${{ none: `<span class="bd w">ยังไม่ได้ส่ง</span>`, wait_ack: `<span class="bd w">รอรับทราบ</span>`, acked: `<span class="bd g">รับทราบครบ</span>`, sent: `<span class="bd b">ส่งแล้ว</span>`, na: `<span class="bd n">ประเภทนี้ไม่ต้องบันทึกการส่ง</span>` }[d.delivery] || ""}
      <span>${d.rule.need_ack ? "ประเภทนี้ต้องมีหลักฐานรับทราบ" : "ประเภทนี้ไม่บังคับรับทราบ"}</span></div>
      ${d.deliveries.map(x => `<div class="fl${x.status === "cancelled" ? " old" : ""}"><div class="t"><b>${esc(x.recipient)}${x.emp_code ? " · " + esc(x.emp_code) : ""}</b>
        <span>${esc(CHAN[x.channel] || x.channel)} · ส่ง ${thDate(x.sent_at)} โดย ${esc(x.sent_by_name || "—")}${x.note ? " · " + esc(x.note) : ""}</span>
        <span>${x.status === "cancelled" ? "ยกเลิกรายการนี้" : x.ack_at ? `${x.status === "refused" ? "ปฏิเสธการรับ" : "รับทราบ"} ${thDate(x.ack_at)} · ${esc(ACKM[x.ack_method] || "")}${x.evidence_file_id ? " · มีไฟล์หลักฐาน" : ""}${x.ack_note ? " · " + esc(x.ack_note) : ""}` : x.need_ack ? "รอรับทราบ" : "ไม่ต้องรับทราบ"}</span></div>
        ${W && x.status === "sent" && x.need_ack ? `<button class="btn btn-s btn-sm" data-ack="${x.id}">บันทึกรับทราบ</button>` : ""}${W && x.status === "sent" ? `<button class="btn btn-g btn-sm" data-dcan="${x.id}" title="ยกเลิกรายการ">${IC.x}</button>` : ""}</div>`).join("") || `<div class="hint">ยังไม่มีรายการส่ง</div>`}
      ${W ? `<div class="card card-b mini"><div class="grid2">
        <label class="fld" style="grid-column:1/-1"><span>ส่งให้ (ชื่อ / หน่วยงาน / รหัสพนักงาน)</span><input class="in" id="dvTo" list="dxEmps" value="${esc(r.person_name || r.sender || "")}"></label>
        <label class="fld"><span>ช่องทาง</span><select class="in" id="dvCh">${Object.entries(CHAN).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
        <label class="fld"><span>วันที่ส่ง</span><input type="date" class="in" id="dvAt" value="${todayISO()}"></label>
        <label class="fld" style="grid-column:1/-1"><span>หมายเหตุ</span><input class="in" id="dvNo"></label>
        <label class="chk"><input type="checkbox" id="dvAck" ${d.rule.need_ack ? "checked" : ""}> ต้องมีหลักฐานรับทราบ</label></div>
        <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn btn-p btn-sm" data-dadd>บันทึกการส่ง</button></div></div>${empList()}`
      : m.stage !== "issued" ? `<div class="hint">บันทึกการส่งได้หลังออกฉบับจริง</div>` : ""}`;
  };
  // ---- เชื่อมโยง
  const tLinks = m => `${d.links.map(l => `<div class="fl"><div class="t"><b>${l.direction === "out" ? esc(LINKK[l.kind] || l.kind) : l.kind === "supersedes" ? "ถูกแทนที่โดย" : "ถูกอ้างถึงโดย"} ${esc(l.other.doc_no)}</b>
      <span>${esc(l.other.type_label || "")}${l.other.subject ? " · " + esc(l.other.subject) : ""}${l.note ? " · " + esc(l.note) : ""}</span></div>
      ${l.other.id ? `<button class="btn btn-s btn-sm" data-goto="${l.other.id}">เปิด</button>` : ""}${canWrite() && l.kind !== "supersedes" && l.direction === "out" ? `<button class="btn btn-g btn-sm" data-unlink="${l.id}">${IC.x}</button>` : ""}</div>`).join("") || `<div class="hint">ยังไม่มีเอกสารที่เชื่อมโยง</div>`}
    ${canWrite() ? `<div class="row" style="gap:8px;flex-wrap:wrap"><input class="in grow" id="lkNo" placeholder="เลขที่เอกสาร เช่น HR-120-2026"><select class="in" id="lkK" style="max-width:200px">${["related", "reply_to", "attachment_of"].map(k => `<option value="${k}">${LINKK[k]}</option>`).join("")}</select><button class="btn btn-s" data-ladd>เชื่อมโยง</button></div>` : ""}
    ${["issued", "closed", "archived"].includes(m.stage) && !m.superseded_by && canWrite() && d.can.official ? `<div class="card card-b mini"><b>ออกฉบับแก้ไข / ฉบับแทนที่</b><p class="hint" style="margin:4px 0 10px">ได้เลขใหม่ในชุดเดิม ผูก “แทนที่” กับฉบับนี้ ฉบับนี้ไม่ถูกแก้และยังเปิดดูได้</p><button class="btn btn-s btn-sm" data-rev>ออกฉบับแก้ไข</button></div>` : ""}`;
  // ---- ประวัติ
  const tHist = () => {
    const all = [...d.events.map(e => ({ at: e.at, who: e.actor_name, what: EV_LABEL[e.action] || e.action, more: [e.from_stage && e.to_stage && e.from_stage !== e.to_stage ? `${STAGE[e.from_stage]?.[0] || e.from_stage} → ${STAGE[e.to_stage]?.[0] || e.to_stage}` : "", e.detail, e.reason ? "เหตุผล: " + e.reason : ""].filter(Boolean).join(" · ") })),
      ...log.map(l => ({ at: l.at, who: l.user_name, what: { open: "เปิดไฟล์", upload: "แนบไฟล์", delete: "ลบไฟล์" }[l.action] || l.action, more: l.file_name || "" }))].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return `<ol class="tl">${all.map(x => `<li><b>${esc(x.what)}</b><span>${esc(x.who || "—")} · ${esc(thTime(x.at))}</span>${x.more ? `<em>${esc(x.more)}</em>` : ""}</li>`).join("") || `<li><span>ยังไม่มีประวัติในระบบสารบรรณ (เรื่องเก่า — ประวัติเริ่มเมื่อมีการดำเนินการครั้งแรก)</span></li>`}</ol>
      <div class="hint">ประวัติเพิ่มได้อย่างเดียว ไม่มีใครแก้หรือลบได้ · ไม่คัดลอกเนื้อหาเอกสารลงประวัติ</div>`;
  };
  // ---- จัดเก็บ/อายุเก็บ
  const tStore = m => {
    const ret = d.retention;
    return `<dl class="kv"><dt>ที่เก็บต้นฉบับ</dt><dd>${esc(m.paper_location || "—")}</dd><dt>แฟ้มเรื่อง</dt><dd>${esc(m.case_ref || "—")}</dd>
        <dt>นโยบายอายุเก็บ</dt><dd>${ret.policy ? `${esc(ret.policy.name)} <span class="bd ${ret.policy.status === "active" ? "g" : "n"}">${ret.policy.status === "active" ? "ใช้งาน" : "ร่าง — ยังไม่มีผล"}</span>` : "ยังไม่ได้กำหนดสำหรับประเภทนี้"}</dd>
        <dt>ครบอายุเก็บ</dt><dd>${ret.until ? thDate(ret.until) : "—"}</dd><dt>ทำลายได้หรือไม่</dt><dd>${esc(ret.block || "เข้าเกณฑ์พิจารณาทำลาย (ต้องเสนอและได้รับอนุมัติก่อน)")}</dd>
        <dt>ระงับทำลาย</dt><dd>${m.hold ? `ระงับโดย ${esc(m.hold_by_name || "")} · ${esc(thTime(m.hold_at))}<div class="sub">${esc(m.hold_reason || "")}</div>` : "ไม่ระงับ"}</dd></dl>
      ${d.can.edit ? `<div class="row" style="gap:8px;flex-wrap:wrap"><input class="in grow" id="stLoc" placeholder="ที่เก็บต้นฉบับ เช่น ตู้ HR-2 แฟ้ม 2569/11" value="${esc(m.paper_location || "")}"><button class="btn btn-s" data-loc>บันทึกที่เก็บ</button></div>` : ""}
      ${d.can.hold && m.stage !== "disposed" ? `<button class="btn ${m.hold ? "btn-s" : "btn-d"} btn-sm" data-hold>${m.hold ? "ปลดการระงับทำลาย" : "ระงับทำลาย (ข้อพิพาท/การตรวจสอบ)"}</button>` : ""}
      <div class="hint">ระบบไม่ลบเอกสารอัตโนมัติ — การทำลายต้องผ่านรายการเสนอ อนุมัติ และบันทึกหลักฐาน (หน้ารายงาน)</div>`;
  };
  const actionBar = m => {
    const acts = d.actions.filter(a => !(a === "register_official" && m.stage === "issued"));
    const prim = acts.filter(a => ACT_PRIMARY.includes(a)), rest = acts.filter(a => !ACT_PRIMARY.includes(a));
    return `${rest.map(a => `<button class="btn ${["cancel", "reject"].includes(a) ? "btn-d" : "btn-s"}" data-act="${a}">${ACT_LABEL[a]}</button>`).join("")}<span style="flex:1"></span>
      <button class="btn btn-g" data-cp>คัดลอกเลข</button>${prim.map(a => `<button class="btn btn-p" data-act="${a}">${a === "submit" ? `ส่งต่อ → ${STAGE[flowAfter(m.stage, d.rule)]?.[0] || ""}` : ACT_LABEL[a]}</button>`).join("")}`;
  };
  const wireTab = (m, inn, w) => {
    const g = s => el.querySelector(s);
    g("[data-cp]")?.addEventListener("click", () => copy(r.doc_no));
    g("[data-ed]")?.addEventListener("click", () => editForm(r, async () => { await after(); }));
    g("[data-meta]")?.addEventListener("click", () => metaForm(r, d, run));
    g("[data-people]")?.addEventListener("click", () => peopleForm(r, d, run));
    g("[data-mk]")?.addEventListener("click", () => { try { sessionStorage.setItem("letter_from_doc", JSON.stringify({ doc_id: r.id, kind: LETTER_KIND[r.type_label] })); } catch {} location.href = "/?letter_new=1"; });
    el.querySelectorAll("[data-deleg]").forEach(b => b.onclick = () => delegateForm(d.tasks.find(t => t.id === +b.dataset.deleg), run));
    el.querySelectorAll("[data-open]").forEach(b => b.onclick = async () => {
      const f = d.files.find(z => z.id === +b.dataset.open);
      const { data, error } = await supabase.storage.from("doc-files").createSignedUrl(f.path, 120);
      if (error || !data?.signedUrl) return fail(error || "ไม่พบไฟล์", "เปิดไฟล์ไม่ได้");
      supabase.rpc("doc_log", { p_doc_id: r.id, p_file_id: f.id, p_file_name: f.name, p_action: "open" }).then(() => {});
      window.open(data.signedUrl, "_blank", "noopener");
    });
    el.querySelectorAll("[data-kind]").forEach(s => s.onchange = () => s.value && run("dms_file_set", { p_file_id: +s.dataset.kind, p_kind: s.value }, "ระบุชนิดไฟล์แล้ว"));
    el.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      const f = d.files.find(z => z.id === +b.dataset.del); if (!confirm(`ลบไฟล์ ${f.name}?`)) return;
      try { await q(supabase.from("doc_files").delete().eq("id", f.id)); await supabase.storage.from("doc-files").remove([f.path]);
        await supabase.rpc("doc_log", { p_doc_id: r.id, p_file_id: f.id, p_file_name: f.name, p_action: "delete" }); } catch (e) { return fail(e, "ลบไม่สำเร็จ"); }
      await after();
    });
    const dz = g("#dxDz"), fi = g("#dxFile");
    if (dz) {
      const up = async list => { if (!list.length) return; const n = await uploadFiles(r, list, g("#upKind").value); if (n) { toast(`แนบ ${n} ไฟล์แล้ว`, "ok"); await after(); } };
      fi.onchange = () => { const l = [...fi.files]; fi.value = ""; up(l); };
      dz.ondragover = e => { e.preventDefault(); dz.classList.add("on"); }; dz.ondragleave = () => dz.classList.remove("on");
      dz.ondrop = e => { e.preventDefault(); dz.classList.remove("on"); up([...e.dataTransfer.files]); };
    }
    g("[data-sup]")?.addEventListener("click", () => {
      const cand = d.files.filter(f => !f.is_official && !f.replaced_by);
      if (!cand.length) return toast("แนบไฟล์ฉบับใหม่ก่อน แล้วค่อยกดแทนที่", "err");
      const x = modal("แทนที่ฉบับจริง", `<label class="fld"><span>ไฟล์ฉบับใหม่</span><select class="in" id="supF">${cand.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join("")}</select></label>
        <label class="fld" style="margin-top:10px"><span>เหตุผล *</span><textarea class="in" id="supR" rows="3"></textarea></label><div class="note" style="margin-top:10px">ฉบับเดิมยังอยู่ ถูกล็อก และชี้ไปฉบับใหม่ — ถ้าเนื้อหาเปลี่ยนสาระสำคัญ ควรใช้ “ออกฉบับแก้ไข” (เลขใหม่)</div>`,
        `<button class="btn btn-s" data-x>ยกเลิก</button><button class="btn btn-p" data-ok>แทนที่</button>`);
      x.querySelector("[data-ok]").onclick = async () => { const res = await run("dms_file_supersede", { p_doc_id: r.id, p_new_file_id: +x.querySelector("#supF").value, p_reason: x.querySelector("#supR").value }, "แทนที่ฉบับจริงแล้ว"); if (res) x.remove(); };
    });
    g("[data-nofile]")?.addEventListener("click", () => {
      const why = prompt("เหตุผลที่ไม่ต้องแนบไฟล์ (เช่น ส่งทางอีเมลอย่างเดียว / ต้นฉบับอยู่แฟ้ม HR ไม่ได้สแกน) — เว้นว่างเพื่อยกเลิกข้อยกเว้น", m.file_note || "");
      if (why !== null) run("dms_update", { p_doc_id: r.id, p_fields: { file_note: why.trim() } });
    });
    g("[data-dadd]")?.addEventListener("click", () => {
      const to = g("#dvTo").value.trim(), p = personOf(to);
      run("dms_delivery_add", { p_doc_id: r.id, p_d: { recipient: p.person_name || to, emp_code: p.emp_code || null, channel: g("#dvCh").value, sent_at: g("#dvAt").value, need_ack: g("#dvAck").checked, note: g("#dvNo").value } }, "บันทึกการส่งแล้ว");
    });
    if (g("#dvTo")) loadEmps().then(() => { const dl = el.querySelector("#dxEmps"); if (dl) dl.outerHTML = empList(); });
    el.querySelectorAll("[data-ack]").forEach(b => b.onclick = () => ackForm(r, d, +b.dataset.ack, run));
    el.querySelectorAll("[data-dcan]").forEach(b => b.onclick = () => { const why = prompt("เหตุผลที่ยกเลิกรายการส่ง"); if (why) run("dms_delivery_cancel", { p_delivery_id: +b.dataset.dcan, p_reason: why }); });
    g("[data-ladd]")?.addEventListener("click", () => run("dms_link_add", { p_doc_id: r.id, p_other_no: g("#lkNo").value.trim(), p_kind: g("#lkK").value }, "เชื่อมโยงแล้ว"));
    el.querySelectorAll("[data-unlink]").forEach(b => b.onclick = () => confirm("ลบการเชื่อมโยงนี้?") && run("dms_link_remove", { p_link_id: +b.dataset.unlink }));
    el.querySelectorAll("[data-goto]").forEach(b => b.onclick = () => openDoc(S.rows.find(x => x.id === +b.dataset.goto)));
    g("[data-rev]")?.addEventListener("click", async () => {
      const why = prompt(`ออกฉบับแก้ไขของ ${r.doc_no}? จะได้เลขใหม่ในชุด ${r.series_code}\nเหตุผล:`); if (!why) return;
      try { const res = await rpc("dms_revise", { p_doc_id: r.id, p_reason: why }); toast(`ออกฉบับแก้ไข ${res.doc_no} แล้ว`, "ok"); await loadAll(); rerender(); openDoc(S.rows.find(x => x.id === res.id)); } catch (e) { fail(e); }
    });
    g("[data-loc]")?.addEventListener("click", () => run("dms_update", { p_doc_id: r.id, p_fields: { paper_location: g("#stLoc").value.trim() } }));
    g("[data-hold]")?.addEventListener("click", () => { const why = prompt(m.hold ? "เหตุผลที่ปลดการระงับ" : "เหตุผลที่ระงับทำลาย (เช่น ข้อพิพาท/คดี/การตรวจสอบ)"); if (why) run("dms_hold", { p_doc_id: r.id, p_on: !m.hold, p_reason: why }); });
  };
  try { await load(); } catch (e) { el.remove(); return fail(e, "เปิดเอกสารไม่ได้"); }
  draw();
}
function flowAfter(st, rule) {
  const seq = ["draft", ...(rule.need_review ? ["review"] : []), ...(rule.need_approval ? ["approval"] : []), ...(rule.need_sign ? ["signing"] : []), "to_issue"];
  const i = seq.indexOf(st); return i >= 0 && i + 1 < seq.length ? seq[i + 1] : "issued";
}
const TASK_OF = { review: "review", approval: "approve", signing: "sign" };

// ---------------------------------------------------------------- ดำเนินการ (กล่องยืนยันตามชนิด)
async function actDialog(r, d, act, run) {
  const m = d.meta, to = ["submit", "review_ok", "approve", "sign"].includes(act) ? flowAfter(m.stage, d.rule) : null;
  const needReason = ["return", "reject", "cancel", "reopen"].includes(act) || (act === "close" && d.blockers.length);
  let people = [];
  const kind = to && TASK_OF[to];
  if (kind || act === "accept") { try { people = await rpc("dms_assignees", { p_kind: kind || "owner" }); } catch {} }
  const fileOpts = d.files.filter(f => !f.replaced_by).map(f => `<option value="${f.id}" ${f.kind === "signed" ? "selected" : ""}>${esc(f.name)}${f.kind ? " · " + FKIND[f.kind] : ""}</option>`).join("");
  const body = `${act === "submit" ? `<p>ส่ง <b>${esc(r.doc_no)}</b> ไปขั้น <b>${STAGE[to][0]}</b></p>` : ""}
    ${kind ? `<div class="grid2" style="margin-top:8px"><label class="fld"><span>ผู้รับงานขั้น “${STAGE[to][0]}”</span><select class="in" id="aAs"><option value="">ใครก็ได้ที่มีสิทธิ์</option>${people.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label>
      <label class="fld"><span>กำหนด (ไม่บังคับ)</span><input type="date" class="in" id="aDue"></label></div>
      ${!people.length ? `<div class="hint" style="margin-top:6px">ยังไม่มีผู้ใช้ที่ได้รับสิทธิ์ขั้นนี้ — Admin ให้สิทธิ์ที่ User Management ก่อน (Admin ทำได้ทุกขั้น)</div>` : ""}` : ""}
    ${act === "accept" ? `<label class="fld"><span>ผู้รับผิดชอบ</span><select class="in" id="aOwn">${people.map(p => `<option value="${esc(p.id)}" ${p.id === S.me ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>` : ""}
    ${act === "sign" || act === "register_official" ? `<label class="fld"><span>วิธีลงนาม *</span><select class="in" id="aSm">${Object.entries(SIGNM).filter(([k]) => k !== "image").map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
      <label class="fld" style="margin-top:10px"><span>ผู้ลงนาม</span><input class="in" id="aSb" placeholder="ชื่อ-ตำแหน่งผู้ลงนาม"></label>
      <label class="fld" style="margin-top:10px"><span>รายละเอียด (เช่น ระบบ e-signature ที่ใช้ / วันที่ลงนามจริง)</span><input class="in" id="aSn"></label>
      ${act === "sign" && d.rule.need_signed_file && !d.files.some(f => f.kind === "signed") ? `<div class="note r" style="margin-top:10px">ยังไม่มีไฟล์ชนิด “ฉบับลงนาม” — แนบสแกนฉบับลงนามในแท็บไฟล์ก่อน</div>` : ""}` : ""}
    ${act === "issue" || act === "register_official" ? `<label class="fld" style="margin-top:10px"><span>ไฟล์ฉบับจริง${d.rule.need_signed_file && !m.file_note ? " *" : ""}</span><select class="in" id="aOf"><option value="">— ไม่มีไฟล์ —</option>${fileOpts}</select></label>
      <div class="hint" style="margin-top:6px">ฉบับจริงจะถูกล็อก ลบ/เขียนทับไม่ได้</div>` : ""}
    ${act === "archive" ? `<label class="fld"><span>ที่เก็บต้นฉบับ *</span><input class="in" id="aLoc" value="${esc(m.paper_location || "")}" placeholder="เช่น ตู้ HR-2 แฟ้ม 2569/11 หรือ “ไม่มีต้นฉบับกระดาษ”"></label>` : ""}
    ${act === "close" && d.blockers.length ? `<div class="note r">ยังไม่ครบ: ${esc(d.blockers.join(" · "))} — ปิดได้เมื่อระบุเหตุผล (บันทึกเป็นข้อยกเว้น)</div>` : ""}
    ${act === "use_reserved" ? `<div class="note">ใส่เรื่อง/ผู้รับในรายละเอียดทะเบียนก่อน (ปุ่มแก้ไข) แล้วกดใช้เลข — เรื่องจะเริ่มที่ขั้นร่าง</div>` : ""}
    ${act === "cancel" ? `<div class="note r">เลข ${esc(r.doc_no)} จะถูกยกเลิกในทะเบียนด้วย และไม่ถูกนำกลับมาใช้${d.source?.kind === "letter" ? " · หนังสือในระบบออกหนังสือที่ใช้เลขนี้จะถูกยกเลิกด้วย" : ""}</div>` : ""}
    <label class="fld" style="margin-top:12px"><span>${needReason ? "เหตุผล *" : "บันทึก (ไม่บังคับ)"}</span><textarea class="in" id="aR" rows="2"></textarea></label>`;
  const x = modal(`${ACT_LABEL[act]} · ${esc(r.doc_no)}`, body, `<button class="btn btn-s" data-x>ยกเลิก</button><button class="btn ${["cancel", "reject"].includes(act) ? "btn-d" : "btn-p"}" data-ok>${ACT_LABEL[act]}</button>`);
  const v = id => x.querySelector("#" + id)?.value || null;
  x.querySelector("[data-ok]").onclick = async e => {
    const as = v("aAs"), opts = { assignee_id: as, assignee_name: as ? people.find(p => p.id === as)?.name : null, due_date: v("aDue"),
      sign_method: v("aSm"), signed_by_name: v("aSb"), sign_note: v("aSn"), official_file_id: v("aOf") ? +v("aOf") : null, paper_location: v("aLoc"),
      owner_id: v("aOwn"), owner_name: v("aOwn") ? people.find(p => p.id === v("aOwn"))?.name : null };
    e.target.disabled = true;
    const res = await run("dms_act", { p_doc_id: r.id, p_action: act, p_ver: m.legacy ? null : m.ver, p_reason: v("aR"), p_opts: opts }, `${ACT_LABEL[act]}แล้ว`);
    if (res) x.remove(); else e.target.disabled = false;
  };
}
async function metaForm(r, d, run) {
  const m = d.meta, sens = m.sensitivity || (r.confidential ? "confidential" : "general");
  let people = []; try { people = await rpc("dms_assignees", { p_kind: "owner" }); } catch {}
  const sensOk = k => (!SENS_CAT[k] || can(SENS_CAT[k])) && (!["confidential", "salary", "discipline", "health"].includes(k) || can("data.doc.confidential"));
  const x = modal(`ข้อมูลเรื่อง · ${esc(r.doc_no)}`, `<div class="grid2">
    <label class="fld"><span>ผู้รับผิดชอบ</span><select class="in" id="mOw"><option value="">—</option>${people.map(p => `<option value="${esc(p.id)}" ${p.id === m.owner_id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
    <label class="fld"><span>กำหนดเสร็จ</span><input type="date" class="in" id="mDu" value="${esc(m.due_date || "")}"></label>
    <label class="fld"><span>ความเร่งด่วน</span><select class="in" id="mPr">${Object.entries(PRIO).map(([k, l]) => `<option value="${k}" ${(m.priority || "normal") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="fld"><span>ชั้นข้อมูล</span><select class="in" id="mSe">${Object.entries(SENS).map(([k, l]) => `<option value="${k}" ${sens === k ? "selected" : ""} ${sensOk(k) || sens === k ? "" : "disabled"}>${l}</option>`).join("")}</select></label>
    <label class="fld"><span>วันที่มีผล (ถ้ามี)</span><input type="date" class="in" id="mEf" value="${esc(m.effective_date || "")}"></label>
    <label class="fld"><span>แฟ้มเรื่อง</span><input class="in" id="mCa" value="${esc(m.case_ref || "")}" placeholder="เช่น AKR-ER-2569-03" list="dxCases"></label>
    <label class="fld" style="grid-column:1/-1"><span>เหตุผล (ต้องใส่เมื่อเปลี่ยนผู้รับผิดชอบ)</span><input class="in" id="mWhy"></label></div>
    <datalist id="dxCases">${[...new Set([...S.ov.values()].map(o => o.case_ref).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join("")}</datalist>`,
    `<button class="btn btn-s" data-x>ยกเลิก</button><button class="btn btn-p" data-ok>บันทึก</button>`);
  const v = id => x.querySelector("#" + id).value;
  x.querySelector("[data-ok]").onclick = async () => {
    const res = await run("dms_update", { p_doc_id: r.id, p_reason: v("mWhy"), p_fields: { owner_id: v("mOw") || null, owner_name: people.find(p => p.id === v("mOw"))?.name || null,
      due_date: v("mDu") || null, priority: v("mPr"), sensitivity: v("mSe"), effective_date: v("mEf") || null, case_ref: v("mCa").trim() || null } });
    if (res) x.remove();
  };
}
async function peopleForm(r, d, run) {
  await loadEmps();
  const row = p => `<div class="pp"><select class="in" data-pr>${Object.entries({ subject: "พนักงานที่เกี่ยวข้อง", recipient: "ผู้รับ", sender: "ผู้ส่ง", cc: "สำเนาถึง" }).map(([k, l]) => `<option value="${k}" ${p.role === k ? "selected" : ""}>${l}</option>`).join("")}</select>
    <input class="in" data-pn list="dxEmps" value="${esc(p.emp_code ? `${p.emp_code} · ${p.name || ""}` : p.name || "")}" placeholder="รหัส/ชื่อพนักงาน หรือชื่อคนนอก"><input class="in" data-po value="${esc(p.org || "")}" placeholder="หน่วยงาน"></div>`;
  const x = modal(`ผู้เกี่ยวข้อง · ${esc(r.doc_no)}`, `<div id="ppL">${(d.people.length ? d.people : [{ role: "subject" }]).map(row).join("")}</div>
    <button class="btn btn-g btn-sm" id="ppAdd" style="margin-top:8px">${IC.plus}เพิ่มคน</button>${empList()}`, `<button class="btn btn-s" data-x>ยกเลิก</button><button class="btn btn-p" data-ok>บันทึก</button>`, true);
  x.querySelector("#ppAdd").onclick = () => x.querySelector("#ppL").insertAdjacentHTML("beforeend", row({ role: "subject" }));
  x.querySelector("[data-ok]").onclick = async () => {
    const list = [...x.querySelectorAll(".pp")].map(el => { const p = personOf(el.querySelector("[data-pn]").value); return { role: el.querySelector("[data-pr]").value, emp_code: p.emp_code || null, name: p.person_name || null, org: el.querySelector("[data-po]").value.trim() || null }; });
    const res = await run("dms_people_set", { p_doc_id: r.id, p_people: list }); if (res) x.remove();
  };
}
async function delegateForm(t, run) {
  let people = []; try { people = await rpc("dms_assignees", { p_kind: t.kind }); } catch {}
  const x = modal("มอบหมายแทน", `<label class="fld"><span>ผู้รับงานแทน</span><select class="in" id="dgA">${people.filter(p => p.id !== t.assignee_id).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label>
    <label class="fld" style="margin-top:10px"><span>เหตุผล *</span><input class="in" id="dgR" placeholder="เช่น ลาพักร้อน 3–7 พ.ย."></label>`, `<button class="btn btn-s" data-x>ยกเลิก</button><button class="btn btn-p" data-ok>มอบหมาย</button>`);
  x.querySelector("[data-ok]").onclick = async () => { const a = x.querySelector("#dgA").value; const res = await run("dms_task_delegate", { p_task_id: t.id, p_assignee_id: a, p_assignee_name: people.find(p => p.id === a)?.name, p_reason: x.querySelector("#dgR").value }, "มอบหมายแทนแล้ว"); if (res) x.remove(); };
}
function ackForm(r, d, id, run) {
  const x = modal("บันทึกรับทราบ", `<div class="grid2"><label class="fld"><span>วิธี</span><select class="in" id="akM">${Object.entries(ACKM).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
    <label class="fld"><span>วันที่</span><input type="date" class="in" id="akD" value="${todayISO()}"></label>
    <label class="fld" style="grid-column:1/-1"><span>ไฟล์หลักฐาน (สำเนาที่ลงชื่อรับ / อีเมลตอบรับ)</span><select class="in" id="akF"><option value="">— ไม่มีไฟล์ (บันทึกรายละเอียดแทน) —</option>${d.files.filter(f => !f.is_official).map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join("")}</select></label>
    <label class="fld" style="grid-column:1/-1"><span>รายละเอียด</span><input class="in" id="akN" placeholder="เช่น พยาน: นาย ก. ฝ่ายบุคคล"></label></div>
    <div class="hint" style="margin-top:8px">แนบไฟล์หลักฐานในแท็บไฟล์ก่อน แล้วเลือกที่นี่</div>`, `<button class="btn btn-s" data-x>ยกเลิก</button><button class="btn btn-p" data-ok>บันทึก</button>`);
  const v = s => x.querySelector(s).value;
  x.querySelector("[data-ok]").onclick = async () => { const res = await run("dms_delivery_ack", { p_delivery_id: id, p_a: { ack_method: v("#akM"), ack_at: v("#akD"), evidence_file_id: v("#akF") ? +v("#akF") : null, ack_note: v("#akN") } }, "บันทึกรับทราบแล้ว"); if (res) x.remove(); };
}
async function uploadFiles(r, list, kind) {
  let n = 0;
  for (const file of list) {
    if (file.size > MAX_FILE) { toast(`${file.name} ใหญ่เกิน 20 MB`, "err"); continue; }
    const path = `${r.id}/${Date.now()}-${storageName(file.name)}`;
    const { error } = await supabase.storage.from("doc-files").upload(path, file, { contentType: file.type || undefined });
    if (error) { fail(error, `อัปโหลด ${file.name} ไม่สำเร็จ`); continue; }
    const name = S.user.user_metadata?.full_name || S.user.email;
    const { data, error: e2 } = await supabase.from("doc_files").insert({ doc_id: r.id, name: file.name, path, size: file.size, mime: file.type || null, uploaded_name: name }).select().single();
    if (e2) { await supabase.storage.from("doc-files").remove([path]); fail(e2, `บันทึก ${file.name} ไม่สำเร็จ`); continue; }
    supabase.rpc("doc_log", { p_doc_id: r.id, p_file_id: data.id, p_file_name: file.name, p_action: "upload" }).then(() => {});
    if (kind) await supabase.rpc("dms_file_set", { p_file_id: data.id, p_kind: kind });
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- สร้างเอกสาร / รับเอกสาร / แก้ทะเบียน
const typeOpts = (code, cur, skip) => S.types.filter(t => t.series_code === code && (t.is_active || t.id === cur) && t.label !== skip).map(t => `<option value="${t.id}" ${t.id === cur ? "selected" : ""}>${esc(t.label)}${t.confidential ? " 🔒" : ""}</option>`).join("");
async function ownerFields(prefix) {
  let people = []; try { people = await rpc("dms_assignees", { p_kind: "owner" }); } catch {}
  return [`<label class="fld"><span>ผู้รับผิดชอบ</span><select class="in" id="${prefix}Ow">${people.map(p => `<option value="${esc(p.id)}" ${p.id === S.me ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
    <label class="fld"><span>กำหนดเสร็จ</span><input type="date" class="in" id="${prefix}Du"></label>
    <label class="fld"><span>ความเร่งด่วน</span><select class="in" id="${prefix}Pr">${Object.entries(PRIO).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>`, people];
}
async function setMeta(rows, el, prefix, people, extra = {}) {
  const v = id => el.querySelector("#" + prefix + id)?.value || null;
  for (const r of rows) {
    try { await rpc("dms_update", { p_doc_id: r.id, p_fields: { owner_id: v("Ow"), owner_name: people.find(p => p.id === v("Ow"))?.name || null, due_date: v("Du"), priority: v("Pr"), ...extra } }); } catch (e) { fail(e, `ตั้งผู้รับผิดชอบ ${r.doc_no}`); }
  }
}
async function issueForm() {
  await loadEmps();
  const outs = S.series.filter(s => s.is_active && s.direction !== "in");
  const [own, people] = await ownerFields("is");
  const el = modal("สร้างเอกสาร (ออกเลข)", `<div class="grid2">
      <label class="fld"><span>ชุดเลข</span><select class="in" id="isS">${outs.map(s => `<option value="${esc(s.code)}" ${s.code === (S.f.series || "HR") ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></label>
      <label class="fld"><span>ประเภท</span><select class="in" id="isT"></select></label>
      <label class="fld" style="grid-column:1/-1"><span>เรื่อง</span><input class="in" id="isSub" placeholder="เช่น ยื่นธนาคาร, แจ้งผลฝึกงาน ม.เชียงใหม่"></label>
      <label class="fld"><span>วันที่เอกสาร</span><input type="date" class="in" id="isD" value="${todayISO()}"></label>
      <label class="fld"><span>จำนวนเลข</span><input type="number" class="in" id="isN" min="1" max="500" value="1"></label>
      <label class="fld" id="isOne" style="grid-column:1/-1"><span>ออกให้ (พิมพ์รหัส/ชื่อพนักงาน หรือชื่อคนนอก)</span><input class="in" id="isP" list="dxEmps" autocomplete="off"></label>
      <label class="fld" id="isMany" style="grid-column:1/-1;display:none"><span>รายชื่อ (บรรทัดละ 1 คน เรียงตามเลข · เว้นว่าง = จองเลขไว้ก่อน)</span><textarea class="in" id="isPs" rows="5"></textarea></label>
      ${own}
      <label class="fld"><span>ชั้นข้อมูล</span><select class="in" id="isSe">${Object.entries(SENS).map(([k, l]) => `<option value="${k}" ${(SENS_CAT[k] && !can(SENS_CAT[k])) || (["confidential", "salary", "discipline", "health"].includes(k) && !can("data.doc.confidential")) ? "disabled" : ""}>${l}</option>`).join("")}</select></label>
      <label class="fld"><span>อ้างอิงเลขที่ (ไม่บังคับ)</span><input class="in" id="isR" placeholder="เช่น HR-018-2025"></label>
      <label class="fld"><span>หมายเหตุ</span><input class="in" id="isNo"></label></div>${empList()}
    <div class="note" style="margin-top:12px"><b id="isPv"></b> · เลขจริงออกตอนกดยืนยัน ถ้ามีคนออกก่อนในเวลาเดียวกันจะได้เลขถัดไป · ขั้นตอนต่อไปตามที่ตั้งไว้ของประเภทนี้</div>`,
    `<button class="btn btn-s" data-x>ยกเลิก</button><button class="btn btn-p" data-ok>ออกเลข</button>`, true);
  const g = id => el.querySelector("#" + id);
  const ty = () => S.types.find(t => t.id === +g("isT").value);
  const pv = () => { const n = Math.max(1, Math.min(500, +g("isN").value || 1)), s = g("isS").value, yy = +(g("isD").value || "").slice(0, 4) || new Date().getFullYear();
    const first = yy === +String(S.next[s] || "").slice(-4) ? S.next[s] : nextNo(S.rows, prefixOf(s), s, yy);
    g("isPv").textContent = n === 1 ? `จะได้เลข ${first}` : `จะได้ ${n} เลข เริ่มที่ ${first}`; g("isOne").style.display = n === 1 ? "" : "none"; g("isMany").style.display = n === 1 ? "none" : ""; };
  const setSens = () => { const t = ty(); if (t?.confidential && can("data.doc.confidential")) g("isSe").value = "confidential"; else if (g("isSe").value !== "personal") g("isSe").value = "general"; };
  const setT = () => { g("isT").innerHTML = typeOpts(g("isS").value, null, CONTRACT_TYPE); setSens(); pv(); };
  g("isS").onchange = setT; g("isT").onchange = setSens; g("isN").oninput = pv; g("isD").onchange = pv; setT();
  el.querySelector("[data-ok]").onclick = async e => {
    const n = Math.max(1, Math.min(500, +g("isN").value || 1)); let ppl = null;
    if (n === 1) { const p = personOf(g("isP").value); if (p.person_name) ppl = [p]; }
    else { const lines = g("isPs").value.split("\n").map(x => x.trim()).filter(Boolean);
      if (lines.length && lines.length !== n) return toast(`รายชื่อมี ${lines.length} บรรทัด แต่จะออก ${n} เลข — ให้เท่ากัน หรือเว้นว่าง`, "err");
      if (lines.length) ppl = lines.map(personOf); }
    const sens = g("isSe").value, t = ty();
    if (t?.confidential && !["confidential", "salary", "discipline", "health"].includes(sens) && !confirm("ประเภทนี้ตั้งให้เป็นเอกสารลับ — เลขใหม่จะเป็นลับอัตโนมัติ ดำเนินการต่อ?")) return;
    e.target.disabled = true;
    const { data, error } = await supabase.rpc("doc_issue", { p_series: g("isS").value, p_count: n, p_type_id: +g("isT").value || null, p_subject: g("isSub").value,
      p_issued_date: g("isD").value || null, p_ref: g("isR").value, p_note: g("isNo").value, p_people: ppl });
    if (error) { e.target.disabled = false; return fail(error, "ออกเลขไม่สำเร็จ"); }
    const rows = data || [];
    if ((n === 1 || ppl) && (!t?.confidential || can("data.doc.confidential"))) await setMeta(rows.slice(0, 50), el, "is", people, sens !== "general" ? { sensitivity: sens } : {});
    el.remove(); await loadAll(); rerender();
    const nos = rows.map(r => r.doc_no);
    const dd = modal("ออกเลขแล้ว", `<div style="padding:10px 0"><div class="big-no" style="font-size:${nos.length > 1 ? 20 : 30}px">${esc(nos.length > 1 ? `${nos[0]} – ${nos[nos.length - 1]}` : nos[0])}</div>
      <div class="hint" style="text-align:center;margin-top:6px">${nos.length} เลข${nos.length > 1 && !ppl ? " · จองไว้ (ใส่เรื่องแล้วกด “ใช้เลขที่จอง” ทีละเลข)" : " · เริ่มที่ขั้นร่าง"}</div></div>`,
      `<button class="btn btn-s" data-x>ปิด</button><button class="btn btn-s" data-cp>คัดลอกเลขที่</button>${nos.length === 1 ? `<button class="btn btn-p" data-att>เปิดเรื่อง</button>` : ""}`);
    dd.querySelector("[data-cp]").onclick = () => copy(nos.join("\n"));
    dd.querySelector("[data-att]")?.addEventListener("click", () => { dd.remove(); openDoc(S.rows.find(x => x.id === rows[0].id)); });
  };
}
async function receiveForm() {
  if (!S.series.some(s => s.code === "IN")) return toast("ยังไม่มีชุดเลขรับเข้า", "err");
  const [own, people] = await ownerFields("rv");
  const el = modal("รับเอกสาร (ลงทะเบียนรับ)", `<div class="grid2">
      <label class="fld"><span>ประเภท</span><select class="in" id="rvT">${typeOpts("IN")}</select></label>
      <label class="fld"><span>วันที่ได้รับ</span><input type="date" class="in" id="rvD" value="${todayISO()}"></label>
      <label class="fld" style="grid-column:1/-1"><span>จาก (หน่วยงาน / บริษัท / บุคคล) *</span><input class="in" id="rvF" placeholder="เช่น สำนักงานประกันสังคมจังหวัดพิจิตร"></label>
      <label class="fld"><span>เลขที่หนังสือของผู้ส่ง</span><input class="in" id="rvR" placeholder="เช่น พจ 0024/1234"></label>
      <label class="fld"><span>ลงวันที่ (ตามหนังสือ)</span><input type="date" class="in" id="rvDd"></label>
      <label class="fld" style="grid-column:1/-1"><span>เรื่อง *</span><input class="in" id="rvS"></label>
      ${own}
      <label class="fld" style="grid-column:1/-1"><span>หมายเหตุ / ส่งต่อให้</span><input class="in" id="rvN"></label>
      <label class="fld" style="grid-column:1/-1"><span>สแกนฉบับที่ได้รับ (แนบทีหลังได้)</span><input type="file" class="in" id="rvFile" multiple></label>
      <label class="chk" style="grid-column:1/-1"><input type="checkbox" id="rvC" ${can("data.doc.confidential") ? "" : "disabled"}> เอกสารลับ</label></div>
    <div class="note" style="margin-top:12px">จะได้เลขรับ <b>${esc(S.next.IN || nextNo(S.rows, prefixOf("IN"), "IN", new Date().getFullYear()))}</b> (เลขจริงออกตอนกดยืนยัน) · มอบหมายผู้รับผิดชอบแล้วเรื่องจะอยู่ใน “งานของฉัน” ของเขา</div>`,
    `<button class="btn btn-s" data-x>ยกเลิก</button><button class="btn btn-p" data-ok>ลงรับ</button>`, true);
  const g = id => el.querySelector("#" + id);
  el.querySelector("[data-ok]").onclick = async e => {
    const from = g("rvF").value.trim(), subj = g("rvS").value.trim(); if (!from || !subj) return toast("กรอกผู้ส่งและเรื่อง", "err");
    e.target.disabled = true;
    const note = [g("rvDd").value ? `ลงวันที่ ${thDate(g("rvDd").value)}` : "", g("rvN").value.trim()].filter(Boolean).join(" · ");
    const { data, error } = await supabase.rpc("doc_issue", { p_series: "IN", p_count: 1, p_type_id: +g("rvT").value || null, p_subject: subj, p_issued_date: todayISO(),
      p_ref: g("rvR").value, p_note: note, p_people: [{ person_name: from }] });
    if (error) { e.target.disabled = false; return fail(error, "ลงรับไม่สำเร็จ"); }
    let r = data[0];
    const { data: u, error: e2 } = await supabase.from("doc_register").update({ sender: from, received_date: g("rvD").value || null }).eq("id", r.id).select().single();
    if (!e2 && u) r = u;
    await setMeta([r], el, "rv", people, g("rvC").checked ? { sensitivity: "confidential" } : {});
    const files = [...g("rvFile").files];
    el.remove();
    if (files.length) { const n = await uploadFiles(r, files, "received"); toast(`ลงรับ ${r.doc_no} แล้ว · แนบ ${n} ไฟล์`, "ok"); } else toast(`ลงรับ ${r.doc_no} แล้ว`, "ok");
    await loadAll(); rerender(); openDoc(S.rows.find(x => x.id === r.id));
  };
}
async function editForm(r, done) {
  await loadEmps();
  const inn = dirOf(r.series_code) === "in";
  const el = modal(`แก้รายละเอียดทะเบียน ${esc(r.doc_no)}`, `<div class="grid2">
      <label class="fld"><span>ประเภท</span><select class="in" id="edT">${typeOpts(r.series_code, r.type_id)}${r.type_id ? "" : `<option value="" selected>${esc(r.type_label || "—")}</option>`}</select></label>
      <label class="fld"><span>${inn ? "วันที่ลงรับ" : "วันที่เอกสาร"}</span><input type="date" class="in" id="edD" value="${esc(r.issued_date || "")}"></label>
      <label class="fld" style="grid-column:1/-1"><span>เรื่อง</span><input class="in" id="edS" value="${esc(r.subject || "")}"></label>
      ${inn ? `<label class="fld" style="grid-column:1/-1"><span>จาก</span><input class="in" id="edF" value="${esc(r.sender || "")}"></label>
        <label class="fld"><span>วันที่ได้รับ</span><input type="date" class="in" id="edRd" value="${esc(r.received_date || "")}"></label>`
      : `<label class="fld" style="grid-column:1/-1"><span>ออกให้</span><input class="in" id="edP" list="dxEmps" autocomplete="off" value="${esc(r.emp_code ? `${r.emp_code} · ${r.person_name || ""}` : r.person_name || "")}"></label>`}
      <label class="fld"><span>${inn ? "เลขที่หนังสือของผู้ส่ง" : "อ้างอิงเลขที่"}</span><input class="in" id="edR" value="${esc(r.ref_doc_no || "")}"></label>
      <label class="fld"><span>รหัสแบบฟอร์ม</span><input class="in" id="edFc" value="${esc(r.form_code || "")}" placeholder="เช่น AKR-OHR-FM-031 Rev. 00"></label>
      <label class="fld" style="grid-column:1/-1"><span>หมายเหตุ</span><input class="in" id="edN" value="${esc(r.note || "")}"></label></div>${inn ? "" : empList()}
    <div class="hint" style="margin-top:8px">เลขที่ ${esc(r.doc_no)} แก้ไม่ได้ · ชั้นความลับแก้ที่ “ข้อมูลเรื่อง” · ทุกการแก้ถูกบันทึกในประวัติ</div>`,
    `<button class="btn btn-s" data-x>ปิด</button><button class="btn btn-p" data-ok>บันทึก</button>`);
  const g = id => el.querySelector("#" + id);
  el.querySelector("[data-ok]").onclick = async () => {
    const t = S.types.find(x => x.id === +g("edT").value), p = inn ? {} : personOf(g("edP").value);
    const upd = { type_id: t?.id || r.type_id, type_label: t?.label || r.type_label, issued_date: g("edD").value || null, subject: g("edS").value.trim() || null,
      ref_doc_no: g("edR").value.trim() || null, note: g("edN").value.trim() || null, form_code: g("edFc").value.trim() || null,
      ...(inn ? { sender: g("edF").value.trim() || null, received_date: g("edRd").value || null } : { emp_code: p.emp_code || null, person_name: p.person_name || null }) };
    const { error } = await supabase.from("doc_register").update(upd).eq("id", r.id);
    if (error) return fail(error, "บันทึกไม่สำเร็จ");
    Object.assign(r, upd); el.remove(); toast("บันทึกแล้ว", "ok"); done?.();
  };
}

// ---------------------------------------------------------------- รายงาน (+ การทำลาย + ประวัติระบบ)
const bars = (rows, total) => `<div class="hbars">${rows.map(([l, n, c]) => `<div class="hb"><span class="l">${esc(l)}</span><span class="t"><i class="${c || ""}" style="width:${total ? Math.max(2, n / total * 100) : 0}%"></i></span><b>${n}</b></div>`).join("")}</div>`;
async function renderReports() {
  const y = +(S.f.ry || new Date().getFullYear()), live = S.rows.filter(r => r.year === y);
  const by = f => { const m = new Map(); for (const r of live) { const k = f(r); m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const st = by(r => O(r.id).stage), ty = by(r => r.type_label || "—").slice(0, 12), fs = by(r => O(r.id).file_state);
  const months = Array.from({ length: 12 }, (_, i) => { const ym = `${y}-${String(i + 1).padStart(2, "0")}`, xs = live.filter(r => (r.issued_date || "").startsWith(ym));
    return [TH_M[i], xs.filter(r => dirOf(r.series_code) !== "in").length, xs.filter(r => dirOf(r.series_code) === "in").length]; });
  const mx = Math.max(1, ...months.map(m => m[1] + m[2]));
  const years = [...new Set(S.rows.map(r => r.year))].sort((a, b) => b - a);
  const overdue = S.rows.filter(r => O(r.id).overdue);
  $("#spMain").innerHTML = head("รายงาน", `ปี ${y + 543} · นับเฉพาะเอกสารที่บัญชีนี้มีสิทธิ์เห็น`, `<select class="in" id="rpY" style="width:auto">${years.map(v => `<option value="${v}" ${v === y ? "selected" : ""}>${v + 543}</option>`).join("")}</select>`) + `
    <div class="rp">
      <div class="card card-b"><div class="card-t">ตามสถานะ</div>${bars(st.map(([k, n]) => [STAGE[k]?.[0] || k, n, STAGE[k]?.[1]]), live.length)}</div>
      <div class="card card-b"><div class="card-t">รายเดือน (ออก / รับ)</div><div class="mon">${months.map(([l, o, i]) => `<div><span class="c"><i class="o" style="height:${o / mx * 100}%"></i><i class="i" style="height:${i / mx * 100}%"></i></span><b>${o + i || ""}</b><em>${l}</em></div>`).join("")}</div>
        <div class="hint"><i class="lg-o"></i>ส่งออก <i class="lg-i"></i>รับเข้า</div></div>
      <div class="card card-b"><div class="card-t">ตามประเภท</div>${bars(ty.map(([k, n]) => [k, n]), live.length)}</div>
      <div class="card card-b"><div class="card-t">สำรวจไฟล์</div>${bars(fs.map(([k, n]) => [k === "na" ? "ไม่ต้องดู (ร่าง/จอง/ยกเลิก)" : FSTATE[k]?.[0] || k, n, FSTATE[k]?.[1]]), live.length)}
        <div class="hint" style="margin-top:10px">“ข้อมูลเดิม · ยังไม่สำรวจ” = รายการนำเข้าจาก Excel ที่ไม่เคยแนบไฟล์ ไม่ได้แปลว่าสูญหาย — ตรวจตู้เอกสารแล้วกำหนดฉบับจริง หรือระบุ “ไม่ต้องแนบ” พร้อมเหตุผลทีละเรื่อง ·
          “ฉบับอยู่ในระบบออกหนังสือ” = หนังสือสร้างและอนุมัติในระบบ HR (ภาพลายเซ็น) แนบสแกนฉบับที่ส่งจริงได้ถ้าต้องการหลักฐาน</div>
        <button class="btn btn-s btn-sm" id="rpNeed" style="margin-top:10px">ดูรายการที่ยังไม่ครบ</button></div>
    </div>
    ${section("เกินกำหนด", "", overdue, "ไม่มีเรื่องเกินกำหนด")}
    <div id="rpDisp"></div><div id="rpAudit"></div>`;
  $("#rpY").onchange = e => { S.f.ry = e.target.value; renderReports(); };
  $("#rpNeed").onclick = () => { S.f.fs = "need"; S.f.year = String(y); location.hash = "#/index"; };
  wireRows();
  if (can("doc.retention") || can("doc.dispose.approve")) renderDisposal();
  if (can("doc.manage") || can("doc.retention") || can("doc.dispose.approve")) {
    try { const a = await rpc("dms_audit", { p_limit: 100 });
      $("#rpAudit").innerHTML = `<div class="card card-b"><div class="card-t">ประวัติระดับระบบ (ตั้งค่า · นโยบาย · Export · ทำลาย)</div><ol class="tl">${a.map(x => `<li><b>${esc(EV_LABEL[x.action] || x.action)}</b><span>${esc(x.actor_name || "")} · ${esc(thTime(x.at))}</span>${x.detail || x.reason ? `<em>${esc([x.detail, x.reason].filter(Boolean).join(" · "))}</em>` : ""}</li>`).join("") || "<li><span>—</span></li>"}</ol></div>`;
    } catch {}
  }
}
async function renderDisposal() {
  let cand = { items: [] }, list = [];
  try { [cand, list] = await Promise.all([can("doc.retention") ? rpc("dms_disposal_candidates") : { items: [] }, rpc("dms_disposal_list")]); } catch (e) { return; }
  const ok = cand.items.filter(x => !x.block), soon = cand.items.filter(x => x.block && x.until);
  const ST = { proposed: ["รออนุมัติ", "w"], approved: ["อนุมัติแล้ว · รอทำลาย", "b"], rejected: ["ไม่อนุมัติ", "r"], done: ["ทำลายแล้ว", "g"] };
  $("#rpDisp").innerHTML = `<div class="card card-b" style="margin-bottom:16px"><div class="card-t">พิจารณาทำลาย</div>
    <p class="hint" style="margin-bottom:10px">เข้าเกณฑ์ = ครบอายุตามนโยบายที่ “เปิดใช้” แล้ว + ปิดเรื่องแล้ว + ไม่ถูกระงับ · ระบบไม่ลบอัตโนมัติ ต้องเสนอ → ผู้อื่นอนุมัติ → บันทึกหลักฐาน</p>
    ${ok.length ? `<table class="tbl"><thead><tr><th><input type="checkbox" id="dpAll"></th><th>เลขที่</th><th>ประเภท</th><th>ครบอายุ</th></tr></thead><tbody>${ok.map(x => `<tr><td><input type="checkbox" data-dp="${x.id}"></td><td>${esc(x.doc_no)}</td><td>${esc(x.type_label || "")}</td><td>${thDate(x.until)}</td></tr>`).join("")}</tbody></table>
      <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap"><input class="in grow" id="dpT" placeholder="ชื่อรายการ เช่น ทำลายเอกสารครบอายุ ไตรมาส 4/2569"><select class="in" id="dpF" style="max-width:220px"><option value="keep">เก็บไฟล์ในระบบไว้</option><option value="delete">ลบไฟล์ในระบบด้วย</option></select>
        <select class="in" id="dpP" style="max-width:220px"><option value="shred">ทำลายต้นฉบับกระดาษ</option><option value="none">ไม่มีต้นฉบับกระดาษ</option><option value="other">อื่น ๆ (ระบุในหลักฐาน)</option></select><button class="btn btn-d" id="dpGo">เสนอทำลาย</button></div>`
      : `<div class="hint">ไม่มีรายการที่เข้าเกณฑ์${soon.length ? ` · ${soon.length} รายการมีวันครบอายุแล้วแต่ยังติดเงื่อนไข` : ""}${!cand.items.length ? " · ยังไม่มีนโยบายอายุเก็บที่เปิดใช้ (หน้าตั้งค่า)" : ""}</div>`}</div>
    ${list.length ? `<div class="card card-b" style="margin-bottom:16px"><div class="card-t">รายการทำลาย</div>${list.map(x => `<div class="fl"><div class="t"><b>#${x.id} ${esc(x.title)} <span class="bd ${ST[x.status]?.[1] || "n"}">${ST[x.status]?.[0] || x.status}</span></b>
      <span>${x.items.length} เรื่อง · เสนอโดย ${esc(x.proposed_by_name || "")} ${esc(thTime(x.proposed_at))}${x.decided_by_name ? ` · ${x.status === "rejected" ? "ไม่อนุมัติ" : "อนุมัติ"}โดย ${esc(x.decided_by_name)}` : ""}${x.executed_at ? ` · ทำลาย ${esc(thTime(x.executed_at))} หลักฐาน ${esc(x.evidence_ref || "")}` : ""}</span>
      <span>${x.files_action === "delete" ? "ลบไฟล์ในระบบ" : "เก็บไฟล์ไว้"} · ${{ shred: "ทำลายกระดาษ", none: "ไม่มีกระดาษ", other: "อื่น ๆ" }[x.paper_method] || ""}${x.items.some(i => i.result === "skipped") ? ` · ข้าม ${x.items.filter(i => i.result === "skipped").length} เรื่อง (ระงับ)` : ""}</span>
      <span class="sub">${x.items.slice(0, 20).map(i => esc(i.doc_no)).join(", ")}${x.items.length > 20 ? " …" : ""}</span></div>
      ${x.status === "proposed" && can("doc.dispose.approve") ? `<button class="btn btn-s btn-sm" data-dok="${x.id}">อนุมัติ</button><button class="btn btn-g btn-sm" data-dno="${x.id}">ไม่อนุมัติ</button>` : ""}
      ${x.status === "approved" && can("doc.dispose.approve") ? `<button class="btn btn-d btn-sm" data-dex="${x.id}" data-pm="${x.paper_method}">บันทึกผลการทำลาย</button>` : ""}</div>`).join("")}</div>` : ""}`;
  const g = s => $("#rpDisp").querySelector(s);
  g("#dpAll")?.addEventListener("change", e => $("#rpDisp").querySelectorAll("[data-dp]").forEach(c => c.checked = e.target.checked));
  g("#dpGo")?.addEventListener("click", async () => {
    const ids = [...$("#rpDisp").querySelectorAll("[data-dp]:checked")].map(c => +c.dataset.dp); if (!ids.length) return toast("เลือกรายการ", "err");
    if (!confirm(`เสนอทำลาย ${ids.length} เรื่อง? ต้องมีผู้อื่นที่มีสิทธิ์อนุมัติก่อนทำลาย`)) return;
    try { await rpc("dms_disposal_propose", { p_title: g("#dpT").value, p_doc_ids: ids, p_files_action: g("#dpF").value, p_paper_method: g("#dpP").value }); toast("เสนอแล้ว", "ok"); renderDisposal(); } catch (e) { fail(e); }
  });
  $("#rpDisp").querySelectorAll("[data-dok],[data-dno]").forEach(b => b.onclick = async () => {
    const yes = !!b.dataset.dok, note = yes ? prompt("บันทึก (ไม่บังคับ)", "") : prompt("เหตุผลที่ไม่อนุมัติ"); if (note === null || (!yes && !note)) return;
    try { await rpc("dms_disposal_decide", { p_id: +(b.dataset.dok || b.dataset.dno), p_approve: yes, p_note: note }); toast("บันทึกแล้ว", "ok"); renderDisposal(); } catch (e) { fail(e); }
  });
  $("#rpDisp").querySelectorAll("[data-dex]").forEach(b => b.onclick = async () => {
    const ev = prompt("หลักฐานการทำลาย (เลขบันทึก / ใบรับรองการทำลาย / ผู้ควบคุม)"); if (!ev) return;
    const paper = b.dataset.pm === "shred" ? confirm("ยืนยันว่าทำลายต้นฉบับกระดาษเรียบร้อยแล้ว?") : true; if (!paper) return;
    try { const res = await rpc("dms_disposal_execute", { p_id: +b.dataset.dex, p_evidence_ref: ev, p_paper_done: paper }); toast(`บันทึกผลแล้ว ${res.done} เรื่อง`, "ok"); await loadAll(); renderReports(); } catch (e) { fail(e); }
  });
}

// ---------------------------------------------------------------- ตั้งค่า: ประเภท · ขั้นตอนตามประเภท · อายุเก็บ · นำเข้า Excel เดิม
async function renderSettings() {
  const w = canWrite(), mg = can("doc.manage"), rt = can("doc.retention");
  let R = { rules: [], policies: [] }; try { R = await rpc("dms_rules"); } catch {}
  const pol = R.policies, polName = id => pol.find(p => p.id === id)?.name || "";
  const yes = (v, k, id) => `<td style="text-align:center"><input type="checkbox" data-rk="${k}" data-rid="${id}" ${v ? "checked" : ""} ${mg ? "" : "disabled"}></td>`;
  $("#spMain").innerHTML = head("ตั้งค่า", "ชุดเลข · ประเภท · ขั้นตอนตามประเภท · อายุเก็บ · นำเข้าประวัติ") + `
    <div class="card card-b" style="margin-bottom:16px"><div class="card-t">ชุดเลข</div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>ชุด</th><th>ชื่อ</th><th>รูปแบบเลข</th><th>ทิศทาง</th><th>เลขถัดไป</th></tr></thead><tbody>
      ${S.series.map(s => `<tr><td><b>${esc(s.code)}</b></td><td>${esc(s.label)}</td><td>${esc(s.prefix)}-001-${new Date().getFullYear()}</td><td>${s.direction === "in" ? "รับเข้า" : "ส่งออก"}</td><td>${esc(S.next[s.code] || "—")}</td></tr>`).join("")}</tbody></table></div>
      <div class="hint" style="margin-top:8px">ลำดับนับแยกตามชุดและปี ค.ศ. ของวันที่เอกสาร (ตัวเลขปีในฐานข้อมูล ไม่ใช่ข้อความที่แสดง) เริ่ม 001 ทุกปี · ออกพร้อมกันได้เลขต่อกันไม่ซ้ำ · เลขที่ออกแล้วลบไม่ได้ ยกเลิกได้และไม่ถูกนำกลับมาใช้ · หน้าจอแสดงปี พ.ศ. ส่วนเลขเอกสารใช้ ค.ศ. ตามระบบเดิม</div></div>
    <div class="card card-b" style="margin-bottom:16px"><div class="card-t">ขั้นตอนตามประเภท${mg ? "" : ` <span class="hint">(แก้ได้เฉพาะผู้ดูแลสารบรรณ)</span>`}</div>
      <div class="tbl-wrap"><table class="tbl rtbl"><thead><tr><th>ประเภท</th><th>ตรวจทาน</th><th>อนุมัติ</th><th>ลงนาม</th><th>ส่งมอบ</th><th>รับทราบ</th><th>ต้องมีร่าง</th><th>ต้องมีฉบับลงนาม</th><th>ชั้นข้อมูล</th><th>อายุเก็บ</th><th>กำหนด (วัน)</th></tr></thead><tbody>
      ${R.rules.filter(x => x.is_active).map(x => `<tr data-rt="${x.type_id}"><td><b>${esc(x.label)}</b><div class="sub">${esc(x.series_code)}${x.stored ? "" : " · ค่าเริ่มต้น"}</div></td>
        ${yes(x.need_review, "need_review", x.type_id)}${yes(x.need_approval, "need_approval", x.type_id)}${yes(x.need_sign, "need_sign", x.type_id)}${yes(x.need_delivery, "need_delivery", x.type_id)}${yes(x.need_ack, "need_ack", x.type_id)}${yes(x.need_draft_file, "need_draft_file", x.type_id)}${yes(x.need_signed_file, "need_signed_file", x.type_id)}
        <td><select class="in in-sm" data-rs="${x.type_id}" ${mg ? "" : "disabled"}>${Object.entries(SENS).map(([k, l]) => `<option value="${k}" ${x.sensitivity === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
        <td><select class="in in-sm" data-rp="${x.type_id}" ${mg ? "" : "disabled"}><option value="">—</option>${pol.map(p => `<option value="${p.id}" ${x.retention_id === p.id ? "selected" : ""}>${esc(p.name)}${p.status === "active" ? "" : " (ร่าง)"}</option>`).join("")}</select></td>
        <td><input class="in in-sm" type="number" min="0" data-rd="${x.type_id}" value="${x.due_days ?? ""}" style="width:70px" ${mg ? "" : "disabled"}></td></tr>`).join("")}</tbody></table></div>
      ${mg ? `<div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn btn-p" id="rlSave">บันทึกขั้นตอน</button></div>` : ""}
      <div class="hint" style="margin-top:8px">ค่าเริ่มต้นตั้งจากชื่อประเภท (เช่น หนังสือเลิกจ้าง = ตรวจทาน + รับทราบ, Memo = ไม่ต้องลงนาม, หนังสือรับเข้า = ลงทะเบียน → ดำเนินการ → ปิด) — ตรวจแล้วแก้ให้ตรงงานจริง · ชั้นข้อมูลใช้กับเรื่องใหม่</div></div>
    <div class="card card-b" style="margin-bottom:16px"><div class="card-t">นโยบายอายุเก็บ${rt ? "" : ` <span class="hint">(แก้ได้เฉพาะผู้มีสิทธิ์อายุเก็บ)</span>`}</div>
      ${pol.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>ชื่อ</th><th>ระยะเวลา</th><th>เริ่มนับ</th><th>อ้างอิง</th><th>ผู้อนุมัตินโยบาย</th><th>สถานะ</th><th></th></tr></thead><tbody>
        ${pol.map(p => `<tr><td><b>${esc(p.name)}</b></td><td>${p.years ? p.years + " ปี " : ""}${p.months ? p.months + " เดือน" : ""}</td><td>${esc({ doc_date: "วันที่เอกสาร", closed: "วันปิดเรื่อง", effective: "วันที่มีผล", employment_end: "วันพ้นสภาพพนักงาน" }[p.start_event] || "")}</td>
          <td>${esc(p.basis || "—")}</td><td>${esc(p.approved_by_name || "—")}${p.approved_on ? ` · ${thDate(p.approved_on)}` : ""}</td><td><span class="bd ${p.status === "active" ? "g" : p.status === "retired" ? "r" : "n"}">${{ active: "ใช้งาน", draft: "ร่าง — ยังไม่มีผล", retired: "เลิกใช้" }[p.status]}</span></td>
          <td>${rt ? `<button class="btn btn-g btn-sm" data-pol="${p.id}">${IC.pen}</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<div class="hint">ยังไม่มีนโยบาย — ระบบจะไม่คำนวณวันครบอายุและไม่มีเอกสารเข้าเกณฑ์ทำลาย</div>`}
      ${rt ? `<button class="btn btn-s btn-sm" data-pol="" style="margin-top:10px">${IC.plus}เพิ่มนโยบาย</button>` : ""}
      <div class="note" style="margin-top:10px">ต้องกำหนดเป็นรายประเภท ห้ามใช้อายุเดียวทั้ง HR · นโยบายใหม่เป็น “ร่าง” จนกว่าผู้มีสิทธิ์อนุมัติทำลายจะเปิดใช้ พร้อมชื่อผู้อนุมัตินโยบาย วันที่ และข้อกำหนดอ้างอิง · เปิดใช้แล้วก็ไม่ลบอัตโนมัติ</div></div>
    <div class="card card-b" style="margin-bottom:16px"><div class="card-t">ประเภทเอกสาร</div>
      <div class="tbl-wrap"><table class="tbl tytbl"><thead><tr><th>ชุด</th><th>ชื่อประเภท</th><th>รหัสแบบฟอร์ม</th><th>ลับ</th><th>ใช้งาน</th></tr></thead><tbody>
      ${S.types.map(t => `<tr><td>${esc(S.series.find(s => s.code === t.series_code)?.label || t.series_code)}</td>
        <td><input class="in" data-tl="${t.id}" value="${esc(t.label)}" ${w ? "" : "disabled"}></td><td><input class="in" data-tf="${t.id}" value="${esc(t.form_code || "")}" placeholder="—" ${w ? "" : "disabled"}></td>
        <td style="text-align:center"><input type="checkbox" data-tc="${t.id}" ${t.confidential ? "checked" : ""} ${w ? "" : "disabled"}></td><td style="text-align:center"><input type="checkbox" data-ta="${t.id}" ${t.is_active ? "checked" : ""} ${w ? "" : "disabled"}></td></tr>`).join("")}</tbody></table></div>
      ${w ? `<div class="row" style="margin-top:12px"><select class="in" id="tyS" style="max-width:220px">${S.series.map(s => `<option value="${esc(s.code)}">${esc(s.label)}</option>`).join("")}</select>
        <input class="in grow" id="tyNew" placeholder="ชื่อประเภทใหม่"><button class="btn btn-s" id="tyAdd">${IC.plus}เพิ่ม</button><button class="btn btn-p" id="tySave">บันทึก</button></div>` : ""}
      <div class="hint" style="margin-top:8px">ติ๊ก “ลับ” = เลขใหม่ของประเภทนี้เป็นเอกสารลับอัตโนมัติ (เลขเก่าไม่เปลี่ยน) · เปลี่ยนชื่อประเภทไม่กระทบเลขที่ออกไปแล้ว</div></div>
    ${w && can("data.doc.confidential") ? `<div class="card card-b" style="margin-bottom:16px"><div class="card-t">สัญญาจ้างงานในทะเบียน</div>
      <p class="sp-sub" style="margin-bottom:12px">สัญญาที่ส่งลงนามตั้งแต่วันนี้ได้เลข HR อัตโนมัติ (ส่งใหม่หลังถูกส่งกลับใช้เลขเดิม · ยกเลิกสัญญา = ยกเลิกเลข · ไม่พิมพ์เลขบนตัวสัญญา)
        <br>สัญญาที่ทำก่อนหน้านี้และยังไม่มีเลข: <b id="ecN">…</b> ฉบับ</p><button class="btn btn-s" id="ecFill" disabled>ออกเลขให้สัญญาเดิม</button></div>` : ""}
    ${w ? `<div class="card card-b" style="margin-bottom:16px"><div class="card-t">ใบลาออกจาก Staff Movement</div>
      <p class="sp-sub" style="margin-bottom:12px">บันทึก Movement “Resignation” พร้อมแนบใบลาออก → ลงรับในทะเบียน (เลข RCV ประเภทใบลาออก) และคัดลอกไฟล์มาให้อัตโนมัติ · เปลี่ยนไฟล์ภายหลัง = เพิ่มไฟล์ในเรื่องเดิม
        <br>Movement ลาออกที่แนบไฟล์ไว้แล้วแต่ยังไม่อยู่ในทะเบียน: <b id="mvN">…</b> รายการ</p><button class="btn btn-s" id="mvFill" disabled>ลงรับรายการเดิม</button></div>` : ""}
    ${w ? `<div class="card card-b"><div class="card-t">นำเข้าประวัติจาก Excel เดิม</div><p class="sp-sub" style="margin-bottom:12px">ไฟล์ “01 ลำดับเอกสาร HR.xlsx” (ชีต HR และ Memo) · นำเข้าซ้ำได้ เลขที่มีแล้วข้าม</p>
      <label class="btn btn-s" style="cursor:pointer">${IC.up}เลือกไฟล์ Excel<input type="file" id="dxImp" accept=".xlsx,.xls" hidden></label></div>` : ""}`;
  $("#rlSave")?.addEventListener("click", async () => {
    let n = 0;
    for (const x of R.rules.filter(z => z.is_active)) {
      const row = document.querySelector(`[data-rt="${x.type_id}"]`), v = {};
      row.querySelectorAll("[data-rk]").forEach(c => v[c.dataset.rk] = c.checked);
      Object.assign(v, { flow: x.flow, sensitivity: row.querySelector("[data-rs]").value, retention_id: +row.querySelector("[data-rp]").value || null, due_days: row.querySelector("[data-rd]").value });
      const same = Object.keys(v).every(k => String(v[k] ?? "") === String(x[k] ?? ""));
      if (same && x.stored) continue;
      if (same) continue;
      try { await rpc("dms_rule_save", { p_type_id: x.type_id, p_rule: v }); n++; } catch (e) { return fail(e, `บันทึก ${x.label}`); }
    }
    toast(n ? `บันทึก ${n} ประเภทแล้ว` : "ไม่มีอะไรเปลี่ยน", "ok"); renderSettings();
  });
  document.querySelectorAll("[data-pol]").forEach(b => b.onclick = () => policyForm(pol.find(p => p.id === +b.dataset.pol)));
  if ($("#ecN")) rpc("dms_contract_pending").then(x => { $("#ecN").textContent = x.count; $("#ecFill").disabled = !x.count; }).catch(() => { $("#ecN").textContent = "—"; });
  if ($("#mvN")) rpc("dms_movement_pending").then(x => { $("#mvN").textContent = x.count; $("#mvFill").disabled = !x.count; }).catch(() => { $("#mvN").textContent = "—"; });
  $("#mvFill")?.addEventListener("click", async () => {
    if (!confirm(`ลงรับใบลาออกจาก Movement ${$("#mvN").textContent} รายการ (ออกเลข RCV เรียงตามวันที่บันทึก และคัดลอกไฟล์)? เลขที่ออกแล้วลบไม่ได้`)) return;
    try { const x = await rpc("dms_movement_backfill"); toast(`ลงรับแล้ว ${x.count} รายการ`, "ok"); await loadAll(); renderSettings(); } catch (e) { fail(e); }
  });
  $("#ecFill")?.addEventListener("click", async () => {
    if (!confirm(`ออกเลข HR ให้สัญญาจ้างเดิม ${$("#ecN").textContent} ฉบับ เรียงตามวันที่สัญญา? เลขที่ออกแล้วลบไม่ได้ (ยกเลิกได้)`)) return;
    try { const x = await rpc("dms_contract_backfill"); toast(`ออกเลขให้ ${x.count} ฉบับแล้ว`, "ok"); await loadAll(); renderSettings(); } catch (e) { fail(e); }
  });
  $("#tyAdd")?.addEventListener("click", async () => {
    const label = $("#tyNew").value.trim(); if (!label) return;
    try { S.types.push(await q(supabase.from("doc_types").insert({ series_code: $("#tyS").value, label, sort_order: 90 }).select().single())); renderSettings(); } catch (e) { fail(e, "เพิ่มไม่สำเร็จ"); }
  });
  $("#tySave")?.addEventListener("click", async () => {
    for (const t of S.types) {
      const v = { label: $(`[data-tl="${t.id}"]`).value.trim(), form_code: $(`[data-tf="${t.id}"]`).value.trim() || null, confidential: $(`[data-tc="${t.id}"]`).checked, is_active: $(`[data-ta="${t.id}"]`).checked };
      if (!v.label || (v.label === t.label && v.form_code === (t.form_code || null) && v.confidential === t.confidential && v.is_active === t.is_active)) continue;
      const { error } = await supabase.from("doc_types").update(v).eq("id", t.id); if (error) return fail(error, "บันทึกไม่สำเร็จ");
      Object.assign(t, v);
    }
    toast("บันทึกแล้ว", "ok");
  });
  const imp = $("#dxImp"); if (imp) imp.onchange = () => { const f = imp.files[0]; imp.value = ""; if (f) importFile(f); };
}
function policyForm(p = {}) {
  const x = modal(p.id ? "แก้นโยบายอายุเก็บ" : "เพิ่มนโยบายอายุเก็บ", `<div class="grid2">
    <label class="fld" style="grid-column:1/-1"><span>ชื่อนโยบาย *</span><input class="in" id="pN" value="${esc(p.name || "")}" placeholder="เช่น หนังสือรับรองการทำงาน"></label>
    <label class="fld"><span>ปี</span><input type="number" min="0" class="in" id="pY" value="${p.years ?? ""}"></label>
    <label class="fld"><span>เดือน</span><input type="number" min="0" class="in" id="pM" value="${p.months ?? ""}"></label>
    <label class="fld" style="grid-column:1/-1"><span>เริ่มนับจาก *</span><select class="in" id="pE">${Object.entries({ doc_date: "วันที่เอกสาร", closed: "วันปิดเรื่อง", effective: "วันที่มีผล", employment_end: "วันพ้นสภาพพนักงาน (ตามทะเบียนพนักงาน)" }).map(([k, l]) => `<option value="${k}" ${p.start_event === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="fld" style="grid-column:1/-1"><span>เหตุผล / ข้อกำหนดอ้างอิง</span><textarea class="in" id="pB" rows="2" placeholder="เช่น ระเบียบบริษัท / กฎหมายที่เกี่ยวข้อง (ให้ฝ่ายกฎหมายยืนยัน)">${esc(p.basis || "")}</textarea></label>
    <label class="fld"><span>ผู้อนุมัตินโยบาย</span><input class="in" id="pA" value="${esc(p.approved_by_name || "")}"></label>
    <label class="fld"><span>วันที่อนุมัติ</span><input type="date" class="in" id="pAd" value="${esc(p.approved_on || "")}"></label>
    <label class="fld"><span>สถานะ</span><select class="in" id="pS">${Object.entries({ draft: "ร่าง (ยังไม่มีผล)", active: "เปิดใช้", retired: "เลิกใช้" }).map(([k, l]) => `<option value="${k}" ${(p.status || "draft") === k ? "selected" : ""} ${k === "active" && !can("doc.dispose.approve") ? "disabled" : ""}>${l}</option>`).join("")}</select></label>
    <label class="fld"><span>หมายเหตุ</span><input class="in" id="pNo" value="${esc(p.note || "")}"></label></div>
    <div class="note" style="margin-top:10px">เปิดใช้ได้เมื่อมีผู้อนุมัตินโยบาย วันที่ และข้อกำหนดอ้างอิง · ผู้เปิดใช้ต้องมีสิทธิ์อนุมัติทำลาย · ผูกนโยบายกับประเภทที่ตาราง “ขั้นตอนตามประเภท”</div>`,
    `<button class="btn btn-s" data-x>ยกเลิก</button><button class="btn btn-p" data-ok>บันทึก</button>`);
  const v = id => x.querySelector("#" + id).value;
  x.querySelector("[data-ok]").onclick = async () => {
    try { await rpc("dms_retention_save", { p_policy: { id: p.id || null, name: v("pN"), years: v("pY"), months: v("pM"), start_event: v("pE"), basis: v("pB"), approved_by_name: v("pA"), approved_on: v("pAd") || null, status: v("pS"), note: v("pNo") } });
      x.remove(); toast("บันทึกแล้ว", "ok"); renderSettings(); } catch (e) { fail(e); }
  };
}
async function importFile(file) {
  let parsed;
  try { const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    parsed = parseDocLog(Object.fromEntries(wb.SheetNames.map(n => [n.trim(), XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" })]))); }
  catch (e) { return fail(e, "อ่านไฟล์ไม่ได้"); }
  const have = new Set(S.rows.map(r => `${r.series_code}|${r.year}|${r.seq}`)), fresh = parsed.rows.filter(r => !have.has(`${r.series_code}|${r.year}|${r.seq}`));
  const el = modal(`นำเข้าจาก ${esc(file.name)}`, `<p><b>${parsed.rows.length}</b> เลขที่ใช้แล้วในไฟล์ · <b>${fresh.length}</b> เลขที่ยังไม่มีในระบบ (จะนำเข้า)</p>
    ${parsed.skipped.length ? `<div class="note r" style="margin-top:8px">ข้าม ${parsed.skipped.length} แถวที่อ่านไม่ออก</div>` : ""}
    <div class="tbl-wrap" style="max-height:300px;overflow:auto;margin-top:10px"><table class="tbl"><thead><tr><th>เลขที่</th><th>ประเภท</th><th>เรื่อง</th><th>ออกให้</th></tr></thead><tbody>
    ${fresh.slice(0, 300).map(r => `<tr><td>${esc(`${prefixOf(r.series_code)}-${String(r.seq).padStart(3, "0")}-${r.year}`)}</td><td>${esc(r.type_label)}</td><td>${esc(r.subject)}</td><td>${esc(r.person_name)}</td></tr>`).join("")}</tbody></table></div>`,
    `<button class="btn btn-s" data-x>ยกเลิก</button><button class="btn btn-p" data-ok ${fresh.length ? "" : "disabled"}>นำเข้า ${fresh.length} รายการ</button>`, true);
  el.querySelector("[data-ok]").onclick = async e => {
    e.target.disabled = true; let n = 0;
    for (let i = 0; i < fresh.length; i += 200) {
      const { data, error } = await supabase.rpc("doc_import", { p_rows: fresh.slice(i, i + 200) });
      if (error) { e.target.disabled = false; return fail(error, "นำเข้าไม่สำเร็จ"); }
      n += data || 0;
    }
    el.remove(); toast(`นำเข้าแล้ว ${n} รายการ`, "ok"); await loadAll(); renderSettings();
  };
}
async function exportExcel(list) {
  if (!list.length) return toast("ไม่มีรายการให้ export");
  try { await rpc("dms_export_log", { p_count: list.length, p_filter: JSON.stringify(S.f) }); } catch (e) { return fail(e, "Export ไม่ได้"); }
  const data = list.map(r => { const o = O(r.id), x = S.sources.get(r.id);
    return { "เลขที่": r.doc_no, "ทิศทาง": dirOf(r.series_code) === "in" ? "รับเข้า" : "ส่งออก", "วันที่": r.issued_date || "", "ประเภท": r.type_label || "", "เรื่อง": r.subject || "",
      "ออกให้ / จาก": dirOf(r.series_code) === "in" ? r.sender || r.person_name || "" : r.person_name || "", "รหัสพนักงาน": r.emp_code || "", "อ้างอิง": r.ref_doc_no || "",
      "สถานะ": STAGE[o.stage]?.[0] || "", "ผู้รับผิดชอบ": o.owner_name || "", "กำหนดเสร็จ": o.due_date || "", "ไฟล์": FSTATE[o.file_state]?.[0] || "", "ชั้นข้อมูล": SENS[o.sensitivity || "general"] || "",
      "ที่มา": ORIGIN[o.origin] || "", "ระบบต้นทาง": x ? `${SRC_NAME[x.kind]?.[1] || ""} · ${SRC_ST[x.status]?.[0] || x.status}` : "", "แบบฟอร์ม": r.form_code || "",
      "เลขยกเลิก": r.status === "void" ? `ยกเลิก${r.void_reason ? ": " + r.void_reason : ""}` : "", "หมายเหตุ": r.note || "" }; });
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "ทะเบียน");
  XLSX.writeFile(wb, `ทะเบียนเอกสาร_${S.f.year || "ทุกปี"}.xlsx`);
}

boot();
