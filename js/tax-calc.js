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
// เงินได้เก็บเป็น "รายการ" ทีละคอลัมน์ของไฟล์ (items: { คอลัมน์: ยอด } · ขาด/ลา/… เป็นค่าลบ · ยอดรวมที่อธิบายด้วยคอลัมน์ไม่ได้ → UNEXPLAINED)
// แล้วแยกเป็น 40(1) / ออกจากงาน / 40(2) / ไม่นับ ตาม "ประเภทเงินได้" ของแต่ละคอลัมน์ (HR ยืนยันในหน้าเว็บ · user 2026-11-16)
// คอลัมน์ที่ยังไม่เคยยืนยัน → ระบบเสนอประเภทจากชื่อ (suggestType) และต้องยืนยันก่อนบันทึก
// ตรวจแล้ว: YDP เงินเดือน…(ก่อน ขาด) = รวมรายได้ ทุกคน ก.ค.–ต.ค. 2569 · Excel (Join Date…Total Income ไม่นับ "Income" ที่เป็นยอดย่อย) = Total Income ม.ค.–ก.ค.
export const UNEXPLAINED = "(ส่วนต่างที่ไม่ระบุคอลัมน์)";
export const LESS = ["ขาด", "ลา", "มาสาย", "ออกก่อน", "พักงาน"];
// ประเภทเงินได้ → บรรทัดใน 50 ทวิ และประเภทใน ภ.ง.ด.1
export const TYPES = {
  inc: { th: "เงินเดือน ค่าจ้าง", law: "40(1)", line: "ข้อ 1", pnd: "1", field: "inc401" },
  sev: { th: "ออกจากงาน (จ่ายครั้งเดียว)", law: "40(1)(2)", line: "ข้อ 6", pnd: "3", field: "sev" },
  inc402: { th: "ค่าตอบแทน / ค่านายหน้า", law: "40(2)", line: "ข้อ 2", pnd: "4", field: "inc402" },
  off: { th: "ไม่ใช่เงินได้", law: "—", line: "ไม่ลง 50 ทวิ", pnd: null, field: null },
};
export const TYPE_KEYS = Object.keys(TYPES);
const SUGGEST = [
  [/ชดเชย|severance|บอกกล่าว|advance notice/i, "sev", "จ่ายเพราะออกจากงาน — ชื่อมีคำว่า “$&”"],
  [/กรรมการ|director|ที่ปรึกษา|consult|นายหน้า|commission/i, "inc402", "ค่าตอบแทนที่ไม่ใช่ค่าจ้างพนักงาน — ชื่อมีคำว่า “$&”"],
  [/เบิกเงินล่วงหน้า|เงินยืม|\bloan\b|reimburs|เงินคืนค่า|คืนค่าใช้จ่าย|ตามจริง/i, "off", "เงินยืม/เงินคืนค่าใช้จ่าย ไม่ใช่เงินได้ — ชื่อมีคำว่า “$&”"],
];
// ระบบเสนอประเภทจากชื่อคอลัมน์ → { type, why }
export function suggestType(col) {
  for (const [re, type, why] of SUGGEST) { const m = String(col).match(re); if (m) return { type, why: why.replace("$&", m[0]) }; }
  return { type: "inc", why: "เงินที่ได้จากการจ้างงาน (เงินเดือน ค่าล่วงเวลา เบี้ยเลี้ยง สวัสดิการที่จ่ายเป็นเงิน)" };
}
const fixed = k => LESS.includes(k) || k === UNEXPLAINED;
export const typeOf = (col, types = {}) => fixed(col) ? "inc" : types[col] || suggestType(col).type;
// รายการ → { inc401, sev, inc402 } ตามประเภทของแต่ละคอลัมน์
export function split(items, types = {}) {
  const o = { inc401: 0, sev: 0, inc402: 0 };
  for (const [k, v] of Object.entries(items || {})) { const f = TYPES[typeOf(k, types)].field; if (f) o[f] += v; }
  return { inc401: r2(o.inc401), sev: r2(o.sev), inc402: r2(o.inc402) };
}
// สรุปทีละคอลัมน์ไว้โชว์ก่อนบันทึก: { คอลัมน์: { kind: inc|less, total, n } }
function item(x, cols, k, kind, v) {
  if (!v) return;
  const c = cols[k] ||= { kind, total: 0, n: 0 }; c.total = r2(c.total + v); c.n++;
  x.items[k] = r2((x.items[k] || 0) + v);
}
function finish(x, types) { Object.assign(x, split(x.items, types)); return x; }

