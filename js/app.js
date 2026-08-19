import { supabase } from "./supabase-config.js";
import { logout } from "./auth.js";
import { loadMasterData } from "./masterdata-admin.js";

// ===== SHARED STATE =====
export let currentUser = null;
export let userRole = "user";
export let allMovements = [];
export let allEmployees = [];
export let allPosQuota = [];   // Approved Headcount Plan (ตาราง position_quota) — ว่างได้ถ้ายังไม่ตั้งแผน

// ===== UTILS =====
export const esc = s => (s||"").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fmtDate = d => d ? String(d).substring(0,10) : "-";
// เดือนของ movement: ใช้วันที่มีผล (date) ก่อน ถ้าไม่มีใช้วันที่บันทึก
export const movYM = m => (m.date || m.created_at || "").substring(0,7);

// ===== กฎการนับเดือนของรายงาน — นิยามเดียว ใช้ร่วมทุกหน้า (เดิมก๊อปไว้ 4 ไฟล์จนหลุดจากกัน) =====
// end_date (พนักงาน) / date (movement) = "วันแรกที่พ้นสภาพ" (termination date)
// เดือนที่นับการพ้นสภาพ = เดือนของ "วันทำงานวันสุดท้าย" = termination date ลบ 1 วัน (sepYM)
// และคนคนนั้นจะหลุดจาก Headcount ตั้งแต่เดือนเดียวกันนั้น — ใช้ sepYM ตัวเดียวกันทั้งสองที่
// จึงรับประกันว่า ยกมา + เข้าใหม่ − พ้นสภาพ = ยกไป เสมอ
// ตัวอย่าง termination 2026-08-01 -> ทำงานถึง 31 ก.ค. -> พ้นสภาพนับเดือน ก.ค. และไม่อยู่ใน Headcount ก.ค. (ยังอยู่ใน มิ.ย.)
// ยืนยันกับผู้ใช้ 2026-08-03
export const lastDayOfMonth = ym => {
  const [y,m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(d).padStart(2,"0")}`;
};
export const sepYM = dateStr => {
  if (!dateStr) return "";
  const d = new Date(String(dateStr).substring(0,10) + "T00:00:00Z");
  if (isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() - 1);             // ถอย 1 วัน = วันทำงานวันสุดท้าย
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
};
export function isActiveAtMonthEnd(e, ym) {
  const jd = (e.join_date||"").substring(0,10);
  if (jd && jd > lastDayOfMonth(ym)) return false;   // ยังไม่เริ่มงาน ณ สิ้นเดือนนั้น
  const sm = sepYM(e.end_date);
  if (sm && sm <= ym) return false;                  // พ้นสภาพในเดือนนั้นหรือก่อนหน้า
  return true;
}
export const hcAtMonthEnd = (emps, ym) => emps.filter(e => isActiveAtMonthEnd(e, ym));
export const initials = n => { const p=(n||"").trim().split(/\s+/); return ((p[0]||"")[0]||"").toUpperCase()+((p[1]||"")[0]||"").toUpperCase()||"?"; };
export const avatarColor = n => { const pal=["#2B5AC7","#0D7C4B","#6D28D9","#C0392B","#D97706","#1A3E9A"]; let h=0; for(const c of (n||"")) h=(h*31+c.charCodeAt(0))>>>0; return pal[h%pal.length]; };
export const timeAgo = ts => { const s=Math.floor((Date.now()-new Date(ts).getTime())/1000); if(s<60) return "เมื่อสักครู่"; if(s<3600) return Math.floor(s/60)+" นาทีที่แล้ว"; if(s<86400) return Math.floor(s/3600)+" ชม.ที่แล้ว"; return Math.floor(s/86400)+" วันที่แล้ว"; };

export function toast(msg, type="info") {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.innerHTML = `<div class="toast-msg">${esc(msg)}</div>`;
  document.getElementById("toastContainer").appendChild(el);
  setTimeout(() => { el.style.transition="opacity 0.3s"; el.style.opacity="0"; setTimeout(()=>el.remove(),300); }, 4000);
}

// ===== NOTIFICATIONS (กระดิ่งแจ้งเตือน) =====
// เก็บใน Supabase (ตาราง notifications) + realtime — ทุก user เห็นรายการเดียวกัน
// (เดิมเก็บใน localStorage ซึ่งแยกเครื่อง/แยกเบราว์เซอร์ user คนอื่นจึงไม่เห็นสิ่งที่คนอื่นเพิ่ม)
let notifItems = [];
let notifUnread = 0;
// "อ่านล่าสุดเมื่อไหร่" เป็นเรื่องส่วนตัวของผู้ดูแต่ละคน จึงยังเก็บต่อเบราว์เซอร์ได้ (ต่างจากตัวรายการที่ต้อง shared)
const NOTIF_SEEN_KEY = "hr_notif_last_seen";
let notifLastSeen = localStorage.getItem(NOTIF_SEEN_KEY) || "";

const NOTIF_ICON = {
  employee: `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>`,
  movement: `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24"><path d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4"/></svg>`,
  quota: `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a4 4 0 0 0-8 0v2"/></svg>`,
  master: `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/></svg>`,
  alert: `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24"><path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>`,
  default: `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>`,
};

// บันทึกแจ้งเตือนลงกระดิ่ง (shared ทุกคนผ่าน Supabase) + toast ให้ตัวเองทันที (ใช้เมื่อ "เพิ่ม" รายการใหม่)
// dedupKey: ใส่เมื่อไม่อยากให้เกิดแถวซ้ำถ้าหลายเครื่องคำนวณเจอ alert เดียวกันพร้อมกัน (unique constraint ที่ DB)
export async function notify(title, detail = "", opts = {}) {
  const { type = "success", category = "default", toastMsg, silent = false, dedupKey = null } = opts;
  if (!silent) toast(toastMsg || (detail ? `${title} — ${detail}` : title), type);
  const row = { title, detail, category, dedup_key: dedupKey, created_by: currentUser?.id || null };
  const { error } = dedupKey
    ? await supabase.from("notifications").upsert(row, { onConflict: "dedup_key" })
    : await supabase.from("notifications").insert(row);
  if (error) console.error("บันทึกแจ้งเตือนไม่สำเร็จ:", error.message);
  // ไม่ต้อง push เข้า notifItems เอง — realtime (startRealtime) จะรับ event INSERT มา render ให้ทุกเครื่อง รวมเครื่องนี้ด้วย
}

async function loadNotifications() {
  const { data } = await supabase.from("notifications").select("*").order("created_at", { ascending:false }).limit(60);
  notifItems = data || [];
  notifUnread = notifItems.filter(n => n.created_at > notifLastSeen).length;
  renderNotifBell();
  renderNotifPanel();
}

// รับแจ้งเตือนใหม่จาก realtime (ของตัวเองหรือ user อื่นก็ได้) มาต่อบนสุดของรายการ
function pushNotification(row) {
  if (notifItems.some(n => n.id === row.id)) return; // กันซ้ำ
  notifItems.unshift(row);
  if (notifItems.length > 60) notifItems.length = 60;
  notifUnread++;
  renderNotifBell();
  renderNotifPanel();
}

function renderNotifBell() {
  const b = document.getElementById("notifBadge");
  if (!b) return;
  b.textContent = notifUnread > 9 ? "9+" : String(notifUnread);
  b.style.display = notifUnread > 0 ? "flex" : "none";
}

function renderNotifPanel() {
  const list = document.getElementById("notifList");
  if (!list) return;
  if (!notifItems.length) {
    list.innerHTML = `<div class="notif-empty">ยังไม่มีการแจ้งเตือน</div>`;
    return;
  }
  list.innerHTML = notifItems.map(n => `
    <div class="notif-item">
      <div class="notif-ic notif-ic-${esc(n.category)}">${NOTIF_ICON[n.category] || NOTIF_ICON.default}</div>
      <div class="notif-body">
        <div class="notif-title">${esc(n.title)}</div>
        ${n.detail ? `<div class="notif-detail">${esc(n.detail)}</div>` : ""}
        <div class="notif-time">${timeAgo(n.created_at)}</div>
      </div>
    </div>`).join("");
}

function toggleNotifPanel(force) {
  const panel = document.getElementById("notifPanel");
  if (!panel) return;
  const open = force ?? panel.style.display !== "block";
  panel.style.display = open ? "block" : "none";
  if (open) {
    notifUnread = 0;
    notifLastSeen = new Date().toISOString();
    try { localStorage.setItem(NOTIF_SEEN_KEY, notifLastSeen); } catch {}
    renderNotifBell();
  }
}

(function initNotifBell() {
  document.getElementById("notifBell")?.addEventListener("click", (e) => { e.stopPropagation(); toggleNotifPanel(); });
  document.getElementById("notifClear")?.addEventListener("click", (e) => {
    e.stopPropagation();
    // "ล้าง" = ทำเครื่องหมายว่าอ่านแล้วสำหรับตัวเอง — ไม่ลบข้อมูลของทุกคน (รายการเป็น shared log)
    notifUnread = 0;
    notifLastSeen = new Date().toISOString();
    try { localStorage.setItem(NOTIF_SEEN_KEY, notifLastSeen); } catch {}
    renderNotifBell();
  });
  document.addEventListener("click", (e) => {
    const wrap = document.getElementById("notifWrap");
    if (wrap && !wrap.contains(e.target)) toggleNotifPanel(false);
  });
  renderNotifBell();
  renderNotifPanel();
})();

export const MOV_COLORS = {
  "Transfer":["#2B5AC7","#EEF3FB"],"Promotion":["#6D28D9","#EDE9FE"],
  "Demotion":["#C0392B","#FDECEA"],"Resignation":["#C0392B","#FDECEA"],
  "Termination":["#991b1b","#fee2e2"],"New Hire":["#0D7C4B","#E6F5EE"],
  "Retirement":["#D97706","#FEF7E8"],"Secondment":["#2B5AC7","#EEF3FB"],
};
export const movBadge = type => { const [c,bg]=MOV_COLORS[type]||["#64748B","#f1f5f9"]; return `<span class="badge" style="color:${c};background:${bg};">${esc(type)}</span>`; };
// ป้ายภาษาไทยของประเภทความเคลื่อนไหว (ใช้ในหน้า Dashboard ให้ภาษาสม่ำเสมอ)
export const MOV_TH = {
  "New Hire":"เข้าใหม่","Resignation":"ลาออก","Termination":"เลิกจ้าง","Retirement":"เกษียณ",
  "Transfer":"โอนย้าย","Promotion":"เลื่อนตำแหน่ง","Demotion":"ปรับลดตำแหน่ง","Secondment":"ยืมตัว",
};

// ===== ROUTING =====
const pages = ["dashboard","employees","movements","headcount","movreport","workforce","vacancy","analytics","payroll","shiftallow","users","settings"];
let currentPage = "dashboard";

export function navigate(page) {
  currentPage = page;
  pages.forEach(p => {
    document.getElementById(`page${p[0].toUpperCase()+p.slice(1)}`)?.classList.toggle("active", p===page);
    document.querySelectorAll(`.nav-item[data-page="${p}"]`).forEach(el=>el.classList.toggle("active", p===page));
  });
  renderPage(page);
}

