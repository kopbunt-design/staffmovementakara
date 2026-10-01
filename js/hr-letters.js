import { supabase } from "./supabase-config.js";
import { allEmployees, can, esc as escText, toast, currentUser, notify } from "./app.js";
import { bahtText } from "./contract-docs.js";

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
const FOOT = `<div class="lt-foot"><div>บริษัท อัครา รีซอร์สเซส จำกัด (มหาชน) เลขที่ 99 ม.9 ต.เขาเจ็ดลูก อ.ทับคล้อ จ.พิจิตร 66230</div>
  <div>Akara Resources Public Company Limited No.99 Moo 9, Khao Chet Luk, Thap Khlo, Phichit 66230</div>
  <div>Tel +66 5661 4500 www.akararesources.com</div></div>`;
const head = logo => `<div class="lt-head"><img src="${logo}" alt="AKARA RESOURCES"><span>Chatree Gold Mine</span></div>`;

// signer: { name_th, title_th, name_en, title_en } · art: { signature, seal } (data URL) — ไม่มี = ยังไม่อนุมัติ
function sign(lang, signer, art, offer) {
  const sig = art?.signature ? `<img class="lt-sig" src="${art.signature}" alt="">` : `<div class="lt-sig-gap"></div>`;
  const seal = art?.seal ? `<img class="lt-seal" src="${art.seal}" alt="">` : "";
  if (offer) return `<div class="lt-sign">${seal}<div>Yours sincerely,</div>${sig}
    <div>(${esc(signer?.name_en || "Mr. Suphachoke Phanthumitr")})</div><div>On behalf of Akara Resources Public Company Limited.</div></div>`;
  return lang === "th"
    ? `<div class="lt-sign th">${seal}${sig}<div>${esc(signer?.name_th || "นายศุภโชค พันธุมิตร")}</div><div>${esc(signer?.title_th || "ผู้จัดการฝ่ายทรัพยากรบุคคล")}</div></div>`
    : `<div class="lt-sign">${seal}<div>Yours sincerely,</div>${sig}<div>${esc(signer?.name_en || "Mr. Suphachoke Phanthumitr")}</div><div>${esc(signer?.title_en || "Human Resources Manager")}</div></div>`;
}

const incomeTH = l => `${money(l.amount)} (${bahtText(l.amount)})`;
const incomeEN = l => `THB ${money(l.amount)} per month`;

