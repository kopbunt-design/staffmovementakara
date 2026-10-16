// ============================================================================
// สารบัญเอกสาร / ทะเบียนเลขที่เอกสาร — ตรรกะล้วน (ไม่แตะ DOM / ไม่ import app.js) · เทส test/doc-register.test.js
//   ใช้โดยเว็บ /docs (docs/dx.js) · ตัวอ่านไฟล์ Excel เดิม "01 ลำดับเอกสาร HR.xlsx" ย้ายมาจาก js/doc-register.js (2026-10-16)
// ============================================================================
const TH_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];

// ---------------------------------------------------------------- อ่านไฟล์ Excel เดิม (pure — มีเทส)
const TH_MONTH_IDX = Object.fromEntries(TH_MONTHS.map((m, i) => [m, i]));
// วันที่ในไฟล์เดิมมีหลายแบบ: เลข serial ของ Excel · "6 กุมภาพันธ์ 2568" · "16/1/2026" — ที่อ่านไม่ออกคืน null
export function parseLogDate(v) {
  if (v == null || v === "") return null;
  const iso = (y, m, d) => {
    const dt = new Date(Date.UTC(y, m, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
  };
  const n = typeof v === "number" ? v : (/^\d{5}(\.\d+)?$/.test(String(v).trim()) ? +v : NaN);
  if (!isNaN(n)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5); return d.toISOString().slice(0, 10); }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\s+(\S+)\s+(\d{4})$/);
  if (m && m[2] in TH_MONTH_IDX) { let y = +m[3]; if (y > 2400) y -= 543; return iso(y, TH_MONTH_IDX[m[2]], +m[1]); }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) { let y = +m[3]; if (y > 2400) y -= 543; return iso(y, +m[2] - 1, +m[1]); }
  return null;
}

// คำอธิบายพิมพ์เองในไฟล์เดิม → ประเภทมาตรฐาน
export function mapDocType(desc) {
  const s = String(desc || ""), en = /อังกฤษ|english/i.test(s);
  if (s.includes("รับรองการทำงาน")) return en ? "หนังสือรับรองการทำงาน (ภาษาอังกฤษ)" : "หนังสือรับรองการทำงาน (ภาษาไทย)";
  if (s.includes("รับรองเงินเดือน")) return en ? "หนังสือรับรองเงินเดือน (ภาษาอังกฤษ)" : "หนังสือรับรองเงินเดือน (ภาษาไทย)";
  if (/offer/i.test(s)) return "Offer Letter (จดหมายจ้างงาน)";
  if (/terminat/i.test(s) || s.includes("เลิกจ้าง")) return "หนังสือเลิกจ้าง (Terminate)";
  if (s.includes("ปรับตำแหน่ง")) return "หนังสือปรับตำแหน่ง";
  if (s.includes("ปรับเงิน")) return "หนังสือปรับเงินเดือน";
  if (s.includes("ฝึกงาน")) return "แจ้งผลนักศึกษาฝึกงาน";
  return "อื่น ๆ";
}
const PLAIN = /^(หนังสือรับรองการทำงาน|หนังสือรับรองเงินเดือน|offer letter|terminate)$/i;

