// ===== รายงานโอที & เบี้ยขยัน =====
// ตรรกะอยู่ใน otreport-calc.js (มีเทส) — หน้านี้: อัปโหลดรายงานหลังประมวลจาก TigerSoft → PDF แยกตามกลุ่มแผนก (zip) + Excel
//   ระดับ O = โอที 1 / 1.5 / 3 + เบี้ยขยัน · ระดับ S = เบี้ยขยันอย่างเดียว (แยกชุด) — ผู้ใช้ขอ 2026-10-12
//   หน้าตา PDF ตามแบบใน Figma (ไฟล์ Intern design system หน้า "OT & Diligence Report") ซึ่งต่อยอดจากรายงาน ส.ค. 2026 ที่ HR ใช้
//   เบี้ยขยันอ่านจากผลที่ "บันทึก" ในหน้าเบี้ยขยันของเดือนเดียวกัน (ยังไม่บันทึก = ช่องเบี้ยขยันว่าง พร้อมเตือน)
import { esc, toast, can, allEmployees } from "./app.js";
import { supabase } from "./supabase-config.js";
import { parseProcessed } from "./diligence-calc.js";
import { buildReport, hm } from "./otreport-calc.js";

const MONTH_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const TH_M = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const monthEn = ym => `${MONTH_EN[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
const ymTH = ym => `${TH_M[+ym.slice(5, 7) - 1]} ${+ym.slice(0, 4) + 543}`;
const nextYM = ym => { const [y, m] = ym.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };
const lastDay = ym => { const [y, m] = ym.split("-").map(Number); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`; };
const H = m => { const s = hm(m); const [h, mm] = s.split(":"); return `${Number(h).toLocaleString("en-US")}:${mm}`; };   // 1,135:30
const baht = n => Number(n || 0).toLocaleString("en-US");
const safe = s => String(s).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();

const S = { file: null, proc: null, ym: null, rep: null, dilNote: "" };

export function renderOtReport() {
  const pg = document.getElementById("pageOtreport");
  if (!can("page.otreport") && !can("page.shiftallow")) {
    pg.innerHTML = `<div class="empty-state" style="padding-top:80px;"><div class="empty-title">ไม่มีสิทธิ์เข้าถึง</div><div class="empty-sub">เฉพาะ HR และ Admin</div></div>`;
    return;
  }
  const hidden = 'style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;border:0;overflow:hidden;clip:rect(0 0 0 0);"';
  pg.innerHTML = `
  <div class="page-header"><div><div class="page-heading">รายงานโอที & เบี้ยขยัน</div>
    <div class="page-sub">PDF แยกตามกลุ่มแผนก — ระดับ O: โอที + เบี้ยขยัน · ระดับ S: เบี้ยขยัน (แยกชุด)</div></div></div>
  <div class="section mt-4 pb-4">
    <div class="card card-body">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <input type="file" id="orF" accept=".xls,.xlsx" ${hidden}>
        <label for="orF" class="btn btn-primary" style="cursor:pointer;">📁 เลือกไฟล์ข้อมูลหลังประมวล</label>
        <span style="font-size:13px;">${S.file ? `✅ ${esc(S.file)}` : `<span class="text-muted">รายงานแยกตามพนักงานจาก TigerSoft (ไฟล์เดียวกับเบี้ยขยัน / ตรวจโอที) — ไม่ต้องแปลง</span>`}</span>
      </div>
      <div class="text-muted" style="font-size:12.5px;line-height:1.8;margin-top:10px;">
        • คนในรายงาน = ระดับนั้นที่เป็นพนักงานช่วงใดช่วงหนึ่งของเดือน (ไม่มีโอทีก็ขึ้น 0:00) · โอทีรวมทุกวันในเดือนจากไฟล์ TigerSoft<br>
        • กลุ่มแผนก: Processing แยกตาม Section (Maintenance แยกต่อตาม Team) · Mining แยกตาม Section · แผนกอื่นใช้ชื่อแผนก — ตามรายงานเดิมของ HR<br>
        • เบี้ยขยันดึงจากผลที่ <b>บันทึก</b> ในหน้าเบี้ยขยันของเดือนเดียวกัน (เวลาเดือนนี้ → จ่ายงวดถัดไป)
      </div>
    </div>
    <div id="orOut" class="mt-4"></div>
  </div>`;
  document.getElementById("orF").onchange = e => readFile(e.target);
  if (S.rep) drawOut();
}

