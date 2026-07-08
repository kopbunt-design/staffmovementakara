import { supabase } from "./supabase-config.js";
import { allEmployees, allMovements, movYM, esc, toast } from "./app.js";

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const LEVEL_GROUPS = [
  { key:"M", label:"M", levels:["M1","M2","M3","M4"] },
  { key:"S", label:"S", levels:["S1","S2","S3"] },
  { key:"O", label:"O", levels:["O1","O2","O3"] },
];

function getLevelGroup(jobLevel) {
  const jl = (jobLevel||"").toUpperCase().trim();
  for(const g of LEVEL_GROUPS) { if(g.levels.includes(jl)) return g.key; }
  return "";
}

function buildYearData(year) {
  const rows = [];
  let runningTotal = {}; // {group: count}
  // คำนวณ headcount ณ สิ้นเดือน ธ.ค. ปีก่อน (= ต้นปี)
  const prevYM = `${year-1}-12`;
  const initAll = allEmployees.filter(e=>{
    const jm=(e.join_date||"").substring(0,7);
    const em=(e.end_date||"").substring(0,7);
    if(jm && jm>prevYM) return false;
    if(em && em<=prevYM) return false;
    return true;
  });
  LEVEL_GROUPS.forEach(g=>{ runningTotal[g.key]=initAll.filter(e=>getLevelGroup(e.job_level)===g.key).length; });
  runningTotal["_other"]=initAll.filter(e=>!getLevelGroup(e.job_level)).length;

  const totals = { newM:0,newS:0,newO:0, volM:0,volS:0,volO:0, involM:0,involS:0,involO:0 };

  for(let m=0;m<12;m++){
    const ym=`${year}-${String(m+1).padStart(2,"0")}`;

    // New Employees: join_date ในเดือนนี้ หรือ movement New Hire
    const movNewCodes = new Set(allMovements.filter(mv=>movYM(mv)===ym&&mv.type==="New Hire").map(mv=>mv.emp_code));
    const empNew = allEmployees.filter(e=>(e.join_date||"").substring(0,7)===ym && !movNewCodes.has(e.emp_code));
    const allNew = [...allEmployees.filter(e=>movNewCodes.has(e.emp_code)), ...empNew];
    const newByGroup = {};
    LEVEL_GROUPS.forEach(g=>{ newByGroup[g.key]=allNew.filter(e=>getLevelGroup(e.job_level)===g.key).length; });
    const newTotal = allNew.length;

    // Voluntary Resigned (Resignation + Retirement)
    const movVolCodes = new Set(allMovements.filter(mv=>movYM(mv)===ym&&["Resignation","Retirement"].includes(mv.type)).map(mv=>mv.emp_code));
    const empVol = allEmployees.filter(e=>(e.end_date||"").substring(0,7)===ym && ["Resigned","Retired"].includes(e.status) && !movVolCodes.has(e.emp_code));
    const allVol = [...allEmployees.filter(e=>movVolCodes.has(e.emp_code)), ...empVol];
    const volByGroup = {};
    LEVEL_GROUPS.forEach(g=>{ volByGroup[g.key]=allVol.filter(e=>getLevelGroup(e.job_level)===g.key).length; });
    const volTotal = allVol.length;

    // Involuntary Resigned (Termination)
    const movInvolCodes = new Set(allMovements.filter(mv=>movYM(mv)===ym&&mv.type==="Termination").map(mv=>mv.emp_code));
    const empInvol = allEmployees.filter(e=>(e.end_date||"").substring(0,7)===ym && e.status==="Terminated" && !movInvolCodes.has(e.emp_code));
    const allInvol = [...allEmployees.filter(e=>movInvolCodes.has(e.emp_code)), ...empInvol];
    const involByGroup = {};
    LEVEL_GROUPS.forEach(g=>{ involByGroup[g.key]=allInvol.filter(e=>getLevelGroup(e.job_level)===g.key).length; });
    const involTotal = allInvol.length;

    const totalResigned = volTotal + involTotal;

    // Balance = new - resigned per group
    const balByGroup = {};
    LEVEL_GROUPS.forEach(g=>{ balByGroup[g.key]=newByGroup[g.key] - volByGroup[g.key] - involByGroup[g.key]; });

    // Running headcount
    LEVEL_GROUPS.forEach(g=>{ runningTotal[g.key] += balByGroup[g.key]; });
    runningTotal["_other"] += (newTotal - totalResigned) - LEVEL_GROUPS.reduce((s,g)=>s+balByGroup[g.key],0);
    const hcTotal = Object.values(runningTotal).reduce((s,v)=>s+v,0);

    // Accumulate for totals row
    LEVEL_GROUPS.forEach(g=>{
      totals["new"+g.key] += newByGroup[g.key];
      totals["vol"+g.key] += volByGroup[g.key];
      totals["invol"+g.key] += involByGroup[g.key];
    });

    rows.push({
      month: MONTH_NAMES[m],
      newTotal, newByGroup,
      totalResigned,
      volTotal, volByGroup,
      involTotal, involByGroup,
      balByGroup,
      hcTotal,
      hcByGroup: {...runningTotal},
    });
  }

  // Turnover Rate = (total resigned / average headcount) * 100
  const hcValues = rows.map(r=>r.hcTotal);
  const avgHC = hcValues.length ? Math.round(hcValues.reduce((s,v)=>s+v,0)/hcValues.length) : 0;
  const yearTotalResigned = rows.reduce((s,r)=>s+r.totalResigned,0);
  const yearVolTotal = rows.reduce((s,r)=>s+r.volTotal,0);
  const yearInvolTotal = rows.reduce((s,r)=>s+r.involTotal,0);
  const turnoverVol = avgHC ? ((yearVolTotal/avgHC)*100).toFixed(2)+"%" : "0.00%";
  const turnoverInvol = avgHC ? ((yearInvolTotal/avgHC)*100).toFixed(2)+"%" : "0.00%";
  const turnoverTotal = avgHC ? ((yearTotalResigned/avgHC)*100).toFixed(2)+"%" : "0.00%";

  return { rows, totals, avgHC, turnoverVol, turnoverInvol, turnoverTotal };
}

