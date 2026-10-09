// ===== เบี้ยขยัน (Diligence Allowance) =====
// ตรรกะทั้งหมดอยู่ใน diligence-calc.js (มีเทส) — ไฟล์นี้เป็นหน้าจอ: อัปโหลด 3 ไฟล์ → ตรวจ → บันทึก → Export
// ตาราง: sql/schema_diligence.sql · เดือนต่อเนื่องนับจากผลที่ "บันทึก" ของเดือนก่อน จึงต้องบันทึกทีละเดือนตามลำดับ
import { esc, toast, can, allEmployees } from "./app.js";
import { supabase } from "./supabase-config.js";
import { START_YM, MAX_EDIT_DAYS, OFFSITE_DEADLINE_DAY, GROUPS, nextYM, prevYM,
         parseProcessed, parseEdits, parseWebReasons, editDays, evaluate } from "./diligence-calc.js";

const TH_M = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const ymTH = ym => { const [y, m] = ym.split("-").map(Number); return `${TH_M[m - 1]} ${y + 543}`; };
const dTH = iso => `${Number(iso.slice(8))} ${TH_M[Number(iso.slice(5, 7)) - 1]}`;
const fmt = n => Number(n || 0).toLocaleString("en-US");
const empName = e => [e?.firstname_th, e?.lastname_th].filter(Boolean).join(" ") || [e?.firstname_en, e?.lastname_en].filter(Boolean).join(" ");
const defaultYM = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };

// สถานะของหน้า (อยู่ในหน่วยความจำจนกว่าจะบันทึก)
const S = { ym: defaultYM(), files: { proc: null, edit: null, web: null }, proc: null, edits: [], web: new Map(),
            days: [], groupOverride: new Map(), manual: new Map(), prev: new Map(), prevSaved: true,
            results: [], notFound: [], filter: "all", q: "", showAllEdits: false };

const FILES = {
  proc: { label: "1. ข้อมูลหลังประมวล", hint: "รายงานแยกตามพนักงาน (ข้อมูลหลังประมวล)", need: true },
  edit: { label: "2. เพิ่มเวลา", hint: "รายงานข้อมูลดิบเพิ่มเวลา", need: true },
  web:  { label: "3. เพิ่มเวลา-web", hint: "รายงานการลงเวลาผ่านเว็บ — ใช้เอาเหตุผลจริงแทน “HR Approve(web)”", need: false },
};

export function renderDiligence() {
  const pg = document.getElementById("pageDiligence");
  if (!can("page.diligence")) {
    pg.innerHTML = `<div class="empty-state" style="padding-top:80px;"><div class="empty-title">ไม่มีสิทธิ์เข้าถึง</div><div class="empty-sub">เฉพาะ HR และ Admin</div></div>`;
    return;
  }
  pg.innerHTML = `
  <div class="page-header">
    <div><div class="page-heading">เบี้ยขยัน</div><div class="page-sub">ใช้ไฟล์เวลาเดือนที่แล้วจาก TigerSoft คิดเบี้ยขยัน จ่ายพร้อมเงินเดือนงวดถัดไป</div></div>
    <div class="header-actions">
      <button class="btn" id="dgTabCalc">คำนวณ</button>
      <button class="btn" id="dgTabHist">ประวัติที่บันทึก</button>
    </div>
  </div>
  <div id="dgCalc" class="section mt-4 pb-4"></div>
  <div id="dgHist" class="section mt-4 pb-4" style="display:none;"></div>`;
  const tab = t => {
    document.getElementById("dgCalc").style.display = t === "calc" ? "" : "none";
    document.getElementById("dgHist").style.display = t === "hist" ? "" : "none";
    document.getElementById("dgTabCalc").classList.toggle("btn-primary", t === "calc");
    document.getElementById("dgTabHist").classList.toggle("btn-primary", t === "hist");
    if (t === "hist") renderHist();
  };
  document.getElementById("dgTabCalc").onclick = () => tab("calc");
  document.getElementById("dgTabHist").onclick = () => tab("hist");
  tab("calc");
  drawCalc();
}

