// ============================================================================
// เอกสารของงวดค่าจ้างเหมา — 50 ทวิ (ตามแบบกรมสรรพากร) · สลิป
//   ออกจาก contract_pay_item เท่านั้น (สำเนาตัวเลข/ชื่อ/ที่อยู่ ณ ตอนประมวลผล) — เอกสารงวดเก่าต้องนิ่ง
//   50 ทวิ: ติ๊ก (4) ภ.ง.ด.3 · ข้อ 5 (ค่าจ้างทำของ/ค่าบริการ ตามคำสั่งฯ ม.3 เตรส — ผู้ใช้ยืนยัน 2026-10-15) · ผู้จ่ายเงิน (1) หัก ณ ที่จ่าย
//   ลงนาม = ผู้อนุมัติงวด (ลายเซ็นจาก letter_signers ณ ตอนกดอนุมัติ) · วันที่ = วันที่อนุมัติ (เวลาไทย)
//   ออกทุกงวดที่จ่าย ไม่สะสมรายปีแบบพนักงานประจำ (50 ทวิ ม.3 เตรส ต้องออกทุกครั้งที่หักภาษี)
// ============================================================================
import { bahtText } from "../js/contract-calc.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const B = v => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TH_MF = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
export const bkkDate = ts => ts ? new Date(new Date(ts).getTime() + 7 * 3600e3).toISOString().slice(0, 10) : "";
const dmy = iso => { if (!iso) return ""; const [y, m, d] = iso.split("-").map(Number); return `${d}/${m}/${y + 543}`; };
export const thMonth = period => { const [y, m] = period.split("-").map(Number); return `${TH_MF[m - 1]} ${y + 543}`; };
const taxBase = it => Number(it.tax_base ?? (Number(it.base_amount) + Number(it.extra_amount)));

// เลข 13 หลักลงช่องแบบฟอร์ม: 1-4-5-2-1
const idBoxes = id => {
  const d = String(id || "").replace(/\D/g, "").padEnd(13, " ").slice(0, 13).split("");
  const g = [1, 4, 5, 2, 1]; let i = 0;
  return `<span class="ids">${g.map(n => `<span class="grp">${d.slice(i, i += n).map(c => `<i>${c.trim() ? esc(c) : "&nbsp;"}</i>`).join("")}</span>`).join('<span class="dash">-</span>')}</span>`;
};
const box = on => `<span class="cb">${on ? "✓" : ""}</span>`;

