// ลงนาม 50 ทวิ จากลิงก์อีเมล — ไม่ต้อง login · ห้าม import js/app.js · user 2026-11-18
// ลิงก์ = ผู้ลงนาม 1 คน ต่อปีภาษี · เห็นทุกใบที่รอคนนั้น · ลงทีละใบ / ที่เลือก / ทั้งหมด หรือส่งกลับพร้อมเหตุผล · ใช้ซ้ำได้จนลงครบหรือครบ 14 วัน
import { supabase } from "../js/supabase-config.js";
import { cert50Page, cert50Doc } from "./doc.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const B = v => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dTH = iso => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return `${d}/${m}/${y + 543}`; };
const token = new URLSearchParams(location.search).get("t") || "";
history.replaceState(null, "", location.pathname + "?t=" + encodeURIComponent(token));   // ไม่เก็บอะไรอื่นใน URL
let D = null, sel = new Set(), msg = null, returning = false;

const nm = c => c.person ? `${c.person.title || ""}${c.person.first_th || ""} ${c.person.last_th || ""}`.trim() : c.emp_code;
const inc = c => (+c.inc401 || 0) + (+c.inc402 || 0) + (+c.sev || 0), tax = c => (+c.tax || 0) + (+c.sev_tax || 0);

async function load() {
  const { data, error } = await supabase.rpc("tax_link_get", { p_token: token });
  if (error || !data || data.error) return screen("⚠️", "เปิดลิงก์ไม่ได้", error ? (/429|too many|blocked/i.test(error.message) ? "เรียกใช้บ่อยเกินไป ลองใหม่ภายหลัง" : "ลองใหม่อีกครั้ง หรือติดต่อฝ่ายบุคคล") : data?.error || "ลิงก์ไม่ถูกต้อง");
  D = data;
  $("#ttl").textContent = `ลงนาม 50 ทวิ ปีภาษี ${D.year + 543}`;
  $("#sub").textContent = `${D.signer.name}${D.signer.title ? " · " + D.signer.title : ""}`;
  for (const c of [...sel]) if (!D.certs.some(x => x.emp_code === c)) sel.delete(c);
  if (D.state === "expired") return screen("⏰", "ลิงก์หมดอายุแล้ว", "ติดต่อฝ่ายบุคคลให้ส่งลิงก์ใหม่");
  if (D.state === "noperm") return screen("🔒", "ยังลงนามไม่ได้", "บัญชีของท่านไม่มีสิทธิ์ลงนาม 50 ทวิ หรือยังไม่มีลายเซ็นในระบบ — ติดต่อฝ่ายบุคคล");
  if (D.state === "done") return screen("✅", "ไม่มีใบที่รอท่านลงนาม", `${msg?.ok ? msg.text + " · " : ""}ลงนามแล้วทั้งหมด ${D.signed} ใบในปีนี้ — ปิดหน้านี้ได้`);
  draw();
}
function screen(ic, h, p) { $("#box").innerHTML = `<div class="done"><div class="ic">${ic}</div><h2>${esc(h)}</h2><p>${esc(p)}</p></div>`; }