function readFile(input) {
  const file = input.files?.[0]; input.value = "";
  if (!file) return;
  if (!window.XLSX) { toast("กรุณารอโหลด library", "error"); return; }
  const fr = new FileReader();
  fr.onload = async ev => {
    try {
      const wb = window.XLSX.read(new Uint8Array(ev.target.result), { type: "array" });
      S.proc = parseProcessed(window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null }));
      S.file = file.name;
      const cnt = {}; for (const t of S.proc.values()) for (const d of t.days) cnt[d.date.slice(0, 7)] = (cnt[d.date.slice(0, 7)] || 0) + 1;
      S.ym = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0];
      await build();
    } catch (e) { toast("อ่านไฟล์ไม่ได้: " + e.message, "error"); }
  };
  fr.readAsArrayBuffer(file);
}

async function build() {
  const { data, error } = await supabase.from("diligence_results").select("emp_code,qualified,streak,amount,reasons").eq("ym", S.ym);
  const dil = error || !data?.length ? null : new Map(data.map(r => [r.emp_code, r]));
  S.dilNote = error ? `อ่านผลเบี้ยขยันไม่ได้ (${error.message})` : !data?.length ? `ยังไม่ได้บันทึกเบี้ยขยันของเวลา ${ymTH(S.ym)} — ไปหน้าเบี้ยขยัน คำนวณแล้วกดบันทึกก่อน ช่องเบี้ยขยันในรายงานจะว่าง` : "";
  S.rep = buildReport({ procMap: S.proc, employees: allEmployees, dil, ym: S.ym });
  renderOtReport();
}

