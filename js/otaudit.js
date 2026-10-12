// ===== ตรวจโอที =====
// ตรรกะอยู่ใน otaudit-calc.js (มีเทส) — หน้านี้: อัปโหลด 2 ไฟล์ TigerSoft → ยืนยันเวลากะ → รายการให้ HR ไปแก้ใน TigerSoft → Export
// DB (sql/schema_ot_audit.sql): ot_shift_times = เวลากะที่ HR ยืนยัน (เจอกะใหม่ ระบบเดาแล้วถามใหม่)
//                               ot_audit_marks = ติ๊ก "แก้ใน TigerSoft แล้ว" + หมายเหตุ ที่ทีมเห็นร่วมกัน
// ผลตรวจไม่บันทึก — อัปโหลดไฟล์ใหม่เมื่อไรก็คิดใหม่ (ผู้ใช้เลือก 2026-10-12)
import { esc, toast, can, allEmployees, currentUser } from "./app.js";
import { supabase } from "./supabase-config.js";
import { parseProcessed, parseRequests, audit, inferShiftTimes, TYPES, IO, hhmm, clockOf, SCAN_TOLERANCE, OT_BLOCK } from "./otaudit-calc.js";

const TH_M = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const ymTH = ym => `${TH_M[+ym.slice(5, 7) - 1]} ${+ym.slice(0, 4) + 543}`;
const dTH = iso => iso ? `${+iso.slice(8)} ${TH_M[+iso.slice(5, 7) - 1]}` : "-";
const fmt = n => Number(n || 0).toLocaleString("en-US");
const tm = m => m == null ? "" : `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;   // นาที → "HH:MM" (ตัดวัน)
const fromTm = v => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || "")); return m ? +m[1] * 60 + +m[2] : null; };
const me = () => currentUser?.user_metadata?.full_name || currentUser?.email || "";

const KINDS = {
  amount:   ["ยอดไม่ตรง TigerSoft", "warn"],
  scan:     ["เวลาสแกนไม่ครอบคลุม", "warn"],
  position: ["ชนิดไม่ตรงเวลากะ", "warn"],
  leaveday: ["ขอโอทีวันลา/ขาดงาน", "warn"],
  wrongday: ["อาจลงวันผิด", "warn"],
  holiday:  ["วันหยุดขอผิดชนิด", "warn"],
  level:    ["ระดับไม่ตรงรูปแบบ (I/O)", "warn"],
  overlap:  ["ขอซ้ำ / ซ้อนกัน", "warn"],
  f01:      ["F01 วันหยุดยังไม่หักพัก", "warn"],
  week36:   ["โอทีเกิน 36 ชม./สัปดาห์", "warn"],
  lunch:    ["โอทีพักเที่ยง (เตือน)", "info"],
};
// shifts: เวลากะที่ใช้ตรวจ = ที่ยืนยันใน DB + ที่ระบบเดา (ยังไม่ยืนยัน) · edits: ที่ HR พิมพ์ในแผงแต่ยังไม่กดยืนยัน
const S = { files: { proc: null, req: null }, proc: null, reqs: null, res: null, ym: null, kind: "need", q: "",
            db: {}, dbOk: true, guess: {}, edits: {}, showShifts: false, marks: new Map(), marksOk: true };

// ---------------------------------------------------------------- จัดกลุ่มเป็นคน-วัน
const dayOf = i => i.req ? (i.req.t ? `${i.req.emp}|${i.req.t.day}` : `${i.req.emp}|${i.req.date}`) : i.day.key;
function groupIssues(xs) {
  const m = new Map();
  for (const i of xs) {
    const k = dayOf(i), g = m.get(k) || { key: k, issues: [], reqs: [], t: null, day: null, emp: "", name: "", date: "" };
    g.issues.push(i); const src = i.req || i.day;
    g.emp = src.emp; g.name = g.name || src.name || ""; g.t = g.t || (i.req ? i.req.t : i.day.t);
    for (const r of i.req ? [i.req] : i.day.reqs) if (!g.reqs.includes(r)) g.reqs.push(r);
    g.date = g.t ? g.t.date : src.date; m.set(k, g);
  }
  const dayMap = new Map((S.res?.days || []).map(d => [d.key, d]));
  for (const g of m.values()) g.day = dayMap.get(g.key) || null;
  return [...m.values()].sort((a, b) => a.emp.localeCompare(b.emp) || String(a.date).localeCompare(String(b.date)));
}

// ---------------------------------------------------------------- หน้า
export function renderOtAudit() {
  const pg = document.getElementById("pageOtaudit");
  if (!can("page.otaudit") && !can("page.shiftallow")) {
    pg.innerHTML = `<div class="empty-state" style="padding-top:80px;"><div class="empty-title">ไม่มีสิทธิ์เข้าถึง</div><div class="empty-sub">เฉพาะ HR และ Admin</div></div>`;
    return;
  }
  const hidden = 'style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;border:0;overflow:hidden;clip:rect(0 0 0 0);"';
  const box = (k, title, hint) => `<div style="border:1px dashed var(--border);border-radius:10px;padding:10px 12px;">
      <div style="font-weight:600;font-size:13px;">${title}</div><div class="text-muted" style="font-size:11.5px;margin:2px 0 8px;">${hint}</div>
      <input type="file" id="otF_${k}" accept=".xls,.xlsx" ${hidden}><label for="otF_${k}" class="btn btn-secondary btn-sm" style="cursor:pointer;">📁 เลือกไฟล์</label>
      <span style="font-size:12px;margin-left:6px;">${S.files[k] ? `✅ ${esc(S.files[k])}` : ""}</span></div>`;
  pg.innerHTML = `
  <div class="page-header"><div><div class="page-heading">ตรวจโอที</div>
    <div class="page-sub">เทียบคำขอโอทีกับรายงานหลังประมวลจาก TigerSoft — ได้รายการให้ไปแก้ใน TigerSoft</div></div></div>
  <div class="section mt-4 pb-4">
    <div class="card card-body">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;">
        ${box("proc", "1. ข้อมูลหลังประมวล", "รายงานแยกตามพนักงาน (ไฟล์เดียวกับเบี้ยขยัน) — เวลาสแกน + ชั่วโมงโอทีที่ TigerSoft คิด")}
        ${box("req", "2. รายงานการขอโอทีปกติ", "คำขอโอทีรายรายการ — ชนิด S/B/E · I/O · เวลาเริ่ม–ถึง")}
      </div>
      <div class="text-muted" style="font-size:12.5px;line-height:1.8;margin-top:12px;">
        • ชนิด: <b>S</b> ก่อนเริ่มงาน · <b>B</b> พักเที่ยง · <b>E</b> หลังเลิกงาน — รูปแบบ: <b>I</b> จ่ายเงิน (ระดับ O) · <b>O</b> เป็นลา (ระดับ S/M)<br>
        • <b>คิดโอทีที่ควรได้ต่อคน-วัน</b> = ช่วงที่ขอ ∩ เวลาสแกน − เวลางานปกติ (วันทำงาน) / − เวลาพัก (วันหยุด) + พักเที่ยงที่ขอ · ปัดลงทีละ ${OT_BLOCK} นาทีแบบ TigerSoft · <b>ต่างแม้ ${OT_BLOCK} นาทีก็ขึ้น</b><br>
        • ตรวจเพิ่ม: เวลาสแกนครอบคลุมช่วงที่ขอ (คลาดได้ ${SCAN_TOLERANCE} นาที) · ก่อนเริ่มงานต้องจบก่อนเข้ากะ / หลังเลิกงานต้องเริ่มหลังเลิกกะ · ขอโอทีวันลา/ขาดงาน ·
          วันหยุดต้องขอชนิดก่อนเริ่มงาน · ระดับต้องตรงรูปแบบ · <b>โอทีรวมเกิน 36 ชม./สัปดาห์</b> (ไม่นับทำงานวันหยุดในเวลาปกติ) · คำขอซ้ำ · คำขอที่น่าจะลงวันผิด · F01 วันหยุด OT1 ต้อง 8:30 · โอทีพักเที่ยงขึ้นเตือน<br>
        • เวลากะ: ระบบเดาจากคำขอโอทีและเวลาสแกน ให้ HR ยืนยันครั้งเดียว — เจอกะใหม่เมื่อไร ระบบถามใหม่
      </div>
    </div>
    <div id="otShifts" class="mt-4"></div>
    <div id="otOut" class="mt-4"></div>
  </div>`;
  for (const k of ["proc", "req"]) document.getElementById(`otF_${k}`).onchange = e => readFile(k, e.target);
  if (S.res) { drawShifts(); drawOut(); }
}

function readFile(kind, input) {
  const file = input.files?.[0]; input.value = "";
  if (!file) return;
  if (!window.XLSX) { toast("กรุณารอโหลด library", "error"); return; }
  const fr = new FileReader();
  fr.onload = async ev => {
    try {
      const wb = window.XLSX.read(new Uint8Array(ev.target.result), { type: "array" });
      const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
      if (kind === "proc") S.proc = parseProcessed(rows);
      else { S.reqs = parseRequests(rows); if (!S.reqs.length) throw new Error("ไม่พบคำขอโอที — ใช่ไฟล์ “รายงานการขอโอทีปกติ” ไหม"); }
      S.files[kind] = file.name;
      await load();
    } catch (e) { toast(`${kind === "proc" ? "ข้อมูลหลังประมวล" : "รายงานการขอโอที"}: ${e.message}`, "error"); }
  };
  fr.readAsArrayBuffer(file);
}

// อ่านเวลากะ + สถานะที่ตรวจแล้วจาก DB แล้วคิดใหม่
async function load() {
  if (S.proc) {
    const cnt = {}; for (const t of S.proc.values()) for (const d of t.days) cnt[d.date.slice(0, 7)] = (cnt[d.date.slice(0, 7)] || 0) + 1;
    S.ym = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }
  if (!(S.proc && S.reqs)) { renderOtAudit(); return; }
  const [times, marks] = await Promise.all([
    supabase.from("ot_shift_times").select("*"),
    S.ym ? supabase.from("ot_audit_marks").select("*").eq("ym", S.ym) : Promise.resolve({ data: [] }),
  ]);
  S.dbOk = !times.error; S.marksOk = !marks.error;
  S.db = Object.fromEntries((times.data || []).map(r => [r.code.toUpperCase(),
    { start: r.start_min, end: r.end_min, brk: r.break_start != null ? [r.break_start, r.break_end] : null,
      byHours: !!r.by_hours, span: r.hours_span || 570, by: r.updated_by, at: r.updated_at }]));
  S.marks = new Map((marks.data || []).map(m => [m.key, m]));
  S.guess = inferShiftTimes(S.proc, S.reqs);
  S.edits = {};
  S.showShifts = Object.keys(S.guess).some(c => !S.db[c]);           // มีกะที่ยังไม่ยืนยัน → เปิดแผงให้เห็นเลย
  run();
}

// เวลากะที่ใช้ตรวจ: พิมพ์ค้างในแผง > ยืนยันใน DB > ระบบเดา
const shiftFor = c => S.edits[c] || S.db[c] || (S.guess[c]?.start != null ? S.guess[c] : null);
function run() {
  const codes = new Set([...Object.keys(S.db), ...Object.keys(S.guess)]);
  const shifts = {}; for (const c of codes) { const x = shiftFor(c); if (x && x.start != null) shifts[c] = x; }
  const lv = new Map(allEmployees.map(e => [String(e.emp_code).toUpperCase(), e.job_level || ""]));
  S.res = audit(S.proc, S.reqs, c => lv.get(c) || "", S.ym, shifts);
  renderOtAudit();
}

// ---------------------------------------------------------------- แผงเวลากะ
function drawShifts() {
  const el = document.getElementById("otShifts"); if (!el) return;
  const codes = Object.keys(S.guess).sort((a, b) => (S.guess[b].days || 0) - (S.guess[a].days || 0));
  const pending = codes.filter(c => !S.db[c]);
  if (!S.dbOk) { el.innerHTML = `<div class="card card-body" style="background:var(--gold-light);font-size:13px;">⚠️ ยังไม่มีตารางเวลากะ — รัน <b>sql/schema_ot_audit.sql</b> ก่อน ตอนนี้ตรวจด้วยเวลาที่ระบบเดา (บันทึกไม่ได้)</div>`; return; }
  const row = c => {
    const x = shiftFor(c), g = S.guess[c] || {}, conf = !!S.db[c] && !S.edits[c];
    const inp = (f, v) => `<input type="time" class="form-input" data-sc="${esc(c)}" data-f="${f}" value="${tm(v)}" style="width:110px;padding:4px 8px;">`;
    return `<tr${conf ? "" : ' style="background:var(--gold-light);"'}>
      <td><b>${esc(c)}</b></td><td style="text-align:right;">${fmt(g.days || 0)}</td>
      <td>${inp("start", x?.start)}</td><td>${inp("end", x?.end)}${x && x.end >= 1440 ? ` <span class="text-muted" style="font-size:11px;">(+1 วัน)</span>` : ""}</td>
      <td>${inp("b0", x?.brk?.[0])} – ${inp("b1", x?.brk?.[1])}</td>
      <td style="white-space:nowrap;"><label style="cursor:pointer;font-size:13px;"><input type="checkbox" data-sh="${esc(c)}" ${x?.byHours ? "checked" : ""}> นับชั่วโมง</label>
        ${x?.byHours ? `<select class="filter-select" data-span="${esc(c)}" style="margin-left:6px;">
          <option value="510" ${x.span === 510 ? "selected" : ""}>8.5 ชม. (ไม่หักพัก)</option>
          <option value="570" ${x.span !== 510 ? "selected" : ""}>9.5 ชม. (หักพัก 1 ชม.)</option></select>` : ""}</td>
      <td style="font-size:12px;">${conf ? `<span style="color:var(--green);">✓ ยืนยันแล้ว</span>${S.db[c].by ? ` <span class="text-muted">· ${esc(S.db[c].by)}</span>` : ""}`
        : S.edits[c] ? `<span style="color:var(--blue);">แก้แล้ว รอยืนยัน</span>` : `<span style="color:var(--gold-dark);">ระบบเดา — ${S.db[c] ? "" : "<b>กะใหม่</b> · "}${esc(g.basis || "")}</span>`}</td></tr>`;
  };
  el.innerHTML = `<div class="card">
    <div class="card-body" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;border-bottom:1px solid var(--border);">
      <div><div class="card-title" style="margin:0;">เวลากะ ${pending.length ? `<span class="badge badge-gold">ยังไม่ยืนยัน ${pending.length} กะ</span>` : `<span class="badge badge-green">ยืนยันครบ</span>`}</div>
        <div class="text-muted" style="font-size:12px;">ใช้คิดโอทีที่ควรได้ และตรวจว่าชนิดโอทีตรงเวลากะไหม · พัก = ช่วงที่ TigerSoft หักในวันหยุด (เว้นว่าง = ไม่หัก) · เลิกน้อยกว่าเข้า = ข้ามคืน ·
          <b>นับชั่วโมง</b> = นับจากเวลาเข้างานจริง ครบ 8.5 / 9.5 ชม. แล้วที่เกินเป็นโอที (ไม่เกินที่ขอ)</div></div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-sm" id="otShTog">${S.showShifts ? "ซ่อน" : `ดูเวลากะ (${codes.length})`}</button>
        ${S.showShifts && can("data.shiftallow.write") ? `<button class="btn btn-primary btn-sm" id="otShSave">✓ ยืนยันเวลากะ${pending.length || Object.keys(S.edits).length ? ` (${new Set([...pending, ...Object.keys(S.edits)]).size})` : ""}</button>` : ""}
      </div>
    </div>
    ${S.showShifts ? `<div style="overflow:auto;"><table class="data-table"><thead><tr><th>กะ</th><th style="text-align:right;">วันทำงาน</th><th>เข้า</th><th>เลิก</th><th>พัก (วันหยุด)</th><th title="ไม่ดูเวลาตามนาฬิกา — นับจากเวลาเข้างานจริง ครบชั่วโมงงานปกติแล้วที่เกินเป็นโอที (ไม่เกินที่ขอ)">นับชั่วโมง</th><th>สถานะ</th></tr></thead>
      <tbody>${codes.map(row).join("")}</tbody></table></div>` : ""}
  </div>`;
  el.querySelector("#otShTog").onclick = () => { S.showShifts = !S.showShifts; drawShifts(); };
  el.querySelectorAll("[data-sh]").forEach(i => i.onchange = () => {
    const c = i.dataset.sh, cur = { ...(shiftFor(c) || {}) };
    if (cur.start == null || cur.end == null) { toast("ใส่เวลาเข้าและเลิกก่อน", "error"); i.checked = !i.checked; return; }
    S.edits[c] = { ...cur, byHours: i.checked, span: cur.span || 570 }; run();
  });
  el.querySelectorAll("[data-span]").forEach(i => i.onchange = () => {
    const c = i.dataset.span; S.edits[c] = { ...(shiftFor(c) || {}), byHours: true, span: Number(i.value) }; run();
  });
  el.querySelectorAll("[data-sc]").forEach(i => i.onchange = () => {
    const c = i.dataset.sc, cur = { ...(shiftFor(c) || {}) }, v = fromTm(i.value);
    const st = i.dataset.f === "start" ? v : cur.start;
    const norm = m => m == null ? null : (m <= st ? m + 1440 : m);          // เวลาก่อนเข้ากะ = วันถัดไป
    if (i.dataset.f === "start") { cur.start = v; cur.end = cur.end != null ? norm(cur.end % 1440) : null; }
    if (i.dataset.f === "end") cur.end = norm(v);
    const b = cur.brk ? [...cur.brk] : [null, null];
    if (i.dataset.f === "b0") b[0] = norm(v);
    if (i.dataset.f === "b1") b[1] = norm(v);
    cur.brk = b[0] != null && b[1] != null && b[1] > b[0] ? b : (i.dataset.f.startsWith("b") && v == null ? null : cur.brk);
    if (cur.start == null || cur.end == null) { toast("ใส่เวลาเข้าและเลิกให้ครบ", "error"); return; }
    S.edits[c] = cur; run();
  });
  el.querySelector("#otShSave")?.addEventListener("click", saveShifts);
}

async function saveShifts() {
  const codes = [...new Set([...Object.keys(S.guess).filter(c => !S.db[c]), ...Object.keys(S.edits)])];
  const rows = codes.map(c => ({ c, x: shiftFor(c) })).filter(({ x }) => x && x.start != null && x.end != null);
  if (!rows.length) { toast("ไม่มีกะที่ต้องยืนยัน", "info"); return; }
  const bad = codes.filter(c => !rows.some(r => r.c === c));
  if (bad.length) toast(`ข้าม ${bad.join(", ")} — ยังไม่มีเวลาเข้า/เลิก`, "error");
  if (!confirm(`ยืนยันเวลากะ ${rows.length} กะ:\n${rows.map(({ c, x }) => `${c}  ${tm(x.start)}–${tm(x.end)}${x.end >= 1440 ? " (+1)" : ""}${x.brk ? `  พัก ${tm(x.brk[0])}–${tm(x.brk[1])}` : ""}${x.byHours ? `  · นับชั่วโมง ${x.span === 510 ? "8.5 ชม. ไม่หักพัก" : "9.5 ชม. หักพัก 1 ชม."}` : ""}`).join("\n")}`)) return;
  const { error } = await supabase.from("ot_shift_times").upsert(rows.map(({ c, x }) => ({ code: c, start_min: x.start, end_min: x.end,
    break_start: x.brk ? x.brk[0] : null, break_end: x.brk ? x.brk[1] : null, by_hours: !!x.byHours, hours_span: x.byHours ? (x.span || 570) : null,
    updated_by: me(), updated_at: new Date().toISOString() })));
  if (error) { toast("บันทึกเวลากะไม่สำเร็จ: " + error.message + (/by_hours|hours_span/.test(error.message) ? " — รัน sql/schema_ot_audit.sql อีกครั้ง" : ""), "error"); return; }
  toast(`ยืนยันเวลากะ ${rows.length} กะแล้ว`, "success");
  await load();
}

// ---------------------------------------------------------------- ผลตรวจ
const isDone = g => !!S.marks.get(g.key)?.done;
function drawOut() {
  const el = document.getElementById("otOut"); if (!el) return;
  const R = S.res;
  const need = R.issues.filter(i => KINDS[i.kind][1] === "warn"), info = R.issues.filter(i => KINDS[i.kind][1] === "info");
  const withExp = R.days.filter(d => d.expected != null && d.reqs.length), exact = withExp.filter(d => d.diff === 0).length;
  const byKind = k => R.issues.filter(i => i.kind === k);
  const needG = groupIssues(need), q = S.q.trim().toLowerCase();
  const list = (S.kind === "need" ? needG : S.kind === "done" ? groupIssues(R.issues).filter(isDone) : groupIssues(byKind(S.kind)))
    .filter(g => !q || `${g.emp} ${g.name} ${g.issues.map(i => i.text).join(" ")} ${S.marks.get(g.key)?.note || ""}`.toLowerCase().includes(q));
  const stat = (k, v, sub, color = "") => `<div class="card card-body" style="padding:14px 16px;"><div class="text-muted" style="font-size:12px;">${k}</div>
    <div style="font-size:22px;font-weight:700;${color ? `color:${color};` : ""}">${v}</div><div class="text-muted" style="font-size:11.5px;">${sub}</div></div>`;
  const people = new Set(R.requests.map(r => r.emp)).size, pendShift = Object.keys(S.guess).filter(c => !S.db[c]).length;
  el.innerHTML = `
  ${pendShift ? `<div class="card card-body" style="background:var(--gold-light);font-size:13px;margin-bottom:12px;">⚠️ ผลด้านล่างใช้เวลากะที่ระบบเดาสำหรับ ${pendShift} กะ — ตรวจเวลาในแผง "เวลากะ" แล้วกดยืนยัน</div>` : ""}
  ${!S.marksOk ? `<div class="card card-body" style="background:var(--gold-light);font-size:13px;margin-bottom:12px;">⚠️ ยังไม่มีตารางสถานะ — รัน <b>sql/schema_ot_audit.sql</b> แล้วติ๊ก "แก้แล้ว" จะบันทึกให้ทีมเห็นร่วมกัน</div>` : ""}
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;">
    ${stat("คำขอโอที", fmt(R.requests.length), `${fmt(people)} คน · เวลา ${S.ym ? ymTH(S.ym) : "-"}`)}
    ${stat("คิดตรงกับ TigerSoft", withExp.length ? `${Math.round(exact * 100 / withExp.length)}%` : "-", `${fmt(exact)} จาก ${fmt(withExp.length)} คน-วัน`, "var(--green)")}
    ${stat("ต้องตรวจ", fmt(needG.length) + " คน-วัน", `${fmt(need.length)} เรื่อง · แก้แล้ว ${fmt(needG.filter(isDone).length)}`, needG.length ? "var(--red)" : "")}
    ${stat("เตือน", fmt(info.length), "โอทีพักเที่ยง · คำขอซ้อน", "var(--gold-dark)")}
  </div>
  <div class="card mt-4">
    <div class="card-body" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;border-bottom:1px solid var(--border);">
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn btn-sm ${S.kind === "need" ? "btn-primary" : ""}" data-k="need">ต้องตรวจทั้งหมด ${needG.length}</button>
        ${Object.entries(KINDS).map(([k, [t]]) => byKind(k).length ? `<button class="btn btn-sm ${S.kind === k ? "btn-primary" : ""}" data-k="${k}">${t} ${groupIssues(byKind(k)).length}</button>` : "").join("")}
        <button class="btn btn-sm ${S.kind === "done" ? "btn-primary" : ""}" data-k="done">แก้แล้ว ${groupIssues(R.issues).filter(isDone).length}</button>
        <input class="search-input" id="otQ" placeholder="ค้นหารหัส / ชื่อ / เรื่อง / หมายเหตุ" value="${esc(S.q)}" style="min-width:220px;">
      </div>
      <button class="btn btn-gold" id="otExport">📤 Export</button>
    </div>
    <div style="overflow:auto;max-height:70vh;"><table class="data-table"><thead><tr>
      <th style="width:34px;" title="ติ๊กเมื่อแก้ใน TigerSoft แล้ว (ทีมเห็นร่วมกัน)">✓</th><th>รหัส</th><th>ชื่อ</th><th>วันที่</th><th>กะ</th><th>สแกน เข้า–ออก</th><th>คำขอ</th>
      <th style="text-align:right;">TigerSoft</th><th style="text-align:right;">ควรได้</th><th>ต้องตรวจ</th><th>งานที่ทำ / หมายเหตุ HR</th></tr></thead><tbody>
      ${list.map(row).join("") || `<tr><td colspan="11" class="text-muted" style="text-align:center;padding:20px;">ไม่มีรายการ</td></tr>`}
    </tbody></table></div>
  </div>`;
  el.querySelectorAll("[data-k]").forEach(b => b.onclick = () => { S.kind = b.dataset.k; drawOut(); });
  el.querySelector("#otQ").oninput = e => { S.q = e.target.value; drawOut(); const i = document.getElementById("otQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
  el.querySelectorAll("[data-done]").forEach(c => c.onchange = () => mark(c.dataset.done, { done: c.checked }));
  el.querySelectorAll("[data-note]").forEach(b => b.onclick = () => {
    const cur = S.marks.get(b.dataset.note)?.note || "";
    const v = prompt("หมายเหตุ (ทีมเห็นร่วมกัน) เช่น แก้ยอดใน TigerSoft แล้ว / หัวหน้ายืนยันว่าทำจริง", cur);
    if (v !== null) mark(b.dataset.note, { note: v.trim() || null });
  });
  el.querySelector("#otExport").onclick = exportXlsx;
}

async function mark(key, patch) {
  const cur = S.marks.get(key) || { ym: S.ym, key, done: false, note: null };
  const next = { ...cur, ...patch, ym: S.ym, key, by_name: me(), at: new Date().toISOString() };
  S.marks.set(key, next); drawOut();
  if (!S.marksOk) return;
  const { error } = await supabase.from("ot_audit_marks").upsert({ ym: next.ym, key, done: next.done, note: next.note, by_name: next.by_name, at: next.at });
  if (error) { toast("บันทึกสถานะไม่สำเร็จ: " + error.message, "error"); }
}

const reqText = r => `${TYPES[r.typ] || r.typ} · ${IO[r.io] || r.io || "-"} · ${hhmm(r.start)}–${hhmm(r.end)} (${hhmm(r.hours)})`;
function row(g) {
  const t = g.t, ref = t ? t.day : null, m = S.marks.get(g.key), done = !!m?.done, d = g.day;
  const ot = t ? Object.entries(t.ot || {}).filter(([, v]) => v).map(([rate, v]) => `${rate}× ${hhmm(v)}`).join("<br>") : "";
  const texts = [...new Set(g.issues.map(i => `${KINDS[i.kind][1]}|${i.text}`))];
  return `<tr style="${done ? "opacity:.55;" : ""}">
    <td><input type="checkbox" data-done="${esc(g.key)}" ${done ? "checked" : ""} title="${done ? `แก้แล้ว · ${esc(m.by_name || "")}` : "ติ๊กเมื่อแก้ใน TigerSoft แล้ว"}"></td>
    <td>${esc(g.emp)}</td><td style="white-space:nowrap;">${esc(g.name)}</td>
    <td style="white-space:nowrap;">${dTH(g.date)}</td>
    <td style="white-space:nowrap;">${t ? `${esc(t.shift)}${/^H/i.test(t.dayType) ? ` <span class="badge badge-gold">วันหยุด</span>` : ""}` : "-"}</td>
    <td style="white-space:nowrap;">${t && (t.inMin != null || t.outMin != null) ? `${clockOf(t.inMin, ref) || "—"} – ${clockOf(t.outMin, ref) || "—"}` : `<span class="text-muted">ไม่มีสแกน</span>`}</td>
    <td style="font-size:12px;white-space:nowrap;">${g.reqs.map(x => esc(reqText(x))).join("<br>") || `<span class="text-muted">ไม่มีคำขอ</span>`}</td>
    <td style="text-align:right;font-size:12px;white-space:nowrap;">${ot || "0"}</td>
    <td style="text-align:right;font-size:12px;white-space:nowrap;${d && d.expected != null && d.diff ? "font-weight:700;" : ""}">${d && d.expected != null ? hhmm(d.expected) : `<span class="text-muted">—</span>`}</td>
    <td style="font-size:12.5px;min-width:240px;">${texts.map(x => { const p = x.indexOf("|"); return `<div style="color:${x.slice(0, p) === "info" ? "var(--gold-dark)" : "var(--red)"};">• ${esc(x.slice(p + 1))}</div>`; }).join("")}</td>
    <td style="font-size:11.5px;max-width:260px;"><span class="text-muted">${esc([...new Set(g.reqs.map(x => x.note).filter(Boolean))].join(" / "))}</span>
      ${m?.note ? `<div style="color:var(--blue);margin-top:2px;">📝 ${esc(m.note)}${m.by_name ? ` <span class="text-muted">· ${esc(m.by_name)}</span>` : ""}</div>` : ""}
      ${can("data.shiftallow.write") ? `<button class="btn btn-sm" data-note="${esc(g.key)}" style="margin-top:4px;padding:2px 8px;">📝 ${m?.note ? "แก้หมายเหตุ" : "หมายเหตุ"}</button>` : ""}</td></tr>`;
}

function exportXlsx() {
  if (!window.XLSX) { toast("กรุณารอโหลด library", "error"); return; }
  const X = window.XLSX, wb = X.utils.book_new(), R = S.res;
  const base = (g) => { const t = g.t; return { "รหัสพนักงาน": g.emp, "ชื่อ-สกุล": g.name, "วันที่": t ? t.date : g.date,
    "กะ": t?.shift || "", "ประเภทวัน": t?.dayType || "", "สแกนเข้า": t ? clockOf(t.inMin, t.day) : "", "สแกนออก": t ? clockOf(t.outMin, t.day) : "" }; };
  const sheet = gs => gs.map(g => { const t = g.t, m = S.marks.get(g.key);
    return { "แก้แล้ว": m?.done ? "✓" : "", ...base(g), "คำขอ": g.reqs.map(reqText).join(" / "),
      "TigerSoft": hhmm(Object.values(t?.ot || {}).reduce((s, v) => s + v, 0)), "ควรได้": g.day?.expected != null ? hhmm(g.day.expected) : "",
      "ต้องตรวจ": [...new Set(g.issues.map(i => i.text))].join(" · "), "เรื่อง": [...new Set(g.issues.map(i => KINDS[i.kind][0]))].join(", "),
      "งานที่ทำ": [...new Set(g.reqs.map(x => x.note).filter(Boolean))].join(" / "), "หมายเหตุ HR": m?.note || "", "โดย": m?.by_name || "" }; });
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(sheet(groupIssues(R.issues.filter(i => KINDS[i.kind][1] === "warn")))), "ต้องตรวจ");
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(sheet(groupIssues(R.issues.filter(i => KINDS[i.kind][1] === "info")))), "เตือน");
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(R.days.map(d => ({ ...base(d), "จำนวนคำขอ": d.reqs.length, "ยอดที่ขอ (ตัดซ้อน)": hhmm(d.asked),
    "ควรได้": d.expected != null ? hhmm(d.expected) : "", "TigerSoft": hhmm(d.time), "ผลเทียบยอด": d.result }))), "เทียบยอดรายวัน");
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(R.requests.map(r => ({ ...base({ ...r, t: r.t }), "ระดับ": r.lv, "ชนิด": TYPES[r.typ], "รูปแบบ": IO[r.io] || r.io,
    "เริ่ม": hhmm(r.start), "ถึง": hhmm(r.end), "ชั่วโมงที่ขอ": hhmm(r.hours), "สแกนครอบคลุม": hhmm(r.covered), "ผลเวลาสแกน": r.scan, "งานที่ทำ": r.note }))), "ทุกคำขอ");
  const codes = Object.keys(S.guess).sort();
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(codes.map(c => { const x = shiftFor(c);
    return { "กะ": c, "วันทำงาน": S.guess[c].days, "เข้า": tm(x?.start), "เลิก": tm(x?.end) + (x?.end >= 1440 ? " (+1)" : ""), "พัก (วันหยุด)": x?.brk ? `${tm(x.brk[0])}–${tm(x.brk[1])}` : "",
      "นับชั่วโมง": x?.byHours ? (x.span === 510 ? "8.5 ชม. ไม่หักพัก" : "9.5 ชม. หักพัก 1 ชม.") : "",
      "สถานะ": S.db[c] && !S.edits[c] ? "ยืนยันแล้ว" : "ระบบเดา" }; })), "เวลากะ");
  X.writeFile(wb, `ตรวจโอที_${S.ym || ""}.xlsx`);
}
