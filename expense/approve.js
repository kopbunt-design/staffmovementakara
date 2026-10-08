// ============================================================================
// HR Invoice Hub — หน้าอนุมัติจากลิงก์ในอีเมล (ไม่ต้อง login)
//   อ่าน/ตัดสินผ่าน exp_link_get / exp_link_decide เท่านั้น (anon อ่านตาราง exp_* ตรง ๆ ไม่ได้)
//   ลายเซ็นที่ลงคือของผู้อนุมัติที่ HR เลือกตอนส่ง · แจ้งผู้จัดทำทางกระดิ่ง (ใน SQL) + อีเมล (letter-notify)
// ============================================================================
import { supabase } from "../js/supabase-config.js";
import { invoiceDoc } from "./doc.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TH_M = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const thDate = iso => { if (!iso) return "-"; const d = new Date(String(iso).slice(0, 10) + "T00:00:00"); return `${d.getDate()} ${TH_M[d.getMonth()]} ${d.getFullYear() + 543}`; };
const thTime = iso => iso ? new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "";
const app = document.getElementById("app");
const token = new URLSearchParams(location.search).get("t") || "";
let D = null;
// ไฟล์แนบ + รูปลายเซ็นอยู่ใน storage ส่วนตัว → ขอลิงก์ชั่วคราวจาก Edge Function ด้วย token (null = ยังโหลด, false = ขอไม่ได้)
let X = null;
const fmtSize = n => !n ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
const toData = url => fetch(url).then(r => r.ok ? r.blob() : null).then(b => b && new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); })).catch(() => "");

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
  try {
    const { data: x, error: e } = await supabase.functions.invoke("letter-notify", { body: { exp_token: token, action: "exp_files" } });
    if (e || !x?.files) throw e || new Error("no files");
    const sig = {};
    await Promise.all(Object.entries(x.sig || {}).map(async ([k, u]) => { sig[k] = u ? await toData(u) : ""; }));
    X = { files: Object.fromEntries(x.files.map(f => [f.id, f.url])), sig };
  } catch (_) { X = false; }
  drawDoc(); drawFiles();
}

// ใบ A4 จริง (หน้าเดียวกับที่พิมพ์) ย่อให้พอดีความกว้างจอ
function invDoc() { return invoiceDoc({ ...D, vendor: D.vendor || {} }, D.lines || [], X ? X.sig : {}); }
function drawDoc() {
  const box = document.getElementById("apDoc"); if (!box) return;
  box.innerHTML = `<iframe title="ใบแจ้งหนี้" scrolling="no"></iframe>`;
  const f = box.querySelector("iframe");
  const fit = () => {
    const h = f.contentDocument?.body?.scrollHeight || 1123, sc = Math.min(1, box.clientWidth / 794);
    f.style.height = h + "px"; f.style.transform = `scale(${sc})`; box.style.height = Math.ceil(h * sc) + "px";
  };
  f.onload = () => { fit(); f.contentDocument.fonts?.ready.then(fit); };
  f.srcdoc = invDoc();
  window.onresize = fit;
}
function drawFiles() {
  const box = document.getElementById("apFiles"); if (!box) return;
  const files = D.files || [];
  box.innerHTML = !files.length ? `<div class="hint">ไม่มีเอกสารแนบ</div>` : files.map(f => {
    const url = X && X.files[f.id];
    return `<div class="ap-file"><svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>
      <span><b>${esc(f.name)}</b><span class="hint">${fmtSize(f.size)}</span></span>
      ${url ? `<a class="btn btn-s btn-sm" href="${esc(url)}" target="_blank" rel="noopener noreferrer">เปิด</a>` : X === null ? `<span class="hint">กำลังโหลด…</span>` : `<span class="hint">เปิดไม่ได้</span>`}</div>`;
  }).join("") + (X === false ? `<div class="note r" style="margin-top:10px">ตอนนี้เปิดไฟล์แนบจากลิงก์นี้ไม่ได้ — แจ้ง HR หรือ${D.id ? ` <a href="/expense/#/invoice/${D.id}" style="text-decoration:underline">เข้าสู่ระบบเพื่อดู</a>` : "เข้าสู่ระบบเพื่อดู"}</div>` : "");
}

function render() {
  const d = D;
  const state = d.state === "open" ? "" :
    d.state === "expired" ? `<div class="note r">ลิงก์นี้หมดอายุแล้ว — เข้าสู่ระบบเพื่ออนุมัติแทน<br>${inApp()}</div>` :
    d.status === "approved" || d.status === "received" ? `<div class="note">✓ ใบนี้อนุมัติแล้ว${d.approver?.at ? " เมื่อ " + esc(thTime(d.approver.at)) : ""}</div>` :
    d.status === "rejected" ? `<div class="note r">↩ ใบนี้ถูกส่งกลับให้แก้ไขแล้ว${d.reject_reason ? ": " + esc(d.reject_reason) : ""}</div>` :
    `<div class="note">ใบนี้ไม่ได้รออนุมัติแล้ว (สถานะปัจจุบันเปลี่ยนไป) — ไม่ต้องดำเนินการ</div>`;
  const signed = (s, label) => s?.name ? `<div><i>✓</i><span><b>${label}</b> ${esc(s.name)} <span class="hint">· ${esc(thTime(s.at))}</span></span></div>` : "";
  app.innerHTML = `
  <div class="ap-hero"><div><span class="bd ${d.state === "open" ? "p" : "n"}">${d.state === "open" ? "รอท่านอนุมัติ" : "ไม่ต้องดำเนินการ"}</span>
      <h1 style="margin-top:8px">ใบแจ้งหนี้ ${esc(d.inv_no || "")}</h1><div class="hint">ผู้อนุมัติ: ${esc(d.approver_name || "-")}</div></div>
    <div class="ap-net"><span>ยอดชำระ (THB)</span><b>${money(d.net)}</b></div></div>
  ${state}
  <div class="card card-b"><div class="card-t" style="justify-content:space-between">ใบแจ้งหนี้ <button class="btn btn-g btn-sm" id="apFull">เปิดเต็มจอ ↗</button></div>
    <div class="ap-doc" id="apDoc"></div></div>
  <div class="card card-b"><div class="card-t">เอกสารแนบ <span class="hint">(${(d.files || []).length} ไฟล์)</span></div><div id="apFiles"></div></div>
  ${d.preparer || d.reviewer ? `<div class="card card-b"><div class="card-t">ลงนามแล้ว</div><div class="ap-steps">
    ${signed(d.preparer, "จัดทำ")}${signed(d.reviewer, "ตรวจ")}${signed(d.approver, "อนุมัติ")}</div></div>` : ""}
  ${d.state === "open" ? `<div class="card card-b">
    <div class="hint" style="margin-bottom:12px">ตรวจใบแจ้งหนี้และเอกสารแนบด้านบนก่อน · เมื่อกดอนุมัติ ระบบลงลายเซ็นของ <b>${esc(d.approver_name || "ผู้อนุมัติ")}</b> ในช่อง Approved by และแจ้งผู้จัดทำทันที · ลิงก์ใช้ได้ครั้งเดียว</div>
    <div class="ap-acts"><button class="btn btn-d" id="apNo">ส่งกลับแก้ไข</button><button class="btn btn-p" id="apYes">✓ อนุมัติและลงนาม</button></div></div>` : ""}`;
  drawDoc(); drawFiles();
  document.getElementById("apFull").onclick = () => {
    const u = URL.createObjectURL(new Blob([invDoc()], { type: "text/html" }));
    window.open(u, "_blank"); setTimeout(() => URL.revokeObjectURL(u), 60000);
  };
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
