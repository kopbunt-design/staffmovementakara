import { supabase } from "./supabase-config.js";
import { logout } from "./auth.js";
import { loadMasterData } from "./masterdata-admin.js";

// ===== SHARED STATE =====
export let currentUser = null;
export let userRole = "user";
export let allMovements = [];
export let allEmployees = [];

// ===== UTILS =====
export const esc = s => (s||"").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fmtDate = d => d ? String(d).substring(0,10) : "-";
// เดือนของ movement: ใช้วันที่มีผล (date) ก่อน ถ้าไม่มีใช้วันที่บันทึก
export const movYM = m => (m.date || m.created_at || "").substring(0,7);
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

export const MOV_COLORS = {
  "Transfer":["#2B5AC7","#EEF3FB"],"Promotion":["#6D28D9","#EDE9FE"],
  "Demotion":["#C0392B","#FDECEA"],"Resignation":["#C0392B","#FDECEA"],
  "Termination":["#991b1b","#fee2e2"],"New Hire":["#0D7C4B","#E6F5EE"],
  "Retirement":["#D97706","#FEF7E8"],"Secondment":["#2B5AC7","#EEF3FB"],
};
export const movBadge = type => { const [c,bg]=MOV_COLORS[type]||["#64748B","#f1f5f9"]; return `<span class="badge" style="color:${c};background:${bg};">${esc(type)}</span>`; };

// ===== ROUTING =====
const pages = ["dashboard","employees","movements","headcount","movreport","workforce","vacancy","analytics","payroll","users","settings"];
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
  const active = allEmployees.filter(e=>e.status==="Active"||!e.status).length;
  document.getElementById("empNavCount").textContent = active||"";
}

// ===== REALTIME =====
function startRealtime() {
  supabase.channel("db-changes")
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
    .subscribe();
}

// ===== AUTH =====
supabase.auth.onAuthStateChange(async (_event, session) => {
  if (!session?.user) return;
  currentUser = session.user;

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

  await Promise.all([loadMovements(), loadEmployees(), loadMasterData()]);
  startRealtime();
  navigate("dashboard");
});

document.getElementById("logoutBtn")?.addEventListener("click", logout);