async function renderPage(page) {
  if(page==="dashboard") renderDashboard();
  else if(page==="employees") (await import("./employees.js")).renderEmployees();
  else if(page==="movements") renderMovements();
  else if(page==="headcount") (await import("./headcount.js")).renderHeadcount();
  else if(page==="movreport") (await import("./movement-report.js")).renderMovementReport();
  else if(page==="workforce") (await import("./workforce-overview.js")).renderWorkforceOverview();
  else if(page==="vacancy") (await import("./vacancy.js")).renderVacancy();
  else if(page==="analytics") renderAnalytics();
  else if(page==="payroll") renderPayroll();
  else if(page==="shiftallow") (await import("./shift-allowance.js")).renderShiftAllowance();
  else if(page==="users") (await import("./users.js")).renderUsers();
  else if(page==="settings") (await import("./masterdata-admin.js")).renderSettings();
}

document.querySelectorAll(".nav-item[data-page]").forEach(el =>
  el.addEventListener("click", () => navigate(el.dataset.page))
);

// ===== DATA LOADING =====
async function loadMovements() {
  const { data } = await supabase.from("movements").select("*").order("created_at", {ascending:false});
  allMovements = data || [];
  const today = new Date().toDateString();
  const newToday = allMovements.filter(m => new Date(m.created_at).toDateString()===today).length;
  document.getElementById("movNavBadge").textContent = newToday||"";
  document.getElementById("movNavBadge").style.display = newToday?"inline":"none";
}

async function loadEmployees() {
  const { data } = await supabase.from("employees").select("*").order("emp_code");
  allEmployees = data || [];
  // ตัวเลขข้างเมนู Employees = นับตาม "สถานะ Active ปัจจุบัน" ซึ่งคนละนิยามกับ Headcount บน Dashboard
  // (Dashboard นับตามวันที่ ณ สิ้นเดือนที่เลือก) จึงอาจไม่เท่ากันได้ — ใส่ title อธิบายไว้กันเข้าใจผิด
  const active = allEmployees.filter(e=>e.status==="Active"||!e.status).length;
  const navCount = document.getElementById("empNavCount");
  navCount.textContent = active||"";
  navCount.title = `พนักงานสถานะ Active ปัจจุบัน ${active} คน (Dashboard นับตามวันที่ ณ สิ้นเดือนที่เลือก จึงอาจต่างกัน)`;
  checkProactiveAlerts();
}

// Approved Headcount Plan — ถ้าโหลดไม่ได้ (ยังไม่ตั้งแผน/สิทธิ์ไม่ถึง) ให้เป็น [] แล้ว Dashboard จะแสดง empty state
async function loadPosQuota() {
  try {
    const { data, error } = await supabase.from("position_quota").select("*");
    allPosQuota = error ? [] : (data || []);
  } catch { allPosQuota = []; }
}

// ===== PROACTIVE ALERTS (สัญญาใกล้หมดอายุ / พ้นทดลองงาน / ใกล้เกษียณ) =====
// เกณฑ์วัน: อ้างอิงจากที่คุยกับผู้ใช้ (2026-07-15) — ไม่ใช่ค่ามาตรฐานสากล ปรับได้ตามนโยบายบริษัท
const PROBATION_DAYS = 119; // มาตรฐานที่บริษัทไทยส่วนใหญ่ใช้ เพื่อให้ต่ำกว่าเกณฑ์ 120 วันตามกฎหมายแรงงาน
const CONTRACT_ALERT_DAYS = [60, 30]; // แจ้งสองระดับ: เหลือ ≤60 วัน และ ≤30 วัน
const RETIRE_ALERT_DAYS = 90;
const RETIRE_AGE = 60;

const ALERT_SEEN_KEY = "hr_alert_seen";
const ALERT_SEEDED_KEY = "hr_alert_seeded"; // ธงว่าเคยรันรอบแรกแล้ว (กัน toast ท่วมจอตอนเปิดครั้งแรก/เครื่องใหม่)
let alertSeen = new Set();
try { alertSeen = new Set(JSON.parse(localStorage.getItem(ALERT_SEEN_KEY) || "[]")); } catch { alertSeen = new Set(); }
function markAlertSeen(key) {
  alertSeen.add(key);
  try { localStorage.setItem(ALERT_SEEN_KEY, JSON.stringify([...alertSeen])); } catch {}
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setUTCHours(0,0,0,0);
  const target = new Date(String(dateStr).substring(0,10) + "T00:00:00Z");
  if (isNaN(target)) return null;
  return Math.round((target - today) / 86400000);
}

function empDisplayName(e) {
  return `${e.firstname_th||e.firstname_en||""} ${e.lastname_th||e.lastname_en||""}`.trim() || e.emp_code;
}

// ตรวจพนักงาน active ทุกคน หาเหตุการณ์ที่ "กำลังจะเกิด" แล้วยิงแจ้งเตือนครั้งเดียวต่อคน/ต่อเกณฑ์ (กันแจ้งซ้ำด้วย alertSeen)
function checkProactiveAlerts() {
  // รอบแรก (หรือเครื่องใหม่ที่ยังไม่เคยรัน): เก็บ alert ที่ค้างอยู่เข้ากระดิ่งเงียบ ๆ ไม่ยิง toast ท่วมจอ
  const firstRun = !localStorage.getItem(ALERT_SEEDED_KEY);
  const active = allEmployees.filter(e => e.status==="Active" || !e.status);
  for (const e of active) {
    const name = empDisplayName(e);

    // พ้นทดลองงาน: join_date + PROBATION_DAYS วัน (เฉพาะ contract_type = Probation)
    if (e.contract_type === "Probation" && e.join_date) {
      const end = new Date(e.join_date.substring(0,10) + "T00:00:00Z");
      end.setUTCDate(end.getUTCDate() + PROBATION_DAYS);
      const endStr = end.toISOString().substring(0,10);
      const d = daysUntil(endStr);
      const key = `probation-${e.emp_code}-${endStr}`; // ใส่วันที่ใน key → เข้างานใหม่/ต่อโปร = แจ้งใหม่ได้
      if (d !== null && d >= 0 && d <= 14 && !alertSeen.has(key)) {
        notify(`ใกล้พ้นทดลองงาน — ${name}`, `ครบ ${PROBATION_DAYS} วัน ในอีก ${d} วัน (${endStr})`, {category:"alert", silent:firstRun, dedupKey:key, toastMsg:`${name} ใกล้พ้นทดลองงานในอีก ${d} วัน`});
        markAlertSeen(key);
      }
    }

    // สัญญาใกล้หมดอายุ: end_date, ไม่ใช่ Permanent — ยิงเฉพาะ "ระดับที่ใกล้สุด" ที่เข้าเกณฑ์ (กันเด้งซ้อน 2 อัน)
    if (e.end_date && e.contract_type !== "Permanent") {
      const d = daysUntil(e.end_date);
      if (d !== null && d >= 0) {
        const endStr = String(e.end_date).substring(0,10);
        const band = [...CONTRACT_ALERT_DAYS].sort((a,b)=>a-b).find(t => d <= t); // เกณฑ์วันน้อยสุดที่ยังครอบคลุม
        if (band != null) {
          const key = `contract-${e.emp_code}-${endStr}-${band}`; // ผูกกับ end_date + band → ต่อสัญญาใหม่ = แจ้งใหม่, ข้ามจาก 60→30 = แจ้งอีกครั้ง
          if (!alertSeen.has(key)) {
            notify(`สัญญาใกล้หมดอายุ — ${name}`, `หมดอายุ ${fmtDate(e.end_date)} (อีก ${d} วัน)`, {category:"alert", silent:firstRun, dedupKey:key, toastMsg:`สัญญา ${name} ใกล้หมดอายุในอีก ${d} วัน`});
            markAlertSeen(key);
          }
        }
      }
    }

    // ใกล้เกษียณ: dob + RETIRE_AGE ปี
    if (e.dob) {
      const dob = new Date(e.dob.substring(0,10) + "T00:00:00Z");
      if (!isNaN(dob)) {
        const retireDate = new Date(dob);
        retireDate.setUTCFullYear(retireDate.getUTCFullYear() + RETIRE_AGE);
        const retStr = retireDate.toISOString().substring(0,10);
        const d = daysUntil(retStr);
        const key = `retire-${e.emp_code}-${retStr}`;
        if (d !== null && d >= 0 && d <= RETIRE_ALERT_DAYS && !alertSeen.has(key)) {
          notify(`ใกล้เกษียณอายุ — ${name}`, `ครบ ${RETIRE_AGE} ปี วันที่ ${retStr} (อีก ${d} วัน)`, {category:"alert", silent:firstRun, dedupKey:key, toastMsg:`${name} ใกล้เกษียณอายุในอีก ${d} วัน`});
          markAlertSeen(key);
        }
      }
    }
  }
  if (firstRun) { try { localStorage.setItem(ALERT_SEEDED_KEY, "1"); } catch {} }
}

// ===== REALTIME =====
let realtimeChannel = null; // subscribe ครั้งเดียวต่อ session — onAuthStateChange ยิงซ้ำได้ (token refresh/สลับแท็บ) จึงต้องกัน subscribe ซ้ำ
function startRealtime() {
  if (realtimeChannel) return;
  realtimeChannel = supabase.channel("db-changes")
    .on("postgres_changes", {event:"*", schema:"public", table:"movements"}, async () => {
      await loadMovements();
      if(currentPage==="dashboard") renderDashboard();
      if(currentPage==="movements") renderMovements();
      if(currentPage==="analytics") renderAnalytics();
    })
    .on("postgres_changes", {event:"*", schema:"public", table:"employees"}, async () => {
      await loadEmployees();
      if(currentPage==="dashboard") renderDashboard();
      if(currentPage==="employees") (await import("./employees.js")).renderEmployees();
    })
    .on("postgres_changes", {event:"INSERT", schema:"public", table:"notifications"}, (payload) => {
      pushNotification(payload.new); // เฉพาะ INSERT — upsert ซ้ำ dedup_key เดิมจะเป็น UPDATE ซึ่งไม่ต้องเด้งซ้ำ
    })
    .subscribe();
}

