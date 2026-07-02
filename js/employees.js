import { supabase } from "./supabase-config.js";
import { allEmployees, currentUser, userRole, esc, fmtDate, avatarColor, initials, toast } from "./app.js";
import { DIVISIONS, DEPARTMENTS, SECTIONS, TEAMS, POSITIONS, JOB_LEVELS, SITES, CONTRACT_TYPES, NATIONALITIES, GENDERS, EMP_STATUSES } from "./masterdata.js";

let empSearch="", empDept="", empStatus="Active";

const sel = (opts, val="", ph="-- เลือก --") =>
  `<option value="">${ph}</option>` + opts.map(o => {
    const v = typeof o==="string"?o:o.code;
    const l = typeof o==="string"?o:(o.name+(o.nameTH?` (${o.nameTH})`:""));
    return `<option value="${v}" ${v===val?"selected":""}>${l}</option>`;
  }).join("");

export function renderEmployees() {
  const pg = document.getElementById("pageEmployees");
  const filtered = allEmployees.filter(e => {
    if(empStatus && e.status!==empStatus) return false;
    if(empDept && e.department!==empDept) return false;
    if(empSearch){ const h=[e.emp_code,e.firstname_th,e.lastname_th,e.firstname_en,e.lastname_en,e.position].join(" ").toLowerCase(); if(!h.includes(empSearch.toLowerCase())) return false; }
    return true;
  });
  const canWrite = userRole==="hr"||userRole==="admin";
  const activeCount = allEmployees.filter(e=>e.status==="Active"||!e.status).length;

  pg.innerHTML = `
  <div class="page-header">
    <div><div class="page-heading">ข้อมูลพนักงาน</div>
    <div class="page-sub">${filtered.length} รายการ · Active: ${activeCount} · ทั้งหมด: ${allEmployees.length}</div></div>
    ${canWrite?`<div class="header-actions">
      <button class="btn btn-secondary btn-sm" onclick="window._empTemplate()">📋 Template</button>
      <button class="btn btn-secondary btn-sm" onclick="document.getElementById('empFile').click()">📥 Import Excel</button>
      <button class="btn btn-secondary btn-sm" onclick="window._empExport()">📤 Export</button>
      <button class="btn btn-primary" onclick="window._openEmp(null)">+ เพิ่มพนักงาน</button>
      <input type="file" id="empFile" accept=".xlsx,.xls" style="display:none;" onchange="window._empImport(this)">
    </div>`:""}
  </div>
  <div class="search-bar">
    <div class="search-input-wrap">
      <svg class="search-icon" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <input class="search-input" placeholder="ค้นหาชื่อ / รหัส / ตำแหน่ง..." value="${esc(empSearch)}" oninput="window._empSearch(this.value)">
    </div>
    <select class="filter-select" onchange="window._empDept(this.value)">
      <option value="">ทุก Department</option>
      ${DEPARTMENTS.map(d=>`<option value="${d.name}" ${d.name===empDept?"selected":""}>${d.name}</option>`).join("")}
    </select>
    <select class="filter-select" onchange="window._empStatus(this.value)">
      <option value="">ทุกสถานะ</option>
      ${EMP_STATUSES.map(s=>`<option value="${s}" ${s===empStatus?"selected":""}>${s}</option>`).join("")}
    </select>
  </div>
  <div class="section mt-4 pb-4"><div class="card"><div class="table-wrap">
    <table class="data-table">
      <thead><tr><th>รหัส</th><th>ชื่อ-นามสกุล</th><th>Department</th><th>Position</th><th>Job Level</th><th>ประเภทสัญญา</th><th>Site</th><th>วันเริ่มงาน</th><th>สถานะ</th>${canWrite?"<th></th>":""}</tr></thead>
      <tbody>${filtered.length===0?`<tr><td colspan="${canWrite?10:9}" class="text-center text-muted" style="padding:48px;">ไม่พบพนักงาน${empSearch||empDept||empStatus?" ที่ตรงกับเงื่อนไข":""}</td></tr>`:
      filtered.map(e=>{
        const sc={Active:"var(--green)",Resigned:"var(--red)",Terminated:"var(--red)",Retired:"var(--muted)",Transferred:"var(--blue)"}[e.status||"Active"]||"var(--green)";
        const sbg={Active:"var(--green-light)",Resigned:"var(--red-light)",Terminated:"var(--red-light)",Retired:"#f1f5f9",Transferred:"var(--blue-light)"}[e.status||"Active"]||"var(--green-light)";
        const av=avatarColor(e.firstname_th||e.emp_code||"");
        return `<tr>
          <td><b style="color:var(--blue);font-size:12px;">${esc(e.emp_code||"-")}</b></td>
          <td><div style="display:flex;align-items:center;gap:8px;">
            <div style="width:28px;height:28px;border-radius:8px;background:${av}18;color:${av};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">${initials((e.firstname_th||"")+" "+(e.lastname_th||""))}</div>
            <div><div style="font-weight:600;">${esc((e.firstname_th||"")+" "+(e.lastname_th||""))}</div>
            <div class="text-sm text-muted">${esc((e.firstname_en||"")+" "+(e.lastname_en||""))}</div></div>
          </div></td>
          <td class="text-muted">${esc(e.department||"-")}</td>
          <td class="text-muted">${esc(e.position||"-")}</td>
          <td><span class="badge badge-gray">${esc(e.job_level||"-")}</span></td>
          <td class="text-muted">${esc(e.contract_type||"-")}</td>
          <td class="text-muted">${esc(e.site||"-")}</td>
          <td class="text-muted">${fmtDate(e.join_date)}</td>
          <td><span class="badge" style="color:${sc};background:${sbg};">${esc(e.status||"Active")}</span></td>
          ${canWrite?`<td><button class="btn btn-secondary btn-sm" onclick="window._openEmp('${e.emp_code}')">แก้ไข</button></td>`:""}
        </tr>`;
      }).join("")}</tbody>
    </table>
  </div></div></div>`;

  window._empSearch = v => { empSearch=v; renderEmployees(); };
  window._empDept = v => { empDept=v; renderEmployees(); };
  window._empStatus = v => { empStatus=v; renderEmployees(); };
  window._openEmp = code => openEmpModal(code ? allEmployees.find(e=>e.emp_code===code) : null);
  window._empTemplate = downloadTemplate;
  window._empImport = handleImport;
  window._empExport = handleExport;
}

