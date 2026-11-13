// ===== Akara Tax (/tax) — ทะเบียนรายได้และภาษีพนักงาน · กระทบยอด ภ.ง.ด.1/1ก · 50 ทวิ ปีละใบ =====
// user 2026-11-13 · ห้าม import js/app.js · กติกา js/tax-calc.js (มีเทส) · ข้อมูล azure-app/tax.py ผ่าน supabase.rpc("tax_…")
// ไฟล์เงินเดือน / ภ.ง.ด. อ่านในเบราว์เซอร์ ส่งขึ้นเฉพาะยอดที่ต้องเก็บ · ยอดรายคน = เงินเดือน → ต้องมี field.salary.read
import { supabase } from "../js/supabase-config.js";
import * as T from "../js/tax-calc.js";
import { cert50Page, cert50Doc, printHTML } from "./doc.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const EN_M = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const ymTH = ym => ym ? `${TH_M[+ym.slice(5, 7) - 1]} ${+ym.slice(0, 4) + 543}` : "-";
const dTH = d => d ? `${+d.slice(8, 10)} ${TH_M[+d.slice(5, 7) - 1]} ${+d.slice(0, 4) + 543}` : "-";
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const baht = n => n == null ? "-" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const bahtK = n => n == null ? "-" : n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(Math.round(n));
const ini = n => String(n || "?").trim().split(/\s+/).slice(0, 2).map(w => w.replace(/^[เแโใไ]/, "")[0] || "").join("") || "?";
const ST = { draft: ["ร่าง", "chip-gray"], pending: ["รอลงนาม", "chip-gold"], signed: ["ลงนามแล้ว", "chip-em"], void: ["ยกเลิก", "chip-red"] };
const I = {
  file: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M12 12v6M9 15l3 3 3-3"/></svg>',
  dl: '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.3 2.3 4.7-4.8"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',
  coin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M9.5 10c0-1 1.1-1.7 2.5-1.7s2.5.7 2.5 1.7-1.1 1.4-2.5 1.8-2.5.8-2.5 1.8 1.1 1.7 2.5 1.7 2.5-.7 2.5-1.7"/></svg>',
  user: '<svg viewBox="0 0 24 24"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2.5"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
  pen: '<svg viewBox="0 0 24 24"><path d="M3 17c3-3 4.5-9 7-9 2.5 0 .5 7 3 7 1.5 0 2.2-2 3.5-2S18 15 21 15"/><path d="M3 21h18"/></svg>',
  print: '<svg viewBox="0 0 24 24"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>',
  xl: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="m8 8 8 8M16 8l-8 8"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
};

const S = { user: null, perms: new Set(), D: null, year: +today().slice(0, 4), rows: [], pnd: [], emps: [], E: new Map(), P: new Map(), tot: new Map(),
            q: "", fPeople: "", fCert: "todo", sel: new Set(), imp: [], pimp: [], open: null };
const can = p => S.perms.has(p);

function toast(msg, type = "") {
  const t = document.createElement("div"); t.className = "toast " + (type === "error" ? "err" : type === "success" ? "ok" : ""); t.textContent = msg;
  $("#fxToasts").appendChild(t); setTimeout(() => t.remove(), type === "error" ? 7000 : 3500);
}
const rpc = async (name, args) => { const { data, error } = await supabase.rpc(name, args); if (error) throw new Error(error.message); return data; };
const nameOf = code => { const p = S.P.get(code), e = S.E.get(code);
  return (p?.first_th ? `${p.title || ""}${p.first_th} ${p.last_th || ""}` : [e?.firstname_th, e?.lastname_th].filter(Boolean).join(" ")) || S.rows.find(r => r.emp_code === code)?.name || code; };
const who = (code, sub) => { const n = nameOf(code), e = S.E.get(code);
  return `<div class="who"><div class="a">${esc(ini(n.replace(/^(นาย|นางสาว|นาง)/, "")))}</div><div><b>${esc(n)}</b><span>${esc(code)}${sub ?? (e?.department ? " · " + esc(e.department) : "")}</span></div></div>`; };
const head = (eyebrow, title, sub, actions = "") => `<div class="fx-head"><div><div class="fx-eyebrow">${eyebrow}</div><div class="fx-title">${title}</div>
  <div class="fx-sub">${sub}</div></div><div class="fx-actions">${actions}</div></div>`;
const render = html => { $("#fxMain").innerHTML = html; wire($("#fxMain")); };
const cert = code => (S.D.certs || []).find(c => c.emp_code === code);
const certChip = c => c ? `<span class="chip ${ST[c.status][1]}">${ST[c.status][0]}${c.no ? " #" + c.no : ""}</span>${c.status === "signed" && T.certStale(c, S.tot.get(c.emp_code)) ? ` <span class="chip chip-red">ยอดเปลี่ยน</span>` : ""}` : `<span class="chip chip-gray">ยังไม่เตรียม</span>`;

