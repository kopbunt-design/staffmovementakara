// ===== Akara Fund (/fund) — กองทุนสำรองเลี้ยงชีพ: ภาพรวม · แจ้งเตือน · ทะเบียน · ยอดรายเดือน + ไฟล์ส่งกองทุน · นำเข้า =====
// user 2026-11-13: แยกจากระบบ HR เป็นเว็บของตัวเอง ดีไซน์ใหม่ (fx.css) · ห้าม import js/app.js
// กติกาอยู่ใน js/pvd-calc.js (มีเทส) · ข้อมูล azure-app/pvd.py ผ่าน supabase.rpc("pvd_…")
// ยอดเงินรายคนเดาเงินเดือนได้ → หน้า/ตัวเลขเงินต้องมี field.salary.read · ไฟล์เงินเดือนอ่านในเบราว์เซอร์ ส่งขึ้นเฉพาะยอดกองทุน
import { supabase } from "../js/supabase-config.js";
import * as P from "../js/pvd-calc.js";
import { initShim } from "./app-shim.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const EN_M = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ymTH = ym => ym ? `${TH_M[+ym.slice(5, 7) - 1]} ${+ym.slice(0, 4) + 543}` : "-";
const ymShort = ym => `${TH_M[+ym.slice(5, 7) - 1]} ${String(+ym.slice(0, 4) + 543).slice(2)}`;
const dTH = d => d ? `${+d.slice(8, 10)} ${TH_M[+d.slice(5, 7) - 1]} ${+d.slice(0, 4) + 543}` : "-";
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);       // เวลาไทย
const curYM = () => today().slice(0, 7);
const pct = r => r == null ? "-" : `${+(r * 100).toFixed(2)}%`;
const baht = n => n == null ? "-" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const bahtK = n => n == null ? "-" : n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(Math.round(n));
const KIND = { tier_not_applied: "ขั้นสมทบยังไม่ปรับ", er_rate: "เงินสมทบไม่ตรง", emp_rate: "เงินสะสมไม่ตรง", not_member: "ไม่อยู่ในทะเบียน",
               missing: "ทะเบียนไม่ครบ", left: "ออกแล้วยังเป็นสมาชิก", no_deduct: "ไม่มีการหัก", no_pay: "ไม่มีในไฟล์เงินเดือน", no_join: "ไม่มีวันเริ่มงาน" };
const POLICIES = ["PF1103", "PF2103", "PF4103", "PF6103", "PFM103", "PF9103", "PFD103", "PFK103", "PFW103", "PFF103", "PFQ103", "PRF103"];
const I = {
  up: '<svg viewBox="0 0 24 24"><path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
  out: '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></svg>',
  user: '<svg viewBox="0 0 24 24"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M12 12v6M9 15l3 3 3-3"/></svg>',
  dl: '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.3 2.3 4.7-4.8"/></svg>',
  coin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M9.5 10c0-1 1.1-1.7 2.5-1.7s2.5.7 2.5 1.7-1.1 1.4-2.5 1.8-2.5.8-2.5 1.8 1.1 1.7 2.5 1.7 2.5-.7 2.5-1.7"/></svg>',
  xl: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="m8 8 8 8M16 8l-8 8"/></svg>',
};

const S = { user: null, perms: new Set(), D: null, emps: [], E: new Map(), subs: [], invites: [], q: "", fStatus: "active", ahead: 3, onlyChange: false, month: null, imp: null };
const can = p => S.perms.has(p);

function toast(msg, type = "") {
  const t = document.createElement("div"); t.className = "toast " + (type === "error" ? "err" : type === "success" ? "ok" : ""); t.textContent = msg;
  $("#fxToasts").appendChild(t); setTimeout(() => t.remove(), type === "error" ? 6000 : 3500);
}
// อักษรย่อ — ข้ามสระหน้า (เ แ โ ใ ไ) ไม่งั้น "เชาว์ลิต" ได้ "เ"
const ini = n => String(n || "?").trim().split(/\s+/).slice(0, 2).map(w => w.replace(/^[เแโใไ]/, "")[0] || "").join("") || "?";
const nameTH = (m, e) => (m?.first_th ? `${m.title_th || ""}${m.first_th} ${m.last_th || ""}` : [e?.firstname_th, e?.lastname_th].filter(Boolean).join(" ")) || "-";
const mem = code => S.D.members.find(m => m.emp_code === code);
const who = (code, sub) => { const e = S.E.get(code), m = mem(code), n = nameTH(m, e);
  return `<div class="who"><div class="a">${esc(ini(m?.first_th || e?.firstname_th || code))}</div><div><b>${esc(n)}</b><span>${esc(code)}${sub ? " · " + esc(sub) : ""}</span></div></div>`; };

