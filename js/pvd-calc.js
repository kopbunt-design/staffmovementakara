// ============================================================================
// กองทุนสำรองเลี้ยงชีพ (PVD) — ตรรกะล้วน (เทส: test/pvd.test.js) · user 2026-11-13
// กติกาจากระเบียบสวัสดิการ AKR-OHR-SD-002 ข้อ 14 (มีผล 16 เม.ย. 2026):
//   เงินสะสม 2–15% ของฐานเงินเดือน · บริษัทสมทบเท่าเงินสะสม แต่ไม่เกินเพดานตามอายุงาน:
//     < 3 ปี 5% · 3–<6 ปี 7% · 6–<10 ปี 10% · 10 ปีขึ้นไป 12%
//   เพดานใหม่เริ่มรอบเงินเดือน "เดือนที่ครบ" เลย (user 2026-11-13 แก้จาก "เดือนถัดไป" ที่ตอบไว้ตอนแรก — เช่น AKR23101073 ครบ 3 ต.ค. ได้ 7% รอบ ต.ค.)
//   ลาออกจากกองทุนระหว่างยังเป็นพนักงาน → กลับเข้า PVD ไม่ได้อีก ต้องสมัครกองทุนสงเคราะห์ลูกจ้างแทน (user 2026-11-13) — barred()
//   สิทธิ์ในเงินสมทบเมื่อพ้นสภาพ (อายุงานรวมทดลองงาน): 1–<2 ปี 25% · 2–<3 50% · 3–<4 75% · 4 ปีขึ้นไป 100%
// ฐานที่หัก = เงินเดือน − ขาด/ลา/มาสาย/ออกก่อน/พักงาน (ตรวจกับไฟล์เงินเดือน ต.ค. 2026: 452/452 คน)
// ============================================================================

export const COMPANY_CODE = 2958;
export const STATUS_TH = { active: "เป็นสมาชิก", left: "ออกจากกองทุน", declined: "ไม่สมัคร", pending: "รอเป็นสมาชิก" };
export const CAP_TIERS = [[10, 0.12], [6, 0.10], [3, 0.07], [0, 0.05]];        // [อายุงานขั้นต่ำ (ปี), เพดานสมทบ]
export const VEST_TIERS = [[4, 1], [3, 0.75], [2, 0.5], [1, 0.25], [0, 0]];
export const EMP_RATE_MIN = 0.02, EMP_RATE_MAX = 0.15;

const pad = n => String(n).padStart(2, "0");
const iso = d => String(d || "").slice(0, 10);
export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const num = v => { if (v == null || v === "") return 0; const n = Number(String(v).replace(/,/g, "")); return isFinite(n) ? n : 0; };
const norm = s => String(s ?? "").replace(/\s+/g, " ").trim();

