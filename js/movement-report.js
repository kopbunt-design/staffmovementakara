import { supabase } from "./supabase-config.js";
import { allEmployees, allMovements, movYM, esc, fmtDate, toast } from "./app.js";

const MONTHS_TH=["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const MONTHS_EN=["January","February","March","April","May","June","July","August","September","October","November","December"];

function prevYM(ym){ const [y,m]=ym.split("-").map(Number); return m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,"0")}`; }
function nextYM(ym){ const [y,m]=ym.split("-").map(Number); return m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,"0")}`; }

function hcAtMonth(ym){
  return allEmployees.filter(e=>{
    const jm=(e.join_date||"").substring(0,7),em=(e.end_date||"").substring(0,7);
    if(jm&&jm>ym) return false; if(em&&em<=ym) return false; return true;
  });
}

function buildReport(ym){
  const nxYM=nextYM(ym);
  const pYM=prevYM(ym);

  const openingHC=hcAtMonth(pYM);
  const endingHC=hcAtMonth(ym);

  const movMonth=allMovements.filter(m=>movYM(m)===ym);

  // New Joiners
  const movNewCodes=new Set(movMonth.filter(m=>m.type==="New Hire").map(m=>m.emp_code));
  const empNewOnly=allEmployees.filter(e=>(e.join_date||"").substring(0,7)===ym&&!movNewCodes.has(e.emp_code));
  const newJoiners=[
    ...movMonth.filter(m=>m.type==="New Hire").map(m=>{const e=allEmployees.find(x=>x.emp_code===m.emp_code);return{emp_code:m.emp_code,name:m.name||(e?`${e.firstname_th} ${e.lastname_th}`.trim():""),position:e?.position||"",department:e?.department||"",date:m.date};}),
    ...empNewOnly.map(e=>({emp_code:e.emp_code,name:`${e.firstname_th||""} ${e.lastname_th||""}`.trim(),position:e.position||"",department:e.department||"",date:e.join_date}))
  ];

  // Separations (นับเดือนก่อน effective date)
  const movSepCodes=new Set(allMovements.filter(m=>movYM(m)===nxYM&&["Resignation","Retirement","Termination"].includes(m.type)).map(m=>m.emp_code));
  const empSepOnly=allEmployees.filter(e=>(e.end_date||"").substring(0,7)===nxYM&&["Resigned","Retired","Terminated"].includes(e.status)&&!movSepCodes.has(e.emp_code));
  const typeMap={Resigned:"Resignation",Retired:"Retirement",Terminated:"Termination"};
  const separations=[
    ...allMovements.filter(m=>movYM(m)===nxYM&&["Resignation","Retirement","Termination"].includes(m.type)).map(m=>{const e=allEmployees.find(x=>x.emp_code===m.emp_code);return{emp_code:m.emp_code,name:m.name||(e?`${e.firstname_th} ${e.lastname_th}`.trim():""),position:e?.position||"",department:e?.department||"",date:m.date,reason:m.type};}),
    ...empSepOnly.map(e=>({emp_code:e.emp_code,name:`${e.firstname_th||""} ${e.lastname_th||""}`.trim(),position:e.position||"",department:e.department||"",date:e.end_date,reason:typeMap[e.status]||e.status}))
  ];

  // Internal Movement (Transfer, Promotion, Demotion, Secondment)
  const internalTypes=["Transfer","Promotion","Demotion","Secondment"];
  const internals=movMonth.filter(m=>internalTypes.includes(m.type)).map(m=>{
    const e=allEmployees.find(x=>x.emp_code===m.emp_code);
    return{emp_code:m.emp_code,name:m.name||(e?`${e.firstname_th} ${e.lastname_th}`.trim():""),type:m.type,from:m.from_dept||"",to:m.to_dept||"",date:m.date,remark:m.reason||""};
  });

  // Headcount by Department
  const deptMap={};
  openingHC.forEach(e=>{const d=e.department||"Other";deptMap[d]=deptMap[d]||{open:0,join:0,sep:0};deptMap[d].open++;});
  newJoiners.forEach(j=>{const d=j.department||"Other";deptMap[d]=deptMap[d]||{open:0,join:0,sep:0};deptMap[d].join++;});
  separations.forEach(s=>{const d=s.department||"Other";deptMap[d]=deptMap[d]||{open:0,join:0,sep:0};deptMap[d].sep++;});
  const depts=Object.entries(deptMap).map(([name,v])=>({name,open:v.open,join:v.join,sep:v.sep,net:v.join-v.sep,end:v.open+v.join-v.sep})).sort((a,b)=>b.open-a.open);

  const retirements=separations.filter(s=>s.reason==="Retirement");
  const promotions=internals.filter(i=>i.type==="Promotion");
  const transfers=internals.filter(i=>["Transfer","Secondment","Demotion"].includes(i.type));

  return{openingHC:openingHC.length,endingHC:endingHC.length,newJoiners,separations,internals,retirements,promotions,transfers,depts};
}

