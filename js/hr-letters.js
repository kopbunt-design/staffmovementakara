import { supabase } from "./supabase-config.js";
import { allEmployees, can, esc as escText, toast, currentUser, notify } from "./app.js";
import { bahtText } from "./contract-docs.js";
import { comboHTML, bindCombo } from "./combobox.js";

// ============================================================================
// ออกหนังสือ HR (หมวด "งานเอกสาร HR")
//   หนังสือรับรองการทำงาน / เงินเดือน (ไทย · อังกฤษ) และ Offer Letter — หน้าตาตามแบบที่ HR ใช้จริง
//   ร่าง → ส่งขออนุมัติ (ได้เลขที่จากทะเบียน) → HR Manager อนุมัติ → ลายเซ็น+ตราลงหนังสือ → พิมพ์/PDF
//   กติกาสถานะ/ลายเซ็นบังคับที่ DB (sql/schema_hr_letters.sql) ไม่ใช่แค่ซ่อนปุ่ม
//   เมลแจ้ง: Edge Function letter-notify (Microsoft 365) — ยังไม่ตั้งค่าก็ใช้ได้ แจ้งในระบบแทน
// ============================================================================

const esc = v => escText(v == null ? "" : String(v));
const canWrite = () => can("data.letters.write");
const canApprove = () => can("data.letters.approve");

export const KINDS = {
  cert_th:   { label: "หนังสือรับรองการทำงาน (ภาษาไทย)",     lang: "th", title: "หนังสือรับรองการทำงาน", docType: "หนังสือรับรองการทำงาน (ภาษาไทย)", income: [] },
  salary_th: { label: "หนังสือรับรองเงินเดือน (ภาษาไทย)",   lang: "th", title: "หนังสือรับรองเงินเดือน", docType: "หนังสือรับรองเงินเดือน (ภาษาไทย)", income: ["salary"] },
  cert_en:   { label: "Certificate of Employment (อังกฤษ)", lang: "en", title: "CERTIFICATE OF EMPLOYMENT", docType: "หนังสือรับรองการทำงาน (ภาษาอังกฤษ)", income: [] },
  salary_en: { label: "Salary Certificate (อังกฤษ)",        lang: "en", title: "SALARY CERTIFICATE", docType: "หนังสือรับรองเงินเดือน (ภาษาอังกฤษ)", income: ["salary"] },
  offer_en:  { label: "Offer Letter (จดหมายจ้างงาน)",        lang: "en", title: "Offer of Employment", docType: "Offer Letter (จดหมายจ้างงาน)" },
};
const STATUS = {
  draft:     ["ร่าง", "var(--muted)", "#f1f5f9"],
  pending:   ["รออนุมัติ", "var(--amber)", "var(--amber-light)"],
  approved:  ["อนุมัติแล้ว", "var(--green)", "var(--green-light)"],
  rejected:  ["ส่งกลับแก้ไข", "var(--red)", "var(--red-light)"],
  cancelled: ["ยกเลิก", "var(--muted)", "#f1f5f9"],
};
const badge = s => { const [t, c, b] = STATUS[s] || [s]; return `<span class="badge" style="color:${c};background:${b};">${t}</span>`; };

// ---------------------------------------------------------------- วันที่ / ตัวเลข (ตามแบบหนังสือจริง)
const TH_M = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const EN_M = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const dt = iso => { const d = new Date(String(iso) + "T00:00:00"); return isNaN(d) ? null : d; };
// แบบหนังสือไทยของบริษัทใช้เดือนไทย + ปี ค.ศ. เช่น "30 กันยายน 2026"
export const thDate = iso => { const d = dt(iso); return d ? `${d.getDate()} ${TH_M[d.getMonth()]} ${d.getFullYear()}` : ""; };
export const enDate = iso => { const d = dt(iso); return d ? `${d.getDate()} ${EN_M[d.getMonth()]} ${d.getFullYear()}` : ""; };
export const usDate = iso => { const d = dt(iso); return d ? `${EN_M[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : ""; };
const money = n => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const todayISO = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };

// ตาราง Schedule 1 ของ Offer Letter — ค่าตั้งต้นตามแบบที่ HR ใช้ (แก้/เพิ่ม/ลบได้ทีละฉบับ)
export const OFFER_SCHEDULE = [
  ["Public Holidays", "15 days per year, or as announced by the Company each calendar year in accordance with applicable laws"],
  ["Annual Leave", "13 days per year (1–3 years of service) / 15 days per year (more than 3 years of service)"],
  ["Travel and Meal Allowance", "Provided when working offsite, in accordance with the Company's policies"],
  ["Medical Benefits", "Provided based on the medical benefit plan selected by the employee after successful completion of the probation period, in accordance with the Company's medical benefit policy"],
  ["Employee Group Insurance", "Death coverage of THB 300,000 and accidental death coverage of THB 500,000, subject to the Company's Group Insurance Policy and Welfare & Benefits Regulations"],
  ["Annual Medical Check-up", "Provided once per year in accordance with the Company's policy"],
  ["Notebook Computer", "Provided for business purposes in accordance with the Company's policy"],
  ["Provident Fund", "Eligibility after successful completion of the probation period, with employee contribution options ranging from 2% to 15% in accordance with the Company's Provident Fund Regulations"],
  ["Site Uniform", "Provided in accordance with the Company's policy"],
  ["Other Benefits", "Provided in accordance with the Company's Welfare and Benefits Regulations"],
];

// ---------------------------------------------------------------- หน้าตาหนังสือ (pure — มีเทส)
// จัดตามไฟล์จริงของ HR (HR-113-2026 / HR-110-2026 / Offer HR-097-2026) ด้วยพิกัดที่วัดจาก PDF ต้นฉบับ (หน่วย มม.)
//   หนังสือรับรอง = กระดาษ US Letter 215.9×279.4 · Offer Letter = A4 210×297
//   หัว/ท้ายกระดาษเป็นรูปที่ตัดจากต้นฉบับ (assets/letter/) — โลโก้ เส้น ที่อยู่ จึงเหมือนเดิมทุกจุด
//   ฟอนต์ตามต้นฉบับ: ไทย TH Sarabun New 15pt · อังกฤษ Arial (9.3pt หนังสือรับรอง / 11pt Offer)
//   แต่ละบรรทัดตั้ง line-height = ความสูงตัวอักษรจริง ตำแหน่งบนสุดจึงเท่ากับพิกัดในต้นฉบับพอดี
export const LETTER_IMG = { headLetter: "assets/letter/head-letter.png", footLetter: "assets/letter/foot-letter.png",
                            headA4: "assets/letter/head-a4.png", footA4: "assets/letter/foot-a4.png" };
const pageOf = kind => kind === "offer_en" ? "a4" : "letter";

const incomeTH = l => `${money(l.amount)} (${bahtText(l.amount)})`;
const incomeEN = l => `THB ${money(l.amount)} per month`;
const img = (src, cls) => src ? `<img class="${cls}" src="${src}" alt="">` : "";

export function letterPages(kind, d, opts = {}) {
  const { docNo = "", signer = null, art = null, draft = true } = opts;
  const I = { ...LETTER_IMG, ...(opts.img || {}) };
  const K = KINDS[kind]; if (!K) return "";
  const wm = draft ? `<div class="lt-wm">${K.lang === "th" ? "ร่าง · รออนุมัติ" : "DRAFT"}</div>` : "";
  const no = docNo || "HR-___-____";
  const inc = (d.incomes || []).filter(x => x && x.on !== false && Number(x.amount) > 0);
  const sig = art?.signature, seal = art?.seal;
  const frame = (size, body) => `<section class="lt-page ${size} ${K.lang}">${wm}
    <img class="lt-head" src="${size === "a4" ? I.headA4 : I.headLetter}" alt="">${body}
    <img class="lt-foot" src="${size === "a4" ? I.footA4 : I.footLetter}" alt=""></section>`;

  if (kind === "cert_th" || kind === "salary_th") {
    const rows = [["ชื่อ - นามสกุล", d.name_th], ["เลขบัตรประชาชน", d.id_card], ["ตำแหน่ง", d.position_th], ["ฝ่าย", d.division_th],
      ["แผนก", d.department_th], ["ระยะเวลาการปฏิบัติงาน", `${thDate(d.period_from)} ถึง${d.period_to ? ` ${thDate(d.period_to)}` : "ปัจจุบัน"}`],
      ...inc.map(l => [l.label_th, incomeTH(l)])].filter(([, v]) => String(v ?? "").trim());
    return frame("letter", `
      <div class="lt-a th-no">${esc(no)}</div>
      <div class="lt-a th-title">${esc(K.title)}</div>
      <div class="lt-a th-intro">หนังสือรับรองฉบับนี้โดย บริษัท อัครา รีซอร์สเซส จำกัด (มหาชน) ออกให้เพื่อเป็นการรับรองรายละเอียดต่อไปนี้</div>
      <div class="lt-a th-flow">
        ${rows.map(([k, v]) => `<div class="th-row"><b>${esc(k)}:</b><span>${esc(v)}</span></div>`).join("")}
        <div class="th-close">จึงออกหนังสือรับรองฉบับนี้ไว้เพื่อเป็นหลักฐาน</div>
        <div class="th-sign"><div class="th-date">ออกให้ ณ วันที่ ${esc(thDate(d.issue_date))}</div>
          <div class="th-name">${img(sig, "th-sig")}${img(seal, "th-seal")}${esc(signer?.name_th || "นายศุภโชค  พันธุมิตร")}</div>
          <div class="th-title2">${esc(signer?.title_th || "ผู้จัดการฝ่ายทรัพยากรบุคคล")}</div></div>
      </div>
      <div class="lt-a th-remark"><b>หมายเหตุ:</b> เอกสารฉบับนี้จัดทำและออกในรูปแบบอิเล็กทรอนิกส์ จึงไม่จำเป็นต้องมีลายมือชื่อผู้มีอำนาจลงนามกำกับ</div>`);
  }
  if (kind === "cert_en" || kind === "salary_en") {
    const rows = [["Position", d.position], ["Division", d.division], ["Department", d.department], ["Section", d.section],
      ["Period of Employment", `${enDate(d.period_from)} - ${d.period_to ? enDate(d.period_to) : "Present"}`],
      ...inc.map(l => [l.label_en, incomeEN(l)])].filter(([, v]) => String(v ?? "").trim());
    return frame("letter", `
      <div class="lt-a en-ref">Ref. No. ${esc(no)}<br>Date&nbsp;&nbsp; ${esc(enDate(d.issue_date))}</div>
      <div class="lt-a en-title">${esc(K.title)}</div>
      <div class="lt-a en-twimc">TO WHOM IT MAY CONCERN</div>
      <div class="lt-a en-flow">
        <p class="en-p">This is to certify that <b>${esc(d.name_en)}</b>${d.id_card ? `(National ID No.: ${esc(d.id_card)})` : ""} is employed by <b>Akara Resources Public Company Limited</b>, a subsidiary of <b>Kingsgate Consolidated Limited, Australia</b>.</p>
        <p class="en-p en-p2">The employment details are as follows:</p>
        <div class="en-rows">${rows.map(([k, v]) => `<div class="en-row"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join("")}</div>
        <p class="en-p en-issued">This certificate has been issued at the employee's request for official purposes.</p>
        <p class="en-p en-yours">Yours sincerely,</p>
        <div class="en-name">${img(sig, "en-sig")}${img(seal, "en-seal")}${esc(signer?.name_en || "Mr. Suphachoke Phanthumitr")}</div>
        <div class="en-name2">${esc(signer?.title_en || "Human Resources Manager")}</div>
      </div>
      <div class="lt-a en-remark"><b>Remark</b> - This document is digitally issued and does not require a handwritten signature.</div>`);
  }
  // Offer Letter — A4 2 หน้า (จดหมาย + Schedule 1)
  const sched = [["Position Title", d.position], ["Monthly Base Salary", d.salary ? `THB ${money(d.salary)} per month` : ""],
    ["Commencement Date", d.commencement ? `${enDate(d.commencement)}, or as otherwise agreed between the parties` : ""],
    ["Probation Period", d.probation_days ? `${d.probation_days} days` : ""], ...(d.schedule || [])]
    .filter(([k, v]) => String(k || "").trim() && String(v ?? "").trim());
  const nm = `${d.title_en ? d.title_en + " " : ""}${d.name_en || ""}`.trim();
  return frame("a4", `
      <div class="lt-a of-top"><span>${esc(no)}</span><span>${esc(usDate(d.issue_date))}</span></div>
      <div class="lt-a of-title">Offer of Employment</div>
      <div class="lt-a of-flow">
        <p class="of-p">Dear ${esc(nm)},</p>
        <p class="of-p g1">Akara Resources Public Company Limited is pleased to offer you the position of <b>${esc(d.position)}.</b></p>
        <p class="of-p j g2">Your salary, benefits, and leave entitlements are outlined in Schedule 1 and are subject to applicable laws and the Company's policies and regulations, as amended from time to time.</p>
        <p class="of-p j g3">Please note that this offer is conditional upon the satisfactory completion of pre-employment requirements, including a medical examination and background verification. Should the results of the medical examination or background verification be deemed unsatisfactory, the Company reserves the right to withdraw this offer of employment.</p>
        <p class="of-p j g3">We are confident that you will find this opportunity both challenging and rewarding, and we are delighted to welcome you to Akara Resources Public Company Limited.</p>
        <p class="of-p j g2">To indicate your acceptance of this offer, please sign below and return a scanned copy to Akara's HR team at <span class="of-mail">${esc(d.contact_email || "")}</span>.</p>
        <p class="of-p g4">We look forward to working with you and achieving success together.</p>
        <p class="of-p g4">Yours sincerely,</p>
        <p class="of-p of-name">${img(sig, "of-sig")}${img(seal, "of-seal")}(${esc(signer?.name_en || "Mr. Suphachoke Phanthumitr")})</p>
        <p class="of-p g5">On behalf of Akara Resources Public Company Limited.</p>
        <p class="of-p of-stars">*********************</p>
        <p class="of-p g6">I acknowledge and accept the terms and conditions of this Offer of Employment.</p>
        <p class="of-p of-signed">Signed: ____________________________</p>
        <p class="of-p g7">${esc(nm)}</p>
        <p class="of-p g8">Date: __________________________</p>
      </div>`)
  + frame("a4", `
      <div class="lt-a of-sched-h">Schedule 1: Salary, Benefits and Leave Entitlements</div>
      <div class="lt-a of-sched-wrap"><table class="of-sched">${sched.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
        <p class="of-after">All benefits and leave entitlements are subject to the Company's Work Rules and Regulations and Welfare and Benefits Regulations, as amended from time to time.</p></div>
      ${img(sig, "of-initial")}`);
}

