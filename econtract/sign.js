// ============================================================================
// สัญญาจ้างงาน — หน้าลงนามในนามบริษัทจากลิงก์ในอีเมล (ไม่ต้อง login)
//   อ่าน/ตัดสินผ่าน ec_link_get / ec_link_decide เท่านั้น (anon อ่านตาราง emp_contracts ตรง ๆ ไม่ได้)
//   ลายเซ็นที่ลงคือของผู้แทนบริษัทที่ HR เลือกตอนส่ง · แจ้ง HR ผู้ส่ง (หรือพยานที่ยังไม่ลงนาม) ทางอีเมลผ่าน letter-notify
//   หน้านี้ไม่ได้รับเลขบัตรเต็ม — สัญญาแสดงแค่ 5 ตัวท้าย · ห้าม import js/app.js
// ============================================================================
import { supabase } from "../js/supabase-config.js";
import { contractHTML, LOC, thLong } from "../js/emp-contract-doc.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const thTime = iso => iso ? new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "";
const app = document.getElementById("app");
const token = new URLSearchParams(location.search).get("t") || "";
let D = null, SIG = {};   // SIG = รูปลายเซ็น (data URL) ของผู้แทน/พยานที่ลงแล้ว
const toData = url => fetch(url).then(r => r.ok ? r.blob() : null).then(b => b && new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); })).catch(() => "");
const who = () => `${D.title_th || ""}${D.name_th || ""}`;

function toast(msg, type = "") {
  const el = document.createElement("div"); el.className = `toast ${type}`; el.textContent = msg;
  document.getElementById("spToasts").appendChild(el); setTimeout(() => el.remove(), 5000);
}
const done = (ic, title, text) => { app.innerHTML = `<div class="card ap-done"><div class="ic">${ic}</div><h2>${title}</h2><p class="hint" style="font-size:14px">${text}</p></div>`; };
const inApp = () => D?.id ? `<a class="btn btn-s" href="/?econtract=${D.id}" style="margin-top:16px">เข้าสู่ระบบเพื่อลงนาม</a>` : "";

async function load() {
  if (!token) return done("🔗", "ลิงก์ไม่ครบ", "กรุณาเปิดจากปุ่มในอีเมลขอลงนามอีกครั้ง");
  const { data, error } = await supabase.rpc("ec_link_get", { p_token: token });
  if (error) return done("⚠️", "เปิดสัญญาไม่ได้", esc(error.message));
  if (data?.error) return done("🔗", esc(data.error), "ลิงก์อาจถูกแทนด้วยลิงก์ใหม่ เช่น สัญญาถูกส่งกลับแก้แล้วส่งใหม่ — ใช้ลิงก์จากอีเมลฉบับล่าสุด");
  D = data; render();
  try {
    const { data: x, error: e } = await supabase.functions.invoke("letter-notify", { body: { ec_token: token, action: "ec_files" } });
    if (e || !x?.sig) throw e || new Error("no sig");
    await Promise.all(Object.entries(x.sig).map(async ([k, u]) => { SIG[k] = u ? await toData(u) : ""; }));
  } catch (_) { /* ไม่มีรูปลายเซ็นก็ยังอ่านสัญญาได้ */ }
  drawDoc();
}

const doc = () => contractHTML(D, { logo: new URL("/assets/logo.png", location.href).href, draft: D.status === "signed" ? "" : "รอลงนาม",
  sig: { signer: D.signed_at ? { name: D.signer?.name_th, img: SIG.signer } : null, witness: D.witnessed_at ? { name: D.witness?.name_th, img: SIG.witness } : null } });
// สัญญา 4 หน้า A4 ย่อให้พอดีความกว้างจอ
function drawDoc() {
  const box = document.getElementById("apDoc"); if (!box) return;
  box.innerHTML = `<iframe title="สัญญาจ้างงาน" scrolling="no"></iframe>`;
  const f = box.querySelector("iframe");
  const fit = () => {
    const h = f.contentDocument?.body?.scrollHeight || 4600, sc = Math.min(1, box.clientWidth / 794);
    f.style.height = h + "px"; f.style.transform = `scale(${sc})`; box.style.height = Math.ceil(h * sc) + "px";
  };
  f.onload = () => { fit(); f.contentDocument.fonts?.ready.then(fit); };
  f.srcdoc = doc();
  window.onresize = fit;
}

