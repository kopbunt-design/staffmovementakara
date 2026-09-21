// ===== หน้าประวัติพนักงาน (Employee Profile) =====
// เปิดจากการคลิกแถวในตารางพนักงาน — รวมทุกอย่างที่ระบบรู้เกี่ยวกับคนคนนี้ไว้ที่เดียว
//
// แท็บที่มี = ข้อมูลที่ระบบมีจริงเท่านั้น ไม่สร้างแท็บเปล่าไว้หลอกตา
// (ครอบครัว / การศึกษา / ระบบเวลา ยังไม่มีตารางใน DB — ดู TODO.md ก้อน "ขยายประวัติพนักงาน")
import { supabase } from "./supabase-config.js";
import { allEmployees, allMovements, can, esc, fmtDate, avatarColor, initials,
         toast, navigate, movBadge } from "./app.js";

let profCode = null;             // พนักงานที่กำลังเปิดดู
let profTab  = "general";
let railQ    = "";               // คำค้นในแถบรายชื่อด้านซ้าย
let openDivs = null;             // Division ที่กางอยู่ (null = ยังไม่เคยตั้ง -> กางเฉพาะของคนที่เปิดดู)

// เรียกจากตารางพนักงาน
export function openEmployee(code) {
  if (profCode !== code) { profTab = "general"; uniCache = null; openDivs = null; }
  profCode = code;
  navigate("empprofile");
}

export const currentProfileCode = () => profCode;

// ===== ตัวช่วยคำนวณ =====
const empOf = code => allEmployees.find(e => e.emp_code === code) || null;
const fullTH = e => [e?.firstname_th, e?.lastname_th].filter(Boolean).join(" ").trim();
const fullEN = e => [e?.firstname_en, e?.lastname_en].filter(Boolean).join(" ").trim();

// ช่วงเวลาแบบ ปี/เดือน/วัน — ใช้ทั้งอายุตัวและอายุงาน
// นับแบบปฏิทินจริง (ยืมวันจากเดือนก่อนหน้า) ไม่ใช่หารด้วย 30 เพราะนี่คือข้อมูลบุคคล ไม่ใช่การจ่ายเงิน
function ymd(fromStr, toStr) {
  if (!fromStr) return null;
  const a = new Date(fromStr), b = toStr ? new Date(toStr) : new Date();
  if (isNaN(a) || isNaN(b) || b < a) return null;
  let y = b.getFullYear() - a.getFullYear();
  let m = b.getMonth() - a.getMonth();
  if (b.getDate() < a.getDate()) m--;        // ยังไม่ถึงวันครบเดือน
  if (m < 0) { y--; m += 12; }
  // นับวันที่เหลือจาก "วันครบเดือนล่าสุด" ถึงวันปลายทาง
  // ต้องหนีบวันให้อยู่ในเดือนนั้นก่อน ไม่งั้นคนเริ่มงานวันที่ 31 จะเพี้ยน:
  // 31 ม.ค. -> 1 มี.ค. ถ้าไม่หนีบ anchor จะกลายเป็น 2 มี.ค. แล้วได้ -1 วัน
  const ay = a.getFullYear() + y, am = a.getMonth() + m;
  const lastDay = new Date(ay, am + 1, 0).getDate();
  const anchor = new Date(ay, am, Math.min(a.getDate(), lastDay));
  const d = Math.round((b - anchor) / 86400000);
  return { y, m, d };
}
const ymdText = v => v ? `${v.y} ปี ${v.m} เดือน ${v.d} วัน` : "—";

// ไล่สายขึ้นไปหาหัวหน้าจนสุดสาย · กันวนลูปด้วย seen (DB มี trigger กันอยู่แล้ว แต่ข้อมูลเก่าอาจเพี้ยน)
function chainUp(emp) {
  const out = [], seen = new Set();
  let cur = emp;
  while (cur?.manager_code && !seen.has(cur.emp_code)) {
    seen.add(cur.emp_code);
    const up = empOf(cur.manager_code);
    if (!up || seen.has(up.emp_code)) break;
    out.push(up);
    cur = up;
  }
  return out;   // ใกล้ตัวที่สุดอยู่ต้นรายการ
}
const reportsOf = code => allEmployees
  .filter(e => e.manager_code === code && (!e.status || e.status === "Active"))
  .sort((a, b) => fullTH(a).localeCompare(fullTH(b), "th"));

