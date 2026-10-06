// ============================================================================
// พิมพ์แบบฟอร์มกองทุนจากข้อมูลที่พนักงานกรอก — หน้าตาตามฟอร์มกระดาษเดิม
//   pvd → AKR-OHR-FM-020 Rev.01 (กองทุนสำรองเลี้ยงชีพ เค มาสเตอร์ พูล ฟันด์)
//   wef → แบบ สกล.๕ (กองทุนสงเคราะห์ลูกจ้าง กรณีลูกจ้างตาย)
//
// ใช้ร่วมกัน 2 ที่: หน้าพนักงาน (fund.html) และหน้า HR (fund-forms.js)
// ⚠️ ถ้าบริษัทออก Rev ใหม่ของฟอร์ม ให้แก้ข้อความ/เลขฟอร์มในไฟล์นี้ที่เดียว
// ============================================================================

export const PVD_REQUESTS = [
  { key: "apply",       label: "ขอสมัครเข้าเป็นสมาชิกกองทุนสำรองเลี้ยงชีพ", parts: "ส่วนที่ 1 ถึง ส่วนที่ 4" },
  { key: "beneficiary", label: "เปลี่ยนแปลงผู้รับผลประโยชน์",                parts: "ส่วนที่ 2" },
  { key: "rate",        label: "เปลี่ยนแปลงอัตราการนำส่งเงินสะสม",           parts: "ส่วนที่ 3" },
  // ข้อ 4 ยังพิมพ์อยู่ในฟอร์ม (ฟอร์มกระดาษมี 4 ข้อ) แต่พนักงานเลือกในเว็บไม่ได้ — ทำเองในแอปของบริษัทจัดการ
  { key: "policy",      label: "เปลี่ยนแปลงนโยบายการลงทุน",                  parts: "ส่วนที่ 4",
    selfService: "สมาชิกเปลี่ยนนโยบายการลงทุนได้ด้วยตนเองผ่านแอปพลิเคชันของบริษัทจัดการกองทุน" },
];
export const PVD_POLICIES = [
  { key: "PF1103", label: "ตราสารหนี้ระยะสั้นภาครัฐ สถาบันการเงิน", risk: "ความเสี่ยงต่ำ" },
  { key: "PF4103", label: "ผสมหุ้นไม่เกิน 25%",                    risk: "ความเสี่ยงปานกลาง" },
  { key: "PF6103", label: "ตราสารทุน",                            risk: "ความเสี่ยงสูง" },
  { key: "PFM103", label: "หน่วยลงทุน กองทุนเปิดเค เวลธ์พลัส บาลานซ์", risk: "ลงทุนผ่านกองทุนรวมแบบผสม" },
  // แผน DIY: สมาชิกกำหนดสัดส่วนเอง 0–100% ในแอปของบริษัทจัดการ ฟอร์มนี้แค่แจ้งว่าเลือกแผนนี้
  { key: "PF2103", label: "ตราสารหนี้ แผน DIY", risk: "กำหนดสัดส่วนการลงทุนเองได้ 0–100%",
    note: "จัดสัดส่วนการลงทุนด้วยตนเองผ่านแอปพลิเคชัน" },
];
// เงินสมทบของบริษัท (ระเบียบข้อ 14.2.2): เท่ากับเงินสะสมของพนักงาน แต่ไม่เกินเพดานตามอายุงาน
// เรียงจากอายุงานน้อยไปมาก — ถ้าระเบียบเปลี่ยน แก้ตารางนี้ที่เดียว
export const PVD_MATCH = [
  { fromYears: 0,  cap: 5,  label: "พ้นทดลองงาน แต่อายุงานไม่ถึง 3 ปี" },
  { fromYears: 3,  cap: 7,  label: "อายุงานตั้งแต่ 3 ปี แต่ไม่ถึง 6 ปี" },
  { fromYears: 6,  cap: 10, label: "อายุงานตั้งแต่ 6 ปี แต่ไม่ถึง 10 ปี" },
  { fromYears: 10, cap: 12, label: "อายุงานตั้งแต่ 10 ปีขึ้นไป" },
];
// อายุงานเต็มปี ณ วันที่กำหนด (ไม่ปัดขึ้น — ครบ 3 ปีวันไหนก็ขยับขั้นวันนั้น)
export function serviceYears(joinDate, at = new Date()) {
  if (!joinDate) return null;
  const j = new Date(joinDate); if (isNaN(j)) return null;
  let y = at.getFullYear() - j.getFullYear();
  if (at.getMonth() < j.getMonth() || (at.getMonth() === j.getMonth() && at.getDate() < j.getDate())) y--;
  return Math.max(0, y);
}
export const matchTier = years => years == null ? null : [...PVD_MATCH].reverse().find(t => years >= t.fromYears);
export const employerMatch = (rate, years) => { const t = matchTier(years); return t && rate ? Math.min(+rate, t.cap) : null; };

