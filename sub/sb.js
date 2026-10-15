// ============================================================================
// SUB Register — ทะเบียนคนจากบริษัทผู้รับเหมา (เว็บ /sub)
//   หน้า: #/overview · #/people[/companyId] · #/companies · #/report · #/import
//   HR อัปเดตเท่านั้น (data.sub.write) · ดูได้ด้วย page.sub · ประวัติการแก้บันทึกโดย trigger (sub_worker_log)
//   ⚠️ ไม่ใช่พนักงาน และไม่ใช่ค่าจ้างเหมา 3% — ไม่เข้ารายงานกำลังคนของบริษัท
//   ⚠️ เลขบัตรประชาชน/passport: พิมพ์เลขเต็มได้ แต่ส่งขึ้นฐานข้อมูลแค่ 5 ตัวท้าย
//   ห้าม import js/app.js
// ============================================================================
import { supabase } from "../js/supabase-config.js";
import { parseSheet, pickLatest, diffImport, monthly, expiring, activeAt, lastDay, EXPIRY_DAYS } from "../js/sub-calc.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const n0 = v => Number(v || 0).toLocaleString("en-US");
const TH_M = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const TH_MF = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const thDate = iso => { if (!iso) return "-"; const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return `${d} ${TH_M[m - 1]} ${String(y + 543).slice(2)}`; };
const thMonth = ym => { const [y, m] = ym.split("-").map(Number); return `${TH_MF[m - 1]} ${y + 543}`; };
const todayISO = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const $ = s => document.querySelector(s);
const plus = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>', dl = '<svg viewBox="0 0 24 24"><path d="M12 15V3"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';
const ST = { active: ["ทำงานอยู่", "g"], left: ["ออกแล้ว", "n"], banned: ["ห้ามเข้า", "r"] };
const badge = k => { const [t, c] = ST[k] || [k, "n"]; return `<span class="bd ${c}">${t}</span>`; };

const S = { user: null, perms: new Set(), companies: [], workers: [], filt: {} };
const can = k => S.perms.has(k), canWrite = () => can("data.sub.write");
const coOf = id => S.companies.find(c => c.id === id);
const fullName = w => [w.title, w.first_name, w.last_name].filter(Boolean).join(" ");
const q = async p => { const { data, error } = await p; if (error) throw error; return data; };
function toast(msg, type = "") { const el = document.createElement("div"); el.className = "toast " + type; el.textContent = msg; $("#spToasts").appendChild(el); setTimeout(() => el.remove(), 5000); }
const fail = (e, w = "บันทึกไม่สำเร็จ") => toast(`${w}: ${String(e?.message || e)}`, "err");
function modal(title, body, foot, wide) {
  const el = document.createElement("div"); el.className = "mo";
  el.innerHTML = `<div class="mo-c" ${wide ? 'style="max-width:860px"' : ""}><div class="mo-h">${title}<button class="btn btn-g btn-sm" data-x>✕</button></div><div class="mo-b">${body}</div><div class="mo-f">${foot}</div></div>`;
  $("#spModal").appendChild(el); el.querySelectorAll("[data-x]").forEach(b => b.onclick = () => el.remove()); el.onclick = e => { if (e.target === el) el.remove(); };
  return el;
}
async function fetchAll(f) { const out = []; for (let i = 0; ; i += 1000) { const d = await q(f().range(i, i + 999)); out.push(...d); if (d.length < 1000) break; } return out; }