// sheets = { ชื่อแผ่น: aoa } · opts.types = { คอลัมน์: inc|sev|inc402|off } ที่ HR ยืนยันแล้ว
// → { format, rows: Map(code → {name, items, ...FIELDS}), skipped, cols }
export function readPayroll(sheets, opts = {}) {
  for (const aoa of Object.values(sheets)) {
    const ix = idxOf(aoa[0] || []);
    if (has(ix, "รหัสพนักงาน", "รวมรายได้", "ภาษี")) return { format: "ydp", ...parseYDP(aoa, opts) };
  }
  for (const aoa of Object.values(sheets)) {
    const hi = aoa.slice(0, 15).findIndex(r => (r || []).some(c => norm(c) === "Employee No."));
    if (hi >= 0 && has(idxOf(aoa[hi]), "Total Income", "WHT")) return { format: "excel", ...parseExcel(aoa, hi, opts) };
  }
  if (sheets["รายได้"] && sheets["รายหัก"]) return { format: "tshist", ...parseTsHist(sheets["รายได้"], sheets["รายหัก"], opts) };
  throw new Error("ไม่รู้จักรูปแบบไฟล์ — ใช้ BeforeProcessYDP (TigerSoft), Payroll - <เดือน>.xlsx (แผ่น Salary Final) หรือ Payroll-Tigersoft_…-ไม่sum.xlsx");
}