function openEmpModal(emp=null) {
  const isEdit = !!emp;
  const v = f => esc(emp?.[f]||"");

  document.getElementById("modalPortal").innerHTML = `<div class="modal-overlay" id="empModal">
    <div class="modal modal-lg">
      <div class="modal-header">
        <div class="modal-title">${isEdit?"แก้ไขข้อมูลพนักงาน":"เพิ่มพนักงานใหม่"}</div>
        <button class="modal-close" onclick="document.getElementById('empModal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group"><label class="form-label">รหัสพนักงาน *</label><input id="ef_code" class="form-control" value="${v("emp_code")}" ${isEdit?"readonly":""}></div>
          <div class="form-group"><label class="form-label">สถานะ</label><select id="ef_status" class="form-control">${sel(EMP_STATUSES,emp?.status||"Active")}</select></div>
          <div class="form-group"><label class="form-label">ชื่อ (ภาษาไทย) *</label><input id="ef_fnTH" class="form-control" value="${v("firstname_th")}"></div>
          <div class="form-group"><label class="form-label">นามสกุล (ภาษาไทย) *</label><input id="ef_lnTH" class="form-control" value="${v("lastname_th")}"></div>
          <div class="form-group"><label class="form-label">First Name</label><input id="ef_fnEN" class="form-control" value="${v("firstname_en")}"></div>
          <div class="form-group"><label class="form-label">Last Name</label><input id="ef_lnEN" class="form-control" value="${v("lastname_en")}"></div>
          <div class="form-group"><label class="form-label">เพศ</label><select id="ef_gender" class="form-control">${sel(GENDERS,emp?.gender||"")}</select></div>
          <div class="form-group"><label class="form-label">สัญชาติ</label><select id="ef_nat" class="form-control">${sel(NATIONALITIES,emp?.nationality||"")}</select></div>
          <div class="form-group"><label class="form-label">วันเกิด</label><input id="ef_dob" type="date" class="form-control" value="${v("dob")}"></div>
          <div class="form-group"><label class="form-label">เบอร์โทรศัพท์</label><input id="ef_phone" class="form-control" value="${v("phone")}"></div>
          <div class="form-group"><label class="form-label">Division</label><select id="ef_div" class="form-control">${sel(DIVISIONS,emp?.division||"")}</select></div>
          <div class="form-group"><label class="form-label">Department</label><select id="ef_dept" class="form-control">${sel(DEPARTMENTS,emp?.department||"")}</select></div>
          <div class="form-group"><label class="form-label">Section</label><select id="ef_sect" class="form-control">${sel(SECTIONS,emp?.section||"")}</select></div>
          <div class="form-group"><label class="form-label">Team</label><select id="ef_team" class="form-control">${sel(TEAMS,emp?.team||"")}</select></div>
          <div class="form-group col-span-2"><label class="form-label">Position</label><select id="ef_pos" class="form-control">${sel(POSITIONS,emp?.position||"")}</select></div>
          <div class="form-group"><label class="form-label">Job Level</label><select id="ef_jl" class="form-control">${sel(JOB_LEVELS,emp?.job_level||"")}</select></div>
          <div class="form-group"><label class="form-label">Site</label><select id="ef_site" class="form-control">${sel(SITES,emp?.site||"")}</select></div>
          <div class="form-group"><label class="form-label">ประเภทสัญญา</label><select id="ef_ct" class="form-control">${sel(CONTRACT_TYPES,emp?.contract_type||"")}</select></div>
          <div class="form-group"><label class="form-label">วันเริ่มงาน *</label><input id="ef_join" type="date" class="form-control" value="${v("join_date")}"></div>
          <div class="form-group"><label class="form-label">Effective Date</label><input id="ef_eff" type="date" class="form-control" value="${v("effective_date")}"></div>
          <div class="form-group"><label class="form-label">วันสิ้นสุดสัญญา</label><input id="ef_end" type="date" class="form-control" value="${v("end_date")}"></div>
          ${userRole==="hr"||userRole==="admin"?`<div class="form-group"><label class="form-label">เงินเดือน (บาท)</label><input id="ef_sal" type="number" class="form-control" value="${emp?.salary||""}"></div>`:`<div></div>`}
          <div class="form-group col-span-2"><label class="form-label">Remark</label><textarea id="ef_remark" class="form-control">${v("remark")}</textarea></div>
        </div>
      </div>
      <div class="modal-footer">
        ${isEdit?`<button class="btn btn-danger" onclick="window._deleteEmp('${emp.emp_code}')">ลบพนักงาน</button>`:""}
        <button class="btn btn-secondary" onclick="document.getElementById('empModal').remove()">ยกเลิก</button>
        <button class="btn btn-primary" onclick="window._saveEmp('${emp?.emp_code||""}')">บันทึก</button>
      </div>
    </div>
  </div>`;

  window._saveEmp = async (existCode) => {
    const g = id => document.getElementById(id)?.value?.trim()||"";
    const code = g("ef_code");
    if(!code){ toast("กรุณากรอกรหัสพนักงาน","error"); return; }
    if(!g("ef_fnTH")){ toast("กรุณากรอกชื่อภาษาไทย","error"); return; }
    const data = {
      emp_code:code, status:g("ef_status")||"Active",
      firstname_th:g("ef_fnTH"), lastname_th:g("ef_lnTH"),
      firstname_en:g("ef_fnEN"), lastname_en:g("ef_lnEN"),
      gender:g("ef_gender"), nationality:g("ef_nat"),
      dob:g("ef_dob")||null, phone:g("ef_phone"),
      division:g("ef_div"), department:g("ef_dept"),
      section:g("ef_sect"), team:g("ef_team"),
      position:g("ef_pos"), job_level:g("ef_jl"),
      site:g("ef_site"), contract_type:g("ef_ct"),
      join_date:g("ef_join")||null, effective_date:g("ef_eff")||null, end_date:g("ef_end")||null,
      salary:Number(document.getElementById("ef_sal")?.value)||null,
      remark:g("ef_remark"),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("employees").upsert(data, {onConflict:"emp_code"});
    if(error){ toast("บันทึกไม่สำเร็จ: "+error.message,"error"); return; }
    document.getElementById("empModal").remove();
    toast("บันทึกสำเร็จ","success");
  };
  window._deleteEmp = async (code) => {
    if(!confirm("ลบพนักงานคนนี้ออกจากระบบ?")) return;
    await supabase.from("employees").delete().eq("emp_code",code);
    document.getElementById("empModal").remove();
    toast("ลบเรียบร้อย","info");
  };
}

function downloadTemplate() {
  if(!window.XLSX){ toast("กรุณารอโหลด library","error"); return; }
  const h=["Employee Code*","First Name TH*","Last Name TH*","First Name EN","Last Name EN","Gender","Nationality","DOB (YYYY-MM-DD)","Phone","Division Code","Department Name","Section Name","Team Name","Position Name","Job Level","Site","Contract Type","Join Date*","Effective Date","End Date","Salary","Status","Remark"];
  const ex=["AKR001","สมชาย","ใจดี","Somchai","Jaidee","Male","Thai","1990-01-15","0812345678","L1-003","Mining","Mining Operation","Mining Operation","Mining Engineer","O2","Chatree","Permanent","2020-03-01","2020-03-01","","45000","Active",""];
  const ws=window.XLSX.utils.aoa_to_sheet([h,ex]); ws["!cols"]=h.map(()=>({wch:18}));
  const wb=window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb,ws,"Employees");
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.aoa_to_sheet([["Code","Division"],...DIVISIONS.map(d=>[d.code,d.name])]),"Division Ref");
  window.XLSX.writeFile(wb,"employee_template.xlsx");
  toast("ดาวน์โหลด Template เสร็จสิ้น","success");
}

