// ===== Akara Bonus (/bonus) — สรุปการลา/เวลาจาก TigerSoft · วันที่มีสิทธิ · โบนัส + เงินพิเศษ + เงินจัดสรรพิเศษ =====
// ประกาศ HR-152-2026 · user 2026-11-25 · ห้าม import js/app.js · กติกา js/bonus-calc.js (มีเทส) · ข้อมูล azure-app/bonus.py
// ไฟล์เวลาอ่านในเบราว์เซอร์ ส่งขึ้นเป็นรายคนรายเดือน · เงินรายคน (ฐานเงินเดือน) เห็นเฉพาะคนที่มี field.salary.read
import { supabase } from "../js/supabase-config.js";
import * as B from "../js/bonus-calc.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const ymTH = ym => ym ? `${TH_M[+ym.slice(5, 7) - 1]} ${+ym.slice(0, 4) + 543}` : "-";
const dTH = d => d ? `${+d.slice(8, 10)} ${TH_M[+d.slice(5, 7) - 1]} ${+d.slice(0, 4) + 543}` : "-";
const dS = d => d ? `${+d.slice(8, 10)}/${+d.slice(5, 7)}` : "";
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const baht = n => n == null ? "-" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const bahtM = n => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(Math.round(n));
const num = n => (Math.round((+n || 0) * 100) / 100).toLocaleString("en-US");
const hmin = m => m ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}` : "-";
const ini = n => String(n || "?").trim().replace(/^(นาย|นางสาว|นาง)/, "").split(/\s+/).slice(0, 2).map(w => w.replace(/^[เแโใไ]/, "")[0] || "").join("") || "?";
const I = {
  up: '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/></svg>',
  dl: '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  user: '<svg viewBox="0 0 24 24"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2.5"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  coin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M9.5 10c0-1 1.1-1.7 2.5-1.7s2.5.7 2.5 1.7-1.1 1.4-2.5 1.8-2.5.8-2.5 1.8 1.1 1.7 2.5 1.7 2.5-.7 2.5-1.7"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
};
const CLS_ORDER = ["full", "half", "sick", "mat", "none", "ignore"];
const CLS_SHORT = { full: ["หักเต็มวัน", "×1"], half: ["หักครึ่งวัน", "×0.5"], sick: ["ลาป่วย", "10 วันแรกฟรี"], mat: ["ลาคลอด", "60 วันแรกฟรี"], none: ["ไม่หัก", "×0"], ignore: ["ไม่ใช่การลา", "ข้าม"] };

const S = { user: null, perms: new Set(), D: null, year: 2026, P: B.PARAMS_2026, emps: [], E: new Map(), moves: [], R: null, q: "", f: "all", dept: "", lm: "", imp: null, open: null };
const can = p => S.perms.has(p);
function toast(msg, type = "") {
  const t = document.createElement("div"); t.className = "toast " + (type === "error" ? "err" : type === "success" ? "ok" : ""); t.textContent = msg;
  $("#fxToasts").appendChild(t); setTimeout(() => t.remove(), type === "error" ? 7000 : 3500);
}
const rpc = async (name, args) => { const { data, error } = await supabase.rpc(name, args); if (error) throw new Error(error.message); return data; };
const head = (eyebrow, title, sub, actions = "") => `<div class="fx-head"><div><div class="fx-eyebrow">${eyebrow}</div><div class="fx-title">${title}</div>
  <div class="fx-sub">${sub}</div></div><div class="fx-actions">${actions}</div></div>`;
const render = html => { $("#fxMain").innerHTML = html; wire($("#fxMain")); };
const nameOf = code => { const e = S.E.get(code); return e ? `${e.firstname_th || ""} ${e.lastname_th || ""}`.trim() : (S.D.agg.find(a => a.emp_code === code)?.name || code); };
const who = (code, sub) => { const e = S.E.get(code), n = nameOf(code);
  return `<div class="who"><div class="a">${esc(ini(n))}</div><div><b>${esc(n)}</b><span>${esc(code)}${sub ?? (e?.department ? " · " + esc(e.department) : "")}</span></div></div>`; };
const kchip = (kind, extra = "") => `<span class="kchip c-${kind === B.WORKED ? "none" : B.classOf(kind, S.D.types)}"><i></i>${esc(kind)}${extra}</span>`;
const yms = () => Array.from({ length: 12 }, (_, i) => `${S.year}-${String(i + 1).padStart(2, "0")}`);
const statYMs = () => yms().filter(m => m >= S.P.stat_from.slice(0, 7) && m <= S.P.stat_to.slice(0, 7));

// ---------------------------------------------------------------- โหลด + คำนวณ
async function fetchAll(q) {
  const out = [];
  for (let from = 0; ; from += 1000) { const { data, error } = await q().range(from, from + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break; }
  return out;
}
async function loadYear() {
  S.D = await rpc("bonus_data", { p_year: S.year });
  S.P = { ...B.PARAMS_2026, ...(S.year !== 2026 ? { year: S.year, stat_from: `${S.year}-01-01`, stat_to: `${S.year}-11-30`, join_by: `${S.year}-08-31`, pay_date: `${S.year}-12-25`, base_date: `${S.year}-12-01` } : {}), ...(S.D.params || {}) };
  recalc();
}
function recalc() {
  const sal = S.D.salary || {};
  // พนักงานที่อยู่ในปีนั้น (ยังไม่ออกก่อนต้นปี และเริ่มงานไม่เกินสิ้นปี)
  const emps = S.emps.filter(e => (!e.end_date || e.end_date.slice(0, 10) > `${S.year}-01-01`) && (!e.join_date || e.join_date.slice(0, 10) <= `${S.year}-12-31`))
    .map(e => ({ ...e, salary: S.D.can_money ? (sal[e.emp_code] ?? null) : null }));
  const off = new Set((S.D.months || []).filter(m => m.absent_off).map(m => m.ym));
  S.R = B.compute({ emps, moves: S.moves, events: S.D.events.map(e => ({ ...e, emp_code: String(e.emp_code).toUpperCase(), d: e.d.slice(0, 10), days: +e.days })),
    adj: S.D.adj.map(a => ({ ...a, d_from: a.d_from.slice(0, 10), d_to: a.d_to.slice(0, 10), days: +a.days })), types: S.D.types, offMonths: off, overrides: S.D.ovr || {} }, S.P);
  S.RB = new Map(S.R.rows.map(r => [r.code, r]));
  // ยอดสาย/ออกก่อนรวมทั้งปีต่อคน
  S.late = new Map();
  for (const a of S.D.agg) { const o = S.late.get(a.emp_code) || S.late.set(a.emp_code, { late_n: 0, late_min: 0, early_n: 0, early_min: 0, months: {} }).get(a.emp_code);
    for (const k of ["late_n", "late_min", "early_n", "early_min"]) o[k] += a[k] || 0; o.months[a.ym] = a; }
}
// ประเภทการลาที่พบทั้งหมด (จาก TigerSoft + ใบลาที่ HR บันทึก) + จำนวนวัน
function kindsSeen() {
  const m = new Map();
  for (const e of S.D.events) { const o = m.get(e.kind) || m.set(e.kind, { kind: e.kind, days: 0, n: new Set() }).get(e.kind); o.days += +e.days; o.n.add(e.emp_code); }
  for (const a of S.D.adj) { const o = m.get(a.kind) || m.set(a.kind, { kind: a.kind, days: 0, n: new Set() }).get(a.kind); o.days += +a.days; o.n.add(a.emp_code); }
  return [...m.values()].sort((a, b) => b.days - a.days);
}
const FIXED = k => k === B.WORK_INJURY || k === B.WORKED;   // ประเภทที่มาจาก HR เท่านั้น ตั้งน้ำหนักไม่ได้
const unconfirmed = () => kindsSeen().filter(k => !S.D.types[k.kind] && !FIXED(k.kind));
function alerts() {
  const imp = new Set(S.D.months.map(m => m.ym)), miss = statYMs().filter(m => m <= today().slice(0, 7) && !imp.has(m));
  const notReg = [...new Set(S.D.agg.map(a => a.emp_code))].filter(c => !S.E.has(c));
  return { miss, unc: unconfirmed(), notReg, inel: S.R.rows.filter(r => !r.ok && r.worked > 0), count: miss.length + unconfirmed().length + (absRuns().some(x => !x.done) ? 1 : 0) };
}

async function boot() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { $("#fxMain").innerHTML = `<div class="card card-b" style="max-width:460px;margin:60px auto;text-align:center"><div class="card-t" style="justify-content:center">กรุณาเข้าสู่ระบบ</div>
      <p class="muted">ใช้บัญชีเดียวกับระบบ HR</p><a class="btn btn-p" href="/">ไปหน้าเข้าสู่ระบบ HR</a></div>`; return; }
  S.user = session.user;
  const { data: perms } = await supabase.rpc("my_permissions");
  S.perms = new Set((perms || []).map(p => typeof p === "string" ? p : p.perm_key || p.key));
  const name = S.user.user_metadata?.full_name || S.user.email || "";
  $("#fxUser").innerHTML = `<div class="av">${esc(ini(name).toUpperCase())}</div><div><b>${esc(name)}</b><span>${can("data.bonus.write") ? "จัดการโบนัส" : "ดูอย่างเดียว"}</span></div>`;
  if (!can("page.bonus")) { $("#fxMain").innerHTML = `<div class="empty">บัญชีนี้ยังไม่มีสิทธิ์ใช้ Akara Bonus — ให้ Admin เพิ่มสิทธิ์ “โบนัสประจำปี” ที่ User Management</div>`; return; }
  S.year = +today().slice(0, 4) - (today().slice(5, 7) < "06" ? 1 : 0);
  try {
    const [emps, moves] = await Promise.all([
      fetchAll(() => supabase.from("employees").select("emp_code,firstname_th,lastname_th,division,department,section,position,job_level,join_date,end_date,status,contract_type,nationality").order("emp_code")),
      fetchAll(() => supabase.from("movements").select("emp_code,type,date").gte("date", "2025-01-01"))]);
    S.emps = emps.map(e => ({ ...e, emp_code: String(e.emp_code).toUpperCase() })); S.E = new Map(S.emps.map(e => [e.emp_code, e]));
    S.moves = moves.map(m => ({ ...m, emp_code: String(m.emp_code).toUpperCase() }));
    await loadYear();
  } catch (e) { $("#fxMain").innerHTML = `<div class="card card-b"><b>โหลดข้อมูลไม่สำเร็จ</b><p class="muted">${esc(e.message)}</p></div>`; return; }
  const ys = [...new Set([S.year, S.year - 1, +today().slice(0, 4)])].sort((a, b) => b - a);
  $("#bxYear").innerHTML = ys.map(y => `<option value="${y}" ${y === S.year ? "selected" : ""}>${y + 543}</option>`).join("");
  $("#bxYear").onchange = async e => { S.year = +e.target.value; S.imp = null; await loadYear(); route(); };
  window.addEventListener("hashchange", route);
  route();
}
function route() {
  const r = location.hash.replace(/^#\/?/, "").split("/")[0] || "overview";
  document.querySelectorAll("#fxNav a[data-r]").forEach(a => a.classList.toggle("on", a.dataset.r === r));
  badge();
  ({ overview, people, absent: absentPage, leave: leavePage, time: timePage, import: importPage, types: typesPage, rules: rulesPage, log: logPage }[r] || overview)();
  window.scrollTo(0, 0);
}
function badge() {
  const a = alerts();
  $("#navAl").textContent = a.count ? String(a.count) : "";
  $("#navImp").textContent = a.miss.length ? String(a.miss.length) : "";
  const inj = kindsSeen().filter(k => B.injuryHint(k.kind)).flatMap(k => kindRuns(k.kind)).filter(r => !r.adj).length;
  $("#navTy").textContent = a.unc.length + inj ? String(a.unc.length + inj) : "";
  const ab = absRuns().filter(x => !x.done).length; $("#navAb").textContent = ab ? String(ab) : "";
}
async function reload(keepDrawer = true) { await loadYear(); badge(); route(); if (keepDrawer && S.open) drawer(S.open); }

// ---------------------------------------------------------------- ภาพรวม
function overview() {
  const R = S.R, P = S.P, a = alerts(), money = S.D.can_money;
  const ok = R.rows.filter(r => r.ok), cut = ok.filter(r => r.ded.total > 0);
  const sum = k => ok.reduce((t, r) => t + (r.m?.[k] || 0), 0);
  const total = ok.reduce((t, r) => t + r.total, 0), dedDays = ok.reduce((t, r) => t + r.ded.total, 0);
  const imp = new Map(S.D.months.map(m => [m.ym, m]));
  // วันลาทั้งบริษัทตามประเภท (เฉพาะคนที่มีสิทธิ์ · ในช่วงเก็บสถิติ)
  const byK = new Map();
  for (const r of ok) for (const l of r.ded.lines) { const o = byK.get(l.kind) || byK.set(l.kind, { kind: l.kind, days: 0, ded: 0, cls: l.cls }).get(l.kind); o.days += l.days; o.ded += r.ded.exempt ? 0 : l.ded; }
  const ks = [...byK.values()].sort((x, y) => y.days - x.days).slice(0, 12), kmax = Math.max(1, ...ks.map(k => k.days));
  render(`${head(`ประกาศ ${esc(P.doc_no || "HR-152-2026")}`, `โบนัสประจำปี ${S.year + 543}`, `เก็บสถิติ ${dTH(P.stat_from)} – ${dTH(P.stat_to)} · จ่าย ${dTH(P.pay_date)} · ฐาน = เงินเดือน ณ ${dTH(P.base_date)}`,
      `${money ? `<button class="btn" id="bXl">${I.dl}Excel สำหรับ Payroll</button>` : ""}<a class="btn btn-p" href="#/import">${I.up}นำเข้าเวลา</a>`)}
    <div class="hero bx"><div class="hero-top"><div><div class="hero-l">${money ? "ยอดจ่ายรวม (โบนัส + เงินพิเศษ + เงินจัดสรรพิเศษ)" : "ผู้มีสิทธิ์ได้รับโบนัส"}</div>
      <div class="hero-v">${money ? `${baht(total)}<small>บาท</small>` : `${ok.length}<small>คน</small>`}</div>
      <div class="hero-l">${ok.length} คนมีสิทธิ์ · ${cut.length} คนถูกปรับลดรวม ${num(dedDays)} วัน · ${R.rows.length - ok.length} คนไม่มีสิทธิ์</div></div>
      <div class="hero-badge">${I.coin}${P.mult} เท่า + ${baht(P.special).replace(".00", "")}</div></div>
      <div class="hero-split four">
        <div class="hero-tile"><div class="l">เงินโบนัส</div><div class="v">${money ? bahtM(sum("bonus")) : "—"}</div></div>
        <div class="hero-tile"><div class="l">เงินพิเศษ</div><div class="v">${money ? bahtM(sum("special")) : "—"}</div></div>
        <div class="hero-tile"><div class="l">กองเงินจัดสรรพิเศษ</div><div class="v gold">${money ? bahtM(R.pool) : "—"}</div></div>
        <div class="hero-tile"><div class="l">ได้คนละ (${R.nShare} คน ไม่รวม M)</div><div class="v em">${money ? baht(R.per) : "—"}</div></div></div>
      <div class="formula"><span>โบนัส = เงินเดือน × <b>${P.mult}</b> × วันที่มีสิทธิ ÷ 365</span><span>เงินพิเศษ = <b>${baht(P.special).replace(".00", "")}</b> × วันที่มีสิทธิ ÷ 365</span><span>เงินจัดสรร = ยอดที่ถูกปรับลดรวม ÷ ผู้มีสิทธิ (ไม่รวม M)</span></div></div>
    ${!money ? `<div class="notice mt">${I.info}<div>ยอดเงินรายคนต้องใช้สิทธิ์ “ดูเงินเดือน” (field.salary.read) — บัญชีนี้เห็นเฉพาะจำนวนวัน</div></div>` : ""}
    <div class="card mt"><div class="card-h"><div><div class="card-t">${I.cal}ข้อมูลเวลาที่นำเข้าแล้ว</div><div class="card-s">ช่วงเก็บสถิติ ${ymTH(P.stat_from.slice(0, 7))} – ${ymTH(P.stat_to.slice(0, 7))} · กดเดือนเพื่อไปหน้านำเข้า</div></div></div>
      <div class="card-b"><div class="mstrip">${yms().map(m => { const x = imp.get(m), inS = statYMs().includes(m);
        return `<a class="ms ${!inS ? "out" : x ? (x.absent_off ? "off" : "ok") : "miss"}" href="#/import" title="${x ? `${x.people} คน · ลา/ขาด ${x.events} รายการ${x.absent_off ? " · ไม่นับขาดงานจากไฟล์" : ""}` : "ยังไม่ได้นำเข้า"}"><b>${TH_M[+m.slice(5) - 1]}</b><span>${x ? x.people + " คน" : inS ? "ยังไม่มี" : "นอกช่วง"}</span></a>`; }).join("")}</div></div></div>
    ${a.count || a.notReg.length ? `<div class="card mt"><div class="card-h"><div class="card-t">${I.warn}ต้องดูก่อนจ่าย</div></div><div class="card-b" style="display:grid;gap:10px">
      ${a.miss.length ? `<div class="notice gold">${I.warn}<div><b>ยังไม่ได้นำเข้าเวลา ${a.miss.length} เดือน:</b> ${a.miss.map(ymTH).join(", ")} — <a href="#/import">นำเข้า</a> หรือบันทึกใบลากระดาษรายคน</div></div>` : ""}
      ${a.unc.length ? `<div class="notice gold">${I.warn}<div><b>ประเภทการลาที่ยังไม่ยืนยันน้ำหนัก ${a.unc.length} ประเภท:</b> ${a.unc.slice(0, 6).map(k => esc(k.kind)).join(", ")}${a.unc.length > 6 ? " …" : ""} — <a href="#/types">ยืนยัน</a></div></div>` : ""}
      ${absRuns().some(x => !x.done) ? `<div class="notice gold">${I.warn}<div><b>วันขาดงานใน TigerSoft ที่ยังไม่ได้ตรวจ ${absRuns().filter(x => !x.done).length} ช่วง</b>${paperMonths().length ? ` — เดือน ${paperMonths().map(ymTH).join(", ")} ไม่มีใบลาใน TigerSoft (ใช้ใบลากระดาษ) วันที่ลาจริงจึงขึ้นเป็นขาดงาน` : ""} — <a href="#/absent">ตรวจ</a></div></div>` : ""}
      ${a.notReg.length ? `<div class="notice">${I.info}<div>ในไฟล์เวลามี ${a.notReg.length} รหัสที่ไม่อยู่ในทะเบียนพนักงาน (เช่น ${a.notReg.slice(0, 4).map(esc).join(", ")}) — ไม่นำมาคิดโบนัส</div></div>` : ""}</div></div>` : ""}
    <div class="two">
      <div class="card"><div class="card-h"><div><div class="card-t">วันลา/ขาดทั้งบริษัท</div><div class="card-s">ผู้มีสิทธิ์ · ในช่วงเก็บสถิติ · สีตามน้ำหนักการหัก</div></div><a class="btn btn-sm" href="#/leave">ดูรายคน</a></div>
        <div class="card-b">${ks.map(k => `<div class="lbar c-${k.cls}"><div class="k">${esc(k.kind)}</div><div class="t"><i style="width:${k.days / kmax * 100}%"></i></div><div class="n">${num(k.days)}</div></div>`).join("") || `<div class="empty">ยังไม่มีข้อมูลการลา</div>`}
          <div class="cal-leg">${["full", "half", "sick", "none"].map(c => `<span class="c-${c}"><span class="kchip"><i></i>${CLS_SHORT[c][0]}</span></span>`).join("")}</div></div></div>
      <div class="card"><div class="card-h"><div><div class="card-t">ถูกปรับลดมากที่สุด</div><div class="card-s">วันที่ถูกหักตามประกาศ (ไม่รวมระดับ M)</div></div><a class="btn btn-sm" href="#/people" data-f="cut">ทั้งหมด</a></div>
        <div class="tbl-wrap"><table class="tbl"><tbody>${ok.filter(r => r.ded.total > 0).sort((x, y) => y.ded.total - x.ded.total).slice(0, 8).map(r => `<tr class="click" data-open="${esc(r.code)}"><td>${who(r.code)}</td>
          <td>${r.ded.lines.filter(l => l.ded).slice(0, 2).map(l => kchip(l.kind, ` ${num(l.ded)}`)).join(" ")}</td><td class="r"><b>${num(r.ded.total)}</b> <span class="muted small">วัน</span></td></tr>`).join("") || `<tr><td class="empty">ไม่มีใครถูกปรับลด</td></tr>`}</tbody></table></div></div>
    </div>`);
  $("#bXl") && ($("#bXl").onclick = exportPay);
  document.querySelectorAll("[data-f]").forEach(x => x.onclick = () => { S.f = x.dataset.f; });
}

// ---------------------------------------------------------------- รายคน
function filtered() {
  const q = S.q.trim().toLowerCase();
  return S.R.rows.filter(r => {
    if (S.f === "cut" && !(r.ok && r.ded.total > 0)) return false;
    if (S.f === "no" && (r.ok || r.worked === 0)) return false;
    if (S.f === "m" && !r.M) return false;
    if (S.f === "ovr" && !r.override) return false;
    if (S.dept && r.emp.department !== S.dept) return false;
    if (q && !`${r.code} ${nameOf(r.code)} ${r.emp.department || ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}
