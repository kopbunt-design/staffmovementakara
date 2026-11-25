// ============================================================================
// Akara Bonus — ตรรกะล้วน (ไม่แตะ DOM / DB → เทส: osascript -l JavaScript test/bonus.test.js)
// ประกาศ HR-152-2026 "การจ่ายโบนัสและเงื่อนไขการจ่าย ปี 2569" + เอกสารแนบท้าย (user 2026-11-25)
//
// เงินโบนัส = เงินเดือนพื้นฐาน (ณ 1 ธ.ค.) × 2.58 × (วันที่มีสิทธิ ÷ 365) · เงินพิเศษ = 12,000 × (วันที่มีสิทธิ ÷ 365)
// วันที่มีสิทธิ = วันปฏิทินที่ทำงานในปี (เริ่มก่อน 1 ม.ค. = 365 · เริ่มระหว่างปี = วันเริ่ม..31 ธ.ค. นับวันเริ่ม) − วันที่ถูกปรับลด
// วันที่ถูกปรับลด (สถิติ 1 ม.ค.–30 พ.ย.):
//   หัก 1 วัน/วัน  — ขาดงาน ลากิจ ลาไม่รับค่าจ้าง พักงาน ลาบวช ลาทำหมัน ลาฝึกอบรมตามความประสงค์ + ลาประเภทอื่นที่ไม่ระบุ
//   หัก 0.5 วัน/วัน — ลาป่วยส่วนเกิน 10 วัน · ลาคลอดส่วนเกิน 60 วัน (ต่อการคลอด) · ลาช่วยภริยาคลอด · ลาเลี้ยงดู/ดูแลบุตร · ลารับราชการทหาร
//   ไม่หัก         — ลาพักผ่อนประจำปี ลาหยุดชดเชย ลาเพราะเจ็บป่วยจากการทำงาน ลาจัดการงานศพ · ไปทำงานนอกสถานที่/อบรมที่บริษัทส่ง
//   ลาป่วยไม่จ่ายเงิน = ลาป่วยต่อจากใช้สิทธิครบ → นับรวมเป็นลาป่วย (user 2026-11-25)
//   มาสาย/ออกก่อน = ไม่หัก แสดงเป็นสถิติเท่านั้น (user 2026-11-25)
//   ระดับ M ไม่ถูกปรับลด และไม่ได้ส่วนแบ่งเงินจัดสรรพิเศษ (4.5, 5.4)
//   พักงานที่เริ่มภายใน 30 พ.ย. แล้วต่อเนื่องเกิน → นับทั้งหมดตามคำสั่งในรอบนี้ (2.4)
// เงินจัดสรรพิเศษ = ยอดที่ถูกปรับลด (เฉพาะส่วนที่มาจากการหักวัน ไม่รวมส่วนที่ลดตามวันเริ่มงาน) รวมทั้งบริษัท ÷ จำนวนผู้มีสิทธิ (ไม่รวม M) เท่ากันทุกคน
// ปัดทศนิยม 2 ตำแหน่งทุกยอด (2.3)
// ============================================================================
import { parseProcessed, leaveKinds, durMin, serialToISO } from "./diligence-calc.js";

export const PARAMS_2026 = {
  year: 2026, mult: 2.58, special: 12000, stat_from: "2026-01-01", stat_to: "2026-11-30",
  join_by: "2026-08-31", pay_date: "2026-12-25", base_date: "2026-12-01", sick_free: 10, mat_free: 60, probation_days: 119,
};
export const round2 = x => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const pad = n => String(n).padStart(2, "0");
const iso = t => new Date(t).toISOString().slice(0, 10);
const T = d => Date.parse(String(d).slice(0, 10) + "T00:00:00Z");
export const addDays = (d, n) => iso(T(d) + n * 864e5);
export const daysBetween = (a, b) => Math.round((T(b) - T(a)) / 864e5);          // b − a
const str = v => String(v ?? "").trim();

