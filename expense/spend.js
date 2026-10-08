// ============================================================================
// HR Invoice Hub — แอปหลัก (เว็บ /expense)
//   ใช้ Supabase + session เดียวกับระบบ HR (โดเมนเดียวกัน) · สิทธิ์ page.expense / data.expense.*
//   หน้า: #/overview · #/invoices · #/invoice/<id|new> · #/vendors · #/budget · #/settings
//   ตรรกะเงิน/นำเข้า: calc.js · ใบ A4: doc.js · ฐานข้อมูล + ขั้นตอนลงนาม: sql/schema_expense.sql
// ============================================================================
import { supabase } from "../js/supabase-config.js";
import { lineCalc, invoiceTotals, amountWords, fiscalYear, parseInvoiceDb, round2, WHT_RATES } from "./calc.js";
import { printInvoice } from "./doc.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TH_M = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const thDate = iso => { if (!iso) return "-"; const d = new Date(String(iso).slice(0, 10) + "T00:00:00"); return `${d.getDate()} ${TH_M[d.getMonth()]} ${String(d.getFullYear() + 543).slice(2)}`; };
const todayISO = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const $ = s => document.querySelector(s);

const S = { user: null, perms: new Set(), cats: [], vendors: [], invoices: [], signers: [], me: null, mail: { mode: "outlook" }, tpl: [] };
const can = k => S.perms.has(k);
const canWrite = () => can("data.expense.write");

const ST = {
  draft:     ["ร่าง", "n"], review: ["รอตรวจ", "b"], approval: ["รออนุมัติ", "p"], approved: ["อนุมัติแล้ว", "g"],
  received:  ["ส่งบัญชีแล้ว", "g"], rejected: ["ส่งกลับแก้ไข", "r"], cancelled: ["ยกเลิก", "n"],
};
const badge = inv => { const [t, c] = inv.imported && inv.status === "received" ? ["นำเข้าจาก Excel", "n"] : ST[inv.status] || [inv.status, "n"];
  return `<span class="bd ${c}">${esc(t)}</span>`; };
const signerName = uid => S.signers.find(s => s.user_id === uid)?.name || "—";

function toast(msg, type = "") {
  const el = document.createElement("div"); el.className = "toast " + type; el.textContent = msg;
  $("#spToasts").appendChild(el); setTimeout(() => el.remove(), 4500);
}
function modal(title, body, foot) {
  const el = document.createElement("div"); el.className = "mo";
  el.innerHTML = `<div class="mo-c"><div class="mo-h">${title}<button class="btn btn-g btn-sm" data-x>✕</button></div>
    <div class="mo-b">${body}</div><div class="mo-f">${foot}</div></div>`;
  $("#spModal").appendChild(el);
  el.querySelectorAll("[data-x]").forEach(b => b.onclick = () => el.remove());
  el.onclick = e => { if (e.target === el) el.remove(); };
  return el;
}

// ---------------------------------------------------------------- เริ่มต้น
async function boot() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    $("#spMain").innerHTML = `<div class="card card-b" style="max-width:460px;margin:60px auto;text-align:center">
      <div class="card-t" style="justify-content:center">กรุณาเข้าสู่ระบบ</div>
      <p class="sp-sub" style="margin-bottom:16px">HR Invoice Hub ใช้บัญชีเดียวกับระบบ HR — เข้าสู่ระบบ HR ก่อน แล้วกดเมนู HR Invoice Hub</p>
      <a class="btn btn-p" href="/">ไปหน้าเข้าสู่ระบบ HR</a></div>`;
    return;
  }
  S.user = session.user;
  const { data: perms } = await supabase.rpc("my_permissions");
  S.perms = new Set((perms || []).map(p => typeof p === "string" ? p : p.perm_key || p.key));
  const name = S.user.user_metadata?.full_name || S.user.email || "";
  $("#spUser").innerHTML = `<div class="sp-av">${esc(name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase())}</div>
    <div><b>${esc(name)}</b><span>${canWrite() ? "HR · ผู้จัดทำ" : can("data.expense.approve") ? "ผู้อนุมัติ" : can("data.expense.review") ? "ผู้ตรวจ" : "ดูอย่างเดียว"}</span></div>`;
  if (!can("page.expense")) {
    $("#spMain").innerHTML = `<div class="empty">บัญชีนี้ยังไม่มีสิทธิ์ใช้ HR Invoice Hub — ให้ Admin เพิ่มสิทธิ์ “HR Invoice Hub (ใบแจ้งหนี้)” ที่ User Management</div>`;
    return;
  }
  try { await loadAll(); }
  catch (e) {
    $("#spMain").innerHTML = `<div class="card card-b"><b>โหลดข้อมูลไม่สำเร็จ</b><p class="sp-sub">${esc(e.message)}</p>
      <p class="hint" style="margin-top:8px">ถ้ายังไม่ได้รัน <code>sql/schema_expense.sql</code> ใน Supabase ให้รันก่อน</p></div>`;
    return;
  }
  window.addEventListener("hashchange", route);
  route();
}

async function fetchAll(q) {   // Supabase คืนครั้งละไม่เกิน 1,000 แถว → ไล่ดึงทีละหน้า
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999);
    if (error) throw error;
    out.push(...data); if (data.length < 1000) break;
  }
  return out;
}
async function loadAll() {
  const [cats, vendors, invoices, signers, me, mail, tpl] = await Promise.all([
    supabase.from("exp_categories").select("*").order("sort_order").order("name"),
    fetchAll(() => supabase.from("exp_vendors").select("*").order("code")),
    fetchAll(() => supabase.from("exp_invoices").select("id,inv_no,inv_year,inv_seq,inv_date,vendor_id,vendor,category,ref_no,amount,vat,wht,net,status,reviewer_id,approver_id,prepared_by,imported,reject_reason,received_at,created_at")
      .order("inv_date", { ascending: false }).order("inv_seq", { ascending: false })),
    supabase.rpc("exp_signers"),
    supabase.from("letter_signers").select("*").eq("user_id", S.user.id).maybeSingle(),
    supabase.from("mail_settings").select("mode").eq("id", 1).maybeSingle(),
    supabase.from("mail_templates").select("*").like("key", "exp_%"),
  ]);
  if (cats.error) throw cats.error;
  S.cats = cats.data || []; S.vendors = vendors; S.invoices = invoices;
  S.signers = signers.data || []; S.me = me.data || null;
  if (mail.data) S.mail = mail.data; S.tpl = tpl.data || [];
  updatePending();
}
const myTodo = () => S.invoices.filter(i => (i.status === "review" && i.reviewer_id === S.user.id) || (i.status === "approval" && i.approver_id === S.user.id));
function updatePending() { const n = myTodo().length; $("#navPending").textContent = n ? String(n) : ""; }

function route() {
  const [r, arg] = location.hash.replace(/^#\/?/, "").split("/");
  const page = r || (myTodo().length ? "invoices" : "overview");
  document.querySelectorAll("#spNav a").forEach(a => a.classList.toggle("on", a.dataset.r === (page === "invoice" ? "invoices" : page)));
  window.scrollTo(0, 0);
  ({ overview: renderOverview, invoices: renderList, invoice: () => renderEditor(arg), vendors: renderVendors, budget: renderBudget, settings: renderSettings }[page] || renderOverview)();
}

// ---------------------------------------------------------------- อีเมล + แจ้งเตือนในระบบ HR
const b64 = s => btoa(unescape(encodeURIComponent(s)));
const fill = (tpl, v, html) => String(tpl || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => html ? esc(v[k] ?? "") : String(v[k] ?? ""));
const mailList = (...p) => [...new Set(p.join(",").split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))].join(", ");
function downloadEml(to, subject, html, name, cc = "") {
  const body = b64(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${html}</body></html>`).replace(/.{76}/g, "$&\r\n");
  const eml = [`To: ${to}`, ...(cc ? [`Cc: ${cc}`] : []), `Subject: =?UTF-8?B?${b64(subject)}?=`, "X-Unsent: 1", "MIME-Version: 1.0",
               "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", body].join("\r\n");
  const url = URL.createObjectURL(new Blob([eml], { type: "message/rfc822" }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
// action: exp_review | exp_approve | exp_approved | exp_rejected
async function sendMail(inv, action, lines) {
  if (S.mail.mode === "auto") {
    try {
      const { data, error } = await supabase.functions.invoke("letter-notify", { body: { exp_id: inv.id, action } });
      if (error) throw error;
      if (data?.sent) return `ส่งอีเมลถึง ${data.to} แล้ว`;
    } catch (_) { /* ใช้ไฟล์ .eml แทน */ }
  }
  const t = S.tpl.find(x => x.key === action); if (!t) return "แจ้งในระบบแล้ว";
  const to = { exp_review: S.signers.find(s => s.user_id === inv.reviewer_id)?.email,
               exp_approve: S.signers.find(s => s.user_id === inv.approver_id)?.email }[action] || "";
  const v = { doc_no: inv.inv_no || "", person: inv.vendor?.name || "", kind: lines?.[0]?.detail || inv.category || "",
              emp_code: money(inv.net) + " บาท", link: `${location.origin}/expense/#/invoice/${inv.id}`, reason: inv.reject_reason || "-",
              requester: inv.preparer?.name || "", approver: inv.approver?.name || signerName(inv.approver_id) };
  downloadEml(mailList(to, t.to_extra || ""), fill(t.subject, v, false), fill(t.html, v, true), `${inv.inv_no} ${action}.eml`, mailList(t.cc || ""));
  return "ดาวน์โหลดไฟล์เมลแล้ว — เปิดใน Outlook แล้วกด Send";
}
// กระดิ่งในระบบ HR (ตาราง notifications เดียวกัน) — กดแล้วเปิดใบนี้ในเว็บ HR Invoice Hub
const notifyHR = (title, inv) => supabase.from("notifications").insert({ title, detail: `${inv.inv_no} · ${inv.vendor?.name || ""}`,
  category: "default", created_by: S.user.id, link: `/expense/#/invoice/${inv.id}` }).then(() => {}, () => {});