const CSS=`<style>
.mr-wrap{font-family:inherit;}
.mr-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;gap:16px;flex-wrap:wrap;}
.mr-title{font-size:22px;font-weight:800;color:#1a365d;letter-spacing:-.3px;}
.mr-sub{font-size:12px;color:#64748b;font-weight:500;margin-top:2px;}
.mr-month-box{background:#1a365d;color:#fff;font-size:16px;font-weight:700;padding:10px 20px;border-radius:10px;text-align:center;min-width:120px;}
.mr-kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px;}
@media(max-width:900px){.mr-kpi{grid-template-columns:repeat(2,1fr);}}
.mr-kpi-card{display:flex;align-items:center;gap:12px;padding:16px 18px;background:#fff;border-radius:12px;border:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(0,0,0,.04);}
.mr-kpi-icon{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.mr-kpi-label{font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:#64748b;margin-bottom:1px;}
.mr-kpi-val{font-size:24px;font-weight:800;line-height:1.1;}
.mr-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;}
@media(max-width:1000px){.mr-grid{grid-template-columns:1fr;}}
.mr-section{background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04);}
.mr-sec-title{padding:12px 16px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;gap:8px;}
.mr-sec-title .cnt{font-weight:400;opacity:.7;}
.mr-tbl{width:100%;border-collapse:collapse;font-size:12px;}
.mr-tbl th{padding:8px 12px;text-align:left;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.3px;color:#64748b;background:#f8fafc;border-bottom:2px solid #e2e8f0;}
.mr-tbl td{padding:7px 12px;border-bottom:1px solid #f1f5f9;color:#334155;}
.mr-tbl tbody tr:hover{background:#f8fafc;}
.mr-tbl .num{text-align:center;color:#94a3b8;width:30px;}
.mr-tbl .code{color:#2563eb;font-weight:500;font-size:11px;}
.mr-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;}
.mr-footer{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-top:20px;padding:20px;background:#fff;border-radius:12px;border:1px solid #e2e8f0;font-size:11px;color:#64748b;}
.mr-footer-title{font-weight:700;color:#1e293b;margin-bottom:4px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;}
.mr-footer-line{border-top:1px solid #1a365d;margin-top:20px;padding-top:4px;}
.mr-empty{text-align:center;padding:24px 16px;color:#94a3b8;font-size:12px;}
</style>`;

const ICON={
  open:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  join:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>`,
  sep:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/></svg>`,
  transfer:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4"/></svg>`,
  promo:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20V4m0 0l-4 4m4-4l4 4"/></svg>`,
  retire:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
  end:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
};

const reasonColor={Resignation:["#C0392B","#FDECEA"],Retirement:["#D97706","#FEF3C7"],Termination:["#7C3AED","#EDE9FE"]};

