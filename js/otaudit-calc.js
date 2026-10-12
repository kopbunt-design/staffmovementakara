// ============================================================================
// ตรวจโอที — ตรรกะล้วน (ไม่แตะ DOM / DB → เทสได้ตรง ๆ: test/otaudit.test.js)
// เทียบ "รายงานการขอโอทีปกติ" กับ "รายงานหลังประมวล" (ไฟล์เดียวกับเบี้ยขยัน) จาก TigerSoft
// ผลเป็นรายการให้ HR ตรวจ แล้วไปแก้ใน TigerSoft — ไม่บันทึกอะไรลง DB (ผู้ใช้ยืนยัน 2026-10-12)
//
// ชนิดโอที: S = ก่อนเริ่มงาน · B = พักเที่ยง · E = หลังเลิกงาน
// รูปแบบ: I = จ่ายเงิน (ระดับ O) · O = เป็นลา (ระดับ S และ M)
// ตรวจ:
//   1. เวลาสแกนครอบคลุมช่วงที่ขอไหม (ยกเว้นพักเที่ยง — อยู่ระหว่างเข้า-ออก สแกนบอกไม่ได้ → เตือนเฉย ๆ)
//   2. ยอดที่ขอ (ตัดช่วงซ้อน) เทียบยอดโอทีใน TigerSoft ต่อคน-วัน · ต่างไม่เกิน 1 ชม. = พัก/ปัดเศษ
//      รวมถึง TigerSoft มีโอทีแต่ไม่มีคำขอเลย
//   3. วันหยุดต้องขอชนิด "ก่อนเริ่มงาน" (S)
//   4. ระดับไม่ตรงกับรูปแบบ (O ต้องเป็น I · S/M ต้องเป็น O)
//   5. กะ F01 วันหยุด OT1 = 9:30 → ยังไม่หักพัก 1 ชม. ควรเป็น 8:30
// เมื่อรู้เวลากะ (ตาราง ot_shift_times — ระบบเดาให้ HR ยืนยัน, ผู้ใช้เลือก 2026-10-12):
//   6. คำนวณโอทีที่ควรได้ = ช่วงที่ขอ ∩ เวลาสแกน − เวลางานปกติ (วันทำงาน) / − เวลาพัก (วันหยุด) + พักเที่ยงที่ขอ (วันทำงาน)
//      ปัดลงทีละ 30 นาทีแบบ TigerSoft แล้วเทียบเป๊ะ — ก.ย. 2569 ตรงกับ TigerSoft 95% ที่เหลือคือที่ต้องตรวจจริง
//   7. ชนิดไม่ตรงกะ: ก่อนเริ่มงานต้องจบก่อนเข้ากะ · หลังเลิกงานต้องเริ่มหลังเลิกกะ (วันทำงาน)
//   8. ขอโอทีในวันที่ลา / ขาดงาน
// เวลาทั้งหมดคิดเป็น "นาทีนับจาก Excel serial" ไม่ผ่าน Date → ไม่มีปัญหาเขตเวลา
//   (ไฟล์ตรวจเดิม OT_Audit แสดงเวลาสแกนเร็วไป 7 ชม. เพราะแปลงผ่าน UTC)
// ============================================================================
import { parseProcessed, serialToISO, durMin } from "./diligence-calc.js";

export const TYPES = { S: "ก่อนเริ่มงาน", B: "พักเที่ยง", E: "หลังเลิกงาน" };
export const IO = { I: "จ่ายเงิน", O: "เป็นลา" };
export const SMALL_DIFF = 60;        // ต่างไม่เกิน 1 ชม. = พัก / ปัดเศษ
export const SCAN_TOLERANCE = 5;     // สแกนขาดไม่เกิน 5 นาที ถือว่าครบ
export const F01_HOLIDAY_OT1 = 510;  // 8:30 (9:30 หักพัก 1 ชม.)
export const OT_BLOCK = 30;          // TigerSoft ปัดโอทีลงทีละ 30 นาที (ก.ย. 2569: 2,166 จาก 2,166 รายการ)

