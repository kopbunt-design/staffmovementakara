// ============================================================================
// สัญญาจ้างงาน (AKR-OHR-FM-006 Rev. 00) — ตัวเอกสาร + อ่านข้อความบัตรประชาชน · ตรรกะล้วน (เทส test/emp-contract.test.js)
//   ข้อความทุกข้อตามไฟล์ตัวอย่าง "AKR2609138x_Employment Agreement.pdf" (ผู้ใช้ส่งมา 2026-10-15)
//   2 สถานที่: สำนักงานกรุงเทพ (8.30–17.30) / พิจิตร (7.30–17.00) · ทดลองงานถึงวันที่ 119 นับวันเริ่มงานเป็นวันที่ 1
//   ไม่รันเลขเอกสาร · ห้าม import app.js
// ============================================================================
import { bahtText } from "./contract-calc.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TH_MF = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
export const thLong = iso => { if (!iso) return ""; const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return `${d} ${TH_MF[m - 1]} ${y + 543}`; };

export const COMPANY = { name: "บริษัท อัครา รีซอร์สเซส จำกัด (มหาชน)", address: "เลขที่ 99 หมู่ 9 ตำบลเขาเจ็ดลูก อำเภอทับคล้อ จังหวัดพิจิตร" };
export const LOC = {
  bkk:     { label: "สำนักงานกรุงเทพ", workplace: "188 ชั้น 14 อาคารสปริงทาวเวอร์ ถนนพญาไท แขวงทุ่งพญาไท เขตราชเทวี กรุงเทพมหานคร",
             days: "วันจันทร์ ถึงวันศุกร์", hours: "8.30 น. – 17.30 น.", brk: "เวลาพัก 1 ชั่วโมง (12.00 น. – 13.00 น.)" },
  phichit: { label: "พิจิตร (เหมือง)", workplace: "99 หมู่ 9 ตำบลเขาเจ็ดลูก อำเภอทับคล้อ จังหวัดพิจิตร",
             days: "วันจันทร์ ถึงวันศุกร์", hours: "7.30 น. – 17.00 น.", brk: "เวลาพัก 1 ชั่วโมง (12.00 น. – 13.00 น.)" },
};
export const FORM = { code: "AKR-OHR-FM-006 Rev. 00", effective: "Effective Date: 20/Jun/2025" };

// ทดลองงานสิ้นสุด = วันที่ 119 นับวันเริ่มงานเป็นวันที่ 1 (เริ่ม 14 ก.ย. 69 → 10 ม.ค. 70 ตามสัญญาตัวอย่าง)
export function probationEnd(start) { if (!start) return ""; const d = new Date(start + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 118); return d.toISOString().slice(0, 10); }
export const fill = d => { const L = LOC[d.location] || LOC.phichit;
  return { ...d, work_days: d.work_days || L.days, work_hours: d.work_hours || L.hours, break_time: d.break_time || L.brk, workplace: d.workplace || L.workplace,
           probation_end: d.probation_end || probationEnd(d.start_date) }; };

// เลขบัตรประชาชน 13 หลัก — หลักสุดท้ายเป็นเลขตรวจสอบ (mod 11)
export function idValid(id) {
  const s = String(id || "").replace(/\D/g, ""); if (s.length !== 13) return false;
  let sum = 0; for (let i = 0; i < 12; i++) sum += +s[i] * (13 - i);
  return (11 - (sum % 11)) % 10 === +s[12];
}

