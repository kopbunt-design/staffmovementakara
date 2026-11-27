// สั่งอาหารกะบ่าย / OT / ชุดอาหารแห้งกะดึก ของกลุ่ม (ไม่ต้อง login) · user 2026-11-26 · ห้าม import js/app.js
// ลิงก์ถาวรต่อกลุ่ม (HR เปลี่ยนได้) · เลือกวัน → ประเภท → ใส่รายชื่อ (ค้นจากพนักงานในแผนก หรือพิมพ์เอง) → บันทึก · ปิดรับตามเวลาที่ HR ตั้ง
import { supabase } from "../js/supabase-config.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const WD = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const dTH = d => `${+d.slice(8, 10)} ${TH_M[+d.slice(5, 7) - 1]} ${+d.slice(0, 4) + 543}`;
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const token = new URLSearchParams(location.search).get("t") || "";
history.replaceState(null, "", location.pathname + "?t=" + encodeURIComponent(token));
const ICON = { aft: "🍛", ot: "🌙", night: "🥤" };
let D = null, day = null, kind = null, rows = [], dirty = false;
const lsGet = k => { try { return localStorage.getItem(k) || ""; } catch (_) { return ""; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* ไม่เป็นไร */ } };

function toast(m, err) { const t = document.createElement("div"); t.className = "toast" + (err ? " err" : ""); t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 2600); }
const fail = (t, d) => { $("#sub").textContent = ""; $("#wrap").innerHTML = `<div class="card msg"><div style="font-size:40px">⚠️</div><h2>${esc(t)}</h2><p>${esc(d)}</p></div>`; };
const orders = (d, k) => D.orders.filter(o => o.d === d && o.kind === k);
const cnt = (d, k) => orders(d, k).reduce((t, o) => t + o.qty, 0);