// ---------------------------------------------------------------- เริ่มต้น
async function fetchAll(q) {
  const out = [];
  for (let from = 0; ; from += 1000) { const { data, error } = await q().range(from, from + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break; }
  return out;
}
async function loadYear() {
  S.D = await rpc("tax_data", { p_year: S.year });
  S.P = new Map((S.D.people || []).map(p => [p.emp_code, p]));
  if (S.D.can_money) {
    const [rows, pnd] = await Promise.all([rpc("tax_year", { p_year: S.year }), rpc("tax_pnd_rows", { p_year: S.year })]);
    S.rows = rows || []; S.pnd = pnd || [];
  } else { S.rows = []; S.pnd = []; }
  S.tot = T.yearTotals(S.rows);
}
async function boot() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { $("#fxMain").innerHTML = `<div class="card card-b" style="max-width:460px;margin:60px auto;text-align:center"><div class="card-t" style="justify-content:center">กรุณาเข้าสู่ระบบ</div>
      <p class="muted">ใช้บัญชีเดียวกับระบบ HR</p><a class="btn btn-p" href="/">ไปหน้าเข้าสู่ระบบ HR</a></div>`; return; }
  S.user = session.user;
  const { data: perms } = await supabase.rpc("my_permissions");
  S.perms = new Set((perms || []).map(p => typeof p === "string" ? p : p.perm_key || p.key));
  const name = S.user.user_metadata?.full_name || S.user.email || "";
  $("#fxUser").innerHTML = `<div class="av">${esc(ini(name).toUpperCase())}</div><div><b>${esc(name)}</b><span>${can("data.tax.write") ? "จัดการทะเบียนภาษี" : can("data.tax.sign") ? "ผู้ลงนาม" : "ดูอย่างเดียว"}</span></div>`;
  if (!can("page.tax") && !can("data.tax.sign")) { $("#fxMain").innerHTML = `<div class="empty">บัญชีนี้ยังไม่มีสิทธิ์ใช้ Akara Tax — ให้ Admin เพิ่มสิทธิ์ “ทะเบียนรายได้และภาษี” ที่ User Management</div>`; return; }
  try {
    const [, emps] = await Promise.all([loadYear(), can("page.tax") ? fetchAll(() => supabase.from("employees")
      .select("emp_code,firstname_th,lastname_th,department,section,position,join_date,end_date,status,contract_type").order("emp_code")) : Promise.resolve([])]);
    S.emps = emps.map(e => ({ ...e, emp_code: String(e.emp_code).toUpperCase() })); S.E = new Map(S.emps.map(e => [e.emp_code, e]));
  } catch (e) { $("#fxMain").innerHTML = `<div class="card card-b"><b>โหลดข้อมูลไม่สำเร็จ</b><p class="muted">${esc(e.message)}</p></div>`; return; }
  const ys = [...new Set([S.year, +today().slice(0, 4), ...(S.D.years || []).map(Number)])].sort((a, b) => b - a);
  $("#txYear").innerHTML = ys.map(y => `<option value="${y}" ${y === S.year ? "selected" : ""}>${y + 543}</option>`).join("");
  $("#txYear").onchange = async e => { S.year = +e.target.value; S.sel.clear(); S.imp = []; S.pimp = []; await loadYear(); route(); };
  if (!S.D.page) document.querySelectorAll("#fxNav a.hr").forEach(a => { a.style.display = "none"; });
  if (!S.D.can_sign) $("#navSign").style.display = "none";
  window.addEventListener("hashchange", () => { S.sel.clear(); route(); });
  route();
}
function route() {
  const r = location.hash.replace(/^#\/?/, "").split("/")[0] || (S.D.page ? "overview" : "sign");
  document.querySelectorAll("#fxNav a[data-r]").forEach(a => a.classList.toggle("on", a.dataset.r === r));
  badge();
  if (S.D.page && !S.D.can_money && !["sign", "log"].includes(r)) { render(head("Akara Tax", "ต้องมีสิทธิ์เห็นเงินเดือนรายคน", "ทะเบียนนี้เป็นยอดเงินได้รายคน — ให้ Admin เพิ่มสิทธิ์ “ดูเงินเดือน” (field.salary.read)")); return; }
  ({ overview, people, months, pnd: pndPage, certs: certsPage, sign: signPage, log: logPage }[r] || overview)();
  window.scrollTo(0, 0);
}
function badge() {
  const mine = (S.D.certs || []).filter(c => c.status === "pending" && String(c.signer_id) === String(S.D.me)).length;
  $("#navSignN").textContent = mine ? String(mine) : "";
  if (S.D.page && S.D.can_money) { const a = alertData(); $("#navAl").textContent = a.count ? String(a.count) : ""; $("#navPnd").textContent = a.pndBad ? String(a.pndBad) : ""; }
}

// ---------------------------------------------------------------- ตัวเลขที่ใช้หลายหน้า
function recon() {
  const byYM = {}, pByK = {};
  for (const r of S.rows) (byYM[r.ym] ||= []).push(r);
  for (const p of S.pnd) (pByK[p.k] ||= []).push({ ...p, first: p.first_th, last: p.last_th });
  const out = {};
  for (const f of S.D.pnd || []) if (!f.k.endsWith("1K")) out[f.k] = T.reconcileMonth(byYM[f.k] || [], pByK[f.k] || []);
  return { out, byYM, pByK };
}
function alertData() {
  const yr = String(S.year), certs = S.D.certs || [];
  const leavers = T.leaverAlerts(S.emps.filter(e => S.tot.has(e.emp_code)), certs, S.year, today());
  const noId = [...S.tot.keys()].filter(c => { const p = S.P.get(c); return !p?.tax_id || (S.D.can_write && !T.validTaxId(p.tax_id)); });
  const R = recon().out, pndBad = Object.values(R).reduce((s, x) => s + x.issues.length, 0);
  const stale = certs.filter(c => c.status === "signed" && T.certStale(c, S.tot.get(c.emp_code)));
  const months = (S.D.months || []).map(m => m.ym), last = yr === today().slice(0, 4) ? +today().slice(5, 7) - 1 : 12;
  const missing = Array.from({ length: last }, (_, i) => `${yr}-${String(i + 1).padStart(2, "0")}`).filter(m => !months.includes(m));
  return { leavers, noId, pndBad, stale, missing, R, count: leavers.length + stale.length + (pndBad ? 1 : 0) };
}

// ---------------------------------------------------------------- ภาพรวม
function overview() {
  const A = alertData(), yr = S.year, all = [...S.tot.values()], certs = S.D.certs || [];
  const inc = T.sumBy(all, T.income), tax = T.sumBy(all, T.taxAll), sso = T.sumBy(all, "sso"), pvd = T.sumBy(all, "pvd");
  const kpi = (href, ico, cls, l, v, d) => `<a class="kpi" href="${href}"><div class="ico ${cls}">${ico}</div><div><div class="kpi-l">${l}</div><div class="kpi-v">${v}</div><div class="kpi-d">${d}</div></div></a>`;
  const M = new Map((S.D.months || []).map(m => [m.ym, m])), F = new Map((S.D.pnd || []).map(f => [f.k, f]));
  const cells = Array.from({ length: 12 }, (_, i) => {
    const ym = `${yr}-${String(i + 1).padStart(2, "0")}`, m = M.get(ym), f = F.get(ym), rc = A.R[ym], fut = ym > today().slice(0, 7);
    const st = !f ? `<span class="dot wait" title="ยังไม่มี ภ.ง.ด.1"></span>` : rc && !rc.issues.length ? `<span class="dot ok" title="ตรงกับ ภ.ง.ด.1"></span>` : `<span class="dot bad" title="ไม่ตรง ภ.ง.ด.1"></span>`;
    return `<a class="mcell ${m ? "" : "none"} ${fut ? "future" : ""}" href="${m ? "#/pnd" : "#/months"}" style="text-decoration:none;color:inherit"><div class="m">${TH_M[i]} ${st}</div>
      ${m ? `<div class="v">${m.people} คน<br>฿${bahtK(m.income)}<br>ภาษี ฿${bahtK(m.tax)}</div>` : `<div class="v">${fut ? "" : "ยังไม่นำเข้า"}</div>`}
      ${m && f && rc ? `<div class="v">${rc.issues.length ? `<b class="neg">ไม่ตรง ${rc.issues.length}</b>` : `<span class="diff-ok">ตรง ภ.ง.ด.1</span>`}</div>` : ""}</a>`;
  }).join("");
  const cnt = s => certs.filter(c => c.status === s).length;
  const item = (cls, txt, href) => `<a class="al ${cls}" href="${href}" style="display:flex;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line-2);color:inherit;text-decoration:none"><span class="ico ${cls === "red" ? "ico-red" : "ico-gold"}" style="width:30px;height:30px;border-radius:9px">${I.warn}</span><div>${txt}</div></a>`;
  const alerts = [
    A.leavers.length && item(A.leavers.some(x => x.overdue) ? "red" : "", `<b>ลาออกในปีนี้ ยังไม่ได้ 50 ทวิ ${A.leavers.length} คน</b><div class="small muted">ต้องออกให้ภายใน 1 เดือนนับจากวันออกจากงาน${A.leavers.some(x => x.overdue) ? ` · เกินกำหนดแล้ว ${A.leavers.filter(x => x.overdue).length} คน` : ""}</div>`, "#/certs/leavers"),
    A.missing.length && item("", `<b>ยังไม่นำเข้าเงินเดือน ${A.missing.length} เดือน</b><div class="small muted">${A.missing.map(ymTH).join(", ")}</div>`, "#/months"),
    A.pndBad && item("red", `<b>ยอดไม่ตรงกับ ภ.ง.ด.1 ${A.pndBad} รายการ</b><div class="small muted">ดูรายคนที่หน้ากระทบยอด</div>`, "#/pnd"),
    A.noId.length && item("", `<b>ไม่มี/เลขผู้เสียภาษีไม่ถูกต้อง ${A.noId.length} คน</b><div class="small muted">อัปไฟล์ ภ.ง.ด.1 ระบบเติมให้เอง หรือแก้ในแผงรายคน</div>`, "#/people/noid"),
    A.stale.length && item("red", `<b>ลงนามแล้วแต่ยอดเปลี่ยน ${A.stale.length} ใบ</b><div class="small muted">ยกเลิกแล้วออกใหม่</div>`, "#/certs/stale"),
  ].filter(Boolean).join("");
  render(`${head(`ทะเบียนรายได้และภาษี · ปีภาษี ${yr + 543}`, "รายได้ ภาษี และ 50 ทวิ ครบในที่เดียว", `ข้อมูล ณ ${dTH(today())} · นำเข้าแล้ว ${M.size} เดือน · ภ.ง.ด.1 ${[...F.keys()].filter(k => !k.endsWith("1K")).length} เดือน`,
      S.D.can_write ? `<a class="btn btn-g" href="#/months">${I.file}นำเข้าเงินเดือน</a>` : "")}
  <div class="hero">
    <div class="hero-top"><div><div class="hero-l">เงินได้พึงประเมินรวมทั้งปี (ถึงเดือนที่นำเข้า)</div><div class="hero-v">฿${bahtK(inc)}</div>
      <div class="hero-l">${S.tot.size.toLocaleString()} คนที่มีเงินได้ในปี ${yr + 543}</div></div>
      <div><span class="hero-badge">${I.check}50 ทวิ ลงนามแล้ว ${cnt("signed")} / ${S.tot.size}</span></div></div>
    <div class="hero-split">
      <div class="hero-tile"><div class="l">ภาษีหัก ณ ที่จ่าย</div><div class="v gold">฿${bahtK(tax)}</div></div>
      <div class="hero-tile"><div class="l">ประกันสังคม (ส่วนพนักงาน)</div><div class="v">฿${bahtK(sso)}</div></div>
      <div class="hero-tile"><div class="l">กองทุนสำรองเลี้ยงชีพ (ส่วนพนักงาน)</div><div class="v em">฿${bahtK(pvd)}</div></div>
    </div></div>
  <div class="kpis">
    ${kpi("#/months", I.cal, "ico-blue", "เดือนที่นำเข้า", `${M.size} / 12`, A.missing.length ? `ขาด ${A.missing.length} เดือน` : "ครบถึงปัจจุบัน")}
    ${kpi("#/pnd", A.pndBad ? I.warn : I.check, A.pndBad ? "ico-red" : "ico-em", "กระทบยอด ภ.ง.ด.1", A.pndBad ? `ไม่ตรง ${A.pndBad}` : "ตรงทุกเดือน", `${Object.keys(A.R).length} เดือนที่มีไฟล์`)}
    ${kpi("#/certs", I.pen, "ico-gold", "50 ทวิ", `${cnt("signed")} ใบ`, `ร่าง ${cnt("draft")} · รอลงนาม ${cnt("pending")}`)}
    ${kpi("#/people/noid", I.user, A.noId.length ? "ico-red" : "ico-em", "ข้อมูลผู้เสียภาษี", A.noId.length ? `ขาด ${A.noId.length}` : "ครบ", "เลข 13 หลัก + ที่อยู่")}
  </div>
  <div class="two">
    <div class="card"><div class="card-h"><div><div class="card-t">12 เดือนของปี ${yr + 543}</div><div class="card-s">จุดเขียว = ตรงกับ ภ.ง.ด.1 ที่ยื่น · แดง = ไม่ตรง · เทา = ยังไม่อัป ภ.ง.ด.1</div></div></div>
      <div class="card-b"><div class="mgrid">${cells}</div></div></div>
    <div class="card"><div class="card-h"><div class="card-t">ต้องจัดการ</div></div>${alerts || `<div class="ok-line">${I.check}ไม่มีเรื่องค้าง</div>`}</div>
  </div>`);
}

// ---------------------------------------------------------------- รายได้รายคน
function people() {
  const sub = location.hash.split("/")[2]; if (sub && !S.fPeople) S.fPeople = sub;
  const q = S.q.trim().toLowerCase(), yr = String(S.year);
  const F = {
    "": ["ทุกคน", () => true],
    noid: ["ไม่มี/เลขผิด", c => { const p = S.P.get(c); return !p?.tax_id || (S.D.can_write && !T.validTaxId(p.tax_id)); }],
    left: ["ลาออกในปี", c => (S.E.get(c)?.end_date || "").slice(0, 4) === yr],
    sev: ["มีเงินชดเชย", c => S.tot.get(c).sev > 0],
    noemp: ["ไม่อยู่ในทะเบียนพนักงาน", c => !S.E.has(c)],
  };
  const list = [...S.tot.keys()].filter(c => (F[S.fPeople] || F[""])[1](c))
    .filter(c => !q || [c, nameOf(c), S.E.get(c)?.department, S.P.get(c)?.tax_id].join(" ").toLowerCase().includes(q)).sort();
  render(`${head(`ปีภาษี ${S.year + 543}`, "รายได้รายคน", `${S.tot.size} คน · รวมทุกเดือนที่นำเข้า · กดแถวเพื่อดูรายเดือน แก้ข้อมูลผู้เสียภาษี และออก 50 ทวิ`,
      `<button class="btn" id="btnXl">${I.dl}Excel ทะเบียนทั้งปี</button>`)}
  <div class="card"><div class="card-h">
    <div class="seg" id="segP">${Object.entries(F).map(([k, [t, f]]) => `<button data-s="${k}" class="${S.fPeople === k ? "on" : ""}">${t} ${[...S.tot.keys()].filter(f).length}</button>`).join("")}</div>
    <div class="search">${I.search}<input class="inp" id="q" placeholder="ค้นหา ชื่อ / รหัส / แผนก / เลขผู้เสียภาษี" value="${esc(S.q)}"></div></div>
    <div class="tbl-wrap" style="max-height:calc(100vh - 290px)"><table class="tbl"><thead><tr><th>พนักงาน</th><th>เลขผู้เสียภาษี</th><th class="r">เดือน</th><th class="r">เงินได้</th><th class="r">ภาษี</th><th class="r">ประกันสังคม</th><th class="r">PVD</th><th>50 ทวิ</th></tr></thead><tbody>
    ${list.map(c => { const t = S.tot.get(c), p = S.P.get(c), e = S.E.get(c);
      return `<tr class="click" data-open="${esc(c)}"><td>${who(c, e?.end_date && e.end_date.slice(0, 4) === yr ? ` · ออก ${dTH(e.end_date.slice(0, 10))}` : undefined)}</td>
        <td class="num small">${p?.tax_id ? (S.D.can_write && !T.validTaxId(p.tax_id) ? `<span class="chip chip-red">${esc(p.tax_id)}</span>` : esc(p.tax_id)) : `<span class="chip chip-red">ไม่มี</span>`}</td>
        <td class="r">${t.months.length}</td><td class="r money">${baht(T.income(t))}${t.sev ? `<div class="small muted">ชดเชย ${baht(t.sev)}</div>` : ""}</td><td class="r money">${baht(T.taxAll(t))}</td>
        <td class="r money">${baht(t.sso)}</td><td class="r money">${baht(t.pvd)}</td><td>${certChip(cert(c))}</td></tr>`; }).join("") || `<tr><td colspan="8" class="empty">ไม่พบ</td></tr>`}
    </tbody></table></div></div>`);
  document.querySelectorAll("#segP button").forEach(b => b.onclick = () => { S.fPeople = b.dataset.s; history.replaceState(null, "", "#/people"); people(); });
  const qi = $("#q"); qi.oninput = () => { S.q = qi.value; const p = qi.selectionStart; people(); const n = $("#q"); n.focus(); n.setSelectionRange(p, p); };
  $("#btnXl").onclick = exportYear;
}
function exportYear() {
  const months = Array.from({ length: 12 }, (_, i) => `${S.year}-${String(i + 1).padStart(2, "0")}`);
  const by = new Map(); for (const r of S.rows) by.set(r.emp_code + r.ym, r);
  const rows = [...S.tot.keys()].sort().map(c => { const t = S.tot.get(c), p = S.P.get(c) || {}, e = S.E.get(c) || {};
    const o = { "รหัสพนักงาน": c, "ชื่อ": nameOf(c), "เลขผู้เสียภาษี": p.tax_id || "", "ที่อยู่": [p.address, p.zip].filter(Boolean).join(" "), "Department": e.department || "", "วันที่ออก": (e.end_date || "").slice(0, 10) };
    for (const m of months) { const r = by.get(c + m); o[`เงินได้ ${m.slice(5)}`] = r ? T.income(r) : ""; o[`ภาษี ${m.slice(5)}`] = r ? T.taxAll(r) : ""; }
    Object.assign(o, { "40(1) ทั้งปี": t.inc401, "40(2) ทั้งปี": t.inc402, "เงินชดเชย": t.sev, "ภาษี": t.tax, "ภาษีเงินชดเชย": t.sev_tax, "ประกันสังคม": t.sso, "PVD": t.pvd,
      "50 ทวิ": cert(c) ? `${ST[cert(c).status][0]}${cert(c).no ? " #" + cert(c).no : ""}` : "" });
    return o; });
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), `Tax ${S.year}`);
  XLSX.writeFile(wb, `ทะเบียนรายได้และภาษี ${S.year} (${today()}).xlsx`);
}