const str = v => String(v ?? "").trim();
const CODE = /^([A-Za-z]{2,6}\d{3,})(?=\s|-|$)/;
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = n => String(n).padStart(2, "0");
// "01-Sep-26" / Excel serial → YYYY-MM-DD
function reqDate(v) {
  if (typeof v === "number" && v > 40000) return serialToISO(v);
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(str(v)); if (!m) return null;
  let y = +m[3]; if (y < 100) y += 2000; if (y > 2400) y -= 543;
  return MON[m[2].toLowerCase()] ? `${y}-${pad(MON[m[2].toLowerCase()])}-${pad(+m[1])}` : null;
}
const clock = v => { if (typeof v === "number") return Math.round((v % 1) * 1440); const m = /^(\d{1,2}):(\d{2})/.exec(str(v)); return m ? +m[1] * 60 + +m[2] : null; };
export const isoToDay = iso => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 864e5);
export const hhmm = m => m == null ? "" : `${Math.floor(m / 60)}:${pad(Math.abs(m) % 60)}`;
// นาทีสัมบูรณ์ → "HH:MM" ของวันนั้น (+1 ถ้าข้ามวันจากวันอ้างอิง)
export const clockOf = (abs, refDay) => { if (abs == null) return ""; const d = Math.floor(abs / 1440), m = abs - d * 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}${refDay != null && d !== refDay ? (d > refDay ? " (+1)" : " (-1)") : ""}`; };

// ---------------------------------------------------------------- รายงานการขอโอทีปกติ
// แถววันที่ ("01-Sep-26") → แถวคำขอ (รหัส ชื่อ · ชนิด S/B/E · I/O · เริ่ม · ถึง · รวม · หมายเหตุ)
// คอลัมน์หาจากค่าที่เจอในแถว ไม่ยึดเลขคอลัมน์
export function parseRequests(rows) {
  const out = []; let date = null;
  for (const r of rows) {
    if (!r) continue;
    const ci = r.findIndex(c => typeof c === "string" && CODE.test(c.trim()));
    if (ci < 0) { const d = r.map(reqDate).find(Boolean); if (d) date = d; continue; }
    // หลังรหัสพนักงาน ช่องที่มีค่าเรียงเป็น: ชนิด · I/O · เริ่ม · ถึง · รวม · (ลายมือชื่อ ว่าง) · หมายเหตุ
    const rest = r.slice(ci + 1).filter(c => str(c) !== "");
    const [typ, io] = rest.map(str);
    if (!/^[SBE]$/.test(typ) || clock(rest[2]) == null || clock(rest[3]) == null) continue;
    const head = str(r[ci]);
    out.push({ emp: CODE.exec(head)[1].toUpperCase(), name: head.replace(CODE, "").replace(/^\s*-?\s*/, "").replace(/\s+/g, " ").trim(),
               date, typ, io: /^[IO]$/.test(io) ? io : "", start: clock(rest[2]), end: clock(rest[3]), hours: clock(rest[4]) ?? 0,
               note: rest.slice(5).map(str).join(" ") });
  }
  return out.filter(x => x.date);
}

// ---------------------------------------------------------------- เครื่องมือช่วง
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
export function unionLen(ws) {
  const s = ws.filter(w => w[1] > w[0]).sort((a, b) => a[0] - b[0]); let tot = 0, cs = null, ce = null;
  for (const [a, b] of s) { if (cs == null || a > ce) { if (cs != null) tot += ce - cs; cs = a; ce = b; } else ce = Math.max(ce, b); }
  return cs == null ? tot : tot + ce - cs;
}

// ---------------------------------------------------------------- โอทีที่ควรได้ (ต่อคน-วัน)
// ช่วงที่ขอ (รวมซ้อน) ∩ เวลาสแกน · วันทำงาน: ตัดเวลางานปกติออก แล้วบวกพักเที่ยงที่ขอกลับ · วันหยุด: ตัดเวลาพักของกะ (ส่วนที่ขอพักเที่ยงไว้ไม่ตัด) · ปัดลง 30 นาที
export function expectedOT(t, sh, reqs) {
  const base = t.day * 1440, hol = /^H/i.test(t.dayType);
  const ws = reqs.filter(q => hol || q.typ !== "B").map(q => [Math.max(q.w0, t.inMin), Math.min(q.w1, t.outMin)]).filter(w => w[1] > w[0]).sort((a, b) => a[0] - b[0]);
  const U = []; for (const w of ws) { if (U.length && w[0] <= U[U.length - 1][1]) U[U.length - 1][1] = Math.max(U[U.length - 1][1], w[1]); else U.push([...w]); }
  const B = reqs.filter(q => q.typ === "B").map(q => [Math.max(q.w0, t.inMin), Math.min(q.w1, t.outMin)]);
  let m = 0;
  for (const [a, b] of U) m += Math.max(0, b - a - (hol ? 0 : overlap(a, b, base + sh.start, base + sh.end)));
  if (!hol) m += unionLen(B);                                   // วันทำงาน: พักเที่ยงที่ขอ = โอที
  else if (sh.brk) {                                            // วันหยุด: หักพัก ยกเว้นส่วนที่ขอโอทีพักเที่ยงไว้ (NOR ขอ 12:30–13:00 → หักแค่ 30 นาที)
    const b0 = base + sh.brk[0], b1 = base + sh.brk[1];
    const inBrk = U.reduce((s, [a, b]) => s + overlap(a, b, b0, b1), 0);
    const paid = unionLen(B.map(([a, b]) => [Math.max(a, b0), Math.min(b, b1)]));
    m -= Math.max(0, inBrk - paid);
  }
  return Math.floor(m / OT_BLOCK) * OT_BLOCK;
}

// ---------------------------------------------------------------- เดาเวลากะ (ให้ HR ยืนยัน)
// เข้ากะ = เวลาจบที่พบบ่อยสุดของคำขอ "ก่อนเริ่มงาน" · เลิกกะ = เวลาเริ่มที่พบบ่อยสุดของคำขอ "หลังเลิกงาน" (อย่างน้อย 3 คำขอ)
// ไม่พอ → มัธยฐานเวลาสแกนเข้า/ออก ปัดเป็นครึ่งชั่วโมง
// เวลาพัก (หักเฉพาะวันหยุด): ดูจากวันหยุดจริง — ช่วงที่ขอ∩สแกน ลบ ยอด TigerSoft ที่พบบ่อยสุด (0 / 30 / 60 นาที) วางที่ 12:00
//   ก.ย. 2569: NOR หัก 30 นาที (12:00–12:30 — อีกครึ่งคือที่คนขอโอทีพักเที่ยง 12:30–13:00) · D01 ไม่หักเลย
// คืน { CODE: { start, end, brk, days, basis } } เฉพาะกะที่มีวันทำงานในไฟล์
export function inferShiftTimes(procMap, reqs) {
  const S = {}, T = new Map(), HOL = {};
  for (const t of procMap.values()) for (const d of t.days) {
    T.set(`${t.code}|${d.date}`, d);
    if (/^H/i.test(d.dayType) || !d.shift) continue;
    const c = d.shift.toUpperCase(), x = S[c] ||= { days: 0, ins: [], outs: [], sEnd: {}, eStart: {} };
    x.days++;
    if (d.inMin != null && d.outMin != null) { const b = isoToDay(d.date) * 1440; x.ins.push(d.inMin - b); x.outs.push(d.outMin - b); }
  }
  // วันหยุด: คนละวันกัน รวมช่วงที่ขอ∩สแกน เทียบยอด TigerSoft → ส่วนที่หายไป = เวลาพักที่ TigerSoft หัก
  const hol = new Map();
  for (const q of reqs) {
    const d = T.get(`${q.emp}|${q.date}`); if (!d || !/^H/i.test(d.dayType) || !d.shift || d.inMin == null || d.outMin == null) continue;
    const b = isoToDay(d.date) * 1440, w0 = b + q.start, w1 = w0 + ((q.end - q.start + 1440) % 1440 || 1440);
    const g = hol.get(`${q.emp}|${q.date}`) || { d, ws: [] }; g.ws.push([Math.max(w0, d.inMin), Math.min(w1, d.outMin)]); hol.set(`${q.emp}|${q.date}`, g);
  }
  for (const { d, ws } of hol.values()) {
    const ts = Object.values(d.ot || {}).reduce((s, v) => s + v, 0); if (!ts) continue;
    const delta = Math.floor(unionLen(ws) / OT_BLOCK) * OT_BLOCK - ts;
    if (delta >= 0 && delta <= 60) { const c = d.shift.toUpperCase(); (HOL[c] ||= {}); HOL[c][delta] = (HOL[c][delta] || 0) + 1; }
  }
  for (const q of reqs) {
    const d = T.get(`${q.emp}|${q.date}`); if (!d || /^H/i.test(d.dayType) || !d.shift) continue;
    const x = S[d.shift.toUpperCase()]; if (!x) continue;
    if (q.typ === "S") x.sEnd[q.end] = (x.sEnd[q.end] || 0) + 1;
    if (q.typ === "E") x.eStart[q.start] = (x.eStart[q.start] || 0) + 1;
  }
  const mode = o => { const e = Object.entries(o).sort((a, b) => b[1] - a[1])[0]; return e && e[1] >= 3 ? +e[0] : null; };
  const med = a => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const r30 = m => Math.round(m / 30) * 30;
  const out = {};
  for (const [c, x] of Object.entries(S)) {
    let start = mode(x.sEnd), end = mode(x.eStart), basis = [];
    basis.push(start != null ? "เข้า: คำขอก่อนเริ่มงาน" : "เข้า: เวลาสแกน");
    basis.push(end != null ? "เลิก: คำขอหลังเลิกงาน" : "เลิก: เวลาสแกน");
    if (start == null) { const m = med(x.ins); start = m == null ? null : ((r30(m) % 1440) + 1440) % 1440; }
    if (end == null) { const m = med(x.outs); end = m == null ? null : r30(m); }
    if (start == null || end == null) { out[c] = { start: null, end: null, brk: null, days: x.days, basis: "ข้อมูลไม่พอ" }; continue; }
    end = ((end % 1440) + 1440) % 1440; if (end <= start) end += 1440;
    const bm = mode(HOL[c] || {});                             // ต้องเจออย่างน้อย 3 วันหยุด
    const brk = bm && start <= 720 && end >= 720 + bm ? [720, 720 + bm] : null;
    basis.push(bm != null ? `พัก: วันหยุดจริง (หัก ${bm} นาที)` : "พัก: ไม่มีข้อมูลวันหยุด — ไม่หัก");
    out[c] = { start, end, brk, days: x.days, basis: basis.join(" · ") };
  }
  return out;
}

// ---------------------------------------------------------------- ตรวจ
// procMap: parseProcessed() · reqs: parseRequests() · levelOf(code) → "O2" / "S1" / "M1" / "" · ym: "YYYY-MM"
// คืน { requests: [...คำขอ + ผลตรวจรายคำขอ], days: [...คน-วันที่มีคำขอหรือมีโอทีใน TigerSoft + ผลเทียบยอด], issues: [...ทุกเรื่องที่ต้องตรวจ] }
// shifts: { CODE: { start, end, brk: [a, b] | null } } — นาทีจาก 00:00 ของวันที่กะเริ่ม (end/brk เกิน 1440 ได้)
export function audit(procMap, reqs, levelOf = () => "", ym = null, shifts = {}) {
  const shiftOf = t => t ? shifts[String(t.shift || "").toUpperCase()] || null : null;
  const T = new Map();                                  // "รหัส|วันserial" → วันจาก TigerSoft
  for (const t of procMap.values()) for (const d of t.days) T.set(`${t.code}|${isoToDay(d.date)}`, { ...d, code: t.code, name: t.name, day: isoToDay(d.date) });
  const otTotal = d => Object.values(d?.ot || {}).reduce((s, v) => s + v, 0);
  const requests = [], byDay = new Map(), issues = [];
  const issue = (kind, sev, o) => issues.push({ kind, sev, ...o });

  for (const q of reqs) {
    if (ym && !q.date.startsWith(ym)) continue;
    const base = isoToDay(q.date);
    // วางช่วงที่ขอ (ถึง < เริ่ม = ข้ามเที่ยงคืน) แล้วจับคู่กับวันทำงาน ตามลำดับความน่าจะเป็น:
    //   [ช่วงวันที่ขอ, กะวันที่ขอ] → [ช่วงหลังเที่ยงคืน, กะวันที่ขอ] (กะบ่าย/ดึกขอ 00:00–06:00, พักเที่ยงกะดึก 00:30)
    //   → [ช่วงวันที่ขอ, กะของเมื่อวาน] (ขอด้วยวันที่หลังเที่ยงคืน)
    // ใช้แบบแรกที่สแกนครอบคลุมครบ · ไม่มีแบบไหนครบ = แบบที่ซ้อนมากสุด (เท่ากันเอาแบบแรก)
    // ไม่ลองย้ายไปวันอื่นไกลกว่านี้ — คำขอลงวันผิดต้องโผล่ให้ HR เห็น (จับคู่ไว้ด้านล่าง)
    let best = null;
    for (const [shift, dd] of [[0, 0], [1, 0], [0, -1]]) {
      const w0 = (base + shift) * 1440 + q.start, w1 = w0 + ((q.end - q.start + 1440) % 1440 || 1440);
      const t = T.get(`${q.emp}|${base + dd}`); if (!t) continue;
      const ov = t.inMin != null && t.outMin != null ? overlap(w0, w1, t.inMin, t.outMin) : 0;
      if (!best || ov > best.ov) best = { ov, w0, w1, t };
      if (ov >= w1 - w0 - SCAN_TOLERANCE) { best = { ov, w0, w1, t }; break; }
    }
    if (!best) {
      const w0 = base * 1440 + q.start;
      best = { ov: 0, w0, w1: w0 + ((q.end - q.start + 1440) % 1440 || 1440), t: T.get(`${q.emp}|${base}`) || null };
    }
    const { t, w0, w1, ov } = best, len = w1 - w0;
    const r = { ...q, w0, w1, len, covered: ov, t, dayKey: t ? `${q.emp}|${t.day}` : `${q.emp}|${base}`, lv: levelOf(q.emp) || "" };
    // 1. เวลาสแกน
    if (q.typ === "B") r.scan = "พักเที่ยง — สแกนตรวจไม่ได้";
    else if (!t || t.inMin == null || t.outMin == null) r.scan = "ข้อมูลเวลาไม่พอ";
    else if (ov >= len - SCAN_TOLERANCE) r.scan = "ครบ";
    else r.scan = ov > 0 ? `สแกนครอบคลุม ${hhmm(ov)} จาก ${hhmm(len)}` : "เวลาสแกนไม่ครอบคลุมช่วงที่ขอ";
    if (q.typ === "B") issue("lunch", "info", { req: r, text: `ขอโอทีพักเที่ยง ${hhmm(q.hours)} — ตรวจว่าทำงานจริง` });
    else if (r.scan !== "ครบ") issue("scan", "warn", { req: r, text: r.scan });
    // 7–8. เทียบกับเวลากะ (วันทำงาน) · ขอโอทีวันที่ลา/ขาดงาน
    const sh = shiftOf(t), work = t && !/^H/i.test(t.dayType);
    if (sh && work && q.typ !== "B") {
      const s0 = t.day * 1440 + sh.start, s1 = t.day * 1440 + sh.end;
      if (q.typ === "S" && w1 > s0) issue("position", "warn", { req: r, text: `ชนิดก่อนเริ่มงาน แต่ช่วงที่ขอเลยเวลาเข้ากะ ${t.shift} (${clockOf(s0)}) ไป ${hhmm(Math.min(w1, s1) - Math.max(w0, s0) > 0 ? Math.min(w1, s1) - Math.max(w0, s0) : w1 - s0)}` });
      if (q.typ === "E" && w0 < s1) issue("position", "warn", { req: r, text: `ชนิดหลังเลิกงาน แต่เริ่มก่อนเลิกกะ ${t.shift} (${clockOf(s1)}) ${hhmm(Math.min(w1, s1) - w0)}` });
    }
    if (work && (t.deduct || t.leaveOk || t.leaveDed))
      issue("leaveday", "warn", { req: r, text: `ขอโอทีในวันที่${t.deduct ? "ขาดงาน/หักวัน" : "ลา"}${t.note ? ` (${t.note.slice(0, 40)})` : ""}` });
    // 3. วันหยุดต้องขอชนิดก่อนเริ่มงาน
    if (t && /^H/i.test(t.dayType) && q.typ !== "S") issue("holiday", "warn", { req: r, text: `วันหยุดแต่ขอชนิด "${TYPES[q.typ]}" — ต้องขอชนิดก่อนเริ่มงาน` });
    // 4. ระดับกับรูปแบบ
    const L = r.lv.charAt(0).toUpperCase();
    if (!L) issue("level", "warn", { req: r, text: "ไม่พบระดับในทะเบียนพนักงาน" });
    else if (L === "O" && q.io !== "I") issue("level", "warn", { req: r, text: `ระดับ ${r.lv} ต้องเป็นแบบจ่ายเงิน (I) แต่ขอแบบ${IO[q.io] || q.io}` });
    else if ((L === "S" || L === "M") && q.io !== "O") issue("level", "warn", { req: r, text: `ระดับ ${r.lv} ต้องเป็นแบบลา (O) แต่ขอแบบ${IO[q.io] || q.io}` });
    requests.push(r);
    const g = byDay.get(r.dayKey) || { key: r.dayKey, emp: q.emp, name: q.name, t, reqs: [] };
    g.reqs.push(r); byDay.set(r.dayKey, g);
  }
  // TigerSoft มีโอที แต่ไม่มีคำขอเลย
  for (const [k, t] of T) if (otTotal(t) > 0 && (!ym || t.date.startsWith(ym)) && !byDay.has(k)) byDay.set(k, { key: k, emp: t.code, name: t.name, t, reqs: [] });

  const days = [];
  for (const g of byDay.values()) {
    const t = g.t, time = otTotal(t);
    const sumHours = g.reqs.reduce((s, r) => s + r.hours, 0);
    const sumLen = g.reqs.reduce((s, r) => s + r.len, 0), uni = unionLen(g.reqs.map(r => [r.w0, r.w1]));
    const overlapCut = sumLen - uni, asked = Math.max(0, sumHours - overlapCut);
    // รู้เวลากะ + มีสแกนครบ → คิดโอทีที่ควรได้ แล้วเทียบเป๊ะ · ไม่รู้ → เทียบยอดที่ขอ ยอมคลาด 1 ชม. แบบเดิม
    const sh = shiftOf(t), expected = sh && t.inMin != null && t.outMin != null ? expectedOT(t, sh, g.reqs) : null;
    const target = expected ?? asked, diff = time - target;
    let result;
    if (!g.reqs.length) result = "มีโอทีใน TigerSoft แต่ไม่มีคำขอ";
    else if (time === 0 && target > 0) result = "TigerSoft ไม่ขึ้นโอที";
    else if (expected != null) result = diff === 0 ? "ตรง" : diff < 0 ? "TigerSoft ขึ้นน้อยกว่าที่ควร" : "TigerSoft ขึ้นมากกว่าที่ควร";
    else if (Math.abs(diff) <= SMALL_DIFF) result = diff === 0 ? "ตรง" : "ต่างไม่เกิน 1 ชม. (พัก/ปัดเศษ)";
    else result = diff < 0 ? "TigerSoft ขึ้นน้อยกว่าที่ขอ" : "TigerSoft ขึ้นมากกว่าที่ขอ";
    const d = { ...g, time, asked, expected, overlapCut, diff, result, noShift: !!(g.reqs.length && !sh && t), date: t ? t.date : (g.reqs[0]?.date || "") };
    days.push(d);
    if (!/^ตรง|^ต่างไม่เกิน/.test(result)) issue("amount", "warn", { day: d, text: `${result} (ขอ ${hhmm(asked)}${expected != null ? ` · ควรได้ ${hhmm(expected)}` : ""} · TigerSoft ${hhmm(time)})${d.noShift ? ` · ยังไม่มีเวลากะ ${t.shift} จึงเทียบแบบคลาดได้ 1 ชม.` : ""}` });
    const sig = r => `${r.typ}|${r.io}|${r.w0}|${r.w1}`, dup = g.reqs.length - new Set(g.reqs.map(sig)).size;
    if (dup) issue("overlap", "warn", { day: d, text: `ขอซ้ำ ${dup} รายการ (ชนิด/เวลาเดียวกัน) — ลบคำขอที่ซ้ำใน TigerSoft` });
    else if (overlapCut > 0) issue("overlap", "info", { day: d, text: `คำขอช่วงเวลาซ้อนกัน ${hhmm(overlapCut)} — ตัดออกก่อนเทียบยอด` });
    // 5. F01 วันหยุด OT1 ยังไม่หักพัก
    if (t && String(t.shift).toUpperCase() === "F01" && /^H/i.test(t.dayType) && (t.ot?.["1"] || 0) === F01_HOLIDAY_OT1 + 60)
      issue("f01", "warn", { day: d, text: `กะ F01 วันหยุด OT1 = 9:30 ยังไม่หักพัก 1 ชม. — ควรเป็น ${hhmm(F01_HOLIDAY_OT1)}` });
  }
  // คำขอที่น่าจะลงวันผิด: วันนี้ขอแต่ TigerSoft ไม่ขึ้น + วันติดกัน (±1–2) TigerSoft มีโอทีแต่ไม่มีคำขอ ยอดใกล้กัน
  const noReq = days.filter(d => !d.reqs.length && d.t);
  for (const d of days.filter(d => d.result === "TigerSoft ไม่ขึ้นโอที" && d.t)) {
    const m = noReq.find(x => x.emp === d.emp && Math.abs(x.t.day - d.t.day) <= 2 && Math.abs(x.time - d.asked) <= SMALL_DIFF);
    if (m) { d.maybe = m.date; m.maybe = d.date;
      issue("wrongday", "warn", { day: d, text: `คำขอวันที่ ${d.date} อาจลงวันผิด — TigerSoft มีโอที ${hhmm(m.time)} วันที่ ${m.date} แต่ไม่มีคำขอ` }); }
  }
  days.sort((a, b) => a.emp.localeCompare(b.emp) || a.date.localeCompare(b.date));
  return { requests, days, issues };
}

export { parseProcessed, durMin };
