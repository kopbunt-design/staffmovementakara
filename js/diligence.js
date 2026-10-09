// ===== เบี้ยขยัน (Diligence Allowance) =====
// ตรรกะทั้งหมดอยู่ใน diligence-calc.js (มีเทส) — ไฟล์นี้เป็นหน้าจอ: อัปโหลด 3 ไฟล์ → ตรวจ → บันทึก → Export
// ตาราง: sql/schema_diligence.sql · เดือนต่อเนื่องนับจากผลที่ "บันทึก" ของเดือนก่อน จึงต้องบันทึกทีละเดือนตามลำดับ
import { esc, toast, can, allEmployees, currentUser } from "./app.js";
import { supabase } from "./supabase-config.js";
import { START_YM, MAX_EDIT_DAYS, OFFSITE_DEADLINE_DAY, GROUPS, nextYM, prevYM, manualAmount, applyHistEdit,
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
            results: [], notFound: [], filter: "all", q: "", showAllEdits: false, restoredFor: null, restored: null };

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
      • การแก้เวลาไม่นับ: รปภ./ป้อมสแกนให้ · ไฟดับ · HR เพิ่มให้ · ทำงานนอกสถานที่ (รวม WFH) · <b>ขาเข้าสแกนแล้ว ลงเวลาขาออกเอง</b> (ยกเว้นเหตุลืมบัตร) · <b>วันหยุด</b> (มาทำโอที — วันหยุดไม่เอามาคิดเลย ทั้งสาย ลา แก้เวลา) — <b>ลงเวลาขาเข้าเอง</b> (ลืมบัตร ฯลฯ แม้เซ็นที่ป้อมยาม) นับ · <b>ลืมบัตรทั้งวัน = 1 ครั้ง</b> · ลืมบัตรขาเดียว = นับ 1 ครั้ง + ⚑ น่าสงสัย ให้ HR ตัดสิน<br>
      • อัตรา: เดือนต่อเนื่องที่ 1–3 = <b>300</b> · 4–6 = <b>600</b> · 7 ขึ้นไป = <b>1,000</b> · ขาดช่วงเริ่มนับ 1 ใหม่ · เริ่มนับเดือนแรก ${ymTH(START_YM)}
    </div>
  </div>
  <div id="dgOut" class="mt-4"></div>`;
  document.getElementById("dgYM").onchange = e => { S.ym = e.target.value || defaultYM(); resetEdits(); drawCalc(); recompute(); };
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
        if (ym && ym >= START_YM && ym !== S.ym) { S.ym = ym; resetEdits(); toast(`ตั้งเดือนตามไฟล์: ${ymTH(ym)}`, "info"); }
      }
      drawCalc();
    } catch (e) { toast(`${FILES[kind].label}: ${e.message}`, "error"); }
  };
  fr.readAsArrayBuffer(file);
}

const resetEdits = () => { S.manual.clear(); S.groupOverride.clear(); S.restoredFor = null; S.restored = null; };

// เดือนที่เคยบันทึกแล้ว: ดึงการแก้ของ HR (รายคน + กลุ่มการแก้เวลา) กลับมาใช้ต่อ — อัปโหลดไฟล์ใหม่ไม่ต้องแก้ซ้ำ
// ดึงครั้งเดียวต่อเดือน และไม่ทับสิ่งที่แก้ในหน้านี้ไปแล้ว
async function restoreSaved() {
  if (S.restoredFor === S.ym) return;
  S.restoredFor = S.ym; S.restored = null;
  const [{ data: run }, { data: rows }] = await Promise.all([
    supabase.from("diligence_runs").select("edit_groups,saved_at").eq("ym", S.ym).maybeSingle(),
    supabase.from("diligence_results").select("emp_code,manual").eq("ym", S.ym).not("manual", "is", null),
  ]);
  if (!run) return;
  let people = 0, days = 0;
  for (const r of rows || []) if (r.manual && !S.manual.has(String(r.emp_code).toUpperCase())) { S.manual.set(String(r.emp_code).toUpperCase(), r.manual); people++; }
  for (const [k, g] of Object.entries(run.edit_groups || {})) if (GROUPS[g] && !S.groupOverride.has(k)) { S.groupOverride.set(k, g); days++; }
  S.restored = { people, days, at: run.saved_at };
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
  await Promise.all([loadPrev(), restoreSaved()]);
  S.days = editDays(S.edits, S.ym, S.web, S.proc).map(d => ({ ...d, auto: d.group, group: S.groupOverride.get(d.key) || d.group }));
  const byEmp = {}; for (const d of S.days) (byEmp[d.emp] ||= []).push(d);
  const emap = new Map(allEmployees.map(e => [String(e.emp_code).toUpperCase(), e]));
  const codes = new Set(S.proc.keys());
  for (const e of allEmployees) if (!e.end_date || String(e.end_date).slice(0, 10) > `${S.ym}-01`) codes.add(String(e.emp_code).toUpperCase());
  S.results = []; S.notFound = [];
  for (const c of codes) {
    const e = emap.get(c);
    if (!e) { S.notFound.push({ code: c, name: S.proc.get(c)?.name || "" }); continue; }
    const args = { ym: S.ym, emp: e, t: S.proc.get(c), eds: byEmp[c] || [], prev: S.prev.get(e.emp_code) || null };
    const r = evaluate({ ...args, manual: S.manual.get(c) });
    if (!r.inScope) continue;
    const auto = S.manual.has(c) ? evaluate(args) : r;          // ผลที่ระบบคิดเอง ก่อน HR แก้
    S.results.push({ ...r, code: e.emp_code, name: empName(e), department: e.department || "", job_level: e.job_level || "", eds: byEmp[c] || [],
                     autoQualified: auto.qualified, autoAmount: auto.amount, manual: S.manual.get(c) || null });
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
  if (S.restored && (S.restored.people || S.restored.days)) warns.push(`ดึงการแก้ไขของ HR จากที่บันทึกไว้ (${new Date(S.restored.at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}) มาใช้ต่อแล้ว: แก้รายคน ${S.restored.people} คน · กลุ่มการแก้เวลา ${S.restored.days} วัน — ไม่ต้องแก้ซ้ำ`);
  if (S.notFound.length) warns.push(`${S.notFound.length} รหัสในไฟล์ไม่พบในทะเบียนพนักงาน: ${S.notFound.slice(0, 6).map(x => esc(x.code)).join(", ")}${S.notFound.length > 6 ? " …" : ""}`);
  const noWeb = S.edits.filter(e => e.date.startsWith(S.ym) && /HR\s*Approve\s*\(web\)/i.test(e.reason) && !S.web.get(`${e.emp}|${e.minute}`)).length;
  if (noWeb) warns.push(`${noWeb} รายการแก้เวลาเขียนแค่ “HR Approve(web)” ${S.files.web ? "และหาเหตุผลในไฟล์ web ไม่เจอ" : "— อัปโหลดไฟล์ 3 เพื่อเอาเหตุผลจริง"} → นับเป็นแก้เวลา`);
  // ต้องดู = วันที่ HR ต้องตัดสิน: สแกนไม่ติด (ยืนยันว่าฝั่งบริษัท) · ลืมบัตรขาเดียว · ลงขาเข้าเองด้วยเหตุอื่น (เสี่ยงซ่อนการมาสาย) · HR เปลี่ยนกลุ่มไว้
  //   ลืมบัตรทั้งวัน (เข้า+ออก) เป็นเรื่องปกติ นับ 1 ครั้ง ไม่ต้องดู
  const why = d => d.group !== d.auto ? "HR เปลี่ยนกลุ่ม" : d.group === "check" ? "สแกนไม่ติด — ยืนยันว่าฝั่งบริษัท"
    : d.oneLegForgot ? `ลืมบัตรขาเดียว (${d.oneLegForgot === "in" ? "ขาเข้า" : "ขาออก"})`
    : d.group === "count" && !(d.forgot || []).length ? "ลงเวลาขาเข้าเอง — ดูว่ามาสายไหม" : "";
  const review = S.days.filter(d => S.showAllEdits || why(d))
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
  ${warns.length ? `<div class="card card-body mt-4" style="background:var(--gold-light);font-size:13px;line-height:1.8;">${warns.map(w => (w.startsWith("ดึงการแก้ไข") ? "✅ " : "⚠️ ") + w).join("<br>")}</div>` : ""}

  <div class="card mt-4">
    <div class="card-body" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;border-bottom:1px solid var(--border);">
      <div><div class="card-title" style="margin:0;">การแก้เวลาที่ต้องดู · ${review.length} วัน</div>
        <div class="text-muted" style="font-size:12px;">ระบบจัดกลุ่มจากเหตุผลที่พิมพ์ — เปลี่ยนกลุ่มได้ ผลคำนวณใหม่ทันที · นับวันละ 1 ครั้ง · <b>นับเฉพาะวันที่ลงเวลาขาเข้าเอง</b> (ระวังมาสายแล้วไม่สแกน มาลงเวลาทีหลัง) — ขาเข้าสแกนแล้วลงขาออกเอง ไม่นับ</div></div>
      <label style="font-size:13px;cursor:pointer;"><input type="checkbox" id="dgAllEd" ${S.showAllEdits ? "checked" : ""}> แสดงการแก้เวลาทั้งหมด (${S.days.length} วัน)</label>
    </div>
    ${review.length ? `<div style="max-height:360px;overflow:auto;"><table class="data-table"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>วันที่</th><th>ต้องดูเพราะ</th><th>ขาที่ลงเอง</th><th>เหตุผล</th><th>ลงเมื่อ</th><th>กลุ่ม</th></tr></thead><tbody>
      ${review.map(d => `<tr><td>${esc(d.emp)}</td><td>${esc(nameOf(d.emp))}</td><td>${dTH(d.date)}</td>
        <td style="font-size:12px;color:var(--gold-dark);">${esc(why(d)) || `<span class="text-muted">—</span>`}</td>
        <td style="white-space:nowrap;">${(d.legs || []).map(l => l === "in" ? `<b style="color:var(--red);">เข้า</b>` : l === "out" ? "ออก" : `<span class="text-muted">ไม่ได้ใช้</span>`).join(" + ")}
</td>
        <td style="max-width:340px;">${d.reasons.length ? esc(d.reasons.join(" / ")) : `<span class="text-muted">(ไม่ระบุเหตุผล)</span>`} <span class="text-muted" style="font-size:11px;">· ${esc(d.types.join("/"))}</span></td>
        <td style="white-space:nowrap;">${d.lastAt ? dTH(d.lastAt) : "-"}</td>
        <td><select class="filter-select" data-g="${esc(d.key)}" style="min-width:170px;">${Object.entries(GROUPS).map(([k, g]) => `<option value="${k}" ${k === d.group ? "selected" : ""}>${g.th}</option>`).join("")}</select>
          ${d.group !== d.auto ? `<span class="badge badge-gold" title="ระบบจัดไว้: ${esc(GROUPS[d.auto].th)}">แก้</span>` : ""}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="card-body text-muted" style="font-size:13px;">ไม่มีรายการที่ต้องดู</div>`}
  </div>

  <div class="card mt-4">
    <div class="card-body" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;border-bottom:1px solid var(--border);">
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${[["all", `ทั้งหมด ${R.length}`], ["ok", `ได้ ${ok.length}`], ["no", `ไม่ได้ ${R.length - ok.length}`], ["flag", `ต้องตรวจ ${flagged.length}`], ["edit", `แก้ไขแล้ว ${R.filter(r => r.manual).length}`]]
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

// ช่องยอดเงิน: แก้แล้วขีดฆ่ายอดที่ระบบคิด · กดเพื่อแก้ (แบบหน้าค่ากะ)
function amountCell(r, onclick) {
  const changed = r.manual && (r.amount !== r.autoAmount || r.qualified !== r.autoQualified);
  const inner = `${changed ? `<span class="sa-struck">${fmt(r.autoAmount)}</span> ` : ""}<b style="color:${changed ? "var(--gold-dark)" : r.qualified ? "var(--green)" : "var(--muted)"};">${r.qualified ? fmt(r.amount) : "0"}</b>`;
  return onclick ? `<button class="sa-edit-cell" data-edit="${esc(r.code)}" title="กดเพื่อแก้">${inner}<span class="sa-pencil">✎</span></button>` : inner;
}
const reasonsCell = r => `${(r.reasons || []).map(x => `<div style="color:var(--red);">• ${esc(x)}</div>`).join("")}${(r.flags || []).filter(x => !/^HR (ให้สิทธิ์|กำหนดยอด)/.test(x)).map(x => `<div style="color:var(--gold-dark);">⚑ ${esc(x)}</div>`).join("")}${r.manual ? `<div style="color:var(--blue);">✎ ${esc(manualText(r.manual))}</div>` : ""}${!(r.reasons || []).length && !(r.flags || []).length && !r.manual ? `<span class="text-muted">มาครบ${r.editCount ?? r.edit_days ? ` · แก้เวลา ${r.editCount ?? r.edit_days} วัน` : ""}</span>` : ""}`;
const manualText = m => [m.action === "grant" ? "ให้สิทธิ์" : m.action === "deny" ? "ตัดสิทธิ์" : "", manualAmount(m) != null ? `ยอด ${fmt(manualAmount(m))}` : "", m.note].filter(Boolean).join(" · ") + (m.by ? ` (${m.by})` : "");

function drawTable() {
  const q = S.q.trim().toLowerCase();
  const rows = S.results.filter(r => S.filter === "all" || (S.filter === "ok" ? r.qualified : S.filter === "no" ? !r.qualified : S.filter === "edit" ? r.manual : r.flags.length))
    .filter(r => !q || `${r.code} ${r.name} ${r.department}`.toLowerCase().includes(q));
  const canW = can("data.diligence.write");
  document.getElementById("dgTable").innerHTML = `<div style="overflow:auto;"><table class="data-table"><thead><tr>
    <th>รหัส</th><th>ชื่อ</th><th>แผนก</th><th>ระดับ</th><th style="text-align:center;">เดือนที่</th><th style="text-align:right;">เบี้ยขยัน</th><th>เหตุผล / ข้อสังเกต</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td>${esc(r.department)}</td><td>${esc(r.job_level)}</td>
      <td style="text-align:center;">${r.qualified ? r.streak : "-"}</td>
      <td style="text-align:right;white-space:nowrap;">${amountCell(r, canW)}</td>
      <td style="font-size:12px;max-width:440px;">${reasonsCell(r)}</td></tr>`).join("")
      || `<tr><td colspan="7" class="text-muted" style="text-align:center;padding:20px;">ไม่มีรายการ</td></tr>`}
  </tbody></table></div>`;
  document.querySelectorAll("#dgTable [data-edit]").forEach(b => b.onclick = () => {
    const r = S.results.find(x => x.code === b.dataset.edit);
    editModal(r, ymTH(S.ym), m => { if (m) S.manual.set(r.code.toUpperCase(), m); else S.manual.delete(r.code.toUpperCase()); recompute(); });
  });
}

// ---------------------------------------------------------------- หน้าต่างแก้ไข (ใช้ทั้งหน้าคำนวณและประวัติ)
// คืน manual = { action: "" | "grant" | "deny", amount: null | ตัวเลข, note, by, at } หรือ null (ล้างการแก้ไข)
function editModal(r, monthLabel, onApply) {
  const m = r.manual || {};
  const portal = document.getElementById("modalPortal");
  const presets = ["พักงาน (ข้อ 4.9)", "อุบัติเหตุจากความประมาท (ข้อ 4.11)", "มาทำงานจริง ไฟล์เวลาผิด", "ผู้บริหารอนุมัติเป็นกรณีพิเศษ"];
  portal.innerHTML = `<div class="modal-overlay" id="dgEditModal"><div class="modal" style="max-width:520px;">
    <div class="modal-header"><div><div class="modal-title">แก้ไขเบี้ยขยัน</div>
      <div class="text-sm text-muted">${esc(r.code)} · ${esc(r.name)} · เวลา ${esc(monthLabel)}</div></div>
      <button class="modal-close" data-x>×</button></div>
    <div class="modal-body">
      <div class="sa-edit-calc"><div><div class="sa-edit-l">ผลที่ระบบคิด</div>
        <div class="sa-edit-n">${r.autoQualified ? `ได้ ${fmt(r.autoAmount)}` : "ไม่ได้"}</div></div>
        <div class="text-sm text-muted" style="text-align:right;line-height:1.5;max-width:260px;">${(r.reasons || []).filter(x => !x.startsWith("HR ")).slice(0, 3).map(esc).join("<br>") || "มาครบ"}</div></div>
      <div class="form-group" style="margin-top:14px;"><label class="form-label">ผล</label>
        <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:14px;">
          ${[["", "ตามที่ระบบคิด"], ["grant", "ให้สิทธิ์ (ได้)"], ["deny", "ตัดสิทธิ์ (ไม่ได้)"]].map(([v, t]) => `<label style="cursor:pointer;"><input type="radio" name="dgAct" value="${v}" ${(m.action || "") === v ? "checked" : ""}> ${t}</label>`).join("")}
        </div></div>
      <div class="form-group" style="margin-top:14px;"><label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="dgFix" style="width:auto;margin:0;" ${manualAmount(m) != null ? "checked" : ""}> กำหนดยอดเอง (บาท)</label>
        <input id="dgAmt" type="number" min="0" step="1" class="form-input" value="${manualAmount(m) ?? (r.qualified ? r.amount : 300)}" ${manualAmount(m) != null ? "" : "disabled"}>
        <div class="text-sm text-muted mt-1">ปกติไม่ต้องกำหนด — ระบบใช้อัตราตามเดือนต่อเนื่อง (300 / 600 / 1,000) · ยอด 0 = ไม่จ่ายเดือนนี้ แต่ยังนับเดือนต่อเนื่อง</div></div>
      <div class="form-group" style="margin-top:14px;"><label class="form-label">เหตุผล *</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">${presets.map(p => `<button class="btn btn-sm" data-p="${esc(p)}">${esc(p)}</button>`).join("")}</div>
        <textarea id="dgNote" class="form-input" rows="2" placeholder="บังคับกรอก — ให้รู้ภายหลังว่าทำไมผลไม่ตรงกับที่ระบบคิด">${esc(m.note || "")}</textarea></div>
    </div>
    <div class="modal-footer">
      ${r.manual ? `<button class="btn btn-secondary" data-clear style="margin-right:auto;color:var(--red);">ล้างการแก้ไข</button>` : ""}
      <button class="btn btn-secondary" data-x>ยกเลิก</button><button class="btn btn-primary" data-ok>ตกลง</button></div>
  </div></div>`;
  const el = document.getElementById("dgEditModal"), close = () => el.remove();
  el.querySelectorAll("[data-x]").forEach(b => b.onclick = close);
  el.querySelector("#dgFix").onchange = e => { el.querySelector("#dgAmt").disabled = !e.target.checked; };
  el.querySelectorAll("[data-p]").forEach(b => b.onclick = () => { el.querySelector("#dgNote").value = b.dataset.p; });
  el.querySelector("[data-clear]")?.addEventListener("click", () => { close(); onApply(null); });
  el.querySelector("[data-ok]").onclick = () => {
    const action = el.querySelector("[name=dgAct]:checked")?.value || "";
    const amount = el.querySelector("#dgFix").checked ? Number(el.querySelector("#dgAmt").value) : null;
    const note = el.querySelector("#dgNote").value.trim();
    if (!action && amount == null) { close(); onApply(null); return; }
    if (amount != null && !(amount >= 0)) { toast("ยอดเงินไม่ถูกต้อง", "error"); return; }
    if (!note) { toast("กรุณาใส่เหตุผล", "error"); return; }
    close();
    onApply({ action, amount, note, by: currentUser?.user_metadata?.full_name || currentUser?.email || "", at: new Date().toISOString() });
  };
}

async function save() {
  if (S.ym > START_YM && !S.prevSaved) { toast(`บันทึกเดือน ${ymTH(prevYM(S.ym))} ก่อน`, "error"); return; }
  if (!confirm(`บันทึกเบี้ยขยันเวลา ${ymTH(S.ym)} (จ่ายงวด ${ymTH(nextYM(S.ym))})\n${S.results.filter(r => r.qualified).length} คนได้ · รวม ฿${fmt(S.results.reduce((s, r) => s + (r.qualified ? r.amount : 0), 0))}\n\nถ้าเคยบันทึกเดือนนี้แล้ว จะแทนที่ของเดิม`)) return;
  const rows = S.results.map(r => ({ code: r.code, name: r.name, department: r.department, job_level: r.job_level, qualified: r.qualified,
    streak: r.streak, amount: r.qualified ? r.amount : 0, edit_days: r.editCount, reasons: r.reasons, flags: r.flags, manual: r.manual,
    auto_qualified: r.autoQualified, auto_amount: r.autoAmount }));
  const { data, error } = await supabase.rpc("diligence_save", { p_ym: S.ym, p_pay_ym: nextYM(S.ym),
    p_files: Object.values(S.files).filter(Boolean), p_rows: rows, p_groups: Object.fromEntries(S.groupOverride) });
  if (error) { toast("บันทึกไม่สำเร็จ: " + error.message + (/auto_|function/.test(error.message) ? " — รัน sql/schema_diligence.sql ล่าสุดก่อน" : ""), "error"); return; }
  toast(`บันทึก ${ymTH(S.ym)} แล้ว (${data} คน)`, "success");
}

// ---------------------------------------------------------------- Export
function exportXlsx(results, ym, days = []) {
  if (!window.XLSX) { toast("กรุณารอโหลด library", "error"); return; }
  const X = window.XLSX, wb = X.utils.book_new();
  const pay = results.filter(r => r.qualified && Number(r.amount) > 0).map(r => ({ "รหัสพนักงาน": r.code, "ชื่อ-สกุล": r.name, "แผนก": r.department, "ระดับ": r.job_level,
    "เดือนต่อเนื่อง": r.streak, "เบี้ยขยัน": r.amount }));
  pay.push({ "รหัสพนักงาน": "รวม", "เบี้ยขยัน": pay.reduce((s, r) => s + r["เบี้ยขยัน"], 0) });
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(pay), "จ่าย");
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(results.map(r => ({ "รหัสพนักงาน": r.code, "ชื่อ-สกุล": r.name, "แผนก": r.department, "ระดับ": r.job_level,
    "ได้": r.qualified ? "ได้" : "ไม่ได้", "เดือนต่อเนื่อง": r.streak, "เบี้ยขยัน": r.qualified ? r.amount : 0,
    "ระบบคิด": (r.autoQualified ?? r.auto_qualified ?? r.qualified) ? (r.autoAmount ?? r.auto_amount ?? r.amount) : 0,
    "HR แก้ไข": r.manual ? manualText(r.manual) : "", "แก้เวลา (วัน)": r.editCount ?? r.edit_days,
    "เหตุผล": (r.reasons || []).join(" · "), "ข้อสังเกต": (r.flags || []).join(" · ") }))), "ทั้งหมด");
  if (days.length) X.utils.book_append_sheet(wb, X.utils.json_to_sheet(days.map(d => ({ "รหัสพนักงาน": d.emp, "วันที่": d.date,
    "ขาที่ลงเอง": (d.legs || []).map(l => ({ in: "เข้า", out: "ออก", none: "ไม่ได้ใช้" }[l] || l)).join("+"),
    "เหตุผล": d.reasons.join(" / "), "ประเภท": d.types.join("/"), "ลงเมื่อ": d.lastAt, "กลุ่ม": GROUPS[d.group].th, "นับ": GROUPS[d.group].counted ? "นับ" : "" }))), "การแก้เวลา");
  X.writeFile(wb, `เบี้ยขยัน_เวลา${ym}_จ่าย${nextYM(ym)}.xlsx`);
}

// ---------------------------------------------------------------- ประวัติ (ดู / แก้ไขเดือนที่บันทึกแล้ว)
// แก้ได้: ได้/ไม่ได้ และยอดเงิน — ไม่มีไฟล์เวลาแล้ว จึงคำนวณใหม่จากผลที่ระบบคิดไว้ (auto_*) + การแก้ของ HR
// เปลี่ยนได้/ไม่ได้ไม่ได้ถ้าเดือนถัดไปบันทึกแล้ว (เดือนต่อเนื่องของเดือนหลังนับจากเดือนนี้) — DB บังคับซ้ำใน diligence_edit
const H = { ym: null, rows: [], prev: new Map(), later: false, edits: new Map(), q: "", filter: "all" };

async function renderHist(sel) {
  const box = document.getElementById("dgHist");
  const { data: runs, error } = await supabase.from("diligence_runs").select("*").order("ym", { ascending: false });
  if (error) { box.innerHTML = `<div class="card card-body text-muted">อ่านประวัติไม่ได้: ${esc(error.message)} — รัน sql/schema_diligence.sql ก่อน</div>`; return; }
  if (!runs.length) { box.innerHTML = `<div class="card card-body text-muted">ยังไม่มีเดือนที่บันทึก</div>`; return; }
  const ym = sel || (runs.some(r => r.ym === H.ym) ? H.ym : runs[0].ym);
  if (ym !== H.ym) H.edits.clear();
  const [{ data: rows }, { data: prev }] = await Promise.all([
    supabase.from("diligence_results").select("*").eq("ym", ym).order("department").order("emp_code"),
    ym > START_YM ? supabase.from("diligence_results").select("emp_code,qualified,streak").eq("ym", prevYM(ym)) : Promise.resolve({ data: [] }),
  ]);
  Object.assign(H, { ym, runs, later: runs.some(r => r.ym > ym), prev: new Map((prev || []).map(p => [p.emp_code, p])),
    rows: (rows || []).map(r => ({ ...r, code: r.emp_code, name: r.emp_name })) });
  drawHist();
}

// แถวที่แสดง = แถวใน DB + การแก้ที่ยังไม่บันทึก
const histView = r => {
  if (!H.edits.has(r.code)) return { ...r, autoQualified: r.auto_qualified ?? r.qualified, autoAmount: r.auto_amount ?? r.amount };
  const m = H.edits.get(r.code), x = applyHistEdit(r, m, H.prev.get(r.code));
  return { ...r, ...x, manual: m, autoQualified: r.auto_qualified ?? r.qualified, autoAmount: r.auto_amount ?? r.amount, pending: true };
};

function drawHist() {
  const box = document.getElementById("dgHist"), run = H.runs.find(r => r.ym === H.ym), canW = can("data.diligence.write");
  const V = H.rows.map(histView), ok = V.filter(r => r.qualified), total = ok.reduce((s, r) => s + Number(r.amount || 0), 0);
  const q = H.q.trim().toLowerCase();
  const list = V.filter(r => H.filter === "all" || (H.filter === "ok" ? r.qualified : H.filter === "no" ? !r.qualified : r.manual))
                .filter(r => !q || `${r.code} ${r.name} ${r.department}`.toLowerCase().includes(q));
  box.innerHTML = `
  <div class="card card-body" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
    <select class="filter-select" id="dgHM">${H.runs.map(r => `<option value="${r.ym}" ${r.ym === H.ym ? "selected" : ""}>เวลา ${ymTH(r.ym)} → จ่ายงวด ${ymTH(r.pay_ym)}</option>`).join("")}</select>
    <div style="font-size:13px;">ได้ <b>${ok.length}</b> / ${V.length} คน · รวม <b style="color:var(--green);">฿${fmt(total)}</b>
      <span class="text-muted">· บันทึก ${new Date(run.saved_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}</span></div>
    <div style="margin-left:auto;display:flex;gap:8px;">
      ${canW && H.edits.size ? `<button class="btn btn-secondary" id="dgHU">ยกเลิกการแก้</button><button class="btn btn-primary" id="dgHS">💾 บันทึกการแก้ไข (${H.edits.size})</button>` : ""}
      <button class="btn btn-gold" id="dgHX">📤 Export</button>
      ${canW && !H.later && !H.edits.size ? `<button class="btn btn-secondary" id="dgHD" title="ลบได้เฉพาะเดือนล่าสุด">🗑 ลบเดือนนี้</button>` : ""}
    </div>
  </div>
  ${canW ? `<div class="text-muted" style="font-size:12px;margin:8px 2px 0;">กดที่ยอดเบี้ยขยัน ✎ เพื่อแก้ (ให้สิทธิ์ / ตัดสิทธิ์ / กำหนดยอด) แล้วกด 💾 บันทึกการแก้ไข${H.later ? ` · <b>เดือนถัดไปบันทึกแล้ว</b> — เดือนนี้แก้ได้เฉพาะยอดเงิน (เปลี่ยนได้/ไม่ได้จะทำให้เดือนต่อเนื่องของเดือนหลังผิด)` : ""}</div>` : ""}
  <div class="card mt-4">
    <div class="card-body" style="display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--border);">
      ${[["all", `ทั้งหมด ${V.length}`], ["ok", `ได้ ${ok.length}`], ["no", `ไม่ได้ ${V.length - ok.length}`], ["edit", `แก้ไขแล้ว ${V.filter(r => r.manual).length}`]]
        .map(([k, t]) => `<button class="btn btn-sm ${H.filter === k ? "btn-primary" : ""}" data-hf="${k}">${t}</button>`).join("")}
      <input class="search-input" id="dgHQ" placeholder="ค้นหารหัส / ชื่อ / แผนก" value="${esc(H.q)}" style="min-width:200px;">
    </div>
    <div style="overflow:auto;"><table class="data-table"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>แผนก</th><th>ระดับ</th><th style="text-align:center;">เดือนที่</th><th style="text-align:right;">เบี้ยขยัน</th><th>เหตุผล / ข้อสังเกต</th></tr></thead><tbody>
    ${list.map(r => `<tr${r.pending ? ' style="background:var(--gold-light);"' : ""}><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td>${esc(r.department)}</td><td>${esc(r.job_level)}</td>
      <td style="text-align:center;">${r.qualified ? r.streak : "-"}</td><td style="text-align:right;white-space:nowrap;">${amountCell(r, canW)}</td>
      <td style="font-size:12px;max-width:440px;">${reasonsCell(r)}</td></tr>`).join("") || `<tr><td colspan="7" class="text-muted" style="text-align:center;padding:20px;">ไม่มีรายการ</td></tr>`}
    </tbody></table></div></div>`;
  box.querySelector("#dgHM").onchange = e => renderHist(e.target.value);
  box.querySelector("#dgHQ").oninput = e => { H.q = e.target.value; drawHist(); const i = document.getElementById("dgHQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
  box.querySelectorAll("[data-hf]").forEach(b => b.onclick = () => { H.filter = b.dataset.hf; drawHist(); });
  box.querySelector("#dgHX").onclick = () => exportXlsx(V, H.ym);
  box.querySelector("#dgHU")?.addEventListener("click", () => { H.edits.clear(); drawHist(); });
  box.querySelector("#dgHS")?.addEventListener("click", saveHist);
  box.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => {
    const r = V.find(x => x.code === b.dataset.edit);
    editModal(r, ymTH(H.ym), m => {
      const base = H.rows.find(x => x.code === r.code);
      const next = m || null, same = JSON.stringify(next) === JSON.stringify(base.manual || null);
      if (same) H.edits.delete(r.code); else H.edits.set(r.code, next);
      if (H.later) { const x = applyHistEdit(base, next, H.prev.get(r.code));
        if (x.qualified !== base.qualified) { H.edits.delete(r.code); toast("เดือนถัดไปบันทึกแล้ว — เปลี่ยนได้/ไม่ได้ของเดือนนี้ไม่ได้ แก้ได้เฉพาะยอดเงิน", "error"); } }
      drawHist();
    });
  });
  box.querySelector("#dgHD")?.addEventListener("click", async () => {
    if (!confirm(`ลบผลเบี้ยขยันเวลา ${ymTH(H.ym)} ทั้งเดือน?`)) return;
    const { error: e } = await supabase.from("diligence_runs").delete().eq("ym", H.ym);
    if (e) { toast("ลบไม่สำเร็จ: " + e.message, "error"); return; }
    H.ym = null; toast("ลบแล้ว", "success"); renderHist();
  });
}

async function saveHist() {
  const rows = [...H.edits.keys()].map(code => { const v = histView(H.rows.find(r => r.code === code));
    return { code, qualified: v.qualified, streak: v.streak, amount: v.qualified ? v.amount : 0, manual: v.manual || null }; });
  if (!confirm(`บันทึกการแก้ไข ${rows.length} คน ของเวลา ${ymTH(H.ym)}?`)) return;
  const { error } = await supabase.rpc("diligence_edit", { p_ym: H.ym, p_rows: rows });
  if (error) { toast("บันทึกไม่สำเร็จ: " + error.message + (/function/.test(error.message) ? " — รัน sql/schema_diligence.sql ล่าสุดก่อน" : ""), "error"); return; }
  H.edits.clear(); toast("บันทึกการแก้ไขแล้ว", "success"); renderHist(H.ym);
}