// ---------------------------------------------------------------- เริ่มต้น
async function boot() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { $("#spMain").innerHTML = `<div class="card card-b" style="max-width:460px;margin:60px auto;text-align:center"><div class="card-t" style="justify-content:center">กรุณาเข้าสู่ระบบ</div><p class="sp-sub" style="margin-bottom:16px">ใช้บัญชีเดียวกับระบบ HR</p><a class="btn btn-p" href="/">ไปหน้าเข้าสู่ระบบ HR</a></div>`; return; }
  S.user = session.user;
  const { data: perms } = await supabase.rpc("my_permissions");
  S.perms = new Set((perms || []).map(p => typeof p === "string" ? p : p.perm_key || p.key));
  const name = S.user.user_metadata?.full_name || S.user.email || "";
  $("#spUser").innerHTML = `<div class="sp-av">${esc(name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase())}</div><div><b>${esc(name)}</b><span>${canWrite() ? "HR · แก้ทะเบียนได้" : "ดูอย่างเดียว"}</span></div>`;
  if (!can("page.sub")) { $("#spMain").innerHTML = `<div class="empty">บัญชีนี้ยังไม่มีสิทธิ์ใช้ทะเบียนผู้รับเหมา — ให้ Admin เพิ่มสิทธิ์ที่ User Management</div>`; return; }
  try { await loadAll(); } catch (e) { $("#spMain").innerHTML = `<div class="card card-b"><b>โหลดข้อมูลไม่สำเร็จ</b><p class="sp-sub">${esc(e.message)}</p><p class="hint" style="margin-top:8px">ถ้ายังไม่ได้รัน <code>sql/schema_sub.sql</code> ใน Supabase ให้รันก่อน</p></div>`; return; }
  window.addEventListener("hashchange", route); route();
}
async function loadAll() {
  const [c, w] = await Promise.all([q(supabase.from("sub_companies").select("*").order("name")), fetchAll(() => supabase.from("sub_workers").select("*").order("id"))]);
  S.companies = c; S.workers = w;
  const n = S.workers.filter(x => expiring(x, todayISO()).length).length;
  $("#navExp").textContent = n ? String(n) : "";
}
function route() {
  const [r, arg] = location.hash.replace(/^#\/?/, "").split("/"), page = r || "overview";
  document.querySelectorAll("#spNav a").forEach(a => a.classList.toggle("on", a.dataset.r === page));
  window.scrollTo(0, 0);
  ({ overview: renderOverview, people: () => renderPeople(arg), companies: renderCompanies, report: renderReport, import: renderImport }[page] || renderOverview)();
}
const head = (t, s, a = "") => `<div class="sp-head"><div class="t"><div class="sp-title">${t}</div><div class="sp-sub">${s}</div></div>${a}</div>`;

// ---------------------------------------------------------------- ภาพรวม
function renderOverview() {
  const today = todayISO(), ym = today.slice(0, 7), act = S.workers.filter(w => activeAt(w, today) && w.status === "active");
  const joined = S.workers.filter(w => w.start_date?.startsWith(ym)).length, left = S.workers.filter(w => w.left_on?.startsWith(ym)).length;
  const exp = S.workers.map(w => ({ w, e: expiring(w, today) })).filter(x => x.e.length).sort((a, b) => a.e[0].left - b.e[0].left);
  $("#spMain").innerHTML = head("ทะเบียนผู้รับเหมา", `คนจากบริษัทผู้รับเหมาที่มาทำงานที่ไซต์ · ${S.companies.filter(c => c.is_active).length} บริษัท`,
    `<a class="btn btn-s" href="#/report">รายงานรายเดือน</a>${canWrite() ? `<a class="btn btn-p" href="#/import">${dl}นำเข้าไฟล์</a>` : ""}`) + `
    <div class="stats">
      <div class="stat"><div class="l">ทำงานอยู่</div><div class="v">${n0(act.length)}</div><div class="m">ไทย ${n0(act.filter(w => w.nationality === "Thai").length)} · ต่างชาติ ${n0(act.filter(w => w.nationality !== "Thai").length)}</div></div>
      <div class="stat"><div class="l">เข้าใหม่เดือนนี้</div><div class="v">${joined}</div><div class="m">${thMonth(ym)}</div></div>
      <div class="stat"><div class="l">ออกเดือนนี้</div><div class="v">${left}</div><div class="m">นับตามวันทำงานวันสุดท้าย</div></div>
      <div class="stat${exp.length ? " hl" : ""}"><div class="l">เอกสารหมด / ใกล้หมด</div><div class="v">${exp.length} คน</div><div class="m">บัตร · Induction · ใบรับรองแพทย์ · Work Permit ภายใน ${EXPIRY_DAYS} วัน</div></div></div>
    <div class="ov"><div class="card card-b"><div class="card-h"><div class="t"><b>แยกตามบริษัท</b><span>กดเพื่อดูรายชื่อ</span></div></div>
      <div class="co-grid">${S.companies.map(c => { const a = act.filter(w => w.company_id === c.id), ce = c.contract_end && Math.round((Date.parse(c.contract_end) - Date.parse(today)) / 864e5);
        return `<button class="co" data-co="${c.id}"><b>${esc(c.name)}</b><span class="n">${n0(a.length)}<small> คน</small></span>
          <small>${esc(c.scope || c.legal_name || "")}${a.some(w => w.nationality !== "Thai") ? ` · ต่างชาติ ${a.filter(w => w.nationality !== "Thai").length}` : ""}</small>
          ${c.contract_end ? `<small style="color:${ce <= EXPIRY_DAYS ? "var(--amber)" : "inherit"}">สัญญาถึง ${thDate(c.contract_end)}</small>` : ""}</button>`; }).join("") || `<div class="hint">ยังไม่มีข้อมูล — กด “นำเข้าไฟล์”</div>`}</div></div>
      <div class="card card-b"><div class="card-h"><div class="t"><b>เอกสารหมด / ใกล้หมด</b></div></div><div class="feed">
        ${exp.slice(0, 12).map(({ w, e }) => `<div class="fi" style="cursor:pointer" data-w="${w.id}"><div><b>${esc(fullName(w))}</b><span>${esc(coOf(w.company_id)?.name || "")} · ${esc(w.sub_no || "")}</span>
          <small style="color:${e[0].left < 0 ? "var(--red)" : "var(--amber)"}">${e.map(x => `${x.label} ${x.left < 0 ? "หมดแล้ว" : `อีก ${x.left} วัน`}`).join(" · ")}</small></div></div>`).join("") || `<div class="hint">ไม่มี (หรือยังไม่ได้กรอกวันหมดอายุ)</div>`}
        ${exp.length > 12 ? `<a class="lnk" href="#/people" id="allExp">ดูทั้งหมด ${exp.length} คน →</a>` : ""}</div></div></div>`;
  const m = $("#spMain");
  m.querySelectorAll("[data-co]").forEach(b => b.onclick = () => { location.hash = `#/people/${b.dataset.co}`; });
  m.querySelectorAll("[data-w]").forEach(b => b.onclick = () => drawer(+b.dataset.w));
  m.querySelector("#allExp")?.addEventListener("click", () => { (S.filt.p ||= {}).exp = true; });
}

// ---------------------------------------------------------------- รายชื่อ
function renderPeople(coArg) {
  const f = S.filt.p ||= { q: "", co: "", st: "active", nat: "", area: "", exp: false };
  if (coArg) { f.co = coArg; history.replaceState(null, "", "#/people"); }
  const qq = f.q.toLowerCase(), today = todayISO();
  const list = S.workers.filter(w => (!f.co || String(w.company_id) === String(f.co)) && (!f.st || w.status === f.st) && (!f.nat || (f.nat === "Thai" ? w.nationality === "Thai" : w.nationality !== "Thai"))
    && (!f.area || w.area === f.area) && (!f.exp || expiring(w, today).length)
    && (!qq || `${w.sub_no || ""} ${w.ac_no || ""} ${w.card_no || ""} ${w.first_name} ${w.last_name || ""} ${w.team || ""}`.toLowerCase().includes(qq)))
    .sort((a, b) => (coOf(a.company_id)?.name || "").localeCompare(coOf(b.company_id)?.name || "") || String(a.sub_no || "").localeCompare(String(b.sub_no || ""), undefined, { numeric: true }));
  const shown = list.slice(0, S.filt.pn || 300), areas = [...new Set(S.workers.map(w => w.area).filter(Boolean))].sort();
  const sel = (id, opts, v, all) => `<select class="in" id="${id}"><option value="">${all}</option>${opts.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  $("#spMain").innerHTML = head("รายชื่อผู้รับเหมา", `${n0(list.length)} คน`, `<button class="btn btn-s" id="xl">${dl}Export Excel</button>${canWrite() ? `<button class="btn btn-p" id="addW">${plus}เพิ่มคน</button>` : ""}`) + `
    <div class="filters"><label class="fld" style="width:260px"><span>ค้นหา</span><input class="in" id="pq" value="${esc(f.q)}" placeholder="SUB No. / ชื่อ / AC / เลขบัตร"></label>
      <label class="fld"><span>บริษัท</span>${sel("pc", S.companies.map(c => [c.id, c.name]), f.co, "ทุกบริษัท")}</label>
      <label class="fld"><span>สถานะ</span>${sel("ps", Object.entries(ST).map(([k, [l]]) => [k, l]), f.st, "ทุกสถานะ")}</label>
      <label class="fld"><span>สัญชาติ</span>${sel("pn", [["Thai", "ไทย"], ["F", "ต่างชาติ"]], f.nat, "ทั้งหมด")}</label>
      <label class="fld"><span>พื้นที่</span>${sel("pa", areas.map(a => [a, a]), f.area, "ทุกพื้นที่")}</label>
      <label class="chk" style="align-self:flex-end;padding-bottom:8px"><input type="checkbox" id="pe" ${f.exp ? "checked" : ""}> เอกสารหมด/ใกล้หมด</label></div>
    <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>SUB No.</th><th>ชื่อ-สกุล</th><th>บริษัท / ทีม</th><th>AC NO.</th><th>เลขหลังบัตร</th><th>พื้นที่</th><th>สถานะ</th><th>ต้องดู</th></tr></thead><tbody>
    ${shown.map(w => { const e = expiring(w, today); return `<tr class="click" data-w="${w.id}"><td><b>${esc(w.sub_no || "—")}</b></td><td>${esc(fullName(w))}${w.nationality !== "Thai" ? ` <span class="bd b">${esc(w.nationality)}</span>` : ""}</td>
      <td>${esc(coOf(w.company_id)?.name || "")}${w.team ? `<div class="sub">${esc(w.team)}</div>` : ""}</td><td>${esc(w.ac_no || "")}</td><td>${esc(w.card_no || "")}</td><td>${esc(w.area || "")}</td>
      <td>${badge(w.status)}${w.left_on ? `<div class="sub">${thDate(w.left_on)}</div>` : ""}</td>
      <td>${e.map(x => `<span class="dl up" style="${x.left < 0 ? "background:var(--red-50);color:var(--red)" : ""}">${esc(x.label)} ${x.left < 0 ? "หมด" : x.left + " วัน"}</span>`).join(" ")}</td></tr>`; }).join("")
      || `<tr><td colspan="8" class="empty">ไม่มีรายชื่อ</td></tr>`}</tbody></table>
    ${list.length > shown.length ? `<div class="more"><button class="btn btn-g btn-sm" id="more">แสดงเพิ่ม (${n0(list.length - shown.length)})</button></div>` : ""}</div>`;
  const m = $("#spMain"), re = () => { S.filt.pn = 300; renderPeople(); };
  const pq = m.querySelector("#pq"); pq.oninput = () => { f.q = pq.value; const pos = pq.selectionStart; renderPeople(); const n = $("#pq"); n.focus(); n.setSelectionRange(pos, pos); };
  for (const [id, k] of [["pc", "co"], ["ps", "st"], ["pn", "nat"], ["pa", "area"]]) m.querySelector("#" + id).onchange = e => { f[k] = e.target.value; re(); };
  m.querySelector("#pe").onchange = e => { f.exp = e.target.checked; re(); };
  m.querySelector("#more")?.addEventListener("click", () => { S.filt.pn = (S.filt.pn || 300) + 500; renderPeople(); });
  m.querySelectorAll("[data-w]").forEach(tr => tr.onclick = () => drawer(+tr.dataset.w));
  m.querySelector("#addW")?.addEventListener("click", () => workerForm(null));
  m.querySelector("#xl").onclick = () => exportPeople(list);
}
const LABEL = { sub_no: "SUB No.", ac_no: "AC NO.", card_no: "เลขหลังบัตร", title: "คำนำหน้า", first_name: "ชื่อ", last_name: "สกุล", company_id: "บริษัท", team: "ทีม", area: "พื้นที่", position: "ตำแหน่ง",
  nationality: "สัญชาติ", status: "สถานะ", left_on: "วันสุดท้าย", left_reason: "เหตุที่ออก", start_date: "วันเริ่ม", card_expiry: "บัตรหมดอายุ", induction_date: "อบรม Induction", induction_expiry: "Induction หมดอายุ",
  medical_expiry: "ใบแพทย์หมดอายุ", work_permit_expiry: "Work Permit หมดอายุ", phone: "เบอร์โทร", remark: "หมายเหตุ", licenses: "ใบอนุญาต" };
async function drawer(id) {
  const w = S.workers.find(x => x.id === id); if (!w) return;
  const log = await q(supabase.from("sub_worker_log").select("*").eq("worker_id", id).order("at", { ascending: false }).limit(30)).catch(() => []);
  const el = document.createElement("div"); el.className = "dw"; $("#spModal").appendChild(el);
  const close = () => { el.remove(); document.removeEventListener("keydown", k); }, k = e => { if (e.key === "Escape") close(); }; document.addEventListener("keydown", k);
  const kv = (l, v) => `<div><span>${l}</span><b>${v || "—"}</b></div>`, e = expiring(w, todayISO());
  const val = (f, v) => f === "company_id" ? coOf(v)?.name || v : f === "licenses" ? (v || []).map(x => x.name).join(", ") : v ?? "—";
  el.innerHTML = `<div class="dw-c" style="width:560px"><div class="dw-h"><div class="sp-av" style="width:44px;height:44px">${esc((w.first_name[0] || "") + (w.last_name?.[0] || ""))}</div>
    <div class="t"><b>${esc(fullName(w))} ${badge(w.status)}</b><span>${esc([w.sub_no, coOf(w.company_id)?.name, w.team, w.area].filter(Boolean).join(" · "))}</span></div><button class="btn btn-g btn-sm" data-x>✕</button></div>
    <div class="dw-b">
      ${e.length ? `<div class="ck ${e[0].left < 0 ? "block" : "warn"}"><div class="t"><b>เอกสารหมด / ใกล้หมด</b><span>${e.map(x => `${esc(x.label)} ${thDate(x.date)} (${x.left < 0 ? "หมดแล้ว" : `อีก ${x.left} วัน`})`).join(" · ")}</span></div></div>` : ""}
      <div><div class="h" style="margin-bottom:8px">บัตรเข้าพื้นที่</div><div class="kvg">${kv("AC NO.", esc(w.ac_no))}${kv("เลขหลังบัตร", esc(w.card_no))}${kv("ออกบัตร", w.card_issued && thDate(w.card_issued))}${kv("บัตรหมดอายุ", w.card_expiry && thDate(w.card_expiry))}${kv("คืนบัตร", w.card_returned && thDate(w.card_returned))}${kv("วันเริ่มเข้าพื้นที่", w.start_date && thDate(w.start_date))}</div></div>
      <div><div class="h" style="margin-bottom:8px">ตัวคน</div><div class="kvg">${kv("สัญชาติ", esc(w.nationality))}${kv("บัตรประชาชน (5 ตัวท้าย)", w.id_last5 && "x-xxxx-x" + esc(w.id_last5))}${kv("วันเกิด", w.birth_date && thDate(w.birth_date))}${kv("ตำแหน่ง", esc(w.position))}
        ${kv("เบอร์โทร", esc(w.phone))}${kv("ผู้ติดต่อฉุกเฉิน", esc([w.emergency_name, w.emergency_phone].filter(Boolean).join(" · ")))}${kv("ที่อยู่", esc([w.village && "หมู่ " + w.village, w.subdistrict, w.district, w.province].filter(Boolean).join(" ")))}</div></div>
      <div><div class="h" style="margin-bottom:8px">ความปลอดภัย</div><div class="kvg">${kv("อบรม Induction", w.induction_date && thDate(w.induction_date))}${kv("Induction หมดอายุ", w.induction_expiry && thDate(w.induction_expiry))}${kv("ตรวจสุขภาพ", w.medical_date && thDate(w.medical_date))}${kv("ใบแพทย์หมดอายุ", w.medical_expiry && thDate(w.medical_expiry))}</div>
        ${(w.licenses || []).length ? `<div class="chips" style="margin-top:8px">${w.licenses.map(x => `<span class="tag">${esc(x.name)}${x.no ? " " + esc(x.no) : ""}<em>${x.expiry ? "หมด " + thDate(x.expiry) : ""}</em></span>`).join("")}</div>` : ""}</div>
      ${w.nationality !== "Thai" ? `<div><div class="h" style="margin-bottom:8px">ต่างชาติ</div><div class="kvg">${kv("Passport (5 ตัวท้าย)", esc(w.passport_last5))}${kv("Work Permit", esc(w.work_permit_no))}${kv("Work Permit หมดอายุ", w.work_permit_expiry && thDate(w.work_permit_expiry))}${kv("Visa หมดอายุ", w.visa_expiry && thDate(w.visa_expiry))}</div></div>` : ""}
      ${w.status !== "active" ? `<div class="note r">${w.status === "banned" ? "ห้ามเข้าพื้นที่" : "ออกแล้ว"} · วันทำงานวันสุดท้าย ${thDate(w.left_on)}${w.left_reason ? " · " + esc(w.left_reason) : ""}</div>` : ""}
      ${w.remark ? `<div class="hint">หมายเหตุ: ${esc(w.remark)}</div>` : ""}
      <div><div class="h" style="margin-bottom:8px">ประวัติการแก้</div>${log.map(l => `<div style="font-size:12.5px;padding:6px 0;border-bottom:1px solid var(--line)"><span class="hint">${new Date(l.at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</span>
        ${l.action === "insert" ? " เพิ่มเข้าทะเบียน" : " " + Object.entries(l.changes || {}).map(([f, [a, b]]) => `${esc(LABEL[f] || f)}: ${esc(String(val(f, a)))} → <b>${esc(String(val(f, b)))}</b>`).join(" · ")}</div>`).join("") || `<div class="hint">—</div>`}</div>
    </div><div class="dw-f">${canWrite() ? `<button class="btn btn-s" id="edit">แก้ไข</button>` : ""}<button class="btn btn-g" data-x>ปิด</button></div></div>`;
  el.querySelectorAll("[data-x]").forEach(b => b.onclick = close); el.onclick = ev => { if (ev.target === el) close(); };
  el.querySelector("#edit")?.addEventListener("click", () => { close(); workerForm(w); });
}
function workerForm(w) {
  const v = w || { status: "active", nationality: "Thai", licenses: [], start_date: todayISO() };
  const f = (k, l, t = "text", ex = "") => `<label class="fld"><span>${l}</span><input class="in" data-k="${k}" type="${t}" value="${esc(v[k] ?? "")}" ${ex}></label>`;
  let lic = [...(v.licenses || [])];
  const el = modal(w ? `แก้ไข ${esc(fullName(w))}` : "เพิ่มคน", `<div class="grid2">
    <div class="sect">ตัวคน</div>
    <label class="fld"><span>บริษัท *</span><select class="in" data-k="company_id">${S.companies.map(c => `<option value="${c.id}" ${v.company_id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>${f("team", "ทีม")}
    ${f("title", "คำนำหน้า")}${f("first_name", "ชื่อ *")}${f("last_name", "สกุล")}${f("position", "ตำแหน่ง")}
    <label class="fld"><span>สัญชาติ</span><input class="in" data-k="nationality" list="nats" value="${esc(v.nationality)}"><datalist id="nats"><option value="Thai"><option value="Myanmar"><option value="Lao"><option value="Cambodian"><option value="Foreign"></datalist></label>
    <label class="fld"><span>เลขบัตรประชาชน (เก็บแค่ 5 ตัวท้าย)</span><input class="in" id="idfull" inputmode="numeric" placeholder="${v.id_last5 ? "ตอนนี้: …" + esc(v.id_last5) : "พิมพ์เลขเต็มได้"}"></label>
    ${f("birth_date", "วันเกิด", "date")}${f("phone", "เบอร์โทร")}${f("emergency_name", "ผู้ติดต่อฉุกเฉิน")}${f("emergency_phone", "เบอร์ผู้ติดต่อฉุกเฉิน")}
    ${f("village", "หมู่")}${f("subdistrict", "ตำบล")}${f("district", "อำเภอ")}${f("province", "จังหวัด")}
    <div class="sect">บัตรเข้าพื้นที่</div>${f("sub_no", "SUB No.")}${f("ac_no", "AC NO. (ระบบประตู)")}${f("card_no", "เลขหลังบัตร")}${f("area", "พื้นที่ทำงาน", "text", 'list="areas"')}<datalist id="areas">${[...new Set(S.workers.map(x => x.area).filter(Boolean))].map(a => `<option value="${esc(a)}">`).join("")}</datalist>
    ${f("start_date", "วันเริ่มเข้าพื้นที่", "date")}${f("card_issued", "วันออกบัตร", "date")}${f("card_expiry", "บัตรหมดอายุ", "date")}${f("card_returned", "วันคืนบัตร", "date")}
    <div class="sect">ความปลอดภัย</div>${f("induction_date", "วันอบรม Induction", "date")}${f("induction_expiry", "Induction หมดอายุ", "date")}${f("medical_date", "วันตรวจสุขภาพ", "date")}${f("medical_expiry", "ใบรับรองแพทย์หมดอายุ", "date")}
    <div class="fld" style="grid-column:1/-1"><span>ใบอนุญาตเฉพาะงาน (ขับรถ ปั้นจั่น ทำงานที่สูง …)</span><div id="lics"></div><button class="btn btn-g btn-sm" id="addLic" style="align-self:flex-start">${plus}เพิ่มใบอนุญาต</button></div>
    <div class="sect">ต่างชาติ (ถ้ามี)</div><label class="fld"><span>Passport (เก็บแค่ 5 ตัวท้าย)</span><input class="in" id="ppfull" placeholder="${v.passport_last5 ? "ตอนนี้: …" + esc(v.passport_last5) : ""}"></label>
    ${f("work_permit_no", "เลข Work Permit")}${f("work_permit_expiry", "Work Permit หมดอายุ", "date")}${f("visa_expiry", "Visa หมดอายุ", "date")}
    <div class="sect">สถานะ</div><label class="fld"><span>สถานะ</span><select class="in" data-k="status">${Object.entries(ST).map(([k, [l]]) => `<option value="${k}" ${v.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    ${f("left_on", "วันทำงานวันสุดท้าย (ถ้าออก/ห้ามเข้า)", "date")}${f("left_reason", "เหตุผล")}${f("remark", "หมายเหตุ")}</div>`,
    `<button class="btn btn-g" data-x>ยกเลิก</button><button class="btn btn-p" id="ok">บันทึก</button>`, true);
  el.querySelectorAll("[data-x]").forEach(x => x.onclick = () => el.remove());
  const drawLic = () => { el.querySelector("#lics").innerHTML = lic.map((x, i) => `<div class="lic" style="margin-bottom:6px"><input class="in" data-l="${i}" data-f="name" value="${esc(x.name || "")}" placeholder="ชื่อใบอนุญาต">
    <input class="in" data-l="${i}" data-f="no" value="${esc(x.no || "")}" placeholder="เลขที่"><input class="in" type="date" data-l="${i}" data-f="expiry" value="${esc(x.expiry || "")}"><button class="btn btn-g btn-sm" data-dl="${i}">✕</button></div>`).join("");
    el.querySelectorAll("[data-l]").forEach(i => i.oninput = () => { lic[+i.dataset.l][i.dataset.f] = i.value; });
    el.querySelectorAll("[data-dl]").forEach(b => b.onclick = () => { lic.splice(+b.dataset.dl, 1); drawLic(); }); };
  drawLic(); el.querySelector("#addLic").onclick = () => { lic.push({ name: "", no: "", expiry: "" }); drawLic(); };
  el.querySelector("#ok").onclick = async () => {
    const d = {}; el.querySelectorAll("[data-k]").forEach(i => { d[i.dataset.k] = i.value.trim() || null; });
    d.company_id = +d.company_id; d.status = d.status || "active"; d.nationality = d.nationality || "Thai";
    if (!d.first_name) return toast("กรอกชื่อ", "err");
    if (d.status !== "active" && !d.left_on) return toast("ออก / ห้ามเข้า ต้องใส่วันทำงานวันสุดท้าย (ใช้ในรายงานรายเดือน)", "err");
    const idd = el.querySelector("#idfull").value.replace(/\D/g, ""), pp = el.querySelector("#ppfull").value.replace(/\s/g, "");
    if (idd) { if (idd.length < 5) return toast("เลขบัตรประชาชนสั้นเกินไป", "err"); d.id_last5 = idd.slice(-5); }
    if (pp) d.passport_last5 = pp.slice(-5);
    if (d.sub_no) d.sub_no = d.sub_no.toUpperCase();
    d.licenses = lic.filter(x => x.name).map(x => ({ name: x.name.trim(), no: x.no?.trim() || null, expiry: x.expiry || null }));
    d.updated_at = new Date().toISOString();
    try { if (w) await q(supabase.from("sub_workers").update(d).eq("id", w.id)); else await q(supabase.from("sub_workers").insert(d));
      el.remove(); await loadAll(); route(); toast("บันทึกแล้ว", "ok"); } catch (e) { fail(/duplicate|unique/.test(e.message) ? "SUB No. นี้มีอยู่แล้ว" : e); }
  };
}
function exportPeople(list) {
  if (!window.XLSX) return toast("กรุณารอโหลด library", "err");
  const X = window.XLSX, wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(list.map(w => ({ "บริษัท": coOf(w.company_id)?.name || "", "ทีม": w.team || "", "SUB No.": w.sub_no || "", "AC NO.": w.ac_no || "", "เลขหลังบัตร": w.card_no || "",
    "คำนำหน้า": w.title || "", "ชื่อ": w.first_name, "สกุล": w.last_name || "", "สัญชาติ": w.nationality, "พื้นที่": w.area || "", "ตำแหน่ง": w.position || "", "สถานะ": ST[w.status]?.[0] || w.status,
    "วันเริ่ม": w.start_date || "", "วันสุดท้าย": w.left_on || "", "บัตรหมดอายุ": w.card_expiry || "", "Induction หมดอายุ": w.induction_expiry || "", "ใบแพทย์หมดอายุ": w.medical_expiry || "",
    "Work Permit หมดอายุ": w.work_permit_expiry || "", "หมู่": w.village || "", "ตำบล": w.subdistrict || "", "อำเภอ": w.district || "", "จังหวัด": w.province || "", "หมายเหตุ": w.remark || "" }))), "รายชื่อ");
  X.writeFile(wb, `ทะเบียนผู้รับเหมา_${todayISO()}.xlsx`);
}

// ---------------------------------------------------------------- บริษัท
function renderCompanies() {
  const today = todayISO();
  $("#spMain").innerHTML = head("บริษัทผู้รับเหมา", `${S.companies.length} บริษัท`, canWrite() ? `<button class="btn btn-p" id="addC">${plus}เพิ่มบริษัท</button>` : "") + `
    <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>บริษัท</th><th>งาน</th><th>ผู้ประสานงาน</th><th>สัญญา</th><th class="n">ทำงานอยู่</th><th>สถานะ</th>${canWrite() ? "<th></th>" : ""}</tr></thead><tbody>
    ${S.companies.map(c => `<tr><td><b>${esc(c.name)}</b><div class="sub">${esc(c.legal_name || "")}${c.tax_id ? " · " + esc(c.tax_id) : ""}</div></td><td>${esc(c.scope || "")}</td>
      <td>${esc(c.contact_name || "")}<div class="sub">${esc([c.contact_phone, c.contact_email].filter(Boolean).join(" · "))}</div></td>
      <td>${esc(c.contract_no || "")}<div class="sub">${c.contract_start || c.contract_end ? `${thDate(c.contract_start)} – ${thDate(c.contract_end)}` : ""}</div></td>
      <td class="n"><a class="lnk" href="#/people/${c.id}">${n0(S.workers.filter(w => w.company_id === c.id && w.status === "active" && activeAt(w, today)).length)}</a></td>
      <td>${c.is_active ? `<span class="bd g">ใช้งาน</span>` : `<span class="bd n">ปิด</span>`}</td>${canWrite() ? `<td><button class="btn btn-s btn-sm" data-ed="${c.id}">แก้ไข</button></td>` : ""}</tr>`).join("") || `<tr><td colspan="7" class="empty">ยังไม่มี — นำเข้าไฟล์แล้วบริษัทจะถูกสร้างให้เอง</td></tr>`}</tbody></table></div>`;
  $("#addC")?.addEventListener("click", () => companyForm(null));
  $("#spMain").querySelectorAll("[data-ed]").forEach(b => b.onclick = () => companyForm(coOf(+b.dataset.ed)));
}
function companyForm(c) {
  const v = c || { is_active: true }, f = (k, l, t = "text") => `<label class="fld"><span>${l}</span><input class="in" data-k="${k}" type="${t}" value="${esc(v[k] ?? "")}"></label>`;
  const el = modal(c ? `แก้ไข ${esc(c.name)}` : "เพิ่มบริษัท", `<div class="grid2">${f("name", "ชื่อย่อ (ตามโฟลเดอร์) *")}${f("legal_name", "ชื่อเต็ม")}${f("tax_id", "เลขผู้เสียภาษี")}${f("scope", "งานที่รับ")}
    ${f("contact_name", "ผู้ประสานงาน")}${f("contact_phone", "เบอร์โทร")}${f("contact_email", "อีเมล", "email")}${f("contract_no", "เลขที่สัญญา")}${f("contract_start", "สัญญาเริ่ม", "date")}${f("contract_end", "สัญญาสิ้นสุด", "date")}</div>
    ${f("remark", "หมายเหตุ")}<label class="opt"><input type="checkbox" id="act" ${v.is_active ? "checked" : ""}><div><b>ใช้งานอยู่</b></div></label>`,
    `<button class="btn btn-g" data-x>ยกเลิก</button><button class="btn btn-p" id="ok">บันทึก</button>`);
  el.querySelectorAll("[data-x]").forEach(x => x.onclick = () => el.remove());
  el.querySelector("#ok").onclick = async () => {
    const d = {}; el.querySelectorAll("[data-k]").forEach(i => { d[i.dataset.k] = i.value.trim() || null; }); d.is_active = el.querySelector("#act").checked; d.updated_at = new Date().toISOString();
    if (!d.name) return toast("กรอกชื่อ", "err");
    try { if (c) await q(supabase.from("sub_companies").update(d).eq("id", c.id)); else await q(supabase.from("sub_companies").insert(d)); el.remove(); await loadAll(); renderCompanies(); toast("บันทึกแล้ว", "ok"); }
    catch (e) { fail(/duplicate|unique/.test(e.message) ? "ชื่อนี้มีอยู่แล้ว" : e); }
  };
}

// ---------------------------------------------------------------- รายงานรายเดือน
function renderReport() {
  const ym = S.filt.ym ||= todayISO().slice(0, 7), r = monthly(S.workers, S.companies, ym);
  const noStart = S.workers.filter(w => !w.start_date).length;
  $("#spMain").innerHTML = head("รายงานจำนวนคนรายเดือน", `แยกตามบริษัท · ${thMonth(ym)}`, `<input class="in" type="month" id="ym" value="${ym}" style="width:180px"><button class="btn btn-p" id="xl">${dl}Export Excel</button>`) + `
    ${noStart ? `<div class="note" style="margin-bottom:16px">${n0(noStart)} คนไม่มีวันเริ่ม (มีชื่อก่อนนำเข้าครั้งแรก) — นับว่าอยู่ตั้งแต่ก่อนเดือนแรกที่ใช้ระบบ · เดือนก่อนนำเข้ายอดจึงยังไม่ตรงความจริง</div>` : ""}
    <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>บริษัท</th><th class="n">ต้นเดือน</th><th class="n">เข้าใหม่</th><th class="n">ออก</th><th class="n">สิ้นเดือน</th><th class="n">ไทย</th><th class="n">ต่างชาติ</th></tr></thead><tbody>
    ${r.rows.map(x => `<tr><td><b>${esc(x.name)}</b></td><td class="n">${n0(x.opening)}</td><td class="n pos">${x.joined ? "+" + x.joined : "—"}</td><td class="n neg">${x.left ? "−" + x.left : "—"}</td><td class="n"><b>${n0(x.ending)}</b></td><td class="n">${n0(x.thai)}</td><td class="n">${n0(x.foreign)}</td></tr>`).join("")
      || `<tr><td colspan="7" class="empty">ไม่มีข้อมูลเดือนนี้</td></tr>`}
    <tr><td><b>รวม</b></td><td class="n"><b>${n0(r.total.opening)}</b></td><td class="n"><b>${n0(r.total.joined)}</b></td><td class="n"><b>${n0(r.total.left)}</b></td><td class="n"><b>${n0(r.total.ending)}</b></td><td class="n"><b>${n0(r.total.thai)}</b></td><td class="n"><b>${n0(r.total.foreign)}</b></td></tr></tbody></table></div>
    <p class="hint" style="margin-top:8px">ต้นเดือน + เข้าใหม่ − ออก = สิ้นเดือน · เข้าใหม่ = วันเริ่มเข้าพื้นที่อยู่ในเดือนนี้ · ออก = วันทำงานวันสุดท้ายอยู่ในเดือนนี้</p>`;
  $("#ym").onchange = e => { if (e.target.value) { S.filt.ym = e.target.value; renderReport(); } };
  $("#xl").onclick = () => {
    if (!window.XLSX) return toast("กรุณารอโหลด library", "err");
    const X = window.XLSX, wb = X.utils.book_new(), end = lastDay(ym), name = w => coOf(w.company_id)?.name || "";
    const sum = r.rows.map(x => ({ "บริษัท": x.name, "ต้นเดือน": x.opening, "เข้าใหม่": x.joined, "ออก": x.left, "สิ้นเดือน": x.ending, "ไทย": x.thai, "ต่างชาติ": x.foreign }));
    sum.push({ "บริษัท": "รวม", "ต้นเดือน": r.total.opening, "เข้าใหม่": r.total.joined, "ออก": r.total.left, "สิ้นเดือน": r.total.ending, "ไทย": r.total.thai, "ต่างชาติ": r.total.foreign });
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(sum), "สรุป");
    const ppl = ws => ws.map(w => ({ "บริษัท": name(w), "SUB No.": w.sub_no || "", "ชื่อ-สกุล": fullName(w), "สัญชาติ": w.nationality, "พื้นที่": w.area || "", "วันเริ่ม": w.start_date || "", "วันสุดท้าย": w.left_on || "" }));
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(ppl(S.workers.filter(w => activeAt(w, end)))), "สิ้นเดือน");
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(ppl(S.workers.filter(w => w.start_date?.startsWith(ym)))), "เข้าใหม่");
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(ppl(S.workers.filter(w => w.left_on?.startsWith(ym)))), "ออก");
    X.writeFile(wb, `รายงานผู้รับเหมา_${ym}.xlsx`);
  };
}

// ---------------------------------------------------------------- นำเข้าไฟล์
// เลือกโฟลเดอร์ SUB ทั้งโฟลเดอร์ → ใช้ไฟล์ล่าสุดของแต่ละโฟลเดอร์บริษัท → เทียบกับทะเบียน → HR ดูแล้วกดยืนยัน
function renderImport() {
  if (!canWrite()) { $("#spMain").innerHTML = `<div class="empty">ต้องมีสิทธิ์แก้ทะเบียนผู้รับเหมา</div>`; return; }
  $("#spMain").innerHTML = head("นำเข้าไฟล์ข้อมูลบัตรผู้รับเหมา", "เลือกโฟลเดอร์ SUB ทั้งโฟลเดอร์ — ระบบใช้ไฟล์ที่แก้ล่าสุดของแต่ละบริษัท แล้วให้ดูก่อนบันทึก") + `
    <div class="card card-b"><div class="docs"><label class="btn btn-p" style="cursor:pointer">${dl}เลือกโฟลเดอร์ SUB<input type="file" id="dir" webkitdirectory multiple hidden></label>
      <label class="btn btn-s" style="cursor:pointer">เลือกไฟล์ทีละบริษัท<input type="file" id="files" accept=".xlsx,.xls" multiple hidden></label>
      <span class="hint">เลือกไฟล์ทีละบริษัท: ใช้ชื่อบริษัทจากชื่อไฟล์ ("ข้อมูลบัตรผู้รับเหมา - ชื่อบริษัท")</span></div></div><div id="prev"></div>`;
  const go = async (list, byDir) => {
    if (!window.XLSX) return toast("กรุณารอโหลด library", "err");
    const files = [...list].map(f => ({ f, path: f.webkitRelativePath || f.name, lastModified: f.lastModified }));
    const picks = byDir ? pickLatest(files) : files.filter(x => /\.xlsx?$/i.test(x.path) && !x.path.startsWith("~$"))
      .map(x => ({ folder: x.path.replace(/\.xlsx?$/i, "").replace(/^(copy of\s*)?ข้อมูลบัตรผู้รับเหมา\s*-\s*/i, "").replace(/_(sep|update|\w{3})\d*$/i, "").replace(/\s*\(\d+\)$/, "").trim(), file: x }));
    const folders = [...new Set([...S.companies.map(c => c.name), ...picks.map(p => p.folder)])];
    const parsed = [];
    for (const p of picks) {
      const wb = window.XLSX.read(new Uint8Array(await p.file.f.arrayBuffer()), { type: "array", cellDates: false });
      // ชีตแรกที่อ่านได้ (Winai มี "อัพเดท" กับ "เก่า" — ชีตอัพเดทอยู่ก่อน)
      let res = { rows: [], error: "ไม่มีชีต" };
      for (const sh of wb.SheetNames) { res = parseSheet(window.XLSX.utils.sheet_to_json(wb.Sheets[sh], { header: 1, raw: false, defval: "" }), p.folder, folders); if (!res.error) break; }
      parsed.push({ ...p, ...res, date: new Date(p.file.lastModified).toISOString().slice(0, 10) });
    }
    preview(parsed);
  };
  $("#dir").onchange = e => go(e.target.files, true);
  $("#files").onchange = e => go(e.target.files, false);
}
function preview(parsed) {
  const names = new Map(S.companies.map(c => [c.name.toLowerCase(), c]));
  const tmpIds = new Map(); let neg = -1;
  const idOf = n => names.get(n.toLowerCase())?.id ?? (tmpIds.get(n.toLowerCase()) ?? (tmpIds.set(n.toLowerCase(), neg--), tmpIds.get(n.toLowerCase())));
  const rows = parsed.flatMap(p => p.rows.map(r => ({ ...r, _date: p.date, _file: p.file.path })));
  const d = diffImport(S.workers, rows, idOf);
  const newCos = [...new Set(rows.map(r => r.company))].filter(n => !names.has(n.toLowerCase()));
  const byCo = n => ({ add: d.add.filter(r => r.company === n).length, upd: d.update.filter(u => u.row.company === n).length, left: d.add.filter(r => r.company === n && r.status === "left").length + d.update.filter(u => u.row.company === n && u.changes.status === "left").length,
    miss: d.missing.filter(w => w.company_id === names.get(n.toLowerCase())?.id).length, same: d.same.filter(u => u.row.company === n).length });
  const cos = [...new Set(rows.map(r => r.company))].sort();
  const moved = rows.filter(r => r.movedFrom), noSub = rows.filter(r => !r.sub_no);
  $("#prev").innerHTML = `<div class="card card-b" style="margin-top:16px"><div class="card-h"><div class="t"><b>ตรวจก่อนบันทึก</b><span>${parsed.length} ไฟล์ · ${n0(rows.length)} แถว</span></div></div>
    ${parsed.filter(p => p.error).map(p => `<div class="ck block"><div class="t"><b>${esc(p.folder)}</b><span>${esc(p.file.path)}: ${esc(p.error)}</span></div></div>`).join("")}
    <div>${parsed.filter(p => !p.error).map(p => { const s = byCo(p.folder); return `<div class="imp"><b>${esc(p.folder)}${newCos.includes(p.folder) ? ' <span class="bd b">บริษัทใหม่</span>' : ""}</b>
      <div class="n"><span class="tag">${esc(p.file.path.split("/").pop())}<em>${thDate(p.date)}</em></span>${s.add ? `<span class="dl new">เพิ่ม ${s.add}</span>` : ""}${s.upd ? `<span class="dl up">แก้ ${s.upd}</span>` : ""}${s.left ? `<span class="dl eq">ออก ${s.left}</span>` : ""}${s.miss ? `<span class="dl up" style="background:var(--red-50);color:var(--red)">ไม่อยู่ในไฟล์ ${s.miss}</span>` : ""}${s.same ? `<span class="dl eq">เหมือนเดิม ${s.same}</span>` : ""}</div></div>`; }).join("")}</div>
    ${d.dupInFile.length ? `<div class="ck warn" style="margin-top:12px"><div class="t"><b>SUB No. ซ้ำในไฟล์ ${d.dupInFile.length} แถว — ข้ามแถวหลัง</b><span>${d.dupInFile.map(r => `${esc(r.sub_no)} (${esc(r.company)})`).join(" · ")}</span></div></div>` : ""}
    ${noSub.length ? `<div class="ck info" style="margin-top:12px"><div class="t"><b>ไม่มี SUB No. ${noSub.length} คน</b><span>นำเข้าได้ ใส่เลขทีหลังที่หน้ารายชื่อ</span></div></div>` : ""}
    ${moved.length ? `<div class="ck info" style="margin-top:12px"><div class="t"><b>ช่อง Company เป็นบริษัทอื่น ${moved.length} คน — ลงทะเบียนตามช่อง Company</b><span>${moved.map(r => `${esc(r.sub_no || r.first_name)}: อยู่ในโฟลเดอร์ ${esc(r.movedFrom)} → ${esc(r.company)}`).join(" · ")}</span></div></div>` : ""}
    ${d.missing.length ? `<label class="opt" style="margin-top:12px"><input type="checkbox" id="markLeft"><div><b>คนที่อยู่ในทะเบียนแต่ไม่อยู่ในไฟล์ล่าสุด ${d.missing.length} คน — ตั้งเป็น “ออกแล้ว”</b>
      <div class="hint">วันทำงานวันสุดท้าย <input type="date" id="leftDay" class="in" style="width:160px;display:inline-block" value="${todayISO()}"> · ไม่ติ๊ก = คงสถานะเดิม</div></div></label>` : ""}
    <div class="hint" style="margin-top:12px">คนที่หมายเหตุว่า “ออก” แต่ไม่มีวันที่ จะใช้วันที่ของไฟล์เป็นวันทำงานวันสุดท้ายโดยประมาณ (แก้ได้ทีหลัง) · คนใหม่ไม่ใส่วันเริ่ม (ไม่รู้วันจริง) ยกเว้นติ๊กด้านล่าง</div>
    <label class="opt" style="margin-top:8px"><input type="checkbox" id="setStart" ${S.workers.length ? "checked" : ""}><div><b>ใส่วันเริ่ม = วันที่ของไฟล์ ให้คนที่เพิ่มใหม่</b><div class="hint">ติ๊กเมื่อเป็นการอัปเดตรายเดือน (คนใหม่ = เพิ่งเข้า) · นำเข้าครั้งแรกไม่ต้องติ๊ก</div></div></label>
    <div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn btn-p" id="apply">บันทึก ${d.add.length + d.update.length} รายการ</button></div></div>`;
  $("#apply").onclick = async () => {
    const btn = $("#apply"); btn.disabled = true; btn.textContent = "กำลังบันทึก…";
    try {
      for (const n of newCos) { await q(supabase.from("sub_companies").insert({ name: n, legal_name: rows.find(r => r.company === n && r.legal_name)?.legal_name || null })); }
      await loadAll(); const real = new Map(S.companies.map(c => [c.name.toLowerCase(), c.id]));
      const setStart = $("#setStart").checked;
      const pick = r => ({ company_id: real.get(r.company.toLowerCase()), sub_no: r.sub_no, ac_no: r.ac_no, card_no: r.card_no, title: r.title, first_name: r.first_name, last_name: r.last_name, team: r.team, area: r.area,
        village: r.village, subdistrict: r.subdistrict, district: r.district, province: r.province, nationality: r.nationality, remark: r.remark, source_file: r._file });
      const ins = d.add.map(r => ({ ...pick(r), status: r.status, left_on: r.status === "left" ? r._date : null, left_reason: r.status === "left" ? "จากหมายเหตุในไฟล์ (วันที่โดยประมาณ)" : null, start_date: setStart && r.status === "active" ? r._date : null }));
      for (let i = 0; i < ins.length; i += 500) await q(supabase.from("sub_workers").insert(ins.slice(i, i + 500)));
      for (const u of d.update) {
        const ch = { ...u.changes, source_file: u.row._file, updated_at: new Date().toISOString() };
        if (ch.company_id && ch.company_id < 0) ch.company_id = real.get(u.row.company.toLowerCase());
        if (ch.status === "left") { ch.left_on = u.row._date; ch.left_reason = "จากหมายเหตุในไฟล์ (วันที่โดยประมาณ)"; }
        await q(supabase.from("sub_workers").update(ch).eq("id", u.id));
      }
      if ($("#markLeft")?.checked) { const day = $("#leftDay").value || todayISO();
        for (const w of d.missing) await q(supabase.from("sub_workers").update({ status: "left", left_on: day, left_reason: "ไม่อยู่ในไฟล์ล่าสุด", updated_at: new Date().toISOString() }).eq("id", w.id)); }
      await loadAll(); toast(`บันทึกแล้ว · เพิ่ม ${ins.length} · แก้ ${d.update.length}`, "ok"); location.hash = "#/overview";
    } catch (e) { fail(e); btn.disabled = false; btn.textContent = "ลองบันทึกอีกครั้ง"; }
  };
}

boot();