// ===== DASHBOARD =====
let dashMonth = ""; // "" = เดือนปัจจุบัน
function lastWorkYM(dateStr){
  if(!dateStr) return "";
  const d=new Date(dateStr);d.setUTCDate(d.getUTCDate()-1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
}
function getMonthStats(ym) {
  const movMonth = allMovements.filter(m => movYM(m) === ym);
  const movJoinCodes = new Set(movMonth.filter(m=>m.type==="New Hire").map(m=>m.emp_code));
  const empJoined = allEmployees.filter(e=>(e.join_date||"").substring(0,7)===ym && !movJoinCodes.has(e.emp_code));
  const movResignCodes = new Set(allMovements.filter(m=>lastWorkYM(m.date)===ym&&["Resignation","Termination","Retirement"].includes(m.type)).map(m=>m.emp_code));
  const empResigned = allEmployees.filter(e=>lastWorkYM(e.end_date)===ym && ["Resigned","Terminated","Retired"].includes(e.status) && !movResignCodes.has(e.emp_code));
  return { joined: movJoinCodes.size + empJoined.length, resigned: movResignCodes.size + empResigned.length };
}
function renderDashboard() {
  const pg = document.getElementById("pageDashboard");
  const active = allEmployees.filter(e=>e.status==="Active"||!e.status);
  const now = new Date();
  const currentYM = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const ym = dashMonth || currentYM;

  // สร้าง list เดือนย้อนหลัง 12 เดือน
  const monthOpts = [];
  for(let i=0;i<12;i++){
    const d=new Date(); d.setMonth(d.getMonth()-i);
    const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    const lbl=d.toLocaleDateString("th-TH",{month:"long",year:"numeric"});
    monthOpts.push({key,lbl});
  }

  const {joined,resigned} = getMonthStats(ym);
  const activeAtMonth = allEmployees.filter(e=>{
    const jm=(e.join_date||"").substring(0,7);
    const em=(e.end_date||"").substring(0,7);
    if(jm && jm>ym) return false;
    if(em && em<=ym) return false;
    return true;
  });
  const total = activeAtMonth.length;
  const turnover = total ? ((resigned/total)*100).toFixed(1) : "0.0";
  const selectedLabel = monthOpts.find(m=>m.key===ym)?.lbl || ym;

  const byDept = {}; activeAtMonth.forEach(e=>{ if(e.department) byDept[e.department]=(byDept[e.department]||0)+1; });
  const topDepts = Object.entries(byDept).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const maxD = topDepts[0]?.[1]||1;

  const months = [];
  for(let i=5;i>=0;i--){
    const d=new Date(ym+"-15"); d.setMonth(d.getMonth()-i);
    const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    const lbl=d.toLocaleDateString("th-TH",{month:"short"});
    const st=getMonthStats(key);
    months.push({lbl,j:st.joined,r:st.resigned});
  }
  const maxB = Math.max(...months.flatMap(m=>[m.j,m.r]),1);
  const recent = allMovements.filter(m=>movYM(m)===ym).slice(0,5);
  const byContract={}; activeAtMonth.forEach(e=>{ const c=e.contract_type||"Permanent"; byContract[c]=(byContract[c]||0)+1; });

  pg.innerHTML = `
  <div class="page-header">
    <div><div class="page-heading">Dashboard</div><div class="page-sub">Akara Resources · ${selectedLabel}</div></div>
    <select class="filter-select" onchange="window._dashMonth(this.value)" style="min-width:180px;">
      ${monthOpts.map(m=>`<option value="${m.key}" ${m.key===ym?"selected":""}>${m.lbl}</option>`).join("")}
    </select>
  </div>
  <div class="kpi-grid">
    <div class="kpi-card blue"><div class="kpi-label">Headcount รวม</div><div class="kpi-value" style="color:var(--blue);">${total}</div><div class="kpi-delta delta-neutral">พนักงาน Active</div></div>
    <div class="kpi-card green"><div class="kpi-label">เข้าใหม่</div><div class="kpi-value" style="color:var(--green);">${joined}</div><div class="kpi-delta delta-up">New Hire</div></div>
    <div class="kpi-card red"><div class="kpi-label">ลาออก/สิ้นสุด</div><div class="kpi-value" style="color:var(--red);">${resigned}</div><div class="kpi-delta delta-neutral">${selectedLabel}</div></div>
    <div class="kpi-card gold"><div class="kpi-label">Turnover Rate</div><div class="kpi-value" style="color:var(--gold-dark);">${turnover}%</div><div class="kpi-delta delta-neutral">${selectedLabel}</div></div>
  </div>
  <div class="section grid-2-1 mt-4">
    <div class="card card-body">
      <div class="card-title">แนวโน้ม Join vs Resign (6 เดือน)</div>
      <div style="display:flex;gap:12px;margin-bottom:10px;">
        <span style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);"><span style="width:10px;height:10px;border-radius:2px;background:var(--green);display:inline-block;"></span>เข้าใหม่</span>
        <span style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);"><span style="width:10px;height:10px;border-radius:2px;background:var(--red);display:inline-block;"></span>ลาออก</span>
      </div>
      <div class="bar-chart">
        ${months.map(m=>`<div class="bar-col">
          <div style="display:flex;gap:3px;align-items:flex-end;height:90px;">
            <div style="width:14px;height:${Math.round((m.j/maxB)*90)}px;background:var(--green);opacity:0.85;border-radius:3px 3px 0 0;min-height:2px;"></div>
            <div style="width:14px;height:${Math.round((m.r/maxB)*90)}px;background:var(--red);opacity:0.85;border-radius:3px 3px 0 0;min-height:2px;"></div>
          </div>
          <div class="bar-label">${m.lbl}</div>
        </div>`).join("")}
      </div>
    </div>
    <div class="card card-body">
      <div class="card-title">ประเภทสัญญา</div>
      ${Object.entries(byContract).map(([t,n])=>`<div class="hbar-row"><div class="hbar-label">${esc(t)}</div><div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(n/(total||1)*100)}%;background:var(--blue);"></div></div><div class="hbar-val">${n}</div></div>`).join("")||`<div class="text-muted text-sm text-center" style="padding:20px 0;">ยังไม่มีข้อมูล</div>`}
    </div>
  </div>
  <div class="section grid-2 mt-4 pb-4">
    <div class="card card-body">
      <div class="card-title">Headcount by Department</div>
      ${topDepts.map(([d,n])=>`<div class="hbar-row"><div class="hbar-label">${esc(d)}</div><div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(n/maxD*100)}%;background:var(--blue);"></div></div><div class="hbar-val">${n}</div></div>`).join("")||`<div class="text-muted text-sm text-center" style="padding:20px 0;">ยังไม่มีข้อมูล</div>`}
    </div>
    <div class="card card-body">
      <div class="card-title">รายการล่าสุด</div>
      ${recent.length===0?`<div class="empty-state"><div class="empty-title">ยังไม่มีรายการ</div></div>`:recent.map(m=>{
        const [c,bg]=MOV_COLORS[m.type]||["#64748B","#f1f5f9"]; const av=avatarColor(m.name||"");
        return `<div class="feed-item"><div class="feed-avatar" style="background:${av}18;color:${av};">${initials(m.name||"")}</div><div class="feed-body"><div class="feed-name">${esc(m.name||"-")} <span class="badge" style="color:${c};background:${bg};">${esc(m.type)}</span></div><div class="feed-meta">${esc(m.from_dept||"")}${m.to_dept?` → ${m.to_dept}`:""}</div></div><div class="feed-time">${timeAgo(m.created_at)}</div></div>`;
      }).join("")}
    </div>
  </div>`;
  window._dashMonth = v => { dashMonth = v; renderDashboard(); };
}

// ===== MOVEMENTS =====
let movFilter="", movFilterType="", movFilterMonth="";

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
        <td style="font-weight:600;">${esc(m.name||"-")}</td>
        <td>${movBadge(m.type)}</td>
        <td class="text-muted">${esc(m.from_dept||"-")}</td>
        <td class="text-muted">${esc(m.to_dept||"-")}</td>
        <td class="text-muted">${fmtDate(m.date)}</td>
        <td class="text-muted" style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(m.reason||"-")}</td>
        <td class="text-muted">${esc(m.recorded_by||"-")}</td>
        <td class="text-muted">${fmtDate(m.created_at)}</td>
        <td>${m.created_by===currentUser?.id?`<button class="btn btn-secondary btn-sm" onclick="window._editMov('${m.id}')">แก้ไข</button>`:""}</td>
      </tr>`).join("")}</tbody>
    </table>
  </div></div></div>`;

  window._movSearch = v => { movFilter=v; renderMovements(); };
  window._movType = v => { movFilterType=v; renderMovements(); };
  window._movMonth = v => { movFilterMonth=v; renderMovements(); };
  window._openMovModal = () => openMovModal(null);
  window._editMov = id => openMovModal(allMovements.find(m=>m.id===id));
  window._exportMovCSV = exportMovCSV;
}

function openMovModal(entry=null) {
  const isEdit = !!entry?.id;
  const empOpts = allEmployees.filter(e=>e.status==="Active"||!e.status).map(e=>`<option value="${esc(e.emp_code)}" data-name="${esc((e.firstname_th||"")+" "+(e.lastname_th||""))}" data-dept="${esc(e.department||"")}" data-pos="${esc(e.position||"")}" data-sec="${esc(e.section||"")}">${esc(e.emp_code)} - ${esc((e.firstname_th||"")+" "+(e.lastname_th||""))}</option>`).join("");

  document.getElementById("modalPortal").innerHTML = `<div class="modal-overlay" id="movModal">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">${isEdit?"แก้ไขรายการ":"บันทึก Staff Movement"}</div>
        <button class="modal-close" onclick="document.getElementById('movModal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group col-span-2">
            <label class="form-label">เลือกพนักงาน</label>
            <select class="form-control" onchange="if(this.value){document.getElementById('mv_code').value=this.value;const o=this.options[this.selectedIndex];document.getElementById('mv_name').value=o.dataset.name||'';const from=[o.dataset.dept,o.dataset.pos].filter(Boolean).join(' / ');document.getElementById('mv_from').value=from;}">
              <option value="">-- เลือกจากรายชื่อพนักงาน --</option>${empOpts}
            </select>
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
          <div class="form-group"><label class="form-label">Cost Center</label><input id="mv_cc" class="form-control" value="${esc(entry?.cost_center||"")}"></div>`:""}
        </div>
      </div>
      <div class="modal-footer">
        ${isEdit&&entry?.created_by===currentUser?.id?`<button class="btn btn-danger" onclick="window._delMov('${entry.id}')">ลบ</button>`:""}
        <button class="btn btn-secondary" onclick="document.getElementById('movModal').remove()">ยกเลิก</button>
        <button class="btn btn-primary" onclick="window._saveMov('${entry?.id||""}')">บันทึก</button>
      </div>
    </div>
  </div>`;

  window._saveMov = async (existId) => {
    const g = id => document.getElementById(id)?.value?.trim()||"";
    const name = g("mv_name"); if(!name){ toast("กรุณากรอกชื่อ","error"); return; }
    const data = {
      emp_code: g("mv_code"), name, type: g("mv_type"),
      date: g("mv_date")||null, from_dept: g("mv_from"), to_dept: g("mv_to"),
      reason: g("mv_reason"),
      recorded_by: currentUser?.user_metadata?.full_name||currentUser?.email?.split("@")[0]||"",
      created_by: currentUser?.id,
      ...(userRole==="hr"||userRole==="admin" ? { salary: Number(document.getElementById("mv_sal")?.value)||null, cost_center: g("mv_cc") } : {})
    };
    const { error } = existId
      ? await supabase.from("movements").update({...data, updated_at: new Date().toISOString()}).eq("id", existId)
      : await supabase.from("movements").insert(data);
    if(error){ toast("บันทึกไม่สำเร็จ: "+error.message,"error"); return; }
    // อัปเดตข้อมูลพนักงานอัตโนมัติตามประเภท movement
    if(data.emp_code){
      const empUpdate = { updated_at: new Date().toISOString() };
      const t = data.type;
      if(["Resignation","Termination","Retirement"].includes(t)){
        const statusMap = {Resignation:"Resigned",Termination:"Terminated",Retirement:"Retired"};
        empUpdate.status = statusMap[t];
        if(data.date) empUpdate.end_date = data.date;
      } else if(t==="Transfer"){
        if(data.to_dept) empUpdate.department = data.to_dept;
        if(data.date) empUpdate.effective_date = data.date;
      } else if(t==="Promotion"||t==="Demotion"){
        if(data.to_dept) empUpdate.position = data.to_dept;
        if(data.date) empUpdate.effective_date = data.date;
      } else if(t==="New Hire"){
        empUpdate.status = "Active";
        if(data.date) empUpdate.join_date = data.date;
      }
      if(Object.keys(empUpdate).length>1){
        await supabase.from("employees").update(empUpdate).eq("emp_code",data.emp_code);
      }
    }
    document.getElementById("modalPortal").innerHTML="";
    toast("บันทึกสำเร็จ","success");
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
