import { supabase } from "./supabase-config.js";
import { can, esc, toast, currentUser } from "./app.js";

// ============================================================================
// ค่าจ้างเหมา — ที่ปรึกษา / ลูกจ้างชั่วคราว / ผู้รับเหมา
//
// ⚠️ คนกลุ่มนี้ไม่ใช่พนักงาน อยู่คนละตารางกับ employees โดยตั้งใจ
//    และไม่เข้าการนับกำลังคนใด ๆ (Dashboard/Headcount/Movement/Workforce)
//
// โครงตามโปรแกรมเงินเดือน: ตั้งคนครั้งเดียว -> เปิดงวด -> คำนวณ -> อนุมัติ -> ล็อก
// งวดที่ล็อกแล้วแก้ไม่ได้ (DB trigger บังคับ) ถ้าต้องแก้ให้เปิดงวดใหม่
// ============================================================================

const TYPE = {
  consultant: { label:"ที่ปรึกษา",        color:"var(--blue)",  bg:"var(--blue-light)" },
  casual:     { label:"ลูกจ้างชั่วคราว",  color:"var(--green)", bg:"var(--green-light)" },
  contractor: { label:"ผู้รับเหมา",       color:"var(--purple)",bg:"var(--purple-light)" },
};
const STATUS = {
  draft:      { label:"ร่าง",       color:"var(--muted)",     bg:"#f1f5f9" },
  calculated: { label:"ประมวลผลแล้ว",  color:"var(--blue)",      bg:"var(--blue-light)" },
  approved:   { label:"อนุมัติแล้ว",color:"var(--gold-dark)", bg:"var(--gold-light)" },
  locked:     { label:"ล็อกแล้ว",   color:"var(--green)",     bg:"var(--green-light)" },
};
const NEXT = { draft:"calculated", calculated:"approved", approved:"locked" };
const money = v => Number(v||0).toLocaleString("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2});
const round2 = v => Math.round((Number(v)||0) * 100) / 100;

// ---------------------------------------------------------------------------
// ตรรกะคำนวณ — ฟังก์ชันบริสุทธิ์ ไม่แตะ DOM/DB เพื่อให้เทสได้ตรง ๆ
//
// ฐานภาษี = ค่าจ้างประจำ + รายได้ที่เข้าฐานภาษี (taxable) − รายหักที่ลดฐานภาษี (cuts_tax_base เช่นหักขาดงาน)
//   รายได้บางอย่างไม่ต้องเสียภาษี เช่นเบิกค่าใช้จ่ายคืน · รายหักส่วนใหญ่ (บังคับคดี เบิกล่วงหน้า) ไม่ลดฐาน
// สุทธิ = ค่าจ้าง + ได้เพิ่มทั้งหมด − ภาษี − หักทั้งหมด
// ---------------------------------------------------------------------------
export function calcItem(worker, adjusts = []) {
  const sum = list => list.reduce((s,a) => s + Number(a.amount||0), 0);
  const base    = round2(worker.monthly_rate);
  const earn    = adjusts.filter(a => a.kind === "earning");
  const deduct  = adjusts.filter(a => a.kind === "deduction");
  const extra   = round2(sum(earn));
  const deducted= round2(sum(deduct));

  const taxBase = Math.max(0, round2(base + sum(earn.filter(a => a.taxable !== false))
                                          - sum(deduct.filter(a => a.cuts_tax_base))));
  const pct     = worker.wht_apply ? Number(worker.wht_percent ?? 3) : 0;
  const wht     = round2(taxBase * pct / 100);
  const net     = round2(base + extra - wht - deducted);

  return { base_amount:base, extra_amount:extra, deduct_amount:deducted, tax_base:taxBase,
           wht_percent:pct, wht_amount:wht, net_amount:net };
}

// รายการประจำที่ใช้กับงวดนี้: เปิดใช้งาน และงวดอยู่ในช่วง start..end (end ว่าง = ไม่มีกำหนด)
export function recurringFor(items = [], period) {
  return items.filter(i => i.is_active !== false && i.start_period <= period && (!i.end_period || i.end_period >= period));
}
// แปลงรายการประจำเป็นแถวรายการของงวด — คัดลอกชื่อและผลทางภาษีจากตั้งค่ารายการ ณ ตอนคำนวณ
export function adjustFromRecurring(item, code, runId) {
  const earning = code.kind === "earning";
  return { run_id: runId, worker_id: item.worker_id, kind: code.kind, label: code.name_th, amount: round2(item.amount),
           code_id: code.id, source: "recurring", worker_item_id: item.id, remark: item.note || null,
           taxable: earning ? code.tax_effect !== false : true, cuts_tax_base: !earning && !!code.tax_effect };
}

// รวมยอดทั้งงวด ไว้โชว์หัวงวดและกระทบยอดกับรายงาน
export function runTotals(items = []) {
  const sum = k => round2(items.reduce((s,i) => s + Number(i[k]||0), 0));
  return { count:items.length, base:sum("base_amount"), extra:sum("extra_amount"),
           deduct:sum("deduct_amount"), wht:sum("wht_amount"), net:sum("net_amount") };
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
let workers = [], runs = [], curRun = null, items = [], adjusts = [], tab = "runs";
// ตั้งค่ารายการ + รายการประจำรายคน (schema_contract_items.sql) — ยังไม่ได้รันไฟล์นั้น หน้าเดิมยังใช้ได้ แค่ไม่มีรายการให้เลือก
let codes = [], wItems = [], itemsReady = true;
const codeOf = id => codes.find(c => c.id === id);
const activeCodes = kind => codes.filter(c => c.is_active && (!kind || c.kind === kind)).sort((a,b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));

async function loadAll() {
  const [w, r] = await Promise.all([
    supabase.from("contract_workers").select("*").order("worker_code"),
    supabase.from("contract_pay_run").select("*").order("period", { ascending:false }),
  ]);
  if (w.error || r.error) throw new Error((w.error || r.error).message);
  workers = w.data || []; runs = r.data || [];
  const [c, wi] = await Promise.all([
    supabase.from("contract_pay_codes").select("*").order("sort_order"),
    supabase.from("contract_worker_items").select("*").order("start_period"),
  ]);
  itemsReady = !c.error && !wi.error;
  codes = c.data || []; wItems = wi.data || [];
}
async function loadRun(id) {
  const [i, a] = await Promise.all([
    supabase.from("contract_pay_item").select("*").eq("run_id", id).order("worker_code"),
    supabase.from("contract_pay_adjust").select("*").eq("run_id", id),
  ]);
  if (i.error || a.error) throw new Error((i.error || a.error).message);
  items = i.data || []; adjusts = a.data || [];
  curRun = runs.find(x => x.id === id) || null;
}

export function renderContractPayroll() { boot(); }

async function boot() {
  const pg = document.getElementById("pageContractpay");
  pg.innerHTML = `<div class="section mt-4"><div class="card"><div class="card-body">กำลังโหลด…</div></div></div>`;
  try { await loadAll(); }
  catch (e) {
    pg.innerHTML = `<div class="section mt-4"><div class="card"><div class="card-body">
      <b>โหลดข้อมูลไม่สำเร็จ</b>
      <div class="text-muted" style="margin-top:6px;">${esc(e.message)}</div>
      <div class="text-muted" style="margin-top:10px;font-size:12px;">
        ถ้ายังไม่ได้รัน <code>sql/schema_contract_payroll.sql</code> ใน Supabase ให้รันก่อน</div>
    </div></div></div>`;
    return;
  }
  draw();
}

// ---------------------------------------------------------------------------
// หน้าจอ
// ---------------------------------------------------------------------------
const badge = (map, k) => { const c = map[k] || map.draft || {};
  return `<span class="badge" style="color:${c.color};background:${c.bg};">${esc(c.label||k)}</span>`; };
const canEdit = () => can("data.payroll.write");

function draw() {
  const pg = document.getElementById("pageContractpay");
  pg.innerHTML = `
  <div class="page-header">
    <div><div class="page-heading">ค่าจ้างเหมา</div>
      <div class="page-sub">ที่ปรึกษา · ลูกจ้างชั่วคราว · ผู้รับเหมา — ไม่นับรวมในกำลังคนพนักงาน</div></div>
    <div class="header-actions">
      ${tab==="workers"&&canEdit()?`<button class="btn btn-primary" onclick="window._cwNew()">+ เพิ่มคน</button>`:""}
      ${tab==="runs"&&canEdit()?`<button class="btn btn-primary" onclick="window._crNew()">+ เปิดงวดใหม่</button>`:""}
    </div>
  </div>
  <div class="section" style="padding-top:12px;padding-bottom:0;">
    <div class="cp-tabs">
      <button class="cp-tab${tab==="runs"?" on":""}"    onclick="window._cpTab('runs')">งวดจ่าย</button>
      <button class="cp-tab${tab==="workers"?" on":""}" onclick="window._cpTab('workers')">รายชื่อ (${workers.filter(w=>w.is_active).length})</button>
      <button class="cp-tab${tab==="codes"?" on":""}" onclick="window._cpTab('codes')">ตั้งค่ารายการได้ / หัก</button>
    </div>
  </div>
  ${!itemsReady ? `<div class="section" style="padding-bottom:0;"><div class="cp-warn">ยังไม่ได้ตั้งระบบรายการรายได้/รายหัก —
    รัน <code>sql/schema_contract_items.sql</code> ใน Supabase ก่อน (หน้านี้ยังใช้งานแบบเดิมได้)</div></div>` : ""}
  ${tab==="runs" ? (curRun ? runDetailHTML() : runListHTML()) : tab==="codes" ? codesHTML() : workerListHTML()}
  <div class="pb-4"></div>`;
  wire();
}

// ---------- รายชื่อคน ----------
function workerListHTML() {
  if(!workers.length) return empty("ยังไม่มีรายชื่อ", "กด “+ เพิ่มคน” เพื่อตั้งข้อมูลคนและค่าจ้างเหมาต่อเดือน");
  return `<div class="section mt-4"><div class="card"><div class="table-wrap">
    <table class="data-table">
      <thead><tr><th>รหัส</th><th>ชื่อ</th><th>ประเภท</th><th>แผนก</th><th>Cost Code</th>
        <th class="num">ค่าจ้าง/เดือน</th><th>หัก ณ ที่จ่าย</th><th>รายการประจำ</th><th>สถานะ</th>${canEdit()?"<th></th>":""}</tr></thead>
      <tbody>${workers.map(w=>`<tr>
        <td><b style="color:var(--blue);font-size:12px;">${esc(w.worker_code)}</b></td>
        <td>${esc(w.name_th)}${w.name_en?`<div class="text-sm text-muted">${esc(w.name_en)}</div>`:""}</td>
        <td>${badge(TYPE,w.worker_type)}</td>
        <td class="text-muted">${esc(w.department||"-")}</td>
        <td class="text-muted" style="font-variant-numeric:tabular-nums;">${esc(w.cost_code||"-")}</td>
        <td class="num">${money(w.monthly_rate)}</td>
        <td>${w.wht_apply
          ? `<span class="badge" style="color:var(--gold-dark);background:var(--gold-light);">${w.wht_percent}%</span>`
          : `<span class="text-muted">ไม่หัก</span>`}</td>
        <td>${recurChips(w.id)}</td>
        <td>${w.is_active?`<span class="badge" style="color:var(--green);background:var(--green-light);">ใช้งาน</span>`
                         :`<span class="badge badge-gray">ปิด</span>`}</td>
        ${canEdit()?`<td style="white-space:nowrap;"><button class="btn btn-secondary btn-sm" onclick="window._cwEdit(${w.id})">แก้ไข</button>
          ${itemsReady?`<button class="btn btn-secondary btn-sm" onclick="window._cwRec(${w.id})">รายการประจำ</button>`:""}</td>`:""}
      </tr>`).join("")}</tbody>
    </table>
  </div></div></div>`;
}

// รายการประจำที่ยังมีผล (ไม่หมดอายุ) ของคนนี้ — โชว์เป็นป้ายสั้น ๆ ในรายชื่อ
function recurChips(wid) {
  const now = new Date(), ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const mine = wItems.filter(i => i.worker_id === wid && i.is_active && (!i.end_period || i.end_period >= ym));
  if(!mine.length) return `<span class="text-muted">–</span>`;
  return mine.map(i => { const c = codeOf(i.code_id) || {};
    return `<span class="cp-chip ${c.kind||""}" title="${esc(c.name_th||"")} ${money(i.amount)} · ${esc(thMonth(i.start_period))}${i.end_period?` – ${esc(thMonth(i.end_period))}`:" เป็นต้นไป"}">
      ${c.kind==="deduction"?"−":"+"}${esc(c.name_th||"?")} ${money(i.amount)}</span>`; }).join(" ");
}

// ---------- รายการงวด ----------
function runListHTML() {
  if(!runs.length) return empty("ยังไม่มีงวดจ่าย", "กด “+ เปิดงวดใหม่” เพื่อเริ่มงวดแรก");
  return `<div class="section mt-4"><div class="card"><div class="table-wrap">
    <table class="data-table">
      <thead><tr><th>งวด</th><th>สถานะ</th><th class="num">จำนวนคน</th><th class="num">ยอดจ้าง</th>
        <th class="num">ภาษีหัก</th><th class="num">จ่ายสุทธิ</th><th></th></tr></thead>
      <tbody>${runs.map(r=>`<tr>
        <td><b>${esc(thMonth(r.period))}</b><div class="text-sm text-muted">${esc(r.period)}</div></td>
        <td>${badge(STATUS,r.status)}</td>
        <td class="num" colspan="4" style="text-align:right;color:var(--muted);font-size:12px;">
          กดเปิดเพื่อดูรายละเอียด</td>
        <td><button class="btn btn-secondary btn-sm" onclick="window._crOpen(${r.id})">เปิด</button></td>
      </tr>`).join("")}</tbody>
    </table>
  </div></div></div>`;
}

// ---------- รายละเอียดงวด ----------
// ลำดับงานเหมือนโปรแกรมเงินเดือน: ① กรอกข้อมูลก่อนประมวลผล (ทุกคนขึ้นมาทันทีที่เปิดงวด) → ประมวลผล → ② ตรวจผล → อนุมัติ → ล็อก
let runTab = "input";            // input = ข้อมูลก่อนประมวลผล · result = ผลการประมวลผล
const gridEdits = new Map();     // "workerId:codeId" → จำนวนเงินที่แก้ในตารางแต่ยังไม่บันทึก
const isEditable = () => curRun && (curRun.status === "draft" || curRun.status === "calculated") && canEdit();

// รายการประจำของงวดนี้ ตามนิยามปัจจุบัน (ยังไม่บันทึกลงงวด — บันทึกตอนประมวลผล)
const virtualRec = wid => !itemsReady ? [] : recurringFor(wItems.filter(i => i.worker_id === wid), curRun.period)
  .filter(i => codeOf(i.code_id)).map(i => adjustFromRecurring(i, codeOf(i.code_id), curRun.id));
// รายการทั้งหมดของคนนี้ในงวด: ระหว่างแก้ไขได้ ใช้รายการประจำตามนิยามปัจจุบัน · หลังอนุมัติ ใช้ที่บันทึกไว้ในงวด
const linesFor = wid => [...adjusts.filter(a => a.worker_id === wid && a.source !== "recurring"),
  ...(isEditable() || !items.length ? virtualRec(wid) : adjusts.filter(a => a.worker_id === wid && a.source === "recurring"))];
const onceOf = (wid, cid) => adjusts.filter(a => a.worker_id === wid && a.code_id === cid && a.source !== "recurring");
// คนที่อยู่ในตารางกรอก: งวดที่ยังแก้ได้ = คนที่ใช้งานอยู่ทั้งหมด · งวดที่อนุมัติแล้ว = คนที่อยู่ในผลประมวลผล
const gridWorkers = () => isEditable() || !items.length ? workers.filter(w => w.is_active)
  : workers.filter(w => items.some(i => i.worker_id === w.id));
// ตัวเลขประมาณการก่อนประมวลผล (ใช้ค่าที่กำลังแก้ในตารางด้วย)
function previewOf(w) {
  const lines = linesFor(w.id).filter(a => !(a.code_id && gridEdits.has(`${w.id}:${a.code_id}`) && a.source !== "recurring"));
  for (const [k, v] of gridEdits) { const [wid, cid] = k.split(":").map(Number); if (wid !== w.id || !(v > 0)) continue;
    const c = codeOf(cid); if (c) lines.push({ kind: c.kind, amount: v, taxable: c.kind === "earning" ? !!c.tax_effect : true, cuts_tax_base: c.kind === "deduction" && !!c.tax_effect }); }
  return calcItem(w, lines);
}

function runDetailHTML() {
  const st = curRun.status, nx = NEXT[st], editable = isEditable();
  const processed = items.length > 0;
  const nxLabel = { calculated:"ประมวลผล", approved:"อนุมัติงวด", locked:"ล็อกงวด (แก้ไม่ได้อีก)" }[nx];
  const tab = runTab === "result" && processed ? "result" : runTab === "result" && !processed ? "input" : runTab;
  const t = tab === "result" ? runTotals(items) : runTotals(gridWorkers().map(previewOf));
  return `
  <div class="section mt-4">
    <div class="card"><div class="card-body cp-runhead">
      <div>
        <button class="cp-back" onclick="window._crBack()">← กลับรายการงวด</button>
        <div class="cp-period">${esc(thMonth(curRun.period))} ${badge(STATUS,st)}</div>
        <div class="cp-flow">
          ${["draft","calculated","approved","locked"].map((s,i)=>`
            <span class="cp-step${s===st?" on":""}${["draft","calculated","approved","locked"].indexOf(st)>i?" done":""}">${STATUS[s].label}</span>
            ${i<3?`<span class="cp-sep">→</span>`:""}`).join("")}
        </div>
      </div>
      <div class="cp-actions">
        ${st==="locked"?`<span class="cp-locked">🔒 งวดนี้ล็อกแล้ว แก้ไขไม่ได้</span>`:""}
        ${st==="calculated"&&canEdit()?`<button class="btn btn-secondary" onclick="window._crReprocess()">ประมวลผลใหม่</button>`:""}
        ${nx&&canEdit()?`<button class="btn ${nx==="locked"?"btn-gold":"btn-primary"}" onclick="window._crAdvance('${nx}')">${nxLabel}</button>`:""}
      </div>
    </div></div>
  </div>

  ${(st==="approved"||st==="locked")&&processed?`
  <div class="section" style="padding-bottom:0;">
    <div class="cp-docs">
      <span class="cp-docs-t">เอกสารของงวดนี้</span>
      <button class="btn btn-secondary btn-sm" onclick="window._docSlip()">🧾 สลิปรายคน</button>
      <button class="btn btn-secondary btn-sm" onclick="window._docBank()">🏦 ไฟล์โอนธนาคาร</button>
      <button class="btn btn-secondary btn-sm" onclick="window._doc50()">📄 50 ทวิ</button>
      <button class="btn btn-secondary btn-sm" onclick="window._docPnd()">📋 ภ.ง.ด.3</button>
    </div>
  </div>`:""}

  <div class="section" style="padding-bottom:0;">
    <div class="cp-subtabs">
      <button class="cp-subtab${tab==="input"?" on":""}" onclick="window._crTab('input')"><b>1</b>ข้อมูลก่อนประมวลผล</button>
      <span class="cp-subarrow">→</span>
      <button class="cp-subtab${tab==="result"?" on":""}${processed?"":" off"}" onclick="window._crTab('result')"><b>2</b>ผลการประมวลผล${processed?` (${items.length})`:""}</button>
    </div>
  </div>

  <div class="section cp-sum">
    ${[["จำนวนคน",t.count,"คน"],["ยอดจ้างรวม",money(t.base),"บาท"],
       ["ได้เพิ่ม",money(t.extra),"บาท"],["รายการหัก",money(t.deduct),"บาท"],
       ["ภาษีหัก ณ ที่จ่าย",money(t.wht),"บาท"],["จ่ายสุทธิ",money(t.net),tab==="input"?"บาท · ประมาณการ":"บาท"]]
      .map(([l,v,u],i)=>`<div class="cp-stat${i===5?" net":""}">
        <span>${l}</span><b>${v}</b><em>${u}</em></div>`).join("")}
  </div>

  ${tab === "input" ? inputHTML(editable) : resultHTML(editable)}`;
}

// ---------- ① ข้อมูลก่อนประมวลผล: ตารางกรอก คน × รายการ ----------
function inputHTML(editable) {
  const ws = gridWorkers();
  if(!ws.length) return empty("ยังไม่มีรายชื่อที่ใช้งานอยู่", "เพิ่มคนที่แท็บ “รายชื่อ” ก่อน");
  if(!itemsReady || !codes.length) return empty("ยังไม่มีรายการรายได้/รายหัก", "รัน sql/schema_contract_items.sql แล้วเปิดหน้านี้ใหม่");
  const E = activeCodes("earning"), D = activeCodes("deduction");
  const cell = (w, c) => {
    const k = `${w.id}:${c.id}`, ex = onceOf(w.id, c.id);
    if(ex.length > 1) return `<td class="cp-gc multi" title="มี ${ex.length} รายการ — แก้ในแผงรายคน (กดที่ชื่อ)">${money(ex.reduce((s,a)=>s+Number(a.amount),0))}</td>`;
    const v = gridEdits.has(k) ? gridEdits.get(k) : ex[0]?.amount;
    return `<td class="cp-gc ${c.kind}${gridEdits.has(k)?" dirty":""}">${editable
      ? `<input class="cp-in" type="number" step="0.01" min="0" data-k="${k}" value="${v ? Number(v) : ""}" placeholder="–">`
      : (v ? money(v) : `<span class="text-muted">–</span>`)}</td>`;
  };
  const recs = w => linesFor(w.id).filter(a => a.source === "recurring")
    .map(a => `<span class="cp-chip ${a.kind}">${a.kind==="deduction"?"−":"+"}${esc(a.label)} ${money(a.amount)}</span>`).join(" ");
  return `<div class="section">
    <div class="cp-gridbar">
      <div class="cp-gridhelp">${editable
        ? `กรอกจำนวนเงินของงวดนี้ (เว้นว่าง = ไม่มี) แล้วกด <b>บันทึก</b> · รายการที่เกิดทุกเดือนตั้งเป็น “รายการประจำ” ที่หน้ารายชื่อ · กดที่ชื่อเพื่อดูรายละเอียดรายคน`
        : "งวดนี้อนุมัติแล้ว แก้ข้อมูลไม่ได้"}</div>
      <div class="cp-gridact">
        <button class="btn btn-secondary btn-sm" onclick="window._gxTemplate()">⬇ ${editable?"แบบฟอร์ม Excel":"Export Excel"}</button>
        ${editable?`<label class="btn btn-secondary btn-sm" style="cursor:pointer;">⬆ นำเข้า Excel<input type="file" id="gxFile" accept=".xlsx,.xls" hidden></label>
        <button class="btn btn-primary btn-sm" id="gxSave" ${gridEdits.size?"":"disabled"}>บันทึก${gridEdits.size?` (${gridEdits.size})`:""}</button>`:""}
      </div>
    </div>
    <div class="card"><div class="table-wrap cp-gridwrap">
    <table class="data-table cp-grid">
      <thead>
        <tr class="cp-gh"><th rowspan="2" class="cp-sticky">ชื่อ</th><th rowspan="2" class="num">ค่าจ้างเหมา</th>
          ${E.length?`<th colspan="${E.length}" class="cp-gh-e">รายได้</th>`:""}${D.length?`<th colspan="${D.length}" class="cp-gh-d">รายหัก</th>`:""}
          <th rowspan="2">รายการประจำงวดนี้</th><th rowspan="2" class="num">สุทธิ (ประมาณ)</th></tr>
        <tr>${[...E, ...D].map(c => `<th class="num cp-gch" title="${esc(c.code)} · ${c.kind==="earning"?(c.tax_effect?"คิดภาษี":"ไม่คิดภาษี"):(c.tax_effect?"ลดฐานภาษี":"ไม่ลดฐานภาษี")}">${esc(c.name_th)}</th>`).join("")}</tr>
      </thead>
      <tbody>${ws.map(w => `<tr data-w="${w.id}">
        <td class="cp-sticky"><button class="cp-name" onclick="window._cpAdj(${w.id})"><b>${esc(w.worker_code)}</b>${esc(w.name_th)}</button></td>
        <td class="num">${money(w.monthly_rate)}</td>
        ${[...E, ...D].map(c => cell(w, c)).join("")}
        <td class="cp-recs">${recs(w) || `<span class="text-muted">–</span>`}</td>
        <td class="num"><b data-net="${w.id}">${money(previewOf(w).net_amount)}</b></td></tr>`).join("")}</tbody>
    </table></div></div></div>`;
}

// ---------- ② ผลการประมวลผล ----------
function resultHTML(editable) {
  if(!items.length) return empty("ยังไม่ได้ประมวลผล", "กรอกข้อมูลที่แท็บ ① แล้วกด “ประมวลผล”");
  return `<div class="section"><div class="card"><div class="table-wrap">
    <table class="data-table">
      <thead><tr><th>รหัส</th><th>ชื่อ</th><th>ประเภท</th><th class="num">ค่าจ้าง</th>
        <th class="num">ได้เพิ่ม</th><th class="num">หัก</th><th class="num">ภาษี</th>
        <th class="num">สุทธิ</th><th></th></tr></thead>
      <tbody>${items.map(it=>{
        const ad = adjusts.filter(a=>a.worker_id===it.worker_id);
        return `<tr class="cp-row" onclick="window._cpAdj(${it.worker_id})">
        <td><b style="color:var(--blue);font-size:12px;">${esc(it.worker_code)}</b></td>
        <td>${esc(it.name_th)}${ad.length?`<div class="text-sm text-muted">${ad.map(a=>
          `${a.source==="recurring"?"↻ ":""}${a.kind==="earning"?"+":"−"}${money(a.amount)} ${esc(a.label)}`).join(" · ")}</div>`:""}</td>
        <td>${badge(TYPE,it.worker_type)}</td>
        <td class="num">${money(it.base_amount)}</td>
        <td class="num">${it.extra_amount?money(it.extra_amount):"–"}</td>
        <td class="num">${it.deduct_amount?money(it.deduct_amount):"–"}</td>
        <td class="num">${it.wht_amount?`${money(it.wht_amount)}<div class="text-sm text-muted">${it.wht_percent}%</div>`:"–"}</td>
        <td class="num"><b>${money(it.net_amount)}</b></td>
        <td class="cp-open">${editable?"รายการ ›":"ดู ›"}</td>
      </tr>`;}).join("")}</tbody>
    </table>
  </div></div></div>`;
}

const empty = (t,s) => `<div class="section mt-4"><div class="card"><div class="card-body"
  style="padding:44px;text-align:center;">
  <div class="empty-title">${esc(t)}</div><div class="empty-sub" style="margin-top:6px;">${esc(s)}</div>
</div></div></div>`;
const thMonth = p => { const [y,m]=String(p).split("-");
  return new Date(Number(y),Number(m)-1).toLocaleDateString("th-TH",{month:"long",year:"numeric"}); };

// ---------------------------------------------------------------------------
// การกระทำ
// ---------------------------------------------------------------------------
function wire() {
  const leaveOk = () => !gridEdits.size || confirm(`มีตัวเลขที่ยังไม่บันทึก ${gridEdits.size} ช่อง — ออกโดยไม่บันทึก?`);
  window._cpTab   = t => { if(!leaveOk()) return; gridEdits.clear(); tab = t; curRun = null; draw(); };
  window._crBack  = () => { if(!leaveOk()) return; gridEdits.clear(); curRun = null; draw(); };
  window._crOpen  = async id => { gridEdits.clear(); await loadRun(id);
    runTab = curRun && (curRun.status === "draft" || !items.length) ? "input" : "result"; draw(); };
  window._crTab   = t => { if(t === "result" && !items.length){ toast("ยังไม่ได้ประมวลผล — กด “ประมวลผล” ก่อน","info"); return; } runTab = t; draw(); };
  window._crReprocess = async () => {
    try { if(gridEdits.size) await saveGrid(true); await calculateRun(); await loadAll(); await loadRun(curRun.id);
      runTab = "result"; draw(); toast("ประมวลผลใหม่แล้ว","success"); }
    catch(e){ toast("ไม่สำเร็จ: "+e.message,"error"); }
  };
  wireGrid();

  // เปิดงวดใหม่ — เดือนถัดจากงวดล่าสุด
  window._crNew = async () => {
    const last = runs[0]?.period;
    const d = last ? (([y,m]) => new Date(+y, +m))(last.split("-")) : new Date();
    const period = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    const v = prompt("เปิดงวดจ่ายเดือนไหน? (รูปแบบ YYYY-MM)", period);
    if(!v) return;
    if(!/^\d{4}-\d{2}$/.test(v)){ toast("รูปแบบต้องเป็น YYYY-MM เช่น 2026-09","error"); return; }
    if(runs.some(r=>r.period===v)){ toast(`มีงวด ${v} อยู่แล้ว`,"error"); return; }
    const { error } = await supabase.from("contract_pay_run")
      .insert({ period:v, status:"draft", created_by:currentUser?.id||null });
    if(error){ toast("เปิดงวดไม่สำเร็จ: "+error.message,"error"); return; }
    await loadAll(); toast(`เปิดงวด ${thMonth(v)} แล้ว`,"success");
    const r = runs.find(x=>x.period===v); if(r) await loadRun(r.id);
    draw();
  };

  // เลื่อนสถานะ — คำนวณ / อนุมัติ / ล็อก
  window._crAdvance = async next => {
    if(!curRun) return;
    if(next==="locked" && !confirm(
      `ล็อกงวด ${thMonth(curRun.period)}?\n\nล็อกแล้วแก้ไขไม่ได้อีก และปลดล็อกไม่ได้\nถ้าต้องแก้ทีหลังต้องเปิดงวดแก้ไขใหม่`)) return;

    try {
      if(next==="calculated") { if(gridEdits.size) await saveGrid(true); await calculateRun(); runTab = "result"; }
      const stamp = { calculated:{calculated_at:new Date().toISOString(), calculated_by:currentUser?.id||null},
                      approved:  {approved_at:new Date().toISOString(),   approved_by:currentUser?.id||null},
                      locked:    {locked_at:new Date().toISOString(),     locked_by:currentUser?.id||null} }[next];
      const { error } = await supabase.from("contract_pay_run")
        .update({ status:next, ...stamp }).eq("id", curRun.id);
      if(error) throw new Error(error.message);
      await loadAll(); await loadRun(curRun.id); draw();
      toast({calculated:"ประมวลผลงวดเรียบร้อย", approved:"อนุมัติงวดแล้ว", locked:"ล็อกงวดแล้ว"}[next],"success");
    } catch(e){ toast("ไม่สำเร็จ: "+e.message,"error"); }
  };

  // เอกสาร — โหลดตอนกด ไม่ถ่วงหน้าแรก
  const docs = async () => await import("./contract-docs.js");
  // ผูก tax_id/bank เข้ากับ item ตอนออกเอกสาร (item เก็บสำเนาตัวเลข ส่วนเลขภาษีอยู่ที่ทะเบียนคน)
  const enrich = () => items.map(it => {
    const w = workers.find(x => x.id === it.worker_id) || {};
    const lines = adjusts.filter(a => a.worker_id === it.worker_id);
    return { ...it, lines: lines.length ? lines : null, tax_id: it.tax_id ?? w.tax_id,
             bank_name: it.bank_name ?? w.bank_name, bank_account: it.bank_account ?? w.bank_account };
  });
  window._docSlip = async () => (await docs()).payslips(curRun, enrich());
  window._doc50   = async () => (await docs()).wht50(curRun, enrich());
  window._docBank = async () => (await docs()).bankFile(curRun, enrich());
  window._docPnd  = async () => (await docs()).pnd3(curRun, enrich());

  window._cwNew  = () => workerForm(null);
  window._cwEdit = id => workerForm(workers.find(w=>w.id===id));
  window._cpAdj  = wid => workerPanel(wid);
  window._cwRec  = wid => recurringForm(wid);
  window._cdNew  = kind => codeForm(null, kind);
  window._cdEdit = id => codeForm(codeOf(id));
}

// คอลัมน์ tax_base มีเมื่อรัน schema_contract_items.sql แล้ว — ยังไม่รันก็บันทึกได้โดยไม่ส่งคอลัมน์นี้
const withoutTaxBase = r => { if(itemsReady) return r; const { tax_base, ...rest } = r; return rest; };

// คำนวณงวด — ดึงคนที่ใช้งานอยู่เข้ามา แล้วเขียนตัวเลขลง contract_pay_item
// เขียนทับของเดิมในงวดนี้เสมอ เพื่อให้กด "คำนวณ" ซ้ำได้หลังแก้รายการ
async function calculateRun() {
  const active = workers.filter(w => w.is_active);
  if(!active.length) throw new Error("ไม่มีรายชื่อที่ใช้งานอยู่ ให้เพิ่มคนก่อน");

  // รายการประจำ → คัดลอกลงงวดใหม่ทุกครั้งที่คำนวณ (ลบชุดเดิมของงวดนี้ก่อน กันซ้ำ) · รายการครั้งเดียวไม่แตะ
  if(itemsReady) {
    const activeIds = new Set(active.map(w => w.id));
    const rec = recurringFor(wItems, curRun.period).filter(i => activeIds.has(i.worker_id) && codeOf(i.code_id));
    const delR = await supabase.from("contract_pay_adjust").delete().eq("run_id", curRun.id).eq("source", "recurring");
    if(delR.error) throw new Error(delR.error.message);
    if(rec.length) {
      const insR = await supabase.from("contract_pay_adjust")
        .insert(rec.map(i => ({ ...adjustFromRecurring(i, codeOf(i.code_id), curRun.id), created_by: currentUser?.id||null })));
      if(insR.error) throw new Error(insR.error.message);
    }
  }
  const { data: adj } = await supabase.from("contract_pay_adjust")
    .select("*").eq("run_id", curRun.id);
  const byWorker = {};
  for(const a of (adj||[])) (byWorker[a.worker_id] ||= []).push(a);

  const rows = active.map(w => ({
    run_id: curRun.id, worker_id: w.id,
    worker_code: w.worker_code, name_th: w.name_th, worker_type: w.worker_type,
    department: w.department, cost_code: w.cost_code,
    bank_name: w.bank_name, bank_account: w.bank_account,
    ...withoutTaxBase(calcItem(w, byWorker[w.id] || [])),
  }));

  const del = await supabase.from("contract_pay_item").delete().eq("run_id", curRun.id);
  if(del.error) throw new Error(del.error.message);
  const ins = await supabase.from("contract_pay_item").insert(rows);
  if(ins.error) throw new Error(ins.error.message);
}

// ---------- ฟอร์มคน ----------
function workerForm(w) {
  const isEdit = !!w;
  const el = document.createElement("div");
  el.className = "modal-overlay"; el.id = "cwModal";
  el.innerHTML = `<div class="modal">
    <div class="modal-header">
      <div class="modal-title">${isEdit?"แก้ไขข้อมูล":"เพิ่มคนใหม่"}</div>
      <button class="modal-close" onclick="document.getElementById('cwModal').remove()">✕</button>
    </div>
    <div class="modal-body"><div class="form-grid">
      <div class="form-group"><label class="form-label">รหัส *</label>
        <input id="cw_code" class="form-control" value="${esc(w?.worker_code||"")}" ${isEdit?"readonly":""} placeholder="CON001"></div>
      <div class="form-group"><label class="form-label">ประเภท *</label>
        <select id="cw_type" class="form-control">${Object.entries(TYPE).map(([k,v])=>
          `<option value="${k}" ${w?.worker_type===k?"selected":""}>${v.label}</option>`).join("")}</select></div>
      <div class="form-group"><label class="form-label">ชื่อ-นามสกุล (ไทย) *</label>
        <input id="cw_th" class="form-control" value="${esc(w?.name_th||"")}"></div>
      <div class="form-group"><label class="form-label">ชื่อ (อังกฤษ)</label>
        <input id="cw_en" class="form-control" value="${esc(w?.name_en||"")}"></div>
      <div class="form-group"><label class="form-label">เลขผู้เสียภาษี</label>
        <input id="cw_tax" class="form-control" value="${esc(w?.tax_id||"")}" placeholder="13 หลัก"></div>
      <div class="form-group"><label class="form-label">เบอร์โทร</label>
        <input id="cw_phone" class="form-control" value="${esc(w?.phone||"")}"></div>
      <div class="form-group"><label class="form-label">Division</label>
        <input id="cw_div" class="form-control" value="${esc(w?.division||"")}"></div>
      <div class="form-group"><label class="form-label">Department</label>
        <input id="cw_dept" class="form-control" value="${esc(w?.department||"")}"></div>
      <div class="form-group"><label class="form-label">Cost Code</label>
        <input id="cw_cc" class="form-control" value="${esc(w?.cost_code||"")}"></div>
      <div class="form-group"><label class="form-label">ค่าจ้างเหมา/เดือน (บาท) *</label>
        <input id="cw_rate" type="number" step="0.01" class="form-control" value="${w?.monthly_rate??""}"></div>
      <div class="form-group"><label class="form-label">ธนาคาร</label>
        <input id="cw_bank" class="form-control" value="${esc(w?.bank_name||"")}" placeholder="เช่น กสิกรไทย"></div>
      <div class="form-group"><label class="form-label">เลขที่บัญชี</label>
        <input id="cw_acct" class="form-control" value="${esc(w?.bank_account||"")}" placeholder="ไว้ออกไฟล์โอนเงิน"></div>
      <div class="form-group"><label class="form-label">วันเริ่มสัญญา</label>
        <input id="cw_start" type="date" class="form-control" value="${w?.start_date||""}"></div>
      <div class="form-group"><label class="form-label">วันสิ้นสุดสัญญา</label>
        <input id="cw_end" type="date" class="form-control" value="${w?.end_date||""}"></div>
      <div class="form-group col-span-2">
        <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600;">
          <input id="cw_wht" type="checkbox" ${w?w.wht_apply?"checked":"":"checked"} style="width:auto;margin:0;">
          หัก ณ ที่จ่าย <input id="cw_pct" type="number" step="0.01" value="${w?.wht_percent??3}"
            style="width:64px;padding:3px 6px;border:1px solid var(--border2);border-radius:5px;"> %
        </label>
        <div style="font-size:11px;color:var(--muted);margin-top:3px;">
          ตรวจจากไฟล์จริง ส.ค. 2569: หัก 3% แต่<b>ไม่ใช่ทุกคน</b> — ลูกจ้างชั่วคราวบางแผนกถูกหัก บางแผนกไม่ถูก
          จึงต้องกำหนดรายคน</div>
      </div>
      ${isEdit?`<div class="form-group col-span-2">
        <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600;">
          <input id="cw_active" type="checkbox" ${w.is_active?"checked":""} style="width:auto;margin:0;"> ใช้งานอยู่
        </label>
        <div style="font-size:11px;color:var(--muted);margin-top:3px;">ปิดแล้วจะไม่ถูกดึงเข้างวดใหม่ แต่งวดเก่ายังเก็บไว้</div>
      </div>`:""}
    </div></div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="document.getElementById('cwModal').remove()">ยกเลิก</button>
      <button class="btn btn-primary" onclick="window._cwSave(${w?.id||"null"})">บันทึก</button>
    </div>
  </div>`;
  document.getElementById("modalPortal").appendChild(el);

  window._cwSave = async id => {
    const g = i => document.getElementById(i)?.value?.trim() || "";
    const code = g("cw_code"), th = g("cw_th");
    if(!code){ toast("กรุณากรอกรหัส","error"); return; }
    if(!th){ toast("กรุณากรอกชื่อภาษาไทย","error"); return; }
    const data = {
      worker_code:code, name_th:th, name_en:g("cw_en")||null,
      worker_type:g("cw_type"), tax_id:g("cw_tax")||null, phone:g("cw_phone")||null,
      division:g("cw_div")||null, department:g("cw_dept")||null, cost_code:g("cw_cc")||null,
      bank_name:g("cw_bank")||null, bank_account:g("cw_acct")||null,
      monthly_rate:Number(g("cw_rate"))||0,
      wht_apply:document.getElementById("cw_wht").checked,
      wht_percent:Number(g("cw_pct"))||0,
      start_date:g("cw_start")||null, end_date:g("cw_end")||null,
      updated_at:new Date().toISOString(),
      ...(id?{ is_active:document.getElementById("cw_active").checked }:{ created_by:currentUser?.id||null }),
    };
    const { error } = id
      ? await supabase.from("contract_workers").update(data).eq("id", id)
      : await supabase.from("contract_workers").insert(data);
    if(error){ toast(error.message.includes("duplicate")?`มีรหัส ${code} อยู่แล้ว`:"บันทึกไม่สำเร็จ: "+error.message,"error"); return; }
    document.getElementById("cwModal").remove();
    await loadAll(); draw(); toast("บันทึกแล้ว","success");
  };
}

// ---------- ตารางกรอก: บันทึก / Excel ----------
// บันทึกช่องที่แก้: ค่า > 0 = เพิ่มหรือแก้ · ว่าง/0 = ลบ — แตะเฉพาะรายการครั้งเดียว (รายการประจำไม่อยู่ในตาราง)
async function saveCells(cells) {
  const ins = [], upd = [], del = [], skipped = [];
  for (const { wid, cid, amount } of cells) {
    const c = codeOf(cid); if (!c) continue;
    const ex = onceOf(wid, cid);
    if (ex.length > 1) { skipped.push(`${workers.find(w=>w.id===wid)?.worker_code} ${c.name_th}`); continue; }
    if (amount > 0) {
      if (ex.length) { if (Number(ex[0].amount) !== round2(amount)) upd.push({ id: ex[0].id, amount: round2(amount) }); }
      else ins.push({ run_id: curRun.id, worker_id: wid, kind: c.kind, label: c.name_th, amount: round2(amount), code_id: c.id, source: "once",
        taxable: c.kind === "earning" ? !!c.tax_effect : true, cuts_tax_base: c.kind === "deduction" && !!c.tax_effect, created_by: currentUser?.id || null });
    } else if (ex.length) del.push(ex[0].id);
  }
  if (ins.length) { const r = await supabase.from("contract_pay_adjust").insert(ins); if (r.error) throw new Error(r.error.message); }
  if (del.length) { const r = await supabase.from("contract_pay_adjust").delete().in("id", del); if (r.error) throw new Error(r.error.message); }
  for (const u of upd) { const r = await supabase.from("contract_pay_adjust").update({ amount: u.amount }).eq("id", u.id); if (r.error) throw new Error(r.error.message); }
  return { changed: ins.length + upd.length + del.length, skipped };
}
async function saveGrid(silent) {
  const cells = [...gridEdits].map(([k, v]) => { const [wid, cid] = k.split(":").map(Number); return { wid, cid, amount: Number(v) || 0 }; });
  const r = await saveCells(cells);
  gridEdits.clear();
  await loadRun(curRun.id);
  if (r.skipped.length) toast(`ข้าม ${r.skipped.length} ช่องที่มีหลายรายการ — แก้ในแผงรายคน`, "info");
  if (!silent) toast(`บันทึกแล้ว ${r.changed} รายการ`, "success");
  return r;
}
function wireGrid() {
  const pg = document.getElementById("pageContractpay"); if (!pg || !curRun) return;
  pg.querySelectorAll(".cp-in").forEach(inp => {
    inp.oninput = () => {
      const k = inp.dataset.k, [wid, cid] = k.split(":").map(Number), orig = onceOf(wid, cid)[0]?.amount;
      const v = inp.value === "" ? 0 : Number(inp.value);
      if ((Number(orig) || 0) === v) gridEdits.delete(k); else gridEdits.set(k, v);
      inp.parentElement.classList.toggle("dirty", gridEdits.has(k));
      const w = workers.find(x => x.id === wid); const net = pg.querySelector(`[data-net="${wid}"]`);
      if (w && net) net.textContent = money(previewOf(w).net_amount);
      const btn = pg.querySelector("#gxSave"); if (btn) { btn.disabled = !gridEdits.size; btn.textContent = `บันทึก${gridEdits.size ? ` (${gridEdits.size})` : ""}`; }
    };
    // Enter = ลงช่องถัดไปในคอลัมน์เดียวกัน (กรอกไล่ทีละคอลัมน์ได้เร็ว)
    inp.onkeydown = e => { if (e.key !== "Enter") return; e.preventDefault();
      const col = [...inp.closest("tr").children].indexOf(inp.parentElement);
      inp.closest("tr").nextElementSibling?.children[col]?.querySelector("input")?.focus(); };
  });
  pg.querySelector("#gxSave")?.addEventListener("click", async () => {
    try { await saveGrid(); if (curRun.status === "calculated") { await calculateRun(); await loadRun(curRun.id); toast("ประมวลผลใหม่ตามข้อมูลที่แก้แล้ว", "success"); } draw(); }
    catch (e) { toast("บันทึกไม่สำเร็จ: " + e.message, "error"); }
  });
  pg.querySelector("#gxFile")?.addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) importGrid(f); });
}
// แบบฟอร์ม Excel: แถว = คน · คอลัมน์ = รายการ (หัวคอลัมน์ขึ้นต้นด้วยรหัสรายการ ใช้จับคู่ตอนนำเข้า)
const gridCols = () => [...activeCodes("earning"), ...activeCodes("deduction")];
window._gxTemplate = () => {
  if (!window.XLSX) { toast("กำลังโหลด library Excel — ลองใหม่อีกครั้ง", "info"); return; }
  const cols = gridCols();
  const rows = gridWorkers().map(w => { const r = { "รหัส": w.worker_code, "ชื่อ": w.name_th };
    for (const c of cols) { const ex = onceOf(w.id, c.id); r[`${c.code} ${c.name_th}`] = ex.length ? ex.reduce((s, a) => s + Number(a.amount), 0) : ""; }
    return r; });
  const ws = window.XLSX.utils.json_to_sheet(rows, { header: ["รหัส", "ชื่อ", ...cols.map(c => `${c.code} ${c.name_th}`)] });
  ws["!cols"] = [{ wch: 10 }, { wch: 28 }, ...cols.map(() => ({ wch: 16 }))];
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "ก่อนประมวลผล");
  window.XLSX.writeFile(wb, `ค่าจ้างเหมา_ก่อนประมวลผล_${curRun.period}.xlsx`);
};
async function importGrid(file) {
  try {
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
    if (!rows.length) { toast("ไฟล์ว่าง", "error"); return; }
    const heads = Object.keys(rows[0]);
    const colMap = heads.map(h => [h, codes.find(c => c.is_active && String(h).trim().split(/\s+/)[0].toUpperCase() === c.code.toUpperCase())]).filter(([, c]) => c);
    const unknownCols = heads.filter(h => !["รหัส", "ชื่อ"].includes(h) && !colMap.some(([x]) => x === h));
    const pool = gridWorkers(), cells = [], unknownW = [], bad = [];
    for (const r of rows) {
      const code = String(r["รหัส"] || "").trim(); if (!code) continue;
      const w = pool.find(x => x.worker_code === code); if (!w) { unknownW.push(code); continue; }
      for (const [h, c] of colMap) {
        const raw = String(r[h] ?? "").replace(/,/g, "").trim(), v = raw === "" ? 0 : Number(raw);
        if (!Number.isFinite(v) || v < 0) { bad.push(`${code} · ${h}`); continue; }
        const cur = onceOf(w.id, c.id).reduce((s, a) => s + Number(a.amount), 0);
        if (round2(cur) !== round2(v)) cells.push({ wid: w.id, cid: c.id, amount: v });
      }
    }
    const msg = [`นำเข้าจาก ${file.name}`, `เปลี่ยนแปลง ${cells.length} ช่อง`,
      unknownW.length ? `ไม่พบรหัสในงวดนี้ ${unknownW.length} คน: ${unknownW.slice(0, 6).join(", ")}${unknownW.length > 6 ? " …" : ""}` : "",
      unknownCols.length ? `ไม่รู้จักคอลัมน์ (ข้าม): ${unknownCols.slice(0, 4).join(", ")}` : "",
      bad.length ? `ตัวเลขไม่ถูกต้อง (ข้าม) ${bad.length} ช่อง` : ""].filter(Boolean).join("\n");
    if (!cells.length) { alert(msg + "\n\nไม่มีอะไรเปลี่ยน"); return; }
    if (!confirm(msg + "\n\nช่องที่ว่างในไฟล์จะลบรายการเดิมของช่องนั้น — บันทึกเลยไหม?")) return;
    gridEdits.clear();
    const r = await saveCells(cells);
    await loadRun(curRun.id);
    if (curRun.status === "calculated") { await calculateRun(); await loadRun(curRun.id); }
    draw(); toast(`นำเข้าแล้ว ${r.changed} รายการ${r.skipped.length ? ` · ข้าม ${r.skipped.length}` : ""}`, "success");
  } catch (e) { toast("นำเข้าไม่สำเร็จ: " + e.message, "error"); }
}