const CDN_TH = "https://cdn.jsdelivr.net/npm/font-th-sarabun-new@1.0.0/fonts";
export const LETTER_CSS = `
@font-face{font-family:"THSarabunNewWeb";src:url(${CDN_TH}/THSarabunNew-webfont.woff) format("woff");font-weight:400}
@font-face{font-family:"THSarabunNewWeb";src:url(${CDN_TH}/THSarabunNew_bold-webfont.woff) format("woff");font-weight:700}
*{box-sizing:border-box;margin:0;padding:0}
body{background:#e9edf3}
.lt-page{position:relative;overflow:hidden;background:#fff;margin:0 auto 8mm;color:#000;page-break-after:always}
.lt-page:last-child{page-break-after:auto}
.lt-page.letter{width:215.9mm;height:279.4mm}.lt-page.a4{width:210mm;height:297mm}
.lt-head{position:absolute;left:0;top:0;width:100%}
.lt-page.letter .lt-foot{position:absolute;left:0;top:255mm;width:100%}
.lt-page.a4 .lt-foot{position:absolute;left:0;top:271mm;width:100%}
.lt-a{position:absolute;z-index:2}
/* ไฟล์ฟอนต์บนเว็บสเกลใหญ่กว่าฟอนต์ที่ติดเครื่อง 1.52 เท่า (วัดจากความกว้างทุกบรรทัดเทียบต้นฉบับ) — 9.85pt ที่นี่ = 15pt ใน Word */
.lt-page.th{font-family:"THSarabunNewWeb",sans-serif;font-size:9.85pt;line-height:6.9mm}
.lt-page.en{font-family:Arial,Helvetica,sans-serif}
/* ---- หนังสือรับรอง ภาษาไทย (Letter) ---- */
.th-no{left:27.9mm;top:28.4mm}
.th-title{left:0;right:0;top:37.6mm;text-align:center;font-size:12.35pt;font-weight:700;line-height:8.6mm}
.th-intro{left:36.5mm;top:54.1mm;white-space:nowrap}
.th-flow{left:0;right:0;top:67.07mm}
.th-row{display:flex;line-height:8.97mm;padding-left:52.9mm}.th-row b{width:44.6mm;flex:none}
.th-close{margin:6.44mm 0 0 39.9mm}
.th-sign{position:relative;margin-left:83.8mm;width:80mm;text-align:center}
.th-date{margin-top:17.2mm}
.th-name{position:relative;left:-2.3mm;margin-top:23.85mm;line-height:8mm;white-space:pre}
.th-title2{position:relative;left:-2.6mm;line-height:8mm}
.th-sig{position:absolute;left:24.3mm;top:-12.4mm;height:12.5mm}
.th-seal{position:absolute;left:62.2mm;top:-24.1mm;height:35.5mm}
.th-remark{left:27.9mm;top:229.4mm;white-space:nowrap}
/* ---- หนังสือรับรอง ภาษาอังกฤษ (Letter) ---- */
.lt-page.letter.en{font-size:9.3pt;line-height:3.7mm}
.en-ref{left:27.9mm;top:28.4mm;line-height:5.3mm;margin-top:-0.8mm}
.en-title{left:27.9mm;top:46.5mm;font-size:15pt;font-weight:700;line-height:5.9mm;color:#3c3c3c}
.en-twimc{left:27.9mm;top:57.7mm;font-size:11.3pt;font-weight:700;line-height:4.4mm}
.en-flow{left:27.9mm;width:158mm;top:67.2mm}
.en-p{line-height:5.7mm}
.en-p2{margin-top:4.3mm}
.en-rows{margin-top:5.1mm;padding-left:.3mm}
.en-row{display:flex;line-height:6.7mm}.en-row b{width:56.3mm;flex:none}
.en-issued{margin-top:5.5mm}
.en-yours{margin-top:7.3mm}
.en-name{position:relative;margin-top:15.05mm;line-height:5mm}
.en-name2{line-height:5mm}
.en-sig{position:absolute;left:.8mm;top:-13.2mm;height:12mm}
.en-seal{position:absolute;left:48.2mm;top:-25.7mm;height:35mm}
.en-remark{left:27.9mm;top:241.8mm;white-space:nowrap}
/* ---- Offer Letter (A4) ---- */
.lt-page.a4.en{font-size:11pt;line-height:4.3mm}
.of-top{left:20mm;right:17.4mm;top:30.1mm;display:flex;justify-content:space-between}
.of-title{left:20mm;right:17.4mm;top:44.7mm;text-align:center;font-size:14pt;font-weight:700;line-height:5.5mm}
/* Word จัดคำในบรรทัดแน่นกว่า Chrome เล็กน้อย — กว้างกว่าขอบจริง 1.4 มม. บรรทัดจึงตัดคำตรงกับต้นฉบับ */
.of-flow{left:20mm;right:16mm;top:61.4mm}
.of-p{line-height:5.1mm}.of-p.j{text-align:justify}
.of-p.g1{margin-top:5.1mm;letter-spacing:-.13px}.of-p.g2{margin-top:2.4mm}.of-p.g3{margin-top:2.9mm}.of-p.g4{margin-top:5.3mm}
.of-name{position:relative;margin-top:24.7mm}.of-p.g5{margin-top:2.1mm}
.of-stars{font-size:10pt;margin-top:6.9mm}.of-p.g6{margin-top:6.4mm}
.of-signed{margin-top:15.8mm}.of-p.g7{margin-top:9mm}.of-p.g8{margin-top:2.8mm}
.of-mail{color:#0563C1}
.of-sig{position:absolute;left:1mm;top:-10.8mm;height:11mm}
.of-seal{position:absolute;left:45.8mm;top:-32.3mm;height:32mm}
.of-sched-h{left:20mm;top:30.2mm;font-size:12pt;font-weight:700;line-height:4.7mm}
.of-sched-wrap{left:20mm;right:17.4mm;top:43.5mm}
.of-sched{border-collapse:collapse;width:100%;font-size:9pt;line-height:3.7mm}
.of-sched tr{height:10.35mm}
.of-sched td{border:.75pt solid #000;padding:0 2mm;vertical-align:middle}
.of-sched td:first-child{width:46mm}
.of-after{margin-top:7.6mm;font-size:10pt;line-height:4.6mm;text-align:justify}
.of-initial{position:absolute;left:187mm;top:286.5mm;height:8mm;z-index:3}
.lt-wm{position:absolute;inset:0;display:grid;place-items:center;font:700 88px "THSarabunNewWeb",sans-serif;color:rgba(192,57,43,.10);transform:rotate(-28deg);pointer-events:none;z-index:5}
@media print{body{background:#fff}.lt-page{margin:0}}
`;

