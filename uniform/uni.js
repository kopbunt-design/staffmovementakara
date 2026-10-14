// ============================================================================
// Uniform Stock — แอปหลัก (เว็บ /uniform)
//   ใช้ Supabase + session เดียวกับระบบ HR (โดเมนเดียวกัน) · สิทธิ์ page.uniform / data.uniform.write
//   หน้า: #/overview · #/people · #/history · #/items  · รับเข้า/จ่ายออก/รับคืน/ปรับยอด = แผงด้านขวา
//   ⚠️ ยอดคงเหลืออ่านจาก view uniform_balance เสมอ (= ผลรวมรายการเคลื่อนไหว) ห้ามเก็บยอดเป็นคอลัมน์
//      DB มี trigger กันจ่ายเกินของที่มีอีกชั้น (sql/schema_uniform.sql)
//   ห้าม import js/app.js — จะบูตระบบ HR ทั้งระบบขึ้นมาในหน้านี้
// ============================================================================
import { supabase } from "../js/supabase-config.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const n0 = v => Number(v || 0).toLocaleString("en-US");
const TH_M = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const thDate = iso => { if (!iso) return "-"; const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return `${d} ${TH_M[m - 1]} ${String(y + 543).slice(2)}`; };
const todayISO = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const ymOf = iso => String(iso || "").slice(0, 7);
const $ = s => document.querySelector(s);
const ICON = {
  issue: '<path d="m18 9-6-6-6 6"/><path d="M12 3v14"/><path d="M5 21h14"/>',
  receive: '<path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/>',
  return: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  adjust: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
  shirt: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', minus: '<path d="M5 12h14"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  download: '<path d="M12 15V3"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
};
const ic = k => `<svg viewBox="0 0 24 24">${ICON[k]}</svg>`;
// ชนิดรายการ — need = ต้องระบุพนักงาน · ทิศทางเลขบังคับที่ DB (CHECK uniform_move_dir) ด้วย
const KIND = {
  issue:   { label: "จ่ายออก", verb: "จ่ายออก", need: true },
  receive: { label: "รับเข้า", verb: "รับเข้า", need: false },
  return:  { label: "รับคืน",  verb: "รับคืน",  need: true },
  adjust:  { label: "ปรับยอด", verb: "ปรับยอด", need: false },
};

const S = { user: null, perms: new Set(), bal: [], moves: [], emps: [], filt: {} };
const can = k => S.perms.has(k);
const canWrite = () => can("data.uniform.write");
const empName = e => [e.firstname_th, e.lastname_th].filter(Boolean).join(" ") || [e.firstname_en, e.lastname_en].filter(Boolean).join(" ");
const empOf = code => S.emps.find(e => e.emp_code === code);
const itemOf = id => S.bal.find(b => b.id === id);
const itemName = it => it ? `${it.item_type} ${it.size}` : "— ลบไปแล้ว —";
const isLow = b => b.min_qty > 0 && b.qty > 0 && b.qty < b.min_qty;
const isOut = b => b.qty <= 0;
const types = (all = false) => [...new Set(S.bal.filter(b => all || b.is_active).map(b => b.item_type))];

function toast(msg, type = "") {
  const el = document.createElement("div"); el.className = "toast " + type; el.textContent = msg;
  $("#spToasts").appendChild(el); setTimeout(() => el.remove(), 4500);
}
function modal(title, body, foot) {
  const el = document.createElement("div"); el.className = "mo";
  el.innerHTML = `<div class="mo-c"><div class="mo-h">${title}<button class="btn btn-g btn-sm" data-x>✕</button></div>
    <div class="mo-b">${body}</div><div class="mo-f">${foot}</div></div>`;
  $("#spModal").appendChild(el);
  el.querySelectorAll("[data-x]").forEach(b => b.onclick = () => el.remove());
  el.onclick = e => { if (e.target === el) el.remove(); };
  return el;
}

// ---------------------------------------------------------------- เริ่มต้น
async function boot() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    $("#spMain").innerHTML = `<div class="card card-b" style="max-width:460px;margin:60px auto;text-align:center">
      <div class="card-t" style="justify-content:center">กรุณาเข้าสู่ระบบ</div>
      <p class="sp-sub" style="margin-bottom:16px">สต๊อกยูนิฟอร์มใช้บัญชีเดียวกับระบบ HR — เข้าสู่ระบบ HR ก่อน แล้วกดเมนูสต๊อกยูนิฟอร์ม</p>
      <a class="btn btn-p" href="/">ไปหน้าเข้าสู่ระบบ HR</a></div>`;
    return;
  }
  S.user = session.user;
  const { data: perms } = await supabase.rpc("my_permissions");
  S.perms = new Set((perms || []).map(p => typeof p === "string" ? p : p.perm_key || p.key));
  const name = S.user.user_metadata?.full_name || S.user.email || "";
  $("#spUser").innerHTML = `<div class="sp-av">${esc(name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase())}</div>
    <div><b>${esc(name)}</b><span>${canWrite() ? "จัดการสต๊อก" : "ดูอย่างเดียว"}</span></div>`;
  if (!can("page.uniform")) {
    $("#spMain").innerHTML = `<div class="empty">บัญชีนี้ยังไม่มีสิทธิ์ใช้สต๊อกยูนิฟอร์ม — ให้ Admin เพิ่มสิทธิ์ “สต๊อกยูนิฟอร์ม” ที่ User Management</div>`;
    return;
  }
  try { await loadAll(); }
  catch (e) {
    $("#spMain").innerHTML = `<div class="card card-b"><b>โหลดข้อมูลไม่สำเร็จ</b><p class="sp-sub">${esc(e.message)}</p>
      <p class="hint" style="margin-top:8px">ถ้ายังไม่ได้รัน <code>sql/schema_uniform.sql</code> ใน Supabase ให้รันก่อน</p></div>`;
    return;
  }
  window.addEventListener("hashchange", route);
  route();
}

