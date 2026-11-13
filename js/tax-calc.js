// ============================================================================
// ทะเบียนรายได้และภาษีพนักงาน (เว็บ /tax) — ส่วนคำนวณล้วน ไม่แตะ DOM/DB · เทส test/tax.test.js · user 2026-11-13
//   เก็บรายได้/ภาษี/ประกันสังคม/PVD รายคนรายเดือน → ออก 50 ทวิ ปีละใบ (ภ.ง.ด.1ก) และกระทบยอดกับ ภ.ง.ด.1 / ภ.ง.ด.1ก
//   ไฟล์ต้นทางมีหลายแบบ เพราะ ม.ค.–มิ.ย. 2569 ทำเงินเดือนใน Excel ก่อนย้ายไป TigerSoft:
//     ydp    = BeforeProcessYDP จาก TigerSoft (ก.ค. 2569 เป็นต้นไป)
//     excel  = "NN Payroll - <Month> YYYY.xlsx" แผ่น "Salary Final" (Excel เดิม)
//     tshist = "Payroll-Tigersoft_YYYY-MM-ไม่sum.xlsx" แผ่น รายได้ / รายหัก (ข้อมูลย้อนหลังที่ป้อนเข้า TigerSoft)
//   เงินได้ 40(1) = รวมรายได้ − ขาด/ลา/มาสาย/ออกก่อน/พักงาน − เงินชดเชย − ค่าตอบแทนกรรมการ
//     ตรงกับไฟล์ ภ.ง.ด.1 ส.ค. 2569 ที่ยื่นจริง 488/488 คน (ภาษี = ภาษี + ภาษีเงินชดเชย)
//   ค่าตอบแทนกรรมการ = 40(2) แยกบรรทัด · เงินชดเชย (เงินชดเชย1/2) แยกเป็นเงินได้ที่จ่ายครั้งเดียวเพราะออกจากงาน
// ============================================================================

export const FIELDS = ["inc401", "inc402", "sev", "tax", "sev_tax", "sso", "pvd", "co_tax", "wef"];
export const FIELD_TH = { inc401: "เงินได้ 40(1)", inc402: "เงินได้ 40(2)", sev: "เงินชดเชย (ออกจากงาน)", tax: "ภาษีหัก ณ ที่จ่าย",
  sev_tax: "ภาษีเงินชดเชย", sso: "ประกันสังคม", pvd: "กองทุนสำรองเลี้ยงชีพ", co_tax: "ภาษีบริษัทออกให้", wef: "กองทุนสงเคราะห์ลูกจ้าง" };
export const FORMAT_TH = { ydp: "TigerSoft (BeforeProcessYDP)", excel: "Excel เงินเดือนเดิม (Salary Final)", tshist: "TigerSoft ย้อนหลัง (รายได้/รายหัก)" };

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const num = v => typeof v === "number" ? v : v == null || v === "" ? 0 : Number(String(v).replace(/,/g, "")) || 0;
const norm = s => String(s ?? "").replace(/\s+/g, " ").trim();
const code = v => norm(v).toUpperCase();
// AKR = พนักงานประจำ · DAY = รายวัน · KCN… = กรรมการ/อื่น ๆ — อยู่ใน ภ.ง.ด.1 ทุกคน จึงเก็บทุกรหัส
const isEmp = c => /^[A-Z]{2,5}\d+$/.test(c);
const empty = () => Object.fromEntries(FIELDS.map(f => [f, 0]));
const idxOf = h => { const m = {}; h.forEach((k, i) => { const n = norm(k); if (n && !(n in m)) m[n] = i; }); return m; };
const has = (o, ...ks) => ks.every(k => k in o);

// ---------------------------------------------------------------- อ่านไฟล์เงินเดือน
// sheets = { ชื่อแผ่น: aoa } → { format, rows: Map(code → {name, ...FIELDS}), skipped }
export function readPayroll(sheets) {
  for (const aoa of Object.values(sheets)) {
    const ix = idxOf(aoa[0] || []);
    if (has(ix, "รหัสพนักงาน", "รวมรายได้", "ภาษี")) return { format: "ydp", ...parseYDP(aoa) };
  }
  for (const aoa of Object.values(sheets)) {
    const hi = aoa.slice(0, 15).findIndex(r => (r || []).some(c => norm(c) === "Employee No."));
    if (hi >= 0 && has(idxOf(aoa[hi]), "Total Income", "WHT")) return { format: "excel", ...parseExcel(aoa, hi) };
  }
  if (sheets["รายได้"] && sheets["รายหัก"]) return { format: "tshist", ...parseTsHist(sheets["รายได้"], sheets["รายหัก"]) };
  throw new Error("ไม่รู้จักรูปแบบไฟล์ — ใช้ BeforeProcessYDP (TigerSoft), Payroll - <เดือน>.xlsx (แผ่น Salary Final) หรือ Payroll-Tigersoft_…-ไม่sum.xlsx");
}

