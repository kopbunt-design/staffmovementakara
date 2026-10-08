// ============================================================================
// HR Spend — ใบแจ้งหนี้ A4 (ดีไซน์จาก Figma "Invoice · A4")
//   หัว: โลโก้ + INVOICE / No. / Ref. / Date / Category · กล่อง Vendor / Vendee
//   ตาราง: รหัสบัญชี + รายละเอียด / Amount / VAT 7% / WHT x% / Net · ตัวอักษร + Grand Total
//   ช่องลงนาม 4 ช่อง: ลายเซ็นขึ้นเมื่อแต่ละคนกดยืนยันในระบบ (ใบที่นำเข้าจาก Excel ลงนามบนกระดาษ → ว่างไว้)
// ============================================================================
import { amountWords, round2 } from "./calc.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MON = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const enDate = iso => { if (!iso) return ""; const d = new Date(String(iso).slice(0, 10) + "T00:00:00"); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
// วันที่ล้วน (YYYY-MM-DD) ตีความเป็นเวลาท้องถิ่น ไม่ให้เลื่อนวันเพราะเขตเวลา · timestamp ใช้ตามจริง
const shortDate = iso => { if (!iso) return ""; const s = String(iso); const d = new Date(s.length <= 10 ? s + "T00:00:00" : s); return `${d.getDate()} ${MON[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`; };
const okImg = s => /^data:image\/(png|jpeg);base64,/.test(s || "") ? s : "";

const CSS = `
@page{size:A4;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'IBM Plex Sans Thai',Tahoma,sans-serif;color:#121926;font-size:12.5px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pg{width:210mm;min-height:297mm;padding:13mm 15mm 11mm;display:flex;flex-direction:column;gap:5.5mm;page-break-after:always;position:relative}
.pg:last-child{page-break-after:auto}
.hd{display:flex;justify-content:space-between;gap:10mm}
.hd img{height:13mm;display:block;margin-bottom:2mm}
.co b{display:block;font-size:11.5px;font-weight:600}.co span{font-size:10.5px;color:#6B7585}
.meta{text-align:right}
.meta h1{font-size:24px;font-weight:600;color:#234E8F;letter-spacing:.5px;margin-bottom:1.5mm}
.meta table{margin-left:auto;border-collapse:collapse}
.meta td{padding:.6mm 0 .6mm 4mm;font-size:12.5px}.meta td:first-child{color:#6B7585;font-size:10.5px;text-align:right}.meta td:last-child{font-weight:600}
.rule{height:3px;background:#2B5DA8}
.parties{display:flex;gap:4mm}
.party{flex:1;background:#F1F3F6;border-radius:2mm;padding:3mm 4mm}
.party .k{font-size:9.5px;font-weight:600;letter-spacing:.6px;color:#6B7585;text-transform:uppercase}
.party b{display:block;font-size:13px;font-weight:600;margin:.8mm 0}.party span{display:block;font-size:10.5px;color:#4B5565}
table.ln{width:100%;border-collapse:collapse}
.ln th{background:#F1F3F6;color:#4B5565;font-weight:500;font-size:10.5px;text-align:right;padding:2.4mm 3mm}
.ln th:first-child{text-align:left}
.ln td{padding:2.6mm 3mm;border-top:1px solid #E4E8EE;vertical-align:top;text-align:right;font-variant-numeric:tabular-nums}
.ln td:first-child{text-align:left}
.ln td small{display:block;color:#6B7585;font-size:10px}
.ln td .d2{display:block;color:#4B5565;font-size:11px}
.ln tr.tot td{border-top:1.5px solid #CED5DF;font-weight:600}
.gt{display:flex;gap:4mm;align-items:stretch}
.words{flex:1;border:1px solid #E4E8EE;border-radius:2mm;padding:2.5mm 3.5mm}
.words span{font-size:10px;color:#6B7585}.words b{display:block;font-weight:600;font-size:12.5px}
.grand{width:58mm;background:#0F2240;color:#fff;border-radius:2mm;padding:2.5mm 4.5mm;text-align:right}
.grand span{font-size:10px;opacity:.85}.grand b{display:block;font-size:22px;font-weight:600;font-variant-numeric:tabular-nums}
.note{font-size:11px;color:#4B5565}
.grow{flex:1}
.sigs{display:flex;gap:3mm}
.sig{flex:1;border:1px solid #E4E8EE;border-radius:2mm;padding:2.5mm 2mm 3mm;text-align:center}
.sig .r{font-size:10.5px;font-weight:600;color:#4B5565}
.sig .l{height:13mm;border-bottom:1px dashed #CED5DF;margin:1mm 4mm 1.2mm;display:flex;align-items:flex-end;justify-content:center}
.sig .l img{max-height:12mm;max-width:100%;object-fit:contain}
.sig .n{font-size:10.5px}.sig .d{font-size:10px;color:#6B7585}
.ft{display:flex;justify-content:space-between;border-top:1px solid #E4E8EE;padding-top:2mm;font-size:9.5px;color:#9AA4B2}
.wm{position:absolute;top:44%;left:0;right:0;text-align:center;font-size:64px;font-weight:700;color:rgba(180,35,24,.08);transform:rotate(-20deg);pointer-events:none}
`;