function draw() {
  const L = D.certs, n = sel.size, all = L.length && L.every(c => sel.has(c.emp_code));
  $("#box").innerHTML = `<div class="hd"><div><div class="k">รอท่านลงนาม</div><b>${L.length} ใบ</b>${D.signed ? ` <span class="k">· ลงแล้ว ${D.signed} ใบ</span>` : ""}</div>
      <div class="acts"><button class="btn" id="pvAll">ดูทั้งหมด</button><button class="btn btn-g" id="sgAll">ลงนามทั้งหมด ${L.length} ใบ</button></div></div>
    ${msg ? `<div class="msg ${msg.ok ? "ok" : "err"}">${esc(msg.text)}</div>` : ""}
    ${n ? `<div class="sel">เลือก <b>${n}</b> ใบ <button class="btn btn-sm btn-p" id="sgSel">ลงนามที่เลือก</button><button class="btn btn-sm" id="pvSel">ดูที่เลือก</button><button class="btn btn-sm" id="rtSel">ส่งกลับแก้ไข</button></div>` : ""}
    ${returning && n ? `<div class="ret"><b>ส่งกลับ ${n} ใบให้ฝ่ายบุคคลแก้ไข</b><textarea id="why" placeholder="เหตุผล เช่น ยอดเดือน ธ.ค. ยังไม่ครบ"></textarea>
      <div class="acts"><button class="btn" id="rtNo">ยกเลิก</button><button class="btn btn-p" id="rtGo">ส่งกลับ</button></div></div>` : ""}
    <div class="scroll"><table><thead><tr><th class="cb"><input type="checkbox" id="cAll" ${all ? "checked" : ""} aria-label="เลือกทั้งหมด"></th><th>เลขที่</th><th>ผู้ถูกหักภาษี</th><th class="r">เงินได้</th><th class="r">ภาษี</th><th></th></tr></thead><tbody>
    ${L.map(c => `<tr><td class="cb"><input type="checkbox" data-sel="${esc(c.emp_code)}" ${sel.has(c.emp_code) ? "checked" : ""}></td><td><b>#${esc(c.no)}</b></td>
      <td><b>${esc(nm(c))}</b><small>${esc(c.emp_code)}${c.requested_by_name ? ` · ส่งโดย ${esc(c.requested_by_name)}${c.requested_at ? " " + dTH(c.requested_at) : ""}` : ""}</small></td>
      <td class="r">${B(inc(c))}</td><td class="r">${B(tax(c))}</td>
      <td style="white-space:nowrap;text-align:right"><button class="btn btn-sm" data-pv="${esc(c.emp_code)}">ดูใบ</button> <button class="btn btn-sm btn-p" data-sg="${esc(c.emp_code)}">ลงนาม</button></td></tr>`).join("")}
    </tbody></table></div>
    <div class="note">ลงนามแล้วลายเซ็นของท่านจะอยู่ในใบ วันที่ในใบ = วันที่ลงนาม และพนักงานโหลดใบได้ทันที · ลิงก์นี้สำหรับท่านคนเดียว ใช้ได้ถึง ${dTH(D.expires_at)}</div>`;
  document.querySelectorAll("[data-sel]").forEach(b => b.onchange = () => { b.checked ? sel.add(b.dataset.sel) : sel.delete(b.dataset.sel); draw(); });
  $("#cAll").onchange = e => { L.forEach(c => e.target.checked ? sel.add(c.emp_code) : sel.delete(c.emp_code)); draw(); };
  document.querySelectorAll("[data-pv]").forEach(b => b.onclick = () => preview([b.dataset.pv]));
  document.querySelectorAll("[data-sg]").forEach(b => b.onclick = () => decide([b.dataset.sg], true));
  $("#pvAll").onclick = () => preview(L.map(c => c.emp_code));
  $("#sgAll").onclick = () => decide(L.map(c => c.emp_code), true);
  $("#sgSel") && ($("#sgSel").onclick = () => decide([...sel], true));
  $("#pvSel") && ($("#pvSel").onclick = () => preview([...sel]));
  $("#rtSel") && ($("#rtSel").onclick = () => { returning = true; draw(); $("#why").focus(); });
  $("#rtNo") && ($("#rtNo").onclick = () => { returning = false; draw(); });
  $("#rtGo") && ($("#rtGo").onclick = () => { const w = $("#why").value.trim(); if (!w) { $("#why").focus(); return; } decide([...sel], false, w); });
}

function preview(codes) {
  const cs = D.certs.filter(c => codes.includes(c.emp_code));
  const w = window.open("", "_blank");
  if (!w) { msg = { ok: false, text: "เบราว์เซอร์บล็อกหน้าต่างใหม่ — อนุญาต pop-up แล้วลองอีกครั้ง" }; draw(); return; }
  w.document.open(); w.document.write(cert50Doc(cs.map(c => cert50Page(c, D.settings || {}, {})), `50 ทวิ ${D.year + 543} (ตัวอย่างก่อนลงนาม)`)); w.document.close();
}

async function decide(codes, ok, why) {
  if (!codes.length) return;
  if (ok && !confirm(`ลงนาม 50 ทวิ ${codes.length} ใบ — ลายเซ็นของท่านจะลงในใบ และพนักงานโหลดได้ทันที`)) return;
  document.querySelectorAll("button").forEach(b => { b.disabled = true; });
  const { data, error } = await supabase.rpc("tax_link_decide", { p_token: token, p_codes: codes, p_ok: ok, p_reason: why || null });
  if (error) { msg = { ok: false, text: error.message }; await load(); return; }
  msg = { ok: true, text: ok ? `ลงนามแล้ว ${data.done.length} ใบ (วันที่ ${dTH(data.date)})` : `ส่งกลับแล้ว ${data.done.length} ใบ` };
  sel.clear(); returning = false;
  await load();
}

if (token.length < 40) screen("⚠️", "ลิงก์ไม่ถูกต้อง", "เปิดจากปุ่มในอีเมลอีกครั้ง หรือติดต่อฝ่ายบุคคล");
else load();