const avatarHTML = (e, size = 40, radius = 12) => {
  const c = avatarColor(e.firstname_th || e.emp_code || "");
  return `<div class="ep-av" style="width:${size}px;height:${size}px;border-radius:${radius}px;
    background:${c}1A;color:${c};font-size:${Math.round(size * 0.34)}px;">${initials(fullTH(e))}</div>`;
};

const statusChip = e => {
  const s = e.status || "Active";
  const map = { Active:["var(--green)","var(--green-light)"], Resigned:["var(--red)","var(--red-light)"],
                Terminated:["var(--red)","var(--red-light)"], Retired:["var(--muted)","#f1f5f9"],
                Transferred:["var(--blue)","var(--blue-light)"] };
  const [c, bg] = map[s] || map.Active;
  return `<span class="ep-chip" style="color:${c};background:${bg};">${esc(s)}</span>`;
};

// ===== หน้า =====
export function renderEmployeeProfile() {
  const pg = document.getElementById("pageEmpprofile");
  const emp = empOf(profCode);

  if (!emp) {
    pg.innerHTML = `<div class="empty-state" style="padding-top:80px;">
      <div class="empty-title">ไม่พบพนักงาน</div>
      <div class="empty-sub">รหัส ${esc(profCode || "-")} ไม่มีอยู่ในระบบแล้ว</div>
      <button class="btn btn-secondary mt-4" onclick="window._epBack()">← กลับไปตารางพนักงาน</button></div>`;
    window._epBack = () => navigate("employees");
    return;
  }

  // กางกลุ่มของคนที่เปิดดูไว้ก่อน จะได้เห็นว่าตัวเองอยู่ตรงไหนของผัง
  if (openDivs === null) openDivs = new Set([emp.division || "ไม่ระบุ Division"]);

  pg.innerHTML = `<div class="ep-wrap">
    ${railHTML(emp)}
    <div class="ep-main">
      ${headerHTML(emp)}
      ${tabsHTML(emp)}
      <div class="ep-body" id="epBody">${bodyHTML(emp)}</div>
    </div>
  </div>`;

  wire(emp);
}

// ---------- แถบรายชื่อซ้าย ----------
function railHTML(emp) {
  const q = railQ.toLowerCase().trim();
  const list = allEmployees.filter(e => {
    if (!q) return true;
    return [e.emp_code, fullTH(e), fullEN(e), e.position, e.department].join(" ").toLowerCase().includes(q);
  });

  // จัดกลุ่มตาม Division — ผังเดียวกับที่ HR ใช้เรียกกันจริง
  const groups = new Map();
  for (const e of list) {
    const k = e.division || "ไม่ระบุ Division";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b, "th"));
  // ค้นหาอยู่ = กางทุกกลุ่ม ไม่งั้นพิมพ์แล้วเหมือนไม่เจออะไรเลย
  const isOpen = k => !!q || openDivs.has(k);

  return `<aside class="ep-rail">
    <div class="ep-rail-head">
      <button class="ep-back" onclick="window._epBack()" title="กลับไปตารางพนักงาน">
        <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        <span>ทะเบียนพนักงาน</span>
      </button>
      <div class="ep-rail-search">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input id="epRailQ" placeholder="ค้นชื่อ / รหัส" value="${esc(railQ)}" oninput="window._epRailQ(this.value)">
      </div>
    </div>
    <div class="ep-tree">
      ${keys.length === 0 ? `<div class="ep-tree-empty">ไม่พบพนักงานที่ตรงกับ “${esc(railQ)}”</div>` :
      keys.map(k => `
        <div class="ep-grp ${isOpen(k) ? "open" : ""}">
          <button class="ep-grp-head" onclick="window._epGrp('${esc(k).replace(/'/g, "\\'")}')">
            <svg class="ep-caret" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>
            <span class="ep-grp-name">${esc(k)}</span>
            <span class="ep-grp-n">${groups.get(k).length}</span>
          </button>
          ${isOpen(k) ? `<div class="ep-grp-list">${groups.get(k)
            .sort((a, b) => fullTH(a).localeCompare(fullTH(b), "th"))
            .map(e => `<button class="ep-person ${e.emp_code === emp.emp_code ? "on" : ""}" onclick="window._epGo('${esc(e.emp_code)}')">
              ${avatarHTML(e, 24, 7)}
              <span class="ep-person-txt">
                <span class="ep-person-name">${esc(fullTH(e) || e.emp_code)}</span>
                <span class="ep-person-sub">${esc(e.emp_code)}</span>
              </span>
            </button>`).join("")}</div>` : ""}
        </div>`).join("")}
    </div>
    <div class="ep-rail-foot">พนักงานทั้งหมด ${allEmployees.length} คน</div>
  </aside>`;
}

