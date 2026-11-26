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

const S = { B: null, perms: new Set(), d: addDay(today(), -1), D: null, ix: null, emps: [], etype: "forgot", ebox: "A1", pick: null, q: "",
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
}
function route() {
  const [r, arg] = location.hash.replace(/^#\/?/, "").split("/");
  document.querySelectorAll("#fxNav a[data-r]").forEach(a => a.classList.toggle("on", a.dataset.r === (r || "day")));
  if ((r || "day") === "day" && arg && /^\d{4}-\d\d-\d\d$/.test(arg)) S.d = arg;
  ({ day: dayPage, dups: dupsPage, notices: noticesPage, settings: settingsPage, log: logPage }[r || "day"] || dayPage)();
  window.scrollTo(0, 0);
}
const navDup = n => { $("#navDup").textContent = n ? String(n) : ""; };

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
      <input type="file" id="fileIn" accept=".xlsx,.xls" multiple hidden></label>` : ""}
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
      return f ? `<div>${esc(boxLabel(b))}: ${f.people} คน · แตะ ${f.scans} ครั้ง${f.file_total != null && f.file_total !== f.scans ? ` <span class="miss">(Total ท้ายไฟล์ ${f.file_total})</span>` : ""}</div>`
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

// ---------------------------------------------------------------- สรุปรอบบิล
async function noticesPage() {
  const last = new Date(Date.UTC(+S.ym.slice(0, 4), +S.ym.slice(5, 7), 0)).getUTCDate();
  const from = S.half === 1 ? `${S.ym}-01` : `${S.ym}-16`, to = S.half === 1 ? `${S.ym}-15` : `${S.ym}-${last}`;
  render(`<div class="fx-loading">กำลังโหลด…</div>`);
  const ns = await rpc("cn_notices", { p_from: from, p_to: to }), ok = ns.filter(n => n.status === "signed");
  const days = []; for (let d = from; d <= to; d = addDay(d, 1)) days.push(d);
  const units = S.B.units, sum = k => ok.filter(n => n.unit === k.key);
  render(`${head("สรุปรอบบิล", `รอบ ${dTH(from)} – ${dTH(to)}`, "ผลรวมใบแจ้งยอดรายวันที่ลงนามแล้ว — ใบเรียกเก็บเงินของร้านปลายรอบต้องเท่ากับยอดนี้",
      `<input class="inp" type="month" id="ym" value="${S.ym}"><div class="seg" id="half"><button data-h="1" class="${S.half === 1 ? "on" : ""}">1–15</button><button data-h="2" class="${S.half === 2 ? "on" : ""}">16–สิ้นเดือน</button></div>
       <button class="btn" id="pAll" ${ok.length ? "" : "disabled"}>${I.print}พิมพ์ทั้งรอบ</button><button class="btn" id="xAll" ${ok.length ? "" : "disabled"}>${I.dl}Excel รายชื่อ</button>`)}
    <div class="kpis">${units.map(u => { const s = sum(u), m = s.reduce((t, n) => t + n.meals, 0);
      return `<div class="kpi"><div><div class="kpi-l">${esc(u.label)} · ${esc(u.shop || "")}</div><div class="kpi-v">฿${money(s.reduce((t, n) => t + n.amount, 0))}</div>
        <div class="kpi-d">${int(m)} อิ่ม × ${int(u.price)} · ${s.length} ใบ</div></div></div>`; }).join("")}</div>
    <div class="card mt"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>วันที่</th>${units.map(u => `<th class="r">${esc(u.label)}</th>`).join("")}</tr></thead><tbody>
      ${days.map(d => `<tr><td><a href="#/day/${d}">${dTH(d)}</a> <span class="small muted">${wd(d)}</span></td>${units.map(u => { const n = ok.find(x => x.d === d && x.unit === u.key), v = ns.filter(x => x.d === d && x.unit === u.key && x.status === "void").length;
        return `<td class="r">${n ? `<a href="#" data-p="${n.id}" title="${esc(n.doc_no)}">${int(n.meals)}</a> <span class="small muted">${esc(n.doc_no.split("/")[1] || "")}</span>` : `<span class="muted">—</span>`}${v ? ` <span class="chip chip-gray">ยกเลิก ${v}</span>` : ""}</td>`; }).join("")}</tr>`).join("")}
      <tr><td><b>รวมอิ่ม</b></td>${units.map(u => `<td class="r"><b>${int(sum(u).reduce((t, n) => t + n.meals, 0))}</b></td>`).join("")}</tr>
      <tr><td><b>รวมเงิน</b></td>${units.map(u => `<td class="r"><b>฿${money(sum(u).reduce((t, n) => t + n.amount, 0))}</b></td>`).join("")}</tr></tbody></table></div></div>
    <div class="notice mt">${I.info}<div>ขั้นถัดไป (กำลังทำ): ใส่ยอดตามใบเรียกเก็บเงินของร้าน → เทียบกับยอดนี้ → ยืนยัน → สร้างร่าง HRIN ใน HR Invoice Hub อัตโนมัติ</div></div>`);
  $("#ym").onchange = e => { S.ym = e.target.value; noticesPage(); };
  document.querySelectorAll("#half button").forEach(b => b.onclick = () => { S.half = +b.dataset.h; noticesPage(); });
  document.querySelectorAll("[data-p]").forEach(a => a.onclick = e => { e.preventDefault(); printIds([+a.dataset.p]); });
  $("#pAll").onclick = () => printIds(ok.map(n => n.id));
  $("#xAll").onclick = async () => { const r = await rpc("cn_print", { p_ids: ok.map(n => n.id) }); XLSX.writeFile(namesWorkbook(r.notices), `รายชื่อทานอาหาร ${from} ถึง ${to}.xlsx`); };
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
    ${W() ? `<div style="margin-top:16px;display:flex;justify-content:flex-end"><button class="btn btn-p" id="sSave">บันทึก</button></div>` : ""}`);
  $("#sSave") && ($("#sSave").onclick = async () => {
    const units = B.units.map((u, i) => { const o = { ...u }; document.querySelectorAll(`[data-i="${i}"]`).forEach(x => { o[x.dataset.f] = x.dataset.f === "price" ? +x.value : x.value.trim(); }); return o; });
    const last = {}; document.querySelectorAll("[data-last]").forEach(x => { if (x.value.trim()) last[x.dataset.last] = x.value.trim(); });
    await run(() => rpc("cn_settings_save", { p_units: units, p_mail: { to: $("#mTo").value, cc: $("#mCc").value }, p_last: last }), "บันทึกแล้ว");
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
