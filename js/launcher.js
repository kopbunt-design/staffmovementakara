import { esc, navigate } from "./app.js";

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
  vacancy:         ["โควตาตำแหน่งและอัตราว่าง", '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>'],
  users:           ["บัญชีผู้ใช้และสิทธิ์การเข้าถึง", '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-3.4 3.4-5.5 7-5.5s6.3 2.1 7 5.5"/>'],
  settings:        ["ข้อมูลหลัก: ฝ่าย แผนก ตำแหน่ง ระดับ", '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'],
};
const FALLBACK_ICON = '<rect x="4" y="4" width="16" height="16" rx="3"/>';
// สีประจำกลุ่ม ตามลำดับกลุ่มในแถบข้าง — ไล่สีให้แต่ละกลุ่มแยกด้วยตาได้ทันที
const TONES = ["blue", "green", "purple", "teal", "slate"];
// เมนูที่ไม่อยู่ใต้หัวกลุ่มใด (ตอนนี้คือ "ภาพรวม") ไปอยู่หน้าสุดของกลุ่มรายงาน — การ์ดเดี่ยวกลุ่มเดียวดูโหรง
const LOOSE_INTO = "รายงานกำลังคน";

// อ่านกลุ่มและเมนูจากแถบข้าง เฉพาะเมนูที่มองเห็น (ผ่านการเช็กสิทธิ์แล้ว)
function readNav() {
  const groups = [];
  let cur = { name: "เริ่มต้น", items: [] };
  for (const el of document.querySelectorAll(".sidebar-nav > *")) {
    if (el.classList.contains("nav-section")) {
      if (cur.items.length) groups.push(cur);
      cur = { name: el.textContent.trim(), items: [] };
    } else if (el.matches(".nav-item[data-page]") && el.style.display !== "none" && el.dataset.page !== "home") {
      const label = el.querySelector("span")?.textContent.trim() || el.dataset.page;
      const badge = el.querySelector(".nav-badge, .nav-count");
      const n = badge && badge.style.display !== "none" ? badge.textContent.trim() : "";
      cur.items.push({ page: el.dataset.page, label, badge: n, alert: !!badge?.classList.contains("nav-badge") });
    }
  }
  if (cur.items.length) groups.push(cur);
  const loose = groups[0]?.name === "เริ่มต้น" ? groups.shift() : null;
  const host = loose && (groups.find(g => g.name === LOOSE_INTO) || groups[0]);
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
      <span class="hm-d">${esc((META[it.page] || [])[0] || "")}</span></span>
    ${it.badge ? `<span class="hm-badge${it.alert ? " alert" : ""}">${esc(it.badge)}</span>` : ""}
  </button>`;
}

function draw() {
  const pg = document.getElementById("pageHome");
  const groups = readNav().map((g, i) => ({ ...g, tone: TONES[i % TONES.length] }));
  const q = query.trim().toLowerCase();
  const shown = groups.map(g => ({ ...g, items: g.items.filter(it =>
      !q || [it.label, (META[it.page] || [])[0], g.name].join(" ").toLowerCase().includes(q)) }))
    .filter(g => g.items.length);
  const all = groups.flatMap(g => g.items.map(it => ({ ...it, tone: g.tone })));
  const rec = recent().map(p => all.find(it => it.page === p)).filter(Boolean);
  const name = (document.getElementById("sidebarName")?.textContent || "").trim();
  const today = new Date().toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  pg.innerHTML = `
  <div class="hm">
    <div class="hm-head">
      <div><div class="hm-hello">สวัสดี${name ? `คุณ${esc(name.split(" ")[0])}` : ""}</div>
        <div class="hm-date">${esc(today)}</div></div>
      <label class="hm-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>
        <input id="hmQ" placeholder="ค้นหาเมนู เช่น ค่ากะ, กองทุน, headcount" value="${esc(query)}" autocomplete="off"></label>
    </div>
    ${!q && rec.length ? `<div class="hm-recent"><span class="hm-recent-l">ใช้ล่าสุด</span>
      ${rec.map(it => `<button class="hm-chip" data-go="${esc(it.page)}" data-tone="${it.tone}"><span class="hm-ic sm">${icon(it.page)}</span>${esc(it.label)}</button>`).join("")}</div>` : ""}
    ${shown.length ? shown.map(g => `
      <section class="hm-group">
        <div class="hm-gh" data-tone="${g.tone}"><span></span>${esc(g.name)}<em>${g.items.length}</em></div>
        <div class="hm-grid">${g.items.map(it => tile(it, g.tone)).join("")}</div>
      </section>`).join("")
      : `<div class="hm-empty">ไม่พบเมนูที่ตรงกับ “${esc(query)}”</div>`}
  </div>`;

  pg.querySelectorAll("[data-go]").forEach(b => b.onclick = () => navigate(b.dataset.go));
  const inp = pg.querySelector("#hmQ");
  inp.oninput = () => { query = inp.value; const pos = inp.selectionStart; draw();
    const n = document.getElementById("hmQ"); n.focus(); n.setSelectionRange(pos, pos); };
  // Enter = เปิดการ์ดแรกที่ค้นเจอ
  inp.onkeydown = e => { if (e.key === "Enter") pg.querySelector(".hm-tile")?.click(); };
}

export function renderHome() { draw(); }