function drawOut() {
  const el = document.getElementById("orOut"); if (!el) return;
  const R = S.rep, o = R.totalsO, s = R.totalsS;
  const stat = (k, v, sub, color = "") => `<div class="card card-body" style="padding:14px 16px;"><div class="text-muted" style="font-size:12px;">${k}</div>
    <div style="font-size:22px;font-weight:700;${color ? `color:${color};` : ""}">${v}</div><div class="text-muted" style="font-size:11.5px;">${sub}</div></div>`;
  const warn = [S.dilNote, R.extraRates.length ? `มีโอทีอัตราอื่น (${R.extraRates.join(", ")} เท่า) — รวมอยู่ในช่อง Total` : "",
    R.foreigners.length ? `ไม่รวมชาวต่างชาติ ${R.foreigners.length} คน (${R.foreigners.slice(0, 6).join(", ")}${R.foreigners.length > 6 ? " …" : ""})` : "",
    R.notInMaster.length ? `${R.notInMaster.length} รหัสในไฟล์ไม่มีในทะเบียนพนักงาน (ไม่อยู่ในรายงาน): ${R.notInMaster.slice(0, 6).join(", ")}${R.notInMaster.length > 6 ? " …" : ""}` : ""].filter(Boolean);
  el.innerHTML = `
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;">
    ${stat("ระดับ O", fmtN(o.employees) + " คน", `มีโอที ${fmtN(o.withOT)} คน · ${R.groupsO.length} กลุ่ม`)}
    ${stat("โอทีรวม (O)", H(o.total), `1× ${H(o.ot1)} · 1.5× ${H(o.ot15)} · 3× ${H(o.ot3)}`)}
    ${stat("เบี้ยขยัน ระดับ O", R.hasDil ? "฿" + baht(o.dil) : "—", R.hasDil ? `ได้ ${fmtN(o.dilPeople)} คน` : "ยังไม่บันทึก", "var(--green)")}
    ${stat("เบี้ยขยัน ระดับ S", R.hasDil ? "฿" + baht(s.dil) : "—", `${fmtN(s.employees)} คน · ได้ ${fmtN(s.dilPeople)} คน`, "var(--green)")}
  </div>
  ${warn.length ? `<div class="card card-body mt-4" style="background:var(--gold-light);font-size:13px;line-height:1.8;">${warn.map(w => "⚠️ " + esc(w)).join("<br>")}</div>` : ""}
  <div class="card mt-4">
    <div class="card-body" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;border-bottom:1px solid var(--border);">
      <div><div class="card-title" style="margin:0;">เวลา ${ymTH(S.ym)} · ${monthEn(S.ym)}</div>
        <div class="text-muted" style="font-size:12px;">PDF ภาษาอังกฤษ ตามแบบรายงานเดิม (ฟอนต์ IBM Plex Sans Thai) · zip แยกโฟลเดอร์ระดับ O / ระดับ S + README</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-primary" id="orZip">📦 ดาวน์โหลด PDF ทั้งหมด (zip)</button>
        <button class="btn btn-gold" id="orXlsx">📤 Excel</button>
      </div>
    </div>
    <div style="overflow:auto;"><table class="data-table"><thead><tr><th>กลุ่ม</th><th style="text-align:right;">ระดับ O</th><th style="text-align:right;">OT 1</th><th style="text-align:right;">OT 1.5</th><th style="text-align:right;">OT 3</th>
      <th style="text-align:right;">Total</th><th style="text-align:right;">เบี้ยขยัน O</th><th style="text-align:right;">ระดับ S</th><th style="text-align:right;">เบี้ยขยัน S</th><th>PDF</th></tr></thead><tbody>
      ${groupNames().map(n => { const g = R.groupsO.find(x => x.name === n), gs = R.groupsS.find(x => x.name === n), t = g?.totals, ts = gs?.totals;
        return `<tr><td><b>${esc(n)}</b>${(t?.review || 0) + (ts?.review || 0) ? ` <span class="badge badge-gold" title="มีคนที่ต้องดู: เข้า/ออกกลางเดือน ไม่มีข้อมูลเวลา ไม่มีชื่ออังกฤษ">ต้องดู ${(t?.review || 0) + (ts?.review || 0)}</span>` : ""}</td>
          <td style="text-align:right;">${t ? t.employees : "-"}</td><td style="text-align:right;">${t ? H(t.ot1) : "-"}</td><td style="text-align:right;">${t ? H(t.ot15) : "-"}</td>
          <td style="text-align:right;">${t ? H(t.ot3) : "-"}</td><td style="text-align:right;font-weight:600;">${t ? H(t.total) : "-"}</td>
          <td style="text-align:right;">${t && R.hasDil ? baht(t.dil) : "-"}</td><td style="text-align:right;">${ts ? ts.employees : "-"}</td><td style="text-align:right;">${ts && R.hasDil ? baht(ts.dil) : "-"}</td>
          <td style="white-space:nowrap;">${g ? `<button class="btn btn-sm" data-pdf="O|${esc(n)}">O</button>` : ""} ${gs ? `<button class="btn btn-sm" data-pdf="S|${esc(n)}">S</button>` : ""}</td></tr>`; }).join("")}
    </tbody></table></div>
  </div>`;
  el.querySelector("#orZip").onclick = downloadZip;
  el.querySelector("#orXlsx").onclick = exportXlsx;
  el.querySelectorAll("[data-pdf]").forEach(b => b.onclick = async () => {
    const [lv, name] = [b.dataset.pdf.slice(0, 1), b.dataset.pdf.slice(2)];
    const g = (lv === "O" ? S.rep.groupsO : S.rep.groupsS).find(x => x.name === name);
    b.disabled = true;
    try { const doc = await (lv === "O" ? pdfO(g) : pdfS(g)); doc.save(fileName(lv, name)); } catch (e) { toast("สร้าง PDF ไม่สำเร็จ: " + e.message, "error"); }
    b.disabled = false;
  });
}
const fmtN = n => Number(n || 0).toLocaleString("en-US");
const groupNames = () => [...new Set([...S.rep.groupsO.map(g => g.name), ...S.rep.groupsS.map(g => g.name)])].sort();
const fileName = (lv, name) => lv === "O" ? `${monthEn(S.ym)} Overtime & Diligence_${safe(name)}.pdf` : `${monthEn(S.ym)} Diligence Allowance Level S_${safe(name)}.pdf`;

