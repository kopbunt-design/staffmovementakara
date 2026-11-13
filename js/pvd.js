// ===== กองทุนสำรองเลี้ยงชีพ (PVD) — ทะเบียนสมาชิก · แจ้งเตือน · ยอดรายเดือน + ไฟล์ส่งกองทุน · user 2026-11-13 =====
// กติกาอยู่ใน pvd-calc.js (มีเทส) · ข้อมูลอยู่ในตาราง Azure-only (azure-app/pvd.py) ผ่าน supabase.rpc("pvd_…")
// ยอดเงินรายคนเดาเงินเดือนได้ → แท็บยอดรายเดือนต้องมี field.salary.read · ไฟล์เงินเดือนอ่านในเบราว์เซอร์ ส่งขึ้นเฉพาะยอดกองทุน
import { esc, toast, can, allEmployees } from "./app.js";
import { supabase } from "./supabase-config.js";
import * as P from "./pvd-calc.js";

const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const EN_M = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ymTH = ym => ym ? `${TH_M[+ym.slice(5, 7) - 1]} ${+ym.slice(0, 4) + 543}` : "-";
const dTH = d => d ? `${+d.slice(8, 10)} ${TH_M[+d.slice(5, 7) - 1]} ${+d.slice(0, 4) + 543}` : "-";
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);       // เวลาไทย
const pct = r => r == null ? "-" : `${+(r * 100).toFixed(2)}%`;
const baht = n => n == null ? "-" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const KIND = { tier_not_applied: "ขั้นสมทบยังไม่ปรับ", er_rate: "เงินสมทบไม่ตรง", emp_rate: "เงินสะสมไม่ตรง", not_member: "ไม่อยู่ในทะเบียน",
               missing: "ทะเบียนไม่ครบ", left: "ออกแล้วยัง active", no_deduct: "ไม่มีการหัก", no_pay: "ไม่มีในไฟล์เงินเดือน", no_join: "ไม่มีวันเริ่มงาน" };

const S = { tab: "alerts", D: null, q: "", fStatus: "active", ahead: 3, onlyChange: false,
            month: null /* { file, ym, payDate, pay, check } */, view: null /* { ym, items } */, imp: null };

const emps = () => new Map(allEmployees.map(e => [String(e.emp_code).toUpperCase(), e]));
const nameTH = (m, e) => (m?.first_th ? `${m.title_th || ""}${m.first_th} ${m.last_th || ""}` : [e?.firstname_th, e?.lastname_th].filter(Boolean).join(" ")) || "-";

async function load() {
  const { data, error } = await supabase.rpc("pvd_data");
  if (error) { toast("โหลดทะเบียน PVD ไม่ได้: " + error.message, "error"); S.D = { members: [], sections: [], runs: [], sent: [] }; return; }
  S.D = data;
}

export async function renderPvd() {
  const pg = document.getElementById("pagePvd");
  if (!can("page.pvd")) { pg.innerHTML = `<div class="empty-state" style="padding-top:80px;"><div class="empty-title">ไม่มีสิทธิ์เข้าถึง</div></div>`; return; }
  if (!S.D) { pg.innerHTML = `<div class="section mt-4 text-muted">กำลังโหลด…</div>`; await load(); }
  draw();
}

function draw() {
  const pg = document.getElementById("pagePvd"), D = S.D, act = D.members.filter(m => m.status === "active").length;
  const tabs = [["alerts", "แจ้งเตือน"], ["members", `ทะเบียนสมาชิก (${act})`], ...(D.can_money ? [["month", "ยอดรายเดือน / ไฟล์ส่งกองทุน"]] : []),
                ["log", "ประวัติการแก้ไข"], ...(D.can_write ? [["import", "นำเข้า"]] : [])];
  pg.innerHTML = `
  <div class="page-header"><div><div class="page-heading">กองทุนสำรองเลี้ยงชีพ (PVD)</div>
    <div class="page-sub">ทะเบียนสมาชิก · แจ้งเตือนขั้นเงินสมทบตามอายุงาน · ตรวจยอดจากไฟล์เงินเดือนและออกไฟล์ส่งกองทุน — ตามระเบียบสวัสดิการ AKR-OHR-SD-002 ข้อ 14</div></div></div>
  <div class="section" style="padding-top:12px;padding-bottom:0;"><div class="cp-tabs">
    ${tabs.map(([k, t]) => `<button class="cp-tab${S.tab === k ? " on" : ""}" data-tab="${k}">${t}</button>`).join("")}</div></div>
  <div class="section mt-4 pb-4" id="pvBody">${body()}</div>`;
  pg.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { S.tab = b.dataset.tab; draw(); });
  wire(pg);
}
const body = () => !S.D.members.length && S.tab !== "import"
  ? `<div class="card card-body">ยังไม่มีข้อมูลในทะเบียน${S.D.can_write ? ` — เริ่มจากแท็บ <b>นำเข้า</b> (ไฟล์ PVD Master เดิม)` : ""}</div>`
  : S.tab === "alerts" ? alertsHTML() : S.tab === "members" ? membersHTML() : S.tab === "month" ? monthHTML() : S.tab === "log" ? `<div id="pvLog" class="text-muted">กำลังโหลด…</div>` : importHTML();