// ---------------------------------------------------------------- ประเภทการลา → น้ำหนัก
// full = หักเต็มวัน · half = หักครึ่งวัน · sick = ลาป่วย (ฟรี 10 วัน/ปี แล้วครึ่งวัน) · mat = ลาคลอด (ฟรี 60 วันต่อครั้ง แล้วครึ่งวัน)
// none = ไม่หัก · ignore = ไม่ใช่การลา (ไม่นับ ไม่แสดงในสรุป)
export const CLS = {
  full: { th: "หัก 1 วัน", w: 1, tone: "red" }, half: { th: "หัก 0.5 วัน", w: .5, tone: "amb" },
  sick: { th: `ลาป่วย · ${10} วันแรกไม่หัก แล้ว 0.5`, w: .5, tone: "amb" }, mat: { th: "ลาคลอด · 60 วันแรกไม่หัก แล้ว 0.5", w: .5, tone: "amb" },
  none: { th: "ไม่หัก", w: 0, tone: "em" }, ignore: { th: "ไม่ใช่การลา", w: 0, tone: "gray" },
};
export const ABSENT = "ขาดงาน", NOSCAN = "ไม่ได้รูดบัตร (หักวัน)", SUSPEND = "พักงาน", LEAVE_NA = "ลา (ไม่ระบุประเภท)";
// เจ็บป่วย/อุบัติเหตุจากการทำงาน = ไม่หัก — แต่พนักงานคีย์ประเภทลาเองใน TigerSoft อาจคีย์ผิด (user 2026-11-25)
// → ประเภทจาก TigerSoft ที่ชื่อชวนให้คิดว่าเจ็บจากงาน นับเป็นลาป่วยไว้ก่อน (injuryHint) จนกว่า HR ยืนยันรายคน
//   = บันทึกใบลาประเภท WORK_INJURY ทับช่วงนั้น (ประเภทนี้มาจาก HR เท่านั้น จึงไม่หักเสมอ)
export const WORK_INJURY = "ลาเนื่องจากเจ็บป่วย/อุบัติเหตุจากการทำงาน (HR ยืนยัน)";
// ใบลงเวลากระดาษ (ช่วงที่ TigerSoft ยังไม่ตั้งกะ) แสดงว่าวันนั้นมาทำงาน → HR บันทึกทับวันที่ TigerSoft ขึ้นขาดงาน = ไม่นับ (user 2026-11-25)
export const WORKED = "มาทำงาน (ลงเวลากระดาษ)";
export const injuryHint = kind => kind !== WORK_INJURY && /อุบัติเหตุ|ตกจากที่สูง|บาดเจ็บ|ประสบอันตราย|จากการทำงาน|จากงาน|ในงาน/.test(str(kind).replace(/\s+/g, ""));
// เดาจากชื่อ — HR ยืนยันทีละประเภทในหน้า "ประเภทการลา" (ที่ยังไม่ยืนยัน = นับตามที่เดา และขึ้นป้าย "ใหม่")
export function suggestClass(kind) {
  const k = str(kind).replace(/\s+/g, "");
  if (!k) return "full";
  if (kind === WORK_INJURY) return "none";
  if (kind === WORKED) return "ignore";
  if (injuryHint(kind)) return "sick";      // ต้องให้ HR ยืนยันรายคนก่อนจึงไม่หัก
  if (/พักร้อน|พักผ่อน|หยุดชดเชย|ฌาปน|ฌาปณ|งานศพ|ศพ/.test(k)) return "none";
  if (/ปฏิบัติงานนอก|ปฎิบัติงานนอก|นอกสถานที่|ราชการบริษัท|อบรม.*บริษัท|บริษัทส่ง/.test(k)) return "none";
  if (/ช่วย.*คลอด|ภริยา.*คลอด|คู่สมรส.*คลอด|เลี้ยงดูบุตร|เลี้ยงบุตร|ดูแลบุตร|ทหาร|ระดมพล/.test(k)) return "half";
  if (/คลอด/.test(k)) return "mat";
  if (/ป่วย/.test(k)) return "sick";
  return "full";                       // ขาดงาน ลากิจ ไม่รับค่าจ้าง พักงาน บวช ทำหมัน อบรมตามความประสงค์ และ "ประเภทอื่นที่ไม่ระบุ"
}
export const classOf = (kind, types = {}) => kind === WORK_INJURY ? "none" : kind === WORKED ? "ignore" : types[kind] || suggestClass(kind);

