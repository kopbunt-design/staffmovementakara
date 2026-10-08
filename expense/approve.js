// ============================================================================
// HR Invoice Hub — หน้าอนุมัติจากลิงก์ในอีเมล (ไม่ต้อง login)
//   อ่าน/ตัดสินผ่าน exp_link_get / exp_link_decide เท่านั้น (anon อ่านตาราง exp_* ตรง ๆ ไม่ได้)
//   ลายเซ็นที่ลงคือของผู้อนุมัติที่ HR เลือกตอนส่ง · แจ้งผู้จัดทำทางกระดิ่ง (ใน SQL) + อีเมล (letter-notify)
// ============================================================================
import { supabase } from "../js/supabase-config.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TH_M = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const thDate = iso => { if (!iso) return "-"; const d = new Date(String(iso).slice(0, 10) + "T00:00:00"); return `${d.getDate()} ${TH_M[d.getMonth()]} ${d.getFullYear() + 543}`; };
const thTime = iso => iso ? new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "";
const app = document.getElementById("app");
const token = new URLSearchParams(location.search).get("t") || "";
let D = null;

function toast(msg, type = "") {
  const el = document.createElement("div"); el.className = `toast ${type}`; el.textContent = msg;
  document.getElementById("spToasts").appendChild(el); setTimeout(() => el.remove(), 5000);
}
const done = (ic, title, text) => { app.innerHTML = `<div class="card ap-done"><div class="ic">${ic}</div><h2>${title}</h2><p class="hint" style="font-size:14px">${text}</p></div>`; };
const inApp = () => D?.id ? `<a class="btn btn-s" href="/expense/#/invoice/${D.id}" style="margin-top:16px">เข้าสู่ระบบเพื่อเปิดใบนี้</a>` : "";

async function load() {
  if (!token) return done("🔗", "ลิงก์ไม่ครบ", "กรุณาเปิดจากปุ่มในอีเมลขออนุมัติอีกครั้ง");
  const { data, error } = await supabase.rpc("exp_link_get", { p_token: token });
  if (error) return done("⚠️", "เปิดใบแจ้งหนี้ไม่ได้", esc(error.message));
  if (data?.error) return done("🔗", esc(data.error), "ลิงก์อาจถูกแทนด้วยลิงก์ใหม่ เช่น ใบถูกดึงกลับแล้วส่งใหม่ — ใช้ลิงก์จากอีเมลฉบับล่าสุด");
  D = data; render();
}

function render() {
  const d = D, v = d.vendor || {}, wr = Number(d.wht_rate) || 0;
  const state = d.state === "open" ? "" :
    d.state === "expired" ? `<div class="note r">ลิงก์นี้หมดอายุแล้ว — เข้าสู่ระบบเพื่ออนุมัติแทน<br>${inApp()}</div>` :
    d.status === "approved" || d.status === "received" ? `<div class="note">✓ ใบนี้อนุมัติแล้ว${d.approver?.at ? " เมื่อ " + esc(thTime(d.approver.at)) : ""}</div>` :
    d.status === "rejected" ? `<div class="note r">↩ ใบนี้ถูกส่งกลับให้แก้ไขแล้ว${d.reject_reason ? ": " + esc(d.reject_reason) : ""}</div>` :
    `<div class="note">ใบนี้ไม่ได้รออนุมัติแล้ว (สถานะปัจจุบันเปลี่ยนไป) — ไม่ต้องดำเนินการ</div>`;
  const kv = [["ผู้ขาย", `${esc(v.name || "-")}${v.code ? ` <span class="hint">· ${esc(v.code)}</span>` : ""}`], ["วันที่ใบ", thDate(d.inv_date)],
    ["หมวด", esc(d.category || "-")], ...(d.ref_no ? [["Ref. ผู้ขาย", `${esc(d.ref_no)}${d.ref_date ? ` (${thDate(d.ref_date)})` : ""}`]] : []),
    ...(d.po_no ? [["PO / PR", esc(d.po_no)]] : []), ...(d.note ? [["หมายเหตุ", esc(d.note)]] : []),
    ...(d.files ? [["ไฟล์แนบ", `${d.files} ไฟล์ <span class="hint">(ดูได้เมื่อเข้าสู่ระบบ)</span>`]] : [])];
  const signed = (s, label) => s?.name ? `<div><i>✓</i><span><b>${label}</b> ${esc(s.name)} <span class="hint">· ${esc(thTime(s.at))}</span></span></div>` : "";
  app.innerHTML = `
  <div class="ap-hero"><div><span class="bd ${d.state === "open" ? "p" : "n"}">${d.state === "open" ? "รอท่านอนุมัติ" : "ไม่ต้องดำเนินการ"}</span>
      <h1 style="margin-top:8px">ใบแจ้งหนี้ ${esc(d.inv_no || "")}</h1><div class="hint">ผู้อนุมัติ: ${esc(d.approver_name || "-")}</div></div>
    <div class="ap-net"><span>ยอดชำระ (THB)</span><b>${money(d.net)}</b></div></div>
  ${state}
  <div class="card card-b"><dl class="ap-kv">${kv.map(([k, x]) => `<dt>${k}</dt><dd>${x}</dd>`).join("")}</dl></div>
  <div class="card card-b"><div class="card-t">รายการ</div><div class="ap-scroll"><table class="ap-lines">
    <thead><tr><th>รายละเอียด</th><th>จำนวนเงิน</th><th>VAT 7%</th><th>WHT ${wr}%</th><th>สุทธิ</th></tr></thead><tbody>
    ${(d.lines || []).map(l => `<tr><td>${l.cost_code ? `<small>${esc(l.cost_code)}</small>` : ""}${esc(l.detail)}${l.detail2 ? `<small>${esc(l.detail2)}</small>` : ""}</td>
      <td>${money(l.amount)}</td><td>${Number(l.vat) ? money(l.vat) : "–"}</td><td>${Number(l.wht) ? money(l.wht) : "–"}</td><td>${money(l.net)}</td></tr>`).join("")}
    <tr class="tot"><td>รวม</td><td>${money(d.amount)}</td><td>${money(d.vat)}</td><td>${money(d.wht)}</td><td>${money(d.net)}</td></tr>
  </tbody></table></div></div>
  <div class="card card-b"><div class="card-t">ลงนามแล้ว</div><div class="ap-steps">
    ${signed(d.preparer, "จัดทำ")}${signed(d.reviewer, "ตรวจ")}${signed(d.approver, "อนุมัติ")}</div></div>
  ${d.state === "open" ? `<div class="card card-b">
    <div class="hint" style="margin-bottom:12px">เมื่อกดอนุมัติ ระบบลงลายเซ็นของ <b>${esc(d.approver_name || "ผู้อนุมัติ")}</b> ในช่อง Approved by และแจ้งผู้จัดทำทันที · ลิงก์ใช้ได้ครั้งเดียว</div>
    <div class="ap-acts"><button class="btn btn-d" id="apNo">ส่งกลับแก้ไข</button><button class="btn btn-p" id="apYes">✓ อนุมัติและลงนาม</button></div></div>` : ""}`;
  if (d.state !== "open") return;
  document.getElementById("apYes").onclick = () => decide(true);
  document.getElementById("apNo").onclick = () => rejectForm();
}

