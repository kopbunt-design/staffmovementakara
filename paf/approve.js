// ============================================================================
// Personnel Action Form — หน้าอนุมัติจากลิงก์ในอีเมล (ไม่ต้อง login)
//   อ่าน/ตัดสินผ่าน paf_link_get / paf_link_decide เท่านั้น (anon อ่านตาราง paf_* ตรง ๆ ไม่ได้)
//   ผลการกด = ในนามผู้อนุมัติของขั้นนั้นตามที่ HR เลือกตอนส่ง · หลังกดเรียก letter-notify (paf_token) ให้แจ้งขั้นถัดไป / HR
//   ห้าม import js/app.js
// ============================================================================
import { supabase } from "../js/supabase-config.js";
import { pafHTML, conditionLines, thLong, enLong } from "../js/paf-doc.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const app = document.getElementById("app");
const token = new URLSearchParams(location.search).get("t") || "";
let D = null;

function toast(msg, type = "") {
  const el = document.createElement("div"); el.className = `toast ${type}`; el.textContent = msg;
  document.getElementById("spToasts").appendChild(el); setTimeout(() => el.remove(), 5000);
}
const done = (ic, title, text) => { app.innerHTML = `<div class="card ap-done"><div class="ic">${ic}</div><h2>${title}</h2><p class="hint" style="font-size:14px">${text}</p></div>`; };
const me = () => (D.steps || []).find(s => s.step === D.link_step) || {};

async function load() {
  if (!token) return done("🔗", "ลิงก์ไม่ครบ · Incomplete link", "กรุณาเปิดจากปุ่มในอีเมลขออนุมัติอีกครั้ง · Please open the link from the approval email again");
  const { data, error } = await supabase.rpc("paf_link_get", { p_token: token });
  if (error) return done("⚠️", "เปิด PAF ไม่ได้ · Cannot open this PAF", esc(error.message));
  if (data?.error) return done("🔗", esc(data.error), "ลิงก์อาจถูกแทนด้วยลิงก์ใหม่ — ใช้ลิงก์จากอีเมลฉบับล่าสุด หรือติดต่อ HR<br>This link may have been replaced — use the latest email or contact HR");
  D = data; render();
}

const doc = () => pafHTML(D, D.log || [], { logo: new URL("/assets/logo.png", location.href).href, draft: D.status === "approved" ? "" : "รออนุมัติ" });
// ใบ A4 ย่อให้พอดีความกว้างจอ
function drawDoc() {
  const box = document.getElementById("apDoc"); if (!box) return;
  box.innerHTML = `<iframe title="Personnel Action Form" scrolling="no"></iframe>`;
  const f = box.querySelector("iframe");
  const fit = () => {
    const h = f.contentDocument?.body?.scrollHeight || 1123, sc = Math.min(1, box.clientWidth / 794);
    f.style.height = h + "px"; f.style.transform = `scale(${sc})`; box.style.height = Math.ceil(h * sc) + "px";
  };
  f.onload = () => { fit(); f.contentDocument.fonts?.ready.then(fit); };
  f.srcdoc = doc();
  window.onresize = fit;
}

