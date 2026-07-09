import { supabase } from "./supabase-config.js";
import { allEmployees, allMovements, movYM, esc, fmtDate, toast } from "./app.js";

const MONTHS_EN=["January","February","March","April","May","June","July","August","September","October","November","December"];

function prevYM(ym){ const [y,m]=ym.split("-").map(Number); return m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,"0")}`; }
function nextYM(ym){ const [y,m]=ym.split("-").map(Number); return m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,"0")}`; }
function hcAtMonth(ym){
  return allEmployees.filter(e=>{
    const jm=(e.join_date||"").substring(0,7),em=(e.end_date||"").substring(0,7);
    if(jm&&jm>ym) return false; if(em&&em<=ym) return false; return true;
  });
}
function fd2(d){if(!d)return"—";const s=String(d).substring(0,10);const[y,m,dd]=s.split("-");return`${dd} ${MONTHS_EN[Number(m)-1]?.substring(0,3)} ${y}`;}

function buildReport(ym){
  const nxYM=nextYM(ym), pYM=prevYM(ym);
  const openingHC=hcAtMonth(pYM), endingHC=hcAtMonth(ym);
  const movMonth=allMovements.filter(m=>movYM(m)===ym);

  const movNewCodes=new Set(movMonth.filter(m=>m.type==="New Hire").map(m=>m.emp_code));
  const empNewOnly=allEmployees.filter(e=>(e.join_date||"").substring(0,7)===ym&&!movNewCodes.has(e.emp_code));
  const newJoiners=[
    ...movMonth.filter(m=>m.type==="New Hire").map(m=>{const e=allEmployees.find(x=>x.emp_code===m.emp_code);return{emp_code:m.emp_code,name:m.name||(e?`${e.firstname_th} ${e.lastname_th}`.trim():""),position:e?.position||"",department:e?.department||"",date:m.date};}),
    ...empNewOnly.map(e=>({emp_code:e.emp_code,name:`${e.firstname_th||""} ${e.lastname_th||""}`.trim(),position:e.position||"",department:e.department||"",date:e.join_date}))
  ];

  const movSepCodes=new Set(allMovements.filter(m=>movYM(m)===nxYM&&["Resignation","Retirement","Termination"].includes(m.type)).map(m=>m.emp_code));
  const empSepOnly=allEmployees.filter(e=>(e.end_date||"").substring(0,7)===nxYM&&["Resigned","Retired","Terminated"].includes(e.status)&&!movSepCodes.has(e.emp_code));
  const typeMap={Resigned:"Resignation",Retired:"Retirement",Terminated:"Termination"};
  const separations=[
    ...allMovements.filter(m=>movYM(m)===nxYM&&["Resignation","Retirement","Termination"].includes(m.type)).map(m=>{const e=allEmployees.find(x=>x.emp_code===m.emp_code);return{emp_code:m.emp_code,name:m.name||(e?`${e.firstname_th} ${e.lastname_th}`.trim():""),position:e?.position||"",department:e?.department||"",date:m.date,reason:m.type};}),
    ...empSepOnly.map(e=>({emp_code:e.emp_code,name:`${e.firstname_th||""} ${e.lastname_th||""}`.trim(),position:e.position||"",department:e.department||"",date:e.end_date,reason:typeMap[e.status]||e.status}))
  ];

  const internalTypes=["Transfer","Promotion","Demotion","Secondment"];
  const internals=movMonth.filter(m=>internalTypes.includes(m.type)).map(m=>{
    const e=allEmployees.find(x=>x.emp_code===m.emp_code);
    return{emp_code:m.emp_code,name:m.name||(e?`${e.firstname_th} ${e.lastname_th}`.trim():""),type:m.type,from:m.from_dept||"",to:m.to_dept||"",date:m.date,remark:m.reason||""};
  });

  const deptMap={};
  openingHC.forEach(e=>{const d=e.department||"Other";deptMap[d]=deptMap[d]||{open:0,join:0,sep:0};deptMap[d].open++;});
  newJoiners.forEach(j=>{const d=j.department||"Other";deptMap[d]=deptMap[d]||{open:0,join:0,sep:0};deptMap[d].join++;});
  separations.forEach(s=>{const d=s.department||"Other";deptMap[d]=deptMap[d]||{open:0,join:0,sep:0};deptMap[d].sep++;});
  const depts=Object.entries(deptMap).map(([name,v])=>({name,open:v.open,join:v.join,sep:v.sep,net:v.join-v.sep,end:v.open+v.join-v.sep})).sort((a,b)=>b.open-a.open);

  return{openingHC:openingHC.length,endingHC:endingHC.length,newJoiners,separations,internals,
    retirements:separations.filter(s=>s.reason==="Retirement"),
    promotions:internals.filter(i=>i.type==="Promotion"),
    transfers:internals.filter(i=>["Transfer","Secondment","Demotion"].includes(i.type)),depts};
}

