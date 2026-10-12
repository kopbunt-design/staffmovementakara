// ============================================================================
// รายงานโอที & เบี้ยขยัน — ตรรกะล้วน (เทส: test/otreport.test.js)
// ทำตามแบบ "August 2026 Overtime Records" (PDF แยกตามกลุ่มแผนก) ที่ HR ใช้อยู่ — ผู้ใช้ขอ 2026-10-12:
//   ระดับ O: ชั่วโมงโอที 1 / 1.5 / 3 เท่า ต่อคน + ช่องเบี้ยขยัน
//   ระดับ S: รายงานแยก เฉพาะเบี้ยขยัน (ไม่ใส่โอที)
// ที่มา: รายงานหลังประมวลจาก TigerSoft (ชั่วโมงโอทีรายวัน) + ทะเบียนพนักงาน + ผลเบี้ยขยันที่บันทึกของเดือนเดียวกัน
// คนที่อยู่ในรายงาน = ระดับนั้นที่ยังเป็นพนักงานอยู่ช่วงใดช่วงหนึ่งของเดือน (มีหรือไม่มีโอทีก็ขึ้น)
// ============================================================================

// กลุ่มรายงานตามโฟลเดอร์อ้างอิงของ HR (ก.ค./ส.ค. 2026):
//   Processing → แยกตาม Section (Process / Metallurgy) · Maintenance แยกต่อตาม Team (Maintenance-Electrical …)
//   Mining → "Mining-" + Section (ชื่อตามรายงานเดิม) · แผนกอื่น = ชื่อแผนก (ย่อบางชื่อ)
const MINING = { "Geology": "Geology", "Mine Planning": "Mining Planning", "Mining Operation": "Mine Operation" };
const DEPT_ALIAS = { "Community Relations & Development": "CRD", "Finance & Accounting": "Finance-Accounting" };
export function reportGroup(e) {
  const dept = String(e.department || "").trim(), sec = String(e.section || "").trim(), team = String(e.team || "").trim();
  if (/^processing$/i.test(dept)) {
    if (/^maintenance$/i.test(sec)) return team ? `Maintenance-${team}` : "Maintenance";
    return sec || "Processing";
  }
  if (/^mining$/i.test(dept)) return `Mining-${MINING[sec] || sec || "Other"}`;
  return DEPT_ALIAS[dept] || dept || "Unassigned";
}

export const levelBand = lv => String(lv || "").trim().charAt(0).toUpperCase();      // "O" / "S" / "M"
const ymRange = ym => { const [y, m] = ym.split("-").map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return [`${ym}-01`, `${ym}-${String(last).padStart(2, "0")}`]; };
const employedIn = (e, ym) => { const [a, b] = ymRange(ym); const j = String(e.join_date || "").slice(0, 10), x = String(e.end_date || "").slice(0, 10);
  return (!j || j <= b) && (!x || x > a); };
