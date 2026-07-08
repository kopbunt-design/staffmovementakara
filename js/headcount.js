import { supabase } from "./supabase-config.js";
import { allEmployees, allMovements, movYM, esc, toast } from "./app.js";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const GRP = [
  { key:"M", label:"M", levels:["M1","M2","M3","M4"] },
  { key:"S", label:"S", levels:["S1","S2","S3"] },
  { key:"O", label:"O", levels:["O1","O2","O3"] },
];
function grp(jl){ const u=(jl||"").toUpperCase().trim(); for(const g of GRP) if(g.levels.includes(u)) return g.key; return ""; }

function buildYearData(year) {
  const rows=[];
  const prevYM=`${year-1}-12`;
  const initAll=allEmployees.filter(e=>{
    const jm=(e.join_date||"").substring(0,7),em=(e.end_date||"").substring(0,7);
    if(jm&&jm>prevYM) return false; if(em&&em<=prevYM) return false; return true;
  });
  const running={}; GRP.forEach(g=>{running[g.key]=initAll.filter(e=>grp(e.job_level)===g.key).length;});
  running._oth=initAll.filter(e=>!grp(e.job_level)).length;

  for(let m=0;m<12;m++){
    const ym=`${year}-${String(m+1).padStart(2,"0")}`;
    const cnt=(list,gk)=>list.filter(e=>grp(e.job_level)===gk).length;
    const movNewC=new Set(allMovements.filter(v=>movYM(v)===ym&&v.type==="New Hire").map(v=>v.emp_code));
    const empNew=allEmployees.filter(e=>(e.join_date||"").substring(0,7)===ym&&!movNewC.has(e.emp_code));
    const allNew=[...allEmployees.filter(e=>movNewC.has(e.emp_code)),...empNew];
    const nG={}; GRP.forEach(g=>{nG[g.key]=cnt(allNew,g.key);}); const nT=allNew.length;

    const movVolC=new Set(allMovements.filter(v=>movYM(v)===ym&&["Resignation","Retirement"].includes(v.type)).map(v=>v.emp_code));
    const empVol=allEmployees.filter(e=>(e.end_date||"").substring(0,7)===ym&&["Resigned","Retired"].includes(e.status)&&!movVolC.has(e.emp_code));
    const allVol=[...allEmployees.filter(e=>movVolC.has(e.emp_code)),...empVol];
    const vG={}; GRP.forEach(g=>{vG[g.key]=cnt(allVol,g.key);}); const vT=allVol.length;

    const movInvC=new Set(allMovements.filter(v=>movYM(v)===ym&&v.type==="Termination").map(v=>v.emp_code));
    const empInv=allEmployees.filter(e=>(e.end_date||"").substring(0,7)===ym&&e.status==="Terminated"&&!movInvC.has(e.emp_code));
    const allInv=[...allEmployees.filter(e=>movInvC.has(e.emp_code)),...empInv];
    const iG={}; GRP.forEach(g=>{iG[g.key]=cnt(allInv,g.key);}); const iT=allInv.length;

    const rT=vT+iT;
    const bG={}; GRP.forEach(g=>{bG[g.key]=nG[g.key]-vG[g.key]-iG[g.key];});
    GRP.forEach(g=>{running[g.key]+=bG[g.key];});
    running._oth+=(nT-rT)-GRP.reduce((s,g)=>s+bG[g.key],0);
    const hT=Object.values(running).reduce((s,v)=>s+v,0);
    rows.push({month:MONTHS[m],nT,nG,rT,vT,vG,iT,iG,bG,hT,hG:{...running}});
  }
  const hcVals=rows.map(r=>r.hT);
  const avg=hcVals.length?Math.round(hcVals.reduce((s,v)=>s+v,0)/hcVals.length):0;
  const sN=rows.reduce((s,r)=>s+r.nT,0),sR=rows.reduce((s,r)=>s+r.rT,0);
  const sV=rows.reduce((s,r)=>s+r.vT,0),sI=rows.reduce((s,r)=>s+r.iT,0);
  const pct=v=>avg?((v/avg)*100).toFixed(2)+"%":"0.00%";
  const netBal=sN-sR;
  const avgTR=avg?((sR/avg/12)*100).toFixed(2)+"%":"0.00%";
  return {rows,avg,sN,sR,sV,sI,netBal,avgTR,trTotal:pct(sR),trVol:pct(sV),trInvol:pct(sI)};
}