// ---------- หัวหน้าประวัติ ----------
function headerHTML(emp) {
  const mgr = empOf(emp.manager_code);
  const nReports = reportsOf(emp.emp_code).length;
  const path = [emp.division, emp.department, emp.section, emp.team].filter(Boolean);
  return `<div class="ep-hero">
    <div class="ep-hero-main">
      ${avatarHTML(emp, 68, 20)}
      <div class="ep-hero-txt">
        <div class="ep-hero-name">${esc(fullTH(emp) || "—")}</div>
        <div class="ep-hero-en">${esc(fullEN(emp) || "")}</div>
        <div class="ep-hero-tags">
          <span class="ep-code">${esc(emp.emp_code)}</span>
          ${emp.job_level ? `<span class="ep-chip ep-chip-level">${esc(emp.job_level)}</span>` : ""}
          ${statusChip(emp)}
          ${emp.contract_type ? `<span class="ep-chip ep-chip-gray">${esc(emp.contract_type)}</span>` : ""}
        </div>
        <div class="ep-hero-pos">${esc(emp.position || "ยังไม่ระบุตำแหน่ง")}</div>
        ${path.length ? `<div class="ep-hero-path">${path.map(esc).join(`<span class="ep-sep">›</span>`)}</div>` : ""}
      </div>
    </div>
    <div class="ep-hero-side">
      <div class="ep-hero-actions">
        <button class="btn btn-secondary btn-sm ep-back-wide" onclick="window._epBack()">← กลับ</button>
        ${can("data.employee.write") ? `<button class="btn btn-secondary btn-sm" onclick="window._epEdit()">แก้ไขข้อมูล</button>` : ""}
      </div>
      <div class="ep-quick">
        <div class="ep-quick-item"><span class="ep-quick-n">${ymd(emp.join_date, emp.end_date)?.y ?? "—"}</span><span class="ep-quick-l">ปีที่ทำงาน</span></div>
        <div class="ep-quick-item"><span class="ep-quick-n">${nReports}</span><span class="ep-quick-l">ลูกน้องโดยตรง</span></div>
        <div class="ep-quick-item"><span class="ep-quick-n">${mgr ? "1" : "—"}</span><span class="ep-quick-l">หัวหน้า</span></div>
      </div>
    </div>
  </div>`;
}

// ---------- แท็บ ----------
// แท็บเงินเดือนโผล่เฉพาะคนที่มีสิทธิ์ field.salary.read — ไม่ใช่ซ่อนแล้วยังโหลดข้อมูลมารอ
const tabsOf = () => [
  { k:"general", label:"ข้อมูลทั่วไป" },
  { k:"person",  label:"ข้อมูลส่วนตัว" },
  { k:"org",     label:"สายบังคับบัญชา" },
  { k:"history", label:"ประวัติการทำงาน" },
  { k:"uniform", label:"ยูนิฟอร์ม" },
  ...(can("field.salary.read") ? [{ k:"pay", label:"ค่าตอบแทน" }] : []),
  { k:"docs",    label:"เอกสารแนบ" },
];

function tabsHTML() {
  return `<div class="ep-tabs" id="epTabs">${tabsOf().map(t =>
    `<button class="ep-tab ${t.k === profTab ? "on" : ""}" onclick="window._epTab('${t.k}')">${esc(t.label)}</button>`
  ).join("")}</div>`;
}

function bodyHTML(emp) {
  switch (profTab) {
    case "person":  return tabPerson(emp);
    case "org":     return tabOrg(emp);
    case "history": return tabHistory(emp);
    case "uniform": return tabUniform(emp);
    case "pay":     return tabPay(emp);
    case "docs":    return tabDocs(emp);
    default:        return tabGeneral(emp);
  }
}