// ===== AUTH =====
let appBooted = false; // boot (โหลดข้อมูล+ตั้งหน้า) ครั้งเดียวต่อ session
supabase.auth.onAuthStateChange(async (_event, session) => {
  if (!session?.user) { appBooted = false; return; }
  currentUser = session.user; // อัปเดต token เสมอ
  if (appBooted) return;      // token refresh/สลับแท็บ = ไม่ต้อง re-init และไม่เด้งกลับ dashboard
  appBooted = true;

  const name = session.user.user_metadata?.full_name || session.user.email?.split("@")[0] || "";

  // ดึง role — ถ้า query ล้มเหลวจะไม่ทับ role เดิม
  const { data: roleData, error: roleError } = await supabase.from("user_roles").select("role").eq("user_id", session.user.id).single();
  if (roleData) {
    userRole = roleData.role || "user";
    await supabase.from("user_roles").update({ name, email: session.user.email }).eq("user_id", session.user.id);
  } else if (!roleError || roleError.code === "PGRST116") {
    // PGRST116 = ไม่พบแถว = user ใหม่จริง ๆ (ไม่ใช่ error อื่น)
    const emailKey = (session.user.email||"").toLowerCase().replace(/[.#$[\]]/g,"_");
    const { data: pending } = await supabase.from("pending_roles").select("role").eq("email_key", emailKey).single();
    const assignedRole = pending?.role || "user";
    // ใช้ insert ไม่ใช่ upsert เพื่อป้องกันทับ role เดิมถ้าแถวมีอยู่แล้ว
    await supabase.from("user_roles").insert({ user_id: session.user.id, name, email: session.user.email, role: assignedRole }).single();
    if (pending) await supabase.from("pending_roles").delete().eq("email_key", emailKey);
    userRole = assignedRole;
  }

  // update sidebar
  document.getElementById("sidebarName").textContent = name;
  document.getElementById("sidebarRole").textContent = {admin:"Admin",hr:"HR",user:"User"}[userRole]||"User";
  document.getElementById("sidebarAvatar").textContent = initials(name);
  document.getElementById("sidebarAvatar").style.background = avatarColor(name);

  if (userRole === "admin") {
    document.getElementById("adminNavSection").style.display = "block";
    document.getElementById("usersNavItem").style.display = "flex";
    document.getElementById("settingsNavItem").style.display = "flex";
  }

  await Promise.all([loadMovements(), loadEmployees(), loadMasterData(), loadNotifications(), loadPosQuota()]);
  startRealtime();
  navigate("dashboard");
});

document.getElementById("logoutBtn")?.addEventListener("click", logout);

// ===== DASHBOARD =====
let dashMonth = ""; // "" = เดือนปัจจุบัน
// การพ้นสภาพนับในเดือนของ end_date / movement date เอง (ดูกฎที่ hcAtMonthEnd ด้านบน)
function getMonthStats(ym) {
  const movMonth = allMovements.filter(m => movYM(m) === ym);
  const movJoinCodes = new Set(movMonth.filter(m=>m.type==="New Hire").map(m=>m.emp_code));
  const empJoined = allEmployees.filter(e=>(e.join_date||"").substring(0,7)===ym && !movJoinCodes.has(e.emp_code));
  const movResignCodes = new Set(allMovements.filter(m=>sepYM(m.date)===ym&&["Resignation","Termination","Retirement"].includes(m.type)).map(m=>m.emp_code));
  const empResigned = allEmployees.filter(e=>sepYM(e.end_date)===ym && ["Resigned","Terminated","Retired"].includes(e.status) && !movResignCodes.has(e.emp_code));
  return { joined: movJoinCodes.size + empJoined.length, resigned: movResignCodes.size + empResigned.length };
}
// ปีงบประมาณ: เริ่ม ก.ค. (ก.ค. 2025 - มิ.ย. 2026 = FY2026) — ตรงกับหน้า Position Quota
const dashFY = ym => { const [y,m]=ym.split("-").map(Number); return m>=7 ? y+1 : y; };
const prevYMof = ym => { const [y,m]=ym.split("-").map(Number); return m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,"0")}`; };
const thMonth = (ym,opt={month:"long",year:"numeric"}) => {
  const [y,m]=ym.split("-").map(Number);
  return new Date(y,m-1,1).toLocaleDateString("th-TH",opt);
};
// เกณฑ์สถานะแผนกำลังคน (อธิบายบนหน้าจอ): ครบแผน = Healthy, ขาด ≤10% = Watch, ขาด >10% = Critical
const planStatus = (actual, plan) => {
  if(!plan) return null;
  if(actual >= plan) return {key:"healthy", label:"ครบตามแผน", c:"var(--exec-pos)", bg:"var(--exec-pos-soft)"};
  const shortPct = (plan-actual)/plan*100;
  return shortPct <= 10
    ? {key:"watch", label:"เฝ้าระวัง", c:"var(--exec-warn)", bg:"var(--exec-warn-soft)"}
    : {key:"critical", label:"วิกฤต", c:"var(--exec-neg)", bg:"var(--exec-neg-soft)"};
};

function renderDashboard() {
  const pg = document.getElementById("pageDashboard");
  const now = new Date();
  const currentYM = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const ym = dashMonth || currentYM;
  const pYM = prevYMof(ym);

  // list เดือนย้อนหลัง 12 เดือน
  const monthOpts = [];
  for(let i=0;i<12;i++){
    const d=new Date(); d.setMonth(d.getMonth()-i);
    const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    monthOpts.push({key,lbl:thMonth(key)});
  }
  const selectedLabel = thMonth(ym);

  // ===== Headcount ณ สิ้นเดือน (กฎกลาง hcAtMonthEnd) =====
  const hcList  = hcAtMonthEnd(allEmployees, ym);
  const total   = hcList.length;
  const prevHC  = hcAtMonthEnd(allEmployees, pYM).length;
  const dHC     = total - prevHC;
  const dHCpct  = prevHC ? (dHC/prevHC*100) : null;

  const {joined,resigned} = getMonthStats(ym);
  const prevStats = getMonthStats(pYM);
  const dJoin = joined - prevStats.joined;
  const dExit = resigned - prevStats.resigned;
  const turnover = total ? (resigned/total*100) : 0;
  const prevTurnover = prevHC ? (prevStats.resigned/prevHC*100) : 0;
  const dTurnover = turnover - prevTurnover;

  // ===== Approved Headcount Plan (position_quota ของปีงบนั้น) =====
  const fy = dashFY(ym);
  const planRows = allPosQuota.filter(q=>Number(q.fiscal_year)===fy);
  const hasPlan = planRows.length > 0;
  const planTotal = planRows.reduce((s,q)=>s+(Number(q.quota)||0),0);
  const planPct = hasPlan && planTotal ? Math.min(100, total/planTotal*100) : 0;
  const planGap = hasPlan ? planTotal - total : 0;

  // ===== แผนก: Actual / Plan / Gap =====
  const actualByDept = {};
  hcList.forEach(e=>{ const d=e.department||"ไม่ระบุแผนก"; actualByDept[d]=(actualByDept[d]||0)+1; });
  const planByDept = {};
  planRows.forEach(q=>{ const d=q.department||"ไม่ระบุแผนก"; planByDept[d]=(planByDept[d]||0)+(Number(q.quota)||0); });
  const deptRows = [...new Set([...Object.keys(actualByDept),...Object.keys(planByDept)])].map(d=>{
    const actual=actualByDept[d]||0, plan=planByDept[d]||0;
    return {name:d, actual, plan, gap:plan-actual, st:planStatus(actual,plan)};
  }).sort((a,b)=> hasPlan ? (b.gap-a.gap)||(b.actual-a.actual) : b.actual-a.actual).slice(0,6);
  const maxDeptBase = Math.max(...deptRows.map(d=>Math.max(d.actual,d.plan)),1);
  const topGapDept = hasPlan ? deptRows.filter(d=>d.gap>0).sort((a,b)=>b.gap-a.gap)[0] : null;

  // ===== แนวโน้ม 6 เดือน =====
  const trend = [];
  for(let i=5;i>=0;i--){
    const [yy,mm]=ym.split("-").map(Number);
    const d=new Date(yy,mm-1-i,1);
    const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    const st=getMonthStats(key);
    const kfy=dashFY(key);
    const kplan=allPosQuota.filter(q=>Number(q.fiscal_year)===kfy).reduce((s,q)=>s+(Number(q.quota)||0),0);
    trend.push({ym:key, lbl:thMonth(key,{month:"short"}), hc:hcAtMonthEnd(allEmployees,key).length,
      j:st.joined, r:st.resigned, plan:kplan||null});
  }
  const maxBar = Math.max(...trend.flatMap(t=>[t.j,t.r]),1);
  const lineVals = [...trend.map(t=>t.hc), ...(hasPlan?trend.map(t=>t.plan).filter(v=>v):[])];
  const lMin = Math.min(...lineVals), lMax = Math.max(...lineVals);
  const lSpan = (lMax-lMin)||1;
  const yOf = v => 70 - ((v-lMin)/lSpan)*58;          // แปลงค่าเป็นพิกัด y (70=ล่าง, 12=บน)
  const xOf = i => ((i+0.5)/trend.length)*100;

  // ===== Waterfall: ยกมา + เข้าใหม่ − พ้นสภาพ = ยกไป =====
  const wfCalc = prevHC + joined - resigned;
  const wfDiff = total - wfCalc;   // ถ้าไม่ 0 = ข้อมูลไม่สอดคล้อง (แจ้งให้เห็น ไม่กลบ)
  const wfMax = Math.max(prevHC, total, 1);

  // ===== พนักงานที่กำลังพ้นสภาพ (นับจากวันนี้) =====
  const upcoming = allEmployees
    .map(e=>({e, d:daysUntil(e.end_date)}))
    .filter(x=>x.d!==null && x.d>=0 && isActiveAtMonthEnd(x.e, currentYM));
  const up30=upcoming.filter(x=>x.d<=30).length;
  const up60=upcoming.filter(x=>x.d<=60).length;
  const up90=upcoming.filter(x=>x.d<=90).length;

  // ===== ประเภทสัญญา =====
  const byContract={}; hcList.forEach(e=>{ const c=e.contract_type||"Permanent"; byContract[c]=(byContract[c]||0)+1; });
  const contractRows = Object.entries(byContract).sort((a,b)=>b[1]-a[1]);

  // ===== ความเคลื่อนไหวล่าสุดของเดือนที่เลือก =====
  const recent = allMovements.filter(m=>movYM(m)===ym)
    .sort((a,b)=>String(b.date||b.created_at||"").localeCompare(String(a.date||a.created_at||"")))
    .slice(0,6);

  // ป้ายเปรียบเทียบเดือนก่อน — สีแดงเฉพาะค่าลบ/สิ่งที่ต้องเตือน (warn=true คือ "เพิ่มขึ้นแล้วไม่ดี")
  const pill = (v, {suffix="", warn=false, hero=false}={}) => {
    const good = warn ? v<0 : v>0;
    const bad  = warn ? v>0 : v<0;
    const cls = hero ? "dsh-delta-hero" : good ? "up" : bad ? "down" : "flat";
    const arrow = v>0 ? "▲" : v<0 ? "▼" : "—";
    const num = v>0 ? `+${v}` : `${v}`;
    return `<span class="dsh-delta ${cls}">${arrow} ${num}${suffix} <span style="font-weight:500;opacity:.8;">เทียบเดือนก่อน</span></span>`;
  };
  const emptyBox = (title, sub) => `<div class="dsh-empty">
    <div class="dsh-empty-i"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg></div>
    <div class="dsh-empty-t">${esc(title)}</div><div class="dsh-empty-s">${esc(sub)}</div></div>`;

  const hcPts = trend.map((t,i)=>`${xOf(i)},${yOf(t.hc)}`).join(" ");
  const planPts = hasPlan ? trend.map((t,i)=>`${xOf(i)},${yOf(t.plan||lMin)}`).join(" ") : "";

  pg.innerHTML = `
  <div class="dsh">
    <div class="dsh-head">
      <div>
        <div class="dsh-title">ภาพรวมกำลังคน</div>
        <div class="dsh-sub">อัครา รีซอร์สเซส · ข้อมูล ณ สิ้นเดือน${selectedLabel} · นับพนักงานที่เริ่มงานแล้วและยังไม่พ้นสภาพ ณ สิ้นเดือนนั้น</div>
      </div>
      <select class="dsh-month" aria-label="เลือกเดือน" onchange="window._dashMonth(this.value)">
        ${monthOpts.map(m=>`<option value="${m.key}" ${m.key===ym?"selected":""}>${m.lbl}</option>`).join("")}
      </select>
    </div>

    <!-- แถว 1: Executive KPI -->
    <div class="dsh-kpi">
      <div class="dsh-hero">
        <div>
          <div class="dsh-hero-l" title="นับพนักงานที่วันเริ่มงาน ≤ สิ้นเดือน และยังไม่พ้นสภาพ ณ สิ้นเดือนนั้น">กำลังคน ณ สิ้นเดือน</div>
          <div class="dsh-hero-v">${total.toLocaleString("th-TH")}<span class="dsh-hero-u">คน</span></div>
          ${pill(dHC,{suffix:` คน${dHCpct!==null?` (${dHCpct>0?"+":""}${dHCpct.toFixed(1)}%)`:""}`,hero:true})}
        </div>
        <div class="dsh-plan">
          ${hasPlan ? `
          <div class="dsh-plan-row">
            <span>เทียบแผนอัตรากำลัง (ปีงบ ${fy})</span>
            <span style="color:#fff;font-weight:700;">${total.toLocaleString("th-TH")} / ${planTotal.toLocaleString("th-TH")}</span>
          </div>
          <div class="dsh-plan-bar"><div class="dsh-plan-fill" style="width:${planPct.toFixed(1)}%;"></div></div>
          <div class="dsh-plan-row" style="margin:7px 0 0;">
            <span>${planGap>0?`ต่ำกว่าแผน ${planGap.toLocaleString("th-TH")} คน`:planGap<0?`เกินแผน ${Math.abs(planGap).toLocaleString("th-TH")} คน`:"เป็นไปตามแผน"}</span>
            <span>${planPct.toFixed(1)}%</span>
          </div>` : `
          <div class="dsh-plan-row"><span>ยังไม่ได้ตั้งแผนอัตรากำลังของปีงบ ${fy}</span></div>
          <div class="dsh-plan-row" style="margin:0;"><span style="color:rgba(255,255,255,.55);">ตั้งได้ที่เมนู “อัตรากำลังที่อนุมัติ”</span></div>`}
        </div>
      </div>

      <div class="dsh-kpi-card">
        <div class="dsh-kpi-l">เข้าใหม่</div>
        <div><div class="dsh-kpi-v" style="color:var(--exec-pos);">${joined}</div>${pill(dJoin,{suffix:" คน"})}</div>
      </div>
      <div class="dsh-kpi-card">
        <div class="dsh-kpi-l">พ้นสภาพ</div>
        <div><div class="dsh-kpi-v" style="color:${resigned>0?"var(--exec-neg)":"var(--exec-ink)"};">${resigned}</div>${pill(dExit,{suffix:" คน",warn:true})}</div>
      </div>
      <div class="dsh-kpi-card">
        <div class="dsh-kpi-l">อัตราการลาออก</div>
        <div><div class="dsh-kpi-v">${turnover.toFixed(2)}<span style="font-size:17px;font-weight:600;color:var(--exec-muted);">%</span></div>${pill(Number(dTurnover.toFixed(2)),{suffix:"%",warn:true})}</div>
      </div>
    </div>

    <!-- แถว 2: ข้อมูลเชิงลึก + การแจ้งเตือน -->
    <div class="dsh-2">
      <div class="dsh-card">
        <div class="dsh-card-t">ข้อมูลเชิงลึกกำลังคน</div>
        <div class="dsh-card-s">สรุปจากข้อมูลจริงของเดือน${selectedLabel}</div>
        <div class="dsh-insight">
          <div class="dsh-ic" style="background:${dHC>=0?"var(--exec-pos-soft)":"var(--exec-neg-soft)"};color:${dHC>=0?"var(--exec-pos)":"var(--exec-neg)"};">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="${dHC>=0?"M3 17l6-6 4 4 8-8":"M3 7l6 6 4-4 8 8"}"/></svg></div>
          <div><div class="dsh-insight-t">${dHC===0?"กำลังคนเท่าเดิมกับเดือนก่อน":dHC>0?`กำลังคนเพิ่มขึ้น ${dHC} คน`:`กำลังคนลดลง ${Math.abs(dHC)} คน`}</div>
            <div class="dsh-insight-s">${prevHC.toLocaleString("th-TH")} คน (${thMonth(pYM)}) → ${total.toLocaleString("th-TH")} คน</div></div>
        </div>
        ${hasPlan ? `
        <div class="dsh-insight">
          <div class="dsh-ic" style="background:${planGap>0?"var(--exec-warn-soft)":"var(--exec-pos-soft)"};color:${planGap>0?"var(--exec-warn)":"var(--exec-pos)"};">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>
          <div><div class="dsh-insight-t">${planGap>0?`ต่ำกว่าแผน ${planGap} คน`:planGap<0?`เกินแผน ${Math.abs(planGap)} คน`:"กำลังคนเป็นไปตามแผน"}</div>
            <div class="dsh-insight-s">คิดเป็น ${planPct.toFixed(1)}% ของแผนอัตรากำลังปีงบ ${fy} (${planTotal.toLocaleString("th-TH")} คน)</div></div>
        </div>
        ${topGapDept ? `
        <div class="dsh-insight">
          <div class="dsh-ic" style="background:var(--exec-navy-soft);color:var(--exec-navy);">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M5 21V7l7-4 7 4v14"/></svg></div>
          <div><div class="dsh-insight-t">แผนกที่ขาดมากที่สุด: ${esc(topGapDept.name)}</div>
            <div class="dsh-insight-s">มีจริง ${topGapDept.actual} คน จากแผน ${topGapDept.plan} คน (ขาด ${topGapDept.gap} คน)</div></div>
        </div>` : ""}` : `
        <div class="dsh-insight">
          <div class="dsh-ic" style="background:var(--exec-navy-soft);color:var(--exec-muted);">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg></div>
          <div><div class="dsh-insight-t">ยังเทียบกับแผนอัตรากำลังไม่ได้</div>
            <div class="dsh-insight-s">ยังไม่มีข้อมูลแผนของปีงบ ${fy} — เพิ่มได้ที่เมนู “อัตรากำลังที่อนุมัติ”</div></div>
        </div>`}
        <div class="dsh-insight">
          <div class="dsh-ic" style="background:var(--exec-navy-soft);color:var(--exec-navy);">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4"/></svg></div>
          <div><div class="dsh-insight-t">เข้าใหม่ ${joined} คน · พ้นสภาพ ${resigned} คน</div>
            <div class="dsh-insight-s">สุทธิ ${joined-resigned>0?"+":""}${joined-resigned} คน ในเดือน${selectedLabel}</div></div>
        </div>
      </div>

      <div class="dsh-card">
        <div class="dsh-card-t">กำลังพ้นสภาพ</div>
        <div class="dsh-card-s">นับจากวันนี้ (สะสม) · อ้างอิงวันที่มีผลพ้นสภาพ</div>
        ${upcoming.length===0 ? emptyBox("ไม่มีพนักงานที่กำลังพ้นสภาพ","ยังไม่มีใครมีวันที่มีผลพ้นสภาพในอีก 90 วันข้างหน้า") : `
        <div class="dsh-alert-row"><span class="dsh-alert-l">ภายใน 30 วัน</span><span class="dsh-alert-n" style="color:${up30?"var(--exec-neg)":"var(--exec-muted)"};">${up30}</span></div>
        <div class="dsh-alert-row"><span class="dsh-alert-l">ภายใน 60 วัน</span><span class="dsh-alert-n" style="color:${up60?"var(--exec-warn)":"var(--exec-muted)"};">${up60}</span></div>
        <div class="dsh-alert-row"><span class="dsh-alert-l">ภายใน 90 วัน</span><span class="dsh-alert-n" style="color:var(--exec-navy);">${up90}</span></div>`}
      </div>
    </div>

    <!-- แถว 3: แนวโน้มกำลังคน -->
    <div class="dsh-card" style="margin-top:16px;">
      <div class="dsh-card-t">แนวโน้มกำลังคน 6 เดือน</div>
      <div class="dsh-card-s">เส้น = กำลังคนสิ้นเดือน · แท่ง = เข้าใหม่/พ้นสภาพ${hasPlan?" · เส้นประ = แผนที่อนุมัติ":""}</div>
      <div class="dsh-legend">
        <span class="dsh-lg"><span class="dsh-lg-s" style="background:var(--exec-navy);"></span>กำลังคน</span>
        <span class="dsh-lg"><span class="dsh-lg-s" style="background:var(--exec-pos);"></span>เข้าใหม่</span>
        <span class="dsh-lg"><span class="dsh-lg-s" style="background:var(--exec-neg);"></span>พ้นสภาพ</span>
        ${hasPlan?`<span class="dsh-lg"><span class="dsh-lg-s" style="background:var(--exec-gold);"></span>แผนที่อนุมัติ</span>`:""}
      </div>
      <div class="dsh-chart">
        <svg class="dsh-chart-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="dshHcGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style="stop-color:var(--exec-navy);stop-opacity:.16"/>
            <stop offset="100%" style="stop-color:var(--exec-navy);stop-opacity:0"/>
          </linearGradient></defs>
          <polygon points="${xOf(0)},89.5 ${hcPts} ${xOf(trend.length-1)},89.5" fill="url(#dshHcGrad)"/>
          ${hasPlan?`<polyline points="${planPts}" fill="none" style="stroke:var(--exec-gold);" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>`:""}
          <polyline points="${hcPts}" fill="none" style="stroke:var(--exec-navy);" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
        </svg>
        <div class="dsh-cols">
          ${trend.map((t,i)=>`<div class="dsh-col">
            <div class="dsh-tip">
              <div style="font-weight:700;margin-bottom:3px;">${t.lbl} ${t.ym.split("-")[0]}</div>
              <div class="dsh-tip-r"><span class="dsh-tip-k">กำลังคน</span><span>${t.hc.toLocaleString("th-TH")} คน</span></div>
              <div class="dsh-tip-r"><span class="dsh-tip-k">เข้าใหม่</span><span>${t.j} คน</span></div>
              <div class="dsh-tip-r"><span class="dsh-tip-k">พ้นสภาพ</span><span>${t.r} คน</span></div>
              ${t.plan?`<div class="dsh-tip-r"><span class="dsh-tip-k">แผน</span><span>${t.plan.toLocaleString("th-TH")} คน</span></div>`:""}
            </div>
            <span style="position:absolute;top:${yOf(t.hc)}%;left:50%;transform:translate(-50%,-50%);width:9px;height:9px;border-radius:50%;background:#fff;border:2.5px solid var(--exec-navy);"></span>
            <div class="dsh-bars">
              <div class="dsh-bar" style="height:${Math.round(t.j/maxBar*72)}px;background:var(--exec-pos);opacity:.9;"></div>
              <div class="dsh-bar" style="height:${Math.round(t.r/maxBar*72)}px;background:var(--exec-neg);opacity:.9;"></div>
            </div>
            <div class="dsh-xl">${t.lbl}</div>
          </div>`).join("")}
        </div>
      </div>
    </div>

    <!-- แถว 4: วิเคราะห์กำลังคน -->
    <div class="dsh-4">
      <div class="dsh-card">
        <div class="dsh-card-t">การเปลี่ยนแปลงกำลังคน</div>
        <div class="dsh-card-s">ยกมา + เข้าใหม่ − พ้นสภาพ = ยกไป</div>
        <div class="dsh-wf">
          <div class="dsh-wf-row"><span class="dsh-wf-l">ยกมา</span>
            <div class="dsh-wf-track"><div class="dsh-wf-fill" style="left:0;width:${(prevHC/wfMax*100).toFixed(1)}%;background:var(--exec-navy);opacity:.85;"></div></div>
            <span class="dsh-wf-v">${prevHC.toLocaleString("th-TH")}</span></div>
          <div class="dsh-wf-row"><span class="dsh-wf-l">เข้าใหม่</span>
            <div class="dsh-wf-track"><div class="dsh-wf-fill" style="left:0;width:${Math.max(joined/wfMax*100,joined?2:0).toFixed(1)}%;background:var(--exec-pos);"></div></div>
            <span class="dsh-wf-v" style="color:var(--exec-pos);">+${joined}</span></div>
          <div class="dsh-wf-row"><span class="dsh-wf-l">พ้นสภาพ</span>
            <div class="dsh-wf-track"><div class="dsh-wf-fill" style="left:0;width:${Math.max(resigned/wfMax*100,resigned?2:0).toFixed(1)}%;background:var(--exec-neg);"></div></div>
            <span class="dsh-wf-v" style="color:${resigned?"var(--exec-neg)":"var(--exec-ink)"};">−${resigned}</span></div>
          <div class="dsh-wf-row" style="border-top:1px solid var(--exec-line);padding-top:11px;"><span class="dsh-wf-l" style="font-weight:700;color:var(--exec-ink);">ยกไป</span>
            <div class="dsh-wf-track"><div class="dsh-wf-fill" style="left:0;width:${(total/wfMax*100).toFixed(1)}%;background:var(--exec-navy);"></div></div>
            <span class="dsh-wf-v">${total.toLocaleString("th-TH")}</span></div>
        </div>
        ${wfDiff!==0?`<div style="margin-top:10px;font-size:11px;color:var(--exec-warn);line-height:1.5;">หมายเหตุ: ยกมา+เข้าใหม่−พ้นสภาพ = ${wfCalc.toLocaleString("th-TH")} ต่างจากยกไป ${Math.abs(wfDiff)} คน — อาจมีพนักงานที่วันที่ไม่ครบหรือสถานะไม่ตรงกับวันที่</div>`:""}
      </div>

      <div class="dsh-card">
        <div class="dsh-card-t">กำลังคนรายแผนก</div>
        <div class="dsh-card-s">${hasPlan?"มีจริง / แผน · เรียงตามจำนวนที่ขาดมากสุด":"มีจริง · เรียงตามจำนวนมากสุด"}</div>
        ${deptRows.length===0 ? emptyBox("ยังไม่มีข้อมูลแผนก","ยังไม่มีพนักงานที่ระบุแผนกในเดือนนี้") : `
        <div class="dsh-dept">
          ${deptRows.map(d=>`<div>
            <div class="dsh-dept-h">
              <span class="dsh-dept-n">${esc(d.name)}</span>
              <span class="dsh-dept-m">${d.actual}${d.plan?` / ${d.plan}`:""} คน${d.st?` <span class="dsh-pill" style="color:${d.st.c};background:${d.st.bg};">${d.st.label}</span>`:""}</span>
            </div>
            <div class="dsh-dept-track">
              ${d.plan?`<div class="dsh-dept-fill" style="width:${(d.plan/maxDeptBase*100).toFixed(1)}%;background:var(--exec-navy);opacity:.14;position:absolute;"></div>`:""}
              <div class="dsh-dept-fill" style="width:${(d.actual/maxDeptBase*100).toFixed(1)}%;background:${d.st?d.st.c:"var(--exec-navy)"};position:absolute;"></div>
            </div>
          </div>`).join("")}
        </div>
        ${hasPlan?`<div style="margin-top:12px;font-size:10.5px;color:var(--exec-muted);line-height:1.6;">เกณฑ์: ครบตามแผน = มีจริง ≥ แผน · เฝ้าระวัง = ขาด ≤ 10% · วิกฤต = ขาด &gt; 10%</div>`:""}`}
      </div>

      <div class="dsh-card">
        <div class="dsh-card-t">ประเภทสัญญาจ้าง</div>
        <div class="dsh-card-s">สัดส่วนของกำลังคน ${total.toLocaleString("th-TH")} คน</div>
        ${contractRows.length===0 ? emptyBox("ยังไม่มีข้อมูลสัญญาจ้าง","ยังไม่มีพนักงานในเดือนที่เลือก") : `
        <div class="dsh-ct">
          ${contractRows.map(([t,n],i)=>{
            const p = total? n/total*100 : 0;
            const shades=["var(--exec-navy)","var(--exec-navy-2)","var(--exec-gold)","var(--exec-muted)"];
            return `<div>
              <div class="dsh-ct-h"><span style="font-weight:600;color:var(--exec-ink);">${esc(t)}</span>
                <span style="color:var(--exec-muted);">${n.toLocaleString("th-TH")} คน · ${p.toFixed(1)}%</span></div>
              <div class="dsh-dept-track"><div class="dsh-dept-fill" style="width:${p.toFixed(1)}%;background:${shades[i%shades.length]};"></div></div>
            </div>`;
          }).join("")}
        </div>`}
      </div>
    </div>

    <!-- แถว 5: ความเคลื่อนไหวล่าสุด -->
    <div class="dsh-card dsh-tl">
      <div class="dsh-tl-head">
        <div>
          <div class="dsh-card-t">ความเคลื่อนไหวล่าสุด</div>
          <div class="dsh-card-s" style="margin-bottom:0;">รายการของเดือน${selectedLabel}</div>
        </div>
        <button class="dsh-btn" onclick="window._dashGoMovements()">ดูความเคลื่อนไหวทั้งหมด</button>
      </div>
      ${recent.length===0 ? emptyBox("ยังไม่มีความเคลื่อนไหวในเดือนนี้","เมื่อมีการบันทึกการเข้าใหม่ โอนย้าย เลื่อนตำแหน่ง หรือพ้นสภาพ รายการจะแสดงที่นี่") : `
      <div class="dsh-tl-list" style="margin-top:8px;">
        ${recent.map(m=>{
          const [c,bg]=MOV_COLORS[m.type]||["#64748B","#F2F4F7"];
          const av=avatarColor(m.name||"");
          const where=[m.from_dept,m.to_dept].filter(Boolean).join(" → ");
          return `<div class="dsh-tl-item">
            <div class="dsh-tl-dot" style="background:${av}1A;color:${av};">${initials(m.name||"")}</div>
            <div class="dsh-tl-b">
              <div class="dsh-tl-n">${esc(m.name||"-")}<span class="dsh-pill" style="color:${c};background:${bg};">${esc(MOV_TH[m.type]||m.type||"")}</span></div>
              <div class="dsh-tl-m">${esc(where||m.reason||"ไม่ระบุรายละเอียด")}</div>
            </div>
            <div class="dsh-tl-d">${m.date?fmtDate(m.date):"—"}</div>
          </div>`;
        }).join("")}
      </div>`}
    </div>
  </div>`;
  window._dashMonth = v => { dashMonth = v; renderDashboard(); };
  window._dashGoMovements = () => navigate("movements");
}

// ===== MOVEMENTS =====
let movFilter="", movFilterType="", movFilterMonth="";
const MOV_TYPES = ["Transfer","Promotion","Demotion","Resignation","Termination","New Hire","Retirement","Secondment"];
// ประเภทที่ทำให้พ้นสภาพ — คนหนึ่งมีได้ครั้งเดียว (ใช้กันบันทึกซ้ำ)
const SEPARATION_TYPES = ["Resignation","Termination","Retirement"];

// object อัปเดตพนักงานตามประเภท movement (ใช้ร่วมทั้งฟอร์มและ import bulk)
// jobLevel: ระดับใหม่ (optional) — ถ้ามีจะอัปเดต job_level ให้สำหรับประเภทที่ยังทำงานอยู่
function empUpdateFromMovement(type, toDept, date, jobLevel) {
  const upd = {};
  if(["Resignation","Termination","Retirement"].includes(type)){
    upd.status = {Resignation:"Resigned",Termination:"Terminated",Retirement:"Retired"}[type];
    if(date) upd.end_date = date;
  } else if(type==="Transfer"){
    if(toDept) upd.department = toDept;
    if(date) upd.effective_date = date;
    if(jobLevel) upd.job_level = jobLevel;
  } else if(type==="Promotion"||type==="Demotion"){
    if(toDept) upd.position = toDept;
    if(date) upd.effective_date = date;
    if(jobLevel) upd.job_level = jobLevel;
  } else if(type==="New Hire"){
    upd.status = "Active";
    if(date) upd.join_date = date;
    if(jobLevel) upd.job_level = jobLevel;
  }
  return upd;
}

export function renderMovements() {
  const pg = document.getElementById("pageMovements");
  const filtered = allMovements.filter(m => {
    if(movFilterType && m.type!==movFilterType) return false;
    if(movFilterMonth && movYM(m)!==movFilterMonth) return false;
    if(movFilter){ const h=[m.emp_code,m.name,m.from_dept,m.to_dept,m.reason,m.recorded_by].join(" ").toLowerCase(); if(!h.includes(movFilter.toLowerCase())) return false; }
    return true;
  });
  const months=[...new Set(allMovements.map(m=>movYM(m)))].filter(Boolean).sort().reverse();

  pg.innerHTML=`
  <div class="page-header">
    <div><div class="page-heading">Staff Movement</div><div class="page-sub">${filtered.length} รายการ</div></div>
    <div class="header-actions">
      ${(userRole==="hr"||userRole==="admin")?`
      <input type="file" id="movFile" accept=".xlsx,.xls" style="display:none;" onchange="window._movImport(this)">
      <button class="btn btn-secondary" onclick="window._movTemplate()">📄 Template</button>
      <button class="btn btn-secondary" onclick="document.getElementById('movFile').click()">📥 Import Excel</button>`:""}
      <button class="btn btn-primary" onclick="window._openMovModal()">+ บันทึกรายการ</button>
    </div>
  </div>
  <div class="search-bar">
    <div class="search-input-wrap">
      <svg class="search-icon" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <input class="search-input" placeholder="ค้นหาชื่อ / รหัส / แผนก..." value="${esc(movFilter)}" oninput="window._movSearch(this.value)">
    </div>
    <select class="filter-select" onchange="window._movType(this.value)">
      <option value="">ทุกประเภท</option>
      ${["Transfer","Promotion","Demotion","Resignation","Termination","New Hire","Retirement","Secondment"].map(t=>`<option value="${t}" ${t===movFilterType?"selected":""}>${t}</option>`).join("")}
    </select>
    <select class="filter-select" onchange="window._movMonth(this.value)">
      <option value="">ทุกเดือน</option>
      ${months.map(m=>{const [y,mo]=m.split("-");const l=new Date(Number(y),Number(mo)-1).toLocaleDateString("th-TH",{month:"long",year:"numeric"});return `<option value="${m}" ${m===movFilterMonth?"selected":""}>${l}</option>`;}).join("")}
    </select>
    <button class="btn btn-secondary btn-sm" onclick="window._exportMovCSV()">📤 Export CSV</button>
  </div>
  <div class="section mt-4 pb-4"><div class="card"><div class="table-wrap">
    <table class="data-table">
      <thead><tr><th>รหัส</th><th>ชื่อ</th><th>ประเภท</th><th>แผนกเดิม</th><th>แผนกใหม่</th><th>วันที่มีผล</th><th>เหตุผล</th><th>บันทึกโดย</th><th>วันที่บันทึก</th><th></th></tr></thead>
      <tbody>${filtered.length===0?`<tr><td colspan="10" class="text-center text-muted" style="padding:36px;">ไม่พบรายการ</td></tr>`:
      filtered.map(m=>`<tr>
        <td><b style="color:var(--blue);font-size:12px;">${esc(m.emp_code||"-")}</b></td>
        <td style="font-weight:600;">${esc(m.name||"-")}${m.attachment_path?` <button onclick="window._movDoc('${esc(m.attachment_path)}')" title="เปิดเอกสารแนบ: ${esc(m.attachment_name||"")}" style="border:none;background:none;cursor:pointer;padding:0 2px;font-size:13px;">📎</button>`:""}</td>
        <td>${movBadge(m.type)}</td>
        <td class="text-muted">${esc(m.from_dept||"-")}</td>
        <td class="text-muted">${esc(m.to_dept||"-")}</td>
        <td class="text-muted">${fmtDate(m.date)}</td>
        <td class="text-muted" style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(m.reason||"-")}</td>
        <td class="text-muted">${esc(m.recorded_by||"-")}</td>
        <td class="text-muted">${fmtDate(m.created_at)}</td>
        <td style="white-space:nowrap;">${(m.created_by===currentUser?.id||userRole==="admin")?`<button class="btn btn-secondary btn-sm" onclick="window._editMov('${m.id}')">แก้ไข</button> <button class="btn btn-danger btn-sm" onclick="window._delMovRow('${m.id}')">ลบ</button>`:""}</td>
      </tr>`).join("")}</tbody>
    </table>
  </div></div></div>`;

  window._movSearch = v => { movFilter=v; renderMovements(); };
  window._movType = v => { movFilterType=v; renderMovements(); };
  window._movMonth = v => { movFilterMonth=v; renderMovements(); };
  window._openMovModal = () => openMovModal(null);
  window._editMov = id => openMovModal(allMovements.find(m=>m.id===id));
  window._exportMovCSV = exportMovCSV;
  window._movTemplate = movTemplate;
  window._movImport = movImport;
  window._delMovRow = async (id) => {
    if(!confirm("ลบรายการนี้?")) return;
    const { error } = await supabase.from("movements").delete().eq("id", id);
    if(error){ toast("ลบไม่สำเร็จ: "+error.message,"error"); return; }
    toast("ลบเรียบร้อย","info"); // realtime จะรีเฟรชตารางให้เอง
  };
}

function openMovModal(entry=null) {
  const isEdit = !!entry?.id;
  // รายชื่อสำหรับช่องค้นหา — เตรียมข้อความที่ใช้ค้นไว้ล่วงหน้า จะได้กรองเร็วแม้พนักงานหลายร้อยคน
  const empPick = allEmployees.filter(e=>e.status==="Active"||!e.status).map(e=>{
    const nameTh=((e.firstname_th||"")+" "+(e.lastname_th||"")).trim();
    const nameEn=((e.firstname_en||"")+" "+(e.lastname_en||"")).trim();
    return {
      code:e.emp_code||"", name:nameTh||nameEn,
      dept:e.department||"", pos:e.position||"", sec:e.section||"",
      q:[e.emp_code,nameTh,nameEn,e.department,e.section,e.position].filter(Boolean).join(" ").toLowerCase(),
    };
  });

  document.getElementById("modalPortal").innerHTML = `<div class="modal-overlay" id="movModal">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">${isEdit?"แก้ไขรายการ":"บันทึก Staff Movement"}</div>
        <button class="modal-close" onclick="document.getElementById('movModal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group col-span-2">
            <label class="form-label">เลือกพนักงาน <span style="font-weight:400;color:var(--muted);">(พิมพ์รหัส ชื่อ หรือแผนก แล้วเลือกจากรายการ)</span></label>
            <div style="position:relative;">
              <input id="mv_search" class="form-control" autocomplete="off" placeholder="🔍 พิมพ์ค้นหา เช่น AKR23 หรือ สมชาย หรือ Mining"
                     value="${esc(entry?.emp_code?`${entry.emp_code} - ${entry.name||""}`:"")}">
              <div id="mv_sugg" style="display:none;position:absolute;z-index:20;left:0;right:0;top:100%;margin-top:2px;background:var(--card);border:1px solid var(--border2);border-radius:var(--radius-sm);box-shadow:0 8px 20px rgba(0,0,0,.12);max-height:260px;overflow-y:auto;"></div>
            </div>
          </div>
          <div class="form-group"><label class="form-label">รหัสพนักงาน</label><input id="mv_code" class="form-control" value="${esc(entry?.emp_code||"")}" placeholder="AKR001"></div>
          <div class="form-group"><label class="form-label">ชื่อพนักงาน *</label><input id="mv_name" class="form-control" value="${esc(entry?.name||"")}" required></div>
          <div class="form-group"><label class="form-label">ประเภท *</label>
            <select id="mv_type" class="form-control">${["Transfer","Promotion","Demotion","Resignation","Termination","New Hire","Retirement","Secondment"].map(t=>`<option ${t===(entry?.type||"Transfer")?"selected":""}>${t}</option>`).join("")}</select>
          </div>
          <div class="form-group"><label class="form-label">วันที่มีผล</label><input id="mv_date" type="date" class="form-control" value="${esc(entry?.date||"")}"></div>
          <div class="form-group"><label class="form-label">แผนก/ตำแหน่งเดิม</label><input id="mv_from" class="form-control" value="${esc(entry?.from_dept||"")}"></div>
          <div class="form-group"><label class="form-label">แผนก/ตำแหน่งใหม่</label><input id="mv_to" class="form-control" value="${esc(entry?.to_dept||"")}"></div>
          <div class="form-group col-span-2"><label class="form-label">เหตุผล / หมายเหตุ</label><textarea id="mv_reason" class="form-control">${esc(entry?.reason||"")}</textarea></div>
          ${userRole==="hr"||userRole==="admin"?`
          <div class="form-group"><label class="form-label">เงินเดือน/อัตราใหม่ (บาท)</label><input id="mv_sal" type="number" class="form-control" value="${entry?.salary||""}"></div>
          <div class="form-group"><label class="form-label">Cost Center</label><input id="mv_cc" class="form-control" value="${esc(entry?.cost_center||"")}"></div>
          <div class="form-group col-span-2">
            <label class="form-label">เอกสารแนบ <span style="font-weight:400;color:var(--muted);">(เช่น ใบลาออก หนังสืออนุมัติ — PDF/รูป/Word ไม่เกิน 10 MB)</span></label>
            ${entry?.attachment_path?`<div id="mv_curDoc" style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--blue-light);border-radius:var(--radius-sm);margin-bottom:8px;font-size:12.5px;">
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📎 ${esc(entry.attachment_name||"เอกสารแนบ")}</span>
              <button type="button" class="btn btn-secondary btn-sm" onclick="window._movDoc('${esc(entry.attachment_path)}')">เปิดดู</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="window._movDocRemove()" title="ลบไฟล์แนบออกจากรายการนี้">ลบไฟล์</button>
            </div>`:""}
            <input type="hidden" id="mv_docPath" value="${esc(entry?.attachment_path||"")}">
            <input type="hidden" id="mv_docName" value="${esc(entry?.attachment_name||"")}">
            <input type="file" id="mv_file" class="form-control" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx">
          </div>`:""}
        </div>
      </div>
      <div class="modal-footer">
        ${isEdit&&(entry?.created_by===currentUser?.id||userRole==="admin")?`<button class="btn btn-danger" onclick="window._delMov('${entry.id}')">ลบ</button>`:""}
        <button class="btn btn-secondary" onclick="document.getElementById('movModal').remove()">ยกเลิก</button>
        <button class="btn btn-primary" onclick="window._saveMov('${entry?.id||""}')">บันทึก</button>
      </div>
    </div>
  </div>`;

  // ===== ช่องค้นหาพนักงาน (พิมพ์แล้วเลือกจากรายการ) =====
  // เดิมเป็น <select> ยาวหลายร้อยรายการ ซึ่งพิมพ์ค้นหาไม่ได้จริง ต้องไล่คลิกทีละตัว
  (() => {
    const box = document.getElementById("mv_search");
    const sugg = document.getElementById("mv_sugg");
    if(!box || !sugg) return;
    const MAX = 50;               // แสดงมากกว่านี้ก็เลื่อนหาไม่ไหว ให้พิมพ์ให้แคบลงแทน
    let list = [], active = -1;

    const close = () => { sugg.style.display="none"; list=[]; active=-1; };
    const pick = i => {
      const e = list[i]; if(!e) return;
      document.getElementById("mv_code").value = e.code;
      document.getElementById("mv_name").value = e.name;
      document.getElementById("mv_from").value = [e.dept,e.pos].filter(Boolean).join(" / ");
      box.value = `${e.code} - ${e.name}`;
      close();
    };
    const paint = () => {
      sugg.innerHTML = list.map((e,i)=>`
        <div data-i="${i}" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border);${i===active?"background:var(--blue-light);":""}">
          <b>${esc(e.code)}</b> ${esc(e.name)}
          ${e.dept||e.pos?`<div style="font-size:11px;color:var(--muted);">${esc([e.dept,e.sec,e.pos].filter(Boolean).join(" · "))}</div>`:""}
        </div>`).join("");
      sugg.style.display = list.length ? "block" : "none";
    };
    const search = () => {
      // ทุกคำต้องเจอ (AND) -> พิมพ์ "mining s2" หรือ "สมชาย ผลิต" ก็แคบลงได้
      const terms = box.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      list = (terms.length ? empPick.filter(e=>terms.every(t=>e.q.includes(t))) : empPick).slice(0,MAX);
      active = list.length ? 0 : -1;
      paint();
    };

    box.addEventListener("input", search);
    box.addEventListener("focus", search);
    box.addEventListener("keydown", ev => {
      if(ev.key==="ArrowDown"||ev.key==="ArrowUp"){
        if(!list.length) return;
        ev.preventDefault();
        active = (active + (ev.key==="ArrowDown"?1:-1) + list.length) % list.length;
        paint();
        sugg.children[active]?.scrollIntoView({block:"nearest"});
      } else if(ev.key==="Enter"){
        if(active>=0){ ev.preventDefault(); pick(active); }
      } else if(ev.key==="Escape"){ close(); }
    });
    // ใช้ mousedown ไม่ใช่ click — กัน blur ปิดรายการก่อนที่คลิกจะทำงาน
    sugg.addEventListener("mousedown", ev => {
      const el = ev.target.closest("[data-i]"); if(!el) return;
      ev.preventDefault(); pick(Number(el.dataset.i));
    });
    box.addEventListener("blur", () => setTimeout(close, 120));
  })();

  window._saveMov = async (existId) => {
    const g = id => document.getElementById(id)?.value?.trim()||"";
    const name = g("mv_name"); if(!name){ toast("กรุณากรอกชื่อ","error"); return; }
    const type = g("mv_type"), empCode = g("mv_code");

    // กันบันทึกการพ้นสภาพซ้ำ — คนหนึ่งพ้นสภาพได้ครั้งเดียว
    if(empCode && SEPARATION_TYPES.includes(type)){
      const dup = allMovements.find(m =>
        m.emp_code === empCode && SEPARATION_TYPES.includes(m.type) && String(m.id) !== String(existId));
      if(dup){
        toast(`บันทึกไม่ได้: ${name} มีรายการ${MOV_TH[dup.type]||dup.type}อยู่แล้ว (มีผล ${fmtDate(dup.date)} · บันทึกโดย ${dup.recorded_by||"-"}) — ถ้าต้องแก้ ให้เปิดรายการเดิมแล้วกดแก้ไข`,"error");
        return;
      }
    }

    const data = {
      emp_code: empCode, name, type,
      date: g("mv_date")||null, from_dept: g("mv_from"), to_dept: g("mv_to"),
      reason: g("mv_reason"),
      recorded_by: currentUser?.user_metadata?.full_name||currentUser?.email?.split("@")[0]||"",
      created_by: currentUser?.id,
      ...(userRole==="hr"||userRole==="admin" ? { salary: Number(document.getElementById("mv_sal")?.value)||null, cost_center: g("mv_cc") } : {})
    };

    // อัปโหลดเอกสารแนบ (ถ้าเลือกไฟล์ใหม่) — ทำก่อนบันทึก เพื่อไม่ให้มีรายการที่อ้างไฟล์ที่อัปโหลดไม่สำเร็จ
    if(userRole==="hr"||userRole==="admin"){
      const fileEl = document.getElementById("mv_file");
      const file = fileEl?.files?.[0];
      if(file){
        if(file.size > 10*1024*1024){ toast("ไฟล์ใหญ่เกิน 10 MB กรุณาย่อขนาดก่อน","error"); return; }
        const safe = file.name.replace(/[^\w.\-]/g,"_");
        const path = `${empCode||"no-code"}/${Date.now()}-${safe}`;
        const { error: upErr } = await supabase.storage.from("movement-docs").upload(path, file);
        if(upErr){ toast("อัปโหลดเอกสารไม่สำเร็จ: "+upErr.message,"error"); return; }
        data.attachment_path = path;
        data.attachment_name = file.name;
      } else {
        data.attachment_path = g("mv_docPath")||null;   // คงไฟล์เดิม หรือ null ถ้ากดลบไฟล์
        data.attachment_name = g("mv_docName")||null;
      }
    }

    const { error } = existId
      ? await supabase.from("movements").update({...data, updated_at: new Date().toISOString()}).eq("id", existId)
      : await supabase.from("movements").insert(data);
    if(error){ toast("บันทึกไม่สำเร็จ: "+error.message,"error"); return; }
    // อัปเดตข้อมูลพนักงานอัตโนมัติตามประเภท movement
    if(data.emp_code){
      const empUpdate = { updated_at: new Date().toISOString(), ...empUpdateFromMovement(data.type, data.to_dept, data.date) };
      if(Object.keys(empUpdate).length>1){
        await supabase.from("employees").update(empUpdate).eq("emp_code",data.emp_code);
      }
    }
    document.getElementById("modalPortal").innerHTML="";
    if(existId) toast("บันทึกสำเร็จ","success");
    else notify("เพิ่มรายการเคลื่อนไหว", `${name} · ${data.type||"-"}`, {category:"movement"});
  };
  // เปิดเอกสารแนบ — bucket เป็น private จึงต้องขอ signed URL อายุสั้นทุกครั้ง
  window._movDoc = async (path) => {
    const { data, error } = await supabase.storage.from("movement-docs").createSignedUrl(path, 60);
    if(error||!data?.signedUrl){ toast("เปิดเอกสารไม่ได้: "+(error?.message||"ไม่พบไฟล์"),"error"); return; }
    window.open(data.signedUrl, "_blank");
  };
  // ถอดไฟล์ออกจากรายการ (ไฟล์ยังอยู่ใน storage เผื่อกู้คืน — ไม่ลบทิ้งทันที)
  window._movDocRemove = () => {
    document.getElementById("mv_docPath").value="";
    document.getElementById("mv_docName").value="";
    document.getElementById("mv_curDoc")?.remove();
    toast("ถอดไฟล์แนบออกแล้ว — กดบันทึกเพื่อยืนยัน","info");
  };
  window._delMov = async (id) => {
    if(!confirm("ลบรายการนี้?")) return;
    await supabase.from("movements").delete().eq("id",id);
    document.getElementById("modalPortal").innerHTML="";
    toast("ลบเรียบร้อย","info");
  };
}

function exportMovCSV() {
  const filtered = allMovements.filter(m => {
    if(movFilterType && m.type!==movFilterType) return false;
    if(movFilterMonth && movYM(m)!==movFilterMonth) return false;
    if(movFilter){ const h=[m.emp_code,m.name,m.from_dept,m.to_dept,m.reason].join(" ").toLowerCase(); if(!h.includes(movFilter.toLowerCase())) return false; }
    return true;
  });
  const rows=[["Employee Code","Name","Type","From","To","Date","Reason","Recorded By","Created At"],...filtered.map(m=>[m.emp_code||"",m.name,m.type,m.from_dept||"",m.to_dept||"",m.date||"",m.reason||"",m.recorded_by||"",fmtDate(m.created_at)])];
  const csv=rows.map(r=>r.map(v=>`"${String(v||"").replace(/"/g,'""')}"`).join(",")).join("\n");
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"})); a.download=`movements_${new Date().toISOString().slice(0,10)}.csv`; a.click();
}

