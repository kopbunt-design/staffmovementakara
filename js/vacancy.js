import { supabase } from "./supabase-config.js";
import { allEmployees, esc, toast, userRole } from "./app.js";

function getFY(ym){const[y,m]=ym.split("-").map(Number);return m>=7?y+1:y;}

let posQuota=[];
async function loadPosQuota(){
  try{const{data,error}=await supabase.from("position_quota").select("*").order("division").order("department").order("position");if(!error)posQuota=data||[];}
  catch(e){posQuota=[];}
}

function calcVacancy(activeEmps,fy){
  const filtered=fy?posQuota.filter(q=>q.fiscal_year===fy):posQuota;
  let totalQuota=0,totalFilled=0;
  const details=filtered.map(q=>{
    const filled=activeEmps.filter(e=>(e.division||"")===q.division&&(e.department||"")===q.department&&(e.position||"")===q.position&&(e.job_level||"")===q.job_level).length;
    const vac=Math.max(0,q.quota-filled);
    totalQuota+=q.quota;totalFilled+=Math.min(filled,q.quota);
    return{...q,filled,vacancy:vac};
  });
  return{totalQuota,totalFilled,totalVacancy:totalQuota-totalFilled,details};
}

const CSS=`<style>
.vac-wrap{font-family:inherit;}
.vac-kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px;}
@media(max-width:800px){.vac-kpi-grid{grid-template-columns:repeat(2,1fr);}}
.vac-kpi{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.04);}
.vac-kpi-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:6px;}
.vac-kpi-val{font-size:32px;font-weight:800;line-height:1.1;}
.vac-kpi-sub{font-size:10px;color:#94a3b8;margin-top:6px;}
.vac-section{background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.04);margin-bottom:24px;}
.vac-tbl{width:100%;border-collapse:collapse;font-size:12.5px;}
.vac-tbl th{padding:10px 14px;text-align:left;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#64748b;background:#f8fafc;border-bottom:2px solid #e2e8f0;}
.vac-tbl td{padding:9px 14px;border-bottom:1px solid #f1f5f9;}
.vac-tbl tbody tr:nth-child(even){background:#fafbfd;}
.vac-tbl tbody tr:hover{background:#f0f5ff;}
.vac-row-vacant td{background:#fff5f5!important;}
.vac-badge{display:inline-block;padding:2px 10px;border-radius:4px;font-size:10px;font-weight:700;}
.vac-add-form{display:grid;grid-template-columns:1fr 1fr 1fr auto auto;gap:10px;padding:16px;background:#f8fafc;border-top:1px solid #e2e8f0;align-items:end;}
@media(max-width:900px){.vac-add-form{grid-template-columns:1fr 1fr;}}
.vac-add-form select,.vac-add-form input{padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;width:100%;}
.vac-add-label{font-size:9px;font-weight:600;color:#64748b;text-transform:uppercase;margin-bottom:3px;}
</style>`;