// ---------- ชิ้นส่วนที่ใช้ซ้ำ ----------
const field = (label, value, extra = "") => `<div class="ep-f">
  <div class="ep-f-l">${esc(label)}</div>
  <div class="ep-f-v ${value ? "" : "ep-f-empty"}">${value ? value : "—"}${extra}</div>
</div>`;
const plain = v => (v === 0 || v) ? esc(String(v)) : "";
const card = (title, inner, note = "") => `<section class="ep-card">
  <div class="ep-card-head"><h3>${esc(title)}</h3>${note ? `<span class="ep-card-note">${esc(note)}</span>` : ""}</div>
  ${inner}</section>`;
const empty = (title, sub) => `<div class="ep-empty"><div class="ep-empty-t">${esc(title)}</div><div class="ep-empty-s">${esc(sub)}</div></div>`;

// ---------- แท็บ: ข้อมูลทั่วไป ----------
function tabGeneral(emp) {
  const tenure = ymd(emp.join_date, emp.end_date);
  return `<div class="ep-cols">
    ${card("ตำแหน่งงาน", `<div class="ep-grid">
      ${field("Division", plain(emp.division))}
      ${field("Department", plain(emp.department))}
      ${field("Section", plain(emp.section))}
      ${field("Team", plain(emp.team))}
      ${field("ตำแหน่ง", plain(emp.position))}
      ${field("Job Level", emp.job_level ? `<span class="ep-chip ep-chip-level">${esc(emp.job_level)}</span>` : "")}
      ${field("พื้นที่ทำงาน", plain(emp.site))}
    </div>`)}
    ${card("การจ้างงาน", `<div class="ep-grid">
      ${field("ประเภทสัญญา", plain(emp.contract_type))}
      ${field("สถานะ", statusChip(emp))}
      ${field("วันเริ่มงาน", plain(fmtDate(emp.join_date) === "-" ? "" : fmtDate(emp.join_date)))}
      ${field("อายุงาน", tenure ? esc(ymdText(tenure)) : "", emp.end_date ? ` <span class="ep-note">(ถึงวันพ้นสภาพ)</span>` : "")}
      ${field("วันที่มีผล", plain(fmtDate(emp.effective_date) === "-" ? "" : fmtDate(emp.effective_date)))}
      ${field("วันพ้นสภาพ", plain(fmtDate(emp.end_date) === "-" ? "" : fmtDate(emp.end_date)),
              emp.end_date ? ` <span class="ep-note">(วันแรกที่ไม่ได้ทำงานแล้ว)</span>` : "")}
    </div>`)}
    ${card("หมายเหตุ", emp.remark
      ? `<div class="ep-remark">${esc(emp.remark)}</div>`
      : empty("ยังไม่มีหมายเหตุ", "ใช้บันทึกข้อมูลที่ไม่มีช่องรองรับ เช่น เงื่อนไขสัญญาพิเศษ"))}
  </div>`;
}

// ---------- แท็บ: ข้อมูลส่วนตัว ----------
function tabPerson(emp) {
  const age = ymd(emp.dob);
  return `<div class="ep-cols">
    ${card("ข้อมูลบุคคล", `<div class="ep-grid">
      ${field("ชื่อ-นามสกุล (ไทย)", plain(fullTH(emp)))}
      ${field("ชื่อ-นามสกุล (อังกฤษ)", plain(fullEN(emp)))}
      ${field("เพศ", plain(emp.gender))}
      ${field("วันเกิด", plain(fmtDate(emp.dob) === "-" ? "" : fmtDate(emp.dob)))}
      ${field("อายุ", age ? esc(`${age.y} ปี`) : "")}
      ${field("สัญชาติ", plain(emp.nationality))}
    </div>`)}
    ${card("การติดต่อ", `<div class="ep-grid">
      ${field("เบอร์โทร", emp.phone ? `<a href="tel:${esc(emp.phone)}" class="ep-link">${esc(emp.phone)}</a>` : "")}
      ${field("จังหวัด", plain(emp.province))}
    </div>`, "ข้อมูลส่วนบุคคล — ใช้เท่าที่จำเป็นตาม PDPA")}
  </div>`;
}

