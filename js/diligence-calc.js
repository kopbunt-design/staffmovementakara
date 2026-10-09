// ============================================================================
// เบี้ยขยัน — ตรรกะล้วน (ไม่แตะ DOM / DB → เทสได้ตรง ๆ: test/diligence.test.js)
// ตามระเบียบปฏิบัติเรื่องการจ่ายเบี้ยขยัน (มีผล 1 ก.ย. 2569) + รายละเอียดที่ผู้ใช้ยืนยัน 2026-10-09
//
// ใช้ข้อมูลเวลาเดือนที่แล้ว จ่ายพร้อมเงินเดือนงวดถัดไป (เวลา ก.ย. → จ่ายงวด ต.ค.)
// ไฟล์ที่ดึงจาก TigerSoft ตรง ๆ ไม่แปลง (อ่านเป็นแถวด้วย sheet_to_json header:1):
//   1. รายงานแยกตามพนักงาน "ข้อมูลหลังประมวล" — วันละแถว: สาย ออกก่อน ลา หักวัน หมายเหตุ
//   2. "เพิ่มเวลา" — ทุกครั้งที่มีการลง/เพิ่มเวลาแทนการสแกน: ประเภท เหตุผล ใครทำ เมื่อไร
//   3. "เพิ่มเวลา-web" (ไม่บังคับ) — คำขอผ่านเว็บ ใช้เอาเหตุผลจริง เมื่อไฟล์ 2 เขียนแค่ "HR Approve(web)"
//
// ได้เบี้ยเดือนนั้นเมื่อ (ข้อ 4):
//   ไม่ขาด/หักวัน · ไม่สาย/ออกก่อนแม้ 1 นาที (4.4) · ไม่ลา ยกเว้นลาพักร้อนและลาหยุดชดเชย (4.1–4.3)
//   แก้เวลาไม่เกิน 2 วัน/เดือน (4.6–4.7) — นับเฉพาะกลุ่ม "แก้เวลา" (ลืมบัตร บัตรหาย ฯลฯ) วันละ 1 ครั้ง
//     และเฉพาะวันที่ลงเวลา "ขาเข้า" เอง — ขาเข้าสแกนแล้วลงขาออกเอง = ไม่นับ
//     ไม่นับ: ปัญหาฝั่งบริษัท (รปภ./ป้อม สแกนให้ ไฟดับ เครื่องสแกน) · HR เพิ่มให้ · ทำงานนอกสถานที่
//     นอกสถานที่ (รวม WFH) ต้องลงเวลาเสร็จภายในวันที่ 7 ของเดือนถัดไป ไม่งั้นหมดสิทธิ์ (4.8)
//   พักงาน (4.9) / อุบัติเหตุจากความประมาท (4.11) — HR ติ๊กเองรายคน (ไม่อยู่ในไฟล์เวลา)
// ขอบเขต (2.1): พนักงานประจำ ระดับ O และ S · สัญชาติไทยเท่านั้น · ต้องอยู่ครบทั้งเดือน · พ้นทดลองงานแล้ว (นับจากวันที่ 1 ของเดือนถัดไป, 5.5)
// อัตรา (5.1–5.4): เดือนต่อเนื่องที่ 1–3 = 300 · 4–6 = 600 · 7 ขึ้นไป = 1,000 · ขาดช่วง = เริ่มนับ 1 ใหม่เดือนถัดไป
// ============================================================================

export const START_YM = "2026-09";        // เดือนแรกที่ระเบียบมีผล — ทุกคนเริ่มนับเดือนที่ 1 ที่นี่
export const PROBATION_DAYS = 119;        // ไม่มีวันพ้นทดลองงานจริงในระบบ → ใช้วันเริ่มงาน + 119 วัน (ตรงกับ app.js)
export const MAX_EDIT_DAYS = 2;           // 4.6
export const OFFSITE_DEADLINE_DAY = 7;    // 4.8
export const ELIGIBLE_CONTRACT = "Permanent";
export const isEligibleLevel = lv => /^[OS]\d*$/i.test(String(lv || "").trim());

export function rateFor(streak) {
  if (!(streak > 0)) return 0;
  return streak <= 3 ? 300 : streak <= 6 ? 600 : 1000;
}

