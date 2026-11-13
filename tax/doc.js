// ============================================================================
// 50 ทวิ พนักงานประจำ — ปีละใบ ติ๊ก (1) ภ.ง.ด.1ก · ใช้ทั้งในเว็บ /tax และหน้าพนักงาน /tax/my.html (ห้าม import js/app.js)
//   แบบฟอร์ม/CSS เดียวกับ 50 ทวิ ค่าจ้างเหมา (contract/doc.js)
//   ข้อ 1 = 40(1) ทั้งปี · ข้อ 2 = 40(2) (ค่าตอบแทนกรรมการ) · ข้อ 6 = เงินชดเชยที่จ่ายครั้งเดียวเพราะออกจากงาน
//   เงินสมทบประกันสังคม / กองทุนสำรองเลี้ยงชีพ (ส่วนของพนักงาน) ลงบรรทัดกองทุน
//   เล่มที่ = ปี พ.ศ. · เลขที่ = ลำดับที่ในแบบ ภ.ง.ด.1ก (ได้ตอนส่งให้ลงนาม) · วันที่ = วันที่ลงนาม
// ============================================================================
import { CSS50, INC, idBoxes, box, printHTML } from "../contract/doc.js";
import { bahtText } from "../js/tax-calc.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const B = v => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = iso => { if (!iso) return ""; const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return `${d}/${m}/${y + 543}`; };
const n = v => Number(v || 0);
export { printHTML };