// ---------- แท็บ: สายบังคับบัญชา ----------
function tabOrg(emp) {
  const up = chainUp(emp);
  const dotted = empOf(emp.dotted_manager_code);
  const reports = reportsOf(emp.emp_code);

  const personRow = (e, tag = "") => `<button class="ep-prow" onclick="window._epGo('${esc(e.emp_code)}')">
    ${avatarHTML(e, 34, 10)}
    <span class="ep-prow-txt">
      <span class="ep-prow-name">${esc(fullTH(e) || e.emp_code)}${tag ? `<span class="ep-prow-tag">${esc(tag)}</span>` : ""}</span>
      <span class="ep-prow-sub">${esc([e.position, e.department].filter(Boolean).join(" · ") || e.emp_code)}</span>
    </span>
    ${e.job_level ? `<span class="ep-chip ep-chip-level">${esc(e.job_level)}</span>` : ""}
  </button>`;

  // สายขึ้น เรียงจากบนสุดลงมาหาคนคนนี้ — อ่านแล้วเห็นเป็นสายบังคับบัญชาจริง
  const ladder = [...up].reverse();

  return `<div class="ep-cols">
    ${card("สายบังคับบัญชาขึ้นไป", ladder.length ? `<div class="ep-ladder">
        ${ladder.map((e, i) => `<div class="ep-ladder-step" style="--lv:${i};">${personRow(e, i === ladder.length - 1 ? "หัวหน้าโดยตรง" : "")}</div>`).join("")}
        <div class="ep-ladder-step ep-ladder-self" style="--lv:${ladder.length};">
          <div class="ep-prow ep-prow-self">
            ${avatarHTML(emp, 34, 10)}
            <span class="ep-prow-txt">
              <span class="ep-prow-name">${esc(fullTH(emp))}<span class="ep-prow-tag ep-tag-self">คนนี้</span></span>
              <span class="ep-prow-sub">${esc([emp.position, emp.department].filter(Boolean).join(" · "))}</span>
            </span>
            ${emp.job_level ? `<span class="ep-chip ep-chip-level">${esc(emp.job_level)}</span>` : ""}
          </div>
        </div>
      </div>`
      : empty("ยังไม่ได้ตั้งหัวหน้า", "ตั้งได้ที่ปุ่มแก้ไขข้อมูล หรือนำเข้าทีเดียวหลายคนจากปุ่มสายบังคับบัญชาในตารางพนักงาน"))}

    ${card("หัวหน้าตามสายงาน (Dotted line)", dotted ? personRow(dotted)
      : empty("ไม่มี", "ใช้เมื่อรายงานข้ามสายงาน เช่น HRBP ที่ขึ้นตรงกับ HR แต่ทำงานประจำที่เหมือง"))}

    ${card(`ลูกน้องโดยตรง (${reports.length} คน)`, reports.length
      ? `<div class="ep-prow-list">${reports.map(e => personRow(e)).join("")}</div>`
      : empty("ไม่มีลูกน้องโดยตรง", "นับเฉพาะคนที่ตั้งพนักงานคนนี้เป็นหัวหน้า และยังมีสถานะ Active"))}
  </div>`;
}

// ---------- แท็บ: ประวัติการทำงาน ----------
function tabHistory(emp) {
  const rows = allMovements
    .filter(m => m.emp_code === emp.emp_code)
    .sort((a, b) => String(b.date || b.created_at || "").localeCompare(String(a.date || a.created_at || "")));

  const joinNode = emp.join_date ? `<li class="ep-tl-item ep-tl-join">
      <span class="ep-tl-dot"></span>
      <div class="ep-tl-card">
        <div class="ep-tl-top"><span class="ep-chip" style="color:var(--green);background:var(--green-light);">เริ่มงาน</span>
          <span class="ep-tl-date">${esc(fmtDate(emp.join_date))}</span></div>
        <div class="ep-tl-body">${esc([emp.position, emp.department].filter(Boolean).join(" · ") || "เข้าทำงาน")}</div>
      </div></li>` : "";

  return card(`ประวัติการเคลื่อนไหว (${rows.length} รายการ)`,
    (rows.length === 0 && !joinNode)
      ? empty("ยังไม่มีประวัติ", "รายการจะขึ้นเองเมื่อมีการบันทึกใน Staff Movement")
      : `<ul class="ep-tl">
          ${rows.map(m => `<li class="ep-tl-item">
            <span class="ep-tl-dot"></span>
            <div class="ep-tl-card">
              <div class="ep-tl-top">${movBadge(m.type)}<span class="ep-tl-date">${esc(fmtDate(m.date))}</span>
                ${m.attachment_path ? `<button class="ep-clip" title="${esc(m.attachment_name || "เอกสารแนบ")}" onclick="window._epDoc('${esc(m.attachment_path)}')">📎</button>` : ""}</div>
              <div class="ep-tl-body">
                ${(m.from_dept || m.to_dept) ? `<div class="ep-tl-move">${esc(m.from_dept || "—")}<span class="ep-sep">→</span>${esc(m.to_dept || "—")}</div>` : ""}
                ${m.job_level ? `<div class="ep-tl-meta">ระดับ ${esc(m.job_level)}</div>` : ""}
                ${m.cost_center ? `<div class="ep-tl-meta">Cost center ${esc(m.cost_center)}</div>` : ""}
                ${m.reason ? `<div class="ep-tl-reason">${esc(m.reason)}</div>` : ""}
              </div>
              ${m.recorded_by ? `<div class="ep-tl-by">บันทึกโดย ${esc(m.recorded_by)}</div>` : ""}
            </div></li>`).join("")}
          ${joinNode}
        </ul>`);
}