async function fetchAll(q) {   // Supabase คืนครั้งละไม่เกิน 1,000 แถว → ไล่ดึงทีละหน้า
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999);
    if (error) throw error;
    out.push(...data); if (data.length < 1000) break;
  }
  return out;
}
async function loadAll() {
  const [bal, moves, emps] = await Promise.all([
    // เรียงตาม sort_order — เรียงตามชื่อไซส์ไม่ได้ "10XL" จะมาก่อน "2XL"
    supabase.from("uniform_balance").select("*").order("item_type").order("sort_order"),
    fetchAll(() => supabase.from("uniform_move").select("*").order("moved_on", { ascending: false }).order("id", { ascending: false })),
    // ทะเบียนพนักงาน — ไว้ค้นหาตอนจ่าย/รับคืน · ถ้าไม่มีสิทธิ์ดูพนักงาน ใช้ชื่อที่เก็บไว้ในรายการแทน
    fetchAll(() => supabase.from("employees").select("emp_code,firstname_th,lastname_th,firstname_en,lastname_en,department,section,position,job_level,join_date,end_date,status").order("emp_code")).catch(() => []),
  ]);
  if (bal.error) throw bal.error;
  S.bal = bal.data || []; S.moves = moves; S.emps = emps || [];
  const n = S.bal.filter(b => b.is_active && (isLow(b) || isOut(b))).length;
  $("#navLow").textContent = n ? String(n) : "";
}