// c = แถว tax_certs (person / signer เป็น object แล้ว) · settings = บริษัท · art = { path: dataURL }
export function cert50Page(c, settings, art = {}) {
  const p = c.person || {}, signed = c.status === "signed", be = String(c.year + 543);
  const t1 = n(c.inc401) || !n(c.inc402) ? n(c.tax) : 0, t2 = n(c.inc402) && !n(c.inc401) ? n(c.tax) : 0;   // ภาษีรวมทั้งก้อน — ลงบรรทัด 40(1) ถ้ามี
  const line = { 0: [n(c.inc401), t1], 1: [n(c.inc402), t2], 17: [n(c.sev), n(c.sev_tax)] };
  const total = n(c.inc401) + n(c.inc402) + n(c.sev), tax = n(c.tax) + n(c.sev_tax);
  const rows = INC.map(([txt, cls], k) => {
    const v = line[k], on = v && (v[0] || v[1]);
    const label = k === 17 && on ? "6. อื่น ๆ (ระบุ) เงินได้ที่จ่ายครั้งเดียวเพราะเหตุออกจากงาน (เงินชดเชย)" : txt;
    return `<tr><td class="${cls}">${esc(label)}</td><td class="d">${on ? be : ""}</td><td class="n">${on ? B(v[0]) : ""}</td><td class="n">${on ? B(v[1]) : ""}</td></tr>`;
  }).join("");
  const name = `${p.title || ""}${p.first_th || ""} ${p.last_th || ""}`.trim();
  const sig = signed && c.signer ? art[c.signer.signature_path] : "", seal = signed && c.signer ? art[c.signer.seal_path] : "";
  const payer = c.payer || "1";
  return `<section class="pg">${signed ? "" : `<div class="draft">${c.status === "void" ? "ยกเลิก" : "ร่าง · ยังไม่ลงนาม"}</div>`}
    <div class="copy"><b>ฉบับที่ 1</b> (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี)<br><b>ฉบับที่ 2</b> (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน)</div>
    <div class="frame">
      <div class="hd"><div><h1>หนังสือรับรองการหักภาษี ณ ที่จ่าย</h1><small>ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</small></div>
        <div class="no">เล่มที่ <span class="fill">${esc(be)}</span><br>เลขที่ <span class="fill">${c.no ? esc(String(c.no)) : "&nbsp;&nbsp;&nbsp;&nbsp;"}</span></div></div>
      <div class="sec"><div class="row"><span class="lbl">ผู้มีหน้าที่หักภาษี ณ ที่จ่าย : -</span><span class="grow"></span>เลขประจำตัวผู้เสียภาษีอากร (13 หลัก)* ${idBoxes(settings.company_tax_id)}</div>
        <div class="row">ชื่อ <span class="fill grow">${esc(settings.company_name_th)}</span></div><div class="hint">(ให้ระบุว่าเป็น บุคคล นิติบุคคล บริษัท สมาคม หรือคณะบุคคล)</div>
        <div class="row">ที่อยู่ <span class="fill grow">${esc(settings.company_address)}</span></div><div class="hint">(ให้ระบุ ชื่ออาคาร/หมู่บ้าน ห้องเลขที่ ชั้นที่ เลขที่ ตรอก/ซอย หมู่ที่ ถนน ตำบล/แขวง อำเภอ/เขต จังหวัด)</div></div>
      <div class="sec"><div class="row"><span class="lbl">ผู้ถูกหักภาษี ณ ที่จ่าย : -</span><span class="grow"></span>เลขประจำตัวผู้เสียภาษีอากร (13 หลัก)* ${idBoxes(p.tax_id)}</div>
        <div class="row">ชื่อ <span class="fill grow">${esc(name)}</span></div><div class="hint">(ให้ระบุว่าเป็น บุคคล นิติบุคคล บริษัท สมาคม หรือคณะบุคคล)</div>
        <div class="row">ที่อยู่ <span class="fill grow">${esc([p.address, p.zip].filter(Boolean).join(" "))}</span></div><div class="hint">(ให้ระบุ ชื่ออาคาร/หมู่บ้าน ห้องเลขที่ ชั้นที่ เลขที่ ตรอก/ซอย หมู่ที่ ถนน ตำบล/แขวง อำเภอ/เขต จังหวัด)</div>
        <div class="row" style="margin-top:1mm"><span class="lbl">ลำดับที่</span> <span class="fill" style="min-width:16mm;text-align:center">${c.no || ""}</span> ในแบบ
          ${[["(1) ภ.ง.ด.1ก", 1], ["(2) ภ.ง.ด.1ก พิเศษ"], ["(3) ภ.ง.ด.2"], ["(4) ภ.ง.ด.3"], ["(5) ภ.ง.ด.2ก"], ["(6) ภ.ง.ด.3ก"], ["(7) ภ.ง.ด.53"]].map(([t, on]) => `<span class="op">${box(on)}${on ? `<b>${t}</b>` : t}</span>`).join("")}</div></div>
      <table class="inc"><thead><tr><th>ประเภทเงินได้พึงประเมินที่จ่าย</th><th>วัน เดือน<br>หรือปีภาษี ที่จ่าย</th><th>จำนวนเงินที่จ่าย</th><th>ภาษีที่หัก<br>และนำส่งไว้</th></tr></thead>
        <tbody>${rows}<tr class="tot"><td style="text-align:right">รวมเงินที่จ่ายและภาษีที่หักนำส่ง</td><td></td><td class="n">${B(total)}</td><td class="n">${B(tax)}</td></tr></tbody></table>
      <div class="words" style="border-top:1px solid #000"><span class="l">รวมเงินภาษีที่หักนำส่ง (ตัวอักษร)</span><span class="v">(${esc(bahtText(tax))})</span></div>
      <div class="sec">เงินที่จ่ายเข้า กบข./กสจ./กองทุนสงเคราะห์ครูโรงเรียนเอกชน ........ บาท &nbsp; กองทุนประกันสังคม <b>${n(c.sso) ? B(c.sso) : "........"}</b> บาท &nbsp; กองทุนสำรองเลี้ยงชีพ <b>${n(c.pvd) ? B(c.pvd) : "........"}</b> บาท</div>
      <div class="sec"><span class="lbl">ผู้จ่ายเงิน</span> &nbsp; ${box(payer === "1")}(1) หัก ณ ที่จ่าย &nbsp; ${box(payer === "2")}(2) ออกให้ตลอดไป &nbsp; ${box(payer === "3")}(3) ออกให้ครั้งเดียว &nbsp; ${box(0)}(4) อื่น ๆ (ระบุ) ........</div>
      <div class="signbox"><div class="warn"><b>คำเตือน</b> ผู้มีหน้าที่ออกหนังสือรับรองการหักภาษี ณ ที่จ่าย ฝ่าฝืนไม่ปฏิบัติตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร ต้องรับโทษทางอาญาตามมาตรา 35 แห่งประมวลรัษฎากร</div>
        <div class="cert">ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ
          <div class="sig">${sig ? `<img src="${sig}" alt="">` : ""}</div>
          ลงชื่อ ...................................................... ผู้จ่ายเงิน<br>${signed && c.signer?.name_th ? `(${esc(c.signer.name_th)})${c.signer.title_th ? "<br>" + esc(c.signer.title_th) : ""}<br>` : ""}
          ${signed ? dmy(c.issue_date) : "....... / ....... / ......."}<br><span class="hint">(วัน เดือน ปี ที่ออกหนังสือรับรองฯ)</span>
          <div class="seal">${seal ? `<img src="${seal}" alt="">` : "ประทับตรา<br>นิติบุคคล<br>(ถ้ามี)"}</div></div></div>
    </div>
    <div class="foot">หมายเหตุ เลขประจำตัวผู้เสียภาษีอากร (13 หลัก)* หมายถึง 1. กรณีบุคคลธรรมดาไทย ให้ใช้เลขประจำตัวประชาชนของกรมการปกครอง 2. กรณีนิติบุคคล ให้ใช้เลขทะเบียนนิติบุคคลของกรมพัฒนาธุรกิจการค้า 3. กรณีอื่น ๆ นอกเหนือจาก 1. และ 2. ให้ใช้เลขประจำตัวผู้เสียภาษีอากร (13 หลัก) ของกรมสรรพากร</div>
  </section>`;
}
export const cert50Doc = (pages, title) => `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>${esc(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap" rel="stylesheet"><style>${CSS50}</style></head><body>${pages.join("")}</body></html>`;