async function load(keep) {
  const { data, error } = await supabase.rpc("cn_order_link_get", { p_token: token });
  if (error || !data || data.error) return fail("เปิดลิงก์ไม่ได้", error ? (/429|too many|blocked/i.test(error.message) ? "เรียกใช้บ่อยเกินไป ลองใหม่ภายหลัง" : "ลองใหม่อีกครั้ง หรือติดต่อ HR") : data.error);
  D = data;
  $("#ttl").textContent = `สั่งอาหาร · ${D.group.name}`;
  $("#sub").textContent = D.group.coord ? `ผู้ประสานงาน ${D.group.coord}` : "Akara Canteen";
  if (!keep) {
    const t = today();
    day = (D.days.find(x => x.d >= t && D.group.kinds.some(k => x.open[k])) || D.days.find(x => x.d === t) || D.days[1]).d;
    kind = D.group.kinds.find(k => D.days.find(x => x.d === day).open[k]) || D.group.kinds[0];
  }
  pick();
}
function pick() { rows = orders(day, kind).map(o => ({ ...o })); dirty = false; draw(); }
function draw() {
  const dd = D.days.find(x => x.d === day), open = dd.open[kind], t = today();
  $("#wrap").innerHTML = `<div class="card"><div class="days">${D.days.map(x => { const n = D.group.kinds.reduce((s, k) => s + cnt(x.d, k), 0);
      return `<button class="day ${x.d === day ? "on" : ""} ${x.d === t ? "today" : ""}" data-d="${x.d}"><small>${x.d === t ? "วันนี้" : WD[new Date(x.d + "T00:00:00Z").getUTCDay()]}</small><b>${+x.d.slice(8, 10)}</b><small>${TH_M[+x.d.slice(5, 7) - 1]}</small><i>${n ? n + " มื้อ" : ""}</i></button>`; }).join("")}</div>
    ${dd.menu_aft || dd.menu_night || dd.note ? `<div class="menu">${dd.menu_aft ? `<div><span>เมนูกะบ่าย</span><b>${esc(dd.menu_aft)}</b></div>` : ""}${dd.menu_night ? `<div><span>ชุดกะดึก</span><b>${esc(dd.menu_night)}</b></div>` : ""}${dd.note ? `<div><span>หมายเหตุ</span>${esc(dd.note)}</div>` : ""}</div>`
      : `<div class="menu"><div><span>เมนู</span><span style="width:auto;font-weight:400">ร้านยังไม่แจ้งเมนูของวันนี้</span></div></div>`}</div>
  <div class="card"><div class="tabs">${D.group.kinds.map(k => `<button class="tab ${k === kind ? "on" : ""}" data-k="${k}">${ICON[k]} ${esc(D.kinds[k])} <em>${D.prices[k]}฿${cnt(day, k) ? ` · ${cnt(day, k)}` : ""}</em></button>`).join("")}</div>
    <div class="st ${open ? "" : "closed"}">${open ? `สั่ง/แก้ได้ถึง ${dTH(day)} เวลา ${esc(D.cutoff[kind])} น.` : `ปิดรับ${esc(D.kinds[kind])}ของวันนี้แล้ว — ต้องการแก้ ติดต่อ HR`}</div>
    ${open ? `<div class="add"><input id="q" list="ppl" placeholder="พิมพ์ชื่อหรือรหัสพนักงาน แล้วกด เพิ่ม" autocomplete="off"><button class="btn btn-p" id="addB">เพิ่ม</button></div>
      <datalist id="ppl">${D.people.map(p => `<option value="${esc(p.name)} (${esc(p.code)})">`).join("")}</datalist>` : ""}
    <div class="list">${rows.map((r, i) => `<div class="row"><span class="n">${i + 1}</span><div class="nm"><b>${esc(r.name)}</b>${r.emp_code ? `<small>${esc(r.emp_code)}</small>` : ""}</div>
      ${open ? `<input class="q" type="number" min="1" max="200" value="${r.qty}" data-q="${i}" title="จำนวนมื้อ"><button class="x" data-x="${i}" aria-label="ลบ">×</button>` : `<b>${r.qty}</b>`}</div>`).join("")
      || `<div class="empty">ยังไม่มีรายชื่อ${open ? " — พิมพ์ชื่อด้านบน" : ""}</div>`}</div>
    ${open ? `<div class="tools"><button class="btn" id="copyY">ใช้รายชื่อจากวันก่อนหน้า</button><button class="btn" id="guest">+ แขก / ผู้รับเหมา (ใส่จำนวน)</button>${rows.length ? `<button class="btn" id="clr">ล้างทั้งหมด</button>` : ""}</div>` : ""}</div>`;
  const tot = rows.reduce((t, r) => t + (+r.qty || 0), 0);
  $("#bar").hidden = false;
  $("#tot").textContent = tot;
  $("#totS").textContent = `${D.kinds[kind]} · ${dTH(day)} · ${(tot * D.prices[kind]).toLocaleString("en-US")} บาท${dirty ? " · ยังไม่บันทึก" : ""}`;
  $("#save").disabled = !open || !dirty;
  $("#by").value = lsGet("cn_by");
  document.querySelectorAll("[data-d]").forEach(b => b.onclick = () => { if (dirty && !confirm("ยังไม่ได้บันทึก — เปลี่ยนวันเลยไหม")) return; day = b.dataset.d; pick(); });
  document.querySelectorAll("[data-k]").forEach(b => b.onclick = () => { if (dirty && !confirm("ยังไม่ได้บันทึก — เปลี่ยนประเภทเลยไหม")) return; kind = b.dataset.k; pick(); });
  document.querySelectorAll("[data-x]").forEach(b => b.onclick = () => { rows.splice(+b.dataset.x, 1); dirty = true; draw(); });
  document.querySelectorAll("[data-q]").forEach(b => b.onchange = () => { rows[+b.dataset.q].qty = Math.max(1, Math.min(200, +b.value || 1)); dirty = true; draw(); });
  if (!open) return;
  const q = $("#q");
  const add = () => {
    const v = q.value.trim(); if (!v) return;
    const m = v.match(/^(.*)\(([A-Za-z0-9]+)\)\s*$/), code = m ? m[2].toUpperCase() : (D.people.find(p => p.code.toUpperCase() === v.toUpperCase())?.code || null);
    const name = m ? m[1].trim() : (code ? D.people.find(p => p.code === code)?.name : v);
    if (code && rows.some(r => r.emp_code === code)) { toast("มีชื่อนี้แล้ว", true); q.select(); return; }
    rows.push({ emp_code: code, name, qty: 1 }); dirty = true; draw(); $("#q").focus();
  };
  $("#addB").onclick = add;
  q.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); add(); } };
  $("#copyY").onclick = () => {
    const prev = D.days.filter(x => x.d < day).reverse().find(x => cnt(x.d, kind));
    if (!prev) { toast("ไม่มีรายชื่อของวันก่อนหน้า", true); return; }
    const have = new Set(rows.map(r => r.emp_code || r.name));
    for (const o of orders(prev.d, kind)) if (!have.has(o.emp_code || o.name)) rows.push({ emp_code: o.emp_code, name: o.name, qty: o.qty });
    dirty = true; draw(); toast(`ดึงรายชื่อจาก ${dTH(prev.d)} แล้ว — ตรวจแล้วกดบันทึก`);
  };
  $("#guest").onclick = () => {
    const n = prompt("ชื่อ / บริษัท (เช่น ผู้รับเหมา ABC)"); if (!n || !n.trim()) return;
    const k = +prompt("จำนวน (มื้อ)", "1"); if (!(k > 0)) return;
    rows.push({ emp_code: null, name: n.trim(), qty: Math.min(200, Math.round(k)) }); dirty = true; draw();
  };
  $("#clr") && ($("#clr").onclick = () => { if (confirm("ล้างรายชื่อทั้งหมดของวันนี้?")) { rows = []; dirty = true; draw(); } });
}
$("#save").onclick = async () => {
  const by = $("#by").value.trim();
  if (!by) { toast("ใส่ชื่อผู้สั่งก่อน", true); $("#by").focus(); return; }
  lsSet("cn_by", by);
  $("#save").disabled = true;
  const { data, error } = await supabase.rpc("cn_order_link_decide", { p_token: token, p_d: day, p_kind: kind, p_rows: rows, p_by: by });
  if (error) { toast(error.message, true); $("#save").disabled = false; return; }
  toast(`บันทึกแล้ว ${data.n} มื้อ`);
  await load(true);
};
window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
load();
