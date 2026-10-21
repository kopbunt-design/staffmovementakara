// ============================================================================
// Payroll Register — หน้าลงนามจากลิงก์ในอีเมล (ไม่ต้อง login)
//   อ่าน/ตัดสินผ่าน pr_link_get / pr_link_decide เท่านั้น (anon อ่านตาราง payroll_* ตรง ๆ ไม่ได้)
//   รายงานที่แสดง = ตัวเดียวกับที่ HR พิมพ์ (registerDoc) สร้างจากยอดรวมระดับแผนกที่บันทึกไว้ (ไม่มีรายคน)
//   ลงนามในนามคนของขั้นนั้นตามที่ HR เลือกตอนส่ง · หลังกดเรียก letter-notify (pr_token) ให้แจ้งขั้นถัดไป / ผู้จัดทำ
//   ห้าม import js/app.js
// ============================================================================
import { supabase } from "../js/supabase-config.js";
import { repFromRows, grandExpense, netSalary, grandHeadcount } from "../js/payroll-build.js";
import { registerDoc, monthLabel, fmt, fmtI } from "../js/payroll-register-doc.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const app = document.getElementById("app");
const token = new URLSearchParams(location.search).get("t") || "";
let D = null, rep = null, SIG = {};

function toast(msg, type = "") {
  const el = document.createElement("div"); el.className = `toast ${type}`; el.textContent = msg;
  document.getElementById("spToasts").appendChild(el); setTimeout(() => el.remove(), 5000);
}
const done = (ic, title, text) => { app.innerHTML = `<div class="card ap-done"><div class="ic">${ic}</div><h2>${title}</h2><p class="hint" style="font-size:14px">${text}</p></div>`; };
const enDate = iso => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" }) : "";
const me = () => (D.steps || []).find(s => s.step === D.link_step) || {};

async function load() {
  if (!token) return done("🔗", "ลิงก์ไม่ครบ · Incomplete link", "กรุณาเปิดจากปุ่มในอีเมลอีกครั้ง · Please open the link from the email again");
  const { data, error } = await supabase.rpc("pr_link_get", { p_token: token });
  if (error) return done("⚠️", "เปิดรายงานไม่ได้ · Cannot open the report", esc(error.message));
  if (data?.error) return done("🔗", esc(data.error), "ลิงก์อาจถูกแทนด้วยลิงก์ใหม่ — ใช้ลิงก์จากอีเมลฉบับล่าสุด หรือติดต่อ HR<br>This link may have been replaced — use the latest email or contact HR");
  D = data;
  rep = repFromRows(D.rows || [], D.month);
  render();
  // รูปลายเซ็นของขั้นที่ลงนามแล้ว — ลิงก์ชั่วคราวจาก Edge Function (ด้วย token นี้)
  try {
    const { data: x } = await supabase.functions.invoke("letter-notify", { body: { pr_token: token, action: "pr_files" } });
    const out = {};
    await Promise.all(Object.entries(x?.sig || {}).map(async ([k, u]) => {
      if (!u) return;
      const b = await fetch(u).then(r => r.ok ? r.blob() : null).catch(() => null);
      if (b) out[k] = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
    }));
    SIG = out; drawDoc();
  } catch (_) { /* ไม่มีรูปก็ยังอ่านรายงานได้ */ }
}

const docSigners = () => (D.steps || []).map(s => ({ role: s.role, dept: s.dept, name: s.name, title: s.title,
  sig: s.signed_at ? SIG[String(s.step)] || "" : "", date: s.signed_at ? enDate(s.signed_at) : "" }));
const doc = () => registerDoc(rep, D.month, docSigners(), { logo: new URL("/assets/logo.png", location.href).href });

// รายงาน A4 แนวนอน (กว้าง 1123px) ย่อให้พอดีความกว้างจอ
function drawDoc() {
  const box = document.getElementById("apDoc"); if (!box) return;
  box.innerHTML = `<iframe title="Payroll Register" scrolling="no"></iframe>`;
  const f = box.querySelector("iframe");
  const fit = () => {
    const h = f.contentDocument?.body?.scrollHeight || 800, sc = Math.min(1, box.clientWidth / 1123);
    f.style.height = h + "px"; f.style.transform = `scale(${sc})`; box.style.height = Math.ceil(h * sc) + "px";
  };
  f.onload = () => { fit(); f.contentDocument.fonts?.ready.then(fit); };
  f.srcdoc = doc();
  window.onresize = fit;
}