// ---------------------------------------------------------------- แจ้งเตือน
const curYM = () => today().slice(0, 7);
function alertsHTML() {
  const E = emps(), M = S.D.members, ym = curYM();
  const tiers = P.tierAlerts(M, E, ym, S.ahead).filter(a => !S.onlyChange || a.changes);
  const ra = P.registerAlerts(M, allEmployees, today());
  const row = (code, cells) => { const e = E.get(code), m = M.find(x => x.emp_code === code);
    return `<tr><td><a href="#" data-open="${esc(code)}">${esc(code)}</a></td><td>${esc(nameTH(m, e))}</td><td class="text-muted">${esc(e?.department || "")}</td>${cells}</tr>`; };
  const card = (title, sub, n, inner) => `<div class="card mt-4"><div class="card-body" style="border-bottom:1px solid var(--border);">
      <div class="card-title" style="margin:0;">${title} <span class="badge ${n ? "badge-gold" : ""}">${n}</span></div><div class="text-muted" style="font-size:12.5px;">${sub}</div></div>
      ${n ? `<div style="overflow:auto;">${inner}</div>` : `<div class="card-body text-muted">ไม่มี</div>`}</div>`;
  return `
  ${card("อายุงานครบขั้น — เพดานเงินสมทบบริษัทเปลี่ยน",
    `ครบ 3 / 6 / 10 ปี → เพดาน 7% / 10% / 12% · มีผลรอบเงินเดือนเดือนถัดจากเดือนที่ครบ · แสดงรอบ ${ymTH(ym)} ถึง ${ymTH(P.ymAdd(ym, S.ahead))}
     <span style="margin-left:10px;">ล่วงหน้า <select id="pvAhead" class="form-input" style="width:auto;display:inline-block;padding:2px 6px;">${[1, 2, 3, 6, 12].map(n => `<option ${n === S.ahead ? "selected" : ""} value="${n}">${n} เดือน</option>`).join("")}</select></span>
     <label style="margin-left:10px;cursor:pointer;"><input type="checkbox" id="pvOnly" ${S.onlyChange ? "checked" : ""}> เฉพาะคนที่เงินสมทบเปลี่ยนจริง</label>`, tiers.length,
    `<table class="data-table"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>แผนก</th><th>วันเริ่มงาน</th><th>ครบ</th><th>มีผลรอบ</th><th style="text-align:right;">เงินสะสม</th><th style="text-align:right;">สมทบเดิม → ใหม่</th><th></th></tr></thead><tbody>
     ${tiers.map(a => row(a.emp_code, `<td>${dTH(E.get(a.emp_code)?.join_date)}</td><td>${a.years} ปี · ${dTH(a.anniv)}</td><td><b>${ymTH(a.eff)}</b></td>
       <td style="text-align:right;">${pct(a.empRate)}</td><td style="text-align:right;">${pct(a.erBefore)} → <b>${pct(a.erAfter)}</b></td>
       <td>${a.changes ? `<span class="badge badge-gold">ปรับเงินสมทบใน TigerSoft</span>` : `<span class="text-muted" style="font-size:12px;">ไม่เปลี่ยน (สะสม ≤ ${pct(a.capBefore)}) — แจ้งพนักงานว่าเพิ่มอัตราสะสมได้ถึง ${pct(a.capAfter)}</span>`}</td>`)).join("")}
    </tbody></table>`)}
  ${card("ออกจากงานแล้ว แต่ทะเบียน PVD ยังเป็นสมาชิก", "แจ้งบริษัทจัดการกองทุน แล้วกด “ปิดสมาชิก” · สิทธิ์ในเงินสมทบนับอายุงานรวมทดลองงาน (1 ปี 25% · 2 ปี 50% · 3 ปี 75% · 4 ปีขึ้นไป 100%)", ra.left.length,
    `<table class="data-table"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>แผนก</th><th>วันที่พ้นสภาพ</th><th>อายุงาน</th><th style="text-align:right;">สิทธิ์เงินสมทบ</th><th></th></tr></thead><tbody>
     ${ra.left.map(x => row(x.emp_code, `<td>${dTH(x.end)}</td><td>${x.years} ปี</td><td style="text-align:right;"><b>${Math.round(x.pct * 100)}%</b></td>
       <td>${S.D.can_write ? `<button class="btn btn-sm" data-close="${esc(x.emp_code)}" data-end="${esc(x.end)}">ปิดสมาชิก</button>` : ""}</td>`)).join("")}</tbody></table>`)}
  ${card("พ้นทดลองงานแล้ว ยังไม่อยู่ในทะเบียน PVD", "พนักงานประจำ พ้นทดลองงาน (วันที่ 119) · สมัครแล้วกด “เพิ่ม” · ไม่สมัครกด “ไม่สมัคร” จะได้ไม่ขึ้นซ้ำ · ส่งแบบฟอร์มให้กรอกได้ที่หน้าแบบฟอร์มกองทุน", ra.eligible.length,
    `<table class="data-table"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>แผนก</th><th>วันเริ่มงาน</th><th>พ้นทดลองงาน</th><th></th></tr></thead><tbody>
     ${ra.eligible.map(x => row(x.emp_code, `<td>${dTH(x.join)}</td><td>${dTH(x.probationEnd)}</td>
       <td style="white-space:nowrap;">${S.D.can_write ? `<button class="btn btn-sm btn-primary" data-add="${esc(x.emp_code)}">เพิ่ม</button> <button class="btn btn-sm" data-decline="${esc(x.emp_code)}">ไม่สมัคร</button>` : ""}</td>`)).join("")}</tbody></table>`)}
  ${card("ข้อมูลทะเบียนไม่ครบ", "ช่องที่ไฟล์ส่งกองทุนต้องใช้", ra.missing.length,
    `<table class="data-table"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>แผนก</th><th>ขาด</th></tr></thead><tbody>
     ${ra.missing.map(x => row(x.emp_code, `<td>${esc(x.miss.join(", "))}</td>`)).join("")}</tbody></table>`)}`;
}

