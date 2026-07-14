import { supabase } from "./supabase-config.js";
import { userRole, esc, toast, notify } from "./app.js";

// ===== CACHED MASTER DATA =====
export let masterDivisions = [];
export let masterDepartments = [];
export let masterSections = [];
export let masterTeams = [];
export let masterPositions = [];
export let masterJobLevels = [];

export async function loadMasterData() {
  const [divs, depts, sects, teams, pos, jls] = await Promise.all([
    supabase.from("master_divisions").select("*").eq("is_active",true).order("sort_order"),
    supabase.from("master_departments").select("*,master_divisions(name)").eq("is_active",true).order("sort_order"),
    supabase.from("master_sections").select("*,master_departments(name)").eq("is_active",true).order("sort_order"),
    supabase.from("master_teams").select("*,master_sections(name)").eq("is_active",true).order("sort_order"),
    supabase.from("master_positions").select("*").eq("is_active",true).order("sort_order"),
    supabase.from("master_job_levels").select("*").eq("is_active",true).order("sort_order"),
  ]);
  masterDivisions  = divs.data  || [];
  masterDepartments= depts.data || [];
  masterSections   = sects.data || [];
  masterTeams      = teams.data || [];
  masterPositions  = pos.data   || [];
  masterJobLevels  = jls.data   || [];
}

// ===== CASCADE HELPERS =====
export function getDeptsByDiv(divId) {
  return masterDepartments.filter(d => d.division_id === divId);
}
export function getSectsByDept(deptId) {
  return masterSections.filter(s => s.department_id === deptId);
}
export function getTeamsBySect(sectId) {
  return masterTeams.filter(t => t.section_id === sectId);
}

