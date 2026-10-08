// ============================================================================
// HR Spend — ตรรกะคำนวณและแปลงไฟล์ Excel เดิม (ฟังก์ชันบริสุทธิ์ ไม่แตะ DOM/DB — เทสได้ตรง ๆ)
//   ยอดต่อบรรทัด: VAT = จำนวนเงิน × 7% (ถ้าติ๊ก) · หัก ณ ที่จ่าย = จำนวนเงิน (ก่อน VAT) × อัตราทั้งใบ
//   สุทธิ = จำนวนเงิน + VAT − หัก ณ ที่จ่าย · ปัด 2 ตำแหน่งทีละบรรทัด แล้วค่อยรวม (ตรงกับใบเดิมใน Excel)
//   ตัวอย่างจริง HRIN332/2026: 42,380.00 + 2,966.60 − 1,271.40 = 44,075.20
// ============================================================================

export const round2 = v => Math.round((Number(v) || 0) * 100 + Number.EPSILON * 100) / 100;
export const WHT_RATES = [0, 1, 2, 3, 5];

export function lineCalc(line, whtRate = 0) {
  const amount = round2(line.amount);
  const vat = round2(amount * (Number(line.vat_rate) || 0) / 100);
  const wht = round2(amount * (Number(whtRate) || 0) / 100);
  return { amount, vat, wht, net: round2(amount + vat - wht) };
}

export function invoiceTotals(lines = [], whtRate = 0) {
  const t = { amount: 0, vat: 0, wht: 0, net: 0 };
  for (const l of lines) { const c = lineCalc(l, whtRate); for (const k in t) t[k] += c[k]; }
  for (const k in t) t[k] = round2(t[k]);
  return t;
}

// ปีงบ ก.ค.–มิ.ย. แบบเดียวกับหน้า Position Quota: ก.ค. 2026 – มิ.ย. 2027 = FY2027
export const fiscalYear = iso => { const [y, m] = String(iso).split("-").map(Number); return m >= 7 ? y + 1 : y; };

// ---------- จำนวนเงินเป็นตัวอักษรภาษาอังกฤษ (แบบเดียวกับใบเดิม: "Forty Four Thousand Seventy Five Baht and Twenty Satang Only")
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen",
              "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function words(n) {
  n = Math.floor(n);
  if (n === 0) return "";
  if (n < 20) return ONES[n];
  if (n < 100) return [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join(" ");
  if (n < 1000) return [ONES[Math.floor(n / 100)] + " Hundred", words(n % 100)].filter(Boolean).join(" ");
  for (const [v, name] of [[1e9, "Billion"], [1e6, "Million"], [1e3, "Thousand"]]) {
    if (n >= v) return [words(n / v) + " " + name, words(n % v)].filter(Boolean).join(" ");
  }
  return "";
}
export function amountWords(amount) {
  const v = round2(Math.abs(amount));
  const baht = Math.floor(v), satang = Math.round((v - baht) * 100);
  const b = baht ? words(baht) + " Baht" : (satang ? "" : "Zero Baht");
  const s = satang ? words(satang) + " Satang" : "";
  return [b, s].filter(Boolean).join(" and ") + " Only";
}

