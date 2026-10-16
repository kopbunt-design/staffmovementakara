// ============================================================================
// สารบัญเอกสาร HR (เว็บ /docs) — แทนหน้า "ทะเบียนเลขที่เอกสาร" ในระบบ HR (2026-10-16)
//   หน้า: #/index · #/issue (ออกเลข) · #/receive (ลงรับ) · #/nofile · #/settings
//   ทุกเลข (ออกเลขเอง / หนังสือ HR / PAF / ลงรับ) มาจาก doc_issue → ตาราง doc_register ตารางเดียว → สารบัญเห็นอัตโนมัติ
//   ไฟล์แนบ: bucket doc-files/<doc_id>/… · เปิด/แนบ/ลบไฟล์บันทึกผ่าน doc_log · เอกสารลับเห็นได้เฉพาะ data.doc.confidential (RLS)
//   ห้าม import js/app.js
// ============================================================================
import { supabase } from "../js/supabase-config.js";
import { parseDocLog, nextNo, filterDocs, storageName } from "../js/doc-register-calc.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TH_M = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const thDate = iso => { if (!iso) return "—"; const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return `${d} ${TH_M[m - 1]} ${String(y + 543).slice(2)}`; };
const thTime = ts => ts ? new Date(ts).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "";
const todayISO = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
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
};
const MAX_FILE = 20 * 1048576;
// ประเภทที่ระบบออกหนังสือ HR สร้างตัวหนังสือให้ได้ → ปุ่ม "สร้างหนังสือ" (ส่งต่อไปหน้าออกหนังสือในระบบ HR)
const LETTER_KIND = { "หนังสือรับรองการทำงาน (ภาษาไทย)": "cert_th", "หนังสือรับรองการทำงาน (ภาษาอังกฤษ)": "cert_en",
  "หนังสือรับรองเงินเดือน (ภาษาไทย)": "salary_th", "หนังสือรับรองเงินเดือน (ภาษาอังกฤษ)": "salary_en", "Offer Letter (จดหมายจ้างงาน)": "offer_en" };
const SRC_ST = { draft: ["ร่าง", "n", ""], pending: ["รออนุมัติ", "w", "wait"], approved: ["อนุมัติแล้ว", "g", "ok"], rejected: ["ส่งกลับแก้ไข", "r", "no"], cancelled: ["ยกเลิก", "r", "no"] };

const S = { user: null, perms: new Set(), series: [], types: [], rows: [], files: new Map(), sources: new Map(), emps: [], f: { year: String(new Date().getFullYear()) } };
const can = k => S.perms.has(k), canWrite = () => can("data.docregister.write");
const q = async p => { const { data, error } = await p; if (error) throw error; return data; };
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

