// ============================================================================
// ย้ายทั้งระบบไป Azure — ทุกตาราง
//   0) ล้าง (ตารางรุ่นขั้น 2)  1) สร้างตาราง  2) คัดลอกจาก Supabase (session ของผู้ใช้เอง)  3) ตรวจเทียบทุกแถวทุกช่อง
//   ตารางลิงก์ลงนามที่ค้าง (token) อ่านผ่านเว็บไม่ได้ — นำเข้าจากไฟล์ที่ export ใน SQL Editor (ปุ่ม 2b)
//   ห้าม import js/app.js
// ============================================================================
import { supabase } from "/js/supabase-direct.js";   // ต่อ Supabase ตรง (หน้าอื่นบน Azure ใช้ /api แทนแล้ว)

const app = document.getElementById("app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// ข้อความผลเก็บไว้ในตัวแปร — หน้าวาดใหม่หลังกดปุ่มแล้วผลยังอยู่
let LOG = "";
const log = m => { LOG += m + "\n"; const el = document.getElementById("mgLog"); if (el) { el.textContent = LOG; el.scrollTop = el.scrollHeight; } };
const api = async (path, opts = {}) => {
  const r = await fetch(path, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...opts });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { detail: t }; }
  if (!r.ok) throw new Error(`${r.status} ${j.detail || t}`.slice(0, 400));
  return j;
};

// อ่านผ่านเว็บไม่ได้ (ไม่มี policy) — ลิงก์ค้างนำเข้าจากไฟล์ · mail_secret ไม่ย้าย (Azure ใช้รหัสใน Key Vault)
const FROM_FILE = ["ec_sign_tokens", "exp_approve_tokens", "paf_tokens", "payroll_sign_tokens", "fund_invite_attempt"];
const SKIP = ["mail_secret"];
let META = null;   // {table: {pk, identity}}

async function fetchAll(table, order) {
  const all = [], N = 1000;
  for (let from = 0; ; from += N) {
    let q = supabase.from(table).select("*");
    for (const k of order) q = q.order(k);
    const { data, error } = await q.range(from, from + N - 1);
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
  if (me.admin) {
    status = await api("/api/admin/status").catch(e => { statusErr = e.message; return null; });
    META = META || await api("/api/admin/tables");
  }
  const T = status?.tables || {};
  const made = Object.values(T).filter(v => v !== null).length, total = Object.keys(T).length;
  app.innerHTML = `
    <h1>ย้ายทั้งระบบไป Azure <small class="hint" style="font-size:12px;font-weight:400">หน้ารุ่น 8</small></h1>
    <div class="card card-b">
      <div>Microsoft: <b>${esc(me.email)}</b> · ${me.admin ? `<span class="ok">admin</span>` : `<span class="bad">ไม่ใช่ admin — ทำขั้นนี้ไม่ได้</span>`}</div>
      <div style="margin-top:6px">Supabase: ${sb ? `<b>${esc(sb.user.email)}</b> <span class="ok">ล็อกอินแล้ว</span>` : `<span class="bad">ยังไม่ได้ล็อกอิน</span> <button class="btn btn-s btn-sm" id="sbLogin">เข้าสู่ Supabase ด้วย Google</button>`}</div>
    </div>
    ${me.admin ? `
    <div class="card card-b">
      <div class="acts">
        <button class="btn btn-d" id="b0">0) ล้างตารางใน Azure</button>
        <button class="btn btn-s" id="b1">1) สร้างตาราง</button>
        <button class="btn btn-p" id="b2" ${sb ? "" : "disabled"}>2) คัดลอกจาก Supabase</button>
        <label class="btn btn-s" style="cursor:pointer">2b) นำเข้าไฟล์ลิงก์ค้าง<input type="file" id="b2b" accept=".csv,.json" hidden></label>
        <button class="btn btn-s" id="b2c" ${sb ? "" : "disabled"}>2c) คัดลอกไฟล์แนบ/ลายเซ็น</button>
        <button class="btn btn-s" id="b3" ${sb ? "" : "disabled"}>3) ตรวจเทียบทุกตาราง</button>
      </div>
      ${status?.needs_reset ? `<div class="note r" style="margin-top:10px">ตารางใน Azure ยังเป็นรุ่นขั้น 2 — กด 0) ล้าง ก่อน แล้วค่อย 1) สร้างตาราง</div>` : ""}
      <pre id="mgLog">${esc(LOG)}</pre>
    </div>
    <div class="card card-b">
      <div class="card-t">ใน Azure ตอนนี้ · สร้างแล้ว ${made}/${total} ตาราง</div>
      ${statusErr ? `<div class="note r">อ่านสถานะไม่ได้: ${esc(statusErr)}</div>` : ""}
      <table><tr><th>ตาราง</th><th style="text-align:right">แถว</th></tr>
        ${Object.entries(T).map(([t, n]) => `<tr><td>${t}${FROM_FILE.includes(t) ? ` <span class="hint">(จากไฟล์)</span>` : SKIP.includes(t) ? ` <span class="hint">(ไม่ย้าย)</span>` : ""}</td><td class="n">${n ?? "— ยังไม่มี"}</td></tr>`).join("")}</table>
    </div>` : ""}`;
  document.getElementById("sbLogin")?.addEventListener("click", () =>
    supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + "/migrate/" } }));
  if (!me.admin) return;
  document.getElementById("b0").onclick = () => {
    if (prompt("ลบทุกตารางใน Azure (ข้อมูลจริงยังอยู่ใน Supabase) — พิมพ์ RESET เพื่อยืนยัน") !== "RESET") return;
    run(async () => { const r = await api("/api/admin/reset", { method: "POST", body: JSON.stringify({ confirm: "RESET" }) }); log(`ลบแล้ว ${r.dropped} ตาราง`); }, "ล้างตาราง");
  };
  document.getElementById("b1").onclick = () => run(async () => {
    const r = await api("/api/admin/setup", { method: "POST" });
    log(`รัน ${r.statements} คำสั่ง · พลาด ${r.errors.length}`);
    r.errors.forEach(e => log(`   ✗ ${e.sql}\n     ${e.error}`));
    if (r.errors.length) throw new Error("มีคำสั่งที่ไม่ผ่าน — แคปส่งให้ผู้พัฒนา");
  }, "สร้างตาราง");
  document.getElementById("b2").onclick = () => run(copyAll, "คัดลอกจาก Supabase");
  document.getElementById("b2b").onchange = e => { const f = e.target.files[0]; if (f) run(() => importFile(f), "นำเข้าไฟล์ลิงก์ค้าง"); };
  document.getElementById("b2c").onclick = () => run(copyFiles, "คัดลอกไฟล์แนบ/ลายเซ็น");
  document.getElementById("b3").onclick = () => run(compare, "ตรวจเทียบ");
}