const reasonColor={Resignation:["#C0392B","#FDECEA"],Retirement:["#D97706","#FEF3C7"],Termination:["#7C3AED","#EDE9FE"]};
const movTypeColor={Transfer:["#2B5AC7","#eef3fb"],Promotion:["#6D28D9","#ede9fe"],Demotion:["#C0392B","#fdecea"],Secondment:["#0D7C4B","#dcfce7"]};

const CSS=`<style>
.mr-wrap{font-family:inherit;}
.mr-summary{display:flex;gap:0;margin-bottom:24px;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 2px 8px rgba(0,0,0,.05);}
.mr-sum-card{flex:1;padding:20px 16px;text-align:center;background:#fff;border-right:1px solid #f1f5f9;position:relative;}
.mr-sum-card:last-child{border-right:none;}
.mr-sum-icon{width:38px;height:38px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:8px;}
.mr-sum-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:4px;}
.mr-sum-val{font-size:28px;font-weight:800;line-height:1;}
.mr-sum-divider{width:1px;background:linear-gradient(to bottom,transparent,#e2e8f0,transparent);align-self:stretch;}
@media(max-width:1100px){.mr-summary{flex-wrap:wrap;}.mr-sum-card{min-width:calc(25% - 1px);}}
@media(max-width:700px){.mr-sum-card{min-width:calc(50% - 1px);}}

.mr-flow{display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:24px;padding:14px;background:#fff;border-radius:12px;border:1px solid #e2e8f0;}
.mr-flow-box{padding:8px 20px;border-radius:8px;text-align:center;min-width:100px;}
.mr-flow-label{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;opacity:.7;margin-bottom:2px;}
.mr-flow-val{font-size:22px;font-weight:800;}
.mr-flow-arrow{color:#94a3b8;font-size:20px;}

.mr-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;}
@media(max-width:1000px){.mr-grid{grid-template-columns:1fr;}}
.mr-section{background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.04);}
.mr-sec-hdr{padding:14px 18px;display:flex;align-items:center;gap:10px;border-bottom:2px solid #e2e8f0;}
.mr-sec-num{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#fff;}
.mr-sec-label{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;}
.mr-sec-cnt{margin-left:auto;font-size:20px;font-weight:800;}

.mr-tbl{width:100%;border-collapse:collapse;font-size:12px;}
.mr-tbl th{padding:8px 12px;text-align:left;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#64748b;background:#f8fafc;border-bottom:1px solid #e2e8f0;}
.mr-tbl td{padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#334155;}
.mr-tbl tbody tr:nth-child(even){background:#fafbfd;}
.mr-tbl tbody tr:hover{background:#f0f5ff;}
.mr-tbl .num{text-align:center;color:#94a3b8;width:32px;font-size:11px;}
.mr-tbl .code{color:#2563eb;font-weight:600;font-size:11px;letter-spacing:.2px;}
.mr-badge{display:inline-block;padding:3px 10px;border-radius:6px;font-size:10px;font-weight:700;}
.mr-empty{text-align:center;padding:32px 16px;color:#cbd5e1;font-size:13px;}

.mr-dept-tbl{width:100%;border-collapse:collapse;font-size:12.5px;}
.mr-dept-tbl th{padding:10px 14px;text-align:center;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#64748b;background:#f8fafc;border-bottom:2px solid #e2e8f0;}
.mr-dept-tbl th:first-child{text-align:left;}
.mr-dept-tbl td{padding:9px 14px;text-align:center;border-bottom:1px solid #f1f5f9;}
.mr-dept-tbl td:first-child{text-align:left;font-weight:600;color:#1e293b;}
.mr-dept-tbl tbody tr:nth-child(even){background:#fafbfd;}
.mr-dept-tbl tbody tr:hover{background:#f0f5ff;}
.mr-dept-total td{background:#1a365d!important;color:#fff!important;font-weight:700;border:none;padding:11px 14px;}
</style>`;