// ---------------------------------------------------------------- เริ่มต้น
async function fetchAll(q) {
  const out = [];
  for (let from = 0; ; from += 1000) { const { data, error } = await q().range(from, from + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break; }
  return out;
}
async function load() {
  if (!can("page.pvd")) { S.D = { members: [], sections: [], runs: [], first: {}, can_write: false, can_money: false, none: true }; return; }
  const { data, error } = await supabase.rpc("pvd_data");
  if (error) throw error;
  S.D = data;
}
// ใบสมัคร/คำขอจากหน้าแบบฟอร์มกองทุน — ใช้จับคู่กับทะเบียน (ไม่มีสิทธิ์ = ว่าง)
async function loadForms() {
  if (!can("page.fundforms")) return;
  const [a, b] = await Promise.all([
    supabase.from("fund_form_submission").select("id,form_type,emp_code,emp_name,status,payload,submitted_at,invite_id").order("submitted_at", { ascending: false }),
    supabase.from("fund_form_invite").select("emp_code,forms,cancelled,opened_at,created_at")]);
  S.subs = (a.data || []).map(x => ({ ...x, emp_code: String(x.emp_code || "").toUpperCase() }));
  S.invites = (b.data || []).map(x => ({ ...x, emp_code: String(x.emp_code || "").toUpperCase() }));
}
// สะพานใบสมัคร ↔ ทะเบียน: ใบสมัคร PVD ที่ HR รับเรื่องแล้วแต่ยังไม่ลงทะเบียน · คำขอเปลี่ยนอัตรา/แผนที่ทะเบียนยังไม่ตรง
const DONE = new Set(["accepted", "received", "approved", "sent"]);
function bridgeData() {
  const latest = new Map();
  for (const x of S.subs) if (x.form_type === "pvd" && DONE.has(x.status) && !latest.has(x.emp_code)) latest.set(x.emp_code, x);
  const apply = [], rate = [], policy = [];
  for (const x of latest.values()) {
    const p = x.payload || {}, req = new Set(p.requests || []), m = mem(x.emp_code), r = p.rate ? Math.round(Number(p.rate) * 100) / 10000 : null;
    if (req.has("apply") && (!m || m.status === "declined")) apply.push({ x, rate: r, policy: p.policy || null });
    else if (m && m.status === "active") {
      if ((req.has("apply") || req.has("rate")) && r && Math.abs(r - (m.emp_rate || 0)) > 1e-6) rate.push({ x, m, rate: r });
      if ((req.has("apply") || req.has("policy")) && p.policy && p.policy !== m.policy && !m.policy) policy.push({ x, m, policy: p.policy });
    }
  }
  const invited = new Set(S.invites.filter(i => !i.cancelled && (i.forms || []).includes("pvd")).map(i => i.emp_code));
  return { apply, rate, policy, invited, waiting: S.subs.filter(x => x.status === "submitted").length };
}
async function boot() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { $("#fxMain").innerHTML = `<div class="card card-b" style="max-width:460px;margin:60px auto;text-align:center"><div class="card-t" style="justify-content:center">กรุณาเข้าสู่ระบบ</div>
      <p class="muted">ใช้บัญชีเดียวกับระบบ HR</p><a class="btn btn-p" href="/">ไปหน้าเข้าสู่ระบบ HR</a></div>`; return; }
  S.user = session.user;
  const { data: perms } = await supabase.rpc("my_permissions");
  S.perms = new Set((perms || []).map(p => typeof p === "string" ? p : p.perm_key || p.key));
  const name = S.user.user_metadata?.full_name || S.user.email || "";
  $("#fxUser").innerHTML = `<div class="av">${esc(ini(name).toUpperCase())}</div><div><b>${esc(name)}</b><span>${can("data.pvd.write") ? "จัดการกองทุน" : "ดูอย่างเดียว"}</span></div>`;
  if (!can("page.pvd") && !can("page.fundforms")) { $("#fxMain").innerHTML = `<div class="empty">บัญชีนี้ยังไม่มีสิทธิ์ใช้ Akara Fund — ให้ Admin เพิ่มสิทธิ์ “กองทุนสำรองเลี้ยงชีพ” หรือ “แบบฟอร์มกองทุน” ที่ User Management</div>`; return; }
  try {
    const [, emps] = await Promise.all([load(), fetchAll(() => supabase.from("employees")
      .select("emp_code,firstname_th,lastname_th,firstname_en,lastname_en,department,section,position,job_level,join_date,end_date,status,contract_type,dob").order("emp_code"))]);
    S.emps = emps.map(e => ({ ...e, emp_code: String(e.emp_code).toUpperCase() })); S.E = new Map(S.emps.map(e => [e.emp_code, e]));
    const role = (await supabase.from("user_roles").select("role").eq("user_id", S.user.id).maybeSingle()).data?.role || "user";
    initShim({ employees: S.emps, user: S.user, role, perms: S.perms, toast });
    await loadForms();
  } catch (e) { $("#fxMain").innerHTML = `<div class="card card-b"><b>โหลดข้อมูลไม่สำเร็จ</b><p class="muted">${esc(e.message)}</p></div>`; return; }
  if (!S.D.can_money) $("#navMonthly").style.display = "none";
  if (S.D.none) document.querySelectorAll('#fxNav a[data-r]:not([data-r="forms"])').forEach(a => { a.style.display = "none"; });
  if (!can("page.fundforms")) $('#fxNav a[data-r="forms"]').style.display = "none";
  if (!S.D.can_write) $("#navImport").style.display = "none";
  window.addEventListener("hashchange", route);
  route();
}
async function route() {
  if (S.lastR === "forms") await loadForms();          // สถานะใบอาจเปลี่ยนในหน้าแบบฟอร์ม — อ่านใหม่ก่อนจับคู่กับทะเบียน
  const r = location.hash.replace(/^#\/?/, "").split("/")[0] || (S.D.none ? "forms" : S.D.members.length ? "overview" : S.D.can_write ? "import" : "overview");
  S.lastR = r;
  document.querySelectorAll("#fxNav a[data-r]").forEach(a => a.classList.toggle("on", a.dataset.r === r));
  badge();
  ({ overview, alerts, members, monthly, log: logPage, import: importPage, forms }[r] || overview)();
  window.scrollTo(0, 0);
}
function badge() {
  const n = alertData().count; $("#navAl").textContent = n ? String(n) : "";
  const w = bridgeData().waiting; $("#navForms").textContent = w ? String(w) : "";
}
const head = (eyebrow, title, sub, actions = "") => `<div class="fx-head"><div><div class="fx-eyebrow">${eyebrow}</div><div class="fx-title">${title}</div>
  <div class="fx-sub">${sub}</div></div><div class="fx-actions">${actions}</div></div>`;
const render = html => { $("#fxMain").innerHTML = html; wireCommon($("#fxMain")); };

function alertData(ahead = S.ahead) {
  const ym = curYM(), M = S.D.members;
  const tiers = P.tierAlerts(M, S.E, ym, ahead), ra = P.registerAlerts(M, S.emps, today());
  const B = bridgeData();
  return { ym, tiers, ra, B, count: tiers.filter(t => t.changes && t.eff <= P.ymAdd(ym, 1)).length + ra.left.length + ra.eligible.length + ra.missing.length
    + B.apply.length + B.rate.length + B.policy.length };
}

// ---------------------------------------------------------------- ภาพรวม
function overview() {
  const M = S.D.members, act = M.filter(m => m.status === "active"), last = S.D.runs[0];
  if (!M.length) { render(head("กองทุนสำรองเลี้ยงชีพ", "ยินดีต้อนรับสู่ Akara Fund", "ยังไม่มีข้อมูลในทะเบียน") +
    `<div class="card card-b">${S.D.can_write ? `เริ่มจากนำเข้าไฟล์ทะเบียนเดิม (PVD Master) <a class="btn btn-p" href="#/import" style="margin-left:10px">${I.dl}ไปหน้านำเข้า</a>` : "รอ HR นำเข้าทะเบียน"}</div>`); return; }
  const A = alertData(12), ym = curYM();
  const rates = {}; act.forEach(m => { const k = Math.round((m.emp_rate || 0) * 100); rates[k] = (rates[k] || 0) + 1; });
  const rateRows = Object.entries(rates).sort((a, b) => +a[0] - +b[0]), maxR = Math.max(...rateRows.map(r => r[1]), 1);
  // อายุงานของสมาชิก → ขั้นเพดานสมทบรอบนี้
  const tiers = { "5%": 0, "7%": 0, "10%": 0, "12%": 0 };
  act.forEach(m => { const j = S.E.get(m.emp_code)?.join_date; if (j) tiers[pct(P.erCapFor(j.slice(0, 10), ym))]++; });
  const runs = S.D.runs.slice(0, 6).reverse(), maxRun = Math.max(...runs.map(r => (r.emp_total || 0) + (r.er_total || 0)), 1);
  // ไทม์ไลน์ 6 เดือนข้างหน้า
  const byM = {}; A.tiers.forEach(t => { if (t.eff <= P.ymAdd(ym, 5)) (byM[t.eff] ||= []).push(t); });
  const months = Array.from({ length: 6 }, (_, i) => P.ymAdd(ym, i));
  const kpi = (href, ico, cls, l, v, d) => `<a class="kpi" href="${href}"><div class="ico ${cls}">${ico}</div><div><div class="kpi-l">${l}</div><div class="kpi-v">${v}</div><div class="kpi-d">${d}</div></div></a>`;
  const upNext = A.tiers.filter(t => t.changes && t.eff <= P.ymAdd(ym, 2)).length;
  render(`
  ${head("กองทุนสำรองเลี้ยงชีพ · ภาพรวม", "เงินออมของพนักงาน ดูแลครบในที่เดียว", `ระเบียบสวัสดิการ AKR-OHR-SD-002 ข้อ 14 · ข้อมูล ณ ${dTH(today())}`,
    S.D.can_money ? `<a class="btn btn-g" href="#/monthly">${I.file}อัปไฟล์เงินเดือนเดือนนี้</a>` : "")}
  <div class="hero">
    <div class="hero-top">
      <div><div class="hero-l">สมาชิกที่ยังส่งเงินอยู่</div><div class="hero-v">${act.length.toLocaleString()}<small>คน</small></div>
        <div class="hero-l">จากพนักงานประจำ ${S.emps.filter(e => !e.end_date || e.end_date.slice(0, 10) > today()).length.toLocaleString()} คน · อัตราเข้าร่วม ${Math.round(act.length / Math.max(1, S.emps.filter(e => !e.end_date || e.end_date.slice(0, 10) > today()).length) * 100)}%</div></div>
      ${upNext ? `<div><span class="hero-badge">${I.up}${upNext} คนเงินสมทบขึ้นภายใน 2 รอบนี้</span></div>` : ""}
    </div>
    <div class="hero-split">
      <div class="hero-tile"><div class="l">${last ? `ส่งเข้ากองทุน รอบ ${ymTH(last.ym)}` : "ส่งเข้ากองทุนรอบล่าสุด"}</div><div class="v gold">${S.D.can_money && last ? "฿" + bahtK((last.emp_total || 0) + (last.er_total || 0)) : "—"}</div></div>
      <div class="hero-tile"><div class="l">เงินสะสม (พนักงาน)</div><div class="v">${S.D.can_money && last ? "฿" + bahtK(last.emp_total) : "—"}</div></div>
      <div class="hero-tile"><div class="l">เงินสมทบ (บริษัท)</div><div class="v em">${S.D.can_money && last ? "฿" + bahtK(last.er_total) : "—"}</div></div>
    </div>
  </div>
  <div class="kpis">
    ${kpi("#/alerts", I.up, "ico-gold", "ครบขั้นเงินสมทบ (3 เดือน)", A.tiers.filter(t => t.eff <= P.ymAdd(ym, 3)).length, `${A.tiers.filter(t => t.changes && t.eff <= P.ymAdd(ym, 3)).length} คนเงินสมทบเปลี่ยนจริง`)}
    ${kpi("#/alerts", I.user, "ico-blue", "พ้นทดลองงาน ยังไม่สมัคร", A.ra.eligible.length, "รอสมัคร / บันทึกไม่สมัคร")}
    ${kpi("#/alerts", I.out, "ico-red", "ออกแล้ว ยังเป็นสมาชิก", A.ra.left.length, "ต้องแจ้งกองทุนและปิดสมาชิก")}
    ${kpi("#/alerts", I.warn, "ico-em", "ข้อมูลทะเบียนไม่ครบ", A.ra.missing.length, "ช่องที่ไฟล์ส่งกองทุนต้องใช้")}
  </div>
  <div class="two">
    <div class="card"><div class="card-h"><div><div class="card-t">ใครจะได้เงินสมทบขั้นใหม่</div><div class="card-s">ครบ 3 / 6 / 10 ปี → เพดาน 7 / 10 / 12% · มีผลเดือนถัดจากเดือนที่ครบ · <span class="chip chip-gold">สีทอง</span> = เงินสมทบขึ้นจริง</div></div>
      <a class="btn btn-sm btn-ghost" href="#/alerts">ดูทั้งหมด →</a></div>
      <div class="card-b"><div class="tl">${months.map(m => { const L = byM[m] || [];
        return `<div class="tl-row"><div class="tl-m">${ymShort(m)}<span>${L.length ? L.length + " คน" : "—"}</span></div><div class="tl-ppl">${L.length ? [...L.filter(t => t.changes), ...L.filter(t => !t.changes)].slice(0, 12).map(t => { const e = S.E.get(t.emp_code);
          return `<span class="tl-p${t.changes ? " up" : ""}" data-open="${esc(t.emp_code)}" title="${esc(nameTH(mem(t.emp_code), e))} · ครบ ${t.years} ปี ${dTH(t.anniv)} · สมทบ ${pct(t.erBefore)} → ${pct(t.erAfter)}"><span class="a">${t.years}</span>${esc(e?.firstname_th || t.emp_code)}${t.changes ? ` ${pct(t.erAfter)}` : ""}</span>`; }).join("") + (L.length > 12 ? `<a class="tl-p" href="#/alerts">+${L.length - 12} คน</a>` : "")
          : `<span class="muted small">ไม่มีคนครบขั้น</span>`}</div></div>`; }).join("")}</div></div></div>
    <div>
      <div class="card"><div class="card-h"><div><div class="card-t">อัตราเงินสะสมที่พนักงานเลือก</div><div class="card-s">จำนวนสมาชิกต่ออัตรา (2–15%)</div></div></div>
        <div class="card-b">${rateRows.map(([k, n]) => `<div class="hbar"><div>สะสม ${k}%</div><div class="t"><i style="width:${n / maxR * 100}%"></i></div><div class="n">${n}</div></div>`).join("")}</div></div>
      <div class="card"><div class="card-h"><div><div class="card-t">เพดานสมทบตามอายุงาน (รอบ ${ymTH(ym)})</div><div class="card-s">จำนวนสมาชิกในแต่ละขั้น</div></div></div>
        <div class="card-b"><div class="bars">${Object.entries(tiers).map(([k, n]) => `<div class="bar" title="${k}: ${n} คน"><b>${n}</b><i style="height:${n / Math.max(...Object.values(tiers), 1) * 120}px"></i></div>`).join("")}</div>
        <div class="bar-x">${["< 3 ปี · 5%", "3–6 ปี · 7%", "6–10 ปี · 10%", "10 ปี+ · 12%"].map(t => `<span>${t}</span>`).join("")}</div></div></div>
    </div>
  </div>
  ${S.D.can_money && runs.length ? `<div class="card mt"><div class="card-h"><div><div class="card-t">ยอดส่งเข้ากองทุนรายเดือน</div><div class="card-s">เงินสะสม + เงินสมทบ · ${runs.length} รอบล่าสุดที่บันทึก</div></div></div>
    <div class="card-b"><div class="bars">${runs.map((r, i) => { const t = (r.emp_total || 0) + (r.er_total || 0);
      return `<div class="bar${i === runs.length - 1 ? " hl" : ""}" title="${ymTH(r.ym)}: ฿${baht(t)} (สะสม ฿${baht(r.emp_total)} · สมทบ ฿${baht(r.er_total)} · ${r.members} คน)"><b>${bahtK(t)}</b><i style="height:${t / maxRun * 120}px"></i></div>`; }).join("")}</div>
    <div class="bar-x">${runs.map(r => `<span>${ymShort(r.ym)}</span>`).join("")}</div></div></div>` : ""}`);
}

// ---------------------------------------------------------------- แจ้งเตือน
function alerts() {
  const A = alertData(), ym = A.ym, w = S.D.can_write;
  const tiers = A.tiers.filter(a => !S.onlyChange || a.changes);
  const sec = (cls, ico, icls, title, sub, n, inner, extra = "") => `<div class="card al ${cls}"><div class="card-h"><div style="display:flex;gap:12px;align-items:center">
      <div class="ico ${icls}">${ico}</div><div><div class="card-t">${title} <span class="chip ${n ? "chip-gold" : "chip-gray"}">${n}</span></div><div class="card-s">${sub}</div></div></div>${extra}</div>
      ${n ? `<div class="tbl-wrap">${inner}</div>` : `<div class="ok-line">${I.check}ไม่มีรายการ</div>`}</div>`;
  const B = A.B, nB = B.apply.length + B.rate.length + B.policy.length;
  render(`${head("กองทุนสำรองเลี้ยงชีพ", "แจ้งเตือน", "สิ่งที่ HR ต้องทำในรอบนี้ — เรียงจากเรื่องเงินก่อน")}
  ${nB ? `${sec("blue", I.file, "ico-blue", "จากใบสมัคร / คำขอ — ทะเบียนยังไม่ตรง",
    "ระบบเทียบใบที่ HR รับเรื่องแล้วในหน้าแบบฟอร์มกองทุน กับทะเบียน PVD · กดปุ่มแล้วระบบกรอกค่าจากใบให้ ตรวจแล้วกดบันทึก", nB,
    `<table class="tbl"><thead><tr><th>พนักงาน</th><th>ใบ</th><th>ในใบ</th><th>ในทะเบียน</th><th></th></tr></thead><tbody>
     ${B.apply.map(a => `<tr><td>${who(a.x.emp_code, S.E.get(a.x.emp_code)?.department)}</td><td><span class="chip chip-em">สมัครสมาชิก</span> <span class="muted small">#${a.x.id} · ${dTH(a.x.submitted_at?.slice(0, 10))}</span></td>
       <td>สะสม <b>${pct(a.rate)}</b>${a.policy ? ` · ${esc(a.policy)}` : ""}</td><td class="muted">${mem(a.x.emp_code) ? "ไม่สมัคร" : "ยังไม่มี"}</td>
       <td style="text-align:right">${w ? `<button class="btn btn-sm btn-p" data-fromapp="${a.x.id}">${I.plus}ลงทะเบียนจากใบสมัคร</button>` : ""}</td></tr>`).join("")}
     ${B.rate.map(a => `<tr><td>${who(a.x.emp_code, S.E.get(a.x.emp_code)?.department)}</td><td><span class="chip chip-gold">เปลี่ยนอัตราสะสม</span> <span class="muted small">#${a.x.id} · ${dTH(a.x.submitted_at?.slice(0, 10))}</span></td>
       <td><b>${pct(a.rate)}</b></td><td>${pct(a.m.emp_rate)}</td>
       <td style="text-align:right">${w ? `<button class="btn btn-sm" data-fromrate="${a.x.id}">ปรับตามคำขอ</button>` : ""}</td></tr>`).join("")}
     ${B.policy.map(a => `<tr><td>${who(a.x.emp_code, S.E.get(a.x.emp_code)?.department)}</td><td><span class="chip chip-blue">แผนการลงทุน</span> <span class="muted small">#${a.x.id}</span></td>
       <td><b>${esc(a.policy)}</b></td><td class="muted">ว่าง</td>
       <td style="text-align:right">${w ? `<button class="btn btn-sm" data-frompol="${a.x.id}">ใส่แผนตามใบ</button>` : ""}</td></tr>`).join("")}
    </tbody></table>`)}<div class="mt"></div>` : ""}
  ${sec("gold", I.up, "ico-gold", "อายุงานครบขั้น — เพดานเงินสมทบเปลี่ยน",
    `ครบ 3 / 6 / 10 ปี → เพดาน 7% / 10% / 12% · มีผลรอบเงินเดือนเดือนถัดจากเดือนที่ครบ · รอบ ${ymTH(ym)} ถึง ${ymTH(P.ymAdd(ym, S.ahead))}`, tiers.length,
    `<table class="tbl"><thead><tr><th>พนักงาน</th><th>วันเริ่มงาน</th><th>ครบ</th><th>มีผลรอบ</th><th class="r">สะสม</th><th class="r">สมทบ เดิม → ใหม่</th><th>ต้องทำ</th></tr></thead><tbody>
     ${tiers.map(a => `<tr class="click" data-open="${esc(a.emp_code)}"><td>${who(a.emp_code, S.E.get(a.emp_code)?.department)}</td><td>${dTH(S.E.get(a.emp_code)?.join_date?.slice(0, 10))}</td>
       <td><span class="chip chip-blue">${a.years} ปี</span> ${dTH(a.anniv)}</td><td><b>${ymTH(a.eff)}</b></td><td class="r">${pct(a.empRate)}</td>
       <td class="r"><span class="rate">${pct(a.erBefore)} <small>→</small> ${a.changes ? `<span style="color:var(--em-600)">${pct(a.erAfter)}</span>` : pct(a.erAfter)}</span></td>
       <td>${a.changes ? `<span class="chip chip-gold">ปรับเงินสมทบใน TigerSoft</span>` : `<span class="muted small">ไม่เปลี่ยน — แจ้งพนักงานว่าเพิ่มสะสมได้ถึง ${pct(a.capAfter)}</span>`}</td></tr>`).join("")}
    </tbody></table>`,
    `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><div class="seg" id="segAhead">${[1, 3, 6, 12].map(n => `<button data-n="${n}" class="${n === S.ahead ? "on" : ""}">${n} เดือน</button>`).join("")}</div>
      <label class="small" style="cursor:pointer"><input type="checkbox" id="onlyCh" ${S.onlyChange ? "checked" : ""}> เฉพาะคนที่เงินสมทบเปลี่ยน</label></div>`)}
  <div class="mt"></div>
  ${sec("red", I.out, "ico-red", "ออกจากงานแล้ว แต่ทะเบียนยังเป็นสมาชิก", "แจ้งบริษัทจัดการกองทุน แล้วกด “ปิดสมาชิก” · สิทธิ์ในเงินสมทบนับอายุงานรวมทดลองงาน: 1 ปี 25% · 2 ปี 50% · 3 ปี 75% · 4 ปีขึ้นไป 100%", A.ra.left.length,
    `<table class="tbl"><thead><tr><th>พนักงาน</th><th>วันที่พ้นสภาพ</th><th>อายุงาน</th><th>สิทธิ์ในเงินสมทบ</th><th></th></tr></thead><tbody>
     ${A.ra.left.map(x => `<tr><td>${who(x.emp_code, S.E.get(x.emp_code)?.department)}</td><td>${dTH(x.end)}</td><td>${x.years} ปี</td>
       <td><span class="vest"><i style="width:${x.pct * 100}%"></i></span><b>${Math.round(x.pct * 100)}%</b></td>
       <td>${w ? `<button class="btn btn-sm" data-close="${esc(x.emp_code)}" data-end="${esc(x.end)}">ปิดสมาชิก</button>` : ""}</td></tr>`).join("")}</tbody></table>`)}
  <div class="mt"></div>
  ${sec("blue", I.user, "ico-blue", "พ้นทดลองงานแล้ว ยังไม่อยู่ในทะเบียน", "พนักงานประจำ พ้นทดลองงาน (วันที่ 119) · สมัครแล้วกด “เพิ่มสมาชิก” · ไม่สมัครกด “ไม่สมัคร” จะได้ไม่ขึ้นซ้ำ", A.ra.eligible.length,
    `<table class="tbl"><thead><tr><th>พนักงาน</th><th>วันเริ่มงาน</th><th>พ้นทดลองงาน</th><th></th></tr></thead><tbody>
     ${A.ra.eligible.map(x => `<tr><td>${who(x.emp_code, S.E.get(x.emp_code)?.department)}</td><td>${dTH(x.join)}</td><td>${dTH(x.probationEnd)}</td>
       <td style="white-space:nowrap;text-align:right">${B.invited.has(x.emp_code) ? `<span class="chip chip-em" style="margin-right:6px">เชิญกรอกใบสมัครแล้ว</span>`
         : can("data.fundforms.write") ? `<button class="btn btn-sm btn-g" data-invite="${esc(x.emp_code)}">ส่งคำเชิญสมัคร</button> ` : ""}
         ${w ? `<button class="btn btn-sm btn-p" data-open="${esc(x.emp_code)}">${I.plus}เพิ่มสมาชิก</button> <button class="btn btn-sm" data-decline="${esc(x.emp_code)}">ไม่สมัคร</button>` : ""}</td></tr>`).join("")}</tbody></table>`)}
  <div class="mt"></div>
  ${sec("gray", I.warn, "ico-em", "ข้อมูลทะเบียนไม่ครบ", "ช่องที่ไฟล์ส่งกองทุนต้องใช้", A.ra.missing.length,
    `<table class="tbl"><thead><tr><th>พนักงาน</th><th>ขาด</th></tr></thead><tbody>
     ${A.ra.missing.map(x => `<tr class="click" data-open="${esc(x.emp_code)}"><td>${who(x.emp_code, S.E.get(x.emp_code)?.department)}</td><td>${x.miss.map(m => `<span class="chip chip-amb">${esc(m)}</span>`).join(" ")}</td></tr>`).join("")}</tbody></table>`)}`);
  document.querySelectorAll("#segAhead button").forEach(b => b.onclick = () => { S.ahead = +b.dataset.n; alerts(); });
  $("#onlyCh") && ($("#onlyCh").onchange = e => { S.onlyChange = e.target.checked; alerts(); });
}

// ---------------------------------------------------------------- ทะเบียน
function members() {
  const ym = curYM(), q = S.q.trim().toLowerCase();
  const list = S.D.members.filter(m => !S.fStatus || m.status === S.fStatus).map(m => ({ m, e: S.E.get(m.emp_code) }))
    .filter(({ m, e }) => !q || [m.emp_code, m.member_code, nameTH(m, e), e?.firstname_en, e?.lastname_en, e?.department, e?.section].join(" ").toLowerCase().includes(q))
    .sort((a, b) => a.m.emp_code.localeCompare(b.m.emp_code));
  const cnt = k => S.D.members.filter(m => m.status === k).length;
  render(`${head("กองทุนสำรองเลี้ยงชีพ", "ทะเบียนสมาชิก", `${S.D.members.length} รายการ · เงินสมทบที่แสดง = รอบ ${ymTH(ym)} · กดแถวเพื่อดู/แก้ไข`,
      `${S.D.can_write ? `<button class="btn btn-p" id="btnNew">${I.plus}เพิ่มสมาชิก</button>` : ""}<button class="btn" id="btnXl">${I.dl}Excel</button>`)}
  <div class="card"><div class="card-h">
    <div class="seg" id="segSt">${[["active", "เป็นสมาชิก"], ["left", "ออกแล้ว"], ["declined", "ไม่สมัคร"], ["pending", "รอเป็นสมาชิก"], ["", "ทั้งหมด"]].map(([k, t]) =>
      `<button data-s="${k}" class="${S.fStatus === k ? "on" : ""}">${t} ${k ? cnt(k) : S.D.members.length}</button>`).join("")}</div>
    <div class="search">${I.search}<input class="inp" id="q" placeholder="ค้นหา ชื่อ / รหัส / รหัสสมาชิก / แผนก" value="${esc(S.q)}"></div></div>
    <div class="tbl-wrap" style="max-height:calc(100vh - 290px)"><table class="tbl"><thead><tr><th>พนักงาน</th><th>รหัสสมาชิก</th><th>อายุงาน</th><th class="r">สะสม</th><th class="r">สมทบ</th><th>สิทธิ์เงินสมทบ*</th><th>แผน</th><th>สถานะ</th></tr></thead><tbody>
    ${list.map(({ m, e }) => { const j = e?.join_date?.slice(0, 10), y = j ? P.yearsAt(j, today()) : null, v = j ? P.vestOf(j, today()).pct : null;
      return `<tr class="click" data-open="${esc(m.emp_code)}"><td>${who(m.emp_code, e?.department)}</td><td class="num">${esc(m.member_code || "—")}</td>
        <td>${y != null ? `${y} ปี` : `<span class="chip chip-red">ไม่มีวันเริ่มงาน</span>`}</td><td class="r"><b>${pct(m.emp_rate)}</b></td>
        <td class="r">${j && m.emp_rate ? pct(P.erRateFor(m.emp_rate, j, ym)) : "-"}</td>
        <td>${v != null ? `<span class="vest"><i style="width:${v * 100}%"></i></span>${Math.round(v * 100)}%` : "-"}</td><td class="small">${esc(m.policy || "")}</td>
        <td>${m.status === "active" ? `<span class="chip chip-em">เป็นสมาชิก</span>` : m.status === "left" ? `<span class="chip chip-gray">ออก ${dTH(m.left_date)}</span>` : m.status === "declined" ? `<span class="chip chip-amb">ไม่สมัคร</span>` : `<span class="chip chip-blue">รอเป็นสมาชิก</span>`}</td></tr>`; }).join("")
      || `<tr><td colspan="8" class="empty">ไม่พบ</td></tr>`}
    </tbody></table></div></div>
  <div class="small muted" style="margin-top:10px">* สิทธิ์ในเงินสมทบถ้าออกวันนี้ (อายุงานรวมทดลองงาน) · สมทบ = เท่าเงินสะสมแต่ไม่เกินเพดานตามอายุงาน</div>`);
  document.querySelectorAll("#segSt button").forEach(b => b.onclick = () => { S.fStatus = b.dataset.s; members(); });
  const qi = $("#q"); qi.oninput = () => { S.q = qi.value; const p = qi.selectionStart; members(); const n = $("#q"); n.focus(); n.setSelectionRange(p, p); };
  $("#btnNew") && ($("#btnNew").onclick = () => drawer(null));
  $("#btnXl").onclick = exportMembers;
}

// ---------------------------------------------------------------- ลิ้นชักสมาชิก
function drawer(code, preset = {}, reason = "") {
  const m = code ? mem(code) : null, isNew = !m, e = code ? S.E.get(code) : null, w = S.D.can_write;
  const v = { status: "active", emp_rate: 0.05, ...(m || {}), ...preset };
  if (isNew && e) {
    v.first_th ||= e.firstname_th || ""; v.last_th ||= e.lastname_th || "";
    v.sec_code ||= P.guessSec(e, S.D.members, S.E);
    if (!v.dob && e.dob) { const [y, mo, d] = e.dob.slice(0, 10).split("-"); v.dob = `${d}${mo}${y}`; }
  }
  const j = e?.join_date?.slice(0, 10), y = j ? P.yearsAt(j, today()) : null, nxt = j ? [3, 6, 10].find(t => P.addYears(j, t) > today()) : null;
  const f = (k, label, extra = "", type = "text") => `<label class="fld"><span>${label}</span><input class="inp" data-f="${k}" type="${type}" ${w ? "" : "disabled"} ${extra}
      value="${esc(v[k] == null ? "" : k === "emp_rate" ? +(v[k] * 100).toFixed(2) : String(v[k]))}"></label>`;
  $("#fxDrawer").innerHTML = `<div class="dr-bg" data-x></div><div class="dr">
    <div class="dr-h"><button class="x" data-x>×</button>
      <div class="t">${isNew ? (e ? "เพิ่มสมาชิก · " + esc(nameTH(null, e)) : "เพิ่มสมาชิก PVD") : esc(nameTH(m, e))}</div>
      <div class="s">${esc(code || "")}${e ? ` · ${esc(e.department || "")} · ${esc(e.position || "")}` : ""}${e?.end_date ? ` · พ้นสภาพ ${dTH(e.end_date.slice(0, 10))}` : ""}</div>
      ${j ? `<div class="dr-stats"><div><span>อายุงาน</span><b>${y} ปี</b></div><div><span>เพดานสมทบรอบนี้</span><b>${pct(P.erCapFor(j, curYM()))}</b></div>
        <div><span>สิทธิ์เงินสมทบถ้าออกวันนี้</span><b>${Math.round(P.vestOf(j, today()).pct * 100)}%</b></div>
        <div><span>ขั้นถัดไป</span><b>${nxt ? `${pct(P.capOf(nxt))} · ${ymShort(P.ymAdd(P.addYears(j, nxt).slice(0, 7), 1))}` : "สูงสุดแล้ว"}</b></div></div>` : ""}
    </div>
    <div class="dr-b">
      ${isNew && !code ? `<label class="fld" style="margin-bottom:14px"><span>รหัสพนักงาน *</span><input class="inp" id="drCode" list="drEmps" placeholder="AKR…"></label>
        <datalist id="drEmps">${S.emps.filter(x => !x.end_date && !mem(x.emp_code)).map(x => `<option value="${esc(x.emp_code)}">${esc([x.firstname_th, x.lastname_th].join(" "))}</option>`).join("")}</datalist>` : ""}
      <div class="card"><div class="card-b"><div class="grid-f">
        ${f("member_code", "รหัสสมาชิก (CGM…)")}${f("sec_code", "รหัสสังกัด", `list="drSec"`)}
        <datalist id="drSec">${S.D.sections.map(s => `<option value="${esc(s.sec_code)}">${esc(s.name || "")}</option>`).join("")}</datalist>
        ${f("emp_rate", "อัตราเงินสะสม (%)", `step="0.5" min="2" max="15"`, "number")}
        <label class="fld"><span>แผนการลงทุน</span><select class="inp" data-f="policy" ${w ? "" : "disabled"}><option value="">—</option>${POLICIES.map(p => `<option ${v.policy === p ? "selected" : ""}>${p}</option>`).join("")}</select></label>
        ${f("title_th", "คำนำหน้า")}${f("first_th", "ชื่อ (ไทย)")}${f("last_th", "นามสกุล (ไทย)")}
        ${f("id_card", "เลขบัตรประชาชน", `maxlength="13"`)}${f("dob", "วันเกิด (ddmmyyyy ตามไฟล์กองทุน)", `maxlength="8"`)}
        ${f("member_date", "วันที่เป็นสมาชิก", "", "date")}
        <label class="fld"><span>สถานะ</span><select class="inp" data-f="status" ${w ? "" : "disabled"}>${Object.entries(P.STATUS_TH).map(([k, t]) => `<option value="${k}" ${v.status === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        ${f("left_date", "วันที่ออกจากกองทุน", "", "date")}
      </div>
      <label class="fld" style="margin-top:12px"><span>หมายเหตุ</span><textarea class="inp" data-f="note" rows="2" ${w ? "" : "disabled"}>${esc(v.note || "")}</textarea></label>
      ${w ? `<label class="fld" style="margin-top:12px"><span>เหตุผลที่แก้ (เก็บในประวัติ)</span><input class="inp" id="drReason" value="${esc(reason)}" placeholder="เช่น พนักงานขอเพิ่มอัตราสะสม (ปีละ 1 ครั้ง)"></label>` : ""}
      </div></div>
      <div id="drHist"></div>
    </div>
    <div class="dr-f"><button class="btn" data-x>ปิด</button>${w ? `<button class="btn btn-p" id="drSave">${I.save}บันทึก</button>` : ""}</div></div>`;
  const root = $("#fxDrawer"), close = () => { root.innerHTML = ""; };
  root.querySelectorAll("[data-x]").forEach(b => b.onclick = close);
  root.querySelector("#drCode")?.addEventListener("change", ev => { const c = ev.target.value.trim().toUpperCase(); if (S.E.has(c)) drawer(c, collect(root), reason); });
  if (!isNew) history(code, root.querySelector("#drHist"));
  root.querySelector("#drSave")?.addEventListener("click", async () => {
    const c = code || root.querySelector("#drCode")?.value.trim().toUpperCase();
    if (!c || !S.E.get(c)) { toast("ไม่พบรหัสพนักงานในทะเบียน", "error"); return; }
    if (isNew && mem(c)) { toast("คนนี้มีในทะเบียนแล้ว", "error"); return; }
    const row = collect(root);
    if (row.status === "active" && !(row.emp_rate >= 0.02 && row.emp_rate <= 0.15)) { toast("อัตราเงินสะสม 2–15%", "error"); return; }
    if (row.status === "left" && !row.left_date) { toast("ใส่วันที่ออกจากกองทุน", "error"); return; }
    const { data, error } = await supabase.rpc("pvd_member_save", { p_emp_code: c, p_row: row, p_reason: root.querySelector("#drReason")?.value || null });
    if (error) { toast(error.message, "error"); return; }
    close(); toast(data.changed.length ? "บันทึกแล้ว" : "ไม่มีอะไรเปลี่ยน", "success"); await load(); route();
  });
}
function collect(root) {
  const row = {}; root.querySelectorAll("[data-f]").forEach(i => { row[i.dataset.f] = i.value.trim() || null; });
  if (row.emp_rate != null) row.emp_rate = Math.round(Number(row.emp_rate) * 100) / 10000;
  if (row.id_card && !row.id_card.startsWith("•")) row.id_card = row.id_card.replace(/\D/g, "");
  return row;
}
async function history(code, el) {
  const [{ data: log }, money] = await Promise.all([supabase.rpc("pvd_log", { p_emp_code: code }),
    S.D.can_money ? supabase.rpc("pvd_person", { p_emp_code: code }) : Promise.resolve({ data: null })]);
  el.innerHTML = `${money?.data?.length ? `<div class="card mt"><div class="card-h"><div class="card-t">ยอดที่ส่งกองทุน</div></div><table class="tbl"><thead><tr><th>รอบ</th><th class="r">ฐาน</th><th class="r">เงินสะสม</th><th class="r">เงินสมทบ</th></tr></thead><tbody>
      ${money.data.slice().reverse().map(x => `<tr><td>${ymTH(x.ym)}</td><td class="r">${baht(x.base)}</td><td class="r">${baht(x.emp_amt)}</td><td class="r">${baht(x.er_amt)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${log?.length ? `<div class="card mt"><div class="card-h"><div class="card-t">ประวัติ</div></div><div class="card-b" style="padding-top:4px">${log.map(x => `<div class="log-i"><span class="d"></span><div><div class="small muted">${dTH(x.at.slice(0, 10))} ${x.at.slice(11, 16)} · ${esc(x.by_name || "")}</div>${esc(x.detail || x.action)}</div></div>`).join("")}</div></div>` : ""}`;
}

// ---------------------------------------------------------------- ยอดรายเดือน
function monthly() {
  if (!S.D.can_money) { render(`<div class="empty">ต้องมีสิทธิ์เห็นเงินเดือนรายคน</div>`); return; }
  const M = S.month || (S.month = { ym: curYM() }), ck = M.check;
  const warn = ck ? ck.issues.filter(i => i.level === "warn") : [], info = ck ? ck.issues.filter(i => i.level !== "warn") : [];
  const saved = S.D.runs.find(r => r.ym === M.ym), step = !ck ? 1 : saved && saved.file_name === M.file ? 3 : 2;
  const fname = `Akara Provident Fund_${EN_M[+M.ym.slice(5, 7) - 1]} ${M.ym.slice(0, 4)}.xlsx`;
  render(`${head("กองทุนสำรองเลี้ยงชีพ", "ยอดรายเดือน & ไฟล์ส่งกองทุน", "อัปไฟล์เงินเดือน TigerSoft → ระบบตรวจกับทะเบียนและเพดานสมทบ → บันทึก → ดาวน์โหลดไฟล์ส่งกองทุนรูปแบบเดิม")}
  <div class="card"><div class="card-b">
    <div class="steps">${["เลือกไฟล์เงินเดือน", "ตรวจยอด", "บันทึก & ส่งกองทุน"].map((t, i) => `<div class="step ${i + 1 < step ? "done" : i + 1 === step ? "cur" : ""}"><span class="n">${i + 1 < step ? "✓" : i + 1}</span>${t}</div>`).join("")}</div>
    <div style="display:grid;grid-template-columns:200px 200px 1fr;gap:14px;align-items:end">
      <label class="fld"><span>รอบเงินเดือน</span><input type="month" class="inp" id="mYM" value="${M.ym}"></label>
      <label class="fld"><span>วันที่จ่ายเงินเดือน</span><input type="date" class="inp" id="mPay" value="${M.payDate || `${M.ym}-22`}"></label>
      <label class="drop" id="mDrop"><input type="file" id="mFile" accept=".xls,.xlsx" hidden><div class="ico ico-blue">${I.file}</div>
        <div><b>${M.file ? esc(M.file) : "ลากไฟล์เงินเดือนมาวาง หรือกดเลือก"}</b><span class="small muted">BeforeProcessYDP จาก TigerSoft (ไฟล์เดียวกับ Payroll Register) · อ่านในเครื่อง ส่งขึ้นเฉพาะยอดกองทุน</span></div></label>
    </div></div></div>
  ${ck ? `<div class="kpis">
      ${[[I.user, "ico-blue", "สมาชิกที่ส่งเงิน", ck.totals.members.toLocaleString() + " คน"], [I.coin, "ico-gold", "เงินสะสม", "฿" + baht(ck.totals.emp)],
         [I.coin, "ico-em", "เงินสมทบ", "฿" + baht(ck.totals.er)], [warn.length ? I.warn : I.check, warn.length ? "ico-red" : "ico-em", "ต้องตรวจ", warn.length + " รายการ"]]
        .map(([ic, c, l, v]) => `<div class="kpi" style="cursor:default"><div class="ico ${c}">${ic}</div><div><div class="kpi-l">${l}</div><div class="kpi-v">${v}</div></div></div>`).join("")}</div>
    <div class="card mt"><div class="card-h"><div><div class="card-t">ผลตรวจรอบ ${ymTH(M.ym)}</div><div class="card-s">รวมส่งกองทุน ฿${baht(ck.totals.emp + ck.totals.er)}${saved ? ` · รอบนี้บันทึกไว้แล้ว (${esc(saved.file_name || "")})` : ""}</div></div>
      <div class="fx-actions">${S.D.can_write ? `<button class="btn btn-p" id="mSave">${I.save}บันทึกยอดรอบนี้</button>` : ""}<button class="btn btn-g" id="mUp">${I.dl}${esc(fname)}</button></div></div>
      ${warn.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>พนักงาน</th><th>เรื่อง</th><th>รายละเอียด</th></tr></thead><tbody>
        ${warn.map(i => `<tr class="click" data-open="${esc(i.emp_code)}"><td>${who(i.emp_code)}</td><td><span class="chip ${i.kind === "tier_not_applied" ? "chip-gold" : "chip-red"}">${KIND[i.kind] || i.kind}</span></td><td class="small">${esc(i.text)}</td></tr>`).join("")}</tbody></table></div>`
        : `<div class="ok-line">${I.check}ยอดตรงกับทะเบียนและเพดานสมทบทุกคน</div>`}
      ${info.length ? `<div class="card-b small muted" style="border-top:1px solid var(--line-2)">หมายเหตุ: ${info.map(i => `${esc(i.emp_code)} ${esc(i.text)}`).join(" · ")}</div>` : ""}</div>` : ""}
  <div class="card mt"><div class="card-h"><div class="card-t">รอบที่บันทึกแล้ว</div></div>
    ${S.D.runs.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>รอบ</th><th class="r">สมาชิก</th><th class="r">เงินสะสม</th><th class="r">เงินสมทบ</th><th class="r">รวม</th><th>ที่มา</th><th>บันทึกโดย</th><th></th></tr></thead><tbody>
      ${S.D.runs.map(r => `<tr><td><b>${ymTH(r.ym)}</b></td><td class="r">${r.members}</td><td class="r">${baht(r.emp_total)}</td><td class="r">${baht(r.er_total)}</td><td class="r"><b>${baht((r.emp_total || 0) + (r.er_total || 0))}</b></td>
        <td class="small muted">${r.source === "import" ? "นำเข้าจากไฟล์เดิม" : esc(r.file_name || "")}</td><td class="small muted">${esc(r.saved_by_name || "")}${r.saved_at ? " · " + dTH(r.saved_at.slice(0, 10)) : ""}</td>
        <td><button class="btn btn-sm" data-redl="${r.ym}" data-pay="${r.pay_date || ""}">${I.dl}ไฟล์ส่งกองทุน</button></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty">ยังไม่มี</div>`}</div>`);
  const drop = $("#mDrop");
  $("#mFile").onchange = e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) readPayroll(f); };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files?.[0]; if (f) readPayroll(f); };
  $("#mYM").onchange = e => { M.ym = e.target.value; M.payDate = `${M.ym}-22`; recheck(); monthly(); };
  $("#mPay").onchange = e => { M.payDate = e.target.value; };
  $("#mUp") && ($("#mUp").onclick = () => downloadUpload(M.ym, M.payDate || `${M.ym}-22`, M.check.items));
  $("#mSave") && ($("#mSave").onclick = saveMonth);
  document.querySelectorAll("[data-redl]").forEach(b => b.onclick = async () => {
    const { data, error } = await supabase.rpc("pvd_month", { p_ym: b.dataset.redl });
    if (error) { toast(error.message, "error"); return; }
    downloadUpload(b.dataset.redl, b.dataset.pay || `${b.dataset.redl}-22`, data.map(i => ({ ...i, ok: true })));
  });
}
function readPayroll(file) {
  const fr = new FileReader();
  fr.onload = ev => {
    try {
      const wb = XLSX.read(new Uint8Array(ev.target.result), { type: "array" });
      const pay = P.parsePayroll(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null }));
      Object.assign(S.month, { file: file.name, pay }); recheck(); monthly();
    } catch (e) { toast("อ่านไฟล์ไม่ได้: " + e.message, "error"); }
  };
  fr.readAsArrayBuffer(file);
}
function recheck() { const M = S.month; if (M?.pay) M.check = P.checkMonth({ pay: M.pay, members: S.D.members, emps: S.E, ym: M.ym }); }
function downloadUpload(ym, payDate, items) {
  if (!S.D.can_write) { toast("ต้องมีสิทธิ์จัดการทะเบียน PVD (เลขบัตรเต็ม)", "error"); return; }
  // แผนการลงทุนใส่เฉพาะเดือนแรกที่คนนั้นส่งเงิน → คนที่เคยส่งในรอบก่อนหน้า ym ไม่ใส่
  const sent = new Set(Object.entries(S.D.first || {}).filter(([, f]) => f < ym).map(([c]) => c));
  const rows = P.uploadRows(items, S.D.members, payDate, sent);
  const bad = rows.filter(r => !r[2] || !/^\d{13}$/.test(r[3]) || !r[4] || !r[1]);
  if (bad.length && !confirm(`${bad.length} คนข้อมูลทะเบียนไม่ครบ (รหัสสมาชิก/เลขบัตร/วันเกิด/รหัสสังกัด) — ดาวน์โหลดต่อไหม`)) return;
  const aoa = [...P.UPLOAD_HEAD, ...rows], ws = XLSX.utils.aoa_to_sheet(aoa);
  for (let r = 2; r < aoa.length; r++) {
    for (const c of [1, 2, 3, 4, 5, 6, 7]) { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a]) { ws[a].t = "s"; ws[a].v = String(ws[a].v); ws[a].z = "@"; } }
    for (const c of [9, 10]) { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a]) ws[a].z = "0.00"; }
  }
  ws["!cols"] = [8, 8, 10, 16, 10, 10, 16, 18, 12, 12, 12, 10, 10].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, EN_M[+ym.slice(5, 7) - 1]);
  XLSX.writeFile(wb, `Akara Provident Fund_${EN_M[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}.xlsx`);
  const plan = rows.filter(r => r[11]).length;
  toast(`ดาวน์โหลด ${rows.length} แถว${plan ? ` · ใส่แผนการลงทุน ${plan} คน (เดือนแรก)` : ""}`, "success");
}
async function saveMonth() {
  const M = S.month, ck = M.check, warn = ck.issues.filter(i => i.level === "warn").length;
  if (S.D.runs.some(r => r.ym === M.ym) && !confirm(`รอบ ${ymTH(M.ym)} บันทึกไว้แล้ว — แทนที่ด้วยไฟล์นี้?`)) return;
  if (warn && !confirm(`ยังมี ${warn} รายการต้องตรวจ — บันทึกตามไฟล์เงินเดือนไปก่อน?`)) return;
  const items = ck.items.map(i => ({ emp_code: i.emp_code, member_code: mem(i.emp_code)?.member_code || null, base: i.base, emp_amt: i.emp_amt, er_amt: i.er_amt, emp_rate: i.emp_rate, er_cap: i.er_cap }));
  const { data, error } = await supabase.rpc("pvd_month_save", { p_ym: M.ym, p_pay_date: M.payDate || `${M.ym}-22`, p_file: M.file, p_items: items });
  if (error) { toast(error.message, "error"); return; }
  toast(`บันทึก ${ymTH(M.ym)} แล้ว · ${data.members} คน`, "success"); await load(); monthly();
}

