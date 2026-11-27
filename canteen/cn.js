// ===== Akara Canteen (/canteen) — ค่าอาหารโรงอาหารคิดเป็นหัว · ใบแจ้งยอดร้านค้ารายวันส่งสหกรณ์ =====
// user 2026-11-26 · ห้าม import js/app.js · กติกา js/canteen-calc.js (เทส test/canteen.test.js) · ข้อมูล azure-app/canteen.py · ใบ canteen/doc.js
// งานประจำวัน: ลากไฟล์สแกนทุกกล่อง → คีย์ใบลงชื่อ (ลืมบัตร/ผู้ติดต่อ/รับแทนกลุ่ม) → ลงนามออกใบ → ส่งสหกรณ์ (ลิงก์เปิดดู/พิมพ์)
import { supabase } from "../js/supabase-config.js";
import * as C from "../js/canteen-calc.js";
import { noticeDoc, printNotices, namesWorkbook, DOC_CSS, dTH } from "./doc.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const WD = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const bkk = () => new Date(Date.now() + 7 * 3600e3).toISOString();
const today = () => bkk().slice(0, 10);
const addDay = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const wd = d => WD[new Date(d + "T00:00:00Z").getUTCDay()];
const money = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = n => Number(n || 0).toLocaleString("en-US");
const bkkTs = v => { const d = new Date(v); return isNaN(d) ? "" : new Date(d.getTime() + 7 * 3600e3).toISOString(); };
const tsTH = v => { const b = bkkTs(v); return b ? `${dTH(b.slice(0, 10))} ${b.slice(11, 16)}` : "-"; };
const ini = n => String(n || "?").trim().split(/\s+/).slice(0, 2).map(w => w.replace(/^[เแโใไ]/, "")[0] || "").join("").toUpperCase() || "?";
const I = {
  up: '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/></svg>',
  dl: '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  pen: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  print: '<svg viewBox="0 0 24 24"><path d="M6 9V2h12v7"/><rect x="6" y="14" width="12" height="8"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  l: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>', r: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
};
const CAT_TH = { akr: "อัครา", sub: "SUB", tem: "บัตรชั่วคราว", unk: "ไม่มีรหัส", forgot: "ลืมบัตร", visit: "ผู้ติดต่อ", group: "รับแทนกลุ่ม", carry: "ยกยอด" };
const tag = c => `<span class="tag t-${c}">${CAT_TH[c] || c}</span>`;

const S = { od: today(), B: null, perms: new Set(), d: addDay(today(), -1), D: null, ix: null, emps: [], etype: "forgot", ebox: "A1", pick: null, q: "",
            ym: today().slice(0, 7), half: +today().slice(8, 10) <= 15 ? 1 : 2 };
const can = p => S.perms.has(p);
const W = () => can("data.canteen.write");
function toast(msg, type = "") {
  const t = document.createElement("div"); t.className = "toast " + (type === "error" ? "err" : type === "success" ? "ok" : ""); t.textContent = msg;
  $("#fxToasts").appendChild(t); setTimeout(() => t.remove(), type === "error" ? 7000 : 3500);
}
const rpc = async (name, args) => { const { data, error } = await supabase.rpc(name, args); if (error) throw new Error(error.message); return data; };
const run = async (fnc, ok) => { try { const v = await fnc(); if (ok) toast(ok, "success"); return v; } catch (e) { toast(e.message, "error"); throw e; } };
const head = (eyebrow, title, sub, actions = "") => `<div class="fx-head"><div><div class="fx-eyebrow">${eyebrow}</div><div class="fx-title">${title}</div>
  <div class="fx-sub">${sub}</div></div><div class="fx-actions">${actions}</div></div>`;
const render = html => { $("#fxMain").innerHTML = html; };
function modal(title, body, okText, onOk, wide = false) {
  const m = document.createElement("div"); m.className = "modal-bg";
  m.innerHTML = `<div class="modal ${wide ? "wide" : ""}"><div class="mh">${title}</div><div class="mb">${body}</div><div class="mf"><button class="btn" data-c>${okText ? "ยกเลิก" : "ปิด"}</button>${okText ? `<button class="btn btn-p" data-ok>${okText}</button>` : ""}</div></div>`;
  document.body.appendChild(m);
  m.querySelector("[data-c]").onclick = () => m.remove();
  const ok = m.querySelector("[data-ok]");
  if (ok) ok.onclick = async () => { ok.disabled = true; try { if (await onOk(m) !== false) m.remove(); } catch (_) { /* toast แล้ว */ } finally { ok.disabled = false; } };
  return m;
}
const unitOf = box => S.B.units.find(u => u.boxes.includes(box));
const boxLabel = b => C.BOXES[b] || b;
const regName = (m) => { const p = S.ix.byCode.get(m.reg_code || m.code || ""); return p ? p.name : (m.name || ""); };