// ===== BULK IMPORT (\u0E1B\u0E23\u0E31\u0E1A\u0E15\u0E33\u0E41\u0E2B\u0E19\u0E48\u0E07\u0E2B\u0E25\u0E32\u0E22\u0E04\u0E19) =====
// \u0E2D\u0E48\u0E32\u0E19\u0E04\u0E48\u0E32\u0E08\u0E32\u0E01 row \u0E42\u0E14\u0E22\u0E25\u0E2D\u0E07\u0E2B\u0E25\u0E32\u0E22\u0E0A\u0E37\u0E48\u0E2D\u0E04\u0E2D\u0E25\u0E31\u0E21\u0E19\u0E4C (\u0E44\u0E17\u0E22/\u0E2D\u0E31\u0E07\u0E01\u0E24\u0E29)
const movPick = (row, keys) => { for(const k of keys){ if(k in row && String(row[k]).trim()!=="") return String(row[k]).trim(); } return ""; };
// normalize \u0E27\u0E31\u0E19\u0E17\u0E35\u0E48 -> 'YYYY-MM-DD' (\u0E23\u0E31\u0E1A serial \u0E02\u0E2D\u0E07 Excel \u0E17\u0E31\u0E49\u0E07\u0E41\u0E1A\u0E1A number \u0E41\u0E25\u0E30 string, YYYY-MM-DD, DD/MM/YYYY)
function movNormDate(v){
  if(v===""||v==null) return "";
  const s=String(v).trim();
  // serial \u0E02\u0E2D\u0E07 Excel \u2014 \u0E2D\u0E32\u0E08\u0E21\u0E32\u0E40\u0E1B\u0E47\u0E19 number \u0E2B\u0E23\u0E37\u0E2D string \u0E15\u0E31\u0E27\u0E40\u0E25\u0E02\u0E25\u0E49\u0E27\u0E19 (\u0E21\u0E35 . \u0E44\u0E14\u0E49) \u0E40\u0E0A\u0E48\u0E19 "46234" \u0E15\u0E49\u0E2D\u0E07\u0E41\u0E1B\u0E25\u0E07\u0E01\u0E48\u0E2D\u0E19
  if(/^\d+(\.\d+)?$/.test(s) && window.XLSX?.SSF){
    const n=Number(s);
    if(n>=1 && n<600000){ const o=window.XLSX.SSF.parse_date_code(n); if(o&&o.y) return `${o.y}-${String(o.m).padStart(2,"0")}-${String(o.d).padStart(2,"0")}`; }
  }
  let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if(m) return `${m[1]}-${String(+m[2]).padStart(2,"0")}-${String(+m[3]).padStart(2,"0")}`;
  m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if(m) return `${m[3]}-${String(+m[2]).padStart(2,"0")}-${String(+m[1]).padStart(2,"0")}`;
  return "";
}