export function addYears(d, n) {                         // 29 ก.พ. + n ปี ที่ไม่ใช่ปีอธิกสุรทิน → 1 มี.ค.
  const [y, m, dd] = iso(d).split("-").map(Number);
  const t = new Date(Date.UTC(y + n, m - 1, dd));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export const ymAdd = (ym, k) => { const [y, m] = ym.split("-").map(Number); const t = (y * 12 + m - 1) + k; return `${Math.floor(t / 12)}-${pad(t % 12 + 1)}`; };
export const lastDay = ym => { const [y, m] = ym.split("-").map(Number); return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`; };

// ปีเต็มที่ทำงานครบ ณ วันที่ on (วันครบรอบนับว่าครบแล้ว)
export function yearsAt(join, on) {
  if (!join || !on) return 0;
  let n = 0; while (addYears(join, n + 1) <= iso(on)) n++;
  return n;
}
export const capOf = years => CAP_TIERS.find(([y]) => years >= y)[1];
// เพดานสมทบของรอบเงินเดือน ym = อายุงาน ณ สิ้นเดือนนั้น (ครบเดือนไหน ได้อัตราใหม่เดือนนั้นเลย)
export const erCapFor = (join, ym) => capOf(yearsAt(join, lastDay(ym)));
// ลาออกจากกองทุนแล้วสมัครใหม่ไม่ได้: ติ๊กไว้ (no_rejoin) หรือสถานะ "ออกจากกองทุน" ทั้งที่ยังเป็นพนักงานอยู่
export const barred = (m, e, today) => !!m && (!!m.no_rejoin || (m.status === "left" && !!e && (!e.end_date || iso(e.end_date) > today)));
export const erRateFor = (empRate, join, ym) => Math.min(Number(empRate) || 0, erCapFor(join, ym));
// สิทธิ์ในเงินสมทบเมื่อพ้นสภาพ — end = วันที่พ้นสภาพ (วันแรกที่ไม่ได้ทำงาน ตามทะเบียน) → ทำงานครบถึงวันก่อนหน้า
export const vestOf = (join, end) => { const y = yearsAt(join, end); return { years: y, pct: VEST_TIERS.find(([t]) => y >= t)[1] }; };

// ---------------------------------------------------------------- แจ้งเตือน: อายุงานจะครบขั้นที่เพดานสมทบเปลี่ยน
// members: [{emp_code, emp_rate, status}] · emps: Map(code → employee) · ym = รอบเงินเดือนปัจจุบัน · ahead = ดูล่วงหน้ากี่เดือน
export function tierAlerts(members, emps, ym, ahead = 3) {
  const out = [];
  for (const m of members) {
    if (m.status !== "active") continue;
    const e = emps.get(m.emp_code); const join = iso(e?.join_date);
    if (!join || (e.end_date && iso(e.end_date) <= lastDay(ym))) continue;
    for (const t of [3, 6, 10]) {
      const anniv = addYears(join, t), eff = anniv.slice(0, 7);
      if (eff < ym || eff > ymAdd(ym, ahead)) continue;
      const before = capOf(t - 1), after = capOf(t), r = Number(m.emp_rate) || 0;
      out.push({ emp_code: m.emp_code, years: t, anniv, eff, capBefore: before, capAfter: after, empRate: r,
                 erBefore: Math.min(r, before), erAfter: Math.min(r, after), changes: Math.min(r, after) > Math.min(r, before) });
    }
  }
  return out.sort((a, b) => a.eff.localeCompare(b.eff) || a.emp_code.localeCompare(b.emp_code));
}

// ---------------------------------------------------------------- แจ้งเตือนทะเบียน
// พ้นทดลองงาน (วันที่ 119 นับวันเข้างานเป็นวันที่ 1 — กติกาเดียวกับเบี้ยขยัน) แล้วยังไม่มีในทะเบียน PVD
export const probationEnd = join => { const [y, m, d] = iso(join).split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d + 118));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
export function registerAlerts(members, employees, today) {
  const byCode = new Map(members.map(m => [m.emp_code, m]));
  const eligible = [], left = [], missing = [], wef = [];
  for (const e of employees) {
    const code = e.emp_code, m = byCode.get(code), end = iso(e.end_date), join = iso(e.join_date);
    if (m?.status === "active" && end && end <= today) left.push({ emp_code: code, end, ...vestOf(join, end) });
    if (barred(m, e, today)) wef.push({ emp_code: code, left_date: m.left_date || null });
    // ยังไม่มีแถวในทะเบียน (คนที่ไม่สมัครให้บันทึกสถานะ "ไม่สมัคร" ไว้ จะได้ไม่ขึ้นซ้ำ) · เฉพาะพนักงานประจำ
    if (!m && join && (!end || end > today) && /^permanent$/i.test(norm(e.contract_type || "Permanent")) && probationEnd(join) <= today)
      eligible.push({ emp_code: code, join, probationEnd: probationEnd(join) });
  }
  for (const m of members) if (m.status === "active") {
    const miss = [!m.member_code && "รหัสสมาชิก", !/^\d{13}$/.test(m.id_card || "") && "เลขบัตร", !m.dob && "วันเกิด", !m.sec_code && "รหัสสังกัด",
                  !(Number(m.emp_rate) >= EMP_RATE_MIN && Number(m.emp_rate) <= EMP_RATE_MAX) && "อัตราสะสม"].filter(Boolean);
    if (miss.length) missing.push({ emp_code: m.emp_code, miss });
  }
  return { eligible, left, missing, wef };
}

// ---------------------------------------------------------------- ไฟล์เงินเดือน TigerSoft (BeforeProcessYDP)
const COLS = { code: "รหัสพนักงาน", name: "ชื่อ-นามสกุล", salary: "เงินเดือน", emp: "กองทุนสำรองเลี้ยงชีพ", er: "กองทุนบริษัทสมทบ" };
const LESS = ["ขาด", "ลา", "มาสาย", "ออกก่อน", "พักงาน"];
export function parsePayroll(aoa) {
  const hr = aoa.slice(0, 5).findIndex(r => (r || []).map(norm).includes(COLS.code));
  if (hr < 0) throw new Error("ไม่พบคอลัมน์ “รหัสพนักงาน” — ต้องเป็นไฟล์เงินเดือนจาก TigerSoft (BeforeProcessYDP)");
  const head = aoa[hr].map(norm), ix = k => head.indexOf(k);
  for (const k of ["salary", "emp", "er"]) if (ix(COLS[k]) < 0) throw new Error(`ไม่พบคอลัมน์ “${COLS[k]}” ในไฟล์เงินเดือน`);
  const less = LESS.map(ix).filter(i => i >= 0), out = new Map();
  for (const r of aoa.slice(hr + 1)) {
    const code = norm(r[ix(COLS.code)]).toUpperCase(); if (!code) continue;
    const o = out.get(code) || { code, name: norm(r[ix(COLS.name)]), salary: 0, base: 0, emp: 0, er: 0 };
    const sal = num(r[ix(COLS.salary)]);
    o.salary = round2(o.salary + sal); o.base = round2(o.base + sal - less.reduce((s, i) => s + num(r[i]), 0));
    o.emp = round2(o.emp + num(r[ix(COLS.emp)])); o.er = round2(o.er + num(r[ix(COLS.er)]));
    out.set(code, o);
  }
  return out;
}

// สมาชิกที่ยังต้องส่งเงินในรอบ ym — active หรือออกจากกองทุนระหว่าง/หลังเดือนนั้น (เดือนสุดท้ายยังหักตามปกติ:
// 6 คนที่ออก ต.ค. 2026 อยู่ในไฟล์ส่งกองทุน ต.ค.)
export const inMonth = (m, ym) => !!m && (m.status === "active" || (m.status === "left" && !!m.left_date && iso(m.left_date) >= `${ym}-01`));

// ---------------------------------------------------------------- ตรวจยอดรายเดือน
// pay: parsePayroll() · members: ทะเบียน · emps: Map(code → employee) · ym = รอบเงินเดือน
// ผล: items (คนที่มีเงินกองทุนในไฟล์) + issues (ต้องดู) · ยอมคลาด 0.02 บาทจากการปัดเศษ
const TOL = 0.02;
export function checkMonth({ pay, members, emps, ym }) {
  const mem = new Map(members.map(m => [m.emp_code, m])), items = [], issues = [];
  const add = (code, kind, text, level = "warn") => issues.push({ emp_code: code, kind, text, level });
  for (const p of pay.values()) {
    if (!p.emp && !p.er) continue;
    const m = mem.get(p.code), e = emps.get(p.code), join = iso(e?.join_date);
    const it = { emp_code: p.code, name: p.name, salary: p.salary, base: p.base, emp_amt: p.emp, er_amt: p.er,
                 emp_rate: m ? Number(m.emp_rate) || 0 : null, er_cap: join ? erCapFor(join, ym) : null };
    items.push(it); it.ok = inMonth(m, ym);
    if (!inMonth(m, ym)) { add(p.code, "not_member", m ? `มีหักในไฟล์เงินเดือน แต่ทะเบียนเป็น "${STATUS_TH[m.status] || m.status}"${m.left_date ? " ตั้งแต่ " + iso(m.left_date) : ""}` : "มีหักในไฟล์เงินเดือน แต่ไม่มีในทะเบียน PVD"); continue; }
    if (!join) { add(p.code, "no_join", "ไม่มีวันเริ่มงานในทะเบียนพนักงาน — คิดเพดานสมทบไม่ได้"); continue; }
    const wantE = round2(p.base * it.emp_rate), wantR = round2(p.base * Math.min(it.emp_rate, it.er_cap));
    it.want_emp = wantE; it.want_er = wantR;
    if (Math.abs(p.emp - wantE) > TOL)
      add(p.code, "emp_rate", `เงินสะสม ${p.emp.toFixed(2)} ≠ ${(it.emp_rate * 100).toFixed(0)}% ของฐาน ${p.base.toFixed(2)} = ${wantE.toFixed(2)} (คิดได้ ${(p.base ? p.emp / p.base * 100 : 0).toFixed(2)}%)`);
    if (Math.abs(p.er - wantR) > TOL) {
      const was = round2(p.base * Math.min(it.emp_rate, erCapFor(join, ymAdd(ym, -1))));
      const tier = Math.abs(p.er - was) <= TOL && was < wantR;
      add(p.code, tier ? "tier_not_applied" : "er_rate", tier
        ? `อายุงานครบ ${yearsAt(join, lastDay(ym))} ปี — รอบนี้ต้องสมทบ ${(Math.min(it.emp_rate, it.er_cap) * 100).toFixed(0)}% = ${wantR.toFixed(2)} แต่ไฟล์ยังเป็น ${p.er.toFixed(2)}`
        : `เงินสมทบ ${p.er.toFixed(2)} ≠ ${(Math.min(it.emp_rate, it.er_cap) * 100).toFixed(0)}% ของฐาน = ${wantR.toFixed(2)} (เพดานตามอายุงาน ${(it.er_cap * 100).toFixed(0)}%)`);
    }
    const miss = [!m.member_code && "รหัสสมาชิก", !/^\d{13}$/.test(m.id_card || "") && "เลขบัตร", !m.dob && "วันเกิด", !m.sec_code && "รหัสสังกัด"].filter(Boolean);
    if (miss.length) add(p.code, "missing", `ทะเบียนยังไม่มี ${miss.join(", ")} — ใส่ไฟล์ส่งกองทุนไม่ครบ`);
  }
  for (const m of members) {
    if (m.status !== "active" || pay.get(m.emp_code)?.emp || pay.get(m.emp_code)?.er) continue;
    const e = emps.get(m.emp_code), end = iso(e?.end_date);
    if (end && end <= `${ym}-01`) add(m.emp_code, "left", `พ้นสภาพ ${end} แต่ทะเบียน PVD ยัง active — แจ้งกองทุน/ปิดสมาชิก`);
    else if (!pay.has(m.emp_code)) add(m.emp_code, "no_pay", "สมาชิก active แต่ไม่มีในไฟล์เงินเดือนเดือนนี้", "info");
    else add(m.emp_code, "no_deduct", "สมาชิก active แต่ไม่มีการหักเงินสะสมเดือนนี้");
  }
  const tot = k => round2(items.reduce((s, i) => s + i[k], 0));
  return { items, issues, totals: { members: items.length, emp: tot("emp_amt"), er: tot("er_amt") } };
}

// ---------------------------------------------------------------- ไฟล์ส่งกองทุน (รูปแบบเดียวกับ "Akara Provident Fund_October 2026.xlsx")
// แถว 1 = ชนิด/ความยาวช่อง · แถว 2 = หัวตาราง · วันจ่ายเงินเดือน = ddmmyyyy พ.ศ. (ตัวเลข) · วันเกิดตามที่เก็บในทะเบียน
export const UPLOAD_HEAD = [["C(5)", "C(20)", "C(15)", "C(13)", "C(8)", "C(30)", "C(40)", "C(110)", "C(8)", "N(11)", "N(11)", "C(50)", "C(50)"],
  ["รหัสบริษัท", "รหัสสังกัด", "รหัสสมาชิก", "เลขบัตรประชาชน", "วัน เดือน ปี เกิด ", "คำนำหน้าชื่อ", "ชื่อ", "นามสกุล", "วันที่จ่ายเงินเดือน", "เงินสะสม", "เงินสมทบ", "แผนการลงทุน", "หมายเหตุ"]];
export const payDateBE = d => { const [y, m, dd] = iso(d).split("-"); return Number(`${dd}${m}${Number(y) + 543}`); };
// แผนการลงทุนใส่เฉพาะเดือนแรกที่ส่งเงินของสมาชิกคนนั้น (ไฟล์ ต.ค. 2026: มีแผนเฉพาะ 3 คนใหม่ · คนเดิมเว้นว่าง)
// sentBefore = Set ของรหัสพนักงานที่เคยส่งเงินในรอบก่อน ๆ
export function uploadRows(items, members, payDate, sentBefore = null) {
  const mem = new Map(members.map(m => [m.emp_code, m]));
  return items.filter(i => i.ok !== false && mem.has(i.emp_code)).map(i => { const m = mem.get(i.emp_code);
    return [COMPANY_CODE, m.sec_code || "", m.member_code || "", m.id_card || "", m.dob || "", m.title_th || "", m.first_th || "", m.last_th || "",
            payDateBE(payDate), round2(i.emp_amt), round2(i.er_amt), sentBefore && sentBefore.has(i.emp_code) ? null : m.policy || null, null]; });
}

// ---------------------------------------------------------------- นำเข้าไฟล์ทะเบียนเดิม "PVD Master" (ชีต DataPVD / Record / รหัสสังกัด)
const xlDate = v => {
  if (v == null || v === "" || /#N\/A/.test(String(v))) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === "number") { const t = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; }
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) { const y = +m[3] > 2400 ? +m[3] - 543 : +m[3]; return `${y}-${pad(m[2])}-${pad(m[1])}`; }
  return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null;
};
const rate = v => { const n = num(v); return n > 1 ? round2(n / 100 * 10000) / 10000 : n; };
function headIdx(aoa, label) { return aoa.slice(0, 6).findIndex(r => (r || []).map(norm).includes(label)); }
export function parseMaster(sheets) {
  const out = { members: [], sections: [], history: [], skipped: [] };
  const sec = sheets["รหัสสังกัด"];
  if (sec) for (const r of sec.slice(1)) if (/^SEC\d+/i.test(norm(r[0]))) out.sections.push({ sec_code: norm(r[0]).toUpperCase(), name: norm(r[1]) });
  const data = sheets.DataPVD;
  if (!data) throw new Error("ไม่พบชีต DataPVD");
  const h = headIdx(data, "รหัสพนักงาน"); if (h < 0) throw new Error("ชีต DataPVD ไม่มีหัว “รหัสพนักงาน”");
  for (const r of data.slice(h + 1)) {
    const code = norm(r[3]).toUpperCase(); if (!/^AKR/.test(code)) continue;
    const left = xlDate(r[15]);
    let id = norm(r[4]).replace(/\D/g, ""); if (id && id.length < 13) id = id.padStart(13, "0");
    out.members.push({ emp_code: code, sec_code: norm(r[1]).toUpperCase(), member_code: norm(r[2]).toUpperCase(), id_card: id,
      dob: /^\d{7}$/.test(norm(r[5])) ? "0" + norm(r[5]) : norm(r[5]), title_th: norm(r[6]), first_th: norm(r[7]), last_th: norm(r[8]), member_date: xlDate(r[14]), left_date: left,
      emp_rate: rate(r[16]), er_rate_file: rate(r[17]), policy: norm(r[18]) || null, note: norm(r[21]) || null,
      status: left ? "left" : "active" });
  }
  // ประวัติยอดรายเดือน — ชีต Record (MCODE = เดือน) · ปีเอาจากวันที่บนหัวชีต
  const rec = sheets["Record"] || sheets["Record "];
  if (rec) {
    const rh = headIdx(rec, "รหัสพนักงาน"), d = (rec[0] || []).map(xlDate).find(Boolean), y = d ? d.slice(0, 4) : null;
    if (rh >= 0 && y) for (const r of rec.slice(rh + 1)) {
      const code = norm(r[3]).toUpperCase(), mc = num(r[19]); if (!/^AKR/.test(code) || !mc) continue;
      out.history.push({ ym: `${y}-${pad(mc)}`, emp_code: code, member_code: norm(r[2]).toUpperCase(), emp_amt: round2(num(r[20])), er_amt: round2(num(r[21])),
                         emp_rate: rate(r[16]), note: norm(r[22]) || null });
    }
  }
  return out;
}
// รหัสสังกัดของคนใหม่ — เดาจาก Section ในทะเบียนพนักงาน เทียบกับที่สมาชิกเดิมใช้มากที่สุด
export function guessSec(e, members, empsByCode) {
  const cnt = {};
  for (const m of members) { const s = norm(empsByCode.get(m.emp_code)?.section); if (s && m.sec_code) (cnt[s] ||= {})[m.sec_code] = ((cnt[s] || {})[m.sec_code] || 0) + 1; }
  const c = cnt[norm(e.section)]; return c ? Object.entries(c).sort((a, b) => b[1] - a[1])[0][0] : "";
}