const v=x=>x===0?"0":x;
const balC=x=>{if(x>0)return`<span style="color:#0D7C4B;font-weight:600;">+${x}</span>`;if(x<0)return`<span style="color:#C0392B;font-weight:600;">${x}</span>`;return"0";};

const ICON_HC=`<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
const ICON_NEW=`<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>`;
const ICON_OUT=`<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/></svg>`;
const ICON_BAL=`<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20V4m0 0l-4 4m4-4l4 4"/><path d="M6 12h12"/></svg>`;
const ICON_TR=`<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>`;

const CSS=`<style>
.hc-wrap{font-family:inherit;}
.hc-kpi{display:grid;grid-template-columns:repeat(5,1fr);gap:16px;margin-bottom:24px;}
@media(max-width:1100px){.hc-kpi{grid-template-columns:repeat(3,1fr);}}
@media(max-width:700px){.hc-kpi{grid-template-columns:repeat(2,1fr);}}
.hc-kpi-card{display:flex;align-items:center;gap:14px;padding:18px 20px;background:#fff;border-radius:12px;border:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(0,0,0,.04);}
.hc-kpi-icon{width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.hc-kpi-label{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:2px;}
.hc-kpi-val{font-size:26px;font-weight:800;line-height:1.1;}
.hc-kpi-unit{font-size:13px;font-weight:400;color:#94a3b8;margin-left:4px;}

.hc-tbl-wrap{background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04);}
.hc-tbl{width:100%;border-collapse:collapse;font-size:12.5px;white-space:nowrap;}
.hc-tbl th,.hc-tbl td{padding:8px 10px;text-align:center;}
.hc-tbl thead tr:first-child th{background:#1a365d;color:#fff;font-weight:600;font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;border-bottom:none;}
.hc-tbl thead tr:last-child th{background:#234170;color:#cbd5e1;font-weight:500;font-size:10.5px;border-bottom:2px solid #e2e8f0;}
.hc-tbl tbody tr{border-bottom:1px solid #f1f5f9;}
.hc-tbl tbody tr:nth-child(even){background:#f8fafc;}
.hc-tbl tbody tr:hover{background:#eff6ff;}
.hc-tbl .cm{text-align:left;font-weight:600;color:#1e293b;padding-left:16px;min-width:100px;position:sticky;left:0;z-index:1;background:inherit;}
.hc-tbl tbody tr:nth-child(even) .cm{background:#f8fafc;}
.hc-tbl tbody tr:hover .cm{background:#eff6ff;}
.hc-tbl .sep{border-left:2px solid #e2e8f0;}
.hc-tbl thead .sep{border-left:2px solid rgba(255,255,255,.2);}
.hc-tbl .tot-row td{background:#1a365d!important;color:#fff;font-weight:700;border:none;}
.hc-tbl .tot-row .cm{background:#1a365d!important;color:#fff;}
.hc-tbl .tot-row .pos{color:#6ee7b7!important;} .hc-tbl .tot-row .neg{color:#fca5a5!important;}
.hc-red{color:#C0392B;font-weight:700;}
.hc-grn{color:#0D7C4B;font-weight:600;}
.hc-hc{background:#f0fdf4!important;font-weight:600;color:#14532d;}
.hc-tbl tbody tr:hover .hc-hc{background:#dcfce7!important;}

.hc-bottom{display:grid;grid-template-columns:240px 1fr 280px;gap:16px;margin-top:20px;}
@media(max-width:900px){.hc-bottom{grid-template-columns:1fr;}}
.hc-bcard{background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.04);}
.hc-bcard-title{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:8px;}
.hc-bcard-big{font-size:42px;font-weight:800;color:#1a365d;line-height:1;}
.hc-bcard-unit{font-size:15px;font-weight:400;color:#94a3b8;margin-left:4px;}
.hc-tr-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:0;text-align:center;}
.hc-tr-cell{padding:16px 12px;}
.hc-tr-cell+.hc-tr-cell{border-left:1px solid #e2e8f0;}
.hc-tr-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.3px;color:#64748b;margin-bottom:6px;}
.hc-tr-val{font-size:22px;font-weight:800;}
.hc-notes dt{font-weight:700;color:#1e293b;display:inline;}
.hc-notes dd{display:inline;margin:0 0 0 4px;color:#64748b;}
.hc-notes div{margin-bottom:4px;font-size:12.5px;}
.hc-footer{margin-top:16px;font-size:11px;color:#94a3b8;display:flex;align-items:center;gap:6px;}
</style>`;