function movTemplate(){
  if(!window.XLSX){ toast("\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E2D\u0E42\u0E2B\u0E25\u0E14 library","error"); return; }
  const h=["\u0E23\u0E2B\u0E31\u0E2A\u0E1E\u0E19\u0E31\u0E01\u0E07\u0E32\u0E19","\u0E0A\u0E37\u0E48\u0E2D-\u0E2A\u0E01\u0E38\u0E25","\u0E1B\u0E23\u0E30\u0E40\u0E20\u0E17","\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E21\u0E35\u0E1C\u0E25","\u0E08\u0E32\u0E01","\u0E40\u0E1B\u0E47\u0E19","\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E43\u0E2B\u0E21\u0E48","\u0E40\u0E2B\u0E15\u0E38\u0E1C\u0E25"];
  const ex1=["AKR001","(\u0E40\u0E27\u0E49\u0E19\u0E27\u0E48\u0E32\u0E07\u0E44\u0E14\u0E49 \u0E23\u0E30\u0E1A\u0E1A\u0E14\u0E36\u0E07\u0E08\u0E32\u0E01\u0E23\u0E30\u0E1A\u0E1A)","Promotion","2026-08-01","Officer","Senior Officer","O1","\u0E40\u0E25\u0E37\u0E48\u0E2D\u0E19\u0E15\u0E33\u0E41\u0E2B\u0E19\u0E48\u0E07\u0E1B\u0E23\u0E30\u0E08\u0E33\u0E1B\u0E35"];
  const ex2=["AKR002","","Transfer","2026-08-01","Mining","Processing","","\u0E22\u0E49\u0E32\u0E22\u0E15\u0E32\u0E21\u0E42\u0E04\u0E23\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07"];
  const ws=window.XLSX.utils.aoa_to_sheet([h,ex1,ex2]); ws["!cols"]=h.map(()=>({wch:22}));
  const wb=window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb,ws,"Template");
  window.XLSX.writeFile(wb,"movement_import_template.xlsx");
  toast("\u0E14\u0E32\u0E27\u0E19\u0E4C\u0E42\u0E2B\u0E25\u0E14 Template \u0E41\u0E25\u0E49\u0E27 \u00B7 \"\u0E40\u0E1B\u0E47\u0E19\"=\u0E41\u0E1C\u0E19\u0E01/\u0E15\u0E33\u0E41\u0E2B\u0E19\u0E48\u0E07\u0E43\u0E2B\u0E21\u0E48 \u00B7 \"\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E43\u0E2B\u0E21\u0E48\"=job level (\u0E40\u0E27\u0E49\u0E19\u0E27\u0E48\u0E32\u0E07=\u0E44\u0E21\u0E48\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19)","success");
}

