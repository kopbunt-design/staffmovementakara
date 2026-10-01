import { esc, navigate, appLang } from "./app.js";

// ============================================================================
// หน้าหลัก — รวมทุกระบบเป็นการ์ด จัดเป็นกลุ่มตามแถบเมนูข้าง
//
// รายการการ์ดอ่านจากแถบเมนูข้าง (index.html) ตรง ๆ ไม่ได้เขียนซ้ำไว้ที่นี่
//   → เพิ่มเมนูใหม่ในแถบข้าง การ์ดโผล่เองทันที · เมนูที่ถูกซ่อนเพราะไม่มีสิทธิ์ ก็ไม่โผล่เป็นการ์ด
// ไฟล์นี้เก็บแค่ส่วนที่แถบข้างไม่มี: คำอธิบายสั้น · ไอคอน · สีของกลุ่ม
// ============================================================================

const RECENT_KEY = "home_recent";

// คำอธิบายใต้ชื่อ + ไอคอน (path ของ SVG 24×24 แบบเส้น) — หน้าที่ไม่อยู่ในตารางใช้ไอคอนกลาง
const META = {
  dashboard:       ["ภาพรวมกำลังคนและความเคลื่อนไหวล่าสุด", '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'],
  employees:       ["ทะเบียนพนักงานและประวัติรายคน", '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18.5 14.8c1.7.7 2.7 2.4 3 5.2"/>'],
  movements:       ["บันทึกและอนุมัติการเข้า–ออก–ย้าย", '<path d="M4 7h13l-3.5-3.5"/><path d="M20 17H7l3.5 3.5"/>'],
  uniform:         ["รับเข้า จ่ายออก ยอดคงเหลือ", '<path d="M8 3 4 5.5 2.5 10l3 1.2V21h13V11.2l3-1.2L20 5.5 16 3a4 4 0 0 1-8 0Z"/>'],
  fundforms:       ["คำเชิญและคำขอ PVD / สกล.5", '<path d="M12 3 4 6.5V12c0 4.4 3.3 8 8 9 4.7-1 8-4.6 8-9V6.5Z"/><path d="m8.8 12 2.2 2.2 4.3-4.4"/>'],
  shiftallow:      ["คำนวณค่ากะจากไฟล์ timesheet", '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'],
  shiftcompare:    ["เทียบค่ากะรายคนระหว่างสองเดือน", '<path d="M5 20V10"/><path d="M12 20V4"/><path d="M19 20v-7"/>'],
  payroll:         ["รายงานเงินเดือนรายเดือน", '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'],
  payrollexp:      ["ค่าใช้จ่ายเงินเดือนย้อนหลัง", '<path d="M3 20h18"/><path d="M5 16l4.5-5 3.5 3 6-7"/><path d="M15 7h4v4"/>'],
  payrollbuild:    ["สร้างรายงานจากไฟล์เงินเดือนดิบ", '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M12 11v6M9 14h6"/>'],
  payrollapproval: ["ใบสรุปเพื่ออนุมัติจ่ายเงินเดือน", '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="m9 14 2 2 4-4"/>'],
  contractpay:     ["งวดจ่ายที่ปรึกษา / จ้างเหมา หัก 3%", '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M7 15h3"/>'],
  headcount:       ["จำนวนคนรายเดือนตามสังกัด", '<circle cx="12" cy="7" r="3"/><path d="M6 20c.6-3.3 3-5 6-5s5.4 1.7 6 5"/>'],
  movreport:       ["เข้าใหม่ ลาออก และอัตราการลาออก", '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>'],
  workforce:       ["ภาพรวมกำลังคนสำหรับผู้บริหาร", '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12h8.5"/>'],
  analytics:       ["วิเคราะห์ข้อมูลกำลังคนเชิงลึก", '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'],
  docregister:     ["ออกเลขหนังสือ HR / Memo และค้นย้อนหลัง", '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M9.5 17V12M12.5 17v-5M9 12h4.5M8.5 14.5h5"/>'],
  vacancy:         ["โควตาตำแหน่งและอัตราว่าง", '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>'],
  users:           ["บัญชีผู้ใช้และสิทธิ์การเข้าถึง", '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-3.4 3.4-5.5 7-5.5s6.3 2.1 7 5.5"/>'],
  settings:        ["ข้อมูลหลัก: ฝ่าย แผนก ตำแหน่ง ระดับ", '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'],
};
// คำอธิบายภาษาอังกฤษ (ปุ่ม EN) — ชื่อเมนูแปลจากแถบข้างอยู่แล้ว ตรงนี้แปลเฉพาะส่วนที่หน้าหลักมีเอง
const META_EN = {
  dashboard: "Workforce snapshot and latest movements", employees: "Employee records and profiles",
  movements: "Record and approve joiners, leavers, transfers", uniform: "Stock in, issue out, balances",
  fundforms: "PVD / WEF invitations and requests", shiftallow: "Calculate shift pay from timesheets",
  shiftcompare: "Compare shift pay between two months", payroll: "Monthly payroll report",
  payrollexp: "Payroll cost history", payrollbuild: "Build the register from raw payroll files",
  payrollapproval: "Summary for payroll approval", contractpay: "Consultant / contractor pay runs, 3% WHT",
  headcount: "Monthly headcount by unit", movreport: "Joiners, leavers and turnover",
  workforce: "Executive workforce overview", analytics: "In-depth workforce analysis",
  vacancy: "Position quotas and vacancies", docregister: "Issue HR letter / memo numbers and search history", users: "User accounts and access",
  settings: "Master data: divisions, departments, positions, levels",
};
const GROUP_EN = {
  "grp.records": "People, movements and benefits", "grp.pay": "Shift pay, payroll, approvals, contract pay",
  "grp.reports": "Dashboard, headcount, movement, analytics", "grp.plan": "Position quotas and vacancies",
  "grp.docs": "Document numbers, certificates, offer letters",
  "grp.system": "Users, access and master data",
};
const UI = {
  th: { hello: "สวัสดี", you: "คุณ", search: "ค้นหาเมนู เช่น ค่ากะ, กองทุน, headcount", recent: "ใช้ล่าสุด",
        menus: n => `${n} เมนู`, none: q => `ไม่พบเมนูที่ตรงกับ “${q}”`, close: "ปิด", locale: "th-TH" },
  en: { hello: "Hello", you: "", search: "Search menus, e.g. shift, fund, headcount", recent: "Recent",
        menus: n => `${n} menu${n === 1 ? "" : "s"}`, none: q => `No menu matches “${q}”`, close: "Close", locale: "en-GB" },
};
const en = () => appLang === "en";
const ui = () => UI[en() ? "en" : "th"];
const desc = page => en() ? (META_EN[page] || "") : ((META[page] || [])[0] || "");
const gDesc = g => en() ? (GROUP_EN[g.key] || "") : ((GROUP_META[g.key] || [])[0] || "");
const FALLBACK_ICON = '<rect x="4" y="4" width="16" height="16" rx="3"/>';
// สีประจำกลุ่ม ตามลำดับกลุ่มในแถบข้าง — ไล่สีให้แต่ละกลุ่มแยกด้วยตาได้ทันที
const TONES = ["blue", "green", "purple", "teal", "amber", "slate"];
// เมนูที่ไม่อยู่ใต้หัวกลุ่มใด (ตอนนี้คือ "ภาพรวม") ไปอยู่หน้าสุดของกลุ่มรายงาน — การ์ดเดี่ยวกลุ่มเดียวดูโหรง
const LOOSE_INTO = "grp.reports";