// ---------------------------------------------------------------- แผงรายคน
async function drawer(code) {
  S.open = code;
  const e = S.E.get(code), p = S.P.get(code) || {}, t = S.tot.get(code) || T.yearTotals([]).get("x") || { inc401: 0, inc402: 0, sev: 0, tax: 0, sev_tax: 0, sso: 0, pvd: 0, months: [] };
  const c = cert(code), w = S.D.can_write, yr = S.year;
  const mine = S.rows.filter(r => r.emp_code === code), pn = S.pnd.filter(x => x.emp_code === code && !x.k.endsWith("1K"));
  const pBy = {}; for (const x of pn) { const o = pBy[x.k] ||= { income: 0, tax: 0 }; o.income += +x.income; o.tax += +x.tax; }
  const chk = T.certChecks(p, t, e);
  const f = (k, label, extra = "") => `<label class="fld"><span>${label}</span><input class="inp" data-p="${k}" ${w ? "" : "disabled"} ${extra} value="${esc(p[k] || "")}"></label>`;
  const months = Array.from({ length: 12 }, (_, i) => `${yr}-${String(i + 1).padStart(2, "0")}`).filter(m => mine.some(r => r.ym === m) || pBy[m]);
  $("#fxDrawer").innerHTML = `<div class="dr-bg" data-x></div><div class="dr">
    <div class="dr-h"><button class="x" data-x>×</button><div class="t">${esc(nameOf(code))}</div>
      <div class="s">${esc(code)}${e ? ` · ${esc(e.department || "")} · ${esc(e.position || "")}` : " · ไม่อยู่ในทะเบียนพนักงาน"}${e?.end_date ? ` · ออกจากงาน ${dTH(e.end_date.slice(0, 10))}` : ""}</div>
      <div class="dr-stats"><div><span>เงินได้ทั้งปี</span><b>${baht(T.income(t))}</b></div><div><span>ภาษี</span><b>${baht(T.taxAll(t))}</b></div>
        <div><span>ประกันสังคม</span><b>${baht(t.sso)}</b></div><div><span>PVD</span><b>${baht(t.pvd)}</b></div></div></div>
    <div class="dr-b">
      <div class="card"><div class="card-h"><div><div class="card-t">50 ทวิ ปี ${yr + 543}</div><div class="card-s">${c ? `${certChip(c)} ${c.issue_date ? "· ลงวันที่ " + dTH(c.issue_date) : ""}${c.reason ? ` · ${esc(c.reason)}` : ""}` : "ยังไม่เตรียม"}</div></div>
        <div class="fx-actions">${c ? `<button class="btn btn-sm" data-print="${esc(code)}">${I.print}ดู / พิมพ์</button>` : ""}
          ${w && (!c || c.status === "draft" || c.status === "void") ? `<button class="btn btn-sm btn-p" data-prep="${esc(code)}">${c ? "อัปเดตร่างตามยอดล่าสุด" : "เตรียม 50 ทวิ"}</button>` : ""}
          ${w && c && (c.status === "signed" || c.status === "pending") ? `<button class="btn btn-sm" data-void="${esc(code)}">ยกเลิกใบนี้</button>` : ""}</div></div>
        ${chk.length ? `<div class="card-b small">${chk.map(x => `<div class="${x.level === "warn" ? "neg" : "muted"}">• ${esc(x.text)}</div>`).join("")}</div>` : ""}</div>
      <div class="card mt"><div class="card-h"><div class="card-t">ข้อมูลผู้เสียภาษี</div><div class="card-s">${p.source === "pnd" ? "จากไฟล์ ภ.ง.ด.1" : p.source === "manual" ? `HR แก้เอง${p.updated_by_name ? " · " + esc(p.updated_by_name) : ""}` : p.source === "payroll" ? "ชื่อจากไฟล์เงินเดือน" : ""}</div></div>
        <div class="card-b"><div class="grid-f">${f("tax_id", "เลขประจำตัวผู้เสียภาษี (13 หลัก)", `maxlength="13"`)}${f("title", "คำนำหน้า")}${f("first_th", "ชื่อ")}${f("last_th", "นามสกุล")}</div>
          <div class="grid-f" style="grid-template-columns:3fr 1fr;margin-top:12px">${f("address", "ที่อยู่")}${f("zip", "รหัสไปรษณีย์", `maxlength="5"`)}</div>
          ${w ? `<div style="margin-top:12px;text-align:right"><button class="btn btn-p btn-sm" id="pSave">${I.save}บันทึกข้อมูลผู้เสียภาษี</button></div>` : ""}</div></div>
      <div class="card mt"><div class="card-h"><div class="card-t">รายเดือน</div><div class="card-s">ภ.ง.ด.1 = ยอดในไฟล์ที่ยื่น (ถ้าอัปแล้ว)</div></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>เดือน</th><th class="r">เงินได้</th><th class="r">ภาษี</th><th class="r">ปกส.</th><th class="r">PVD</th><th class="r">ภ.ง.ด.1</th>${w ? "<th></th>" : ""}</tr></thead><tbody>
        ${months.map(m => { const r = mine.find(x => x.ym === m), pp = pBy[m], bad = pp && r && (Math.abs(pp.income - T.income(r)) >= .01 || Math.abs(pp.tax - T.taxAll(r)) >= .01) || (pp && !r) || (!pp && r && S.D.pnd.some(f => f.k === m));
          return `<tr><td><b>${ymTH(m)}</b>${r?.edited_note ? `<div class="small muted">แก้มือ: ${esc(r.edited_note)}</div>` : ""}</td>
            <td class="r money">${r ? baht(T.income(r)) : "-"}${r && (r.sev || r.inc402) ? `<div class="small muted">${r.sev ? "ชดเชย " + baht(r.sev) : ""}${r.inc402 ? " 40(2) " + baht(r.inc402) : ""}</div>` : ""}</td>
            <td class="r money">${r ? baht(T.taxAll(r)) : "-"}</td><td class="r money">${r ? baht(r.sso) : "-"}</td><td class="r money">${r ? baht(r.pvd) : "-"}</td>
            <td class="r money ${bad ? "neg" : ""}">${pp ? `${baht(pp.income)}<div class="small">${baht(pp.tax)}</div>` : S.D.pnd.some(f => f.k === m) ? "ไม่มีในไฟล์" : "<span class='muted'>—</span>"}</td>
            ${w ? `<td><button class="btn btn-sm" data-edit="${m}">แก้</button></td>` : ""}</tr>`; }).join("") || `<tr><td colspan="7" class="empty">ไม่มียอดในปีนี้</td></tr>`}
        </tbody></table></div>
        ${w ? `<div class="card-b small"><a href="#" id="addMonth">+ เพิ่มยอดเดือนที่ไม่มีในไฟล์</a></div>` : ""}</div>
      <div id="drLog"></div>
    </div></div>`;
  const D = $("#fxDrawer");
  D.querySelectorAll("[data-x]").forEach(x => x.onclick = () => { D.innerHTML = ""; S.open = null; });
  wire(D);
  $("#pSave") && ($("#pSave").onclick = async () => {
    const row = {}; D.querySelectorAll("[data-p]").forEach(i => { row[i.dataset.p] = i.value.trim(); });
    try { await rpc("tax_person_save", { p_emp_code: code, p_row: row }); }
    catch (err) {
      if (!/เลขตรวจสอบ/.test(err.message) || !confirm(err.message + "\n\nบันทึกตามนี้ไหม (เลขในบัตรจริงอาจต่างจากสูตร)")) { toast(err.message, "error"); return; }
      try { await rpc("tax_person_save", { p_emp_code: code, p_row: { ...row, force: true } }); } catch (e2) { toast(e2.message, "error"); return; }
    }
    toast("บันทึกแล้ว", "success"); await loadYear(); drawer(code); badge();
  });
  D.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => editMonth(code, b.dataset.edit));
  $("#addMonth") && ($("#addMonth").onclick = ev => { ev.preventDefault(); const m = prompt("เดือน (YYYY-MM)", `${yr}-01`); if (m && /^\d{4}-\d{2}$/.test(m)) editMonth(code, m); });
  const { data: log } = await supabase.rpc("tax_log", { p_emp_code: code });
  if (S.open === code && log?.length) $("#drLog").innerHTML = `<div class="card mt"><div class="card-h"><div class="card-t">ประวัติ</div></div><div class="card-b" style="padding-top:4px">${log.map(x => `<div class="log-i"><span class="d"></span><div><div class="small muted">${dTH(x.at.slice(0, 10))} ${x.at.slice(11, 16)} · ${esc(x.by_name || "")}</div>${esc(x.detail || x.action)}</div></div>`).join("")}</div></div>`;
}
function modal(title, body, okText, onOk) {
  const m = document.createElement("div"); m.className = "modal-bg";
  m.innerHTML = `<div class="modal"><div class="mh">${title}</div><div class="mb">${body}</div><div class="mf"><button class="btn" data-c>ยกเลิก</button><button class="btn btn-p" data-ok>${okText}</button></div></div>`;
  document.body.appendChild(m);
  m.querySelector("[data-c]").onclick = () => m.remove();
  m.querySelector("[data-ok]").onclick = async () => { const b = m.querySelector("[data-ok]"); b.disabled = true; try { if (await onOk(m) !== false) m.remove(); } finally { b.disabled = false; } };
  return m;
}
function editMonth(code, ym) {
  const r = S.rows.find(x => x.emp_code === code && x.ym === ym) || {};
  modal(`แก้ยอด ${esc(nameOf(code))} · ${ymTH(ym)}`, `<div class="grid-f">${T.FIELDS.map(f => `<label class="fld"><span>${T.FIELD_TH[f]}</span><input class="inp" type="number" step="0.01" data-m="${f}" value="${r[f] ?? 0}"></label>`).join("")}</div>
    <label class="fld"><span>เหตุผล (ต้องมี)</span><input class="inp" data-m="why" placeholder="เช่น TigerSoft คำนวณภาษีใหม่ / จ่ายย้อนหลัง"></label>`, "บันทึก", async m => {
    const row = {}; m.querySelectorAll("[data-m]").forEach(i => { row[i.dataset.m] = i.value; });
    if (!row.why.trim()) { toast("ใส่เหตุผล", "error"); return false; }
    try { await rpc("tax_income_edit", { p_ym: ym, p_emp_code: code, p_row: row, p_reason: row.why }); } catch (e) { toast(e.message, "error"); return false; }
    toast("บันทึกแล้ว", "success"); await loadYear(); drawer(code); badge();
  });
}