// ===== SETTINGS PAGE =====
export function renderSettings() {
  if (userRole !== "admin") {
    document.getElementById("pageSettings").innerHTML = `<div class="empty-state" style="padding-top:80px;"><div class="empty-title">ไม่มีสิทธิ์เข้าถึง</div><div class="empty-sub">เฉพาะ Admin เท่านั้น</div></div>`;
    return;
  }

  const pg = document.getElementById("pageSettings");
  pg.innerHTML = `
  <div class="page-header">
    <div><div class="page-heading">Settings</div><div class="page-sub">จัดการโครงสร้างองค์กรและ Master Data</div></div>
  </div>

  <div class="section mt-4 pb-4" style="display:flex;flex-direction:column;gap:16px;">

    <!-- Division -->
    <div class="card card-body">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div class="card-title" style="margin:0;">Division (${masterDivisions.length})</div>
        <button class="btn btn-primary btn-sm" onclick="window._openMasterModal('divisions')">+ เพิ่ม</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${masterDivisions.map(d=>`
        <div style="display:flex;align-items:center;gap:8px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:7px 12px;">
          <span style="font-size:11px;font-weight:700;color:var(--blue);">${esc(d.code)}</span>
          <span style="font-size:12px;font-weight:500;">${esc(d.name)}</span>
          ${d.name_th?`<span style="font-size:11px;color:var(--muted);">(${esc(d.name_th)})</span>`:""}
          <button onclick="window._editMaster('divisions',${d.id})" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:12px;">✏️</button>
        </div>`).join("")||`<div class="text-muted text-sm">ยังไม่มีข้อมูล</div>`}
      </div>
    </div>

    <!-- Department -->
    <div class="card card-body">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div class="card-title" style="margin:0;">Department (${masterDepartments.length})</div>
        <button class="btn btn-primary btn-sm" onclick="window._openMasterModal('departments')">+ เพิ่ม</button>
      </div>
      <div class="table-wrap">
        <table class="data-table" style="font-size:12px;">
          <thead><tr><th>Code</th><th>ชื่อ</th><th>ชื่อไทย</th><th>Division</th><th></th></tr></thead>
          <tbody>${masterDepartments.map(d=>`<tr>
            <td><b style="color:var(--blue)">${esc(d.code)}</b></td>
            <td>${esc(d.name)}</td>
            <td class="text-muted">${esc(d.name_th||"-")}</td>
            <td><span class="badge badge-blue">${esc(d.master_divisions?.name||"-")}</span></td>
            <td><button class="btn btn-secondary btn-sm" onclick="window._editMaster('departments',${d.id})">แก้ไข</button></td>
          </tr>`).join("")||`<tr><td colspan="5" class="text-center text-muted" style="padding:24px;">ยังไม่มีข้อมูล</td></tr>`}</tbody>
        </table>
      </div>
    </div>

    <!-- Section -->
    <div class="card card-body">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div class="card-title" style="margin:0;">Section (${masterSections.length})</div>
        <button class="btn btn-primary btn-sm" onclick="window._openMasterModal('sections')">+ เพิ่ม</button>
      </div>
      <div class="table-wrap">
        <table class="data-table" style="font-size:12px;">
          <thead><tr><th>Code</th><th>ชื่อ</th><th>ชื่อไทย</th><th>Department</th><th></th></tr></thead>
          <tbody>${masterSections.map(s=>`<tr>
            <td><b style="color:var(--blue)">${esc(s.code)}</b></td>
            <td>${esc(s.name)}</td>
            <td class="text-muted">${esc(s.name_th||"-")}</td>
            <td><span class="badge badge-gray">${esc(s.master_departments?.name||"-")}</span></td>
            <td><button class="btn btn-secondary btn-sm" onclick="window._editMaster('sections',${s.id})">แก้ไข</button></td>
          </tr>`).join("")||`<tr><td colspan="5" class="text-center text-muted" style="padding:24px;">ยังไม่มีข้อมูล</td></tr>`}</tbody>
        </table>
      </div>
    </div>

    <!-- Team -->
    <div class="card card-body">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div class="card-title" style="margin:0;">Team (${masterTeams.length})</div>
        <button class="btn btn-primary btn-sm" onclick="window._openMasterModal('teams')">+ เพิ่ม</button>
      </div>
      <div class="table-wrap">
        <table class="data-table" style="font-size:12px;">
          <thead><tr><th>Code</th><th>ชื่อ</th><th>ชื่อไทย</th><th>Section</th><th></th></tr></thead>
          <tbody>${masterTeams.map(t=>`<tr>
            <td><b style="color:var(--blue)">${esc(t.code)}</b></td>
            <td>${esc(t.name)}</td>
            <td class="text-muted">${esc(t.name_th||"-")}</td>
            <td><span class="badge badge-gray">${esc(t.master_sections?.name||"-")}</span></td>
            <td><button class="btn btn-secondary btn-sm" onclick="window._editMaster('teams',${t.id})">แก้ไข</button></td>
          </tr>`).join("")||`<tr><td colspan="5" class="text-center text-muted" style="padding:24px;">ยังไม่มีข้อมูล</td></tr>`}</tbody>
        </table>
      </div>
    </div>

    <!-- Position -->
    <div class="card card-body">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div class="card-title" style="margin:0;">Position (${masterPositions.length})</div>
        <button class="btn btn-primary btn-sm" onclick="window._openMasterModal('positions')">+ เพิ่ม</button>
      </div>
      <div class="table-wrap">
        <table class="data-table" style="font-size:12px;">
          <thead><tr><th>Code</th><th>ชื่อ</th><th>ชื่อไทย</th><th></th></tr></thead>
          <tbody>${masterPositions.map(p=>`<tr>
            <td><b style="color:var(--blue)">${esc(p.code)}</b></td>
            <td>${esc(p.name)}</td>
            <td class="text-muted">${esc(p.name_th||"-")}</td>
            <td><button class="btn btn-secondary btn-sm" onclick="window._editMaster('positions',${p.id})">แก้ไข</button></td>
          </tr>`).join("")||`<tr><td colspan="4" class="text-center text-muted" style="padding:24px;">ยังไม่มีข้อมูล</td></tr>`}</tbody>
        </table>
      </div>
    </div>

    <!-- Job Level -->
    <div class="card card-body">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div class="card-title" style="margin:0;">Job Level</div>
        <button class="btn btn-primary btn-sm" onclick="window._openMasterModal('job_levels')">+ เพิ่ม</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${masterJobLevels.map(j=>`
        <div style="display:flex;align-items:center;gap:6px;background:var(--navy);color:#fff;border-radius:8px;padding:6px 12px;">
          <span style="font-size:13px;font-weight:700;">${esc(j.code)}</span>
          <button onclick="window._editMaster('job_levels',${j.id})" style="background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.5);font-size:11px;">✏️</button>
        </div>`).join("")}
      </div>
    </div>
  </div>`;

  bindMasterEvents();
}

function bindMasterEvents() {
  window._openMasterModal = (table) => openMasterModal(table, null);
  window._editMaster = (table, id) => {
    const items = {
      divisions: masterDivisions, departments: masterDepartments,
      sections: masterSections, teams: masterTeams,
      positions: masterPositions, job_levels: masterJobLevels,
    };
    const item = items[table]?.find(x => x.id === id);
    openMasterModal(table, item);
  };
}