export function renderHeadcount() {
  const pg = document.getElementById("pageHeadcount");
  const currentYear = new Date().getFullYear();
  const years = [];
  for(let y=currentYear;y>=currentYear-5;y--) years.push(y);

  let selYear = currentYear;

  function render() {
    const {rows, totals, avgHC, turnoverVol, turnoverInvol, turnoverTotal} = buildYearData(selYear);
    const grps = LEVEL_GROUPS;

    pg.innerHTML = `
    <div class="page-header">
      <div><div class="page-heading">Headcount Report</div><div class="page-sub">รายงานอัตรากำลังรายเดือน — ปี ${selYear}</div></div>
      <div class="header-actions">
        <select class="filter-select" onchange="window._hcYear(Number(this.value))">
          ${years.map(y=>`<option value="${y}" ${y===selYear?"selected":""}>${y}</option>`).join("")}
        </select>
        <button class="btn btn-gold" onclick="window._exportHC()">📤 Export Excel</button>
      </div>
    </div>
    <div class="section mt-4 pb-4"><div class="card"><div class="table-wrap" style="overflow-x:auto;">
      <table class="data-table" style="font-size:12px;white-space:nowrap;">
        <thead>
          <tr style="background:var(--blue-dark,#1a365d);color:#fff;">
            <th rowspan="2" style="text-align:left;padding:8px 12px;">${selYear}</th>
            <th colspan="${grps.length+1}" style="text-align:center;border-left:2px solid rgba(255,255,255,.2);">New Employee</th>
            <th rowspan="2" style="text-align:center;border-left:2px solid rgba(255,255,255,.2);">Total<br>Resigned</th>
            <th colspan="${grps.length+1}" style="text-align:center;border-left:2px solid rgba(255,255,255,.2);">Voluntary Resigned</th>
            <th colspan="${grps.length+1}" style="text-align:center;border-left:2px solid rgba(255,255,255,.2);">Involuntary Resigned</th>
            <th colspan="${grps.length}" style="text-align:center;border-left:2px solid rgba(255,255,255,.2);">Balance</th>
            <th colspan="${grps.length+1}" style="text-align:center;border-left:2px solid rgba(255,255,255,.2);">Head Count</th>
            <th rowspan="2" style="text-align:center;border-left:2px solid rgba(255,255,255,.2);">Turnover<br>Rate</th>
          </tr>
          <tr style="background:var(--blue-dark,#1a365d);color:#fff;">
            <th style="text-align:center;border-left:2px solid rgba(255,255,255,.2);">Total</th>
            ${grps.map(g=>`<th style="text-align:center;">${g.label}</th>`).join("")}
            <th style="text-align:center;border-left:2px solid rgba(255,255,255,.2);">Total</th>
            ${grps.map(g=>`<th style="text-align:center;">${g.label}</th>`).join("")}
            <th style="text-align:center;border-left:2px solid rgba(255,255,255,.2);">Total</th>
            ${grps.map(g=>`<th style="text-align:center;">${g.label}</th>`).join("")}
            ${grps.map(g=>`<th style="text-align:center;border-left:${g===grps[0]?'2':'0'}px solid rgba(255,255,255,.2);">${g.label}</th>`).join("")}
            <th style="text-align:center;border-left:2px solid rgba(255,255,255,.2);">Total</th>
            ${grps.map(g=>`<th style="text-align:center;">${g.label}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows.map((r,i)=>{
            const resigned = r.totalResigned;
            const trRate = r.hcTotal ? ((resigned/r.hcTotal)*100).toFixed(2)+"%" : "0.00%";
            const bg = i%2===0 ? "" : "background:var(--bg-alt,#f8fafc);";
            return `<tr style="${bg}">
              <td style="font-weight:600;padding:6px 12px;">${r.month}</td>
              <td style="text-align:center;border-left:2px solid var(--border);">${r.newTotal||""}</td>
              ${grps.map(g=>`<td style="text-align:center;">${r.newByGroup[g.key]||""}</td>`).join("")}
              <td style="text-align:center;border-left:2px solid var(--border);font-weight:600;color:var(--red);">${resigned||""}</td>
              <td style="text-align:center;border-left:2px solid var(--border);">${r.volTotal||""}</td>
              ${grps.map(g=>`<td style="text-align:center;">${r.volByGroup[g.key]||""}</td>`).join("")}
              <td style="text-align:center;border-left:2px solid var(--border);">${r.involTotal||""}</td>
              ${grps.map(g=>`<td style="text-align:center;">${r.involByGroup[g.key]||""}</td>`).join("")}
              ${grps.map((g,gi)=>{const v=r.balByGroup[g.key]; return `<td style="text-align:center;${gi===0?'border-left:2px solid var(--border);':''}color:${v>0?'var(--green)':v<0?'var(--red)':''};">${v||""}</td>`;}).join("")}
              <td style="text-align:center;border-left:2px solid var(--border);font-weight:600;">${r.hcTotal}</td>
              ${grps.map(g=>`<td style="text-align:center;">${r.hcByGroup[g.key]||""}</td>`).join("")}
              <td style="text-align:center;border-left:2px solid var(--border);">${trRate}</td>
            </tr>`;
          }).join("")}
          <tr style="font-weight:700;border-top:2px solid var(--border);background:var(--bg-alt,#f0f4f8);">
            <td style="padding:6px 12px;">Total</td>
            <td style="text-align:center;border-left:2px solid var(--border);">${rows.reduce((s,r)=>s+r.newTotal,0)}</td>
            ${grps.map(g=>`<td style="text-align:center;">${rows.reduce((s,r)=>s+(r.newByGroup[g.key]||0),0)}</td>`).join("")}
            <td style="text-align:center;border-left:2px solid var(--border);color:var(--red);">${rows.reduce((s,r)=>s+r.totalResigned,0)}</td>
            <td style="text-align:center;border-left:2px solid var(--border);">${rows.reduce((s,r)=>s+r.volTotal,0)}</td>
            ${grps.map(g=>`<td style="text-align:center;">${rows.reduce((s,r)=>s+(r.volByGroup[g.key]||0),0)}</td>`).join("")}
            <td style="text-align:center;border-left:2px solid var(--border);">${rows.reduce((s,r)=>s+r.involTotal,0)}</td>
            ${grps.map(g=>`<td style="text-align:center;">${rows.reduce((s,r)=>s+(r.involByGroup[g.key]||0),0)}</td>`).join("")}
            ${grps.map((g,gi)=>{const v=rows.reduce((s,r)=>s+(r.balByGroup[g.key]||0),0); return `<td style="text-align:center;${gi===0?'border-left:2px solid var(--border);':''}color:${v>0?'var(--green)':v<0?'var(--red)':''};">${v}</td>`;}).join("")}
            <td style="text-align:center;border-left:2px solid var(--border);"></td>
            ${grps.map(()=>`<td></td>`).join("")}
            <td style="text-align:center;border-left:2px solid var(--border);"></td>
          </tr>
          <tr style="background:var(--bg-alt,#f0f4f8);">
            <td style="padding:6px 12px;font-weight:600;">Average of Head Count</td>
            <td colspan="${grps.length*4+7}" style="border-left:2px solid var(--border);"></td>
            <td style="text-align:center;border-left:2px solid var(--border);font-weight:700;">${avgHC}</td>
            ${grps.map(()=>`<td></td>`).join("")}
            <td style="border-left:2px solid var(--border);"></td>
          </tr>
          <tr style="font-weight:700;background:var(--bg-alt,#f0f4f8);">
            <td style="padding:6px 12px;">Turnover Rate</td>
            <td colspan="${grps.length+1}" style="border-left:2px solid var(--border);"></td>
            <td style="text-align:center;border-left:2px solid var(--border);color:var(--red);">${turnoverTotal}</td>
            <td colspan="${grps.length+1}" style="text-align:center;border-left:2px solid var(--border);">${turnoverVol}</td>
            <td colspan="${grps.length+1}" style="text-align:center;border-left:2px solid var(--border);">${turnoverInvol}</td>
            <td colspan="${grps.length+grps.length+2}" style="border-left:2px solid var(--border);"></td>
          </tr>
        </tbody>
      </table>
    </div></div></div>`;
  }

  render();
  window._hcYear = y => { selYear = y; render(); };
  window._exportHC = () => exportHeadcountExcel(selYear);
}

function exportHeadcountExcel(year) {
  if(!window.XLSX){ toast("กรุณารอโหลด library","error"); return; }
  const {rows, totals, avgHC, turnoverVol, turnoverInvol, turnoverTotal} = buildYearData(year);
  const grps = LEVEL_GROUPS;

  // Header rows
  const h1 = [year, "New Employee", ...grps.slice(1).map(()=>""), "", "Total Resigned",
    "Voluntary Resigned", ...grps.slice(1).map(()=>""), "",
    "Involuntary Resigned", ...grps.slice(1).map(()=>""), "",
    "Balance", ...grps.slice(1).map(()=>""),
    "Head Count", ...grps.slice(1).map(()=>""), "",
    "Turnover Rate"];
  const h2 = ["", "Total", ...grps.map(g=>g.label), "",
    "Total", ...grps.map(g=>g.label),
    "Total", ...grps.map(g=>g.label),
    ...grps.map(g=>g.label),
    "Total", ...grps.map(g=>g.label),
    ""];

  const dataRows = rows.map(r=>{
    const resigned = r.totalResigned;
    const trRate = r.hcTotal ? ((resigned/r.hcTotal)*100).toFixed(2)+"%" : "0.00%";
    return [
      r.month,
      r.newTotal, ...grps.map(g=>r.newByGroup[g.key]||0),
      resigned,
      r.volTotal, ...grps.map(g=>r.volByGroup[g.key]||0),
      r.involTotal, ...grps.map(g=>r.involByGroup[g.key]||0),
      ...grps.map(g=>r.balByGroup[g.key]||0),
      r.hcTotal, ...grps.map(g=>r.hcByGroup[g.key]||0),
      trRate,
    ];
  });

  // Total row
  const totalRow = ["Total",
    rows.reduce((s,r)=>s+r.newTotal,0), ...grps.map(g=>rows.reduce((s,r)=>s+(r.newByGroup[g.key]||0),0)),
    rows.reduce((s,r)=>s+r.totalResigned,0),
    rows.reduce((s,r)=>s+r.volTotal,0), ...grps.map(g=>rows.reduce((s,r)=>s+(r.volByGroup[g.key]||0),0)),
    rows.reduce((s,r)=>s+r.involTotal,0), ...grps.map(g=>rows.reduce((s,r)=>s+(r.involByGroup[g.key]||0),0)),
    ...grps.map(g=>rows.reduce((s,r)=>s+(r.balByGroup[g.key]||0),0)),
    "", ...grps.map(()=>""),
    "",
  ];

  // Average row
  const avgRow = ["Average of Head Count", ...Array(h2.length-3).fill(""), avgHC, ...grps.map(()=>""), ""];

  // Turnover row
  const trRow = ["Turnover Rate", ...Array(grps.length).fill(""), "", turnoverTotal,
    turnoverVol, ...grps.map(()=>""),
    turnoverInvol, ...grps.map(()=>""),
    ...grps.map(()=>""),
    "", ...grps.map(()=>""), ""];

  const wsData = [h1, h2, ...dataRows, totalRow, avgRow, trRow];
  const ws = window.XLSX.utils.aoa_to_sheet(wsData);
  ws["!cols"] = wsData[0].map(()=>({wch:12}));
  ws["!cols"][0] = {wch:16};

  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, `Headcount ${year}`);
  window.XLSX.writeFile(wb, `Headcount_Report_${year}.xlsx`);
  toast("Export เสร็จสิ้น","success");
}