function render() {
  const d = D, s = me(), last = (d.steps || []).length === d.link_step;
  const state = d.state === "open" ? "" :
    d.state === "expired" ? `<div class="note r">ลิงก์นี้หมดอายุแล้ว — ติดต่อ HR ให้ส่งลิงก์ใหม่ · This link has expired — please ask HR for a new one</div>` :
    d.status === "approved" ? `<div class="note">✓ รายงานนี้ลงนามครบแล้ว · Fully signed</div>` :
    d.status === "rejected" ? `<div class="note r">↩ รายงานนี้ถูกส่งกลับให้ HR แล้ว · Returned to HR${d.reject_reason ? ": " + esc(d.reject_reason) : ""}</div>` :
    `<div class="note">ท่านลงนามขั้นนี้แล้ว — ไม่ต้องดำเนินการ · You have already signed this step</div>`;
  const stepRow = x => `<div><i>${x.signed_at ? "✓" : x.step === d.cur_step ? "●" : "○"}</i><span><b>${esc(x.role || "")}</b> ${esc(x.name || "")}
    <span class="hint">· ${x.signed_at ? esc(enDate(x.signed_at)) : x.step === d.cur_step ? "รอลงนาม · Awaiting" : "—"}</span></span></div>`;
  app.innerHTML = `
  <div class="ap-hero"><div><span class="bd ${d.state === "open" ? "p" : "n"}">${d.state === "open" ? `รอท่านลงนาม · Awaiting your signature` : "ไม่ต้องดำเนินการ · No action needed"}</span>
      <h1 style="margin-top:8px">Payroll Register · ${esc(monthLabel(d.month))}</h1>
      <div class="hint">${esc(s.role || "")} — ${esc(s.name || "")}${s.title ? ` (${esc(s.title)})` : ""}</div></div>
    <div class="ap-net"><span>Net Salary (THB)</span><b>${fmt(netSalary(rep))}</b></div></div>
  ${state}
  <div class="card card-b"><dl class="ap-kv">
    <dt>ค่าใช้จ่ายรวม<br><small>Total Payroll Expense</small></dt><dd>${fmt(grandExpense(rep))}</dd>
    <dt>จ่ายสุทธิ<br><small>Net Salary</small></dt><dd><b>${fmt(netSalary(rep))}</b></dd>
    <dt>จำนวนคน<br><small>Headcount</small></dt><dd>${fmtI(grandHeadcount(rep))} persons</dd></dl></div>
  <div class="card card-b"><div class="card-t">ลำดับการลงนาม · Signatures</div><div class="ap-steps">${(d.steps || []).map(stepRow).join("")}</div></div>
  <div class="card card-b"><div class="card-t" style="justify-content:space-between">Payroll Register <button class="btn btn-g btn-sm" id="apFull">เปิดเต็มจอ · Full screen ↗</button></div>
    <div class="ap-doc" id="apDoc"></div></div>
  ${d.state === "open" ? `<div class="card card-b">
    <div class="hint" style="margin-bottom:10px">เมื่อกดลงนาม ระบบใส่ลายเซ็นของ <b>${esc(s.name || "")}</b> ในช่อง <b>${esc(s.role || "")}</b>
      ${last ? "· เป็นช่องสุดท้าย — รายงานลงนามครบ" : "· แล้วส่งต่อให้ช่องถัดไป"} · ลิงก์ใช้ได้ครั้งเดียว<br>
      Signing places <b>${esc(s.name || "")}</b>'s signature in the <b>${esc(s.role || "")}</b> box
      ${last ? "· final signature" : "· then it goes to the next signer"} · this link works once</div>
    <label class="fld"><span>หมายเหตุ · Remark (ต้องใส่เมื่อส่งกลับ · required when returning)</span><textarea class="in" id="apRemark" rows="2"></textarea></label>
    <div class="ap-acts" style="margin-top:12px"><button class="btn btn-d" id="apNo">ส่งกลับ · Return</button><button class="btn btn-p" id="apYes">✓ ลงนาม · Sign</button></div></div>` : ""}`;
  drawDoc();
  document.getElementById("apFull").onclick = () => {
    const u = URL.createObjectURL(new Blob([doc()], { type: "text/html" }));
    window.open(u, "_blank"); setTimeout(() => URL.revokeObjectURL(u), 60000);
  };
  if (d.state !== "open") return;
  document.getElementById("apYes").onclick = () => decide(true);
  document.getElementById("apNo").onclick = () => {
    if (!document.getElementById("apRemark").value.trim()) { toast("ใส่เหตุผลที่ส่งกลับ · Please enter the reason", "err"); document.getElementById("apRemark").focus(); return; }
    decide(false);
  };
}

async function decide(ok) {
  const remark = document.getElementById("apRemark").value.trim() || null, s = me();
  if (ok && !confirm(`ลงนาม Payroll Register ${monthLabel(D.month)} ในนาม ${s.name}?\nSign the ${monthLabel(D.month)} Payroll Register as ${s.name}?`)) return;
  if (!ok && !confirm(`ส่งรายงานกลับให้ HR?\nReturn the report to HR?`)) return;
  document.querySelectorAll(".ap-acts .btn").forEach(b => b.disabled = true);
  const { data, error } = await supabase.rpc("pr_link_decide", { p_token: token, p_ok: ok, p_remark: remark });
  if (error) { toast("ไม่สำเร็จ · Failed: " + error.message, "err"); document.querySelectorAll(".ap-acts .btn").forEach(b => b.disabled = false); return; }
  supabase.functions.invoke("letter-notify", { body: { pr_token: token } }).catch(() => {});
  done(ok ? "✅" : "↩️", ok ? "ลงนามแล้ว · Signed" : "ส่งกลับแล้ว · Returned to HR",
    ok ? (data.status === "approved" ? "ลงนามครบทุกช่องแล้ว ระบบแจ้ง HR แล้ว · ปิดหน้านี้ได้เลย<br>All signatures complete — HR has been notified. You can close this page."
                                     : "ระบบส่งต่อให้ผู้ลงนามช่องถัดไปแล้ว · ปิดหน้านี้ได้เลย<br>Sent to the next signer. You can close this page.")
       : "ระบบแจ้ง HR พร้อมเหตุผลแล้ว · ปิดหน้านี้ได้เลย<br>HR has been notified with your reason. You can close this page.");
}

load();