// ---------------------------------------------------------------- PDF (jsPDF + autoTable · ฟอนต์ IBM Plex Sans Thai)
const LIBS = ["https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
              "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
              "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"];
const FONT_URL = s => `https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/ibmplexsansthai/IBMPlexSansThai-${s}.ttf`;
let libsReady = null, fonts = null;
const loadScript = src => new Promise((ok, bad) => { if ([...document.scripts].some(s => s.src === src)) return ok(); const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => bad(new Error("โหลดไม่ได้: " + src)); document.head.appendChild(s); });
async function ensureLibs() {
  libsReady ||= (async () => { for (const u of LIBS) await loadScript(u); })();
  await libsReady;
  if (!fonts) {
    const b64 = async s => { const buf = await (await fetch(FONT_URL(s))).arrayBuffer(); let bin = ""; const u8 = new Uint8Array(buf);
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(bin); };
    fonts = { reg: await b64("Regular"), bold: await b64("SemiBold") };
  }
}
// สีตามตัวแปรในไฟล์ Figma (bg/brand-deep, yellow/500, gray, green, red)
const COL = { deep: [15, 34, 64], gold: [255, 198, 41], ink: [18, 25, 38], sub: [75, 85, 101], ter: [107, 117, 133], subtle: [241, 243, 246],
  border: [228, 232, 238], brandSubtle: [238, 243, 251], green: [6, 118, 71], red: [180, 35, 24], white: [255, 255, 255] };