// ---------------------------------------------------------------- วันที่
const pad = n => String(n).padStart(2, "0");
export function serialToISO(v) {                      // Excel serial (มีเวลาเป็นเศษได้) → YYYY-MM-DD
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 864e5);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
const serialMinute = v => Math.round(Number(v) * 1440);   // ใช้จับคู่รายการเดียวกันระหว่างไฟล์ 2 กับ 3
export const nextYM = ym => { const [y, m] = ym.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`; };
export const prevYM = ym => { const [y, m] = ym.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`; };
const lastDay = ym => { const [y, m] = ym.split("-").map(Number); return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`; };
const isDateSerial = v => typeof v === "number" && v > 40000 && v < 80000;
const str = v => String(v ?? "").trim();
// "0:02" / "1-00:00" / "0-04:15" → มีค่าไม่ใช่ศูนย์ไหม
const nonZero = v => typeof v === "number" ? v > 0 : /[1-9]/.test(str(v));

// รหัสพนักงานในไฟล์ TigerSoft: ไม่ได้มีแค่ AKR… — มี DAY… (รายวัน) KCN… ฯลฯ ด้วย
// ⚠️ ถ้าจับแค่ AKR แถวเวลาของคนรหัสอื่นจะไปต่อท้ายคนก่อนหน้า (เกิดจริง 2026-10-09: ขาดงานของ DAY0103 ไปโผล่ที่คนอื่น)
const CODE = /^([A-Za-z]{2,6}\d{3,})(?=\s|-|$)/;
const codeOf = c => { const m = CODE.exec(c); return m ? m[1].toUpperCase() : null; };

// ---------------------------------------------------------------- 1. รายงานหลังประมวล
// หัวตาราง: แถวที่มีคำ "สาย" "ลาไม่หัก" — ตำแหน่งคอลัมน์อ่านจากหัว ไม่ยึดเลข (เผื่อ TigerSoft ขยับ)
export function parseProcessed(rows) {
  const hi = rows.findIndex(r => (r || []).some(c => str(c) === "สาย") && (r || []).some(c => str(c) === "ลาไม่หัก"));
  if (hi < 0) throw new Error("ไม่ใช่ไฟล์รายงานหลังประมวล — ไม่พบหัวตาราง สาย / ลาไม่หัก");
  const h = rows[hi].map(str), at = (name, fb) => { const i = h.indexOf(name); return i >= 0 ? i : fb; };
  const C = { late: at("สาย"), early: at("ออกก่อน"), leaveOk: at("ลาไม่หัก"), leaveDed: at("ลาหัก"), deduct: at("หักวัน"),
              in: at("เข้า", 6), out: at("ออก", 8) };
  const cntCol = at("จำนวนพนักงาน", -1);
  C.note = cntCol > 0 ? cntCol - 1 : 32;
  const emps = new Map();
  let cur = null;
  for (const r of rows.slice(hi + 1)) {
    if (!r) continue;
    const head = r.slice(0, 3).map(str).find(c => codeOf(c));
    if (head) {
      const code = codeOf(head);
      cur = emps.get(code) || { code, name: head.replace(CODE, "").replace(/^\s*-?\s*/, "").replace(/\s+/g, " ").trim(), days: [] };
      emps.set(code, cur); continue;
    }
    if (!cur || !isDateSerial(r[1])) continue;
    cur.days.push({ date: serialToISO(r[1]), shift: str(r[3]), dayType: str(r[5]),
      late: nonZero(r[C.late]) ? str(r[C.late]) : "", early: nonZero(r[C.early]) ? str(r[C.early]) : "",
      leaveOk: nonZero(r[C.leaveOk]), leaveDed: nonZero(r[C.leaveDed]), deduct: nonZero(r[C.deduct]) ? str(r[C.deduct]) : "",
      note: str(r[C.note]).replace(/\s+/g, " "),
      inMin: isDateSerial(r[C.in]) ? serialMinute(r[C.in]) : null, outMin: isDateSerial(r[C.out]) ? serialMinute(r[C.out]) : null });
  }
  if (!emps.size) throw new Error("อ่านรายงานหลังประมวลแล้วไม่พบพนักงาน (แถวรหัสพนักงาน)");
  return emps;
}

// ---------------------------------------------------------------- 2–3. ไฟล์เพิ่มเวลา
const BY_RE = /^([^,]+),\s*(\d{1,2})\/(\d{1,2}|[A-Za-z]{3})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/;
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// "kopbun,6/10/2569 17:24:24" (พ.ศ.) · "AKR17030626,21/Sep/26 07:38" (ค.ศ. 2 หลัก) → { by, at: "YYYY-MM-DD" }
export function parseBy(s) {
  const m = BY_RE.exec(str(s)); if (!m) return null;
  let y = Number(m[4]); if (y < 100) y += 2000; if (y > 2400) y -= 543;
  const mo = /^\d+$/.test(m[3]) ? Number(m[3]) : MON[m[3].toLowerCase()];
  return mo ? { by: m[1].trim(), at: `${y}-${pad(mo)}-${pad(Number(m[2]))}` } : null;
}

// ไฟล์ "เพิ่มเวลา": แถวพนักงาน (AKR…) → แถวสรุปวัน → แถวรายการ (เวลาที่ลง · ลงเวลา/เพิ่มเวลา · เหตุผล · ผู้ทำ,วันเวลา)
export function parseEdits(rows) {
  const out = []; let emp = null;
  for (const r of rows) {
    if (!r) continue;
    const head = r.slice(0, 4).map(str).find(c => codeOf(c));
    if (head && !r.some(c => str(c) === "ลงเวลา" || str(c) === "เพิ่มเวลา")) { emp = codeOf(head); continue; }
    const ti = r.findIndex(c => str(c) === "ลงเวลา" || str(c) === "เพิ่มเวลา");
    if (!emp || ti < 0) continue;
    const dt = r.slice(0, ti).find(isDateSerial); if (dt == null) continue;
    const bi = r.findIndex(c => BY_RE.test(str(c)));
    const reason = r.slice(ti + 1, bi > 0 ? bi : undefined).map(str).find(Boolean) || "";
    out.push({ emp, date: serialToISO(dt), minute: serialMinute(dt), type: str(r[ti]), reason, ...(parseBy(r[bi]) || { by: "", at: "" }) });
  }
  return out;
}

// ไฟล์ "เพิ่มเวลา-web": คืน Map("รหัส|นาที" → เหตุผล) เอาไว้แทน "HR Approve(web)" ในไฟล์บน
export function parseWebReasons(rows) {
  const map = new Map(); let emp = null;
  for (const r of rows) {
    if (!r) continue;
    const head = r.slice(0, 6).map(str).find(c => codeOf(c));
    if (head) { emp = codeOf(head); continue; }
    const di = r.findIndex(isDateSerial); if (!emp || di < 0) continue;
    const reason = r.slice(di + 1).map(str).find(c => c && !isDateSerial(Number(c)) && !BY_RE.test(c) && !/^[A-Z]$/.test(c) && !/^\d+(\.\d+)?$/.test(c)) || "";
    if (reason) map.set(`${emp}|${serialMinute(r[di])}`, reason);
  }
  return map;
}

// ---------------------------------------------------------------- กลุ่มเหตุผลการแก้เวลา
// count = แก้เวลาตาม 4.6 (นับ) · company = ปัญหาฝั่งบริษัท · check = เครื่องสแกน/บัตรไม่ติด ไม่ได้บอกว่าที่ป้อม (ไม่นับ แต่ให้ HR ยืนยัน)
// offsite = นอกสถานที่ (ไม่นับ แต่มีเส้นตายวันที่ 7) · hr = HR เพิ่มให้ (ไม่นับ)
export const GROUPS = {
  count:   { th: "แก้เวลา (นับ)",           counted: true },
  check:   { th: "สแกนไม่ติด — ให้ HR ยืนยัน", counted: false },
  company: { th: "ปัญหาฝั่งบริษัท",          counted: false },
  offsite: { th: "นอกสถานที่",               counted: false },
  hr:      { th: "HR เพิ่มให้",              counted: false },
  out:     { th: "ลงเวลาขาออกเอง (ขาเข้าสแกน)", counted: false },
  unused:  { th: "ไม่ได้ใช้เป็นเวลาเข้า-ออก",    counted: false },
  holiday: { th: "วันหยุด (มาทำโอที)",          counted: false },
};
// ลืมบัตร (ผู้ใช้ยืนยัน 2026-10-09): ลืมทั้งวัน = ลงเวลาเองทั้งเข้าและออก = 1 ครั้ง (ไม่เกิน 2 ครั้งยังได้)
//   ลืมบัตร "ขาเดียว" (อีกขาสแกนได้ แปลว่ามีบัตร) = น่าสงสัย → นับ 1 ครั้ง ทั้งขาเข้าและขาออก + ขึ้นธงให้ HR ตัดสิน
// วันหยุด (ประเภทวัน H / HD) ไม่เอามาคิดเลย — มาทำโอที (ผู้ใช้ยืนยัน 2026-10-09)
//   ทั้งการแก้เวลา สาย ออกก่อน ลา หักวัน ในวันหยุด ไม่ทำให้หมดสิทธิ์
export const isHoliday = d => /^H/i.test(d?.dayType || "");
// ขาที่ลงเวลาเอง (ผู้ใช้ยืนยัน 2026-10-09): ขาเข้าสแกนตามกะ แล้วลงเวลาขาออกเอง = หยวน ไม่นับ
//   แต่ลงเวลา "ขาเข้า" เองยังนับ — กันกรณีมาสายแล้วจงใจไม่สแกน มาลงเวลาทีหลังให้ดูตรงเวลา
//   รายการที่ไม่ได้ถูกใช้เป็นเวลาเข้าหรือออกเลย (วันนั้นมีสแกนจริงทั้งสองขา) ไม่มีผลกับการมาทำงาน → ไม่นับ
const RE = {
  forgot:  /ลืม|บัตรหาย|หาบัตรไม่เจอ|บัตร\S{0,6}ไม่เจอ|ไม่ได้(เอา|พก|นำ)บัตร|ไม่มีบัตร(?!พนักงาน)|ทิ้งบัตร|บัตรอยู่(ที่)?บ้าน|forgot|forget|left.{0,10}card/i,
  guard:   /รปภ|ป้อม|ยาม|security|guard/i,
  power:   /ไฟ\S{0,12}ดับ|power\s*(cut|outage)/i,
  device:  /(สแกน|แสกน|เเสกน|รูด|ปั๊ม|ปั้ม|นิ้ว|บัตร|เครื่อง).{0,12}(ไม่ติด|ไม่ผ่าน|ไม่ขึ้น|เสีย|ไม่ได้|ขัดข้อง)|(card|reader|scan|finger).{0,20}(error|fail|not\s*work)/i,
  hr:      /เริ่มงานวันแรก|ยังไม่ได้รับบัตร|รอบัตร|บัตรใหม่|level\s*m/i,
  offsite: /wfh|work\s*from\s*home|นอกสถานที่|outside|bkk|กรุงเทพ|กทม|australia|ออสเตรเลีย|melbourne|conference|ประชุม|อบรม|train|expo|บูธ|สัมมนา|ดูงาน|งานเลี้ยง|กินเลี้ยง|party|กิจกรรม|ออฟฟิศ|office|work\s*at|สำนักงาน|ต่างจังหวัด|ไปทำงาน|ทำงานที่|ไซต์|site visit/i,
};
export function classifyReason(reason, type = "ลงเวลา") {
  const t = str(reason);
  if (type === "เพิ่มเวลา") return RE.offsite.test(t) ? "offsite" : "hr";   // HR เป็นคนเพิ่ม (BKK = ทำงานกรุงเทพ)
  if (RE.forgot.test(t)) return "count";                                    // ลืมบัตร แม้จะเซ็นที่ป้อมยามแล้ว = นับ
  if (RE.guard.test(t) || RE.power.test(t)) return "company";
  if (RE.hr.test(t)) return "hr";
  if (RE.device.test(t)) return "check";
  if (RE.offsite.test(t)) return "offsite";
  return "count";                                                           // เหตุผลอื่น / ไม่ใส่เหตุผล / "ไม่ได้สแกน" = นับ
}
const SEVERITY = ["count", "check", "offsite", "company", "hr", "out", "unused"];          // วันเดียวหลายรายการ → ใช้กลุ่มที่หนักสุด

// รวมรายการแก้เวลาเป็น "วัน" (วันละ 1 ครั้ง ต่อให้แก้ทั้งเข้าและออก) เฉพาะเดือนที่คิด
// proc (จาก parseProcessed): ใช้ดูว่าเวลาที่ลงเอง เป็นเวลาเข้า / ออกของวันไหน — กะดึกขาออกอยู่อีกวัน ก็นับเป็นวันของกะ
//   ไม่ส่ง proc มา = ไม่รู้ขา → ถือว่าเป็นขาเข้า (เข้มไว้ก่อน)
export function editDays(edits, ym, webReasons = new Map(), proc = null) {
  const legOf = new Map();                               // "รหัส|นาที" → { date, leg }
  const hol = new Set();                                 // "รหัส|วันที่" ที่เป็นวันหยุด
  if (proc) for (const t of proc.values()) for (const d of t.days) {
    if (isHoliday(d)) hol.add(`${t.code}|${d.date}`);
    for (const [leg, m] of [["in", d.inMin], ["out", d.outMin]]) if (m != null)
      for (const k of [m - 1, m, m + 1]) if (!legOf.has(`${t.code}|${k}`)) legOf.set(`${t.code}|${k}`, { date: d.date, leg });
  }
  const days = new Map();
  for (const e of edits) {
    const hit = proc ? legOf.get(`${e.emp}|${e.minute}`) : null;
    const date = hit ? hit.date : e.date, leg = proc ? (hit ? hit.leg : "none") : "in";
    if (!date.startsWith(ym)) continue;
    let reason = e.reason;
    if (!reason || /HR\s*Approve\s*\(web\)/i.test(reason)) reason = webReasons.get(`${e.emp}|${e.minute}`) || "";
    const key = `${e.emp}|${date}`;
    const d = days.get(key) || { key, emp: e.emp, date, reasons: [], types: [], legs: [], forgot: [], lastAt: "", group: null };
    if (reason && !d.reasons.includes(reason)) d.reasons.push(reason);
    if (!d.types.includes(e.type)) d.types.push(e.type);
    if (!d.legs.includes(leg)) d.legs.push(leg);
    if (e.at > d.lastAt) d.lastAt = e.at;
    // เหตุผลที่ "นับ" จะนับจริงเฉพาะรายการที่เป็นขาเข้า
    let g = classifyReason(reason, e.type);
    const forgot = g === "count" && RE.forgot.test(reason);
    if (forgot && leg !== "none" && !d.forgot.includes(leg)) d.forgot.push(leg);
    if (g === "count" && leg !== "in" && !(forgot && leg === "out")) g = leg === "out" ? "out" : "unused";
    if (!d.group || SEVERITY.indexOf(g) < SEVERITY.indexOf(d.group)) d.group = g;
    days.set(key, d);
  }
  for (const d of days.values()) {
    d.oneLegForgot = d.group === "count" && d.forgot.length === 1 && proc != null ? d.forgot[0] : "";
    if (hol.has(d.key)) { d.group = "holiday"; d.oneLegForgot = ""; }
  }
  return [...days.values()].sort((a, b) => a.emp.localeCompare(b.emp) || a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------- ลา
const LEAVE_OK = /^ลา(พักร้อน|หยุดชดเชย)/;
// คำว่า "ลา…" ในหมายเหตุ (ต้นคำ) → ประเภทการลา
export const leaveKinds = note => [...new Set((str(note).match(/(?:^|[\s(])ลา[^\s()]*/g) || []).map(s => s.replace(/^[\s(]/, "")))];

// ---------------------------------------------------------------- คิดรายคน
// emp: แถว employees (emp_code, job_level, contract_type, join_date, end_date, ...)
// t: ข้อมูลเวลาจาก parseProcessed · eds: editDays ของคนนี้ · manual: { action: "" | "deny" | "grant", note }
// prev: ผลที่บันทึกของเดือนก่อน { qualified, streak } หรือ null
export function evaluate({ ym, emp, t, eds = [], manual = null, prev = null }) {
  const first = `${ym}-01`, last = lastDay(ym);
  const res = { ym, code: emp.emp_code, inScope: true, qualified: false, streak: 0, amount: 0, reasons: [], flags: [], editCount: 0 };
  const out = why => { res.inScope = false; res.reasons.push(why); return res; };
  if (!isEligibleLevel(emp.job_level)) return out(`ระดับ ${emp.job_level || "-"} ไม่อยู่ในขอบเขต (O / S)`);
  if (emp.contract_type !== ELIGIBLE_CONTRACT) return out(`ประเภทสัญญา ${emp.contract_type || "-"} (ได้เฉพาะพนักงานประจำ)`);
  // ชาวต่างชาติไม่มีสิทธิ์ (ผู้ใช้ยืนยัน 2026-10-09) · ไม่ได้ระบุสัญชาติ = คิดให้ แต่ขึ้นให้ HR ตรวจ
  const nat = String(emp.nationality || "").trim();
  if (nat && !/^(thai|ไทย)$/i.test(nat)) return out(`ชาวต่างชาติ (สัญชาติ ${nat}) ไม่มีสิทธิ์`);
  if (!nat) res.flags.push("ไม่ได้ระบุสัญชาติในทะเบียน — ถ้าเป็นชาวต่างชาติจะไม่มีสิทธิ์");
  const join = String(emp.join_date || "").slice(0, 10);
  if (!join || join > first) return out("เริ่มงานไม่ครบเดือน");
  if (emp.end_date && String(emp.end_date).slice(0, 10) <= last) return out("พ้นสภาพก่อนสิ้นเดือน");
  const pass = new Date(join + "T00:00:00Z"); pass.setUTCDate(pass.getUTCDate() + PROBATION_DAYS);
  const startYM = nextYM(pass.toISOString().slice(0, 7));                  // 5.5 นับจากวันที่ 1 ของเดือนถัดจากเดือนที่พ้นทดลองงาน
  if (startYM > ym) return out(`ยังไม่เริ่มนับ (พ้นทดลองงาน ~${pass.toISOString().slice(0, 10)} · เริ่มนับ ${startYM})`);

  const lose = [];
  if (!t || !t.days.some(d => d.date.startsWith(ym))) lose.push("ไม่มีข้อมูลเวลาในไฟล์");
  const dd = d => d.slice(8).replace(/^0/, "") + "/" + d.slice(5, 7).replace(/^0/, "");
  // รวมเหตุผลชนิดเดียวกันเป็นบรรทัดเดียว: "มาสาย 3 วัน (1/9 0:02, 4/9 0:10, 9/9 0:01)"
  const bucket = new Map(), add = (k, s) => (bucket.get(k) || bucket.set(k, []).get(k)).push(s);
  for (const d of (t?.days || []).filter(d => d.date.startsWith(ym) && !isHoliday(d))) {
    if (d.deduct) add("ขาดงาน/หักวัน", dd(d.date));
    if (d.late) add("มาสาย", `${dd(d.date)} ${d.late}`);
    if (d.early) add("ออกก่อน", `${dd(d.date)} ${d.early}`);
    const kinds = leaveKinds(d.note), bad = kinds.filter(k => !LEAVE_OK.test(k));
    if (bad.length) add(bad[0].replace(/^(ลา(ป่วย|กิจ|คลอด|บวช|ไม่รับค่าจ้าง|ฌาปณกิจ|ฌาปนกิจ)?).*$/, "$1"), dd(d.date));
    else if (d.leaveDed) add("ลาหักเงิน", dd(d.date));
    else if (d.leaveOk && !kinds.length) res.flags.push(`ลา (ไม่ระบุประเภท) ${dd(d.date)} — ตรวจว่าเป็นพักร้อน/ชดเชยไหม`);
    if (/ไม่พบการตั้งกะ/.test(d.note)) res.flags.push(`ไม่พบการตั้งกะงาน ${dd(d.date)}`);
    if (/อุบัติเหตุ/.test(d.note)) res.flags.push(`อุบัติเหตุ ${dd(d.date)} — พิจารณาตามข้อ 4.11`);
  }
  for (const [k, xs] of bucket) lose.push(`${k} ${xs.length} วัน (${xs.slice(0, 4).join(", ")}${xs.length > 4 ? ", …" : ""})`);
  const counted = eds.filter(e => GROUPS[e.group]?.counted);
  res.editCount = counted.length;
  if (counted.length > MAX_EDIT_DAYS) lose.push(`แก้เวลา ${counted.length} ครั้ง (เกิน ${MAX_EDIT_DAYS})`);
  const deadline = `${nextYM(ym)}-${pad(OFFSITE_DEADLINE_DAY)}`;
  const late8 = eds.filter(e => e.group === "offsite" && e.lastAt && e.lastAt > deadline);
  if (late8.length) lose.push(`ลงเวลานอกสถานที่หลังวันที่ ${OFFSITE_DEADLINE_DAY} ${late8.length} วัน (${late8.slice(0, 4).map(e => `${dd(e.date)} ลง ${dd(e.lastAt)}`).join(", ")}${late8.length > 4 ? ", …" : ""})`);
  const odd = counted.filter(e => e.oneLegForgot);
  if (odd.length) res.flags.push(`ลืมบัตรขาเดียว ${odd.length} วัน — น่าสงสัย (${odd.slice(0, 4).map(e => `${dd(e.date)} ${e.oneLegForgot === "in" ? "ขาเข้า" : "ขาออก"}`).join(", ")}${odd.length > 4 ? ", …" : ""})`);
  const nCheck = eds.filter(e => e.group === "check").length;
  if (nCheck) res.flags.push(`สแกนไม่ติด ${nCheck} วัน — ยืนยันว่าเป็นปัญหาฝั่งบริษัท`);

  if (manual?.action === "deny") lose.push(`HR ตัดสิทธิ์: ${manual.note || "-"}`);
  res.reasons = lose;
  // HR กำหนดยอดเอง (manual.amount) มากกว่า 0 = ให้สิทธิ์ไปด้วย · 0 = ไม่จ่ายเดือนนี้ แต่ยังนับว่ามาครบ (ไม่ตัดเดือนต่อเนื่อง)
  const fixed = manualAmount(manual);
  res.qualified = manual?.action === "grant" || (fixed > 0 && manual?.action !== "deny") ? true : !lose.length;
  if (manual?.action === "grant" || (fixed > 0 && lose.length && manual?.action !== "deny")) res.flags.push(`HR ให้สิทธิ์: ${manual.note || "-"}`);
  if (res.qualified) {
    res.streak = streakAfter(ym, prev, startYM);
    res.amount = rateFor(res.streak);
    if (fixed != null) { res.amount = fixed; res.flags.push(`HR กำหนดยอด ${fixed.toLocaleString("en-US")} บาท: ${manual.note || "-"}`); }
  }
  return res;
}

// เดือนต่อเนื่องของเดือนนี้ เมื่อเดือนนี้ "ได้" — ต่อจากเดือนก่อนถ้าเดือนก่อนได้ · เดือนแรกของระเบียบ / เดือนแรกหลังพ้นทดลองงาน = 1
export const streakAfter = (ym, prev, startYM = START_YM) =>
  (ym > START_YM && ym > startYM && prev && prev.qualified ? Number(prev.streak) || 0 : 0) + 1;
export const manualAmount = m => m && m.amount !== null && m.amount !== undefined && m.amount !== "" && Number.isFinite(Number(m.amount)) ? Math.max(0, Number(m.amount)) : null;

// แก้ผลของเดือนที่บันทึกแล้ว (หน้าประวัติ) — ไม่มีไฟล์เวลาแล้ว จึงแก้จากผลที่ระบบคิดไว้ (auto_*) + การแก้ของ HR
// row: แถว diligence_results · manual: {action, amount, note} หรือ null · prev: แถวเดือนก่อน
export function applyHistEdit(row, manual, prev) {
  const autoQ = row.auto_qualified ?? row.qualified;
  const fixed = manualAmount(manual);
  const q = manual?.action === "grant" || (fixed > 0 && manual?.action !== "deny") ? true : manual?.action === "deny" ? false : !!autoQ;
  const streak = !q ? 0 : q === row.qualified && row.streak > 0 ? row.streak : streakAfter(row.ym, prev);
  return { qualified: q, streak, amount: !q ? 0 : fixed != null ? fixed : rateFor(streak) };
}