function people() {
  const money = S.D.can_money, rows = filtered();
  const depts = [...new Set(S.R.rows.map(r => r.emp.department).filter(Boolean))].sort();
  const n = { all: S.R.rows.length, cut: S.R.rows.filter(r => r.ok && r.ded.total > 0).length, no: S.R.rows.filter(r => !r.ok && r.worked > 0).length, m: S.R.rows.filter(r => r.M).length, ovr: S.R.rows.filter(r => r.override).length };
  render(`${head("รายคน", "วันที่มีสิทธิ และยอดโบนัส", "กดชื่อเพื่อดูปฏิทินเวลา รายละเอียดการปรับลด และบันทึกใบลา", money ? `<button class="btn" id="bXl">${I.dl}Excel สำหรับ Payroll</button>` : "")}
    <div class="card"><div class="card-h"><div class="seg" id="seg">${[["all", "ทั้งหมด"], ["cut", "ถูกปรับลด"], ["no", "ไม่มีสิทธิ์"], ["m", "ระดับ M"], ["ovr", "HR กำหนดเอง"]].map(([k, l]) => `<button data-s="${k}" class="${S.f === k ? "on" : ""}">${l} ${n[k]}</button>`).join("")}</div>
      <div class="fx-actions"><select class="inp" id="dept"><option value="">ทุกแผนก</option>${depts.map(d => `<option ${S.dept === d ? "selected" : ""}>${esc(d)}</option>`).join("")}</select>
        <div class="search">${I.search}<input class="inp" id="q" placeholder="ค้นหารหัส / ชื่อ" value="${esc(S.q)}"></div></div></div>
      <div class="tbl-wrap tall"><table class="tbl"><thead><tr><th>พนักงาน</th><th>ระดับ</th><th>เริ่มงาน</th><th class="r">วันทำงาน</th><th>การปรับลด</th><th class="r">หัก (วัน)</th><th class="r">มีสิทธิ (วัน)</th>
        ${money ? `<th class="r">โบนัส</th><th class="r">เงินพิเศษ</th><th class="r">จัดสรร</th><th class="r">รวม</th>` : ""}</tr></thead><tbody>
      ${rows.slice(0, 600).map(r => `<tr class="click" data-open="${esc(r.code)}"><td>${who(r.code)}</td><td>${esc(r.emp.job_level || "-")}</td><td class="small">${dTH(String(r.emp.join_date || "").slice(0, 10))}</td>
        <td class="r">${r.worked}</td>
        <td>${!r.ok ? `<span class="chip chip-red">ไม่มีสิทธิ์</span> <span class="small muted">${esc(r.why[0] || "")}</span>` : r.M ? `<span class="chip chip-blue">M ไม่ปรับลด</span>` : r.ded.lines.filter(l => l.ded).slice(0, 3).map(l => kchip(l.kind, ` ${num(l.ded)}`)).join(" ") || `<span class="chip chip-em">ไม่ถูกปรับลด</span>`}${r.override ? ` <span class="chip chip-gold">HR กำหนด</span>` : ""}</td>
        <td class="r ${r.ded.total ? "neg" : "muted"}">${r.ok ? num(r.ded.total) : "-"}</td><td class="r"><b>${r.ok ? num(r.eligibleDays) : "-"}</b></td>
        ${money ? `<td class="r money">${r.ok && r.m ? baht(r.m.bonus) : "-"}</td><td class="r money">${r.ok && r.m ? baht(r.m.special) : "-"}</td><td class="r money">${r.alloc ? baht(r.alloc) : "-"}</td><td class="r money"><b>${r.ok && r.m ? baht(r.total) : "-"}</b></td>` : ""}</tr>`).join("") || `<tr><td colspan="11" class="empty">ไม่พบ</td></tr>`}
      </tbody></table></div><div class="card-b small muted">${rows.length} คน${rows.length > 600 ? " (แสดง 600 แรก — ค้นหาเพื่อจำกัด)" : ""}${money && rows.length ? ` · รวมจ่าย ${baht(rows.reduce((t, r) => t + r.total, 0))} บาท` : ""}</div></div>`);
  $("#seg").onclick = e => { const b = e.target.closest("button"); if (!b) return; S.f = b.dataset.s; people(); };
  $("#dept").onchange = e => { S.dept = e.target.value; people(); };
  const q = $("#q"); q.oninput = () => { S.q = q.value; clearTimeout(q._t); q._t = setTimeout(() => { people(); const n = $("#q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  $("#bXl") && ($("#bXl").onclick = exportPay);
}

// ---------------------------------------------------------------- ลิ้นชักรายคน
async function drawer(code) {
  S.open = code;
  const r = S.RB.get(code), e = S.E.get(code) || {}, money = S.D.can_money, w = S.D.can_write;
  if (!r) { toast("ไม่อยู่ในทะเบียนพนักงานปีนี้", "error"); return; }
  const lt = S.late.get(code) || { late_n: 0, late_min: 0, early_n: 0, early_min: 0 };
  const adj = S.D.adj.filter(a => a.emp_code === code), ov = (S.D.ovr || {})[code];
  $("#fxDrawer").innerHTML = `<div class="dr-bg" data-x></div><div class="dr">
    <div class="dr-h"><button class="x" data-x>×</button><div class="t">${esc(nameOf(code))}</div>
      <div class="s">${esc(code)} · ${esc(e.department || "")} · ${esc(e.position || "")} · ระดับ ${esc(e.job_level || "-")} · เริ่มงาน ${dTH(String(e.join_date || "").slice(0, 10))}${e.end_date ? ` · พ้นสภาพ ${dTH(e.end_date.slice(0, 10))}` : ""}</div>
      <div class="dr-stats"><div><span>วันทำงานในปี</span><b>${r.worked}</b></div><div><span>ถูกปรับลด</span><b>${num(r.ded.total)}</b></div><div><span>วันที่มีสิทธิ</span><b>${r.ok ? num(r.eligibleDays) : "—"}</b></div>
        <div><span>${money ? "รวมได้รับ" : "สาย / ออกก่อน"}</span><b>${money ? (r.ok && r.m ? baht(r.total) : "—") : `${lt.late_n} / ${lt.early_n} ครั้ง`}</b></div></div></div>
    <div class="dr-b">
      <div class="why ${r.ok ? "ok" : ""}">${r.ok ? `✓ มีสิทธิ์ได้รับโบนัสและเงินพิเศษ${r.M ? " · ระดับ M ไม่อยู่ใต้การปรับลด และไม่ได้เงินจัดสรรพิเศษ" : ""}` : `✕ ไม่มีสิทธิ์: ${r.why.map(esc).join(" · ")}`}
        ${ov ? `<div class="small" style="margin-top:4px">HR กำหนดเอง โดย ${esc(ov.by || "")}: ${esc(ov.note || "")}</div>` : ""}</div>
      ${w ? `<div class="small" style="margin:8px 2px 0">${ov ? `<a href="#" data-ov="">กลับไปใช้ผลของระบบ</a>` : r.ok ? `<a href="#" data-ov="no">กำหนดว่าไม่มีสิทธิ์…</a>` : `<a href="#" data-ov="yes">กำหนดว่ามีสิทธิ์…</a>`}</div>` : ""}
      <div class="card mt"><div class="card-h"><div><div class="card-t">การปรับลด</div><div class="card-s">ช่วงเก็บสถิติ ${dTH(S.P.stat_from)} – ${dTH(S.P.stat_to)}${r.ded.exempt ? " · ระดับ M ไม่ถูกหัก (แสดงเป็นสถิติ)" : ""}</div></div></div>
        <div class="card-b" style="padding-top:4px">${r.ded.lines.map(l => `<div class="dl"><div>${kchip(l.kind)} <span class="small muted">${num(l.days)} วัน${l.items.some(i => i.src === "hr") ? " · มีใบลา HR" : ""}</span></div>
            <div class="v ${l.ded ? "neg" : ""}">${l.ded ? "−" + num(l.ded) : "0"}</div><div class="x">${esc(B.explain(l))}</div></div>`).join("") || `<div class="empty" style="padding:16px">ไม่มีการลา/ขาดในช่วงเก็บสถิติ</div>`}
          <div class="sumline"><span>วันที่มีสิทธิ = ${r.worked} − ${num(r.ded.total)}</span><b>${num(r.eligibleDays)} วัน</b></div>
          ${money && r.m ? `<div class="small" style="margin-top:12px;line-height:1.9">
            โบนัส = ${baht(S.D.salary?.[code])} × ${S.P.mult} × ${num(r.eligibleDays)} ÷ 365 = <b>${baht(r.m.bonus)}</b><br>
            เงินพิเศษ = ${baht(S.P.special)} × ${num(r.eligibleDays)} ÷ 365 = <b>${baht(r.m.special)}</b><br>
            ${r.m.cut ? `ยอดที่ถูกปรับลด ${baht(r.m.cut)} → เข้ากองเงินจัดสรรพิเศษ<br>` : ""}เงินจัดสรรพิเศษ = <b>${baht(r.alloc)}</b>${r.M ? " (M ไม่ได้รับ)" : ""} · <b>รวม ${baht(r.total)}</b></div>` : ""}
          <div class="small muted" style="margin-top:10px">สาย ${lt.late_n} ครั้ง (${hmin(lt.late_min)} ชม.) · ออกก่อน ${lt.early_n} ครั้ง (${hmin(lt.early_min)} ชม.) — ไม่นำมาหัก</div></div></div>
      <div class="card mt"><div class="card-h"><div><div class="card-t">ใบลาที่ HR บันทึก</div><div class="card-s">ใบลากระดาษ หรือแก้ข้อมูล TigerSoft — ช่วงวันที่นี้ใช้ข้อมูลนี้แทน TigerSoft</div></div>
        ${w ? `<button class="btn btn-sm btn-p" id="adjAdd">${I.plus}บันทึกใบลา</button>` : ""}</div>
        <div class="card-b" style="padding-top:4px">${adj.map(a => `<div class="adj-i"><div class="w">${kchip(a.kind)} <b>${num(a.days)} วัน</b> <span class="small muted">${dTH(a.d_from.slice(0, 10))}${a.d_to.slice(0, 10) !== a.d_from.slice(0, 10) ? " – " + dTH(a.d_to.slice(0, 10)) : ""}</span>
            ${a.note ? `<div class="small">${esc(a.note)}</div>` : ""}<div class="small muted">${esc(a.by_name || "")} · ${dTH(String(a.at || "").slice(0, 10))}</div></div>
            ${w ? `<button class="btn btn-sm" data-ae="${a.id}">แก้</button><button class="btn btn-sm btn-ghost" data-ad="${a.id}">ลบ</button>` : ""}</div>`).join("") || `<div class="muted small" style="padding:10px 0">ยังไม่มี</div>`}</div></div>
      <div class="card mt"><div class="card-h"><div><div class="card-t">${I.cal}ปฏิทินเวลา ${S.year + 543}</div><div class="card-s">จาก TigerSoft · กดชื่อเดือนเพื่อดูรายวัน · จุดทอง = สาย/ออกก่อน · กรอบเข้ม = มีใบลา HR</div></div></div>
        <div class="card-b" id="drCal"><div class="muted">กำลังโหลด…</div></div></div>
      <div id="drLog"></div>
    </div></div>`;
  const D = $("#fxDrawer");
  D.querySelectorAll("[data-x]").forEach(x => x.onclick = () => { D.innerHTML = ""; S.open = null; });
  $("#adjAdd") && ($("#adjAdd").onclick = () => adjForm(code));
  D.querySelectorAll("[data-ae]").forEach(b => b.onclick = () => adjForm(code, S.D.adj.find(a => String(a.id) === b.dataset.ae)));
  D.querySelectorAll("[data-ad]").forEach(b => b.onclick = async () => { if (!confirm("ลบใบลานี้?")) return; try { await rpc("bonus_adj_delete", { p_id: +b.dataset.ad }); toast("ลบแล้ว", "success"); await reload(); } catch (err) { toast(err.message, "error"); } });
  D.querySelectorAll("[data-ov]").forEach(b => b.onclick = ev => { ev.preventDefault(); override(code, b.dataset.ov); });
  const cal = await rpc("bonus_cal", { p_emp_code: code, p_year: S.year }).catch(err => { $("#drCal").innerHTML = esc(err.message); return null; });
  if (cal && S.open === code) drawCal(code, cal, adj);
  const { data: log } = await supabase.rpc("bonus_log", { p_emp_code: code });
  if (S.open === code && log?.length) $("#drLog").innerHTML = `<div class="card mt"><div class="card-h"><div class="card-t">ประวัติ</div></div><div class="card-b" style="padding-top:4px">${log.map(x => `<div class="log-i"><span class="d"></span><div><div class="small muted">${dTH(x.at.slice(0, 10))} ${x.at.slice(11, 16)} · ${esc(x.by_name || "")}</div>${esc(x.detail || x.action)}</div></div>`).join("")}</div></div>`;
}
// day = [dd, shift, dayType, in, out, lateMin, earlyMin, kind, days, note]
function drawCal(code, cal, adj) {
  // ช่วงที่ HR บันทึก ใช้แทนข้อมูล TigerSoft (เหมือนตอนคำนวณ) — สีของวันจึงตามรายการ HR ไม่ใช่ "ขาดงาน" เดิม
  const by = new Map(cal.map(c => [c.ym, c.days])), adjOf = d => adj.find(a => d >= a.d_from.slice(0, 10) && d <= a.d_to.slice(0, 10));
  const dayCls = (x, a) => { const hol = /^HD/i.test(x[2]) ? "hd" : /^H/i.test(x[2]) ? "h" : "";
    if (a) return a.kind === B.WORKED ? (hol || "w") : hol && !x[7] ? hol : `ev c-${B.classOf(a.kind, S.D.types)}`;
    return x[7] ? `ev c-${B.classOf(x[7], S.D.types)}` : hol || ((x[3] || x[4]) ? "w" : ""); };
  const cell = (ym, i) => {
    const days = by.get(ym), dd = String(i + 1).padStart(2, "0"), date = `${ym}-${dd}`;
    const [y, m] = ym.split("-").map(Number); if (i + 1 > new Date(Date.UTC(y, m, 0)).getUTCDate()) return `<div class="cd x"></div>`;
    const x = days?.find(z => z[0] === dd);
    const a = adjOf(date), ad = a ? " adj" : "";
    if (!x) return `<div class="cd${ad}" title="${dS(date)} — ไม่มีข้อมูล"></div>`;
    const cls = " " + dayCls(x, a);
    const tip = `${dS(date)} ${x[1]} ${x[2]}${x[3] ? " เข้า " + x[3] : ""}${x[4] ? " ออก " + x[4] : ""}${x[5] ? " สาย " + x[5] + " น." : ""}${x[6] ? " ออกก่อน " + x[6] + " น." : ""}${x[7] ? ` · ${x[7]} ${x[8]} วัน` : ""}${x[9] ? " · " + x[9] : ""}${a ? ` · HR: ${a.kind}` : ""}`;
    return `<div class="cd${cls}${x[5] || x[6] ? " late" : ""}${ad}" title="${esc(tip)}"></div>`;
  };
  $("#drCal").innerHTML = `<div class="cal"><div class="cal-h"><span></span>${Array.from({ length: 31 }, (_, i) => `<span>${i % 5 === 0 ? i + 1 : ""}</span>`).join("")}</div>
    ${yms().map(ym => `<div class="cal-r"><div class="m" data-m="${ym}">${TH_M[+ym.slice(5) - 1]}${by.has(ym) ? "" : " ·"}</div>${Array.from({ length: 31 }, (_, i) => cell(ym, i)).join("")}</div>`).join("")}</div>
    <div class="cal-leg"><span><i class="cd w"></i>มาทำงาน</span><span><i class="cd h"></i>วันหยุด</span><span><i class="cd hd"></i>วันหยุดประเพณี</span>
      ${["full", "half", "sick", "none"].map(c => `<span><i class="cd ev c-${c}"></i>${CLS_SHORT[c][0]}</span>`).join("")}<span><i class="cd"></i>ไม่มีข้อมูล</span></div>
    <div id="calDay"></div>`;
  $("#drCal").querySelectorAll("[data-m]").forEach(b => b.onclick = () => {
    const ym = b.dataset.m, days = by.get(ym) || [];
    $("#calDay").innerHTML = `<div class="card mt"><div class="card-h"><div class="card-t">${ymTH(ym)}</div><button class="btn btn-sm btn-ghost" id="calX">ปิด</button></div>
      <div class="tbl-wrap" style="max-height:420px"><table class="tbl dtbl"><thead><tr><th>วันที่</th><th>กะ</th><th>เข้า</th><th>ออก</th><th class="r">สาย</th><th class="r">ออกก่อน</th><th>ลา/ขาด</th><th>หมายเหตุ</th></tr></thead><tbody>
      ${days.map(x => { const a = adjOf(`${ym}-${x[0]}`); return `<tr class="${dayCls(x, a)}"><td>${+x[0]}</td><td>${esc(x[1])} <span class="muted small">${esc(x[2])}</span></td><td>${esc(x[3])}</td><td>${esc(x[4])}</td>
        <td class="r">${x[5] || ""}</td><td class="r">${x[6] || ""}</td><td>${a ? `${kchip(a.kind)} <span class="small muted">HR</span>${x[7] ? `<div class="small muted"><s>${esc(x[7])} ${num(x[8])}</s></div>` : ""}` : x[7] ? kchip(x[7], ` ${num(x[8])}`) : ""}</td><td class="small">${esc(x[9])}</td></tr>`; }).join("") || `<tr><td colspan="8" class="empty">ไม่มีข้อมูลเดือนนี้</td></tr>`}</tbody></table></div></div>`;
    $("#calX").onclick = () => { $("#calDay").innerHTML = ""; };
    $("#calDay").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}
function modal(title, body, okText, onOk) {
  const m = document.createElement("div"); m.className = "modal-bg";
  m.innerHTML = `<div class="modal"><div class="mh">${title}</div><div class="mb">${body}</div><div class="mf"><button class="btn" data-c>ยกเลิก</button><button class="btn btn-p" data-ok>${okText}</button></div></div>`;
  document.body.appendChild(m);
  m.querySelector("[data-c]").onclick = () => m.remove();
  m.querySelector("[data-ok]").onclick = async () => { const b = m.querySelector("[data-ok]"); b.disabled = true; try { if (await onOk(m) !== false) m.remove(); } finally { b.disabled = false; } };
  return m;
}
function adjForm(code, a = null, pre = null) {
  const kinds = [...new Set([B.WORKED, "ลาป่วย", "ลากิจ", "ลาพักร้อน", "ลาหยุดชดเชย", "ขาดงาน", "พักงาน", "ลาไม่รับค่าจ้าง", "ลาคลอด", "ลาเพื่อช่วยเหลือคู่สมรสในการคลอดบุตร", "ลาอุปสมบท", "ลาฌาปนกิจ", B.WORK_INJURY, "ลารับราชการทหาร", "ลาทำหมัน", ...kindsSeen().map(k => k.kind)])];
  const m = modal(`${a ? "แก้" : "บันทึก"}ใบลา · ${esc(nameOf(code))}`, `
    <div class="grid-f"><label class="fld"><span>ตั้งแต่</span><input class="inp" type="date" data-a="d_from" value="${a ? a.d_from.slice(0, 10) : pre?.d_from || ""}"></label>
      <label class="fld"><span>ถึง</span><input class="inp" type="date" data-a="d_to" value="${a ? a.d_to.slice(0, 10) : pre?.d_to || ""}"></label>
      <label class="fld"><span>จำนวนวันที่ลา</span><input class="inp" type="number" step="0.25" min="0" data-a="days" value="${a ? +a.days : pre?.days || ""}"></label></div>
    <label class="fld"><span>ประเภทการลา</span><input class="inp" list="kl" data-a="kind" value="${esc(a?.kind || "")}" placeholder="เลือกหรือพิมพ์"><datalist id="kl">${kinds.map(k => `<option value="${esc(k)}">`).join("")}</datalist></label>
    <div id="kHint" class="small muted"></div>
    <label class="fld"><span>หมายเหตุ</span><input class="inp" data-a="note" value="${esc(a?.note || pre?.note || "")}" placeholder="เช่น ใบลากระดาษ เลขที่ … / แก้จากขาดงาน — มีใบรับรองแพทย์"></label>
    <div class="notice">${I.info}<div>ข้อมูล TigerSoft ของคนนี้ในช่วงวันที่นี้จะไม่นับ ใช้ใบลานี้แทน · จำนวนวัน = วันที่ลาจริง (ไม่รวมวันหยุด) — ลาครึ่งวันใส่ 0.5</div></div>`, "บันทึก", async m => {
    const row = { emp_code: code, id: a?.id || null }; m.querySelectorAll("[data-a]").forEach(i => { row[i.dataset.a] = i.value.trim(); });
    if (!row.d_from || !row.kind || row.days === "") { toast("ใส่วันที่ ประเภท และจำนวนวัน", "error"); return false; }
    try { await rpc("bonus_adj_save", { p_row: row }); } catch (err) { toast(err.message, "error"); return false; }
    toast("บันทึกแล้ว", "success"); await reload();
  });
  const hint = () => { const k = m.querySelector("[data-a=kind]").value.trim(); m.querySelector("#kHint").innerHTML = k ? `น้ำหนัก: <span class="kchip c-${B.classOf(k, S.D.types)}"><i></i>${B.CLS[B.classOf(k, S.D.types)].th}</span>` : ""; };
  m.querySelector("[data-a=kind]").oninput = hint; hint();
  const f = m.querySelector("[data-a=d_from]"), t = m.querySelector("[data-a=d_to]"), dd = m.querySelector("[data-a=days]");
  const auto = () => { if (f.value && !t.value) t.value = f.value; if (f.value && t.value && !a && !pre && !dd.dataset.touched) dd.value = Math.max(0, B.daysBetween(f.value, t.value) + 1); };
  f.onchange = auto; t.onchange = auto; dd.oninput = () => { dd.dataset.touched = 1; };
}
function override(code, v) {
  if (v === "") { rpc("bonus_override_save", { p_year: S.year, p_emp_code: code, p_elig: null }).then(() => { toast("กลับไปใช้ผลของระบบแล้ว", "success"); reload(); }).catch(e => toast(e.message, "error")); return; }
  modal(v === "yes" ? "กำหนดว่ามีสิทธิ์" : "กำหนดว่าไม่มีสิทธิ์", `<label class="fld"><span>เหตุผล (ต้องมี)</span><input class="inp" data-r placeholder="${v === "yes" ? "เช่น วันเริ่มงานในทะเบียนผิด / ผู้บริหารอนุมัติ" : "เช่น ยื่นใบลาออกแล้ว (ยังไม่ได้บันทึกในระบบ)"}"></label>`, "บันทึก", async m => {
    const note = m.querySelector("[data-r]").value.trim(); if (!note) { toast("ใส่เหตุผล", "error"); return false; }
    try { await rpc("bonus_override_save", { p_year: S.year, p_emp_code: code, p_elig: v, p_note: note }); } catch (e) { toast(e.message, "error"); return false; }
    toast("บันทึกแล้ว", "success"); await reload();
  });
}

// ---------------------------------------------------------------- ตรวจวันขาดงาน (ช่วงที่ใบลายังเป็นกระดาษ)
// ช่วงต้นปี TigerSoft มีแค่เวลาสแกน ใบลาเป็นกระดาษ → วันที่ลาจริงขึ้นเป็น "ขาดงาน" (user 2026-11-25)
// รวมวันขาดที่ติดกัน (ห่างไม่เกิน 3 วัน เช่น คร่อมเสาร์-อาทิตย์) เป็นช่วงเดียว → HR กดว่าเป็นลาอะไร = บันทึกใบลาแทนช่วงนั้น
let _absKey = null, _abs = [];
function absRuns() {
  const key = `${S.D.events.length}|${S.D.adj.map(a => a.id).join(",")}|${S.D.months.map(m => m.ym + (m.absent_off ? 1 : 0)).join(",")}`;
  if (key === _absKey) return _abs;
  const by = new Map(), off = new Set(S.D.months.filter(m => m.absent_off).map(m => m.ym));   // เดือนที่ปิดการนับขาดงาน = ไม่ต้องตรวจ
  for (const e of S.D.events) { const d = e.d.slice(0, 10); if (e.kind !== B.ABSENT || off.has(d.slice(0, 7)) || d < S.P.stat_from || d > S.P.stat_to || !S.E.has(e.emp_code) || B.NOT_CONSIDERED.some(([f]) => f(S.E.get(e.emp_code)))) continue;   // คนที่ไม่พิจารณาโบนัสไม่ต้องตรวจ
    (by.get(e.emp_code) || by.set(e.emp_code, []).get(e.emp_code)).push({ d, days: +e.days }); }
  const out = [];
  for (const [c, list] of by) {
    list.sort((a, b) => a.d.localeCompare(b.d));
    let cur = null;
    for (const x of list) { if (cur && B.daysBetween(cur.d2, x.d) <= 3) { cur.d2 = x.d; cur.days += x.days; cur.n++; cur.ds.push(x.d); } else { cur = { c, d1: x.d, d2: x.d, days: x.days, n: 1, ds: [x.d] }; out.push(cur); } }
  }
  // ตรวจแล้ว = ทุกวันขาดในช่วงมีรายการ HR ทับ (ช่วงเดียวอาจแบ่งเป็นหลายรายการ เช่น มาทำงานบางวัน ลาป่วยบางวัน)
  for (const r of out) { const as = S.D.adj.filter(z => z.emp_code === r.c && z.d_from.slice(0, 10) <= r.d2 && z.d_to.slice(0, 10) >= r.d1);
    const left = r.ds.filter(d => !as.some(z => z.d_from.slice(0, 10) <= d && z.d_to.slice(0, 10) >= d));
    r.done = left.length ? null : as; r.part = left.length && as.length ? as : null;
    r.key = left.length ? `${r.c}|${left[0]}|${left.at(-1)}|${left.length < r.ds.length ? left.length : r.days}` : ""; }   // ปุ่มกดใช้เฉพาะวันที่ยังไม่ได้ตรวจ
  _absKey = key; _abs = out.sort((a, b) => a.d1.localeCompare(b.d1) || a.c.localeCompare(b.c));
  return _abs;
}
// เดือนที่แทบไม่มีใบลาใน TigerSoft (รายการลาน้อยกว่า 30% ของจำนวนคน · ปกติ ก.ย./ต.ค. มีราว 2 เท่าของคน) = น่าจะยังใช้ใบลากระดาษ
function paperMonths() {
  return S.D.months.filter(m => statYMs().includes(m.ym)).filter(m => {
    const lv = S.D.events.filter(e => e.d.startsWith(m.ym) && /^ลา/.test(e.kind)).length;
    return lv < Math.max(3, m.people * .3);
  }).map(m => m.ym);
}
const QUICK = ["ลาป่วย", "ลากิจ", "ลาพักร้อน", "ลาหยุดชดเชย"];
function absentPage() {
  const all = absRuns(), q = S.q.trim().toLowerCase(), pm = paperMonths();
  const show = all.filter(r => (S.abDone ? r.done : !r.done) && (!S.lm || r.d1.startsWith(S.lm)) && (!S.dept || S.E.get(r.c)?.department === S.dept) && (!q || `${r.c} ${nameOf(r.c)}`.toLowerCase().includes(q)));
  const depts = [...new Set(S.emps.map(e => e.department).filter(Boolean))].sort(), w = S.D.can_write;
  const todo = all.filter(r => !r.done).length;
  render(`${head("ตรวจข้อมูล", "ตรวจวันขาดงาน", "ช่วงที่ใบลา/ใบลงเวลายังเป็นกระดาษ TigerSoft ขึ้นเป็น “ขาดงาน” — เทียบกับกระดาษ: ลงเวลามาทำงาน กด “มาทำงาน” · ลา กดว่าเป็นลาอะไร · ไม่มีทั้งสองอย่าง กด “ขาดจริง”")}
    ${pm.length ? `<div class="notice gold">${I.info}<div>เดือนที่แทบไม่มีใบลาใน TigerSoft: <b>${pm.map(ymTH).join(", ")}</b> — น่าจะยังใช้ใบลากระดาษ ช่วงนี้ต้องตรวจวันขาดงานทุกวัน</div></div>` : ""}
    <div class="card mt"><div class="card-h"><div class="seg" id="abSeg"><button data-v="0" class="${S.abDone ? "" : "on"}">ยังไม่ตรวจ ${todo}</button><button data-v="1" class="${S.abDone ? "on" : ""}">ตรวจแล้ว ${all.length - todo}</button></div>
      <div class="fx-actions"><select class="inp" id="lm"><option value="">ทุกเดือน</option>${statYMs().map(m => `<option value="${m}" ${S.lm === m ? "selected" : ""}>${ymTH(m)}${pm.includes(m) ? " · กระดาษ" : ""}</option>`).join("")}</select>
        <select class="inp" id="dept"><option value="">ทุกแผนก</option>${depts.map(d => `<option ${S.dept === d ? "selected" : ""}>${esc(d)}</option>`).join("")}</select>
        <div class="search">${I.search}<input class="inp" id="q" placeholder="ค้นหารหัส / ชื่อ" value="${esc(S.q)}"></div></div></div>
      <div class="tbl-wrap tall"><table class="tbl"><thead><tr><th>พนักงาน</th><th>ช่วงวันที่</th><th class="r">วัน</th><th>${S.abDone ? "ผลการตรวจ" : "เป็นลาอะไร"}</th></tr></thead><tbody>
      ${show.slice(0, 300).map(r => `<tr><td class="click" data-open="${esc(r.c)}" style="cursor:pointer">${who(r.c)}</td>
        <td><b>${dTH(r.d1)}</b>${r.d2 !== r.d1 ? ` – ${dTH(r.d2)}` : ""}<div class="small muted">${r.n} วันที่ขาดใน TigerSoft</div></td><td class="r"><b>${num(r.days)}</b></td>
        <td>${r.done ? r.done.map(a => `<div>${kchip(a.kind, ` ${num(a.days)} วัน`)}${r.done.length > 1 ? ` <span class="small muted">${dTH(a.d_from.slice(0, 10))}${a.d_to.slice(0, 10) !== a.d_from.slice(0, 10) ? `–${dTH(a.d_to.slice(0, 10))}` : ""}</span>` : ""} <span class="small muted">${esc(a.by_name || "")}</span>${w ? ` <button class="btn btn-sm btn-ghost" data-undo="${a.id}">เลิกทำ</button>` : ""}</div>`).join("")
          : w ? `${r.part ? `<div class="small muted">ตรวจแล้วบางวัน: ${r.part.map(a => esc(a.kind.replace(/ \(.*\)$/, "")) + " " + dTH(a.d_from.slice(0, 10))).join(", ")} · ที่เหลือ:</div>` : ""}<div class="fx-actions"><button class="btn btn-sm btn-g" data-q="${esc(B.WORKED)}" data-r="${esc(r.key)}" title="มีใบลงเวลากระดาษ — วันนั้นมาทำงาน ไม่นับขาด">✓ มาทำงาน</button>${QUICK.map(k => `<button class="btn btn-sm" data-q="${esc(k)}" data-r="${esc(r.key)}">${esc(k.replace(/^ลา/, ""))}</button>`).join("")}
            <button class="btn btn-sm" data-more="${esc(r.key)}">อื่น ๆ…</button><button class="btn btn-sm btn-ghost neg" data-q="${B.ABSENT}" data-r="${esc(r.key)}">ขาดจริง</button></div>` : `<span class="muted small">ยังไม่ตรวจ</span>`}</td></tr>`).join("")
        || `<tr><td colspan="4" class="empty">${S.abDone ? "ยังไม่มีที่ตรวจแล้ว" : "ไม่มีวันขาดงานที่ต้องตรวจ 🎉"}</td></tr>`}</tbody></table></div>
      <div class="card-b small muted">${show.length} ช่วง${show.length > 300 ? " (แสดง 300 แรก)" : ""} · ช่วง = วันขาดที่ติดกัน (ห่างไม่เกิน 3 วัน) · ถ้าในช่วงมีทั้งมาทำงาน/ลาคนละแบบ ใช้ “อื่น ๆ…” แก้วันที่ทีละส่วน หรือบันทึกในหน้ารายคน · ขาดจริง = นับหักเต็มวัน</div></div>`);
  $("#abSeg").onclick = e => { const b = e.target.closest("button"); if (!b) return; S.abDone = b.dataset.v === "1"; absentPage(); };
  $("#lm").onchange = e => { S.lm = e.target.value; absentPage(); };
  $("#dept").onchange = e => { S.dept = e.target.value; absentPage(); };
  const qi = $("#q"); qi.oninput = () => { S.q = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { absentPage(); const n = $("#q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  document.querySelectorAll("[data-q]").forEach(b => b.onclick = async () => {
    const [c, d1, d2, days] = b.dataset.r.split("|"); b.closest("td").querySelectorAll("button").forEach(x => { x.disabled = true; });
    const k = b.dataset.q, note = k === B.ABSENT ? "ตรวจแล้ว: ขาดงานจริง" : k === B.WORKED ? "ใบลงเวลากระดาษ — มาทำงาน (TigerSoft ขึ้นขาดงาน)" : "ใบลากระดาษ (TigerSoft ขึ้นขาดงาน)";
    try { await rpc("bonus_adj_save", { p_row: { emp_code: c, d_from: d1, d_to: d2, kind: k, days, note } }); await reload(false); }
    catch (err) { toast(err.message, "error"); absentPage(); }
  });
  document.querySelectorAll("[data-more]").forEach(b => b.onclick = () => { const [c, d1, d2, days] = b.dataset.more.split("|"); adjForm(c, null, { d_from: d1, d_to: d2, days, note: "ใบลากระดาษ (TigerSoft ขึ้นขาดงาน)" }); });
  document.querySelectorAll("[data-undo]").forEach(b => b.onclick = async () => { try { await rpc("bonus_adj_delete", { p_id: +b.dataset.undo }); await reload(false); } catch (err) { toast(err.message, "error"); } });
}

// ---------------------------------------------------------------- สรุปการลา
function leaveRows() {
  // วันลาต่อคนต่อประเภท — เดือนที่เลือก หรือทั้งช่วงเก็บสถิติ · ใบลา HR แทนที่ข้อมูล TigerSoft ในช่วงเดียวกัน
  const m = S.lm, lo = m ? `${m}-01` : S.P.stat_from, hi = m ? `${m}-31` : S.P.stat_to;
  const adjBy = new Map(); for (const a of S.D.adj) (adjBy.get(a.emp_code) || adjBy.set(a.emp_code, []).get(a.emp_code)).push(a);
  const cov = (c, d) => (adjBy.get(c) || []).some(a => d >= a.d_from.slice(0, 10) && d <= a.d_to.slice(0, 10));
  const P = new Map();
  const add = (c, k, v) => { const o = P.get(c) || P.set(c, {}).get(c); o[k] = (o[k] || 0) + v; };
  for (const e of S.D.events) { const d = e.d.slice(0, 10); if (d >= lo && d <= hi && !cov(e.emp_code, d)) add(e.emp_code, e.kind, +e.days); }
  for (const a of S.D.adj) { const d = a.d_from.slice(0, 10); if (d >= lo && d <= hi) add(a.emp_code, a.kind, +a.days); }
  return P;
}
function leavePage() {
  const P = leaveRows(), kinds = new Map();
  for (const o of P.values()) for (const [k, v] of Object.entries(o)) kinds.set(k, (kinds.get(k) || 0) + v);
  const ks = [...kinds.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]).filter(k => B.classOf(k, S.D.types) !== "ignore");
  const q = S.q.trim().toLowerCase();
  const rows = [...P.entries()].filter(([c]) => (!S.dept || S.E.get(c)?.department === S.dept) && (!q || `${c} ${nameOf(c)}`.toLowerCase().includes(q)))
    .map(([c, o]) => ({ c, o, t: ks.reduce((t, k) => t + (o[k] || 0), 0) })).sort((a, b) => b.t - a.t);
  const depts = [...new Set(S.emps.map(e => e.department).filter(Boolean))].sort();
  render(`${head("สรุป", "สรุปการลา", "วันลาต่อคนตามประเภท (รวมใบลาที่ HR บันทึก) · สีหัวคอลัมน์ = น้ำหนักการหักตามประกาศ", `<button class="btn" id="lXl">${I.dl}Excel</button>`)}
    <div class="card"><div class="card-h"><div class="fx-actions"><select class="inp" id="lm"><option value="">ทั้งช่วงเก็บสถิติ</option>${statYMs().map(m => `<option value="${m}" ${S.lm === m ? "selected" : ""}>${ymTH(m)}</option>`).join("")}</select>
      <select class="inp" id="dept"><option value="">ทุกแผนก</option>${depts.map(d => `<option ${S.dept === d ? "selected" : ""}>${esc(d)}</option>`).join("")}</select></div>
      <div class="search">${I.search}<input class="inp" id="q" placeholder="ค้นหารหัส / ชื่อ" value="${esc(S.q)}"></div></div>
      <div class="tbl-wrap tall"><table class="tbl mx"><thead><tr><th>พนักงาน</th>${ks.map(k => `<th class="k c-${B.classOf(k, S.D.types)}" style="color:var(--c)">${esc(k)}</th>`).join("")}<th class="r">รวม</th></tr></thead><tbody>
      ${rows.slice(0, 500).map(r => `<tr class="click" data-open="${esc(r.c)}"><td>${who(r.c)}</td>${ks.map(k => r.o[k] ? `<td class="n">${num(r.o[k])}</td>` : `<td class="z">·</td>`).join("")}<td class="r"><b>${num(r.t)}</b></td></tr>`).join("") || `<tr><td colspan="${ks.length + 2}" class="empty">ไม่มีการลาในช่วงนี้</td></tr>`}</tbody>
      <tfoot><tr><td>รวม ${rows.length} คน</td>${ks.map(k => `<td class="n">${num(rows.reduce((t, r) => t + (r.o[k] || 0), 0))}</td>`).join("")}<td class="r">${num(rows.reduce((t, r) => t + r.t, 0))}</td></tr></tfoot></table></div></div>`);
  $("#lm").onchange = e => { S.lm = e.target.value; leavePage(); };
  $("#dept").onchange = e => { S.dept = e.target.value; leavePage(); };
  const qi = $("#q"); qi.oninput = () => { S.q = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { leavePage(); const n = $("#q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  $("#lXl").onclick = () => xlsx(`สรุปการลา ${S.lm ? ymTH(S.lm) : S.year + 543}.xlsx`, [["รหัส", "ชื่อ", "แผนก", ...ks, "รวม"], ...rows.map(r => [r.c, nameOf(r.c), S.E.get(r.c)?.department || "", ...ks.map(k => r.o[k] || 0), r.t])], "สรุปการลา");
}

// ---------------------------------------------------------------- สรุปเวลา
function timePage() {
  const ms = statYMs().filter(m => S.D.months.some(x => x.ym === m)), q = S.q.trim().toLowerCase();
  const rows = [...S.late.entries()].filter(([c, o]) => (o.late_n || o.early_n) && (!S.dept || S.E.get(c)?.department === S.dept) && (!q || `${c} ${nameOf(c)}`.toLowerCase().includes(q)))
    .sort((a, b) => b[1].late_min + b[1].early_min - a[1].late_min - a[1].early_min);
  const depts = [...new Set(S.emps.map(e => e.department).filter(Boolean))].sort();
  const tot = rows.reduce((t, [, o]) => ({ ln: t.ln + o.late_n, lm: t.lm + o.late_min, en: t.en + o.early_n, em: t.em + o.early_min }), { ln: 0, lm: 0, en: 0, em: 0 });
  render(`${head("สรุป", "สรุปเวลา · สาย / ออกก่อน", "จาก TigerSoft รายเดือน · ไม่ใช้หักวันโบนัส (ประกาศไม่ได้กำหนด) — แสดงเป็นสถิติ", `<button class="btn" id="tXl">${I.dl}Excel</button>`)}
    <div class="kpis"><div class="kpi"><div class="ico ico-gold">${I.clock}</div><div><div class="kpi-l">มาสาย</div><div class="kpi-v">${tot.ln.toLocaleString()}</div><div class="kpi-d">ครั้ง · ${hmin(tot.lm)} ชม.</div></div></div>
      <div class="kpi"><div class="ico ico-blue">${I.clock}</div><div><div class="kpi-l">ออกก่อน</div><div class="kpi-v">${tot.en.toLocaleString()}</div><div class="kpi-d">ครั้ง · ${hmin(tot.em)} ชม.</div></div></div>
      <div class="kpi"><div class="ico ico-red">${I.user}</div><div><div class="kpi-l">คนที่มีสาย/ออกก่อน</div><div class="kpi-v">${rows.length}</div><div class="kpi-d">จาก ${S.late.size} คนในไฟล์</div></div></div></div>
    <div class="card mt"><div class="card-h"><select class="inp" id="dept"><option value="">ทุกแผนก</option>${depts.map(d => `<option ${S.dept === d ? "selected" : ""}>${esc(d)}</option>`).join("")}</select>
      <div class="search">${I.search}<input class="inp" id="q" placeholder="ค้นหารหัส / ชื่อ" value="${esc(S.q)}"></div></div>
      <div class="tbl-wrap tall"><table class="tbl mx"><thead><tr><th>พนักงาน</th>${ms.map(m => `<th class="r small">${TH_M[+m.slice(5) - 1]}</th>`).join("")}<th class="r">สาย</th><th class="r">ออกก่อน</th></tr></thead><tbody>
      ${rows.slice(0, 500).map(([c, o]) => `<tr class="click" data-open="${esc(c)}"><td>${who(c)}</td>${ms.map(m => { const a = o.months[m]; return a && (a.late_n || a.early_n) ? `<td class="n small">${a.late_n ? `<b>${a.late_n}</b>/${hmin(a.late_min)}` : ""}${a.early_n ? `<div class="muted">↤${a.early_n}</div>` : ""}</td>` : `<td class="z">·</td>`; }).join("")}
        <td class="r">${o.late_n} <span class="small muted">${hmin(o.late_min)}</span></td><td class="r">${o.early_n} <span class="small muted">${hmin(o.early_min)}</span></td></tr>`).join("") || `<tr><td colspan="${ms.length + 3}" class="empty">ยังไม่มีข้อมูล</td></tr>`}</tbody></table></div>
      <div class="card-b small muted">ในช่องรายเดือน: <b>ครั้ง</b>/ชม.:นาทีที่สาย · ↤ = ครั้งที่ออกก่อน</div></div>`);
  $("#dept").onchange = e => { S.dept = e.target.value; timePage(); };
  const qi = $("#q"); qi.oninput = () => { S.q = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { timePage(); const n = $("#q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  $("#tXl").onclick = () => xlsx(`สรุปเวลา ${S.year + 543}.xlsx`, [["รหัส", "ชื่อ", "แผนก", ...ms.flatMap(m => [`${ymTH(m)} สาย (ครั้ง)`, `${ymTH(m)} สาย (นาที)`, `${ymTH(m)} ออกก่อน (ครั้ง)`]), "สาย (ครั้ง)", "สาย (นาที)", "ออกก่อน (ครั้ง)", "ออกก่อน (นาที)"],
    ...rows.map(([c, o]) => [c, nameOf(c), S.E.get(c)?.department || "", ...ms.flatMap(m => { const a = o.months[m] || {}; return [a.late_n || 0, a.late_min || 0, a.early_n || 0]; }), o.late_n, o.late_min, o.early_n, o.early_min])], "สรุปเวลา");
}

// ---------------------------------------------------------------- นำเข้า
function importPage() {
  const w = S.D.can_write, imp = new Map(S.D.months.map(m => [m.ym, m]));
  render(`${head("ข้อมูล", "นำเข้าเวลา TigerSoft", "รายงาน “ข้อมูลหลังประมวล / รายงานแยกตามพนักงาน แบบที่ 1” ไฟล์ .xls ดิบจาก TigerSoft (หรือไฟล์ Cleaned ที่มีชีต Clean_Data) · เลือกได้หลายไฟล์ · นำเข้าเดือนเดิมซ้ำ = แทนที่ทั้งเดือน")}
    ${w ? `<label class="drop" id="drop"><div class="ico ico-blue">${I.up}</div><div><b>ลากไฟล์มาวาง หรือกดเลือก</b><span class="muted">อ่านในเบราว์เซอร์ ส่งขึ้นเฉพาะข้อมูลเวลา/การลารายคน</span></div><input type="file" id="file" multiple accept=".xls,.xlsx" hidden></label>` : ""}
    <div id="impPrev"></div>
    <div class="card mt"><div class="card-h"><div><div class="card-t">เดือนที่นำเข้าแล้ว · ${S.year + 543}</div><div class="card-s">ช่วงก่อนตั้งกะใน TigerSoft ระบบอาจขึ้น “ขาดงาน” ทั้งที่มาทำงาน → ปิดการนับขาดงานของเดือนนั้น แล้วบันทึกขาดงานจริงเป็นใบลารายคน</div></div></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>เดือน</th><th class="r">คน</th><th class="r">ลา/ขาด</th><th class="r">ขาดงาน (คน-วัน)</th><th>ไฟล์</th><th>นับขาดงานจากไฟล์</th>${w ? "<th></th>" : ""}</tr></thead><tbody>
      ${yms().map(m => { const x = imp.get(m); if (!x) return `<tr><td><b>${ymTH(m)}</b></td><td colspan="${w ? 6 : 5}" class="muted small">${statYMs().includes(m) ? "ยังไม่ได้นำเข้า" : "นอกช่วงเก็บสถิติ"}</td></tr>`;
        const ab = S.D.events.filter(e => e.d.startsWith(m) && (e.kind === B.ABSENT || e.kind === B.NOSCAN)), abp = new Set(ab.map(e => e.emp_code)).size;
        const rate = x.people ? abp / x.people : 0;
        return `<tr><td><b>${ymTH(m)}</b></td><td class="r">${x.people}</td><td class="r">${x.events}</td>
          <td class="r ${rate > .15 ? "neg" : ""}">${num(ab.reduce((t, e) => t + +e.days, 0))} <span class="small muted">(${abp} คน)</span>${rate > .15 && !x.absent_off ? ` <span class="chip chip-amb" title="คนขาดงานเกิน 15% — อาจยังไม่ได้ตั้งกะ">สูงผิดปกติ</span>` : ""}</td>
          <td class="small">${esc(x.file_name || "")}<div class="muted">${esc(x.saved_by_name || "")} · ${dTH(String(x.saved_at || "").slice(0, 10))}</div></td>
          <td>${w ? `<div class="seg" data-off="${m}"><button data-v="0" class="${x.absent_off ? "" : "on"}">นับ</button><button data-v="1" class="${x.absent_off ? "on" : ""}">ไม่นับ</button></div>` : x.absent_off ? "ไม่นับ" : "นับ"}</td>
          ${w ? `<td><button class="btn btn-sm btn-ghost" data-del="${m}">ลบ</button></td>` : ""}</tr>`; }).join("")}</tbody></table></div></div>`);
  if (!w) return;
  const drop = $("#drop"), file = $("#file");
  file.onchange = () => readFiles([...file.files]);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); readFiles([...e.dataTransfer.files]); };
  document.querySelectorAll("[data-off]").forEach(sg => sg.onclick = async e => { const b = e.target.closest("button"); if (!b) return;
    try { await rpc("bonus_month_off", { p_ym: sg.dataset.off, p_off: b.dataset.v === "1" }); toast("บันทึกแล้ว", "success"); await reload(false); } catch (err) { toast(err.message, "error"); } });
  document.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { if (!confirm(`ลบข้อมูลเวลา ${ymTH(b.dataset.del)} ทั้งเดือน?`)) return;
    try { await rpc("bonus_month_delete", { p_ym: b.dataset.del }); toast("ลบแล้ว", "success"); await reload(false); } catch (err) { toast(err.message, "error"); } });
  if (S.imp) drawImp();
}
async function readFiles(files) {
  if (!files.length) return;
  $("#impPrev").innerHTML = `<div class="card mt card-b">กำลังอ่าน ${files.length} ไฟล์…</div>`;
  const got = new Map(), errs = [];
  for (const f of files) {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: false });
      const sh = wb.Sheets.Clean_Data || wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sh, { header: 1, raw: true, defval: null });
      for (const [ym, ps] of B.readTime(rows)) { const o = got.get(ym) || got.set(ym, { ym, files: [], people: new Map() }).get(ym); o.files.push(f.name); for (const p of ps) o.people.set(p.code, p); }
    } catch (e) { errs.push(`${f.name}: ${e.message}`); }
  }
  S.imp = { months: [...got.values()].sort((a, b) => a.ym.localeCompare(b.ym)), errs };
  drawImp();
}
function drawImp() {
  const { months, errs } = S.imp, have = new Set(S.D.months.map(m => m.ym));
  $("#impPrev").innerHTML = `<div class="card mt"><div class="card-h"><div><div class="card-t">ตรวจก่อนบันทึก</div><div class="card-s">${months.length} เดือน</div></div>
      <div class="fx-actions"><button class="btn" id="impX">ยกเลิก</button>${months.length ? `<button class="btn btn-p" id="impGo">${I.save}บันทึก ${months.length} เดือน</button>` : ""}</div></div>
    ${errs.map(e => `<div class="card-b neg small">${esc(e)}</div>`).join("")}
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>เดือน</th><th class="r">คน</th><th class="r">ไม่อยู่ในทะเบียน</th><th class="r">สาย (ครั้ง)</th><th>ลา/ขาด ที่พบ (วัน)</th></tr></thead><tbody>
    ${months.map(m => { const ps = [...m.people.values()], k = new Map(); for (const p of ps) for (const e of p.events) k.set(e.kind, (k.get(e.kind) || 0) + e.days);
      const out = ps.filter(p => !S.E.has(p.code)).length;
      return `<tr><td><b>${ymTH(m.ym)}</b>${have.has(m.ym) ? ` <span class="chip chip-amb">แทนที่ของเดิม</span>` : ""}${m.ym < S.P.stat_from.slice(0, 7) || m.ym > S.P.stat_to.slice(0, 7) ? ` <span class="chip chip-gray">นอกช่วงเก็บสถิติ</span>` : ""}<div class="small muted">${m.files.map(esc).join(", ")}</div></td>
        <td class="r">${ps.length}</td><td class="r ${out ? "muted" : ""}">${out || "-"}</td><td class="r">${ps.reduce((t, p) => t + p.agg.late_n, 0)}</td>
        <td><div class="prev-k">${[...k.entries()].sort((a, b) => b[1] - a[1]).map(([kk, v]) => kchip(kk, ` ${num(v)}${S.D.types[kk] ? "" : " · ใหม่"}`)).join("")}</div></td></tr>`; }).join("")}</tbody></table></div></div>`;
  $("#impX").onclick = () => { S.imp = null; $("#impPrev").innerHTML = ""; };
  $("#impGo") && ($("#impGo").onclick = async () => {
    const b = $("#impGo"); b.disabled = true;
    try {
      // ส่งทีละ 60 คน (ไฟล์ทั้งเดือนใหญ่เกินจะส่งก้อนเดียว) · ชุดแรกล้างเดือนนั้น ชุดสุดท้ายสรุปจำนวน
      for (const m of months) {
        const ps = [...m.people.values()].map(p => ({ code: p.code, name: p.name, cal: p.cal, agg: p.agg, events: p.events }));
        for (let i = 0; i < ps.length; i += 60) {
          b.textContent = `กำลังบันทึก ${ymTH(m.ym)} ${Math.min(i + 60, ps.length)}/${ps.length}…`;
          await rpc("bonus_month_save", { p_ym: m.ym, p_file: m.files.join(", "), p_rows: ps.slice(i, i + 60), p_first: i === 0, p_last: i + 60 >= ps.length });
        }
      }
      toast(`บันทึก ${months.length} เดือนแล้ว`, "success"); S.imp = null; await reload(false);
      if (unconfirmed().length) location.hash = "#/types";
    } catch (e) { toast(e.message, "error"); b.disabled = false; b.textContent = "ลองอีกครั้ง"; }
  });
}

// ---------------------------------------------------------------- ประเภทการลา
// ช่วงการลาของประเภทหนึ่ง รายคน (วันติดกัน ห่างไม่เกิน 3 วัน = ช่วงเดียว) + ใบลา HR ที่ครอบช่วงนั้น — ใช้รีเช็คในหน้าประเภทการลา
function kindRuns(kind) {
  const by = new Map();
  for (const e of S.D.events) if (e.kind === kind) (by.get(e.emp_code) || by.set(e.emp_code, []).get(e.emp_code)).push({ d: e.d.slice(0, 10), days: +e.days });
  const out = [];
  for (const [c, list] of by) {
    list.sort((a, b) => a.d.localeCompare(b.d)); let cur = null;
    for (const x of list) { if (cur && B.daysBetween(cur.d2, x.d) <= 3) { cur.d2 = x.d; cur.days += x.days; } else { cur = { c, d1: x.d, d2: x.d, days: x.days }; out.push(cur); } }
  }
  for (const r of out) r.adj = S.D.adj.find(z => z.emp_code === r.c && z.d_from.slice(0, 10) <= r.d1 && z.d_to.slice(0, 10) >= r.d2) || null;
  if (!by.size) for (const a of S.D.adj.filter(z => z.kind === kind)) out.push({ c: a.emp_code, d1: a.d_from.slice(0, 10), d2: a.d_to.slice(0, 10), days: +a.days, adj: a, own: true });
  return out.sort((a, b) => a.d1.localeCompare(b.d1));
}
function typesPage() {
  const ks = kindsSeen(), w = S.D.can_write, unc = ks.filter(k => !S.D.types[k.kind] && !FIXED(k.kind));
  S.tyOpen ||= new Set();
  const inj = ks.filter(k => B.injuryHint(k.kind)), injTodo = inj.flatMap(k => kindRuns(k.kind)).filter(r => !r.adj).length;
  const detail = k => { const runs = kindRuns(k.kind), hint = B.injuryHint(k.kind);
    return `<tr><td colspan="4" style="background:#F8FAFD;padding:8px 14px 14px">
      ${hint ? `<div class="small" style="margin:4px 0 8px;color:var(--amber-600)">พนักงานคีย์ประเภทนี้เองใน TigerSoft — เทียบกับรายงานอุบัติเหตุ/ความปลอดภัย แล้วกด “ยืนยันเจ็บจากงาน” รายคน (ไม่หัก) · ที่ไม่ยืนยันนับเป็นลาป่วย</div>` : ""}
      <table class="tbl dtbl"><tbody>${runs.map(r => `<tr><td class="click" data-open="${esc(r.c)}" style="cursor:pointer">${who(r.c)}</td>
        <td><b>${dTH(r.d1)}</b>${r.d2 !== r.d1 ? ` – ${dTH(r.d2)}` : ""}</td><td class="r">${num(r.days)} วัน</td>
        <td>${r.adj && !r.own ? `${kchip(r.adj.kind, ` ${num(r.adj.days)}`)} <span class="small muted">${esc(r.adj.by_name || "")}</span>${w ? ` <button class="btn btn-sm btn-ghost" data-undo="${r.adj.id}">เลิกทำ</button>` : ""}`
          : hint && w ? `<button class="btn btn-sm btn-g" data-inj="${esc(r.c)}|${r.d1}|${r.d2}|${r.days}">ยืนยันเจ็บจากงาน</button>` : `<span class="small muted">${r.own ? esc(r.adj?.note || "") : "ตามข้อมูล TigerSoft"}</span>`}</td></tr>`).join("") || `<tr><td class="empty">ไม่มี</td></tr>`}</tbody></table></td></tr>`; };
  render(`${head("ข้อมูล", "ประเภทการลา · น้ำหนักการหัก", "ทุกประเภทที่พบในไฟล์ TigerSoft และใบลาที่ HR บันทึก — ตามตาราง 4.1 ของเอกสารแนบท้ายประกาศ · ประเภทที่ไม่ได้ระบุในประกาศ = หักเต็มวัน · กดชื่อประเภทเพื่อดูรายชื่อ")}
    ${injTodo ? `<div class="notice gold">${I.warn}<div><b>อาจเป็นเจ็บป่วย/อุบัติเหตุจากการทำงาน ${injTodo} ช่วงที่ยังไม่ยืนยัน</b> — ระบบนับเป็นลาป่วยไว้ก่อน (กันพนักงานคีย์ผิด) กดชื่อประเภทที่มีป้าย ⚠ แล้วยืนยันรายคน</div></div>` : ""}
    ${unc.length ? `<div class="ty-new"><div class="ic">${unc.length}</div><div class="tx"><b>ประเภทใหม่ที่ยังไม่ยืนยัน</b> — ระบบเดาน้ำหนักจากชื่อให้แล้ว (เส้นประ) กดเลือกเพื่อยืนยัน หรือกดปุ่มขวาเพื่อยืนยันตามที่เดาทั้งหมด</div>
      ${w ? `<button class="btn btn-sm btn-g" id="tyAll">ยืนยันตามที่เดาทั้งหมด</button>` : ""}</div>` : ""}
    <div class="card mt"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>ประเภท (ตามที่เขียนใน TigerSoft)</th><th class="r">วัน</th><th class="r">คน</th><th>น้ำหนัก</th></tr></thead><tbody>
    ${ks.map(k => { const cur = S.D.types[k.kind], sug = B.suggestClass(k.kind), fixed = FIXED(k.kind), open = S.tyOpen.has(k.kind);
      return `<tr><td><a href="#" data-tk="${esc(k.kind)}"><b>${open ? "▾" : "▸"} ${esc(k.kind)}</b></a>${cur || fixed ? "" : ` <span class="chip chip-gold">ใหม่</span>`}${B.injuryHint(k.kind) ? ` <span class="chip chip-amb">⚠ ตรวจรายคน</span>` : ""}</td>
        <td class="r">${num(k.days)}</td><td class="r">${k.n.size}</td>
        <td>${fixed ? `<span class="kchip c-none"><i></i>${k.kind === B.WORKED ? "ไม่ใช่การลา · มาทำงานตามใบลงเวลา" : "ไม่หัก · HR ยืนยันรายคนแล้ว"}</span>` : `<div class="tseg ${cur ? "" : "pending"}" data-k="${esc(k.kind)}" ${w ? "" : "disabled"}>${CLS_ORDER.map(c => `<button class="c-${c} ${cur === c ? "on" : ""} ${!cur && sug === c ? "sug" : ""}" data-c="${c}">${CLS_SHORT[c][0]}<small>${CLS_SHORT[c][1]}</small></button>`).join("")}</div>`}</td></tr>
        ${open ? detail(k) : ""}`; }).join("") || `<tr><td colspan="4" class="empty">ยังไม่มี — นำเข้าไฟล์เวลาก่อน</td></tr>`}
    </tbody></table></div></div>`);
  document.querySelectorAll("[data-tk]").forEach(a => a.onclick = ev => { ev.preventDefault(); const k = a.dataset.tk; S.tyOpen.has(k) ? S.tyOpen.delete(k) : S.tyOpen.add(k); typesPage(); });
  if (!w) return;
  document.querySelectorAll(".tseg[data-k]").forEach(sg => sg.onclick = async e => { const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.c === "none" && B.injuryHint(sg.dataset.k) && !confirm("ตั้งทั้งประเภทเป็น “ไม่หัก” = เชื่อทุกคนที่คีย์ประเภทนี้\nแนะนำให้ยืนยันรายคนแทน — ยังจะตั้งทั้งประเภทไหม?")) return;
    try { S.D.types = await rpc("bonus_types_save", { p_types: { [sg.dataset.k]: b.dataset.c } }); recalc(); badge(); typesPage(); } catch (err) { toast(err.message, "error"); } });
  $("#tyAll") && ($("#tyAll").onclick = async () => {
    try { S.D.types = await rpc("bonus_types_save", { p_types: Object.fromEntries(unc.map(k => [k.kind, B.suggestClass(k.kind)])) }); recalc(); badge(); typesPage(); toast("ยืนยันแล้ว", "success"); } catch (err) { toast(err.message, "error"); } });
  document.querySelectorAll("[data-inj]").forEach(b => b.onclick = () => { const [c, d1, d2, days] = b.dataset.inj.split("|");
    modal(`ยืนยันเจ็บป่วย/อุบัติเหตุจากการทำงาน · ${esc(nameOf(c))}`, `<div>${dTH(d1)}${d2 !== d1 ? " – " + dTH(d2) : ""} · ${num(+days)} วัน → <b>ไม่หัก</b></div>
      <label class="fld"><span>อ้างอิง (ต้องมี)</span><input class="inp" data-r placeholder="เช่น รายงานอุบัติเหตุ SHE เลขที่ … / ใบรับรองแพทย์ กท.16"></label>`, "ยืนยัน", async m => {
      const note = m.querySelector("[data-r]").value.trim(); if (!note) { toast("ใส่อ้างอิง", "error"); return false; }
      try { await rpc("bonus_adj_save", { p_row: { emp_code: c, d_from: d1, d_to: d2, kind: B.WORK_INJURY, days, note } }); } catch (err) { toast(err.message, "error"); return false; }
      toast("ยืนยันแล้ว", "success"); await reload(false); });
  });
  document.querySelectorAll("[data-undo]").forEach(b => b.onclick = async () => { if (!confirm("ยกเลิกการยืนยันนี้?")) return; try { await rpc("bonus_adj_delete", { p_id: +b.dataset.undo }); await reload(false); } catch (err) { toast(err.message, "error"); } });
}

// ---------------------------------------------------------------- ประกาศ / ตัวเลข
function rulesPage() {
  const P = S.P, w = S.D.can_write;
  const F = (k, l, t = "date", x = "") => `<label class="fld"><span>${l}</span><input class="inp" type="${t}" data-p="${k}" value="${esc(P[k] ?? "")}" ${w ? "" : "disabled"} ${x}></label>`;
  render(`${head("ข้อมูล", "ประกาศ · ตัวเลขที่ใช้คำนวณ", `ปี ${S.year + 543}${S.D.params ? "" : " · ยังไม่ได้บันทึก — ใช้ค่าตามประกาศ HR-152-2026"}`)}
    <div class="card"><div class="card-h"><div class="card-t">ตัวเลขตามประกาศ</div>${w ? `<button class="btn btn-p btn-sm" id="pSave">${I.save}บันทึก</button>` : ""}</div>
      <div class="card-b"><div class="grid-f">${F("doc_no", "เลขที่ประกาศ", "text")}${F("mult", "โบนัส (เท่าของเงินเดือน)", "number", 'step="0.01"')}${F("special", "เงินพิเศษ (บาท)", "number", 'step="1"')}${F("base_date", "เงินเดือน ณ วันที่")}</div>
        <div class="grid-f" style="margin-top:12px">${F("stat_from", "เก็บสถิติตั้งแต่")}${F("stat_to", "ถึง")}${F("join_by", "ต้องเริ่มงานภายใน")}${F("pay_date", "วันจ่าย")}</div>
        <div class="grid-f" style="margin-top:12px">${F("sick_free", "ลาป่วยไม่หัก (วันแรก)", "number")}${F("mat_free", "ลาคลอดไม่หัก (วันแรกต่อครั้ง)", "number")}${F("probation_days", "พ้นทดลองงานวันที่", "number")}<div></div></div></div></div>
    <div class="card mt"><div class="card-h"><div class="card-t">ตารางน้ำหนักการปรับลด (ข้อ 4.1)</div><a class="btn btn-sm" href="#/types">ประเภทที่พบในไฟล์</a></div>
      <div class="tbl-wrap"><table class="tbl rule-t"><thead><tr><th>น้ำหนัก</th><th>ประเภท</th><th>เหตุผล</th></tr></thead><tbody>
        <tr><td><span class="kchip c-full"><i></i>หัก 1 วัน ต่อ 1 วัน</span></td><td>ขาดงานโดยไม่มีเหตุอันสมควร ลากิจ ลาโดยไม่ได้รับค่าจ้าง พักงานเนื่องจากกระทำความผิดทางวินัย ลาอุปสมบท/ประกอบพิธีทางศาสนา ลาทำหมัน ลาฝึกอบรมตามความประสงค์ของพนักงาน การลาประเภทอื่นที่มิได้ระบุไว้</td><td class="small">ไม่มาปฏิบัติงานโดยเลือกเอง หรือเกิดจากความผิดของตนเอง</td></tr>
        <tr><td><span class="kchip c-half"><i></i>หัก 0.5 วัน ต่อ 1 วัน</span></td><td>ลาป่วยส่วนที่เกิน ${P.sick_free} วัน ลาคลอดส่วนที่เกิน ${P.mat_free} วัน ลาช่วยภริยาคลอด/เลี้ยงดูบุตร ลาดูแลบุตรที่เจ็บป่วยหลังคลอด ลารับราชการทหาร</td><td class="small">ไม่มาปฏิบัติงานด้วยเหตุจำเป็นที่ไม่ได้เลือกเอง</td></tr>
        <tr><td><span class="kchip c-none"><i></i>ไม่หัก</span></td><td>ลาพักผ่อนประจำปี ลาหยุดชดเชย · ลาเนื่องจากประสบอันตราย/เจ็บป่วยจากการทำงาน · ลาเพื่อจัดการงานศพ · ไปปฏิบัติงานนอกสถานที่/อบรมที่บริษัทมอบหมาย</td><td class="small">เป็นสิทธิ / ปฏิบัติงานให้บริษัท / ความสูญเสียที่คาดการณ์ไม่ได้</td></tr>
      </tbody></table></div>
      <div class="card-b small muted" style="line-height:1.8">• ลาป่วยไม่จ่ายเงิน = ลาป่วยต่อจากใช้สิทธิครบ → นับรวมเป็นลาป่วย (ใช้ ${P.sick_free} วันแรกร่วมกัน) · มาสาย/ออกก่อน ไม่นำมาหัก<br>
        • ระดับ M ไม่ถูกปรับลด และไม่ได้ส่วนแบ่งเงินจัดสรรพิเศษ (4.5, 5.4) · พักงานที่เริ่มภายใน ${dTH(P.stat_to)} และต่อเนื่องเกิน → นับทั้งหมดในรอบนี้ (2.4)<br>
        • ไม่อยู่ในการพิจารณา: สัญชาติออสเตรเลีย · รหัส DAY (ลูกจ้างรายวัน)<br>        • มีสิทธิ์: เริ่มงานภายใน ${dTH(P.join_by)} · พ้นทดลองงาน (วันที่ ${P.probation_days}) ก่อนวันจ่าย · เป็นพนักงาน ณ วันจ่าย · ยื่นลาออกแล้ว = ไม่มีสิทธิ์ · เกษียณ 1 ม.ค. ปีถัดไป = มีสิทธิ์</div></div>`);
  $("#pSave") && ($("#pSave").onclick = async () => {
    const p = {}; document.querySelectorAll("[data-p]").forEach(i => { p[i.dataset.p] = i.value; });
    try { S.D.params = await rpc("bonus_params_save", { p_year: S.year, p_params: p }); await reload(false); toast("บันทึกแล้ว", "success"); } catch (e) { toast(e.message, "error"); }
  });
}
async function logPage() {
  render(`${head("ข้อมูล", "ประวัติการแก้ไข", "นำเข้า ใบลา ประเภทการลา การกำหนดสิทธิ์")}<div class="card"><div class="card-b" id="lg">กำลังโหลด…</div></div>`);
  const { data, error } = await supabase.rpc("bonus_log", {});
  $("#lg").innerHTML = error ? esc(error.message) : (data || []).map(x => `<div class="log-i"><span class="d"></span><div><div class="small muted">${dTH(x.at.slice(0, 10))} ${x.at.slice(11, 16)} · ${esc(x.by_name || "")}${x.emp_code ? " · " + esc(x.emp_code) + " " + esc(nameOf(x.emp_code)) : ""}</div>${esc(x.detail || x.action)}</div></div>`).join("") || "ยังไม่มี";
}

// ---------------------------------------------------------------- Excel
function xlsx(name, aoa, sheet) {
  const wb = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = aoa[0].map((_, i) => ({ wch: i === 1 ? 28 : i === 2 ? 22 : 12 }));
  XLSX.utils.book_append_sheet(wb, ws, sheet); XLSX.writeFile(wb, name);
}
function exportPay() {
  const P = S.P, rows = S.R.rows.filter(r => r.worked > 0);
  const aoa = [["รหัส", "ชื่อ-สกุล", "แผนก", "ระดับ", "วันเริ่มงาน", "มีสิทธิ์", "เหตุผล", "วันทำงาน", "หัก (วัน)", "รายละเอียดการหัก", "วันที่มีสิทธิ", "เงินเดือนฐาน", "เงินโบนัส", "เงินพิเศษ", "ยอดที่ถูกปรับลด", "เงินจัดสรรพิเศษ", "รวมจ่าย"],
    ...rows.map(r => [r.code, nameOf(r.code), r.emp.department || "", r.emp.job_level || "", String(r.emp.join_date || "").slice(0, 10), r.ok ? "Y" : "N", r.why.join(" · "), r.worked, r.ok ? r.ded.total : "",
      r.ded.lines.filter(l => l.ded).map(l => `${l.kind} ${l.days} วัน → ${l.ded}`).join(" · "), r.ok ? r.eligibleDays : 0, S.D.salary?.[r.code] ?? "",
      r.ok && r.m ? r.m.bonus : 0, r.ok && r.m ? r.m.special : 0, r.ok && r.m ? r.m.cut : 0, r.alloc, r.total])];
  aoa.push([], ["", "รวม", "", "", "", `${S.R.nOk} คน`, "", "", "", "", "", "", rows.reduce((t, r) => t + (r.ok && r.m ? r.m.bonus : 0), 0), rows.reduce((t, r) => t + (r.ok && r.m ? r.m.special : 0), 0), S.R.pool, rows.reduce((t, r) => t + r.alloc, 0), rows.reduce((t, r) => t + r.total, 0)],
    ["", `เงินจัดสรรพิเศษ = ${S.R.pool} ÷ ${S.R.nShare} คน = ${S.R.per} บาท/คน (ไม่รวมระดับ M)`], ["", `โบนัส = เงินเดือน × ${P.mult} × วันที่มีสิทธิ ÷ 365 · เงินพิเศษ = ${P.special} × วันที่มีสิทธิ ÷ 365 · ปัดทศนิยม 2 ตำแหน่ง`]);
  xlsx(`โบนัส ${S.year + 543}.xlsx`, aoa, "โบนัส");
}

// ---------------------------------------------------------------- ปุ่มที่ใช้ร่วม
function wire(root) {
  root.querySelectorAll("[data-open]").forEach(a => a.onclick = ev => { if (ev.target.closest("input,button,a")) return; ev.preventDefault(); drawer(a.dataset.open); });
}

boot();