const LESS = ["ขาด", "ลา", "มาสาย", "ออกก่อน", "พักงาน"];
export function parseYDP(aoa) {
  const ix = idxOf(aoa[0]), g = (r, k) => k in ix ? num(r[ix[k]]) : 0, rows = new Map(); let skipped = 0;
  for (const r of aoa.slice(1)) {
    const c = code(r?.[ix["รหัสพนักงาน"]]); if (!isEmp(c)) continue;
    const sev = g(r, "เงินชดเชย1") + g(r, "เงินชดเชย2"), inc402 = g(r, "ค่าตอบแทนกรรมการ");
    const x = { name: norm(r[ix["ชื่อ-นามสกุล"]]), inc401: r2(g(r, "รวมรายได้") - LESS.reduce((s, k) => s + g(r, k), 0) - sev - inc402), inc402: r2(inc402), sev: r2(sev),
      tax: r2(g(r, "ภาษี")), sev_tax: r2(g(r, "ภาษีเงินชดเชย")), sso: r2(g(r, "ประกันสังคม")), pvd: r2(g(r, "กองทุนสำรองเลี้ยงชีพ")),
      co_tax: r2(g(r, "ภาษีบริษัทจ่ายให้")), wef: r2(g(r, "กองทุนสงเคราะห์ลูกจ้าง")) };
    if (FIELDS.every(f => !x[f])) { skipped++; continue; }          // TigerSoft ใส่คนลาออกแล้วมาด้วย ยอดศูนย์ทั้งแถว
    add(rows, c, x);
  }
  return { rows, skipped };
}
export function parseExcel(aoa, hi) {
  const ix = idxOf(aoa[hi]), g = (r, k) => k in ix ? num(r[ix[k]]) : 0, rows = new Map(); let skipped = 0;
  for (const r of aoa.slice(hi + 1)) {
    const c = code(r?.[ix["Employee No."]]); if (!isEmp(c)) continue;
    const name = [r[ix["ชื่อ"]], r[ix["นามสกุล"]]].map(norm).filter(Boolean).join(" ");
    const x = { name, ...empty(), inc401: r2(g(r, "Total Income")), tax: r2(g(r, "WHT")), sso: r2(g(r, "SSO")), pvd: r2(g(r, "PVD")) };
    if (FIELDS.every(f => !x[f])) { skipped++; continue; }
    add(rows, c, x);
  }
  return { rows, skipped };
}
export function parseTsHist(inc, ded) {
  const rows = new Map(); let skipped = 0;
  const walk = (aoa, fn) => { const ix = idxOf(aoa[0] || []); if (!("รหัสพนักงาน" in ix)) return 0; let n = 0;
    for (const r of aoa.slice(1)) { const c = code(r?.[ix["รหัสพนักงาน"]]); if (!isEmp(c)) continue; n++; fn(c, r, ix); } return n; };
  const get = c => rows.get(c) || (rows.set(c, { name: "", ...empty() }), rows.get(c));
  const SKIP = new Set(["CGM", "รหัสพนักงาน", "ชื่อ-นามสกุล", "ชื่อ"]);
  const nInc = walk(inc, (c, r, ix) => { const x = get(c);
    for (const [k, i] of Object.entries(ix)) {
      if (SKIP.has(k)) continue;
      const v = num(r[i]); if (!v) continue;
      if (k === "เงินชดเชย1" || k === "เงินชดเชย2") x.sev += v; else if (k === "ค่าตอบแทนกรรมการ") x.inc402 += v; else x.inc401 += v;
    } });
  const nDed = walk(ded, (c, r, ix) => { const x = get(c), g = k => k in ix ? num(r[ix[k]]) : 0;
    x.inc401 -= LESS.reduce((s, k) => s + g(k), 0);
    x.tax += g("ภาษี"); x.sev_tax += g("ภาษีชดเชย") + g("ภาษีเงินชดเชย"); x.sso += g("ประกันสังคม"); x.pvd += g("กองทุนสำรองเลี้ยงชีพ"); });
  if (!nInc && !nDed) throw new Error("ไฟล์ รายได้/รายหัก ไม่มีคอลัมน์ “รหัสพนักงาน” ที่เป็นรหัส AKR — หัวตารางอาจเลื่อน (เช่น ไฟล์ ม.ค. 2569) ใช้ไฟล์ Excel เงินเดือนแทน");
  for (const [c, x] of rows) { FIELDS.forEach(f => { x[f] = r2(x[f]); }); if (FIELDS.every(f => !x[f])) { rows.delete(c); skipped++; } }
  return { rows, skipped };
}
// คนเดียวมีหลายแถวในไฟล์ (เช่น จ่ายสองรอบ) → รวมกัน
function add(rows, c, x) {
  const o = rows.get(c);
  if (!o) { rows.set(c, x); return; }
  FIELDS.forEach(f => { o[f] = r2(o[f] + x[f]); }); o.name ||= x.name;
}