// ---------------------------------------------------------------- โหลด
async function fetchAll(q) {
  const out = [];
  for (let from = 0; ; from += 1000) { const { data, error } = await q().range(from, from + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break; }
  return out;
}
async function boot() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { render(`<div class="card card-b" style="max-width:460px;margin:60px auto;text-align:center"><div class="card-t" style="justify-content:center">กรุณาเข้าสู่ระบบ</div>
      <p class="muted">ใช้บัญชีเดียวกับระบบ HR</p><a class="btn btn-p" href="/">ไปหน้าเข้าสู่ระบบ HR</a></div>`); return; }
  const { data: perms } = await supabase.rpc("my_permissions");
  S.perms = new Set((perms || []).map(p => typeof p === "string" ? p : p.perm_key || p.key));
  const name = session.user.user_metadata?.full_name || session.user.email || "";
  $("#fxUser").innerHTML = `<div class="av">${esc(ini(name))}</div><div><b>${esc(name)}</b><span>${W() ? "ออกใบแจ้งยอด" : "ดูอย่างเดียว"}</span></div>`;
  if (!can("page.canteen")) { render(`<div class="empty">บัญชีนี้ยังไม่มีสิทธิ์ใช้ Akara Canteen — ให้ Admin เพิ่มสิทธิ์ “ค่าอาหารโรงอาหาร” ที่ User Management</div>`); return; }
  try {
    const [B, emps] = await Promise.all([rpc("cn_boot", {}),
      fetchAll(() => supabase.from("employees").select("emp_code,firstname_th,lastname_th,firstname_en,lastname_en,department,status,end_date").order("emp_code"))]);
    S.B = B;
    const people = emps.map(e => ({ code: String(e.emp_code).toUpperCase(), name: `${e.firstname_th || ""} ${e.lastname_th || ""}`.trim(),
      name_en: `${e.firstname_en || ""} ${e.lastname_en || ""}`.trim(), kind: /^SUB/i.test(e.emp_code) ? "sub" : "akr", dept: e.department,
      left: !!e.end_date && e.status !== "Active", left_on: e.end_date ? String(e.end_date).slice(0, 10) : null }))
      .concat(B.subs.map(s => ({ code: s.code, name: s.name, name_en: s.name, kind: "sub", ac: s.ac, dept: s.company, left: s.left, left_on: s.left_on })));
    S.ix = C.indexPeople(people);
  } catch (e) { render(`<div class="card card-b"><b>โหลดข้อมูลไม่สำเร็จ</b><p class="muted">${esc(e.message)}</p></div>`); return; }
  window.addEventListener("hashchange", route);
  route();
  rpc("cn_orders_span", { p_from: today(), p_to: today() }).then(c => navOrd(c.reduce((t, x) => t + x.n, 0)), () => {});
}
function route() {
  const [r, arg] = location.hash.replace(/^#\/?/, "").split("/");
  document.querySelectorAll("#fxNav a[data-r]").forEach(a => a.classList.toggle("on", a.dataset.r === (r || "day")));
  if ((r || "day") === "day" && arg && /^\d{4}-\d\d-\d\d$/.test(arg)) S.d = arg;
  if (r === "orders" && arg && /^\d{4}-\d\d-\d\d$/.test(arg)) S.od = arg;
  ({ day: dayPage, dups: dupsPage, notices: billingPage, orders: ordersPage, groups: groupsPage, settings: settingsPage, log: logPage }[r || "day"] || dayPage)();
  window.scrollTo(0, 0);
}
const navDup = n => { $("#navDup").textContent = n ? String(n) : ""; };
const navOrd = n => { $("#navOrd").textContent = n ? String(n) : ""; };

// ---------------------------------------------------------------- รายวัน
async function loadDay() { S.D = await rpc("cn_day", { p_d: S.d }); navDup(S.D.dup_open); }
function unitState(u) {
  const ms = S.D.meals.filter(m => u.boxes.includes(m.box)), carry = S.D.carry[u.key] || [];
  const signed = S.D.notices.find(n => n.unit === u.key && n.status === "signed");
  const lines = C.unitLines(ms, carry);
  return { u, ms, carry, signed, lines, days: S.D.days.filter(x => u.boxes.includes(x.box)), voided: S.D.notices.filter(n => n.unit === u.key && n.status === "void") };
}
async function dayPage() {
  render(`<div class="fx-loading">กำลังโหลด…</div>`);
  try { await loadDay(); } catch (e) { render(`<div class="card card-b">${esc(e.message)}</div>`); return; }
  const st = S.B.units.map(unitState), ready = st.filter(x => !x.signed && x.lines.meals > 0);
  const signedAll = st.filter(x => x.signed), chk = C.dayChecks(S.D.meals.filter(m => m.src === "scan" || m.src === "sheet"), S.ix, S.D.days);
  const sheet = S.D.meals.filter(m => m.src === "sheet");
  const nChk = chk.dup.length + chk.twoBox.length + chk.forgotScanned.length + chk.notReg.length + chk.left.length;
  render(`${head(`ใบแจ้งยอดรายวัน · ${wd(S.d)}`, `วันที่ทาน ${dTH(S.d)}`, "ลากไฟล์สแกนบัตรของวันนี้ทุกกล่องเข้ามาพร้อมกัน → คีย์ใบลงชื่อ → ลงนาม → ส่งสหกรณ์",
      `<div class="dnav"><button class="btn btn-sm" id="dPrev">${I.l}</button><input class="inp" type="date" id="dPick" value="${S.d}"><button class="btn btn-sm" id="dNext">${I.r}</button></div>`)}
    ${W() ? `<label class="drop" id="drop"><div class="ico ico-gold">${I.up}</div><div><b>วางไฟล์สแกนบัตร (.xlsx) ที่นี่ หรือกดเลือก</b>
      <span class="muted small">เลือกได้หลายไฟล์ หลายวัน — ระบบอ่านกล่องและวันที่จากชื่อไฟล์ เช่น “รายชื่อสแกนบัตร1 Akara 01.11.26.xlsx”</span></div>
      <input type="file" id="fileIn" accept=".xlsx,.xls" multiple hidden></label>
      <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn btn-sm" id="bFiles">${I.x}ไฟล์ที่อัปแล้ว · ลบหลายไฟล์</button></div>` : ""}
    <div class="units">${st.map(unitCard).join("")}</div>
    ${W() ? `<div class="actbar"><div class="t"><b>${signedAll.length === st.length ? "ลงนามครบทุกจุดแล้ว" : `พร้อมลงนาม ${ready.length} จุด`}</b>
      <span>${S.B.me.has_sig ? `ลงนามด้วยลายเซ็นของ ${esc(S.B.me.name)}` : "ยังไม่มีลายเซ็นของคุณในระบบ — ตั้งที่ระบบ HR ก่อนจึงจะลงนามได้"}
      ${S.D.link?.sent_at ? ` · ส่งสหกรณ์แล้ว ${tsTH(S.D.link.sent_at)}` : ""}</span></div>
      <button class="btn btn-p" id="bSign" ${ready.length && S.B.me.has_sig ? "" : "disabled"}>${I.pen}ลงนามและออกใบ</button>
      <button class="btn" id="bSend" ${signedAll.length ? "" : "disabled"}>${I.send}${S.D.link?.sent_at ? "ส่งสหกรณ์อีกครั้ง" : "ส่งสหกรณ์"}</button></div>
      ${S.D.link ? `<div class="linkbox">${I.info}<span style="flex:1">ลิงก์สำหรับสหกรณ์: <a href="${esc(S.D.link.url)}" target="_blank">${esc(S.D.link.url)}</a></span><button class="btn btn-sm" id="bCopy">${I.copy}คัดลอก</button></div>` : ""}` : ""}
    <div class="two mt">
      <div class="card"><div class="card-h"><div><div class="card-t">${I.pen}ใบลงชื่อ</div><div class="card-s">ลืมบัตร: พิมพ์เลขที่เขียนมา (4 ตัวท้ายก็ได้) แล้ว Enter · ผู้ติดต่อ/รับแทนกลุ่ม: ชื่อ + จำนวน</div></div></div>
        <div class="card-b">${W() ? entryForm() : ""}
          <div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>กล่อง</th><th>ประเภท</th><th>รหัส / รายการ</th><th class="r">อิ่ม</th><th></th></tr></thead><tbody>
          ${sheet.map(m => `<tr class="${m.billed ? "" : "zero"}"><td>${esc(boxLabel(m.box))}</td><td>${tag(m.cat)}</td><td><b>${esc(m.code || "")}</b> ${esc(regName(m))}${m.note ? `<div class="small muted">${esc(m.note)}</div>` : ""}</td>
            <td class="r">${m.billed}</td><td class="r">${W() && !unitState(unitOf(m.box)).signed ? `<button class="btn btn-sm btn-ghost" data-del="${m.id}">${I.x}</button>` : ""}</td></tr>`).join("")
            || `<tr><td colspan="5" class="empty">ยังไม่มีรายการจากใบลงชื่อ</td></tr>`}</tbody></table></div></div></div>
      <div class="card"><div class="card-h"><div><div class="card-t">${I.warn}ต้องตรวจ</div><div class="card-s">ใช้ภายใน — ไม่ขึ้นในใบที่ส่งสหกรณ์</div></div>${nChk ? `<span class="chip chip-amb">${nChk}</span>` : `<span class="chip chip-em">เรียบร้อย</span>`}</div>
        <div class="card-b chk">${checksHTML(chk)}</div></div>
    </div>
    <div class="card mt"><div class="card-h"><div><div class="card-t">รายชื่อทั้งหมดของวัน</div><div class="card-s">${S.D.meals.length} แถว · ค้นด้วยรหัสหรือชื่อ</div></div>
      <input class="inp" id="q" placeholder="ค้นหา…" value="${esc(S.q)}" style="width:220px"></div><div class="tbl-wrap" id="allT"></div></div>`);
  wireDay(st);
  allTable();
}
function unitCard(x) {
  const { u, lines, signed, days } = x, cmap = Object.fromEntries(C.CATS.map(c => [c.k, c.color]));
  const amount = lines.meals * u.price;
  return `<div class="unit ${signed ? "signed" : ""}"><div class="uh"><div><b>${esc(u.label)}</b><span>${esc(u.shop || "ยังไม่ได้ตั้งชื่อร้าน")} · ${int(u.price)} บาท/อิ่ม</span></div>
    ${signed ? `<span class="chip chip-blue">✓ ${esc(signed.doc_no)}</span>` : lines.meals ? `<span class="chip chip-gold">รอลงนาม</span>` : `<span class="chip chip-gray">ยังไม่มีข้อมูล</span>`}</div>
    <div class="big"><b>${int(signed ? signed.meals : lines.meals)}</b><small>อิ่ม</small><em>฿${money(signed ? signed.amount : amount)}</em></div>
    <div class="stack">${lines.lines.filter(l => l.n).map(l => `<i style="flex:${l.n};background:${cmap[l.k]}"></i>`).join("")}</div>
    <div class="ul">${lines.lines.filter(l => l.n).map(l => `<div><span><i style="background:${cmap[l.k]}"></i>${esc(l.label)}</span><b>${int(l.n)}</b></div>`).join("") || `<div class="muted">—</div>`}</div>
    <div class="files">${u.boxes.map(b => { const f = days.find(y => y.box === b);
      return f ? `<div class="fl"><span>${esc(boxLabel(b))}: ${f.people} คน · แตะ ${f.scans} ครั้ง${f.file_total != null && f.file_total !== f.scans ? ` <span class="miss">(Total ท้ายไฟล์ ${f.file_total})</span>` : ""}</span>
          ${W() && !signed ? `<button class="fdel" data-fdel="${b}" title="ลบไฟล์นี้ (อัปผิด)">${I.x}</button>` : ""}</div>`
               : `<div class="miss">${esc(boxLabel(b))}: ยังไม่มีไฟล์สแกน</div>`; }).join("")}</div>
    ${signed && lines.meals !== signed.meals ? `<div class="notice gold" style="margin:10px 18px 0">${I.warn}<div>รายการเปลี่ยนหลังลงนาม (ตอนนี้ ${lines.meals} อิ่ม) — ยกเลิกใบแล้วลงนามใหม่</div></div>` : ""}
    <div class="uf">${signed ? `<button class="btn btn-sm" data-print="${signed.id}">${I.print}พิมพ์ / PDF</button>${W() ? `<button class="btn btn-sm btn-ghost" data-void="${signed.id}" data-doc="${esc(signed.doc_no)}">ยกเลิกใบ</button>` : ""}`
      : lines.meals ? `<button class="btn btn-sm" data-pv="${u.key}">${I.eye}ดูตัวอย่างใบ</button>` : ""}
      ${x.voided.length ? `<span class="small muted">ยกเลิกแล้ว ${x.voided.length} ครั้ง</span>` : ""}</div></div>`;
}
function entryForm() {
  const t = S.etype;
  return `<div class="seg" id="eSeg">${[["forgot", "ลืมบัตร"], ["visit", "ผู้ติดต่อ"], ["group", "รับแทนเป็นกลุ่ม"]].map(([k, l]) => `<button data-t="${k}" class="${t === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="entry" style="margin-top:12px"><label class="fld"><span>กล่อง</span><select class="inp" id="eBox">${Object.keys(C.BOXES).map(b => `<option value="${b}" ${S.ebox === b ? "selected" : ""}>${esc(boxLabel(b))}</option>`).join("")}</select></label>
    ${t === "forgot" ? `<label class="fld"><span>รหัสที่เขียน (เช่น 1167 / SUB861 / AKR24051167)</span><input class="inp" id="eCode" autocomplete="off" placeholder="พิมพ์แล้ว Enter"></label>`
      : `<label class="fld"><span>${t === "visit" ? "ชื่อ / บริษัท / เลขบัตรผู้ติดต่อ" : "รายการ (เช่น กะเช้า Processing · ผู้รับ สมพงษ์)"}</span><input class="inp" id="eName" autocomplete="off"></label>`}
    <div style="display:flex;gap:8px;align-items:end">${t !== "forgot" ? `<label class="fld" style="width:90px"><span>จำนวน</span><input class="inp" id="eCnt" type="number" min="1" value="1"></label>` : ""}
      <button class="btn btn-p" id="eAdd">เพิ่ม</button></div></div>
    ${t === "forgot" ? `<div class="cands" id="eCands"></div>` : ""}`;
}
function checksHTML(c) {
  const row = (m, extra = "") => `<tr><td>${esc(boxLabel(m.box))}</td><td><b>${esc(m.reg_code || m.code || "")}</b> ${esc(regName(m))}</td><td>${extra}</td></tr>`;
  const sec = (title, n, body, open = false, chip = "chip-amb") => n ? `<details ${open ? "open" : ""}><summary>${title}<span class="chip ${chip}">${n}</span></summary><div><div class="tbl-wrap"><table class="tbl"><tbody>${body}</tbody></table></div></div></details>` : "";
  const out = [
    sec("แตะบัตรซ้ำ — รอ HR ยืนยัน (นับ 1 ไว้ก่อน)", c.dup.length, c.dup.map(m => row(m, `แตะ ${m.scans} ครั้ง ${W() ? `<button class="btn btn-sm" data-dup="${m.id}" data-dec="one">นับ 1</button> <button class="btn btn-sm" data-dup="${m.id}" data-dec="two">นับ 2</button>` : ""}`)).join(""), true),
    sec("ลงชื่อลืมบัตร แต่มีสแกนบัตรด้วย", c.forgotScanned.length, c.forgotScanned.flatMap(g => g.rows.map(m => row(m, `${tag(m.cat)} ${m.billed} อิ่ม ${W() && m.billed ? `<button class="btn btn-sm" data-zero="${m.id}">ไม่นับแถวนี้</button>` : ""}`))).join(""), true),
    sec("ทานทั้ง 2 กล่องในวันเดียวกัน", c.twoBox.length, c.twoBox.flatMap(g => g.rows.map(m => row(m, `${tag(m.cat)} ${m.billed} อิ่ม ${W() && m.billed ? `<button class="btn btn-sm" data-zero="${m.id}">ไม่นับแถวนี้</button>` : ""}`))).join(""), true),
    sec("คนที่ออกแล้วยังทาน", c.left.length, c.left.map(m => row(m, tag(m.cat))).join("")),
    sec("ไม่อยู่ในทะเบียนพนักงาน/SUB (ยังนับหัวให้) — อัปเดตทะเบียน SUB", c.notReg.length, c.notReg.map(m => row(m, `บนบัตร: ${esc(m.name || "")}`)).join(""), false, "chip-gray"),
    sec("รหัสบนบัตรไม่ตรงทะเบียน HR — จับคู่ด้วยชื่อแล้ว (แจ้ง IT แก้บัตร)", c.mapped.length, c.mapped.map(m => row(m, `บัตร ${esc(m.code)}`)).join(""), false, "chip-gray"),
    sec("Total ท้ายไฟล์ไม่ตรงกับผลรวมรายชื่อ — ใบนับจากรายชื่อ", c.fileDiff.length, c.fileDiff.map(d => `<tr><td>${esc(boxLabel(d.box))}</td><td>Total ${d.file_total}</td><td>รวมจริง ${d.scans}</td></tr>`).join(""), false, "chip-gray"),
  ].join("");
  return out || `<div class="empty">ไม่มีเรื่องต้องตรวจ</div>`;
}
function allTable() {
  const q = S.q.trim().toLowerCase();
  const rows = S.D.meals.filter(m => !q || `${m.code} ${m.reg_code} ${m.name} ${regName(m)}`.toLowerCase().includes(q));
  $("#allT").innerHTML = `<table class="tbl"><thead><tr><th>กล่อง</th><th>ประเภท</th><th>รหัส</th><th>ชื่อ</th><th class="r">แตะ</th><th class="r">อิ่ม</th><th>หมายเหตุ</th></tr></thead><tbody>
    ${rows.slice(0, 300).map(m => `<tr class="${m.billed ? "" : "zero"}"><td>${esc(boxLabel(m.box))}</td><td>${tag(m.cat)}</td><td>${esc(m.reg_code || m.code || "—")}${m.reg_code && m.code && m.reg_code !== m.code ? `<div class="small muted">บัตร ${esc(m.code)}</div>` : ""}</td>
      <td>${esc(regName(m))}</td><td class="r">${m.scans}</td><td class="r"><b>${m.billed}</b>${m.dup === "pending" ? ` <span class="chip chip-amb">รอยืนยัน</span>` : m.dup === "two" ? ` <span class="chip chip-blue">2 มื้อ</span>` : ""}</td>
      <td class="small muted">${esc(m.note || m.dup_reason || "")}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">ยังไม่มีข้อมูลของวันนี้</td></tr>`}
    ${rows.length > 300 ? `<tr><td colspan="7" class="muted small">แสดง 300 จาก ${rows.length} — ค้นหาเพื่อดูเพิ่ม</td></tr>` : ""}</tbody></table>`;
}
function wireDay(st) {
  $("#dPick").onchange = e => { if (e.target.value) location.hash = `#/day/${e.target.value}`; };
  $("#dPrev").onclick = () => { location.hash = `#/day/${addDay(S.d, -1)}`; };
  $("#dNext").onclick = () => { location.hash = `#/day/${addDay(S.d, 1)}`; };
  $("#q").oninput = e => { S.q = e.target.value; allTable(); };
  const drop = $("#drop");
  if (drop) {
    $("#fileIn").onchange = e => importFiles([...e.target.files]);
    drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); importFiles([...e.dataTransfer.files]); };
  }
  document.querySelectorAll("[data-print]").forEach(b => b.onclick = () => printIds([+b.dataset.print]));
  document.querySelectorAll("[data-pv]").forEach(b => b.onclick = () => preview(st.find(x => x.u.key === b.dataset.pv)));
  document.querySelectorAll("[data-void]").forEach(b => b.onclick = () => voidNotice(+b.dataset.void, b.dataset.doc));
  document.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { await run(() => rpc("cn_entry_del", { p_id: +b.dataset.del }), "ลบแล้ว"); dayPage(); });
  document.querySelectorAll("[data-dup]").forEach(b => b.onclick = () => decideDup([+b.dataset.dup], b.dataset.dec, dayPage));
  document.querySelectorAll("[data-zero]").forEach(b => b.onclick = () => zeroRow(+b.dataset.zero));
  document.querySelectorAll("[data-fdel]").forEach(b => b.onclick = () => { const box = b.dataset.fdel, f = S.D.days.find(y => y.box === box);
    modal(`ลบไฟล์สแกน ${esc(boxLabel(box))} · ${dTH(S.d)}`, `<div>${esc(f?.file_name || "")}<br><b>${f?.people} คน · แตะ ${f?.scans} ครั้ง</b></div>
      <div class="small muted">รายการจากไฟล์นี้จะหายทั้งหมด รวมการยืนยันแตะซ้ำของกล่องนี้ · รายการที่คีย์จากใบลงชื่อยังอยู่ · อัปไฟล์ที่ถูกต้องใหม่ได้ทันที</div>`, "ลบไฟล์", async () => {
      await run(() => rpc("cn_upload_del", { p_d: S.d, p_box: box }), "ลบไฟล์แล้ว"); dayPage(); }); });
  $("#bFiles") && ($("#bFiles").onclick = filesModal);
  $("#bSign") && ($("#bSign").onclick = () => signDay(st));
  $("#bSend") && ($("#bSend").onclick = () => sendDay());
  $("#bCopy") && ($("#bCopy").onclick = () => navigator.clipboard.writeText(S.D.link.url).then(() => toast("คัดลอกลิงก์แล้ว", "success")));
  // คีย์ใบลงชื่อ
  document.querySelectorAll("#eSeg button").forEach(b => b.onclick = () => { S.etype = b.dataset.t; dayPage(); });
  if (!$("#eAdd")) return;
  $("#eBox").onchange = e => { S.ebox = e.target.value; };
  const code = $("#eCode");
  if (code) {
    code.focus();
    code.oninput = () => { S.pick = null; showCands(); };
    code.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); addEntry(); } };
  } else $("#eName").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); addEntry(); } };
  $("#eAdd").onclick = addEntry;
}
function showCands() {
  const v = $("#eCode").value, list = C.resolveCode(v, S.ix).slice(0, 6), box = $("#eCands");
  if (!S.pick && list.length === 1) S.pick = list[0].code;
  box.innerHTML = !v.trim() ? "" : list.length ? list.map(p => `<button class="cand ${S.pick === p.code ? "on" : ""} ${p.left ? "left" : ""}" data-c="${esc(p.code)}"><b>${esc(p.code)}</b>${esc(p.name)}${p.dept ? ` · ${esc(p.dept)}` : ""}${p.left ? " · ออกแล้ว" : ""}</button>`).join("")
    + (list.length > 1 && !S.pick ? `<span class="small muted" style="align-self:center">มีหลายคน — กดเลือกคนที่ตรงกับชื่อในใบ</span>` : "")
    : `<span class="small" style="color:var(--amber-600)">ไม่พบในทะเบียน — Enter เพื่อบันทึกตามที่เขียน (นับ 1 อิ่ม)</span>`;
  box.querySelectorAll("[data-c]").forEach(b => b.onclick = () => { S.pick = b.dataset.c; showCands(); $("#eCode").focus(); });
}
async function addEntry() {
  const box = $("#eBox").value, t = S.etype;
  try {
    if (t === "forgot") {
      const v = $("#eCode").value.trim(); if (!v) return;
      const list = C.resolveCode(v, S.ix);
      if (list.length > 1 && !S.pick) { toast("มีหลายคนที่เลขนี้ — กดเลือกก่อน", "error"); return; }
      const p = S.pick ? S.ix.byCode.get(S.pick) : null;
      const r = await rpc("cn_entry_add", { p_d: S.d, p_box: box, p_cat: "forgot", p_code: p ? p.code : v.toUpperCase(), p_name: p ? p.name : null,
        p_note: p ? (p.code !== v.toUpperCase() ? `เขียน ${v}` : null) : "ไม่พบในทะเบียน — บันทึกตามที่เขียน" });
      toast(r.billed ? `เพิ่ม ${p ? p.name : v}` : `บันทึกแล้ว แต่ไม่นับ — ${r.note}`, r.billed ? "success" : "");
    } else {
      const n = $("#eName").value.trim(), k = +$("#eCnt").value || 1; if (!n) return;
      await rpc("cn_entry_add", { p_d: S.d, p_box: box, p_cat: t, p_name: n, p_count: k });
      toast(`เพิ่ม ${n} × ${k}`, "success");
    }
    S.ebox = box; S.pick = null; dayPage();
  } catch (e) { toast(e.message, "error"); }
}
async function decideDup(ids, dec, after) {
  if (dec === "two") {
    modal("ทานจริง 2 มื้อ", `<label class="fld"><span>เหตุผล (ต้องมี)</span><select class="inp" id="dupWhy"><option>ทำงานต่อเนื่อง / OT ต่อกะ</option><option>ทานกลางวัน + มื้อเย็นช่วงทำงานต่อ</option><option>อื่น ๆ</option></select></label>
      <label class="fld"><span>รายละเอียดเพิ่ม</span><input class="inp" id="dupMore" placeholder="ถ้ามี"></label>
      <div class="small muted">ถ้าใบของวันนั้นลงนามไปแล้ว มื้อที่ 2 จะไปขึ้นเป็น “ยกยอดจากวันก่อน” ในใบถัดไปของจุดเดียวกัน</div>`, "ยืนยันนับ 2", async m => {
      const why = [m.querySelector("#dupWhy").value, m.querySelector("#dupMore").value.trim()].filter(Boolean).join(" · ");
      await run(() => rpc("cn_dup_decide", { p_ids: ids, p_dec: "two", p_reason: why }), "บันทึกแล้ว"); after();
    });
    return;
  }
  await run(() => rpc("cn_dup_decide", { p_ids: ids, p_dec: "one", p_reason: null }), "นับ 1 แล้ว"); after();
}
function zeroRow(id) {
  modal("ไม่นับแถวนี้", `<label class="fld"><span>เหตุผล (ต้องมี)</span><input class="inp" id="zWhy" value="ทาน/ลงชื่อซ้ำในวันเดียวกัน"></label>`, "บันทึก", async m => {
    await run(() => rpc("cn_billed_set", { p_id: id, p_billed: 0, p_reason: m.querySelector("#zWhy").value }), "แก้แล้ว"); dayPage();
  });
}

