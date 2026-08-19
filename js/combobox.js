// ===== Combobox: ช่อง select ที่พิมพ์ค้นหาได้ =====
// ใช้แทน <select> ที่ตัวเลือกเยอะจนไล่หาไม่ไหว (Division/Department/Section/Team/Position ฯลฯ)
//
// เข้ากันได้กับโค้ดเดิม: ค่าที่เลือกเก็บใน <input type="hidden" id={id}>
// ดังนั้น document.getElementById(id).value ยังอ่านได้เหมือน <select> เดิมทุกประการ
//
// รายการที่เด้งขึ้นมาวางไว้ที่ <body> แบบ position:fixed — ไม่ใช่ข้างในช่อง
// เพราะ .modal มี overflow-y:auto ถ้าวางข้างในจะโดนขอบ modal ตัดหายไปครึ่งรายการ
import { esc } from "./app.js";

const REG = new Map();   // id -> { items, onChange, allowFree, onCreate }
let panel = null;        // รายการลอย (ใช้ร่วมกันทุกช่อง มีได้ทีละอันเท่านั้น)
let cur = null;          // { id, list, active }

const norm = s => String(s ?? "").toLowerCase();
// item: { value, label, sub? }
const textOf = it => norm(it.label) + " " + norm(it.sub);

function ensurePanel(){
  if(panel) return panel;
  panel = document.createElement("div");
  panel.className = "cbx-panel";
  panel.hidden = true;
  document.body.appendChild(panel);
  // ใช้ mousedown ไม่ใช่ click — กัน blur ของช่องปิดรายการทิ้งก่อนคลิกจะทำงาน
  panel.addEventListener("mousedown", ev => {
    const row = ev.target.closest("[data-i]");
    if(!row) return;
    ev.preventDefault();
    choose(Number(row.dataset.i));
  });
  window.addEventListener("scroll", () => { if(cur) place(); }, true);
  window.addEventListener("resize", () => { if(cur) close(); });
  return panel;
}

const els = id => ({
  hid: document.getElementById(id),
  txt: document.getElementById(`${id}_txt`),
  box: document.getElementById(`${id}_cbx`),
});

function place(){
  const { txt } = els(cur.id);
  if(!txt) return close();
  const r = txt.getBoundingClientRect();
  const below = window.innerHeight - r.bottom;
  const h = Math.min(280, Math.max(below - 12, 160));
  const flip = below < 180 && r.top > below;   // ที่ด้านล่างไม่พอ -> เด้งขึ้นข้างบนแทน
  panel.style.left = `${r.left}px`;
  panel.style.width = `${r.width}px`;
  panel.style.maxHeight = `${flip ? Math.min(280, r.top - 12) : h}px`;
  if(flip){ panel.style.top = "auto"; panel.style.bottom = `${window.innerHeight - r.top + 4}px`; }
  else    { panel.style.bottom = "auto"; panel.style.top = `${r.bottom + 4}px`; }
}

// ไฮไลต์คำที่ค้นเจอในข้อความ เพื่อให้เห็นว่าตรงตรงไหน
function mark(text, terms){
  let out = esc(text);
  for(const t of terms){
    if(!t) continue;
    const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")})`, "ig");
    out = out.replace(re, "<mark>$1</mark>");
  }
  return out;
}

function paint(terms){
  const { hid } = els(cur.id);
  panel.innerHTML = cur.list.length ? cur.list.map((it,i)=>it.__create
    ? `<div data-i="${i}" class="cbx-item cbx-create${i===cur.active?" active":""}">
         <div class="cbx-item-main">➕ เพิ่ม “${esc(it.label)}” เข้า Master Data</div>
         <div class="cbx-item-sub">บันทึกไว้ใช้ครั้งต่อไป · แก้ชื่อ/รหัสภายหลังได้ที่หน้า Settings</div>
       </div>`
    : `<div data-i="${i}" class="cbx-item${i===cur.active?" active":""}${String(it.value)===String(hid.value)?" sel":""}">
      <div class="cbx-item-main">${mark(it.label, terms)}</div>
      ${it.sub?`<div class="cbx-item-sub">${mark(it.sub, terms)}</div>`:""}
    </div>`).join("")
    : `<div class="cbx-empty">ไม่พบตัวเลือกที่ตรงกับที่พิมพ์</div>`;
  panel.hidden = false;
}

function search(id, keepAll=false){
  const { txt } = els(id);
  const reg = REG.get(id); if(!reg) return;
  const raw = keepAll ? "" : txt.value.trim();
  const terms = raw ? raw.toLowerCase().split(/\s+/).filter(Boolean) : [];
  const list = (terms.length ? reg.items.filter(it=>terms.every(t=>textOf(it).includes(t))) : reg.items).slice();
  // พิมพ์ค่าที่ยังไม่มีในลิสต์ -> เสนอให้เพิ่มเข้า master data ได้เลย ไม่ต้องออกไปหน้าอื่น
  if(reg.onCreate && raw && !reg.items.some(it=>norm(it.label)===norm(raw)))
    list.push({ __create:true, value:raw, label:raw });
  cur = { id, list, active: list.length ? 0 : -1 };
  ensurePanel();
  place();
  paint(terms);
  els(id).box?.classList.add("open");
}

