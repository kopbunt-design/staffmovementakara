// เทสหน้าตาหนังสือ HR — ดึงฟังก์ชันจริงจาก js/hr-letters.js
// รัน:  osascript -l JavaScript test/hr-letters.test.js
// ⚠️ ข้อมูลสมมติล้วน
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;
const strip = s => s.split("\n").filter(l => !/^\s*import\s/.test(l)).join("\n").replace(/^export /gm, "");
// เอาแค่ bahtText จาก contract-docs.js (ไฟล์นั้นมีตัวแปรชื่อซ้ำกับไฟล์หนังสือ)
const cd = strip(read(`${ROOT}/js/contract-docs.js`));
const baht = cd.slice(cd.indexOf("function bahtText"), cd.indexOf("\n}\n", cd.indexOf("function bahtText")) + 3);
// JXA ไม่มี btoa/atob — ใช้ของ Foundation แทน (เทียบเท่าในเบราว์เซอร์)
const btoa = s => $.NSString.alloc.initWithString(s).dataUsingEncoding($.NSISOLatin1StringEncoding).base64EncodedStringWithOptions(0).js;
const atob = s => $.NSString.alloc.initWithDataEncoding($.NSData.alloc.initWithBase64EncodedStringOptions(s, 0), $.NSISOLatin1StringEncoding).js;
const M = new Function("btoa", `${baht}\nconst escText = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const can = () => true, toast = () => {}, notify = () => {}, allEmployees = [], currentUser = {}, supabase = {};
  ${strip(read(`${ROOT}/js/hr-letters.js`)).replace(/const esc = v => escText/, "const esc = v => escText")}
  return { letterPages, thDate, enDate, usDate, draftFrom, KINDS, renderMail, emlText, mailList };`)(btoa);

let P = 0, F = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) === JSON.stringify(b)) P++; else { F++; console.log("FAIL " + m + "\n  got =" + JSON.stringify(a) + "\n  want=" + JSON.stringify(b)); } };
const has = (h, s, m) => eq(h.includes(s), true, m);
const not = (h, s, m) => eq(h.includes(s), false, m);

// ---------- วันที่ตามแบบหนังสือจริง ----------
eq(M.thDate("2026-09-30"), "30 กันยายน 2569", "ไทย: เดือนไทย + ปี พ.ศ.");
eq(M.enDate("2026-09-30"), "30 September 2026", "อังกฤษ: ปี ค.ศ.");
eq(M.enDate("2026-09-29"), "29 September 2026", "อังกฤษ (หนังสือรับรอง)");
eq(M.usDate("2026-09-08"), "September 8, 2026", "อังกฤษ (Offer Letter)");

const inc = [{ key: "salary", label_th: "อัตราเงินเดือน", label_en: "Current Monthly Base Salary", on: true, amount: 14150 },
             { key: "transport", label_th: "เงินทดแทนการจัดรถรับส่ง", label_en: "Transportation Allowance", on: false, amount: 2000 }];
const th = M.letterPages("cert_th", { issue_date: "2026-09-30", name_th: "นายทดสอบ สมมติ", id_card: "1100000000001", position_th: "เจ้าหน้าที่",
  division_th: "ฝ่ายทดสอบ", department_th: "แผนกทดสอบ", period_from: "2026-01-05", period_to: "", incomes: inc }, { docNo: "HR-200-2026", draft: false,
  signer: { name_th: "นายผู้จัดการ ทดสอบ", title_th: "ผู้จัดการฝ่ายทรัพยากรบุคคล" }, art: { signature: "data:image/png;base64,AA", seal: "data:image/png;base64,BB" } });
has(th, "HR-200-2026", "มีเลขที่");
has(th, "14,150 (หนึ่งหมื่นสี่พันหนึ่งร้อยห้าสิบบาทถ้วน)", "เงินเดือนพร้อมตัวหนังสือไทย");
not(th, "เงินทดแทนการจัดรถรับส่ง", "รายการที่ไม่ติ๊กไม่แสดง");
has(th, "5 มกราคม 2569 ถึงปัจจุบัน", "ระยะเวลาการทำงาน · ยังทำงานอยู่ = ปัจจุบัน");
has(th, "data:image/png;base64,AA", "อนุมัติแล้วมีลายเซ็น");
not(th, "lt-wm", "อนุมัติแล้วไม่มีลายน้ำร่าง");

const draft = M.letterPages("cert_th", { issue_date: "2026-09-30", name_th: "นายทดสอบ", incomes: [] }, { draft: true });
has(draft, "ร่าง · รออนุมัติ", "ยังไม่อนุมัติ → มีลายน้ำ");
not(draft, "lt-sig\"", "ยังไม่อนุมัติ → ไม่มีลายเซ็น");
not(draft, "อัตราเงินเดือน", "หนังสือรับรองการทำงานไม่ติ๊กเงินได้ → ไม่มีบรรทัดเงิน");