const PX = 0.75;                               // แบบใน Figma วาดที่ 1123×794 px → A4 แนวนอน 842×595 pt
function newDoc() {
  const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.addFileToVFS("Plex-R.ttf", fonts.reg); doc.addFont("Plex-R.ttf", "Plex", "normal");
  doc.addFileToVFS("Plex-B.ttf", fonts.bold); doc.addFont("Plex-B.ttf", "Plex", "bold");
  doc.setFont("Plex", "normal");
  return doc;
}
function chrome(doc, group, title, subtitle, kpis, source) {
  const W = doc.internal.pageSize.getWidth(), M = 40 * PX;
  const top = () => {
    doc.setFont("Plex", "bold"); doc.setFontSize(9 * PX); doc.setTextColor(...COL.ter);
    doc.text(group, M, 36 * PX); doc.text(monthEn(S.ym).toUpperCase(), W - M, 36 * PX, { align: "right" });
    doc.setDrawColor(...COL.gold); doc.setLineWidth(1.5 * PX); doc.line(M, 44 * PX, W - M, 44 * PX);
  };
  top();
  doc.setFont("Plex", "bold"); doc.setFontSize(22 * PX); doc.setTextColor(...COL.ink); doc.text(title, M, 80 * PX);
  doc.setFont("Plex", "normal"); doc.setFontSize(10.5 * PX); doc.setTextColor(...COL.sub); doc.text(subtitle, M, 100 * PX);
  const y = 114 * PX, h = 54 * PX, w = (W - 2 * M) / kpis.length;
  kpis.forEach(([k, v, color], i) => {
    const x = M + i * w;
    doc.setFillColor(...COL.subtle); doc.setDrawColor(...COL.border); doc.setLineWidth(0.5 * PX); doc.rect(x, y, w, h, "FD");
    doc.setFont("Plex", "bold"); doc.setFontSize(8 * PX); doc.setTextColor(...COL.ter); doc.text(k, x + w / 2, y + 17 * PX, { align: "center" });
    doc.setFontSize(16 * PX); doc.setTextColor(...(color || COL.ink)); doc.text(String(v), x + w / 2, y + 41 * PX, { align: "center" });
  });
  doc.setDrawColor(...COL.gold); doc.setLineWidth(2 * PX); doc.line(M, y + h, W - M, y + h);
  return { startY: y + h + 14 * PX, top, source };
}
function finish(doc, source) {
  const W = doc.internal.pageSize.getWidth(), Hh = doc.internal.pageSize.getHeight(), M = 40 * PX, n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(...COL.border); doc.setLineWidth(0.5 * PX); doc.line(M, Hh - 34 * PX, W - M, Hh - 34 * PX);
    doc.setFont("Plex", "normal"); doc.setFontSize(8 * PX); doc.setTextColor(...COL.ter);
    doc.text(source, M, Hh - 22 * PX); doc.text(`Page ${i} of ${n}`, W - M, Hh - 22 * PX, { align: "right" });
  }
}
function table(doc, c, head, body, foot, widths, aligns, colorCol) {
  const M = 40 * PX;
  doc.autoTable({
    head: [head], body, foot: [foot], startY: c.startY, showFoot: "lastPage", showHead: "everyPage",
    margin: { left: M, right: M, top: 58 * PX, bottom: 44 * PX }, tableWidth: "auto",
    styles: { font: "Plex", fontSize: 8.5 * PX, cellPadding: { top: 3.5 * PX, bottom: 3.5 * PX, left: 4 * PX, right: 4 * PX }, textColor: COL.ink, lineWidth: 0, overflow: "linebreak" },
    headStyles: { fillColor: COL.deep, textColor: COL.white, fontStyle: "bold", fontSize: 8 * PX, cellPadding: { top: 5 * PX, bottom: 5 * PX, left: 4 * PX, right: 4 * PX } },
    footStyles: { fillColor: COL.brandSubtle, textColor: COL.ink, fontStyle: "bold" },
    alternateRowStyles: { fillColor: COL.subtle }, bodyStyles: { fillColor: COL.white },
    columnStyles: Object.fromEntries(widths.map((w, i) => [i, { cellWidth: w * PX, halign: aligns[i] }])),
    didParseCell: d => {
      if (d.section === "head" || (d.section === "foot" && d.column.index > 0)) d.cell.styles.halign = aligns[d.column.index];
      if (colorCol && d.section === "body") colorCol(d);
      if (d.section === "foot" && /^[\d,]+$/.test(String(d.cell.raw)) && aligns[d.column.index] === "right" && d.column.index === aligns.length - 2) d.cell.styles.textColor = COL.green;
    },
    didDrawCell: d => {
      if (d.section === "head") { doc.setDrawColor(...COL.gold); doc.setLineWidth(1.5 * PX); doc.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height); }
      if (d.section === "foot") { doc.setDrawColor(...COL.deep); doc.setLineWidth(1 * PX); doc.line(d.cell.x, d.cell.y, d.cell.x + d.cell.width, d.cell.y);
        doc.setLineWidth(1.5 * PX); doc.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height); }
    },
    didDrawPage: d => { if (d.pageNumber > 1) c.top(); },
  });
}
async function pdfO(g) {
  await ensureLibs();
  const doc = newDoc(), t = g.totals, R = S.rep, review = t.review ? `${t.review} to review` : "Complete";
  const c = chrome(doc, g.name, `${monthEn(S.ym)} Overtime & Diligence`, `${g.name}  •  ${S.ym}-01 to ${lastDay(S.ym)}  •  Level O1–O3`,
    [["EMPLOYEES", fmtN(t.employees)], ["OT 1", H(t.ot1)], ["OT 1.5", H(t.ot15)], ["OT 3", H(t.ot3)], ["TOTAL OT", H(t.total)],
     ["DILIGENCE (THB)", R.hasDil ? baht(t.dil) : "—", COL.green], ["DATA REVIEW", review]]);
  const body = g.rows.map((r, i) => [i + 1, r.division, r.department, r.section, r.team, r.code, r.name, hm(r.ot1), hm(r.ot15), hm(r.ot3), hm(r.total),
    r.dil ? (r.dil.qualified && r.dil.amount ? `${baht(r.dil.amount)} (${r.dil.streak})` : baht(r.dil.amount)) : "—",   // "300 (1)" = ยอด (เดือนต่อเนื่อง)
    r.status.join(" · ")]);                  // เหตุไม่ได้เบี้ยขยันไม่ใส่ใน PDF ระดับ O (ผู้ใช้ 2026-10-12)
  table(doc, c, ["No.", "Division", "Department", "Section", "Team", "Employee ID", "Name-Surname", "OT 1", "OT 1.5", "OT 3", "Total", "Diligence", "Status"], body,
    [{ content: "DEPARTMENT TOTAL", colSpan: 7 }, H(t.ot1), H(t.ot15), H(t.ot3), H(t.total), R.hasDil ? baht(t.dil) : "—", ""],
    [28, 78, 100, 100, 100, 86, 170, 52, 52, 52, 56, 66, 103], ["center", "left", "left", "left", "left", "left", "left", "right", "right", "right", "right", "right", "left"],
    d => { if (d.column.index === 11) d.cell.styles.textColor = d.cell.raw === "0" || d.cell.raw === "—" ? COL.ter : COL.green;
           if (d.column.index === 12) d.cell.styles.textColor = COL.sub; });
  finish(doc, "Source: TigerSoft processed report + employee master + saved diligence results");
  return doc;
}
async function pdfS(g) {
  await ensureLibs();
  const doc = newDoc(), t = g.totals, R = S.rep;
  const c = chrome(doc, g.name, `${monthEn(S.ym)} Diligence Allowance`, `${g.name}  •  Time ${S.ym}-01 to ${lastDay(S.ym)}  •  Paid with ${monthEn(nextYM(S.ym))} salary  •  Level S1–S3`,
    [["EMPLOYEES", fmtN(t.employees)], ["QUALIFIED", R.hasDil ? fmtN(t.dilPeople) : "—", COL.green], ["NOT QUALIFIED", R.hasDil ? fmtN(t.employees - t.dilPeople) : "—", COL.red], ["TOTAL (THB)", R.hasDil ? baht(t.dil) : "—", COL.green]]);
  const body = g.rows.map((r, i) => [i + 1, r.division, r.department, r.section, r.team, r.code, r.name, r.dil?.qualified ? r.dil.streak : "-",
    r.dil ? baht(r.dil.amount) : "—", r.status.join(" · ")]);                  // เหตุไม่ได้เบี้ยขยันไม่ใส่ใน PDF (ผู้ใช้ 2026-10-12)
  table(doc, c, ["No.", "Division", "Department", "Section", "Team", "Employee ID", "Name-Surname", "Month", "Diligence", "Status"], body,
    [{ content: "TOTAL", colSpan: 8 }, R.hasDil ? baht(t.dil) : "—", ""],
    [28, 90, 120, 120, 110, 90, 190, 70, 80, 145], ["center", "left", "left", "left", "left", "left", "left", "center", "right", "left"],
    d => { if (d.column.index === 8) d.cell.styles.textColor = d.cell.raw === "0" || d.cell.raw === "—" ? COL.ter : COL.green;
           if (d.column.index === 9) d.cell.styles.textColor = COL.sub; });
  finish(doc, "Source: saved diligence results + employee master");
  return doc;
}