// ---------------------------------------------------------------- หน้าคำนวณ
function drawCalc() {
  const box = document.getElementById("dgCalc");
  const hidden = 'style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;border:0;overflow:hidden;clip:rect(0 0 0 0);"';
  box.innerHTML = `
  <div class="card card-body">
    <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;">
      <label class="form-group" style="margin:0;"><span class="form-label">เดือนของข้อมูลเวลา</span>
        <input type="month" class="form-input" id="dgYM" value="${S.ym}" min="${START_YM}"></label>
      <div style="font-size:13px;padding-bottom:9px;">→ จ่ายพร้อมเงินเดือนงวด <b>${ymTH(nextYM(S.ym))}</b></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin-top:14px;">
      ${Object.entries(FILES).map(([k, f]) => `<div style="border:1px dashed var(--border);border-radius:10px;padding:10px 12px;">
        <div style="font-weight:600;font-size:13px;">${f.label}${f.need ? "" : ` <span class="text-muted" style="font-weight:400;">(ไม่บังคับ)</span>`}</div>
        <div class="text-muted" style="font-size:11.5px;margin:2px 0 8px;">${f.hint}</div>
        <input type="file" id="dgF_${k}" accept=".xls,.xlsx" ${hidden}>
        <label for="dgF_${k}" class="btn btn-secondary btn-sm" style="cursor:pointer;">📁 เลือกไฟล์</label>
        <span style="font-size:12px;margin-left:6px;">${S.files[k] ? `✅ ${esc(S.files[k])}` : ""}</span></div>`).join("")}
    </div>
    <div class="text-muted" style="font-size:12.5px;line-height:1.8;margin-top:12px;">
      • ได้เฉพาะ <b>พนักงานประจำ ระดับ O และ S</b> ที่อยู่ครบทั้งเดือน และพ้นทดลองงานแล้ว (นับจากวันที่ 1 ของเดือนถัดไป · วันพ้นทดลองงาน = วันเริ่มงาน + 119 วัน)<br>
      • หมดสิทธิ์เมื่อ: ขาด/หักวัน · <b>มาสายหรือออกก่อนแม้ 1 นาที</b> · ลาทุกประเภท <b>ยกเว้นลาพักร้อนและลาหยุดชดเชย</b> ·
        แก้เวลาเกิน <b>${MAX_EDIT_DAYS} วัน</b>/เดือน · ลงเวลานอกสถานที่หลังวันที่ ${OFFSITE_DEADLINE_DAY} ของเดือนถัดไป · HR ตัดสิทธิ์ (พักงาน / อุบัติเหตุ)<br>
      • การแก้เวลาไม่นับ: รปภ./ป้อมสแกนให้ · ไฟดับ · HR เพิ่มให้ · ทำงานนอกสถานที่ (รวม WFH) — <b>ลืมบัตร</b> (แม้เซ็นที่ป้อมยาม) นับ<br>
      • อัตรา: เดือนต่อเนื่องที่ 1–3 = <b>300</b> · 4–6 = <b>600</b> · 7 ขึ้นไป = <b>1,000</b> · ขาดช่วงเริ่มนับ 1 ใหม่ · เริ่มนับเดือนแรก ${ymTH(START_YM)}
    </div>
  </div>
  <div id="dgOut" class="mt-4"></div>`;
  document.getElementById("dgYM").onchange = e => { S.ym = e.target.value || defaultYM(); S.manual.clear(); S.groupOverride.clear(); drawCalc(); recompute(); };
  for (const k of Object.keys(FILES)) document.getElementById(`dgF_${k}`).onchange = e => readFile(k, e.target);
  if (S.proc && S.edits) recompute();
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
      if (kind === "edit") { S.edits = parseEdits(rows); if (!S.edits.length) throw new Error("ไม่พบรายการ ลงเวลา/เพิ่มเวลา — ใช่ไฟล์รายงานข้อมูลดิบเพิ่มเวลาไหม"); }
      if (kind === "web") S.web = parseWebReasons(rows);
      S.files[kind] = file.name;
      // เดาเดือนจากไฟล์หลังประมวล (วันที่ที่พบมากที่สุด)
      if (kind === "proc") {
        const cnt = {}; for (const t of S.proc.values()) for (const d of t.days) cnt[d.date.slice(0, 7)] = (cnt[d.date.slice(0, 7)] || 0) + 1;
        const ym = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0];
        if (ym && ym >= START_YM && ym !== S.ym) { S.ym = ym; S.manual.clear(); S.groupOverride.clear(); toast(`ตั้งเดือนตามไฟล์: ${ymTH(ym)}`, "info"); }
      }
      drawCalc();
    } catch (e) { toast(`${FILES[kind].label}: ${e.message}`, "error"); }
  };
  fr.readAsArrayBuffer(file);
}