// ---------------------------------------------------------------- ทะเบียน
function membersHTML() {
  const E = emps(), ym = curYM(), q = S.q.trim().toLowerCase();
  const list = S.D.members.filter(m => (!S.fStatus || m.status === S.fStatus)).map(m => ({ m, e: E.get(m.emp_code) }))
    .filter(({ m, e }) => !q || [m.emp_code, m.member_code, nameTH(m, e), e?.firstname_en, e?.lastname_en, e?.department].join(" ").toLowerCase().includes(q))
    .sort((a, b) => a.m.emp_code.localeCompare(b.m.emp_code));
  const counts = Object.fromEntries(Object.keys(P.STATUS_TH).map(k => [k, S.D.members.filter(m => m.status === k).length]));
  return `<div class="card card-body" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
      <input id="pvQ" class="form-input" style="max-width:280px;" placeholder="ค้นหา รหัส / ชื่อ / รหัสสมาชิก / แผนก" value="${esc(S.q)}">
      <select id="pvSt" class="form-input" style="width:auto;"><option value="">ทุกสถานะ (${S.D.members.length})</option>
        ${Object.entries(P.STATUS_TH).map(([k, t]) => `<option value="${k}" ${S.fStatus === k ? "selected" : ""}>${t} (${counts[k]})</option>`).join("")}</select>
      <span class="text-muted" style="font-size:12.5px;">${list.length} คน · สมทบปัจจุบัน = รอบ ${ymTH(ym)}</span>
      ${S.D.can_write ? `<button class="btn btn-sm btn-primary" id="pvNew" style="margin-left:auto;">+ เพิ่มสมาชิก</button>` : ""}
      <button class="btn btn-sm btn-gold" id="pvXlsx">📤 Excel</button></div>
    <div class="card mt-4" style="overflow:auto;"><table class="data-table"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>แผนก</th><th>รหัสสมาชิก</th><th>วันเริ่มงาน</th><th>อายุงาน</th>
      <th style="text-align:right;">สะสม</th><th style="text-align:right;">สมทบ</th><th style="text-align:right;">สิทธิ์เงินสมทบ*</th><th>แผน</th><th>สถานะ</th></tr></thead><tbody>
      ${list.map(({ m, e }) => { const j = e?.join_date?.slice(0, 10), y = j ? P.yearsAt(j, today()) : null;
        return `<tr style="cursor:pointer;" data-open="${esc(m.emp_code)}"><td>${esc(m.emp_code)}</td><td>${esc(nameTH(m, e))}</td><td class="text-muted">${esc(e?.department || "")}</td>
          <td>${esc(m.member_code || "-")}</td><td>${j ? dTH(j) : `<span style="color:var(--red);">ไม่มี</span>`}</td><td>${y ?? "-"}${y != null ? " ปี" : ""}</td>
          <td style="text-align:right;">${pct(m.emp_rate)}</td><td style="text-align:right;">${j && m.emp_rate ? pct(P.erRateFor(m.emp_rate, j, ym)) : "-"}</td>
          <td style="text-align:right;">${j ? Math.round(P.vestOf(j, today()).pct * 100) + "%" : "-"}</td><td>${esc(m.policy || "")}</td>
          <td>${m.status === "active" ? "เป็นสมาชิก" : `<span class="text-muted">${P.STATUS_TH[m.status] || m.status}${m.left_date ? " " + dTH(m.left_date) : ""}</span>`}</td></tr>`; }).join("")}
    </tbody></table></div>
    <div class="text-muted mt-2" style="font-size:12px;">* สิทธิ์ในเงินสมทบถ้าออกวันนี้ (อายุงานรวมทดลองงาน) · สมทบ = เท่าเงินสะสมแต่ไม่เกินเพดานตามอายุงาน</div>`;
}

