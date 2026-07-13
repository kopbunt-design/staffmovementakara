import { supabase } from "./supabase-config.js";
import { allEmployees, allMovements, movYM, esc, toast, userRole, navigate } from "./app.js";
import { PROVINCES } from "./masterdata.js";

const MO=["January","February","March","April","May","June","July","August","September","October","November","December"];
const MS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const PROV_CLR={"Phichit":"#16a34a","Phetchabun":"#2563eb","Phitsanulok":"#8b5cf6","Other":"#f59e0b"};

function prevYM(ym){const[y,m]=ym.split("-").map(Number);return m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,"0")}`;}
function nextYM(ym){const[y,m]=ym.split("-").map(Number);return m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,"0")}`;}
function lastWorkYM(dateStr){
  if(!dateStr) return "";
  const d=new Date(dateStr);d.setUTCDate(d.getUTCDate()-1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
}
function hcAtMonth(ym){
  return allEmployees.filter(e=>{
    const jm=(e.join_date||"").substring(0,7);
    if(jm&&jm>ym)return false;
    if(e.end_date){ const lm=lastWorkYM(e.end_date); if(lm<=ym) return false; }
    return true;
  });
}
function getNewHires(ym){
  const mc=new Set(allMovements.filter(m=>movYM(m)===ym&&m.type==="New Hire").map(m=>m.emp_code));
  const eo=allEmployees.filter(e=>(e.join_date||"").substring(0,7)===ym&&!mc.has(e.emp_code));
  return mc.size+eo.length;
}
function getResignations(ym){
  const mc=new Set(allMovements.filter(m=>lastWorkYM(m.date)===ym&&["Resignation","Retirement","Termination"].includes(m.type)).map(m=>m.emp_code));
  const eo=allEmployees.filter(e=>lastWorkYM(e.end_date)===ym&&["Resigned","Retired","Terminated"].includes(e.status)&&!mc.has(e.emp_code));
  return mc.size+eo.length;
}
function getFirstYearCount(ym){
  const mc=new Set(allMovements.filter(m=>lastWorkYM(m.date)===ym&&["Resignation","Retirement","Termination"].includes(m.type)).map(m=>m.emp_code));
  const eo=allEmployees.filter(e=>lastWorkYM(e.end_date)===ym&&["Resigned","Retired","Terminated"].includes(e.status)&&!mc.has(e.emp_code));
  const codes=[...mc,...eo.map(e=>e.emp_code)];
  let n=0;
  for(const c of codes){
    const e=allEmployees.find(x=>x.emp_code===c);
    if(!e?.join_date||!e?.end_date)continue;
    if((new Date(e.end_date)-new Date(e.join_date))/(864e5)<=365)n++;
  }
  return n;
}
function getProv(e){return e.province&&e.province!=="-"?e.province:"Other";}
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
.wf-wrap{font-family:inherit;}
.wf-main-grid{display:grid;grid-template-columns:1fr 340px;gap:20px;margin-bottom:20px;}
@media(max-width:1100px){.wf-main-grid{grid-template-columns:1fr;}}
.wf-section{background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.04);margin-bottom:0;}
.wf-section-title{padding:14px 18px;display:flex;align-items:center;gap:10px;font-size:13px;font-weight:700;color:#1a365d;text-transform:uppercase;letter-spacing:.3px;border-bottom:2px solid #e2e8f0;}

.wf-summary-tbl{width:100%;border-collapse:collapse;font-size:12.5px;}
.wf-summary-tbl th{padding:10px 14px;text-align:center;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b;background:#f8fafc;border-bottom:2px solid #e2e8f0;}
.wf-summary-tbl td{padding:10px 14px;border-bottom:1px solid #f1f5f9;}
.wf-icon-cell{width:36px;text-align:center;}
.wf-item-name{font-weight:500;color:#1e293b;}
.wf-num{text-align:center;font-weight:600;color:#334155;}
.wf-highlight-row td{background:#f0f5ff;border-bottom:2px solid #2563eb;}

.wf-kpi-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.wf-kpi-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.04);}
.wf-kpi-icon{width:42px;height:42px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:8px;}
.wf-kpi-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:4px;}
.wf-kpi-value{font-size:28px;font-weight:800;line-height:1.1;}
.wf-kpi-sub{font-size:10px;color:#64748b;margin-top:4px;}
.wf-kpi-delta{font-size:9px;margin-top:4px;line-height:1.3;}

.wf-metrics-row{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px;}
@media(max-width:1000px){.wf-metrics-row{grid-template-columns:repeat(3,1fr);}}
@media(max-width:700px){.wf-metrics-row{grid-template-columns:repeat(2,1fr);}}
.wf-metric-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 12px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.04);}
.wf-metric-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:6px;}
.wf-metric-value{font-size:24px;font-weight:800;line-height:1;}
.wf-metric-sub{font-size:9px;color:#94a3b8;margin-top:4px;}

.wf-province-grid{display:grid;grid-template-columns:1fr 1fr;gap:0;margin-bottom:20px;background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.04);}
@media(max-width:900px){.wf-province-grid{grid-template-columns:1fr;}}
.wf-prov-tbl{width:100%;border-collapse:collapse;font-size:12.5px;}
.wf-prov-tbl th{padding:10px 14px;text-align:center;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#64748b;background:#f8fafc;border-bottom:2px solid #e2e8f0;}
.wf-prov-tbl td{padding:9px 14px;border-bottom:1px solid #f1f5f9;}
.wf-prov-total td{background:#1a365d!important;color:#fff!important;font-weight:700;border:none;padding:11px 14px;}

.wf-trend-tbl{width:100%;border-collapse:collapse;font-size:12px;}
.wf-trend-tbl th{padding:8px 10px;text-align:center;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;color:#64748b;background:#f8fafc;border-bottom:2px solid #e2e8f0;}
.wf-trend-tbl td{padding:8px 10px;text-align:center;border-bottom:1px solid #f1f5f9;font-weight:500;}
.wf-trend-tbl tbody tr:nth-child(even){background:#fafbfd;}
.wf-trend-total td{background:#1a365d!important;color:#fff!important;font-weight:700;border:none;}

</style>`;

export async function renderWorkforceOverview(){
  const pg=document.getElementById("pageWorkforce");
  await loadPosQuota();
  const now=new Date();
  const curY=now.getFullYear();
  let selYM=`${curY}-${String(now.getMonth()+1).padStart(2,"0")}`;

  function monthOpts(){
    const o=[];for(let y=curY;y>=curY-2;y--)for(let m=12;m>=1;m--)o.push({val:`${y}-${String(m).padStart(2,"0")}`,label:`${MO[m-1]} ${y}`});return o;
  }

  function render(){
    const[sy,sm]=selYM.split("-").map(Number);
    const pYM=prevYM(selYM);const[py,pm]=pYM.split("-").map(Number);
    const ppYM=prevYM(pYM);
    const mLbl=`${MO[sm-1]} ${sy}`, pLbl=`${MO[pm-1]} ${py}`;
    const curYM=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;

    const endHC=hcAtMonth(selYM), begHC=hcAtMonth(pYM);
    const hcE=endHC.length, hcB=begHC.length;
    const newH=getNewHires(selYM), resig=getResignations(selYM);
    const pBegHC=hcAtMonth(ppYM).length, pNewH=getNewHires(pYM), pResig=getResignations(pYM), pHCE=begHC.length;

    const curFY=getFY(selYM);
    const vc=calcVacancy(endHC,curFY), vac=vc.totalVacancy, approved=vc.totalQuota;
    const pFY=getFY(pYM);
    const pvc=calcVacancy(begHC,pFY), pVac=pvc.totalVacancy, pApproved=pvc.totalQuota;

    const netMoM=hcE-hcB;
    const yoyYM=`${sy-1}-${String(sm).padStart(2,"0")}`;
    const yoyHC=hcAtMonth(yoyYM).length, netYoY=hcE-yoyHC;
    const yoyPct=yoyHC>0?`(${((netYoY/yoyHC)*100).toFixed(2)}%)`:"";
    const vacRate=approved>0?((vac/approved)*100).toFixed(2):"—";
    const pVacRate=pApproved>0?((pVac/pApproved)*100).toFixed(2):null;
    const vacDiff=vacRate!=="—"&&pVacRate!==null?(parseFloat(vacRate)-parseFloat(pVacRate)).toFixed(2):null;

    const avgHC=(hcB+hcE)/2;
    const trRate=avgHC>0?((resig/avgHC)*100).toFixed(2):"0.00";
    const fyCount=getFirstYearCount(selYM);
    const fyRate=avgHC>0?((fyCount/avgHC)*100).toFixed(2):"0.00";

    const males=endHC.filter(e=>(e.gender||"").toLowerCase()==="male").length;
    const females=endHC.filter(e=>(e.gender||"").toLowerCase()==="female").length;
    const thai=endHC.filter(e=>(e.nationality||"").toLowerCase()==="thai").length;
    const aus=endHC.filter(e=>(e.nationality||"").toLowerCase()==="australian").length;
    const natO=hcE-thai-aus;
    const mLvls=["M1","M2","M3","M4"];
    const mgrs=endHC.filter(e=>mLvls.includes((e.job_level||"").toUpperCase())).length;
    const mgrR=hcE>0?((mgrs/hcE)*100).toFixed(1):"0.0";

    const provData=PROVINCES.map(p=>({name:p,count:endHC.filter(e=>getProv(e)===p).length}))
      .map(p=>({...p,pct:hcE>0?(p.count/hcE*100).toFixed(1):"0.0"}))
      .filter(p=>p.count>0).sort((a,b)=>b.count-a.count);
    const maxProv=provData[0]?.count||1;

    const trendM=[];
    for(let m=1;m<=12;m++){
      const ym=`${sy}-${String(m).padStart(2,"0")}`;
      trendM.push({ym,mo:MS[m-1],fut:ym>curYM});
    }
    const provTrend={};
    PROVINCES.forEach(prov=>{
      provTrend[prov]=trendM.map(t=>t.fut?"—":hcAtMonth(t.ym).filter(e=>getProv(e)===prov).length);
    });
    const tTotals=trendM.map((t,i)=>t.fut?"—":PROVINCES.reduce((s,p)=>{const v=provTrend[p][i];return s+(typeof v==="number"?v:0);},0));

    const ca=(c,p)=>{const d=c-p;return d>0?`<span style="color:#16a34a;">&#9650; +${d}</span>`:d<0?`<span style="color:#dc2626;">&#9660; ${d}</span>`:`<span style="color:#94a3b8;">— 0</span>`;};
    const cp=(c,p)=>{if(p===0)return"—";const v=((c-p)/p*100).toFixed(2);return `${v>=0?"+":""}${v}%`;};
    const canEdit=userRole==="hr"||userRole==="admin";
    const opts=monthOpts();

    pg.innerHTML=`${CSS}<div class="wf-wrap">
    <div class="page-header" style="margin-bottom:20px;">
      <div>
        <div class="page-heading" style="font-size:22px;font-weight:800;">WORKFORCE OVERVIEW</div>
        <div class="page-sub">Workforce Summary Report — ${mLbl}</div>
      </div>
      <div class="header-actions" style="display:flex;gap:10px;align-items:center;">
        <button class="btn" onclick="window._wfPrev()" style="padding:8px 10px;border-radius:8px;border:1px solid #e2e8f0;background:#fff;cursor:pointer;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1a365d" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div style="position:relative;">
          <select class="filter-select" style="padding-left:32px;min-width:180px;" onchange="window._wfMonth(this.value)">
            ${opts.map(o=>`<option value="${o.val}" ${o.val===selYM?"selected":""}>${o.label}</option>`).join("")}
          </select>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);pointer-events:none;"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
        <button class="btn" onclick="window._wfNext()" style="padding:8px 10px;border-radius:8px;border:1px solid #e2e8f0;background:#fff;cursor:pointer;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1a365d" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        ${canEdit?`<button class="btn btn-secondary" onclick="window._wfVacancy()" style="gap:6px;display:flex;align-items:center;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a4 4 0 0 0-8 0v2"/></svg>
          Vacancy (FY${curFY})
        </button>`:""}
        <button class="btn btn-primary" onclick="window._wfExport()" style="gap:6px;display:flex;align-items:center;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export Excel
        </button>
      </div>
    </div>

    <!-- WORKFORCE SUMMARY (MoM) + KPI -->
    <div class="wf-main-grid">
      <div class="wf-section">
        <div class="wf-section-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1a365d" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/></svg>
          WORKFORCE SUMMARY <span style="font-weight:400;color:#64748b;">(Month-on-Month)</span>
        </div>
        <table class="wf-summary-tbl">
          <thead><tr>
            <th style="width:36px;"></th>
            <th style="text-align:left;">ITEM</th>
            <th>${pLbl.toUpperCase()}</th>
            <th>${mLbl.toUpperCase()}</th>
            <th>CHANGE</th>
            <th>CHANGE (%)</th>
          </tr></thead>
          <tbody>
            <tr>
              <td class="wf-icon-cell"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></td>
              <td class="wf-item-name">Headcount (Beginning)</td>
              <td class="wf-num">${pBegHC}</td>
              <td class="wf-num">${hcB}</td>
              <td class="wf-num" style="color:#94a3b8;">—</td>
              <td class="wf-num" style="color:#94a3b8;">—</td>
            </tr>
            <tr>
              <td class="wf-icon-cell"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg></td>
              <td class="wf-item-name">New Hires</td>
              <td class="wf-num">${pNewH}</td>
              <td class="wf-num">${newH}</td>
              <td class="wf-num">${ca(newH,pNewH)}</td>
              <td class="wf-num">${cp(newH,pNewH)}</td>
            </tr>
            <tr>
              <td class="wf-icon-cell"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/></svg></td>
              <td class="wf-item-name">Resignations</td>
              <td class="wf-num">${pResig}</td>
              <td class="wf-num">${resig}</td>
              <td class="wf-num">${ca(resig,pResig)}</td>
              <td class="wf-num">${cp(resig,pResig)}</td>
            </tr>
            <tr class="wf-highlight-row">
              <td class="wf-icon-cell"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1a365d" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></td>
              <td class="wf-item-name" style="font-weight:700;">Headcount (Ending)</td>
              <td class="wf-num" style="font-weight:700;">${pHCE}</td>
              <td class="wf-num" style="font-weight:700;">${hcE}</td>
              <td class="wf-num">${ca(hcE,pHCE)}</td>
              <td class="wf-num">${cp(hcE,pHCE)}</td>
            </tr>
            <tr>
              <td class="wf-icon-cell"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a4 4 0 0 0-8 0v2"/></svg></td>
              <td class="wf-item-name">Vacancy</td>
              <td class="wf-num">${pApproved>0?pVac:"—"}</td>
              <td class="wf-num">${approved>0?vac:"—"}</td>
              <td class="wf-num">${approved>0&&pApproved>0?ca(vac,pVac):"—"}</td>
              <td class="wf-num">${approved>0&&pApproved>0?cp(vac,pVac):"—"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="wf-kpi-grid">
        <div class="wf-kpi-card">
          <div class="wf-kpi-icon" style="background:#dbeafe;color:#2563eb;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          </div>
          <div class="wf-kpi-label">HEADCOUNT (ENDING)</div>
          <div class="wf-kpi-value" style="color:#1a365d;">${hcE}</div>
          <div class="wf-kpi-sub">Employees</div>
          <div class="wf-kpi-delta" style="color:${netMoM>=0?'#16a34a':'#dc2626'};">&#9650; ${netMoM>=0?"+":""}${netMoM} (${pHCE>0?((netMoM/pHCE)*100).toFixed(2):"0"}%)<br><span style="color:#64748b;">vs. ${MS[pm-1]} ${py}</span></div>
        </div>
        <div class="wf-kpi-card">
          <div class="wf-kpi-icon" style="background:${netMoM>=0?'#dcfce7':'#fee2e2'};color:${netMoM>=0?'#16a34a':'#dc2626'};">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20V4m0 0l-4 4m4-4l4 4"/></svg>
          </div>
          <div class="wf-kpi-label">NET CHANGE (MoM)</div>
          <div class="wf-kpi-value" style="color:${netMoM>=0?'#16a34a':'#dc2626'};">${netMoM>=0?"+":""}${netMoM}</div>
          <div class="wf-kpi-sub">(${pHCE>0?((netMoM/pHCE)*100).toFixed(2):"0"}%)</div>
          <div class="wf-kpi-delta" style="color:#64748b;">vs. ${MS[pm-1]} ${py}</div>
        </div>
        <div class="wf-kpi-card">
          <div class="wf-kpi-icon" style="background:#fef3c7;color:#d97706;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
          </div>
          <div class="wf-kpi-label">NET CHANGE (YoY)</div>
          <div class="wf-kpi-value" style="color:${netYoY>=0?'#16a34a':'#dc2626'};">${netYoY>=0?"+":""}${netYoY}</div>
          <div class="wf-kpi-sub">${yoyPct}</div>
          <div class="wf-kpi-delta" style="color:#64748b;">vs. ${MS[sm-1]} ${sy-1}</div>
        </div>
        <div class="wf-kpi-card">
          <div class="wf-kpi-icon" style="background:${approved>0?'#fee2e2':'#f1f5f9'};color:${approved>0?'#dc2626':'#94a3b8'};">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a4 4 0 0 0-8 0v2"/></svg>
          </div>
          <div class="wf-kpi-label">VACANCY RATE</div>
          <div class="wf-kpi-value" style="color:${approved>0?'#dc2626':'#94a3b8'};">${vacRate!=="—"?vacRate+"%":"—"}</div>
          ${vacDiff!==null?`<div class="wf-kpi-sub">&#9650; ${parseFloat(vacDiff)>=0?"+":""}${vacDiff} pp</div>`:`<div class="wf-kpi-sub">${approved>0?"":"ยังไม่ได้ตั้งค่า"}</div>`}
          <div class="wf-kpi-delta" style="color:#64748b;">vs. ${MS[pm-1]} ${py}</div>
        </div>
      </div>
    </div>

    <!-- ADDITIONAL METRICS -->
    <div class="wf-metrics-row">
      <div class="wf-metric-card">
        <div class="wf-metric-label">TURNOVER RATE</div>
        <div class="wf-metric-value" style="color:#dc2626;">${trRate}%</div>
        <div class="wf-metric-sub">${resig} sep / ${Math.round(avgHC)} avg HC</div>
      </div>
      <div class="wf-metric-card">
        <div class="wf-metric-label">FIRST-YEAR TURNOVER</div>
        <div class="wf-metric-value" style="color:#d97706;">${fyRate}%</div>
        <div class="wf-metric-sub">${fyCount} employees (&lt; 1 yr)</div>
      </div>
      <div class="wf-metric-card">
        <div class="wf-metric-label">GENDER RATIO</div>
        <div style="display:flex;gap:16px;align-items:center;justify-content:center;margin-top:4px;">
          <div style="text-align:center;"><div style="font-size:20px;font-weight:800;color:#2563eb;">${males}</div><div style="font-size:9px;color:#64748b;">Male (${hcE>0?(males/hcE*100).toFixed(1):"0"}%)</div></div>
          <div style="width:1px;height:30px;background:#e2e8f0;"></div>
          <div style="text-align:center;"><div style="font-size:20px;font-weight:800;color:#ec4899;">${females}</div><div style="font-size:9px;color:#64748b;">Female (${hcE>0?(females/hcE*100).toFixed(1):"0"}%)</div></div>
        </div>
      </div>
      <div class="wf-metric-card">
        <div class="wf-metric-label">NATIONALITY</div>
        <div style="font-size:10px;margin-top:6px;line-height:1.8;">
          <div style="display:flex;justify-content:space-between;"><span>Thai</span><b>${thai} (${hcE>0?(thai/hcE*100).toFixed(1):"0"}%)</b></div>
          <div style="display:flex;justify-content:space-between;"><span>Australian</span><b>${aus} (${hcE>0?(aus/hcE*100).toFixed(1):"0"}%)</b></div>
          <div style="display:flex;justify-content:space-between;"><span>Other</span><b>${natO} (${hcE>0?(natO/hcE*100).toFixed(1):"0"}%)</b></div>
        </div>
      </div>
      <div class="wf-metric-card">
        <div class="wf-metric-label">MANAGEMENT RATIO</div>
        <div class="wf-metric-value" style="color:#6d28d9;">${mgrR}%</div>
        <div class="wf-metric-sub">${mgrs} managers / ${hcE} total</div>
      </div>
    </div>

    <!-- HEADCOUNT BY PROVINCE -->
    <div class="wf-province-grid">
      <div>
        <div class="wf-section-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1a365d" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          HEADCOUNT BY PROVINCE <span style="font-weight:400;color:#64748b;">(as of ${mLbl})</span>
        </div>
        <div style="display:flex;justify-content:flex-end;padding:6px 18px 0;font-size:10px;color:#94a3b8;">Unit : Persons</div>
        <table class="wf-prov-tbl">
          <thead><tr><th style="width:24px;"></th><th style="text-align:left;">PROVINCE</th><th>EMPLOYEE</th><th>% OF TOTAL</th></tr></thead>
          <tbody>
            ${provData.map(p=>`<tr>
              <td><div style="width:12px;height:12px;border-radius:3px;background:${PROV_CLR[p.name]||PROV_CLR.Other};"></div></td>
              <td style="font-weight:600;">${esc(p.name)}</td>
              <td style="text-align:center;font-weight:600;">${p.count}</td>
              <td style="text-align:center;">${p.pct}%</td>
            </tr>`).join("")}
            <tr class="wf-prov-total"><td></td><td>GRAND TOTAL</td><td style="text-align:center;">${hcE}</td><td style="text-align:center;">100.0%</td></tr>
          </tbody>
        </table>
      </div>
      <div style="display:flex;flex-direction:column;justify-content:center;gap:14px;padding:24px 20px;border-left:1px solid #e2e8f0;">
        ${provData.map(p=>{
          const clr=PROV_CLR[p.name]||PROV_CLR.Other;
          const w=maxProv>0?(p.count/maxProv*100):0;
          return `<div style="display:flex;align-items:center;gap:12px;">
            <div style="width:90px;text-align:right;font-size:12px;font-weight:500;color:#475569;">${esc(p.name)}</div>
            <div style="flex:1;height:28px;background:#f1f5f9;border-radius:6px;overflow:hidden;">
              <div style="height:100%;width:${w}%;background:${clr};border-radius:6px;"></div>
            </div>
            <div style="min-width:70px;font-size:13px;font-weight:700;color:#1e293b;">${p.count} <span style="font-size:10px;color:#94a3b8;">${p.pct}%</span></div>
          </div>`;
        }).join("")}
      </div>
    </div>

    <!-- HEADCOUNT TREND BY PROVINCE -->
    <div class="wf-section" style="margin-top:20px;margin-bottom:24px;">
      <div class="wf-section-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1a365d" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
        HEADCOUNT TREND BY PROVINCE <span style="font-weight:400;color:#64748b;">(Calendar Year ${sy})</span>
      </div>
      <div style="display:flex;justify-content:flex-end;padding:6px 18px 0;font-size:10px;color:#94a3b8;">Unit : Persons</div>
      <div class="table-wrap">
        <table class="wf-trend-tbl">
          <thead><tr>
            <th style="width:24px;"></th>
            <th style="text-align:left;min-width:100px;"></th>
            ${trendM.map(t=>`<th style="${t.ym===selYM?'color:#1a365d;font-weight:800;border-bottom-color:#2563eb;':''}">${t.mo.toUpperCase()}</th>`).join("")}
          </tr></thead>
          <tbody>
            ${PROVINCES.filter(prov=>provData.find(p=>p.name===prov)).map(prov=>`<tr>
              <td><div style="width:12px;height:12px;border-radius:3px;background:${PROV_CLR[prov]||PROV_CLR.Other};"></div></td>
              <td style="font-weight:600;text-align:left;">${esc(prov)}</td>
              ${trendM.map((t,i)=>{const v=provTrend[prov][i];return`<td style="${t.ym===selYM?'font-weight:800;color:#1a365d;':''}${t.fut?'color:#cbd5e1;':''}">${v}</td>`;}).join("")}
            </tr>`).join("")}
            <tr class="wf-trend-total">
              <td></td><td>GRAND TOTAL</td>
              ${tTotals.map((t,i)=>`<td style="${trendM[i].ym===selYM?'font-weight:800;':''}">${t}</td>`).join("")}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    </div>`;
  }

  render();
  window._wfMonth=v=>{selYM=v;render();};
  window._wfPrev=()=>{selYM=prevYM(selYM);render();};
  window._wfNext=()=>{selYM=nextYM(selYM);render();};
  window._wfExport=()=>exportOverview(selYM).catch(e=>{console.error(e);toast("Export ผิดพลาด: "+e.message,"error");});
  window._wfVacancy=()=>navigate("vacancy");
}

// === EXCEL EXPORT ===
async function exportOverview(ym){
  if(!window.ExcelJS){toast("กรุณารอโหลด library","error");return;}
  const[sy,sm]=ym.split("-").map(Number);
  const pYM=prevYM(ym),[py,pm]=pYM.split("-").map(Number);
  const ppYM=prevYM(pYM);
  const mLbl=`${MO[sm-1]} ${sy}`, pLbl=`${MO[pm-1]} ${py}`;
  const now=new Date();
  const curYM=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;

  const endHC=hcAtMonth(ym),begHC=hcAtMonth(pYM);
  const hcE=endHC.length,hcB=begHC.length;
  const newH=getNewHires(ym),resig=getResignations(ym);
  const pBegHC=hcAtMonth(ppYM).length,pNewH=getNewHires(pYM),pResig=getResignations(pYM),pHCE=begHC.length;
  const curFY=getFY(ym);
  const vc=calcVacancy(endHC,curFY),vac=vc.totalVacancy,approved=vc.totalQuota;
  const pFY=getFY(pYM);
  const pvc=calcVacancy(begHC,pFY),pVac=pvc.totalVacancy,pApproved=pvc.totalQuota;
  const netMoM=hcE-hcB;
  const yoyYM=`${sy-1}-${String(sm).padStart(2,"0")}`;
  const yoyHC=hcAtMonth(yoyYM).length,netYoY=hcE-yoyHC;
  const avgHC=(hcB+hcE)/2;
  const trRate=avgHC>0?((resig/avgHC)*100).toFixed(2):"0.00";
  const fyCount=getFirstYearCount(ym);
  const fyRate=avgHC>0?((fyCount/avgHC)*100).toFixed(2):"0.00";
  const males=endHC.filter(e=>(e.gender||"").toLowerCase()==="male").length;
  const females=endHC.filter(e=>(e.gender||"").toLowerCase()==="female").length;
  const thai=endHC.filter(e=>(e.nationality||"").toLowerCase()==="thai").length;
  const aus=endHC.filter(e=>(e.nationality||"").toLowerCase()==="australian").length;
  const natO=hcE-thai-aus;
  const mLvls=["M1","M2","M3","M4"];
  const mgrs=endHC.filter(e=>mLvls.includes((e.job_level||"").toUpperCase())).length;

  const provData=PROVINCES.map(p=>({name:p,count:endHC.filter(e=>getProv(e)===p).length}))
    .map(p=>({...p,pct:hcE>0?(p.count/hcE*100).toFixed(1):"0.0"}))
    .filter(p=>p.count>0).sort((a,b)=>b.count-a.count);

  const trendM=[];
  for(let m=1;m<=12;m++){
    const ym2=`${sy}-${String(m).padStart(2,"0")}`;
    trendM.push({ym:ym2,mo:MS[m-1],fut:ym2>curYM});
  }
  const provTrend={};
  PROVINCES.forEach(prov=>{
    provTrend[prov]=trendM.map(t=>t.fut?"—":hcAtMonth(t.ym).filter(e=>getProv(e)===prov).length);
  });

  const wb=new ExcelJS.Workbook();wb.creator="Akara HR System";
  const ws=wb.addWorksheet(`Workforce ${MS[sm-1]} ${sy}`,{views:[{showGridLines:false}]});

  const navy={argb:"FF1A365D"},white={argb:"FFFFFFFF"},green={argb:"FF16A34A"},red={argb:"FFDC2626"},
    ltBlue={argb:"FFDBEAFE"},ltGreen={argb:"FFDCFCE7"},ltRed={argb:"FFFEE2E2"},ltGray={argb:"FFF8FAFC"},
    grayTxt={argb:"FF64748B"},gold={argb:"FFD97706"};
  const border={style:"thin",color:{argb:"FFD1D5DB"}};
  const borders={top:border,left:border,bottom:border,right:border};
  const hFill=c=>({type:"pattern",pattern:"solid",fgColor:c});
  const font=(sz,bold,color)=>({name:"Calibri",size:sz,bold,color:color||{argb:"FF1E293B"}});

  const NC=6;
  [6,24,16,16,16,16].forEach((w,i)=>{ws.getColumn(i+1).width=w;});

  // Title
  ws.mergeCells(1,1,1,NC);
  const t1=ws.getCell(1,1);t1.value="AKARA RESOURCES";t1.font=font(18,true,navy);t1.alignment={horizontal:"center",vertical:"middle"};
  ws.getRow(1).height=30;
  ws.mergeCells(2,1,2,NC);
  ws.getCell(2,1).value="WORKFORCE OVERVIEW";ws.getCell(2,1).font=font(13,true,grayTxt);ws.getCell(2,1).alignment={horizontal:"center"};
  ws.mergeCells(3,1,3,NC);
  ws.getCell(3,1).value=`AS OF ${mLbl.toUpperCase()}`;ws.getCell(3,1).font=font(12,true,navy);ws.getCell(3,1).alignment={horizontal:"center"};

  let row=5;
  // Section: Workforce Summary
  ws.mergeCells(row,1,row,NC);
  ws.getCell(row,1).value="WORKFORCE SUMMARY (Month-on-Month)";ws.getCell(row,1).font=font(11,true,white);
  ws.getCell(row,1).fill=hFill(navy);ws.getCell(row,1).border=borders;ws.getRow(row).height=24;row++;

  const sHdr=["","ITEM",pLbl.toUpperCase(),mLbl.toUpperCase(),"CHANGE","CHANGE (%)"];
  sHdr.forEach((h,i)=>{const c=ws.getCell(row,i+1);c.value=h;c.font=font(9,true,grayTxt);c.fill=hFill({argb:"FFEDF2F7"});c.border=borders;c.alignment={horizontal:i<=1?"left":"center"};});
  row++;

  const chgVal=(c,p)=>c-p===0?"—":(c-p>0?`+${c-p}`:`${c-p}`);
  const chgPct=(c,p)=>p===0?"—":`${((c-p)/p*100).toFixed(2)}%`;

  const summaryRows=[
    {icon:"👥",item:"Headcount (Beginning)",prev:pBegHC,cur:hcB,change:"—",pct:"—"},
    {icon:"➕",item:"New Hires",prev:pNewH,cur:newH,change:chgVal(newH,pNewH),pct:chgPct(newH,pNewH)},
    {icon:"➖",item:"Resignations",prev:pResig,cur:resig,change:chgVal(resig,pResig),pct:chgPct(resig,pResig)},
    {icon:"✅",item:"Headcount (Ending)",prev:pHCE,cur:hcE,change:chgVal(hcE,pHCE),pct:chgPct(hcE,pHCE),bold:true},
    {icon:"💼",item:"Vacancy",prev:pApproved>0?pVac:"—",cur:approved>0?vac:"—",change:approved>0&&pApproved>0?chgVal(vac,pVac):"—",pct:approved>0&&pApproved>0?chgPct(vac,pVac):"—"},
  ];
  summaryRows.forEach((sr,ri)=>{
    const isHL=ri===3;
    [sr.icon,sr.item,sr.prev,sr.cur,sr.change,sr.pct].forEach((v,ci)=>{
      const c=ws.getCell(row,ci+1);c.value=v;
      c.font=font(10,isHL||ci===1?true:false,isHL&&ci>=2?navy:undefined);
      c.border=borders;c.alignment={horizontal:ci<=1?"left":"center"};
      if(isHL)c.fill=hFill(ltBlue);
      else if(ri%2===1)c.fill=hFill(ltGray);
    });
    row++;
  });
  row++;

  // KPI Summary
  ws.mergeCells(row,1,row,NC);
  ws.getCell(row,1).value="KEY INDICATORS";ws.getCell(row,1).font=font(11,true,white);
  ws.getCell(row,1).fill=hFill(navy);ws.getCell(row,1).border=borders;ws.getRow(row).height=24;row++;

  const kpiRows=[
    ["Net Change (MoM)",`${netMoM>=0?"+":""}${netMoM}`,`vs. ${MS[pm-1]} ${py}`],
    ["Net Change (YoY)",`${netYoY>=0?"+":""}${netYoY}`,`vs. ${MS[sm-1]} ${sy-1}`],
    ["Vacancy Rate",approved>0?`${((vac/approved)*100).toFixed(2)}%`:"—",""],
    ["Turnover Rate",`${trRate}%`,`${resig} sep / ${Math.round(avgHC)} avg HC`],
    ["First-Year Turnover",`${fyRate}%`,`${fyCount} employees`],
    ["Gender: Male",`${males} (${hcE>0?(males/hcE*100).toFixed(1):"0"}%)`,""],
    ["Gender: Female",`${females} (${hcE>0?(females/hcE*100).toFixed(1):"0"}%)`,""],
    ["Nationality: Thai",`${thai} (${hcE>0?(thai/hcE*100).toFixed(1):"0"}%)`,""],
    ["Nationality: Australian",`${aus} (${hcE>0?(aus/hcE*100).toFixed(1):"0"}%)`,""],
    ["Nationality: Other",`${natO} (${hcE>0?(natO/hcE*100).toFixed(1):"0"}%)`,""],
    ["Management Ratio",`${mgrs} (${hcE>0?((mgrs/hcE)*100).toFixed(1):"0"}%)`,`M-level / total`],
  ];
  kpiRows.forEach((kr,ri)=>{
    ws.getCell(row,1).value="";ws.getCell(row,1).border=borders;
    ws.getCell(row,2).value=kr[0];ws.getCell(row,2).font=font(10,true);ws.getCell(row,2).border=borders;
    ws.mergeCells(row,3,row,4);
    ws.getCell(row,3).value=kr[1];ws.getCell(row,3).font=font(10,true,navy);ws.getCell(row,3).border=borders;ws.getCell(row,3).alignment={horizontal:"center"};
    ws.mergeCells(row,5,row,6);
    ws.getCell(row,5).value=kr[2];ws.getCell(row,5).font=font(9,false,grayTxt);ws.getCell(row,5).border=borders;
    if(ri%2===1)for(let c=1;c<=NC;c++)ws.getCell(row,c).fill=hFill(ltGray);
    row++;
  });
  row++;

  // Province
  ws.mergeCells(row,1,row,NC);
  ws.getCell(row,1).value=`HEADCOUNT BY PROVINCE (as of ${mLbl})`;ws.getCell(row,1).font=font(11,true,white);
  ws.getCell(row,1).fill=hFill(navy);ws.getCell(row,1).border=borders;ws.getRow(row).height=24;row++;
  ["","PROVINCE","","EMPLOYEE","% OF TOTAL",""].forEach((h,i)=>{
    const c=ws.getCell(row,i+1);c.value=h;c.font=font(9,true,grayTxt);c.fill=hFill({argb:"FFEDF2F7"});c.border=borders;
    c.alignment={horizontal:i>=3?"center":"left"};
  });
  row++;
  provData.forEach((p,ri)=>{
    ws.getCell(row,1).value="";ws.getCell(row,1).border=borders;
    ws.mergeCells(row,2,row,3);
    ws.getCell(row,2).value=p.name;ws.getCell(row,2).font=font(10,true);ws.getCell(row,2).border=borders;
    ws.getCell(row,4).value=p.count;ws.getCell(row,4).font=font(10,true,navy);ws.getCell(row,4).border=borders;ws.getCell(row,4).alignment={horizontal:"center"};
    ws.getCell(row,5).value=`${p.pct}%`;ws.getCell(row,5).font=font(10,false);ws.getCell(row,5).border=borders;ws.getCell(row,5).alignment={horizontal:"center"};
    ws.getCell(row,6).value="";ws.getCell(row,6).border=borders;
    if(ri%2===1)for(let c=1;c<=NC;c++)ws.getCell(row,c).fill=hFill(ltGray);
    row++;
  });
  // Total
  ["","GRAND TOTAL","",hcE,"100.0%",""].forEach((v,i)=>{
    const c=ws.getCell(row,i+1);c.value=v;c.font=font(10,true,white);c.fill=hFill(navy);c.border=borders;
    c.alignment={horizontal:i>=3?"center":"left"};
  });
  ws.mergeCells(row,2,row,3);
  row+=2;

  // Province Trend
  const TC=14;
  [6,14,...Array(12).fill(8)].forEach((w,i)=>{if(i+1>ws.columnCount||!ws.getColumn(i+1).width)ws.getColumn(i+1).width=w;else if(w>ws.getColumn(i+1).width)ws.getColumn(i+1).width=w;});

  ws.mergeCells(row,1,row,TC);
  ws.getCell(row,1).value=`HEADCOUNT TREND BY PROVINCE (Calendar Year ${sy})`;ws.getCell(row,1).font=font(11,true,white);
  ws.getCell(row,1).fill=hFill(navy);ws.getCell(row,1).border=borders;ws.getRow(row).height=24;row++;

  ["",""].concat(trendM.map(t=>t.mo.toUpperCase())).forEach((h,i)=>{
    const c=ws.getCell(row,i+1);c.value=h;c.font=font(9,true,trendM[i-2]?.ym===ym?navy:grayTxt);
    c.fill=hFill({argb:"FFEDF2F7"});c.border=borders;c.alignment={horizontal:"center"};
  });
  row++;

  PROVINCES.filter(prov=>provData.find(p=>p.name===prov)).forEach((prov,pi)=>{
    ws.getCell(row,1).value="";ws.getCell(row,1).border=borders;
    ws.getCell(row,2).value=prov;ws.getCell(row,2).font=font(10,true);ws.getCell(row,2).border=borders;ws.getCell(row,2).alignment={horizontal:"left"};
    trendM.forEach((t,mi)=>{
      const v=provTrend[prov][mi];
      const c=ws.getCell(row,mi+3);c.value=v;c.font=font(10,t.ym===ym?true:false,t.fut?grayTxt:t.ym===ym?navy:undefined);
      c.border=borders;c.alignment={horizontal:"center"};
    });
    if(pi%2===1)for(let c=1;c<=TC;c++)ws.getCell(row,c).fill=hFill(ltGray);
    row++;
  });
  // Grand total
  ws.getCell(row,1).value="";ws.getCell(row,1).fill=hFill(navy);ws.getCell(row,1).border=borders;
  ws.getCell(row,2).value="GRAND TOTAL";ws.getCell(row,2).font=font(10,true,white);ws.getCell(row,2).fill=hFill(navy);ws.getCell(row,2).border=borders;
  trendM.forEach((t,mi)=>{
    const total=t.fut?"—":PROVINCES.reduce((s,p)=>{const v=provTrend[p][mi];return s+(typeof v==="number"?v:0);},0);
    const c=ws.getCell(row,mi+3);c.value=total;c.font=font(10,true,white);c.fill=hFill(navy);c.border=borders;c.alignment={horizontal:"center"};
  });

  ws.pageSetup={orientation:"landscape",fitToPage:true,fitToWidth:1,fitToHeight:0,paperSize:9,
    margins:{left:.5,right:.5,top:.5,bottom:.5,header:.3,footer:.3}};

  const buf=await wb.xlsx.writeBuffer();
  const blob=new Blob([buf],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=`Workforce_Overview_${MO[sm-1]}_${sy}.xlsx`;a.click();
  URL.revokeObjectURL(url);
  toast("Export เสร็จสิ้น","success");
}