export function letterDocument(kind, d, opts) {
  const size = pageOf(kind) === "a4" ? "A4" : "letter";
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(opts?.docNo || KINDS[kind]?.label || "")}</title>
    <style>@page{size:${size};margin:0}${LETTER_CSS}</style></head><body>${letterPages(kind, d, opts)}</body></html>`;
}

// ---------------------------------------------------------------- ข้อมูลตั้งต้นจากทะเบียนพนักงาน
const empName = e => [e.firstname_th, e.lastname_th].filter(Boolean).join(" ");
export function draftFrom(kind, e, incomeItems = []) {
  const K = KINDS[kind], male = /^m/i.test(e?.gender || ""), female = /^f/i.test(e?.gender || "");
  const d = {
    issue_date: todayISO(), id_card: "",
    name_th: e ? `${male ? "นาย" : female ? "นางสาว" : ""}${empName(e)}` : "",
    name_en: e ? `${male ? "Mr." : female ? "Ms." : ""} ${[e.firstname_en, e.lastname_en].filter(Boolean).join(" ")}`.trim() : "",
    title_en: male ? "Mr." : female ? "Ms." : "",
    position_th: e?.position || "", division_th: e?.division || "", department_th: e?.department || "",
    position: e?.position || "", division: e?.division || "", department: e?.department || "", section: e?.section || "",
    period_from: e?.join_date || "", period_to: "",
    incomes: incomeItems.filter(i => i.is_active).map(i => ({ key: i.key, label_th: i.label_th, label_en: i.label_en,
      on: (K.income || []).includes(i.key), amount: i.key === "salary" && e?.salary ? e.salary : "" })),
  };
  if (kind === "offer_en") Object.assign(d, { name_en: e ? [e.firstname_en, e.lastname_en].filter(Boolean).join(" ") : "",
    salary: "", commencement: "", probation_days: 119, schedule: OFFER_SCHEDULE.map(r => [...r]), contact_email: "" });
  return d;
}

// ---------------------------------------------------------------- อีเมล (แบบ + ไฟล์ .eml สำหรับ Outlook)
const KIND_MAIL = { cert_th: "หนังสือรับรองการทำงาน (ภาษาไทย)", cert_en: "Certificate of Employment (EN)",
  salary_th: "หนังสือรับรองเงินเดือน (ภาษาไทย)", salary_en: "Salary Certificate (EN)", offer_en: "Offer Letter" };
// แบบตั้งต้น (ใช้ตอนยังไม่ได้รัน SQL ส่วนแบบอีเมล) — แบบจริงแก้ได้ในหน้าตั้งค่า เก็บในตาราง mail_templates
const DEFAULT_MAIL = [
  { key: "request", label: "ขออนุมัติหนังสือ", subject: "[ขออนุมัติ] {{doc_no}} {{kind}} — {{person}}",
    html: `<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;color:#1e293b"><p><b>มีหนังสือรอการอนุมัติจากท่าน</b></p><p>เลขที่ <b>{{doc_no}}</b> · {{kind}} · {{person}} {{emp_code}}</p><p><a href="{{link}}">เปิดหนังสือเพื่ออนุมัติ</a></p></div>` },
  { key: "approved", label: "แจ้งอนุมัติแล้ว", subject: "[อนุมัติแล้ว] {{doc_no}} — {{person}}",
    html: `<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px"><p><b>หนังสือได้รับการอนุมัติแล้ว</b></p><p>{{doc_no}} · {{kind}} · {{person}}</p><p><a href="{{link}}">เปิดหนังสือ</a></p></div>` },
  { key: "rejected", label: "แจ้งส่งกลับแก้ไข", subject: "[ส่งกลับแก้ไข] {{doc_no}} — {{person}}",
    html: `<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px"><p><b>หนังสือถูกส่งกลับให้แก้ไข</b></p><p>{{doc_no}} · {{kind}} · {{person}}</p><p>เหตุผล: {{reason}}</p><p><a href="{{link}}">เปิดหนังสือ</a></p></div>` },
];
// แทนค่า {{ตัวแปร}} — ค่าจากข้อมูล escape ก่อนลง HTML เสมอ (กันชื่อคนแปลก ๆ กลายเป็นโค้ดในเมล)
export function renderMail(tpl, vars, html) {
  return String(tpl || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => html ? esc(vars[k] ?? "") : String(vars[k] ?? ""));
}
function mailFor(action, row, extra = {}) {
  const t = mailTpl.find(x => x.key === action); if (!t) return null;
  const v = { doc_no: row.doc_no || "", kind: KIND_MAIL[row.kind] || row.kind, person: row.person_name || "",
              emp_code: row.emp_code ? `(${row.emp_code})` : "", link: `${location.origin}/?letter=${row.id}`,
              reason: row.reject_reason || "-", requester: extra.requester || "", approver: extra.approver || "" };
  return { subject: renderMail(t.subject, v, false), html: renderMail(t.html, v, true), toExtra: t.to_extra || "", cc: t.cc || "" };
}
const b64 = s => btoa(unescape(encodeURIComponent(s)));
// รวมรายชื่ออีเมล (คั่นด้วย , ; หรือขึ้นบรรทัด) ตัดซ้ำ ตัดค่าที่ไม่ใช่อีเมล
export const mailList = (...parts) => [...new Set(parts.join(",").split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))].join(", ");
// ไฟล์ .eml ที่มี X-Unsent: 1 — Outlook เปิดเป็นเมลใหม่ที่ยังไม่ส่ง (แก้ได้ กด Send ได้) พร้อมรูปแบบ HTML ครบ
export function emlText(to, subject, html, cc = "") {
  const body = b64(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${html}</body></html>`).replace(/.{76}/g, "$&\r\n");
  return [`To: ${to}`, ...(cc ? [`Cc: ${cc}`] : []), `Subject: =?UTF-8?B?${b64(subject)}?=`, "X-Unsent: 1", "MIME-Version: 1.0",
          "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", body].join("\r\n");
}
function downloadEml(to, subject, html, name, cc = "") {
  const url = URL.createObjectURL(new Blob([emlText(to, subject, html, cc)], { type: "message/rfc822" }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------- state
let letters = [], incomeItems = [], signers = [], settings = {}, mailCfg = { mode: "outlook" }, mailTpl = [], tab = "mine", search = "";

export function renderLetters() { boot(); }

async function boot() {
  const pg = document.getElementById("pageLetters");
  pg.innerHTML = `<div class="section mt-4"><div class="card"><div class="card-body">กำลังโหลด…</div></div></div>`;
  const [l, i, s, st] = await Promise.all([
    supabase.from("hr_letters").select("*").order("created_at", { ascending: false }).limit(1000),
    supabase.from("letter_income_items").select("*").order("sort_order"),
    supabase.from("letter_signers").select("*"),
    supabase.from("letter_settings").select("*").eq("id", 1).maybeSingle(),
  ]);
  const err = l.error || i.error || s.error || st.error;
  if (err) {
    pg.innerHTML = `<div class="section mt-4"><div class="card"><div class="card-body"><b>โหลดข้อมูลไม่สำเร็จ</b>
      <div class="text-muted" style="margin-top:6px;">${esc(err.message)}</div>
      <div class="text-muted" style="margin-top:10px;font-size:12px;">ต้องรัน <code>sql/schema_doc_register.sql</code> แล้วตามด้วย <code>sql/schema_hr_letters.sql</code> ใน Supabase ก่อน</div></div></div></div>`;
    return;
  }
  letters = l.data || []; incomeItems = i.data || []; signers = s.data || []; settings = st.data || {};
  // ตั้งค่าอีเมล/แบบอีเมล — ถ้ายังไม่ได้รัน SQL ส่วนนี้ ใช้โหมด Outlook กับแบบตั้งต้นไปก่อน
  const [mc, mt] = await Promise.all([supabase.from("mail_settings").select("*").eq("id", 1).maybeSingle(),
                                      supabase.from("mail_templates").select("*")]);
  if (!mc.error && mc.data) mailCfg = mc.data;
  mailTpl = !mt.error && mt.data?.length ? mt.data : DEFAULT_MAIL;
  if (!canWrite() && canApprove()) tab = "approve";
  draw();
  // เปิดจากลิงก์ในเมล (?letter=ID)
  const deep = +new URLSearchParams(location.search).get("letter");
  if (deep) { history.replaceState(null, "", location.pathname); const x = letters.find(r => r.id === deep); if (x) openLetter(x); }
  // มาจากปุ่ม "สร้างหนังสือ" ในทะเบียนเลขที่เอกสาร
  let fromDoc = null; try { fromDoc = JSON.parse(sessionStorage.getItem("letter_from_doc") || "null"); sessionStorage.removeItem("letter_from_doc"); } catch {}
  if (fromDoc && canWrite()) {
    const { data, error } = await supabase.rpc("letter_from_doc", { p_doc_id: fromDoc.doc_id, p_kind: fromDoc.kind });
    if (error) { toast("สร้างหนังสือจากเลขที่ไม่สำเร็จ: " + error.message, "error"); return; }
    let x = letters.find(r => r.id === data.id);
    if (!x) {
      // ฉบับใหม่: เติมข้อมูลตั้งต้นจากทะเบียนพนักงาน (ถ้าเลขนี้ออกให้พนักงาน) แล้วบันทึกเป็นร่าง
      const emp = allEmployees.find(e => e.emp_code === data.emp_code) || null;
      const d = draftFrom(data.kind, emp, incomeItems);
      if (emp) d.emp_code = emp.emp_code; else if (data.person_name) { d.name_th = data.person_name; d.name_en = data.person_name; }
      d.contact_email = settings.hr_contact_email || "";
      const u = await supabase.from("hr_letters").update({ data: d }).eq("id", data.id).select().single();
      x = u.data || data; letters.unshift(x); draw();
    }
    openLetter(x);
  }
}

function draw() {
  const pg = document.getElementById("pageLetters");
  const pend = letters.filter(r => r.status === "pending" && (r.approver_id === currentUser?.id || canApprove()));
  const q = search.trim().toLowerCase();
  const list = (tab === "approve" ? pend : letters).filter(r => !q || [r.doc_no, r.person_name, r.emp_code, KINDS[r.kind]?.label].join(" ").toLowerCase().includes(q));
  pg.innerHTML = `
  <div class="page-header"><div><div class="page-heading">ออกหนังสือ HR</div>
    <div class="page-sub">หนังสือรับรองการทำงาน / เงินเดือน (ไทย · อังกฤษ) และ Offer Letter · อนุมัติแล้วลายเซ็นลงหนังสือให้อัตโนมัติ</div></div>
    <div class="header-actions">${canWrite() ? `<button class="btn btn-primary" id="ltNew">+ ออกหนังสือ</button>` : ""}</div></div>
  <div class="section" style="padding-top:12px;padding-bottom:0;"><div class="cp-tabs">
    ${canWrite() ? `<button class="cp-tab${tab === "mine" ? " on" : ""}" data-tab="mine">หนังสือทั้งหมด (${letters.length})</button>` : ""}
    ${canApprove() ? `<button class="cp-tab${tab === "approve" ? " on" : ""}" data-tab="approve">รออนุมัติ${pend.length ? ` <b style="color:var(--red);">(${pend.length})</b>` : ""}</button>` : ""}
    <button class="cp-tab${tab === "settings" ? " on" : ""}" data-tab="settings">ตั้งค่า</button></div></div>
  ${tab === "settings" ? settingsHTML() : `
  <div class="section" style="padding-top:12px;padding-bottom:0;">
    <input class="form-control" id="ltSearch" placeholder="ค้นหา เลขที่ / ชื่อ / ประเภท" value="${esc(search)}" style="max-width:280px;"></div>
  <div class="section mt-4"><div class="card"><div class="table-wrap">
  ${list.length ? `<table class="data-table"><thead><tr><th>เลขที่</th><th>ประเภท</th><th>ออกให้</th><th>สถานะ</th><th>อัปเดต</th><th></th></tr></thead>
    <tbody>${list.map(r => `<tr>
      <td style="white-space:nowrap;"><b>${esc(r.doc_no || "—")}</b></td><td>${esc(KINDS[r.kind]?.label || r.kind)}</td>
      <td>${esc(r.person_name || "")}${r.emp_code ? `<div class="text-muted" style="font-size:11.5px;">${esc(r.emp_code)}</div>` : ""}</td>
      <td>${badge(r.status)}${r.status === "rejected" && r.reject_reason ? `<div style="font-size:11.5px;color:var(--red);">${esc(r.reject_reason)}</div>` : ""}${r.status === "cancelled" && r.cancel_reason ? `<div class="text-muted" style="font-size:11.5px;">${esc(r.cancel_reason)}</div>` : ""}</td>
      <td style="white-space:nowrap;">${new Date(r.updated_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</td>
      <td style="white-space:nowrap;"><button class="btn btn-sm ${tab === "approve" ? "btn-primary" : "btn-secondary"}" data-open="${r.id}">${tab === "approve" ? "เปิดดู / อนุมัติ" : r.status === "draft" || r.status === "rejected" ? "แก้ไข" : "เปิด"}</button>
        ${r.status === "approved" ? `<button class="btn btn-sm btn-primary" data-print="${r.id}">พิมพ์ / PDF</button>` : ""}</td></tr>`).join("")}</tbody></table>`
    : `<div class="card-body" style="padding:40px;text-align:center;"><div class="empty-title">${tab === "approve" ? "ไม่มีหนังสือรออนุมัติ" : "ยังไม่มีหนังสือ"}</div>
       <div class="empty-sub">${tab === "approve" ? "" : "กด “+ ออกหนังสือ” เพื่อเริ่ม"}</div></div>`}
  </div></div></div>`}<div class="pb-4"></div>`;
  pg.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; draw(); });
  pg.querySelector("#ltNew")?.addEventListener("click", () => openLetter(null));
  const s = pg.querySelector("#ltSearch");
  if (s) s.oninput = () => { search = s.value; const p = s.selectionStart; draw(); const n = document.getElementById("ltSearch"); n.focus(); n.setSelectionRange(p, p); };
  pg.querySelectorAll("[data-open]").forEach(b => b.onclick = () => openLetter(letters.find(r => r.id === +b.dataset.open)));
  pg.querySelectorAll("[data-print]").forEach(b => b.onclick = () => printLetter(letters.find(r => r.id === +b.dataset.print)));
  if (tab === "settings") { wireSettings(); wireMail(); }
}

// ---------------------------------------------------------------- ลายเซ็น/ตรา (private storage → data URL)
async function assetData(path) {
  if (!path) return "";
  const { data, error } = await supabase.storage.from("letter-assets").download(path);
  if (error || !data) return "";
  return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(data); });
}
// หัว/ท้ายกระดาษ → data URL ครั้งเดียว (หน้าต่างพิมพ์เป็น about:blank อ่าน path แบบ relative ไม่ได้)
let imgCache = null;
async function letterImgs() {
  if (imgCache) return imgCache;
  const out = {};
  for (const [k, path] of Object.entries(LETTER_IMG)) {
    try { const b = await (await fetch(path)).blob(); out[k] = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); }
    catch { out[k] = new URL(path, location.href).href; }
  }
  return (imgCache = out);
}
async function optsFor(r) {
  const approved = r.status === "approved" && r.signer;
  return { docNo: r.doc_no || "", img: await letterImgs(), draft: !approved, signer: approved ? r.signer : null,
           art: approved ? { signature: await assetData(r.signer.signature_path), seal: await assetData(r.signer.seal_path) } : null };
}

async function printLetter(r) {
  const w = window.open("", "_blank");
  if (!w) { toast("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต pop-up แล้วลองใหม่", "error"); return; }
  w.document.write(`<p style="font-family:sans-serif;padding:20px">กำลังเตรียมหนังสือ…</p>`);
  const html = letterDocument(r.kind, r.data || {}, await optsFor(r));
  w.document.open(); w.document.write(html); w.document.close();
  setTimeout(async () => { try { await w.document.fonts?.ready; } catch {} w.focus(); w.print(); }, 500);
}

// ---------------------------------------------------------------- ตัวแก้หนังสือ (ฟอร์มซ้าย · ตัวอย่างขวา)
function openLetter(r) {
  const editable = !r || (canWrite() && ["draft", "rejected"].includes(r.status));
  let kind = r?.kind || "cert_th";
  let d = r ? structuredClone(r.data || {}) : draftFrom(kind, null, incomeItems);
  if (!r) d.contact_email = settings.hr_contact_email || "";
  const el = document.createElement("div");
  el.className = "modal-overlay";
  el.innerHTML = `<div class="modal lt-modal"><div class="modal-header"><div class="modal-title">${r ? `${esc(r.doc_no || "ร่างหนังสือ")} · ${badge(r.status)}` : "ออกหนังสือ"}</div>
    <button class="modal-close" data-x>✕</button></div>
    <div class="lt-body"><div class="lt-form" id="ltForm"></div><div class="lt-preview"><iframe id="ltFrame" title="ตัวอย่างหนังสือ"></iframe></div></div>
    <div class="modal-footer" id="ltFoot"></div></div>`;
  document.getElementById("modalPortal").appendChild(el);
  const close = () => el.remove();
  el.querySelector("[data-x]").onclick = close;
  const $ = s => el.querySelector(s);

  let rendering = 0;
  const preview = async () => {
    const my = ++rendering;
    const o = r ? await optsFor({ ...r, data: d }) : { docNo: "", img: await letterImgs(), draft: true };
    if (my !== rendering) return;
    const fr = $("#ltFrame");
    // ความสูงกรอบตามจำนวนหน้า (Offer Letter 2 หน้า) — ไม่มีแถบเลื่อนซ้อนในกรอบ
    fr.onload = () => { const h = fr.contentDocument?.documentElement.scrollHeight || 1123;
      fr.style.height = h + "px"; fr.style.width = (kind === "offer_en" ? 794 : 816) + "px"; fr.style.marginBottom = `${-Math.round(h * 0.28)}px`; };
    fr.srcdoc = letterDocument(kind, d, o);
  };

  const f = (key, label, type = "text", extra = "") => `<label class="lt-f"><span>${label}</span>
    <input class="form-control" data-k="${key}" type="${type}" value="${esc(d[key] ?? "")}" ${editable ? "" : "disabled"} ${extra}></label>`;
  const form = () => {
    const K = KINDS[kind], th = K.lang === "th", offer = kind === "offer_en";
    $("#ltForm").innerHTML = `
      ${editable ? `<label class="lt-f"><span>ประเภทหนังสือ</span><select class="form-control" id="ltKind">${Object.entries(KINDS).map(([k, v]) =>
        `<option value="${k}" ${k === kind ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select></label>
      <div class="lt-f"><span>ดึงข้อมูลจากทะเบียนพนักงาน</span>${comboHTML("ltEmp", [], d.emp_code || "", "พิมพ์ชื่อไทย/อังกฤษ หรือรหัส")}</div>
      <div class="lt-hint">ทุกช่องแก้ได้ · ${offer ? "ผู้สมัครยังไม่อยู่ในทะเบียน พิมพ์เองได้เลย" : "ชื่อ/ตำแหน่ง/สังกัดในทะเบียนเป็นภาษาอังกฤษ — หนังสือภาษาไทยแก้เป็นไทยก่อนส่ง"}</div>` : ""}
      ${f("issue_date", "วันที่ออกหนังสือ", "date")}
      ${offer ? `<div class="lt-2">${f("title_en", "คำนำหน้า (Mr./Ms./Miss)")}${f("name_en", "ชื่อ-นามสกุล (อังกฤษ)")}</div>
        ${f("position", "Position")}${f("salary", "Monthly Base Salary (THB)", "number")}
        <div class="lt-2">${f("commencement", "Commencement Date", "date")}${f("probation_days", "Probation (days)", "number")}</div>
        ${f("contact_email", "อีเมล HR ให้ส่งตอบรับ")}
        <div class="lt-sub">Schedule 1 <span class="text-muted">(แก้ข้อความ / เพิ่ม / ลบแถวได้)</span></div>
        <div id="ltSched">${(d.schedule || []).map((row, i) => `<div class="lt-srow">
          <input class="form-control" data-s="${i}.0" value="${esc(row[0])}" ${editable ? "" : "disabled"}>
          <textarea class="form-control" data-s="${i}.1" rows="2" ${editable ? "" : "disabled"}>${esc(row[1])}</textarea>
          ${editable ? `<button class="btn btn-sm btn-secondary" data-sdel="${i}" title="ลบแถว">✕</button>` : ""}</div>`).join("")}</div>
        ${editable ? `<button class="btn btn-sm btn-secondary" id="ltSAdd">+ เพิ่มแถว</button>` : ""}`
      : `${th ? `${f("name_th", "ชื่อ - นามสกุล (รวมคำนำหน้า)")}` : f("name_en", "Name (with title, e.g. Miss Prapa Iewsanurak)")}
        ${f("id_card", "เลขบัตรประชาชน", "text", 'inputmode="numeric" maxlength="13"')}
        ${th ? `${f("position_th", "ตำแหน่ง")}<div class="lt-2">${f("division_th", "ฝ่าย")}${f("department_th", "แผนก")}</div>`
             : `${f("position", "Position")}<div class="lt-2">${f("division", "Division")}${f("department", "Department")}</div>${f("section", "Section")}`}
        <div class="lt-2">${f("period_from", "เริ่มงาน", "date")}${f("period_to", "ถึง (ว่าง = ปัจจุบัน)", "date")}</div>
        <div class="lt-sub">รายการเงินได้ที่แสดงในหนังสือ <span class="text-muted">(ติ๊กเลือก · เพิ่มรายการได้ที่แท็บตั้งค่า)</span></div>
        ${(d.incomes || []).map((x, i) => `<div class="lt-inc"><label><input type="checkbox" data-ion="${i}" ${x.on ? "checked" : ""} ${editable ? "" : "disabled"}>
          ${esc(th ? x.label_th : x.label_en)}</label><input class="form-control" type="number" data-iam="${i}" value="${esc(x.amount)}" placeholder="บาท/เดือน" ${editable ? "" : "disabled"}></div>`).join("")
          || `<div class="text-muted" style="font-size:12.5px;">ยังไม่มีรายการเงินได้</div>`}`}`;
    wireForm();
  };
  const wireForm = () => {
    $("#ltKind")?.addEventListener("change", e => {
      const keep = d; kind = e.target.value; d = draftFrom(kind, null, incomeItems);
      // เปลี่ยนประเภทแล้วข้อมูลคนเดิมยังอยู่
      for (const k of ["issue_date","id_card","name_th","name_en","title_en","position_th","division_th","department_th","position","division","department","section","period_from","period_to"]) if (keep[k]) d[k] = keep[k];
      d.contact_email = keep.contact_email || settings.hr_contact_email || "";
      form(); preview();
    });
    if ($("#ltEmp")) bindCombo("ltEmp", allEmployees.filter(e => e.emp_code).map(e => ({ value: e.emp_code, label: empName(e) || e.emp_code,
      sub: [e.emp_code, [e.firstname_en, e.lastname_en].filter(Boolean).join(" "), e.department].filter(Boolean).join(" · ") })), code => {
      const emp = allEmployees.find(x => x.emp_code === code);
      if (!emp) return;
      const issue = d.issue_date, email = d.contact_email; d = draftFrom(kind, emp, incomeItems); d.emp_code = emp.emp_code;
      d.issue_date = issue || d.issue_date; d.contact_email = email || settings.hr_contact_email || "";
      form(); preview();
    });
    if (d.emp_code && $("#ltEmp_txt")) { const e = allEmployees.find(x => x.emp_code === d.emp_code); if (e) $("#ltEmp_txt").value = empName(e); }
    el.querySelectorAll("[data-k]").forEach(i => i.oninput = () => { d[i.dataset.k] = i.value; preview(); });
    el.querySelectorAll("[data-ion]").forEach(i => i.onchange = () => { d.incomes[+i.dataset.ion].on = i.checked; preview(); });
    el.querySelectorAll("[data-iam]").forEach(i => i.oninput = () => { d.incomes[+i.dataset.iam].amount = i.value; preview(); });
    el.querySelectorAll("[data-s]").forEach(i => i.oninput = () => { const [a, b] = i.dataset.s.split("."); d.schedule[+a][+b] = i.value; preview(); });
    el.querySelectorAll("[data-sdel]").forEach(b => b.onclick = () => { d.schedule.splice(+b.dataset.sdel, 1); form(); preview(); });
    $("#ltSAdd")?.addEventListener("click", () => { d.schedule.push(["", ""]); form(); preview(); });
  };

  const personOf = () => KINDS[kind].lang === "th" ? d.name_th : `${kind === "offer_en" && d.title_en ? d.title_en + " " : ""}${d.name_en || ""}`.trim();
  const save = async () => {
    const row = { kind, data: d, emp_code: d.emp_code || null, person_name: personOf() || null, requested_email: currentUser?.email || null };
    if (r) {
      const { data, error } = await supabase.from("hr_letters").update({ ...row, status: "draft" }).eq("id", r.id).select().single();
      if (error) { toast("บันทึกไม่สำเร็จ: " + error.message, "error"); return null; }
      Object.assign(r, data); return r;
    }
    const { data, error } = await supabase.from("hr_letters").insert({ ...row, created_by: currentUser?.id || null }).select().single();
    if (error) { toast("บันทึกไม่สำเร็จ: " + error.message, "error"); return null; }
    if (!letters.some(x => x.id === data.id)) letters.unshift(data);
    r = data; return r;
  };
  // โหมดอัตโนมัติ: ส่งจากอีเมลกลาง (Edge Function) · โหมด Outlook หรือส่งอัตโนมัติไม่ผ่าน: ดาวน์โหลดไฟล์เมลให้เปิดใน Outlook
  const sendMail = async (row, action) => {
    if (mailCfg.mode === "auto") {
      try {
        const { data, error } = await supabase.functions.invoke("letter-notify", { body: { letter_id: row.id, action } });
        if (error) throw error;
        if (data?.sent) return `ส่งอีเมลถึง ${data.to} แล้ว`;
      } catch { /* ตกไปใช้ไฟล์เมลด้านล่าง */ }
    }
    const appr = signers.find(x => x.user_id === (row.approver_id || row.approved_by)) || {};
    const me = signers.find(x => x.user_id === currentUser?.id) || {};
    const to = action === "request" ? appr.email : row.requested_email;
    const m = mailFor(action, row, { requester: action === "request" ? (me.name_th || currentUser?.email || "") : (row.requested_email || ""),
                                     approver: action === "request" ? (appr.name_th || "") : (me.name_th || me.name_en || "") });
    if (!m) return "แจ้งในระบบแล้ว";
    downloadEml(mailList(to, m.toExtra), m.subject, m.html,
      `${row.doc_no || "letter"} ${action === "request" ? "ขออนุมัติ" : action === "approved" ? "อนุมัติแล้ว" : "ส่งกลับแก้ไข"}.eml`, mailList(m.cc));
    return "ดาวน์โหลดไฟล์เมลแล้ว — เปิดไฟล์ Outlook จะขึ้นเมลที่เขียนไว้แล้ว กด Send ได้เลย";
  };

  const foot = () => {
    const st = r?.status || "draft";
    const appr = signers.filter(s => s.signature_path);
    $("#ltFoot").innerHTML = editable ? `
      ${r ? `<button class="btn btn-danger" data-cancel style="margin-right:auto;">ยกเลิกหนังสือ</button>` : ""}
      <button class="btn btn-secondary" data-save>บันทึกร่าง</button>
      <select class="form-control" id="ltAppr" style="max-width:240px;">${appr.length ? appr.map(s => `<option value="${s.user_id}">ผู้อนุมัติ: ${esc(s.name_th || s.name_en || s.email)}</option>`).join("")
        : `<option value="">ยังไม่มีผู้อนุมัติที่ตั้งลายเซ็น</option>`}</select>
      <button class="btn btn-primary" data-submit ${appr.length ? "" : "disabled"}>ส่งขออนุมัติ</button>`
    : st === "pending" && canApprove() ? `
      <button class="btn btn-danger" data-reject style="margin-right:auto;">ส่งกลับแก้ไข</button>
      <button class="btn btn-primary" data-approve>✓ อนุมัติและลงลายเซ็น</button>`
    : st === "pending" && canWrite() ? `<span class="text-muted" style="margin-right:auto;">รอ HR Manager อนุมัติ</span>
      <button class="btn btn-secondary" data-recall>ดึงกลับมาแก้ไข</button>`
    : st === "approved" ? `${canWrite() ? `<button class="btn btn-danger" data-cancel style="margin-right:auto;">ยกเลิกหนังสือ</button>` : ""}
      <span class="text-muted">อนุมัติ ${r.approved_at ? new Date(r.approved_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : ""}</span>
      <button class="btn btn-primary" data-print>พิมพ์ / บันทึก PDF</button>` : `<button class="btn btn-secondary" data-x>ปิด</button>`;
    $("#ltFoot").querySelectorAll("[data-x]").forEach(b => b.onclick = close);
    $("[data-save]")?.addEventListener("click", async () => { if (await save()) { toast("บันทึกร่างแล้ว", "success"); draw(); } });
    $("[data-submit]")?.addEventListener("click", async e => {
      if (!personOf()) { toast("ใส่ชื่อผู้รับหนังสือก่อน", "error"); return; }
      if (kind !== "offer_en" && d.id_card && !/^\d{13}$/.test(d.id_card)) { toast("เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก", "error"); return; }
      e.target.disabled = true;
      const saved = await save(); if (!saved) { e.target.disabled = false; return; }
      const { data, error } = await supabase.rpc("letter_submit", { p_id: saved.id, p_approver: $("#ltAppr").value, p_type_label: KINDS[kind].docType });
      if (error) { toast("ส่งไม่สำเร็จ: " + error.message, "error"); e.target.disabled = false; return; }
      Object.assign(r, data);
      notify("มีหนังสือ HR รออนุมัติ", `${data.doc_no}`, { category: "default", silent: true });
      toast(`${data.doc_no} ส่งขออนุมัติแล้ว · ${await sendMail(data, "request")}`, "success");
      close(); draw();
    });
    $("[data-approve]")?.addEventListener("click", async e => {
      e.target.disabled = true;
      const { data, error } = await supabase.rpc("letter_approve", { p_id: r.id });
      if (error) { toast("อนุมัติไม่สำเร็จ: " + error.message, "error"); e.target.disabled = false; return; }
      Object.assign(r, data); toast(`อนุมัติ ${data.doc_no} แล้ว · ${await sendMail(data, "approved")}`, "success"); close(); draw();
    });
    $("[data-reject]")?.addEventListener("click", async () => {
      const why = prompt("ส่งกลับให้แก้ไข — เหตุผล:", ""); if (why === null) return;
      const { data, error } = await supabase.rpc("letter_reject", { p_id: r.id, p_reason: why });
      if (error) { toast("ส่งกลับไม่สำเร็จ: " + error.message, "error"); return; }
      Object.assign(r, data); toast(`ส่งกลับ ${data.doc_no} แล้ว · ${await sendMail(data, "rejected")}`, "success"); close(); draw();
    });
    $("[data-recall]")?.addEventListener("click", async () => {
      const { data, error } = await supabase.from("hr_letters").update({ status: "draft" }).eq("id", r.id).select().single();
      if (error) { toast("ดึงกลับไม่สำเร็จ: " + error.message, "error"); return; }
      Object.assign(r, data); close(); openLetter(r); draw();
    });
    $("[data-print]")?.addEventListener("click", () => printLetter(r));
    $("[data-cancel]")?.addEventListener("click", () => cancelLetter(r, () => { close(); draw(); }));
  };
  form(); foot(); preview();
}

// ยกเลิกหนังสือ — ถ้ามีเลขที่แล้ว ให้เลือกว่าจะยกเลิกเลขด้วย หรือเก็บเลขไว้ออกฉบับใหม่ในเลขเดิม
// ทั้งสองแบบมีประวัติ: หนังสือที่ยกเลิกยังอยู่พร้อมเหตุผล และทะเบียนแสดงว่าเลขนั้นเคยยกเลิกหนังสือกี่ฉบับ
function cancelLetter(r, done) {
  const el = document.createElement("div");
  el.className = "modal-overlay";
  const opt = (v, title, sub, on) => `<label class="lt-cancel-opt"><input type="radio" name="ltCxl" value="${v}" ${on ? "checked" : ""}>
    <span><b>${title}</b><span class="text-muted">${sub}</span></span></label>`;
  el.innerHTML = `<div class="modal" style="max-width:480px;"><div class="modal-header"><div class="modal-title">ยกเลิกหนังสือ${r.doc_no ? ` ${esc(r.doc_no)}` : ""}</div>
    <button class="modal-close" data-x>✕</button></div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:10px;">
      ${r.doc_no ? `<div class="form-label" style="margin:0;">เลขที่ ${esc(r.doc_no)} จะทำอย่างไร</div>
        ${opt("void", "ยกเลิกเลขที่ด้วย", "เลขนี้ขีดฆ่าในทะเบียน ไม่นำกลับมาใช้ — เหมาะกับหนังสือที่ส่งให้พนักงานไปแล้ว", r.status === "approved")}
        ${opt("keep", "เก็บเลขไว้ ออกหนังสือฉบับใหม่ในเลขเดิม", "ทะเบียนบันทึกว่าเลขนี้มีหนังสือยกเลิก 1 ฉบับ แล้วกด “สร้างหนังสือ” ที่เลขเดิมได้ — เหมาะกับกรณีกรอกผิดก่อนส่งออก", r.status !== "approved")}` : ""}
      <label class="form-label" style="margin:0;">เหตุผล<input class="form-control" id="ltCxlWhy" placeholder="เช่น ชื่อสะกดผิด / พนักงานขอเปลี่ยนเป็นภาษาอังกฤษ"></label>
      <div class="text-muted" style="font-size:12px;">หนังสือที่ยกเลิกนำกลับมาใช้ไม่ได้ แต่ยังเปิดดูย้อนหลังได้</div>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" data-x>ไม่ยกเลิก</button><button class="btn btn-danger" data-ok>ยกเลิกหนังสือ</button></div></div>`;
  document.getElementById("modalPortal").appendChild(el);
  el.querySelectorAll("[data-x]").forEach(b => b.onclick = () => el.remove());
  el.querySelector("#ltCxlWhy").focus();
  el.querySelector("[data-ok]").onclick = async () => {
    const voidNo = !!r.doc_id && el.querySelector("input[name=ltCxl]:checked")?.value === "void";
    const ok = el.querySelector("[data-ok]"); ok.disabled = true;
    const { data, error } = await supabase.rpc("letter_cancel", { p_id: r.id, p_reason: el.querySelector("#ltCxlWhy").value, p_void_number: voidNo });
    if (error) { ok.disabled = false; toast("ยกเลิกไม่สำเร็จ: " + error.message, "error"); return; }
    Object.assign(r, data); el.remove();
    toast(!r.doc_no ? "ยกเลิกแล้ว" : voidNo ? `ยกเลิกหนังสือและเลข ${r.doc_no} แล้ว` : `ยกเลิกหนังสือแล้ว — เลข ${r.doc_no} ยังใช้ออกฉบับใหม่ได้`, "success");
    done();
  };
}

// ---------------------------------------------------------------- ตั้งค่า
function settingsHTML() {
  const me = signers.find(s => s.user_id === currentUser?.id) || {};
  return `<div class="section mt-4" style="display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));">
    ${canApprove() ? `<div class="card"><div class="card-body">
      <div style="font-weight:700;color:var(--navy);margin-bottom:4px;">ลายเซ็นของฉัน (ผู้อนุมัติ)</div>
      <div class="text-muted" style="font-size:12.5px;margin-bottom:10px;">ใช้ลงในหนังสือเฉพาะตอนที่ท่านกดอนุมัติเอง · ใช้ไฟล์ PNG พื้นใส</div>
      <div class="lt-2"><label class="lt-f"><span>ชื่อ (ไทย)</span><input class="form-control" id="sgNameTh" value="${esc(me.name_th || "")}" placeholder="นายศุภโชค พันธุมิตร"></label>
        <label class="lt-f"><span>ตำแหน่ง (ไทย)</span><input class="form-control" id="sgTitleTh" value="${esc(me.title_th || "")}" placeholder="ผู้จัดการฝ่ายทรัพยากรบุคคล"></label></div>
      <div class="lt-2"><label class="lt-f"><span>Name (EN)</span><input class="form-control" id="sgNameEn" value="${esc(me.name_en || "")}" placeholder="Mr. Suphachoke Phanthumitr"></label>
        <label class="lt-f"><span>Title (EN)</span><input class="form-control" id="sgTitleEn" value="${esc(me.title_en || "")}" placeholder="Human Resources Manager"></label></div>
      <label class="lt-f"><span>อีเมลรับแจ้งขออนุมัติ</span><input class="form-control" id="sgEmail" value="${esc(me.email || currentUser?.email || "")}"></label>
      <label class="lt-f"><span>ไฟล์ลายเซ็น ${me.signature_path ? `<b style="color:var(--green);">✓ มีแล้ว</b>` : ""}</span><input type="file" class="form-control" id="sgFile" accept="image/png"></label>
      <div id="sgPrev" style="min-height:10px;"></div>
      <button class="btn btn-primary" id="sgSave">บันทึกลายเซ็น</button>
      <hr style="margin:16px 0;border:none;border-top:1px solid var(--border);">
      <div style="font-weight:700;color:var(--navy);margin-bottom:4px;">ตราบริษัท ${settings.seal_path ? `<b style="color:var(--green);font-size:12.5px;">✓ มีแล้ว</b>` : ""}</div>
      <input type="file" class="form-control" id="slFile" accept="image/png" style="margin-bottom:8px;">
      <label class="lt-f"><span>อีเมล HR ใน Offer Letter</span><input class="form-control" id="slMail" value="${esc(settings.hr_contact_email || "")}"></label>
      <button class="btn btn-secondary" id="slSave">บันทึกตรา / อีเมล</button></div></div>` : ""}
    ${canWrite() ? `<div class="card"><div class="card-body">
      <div style="font-weight:700;color:var(--navy);margin-bottom:4px;">รายการเงินได้ที่แสดงในหนังสือ</div>
      <div class="text-muted" style="font-size:12.5px;margin-bottom:10px;">ติ๊กเลือกตอนออกหนังสือ · เพิ่มรายการใหม่ได้ เช่น ค่าตำแหน่ง ค่าครองชีพ</div>
      <table class="data-table"><thead><tr><th>ภาษาไทย</th><th>English</th><th>ใช้</th></tr></thead><tbody>
      ${incomeItems.map(i => `<tr><td><input class="form-control" data-ith="${esc(i.key)}" value="${esc(i.label_th)}"></td>
        <td><input class="form-control" data-ien="${esc(i.key)}" value="${esc(i.label_en)}"></td>
        <td style="text-align:center;"><input type="checkbox" data-iact="${esc(i.key)}" ${i.is_active ? "checked" : ""}></td></tr>`).join("")}</tbody></table>
      <div class="lt-2" style="margin-top:10px;"><input class="form-control" id="inTh" placeholder="ชื่อไทย เช่น ค่าตำแหน่ง"><input class="form-control" id="inEn" placeholder="English e.g. Position Allowance"></div>
      <div style="display:flex;gap:8px;margin-top:8px;"><button class="btn btn-secondary" id="inAdd">+ เพิ่มรายการ</button><button class="btn btn-primary" id="inSave">บันทึก</button></div>
    </div></div>` : ""}
    ${canApprove() ? mailSettingsHTML() : ""}</div>`;
}

// ---- การส่งอีเมล (ตั้งค่าแบบเดียวกับ TigerSoft) + แบบอีเมลที่แก้ HTML ได้
let tplKey = "request";
function mailSettingsHTML() {
  const t = mailTpl.find(x => x.key === tplKey) || mailTpl[0] || {};
  return `<div class="card" style="grid-column:1/-1;"><div class="card-body">
    <div style="font-weight:700;color:var(--navy);margin-bottom:4px;">การส่งอีเมล</div>
    <div class="text-muted" style="font-size:12.5px;margin-bottom:10px;">ส่งอัตโนมัติจากอีเมลกลางผ่าน Microsoft 365 — ใช้ค่าเดียวกับที่ตั้งใน TigerSoft ได้ (Tenant ID / Client ID / Client Secret / อีเมลผู้ส่ง)</div>
    <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:8px;font-size:13.5px;">
      <label style="display:flex;gap:6px;align-items:center;"><input type="radio" name="mlMode" value="outlook" ${mailCfg.mode !== "auto" ? "checked" : ""}> เปิดใน Outlook (ส่งจากเมลของคนที่กด)</label>
      <label style="display:flex;gap:6px;align-items:center;"><input type="radio" name="mlMode" value="auto" ${mailCfg.mode === "auto" ? "checked" : ""}> ส่งอัตโนมัติจากอีเมลกลาง</label></div>
    <div class="lt-2"><label class="lt-f"><span>Tenant ID</span><input class="form-control" id="mlTenant" value="${esc(mailCfg.tenant_id || "")}" autocomplete="off"></label>
      <label class="lt-f"><span>Client ID</span><input class="form-control" id="mlClient" value="${esc(mailCfg.client_id || "")}" autocomplete="off"></label></div>
    <div class="lt-2"><label class="lt-f"><span>Client Secret ${mailCfg.has_secret ? `<b style="color:var(--green);">✓ ตั้งไว้แล้ว</b>` : ""}</span>
        <input class="form-control" id="mlSecret" type="password" placeholder="${mailCfg.has_secret ? "เว้นว่าง = ใช้ค่าเดิม" : "วางค่า Client Secret"}" autocomplete="new-password"></label>
      <label class="lt-f"><span>อีเมลผู้ส่ง (From)</span><input class="form-control" id="mlSender" value="${esc(mailCfg.sender || "")}" placeholder="hr.online@akararesources.com"></label></div>
    <div class="lt-hint">Client Secret เก็บแยกในระบบ อ่านกลับออกมาไม่ได้ (แม้ผู้ดูแล) ใช้ได้เฉพาะตอนส่งเมล · ต้อง deploy ฟังก์ชัน letter-notify ใน Supabase หนึ่งครั้งก่อนใช้โหมดอัตโนมัติ</div>
    <div style="display:flex;gap:8px;margin-top:10px;"><button class="btn btn-primary" id="mlSave">บันทึกการตั้งค่า</button><button class="btn btn-secondary" id="mlTest">ทดสอบส่งเมล (ถึงตัวเอง)</button></div>
    <hr style="margin:18px 0;border:none;border-top:1px solid var(--border);">
    <div style="font-weight:700;color:var(--navy);margin-bottom:4px;">แบบอีเมล</div>
    <div class="text-muted" style="font-size:12.5px;margin-bottom:8px;">ใส่โค้ด HTML ได้ · ตัวแปร: <code>{{doc_no}}</code> <code>{{kind}}</code> <code>{{person}}</code> <code>{{emp_code}}</code> <code>{{link}}</code> <code>{{reason}}</code> <code>{{requester}}</code> <code>{{approver}}</code></div>
    <div class="lt-mail-ed"><div>
      <select class="form-control" id="mtKey" style="max-width:260px;">${mailTpl.map(x => `<option value="${x.key}" ${x.key === t.key ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select>
      <div class="lt-hint" style="margin-top:8px;">ผู้รับหลักใส่ให้อัตโนมัติ: ${tplKey === "request" ? "ผู้อนุมัติที่เลือกตอนส่ง" : "HR คนที่ส่งขออนุมัติฉบับนั้น"} · ใส่เพิ่มได้ด้านล่าง คั่นด้วยจุลภาค</div>
      <label class="lt-f"><span>ส่งถึงเพิ่มเติม (To)</span><input class="form-control" id="mtTo" value="${esc(t.to_extra || "")}" placeholder="เช่น hr.team@akararesources.com"></label>
      <label class="lt-f"><span>สำเนาถึง (CC)</span><input class="form-control" id="mtCc" value="${esc(t.cc || "")}" placeholder="เช่น chalita@akararesources.com, kopbun@akararesources.com"></label>
      <label class="lt-f"><span>หัวเรื่อง</span><input class="form-control" id="mtSubject" value="${esc(t.subject || "")}"></label>
      <label class="lt-f"><span>เนื้อหา (HTML)</span><textarea class="form-control" id="mtHtml" rows="14" spellcheck="false" style="font-family:ui-monospace,Menlo,monospace;font-size:12px;">${esc(t.html || "")}</textarea></label>
      <button class="btn btn-primary" id="mtSave" style="margin-top:8px;">บันทึกแบบอีเมล</button></div>
      <div><div class="lt-f"><span>ตัวอย่าง</span></div><div class="lt-mail-subj" id="mtPrevSubj"></div><iframe id="mtPrev" title="ตัวอย่างอีเมล"></iframe></div></div>
  </div></div>`;
}
const SAMPLE_MAIL = { doc_no: "HR-115-2026", kind: "หนังสือรับรองเงินเดือน (ภาษาไทย)", person: "นางสาวตัวอย่าง ทดสอบ", emp_code: "(AKR00000001)",
  link: "#", reason: "แก้ตำแหน่งให้ตรงกับทะเบียน", requester: "ผู้ออกหนังสือ", approver: "นายศุภโชค พันธุมิตร" };
function wireMail() {
  const pg = document.getElementById("pageLetters"), $ = s => pg.querySelector(s);
  if (!$("#mtKey")) return;
  const prev = () => { $("#mtPrevSubj").textContent = renderMail($("#mtSubject").value, SAMPLE_MAIL, false);
    $("#mtPrev").srcdoc = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:12px">${renderMail($("#mtHtml").value, SAMPLE_MAIL, true)}</body></html>`; };
  prev();
  $("#mtSubject").oninput = prev; $("#mtHtml").oninput = prev;
  $("#mtKey").onchange = e => { tplKey = e.target.value; draw(); };
  $("#mtSave").onclick = async () => {
    const to_extra = mailList($("#mtTo").value), cc = mailList($("#mtCc").value);
    const bad = [$("#mtTo").value, $("#mtCc").value].join(",").split(/[,;\s]+/).filter(x => x.trim() && !mailList(x));
    if (bad.length) { toast(`อีเมลไม่ถูกต้อง: ${bad.join(", ")}`, "error"); return; }
    const upd = { subject: $("#mtSubject").value, html: $("#mtHtml").value, to_extra: to_extra || null, cc: cc || null, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("mail_templates").update(upd).eq("key", tplKey);
    if (error) { toast("บันทึกไม่สำเร็จ: " + error.message, "error"); return; }
    Object.assign(mailTpl.find(x => x.key === tplKey), upd); toast("บันทึกแบบอีเมลแล้ว", "success");
  };
  $("#mlSave").onclick = async () => {
    const upd = { mode: pg.querySelector('input[name="mlMode"]:checked')?.value || "outlook", tenant_id: $("#mlTenant").value.trim() || null,
                  client_id: $("#mlClient").value.trim() || null, sender: $("#mlSender").value.trim() || null, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("mail_settings").update(upd).eq("id", 1);
    if (error) { toast("บันทึกไม่สำเร็จ: " + error.message, "error"); return; }
    const secret = $("#mlSecret").value.trim();
    if (secret) {
      const r = await supabase.rpc("mail_set_secret", { p_secret: secret });
      if (r.error) { toast("บันทึก Client Secret ไม่สำเร็จ: " + r.error.message, "error"); return; }
      upd.has_secret = true;
    }
    Object.assign(mailCfg, upd); toast("บันทึกการตั้งค่าอีเมลแล้ว", "success"); draw();
  };
  $("#mlTest").onclick = async e => {
    e.target.disabled = true; e.target.textContent = "กำลังส่ง…";
    try {
      const { data, error } = await supabase.functions.invoke("letter-notify", { body: { action: "test" } });
      if (error) throw error;
      if (data?.sent) toast(`ส่งเมลทดสอบถึง ${data.to} แล้ว — ตรวจกล่องจดหมาย`, "success");
      else toast(`ส่งไม่สำเร็จ: ${{ not_configured: "ยังกรอกค่าไม่ครบ", auth_error: "Tenant/Client ID/Secret ไม่ถูกต้อง", graph_error: "อีเมลผู้ส่งไม่ถูกต้อง หรือแอปไม่มีสิทธิ์ Mail.Send" }[data?.reason] || data?.reason}${data?.detail ? ` (${String(data.detail).slice(0, 120)})` : ""}`, "error");
    } catch (err) { toast("เรียกฟังก์ชันส่งเมลไม่ได้ — ต้อง deploy letter-notify ใน Supabase ก่อน", "error"); }
    e.target.disabled = false; e.target.textContent = "ทดสอบส่งเมล (ถึงตัวเอง)";
  };
}

function wireSettings() {
  const pg = document.getElementById("pageLetters"), $ = s => pg.querySelector(s);
  $("#sgFile")?.addEventListener("change", e => { const f = e.target.files[0]; if (f) $("#sgPrev").innerHTML = `<img src="${URL.createObjectURL(f)}" style="height:60px;margin:6px 0;background:#fff;border:1px dashed var(--border2);border-radius:8px;padding:4px;">`; });
  $("#sgSave")?.addEventListener("click", async () => {
    const me = signers.find(s => s.user_id === currentUser.id) || {};
    let path = me.signature_path; const file = $("#sgFile").files[0];
    if (file) {
      path = `signatures/${currentUser.id}/signature.png`;
      const { error } = await supabase.storage.from("letter-assets").upload(path, file, { upsert: true, contentType: "image/png" });
      if (error) { toast("อัปโหลดลายเซ็นไม่สำเร็จ: " + error.message, "error"); return; }
    }
    const row = { user_id: currentUser.id, name_th: $("#sgNameTh").value.trim(), title_th: $("#sgTitleTh").value.trim(),
      name_en: $("#sgNameEn").value.trim(), title_en: $("#sgTitleEn").value.trim(), email: $("#sgEmail").value.trim(), signature_path: path || null };
    const { data, error } = await supabase.from("letter_signers").upsert(row).select().single();
    if (error) { toast("บันทึกไม่สำเร็จ: " + error.message, "error"); return; }
    signers = [...signers.filter(s => s.user_id !== currentUser.id), data]; toast("บันทึกลายเซ็นแล้ว", "success"); draw();
  });
  $("#slSave")?.addEventListener("click", async () => {
    const upd = { hr_contact_email: $("#slMail").value.trim() || null }, file = $("#slFile").files[0];
    if (file) {
      const { error } = await supabase.storage.from("letter-assets").upload("seal/seal.png", file, { upsert: true, contentType: "image/png" });
      if (error) { toast("อัปโหลดตราไม่สำเร็จ: " + error.message, "error"); return; }
      upd.seal_path = "seal/seal.png";
    }
    const { error } = await supabase.from("letter_settings").update(upd).eq("id", 1);
    if (error) { toast("บันทึกไม่สำเร็จ: " + error.message, "error"); return; }
    Object.assign(settings, upd); toast("บันทึกแล้ว", "success"); draw();
  });
  $("#inAdd")?.addEventListener("click", async () => {
    const th = $("#inTh").value.trim(), en = $("#inEn").value.trim(); if (!th || !en) { toast("ใส่ชื่อทั้งไทยและอังกฤษ", "error"); return; }
    const key = "i" + Date.now().toString(36);
    const { data, error } = await supabase.from("letter_income_items").insert({ key, label_th: th, label_en: en, sort_order: 50 + incomeItems.length }).select().single();
    if (error) { toast("เพิ่มไม่สำเร็จ: " + error.message, "error"); return; }
    incomeItems.push(data); draw();
  });
  $("#inSave")?.addEventListener("click", async () => {
    for (const i of incomeItems) {
      const upd = { label_th: pg.querySelector(`[data-ith="${i.key}"]`).value.trim(), label_en: pg.querySelector(`[data-ien="${i.key}"]`).value.trim(),
                    is_active: pg.querySelector(`[data-iact="${i.key}"]`).checked };
      if (upd.label_th === i.label_th && upd.label_en === i.label_en && upd.is_active === i.is_active) continue;
      const { error } = await supabase.from("letter_income_items").update(upd).eq("key", i.key);
      if (error) { toast("บันทึกไม่สำเร็จ: " + error.message, "error"); return; }
      Object.assign(i, upd);
    }
    toast("บันทึกแล้ว", "success");
  });
}
