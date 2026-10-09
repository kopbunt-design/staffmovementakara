// เทสเบี้ยขยัน — ดึงฟังก์ชันจริงจาก js/diligence-calc.js · ข้อมูลสมมติล้วน
// รัน:  osascript -l JavaScript test/diligence.test.js
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;
const src = read(`${ROOT}/js/diligence-calc.js`).replace(/^export /gm, "");
const M = new Function(`${src}; return { rateFor, parseBy, classifyReason, editDays, leaveKinds, evaluate, parseProcessed, parseEdits, parseWebReasons, serialToISO, nextYM, prevYM };`)();
let P = 0, F = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) === JSON.stringify(b)) P++; else { F++; console.log("FAIL " + m + "\n  got =" + JSON.stringify(a) + "\n  want=" + JSON.stringify(b)); } };

// อัตรา (ข้อ 5)
eq([0, 1, 3, 4, 6, 7, 12].map(M.rateFor), [0, 300, 300, 600, 600, 1000, 1000], "อัตราตามเดือนต่อเนื่อง");
eq([M.nextYM("2026-12"), M.prevYM("2027-01")], ["2027-01", "2026-12"], "ข้ามปี");
eq(M.serialToISO(46266), "2026-09-01", "Excel serial → วันที่");
eq(M.serialToISO(46266.354), "2026-09-01", "serial มีเวลา → วันเดียวกัน");

// ผู้ทำ + วันที่ทำ: พ.ศ. (TigerSoft) และ เดือนย่อ ค.ศ. 2 หลัก (เว็บ)
eq(M.parseBy("hruser,6/10/2569 17:24:24"), { by: "hruser", at: "2026-10-06" }, "วันที่ พ.ศ.");
eq(M.parseBy("AKR00000001,21/Sep/26 07:38"), { by: "AKR00000001", at: "2026-09-21" }, "วันที่เดือนย่อ");

// กลุ่มเหตุผล (ผู้ใช้ยืนยัน 2026-10-09)
const C = (r, t) => M.classifyReason(r, t);
eq(C("รปภ.สแกนบัตรไม่ติด"), "company", "รปภ. สแกนให้ = ฝั่งบริษัท");
eq(C("ป้อมหน้าไฟดับสแกนบัตรไม่ได้"), "company", "ป้อม/ไฟดับ = ฝั่งบริษัท");
eq(C("ไฟฟ้าบริษัทดับ"), "company", "ไฟ…ดับ");
eq(C("ลืมบัตรและได้เซ็นในใบรายชื่อที่ตรงป้อมยามไว้แล้ว"), "count", "ลืมบัตรแม้เซ็นที่ป้อมยาม = นับ");
eq(C("บัตรหาย"), "count", "บัตรหาย = นับ");
eq(C("สแกนบัตรไม่ติด"), "check", "สแกนไม่ติดไม่บอกที่ป้อม = ให้ HR ยืนยัน");
eq(C("สแกนนิ้วไม่ผ่าน"), "check", "สแกนนิ้วไม่ผ่าน");
eq(C("WFH เนื่องจากน้ำท่วมบ้าน"), "offsite", "WFH = นอกสถานที่");
eq(C("Conference in Melbourne"), "offsite", "ประชุมต่างประเทศ = นอกสถานที่");
eq(C("ไปทำงานที่สำนักงานสำรวจจึงไม่ได้ลงเวลาออก"), "offsite", "ไปทำงานที่อื่น = นอกสถานที่");
eq(C("เริ่มงานวันแรก"), "hr", "เริ่มงานวันแรก = HR");
eq(C(""), "count", "ไม่ใส่เหตุผล = นับ");
eq(C("บันทึกเวลาทำงาน"), "count", "เหตุผลกว้าง ๆ = นับ");
eq(C("Level M", "เพิ่มเวลา"), "hr", "HR เพิ่มเวลา = HR");
eq(C("BKK", "เพิ่มเวลา"), "offsite", "HR เพิ่มเวลา BKK = นอกสถานที่");

// รวมเป็นรายวัน: วันละ 1 ครั้ง · กลุ่มที่หนักสุด · เหตุผลจากไฟล์ web · เฉพาะเดือนที่คิด
const ed = (emp, date, minute, type, reason, at = "2026-09-20") => ({ emp, date, minute, type, reason, by: "x", at });
const web = new Map([["AKR1|100", "ลืมบัตร"]]);
const days = M.editDays([
  ed("AKR1", "2026-09-02", 1, "ลงเวลา", "ไฟดับ"), ed("AKR1", "2026-09-02", 2, "ลงเวลา", "ไฟดับ"),       // เข้า+ออก วันเดียว
  ed("AKR1", "2026-09-03", 3, "ลงเวลา", "ไฟดับ"), ed("AKR1", "2026-09-03", 4, "ลงเวลา", "ลืมบัตร"),     // วันเดียวคนละเหตุผล
  ed("AKR1", "2026-09-04", 100, "ลงเวลา", "HR Approve(web)"),                                          // เอาเหตุผลจาก web
  ed("AKR1", "2026-08-31", 5, "ลงเวลา", "ลืมบัตร"),                                                    // คนละเดือน
], "2026-09", web);
eq(days.length, 3, "รวมเป็นรายวัน + ตัดเดือนอื่น");
eq(days.map(d => d.group), ["company", "count", "count"], "วันที่มีหลายเหตุผล ใช้กลุ่มที่หนักสุด");
eq(days[2].reasons, ["ลืมบัตร"], "HR Approve(web) → เหตุผลจริงจากไฟล์ web");

