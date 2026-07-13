import { supabase } from "./supabase-config.js";
import { allEmployees, allMovements, movYM, esc, toast } from "./app.js";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const GRP = [
  { key:"M", label:"M", levels:["M1","M2","M3","M4"] },
  { key:"S", label:"S", levels:["S1","S2","S3"] },
  { key:"O", label:"O", levels:["O1","O2","O3"] },
];
function grp(jl){ const u=(jl||"").toUpperCase().trim(); for(const g of GRP) if(g.levels.includes(u)) return g.key; return ""; }
function lastWorkYM(dateStr){
  if(!dateStr) return "";
  const d=new Date(dateStr);d.setUTCDate(d.getUTCDate()-1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
}
function hcAtMonth(ym){
  return allEmployees.filter(e=>{
    const jm=(e.join_date||"").substring(0,7);
    if(jm&&jm>ym) return false;
    if(e.end_date){ const lm=lastWorkYM(e.end_date); if(lm<ym) return false; }
    return true;
  });
}

function buildPeriodMonths(mode, num) {
  const yms = [];
  if(mode==="fy"){
    for(let i=0;i<12;i++){
      const mi=(6+i)%12; const yi=i<6?num-1:num;
      yms.push(`${yi}-${String(mi+1).padStart(2,"0")}`);
    }
  } else {
    for(let m=1;m<=12;m++) yms.push(`${num}-${String(m).padStart(2,"0")}`);
  }
  return yms;
}

function buildData(periodYMs) {
  const now=new Date();
  const curYM=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const rows=[];

  for(const ym of periodYMs){
    const mi=Number(ym.split("-")[1])-1;
    const cnt=(list,gk)=>list.filter(e=>grp(e.job_level)===gk).length;

    const movNewC=new Set(allMovements.filter(v=>movYM(v)===ym&&v.type==="New Hire").map(v=>v.emp_code));
    const empNew=allEmployees.filter(e=>(e.join_date||"").substring(0,7)===ym&&!movNewC.has(e.emp_code));
    const allNew=[...allEmployees.filter(e=>movNewC.has(e.emp_code)),...empNew];
    const nG={}; GRP.forEach(g=>{nG[g.key]=cnt(allNew,g.key);}); const nT=allNew.length;

    const movVolC=new Set(allMovements.filter(v=>lastWorkYM(v.date)===ym&&["Resignation","Retirement"].includes(v.type)).map(v=>v.emp_code));
    const empVol=allEmployees.filter(e=>lastWorkYM(e.end_date)===ym&&["Resigned","Retired"].includes(e.status)&&!movVolC.has(e.emp_code));
    const allVol=[...allEmployees.filter(e=>movVolC.has(e.emp_code)),...empVol];
    const vG={}; GRP.forEach(g=>{vG[g.key]=cnt(allVol,g.key);}); const vT=allVol.length;

    const movInvC=new Set(allMovements.filter(v=>lastWorkYM(v.date)===ym&&v.type==="Termination").map(v=>v.emp_code));
    const empInv=allEmployees.filter(e=>lastWorkYM(e.end_date)===ym&&e.status==="Terminated"&&!movInvC.has(e.emp_code));
    const allInv=[...allEmployees.filter(e=>movInvC.has(e.emp_code)),...empInv];
    const iG={}; GRP.forEach(g=>{iG[g.key]=cnt(allInv,g.key);}); const iT=allInv.length;

    const rT=vT+iT;
    const bG={}; GRP.forEach(g=>{bG[g.key]=nG[g.key]-vG[g.key]-iG[g.key];});
    const active=hcAtMonth(ym); const hT=active.length;
    const hG={}; GRP.forEach(g=>{hG[g.key]=cnt(active,g.key);});

    const future=ym>curYM;
    rows.push({ym,month:MONTHS[mi],nT,nG,rT,vT,vG,iT,iG,bG,hT,hG,future});
  }

  // เฉลี่ยถึงเดือนปัจจุบันเท่านั้น (ไม่รวมเดือนอนาคต)
  const activeRows=rows.filter(r=>r.ym<=curYM);
  const mCount=activeRows.length||1;
  const hcVals=activeRows.map(r=>r.hT);
  const avg=hcVals.length?Math.round(hcVals.reduce((s,v)=>s+v,0)/hcVals.length):0;
  const sN=rows.reduce((s,r)=>s+r.nT,0),sR=rows.reduce((s,r)=>s+r.rT,0);
  const sV=rows.reduce((s,r)=>s+r.vT,0),sI=rows.reduce((s,r)=>s+r.iT,0);
  const pct=v=>avg?((v/avg)*100).toFixed(2)+"%":"0.00%";
  const netBal=sN-sR;
  const avgTR=avg&&mCount?((sR/mCount/avg)*100).toFixed(2)+"%":"0.00%";
  return {rows,avg,mCount,sN,sR,sV,sI,netBal,avgTR,trTotal:pct(sR),trVol:pct(sV),trInvol:pct(sI)};
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
.hc-mode-sel{display:flex;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-size:12px;}
.hc-mode-btn{padding:7px 14px;cursor:pointer;background:#fff;border:none;font-weight:500;color:#64748b;transition:all .15s;}
.hc-mode-btn.active{background:#1a365d;color:#fff;font-weight:600;}
</style>`;

export function renderHeadcount() {
  const pg=document.getElementById("pageHeadcount");
  const now=new Date();
  const curY=now.getFullYear();
  let mode="calendar"; // "calendar" or "fy"
  let selNum=curY;

  function getOptions(){
    if(mode==="calendar"){
      const opts=[]; for(let y=curY;y>=curY-5;y--) opts.push({val:y,label:`${y}`}); return opts;
    } else {
      const opts=[];
      for(let y=curY+1;y>=curY-4;y--) opts.push({val:y,label:`FY${y} (Jul ${y-1} - Jun ${y})`});
      return opts;
    }
  }

  function getPeriodLabel(){
    if(mode==="calendar") return `ปี ${selNum} (Jan - Dec)`;
    return `FY${selNum} (Jul ${selNum-1} - Jun ${selNum})`;
  }

  function render(){
    const periodYMs=buildPeriodMonths(mode,selNum);
    const d=buildData(periodYMs);
    const {rows,avg,mCount,sN,sR,sV,sI,netBal,avgTR,trTotal,trVol,trInvol}=d;
    const g=GRP;
    const sum=(fn)=>rows.reduce((s,r)=>s+fn(r),0);
    const dataDate=`Data as of ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()} · Avg. based on ${mCount} month${mCount>1?"s":""}`;
    const opts=getOptions();

    pg.innerHTML=`${CSS}<div class="hc-wrap">
    <div class="page-header" style="margin-bottom:20px;">
      <div><div class="page-heading" style="font-size:24px;font-weight:800;letter-spacing:-.3px;">HEADCOUNT REPORT</div><div class="page-sub">รายงานอัตรากำลังรายเดือน — ${getPeriodLabel()}</div></div>
      <div class="header-actions" style="display:flex;gap:10px;align-items:center;">
        <div class="hc-mode-sel">
          <button class="hc-mode-btn ${mode==="calendar"?"active":""}" onclick="window._hcMode('calendar')">Calendar Year</button>
          <button class="hc-mode-btn ${mode==="fy"?"active":""}" onclick="window._hcMode('fy')">Fiscal Year</button>
        </div>
        <div style="position:relative;">
          <select class="filter-select" style="padding-left:32px;min-width:${mode==="fy"?"220px":"100px"};" onchange="window._hcNum(Number(this.value))">
            ${opts.map(o=>`<option value="${o.val}" ${o.val===selNum?"selected":""}>${o.label}</option>`).join("")}
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
      <div class="hc-kpi-card"><div class="hc-kpi-icon" style="background:#dbeafe;color:#2563eb;">${ICON_HC}</div><div><div class="hc-kpi-label">Avg. Headcount</div><div class="hc-kpi-val" style="color:#1a365d;">${avg}<span class="hc-kpi-unit">คน</span></div></div></div>
      <div class="hc-kpi-card"><div class="hc-kpi-icon" style="background:#dcfce7;color:#16a34a;">${ICON_NEW}</div><div><div class="hc-kpi-label">New Employee</div><div class="hc-kpi-val" style="color:#16a34a;">${sN}<span class="hc-kpi-unit">คน</span></div></div></div>
      <div class="hc-kpi-card"><div class="hc-kpi-icon" style="background:#fee2e2;color:#dc2626;">${ICON_OUT}</div><div><div class="hc-kpi-label">Total Resigned</div><div class="hc-kpi-val" style="color:#dc2626;">${sR}<span class="hc-kpi-unit">คน</span></div></div></div>
      <div class="hc-kpi-card"><div class="hc-kpi-icon" style="background:${netBal>=0?'#dcfce7':'#fee2e2'};color:${netBal>=0?'#16a34a':'#dc2626'};">${ICON_BAL}</div><div><div class="hc-kpi-label">Net Balance</div><div class="hc-kpi-val" style="color:${netBal>=0?'#16a34a':'#dc2626'};">${netBal>=0?"+":""}${netBal}<span class="hc-kpi-unit">คน</span></div></div></div>
      <div class="hc-kpi-card"><div class="hc-kpi-icon" style="background:#fef3c7;color:#d97706;">${ICON_TR}</div><div><div class="hc-kpi-label">Avg. Turnover Rate</div><div class="hc-kpi-val" style="color:#d97706;">${avgTR}</div></div></div>
    </div>

    <div class="hc-tbl-wrap"><div style="overflow-x:auto;">
      <table class="hc-tbl">
        <thead>
          <tr>
            <th rowspan="2" style="text-align:left;padding-left:16px;position:sticky;left:0;z-index:3;background:#1a365d;min-width:100px;">MONTH</th>
            <th colspan="${g.length+1}" class="sep">New Employee</th>
            <th colspan="${g.length+1}" class="sep">Voluntary Resigned</th>
            <th colspan="${g.length+1}" class="sep">Involuntary Resigned</th>
            <th rowspan="2" class="sep">Total<br>Resigned</th>
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
            if(r.future){
              const d="—";const cols=g.length;
              return `<tr style="color:#cbd5e1;">
              <td class="cm" style="color:#94a3b8;">${r.month}</td>
              <td class="sep">${d}</td>${g.map(()=>`<td>${d}</td>`).join("")}
              <td class="sep">${d}</td>${g.map(()=>`<td>${d}</td>`).join("")}
              <td class="sep">${d}</td>${g.map(()=>`<td>${d}</td>`).join("")}
              <td class="sep">${d}</td>
              ${g.map((x,i)=>`<td${i===0?' class="sep"':''}>${d}</td>`).join("")}
              <td class="sep">${d}</td>${g.map(()=>`<td>${d}</td>`).join("")}
              <td class="sep">${d}</td>
            </tr>`;
            }
            const tr=r.hT?((r.rT/r.hT)*100).toFixed(2)+"%":"0.00%";
            return `<tr>
              <td class="cm">${r.month}</td>
              <td class="sep hc-grn">${v(r.nT)}</td>${g.map(x=>`<td>${v(r.nG[x.key])}</td>`).join("")}
              <td class="sep">${v(r.vT)}</td>${g.map(x=>`<td>${v(r.vG[x.key])}</td>`).join("")}
              <td class="sep">${v(r.iT)}</td>${g.map(x=>`<td>${v(r.iG[x.key])}</td>`).join("")}
              <td class="sep hc-red">${v(r.rT)}</td>
              ${g.map((x,i)=>`<td${i===0?' class="sep"':''}>${balC(r.bG[x.key])}</td>`).join("")}
              <td class="sep hc-hc" style="font-weight:700;">${r.hT}</td>${g.map(x=>`<td class="hc-hc">${v(r.hG[x.key])}</td>`).join("")}
              <td class="sep" style="font-weight:500;">${tr}</td>
            </tr>`;
          }).join("")}
          <tr class="tot-row">
            <td class="cm" style="padding-left:16px;">TOTAL</td>
            <td class="sep">${sum(r=>r.nT)}</td>${g.map(x=>`<td>${sum(r=>r.nG[x.key])}</td>`).join("")}
            <td class="sep">${sum(r=>r.vT)}</td>${g.map(x=>`<td>${sum(r=>r.vG[x.key])}</td>`).join("")}
            <td class="sep">${sum(r=>r.iT)}</td>${g.map(x=>`<td>${sum(r=>r.iG[x.key])}</td>`).join("")}
            <td class="sep" style="color:#fca5a5;">${sum(r=>r.rT)}</td>
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
        <div class="hc-bcard-title">Avg. Headcount (${mCount} เดือน)</div>
        <div class="hc-bcard-big">${avg}<span class="hc-bcard-unit">คน</span></div>
      </div>
      <div class="hc-bcard">
        <div style="text-align:center;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#1a365d;margin-bottom:12px;padding-bottom:12px;border-bottom:2px solid #e2e8f0;">Turnover Rate</div>
        <div class="hc-tr-grid">
          <div class="hc-tr-cell"><div class="hc-tr-label">Total Resigned</div><div class="hc-tr-val" style="color:#dc2626;">${trTotal}</div></div>
          <div class="hc-tr-cell"><div class="hc-tr-label">Voluntary Resigned</div><div class="hc-tr-val" style="color:#d97706;">${trVol}</div></div>
          <div class="hc-tr-cell"><div class="hc-tr-label">Involuntary Resigned</div><div class="hc-tr-val" style="color:#7c3aed;">${trInvol}</div></div>
        </div>
      </div>
      <div class="hc-bcard">
        <div class="hc-bcard-title" style="margin-bottom:12px;">Notes</div>
        <div class="hc-notes">
          <div><dt>M</dt> <dd>= ${GRP.find(x=>x.key==="M").levels.join(", ")}</dd></div>
          <div><dt>S</dt> <dd>= ${GRP.find(x=>x.key==="S").levels.join(", ")}</dd></div>
          <div><dt>O</dt> <dd>= ${GRP.find(x=>x.key==="O").levels.join(", ")}</dd></div>
          <div style="margin-top:8px;color:#94a3b8;font-size:11px;">Turnover = Resigned / Avg HC</div>
          <div style="color:#94a3b8;font-size:11px;">Avg TR = Resigned / months / Avg HC</div>
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
  window._hcMode=m=>{ mode=m; const opts=getOptions(); selNum=opts[0].val; render(); };
  window._hcNum=n=>{ selNum=n; render(); };
  window._exportHC=()=>exportExcel(mode,selNum).catch(e=>{console.error(e);toast("Export ผิดพลาด: "+e.message,"error");});
}