async function loadPrev() {
  S.prev = new Map(); S.prevSaved = true;
  if (S.ym <= START_YM) return;
  const p = prevYM(S.ym);
  const [{ data: run }, { data: rows, error }] = await Promise.all([
    supabase.from("diligence_runs").select("ym").eq("ym", p).maybeSingle(),
    supabase.from("diligence_results").select("emp_code,qualified,streak").eq("ym", p),
  ]);
  if (error) { toast("อ่านผลเดือนก่อนไม่ได้: " + error.message + " (รัน sql/schema_diligence.sql แล้วหรือยัง)", "error"); }
  S.prevSaved = !!run;
  for (const r of rows || []) S.prev.set(r.emp_code, r);
}

async function recompute() {
  if (!S.proc || !S.files.edit) { document.getElementById("dgOut").innerHTML = ""; return; }
  await loadPrev();
  S.days = editDays(S.edits, S.ym, S.web).map(d => ({ ...d, auto: d.group, group: S.groupOverride.get(d.key) || d.group }));
  const byEmp = {}; for (const d of S.days) (byEmp[d.emp] ||= []).push(d);
  const emap = new Map(allEmployees.map(e => [String(e.emp_code).toUpperCase(), e]));
  const codes = new Set(S.proc.keys());
  for (const e of allEmployees) if (!e.end_date || String(e.end_date).slice(0, 10) > `${S.ym}-01`) codes.add(String(e.emp_code).toUpperCase());
  S.results = []; S.notFound = [];
  for (const c of codes) {
    const e = emap.get(c);
    if (!e) { S.notFound.push({ code: c, name: S.proc.get(c)?.name || "" }); continue; }
    const r = evaluate({ ym: S.ym, emp: e, t: S.proc.get(c), eds: byEmp[c] || [], manual: S.manual.get(c), prev: S.prev.get(e.emp_code) || null });
    if (!r.inScope) continue;
    S.results.push({ ...r, code: e.emp_code, name: empName(e), department: e.department || "", job_level: e.job_level || "", eds: byEmp[c] || [] });
  }
  S.results.sort((a, b) => a.department.localeCompare(b.department) || a.code.localeCompare(b.code));
  drawOut();
}