export const FORM_NAME = { pvd: "กองทุนสำรองเลี้ยงชีพ", wef: "กองทุนสงเคราะห์ลูกจ้าง (สกล.5)" };

const TH_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                   "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const TH_DIGITS = "๐๑๒๓๔๕๖๗๘๙";
const thNum = v => String(v).replace(/[0-9]/g, d => TH_DIGITS[d]);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

// โหลดโลโก้เป็น data URL ไว้ก่อน — หน้าต่างพิมพ์จะได้ไม่ต้องรอโหลดรูปเอง (บางเบราว์เซอร์สั่งพิมพ์ก่อนรูปมา)
let LOGO_DATA = "";
fetch("assets/logo.png").then(r => r.ok ? r.blob() : null).then(b => {
  if (!b) return; const fr = new FileReader(); fr.onload = () => { LOGO_DATA = fr.result; }; fr.readAsDataURL(b);
}).catch(() => {});

export function thaiDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  return { d: d.getDate(), m: TH_MONTHS[d.getMonth()], y: d.getFullYear() + 543 };
}

// ช่องเส้นจุด: ถ้ามีค่าแสดงค่า ถ้าไม่มีเว้นเส้นไว้ให้เขียนมือ
const fill = (v, w) => `<span class="f" style="min-width:${w}">${esc(v) || "&nbsp;"}</span>`;
const box  = on => `<span class="bx">${on ? "✓" : ""}</span>`;

// ลายเซ็นที่พนักงานเซ็นบนหน้าจอ (ถ้ามี) — รับเฉพาะ PNG data URL กันของแปลกปลอมมาอยู่ใน src
const sigOf = p => /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(p?.signature || "") ? p.signature : "";

// ช่องลงชื่อ: เส้น / ชื่อในวงเล็บ / วันที่ อยู่ในคอลัมน์เดียวกัน ชื่อจึงอยู่กึ่งกลางเส้นพอดี
// (เดิมจัดกลางทั้งกล่อง ชื่อเลยเยื้องจากเส้นเพราะคำว่า "ลงชื่อ" กับ "พนักงาน" ยาวไม่เท่ากัน)
function sigBlock({ role, name = "", sig = "", date, w = "58mm" }) {
  return `<div class="sg" style="grid-template-columns:auto ${w} auto">
    <span>ลงชื่อ</span><span class="sg-l">${sig ? `<img src="${sig}" alt="">` : ""}</span><span>${role}</span>
    <span></span><span class="sg-n">${name ? `( ${esc(name)} )` : `(<i class="sg-b"></i>)`}</span><span></span>
    ${date === undefined ? "" : `<span>วันที่</span><span class="sg-l sg-d">${esc(date)}</span><span></span>`}
  </div>`;
}

// ช่องคณะกรรมการ: อนุมัติออนไลน์แล้ว (schema_fund_approval.sql) → ลายเซ็น ชื่อ ตำแหน่ง วันที่
// sig = data URL ของลายเซ็น (หน้า HR โหลดจาก storage ให้) · หน้าพนักงานไม่มีสิทธิ์อ่านรูป จึงแสดงชื่อ+วันที่อย่างเดียว
function committeeBox(sub, sig) {
  const c = sub.status === "approved" || sub.status === "sent" ? sub.committee : null;
  if (!c) return `<div class="committee"><div>คณะกรรมการกองทุนลงนามอนุมัติ</div><div class="gap"></div>
        <div>.........................................................................</div><div>วันที่......................................</div></div>`;
  const d = thaiDate(sub.approved_at), okSig = /^data:image\/(png|jpeg);base64,/.test(sig || "") ? sig : "";
  return `<div class="committee on"><div>คณะกรรมการกองทุนลงนามอนุมัติ</div>
    <div class="cm-sig">${okSig ? `<img src="${okSig}" alt="">` : ""}</div>
    <div class="cm-name">( ${esc(c.name_th || "")} )</div>${c.title_th ? `<div class="cm-title">${esc(c.title_th)}</div>` : ""}
    <div>วันที่ <span class="cm-date">${d.d} ${d.m} ${d.y}</span></div></div>`;
}