async function handleImport(e) {
  const file=e.target.files[0]; if(!file||!window.XLSX) return; e.target.value="";
  const reader=new FileReader();
  reader.onload=async ev=>{
    try{
      const rows=window.XLSX.utils.sheet_to_json(window.XLSX.read(ev.target.result,{type:"binary",cellDates:true}).Sheets[window.XLSX.read(ev.target.result,{type:"binary"}).SheetNames[0]],{defval:""});
      const fd=v=>{ if(!v) return null; if(v instanceof Date) return v.toISOString().substring(0,10); const s=String(v).trim(); return s||null; };
      const batch = rows.map(row=>({
        emp_code:String(row["Employee Code*"]||row["Employee Code"]||"").trim(),
        firstname_th:String(row["First Name TH*"]||"").trim(), lastname_th:String(row["Last Name TH*"]||"").trim(),
        firstname_en:String(row["First Name EN"]||"").trim(), lastname_en:String(row["Last Name EN"]||"").trim(),
        gender:String(row["Gender"]||"").trim(), nationality:String(row["Nationality"]||"").trim(),
        dob:fd(row["DOB (YYYY-MM-DD)"]), phone:String(row["Phone"]||"").trim(),
        division:String(row["Division Code"]||"").trim(), department:String(row["Department Name"]||"").trim(),
        section:String(row["Section Name"]||"").trim(), team:String(row["Team Name"]||"").trim(),
        position:String(row["Position Name"]||"").trim(), job_level:String(row["Job Level"]||"").trim(),
        site:String(row["Site"]||"").trim(), contract_type:String(row["Contract Type"]||"").trim(),
        join_date:fd(row["Join Date*"]||row["Join Date"]), effective_date:fd(row["Effective Date"]), end_date:fd(row["End Date"]),
        salary:Number(row["Salary"])||null, status:String(row["Status"]||"Active").trim(),
        remark:String(row["Remark"]||"").trim(), updated_at:new Date().toISOString(),
      })).filter(r=>r.emp_code);

      const {error} = await supabase.from("employees").upsert(batch,{onConflict:"emp_code"});
      if(error) toast("Import ไม่สำเร็จ: "+error.message,"error");
      else toast(`Import เสร็จสิ้น: ${batch.length} รายการ`,"success");
    }catch(err){ toast("อ่านไฟล์ไม่ได้: "+err.message,"error"); }
  };
  reader.readAsBinaryString(file);
}

function handleExport() {
  if(!window.XLSX){ toast("กรุณารอโหลด library","error"); return; }
  const h=["Employee Code","First Name TH","Last Name TH","First Name EN","Last Name EN","Gender","Nationality","DOB","Phone","Division","Department","Section","Team","Position","Job Level","Site","Contract Type","Join Date","Effective Date","End Date","Salary","Status","Remark"];
  const rows=allEmployees.map(e=>[e.emp_code,e.firstname_th,e.lastname_th,e.firstname_en,e.lastname_en,e.gender,e.nationality,e.dob,e.phone,e.division,e.department,e.section,e.team,e.position,e.job_level,e.site,e.contract_type,e.join_date,e.effective_date,e.end_date,e.salary,e.status,e.remark]);
  const ws=window.XLSX.utils.aoa_to_sheet([h,...rows]); ws["!cols"]=h.map(()=>({wch:16}));
  const wb=window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb,ws,"Employees");
  window.XLSX.writeFile(wb,`employees_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast("Export เสร็จสิ้น","success");
}