// ---------------------------------------------------------------- ไฟล์ TigerSoft → วันต่อคน
// "1-00:00" = 1 วัน · ชั่วโมงหาร "ชั่วโมงทำงานต่อวัน" ของกะ แล้วปัดทศนิยม 2 ตำแหน่ง (ลาเป็นชั่วโมงได้)
// ฐาน 8.5 ชม. (หน้างาน 7.30–17.00) · กะ BKK (ออฟฟิศกรุงเทพ 8.30–17.30) ฐาน 8 ชม. (user 2026-11-25)
// TigerSoft ลงครึ่งวันเป็น 0-04:15 ทุกกะ (รวม BKK) → 4:15 ถือเป็นครึ่งวันเสมอ
export const dayHours = shift => /^BKK/i.test(str(shift)) ? 8 : 8.5;
export function durDays(v, shift = "") {
  const t = str(v); if (!t) return 0;
  const m = /^(\d+)-(\d+):(\d+)$/.exec(t);
  const d = m ? +m[1] : 0, min = m ? +m[2] * 60 + +m[3] : durMin(t);
  return d + (min === 255 ? .5 : Math.min(1, round2(min / (dayHours(shift) * 60))));
}
const hm = m => m == null ? "" : `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
// วันหนึ่งของ TigerSoft → { kind, days } ของการลา/ขาด (null = วันทำงานปกติ / วันหยุด)
export function dayEvent(d) {
  const note = str(d.note);
  if (d.leaveOk || d.leaveDed) {
    const days = durDays(d.leaveOk ? d.leaveOkV : d.leaveDedV, d.shift) || 1;
    if (/พักงาน/.test(note)) return { kind: SUSPEND, days };
    const k = leaveKinds(note)[0];
    return { kind: k || LEAVE_NA, days };
  }
  if (d.deduct) return { kind: /ไม่ได้รูดบัตร|ไม่ได้สแกน/.test(note) ? NOSCAN : ABSENT, days: durDays(d.deduct, d.shift) || 1 };
  return null;
}
// rows = sheet_to_json(header:1) ของรายงาน "ข้อมูลหลังประมวล" (ไฟล์ .xls ดิบจาก TigerSoft)
// หรือ sheet Clean_Data ของไฟล์ที่แปลงแล้ว → Map ym → [{ code, name, cal:[วัน], agg, events }]
export function readTime(rows) {
  const emps = isClean(rows) ? fromClean(rows) : parseProcessed(rows);
  const out = new Map();
  for (const e of emps.values()) {
    const byYM = new Map();
    for (const d of e.days) { const ym = d.date.slice(0, 7); (byYM.get(ym) || byYM.set(ym, []).get(ym)).push(d); }
    for (const [ym, days] of byYM) {
      const agg = { late_n: 0, late_min: 0, early_n: 0, early_min: 0, work: 0 }, events = [];
      const cal = days.sort((a, b) => a.date.localeCompare(b.date)).map(d => {
        const ev = dayEvent(d), lt = durMin(d.late), er = durMin(d.early);
        if (lt) { agg.late_n++; agg.late_min += lt; }
        if (er) { agg.early_n++; agg.early_min += er; }
        if (d.inMin != null || d.outMin != null) agg.work++;
        if (ev) events.push({ d: d.date, kind: ev.kind, days: ev.days, note: str(d.note).slice(0, 200) });
        return [d.date.slice(8), d.shift || "", d.dayType || "", hm(d.inMin), hm(d.outMin), lt || 0, er || 0, ev?.kind || "", ev?.days || 0, str(d.note).slice(0, 120)];
      });
      (out.get(ym) || out.set(ym, []).get(ym)).push({ code: e.code, name: e.name, cal, agg, events });
    }
  }
  return out;
}
const isClean = rows => (rows[0] || []).map(str).includes("Employee_ID") && (rows[0] || []).map(str).includes("Leave_No_Deduct");
function fromClean(rows) {
  const h = rows[0].map(str), at = k => h.indexOf(k), emps = new Map();
  const tmin = v => v instanceof Date ? v.getUTCHours() * 60 + v.getUTCMinutes() : typeof v === "number" ? Math.round((v % 1) * 1440) : null;
  for (const r of rows.slice(1)) {
    const code = str(r[at("Employee_ID")]).toUpperCase(); if (!code) continue;
    const dv = r[at("Date")], date = dv instanceof Date ? iso(Date.UTC(dv.getFullYear(), dv.getMonth(), dv.getDate())) : typeof dv === "number" ? serialToISO(dv) : str(dv).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const e = emps.get(code) || emps.set(code, { code, name: str(r[at("Employee_Name")]), days: [] }).get(code);
    const v = k => str(r[at(k)]), nz = k => /[1-9]/.test(v(k));
    e.days.push({ date, shift: v("Shift"), dayType: v("Day_Type"), late: nz("Late") ? v("Late") : "", early: nz("Early_Out") ? v("Early_Out") : "",
      leaveOk: nz("Leave_No_Deduct"), leaveDed: nz("Leave_Deduct"), leaveOkV: v("Leave_No_Deduct"), leaveDedV: v("Leave_Deduct"),
      deduct: nz("Deduct_Day") ? v("Deduct_Day") : "", note: v("Note").replace(/\s+/g, " "), inMin: tmin(r[at("Check_In")]), outMin: tmin(r[at("Check_Out")]) });
  }
  if (!emps.size) throw new Error("ไฟล์ Clean_Data ไม่มีแถวพนักงาน");
  return emps;
}

// ---------------------------------------------------------------- สิทธิ์ (ข้อ 2 ของประกาศ)
const isM = lv => /^M/i.test(str(lv));
export { isM };
// moves = movements ของคนนี้ (type, date) · ผลเป็นรายการเหตุผลที่ไม่มีสิทธิ์ (ว่าง = มีสิทธิ์)
// ไม่อยู่ในการพิจารณาโบนัส (user 2026-11-25): สัญชาติออสเตรเลีย · รหัส DAY… (ลูกจ้างรายวัน)
export const NOT_CONSIDERED = [
  [e => /^DAY/i.test(str(e?.emp_code)), "ลูกจ้างรายวัน (รหัส DAY) — ไม่อยู่ในการพิจารณาโบนัส"],
  [e => /austral|ออสเตรเลีย/i.test(str(e?.nationality)), "สัญชาติออสเตรเลีย — ไม่อยู่ในการพิจารณาโบนัส"],
];
export function eligibility(emp, moves = [], P = PARAMS_2026) {
  const why = [], j = str(emp?.join_date).slice(0, 10);
  for (const [t, txt] of NOT_CONSIDERED) if (t(emp)) return [txt];
  if (!j) why.push("ไม่มีวันเริ่มงานในทะเบียน");
  else {
    if (j > P.join_by) why.push(`เริ่มงานหลัง ${P.join_by}`);
    else if (addDays(j, P.probation_days - 1) > P.pay_date) why.push(`ยังไม่พ้นทดลองงานก่อนวันจ่าย (วันที่ ${P.probation_days} = ${addDays(j, P.probation_days - 1)})`);
  }
  const end = str(emp?.end_date).slice(0, 10);
  // end_date = วันแรกที่ไม่ได้ทำงาน · พ้นสภาพตั้งแต่ก่อน/ในวันจ่าย = ไม่มีสถานะพนักงาน ณ วันจ่าย
  const retire = moves.find(m => /retire/i.test(m.type) && str(m.date).slice(0, 10) === end);
  if (end && end <= P.pay_date) why.push(`พ้นสภาพ ${end}`);
  else if (end && !retire) {
    const res = moves.find(m => /resign/i.test(m.type) && str(m.date).slice(0, 10) === end);
    why.push(res ? `ยื่นลาออกแล้ว (มีผล ${end})` : `มีวันพ้นสภาพ ${end}`);
  }
  return why;
}
// วันปฏิบัติงานในปี (ข้อ 3.2) — นับวันปฏิทิน
export function workedDays(joinDate, P = PARAMS_2026) {
  const y0 = `${P.year}-01-01`, y1 = `${P.year}-12-31`, j = str(joinDate).slice(0, 10);
  if (!j || j < y0) return daysBetween(y0, y1) + 1;
  if (j > y1) return 0;
  return daysBetween(j, y1) + 1;
}

// ---------------------------------------------------------------- วันที่ถูกปรับลด
// events = [{ d, kind, days }] จาก TigerSoft (ทั้งปี) · adj = [{ d_from, d_to, kind, days, note }] ที่ HR บันทึก
//   ช่วงวันที่ของ adj "แทนที่" ข้อมูล TigerSoft ในช่วงนั้น (ใช้ทั้งเพิ่มใบลากระดาษ และแก้ ขาดงาน → ลาป่วย ฯลฯ)
// offMonths = Set ของ ym ที่ไม่นับ "ขาดงาน" จากไฟล์ (ช่วงที่ยังไม่ได้ตั้งกะใน TigerSoft)
export function deductions({ events = [], adj = [], types = {}, join = null, level = "", offMonths = new Set() }, P = PARAMS_2026) {
  const from = join && join > P.stat_from ? join.slice(0, 10) : P.stat_from, to = P.stat_to;
  const covered = d => adj.some(a => d >= a.d_from && d <= (a.d_to || a.d_from));
  const items = [];
  for (const e of events) {
    if (e.d < from || e.d > to || covered(e.d)) continue;
    if (offMonths.has(e.d.slice(0, 7)) && (e.kind === ABSENT || e.kind === NOSCAN)) continue;
    items.push({ d: e.d, d2: e.d, kind: e.kind, days: +e.days || 0, src: "ts" });
  }
  for (const a of adj) {
    const a1 = a.d_to || a.d_from;
    if (a1 < from) continue;
    // พักงานที่เริ่มในช่วงเก็บสถิติ → นับทั้งหมดแม้ต่อเกิน 30 พ.ย. (2.4) · อย่างอื่นนับเฉพาะในช่วง
    if (a.d_from > to) continue;
    const susp = a.kind === SUSPEND || /พักงาน/.test(a.kind);
    let days = +a.days || 0;
    if (!susp && a1 > to) days = round2(days * (daysBetween(a.d_from, to) + 1) / (daysBetween(a.d_from, a1) + 1));
    items.push({ d: a.d_from, d2: a1, kind: a.kind, days, src: "hr", note: a.note || "" });
  }
  const by = new Map();
  for (const it of items) { const o = by.get(it.kind) || by.set(it.kind, { kind: it.kind, cls: classOf(it.kind, types), days: 0, items: [] }).get(it.kind); o.days += it.days; o.items.push(it); }
  const lines = [...by.values()].filter(l => l.cls !== "ignore").map(l => ({ ...l, days: round2(l.days), ded: 0, free: 0 }));
  // ลาป่วยทุกประเภทรวมกันใช้สิทธิ 10 วันแรกร่วมกัน (เรียงตามวันที่)
  let sickLeft = P.sick_free;
  const sick = lines.filter(l => l.cls === "sick").flatMap(l => l.items.map(it => ({ l, it }))).sort((a, b) => a.it.d.localeCompare(b.it.d));
  for (const { l, it } of sick) { const free = Math.min(sickLeft, it.days); sickLeft -= free; l.free += free; l.ded += (it.days - free) * .5; }
  for (const l of lines) {
    if (l.cls === "full") l.ded = l.days;
    else if (l.cls === "half") l.ded = l.days * .5;
    else if (l.cls === "mat") {              // ต่อการคลอด: ช่วงลาห่างกันเกิน 30 วัน = คนละครั้ง
      const its = [...l.items].sort((a, b) => a.d.localeCompare(b.d)); let ep = 0, last = null;
      for (const it of its) { if (last && daysBetween(last, it.d) > 30) ep = 0; const free = Math.max(0, Math.min(P.mat_free - ep, it.days)); ep += it.days; l.free += free; l.ded += (it.days - free) * .5; last = it.d2; }
    } else if (l.cls === "none") l.free = l.days;
    l.ded = round2(l.ded); l.free = round2(l.free);
  }
  const exempt = isM(level);
  const total = exempt ? 0 : round2(lines.reduce((t, l) => t + l.ded, 0));
  lines.sort((a, b) => b.ded - a.ded || b.days - a.days);
  return { lines, total, exempt };
}
// คำอธิบายบรรทัดเดียว เช่น "ลาป่วย 14 วัน: 10 วันแรกไม่หัก ส่วนเกิน 4 × 0.5 = 2"
export function explain(l) {
  const n = x => (Math.round(x * 100) / 100).toLocaleString("en-US");
  if (l.cls === "full") return `${n(l.days)} × 1 = ${n(l.ded)} วัน`;
  if (l.cls === "half") return `${n(l.days)} × 0.5 = ${n(l.ded)} วัน`;
  if (l.cls === "none") return "ไม่หัก";
  if (l.cls === "sick" || l.cls === "mat") return l.ded ? `ใช้สิทธิไม่หัก ${n(l.free)} วัน · ส่วนเกิน ${n(l.ded * 2)} × 0.5 = ${n(l.ded)} วัน` : `อยู่ในสิทธิไม่หัก (${n(l.free)} วัน)`;
  return "";
}

// ---------------------------------------------------------------- เงิน
export function money(salary, eligibleDays, worked, P = PARAMS_2026) {
  const s = +salary || 0, yd = daysBetween(`${P.year}-01-01`, `${P.year}-12-31`) + 1;
  const bonus = round2(s * P.mult * eligibleDays / yd), special = round2(P.special * eligibleDays / yd);
  const fullB = round2(s * P.mult * worked / yd), fullS = round2(P.special * worked / yd);
  return { bonus, special, fullB, fullS, cut: round2(fullB + fullS - bonus - special) };
}
// คำนวณทั้งบริษัท: emps = ทะเบียน (emp_code, join_date, end_date, job_level, salary?) · data = ผลจากเซิร์ฟเวอร์
export function compute({ emps = [], moves = [], events = [], adj = [], types = {}, offMonths = new Set(), overrides = {} }, P = PARAMS_2026) {
  const evBy = new Map(), adjBy = new Map(), mvBy = new Map();
  for (const e of events) (evBy.get(e.emp_code) || evBy.set(e.emp_code, []).get(e.emp_code)).push(e);
  for (const a of adj) (adjBy.get(a.emp_code) || adjBy.set(a.emp_code, []).get(a.emp_code)).push(a);
  for (const m of moves) (mvBy.get(m.emp_code) || mvBy.set(m.emp_code, []).get(m.emp_code)).push(m);
  const rows = emps.map(e => {
    const code = e.emp_code, ov = overrides[code] || {};
    let why = eligibility(e, mvBy.get(code) || [], P);
    if (ov.elig === "yes") why = []; else if (ov.elig === "no") why = [ov.note || "HR กำหนดว่าไม่มีสิทธิ์"];
    const worked = workedDays(e.join_date, P);
    const dd = deductions({ events: evBy.get(code) || [], adj: adjBy.get(code) || [], types, join: str(e.join_date).slice(0, 10) || null, level: e.job_level, offMonths }, P);
    const eligibleDays = Math.max(0, round2(worked - dd.total));
    const m = e.salary != null ? money(e.salary, eligibleDays, worked, P) : null;
    return { code, emp: e, ok: !why.length, why, worked, ded: dd, eligibleDays, m, M: isM(e.job_level), override: ov.elig || null };
  });
  const ok = rows.filter(r => r.ok), share = ok.filter(r => !r.M);
  const pool = round2(ok.reduce((t, r) => t + (r.m?.cut || 0), 0));
  const per = share.length ? round2(pool / share.length) : 0;
  for (const r of rows) {
    r.alloc = r.ok && !r.M ? per : 0;
    r.total = r.ok && r.m ? round2(r.m.bonus + r.m.special + r.alloc) : 0;
  }
  return { rows, pool, per, nShare: share.length, nOk: ok.length };
}