// ------------------------------------------------------------------- PVD
function pvdPage(sub, opts = {}) {
  const p = sub.payload || {}, req = new Set(p.requests || []);
  const showB = req.has("apply") || req.has("beneficiary");
  const showR = req.has("apply") || req.has("rate");
  const showP = req.has("apply") || req.has("policy");
  const ben = showB ? (p.beneficiaries || []) : [];
  const logo = LOGO_DATA || `${location.origin}/assets/logo.png`;
  return `<section class="page pvd">
    <div class="pvd-top"><img src="${logo}" alt="AKARA RESOURCES"><div class="pvd-site">Chatree Gold Mine</div></div>
    <h1>กองทุนสำรองเลี้ยงชีพ เค มาสเตอร์ พูล ฟันด์ ซึ่งจดทะเบียนแล้ว<br>ในส่วนของบริษัท อัครา รีซอร์สเซส จำกัด (มหาชน)</h1>
    <p>เรียน&nbsp;&nbsp;&nbsp;คณะกรรมการกองทุน</p>
    <p class="ind">ข้าพเจ้า ${fill(sub.emp_name, "46%")} รหัสพนักงาน ${fill(sub.emp_code, "20%")}</p>
    <p>สังกัดฝ่าย/แผนก ${fill(sub.department, "38%")} ขอแจ้งเรื่องเพื่อให้คณะกรรมการกองทุนพิจารณาดังนี้</p>
    <p class="ind">โปรดทำเครื่อง ✓ สำหรับเรื่องที่เสนอเพื่อพิจารณา</p>
    ${PVD_REQUESTS.map((r, i) => `<p class="ind">${box(req.has(r.key))} ${i + 1}. ${r.label} (${r.parts})</p>`).join("")}

    <p class="mt"><b><u>ส่วนที่ 1</u></b> การสมัครเข้าเป็นสมาชิกกองทุนเป็นไปโดยความสมัครใจ และข้าพเจ้าขอรับรองว่าได้อ่าน ทราบ และเข้าใจข้อกำหนดและเงื่อนไขของกองทุนโดยครบถ้วนแล้ว ข้าพเจ้าตกลงและยินยอมให้บริษัท อัครา รีซอร์สเซส จำกัด (มหาชน) ซึ่งเป็นนายจ้าง หักเงินสะสมจากเงินได้รายเดือนของข้าพเจ้า เพื่อนำส่งเข้ากองทุนตามข้อบังคับของกองทุน และ/หรือการเปลี่ยนแปลงใด ๆ ที่อาจมีขึ้นในอนาคต</p>

    <p class="mt"><b><u>ส่วนที่ 2</u></b> การแต่งตั้งผู้รับผลประโยชน์ และ / หรือ การเปลี่ยนแปลงผู้รับผลประโยชน์</p>
    <p>ในกรณีที่ข้าพเจ้าถึงแก่กรรม ข้าพเจ้าขอแต่งตั้งให้คณะกรรมการกองทุนจ่ายเงินผลประโยชน์ใด ๆ ที่ข้าพเจ้าพึงได้รับให้แก่ผู้รับผลประโยชน์ ดังต่อไปนี้</p>
    ${[0, 1, 2].map(i => { const b = ben[i] || {}; return `<p class="ind2">${i + 1}.&nbsp; ชื่อ-นามสกุล ${fill(b.name, "34%")} ความสัมพันธ์ ${fill(b.relation, "13%")} ร้อยละ ${fill(b.percent, "7%")}</p>`; }).join("")}

    <p class="mt"><b><u>ส่วนที่ 3</u></b> การยินยอมให้หักเงินสะสม / การแจ้งการเปลี่ยนแปลงอัตราการนำส่งเงินสะสม</p>
    <p>ข้าพเจ้ายินยอมให้บริษัทหักเงินจากเงินได้รายเดือนของข้าพเจ้า เพื่อนำส่งเข้ากองทุนสะสม โดยสามารถเลือกอัตราการหักเงินได้ตั้งแต่ ร้อยละ 2 ถึงร้อยละ 15 ของเงินเดือน ทั้งนี้ การสมทบเงินของบริษัทให้เป็นไปตามระเบียบของกองทุนที่กำหนด ดังนั้น ข้าพเจ้ายินยอมให้บริษัทหักเงินสะสมในอัตรา ร้อยละ ${fill(showR ? p.rate : "", "9%")} ของเงินเดือน</p>

    <p class="mt"><b><u>ส่วนที่ 4</u></b> การเลือกนโยบายการลงทุน / การแจ้งเปลี่ยนแปลงนโยบายการลงทุน</p>
    <p>ข้าพเจ้ามีความประสงค์ให้นำเงินสะสม และเงินสมทบของข้าพเจ้าทั้งหมด ลงทุนในนโยบายการลงทุนดังนี้</p>
    ${PVD_POLICIES.map((x, i) => `<p class="ind">${box(showP && p.policy === x.key)} ${i + 1}. ${x.label} (${x.key})${x.note ? ` — ${x.note}` : ""}</p>`).join("")}

    <div class="pvd-sign">
      ${committeeBox(sub, opts.committeeSig)}
      <div class="sigs">
        ${sigBlock({ role: "พนักงาน", name: sub.emp_name, sig: sigOf(p),
                     date: sigOf(p) ? (d => `${d.d} ${d.m} ${d.y}`)(thaiDate(sub.submitted_at)) : "" })}
        <div class="gap"></div>
        ${sigBlock({ role: "พยาน", date: "" })}
      </div>
    </div>
    <div class="foot"><span>AKR-OHR-FM-020 Rev. 01</span><span>Effective Date:05-May-2026</span><span>Page 1 of 1</span></div>
    ${refLine(sub)}
  </section>`;
}