export const hm = m => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, "0")}`;
const nameEn = e => [e.firstname_en, e.lastname_en].filter(Boolean).join(" ").trim();

// เหตุผลเบี้ยขยัน (ภาษาไทยในระบบ) → ป้ายภาษาอังกฤษสั้น ๆ สำหรับรายงาน (PDF เป็นภาษาอังกฤษทั้งฉบับ)
const REASON_EN = [[/^HR ตัดสิทธิ์/, "HR denied"], [/^มาสาย/, "Late"], [/^ออกก่อน/, "Early out"], [/^ขาดงาน/, "Absent"], [/^ลาป่วย/, "Sick leave"],
  [/^ลากิจ/, "Personal leave"], [/^ลาไม่รับค่าจ้าง|^ลาหักเงิน/, "Unpaid leave"], [/^ลา/, "Leave"], [/^แก้เวลา/, "Time edits > 2"],
  [/^ลงเวลานอกสถานที่/, "Off-site entry late"], [/^ไม่มีข้อมูลเวลา/, "No time data"]];
export function reasonsEn(reasons = []) {
  const out = []; for (const r of reasons) { const hit = REASON_EN.find(([re]) => re.test(r)); const t = hit ? hit[1] : "Other"; if (!out.includes(t)) out.push(t); }
  return out.join(", ");
}

// procMap: parseProcessed() · employees: แถว employees · dil: Map(emp_code → แถว diligence_results) หรือ null ถ้ายังไม่บันทึก
export function buildReport({ procMap, employees, dil = null, ym }) {
  const otOf = new Map();                                     // รหัส → { "1": นาที, "1.5": … }
  for (const t of procMap.values()) for (const d of t.days) {
    if (!d.date.startsWith(ym)) continue;
    const o = otOf.get(t.code) || {}; for (const [r, v] of Object.entries(d.ot || {})) o[r] = (o[r] || 0) + v; otOf.set(t.code, o);
  }
  const extraRates = new Set();
  const mk = e => {
    const code = String(e.emp_code).toUpperCase(), ot = otOf.get(code) || {}, dl = dil ? dil.get(e.emp_code) || dil.get(code) : null;
    for (const [r, v] of Object.entries(ot)) if (v && !["1", "1.5", "3"].includes(r)) extraRates.add(r);
    const status = [];
    if (!procMap.has(code)) status.push("No time record");
    const j = String(e.join_date || "").slice(0, 10), x = String(e.end_date || "").slice(0, 10), [a, b] = ymRange(ym);
    if (j && j > a) status.push(`Joined ${j.slice(8)}/${j.slice(5, 7)}`);
    if (x && x <= b) status.push(`Left ${x.slice(8)}/${x.slice(5, 7)}`);
    if (!nameEn(e)) status.push("No English name");
    return { code: e.emp_code, name: nameEn(e) || e.emp_code, division: e.division || "", department: e.department || "", section: e.section || "",
      team: e.team || "", level: e.job_level || "", group: reportGroup(e), ot1: ot["1"] || 0, ot15: ot["1.5"] || 0, ot3: ot["3"] || 0,
      otOther: Object.entries(ot).filter(([r]) => !["1", "1.5", "3"].includes(r)).reduce((s, [, v]) => s + v, 0),
      total: Object.values(ot).reduce((s, v) => s + v, 0),
      dil: dil == null ? null : dl ? { amount: dl.qualified ? Number(dl.amount) || 0 : 0, streak: dl.streak || 0, qualified: !!dl.qualified, why: dl.qualified ? "" : reasonsEn(dl.reasons) } : { amount: 0, streak: 0, qualified: false, why: "Not eligible" },
      status };
  };
  // ชาวต่างชาติไม่อยู่ในรายงาน (ผู้ใช้ 2026-10-12) · ไม่ได้ระบุสัญชาติ = อยู่ในรายงาน
  const foreign = e => { const n = String(e.nationality || "").trim(); return !!n && !/^(thai|ไทย)$/i.test(n); };
  const inScope = band => employees.filter(e => levelBand(e.job_level) === band && employedIn(e, ym));
  const foreigners = [...inScope("O"), ...inScope("S")].filter(foreign).map(e => e.emp_code);
  const pick = band => inScope(band).filter(e => !foreign(e)).map(mk);
  const sortRows = rs => rs.sort((p, q) => p.department.localeCompare(q.department) || p.section.localeCompare(q.section) || p.team.localeCompare(q.team) || String(p.code).localeCompare(String(q.code)));
  const groupBy = rows => {
    const m = new Map(); for (const r of rows) { (m.get(r.group) || m.set(r.group, []).get(r.group)).push(r); }
    return [...m.entries()].sort((p, q) => p[0].localeCompare(q[0])).map(([name, rs]) => ({ name, rows: sortRows(rs), totals: sum(rs) }));
  };
  const sum = rs => ({ employees: rs.length, withOT: rs.filter(r => r.total > 0).length, ot1: tot(rs, "ot1"), ot15: tot(rs, "ot15"), ot3: tot(rs, "ot3"),
    otOther: tot(rs, "otOther"), total: tot(rs, "total"), dil: rs.reduce((s, r) => s + (r.dil?.amount || 0), 0),
    dilPeople: rs.filter(r => r.dil?.qualified).length, review: rs.filter(r => r.status.length).length });
  const tot = (rs, k) => rs.reduce((s, r) => s + r[k], 0);
  const O = pick("O"), Sx = pick("S");
  // คนในไฟล์เวลาที่ไม่อยู่ในทะเบียน — ไว้แจ้งใน README
  const known = new Set(employees.map(e => String(e.emp_code).toUpperCase()));
  const notInMaster = [...procMap.keys()].filter(c => !known.has(c));
  return { ym, groupsO: groupBy(O), groupsS: groupBy(Sx), totalsO: sum(O), totalsS: sum(Sx), extraRates: [...extraRates], notInMaster, foreigners, hasDil: dil != null };
}