function openMasterModal(table, item=null) {
  const isEdit = !!item;
  const tableLabels = {
    divisions:"Division", departments:"Department",
    sections:"Section", teams:"Team",
    positions:"Position", job_levels:"Job Level"
  };
  const label = tableLabels[table] || table;

  // Parent selector
  let parentField = "";
  if (table==="departments") {
    parentField = `<div class="form-group"><label class="form-label">Division *</label>
      <select id="mf_parent" class="form-control">
        <option value="">-- เลือก Division --</option>
        ${masterDivisions.map(d=>`<option value="${d.id}" ${d.id===item?.division_id?"selected":""}>${esc(d.name)}</option>`).join("")}
      </select></div>`;
  } else if (table==="sections") {
    parentField = `<div class="form-group"><label class="form-label">Department *</label>
      <select id="mf_parent" class="form-control">
        <option value="">-- เลือก Department --</option>
        ${masterDepartments.map(d=>`<option value="${d.id}" ${d.id===item?.department_id?"selected":""}>${esc(d.name)}</option>`).join("")}
      </select></div>`;
  } else if (table==="teams") {
    parentField = `<div class="form-group"><label class="form-label">Section *</label>
      <select id="mf_parent" class="form-control">
        <option value="">-- เลือก Section --</option>
        ${masterSections.map(s=>`<option value="${s.id}" ${s.id===item?.section_id?"selected":""}>${esc(s.name)}</option>`).join("")}
      </select></div>`;
  }

  document.getElementById("modalPortal").innerHTML = `<div class="modal-overlay" id="masterModal">
    <div class="modal" style="max-width:460px;">
      <div class="modal-header">
        <div class="modal-title">${isEdit?"แก้ไข":"เพิ่ม"} ${label}</div>
        <button class="modal-close" onclick="document.getElementById('masterModal').remove()">✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:12px;">
        <div class="form-group"><label class="form-label">Code *</label>
          <input id="mf_code" class="form-control" value="${esc(item?.code||"")}" ${isEdit?"readonly":""}  placeholder="เช่น L1-006, P-187">
        </div>
        <div class="form-group"><label class="form-label">ชื่อ (English) *</label>
          <input id="mf_name" class="form-control" value="${esc(item?.name||"")}" placeholder="ชื่อภาษาอังกฤษ">
        </div>
        ${table!=="job_levels"?`<div class="form-group"><label class="form-label">ชื่อ (ภาษาไทย)</label>
          <input id="mf_name_th" class="form-control" value="${esc(item?.name_th||"")}" placeholder="ชื่อภาษาไทย">
        </div>`:""}
        ${parentField}
        <div class="form-group"><label class="form-label">Sort Order</label>
          <input id="mf_sort" type="number" class="form-control" value="${item?.sort_order||0}">
        </div>
        ${isEdit?`<div class="form-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="mf_active" ${item?.is_active!==false?"checked":""}>
            เปิดใช้งาน (ปิดจะซ่อนจาก dropdown)
          </label>
        </div>`:""}
      </div>
      <div class="modal-footer">
        ${isEdit?`<button class="btn btn-danger" onclick="window._deleteMaster('${table}',${item.id})">ลบ</button>`:""}
        <button class="btn btn-secondary" onclick="document.getElementById('masterModal').remove()">ยกเลิก</button>
        <button class="btn btn-primary" onclick="window._saveMaster('${table}','${item?.id||""}')">บันทึก</button>
      </div>
    </div>
  </div>`;

  window._saveMaster = async (tbl, existId) => {
    const code = document.getElementById("mf_code").value.trim();
    const name = document.getElementById("mf_name").value.trim();
    if(!code||!name){ toast("กรุณากรอก Code และชื่อ","error"); return; }

    const data = {
      code, name,
      name_th: document.getElementById("mf_name_th")?.value.trim()||null,
      sort_order: Number(document.getElementById("mf_sort").value)||0,
      is_active: document.getElementById("mf_active")?.checked ?? true,
    };

    const parentVal = document.getElementById("mf_parent")?.value;
    if(tbl==="departments" && parentVal) data.division_id = Number(parentVal);
    if(tbl==="sections" && parentVal) data.department_id = Number(parentVal);
    if(tbl==="teams" && parentVal) data.section_id = Number(parentVal);

    const { error } = existId
      ? await supabase.from(`master_${tbl}`).update(data).eq("id", Number(existId))
      : await supabase.from(`master_${tbl}`).insert(data);

    if(error){ toast("บันทึกไม่สำเร็จ: "+error.message,"error"); return; }
    document.getElementById("masterModal").remove();
    if(existId){
      toast("บันทึกสำเร็จ","success");
    } else {
      const tblLabel={divisions:"Division",departments:"Department",sections:"Section",teams:"Team",positions:"Position",job_levels:"Job Level"}[tbl]||tbl;
      notify("เพิ่มข้อมูลหลัก", `${tblLabel}: ${name}`, {category:"master"});
    }
    await loadMasterData();
    renderSettings();
  };

  window._deleteMaster = async (tbl, id) => {
    if(!confirm("ลบรายการนี้?\nถ้ามีพนักงานใช้งานอยู่จะไม่กระทบข้อมูลเดิม แต่จะไม่แสดงใน dropdown อีก")) return;
    await supabase.from(`master_${tbl}`).update({is_active:false}).eq("id",id);
    document.getElementById("masterModal").remove();
    toast("ซ่อนรายการเรียบร้อย","info");
    await loadMasterData();
    renderSettings();
  };
}