const en = M.letterPages("cert_en", { issue_date: "2026-09-29", name_en: "Miss Test Sample", id_card: "3100000000002", position: "Manager",
  division: "Commercial", department: "Finance", section: "Finance", period_from: "2025-03-17", period_to: "2026-12-31",
  incomes: [{ ...inc[0], amount: 227075 }, { ...inc[1], on: true, amount: 2000 }] }, { docNo: "HR-201-2026" });
has(en, "THB 227,075 per month", "เงินเดือนภาษาอังกฤษ");
has(en, "Transportation Allowance", "ติ๊กรายการที่สอง → แสดง");
has(en, "17 March 2025 - 31 December 2026", "มีวันสิ้นสุด → แสดงวันสิ้นสุดแทน Present");
has(en, "Ref. No. HR-201-2026", "Ref. No.");

const of = M.letterPages("offer_en", { issue_date: "2026-09-08", title_en: "Mr.", name_en: "Test Candidate", position: "Officer", salary: 39900,
  commencement: "2026-09-14", probation_days: 119, schedule: [["Annual Leave", "13 days"], ["", ""]], contact_email: "hr@example.com" }, { docNo: "HR-097-2026" });
eq((of.match(/class="lt-page/g) || []).length, 2, "Offer Letter 2 หน้า");
has(of, "September 8, 2026", "วันที่แบบ Offer");
has(of, "Dear Mr. Test Candidate,", "คำขึ้นต้น");
has(of, "THB 39,900 per month", "เงินเดือนใน Schedule");
has(of, "14 September 2026, or as otherwise agreed between the parties", "วันเริ่มงาน");
eq((of.match(/<tr>/g) || []).length, 5, "Schedule: 4 แถวหลัก + 1 แถวที่เพิ่ม · แถวว่างไม่แสดง");
has(of, "hr@example.com", "อีเมลตอบรับ");

// ข้อความที่ผู้ใช้พิมพ์ต้องถูก escape (กันโค้ดแปลกปลอมในหนังสือ)
has(M.letterPages("cert_en", { name_en: "<script>x</script>", incomes: [] }, {}), "&lt;script&gt;", "escape ข้อความ");

// ---------- ข้อมูลตั้งต้นจากทะเบียน ----------
const items = [{ key: "salary", label_th: "อัตราเงินเดือน", label_en: "Salary", is_active: true }, { key: "x", label_th: "อื่น", label_en: "X", is_active: false }];
const d = M.draftFrom("salary_th", { firstname_th: "หนึ่ง", lastname_th: "ทดสอบ", gender: "Male", position: "Officer", join_date: "2024-01-01", salary: 30000 }, items);
eq([d.name_th, d.period_from, d.incomes.length, d.incomes[0].on, d.incomes[0].amount], ["นายหนึ่ง ทดสอบ", "2024-01-01", 1, true, 30000],
   "หนังสือรับรองเงินเดือน ติ๊กเงินเดือนให้ · รายการที่ปิดใช้ไม่โผล่");
eq(M.draftFrom("cert_th", null, items).incomes[0].on, false, "หนังสือรับรองการทำงาน ไม่ติ๊กเงินเดือนตั้งต้น");

// ---------- อีเมล ----------
eq(M.renderMail("[ขออนุมัติ] {{doc_no}} — {{ person }}", { doc_no: "HR-115-2026", person: "ก & ข" }, false), "[ขออนุมัติ] HR-115-2026 — ก & ข", "หัวเรื่อง: แทนค่า ไม่ escape");
eq(M.renderMail("<b>{{person}}</b>{{missing}}", { person: "<img onerror=x>" }, true), "<b>&lt;img onerror=x&gt;</b>", "เนื้อหา HTML: ค่าจากข้อมูลถูก escape · ตัวแปรที่ไม่มีเป็นว่าง");
{
  const e = M.emlText("mgr@x.com", "ขออนุมัติ HR-1", "<p>สวัสดี</p>");
  has(e, "X-Unsent: 1", "Outlook เปิดเป็นเมลใหม่ที่ยังไม่ส่ง");
  has(e, "To: mgr@x.com", "ผู้รับ");
  has(e, "Content-Type: text/html; charset=UTF-8", "เป็น HTML");
  has(e, "Subject: =?UTF-8?B?", "หัวเรื่องภาษาไทยเข้ารหัสถูกแบบ");
  const body = e.split("\r\n\r\n")[1].replace(/\r\n/g, "");
  eq(decodeURIComponent(escape(atob(body))).includes("<p>สวัสดี</p>"), true, "เนื้อหาถอดกลับได้ครบ");
}

eq(M.mailList("A@x.com; b@y.co , a@x.com", "not-an-email", "\nc@z.org"), "a@x.com, b@y.co, c@z.org", "รวมอีเมล: คั่นได้หลายแบบ ตัดซ้ำ ตัดค่าที่ไม่ใช่อีเมล");
has(M.emlText("a@x.com", "s", "<p>x</p>", "b@y.co"), "Cc: b@y.co", "ไฟล์เมลมี CC");

console.log(F === 0 ? `ผ่านทั้งหมด ${P} เคส` : `ผ่าน ${P} · ตก ${F}`);