async function run(fn, label) {
  log(`▶ ${label} …`);
  document.querySelectorAll(".acts .btn").forEach(b => b.disabled = true);
  try { await fn(); log("✓ เสร็จ"); } catch (e) { log("✗ " + e.message); }
  setTimeout(render, 600);
}

async function pushRows(table, rows) {
  const C = 200;
  if (!rows.length) return (await api(`/api/admin/import/${table}`, { method: "POST", body: JSON.stringify({ rows: [], replace: true }) })).total;
  let total = 0;
  for (let i = 0; i < rows.length; i += C)
    total = (await api(`/api/admin/import/${table}`, { method: "POST", body: JSON.stringify({ rows: rows.slice(i, i + C), replace: i === 0 }) })).total;
  return total;
}

async function constraints(enable) {
  const r = await api("/api/admin/constraints", { method: "POST", body: JSON.stringify({ enable }) });
  r.errors.forEach(e => log(`   ✗ ${e.table}: ${e.error}`));
  if (!r.ok) throw new Error(enable ? "ข้อมูลบางตารางไม่ผ่านกฎ (คีย์/เงื่อนไข) — แคปส่งให้ผู้พัฒนา" : "ปิดกฎชั่วคราวไม่ได้");
}

async function copyAll() {
  await constraints(false);
  let bad = 0;
  for (const [t, m] of Object.entries(META)) {
    if (FROM_FILE.includes(t) || SKIP.includes(t)) continue;
    try {
      const src = await fetchAll(t, m.pk);
      const n = await pushRows(t, src);
      log(`${t}: Supabase ${src.length} → Azure ${n}${src.length === n ? "" : "  ⚠️ ไม่เท่ากัน"}`);
      if (src.length !== n) bad++;
    } catch (e) { bad++; log(`${t}: ✗ ${e.message}`); }
  }
  log("เปิดกฎ (คีย์/เงื่อนไข/trigger) กลับ และตรวจข้อมูลทุกแถว …");
  await constraints(true);
  if (bad) throw new Error(`${bad} ตารางมีปัญหา`);
}