// ---------------------------------------------------------------- เอกสาร 4 หน้า
const CSS = `@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Tahoma,'Sarabun',sans-serif;color:#222;font-size:14.4px;line-height:2}
.pg{width:210mm;height:297mm;padding:12mm 22mm 0 25mm;position:relative;page-break-after:always;overflow:hidden}.pg:last-child{page-break-after:auto}
.hd{display:flex;align-items:flex-end;gap:0;border-bottom:3px solid #1f5fa8;padding-bottom:1mm;margin-bottom:8mm}.hd img{height:15mm;margin-bottom:-1mm}
.hd span{margin-left:auto;font-size:13px;color:#1f3c66}
.ft{position:absolute;left:25mm;right:22mm;bottom:12mm;border-top:3px solid #1f5fa8;padding-top:1mm;display:flex;justify-content:space-between;font-size:11px;color:#333}
h1{text-align:center;font-size:19px;font-weight:700;margin:2mm 0 3mm}.r{text-align:right}.ind{text-indent:18mm}.j{text-align:justify}
h3{font-size:14.4px;font-weight:400;text-decoration:underline;text-underline-offset:3px;margin:4mm 0 1mm}.v{color:#233f8e;font-weight:700}p{margin:0 0 2.5mm}
.kv{display:grid;grid-template-columns:42mm 1fr;margin:1.5mm 0}.sub{padding-left:14mm}
.sign{margin-top:18mm;text-align:center}.sign .b{margin:0 auto 12mm;width:170mm;white-space:nowrap}.sign .ln{display:flex;align-items:flex-end;justify-content:center;gap:2mm;height:16mm}
.sign .ln img{max-height:16mm;max-width:60mm;margin-bottom:-3mm}.sign .dots{display:inline-block;width:70mm;border-bottom:1px dotted #333}
.draft{position:absolute;top:42%;left:0;right:0;text-align:center;font-size:56px;color:rgba(200,0,0,.12);transform:rotate(-24deg);font-weight:700}`;

