// ===== Akara Canteen — กติกาล้วน (ไม่มี DOM / ไม่ import js/app.js) · tested by test/canteen.test.js =====
// user 2026-11-26: ค่าอาหารโรงอาหารคิดเป็นหัว · ฝั่งอัครา 65 บาท (Canteen 1, Canteen 2 แยกเครื่องสแกน) · Chatree North 60 บาท (ร้านเดียว 2 กล่อง)
// กินได้กะละ 1 ครั้ง · ไฟล์สแกน (Excel จากเว็บของ IT) เป็นยอดรายวันต่อคน ไม่มีเวลา → แตะซ้ำ = HR ยืนยัน (นับ 1 ไว้ก่อน)
// บัตรผู้ติดต่อ (TEM…) / แถวไม่มีรหัส = นับหัวเสมอ ตามจำนวนครั้งที่แตะ (บัตรเดียวใช้หลายคนได้)

export const UNITS_DEFAULT = [
  { key: "A1", label: "Canteen 1", site: "Akara", shop: "ร้านอาหารสุนิสา", price: 65, series: "CTS1", boxes: ["A1"] },
  { key: "A2", label: "Canteen 2", site: "Akara", shop: "", price: 65, series: "CTS2", boxes: ["A2"] },
  { key: "CN", label: "Chatree North", site: "Chatree North", shop: "NAVAPUSPHANIT LIMITED PARTNERSHIP", price: 60, series: "CTN", boxes: ["N1", "N2"] },
];
export const BOXES = { A1: "Canteen 1", A2: "Canteen 2", N1: "Chatree North กล่อง 1", N2: "Chatree North กล่อง 2" };

// หมวดในใบแจ้งยอด (ลำดับ = ลำดับบรรทัด)
export const CATS = [
  { k: "akr", label: "สแกนบัตร — พนักงานอัครา", color: "#1d4a8f" },
  { k: "sub", label: "สแกนบัตร — ผู้รับเหมา (SUB)", color: "#3b7fd9" },
  { k: "forgot", label: "ลืมบัตร", sub: "ลงชื่อแทน", color: "#e7a51c" },
  { k: "visit", label: "ผู้ติดต่อ / บัตรชั่วคราว", color: "#9b6bd3" },
  { k: "group", label: "รับแทนเป็นกลุ่ม", sub: "ตามใบรับอาหาร", color: "#14a37f" },
  { k: "carry", label: "ยกยอดจากวันก่อน", sub: "HR ยืนยันทาน 2 มื้อ", color: "#8a93aa" },
];
export const catOf = code => {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return "unk";
  if (/^AKR/.test(c)) return "akr";
  if (/^SUB/.test(c)) return "sub";
  return "tem";                           // TEM… / บัตรอื่น ๆ = บัตรชั่วคราว
};
// แถวในใบ: akr/sub ตามรหัส · tem/unk/visit = ผู้ติดต่อ
export const lineOf = cat => (cat === "tem" || cat === "unk" ? "visit" : cat);

export const normName = s => String(s || "").toLowerCase().replace(/[^a-z฀-๿]+/g, " ").trim();