export function renderMovementReport(){
  const pg=document.getElementById("pageMovreport");
  const now=new Date();
  let selYM=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;

  function render(){
    const [sy,sm]=selYM.split("-").map(Number);
    const r=buildReport(selYM);
    const monthLabel=`${MONTHS_EN[sm-1].toUpperCase()} ${sy}`;
    const fdt=d=>d?String(d).substring(5,10).replace("-","/")+" "+String(d).substring(2,4):"—";
    const fd2=d=>{if(!d)return"—";const s=String(d).substring(0,10);const[yy,mm,dd]=s.split("-");return`${dd}-${MONTHS_EN[Number(mm)-1]?.substring(0,3)}-${yy?.substring(2)}`};

    pg.innerHTML=`${CSS}<div class="mr-wrap">
    <div class="mr-header">
      <div>
        <div class="mr-title">HR MONTHLY STAFF MOVEMENT REPORT</div>
        <div class="mr-sub">FOR PAYROLL PROCESS</div>
      </div>
      <div style="display:flex;gap:10px;align-items:center;">
        <input type="month" class="form-control" value="${selYM}" onchange="window._mrMonth(this.value)" style="padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0;font-size:13px;">
        <div class="mr-month-box">${monthLabel}</div>
      </div>
    </div>

    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:16px 20px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,.04);">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:12px;">SUMMARY</div>
      <div class="mr-kpi">
        <div class="mr-kpi-card"><div class="mr-kpi-icon" style="background:#dbeafe;color:#2563eb;">${ICON.open}</div><div><div class="mr-kpi-label">Opening Headcount</div><div class="mr-kpi-val" style="color:#1a365d;">${r.openingHC}</div></div></div>
        <div class="mr-kpi-card"><div class="mr-kpi-icon" style="background:#dcfce7;color:#16a34a;">${ICON.join}</div><div><div class="mr-kpi-label">New Joiners</div><div class="mr-kpi-val" style="color:#16a34a;">${r.newJoiners.length}</div></div></div>
        <div class="mr-kpi-card"><div class="mr-kpi-icon" style="background:#fee2e2;color:#dc2626;">${ICON.sep}</div><div><div class="mr-kpi-label">Separations <span style="font-weight:400;font-size:8px;">(รวม)</span></div><div class="mr-kpi-val" style="color:#dc2626;">${r.separations.length}</div></div></div>
        <div class="mr-kpi-card"><div class="mr-kpi-icon" style="background:#fef3c7;color:#d97706;">${ICON.retire}</div><div><div class="mr-kpi-label">Retirement</div><div class="mr-kpi-val" style="color:#d97706;">${r.retirements.length}</div></div></div>
        <div class="mr-kpi-card"><div class="mr-kpi-icon" style="background:#eef3fb;color:#2B5AC7;">${ICON.transfer}</div><div><div class="mr-kpi-label">Internal Transfers</div><div class="mr-kpi-val" style="color:#2B5AC7;">${r.transfers.length}</div></div></div>
        <div class="mr-kpi-card"><div class="mr-kpi-icon" style="background:#ede9fe;color:#6D28D9;">${ICON.promo}</div><div><div class="mr-kpi-label">Promotions</div><div class="mr-kpi-val" style="color:#6D28D9;">${r.promotions.length}</div></div></div>
        <div class="mr-kpi-card" style="grid-column:span 1;"><div class="mr-kpi-icon" style="background:#dcfce7;color:#0D7C4B;">${ICON.end}</div><div><div class="mr-kpi-label">Ending Headcount</div><div class="mr-kpi-val" style="color:#0D7C4B;">${r.endingHC}</div></div></div>
        <div class="mr-kpi-card" style="grid-column:span 1;">
          <div style="text-align:center;width:100%;">
            <div class="mr-kpi-label">Net Change</div>
            <div class="mr-kpi-val" style="color:${r.endingHC-r.openingHC>=0?'#16a34a':'#dc2626'}">${r.endingHC-r.openingHC>=0?"+":""}${r.endingHC-r.openingHC}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="mr-grid">
      <div class="mr-section">
        <div class="mr-sec-title" style="background:#dcfce7;color:#14532d;">
          ${ICON.join} 1. NEW JOINERS <span class="cnt">(${r.newJoiners.length})</span>
        </div>
        ${r.newJoiners.length?`<table class="mr-tbl"><thead><tr><th class="num">No.</th><th>Employee ID</th><th>Employee Name</th><th>Position</th><th>Department</th><th>Start Date</th></tr></thead><tbody>
          ${r.newJoiners.map((j,i)=>`<tr><td class="num">${i+1}</td><td class="code">${esc(j.emp_code)}</td><td>${esc(j.name)}</td><td>${esc(j.position)}</td><td>${esc(j.department)}</td><td>${fd2(j.date)}</td></tr>`).join("")}
        </tbody></table>`:`<div class="mr-empty">ไม่มีพนักงานใหม่ในเดือนนี้</div>`}
      </div>

      <div class="mr-section">
        <div class="mr-sec-title" style="background:#fee2e2;color:#7f1d1d;">
          ${ICON.sep} 2. SEPARATIONS <span class="cnt">(${r.separations.length})</span>
        </div>
        ${r.separations.length?`<table class="mr-tbl"><thead><tr><th class="num">No.</th><th>Employee ID</th><th>Employee Name</th><th>Position</th><th>Department</th><th>Last Working Day</th><th>Reason</th></tr></thead><tbody>
          ${r.separations.map((s,i)=>{const[c,bg]=reasonColor[s.reason]||["#64748b","#f1f5f9"];return`<tr><td class="num">${i+1}</td><td class="code">${esc(s.emp_code)}</td><td>${esc(s.name)}</td><td>${esc(s.position)}</td><td>${esc(s.department)}</td><td>${fd2(s.date)}</td><td><span class="mr-badge" style="color:${c};background:${bg};">${esc(s.reason)}</span></td></tr>`;}).join("")}
        </tbody></table>`:`<div class="mr-empty">ไม่มีพนักงานลาออก/สิ้นสุดสัญญาในเดือนนี้</div>`}
      </div>
    </div>

    <div class="mr-grid">
      <div class="mr-section">
        <div class="mr-sec-title" style="background:#eef3fb;color:#1a365d;">
          ${ICON.transfer} 3. INTERNAL MOVEMENT <span class="cnt">(รวม ${r.internals.length} รายการ)</span>
        </div>
        ${r.internals.length?`<table class="mr-tbl"><thead><tr><th class="num">No.</th><th>Employee ID</th><th>Employee Name</th><th>Movement Type</th><th>From</th><th>To</th><th>Effective Date</th><th>Remark</th></tr></thead><tbody>
          ${r.internals.map((m,i)=>`<tr><td class="num">${i+1}</td><td class="code">${esc(m.emp_code)}</td><td>${esc(m.name)}</td><td><span class="mr-badge" style="color:#2B5AC7;background:#eef3fb;">${esc(m.type)}</span></td><td>${esc(m.from)}</td><td>${esc(m.to)}</td><td>${fd2(m.date)}</td><td style="color:#94a3b8;font-size:11px;">${esc(m.remark)}</td></tr>`).join("")}
        </tbody></table>`:`<div class="mr-empty">ไม่มีการโยกย้ายภายในเดือนนี้</div>`}
      </div>

      <div class="mr-section">
        <div class="mr-sec-title" style="background:#dbeafe;color:#1a365d;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
          4. HEADCOUNT MOVEMENT BY DEPARTMENT
        </div>
        <table class="mr-tbl"><thead><tr><th>Department</th><th style="text-align:center;">Opening HC</th><th style="text-align:center;">Joiners</th><th style="text-align:center;">Separations</th><th style="text-align:center;">Net Movement</th><th style="text-align:center;">Ending HC</th></tr></thead><tbody>
          ${r.depts.map(d=>`<tr><td style="font-weight:600;">${esc(d.name)}</td><td style="text-align:center;">${d.open}</td><td style="text-align:center;color:#16a34a;font-weight:600;">${d.join||""}</td><td style="text-align:center;color:#dc2626;font-weight:600;">${d.sep||""}</td><td style="text-align:center;font-weight:700;color:${d.net>0?'#16a34a':d.net<0?'#dc2626':'#64748b'}">${d.net>0?"+":""}${d.net}</td><td style="text-align:center;font-weight:700;">${d.end}</td></tr>`).join("")}
          <tr style="background:#1a365d;color:#fff;font-weight:700;">
            <td style="padding-left:12px;">TOTAL</td>
            <td style="text-align:center;">${r.openingHC}</td>
            <td style="text-align:center;color:#6ee7b7;">${r.newJoiners.length}</td>
            <td style="text-align:center;color:#fca5a5;">${r.separations.length}</td>
            <td style="text-align:center;color:${r.endingHC-r.openingHC>=0?'#6ee7b7':'#fca5a5'};">${r.endingHC-r.openingHC>=0?"+":""}${r.endingHC-r.openingHC}</td>
            <td style="text-align:center;">${r.endingHC}</td>
          </tr>
        </tbody></table>
      </div>
    </div>

    <div class="mr-footer">
      <div><div class="mr-footer-title">NOTE</div>
        <div>• Retirement รวมอยู่ใน Separations</div>
        <div>• ข้อมูล ณ วันที่ ${new Date().getDate()} ${MONTHS_TH[new Date().getMonth()]} ${new Date().getFullYear()+543}</div>
      </div>
      <div><div class="mr-footer-title">PREPARED BY</div><div class="mr-footer-line">HR Team</div></div>
      <div><div class="mr-footer-title">APPROVED BY</div><div class="mr-footer-line">_________________</div></div>
    </div>
    </div>`;
  }

  render();
  window._mrMonth=v=>{ selYM=v; render(); };
}