// ---------- นำเข้า "HR Invoice Database_2025.xlsm" (ชีต Vendor + Data)
// rows = sheet_to_json(..., { header: 1, raw: true }) ของแต่ละชีต — หาแถวหัวตารางจากชื่อคอลัมน์ ไม่ยึดเลขแถว
const norm = s => String(s ?? "").replace(/\s+/g, " ").trim();
const headerAt = (rows, need) => rows.findIndex(r => (r || []).some(c => norm(c) === need));
const col = (head, ...names) => { for (const n of names) { const i = head.findIndex(c => norm(c).toLowerCase() === n.toLowerCase()); if (i >= 0) return i; } return -1; };
function toISO(v) {
  if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) {           // Excel serial date
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5); return d.toISOString().slice(0, 10);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || "")); return m ? m[0] : null;
}
const codeStr = v => { if (v == null) return ""; if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v); return norm(v); };
const num = v => { const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
// อัตราหัก ณ ที่จ่ายของทั้งใบ: เทียบกับอัตราที่ใช้จริง (0/1/2/3/5) ตัวที่ใกล้ที่สุด
export function inferWhtRate(amount, wht) {
  if (!(amount > 0) || !(wht > 0)) return 0;
  const pct = wht / amount * 100;
  return WHT_RATES.reduce((best, r) => Math.abs(r - pct) < Math.abs(best - pct) ? r : best, 0);
}

export function parseInvoiceDb(vendorRows = [], dataRows = []) {
  const warn = [];
  // ผู้ขาย
  const vh = headerAt(vendorRows, "V_Code");
  const vendors = [];
  if (vh < 0) warn.push("ไม่พบหัวตาราง V_Code ในชีต Vendor");
  else {
    const h = vendorRows[vh], ic = col(h, "V_Code"), iname = col(h, "Vendor"), iaddr = col(h, "Address"), ibank = col(h, "Bank");
    const seen = new Set();
    for (const r of vendorRows.slice(vh + 1)) {
      const code = norm(r?.[ic]); if (!code || seen.has(code)) continue; seen.add(code);
      const bank = norm(r?.[ibank]);
      vendors.push({ code, name: norm(r?.[iname]) || code, address: norm(r?.[iaddr]) || null, bank: bank && bank !== "0" ? bank : null });
    }
  }
  // ใบแจ้งหนี้: หนึ่งแถว = หนึ่งบรรทัด รวมเป็นใบตามเลขที่ (เรียงตามลำดับในไฟล์)
  const dh = headerAt(dataRows, "Invoice No.");
  const byNo = new Map();
  if (dh < 0) warn.push("ไม่พบหัวตาราง Invoice No. ในชีต Data");
  else {
    const h = dataRows[dh];
    const c = { no: col(h, "Invoice No."), date: col(h, "Date"), cat: col(h, "Category"), v: col(h, "V_Code"), cc: col(h, "Cost Code"),
                d1: col(h, "Detail_line 1"), amt: col(h, "Amount (THB)"), vat: col(h, "VAT"), wht: col(h, "WHT"), d2: col(h, "Home No. & Detail_line 2") };
    let badDate = 0;
    for (const r of dataRows.slice(dh + 1)) {
      const no = norm(r?.[c.no]); if (!/^HRIN\d+\/\d{4}$/i.test(no)) continue;
      const date = toISO(r?.[c.date]); if (!date) { badDate++; continue; }
      let inv = byNo.get(no);
      if (!inv) { inv = { inv_no: no.toUpperCase(), inv_date: date, category: norm(r?.[c.cat]) || null, vendor_code: norm(r?.[c.v]) || null, lines: [] }; byNo.set(no, inv); }
      inv.lines.push({ cost_code: codeStr(r?.[c.cc]) || null, detail: norm(r?.[c.d1]), detail2: c.d2 >= 0 ? (norm(r?.[c.d2]) || null) : null,
                       amount: round2(num(r?.[c.amt])), vat: round2(num(r?.[c.vat])), wht: round2(num(r?.[c.wht])) });
    }
    if (badDate) warn.push(`ข้าม ${badDate} แถวที่ไม่มีวันที่`);
  }
  const invoices = [...byNo.values()].map(i => {
    const a = i.lines.reduce((s, l) => s + l.amount, 0), w = i.lines.reduce((s, l) => s + l.wht, 0);
    return { ...i, wht_rate: inferWhtRate(a, w) };
  });
  const categories = [...new Set(invoices.map(i => i.category).filter(Boolean))].sort();
  const known = new Set(vendors.map(v => v.code));
  const missingVendors = [...new Set(invoices.map(i => i.vendor_code).filter(v => v && !known.has(v)))];
  if (missingVendors.length) warn.push(`ใบที่อ้างรหัสผู้ขายที่ไม่มีในชีต Vendor ${missingVendors.length} รหัส: ${missingVendors.slice(0, 5).join(", ")}${missingVendors.length > 5 ? " …" : ""}`);
  return { vendors, categories, invoices, warn };
}