function route() {
  const [r, arg] = location.hash.replace(/^#\/?/, "").split("/");
  const page = r || "overview";
  document.querySelectorAll("#spNav a").forEach(a => a.classList.toggle("on", a.dataset.r === page));
  window.scrollTo(0, 0);
  ({ overview: renderOverview, people: renderPeople, history: () => renderHistory(arg), items: renderItems }[page] || renderOverview)();
}
const head = (title, sub, actions = "") => `<div class="sp-head"><div class="t"><div class="sp-title">${title}</div><div class="sp-sub">${sub}</div></div>${actions}</div>`;
const moveBtns = () => canWrite() ? `<button class="btn btn-s" data-mv="receive">${ic("receive")}รับเข้า</button>
  <button class="btn btn-p" data-mv="issue">${ic("issue")}จ่ายออก</button>` : "";
function wireMoveBtns(root) { root.querySelectorAll("[data-mv]").forEach(b => b.onclick = () => openMove(b.dataset.mv, b.dataset.item ? { item: +b.dataset.item } : {})); }

// ---------------------------------------------------------------- ภาพรวม
function renderOverview() {
  const ym = ymOf(todayISO()), act = S.bal.filter(b => b.is_active);
  const thisMonth = S.moves.filter(m => ymOf(m.moved_on) === ym);
  const iss = thisMonth.filter(m => m.move_type === "issue"), rec = thisMonth.filter(m => m.move_type === "receive");
  const low = act.filter(b => isLow(b) || isOut(b));
  const issuedBy = {}; for (const m of iss) issuedBy[m.item_id] = (issuedBy[m.item_id] || 0) - m.qty;
  const last = S.moves[0];
  const f = S.filt.ov || "all";
  const tStats = `<div class="stats">
    <div class="stat"><div class="l">คงเหลือทั้งหมด</div><div class="v">${n0(act.reduce((s, b) => s + b.qty, 0))}</div><div class="m">ชิ้น · ${types().length} ประเภท ${act.length} ไซส์</div></div>
    <div class="stat${low.length ? " hl" : ""}" ${low.length ? 'data-f="low"' : ""}><div class="l">ใกล้หมด / หมด</div><div class="v">${low.length} ไซส์</div>
      <div class="m">${low.length ? esc(low.slice(0, 5).map(b => `${b.item_type} ${b.size}`).join(" · ")) + (low.length > 5 ? " …" : "") + " — ควรสั่งเพิ่ม" : "ทุกไซส์ยังพอ"}</div></div>
    <div class="stat"><div class="l">จ่ายออกเดือนนี้</div><div class="v">${n0(iss.reduce((s, m) => s - m.qty, 0))}</div><div class="m">ชิ้น · ให้ ${new Set(iss.map(m => m.emp_code)).size} คน</div></div>
    <div class="stat"><div class="l">รับเข้าเดือนนี้</div><div class="v">${n0(rec.reduce((s, m) => s + m.qty, 0))}</div><div class="m">ชิ้น · ${rec.length ? `${new Set(rec.map(m => m.moved_on)).size} ครั้ง (ล่าสุด ${thDate(rec[0].moved_on)})` : "ยังไม่มี"}</div></div>
  </div>`;
  const byType = {}; for (const b of S.bal) (byType[b.item_type] ||= []).push(b);
  const typeCards = Object.entries(byType).map(([type, list]) => {
    const shown = list.filter(b => b.is_active || b.qty).filter(b => f === "all" || (f === "low" ? isLow(b) : isOut(b)));
    const top = Math.max(1, ...list.map(b => Math.max(b.qty, b.min_qty * 2)));
    return `<div class="card card-b">
      <div class="card-h"><div class="t"><b>${esc(type)} · คงเหลือตามไซส์</b><span>รวม ${n0(list.reduce((s, b) => s + b.qty, 0))} ชิ้น · แถบสี = ยอดเทียบขั้นต่ำ · กดที่ไซส์เพื่อดูประวัติ</span></div></div>
      <div class="tiles">${shown.map(b => {
        const cls = !b.is_active ? "off" : isOut(b) ? "out" : isLow(b) ? "low" : "";
        const pill = !b.is_active ? `<span class="pill n">ปิด</span>` : isOut(b) ? `<span class="pill r">หมด</span>` : isLow(b) ? `<span class="pill w">ใกล้หมด</span>` : "";
        return `<button class="tile ${cls}" data-item="${b.id}" title="ขั้นต่ำ ${b.min_qty || "—"} · จ่ายไปแล้วทั้งหมด ${n0(b.issued_total)}">
          <div class="top"><span class="sz">${esc(b.size)}</span>${pill}</div>
          <div class="q">${n0(b.qty)}<small>ชิ้น</small></div>
          <div class="trk"><i style="width:${Math.max(b.qty > 0 ? 3 : 0, Math.min(100, Math.round(b.qty / top * 100)))}%"></i></div>
          <div class="m">เดือนนี้จ่าย ${n0(issuedBy[b.id] || 0)}</div></button>`;
      }).join("") || `<div class="hint">ไม่มีไซส์ที่${f === "low" ? "ใกล้หมด" : "หมด"}</div>`}</div></div>`;
  }).join("") || `<div class="card empty">ยังไม่มีรายการของ — ไปที่ “รายการของ” เพื่อเพิ่ม</div>`;
  const feed = S.moves.slice(0, 8).map(feedItem).join("") || `<div class="hint">ยังไม่มีการเคลื่อนไหว</div>`;
  $("#spMain").innerHTML = head("สต๊อกยูนิฟอร์ม", last ? `เคลื่อนไหวล่าสุด ${thDate(last.moved_on)} · ${types().length} ประเภท ${S.bal.filter(b => b.is_active).length} ไซส์` : "ยังไม่มีการเคลื่อนไหว",
    `<button class="btn btn-s" id="xl">${ic("download")}Export Excel</button>${moveBtns()}`) + tStats + `
    <div class="ov"><div class="ov-l">
      <div class="seg" style="align-self:flex-start">${[["all", "ทั้งหมด"], ["low", "ใกล้หมด"], ["out", "หมด"]].map(([k, l]) => `<button data-f2="${k}" class="${f === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${typeCards}</div>
      <div class="card card-b"><div class="card-h"><div class="t"><b>ความเคลื่อนไหวล่าสุด</b></div><a class="lnk" href="#/history">ดูทั้งหมด →</a></div>
        <div class="feed">${feed}</div></div></div>`;
  const m = $("#spMain");
  m.querySelectorAll("[data-f2]").forEach(b => b.onclick = () => { S.filt.ov = b.dataset.f2; renderOverview(); });
  m.querySelector('[data-f="low"]')?.addEventListener("click", () => { S.filt.ov = "low"; renderOverview(); });
  m.querySelectorAll(".tile").forEach(t => t.onclick = () => { location.hash = `#/history/${t.dataset.item}`; });
  m.querySelector("#xl").onclick = exportXlsx;
  wireMoveBtns(m);
}
function feedItem(m) {
  const it = itemOf(m.item_id), k = KIND[m.move_type] || { label: m.move_type };
  const qty = m.move_type === "adjust" ? (m.qty > 0 ? "+" : "−") + Math.abs(m.qty) : "× " + Math.abs(m.qty);
  const who = m.emp_code ? `${m.emp_name || empOf(m.emp_code) && empName(empOf(m.emp_code)) || m.emp_code}${empOf(m.emp_code)?.department ? " · " + empOf(m.emp_code).department : ""}` : (m.note || "");
  const time = m.created_at ? new Date(m.created_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "";
  return `<div class="fi"><div class="ico ${esc(m.move_type)}">${ic(m.move_type in ICON ? m.move_type : "adjust")}</div>
    <div><b>${esc(k.label)} · ${esc(itemName(it))} ${qty}</b>${who ? `<span>${esc(who)}</span>` : ""}<small>${thDate(m.moved_on)}${time && m.moved_on === todayISO() ? " · " + time : ""}</small></div></div>`;
}

// ---------------------------------------------------------------- แผงรับเข้า / จ่ายออก / รับคืน / ปรับยอด
function openMove(kind, pre = {}) {
  if (!canWrite()) return;
  const it0 = pre.item ? itemOf(pre.item) : null;
  const st = { kind, type: it0?.item_type || types()[0] || "", item: it0?.id || null, qty: 1, emp: pre.emp || "", date: todayISO(), note: "" };
  const el = document.createElement("div"); el.className = "dw";
  el.innerHTML = `<div class="dw-c"><div class="dw-h"><div class="t"><b id="dwT"></b><span id="dwS"></span></div><button class="btn btn-g btn-sm" data-x>${ic("x")}</button></div>
    <div class="dw-b" id="dwB"></div>
    <div class="dw-f"><button class="btn btn-g" data-x>ยกเลิก</button><button class="btn btn-p" id="dwSave">${ic("check")}<span></span></button></div></div>`;
  $("#spModal").appendChild(el);
  const close = () => { el.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  el.querySelectorAll("[data-x]").forEach(b => b.onclick = close);
  el.onclick = e => { if (e.target === el) close(); };

  const draw = () => {
    const k = KIND[st.kind], sizes = S.bal.filter(b => b.is_active && b.item_type === st.type), it = itemOf(st.item);
    if (it && it.item_type !== st.type) st.item = null;
    el.querySelector("#dwT").textContent = `${k.label}ยูนิฟอร์ม`;
    el.querySelector("#dwS").textContent = st.kind === "adjust" ? "นับสต๊อกแล้วไม่ตรง ใส่ส่วนต่าง (บวกหรือลบ)" : st.kind === "issue" ? "บันทึกแล้วยอดคงเหลือตัดทันที · จ่ายเกินของที่มีไม่ได้" : st.kind === "return" ? "พนักงานคืนของ ยอดคงเหลือเพิ่มกลับ" : "ของเข้าคลัง ยอดคงเหลือเพิ่ม";
    el.querySelector("#dwSave span").textContent = `บันทึก${k.verb}`;
    const e = empOf(st.emp);
    const hist = st.emp ? S.moves.filter(m => m.emp_code === st.emp && (m.move_type === "issue" || m.move_type === "return")) : [];
    const cur = itemOf(st.item), delta = st.kind === "issue" ? -Math.abs(st.qty) : st.kind === "adjust" ? st.qty : Math.abs(st.qty);
    el.querySelector("#dwB").innerHTML = `
      <div class="kinds">${Object.entries(KIND).map(([kk, v]) => `<button data-k="${kk}" class="${kk === st.kind ? "on" : ""}">${v.label}</button>`).join("")}</div>
      ${k.need ? `<div class="fld"><span>พนักงาน</span><div class="pick"><input class="in" id="dwEmp" autocomplete="off" placeholder="พิมพ์รหัสหรือชื่อ เช่น AKR2605 หรือ ชัยพร"
          value="${esc(st.emp ? `${st.emp} · ${e ? empName(e) : hist[0]?.emp_name || ""}` : "")}"><div class="pick-list" id="dwPick" hidden></div></div></div>
        ${st.emp ? `<div class="emp"><div class="who"><div class="sp-av">${esc((e ? empName(e) : st.emp).split(/\s+/).map(w => w[0]).join("").slice(0, 2))}</div>
          <div><b>${esc(e ? empName(e) : hist[0]?.emp_name || st.emp)}</b><span>${esc(e ? [e.job_level, e.department, e.join_date ? "เริ่มงาน " + thDate(e.join_date) : ""].filter(Boolean).join(" · ") : st.emp)}</span></div></div>
          <div><div class="h">เคยเบิกไปแล้ว</div>${hist.length ? hist.slice(0, 4).map(m => `<div class="hr">${ic("shirt")}${esc(itemName(itemOf(m.item_id)))} ${m.move_type === "return" ? "คืน" : "×"} ${Math.abs(m.qty)} · ${thDate(m.moved_on)}${m.note ? ` (${esc(m.note)})` : ""}</div>`).join("") + (hist.length > 4 ? `<div class="hint">… อีก ${hist.length - 4} รายการ</div>` : "") : `<div class="hint">ยังไม่เคยเบิก</div>`}</div></div>` : ""}` : ""}
      <label class="fld"><span>ประเภท</span><select class="in" id="dwType">${types().map(t => `<option ${t === st.type ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
      <div><div class="lbl">ไซส์<small>ตัวเลขเล็ก = คงเหลือ</small></div>
        <div class="sizes">${sizes.map(b => `<button class="sc${b.id === st.item ? " on" : ""}${isLow(b) || isOut(b) ? " lo" : ""}" data-s="${b.id}" ${st.kind === "issue" && b.qty <= 0 ? "disabled" : ""}><b>${esc(b.size)}</b><small>${n0(b.qty)}</small></button>`).join("") || `<div class="hint">ประเภทนี้ยังไม่มีไซส์</div>`}</div></div>
      <div class="qd"><div><div class="lbl">จำนวน</div><div class="stp"><button data-q="-1">${ic("minus")}</button><input id="dwQty" type="number" step="1" value="${st.qty}"><button data-q="1">${ic("plus")}</button></div></div>
        <label class="fld"><span>วันที่</span><input class="in" type="date" id="dwDate" value="${st.date}"></label></div>
      <label class="fld"><span>หมายเหตุ ${st.kind === "adjust" ? "" : "(ไม่บังคับ)"}</span><input class="in" id="dwNote" value="${esc(st.note)}" placeholder="${st.kind === "adjust" ? "เช่น นับสต๊อกประจำเดือน พบขาด 2 ตัว" : st.kind === "receive" ? "เช่น PO 2026-118" : "เช่น พนักงานใหม่ ชุดที่ 2"}"></label>
      ${cur ? `<div class="after${cur.qty + delta < 0 ? " bad" : ""}"><span>${esc(itemName(cur))} หลัง${k.verb}</span><b>${n0(cur.qty)} → ${n0(cur.qty + delta)} ชิ้น</b></div>` : ""}`;
    const b = el.querySelector("#dwB");
    b.querySelectorAll("[data-k]").forEach(x => x.onclick = () => { st.kind = x.dataset.k; if (!KIND[st.kind].need) st.emp = ""; if (st.kind !== "adjust") st.qty = Math.abs(st.qty) || 1; draw(); });
    b.querySelector("#dwType").onchange = ev => { st.type = ev.target.value; st.item = null; draw(); };
    b.querySelectorAll("[data-s]").forEach(x => x.onclick = () => { st.item = +x.dataset.s; draw(); });
    b.querySelectorAll("[data-q]").forEach(x => x.onclick = () => { st.qty = (Number(st.qty) || 0) + Number(x.dataset.q); if (st.kind !== "adjust" && st.qty < 1) st.qty = 1; if (st.kind === "adjust" && st.qty === 0) st.qty += Number(x.dataset.q); draw(); });
    b.querySelector("#dwQty").onchange = ev => { st.qty = Math.trunc(Number(ev.target.value)) || (st.kind === "adjust" ? 0 : 1); draw(); };
    b.querySelector("#dwDate").onchange = ev => { st.date = ev.target.value; };
    b.querySelector("#dwNote").oninput = ev => { st.note = ev.target.value; };
    const inp = b.querySelector("#dwEmp");
    if (inp) wirePicker(inp, b.querySelector("#dwPick"), code => { st.emp = code; draw(); });
  };
  draw();

  el.querySelector("#dwSave").onclick = async () => {
    const k = KIND[st.kind], it = itemOf(st.item), raw = Math.trunc(Number(st.qty));
    if (!it) return toast("กรุณาเลือกไซส์", "err");
    if (!raw) return toast("จำนวนต้องไม่เป็น 0", "err");
    if (st.kind !== "adjust" && raw < 0) return toast("จำนวนต้องมากกว่า 0", "err");
    if (k.need && !st.emp) return toast("กรุณาเลือกพนักงานจากรายการที่ค้นหา", "err");
    if (st.kind === "adjust" && !st.note.trim()) return toast("ปรับยอดต้องใส่หมายเหตุว่าเพราะอะไร", "err");
    const qty = st.kind === "issue" ? -Math.abs(raw) : st.kind === "adjust" ? raw : Math.abs(raw);
    // เตือนก่อนถ้าจ่ายเกิน — DB มี trigger กันอีกชั้น แต่ข้อความนี้อ่านรู้เรื่องกว่า
    if (it.qty + qty < 0) return toast(`ไม่ได้ — ${itemName(it)} เหลือ ${it.qty} ชิ้น ยอดจะติดลบ`, "err");
    const e = empOf(st.emp), btn = el.querySelector("#dwSave"); btn.disabled = true;
    const { error } = await supabase.from("uniform_move").insert({
      item_id: it.id, move_type: st.kind, qty, moved_on: st.date || todayISO(),
      emp_code: k.need ? st.emp : null, emp_name: k.need ? (e ? empName(e) : null) : null,
      note: st.note.trim() || null, created_by: S.user.id,
    });
    btn.disabled = false;
    if (error) return toast(error.message.includes("ติดลบ") ? error.message.split("ERROR:").pop().trim() : "บันทึกไม่สำเร็จ: " + error.message, "err");
    close(); await loadAll(); route();
    toast(`${k.verb} ${itemName(it)} ${Math.abs(qty)} ชิ้น เรียบร้อย`, "ok");
  };
}
// ค้นหาพนักงาน: รหัส ชื่อไทย/อังกฤษ แผนก · คนที่ออกแล้วอยู่ท้ายรายการ (รับคืนจากคนลาออกได้)
function wirePicker(inp, list, onPick) {
  let hi = 0, items = [];
  const show = () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) { list.hidden = true; return; }
    items = S.emps.filter(e => `${e.emp_code} ${empName(e)} ${e.firstname_en || ""} ${e.lastname_en || ""} ${e.department || ""}`.toLowerCase().includes(q))
      .sort((a, b) => (!!a.end_date - !!b.end_date) || a.emp_code.localeCompare(b.emp_code)).slice(0, 30);
    hi = 0;
    list.innerHTML = items.map((e, i) => `<button type="button" data-i="${i}" class="${i === hi ? "hi" : ""}">${esc(e.emp_code)} · ${esc(empName(e))}<small>${esc([e.position, e.department, e.end_date ? "ออกแล้ว " + thDate(e.end_date) : ""].filter(Boolean).join(" · "))}</small></button>`).join("")
      || `<div class="hint" style="padding:8px 12px">ไม่พบ</div>`;
    list.hidden = false;
    list.querySelectorAll("[data-i]").forEach(b => b.onmousedown = ev => { ev.preventDefault(); onPick(items[+b.dataset.i].emp_code); });
  };
  inp.oninput = show; inp.onfocus = () => { inp.select(); };
  inp.onblur = () => setTimeout(() => { list.hidden = true; }, 120);
  inp.onkeydown = ev => {
    if (list.hidden || !items.length) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); hi = (hi + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; list.querySelectorAll("[data-i]").forEach((b, i) => b.classList.toggle("hi", i === hi)); }
    if (ev.key === "Enter") { ev.preventDefault(); onPick(items[hi].emp_code); }
  };
}

// ---------------------------------------------------------------- ใครเบิกอะไรไป
function renderPeople() {
  const q = (S.filt.pq || "").toLowerCase();
  const by = {};
  for (const m of S.moves) if (m.emp_code && (m.move_type === "issue" || m.move_type === "return")) {
    const p = by[m.emp_code] ||= { code: m.emp_code, name: m.emp_name, rows: [], held: 0, last: m.moved_on };
    p.rows.push(m); p.held -= m.qty; if (!p.name && m.emp_name) p.name = m.emp_name;
  }
  const list = Object.values(by).map(p => { const e = empOf(p.code); return { ...p, name: e ? empName(e) : p.name || "", dept: e?.department || "", left: !!e?.end_date }; })
    .filter(p => !q || `${p.code} ${p.name} ${p.dept}`.toLowerCase().includes(q))
    .sort((a, b) => b.last.localeCompare(a.last));
  $("#spMain").innerHTML = head("ใครเบิกอะไรไป", `${Object.keys(by).length} คนเคยเบิก · ยอดถือ = จ่ายออก − รับคืน`, moveBtns()) + `
    <div class="filters"><label class="fld" style="width:340px"><span>ค้นหา</span><input class="in" id="pq" placeholder="รหัส / ชื่อ / แผนก" value="${esc(S.filt.pq || "")}"></label></div>
    <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>พนักงาน</th><th>แผนก</th><th>รายการ</th><th class="n">ถืออยู่</th><th>ล่าสุด</th>${canWrite() ? "<th></th>" : ""}</tr></thead><tbody>
    ${list.map(p => `<tr><td><b>${esc(p.name || p.code)}</b><div class="sub">${esc(p.code)}${p.left ? ` · <span style="color:var(--red)">ออกแล้ว</span>` : ""}</div></td><td>${esc(p.dept || "-")}</td>
      <td><div class="tags">${p.rows.map(m => `<span class="tag${m.move_type === "return" ? " ret" : ""}">${esc(itemName(itemOf(m.item_id)))} <b>${m.move_type === "return" ? "คืน " : ""}${Math.abs(m.qty)}</b><em>${thDate(m.moved_on)}</em></span>`).join("")}</div></td>
      <td class="n"><b>${n0(p.held)}</b></td><td style="white-space:nowrap">${thDate(p.last)}</td>
      ${canWrite() ? `<td style="white-space:nowrap"><button class="btn btn-s btn-sm" data-ret="${esc(p.code)}">รับคืน</button> <button class="btn btn-s btn-sm" data-iss="${esc(p.code)}">จ่ายเพิ่ม</button></td>` : ""}</tr>`).join("")
      || `<tr><td colspan="6" class="empty">${q ? "ไม่พบพนักงานที่ตรงกับที่ค้น" : "ยังไม่มีการเบิก"}</td></tr>`}</tbody></table></div>`;
  const m = $("#spMain");
  const pq = m.querySelector("#pq"); pq.oninput = () => { S.filt.pq = pq.value; const pos = pq.selectionStart; renderPeople(); const n = $("#pq"); n.focus(); n.setSelectionRange(pos, pos); };
  m.querySelectorAll("[data-ret]").forEach(b => b.onclick = () => openMove("return", { emp: b.dataset.ret }));
  m.querySelectorAll("[data-iss]").forEach(b => b.onclick = () => openMove("issue", { emp: b.dataset.iss }));
  wireMoveBtns(m);
}

// ---------------------------------------------------------------- ประวัติ
function renderHistory(itemArg) {
  const f = S.filt.h ||= { kind: "", type: "", ym: "", q: "", item: "" };
  if (itemArg !== undefined) { f.item = itemArg; const it = itemOf(+itemArg); if (it) f.type = it.item_type; }
  const months = [...new Set(S.moves.map(m => ymOf(m.moved_on)))].sort().reverse();
  const q = f.q.toLowerCase();
  const rows = S.moves.filter(m => {
    const it = itemOf(m.item_id);
    return (!f.kind || m.move_type === f.kind) && (!f.type || it?.item_type === f.type) && (!f.item || String(m.item_id) === String(f.item))
      && (!f.ym || ymOf(m.moved_on) === f.ym) && (!q || `${m.emp_code || ""} ${m.emp_name || ""} ${m.note || ""}`.toLowerCase().includes(q));
  });
  const shown = rows.slice(0, S.filt.hn || 200);
  const sel = (id, opts, v, all) => `<select class="in" id="${id}"><option value="">${all}</option>${opts.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const sizes = S.bal.filter(b => !f.type || b.item_type === f.type);
  $("#spMain").innerHTML = head("ประวัติการเคลื่อนไหว", `${n0(rows.length)} รายการ${rows.length !== S.moves.length ? ` จาก ${n0(S.moves.length)}` : ""}`, moveBtns()) + `
    <div class="filters">
      <label class="fld"><span>ชนิด</span>${sel("hk", Object.entries(KIND).map(([k, v]) => [k, v.label]), f.kind, "ทุกชนิด")}</label>
      <label class="fld"><span>ประเภท</span>${sel("ht", types(true).map(t => [t, t]), f.type, "ทุกประเภท")}</label>
      <label class="fld"><span>ไซส์</span>${sel("hi", sizes.map(b => [b.id, f.type ? b.size : itemName(b)]), f.item, "ทุกไซส์")}</label>
      <label class="fld"><span>เดือน</span>${sel("hm", months.map(m => [m, `${TH_M[+m.slice(5) - 1]} ${+m.slice(0, 4) + 543}`]), f.ym, "ทุกเดือน")}</label>
      <label class="fld" style="flex:1;min-width:220px"><span>ค้นหา</span><input class="in" id="hq" placeholder="รหัส / ชื่อ / หมายเหตุ" value="${esc(f.q)}"></label>
    </div>
    <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>วันที่</th><th>ชนิด</th><th>ของ</th><th class="n">จำนวน</th><th>พนักงาน</th><th>หมายเหตุ</th></tr></thead><tbody>
    ${shown.map(m => { const k = m.move_type, c = { issue: "b", receive: "g", return: "w", adjust: "n" }[k] || "n";
      return `<tr><td style="white-space:nowrap">${thDate(m.moved_on)}</td><td><span class="bd ${c}">${esc(KIND[k]?.label || k)}</span></td>
        <td>${esc(itemName(itemOf(m.item_id)))}</td><td class="n"><b style="color:${m.qty > 0 ? "var(--green)" : "var(--red)"}">${m.qty > 0 ? "+" : "−"}${n0(Math.abs(m.qty))}</b></td>
        <td>${m.emp_code ? `${esc(m.emp_name || (empOf(m.emp_code) ? empName(empOf(m.emp_code)) : ""))}<div class="sub">${esc(m.emp_code)}</div>` : `<span class="hint">—</span>`}</td>
        <td class="hint">${esc(m.note || "")}</td></tr>`; }).join("") || `<tr><td colspan="6" class="empty">ไม่มีรายการ</td></tr>`}</tbody></table>
    ${rows.length > shown.length ? `<div class="more"><button class="btn btn-g btn-sm" id="hmore">แสดงเพิ่ม (${n0(rows.length - shown.length)})</button></div>` : ""}</div>`;
  const m = $("#spMain"), set = (k, v) => { f[k] = v; if (k === "type") f.item = ""; S.filt.hn = 200; if (location.hash !== "#/history") history.replaceState(null, "", "#/history"); renderHistory(); };
  m.querySelector("#hk").onchange = e => set("kind", e.target.value);
  m.querySelector("#ht").onchange = e => set("type", e.target.value);
  m.querySelector("#hi").onchange = e => set("item", e.target.value);
  m.querySelector("#hm").onchange = e => set("ym", e.target.value);
  const hq = m.querySelector("#hq"); hq.oninput = () => { f.q = hq.value; const pos = hq.selectionStart; renderHistory(); const n = $("#hq"); n.focus(); n.setSelectionRange(pos, pos); };
  m.querySelector("#hmore")?.addEventListener("click", () => { S.filt.hn = (S.filt.hn || 200) + 500; renderHistory(); });
  wireMoveBtns(m);
}

// ---------------------------------------------------------------- รายการของ
// ที่เดียวที่เพิ่มประเภท/ไซส์ใหม่ได้ — ไม่ต้องกลับไปแก้ไฟล์ SQL
function renderItems() {
  const byType = {}; for (const b of S.bal) (byType[b.item_type] ||= []).push(b);
  $("#spMain").innerHTML = head("รายการของ", "เพิ่มประเภทใหม่ได้เลย เช่น กางเกง รองเท้าเซฟตี้ · ลำดับคุมว่าไซส์ไหนแสดงก่อน (เรียงตามชื่อไม่ได้ — 10XL จะมาก่อน 2XL)",
    canWrite() ? `<button class="btn btn-p" id="addItem">${ic("plus")}เพิ่มรายการของ</button>` : "") +
    (Object.entries(byType).map(([type, list]) => `<div class="card" style="margin-bottom:16px"><div class="card-b" style="padding-bottom:8px"><div class="card-h" style="margin:0"><div class="t"><b>${esc(type)}</b><span>${list.length} ไซส์ · คงเหลือรวม ${n0(list.reduce((s, b) => s + b.qty, 0))} ชิ้น</span></div>
      ${canWrite() ? `<button class="btn btn-s btn-sm" data-addt="${esc(type)}">${ic("plus")}เพิ่มไซส์</button>` : ""}</div></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>ไซส์</th><th class="n">ลำดับ</th><th class="n">ขั้นต่ำ</th><th class="n">คงเหลือ</th><th class="n">จ่ายไปแล้ว</th><th>สถานะ</th><th>หมายเหตุ</th>${canWrite() ? "<th></th>" : ""}</tr></thead><tbody>
      ${list.map(b => `<tr><td><b>${esc(b.size)}</b></td><td class="n hint">${b.sort_order}</td><td class="n">${b.min_qty || "—"}</td><td class="n"><b>${n0(b.qty)}</b></td><td class="n">${n0(b.issued_total)}</td>
        <td>${b.is_active ? `<span class="bd g">ใช้งาน</span>` : `<span class="bd n">ปิด</span>`}</td><td class="hint">${esc(b.remark || "")}</td>
        ${canWrite() ? `<td><button class="btn btn-s btn-sm" data-ed="${b.id}">แก้ไข</button></td>` : ""}</tr>`).join("")}</tbody></table></div></div>`).join("")
    || `<div class="card empty">ยังไม่มีรายการของ</div>`);
  const m = $("#spMain");
  m.querySelector("#addItem")?.addEventListener("click", () => itemForm(null));
  m.querySelectorAll("[data-addt]").forEach(b => b.onclick = () => itemForm(null, b.dataset.addt));
  m.querySelectorAll("[data-ed]").forEach(b => b.onclick = () => itemForm(+b.dataset.ed));
}
function itemForm(id, presetType = "") {
  const b = id ? itemOf(id) : null;
  const nextOrd = t => Math.max(0, ...S.bal.filter(x => x.item_type === t).map(x => x.sort_order || 0)) + 1;
  const used = b && S.moves.some(m => m.item_id === b.id);
  const el = modal(b ? `แก้ไข ${esc(itemName(b))}` : "เพิ่มรายการของ", `
    <div class="grid2">
      <label class="fld"><span>ประเภท *</span><input class="in" id="iType" list="iTypes" value="${esc(b?.item_type || presetType)}" placeholder="เช่น เสื้อ, กางเกง, รองเท้าเซฟตี้">
        <datalist id="iTypes">${types(true).map(t => `<option value="${esc(t)}">`).join("")}</datalist><small class="hint">พิมพ์ชื่อใหม่ได้ถ้ายังไม่มีประเภทนั้น</small></label>
      <label class="fld"><span>ไซส์ *</span><input class="in" id="iSize" value="${esc(b?.size || "")}" placeholder="เช่น M, 2XL, 42, Free Size"></label>
      <label class="fld"><span>ลำดับการแสดง</span><input class="in" id="iOrd" type="number" value="${b?.sort_order ?? (presetType ? nextOrd(presetType) : "")}" placeholder="เลขน้อยแสดงก่อน"><small class="hint">เว้นว่าง = ต่อท้าย</small></label>
      <label class="fld"><span>จำนวนขั้นต่ำ</span><input class="in" id="iMin" type="number" min="0" value="${b?.min_qty ?? 20}"><small class="hint">ต่ำกว่านี้ขึ้น “ใกล้หมด” · 0 = ไม่เตือน</small></label>
    </div>
    <label class="fld"><span>หมายเหตุ</span><input class="in" id="iRemark" value="${esc(b?.remark || "")}"></label>
    ${b ? `<label class="opt"><input type="checkbox" id="iAct" ${b.is_active ? "checked" : ""}><div><b>ใช้งานอยู่</b><div class="hint">ปิดแล้วจะไม่ขึ้นให้เลือกตอนรับเข้า/จ่ายออก แต่ยอดและประวัติยังอยู่ครบ</div></div></label>` : ""}`,
    `${b && !used ? `<button class="btn btn-d" id="iDel" style="margin-right:auto">ลบ</button>` : ""}<button class="btn btn-g" data-x>ยกเลิก</button><button class="btn btn-p" id="iSave">บันทึก</button>`);
  el.querySelectorAll("[data-x]").forEach(x => x.onclick = () => el.remove());
  if (!b) el.querySelector("#iType").addEventListener("change", ev => { const o = el.querySelector("#iOrd"); if (!o.value) o.value = nextOrd(ev.target.value.trim()); });
  el.querySelector("#iSave").onclick = async () => {
    const g = s => el.querySelector(s)?.value?.trim() || "";
    const type = g("#iType"), size = g("#iSize");
    if (!type) return toast("กรุณากรอกประเภท", "err");
    if (!size) return toast("กรุณากรอกไซส์", "err");
    const data = { item_type: type, size, sort_order: g("#iOrd") !== "" ? Number(g("#iOrd")) : nextOrd(type), min_qty: Math.max(0, Number(g("#iMin")) || 0),
      remark: g("#iRemark") || null, updated_at: new Date().toISOString(), ...(b ? { is_active: el.querySelector("#iAct").checked } : {}) };
    const { error } = b ? await supabase.from("uniform_item").update(data).eq("id", b.id) : await supabase.from("uniform_item").insert(data);
    if (error) return toast(/duplicate|unique/.test(error.message) ? `มี "${type} ${size}" อยู่แล้ว` : "บันทึกไม่สำเร็จ: " + error.message, "err");
    el.remove(); await loadAll(); renderItems(); toast("บันทึกแล้ว", "ok");
  };
  // เคยมีการเคลื่อนไหวแล้วลบไม่ได้ (FK restrict) — ปิดการใช้งานแทน ประวัติจะได้ไม่หาย
  el.querySelector("#iDel")?.addEventListener("click", async () => {
    if (!confirm(`ลบ "${itemName(b)}" ?`)) return;
    const { error } = await supabase.from("uniform_item").delete().eq("id", b.id);
    if (error) return toast("ลบไม่สำเร็จ: " + error.message, "err");
    el.remove(); await loadAll(); renderItems(); toast("ลบแล้ว", "ok");
  });
}

// ---------------------------------------------------------------- Export
function exportXlsx() {
  if (!window.XLSX) return toast("กรุณารอโหลด library", "err");
  const X = window.XLSX, wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(S.bal.map(b => ({ "ประเภท": b.item_type, "ไซส์": b.size, "คงเหลือ": b.qty, "ขั้นต่ำ": b.min_qty,
    "สถานะ": !b.is_active ? "ปิด" : isOut(b) ? "หมด" : isLow(b) ? "ใกล้หมด" : "พอ", "จ่ายไปแล้วทั้งหมด": b.issued_total, "เคลื่อนไหวล่าสุด": b.last_move || "" }))), "ยอดคงเหลือ");
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(S.moves.map(m => { const it = itemOf(m.item_id);
    return { "วันที่": m.moved_on, "ชนิด": KIND[m.move_type]?.label || m.move_type, "ประเภท": it?.item_type || "", "ไซส์": it?.size || "", "จำนวน": m.qty,
      "รหัสพนักงาน": m.emp_code || "", "ชื่อ": m.emp_name || "", "หมายเหตุ": m.note || "" }; })), "ประวัติ");
  X.writeFile(wb, `สต๊อกยูนิฟอร์ม_${todayISO()}.xlsx`);
}

boot();
