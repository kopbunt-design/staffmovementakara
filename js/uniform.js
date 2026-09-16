import { supabase } from "./supabase-config.js";
import { allEmployees, can, esc, toast, currentUser } from "./app.js";

// ============================================================================
// สต๊อกยูนิฟอร์มพนักงาน
//
// ⚠️ ยอดคงเหลืออ่านจาก view `uniform_balance` เสมอ (= ผลรวมรายการเคลื่อนไหว)
//    ห้ามเก็บยอดเป็นคอลัมน์แล้วบวกลบทับ — จะเพี้ยนโดยไม่มีใครรู้และย้อนไม่ได้
//    DB มี trigger กันจ่ายเกินของที่มีอีกชั้น
// ============================================================================

const MOVE = {
  receive: { label:"รับเข้า",  sign:+1, color:"var(--green)",  bg:"var(--green-light)" },
  issue:   { label:"จ่ายออก",  sign:-1, color:"var(--red)",    bg:"var(--red-light)" },
  return:  { label:"รับคืน",   sign:+1, color:"var(--blue)",   bg:"var(--blue-light)" },
  adjust:  { label:"ปรับยอด",  sign:0,  color:"var(--purple)", bg:"var(--purple-light)" },
};
const n0 = v => Number(v||0).toLocaleString("th-TH");
const canEdit = () => can("data.uniform.write");

let balance = [], moves = [], tab = "stock", filterType = "", search = "";

async function loadAll() {
  const [b, m] = await Promise.all([
    // เรียงตาม sort_order — เรียงตามชื่อไซส์ไม่ได้ "10XL" จะมาก่อน "2XL"
    supabase.from("uniform_balance").select("*").order("item_type").order("sort_order"),
    supabase.from("uniform_move").select("*").order("moved_on", { ascending:false })
      .order("id", { ascending:false }).limit(300),
  ]);
  if(b.error || m.error) throw new Error((b.error||m.error).message);
  balance = b.data || []; moves = m.data || [];
}

export function renderUniform() { boot(); }

async function boot() {
  const pg = document.getElementById("pageUniform");
  pg.innerHTML = `<div class="section mt-4"><div class="card"><div class="card-body">กำลังโหลด…</div></div></div>`;
  try { await loadAll(); }
  catch(e) {
    pg.innerHTML = `<div class="section mt-4"><div class="card"><div class="card-body">
      <b>โหลดข้อมูลไม่สำเร็จ</b><div class="text-muted" style="margin-top:6px;">${esc(e.message)}</div>
      <div class="text-muted" style="margin-top:10px;font-size:12px;">
        ถ้ายังไม่ได้รัน <code>sql/schema_uniform.sql</code> ใน Supabase ให้รันก่อน</div>
    </div></div></div>`;
    return;
  }
  draw();
}

function draw() {
  const low = balance.filter(b => b.is_active && b.min_qty > 0 && b.qty < b.min_qty);
  const types = [...new Set(balance.map(b => b.item_type))];
  const pg = document.getElementById("pageUniform");
  pg.innerHTML = `
  <div class="page-header">
    <div><div class="page-heading">สต๊อกยูนิฟอร์ม</div>
      <div class="page-sub">${balance.length} รายการ · คงเหลือรวม ${n0(balance.reduce((s,b)=>s+b.qty,0))} ชิ้น</div></div>
    ${canEdit()?`<div class="header-actions">
      <button class="btn btn-secondary" onclick="window._uniMove('receive')">📥 รับเข้า</button>
      <button class="btn btn-primary" onclick="window._uniMove('issue')">📤 จ่ายให้พนักงาน</button>
    </div>`:""}
  </div>

  ${low.length?`<div class="section" style="padding-bottom:0;"><div class="uni-alert">
    <b>ใกล้หมด ${low.length} รายการ</b>
    <span>${low.map(b=>`${esc(b.item_type)} ${esc(b.size)} เหลือ ${b.qty}/${b.min_qty}`).join(" · ")}</span>
  </div></div>`:""}

  <div class="section" style="padding-top:12px;padding-bottom:0;">
    <div class="cp-tabs">
      <button class="cp-tab${tab==="stock"?" on":""}"   onclick="window._uniTab('stock')">ยอดคงเหลือ</button>
      <button class="cp-tab${tab==="history"?" on":""}" onclick="window._uniTab('history')">ประวัติการเคลื่อนไหว</button>
      <button class="cp-tab${tab==="byemp"?" on":""}"   onclick="window._uniTab('byemp')">ใครเบิกอะไรไปบ้าง</button>
    </div>
  </div>
  ${tab==="stock" ? stockHTML(types) : tab==="history" ? historyHTML() : byEmpHTML()}
  <div class="pb-4"></div>`;
  wire();
}