// ---------------------------------------------------------------- นำเข้าเงินเดือน
const guessYM = name => {
  const s = name.toLowerCase(), a = s.match(/(20\d\d)[-_.](0[1-9]|1[0-2])/); if (a) return `${a[1]}-${a[2]}`;
  const i = EN_M.findIndex(m => s.includes(m) || s.includes(m.slice(0, 3) + " ")), y = s.match(/20\d\d/);
  return i >= 0 && y ? `${y[0]}-${String(i + 1).padStart(2, "0")}` : "";
};
function months() {
  const w = S.D.can_write, M = new Map((S.D.months || []).map(m => [m.ym, m]));
  render(`${head(`ปีภาษี ${S.year + 543}`, "นำเข้าเงินเดือน", "เลือกได้หลายไฟล์พร้อมกัน — ระบบดูเองว่าเป็นไฟล์แบบไหนและเดือนอะไร · อัปเดือนเดิมซ้ำ = แทนยอดเดือนนั้นทั้งหมด")}
  ${w ? `<div class="card"><div class="card-b">
    <label class="drop" id="mDrop"><input type="file" id="mFile" accept=".xls,.xlsx" multiple hidden><div class="ico ico-blue">${I.file}</div>
      <div><b>ลากไฟล์เงินเดือนมาวาง หรือกดเลือก (หลายไฟล์ได้)</b><span class="small muted">BeforeProcessYDP (TigerSoft ก.ค. 2569 →) · NN Payroll - &lt;Month&gt; YYYY.xlsx แผ่น Salary Final (Excel เดิม) · Payroll-Tigersoft_YYYY-MM-ไม่sum.xlsx (แยกเงินชดเชยได้ ใช้แทน Excel ได้) — อ่านในเครื่อง ส่งขึ้นเฉพาะยอดภาษี</span></div></label>
  </div></div>` : ""}
  ${S.imp.length ? `<div class="card mt"><div class="card-h"><div><div class="card-t">ตรวจก่อนบันทึก</div><div class="card-s">แก้เดือนได้ถ้าเดาจากชื่อไฟล์ผิด</div></div>
      <div class="fx-actions"><button class="btn" id="impClear">ล้าง</button><button class="btn btn-p" id="impSave">${I.save}บันทึกทั้งหมด</button></div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>ไฟล์</th><th>แบบ</th><th>เดือน</th><th class="r">คน</th><th class="r">เงินได้</th><th class="r">ภาษี</th><th>หมายเหตุ</th></tr></thead><tbody>
    ${S.imp.map((x, i) => { const v = x.rows ? [...x.rows.values()] : [], old = M.get(x.ym);
      const notEmp = x.rows ? [...x.rows.keys()].filter(c => !S.E.has(c) && !S.P.has(c)).length : 0;
      return `<tr><td class="small">${esc(x.file)}</td><td class="small">${x.error ? `<span class="chip chip-red">อ่านไม่ได้</span>` : esc(T.FORMAT_TH[x.format])}</td>
        <td>${x.error ? "" : `<input type="month" class="inp" data-ym="${i}" value="${x.ym}" style="width:150px">`}</td>
        <td class="r">${x.rows ? x.rows.size : ""}</td><td class="r money">${x.rows ? baht(T.sumBy(v, T.income)) : ""}</td><td class="r money">${x.rows ? baht(T.sumBy(v, T.taxAll)) : ""}</td>
        <td class="small">${x.error ? `<span class="neg">${esc(x.error)}</span>` : [!x.ym || !x.ym.startsWith(String(S.year)) ? `<span class="neg">เดือนไม่อยู่ในปี ${S.year + 543}</span>` : "",
          old ? `แทนของเดิม (${old.people} คน · ${esc(old.file_name || "")})` : "", notEmp ? `${notEmp} รหัสไม่อยู่ในทะเบียนพนักงาน (เช่น รายวัน)` : "", x.skipped ? `ข้ามแถวยอดศูนย์ ${x.skipped}` : "",
          x.format === "excel" ? "Excel ไม่แยกเงินชดเชย — ถ้ามีไฟล์ไม่sum ของเดือนนี้ใช้ไฟล์นั้นดีกว่า" : ""].filter(Boolean).join(" · ")}</td></tr>`; }).join("")}
    </tbody></table></div></div>` : ""}
  <div class="card mt"><div class="card-h"><div class="card-t">เดือนที่บันทึกแล้ว · ปี ${S.year + 543}</div></div>
    ${M.size ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>เดือน</th><th>แบบไฟล์</th><th class="r">คน</th><th class="r">เงินได้</th><th class="r">ภาษี</th><th>ไฟล์</th><th>บันทึกโดย</th>${w ? "<th></th>" : ""}</tr></thead><tbody>
      ${[...M.values()].map(m => `<tr><td><b>${ymTH(m.ym)}</b></td><td class="small">${esc(T.FORMAT_TH[m.format] || m.format || "")}</td><td class="r">${m.people}</td><td class="r money">${baht(m.income)}</td><td class="r money">${baht(m.tax)}</td>
        <td class="small muted">${esc(m.file_name || "")}</td><td class="small muted">${esc(m.saved_by_name || "")}${m.saved_at ? " · " + dTH(m.saved_at.slice(0, 10)) : ""}</td>
        ${w ? `<td><button class="btn btn-sm" data-delm="${m.ym}">ลบ</button></td>` : ""}</tr>`).join("")}</tbody></table></div>` : `<div class="empty">ยังไม่มี — เริ่มจากไฟล์ ม.ค. ${S.year + 543}</div>`}</div>`);
  const drop = $("#mDrop");
  if (drop) {
    $("#mFile").onchange = e => { const fs = [...(e.target.files || [])]; e.target.value = ""; readFiles(fs); };
    drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); readFiles([...(e.dataTransfer.files || [])]); };
  }
  document.querySelectorAll("[data-ym]").forEach(i => i.onchange = () => { S.imp[+i.dataset.ym].ym = i.value; months(); });
  $("#impClear") && ($("#impClear").onclick = () => { S.imp = []; months(); });
  $("#impSave") && ($("#impSave").onclick = saveImports);
  document.querySelectorAll("[data-delm]").forEach(b => b.onclick = async () => {
    const why = prompt(`ลบยอดเดือน ${ymTH(b.dataset.delm)} ทั้งหมด — เหตุผล`); if (!why) return;
    try { await rpc("tax_month_delete", { p_ym: b.dataset.delm, p_reason: why }); } catch (e) { toast(e.message, "error"); return; }
    await loadYear(); months();
  });
}
async function readFiles(files) {
  for (const f of files) {
    try {
      const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: "array" });
      const sheets = Object.fromEntries(wb.SheetNames.map(n => [n.trim(), XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null })]));
      const r = T.readPayroll(sheets);
      S.imp.push({ file: f.name, ym: guessYM(f.name), ...r });
    } catch (e) { S.imp.push({ file: f.name, error: e.message }); }
  }
  S.imp.sort((a, b) => (a.ym || "").localeCompare(b.ym || ""));
  months();
}
async function saveImports() {
  const ok = S.imp.filter(x => !x.error && x.ym && x.ym.startsWith(String(S.year)));
  const dup = ok.map(x => x.ym).filter((m, i, a) => a.indexOf(m) !== i);
  if (dup.length) { toast(`มีหลายไฟล์เป็นเดือนเดียวกัน: ${[...new Set(dup)].map(ymTH).join(", ")} — ลบหรือแก้เดือนก่อน`, "error"); return; }
  if (!ok.length) { toast("ไม่มีไฟล์ที่บันทึกได้", "error"); return; }
  const rep = ok.filter(x => (S.D.months || []).some(m => m.ym === x.ym));
  if (rep.length && !confirm(`จะแทนยอดเดิมของ ${rep.map(x => ymTH(x.ym)).join(", ")} — ต่อไหม`)) return;
  for (const x of ok) {
    try {
      await rpc("tax_month_save", { p_ym: x.ym, p_format: x.format, p_file: x.file, p_rows: [...x.rows.entries()].map(([emp_code, v]) => ({ emp_code, ...v })) });
      S.imp = S.imp.filter(y => y !== x); toast(`บันทึก ${ymTH(x.ym)} แล้ว`, "success");
    } catch (e) { toast(`${ymTH(x.ym)}: ${e.message}`, "error"); break; }
  }
  await loadYear(); badge(); months();
}

// ---------------------------------------------------------------- ภ.ง.ด.1 / 1ก
function pndPage() {
  const w = S.D.can_write, { out: R, byYM, pByK } = recon(), F = S.D.pnd || [], yr = S.year;
  const k1 = `${yr}-1K`, f1k = F.find(f => f.k === k1);
  // ภ.ง.ด.1ก (หรือรวม ภ.ง.ด.1 ทุกเดือน) เทียบทะเบียนทั้งปีรายคน
  let annual = null;
  if (f1k) {
    const P = new Map(); for (const p of pByK[k1] || []) { const c = p.emp_code || "?" + p.tax_id, o = P.get(c) || (P.set(c, { income: 0, tax: 0, p }), P.get(c)); o.income += +p.income; o.tax += +p.tax; }
    annual = [];
    for (const [c, t] of S.tot) { const p = P.get(c); if (!p || Math.abs(p.income - T.income(t)) >= .01 || Math.abs(p.tax - T.taxAll(t)) >= .01) annual.push({ c, t, p }); }
    for (const [c, p] of P) if (!S.tot.has(c)) annual.push({ c, t: null, p });
  }
  const KIND = { diff: ["ยอดไม่ตรง", "chip-red"], not_in_pnd: ["ไม่มีใน ภ.ง.ด.1", "chip-amb"], not_in_reg: ["ไม่มีในทะเบียน", "chip-amb"], unmatched: ["จับคู่ไม่ได้", "chip-gray"] };
  render(`${head(`ปีภาษี ${yr + 543}`, "กระทบยอด ภ.ง.ด.1 / ภ.ง.ด.1ก", "อัปไฟล์ข้อความที่ยื่นจริง (Pnd1_YYYY-MM.txt) — ระบบเทียบกับทะเบียนรายคน และเติมเลขผู้เสียภาษี/ที่อยู่ให้คนที่ยังไม่มี")}
  ${w ? `<div class="card"><div class="card-b"><label class="drop" id="pDrop"><input type="file" id="pFile" accept=".txt,.csv" multiple hidden><div class="ico ico-gold">${I.file}</div>
      <div><b>ลากไฟล์ ภ.ง.ด.1 / ภ.ง.ด.1ก มาวาง (หลายไฟล์ได้)</b><span class="small muted">ไฟล์ข้อความคั่นด้วย | จากโปรแกรมยื่นแบบ · ไฟล์ที่ไม่มีเดือนในแต่ละบรรทัดถือเป็น ภ.ง.ด.1ก ของปีที่เลือก</span></div></label></div></div>` : ""}
  ${S.pimp.length ? `<div class="card mt"><div class="card-h"><div class="card-t">ตรวจก่อนบันทึก</div><div class="fx-actions"><button class="btn" id="pClear">ล้าง</button><button class="btn btn-p" id="pSave">${I.save}บันทึกทั้งหมด</button></div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>ไฟล์</th><th>รอบ</th><th class="r">รายการ</th><th class="r">จับคู่ได้</th><th class="r">เงินได้</th><th class="r">ภาษี</th></tr></thead><tbody>
    ${S.pimp.map(x => `<tr><td class="small">${esc(x.file)}</td><td>${x.error ? `<span class="neg">${esc(x.error)}</span>` : x.k.endsWith("1K") ? `ภ.ง.ด.1ก ${+x.k.slice(0, 4) + 543}` : `ภ.ง.ด.1 ${ymTH(x.k)}`}</td>
      <td class="r">${x.rows?.length ?? ""}</td><td class="r">${x.rows ? x.rows.filter(r => r.emp_code).length : ""}</td><td class="r money">${x.rows ? baht(T.sumBy(x.rows, "income")) : ""}</td><td class="r money">${x.rows ? baht(T.sumBy(x.rows, "tax")) : ""}</td></tr>`).join("")}
    </tbody></table></div></div>` : ""}
  <div class="card mt"><div class="card-h"><div><div class="card-t">ภ.ง.ด.1 รายเดือน</div><div class="card-s">เงินได้ = 40(1) + 40(2) + เงินชดเชย · ภาษี = ภาษี + ภาษีเงินชดเชย</div></div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>เดือน</th><th class="r">ทะเบียน (คน / เงินได้ / ภาษี)</th><th class="r">ภ.ง.ด.1 ที่ยื่น</th><th class="r">ผลต่างเงินได้</th><th class="r">ผลต่างภาษี</th><th>ผล</th></tr></thead><tbody>
    ${Array.from({ length: 12 }, (_, i) => `${yr}-${String(i + 1).padStart(2, "0")}`).filter(m => byYM[m] || R[m]).map(m => { const rc = R[m], reg = byYM[m] || [];
      const ri = T.sumBy(reg, T.income), rt = T.sumBy(reg, T.taxAll);
      return `<tr class="${rc?.issues.length ? "click" : ""}" data-pm="${m}"><td><b>${ymTH(m)}</b></td><td class="r money">${reg.length} · ${baht(ri)} · ${baht(rt)}</td>
        <td class="r money">${rc ? `${rc.totals.pnd.n} · ${baht(rc.totals.pnd.income)} · ${baht(rc.totals.pnd.tax)}` : "<span class='muted'>ยังไม่อัป</span>"}</td>
        <td class="r money ${rc && Math.abs(ri - rc.totals.pnd.income) >= .01 ? "neg" : ""}">${rc ? baht(ri - rc.totals.pnd.income) : ""}</td><td class="r money ${rc && Math.abs(rt - rc.totals.pnd.tax) >= .01 ? "neg" : ""}">${rc ? baht(rt - rc.totals.pnd.tax) : ""}</td>
        <td>${!rc ? "" : rc.issues.length ? `<span class="chip chip-red">ไม่ตรง ${rc.issues.length} คน</span>` : `<span class="chip chip-em">ตรงทุกคน</span>`}</td></tr>
        ${rc?.issues.length && S.pOpen === m ? `<tr><td colspan="6" style="background:#FAFBFD"><table class="tbl"><thead><tr><th>คน</th><th>เรื่อง</th><th class="r">ทะเบียน เงินได้ / ภาษี</th><th class="r">ภ.ง.ด.1 เงินได้ / ภาษี</th></tr></thead><tbody>
          ${rc.issues.map(i => `<tr ${i.emp_code ? `class="click" data-open="${esc(i.emp_code)}"` : ""}><td>${i.emp_code ? who(i.emp_code) : `${esc(i.name)}<div class="small muted">${esc(i.tax_id)}</div>`}</td><td><span class="chip ${KIND[i.kind][1]}">${KIND[i.kind][0]}</span></td>
            <td class="r money">${i.reg ? `${baht(i.reg.income)} / ${baht(i.reg.tax)}` : "-"}</td><td class="r money">${i.pnd ? `${baht(i.pnd.income)} / ${baht(i.pnd.tax)}` : "-"}</td></tr>`).join("")}</tbody></table></td></tr>` : ""}`; }).join("") || `<tr><td colspan="6" class="empty">ยังไม่มีข้อมูล</td></tr>`}
    </tbody></table></div></div>
  <div class="card mt"><div class="card-h"><div><div class="card-t">ภ.ง.ด.1ก ปี ${yr + 543}</div><div class="card-s">${f1k ? `อัปแล้ว ${f1k.rows_n} รายการ · ${esc(f1k.file_name || "")}` : "ยื่นภายในสิ้นเดือน ก.พ. ปีถัดไป — อัปไฟล์ที่ยื่นแล้วเพื่อเทียบกับทะเบียนทั้งปีรายคน"}</div></div>
      <div class="fx-actions"><button class="btn btn-g" id="b1k">${I.xl}ใบงาน ภ.ง.ด.1ก จากทะเบียน (Excel)</button></div></div>
    ${annual ? annual.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>คน</th><th class="r">ทะเบียน เงินได้ / ภาษี</th><th class="r">ภ.ง.ด.1ก เงินได้ / ภาษี</th></tr></thead><tbody>
      ${annual.map(a => `<tr ${a.c.startsWith("?") ? "" : `class="click" data-open="${esc(a.c)}"`}><td>${a.c.startsWith("?") ? `${esc(a.p.p.first + " " + a.p.p.last)}<div class="small muted">จับคู่ไม่ได้ ${esc(a.p.p.tax_id)}</div>` : who(a.c)}</td>
        <td class="r money">${a.t ? `${baht(T.income(a.t))} / ${baht(T.taxAll(a.t))}` : "-"}</td><td class="r money neg">${a.p ? `${baht(a.p.income)} / ${baht(a.p.tax)}` : "ไม่มีในไฟล์"}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="ok-line">${I.check}ภ.ง.ด.1ก ตรงกับทะเบียนทุกคน</div>` : ""}</div>`);
  const drop = $("#pDrop");
  if (drop) {
    $("#pFile").onchange = e => { const fs = [...(e.target.files || [])]; e.target.value = ""; readPnd(fs); };
    drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); readPnd([...(e.dataTransfer.files || [])]); };
  }
  document.querySelectorAll("[data-pm]").forEach(tr => tr.onclick = () => { S.pOpen = S.pOpen === tr.dataset.pm ? null : tr.dataset.pm; pndPage(); });
  $("#pClear") && ($("#pClear").onclick = () => { S.pimp = []; pndPage(); });
  $("#pSave") && ($("#pSave").onclick = savePnd);
  $("#b1k").onclick = export1k;
}
async function readPnd(files) {
  const people = [...S.P.values()];
  // คนที่ไม่อยู่ในทะเบียนพนักงาน (รายวัน DAY… / กรรมการ) จับคู่ด้วยชื่อที่เก็บจากไฟล์เงินเดือน
  const names = [...S.emps, ...people.filter(p => !S.E.has(p.emp_code) && p.first_th).map(p => ({ emp_code: p.emp_code, firstname_th: p.first_th, lastname_th: p.last_th }))];
  for (const f of files) {
    try {
      const text = await f.text(), r = T.parsePnd(text, S.D.settings?.company_tax_id || "");
      if (!r.rows.length) throw new Error("ไม่พบรายการ");
      if (r.months.length > 1) throw new Error(`มีหลายเดือนในไฟล์เดียว (${r.months.join(", ")})`);
      const k = r.months[0] || `${S.year}-1K`;
      if (!k.startsWith(String(S.year))) throw new Error(`เป็นไฟล์ปี ${+k.slice(0, 4) + 543} — เลือกปีภาษีนั้นก่อน`);
      S.pimp.push({ file: f.name, k, rows: T.matchPnd(r.rows, people, names) });
    } catch (e) { S.pimp.push({ file: f.name, error: e.message }); }
  }
  pndPage();
}
async function savePnd() {
  for (const x of S.pimp.filter(x => !x.error)) {
    try { const r = await rpc("tax_pnd_save", { p_key: x.k, p_file: x.file, p_rows: x.rows }); toast(`${x.file}: ${r.rows} รายการ · เติมข้อมูลผู้เสียภาษี ${r.filled} คน`, "success"); S.pimp = S.pimp.filter(y => y !== x); }
    catch (e) { toast(`${x.file}: ${e.message}`, "error"); break; }
  }
  await loadYear(); badge(); pndPage();
}
function export1k() {
  const list = [...S.tot.keys()].map(c => { const ct = cert(c), p = S.P.get(c) || {};
    return { seq: ct?.no || null, emp_code: c, tot: S.tot.get(c), person: { tax_id: p.tax_id, title: p.title, first: p.first_th, last: p.last_th, address: p.address, zip: p.zip } }; })
    .sort((a, b) => (a.seq ?? 1e9) - (b.seq ?? 1e9) || a.emp_code.localeCompare(b.emp_code));
  const ws = XLSX.utils.aoa_to_sheet([T.PND1K_HEAD, ...T.pnd1kRows(list)]);
  for (let r = 1; r <= list.length * 3; r++) { const a = XLSX.utils.encode_cell({ r, c: 1 }); if (ws[a]) { ws[a].t = "s"; ws[a].z = "@"; } }
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "PND1K");
  XLSX.writeFile(wb, `ใบงาน ภงด1ก ${S.year + 543} (${today()}).xlsx`);
}

// ---------------------------------------------------------------- ออก 50 ทวิ
function certsPage() {
  const sub = location.hash.split("/")[2]; if (sub) { S.fCert = sub; history.replaceState(null, "", "#/certs"); }
  const w = S.D.can_write, yr = String(S.year), all = [...S.tot.keys()].sort();
  const leav = new Set(T.leaverAlerts(S.emps.filter(e => S.tot.has(e.emp_code)), S.D.certs || [], S.year, today()).map(x => x.emp_code));
  const F = {
    todo: ["ยังไม่เตรียม", c => !cert(c)], draft: ["ร่าง", c => cert(c)?.status === "draft"], pending: ["รอลงนาม", c => cert(c)?.status === "pending"],
    signed: ["ลงนามแล้ว", c => cert(c)?.status === "signed"], stale: ["ยอดเปลี่ยนหลังลงนาม", c => cert(c)?.status === "signed" && T.certStale(cert(c), S.tot.get(c))],
    void: ["ยกเลิก", c => cert(c)?.status === "void"], leavers: ["ลาออก ต้องออกก่อน", c => leav.has(c)], "": ["ทั้งหมด", () => true] };
  const list = all.filter((F[S.fCert] || F[""])[1]).filter(c => !S.q || [c, nameOf(c)].join(" ").toLowerCase().includes(S.q.toLowerCase()));
  const sel = [...S.sel].filter(c => list.includes(c));
  render(`${head(`ปีภาษี ${+yr + 543} · 50 ทวิ ภ.ง.ด.1ก`, "ออก 50 ทวิ พนักงาน", "เตรียมร่างจากยอดทั้งปี → ส่งให้ผู้ลงนาม (ได้เลขที่) → ผู้ลงนามเลือกลงทีละใบหรือทั้งหมด → พิมพ์ หรือให้พนักงานโหลดเองที่หน้าพนักงาน",
      `<button class="btn" id="bLink">${I.link}ลิงก์หน้าพนักงาน</button>`)}
  ${S.year === +today().slice(0, 4) ? `<div class="card al" style="margin-bottom:14px"><div class="card-b small">ปี ${+yr + 543} ยังไม่จบ — ใบของคนที่ยังทำงานอยู่ควรออกหลังนำเข้าเงินเดือน ธ.ค. แล้ว · คนที่ลาออกระหว่างปีออกได้เลย (ภายใน 1 เดือนหลังออก)</div></div>` : ""}
  <div class="card"><div class="card-h">
    <div class="seg" id="segC">${Object.entries(F).map(([k, [t, f]]) => `<button data-s="${k}" class="${S.fCert === k ? "on" : ""}">${t} ${all.filter(f).length}</button>`).join("")}</div>
    <div class="search">${I.search}<input class="inp" id="q" placeholder="ค้นหา" value="${esc(S.q)}"></div></div>
    ${sel.length ? `<div class="selbar">เลือก <b>${sel.length}</b> คน
      ${w ? `<button class="btn btn-sm btn-p" id="sPrep">เตรียม / อัปเดตร่าง</button><button class="btn btn-sm btn-g" id="sSend">${I.pen}ส่งให้ลงนาม</button><button class="btn btn-sm" id="sVoid">ยกเลิกใบ</button>` : ""}
      <button class="btn btn-sm" id="sPrint">${I.print}พิมพ์ / PDF</button><a href="#" id="sNone" class="small">ล้างที่เลือก</a></div>` : ""}
    <div class="tbl-wrap" style="max-height:calc(100vh - 330px)"><table class="tbl"><thead><tr><th class="cb"><input type="checkbox" id="cAll" ${list.length && list.every(c => S.sel.has(c)) ? "checked" : ""}></th>
      <th>พนักงาน</th><th class="r">เงินได้ทั้งปี</th><th class="r">ภาษี</th><th>50 ทวิ</th><th>ต้องดู</th></tr></thead><tbody>
    ${list.map(c => { const t = S.tot.get(c), ct = cert(c), ck = T.certChecks(S.P.get(c), t, S.E.get(c)), e = S.E.get(c);
      return `<tr><td class="cb"><input type="checkbox" data-sel="${esc(c)}" ${S.sel.has(c) ? "checked" : ""}></td><td class="click" data-open="${esc(c)}" style="cursor:pointer">${who(c, e?.end_date?.slice(0, 4) === yr ? ` · ออก ${dTH(e.end_date.slice(0, 10))}` : undefined)}</td>
        <td class="r money">${baht(T.income(t))}</td><td class="r money">${baht(T.taxAll(t))}</td>
        <td>${certChip(ct)}${ct?.status === "pending" && ct.requested_by_name ? `<div class="small muted">ส่งโดย ${esc(ct.requested_by_name)}</div>` : ""}${ct?.status === "draft" && ct.reason ? `<div class="small neg">ส่งกลับ: ${esc(ct.reason)}</div>` : ""}</td>
        <td class="small">${ck.map(x => `<span class="${x.level === "warn" ? "neg" : "muted"}">${esc(x.text)}</span>`).join("<br>")}</td></tr>`; }).join("") || `<tr><td colspan="6" class="empty">ไม่มี</td></tr>`}
    </tbody></table></div></div>`);
  document.querySelectorAll("#segC button").forEach(b => b.onclick = () => { S.fCert = b.dataset.s; certsPage(); });
  const qi = $("#q"); qi.oninput = () => { S.q = qi.value; const p = qi.selectionStart; certsPage(); const n = $("#q"); n.focus(); n.setSelectionRange(p, p); };
  document.querySelectorAll("[data-sel]").forEach(b => b.onchange = () => { b.checked ? S.sel.add(b.dataset.sel) : S.sel.delete(b.dataset.sel); certsPage(); });
  $("#cAll").onchange = e => { list.forEach(c => e.target.checked ? S.sel.add(c) : S.sel.delete(c)); certsPage(); };
  $("#sNone") && ($("#sNone").onclick = ev => { ev.preventDefault(); S.sel.clear(); certsPage(); });
  $("#sPrep") && ($("#sPrep").onclick = () => prepare(sel));
  $("#sSend") && ($("#sSend").onclick = () => send(sel));
  $("#sVoid") && ($("#sVoid").onclick = () => voidCerts(sel));
  $("#sPrint") && ($("#sPrint").onclick = () => printCerts(sel.filter(c => cert(c))));
  $("#bLink").onclick = () => { const u = `${location.origin}/tax/my.html`; navigator.clipboard?.writeText(u); toast("คัดลอกลิงก์แล้ว: " + u, "success"); };
}
async function prepare(codes) {
  try {
    const r = await rpc("tax_certs_prepare", { p_year: S.year, p_codes: codes });
    toast(`เตรียมร่าง ${r.prepared.length} ใบ${r.skipped.length ? ` · ข้าม ${r.skipped.length}: ${r.skipped.slice(0, 3).map(x => `${x.emp_code} ${x.why}`).join(" / ")}${r.skipped.length > 3 ? " …" : ""}` : ""}`, r.skipped.length ? "" : "success");
  } catch (e) { toast(e.message, "error"); return; }
  await loadYear(); route();
}
async function send(codes) {
  const drafts = codes.filter(c => cert(c)?.status === "draft");
  if (!drafts.length) { toast("เลือกใบที่เป็นร่างก่อน (ยังไม่เตรียม → กด “เตรียม / อัปเดตร่าง”)", "error"); return; }
  const stale = drafts.filter(c => T.certStale(cert(c), S.tot.get(c)));
  let signers; try { signers = await rpc("tax_signers"); } catch (e) { toast(e.message, "error"); return; }
  if (!signers.length) { toast("ยังไม่มีผู้ลงนาม — ให้ Admin เพิ่มสิทธิ์ “ลงนาม 50 ทวิ พนักงาน” และผู้ลงนามอัปโหลดลายเซ็นในระบบ HR", "error"); return; }
  modal(`ส่ง 50 ทวิ ${drafts.length} ใบให้ลงนาม`, `<label class="fld"><span>ผู้ลงนาม (ผู้จ่ายเงิน)</span><select class="inp" id="sg">${signers.map(s => `<option value="${esc(s.user_id)}">${esc(s.name)}${s.title ? " · " + esc(s.title) : ""}</option>`).join("")}</select></label>
    <div class="small muted">ใบจะได้เลขที่เรียงตามรหัสพนักงาน ต่อจากเลขสุดท้ายของปี · ผู้ลงนามเลือกลงทีละใบหรือทั้งหมดได้ที่เมนู “รอฉันลงนาม”</div>
    ${stale.length ? `<div class="small neg">${stale.length} ใบยอดในร่างไม่ตรงกับทะเบียนล่าสุด — กด “เตรียม / อัปเดตร่าง” ก่อนส่ง</div>` : ""}`, "ส่ง", async m => {
    if (stale.length && !confirm("มีร่างที่ยอดไม่ตรงทะเบียนล่าสุด ส่งต่อไหม")) return false;
    try { const r = await rpc("tax_certs_send", { p_year: S.year, p_codes: drafts, p_signer: m.querySelector("#sg").value }); toast(`ส่งแล้ว ${r.sent.length} ใบ`, "success"); }
    catch (e) { toast(e.message, "error"); return false; }
    S.sel.clear(); await loadYear(); route();
  });
}
function voidCerts(codes) {
  const list = codes.filter(c => cert(c) && cert(c).status !== "void");
  if (!list.length) { toast("ไม่มีใบที่ยกเลิกได้", "error"); return; }
  modal(`ยกเลิก 50 ทวิ ${list.length} ใบ`, `<label class="fld"><span>เหตุผล</span><input class="inp" id="vr" placeholder="เช่น ยอดเดือน ธ.ค. แก้ไข"></label><div class="small muted">เตรียมใหม่ได้ เลขที่เดิม · ใบที่พนักงานโหลดไปแล้วให้แจ้งว่าใช้ใบใหม่</div>`, "ยกเลิกใบ", async m => {
    const why = m.querySelector("#vr").value.trim(); if (!why) { toast("ใส่เหตุผล", "error"); return false; }
    try { await rpc("tax_certs_void", { p_year: S.year, p_codes: list, p_reason: why }); } catch (e) { toast(e.message, "error"); return false; }
    S.sel.clear(); await loadYear(); route();
  });
}
async function printCerts(codes, preview = false) {
  if (!codes.length) { toast("ยังไม่มีใบ — เตรียมร่างก่อน", "error"); return; }
  try {
    const d = await rpc("tax_print", { p_year: S.year, p_codes: codes });
    const html = cert50Doc(d.certs.sort((a, b) => (a.no || 1e9) - (b.no || 1e9)).map(c => cert50Page(c, d.settings || {}, d.art || {})), `50 ทวิ ${S.year + 543}`);
    if (preview) { const w = window.open("", "_blank"); if (!w) { toast("เบราว์เซอร์บล็อกหน้าต่าง — อนุญาต pop-up", "error"); return; } w.document.open(); w.document.write(html); w.document.close(); }
    else printHTML(html);
  } catch (e) { toast(e.message, "error"); }
}

// ---------------------------------------------------------------- รอฉันลงนาม
function signPage() {
  const mine = (S.D.certs || []).filter(c => c.status === "pending" && String(c.signer_id) === String(S.D.me)).sort((a, b) => (a.no || 0) - (b.no || 0));
  const sel = mine.filter(c => S.sel.has(c.emp_code)).map(c => c.emp_code);
  const nm = c => c.person ? `${c.person.title || ""}${c.person.first_th || ""} ${c.person.last_th || ""}` : c.emp_code;
  render(`${head(`ปีภาษี ${S.year + 543}`, "50 ทวิ รอฉันลงนาม", "เปิดดูใบก่อนลงนามได้ · เลือกลงทีละใบ เลือกบางใบ หรือลงทั้งหมดในครั้งเดียว · วันที่ในใบ = วันที่ลงนาม",
      mine.length ? `<button class="btn" id="pvAll">${I.print}ดูทั้งหมด</button><button class="btn btn-g" id="sgAll">${I.pen}ลงนามทั้งหมด ${mine.length} ใบ</button>` : "")}
  <div class="card">${sel.length ? `<div class="selbar">เลือก <b>${sel.length}</b> ใบ <button class="btn btn-sm btn-p" id="sgSel">${I.pen}ลงนามที่เลือก</button><button class="btn btn-sm" id="pvSel">${I.print}ดูที่เลือก</button><button class="btn btn-sm" id="rtSel">ส่งกลับแก้ไข</button></div>` : ""}
    ${mine.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="cb"><input type="checkbox" id="cAll" ${mine.every(c => S.sel.has(c.emp_code)) ? "checked" : ""}></th><th>เลขที่</th><th>ผู้ถูกหักภาษี</th><th class="r">เงินได้</th><th class="r">ภาษี</th><th>ส่งโดย</th><th></th></tr></thead><tbody>
      ${mine.map(c => `<tr><td class="cb"><input type="checkbox" data-sel="${esc(c.emp_code)}" ${S.sel.has(c.emp_code) ? "checked" : ""}></td><td><b>#${c.no}</b></td>
        <td><b>${esc(nm(c))}</b><div class="small muted">${esc(c.emp_code)}</div></td><td class="r money">${baht((+c.inc401 || 0) + (+c.inc402 || 0) + (+c.sev || 0))}</td><td class="r money">${baht((+c.tax || 0) + (+c.sev_tax || 0))}</td>
        <td class="small muted">${esc(c.requested_by_name || "")}${c.requested_at ? " · " + dTH(c.requested_at.slice(0, 10)) : ""}</td>
        <td style="white-space:nowrap"><button class="btn btn-sm" data-pv="${esc(c.emp_code)}">ดูใบ</button> <button class="btn btn-sm btn-p" data-sg="${esc(c.emp_code)}">ลงนาม</button></td></tr>`).join("")}
    </tbody></table></div>` : `<div class="ok-line">${I.check}ไม่มีใบที่รอคุณลงนาม</div>`}</div>`);
  const signNow = async (codes, label) => {
    if (!confirm(`ลงนาม 50 ทวิ ${label} — ลายเซ็นของคุณจะลงในใบและพนักงานโหลดได้ทันที`)) return;
    try { const r = await rpc("tax_certs_sign", { p_year: S.year, p_codes: codes }); toast(`ลงนามแล้ว ${r.signed.length} ใบ`, "success"); }
    catch (e) { toast(e.message, "error"); return; }
    S.sel.clear(); await loadYear(); badge(); signPage();
  };
  document.querySelectorAll("[data-sel]").forEach(b => b.onchange = () => { b.checked ? S.sel.add(b.dataset.sel) : S.sel.delete(b.dataset.sel); signPage(); });
  $("#cAll") && ($("#cAll").onchange = e => { mine.forEach(c => e.target.checked ? S.sel.add(c.emp_code) : S.sel.delete(c.emp_code)); signPage(); });
  document.querySelectorAll("[data-pv]").forEach(b => b.onclick = () => printCerts([b.dataset.pv], true));
  document.querySelectorAll("[data-sg]").forEach(b => b.onclick = () => signNow([b.dataset.sg], "1 ใบ"));
  $("#sgAll") && ($("#sgAll").onclick = () => signNow(mine.map(c => c.emp_code), `ทั้งหมด ${mine.length} ใบ`));
  $("#pvAll") && ($("#pvAll").onclick = () => printCerts(mine.map(c => c.emp_code), true));
  $("#sgSel") && ($("#sgSel").onclick = () => signNow(sel, `${sel.length} ใบที่เลือก`));
  $("#pvSel") && ($("#pvSel").onclick = () => printCerts(sel, true));
  $("#rtSel") && ($("#rtSel").onclick = () => modal(`ส่งกลับ ${sel.length} ใบ`, `<label class="fld"><span>เหตุผล</span><input class="inp" id="rr"></label>`, "ส่งกลับ", async m => {
    const why = m.querySelector("#rr").value.trim(); if (!why) { toast("ใส่เหตุผล", "error"); return false; }
    try { await rpc("tax_certs_return", { p_year: S.year, p_codes: sel, p_reason: why }); } catch (e) { toast(e.message, "error"); return false; }
    S.sel.clear(); await loadYear(); badge(); signPage();
  }));
}

// ---------------------------------------------------------------- ประวัติ
async function logPage() {
  render(`${head("Akara Tax", "ประวัติการแก้ไข", "นำเข้า แก้ยอด แก้ข้อมูลผู้เสียภาษี เตรียม/ส่ง/ลงนาม/ยกเลิก 50 ทวิ · 300 รายการล่าสุด")}<div class="card"><div class="card-b" id="lg">กำลังโหลด…</div></div>`);
  const { data, error } = await supabase.rpc("tax_log", {});
  $("#lg").innerHTML = error ? esc(error.message) : (data || []).map(x => `<div class="log-i"><span class="d"></span><div><div class="small muted">${dTH(x.at.slice(0, 10))} ${x.at.slice(11, 16)} · ${esc(x.by_name || "")}${x.emp_code ? " · " + esc(x.emp_code) : ""}</div>${esc(x.detail || x.action)}</div></div>`).join("") || "ยังไม่มี";
}

// ---------------------------------------------------------------- ปุ่มที่ใช้ร่วม
function wire(root) {
  root.querySelectorAll("[data-open]").forEach(a => a.onclick = ev => { if (ev.target.closest("input,button")) return; ev.preventDefault(); ev.stopPropagation(); drawer(a.dataset.open); });
  root.querySelectorAll("[data-print]").forEach(b => b.onclick = () => printCerts([b.dataset.print], true));
  root.querySelectorAll("[data-prep]").forEach(b => b.onclick = async () => { await prepare([b.dataset.prep]); if (S.open) drawer(S.open); });
  root.querySelectorAll("[data-void]").forEach(b => b.onclick = () => voidCerts([b.dataset.void]));
}

boot();