const CSS50 = `@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font-family:'Sarabun','TH Sarabun New',sans-serif;color:#000;font-size:11.5px}
.pg{width:210mm;height:297mm;overflow:hidden;padding:8mm 11mm;page-break-after:always;position:relative}.pg:last-child{page-break-after:auto}
.copy{font-size:11px;line-height:1.35}.copy b{font-weight:700}
.frame{border:1.2px solid #000;margin-top:2mm}
.hd{display:flex;align-items:center;justify-content:center;position:relative;padding:2mm 0 1mm;border-bottom:1px solid #000}
.hd h1{font-size:17px;margin:0;text-align:center}.hd small{display:block;text-align:center;font-size:12px;font-weight:400}
.hd .no{position:absolute;right:3mm;top:2mm;font-size:11.5px;line-height:1.6}
.sec{padding:1mm 3mm;border-bottom:1px solid #000;line-height:1.5}
.row{display:flex;align-items:center;gap:3mm;flex-wrap:wrap}.row .grow{flex:1}
.lbl{font-weight:700}.fill{border-bottom:1px dotted #000;padding:0 2mm;min-height:5mm;display:inline-block}
.hint{font-size:9px;font-style:italic;color:#333;line-height:1.2}
.ids{display:inline-flex;align-items:center;gap:1px}.ids .grp{display:inline-flex}.ids i{display:inline-block;width:4.6mm;height:5mm;border:1px solid #000;margin-left:-1px;text-align:center;font-style:normal;line-height:5mm;font-size:12px}.ids .dash{padding:0 .6mm}
.op{white-space:nowrap;margin-right:3mm}.cb{display:inline-block;width:3.6mm;height:3.6mm;border:1px solid #000;vertical-align:-0.5mm;text-align:center;line-height:3.4mm;font-size:11px;font-weight:700;margin-right:1mm}
table.inc{width:100%;border-collapse:collapse;font-size:10.5px;line-height:1.3}table.inc th,table.inc td{border-left:1px solid #000;padding:.2mm 1.5mm;vertical-align:top}
table.inc th:first-child,table.inc td:first-child{border-left:none}table.inc th{border-bottom:1px solid #000;font-weight:700;text-align:center;padding:1mm}
table.inc td.n{text-align:right;white-space:nowrap;width:30mm}table.inc td.d{text-align:center;width:28mm}table.inc .i1{padding-left:5mm}table.inc .i2{padding-left:9mm}table.inc .i3{padding-left:13mm}
table.inc tr.tot td{border-top:1px solid #000;font-weight:700}
.words{display:flex;border-bottom:1px solid #000}.words .l{font-weight:700;padding:1.5mm 3mm;white-space:nowrap}.words .v{flex:1;background:#eee;padding:1.5mm 3mm;font-weight:700}
.signbox{display:flex}.signbox .warn{width:38%;border-right:1px solid #000;padding:2mm 3mm;font-size:11px}
.signbox .cert{flex:1;padding:2mm 3mm;text-align:center;font-size:12px;position:relative}
.sig{height:14mm;display:flex;align-items:flex-end;justify-content:center;gap:4mm}.sig img{max-height:14mm;max-width:45mm}
.seal{position:absolute;right:4mm;bottom:3mm;width:19mm;height:19mm;border:1px solid #000;border-radius:50%;display:grid;place-items:center;font-size:9px;text-align:center;line-height:1.1}
.seal img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.foot{font-size:10.5px;margin-top:1.5mm;line-height:1.45}
.draft{position:absolute;top:40%;left:0;right:0;text-align:center;font-size:60px;color:rgba(200,0,0,.12);transform:rotate(-24deg);font-weight:700;pointer-events:none}`;

const INC = [
  ["1. เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ ตามมาตรา 40 (1)", ""], ["2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ ตามมาตรา 40 (2)", ""], ["3. ค่าแห่งลิขสิทธิ์ ฯลฯ ตามมาตรา 40 (3)", ""],
  ["4. (ก) ดอกเบี้ย ฯลฯ ตามมาตรา 40 (4) (ก)", ""], ["(ข) เงินปันผล เงินส่วนแบ่งกำไร ฯลฯ ตามมาตรา 40 (4) (ข)", "i1"],
  ["(1) กรณีผู้ได้รับเงินปันผลได้รับเครดิตภาษี โดยจ่ายจากกำไรสุทธิของกิจการที่ต้องเสียภาษีเงินได้นิติบุคคลในอัตราดังนี้", "i2"],
  ["(1.1) อัตราร้อยละ 30 ของกำไรสุทธิ", "i3"], ["(1.2) อัตราร้อยละ 25 ของกำไรสุทธิ", "i3"], ["(1.3) อัตราร้อยละ 20 ของกำไรสุทธิ", "i3"], ["(1.4) อัตราอื่น ๆ (ระบุ) ........ ของกำไรสุทธิ", "i3"],
  ["(2) กรณีผู้ได้รับเงินปันผลไม่ได้รับเครดิตภาษี เนื่องจากจ่ายจาก", "i2"], ["(2.1) กำไรสุทธิของกิจการที่ได้รับยกเว้นภาษีเงินได้นิติบุคคล", "i3"],
  ["(2.2) เงินปันผลหรือเงินส่วนแบ่งของกำไรที่ได้รับยกเว้นไม่ต้องนำมารวมคำนวณเป็นรายได้เพื่อเสียภาษีเงินได้นิติบุคคล", "i3"],
  ["(2.3) กำไรสุทธิส่วนที่ได้หักผลขาดทุนสุทธิยกมาไม่เกิน 5 ปี ก่อนรอบระยะเวลาบัญชีปีปัจจุบัน", "i3"], ["(2.4) กำไรที่รับรู้ทางบัญชีโดยวิธีส่วนได้เสีย (equity method)", "i3"], ["(2.5) อื่น ๆ (ระบุ) ....................", "i3"],
  ["5. การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่าย ตามคำสั่งกรมสรรพากรที่ออกตามมาตรา 3 เตรส เช่น รางวัล ส่วนลดหรือประโยชน์ใด ๆ เนื่องจากการส่งเสริมการขาย รางวัลในการประกวด การแข่งขัน การชิงโชค ค่าแสดงของนักแสดงสาธารณะ ค่าจ้างทำของ ค่าโฆษณา ค่าเช่า ค่าขนส่ง ค่าบริการ ค่าเบี้ยประกันวินาศภัย ฯลฯ", ""],
  ["6. อื่น ๆ (ระบุ) ....................", ""],
];

