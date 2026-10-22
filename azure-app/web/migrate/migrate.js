// ============================================================================
// ย้ายข้อมูลไป Azure (ขั้น 2) — ผู้ใช้/สิทธิ์ + ทะเบียนพนักงาน + Movement
//   1) สร้างตารางใน akarahr2  2) คัดลอกจาก Supabase (session ของผู้ใช้เอง)  3) ตรวจเทียบทีละแถว
//   ห้าม import js/app.js
// ============================================================================
import { supabase } from "/js/supabase-config.js";

const app = document.getElementById("app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// ข้อความผลเก็บไว้ในตัวแปร — หน้าวาดใหม่หลังกดปุ่มแล้วผลยังอยู่ (เดิมหายไปพร้อมข้อความผิดพลาด)
let LOG = "";
const log = m => { LOG += m + "\n"; const el = document.getElementById("mgLog"); if (el) { el.textContent = LOG; el.scrollTop = el.scrollHeight; } };
const api = async (path, opts = {}) => {
  const r = await fetch(path, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...opts });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { detail: t }; }
  if (!r.ok) throw new Error(`${r.status} ${j.detail || t}`.slice(0, 300));
  return j;
};

// ตารางที่ย้ายในขั้นนี้ — ลำดับสำคัญ (สิทธิ์ก่อน)
const TABLES = [
  { name: "app_roles", from: "app_roles", order: "key" },
  { name: "permissions", from: "permissions", order: "key" },
  { name: "role_permissions", from: "role_permissions", order: "role_key" },
  { name: "user_roles", from: "user_roles", order: "email",
    map: r => r.email ? { email: r.email.trim().toLowerCase(), name: r.name, role: r.role || "user", supabase_user_id: r.user_id, created_at: r.created_at } : null },
  { name: "employees", from: "employees", order: "emp_code" },
  { name: "movements", from: "movements", order: "id" },
];

async function fetchAll(table, order) {
  const all = [], N = 1000;
  for (let from = 0; ; from += N) {
    const { data, error } = await supabase.from(table).select("*").order(order).range(from, from + N - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    all.push(...(data || []));
    if (!data || data.length < N) return all;
  }
}

async function render() {
  let me, sb;
  try { me = await api("/api/me/access"); } catch (e) { app.innerHTML = `<div class="note r">อ่านตัวตน Microsoft ไม่ได้: ${esc(e.message)}</div>`; return; }
  sb = (await supabase.auth.getSession()).data.session;
  let status = null, statusErr = "";
  if (me.admin) status = await api("/api/admin/status").catch(e => { statusErr = e.message; return null; });
  app.innerHTML = `
    <h1>ย้ายข้อมูลไป Azure · ขั้น 2 <small class="hint" style="font-size:12px;font-weight:400">หน้ารุ่น 3</small></h1>
    <div class="card card-b">
      <div>Microsoft: <b>${esc(me.email)}</b> · ${me.admin ? `<span class="ok">admin</span>` : `<span class="bad">ไม่ใช่ admin — ทำขั้นนี้ไม่ได้</span>`}</div>
      <div style="margin-top:6px">Supabase: ${sb ? `<b>${esc(sb.user.email)}</b> <span class="ok">ล็อกอินแล้ว</span>` : `<span class="bad">ยังไม่ได้ล็อกอิน</span> — <a href="/" style="text-decoration:underline">เข้าสู่ระบบ HR ในเว็บนี้</a> ก่อน แล้วกลับมาหน้านี้`}</div>
    </div>
    ${me.admin ? `<div class="card card-b">
      <div class="card-t">ใน Azure ตอนนี้</div>
      ${statusErr ? `<div class="note r">อ่านสถานะไม่ได้: ${esc(statusErr)}</div>` : ""}
      <table><tr><th>ตาราง</th><th style="text-align:right">แถว</th></tr>
        ${TABLES.map(t => `<tr><td>${t.name}</td><td class="n">${status?.tables?.[t.name] ?? "— ยังไม่มีตาราง"}</td></tr>`).join("")}</table>
    </div>
    <div class="card card-b">
      <div class="acts">
        <button class="btn btn-s" id="b1">1) สร้างตาราง</button>
        <button class="btn btn-p" id="b2" ${sb ? "" : "disabled"}>2) คัดลอกจาก Supabase (แทนที่ของเดิมใน Azure)</button>
        <button class="btn btn-s" id="b3" ${sb ? "" : "disabled"}>3) ตรวจเทียบทีละแถว</button>
      </div>
      <pre id="mgLog">${esc(LOG)}</pre>
    </div>` : ""}`;
  if (!me.admin) return;
  document.getElementById("b1").onclick = () => run(async () => { const r = await api("/api/admin/setup", { method: "POST" }); log(`สร้าง/ตรวจตารางแล้ว (${r.statements} คำสั่ง)`); }, "สร้างตาราง");
  document.getElementById("b2").onclick = () => run(copyAll, "คัดลอกจาก Supabase");
  document.getElementById("b3").onclick = () => run(compare, "ตรวจเทียบ");
}