export async function renderVacancy(){
  const pg=document.getElementById("pageVacancy");
  const canEdit=userRole==="hr"||userRole==="admin";

  await loadPosQuota();
  const active=allEmployees.filter(e=>e.status==="Active"||!e.status);
  const divs=[...new Set(allEmployees.map(e=>e.division).filter(Boolean).filter(d=>d!=="-"))].sort();
  const deptsByDiv={};
  divs.forEach(d=>{deptsByDiv[d]=[...new Set(allEmployees.filter(e=>e.division===d).map(e=>e.department).filter(Boolean).filter(x=>x!=="-"))].sort();});
  const posByDept={};
  allEmployees.forEach(e=>{
    if(!e.department||e.department==="-"||!e.position||e.position==="-")return;
    const k=`${e.division}||${e.department}`;
    if(!posByDept[k])posByDept[k]=new Set();
    posByDept[k].add(e.position);
  });

  const now=new Date();
  const curFY=getFY(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`);
  let selFY=curFY;
  let filterDiv="";
  const fyOpts=[];for(let i=-1;i<=2;i++)fyOpts.push(curFY+i);

  function render(){
    const vc=calcVacancy(active,selFY);
    const rows=vc.details.filter(d=>!filterDiv||d.division===filterDiv)
      .sort((a,b)=>b.vacancy-a.vacancy||(a.division+a.department+a.position+(a.job_level||"")).localeCompare(b.division+b.department+b.position+(b.job_level||"")));
    const vacRate=vc.totalQuota>0?((vc.totalVacancy/vc.totalQuota)*100).toFixed(1):"0.0";

    pg.innerHTML=`${CSS}<div class="vac-wrap">
    <div class="page-header" style="margin-bottom:20px;">
      <div>
        <div class="page-heading" style="font-size:22px;font-weight:800;">POSITION QUOTA</div>
        <div class="page-sub">อัตรากำลัง — FY${selFY} (Jul ${selFY-1} – Jun ${selFY})</div>
      </div>
      <div class="header-actions" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <select class="filter-select" style="min-width:200px;" onchange="window._vSelFY(Number(this.value))">
          ${fyOpts.map(f=>`<option value="${f}" ${f===selFY?"selected":""}>FY${f} (Jul ${f-1} – Jun ${f})</option>`).join("")}
        </select>
        <select class="filter-select" style="min-width:140px;" onchange="window._vFilterDiv(this.value)">
          <option value="">ทุก Division</option>
          ${divs.map(d=>`<option value="${d}" ${d===filterDiv?"selected":""}>${d}</option>`).join("")}
        </select>
        ${canEdit?`
        <button class="btn btn-secondary" onclick="window._vTemplate()" style="gap:6px;display:flex;align-items:center;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Template
        </button>
        <button class="btn btn-secondary" onclick="document.getElementById('vFile').click()" style="gap:6px;display:flex;align-items:center;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="M9 15l3 3 3-3"/></svg>
          Import Excel
        </button>
        <input type="file" id="vFile" accept=".xlsx,.xls" style="display:none;" onchange="window._vImport(this)">
        `:""}
      </div>
    </div>

    <!-- KPI -->
    <div class="vac-kpi-grid">
      <div class="vac-kpi">
        <div class="vac-kpi-label">TOTAL QUOTA</div>
        <div class="vac-kpi-val" style="color:#1a365d;">${vc.totalQuota}</div>
        <div class="vac-kpi-sub">ตำแหน่งที่อนุมัติ</div>
      </div>
      <div class="vac-kpi">
        <div class="vac-kpi-label">FILLED</div>
        <div class="vac-kpi-val" style="color:#16a34a;">${vc.totalFilled}</div>
        <div class="vac-kpi-sub">ตำแหน่งที่มีคนครอง</div>
      </div>
      <div class="vac-kpi">
        <div class="vac-kpi-label">VACANCY</div>
        <div class="vac-kpi-val" style="color:#dc2626;">${vc.totalVacancy}</div>
        <div class="vac-kpi-sub">ตำแหน่งว่าง</div>
      </div>
      <div class="vac-kpi">
        <div class="vac-kpi-label">VACANCY RATE</div>
        <div class="vac-kpi-val" style="color:#d97706;">${vacRate}%</div>
        <div class="vac-kpi-sub">อัตราตำแหน่งว่าง</div>
      </div>
    </div>

    <!-- Table -->
    <div class="vac-section">
      <div style="padding:14px 18px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;">
        <div style="font-size:13px;font-weight:700;color:#1a365d;text-transform:uppercase;letter-spacing:.3px;display:flex;align-items:center;gap:8px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1a365d" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a4 4 0 0 0-8 0v2"/></svg>
          Position Details${filterDiv?` — ${esc(filterDiv)}`:""}
        </div>
        <div style="font-size:11px;color:#94a3b8;">${rows.length} positions</div>
      </div>
      <div class="table-wrap">
        <table class="vac-tbl">
          <thead><tr>
            <th>Division</th><th>Department</th><th>Position</th><th>Job Level</th>
            <th style="text-align:center;">Quota</th><th style="text-align:center;">Filled</th>
            <th style="text-align:center;">Vacancy</th>${canEdit?`<th style="width:70px;"></th>`:""}
          </tr></thead>
          <tbody>
            ${rows.length===0?`<tr><td colspan="${canEdit?8:7}" style="text-align:center;padding:40px;color:#94a3b8;">
              ยังไม่มี Position Quota สำหรับ FY${selFY}<br>
              <span style="font-size:11px;margin-top:6px;display:inline-block;">กด Import Excel หรือ เพิ่มทีละตำแหน่งด้านล่าง</span>
            </td></tr>`:
            rows.map(r=>`<tr class="${r.vacancy>0?'vac-row-vacant':''}">
              <td style="font-weight:500;font-size:11px;">${esc(r.division)}</td>
              <td style="font-size:11px;">${esc(r.department)}</td>
              <td style="font-weight:600;">${esc(r.position)}</td>
              <td style="text-align:center;"><span style="display:inline-block;padding:2px 10px;border-radius:4px;font-size:10px;font-weight:700;background:#f1f5f9;color:#475569;">${esc(r.job_level||"-")}</span></td>
              <td style="text-align:center;font-weight:700;">${r.quota}</td>
              <td style="text-align:center;color:#16a34a;font-weight:600;">${r.filled}</td>
              <td style="text-align:center;"><span class="vac-badge" style="color:${r.vacancy>0?'#dc2626':'#16a34a'};background:${r.vacancy>0?'#fee2e2':'#dcfce7'};">${r.vacancy>0?r.vacancy:"Full"}</span></td>
              ${canEdit?`<td style="text-align:center;white-space:nowrap;">
                <button class="btn btn-secondary" style="padding:4px 8px;font-size:10px;" onclick="window._vEdit('${r.id}')">&#9998;</button>
                <button class="btn" style="padding:4px 6px;font-size:10px;color:#dc2626;background:none;border:none;cursor:pointer;" onclick="window._vDel('${r.id}')">&#10005;</button>
              </td>`:""}
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
      ${canEdit?`
      <div class="vac-add-form">
        <div>
          <div class="vac-add-label">Division</div>
          <select id="v_div" onchange="window._vDivChange(this.value)">
            <option value="">เลือก Division</option>
            ${divs.map(d=>`<option value="${d}">${d}</option>`).join("")}
          </select>
        </div>
        <div>
          <div class="vac-add-label">Department</div>
          <select id="v_dept"><option value="">เลือก Department</option></select>
        </div>
        <div>
          <div class="vac-add-label">Position</div>
          <select id="v_pos"><option value="">เลือก Position</option></select>
        </div>
        <div>
          <div class="vac-add-label">Job Level</div>
          <select id="v_jl">
            <option value="">Level</option>
            ${["M1","M2","M3","M4","S1","S2","S3","O1","O2","O3"].map(l=>`<option value="${l}">${l}</option>`).join("")}
          </select>
        </div>
        <div>
          <div class="vac-add-label">Quota</div>
          <div style="display:flex;gap:6px;">
            <input id="v_qty" type="number" min="1" value="1" style="width:60px;">
            <button class="btn btn-primary" style="padding:7px 16px;font-size:12px;white-space:nowrap;" onclick="window._vAdd()">+ เพิ่ม</button>
          </div>
        </div>
      </div>`:""}
    </div>
    </div>`;

    if(canEdit){
      window._vDivChange=v=>{
        const deptSel=document.getElementById("v_dept");
        const depts=deptsByDiv[v]||[];
        deptSel.innerHTML=`<option value="">เลือก Department</option>`+depts.map(d=>`<option value="${d}">${d}</option>`).join("");
        document.getElementById("v_pos").innerHTML=`<option value="">เลือก Position</option>`;
        deptSel.onchange=()=>{
          const dept=deptSel.value;
          const k=`${v}||${dept}`;
          const positions=[...(posByDept[k]||[])].sort();
          document.getElementById("v_pos").innerHTML=`<option value="">เลือก Position</option>`+positions.map(p=>`<option value="${p}">${p}</option>`).join("");
        };
      };
    }
  }

  render();

  window._vSelFY=v=>{selFY=v;render();};
  window._vFilterDiv=v=>{filterDiv=v;render();};

  if(!canEdit) return;

  window._vAdd=async()=>{
    const div=document.getElementById("v_div").value;
    const dept=document.getElementById("v_dept").value;
    const pos=document.getElementById("v_pos").value;
    const jl=document.getElementById("v_jl").value;
    const qty=parseInt(document.getElementById("v_qty").value)||1;
    if(!div||!dept||!pos||!jl){toast("กรุณาเลือก Division, Department, Position, Job Level","error");return;}
    const exists=posQuota.find(q=>q.fiscal_year===selFY&&q.division===div&&q.department===dept&&q.position===pos&&q.job_level===jl);
    if(exists){toast("ตำแหน่งนี้มีอยู่แล้วใน FY"+selFY+" กดแก้ไขแทน","error");return;}
    const{error}=await supabase.from("position_quota").insert({fiscal_year:selFY,division:div,department:dept,position:pos,job_level:jl,quota:qty});
    if(error){toast("เพิ่มไม่สำเร็จ: "+error.message,"error");return;}
    await loadPosQuota();toast("เพิ่มสำเร็จ","success");render();
  };
  window._vEdit=async(id)=>{
    const q=posQuota.find(x=>String(x.id)===String(id));if(!q)return;
    const newQty=prompt(`Quota สำหรับ ${q.position} (${q.department}):`,q.quota);
    if(newQty===null)return;
    const val=parseInt(newQty);if(isNaN(val)||val<0){toast("กรุณาใส่ตัวเลข","error");return;}
    const{error}=await supabase.from("position_quota").update({quota:val,updated_at:new Date().toISOString()}).eq("id",q.id);
    if(error){toast("แก้ไม่สำเร็จ: "+error.message,"error");return;}
    await loadPosQuota();toast("แก้ไขสำเร็จ","success");render();
  };
  window._vDel=async(id)=>{
    if(!confirm("ลบ Position Quota นี้?"))return;
    const q=posQuota.find(x=>String(x.id)===String(id));if(!q)return;
    const{error}=await supabase.from("position_quota").delete().eq("id",q.id);
    if(error){toast("ลบไม่สำเร็จ: "+error.message,"error");return;}
    await loadPosQuota();toast("ลบสำเร็จ","info");render();
  };
  window._vTemplate=()=>{
    if(!window.XLSX){toast("กรุณารอโหลด library","error");return;}
    const h=["Division","Department","Position","Job Level","Quota"];
    const ex=["Operations","Mining","Mining Engineer","S2","5"];
    const ws=window.XLSX.utils.aoa_to_sheet([h,ex]);ws["!cols"]=h.map(()=>({wch:24}));
    const wb=window.XLSX.utils.book_new();window.XLSX.utils.book_append_sheet(wb,ws,`FY${selFY}`);
    window.XLSX.writeFile(wb,`position_quota_template_FY${selFY}.xlsx`);
    toast("ดาวน์โหลด Template เสร็จสิ้น","success");
  };
  window._vImport=async(inputEl)=>{
    const file=inputEl.files?.[0];if(!file||!window.XLSX)return;inputEl.value="";
    const reader=new FileReader();
    reader.onload=async ev=>{
      try{
        const wb=window.XLSX.read(ev.target.result,{type:"binary"});
        const rows=window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:""});
        if(!rows.length){toast("ไฟล์ว่าง","error");return;}
        const batch=rows.map(r=>{
          const div=String(r.Division||"").trim();
          const dept=String(r.Department||"").trim();
          const pos=String(r.Position||"").trim();
          const jl=String(r["Job Level"]||"").trim();
          const qty=parseInt(r.Quota)||0;
          if(!div||!dept||!pos||!jl||qty<=0)return null;
          return{fiscal_year:selFY,division:div,department:dept,position:pos,job_level:jl,quota:qty,updated_at:new Date().toISOString()};
        }).filter(Boolean);
        if(!batch.length){toast("ไม่พบข้อมูลที่ถูกต้อง","error");return;}
        let created=0,updated=0;
        for(const b of batch){
          const existing=posQuota.find(q=>q.fiscal_year===selFY&&q.division===b.division&&q.department===b.department&&q.position===b.position&&q.job_level===b.job_level);
          if(existing){
            await supabase.from("position_quota").update({quota:b.quota,updated_at:b.updated_at}).eq("id",existing.id);
            updated++;
          }else{
            await supabase.from("position_quota").insert(b);
            created++;
          }
        }
        await loadPosQuota();
        toast(`Import FY${selFY}: เพิ่ม ${created}, อัปเดต ${updated} ตำแหน่ง`,"success");
        render();
      }catch(err){toast("อ่านไฟล์ไม่ได้: "+err.message,"error");}
    };
    reader.readAsBinaryString(file);
  };
}