// ---------------------------------------------------------------- ภาพรวม
let ovFY = null;
function renderOverview() {
  const fys = [...new Set(S.invoices.map(i => fiscalYear(i.inv_date)))].sort((a, b) => b - a);
  ovFY = ovFY || fiscalYear(todayISO());
  const live = S.invoices.filter(i => !["draft", "cancelled"].includes(i.status) && fiscalYear(i.inv_date) === ovFY);
  const sum = (list, k = "amount") => round2(list.reduce((s, i) => s + Number(i[k] || 0), 0));
  const ym = todayISO().slice(0, 7);
  const byCat = {}; for (const i of live) byCat[i.category || "ไม่ระบุหมวด"] = (byCat[i.category || "ไม่ระบุหมวด"] || 0) + Number(i.amount || 0);
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const max = cats[0]?.[1] || 1;
  const months = []; for (let k = 0; k < 12; k++) { const m = (k + 6) % 12 + 1, y = m >= 7 ? ovFY - 1 : ovFY; months.push(`${y}-${String(m).padStart(2, "0")}`); }
  const byM = Object.fromEntries(months.map(m => [m, sum(live.filter(i => i.inv_date.slice(0, 7) === m))]));
  const mMax = Math.max(1, ...Object.values(byM));
  const pend = S.invoices.filter(i => ["review", "approval"].includes(i.status));
  $("#spMain").innerHTML = `
  <div class="sp-head"><div class="t"><div class="sp-title">ภาพรวมค่าใช้จ่าย HR</div>
    <div class="sp-sub">ปีงบ ${ovFY} (ก.ค. ${ovFY - 1} – มิ.ย. ${ovFY}) · ยอดก่อน VAT ของใบที่ส่งตรวจแล้ว</div></div>
    <label class="fld"><span>ปีงบ</span><select class="in" id="ovFY">${(fys.includes(ovFY) ? fys : [ovFY, ...fys]).map(y => `<option ${y === ovFY ? "selected" : ""}>${y}</option>`).join("")}</select></label></div>
  <div class="stats">
    <div class="stat"><div class="l">ใช้ไปทั้งปีงบ</div><div class="v">${money(sum(live))}</div><div class="m">${live.length.toLocaleString()} ใบ</div></div>
    <div class="stat"><div class="l">เดือนนี้</div><div class="v">${money(byM[ym] || 0)}</div><div class="m">${TH_M[+ym.slice(5) - 1]} ${+ym.slice(0, 4) + 543}</div></div>
    <div class="stat ${pend.length ? "hl" : ""}" data-f="pending"><div class="l">รอตรวจ / รออนุมัติ</div><div class="v">${pend.length}</div><div class="m">${money(sum(pend, "net"))} บาท</div></div>
    <div class="stat" data-f="approved"><div class="l">อนุมัติแล้ว รอส่งบัญชี</div><div class="v">${S.invoices.filter(i => i.status === "approved").length}</div><div class="m">กดเพื่อดูรายการ</div></div>
  </div>
  <div class="ed" style="grid-template-columns:minmax(0,1.2fr) minmax(0,1fr)">
    <div class="card card-b"><div class="card-t">แยกตามหมวด</div>
      ${cats.length ? `<table class="tbl"><tbody>${cats.map(([c, v]) => `<tr><td style="width:38%">${esc(c)}</td>
        <td><div class="bar"><i style="width:${Math.max(1, v / max * 100)}%"></i></div></td><td class="n" style="width:120px">${money(v)}</td></tr>`).join("")}</tbody></table>`
        : `<div class="empty">ยังไม่มีข้อมูลในปีงบนี้</div>`}</div>
    <div class="card card-b"><div class="card-t">รายเดือน</div>
      <table class="tbl"><tbody>${months.map(m => `<tr><td style="width:80px;white-space:nowrap">${TH_M[+m.slice(5) - 1]} ${String(+m.slice(0, 4) + 543).slice(2)}</td>
        <td><div class="bar"><i style="width:${byM[m] / mMax * 100}%"></i></div></td><td class="n" style="width:120px">${byM[m] ? money(byM[m]) : "–"}</td></tr>`).join("")}</tbody></table></div>
  </div>`;
  $("#ovFY").onchange = e => { ovFY = +e.target.value; renderOverview(); };
  document.querySelectorAll("[data-f]").forEach(el => el.onclick = () => { listF.status = el.dataset.f; location.hash = "#/invoices"; });
}