// d = ข้อมูลสัญญา · opts.idFull = เลขบัตรเต็ม (ถ้าไม่ใส่จะแสดงแค่ 5 ตัวท้าย) · opts.sig = { signer:{name,img}, witness:{name,img} } · opts.draft
export function contractHTML(d0, opts = {}) {
  const d = fill(d0), v = x => `<span class="v">${esc(x)}</span>`, page = n => `<div class="ft"><span>${FORM.code}</span><span>${FORM.effective}</span><span>Page ${n} of 4</span></div>`;
  const hd = `<div class="hd"><img src="${esc(opts.logo || "/assets/logo.png")}" alt=""><span>Chatree Gold Mine</span></div>`, wm = opts.draft ? `<div class="draft">${esc(opts.draft)}</div>` : "";
  const id = opts.idFull ? String(opts.idFull).replace(/\D/g, "") : d.id_last5 ? `xxxxxxxx${d.id_last5}` : "…………………";
  const who = `${d.title_th || ""}${d.name_th || ""}`, sal = Number(d.salary || 0);
  const pos = `${d.position_th}${d.position_en ? ` (${d.position_en})` : ""}`;
  const signLine = (s, role, nameFallback) => `<div class="b"><div class="ln">ลงชื่อ${s?.img ? `<img src="${esc(s.img)}" alt="">` : ""}<span class="dots"></span>${role}</div>(${esc(s?.name || nameFallback || "........................................")})</div>`;
  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>${esc(opts.title || "สัญญาจ้างงาน")}</title>
  <style>${CSS}</style></head><body>
  <section class="pg">${wm}${hd}<h1>สัญญาจ้างงาน</h1><p class="r">เขียนที่ ${COMPANY.name}</p>
    <p class="ind j">สัญญาฉบับนี้ทำขึ้นเมื่อวันที่ ${v(thLong(d.contract_date))} ระหว่าง ${COMPANY.name} สำนักงาน${COMPANY.address} ซึ่งต่อไปในสัญญาฉบับนี้เรียกว่า "<b>บริษัท</b>" ฝ่ายหนึ่ง<b>และ</b> ${v(who)} บัตรประจำตัวประชาชนเลขที่ ${v(id)} ที่อยู่ ${v(d.address || "")} ซึ่งต่อไปในสัญญาฉบับนี้จะเรียกว่า "<b>พนักงาน</b>" อีกฝ่ายหนึ่ง</p>
    <p class="ind j"><b>บริษัท</b> และ <b>พนักงาน</b> ซึ่งต่อไปในสัญญาฉบับนี้จะเรียกว่า “<b>คู่สัญญา</b>” ได้ตกลงในสัญญาร่วมกันโดยมีรายละเอียดดังต่อไปนี้</p>
    <h3>1. สัญญาจ้างงาน</h3><p class="j"><b>บริษัท</b>ตกลงจ้าง และ <b>พนักงาน</b>ตกลงรับจ้าง ตั้งแต่วันที่ ${v(thLong(d.start_date))} เป็นต้นไป พนักงานรับทราบว่ารายละเอียดข้อมูลในสัญญาจ้างงาน ข้อมูลเงินเดือน สวัสดิการต่าง ๆ เป็นความลับ ไม่สามารถเปิดเผยให้กับบุคคลอื่นรับทราบได้ทุกกรณี <b>หากมีข้อสงสัยเรื่องค่าตอบแทน ค่าจ้างและอื่น ๆ พนักงานจะต้องติดต่อสอบถามโดยตรงจากฝ่ายทรัพยากรบุคคลเท่านั้น</b> หากพนักงานฝ่าฝืน ถือเป็นความผิดทางวินัยขั้นร้ายแรง บริษัทมีสิทธิ์เลิกจ้างโดยไม่จ่ายค่าชดเชย</p>
    <h3>2. ตำแหน่งหน้าที่ และค่าตอบแทน</h3>
    <div class="kv"><span>ตำแหน่งงาน :</span>${v(pos)}</div><div class="kv"><span>ระดับตำแหน่งงาน :</span>${v(d.job_level || "")}</div>
    <div class="kv"><span>เงินเดือนพื้นฐาน :</span>${v(`${sal.toLocaleString("en-US")} บาท (${bahtText(sal)})`)}</div>
    <p class="j">โดยบริษัทตกลงจ่ายค่าตอบแทนผ่านบัญชีธนาคารของพนักงาน ซึ่งเปิดไว้กับธนาคารที่บริษัทได้แจ้งให้พนักงานทราบ ทุกวันที่ 25 ของเดือน บริษัทจะหักเงินค่าตอบแทนของพนักงานเพื่อชำระภาษีเงินได้ ประกันสังคม หรือเพื่อชำระเงินอื่น ๆ ตามที่กฎหมายกำหนด บริษัทอาจพิจารณาเปลี่ยนแปลงกำหนดวันจ่ายค่าตอบแทนตามความเหมาะสม โดยยึดแนวทางตามข้อกฎหมายเป็นตัวกำหนด</p>
    <h3>3. สวัสดิการและสิทธิประโยชน์</h3><p>เป็นไปตามเงื่อนไขที่บริษัทระบุไว้ในหมวดสวัสดิการและสิทธิประโยชน์ตามรายละเอียดคู่มือพนักงาน</p>${page(1)}</section>
  <section class="pg">${wm}${hd}
    <h3>4. วันและเวลาทำงาน</h3><p class="j">วันทำงานปกติของบริษัทคือ ${v(d.work_days)} เวลา ${v(d.work_hours)} ${esc(d.break_time)} <b>บริษัทอาจมีการเปลี่ยนแปลงวันและเวลาทำงาน ในบางลักษณะงานที่มีความจำเป็นจะต้องปฏิบัติงานตามระบบกะงาน โดยชั่วโมงการทำงานปกติรวมแล้วต้องไม่เกิน 48 ชั่วโมงต่อสัปดาห์</b> ซึ่งสอดคล้องตามพระราชบัญญัติคุ้มครองแรงงาน พ.ศ. 2541 และพนักงานอาจได้รับมอบหมายให้มาปฏิบัติหน้าที่นอกเหนือเวลาดังกล่าวตามโอกาส พนักงานจะต้องเข้าปฏิบัติงานตามช่วงเวลาที่ได้รับแจ้ง โดยถือเป็นส่วนหนึ่งของการจ้างงานที่พนักงานจะต้องปฏิบัติตาม</p>
    <h3>5. สถานที่ทำงาน</h3><p class="j">บริษัทตกลงรับพนักงานเข้าปฏิบัติงานที่ ${v(d.workplace)} ซึ่งสถานที่ทำงานดังกล่าวอาจเปลี่ยนแปลงตามความเหมาะสมอันเนื่องจากการขยายตัวของธุรกิจในอนาคต</p>
    <h3>6. การตรวจร่างกายก่อนจ้างงาน</h3><p class="j">สัญญาฉบับนี้จะยังไม่มีผลบังคับใช้จนกว่าพนักงานจะเข้ารับการตรวจร่างกายก่อนจ้างงานและผ่านเกณฑ์ตามมาตรฐานที่บริษัทกำหนด โดยบริษัทได้แจ้งรายละเอียดการตรวจร่างกายนี้ให้พนักงานรับทราบก่อนการจ้างงานแล้ว พนักงานอนุญาตให้บริษัทจัดเก็บและเปิดเผยข้อมูลส่วนบุคคลด้านการตรวจร่างกายนี้ต่อหน่วยงานภายนอกและ/หรือฝ่ายต่างๆในบริษัทตามความเหมาะสมหรือตามข้อบังคับด้านกฎหมาย เพื่อให้ถูกต้องตามกระบวนการต่างๆที่อาจจะเกิดจากข้อบังคับตามกฎหมายหรือหน่วยงานราชการที่เกี่ยวข้อง บริษัทมีสิทธิ์พิจารณาเลิกจ้างพนักงานโดยไม่จ่ายค่าชดเชยในกรณีที่ผลการตรวจร่างกายพบว่า</p>
    <p class="sub">6.1 ตรวจพบสารเสพติดในร่างกาย</p><p class="sub">6.2 ตรวจพบข้อมูลด้านสุขภาพที่ไม่ตรงกับข้อมูลที่พนักงานได้แจ้งไว้ในใบสมัครงานหรือมีการปกปิดข้อมูล</p>
    <h3>7. ระยะเวลาทดลองงาน</h3><p class="j">ระยะเวลาทดลองงานมีกำหนดไม่เกิน 119 วัน นับตั้งแต่วันที่พนักงานเริ่มงาน ถึงวันที่ ${v(thLong(d.probation_end))} หากบริษัทพิจารณาแล้วเห็นว่าพนักงานมีคุณสมบัติไม่เหมาะสมกับตำแหน่งงาน บริษัทมีสิทธิ์บอกเลิกสัญญานี้โดยไม่จ่ายค่าชดเชย ซึ่งบริษัทจะแจ้งล่วงหน้าเป็นลายลักษณ์อักษรอย่างน้อย 30 วัน</p>
    <h3>8. การบอกเลิกสัญญาจ้างงาน</h3><p class="j">หากพนักงานต้องการบอกเลิกสัญญาจ้างฉบับนี้ พนักงานจะต้องแจ้งให้บริษัททราบเป็นลายลักษณ์อักษรล่วงหน้าอย่างน้อย 30 วัน</p>${page(2)}</section>
  <section class="pg">${wm}${hd}
    <h3>9. ลิขสิทธิ์ในผลงานของพนักงาน</h3><p class="j">ตามกฎหมายว่าด้วยลิขสิทธิ์ พ.ศ.2537 ผลงานของพนักงานที่เกิดจากการค้นคว้า ทดลอง การพัฒนา รวมไปถึงนวัตกรรม โปรแกรม และแฟ้มเอกสารบนเครื่องคอมพิวเตอร์ ที่เกิดขึ้นระหว่างการทำงาน หรือใช้สถานที่ของบริษัท หรือใช้ทรัพยากรใด ๆ ของบริษัท ในการผลิตผลงานดังกล่าว ลิขสิทธิ์ของผลงานนั้น ๆ จะตกเป็นของบริษัท</p>
    <p class="j">นอกจากนั้น พนักงานจะไม่แอบอ้างผลงาน หรือข้อมูลของบุคคลอื่น รวมไปถึงผลงาน หรือข้อมูลที่ได้ผ่านการลอกเลียน แก้ไข หรือเปลี่ยนแปลงมาเป็นผลงาน หรือข้อมูลของตน และนำมาใช้ในธุรกิจบริษัท เพราะอาจนำมาซึ่งความเสียหายต่อบริษัทในเรื่องของการละเมิดลิขสิทธิ์</p>
    <h3>10. การส่งมอบคืนทรัพย์สิน</h3><p class="j">พนักงานยอมรับว่า หลังจากการเลิกทำงานกับบริษัท ด้วยเหตุผลใด ๆ ก็ตาม พนักงานจะคืนคู่มือทั้งหมด บันทึกเอกสาร และวัสดุอื่น ๆ ที่เป็นเจ้าของ รวมถึงอุปกรณ์ใด ๆ ที่บริษัท เคยให้พนักงานสำหรับใช้ในงานตามหน้าที่ในทันที</p>
    <h3>11. การโอนย้ายในกลุ่มบริษัทฯ / การกำหนดหน้าที่ใหม่ / การเปลี่ยนแปลงขอบเขตงาน</h3><p class="j">บริษัท ขอสงวนสิทธิ์ในการโอนย้ายพนักงานไปยังฝ่ายอื่น / บริษัทอื่น และบริษัทฯ ในเครือ หรือเปลี่ยนแปลงหน้าที่ / ขอบเขตการทำงานเมื่อใดก็ได้ตามที่เห็นสมควร</p>
    <h3>12. ความปลอดภัย</h3><p class="j">พนักงานจะต้องปฏิบัติตามกฎระเบียบความปลอดภัย ตามที่บริษัทได้กำหนดไว้และพนักงานต้องใช้ หรือสวมใส่อุปกรณ์ความปลอดภัยในขณะทำงานตลอดเวลา หากไม่ปฏิบัติตามกฎระเบียบความปลอดภัยหรือข้อบังคับที่กำหนดโดยบริษัท พนักงานจะต้องรับผิดต่อการลงโทษทางวินัยขั้นร้ายแรง รวมถึงการให้ออกจากงาน</p>
    <h3>13. การอนุญาตในเรื่องข้อมูลส่วนบุคคล</h3><p class="j">พนักงานยินยอมและอนุญาตให้บริษัทบันทึกข้อมูล จัดเก็บข้อมูล เผยแพร่ข้อมูล ใช้ข้อมูลและอื่น ๆ ในส่วนของข้อมูลส่วนบุคคลของพนักงานเพื่อประกอบการจ้างงานและกิจกรรมอื่นใดที่เกี่ยวข้องกับการจ้างงานตลอดระยะเวลาการจ้างงาน จนกว่าพนักงานจะแจ้งยกเลิกการอนุญาตเป็นลายลักษณ์อักษรต่อบริษัท รวมถึงหลังการยกเลิกหรือการยุติสัญญาจ้างแล้ว บริษัทยังมีสิทธิ์ที่จะใช้ข้อมูลของพนักงานในการดำเนินงานต่าง ๆ ตามที่กฎหมายได้กำหนดหรือบังคับไว้ให้ปฏิบัติ</p>
${page(3)}</section>
  <section class="pg">${wm}${hd}
    <h3>14. การดัดแปลงแก้ไข</h3><p class="j">สัญญาฉบับนี้อาจแก้ไข แทนที่ หรือทำให้เป็นโมฆะได้ก็ต่อเมื่อคู่สัญญาทั้งสองฝ่ายได้ลงนามเป็นลายลักษณ์อักษร นอกจากนี้ความเสียหายทางกายภาพหรือการสูญหายของเอกสารนี้จะไม่ถูกตีความว่าเป็นการแก้ไขหรือยุติข้อตกลงที่มีอยู่ในที่นี้</p>
    <p class="ind j">พนักงานจะต้องปฏิบัติตามระเบียบ และข้อบังคับการทำงานของบริษัท อันไม่ขัดต่อพระราชบัญญัติคุ้มครองแรงงาน และขนบธรรมเนียมประเพณีอันดีงามในสังคม <b>คู่สัญญา</b>ได้อ่าน และทำความเข้าใจในสัญญาจ้างนี้โดยตลอดแล้ว จึงได้ลงนามไว้ต่อหน้าพยานเป็นสำคัญ</p>
    <div class="sign">${signLine(opts.sig?.signer, "ในนามบริษัท / ทำแทนบริษัท")}${signLine(null, "พนักงาน", who)}${signLine(opts.sig?.witness, "พยาน")}</div>${page(4)}</section>
  </body></html>`;
}

// ---------------------------------------------------------------- อ่านข้อความจากบัตรประชาชน (ผล OCR)
// คืน { id, idOk, title_th, name_th, name_en, birth_date, address } — ช่องที่อ่านไม่ได้ = ""
const EN_MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const iso = (y, m, d) => y && m && d ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : "";
export function parseIdCard(text) {
  // OCR มักแยก "ำ" เป็น นิคหิต+า และใส่ | มั่ว ๆ
  const t = String(text || "").replace(/\u0E4D\u0E32/g, "\u0E33").replace(/[|]/g, " ").replace(/[ \t]+/g, " "), lines = t.split(/\n/).map(s => s.trim()).filter(Boolean);
  const out = { id: "", idOk: false, title_th: "", name_th: "", name_en: "", birth_date: "", address: "" };
  // เลข 13 หลัก (มีช่องว่าง/ขีดคั่นได้) — ถ้ามีหลายชุดเลือกชุดที่เลขตรวจสอบถูก
  const cands = [...t.matchAll(/(?<!\d)(\d[\s-]?(?:\d[\s-]?){11}\d)(?!\d)/g)].map(m => m[1].replace(/\D/g, ""));
  out.id = cands.find(idValid) || cands[0] || ""; out.idOk = idValid(out.id);
  // ชื่อไทย: บรรทัดที่มี "ชื่อตัวและชื่อสกุล" (หรือขึ้นต้นด้วยคำนำหน้า)
  // ป้าย "ชื่อตัวและชื่อสกุล" มักอ่านเพี้ยน → หาบรรทัดที่มีคำนำหน้าเป็นคำเดี่ยวตามด้วยชื่อ แล้วเอาตั้งแต่คำนำหน้า
  const thLine = lines.find(l => /ชื่อตัวและชื่อสกุล/.test(l)) || lines.find(l => /(^|\s)(นางสาว|นาย|นาง|น\.ส\.)\s+[ก-๙]/.test(l)) || "";
  const th = thLine.replace(/.*ชื่อตัวและชื่อสกุล\s*/, "").replace(/^.*?(?=(^|\s)(นางสาว|นาย|นาง|น\.ส\.)\s+[ก-๙])/, "").trim().match(/^(นางสาว|นาย|นาง|น\.ส\.)?\s*(.+)$/);
  if (th) { out.title_th = th[1] === "น.ส." ? "นางสาว" : th[1] || ""; out.name_th = th[2].replace(/\s+/g, " ").trim(); }
  // ชื่ออังกฤษ: "Name Mr. Somchai" + "Last name Jaidee"
  const fn = t.match(/Name\s+(?:Mr|Mrs|Miss|Ms)\.?\s+([A-Za-z][A-Za-z' -]*)/), ln = t.match(/Last\s*name\s+([A-Za-z][A-Za-z' -]*)/i);
  if (fn) out.name_en = [fn[1].trim(), ln ? ln[1].trim() : ""].filter(Boolean).join(" ");
  // วันเกิด: อังกฤษก่อน (Date of Birth 7 Jan. 1975) ไม่เจอค่อยไทย (เกิดวันที่ 7 ม.ค. 2518)
  const be = t.match(/Birth\s+(\d{1,2})\s*([A-Za-z]{3})[a-z]*\.?\s*(\d{4})/i);
  if (be && EN_MON[be[2].toLowerCase()]) out.birth_date = iso(+be[3], EN_MON[be[2].toLowerCase()], +be[1]);
  else { const bt = t.match(/เกิดวันที่\s*(\d{1,2})\s*([ก-๙.]+)\s*(\d{4})/); const mi = bt ? TH_MON.findIndex(m => bt[2].replace(/\s/g, "").startsWith(m.replace(/\.$/, ""))) : -1;
    if (bt && mi >= 0) out.birth_date = iso(+bt[3] - 543, mi + 1, +bt[1]); }
  // ที่อยู่: ตั้งแต่ "ที่อยู่" จนก่อนบรรทัดวันออกบัตร/วันหมดอายุ
  // ป้าย "ที่อยู่" อ่านเพี้ยนได้ (เช่นเป็นตัวอังกฤษ) → สำรอง: บรรทัดแรกที่มี ต./ตำบล/แขวง หลังวันเกิด
  let ai = lines.findIndex(l => /^ที่อยู่/.test(l));
  if (ai < 0) { const bi = lines.findIndex(l => /Birth|เกิดวันที่/.test(l)); ai = lines.findIndex((l, i) => i > bi && /(^|\s)(ต\.|ตำบล|แขวง)\s*[ก-๙]/.test(l)); }
  if (ai >= 0) { const parts = [];
    for (let i = ai; i < lines.length && parts.length < 3; i++) { if (i > ai && (/วันออกบัตร|Date of Issue|วันบัตรหมดอายุ|Date of Expiry|เจ้าพนักงาน/.test(lines[i]) || /^\d{1,2}\s+\S{2,6}\s+25\d\d\b/.test(lines[i]))) break; parts.push(lines[i]); }
    out.address = parts.join(" ").replace(/^ที่อยู่\s*/, "").replace(/^[A-Za-z]+\s+(?=\d)/, "").replace(/\s+/g, " ").trim(); }
  return out;
}
