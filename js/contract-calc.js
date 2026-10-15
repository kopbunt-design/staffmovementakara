// ============================================================================
// ค่าจ้างเหมา 3% — ตรรกะล้วน (ไม่แตะ DOM/DB) · ใช้โดยเว็บ /contract (contract/ct.js) · เทส test/contract-payroll.test.js
//   ห้าม import app.js — ไฟล์นี้ถูกโหลดในเว็บแยกที่ไม่ได้บูตระบบ HR
// ============================================================================
export const round2 = v => Math.round((Number(v) || 0) * 100) / 100;

// ฐานภาษี = ค่าจ้างประจำ + รายได้ที่เข้าฐานภาษี (taxable) − รายหักที่ลดฐานภาษี (cuts_tax_base เช่นหักขาดงาน)
//   รายได้บางอย่างไม่ต้องเสียภาษี เช่นเบิกค่าใช้จ่ายคืน · รายหักส่วนใหญ่ (บังคับคดี เบิกล่วงหน้า) ไม่ลดฐาน
// สุทธิ = ค่าจ้าง + ได้เพิ่มทั้งหมด − ภาษี − หักทั้งหมด
export function calcItem(worker, adjusts = []) {
  const sum = list => list.reduce((s, a) => s + Number(a.amount || 0), 0);
  const base = round2(worker.monthly_rate);
  const earn = adjusts.filter(a => a.kind === "earning"), deduct = adjusts.filter(a => a.kind === "deduction");
  const extra = round2(sum(earn)), deducted = round2(sum(deduct));
  const taxBase = Math.max(0, round2(base + sum(earn.filter(a => a.taxable !== false)) - sum(deduct.filter(a => a.cuts_tax_base))));
  const pct = worker.wht_apply ? Number(worker.wht_percent ?? 3) : 0;
  const wht = round2(taxBase * pct / 100);
  return { base_amount: base, extra_amount: extra, deduct_amount: deducted, tax_base: taxBase, wht_percent: pct, wht_amount: wht, net_amount: round2(base + extra - wht - deducted) };
}

// รายการประจำที่ใช้กับงวดนี้: เปิดใช้งาน และงวดอยู่ในช่วง start..end (end ว่าง = ไม่มีกำหนด)
export function recurringFor(items = [], period) {
  return items.filter(i => i.is_active !== false && i.start_period <= period && (!i.end_period || i.end_period >= period));
}
// แปลงรายการประจำเป็นแถวรายการของงวด — คัดลอกชื่อและผลทางภาษีจากตั้งค่ารายการ ณ ตอนคำนวณ
export function adjustFromRecurring(item, code, runId) {
  const earning = code.kind === "earning";
  return { run_id: runId, worker_id: item.worker_id, kind: code.kind, label: code.name_th, amount: round2(item.amount),
           code_id: code.id, source: "recurring", worker_item_id: item.id, remark: item.note || null,
           taxable: earning ? code.tax_effect !== false : true, cuts_tax_base: !earning && !!code.tax_effect };
}
export function runTotals(items = []) {
  const sum = k => round2(items.reduce((s, i) => s + Number(i[k] || 0), 0));
  return { count: items.length, base: sum("base_amount"), extra: sum("extra_amount"), deduct: sum("deduct_amount"), wht: sum("wht_amount"), net: sum("net_amount") };
}