// ------------------------------------------------------------------- WEF
function wefPage(sub, list, startNo, pageNo, pageCount) {
  const p = sub.payload || {}, a = p.addr || {}, dt = thaiDate(sub.submitted_at);
  const idBoxes = s => `<span class="idb">${Array.from({ length: 13 }, (_, i) => `<i>${esc((s || "")[i] || "")}</i>`).join("")}</span>`;
  const total = (p.beneficiaries || []).length;
  return `<section class="page wef">
    <div class="wef-code">แบบ สกล.๕${pageCount > 1 ? ` <span class="pg">(แผ่นที่ ${thNum(pageNo)}/${thNum(pageCount)})</span>` : ""}</div>
    <div class="wef-rcv"><div>เลขที่คำขอ.................................</div><div>วันที่รับ.......................................</div><div>ผู้รับ............................................</div></div>
    <h2>แบบหนังสือกำหนดบุคคลผู้จะพึงได้รับเงินจากกองทุนสงเคราะห์ลูกจ้าง กรณีลูกจ้างตาย</h2>
    <p class="r">เขียนที่ ${fill(p.written_at, "46%")}</p>
    <p class="r">วันที่ ${fill(thNum(dt.d), "8%")} เดือน ${fill(dt.m, "20%")} พ.ศ. ${fill(thNum(dt.y), "10%")}</p>
    <p class="ind">ข้าพเจ้า ${fill([p.title, sub.emp_name].filter(Boolean).join(" "), "75%")}</p>
    <p>อายุ ${fill(p.age ? thNum(p.age) : "", "16%")} ปี สัญชาติ ${fill(p.nationality, "26%")} เป็นสมาชิกกองทุนสงเคราะห์ลูกจ้าง</p>
    <p class="idrow"><span>เลขประจำตัวประชาชน</span>${idBoxes(p.is_thai !== false ? p.id_card : "")}</p>
    <p class="idrow"><span>เลขหนังสือเดินทาง (สำหรับผู้ซึ่งไม่มีสัญชาติไทย)<br>หรือบัตรประจำตัวผู้ซึ่งไม่มีสัญชาติไทย</span>${p.is_thai === false ? fill(p.passport, "40%") : idBoxes("")}</p>
    <p>อยู่บ้านเลขที่ ${fill(a.no, "13%")} หมู่ที่ ${fill(a.moo, "6%")} ตรอก/ซอย ${fill(a.soi, "17%")} ถนน ${fill(a.road, "17%")}</p>
    <p>ตำบล/แขวง ${fill(a.subdistrict, "22%")} อำเภอ/เขต ${fill(a.district, "22%")} จังหวัด ${fill(a.province, "18%")}</p>
    <p>รหัสไปรษณีย์ ${fill(a.zip, "14%")} โทรศัพท์ ${fill(p.phone, "50%")}</p>
    <p>ขอแสดงเจตนาระบุตัวผู้รับประโยชน์ในเงินจากกองทุนสงเคราะห์ลูกจ้าง เมื่อข้าพเจ้าถึงแก่ความตาย ข้าพเจ้าประสงค์ให้จ่ายเงินดังกล่าวแก่บุคคล รวม ${fill(thNum(total), "10%")} คน ดังมีรายชื่อต่อไปนี้</p>
    ${[0, 1, 2, 3].map(i => { const b = list[i] || {}; const no = startNo + i; return `
      <div class="ben">
        <p class="ind">${thNum(no)}. ชื่อ-สกุล ${fill(b.name, "46%")} เกี่ยวข้องเป็น ${fill(b.relation, "20%")}</p>
        <p>เลขประจำตัวประชาชน (ต้องระบุ) ${fill(b.id_card, "62%")}</p>
        <p>ที่อยู่ปัจจุบัน/ที่ติดต่อ ${fill(b.address, "54%")} ให้ได้รับจำนวน ${fill(b.shares ? thNum(b.shares) : "", "8%")} ส่วน</p>
      </div>`; }).join("")}
    <div class="wef-sign">
      ${sigBlock({ role: "พยาน", w: "48mm" })}
      ${sigBlock({ role: "ผู้แสดงเจตนา", name: sub.emp_name, sig: sigOf(p), w: "48mm" })}
      ${sigBlock({ role: "พยาน", w: "48mm" })}
    </div>
    <div class="note"><b>หมายเหตุ :</b> ๑. กรณีไม่ได้กำหนดสัดส่วนไว้ให้ถือว่า ทุกคนมีสิทธิได้รับสัดส่วนที่เท่ากัน<br>
      <span class="ni">๒. ถ้าผู้รับประโยชน์คนใดถึงแก่ความตายไปก่อน ให้นำส่วนแบ่งของบุคคลนั้นจัดสรรให้แก่ผู้รับประโยชน์ที่ยังคงมีชีวิตอยู่ ตามสัดส่วนที่แต่ละคนจะได้รับ</span><br>
      <span class="ni">๓. กรณีมีบุคคลผู้รับประโยชน์มากกว่าที่ระบุไว้ให้จัดทำแบบเพิ่มเติม</span><br>
      <span class="ni">๔. หากมีการเปลี่ยนแปลงบุคคลผู้รับประโยชน์ให้จัดทำแบบหนังสือกำหนดบุคคลผู้จะพึงได้รับเงินจากกองทุนสงเคราะห์ลูกจ้าง กรณีลูกจ้างตาย ฉบับใหม่ และแจ้งให้กรมสวัสดิการและคุ้มครองแรงงานทราบทันที</span></div>
    ${refLine(sub)}
  </section>`;
}

