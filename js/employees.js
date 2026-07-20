import { supabase } from "./supabase-config.js";
import { allEmployees, userRole, esc, fmtDate, avatarColor, initials, toast, notify } from "./app.js";
import { masterDivisions, masterDepartments, masterSections, masterTeams, masterPositions, masterJobLevels, getDeptsByDiv, getSectsByDept, getTeamsBySect } from "./masterdata-admin.js";
import { SITES, CONTRACT_TYPES, NATIONALITIES, GENDERS, EMP_STATUSES, PROVINCES } from "./masterdata.js";

let empSearch="", empDept="", empStatus="Active";

const selOpts = (opts, val="", ph="-- เลือก --", useId=false) =>
  `<option value="">${ph}</option>` + opts.map(o => {
    const v = useId ? o.id : (typeof o==="string"?o:o.name);
    const l = typeof o==="string"?o:(o.name+(o.name_th?` (${o.name_th})`:""));
    return `<option value="${v}" ${String(v)===String(val)?"selected":""}>${l}</option>`;
  }).join("");
const selStr = (arr, val="", ph="-- เลือก --") =>
  `<option value="">${ph}</option>` + arr.map(s=>`<option value="${s}" ${s===val?"selected":""}>${s}</option>`).join("");

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
      ${masterDepartments.map(d=>`<option value="${d.name}" ${d.name===empDept?"selected":""}>${d.name}</option>`).join("")}
    </select>
    <select class="filter-select" onchange="window._empStatus(this.value)">
      <option value="">ทุกสถานะ</option>
      ${EMP_STATUSES.map(s=>`<option value="${s}" ${s===empStatus?"selected":""}>${s}</option>`).join("")}
    </select>
  </div>
  <div class="section mt-4 pb-4"><div class="card"><div class="table-wrap">
    <table class="data-table">
      <thead><tr><th>รหัส</th><th>ชื่อ-นามสกุล</th><th>Division</th><th>Department</th><th>Position</th><th>Job Level</th><th>ประเภทสัญญา</th><th>วันเริ่มงาน</th><th>สถานะ</th>${canWrite?"<th></th>":""}</tr></thead>
      <tbody>${filtered.length===0?`<tr><td colspan="${canWrite?10:9}" class="text-center text-muted" style="padding:48px;">ไม่พบพนักงาน${empSearch||empDept||empStatus?" ที่ตรงกับเงื่อนไข":""}</td></tr>`:
      filtered.map(e=>{
        const sc={Active:"var(--green)",Resigned:"var(--red)",Terminated:"var(--red)",Retired:"var(--muted)",Transferred:"var(--blue)"}[e.status||"Active"]||"var(--green)";
        const sbg={Active:"var(--green-light)",Resigned:"var(--red-light)",Terminated:"var(--red-light)",Retired:"#f1f5f9",Transferred:"var(--blue-light)"}[e.status||"Active"]||"var(--green-light)";
        const av=avatarColor(e.firstname_th||e.emp_code||"");
        const divName = masterDivisions.find(d=>d.name===e.division)?.name || e.division || "-";
        return `<tr>
          <td><b style="color:var(--blue);font-size:12px;">${esc(e.emp_code||"-")}</b></td>
          <td><div style="display:flex;align-items:center;gap:8px;">
            <div style="width:28px;height:28px;border-radius:8px;background:${av}18;color:${av};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">${initials((e.firstname_th||"")+" "+(e.lastname_th||""))}</div>
            <div><div style="font-weight:600;">${esc((e.firstname_th||"")+" "+(e.lastname_th||""))}</div>
            <div class="text-sm text-muted">${esc((e.firstname_en||"")+" "+(e.lastname_en||""))}</div></div>
          </div></td>
          <td class="text-muted">${esc(divName)}</td>
          <td class="text-muted">${esc(e.department||"-")}</td>
          <td class="text-muted">${esc(e.position||"-")}</td>
          <td><span class="badge badge-gray">${esc(e.job_level||"-")}</span></td>
          <td class="text-muted">${esc(e.contract_type||"-")}</td>
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
  const curDiv = masterDivisions.find(d=>d.name===emp?.division);
  const curDept = masterDepartments.find(d=>d.name===emp?.department);
  const curSect = masterSections.find(s=>s.name===emp?.section);
  const depts = curDiv ? getDeptsByDiv(curDiv.id) : masterDepartments;
  const sects = curDept ? getSectsByDept(curDept.id) : masterSections;
  const teams = curSect ? getTeamsBySect(curSect.id) : masterTeams;

  document.getElementById("modalPortal").innerHTML = `<div class="modal-overlay" id="empModal">
    <div class="modal modal-lg">
      <div class="modal-header">
        <div class="modal-title">${isEdit?"แก้ไขข้อมูลพนักงาน":"เพิ่มพนักงานใหม่"}</div>
        <button class="modal-close" onclick="document.getElementById('empModal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group"><label class="form-label">รหัสพนักงาน *</label><input id="ef_code" class="form-control" value="${v("emp_code")}" ${isEdit?"readonly":""}></div>
          <div class="form-group"><label class="form-label">สถานะ</label><select id="ef_status" class="form-control">${selStr(EMP_STATUSES,emp?.status||"Active")}</select></div>
          <div class="form-group"><label class="form-label">ชื่อ (ภาษาไทย) *</label><input id="ef_fnTH" class="form-control" value="${v("firstname_th")}"></div>
          <div class="form-group"><label class="form-label">นามสกุล (ภาษาไทย) *</label><input id="ef_lnTH" class="form-control" value="${v("lastname_th")}"></div>
          <div class="form-group"><label class="form-label">First Name</label><input id="ef_fnEN" class="form-control" value="${v("firstname_en")}"></div>
          <div class="form-group"><label class="form-label">Last Name</label><input id="ef_lnEN" class="form-control" value="${v("lastname_en")}"></div>
          <div class="form-group"><label class="form-label">เพศ</label><select id="ef_gender" class="form-control">${selStr(GENDERS,emp?.gender||"")}</select></div>
          <div class="form-group"><label class="form-label">สัญชาติ</label><select id="ef_nat" class="form-control">${selStr(NATIONALITIES,emp?.nationality||"")}</select></div>
          <div class="form-group"><label class="form-label">วันเกิด</label><input id="ef_dob" type="date" class="form-control" value="${v("dob")}"></div>
          <div class="form-group"><label class="form-label">เบอร์โทรศัพท์</label><input id="ef_phone" class="form-control" value="${v("phone")}"></div>

          <div class="form-group"><label class="form-label">Division</label>
            <select id="ef_div" class="form-control" onchange="window._onDivChange(this)">
              ${selOpts(masterDivisions, emp?.division||"")}
            </select>
          </div>
          <div class="form-group"><label class="form-label">Department</label>
            <select id="ef_dept" class="form-control" onchange="window._onDeptChange(this)">
              ${selOpts(depts, emp?.department||"")}
            </select>
          </div>
          <div class="form-group"><label class="form-label">Section</label>
            <select id="ef_sect" class="form-control" onchange="window._onSectChange(this)">
              ${selOpts(sects, emp?.section||"")}
            </select>
          </div>
          <div class="form-group"><label class="form-label">Team</label>
            <select id="ef_team" class="form-control">
              ${selOpts(teams, emp?.team||"")}
            </select>
          </div>

          <div class="form-group col-span-2"><label class="form-label">Position</label>
            <select id="ef_pos" class="form-control">${selOpts(masterPositions, emp?.position||"")}</select>
          </div>
          <div class="form-group"><label class="form-label">Job Level</label>
            <select id="ef_jl" class="form-control">${selOpts(masterJobLevels, emp?.job_level||"")}</select>
          </div>
          <div class="form-group"><label class="form-label">Site</label>
            <select id="ef_site" class="form-control">${selStr(SITES,emp?.site||"")}</select>
          </div>
          <div class="form-group"><label class="form-label">Province</label>
            <select id="ef_prov" class="form-control">${selStr(PROVINCES,emp?.province||"")}</select>
          </div>
          <div class="form-group"><label class="form-label">ประเภทสัญญา</label>
            <select id="ef_ct" class="form-control">${selStr(CONTRACT_TYPES,emp?.contract_type||"")}</select>
          </div>
          <div class="form-group"><label class="form-label">วันเริ่มงาน *</label><input id="ef_join" type="date" class="form-control" value="${v("join_date")}"></div>
          <div class="form-group"><label class="form-label">Effective Date</label><input id="ef_eff" type="date" class="form-control" value="${v("effective_date")}"></div>
          <div class="form-group"><label class="form-label">วันสิ้นสุดสัญญา</label><input id="ef_end" type="date" class="form-control" value="${v("end_date")}"></div>
          ${userRole==="hr"||userRole==="admin"?`<div class="form-group"><label class="form-label">เงินเดือน (บาท)</label><input id="ef_sal" type="number" class="form-control" value="${emp?.salary||""}"></div>`:`<div></div>`}
          <div class="form-group col-span-2"><label class="form-label">Remark</label><textarea id="ef_remark" class="form-control">${v("remark")}</textarea></div>
          ${userRole==="hr"||userRole==="admin"?`<div class="form-group col-span-2"><label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600;"><input id="ef_shiftallow" type="checkbox" ${emp?.shift_allowance_override?"checked":""} style="width:auto;margin:0;"> ได้รับค่ากะ (กำหนดเอง)</label><div style="font-size:11px;color:var(--muted);margin-top:2px;">ติ๊กเมื่อพนักงานระดับไม่ใช่ O แต่ HR ให้ได้ค่ากะ (เช่น ปรับ O→S แล้วยังได้ต่อ) — ปกติระดับ O ได้อยู่แล้วไม่ต้องติ๊ก</div></div>`:""}
        </div>
      </div>
      <div class="modal-footer">
        ${isEdit?`<button class="btn btn-danger" onclick="window._deleteEmp('${emp.emp_code}')">ลบพนักงาน</button>`:""}
        <button class="btn btn-secondary" onclick="document.getElementById('empModal').remove()">ยกเลิก</button>
        <button class="btn btn-primary" onclick="window._saveEmp('${emp?.emp_code||""}')">บันทึก</button>
      </div>
    </div>
  </div>`;

  // Cascade handlers
  window._onDivChange = sel => {
    const divName = sel.value;
    const div = masterDivisions.find(d=>d.name===divName);
    const depts = div ? getDeptsByDiv(div.id) : masterDepartments;
    document.getElementById("ef_dept").innerHTML = selOpts(depts,"","-- เลือก Department --");
    document.getElementById("ef_sect").innerHTML = `<option value="">-- เลือก Department ก่อน --</option>`;
    document.getElementById("ef_team").innerHTML = `<option value="">-- เลือก Section ก่อน --</option>`;
  };
  window._onDeptChange = sel => {
    const deptName = sel.value;
    const dept = masterDepartments.find(d=>d.name===deptName);
    const sects = dept ? getSectsByDept(dept.id) : masterSections;
    document.getElementById("ef_sect").innerHTML = selOpts(sects,"","-- เลือก Section --");
    document.getElementById("ef_team").innerHTML = `<option value="">-- เลือก Section ก่อน --</option>`;
  };
  window._onSectChange = sel => {
    const sectName = sel.value;
    const sect = masterSections.find(s=>s.name===sectName);
    const teams = sect ? getTeamsBySect(sect.id) : masterTeams;
    document.getElementById("ef_team").innerHTML = selOpts(teams,"","-- เลือก Team --");
  };

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
      site:g("ef_site"), province:g("ef_prov"), contract_type:g("ef_ct"),
      join_date:g("ef_join")||null, effective_date:g("ef_eff")||null, end_date:g("ef_end")||null,
      salary:Number(document.getElementById("ef_sal")?.value)||null,
      remark:g("ef_remark"), updated_at:new Date().toISOString(),
      // ใส่เฉพาะตอนที่ checkbox แสดง (HR/Admin) — กันไม่ให้ non-HR ที่ไม่เห็นช่องนี้เขียนทับเป็น null
      ...(document.getElementById("ef_shiftallow") ? { shift_allowance_override: document.getElementById("ef_shiftallow").checked } : {}),
    };
    const { error } = await supabase.from("employees").upsert(data,{onConflict:"emp_code"});
    if(error){ toast("บันทึกไม่สำเร็จ: "+error.message,"error"); return; }
    document.getElementById("empModal").remove();
    if(existCode) toast("บันทึกสำเร็จ","success");
    else notify("เพิ่มพนักงานใหม่", `${code} · ${(g("ef_fnTH")+" "+g("ef_lnTH")).trim()}`, {category:"employee"});
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
  const h=["Employee Code*","First Name TH*","Last Name TH*","First Name EN","Last Name EN","Gender","Nationality","DOB (YYYY-MM-DD)","Phone","Division","Department","Section","Team","Position","Job Level","Site","Province","Contract Type","Join Date*","Effective Date","End Date","Salary","Status","Remark"];
  const ex=["AKR001","สมชาย","ใจดี","Somchai","Jaidee","Male","Thai","1990-01-15","0812345678","Operations","Mining","Geology","Geology","Mining Engineer","O2","Chatree","Phichit","Permanent","2020-03-01","2020-03-01","","45000","Active",""];
  const ws=window.XLSX.utils.aoa_to_sheet([h,ex]); ws["!cols"]=h.map(()=>({wch:18}));
  const divSheet=window.XLSX.utils.aoa_to_sheet([["Division","Departments"],
    ...masterDivisions.map(d=>[d.name, getDeptsByDiv(d.id).map(x=>x.name).join(", ")])
  ]);
  const wb=window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb,ws,"Employees");
  window.XLSX.utils.book_append_sheet(wb,divSheet,"Structure");
  window.XLSX.writeFile(wb,"employee_template.xlsx");
  toast("ดาวน์โหลด Template เสร็จสิ้น","success");
}

async function handleImport(inputEl) {
  const file=inputEl.files?.[0]; if(!file||!window.XLSX) return; inputEl.value="";
  const reader=new FileReader();
  reader.onload=async ev=>{
    try{
      const wb=window.XLSX.read(ev.target.result,{type:"binary"});
      const rows=window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:""});
      const fd=v=>{
        if(!v) return null;
        if(typeof v==="number"){ if(v>10000){ const d=new Date(Math.round((v-25569)*86400000)); return d.toISOString().substring(0,10); } return null; }
        if(v instanceof Date){ const d=new Date(Date.UTC(v.getFullYear(),v.getMonth(),v.getDate())); return d.toISOString().substring(0,10); }
        const s=String(v).trim(); return /^\d{4}-\d{2}-\d{2}/.test(s)?s.substring(0,10):null;
      };
      const fieldMap=[
        {col:["First Name TH*","First Name TH"],key:"firstname_th",type:"s"},
        {col:["Last Name TH*","Last Name TH"],key:"lastname_th",type:"s"},
        {col:["First Name EN"],key:"firstname_en",type:"s"},
        {col:["Last Name EN"],key:"lastname_en",type:"s"},
        {col:["Gender"],key:"gender",type:"s"},
        {col:["Nationality"],key:"nationality",type:"s"},
        {col:["DOB (YYYY-MM-DD)","DOB"],key:"dob",type:"d"},
        {col:["Phone"],key:"phone",type:"s"},
        {col:["Division"],key:"division",type:"s"},
        {col:["Department"],key:"department",type:"s"},
        {col:["Section"],key:"section",type:"s"},
        {col:["Team"],key:"team",type:"s"},
        {col:["Position"],key:"position",type:"s"},
        {col:["Job Level"],key:"job_level",type:"s"},
        {col:["Site"],key:"site",type:"s"},
        {col:["Province"],key:"province",type:"s"},
        {col:["Contract Type"],key:"contract_type",type:"s"},
        {col:["Join Date*","Join Date"],key:"join_date",type:"d"},
        {col:["Effective Date"],key:"effective_date",type:"d"},
        {col:["End Date"],key:"end_date",type:"d"},
        {col:["Salary"],key:"salary",type:"n"},
        {col:["Status"],key:"_rawStatus",type:"s"},
        {col:["Remark"],key:"remark",type:"s"},
      ];
      const xlsCols=Object.keys(rows[0]||{});
      const batch=rows.map(row=>{
        const code=String(row["Employee Code*"]||row["Employee Code"]||"").trim();
        if(!code) return null;
        const obj={emp_code:code,updated_at:new Date().toISOString()};
        for(const f of fieldMap){
          const found=f.col.find(c=>xlsCols.includes(c));
          if(!found) continue;
          const raw=row[found];
          if(f.type==="d"){ const dv=fd(raw); if(dv) obj[f.key]=dv; }
          else if(f.type==="n"){ const nv=Number(raw); if(nv) obj[f.key]=nv; }
          else { const sv=String(raw||"").trim(); if(sv) obj[f.key]=sv; }
        }
        return obj;
      }).filter(Boolean);
      // ดึงข้อมูลเดิมจาก DB เพื่อ merge กับข้อมูลใหม่ (ไม่ทับ column ที่ไม่ได้ส่งมา)
      const codes=batch.map(r=>r.emp_code);
      const {data:existingEmps}=await supabase.from("employees").select("*").in("emp_code",codes);
      const existMap=Object.fromEntries((existingEmps||[]).map(e=>[e.emp_code,e]));
      batch.forEach(r=>{
        const ex=existMap[r.emp_code];
        if(ex){
          for(const[k,v] of Object.entries(ex)){
            if(k==="created_at"||k==="updated_at") continue;
            if(!(k in r)) r[k]=v;
          }
        }
        r.status=r._rawStatus||ex?.status||"Active";
        delete r._rawStatus;
      });
      const {error}=await supabase.from("employees").upsert(batch,{onConflict:"emp_code"});
      if(error){ toast("Import ไม่สำเร็จ: "+error.message,"error"); return; }

      // สร้าง/อัปเดต Movement อัตโนมัติสำหรับคนที่ลาออก/สิ้นสุดสัญญา (ข้อมูลย้อนหลัง)
      const resignedRows = batch.filter(r=>["Resigned","Terminated","Retired"].includes(r.status));
      let movCreated=0, movUpdated=0;
      if(resignedRows.length > 0){
        const codes = resignedRows.map(r=>r.emp_code);
        const { data: existing } = await supabase.from("movements")
          .select("id,emp_code,type,date").in("emp_code", codes);
        const typeMap = { Resigned:"Resignation", Terminated:"Termination", Retired:"Retirement" };
        const { data: session } = await supabase.auth.getUser();
        const newMovs = []; const updateMovs = [];
        for(const r of resignedRows){
          const t = typeMap[r.status];
          const ex = (existing||[]).find(m=>m.emp_code===r.emp_code && m.type===t);
          const movDate = r.effective_date || r.end_date || null;
          if(ex){
            if(movDate && ex.date !== movDate) updateMovs.push({id:ex.id, date:movDate});
          } else {
            newMovs.push({
              emp_code:r.emp_code, name:(r.firstname_th+" "+r.lastname_th).trim(), type:t,
              date:movDate, from_dept:r.department||"", to_dept:"",
              reason:"บันทึกย้อนหลังจากการ Import",
              recorded_by:session?.user?.user_metadata?.full_name||session?.user?.email?.split("@")[0]||"Import",
              created_by:session?.user?.id,
            });
          }
        }
        if(newMovs.length>0){
          const {error:movErr}=await supabase.from("movements").insert(newMovs);
          if(!movErr) movCreated=newMovs.length;
        }
        for(const u of updateMovs){
          const {error:ue}=await supabase.from("movements").update({date:u.date}).eq("id",u.id);
          if(!ue) movUpdated++;
        }
      }

      const extra=[]; if(movCreated) extra.push(`สร้าง Movement ${movCreated} รายการ`); if(movUpdated) extra.push(`อัปเดตวันที่ ${movUpdated} รายการ`);
      notify("นำเข้าพนักงาน", `${batch.length} รายการ${extra.length?` · ${extra.join(", ")}`:""}`, {category:"employee", toastMsg:`Import เสร็จสิ้น: ${batch.length} รายการ${extra.length?` · ${extra.join(", ")}`:""}`});
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