export function letterPages(kind, d, opts = {}) {
  const { docNo = "", logo = "assets/logo.png", signer = null, art = null, draft = true } = opts;
  const K = KINDS[kind]; if (!K) return "";
  const wm = draft ? `<div class="lt-wm">${K.lang === "th" ? "ร่าง · รออนุมัติ" : "DRAFT"}</div>` : "";
  const no = docNo || (K.lang === "th" ? "HR-___-____" : "HR-___-____");
  const inc = (d.incomes || []).filter(x => x && x.on !== false && Number(x.amount) > 0);

  if (kind === "cert_th" || kind === "salary_th") {
    const rows = [["ชื่อ - นามสกุล", d.name_th], ["เลขบัตรประชาชน", d.id_card], ["ตำแหน่ง", d.position_th], ["ฝ่าย", d.division_th],
      ["แผนก", d.department_th], ["ระยะเวลาการปฏิบัติงาน", `${thDate(d.period_from)} ถึง${d.period_to ? ` ${thDate(d.period_to)}` : "ปัจจุบัน"}`],
      ...inc.map(l => [l.label_th, incomeTH(l)])].filter(([, v]) => String(v ?? "").trim());
    return `<section class="lt-page th">${wm}${head(logo)}
      <div class="lt-no">${esc(no)}</div><h1 class="lt-h-th">${esc(K.title)}</h1>
      <p class="lt-intro">หนังสือรับรองฉบับนี้โดย บริษัท อัครา รีซอร์สเซส จำกัด (มหาชน) ออกให้เพื่อเป็นการรับรองรายละเอียดต่อไปนี้</p>
      <table class="lt-kv th">${rows.map(([k, v]) => `<tr><th>${esc(k)}:</th><td>${esc(v)}</td></tr>`).join("")}</table>
      <p class="lt-close">จึงออกหนังสือรับรองฉบับนี้ไว้เพื่อเป็นหลักฐาน</p>
      <div class="lt-date-th">ออกให้ ณ วันที่ ${esc(thDate(d.issue_date))}</div>
      ${sign("th", signer, art)}
      <div class="lt-remark"><b>หมายเหตุ:</b> เอกสารฉบับนี้จัดทำและออกในรูปแบบอิเล็กทรอนิกส์ จึงไม่จำเป็นต้องมีลายมือชื่อผู้มีอำนาจลงนามกำกับ</div>
      ${FOOT}</section>`;
  }
  if (kind === "cert_en" || kind === "salary_en") {
    const rows = [["Position", d.position], ["Division", d.division], ["Department", d.department], ["Section", d.section],
      ["Period of Employment", `${enDate(d.period_from)} - ${d.period_to ? enDate(d.period_to) : "Present"}`],
      ...inc.map(l => [l.label_en, incomeEN(l)])].filter(([, v]) => String(v ?? "").trim());
    return `<section class="lt-page en">${wm}${head(logo)}
      <div class="lt-ref">Ref. No. ${esc(no)}<br>Date&nbsp;&nbsp; ${esc(enDate(d.issue_date))}</div>
      <h1 class="lt-h-en">${esc(K.title)}</h1><h2 class="lt-twimc">TO WHOM IT MAY CONCERN</h2>
      <p>This is to certify that <b>${esc(d.name_en)}</b>${d.id_card ? `(National ID No.: ${esc(d.id_card)})` : ""} is employed by
        <b>Akara Resources Public Company Limited</b>, a subsidiary of <b>Kingsgate Consolidated Limited, Australia</b>.</p>
      <p>The employment details are as follows:</p>
      <table class="lt-kv en">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>
      <p>This certificate has been issued at the employee's request for official purposes.</p>
      ${sign("en", signer, art)}
      <div class="lt-remark"><b>Remark</b> - This document is digitally issued and does not require a handwritten signature.</div>
      ${FOOT}</section>`;
  }
  // Offer Letter — 2 หน้า (จดหมาย + Schedule 1)
  const sched = [["Position Title", d.position], ["Monthly Base Salary", d.salary ? `THB ${money(d.salary)} per month` : ""],
    ["Commencement Date", d.commencement ? `${enDate(d.commencement)}, or as otherwise agreed between the parties` : ""],
    ["Probation Period", d.probation_days ? `${d.probation_days} days` : ""], ...(d.schedule || [])]
    .filter(([k, v]) => String(k || "").trim() && String(v ?? "").trim());
  const nm = `${d.title_en ? d.title_en + " " : ""}${d.name_en || ""}`.trim();
  return `<section class="lt-page en offer">${wm}${head(logo)}
    <div class="lt-row"><span>${esc(no)}</span><span>${esc(usDate(d.issue_date))}</span></div>
    <h1 class="lt-h-offer">Offer of Employment</h1>
    <p>Dear ${esc(nm)},</p>
    <p>Akara Resources Public Company Limited is pleased to offer you the position of <b>${esc(d.position)}.</b></p>
    <p class="j">Your salary, benefits, and leave entitlements are outlined in Schedule 1 and are subject to applicable laws and the Company's policies and regulations, as amended from time to time.</p>
    <p class="j">Please note that this offer is conditional upon the satisfactory completion of pre-employment requirements, including a medical examination and background verification. Should the results of the medical examination or background verification be deemed unsatisfactory, the Company reserves the right to withdraw this offer of employment.</p>
    <p class="j">We are confident that you will find this opportunity both challenging and rewarding, and we are delighted to welcome you to Akara Resources Public Company Limited.</p>
    <p class="j">To indicate your acceptance of this offer, please sign below and return a scanned copy to Akara's HR team at <span class="lt-mail">${esc(d.contact_email || "")}</span>.</p>
    <p>We look forward to working with you and achieving success together.</p>
    ${sign("en", signer, art, true)}
    <div class="lt-stars">*********************</div>
    <p>I acknowledge and accept the terms and conditions of this Offer of Employment.</p>
    <div class="lt-accept"><div>Signed: ____________________________</div><div>${esc(nm)}</div><div>Date: __________________________</div></div>
    ${FOOT}</section>
  <section class="lt-page en offer">${wm}${head(logo)}
    <h2 class="lt-sched-h">Schedule 1: Salary, Benefits and Leave Entitlements</h2>
    <table class="lt-sched">${sched.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
    <p class="j">All benefits and leave entitlements are subject to the Company's Work Rules and Regulations and Welfare and Benefits Regulations, as amended from time to time.</p>
    ${art?.signature ? `<img class="lt-initial" src="${art.signature}" alt="">` : ""}
    ${FOOT}</section>`;
}

