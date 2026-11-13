// หน้าพนักงานโหลด 50 ทวิ ของตัวเอง — ไม่ต้อง login · ห้าม import js/app.js · user 2026-11-13
// รหัสพนักงาน + เลขประจำตัวผู้เสียภาษี 13 หลัก → rpc tax_my_certs (ผิด 8 ครั้ง / 30 นาที ล็อกรหัสนั้น · IP ที่ผิดบ่อยโดนแบนโดย guard)
import { supabase } from "../js/supabase-config.js";
import { cert50Page, cert50Doc, printHTML } from "./doc.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const B = v => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

$("#f").onsubmit = async ev => {
  ev.preventDefault();
  const code = $("#code").value.trim().toUpperCase(), tid = $("#tid").value.replace(/\D/g, "");
  if (tid.length !== 13) { $("#msg").textContent = "เลขประจำตัวประชาชนต้องมี 13 หลัก"; return; }
  $("#go").disabled = true; $("#msg").textContent = "";
  const { data, error } = await supabase.rpc("tax_my_certs", { p_emp_code: code, p_tax_id: tid });
  $("#go").disabled = false;
  if (error) { $("#msg").textContent = /LOCKED/.test(error.message) ? "ใส่ผิดหลายครั้ง — ลองใหม่ใน 30 นาที" : /429|too many|blocked/i.test(error.message) ? "เรียกใช้บ่อยเกินไป ลองใหม่ภายหลัง" : "เข้าไม่ได้ ลองใหม่อีกครั้ง"; return; }
  if (!data) { $("#msg").textContent = "รหัสพนักงานหรือเลขประจำตัวไม่ตรงกับข้อมูลของบริษัท"; return; }
  show(data);
};

function show(d) {
  $("#box").innerHTML = `<div class="hi">${esc(d.name)}</div><div class="note" style="margin:0 0 10px">กดเพื่อเปิดใบแล้วพิมพ์ หรือเลือก “บันทึกเป็น PDF” ในหน้าพิมพ์</div>
    ${d.certs.length ? d.certs.map((c, i) => `<div class="cert"><div><b>ปีภาษี ${c.year + 543}</b><small>เลขที่ ${c.no} · เงินได้ ${B((+c.inc401 || 0) + (+c.inc402 || 0) + (+c.sev || 0))} · ภาษี ${B((+c.tax || 0) + (+c.sev_tax || 0))}</small></div>
      <button data-i="${i}">เปิด / พิมพ์</button></div>`).join("") : `<p>ยังไม่มี 50 ทวิ ที่ออกให้ — บริษัทออกให้หลังสิ้นปีภาษี (หรือภายใน 1 เดือนหลังออกจากงาน)</p>`}
    <div class="note">ข้อมูลไม่ถูกต้อง ติดต่อฝ่ายบุคคล</div>`;
  document.querySelectorAll("[data-i]").forEach(b => b.onclick = () => { const c = d.certs[+b.dataset.i];
    printHTML(cert50Doc([cert50Page(c, d.settings || {}, d.art || {})], `50 ทวิ ${c.year + 543} ${d.name}`)); });
}
