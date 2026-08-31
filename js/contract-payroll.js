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
  calculated: { label:"คำนวณแล้ว",  color:"var(--blue)",      bg:"var(--blue-light)" },
  approved:   { label:"อนุมัติแล้ว",color:"var(--gold-dark)", bg:"var(--gold-light)" },
  locked:     { label:"ล็อกแล้ว",   color:"var(--green)",     bg:"var(--green-light)" },
};
const NEXT = { draft:"calculated", calculated:"approved", approved:"locked" };
const money = v => Number(v||0).toLocaleString("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2});
const round2 = v => Math.round((Number(v)||0) * 100) / 100;

// ---------------------------------------------------------------------------
// ตรรกะคำนวณ — ฟังก์ชันบริสุทธิ์ ไม่แตะ DOM/DB เพื่อให้เทสได้ตรง ๆ
//
// ฐานภาษี = ค่าจ้างประจำ + รายได้เพิ่มที่ติดธง taxable เท่านั้น
//   (รายได้เพิ่มบางอย่างไม่ต้องเสียภาษี เช่นเบิกค่าเดินทางคืน)
// รายการหักไม่ลดฐานภาษี — หักหลังคำนวณภาษีแล้ว
// สุทธิ = ค่าจ้าง + ได้เพิ่มทั้งหมด − ภาษี − หัก
// ---------------------------------------------------------------------------
export function calcItem(worker, adjusts = []) {
  const base    = round2(worker.monthly_rate);
  const earn    = adjusts.filter(a => a.kind === "earning");
  const deduct  = adjusts.filter(a => a.kind === "deduction");
  const extra   = round2(earn.reduce((s,a) => s + Number(a.amount||0), 0));
  const deducted= round2(deduct.reduce((s,a) => s + Number(a.amount||0), 0));

  const taxBase = round2(base + earn.filter(a => a.taxable !== false)
                                    .reduce((s,a) => s + Number(a.amount||0), 0));
  const pct     = worker.wht_apply ? Number(worker.wht_percent ?? 3) : 0;
  const wht     = round2(taxBase * pct / 100);
  const net     = round2(base + extra - wht - deducted);

  return { base_amount:base, extra_amount:extra, deduct_amount:deducted,
           wht_percent:pct, wht_amount:wht, net_amount:net };
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

async function loadAll() {
  const [w, r] = await Promise.all([
    supabase.from("contract_workers").select("*").order("worker_code"),
    supabase.from("contract_pay_run").select("*").order("period", { ascending:false }),
  ]);
  if (w.error || r.error) throw new Error((w.error || r.error).message);
  workers = w.data || []; runs = r.data || [];
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
    </div>
  </div>
  ${tab==="runs" ? (curRun ? runDetailHTML() : runListHTML()) : workerListHTML()}
  <div class="pb-4"></div>`;
  wire();
}

// ---------- รายชื่อคน ----------
function workerListHTML() {
  if(!workers.length) return empty("ยังไม่มีรายชื่อ", "กด “+ เพิ่มคน” เพื่อตั้งข้อมูลคนและค่าจ้างเหมาต่อเดือน");
  return `<div class="section mt-4"><div class="card"><div class="table-wrap">
    <table class="data-table">
      <thead><tr><th>รหัส</th><th>ชื่อ</th><th>ประเภท</th><th>แผนก</th><th>Cost Code</th>
        <th class="num">ค่าจ้าง/เดือน</th><th>หัก ณ ที่จ่าย</th><th>สถานะ</th>${canEdit()?"<th></th>":""}</tr></thead>
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
        <td>${w.is_active?`<span class="badge" style="color:var(--green);background:var(--green-light);">ใช้งาน</span>`
                         :`<span class="badge badge-gray">ปิด</span>`}</td>
        ${canEdit()?`<td><button class="btn btn-secondary btn-sm" onclick="window._cwEdit(${w.id})">แก้ไข</button></td>`:""}
      </tr>`).join("")}</tbody>
    </table>
  </div></div></div>`;
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
function runDetailHTML() {
  const t = runTotals(items);
  const st = curRun.status;
  const nx = NEXT[st];
  const nxLabel = { calculated:"คำนวณงวดนี้", approved:"อนุมัติงวด", locked:"ล็อกงวด (แก้ไม่ได้อีก)" }[nx];
  const editable = st === "draft" || st === "calculated";

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
        ${nx&&canEdit()?`<button class="btn ${nx==="locked"?"btn-gold":"btn-primary"}" onclick="window._crAdvance('${nx}')">${nxLabel}</button>`:""}
      </div>
    </div></div>
  </div>

  ${(curRun.status==="approved"||curRun.status==="locked")&&items.length?`
  <div class="section" style="padding-bottom:0;">
    <div class="cp-docs">
      <span class="cp-docs-t">เอกสารของงวดนี้</span>
      <button class="btn btn-secondary btn-sm" onclick="window._docSlip()">🧾 สลิปรายคน</button>
      <button class="btn btn-secondary btn-sm" onclick="window._docBank()">🏦 ไฟล์โอนธนาคาร</button>
      <button class="btn btn-secondary btn-sm" onclick="window._doc50()">📄 50 ทวิ</button>
      <button class="btn btn-secondary btn-sm" onclick="window._docPnd()">📋 ภ.ง.ด.3</button>
    </div>
  </div>`:""}

  <div class="section cp-sum">
    ${[["จำนวนคน",t.count,"คน"],["ยอดจ้างรวม",money(t.base),"บาท"],
       ["ได้เพิ่ม",money(t.extra),"บาท"],["รายการหัก",money(t.deduct),"บาท"],
       ["ภาษีหัก ณ ที่จ่าย",money(t.wht),"บาท"],["จ่ายสุทธิ",money(t.net),"บาท"]]
      .map(([l,v,u],i)=>`<div class="cp-stat${i===5?" net":""}">
        <span>${l}</span><b>${v}</b><em>${u}</em></div>`).join("")}
  </div>

  ${!items.length ? empty("งวดนี้ยังไม่มีรายการ",
      st==="draft" ? "กด “คำนวณงวดนี้” เพื่อดึงรายชื่อที่ใช้งานอยู่เข้ามาคำนวณ" : "ไม่มีข้อมูล")
  : `<div class="section"><div class="card"><div class="table-wrap">
    <table class="data-table">
      <thead><tr><th>รหัส</th><th>ชื่อ</th><th>ประเภท</th><th class="num">ค่าจ้าง</th>
        <th class="num">ได้เพิ่ม</th><th class="num">หัก</th><th class="num">ภาษี</th>
        <th class="num">สุทธิ</th>${editable&&canEdit()?"<th></th>":""}</tr></thead>
      <tbody>${items.map(it=>{
        const ad = adjusts.filter(a=>a.worker_id===it.worker_id);
        return `<tr>
        <td><b style="color:var(--blue);font-size:12px;">${esc(it.worker_code)}</b></td>
        <td>${esc(it.name_th)}${ad.length?`<div class="text-sm text-muted">${ad.map(a=>
          `${a.kind==="earning"?"+":"−"}${money(a.amount)} ${esc(a.label)}`).join(" · ")}</div>`:""}</td>
        <td>${badge(TYPE,it.worker_type)}</td>
        <td class="num">${money(it.base_amount)}</td>
        <td class="num">${it.extra_amount?money(it.extra_amount):"–"}</td>
        <td class="num">${it.deduct_amount?money(it.deduct_amount):"–"}</td>
        <td class="num">${it.wht_amount?`${money(it.wht_amount)}<div class="text-sm text-muted">${it.wht_percent}%</div>`:"–"}</td>
        <td class="num"><b>${money(it.net_amount)}</b></td>
        ${editable&&canEdit()?`<td><button class="btn btn-secondary btn-sm"
          onclick="window._cpAdj(${it.worker_id})">รายการ</button></td>`:""}
      </tr>`;}).join("")}</tbody>
    </table>
  </div></div></div>`}`;
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
  window._cpTab   = t => { tab = t; curRun = null; draw(); };
  window._crBack  = () => { curRun = null; draw(); };
  window._crOpen  = async id => { await loadRun(id); draw(); };

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
      if(next==="calculated") await calculateRun();
      const stamp = { calculated:{calculated_at:new Date().toISOString(), calculated_by:currentUser?.id||null},
                      approved:  {approved_at:new Date().toISOString(),   approved_by:currentUser?.id||null},
                      locked:    {locked_at:new Date().toISOString(),     locked_by:currentUser?.id||null} }[next];
      const { error } = await supabase.from("contract_pay_run")
        .update({ status:next, ...stamp }).eq("id", curRun.id);
      if(error) throw new Error(error.message);
      await loadAll(); await loadRun(curRun.id); draw();
      toast({calculated:"คำนวณงวดเรียบร้อย", approved:"อนุมัติงวดแล้ว", locked:"ล็อกงวดแล้ว"}[next],"success");
    } catch(e){ toast("ไม่สำเร็จ: "+e.message,"error"); }
  };

  // เอกสาร — โหลดตอนกด ไม่ถ่วงหน้าแรก
  const docs = async () => await import("./contract-docs.js");
  // ผูก tax_id/bank เข้ากับ item ตอนออกเอกสาร (item เก็บสำเนาตัวเลข ส่วนเลขภาษีอยู่ที่ทะเบียนคน)
  const enrich = () => items.map(it => {
    const w = workers.find(x => x.id === it.worker_id) || {};
    return { ...it, tax_id: it.tax_id ?? w.tax_id,
             bank_name: it.bank_name ?? w.bank_name, bank_account: it.bank_account ?? w.bank_account };
  });
  window._docSlip = async () => (await docs()).payslips(curRun, enrich());
  window._doc50   = async () => (await docs()).wht50(curRun, enrich());
  window._docBank = async () => (await docs()).bankFile(curRun, enrich());
  window._docPnd  = async () => (await docs()).pnd3(curRun, enrich());

  window._cwNew  = () => workerForm(null);
  window._cwEdit = id => workerForm(workers.find(w=>w.id===id));
  window._cpAdj  = wid => adjustForm(wid);
}

// คำนวณงวด — ดึงคนที่ใช้งานอยู่เข้ามา แล้วเขียนตัวเลขลง contract_pay_item
// เขียนทับของเดิมในงวดนี้เสมอ เพื่อให้กด "คำนวณ" ซ้ำได้หลังแก้รายการ
async function calculateRun() {
  const active = workers.filter(w => w.is_active);
  if(!active.length) throw new Error("ไม่มีรายชื่อที่ใช้งานอยู่ ให้เพิ่มคนก่อน");

  const { data: adj } = await supabase.from("contract_pay_adjust")
    .select("*").eq("run_id", curRun.id);
  const byWorker = {};
  for(const a of (adj||[])) (byWorker[a.worker_id] ||= []).push(a);

  const rows = active.map(w => ({
    run_id: curRun.id, worker_id: w.id,
    worker_code: w.worker_code, name_th: w.name_th, worker_type: w.worker_type,
    department: w.department, cost_code: w.cost_code,
    bank_name: w.bank_name, bank_account: w.bank_account,
    ...calcItem(w, byWorker[w.id] || []),
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

// ---------- รายการเพิ่ม/หักครั้งเดียว ----------
function adjustForm(workerId) {
  const w = workers.find(x=>x.id===workerId);
  const mine = adjusts.filter(a=>a.worker_id===workerId);
  const el = document.createElement("div");
  el.className = "modal-overlay"; el.id = "adjModal";
  el.innerHTML = `<div class="modal">
    <div class="modal-header">
      <div class="modal-title">รายการครั้งเดียว — ${esc(w?.name_th||"")}</div>
      <button class="modal-close" onclick="document.getElementById('adjModal').remove()">✕</button>
    </div>
    <div class="modal-body">
      <div class="text-muted" style="font-size:12px;margin-bottom:12px;">
        เฉพาะงวด ${esc(thMonth(curRun.period))} เท่านั้น ไม่ยกไปงวดหน้า ·
        <b>ต้องกด “คำนวณงวดนี้” อีกครั้ง</b>หลังเพิ่มรายการ ตัวเลขถึงจะอัปเดต
      </div>
      ${mine.length?`<div class="adj-list">${mine.map(a=>`
        <div class="adj-row">
          <span class="adj-kind ${a.kind}">${a.kind==="earning"?"+ ได้เพิ่ม":"− หัก"}</span>
          <span class="adj-label">${esc(a.label)}</span>
          ${a.kind==="earning"&&!a.taxable?`<span class="adj-tax">ไม่คิดภาษี</span>`:""}
          <span class="adj-amt">${money(a.amount)}</span>
          <button class="adj-del" onclick="window._adjDel(${a.id})" title="ลบ">✕</button>
        </div>`).join("")}</div>`:`<div class="text-muted" style="font-size:12.5px;padding:10px 0;">ยังไม่มีรายการ</div>`}
      <div class="adj-new">
        <select id="aj_kind" class="form-control" style="max-width:120px;">
          <option value="earning">ได้เพิ่ม</option><option value="deduction">หัก</option></select>
        <input id="aj_label" class="form-control" placeholder="เช่น โบนัส / หักค่าอุปกรณ์">
        <input id="aj_amt" type="number" step="0.01" class="form-control" placeholder="จำนวนเงิน" style="max-width:140px;">
        <button class="btn btn-primary" onclick="window._adjAdd(${workerId})">เพิ่ม</button>
      </div>
      <label style="display:flex;align-items:center;gap:7px;margin-top:9px;font-size:12px;cursor:pointer;">
        <input id="aj_taxable" type="checkbox" checked style="width:auto;margin:0;">
        นำไปคิดภาษีหัก ณ ที่จ่ายด้วย <span class="text-muted">(ปิดถ้าเป็นการเบิกเงินคืน)</span>
      </label>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="document.getElementById('adjModal').remove()">ปิด</button>
    </div>
  </div>`;
  document.getElementById("modalPortal").appendChild(el);

  const reopen = async () => {
    await loadRun(curRun.id);
    document.getElementById("adjModal")?.remove();
    draw(); adjustForm(workerId);
  };
  window._adjAdd = async wid => {
    const g = i => document.getElementById(i);
    const label = g("aj_label").value.trim(), amt = Number(g("aj_amt").value);
    if(!label){ toast("กรุณาใส่ชื่อรายการ","error"); return; }
    if(!(amt > 0)){ toast("จำนวนเงินต้องมากกว่า 0","error"); return; }
    const { error } = await supabase.from("contract_pay_adjust").insert({
      run_id:curRun.id, worker_id:wid, kind:g("aj_kind").value, label, amount:amt,
      taxable:g("aj_taxable").checked, created_by:currentUser?.id||null });
    if(error){ toast("เพิ่มไม่สำเร็จ: "+error.message,"error"); return; }
    reopen();
  };
  window._adjDel = async id => {
    const { error } = await supabase.from("contract_pay_adjust").delete().eq("id", id);
    if(error){ toast("ลบไม่สำเร็จ: "+error.message,"error"); return; }
    reopen();
  };
}
