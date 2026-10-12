// ===== ตรวจโอที =====
// ตรรกะอยู่ใน otaudit-calc.js (มีเทส) — หน้านี้: อัปโหลด 2 ไฟล์ TigerSoft → รายการให้ HR ไปแก้ใน TigerSoft → Export
// ไม่บันทึกลง DB (ผู้ใช้ยืนยัน 2026-10-12) · ติ๊ก "แก้แล้ว" เก็บในเบราว์เซอร์เครื่องนี้เท่านั้น (ไว้ไล่งาน)
import { esc, toast, can, allEmployees } from "./app.js";
import { parseProcessed, parseRequests, audit, TYPES, IO, hhmm, clockOf, SMALL_DIFF, SCAN_TOLERANCE } from "./otaudit-calc.js";

const TH_M = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const ymTH = ym => `${TH_M[+ym.slice(5, 7) - 1]} ${+ym.slice(0, 4) + 543}`;
const dTH = iso => iso ? `${+iso.slice(8)} ${TH_M[+iso.slice(5, 7) - 1]}` : "-";
const fmt = n => Number(n || 0).toLocaleString("en-US");

const KINDS = {
  amount:   ["ยอดไม่ตรง TigerSoft", "warn"],
  scan:     ["เวลาสแกนไม่ครอบคลุม", "warn"],
  wrongday: ["อาจลงวันผิด", "warn"],
  holiday:  ["วันหยุดขอผิดชนิด", "warn"],
  level:    ["ระดับไม่ตรงรูปแบบ (I/O)", "warn"],
  overlap:  ["ขอซ้ำ / ซ้อนกัน", "warn"],
  f01:      ["F01 วันหยุดยังไม่หักพัก", "warn"],
  lunch:    ["โอทีพักเที่ยง (เตือน)", "info"],
};
const S = { files: { proc: null, req: null }, proc: null, reqs: null, res: null, ym: null, kind: "need", q: "" };
const doneKey = () => `otaudit_done_${S.ym}`;
const loadDone = () => { try { return new Set(JSON.parse(localStorage.getItem(doneKey()) || "[]")); } catch (_) { return new Set(); } };
const saveDone = set => { try { localStorage.setItem(doneKey(), JSON.stringify([...set])); } catch (_) { /* โหมดส่วนตัว — ไม่จำก็ได้ */ } };
const issueKey = i => `${i.kind}|${i.req ? `${i.req.emp}|${i.req.date}|${i.req.typ}|${i.req.start}|${i.req.end}` : i.day.key}`;
// รวมเรื่องที่ต้องตรวจเป็น 1 แถวต่อคน-วัน (คำขอเดียวติดหลายเรื่อง ไม่ต้องไล่หลายแถว)
const dayOf = i => i.req ? (i.req.t ? `${i.req.emp}|${i.req.t.day}` : `${i.req.emp}|${i.req.date}`) : i.day.key;
function groupIssues(xs) {
  const m = new Map();
  for (const i of xs) {
    const k = dayOf(i), g = m.get(k) || { key: k, issues: [], reqs: [], t: null, emp: "", name: "", date: "" };
    g.issues.push(i); const src = i.req || i.day;
    g.emp = src.emp; g.name = g.name || src.name || ""; g.t = g.t || (i.req ? i.req.t : i.day.t);
    for (const r of i.req ? [i.req] : i.day.reqs) if (!g.reqs.includes(r)) g.reqs.push(r);
    g.date = g.t ? g.t.date : src.date; m.set(k, g);
  }
  return [...m.values()].sort((a, b) => a.emp.localeCompare(b.emp) || String(a.date).localeCompare(String(b.date)));
}

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
        • ตรวจ: ยอดที่ขอ (ตัดช่วงซ้อน) เทียบ TigerSoft ต่อคน-วัน (ต่างไม่เกิน ${SMALL_DIFF / 60} ชม. = พัก/ปัดเศษ) · เวลาสแกนครอบคลุมช่วงที่ขอ (คลาดได้ ${SCAN_TOLERANCE} นาที) ·
          วันหยุดต้องขอชนิดก่อนเริ่มงาน · ระดับต้องตรงรูปแบบ · คำขอซ้ำ · คำขอที่น่าจะลงวันผิด · กะ F01 วันหยุด OT1 ต้องหักพัก 1 ชม. (8:30) · โอทีพักเที่ยงขึ้นเตือน<br>
        • กะข้ามคืนจับคู่ให้เอง (เช่น กะบ่ายขอ 00:00–06:00 · พักเที่ยงกะดึก 00:30)
      </div>
    </div>
    <div id="otOut" class="mt-4"></div>
  </div>`;
  for (const k of ["proc", "req"]) document.getElementById(`otF_${k}`).onchange = e => readFile(k, e.target);
  if (S.res) drawOut();
}

function readFile(kind, input) {
  const file = input.files?.[0]; input.value = "";
  if (!file) return;
  if (!window.XLSX) { toast("กรุณารอโหลด library", "error"); return; }
  const fr = new FileReader();
  fr.onload = ev => {
    try {
      const wb = window.XLSX.read(new Uint8Array(ev.target.result), { type: "array" });
      const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
      if (kind === "proc") S.proc = parseProcessed(rows);
      else { S.reqs = parseRequests(rows); if (!S.reqs.length) throw new Error("ไม่พบคำขอโอที — ใช่ไฟล์ “รายงานการขอโอทีปกติ” ไหม"); }
      S.files[kind] = file.name;
      run();
    } catch (e) { toast(`${kind === "proc" ? "ข้อมูลหลังประมวล" : "รายงานการขอโอที"}: ${e.message}`, "error"); }
  };
  fr.readAsArrayBuffer(file);
}

function run() {
  if (S.proc) {
    const cnt = {}; for (const t of S.proc.values()) for (const d of t.days) cnt[d.date.slice(0, 7)] = (cnt[d.date.slice(0, 7)] || 0) + 1;
    S.ym = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }
  if (S.proc && S.reqs) {
    const lv = new Map(allEmployees.map(e => [String(e.emp_code).toUpperCase(), e.job_level || ""]));
    S.res = audit(S.proc, S.reqs, c => lv.get(c) || "", S.ym);
  }
  renderOtAudit();
}

function drawOut() {
  const el = document.getElementById("otOut"); if (!el) return;
  const R = S.res, done = loadDone();
  const need = R.issues.filter(i => KINDS[i.kind][1] === "warn"), info = R.issues.filter(i => KINDS[i.kind][1] === "info");
  const ok = R.days.filter(d => /^ตรง$|^ต่างไม่เกิน/.test(d.result)).length;
  const byKind = k => R.issues.filter(i => i.kind === k);
  const q = S.q.trim().toLowerCase();
  const groupDone = g => g.issues.every(i => done.has(issueKey(i)));
  const all = groupIssues(S.kind === "need" ? need : S.kind === "done" ? R.issues : byKind(S.kind));
  const list = all.filter(g => S.kind !== "done" || groupDone(g))
    .filter(g => !q || `${g.emp} ${g.name} ${g.issues.map(i => i.text).join(" ")}`.toLowerCase().includes(q));
  const stat = (k, v, sub, color = "") => `<div class="card card-body" style="padding:14px 16px;"><div class="text-muted" style="font-size:12px;">${k}</div>
    <div style="font-size:22px;font-weight:700;${color ? `color:${color};` : ""}">${v}</div><div class="text-muted" style="font-size:11.5px;">${sub}</div></div>`;
  const people = new Set(R.requests.map(r => r.emp)).size;
  el.innerHTML = `
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;">
    ${stat("คำขอโอที", fmt(R.requests.length), `${fmt(people)} คน · เวลา ${S.ym ? ymTH(S.ym) : "-"}`)}
    ${stat("คน-วัน ที่เทียบยอด", fmt(R.days.length), `ตรง / ต่างไม่เกิน 1 ชม. ${fmt(ok)}`, "var(--green)")}
    ${stat("ต้องตรวจ", fmt(groupIssues(need).length) + " คน-วัน", `${fmt(need.length)} เรื่อง · ติ๊กแก้แล้ว ${fmt(groupIssues(need).filter(groupDone).length)}`, need.length ? "var(--red)" : "")}
    ${stat("เตือน", fmt(info.length), "โอทีพักเที่ยง · คำขอซ้อน", "var(--gold-dark)")}
  </div>
  <div class="card mt-4">
    <div class="card-body" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;border-bottom:1px solid var(--border);">
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn btn-sm ${S.kind === "need" ? "btn-primary" : ""}" data-k="need">ต้องตรวจทั้งหมด ${groupIssues(need).length}</button>
        ${Object.entries(KINDS).map(([k, [t]]) => byKind(k).length ? `<button class="btn btn-sm ${S.kind === k ? "btn-primary" : ""}" data-k="${k}">${t} ${byKind(k).length}</button>` : "").join("")}
        <button class="btn btn-sm ${S.kind === "done" ? "btn-primary" : ""}" data-k="done">แก้แล้ว ${groupIssues(R.issues).filter(groupDone).length}</button>
        <input class="search-input" id="otQ" placeholder="ค้นหารหัส / ชื่อ / เรื่อง" value="${esc(S.q)}" style="min-width:200px;">
      </div>
      <button class="btn btn-gold" id="otExport">📤 Export</button>
    </div>
    <div style="overflow:auto;max-height:70vh;"><table class="data-table"><thead><tr>
      <th style="width:34px;" title="ติ๊กเมื่อแก้ใน TigerSoft แล้ว">✓</th><th>รหัส</th><th>ชื่อ</th><th>วันที่</th><th>กะ</th><th>สแกน เข้า–ออก</th><th>คำขอ</th><th style="text-align:right;">TigerSoft</th><th>ต้องตรวจ</th><th>งานที่ทำ</th></tr></thead><tbody>
      ${list.map(g => row(g, done)).join("") || `<tr><td colspan="10" class="text-muted" style="text-align:center;padding:20px;">ไม่มีรายการ</td></tr>`}
    </tbody></table></div>
  </div>`;
  el.querySelectorAll("[data-k]").forEach(b => b.onclick = () => { S.kind = b.dataset.k; drawOut(); });
  el.querySelector("#otQ").oninput = e => { S.q = e.target.value; drawOut(); const i = document.getElementById("otQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
  el.querySelectorAll("[data-done]").forEach(c => c.onchange = () => {
    const d = loadDone(), g = list.find(x => x.key === c.dataset.done);
    for (const i of g.issues) c.checked ? d.add(issueKey(i)) : d.delete(issueKey(i));
    saveDone(d); drawOut(); });
  el.querySelector("#otExport").onclick = exportXlsx;
}

const reqText = r => `${TYPES[r.typ] || r.typ} · ${IO[r.io] || r.io || "-"} · ${hhmm(r.start)}–${hhmm(r.end)} (${hhmm(r.hours)})`;
function row(g, done) {
  const t = g.t, ref = t ? t.day : null, isDone = g.issues.every(i => done.has(issueKey(i)));
  const ot = t ? Object.entries(t.ot || {}).filter(([, v]) => v).map(([rate, v]) => `${rate}× ${hhmm(v)}`).join("<br>") : "";
  return `<tr style="${isDone ? "opacity:.5;" : ""}">
    <td><input type="checkbox" data-done="${esc(g.key)}" ${isDone ? "checked" : ""} title="ติ๊กเมื่อแก้ใน TigerSoft แล้ว"></td>
    <td>${esc(g.emp)}</td><td style="white-space:nowrap;">${esc(g.name)}</td>
    <td style="white-space:nowrap;">${dTH(g.date)}</td>
    <td style="white-space:nowrap;">${t ? `${esc(t.shift)}${/^H/i.test(t.dayType) ? ` <span class="badge badge-gold">วันหยุด</span>` : ""}` : "-"}</td>
    <td style="white-space:nowrap;">${t && (t.inMin != null || t.outMin != null) ? `${clockOf(t.inMin, ref) || "—"} – ${clockOf(t.outMin, ref) || "—"}` : `<span class="text-muted">ไม่มีสแกน</span>`}</td>
    <td style="font-size:12px;white-space:nowrap;">${g.reqs.map(x => esc(reqText(x))).join("<br>") || `<span class="text-muted">ไม่มีคำขอ</span>`}</td>
    <td style="text-align:right;font-size:12px;white-space:nowrap;">${ot || "0"}</td>
    <td style="font-size:12.5px;min-width:240px;">${[...new Set(g.issues.map(i => `${KINDS[i.kind][1]}|${i.text}`))].map(x => { const [sev, txt] = [x.slice(0, x.indexOf("|")), x.slice(x.indexOf("|") + 1)];
      return `<div style="color:${sev === "info" ? "var(--gold-dark)" : "var(--red)"};">• ${esc(txt)}</div>`; }).join("")}</td>
    <td class="text-muted" style="font-size:11.5px;max-width:240px;">${esc([...new Set(g.reqs.map(x => x.note).filter(Boolean))].join(" / "))}</td></tr>`;
}

function exportXlsx() {
  if (!window.XLSX) { toast("กรุณารอโหลด library", "error"); return; }
  const X = window.XLSX, wb = X.utils.book_new(), R = S.res, done = loadDone();
  const base = (r, d) => { const t = r ? r.t : d.t; return { "รหัสพนักงาน": (r || d).emp, "ชื่อ-สกุล": (r || d).name, "วันที่": t ? t.date : (r || d).date,
    "กะ": t?.shift || "", "ประเภทวัน": t?.dayType || "", "สแกนเข้า": t ? clockOf(t.inMin, t.day) : "", "สแกนออก": t ? clockOf(t.outMin, t.day) : "" }; };
  const issueRows = xs => xs.map(i => { const reqs = i.req ? [i.req] : i.day.reqs, t = i.req ? i.req.t : i.day.t;
    return { "เรื่อง": KINDS[i.kind][0], "แก้แล้ว": done.has(issueKey(i)) ? "✓" : "", ...base(i.req, i.day), "คำขอ": reqs.map(reqText).join(" / "),
      "TigerSoft โอทีรวม": hhmm(Object.values(t?.ot || {}).reduce((s, v) => s + v, 0)), "ต้องตรวจ": i.text, "งานที่ทำ": reqs.map(x => x.note).filter(Boolean).join(" / ") }; });
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(issueRows(R.issues.filter(i => KINDS[i.kind][1] === "warn"))), "ต้องตรวจ");
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(issueRows(R.issues.filter(i => KINDS[i.kind][1] === "info"))), "เตือน");
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(R.days.map(d => ({ ...base(null, d), "ยอดที่ขอ (ตัดซ้อน)": hhmm(d.asked), "TigerSoft": hhmm(d.time),
    "ส่วนต่าง": hhmm(d.diff), "ผลเทียบยอด": d.result, "จำนวนคำขอ": d.reqs.length }))), "เทียบยอดรายวัน");
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(R.requests.map(r => ({ ...base(r, null), "ระดับ": r.lv, "ชนิด": TYPES[r.typ], "รูปแบบ": IO[r.io] || r.io,
    "เริ่ม": hhmm(r.start), "ถึง": hhmm(r.end), "ชั่วโมงที่ขอ": hhmm(r.hours), "สแกนครอบคลุม": hhmm(r.covered), "ผลเวลาสแกน": r.scan, "งานที่ทำ": r.note }))), "ทุกคำขอ");
  X.writeFile(wb, `ตรวจโอที_${S.ym || ""}.xlsx`);
}