function drawOut() {
  const el = document.getElementById("dgOut"); if (!el) return;
  const R = S.results, ok = R.filter(r => r.qualified), flagged = R.filter(r => r.flags.length);
  const total = ok.reduce((s, r) => s + r.amount, 0);
  const tiers = [1, 4, 7].map((from, i) => ok.filter(r => r.streak >= from && r.streak < [4, 7, 1e9][i]).length);
  const warns = [];
  if (S.ym > START_YM && !S.prevSaved) warns.push(`ยังไม่ได้บันทึกเดือน ${ymTH(prevYM(S.ym))} — เดือนต่อเนื่องจะเริ่มนับ 1 ทุกคน และบันทึกเดือนนี้ไม่ได้จนกว่าจะบันทึกเดือนก่อน`);
  if (S.notFound.length) warns.push(`${S.notFound.length} รหัสในไฟล์ไม่พบในทะเบียนพนักงาน: ${S.notFound.slice(0, 6).map(x => esc(x.code)).join(", ")}${S.notFound.length > 6 ? " …" : ""}`);
  const noWeb = S.edits.filter(e => e.date.startsWith(S.ym) && /HR\s*Approve\s*\(web\)/i.test(e.reason) && !S.web.get(`${e.emp}|${e.minute}`)).length;
  if (noWeb) warns.push(`${noWeb} รายการแก้เวลาเขียนแค่ “HR Approve(web)” ${S.files.web ? "และหาเหตุผลในไฟล์ web ไม่เจอ" : "— อัปโหลดไฟล์ 3 เพื่อเอาเหตุผลจริง"} → นับเป็นแก้เวลา`);
  const review = S.days.filter(d => S.showAllEdits || d.group === "check" || (d.group === "count" && !d.reasons.length) || d.group !== d.auto)
                       .filter(d => R.some(r => r.code.toUpperCase() === d.emp));
  const nameOf = c => R.find(r => r.code.toUpperCase() === c)?.name || S.proc.get(c)?.name || "";

  el.innerHTML = `
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;">
    ${stat("อยู่ในขอบเขต", fmt(R.length) + " คน", "พนักงานประจำ O/S ครบเดือน")}
    ${stat("ได้เบี้ยขยัน", fmt(ok.length) + " คน", `300 × ${tiers[0]} · 600 × ${tiers[1]} · 1,000 × ${tiers[2]}`, "var(--green)")}
    ${stat("ยอดรวม", "฿" + fmt(total), `จ่ายงวด ${ymTH(nextYM(S.ym))}`, "var(--green)")}
    ${stat("ไม่ได้", fmt(R.length - ok.length) + " คน", "ดูเหตุผลในตาราง")}
    ${stat("ต้องตรวจ", fmt(flagged.length) + " คน", "สแกนไม่ติด · อุบัติเหตุ · กะไม่ครบ", flagged.length ? "var(--gold-dark)" : "")}
  </div>
  ${warns.length ? `<div class="card card-body mt-4" style="background:var(--gold-light);font-size:13px;line-height:1.8;">${warns.map(w => "⚠️ " + w).join("<br>")}</div>` : ""}

  <div class="card mt-4">
    <div class="card-body" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;border-bottom:1px solid var(--border);">
      <div><div class="card-title" style="margin:0;">การแก้เวลาที่ต้องดู · ${review.length} วัน</div>
        <div class="text-muted" style="font-size:12px;">ระบบจัดกลุ่มจากเหตุผลที่พิมพ์ — เปลี่ยนกลุ่มได้ ผลคำนวณใหม่ทันที · นับวันละ 1 ครั้ง (แก้ทั้งเข้าและออกในวันเดียว = 1)</div></div>
      <label style="font-size:13px;cursor:pointer;"><input type="checkbox" id="dgAllEd" ${S.showAllEdits ? "checked" : ""}> แสดงการแก้เวลาทั้งหมด (${S.days.length} วัน)</label>
    </div>
    ${review.length ? `<div style="max-height:360px;overflow:auto;"><table class="data-table"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>วันที่</th><th>เหตุผล</th><th>ลงเมื่อ</th><th>กลุ่ม</th></tr></thead><tbody>
      ${review.map(d => `<tr><td>${esc(d.emp)}</td><td>${esc(nameOf(d.emp))}</td><td>${dTH(d.date)}</td>
        <td style="max-width:340px;">${d.reasons.length ? esc(d.reasons.join(" / ")) : `<span class="text-muted">(ไม่ระบุเหตุผล)</span>`} <span class="text-muted" style="font-size:11px;">· ${esc(d.types.join("/"))}</span></td>
        <td style="white-space:nowrap;">${d.lastAt ? dTH(d.lastAt) : "-"}</td>
        <td><select class="filter-select" data-g="${esc(d.key)}" style="min-width:170px;">${Object.entries(GROUPS).map(([k, g]) => `<option value="${k}" ${k === d.group ? "selected" : ""}>${g.th}</option>`).join("")}</select>
          ${d.group !== d.auto ? `<span class="badge badge-gold" title="ระบบจัดไว้: ${esc(GROUPS[d.auto].th)}">แก้</span>` : ""}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="card-body text-muted" style="font-size:13px;">ไม่มีรายการที่ต้องดู</div>`}
  </div>

  <div class="card mt-4">
    <div class="card-body" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;border-bottom:1px solid var(--border);">
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${[["all", `ทั้งหมด ${R.length}`], ["ok", `ได้ ${ok.length}`], ["no", `ไม่ได้ ${R.length - ok.length}`], ["flag", `ต้องตรวจ ${flagged.length}`]]
          .map(([k, t]) => `<button class="btn btn-sm ${S.filter === k ? "btn-primary" : ""}" data-f="${k}">${t}</button>`).join("")}
        <input class="search-input" id="dgQ" placeholder="ค้นหารหัส / ชื่อ / แผนก" value="${esc(S.q)}" style="min-width:200px;">
      </div>
      <div style="display:flex;gap:8px;">
        ${can("data.diligence.write") ? `<button class="btn btn-primary" id="dgSave">💾 บันทึก ${ymTH(S.ym)}</button>` : ""}
        <button class="btn btn-gold" id="dgExport">📤 Export</button>
      </div>
    </div>
    <div id="dgTable"></div>
  </div>`;
  el.querySelector("#dgAllEd").onchange = e => { S.showAllEdits = e.target.checked; drawOut(); };
  el.querySelectorAll("[data-g]").forEach(s => s.onchange = () => {
    const d = S.days.find(x => x.key === s.dataset.g);
    if (s.value === d.auto) S.groupOverride.delete(d.key); else S.groupOverride.set(d.key, s.value);
    recompute();
  });
  el.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { S.filter = b.dataset.f; drawOut(); });
  el.querySelector("#dgQ").oninput = e => { S.q = e.target.value; drawTable(); };
  el.querySelector("#dgSave")?.addEventListener("click", save);
  el.querySelector("#dgExport").onclick = () => exportXlsx(S.results, S.ym, S.days);
  drawTable();
}
const stat = (k, v, sub, color = "") => `<div class="card card-body" style="padding:14px 16px;"><div class="text-muted" style="font-size:12px;">${k}</div>
  <div style="font-size:22px;font-weight:700;${color ? `color:${color};` : ""}">${v}</div><div class="text-muted" style="font-size:11.5px;">${sub}</div></div>`;

function drawTable() {
  const q = S.q.trim().toLowerCase();
  const rows = S.results.filter(r => S.filter === "all" || (S.filter === "ok" ? r.qualified : S.filter === "no" ? !r.qualified : r.flags.length))
    .filter(r => !q || `${r.code} ${r.name} ${r.department}`.toLowerCase().includes(q));
  const canW = can("data.diligence.write");
  document.getElementById("dgTable").innerHTML = `<div style="overflow:auto;"><table class="data-table"><thead><tr>
    <th>รหัส</th><th>ชื่อ</th><th>แผนก</th><th>ระดับ</th><th style="text-align:center;">เดือนที่</th><th style="text-align:right;">เบี้ยขยัน</th><th>เหตุผล / ข้อสังเกต</th>${canW ? "<th>HR</th>" : ""}</tr></thead><tbody>
    ${rows.map(r => { const m = S.manual.get(r.code.toUpperCase());
      return `<tr><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td>${esc(r.department)}</td><td>${esc(r.job_level)}</td>
      <td style="text-align:center;">${r.qualified ? r.streak : "-"}</td>
      <td style="text-align:right;font-weight:600;${r.qualified ? "color:var(--green);" : "color:var(--muted);"}">${r.qualified ? fmt(r.amount) : "0"}</td>
      <td style="font-size:12px;max-width:420px;">${r.reasons.map(x => `<div style="color:var(--red);">• ${esc(x)}</div>`).join("")}${r.flags.map(x => `<div style="color:var(--gold-dark);">⚑ ${esc(x)}</div>`).join("")}${!r.reasons.length && !r.flags.length ? `<span class="text-muted">มาครบ${r.editCount ? ` · แก้เวลา ${r.editCount} วัน` : ""}</span>` : ""}</td>
      ${canW ? `<td><select class="filter-select" data-m="${esc(r.code)}">
        <option value="">—</option>
        <option value="deny:พักงาน (ข้อ 4.9)" ${m?.note === "พักงาน (ข้อ 4.9)" ? "selected" : ""}>ตัดสิทธิ์: พักงาน</option>
        <option value="deny:อุบัติเหตุจากความประมาท (ข้อ 4.11)" ${m?.note === "อุบัติเหตุจากความประมาท (ข้อ 4.11)" ? "selected" : ""}>ตัดสิทธิ์: อุบัติเหตุ</option>
        <option value="deny:" ${m?.action === "deny" && !/4\.(9|11)/.test(m.note) ? "selected" : ""}>ตัดสิทธิ์: อื่น ๆ…</option>
        <option value="grant:" ${m?.action === "grant" ? "selected" : ""}>ให้สิทธิ์ (ยกเว้น)…</option></select></td>` : ""}</tr>`; }).join("")
      || `<tr><td colspan="8" class="text-muted" style="text-align:center;padding:20px;">ไม่มีรายการ</td></tr>`}
  </tbody></table></div>`;
  document.querySelectorAll("#dgTable [data-m]").forEach(s => s.onchange = () => {
    const code = s.dataset.m.toUpperCase(), [action, preset] = [s.value.split(":")[0], s.value.slice(s.value.indexOf(":") + 1)];
    if (!action) S.manual.delete(code);
    else {
      const note = preset || prompt(action === "grant" ? "ให้สิทธิ์เพราะอะไร (บันทึกไว้ในผล)" : "ตัดสิทธิ์เพราะอะไร", "");
      if (!note) { drawTable(); return; }
      S.manual.set(code, { action, note });
    }
    recompute();
  });
}

async function save() {
  if (S.ym > START_YM && !S.prevSaved) { toast(`บันทึกเดือน ${ymTH(prevYM(S.ym))} ก่อน`, "error"); return; }
  if (!confirm(`บันทึกเบี้ยขยันเวลา ${ymTH(S.ym)} (จ่ายงวด ${ymTH(nextYM(S.ym))})\n${S.results.filter(r => r.qualified).length} คนได้ · รวม ฿${fmt(S.results.reduce((s, r) => s + r.amount, 0))}\n\nถ้าเคยบันทึกเดือนนี้แล้ว จะแทนที่ของเดิม`)) return;
  const rows = S.results.map(r => ({ code: r.code, name: r.name, department: r.department, job_level: r.job_level, qualified: r.qualified,
    streak: r.streak, amount: r.amount, edit_days: r.editCount, reasons: r.reasons, flags: r.flags, manual: S.manual.get(r.code.toUpperCase()) || null }));
  const { data, error } = await supabase.rpc("diligence_save", { p_ym: S.ym, p_pay_ym: nextYM(S.ym),
    p_files: Object.values(S.files).filter(Boolean), p_rows: rows });
  if (error) { toast("บันทึกไม่สำเร็จ: " + error.message, "error"); return; }
  toast(`บันทึก ${ymTH(S.ym)} แล้ว (${data} คน)`, "success");
}

// ---------------------------------------------------------------- Export
function exportXlsx(results, ym, days = []) {
  if (!window.XLSX) { toast("กรุณารอโหลด library", "error"); return; }
  const X = window.XLSX, wb = X.utils.book_new();
  const pay = results.filter(r => r.qualified).map(r => ({ "รหัสพนักงาน": r.code, "ชื่อ-สกุล": r.name, "แผนก": r.department, "ระดับ": r.job_level,
    "เดือนต่อเนื่อง": r.streak, "เบี้ยขยัน": r.amount }));
  pay.push({ "รหัสพนักงาน": "รวม", "เบี้ยขยัน": pay.reduce((s, r) => s + r["เบี้ยขยัน"], 0) });
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(pay), "จ่าย");
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(results.map(r => ({ "รหัสพนักงาน": r.code, "ชื่อ-สกุล": r.name, "แผนก": r.department, "ระดับ": r.job_level,
    "ได้": r.qualified ? "ได้" : "ไม่ได้", "เดือนต่อเนื่อง": r.streak, "เบี้ยขยัน": r.amount, "แก้เวลา (วัน)": r.editCount ?? r.edit_days,
    "เหตุผล": (r.reasons || []).join(" · "), "ข้อสังเกต": (r.flags || []).join(" · ") }))), "ทั้งหมด");
  if (days.length) X.utils.book_append_sheet(wb, X.utils.json_to_sheet(days.map(d => ({ "รหัสพนักงาน": d.emp, "วันที่": d.date,
    "เหตุผล": d.reasons.join(" / "), "ประเภท": d.types.join("/"), "ลงเมื่อ": d.lastAt, "กลุ่ม": GROUPS[d.group].th, "นับ": GROUPS[d.group].counted ? "นับ" : "" }))), "การแก้เวลา");
  X.writeFile(wb, `เบี้ยขยัน_เวลา${ym}_จ่าย${nextYM(ym)}.xlsx`);
}

// ---------------------------------------------------------------- ประวัติ
async function renderHist(sel) {
  const box = document.getElementById("dgHist");
  const { data: runs, error } = await supabase.from("diligence_runs").select("*").order("ym", { ascending: false });
  if (error) { box.innerHTML = `<div class="card card-body text-muted">อ่านประวัติไม่ได้: ${esc(error.message)} — รัน sql/schema_diligence.sql ก่อน</div>`; return; }
  if (!runs.length) { box.innerHTML = `<div class="card card-body text-muted">ยังไม่มีเดือนที่บันทึก</div>`; return; }
  const ym = sel || runs[0].ym, run = runs.find(r => r.ym === ym);
  const { data: rows } = await supabase.from("diligence_results").select("*").eq("ym", ym).order("department").order("emp_code");
  const R = (rows || []).map(r => ({ ...r, code: r.emp_code, name: r.emp_name }));
  box.innerHTML = `
  <div class="card card-body" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
    <select class="filter-select" id="dgHM">${runs.map(r => `<option value="${r.ym}" ${r.ym === ym ? "selected" : ""}>เวลา ${ymTH(r.ym)} → จ่ายงวด ${ymTH(r.pay_ym)}</option>`).join("")}</select>
    <div style="font-size:13px;">ได้ <b>${run.qualified}</b> / ${run.in_scope} คน · รวม <b style="color:var(--green);">฿${fmt(run.total)}</b>
      <span class="text-muted">· บันทึก ${new Date(run.saved_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}</span></div>
    <div style="margin-left:auto;display:flex;gap:8px;">
      <button class="btn btn-gold" id="dgHX">📤 Export</button>
      ${can("data.diligence.write") && ym === runs[0].ym ? `<button class="btn btn-secondary" id="dgHD" title="ลบได้เฉพาะเดือนล่าสุด">🗑 ลบเดือนนี้</button>` : ""}
    </div>
  </div>
  <div class="card mt-4"><div style="overflow:auto;"><table class="data-table"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>แผนก</th><th>ระดับ</th><th style="text-align:center;">เดือนที่</th><th style="text-align:right;">เบี้ยขยัน</th><th>เหตุผล / ข้อสังเกต</th></tr></thead><tbody>
    ${R.map(r => `<tr><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td>${esc(r.department)}</td><td>${esc(r.job_level)}</td>
      <td style="text-align:center;">${r.qualified ? r.streak : "-"}</td><td style="text-align:right;font-weight:600;">${r.qualified ? fmt(r.amount) : "0"}</td>
      <td style="font-size:12px;">${(r.reasons || []).map(x => `<div style="color:var(--red);">• ${esc(x)}</div>`).join("")}${(r.flags || []).map(x => `<div style="color:var(--gold-dark);">⚑ ${esc(x)}</div>`).join("")}</td></tr>`).join("")}
  </tbody></table></div></div>`;
  box.querySelector("#dgHM").onchange = e => renderHist(e.target.value);
  box.querySelector("#dgHX").onclick = () => exportXlsx(R, ym);
  box.querySelector("#dgHD")?.addEventListener("click", async () => {
    if (!confirm(`ลบผลเบี้ยขยันเวลา ${ymTH(ym)} ทั้งเดือน?`)) return;
    const { error: e } = await supabase.from("diligence_runs").delete().eq("ym", ym);
    if (e) { toast("ลบไม่สำเร็จ: " + e.message, "error"); return; }
    toast("ลบแล้ว", "success"); renderHist();
  });
}