async function exportExcel(mode,num){
  if(!window.ExcelJS){toast("กรุณารอโหลด library","error");return;}
  const periodYMs=buildPeriodMonths(mode,num);
  const d=buildData(periodYMs);
  const{rows,avg,mCount,sN,sR,sV,sI,netBal,avgTR,trTotal,trVol,trInvol}=d;
  const g=GRP;
  const label=mode==="fy"?`FY${num}`:`${num}`;
  const periodStr=mode==="fy"?`FY${num} (Jul ${num-1} - Jun ${num})`:`Year ${num} (Jan - Dec)`;
  const now=new Date();
  const dateStr=`${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;

  const wb=new ExcelJS.Workbook();
  wb.creator="Akara HR System";
  const ws=wb.addWorksheet(`Headcount ${label}`,{views:[{showGridLines:false}]});

  const navy={argb:"FF1A365D"},dNavy={argb:"FF0F2440"},white={argb:"FFFFFFFF"},
    ltGray={argb:"FFF8FAFC"},green={argb:"FF0D7C4B"},red={argb:"FFC0392B"},
    ltGreen={argb:"FFF0FDF4"},dGreen={argb:"FF16A34A"},gold={argb:"FFD97706"},
    border={style:"thin",color:{argb:"FFD1D5DB"}};
  const borders={top:border,left:border,bottom:border,right:border};
  const thickL={top:border,left:{style:"medium",color:{argb:"FF94A3B8"}},bottom:border,right:border};

  const totalCols=1+4+4+4+1+3+4+1; // 22 cols (A-V)

  // --- Title rows ---
  ws.mergeCells(1,1,1,totalCols);
  const titleCell=ws.getCell(1,1);
  titleCell.value="AKARA RESOURCES";
  titleCell.font={name:"Calibri",size:18,bold:true,color:navy};
  titleCell.alignment={horizontal:"center",vertical:"middle"};
  ws.getRow(1).height=32;

  ws.mergeCells(2,1,2,totalCols);
  const subCell=ws.getCell(2,1);
  subCell.value=`HEADCOUNT REPORT — ${periodStr}`;
  subCell.font={name:"Calibri",size:12,bold:true,color:{argb:"FF64748B"}};
  subCell.alignment={horizontal:"center",vertical:"middle"};
  ws.getRow(2).height=22;

  ws.mergeCells(3,1,3,totalCols);
  const dateCell=ws.getCell(3,1);
  dateCell.value=`Data as of ${dateStr} · Average based on ${mCount} month${mCount>1?"s":""}`;
  dateCell.font={name:"Calibri",size:9,italic:true,color:{argb:"FF94A3B8"}};
  dateCell.alignment={horizontal:"center"};
  ws.getRow(3).height=18;

  // --- Header row 1 (group headers) row 5 ---
  const HR1=5,HR2=6,DSTART=7;
  ws.getRow(HR1).height=28;
  ws.getRow(HR2).height=22;

  const hdrFont={name:"Calibri",size:9,bold:true,color:white};
  const hdrFill=(c)=>({type:"pattern",pattern:"solid",fgColor:c});
  const hdrAlign={horizontal:"center",vertical:"middle",wrapText:true};

  const groups=[
    {label:"MONTH",start:1,end:1,rowspan:true},
    {label:"New Employee",start:2,end:5,color:navy},
    {label:"Voluntary Resigned",start:6,end:9,color:navy},
    {label:"Involuntary Resigned",start:10,end:13,color:navy},
    {label:"Total\nResigned",start:14,end:14,rowspan:true,color:{argb:"FF7F1D1D"}},
    {label:"Balance (In - Out)",start:15,end:17,color:navy},
    {label:"Headcount (End of Month)",start:18,end:21,color:{argb:"FF14532D"}},
    {label:"Turnover\nRate",start:22,end:22,rowspan:true,color:navy},
  ];

  groups.forEach(gx=>{
    const c=gx.color||navy;
    if(gx.rowspan){
      ws.mergeCells(HR1,gx.start,HR2,gx.end);
      const cell=ws.getCell(HR1,gx.start);
      cell.value=gx.label;cell.font=hdrFont;cell.fill=hdrFill(c);cell.alignment=hdrAlign;cell.border=borders;
    } else {
      ws.mergeCells(HR1,gx.start,HR1,gx.end);
      const cell=ws.getCell(HR1,gx.start);
      cell.value=gx.label;cell.font=hdrFont;cell.fill=hdrFill(c);cell.alignment=hdrAlign;cell.border=borders;
      const subs=gx.start===15?g.map(x=>x.label):["Total",...g.map(x=>x.label)];
      subs.forEach((s,i)=>{
        const sc=ws.getCell(HR2,gx.start+i);
        sc.value=s;sc.font={name:"Calibri",size:8.5,bold:true,color:{argb:"FFCBD5E1"}};
        sc.fill=hdrFill({argb:"FF234170"});sc.alignment=hdrAlign;sc.border=borders;
      });
    }
  });

  // --- Data rows ---
  const activeRows=rows.filter(r=>!r.future);
  rows.forEach((r,ri)=>{
    const row=ws.getRow(DSTART+ri);
    row.height=22;
    const isEven=ri%2===1;
    const bgFill=isEven?hdrFill(ltGray):hdrFill(white);
    const hcFill=hdrFill(ltGreen);

    const vals=[r.month,
      r.nT,...g.map(x=>r.nG[x.key]),
      r.vT,...g.map(x=>r.vG[x.key]),
      r.iT,...g.map(x=>r.iG[x.key]),
      r.rT,
      ...g.map(x=>r.bG[x.key]),
      r.hT,...g.map(x=>r.hG[x.key]),
      r.hT?(r.rT/r.hT*100):0
    ];

    vals.forEach((val,ci)=>{
      const cell=ws.getCell(DSTART+ri,ci+1);
      if(r.future){
        cell.value="—";
        cell.font={name:"Calibri",size:10,color:{argb:"FFCBD5E1"}};
        cell.fill=bgFill;cell.alignment={horizontal:"center",vertical:"middle"};cell.border=borders;
        if(ci===0){cell.alignment={horizontal:"left",vertical:"middle"};cell.font={name:"Calibri",size:10,color:{argb:"FF94A3B8"}};}
        return;
      }
      cell.border=borders;
      cell.alignment={horizontal:ci===0?"left":"center",vertical:"middle"};
      const isHC=ci>=17&&ci<=20;
      cell.fill=isHC?hcFill:bgFill;

      if(ci===0){
        cell.value=val;cell.font={name:"Calibri",size:10,bold:true,color:{argb:"FF1E293B"}};
      } else if(ci===vals.length-1){
        cell.value=val/100;cell.numFmt="0.00%";cell.font={name:"Calibri",size:10};
      } else if(ci===13){
        cell.value=val;cell.font={name:"Calibri",size:10,bold:true,color:red};
      } else if(ci===1){
        cell.value=val;cell.font={name:"Calibri",size:10,bold:true,color:dGreen};
      } else if(ci>=14&&ci<=16){
        cell.value=val;
        cell.font={name:"Calibri",size:10,bold:true,color:val>0?dGreen:val<0?red:{argb:"FF1E293B"}};
      } else if(ci===17){
        cell.value=val;cell.font={name:"Calibri",size:10,bold:true,color:{argb:"FF14532D"}};
      } else {
        cell.value=val;cell.font={name:"Calibri",size:10};
      }
    });
  });

  // --- TOTAL row ---
  const totRow=DSTART+12;
  const totR=ws.getRow(totRow);
  totR.height=26;
  const sum=fn=>rows.filter(r=>!r.future).reduce((s,r)=>s+fn(r),0);
  const totVals=["TOTAL (YTD)",
    sum(r=>r.nT),...g.map(x=>sum(r=>r.nG[x.key])),
    sum(r=>r.vT),...g.map(x=>sum(r=>r.vG[x.key])),
    sum(r=>r.iT),...g.map(x=>sum(r=>r.iG[x.key])),
    sum(r=>r.rT),
    ...g.map(x=>sum(r=>r.bG[x.key])),
    "","","","",""
  ];
  totVals.forEach((val,ci)=>{
    const cell=ws.getCell(totRow,ci+1);
    cell.fill=hdrFill(navy);cell.border=borders;
    cell.alignment={horizontal:ci===0?"left":"center",vertical:"middle"};
    if(ci===0){cell.font={name:"Calibri",size:10,bold:true,color:white};cell.value=val;return;}
    if(val===""){cell.value="";cell.font={name:"Calibri",size:10,color:white};return;}
    cell.value=val;
    if(ci===13) cell.font={name:"Calibri",size:10,bold:true,color:{argb:"FFFCA5A5"}};
    else if(ci>=14&&ci<=16) cell.font={name:"Calibri",size:10,bold:true,color:val>0?{argb:"FF6EE7B7"}:val<0?{argb:"FFFCA5A5"}:white};
    else cell.font={name:"Calibri",size:10,bold:true,color:white};
  });

  // --- Summary section ---
  const SR=totRow+2;
  const balFillColor=netBal>=0?{argb:"FFDCFCE7"}:{argb:"FFFEE2E2"};

  // Avg Headcount box
  ws.mergeCells(SR,1,SR+2,5);
  const avgCell=ws.getCell(SR,1);
  avgCell.value=`AVG. HEADCOUNT (${mCount} เดือน):  ${avg} คน`;
  avgCell.font={name:"Calibri",size:14,bold:true,color:navy};
  avgCell.alignment={horizontal:"center",vertical:"middle"};
  avgCell.fill=hdrFill({argb:"FFDBEAFE"});
  avgCell.border=borders;

  // Net Balance box
  ws.mergeCells(SR,6,SR+2,9);
  const balCell=ws.getCell(SR,6);
  balCell.value=`NET BALANCE:  ${netBal>=0?"+":""}${netBal} คน  (New ${sN} - Resigned ${sR})`;
  balCell.font={name:"Calibri",size:11,bold:true,color:netBal>=0?dGreen:red};
  balCell.alignment={horizontal:"center",vertical:"middle",wrapText:true};
  balCell.fill=hdrFill(balFillColor);
  balCell.border=borders;

  // Turnover Rate section
  ws.mergeCells(SR,10,SR,17);
  const trTitle=ws.getCell(SR,10);
  trTitle.value="TURNOVER RATE (YTD)";
  trTitle.font={name:"Calibri",size:10,bold:true,color:navy};
  trTitle.alignment={horizontal:"center",vertical:"middle"};
  trTitle.border=borders;

  const trLabels=["Total Resigned","Voluntary","Involuntary","Avg. Monthly"];
  const trValArr=[trTotal,trVol,trInvol,avgTR];
  const trColors=[red,gold,{argb:"FF7C3AED"},navy];
  trLabels.forEach((lbl,i)=>{
    const col=10+i*2;
    ws.mergeCells(SR+1,col,SR+1,col+1);
    const lc=ws.getCell(SR+1,col);
    lc.value=lbl;lc.font={name:"Calibri",size:8.5,bold:true,color:{argb:"FF64748B"}};
    lc.alignment={horizontal:"center",vertical:"middle"};lc.border=borders;

    ws.mergeCells(SR+2,col,SR+2,col+1);
    const vc=ws.getCell(SR+2,col);
    vc.value=trValArr[i];vc.font={name:"Calibri",size:14,bold:true,color:trColors[i]};
    vc.alignment={horizontal:"center",vertical:"middle"};vc.border=borders;
  });

  // Notes
  ws.mergeCells(SR,18,SR,totalCols);
  const notesTitle=ws.getCell(SR,18);
  notesTitle.value="NOTES";notesTitle.font={name:"Calibri",size:9,bold:true,color:{argb:"FF64748B"}};
  notesTitle.alignment={horizontal:"left",vertical:"middle"};notesTitle.border=borders;

  ws.mergeCells(SR+1,18,SR+1,totalCols);
  const noteL1=ws.getCell(SR+1,18);
  noteL1.value="M = M1-M4  |  S = S1-S3  |  O = O1-O3";
  noteL1.font={name:"Calibri",size:8.5,color:{argb:"FF64748B"}};
  noteL1.alignment={horizontal:"left",vertical:"middle"};noteL1.border=borders;

  ws.mergeCells(SR+2,18,SR+2,totalCols);
  const noteL2=ws.getCell(SR+2,18);
  noteL2.value="Voluntary = Resignation + Retirement  |  Involuntary = Termination  |  Turnover = Resigned ÷ Avg HC × 100";
  noteL2.font={name:"Calibri",size:8.5,color:{argb:"FF64748B"}};
  noteL2.alignment={horizontal:"left",vertical:"middle",wrapText:true};noteL2.border=borders;

  // --- Column widths ---
  ws.getColumn(1).width=14;
  for(let c=2;c<=totalCols;c++) ws.getColumn(c).width=9;
  ws.getColumn(14).width=10;
  ws.getColumn(17).width=10;
  ws.getColumn(22).width=11;

  // --- Print setup ---
  ws.pageSetup={orientation:"landscape",fitToPage:true,fitToWidth:1,fitToHeight:0,
    paperSize:9,margins:{left:.4,right:.4,top:.5,bottom:.5,header:.3,footer:.3}};

  // --- Generate & download ---
  const buf=await wb.xlsx.writeBuffer();
  const blob=new Blob([buf],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=`Headcount_Report_${label}.xlsx`;a.click();
  URL.revokeObjectURL(url);
  toast("Export เสร็จสิ้น","success");
}