// sheets: { HR: aoa, Memo: aoa } (ชื่อชีตตามไฟล์เดิม) → แถวพร้อมส่ง doc_import + สรุป
export function parseDocLog(sheets) {
  const out = [], skipped = [];
  const hr = sheets.HR || [];
  const h = hr.findIndex(r => (r || []).some(c => String(c ?? "").trim() === "เลขที่เอกสาร"));
  for (const r0 of hr.slice(h + 1)) {
    const r = [...(r0 || []), ...Array(12).fill("")];
    const desc = String(r[4] ?? "").trim();
    if (!desc) continue;                                     // เลขที่เตรียมไว้แต่ยังไม่ได้ใช้
    const year = parseInt(r[2], 10);
    const first = String(r[5] ?? "").trim(), last = String(r[6] ?? "").trim();
    let person = [first, last].filter(Boolean).join(" ");
    const paren = desc.match(/\(([^)]*)\)/g)?.map(x => x.slice(1, -1).trim()).find(x => x && !/ภาษา/.test(x)) || "";
    if (!person && paren) person = paren;
    let subject = desc.replace(/\s+/g, " ");
    const bare = subject.replace(/\((ภาษา[^)]*|[^)]*)\)/g, "").trim();
    if (PLAIN.test(bare)) subject = "";
    const issued = parseLogDate(r[7]);
    const notes = [];
    if (!issued && String(r[7] ?? "").trim()) notes.push(`วันที่ในไฟล์เดิม: ${String(r[7]).trim()}`);
    const refNo = String(r[9] ?? "").trim();
    if (refNo && String(r[10] ?? "").trim()) notes.push(`อ้างอิง: ${String(r[10]).trim()}${r[11] ? ` (${String(r[11]).trim()})` : ""}`);
    const base = { series_code: "HR", year, type_label: mapDocType(desc), subject, person_name: person,
                   issued_date: issued || "", ref_doc_no: refNo, note: notes.join(" · ") };
    // แถวจองเลขเป็นช่วง เช่น "(96-133)" → ขยายเป็นทีละเลข
    const range = String(r[1] ?? "").match(/^\(?\s*(\d+)\s*-\s*(\d+)\s*\)?$/);
    const seq = parseInt(r[1], 10);
    if (range && !/^\d+$/.test(String(r[1]).trim())) {
      for (let s = +range[1]; s <= +range[2]; s++) out.push({ ...base, seq: s, note: [base.note, `ออกเป็นชุด ${range[1]}–${range[2]}`].filter(Boolean).join(" · ") });
    } else if (seq > 0 && year > 2000) out.push({ ...base, seq });
    else skipped.push(r.slice(0, 5).join(" | "));
  }
  for (const r of sheets.Memo || []) {
    const desc = String((r || [])[5] ?? "").trim(), seq = parseInt((r || [])[2], 10), year = parseInt((r || [])[3], 10);
    if (!desc || !(seq > 0) || !(year > 2000)) continue;
    out.push({ series_code: "MEMO", year, seq, type_label: "บันทึกภายใน", subject: desc, person_name: "",
               issued_date: "", ref_doc_no: "", note: "" });
  }
  return { rows: out, skipped };
}

// ---------------------------------------------------------------- สารบัญ
// เลขถัดไป (แสดงให้เห็นก่อนกด — เลขจริงมาจาก doc_issue ตอนออก ถ้ามีคนออกตัดหน้าจะได้เลขถัดไปอีก)
// rows ที่ผู้ใช้มองไม่เห็น (เอกสารลับ) ไม่อยู่ในรายการ → เลขที่แสดงอาจต่ำไป ใช้เป็นตัวอย่างเท่านั้น
export function nextNo(rows, prefix, code, year) {
  const max = rows.filter(r => r.series_code === code && r.year === +year).reduce((m, r) => Math.max(m, r.seq), 0);
  return `${prefix}-${String(max + 1).padStart(3, "0")}-${year}`;
}
// f = { q, dir: ""|"out"|"in", series, type, year, voided, nofile } · dirOf(code) → "out"|"in" · files = Map(doc_id → จำนวนไฟล์)
export function filterDocs(rows, f = {}, dirOf = () => "out", files = new Map()) {
  const q = String(f.q || "").trim().toLowerCase();
  return rows.filter(r => (!f.dir || dirOf(r.series_code) === f.dir) && (!f.series || r.series_code === f.series)
    && (!f.type || r.type_label === f.type) && (!f.year || r.year === +f.year)
    && (f.voided || r.status !== "void") && (!f.nofile || (r.status !== "void" && !files.get(r.id)))
    && (!q || [r.doc_no, r.type_label, r.subject, r.person_name, r.emp_code, r.ref_doc_no, r.note, r.sender, r.form_code].join(" ").toLowerCase().includes(q)));
}
// ชื่อไฟล์ใน storage: ตัดอักษรแปลก ๆ ออก (key ของ Supabase Storage รับแค่ ASCII ส่วนหนึ่ง) · ชื่อจริงเก็บในตาราง doc_files
export const storageName = name => {
  const m = String(name || "file").match(/^(.*?)(\.[A-Za-z0-9]{1,8})?$/);
  const base = (m[1] || "file").normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 60) || "file";
  return base + (m[2] || "").toLowerCase();
};