const IC={
  open:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  join:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>`,
  sep:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/></svg>`,
  transfer:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4"/></svg>`,
  promo:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20V4m0 0l-4 4m4-4l4 4"/></svg>`,
  retire:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
  end:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  dept:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>`,
};

export function renderMovementReport(){
  const pg=document.getElementById("pageMovreport");
  const now=new Date();
  const curY=now.getFullYear();
  let selYM=`${curY}-${String(now.getMonth()+1).padStart(2,"0")}`;

  function monthOptions(){
    const opts=[];
    for(let y=curY;y>=curY-2;y--) for(let m=12;m>=1;m--){
      const ym=`${y}-${String(m).padStart(2,"0")}`;
      opts.push({val:ym,label:`${MONTHS_EN[m-1]} ${y}`});
    }
    return opts;
  }

  function render(){
    const [sy,sm]=selYM.split("-").map(Number);
    const r=buildReport(selYM);
    const net=r.endingHC-r.openingHC;
    const opts=monthOptions();

    pg.innerHTML=`${CSS}<div class="mr-wrap">
    <div class="page-header" style="margin-bottom:20px;">
      <div>
        <div class="page-heading" style="font-size:22px;font-weight:800;letter-spacing:-.3px;">STAFF MOVEMENT REPORT</div>
        <div class="page-sub">รายงานความเคลื่อนไหวพนักงานรายเดือน — ${MONTHS_EN[sm-1]} ${sy}</div>
      </div>
      <div class="header-actions" style="display:flex;gap:10px;align-items:center;">
        <button class="btn" onclick="window._mrPrev()" style="padding:8px 10px;border-radius:8px;border:1px solid #e2e8f0;background:#fff;cursor:pointer;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1a365d" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div style="position:relative;">
          <select class="filter-select" style="padding-left:32px;min-width:180px;" onchange="window._mrMonth(this.value)">
            ${opts.map(o=>`<option value="${o.val}" ${o.val===selYM?"selected":""}>${o.label}</option>`).join("")}
          </select>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);pointer-events:none;"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
        <button class="btn" onclick="window._mrNext()" style="padding:8px 10px;border-radius:8px;border:1px solid #e2e8f0;background:#fff;cursor:pointer;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1a365d" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
    </div>

    <!-- Flow: Opening → +New → -Sep → Ending -->
    <div class="mr-flow">
      <div class="mr-flow-box" style="background:#dbeafe;color:#1a365d;">
        <div class="mr-flow-label">Opening</div>
        <div class="mr-flow-val">${r.openingHC}</div>
      </div>
      <div class="mr-flow-arrow">+</div>
      <div class="mr-flow-box" style="background:#dcfce7;color:#16a34a;">
        <div class="mr-flow-label">New Joiners</div>
        <div class="mr-flow-val">${r.newJoiners.length}</div>
      </div>
      <div class="mr-flow-arrow">−</div>
      <div class="mr-flow-box" style="background:#fee2e2;color:#dc2626;">
        <div class="mr-flow-label">Separations</div>
        <div class="mr-flow-val">${r.separations.length}</div>
      </div>
      <div class="mr-flow-arrow">=</div>
      <div class="mr-flow-box" style="background:#1a365d;color:#fff;">
        <div class="mr-flow-label" style="color:#94a3b8;">Ending</div>
        <div class="mr-flow-val">${r.endingHC}</div>
      </div>
      <div style="border-left:1px solid #e2e8f0;height:50px;margin:0 8px;"></div>
      <div class="mr-flow-box" style="background:${net>=0?'#dcfce7':'#fee2e2'};color:${net>=0?'#16a34a':'#dc2626'};">
        <div class="mr-flow-label">Net</div>
        <div class="mr-flow-val">${net>=0?"+":""}${net}</div>
      </div>
    </div>

    <!-- Summary cards -->
    <div class="mr-summary">
      <div class="mr-sum-card"><div class="mr-sum-icon" style="background:#fef3c7;color:#d97706;">${IC.retire}</div><div class="mr-sum-label">Retirement</div><div class="mr-sum-val" style="color:#d97706;">${r.retirements.length}</div></div>
      <div class="mr-sum-card"><div class="mr-sum-icon" style="background:#eef3fb;color:#2B5AC7;">${IC.transfer}</div><div class="mr-sum-label">Transfers</div><div class="mr-sum-val" style="color:#2B5AC7;">${r.transfers.length}</div></div>
      <div class="mr-sum-card"><div class="mr-sum-icon" style="background:#ede9fe;color:#6D28D9;">${IC.promo}</div><div class="mr-sum-label">Promotions</div><div class="mr-sum-val" style="color:#6D28D9;">${r.promotions.length}</div></div>
      <div class="mr-sum-card"><div class="mr-sum-icon" style="background:#eef3fb;color:#2B5AC7;">${IC.transfer}</div><div class="mr-sum-label">Internal Total</div><div class="mr-sum-val" style="color:#1a365d;">${r.internals.length}</div></div>
    </div>

    <!-- Detail tables -->
    <div class="mr-grid">
      <div class="mr-section">
        <div class="mr-sec-hdr">
          <div class="mr-sec-num" style="background:#16a34a;">1</div>
          <div class="mr-sec-label" style="color:#14532d;">New Joiners</div>
          <div class="mr-sec-cnt" style="color:#16a34a;">${r.newJoiners.length}</div>
        </div>
        ${r.newJoiners.length?`<table class="mr-tbl"><thead><tr><th class="num">No.</th><th>Employee ID</th><th>Name</th><th>Position</th><th>Department</th><th>Start Date</th></tr></thead><tbody>
          ${r.newJoiners.map((j,i)=>`<tr><td class="num">${i+1}</td><td class="code">${esc(j.emp_code)}</td><td>${esc(j.name)}</td><td>${esc(j.position)}</td><td>${esc(j.department)}</td><td>${fd2(j.date)}</td></tr>`).join("")}
        </tbody></table>`:`<div class="mr-empty">ไม่มีพนักงานใหม่ในเดือนนี้</div>`}
      </div>

      <div class="mr-section">
        <div class="mr-sec-hdr">
          <div class="mr-sec-num" style="background:#dc2626;">2</div>
          <div class="mr-sec-label" style="color:#7f1d1d;">Separations</div>
          <div class="mr-sec-cnt" style="color:#dc2626;">${r.separations.length}</div>
        </div>
        ${r.separations.length?`<table class="mr-tbl"><thead><tr><th class="num">No.</th><th>Employee ID</th><th>Name</th><th>Position</th><th>Department</th><th>Last Day</th><th>Reason</th></tr></thead><tbody>
          ${r.separations.map((s,i)=>{const[c,bg]=reasonColor[s.reason]||["#64748b","#f1f5f9"];return`<tr><td class="num">${i+1}</td><td class="code">${esc(s.emp_code)}</td><td>${esc(s.name)}</td><td>${esc(s.position)}</td><td>${esc(s.department)}</td><td>${fd2(s.date)}</td><td><span class="mr-badge" style="color:${c};background:${bg};">${esc(s.reason)}</span></td></tr>`;}).join("")}
        </tbody></table>`:`<div class="mr-empty">ไม่มีพนักงานลาออก/สิ้นสุดสัญญาในเดือนนี้</div>`}
      </div>
    </div>

    <div class="mr-grid">
      <div class="mr-section">
        <div class="mr-sec-hdr">
          <div class="mr-sec-num" style="background:#2B5AC7;">3</div>
          <div class="mr-sec-label" style="color:#1a365d;">Internal Movement</div>
          <div class="mr-sec-cnt" style="color:#2B5AC7;">${r.internals.length}</div>
        </div>
        ${r.internals.length?`<table class="mr-tbl"><thead><tr><th class="num">No.</th><th>Employee ID</th><th>Name</th><th>Type</th><th>From</th><th>To</th><th>Date</th><th>Remark</th></tr></thead><tbody>
          ${r.internals.map((m,i)=>{const[c,bg]=movTypeColor[m.type]||["#64748b","#f1f5f9"];return`<tr><td class="num">${i+1}</td><td class="code">${esc(m.emp_code)}</td><td>${esc(m.name)}</td><td><span class="mr-badge" style="color:${c};background:${bg};">${esc(m.type)}</span></td><td>${esc(m.from)}</td><td>${esc(m.to)}</td><td>${fd2(m.date)}</td><td style="color:#94a3b8;font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis;">${esc(m.remark)}</td></tr>`;}).join("")}
        </tbody></table>`:`<div class="mr-empty">ไม่มีการโยกย้ายภายในเดือนนี้</div>`}
      </div>

      <div class="mr-section">
        <div class="mr-sec-hdr">
          <div class="mr-sec-num" style="background:#1a365d;">4</div>
          <div class="mr-sec-label" style="color:#1a365d;">Headcount by Department</div>
          <div class="mr-sec-cnt" style="color:#1a365d;">${r.depts.length} <span style="font-size:11px;font-weight:400;color:#94a3b8;">depts</span></div>
        </div>
        <table class="mr-dept-tbl"><thead><tr><th style="text-align:left;">Department</th><th>Opening</th><th>Joiners</th><th>Sep.</th><th>Net</th><th>Ending</th></tr></thead><tbody>
          ${r.depts.map(d=>`<tr><td>${esc(d.name)}</td><td>${d.open}</td><td style="color:#16a34a;font-weight:600;">${d.join||"—"}</td><td style="color:#dc2626;font-weight:600;">${d.sep||"—"}</td><td style="font-weight:700;color:${d.net>0?'#16a34a':d.net<0?'#dc2626':'#94a3b8'}">${d.net>0?"+":""}${d.net}</td><td style="font-weight:700;">${d.end}</td></tr>`).join("")}
          <tr class="mr-dept-total"><td>TOTAL</td><td>${r.openingHC}</td><td style="color:#6ee7b7;">${r.newJoiners.length}</td><td style="color:#fca5a5;">${r.separations.length}</td><td style="color:${net>=0?'#6ee7b7':'#fca5a5'};">${net>=0?"+":""}${net}</td><td>${r.endingHC}</td></tr>
        </tbody></table>
      </div>
    </div>
    </div>`;
  }

  render();
  window._mrMonth=v=>{ selYM=v; render(); };
  window._mrPrev=()=>{ selYM=prevYM(selYM); render(); };
  window._mrNext=()=>{ selYM=nextYM(selYM); render(); };
}
