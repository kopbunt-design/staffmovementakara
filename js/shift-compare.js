// ===== เทียบค่ากะรายคนระหว่างสองเดือน =====
// อ่านจากตาราง shift_allowance (ประวัติที่กดบันทึกไว้) — ไม่ได้คำนวณใหม่
// ใช้ final_total = ยอดที่ใช้จริง (ยอดที่แก้มือถ้ามี ไม่งั้นยอดที่ระบบคำนวณ)
// ถ้ารวมจาก total เฉย ๆ ยอดที่ HR แก้มือไว้จะไม่ถูกนับ แล้วสองหน้าจะรายงานตัวเลขคนละชุด
import { esc, toast, can } from "./app.js";
import { supabase } from "./supabase-config.js";

const fmtB = n => Number(n||0).toLocaleString("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtD = n => (n > 0 ? "+" : "") + fmtB(n);

let months = [];          // เดือนทั้งหมดที่มีในประวัติ (ใหม่ -> เก่า)
let mA = "", mB = "";      // A = เดือนก่อน, B = เดือนที่สนใจ
let rowsA = [], rowsB = [];
let filter = "changed";    // changed | all | up | down | gone | new
let q = "";
let loading = false;

export async function renderShiftCompare() {
  const pg = document.getElementById("pageShiftcompare");
  if (!months.length) {
    pg.innerHTML = `<div class="page-header"><div>
      <div class="page-heading">เทียบค่ากะรายคน</div>
      <div class="page-sub">กำลังโหลดรายการเดือน…</div></div></div>`;
    const { data, error } = await supabase.from("shift_allowance").select("month");
    if (error) { toast("โหลดไม่สำเร็จ: " + error.message, "error"); return; }
    months = [...new Set((data||[]).map(r => r.month))].sort().reverse();
    // ตั้งต้นเป็นสองเดือนล่าสุด — เป็นการเทียบที่ใช้บ่อยที่สุด แต่เปลี่ยนเองได้
    mB = months[0] || "";
    mA = months[1] || "";
    if (mA && mB) await loadBoth();
  }
  paint();
}

async function loadBoth() {
  loading = true;
  const [a, b] = await Promise.all([
    supabase.from("shift_allowance").select("*").eq("month", mA),
    supabase.from("shift_allowance").select("*").eq("month", mB),
  ]);
  loading = false;
  if (a.error || b.error) { toast("โหลดไม่สำเร็จ: " + (a.error||b.error).message, "error"); return; }
  rowsA = a.data || []; rowsB = b.data || [];
}

// ยอดที่ใช้จริงของแถวหนึ่ง — final_total เป็น generated column ใน DB
// แต่ถ้าฐานข้อมูลยังไม่ได้รัน SQL ก้อนนี้ ให้ถอยไปคิดเองฝั่งเว็บ จะได้ไม่พังทั้งหน้า
const useTotal = r => Number(r.final_total ?? r.manual_total ?? r.total ?? 0);

function joinRows() {
  const byCode = new Map();
  const put = (r, side) => {
    const k = r.emp_code;
    if (!k) return;
    if (!byCode.has(k)) byCode.set(k, { emp_code:k, name:r.employee_name, dept:r.department, level:r.job_level });
    const e = byCode.get(k);
    e[side] = r;
    // ชื่อ/แผนกเอาของเดือนล่าสุดที่เจอ — คนย้ายแผนกจะได้เห็นสังกัดปัจจุบัน
    if (side === "b") { e.name = r.employee_name || e.name; e.dept = r.department || e.dept; e.level = r.job_level || e.level; }
  };
  rowsA.forEach(r => put(r, "a"));
  rowsB.forEach(r => put(r, "b"));

  return [...byCode.values()].map(e => {
    const ta = e.a ? useTotal(e.a) : null;
    const tb = e.b ? useTotal(e.b) : null;
    const diff = (tb ?? 0) - (ta ?? 0);
    // "หาย" = มีเดือนก่อนแต่ไม่มีเดือนนี้ · "ใหม่" = ตรงข้าม
    const kind = !e.a ? "new" : !e.b ? "gone" : diff > 0 ? "up" : diff < 0 ? "down" : "same";
    return { ...e, ta, tb, diff, kind,
      pctChange: ta ? (diff / ta) * 100 : null,
      daysA: e.a?.pay_days ?? null, daysB: e.b?.pay_days ?? null,
      absA: e.a?.absent_days ?? null, absB: e.b?.absent_days ?? null,
      famA: e.a?.family_count ?? null, famB: e.b?.family_count ?? null,
      editedA: e.a?.manual_total != null, editedB: e.b?.manual_total != null };
  });
}

function paint() {
  const pg = document.getElementById("pageShiftcompare");

  if (!months.length) {
    pg.innerHTML = `<div class="page-header"><div>
      <div class="page-heading">เทียบค่ากะรายคน</div></div></div>
      <div class="empty-state" style="padding-top:60px;">
        <div class="empty-title">ยังไม่มีประวัติให้เทียบ</div>
        <div class="empty-sub">หน้านี้อ่านจากเดือนที่กด 💾 บันทึกไว้ในหน้าคำนวณค่ากะ<br>
          ต้องมีอย่างน้อย 2 เดือนถึงจะเทียบได้</div></div>`;
    return;
  }

  const all = joinRows();
  const shown = all.filter(r => {
    if (filter === "changed" && r.kind === "same") return false;
    if (["up","down","gone","new"].includes(filter) && r.kind !== filter) return false;
    if (q) {
      const hay = [r.emp_code, r.name, r.dept, r.level].join(" ").toLowerCase();
      if (!q.toLowerCase().split(/\s+/).filter(Boolean).every(t => hay.includes(t))) return false;
    }
    return true;
  }).sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));   // เปลี่ยนเยอะสุดขึ้นก่อน

  const sumA = all.reduce((s,r) => s + (r.ta || 0), 0);
  const sumB = all.reduce((s,r) => s + (r.tb || 0), 0);
  const n = k => all.filter(r => r.kind === k).length;

  const monthOpts = sel => months.map(m => `<option value="${esc(m)}" ${m===sel?"selected":""}>${esc(m)}</option>`).join("");

  pg.innerHTML = `
  <div class="page-header">
    <div><div class="page-heading">เทียบค่ากะรายคน</div>
    <div class="page-sub">ดูว่าใครได้มากขึ้น/น้อยลง เทียบระหว่างสองเดือนที่บันทึกไว้</div></div>
    <div class="header-actions">
      <button class="btn btn-secondary btn-sm" onclick="window._scExport()">📤 Export</button>
    </div>
  </div>

  <div class="section">
    <div class="sc-pick">
      <div class="sc-pick-one">
        <label>เทียบจากเดือน</label>
        <select class="filter-select" onchange="window._scMonth('a', this.value)">${monthOpts(mA)}</select>
      </div>
      <div class="sc-arrow">→</div>
      <div class="sc-pick-one">
        <label>มาเป็นเดือน</label>
        <select class="filter-select" onchange="window._scMonth('b', this.value)">${monthOpts(mB)}</select>
      </div>
      ${mA === mB ? `<div class="sc-warn">เลือกเดือนเดียวกันทั้งสองช่อง</div>` : ""}
      ${loading ? `<div class="sc-warn">กำลังโหลด…</div>` : ""}
    </div>

    <div class="sc-tiles">
      <div class="sc-tile"><div class="sc-tile-l">รวมเดือน ${esc(mA)}</div><div class="sc-tile-n">${fmtB(sumA)}</div></div>
      <div class="sc-tile"><div class="sc-tile-l">รวมเดือน ${esc(mB)}</div><div class="sc-tile-n">${fmtB(sumB)}</div></div>
      <div class="sc-tile ${sumB-sumA>0?"sc-up":sumB-sumA<0?"sc-down":""}">
        <div class="sc-tile-l">ส่วนต่าง</div>
        <div class="sc-tile-n">${fmtD(sumB - sumA)}</div>
        <div class="sc-tile-s">${sumA ? ((sumB-sumA)/sumA*100).toFixed(1)+"%" : "—"}</div></div>
      <div class="sc-tile"><div class="sc-tile-l">คนที่ยอดเปลี่ยน</div>
        <div class="sc-tile-n">${n("up")+n("down")}</div>
        <div class="sc-tile-s">เพิ่ม ${n("up")} · ลด ${n("down")}</div></div>
      <div class="sc-tile"><div class="sc-tile-l">เข้า/ออกจากรายการ</div>
        <div class="sc-tile-n">${n("new")+n("gone")}</div>
        <div class="sc-tile-s">ใหม่ ${n("new")} · หาย ${n("gone")}</div></div>
    </div>

    <div class="search-bar mt-4">
      <div class="search-input-wrap">
        <svg class="search-icon" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input class="search-input" placeholder="ค้นหา ชื่อ / รหัส / แผนก" value="${esc(q)}" oninput="window._scQ(this.value)">
      </div>
      <div class="sc-filters">
        ${[["changed","เฉพาะที่เปลี่ยน"],["up","เพิ่มขึ้น"],["down","ลดลง"],["new","ใหม่"],["gone","หายไป"],["all","ทั้งหมด"]]
          .map(([k,l]) => `<button class="sc-fbtn ${filter===k?"on":""}" onclick="window._scFilter('${k}')">${l}</button>`).join("")}
      </div>
    </div>

    <div class="card mt-4 pb-4"><div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>รหัส</th><th>ชื่อ</th><th>แผนก</th><th>ระดับ</th>
          <th class="text-right">${esc(mA)}</th><th class="text-right">${esc(mB)}</th>
          <th class="text-right">ส่วนต่าง</th><th class="text-right">%</th>
          <th class="text-right">วันจ่าย</th><th class="text-right">วันขาด</th><th>สาเหตุที่เป็นไปได้</th>
        </tr></thead>
        <tbody>
        ${shown.length === 0 ? `<tr><td colspan="11" class="text-center text-muted" style="padding:40px;">ไม่มีรายการตามเงื่อนไขนี้</td></tr>` :
          shown.map(r => `<tr>
            <td><b>${esc(r.emp_code)}</b></td>
            <td>${esc(r.name||"-")}${r.editedB?` <span class="badge badge-gold" title="ยอดเดือน ${esc(mB)} ถูกแก้ด้วยมือ">แก้มือ</span>`:""}</td>
            <td class="text-muted">${esc(r.dept||"-")}</td>
            <td>${esc(r.level||"-")}</td>
            <td class="text-right ${r.ta===null?"text-muted":""}">${r.ta===null?"—":fmtB(r.ta)}</td>
            <td class="text-right ${r.tb===null?"text-muted":""}">${r.tb===null?"—":fmtB(r.tb)}</td>
            <td class="text-right sc-diff ${r.diff>0?"sc-up":r.diff<0?"sc-down":""}">${r.kind==="same"?"—":fmtD(r.diff)}</td>
            <td class="text-right text-muted">${r.pctChange===null?"—":r.pctChange.toFixed(0)+"%"}</td>
            <td class="text-right text-muted">${r.daysA??"—"} → ${r.daysB??"—"}</td>
            <td class="text-right ${(r.absB||0)>(r.absA||0)?"sc-down":"text-muted"}">${r.absA??"—"} → ${r.absB??"—"}</td>
            <td style="font-size:11.5px;">${reasonBadges(r)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div></div>
  </div>`;

  wire(shown);
}

// เดาสาเหตุจากตัวเลขที่มี — บอกว่า "น่าจะเพราะอะไร" ไม่ใช่คำตอบสุดท้าย
// ตั้งใจให้เป็นจุดเริ่มไล่ดู ไม่ใช่ข้อสรุป เพราะประวัติเก็บแค่ยอดสรุป ไม่มีรายวัน
function reasonBadges(r) {
  const out = [];
  if (r.kind === "new")  out.push(`<span class="badge badge-blue">ไม่มีในเดือน ${esc(mA)}</span>`);
  if (r.kind === "gone") out.push(`<span class="badge badge-gray">ไม่มีในเดือน ${esc(mB)}</span>`);
  if (r.famA !== null && r.famB !== null && r.famA !== r.famB)
    out.push(`<span class="badge badge-gold">ตระกูลกะ ${r.famA} → ${r.famB}</span>`);
  if ((r.absB||0) > (r.absA||0)) out.push(`<span class="badge" style="color:var(--red);background:var(--red-light);">ขาดงานเพิ่ม ${(r.absB||0)-(r.absA||0)} วัน</span>`);
  if ((r.absB||0) < (r.absA||0)) out.push(`<span class="badge badge-green">ขาดงานลดลง ${(r.absA||0)-(r.absB||0)} วัน</span>`);
  if (r.editedA || r.editedB) out.push(`<span class="badge badge-gold">มีการแก้มือ</span>`);
  return out.length ? out.join(" ") : `<span class="text-muted">—</span>`;
}

function wire(shown) {
  window._scMonth = async (side, v) => {
    if (side === "a") mA = v; else mB = v;
    await loadBoth();
    paint();
  };
  window._scFilter = k => { filter = k; paint(); };
  window._scQ = v => {
    q = v;
    const box = document.querySelector("#pageShiftcompare .search-input");
    const pos = box?.selectionStart;
    paint();
    const nb = document.querySelector("#pageShiftcompare .search-input");
    if (nb) { nb.focus(); if (pos != null) nb.setSelectionRange(pos, pos); }
  };
  window._scExport = () => {
    if (!window.XLSX) { toast("กรุณารอโหลด library", "error"); return; }
    const data = shown.map(r => ({
      รหัสพนักงาน:r.emp_code, ชื่อ:r.name, แผนก:r.dept, ระดับ:r.level,
      [`ค่ากะ ${mA}`]: r.ta, [`ค่ากะ ${mB}`]: r.tb,
      ส่วนต่าง:r.kind==="same"?0:r.diff,
      "เปลี่ยน %": r.pctChange === null ? "" : Number(r.pctChange.toFixed(1)),
      [`วันจ่าย ${mA}`]:r.daysA, [`วันจ่าย ${mB}`]:r.daysB,
      [`วันขาด ${mA}`]:r.absA, [`วันขาด ${mB}`]:r.absB,
      [`ตระกูลกะ ${mA}`]:r.famA, [`ตระกูลกะ ${mB}`]:r.famB,
      แก้มือ: (r.editedA||r.editedB) ? "ใช่" : "",
    }));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(data), "เทียบค่ากะ");
    window.XLSX.writeFile(wb, `shift_allowance_compare_${mA}_vs_${mB}.xlsx`);
  };
}