// อ่านกลุ่มและเมนูจากแถบข้าง เฉพาะเมนูที่มองเห็น (ผ่านการเช็กสิทธิ์แล้ว)
function readNav() {
  const groups = [];
  let cur = { name: "เริ่มต้น", items: [] };
  for (const el of document.querySelectorAll(".sidebar-nav > *")) {
    if (el.classList.contains("nav-section")) {
      if (cur.items.length) groups.push(cur);
      // อ่านเฉพาะป้ายชื่อหมวด — หัวหมวดมีป้ายงานค้าง (.nav-sec-badge) ต่อท้ายด้วย ถ้าใช้ textContent ทั้งก้อนจะได้ "ชื่อ 0"
      const lab = el.querySelector("[data-i18n]") || el.querySelector("span");
      cur = { key: lab?.dataset.i18n || "", name: (lab?.textContent || el.textContent).trim(), items: [] };
    } else if (el.matches(".nav-item[data-page]") && el.style.display !== "none" && el.dataset.page !== "home") {
      const label = el.querySelector("span")?.textContent.trim() || el.dataset.page;
      const badge = el.querySelector(".nav-badge, .nav-count");
      const n = badge && badge.style.display !== "none" ? badge.textContent.trim() : "";
      cur.items.push({ page: el.dataset.page, label, badge: n, alert: !!badge?.classList.contains("nav-badge") });
    }
  }
  if (cur.items.length) groups.push(cur);
  const loose = groups[0]?.name === "เริ่มต้น" ? groups.shift() : null;
  const host = loose && (groups.find(g => g.key === LOOSE_INTO) || groups[0]);
  if (host) host.items.unshift(...loose.items); else if (loose) groups.unshift(loose);
  return groups;
}