async function filesModal() {
  const fs = await rpc("cn_files", {});
  const m = modal(`ไฟล์สแกนที่อัปแล้ว ${fs.length} ไฟล์`, `<div class="small muted">เลือกไฟล์ที่จะลบ · รายการจากไฟล์นั้นหายทั้งหมด (รวมการยืนยันแตะซ้ำ) · รายการจากใบลงชื่อไม่หาย · วันที่ลงนามแล้วลบไม่ได้</div>
    <label><input type="checkbox" id="fAll"> เลือกทั้งหมดที่ลบได้</label>
    <div class="tbl-wrap" style="max-height:50vh"><table class="tbl"><thead><tr><th></th><th>วันที่ทาน</th><th>กล่อง</th><th class="r">คน</th><th class="r">แตะ</th><th>ไฟล์</th></tr></thead><tbody>
    ${fs.map((f, i) => `<tr><td>${f.signed ? `<span class="chip chip-blue">ลงนามแล้ว</span>` : `<input type="checkbox" data-fi="${i}">`}</td><td>${dTH(f.d)}</td><td>${esc(boxLabel(f.box))}</td>
      <td class="r">${f.people}</td><td class="r">${f.scans}</td><td class="small muted">${esc(f.file_name || "")}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">ยังไม่มีไฟล์</td></tr>`}</tbody></table></div>`,
    "ลบที่เลือก", async mm => {
      const items = [...mm.querySelectorAll("[data-fi]:checked")].map(x => ({ d: fs[+x.dataset.fi].d, box: fs[+x.dataset.fi].box }));
      if (!items.length) { toast("ยังไม่ได้เลือกไฟล์", "error"); return false; }
      if (!confirm(`ลบ ${items.length} ไฟล์ — ยืนยัน?`)) return false;
      const r = await run(() => rpc("cn_upload_del_many", { p_items: items }));
      toast(`ลบแล้ว ${r.done} ไฟล์${r.skipped.length ? ` · ข้าม ${r.skipped.length}: ${r.skipped[0].why}` : ""}`, r.skipped.length ? "" : "success"); dayPage();
    }, true);
  m.querySelector("#fAll").onchange = e => m.querySelectorAll("[data-fi]").forEach(x => { x.checked = e.target.checked; });
}

// ---------------------------------------------------------------- นำเข้าไฟล์สแกน
async function importFiles(files) {
  files = files.filter(f => /\.xlsx?$/i.test(f.name));
  if (!files.length) return;
  const parsed = [];
  for (const f of files) {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
      parsed.push({ f, ...C.parseScan(aoa, f.name) });
    } catch (e) { parsed.push({ f, error: e.message }); }
  }
  const body = `<div class="small muted">ตรวจกล่องและวันที่ก่อนบันทึก — ไฟล์เดิมของวัน/กล่องเดียวกันจะถูกแทนที่ (การยืนยันแตะซ้ำเดิมยังอยู่)</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>ไฟล์</th><th>กล่อง</th><th>วันที่ทาน</th><th class="r">คน</th><th class="r">แตะ</th><th>หมายเหตุ</th></tr></thead><tbody>
    ${parsed.map((p, i) => p.error ? `<tr><td>${esc(p.f.name)}</td><td colspan="5" style="color:var(--red-600)">${esc(p.error)}</td></tr>` :
      `<tr><td class="small">${esc(p.f.name)}</td><td><select class="inp" data-box="${i}">${Object.keys(C.BOXES).map(b => `<option value="${b}" ${p.box === b ? "selected" : ""}>${esc(boxLabel(b))}</option>`).join("")}</select></td>
       <td><input class="inp" type="date" data-d="${i}" value="${p.d || S.d}"></td><td class="r">${p.rows.length}</td><td class="r">${p.sum}</td>
       <td class="small">${[p.unknown ? `ไม่มีรหัส ${p.unknown}` : "", p.fileTotal != null && p.fileTotal !== p.sum ? `Total ท้ายไฟล์ ${p.fileTotal}` : "", p.rows.filter(r => r.scans > 1).length ? `แตะซ้ำ ${p.rows.filter(r => r.scans > 1).length} คน` : "", !p.box ? "<b>เลือกกล่อง</b>" : "", !p.d ? "<b>ไม่พบวันที่ในชื่อไฟล์</b>" : ""].filter(Boolean).join(" · ")}</td></tr>`).join("")}
    </tbody></table></div>`;
  modal(`นำเข้าไฟล์สแกน ${parsed.filter(p => !p.error).length} ไฟล์`, body, "บันทึก", async m => {
    const ok = parsed.map((p, i) => p.error ? null : { ...p, box: m.querySelector(`[data-box="${i}"]`).value, d: m.querySelector(`[data-d="${i}"]`).value }).filter(Boolean);
    const seen = new Set();
    for (const p of ok) { const k = p.d + p.box; if (seen.has(k)) { toast(`มี 2 ไฟล์เป็น ${boxLabel(p.box)} วันที่ ${dTH(p.d)}`, "error"); return false; } seen.add(k); }
    for (const p of ok) {
      const rows = p.rows.map(r => { const mp = C.mapCard(r.code, r.name, S.ix); return { ...r, reg_code: mp.reg, note: mp.how === "name" ? "รหัสบนบัตรไม่ตรงทะเบียน" : null }; });
      await run(() => rpc("cn_upload", { p_d: p.d, p_box: p.box, p_file: p.f.name, p_total: p.fileTotal, p_unknown: p.unknown, p_rows: rows }));
    }
    toast(`บันทึก ${ok.length} ไฟล์แล้ว`, "success");
    const ds = [...new Set(ok.map(p => p.d))].sort();
    if (ds.length) { if (`#/day/${ds[ds.length - 1]}` === location.hash) dayPage(); else location.hash = `#/day/${ds[ds.length - 1]}`; }
  }, true);
}