function rejectForm() {
  const box = document.querySelector(".ap-acts").parentElement;
  box.innerHTML = `<label class="fld"><span>ส่งกลับให้ผู้จัดทำแก้ไข เพราะอะไร?</span><textarea class="in" id="apReason" rows="3" placeholder="เช่น ยอด WHT ไม่ตรงกับใบเสร็จ"></textarea></label>
    <div class="ap-acts" style="margin-top:12px"><button class="btn btn-s" id="apBack">ยกเลิก</button><button class="btn btn-d" id="apSend">ส่งกลับแก้ไข</button></div>`;
  document.getElementById("apReason").focus();
  document.getElementById("apBack").onclick = render;
  document.getElementById("apSend").onclick = () => {
    const r = document.getElementById("apReason").value.trim();
    if (!r) { toast("กรุณาระบุเหตุผล", "err"); return; }
    decide(false, r);
  };
}

async function decide(ok, reason = null) {
  if (ok && !confirm(`อนุมัติใบแจ้งหนี้ ${D.inv_no} ยอด ${money(D.net)} บาท และลงลายเซ็นของ ${D.approver_name || "ผู้อนุมัติ"}?`)) return;
  document.querySelectorAll(".ap-acts .btn").forEach(b => b.disabled = true);
  const { data, error } = await supabase.rpc("exp_link_decide", { p_token: token, p_ok: ok, p_reason: reason });
  if (error) { toast("ไม่สำเร็จ: " + error.message, "err"); document.querySelectorAll(".ap-acts .btn").forEach(b => b.disabled = false); return; }
  // อีเมลแจ้งผู้จัดทำ (ถ้าตั้งส่งอัตโนมัติไว้) — ไม่สำเร็จก็ไม่เป็นไร กระดิ่งในระบบแจ้งแล้ว
  supabase.functions.invoke("letter-notify", { body: { exp_token: token } }).catch(() => {});
  done(ok ? "✅" : "↩️", ok ? `อนุมัติ ${esc(data.inv_no)} แล้ว` : `ส่งกลับ ${esc(data.inv_no)} ให้แก้ไขแล้ว`,
       ok ? "ลายเซ็นของท่านลงในใบแล้ว ระบบแจ้งผู้จัดทำให้ส่งฝ่ายบัญชีต่อ · ปิดหน้านี้ได้เลย" : "ระบบแจ้งผู้จัดทำพร้อมเหตุผลแล้ว · ปิดหน้านี้ได้เลย");
}

load();