// ---------- ยอดคงเหลือ ----------
function stockHTML(types) {
  const rows = balance.filter(b => !filterType || b.item_type === filterType);
  const byType = {};
  for(const b of rows) (byType[b.item_type] ||= []).push(b);
  return `
  <div class="section" style="padding-top:12px;padding-bottom:0;">
    <div class="uni-filter">
      <button class="uni-chip${!filterType?" on":""}" onclick="window._uniType('')">ทั้งหมด</button>
      ${types.map(t=>`<button class="uni-chip${filterType===t?" on":""}" onclick="window._uniType('${esc(t)}')">${esc(t)}</button>`).join("")}
    </div>
  </div>
  <div class="section">${Object.entries(byType).map(([type, list])=>`
    <div class="card" style="margin-bottom:12px;"><div class="card-body">
      <div class="uni-th">
        <span class="card-title" style="margin:0;">${esc(type)}</span>
        <span class="uni-sub">คงเหลือรวม ${n0(list.reduce((s,b)=>s+b.qty,0))} ชิ้น · จ่ายไปแล้ว ${n0(list.reduce((s,b)=>s+b.issued_total,0))}</span>
      </div>
      <div class="uni-grid">${list.map(b=>{
        const lowQ = b.min_qty > 0 && b.qty < b.min_qty;
        const out  = b.qty <= 0;
        return `<div class="uni-cell${out?" out":lowQ?" low":""}" title="จ่ายไปแล้ว ${n0(b.issued_total)} ชิ้น">
          <div class="uni-size">${esc(b.size)}</div>
          <div class="uni-qty">${n0(b.qty)}</div>
          ${b.min_qty>0?`<div class="uni-min">ขั้นต่ำ ${n0(b.min_qty)}</div>`:`<div class="uni-min">&nbsp;</div>`}
        </div>`;}).join("")}</div>
    </div></div>`).join("")||`<div class="card"><div class="card-body" style="padding:40px;text-align:center;">
      <div class="empty-title">ยังไม่มีรายการ</div></div></div>`}
  </div>`;
}

// ---------- ประวัติ ----------
function historyHTML() {
  if(!moves.length) return emptyBox("ยังไม่มีการเคลื่อนไหว","กด “รับเข้า” เพื่อบันทึกของที่รับมา");
  const item = id => balance.find(b => b.id === id);
  return `<div class="section mt-4"><div class="card"><div class="table-wrap">
    <table class="data-table">
      <thead><tr><th>วันที่</th><th>ประเภทรายการ</th><th>ของ</th><th class="num">จำนวน</th>
        <th>พนักงาน</th><th>หมายเหตุ</th></tr></thead>
      <tbody>${moves.map(m=>{
        const it = item(m.item_id), c = MOVE[m.move_type] || {};
        return `<tr>
          <td style="white-space:nowrap;font-variant-numeric:tabular-nums;">${esc(m.moved_on)}</td>
          <td><span class="badge" style="color:${c.color};background:${c.bg};">${esc(c.label||m.move_type)}</span></td>
          <td>${it?`${esc(it.item_type)} <b>${esc(it.size)}</b>`:`<span class="text-muted">— ลบไปแล้ว —</span>`}</td>
          <td class="num"><b style="color:${m.qty>0?"var(--green)":"var(--red)"};">${m.qty>0?"+":""}${n0(m.qty)}</b></td>
          <td>${m.emp_code?`<span style="color:var(--blue);font-size:12px;">${esc(m.emp_code)}</span> ${esc(m.emp_name||"")}`:`<span class="text-muted">—</span>`}</td>
          <td class="text-muted">${esc(m.note||"")}</td>
        </tr>`;}).join("")}</tbody>
    </table>
  </div></div>${moves.length>=300?`<div class="text-muted" style="font-size:11.5px;padding:8px 2px;">
    แสดง 300 รายการล่าสุด</div>`:""}</div>`;
}