let query = "";

export function pushRecent(page) {
  if (!page || page === "home") return;
  try {
    const r = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").filter(p => p !== page);
    localStorage.setItem(RECENT_KEY, JSON.stringify([page, ...r].slice(0, 4)));
  } catch { /* เบราว์เซอร์ปิด storage ก็แค่ไม่มีแถบใช้ล่าสุด */ }
}
const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; } };

const icon = page => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${(META[page] || [])[1] || FALLBACK_ICON}</svg>`;

function tile(it, tone) {
  return `<button class="hm-tile" data-go="${esc(it.page)}" data-tone="${tone}">
    <span class="hm-ic">${icon(it.page)}</span>
    <span class="hm-tx"><span class="hm-t">${esc(it.label)}</span>
      <span class="hm-d">${esc(desc(it.page))}</span></span>
    ${it.badge ? `<span class="hm-badge${it.alert ? " alert" : ""}">${esc(it.badge)}</span>` : ""}
  </button>`;
}

// หมวดบนหน้าแรก — กดแล้วขยายเป็นแผงเมนูย่อย (แบบเปิดโฟลเดอร์)
// ผูกด้วย key ของหัวหมวดในแถบข้าง (data-i18n) ไม่ใช่ชื่อ — ชื่อเปลี่ยนตามภาษา ไทย/EN
const GROUP_META = {
  "grp.records":       ["ข้อมูลพนักงาน ความเคลื่อนไหว สวัสดิการ", '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18.5 14.8c1.7.7 2.7 2.4 3 5.2"/>'],
  "grp.pay": ["ค่ากะ เงินเดือน ใบอนุมัติ ค่าจ้างเหมา", '<rect x="2.5" y="6" width="19" height="12.5" rx="2.5"/><circle cx="12" cy="12.25" r="2.75"/><path d="M6 9.5v.01M18 15v.01"/>'],
  "grp.reports":        ["ภาพรวม headcount movement วิเคราะห์", '<path d="M3 3v18h18"/><path d="M7.5 16v-4M12 16V8M16.5 16v-6"/>'],
  "grp.plan":     ["โควตาตำแหน่งและอัตราว่าง", '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>'],
  "grp.docs":             ["เลขที่หนังสือ หนังสือรับรอง Offer Letter", '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>'],
  "grp.system":           ["ผู้ใช้ สิทธิ์ และข้อมูลหลัก", META.settings[1]],
};
const gIcon = g => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${(GROUP_META[g.key] || [])[1] || FALLBACK_ICON}</svg>`;
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function folder(g, i) {
  const alerts = g.items.filter(it => it.alert && it.badge).reduce((s, it) => s + (+it.badge || 0), 0);
  return `<button class="hm-folder" data-cat="${i}" data-tone="${g.tone}" style="--i:${i}">
    <span class="hm-fdeco">${gIcon(g)}</span>
    ${alerts ? `<span class="hm-badge alert">${alerts}</span>` : ""}
    <span class="hm-fi">${gIcon(g)}</span>
    <span class="hm-ft">${esc(g.name)}</span>
    <span class="hm-fd">${esc(gDesc(g))}</span>
    <span class="hm-prev">${g.items.slice(0, 4).map(it => `<span class="hm-ic sm" title="${esc(it.label)}">${icon(it.page)}</span>`).join("")}
      ${g.items.length > 4 ? `<span class="hm-more">+${g.items.length - 4}</span>` : ""}</span>
    <span class="hm-fc">${ui().menus(g.items.length)} <b>→</b></span>
  </button>`;
}