export const LETTER_CSS = `
@page{size:A4;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
body{background:#e9edf3}
.lt-page{position:relative;width:210mm;height:297mm;overflow:hidden;background:#fff;margin:0 auto 8mm;padding:14mm 20mm 34mm;color:#111;page-break-after:always}
.lt-page:last-child{page-break-after:auto}
.lt-page.th{font-family:'Sarabun',sans-serif;font-size:15px;line-height:1.75}
.lt-page.en{font-family:Arial,Helvetica,sans-serif;font-size:13.2px;line-height:1.55}
.lt-head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #2160C4;padding-bottom:3px;margin:0 -6mm 9mm}
.lt-head img{height:16mm}.lt-head span{font-family:'Sarabun',sans-serif;font-size:12.5px;color:#555}
.lt-no{font-size:14px;margin-bottom:6mm}
.lt-h-th{text-align:center;font-size:20px;font-weight:700;margin-bottom:6mm}
.lt-intro{margin-bottom:6mm;text-align:center;white-space:nowrap;font-size:14.4px}
.lt-kv{border-collapse:collapse;margin:0 0 6mm 10mm}
.lt-kv.th th{text-align:left;font-weight:700;padding:3px 30px 3px 0;white-space:nowrap;vertical-align:top}
.lt-kv.th td{padding:3px 0}
.lt-kv.en{margin:2mm 0 6mm}.lt-kv.en th{text-align:left;font-weight:700;padding:3px 40px 3px 0;white-space:nowrap;vertical-align:top}
.lt-close{margin:2mm 0 14mm 0}
.lt-date-th{text-align:center;margin-left:40%;margin-bottom:2mm}
.lt-sign{position:relative;margin-top:4mm}
.lt-sign.th{text-align:center;margin-left:40%}
.lt-sig{height:17mm;display:block;margin:2mm 0 1mm}.lt-sign.th .lt-sig{margin:2mm auto 1mm}
.lt-sig-gap{height:20mm}
.lt-seal{position:absolute;height:34mm;opacity:.9;left:62mm;top:-4mm}
.lt-sign.th .lt-seal{left:auto;right:-6mm;top:-2mm}
.lt-remark{position:absolute;left:20mm;right:20mm;bottom:40mm;font-size:12.5px}
.lt-ref{margin-bottom:8mm}
.lt-h-en{font-size:22px;font-weight:700;color:#333;margin-bottom:4mm}
.lt-twimc{font-size:15px;font-weight:700;margin-bottom:4mm}
.lt-page.en p{margin-bottom:4mm}.lt-page .j{text-align:justify}
.lt-row{display:flex;justify-content:space-between;margin-bottom:8mm;font-size:14px}
.lt-h-offer{text-align:center;font-size:19px;font-weight:700;margin-bottom:7mm}
.lt-mail{color:#2160C4}
.lt-stars{margin:6mm 0 4mm}
.lt-accept div{margin-top:7mm}
.lt-sched-h{font-size:16px;font-weight:700;margin:2mm 0 7mm}
.lt-sched{border-collapse:collapse;width:100%;font-size:12px;line-height:1.4;margin-bottom:7mm}
.lt-sched td{border:1px solid #333;padding:7px 8px;vertical-align:middle}
.lt-sched td:first-child{width:34%}
.lt-initial{position:absolute;right:8mm;bottom:4mm;height:8mm}
.lt-foot{position:absolute;left:14mm;right:14mm;bottom:9mm;border-top:3px solid #2160C4;padding-top:3mm;text-align:center;font-family:'Sarabun',sans-serif;font-size:11px;line-height:1.7;color:#222}
.lt-wm{position:absolute;inset:0;display:grid;place-items:center;font:700 88px 'Sarabun',sans-serif;color:rgba(192,57,43,.09);transform:rotate(-28deg);pointer-events:none;z-index:5}
@media print{body{background:#fff}.lt-page{margin:0}}
`;