async function choose(i){
  if(!cur) return;
  const it = cur.list[i]; if(!it) return;
  const id = cur.id;
  const { hid, txt } = els(id);
  const reg = REG.get(id);
  close();
  if(it.__create){
    // ให้ผู้เรียกไปเพิ่มลง DB แล้วคืน item กลับมา · คืน null = เพิ่มไม่สำเร็จ ไม่ต้องเปลี่ยนค่า
    const made = await reg.onCreate(it.label);
    if(!made){ restore(id); return; }
    reg.items = [...reg.items, made];
    hid.value = made.value; txt.value = made.label;
    syncClear(id);
    reg.onChange?.(made.value, made);
    return;
  }
  hid.value = it.value;
  txt.value = it.label;
  syncClear(id);
  reg?.onChange?.(it.value, it);
}

function close(){
  if(panel){ panel.hidden = true; }
  if(cur) els(cur.id).box?.classList.remove("open");
  cur = null;
}

// ข้อความในช่องต้องตรงกับค่าที่เลือกเสมอ — พิมพ์ค้างแล้วไม่ได้เลือก ให้ดีดกลับ
function restore(id){
  const { hid, txt } = els(id);
  const reg = REG.get(id); if(!hid||!txt||!reg) return;
  const sel = reg.items.find(it=>String(it.value)===String(hid.value));
  if(sel){ txt.value = sel.label; }
  else if(reg.allowFree){ hid.value = txt.value.trim(); }  // พิมพ์เองได้ ไม่ต้องมีในลิสต์
  else { txt.value = ""; }
  syncClear(id);
}

function syncClear(id){
  const { hid, box } = els(id);
  box?.classList.toggle("has-val", !!hid?.value);
}

// ===== API =====

// สร้าง HTML ของช่อง — items: [{value,label,sub?}]
export function comboHTML(id, items, value="", placeholder="พิมพ์เพื่อค้นหา…"){
  const sel = items.find(it=>String(it.value)===String(value));
  return `<div class="cbx${sel?" has-val":""}" id="${id}_cbx">
    <input type="hidden" id="${id}" value="${esc(String(value ?? ""))}">
    <input type="text" id="${id}_txt" class="form-control cbx-input" autocomplete="off"
           placeholder="${esc(placeholder)}" value="${esc(sel?sel.label:"")}">
    <button type="button" class="cbx-clear" tabindex="-1" title="ล้างค่า">✕</button>
    <span class="cbx-caret" aria-hidden="true">▾</span>
  </div>`;
}

// ต่อสายหลังใส่ HTML ลง DOM แล้ว
// opts.allowFree = พิมพ์ค่าที่ไม่มีในลิสต์ได้ · opts.onCreate = async text => item|null (เพิ่มเข้า master)
export function bindCombo(id, items, onChange, opts = {}){
  REG.set(id, { items, onChange, allowFree: !!opts.allowFree, onCreate: opts.onCreate || null });
  const { txt, box } = els(id);
  if(!txt || !box) return;

  txt.addEventListener("focus", () => search(id, true));
  txt.addEventListener("input", () => search(id));
  txt.addEventListener("blur",  () => setTimeout(() => {
    if(cur?.id === id) close();
    restore(id);
  }, 120));
  txt.addEventListener("keydown", ev => {
    if(ev.key==="ArrowDown"||ev.key==="ArrowUp"){
      if(!cur||cur.id!==id){ search(id, true); return; }
      if(!cur.list.length) return;
      ev.preventDefault();
      cur.active = (cur.active + (ev.key==="ArrowDown"?1:-1) + cur.list.length) % cur.list.length;
      paint([]);
      panel.children[cur.active]?.scrollIntoView({block:"nearest"});
    } else if(ev.key==="Enter"){
      if(cur?.id===id && cur.active>=0){ ev.preventDefault(); choose(cur.active); }
    } else if(ev.key==="Escape"){
      if(cur?.id===id){ ev.preventDefault(); close(); restore(id); }
    }
  });
  box.querySelector(".cbx-clear")?.addEventListener("mousedown", ev => {
    ev.preventDefault();
    const { hid } = els(id);
    hid.value = ""; txt.value = "";
    syncClear(id);
    close();
    REG.get(id)?.onChange?.("", null);
  });
  box.querySelector(".cbx-caret")?.addEventListener("mousedown", ev => {
    ev.preventDefault();
    if(cur?.id===id) { close(); } else { txt.focus(); search(id, true); }
  });
  syncClear(id);
}

// เปลี่ยนรายการตัวเลือก (ใช้ตอน cascade เช่น เลือก Division แล้ว Department ต้องเปลี่ยนตาม)
export function setComboItems(id, items, value=""){
  const reg = REG.get(id);
  REG.set(id, { ...reg, items });
  const { hid } = els(id);
  if(hid) hid.value = items.some(it=>String(it.value)===String(value)) ? value : "";
  restore(id);
  if(cur?.id===id) close();
}

// แปลง master data / อาร์เรย์ข้อความ ให้เป็นรูปแบบ items
export const toItems = arr => arr.map(o => typeof o==="string"
  ? { value:o, label:o }
  : { value:o.name, label:o.name, sub:o.name_th||"" });