export function renderHeadcount() {
  const pg=document.getElementById("pageHeadcount");
  const curY=new Date().getFullYear();
  const years=[]; for(let y=curY;y>=curY-5;y--) years.push(y);
  let selYear=curY;

  function render(){
    const d=buildYearData(selYear);
    const {rows,avg,sN,sR,sV,sI,netBal,avgTR,trTotal,trVol,trInvol}=d;
    const g=GRP;
    const sum=(fn)=>rows.reduce((s,r)=>s+fn(r),0);
    const now=new Date();
    const dataDate=`Data as of ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;

    pg.innerHTML=`${CSS}<div class="hc-wrap">
    <div class="page-header" style="margin-bottom:20px;">
      <div><div class="page-heading" style="font-size:24px;font-weight:800;letter-spacing:-.3px;">HEADCOUNT REPORT</div><div class="page-sub">รายงานอัตรากำลังรายเดือน — ปี ${selYear}</div></div>
      <div class="header-actions" style="display:flex;gap:10px;align-items:center;">
        <div style="position:relative;">
          <select class="filter-select" style="padding-left:32px;min-width:120px;" onchange="window._hcYear(Number(this.value))">
            ${years.map(y=>`<option value="${y}" ${y===selYear?"selected":""}>${y}</option>`).join("")}
          </select>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);pointer-events:none;"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
        <button class="btn btn-primary" onclick="window._exportHC()" style="gap:6px;display:flex;align-items:center;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export Excel
        </button>
      </div>
    </div>

    <div class="hc-kpi">
      <div class="hc-kpi-card"><div class="hc-kpi-icon" style="background:#dbeafe;color:#2563eb;">${ICON_HC}</div><div><div class="hc-kpi-label">Avg. Headcount (YTD)</div><div class="hc-kpi-val" style="color:#1a365d;">${avg}<span class="hc-kpi-unit">คน</span></div></div></div>
      <div class="hc-kpi-card"><div class="hc-kpi-icon" style="background:#dcfce7;color:#16a34a;">${ICON_NEW}</div><div><div class="hc-kpi-label">New Employee (YTD)</div><div class="hc-kpi-val" style="color:#16a34a;">${sN}<span class="hc-kpi-unit">คน</span></div></div></div>
      <div class="hc-kpi-card"><div class="hc-kpi-icon" style="background:#fee2e2;color:#dc2626;">${ICON_OUT}</div><div><div class="hc-kpi-label">Total Resigned (YTD)</div><div class="hc-kpi-val" style="color:#dc2626;">${sR}<span class="hc-kpi-unit">คน</span></div></div></div>
      <div class="hc-kpi-card"><div class="hc-kpi-icon" style="background:${netBal>=0?'#dcfce7':'#fee2e2'};color:${netBal>=0?'#16a34a':'#dc2626'};">${ICON_BAL}</div><div><div class="hc-kpi-label">Net Balance (YTD)</div><div class="hc-kpi-val" style="color:${netBal>=0?'#16a34a':'#dc2626'};">${netBal>=0?"+":""}${netBal}<span class="hc-kpi-unit">คน</span></div></div></div>
      <div class="hc-kpi-card"><div class="hc-kpi-icon" style="background:#fef3c7;color:#d97706;">${ICON_TR}</div><div><div class="hc-kpi-label">Avg. Turnover Rate (YTD)</div><div class="hc-kpi-val" style="color:#d97706;">${avgTR}</div></div></div>
    </div>

    <div class="hc-tbl-wrap"><div style="overflow-x:auto;">
      <table class="hc-tbl">
        <thead>
          <tr>
            <th rowspan="2" style="text-align:left;padding-left:16px;position:sticky;left:0;z-index:3;background:#1a365d;min-width:100px;">MONTH</th>
            <th colspan="${g.length+1}" class="sep">New Employee</th>
            <th rowspan="2" class="sep">Total<br>Resigned</th>
            <th colspan="${g.length+1}" class="sep">Voluntary Resigned</th>
            <th colspan="${g.length+1}" class="sep">Involuntary Resigned</th>
            <th colspan="${g.length}" class="sep">Balance (In - Out)</th>
            <th colspan="${g.length+1}" class="sep">Headcount (End of Month)</th>
            <th rowspan="2" class="sep">Turnover<br>Rate<br><span style="font-weight:400;font-size:9px;">(Monthly)</span></th>
          </tr>
          <tr>
            <th class="sep">Total</th>${g.map(x=>`<th>${x.label}</th>`).join("")}
            <th class="sep">Total</th>${g.map(x=>`<th>${x.label}</th>`).join("")}
            <th class="sep">Total</th>${g.map(x=>`<th>${x.label}</th>`).join("")}
            ${g.map((x,i)=>`<th${i===0?' class="sep"':''}>${x.label}</th>`).join("")}
            <th class="sep">Total</th>${g.map(x=>`<th>${x.label}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows.map(r=>{
            const tr=r.hT?((r.rT/r.hT)*100).toFixed(2)+"%":"0.00%";
            return `<tr>
              <td class="cm">${r.month}</td>
              <td class="sep hc-grn">${v(r.nT)}</td>${g.map(x=>`<td>${v(r.nG[x.key])}</td>`).join("")}
              <td class="sep hc-red">${v(r.rT)}</td>
              <td class="sep">${v(r.vT)}</td>${g.map(x=>`<td>${v(r.vG[x.key])}</td>`).join("")}
              <td class="sep">${v(r.iT)}</td>${g.map(x=>`<td>${v(r.iG[x.key])}</td>`).join("")}
              ${g.map((x,i)=>`<td${i===0?' class="sep"':''}>${balC(r.bG[x.key])}</td>`).join("")}
              <td class="sep hc-hc" style="font-weight:700;">${r.hT}</td>${g.map(x=>`<td class="hc-hc">${v(r.hG[x.key])}</td>`).join("")}
              <td class="sep" style="font-weight:500;">${tr}</td>
            </tr>`;
          }).join("")}
          <tr class="tot-row">
            <td class="cm" style="padding-left:16px;">TOTAL (YTD)</td>
            <td class="sep">${sum(r=>r.nT)}</td>${g.map(x=>`<td>${sum(r=>r.nG[x.key])}</td>`).join("")}
            <td class="sep">${sum(r=>r.rT)}</td>
            <td class="sep">${sum(r=>r.vT)}</td>${g.map(x=>`<td>${sum(r=>r.vG[x.key])}</td>`).join("")}
            <td class="sep">${sum(r=>r.iT)}</td>${g.map(x=>`<td>${sum(r=>r.iG[x.key])}</td>`).join("")}
            ${g.map((x,i)=>{const val=sum(r=>r.bG[x.key]);return `<td${i===0?' class="sep"':''} class="${val>0?'pos':val<0?'neg':''}">${val>0?"+":""}${val}</td>`;}).join("")}
            <td class="sep"></td>${g.map(()=>`<td></td>`).join("")}
            <td class="sep">—</td>
          </tr>
        </tbody>
      </table>
    </div></div>

    <div class="hc-bottom">
      <div class="hc-bcard" style="display:flex;flex-direction:column;align-items:center;justify-content:center;">
        <div style="width:64px;height:64px;border-radius:50%;background:#dbeafe;color:#2563eb;display:flex;align-items:center;justify-content:center;margin-bottom:12px;">${ICON_HC}</div>
        <div class="hc-bcard-title">Avg. Headcount (YTD)</div>
        <div class="hc-bcard-big">${avg}<span class="hc-bcard-unit">คน</span></div>
      </div>
      <div class="hc-bcard">
        <div style="text-align:center;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#1a365d;margin-bottom:12px;padding-bottom:12px;border-bottom:2px solid #e2e8f0;">Turnover Rate (YTD)</div>
        <div class="hc-tr-grid">
          <div class="hc-tr-cell"><div class="hc-tr-label">Total Resigned</div><div class="hc-tr-val" style="color:#dc2626;">${trTotal}</div></div>
          <div class="hc-tr-cell"><div class="hc-tr-label">Voluntary Resigned</div><div class="hc-tr-val" style="color:#d97706;">${trVol}</div></div>
          <div class="hc-tr-cell"><div class="hc-tr-label">Involuntary Resigned</div><div class="hc-tr-val" style="color:#7c3aed;">${trInvol}</div></div>
        </div>
      </div>
      <div class="hc-bcard">
        <div class="hc-bcard-title" style="margin-bottom:12px;">Notes</div>
        <div class="hc-notes">
          <div><dt>M</dt> <dd>= ${g.map(x=>x.levels.join(", ")).find((_,i)=>GRP[i].key==="M")}</dd></div>
          <div><dt>S</dt> <dd>= ${g.map(x=>x.levels.join(", ")).find((_,i)=>GRP[i].key==="S")}</dd></div>
          <div><dt>O</dt> <dd>= ${g.map(x=>x.levels.join(", ")).find((_,i)=>GRP[i].key==="O")}</dd></div>
        </div>
      </div>
    </div>

    <div class="hc-footer">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      ${dataDate}
    </div>
    </div>`;
  }

  render();
  window._hcYear=y=>{selYear=y;render();};
  window._exportHC=()=>exportExcel(selYear);
}

function exportExcel(year){
  if(!window.XLSX){toast("กรุณารอโหลด library","error");return;}
  const d=buildYearData(year); const{rows,avg,trTotal,trVol,trInvol}=d; const g=GRP;
  const h1=[year,"New Employee",...g.slice(1).map(()=>""),"","Total Resigned",
    "Voluntary Resigned",...g.slice(1).map(()=>""),"","Involuntary Resigned",...g.slice(1).map(()=>""),"",
    "Balance",...g.slice(1).map(()=>""),"Head Count",...g.slice(1).map(()=>""),"","Turnover Rate"];
  const h2=["","Total",...g.map(x=>x.label),"","Total",...g.map(x=>x.label),"Total",...g.map(x=>x.label),
    ...g.map(x=>x.label),"Total",...g.map(x=>x.label),""];
  const data=rows.map(r=>{const tr=r.hT?((r.rT/r.hT)*100).toFixed(2)+"%":"0.00%";
    return[r.month,r.nT,...g.map(x=>r.nG[x.key]),r.rT,r.vT,...g.map(x=>r.vG[x.key]),r.iT,...g.map(x=>r.iG[x.key]),
      ...g.map(x=>r.bG[x.key]),r.hT,...g.map(x=>r.hG[x.key]),tr];});
  const totR=["Total (YTD)",rows.reduce((s,r)=>s+r.nT,0),...g.map(x=>rows.reduce((s,r)=>s+r.nG[x.key],0)),
    rows.reduce((s,r)=>s+r.rT,0),rows.reduce((s,r)=>s+r.vT,0),...g.map(x=>rows.reduce((s,r)=>s+r.vG[x.key],0)),
    rows.reduce((s,r)=>s+r.iT,0),...g.map(x=>rows.reduce((s,r)=>s+r.iG[x.key],0)),
    ...g.map(x=>rows.reduce((s,r)=>s+r.bG[x.key],0)),"",...g.map(()=>""),""];
  const avgR=["Average of Head Count",...Array(h2.length-3).fill(""),avg,...g.map(()=>""),""];
  const trR=["Turnover Rate",...Array(g.length).fill(""),"",trTotal,trVol,...g.map(()=>""),trInvol,...g.map(()=>""),
    ...g.map(()=>""),"",...g.map(()=>""),""];
  const ws=window.XLSX.utils.aoa_to_sheet([h1,h2,...data,totR,avgR,trR]);
  ws["!cols"]=h1.map((_,i)=>({wch:i===0?16:10}));
  const wb=window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb,ws,`Headcount ${year}`);
  window.XLSX.writeFile(wb,`Headcount_Report_${year}.xlsx`);
  toast("Export เสร็จสิ้น","success");
}