// ---------- สรุปรายคน ----------
function byEmpHTML() {
  const issued = moves.filter(m => m.emp_code);
  if(!issued.length) return emptyBox("ยังไม่มีการเบิก","จ่ายยูนิฟอร์มให้พนักงานแล้วจะมาแสดงที่นี่");
  const by = {};
  for(const m of issued){
    const k = m.emp_code;
    (by[k] ||= { code:k, name:m.emp_name, rows:[], total:0 });
    by[k].rows.push(m);
    by[k].total += -m.qty;            // จ่ายออกเป็นลบ กลับเครื่องหมายให้อ่านง่าย
    if(m.emp_name) by[k].name = by[k].name || m.emp_name;
  }
  const list = Object.values(by)
    .filter(e => !search || (e.code+" "+(e.name||"")).toLowerCase().includes(search.toLowerCase()))
    .sort((a,b) => b.total - a.total);
  const item = id => balance.find(b => b.id === id);
  return `
  <div class="section" style="padding-top:12px;padding-bottom:0;">
    <input class="form-control" style="max-width:340px;" placeholder="ค้นหารหัสหรือชื่อพนักงาน…"
           value="${esc(search)}" oninput="window._uniSearch(this.value)">
  </div>
  <div class="section">${list.map(e=>`
    <div class="card" style="margin-bottom:10px;"><div class="card-body">
      <div class="uni-th">
        <span><b style="color:var(--blue);font-size:12.5px;">${esc(e.code)}</b> ${esc(e.name||"")}</span>
        <span class="uni-sub">รับไปทั้งหมด ${n0(e.total)} ชิ้น</span>
      </div>
      <div class="uni-emp">${e.rows.map(m=>{
        const it = item(m.item_id);
        return `<span class="uni-tag${m.move_type==="return"?" ret":""}">
          ${it?`${esc(it.item_type)} ${esc(it.size)}`:"—"}
          <b>${m.qty>0?"คืน ":""}${n0(Math.abs(m.qty))}</b>
          <em>${esc(m.moved_on)}</em></span>`;}).join("")}</div>
    </div></div>`).join("")||emptyBox("ไม่พบพนักงานที่ตรงกับที่ค้น","")}
  </div>`;
}

const emptyBox = (t,s) => `<div class="section mt-4"><div class="card"><div class="card-body"
  style="padding:40px;text-align:center;"><div class="empty-title">${esc(t)}</div>
  ${s?`<div class="empty-sub" style="margin-top:6px;">${esc(s)}</div>`:""}</div></div></div>`;

// ---------------------------------------------------------------------------
// การกระทำ
// ---------------------------------------------------------------------------
function wire() {
  window._uniTab    = t => { tab = t; draw(); };
  window._uniType   = t => { filterType = t; draw(); };
  window._uniSearch = v => { search = v;
    const el = document.querySelector('input[oninput*="_uniSearch"]');
    const pos = el?.selectionStart; draw();
    const next = document.querySelector('input[oninput*="_uniSearch"]');
    if(next){ next.focus(); if(pos!=null) next.setSelectionRange(pos,pos); } };
  window._uniMove   = kind => moveForm(kind);
}