let groupsCache = [];

function draw() {
  const pg = document.getElementById("pageHome");
  const groups = groupsCache = readNav().map((g, i) => ({ ...g, tone: TONES[i % TONES.length] }));
  const q = query.trim().toLowerCase();
  const shown = groups.map(g => ({ ...g, items: g.items.filter(it =>
      // ค้นได้ทั้งไทยและอังกฤษ ไม่ว่าจะเปิดภาษาไหนอยู่
      !q || [it.label, (META[it.page] || [])[0], META_EN[it.page], g.name].join(" ").toLowerCase().includes(q)) }))
    .filter(g => g.items.length);
  const all = groups.flatMap(g => g.items.map(it => ({ ...it, tone: g.tone })));
  const rec = recent().map(p => all.find(it => it.page === p)).filter(Boolean);
  const name = (document.getElementById("sidebarName")?.textContent || "").trim();
  const today = new Date().toLocaleDateString(ui().locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  pg.innerHTML = `
  <div class="hm">
    <div class="hm-head">
      <div><div class="hm-hello">${ui().hello}${name ? `${en() ? " " : ""}${ui().you}${esc(name.split(" ")[0])}` : ""}</div>
        <div class="hm-date">${esc(today)}</div></div>
      <label class="hm-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>
        <input id="hmQ" placeholder="${ui().search}" value="${esc(query)}" autocomplete="off"></label>
    </div>
    ${!q && rec.length ? `<div class="hm-recent"><span class="hm-recent-l">${ui().recent}</span>
      ${rec.map(it => `<button class="hm-chip" data-go="${esc(it.page)}" data-tone="${it.tone}"><span class="hm-ic sm">${icon(it.page)}</span>${esc(it.label)}</button>`).join("")}</div>` : ""}
    ${!q ? `<div class="hm-folders">${groups.map(folder).join("")}</div>`
      // ค้นหา: แสดงเมนูย่อยทุกหมวดที่ตรงคำค้นเลย ไม่ต้องเปิดทีละหมวด
      : shown.length ? shown.map(g => `
      <section class="hm-group">
        <div class="hm-gh" data-tone="${g.tone}"><span></span>${esc(g.name)}<em>${g.items.length}</em></div>
        <div class="hm-grid">${g.items.map(it => tile(it, g.tone)).join("")}</div>
      </section>`).join("")
      : `<div class="hm-empty">${esc(ui().none(query))}</div>`}
  </div>`;

  pg.querySelectorAll("[data-go]").forEach(b => b.onclick = () => navigate(b.dataset.go));
  pg.querySelectorAll("[data-cat]").forEach(b => b.onclick = () => openFolder(+b.dataset.cat, b));
  const inp = pg.querySelector("#hmQ");
  inp.oninput = () => { query = inp.value; const pos = inp.selectionStart; draw();
    const n = document.getElementById("hmQ"); n.focus(); n.setSelectionRange(pos, pos); };
  // Enter = เปิดการ์ดแรกที่ค้นเจอ
  inp.onkeydown = e => { if (e.key === "Enter") pg.querySelector(".hm-tile")?.click(); };
}

// เปิดหมวด: แผงขยายออกมาจากตำแหน่งการ์ดที่กด (FLIP) แล้วเมนูย่อยค่อย ๆ ไล่โผล่ทีละใบ
function openFolder(idx, fromEl) {
  const g = groupsCache[idx]; if (!g) return;
  const ov = document.createElement("div");
  ov.className = "hm-ov";
  ov.innerHTML = `<div class="hm-back"></div>
    <div class="hm-panel" tabindex="-1" data-tone="${g.tone}" role="dialog" aria-label="${esc(g.name)}">
      <div class="hm-ph">
        <span class="hm-fi">${gIcon(g)}</span>
        <div><div class="hm-pt">${esc(g.name)}</div><div class="hm-pd">${esc(gDesc(g))} · ${ui().menus(g.items.length)}</div></div>
        <button class="hm-x" aria-label="${ui().close}">✕</button>
      </div>
      <div class="hm-grid hm-pgrid">${g.items.map((it, k) => tile(it, g.tone).replace('class="hm-tile"', `class="hm-tile hm-in" style="--k:${k}"`)).join("")}</div>
    </div>`;
  document.body.appendChild(ov);
  const panel = ov.querySelector(".hm-panel"), back = ov.querySelector(".hm-back");
  const from = fromEl.getBoundingClientRect(), to = panel.getBoundingClientRect();
  const flip = [
    { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`, opacity: .4, borderRadius: "16px" },
    { transform: "none", opacity: 1, borderRadius: "22px" }];
  const quick = reduceMotion();
  if (!quick) {
    panel.animate(flip, { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" });
    back.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out" });
  }
  fromEl.style.visibility = "hidden";

  let closing = false;
  const close = () => {
    if (closing) return; closing = true;
    document.removeEventListener("keydown", onKey);
    let gone = false;
    const done = () => { if (gone) return; gone = true; ov.remove(); fromEl.style.visibility = ""; fromEl.focus?.(); };
    if (quick) return done();
    // ตัวสำรอง: บางเบราว์เซอร์/แท็บที่ไม่ได้แสดงผลไม่ยิง onfinish — แผงต้องปิดแน่นอน ไม่ค้างบังหน้าจอ
    setTimeout(done, 380);
    const now = fromEl.getBoundingClientRect(), cur = panel.getBoundingClientRect();
    panel.animate([{ transform: "none", opacity: 1 },
      { transform: `translate(${now.left - cur.left}px, ${now.top - cur.top}px) scale(${now.width / cur.width}, ${now.height / cur.height})`, opacity: 0 }],
      { duration: 300, easing: "cubic-bezier(.4,0,.6,1)", fill: "forwards" }).onfinish = done;
    back.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: "forwards" });
  };
  const onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  back.onclick = close;
  ov.querySelector(".hm-x").onclick = close;
  ov.querySelectorAll("[data-go]").forEach(b => b.onclick = () => {
    closing = true; ov.remove(); fromEl.style.visibility = ""; document.removeEventListener("keydown", onKey); navigate(b.dataset.go); });
  // โฟกัสที่แผง (ไม่ใช่การ์ดแรก) — กด Tab ต่อได้ แต่ไม่มีกรอบโฟกัสขึ้นที่การ์ดแรกเหมือนถูกเลือกไว้
  panel.focus({ preventScroll: true });
}

export function renderHome() { draw(); }
