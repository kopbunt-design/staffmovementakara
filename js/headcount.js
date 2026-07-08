import { supabase } from "./supabase-config.js";
import { allEmployees, allMovements, movYM, esc, toast } from "./app.js";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTHS_TH = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const GRP = [
  { key:"M", label:"M", levels:["M1","M2","M3","M4"] },
  { key:"S", label:"S", levels:["S1","S2","S3"] },
  { key:"O", label:"O", levels:["O1","O2","O3"] },
];

function grp(jl) {
  const u = (jl||"").toUpperCase().trim();
  for(const g of GRP) if(g.levels.includes(u)) return g.key;
  return "";
}

function buildYearData(year) {
  const rows = [];
  const prevYM = `${year-1}-12`;
  const initAll = allEmployees.filter(e=>{
    const jm=(e.join_date||"").substring(0,7), em=(e.end_date||"").substring(0,7);
    if(jm && jm>prevYM) return false;
    if(em && em<=prevYM) return false;
    return true;
  });
  const running = {};
  GRP.forEach(g=>{ running[g.key]=initAll.filter(e=>grp(e.job_level)===g.key).length; });
  running._oth=initAll.filter(e=>!grp(e.job_level)).length;

  for(let m=0;m<12;m++){
    const ym=`${year}-${String(m+1).padStart(2,"0")}`;
    const count=(list,gk)=>list.filter(e=>grp(e.job_level)===gk).length;

    const movNewC=new Set(allMovements.filter(v=>movYM(v)===ym&&v.type==="New Hire").map(v=>v.emp_code));
    const empNew=allEmployees.filter(e=>(e.join_date||"").substring(0,7)===ym&&!movNewC.has(e.emp_code));
    const allNew=[...allEmployees.filter(e=>movNewC.has(e.emp_code)),...empNew];
    const nG={}; GRP.forEach(g=>{nG[g.key]=count(allNew,g.key);}); const nT=allNew.length;

    const movVolC=new Set(allMovements.filter(v=>movYM(v)===ym&&["Resignation","Retirement"].includes(v.type)).map(v=>v.emp_code));
    const empVol=allEmployees.filter(e=>(e.end_date||"").substring(0,7)===ym&&["Resigned","Retired"].includes(e.status)&&!movVolC.has(e.emp_code));
    const allVol=[...allEmployees.filter(e=>movVolC.has(e.emp_code)),...empVol];
    const vG={}; GRP.forEach(g=>{vG[g.key]=count(allVol,g.key);}); const vT=allVol.length;

    const movInvC=new Set(allMovements.filter(v=>movYM(v)===ym&&v.type==="Termination").map(v=>v.emp_code));
    const empInv=allEmployees.filter(e=>(e.end_date||"").substring(0,7)===ym&&e.status==="Terminated"&&!movInvC.has(e.emp_code));
    const allInv=[...allEmployees.filter(e=>movInvC.has(e.emp_code)),...empInv];
    const iG={}; GRP.forEach(g=>{iG[g.key]=count(allInv,g.key);}); const iT=allInv.length;

    const rT=vT+iT;
    const bG={}; GRP.forEach(g=>{bG[g.key]=nG[g.key]-vG[g.key]-iG[g.key];});
    GRP.forEach(g=>{running[g.key]+=bG[g.key];});
    running._oth+=(nT-rT)-GRP.reduce((s,g)=>s+bG[g.key],0);
    const hT=Object.values(running).reduce((s,v)=>s+v,0);

    rows.push({month:MONTHS[m],monthTH:MONTHS_TH[m],nT,nG,rT,vT,vG,iT,iG,bG,hT,hG:{...running}});
  }

  const hcVals=rows.map(r=>r.hT);
  const avg=hcVals.length?Math.round(hcVals.reduce((s,v)=>s+v,0)/hcVals.length):0;
  const sumR=rows.reduce((s,r)=>s+r.rT,0);
  const sumV=rows.reduce((s,r)=>s+r.vT,0);
  const sumI=rows.reduce((s,r)=>s+r.iT,0);
  const pct=v=>avg?((v/avg)*100).toFixed(2)+"%":"0.00%";
  return {rows,avg,trTotal:pct(sumR),trVol:pct(sumV),trInvol:pct(sumI)};
}