// ประเภทการลาจากหมายเหตุ
eq(M.leaveKinds("ลาพักร้อน   (ลงเวลาHR Approve(web))"), ["ลาพักร้อน"], "ลาพักร้อน");
eq(M.leaveKinds("วันหยุดปกติ ลาป่วยไม่จ่ายเงินหักเงิน"), ["ลาป่วยไม่จ่ายเงินหักเงิน"], "ลาป่วยในหมายเหตุยาว");
eq(M.leaveKinds("ขาดงาน"), [], "ไม่มีการลา");

// คิดรายคน
const emp = (o = {}) => ({ emp_code: "AKR1", job_level: "O2", contract_type: "Permanent", join_date: "2020-01-01", end_date: null, ...o });
const day = (date, o = {}) => ({ date, shift: "Nor", dayType: "N", late: "", early: "", leaveOk: false, leaveDed: false, deduct: "", note: "", ...o });
const T = (...ds) => ({ code: "AKR1", name: "ทดสอบ", days: ds.length ? ds : [day("2026-09-01")] });
const ev = o => M.evaluate({ ym: "2026-09", emp: emp(), t: T(), ...o });
eq([ev({}).qualified, ev({}).streak, ev({}).amount], [true, 1, 300], "มาครบเดือนแรก = 300");
eq(ev({ emp: emp({ job_level: "M1" }) }).inScope, false, "ระดับ M ไม่อยู่ในขอบเขต");
eq(ev({ emp: emp({ job_level: "S2" }) }).inScope, true, "ระดับ S อยู่ในขอบเขต");
eq(ev({ emp: emp({ contract_type: "Contract" }) }).inScope, false, "สัญญาจ้างไม่อยู่ในขอบเขต");
eq(ev({ emp: emp({ end_date: "2026-09-20" }) }).inScope, false, "ออกกลางเดือน = ไม่อยู่ในขอบเขต");
eq(ev({ emp: emp({ end_date: "2026-10-01" }) }).inScope, true, "ออก 1 ต.ค. = ทำครบ ก.ย.");
eq(ev({ emp: emp({ join_date: "2026-09-02" }) }).inScope, false, "เข้ากลางเดือน");
// 5.5: เริ่มงาน 1 พ.ค. 2026 + 119 วัน = 28 ส.ค. → เริ่มนับ 1 ก.ย.
eq(ev({ emp: emp({ join_date: "2026-05-01" }) }).inScope, true, "พ้นทดลองงาน ส.ค. → นับ ก.ย.");
eq(ev({ emp: emp({ join_date: "2026-06-01" }) }).inScope, false, "พ้นทดลองงาน ก.ย. → เริ่มนับ ต.ค.");
eq(ev({ t: T(day("2026-09-01", { late: "0:01" })) }).qualified, false, "สาย 1 นาที = หมดสิทธิ์");
eq(ev({ t: T(day("2026-09-01", { early: "0:05" })) }).qualified, false, "ออกก่อน = หมดสิทธิ์");
eq(ev({ t: T(day("2026-09-01", { deduct: "1-00:00", note: "ขาดงาน" })) }).qualified, false, "ขาดงาน");
eq(ev({ t: T(day("2026-09-01", { leaveOk: true, note: "ลาพักร้อน" })) }).qualified, true, "ลาพักร้อนยังได้ (4.2)");
eq(ev({ t: T(day("2026-09-01", { leaveOk: true, note: "ลาหยุดชดเชย" })) }).qualified, true, "ลาหยุดชดเชยยังได้ (4.3)");
eq(ev({ t: T(day("2026-09-01", { leaveOk: true, note: "ลาป่วย ไม่สบาย" })) }).qualified, false, "ลาป่วย = หมดสิทธิ์");
eq(ev({ t: T(day("2026-09-01", { leaveOk: true, note: "ลากิจ" })) }).qualified, false, "ลากิจ = หมดสิทธิ์");
eq(ev({ t: { code: "AKR1", days: [] } }).qualified, false, "ไม่มีข้อมูลเวลา");
const d3 = g => ["2026-09-02", "2026-09-03", "2026-09-04"].map(date => ({ date, group: g, lastAt: "2026-09-20", reasons: [], types: [] }));
eq(ev({ eds: d3("count").slice(0, 2) }).qualified, true, "แก้เวลา 2 วัน ยังได้");
eq(ev({ eds: d3("count") }).qualified, false, "แก้เวลา 3 วัน หมดสิทธิ์ (4.7)");
eq(ev({ eds: d3("company") }).qualified, true, "ปัญหาฝั่งบริษัทไม่นับ");
eq(ev({ eds: d3("check") }).qualified, true, "สแกนไม่ติด (รอยืนยัน) ไม่นับ");
eq(ev({ eds: d3("check") }).flags.length, 1, "สแกนไม่ติดขึ้นให้ตรวจ");
eq(ev({ eds: [{ date: "2026-09-02", group: "offsite", lastAt: "2026-10-07" }] }).qualified, true, "นอกสถานที่ลงทันวันที่ 7");
eq(ev({ eds: [{ date: "2026-09-02", group: "offsite", lastAt: "2026-10-08" }] }).qualified, false, "นอกสถานที่ลงหลังวันที่ 7 (4.8)");
eq(ev({ manual: { action: "deny", note: "พักงาน" } }).qualified, false, "HR ตัดสิทธิ์");
eq(ev({ t: T(day("2026-09-01", { late: "0:03" })), manual: { action: "grant", note: "ยกเว้น" } }).qualified, true, "HR ให้สิทธิ์");