function memberModal(code, preset = {}) {
  const E = emps(), m = S.D.members.find(x => x.emp_code === code) || null, isNew = !m;
  const e = code ? E.get(code) : null, w = S.D.can_write;
  const v = { status: "active", emp_rate: 0.05, ...(m || {}), ...preset };
  if (isNew && e) {
    v.first_th ||= e.firstname_th || ""; v.last_th ||= e.lastname_th || "";
    v.sec_code ||= P.guessSec(e, S.D.members, E);
    if (!v.dob && e.dob) { const [y, mo, d] = e.dob.slice(0, 10).split("-"); v.dob = `${d}${mo}${y}`; }   // คนใหม่ใช้ ค.ศ. เหมือนไฟล์เดิม
  }
  const j = e?.join_date?.slice(0, 10);
  const f = (k, label, extra = "", type = "text") => `<label class="form-group" style="margin:0;"><span class="form-label">${label}</span>
      <input class="form-input" data-f="${k}" type="${type}" value="${esc(v[k] == null ? "" : k === "emp_rate" ? +(v[k] * 100).toFixed(2) : String(v[k]))}" ${w ? "" : "disabled"} ${extra}></label>`;
  const portal = document.getElementById("modalPortal");
  portal.innerHTML = `<div class="modal-overlay" id="pvModal"><div class="modal" style="max-width:760px;">
    <div class="modal-header"><div><div class="modal-title">${isNew ? "เพิ่มสมาชิก PVD" : esc(code) + " · " + esc(nameTH(m, e))}</div>
      <div class="text-sm text-muted">${e ? `${esc(e.department || "")} · ${esc(e.position || "")} · เริ่มงาน ${dTH(j)}${j ? ` · อายุงาน ${P.yearsAt(j, today())} ปี · เพดานสมทบรอบนี้ ${pct(P.erCapFor(j, curYM()))}` : ""}${e.end_date ? ` · พ้นสภาพ ${dTH(e.end_date.slice(0, 10))}` : ""}` : ""}</div></div>
      <button class="modal-close" data-x>×</button></div>
    <div class="modal-body">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;">
        ${isNew ? `<label class="form-group" style="margin:0;"><span class="form-label">รหัสพนักงาน *</span><input class="form-input" id="pvCode" value="${esc(code || "")}" list="pvEmpList"></label>
          <datalist id="pvEmpList">${allEmployees.filter(x => !x.end_date).map(x => `<option value="${esc(x.emp_code)}">${esc([x.firstname_th, x.lastname_th].join(" "))}</option>`).join("")}</datalist>` : ""}
        ${f("member_code", "รหัสสมาชิก (CGM…)")}${f("sec_code", "รหัสสังกัด", `list="pvSecList"`)}
        <datalist id="pvSecList">${S.D.sections.map(s => `<option value="${esc(s.sec_code)}">${esc(s.name || "")}</option>`).join("")}</datalist>
        ${f("title_th", "คำนำหน้า")}${f("first_th", "ชื่อ (ไทย)")}${f("last_th", "นามสกุล (ไทย)")}
        ${f("id_card", "เลขบัตรประชาชน", `maxlength="13"`)}${f("dob", "วันเกิด (ddmmyyyy ตามไฟล์กองทุน)", `maxlength="8"`)}
        ${f("member_date", "วันที่เป็นสมาชิก", "", "date")}${f("emp_rate", "อัตราเงินสะสม (%)", `step="0.5" min="2" max="15"`, "number")}
        <label class="form-group" style="margin:0;"><span class="form-label">แผนการลงทุน</span><select class="form-input" data-f="policy" ${w ? "" : "disabled"}>
          <option value="">-</option>${["PF1103", "PF2103", "PF4103", "PF6103", "PFM103", "PF9103", "PFD103", "PFK103", "PFW103", "PFF103", "PFQ103", "PRF103"].map(p => `<option ${v.policy === p ? "selected" : ""}>${p}</option>`).join("")}</select></label>
        <label class="form-group" style="margin:0;"><span class="form-label">สถานะ</span><select class="form-input" data-f="status" ${w ? "" : "disabled"}>
          ${Object.entries(P.STATUS_TH).map(([k, t]) => `<option value="${k}" ${v.status === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        ${f("left_date", "วันที่ออกจากกองทุน", "", "date")}
      </div>
      <label class="form-group" style="margin-top:10px;"><span class="form-label">หมายเหตุ</span><textarea class="form-input" data-f="note" rows="2" ${w ? "" : "disabled"}>${esc(v.note || "")}</textarea></label>
      ${w ? `<label class="form-group"><span class="form-label">เหตุผลที่แก้ (เก็บในประวัติ)</span><input class="form-input" id="pvReason" placeholder="เช่น พนักงานขอเพิ่มอัตราสะสม (ปีละ 1 ครั้ง)"></label>` : ""}
      ${j && v.status !== "declined" ? `<div class="text-muted" style="font-size:12.5px;">ถ้าออกวันนี้ได้สิทธิ์เงินสมทบ ${Math.round(P.vestOf(j, today()).pct * 100)}% · ขั้นถัดไป: ${(() => { const n = [3, 6, 10].find(t => P.addYears(j, t) > today()); return n ? `ครบ ${n} ปี ${dTH(P.addYears(j, n))} → สมทบได้ถึง ${pct(P.capOf(n))} ตั้งแต่รอบ ${ymTH(P.ymAdd(P.addYears(j, n).slice(0, 7), 1))}` : "เพดานสูงสุดแล้ว (12%)"; })()}</div>` : ""}
      <div id="pvPerson" class="mt-4"></div>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" data-x>ปิด</button>${w ? `<button class="btn btn-primary" data-ok>บันทึก</button>` : ""}</div></div></div>`;
  const el = document.getElementById("pvModal"), close = () => el.remove();
  el.querySelectorAll("[data-x]").forEach(b => b.onclick = close);
  if (!isNew) personHistory(code, el.querySelector("#pvPerson"));
  el.querySelector("#pvCode")?.addEventListener("change", ev => { const c = ev.target.value.trim().toUpperCase(); close(); memberModal(c, collect(el)); });
  el.querySelector("[data-ok]")?.addEventListener("click", async () => {
    const c = isNew ? el.querySelector("#pvCode").value.trim().toUpperCase() : code;
    if (!c || !E.get(c)) { toast("ไม่พบรหัสพนักงานในทะเบียน", "error"); return; }
    if (isNew && S.D.members.some(x => x.emp_code === c)) { toast("คนนี้มีในทะเบียนแล้ว", "error"); return; }
    const row = collect(el);
    if (row.status === "active" && !(row.emp_rate >= 0.02 && row.emp_rate <= 0.15)) { toast("อัตราเงินสะสม 2–15%", "error"); return; }
    if (row.status === "left" && !row.left_date) { toast("ใส่วันที่ออกจากกองทุน", "error"); return; }
    const { data, error } = await supabase.rpc("pvd_member_save", { p_emp_code: c, p_row: row, p_reason: el.querySelector("#pvReason")?.value || null });
    if (error) { toast(error.message, "error"); return; }
    close(); toast(data.changed.length ? "บันทึกแล้ว" : "ไม่มีอะไรเปลี่ยน", "success"); await load(); draw();
  });
}
function collect(el) {
  const row = {}; el.querySelectorAll("[data-f]").forEach(i => { row[i.dataset.f] = i.value.trim() || null; });
  if (row.emp_rate != null) row.emp_rate = Math.round(Number(row.emp_rate) * 100) / 10000;
  if (row.id_card && !row.id_card.startsWith("•")) row.id_card = row.id_card.replace(/\D/g, "");
  return row;
}
async function personHistory(code, el) {
  const [{ data: log }, money] = await Promise.all([supabase.rpc("pvd_log", { p_emp_code: code }),
    S.D.can_money ? supabase.rpc("pvd_person", { p_emp_code: code }) : Promise.resolve({ data: null })]);
  el.innerHTML = `${money?.data?.length ? `<div class="form-label">ยอดที่ส่งกองทุน</div><table class="data-table"><thead><tr><th>รอบ</th><th style="text-align:right;">ฐาน</th><th style="text-align:right;">เงินสะสม</th><th style="text-align:right;">เงินสมทบ</th></tr></thead><tbody>
      ${money.data.slice().reverse().map(x => `<tr><td>${ymTH(x.ym)}</td><td style="text-align:right;">${baht(x.base)}</td><td style="text-align:right;">${baht(x.emp_amt)}</td><td style="text-align:right;">${baht(x.er_amt)}</td></tr>`).join("")}</tbody></table>` : ""}
    ${log?.length ? `<div class="form-label mt-4">ประวัติ</div>${log.map(x => `<div style="font-size:12.5px;padding:4px 0;border-bottom:1px solid var(--border);"><span class="text-muted">${dTH(x.at.slice(0, 10))} ${esc(x.by_name || "")}</span> · ${esc(x.detail || x.action)}</div>`).join("")}` : ""}`;
}

// ---------------------------------------------------------------- ยอดรายเดือน
function monthHTML() {
  const M = S.month, runs = S.D.runs;
  const ck = M?.check;
  const issues = ck ? ck.issues.filter(i => i.level === "warn") : [], infos = ck ? ck.issues.filter(i => i.level !== "warn") : [];
  const E = emps();
  return `<div class="card card-body">
      <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">
        <label class="form-group" style="margin:0;"><span class="form-label">รอบเงินเดือน</span><input type="month" class="form-input" id="pvYM" value="${M?.ym || curYM()}"></label>
        <label class="form-group" style="margin:0;"><span class="form-label">วันที่จ่ายเงินเดือน</span><input type="date" class="form-input" id="pvPay" value="${M?.payDate || `${M?.ym || curYM()}-22`}"></label>
        <input type="file" id="pvFile" accept=".xls,.xlsx" style="display:none;">
        <label for="pvFile" class="btn btn-primary" style="cursor:pointer;">📁 ไฟล์เงินเดือน TigerSoft (BeforeProcessYDP)</label>
        <span style="font-size:13px;">${M?.file ? "✅ " + esc(M.file) : `<span class="text-muted">ไฟล์เดียวกับที่ใช้ทำ Payroll Register · อ่านในเครื่อง ส่งขึ้นเฉพาะยอดกองทุน</span>`}</span>
      </div></div>
    ${ck ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;" class="mt-4">
        ${[["สมาชิกที่ส่งเงิน", ck.totals.members + " คน"], ["เงินสะสม", "฿" + baht(ck.totals.emp)], ["เงินสมทบ", "฿" + baht(ck.totals.er)], ["รวมส่งกองทุน", "฿" + baht(ck.totals.emp + ck.totals.er)],
           ["ต้องตรวจ", issues.length + " รายการ"]].map(([k, v], i) => `<div class="card card-body" style="padding:14px 16px;"><div class="text-muted" style="font-size:12px;">${k}</div><div style="font-size:20px;font-weight:700;${i === 4 && issues.length ? "color:var(--red);" : ""}">${v}</div></div>`).join("")}</div>
      <div class="card mt-4"><div class="card-body" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--border);">
        <div class="card-title" style="margin:0;">ตรวจยอดรอบ ${ymTH(M.ym)}</div>
        <div style="display:flex;gap:8px;"><button class="btn btn-gold" id="pvUp">📥 ไฟล์ส่งกองทุน (Akara Provident Fund_${EN_M[+M.ym.slice(5, 7) - 1]} ${M.ym.slice(0, 4)}.xlsx)</button>
          ${S.D.can_write ? `<button class="btn btn-primary" id="pvSave">💾 บันทึกยอดเดือนนี้</button>` : ""}</div></div>
        ${issues.length ? `<table class="data-table"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>เรื่อง</th><th>รายละเอียด</th></tr></thead><tbody>
          ${issues.map(i => `<tr><td><a href="#" data-open="${esc(i.emp_code)}">${esc(i.emp_code)}</a></td><td>${esc(nameTH(S.D.members.find(m => m.emp_code === i.emp_code), E.get(i.emp_code)))}</td>
            <td><span class="badge badge-gold">${KIND[i.kind] || i.kind}</span></td><td style="font-size:12.5px;">${esc(i.text)}</td></tr>`).join("")}</tbody></table>`
          : `<div class="card-body" style="color:var(--green);">✓ ยอดตรงกับทะเบียนและเพดานสมทบทุกคน</div>`}
        ${infos.length ? `<div class="card-body text-muted" style="font-size:12.5px;border-top:1px solid var(--border);">หมายเหตุ: ${infos.map(i => `${esc(i.emp_code)} ${esc(i.text)}`).join(" · ")}</div>` : ""}
      </div>` : ""}
    <div class="card mt-4"><div class="card-body" style="border-bottom:1px solid var(--border);"><div class="card-title" style="margin:0;">เดือนที่บันทึกแล้ว</div></div>
      ${runs.length ? `<table class="data-table"><thead><tr><th>รอบ</th><th style="text-align:right;">คน</th><th style="text-align:right;">เงินสะสม</th><th style="text-align:right;">เงินสมทบ</th><th>ที่มา</th><th>บันทึกโดย</th><th></th></tr></thead><tbody>
        ${runs.map(r => `<tr><td><b>${ymTH(r.ym)}</b></td><td style="text-align:right;">${r.members}</td><td style="text-align:right;">${baht(r.emp_total)}</td><td style="text-align:right;">${baht(r.er_total)}</td>
          <td class="text-muted" style="font-size:12px;">${r.source === "import" ? "นำเข้าจากไฟล์เดิม" : esc(r.file_name || "")}</td><td class="text-muted" style="font-size:12px;">${esc(r.saved_by_name || "")} ${r.saved_at ? dTH(r.saved_at.slice(0, 10)) : ""}</td>
          <td><button class="btn btn-sm" data-redl="${r.ym}" data-pay="${r.pay_date || ""}">📥 ไฟล์ส่งกองทุน</button></td></tr>`).join("")}</tbody></table>`
        : `<div class="card-body text-muted">ยังไม่มี</div>`}</div>`;
}

function readPayroll(file) {
  const fr = new FileReader();
  fr.onload = ev => {
    try {
      const wb = window.XLSX.read(new Uint8Array(ev.target.result), { type: "array" });
      const aoa = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
      const pay = P.parsePayroll(aoa), ym = document.getElementById("pvYM").value || curYM();
      S.month = { file: file.name, ym, payDate: document.getElementById("pvPay").value, pay };
      recheck(); draw();
    } catch (e) { toast("อ่านไฟล์ไม่ได้: " + e.message, "error"); }
  };
  fr.readAsArrayBuffer(file);
}
function recheck() { const M = S.month; if (M?.pay) M.check = P.checkMonth({ pay: M.pay, members: S.D.members, emps: emps(), ym: M.ym }); }

function downloadUpload(ym, payDate, items) {
  if (!payDate) { toast("ใส่วันที่จ่ายเงินเดือน", "error"); return; }
  // แผนการลงทุนใส่เฉพาะเดือนแรกที่คนนั้นส่งเงิน → คนที่เคยส่งในรอบก่อนหน้า ym ไม่ใส่
  const sent = new Set(Object.entries(S.D.first || {}).filter(([, f]) => f < ym).map(([c]) => c)), rows = P.uploadRows(items, S.D.members, payDate, sent);
  if (!S.D.can_write) { toast("ต้องมีสิทธิ์จัดการทะเบียน PVD (เลขบัตรเต็ม)", "error"); return; }
  const bad = rows.filter(r => !r[2] || !/^\d{13}$/.test(r[3]) || !r[4] || !r[1]);
  if (bad.length && !confirm(`${bad.length} คนข้อมูลทะเบียนไม่ครบ (รหัสสมาชิก/เลขบัตร/วันเกิด/รหัสสังกัด) — ดาวน์โหลดต่อไหม`)) return;
  const X = window.XLSX, aoa = [...P.UPLOAD_HEAD, ...rows], ws = X.utils.aoa_to_sheet(aoa);
  for (let r = 2; r < aoa.length; r++) for (const c of [1, 2, 3, 4, 5, 6, 7]) { const a = X.utils.encode_cell({ r, c }); if (ws[a]) { ws[a].t = "s"; ws[a].v = String(ws[a].v); ws[a].z = "@"; } }
  for (let r = 2; r < aoa.length; r++) for (const c of [9, 10]) { const a = X.utils.encode_cell({ r, c }); if (ws[a]) ws[a].z = "0.00"; }
  ws["!cols"] = [8, 8, 10, 16, 10, 10, 16, 18, 12, 12, 12, 10, 10].map(w => ({ wch: w }));
  const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, EN_M[+ym.slice(5, 7) - 1]);
  X.writeFile(wb, `Akara Provident Fund_${EN_M[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}.xlsx`);
  // แผนการลงทุนใส่ให้เฉพาะคนที่ยังไม่เคยส่งเงิน (เดือนแรก) — บอกให้รู้ว่าใครได้แผนลงไฟล์
  const withPlan = rows.filter(r => r[11]).length;
  toast(`ดาวน์โหลด ${rows.length} แถว${withPlan ? ` · ใส่แผนการลงทุน ${withPlan} คน (เดือนแรก)` : ""}`, "success");
}

async function saveMonth() {
  const M = S.month, ck = M.check, warn = ck.issues.filter(i => i.level === "warn").length;
  if (S.D.runs.some(r => r.ym === M.ym) && !confirm(`รอบ ${ymTH(M.ym)} บันทึกไว้แล้ว — แทนที่ด้วยไฟล์นี้?`)) return;
  if (warn && !confirm(`ยังมี ${warn} รายการต้องตรวจ — บันทึกตามไฟล์เงินเดือนไปก่อน?`)) return;
  const mem = new Map(S.D.members.map(m => [m.emp_code, m]));
  const items = ck.items.map(i => ({ emp_code: i.emp_code, member_code: mem.get(i.emp_code)?.member_code || null, base: i.base, emp_amt: i.emp_amt, er_amt: i.er_amt,
                                     emp_rate: i.emp_rate, er_cap: i.er_cap }));
  const { data, error } = await supabase.rpc("pvd_month_save", { p_ym: M.ym, p_pay_date: M.payDate || null, p_file: M.file, p_items: items });
  if (error) { toast(error.message, "error"); return; }
  toast(`บันทึก ${ymTH(M.ym)} แล้ว · ${data.members} คน`, "success"); await load(); draw();
}

// ---------------------------------------------------------------- นำเข้าไฟล์เดิม
function importHTML() {
  const I = S.imp;
  return `<div class="card card-body">
    <div class="card-title">นำเข้าไฟล์ทะเบียนเดิม (PVD Master)</div>
    <div class="text-muted" style="font-size:12.5px;line-height:1.8;">ใช้ชีต <b>DataPVD</b> (สมาชิก) · <b>รหัสสังกัด</b> · <b>Record</b> (ยอดรายเดือนที่ส่งแล้ว — นำเข้าเฉพาะเดือนที่ยังไม่มีในระบบ)<br>
      คนที่มีอยู่แล้วจะถูกแก้ตามไฟล์ และมีประวัติว่าเปลี่ยนอะไร · วันที่ในช่อง “วันที่มีผล” = วันที่ออกจากกองทุน</div>
    <div class="mt-4"><input type="file" id="pvMaster" accept=".xlsx,.xls" style="display:none;"><label for="pvMaster" class="btn btn-primary" style="cursor:pointer;">📁 เลือกไฟล์ PVD Master</label>
      ${I ? `<span style="margin-left:10px;">✅ ${esc(I.file)}</span>` : ""}</div>
    ${I ? `<div class="mt-4" style="font-size:13.5px;line-height:1.9;">สมาชิก ${I.data.members.length} คน (เป็นสมาชิก ${I.data.members.filter(m => m.status === "active").length} · ออกแล้ว ${I.data.members.filter(m => m.status === "left").length})
        · ใหม่ ${I.data.members.filter(m => !S.D.members.some(x => x.emp_code === m.emp_code)).length} คน · รหัสสังกัด ${I.data.sections.length}
        · ประวัติยอด ${[...new Set(I.data.history.map(h => h.ym))].map(ymTH).join(", ") || "-"}${S.D.can_money ? "" : " (ไม่นำเข้า — ไม่มีสิทธิ์เห็นเงินเดือน)"}
        ${I.unknown.length ? `<div style="color:var(--red);">รหัสพนักงานที่ไม่มีในทะเบียนพนักงาน: ${I.unknown.slice(0, 10).map(esc).join(", ")}${I.unknown.length > 10 ? " …" : ""}</div>` : ""}
        <div class="mt-2"><button class="btn btn-primary" id="pvDoImp">นำเข้า</button></div></div>` : ""}
  </div>`;
}
function readMaster(file) {
  const fr = new FileReader();
  fr.onload = ev => {
    try {
      const wb = window.XLSX.read(new Uint8Array(ev.target.result), { type: "array", cellDates: true });
      const sheets = Object.fromEntries(wb.SheetNames.map(n => [n.trim(), window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null })]));
      const data = P.parseMaster(sheets), E = emps();
      S.imp = { file: file.name, data, unknown: data.members.map(m => m.emp_code).filter(c => !E.has(c)) };
      draw();
    } catch (e) { toast("อ่านไฟล์ไม่ได้: " + e.message, "error"); }
  };
  fr.readAsArrayBuffer(file);
}

// ---------------------------------------------------------------- ปุ่ม
function wire(pg) {
  pg.querySelectorAll("[data-open]").forEach(a => a.onclick = ev => { ev.preventDefault(); memberModal(a.dataset.open); });
  const on = (id, ev, f) => { const x = pg.querySelector("#" + id); if (x) x[ev] = f; };
  on("pvAhead", "onchange", e => { S.ahead = +e.target.value; draw(); });
  on("pvOnly", "onchange", e => { S.onlyChange = e.target.checked; draw(); });
  on("pvQ", "oninput", e => { S.q = e.target.value; const p = e.target.selectionStart; draw(); const n = document.getElementById("pvQ"); n.focus(); n.setSelectionRange(p, p); });
  on("pvSt", "onchange", e => { S.fStatus = e.target.value; draw(); });
  on("pvNew", "onclick", () => memberModal(null));
  on("pvXlsx", "onclick", exportMembers);
  on("pvFile", "onchange", e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) readPayroll(f); });
  on("pvYM", "onchange", e => { if (S.month) { S.month.ym = e.target.value; recheck(); } else S.month = { ym: e.target.value }; draw(); });
  on("pvPay", "onchange", e => { (S.month ||= { ym: curYM() }).payDate = e.target.value; });
  on("pvUp", "onclick", () => downloadUpload(S.month.ym, S.month.payDate, S.month.check.items));
  on("pvSave", "onclick", saveMonth);
  on("pvMaster", "onchange", e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) readMaster(f); });
  on("pvDoImp", "onclick", async () => {
    const I = S.imp;
    if (!confirm(`นำเข้า ${I.data.members.length} คนจาก ${I.file}?`)) return;
    const { data, error } = await supabase.rpc("pvd_import", { p_members: I.data.members, p_sections: I.data.sections,
      p_history: S.D.can_money ? I.data.history : null, p_file: I.file });
    if (error) { toast(error.message, "error"); return; }
    toast(`เพิ่ม ${data.added} · แก้ ${data.updated} คน${data.months.length ? ` · ประวัติ ${data.months.map(ymTH).join(", ")}` : ""}`, "success");
    S.imp = null; await load(); S.tab = "members"; draw();
  });
  pg.querySelectorAll("[data-redl]").forEach(b => b.onclick = async () => {
    const { data, error } = await supabase.rpc("pvd_month", { p_ym: b.dataset.redl });
    if (error) { toast(error.message, "error"); return; }
    downloadUpload(b.dataset.redl, b.dataset.pay || `${b.dataset.redl}-22`, data.map(i => ({ ...i, ok: true })));
  });
  pg.querySelectorAll("[data-close]").forEach(b => b.onclick = () => {
    const m = S.D.members.find(x => x.emp_code === b.dataset.close);
    memberModal(b.dataset.close, { ...m, status: "left", left_date: b.dataset.end });
  });
  pg.querySelectorAll("[data-add]").forEach(b => b.onclick = () => memberModal(b.dataset.add));
  pg.querySelectorAll("[data-decline]").forEach(b => b.onclick = async () => {
    const note = prompt("ไม่สมัคร PVD — หมายเหตุ (เช่น วันที่แจ้ง / เหตุผล)", "");
    if (note === null) return;
    const e = emps().get(b.dataset.decline);
    const { error } = await supabase.rpc("pvd_member_save", { p_emp_code: b.dataset.decline,
      p_row: { status: "declined", first_th: e?.firstname_th, last_th: e?.lastname_th, note }, p_reason: "ไม่สมัคร" });
    if (error) { toast(error.message, "error"); return; }
    await load(); draw();
  });
  if (S.tab === "log") supabase.rpc("pvd_log", {}).then(({ data, error }) => {
    const el = document.getElementById("pvLog"); if (!el) return;
    el.innerHTML = error ? esc(error.message) : `<div class="card"><table class="data-table"><thead><tr><th>เวลา</th><th>โดย</th><th>รหัส</th><th>รายละเอียด</th></tr></thead><tbody>
      ${(data || []).map(x => `<tr><td style="white-space:nowrap;">${dTH(x.at.slice(0, 10))} ${x.at.slice(11, 16)}</td><td>${esc(x.by_name || "")}</td><td>${x.emp_code ? `<a href="#" data-open2="${esc(x.emp_code)}">${esc(x.emp_code)}</a>` : "-"}</td>
        <td style="font-size:12.5px;">${esc(x.detail || x.action)}</td></tr>`).join("")}</tbody></table></div>`;
    el.querySelectorAll("[data-open2]").forEach(a => a.onclick = ev => { ev.preventDefault(); memberModal(a.dataset.open2); });
  });
}

function exportMembers() {
  const E = emps(), ym = curYM(), X = window.XLSX;
  const rows = S.D.members.map(m => { const e = E.get(m.emp_code), j = e?.join_date?.slice(0, 10);
    return { "รหัสพนักงาน": m.emp_code, "ชื่อ": nameTH(m, e), "Department": e?.department || "", "Section": e?.section || "", "รหัสสังกัด": m.sec_code || "",
      "รหัสสมาชิก": m.member_code || "", "วันเริ่มงาน": j || "", "อายุงาน (ปี)": j ? P.yearsAt(j, today()) : "", "วันที่เป็นสมาชิก": m.member_date || "",
      "เงินสะสม %": m.emp_rate != null ? +(m.emp_rate * 100).toFixed(2) : "", "เงินสมทบ % (รอบนี้)": j && m.emp_rate ? +(P.erRateFor(m.emp_rate, j, ym) * 100).toFixed(2) : "",
      "สิทธิ์เงินสมทบถ้าออกวันนี้ %": j ? P.vestOf(j, today()).pct * 100 : "", "แผนการลงทุน": m.policy || "", "สถานะ": P.STATUS_TH[m.status] || m.status,
      "วันที่ออกจากกองทุน": m.left_date || "", "หมายเหตุ": m.note || "" }; });
  const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rows), "PVD");
  X.writeFile(wb, `PVD Register ${today()}.xlsx`);
}