// ---------- แผงรายละเอียดรายคนในงวด ----------
// กดแถวในงวดแล้วแผงเลื่อนออกจากขวา: รายได้ / รายหัก แยกตาราง พร้อมยอดสุทธิ
// เพิ่ม/ลบรายการครั้งเดียวได้ในแผงเลย และตัวเลขของคนนั้นคำนวณใหม่ทันที (ไม่ต้องกดคำนวณทั้งงวดซ้ำ)
function workerPanel(workerId) {
  const w = workers.find(x => x.id === workerId) || {};
  const it = items.find(x => x.worker_id === workerId);
  const editable = isEditable();
  const mine = linesFor(workerId);
  // ระหว่างแก้ไขได้: คิดจากข้อมูลคนปัจจุบัน (ตรงกับที่จะประมวลผล) · หลังอนุมัติ: ตัวเลขที่บันทึกในงวด
  const basis = editable || !it ? w : { monthly_rate: it.base_amount, wht_apply: Number(it.wht_percent) > 0, wht_percent: it.wht_percent };
  const r = calcItem(basis, mine);
  const earn = mine.filter(a => a.kind === "earning"), ded = mine.filter(a => a.kind === "deduction");
  const tag = a => [a.source === "recurring" ? `<span class="wp-tag rec" title="รายการประจำ — แก้ที่ รายชื่อ → รายการประจำ">↻ ประจำ</span>` : "",
    a.kind === "earning" && a.taxable === false ? `<span class="wp-tag">ไม่คิดภาษี</span>` : "",
    a.kind === "deduction" && a.cuts_tax_base ? `<span class="wp-tag">ลดฐานภาษี</span>` : ""].join("");
  const line = a => `<tr><td>${esc(a.label)} ${tag(a)}${a.remark?`<div class="wp-note">${esc(a.remark)}</div>`:""}</td>
    <td class="num">${money(a.amount)}</td>
    <td class="wp-x">${editable && a.source !== "recurring" ? `<button class="adj-del" data-del="${a.id}" title="ลบ">✕</button>` : ""}</td></tr>`;
  const opts = kind => activeCodes(kind).map(c => `<option value="${c.id}">${esc(c.code)} · ${esc(c.name_th)}</option>`).join("");

  document.getElementById("wpPanel")?.remove();
  const el = document.createElement("div");
  el.id = "wpPanel"; el.className = "wp-ov";
  el.innerHTML = `<div class="wp-back"></div><aside class="wp" role="dialog" aria-label="รายการของ ${esc(w.name_th||"")}">
    <header class="wp-h">
      <div><div class="wp-code">${esc(w.worker_code||it?.worker_code||"")} · ${badge(TYPE, w.worker_type||it?.worker_type)}</div>
        <div class="wp-name">${esc(w.name_th||it?.name_th||"")}</div>
        <div class="wp-sub">งวด ${esc(thMonth(curRun.period))} · ${Number(basis.wht_percent) && basis.wht_apply !== false ? `หัก ณ ที่จ่าย ${basis.wht_percent}%` : "ไม่หัก ณ ที่จ่าย"}</div></div>
      <button class="modal-close" data-close>✕</button>
    </header>
    <div class="wp-body">
      <div class="wp-cols">
        <section class="wp-card earn"><div class="wp-ct">รายได้</div>
          <table class="wp-t"><tr><td>ค่าจ้างเหมาประจำงวด</td><td class="num">${money(r.base_amount)}</td><td></td></tr>
            ${earn.map(line).join("")}
            <tr class="wp-tot"><td>รวมรายได้</td><td class="num">${money(r.base_amount + r.extra_amount)}</td><td></td></tr></table></section>
        <section class="wp-card ded"><div class="wp-ct">รายหัก</div>
          <table class="wp-t">${r.wht_amount ? `<tr><td>ภาษีหัก ณ ที่จ่าย ${r.wht_percent}% <span class="wp-tag">ฐาน ${money(r.tax_base)}</span></td><td class="num">${money(r.wht_amount)}</td><td></td></tr>` : ""}
            ${ded.map(line).join("")}
            ${!r.wht_amount && !ded.length ? `<tr><td class="text-muted">ไม่มีรายการหัก</td><td></td><td></td></tr>` : ""}
            <tr class="wp-tot"><td>รวมรายหัก</td><td class="num">${money(r.wht_amount + r.deduct_amount)}</td><td></td></tr></table></section>
      </div>
      <div class="wp-net"><span>ยอดโอนสุทธิ</span><b>${money(r.net_amount)}</b><em>บาท</em></div>
      ${editable ? (itemsReady && codes.length ? `
      <div class="wp-add"><div class="wp-ct">เพิ่มรายการเฉพาะงวดนี้</div>
        <div class="wp-addrow">
          <select id="wpCode" class="form-control"><optgroup label="รายได้">${opts("earning")}</optgroup><optgroup label="รายหัก">${opts("deduction")}</optgroup></select>
          <input id="wpAmt" type="number" step="0.01" min="0" class="form-control" placeholder="จำนวนเงิน">
        </div>
        <input id="wpNote" class="form-control" placeholder="หมายเหตุ (ไม่บังคับ) เช่น OT 12 ชม. / ค่าอุปกรณ์ชำรุด" style="margin-top:8px;">
        <div class="wp-hint" id="wpHint"></div>
        <button class="btn btn-primary" id="wpAddBtn" style="margin-top:10px;width:100%;">+ เพิ่มรายการ</button>
        <div class="wp-foot">รายการที่เกิดทุกเดือน (เช่น บังคับคดี) ตั้งเป็น “รายการประจำ” ที่หน้ารายชื่อ ระบบจะใส่ให้ทุกงวดเอง</div>
      </div>` : `<div class="cp-warn" style="margin-top:14px;">ยังไม่มีรายการให้เลือก — รัน sql/schema_contract_items.sql ก่อน</div>`)
      : `<div class="wp-foot" style="margin-top:14px;">${curRun.status === "locked" ? "🔒 งวดนี้ล็อกแล้ว แก้ไขไม่ได้" : "งวดนี้อนุมัติแล้ว แก้รายการไม่ได้"}</div>`}
    </div></aside>`;
  document.getElementById("modalPortal").appendChild(el);
  const close = () => { el.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = e => { if(e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  el.querySelector(".wp-back").onclick = close;
  el.querySelector("[data-close]").onclick = close;

  // บอกผลทางภาษีของรายการที่เลือก ก่อนกดเพิ่ม
  const hint = () => { const c = codeOf(+el.querySelector("#wpCode")?.value); const h = el.querySelector("#wpHint"); if(!c || !h) return;
    h.textContent = c.kind === "earning" ? (c.tax_effect ? "รายได้ · คิดภาษีหัก ณ ที่จ่าย" : "รายได้ · ไม่คิดภาษี (เช่นเบิกคืน)")
                                         : (c.tax_effect ? "รายหัก · ลดฐานภาษีด้วย" : "รายหัก · หักหลังคำนวณภาษี ไม่ลดฐาน"); };
  el.querySelector("#wpCode")?.addEventListener("change", hint); hint();

  // บันทึกแล้ว: งวดที่ประมวลผลแล้วประมวลผลใหม่ให้เอง ผลจึงตรงกับข้อมูลเสมอ
  const refresh = async () => {
    try { if(curRun.status === "calculated") await calculateRun(); } catch(e){ toast("ประมวลผลใหม่ไม่สำเร็จ: " + e.message, "error"); }
    await loadRun(curRun.id); draw(); workerPanel(workerId);
  };
  el.querySelector("#wpAddBtn")?.addEventListener("click", async () => {
    const c = codeOf(+el.querySelector("#wpCode").value), amt = Number(el.querySelector("#wpAmt").value);
    if(!c){ toast("เลือกรายการก่อน","error"); return; }
    if(!(amt > 0)){ toast("จำนวนเงินต้องมากกว่า 0","error"); return; }
    const earning = c.kind === "earning";
    const { error } = await supabase.from("contract_pay_adjust").insert({
      run_id: curRun.id, worker_id: workerId, kind: c.kind, label: c.name_th, amount: amt, code_id: c.id, source: "once",
      taxable: earning ? !!c.tax_effect : true, cuts_tax_base: !earning && !!c.tax_effect,
      remark: el.querySelector("#wpNote").value.trim() || null, created_by: currentUser?.id || null });
    if(error){ toast("เพิ่มไม่สำเร็จ: "+error.message,"error"); return; }
    toast(`เพิ่ม ${c.name_th} ${money(amt)} แล้ว`, "success"); refresh();
  });
  el.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    const { error } = await supabase.from("contract_pay_adjust").delete().eq("id", +b.dataset.del);
    if(error){ toast("ลบไม่สำเร็จ: "+error.message,"error"); return; }
    refresh();
  });
}

// ---------- รายการประจำรายคน ----------
const monthInput = (id, v) => `<input id="${id}" type="month" class="form-control" value="${esc(v||"")}">`;
function recurringForm(workerId) {
  const w = workers.find(x => x.id === workerId) || {};
  const now = new Date(), ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const mine = wItems.filter(i => i.worker_id === workerId).sort((a,b) => (b.is_active - a.is_active) || a.start_period.localeCompare(b.start_period));
  const state = i => !i.is_active ? ["ปิดแล้ว","off"] : i.end_period && i.end_period < ym ? ["สิ้นสุดแล้ว","off"] : i.start_period > ym ? ["ยังไม่เริ่ม","wait"] : ["มีผล","on"];
  const opts = kind => activeCodes(kind).map(c => `<option value="${c.id}">${esc(c.code)} · ${esc(c.name_th)}</option>`).join("");
  document.getElementById("recModal")?.remove();
  const el = document.createElement("div");
  el.className = "modal-overlay"; el.id = "recModal";
  el.innerHTML = `<div class="modal modal-lg">
    <div class="modal-header"><div class="modal-title">รายการประจำ — ${esc(w.name_th||"")}</div>
      <button class="modal-close" data-x>✕</button></div>
    <div class="modal-body">
      <div class="text-muted" style="font-size:12.5px;margin-bottom:12px;">ใส่ครั้งเดียว ระบบเติมให้ทุกงวดในช่วงที่กำหนดตอนกด “ประมวลผล” ·
        งวดที่ล็อกแล้วไม่เปลี่ยนตาม · ค่าจ้างเหมาประจำ (${money(w.monthly_rate)}) ตั้งที่ข้อมูลคน ไม่ต้องใส่ที่นี่</div>
      ${mine.length ? `<table class="data-table"><thead><tr><th>รายการ</th><th class="num">ต่องวด</th><th>ช่วงงวด</th><th>สถานะ</th><th></th></tr></thead><tbody>
        ${mine.map(i => { const c = codeOf(i.code_id) || {}, [st, cls] = state(i);
          return `<tr><td><span class="cp-chip ${c.kind||""}">${c.kind==="deduction"?"รายหัก":"รายได้"}</span> ${esc(c.name_th||"?")}${i.note?`<div class="text-sm text-muted">${esc(i.note)}</div>`:""}</td>
          <td class="num">${money(i.amount)}</td>
          <td style="white-space:nowrap;">${esc(thMonth(i.start_period))} – ${i.end_period ? esc(thMonth(i.end_period)) : "ไม่กำหนด"}</td>
          <td><span class="rec-st ${cls}">${st}</span></td>
          <td style="white-space:nowrap;">${i.is_active ? `<button class="btn btn-secondary btn-sm" data-stop="${i.id}">หยุด</button>` : ""}
            <button class="btn btn-secondary btn-sm" data-rdel="${i.id}" style="color:var(--red);">ลบ</button></td></tr>`; }).join("")}
      </tbody></table>` : `<div class="text-muted" style="padding:6px 0 4px;font-size:13px;">ยังไม่มีรายการประจำ</div>`}
      <div class="rec-new">
        <div class="wp-ct" style="margin-bottom:8px;">เพิ่มรายการประจำ</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">รายการ</label>
            <select id="rc_code" class="form-control"><optgroup label="รายหัก">${opts("deduction")}</optgroup><optgroup label="รายได้">${opts("earning")}</optgroup></select></div>
          <div class="form-group"><label class="form-label">จำนวนเงินต่องวด (บาท)</label>
            <input id="rc_amt" type="number" step="0.01" min="0" class="form-control"></div>
          <div class="form-group"><label class="form-label">เริ่มงวด</label>${monthInput("rc_start", ym)}</div>
          <div class="form-group"><label class="form-label">ถึงงวด <span class="text-muted">(ว่าง = ไม่มีกำหนด)</span></label>${monthInput("rc_end", "")}</div>
          <div class="form-group col-span-2"><label class="form-label">หมายเหตุ</label>
            <input id="rc_note" class="form-control" placeholder="เช่น คดีหมายเลขแดง … / เบิกล่วงหน้า 12,000 ผ่อน 4 งวด"></div>
        </div>
      </div>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" data-x>ปิด</button><button class="btn btn-primary" id="rcAdd">+ เพิ่มรายการประจำ</button></div>
  </div>`;
  document.getElementById("modalPortal").appendChild(el);
  el.querySelectorAll("[data-x]").forEach(b => b.onclick = () => el.remove());
  const again = async () => { await loadAll(); draw(); recurringForm(workerId); };
  el.querySelector("#rcAdd").onclick = async () => {
    const g = id => el.querySelector("#"+id).value.trim();
    const amt = Number(g("rc_amt")), start = g("rc_start"), end = g("rc_end");
    if(!(amt > 0)){ toast("จำนวนเงินต้องมากกว่า 0","error"); return; }
    if(!/^\d{4}-\d{2}$/.test(start)){ toast("เลือกงวดเริ่ม","error"); return; }
    if(end && end < start){ toast("งวดสิ้นสุดต้องไม่ก่อนงวดเริ่ม","error"); return; }
    const { error } = await supabase.from("contract_worker_items").insert({ worker_id: workerId, code_id: +g("rc_code"), amount: amt,
      start_period: start, end_period: end || null, note: g("rc_note") || null, created_by: currentUser?.id || null });
    if(error){ toast("เพิ่มไม่สำเร็จ: "+error.message,"error"); return; }
    toast("เพิ่มรายการประจำแล้ว — มีผลตอนประมวลผลงวด","success"); again();
  };
  el.querySelectorAll("[data-stop]").forEach(b => b.onclick = async () => {
    const { error } = await supabase.from("contract_worker_items").update({ is_active:false }).eq("id", +b.dataset.stop);
    if(error){ toast("ไม่สำเร็จ: "+error.message,"error"); return; }
    again();
  });
  el.querySelectorAll("[data-rdel]").forEach(b => b.onclick = async () => {
    if(!confirm("ลบรายการประจำนี้? งวดที่คำนวณไปแล้วยังเก็บตัวเลขเดิมไว้")) return;
    const { error } = await supabase.from("contract_worker_items").delete().eq("id", +b.dataset.rdel);
    if(error){ toast("ลบไม่สำเร็จ: "+error.message,"error"); return; }
    again();
  });
}

// ---------- ตั้งค่ารายการได้ / หัก ----------
function codesHTML() {
  if(!itemsReady) return empty("ยังไม่ได้ตั้งระบบรายการ", "รัน sql/schema_contract_items.sql ใน Supabase แล้วเปิดหน้านี้ใหม่");
  const used = id => wItems.some(i => i.code_id === id);
  const card = (kind, title, effect) => {
    const list = codes.filter(c => c.kind === kind).sort((a,b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
    return `<div class="card cd-card ${kind}"><div class="cd-h"><div><div class="cd-t">${title}</div>
        <div class="text-muted" style="font-size:12px;">${list.filter(c=>c.is_active).length} รายการที่ใช้งาน</div></div>
      ${canEdit()?`<button class="btn btn-secondary btn-sm" onclick="window._cdNew('${kind}')">+ เพิ่มรายการ</button>`:""}</div>
      <table class="data-table"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>${effect}</th><th></th></tr></thead><tbody>
      ${list.map(c => `<tr style="${c.is_active?"":"opacity:.5;"}">
        <td><b style="font-size:12px;color:var(--blue);">${esc(c.code)}</b></td>
        <td>${esc(c.name_th)}${c.name_en?`<div class="text-sm text-muted">${esc(c.name_en)}</div>`:""}${!c.is_active?` <span class="badge badge-gray">ปิด</span>`:""}</td>
        <td>${c.tax_effect ? `<span class="cd-yes">✓ ${kind==="earning"?"คิดภาษี":"ลดฐานภาษี"}</span>` : `<span class="text-muted">${kind==="earning"?"ไม่คิดภาษี":"ไม่ลดฐาน"}</span>`}</td>
        <td>${canEdit()?`<button class="btn btn-secondary btn-sm" onclick="window._cdEdit(${c.id})">แก้ไข</button>`:""}${used(c.id)?`<div class="text-sm text-muted" style="margin-top:2px;">มีรายการประจำใช้อยู่</div>`:""}</td>
      </tr>`).join("") || `<tr><td colspan="4" class="text-muted" style="padding:20px;text-align:center;">ยังไม่มีรายการ</td></tr>`}
      </tbody></table></div>`;
  };
  return `<div class="section mt-4">
    <div class="cd-intro">รายการที่ใช้ได้ในงวดค่าจ้างเหมา · เพิ่มรายการใหม่ได้เองไม่ต้องแก้ระบบ ·
      <b>คิดภาษี</b> = นำไปรวมฐานภาษีหัก ณ ที่จ่าย · <b>ลดฐานภาษี</b> = รายหักที่ทำให้ค่าจ้างจริงลดลง เช่นขาดงาน</div>
    <div class="cd-grid">${card("earning","รายได้","ภาษี 3%")}${card("deduction","รายหัก","ผลต่อภาษี")}</div></div>`;
}

function codeForm(c, kindNew) {
  const kind = c?.kind || kindNew, earning = kind === "earning";
  const next = () => { const n = codes.filter(x => x.kind === kind).map(x => +String(x.code).slice(1)).filter(n => n && n < 99);
    return `${earning?"E":"D"}${String((n.length ? Math.max(...n) : 0) + 1).padStart(2,"0")}`; };
  document.getElementById("cdModal")?.remove();
  const el = document.createElement("div");
  el.className = "modal-overlay"; el.id = "cdModal";
  el.innerHTML = `<div class="modal" style="max-width:480px;">
    <div class="modal-header"><div class="modal-title">${c ? "แก้ไขรายการ" : earning ? "เพิ่มรายการรายได้" : "เพิ่มรายการรายหัก"}</div>
      <button class="modal-close" data-x>✕</button></div>
    <div class="modal-body"><div class="form-grid">
      <div class="form-group"><label class="form-label">รหัส</label><input id="cd_code" class="form-control" value="${esc(c?.code || next())}" ${c?"readonly":""}></div>
      <div class="form-group"><label class="form-label">ลำดับแสดง</label><input id="cd_sort" type="number" class="form-control" value="${c?.sort_order ?? 50}"></div>
      <div class="form-group col-span-2"><label class="form-label">ชื่อ (ไทย) *</label><input id="cd_th" class="form-control" value="${esc(c?.name_th||"")}"></div>
      <div class="form-group col-span-2"><label class="form-label">ชื่อ (อังกฤษ)</label><input id="cd_en" class="form-control" value="${esc(c?.name_en||"")}"></div>
      <label class="cd-opt col-span-2"><input id="cd_tax" type="checkbox" ${c ? (c.tax_effect?"checked":"") : (earning?"checked":"")}>
        <span><b>${earning ? "นำไปคิดภาษีหัก ณ ที่จ่าย" : "ลดฐานภาษี"}</b><span class="text-muted">${earning
          ? "ปิดสำหรับเงินที่ไม่ใช่ค่าจ้าง เช่น เบิกคืนค่าใช้จ่าย"
          : "เปิดเมื่อเป็นค่าจ้างที่ไม่ได้จ่ายจริง เช่น หักขาดงาน · ปิดสำหรับ บังคับคดี เบิกล่วงหน้า ค่าปรับ"}</span></span></label>
      ${c ? `<label class="cd-opt col-span-2"><input id="cd_active" type="checkbox" ${c.is_active?"checked":""}>
        <span><b>ใช้งาน</b><span class="text-muted">ปิดแล้วจะไม่มีให้เลือกในงวดใหม่ — งวดเก่าและรายการประจำที่มีอยู่ไม่เปลี่ยน</span></span></label>` : ""}
    </div></div>
    <div class="modal-footer"><button class="btn btn-secondary" data-x>ยกเลิก</button><button class="btn btn-primary" id="cdSave">บันทึก</button></div></div>`;
  document.getElementById("modalPortal").appendChild(el);
  el.querySelectorAll("[data-x]").forEach(b => b.onclick = () => el.remove());
  el.querySelector("#cdSave").onclick = async () => {
    const g = id => el.querySelector("#"+id)?.value.trim() || "";
    if(!g("cd_code") || !g("cd_th")){ toast("ใส่รหัสและชื่อภาษาไทย","error"); return; }
    const row = { name_th: g("cd_th"), name_en: g("cd_en") || null, sort_order: Number(g("cd_sort")) || 50,
      tax_effect: el.querySelector("#cd_tax").checked, updated_at: new Date().toISOString(),
      ...(c ? { is_active: el.querySelector("#cd_active").checked } : { code: g("cd_code"), kind }) };
    const { error } = c ? await supabase.from("contract_pay_codes").update(row).eq("id", c.id)
                        : await supabase.from("contract_pay_codes").insert(row);
    if(error){ toast(/duplicate/.test(error.message) ? `มีรหัส ${g("cd_code")} อยู่แล้ว` : "บันทึกไม่สำเร็จ: "+error.message,"error"); return; }
    el.remove(); await loadAll(); draw(); toast("บันทึกแล้ว","success");
  };
}
