// ============================================================================
// Contract Pay — ค่าจ้างเหมา 3% (เว็บ /contract)
//   ใช้ Supabase + session เดียวกับระบบ HR · สิทธิ์: page.contractpay · data.payroll.read / write · data.contract.approve
//   หน้า: #/runs · #/run/<id> · #/people · #/codes · #/settings
//   ขั้นตอนงวด: ร่าง → ประมวลผลแล้ว → รออนุมัติ → อนุมัติแล้ว (= ลงนาม 50 ทวิ) → ล็อก  (DB บังคับ: sql/schema_contract_web.sql)
//   ⚠️ คนกลุ่มนี้ไม่ใช่พนักงาน (contract_workers แยกจาก employees) — ไม่เข้ารายงานกำลังคนใด ๆ
//   ⚠️ เอกสารออกจาก contract_pay_item (สำเนา ณ ตอนประมวลผล) ไม่อ่านสดจากทะเบียน
//   ห้าม import js/app.js — จะบูตระบบ HR ทั้งระบบขึ้นมาในหน้านี้
// ============================================================================
import { supabase } from "../js/supabase-config.js";
import { calcItem, recurringFor, adjustFromRecurring, runTotals, inPeriod, preChecks, kbankPCT, tis620, round2, EXPIRY_DAYS } from "../js/contract-calc.js";
import { wht50Page, wht50Doc, slipPage, slipDoc, printHTML, thMonth, bkkDate } from "./doc.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = v => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TH_M = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const thDate = iso => { if (!iso) return "-"; const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return `${d} ${TH_M[m - 1]} ${String(y + 543).slice(2)}`; };
const todayISO = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const lastDay = p => { const [y, m] = p.split("-").map(Number); return `${p}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`; };
const $ = s => document.querySelector(s);
const ICON = {
  check: '<path d="M20 6 9 17l-5-5"/>', alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>', info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  dl: '<path d="M12 15V3"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>', lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  pen: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
};
const ic = k => `<svg viewBox="0 0 24 24">${ICON[k]}</svg>`;
const TYPE = { consultant: ["ที่ปรึกษา", "b"], casual: ["ชั่วคราว", "g"], contractor: ["ผู้รับเหมา", "n"] };
const ST = { draft: ["ร่าง", "n"], calculated: ["ประมวลผลแล้ว", "b"], pending: ["รออนุมัติ", "p"], approved: ["อนุมัติแล้ว", "g"], locked: ["ปิดงวดแล้ว", "g"] };
const badge = (map, k) => { const [t, c] = map[k] || [k, "n"]; return `<span class="bd ${c}">${esc(t)}</span>`; };

const S = { user: null, perms: new Set(), workers: [], runs: [], codes: [], wItems: [], settings: {}, signers: [], run: null, items: [], adj: [], prevItems: [], filt: {} };
const can = k => S.perms.has(k);
const canWrite = () => can("data.payroll.write");
const canApprove = () => can("data.contract.approve");
const codeOf = id => S.codes.find(c => c.id === id);
const activeCodes = kind => S.codes.filter(c => c.is_active !== false && (!kind || c.kind === kind)).sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
const daysLeft = d => d ? Math.round((new Date(d + "T00:00:00Z") - new Date(todayISO() + "T00:00:00Z")) / 864e5) : null;

function toast(msg, type = "") { const el = document.createElement("div"); el.className = "toast " + type; el.textContent = msg; $("#spToasts").appendChild(el); setTimeout(() => el.remove(), 5000); }
function modal(title, body, foot) {
  const el = document.createElement("div"); el.className = "mo";
  el.innerHTML = `<div class="mo-c"><div class="mo-h">${title}<button class="btn btn-g btn-sm" data-x>✕</button></div><div class="mo-b">${body}</div><div class="mo-f">${foot}</div></div>`;
  $("#spModal").appendChild(el);
  el.querySelectorAll("[data-x]").forEach(b => b.onclick = () => el.remove());
  el.onclick = e => { if (e.target === el) el.remove(); };
  return el;
}
const fail = (e, what = "บันทึกไม่สำเร็จ") => { toast(`${what}: ${String(e?.message || e).split("ERROR:").pop().trim()}`, "err"); };
const q = async p => { const { data, error } = await p; if (error) throw error; return data; };