// ---------------------------------------------------------------- เริ่มต้น
async function boot() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { $("#spMain").innerHTML = `<div class="card card-b" style="max-width:460px;margin:60px auto;text-align:center"><div class="card-t" style="justify-content:center">กรุณาเข้าสู่ระบบ</div><p class="sp-sub" style="margin-bottom:16px">ใช้บัญชีเดียวกับระบบ HR</p><a class="btn btn-p" href="/">ไปหน้าเข้าสู่ระบบ HR</a></div>`; return; }
  S.user = session.user;
  const { data: perms } = await supabase.rpc("my_permissions");
  S.perms = new Set((perms || []).map(p => typeof p === "string" ? p : p.perm_key || p.key));
  const name = S.user.user_metadata?.full_name || S.user.email || "";
  $("#spUser").innerHTML = `<div class="sp-av">${esc(name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase())}</div><div><b>${esc(name)}</b><span>${canWrite() ? "HR · ออกเลขได้" : "ดูอย่างเดียว"}${can("data.doc.confidential") ? " · ดูเอกสารลับ" : ""}</span></div>`;
  if (!can("page.docregister")) { $("#spMain").innerHTML = `<div class="empty">บัญชีนี้ยังไม่มีสิทธิ์ใช้สารบัญเอกสาร — ให้ Admin เพิ่มสิทธิ์ “ทะเบียนเลขที่เอกสาร” ที่ User Management</div>`; return; }
  try { await loadAll(); } catch (e) { $("#spMain").innerHTML = `<div class="card card-b"><b>โหลดข้อมูลไม่สำเร็จ</b><p class="sp-sub">${esc(e.message)}</p><p class="hint" style="margin-top:8px">ต้องรัน <code>sql/schema_doc_index.sql</code> ใน Supabase ก่อน (หลัง schema_doc_register.sql)</p></div>`; return; }
  window.addEventListener("hashchange", route); route();
}
async function loadAll() {
  const [s, t, r, f, src] = await Promise.all([q(supabase.from("doc_series").select("*").order("sort_order")), q(supabase.from("doc_types").select("*").order("sort_order")),
    fetchAll(() => supabase.from("doc_register").select("*").order("year", { ascending: false }).order("seq", { ascending: false })),
    fetchAll(() => supabase.from("doc_files").select("doc_id")), supabase.rpc("doc_sources")]);
  S.series = s; S.types = t; S.rows = r;
  S.files = new Map(); for (const x of f) S.files.set(x.doc_id, (S.files.get(x.doc_id) || 0) + 1);
  S.sources = new Map((src.data || []).map(x => [x.doc_id, x]));
  const n = filterDocs(S.rows, { nofile: true, year: new Date().getFullYear() }, dirOf, S.files).length;
  $("#navNoFile").textContent = n ? String(n) : "";
}
async function loadEmps() {   // รายชื่อพนักงานให้เลือกตอนออกเลข — ไม่มีสิทธิ์อ่านทะเบียนพนักงานก็พิมพ์ชื่อเองได้
  if (S.emps.length) return;
  const { data } = await supabase.from("employees").select("emp_code,firstname_th,lastname_th,firstname_en,lastname_en,department").order("emp_code").limit(5000);
  S.emps = (data || []).filter(e => e.emp_code);
}
const empName = e => [e.firstname_th, e.lastname_th].filter(Boolean).join(" ") || [e.firstname_en, e.lastname_en].filter(Boolean).join(" ");
const empList = () => `<datalist id="dxEmps">${S.emps.map(e => `<option value="${esc(e.emp_code)} · ${esc(empName(e))}">`).join("")}</datalist>`;
function personOf(text) {   // "รหัส · ชื่อ" จากรายการ · รหัสอย่างเดียว · หรือชื่อคนนอกที่พิมพ์เอง
  const t = String(text || "").trim(); if (!t) return {};
  const code = t.split(/\s*·\s*|\s+/)[0], e = S.emps.find(x => x.emp_code === code);
  return e ? { emp_code: e.emp_code, person_name: empName(e) } : { person_name: t };
}
function route() {
  const page = location.hash.replace(/^#\/?/, "").split("/")[0] || "index";
  document.querySelectorAll("#spNav a").forEach(a => a.classList.toggle("on", a.dataset.r === page));
  if (page === "settings") return renderSettings();
  S.f.nofile = page === "nofile";
  renderIndex();
  if (page === "issue") { history.replaceState(null, "", "#/index"); canWrite() ? issueForm() : toast("ไม่มีสิทธิ์ออกเลข", "err"); }
  if (page === "receive") { history.replaceState(null, "", "#/index"); canWrite() ? receiveForm() : toast("ไม่มีสิทธิ์ลงรับ", "err"); }
}
const head = (t, s, a = "") => `<div class="sp-head"><div class="t"><div class="sp-title">${t}</div><div class="sp-sub">${s}</div></div>${a}</div>`;

// ---------------------------------------------------------------- สารบัญ
function srcBadge(r) {
  const x = S.sources.get(r.id);
  if (r.status === "void") return `<span class="bd r">ยกเลิกเลข</span>`;
  if (x) { const [t, c] = SRC_ST[x.status] || [x.status, "n"]; return `<span class="bd ${c}">${x.kind === "paf" ? "PAF" : "หนังสือ HR"} · ${t}</span>`; }
  return dirOf(r.series_code) === "in" ? `<span class="bd b">ลงรับแล้ว</span>` : `<span class="bd n">ออกเลขเอง</span>`;
}
function renderIndex() {
  const y = new Date().getFullYear(), list = filterDocs(S.rows, S.f, dirOf, S.files), ym = todayISO().slice(0, 7);
  const yr = S.rows.filter(r => r.year === y && r.status !== "void"), inN = yr.filter(r => dirOf(r.series_code) === "in").length;
  const mo = yr.filter(r => (r.issued_date || "").startsWith(ym)), moIn = mo.filter(r => dirOf(r.series_code) === "in").length;
  const nofile = filterDocs(S.rows, { nofile: true, year: y }, dirOf, S.files).length;
  const years = [...new Set([y, ...S.rows.map(r => r.year)])].sort((a, b) => b - a);
  const types = [...new Set(S.rows.filter(r => !S.f.series || r.series_code === S.f.series).map(r => r.type_label).filter(Boolean))].sort();
  const sel = (k, opts, all) => `<select class="in" data-f="${k}"><option value="">${all}</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(S.f[k] || "") === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  $("#spMain").innerHTML = head(S.f.nofile ? "ยังไม่มีไฟล์แนบ" : "สารบัญเอกสาร",
    `เลขถัดไป  ${S.series.filter(s => s.is_active).map(s => `${s.direction === "in" ? "รับ " : ""}${esc(nextNo(S.rows, s.prefix, s.code, y))}`).join(" · ")}`,
    `<button class="btn btn-s" id="dxExport">${IC.dl}Export Excel</button>${canWrite() ? `<button class="btn btn-s" id="dxRecv">${IC.inb}ลงรับเอกสาร</button><button class="btn btn-p" id="dxIssue">${IC.plus}ออกเลขเอกสาร</button>` : ""}`) + `
    <div class="stats">
      <div class="stat"><div class="l">เอกสารปี ${y + 543}</div><div class="v">${yr.length}</div><div class="m">ออก ${yr.length - inN} · รับ ${inN}</div></div>
      <div class="stat"><div class="l">เดือนนี้</div><div class="v">${mo.length}</div><div class="m">ออก ${mo.length - moIn} · รับ ${moIn}</div></div>
      <div class="stat"><div class="l">เอกสารลับ</div><div class="v">${can("data.doc.confidential") ? yr.filter(r => r.confidential).length : "—"}</div><div class="m">${can("data.doc.confidential") ? "เปิดได้เฉพาะผู้มีสิทธิ์ · มีบันทึกการเปิด" : "บัญชีนี้ไม่เห็นเอกสารลับ"}</div></div>
      <div class="stat${nofile ? " hl" : ""}" data-nf style="cursor:pointer"><div class="l">ยังไม่มีไฟล์แนบ</div><div class="v">${nofile}</div><div class="m">แนบฉบับเซ็นแล้วให้ครบ</div></div></div>
    <div class="filters">
      <label class="fld" style="flex:1;min-width:220px"><span>ค้นหา</span><input class="in" id="dxQ" placeholder="เลขที่ / ชื่อ / เรื่อง / รหัสพนักงาน / ผู้ส่ง" value="${esc(S.f.q || "")}"></label>
      <label class="fld"><span>ทิศทาง</span>${sel("dir", [["out", "ส่งออก"], ["in", "รับเข้า"]], "ทั้งหมด")}</label>
      <label class="fld"><span>ชุดเลข</span>${sel("series", S.series.map(s => [s.code, s.label]), "ทุกชุด")}</label>
      <label class="fld"><span>ประเภท</span>${sel("type", types.map(t => [t, t]), "ทุกประเภท")}</label>
      <label class="fld"><span>ปี</span>${sel("year", years.map(v => [v, `${v + 543}`]), "ทุกปี")}</label>
      <label class="chk"><input type="checkbox" id="dxVoid" ${S.f.voided ? "checked" : ""}> แสดงเลขที่ยกเลิก</label></div>
    <div class="card"><div class="tbl-wrap">${list.length ? `<table class="tbl"><thead><tr><th>เลขที่</th><th>วันที่</th><th>ประเภท</th><th>เรื่อง / ผู้เกี่ยวข้อง</th><th>ไฟล์</th><th>ที่มา · สถานะ</th></tr></thead><tbody>
      ${list.slice(0, 500).map(r => { const n = S.files.get(r.id) || 0, inn = dirOf(r.series_code) === "in";
        return `<tr class="click${r.status === "void" ? " void" : ""}" data-id="${r.id}"><td><span class="no"><b>${esc(r.doc_no)}</b>${r.confidential ? IC.lock : ""}</span></td>
          <td style="white-space:nowrap">${thDate(r.issued_date)}</td>
          <td><div class="ty">${esc(r.type_label || "—")}</div><span class="bd ${inn ? "b" : "n"}">${inn ? "รับเข้า" : "ส่งออก"}</span></td>
          <td>${esc(r.status === "void" ? `ยกเลิก${r.void_reason ? ": " + r.void_reason : ""}` : r.subject || "")}<div class="sub">${esc(inn ? (r.sender ? "จาก " + r.sender : "") : [r.person_name, r.emp_code].filter(Boolean).join(" · "))}</div></td>
          <td>${n ? `<span class="fc">${IC.clip}${n}</span>` : r.status === "void" ? "" : `<span class="fc none">— แนบไฟล์</span>`}</td><td>${srcBadge(r)}</td></tr>`; }).join("")}</tbody></table>
      <div class="hint" style="padding:12px 16px;border-top:1px solid var(--line)">แสดง ${Math.min(500, list.length)} จาก ${list.length} รายการ${list.length > 500 ? " — ใช้ตัวกรองให้แคบลง" : ""} · กดแถวเพื่อดูรายละเอียดและไฟล์แนบ</div>`
      : `<div class="empty">${S.rows.length ? "ไม่มีรายการตามตัวกรอง" : "ยังไม่มีเลขในทะเบียน — นำเข้าประวัติจาก Excel เดิมได้ที่หน้าตั้งค่า"}</div>`}</div></div>`;
  const qi = $("#dxQ"); qi.oninput = () => { S.f.q = qi.value; const p = qi.selectionStart; renderIndex(); const n = $("#dxQ"); n.focus(); n.setSelectionRange(p, p); };
  document.querySelectorAll("[data-f]").forEach(s => s.onchange = () => { S.f[s.dataset.f] = s.value; if (s.dataset.f === "series") S.f.type = ""; renderIndex(); });
  $("#dxVoid").onchange = e => { S.f.voided = e.target.checked; renderIndex(); };
  document.querySelector("[data-nf]").onclick = () => { location.hash = S.f.nofile ? "#/index" : "#/nofile"; };
  $("#dxExport").onclick = () => exportExcel(list);
  $("#dxIssue")?.addEventListener("click", issueForm); $("#dxRecv")?.addEventListener("click", receiveForm);
  document.querySelectorAll("tr[data-id]").forEach(tr => tr.onclick = () => openDoc(S.rows.find(r => r.id === +tr.dataset.id)));
}

// ---------------------------------------------------------------- รายละเอียดเอกสาร (แผงขวา)
async function openDoc(r) {
  const el = document.createElement("div"); el.className = "dw"; $("#spModal").appendChild(el);
  el.onclick = e => { if (e.target === el) el.remove(); };
  const inn = dirOf(r.series_code) === "in", x = S.sources.get(r.id), w = canWrite() && r.status !== "void";
  let files = [], log = [];
  const load = async () => { [files, log] = await Promise.all([q(supabase.from("doc_files").select("*").eq("doc_id", r.id).order("uploaded_at")),
    q(supabase.from("doc_access_log").select("*").eq("doc_id", r.id).order("at", { ascending: false }).limit(20))]); S.files.set(r.id, files.length); };
  const srcCard = () => {
    if (x) { const [t, , c] = SRC_ST[x.status] || [x.status, "n", ""];
      return `<div class="src ${c}"><div class="t"><b>${x.kind === "paf" ? "Personnel Action Form" : "ออกหนังสือ HR"} · ${t}</b><span>${x.decided_at ? `อนุมัติเมื่อ ${esc(thTime(x.decided_at))}` : "สร้างจากระบบ HR — เปิดดูตัวเอกสารในระบบ HR"}</span></div>
        <a class="btn btn-s btn-sm" href="${x.kind === "paf" ? `/?paf=${x.source_id}` : `/?letter=${x.source_id}`}" target="_blank" rel="noopener">เปิดเอกสาร</a></div>`; }
    if (LETTER_KIND[r.type_label] && r.status !== "void") return `<div class="src"><div class="t"><b>ยังไม่ได้สร้างตัวหนังสือ</b><span>เลขนี้สร้างหนังสือในระบบออกหนังสือ HR ได้</span></div><button class="btn btn-s btn-sm" data-mk>สร้างหนังสือ</button></div>`;
    return `<div class="src"><div class="t"><b>${inn ? "ลงรับจากภายนอก" : "ออกเลขในสารบัญ"}</b><span>ตัวเอกสารคือไฟล์แนบด้านล่าง</span></div></div>`;
  };
  const draw = () => {
    el.innerHTML = `<div class="dw-c" style="width:520px"><div class="dw-h"><div class="t"><b style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${esc(r.doc_no)}
        ${r.confidential ? `<span class="bd w">เอกสารลับ</span>` : ""}<span class="bd ${inn ? "b" : "n"}">${inn ? "รับเข้า" : "ส่งออก"}</span>${r.status === "void" ? `<span class="bd r">ยกเลิกเลข</span>` : ""}</b>
        <span>${esc(r.type_label || "")} · ${inn ? "ลงรับ" : "ออก"}เมื่อ ${thDate(r.issued_date)}</span></div><button class="btn btn-g btn-sm" data-x>${IC.x}</button></div>
      <div class="dw-b">
        ${r.status === "void" ? `<div class="note r">ยกเลิกเลขนี้แล้ว${r.void_reason ? ": " + esc(r.void_reason) : ""} — เลขนี้จะไม่ถูกนำกลับมาใช้</div>` : ""}
        <div class="sec"><div class="h">รายละเอียด</div><dl class="kv">
          <dt>เรื่อง</dt><dd>${esc(r.subject || "—")}</dd>
          ${inn ? `<dt>จาก</dt><dd>${esc(r.sender || "—")}</dd><dt>เลขที่หนังสือ</dt><dd>${esc(r.ref_doc_no || "—")}</dd><dt>วันที่ได้รับ</dt><dd>${thDate(r.received_date)}</dd>`
            : `<dt>ออกให้</dt><dd>${esc([r.person_name, r.emp_code].filter(Boolean).join(" · ") || "—")}</dd><dt>อ้างอิง</dt><dd>${esc(r.ref_doc_no || "—")}</dd>`}
          <dt>แบบฟอร์ม</dt><dd>${esc(r.form_code || "—")}</dd>${r.note ? `<dt>หมายเหตุ</dt><dd>${esc(r.note)}</dd>` : ""}</dl></div>
        <div class="sec"><div class="h">ที่มา</div>${srcCard()}</div>
        <div class="sec"><div class="h"><span>ไฟล์แนบ (${files.length})</span>${r.confidential ? `<span style="color:var(--amber)">เปิดได้เฉพาะผู้มีสิทธิ์ · บันทึกทุกครั้งที่เปิด</span>` : ""}</div>
          ${files.map(f => `<div class="fl">${IC.file}<div class="t"><b>${esc(f.name)}</b><span>${kb(f.size)} · แนบโดย ${esc(f.uploaded_name || "—")} · ${thDate(String(f.uploaded_at).slice(0, 10))}</span></div>
            <button class="btn btn-s btn-sm" data-open="${f.id}">เปิด</button>${w ? `<button class="btn btn-g btn-sm" data-del="${f.id}" title="ลบไฟล์">${IC.x}</button>` : ""}</div>`).join("") || (w ? "" : `<div class="hint">ยังไม่มีไฟล์แนบ</div>`)}
          ${w ? `<label class="dz" id="dxDz">${IC.up}<b>ลากไฟล์มาวาง หรือกดเพื่อเลือก</b><span>PDF / รูป / Word / Excel · ไม่เกิน 20 MB ต่อไฟล์</span><input type="file" id="dxFile" multiple hidden></label>` : ""}</div>
        ${log.length ? `<div class="sec"><div class="h">บันทึกการเปิด / แนบไฟล์</div>${log.map(l => `<div class="lg"><b style="font-weight:500">${esc(l.user_name || "—")}</b><span>${esc(thTime(l.at))} · ${{ open: "เปิดไฟล์", upload: "แนบไฟล์", delete: "ลบไฟล์" }[l.action] || l.action}${l.file_name ? ` · ${esc(l.file_name)}` : ""}</span></div>`).join("")}</div>` : ""}
      </div>
      <div class="dw-f">${w ? `<button class="btn btn-d" data-void style="margin-right:auto">ยกเลิกเลข</button>` : ""}<button class="btn btn-s" data-cp>คัดลอกเลขที่</button>${w ? `<button class="btn btn-p" data-ed>${IC.pen}แก้ไขรายละเอียด</button>` : ""}</div></div>`;
    el.querySelectorAll("[data-x]").forEach(b => b.onclick = () => el.remove());
    el.querySelector("[data-cp]").onclick = () => copy(r.doc_no);
    el.querySelector("[data-ed]")?.addEventListener("click", () => editForm(r, () => { renderIndex(); draw(); }));
    el.querySelector("[data-void]")?.addEventListener("click", () => voidDoc(r, () => { el.remove(); renderIndex(); }));
    el.querySelector("[data-mk]")?.addEventListener("click", () => {
      try { sessionStorage.setItem("letter_from_doc", JSON.stringify({ doc_id: r.id, kind: LETTER_KIND[r.type_label] })); } catch {}
      location.href = "/?letter_new=1";
    });
    el.querySelectorAll("[data-open]").forEach(b => b.onclick = async () => {
      const f = files.find(z => z.id === +b.dataset.open);
      const { data, error } = await supabase.storage.from("doc-files").createSignedUrl(f.path, 120);
      if (error || !data?.signedUrl) return fail(error || "ไม่พบไฟล์", "เปิดไฟล์ไม่ได้");
      supabase.rpc("doc_log", { p_doc_id: r.id, p_file_id: f.id, p_file_name: f.name, p_action: "open" }).then(() => {});
      window.open(data.signedUrl, "_blank", "noopener");
    });
    el.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      const f = files.find(z => z.id === +b.dataset.del); if (!confirm(`ลบไฟล์ ${f.name}?`)) return;
      try { await q(supabase.from("doc_files").delete().eq("id", f.id)); await supabase.storage.from("doc-files").remove([f.path]);
        await supabase.rpc("doc_log", { p_doc_id: r.id, p_file_id: f.id, p_file_name: f.name, p_action: "delete" }); } catch (e) { return fail(e, "ลบไม่สำเร็จ"); }
      await load(); draw(); renderIndex();
    });
    const dz = el.querySelector("#dxDz"), fi = el.querySelector("#dxFile");
    if (dz) {
      fi.onchange = () => { const l = [...fi.files]; fi.value = ""; up(l); };
      dz.ondragover = e => { e.preventDefault(); dz.classList.add("on"); }; dz.ondragleave = () => dz.classList.remove("on");
      dz.ondrop = e => { e.preventDefault(); dz.classList.remove("on"); up([...e.dataTransfer.files]); };
    }
  };
  const up = async list => { if (!list.length) return; const n = await uploadFiles(r, list); if (n) { toast(`แนบ ${n} ไฟล์แล้ว`, "ok"); await load(); draw(); renderIndex(); } };
  try { await load(); } catch (e) { fail(e, "โหลดไฟล์แนบไม่สำเร็จ"); }
  draw();
}
async function uploadFiles(r, list) {
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
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- ออกเลข / ลงรับ / แก้ไข / ยกเลิก
const typeOpts = (code, cur) => S.types.filter(t => t.series_code === code && (t.is_active || t.id === cur)).map(t => `<option value="${t.id}" ${t.id === cur ? "selected" : ""}>${esc(t.label)}${t.confidential ? " 🔒" : ""}</option>`).join("");
async function issueForm() {
  await loadEmps();
  const outs = S.series.filter(s => s.is_active && s.direction !== "in"), y = new Date().getFullYear();
  const el = modal("ออกเลขเอกสาร", `<div class="grid2">
      <label class="fld"><span>ชุดเลข</span><select class="in" id="isS">${outs.map(s => `<option value="${esc(s.code)}" ${s.code === (S.f.series || "HR") ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></label>
      <label class="fld"><span>ประเภท</span><select class="in" id="isT"></select></label>
      <label class="fld" style="grid-column:1/-1"><span>เรื่อง / รายละเอียด (ไม่บังคับ)</span><input class="in" id="isSub" placeholder="เช่น ยื่นธนาคาร, แจ้งผลฝึกงาน ม.เชียงใหม่"></label>
      <label class="fld"><span>วันที่ออก</span><input type="date" class="in" id="isD" value="${todayISO()}"></label>
      <label class="fld"><span>จำนวนเลข</span><input type="number" class="in" id="isN" min="1" max="500" value="1"></label>
      <label class="fld" id="isOne" style="grid-column:1/-1"><span>ออกให้ (พิมพ์รหัส/ชื่อพนักงาน หรือชื่อคนนอก)</span><input class="in" id="isP" list="dxEmps" autocomplete="off"></label>
      <label class="fld" id="isMany" style="grid-column:1/-1;display:none"><span>รายชื่อ (ไม่บังคับ · บรรทัดละ 1 คน เรียงตามเลข · ใส่รหัสพนักงานได้)</span><textarea class="in" id="isPs" rows="5"></textarea></label>
      <label class="fld"><span>อ้างอิงเลขที่ (ไม่บังคับ)</span><input class="in" id="isR" placeholder="เช่น HR-018-2025"></label>
      <label class="fld"><span>หมายเหตุ</span><input class="in" id="isNo"></label>
      <label class="chk" style="grid-column:1/-1"><input type="checkbox" id="isC"> เอกสารลับ (เห็นได้เฉพาะผู้มีสิทธิ์ดูเอกสารลับ)</label></div>${empList()}
    <div class="note" style="margin-top:12px"><b id="isPv"></b> · เลขจริงออกตอนกดยืนยัน ถ้ามีคนออกก่อนในเวลาเดียวกันจะได้เลขถัดไป</div>`,
    `<button class="btn btn-s" data-x>ยกเลิก</button><button class="btn btn-p" data-ok>ออกเลข</button>`);
  const g = id => el.querySelector("#" + id);
  const ty = () => S.types.find(t => t.id === +g("isT").value);
  const pv = () => { const n = Math.max(1, Math.min(500, +g("isN").value || 1)), yy = +(g("isD").value || "").slice(0, 4) || y, s = g("isS").value, first = nextNo(S.rows, prefixOf(s), s, yy);
    g("isPv").textContent = n === 1 ? `จะได้เลข ${first}` : `จะได้ ${n} เลข เริ่มที่ ${first}`; g("isOne").style.display = n === 1 ? "" : "none"; g("isMany").style.display = n === 1 ? "none" : ""; };
  const setT = () => { g("isT").innerHTML = typeOpts(g("isS").value); g("isC").checked = !!ty()?.confidential; pv(); };
  g("isS").onchange = setT; g("isT").onchange = () => { g("isC").checked = !!ty()?.confidential; }; g("isN").oninput = pv; g("isD").onchange = pv; setT();
  el.querySelector("[data-ok]").onclick = async e => {
    const n = Math.max(1, Math.min(500, +g("isN").value || 1)); let people = null;
    if (n === 1) { const p = personOf(g("isP").value); if (p.person_name) people = [p]; }
    else { const lines = g("isPs").value.split("\n").map(x => x.trim()).filter(Boolean);
      if (lines.length && lines.length !== n) return toast(`รายชื่อมี ${lines.length} บรรทัด แต่จะออก ${n} เลข — ให้เท่ากัน หรือเว้นว่าง`, "err");
      if (lines.length) people = lines.map(personOf); }
    e.target.disabled = true;
    const { data, error } = await supabase.rpc("doc_issue", { p_series: g("isS").value, p_count: n, p_type_id: +g("isT").value || null, p_subject: g("isSub").value,
      p_issued_date: g("isD").value || null, p_ref: g("isR").value, p_note: g("isNo").value, p_people: people });
    if (error) { e.target.disabled = false; return fail(error, "ออกเลขไม่สำเร็จ"); }
    let rows = data || [];
    if (g("isC").checked && rows.some(r => !r.confidential)) { const { data: u } = await supabase.from("doc_register").update({ confidential: true }).in("id", rows.map(r => r.id)).select(); if (u) rows = u; }
    el.remove(); S.rows = [...rows, ...S.rows].sort((a, b) => b.year - a.year || b.seq - a.seq); renderIndex();
    const nos = rows.map(r => r.doc_no);
    const d = modal("ออกเลขแล้ว", `<div style="padding:10px 0"><div class="big-no" style="font-size:${nos.length > 1 ? 20 : 30}px">${esc(nos.length > 1 ? `${nos[0]} – ${nos[nos.length - 1]}` : nos[0])}</div>
      <div class="hint" style="text-align:center;margin-top:6px">${nos.length} เลข · อยู่ในสารบัญแล้ว${nos.length === 1 ? " · แนบไฟล์ฉบับจริงได้เลย" : ""}</div></div>`,
      `<button class="btn btn-s" data-x>ปิด</button><button class="btn btn-s" data-cp>คัดลอกเลขที่</button>${nos.length === 1 ? `<button class="btn btn-p" data-att>แนบไฟล์</button>` : ""}`);
    d.querySelector("[data-cp]").onclick = () => copy(nos.join("\n"));
    d.querySelector("[data-att]")?.addEventListener("click", () => { d.remove(); openDoc(rows[0]); });
  };
}
async function receiveForm() {
  if (!S.series.some(s => s.code === "IN")) return toast("ยังไม่มีชุดเลขรับเข้า — รัน sql/schema_doc_index.sql ก่อน", "err");
  const el = modal("ลงรับเอกสาร", `<div class="grid2">
      <label class="fld"><span>ประเภท</span><select class="in" id="rvT">${typeOpts("IN")}</select></label>
      <label class="fld"><span>วันที่ได้รับ</span><input type="date" class="in" id="rvD" value="${todayISO()}"></label>
      <label class="fld" style="grid-column:1/-1"><span>จาก (หน่วยงาน / บริษัท / บุคคล) *</span><input class="in" id="rvF" placeholder="เช่น สำนักงานประกันสังคมจังหวัดพิจิตร"></label>
      <label class="fld"><span>เลขที่หนังสือของผู้ส่ง</span><input class="in" id="rvR" placeholder="เช่น พจ 0024/1234"></label>
      <label class="fld"><span>ลงวันที่ (ตามหนังสือ)</span><input type="date" class="in" id="rvDd"></label>
      <label class="fld" style="grid-column:1/-1"><span>เรื่อง *</span><input class="in" id="rvS"></label>
      <label class="fld" style="grid-column:1/-1"><span>หมายเหตุ / ส่งต่อให้</span><input class="in" id="rvN"></label>
      <label class="fld" style="grid-column:1/-1"><span>ไฟล์ (สแกน/ไฟล์ที่ได้รับ · แนบทีหลังได้)</span><input type="file" class="in" id="rvFile" multiple></label>
      <label class="chk" style="grid-column:1/-1"><input type="checkbox" id="rvC"> เอกสารลับ</label></div>
    <div class="note" style="margin-top:12px">จะได้เลขรับ <b>${esc(nextNo(S.rows, prefixOf("IN"), "IN", new Date().getFullYear()))}</b> (ตัวอย่าง — เลขจริงออกตอนกดยืนยัน)</div>`,
    `<button class="btn btn-s" data-x>ยกเลิก</button><button class="btn btn-p" data-ok>ลงรับ</button>`);
  const g = id => el.querySelector("#" + id);
  g("rvT").onchange = () => { g("rvC").checked = !!S.types.find(t => t.id === +g("rvT").value)?.confidential; }; g("rvT").onchange();
  el.querySelector("[data-ok]").onclick = async e => {
    const from = g("rvF").value.trim(), subj = g("rvS").value.trim(); if (!from || !subj) return toast("กรอกผู้ส่งและเรื่อง", "err");
    e.target.disabled = true;
    const note = [g("rvDd").value ? `ลงวันที่ ${thDate(g("rvDd").value)}` : "", g("rvN").value.trim()].filter(Boolean).join(" · ");
    const { data, error } = await supabase.rpc("doc_issue", { p_series: "IN", p_count: 1, p_type_id: +g("rvT").value || null, p_subject: subj, p_issued_date: todayISO(),
      p_ref: g("rvR").value, p_note: note, p_people: [{ person_name: from }] });
    if (error) { e.target.disabled = false; return fail(error, "ลงรับไม่สำเร็จ"); }
    let r = data[0];
    const { data: u, error: e2 } = await supabase.from("doc_register").update({ sender: from, received_date: g("rvD").value || null, ...(g("rvC").checked ? { confidential: true } : {}) }).eq("id", r.id).select().single();
    if (!e2 && u) r = u;
    const files = [...g("rvFile").files];
    S.rows = [r, ...S.rows]; el.remove();
    if (files.length) { const n = await uploadFiles(r, files); toast(`ลงรับ ${r.doc_no} แล้ว · แนบ ${n} ไฟล์`, "ok"); } else toast(`ลงรับ ${r.doc_no} แล้ว`, "ok");
    renderIndex(); openDoc(r);
  };
}
async function editForm(r, done) {
  await loadEmps();
  const inn = dirOf(r.series_code) === "in";
  const el = modal(`แก้ไข ${esc(r.doc_no)}`, `<div class="grid2">
      <label class="fld"><span>ประเภท</span><select class="in" id="edT">${typeOpts(r.series_code, r.type_id)}${r.type_id ? "" : `<option value="" selected>${esc(r.type_label || "—")}</option>`}</select></label>
      <label class="fld"><span>${inn ? "วันที่ลงรับ" : "วันที่ออก"}</span><input type="date" class="in" id="edD" value="${esc(r.issued_date || "")}"></label>
      <label class="fld" style="grid-column:1/-1"><span>เรื่อง / รายละเอียด</span><input class="in" id="edS" value="${esc(r.subject || "")}"></label>
      ${inn ? `<label class="fld" style="grid-column:1/-1"><span>จาก</span><input class="in" id="edF" value="${esc(r.sender || "")}"></label>
        <label class="fld"><span>วันที่ได้รับ</span><input type="date" class="in" id="edRd" value="${esc(r.received_date || "")}"></label>`
      : `<label class="fld" style="grid-column:1/-1"><span>ออกให้</span><input class="in" id="edP" list="dxEmps" autocomplete="off" value="${esc(r.emp_code ? `${r.emp_code} · ${r.person_name || ""}` : r.person_name || "")}"></label>`}
      <label class="fld"><span>${inn ? "เลขที่หนังสือของผู้ส่ง" : "อ้างอิงเลขที่"}</span><input class="in" id="edR" value="${esc(r.ref_doc_no || "")}"></label>
      <label class="fld"><span>รหัสแบบฟอร์ม</span><input class="in" id="edFc" value="${esc(r.form_code || "")}" placeholder="เช่น AKR-OHR-FM-031 Rev. 00"></label>
      <label class="fld" style="grid-column:1/-1"><span>หมายเหตุ</span><input class="in" id="edN" value="${esc(r.note || "")}"></label>
      <label class="chk" style="grid-column:1/-1"><input type="checkbox" id="edC" ${r.confidential ? "checked" : ""} ${r.confidential && !can("data.doc.confidential") ? "disabled" : ""}> เอกสารลับ</label></div>${inn ? "" : empList()}
    <div class="hint" style="margin-top:8px">เลขที่ ${esc(r.doc_no)} แก้ไม่ได้ — ถ้าออกผิดให้ยกเลิกเลขแล้วออกใหม่</div>`,
    `<button class="btn btn-s" data-x>ปิด</button><button class="btn btn-p" data-ok>บันทึก</button>`);
  const g = id => el.querySelector("#" + id);
  el.querySelector("[data-ok]").onclick = async () => {
    const t = S.types.find(x => x.id === +g("edT").value), p = inn ? {} : personOf(g("edP").value);
    const upd = { type_id: t?.id || r.type_id, type_label: t?.label || r.type_label, issued_date: g("edD").value || null, subject: g("edS").value.trim() || null,
      ref_doc_no: g("edR").value.trim() || null, note: g("edN").value.trim() || null, form_code: g("edFc").value.trim() || null, confidential: g("edC").checked,
      ...(inn ? { sender: g("edF").value.trim() || null, received_date: g("edRd").value || null } : { emp_code: p.emp_code || null, person_name: p.person_name || null }) };
    const { error } = await supabase.from("doc_register").update(upd).eq("id", r.id);
    if (error) return fail(error, "บันทึกไม่สำเร็จ");
    Object.assign(r, upd); el.remove(); toast("บันทึกแล้ว", "ok"); done?.();
  };
}
async function voidDoc(r, done) {
  const x = S.sources.get(r.id);
  const why = prompt(`ยกเลิกเลข ${r.doc_no}? เลขนี้จะไม่ถูกนำกลับมาใช้อีก${x?.kind === "letter" && x.status !== "cancelled" ? "\n⚠️ เลขนี้มีหนังสือในระบบออกหนังสือ — หนังสือฉบับนั้นจะถูกยกเลิกด้วย" : ""}${x?.kind === "paf" ? "\n⚠️ เลขนี้เป็นของ PAF — ควรยกเลิกที่หน้า PAF แทน" : ""}\nเหตุผล:`, "");
  if (why === null) return;
  const upd = { status: "void", void_reason: why.trim() || null, voided_at: new Date().toISOString(), voided_by: S.user.id };
  const { error } = await supabase.from("doc_register").update(upd).eq("id", r.id);
  if (error) return fail(error, "ยกเลิกไม่สำเร็จ");
  Object.assign(r, upd); toast(`ยกเลิก ${r.doc_no} แล้ว`, "ok"); done?.();
}

// ---------------------------------------------------------------- ตั้งค่า: ประเภท · ชั้นความลับ · รหัสแบบฟอร์ม · นำเข้า Excel เดิม
function renderSettings() {
  const w = canWrite();
  $("#spMain").innerHTML = head("ตั้งค่า", "ประเภทเอกสาร · ชั้นความลับ · รหัสแบบฟอร์ม · นำเข้าประวัติจาก Excel เดิม") + `
    <div class="card card-b" style="margin-bottom:16px"><div class="card-t">ชุดเลข</div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>ชุด</th><th>ชื่อ</th><th>รูปแบบเลข</th><th>ทิศทาง</th></tr></thead><tbody>
      ${S.series.map(s => `<tr><td><b>${esc(s.code)}</b></td><td>${esc(s.label)}</td><td>${esc(s.prefix)}-001-${new Date().getFullYear()}</td><td>${s.direction === "in" ? "รับเข้า" : "ส่งออก"}</td></tr>`).join("")}</tbody></table></div>
      <div class="hint" style="margin-top:8px">ลำดับเริ่ม 001 ใหม่ทุกปี · แต่ละชุดนับแยกกัน · เลขที่ออกแล้วลบไม่ได้ ยกเลิกได้ · เพิ่มชุดใหม่ทำใน SQL (doc_series)</div></div>
    <div class="card card-b" style="margin-bottom:16px"><div class="card-t">ประเภทเอกสาร</div>
      <div class="tbl-wrap"><table class="tbl tytbl"><thead><tr><th>ชุด</th><th>ชื่อประเภท</th><th>รหัสแบบฟอร์ม</th><th>ลับ</th><th>ใช้งาน</th></tr></thead><tbody>
      ${S.types.map(t => `<tr><td>${esc(S.series.find(s => s.code === t.series_code)?.label || t.series_code)}</td>
        <td><input class="in" data-tl="${t.id}" value="${esc(t.label)}" ${w ? "" : "disabled"}></td><td><input class="in" data-tf="${t.id}" value="${esc(t.form_code || "")}" placeholder="—" ${w ? "" : "disabled"}></td>
        <td style="text-align:center"><input type="checkbox" data-tc="${t.id}" ${t.confidential ? "checked" : ""} ${w ? "" : "disabled"}></td><td style="text-align:center"><input type="checkbox" data-ta="${t.id}" ${t.is_active ? "checked" : ""} ${w ? "" : "disabled"}></td></tr>`).join("")}</tbody></table></div>
      ${w ? `<div class="row" style="margin-top:12px"><select class="in" id="tyS" style="max-width:220px">${S.series.map(s => `<option value="${esc(s.code)}">${esc(s.label)}</option>`).join("")}</select>
        <input class="in grow" id="tyNew" placeholder="ชื่อประเภทใหม่"><button class="btn btn-s" id="tyAdd">${IC.plus}เพิ่ม</button><button class="btn btn-p" id="tySave">บันทึก</button></div>` : ""}
      <div class="hint" style="margin-top:8px">ติ๊ก “ลับ” = เลขใหม่ของประเภทนี้เป็นเอกสารลับอัตโนมัติ (เลขเก่าไม่เปลี่ยน — แก้รายฉบับในหน้ารายละเอียด) · เปลี่ยนชื่อประเภทไม่กระทบเลขที่ออกไปแล้ว</div></div>
    ${w ? `<div class="card card-b"><div class="card-t">นำเข้าประวัติจาก Excel เดิม</div><p class="sp-sub" style="margin-bottom:12px">ไฟล์ “01 ลำดับเอกสาร HR.xlsx” (ชีต HR และ Memo) · นำเข้าซ้ำได้ เลขที่มีแล้วข้าม</p>
      <label class="btn btn-s" style="cursor:pointer">${IC.up}เลือกไฟล์ Excel<input type="file" id="dxImp" accept=".xlsx,.xls" hidden></label></div>` : ""}`;
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
function exportExcel(list) {
  if (!list.length) return toast("ไม่มีรายการให้ export");
  const data = list.map(r => { const x = S.sources.get(r.id);
    return { "เลขที่": r.doc_no, "ทิศทาง": dirOf(r.series_code) === "in" ? "รับเข้า" : "ส่งออก", "วันที่": r.issued_date || "", "ประเภท": r.type_label || "", "เรื่อง": r.subject || "",
      "ออกให้ / จาก": dirOf(r.series_code) === "in" ? r.sender || r.person_name || "" : r.person_name || "", "รหัสพนักงาน": r.emp_code || "", "อ้างอิง": r.ref_doc_no || "",
      "แบบฟอร์ม": r.form_code || "", "ลับ": r.confidential ? "ลับ" : "", "ไฟล์แนบ": S.files.get(r.id) || 0,
      "ที่มา": x ? `${x.kind === "paf" ? "PAF" : "หนังสือ HR"} · ${SRC_ST[x.status]?.[0] || x.status}` : "", "สถานะ": r.status === "void" ? `ยกเลิก${r.void_reason ? ": " + r.void_reason : ""}` : "ใช้งาน", "หมายเหตุ": r.note || "" }; });
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "สารบัญ");
  XLSX.writeFile(wb, `สารบัญเอกสาร_${S.f.year || "ทุกปี"}.xlsx`);
}

boot();