async function movImport(inputEl){
  const file = inputEl.files?.[0]; inputEl.value="";
  if(!file) return;
  if(!window.XLSX){ toast("\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E2D\u0E42\u0E2B\u0E25\u0E14 library","error"); return; }
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const wb = window.XLSX.read(ev.target.result,{type:"binary"});
      const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:"",raw:true});
      if(!rows.length){ toast("\u0E44\u0E1F\u0E25\u0E4C\u0E27\u0E48\u0E32\u0E07","error"); return; }
      const empByCode = new Map(allEmployees.map(e=>[String(e.emp_code||"").trim(), e]));
      const batch=[]; let skipped=0; const errors=[];
      rows.forEach((r,i)=>{
        const emp_code = movPick(r,["\u0E23\u0E2B\u0E31\u0E2A\u0E1E\u0E19\u0E31\u0E01\u0E07\u0E32\u0E19","emp_code","Employee_ID","\u0E23\u0E2B\u0E31\u0E2A"]);
        const type = movPick(r,["\u0E1B\u0E23\u0E30\u0E40\u0E20\u0E17","type","Type"]);
        if(!emp_code || !type){ skipped++; return; }
        if(!MOV_TYPES.includes(type)){ errors.push(`\u0E41\u0E16\u0E27 ${i+2}: \u0E1B\u0E23\u0E30\u0E40\u0E20\u0E17 "${type}" \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07`); skipped++; return; }
        let name = movPick(r,["\u0E0A\u0E37\u0E48\u0E2D-\u0E2A\u0E01\u0E38\u0E25","\u0E0A\u0E37\u0E48\u0E2D","name","Name"]);
        if(!name){ const e=empByCode.get(emp_code); name = e?`${e.firstname_th||""} ${e.lastname_th||""}`.trim():emp_code; }
        batch.push({
          emp_code, name, type,
          date: movNormDate(movPick(r,["\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E21\u0E35\u0E1C\u0E25","date","Date","\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48"]))||null,
          from_dept: movPick(r,["\u0E08\u0E32\u0E01","from","from_dept","\u0E41\u0E1C\u0E19\u0E01\u0E40\u0E14\u0E34\u0E21"]),
          to_dept: movPick(r,["\u0E40\u0E1B\u0E47\u0E19","to","to_dept","\u0E41\u0E1C\u0E19\u0E01\u0E43\u0E2B\u0E21\u0E48","\u0E15\u0E33\u0E41\u0E2B\u0E19\u0E48\u0E07\u0E43\u0E2B\u0E21\u0E48"]),
          job_level: movPick(r,["\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E43\u0E2B\u0E21\u0E48","job_level","Job Level","\u0E23\u0E30\u0E14\u0E31\u0E1A"]).toUpperCase(),
          reason: movPick(r,["\u0E40\u0E2B\u0E15\u0E38\u0E1C\u0E25","reason","Reason","\u0E2B\u0E21\u0E32\u0E22\u0E40\u0E2B\u0E15\u0E38"]) || "\u0E19\u0E33\u0E40\u0E02\u0E49\u0E32\u0E08\u0E32\u0E01 Excel",
          recorded_by: currentUser?.user_metadata?.full_name||currentUser?.email?.split("@")[0]||"Import",
          created_by: currentUser?.id,
        });
      });
      if(!batch.length){ toast("\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E17\u0E35\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07"+(errors.length?": "+errors[0]:""),"error"); return; }
      // job_level \u0E44\u0E21\u0E48\u0E43\u0E0A\u0E48\u0E04\u0E2D\u0E25\u0E31\u0E21\u0E19\u0E4C\u0E02\u0E2D\u0E07 movements \u2014 \u0E15\u0E31\u0E14\u0E2D\u0E2D\u0E01\u0E01\u0E48\u0E2D\u0E19 insert (\u0E40\u0E01\u0E47\u0E1A\u0E44\u0E27\u0E49\u0E43\u0E0A\u0E49\u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15\u0E1E\u0E19\u0E31\u0E01\u0E07\u0E32\u0E19)
      const movRows = batch.map(({job_level, ...m})=>m);
      const { error } = await supabase.from("movements").insert(movRows);
      if(error){ toast("Import \u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08: "+error.message,"error"); return; }
      // \u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15\u0E1E\u0E19\u0E31\u0E01\u0E07\u0E32\u0E19 \u2014 \u0E40\u0E23\u0E35\u0E22\u0E07\u0E15\u0E32\u0E21\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48 (\u0E40\u0E01\u0E48\u0E32->\u0E43\u0E2B\u0E21\u0E48) \u0E43\u0E2B\u0E49\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14\u0E17\u0E31\u0E1A
      let updated=0;
      const ordered=[...batch].sort((a,b)=>String(a.date||"").localeCompare(String(b.date||"")));
      for(const m of ordered){
        const upd = empUpdateFromMovement(m.type, m.to_dept, m.date, m.job_level);
        if(Object.keys(upd).length){ upd.updated_at=new Date().toISOString(); const {error:ue}=await supabase.from("employees").update(upd).eq("emp_code",m.emp_code); if(!ue) updated++; }
      }
      if(errors.length) console.warn("Movement import errors:", errors);
      const warn=(skipped?` \u00B7 \u0E02\u0E49\u0E32\u0E21 ${skipped}`:"")+(errors.length?` (${errors.length} error \u2014 \u0E14\u0E39 console)`:"");
      notify("\u0E19\u0E33\u0E40\u0E02\u0E49\u0E32\u0E01\u0E32\u0E23\u0E1B\u0E23\u0E31\u0E1A\u0E15\u0E33\u0E41\u0E2B\u0E19\u0E48\u0E07", `${batch.length} \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23 \u00B7 \u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15\u0E1E\u0E19\u0E31\u0E01\u0E07\u0E32\u0E19 ${updated}${warn}`, {category:"movement", toastMsg:`Import \u0E40\u0E2A\u0E23\u0E47\u0E08: ${batch.length} \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23${warn}`});
    } catch(err){ toast("\u0E2D\u0E48\u0E32\u0E19\u0E44\u0E1F\u0E25\u0E4C\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49: "+err.message,"error"); }
  };
  reader.readAsBinaryString(file);
}