// ---------------------------------------------------------------- รายการใบแจ้งหนี้
const listF = { q: "", year: "", cat: "", status: "", shown: 100 };
let lineHits = null;   // id ใบที่รายละเอียดบรรทัดตรงคำค้น (ค้นในฐานข้อมูล)
function filtered() {
  const q = listF.q.trim().toLowerCase();
  return S.invoices.filter(i => {
    if (listF.year && String(i.inv_date).slice(0, 4) !== listF.year) return false;
    if (listF.cat && i.category !== listF.cat) return false;
    if (listF.status === "pending" && !["review", "approval"].includes(i.status)) return false;
    if (listF.status === "mine" && !myTodo().includes(i)) return false;
    if (listF.status && !["pending", "mine"].includes(listF.status) && i.status !== listF.status) return false;
    if (q) {
      const hay = [i.inv_no, i.ref_no, i.vendor?.code, i.vendor?.name, i.category].join(" ").toLowerCase();
      if (!hay.includes(q) && !(lineHits && lineHits.has(i.id))) return false;
    }
    return true;
  });
}
function renderList() {
  const list = filtered(), years = [...new Set(S.invoices.map(i => String(i.inv_date).slice(0, 4)))].sort().reverse();
  const y = String(new Date().getFullYear());
  const lastSeq = Math.max(0, ...S.invoices.filter(i => String(i.inv_year) === y).map(i => i.inv_seq || 0));
  const cnt = st => S.invoices.filter(i => i.status === st).length;
  const ym = todayISO().slice(0, 7), month = S.invoices.filter(i => String(i.inv_date).startsWith(ym) && !["draft", "cancelled"].includes(i.status));
  $("#spMain").innerHTML = `
  <div class="sp-head"><div class="t"><div class="sp-title">ใบแจ้งหนี้</div>
    <div class="sp-sub">เลขถัดไป HRIN${String(lastSeq + 1).padStart(3, "0")}/${y} · ปีนี้ออกไปแล้ว ${lastSeq} ใบ</div></div>
    <button class="btn btn-s" id="lsExport"><svg viewBox="0 0 24 24"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>Export Excel</button>
    ${canWrite() ? `<a class="btn btn-p" href="#/invoice/new"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>ออกใบแจ้งหนี้</a>` : ""}</div>
  <div class="stats">
    <div class="stat" data-s="review"><div class="l">รอตรวจ</div><div class="v">${cnt("review")}</div><div class="m">ผู้ตรวจกดจากอีเมลได้</div></div>
    <div class="stat ${cnt("approval") ? "hl" : ""}" data-s="approval"><div class="l">รออนุมัติ</div><div class="v">${cnt("approval")}</div><div class="m">${myTodo().length ? `รอท่าน ${myTodo().length} ใบ` : "ผู้อนุมัติกดจากอีเมลได้"}</div></div>
    <div class="stat" data-s="approved"><div class="l">อนุมัติแล้ว รอส่งบัญชี</div><div class="v">${cnt("approved")}</div><div class="m">ยอดรวม ${money(S.invoices.filter(i => i.status === "approved").reduce((s, i) => s + Number(i.net), 0))}</div></div>
    <div class="stat"><div class="l">เดือนนี้ (สุทธิ)</div><div class="v">${money(month.reduce((s, i) => s + Number(i.net), 0))}</div><div class="m">${month.length} ใบ</div></div>
  </div>
  <div class="filters">
    <label class="fld" style="flex:1;min-width:240px"><span>ค้นหา</span><input class="in" id="lsQ" placeholder="เลขที่ / Ref. / ผู้ขาย / รายละเอียด" value="${esc(listF.q)}"></label>
    <label class="fld"><span>ปี</span><select class="in" id="lsY"><option value="">ทุกปี</option>${years.map(v => `<option ${v === listF.year ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    <label class="fld"><span>หมวด</span><select class="in" id="lsC"><option value="">ทุกหมวด</option>${S.cats.map(c => `<option ${c.name === listF.cat ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
    <label class="fld"><span>สถานะ</span><select class="in" id="lsS"><option value="">ทุกสถานะ</option>
      ${[["mine", "รอฉันดำเนินการ"], ["pending", "รอตรวจ/รออนุมัติ"], ...Object.entries(ST).map(([k, [t]]) => [k, t])].map(([k, t]) => `<option value="${k}" ${k === listF.status ? "selected" : ""}>${t}</option>`).join("")}</select></label>
  </div>
  <div class="card"><div class="tbl-wrap">${list.length ? `<table class="tbl">
    <thead><tr><th>เลขที่</th><th>วันที่</th><th>ผู้ขาย</th><th>หมวด</th><th class="n">ยอดก่อน VAT</th><th class="n">สุทธิ</th><th>สถานะ</th></tr></thead>
    <tbody>${list.slice(0, listF.shown).map(i => `<tr class="click" data-id="${i.id}">
      <td><b>${esc(i.inv_no || "ร่าง")}</b><div class="sub">${i.ref_no ? "Ref. " + esc(i.ref_no) : "&nbsp;"}</div></td>
      <td style="white-space:nowrap">${thDate(i.inv_date)}</td>
      <td><b>${esc(i.vendor?.name || "—")}</b><div class="sub">${esc(i.vendor?.code || "")}</div></td>
      <td>${esc(i.category || "")}</td><td class="n">${money(i.amount)}</td><td class="n"><b>${money(i.net)}</b></td>
      <td>${badge(i)}<div class="sub" style="${i.status === "rejected" ? "color:var(--red)" : ""}">${esc(
        i.status === "review" ? "ผู้ตรวจ: " + signerName(i.reviewer_id) : i.status === "approval" ? "ถึง " + signerName(i.approver_id)
        : i.status === "rejected" ? (i.reject_reason || "") : i.status === "received" && !i.imported ? "รับ " + thDate(i.received_at) : "")}</div></td></tr>`).join("")}</tbody></table>
    ${list.length > listF.shown ? `<div class="more"><button class="btn btn-g" id="lsMore">แสดงเพิ่ม (${(list.length - listF.shown).toLocaleString()} ใบ)</button></div>` : ""}`
    : `<div class="empty">${S.invoices.length ? "ไม่มีใบที่ตรงกับตัวกรอง" : `ยังไม่มีใบแจ้งหนี้ — ${canWrite() ? "นำเข้าข้อมูลเดิมจาก Excel ที่หน้า ตั้งค่า หรือกด “ออกใบแจ้งหนี้”" : ""}`}</div>`}</div></div>`;
  const re = () => { listF.shown = 100; renderList(); };
  const q = $("#lsQ"); let tm;
  q.oninput = () => { listF.q = q.value; clearTimeout(tm); tm = setTimeout(async () => {
    lineHits = null;
    if (listF.q.trim().length >= 3) {
      const { data } = await supabase.from("exp_invoice_lines").select("invoice_id").ilike("detail", `%${listF.q.trim()}%`).limit(1000);
      lineHits = new Set((data || []).map(r => r.invoice_id));
    }
    const pos = q.selectionStart; re(); const n = $("#lsQ"); n.focus(); n.setSelectionRange(pos, pos);
  }, 250); };
  $("#lsY").onchange = e => { listF.year = e.target.value; re(); };
  $("#lsC").onchange = e => { listF.cat = e.target.value; re(); };
  $("#lsS").onchange = e => { listF.status = e.target.value; re(); };
  $("#lsMore")?.addEventListener("click", () => { listF.shown += 200; renderList(); });
  document.querySelectorAll("[data-s]").forEach(el => el.onclick = () => { listF.status = el.dataset.s; re(); });
  document.querySelectorAll("tr[data-id]").forEach(tr => tr.onclick = () => { location.hash = "#/invoice/" + tr.dataset.id; });
  $("#lsExport").onclick = () => exportExcel(list);
}

// Export แบบชีต Data เดิม: หนึ่งแถวต่อหนึ่งบรรทัด (ใช้ต่อใน Excel/บัญชีได้เหมือนเดิม)
async function exportExcel(list) {
  if (!list.length) { toast("ไม่มีรายการ"); return; }
  toast("กำลังเตรียมไฟล์…");
  const ids = list.map(i => i.id), lines = [];
  for (let k = 0; k < ids.length; k += 300) {
    const { data, error } = await supabase.from("exp_invoice_lines").select("*").in("invoice_id", ids.slice(k, k + 300)).order("line_no");
    if (error) { toast("ดึงรายการไม่สำเร็จ: " + error.message, "err"); return; }
    lines.push(...data);
  }
  const byInv = new Map(list.map(i => [i.id, i]));
  const rows = lines.sort((a, b) => ids.indexOf(a.invoice_id) - ids.indexOf(b.invoice_id) || a.line_no - b.line_no).map(l => {
    const i = byInv.get(l.invoice_id);
    return { "Invoice No.": i.inv_no || "(ร่าง)", "Date": i.inv_date, "Category": i.category || "", "V_Code": i.vendor?.code || "", "Vendor": i.vendor?.name || "",
             "Ref.": i.ref_no || "", "Cost Code": l.cost_code || "", "Detail_line 1": l.detail, "Detail_line 2": l.detail2 || "",
             "Amount (THB)": Number(l.amount), "VAT": Number(l.vat), "WHT": Number(l.wht), "Net": Number(l.net), "Status": (ST[i.status] || [i.status])[0] };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{ wch: 15 }, { wch: 11 }, { wch: 18 }, { wch: 8 }, { wch: 34 }, { wch: 16 }, { wch: 15 }, { wch: 50 }, { wch: 20 }, { wch: 13 }, { wch: 10 }, { wch: 10 }, { wch: 13 }, { wch: 14 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Data");
  XLSX.writeFile(wb, `HR_Invoice_${todayISO()}.xlsx`);
}

// ---------------------------------------------------------------- ใบแจ้งหนี้ (สร้าง / แก้ / ลงนาม)
let E = null;   // { inv, lines, files }
async function renderEditor(arg) {
  if (arg === "new") {
    if (!canWrite()) { location.hash = "#/invoices"; return; }
    E = { inv: { id: null, inv_no: null, inv_date: todayISO(), vendor_id: null, vendor: null, category: "", ref_no: "", ref_date: null, po_no: "", wht_rate: 3, status: "draft", note: "" },
          lines: [{ cost_code: "", detail: "", detail2: "", amount: "", vat_rate: 7 }], files: [] };
  } else {
    $("#spMain").innerHTML = `<div class="sp-loading">กำลังโหลด…</div>`;
    const [inv, lines, files] = await Promise.all([
      supabase.from("exp_invoices").select("*").eq("id", +arg).maybeSingle(),
      supabase.from("exp_invoice_lines").select("*").eq("invoice_id", +arg).order("line_no"),
      supabase.from("exp_files").select("*").eq("invoice_id", +arg).order("uploaded_at"),
    ]);
    if (!inv.data) { $("#spMain").innerHTML = `<div class="empty">ไม่พบใบแจ้งหนี้นี้ (อาจถูกลบ หรือไม่มีสิทธิ์ดู)</div>`; return; }
    E = { inv: inv.data, lines: (lines.data || []).map(l => ({ ...l })), files: files.data || [] };
  }
  drawEditor();
}
const editable = () => canWrite() && ["draft", "rejected"].includes(E.inv.status);
const catCode = name => S.cats.find(c => c.name === name)?.cost_code || "";

function drawEditor() {
  const { inv, lines } = E, ed = editable();
  const tot = invoiceTotals(lines, inv.wht_rate);
  const v = inv.vendor_id ? (S.vendors.find(x => x.id === inv.vendor_id) || inv.vendor || {}) : null;
  const ro = ed ? "" : "disabled";
  const isReviewer = inv.status === "review" && inv.reviewer_id === S.user.id && can("data.expense.review");
  const isApprover = inv.status === "approval" && inv.approver_id === S.user.id && can("data.expense.approve");
  const step = (state, title, who, when) => `<div class="step ${state}"><i>${state === "done" ? "✓" : state === "now" ? "●" : "○"}</i>
    <div><b>${title}</b><span>${esc(who || "—")}</span><small>${esc(when || "")}</small></div></div>`;
  const at = s => s?.at ? new Date(s.at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "";
  const order = ["draft", "review", "approval", "approved", "received"], k = order.indexOf(inv.status === "rejected" ? "draft" : inv.status);
  const st = i => inv.status === "cancelled" ? "todo" : k > i ? "done" : k === i ? "now" : "todo";
  $("#spMain").innerHTML = `
  <div class="sp-head"><div class="t"><div class="sp-title">${esc(inv.inv_no || "ใบแจ้งหนี้ใหม่")} ${inv.id ? badge(inv) : ""}</div>
    <div class="sp-sub">${inv.inv_no ? `ออก ${thDate(inv.inv_date)}${inv.imported ? " · นำเข้าจาก Excel (ลงนามบนกระดาษ)" : ""}` : "เลขที่ออกให้อัตโนมัติเมื่อส่งตรวจ"}</div></div>
    <a class="btn btn-g" href="#/invoices">← รายการ</a>
    <button class="btn btn-s" id="edPrint"><svg viewBox="0 0 24 24"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z"/></svg>ดูตัวอย่าง / PDF</button>
    ${ed ? `<button class="btn btn-s" id="edSave">บันทึกร่าง</button><button class="btn btn-p" id="edSubmit">ส่งตรวจ</button>` : ""}</div>
  ${inv.status === "rejected" && inv.reject_reason ? `<div class="note r" style="margin-bottom:16px">ส่งกลับแก้ไข: ${esc(inv.reject_reason)}</div>` : ""}
  <div class="ed"><div class="ed-col">
    <div class="card card-b">
      <div class="row">
        <div class="fld grow" style="flex:2"><span>ผู้ขาย / ผู้รับเงิน</span>
          <div class="pick"><input class="in" id="edVendor" ${ro} autocomplete="off" placeholder="พิมพ์รหัสหรือชื่อเพื่อค้นหา" value="${esc(v ? `${v.code} · ${v.name}` : "")}"><div class="pick-list" id="edVList" hidden></div></div></div>
        <label class="fld" style="width:170px"><span>วันที่ใบแจ้งหนี้</span><input class="in" type="date" id="edDate" ${ro} value="${esc(inv.inv_date || "")}"></label>
        <label class="fld" style="width:210px"><span>หมวดค่าใช้จ่าย</span><select class="in" id="edCat" ${ro}><option value="">— เลือก —</option>
          ${S.cats.filter(c => c.is_active || c.name === inv.category).map(c => `<option ${c.name === inv.category ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
      </div>
      <div class="row" style="margin-top:12px">
        <label class="fld grow" style="flex:2"><span>เลขที่อ้างอิง (Ref.) · ใบแจ้งหนี้/ใบเสร็จของผู้ขาย</span><input class="in" id="edRef" ${ro} value="${esc(inv.ref_no || "")}"></label>
        <label class="fld" style="width:170px"><span>วันที่ในเอกสารอ้างอิง</span><input class="in" type="date" id="edRefDate" ${ro} value="${esc(inv.ref_date || "")}"></label>
        <label class="fld" style="width:210px"><span>ใบสั่งซื้อ / PR (ถ้ามี)</span><input class="in" id="edPO" ${ro} value="${esc(inv.po_no || "")}"></label>
      </div>
      ${v ? `<div class="vinfo"><div><span>ที่อยู่</span>${esc(v.address || "—")}</div><div><span>บัญชีรับเงิน</span>${esc(v.bank || "—")}</div><div><span>เลขผู้เสียภาษี</span>${esc(v.tax_id || "—")}</div></div>` : ""}
    </div>
    <div class="card card-b">
      <div class="row" style="align-items:flex-end;margin-bottom:4px"><div class="card-t grow" style="margin:0">รายการ</div>
        <label class="fld" style="width:200px"><span>หัก ณ ที่จ่าย (ทั้งใบ)</span><select class="in" id="edWht" ${ro}>
          ${WHT_RATES.map(r => `<option value="${r}" ${Number(inv.wht_rate) === r ? "selected" : ""}>${r ? r + "%" + (r === 3 ? " · ค่าบริการ" : r === 5 ? " · ค่าเช่า/อื่น ๆ" : r === 1 ? " · ค่าขนส่ง" : "") : "ไม่หัก"}</option>`).join("")}</select></label></div>
      <table class="lines"><thead><tr><th style="width:150px">รหัสบัญชี</th><th>รายละเอียด</th><th class="n" style="width:130px">จำนวนเงิน</th><th style="width:66px">VAT</th><th class="n" style="width:110px">สุทธิ</th>${ed ? "<th style=\"width:28px\"></th>" : ""}</tr></thead>
      <tbody>${lines.map((l, i) => { const c = lineCalc(l, inv.wht_rate); return `<tr>
        <td><input class="in" data-l="${i}" data-k="cost_code" ${ro} value="${esc(l.cost_code || "")}" placeholder="${esc(catCode(inv.category) || "รหัสบัญชี")}"></td>
        <td><input class="in" data-l="${i}" data-k="detail" ${ro} value="${esc(l.detail || "")}" placeholder="เช่น Meal for Employees : 1-15 October 2026 (652×65)">
          ${l.detail2 || ed ? `<input class="in" data-l="${i}" data-k="detail2" ${ro} value="${esc(l.detail2 || "")}" placeholder="บรรทัดที่ 2 (ถ้ามี)" style="margin-top:6px;font-size:13px">` : ""}</td>
        <td><input class="in" data-l="${i}" data-k="amount" ${ro} type="number" step="0.01" style="text-align:right" value="${l.amount === "" ? "" : Number(l.amount)}"></td>
        <td><label class="chk"><input type="checkbox" data-l="${i}" data-k="vat_rate" ${ro} ${Number(l.vat_rate) === 7 ? "checked" : ""}>7%</label></td>
        <td class="net n" data-net="${i}">${money(c.net)}</td>
        ${ed ? `<td><button class="x" data-del="${i}" title="ลบบรรทัด">✕</button></td>` : ""}</tr>`; }).join("")}</tbody></table>
      ${ed ? `<button class="btn btn-g btn-sm" id="edAdd"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>เพิ่มบรรทัด</button>` : ""}
      <div class="hint" style="margin-top:6px">VAT 7% และ หัก ณ ที่จ่าย คำนวณจากจำนวนเงิน (ก่อน VAT) ทีละบรรทัด ปัด 2 ตำแหน่ง</div>
      <div class="totals"><div class="w"><span>จำนวนเงินตัวอักษร</span><b id="edWords" style="display:block">${esc(amountWords(tot.net))}</b>
        <label class="fld" style="margin-top:12px"><span>หมายเหตุ (พิมพ์ในใบ)</span><textarea class="in" id="edNote" ${ro} rows="2">${esc(inv.note || "")}</textarea></label></div>
        <div class="sums" id="edSums">${sumsHTML(tot, inv.wht_rate)}</div></div>
    </div>
  </div>
  <div class="ed-col">
    <div class="card card-b"><div class="card-t">ขั้นตอนลงนาม</div>
      <div class="steps">
        ${step(st(0), "จัดทำ (Prepared)", inv.preparer?.name || (inv.id ? "" : S.me?.name_en || S.me?.name_th || S.user.email), at(inv.preparer) || (inv.status === "rejected" ? "ส่งกลับให้แก้ไข" : ""))}
        ${step(st(1), "ตรวจ (Reviewed)", inv.reviewer?.name || (inv.reviewer_id ? signerName(inv.reviewer_id) : ""), at(inv.reviewer) || (inv.status === "review" ? "รอตรวจ" : ""))}
        ${step(st(2), "อนุมัติ (Approved)", inv.approver?.name || (inv.approver_id ? signerName(inv.approver_id) : ""), at(inv.approver) || (inv.status === "approval" ? "รออนุมัติ" : ""))}
        ${step(st(3) === "done" || inv.status === "received" ? "done" : st(3), "รับเอกสาร (Received)", inv.received_name || "ฝ่ายบัญชี", inv.status === "received" ? thDate(inv.received_at) : "หลังอนุมัติ")}
      </div>
      ${inv.imported ? `<div class="note">ใบนี้นำเข้าจาก Excel เดิม — ลงนามบนกระดาษแล้ว</div>` : ""}
      ${isReviewer || isApprover ? `<div class="note">${isReviewer ? "ลายเซ็นของท่านจะลงช่อง Reviewed by เมื่อกดยืนยัน" : "ลายเซ็นของท่านจะลงช่อง Approved by เมื่อกดอนุมัติ"}</div>
        <div class="acts"><button class="btn btn-d" id="edNo">ส่งกลับแก้ไข</button><button class="btn btn-p" id="edYes">✓ ${isReviewer ? "ตรวจแล้ว ลงนาม" : "อนุมัติและลงนาม"}</button></div>` : ""}
      ${canWrite() && !inv.imported ? `<div class="acts">
        ${["review", "approval"].includes(inv.status) ? `<button class="btn btn-s btn-sm" id="edRecall">ดึงกลับเป็นร่าง</button>` : ""}
        ${inv.status === "approved" ? `<button class="btn btn-p btn-sm" id="edReceive">ส่งบัญชีแล้ว</button>` : ""}
        ${inv.id && !["cancelled", "draft"].includes(inv.status) ? `<button class="btn btn-d btn-sm" id="edCancel">ยกเลิกใบ</button>` : ""}
        ${inv.id && inv.status === "draft" && !inv.inv_no ? `<button class="btn btn-d btn-sm" id="edDelete">ลบร่าง</button>` : ""}</div>` : ""}
    </div>
    <div class="card card-b"><div class="card-t">ไฟล์แนบ</div>
      <div class="files">${E.files.map(f => `<a href="#" data-f="${f.id}"><svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>${esc(f.name)}</a>`).join("") || `<div class="hint">ยังไม่มีไฟล์แนบ</div>`}</div>
      ${canWrite() ? `<label class="btn btn-s btn-sm" style="margin-top:10px">แนบไฟล์<input type="file" id="edFile" hidden multiple></label>${inv.id ? "" : `<div class="hint" style="margin-top:6px">บันทึกร่างก่อน แล้วจึงแนบไฟล์</div>`}` : ""}
    </div>
  </div></div>`;
  wireEditor();
}
const sumsHTML = (t, r) => `<div><span>ยอดก่อน VAT</span><span>${money(t.amount)}</span></div><div><span>VAT 7%</span><span>${money(t.vat)}</span></div>
  <div><span>หัก ณ ที่จ่าย ${Number(r) || 0}%</span><span>${t.wht ? "−" + money(t.wht) : "0.00"}</span></div><div class="big"><span>ยอดชำระสุทธิ</span><b>${money(t.net)}</b></div>`;

function readForm() {
  const g = id => $(id)?.value;
  Object.assign(E.inv, { inv_date: g("#edDate") || todayISO(), category: g("#edCat") || null, ref_no: (g("#edRef") || "").trim() || null,
    ref_date: g("#edRefDate") || null, po_no: (g("#edPO") || "").trim() || null, wht_rate: Number(g("#edWht")) || 0, note: (g("#edNote") || "").trim() || null });
}
function wireEditor() {
  const ed = editable();
  if (ed) {
    const recalc = () => { readForm(); const t = invoiceTotals(E.lines, E.inv.wht_rate);
      E.lines.forEach((l, i) => { const n = document.querySelector(`[data-net="${i}"]`); if (n) n.textContent = money(lineCalc(l, E.inv.wht_rate).net); });
      $("#edSums").innerHTML = sumsHTML(t, E.inv.wht_rate); $("#edWords").textContent = amountWords(t.net); };
    document.querySelectorAll("[data-l]").forEach(el => el.addEventListener(el.type === "checkbox" ? "change" : "input", () => {
      const l = E.lines[+el.dataset.l], k = el.dataset.k;
      l[k] = k === "vat_rate" ? (el.checked ? 7 : 0) : k === "amount" ? el.value : el.value;
      recalc();
    }));
    ["#edWht", "#edDate", "#edCat", "#edRef", "#edRefDate", "#edPO", "#edNote"].forEach(id => $(id)?.addEventListener("change", recalc));
    $("#edCat").addEventListener("change", () => { readForm(); const cc = catCode(E.inv.category);   // รหัสบัญชีตั้งต้นของหมวด เติมให้บรรทัดที่ยังว่าง
      if (cc) { E.lines.forEach(l => { if (!l.cost_code) l.cost_code = cc; }); drawEditor(); } });
    $("#edAdd").onclick = () => { readForm(); E.lines.push({ cost_code: catCode(E.inv.category), detail: "", detail2: "", amount: "", vat_rate: E.lines.at(-1)?.vat_rate ?? 7 }); drawEditor(); };
    document.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { readForm(); E.lines.splice(+b.dataset.del, 1); if (!E.lines.length) E.lines.push({ cost_code: "", detail: "", amount: "", vat_rate: 7 }); drawEditor(); });
    vendorPicker();
    $("#edSave").onclick = async () => { if (await save()) toast("บันทึกร่างแล้ว", "ok"); };
    $("#edSubmit").onclick = submitFlow;
  }
  $("#edPrint").onclick = async () => { if (editable()) readForm(); await print(); };
  $("#edYes")?.addEventListener("click", () => decide(true));
  $("#edNo")?.addEventListener("click", () => decide(false));
  $("#edRecall")?.addEventListener("click", () => act("recall", "ดึงกลับเป็นร่างแล้ว"));
  $("#edReceive")?.addEventListener("click", receiveFlow);
  $("#edCancel")?.addEventListener("click", async () => { const why = prompt(`ยกเลิกใบ ${E.inv.inv_no}? เลขที่นี้จะไม่นำกลับมาใช้\nเหตุผล:`, ""); if (why !== null) act("cancel", "ยกเลิกใบแล้ว", why); });
  $("#edDelete")?.addEventListener("click", async () => {
    if (!confirm("ลบร่างนี้?")) return;
    const { error } = await supabase.from("exp_invoices").delete().eq("id", E.inv.id);
    if (error) { toast("ลบไม่สำเร็จ: " + error.message, "err"); return; }
    S.invoices = S.invoices.filter(i => i.id !== E.inv.id); toast("ลบร่างแล้ว", "ok"); location.hash = "#/invoices";
  });
  $("#edFile")?.addEventListener("change", e => upload([...e.target.files]));
  document.querySelectorAll("[data-f]").forEach(a => a.onclick = async ev => { ev.preventDefault();
    const f = E.files.find(x => x.id === +a.dataset.f);
    const { data, error } = await supabase.storage.from("expense-files").createSignedUrl(f.path, 120);
    if (error) { toast("เปิดไฟล์ไม่สำเร็จ: " + error.message, "err"); return; }
    window.open(data.signedUrl, "_blank"); });
}

// ค้นหาผู้ขายจากรหัส / ชื่อ (พิมพ์ส่วนไหนของชื่อก็เจอ)
function vendorPicker() {
  const inp = $("#edVendor"), box = $("#edVList"); let hi = 0, items = [];
  const show = () => {
    const q = inp.value.trim().toLowerCase();
    items = S.vendors.filter(v => v.is_active && (!q || `${v.code} ${v.name}`.toLowerCase().includes(q))).slice(0, 30);
    box.innerHTML = items.map((v, i) => `<button type="button" class="${i === hi ? "hi" : ""}" data-v="${v.id}">${esc(v.code)} · ${esc(v.name)}<small>${esc(v.address || "")}</small></button>`).join("")
      || `<div class="hint" style="padding:10px 12px">ไม่พบ — เพิ่มผู้ขายใหม่ได้ที่เมนู ผู้ขาย / ผู้รับเงิน</div>`;
    box.hidden = false;
    box.querySelectorAll("[data-v]").forEach(b => b.onmousedown = e => { e.preventDefault(); choose(+b.dataset.v); });
  };
  const choose = id => { readForm(); const v = S.vendors.find(x => x.id === id); E.inv.vendor_id = v.id;
    E.inv.vendor = { code: v.code, name: v.name, address: v.address, bank: v.bank, tax_id: v.tax_id }; drawEditor(); };
  inp.onfocus = () => { hi = 0; show(); }; inp.oninput = () => { hi = 0; show(); };
  inp.onblur = () => setTimeout(() => { box.hidden = true; }, 150);
  inp.onkeydown = e => {
    if (e.key === "ArrowDown") { hi = Math.min(items.length - 1, hi + 1); show(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { hi = Math.max(0, hi - 1); show(); e.preventDefault(); }
    else if (e.key === "Enter" && items[hi]) { choose(items[hi].id); e.preventDefault(); }
  };
}

// บันทึกร่าง: หัวใบ + เขียนบรรทัดใหม่ทั้งชุด (แก้ได้เฉพาะร่าง/ส่งกลับ — DB บังคับ)
async function save() {
  readForm();
  const lines = E.lines.filter(l => String(l.detail || "").trim() || Number(l.amount));
  if (lines.some(l => !String(l.detail || "").trim())) { toast("ใส่รายละเอียดทุกบรรทัดที่มีจำนวนเงิน", "err"); return false; }
  const t = invoiceTotals(lines, E.inv.wht_rate);
  const v = E.inv.vendor_id ? S.vendors.find(x => x.id === E.inv.vendor_id) : null;
  const head = { inv_date: E.inv.inv_date, vendor_id: E.inv.vendor_id, vendor: v ? { code: v.code, name: v.name, address: v.address, bank: v.bank, tax_id: v.tax_id } : E.inv.vendor,
    category: E.inv.category, ref_no: E.inv.ref_no, ref_date: E.inv.ref_date, po_no: E.inv.po_no, wht_rate: E.inv.wht_rate, note: E.inv.note, ...t };
  let id = E.inv.id;
  if (!id) {
    const { data, error } = await supabase.from("exp_invoices").insert({ ...head, created_by: S.user.id }).select().single();
    if (error) { toast("บันทึกไม่สำเร็จ: " + error.message, "err"); return false; }
    id = data.id; Object.assign(E.inv, data);
  } else {
    const { data, error } = await supabase.from("exp_invoices").update(head).eq("id", id).select().single();
    if (error) { toast("บันทึกไม่สำเร็จ: " + error.message, "err"); return false; }
    Object.assign(E.inv, data);
  }
  const del = await supabase.from("exp_invoice_lines").delete().eq("invoice_id", id);
  if (del.error) { toast("บันทึกรายการไม่สำเร็จ: " + del.error.message, "err"); return false; }
  if (lines.length) {
    const rows = lines.map((l, i) => ({ invoice_id: id, line_no: i + 1, cost_code: String(l.cost_code || "").trim() || null, detail: String(l.detail).trim(),
      detail2: String(l.detail2 || "").trim() || null, vat_rate: Number(l.vat_rate) === 7 ? 7 : 0, ...lineCalc(l, E.inv.wht_rate) }));
    const ins = await supabase.from("exp_invoice_lines").insert(rows).select();
    if (ins.error) { toast("บันทึกรายการไม่สำเร็จ: " + ins.error.message, "err"); return false; }
    E.lines = ins.data.sort((a, b) => a.line_no - b.line_no);
  } else E.lines = [];
  syncList(E.inv);
  if (location.hash !== "#/invoice/" + id) history.replaceState(null, "", "#/invoice/" + id);
  return true;
}
function syncList(inv) {
  const row = { ...inv }; const k = S.invoices.findIndex(i => i.id === inv.id);
  if (k >= 0) S.invoices[k] = { ...S.invoices[k], ...row }; else S.invoices.unshift(row);
  updatePending();
}

function submitFlow() {
  if (!S.me?.signature_path) { toast("ท่านยังไม่มีลายเซ็น (ใช้ลงช่อง Prepared by) — ตั้งที่หน้า ตั้งค่า", "err"); location.hash = "#/settings"; return; }
  const rev = S.signers.filter(s => s.can_review), app = S.signers.filter(s => s.can_approve);
  if (!rev.length || !app.length) { toast("ยังไม่มีผู้ตรวจ/ผู้อนุมัติที่ตั้งลายเซ็นและมีสิทธิ์ — ให้ Admin ตั้งสิทธิ์ “ตรวจ/อนุมัติใบแจ้งหนี้ HR”", "err"); return; }
  const opts = (list, name, def) => list.map((s, i) => `<label class="opt"><input type="radio" name="${name}" value="${s.user_id}" ${(def ? s.user_id === def : i === 0) ? "checked" : ""}>
    <span><b>${esc(s.name)}</b><span class="hint" style="display:block">${esc(s.title || "")}${s.email ? " · " + esc(s.email) : ""}</span></span></label>`).join("");
  const el = modal(`ส่งตรวจ ${esc(E.inv.inv_no || "(ออกเลขใหม่)")}`, `
    <div class="fld"><span>ผู้ตรวจ (Reviewed by)</span>${opts(rev, "rv", E.inv.reviewer_id)}</div>
    <div class="fld"><span>ผู้อนุมัติ (Approved by)</span>${opts(app, "ap", E.inv.approver_id)}</div>
    <div class="note">ลายเซ็นของท่านลงช่อง Prepared by · ระบบส่งอีเมลถึงผู้ตรวจ แล้วส่งต่อผู้อนุมัติเมื่อตรวจเสร็จ</div>`,
    `<button class="btn btn-s" data-x>ยกเลิก</button><button class="btn btn-p" data-ok>ลงนามและส่งตรวจ</button>`);
  el.querySelector("[data-ok]").onclick = async e => {
    e.target.disabled = true;
    if (!(await save())) { e.target.disabled = false; return; }
    if (!E.lines.length || !E.inv.vendor_id) { toast("เลือกผู้ขายและใส่รายการก่อนส่งตรวจ", "err"); e.target.disabled = false; return; }
    const { data, error } = await supabase.rpc("exp_submit", { p_id: E.inv.id, p_reviewer: el.querySelector("[name=rv]:checked").value, p_approver: el.querySelector("[name=ap]:checked").value });
    if (error) { toast("ส่งตรวจไม่สำเร็จ: " + error.message, "err"); e.target.disabled = false; return; }
    el.remove(); Object.assign(E.inv, data); syncList(E.inv);
    notifyHR("มีใบแจ้งหนี้รอตรวจ", E.inv);
    toast(`ส่งตรวจ ${data.inv_no} แล้ว · ${await sendMail(E.inv, "exp_review", E.lines)}`, "ok");
    drawEditor();
  };
}
async function decide(ok) {
  let reason = null;
  if (!ok) { reason = prompt("ส่งกลับให้ผู้จัดทำแก้ไข เพราะอะไร?", ""); if (reason === null) return; }
  const was = E.inv.status;
  const { data, error } = await supabase.rpc("exp_decide", { p_id: E.inv.id, p_ok: ok, p_reason: reason });
  if (error) { toast("ไม่สำเร็จ: " + error.message, "err"); return; }
  Object.assign(E.inv, data); syncList(E.inv);
  const action = !ok ? "exp_rejected" : was === "review" ? "exp_approve" : "exp_approved";
  notifyHR(!ok ? "ใบแจ้งหนี้ถูกส่งกลับแก้ไข" : was === "review" ? "มีใบแจ้งหนี้รออนุมัติ" : "ใบแจ้งหนี้อนุมัติแล้ว", E.inv);
  toast(`${!ok ? "ส่งกลับแล้ว" : was === "review" ? "ตรวจแล้ว ส่งต่อผู้อนุมัติ" : "อนุมัติแล้ว"} · ${await sendMail(E.inv, action, E.lines)}`, "ok");
  drawEditor();
}
async function act(action, msg, text = null, date = null) {
  const { data, error } = await supabase.rpc("exp_action", { p_id: E.inv.id, p_action: action, p_text: text, p_date: date });
  if (error) { toast("ไม่สำเร็จ: " + error.message, "err"); return; }
  Object.assign(E.inv, data); syncList(E.inv); toast(msg, "ok"); drawEditor();
}
function receiveFlow() {
  const el = modal(`ส่งบัญชี ${esc(E.inv.inv_no)}`, `
    <label class="fld"><span>ผู้รับเอกสาร (ฝ่ายบัญชี)</span><input class="in" id="rcName" placeholder="ชื่อผู้รับ"></label>
    <label class="fld"><span>วันที่รับ</span><input class="in" type="date" id="rcDate" value="${todayISO()}"></label>`,
    `<button class="btn btn-s" data-x>ยกเลิก</button><button class="btn btn-p" data-ok>บันทึก</button>`);
  el.querySelector("[data-ok]").onclick = async () => { const n = el.querySelector("#rcName").value, d = el.querySelector("#rcDate").value; el.remove(); await act("receive", "บันทึกส่งบัญชีแล้ว", n, d || null); };
}
async function upload(files) {
  if (!E.inv.id) { toast("บันทึกร่างก่อน แล้วจึงแนบไฟล์", "err"); return; }
  for (const f of files) {
    if (f.size > 20 * 1024 * 1024) { toast(`${f.name} ใหญ่เกิน 20MB`, "err"); continue; }
    const path = `${E.inv.id}/${Date.now()}_${f.name.replace(/[^\w.\-ก-๙]+/g, "_")}`;
    const up = await supabase.storage.from("expense-files").upload(path, f, { contentType: f.type || "application/octet-stream" });
    if (up.error) { toast("อัปโหลดไม่สำเร็จ: " + up.error.message, "err"); continue; }
    const { data, error } = await supabase.from("exp_files").insert({ invoice_id: E.inv.id, path, name: f.name, size: f.size, uploaded_by: S.user.id }).select().single();
    if (error) { toast("บันทึกไฟล์ไม่สำเร็จ: " + error.message, "err"); continue; }
    E.files.push(data);
  }
  drawEditor(); toast("แนบไฟล์แล้ว", "ok");
}
async function assetData(path) {
  if (!path) return "";
  const { data } = await supabase.storage.from("letter-assets").download(path);
  return data ? await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(data); }) : "";
}
async function print() {
  const inv = { ...E.inv };
  const lines = E.inv.id && !editable() ? E.lines : E.lines.filter(l => String(l.detail || "").trim() || Number(l.amount))
    .map(l => ({ ...l, ...lineCalc(l, inv.wht_rate) }));
  if (!inv.vendor && inv.vendor_id) { const v = S.vendors.find(x => x.id === inv.vendor_id); inv.vendor = v; }
  const [preparer, reviewer, approver] = await Promise.all([assetData(inv.preparer?.signature_path), assetData(inv.reviewer?.signature_path), assetData(inv.approver?.signature_path)]);
  printInvoice(inv, lines, { preparer, reviewer, approver });
}

// ---------------------------------------------------------------- ผู้ขาย
let vQ = "";
function renderVendors() {
  const q = vQ.trim().toLowerCase();
  const list = S.vendors.filter(v => !q || [v.code, v.name, v.address, v.bank, v.tax_id].join(" ").toLowerCase().includes(q));
  const used = new Map(); for (const i of S.invoices) if (i.vendor_id) used.set(i.vendor_id, (used.get(i.vendor_id) || 0) + 1);
  $("#spMain").innerHTML = `
  <div class="sp-head"><div class="t"><div class="sp-title">ผู้ขาย / ผู้รับเงิน</div><div class="sp-sub">${S.vendors.length} ราย · เลือกใช้ตอนออกใบแจ้งหนี้</div></div>
    ${canWrite() ? `<button class="btn btn-p" id="vAdd"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>เพิ่มผู้ขาย</button>` : ""}</div>
  <div class="filters"><label class="fld" style="flex:1;max-width:420px"><span>ค้นหา</span><input class="in" id="vQ" value="${esc(vQ)}" placeholder="รหัส / ชื่อ / ที่อยู่ / บัญชี"></label></div>
  <div class="card"><div class="tbl-wrap">${list.length ? `<table class="tbl"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>ที่อยู่</th><th>บัญชีรับเงิน</th><th class="n">ใบที่ออก</th><th></th></tr></thead><tbody>
    ${list.slice(0, 300).map(v => `<tr style="${v.is_active ? "" : "opacity:.5"}"><td><b>${esc(v.code)}</b></td><td>${esc(v.name)}${v.tax_id ? `<div class="sub">Tax ID ${esc(v.tax_id)}</div>` : ""}</td>
      <td style="max-width:320px">${esc(v.address || "")}</td><td>${esc(v.bank || "")}</td><td class="n">${used.get(v.id) || 0}</td>
      <td>${canWrite() ? `<button class="btn btn-s btn-sm" data-v="${v.id}">แก้ไข</button>` : ""}</td></tr>`).join("")}</tbody></table>`
    : `<div class="empty">ไม่พบผู้ขาย</div>`}</div></div>`;
  const qi = $("#vQ"); qi.oninput = () => { vQ = qi.value; const p = qi.selectionStart; renderVendors(); const n = $("#vQ"); n.focus(); n.setSelectionRange(p, p); };
  $("#vAdd")?.addEventListener("click", () => vendorForm(null));
  document.querySelectorAll("[data-v]").forEach(b => b.onclick = () => vendorForm(S.vendors.find(v => v.id === +b.dataset.v)));
}
function vendorForm(v) {
  const el = modal(v ? `แก้ไข ${esc(v.code)}` : "เพิ่มผู้ขาย", `
    <div class="grid2"><label class="fld"><span>รหัส *</span><input class="in" id="vfCode" value="${esc(v?.code || "")}" ${v ? "readonly" : ""} placeholder="เช่น T0040"></label>
      <label class="fld"><span>เลขผู้เสียภาษี</span><input class="in" id="vfTax" value="${esc(v?.tax_id || "")}"></label></div>
    <label class="fld"><span>ชื่อ *</span><input class="in" id="vfName" value="${esc(v?.name || "")}"></label>
    <label class="fld"><span>ที่อยู่</span><textarea class="in" id="vfAddr" rows="2">${esc(v?.address || "")}</textarea></label>
    <label class="fld"><span>บัญชีรับเงิน</span><input class="in" id="vfBank" value="${esc(v?.bank || "")}" placeholder="เช่น KBANK 123-4-56789-0 (สาขา…)"></label>
    ${v ? `<label class="chk"><input type="checkbox" id="vfAct" ${v.is_active ? "checked" : ""}> ใช้งาน (ปิดแล้วไม่ขึ้นให้เลือกในใบใหม่)</label>` : ""}
    <div class="hint">แก้ข้อมูลผู้ขายไม่กระทบใบที่ออกไปแล้ว (ใบเก็บสำเนาไว้)</div>`,
    `<button class="btn btn-s" data-x>ยกเลิก</button><button class="btn btn-p" data-ok>บันทึก</button>`);
  el.querySelector("[data-ok]").onclick = async () => {
    const g = id => el.querySelector(id).value.trim();
    const row = { name: g("#vfName"), address: g("#vfAddr") || null, bank: g("#vfBank") || null, tax_id: g("#vfTax") || null, updated_at: new Date().toISOString() };
    if (!row.name || (!v && !g("#vfCode"))) { toast("ใส่รหัสและชื่อ", "err"); return; }
    if (v) row.is_active = el.querySelector("#vfAct").checked; else row.code = g("#vfCode").toUpperCase();
    const { data, error } = v ? await supabase.from("exp_vendors").update(row).eq("id", v.id).select().single() : await supabase.from("exp_vendors").insert(row).select().single();
    if (error) { toast(/duplicate/.test(error.message) ? "รหัสนี้มีอยู่แล้ว" : "บันทึกไม่สำเร็จ: " + error.message, "err"); return; }
    if (v) Object.assign(v, data); else S.vendors.push(data);
    S.vendors.sort((a, b) => a.code.localeCompare(b.code)); el.remove(); toast("บันทึกแล้ว", "ok"); renderVendors();
  };
}

// ---------------------------------------------------------------- งบประมาณ
let bFY = null, budgets = null;
async function renderBudget() {
  bFY = bFY || fiscalYear(todayISO());
  if (!budgets || budgets.fy !== bFY) {
    const { data } = await supabase.from("exp_budgets").select("*").eq("fy", bFY);
    budgets = { fy: bFY, map: Object.fromEntries((data || []).map(b => [b.category, Number(b.amount)])) };
  }
  const spent = {}; for (const i of S.invoices) if (!["draft", "cancelled"].includes(i.status) && fiscalYear(i.inv_date) === bFY) spent[i.category || "ไม่ระบุหมวด"] = (spent[i.category || "ไม่ระบุหมวด"] || 0) + Number(i.amount || 0);
  const names = [...new Set([...S.cats.filter(c => c.is_active).map(c => c.name), ...Object.keys(spent)])];
  const totB = names.reduce((s, n) => s + (budgets.map[n] || 0), 0), totS = names.reduce((s, n) => s + (spent[n] || 0), 0);
  $("#spMain").innerHTML = `
  <div class="sp-head"><div class="t"><div class="sp-title">งบประมาณ</div><div class="sp-sub">ปีงบ ${bFY} (ก.ค. ${bFY - 1} – มิ.ย. ${bFY}) · เทียบยอดก่อน VAT ของใบที่ส่งตรวจแล้ว</div></div>
    <label class="fld"><span>ปีงบ</span><select class="in" id="bFY">${[bFY + 1, bFY, bFY - 1, bFY - 2].map(y => `<option ${y === bFY ? "selected" : ""}>${y}</option>`).join("")}</select></label>
    ${canWrite() ? `<button class="btn btn-p" id="bSave">บันทึกงบ</button>` : ""}</div>
  <div class="stats" style="grid-template-columns:repeat(3,minmax(0,1fr))">
    <div class="stat"><div class="l">งบรวม</div><div class="v">${money(totB)}</div><div class="m">${names.filter(n => budgets.map[n]).length} หมวดที่ตั้งงบ</div></div>
    <div class="stat"><div class="l">ใช้ไป</div><div class="v">${money(totS)}</div><div class="m">${totB ? (totS / totB * 100).toFixed(1) + "% ของงบ" : "ยังไม่ตั้งงบ"}</div></div>
    <div class="stat ${totB && totS > totB ? "hl" : ""}"><div class="l">คงเหลือ</div><div class="v">${money(totB - totS)}</div><div class="m">&nbsp;</div></div>
  </div>
  <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>หมวด</th><th class="n" style="width:170px">งบประมาณ</th><th class="n">ใช้ไป</th><th class="n">คงเหลือ</th><th style="width:220px">สัดส่วน</th></tr></thead><tbody>
    ${names.map(n => { const b = budgets.map[n] || 0, s = spent[n] || 0, p = b ? s / b * 100 : 0;
      return `<tr><td>${esc(n)}</td><td class="n">${canWrite() ? `<input class="in" type="number" step="0.01" data-b="${esc(n)}" value="${b || ""}" style="text-align:right;max-width:150px">` : money(b)}</td>
        <td class="n">${money(s)}</td><td class="n" style="${b && s > b ? "color:var(--red);font-weight:600" : ""}">${b ? money(b - s) : "–"}</td>
        <td>${b ? `<div style="display:flex;align-items:center;gap:8px"><div class="bar" style="flex:1"><i class="${s > b ? "over" : ""}" style="width:${Math.min(100, p)}%"></i></div><span class="hint">${p.toFixed(0)}%</span></div>` : `<span class="hint">ยังไม่ตั้งงบ</span>`}</td></tr>`; }).join("")}
  </tbody></table></div></div>`;
  $("#bFY").onchange = e => { bFY = +e.target.value; renderBudget(); };
  $("#bSave")?.addEventListener("click", async () => {
    const rows = [...document.querySelectorAll("[data-b]")].map(i => ({ fy: bFY, category: i.dataset.b, amount: Number(i.value) || 0, updated_at: new Date().toISOString() }));
    const { error } = await supabase.from("exp_budgets").upsert(rows);
    if (error) { toast("บันทึกไม่สำเร็จ: " + error.message, "err"); return; }
    budgets = null; toast("บันทึกงบแล้ว", "ok"); renderBudget();
  });
}

// ---------------------------------------------------------------- ตั้งค่า
function renderSettings() {
  $("#spMain").innerHTML = `
  <div class="sp-head"><div class="t"><div class="sp-title">ตั้งค่า</div><div class="sp-sub">หมวดค่าใช้จ่าย · ลายเซ็นของฉัน · นำเข้าข้อมูลเดิม</div></div></div>
  <div class="ed" style="grid-template-columns:minmax(0,1.3fr) minmax(0,1fr)"><div class="ed-col">
    <div class="card card-b"><div class="card-t">หมวดค่าใช้จ่าย <span class="hint" style="font-weight:400">รหัสบัญชีของหมวด = ค่าตั้งต้นของบรรทัดในใบใหม่</span></div>
      <table class="tbl"><thead><tr><th>หมวด</th><th>ชื่อไทย</th><th>รหัสบัญชี (Cost Code)</th><th>ใช้งาน</th></tr></thead><tbody>
      ${S.cats.map(c => `<tr><td><b>${esc(c.name)}</b></td>
        <td><input class="in" data-c="${c.id}" data-k="name_th" value="${esc(c.name_th || "")}" ${canWrite() ? "" : "disabled"}></td>
        <td><input class="in" data-c="${c.id}" data-k="cost_code" value="${esc(c.cost_code || "")}" placeholder="ใส่ทีหลังได้" ${canWrite() ? "" : "disabled"}></td>
        <td><input type="checkbox" data-c="${c.id}" data-k="is_active" ${c.is_active ? "checked" : ""} ${canWrite() ? "" : "disabled"}></td></tr>`).join("") || `<tr><td colspan="4" class="empty">ยังไม่มีหมวด — นำเข้าจาก Excel หรือเพิ่มด้านล่าง</td></tr>`}
      </tbody></table>
      ${canWrite() ? `<div class="row" style="margin-top:12px"><input class="in grow" id="cNew" placeholder="ชื่อหมวดใหม่ (อังกฤษ ตามไฟล์เดิม)"><button class="btn btn-s" id="cAdd">เพิ่มหมวด</button><button class="btn btn-p" id="cSave">บันทึกหมวด</button></div>
      <div class="note" style="margin-top:14px"><b>ใส่ Cost Code ทีเดียวหลายหมวด</b> — เลือกได้ 2 ทาง (กด “บันทึกหมวด” หลังเติมเพื่อยืนยัน)</div>
      <div class="row" style="margin-top:10px">
        <button class="btn btn-s btn-sm" id="ccGuess" title="ดูจากบรรทัดของใบที่ออกในปีล่าสุด ใช้รหัสที่ใช้บ่อยที่สุดของแต่ละหมวด">เติมจากใบที่เคยออก (ปีล่าสุด)</button>
        <button class="btn btn-s btn-sm" id="ccTpl">ดาวน์โหลดแบบฟอร์ม Excel</button>
        <label class="btn btn-s btn-sm">นำเข้า Cost Code จาก Excel<input type="file" id="ccFile" accept=".xlsx,.xls,.csv" hidden></label></div>
      <div class="hint" id="ccOut" style="margin-top:8px">ไฟล์ Excel: คอลัมน์ <b>Category</b> กับ <b>Cost Code</b> (ชื่อหมวดต้องตรงกับในระบบ)</div>` : ""}
    </div>
  </div><div class="ed-col">
    <div class="card card-b"><div class="card-t">ลายเซ็นของฉัน</div>
      <p class="hint" style="margin-bottom:10px">ใช้ลงช่อง Prepared / Reviewed / Approved ในใบ (ชุดเดียวกับหนังสือ HR) · ชื่อภาษาอังกฤษพิมพ์ใต้ลายเซ็น</p>
      <div class="grid2"><label class="fld"><span>Name (EN)</span><input class="in" id="sgEn" value="${esc(S.me?.name_en || "")}" placeholder="Gantida Thianyod"></label>
        <label class="fld"><span>ชื่อ (ไทย)</span><input class="in" id="sgTh" value="${esc(S.me?.name_th || "")}"></label></div>
      <div class="grid2" style="margin-top:12px"><label class="fld"><span>Title</span><input class="in" id="sgTitle" value="${esc(S.me?.title_en || S.me?.title_th || "")}"></label>
        <label class="fld"><span>อีเมลรับแจ้ง</span><input class="in" id="sgMail" value="${esc(S.me?.email || S.user.email || "")}"></label></div>
      <label class="fld" style="margin-top:12px"><span>ไฟล์ลายเซ็น (PNG พื้นใส) ${S.me?.signature_path ? `<b style="color:var(--green)">✓ มีแล้ว</b>` : ""}</span><input class="in" type="file" id="sgFile" accept="image/png"></label>
      <button class="btn btn-p" id="sgSave" style="margin-top:12px">บันทึกลายเซ็น</button>
    </div>
    ${canWrite() ? mailCardHTML() : ""}
    ${canWrite() ? `<div class="card card-b"><div class="card-t">นำเข้าข้อมูลเดิมจาก Excel</div>
      <p class="hint" style="margin-bottom:10px">ไฟล์ “HR Invoice Database” (.xlsm) — อ่านชีต Vendor + Data ในเบราว์เซอร์ · ใบที่มีเลขอยู่แล้วจะข้าม (นำเข้าซ้ำได้) · ใบเก่าบันทึกเป็น “นำเข้าจาก Excel” (ลงนามบนกระดาษแล้ว)</p>
      <label class="btn btn-s">เลือกไฟล์ Excel<input type="file" id="imFile" accept=".xlsx,.xlsm,.xls" hidden></label>
      <div id="imOut" style="margin-top:10px"></div></div>` : ""}
  </div></div>`;
  wireSettings();
}
// ---------- แบบอีเมล (ขอตรวจ / ขออนุมัติ / แจ้งอนุมัติ / แจ้งส่งกลับ) — ผู้ส่งและโหมดตั้งที่ ออกหนังสือ HR → ตั้งค่า
let tplKey = "exp_review";
const TPL_TO = { exp_review: "ผู้ตรวจที่เลือกตอนส่ง", exp_approve: "ผู้อนุมัติที่เลือกตอนส่ง", exp_approved: "ผู้จัดทำใบ", exp_rejected: "ผู้จัดทำใบ" };
const SAMPLE = { doc_no: "HRIN360/2026", person: "Thai Dong Subdistrict Community Welfare Shop", kind: "Meal for Employees (Night Shift) : 1-15 October 2026",
                 emp_code: "44,075.20 บาท", link: "#", reason: "ยอด WHT ไม่ตรง", requester: "Gantida Thianyod", approver: "Suphachoke Phanthumitr" };
function mailCardHTML() {
  const t = S.tpl.find(x => x.key === tplKey) || S.tpl[0];
  if (!t) return `<div class="card card-b"><div class="card-t">แบบอีเมล</div><div class="hint">ยังไม่มีแบบอีเมล — รัน sql/schema_expense.sql ก่อน</div></div>`;
  return `<div class="card card-b"><div class="card-t">แบบอีเมล</div>
    <p class="hint" style="margin-bottom:10px">ส่งจากอีเมลกลางเดียวกับหนังสือ HR · โหมด: <b>${S.mail.mode === "auto" ? "ส่งอัตโนมัติ" : "เปิดใน Outlook (.eml)"}</b> (เปลี่ยนที่ ออกหนังสือ HR → ตั้งค่า)<br>
      ตัวแปร: <code>{{doc_no}}</code> เลขที่ · <code>{{person}}</code> ผู้ขาย · <code>{{kind}}</code> รายการ · <code>{{emp_code}}</code> ยอดชำระ · <code>{{requester}}</code> · <code>{{approver}}</code> · <code>{{reason}}</code> · <code>{{link}}</code></p>
    <label class="fld"><span>แบบ</span><select class="in" id="mtKey">${S.tpl.map(x => `<option value="${x.key}" ${x.key === t.key ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select></label>
    <div class="hint" style="margin-top:6px">ผู้รับหลักใส่ให้อัตโนมัติ: ${esc(TPL_TO[t.key] || "-")}</div>
    <div class="grid2" style="margin-top:10px"><label class="fld"><span>ส่งถึงเพิ่มเติม (To)</span><input class="in" id="mtTo" value="${esc(t.to_extra || "")}" placeholder="คั่นด้วย ,"></label>
      <label class="fld"><span>สำเนาถึง (CC)</span><input class="in" id="mtCc" value="${esc(t.cc || "")}" placeholder="คั่นด้วย ,"></label></div>
    <label class="fld" style="margin-top:10px"><span>หัวเรื่อง</span><input class="in" id="mtSubj" value="${esc(t.subject || "")}"></label>
    <label class="fld" style="margin-top:10px"><span>เนื้อหา (HTML) · แนะนำแก้เฉพาะข้อความ ไม่แตะโครงตาราง (Outlook classic แสดงได้เฉพาะแบบตาราง)</span>
      <textarea class="in" id="mtHtml" rows="10" spellcheck="false" style="font-family:ui-monospace,Menlo,monospace;font-size:12px">${esc(t.html || "")}</textarea></label>
    <div class="hint" style="margin-top:10px">ตัวอย่าง: <b id="mtPrevS"></b></div>
    <iframe id="mtPrev" title="ตัวอย่างอีเมล" style="width:100%;height:420px;border:1px solid var(--line);border-radius:8px;margin-top:6px;background:#fff"></iframe>
    <button class="btn btn-p" id="mtSave" style="margin-top:10px">บันทึกแบบอีเมล</button></div>`;
}
function wireMailCard() {
  if (!$("#mtKey")) return;
  const prev = () => { $("#mtPrevS").textContent = fill($("#mtSubj").value, SAMPLE, false);
    $("#mtPrev").srcdoc = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0">${fill($("#mtHtml").value, SAMPLE, true)}</body></html>`; };
  prev(); $("#mtSubj").oninput = prev; $("#mtHtml").oninput = prev;
  $("#mtKey").onchange = e => { tplKey = e.target.value; renderSettings(); };
  $("#mtSave").onclick = async () => {
    const bad = [$("#mtTo").value, $("#mtCc").value].join(",").split(/[,;\s]+/).filter(x => x.trim() && !mailList(x));
    if (bad.length) { toast("อีเมลไม่ถูกต้อง: " + bad.join(", "), "err"); return; }
    const upd = { subject: $("#mtSubj").value, html: $("#mtHtml").value, to_extra: mailList($("#mtTo").value) || null, cc: mailList($("#mtCc").value) || null, updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from("mail_templates").update(upd).eq("key", tplKey).select("key");
    if (error || !data?.length) { toast("บันทึกไม่สำเร็จ" + (error ? ": " + error.message : " — บัญชีนี้ไม่มีสิทธิ์แก้แบบอีเมล"), "err"); return; }
    Object.assign(S.tpl.find(x => x.key === tplKey), upd); toast("บันทึกแบบอีเมลแล้ว", "ok");
  };
}

// ---------- Cost Code ของหมวด: เติมจากใบที่เคยออก / นำเข้าจาก Excel → เติมลงช่อง แล้วกด "บันทึกหมวด"
const setCC = (map, src) => {
  let n = 0;
  for (const c of S.cats) { const v = map.get(c.name.trim().toLowerCase()); const inp = document.querySelector(`[data-c="${c.id}"][data-k="cost_code"]`);
    if (v && inp && inp.value.trim() !== v) { inp.value = v; inp.style.background = "#FFF4D1"; n++; } }
  $("#ccOut").innerHTML = n ? `เติมแล้ว ${n} หมวด จาก${esc(src)} (ช่องสีเหลือง) — ตรวจแล้วกด <b>บันทึกหมวด</b>` : `ไม่มีหมวดที่ต้องเติมจาก${esc(src)}`;
};
async function guessCostCodes() {
  $("#ccOut").textContent = "กำลังดูใบที่เคยออก…";
  const lastYear = Math.max(...S.invoices.map(i => i.inv_year || 0));
  const inv = S.invoices.filter(i => i.inv_year === lastYear && i.category);
  const cat = new Map(inv.map(i => [i.id, i.category]));
  const count = new Map();
  for (let k = 0; k < inv.length; k += 300) {
    const { data, error } = await supabase.from("exp_invoice_lines").select("invoice_id,cost_code").in("invoice_id", inv.slice(k, k + 300).map(i => i.id));
    if (error) { $("#ccOut").textContent = "ดึงข้อมูลไม่สำเร็จ: " + error.message; return; }
    for (const l of data) { const c = String(l.cost_code || "").trim(); if (!/^[\w.]{4,}$/.test(c)) continue;
      const key = cat.get(l.invoice_id).trim().toLowerCase(); const m = count.get(key) || new Map(); m.set(c, (m.get(c) || 0) + 1); count.set(key, m); }
  }
  // รหัสที่ใช้บ่อยที่สุดของแต่ละหมวดในปีล่าสุด (รหัสบัญชีเปลี่ยนชุดไปแล้ว — ปีเก่าใช้ชุดเดิม จึงดูแค่ปีล่าสุด)
  setCC(new Map([...count].map(([k, m]) => [k, [...m].sort((a, b) => b[1] - a[1])[0][0]])), `ใบปี ${lastYear}`);
}
async function importCostCodes(file) {
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false });
    const key = (r, ...names) => { const k = Object.keys(r).find(h => names.includes(h.trim().toLowerCase())); return k ? String(r[k]).trim() : ""; };
    const map = new Map(rows.map(r => [key(r, "category", "หมวด").toLowerCase(), key(r, "cost code", "costcode", "cost_code", "รหัสบัญชี")]).filter(([c, v]) => c && v));
    if (!map.size) { $("#ccOut").textContent = "ไม่พบคอลัมน์ Category / Cost Code ในไฟล์"; return; }
    const unknown = [...map.keys()].filter(c => !S.cats.some(x => x.name.trim().toLowerCase() === c));
    setCC(map, "ไฟล์");
    if (unknown.length) $("#ccOut").innerHTML += `<br><span style="color:var(--amber)">ไม่รู้จักหมวด: ${esc(unknown.slice(0, 6).join(", "))}${unknown.length > 6 ? " …" : ""}</span>`;
  } catch (e) { $("#ccOut").textContent = "อ่านไฟล์ไม่สำเร็จ: " + e.message; }
}

function wireSettings() {
  wireMailCard();
  $("#ccGuess")?.addEventListener("click", guessCostCodes);
  $("#ccFile")?.addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) importCostCodes(f); });
  $("#ccTpl")?.addEventListener("click", () => {
    const ws = XLSX.utils.json_to_sheet(S.cats.map(c => ({ "Category": c.name, "Cost Code": c.cost_code || "", "ชื่อไทย (ไม่บังคับ)": c.name_th || "" })));
    ws["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 24 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Cost Code"); XLSX.writeFile(wb, "HR_Spend_cost_codes.xlsx");
  });
  $("#cAdd")?.addEventListener("click", async () => {
    const name = $("#cNew").value.trim(); if (!name) return;
    const { data, error } = await supabase.from("exp_categories").insert({ name, sort_order: 100 }).select().single();
    if (error) { toast(/duplicate/.test(error.message) ? "มีหมวดนี้แล้ว" : "เพิ่มไม่สำเร็จ: " + error.message, "err"); return; }
    S.cats.push(data); renderSettings();
  });
  $("#cSave")?.addEventListener("click", async () => {
    for (const c of S.cats) {
      const g = k => document.querySelector(`[data-c="${c.id}"][data-k="${k}"]`);
      const upd = { name_th: g("name_th").value.trim() || null, cost_code: g("cost_code").value.trim() || null, is_active: g("is_active").checked, updated_at: new Date().toISOString() };
      if (upd.name_th !== (c.name_th || null) || upd.cost_code !== (c.cost_code || null) || upd.is_active !== c.is_active) {
        const { error } = await supabase.from("exp_categories").update(upd).eq("id", c.id);
        if (error) { toast(`บันทึก ${c.name} ไม่สำเร็จ: ${error.message}`, "err"); return; }
        Object.assign(c, upd);
      }
    }
    toast("บันทึกหมวดแล้ว", "ok");
  });
  $("#sgSave").onclick = async () => {
    const file = $("#sgFile").files[0];
    let path = S.me?.signature_path || null;
    if (file) {
      path = `signatures/${S.user.id}/signature.png`;
      const up = await supabase.storage.from("letter-assets").upload(path, file, { upsert: true, contentType: "image/png" });
      if (up.error) { toast("อัปโหลดไม่สำเร็จ: " + up.error.message, "err"); return; }
    }
    if (!path) { toast("เลือกไฟล์ลายเซ็นก่อน", "err"); return; }
    const row = { user_id: S.user.id, set_by: S.user.id, name_en: $("#sgEn").value.trim() || null, name_th: $("#sgTh").value.trim() || null,
                  title_en: $("#sgTitle").value.trim() || null, email: $("#sgMail").value.trim() || null, signature_path: path };
    const { data, error } = await supabase.from("letter_signers").upsert(row).select().single();
    if (error) { toast("บันทึกไม่สำเร็จ: " + error.message, "err"); return; }
    S.me = data; toast("บันทึกลายเซ็นแล้ว", "ok"); renderSettings();
  };
  $("#imFile")?.addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) importExcel(f); });
}

async function importExcel(file) {
  const out = $("#imOut"); out.innerHTML = `<div class="hint">กำลังอ่านไฟล์…</div>`;
  let parsed;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const sheet = n => wb.Sheets[wb.SheetNames.find(s => s.trim().toLowerCase() === n)];
    if (!sheet("vendor") || !sheet("data")) { out.innerHTML = `<div class="note r">ไม่พบชีต Vendor หรือ Data ในไฟล์นี้</div>`; return; }
    const rows = n => XLSX.utils.sheet_to_json(sheet(n), { header: 1, raw: true, defval: null });
    parsed = parseInvoiceDb(rows("vendor"), rows("data"));
  } catch (err) { out.innerHTML = `<div class="note r">อ่านไฟล์ไม่สำเร็จ: ${esc(err.message)}</div>`; return; }
  const have = new Set(S.invoices.map(i => i.inv_no)), fresh = parsed.invoices.filter(i => !have.has(i.inv_no));
  out.innerHTML = `<div class="note">พบผู้ขาย ${parsed.vendors.length} ราย · หมวด ${parsed.categories.length} · ใบแจ้งหนี้ ${parsed.invoices.length.toLocaleString()} ใบ
      (${parsed.invoices.reduce((s, i) => s + i.lines.length, 0).toLocaleString()} บรรทัด) · <b>ใหม่ ${fresh.length.toLocaleString()} ใบ</b></div>
    ${parsed.warn.map(w => `<div class="hint" style="color:var(--amber);margin-top:6px">⚠ ${esc(w)}</div>`).join("")}
    <button class="btn btn-p" id="imGo" style="margin-top:10px" ${fresh.length || parsed.vendors.length ? "" : "disabled"}>นำเข้า</button>`;
  $("#imGo").onclick = async e => {
    e.target.disabled = true;
    const say = t => { e.target.textContent = t; };
    say("กำลังนำเข้าผู้ขาย…");
    // ผู้ขาย: เพิ่มใหม่ + อัปเดตชื่อ/ที่อยู่/บัญชีของที่มีอยู่ (รหัสผู้ขายเป็นตัวจับคู่)
    for (let k = 0; k < parsed.vendors.length; k += 500) {
      const { error } = await supabase.from("exp_vendors").upsert(parsed.vendors.slice(k, k + 500), { onConflict: "code" });
      if (error) { toast("นำเข้าผู้ขายไม่สำเร็จ: " + error.message, "err"); e.target.disabled = false; return; }
    }
    const missing = [...new Set(fresh.map(i => i.vendor_code).filter(c => c && !parsed.vendors.some(v => v.code === c)))];
    if (missing.length) await supabase.from("exp_vendors").upsert(missing.map(code => ({ code, name: code + " (ไม่มีในชีต Vendor)" })), { onConflict: "code", ignoreDuplicates: true });
    const catsHave = new Set(S.cats.map(c => c.name));
    const newCats = parsed.categories.filter(c => !catsHave.has(c)).map((name, i) => ({ name, sort_order: 100 + i }));
    if (newCats.length) { const { error } = await supabase.from("exp_categories").insert(newCats); if (error) { toast("นำเข้าหมวดไม่สำเร็จ: " + error.message, "err"); e.target.disabled = false; return; } }
    let done = 0;
    for (let k = 0; k < fresh.length; k += 150) {
      say(`กำลังนำเข้าใบแจ้งหนี้ ${Math.min(k + 150, fresh.length).toLocaleString()} / ${fresh.length.toLocaleString()}…`);
      const { data, error } = await supabase.rpc("exp_import", { p_rows: fresh.slice(k, k + 150) });
      if (error) { toast(`หยุดที่ใบที่ ${k + 1}: ${error.message} — นำเข้าซ้ำได้ ระบบข้ามใบที่มีแล้ว`, "err"); break; }
      done += data;
    }
    await loadAll();
    toast(`นำเข้าแล้ว ${done.toLocaleString()} ใบ`, "ok"); renderSettings();
  };
}

boot();