// คนที่อยู่ในงวด: ใช้งานอยู่ และสัญญาคร่อมเดือนนั้น (เริ่มไม่เกินสิ้นเดือน · สิ้นสุดไม่ก่อนต้นเดือน)
export function inPeriod(w, period) {
  if (!w.is_active) return false;
  const [y, m] = period.split("-").map(Number), last = `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  return (!w.start_date || w.start_date <= last) && (!w.end_date || w.end_date >= `${period}-01`);
}

// ตรวจก่อนจ่าย — คืนรายการเรื่องที่ต้องดู (block = ต้องแก้ก่อนส่งขออนุมัติ)
//   items = แถวในงวด · prev = แถวงวดก่อน · workers = ทะเบียน (ไว้ดูสัญญา) · ok = worker_id ที่ HR ยืนยันยอดต่างแล้ว
export const VARIANCE_PCT = 20, EXPIRY_DAYS = 30;
export function preChecks({ items, prev = [], workers = [], ok = [], period, today }) {
  const out = [], P = new Map(prev.map(i => [i.worker_id, i])), W = new Map(workers.map(w => [w.id, w]));
  const noTax = items.filter(i => Number(i.wht_amount) > 0 && !/^\d{13}$/.test(String(i.tax_id || "").replace(/\D/g, "")));
  if (noTax.length) out.push({ key: "tax", block: true, ids: noTax.map(i => i.worker_id), title: `ยังไม่มีเลขผู้เสียภาษี 13 หลัก ${noTax.length} คน`, text: "ออก 50 ทวิ และ ภ.ง.ด.3 ไม่ได้" });
  const noBank = items.filter(i => Number(i.net_amount) > 0 && String(i.bank_account || "").replace(/\D/g, "").length !== 10);
  if (noBank.length) out.push({ key: "bank", block: true, ids: noBank.map(i => i.worker_id), title: `เลขบัญชีกสิกรไม่ครบ 10 หลัก ${noBank.length} คน`, text: "ไฟล์โอนจะไม่มีคนเหล่านี้" });
  const vary = items.map(i => { const p = P.get(i.worker_id); if (!p || !Number(p.net_amount)) return null;
    const pct = (Number(i.net_amount) - Number(p.net_amount)) / Number(p.net_amount) * 100; return Math.abs(pct) > VARIANCE_PCT ? { i, pct } : null; }).filter(Boolean);
  const unconf = vary.filter(v => !ok.includes(v.i.worker_id));
  if (vary.length) out.push({ key: "var", block: unconf.length > 0, ids: vary.map(v => v.i.worker_id), confirmed: vary.length - unconf.length, total: vary.length,
    title: `ยอดต่างจากเดือนก่อนเกิน ${VARIANCE_PCT}% ${vary.length} คน`, text: "ตรวจแล้วกดยืนยันทีละคน", pct: Object.fromEntries(vary.map(v => [v.i.worker_id, Math.round(v.pct)])) });
  const t0 = new Date(today + "T00:00:00Z"), soon = items.map(i => W.get(i.worker_id)).filter(w => w && w.end_date && (new Date(w.end_date + "T00:00:00Z") - t0) / 864e5 <= EXPIRY_DAYS);
  if (soon.length) out.push({ key: "exp", block: false, ids: soon.map(w => w.id), title: `สัญญาหมดภายใน ${EXPIRY_DAYS} วัน ${soon.length} คน`, text: "ต่อสัญญาหรือแจ้งสิ้นสุด" });
  const noAddr = items.filter(i => Number(i.wht_amount) > 0 && !String(i.address || "").trim());
  if (noAddr.length) out.push({ key: "addr", block: false, ids: noAddr.map(i => i.worker_id), title: `ยังไม่มีที่อยู่ ${noAddr.length} คน`, text: "ช่องที่อยู่ผู้ถูกหักภาษีใน 50 ทวิ จะว่าง" });
  return out;
}

// จำนวนเงินเป็นตัวหนังสือ (50 ทวิ ต้องมีตามแบบของสรรพากร)
export function bahtText(num) {
  const n = Math.round((Number(num) || 0) * 100) / 100;
  if (n === 0) return "ศูนย์บาทถ้วน";
  const D = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"], U = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน", "ล้าน"];
  const conv = s => { let out = ""; const L = s.length;
    for (let i = 0; i < L; i++) { const d = +s[i], pos = L - i - 1; if (!d) continue;
      if (pos === 0 && d === 1 && L > 1) out += "เอ็ด"; else if (pos === 1 && d === 1) out += ""; else if (pos === 1 && d === 2) out += "ยี่"; else out += D[d];
      out += U[pos % 6] || ""; }
    return out; };
  const [ip, dp] = n.toFixed(2).split(".");
  const baht = ip.length > 6 ? conv(ip.slice(0, ip.length - 6)) + "ล้าน" + (Number(ip.slice(-6)) ? conv(ip.slice(-6)) : "") : conv(ip);
  return baht + "บาท" + (Number(dp) ? conv(dp) + "สตางค์" : "ถ้วน");
}

// ---------------------------------------------------------------- ไฟล์โอนกสิกรไทย (PCT) — ตามไฟล์ตัวอย่างจากผู้ใช้ 2026-10-15
// ความกว้างคงที่ · ตัวอักษรไทยเป็น TIS-620 (1 ไบต์/ตัว) · เงินเป็นสตางค์ 15 หลัก · วันที่ YYMMDD (ค.ศ.)
//   H: 1 'H' · 2-4 'PCT' · 21-26 '000000' · 41-50 บัญชีบริษัท · 52-66 ยอดรวม · 68-73 วันที่สร้างไฟล์ · 99-148 ชื่อบริษัท
//      149-154 วันที่โอน · 155-172 จำนวนรายการ (18 หลัก) · 173 'N' · ยาว 178
//   D: 1 'D' · 2-7 ลำดับ · 22-31 บัญชีผู้รับ · 33-47 จำนวนเงิน · 49-54 วันที่สร้างไฟล์ · 80-129 ชื่อผู้รับ · 130-135 วันที่โอน
//      136-138 '000' · 139- อ้างอิง (รหัสผู้รับจ้าง) · 306-344 '0000000000.00' × 3 · ยาว 742
// ช่องที่ไม่รู้ความหมาย ('000000', '000', ยอด 3 ช่องท้าย) ใส่ตามไฟล์ตัวอย่าง — ทดลองอัปโหลดไฟล์เล็กก่อนใช้จริง
const yymmdd = iso => String(iso).slice(2, 4) + String(iso).slice(5, 7) + String(iso).slice(8, 10);
const satang = v => String(Math.round(Number(v) * 100)).padStart(15, "0");
const put = (line, pos, text, width) => { const t = String(text ?? "").slice(0, width).padEnd(width, " "); return line.slice(0, pos - 1) + t + line.slice(pos - 1 + width); };
export const KBANK_H_LEN = 178, KBANK_D_LEN = 742;
export function kbankPCT({ items, account, company, created, payDate }) {
  const rows = items.filter(i => Number(i.net_amount) > 0 && String(i.bank_account || "").replace(/\D/g, "").length === 10);
  const skipped = items.filter(i => Number(i.net_amount) > 0 && !rows.includes(i));
  const total = rows.reduce((s, i) => s + Math.round(Number(i.net_amount) * 100), 0);
  let h = " ".repeat(KBANK_H_LEN);
  h = put(h, 1, "HPCT", 4); h = put(h, 21, "000000", 6); h = put(h, 41, String(account).replace(/\D/g, ""), 10);
  h = put(h, 52, String(total).padStart(15, "0"), 15); h = put(h, 68, yymmdd(created), 6); h = put(h, 99, company, 50);
  h = put(h, 149, yymmdd(payDate) + String(rows.length).padStart(18, "0") + "N", 25);
  const lines = [h, ...rows.map((i, n) => {
    let d = " ".repeat(KBANK_D_LEN);
    d = put(d, 1, "D" + String(n + 1).padStart(6, "0"), 7); d = put(d, 22, String(i.bank_account).replace(/\D/g, ""), 10);
    d = put(d, 33, satang(i.net_amount), 15); d = put(d, 49, yymmdd(created), 6); d = put(d, 80, i.name_en || i.name_th, 50);
    d = put(d, 130, yymmdd(payDate) + "000" + i.worker_code, 25);
    d = put(d, 306, "0000000000.000000000000.000000000000.00", 39);
    return d;
  })];
  return { text: lines.join("\r\n") + "\r\n", count: rows.length, total: total / 100, skipped };
}
// TIS-620: ก–๛ (U+0E01–U+0E5B) = 0xA1–0xFB · อักษรอื่นนอก ASCII ใส่ "?" (ไฟล์ธนาคารรับแต่ไทย/อังกฤษ)
export function tis620(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i);
    out[i] = c < 0x80 ? c : c >= 0x0E01 && c <= 0x0E5B ? c - 0x0E01 + 0xA1 : 0x3F; }
  return out;
}