// ---------------------------------------------------------------- ไฟล์สแกน
// ชื่อไฟล์จริง: "รายชื่อสแกนบัตร1 Akara 01.11.26.xlsx" · "รายชื่อสแกนบัตร2 Akara 02.11.26.xlsx"
//               "รายชื่อสแกนบัตร Chatree North 01.11.26.xlsx" · "รายชื่อสแกนบัตร 2 Chatree North 01.11.26.xlsx"
export function boxOfFile(name, header3) {
  const n = String(name || "").normalize("NFC"), h = String(header3 || "");
  const two = /สแกนบัตร\s*2|กล่อง\s*2|box\s*2/i.test(n) || /canteen\s*2/i.test(h);
  if (/chatree|chathree|ชาตรี/i.test(n)) return two ? "N2" : "N1";
  if (/akara|canteen|อัครา/i.test(n) || /canteen/i.test(h)) return two ? "A2" : "A1";
  return null;
}
export function dateOfFile(name) {
  const m = String(name || "").match(/(\d{1,2})[.\-_](\d{1,2})[.\-_](\d{2,4})(?!\d)/);
  if (!m) return null;
  let y = +m[3]; if (y < 100) y += y > 50 ? 2500 : 2000; if (y > 2400) y -= 543;
  const d = `${y}-${String(+m[2]).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}`;
  return isNaN(Date.parse(d)) || +m[2] > 12 || +m[1] > 31 ? null : d;
}
// aoa = SheetJS sheet_to_json(header:1) · หัวตาราง "EMP No. | Name | Canteen 1/Count" · ท้ายไฟล์มีแถว Total
export function parseScan(aoa, fileName) {
  const hi = aoa.findIndex(r => r && /emp\s*no/i.test(String(r[0] ?? "")));
  if (hi < 0) throw new Error("ไม่พบหัวตาราง EMP No. — ไม่ใช่ไฟล์สแกนบัตร");
  const H = aoa[hi].map(x => String(x ?? "").trim());
  const ci = Math.max(2, H.findIndex((x, i) => i >= 2 && x));
  const rows = new Map(); let unknown = 0, fileTotal = null;
  for (const r of aoa.slice(hi + 1)) {
    if (!r) continue;
    const code = String(r[0] ?? "").trim(), n = Math.round(+r[ci] || 0);
    if (/^total$/i.test(code)) { fileTotal = n; break; }
    if (!n) continue;
    if (!code) { unknown += n; continue; }
    const k = code.toUpperCase(), o = rows.get(k);
    if (o) o.scans += n; else rows.set(k, { code: k, name: String(r[1] ?? "").replace(/\s+/g, " ").trim(), scans: n });
  }
  const list = [...rows.values()];
  return { box: boxOfFile(fileName, H[ci]), d: dateOfFile(fileName), rows: list, unknown, fileTotal,
           sum: list.reduce((t, x) => t + x.scans, 0) + unknown };
}

// ---------------------------------------------------------------- ทะเบียน (พนักงาน + SUB)
// people = [{code, name, name_en, kind:"akr"|"sub", ac, dept, left}] · ชื่ออังกฤษใช้จับคู่บัตรที่รหัสไม่ตรงทะเบียน
export function indexPeople(people) {
  const byCode = new Map(), byName = new Map(), byAc = new Map();
  for (const p of people) {
    byCode.set(String(p.code).toUpperCase(), p);
    for (const n of [p.name_en, p.name]) { const k = normName(n); if (k) (byName.get(k) || byName.set(k, []).get(k)).push(p); }
    if (p.ac) (byAc.get(String(p.ac)) || byAc.set(String(p.ac), []).get(String(p.ac))).push(p);
  }
  return { byCode, byName, byAc, list: people };
}
// รหัสบนบัตร → คนในทะเบียน: ตรงรหัส · ไม่ตรง = ชื่อเหมือนคนเดียว (เช่นบัตร AKR25081315 แต่ทะเบียน AKR25101315)
export function mapCard(code, name, ix) {
  const c = String(code || "").toUpperCase();
  if (ix.byCode.has(c)) return { reg: c, how: "code" };
  const m = [...new Set(ix.byName.get(normName(name)) || [])];
  if (m.length === 1) return { reg: String(m[0].code).toUpperCase(), how: "name" };
  return { reg: null, how: "none" };
}
// ใบลงชื่อลืมบัตร: พนักงานเขียนรหัสเต็ม หรือแค่เลขท้าย (1167 → AKR24051167) · SUB เขียนเลข SUB หรือเลข AC
export function resolveCode(input, ix) {
  const raw = String(input || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!raw) return [];
  if (ix.byCode.has(raw)) return [ix.byCode.get(raw)];
  const digits = raw.replace(/^(AKR|SUB)/, "");
  if (!/^\d{1,8}$/.test(digits)) return [];
  const want = raw.startsWith("AKR") ? "akr" : raw.startsWith("SUB") ? "sub" : null, out = new Set();
  const n4 = digits.padStart(4, "0");
  for (const p of ix.list) {
    const c = String(p.code).toUpperCase();
    if (want && p.kind !== want) continue;
    if (p.kind === "akr" && digits.length <= 5 && c.endsWith(n4) && c.length >= 7) out.add(p);
    if (p.kind === "sub" && c === "SUB" + String(+digits)) out.add(p);
  }
  if (!want || want === "sub") for (const p of ix.byAc.get(String(+digits)) || []) out.add(p);
  const list = [...out];
  // คนที่ยังทำงานอยู่มาก่อน
  return list.sort((a, b) => (a.left ? 1 : 0) - (b.left ? 1 : 0));
}