// ---------------------------------------------------------------- แบบฟอร์มกองทุน (หน้าเดิม js/fund-forms.js ในดีไซน์นี้)
async function forms() {
  if (!can("page.fundforms")) { render(`<div class="empty">บัญชีนี้ยังไม่มีสิทธิ์ “แบบฟอร์มกองทุน”</div>`); return; }
  const B = bridgeData(), ra = S.D.none ? null : P.registerAlerts(S.D.members, S.emps, today());
  const notInvited = ra ? ra.eligible.filter(x => !B.invited.has(x.emp_code)).length : 0, nB = B.apply.length + B.rate.length + B.policy.length;
  render(`${head("ใบสมัคร & คำขอ", "แบบฟอร์มกองทุน", "ลิงก์เดียวสำหรับทุกคน · พนักงานเข้าด้วยรหัสพนักงาน + เลขบัตร 5 ตัวท้าย · ใบที่รับเรื่องแล้วระบบจับคู่กับทะเบียน PVD ให้เอง")}
  ${S.D.none ? "" : `<div class="bridge">
      <a href="#/forms" id="brWait"><div class="ico ico-gold">${I.file}</div><div><div class="spark">รอรับเรื่อง</div><b>${B.waiting}</b><span>ใบที่พนักงานส่งออนไลน์ ยังไม่ได้รับเรื่อง</span></div></a>
      <a href="#/alerts"><div class="ico ico-blue">${I.check}</div><div><div class="spark">ใบ → ทะเบียน PVD</div><b>${nB}</b><span>รับเรื่องแล้ว แต่ทะเบียนยังไม่ตรงกับใบ — กดเพื่อลงทะเบียนอัตโนมัติ</span></div></a>
      <a href="#/alerts"><div class="ico ico-em">${I.user}</div><div><div class="spark">ยังไม่ได้เชิญ</div><b>${notInvited}</b><span>พ้นทดลองงาน ยังไม่สมัคร PVD และยังไม่มีคำเชิญ</span></div></a>
    </div>`}<div id="pageFundforms" class="fx-legacy"><div class="empty">กำลังโหลด…</div></div>`);
  try {
    const m = await import("/js/fund-forms.js");
    await m.renderFundForms();
  } catch (e) { $("#pageFundforms").innerHTML = `<div class="card card-b"><b>เปิดหน้าแบบฟอร์มไม่สำเร็จ</b><p class="muted">${esc(e.message)}</p></div>`; return; }
  // มาจากปุ่ม "ส่งคำเชิญสมัคร" — เปิดหน้าต่างเชิญพร้อมกรอกรหัสและติ๊ก PVD ให้
  if (S.inviteFor) {
    const code = S.inviteFor; S.inviteFor = null;
    for (let i = 0; i < 40 && !document.getElementById("ffAdd"); i++) await new Promise(r => setTimeout(r, 100));
    const tab = document.querySelector('#pageFundforms [data-tab="invite"]'); if (tab && !tab.classList.contains("on")) { tab.click(); await new Promise(r => setTimeout(r, 50)); }
    document.getElementById("ffAdd")?.click();
    const inp = document.getElementById("ffEmp");
    if (inp) { inp.value = code; inp.dispatchEvent(new Event("input")); const fp = document.getElementById("ffFp"); if (fp) fp.checked = true;
      document.getElementById("ffLast5")?.focus(); toast(`กรอก ${code} ให้แล้ว — ใส่เลขบัตร 5 ตัวท้ายแล้วกดเชิญ`); }
  }
}