// inv: แถว exp_invoices · lines: บรรทัด · art: { prepared, reviewed, approved } = data URL ลายเซ็น
export function invoiceHTML(inv, lines, art = {}) {
  const v = inv.vendor || {};
  const wr = Number(inv.wht_rate) || 0;
  const t = { amount: 0, vat: 0, wht: 0, net: 0 };
  for (const l of lines) for (const k in t) t[k] += Number(l[k]) || 0;
  for (const k in t) t[k] = round2(t[k]);
  const signed = (who, role, nameFallback) => {
    const s = inv[who];
    return `<div class="sig"><div class="r">${role}</div><div class="l">${okImg(art[who]) ? `<img src="${art[who]}" alt="">` : ""}</div>
      <div class="n">(${esc(s?.name || nameFallback || " ".repeat(28))})</div><div class="d">Date ${s?.at ? shortDate(s.at) : "____________"}</div></div>`;
  };
  const wm = inv.status === "cancelled" ? `<div class="wm">CANCELLED</div>` : !inv.inv_no ? `<div class="wm" style="color:rgba(43,93,168,.08)">DRAFT</div>` : "";
  return `<section class="pg">${wm}
  <div class="hd">
    <div class="co"><img src="${location.origin}/assets/logo.png" alt="Akara Resources"><b>Akara Resources Public Company Limited</b><span>99 Moo 9 Khao Chet Luk, Thap Khlo, Phichit 66230 Thailand</span></div>
    <div class="meta"><h1>INVOICE</h1><table>
      <tr><td>No.</td><td>${esc(inv.inv_no || "— (draft)")}</td></tr>
      ${inv.ref_no ? `<tr><td>Ref.</td><td>${esc(inv.ref_no)}${inv.ref_date ? ` (${esc(shortDate(inv.ref_date))})` : ""}</td></tr>` : ""}
      ${inv.po_no ? `<tr><td>PO / PR</td><td>${esc(inv.po_no)}</td></tr>` : ""}
      <tr><td>Date</td><td>${esc(enDate(inv.inv_date))}</td></tr>
      ${inv.category ? `<tr><td>Category</td><td>${esc(inv.category)}</td></tr>` : ""}
    </table></div>
  </div>
  <div class="rule"></div>
  <div class="parties">
    <div class="party"><div class="k">Vendor${v.code ? ` · ${esc(v.code)}` : ""}</div><b>${esc(v.name || "")}</b>${v.address ? `<span>${esc(v.address)}</span>` : ""}${v.bank ? `<span>Bank: ${esc(v.bank)}</span>` : ""}${v.tax_id ? `<span>Tax ID: ${esc(v.tax_id)}</span>` : ""}</div>
    <div class="party"><div class="k">Vendee (Bill to)</div><b>Akara Resources Public Company Limited</b><span>99 Moo 9 Khao Chet Luk, Thap Khlo,</span><span>Phichit 66230 Thailand</span></div>
  </div>
  <table class="ln"><thead><tr><th>Detail</th><th style="width:28mm">Amount (THB)</th><th style="width:22mm">VAT 7%</th><th style="width:22mm">WHT ${wr}%</th><th style="width:28mm">Net</th></tr></thead><tbody>
    ${lines.map(l => `<tr><td>${l.cost_code ? `<small>${esc(l.cost_code)}</small>` : ""}${esc(l.detail)}${l.detail2 ? `<span class="d2">${esc(l.detail2)}</span>` : ""}</td>
      <td>${money(l.amount)}</td><td>${Number(l.vat) ? money(l.vat) : "–"}</td><td>${Number(l.wht) ? money(l.wht) : "–"}</td><td>${money(l.net)}</td></tr>`).join("")}
    <tr class="tot"><td>Total</td><td>${money(t.amount)}</td><td>${money(t.vat)}</td><td>${money(t.wht)}</td><td>${money(t.net)}</td></tr>
  </tbody></table>
  <div class="gt"><div class="words"><span>Amount in words</span><b>${esc(amountWords(t.net))}</b></div>
    <div class="grand"><span>Grand Total (THB)</span><b>${money(t.net)}</b></div></div>
  ${inv.note ? `<div class="note">Note: ${esc(inv.note)}</div>` : ""}
  <div class="grow"></div>
  <div class="sigs">
    ${signed("preparer", "Prepared by")}${signed("reviewer", "Reviewed by")}${signed("approver", "Approved by")}
    <div class="sig"><div class="r">Received by (Finance)</div><div class="l"></div>
      <div class="n">(${esc(inv.received_name || " ".repeat(28))})</div><div class="d">Date ${inv.received_at && !inv.imported ? shortDate(inv.received_at) : "____________"}</div></div>
  </div>
  <div class="ft"><span>${inv.imported ? "Imported from HR Invoice Database (signed on paper)" : "Generated by HR Spend"} · ${esc(inv.inv_no || "draft")}</span><span>Page 1 of 1</span></div>
  </section>`;
}

export function printInvoice(inv, lines, art) {
  const w = window.open("", "_blank");
  if (!w) { alert("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — กรุณาอนุญาต pop-up แล้วลองใหม่"); return; }
  w.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>${esc(inv.inv_no || "Invoice draft")}</title>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>${CSS}</style></head><body>${invoiceHTML(inv, lines, art)}</body></html>`);
  w.document.close();
  setTimeout(async () => {
    const imgs = [...w.document.images].filter(i => !i.complete).map(i => new Promise(r => { i.onload = i.onerror = r; }));
    try { await Promise.all([w.document.fonts?.ready, ...imgs]); } catch (_) {}
    w.focus(); w.print();
  }, 400);
}