// ---------------------------------------------------------------- เริ่มต้น
async function boot() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    $("#spMain").innerHTML = `<div class="card card-b" style="max-width:460px;margin:60px auto;text-align:center"><div class="card-t" style="justify-content:center">กรุณาเข้าสู่ระบบ</div>
      <p class="sp-sub" style="margin-bottom:16px">ค่าจ้างเหมาใช้บัญชีเดียวกับระบบ HR — เข้าสู่ระบบ HR ก่อน แล้วกดเมนูค่าจ้างเหมา</p><a class="btn btn-p" href="/">ไปหน้าเข้าสู่ระบบ HR</a></div>`;
    return;
  }
  S.user = session.user;
  const { data: perms } = await supabase.rpc("my_permissions");
  S.perms = new Set((perms || []).map(p => typeof p === "string" ? p : p.perm_key || p.key));
  const name = S.user.user_metadata?.full_name || S.user.email || "";
  $("#spUser").innerHTML = `<div class="sp-av">${esc(name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase())}</div>
    <div><b>${esc(name)}</b><span>${canWrite() ? "HR · ผู้จัดทำ" : canApprove() ? "ผู้อนุมัติ" : "ดูอย่างเดียว"}</span></div>`;
  if (!can("page.contractpay") && !canApprove()) { $("#spMain").innerHTML = `<div class="empty">บัญชีนี้ยังไม่มีสิทธิ์ใช้ค่าจ้างเหมา — ให้ Admin เพิ่มสิทธิ์ที่ User Management</div>`; return; }
  try { await loadAll(); }
  catch (e) { $("#spMain").innerHTML = `<div class="card card-b"><b>โหลดข้อมูลไม่สำเร็จ</b><p class="sp-sub">${esc(e.message)}</p><p class="hint" style="margin-top:8px">ถ้ายังไม่ได้รัน <code>sql/schema_contract_web.sql</code> ใน Supabase ให้รันก่อน</p></div>`; return; }
  window.addEventListener("hashchange", route);
  route();
}
async function loadAll() {
  const [w, r, c, wi, st, sg] = await Promise.all([
    q(supabase.from("contract_workers").select("*").order("worker_code")),
    q(supabase.from("contract_pay_run").select("*").order("period", { ascending: false })),
    q(supabase.from("contract_pay_codes").select("*").order("sort_order")),
    q(supabase.from("contract_worker_items").select("*").order("start_period")),
    q(supabase.from("contract_settings").select("*").eq("id", 1).maybeSingle()),
    supabase.rpc("ct_signers"),
  ]);
  S.workers = w; S.runs = r; S.codes = c; S.wItems = wi; S.settings = st || {}; S.signers = sg.data || [];
  const todo = S.runs.filter(x => x.status === "pending" && x.approver_id === S.user.id).length;
  $("#navTodo").textContent = todo ? String(todo) : "";
  const exp = S.workers.filter(x => x.is_active && x.end_date && daysLeft(x.end_date) <= EXPIRY_DAYS && daysLeft(x.end_date) >= -31).length;
  $("#navExp").textContent = exp ? String(exp) : "";
}
async function loadRun(id) {
  const run = S.runs.find(x => x.id === id); if (!run) throw new Error("ไม่พบงวดนี้");
  const prev = S.runs.filter(x => x.period < run.period).sort((a, b) => b.period.localeCompare(a.period))[0];
  const [items, adj, prevItems] = await Promise.all([
    q(supabase.from("contract_pay_item").select("*").eq("run_id", id).order("worker_code")),
    q(supabase.from("contract_pay_adjust").select("*").eq("run_id", id)),
    prev ? q(supabase.from("contract_pay_item").select("worker_id,net_amount").eq("run_id", prev.id)) : [],
  ]);
  Object.assign(S, { run, items, adj, prevItems, prevRun: prev || null });
}
function route() {
  const [r, arg] = location.hash.replace(/^#\/?/, "").split("/");
  const page = r || "runs";
  document.querySelectorAll("#spNav a").forEach(a => a.classList.toggle("on", a.dataset.r === (page === "run" ? "runs" : page)));
  window.scrollTo(0, 0);
  ({ runs: renderRuns, run: () => renderRun(+arg), people: renderPeople, codes: renderCodes, settings: renderSettings }[page] || renderRuns)();
}
const head = (title, sub, actions = "") => `<div class="sp-head"><div class="t"><div class="sp-title">${title}</div><div class="sp-sub">${sub}</div></div>${actions}</div>`;

// ---------------------------------------------------------------- รายการงวด
function renderRuns() {
  const soon = S.workers.filter(w => w.is_active && w.end_date && daysLeft(w.end_date) <= EXPIRY_DAYS);
  const active = S.workers.filter(w => w.is_active);
  const mine = S.runs.filter(x => x.status === "pending" && x.approver_id === S.user.id);
  $("#spMain").innerHTML = head("งวดจ่ายค่าจ้างเหมา", `ที่ปรึกษา · ลูกจ้างชั่วคราว · ผู้รับเหมา — หัก ณ ที่จ่าย 3% (ภ.ง.ด.3) · ${active.length} คนที่ใช้งานอยู่`,
    canWrite() ? `<button class="btn btn-p" id="newRun">${ic("plus")}เปิดงวดใหม่</button>` : "") + `
    ${mine.length ? `<div class="note" style="margin-bottom:16px">มี ${mine.length} งวดรอคุณอนุมัติ: ${mine.map(x => `<a href="#/run/${x.id}" style="text-decoration:underline">${esc(thMonth(x.period))}</a>`).join(" · ")}</div>` : ""}
    ${soon.length ? `<div class="ck warn" style="margin-bottom:16px">${ic("cal")}<div class="t"><b>สัญญาหมดภายใน ${EXPIRY_DAYS} วัน ${soon.length} คน</b>
      <span>${soon.map(w => `${esc(w.name_th)} (${daysLeft(w.end_date) < 0 ? "หมดแล้ว" : "หมด " + thDate(w.end_date)})`).join(" · ")}</span></div><a class="btn btn-s btn-sm" href="#/people">ดูรายชื่อ</a></div>` : ""}
    <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>งวด</th><th>สถานะ</th><th>วันที่โอน</th><th>ผู้อนุมัติ</th><th>อัปเดต</th><th></th></tr></thead><tbody>
    ${S.runs.map(r => `<tr class="click" data-run="${r.id}"><td><b>${esc(thMonth(r.period))}</b></td><td>${badge(ST, r.status)}</td><td>${thDate(r.pay_date)}</td>
      <td>${esc(S.signers.find(s => s.user_id === r.approver_id)?.name || (r.signer?.name_th || "-"))}</td>
      <td class="hint">${r.approved_at ? "อนุมัติ " + thDate(bkkDate(r.approved_at)) : r.submitted_at ? "ส่ง " + thDate(bkkDate(r.submitted_at)) : ""}</td><td class="n">›</td></tr>`).join("")
      || `<tr><td colspan="6" class="empty">ยังไม่มีงวด — กด “เปิดงวดใหม่”</td></tr>`}</tbody></table></div>`;
  $("#spMain").querySelectorAll("[data-run]").forEach(tr => tr.onclick = () => { location.hash = `#/run/${tr.dataset.run}`; });
  $("#newRun")?.addEventListener("click", newRunForm);
}
function newRunForm() {
  const now = todayISO().slice(0, 7), taken = new Set(S.runs.map(r => r.period));
  const el = modal("เปิดงวดใหม่", `<div class="grid2"><label class="fld"><span>งวด (เดือน)</span><input class="in" type="month" id="nrP" value="${taken.has(now) ? "" : now}"></label>
    <label class="fld"><span>วันที่โอน</span><input class="in" type="date" id="nrD" value="${lastDay(now)}"></label></div>
    <div class="hint">เปิดแล้วระบบดึงคนที่สัญญาคร่อมเดือนนั้นและรายการประจำให้เอง · กรอกรายได้/หักเพิ่มได้ก่อนประมวลผล</div>`,
    `<button class="btn btn-g" data-x>ยกเลิก</button><button class="btn btn-p" id="nrOk">เปิดงวด</button>`);
  el.querySelectorAll("[data-x]").forEach(x => x.onclick = () => el.remove());
  el.querySelector("#nrP").onchange = e => { if (e.target.value) el.querySelector("#nrD").value = lastDay(e.target.value); };
  el.querySelector("#nrOk").onclick = async () => {
    const period = el.querySelector("#nrP").value, pay = el.querySelector("#nrD").value;
    if (!/^\d{4}-\d{2}$/.test(period)) return toast("เลือกเดือนก่อน", "err");
    if (taken.has(period)) return toast("มีงวดนี้อยู่แล้ว", "err");
    try { const r = await q(supabase.from("contract_pay_run").insert({ period, pay_date: pay || null, status: "draft", created_by: S.user.id }).select().single());
      el.remove(); await loadAll(); location.hash = `#/run/${r.id}`; } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------- หน้างวด
const editable = () => canWrite() && ["draft", "calculated"].includes(S.run.status);
const runWorkers = () => S.workers.filter(w => inPeriod(w, S.run.period) || S.items.some(i => i.worker_id === w.id));
const linesOf = wid => S.adj.filter(a => a.worker_id === wid);
// ระหว่างร่าง = ตัวเลขประมาณสด (รวมรายการประจำที่ยังไม่ได้คัดลอกลงงวด) · หลังประมวลผล = แถวที่บันทึก
function previewItems() {
  const rec = recurringFor(S.wItems, S.run.period);
  return S.workers.filter(w => inPeriod(w, S.run.period)).map(w => {
    const once = linesOf(w.id).filter(a => a.source !== "recurring");
    const recs = rec.filter(i => i.worker_id === w.id && codeOf(i.code_id)).map(i => adjustFromRecurring(i, codeOf(i.code_id), S.run.id));
    return { worker_id: w.id, worker_code: w.worker_code, name_th: w.name_th, name_en: w.name_en, worker_type: w.worker_type, department: w.department, cost_code: w.cost_code,
      bank_name: w.bank_name, bank_account: w.bank_account, tax_id: w.tax_id, address: w.address, email: w.email, ...calcItem(w, [...once, ...recs]) };
  });
}
const shownItems = () => S.run.status === "draft" ? previewItems() : S.items;

async function renderRun(id) {
  try { await loadRun(id); } catch (e) { $("#spMain").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  drawRun();
}
function drawRun() {
  const r = S.run, items = shownItems(), t = runTotals(items), st = r.status;
  const checks = preChecks({ items, prev: S.prevItems, workers: S.workers, ok: r.variance_ok || [], period: r.period, today: todayISO() });
  const blocked = checks.some(c => c.block), stepIdx = { draft: 0, calculated: 1, pending: 2, approved: 3, locked: 4 }[st];
  const types = Object.keys(TYPE).map(k => [TYPE[k][0], items.filter(i => i.worker_type === k).length]).filter(([, n]) => n).map(([l, n]) => `${l} ${n}`).join(" · ");
  const P = new Map(S.prevItems.map(i => [i.worker_id, i]));
  const isApprover = st === "pending" && r.approver_id === S.user.id && canApprove();
  const acts = [
    editable() && st === "draft" ? `<button class="btn btn-p" id="calc">${ic("check")}ประมวลผล</button>` : "",
    editable() && st === "calculated" ? `<button class="btn btn-s" id="calc">ประมวลผลใหม่</button><button class="btn btn-p" id="submit" ${blocked ? "disabled title='แก้เรื่องที่ต้องแก้ในกล่อง “ตรวจก่อนจ่าย” ก่อน'" : ""}>${ic("mail")}ส่งขออนุมัติ</button>` : "",
    canWrite() && st === "pending" ? `<button class="btn btn-s" id="withdraw">ถอนคำขอ</button>` : "",
    isApprover ? `<button class="btn btn-d" id="reject">ส่งกลับแก้ไข</button><button class="btn btn-p" id="approve">${ic("pen")}อนุมัติ & ลงนาม 50 ทวิ</button>` : "",
    canWrite() && st === "approved" ? `<button class="btn btn-s" id="lock">${ic("lock")}ปิดงวด</button>` : "",
  ].join("");
  const steps = [["ตรวจข้อมูล", "เลขภาษี บัญชี สัญญา"], ["ตรวจยอด", "เทียบเดือนก่อน"], ["อนุมัติ", "ผู้ลงนามกดอนุมัติ"], ["ปิดงวด & ส่งเอกสาร", "สลิป · 50 ทวิ · ภ.ง.ด.3 · ไฟล์โอน"]];
  const stepState = i => (stepIdx === 0 ? i === 0 ? "now" : "todo" : stepIdx === 1 ? i === 0 ? "done" : i === 1 ? "now" : "todo" : stepIdx === 2 ? i < 2 ? "done" : i === 2 ? "now" : "todo" : stepIdx === 3 ? i < 3 ? "done" : "now" : "done");
  const ckCls = c => c.block ? "block" : c.key === "exp" || c.key === "addr" ? "info" : "warn";
  const nm = id => S.workers.find(w => w.id === id)?.name_th || id;
  const delta = i => { const p = P.get(i.worker_id); if (!p) return `<span class="dl new">ใหม่</span>`; if (!Number(p.net_amount)) return `<span class="dl eq">—</span>`;
    const pct = Math.round((Number(i.net_amount) - Number(p.net_amount)) / Number(p.net_amount) * 100);
    return pct === 0 ? `<span class="dl eq">เท่าเดิม</span>` : `<span class="dl ${Math.abs(pct) > 20 ? "up" : pct > 0 ? "eq" : "dn"}">${pct > 0 ? "+" : ""}${pct}%</span>`; };
  $("#spMain").innerHTML = `
    <div class="sp-head"><div class="t"><div class="sp-title">งวดจ่าย ${esc(thMonth(r.period))} ${badge(ST, st)}</div>
      <div class="sp-sub">วันที่โอน ${thDate(r.pay_date)}${canWrite() && !["approved", "locked"].includes(st) ? ` <button class="lnk" id="payDate">แก้</button>` : ""}
        ${st === "pending" ? ` · รอ ${esc(S.signers.find(s => s.user_id === r.approver_id)?.name || "ผู้อนุมัติ")} อนุมัติ` : ""}
        ${r.approved_at ? ` · อนุมัติโดย ${esc(r.signer?.name_th || "")} ${thDate(bkkDate(r.approved_at))}` : ""}</div></div>
      <a class="btn btn-g" href="#/runs">← งวดทั้งหมด</a><button class="btn btn-s" id="xl">${ic("dl")}Export Excel</button>${acts}</div>
    ${r.reject_reason && st === "calculated" ? `<div class="note r" style="margin-bottom:16px">ผู้อนุมัติส่งกลับ: ${esc(r.reject_reason)}</div>` : ""}
    <div class="card stepper">${steps.map(([a, b], i) => `<div class="s ${stepState(i)}"><i>${stepState(i) === "done" ? ic("check") : i + 1}</i><div><b>${a}</b><span>${b}</span></div></div>${i < 3 ? `<div class="ln ${stepState(i) === "done" ? "done" : ""}"></div>` : ""}`).join("")}</div>
    <div class="stats">
      <div class="stat"><div class="l">ผู้รับจ้างงวดนี้</div><div class="v">${t.count}</div><div class="m">${types || "-"}</div></div>
      <div class="stat"><div class="l">ค่าจ้างรวม</div><div class="v">${money(t.base)}</div><div class="m">+ ได้เพิ่ม ${money(t.extra)} · − หัก ${money(t.deduct)}</div></div>
      <div class="stat"><div class="l">ภาษีหัก ณ ที่จ่าย</div><div class="v">${money(t.wht)}</div><div class="m">${items.filter(i => Number(i.wht_amount) > 0).length} คน · ยื่น ภ.ง.ด.3 ภายใน 7 ${TH_M[(+r.period.slice(5)) % 12]} (e-filing 15)</div></div>
      <div class="stat hl"><div class="l">ยอดโอนสุทธิ${st === "draft" ? " (ประมาณ)" : ""}</div><div class="v">${money(t.net)}</div><div class="m">${S.prevRun ? `เดือนก่อน ${money(runTotals(S.prevItems).net)}` : "ไม่มีงวดก่อนหน้า"}</div></div>
    </div>
    ${["approved", "locked"].includes(st) ? `<div class="card card-b" style="margin-bottom:20px"><div class="card-t">เอกสารของงวดนี้</div><div class="docs">
      <button class="btn btn-s" data-doc="slip">${ic("print")}สลิปรายคน</button><button class="btn btn-s" data-doc="50">${ic("print")}50 ทวิ (ลงนามแล้ว)</button>
      <button class="btn btn-s" data-doc="pnd3">${ic("dl")}ภ.ง.ด.3 (Excel)</button><button class="btn btn-s" data-doc="bank">${ic("dl")}ไฟล์โอนกสิกร (PCT)</button></div></div>`
      : st === "pending" ? `<div class="card card-b" style="margin-bottom:20px"><div class="docs"><span class="hint">ตัวอย่างก่อนอนุมัติ:</span><button class="btn btn-s btn-sm" data-doc="50">${ic("print")}50 ทวิ (ร่าง)</button></div></div>` : ""}
    ${st === "draft" || st === "calculated" ? `<div class="card card-b" style="margin-bottom:20px"><div class="card-h"><div class="t"><b>ตรวจก่อนจ่าย</b><span>${st === "draft" ? "ประมวลผลก่อน แล้วแก้ให้ครบถึงส่งขออนุมัติได้" : "แก้ครบแล้วถึงส่งขออนุมัติได้"}</span></div></div><div class="checks">
      ${checks.map(c => `<div class="ck ${ckCls(c)}">${ic(c.block ? "alert" : c.key === "exp" ? "cal" : "info")}<div class="t"><b>${esc(c.title)}${c.key === "var" ? ` · ยืนยันแล้ว ${c.confirmed}/${c.total}` : ""}</b><span>${esc(c.text)}</span>
        <div class="who">${c.ids.map(id => c.key === "var" ? `<button data-var="${id}" class="${(r.variance_ok || []).includes(id) ? "on" : ""}"><span>${esc(nm(id))} ${c.pct[id] > 0 ? "+" : ""}${c.pct[id]}% ${(r.variance_ok || []).includes(id) ? "✓" : "— ยืนยัน"}</span></button>` : `<button data-person="${id}"><span>${esc(nm(id))}</span></button>`).join("")}</div></div></div>`).join("")
      || `<div class="ck ok">${ic("check")}<div class="t"><b>ข้อมูลครบ</b><span>เลขภาษี บัญชี และยอดเทียบเดือนก่อนผ่านทั้งหมด</span></div></div>`}</div></div>` : ""}
    <div class="card"><div class="card-b" style="padding-bottom:12px"><div class="card-h" style="margin:0"><div class="t"><b>รายคน</b><span>${editable() ? "กดที่ชื่อเพื่อเพิ่มรายได้/หักของงวดนี้ · ตารางกรอกหลายคนพร้อมกันได้ที่ปุ่มด้านขวา" : "กดที่ชื่อเพื่อดูรายละเอียด"}</span></div>
      ${editable() ? `<button class="btn btn-s btn-sm" id="grid">กรอกแบบตาราง</button>` : ""}</div></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>ผู้รับจ้าง</th><th>ประเภท</th><th class="n">ค่าจ้าง</th><th class="n">ได้เพิ่ม</th><th class="n">หัก</th><th class="n">ภาษี</th><th class="n">สุทธิ</th><th class="n">เทียบเดือนก่อน</th></tr></thead><tbody>
      ${items.map(i => `<tr class="click" data-person="${i.worker_id}"><td><b>${esc(i.name_th)}</b><div class="sub">${esc(i.worker_code)}${i.department ? " · " + esc(i.department) : ""}</div></td><td>${badge(TYPE, i.worker_type)}</td>
        <td class="n">${money(i.base_amount)}</td><td class="n ${Number(i.extra_amount) ? "pos" : "hint"}">${Number(i.extra_amount) ? money(i.extra_amount) : "—"}</td><td class="n ${Number(i.deduct_amount) ? "neg" : "hint"}">${Number(i.deduct_amount) ? money(i.deduct_amount) : "—"}</td>
        <td class="n">${Number(i.wht_amount) ? money(i.wht_amount) : `<span class="hint">ไม่หัก</span>`}</td><td class="n"><b>${money(i.net_amount)}</b></td><td class="n">${delta(i)}</td></tr>`).join("")
        || `<tr><td colspan="8" class="empty">ไม่มีผู้รับจ้างที่สัญญาคร่อมเดือนนี้ — เพิ่มที่ “รายชื่อผู้รับจ้าง”</td></tr>`}
      ${items.length ? `<tr><td colspan="2"><b>รวม ${t.count} คน</b></td><td class="n"><b>${money(t.base)}</b></td><td class="n"><b>${money(t.extra)}</b></td><td class="n"><b>${money(t.deduct)}</b></td><td class="n"><b>${money(t.wht)}</b></td><td class="n"><b>${money(t.net)}</b></td><td></td></tr>` : ""}
      </tbody></table></div></div>`;
  const m = $("#spMain");
  m.querySelectorAll("[data-person]").forEach(b => b.onclick = e => { e.stopPropagation(); personDrawer(+b.dataset.person); });
  m.querySelectorAll("[data-var]").forEach(b => b.onclick = async () => { if (!editable()) return; const id = +b.dataset.var, ok = new Set(r.variance_ok || []); ok.has(id) ? ok.delete(id) : ok.add(id);
    try { const x = await q(supabase.from("contract_pay_run").update({ variance_ok: [...ok] }).eq("id", r.id).select().single()); Object.assign(r, x); drawRun(); } catch (e) { fail(e); } });
  m.querySelector("#calc")?.addEventListener("click", async () => { try { await calculate(); toast("ประมวลผลแล้ว", "ok"); } catch (e) { fail(e, "ประมวลผลไม่สำเร็จ"); } });
  m.querySelector("#submit")?.addEventListener("click", submitForm);
  m.querySelector("#withdraw")?.addEventListener("click", () => setStatus({ status: "calculated", approver_id: null }, "ถอนคำขอแล้ว"));
  m.querySelector("#lock")?.addEventListener("click", () => { if (confirm("ปิดงวดแล้วจะแก้ไขหรือเปิดกลับไม่ได้อีก — ยืนยัน?")) setStatus({ status: "locked", locked_at: new Date().toISOString(), locked_by: S.user.id }, "ปิดงวดแล้ว"); });
  m.querySelector("#approve")?.addEventListener("click", () => decide(true));
  m.querySelector("#reject")?.addEventListener("click", () => decide(false));
  m.querySelector("#payDate")?.addEventListener("click", () => { const v = prompt("วันที่โอน (ปปปป-ดด-วว)", r.pay_date || lastDay(r.period)); if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) setStatus({ pay_date: v }, "บันทึกวันที่โอนแล้ว"); });
  m.querySelector("#grid")?.addEventListener("click", gridForm);
  m.querySelector("#xl").onclick = () => exportRun(items);
  m.querySelectorAll("[data-doc]").forEach(b => b.onclick = () => doc(b.dataset.doc));
}
async function setStatus(patch, msg) {
  try { const x = await q(supabase.from("contract_pay_run").update(patch).eq("id", S.run.id).select().single()); Object.assign(S.run, x); await loadAll(); await loadRun(S.run.id); drawRun(); toast(msg, "ok"); }
  catch (e) { fail(e); }
}
// ประมวลผล: คัดลอกรายการประจำลงงวด (ลบชุดเดิมของงวดก่อน กันซ้ำ) → คิดรายคน → เขียนทับแถวของงวด
async function calculate() {
  const r = S.run, ws = S.workers.filter(w => inPeriod(w, r.period));
  if (!ws.length) throw new Error("ไม่มีผู้รับจ้างที่สัญญาคร่อมเดือนนี้");
  const ids = new Set(ws.map(w => w.id));
  const rec = recurringFor(S.wItems, r.period).filter(i => ids.has(i.worker_id) && codeOf(i.code_id));
  await q(supabase.from("contract_pay_adjust").delete().eq("run_id", r.id).eq("source", "recurring"));
  if (rec.length) await q(supabase.from("contract_pay_adjust").insert(rec.map(i => ({ ...adjustFromRecurring(i, codeOf(i.code_id), r.id), created_by: S.user.id }))));
  const adj = await q(supabase.from("contract_pay_adjust").select("*").eq("run_id", r.id));
  const rows = ws.map(w => ({ run_id: r.id, worker_id: w.id, worker_code: w.worker_code, name_th: w.name_th, name_en: w.name_en || null, worker_type: w.worker_type,
    department: w.department, cost_code: w.cost_code, bank_name: w.bank_name, bank_account: w.bank_account, tax_id: w.tax_id, address: w.address, email: w.email,
    ...calcItem(w, adj.filter(a => a.worker_id === w.id)) }));
  await q(supabase.from("contract_pay_item").delete().eq("run_id", r.id));
  await q(supabase.from("contract_pay_item").insert(rows));
  if (r.status === "draft") await q(supabase.from("contract_pay_run").update({ status: "calculated", calculated_at: new Date().toISOString(), calculated_by: S.user.id }).eq("id", r.id));
  else await q(supabase.from("contract_pay_run").update({ calculated_at: new Date().toISOString(), calculated_by: S.user.id }).eq("id", r.id));
  await loadAll(); await loadRun(r.id); drawRun();
}
function submitForm() {
  if (!S.signers.length) return toast("ยังไม่มีผู้อนุมัติที่มีสิทธิ์ “อนุมัติงวดค่าจ้างเหมา” และอัปโหลดลายเซ็นแล้ว — ให้ Admin ตั้งสิทธิ์ก่อน", "err");
  const el = modal("ส่งขออนุมัติ", `<label class="fld"><span>ผู้อนุมัติ (ผู้ลงนามใน 50 ทวิ)</span><select class="in" id="apv">${S.signers.map(s => `<option value="${s.user_id}">${esc(s.name)}${s.title ? " · " + esc(s.title) : ""}</option>`).join("")}</select></label>
    <div class="hint">ผู้อนุมัติกดอนุมัติในเว็บนี้ = อนุมัติยอดจ่ายทั้งงวด และลงนามใน 50 ทวิ ของทุกคนด้วยลายเซ็นที่อัปโหลดไว้ · วันที่บน 50 ทวิ = วันที่กดอนุมัติ</div>`,
    `<button class="btn btn-g" data-x>ยกเลิก</button><button class="btn btn-p" id="go">${ic("mail")}ส่ง</button>`);
  el.querySelectorAll("[data-x]").forEach(x => x.onclick = () => el.remove());
  el.querySelector("#go").onclick = () => { el.remove(); setStatus({ status: "pending", approver_id: el.querySelector("#apv").value, submitted_at: new Date().toISOString(), submitted_by: S.user.id, reject_reason: null }, "ส่งขออนุมัติแล้ว"); };
}
async function decide(approve) {
  let reason = null;
  if (!approve) { reason = prompt("เหตุผลที่ส่งกลับ"); if (reason == null) return; }
  else if (!confirm(`อนุมัติการจ่ายงวด ${thMonth(S.run.period)} ยอดโอน ${money(runTotals(S.items).net)} บาท และลงนาม 50 ทวิ ${S.items.filter(i => Number(i.wht_amount) > 0).length} ฉบับ?`)) return;
  const { error } = await supabase.rpc("ct_decide", { p_run: S.run.id, p_approve: approve, p_reason: reason });
  if (error) return fail(error, "ไม่สำเร็จ");
  await loadAll(); await loadRun(S.run.id); drawRun(); toast(approve ? "อนุมัติและลงนามแล้ว" : "ส่งกลับแล้ว", "ok");
}

// กรอกแบบตาราง: คน × รายการ (ครั้งเดียว) — บันทึกแล้วถ้าประมวลผลไปแล้วจะประมวลผลใหม่ให้เอง
function gridForm() {
  const ws = S.workers.filter(w => inPeriod(w, S.run.period)), E = activeCodes("earning"), D = activeCodes("deduction"), C = [...E, ...D];
  const once = (wid, cid) => S.adj.filter(a => a.worker_id === wid && a.code_id === cid && a.source !== "recurring");
  const el = document.createElement("div"); el.className = "mo";
  el.innerHTML = `<div class="mo-c" style="max-width:min(1200px,96vw)"><div class="mo-h">กรอกรายได้ / หัก งวด ${esc(thMonth(S.run.period))}<button class="btn btn-g btn-sm" data-x>✕</button></div>
    <div class="mo-b"><div class="hint">เว้นว่าง = ไม่มี · รายการประจำ (เช่นบังคับคดีทุกเดือน) ตั้งที่หน้าผู้รับจ้าง ไม่ต้องกรอกที่นี่ · ช่องที่มีหลายรายการแก้ได้ที่หน้าผู้รับจ้าง</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>ผู้รับจ้าง</th>${C.map(c => `<th class="n" title="${esc(c.code)}">${esc(c.name_th)}<div class="sub">${c.kind === "earning" ? "รายได้" : "หัก"}</div></th>`).join("")}</tr></thead>
    <tbody>${ws.map(w => `<tr><td><b>${esc(w.name_th)}</b><div class="sub">${esc(w.worker_code)}</div></td>${C.map(c => { const ex = once(w.id, c.id);
      return `<td class="n">${ex.length > 1 ? `<span class="hint">${money(ex.reduce((s, a) => s + Number(a.amount), 0))} (${ex.length})</span>` : `<input class="in grid-in" type="number" step="0.01" min="0" data-w="${w.id}" data-c="${c.id}" value="${ex[0] ? Number(ex[0].amount) : ""}">`}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div></div>
    <div class="mo-f"><button class="btn btn-g" data-x>ยกเลิก</button><button class="btn btn-p" id="gSave">บันทึก</button></div></div>`;
  $("#spModal").appendChild(el);
  el.querySelectorAll("[data-x]").forEach(x => x.onclick = () => el.remove());
  el.querySelector("#gSave").onclick = async () => {
    const del = [], ins = [];
    for (const inp of el.querySelectorAll("input[data-w]")) {
      const wid = +inp.dataset.w, c = codeOf(+inp.dataset.c), v = round2(inp.value), ex = once(wid, c.id)[0];
      if ((ex ? Number(ex.amount) : 0) === (v > 0 ? v : 0)) continue;
      if (ex) del.push(ex.id);
      if (v > 0) ins.push({ run_id: S.run.id, worker_id: wid, kind: c.kind, label: c.name_th, amount: v, code_id: c.id, source: "once",
        taxable: c.kind === "earning" ? c.tax_effect !== false : true, cuts_tax_base: c.kind === "deduction" && !!c.tax_effect, created_by: S.user.id });
    }
    try { if (del.length) await q(supabase.from("contract_pay_adjust").delete().in("id", del)); if (ins.length) await q(supabase.from("contract_pay_adjust").insert(ins));
      el.remove(); await afterAdjust(); toast(`บันทึก ${del.length + ins.length} ช่อง`, "ok"); } catch (e) { fail(e); }
  };
}
async function afterAdjust() { if (S.run?.status === "calculated") await calculate(); else { await loadRun(S.run.id); drawRun(); } }

function exportRun(items) {
  if (!window.XLSX) return toast("กรุณารอโหลด library", "err");
  const X = window.XLSX, wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(items.map(i => ({ "รหัส": i.worker_code, "ชื่อ": i.name_th, "ประเภท": TYPE[i.worker_type]?.[0] || i.worker_type, "แผนก": i.department || "", "cost code": i.cost_code || "",
    "ค่าจ้าง": Number(i.base_amount), "ได้เพิ่ม": Number(i.extra_amount), "หัก": Number(i.deduct_amount), "ฐานภาษี": Number(i.tax_base ?? 0), "ภาษี %": Number(i.wht_percent), "ภาษี": Number(i.wht_amount), "สุทธิ": Number(i.net_amount),
    "ธนาคาร": i.bank_name || "", "เลขบัญชี": i.bank_account || "", "เลขผู้เสียภาษี": i.tax_id || "" }))), "รายคน");
  X.writeFile(wb, `ค่าจ้างเหมา_${S.run.period}.xlsx`);
}

// ---------------------------------------------------------------- เอกสาร
async function assetData(path) {
  if (!path) return "";
  const { data, error } = await supabase.storage.from("letter-assets").download(path);
  if (error || !data) return "";
  return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(data); });
}
const taxed = () => S.items.filter(i => Number(i.wht_amount) > 0).sort((a, b) => a.worker_code.localeCompare(b.worker_code));
async function doc(kind) {
  const r = S.run;
  if (kind === "50") {
    const list = taxed(); if (!list.length) return toast("งวดนี้ไม่มีคนที่ถูกหักภาษี", "err");
    const art = r.signer ? { signature: await assetData(r.signer.signature_path), seal: await assetData(r.signer.seal_path) } : null;
    printHTML(wht50Doc(list.map((it, n) => wht50Page({ it, seq: n + 1, run: r, settings: S.settings, art })), `50 ทวิ ${thMonth(r.period)}`));
  } else if (kind === "slip") {
    printHTML(slipDoc(S.items.map(it => slipPage({ it, lines: S.adj.filter(a => a.worker_id === it.worker_id), run: r, settings: S.settings })), `สลิป ${thMonth(r.period)}`));
  } else if (kind === "pnd3") {
    if (!window.XLSX) return toast("กรุณารอโหลด library", "err");
    const list = taxed(), X = window.XLSX, wb = X.utils.book_new();
    const rows = list.map((i, n) => ({ "ลำดับ": n + 1, "เลขประจำตัวผู้เสียภาษี": i.tax_id || "", "ชื่อผู้มีเงินได้": i.name_th, "ที่อยู่": i.address || "", "วันที่จ่าย": r.pay_date || lastDay(r.period),
      "ประเภทเงินได้": "ค่าจ้างทำของ/ค่าบริการ (ม.3 เตรส)", "อัตราภาษี (%)": Number(i.wht_percent), "จำนวนเงินที่จ่าย": Number(i.tax_base ?? i.base_amount), "ภาษีที่หัก": Number(i.wht_amount), "เงื่อนไข": 1 }));
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rows), "ภ.ง.ด.3"); X.writeFile(wb, `ภงด3_${r.period}.xlsx`);
  } else if (kind === "bank") {
    if (!S.settings.bank_account) return toast("ยังไม่ได้ตั้งบัญชีบริษัทที่หน้า “ตั้งค่า”", "err");
    const f = kbankPCT({ items: S.items, account: S.settings.bank_account, company: S.settings.bank_company || S.settings.company_name_th, created: todayISO(), payDate: r.pay_date || lastDay(r.period) });
    if (f.skipped.length && !confirm(`${f.skipped.length} คนเลขบัญชีกสิกรไม่ครบ 10 หลัก จะไม่อยู่ในไฟล์:\n${f.skipped.map(i => `• ${i.worker_code} ${i.name_th}`).join("\n")}\n\nสร้างไฟล์ต่อไหม?`)) return;
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([tis620(f.text)], { type: "text/plain" }));
    a.download = `PCT${todayISO().replace(/-/g, "").slice(2)}_${r.period}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`ไฟล์โอน ${f.count} รายการ รวม ${money(f.total)} บาท`, "ok");
  }
}

// ---------------------------------------------------------------- ผู้รับจ้าง
function renderPeople() {
  const f = S.filt.p ||= { q: "", type: "", show: "active" }, qq = f.q.toLowerCase();
  const list = S.workers.filter(w => (f.show === "all" || (f.show === "active" ? w.is_active : !w.is_active)) && (!f.type || w.worker_type === f.type)
    && (!qq || `${w.worker_code} ${w.name_th} ${w.name_en || ""} ${w.department || ""}`.toLowerCase().includes(qq)));
  $("#spMain").innerHTML = head("รายชื่อผู้รับจ้าง", `${S.workers.filter(w => w.is_active).length} คนที่ใช้งานอยู่ · ไม่ใช่พนักงาน ไม่เข้ารายงานกำลังคน`,
    canWrite() ? `<button class="btn btn-p" id="addW">${ic("plus")}เพิ่มผู้รับจ้าง</button>` : "") + `
    <div class="filters"><label class="fld" style="width:300px"><span>ค้นหา</span><input class="in" id="pq" value="${esc(f.q)}" placeholder="รหัส / ชื่อ / แผนก"></label>
      <label class="fld"><span>ประเภท</span><select class="in" id="pt"><option value="">ทุกประเภท</option>${Object.entries(TYPE).map(([k, [l]]) => `<option value="${k}" ${f.type === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <div class="seg" style="align-self:flex-end">${[["active", "ใช้งาน"], ["inactive", "ปิดแล้ว"], ["all", "ทั้งหมด"]].map(([k, l]) => `<button data-sh="${k}" class="${f.show === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
    <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>ผู้รับจ้าง</th><th>ประเภท</th><th>แผนก</th><th class="n">ค่าจ้าง/เดือน</th><th>ภาษี</th><th>สัญญา</th><th>ข้อมูลที่ขาด</th></tr></thead><tbody>
    ${list.map(w => { const dl = daysLeft(w.end_date), miss = [!/^\d{13}$/.test(String(w.tax_id || "").replace(/\D/g, "")) && w.wht_apply ? "เลขภาษี" : "", String(w.bank_account || "").replace(/\D/g, "").length !== 10 ? "บัญชี" : "", !w.address && w.wht_apply ? "ที่อยู่" : "", !w.email ? "อีเมล" : ""].filter(Boolean);
      return `<tr class="click" data-person="${w.id}"><td><b>${esc(w.name_th)}</b><div class="sub">${esc(w.worker_code)}${w.name_en ? " · " + esc(w.name_en) : ""}</div></td><td>${badge(TYPE, w.worker_type)}</td><td>${esc(w.department || "-")}</td>
        <td class="n">${money(w.monthly_rate)}</td><td>${w.wht_apply ? `${Number(w.wht_percent)}%` : `<span class="hint">ไม่หัก</span>`}</td>
        <td>${w.end_date ? `${thDate(w.end_date)} ${dl != null && dl <= EXPIRY_DAYS ? `<span class="dl up">${dl < 0 ? "หมดแล้ว" : `เหลือ ${dl} วัน`}</span>` : ""}` : `<span class="hint">ไม่กำหนด</span>`}</td>
        <td>${miss.length ? `<span class="hint" style="color:var(--amber)">${miss.join(" · ")}</span>` : `<span class="hint">ครบ</span>`}</td></tr>`; }).join("") || `<tr><td colspan="7" class="empty">ไม่มีรายชื่อ</td></tr>`}</tbody></table></div>`;
  const m = $("#spMain");
  const pq = m.querySelector("#pq"); pq.oninput = () => { f.q = pq.value; const pos = pq.selectionStart; renderPeople(); const n = $("#pq"); n.focus(); n.setSelectionRange(pos, pos); };
  m.querySelector("#pt").onchange = e => { f.type = e.target.value; renderPeople(); };
  m.querySelectorAll("[data-sh]").forEach(b => b.onclick = () => { f.show = b.dataset.sh; renderPeople(); });
  m.querySelectorAll("[data-person]").forEach(tr => tr.onclick = () => personDrawer(+tr.dataset.person));
  m.querySelector("#addW")?.addEventListener("click", () => workerForm(null));
}
async function personDrawer(id) {
  const w = S.workers.find(x => x.id === id); if (!w) return;
  const hist = await q(supabase.from("contract_pay_item").select("run_id,net_amount,wht_amount,tax_base").eq("worker_id", id)).catch(() => []);
  const el = document.createElement("div"); el.className = "dw"; $("#spModal").appendChild(el);
  const close = () => { el.remove(); document.removeEventListener("keydown", onKey); }, onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  const draw = () => {
    const dl = daysLeft(w.end_date), recs = S.wItems.filter(i => i.worker_id === id);
    const inRun = location.hash.startsWith("#/run/") ? S.run : null;
    const runLines = inRun ? S.adj.filter(a => a.worker_id === id) : [];
    const span = w.start_date && w.end_date ? Math.max(1, (new Date(w.end_date) - new Date(w.start_date)) / 864e5) : 0;
    const used = span ? Math.min(100, Math.max(0, Math.round((new Date(todayISO()) - new Date(w.start_date)) / 864e5 / span * 100))) : 0;
    const runsById = new Map(S.runs.map(r => [r.id, r]));
    const H = hist.map(h => ({ ...h, run: runsById.get(h.run_id) })).filter(h => h.run).sort((a, b) => b.run.period.localeCompare(a.run.period));
    el.innerHTML = `<div class="dw-c" style="width:540px"><div class="dw-h"><div class="sp-av" style="width:44px;height:44px">${esc(w.name_th.split(/\s+/).map(s => s[0]).join("").slice(0, 2))}</div>
      <div class="t"><b>${esc(w.name_th)} ${badge(TYPE, w.worker_type)}</b><span>${esc([w.worker_code, w.department, w.cost_code ? "cost " + w.cost_code : ""].filter(Boolean).join(" · "))}</span></div><button class="btn btn-g btn-sm" data-x>${ic("x")}</button></div>
      <div class="dw-b">
        <div class="contract ${!w.end_date ? "none" : dl > EXPIRY_DAYS ? "ok" : ""}"><div style="display:flex;gap:8px;align-items:center">${ic("cal")}<b style="flex:1">${w.start_date || w.end_date ? `สัญญาจ้าง ${w.start_date ? thDate(w.start_date) : "?"} – ${w.end_date ? thDate(w.end_date) : "ไม่กำหนดวันสิ้นสุด"}` : "ยังไม่ได้ระบุวันสัญญา"}</b>
          ${w.end_date ? `<span class="dl ${dl > EXPIRY_DAYS ? "dn" : "up"}">${dl < 0 ? "หมดแล้ว" : `เหลือ ${dl} วัน`}</span>` : ""}</div>
          ${span ? `<div class="trk"><i style="width:${used}%"></i></div>` : ""}
          ${canWrite() ? `<div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-s btn-sm" id="renew">${ic("check")}ต่อสัญญา</button></div>` : ""}</div>
        <div><div class="h" style="margin-bottom:8px">ข้อมูลจ่ายเงิน</div><div class="kvg">
          <div><span>ค่าจ้างต่อเดือน</span><b>${money(w.monthly_rate)}</b></div><div><span>หัก ณ ที่จ่าย</span><b>${w.wht_apply ? `${Number(w.wht_percent)}% · หักทุกงวด` : "ไม่หัก"}</b></div>
          <div><span>เลขผู้เสียภาษี</span><b>${esc(w.tax_id || "—")}</b></div><div><span>บัญชีรับเงิน</span><b>${esc([w.bank_name, w.bank_account].filter(Boolean).join(" ") || "—")}</b></div>
          <div><span>อีเมล</span><b>${esc(w.email || "—")}</b></div><div><span>ที่อยู่ (ใน 50 ทวิ)</span><b>${esc(w.address || "—")}</b></div></div></div>
        ${inRun ? `<div><div class="h" style="margin-bottom:8px;display:flex;justify-content:space-between">งวด ${esc(thMonth(inRun.period))} ${editable() ? `<button class="lnk" id="addOnce">+ เพิ่มรายการงวดนี้</button>` : ""}</div>
          ${runLines.map(a => `<div class="recur" style="margin-bottom:6px"><span>${esc(a.label)}${a.source === "recurring" ? ' <em class="hint">(ประจำ)</em>' : ""}</span><b style="color:${a.kind === "earning" ? "var(--green)" : "var(--red)"}">${a.kind === "earning" ? "+" : "−"}${money(a.amount)}</b>
            ${editable() && a.source !== "recurring" ? `<button class="btn btn-g btn-sm" data-delonce="${a.id}">${ic("x")}</button>` : ""}</div>`).join("") || `<div class="hint">ไม่มีรายได้/หักเพิ่มในงวดนี้</div>`}</div>` : ""}
        <div><div class="h" style="margin-bottom:8px;display:flex;justify-content:space-between">รายการประจำ ${canWrite() ? `<button class="lnk" id="addRec">+ เพิ่ม</button>` : ""}</div>
          ${recs.map(i => { const c = codeOf(i.code_id) || {}; return `<div class="recur" style="margin-bottom:6px"><span>${esc(c.name_th || "?")}${c.kind === "earning" && c.tax_effect === false ? " (ไม่เข้าฐานภาษี)" : ""}${i.is_active === false ? ' <em class="hint">(ปิด)</em>' : ""}</span>
            <b style="color:${c.kind === "earning" ? "var(--green)" : "var(--ink)"}">${c.kind === "earning" ? "+" : "−"}${money(i.amount)}</b><span class="hint" style="flex:none">${i.end_period ? "ถึง " + thMonth(i.end_period) : "ทุกเดือน"}</span>
            ${canWrite() ? `<button class="btn btn-g btn-sm" data-delrec="${i.id}">${ic("x")}</button>` : ""}</div>`; }).join("") || `<div class="hint">ไม่มี</div>`}</div>
        <div><div class="h" style="margin-bottom:8px">ประวัติจ่าย</div>
          ${H.map(h => `<div style="display:flex;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)"><b style="width:90px">${esc(thMonth(h.run.period))}</b>${badge(ST, h.run.status)}
            <span style="flex:1;text-align:right;font-variant-numeric:tabular-nums">${money(h.net_amount)}</span>
            ${["approved", "locked"].includes(h.run.status) ? `${Number(h.wht_amount) ? `<button class="lnk" data-d50="${h.run.id}">50 ทวิ</button>` : ""}<button class="lnk" data-dslip="${h.run.id}">สลิป</button>` : `<span class="hint" style="width:80px;text-align:right">—</span>`}</div>`).join("") || `<div class="hint">ยังไม่เคยจ่าย</div>`}
          ${H.length ? `<div class="hint" style="margin-top:8px">รวมปี ${new Date().getFullYear() + 543}: เงินได้ ${money(H.filter(h => h.run.period.startsWith(String(new Date().getFullYear()))).reduce((s, h) => s + Number(h.tax_base || 0), 0))} · ภาษี ${money(H.filter(h => h.run.period.startsWith(String(new Date().getFullYear()))).reduce((s, h) => s + Number(h.wht_amount || 0), 0))}</div>` : ""}</div>
      </div>
      <div class="dw-f">${canWrite() ? `<button class="btn btn-s" id="editW">${ic("pen")}แก้ไขข้อมูล</button>` : ""}<button class="btn btn-g" data-x>ปิด</button></div></div>`;
    el.querySelectorAll("[data-x]").forEach(b => b.onclick = close);
    el.onclick = e => { if (e.target === el) close(); };
    el.querySelector("#editW")?.addEventListener("click", () => { close(); workerForm(w); });
    el.querySelector("#renew")?.addEventListener("click", async () => { const v = prompt("วันสิ้นสุดสัญญาใหม่ (ปปปป-ดด-วว)", w.end_date || ""); if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
      try { Object.assign(w, await q(supabase.from("contract_workers").update({ end_date: v, updated_at: new Date().toISOString() }).eq("id", w.id).select().single())); draw(); toast("ต่อสัญญาแล้ว", "ok"); } catch (e) { fail(e); } });
    el.querySelector("#addRec")?.addEventListener("click", () => recurForm(w, draw));
    el.querySelectorAll("[data-delrec]").forEach(b => b.onclick = async () => { if (!confirm("ลบรายการประจำนี้? (งวดที่ประมวลผลไปแล้วไม่เปลี่ยน)")) return;
      try { await q(supabase.from("contract_worker_items").delete().eq("id", +b.dataset.delrec)); S.wItems = S.wItems.filter(i => i.id !== +b.dataset.delrec); draw(); } catch (e) { fail(e); } });
    el.querySelector("#addOnce")?.addEventListener("click", () => onceForm(w, async () => { await afterAdjust(); draw(); }));
    el.querySelectorAll("[data-delonce]").forEach(b => b.onclick = async () => { try { await q(supabase.from("contract_pay_adjust").delete().eq("id", +b.dataset.delonce)); await afterAdjust(); draw(); } catch (e) { fail(e); } });
    el.querySelectorAll("[data-d50],[data-dslip]").forEach(b => b.onclick = async () => { const rid = +(b.dataset.d50 || b.dataset.dslip);
      const keep = { run: S.run, items: S.items, adj: S.adj, prevItems: S.prevItems, prevRun: S.prevRun };
      try { await loadRun(rid); S.items = S.items.filter(i => i.worker_id === id); S.adj = S.adj.filter(a => a.worker_id === id); await doc(b.dataset.d50 ? "50" : "slip"); } finally { Object.assign(S, keep); } });
  };
  draw();
}
function onceForm(w, done) {
  const C = activeCodes();
  const el = modal(`เพิ่มรายการงวดนี้ · ${esc(w.name_th)}`, `<div class="grid2"><label class="fld"><span>รายการ</span><select class="in" id="oc">${C.map(c => `<option value="${c.id}">${c.kind === "earning" ? "+ " : "− "}${esc(c.name_th)}</option>`).join("")}</select></label>
    <label class="fld"><span>จำนวนเงิน</span><input class="in" id="oa" type="number" step="0.01" min="0"></label></div><label class="fld"><span>หมายเหตุ</span><input class="in" id="or"></label>`,
    `<button class="btn btn-g" data-x>ยกเลิก</button><button class="btn btn-p" id="ok">เพิ่ม</button>`);
  el.querySelectorAll("[data-x]").forEach(x => x.onclick = () => el.remove());
  el.querySelector("#ok").onclick = async () => { const c = codeOf(+el.querySelector("#oc").value), v = round2(el.querySelector("#oa").value);
    if (!(v > 0)) return toast("ใส่จำนวนเงิน", "err");
    try { await q(supabase.from("contract_pay_adjust").insert({ run_id: S.run.id, worker_id: w.id, kind: c.kind, label: c.name_th, amount: v, code_id: c.id, source: "once",
      taxable: c.kind === "earning" ? c.tax_effect !== false : true, cuts_tax_base: c.kind === "deduction" && !!c.tax_effect, remark: el.querySelector("#or").value.trim() || null, created_by: S.user.id }));
      el.remove(); await done(); } catch (e) { fail(e); } };
}
function recurForm(w, done) {
  const C = activeCodes(), now = todayISO().slice(0, 7);
  const el = modal(`รายการประจำ · ${esc(w.name_th)}`, `<div class="grid2"><label class="fld"><span>รายการ</span><select class="in" id="rc">${C.map(c => `<option value="${c.id}">${c.kind === "earning" ? "+ " : "− "}${esc(c.name_th)}</option>`).join("")}</select></label>
    <label class="fld"><span>จำนวนเงินต่อเดือน</span><input class="in" id="ra" type="number" step="0.01" min="0"></label>
    <label class="fld"><span>เริ่มงวด</span><input class="in" id="rs" type="month" value="${now}"></label><label class="fld"><span>ถึงงวด (ว่าง = ไม่กำหนด)</span><input class="in" id="re" type="month"></label></div>
    <label class="fld"><span>หมายเหตุ</span><input class="in" id="rn" placeholder="เช่น หมายบังคับคดีเลขที่ ..."></label>`,
    `<button class="btn btn-g" data-x>ยกเลิก</button><button class="btn btn-p" id="ok">บันทึก</button>`);
  el.querySelectorAll("[data-x]").forEach(x => x.onclick = () => el.remove());
  el.querySelector("#ok").onclick = async () => { const v = round2(el.querySelector("#ra").value), s = el.querySelector("#rs").value, e = el.querySelector("#re").value || null;
    if (!(v > 0) || !s) return toast("ใส่จำนวนเงินและงวดเริ่ม", "err");
    try { const row = await q(supabase.from("contract_worker_items").insert({ worker_id: w.id, code_id: +el.querySelector("#rc").value, amount: v, start_period: s, end_period: e, note: el.querySelector("#rn").value.trim() || null, created_by: S.user.id }).select().single());
      S.wItems.push(row); el.remove(); done(); toast("บันทึกแล้ว · มีผลกับงวดที่ประมวลผลหลังจากนี้", "ok"); } catch (er) { fail(er); } };
}
function workerForm(w) {
  const v = w || { worker_type: "consultant", wht_apply: true, wht_percent: 3, is_active: true, bank_name: "กสิกรไทย" };
  const f = (k, l, t = "text", ex = "") => `<label class="fld"><span>${l}</span><input class="in" data-k="${k}" type="${t}" value="${esc(v[k] ?? "")}" ${ex}></label>`;
  const el = modal(w ? `แก้ไข ${esc(w.name_th)}` : "เพิ่มผู้รับจ้าง", `<div class="grid2">${f("worker_code", "รหัส *", "text", 'placeholder="เช่น SUB1258"')}
    <label class="fld"><span>ประเภท</span><select class="in" data-k="worker_type">${Object.entries(TYPE).map(([k, [l]]) => `<option value="${k}" ${v.worker_type === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    ${f("name_th", "ชื่อ-สกุล (ไทย) *")}${f("name_en", "ชื่อ-สกุล (อังกฤษ) — ใช้ในไฟล์โอน")}${f("tax_id", "เลขผู้เสียภาษี 13 หลัก", "text", 'inputmode="numeric"')}${f("email", "อีเมล", "email")}
    ${f("department", "แผนก")}${f("cost_code", "cost code")}${f("monthly_rate", "ค่าจ้างต่อเดือน", "number", 'step="0.01"')}
    <div class="fld"><span>หัก ณ ที่จ่าย</span><div style="display:flex;gap:8px;align-items:center"><label class="chk" style="padding:0"><input type="checkbox" data-k="wht_apply" ${v.wht_apply ? "checked" : ""}> หัก</label><input class="in" data-k="wht_percent" type="number" step="0.01" value="${v.wht_percent ?? 3}" style="width:90px"> %</div></div>
    ${f("bank_name", "ธนาคาร")}${f("bank_account", "เลขบัญชี (กสิกร 10 หลัก)", "text", 'inputmode="numeric"')}${f("start_date", "วันเริ่มสัญญา", "date")}${f("end_date", "วันสิ้นสุดสัญญา", "date")}</div>
    <label class="fld"><span>ที่อยู่ (ช่องผู้ถูกหักภาษีใน 50 ทวิ)</span><textarea class="in" data-k="address" rows="2">${esc(v.address || "")}</textarea></label>
    <label class="fld"><span>หมายเหตุ</span><input class="in" data-k="remark" value="${esc(v.remark || "")}"></label>
    ${w ? `<label class="opt"><input type="checkbox" data-k="is_active" ${v.is_active ? "checked" : ""}><div><b>ใช้งานอยู่</b><div class="hint">ปิดแล้วจะไม่ถูกดึงเข้างวดใหม่ ประวัติยังอยู่ครบ</div></div></label>` : ""}`,
    `<button class="btn btn-g" data-x>ยกเลิก</button><button class="btn btn-p" id="ok">บันทึก</button>`);
  el.querySelectorAll("[data-x]").forEach(x => x.onclick = () => el.remove());
  el.querySelector("#ok").onclick = async () => {
    const d = {}; el.querySelectorAll("[data-k]").forEach(i => { d[i.dataset.k] = i.type === "checkbox" ? i.checked : i.value.trim(); });
    if (!d.worker_code || !d.name_th) return toast("กรอกรหัสและชื่อ", "err");
    if (d.tax_id && !/^\d{13}$/.test(d.tax_id.replace(/\D/g, ""))) return toast("เลขผู้เสียภาษีต้องมี 13 หลัก", "err");
    for (const k of ["name_en", "tax_id", "email", "department", "cost_code", "bank_name", "bank_account", "start_date", "end_date", "address", "remark"]) d[k] = d[k] || null;
    if (d.tax_id) d.tax_id = d.tax_id.replace(/\D/g, ""); if (d.bank_account) d.bank_account = d.bank_account.replace(/\D/g, "");
    d.monthly_rate = round2(d.monthly_rate); d.wht_percent = Number(d.wht_percent) || 0; d.updated_at = new Date().toISOString();
    try { if (w) await q(supabase.from("contract_workers").update(d).eq("id", w.id)); else await q(supabase.from("contract_workers").insert({ ...d, created_by: S.user.id }));
      el.remove(); await loadAll(); route(); toast("บันทึกแล้ว · งวดที่ประมวลผลไปแล้วยังใช้ข้อมูลเดิม จนกว่าจะประมวลผลใหม่", "ok"); }
    catch (e) { fail(/duplicate|unique/.test(e.message) ? "รหัสนี้มีอยู่แล้ว" : e); }
  };
}

// ---------------------------------------------------------------- รายการได้ / หัก
function renderCodes() {
  const sect = kind => `<div class="card" style="margin-bottom:16px"><div class="card-b" style="padding-bottom:8px"><div class="card-h" style="margin:0"><div class="t"><b>${kind === "earning" ? "รายได้" : "รายหัก"}</b>
    <span>${kind === "earning" ? "ติ๊ก “คิดภาษี” = เข้าฐานภาษี 3%" : "ติ๊ก “ลดฐานภาษี” = หักก่อนคิดภาษี (เช่นหักขาดงาน)"}</span></div>${canWrite() ? `<button class="btn btn-s btn-sm" data-add="${kind}">${ic("plus")}เพิ่ม</button>` : ""}</div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>${kind === "earning" ? "คิดภาษี" : "ลดฐานภาษี"}</th><th>สถานะ</th>${canWrite() ? "<th></th>" : ""}</tr></thead><tbody>
    ${S.codes.filter(c => c.kind === kind).map(c => `<tr><td><b>${esc(c.code)}</b></td><td>${esc(c.name_th)}<div class="sub">${esc(c.name_en || "")}</div></td><td>${c.tax_effect ? "✓" : "—"}</td>
      <td>${c.is_active !== false ? `<span class="bd g">ใช้งาน</span>` : `<span class="bd n">ปิด</span>`}</td>${canWrite() ? `<td><button class="btn btn-s btn-sm" data-ed="${c.id}">แก้ไข</button></td>` : ""}</tr>`).join("")}</tbody></table></div></div>`;
  $("#spMain").innerHTML = head("รายการได้ / หัก", "รายการที่ใช้กรอกในงวดและตั้งเป็นรายการประจำ · เพิ่มเองได้ ไม่ต้องแก้โค้ด") + sect("earning") + sect("deduction");
  const m = $("#spMain");
  m.querySelectorAll("[data-add]").forEach(b => b.onclick = () => codeForm(null, b.dataset.add));
  m.querySelectorAll("[data-ed]").forEach(b => b.onclick = () => codeForm(codeOf(+b.dataset.ed)));
}
function codeForm(c, kind) {
  const v = c || { kind, tax_effect: kind === "earning", is_active: true, sort_order: 50 };
  const el = modal(c ? "แก้ไขรายการ" : "เพิ่มรายการ", `<div class="grid2"><label class="fld"><span>รหัส</span><input class="in" id="cc" value="${esc(v.code || "")}" placeholder="${v.kind === "earning" ? "E06" : "D04"}"></label>
    <label class="fld"><span>ลำดับ</span><input class="in" id="co" type="number" value="${v.sort_order}"></label><label class="fld"><span>ชื่อ (ไทย)</span><input class="in" id="cn" value="${esc(v.name_th || "")}"></label>
    <label class="fld"><span>ชื่อ (อังกฤษ)</span><input class="in" id="ce" value="${esc(v.name_en || "")}"></label></div>
    <label class="opt"><input type="checkbox" id="ct" ${v.tax_effect ? "checked" : ""}><div><b>${v.kind === "earning" ? "คิดภาษี" : "ลดฐานภาษี"}</b></div></label>
    <label class="opt"><input type="checkbox" id="ca" ${v.is_active !== false ? "checked" : ""}><div><b>ใช้งานอยู่</b></div></label>`,
    `<button class="btn btn-g" data-x>ยกเลิก</button><button class="btn btn-p" id="ok">บันทึก</button>`);
  el.querySelectorAll("[data-x]").forEach(x => x.onclick = () => el.remove());
  el.querySelector("#ok").onclick = async () => {
    const d = { code: el.querySelector("#cc").value.trim().toUpperCase(), name_th: el.querySelector("#cn").value.trim(), name_en: el.querySelector("#ce").value.trim() || null,
      sort_order: +el.querySelector("#co").value || 50, tax_effect: el.querySelector("#ct").checked, is_active: el.querySelector("#ca").checked, kind: v.kind };
    if (!d.code || !d.name_th) return toast("กรอกรหัสและชื่อ", "err");
    try { if (c) await q(supabase.from("contract_pay_codes").update(d).eq("id", c.id)); else await q(supabase.from("contract_pay_codes").insert(d)); el.remove(); await loadAll(); renderCodes(); toast("บันทึกแล้ว", "ok"); }
    catch (e) { fail(/duplicate|unique/.test(e.message) ? "รหัสนี้มีอยู่แล้ว" : e); }
  };
}

// ---------------------------------------------------------------- ตั้งค่า
function renderSettings() {
  const s = S.settings, dis = canWrite() ? "" : "disabled";
  $("#spMain").innerHTML = head("ตั้งค่า", "ข้อมูลบริษัทใน 50 ทวิ และบัญชีที่ตัดเงินในไฟล์โอนกสิกร") + `<div class="card card-b" style="max-width:760px">
    <div class="grid2"><label class="fld"><span>ชื่อบริษัท (ผู้มีหน้าที่หักภาษี)</span><input class="in" id="s1" value="${esc(s.company_name_th || "")}" ${dis}></label>
      <label class="fld"><span>เลขประจำตัวผู้เสียภาษีบริษัท</span><input class="in" id="s2" value="${esc(s.company_tax_id || "")}" ${dis}></label></div>
    <label class="fld" style="margin-top:12px"><span>ที่อยู่ (ใน 50 ทวิ)</span><input class="in" id="s3" value="${esc(s.company_address || "")}" ${dis}></label>
    <div class="grid2" style="margin-top:12px"><label class="fld"><span>บัญชีกสิกรที่ตัดเงิน (10 หลัก)</span><input class="in" id="s4" value="${esc(s.bank_account || "")}" ${dis}></label>
      <label class="fld"><span>ชื่อบริษัทในไฟล์โอน</span><input class="in" id="s5" value="${esc(s.bank_company || "")}" ${dis}></label></div>
    ${canWrite() ? `<div style="margin-top:16px;display:flex;justify-content:flex-end"><button class="btn btn-p" id="sv">บันทึก</button></div>` : ""}</div>
    <div class="card card-b" style="max-width:760px;margin-top:16px"><div class="card-t">ผู้อนุมัติ (ผู้ลงนาม 50 ทวิ)</div>
      ${S.signers.map(g => `<div>${esc(g.name)} <span class="hint">${esc(g.title || "")}</span></div>`).join("") || `<div class="hint">ยังไม่มี — ให้ Admin ติ๊กสิทธิ์ “อนุมัติงวดค่าจ้างเหมา” และผู้อนุมัติอัปโหลดลายเซ็นที่หน้า “ลายเซ็นของฉัน” ในระบบ HR</div>`}</div>`;
  $("#sv")?.addEventListener("click", async () => {
    const d = { company_name_th: $("#s1").value.trim(), company_tax_id: $("#s2").value.replace(/\D/g, ""), company_address: $("#s3").value.trim(), bank_account: $("#s4").value.replace(/\D/g, ""), bank_company: $("#s5").value.trim(), updated_at: new Date().toISOString() };
    if (!/^\d{13}$/.test(d.company_tax_id)) return toast("เลขผู้เสียภาษีต้องมี 13 หลัก", "err");
    if (!/^\d{10}$/.test(d.bank_account)) return toast("บัญชีกสิกรต้องมี 10 หลัก", "err");
    try { S.settings = await q(supabase.from("contract_settings").update(d).eq("id", 1).select().single()); toast("บันทึกแล้ว", "ok"); } catch (e) { fail(e); }
  });
}

boot();