function render() {
  const d = D, s = me(), { cur, rev } = conditionLines(d), last = (d.steps || []).length === d.link_step;
  const state = d.state === "open" ? "" :
    d.state === "expired" ? `<div class="note r">ลิงก์นี้หมดอายุแล้ว — ติดต่อ HR ให้ส่งลิงก์ใหม่ · This link has expired — please ask HR for a new one</div>` :
    d.status === "approved" ? `<div class="note">✓ PAF นี้อนุมัติครบทุกขั้นแล้ว · This PAF is fully approved</div>` :
    d.status === "rejected" ? `<div class="note r">↩ PAF นี้ถูกส่งกลับให้ HR แก้ไขแล้ว · Returned to HR${d.reject_reason ? ": " + esc(d.reject_reason) : ""}</div>` :
    d.status === "cancelled" ? `<div class="note r">PAF นี้ถูกยกเลิกแล้ว · This PAF was cancelled</div>` :
    `<div class="note">ท่านพิจารณาขั้นนี้แล้ว — ไม่ต้องดำเนินการ · You have already acted on this step</div>`;
  app.innerHTML = `
  <div class="ap-hero"><div><span class="bd ${d.state === "open" ? "p" : "n"}">${d.state === "open" ? `รอท่านพิจารณา · Awaiting your approval · Step ${d.link_step}` : "ไม่ต้องดำเนินการ · No action needed"}</span>
      <h1 style="margin-top:8px">${esc(d.doc_no || "")} · ${esc(d.name_th || "")}</h1><div class="hint">${esc(d.name_en || "")}</div><div class="hint">${esc(d.subject_th || "")}${d.subject_en ? ` · ${esc(d.subject_en)}` : ""}</div></div></div>
  ${state}
  <div class="card card-b"><dl class="ap-kv">
    <dt>พนักงาน<br><small>Employee</small></dt><dd>${esc(d.emp_code)} · ${esc([d.position, d.job_level].filter(Boolean).join(" · "))}</dd>
    <dt>เดิม<br><small>Current</small></dt><dd>${cur.map(esc).join("<br>") || "-"}</dd>
    <dt>ใหม่<br><small>Revised</small></dt><dd><b>${rev.map(esc).join("<br>") || "-"}</b></dd>
    <dt>วันที่มีผล<br><small>Effective</small></dt><dd>${esc(thLong(d.effective_date))} · ${esc(enLong(d.effective_date))}</dd>
    ${d.note_th || d.note_en ? `<dt>เหตุผล<br><small>Reason</small></dt><dd>${[d.note_en, d.note_th].filter(Boolean).map(esc).join("<br>")}</dd>` : ""}</dl></div>
  <div class="card card-b"><div class="card-t" style="justify-content:space-between">Personnel Action Form <button class="btn btn-g btn-sm" id="apFull">เปิดเต็มจอ ↗</button></div>
    <div class="ap-doc" id="apDoc"></div></div>
  ${d.state === "open" ? `<div class="card card-b">
    <div class="hint" style="margin-bottom:10px">เมื่อกดอนุมัติ ระบบบันทึกในนาม <b>${esc(s.name_th || "ผู้อนุมัติ")}</b>${s.title_th ? ` (${esc(s.title_th)})` : ""} ลงในบันทึกการอนุมัติ
      ${last ? "· เป็นขั้นสุดท้าย — ระบบบันทึกการเปลี่ยนแปลงลงทะเบียนพนักงานทันที" : "· แล้วส่งต่อให้ขั้นถัดไป"} · ลิงก์ใช้ได้ครั้งเดียว<br>
      Approving records this step under <b>${esc(s.name_en || s.name_th || "the approver")}</b>${s.title_en ? ` (${esc(s.title_en)})` : ""} in the approval record
      ${last ? "· final step — the change is applied to the employee record immediately" : "· then it goes to the next approver"} · this link works once</div>
    <label class="fld"><span>หมายเหตุ · Remark (ไม่บังคับ · optional — ต้องใส่เมื่อส่งกลับ · required when returning)</span><textarea class="in" id="apRemark" rows="2"></textarea></label>
    <div class="ap-acts" style="margin-top:12px"><button class="btn btn-d" id="apNo">ส่งกลับแก้ไข · Return</button><button class="btn btn-p" id="apYes">✓ อนุมัติ · Approve</button></div></div>` : ""}`;
  drawDoc();
  document.getElementById("apFull").onclick = () => {
    const u = URL.createObjectURL(new Blob([doc()], { type: "text/html" }));
    window.open(u, "_blank"); setTimeout(() => URL.revokeObjectURL(u), 60000);
  };
  if (d.state !== "open") return;
  document.getElementById("apYes").onclick = () => decide(true);
  document.getElementById("apNo").onclick = () => {
    const r = document.getElementById("apRemark").value.trim();
    if (!r) { toast("ใส่เหตุผลที่ส่งกลับในช่องหมายเหตุ · Please enter the reason in Remark", "err"); document.getElementById("apRemark").focus(); return; }
    decide(false);
  };
}

async function decide(ok) {
  const remark = document.getElementById("apRemark").value.trim() || null;
  if (ok && !confirm(`อนุมัติ ${D.doc_no} (${D.name_th}) ในนาม ${me().name_th || "ผู้อนุมัติ"}?\nApprove ${D.doc_no} (${D.name_en || D.name_th}) as ${me().name_en || me().name_th || "approver"}?`)) return;
  if (!ok && !confirm(`ส่ง ${D.doc_no} กลับให้ HR แก้ไข?\nReturn ${D.doc_no} to HR for revision?`)) return;
  document.querySelectorAll(".ap-acts .btn").forEach(b => b.disabled = true);
  const { data, error } = await supabase.rpc("paf_link_decide", { p_token: token, p_ok: ok, p_remark: remark });
  if (error) { toast("ไม่สำเร็จ · Failed: " + error.message, "err"); document.querySelectorAll(".ap-acts .btn").forEach(b => b.disabled = false); return; }
  // อีเมลแจ้งขั้นถัดไป / HR (ถ้าตั้งส่งอัตโนมัติไว้) — ไม่สำเร็จก็ไม่เป็นไร HR เห็นกระดิ่งในระบบ
  supabase.functions.invoke("letter-notify", { body: { paf_token: token } }).catch(() => {});
  done(ok ? "✅" : "↩️", ok ? `อนุมัติ ${esc(data.doc_no)} แล้ว · Approved` : `ส่งกลับ ${esc(data.doc_no)} ให้ HR แก้ไขแล้ว · Returned to HR`,
    ok ? (data.status === "approved" ? "อนุมัติครบทุกขั้นแล้ว ระบบแจ้ง HR ให้พิมพ์ให้พนักงานเซ็นรับทราบ · ปิดหน้านี้ได้เลย<br>Fully approved — HR has been notified. You can close this page."
                                       : "ระบบส่งต่อให้ผู้อนุมัติขั้นถัดไปแล้ว · ปิดหน้านี้ได้เลย<br>Sent to the next approver. You can close this page.")
       : "ระบบแจ้ง HR พร้อมเหตุผลแล้ว · ปิดหน้านี้ได้เลย<br>HR has been notified with your reason. You can close this page.");
}

load();