// ---------------------------------------------------------------- สรุปยอดของหน่วย (หนึ่งใบแจ้งยอด)
// meals = แถว cn_meals ของวันนั้นในกล่องของหน่วย · carry = แถวที่ HR ยืนยันทาน 2 มื้อหลังออกใบวันก่อนแล้ว
export function unitLines(meals, carry = []) {
  const n = Object.fromEntries(CATS.map(c => [c.k, 0]));
  for (const m of meals) n[lineOf(m.cat)] += +m.billed || 0;
  n.carry = carry.reduce((t, m) => t + (+m.extra || 0), 0);
  const lines = CATS.filter(c => n[c.k] || ["akr", "sub"].includes(c.k)).map(c => ({ k: c.k, label: c.label, sub: c.sub || "", n: n[c.k], color: c.color }));
  return { lines, meals: lines.reduce((t, l) => t + l.n, 0) };
}
// คนที่ต้องตรวจในวันนั้น (ไม่กระทบยอดเอง — HR ตัดสิน)
export function dayChecks(meals, ix, days = []) {
  const out = { dup: [], twoBox: [], mapped: [], notReg: [], left: [], forgotScanned: [], fileDiff: [] };
  const byReg = new Map();
  for (const m of meals) {
    if (m.dup === "pending") out.dup.push(m);
    if (m.src === "scan" && (m.cat === "akr" || m.cat === "sub")) {
      if (m.reg_code && m.reg_code !== m.code) out.mapped.push(m);
      if (!m.reg_code) out.notReg.push(m);
    }
    const reg = m.reg_code || (m.cat === "akr" || m.cat === "sub" ? m.code : null);
    if (reg) {
      (byReg.get(reg) || byReg.set(reg, []).get(reg)).push(m);
      const p = ix?.byCode.get(reg);
      if (p?.left && (!p.left_on || p.left_on <= m.d)) out.left.push(m);
    }
  }
  for (const [reg, ms] of byReg) {
    const boxes = new Set(ms.filter(m => +m.billed > 0).map(m => m.box));
    if (boxes.size > 1) out.twoBox.push({ reg, rows: ms });
    if (ms.some(m => m.cat === "forgot") && ms.some(m => m.src === "scan")) out.forgotScanned.push({ reg, rows: ms });
  }
  for (const d of days) if (d.file_total != null && d.file_total !== d.scans) out.fileDiff.push(d);
  return out;
}

// รอบบิล: 1–15 / 16–สิ้นเดือน
export function periodOf(d) {
  const y = +d.slice(0, 4), m = +d.slice(5, 7), day = +d.slice(8, 10);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(), ym = d.slice(0, 7);
  return day <= 15 ? { from: `${ym}-01`, to: `${ym}-15`, half: 1 } : { from: `${ym}-16`, to: `${ym}-${String(last).padStart(2, "0")}`, half: 2 };
}
export const docNo = (series, yr, no) => `${series}${yr}/${String(no).padStart(3, "0")}`;