const n=v=>v===0?"0":v; // แสดง 0 ไม่ซ่อน
const bal=v=>`<span style="color:${v>0?'#0D7C4B':v<0?'#C0392B':'#64748b'};font-weight:${v!==0?600:400};">${v>0?"+"+v:v}</span>`;
const CSS = `
<style>
.hc-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px;font-family:inherit;}
.hc-table th,.hc-table td{padding:7px 10px;text-align:center;border-bottom:1px solid #e2e8f0;}
.hc-table thead th{position:sticky;top:0;z-index:2;}
.hc-h1 th{background:#1a365d;color:#fff;font-weight:600;font-size:11.5px;text-transform:uppercase;letter-spacing:.3px;border-bottom:1px solid #2d4a7a;}
.hc-h2 th{background:#2d4a7a;color:#cbd5e1;font-weight:500;font-size:11px;border-bottom:2px solid #e2e8f0;}
.hc-table tbody tr:hover{background:#f0f7ff!important;}
.hc-table tbody tr:nth-child(even){background:#f8fafc;}
.hc-table .col-month{text-align:left;font-weight:600;color:#1a365d;min-width:90px;position:sticky;left:0;background:inherit;z-index:1;}
.hc-table tbody tr:nth-child(even) .col-month{background:#f8fafc;}
.hc-table tbody tr:hover .col-month{background:#f0f7ff!important;}
.hc-sep{border-left:2px solid #cbd5e1!important;}
.hc-sep-h{border-left:2px solid rgba(255,255,255,.25)!important;}
.hc-red{color:#C0392B;font-weight:600;}
.hc-grn{color:#0D7C4B;}
.hc-bold{font-weight:700;}
.hc-sub{color:#64748b;font-size:11px;}
.hc-foot td{background:#edf2f7!important;font-weight:700;border-top:2px solid #cbd5e1;}
.hc-foot .col-month{background:#edf2f7!important;}
.hc-foot2 td{background:#f0f4f8!important;border-top:none;}
.hc-foot2 .col-month{background:#f0f4f8!important;}
.hc-tr{background:linear-gradient(90deg,#fff7ed,#fef3c7)!important;}
.hc-tr td{color:#92400e;font-weight:600;}
.hc-tr .col-month{background:linear-gradient(90deg,#fff7ed,#fef3c7)!important;}
.hc-hc{background:#f0fdf4;font-weight:600;color:#14532d;}
</style>`;