// ฟอร์มเดียวใช้ได้ทั้งรับเข้า/จ่ายออก/รับคืน/ปรับยอด — ต่างกันแค่ช่องพนักงานกับทิศทาง
function moveForm(kind) {
  const c = MOVE[kind];
  const needEmp = kind === "issue" || kind === "return";
  const types = [...new Set(balance.filter(b=>b.is_active).map(b=>b.item_type))];

  const el = document.createElement("div");
  el.className = "modal-overlay"; el.id = "uniModal";
  el.innerHTML = `<div class="modal">
    <div class="modal-header">
      <div class="modal-title">${esc(c.label)}ยูนิฟอร์ม</div>
      <button class="modal-close" onclick="document.getElementById('uniModal').remove()">✕</button>
    </div>
    <div class="modal-body">
      <div class="uni-kinds">${Object.entries(MOVE).map(([k,v])=>
        `<button class="uni-chip${k===kind?" on":""}" onclick="window._uniSwitch('${k}')">${esc(v.label)}</button>`).join("")}</div>

      <div class="form-grid" style="margin-top:14px;">
        <div class="form-group"><label class="form-label">ประเภท *</label>
          <select id="um_type" class="form-control" onchange="window._umType(this.value)">
            <option value="">— เลือก —</option>
            ${types.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("")}
          </select></div>
        <div class="form-group"><label class="form-label">ไซส์ *</label>
          <select id="um_size" class="form-control"><option value="">— เลือกประเภทก่อน —</option></select>
          <div id="um_bal" class="uni-balhint"></div></div>
        <div class="form-group"><label class="form-label">จำนวน *</label>
          <input id="um_qty" type="number" min="1" step="1" class="form-control" placeholder="เช่น 10"></div>
        <div class="form-group"><label class="form-label">วันที่</label>
          <input id="um_date" type="date" class="form-control" value="${new Date().toISOString().slice(0,10)}"></div>
      </div>

      <div id="um_empwrap" class="form-group" style="margin-top:12px;${needEmp?"":"display:none;"}">
        <label class="form-label">พนักงาน *</label>
        <input id="um_emp" class="form-control" autocomplete="off"
               placeholder="🔍 พิมพ์รหัสหรือชื่อ เช่น AKR170 หรือ สมชาย">
        <input type="hidden" id="um_empcode"><input type="hidden" id="um_empname">
        <div id="um_sugg" class="emp-sugg" style="display:none;"></div>
      </div>

      <div class="form-group" style="margin-top:12px;">
        <label class="form-label">หมายเหตุ</label>
        <input id="um_note" class="form-control" placeholder="${kind==='adjust'?'เช่น นับสต๊อกประจำปี พบขาด 2 ตัว':'ไม่บังคับ'}">
      </div>
      ${kind==="adjust"?`<div class="uni-hint">ปรับยอดใส่ได้ทั้งบวกและลบ — ใส่ <b>-2</b> ถ้านับแล้วของหายไป 2 ตัว</div>`:""}
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="document.getElementById('uniModal').remove()">ยกเลิก</button>
      <button class="btn btn-primary" onclick="window._umSave('${kind}')">บันทึก</button>
    </div>
  </div>`;
  document.getElementById("modalPortal").appendChild(el);

  if(kind === "adjust") document.getElementById("um_qty").removeAttribute("min");

  window._uniSwitch = k => { document.getElementById("uniModal").remove(); moveForm(k); };

  // เลือกประเภทแล้วไซส์ต้องแคบตาม + โชว์ยอดคงเหลือทันที
  window._umType = type => {
    const sizes = balance.filter(b => b.is_active && b.item_type === type);
    document.getElementById("um_size").innerHTML =
      `<option value="">— เลือก —</option>` +
      sizes.map(b=>`<option value="${b.id}">${esc(b.size)} (เหลือ ${n0(b.qty)})</option>`).join("");
    document.getElementById("um_bal").textContent = "";
  };
  document.getElementById("um_size").addEventListener("change", ev => {
    const b = balance.find(x => String(x.id) === ev.target.value);
    document.getElementById("um_bal").textContent = b ? `คงเหลือตอนนี้ ${n0(b.qty)} ชิ้น` : "";
  });

  if(needEmp) bindEmpSearch();
}