async function downloadZip() {
  const btn = document.getElementById("orZip"); btn.disabled = true; const label = btn.textContent;
  try {
    await ensureLibs();
    const zip = new window.JSZip(), R = S.rep, m = monthEn(S.ym);
    const fo = zip.folder(`${m} Overtime & Diligence - Level O`), fs = zip.folder(`${m} Diligence Allowance - Level S`);
    let i = 0; const total = R.groupsO.length + R.groupsS.length;
    for (const g of R.groupsO) { btn.textContent = `กำลังสร้าง ${++i}/${total}…`; fo.file(fileName("O", g.name), (await pdfO(g)).output("arraybuffer")); }
    for (const g of R.groupsS) { btn.textContent = `กำลังสร้าง ${++i}/${total}…`; fs.file(fileName("S", g.name), (await pdfS(g)).output("arraybuffer")); }
    const o = R.totalsO, s = R.totalsS;
    zip.file("00_README.txt", [`${m} Overtime & Diligence`, "",
      `Level O1-O3`, `Employees: ${o.employees}`, `Employees with OT: ${o.withOT}`, `OT 1: ${H(o.ot1)}`, `OT 1.5: ${H(o.ot15)}`, `OT 3: ${H(o.ot3)}`, `Total OT: ${H(o.total)}`,
      `Diligence: ${R.hasDil ? baht(o.dil) + " THB (" + o.dilPeople + " employees)" : "not saved yet"}`, `Data review: ${o.review} employee record(s)`, "",
      `Level S1-S3 (diligence only)`, `Employees: ${s.employees}`, `Diligence: ${R.hasDil ? baht(s.dil) + " THB (" + s.dilPeople + " employees)" : "not saved yet"}`, "",
      `Time data: ${S.file}`, `Diligence = time ${m}, paid with ${monthEn(nextYM(S.ym))} salary`,
      ...(R.notInMaster.length ? ["", `Codes in the time file but not in the employee master (not reported): ${R.notInMaster.join(", ")}`] : [])].join("\r\n"));
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${m} Overtime & Diligence.zip`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`สร้าง PDF ${total} ไฟล์แล้ว`, "success");
  } catch (e) { toast("สร้าง zip ไม่สำเร็จ: " + e.message, "error"); }
  btn.disabled = false; btn.textContent = label;
}

function exportXlsx() {
  if (!window.XLSX) { toast("กรุณารอโหลด library", "error"); return; }
  const X = window.XLSX, wb = X.utils.book_new(), R = S.rep;
  const rowsO = R.groupsO.flatMap(g => g.rows.map(r => ({ Group: g.name, Division: r.division, Department: r.department, Section: r.section, Team: r.team, "Employee ID": r.code,
    "Name-Surname": r.name, Level: r.level, "OT 1": hm(r.ot1), "OT 1.5": hm(r.ot15), "OT 3": hm(r.ot3), Total: hm(r.total), Diligence: r.dil ? r.dil.amount : "",
    Status: [...r.status, r.dil && !r.dil.qualified ? `No diligence: ${r.dil.why}` : ""].filter(Boolean).join(" · ") })));
  const rowsS = R.groupsS.flatMap(g => g.rows.map(r => ({ Group: g.name, Division: r.division, Department: r.department, Section: r.section, Team: r.team, "Employee ID": r.code,
    "Name-Surname": r.name, Level: r.level, Month: r.dil?.qualified ? r.dil.streak : "", Diligence: r.dil ? r.dil.amount : "",
    Reason: [r.dil && !r.dil.qualified ? r.dil.why : "", ...r.status].filter(Boolean).join(" · ") })));
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rowsO), "Level O");
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rowsS), "Level S");
  X.writeFile(wb, `${monthEn(S.ym)} Overtime & Diligence.xlsx`);
}