export function renderHeadcount() {
  const pg = document.getElementById("pageHeadcount");
  const curY = new Date().getFullYear();
  const years = []; for(let y=curY;y>=curY-5;y--) years.push(y);
  let selYear = curY;

  function render() {
    const {rows,avg,trTotal,trVol,trInvol} = buildYearData(selYear);
    const g = GRP;
    const sumCol=(fn)=>rows.reduce((s,r)=>s+fn(r),0);

    pg.innerHTML = `${CSS}
    <div class="page-header">
      <div><div class="page-heading">Headcount Report</div><div class="page-sub">รายงานอัตรากำลังรายเดือน — ปี ${selYear}</div></div>
      <div class="header-actions">
        <select class="filter-select" onchange="window._hcYear(Number(this.value))">
          ${years.map(y=>`<option value="${y}" ${y===selYear?"selected":""}>${y}</option>`).join("")}
        </select>
        <button class="btn btn-gold" onclick="window._exportHC()">📤 Export Excel</button>
      </div>
    </div>
    <div class="section mt-4 pb-4"><div class="card" style="overflow:hidden;"><div style="overflow-x:auto;max-height:80vh;">
      <table class="hc-table">
        <thead>
          <tr class="hc-h1">
            <th rowspan="2" style="text-align:left;min-width:90px;position:sticky;left:0;background:#1a365d;z-index:3;">${selYear}</th>
            <th colspan="${g.length+1}" class="hc-sep-h">New Employee</th>
            <th rowspan="2" class="hc-sep-h">Total<br>Resigned</th>
            <th colspan="${g.length+1}" class="hc-sep-h">Voluntary Resigned</th>
            <th colspan="${g.length+1}" class="hc-sep-h">Involuntary Resigned</th>
            <th colspan="${g.length}" class="hc-sep-h">Balance</th>
            <th colspan="${g.length+1}" class="hc-sep-h">Head Count</th>
            <th rowspan="2" class="hc-sep-h">Turnover</th>
          </tr>
          <tr class="hc-h2">
            <th class="hc-sep-h">Total</th>${g.map(x=>`<th>${x.label}</th>`).join("")}
            <th class="hc-sep-h">Total</th>${g.map(x=>`<th>${x.label}</th>`).join("")}
            <th class="hc-sep-h">Total</th>${g.map(x=>`<th>${x.label}</th>`).join("")}
            ${g.map((x,i)=>`<th${i===0?' class="hc-sep-h"':''}>${x.label}</th>`).join("")}
            <th class="hc-sep-h">Total</th>${g.map(x=>`<th>${x.label}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows.map(r=>{
            const tr=r.hT?((r.rT/r.hT)*100).toFixed(2)+"%":"—";
            return `<tr>
              <td class="col-month">${r.month}</td>
              <td class="hc-sep hc-grn hc-bold">${n(r.nT)}</td>${g.map(x=>`<td>${n(r.nG[x.key])}</td>`).join("")}
              <td class="hc-sep hc-red">${n(r.rT)}</td>
              <td class="hc-sep">${n(r.vT)}</td>${g.map(x=>`<td>${n(r.vG[x.key])}</td>`).join("")}
              <td class="hc-sep">${n(r.iT)}</td>${g.map(x=>`<td>${n(r.iG[x.key])}</td>`).join("")}
              ${g.map((x,i)=>`<td${i===0?' class="hc-sep"':''}>${bal(r.bG[x.key])}</td>`).join("")}
              <td class="hc-sep hc-hc hc-bold">${r.hT}</td>${g.map(x=>`<td class="hc-hc">${n(r.hG[x.key])}</td>`).join("")}
              <td class="hc-sep hc-tr" style="background:${parseFloat(tr)>1?'#fef3c7':'transparent'};">${tr}</td>
            </tr>`;
          }).join("")}
          <tr class="hc-foot">
            <td class="col-month">Total</td>
            <td class="hc-sep hc-grn">${sumCol(r=>r.nT)}</td>${g.map(x=>`<td>${sumCol(r=>r.nG[x.key])}</td>`).join("")}
            <td class="hc-sep hc-red">${sumCol(r=>r.rT)}</td>
            <td class="hc-sep">${sumCol(r=>r.vT)}</td>${g.map(x=>`<td>${sumCol(r=>r.vG[x.key])}</td>`).join("")}
            <td class="hc-sep">${sumCol(r=>r.iT)}</td>${g.map(x=>`<td>${sumCol(r=>r.iG[x.key])}</td>`).join("")}
            ${g.map((x,i)=>{const v=sumCol(r=>r.bG[x.key]);return `<td${i===0?' class="hc-sep"':''}>${bal(v)}</td>`;}).join("")}
            <td class="hc-sep"></td>${g.map(()=>`<td></td>`).join("")}
            <td class="hc-sep"></td>
          </tr>
          <tr class="hc-foot2">
            <td class="col-month">Avg. Headcount</td>
            <td class="hc-sep" colspan="${g.length+1+1+g.length+1+1+g.length+1+g.length}"></td>
            <td class="hc-sep hc-bold" style="font-size:14px;color:#1a365d;">${avg}</td>${g.map(()=>`<td></td>`).join("")}
            <td class="hc-sep"></td>
          </tr>
          <tr class="hc-foot2 hc-tr">
            <td class="col-month">Turnover Rate</td>
            <td class="hc-sep" colspan="${g.length}"></td>
            <td></td>
            <td class="hc-sep hc-bold" style="font-size:13px;">${trTotal}</td>
            <td class="hc-sep" colspan="${g.length}">${trVol}</td><td></td>
            <td class="hc-sep" colspan="${g.length}">${trInvol}</td><td></td>
            <td class="hc-sep" colspan="${g.length}"></td>
            <td class="hc-sep" colspan="${g.length+1}"></td>
            <td class="hc-sep"></td>
          </tr>
        </tbody>
      </table>
    </div></div></div>`;
  }

  render();
  window._hcYear = y => { selYear=y; render(); };
  window._exportHC = () => exportExcel(selYear);
}

function exportExcel(year) {
  if(!window.XLSX){ toast("กรุณารอโหลด library","error"); return; }
  const {rows,avg,trTotal,trVol,trInvol} = buildYearData(year);
  const g=GRP;

  const h1=[year,"New Employee",...g.slice(1).map(()=>""),"","Total Resigned",
    "Voluntary Resigned",...g.slice(1).map(()=>""),"",
    "Involuntary Resigned",...g.slice(1).map(()=>""),"",
    "Balance",...g.slice(1).map(()=>""),
    "Head Count",...g.slice(1).map(()=>""),"","Turnover Rate"];
  const h2=["","Total",...g.map(x=>x.label),"",
    "Total",...g.map(x=>x.label),
    "Total",...g.map(x=>x.label),
    ...g.map(x=>x.label),
    "Total",...g.map(x=>x.label),""];

  const data=rows.map(r=>{
    const tr=r.hT?((r.rT/r.hT)*100).toFixed(2)+"%":"0.00%";
    return [r.month,r.nT,...g.map(x=>r.nG[x.key]),r.rT,
      r.vT,...g.map(x=>r.vG[x.key]),r.iT,...g.map(x=>r.iG[x.key]),
      ...g.map(x=>r.bG[x.key]),r.hT,...g.map(x=>r.hG[x.key]),tr];
  });

  const totR=["Total",rows.reduce((s,r)=>s+r.nT,0),...g.map(x=>rows.reduce((s,r)=>s+r.nG[x.key],0)),
    rows.reduce((s,r)=>s+r.rT,0),rows.reduce((s,r)=>s+r.vT,0),...g.map(x=>rows.reduce((s,r)=>s+r.vG[x.key],0)),
    rows.reduce((s,r)=>s+r.iT,0),...g.map(x=>rows.reduce((s,r)=>s+r.iG[x.key],0)),
    ...g.map(x=>rows.reduce((s,r)=>s+r.bG[x.key],0)),"",...g.map(()=>""),""];
  const avgR=["Average of Head Count",...Array(h2.length-3).fill(""),avg,...g.map(()=>""),""];
  const trR=["Turnover Rate",...Array(g.length).fill(""),"",trTotal,trVol,...g.map(()=>""),
    trInvol,...g.map(()=>""),...g.map(()=>""),"",...g.map(()=>""),""];

  const ws=window.XLSX.utils.aoa_to_sheet([h1,h2,...data,totR,avgR,trR]);
  ws["!cols"]=h1.map((_,i)=>({wch:i===0?14:10}));
  const wb=window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb,ws,`Headcount ${year}`);
  window.XLSX.writeFile(wb,`Headcount_Report_${year}.xlsx`);
  toast("Export เสร็จสิ้น","success");
}