// ---------------------------------------------------------------- ประวัติ
async function logPage() {
  render(`${head("กองทุนสำรองเลี้ยงชีพ", "ประวัติการแก้ไข", "ทุกการเพิ่ม/แก้/นำเข้า/บันทึกยอด · 300 รายการล่าสุด")}<div class="card"><div class="empty">กำลังโหลด…</div></div>`);
  const { data, error } = await supabase.rpc("pvd_log", {});
  render(`${head("กองทุนสำรองเลี้ยงชีพ", "ประวัติการแก้ไข", "ทุกการเพิ่ม/แก้/นำเข้า/บันทึกยอด · 300 รายการล่าสุด")}
    <div class="card">${error ? `<div class="empty">${esc(error.message)}</div>` : `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>เวลา</th><th>โดย</th><th>พนักงาน</th><th>รายละเอียด</th></tr></thead><tbody>
      ${(data || []).map(x => `<tr${x.emp_code ? ` class="click" data-open="${esc(x.emp_code)}"` : ""}><td style="white-space:nowrap">${dTH(x.at.slice(0, 10))} ${x.at.slice(11, 16)}</td><td>${esc(x.by_name || "")}</td>
        <td>${x.emp_code ? esc(x.emp_code) : "<span class='chip chip-blue'>ระบบ</span>"}</td><td class="small">${esc(x.detail || x.action)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">ยังไม่มี</td></tr>`}</tbody></table></div>`}</div>`);
}

// ---------------------------------------------------------------- นำเข้า
function importPage() {
  if (!S.D.can_write) { render(`<div class="empty">ต้องมีสิทธิ์จัดการทะเบียน PVD</div>`); return; }
  const X = S.imp;
  render(`${head("กองทุนสำรองเลี้ยงชีพ", "นำเข้าทะเบียนเดิม", "ไฟล์ PVD Master — ชีต DataPVD (สมาชิก) · รหัสสังกัด · Record (ยอดรายเดือนที่ส่งแล้ว เฉพาะเดือนที่ยังไม่มีในระบบ)")}
  <div class="card"><div class="card-b">
    <label class="drop" id="iDrop"><input type="file" id="iFile" accept=".xlsx,.xls" hidden><div class="ico ico-gold">${I.xl}</div>
      <div><b>${X ? esc(X.file) : "เลือกไฟล์ PVD Master"}</b><span class="small muted">คนที่มีอยู่แล้วจะถูกแก้ตามไฟล์ พร้อมประวัติว่าเปลี่ยนอะไร · ช่อง “วันที่มีผล” = วันที่ออกจากกองทุน</span></div></label>
    ${X ? `<div class="kpis">
        ${[["สมาชิกในไฟล์", X.data.members.length], ["เป็นสมาชิก", X.data.members.filter(m => m.status === "active").length], ["ออกแล้ว", X.data.members.filter(m => m.status === "left").length],
           ["ใหม่ (ยังไม่มีในระบบ)", X.data.members.filter(m => !mem(m.emp_code)).length], ["ประวัติยอด", [...new Set(X.data.history.map(h => h.ym))].map(ymShort).join(", ") || "-"]]
          .map(([l, v]) => `<div class="kpi" style="cursor:default"><div><div class="kpi-l">${l}</div><div class="kpi-v" style="font-size:22px">${v}</div></div></div>`).join("")}</div>
      ${X.unknown.length ? `<div class="card-s" style="color:var(--red-600);margin-top:12px">รหัสพนักงานที่ไม่มีในทะเบียนพนักงาน: ${X.unknown.slice(0, 12).map(esc).join(", ")}${X.unknown.length > 12 ? " …" : ""}</div>` : ""}
      ${S.D.can_money ? "" : `<div class="card-s" style="margin-top:8px">ไม่นำเข้าประวัติยอด — บัญชีนี้ไม่มีสิทธิ์เห็นเงินเดือน</div>`}
      <div style="margin-top:16px"><button class="btn btn-p" id="iGo">${I.dl}นำเข้า ${X.data.members.length} คน</button></div>` : ""}
  </div></div>`);
  $("#iFile").onchange = e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) readMaster(f); };
  $("#iGo") && ($("#iGo").onclick = async () => {
    const b = $("#iGo"); b.disabled = true; b.textContent = "กำลังนำเข้า…";
    const { data, error } = await supabase.rpc("pvd_import", { p_members: X.data.members, p_sections: X.data.sections, p_history: S.D.can_money ? X.data.history : null, p_file: X.file });
    if (error) { toast(error.message, "error"); b.disabled = false; b.textContent = "นำเข้า"; return; }
    toast(`เพิ่ม ${data.added} · แก้ ${data.updated} คน${data.months.length ? ` · ประวัติ ${data.months.map(ymTH).join(", ")}` : ""}`, "success");
    S.imp = null; await load(); location.hash = "#/overview"; route();
  });
}
function readMaster(file) {
  const fr = new FileReader();
  fr.onload = ev => {
    try {
      const wb = XLSX.read(new Uint8Array(ev.target.result), { type: "array", cellDates: true });
      const sheets = Object.fromEntries(wb.SheetNames.map(n => [n.trim(), XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null })]));
      const data = P.parseMaster(sheets);
      S.imp = { file: file.name, data, unknown: data.members.map(m => m.emp_code).filter(c => !S.E.has(c)) }; importPage();
    } catch (e) { toast("อ่านไฟล์ไม่ได้: " + e.message, "error"); }
  };
  fr.readAsArrayBuffer(file);
}