export function letterDocument(kind, d, opts) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(opts?.docNo || KINDS[kind]?.label || "")}</title>
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
    <style>${LETTER_CSS}</style></head><body>${letterPages(kind, d, opts)}</body></html>`;
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

// ---------------------------------------------------------------- state
let letters = [], incomeItems = [], signers = [], settings = {}, tab = "mine", search = "";

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
  if (!canWrite() && canApprove()) tab = "approve";
  draw();
  // เปิดจากลิงก์ในเมล (?letter=ID)
  const deep = +new URLSearchParams(location.search).get("letter");
  if (deep) { history.replaceState(null, "", location.pathname); const x = letters.find(r => r.id === deep); if (x) openLetter(x); }
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
      <td>${badge(r.status)}${r.status === "rejected" && r.reject_reason ? `<div style="font-size:11.5px;color:var(--red);">${esc(r.reject_reason)}</div>` : ""}</td>
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
  if (tab === "settings") wireSettings();
}

// ---------------------------------------------------------------- ลายเซ็น/ตรา (private storage → data URL)
async function assetData(path) {
  if (!path) return "";
  const { data, error } = await supabase.storage.from("letter-assets").download(path);
  if (error || !data) return "";
  return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(data); });
}
let logoData = "";
async function logo() {
  if (logoData) return logoData;
  try { const b = await (await fetch("assets/logo.png")).blob(); logoData = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); }
  catch { logoData = new URL("assets/logo.png", location.href).href; }
  return logoData;
}
async function optsFor(r) {
  const approved = r.status === "approved" && r.signer;
  return { docNo: r.doc_no || "", logo: await logo(), draft: !approved, signer: approved ? r.signer : null,
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
    const o = r ? await optsFor({ ...r, data: d }) : { docNo: "", logo: await logo(), draft: true };
    if (my !== rendering) return;
    const fr = $("#ltFrame");
    // ความสูงกรอบตามจำนวนหน้า (Offer Letter 2 หน้า) — ไม่มีแถบเลื่อนซ้อนในกรอบ
    fr.onload = () => { const h = fr.contentDocument?.documentElement.scrollHeight || 1123;
      fr.style.height = h + "px"; fr.style.marginBottom = `${-Math.round(h * 0.28)}px`; };
    fr.srcdoc = letterDocument(kind, d, o);
  };

  const f = (key, label, type = "text", extra = "") => `<label class="lt-f"><span>${label}</span>
    <input class="form-control" data-k="${key}" type="${type}" value="${esc(d[key] ?? "")}" ${editable ? "" : "disabled"} ${extra}></label>`;
  const form = () => {
    const K = KINDS[kind], th = K.lang === "th", offer = kind === "offer_en";
    $("#ltForm").innerHTML = `
      ${editable ? `<label class="lt-f"><span>ประเภทหนังสือ</span><select class="form-control" id="ltKind">${Object.entries(KINDS).map(([k, v]) =>
        `<option value="${k}" ${k === kind ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select></label>
      <label class="lt-f"><span>ดึงข้อมูลจากทะเบียนพนักงาน</span><input class="form-control" id="ltEmp" list="ltEmpList" placeholder="พิมพ์รหัสหรือชื่อ" autocomplete="off">
        <datalist id="ltEmpList">${allEmployees.filter(e => e.emp_code).map(e => `<option value="${esc(e.emp_code)} · ${esc(empName(e))}"></option>`).join("")}</datalist></label>
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
    $("#ltEmp")?.addEventListener("change", e => {
      const code = e.target.value.split("·")[0].trim(), emp = allEmployees.find(x => x.emp_code === code);
      if (!emp) return;
      const issue = d.issue_date, email = d.contact_email; d = draftFrom(kind, emp, incomeItems); d.emp_code = emp.emp_code;
      d.issue_date = issue || d.issue_date; d.contact_email = email || settings.hr_contact_email || "";
      form(); preview();
    });
    el.querySelectorAll("[data-k]").forEach(i => i.oninput = () => { d[i.dataset.k] = i.value; preview(); });
    el.querySelectorAll("[data-ion]").forEach(i => i.onchange = () => { d.incomes[+i.dataset.ion].on = i.checked; preview(); });
    el.querySelectorAll("[data-iam]").forEach(i => i.oninput = () => { d.incomes[+i.dataset.iam].amount = i.value; preview(); });
    el.querySelectorAll("[data-s]").forEach(i => i.oninput = () => { const [a, b] = i.dataset.s.split("."); d.schedule[+a][+b] = i.value; preview(); });
    el.querySelectorAll("[data-sdel]").forEach(b => b.onclick = () => { d.schedule.splice(+b.dataset.sdel, 1); form(); preview(); });
    $("#ltSAdd")?.addEventListener("click", () => { d.schedule.push(["", ""]); form(); preview(); });
  };

  const personOf = () => KINDS[kind].lang === "th" ? d.name_th : `${kind === "offer_en" && d.title_en ? d.title_en + " " : ""}${d.name_en || ""}`.trim();
  const save = async () => {
    const row = { kind, data: d, emp_code: d.emp_code || null, person_name: personOf() || null };
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
  const sendMail = async (row, action) => {
    try {
      const { data, error } = await supabase.functions.invoke("letter-notify", { body: { letter_id: row.id, action } });
      if (error) throw error;
      return data?.sent ? `ส่งอีเมลถึง ${data.to} แล้ว` : "แจ้งในระบบแล้ว (อีเมลอัตโนมัติยังไม่ได้ตั้งค่า)";
    } catch { return "แจ้งในระบบแล้ว (ส่งอีเมลไม่สำเร็จ)"; }
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
    $("[data-cancel]")?.addEventListener("click", async () => {
      if (!confirm(`ยกเลิกหนังสือ${r.doc_no ? ` ${r.doc_no}` : ""}? ${r.doc_no ? "เลขที่นี้จะถูกยกเลิกในทะเบียนด้วย ไม่นำกลับมาใช้" : ""}`)) return;
      const { error } = await supabase.from("hr_letters").update({ status: "cancelled" }).eq("id", r.id);
      if (error) { toast("ยกเลิกไม่สำเร็จ: " + error.message, "error"); return; }
      if (r.doc_id) await supabase.from("doc_register").update({ status: "void", void_reason: "ยกเลิกหนังสือในระบบออกหนังสือ",
        voided_at: new Date().toISOString(), voided_by: currentUser?.id || null }).eq("id", r.doc_id);
      r.status = "cancelled"; toast("ยกเลิกแล้ว", "success"); close(); draw();
    });
  };
  form(); foot(); preview();
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
    </div></div>` : ""}</div>`;
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