// ---------- แท็บ: ยูนิฟอร์ม ----------
// โหลดตอนเปิดแท็บเท่านั้น และ cache ไว้ต่อคน — คนส่วนใหญ่ไม่ได้เปิดดูทุกครั้ง
let uniCache = null;             // { code, rows } | "loading" | { code, error }
function tabUniform(emp) {
  if (uniCache === "loading") return card("ประวัติเบิกยูนิฟอร์ม", `<div class="ep-loading">กำลังโหลด…</div>`);
  if (uniCache?.error) return card("ประวัติเบิกยูนิฟอร์ม", empty("โหลดข้อมูลไม่สำเร็จ", uniCache.error));
  if (!uniCache || uniCache.code !== emp.emp_code) { loadUniform(emp.emp_code); return card("ประวัติเบิกยูนิฟอร์ม", `<div class="ep-loading">กำลังโหลด…</div>`); }

  const rows = uniCache.rows;
  const MOVE_TH = { issue:"จ่ายออก", return:"รับคืน", receive:"รับเข้า", adjust:"ปรับยอด" };
  const held = rows.reduce((n, r) => n - r.qty, 0);   // จ่ายออกเก็บเป็นลบ -> ติดลบกลับเป็นจำนวนที่ถืออยู่

  return card(`ยูนิฟอร์ม (${rows.length} รายการ)`, rows.length === 0
    ? empty("ยังไม่เคยเบิก", "รายการจะขึ้นเองเมื่อมีการจ่ายออกให้พนักงานคนนี้ในหน้าสต๊อกยูนิฟอร์ม")
    : `<div class="ep-uni-sum">ถืออยู่ตอนนี้ <b>${held}</b> ตัว</div>
       <table class="ep-table">
        <thead><tr><th>วันที่</th><th>รายการ</th><th>ประเภท</th><th class="ep-num">จำนวน</th><th>หมายเหตุ</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td class="ep-mono">${esc(fmtDate(r.moved_on))}</td>
          <td>${esc(r.uniform_item?.item_type || "-")} <b>${esc(r.uniform_item?.size || "")}</b></td>
          <td>${esc(MOVE_TH[r.move_type] || r.move_type)}</td>
          <td class="ep-num ${r.qty < 0 ? "ep-neg" : "ep-pos"}">${r.qty > 0 ? "+" : ""}${r.qty}</td>
          <td class="text-muted">${esc(r.note || "")}</td>
        </tr>`).join("")}</tbody></table>`,
    "จ่ายออกแสดงเป็นค่าลบ รับคืนเป็นค่าบวก");
}

async function loadUniform(code) {
  uniCache = "loading";
  const { data, error } = await supabase
    .from("uniform_move")
    .select("moved_on, move_type, qty, note, uniform_item(item_type, size)")
    .eq("emp_code", code)
    .order("moved_on", { ascending:false });
  uniCache = error ? { code, error: error.message } : { code, rows: data || [] };
  // ผู้ใช้อาจสลับแท็บไปแล้วระหว่างรอ — วาดใหม่เฉพาะตอนที่ยังอยู่แท็บนี้และยังดูคนเดิม
  if (profTab === "uniform" && profCode === code) {
    const el = document.getElementById("epBody");
    if (el) el.innerHTML = bodyHTML(empOf(code));
  }
}

// ---------- แท็บ: ค่าตอบแทน ----------
function tabPay(emp) {
  const salMovs = allMovements
    .filter(m => m.emp_code === emp.emp_code && m.salary)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const baht = n => Number(n).toLocaleString("th-TH", { minimumFractionDigits:2, maximumFractionDigits:2 });

  return `<div class="ep-cols">
    ${card("เงินเดือนปัจจุบัน", emp.salary
      ? `<div class="ep-salary"><span class="ep-salary-n">${baht(emp.salary)}</span><span class="ep-salary-u">บาท / เดือน</span></div>`
      : empty("ไม่มีข้อมูลเงินเดือน", "ยังไม่ได้บันทึกไว้ในทะเบียนพนักงาน"),
      "เห็นได้เฉพาะผู้มีสิทธิ์ field.salary.read")}
    ${card("การเปลี่ยนแปลงที่บันทึกไว้", salMovs.length
      ? `<table class="ep-table"><thead><tr><th>วันที่</th><th>รายการ</th><th class="ep-num">เงินเดือน</th></tr></thead>
         <tbody>${salMovs.map(m => `<tr><td class="ep-mono">${esc(fmtDate(m.date))}</td><td>${movBadge(m.type)}</td>
           <td class="ep-num"><b>${baht(m.salary)}</b></td></tr>`).join("")}</tbody></table>`
      : empty("ไม่มีรายการ", "การปรับเงินเดือนที่บันทึกผ่าน Staff Movement จะขึ้นที่นี่"))}
  </div>`;
}

// ---------- แท็บ: เอกสารแนบ ----------
function tabDocs(emp) {
  const docs = allMovements
    .filter(m => m.emp_code === emp.emp_code && m.attachment_path)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  return card(`เอกสารแนบ (${docs.length} ไฟล์)`, docs.length
    ? `<div class="ep-docs">${docs.map(m => `<button class="ep-doc" onclick="window._epDoc('${esc(m.attachment_path)}')">
        <span class="ep-doc-ico">📄</span>
        <span class="ep-doc-txt">
          <span class="ep-doc-name">${esc(m.attachment_name || "เอกสาร")}</span>
          <span class="ep-doc-sub">${esc(m.type || "")} · ${esc(fmtDate(m.date))}</span>
        </span></button>`).join("")}</div>`
    : empty("ยังไม่มีเอกสาร", "ไฟล์ที่แนบตอนบันทึก Staff Movement จะมารวมอยู่ที่นี่"),
    "เปิดผ่านลิงก์ชั่วคราวอายุ 60 วินาที");
}

// ===== ผูก event =====
function wire(emp) {
  window._epBack  = () => navigate("employees");
  window._epGo    = code => { openEmployee(code); };
  window._epTab   = k => {
    profTab = k;
    const tabs = document.getElementById("epTabs");
    if (tabs) tabs.outerHTML = tabsHTML();
    const el = document.getElementById("epBody");
    if (el) el.innerHTML = bodyHTML(emp);
  };
  window._epRailQ = v => {
    railQ = v;
    const rail = document.querySelector(".ep-rail");
    if (!rail) return;
    rail.outerHTML = railHTML(emp);
    // วาดแถบซ้ายใหม่แล้ว input ตัวเดิมหายไป ต้องคืนโฟกัสกับตำแหน่งเคอร์เซอร์เอง
    const box = document.getElementById("epRailQ");
    if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  };
  window._epGrp = k => {
    openDivs.has(k) ? openDivs.delete(k) : openDivs.add(k);
    const rail = document.querySelector(".ep-rail");
    if (rail) rail.outerHTML = railHTML(emp);
  };
  window._epEdit = async () => (await import("./employees.js")).openEmpForm(emp.emp_code);
  // bucket เป็น private — ขอ signed URL อายุสั้นทุกครั้งที่กด (ก๊อปวิธีเดียวกับหน้า Staff Movement)
  window._epDoc = async path => {
    const { data, error } = await supabase.storage.from("movement-docs").createSignedUrl(path, 60);
    if (error || !data?.signedUrl) { toast("เปิดเอกสารไม่ได้: " + (error?.message || "ไม่พบไฟล์"), "error"); return; }
    window.open(data.signedUrl, "_blank");
  };
}