function render() {
  const d = D, loc = LOC[d.location]?.label || d.location;
  const state = d.state === "open" ? "" :
    d.state === "expired" ? `<div class="note r">ลิงก์นี้หมดอายุแล้ว — เข้าสู่ระบบเพื่อลงนามแทน<br>${inApp()}</div>` :
    d.signed_at && d.status !== "rejected" ? `<div class="note">✓ ลงนามในนามบริษัทแล้ว${d.signed_at ? " เมื่อ " + esc(thTime(d.signed_at)) : ""}</div>` :
    d.status === "rejected" ? `<div class="note r">↩ สัญญานี้ถูกส่งกลับให้แก้ไขแล้ว${d.reject_reason ? ": " + esc(d.reject_reason) : ""}</div>` :
    `<div class="note">สัญญานี้ไม่ได้รอลงนามแล้ว (สถานะเปลี่ยนไป) — ไม่ต้องดำเนินการ</div>`;
  app.innerHTML = `
  <div class="ap-hero"><div><span class="bd ${d.state === "open" ? "p" : "n"}">${d.state === "open" ? "รอท่านลงนาม" : "ไม่ต้องดำเนินการ"}</span>
      <h1 style="margin-top:8px">สัญญาจ้างงาน · ${esc(who())}</h1><div class="hint">ผู้แทนบริษัท: ${esc(d.signer_name || "-")}</div></div>
    <div class="ap-net"><span>เงินเดือนพื้นฐาน (บาท)</span><b>${money(d.salary)}</b></div></div>
  ${state}
  <div class="card card-b"><dl class="ap-kv">
    <dt>ตำแหน่ง</dt><dd>${esc(d.position_th)}${d.position_en ? ` <span class="hint">(${esc(d.position_en)})</span>` : ""}${d.job_level ? ` · ${esc(d.job_level)}` : ""}</dd>
    <dt>เริ่มงาน</dt><dd>${esc(thLong(d.start_date))}</dd><dt>สถานที่</dt><dd>${esc(loc)}</dd>
    <dt>พยาน</dt><dd>${esc(d.witness_name || "-")} ${d.witnessed_at ? `<span class="hint">· ลงนามแล้ว ${esc(thTime(d.witnessed_at))}</span>` : `<span class="hint">· ยังไม่ลงนาม</span>`}</dd></dl></div>
  <div class="card card-b"><div class="card-t" style="justify-content:space-between">สัญญา <button class="btn btn-g btn-sm" id="apFull">เปิดเต็มจอ ↗</button></div>
    <div class="ap-doc" id="apDoc"></div></div>
  ${d.state === "open" ? `<div class="card card-b">
    <div class="hint" style="margin-bottom:12px">อ่านสัญญาด้านบนก่อน · เมื่อกดลงนาม ระบบลงลายเซ็นของ <b>${esc(d.signer_name || "ผู้แทนบริษัท")}</b> ในช่องผู้แทนบริษัท และแจ้ง HR ทันที · ลิงก์ใช้ได้ครั้งเดียว</div>
    <div class="ap-acts"><button class="btn btn-d" id="apNo">ส่งกลับแก้ไข</button><button class="btn btn-p" id="apYes">✓ ลงนามในนามบริษัท</button></div></div>` : ""}`;
  drawDoc();
  document.getElementById("apFull").onclick = () => {
    const u = URL.createObjectURL(new Blob([doc()], { type: "text/html" }));
    window.open(u, "_blank"); setTimeout(() => URL.revokeObjectURL(u), 60000);
  };
  if (d.state !== "open") return;
  document.getElementById("apYes").onclick = () => decide(true);
  document.getElementById("apNo").onclick = () => rejectForm();
}

function rejectForm() {
  const box = document.querySelector(".ap-acts").parentElement;
  box.innerHTML = `<label class="fld"><span>ส่งกลับให้ HR แก้ไข เพราะอะไร?</span><textarea class="in" id="apReason" rows="3" placeholder="เช่น เงินเดือนไม่ตรงกับที่ตกลง"></textarea></label>
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
  if (ok && !confirm(`ลงนามสัญญาจ้างของ ${who()} ในนามบริษัท ด้วยลายเซ็นของ ${D.signer_name || "ผู้แทนบริษัท"}?`)) return;
  document.querySelectorAll(".ap-acts .btn").forEach(b => b.disabled = true);
  const { data, error } = await supabase.rpc("ec_link_decide", { p_token: token, p_ok: ok, p_reason: reason });
  if (error) { toast("ไม่สำเร็จ: " + error.message, "err"); document.querySelectorAll(".ap-acts .btn").forEach(b => b.disabled = false); return; }
  // อีเมลแจ้ง HR / พยาน (ถ้าตั้งส่งอัตโนมัติไว้) — ไม่สำเร็จก็ไม่เป็นไร HR เห็นสถานะในระบบ
  supabase.functions.invoke("letter-notify", { body: { ec_token: token } }).catch(() => {});
  done(ok ? "✅" : "↩️", ok ? `ลงนามสัญญาของ ${esc(data.name)} แล้ว` : `ส่งกลับสัญญาของ ${esc(data.name)} ให้แก้ไขแล้ว`,
       ok ? (data.status === "signed" ? "ลงนามครบแล้ว ระบบแจ้ง HR ให้พิมพ์ให้พนักงานเซ็น · ปิดหน้านี้ได้เลย" : "ลายเซ็นของท่านลงในสัญญาแล้ว รอพยานลงนาม · ปิดหน้านี้ได้เลย")
          : "ระบบแจ้ง HR พร้อมเหตุผลแล้ว · ปิดหน้านี้ได้เลย");
}

load();