// ---------------------------------------------------------------- ไฟล์ ภ.ง.ด.1 / ภ.ง.ด.1ก (ข้อความคั่นด้วย | จากโปรแกรมยื่นแบบ)
// ภ.ง.ด.1: 00|สาขา|เลขผู้เสียภาษีบริษัท|…|เลขผู้มีเงินได้|…|คำนำหน้า|ชื่อ|สกุล|ที่อยู่1|ที่อยู่2|ไปรษณีย์|เดือน|ปี พ.ศ.|ประเภทเงินได้|วันที่จ่าย|อัตรา|เงินได้|ภาษี|เงื่อนไข
// ไฟล์อื่นที่ไม่ตรงตำแหน่งนี้: หาเลข 13 หลักที่ไม่ใช่ของบริษัท + ตัวเลขทศนิยมสองตัวสุดท้าย = เงินได้/ภาษี
export function parsePnd(text, companyId = "") {
  const out = [], months = new Set();
  for (const line of String(text || "").replace(/^﻿/, "").split(/\r?\n/)) {
    const f = line.split("|").map(s => s.trim());
    if (f.length < 6) continue;
    if (f.length >= 20 && /^\d{13}$/.test(f[5]) && /^\d{1,2}$/.test(f[13]) && /^\d{4}$/.test(f[14])) {
      const ym = +f[13] ? `${+f[14] - 543}-${String(+f[13]).padStart(2, "0")}` : null; if (ym) months.add(ym);
      out.push({ tax_id: f[5], title: f[7], first: f[8], last: f[9], addr1: f[10], addr2: f[11], zip: f[12], ym, type: f[15] || "1",
        pay_date: f[16] || null, income: r2(num(f[18])), tax: r2(num(f[19])), cond: f[20] || "" });
      continue;
    }
    const id = f.find(x => /^\d{13}$/.test(x) && x !== companyId); if (!id) continue;
    const nums = f.filter(x => /^-?\d+\.\d{2}$/.test(x));
    if (nums.length < 2) continue;
    const i = f.indexOf(id), txt = f.slice(i + 1).filter(x => x && !/^[\d.\-/]+$/.test(x));
    out.push({ tax_id: id, title: txt[0] || "", first: txt[1] || "", last: txt[2] || "", addr1: txt[3] || "", addr2: txt[4] || "", zip: "", ym: null, type: "1",
      pay_date: null, income: r2(num(nums[nums.length - 2])), tax: r2(num(nums[nums.length - 1])), cond: "" });
  }
  return { rows: out, months: [...months].sort() };
}

// เลขประจำตัวผู้เสียภาษี 13 หลัก — หลักสุดท้ายเป็นเลขตรวจสอบ
export function validTaxId(id) {
  const d = String(id || "");
  if (!/^\d{13}$/.test(d)) return false;
  let s = 0; for (let i = 0; i < 12; i++) s += +d[i] * (13 - i);
  return (11 - (s % 11)) % 10 === +d[12];
}