// it = แถว contract_pay_item · seq = ลำดับในแบบ ภ.ง.ด.3 (ลำดับเดียวกับไฟล์ ภ.ง.ด.3) · art = { signature, seal } (data URL)
export function wht50Page({ it, seq, run, settings, art }) {
  const signed = run.status === "approved" || run.status === "locked";
  const paid = run.pay_date || `${run.period}-28`, base = taxBase(it), [by] = run.period.split("-");
  const rows = INC.map(([t, c], k) => { const mine = k === 16; return `<tr><td class="${c}">${esc(t)}</td><td class="d">${mine ? dmy(paid) : ""}</td><td class="n">${mine ? B(base) : ""}</td><td class="n">${mine ? B(it.wht_amount) : ""}</td></tr>`; }).join("");
  return `<section class="pg">${signed ? "" : `<div class="draft">ร่าง · ยังไม่อนุมัติ</div>`}
    <div class="copy"><b>ฉบับที่ 1</b> (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี)<br><b>ฉบับที่ 2</b> (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน)</div>
    <div class="frame">
      <div class="hd"><div><h1>หนังสือรับรองการหักภาษี ณ ที่จ่าย</h1><small>ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</small></div>
        <div class="no">เล่มที่ <span class="fill">${esc(String(+by + 543) + "/" + run.period.slice(5))}</span><br>เลขที่ <span class="fill">${seq}</span></div></div>
      <div class="sec"><div class="row"><span class="lbl">ผู้มีหน้าที่หักภาษี ณ ที่จ่าย : -</span><span class="grow"></span>เลขประจำตัวผู้เสียภาษีอากร (13 หลัก)* ${idBoxes(settings.company_tax_id)}</div>
        <div class="row">ชื่อ <span class="fill grow">${esc(settings.company_name_th)}</span></div><div class="hint">(ให้ระบุว่าเป็น บุคคล นิติบุคคล บริษัท สมาคม หรือคณะบุคคล)</div>
        <div class="row">ที่อยู่ <span class="fill grow">${esc(settings.company_address)}</span></div><div class="hint">(ให้ระบุ ชื่ออาคาร/หมู่บ้าน ห้องเลขที่ ชั้นที่ เลขที่ ตรอก/ซอย หมู่ที่ ถนน ตำบล/แขวง อำเภอ/เขต จังหวัด)</div></div>
      <div class="sec"><div class="row"><span class="lbl">ผู้ถูกหักภาษี ณ ที่จ่าย : -</span><span class="grow"></span>เลขประจำตัวผู้เสียภาษีอากร (13 หลัก)* ${idBoxes(it.tax_id)}</div>
        <div class="row">ชื่อ <span class="fill grow">${esc(it.name_th)}</span></div><div class="hint">(ให้ระบุว่าเป็น บุคคล นิติบุคคล บริษัท สมาคม หรือคณะบุคคล)</div>
        <div class="row">ที่อยู่ <span class="fill grow">${esc(it.address || "")}</span></div><div class="hint">(ให้ระบุ ชื่ออาคาร/หมู่บ้าน ห้องเลขที่ ชั้นที่ เลขที่ ตรอก/ซอย หมู่ที่ ถนน ตำบล/แขวง อำเภอ/เขต จังหวัด)</div>
        <div class="row" style="margin-top:1mm"><span class="lbl">ลำดับที่</span> <span class="fill" style="min-width:16mm;text-align:center">${seq}</span> ในแบบ
          ${[["(1) ภ.ง.ด.1ก"], ["(2) ภ.ง.ด.1ก พิเศษ"], ["(3) ภ.ง.ด.2"], ["(4) ภ.ง.ด.3", 1], ["(5) ภ.ง.ด.2ก"], ["(6) ภ.ง.ด.3ก"], ["(7) ภ.ง.ด.53"]].map(([t, on]) => `<span class="op">${box(on)}${on ? `<b>${t}</b>` : t}</span>`).join("")}</div></div>
      <table class="inc"><thead><tr><th>ประเภทเงินได้พึงประเมินที่จ่าย</th><th>วัน เดือน<br>หรือปีภาษี ที่จ่าย</th><th>จำนวนเงินที่จ่าย</th><th>ภาษีที่หัก<br>และนำส่งไว้</th></tr></thead>
        <tbody>${rows}<tr class="tot"><td style="text-align:right">รวมเงินที่จ่ายและภาษีที่หักนำส่ง</td><td></td><td class="n">${B(base)}</td><td class="n">${B(it.wht_amount)}</td></tr></tbody></table>
      <div class="words" style="border-top:1px solid #000"><span class="l">รวมเงินภาษีที่หักนำส่ง (ตัวอักษร)</span><span class="v">(${esc(bahtText(it.wht_amount))})</span></div>
      <div class="sec">เงินที่จ่ายเข้า กบข./กสจ./กองทุนสงเคราะห์ครูโรงเรียนเอกชน ........ บาท &nbsp; กองทุนประกันสังคม ........ บาท &nbsp; กองทุนสำรองเลี้ยงชีพ ........ บาท</div>
      <div class="sec"><span class="lbl">ผู้จ่ายเงิน</span> &nbsp; ${box(1)}(1) หัก ณ ที่จ่าย &nbsp; ${box(0)}(2) ออกให้ตลอดไป &nbsp; ${box(0)}(3) ออกให้ครั้งเดียว &nbsp; ${box(0)}(4) อื่น ๆ (ระบุ) ........</div>
      <div class="signbox"><div class="warn"><b>คำเตือน</b> ผู้มีหน้าที่ออกหนังสือรับรองการหักภาษี ณ ที่จ่าย ฝ่าฝืนไม่ปฏิบัติตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร ต้องรับโทษทางอาญาตามมาตรา 35 แห่งประมวลรัษฎากร</div>
        <div class="cert">ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ
          <div class="sig">${signed && art?.signature ? `<img src="${art.signature}" alt="">` : ""}</div>
          ลงชื่อ ...................................................... ผู้จ่ายเงิน<br>${signed && run.signer?.name_th ? `(${esc(run.signer.name_th)})${run.signer.title_th ? "<br>" + esc(run.signer.title_th) : ""}<br>` : ""}
          ${signed ? dmy(bkkDate(run.approved_at)) : "....... / ....... / ......."}<br><span class="hint">(วัน เดือน ปี ที่ออกหนังสือรับรองฯ)</span>
          <div class="seal">${signed && art?.seal ? `<img src="${art.seal}" alt="">` : "ประทับตรา<br>นิติบุคคล<br>(ถ้ามี)"}</div></div></div>
    </div>
    <div class="foot">หมายเหตุ เลขประจำตัวผู้เสียภาษีอากร (13 หลัก)* หมายถึง 1. กรณีบุคคลธรรมดาไทย ให้ใช้เลขประจำตัวประชาชนของกรมการปกครอง 2. กรณีนิติบุคคล ให้ใช้เลขทะเบียนนิติบุคคลของกรมพัฒนาธุรกิจการค้า 3. กรณีอื่น ๆ นอกเหนือจาก 1. และ 2. ให้ใช้เลขประจำตัวผู้เสียภาษีอากร (13 หลัก) ของกรมสรรพากร</div>
  </section>`;
}
export const wht50Doc = (pages, title) => `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>${esc(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap" rel="stylesheet"><style>${CSS50}</style></head><body>${pages.join("")}</body></html>`;