async function run(fn, label) {
  log(`▶ ${label} …`);
  document.querySelectorAll(".acts .btn").forEach(b => b.disabled = true);
  try { await fn(); log("✓ เสร็จ"); } catch (e) { log("✗ " + e.message); }
  setTimeout(render, 600);
}

async function copyAll() {
  for (const t of TABLES) {
    const src = await fetchAll(t.from, t.order);
    const rows = t.map ? src.map(t.map).filter(Boolean) : src;
    log(`${t.name}: อ่านจาก Supabase ${src.length} แถว${rows.length !== src.length ? ` (ใช้ได้ ${rows.length})` : ""}`);
    const C = 200;
    if (!rows.length) { await api(`/api/admin/import/${t.name}`, { method: "POST", body: JSON.stringify({ rows: [], replace: true }) }); continue; }
    for (let i = 0; i < rows.length; i += C) {
      const r = await api(`/api/admin/import/${t.name}`, { method: "POST", body: JSON.stringify({ rows: rows.slice(i, i + C), replace: i === 0 }) });
      if (i + C >= rows.length) log(`  → Azure มี ${r.total} แถว`);
    }
  }
}

// ค่าที่ควรเท่ากัน — วันที่ตัดเวลาโซน/เศษวินาทีทิ้ง, ตัวเลขเทียบเป็นตัวเลข, JSON เทียบเป็นข้อความเรียงคีย์
const norm = v => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object") return JSON.stringify(Object.keys(v).sort().reduce((o, k) => (o[k] = v[k] ?? null, o), {}));
  if (typeof v === "boolean") return v ? "1" : "0";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return new Date(s).toISOString().slice(0, 19);
  if (/^-?\d+(\.\d+)?$/.test(s)) return String(Number(s));
  return s;
};
async function compare() {
  for (const [name, key, url] of [["employees", "emp_code", "/api/employees"], ["movements", "id", "/api/movements"]]) {
    const [a, b] = await Promise.all([fetchAll(name, key), api(url)]);
    const B = new Map(b.map(r => [String(r[key]), r]));
    let diff = 0, missing = 0; const samples = [];
    for (const r of a) {
      const o = B.get(String(r[key]));
      if (!o) { missing++; if (samples.length < 5) samples.push(`ไม่มีใน Azure: ${r[key]}`); continue; }
      for (const k of Object.keys(r)) {
        if (!(k in o)) continue;   // คอลัมน์ที่ Azure ซ่อน (เช่น salary ถ้าไม่มีสิทธิ์) ไม่นับ
        if (norm(r[k]) !== norm(o[k])) { diff++; if (samples.length < 8) samples.push(`${r[key]} · ${k}: Supabase=${norm(r[k])} | Azure=${norm(o[k])}`); break; }
      }
    }
    log(`${name}: Supabase ${a.length} · Azure ${b.length} · ไม่มีใน Azure ${missing} · ค่าไม่ตรง ${diff} แถว ${!missing && !diff && a.length === b.length ? "✓ ตรงทั้งหมด" : ""}`);
    samples.forEach(s => log("   " + s));
  }
}

render();