// จับคู่แถว ภ.ง.ด. กับรหัสพนักงาน: เลขผู้เสียภาษีที่รู้แล้ว → ชื่อ-สกุลตรงกับทะเบียนพนักงาน (ต้องตรงคนเดียว)
export function matchPnd(rows, people, emps) {
  const byId = new Map(people.filter(p => p.tax_id).map(p => [p.tax_id, p.emp_code]));
  const byName = new Map();
  for (const e of emps) { const k = norm(`${e.firstname_th || ""} ${e.lastname_th || ""}`); if (k) byName.set(k, byName.has(k) ? null : e.emp_code); }
  return rows.map(x => ({ ...x, emp_code: byId.get(x.tax_id) || byName.get(norm(`${x.first} ${x.last}`)) || null }));
}

// ---------------------------------------------------------------- รวมทั้งปี
// items = แถว tax_income ของปีนั้น ({ym, emp_code, ...FIELDS}) → Map(code → {...FIELDS, months:[ym], last})
export function yearTotals(items) {
  const m = new Map();
  for (const i of items) {
    const o = m.get(i.emp_code) || (m.set(i.emp_code, { ...empty(), months: [] }), m.get(i.emp_code));
    FIELDS.forEach(f => { o[f] = r2(o[f] + num(i[f])); });
    o.months.push(i.ym);
  }
  for (const o of m.values()) { o.months.sort(); o.last = o.months[o.months.length - 1]; }
  return m;
}
export const income = t => r2(num(t.inc401) + num(t.inc402) + num(t.sev));
export const taxAll = t => r2(num(t.tax) + num(t.sev_tax));
export const sumBy = (rows, f) => r2(rows.reduce((s, x) => s + num(typeof f === "function" ? f(x) : x[f]), 0));

// ---------------------------------------------------------------- กระทบยอดกับ ภ.ง.ด.1 รายเดือน
// reg = แถว tax_income ของเดือน · pnd = แถว tax_pnd ของเดือน (จับคู่ emp_code แล้ว) → { totals, issues }
export function reconcileMonth(reg, pnd) {
  const R = new Map(reg.map(x => [x.emp_code, x])), P = new Map(), unmatched = [];
  for (const p of pnd) {
    if (!p.emp_code) { unmatched.push(p); continue; }
    const o = P.get(p.emp_code) || (P.set(p.emp_code, { income: 0, tax: 0, tax_id: p.tax_id }), P.get(p.emp_code));
    o.income = r2(o.income + num(p.income)); o.tax = r2(o.tax + num(p.tax));
  }
  const issues = [];
  for (const [c, x] of R) {
    const p = P.get(c), ri = income(x), rt = taxAll(x);
    if (!p) { if (ri || rt) issues.push({ emp_code: c, kind: "not_in_pnd", reg: { income: ri, tax: rt }, pnd: null }); continue; }
    if (Math.abs(ri - p.income) >= 0.01 || Math.abs(rt - p.tax) >= 0.01) issues.push({ emp_code: c, kind: "diff", reg: { income: ri, tax: rt }, pnd: { income: p.income, tax: p.tax } });
  }
  for (const [c, p] of P) if (!R.has(c)) issues.push({ emp_code: c, kind: "not_in_reg", reg: null, pnd: { income: p.income, tax: p.tax } });
  for (const p of unmatched) issues.push({ emp_code: null, kind: "unmatched", name: norm(`${p.title}${p.first} ${p.last}`), tax_id: p.tax_id, reg: null, pnd: { income: p.income, tax: p.tax } });
  return { totals: { reg: { n: reg.length, income: sumBy(reg, income), tax: sumBy(reg, taxAll) }, pnd: { n: pnd.length, income: sumBy(pnd, "income"), tax: sumBy(pnd, "tax") } }, issues };
}

// ---------------------------------------------------------------- 50 ทวิ
// ใบที่ลงนามแล้วแต่ตัวเลขในทะเบียนเปลี่ยน → ต้องยกเลิกแล้วออกใหม่
export const CERT_FIELDS = ["inc401", "inc402", "sev", "tax", "sev_tax", "sso", "pvd"];
export const certStale = (cert, tot) => !tot || CERT_FIELDS.some(f => Math.abs(num(cert[f]) - num(tot[f])) >= 0.01);

