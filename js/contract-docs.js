// ============================================================================
// เอกสารของงวดค่าจ้างเหมา — สลิป · ไฟล์โอนธนาคาร · 50 ทวิ · ภ.ง.ด.3
//
// ⚠️ ออกเอกสารจาก contract_pay_item เท่านั้น (สำเนาตัวเลข ณ ตอนคำนวณ)
//    ห้ามไปอ่านสดจาก contract_workers — ถ้าคนขึ้นค่าจ้าง/ย้ายแผนกทีหลัง
//    เอกสารของงวดเก่าจะเปลี่ยนตาม ซึ่งผิด เอกสารที่ออกไปแล้วต้องนิ่งตลอดไป
//
// PDF ใช้ window.print() ในหน้าต่างใหม่ที่มี CSS ของตัวเอง — แบบเดียวกับ
// ฉบับพิมพ์เซ็นของหน้าค่าใช้จ่ายเงินเดือน ไม่ต้องพึ่ง library เพิ่ม
// ============================================================================

const B = v => Number(v||0).toLocaleString("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2});
const esc2 = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const thMonth = p => { const [y,m] = String(p).split("-");
  return new Date(Number(y), Number(m)-1).toLocaleDateString("th-TH",{month:"long",year:"numeric"}); };
const today = () => new Date().toLocaleDateString("th-TH",{day:"numeric",month:"long",year:"numeric"});

// จำนวนเงินเป็นตัวหนังสือ — 50 ทวิ ต้องมีตามแบบของสรรพากร
export function bahtText(num) {
  const n = Math.round((Number(num)||0) * 100) / 100;
  if(n === 0) return "ศูนย์บาทถ้วน";
  const D = ["","หนึ่ง","สอง","สาม","สี่","ห้า","หก","เจ็ด","แปด","เก้า"];
  const U = ["","สิบ","ร้อย","พัน","หมื่น","แสน","ล้าน"];
  const conv = s => {
    let out = "";
    const L = s.length;
    for(let i = 0; i < L; i++){
      const d = +s[i], pos = L - i - 1;
      if(!d) continue;
      if(pos === 0 && d === 1 && L > 1) out += "เอ็ด";
      else if(pos === 1 && d === 1) out += "";
      else if(pos === 1 && d === 2) out += "ยี่";
      else out += D[d];
      out += U[pos % 6] || "";
    }
    return out;
  };
  const [ip, dp] = n.toFixed(2).split(".");
  // เกินล้าน: ตัดเป็นก้อนล้านแล้วต่อคำว่า "ล้าน"
  let baht = "";
  if(ip.length > 6){
    const head = ip.slice(0, ip.length - 6), tail = ip.slice(-6);
    baht = conv(head) + "ล้าน" + (Number(tail) ? conv(tail) : "");
  } else baht = conv(ip);
  let out = baht + "บาท";
  out += Number(dp) ? conv(dp) + "สตางค์" : "ถ้วน";
  return out;
}

const CSS = `
@page{size:A4;margin:14mm 15mm;}
*{box-sizing:border-box;}
body{margin:0;background:#eef0f3;font-family:"Sarabun","Helvetica Neue",Arial,sans-serif;color:#14181f;}
.pg{width:180mm;min-height:255mm;margin:8mm auto;background:#fff;padding:0;
    box-shadow:0 1px 6px rgba(0,0,0,.18);display:flex;flex-direction:column;}
@media print{body{background:#fff;} .pg{width:auto;min-height:0;margin:0;box-shadow:none;
  page-break-after:always;break-after:page;} .pg:last-of-type{page-break-after:auto;break-after:auto;}
  .noprint{display:none;}}
.noprint{position:fixed;right:12px;bottom:12px;display:flex;gap:10px;align-items:center;
  background:#14181f;color:#fff;padding:10px 14px;border-radius:8px;font-size:12px;}
.noprint button{background:#fff;color:#14181f;border:0;border-radius:6px;padding:7px 12px;
  font-weight:700;cursor:pointer;font-family:inherit;}
.hd{display:flex;justify-content:space-between;align-items:flex-end;
  border-bottom:2pt solid #14181f;padding-bottom:3mm;margin-bottom:5mm;}
.hd h1{margin:0;font-size:14pt;font-weight:700;letter-spacing:.1em;}
.hd p{margin:1mm 0 0;font-size:9pt;color:#4a5260;}
.hd .r{text-align:right;font-size:9pt;}
.hd .r b{display:block;font-size:11pt;}
.t{font-size:12pt;font-weight:700;text-align:center;margin:0 0 5mm;}
table{width:100%;border-collapse:collapse;font-size:9.5pt;}
.kv td{padding:1.6mm 0;vertical-align:top;}
.kv td:first-child{width:34mm;color:#4a5260;}
.gr{border:.6pt solid #c9ced8;margin-top:4mm;}
.gr th{background:#f2f4f7;text-align:left;padding:2mm 3mm;font-size:8.5pt;font-weight:700;
  border-bottom:.6pt solid #c9ced8;}
.gr td{padding:2mm 3mm;border-bottom:.4pt solid #e3e7ee;}
.gr tr:last-child td{border-bottom:none;}
.num{text-align:right;font-variant-numeric:tabular-nums;}
.tot td{border-top:1pt solid #14181f;font-weight:700;background:#f7f8fa;}
.net td{background:#144c32;color:#fff;font-weight:700;}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:16mm;margin-top:auto;padding-top:14mm;}
.sign div{text-align:center;font-size:9pt;}
.sign .ln{border-bottom:.7pt solid #14181f;height:14mm;margin-bottom:2mm;}
.note{margin-top:4mm;font-size:8pt;color:#6b7280;}
`;

function openPrint(title, body) {
  const w = window.open("", "_blank");
  if(!w){ alert("เบราว์เซอร์บล็อกป็อปอัป — อนุญาตแล้วลองใหม่"); return; }
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8">
    <title>${esc2(title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
    <style>${CSS}</style></head><body>${body}
    <div class="noprint"><button onclick="window.print()">🖨 พิมพ์ / บันทึก PDF</button>
      <span>A4 · ขอบกระดาษ Default</span></div></body></html>`);
  w.document.close();
}

const head = (sub, period) => `<div class="hd">
  <div><h1>AKARA RESOURCES</h1><p>${esc2(sub)}</p></div>
  <div class="r"><span>งวด</span><b>${esc2(thMonth(period))}</b></div>
</div>`;

// ---------------------------------------------------------------- สลิป
export function payslips(run, items) {
  if(!items.length){ alert("งวดนี้ยังไม่มีรายการ"); return; }
  const body = items.map(it => `<section class="pg" style="padding:14mm 15mm;">
    ${head("ใบแจ้งการจ่ายเงินค่าจ้างเหมา (Payment Advice)", run.period)}
    <table class="kv">
      <tr><td>ชื่อผู้รับเงิน</td><td><b>${esc2(it.name_th)}</b></td></tr>
      <tr><td>รหัส</td><td>${esc2(it.worker_code)}</td></tr>
      <tr><td>ประเภท</td><td>${esc2({consultant:"ที่ปรึกษา",casual:"ลูกจ้างชั่วคราว",contractor:"ผู้รับเหมา"}[it.worker_type]||it.worker_type)}</td></tr>
      <tr><td>หน่วยงาน</td><td>${esc2(it.department||"-")}</td></tr>
      ${it.bank_account?`<tr><td>โอนเข้าบัญชี</td><td>${esc2(it.bank_name||"")} ${esc2(it.bank_account)}</td></tr>`:""}
    </table>
    <table class="gr">
      <tr><th>รายการ</th><th class="num" style="width:38mm;">จำนวนเงิน (บาท)</th></tr>
      <tr><td>ค่าจ้างเหมาประจำงวด</td><td class="num">${B(it.base_amount)}</td></tr>
      ${Number(it.extra_amount)?`<tr><td>รายได้เพิ่มเติม</td><td class="num">${B(it.extra_amount)}</td></tr>`:""}
      <tr class="tot"><td>รวมเงินได้</td><td class="num">${B(Number(it.base_amount)+Number(it.extra_amount))}</td></tr>
      ${Number(it.wht_amount)?`<tr><td>หัก ภาษี ณ ที่จ่าย ${it.wht_percent}%</td><td class="num">−${B(it.wht_amount)}</td></tr>`:""}
      ${Number(it.deduct_amount)?`<tr><td>รายการหักอื่น ๆ</td><td class="num">−${B(it.deduct_amount)}</td></tr>`:""}
      <tr class="net"><td>ยอดโอนสุทธิ</td><td class="num">${B(it.net_amount)}</td></tr>
    </table>
    <div class="note">เอกสารนี้ออกจากระบบ HR SYSTEM · ${esc2(today())}
      ${Number(it.wht_amount)?" · ผู้รับเงินจะได้รับหนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) แยกต่างหาก":""}</div>
    <div class="sign">
      <div><div class="ln"></div>ผู้จ่ายเงิน</div>
      <div><div class="ln"></div>ผู้รับเงิน</div>
    </div>
  </section>`).join("");
  openPrint(`สลิป ${thMonth(run.period)}`, body);
}

// ------------------------------------------------------- หนังสือรับรอง 50 ทวิ
export function wht50(run, items) {
  const taxed = items.filter(i => Number(i.wht_amount) > 0);
  if(!taxed.length){ alert("งวดนี้ไม่มีรายการที่ถูกหักภาษี ณ ที่จ่าย"); return; }
  const body = taxed.map(it => `<section class="pg" style="padding:14mm 15mm;">
    ${head("หนังสือรับรองการหักภาษี ณ ที่จ่าย", run.period)}
    <div class="t">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</div>
    <table class="kv">
      <tr><td>ผู้มีหน้าที่หักภาษี</td><td><b>บริษัท อัครา รีซอร์สเซส จำกัด (มหาชน)</b></td></tr>
      <tr><td>เลขประจำตัวผู้เสียภาษี</td><td>[กรอกเลขผู้เสียภาษีบริษัท]</td></tr>
      <tr><td>ผู้ถูกหักภาษี</td><td><b>${esc2(it.name_th)}</b></td></tr>
      <tr><td>เลขประจำตัวผู้เสียภาษี</td><td>${esc2(it.tax_id || "— ยังไม่ได้กรอกในระบบ —")}</td></tr>
      <tr><td>ประเภทเงินได้</td><td>ค่าจ้างทำของ / ค่าบริการ (ภ.ง.ด.3)</td></tr>
    </table>
    <table class="gr">
      <tr><th>รายการ</th><th class="num" style="width:38mm;">จำนวนเงิน (บาท)</th></tr>
      <tr><td>จำนวนเงินที่จ่าย</td><td class="num">${B(Number(it.base_amount)+Number(it.extra_amount))}</td></tr>
      <tr class="tot"><td>ภาษีที่หักและนำส่ง (${it.wht_percent}%)</td><td class="num">${B(it.wht_amount)}</td></tr>
    </table>
    <table class="kv" style="margin-top:4mm;">
      <tr><td>ตัวอักษร</td><td><b>(${esc2(bahtText(it.wht_amount))})</b></td></tr>
    </table>
    <div class="note">ผู้จ่ายเงินได้ออกหนังสือรับรองฉบับนี้เพื่อเป็นหลักฐานการหักภาษี ณ ที่จ่าย
      · ออกให้ ณ วันที่ ${esc2(today())}
      <br><b>หมายเหตุ:</b> แบบฟอร์มนี้เป็นฉบับร่างจากระบบ ต้องตรวจกับแบบทางการของกรมสรรพากรก่อนใช้จริง</div>
    <div class="sign">
      <div><div class="ln"></div>ผู้มีหน้าที่หักภาษี ณ ที่จ่าย</div>
      <div><div class="ln"></div>วันที่</div>
    </div>
  </section>`).join("");
  openPrint(`50 ทวิ ${thMonth(run.period)}`, body);
}

// -------------------------------------------------- ไฟล์โอนเงินเข้าธนาคาร
// ธนาคารแต่ละแห่งใช้รูปแบบไฟล์ต่างกัน ตัวนี้ออกเป็น Excel กลาง ๆ ที่แก้ต่อได้
// (ถ้าจะทำไฟล์ตามสเปกธนาคารจริง ต้องรู้ว่าใช้ธนาคารไหนและขอสเปกจากธนาคารก่อน)
export function bankFile(run, items) {
  if(!window.XLSX){ alert("กรุณารอโหลด library"); return; }
  const pay = items.filter(i => Number(i.net_amount) > 0);
  const noAcct = pay.filter(i => !i.bank_account);
  if(noAcct.length && !confirm(
    `มี ${noAcct.length} คนที่ยังไม่ได้กรอกเลขบัญชี — จะไม่อยู่ในไฟล์โอน\n\n` +
    noAcct.slice(0,8).map(i=>`• ${i.worker_code} ${i.name_th}`).join("\n") +
    (noAcct.length>8?`\n… และอีก ${noAcct.length-8} คน`:"") + "\n\nสร้างไฟล์ต่อไหม?")) return;

  const rows = pay.filter(i => i.bank_account).map((i, n) => ({
    "ลำดับ": n+1, "ธนาคาร": i.bank_name||"", "เลขที่บัญชี": i.bank_account,
    "ชื่อบัญชี": i.name_th, "จำนวนเงิน": Number(i.net_amount),
    "อ้างอิง": `${i.worker_code}/${run.period}`,
  }));
  if(!rows.length){ alert("ไม่มีรายการที่มีเลขบัญชี — กรอกเลขบัญชีก่อน"); return; }
  const total = rows.reduce((s,r) => s + r["จำนวนเงิน"], 0);
  rows.push({ "ลำดับ":"", "ธนาคาร":"", "เลขที่บัญชี":"", "ชื่อบัญชี":"รวมทั้งสิ้น",
              "จำนวนเงิน":Math.round(total*100)/100, "อ้างอิง":`${rows.length} รายการ` });

  const ws = window.XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{wch:7},{wch:18},{wch:20},{wch:30},{wch:14},{wch:20}];
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "โอนเงิน");
  window.XLSX.writeFile(wb, `bank_transfer_${run.period}.xlsx`);
}

// ------------------------------------------------------------- ภ.ง.ด.3
export function pnd3(run, items) {
  if(!window.XLSX){ alert("กรุณารอโหลด library"); return; }
  const taxed = items.filter(i => Number(i.wht_amount) > 0);
  if(!taxed.length){ alert("งวดนี้ไม่มีรายการที่ถูกหักภาษี"); return; }
  const rows = taxed.map((i, n) => ({
    "ลำดับ": n+1,
    "เลขประจำตัวผู้เสียภาษี": i.tax_id || "",
    "ชื่อผู้มีเงินได้": i.name_th,
    "วันที่จ่าย": `${run.period}-31`,
    "ประเภทเงินได้": "ค่าจ้างทำของ/ค่าบริการ",
    "จำนวนเงินที่จ่าย": Number(i.base_amount) + Number(i.extra_amount),
    "อัตราภาษี (%)": Number(i.wht_percent),
    "ภาษีที่หัก": Number(i.wht_amount),
  }));
  const sum = k => Math.round(rows.reduce((s,r) => s + (Number(r[k])||0), 0) * 100) / 100;
  rows.push({ "ลำดับ":"", "เลขประจำตัวผู้เสียภาษี":"", "ชื่อผู้มีเงินได้":"รวมทั้งสิ้น",
    "วันที่จ่าย":"", "ประเภทเงินได้":`${rows.length} ราย`,
    "จำนวนเงินที่จ่าย":sum("จำนวนเงินที่จ่าย"), "อัตราภาษี (%)":"", "ภาษีที่หัก":sum("ภาษีที่หัก") });

  const missing = taxed.filter(i => !i.tax_id).length;
  const ws = window.XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{wch:7},{wch:22},{wch:30},{wch:14},{wch:24},{wch:16},{wch:12},{wch:14}];
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "ภ.ง.ด.3");
  window.XLSX.writeFile(wb, `pnd3_${run.period}.xlsx`);
  if(missing) alert(`สร้างไฟล์แล้ว แต่มี ${missing} รายที่ยังไม่ได้กรอกเลขประจำตัวผู้เสียภาษี\nต้องกรอกให้ครบก่อนยื่นจริง`);
}