const refLine = sub => sub.id
  ? `<div class="ref">อ้างอิงคำขอออนไลน์ #${sub.id} · ส่งเมื่อ ${new Date(sub.submitted_at).toLocaleString("th-TH")}</div>` : "";

export function formPagesHTML(sub, opts = {}) {
  if (sub.form_type === "pvd") return pvdPage(sub, opts);
  const all = sub.payload?.beneficiaries || [];
  const chunks = [];
  for (let i = 0; i < Math.max(all.length, 1); i += 4) chunks.push(all.slice(i, i + 4));
  return chunks.map((c, i) => wefPage(sub, c, i * 4 + 1, i + 1, chunks.length)).join("");
}

const PRINT_CSS = `
@page{size:A4;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Sarabun',sans-serif;color:#000;background:#eee}
.page{width:210mm;min-height:297mm;padding:14mm 18mm 12mm;background:#fff;margin:0 auto 8mm;position:relative;font-size:13px;line-height:1.62;page-break-after:always}
.page:last-child{page-break-after:auto}
p{margin:0}.ind{padding-left:10mm}.ind2{padding-left:14mm}.mt{margin-top:6px}.r{text-align:right}.c{text-align:center}
.f{display:inline-block;border-bottom:1px dotted #000;padding:0 6px;text-align:center;line-height:1.35;color:#0b2e8a;font-weight:600}
.bx{display:inline-block;width:14px;height:14px;border:1.2px solid #000;text-align:center;line-height:12px;font-size:12px;font-weight:700;vertical-align:-2px;margin-right:2px}
.pvd-top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #2B5AC7;padding-bottom:4px;margin-bottom:10px}
.pvd-top img{height:46px}.pvd-site{font-size:13px}
.pvd h1{font-size:16px;text-align:center;line-height:1.5;margin-bottom:8px}
.pvd-sign{display:flex;justify-content:space-between;align-items:flex-start;margin-top:8px;gap:8mm;white-space:nowrap}
.committee{border:1.5px solid #000;padding:8px 14px;width:78mm;text-align:center;margin-top:22px}
.committee .gap{height:22px}
.committee.on .cm-sig{height:16mm;display:flex;align-items:flex-end;justify-content:center;border-bottom:1px dotted #000;margin:2px 8mm 3px}
.committee.on .cm-sig img{max-height:15mm;max-width:100%;object-fit:contain}
.committee .cm-title{font-size:.92em}.committee .cm-date{color:#0b2e8a;font-weight:600}
.sigs{flex:none;display:flex;flex-direction:column;align-items:flex-start}.sigs .gap{height:10px}
.sg{display:inline-grid;align-items:end;justify-content:start;column-gap:1.5mm;row-gap:2px}
.sg-b{display:inline-block;width:90%;border-bottom:1px dotted #000;height:1em}
.sg-l{border-bottom:1px dotted #000;height:7mm;position:relative;text-align:center;line-height:7mm}
.sg-l img{position:absolute;left:50%;bottom:-1mm;transform:translateX(-50%);height:12mm;max-width:100%;object-fit:contain}
.sg-d{color:#0b2e8a;font-weight:600}
.sg-n{text-align:center}
.foot{position:absolute;left:18mm;right:18mm;bottom:10mm;display:flex;justify-content:space-between;font-size:10.5px;color:#444}
.ref{position:absolute;left:18mm;bottom:5mm;font-size:9px;color:#888}
.wef-code{text-align:right;font-weight:700}.wef-code .pg{font-weight:400;font-size:11px}
.wef-rcv{margin:4px 0 0 auto;width:62mm;border:1px solid #000;padding:4px 8px;font-size:12px;line-height:1.6}
.wef h2{font-size:15px;text-align:center;margin:8px 0 4px}
.idrow{display:flex;align-items:center;gap:6mm;margin:2px 0}.idrow>span:first-child{width:70mm;line-height:1.35}
.idb{display:inline-flex}.idb i{width:6.2mm;height:6.2mm;border:1px solid #000;border-left:none;font-style:normal;text-align:center;line-height:6mm;color:#0b2e8a;font-weight:600}
.idb i:first-child{border-left:1px solid #000}
.ben{margin-top:3px}
.wef-sign{display:grid;grid-template-columns:1fr 1fr;gap:8px 8mm;margin-top:14px;white-space:nowrap;font-size:12.5px}
.note{margin-top:12px;font-size:12px;line-height:1.6}.note .ni{padding-left:15mm;display:inline-block}
@media print{body{background:#fff}.page{margin:0}}
`;

// เปิดหน้าต่างใหม่แล้วสั่งพิมพ์ (ผู้ใช้เลือก "บันทึกเป็น PDF" ได้)
// ⚠️ ต้องเรียกจาก event คลิกโดยตรง ไม่งั้นเบราว์เซอร์มือถือบล็อก popup
export function printSubmission(sub, opts = {}) {
  const w = window.open("", "_blank");
  if (!w) { alert("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — กรุณาอนุญาต pop-up แล้วลองใหม่"); return; }
  w.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(FORM_NAME[sub.form_type])} — ${esc(sub.emp_code)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
    <style>${PRINT_CSS}</style></head><body>${formPagesHTML(sub, opts)}</body></html>`);
  w.document.close();
  // รอฟอนต์ + โลโก้โหลดก่อน ไม่งั้นพิมพ์ออกมาเป็นฟอนต์ระบบ
  setTimeout(async () => {
    const imgs = [...w.document.images].filter(i => !i.complete)
      .map(i => new Promise(r => { i.onload = i.onerror = r; }));
    try { await Promise.all([w.document.fonts?.ready, ...imgs]); } catch (_) { /* พิมพ์ต่อได้แม้ฟอนต์ไม่มา */ }
    w.focus(); w.print();
  }, 400);
}