// ค้นหาพนักงาน — ใช้รูปแบบเดียวกับฟอร์ม Staff Movement (รหัสน้ำเงินนำหน้า + ไฮไลต์คำที่พิมพ์)
function bindEmpSearch() {
  const box = document.getElementById("um_emp"), sugg = document.getElementById("um_sugg");
  const pool = allEmployees.filter(e => e.emp_code)
    .map(e => ({ code:e.emp_code, name:[e.firstname_th,e.lastname_th].filter(Boolean).join(" "),
                 meta:[e.department,e.position].filter(Boolean).join(" · "),
                 q:`${e.emp_code} ${e.firstname_th||""} ${e.lastname_th||""} ${e.department||""}`.toLowerCase() }));
  let list = [], active = -1, terms = [];
  const hl = (t) => { let o = esc(t);
    for(const x of terms){ if(!x) continue;
      o = o.replace(new RegExp(`(${x.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")})`,"ig"), "<mark>$1</mark>"); }
    return o; };
  const close = () => { sugg.style.display = "none"; list = []; active = -1; };
  const pick = i => { const e = list[i]; if(!e) return;
    document.getElementById("um_empcode").value = e.code;
    document.getElementById("um_empname").value = e.name;
    box.value = `${e.code} — ${e.name}`; close(); };
  const paint = () => {
    sugg.innerHTML = list.length ? list.map((e,i)=>`
      <div data-i="${i}" class="emp-row${i===active?" active":""}">
        <div class="emp-line"><span class="emp-code">${hl(e.code)}</span><span class="emp-name">${hl(e.name)}</span></div>
        ${e.meta?`<div class="emp-meta">${hl(e.meta)}</div>`:""}
      </div>`).join("")
      : `<div class="emp-empty">ไม่พบพนักงานที่ตรงกับ “${esc(box.value.trim())}”</div>`;
    sugg.style.display = "block";
  };
  const search = () => {
    terms = box.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    list = (terms.length ? pool.filter(e => terms.every(t => e.q.includes(t))) : pool).slice(0,50);
    active = list.length ? 0 : -1; paint();
    // พิมพ์แก้แล้วต้องล้างค่าที่เลือกไว้ ไม่งั้นจะบันทึกคนเดิมทั้งที่ช่องแสดงคนใหม่
    document.getElementById("um_empcode").value = "";
  };
  box.addEventListener("input", search);
  box.addEventListener("focus", search);
  box.addEventListener("keydown", ev => {
    if(ev.key==="ArrowDown"||ev.key==="ArrowUp"){
      if(!list.length) return; ev.preventDefault();
      active = (active + (ev.key==="ArrowDown"?1:-1) + list.length) % list.length;
      paint(); sugg.children[active]?.scrollIntoView({block:"nearest"});
    } else if(ev.key==="Enter"){ if(active>=0){ ev.preventDefault(); pick(active); } }
    else if(ev.key==="Escape") close();
  });
  sugg.addEventListener("mousedown", ev => {
    const el = ev.target.closest("[data-i]"); if(!el) return;
    ev.preventDefault(); pick(Number(el.dataset.i));
  });
  box.addEventListener("blur", () => setTimeout(close, 150));
}

window._umSave = async kind => {
  const g = i => document.getElementById(i)?.value?.trim() || "";
  const itemId = Number(g("um_size"));
  const raw = Number(g("um_qty"));
  if(!itemId){ toast("กรุณาเลือกประเภทและไซส์","error"); return; }
  if(!raw || !Number.isInteger(raw)){ toast("จำนวนต้องเป็นจำนวนเต็มและไม่เป็น 0","error"); return; }
  if(kind !== "adjust" && raw < 0){ toast("จำนวนต้องมากกว่า 0","error"); return; }

  const needEmp = kind === "issue" || kind === "return";
  const code = g("um_empcode");
  if(needEmp && !code){ toast("กรุณาเลือกพนักงานจากรายการที่ค้นหา","error"); return; }

  // แปลงเป็นเลขมีเครื่องหมายตามชนิดรายการ — จ่ายออกเป็นลบ
  const qty = kind === "issue" ? -Math.abs(raw) : kind === "adjust" ? raw : Math.abs(raw);

  // เตือนก่อนถ้าจ่ายเกิน — DB มี trigger กันอีกชั้น แต่บอกด้วยข้อความที่อ่านรู้เรื่องกว่า
  const b = balance.find(x => x.id === itemId);
  if(qty < 0 && b && b.qty + qty < 0){
    toast(`จ่ายไม่ได้ — ${b.item_type} ${b.size} เหลือ ${b.qty} ชิ้น แต่จะจ่าย ${Math.abs(qty)}`,"error");
    return;
  }

  const { error } = await supabase.from("uniform_move").insert({
    item_id:itemId, move_type:kind, qty, moved_on:g("um_date") || new Date().toISOString().slice(0,10),
    emp_code:needEmp ? code : null, emp_name:needEmp ? g("um_empname") : null,
    note:g("um_note") || null, created_by:currentUser?.id || null,
  });
  if(error){
    toast(error.message.includes("ติดลบ") ? error.message.split("ERROR:").pop().trim()
        : "บันทึกไม่สำเร็จ: " + error.message, "error");
    return;
  }
  document.getElementById("uniModal").remove();
  await loadAll(); draw();
  toast(`${MOVE[kind].label} ${Math.abs(qty)} ชิ้น เรียบร้อย`, "success");
};