// ===== ANALYTICS =====
function renderAnalytics() {
  const pg = document.getElementById("pageAnalytics");
  const byType={};
  allMovements.forEach(m=>byType[m.type]=(byType[m.type]||0)+1);
  const maxT=Math.max(...Object.values(byType),1);
  pg.innerHTML=`
  <div class="page-header"><div><div class="page-heading">Analytics</div><div class="page-sub">ข้อมูลเชิงลึก</div></div></div>
  <div class="section mt-4 grid-2 pb-4">
    <div class="card card-body">
      <div class="card-title">สัดส่วนประเภท Movement</div>
      ${Object.entries(byType).sort((a,b)=>b[1]-a[1]).map(([t,n])=>{ const [c]=MOV_COLORS[t]||["#64748B"]; return `<div class="hbar-row"><div class="hbar-label">${esc(t)}</div><div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(n/maxT*100)}%;background:${c};"></div></div><div class="hbar-val">${n}</div></div>`; }).join("")||`<div class="empty-state"><div class="empty-title">ยังไม่มีข้อมูล</div></div>`}
    </div>
    <div class="card card-body">
      <div class="card-title">สรุป</div>
      <div class="stat-row"><span class="stat-label">รายการทั้งหมด</span><span class="stat-val">${allMovements.length}</span></div>
      <div class="stat-row"><span class="stat-label">พนักงาน Active</span><span class="stat-val">${allEmployees.filter(e=>e.status==="Active"||!e.status).length}</span></div>
      <div class="stat-row"><span class="stat-label">พนักงานทั้งหมด</span><span class="stat-val">${allEmployees.length}</span></div>
      <div class="stat-row"><span class="stat-label">ประเภทที่พบมากสุด</span><span class="stat-val">${Object.entries(byType).sort((a,b)=>b[1]-a[1])[0]?.[0]||"-"}</span></div>
    </div>
  </div>`;
}

// ===== PAYROLL =====
function renderPayroll() {
  if(userRole!=="hr"&&userRole!=="admin"){
    document.getElementById("pagePayroll").innerHTML=`<div class="empty-state" style="padding-top:80px;"><div class="empty-title">ไม่มีสิทธิ์เข้าถึง</div><div class="empty-sub">เฉพาะ HR และ Admin</div></div>`;
    return;
  }
  const months=[...new Set(allMovements.map(m=>movYM(m)))].filter(Boolean).sort().reverse();
  let selMonth=months[0]||"";

  const getRows = m => allMovements.filter(mv => !m||(movYM(mv)===m));

  const pg = document.getElementById("pagePayroll");
  pg.innerHTML=`
  <div class="page-header">
    <div><div class="page-heading">รายงานเงินเดือน</div><div class="page-sub" id="payrollSub"></div></div>
    <div class="header-actions">
      <select class="filter-select" id="payrollMonthSel" onchange="window._payrollMonth(this.value)">
        <option value="">ทุกเดือน</option>
        ${months.map(m=>{const [y,mo]=m.split("-");const l=new Date(Number(y),Number(mo)-1).toLocaleDateString("th-TH",{month:"long",year:"numeric"});return `<option value="${m}" ${m===selMonth?"selected":""}>${l}</option>`;}).join("")}
      </select>
      <button class="btn btn-gold" onclick="window._exportPayroll()">📤 Export Excel</button>
    </div>
  </div>
  <div class="section mt-4 pb-4"><div class="card"><div class="table-wrap">
    <table class="data-table">
      <thead><tr><th>รหัส</th><th>ชื่อ</th><th>ประเภท</th><th>วันที่มีผล</th><th>แผนกเดิม</th><th>แผนกใหม่</th><th>เงินเดือนใหม่</th><th>Cost Center</th><th>บันทึกโดย</th></tr></thead>
      <tbody id="payrollBody"></tbody>
    </table>
  </div></div></div>`;

  const updateTable = m => {
    const rows=getRows(m);
    document.getElementById("payrollSub").textContent=`${rows.length} รายการ · รวม ${rows.reduce((s,r)=>s+(Number(r.salary)||0),0).toLocaleString("th-TH")} บาท`;
    document.getElementById("payrollBody").innerHTML=rows.length===0?`<tr><td colspan="9" class="text-center text-muted" style="padding:32px;">ไม่มีรายการ</td></tr>`:
    rows.map(m=>`<tr><td><b>${esc(m.emp_code||"-")}</b></td><td>${esc(m.name)}</td><td>${movBadge(m.type)}</td><td>${fmtDate(m.date)}</td><td class="text-muted">${esc(m.from_dept||"-")}</td><td class="text-muted">${esc(m.to_dept||"-")}</td><td>${m.salary?Number(m.salary).toLocaleString("th-TH"):"-"}</td><td class="text-muted">${esc(m.cost_center||"-")}</td><td class="text-muted">${esc(m.recorded_by||"-")}</td></tr>`).join("");
  };
  updateTable(selMonth);
  window._payrollMonth = m => { selMonth=m; updateTable(m); };
  window._exportPayroll = () => {
    if(!window.XLSX){ toast("กรุณารอโหลด library","error"); return; }
    const rows=getRows(selMonth);
    const h=["รหัส","ชื่อ","ประเภท","วันที่มีผล","แผนกเดิม","แผนกใหม่","เงินเดือนใหม่","Cost Center","บันทึกโดย"];
    const ws=window.XLSX.utils.aoa_to_sheet([h,...rows.map(m=>[m.emp_code||"",m.name,m.type,m.date||"",m.from_dept||"",m.to_dept||"",m.salary||"",m.cost_center||"",m.recorded_by||""])]);
    ws["!cols"]=h.map(()=>({wch:16}));
    const wb=window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb,ws,"Payroll");
    window.XLSX.writeFile(wb,`payroll_${selMonth||"all"}.xlsx`);
    toast("Export เสร็จสิ้น","success");
  };
}