// ---------------------------------------------------------------- ใบ: ตัวอย่าง / ลงนาม / ยกเลิก / พิมพ์ / ส่ง
function draftNotice(x) {
  const { u, ms, carry, lines } = x;
  const people = ms.filter(m => m.billed > 0).map(m => ({ c: C.lineOf(m.cat), code: m.reg_code || m.code || "", name: regName(m), n: m.billed, box: u.boxes.length > 1 ? m.box : null }))
    .concat(carry.map(m => ({ c: "carry", code: m.reg_code || m.code || "", name: regName(m), n: m.extra, from: m.d })));
  return { doc_no: "(ยังไม่ออกเลข)", unit: u.key, label: u.label, shop: u.shop, price: u.price, d: S.d, lines: lines.lines, meals: lines.meals, amount: lines.meals * u.price,
           people, signer: { name: S.B.me.name, title: S.B.me.title || "HR" }, signed_at: null, version: 1 };
}
function preview(x) {
  const n = draftNotice(x);
  modal(`ตัวอย่างใบ ${esc(x.u.label)} · ${dTH(S.d)} <span class="chip chip-gold" style="margin-left:8px">ยังไม่ลงนาม</span>`,
    `<style>${DOC_CSS}</style><div class="pv-wrap"><div class="cnd" style="zoom:.62">${noticeDoc(n, {})}</div></div>`, null, null, true);
}
function signDay(st) {
  const ready = st.filter(x => !x.signed && x.lines.meals > 0), pend = S.D.meals.filter(m => m.dup === "pending").length;
  const tot = ready.reduce((t, x) => t + x.lines.meals * x.u.price, 0);
  modal(`ลงนามใบแจ้งยอด ${dTH(S.d)}`, `<div class="tbl-wrap"><table class="tbl"><tbody>${ready.map(x => `<tr><td><label><input type="checkbox" data-u="${x.u.key}" checked> <b>${esc(x.u.label)}</b></label>
      <div class="small muted">${esc(x.u.shop || "")}</div></td><td class="r">${int(x.lines.meals)} อิ่ม</td><td class="r"><b>฿${money(x.lines.meals * x.u.price)}</b></td></tr>`).join("")}
      <tr><td><b>รวม</b></td><td></td><td class="r"><b>฿${money(tot)}</b></td></tr></tbody></table></div>
    ${pend ? `<div class="notice gold">${I.warn}<div>ยังมีแตะซ้ำรอยืนยัน ${pend} คน — ในใบนับคนละ 1 อิ่ม ถ้ายืนยันทีหลังว่าทาน 2 มื้อ จะยกไปใบถัดไป</div></div>` : ""}
    ${st.some(x => x.u.boxes.some(b => !x.days.find(y => y.box === b)) && ready.includes(x)) ? `<div class="notice gold">${I.warn}<div>บางจุดยังไม่มีไฟล์สแกนครบทุกกล่อง</div></div>` : ""}
    <div class="small muted">ลงนามอิเล็กทรอนิกส์ด้วยลายเซ็นของ <b>${esc(S.B.me.name)}</b> · ระบบออกเลขต่อจากเลขล่าสุดของแต่ละชุด</div>`, "ลงนาม", async m => {
    const units = [...m.querySelectorAll("[data-u]:checked")].map(i => i.dataset.u);
    if (!units.length) return false;
    const r = await run(() => rpc("cn_sign", { p_d: S.d, p_units: units }));
    toast(`ลงนามแล้ว ${r.map(x => x.doc_no).join(", ")}`, "success"); dayPage();
  });
}
function voidNotice(id, doc) {
  modal(`ยกเลิกใบ ${esc(doc)}`, `<label class="fld"><span>เหตุผล (ต้องมี)</span><input class="inp" id="vWhy" placeholder="เช่น ได้ไฟล์สแกนเพิ่ม / คีย์ใบลงชื่อผิด"></label>
    <div class="small muted">ยกเลิกแล้วแก้รายการได้ แล้วลงนามใหม่ — เลขที่เดิม (ออกใหม่ครั้งที่ 2) · ถ้าส่งสหกรณ์ไปแล้ว ควรส่งอีกครั้งหลังลงนามใหม่</div>`, "ยกเลิกใบ", async m => {
    await run(() => rpc("cn_void", { p_id: id, p_reason: m.querySelector("#vWhy").value }), "ยกเลิกแล้ว"); dayPage();
  });
}
async function printIds(ids) {
  try { const r = await rpc("cn_print", { p_ids: ids }); printNotices(r.notices, r.art, r.notices.length === 1 ? r.notices[0].doc_no : "ใบแจ้งยอดร้านค้า"); }
  catch (e) { toast(e.message, "error"); }
}
const b64 = s => btoa(unescape(encodeURIComponent(s)));
function downloadEml(to, cc, subject, html, name) {
  const body = b64(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${html}</body></html>`).replace(/.{76}/g, "$&\r\n");
  const eml = [`To: ${to}`, ...(cc ? [`Cc: ${cc}`] : []), `Subject: =?UTF-8?B?${b64(subject)}?=`, "X-Unsent: 1", "MIME-Version: 1.0",
               "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", body].join("\r\n");
  const url = URL.createObjectURL(new Blob([eml], { type: "message/rfc822" }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function sendDay() {
  const ns = S.D.notices.filter(n => n.status === "signed");
  modal(`ส่งใบแจ้งยอด ${dTH(S.d)} ให้สหกรณ์`, `<div class="small">ถึง: <b>${esc(S.B.mail.to || "ยังไม่ได้ตั้ง")}</b>${S.B.mail.cc ? ` · สำเนา ${esc(S.B.mail.cc)}` : ""}</div>
    <div class="tbl-wrap"><table class="tbl"><tbody>${ns.map(n => `<tr><td><b>${esc(n.doc_no)}</b></td><td>${esc(n.label)}</td><td class="r">${int(n.meals)} อิ่ม</td><td class="r">฿${money(n.amount)}</td></tr>`).join("")}</tbody></table></div>
    <div class="small muted">เมลมีตารางสรุป + ลิงก์ให้สหกรณ์เปิดใบ พิมพ์/บันทึก PDF และโหลด Excel รายชื่อ (ไม่ต้อง login, 120 วัน)${S.B.mail_mode !== "auto" ? " · ระบบเมลอยู่โหมด Outlook — จะได้ไฟล์ .eml ไปกดส่งเอง" : ""}</div>`, "ส่ง", async () => {
    const r = await run(() => rpc("cn_send", { p_d: S.d }));
    if (r.result?.sent) toast(`ส่งถึง ${r.result.to} แล้ว`, "success");
    else if (r.result?.reason === "outlook_mode" || r.result?.reason === "test_mode" || r.result?.reason === "not_configured") {
      downloadEml(r.to, r.cc, r.subject, r.html, `ใบแจ้งยอดร้านค้า ${S.d}.eml`);
      toast(r.result.reason === "test_mode" ? "โหมดทดสอบ (MAIL_LIVE ≠ 1) — ได้ไฟล์ .eml ไปส่งเอง" : "ได้ไฟล์ .eml — เปิดแล้วกดส่งใน Outlook");
    } else toast(`ส่งไม่สำเร็จ: ${r.result?.detail || r.result?.reason}`, "error");
    dayPage();
  });
}

// ---------------------------------------------------------------- แตะซ้ำรอยืนยัน
async function dupsPage() {
  render(`<div class="fx-loading">กำลังโหลด…</div>`);
  const r = await rpc("cn_dups", { p_ym: S.ym }); navDup(r.pending.length);
  const byP = new Map();
  for (const m of r.month) { const k = m.reg_code || m.code; const o = byP.get(k) || byP.set(k, { k, name: regName(m), n: 0, two: 0, days: [] }).get(k); o.n++; if (m.dup === "two") o.two++; o.days.push(m.d); }
  const rep = [...byP.values()].sort((a, b) => b.n - a.n);
  const groups = new Map(); for (const m of r.pending) (groups.get(m.d) || groups.set(m.d, []).get(m.d)).push(m);
  render(`${head("แตะซ้ำ", "แตะบัตรซ้ำรอยืนยัน", "ไฟล์สแกนไม่มีเวลา จึงแยกไม่ได้ว่าทานจริง 2 มื้อ แอบมาซ้ำ หรือร้านแตะซ้ำ — ใบนับ 1 ไว้ก่อน HR ยืนยันที่นี่",
      W() && r.pending.length ? `<button class="btn" id="allOne">นับ 1 ทั้งหมด (${r.pending.length})</button>` : "")}
    <div class="card"><div class="card-h"><div class="card-t">รอยืนยัน ${r.pending.length} รายการ</div></div><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>วันที่</th><th>กล่อง</th><th>รหัส</th><th>ชื่อ</th><th class="r">แตะ</th><th class="r">ซ้ำในเดือน</th><th></th></tr></thead><tbody>
      ${[...groups].map(([d, ms]) => ms.map(m => { const p = byP.get(m.reg_code || m.code);
        return `<tr><td>${dTH(d)}</td><td>${esc(boxLabel(m.box))}</td><td>${esc(m.reg_code || m.code)}</td><td>${esc(regName(m))}</td><td class="r">${m.scans}</td>
          <td class="r">${p && p.n >= 3 ? `<span class="chip chip-red">${p.n} วัน</span>` : p ? `${p.n} วัน` : ""}</td>
          <td class="r">${W() ? `<button class="btn btn-sm" data-dup="${m.id}" data-dec="one">นับ 1</button> <button class="btn btn-sm" data-dup="${m.id}" data-dec="two">นับ 2</button>` : ""}</td></tr>`; }).join("")).join("")
        || `<tr><td colspan="7" class="empty">ไม่มีรายการรอยืนยัน</td></tr>`}</tbody></table></div></div>
    <div class="card mt"><div class="card-h"><div><div class="card-t">แตะซ้ำบ่อยในเดือน</div><div class="card-s">3 วันขึ้นไป = สีแดง · ดึงไปแจ้งหัวหน้าได้</div></div>
      <input class="inp" type="month" id="ym" value="${S.ym}"></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>รหัส</th><th>ชื่อ</th><th class="r">วันที่แตะซ้ำ</th><th class="r">ยืนยัน 2 มื้อ</th><th>วันที่</th></tr></thead><tbody>
      ${rep.map(p => `<tr><td>${esc(p.k)}</td><td>${esc(p.name)}</td><td class="r">${p.n >= 3 ? `<span class="chip chip-red">${p.n}</span>` : p.n}</td><td class="r">${p.two || ""}</td>
        <td class="small muted">${p.days.map(d => +d.slice(8, 10)).join(", ")}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">ไม่มี</td></tr>`}</tbody></table></div></div>`);
  document.querySelectorAll("[data-dup]").forEach(b => b.onclick = () => decideDup([+b.dataset.dup], b.dataset.dec, dupsPage));
  $("#allOne") && ($("#allOne").onclick = () => modal("นับ 1 ทั้งหมด", `ยืนยันว่า ${r.pending.length} รายการเป็นการแตะซ้ำ (นับคนละ 1 อิ่ม)`, "ยืนยัน", async () => {
    await run(() => rpc("cn_dup_decide", { p_ids: r.pending.map(m => m.id), p_dec: "one" }), "บันทึกแล้ว"); dupsPage(); }));
  $("#ym").onchange = e => { S.ym = e.target.value; dupsPage(); };
}

// ---------------------------------------------------------------- สั่งอาหาร กะบ่าย / OT / กะดึก (HR) · user 2026-11-26
const KTH = { aft: "กะบ่าย", ot: "OT", night: "กะดึก (ชุดแห้ง)" };
const vName = id => S.B.vendors.find(v => v.id === +id)?.name || "";
const cookOpts = sel => `<option value="">— ยังไม่ระบุ —</option>${S.B.vendors.filter(v => v.n > 0 || v.id === +sel).sort((a, b) => b.n - a.n)
  .map(v => `<option value="${v.id}" ${+sel === v.id ? "selected" : ""}>${esc(v.code)} · ${esc(v.name)}</option>`).join("")}`;
async function loadGroups() { S.G = await rpc("cn_groups", {}); return S.G; }
async function ordersPage() {
  render(`<div class="fx-loading">กำลังโหลด…</div>`);
  const t = today(), span = Array.from({ length: 9 }, (_, i) => addDay(t, i - 1));
  let O, C;
  try { [O, C] = await Promise.all([rpc("cn_orders_day", { p_d: S.od }), rpc("cn_orders_span", { p_from: span[0] < S.od ? span[0] : S.od, p_to: span[8] > S.od ? span[8] : S.od }), loadGroups()]); }
  catch (e) { render(`<div class="card card-b">${esc(e.message)}</div>`); return; }
  S.O = O;
  navOrd(C.filter(x => x.d === t).reduce((s, x) => s + x.n, 0));
  const sv = O.service || {}, gs = S.G.filter(g => g.active || O.orders.some(o => o.group_id === g.id));
  const of = (g, k) => O.orders.filter(o => o.group_id === g && o.kind === k);
  const sum = (g, k) => of(g, k).reduce((s, o) => s + o.qty, 0);
  const tot = k => O.orders.filter(o => o.kind === k).reduce((s, o) => s + o.qty, 0);
  const dayN = d => C.filter(x => x.d === d).reduce((s, x) => s + x.n, 0);
  const P = S.B.billing.prices, KS = ["aft", "ot", "night"];
  const lastBy = g => { const os = O.orders.filter(o => o.group_id === g.id).sort((a, b) => String(a.at).localeCompare(String(b.at))); return os[os.length - 1]; };
  render(`${head(`สั่งอาหาร · ${wd(S.od)}`, dTH(S.od), "รายชื่อที่แต่ละกลุ่มสั่งผ่านลิงก์ขึ้นที่นี่ทันที · HR แก้ได้ทุกเมื่อ (แม้เลยเวลาปิดรับ) จนกว่าจะออก HRIN ของรอบนั้น",
      `<div class="dnav"><button class="btn btn-sm" id="oPrev">${I.l}</button><input class="inp" type="date" id="oPick" value="${S.od}"><button class="btn btn-sm" id="oNext">${I.r}</button></div>
       <button class="btn" id="roster">ตารางแม่ครัวเวร</button>`)}
    <div class="dstrip">${span.map(d => `<a class="dchip ${d === S.od ? "on" : ""} ${d === t ? "today" : ""}" href="#/orders/${d}"><small>${d === t ? "วันนี้" : wd(d).slice(0, 2)}</small><b>${+d.slice(8, 10)}</b><i>${dayN(d) ? dayN(d) + " ที่" : "—"}</i></a>`).join("")}</div>
    <div class="kpis">${KS.map(k => `<div class="kpi"><div><div class="kpi-l">${KTH[k]} · ${P[k]} บาท · ปิดรับ ${esc(S.B.billing.cutoff[k])} น.</div>
      <div class="kpi-v">${tot(k)} <small style="font-size:14px">ที่</small></div><div class="kpi-d">฿${money(tot(k) * P[k])} · ${O.passed[k] ? "ปิดรับแล้ว (HR ยังแก้ได้)" : "ยังเปิดรับ"}</div></div></div>`).join("")}</div>
    <div class="card mt"><div class="card-h"><div><div class="card-t">รายชื่อที่สั่ง · ${dTH(S.od)}</div><div class="card-s">กด “แก้” เพื่อเพิ่ม/ลบ/แก้จำนวน · ยังไม่มีรายการ = กลุ่มนั้นยังไม่สั่ง</div></div>
      <div class="fx-actions"><button class="btn btn-sm" id="cpCook">${I.copy}ข้อความส่งแม่ครัว</button><button class="btn btn-sm" id="cpNight">${I.copy}ข้อความส่งสหกรณ์ (กะดึก)</button>
        <button class="btn btn-sm" id="xDay" ${O.orders.length ? "" : "disabled"}>${I.dl}Excel รายชื่อ</button></div></div>
      <div class="card-b"><div class="ogrid">${gs.map(g => { const lb = lastBy(g);
        return `<div class="ocard"><div class="oh"><div><b>${esc(g.name)}</b>${g.active ? "" : ` <span class="chip chip-gray">ปิดใช้</span>`}<span>${esc(g.coord || "")}</span></div>
          <span class="small muted">${lb ? `${esc(lb.by_name || "")} · ${tsTH(lb.at).split(" ").slice(-1)[0]} น.` : "ยังไม่สั่ง"}</span></div>
          ${KS.filter(k => g.kinds.includes(k) || sum(g.id, k)).map(k => `<div class="ok"><div class="okh"><span class="tag t-${k === "aft" ? "akr" : k === "ot" ? "forgot" : "visit"}">${KTH[k]}</span><b>${sum(g.id, k)}</b>
            ${W() ? `<button class="btn btn-sm btn-ghost" data-ed="${g.id}" data-k="${k}">${sum(g.id, k) ? "แก้" : "+ เพิ่ม"}</button>` : ""}</div>
            ${of(g.id, k).length ? `<ol>${of(g.id, k).map(o => `<li>${esc(o.name)}${o.emp_code ? ` <span class="muted small">${esc(o.emp_code)}</span>` : ""}${o.qty > 1 ? ` <b>× ${o.qty}</b>` : ""}${o.src === "hr" ? ` <span class="chip chip-gray" style="font-size:10.5px">HR</span>` : ""}</li>`).join("")}</ol>` : ""}</div>`).join("")}</div>`; }).join("")
        || `<div class="empty">ยังไม่มีกลุ่มผู้สั่ง — เพิ่มที่ <a href="#/groups">กลุ่มผู้สั่ง · ลิงก์</a></div>`}</div></div></div>
    <div class="card mt"><div class="card-h"><div><div class="card-t">แม่ครัวเวร · เมนูของวัน</div><div class="card-s">กะบ่ายและ OT วางบิลในชื่อแม่ครัวเวรของวันนั้น · ชุดกะดึกวางบิลสหกรณ์ · เมนูขึ้นในหน้าสั่งของแผนก</div></div></div>
      <div class="card-b grid-f"><label class="fld"><span>แม่ครัวเวร (ผู้ขายใน Invoice Hub)</span><select class="inp" id="sCook" ${W() ? "" : "disabled"}>${cookOpts(sv.cook_id)}</select></label>
        <label class="fld"><span>เมนูกะบ่าย (ร้านแจ้ง)</span><input class="inp" id="sMa" value="${esc(sv.menu_aft || "")}" placeholder="เช่น แกงหมูมะเขือ, ไข่ดาว, ต้มฟักไก่" ${W() ? "" : "disabled"}></label>
        <label class="fld"><span>ชุดอาหารแห้งกะดึก</span><input class="inp" id="sMn" value="${esc(sv.menu_night || "")}" placeholder="เช่น มาม่า + น้ำหวาน + ขนม" ${W() ? "" : "disabled"}></label>
        <label class="fld"><span>หมายเหตุถึงผู้สั่ง</span><input class="inp" id="sNote" value="${esc(sv.note || "")}" ${W() ? "" : "disabled"}></label>
        <div class="fld"><span>ปิดรับก่อนเวลา</span><div>${KS.map(k => `<label style="margin-right:12px"><input type="checkbox" data-cl="${k}" ${(sv.closed || "").split(",").includes(k) ? "checked" : ""} ${W() ? "" : "disabled"}> ${KTH[k]}</label>`).join("")}</div></div>
        ${W() ? `<div style="display:flex;align-items:end;justify-content:flex-end"><button class="btn btn-p" id="sSave">บันทึก</button></div>` : ""}</div></div>`);
  $("#oPick").onchange = e => { if (e.target.value) location.hash = `#/orders/${e.target.value}`; };
  $("#oPrev").onclick = () => { location.hash = `#/orders/${addDay(S.od, -1)}`; };
  $("#oNext").onclick = () => { location.hash = `#/orders/${addDay(S.od, 1)}`; };
  $("#roster").onclick = () => rosterModal(S.od.slice(0, 7));
  $("#sSave") && ($("#sSave").onclick = async () => {
    await run(() => rpc("cn_service_save", { p_days: [S.od], p_row: { cook_id: $("#sCook").value || null, menu_aft: $("#sMa").value, menu_night: $("#sMn").value,
      note: $("#sNote").value, closed: [...document.querySelectorAll("[data-cl]:checked")].map(x => x.dataset.cl) } }), "บันทึกแล้ว"); ordersPage(); });
  document.querySelectorAll("[data-ed]").forEach(a => a.onclick = () => editOrders(S.G.find(g => g.id === +a.dataset.ed), a.dataset.k, O));
  const lines = (k, withNames) => gs.map(g => { const os = of(g.id, k); const n = sum(g.id, k);
    return n ? `- ${g.name} ${n} ที่` + (withNames ? `\n${os.map(o => `   • ${o.name}${o.qty > 1 ? ` × ${o.qty}` : ""}`).join("\n")}` : "") : ""; }).filter(Boolean).join("\n");
  const copy = s => navigator.clipboard.writeText(s).then(() => toast("คัดลอกแล้ว — วางใน LINE ได้เลย", "success"));
  $("#cpCook").onclick = () => copy(`📋 สั่งอาหาร ${dTH(S.od)}${sv.cook_id ? ` · ${vName(sv.cook_id)}` : ""}\n${sv.menu_aft ? `เมนู: ${sv.menu_aft}\n` : ""}\n🍛 กะบ่าย รวม ${tot("aft")} ที่\n${lines("aft")}\n\n🌙 OT รวม ${tot("ot")} ที่\n${lines("ot", true)}`);
  $("#cpNight").onclick = () => copy(`📋 ชุดอาหารแห้งกะดึก ${dTH(S.od)}${sv.menu_night ? ` (${sv.menu_night})` : ""}\nรวม ${tot("night")} ชุด\n${lines("night")}`);
  $("#xDay").onclick = () => {
    const wb = XLSX.utils.book_new();
    for (const k of KS) {
      const os = O.orders.filter(o => o.kind === k); if (!os.length) continue;
      const aoa = [[`${KTH[k]} · ${dTH(S.od)}${k !== "night" && sv.cook_id ? ` · ${vName(sv.cook_id)}` : ""}`], [], ["ลำดับ", "กลุ่ม", "รหัส", "ชื่อ", "ที่", "ผู้สั่ง"]];
      let i = 0; for (const g of gs) for (const o of of(g.id, k)) aoa.push([++i, g.name, o.emp_code || "", o.name, o.qty, o.by_name || ""]);
      aoa.push([], ["", "รวม", "", "", tot(k)]);
      const ws = XLSX.utils.aoa_to_sheet(aoa); ws["!cols"] = [{ wch: 6 }, { wch: 16 }, { wch: 14 }, { wch: 30 }, { wch: 6 }, { wch: 26 }];
      XLSX.utils.book_append_sheet(wb, ws, KTH[k].slice(0, 31));
    }
    XLSX.writeFile(wb, `สั่งอาหาร ${S.od}.xlsx`);
  };
}
// แก้รายชื่อของกลุ่ม/ประเภท ทีละคน: ค้นจากทะเบียน (พนักงาน + SUB) หรือพิมพ์เอง · จำนวนที่ · ย้ายประเภท
function editOrders(g, k, O) {
  let rows = O.orders.filter(o => o.group_id === g.id && o.kind === k).map(o => ({ emp_code: o.emp_code, name: o.name, qty: o.qty, note: o.note, kind: k }));
  const others = ["aft", "ot", "night"].filter(x => x !== k && g.kinds.includes(x));
  const m = modal(`${esc(g.name)} · ${KTH[k]} · ${dTH(S.od)}`, `<div style="display:flex;gap:8px"><input class="inp" id="eQ" list="ePpl" placeholder="พิมพ์ชื่อหรือรหัส แล้ว Enter (ไม่มีในทะเบียนพิมพ์ชื่อได้เลย)" style="flex:1" autocomplete="off">
      <button class="btn btn-p" id="eA">เพิ่ม</button></div>
    <datalist id="ePpl">${S.ix.list.filter(p => !p.left).map(p => `<option value="${esc(p.name)} (${esc(p.code)})">`).join("")}</datalist>
    <div class="tbl-wrap" style="max-height:48vh"><table class="tbl"><tbody id="eRows"></tbody></table></div>
    <div class="small muted" id="eSum"></div>`, "บันทึก", async () => {
    const keep = rows.filter(r => r.kind === k), moved = rows.filter(r => r.kind !== k);
    await run(() => rpc("cn_order_hr", { p_d: S.od, p_group: g.id, p_kind: k, p_rows: keep }));
    for (const x of others) {
      const add = moved.filter(r => r.kind === x); if (!add.length) continue;
      const cur = O.orders.filter(o => o.group_id === g.id && o.kind === x).map(o => ({ emp_code: o.emp_code, name: o.name, qty: o.qty, note: o.note }));
      await run(() => rpc("cn_order_hr", { p_d: S.od, p_group: g.id, p_kind: x, p_rows: cur.concat(add) }));
    }
    toast("บันทึกแล้ว", "success"); ordersPage();
  }, true);
  const draw = () => {
    m.querySelector("#eRows").innerHTML = rows.map((r, i) => `<tr><td class="n muted">${i + 1}</td><td><b>${esc(r.name)}</b>${r.emp_code ? ` <span class="small muted">${esc(r.emp_code)}</span>` : ""}</td>
      <td style="width:90px"><input class="inp" type="number" min="1" max="200" value="${r.qty}" data-q="${i}" style="height:32px"></td>
      ${others.length ? `<td style="width:150px"><select class="inp" data-mv="${i}" style="height:32px"><option value="${k}">${KTH[k]}</option>${others.map(x => `<option value="${x}" ${r.kind === x ? "selected" : ""}>ย้ายไป ${KTH[x]}</option>`).join("")}</select></td>` : ""}
      <td style="width:40px"><button class="btn btn-sm btn-ghost" data-x="${i}">${I.x}</button></td></tr>`).join("") || `<tr><td class="empty">ยังไม่มีรายชื่อ</td></tr>`;
    m.querySelector("#eSum").textContent = `รวม ${rows.filter(r => r.kind === k).reduce((s, r) => s + r.qty, 0)} ที่${rows.some(r => r.kind !== k) ? ` · ย้ายไปประเภทอื่น ${rows.filter(r => r.kind !== k).length} รายการ` : ""}`;
    m.querySelectorAll("[data-q]").forEach(x => x.onchange = () => { rows[+x.dataset.q].qty = Math.max(1, Math.min(200, +x.value || 1)); draw(); });
    m.querySelectorAll("[data-mv]").forEach(x => x.onchange = () => { rows[+x.dataset.mv].kind = x.value; draw(); });
    m.querySelectorAll("[data-x]").forEach(x => x.onclick = () => { rows.splice(+x.dataset.x, 1); draw(); });
  };
  const add = () => {
    const q = m.querySelector("#eQ"), v = q.value.trim(); if (!v) return;
    const mt = v.match(/^(.*)\(([A-Za-z0-9]+)\)\s*$/), code = mt ? mt[2].toUpperCase() : (S.ix.byCode.has(v.toUpperCase()) ? v.toUpperCase() : null);
    const name = mt ? mt[1].trim() : code ? S.ix.byCode.get(code).name : v;
    if (code && rows.some(r => r.emp_code === code)) { toast("มีชื่อนี้แล้ว", "error"); q.select(); return; }
    rows.push({ emp_code: code, name, qty: 1, kind: k }); q.value = ""; draw(); q.focus();
  };
  m.querySelector("#eA").onclick = add;
  m.querySelector("#eQ").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); add(); } };
  draw(); setTimeout(() => m.querySelector("#eQ").focus(), 50);
}
async function rosterModal(ym) {
  const M = await rpc("cn_month", { p_ym: ym }), sv = new Map(M.service.map(x => [x.d, x]));
  const last = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate(), days = Array.from({ length: last }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`);
  const n = (d, k) => M.counts.filter(c => c.d === d && c.kind === k).reduce((t, c) => t + c.n, 0);
  const m = modal(`ตารางแม่ครัวเวร · ${ym}`, `<div class="small muted">เลือกแม่ครัวรายวัน หรือใช้ “เติมตามเวร” — ใส่แม่ครัวเรียงตามลำดับ คนละกี่วัน แล้วเติมเฉพาะวันที่ยังว่าง</div>
    ${W() ? `<div class="grid-f"><label class="fld"><span>ลำดับเวร (กดเลือกตามลำดับ)</span><select class="inp" id="rV">${cookOpts()}</select></label>
      <label class="fld"><span>คนละ (วัน)</span><input class="inp" type="number" id="rN" value="1" min="1"></label>
      <div class="fld"><span>ลำดับ</span><div id="rSeq" class="small">—</div></div>
      <div style="display:flex;gap:8px;align-items:end"><button class="btn btn-sm" id="rAdd">+ เพิ่มในลำดับ</button><button class="btn btn-sm" id="rFill">เติมวันที่ว่าง</button></div></div>` : ""}
    <div class="tbl-wrap" style="max-height:52vh"><table class="tbl"><thead><tr><th>วันที่</th><th>แม่ครัวเวร</th><th class="r">กะบ่าย</th><th class="r">OT</th><th class="r">กะดึก</th></tr></thead><tbody>
    ${days.map(d => `<tr><td>${dTH(d)} <span class="small muted">${wd(d)}</span></td><td><select class="inp" data-rd="${d}" ${W() ? "" : "disabled"}>${cookOpts(sv.get(d)?.cook_id)}</select></td>
      <td class="r">${n(d, "aft") || ""}</td><td class="r">${n(d, "ot") || ""}</td><td class="r">${n(d, "night") || ""}</td></tr>`).join("")}</tbody></table></div>`, W() ? "บันทึกตาราง" : null, async mm => {
    const by = new Map();
    for (const s of mm.querySelectorAll("[data-rd]")) { const v = s.value || "", old = String(sv.get(s.dataset.rd)?.cook_id || ""); if (v !== old) (by.get(v) || by.set(v, []).get(v)).push(s.dataset.rd); }
    for (const [v, ds] of by) await run(() => rpc("cn_service_save", { p_days: ds, p_row: { cook_id: v || null } }));
    toast("บันทึกตารางแล้ว", "success"); if (location.hash.startsWith("#/orders")) ordersPage();
  }, true);
  const seq = [];
  m.querySelector("#rAdd")?.addEventListener("click", () => { const v = m.querySelector("#rV").value; if (!v) return; seq.push(+v); m.querySelector("#rSeq").textContent = seq.map(vName).join(" → "); });
  m.querySelector("#rFill")?.addEventListener("click", () => {
    if (!seq.length) { toast("เพิ่มแม่ครัวในลำดับก่อน", "error"); return; }
    const per = Math.max(1, +m.querySelector("#rN").value || 1); let i = 0;
    for (const s of m.querySelectorAll("[data-rd]")) { if (s.value) continue; s.value = String(seq[Math.floor(i / per) % seq.length]); i++; }
  });
}

// ---------------------------------------------------------------- กลุ่มผู้สั่ง · ลิงก์
async function groupsPage() {
  render(`<div class="fx-loading">กำลังโหลด…</div>`);
  await loadGroups();
  const depts = [...new Set(S.ix.list.filter(p => p.kind === "akr" && p.dept).map(p => p.dept))].sort();
  render(`${head("กลุ่มผู้สั่ง", "กลุ่มผู้สั่ง · ลิงก์สั่งอาหาร", "หนึ่งกลุ่ม = หนึ่งลิงก์ ส่งให้ผู้ประสานงานของกลุ่ม (ไม่ต้อง login) · ชื่ออังกฤษใช้ในบรรทัด OT ของใบ HRIN เช่น “Meal for Overtime work (Supply)”",
      `<a class="btn" href="#/orders">ดูรายชื่อที่สั่งวันนี้ →</a>${W() ? `<button class="btn btn-p" id="gNew">+ เพิ่มกลุ่ม</button>` : ""}`)}
    <div class="notice" style="margin-bottom:14px">${I.info}<div>แผนกสั่งผ่านลิงก์แล้ว รายชื่อขึ้นที่เมนู <a href="#/orders"><b>สั่งอาหาร · แม่ครัวเวร</b></a> ทันที (เลือกวัน · แก้/เพิ่ม/ลบรายชื่อได้ · โหลด Excel · คัดลอกส่งไลน์)</div></div>
    <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>กลุ่ม</th><th>ชื่อในใบ HRIN</th><th>สั่งได้</th><th>ผู้ประสานงาน</th><th>รายชื่อแนะนำจาก</th><th></th></tr></thead><tbody>
    ${S.G.map(g => `<tr class="${g.active ? "" : "zero"}"><td><b>${esc(g.name)}</b></td><td>${esc(g.en_name)}</td><td>${g.kinds.map(k => KTH[k]).join(", ")}</td><td>${esc(g.coord || "")}</td>
      <td class="small">${esc(g.depts.join(", "))}</td><td class="r" style="white-space:nowrap"><button class="btn btn-sm" data-cp="${g.id}">${I.copy}ลิงก์</button>${W() ? ` <button class="btn btn-sm btn-ghost" data-ge="${g.id}">แก้</button>` : ""}</td></tr>`).join("")
      || `<tr><td colspan="6" class="empty">ยังไม่มีกลุ่ม — เริ่มจากกลุ่มที่สั่งในไลน์ “อาหารกะบ่าย” เช่น Supply, Process, Gold Room, Maintenance, Project</td></tr>`}</tbody></table></div></div>
    <datalist id="dl">${depts.map(d => `<option value="${esc(d)}">`).join("")}</datalist>`);
  document.querySelectorAll("[data-cp]").forEach(b => b.onclick = () => { const g = S.G.find(x => x.id === +b.dataset.cp);
    navigator.clipboard.writeText(`ลิงก์สั่งอาหาร (กะบ่าย / OT / กะดึก) ของ ${g.name}\n${g.url}\nสั่งได้ถึง: กะบ่าย ${S.B.billing.cutoff.aft} น. · OT ${S.B.billing.cutoff.ot} น. · กะดึก ${S.B.billing.cutoff.night} น. ของวันนั้น`)
      .then(() => toast("คัดลอกลิงก์ + ข้อความแล้ว", "success")); });
  document.querySelectorAll("[data-ge]").forEach(b => b.onclick = () => groupModal(S.G.find(x => x.id === +b.dataset.ge)));
  $("#gNew") && ($("#gNew").onclick = () => groupModal({ name: "", en_name: "", kinds: ["aft", "ot", "night"], depts: [], active: true }));
}
function groupModal(g) {
  modal(g.id ? `แก้กลุ่ม ${esc(g.name)}` : "เพิ่มกลุ่มผู้สั่ง", `<div class="grid-f">
    <label class="fld"><span>ชื่อกลุ่ม</span><input class="inp" id="gN" value="${esc(g.name)}" placeholder="เช่น Supply"></label>
    <label class="fld"><span>ชื่อในใบ HRIN (อังกฤษ)</span><input class="inp" id="gE" value="${esc(g.en_name || "")}" placeholder="เช่น Supply, Gold Room"></label>
    <label class="fld"><span>ผู้ประสานงาน</span><input class="inp" id="gC" value="${esc(g.coord || "")}"></label>
    <label class="fld"><span>ลำดับ</span><input class="inp" type="number" id="gS" value="${g.sort || ""}"></label></div>
    <div class="fld"><span>สั่งได้</span><div>${["aft", "ot", "night"].map(k => `<label style="margin-right:14px"><input type="checkbox" data-gk="${k}" ${g.kinds.includes(k) ? "checked" : ""}> ${KTH[k]}</label>`).join("")}</div></div>
    <label class="fld"><span>รายชื่อแนะนำในหน้าสั่ง: แผนก/ส่วนงาน (คั่นด้วย ,)</span><input class="inp" id="gD" list="dl" value="${esc(g.depts.join(", "))}" placeholder="เช่น Supply, Processing"></label>
    <label><input type="checkbox" id="gA" ${g.active ? "checked" : ""}> ใช้งาน</label>
    ${g.id ? `<label><input type="checkbox" id="gT"> เปลี่ยนลิงก์ใหม่ (ลิงก์เดิมจะใช้ไม่ได้ — ใช้เมื่อลิงก์หลุดไปนอกกลุ่ม)</label>` : ""}`, "บันทึก", async m => {
    const row = { id: g.id, name: m.querySelector("#gN").value, en_name: m.querySelector("#gE").value, coord: m.querySelector("#gC").value, sort: m.querySelector("#gS").value,
      kinds: [...m.querySelectorAll("[data-gk]:checked")].map(x => x.dataset.gk), depts: m.querySelector("#gD").value.split(",").map(x => x.trim()).filter(Boolean),
      active: m.querySelector("#gA").checked };
    await run(() => rpc("cn_group_save", { p_row: row, p_new_link: !!m.querySelector("#gT")?.checked }), "บันทึกแล้ว"); groupsPage();
  });
}

// ---------------------------------------------------------------- รอบบิล → ร่าง HRIN (+ ไฟล์สรุปแนบ)
async function billingPage() {
  const last = new Date(Date.UTC(+S.ym.slice(0, 4), +S.ym.slice(5, 7), 0)).getUTCDate();
  const from = S.half === 1 ? `${S.ym}-01` : `${S.ym}-16`, to = S.half === 1 ? `${S.ym}-15` : `${S.ym}-${last}`;
  render(`<div class="fx-loading">กำลังโหลด…</div>`);
  let P; try { P = await rpc("cn_period", { p_from: from, p_to: to }); } catch (e) { render(`<div class="card card-b">${esc(e.message)}</div>`); return; }
  const ns = P.notices, ok = ns.filter(n => n.status === "signed");
  const days = []; for (let d = from; d <= to; d = addDay(d, 1)) days.push(d);
  const units = S.B.units, gAll = P.groups.filter(g => g.lines.length || g.bill);
  const total = gAll.reduce((t, g) => t + g.amount, 0);
  const st = b => !b ? "" : b.status === "deleted" ? `<span class="chip chip-gray">ร่างถูกลบแล้ว</span>` : b.status === "cancelled" ? `<span class="chip chip-gray">${esc(b.inv_no || "")} ยกเลิก</span>`
    : `<a class="chip chip-blue" href="/expense/#/invoice/${b.invoice_id}" target="_blank">${esc(b.inv_no || "ร่าง HRIN")} · ${esc({ draft: "ร่าง", review: "รอตรวจ", approval: "รออนุมัติ", approved: "อนุมัติแล้ว", received: "รับเงินแล้ว", rejected: "ส่งกลับ" }[b.status] || b.status)}</a>`;
  render(`${head("วางบิล", `รอบ ${dTH(from)} – ${dTH(to)}`, "ยืนยันยอดของรอบ → ระบบสร้างร่าง HRIN ใน HR Invoice Hub พร้อมแนบไฟล์สรุปรายวัน + รายชื่อ แล้วส่งตรวจ/อนุมัติตามขั้นตอนเดิม",
      `<input class="inp" type="month" id="ym" value="${S.ym}"><div class="seg" id="half"><button data-h="1" class="${S.half === 1 ? "on" : ""}">1–15</button><button data-h="2" class="${S.half === 2 ? "on" : ""}">16–สิ้นเดือน</button></div>`)}
    <div class="hero"><div class="hero-top"><div><div class="hero-l">ค่าอาหารทั้งรอบ (ก่อน VAT)</div><div class="hero-v">${money(total)}<small>บาท</small></div>
      <div class="hero-l">${gAll.length} ใบที่ต้องวางบิล · สร้างแล้ว ${gAll.filter(g => g.bill && !["cancelled", "deleted"].includes(g.bill.status)).length}</div></div></div></div>
    <div class="units">${gAll.map(g => billCard(g)).join("") || `<div class="empty">ยังไม่มียอดในรอบนี้</div>`}</div>
    <div class="card mt"><div class="card-h"><div><div class="card-t">ใบแจ้งยอดรายวัน (โรงอาหาร)</div><div class="card-s">ที่ลงนามแล้วในรอบนี้ · กดตัวเลขเพื่อพิมพ์</div></div>
      <div class="fx-actions"><button class="btn btn-sm" id="pAll" ${ok.length ? "" : "disabled"}>${I.print}พิมพ์ทั้งรอบ</button><button class="btn btn-sm" id="xAll" ${ok.length ? "" : "disabled"}>${I.dl}Excel รายชื่อ</button></div></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>วันที่</th>${units.map(u => `<th class="r">${esc(u.label)}</th>`).join("")}</tr></thead><tbody>
      ${days.map(d => `<tr><td><a href="#/day/${d}">${dTH(d)}</a> <span class="small muted">${wd(d)}</span></td>${units.map(u => { const n = ok.find(x => x.d === d && x.unit === u.key);
        return `<td class="r">${n ? `<a href="#" data-p="${n.id}" title="${esc(n.doc_no)}">${int(n.meals)}</a> <span class="small muted">${esc(n.doc_no.split("/")[1] || "")}</span>` : `<span class="muted">—</span>`}</td>`; }).join("")}</tr>`).join("")}
      </tbody></table></div></div>`);
  $("#ym").onchange = e => { S.ym = e.target.value; billingPage(); };
  document.querySelectorAll("#half button").forEach(b => b.onclick = () => { S.half = +b.dataset.h; billingPage(); });
  document.querySelectorAll("[data-p]").forEach(a => a.onclick = e => { e.preventDefault(); printIds([+a.dataset.p]); });
  $("#pAll").onclick = () => printIds(ok.map(n => n.id));
  $("#xAll").onclick = async () => { const r = await rpc("cn_print", { p_ids: ok.map(n => n.id) }); XLSX.writeFile(namesWorkbook(r.notices), `รายชื่อทานอาหาร ${from} ถึง ${to}.xlsx`); };
  document.querySelectorAll("[data-mk]").forEach(b => b.onclick = () => makeInvoice(gAll.find(g => g.grp === b.dataset.mk), from, to));
  document.querySelectorAll("[data-att]").forEach(b => b.onclick = async () => { const g = gAll.find(x => x.grp === b.dataset.att);
    try { await attachSummary(g, from, to, g.bill.invoice_id); toast("แนบไฟล์สรุปแล้ว", "success"); } catch (e) { toast(e.message, "error"); } });
}
function billCard(g) {
  const b = g.bill, live = b && !["cancelled", "deleted"].includes(b.status), isUnit = ["A1", "A2", "CN"].includes(g.grp);
  const v = S.B.vendors.find(x => x.code === g.vendor_code);
  return `<div class="unit ${live ? "signed" : ""}"><div class="uh"><div><b>${esc(g.title)}</b><span>${esc(v ? `${v.code} · ${v.name}` : "ยังไม่ระบุผู้ขาย")} · VAT ${g.vat}% · หัก ณ ที่จ่าย ${g.wht}%</span></div>
    ${live ? `<a class="chip chip-blue" href="/expense/#/invoice/${b.invoice_id}" target="_blank">${esc(b.inv_no || "ร่าง HRIN")}</a>` : b ? `<span class="chip chip-gray">ใบเดิม${b.status === "deleted" ? "ถูกลบ" : "ยกเลิก"}</span>` : `<span class="chip chip-gold">รอวางบิล</span>`}</div>
    <div class="big"><b>${int(g.meals)}</b><small>${isUnit ? "อิ่ม" : "ที่"} · ${g.days} วัน</small><em>฿${money(g.amount)}</em></div>
    <div class="ul" style="margin-top:8px">${g.lines.slice(0, 6).map(l => `<div class="small"><span>${esc(l.detail)}</span></div>`).join("")}${g.lines.length > 6 ? `<div class="small muted">… อีก ${g.lines.length - 6} บรรทัด</div>` : ""}</div>
    ${live ? `<div class="files"><div>สร้างโดย ${esc(b.by_name || "")} · ${tsTH(b.at)}${b.shop_count != null ? ` · ใบเรียกเก็บของร้าน ${int(b.shop_count)}` : ""}</div></div>
      <div class="uf"><a class="btn btn-sm" href="/expense/#/invoice/${b.invoice_id}" target="_blank">เปิดใน Invoice Hub</a>${W() ? `<button class="btn btn-sm btn-ghost" data-att="${g.grp}">แนบไฟล์สรุปอีกครั้ง</button>` : ""}</div>`
    : W() && S.B.can_invoice ? `<div class="uf" style="display:grid;gap:8px">${isUnit ? `<label class="fld" style="margin:0"><span>ยอดตามใบเรียกเก็บเงินของร้าน (อิ่ม)</span><input class="inp" data-sc="${g.grp}" type="number" placeholder="${g.meals}"></label>` : ""}
        <label class="fld" style="margin:0"><span>เลขที่ใบเรียกเก็บ/ใบเสร็จของร้าน</span><input class="inp" data-rf="${g.grp}" placeholder="เช่น 2569/60"></label>
        <button class="btn btn-p" data-mk="${g.grp}" ${g.vendor_code ? "" : "disabled"}>${I.send}สร้างร่าง HRIN + แนบสรุป</button></div>`
    : `<div class="uf small muted">${S.B.can_invoice ? "" : "ต้องมีสิทธิ์ออกใบแจ้งหนี้ HR (Invoice Hub) จึงสร้าง HRIN ได้"}</div>`}</div>`;
}
async function makeInvoice(g, from, to) {
  const sc = document.querySelector(`[data-sc="${g.grp}"]`)?.value.trim() || "", rf = document.querySelector(`[data-rf="${g.grp}"]`)?.value.trim() || "";
  const diff = sc && +sc !== g.meals;
  modal(`สร้างร่าง HRIN · ${esc(g.title)}`, `<div class="tbl-wrap"><table class="tbl"><tbody>${g.lines.map(l => `<tr><td class="small">${esc(l.detail)}</td><td class="r">฿${money(l.qty * l.price)}</td></tr>`).join("")}
      <tr><td><b>รวมก่อน VAT</b></td><td class="r"><b>฿${money(g.amount)}</b></td></tr></tbody></table></div>
    ${diff ? `<div class="notice gold">${I.warn}<div>ใบเรียกเก็บของร้าน <b>${int(sc)}</b> อิ่ม แต่ใบแจ้งยอดรายวันรวม <b>${int(g.meals)}</b> อิ่ม (ต่าง ${int(+sc - g.meals)}) — HRIN จะออกตามใบแจ้งยอดรายวัน ใส่เหตุผล/สิ่งที่ตกลงกับร้าน</div></div>
      <label class="fld"><span>เหตุผล (ต้องมี)</span><input class="inp" id="mkWhy"></label>` : `<label class="fld"><span>หมายเหตุ (ถ้ามี)</span><input class="inp" id="mkWhy"></label>`}
    <div class="small muted">ระบบสร้างร่างในชื่อคุณ · แนบ Excel สรุปรายวัน + รายชื่อ · จากนั้นเปิดใน Invoice Hub เพื่อตรวจและกด “ลงนามและส่งตรวจ” ตามปกติ</div>`, "สร้างร่าง", async m => {
    const why = m.querySelector("#mkWhy").value.trim();
    if (diff && !why) { toast("ใส่เหตุผลที่ยอดไม่ตรง", "error"); return false; }
    const r = await run(() => rpc("cn_invoice_make", { p_from: from, p_to: to, p_grp: g.grp, p_shop_count: sc || null, p_ref_no: rf || null, p_note: why || null }));
    try { await attachSummary(g, from, to, r.invoice_id); } catch (e) { toast("สร้างร่างแล้ว แต่แนบไฟล์ไม่สำเร็จ: " + e.message + " — กด “แนบไฟล์สรุปอีกครั้ง”", "error"); }
    toast(`สร้างร่าง HRIN แล้ว (${r.vendor} ฿${money(r.net)})`, "success"); billingPage();
  });
}
// ไฟล์สรุปแนบ HRIN: รายวัน + รายชื่อ (โรงอาหาร = จากใบแจ้งยอดที่ลงนาม · กะบ่าย/OT/กะดึก = จากรายการสั่ง)
async function attachSummary(g, from, to, invoiceId) {
  const det = await rpc("cn_period_detail", { p_from: from, p_to: to, p_grp: g.grp });
  const wb = XLSX.utils.book_new(), title = [[`${g.title} · รอบ ${dTH(from)} – ${dTH(to)}`], [`สรุปจาก Akara Canteen · ${tsTH(new Date().toISOString())}`], []];
  const sheet = (name, aoa, cols) => { const ws = XLSX.utils.aoa_to_sheet(aoa); ws["!cols"] = cols.map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, name); };
  if (det.notices) {
    const ks = ["akr", "sub", "forgot", "visit", "group", "carry"], lab = Object.fromEntries(C.CATS.map(c => [c.k, c.label]));
    const rows = det.notices.map(n => [dTH(n.d), n.doc_no, ...ks.map(k => n.lines.find(l => l.k === k)?.n || 0), n.meals, n.amount]);
    sheet("สรุปรายวัน", [...title, ["วันที่ทาน", "เลขที่ใบแจ้งยอด", ...ks.map(k => lab[k]), "รวมอิ่ม", "จำนวนเงิน"], ...rows,
      ["รวม", `${det.notices.length} ใบ`, ...ks.map((_, i) => rows.reduce((t, r) => t + r[2 + i], 0)), g.meals, det.notices.reduce((t, n) => t + n.amount, 0)]], [16, 18, 14, 14, 10, 12, 12, 10, 10, 14]);
    sheet("รายชื่อ", [...title, ["วันที่ทาน", "เลขที่", "หมวด", "รหัส", "ชื่อ", "อิ่ม"], ...det.notices.flatMap(n => (n.people || []).map(p => [dTH(n.d), n.doc_no, lab[p.c] || p.c, p.code, p.name, p.n]))], [16, 18, 26, 14, 30, 6]);
  } else {
    const o = det.orders, ks = g.grp === "night" ? ["night"] : ["aft", "ot"], gs = [...new Set(o.map(x => x.grp))].sort();
    for (const k of ks) {
      const ds = [...new Set(o.filter(x => x.kind === k).map(x => x.d))].sort();
      if (!ds.length) continue;
      const rows = ds.map(d => [dTH(d), ...gs.map(n => o.filter(x => x.d === d && x.kind === k && x.grp === n).reduce((t, x) => t + x.qty, 0)), o.filter(x => x.d === d && x.kind === k).reduce((t, x) => t + x.qty, 0)]);
      sheet(`สรุป ${KTH[k]}`.slice(0, 31), [...title, ["วันที่", ...gs, "รวม"], ...rows, ["รวม", ...gs.map((_, i) => rows.reduce((t, r) => t + r[1 + i], 0)), rows.reduce((t, r) => t + r[r.length - 1], 0)],
        [], [`ราคา ${S.B.billing.prices[k]} บาท`, "", "", "จำนวนเงิน", rows.reduce((t, r) => t + r[r.length - 1], 0) * S.B.billing.prices[k]]], [16, ...gs.map(() => 12), 10]);
    }
    sheet("รายชื่อ", [...title, ["วันที่", "ประเภท", "กลุ่ม", "รหัส", "ชื่อ", "ที่", "หมายเหตุ"], ...o.map(x => [dTH(x.d), KTH[x.kind], x.grp, x.emp_code || "", x.name, x.qty, x.note || ""])], [16, 16, 18, 14, 30, 6, 20]);
  }
  const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const name = `สรุป ${g.title.replace(/[\\/:*?"<>|]/g, "-")} ${from} ถึง ${to}.xlsx`;
  const path = `${invoiceId}/${Date.now()}_canteen_${g.grp.replace(/[^\w]/g, "_")}_${from}_${to}.xlsx`;
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const up = await supabase.storage.from("expense-files").upload(path, blob, { contentType: blob.type });
  if (up.error) throw new Error(up.error.message);
  const { data: { session } } = await supabase.auth.getSession();
  const { error } = await supabase.from("exp_files").insert({ invoice_id: invoiceId, path, name, size: blob.size, uploaded_by: session?.user?.id || null });
  if (error) throw new Error(error.message);
}


// ---------------------------------------------------------------- ตั้งค่า
function settingsPage() {
  const B = S.B, yr = +today().slice(0, 4);
  render(`${head("ตั้งค่า", "ร้าน · ราคา · เลขที่ · ผู้รับ", "ใบแจ้งยอด 1 ใบต่อจุดต่อวัน · Chatree North = ร้านเดียว 2 กล่อง รวมเป็นใบเดียว")}
    <div class="card"><div class="card-h"><div class="card-t">จุดสแกน / ร้าน</div></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>จุด</th><th>ชื่อร้านในใบ</th><th class="r">ราคา/อิ่ม</th><th>ชุดเลขที่</th><th class="r">เลขล่าสุดก่อนใช้ระบบ (${yr + 543})</th></tr></thead><tbody>
      ${B.units.map((u, i) => `<tr><td><b>${esc(u.label)}</b><div class="small muted">${u.boxes.map(boxLabel).join(" + ")}</div></td>
        <td><input class="inp" data-i="${i}" data-f="shop" value="${esc(u.shop || "")}" ${W() ? "" : "disabled"}></td>
        <td class="r"><input class="inp" style="width:90px" type="number" data-i="${i}" data-f="price" value="${u.price}" ${W() ? "" : "disabled"}></td>
        <td><input class="inp" style="width:110px" data-i="${i}" data-f="series" value="${esc(u.series)}" ${W() ? "" : "disabled"}><div class="small muted">ตัวอย่าง ${esc(C.docNo(u.series, yr, 1))}</div></td>
        <td class="r"><input class="inp" style="width:100px" type="number" data-last="${esc(u.series)}:${yr}" value="${B.last[`${u.series}:${yr}`] ?? ""}" placeholder="เช่น 327" ${W() ? "" : "disabled"}></td></tr>`).join("")}
      </tbody></table></div></div>
    <div class="card mt"><div class="card-h"><div><div class="card-t">ผู้รับใบแจ้งยอด (ร้านค้าสหกรณ์)</div><div class="card-s">คั่นหลายอีเมลด้วย , </div></div></div><div class="card-b grid-f">
      <label class="fld"><span>ถึง</span><input class="inp" id="mTo" value="${esc(B.mail.to || "")}" ${W() ? "" : "disabled"}></label>
      <label class="fld"><span>สำเนา (เช่น HR Team)</span><input class="inp" id="mCc" value="${esc(B.mail.cc || "")}" ${W() ? "" : "disabled"}></label></div></div>
    <div class="card mt"><div class="card-h"><div><div class="card-t">ราคา · เวลาปิดรับ · ผู้ขายในใบ HRIN</div><div class="card-s">รหัสผู้ขายตาม Invoice Hub · แม่ครัวกะบ่าย/OT ตั้งรายวันที่หน้า สั่งอาหาร</div></div></div>
      <div class="card-b grid-f">${["aft", "ot", "night"].map(k => `<label class="fld"><span>ราคา ${KTH[k]} (บาท)</span><input class="inp" type="number" data-pr="${k}" value="${B.billing.prices[k]}" ${W() ? "" : "disabled"}></label>
        <label class="fld"><span>ปิดรับ ${KTH[k]} (เวลา ของวันนั้น)</span><input class="inp" data-co="${k}" value="${esc(B.billing.cutoff[k])}" placeholder="10:30" ${W() ? "" : "disabled"}></label>`).join("")}
        ${B.units.map(u => `<label class="fld"><span>ผู้ขายในใบ HRIN · ${esc(u.label)}</span><input class="inp" data-uv="${u.key}" value="${esc(B.billing.unit_vendor[u.key] || "")}" ${W() ? "" : "disabled"}></label>`).join("")}
        <label class="fld"><span>ผู้ขายชุดกะดึก</span><input class="inp" id="bNv" value="${esc(B.billing.night_vendor)}" ${W() ? "" : "disabled"}></label>
        <label class="fld"><span>รหัสบัญชี (cost code)</span><input class="inp" id="bCc" value="${esc(B.billing.cost_code)}" ${W() ? "" : "disabled"}></label></div></div>
    ${W() ? `<div style="margin-top:16px;display:flex;justify-content:flex-end"><button class="btn btn-p" id="sSave">บันทึก</button></div>` : ""}`);
  $("#sSave") && ($("#sSave").onclick = async () => {
    const units = B.units.map((u, i) => { const o = { ...u }; document.querySelectorAll(`[data-i="${i}"]`).forEach(x => { o[x.dataset.f] = x.dataset.f === "price" ? +x.value : x.value.trim(); }); return o; });
    const last = {}; document.querySelectorAll("[data-last]").forEach(x => { if (x.value.trim()) last[x.dataset.last] = x.value.trim(); });
    const bill = { prices: {}, cutoff: {}, unit_vendor: {}, night_vendor: $("#bNv").value.trim(), cost_code: $("#bCc").value.trim() };
    document.querySelectorAll("[data-pr]").forEach(x => { bill.prices[x.dataset.pr] = +x.value; });
    document.querySelectorAll("[data-co]").forEach(x => { bill.cutoff[x.dataset.co] = x.value.trim(); });
    document.querySelectorAll("[data-uv]").forEach(x => { bill.unit_vendor[x.dataset.uv] = x.value.trim().toUpperCase(); });
    await run(() => rpc("cn_settings_save", { p_units: units, p_mail: { to: $("#mTo").value, cc: $("#mCc").value }, p_last: last, p_billing: bill }), "บันทึกแล้ว");
    S.B = await rpc("cn_boot", {}).then(b => ({ ...S.B, ...b })); settingsPage();
  });
}

// ---------------------------------------------------------------- ประวัติ
async function logPage() {
  const rows = await rpc("cn_log_list", { p_limit: 400 });
  render(`${head("ประวัติ", "ประวัติการทำงาน", "นำเข้าไฟล์ · คีย์ใบลงชื่อ · ยืนยันแตะซ้ำ · ลงนาม · ยกเลิก · ส่งสหกรณ์ · ตั้งค่า")}
    <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>เวลา</th><th>ผู้ทำ</th><th>วันที่ทาน</th><th>รายละเอียด</th></tr></thead><tbody>
    ${rows.map(x => `<tr><td class="small">${tsTH(x.at)}</td><td>${esc(x.by_name || "")}</td><td>${x.d ? `<a href="#/day/${x.d}">${dTH(x.d)}</a>` : ""}</td><td>${esc(x.detail || "")}</td></tr>`).join("")
      || `<tr><td colspan="4" class="empty">ยังไม่มีประวัติ</td></tr>`}</tbody></table></div></div>`);
}

boot();