// สิ่งที่ต้องดูก่อนออกใบของคนหนึ่ง: level warn = ออกไม่ได้ · info = ให้ HR ดู
export function certChecks(p, tot, emp) {
  const out = [];
  if (!p?.tax_id) out.push({ level: "warn", text: "ไม่มีเลขประจำตัวผู้เสียภาษี" });
  else if (!validTaxId(p.tax_id)) out.push({ level: "warn", text: "เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง (เลขตรวจสอบไม่ผ่าน)" });
  if (!p?.address) out.push({ level: "info", text: "ไม่มีที่อยู่" });
  if (tot && num(tot.inc402)) out.push({ level: "info", text: "มีเงินได้ 40(2) (ค่าตอบแทนกรรมการ) แยกบรรทัด" });
  if (tot && num(tot.sev)) out.push({ level: "info", text: "มีเงินชดเชยออกจากงาน — แสดงในข้อ 6 อื่น ๆ" });
  if (tot && num(tot.co_tax)) out.push({ level: "info", text: "มีภาษีที่บริษัทออกให้ — ตรวจช่องผู้จ่ายเงิน (2)/(3)" });
  if (tot && !income(tot) && !taxAll(tot)) out.push({ level: "warn", text: "ไม่มีเงินได้ในปีนี้" });
  if (emp && !emp.firstname_th) out.push({ level: "info", text: "ไม่พบในทะเบียนพนักงาน" });
  return out;
}

// คนที่ลาออกในปี ยังไม่มีใบที่ลงนาม — กฎหมายให้ออก 50 ทวิ ภายใน 1 เดือนนับจากวันออกจากงาน
export function leaverAlerts(emps, certs, year, today) {
  const done = new Set(certs.filter(c => c.status === "signed").map(c => c.emp_code));
  const out = [];
  for (const e of emps) {
    const end = e.end_date ? String(e.end_date).slice(0, 10) : null;
    if (!end || end.slice(0, 4) !== String(year) || end > today || done.has(e.emp_code)) continue;
    const due = addMonth(end);
    out.push({ emp_code: e.emp_code, end, due, overdue: due < today });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}
const addMonth = d => { const [y, m, dd] = d.split("-").map(Number), t = new Date(Date.UTC(y, m, dd)); return t.toISOString().slice(0, 10); };

// ---------------------------------------------------------------- ใบงาน ภ.ง.ด.1ก (Excel ให้ HR ตรวจ/คีย์) — ลำดับตามเลขที่ 50 ทวิ
export const PND1K_HEAD = ["ลำดับที่", "เลขประจำตัวผู้เสียภาษี", "คำนำหน้า", "ชื่อ", "ชื่อสกุล", "ที่อยู่", "รหัสไปรษณีย์", "ประเภทเงินได้", "จำนวนเงินได้ทั้งปี", "ภาษีที่หักและนำส่งทั้งปี", "เงื่อนไข", "รหัสพนักงาน"];
export function pnd1kRows(list) {
  // list = [{seq, emp_code, person:{tax_id,title,first,last,address,zip}, tot}]
  const out = [];
  for (const x of list) {
    const p = x.person || {}, t = x.tot, base = [x.seq ?? "", p.tax_id || "", p.title || "", p.first || "", p.last || "", p.address || "", p.zip || ""];
    if (num(t.inc401) || num(t.tax)) out.push([...base, "40(1) เงินเดือน ค่าจ้าง", r2(t.inc401), r2(t.tax), 1, x.emp_code]);
    if (num(t.sev) || num(t.sev_tax)) out.push([...base, "40(1) จ่ายครั้งเดียวเพราะเหตุออกจากงาน", r2(t.sev), r2(t.sev_tax), 1, x.emp_code]);
    if (num(t.inc402)) out.push([...base, "40(2)", r2(t.inc402), 0, 1, x.emp_code]);
  }
  return out;
}

// จำนวนเงินเป็นตัวอักษร (บาทถ้วน/สตางค์)
const TD = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"], TP = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];
function thInt(n) {
  if (n === 0) return "";
  if (n >= 1e6) return thInt(Math.floor(n / 1e6)) + "ล้าน" + thInt(n % 1e6);
  const s = String(n); let o = "";
  for (let i = 0; i < s.length; i++) {
    const d = +s[i], p = s.length - i - 1; if (!d) continue;
    o += (p === 0 && d === 1 && s.length > 1 ? "เอ็ด" : p === 1 && d === 2 ? "ยี่" : p === 1 && d === 1 ? "" : TD[d]) + TP[p];
  }
  return o;
}
export function bahtText(v) {
  const a = Math.round(Math.abs(num(v)) * 100), b = Math.floor(a / 100), s = a % 100;
  if (!a) return "ศูนย์บาทถ้วน";
  return (b ? thInt(b) + "บาท" : "") + (s ? thInt(s) + "สตางค์" : "ถ้วน");
}