// ไฟล์ใน Supabase Storage → Azure Blob (ชื่อ bucket = ชื่อ container เดิม, path เดิม)
const BUCKETS = ["movement-docs", "letter-assets", "expense-files", "doc-files"];
async function listAll(bucket, prefix = "") {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, offset: off });
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`);
    for (const x of data || []) {
      const p = prefix ? `${prefix}/${x.name}` : x.name;
      if (x.id === null) out.push(...await listAll(bucket, p));   // โฟลเดอร์
      else out.push(p);
    }
    if (!data || data.length < 1000) return out;
  }
}
async function copyFiles() {
  let bad = 0;
  for (const b of BUCKETS) {
    const paths = await listAll(b);
    let n = 0;
    for (const p of paths) {
      const { data, error } = await supabase.storage.from(b).download(p);
      if (error) { bad++; log(`   ✗ ${b}/${p}: ${error.message}`); continue; }
      const r = await fetch(`/api/admin/blob/${b}/${p.split("/").map(encodeURIComponent).join("/")}`, {
        method: "PUT", credentials: "same-origin", body: data, headers: { "Content-Type": data.type || "application/octet-stream" } });
      if (!r.ok) { bad++; log(`   ✗ ${b}/${p}: ${r.status} ${(await r.text()).slice(0, 200)}`); continue; }
      n++;
    }
    log(`${b}: Supabase ${paths.length} ไฟล์ → Azure ${n}`);
  }
  if (bad) throw new Error(`${bad} ไฟล์ไม่สำเร็จ`);
}

// ไฟล์จาก export_tokens.sql (CSV 1 ช่อง หรือ JSON) = {table: [rows]}
async function importFile(f) {
  let txt = await f.text();
  if (f.name.endsWith(".csv")) {           // CSV ช่องเดียว: หัวคอลัมน์ บรรทัดแรก, ค่าในเครื่องหมายคำพูด
    const body = txt.slice(txt.indexOf("\n") + 1).trim();
    txt = body.startsWith('"') ? body.slice(1, -1).replace(/""/g, '"') : body;
  }
  const data = JSON.parse(txt);
  await constraints(false);
  for (const t of FROM_FILE) {
    const rows = data[t] || [];
    log(`${t}: ไฟล์ ${rows.length} → Azure ${await pushRows(t, rows)}`);
  }
  await constraints(true);
}

// ค่าที่ควรเท่ากัน — วันที่ตัดโซน/เศษ, ตัวเลขเทียบเป็นตัวเลข, JSON เรียงคีย์ทุกชั้น, uuid ตัวเล็ก
const sortDeep = v => Array.isArray(v) ? v.map(sortDeep) : v && typeof v === "object"
  ? Object.keys(v).sort().reduce((o, k) => (o[k] = sortDeep(v[k]), o), {}) : v;
const norm = v => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object") return JSON.stringify(sortDeep(v));
  if (typeof v === "boolean") return v ? "1" : "0";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return new Date(s).toISOString().slice(0, 19);
  // ตัวเลข: Azure เก็บทศนิยม 4 ตำแหน่ง — เศษจากการบวกเลขทศนิยมใน JS (139333.33000000002) ถือว่าเท่ากัน
  if (/^-?\d+(\.\d+)?(e-?\d+)?$/.test(s)) return String(Math.round(Number(s) * 1e4) / 1e4);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)) return s.toLowerCase();
  return s;
};

async function compare() {
  let allOk = true;
  for (const [t, m] of Object.entries(META)) {
    if (FROM_FILE.includes(t) || SKIP.includes(t)) continue;
    const [a, b] = await Promise.all([fetchAll(t, m.pk), api(`/api/admin/dump/${t}`)]);
    const K = r => m.pk.map(k => norm(r[k])).join("|");
    const B = new Map(b.map(r => [K(r), r]));
    let diff = 0, missing = 0; const samples = [];
    for (const r of a) {
      const o = B.get(K(r));
      if (!o) { missing++; if (samples.length < 3) samples.push(`ไม่มีใน Azure: ${K(r)}`); continue; }
      for (const k of Object.keys(r)) {
        if (norm(r[k]) !== norm(o[k])) { diff++; if (samples.length < 5) samples.push(`${K(r)} · ${k}: Supabase=${String(norm(r[k])).slice(0, 80)} | Azure=${String(norm(o[k])).slice(0, 80)}`); break; }
      }
    }
    const ok = !missing && !diff && a.length === b.length;
    allOk &&= ok;
    log(`${ok ? "✓" : "✗"} ${t}: ${a.length} / ${b.length}${missing ? ` · ไม่มีใน Azure ${missing}` : ""}${diff ? ` · ค่าไม่ตรง ${diff}` : ""}`);
    samples.forEach(s => log("     " + s));
  }
  log(allOk ? "ทุกตารางตรงกันหมด" : "มีตารางไม่ตรง — แคปส่งให้ผู้พัฒนา");
}

render();