// สลิป — 1 คน 1 หน้า A4
const CSSSLIP = `@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font-family:'Sarabun',sans-serif;color:#111;font-size:13px}
.pg{width:210mm;min-height:148mm;padding:12mm 15mm;page-break-after:always}.pg:last-child{page-break-after:auto}
.h{display:flex;justify-content:space-between;border-bottom:2px solid #1f3b73;padding-bottom:3mm}.h b{font-size:16px;color:#1f3b73}.h small{color:#555}
table{width:100%;border-collapse:collapse;margin-top:4mm}td,th{padding:1.6mm 2mm;border-bottom:1px solid #ddd;text-align:left}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
th{background:#f2f4f8;font-weight:700}.net td{font-weight:700;font-size:15px;border-top:2px solid #1f3b73;border-bottom:none}
.kv{display:grid;grid-template-columns:1fr 1fr;gap:1mm 6mm;margin-top:4mm}.kv span{color:#555}`;
export function slipPage({ it, lines, run, settings }) {
  const earn = lines.filter(a => a.kind === "earning"), ded = lines.filter(a => a.kind === "deduction");
  return `<section class="pg"><div class="h"><div><b>ใบแจ้งค่าจ้าง · ${esc(thMonth(run.period))}</b><br><small>${esc(settings.company_name_th)}</small></div>
    <div style="text-align:right"><b>${esc(it.name_th)}</b><br><small>${esc(it.worker_code)}${it.department ? " · " + esc(it.department) : ""}</small></div></div>
    <div class="kv"><div><span>วันที่โอน</span> ${run.pay_date ? dmy(run.pay_date) : "-"}</div><div><span>บัญชี</span> ${esc(it.bank_account || "-")}</div></div>
    <table><thead><tr><th>รายการ</th><th class="n">รายได้</th><th class="n">รายหัก</th></tr></thead><tbody>
      <tr><td>ค่าจ้าง</td><td class="n">${B(it.base_amount)}</td><td></td></tr>
      ${earn.map(a => `<tr><td>${esc(a.label)}${a.taxable === false ? " (ไม่คิดภาษี)" : ""}</td><td class="n">${B(a.amount)}</td><td></td></tr>`).join("")}
      ${Number(it.wht_amount) ? `<tr><td>ภาษีหัก ณ ที่จ่าย ${Number(it.wht_percent)}%</td><td></td><td class="n">${B(it.wht_amount)}</td></tr>` : ""}
      ${ded.map(a => `<tr><td>${esc(a.label)}</td><td></td><td class="n">${B(a.amount)}</td></tr>`).join("")}
      <tr class="net"><td>รับสุทธิ</td><td class="n" colspan="2">${B(it.net_amount)} บาท</td></tr></tbody></table></section>`;
}
export const slipDoc = (pages, title) => `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>${esc(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap" rel="stylesheet"><style>${CSSSLIP}</style></head><body>${pages.join("")}</body></html>`;

export function printHTML(html) {
  const w = window.open("", "_blank");
  if (!w) { alert("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต pop-up แล้วลองใหม่"); return; }
  w.document.open(); w.document.write(html); w.document.close();
  setTimeout(async () => { try { await w.document.fonts?.ready; } catch {} w.focus(); w.print(); }, 600);
}