// เดือนต่อเนื่อง
const evO = (ym, prev, o = {}) => M.evaluate({ ym, emp: emp(), t: { code: "AKR1", days: [day(`${ym}-01`)] }, prev, ...o });
eq(evO("2026-09", { qualified: true, streak: 5 }).streak, 1, "เดือนแรกของระเบียบ เริ่ม 1 เสมอ");
eq(evO("2026-10", { qualified: true, streak: 1 }).streak, 2, "ต่อเนื่อง +1");
eq([evO("2027-01", { qualified: true, streak: 3 }).streak, evO("2027-01", { qualified: true, streak: 3 }).amount], [4, 600], "เดือนที่ 4 = 600");
eq(evO("2027-04", { qualified: true, streak: 6 }).amount, 1000, "เดือนที่ 7 = 1,000");
eq(evO("2026-10", { qualified: false, streak: 0 }).streak, 1, "เดือนก่อนไม่ได้ เริ่ม 1 ใหม่ (5.4)");
eq(evO("2026-10", null).streak, 1, "ไม่มีผลเดือนก่อน เริ่ม 1");
eq(evO("2026-10", { qualified: true, streak: 3 }, { emp: emp({ join_date: "2026-06-01" }) }).streak, 1, "เดือนแรกหลังพ้นทดลองงาน เริ่ม 1");

// อ่านไฟล์แบบ TigerSoft (แถวตามโครงไฟล์จริง ค่าเป็นของสมมติ)
const hdr = [null, null, null, null, null, null, "เข้า", null, "ออก", null, null, "สาย", "ออกก่อน", "ลาไม่หัก", "ลาหัก", "หักวัน", "นับวัน"];
hdr[33] = "จำนวนพนักงาน";
const row = (c) => { const r = new Array(34).fill(null); for (const k in c) r[k] = c[k]; return r; };
const proc = M.parseProcessed([["บริษัท"], [], [], [], hdr, row({ 0: "ส่วน X" }), row({ 1: "AKR00000009 นายทดสอบ  ระบบ" }),
  row({ 1: 46266, 3: "Nor", 5: "N", 6: 46266.33, 8: 46266.7, 11: "0:02", 16: "1-00:00" }),
  row({ 1: 46267, 3: "Nor", 5: "N", 13: "1-00:00", 32: "ลาพักร้อน" })]);
const pe = proc.get("AKR00000009");
eq([pe.days.length, pe.days[0].late, pe.days[1].leaveOk, pe.days[1].note], [2, "0:02", true, "ลาพักร้อน"], "อ่านรายงานหลังประมวล");
const edits = M.parseEdits([["บริษัท"], ["AKR00000009 นายทดสอบ  ระบบ"], [null, 46266, null, null, "08:00"],
  [null, null, 46266.33, null, "ลงเวลา", null, null, "รปภ.สแกนไม่ติด", null, null, null, "AKR00000001,2/9/2569 10:00:00"]]);
eq([edits.length, edits[0].emp, edits[0].reason, edits[0].at], [1, "AKR00000009", "รปภ.สแกนไม่ติด", "2026-09-02"], "อ่านไฟล์เพิ่มเวลา");
const wr = M.parseWebReasons([[null, null, null, "AKR00000009 นายทดสอบ"], [null, null, null, null, null, 46266.33, null, null, 46266.33, null, "ลืมบัตร", null, null, null, null, null, "AKR00000001,2/Sep/26 10:00"]]);
eq(wr.get(`AKR00000009|${Math.round(46266.33 * 1440)}`), "ลืมบัตร", "อ่านเหตุผลจากไฟล์ web");

console.log(F === 0 ? `ผ่านทั้งหมด ${P} เคส` : `ผ่าน ${P} · ตก ${F}`);