// ---------------------------------------------------------------- ปุ่มที่ใช้ร่วม
function wireCommon(root) {
  const sub = id => S.subs.find(x => String(x.id) === String(id));
  root.querySelectorAll("[data-fromapp]").forEach(b => b.onclick = () => { const x = sub(b.dataset.fromapp), p = x.payload || {};
    drawer(x.emp_code, { status: "pending", emp_rate: p.rate ? Math.round(Number(p.rate) * 100) / 10000 : 0.05, policy: p.policy || null,
      note: `จากใบสมัครออนไลน์ #${x.id} (${dTH(x.submitted_at?.slice(0, 10))}) — ใส่รหัสสมาชิกเมื่อกองทุนตอบรับ แล้วเปลี่ยนเป็น "เป็นสมาชิก"` }, `ใบสมัคร #${x.id}`); });
  root.querySelectorAll("[data-fromrate]").forEach(b => b.onclick = () => { const x = sub(b.dataset.fromrate);
    drawer(x.emp_code, { emp_rate: Math.round(Number(x.payload.rate) * 100) / 10000 }, `คำขอเปลี่ยนอัตราสะสม #${x.id}`); });
  root.querySelectorAll("[data-frompol]").forEach(b => b.onclick = () => { const x = sub(b.dataset.frompol);
    drawer(x.emp_code, { policy: x.payload.policy }, `แผนการลงทุนตามใบ #${x.id}`); });
  root.querySelectorAll("[data-invite]").forEach(b => b.onclick = () => { S.inviteFor = b.dataset.invite; location.hash = "#/forms"; });
  root.querySelectorAll("[data-open]").forEach(a => a.onclick = ev => { ev.preventDefault(); drawer(a.dataset.open); });
  root.querySelectorAll("[data-close]").forEach(b => b.onclick = () => drawer(b.dataset.close, { status: "left", left_date: b.dataset.end }));
  root.querySelectorAll("[data-decline]").forEach(b => b.onclick = async () => {
    const note = prompt("ไม่สมัคร PVD — หมายเหตุ (เช่น วันที่แจ้ง / เหตุผล)", ""); if (note === null) return;
    const e = S.E.get(b.dataset.decline);
    const { error } = await supabase.rpc("pvd_member_save", { p_emp_code: b.dataset.decline, p_row: { status: "declined", first_th: e?.firstname_th, last_th: e?.lastname_th, note }, p_reason: "ไม่สมัคร" });
    if (error) { toast(error.message, "error"); return; }
    await load(); route();
  });
}
function exportMembers() {
  const ym = curYM();
  const rows = S.D.members.map(m => { const e = S.E.get(m.emp_code), j = e?.join_date?.slice(0, 10);
    return { "รหัสพนักงาน": m.emp_code, "ชื่อ": nameTH(m, e), "Department": e?.department || "", "Section": e?.section || "", "รหัสสังกัด": m.sec_code || "",
      "รหัสสมาชิก": m.member_code || "", "วันเริ่มงาน": j || "", "อายุงาน (ปี)": j ? P.yearsAt(j, today()) : "", "วันที่เป็นสมาชิก": m.member_date || "",
      "เงินสะสม %": m.emp_rate != null ? +(m.emp_rate * 100).toFixed(2) : "", "เงินสมทบ % (รอบนี้)": j && m.emp_rate ? +(P.erRateFor(m.emp_rate, j, ym) * 100).toFixed(2) : "",
      "สิทธิ์เงินสมทบถ้าออกวันนี้ %": j ? P.vestOf(j, today()).pct * 100 : "", "แผนการลงทุน": m.policy || "", "สถานะ": P.STATUS_TH[m.status] || m.status,
      "วันที่ออกจากกองทุน": m.left_date || "", "หมายเหตุ": m.note || "" }; });
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "PVD");
  XLSX.writeFile(wb, `PVD Register ${today()}.xlsx`);
}

boot();