export function parseYDP(aoa, opts = {}) {
  const ix = idxOf(aoa[0]), g = (r, k) => k in ix ? num(r[ix[k]]) : 0, rows = new Map(), cols = {}, types = opts.types || {}; let skipped = 0;
  const h = (aoa[0] || []).map(norm);
  // คอลัมน์รายได้ = ตั้งแต่ "เงินเดือน" จนก่อน "ขาด" (ในไฟล์รวมกันได้ "รวมรายได้")
  const a = ix["เงินเดือน"] ?? -1, b = ix["ขาด"] ?? -1;
  const incCols = a >= 0 && b > a ? h.map((k, i) => [k, i]).filter(([k, i]) => i >= a && i < b && k)
    : ["เงินชดเชย1", "เงินชดเชย2", "ค่าตอบแทนกรรมการ"].filter(k => k in ix).map(k => [k, ix[k]]);
  for (const r of aoa.slice(1)) {
    const c = code(r?.[ix["รหัสพนักงาน"]]); if (!isEmp(c)) continue;
    const x = { name: norm(r[ix["ชื่อ-นามสกุล"]]), items: {}, ...empty(),
      tax: r2(g(r, "ภาษี")), sev_tax: r2(g(r, "ภาษีเงินชดเชย")), sso: r2(g(r, "ประกันสังคม")), pvd: r2(g(r, "กองทุนสำรองเลี้ยงชีพ")),
      co_tax: r2(g(r, "ภาษีบริษัทจ่ายให้")), wef: r2(g(r, "กองทุนสงเคราะห์ลูกจ้าง")) };
    const pc = {}; let sum = 0;
    for (const [k, i] of incCols) { const v = num(r[i]); sum += v; item(x, pc, k, "inc", v); }
    item(x, pc, UNEXPLAINED, "inc", r2(g(r, "รวมรายได้") - sum));
    for (const k of LESS) item(x, pc, k, "less", -g(r, k));
    finish(x, types);
    if (FIELDS.every(f => !x[f])) { skipped++; continue; }          // TigerSoft ใส่คนลาออกแล้วมาด้วย ยอดศูนย์ทั้งแถว
    merge(cols, pc); add(rows, c, x, types);
  }
  return { rows, skipped, cols };
}
export function parseExcel(aoa, hi, opts = {}) {
  const ix = idxOf(aoa[hi]), g = (r, k) => k in ix ? num(r[ix[k]]) : 0, rows = new Map(), cols = {}, types = opts.types || {}; let skipped = 0;
  const h = (aoa[hi] || []).map(norm), a = ix["Join Date"] ?? -1, t = ix["Total Income"];
  // คอลัมน์รายได้ = ระหว่าง Join Date กับ Total Income · "Income" = เงินเดือน + ค่ากะ (ยอดย่อย) ไม่นับซ้ำ
  const incCols = a >= 0 && t > a ? h.map((k, i) => [k, i]).filter(([k, i]) => i > a && i < t && k && !(k === "Income" && "Salary" in ix)) : [];
  for (const r of aoa.slice(hi + 1)) {
    const c = code(r?.[ix["Employee No."]]); if (!isEmp(c)) continue;
    const name = [r[ix["ชื่อ"]], r[ix["นามสกุล"]]].map(norm).filter(Boolean).join(" ");
    const x = { name, items: {}, ...empty(), tax: r2(g(r, "WHT")), sso: r2(g(r, "SSO")), pvd: r2(g(r, "PVD")) };
    const pc = {}; let sum = 0;
    for (const [k, i] of incCols) { const v = num(r[i]); sum += v; item(x, pc, k, "inc", v); }
    item(x, pc, UNEXPLAINED, "inc", r2(g(r, "Total Income") - sum));
    finish(x, types);
    if (FIELDS.every(f => !x[f])) { skipped++; continue; }
    merge(cols, pc); add(rows, c, x, types);
  }
  return { rows, skipped, cols };
}
export function parseTsHist(inc, ded, opts = {}) {
  const rows = new Map(), cols = {}, types = opts.types || {}; let skipped = 0;
  const walk = (aoa, fn) => { const ix = idxOf(aoa[0] || []); if (!("รหัสพนักงาน" in ix)) return 0; let n = 0;
    for (const r of aoa.slice(1)) { const c = code(r?.[ix["รหัสพนักงาน"]]); if (!isEmp(c)) continue; n++; fn(c, r, ix); } return n; };
  const get = c => rows.get(c) || (rows.set(c, { name: "", items: {}, ...empty() }), rows.get(c));
  const SKIP = new Set(["CGM", "รหัสพนักงาน", "ชื่อ-นามสกุล", "ชื่อ"]);
  const nInc = walk(inc, (c, r, ix) => { const x = get(c);
    for (const [k, i] of Object.entries(ix)) if (!SKIP.has(k)) item(x, cols, k, "inc", num(r[i]));
  });
  const nDed = walk(ded, (c, r, ix) => { const x = get(c), g = k => k in ix ? num(r[ix[k]]) : 0;
    for (const k of LESS) item(x, cols, k, "less", -g(k));
    x.tax += g("ภาษี"); x.sev_tax += g("ภาษีชดเชย") + g("ภาษีเงินชดเชย"); x.sso += g("ประกันสังคม"); x.pvd += g("กองทุนสำรองเลี้ยงชีพ"); });
  if (!nInc && !nDed) throw new Error("ไฟล์ รายได้/รายหัก ไม่มีคอลัมน์ “รหัสพนักงาน” ที่เป็นรหัส AKR — หัวตารางอาจเลื่อน (เช่น ไฟล์ ม.ค. 2569) ใช้ไฟล์ Excel เงินเดือนแทน");
  for (const [c, x] of rows) { finish(x, types); FIELDS.forEach(f => { x[f] = r2(x[f]); }); if (FIELDS.every(f => !x[f])) { rows.delete(c); skipped++; } }
  return { rows, skipped, cols };
}
function merge(cols, pc) { for (const [k, c] of Object.entries(pc)) { const o = cols[k] ||= { kind: c.kind, total: 0, n: 0 }; o.total = r2(o.total + c.total); o.n += c.n; } }
// คนเดียวมีหลายแถวในไฟล์ (เช่น จ่ายสองรอบ) → รวมกัน
function add(rows, c, x, types) {
  const o = rows.get(c);
  if (!o) { rows.set(c, x); return; }
  for (const [k, v] of Object.entries(x.items || {})) o.items[k] = r2((o.items[k] || 0) + v);
  FIELDS.forEach(f => { o[f] = r2(o[f] + x[f]); }); Object.assign(o, split(o.items, types)); o.name ||= x.name;
}
// ประเภทเปลี่ยน → คิดแถวที่อ่านแล้วใหม่ (ไม่ต้องอ่านไฟล์ซ้ำ)
export function reType(rows, types) { for (const x of rows.values()) Object.assign(x, split(x.items, types)); }
// สรุปทีละคอลัมน์สำหรับหน้าจัดประเภท: { col, kind: less|fixed|col, type, isNew, why, total, n }
export function colList(cols, types = {}) {
  return Object.entries(cols || {}).filter(([, c]) => c.total || c.n).map(([k, c]) => {
    if (c.kind === "less") return { col: k, ...c, kind: "less", type: "inc" };
    if (k === UNEXPLAINED) return { col: k, ...c, kind: "fixed", type: "inc" };
    const sg = suggestType(k);
    return { col: k, ...c, kind: "col", type: types[k] || sg.type, isNew: !types[k], suggest: sg.type, why: sg.why };
  });
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

// ไฟล์ ภ.ง.ด.1 แบบ Excel (แบบฟอร์มนำเข้าของกรมสรรพากร): ลำดับ | บัตร ปชช | คำหน้า | ชื่อ | สกุล | เงินได้ตามมาตรา | วันเดือนปีที่จ่าย | เงินได้ | ภาษี | เงื่อนไข
// วันที่จ่ายเก็บเป็นปี พ.ศ. ในเซลล์วันที่ (เช่น 13/02/2569) → เดือนของรอบ · ไม่มีที่อยู่ (ที่อยู่มาจากไฟล์ txt หรือ HR กรอก)
const excelDate = v => {
  if (typeof v === "number") { const d = new Date(Math.round((v - 25569) * 864e5)); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]; }
  const m = String(v ?? "").match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/) || String(v ?? "").match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return m[1].length === 4 ? [+m[1], +m[2], +m[3]] : [+m[3], +m[2], +m[1]];
};
export function parsePndSheet(aoa) {
  const hi = aoa.slice(0, 15).findIndex(r => (r || []).some(c => /บัตร|เลขประจำตัว/.test(norm(c))) && (r || []).some(c => /^เงินได้$|จำนวนเงิน/.test(norm(c))));
  if (hi < 0) return null;
  const h = aoa[hi].map(norm), col = re => h.findIndex(x => re.test(x));
  const C = { id: col(/บัตร|เลขประจำตัว/), title: col(/คำ(นำ)?หน้า/), first: col(/^ชื่อ$/), last: col(/สกุล/), type: col(/มาตรา|ประเภท/),
    date: col(/วัน/), income: col(/^เงินได้$|จำนวนเงิน/), tax: col(/^ภาษี|จำนวนเงินภาษี/), cond: col(/เงื่อนไข/) };
  const out = [], months = new Set(), unknown = new Set();
  for (const r of aoa.slice(hi + 1)) {
    const id = String(r?.[C.id] ?? "").replace(/\D/g, "").padStart(13, "0");
    if (!/^\d{13}$/.test(id) || /^0+$/.test(id)) continue;
    const d = C.date >= 0 ? excelDate(r[C.date]) : null; let ym = null;
    if (d) { const y = d[0] > 2400 ? d[0] - 543 : d[0]; ym = `${y}-${String(d[1]).padStart(2, "0")}`; months.add(ym); }
    const pc = pndCode(C.type >= 0 ? r[C.type] : "1"); if (!pc.known) unknown.add(norm(r[C.type]));
    out.push({ tax_id: id, title: norm(r[C.title]), first: norm(r[C.first]), last: norm(r[C.last]), addr1: "", addr2: "", zip: "", ym,
      type: pc.type, code: norm(C.type >= 0 ? r[C.type] : ""), pay_date: d ? d.join("-") : null, income: r2(num(r[C.income])), tax: r2(num(r[C.tax])), cond: norm(r[C.cond]) });
  }
  return { rows: out, months: [...months].sort(), unknown: [...unknown] };
}
// ชื่อชุดที่ยื่น เดาจากชื่อไฟล์ (เดือนหนึ่งยื่นได้หลายชุด: พนักงาน / กรรมการ / ยื่นเพิ่มเติม)
export function guessPart(name) {
  const s = String(name || "");
  if (/director|กรรมการ/i.test(s)) return "กรรมการ";
  if (/เพิ่มเติม|additional|amend|addition/i.test(s)) return "ยื่นเพิ่มเติม";
  if (/staff|พนักงาน|employee/i.test(s)) return "พนักงาน";
  return "หลัก";
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
// ประเภทเงินได้ใน ภ.ง.ด.1 (ตามแบบ/ใบแนบ): 1 = 40(1) ทั่วไป · 2 = 40(1) อัตรา 3% ที่ได้รับอนุมัติ · 3 = 40(1)(2) จ่ายครั้งเดียวเพราะออกจากงาน
//   4 = 40(2) ผู้อยู่ในไทย · 5 = 40(2) ผู้ไม่อยู่ในไทย · ไฟล์ Excel แบบใหม่ใช้รหัส 401N/401S/402I/402E (user 2026-11-16: ทั้งชุดพนักงานและกรรมการ = 401N)
export const PND_TYPE = { 1: "40(1) ทั่วไป", 2: "40(1) อัตรา 3%", 3: "ออกจากงาน", 4: "40(2) อยู่ในไทย", 5: "40(2) ไม่อยู่ในไทย" };
const PND_CODE = { "401N": "1", "401S": "2", "402I": "4", "402E": "5" };
// รหัสในไฟล์ → { type: "1".."5", known }
export function pndCode(raw) {
  const c = norm(raw).toUpperCase();
  if (/^[1-5]$/.test(c)) return { type: c, known: true };
  if (PND_CODE[c]) return { type: PND_CODE[c], known: true };
  return { type: /^402/.test(c) ? "4" : "1", known: false };
}
// ประเภทใน ภ.ง.ด.1 → ช่องในทะเบียน
export const pndField = t => t === "3" ? "sev" : t === "4" || t === "5" ? "inc402" : "inc401";
const FIELD_TH_SHORT = { inc401: "เงินเดือน 40(1)", sev: "ออกจากงาน", inc402: "40(2)" };
export function reconcileMonth(reg, pnd) {
  const R = new Map(reg.map(x => [x.emp_code, x])), P = new Map(), unmatched = [];
  for (const p of pnd) {
    if (!p.emp_code) { unmatched.push(p); continue; }
    const o = P.get(p.emp_code) || (P.set(p.emp_code, { income: 0, tax: 0, tax_id: p.tax_id, by: { inc401: 0, sev: 0, inc402: 0 } }), P.get(p.emp_code));
    const f = pndField(pndCode(p.type).type);
    o.income = r2(o.income + num(p.income)); o.tax = r2(o.tax + num(p.tax)); o.by[f] = r2(o.by[f] + num(p.income));
  }
  const issues = [];
  for (const [c, x] of R) {
    const p = P.get(c), ri = income(x), rt = taxAll(x);
    if (!p) { if (ri || rt) issues.push({ emp_code: c, kind: "not_in_pnd", reg: { income: ri, tax: rt }, pnd: null }); continue; }
    if (Math.abs(ri - p.income) >= 0.01 || Math.abs(rt - p.tax) >= 0.01) { issues.push({ emp_code: c, kind: "diff", reg: { income: ri, tax: rt }, pnd: { income: p.income, tax: p.tax } }); continue; }
    // ยอดรวมตรง แต่ลงคนละประเภท (เช่น ทะเบียนเป็นเงินเดือน แต่ยื่นเป็นเงินออกจากงาน)
    const rb = { inc401: num(x.inc401), sev: num(x.sev), inc402: num(x.inc402) }, bad = Object.keys(rb).filter(t => Math.abs(rb[t] - p.by[t]) >= 0.01);
    if (bad.length) issues.push({ emp_code: c, kind: "type", reg: { income: ri, tax: rt }, pnd: { income: p.income, tax: p.tax },
      detail: bad.map(t => `${FIELD_TH_SHORT[t]}: ทะเบียน ${rb[t].toLocaleString("en-US", { minimumFractionDigits: 2 })} · ภ.ง.ด.1 ${p.by[t].toLocaleString("en-US", { minimumFractionDigits: 2 })}`).join(" · ") });
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
