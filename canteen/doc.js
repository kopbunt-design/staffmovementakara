// ===== ใบแจ้งยอดร้านค้า (Daily Canteen Report) A4 — ใช้ทั้งหน้า HR (/canteen) และหน้าสหกรณ์ (/canteen/r.html) =====
// แบบที่ user อนุมัติ 2026-11-26: โลโก้จริง /assets/logo.png · น้ำเงิน-เหลืองตามโลโก้ · HR ลงนามออนไลน์คนเดียว · หน้า 1 อ่านง่ายสำหรับสหกรณ์
// ไม่มีเรื่องตรวจภายใน (แตะซ้ำ/รหัสไม่ตรง) ในใบ · หน้าถัดไป = รายชื่อทุกคนแยกตามบรรทัดในหน้า 1 · ห้าม import js/app.js
import { bahtText } from "../js/contract-calc.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
export const dTH = d => d ? `${+d.slice(8, 10)} ${TH_M[+d.slice(5, 7) - 1]} ${+d.slice(0, 4) + 543}` : "-";
const money = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = n => Number(n || 0).toLocaleString("en-US");
// UTC → เวลาไทย "2 พ.ย. 2569 09:12 น."
const tsTH = v => { const d = new Date(v); if (isNaN(d)) return ""; const b = new Date(d.getTime() + 7 * 3600e3).toISOString(); return `${dTH(b.slice(0, 10))} ${b.slice(11, 16)} น.`; };
const SEC = { akr: "สแกนบัตร · พนักงานอัครา", sub: "สแกนบัตร · ผู้รับเหมา (SUB)", forgot: "ลืมบัตร · ลงชื่อแทน", visit: "ผู้ติดต่อ / บัตรชั่วคราว",
              group: "รับแทนเป็นกลุ่ม · ตามใบรับอาหาร", carry: "ยกยอดจากวันก่อน · HR ยืนยันทาน 2 มื้อ" };
const BOX = { N1: "กล่อง 1", N2: "กล่อง 2", A1: "", A2: "" };

export const DOC_CSS = `
@page{size:A4;margin:0}*{box-sizing:border-box}
.cnd{font-family:Sarabun,sans-serif;color:#18233d;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.cnd .page{width:210mm;height:297mm;padding:0 0 14mm;position:relative;overflow:hidden;page-break-after:always;background:#fff;margin:0 auto}
.cnd .page:last-child{page-break-after:auto}
.cnd .head{display:flex;justify-content:space-between;align-items:center;padding:10mm 16mm 6mm}
.cnd .head .lg{height:15mm}
.cnd .docno{text-align:right;font-size:9pt;color:#6b7591}.cnd .docno b{display:block;font-size:15pt;color:#1d4a8f;letter-spacing:.4px}
.cnd .docno .void{display:inline-block;margin-top:4px;background:#fde8e8;color:#b42318;border-radius:99px;padding:1px 10px;font-weight:700;font-size:9pt}
.cnd .band{margin:0 16mm;border-radius:16px;background:linear-gradient(120deg,#1d4a8f,#2a5daa 65%,#3a6fc0);color:#fff;padding:7mm 9mm;position:relative;overflow:hidden}
.cnd .band:before{content:"";position:absolute;right:-40px;top:-60px;width:200px;height:200px;border-radius:50%;background:rgba(255,255,255,.07)}
.cnd .band:after{content:"";position:absolute;right:0;top:0;bottom:0;width:9px;background:#fcc934}
.cnd .title{display:flex;align-items:flex-end;justify-content:space-between;padding-right:8px;position:relative}
.cnd .title h1{margin:0;font-size:26pt;font-weight:800;line-height:1}
.cnd .title h1 span{display:block;font-size:10pt;font-weight:600;letter-spacing:3px;color:#fcd66a;margin-top:6px}
.cnd .date{text-align:right}.cnd .date small{display:block;font-size:9pt;opacity:.8}.cnd .date b{font-size:17pt}
.cnd .body{padding:7mm 16mm 0}
.cnd .info{display:grid;grid-template-columns:1.4fr 1fr .8fr;border:1.5px solid #dfe4ee;border-radius:14px}
.cnd .info div{padding:10px 16px;border-right:1.5px solid #dfe4ee}.cnd .info div:last-child{border:0}
.cnd .info small{display:block;font-size:9pt;color:#6b7591}.cnd .info b{font-size:14pt}
.cnd table.sum{width:100%;border-collapse:collapse;margin-top:7mm;font-size:13.5pt}
.cnd .sum th{font-size:9.5pt;color:#6b7591;font-weight:700;text-align:left;padding:0 6px 6px;border-bottom:2px solid #1d4a8f}
.cnd .sum th.r,.cnd .sum td.r{text-align:right}
.cnd .sum td{padding:9px 6px;border-bottom:1px solid #e8ebf2}
.cnd .sum td .k{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:10px}
.cnd .sum td small{color:#7a849c;font-size:10pt;margin-left:6px}
.cnd .sum td.r{font-weight:700;font-size:15pt;font-variant-numeric:tabular-nums}
.cnd .sum tr.t td{border:0;border-top:2px solid #1d4a8f;font-weight:800;font-size:15pt;padding-top:11px}
.cnd .total{margin-top:7mm;border-radius:18px;background:linear-gradient(120deg,#1d4a8f,#2a5daa);color:#fff;display:grid;grid-template-columns:auto 1fr;align-items:center;overflow:hidden;box-shadow:inset 0 -5px 0 #fcc934}
.cnd .total .calc{padding:16px 22px;font-size:12pt;font-weight:600;border-right:1px solid #ffffff40;background:rgba(0,0,0,.12);line-height:1.45}
.cnd .total .calc small{font-size:9.5pt;opacity:.85;letter-spacing:1px}
.cnd .total .calc b{font-size:22pt;display:block;line-height:1.1}
.cnd .total .money{padding:14px 24px;text-align:right}
.cnd .total .money small{font-size:9.5pt;opacity:.85;letter-spacing:1px}
.cnd .total .money b{display:block;font-size:34pt;font-weight:800;line-height:1.05;color:#fff}
.cnd .total .money i{font-style:normal;font-size:11pt;opacity:.92}
.cnd .cum{margin-top:4mm;font-size:10.5pt;color:#59637d;display:flex;justify-content:space-between;padding:0 4px}
.cnd .cum b{color:#18233d}
.cnd .esign{position:absolute;left:16mm;right:16mm;bottom:20mm;display:flex;justify-content:flex-end}
.cnd .card{width:88mm;border:1.5px solid #dfe4ee;border-radius:14px;padding:10px 16px 11px;position:relative}
.cnd .card .lab{font-size:8.5pt;color:#6b7591;font-weight:700;letter-spacing:.6px}
.cnd .card .sig{height:16mm;display:flex;align-items:flex-end}.cnd .card .sig img{max-height:15mm;max-width:60mm}
.cnd .card .nm{font-weight:700;font-size:11.5pt;border-top:1px dashed #c9cfdb;padding-top:5px}
.cnd .card .po{font-size:9pt;color:#59637d}
.cnd .card .st{position:absolute;right:12px;top:10px;font-size:8pt;color:#1d4a8f;background:#e6eefb;border-radius:99px;padding:2px 9px;font-weight:700}
.cnd .card .ts{font-size:8pt;color:#8a93aa;margin-top:3px}
.cnd .foot{position:absolute;left:16mm;right:16mm;bottom:7mm;font-size:8pt;color:#9aa3b8;display:flex;justify-content:space-between;border-top:1px solid #eef0f5;padding-top:5px}
.cnd .lh{display:flex;justify-content:space-between;align-items:center;margin:10mm 16mm 0;padding-bottom:6px;border-bottom:2.5px solid #1d4a8f;font-size:10.5pt}
.cnd .lh img{height:7mm;vertical-align:-6px;margin-right:10px}
.cnd .lh b{font-size:14pt;color:#1d4a8f}.cnd .lh span{color:#7a849c;font-size:9.5pt}
.cnd .cols{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:5mm 16mm 0;align-items:start}
.cnd table.l{width:100%;border-collapse:collapse;font-size:9pt;table-layout:fixed}
.cnd .l td{padding:2.4px 4px;border-bottom:1px solid #eff1f6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cnd .l td.n{color:#a0a8bc;width:26px;text-align:right}
.cnd .l td.c{font-variant-numeric:tabular-nums;color:#3a4566;width:88px}
.cnd .l td.x{width:44px;text-align:right;color:#59637d;font-size:8pt}
.cnd .l tr.sh td{background:#eef2fa;color:#1d4a8f;font-weight:700;font-size:9.2pt;padding:4px 7px;border:0}
.cnd .l tr.sh span{float:right}
@media screen{.cnd .page{box-shadow:0 2px 18px rgba(16,24,40,.12);margin:0 auto 18px}}
`;

// people → แถวตาราง (หัวหมวด + คน) แล้วแบ่งหน้า
function listRows(n) {
  const out = []; let i = 0;
  const by = {};
  for (const p of n.people || []) (by[p.c] || (by[p.c] = [])).push(p);
  for (const c of ["akr", "sub", "forgot", "visit", "group", "carry"]) {
    const ps = by[c]; if (!ps?.length) continue;
    const tot = ps.reduce((t, p) => t + (+p.n || 0), 0);
    out.push(`<tr class="sh"><td colspan="4">${SEC[c]}<span>${int(tot)} อิ่ม</span></td></tr>`);
    for (const p of ps.sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.name).localeCompare(String(b.name), "th"))) {
      i++;
      const x = [p.n > 1 ? `× ${p.n}` : "", p.box ? BOX[p.box] : "", p.from ? `${+p.from.slice(8, 10)}/${+p.from.slice(5, 7)}` : ""].filter(Boolean).join(" ");
      out.push(`<tr><td class="n">${i}</td><td class="c">${esc(p.code || "—")}</td><td>${esc(p.name || "")}</td><td class="x">${esc(x)}</td></tr>`);
    }
  }
  return out;
}

export function noticeDoc(n, art = {}, { logo = "/assets/logo.png" } = {}) {
  const rows = listRows(n), PER = 86, pages = [];
  for (let k = 0; k < rows.length; k += PER) pages.push(rows.slice(k, k + PER));
  const tot = 1 + pages.length, sig = art[n.signer?.signature_path] || "", voided = n.status === "void";
  const unitTxt = n.unit === "CN" ? "Chatree North (กล่อง 1 + 2)" : n.label;
  const p1 = `<section class="page">
  <div class="head"><img class="lg" src="${esc(logo)}" alt="Akara Resources">
    <div class="docno">เลขที่ · Report No.<b>${esc(n.doc_no)}</b>${n.version > 1 ? `<span style="font-size:8.5pt">ออกใหม่ครั้งที่ ${n.version}</span>` : ""}${voided ? `<br><span class="void">ยกเลิกแล้ว</span>` : ""}</div></div>
  <div class="band"><div class="title"><h1>ใบแจ้งยอดร้านค้า<span>DAILY CANTEEN REPORT</span></h1>
    <div class="date"><small>วันที่ทานอาหาร</small><b>${dTH(n.d)}</b></div></div></div>
  <div class="body">
    <div class="info"><div><small>ร้านอาหาร · Restaurant</small><b>${esc(n.shop || "-")}</b></div>
      <div><small>จุดสแกน · Box</small><b>${esc(unitTxt)}</b></div><div><small>ราคาต่ออิ่ม</small><b>${int(n.price)} บาท</b></div></div>
    <table class="sum"><tr><th>รายการ</th><th class="r">จำนวน (อิ่ม)</th></tr>
      ${(n.lines || []).map(l => `<tr><td><i class="k" style="background:${esc(l.color)}"></i>${esc(l.label)}${l.sub ? `<small>${esc(l.sub)}</small>` : ""}</td><td class="r">${int(l.n)}</td></tr>`).join("")}
      <tr class="t"><td>รวม</td><td class="r">${int(n.meals)}</td></tr></table>
    <div class="total"><div class="calc"><small>ยอดวันนี้</small><b>${int(n.meals)} × ${int(n.price)}</b>อิ่ม × บาท</div>
      <div class="money"><small>จำนวนเงิน · AMOUNT</small><b>฿${money(n.amount)}</b><i>(${esc(bahtText(n.amount))})</i></div></div>
    ${n.cum?.from ? `<div class="cum"><span>ยอดสะสมรอบบิล ${dTH(n.cum.from)} – ${dTH(n.cum.to)} (ถึงวันนี้ · ${n.cum.days} วัน)</span><span><b>${int(n.cum.meals)} อิ่ม · ฿${money(n.cum.amount)}</b></span></div>` : ""}
  </div>
  <div class="esign"><div class="card"><span class="st">✓ ลงนามอิเล็กทรอนิกส์</span><div class="lab">ผู้จัดทำ · PREPARED BY</div>
    <div class="sig">${sig ? `<img src="${sig}" alt="">` : ""}</div>
    <div class="nm">${esc(n.signer?.name || "")}</div><div class="po">${esc(n.signer?.title || "")} · Akara Resources</div>
    <div class="ts">${tsTH(n.signed_at)}${n.verify ? ` · รหัสตรวจสอบ ${esc(n.verify)}` : ""}</div></div></div>
  <div class="foot"><span>${tot > 1 ? "รายชื่อผู้ทานทุกคนอยู่หน้าถัดไป" : "AKARA RESOURCES · ใบแจ้งยอดร้านค้า"}</span><span>หน้า 1/${tot}</span></div>
</section>`;
  const rest = pages.map((chunk, k) => { const h = Math.ceil(chunk.length / 2);
    return `<section class="page"><div class="lh"><div><img src="${esc(logo)}" alt=""><b>รายชื่อผู้ทาน</b> · ${esc(n.doc_no)} · ${esc(unitTxt)} · ${dTH(n.d)}</div><span>หน้า ${k + 2}/${tot}</span></div>
      <div class="cols"><table class="l">${chunk.slice(0, h).join("")}</table><table class="l">${chunk.slice(h).join("")}</table></div>
      <div class="foot"><span>AKARA RESOURCES · ใบแจ้งยอดร้านค้า ${esc(n.doc_no)}</span><span>หน้า ${k + 2}/${tot}</span></div></section>`; }).join("");
  return p1 + rest;
}

// เปิดหน้าต่างพิมพ์ (บันทึกเป็น PDF ได้จากหน้าพิมพ์ของเบราว์เซอร์)
export function printNotices(ns, art, title = "ใบแจ้งยอดร้านค้า") {
  const w = window.open("", "_blank");
  if (!w) { alert("เบราว์เซอร์บล็อกหน้าต่างใหม่ — อนุญาต pop-up แล้วลองอีกครั้ง"); return; }
  const base = location.origin;
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>${DOC_CSS} body{margin:0;background:#eef1f6} @media print{body{background:#fff}}</style></head>
    <body><div class="cnd">${ns.map(n => noticeDoc(n, art, { logo: base + "/assets/logo.png" })).join("")}</div>
    <script>document.fonts.ready.then(()=>setTimeout(()=>print(),300))<\/script></body></html>`);
  w.document.close();
}

// Excel รายชื่อ (SheetJS ต้องโหลดไว้ใน window.XLSX)
export function namesWorkbook(ns) {
  const wb = XLSX.utils.book_new();
  for (const n of ns) {
    const aoa = [[`ใบแจ้งยอดร้านค้า ${n.doc_no}`], [`วันที่ทาน ${dTH(n.d)} · ${n.unit === "CN" ? "Chatree North" : n.label} · ${n.shop || ""}`], [],
      ["ลำดับ", "หมวด", "รหัส", "ชื่อ", "อิ่ม", "หมายเหตุ"]];
    let i = 0;
    for (const p of n.people || []) aoa.push([++i, SEC[p.c] || p.c, p.code, p.name, p.n, [p.box ? BOX[p.box] : "", p.from ? `ทานวันที่ ${dTH(p.from)}` : ""].filter(Boolean).join(" ")]);
    aoa.push([], ["", "รวม", "", "", n.meals], ["", `× ${n.price} บาท`, "", "", n.amount]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 6 }, { wch: 30 }, { wch: 14 }, { wch: 32 }, { wch: 6 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, ws, n.doc_no.replace(/[\\/?*[\]:]/g, "-").slice(0, 31));
  }
  return wb;
}

// ---------------------------------------------------------------- ใบลงชื่อทานอาหาร (กระดาษที่เคาน์เตอร์) — user 2026-11-27
// เคาน์เตอร์ไม่มีเครื่อง/เน็ต → พิมพ์ล่วงหน้า 1 แผ่นต่อกล่องต่อวัน (ร้าน/กล่อง/วันที่/เลขใบพิมพ์มาแล้ว)
// ลำดับช่องตรงกับหน้าคีย์ "ใบลงชื่อ" ในระบบ: ลืมบัตร (รหัส 4 ตัวท้ายเป็นกล่อง + ติ๊ก AKR/SUB) · ผู้ติดต่อ · รับแทนเป็นกลุ่ม
export const SHEET_CSS = `
@page{size:A4;margin:0}*{box-sizing:border-box}
.sht{font-family:Sarabun,sans-serif;color:#18233d;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sht .page{width:210mm;height:297mm;padding:9mm 12mm 8mm;position:relative;overflow:hidden;page-break-after:always;background:#fff;margin:0 auto}
.sht .page:last-child{page-break-after:auto}
.sht .hd{display:flex;align-items:center;justify-content:space-between;gap:10px}
.sht .hd img{height:11mm}
.sht .hd .no{text-align:right;font-size:8.5pt;color:#6b7591}.sht .hd .no b{display:block;font-size:11pt;color:#1d4a8f;letter-spacing:.3px}
.sht .band{margin-top:4mm;border-radius:10px;background:#1d4a8f;color:#fff;padding:3.2mm 5mm;display:flex;justify-content:space-between;align-items:center;box-shadow:inset -6px 0 0 #fcc934}
.sht .band h1{margin:0;font-size:17pt;line-height:1.1}.sht .band h1 small{display:block;font-size:9pt;font-weight:500;color:#fcd66a;letter-spacing:.5px}
.sht .band .dt{text-align:right;font-size:9pt}.sht .band .dt b{display:block;font-size:15pt}
.sht .info{display:flex;gap:0;margin-top:3mm;border:1.2px solid #c9d2e3;border-radius:8px;font-size:10pt}
.sht .info div{padding:1.8mm 4mm;border-right:1.2px solid #c9d2e3;flex:1}.sht .info div:last-child{border:0}
.sht .info small{display:block;font-size:7.5pt;color:#6b7591}.sht .info b{font-size:11pt}
.sht h2{margin:3mm 0 1.2mm;font-size:11.5pt;color:#1d4a8f;display:flex;align-items:baseline;gap:8px}
.sht h2 span{font-size:8.5pt;font-weight:400;color:#59637d}
.sht table{width:100%;border-collapse:collapse;font-size:9pt;table-layout:fixed}
.sht th{background:#eef2fa;color:#1d4a8f;font-weight:700;font-size:8.5pt;padding:1.2mm 1.5mm;border:1px solid #9fb0cc;text-align:center}
.sht td{border:1px solid #9fb0cc;height:8.2mm;padding:0 1.5mm;vertical-align:middle}
.sht td.n{text-align:center;color:#8a93aa;width:8mm}
.sht .kind{font-size:8pt;white-space:nowrap}.sht .kind i{display:inline-block;width:3.2mm;height:3.2mm;border:1px solid #59637d;border-radius:1px;vertical-align:-0.5mm;margin-right:1mm}
.sht .digs{display:inline-flex;gap:1mm;vertical-align:middle}.sht .digs i{width:5.6mm;height:6.4mm;border:1px solid #59637d;border-radius:1.5px;display:inline-block;background:#fff}
.sht .ft{position:absolute;left:12mm;right:12mm;bottom:8mm;display:grid;grid-template-columns:1fr 1fr 1fr;gap:6mm;font-size:8.5pt;color:#59637d}
.sht .ft div{border-top:1px solid #9fb0cc;padding-top:1.5mm}.sht .ft b{color:#18233d}
.sht .tip{margin-top:2mm;font-size:8.5pt;color:#59637d;background:#fff7e0;border-radius:6px;padding:1.5mm 3mm}
@media screen{.sht .page{box-shadow:0 2px 18px rgba(16,24,40,.12);margin:0 auto 18px}}
`;
const TH_D = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
export function signSheet({ d, box, boxLabel, shop, sheetNo }, { logo = "/assets/logo.png", forgot = 12, visit = 4, group = 3 } = {}) {
  const rows = (n, cells) => Array.from({ length: n }, (_, i) => `<tr><td class="n">${i + 1}</td>${cells}</tr>`).join("");
  const wd = TH_D[new Date(d + "T00:00:00Z").getUTCDay()];
  return `<section class="page">
  <div class="hd"><img src="${esc(logo)}" alt="Akara Resources"><div class="no">เลขที่ใบ<b>${esc(sheetNo)}</b></div></div>
  <div class="band"><h1>ใบลงชื่อทานอาหาร<small>ลืมบัตร · ผู้ติดต่อ · รับแทนเป็นกลุ่ม</small></h1><div class="dt">วัน${wd}<b>${dTH(d)}</b></div></div>
  <div class="info"><div><small>ร้านอาหาร</small><b>${esc(shop || "")}</b></div><div><small>จุดสแกน / กล่อง</small><b>${esc(boxLabel)}</b></div><div><small>ใช้ได้เฉพาะวันที่</small><b>${dTH(d)}</b></div></div>
  <div class="tip">กินได้ <b>กะละ 1 ครั้ง</b> · เขียนรหัสด้วย <b>ตัวเลขบรรจงทีละช่อง</b> (4 ตัวท้ายของรหัสพนักงาน หรือเลข SUB) แล้วติ๊กว่าเป็น AKR หรือ SUB · ถ้ามีบัตรติดตัวให้สแกนบัตรแทน</div>
  <h2>1. ลืมบัตร <span>พนักงานอัครา / ผู้รับเหมา SUB</span></h2>
  <table><colgroup><col style="width:8mm"><col style="width:26mm"><col style="width:38mm"><col><col style="width:34mm"></colgroup>
    <tr><th>ที่</th><th>ประเภท</th><th>รหัส (4 ตัวท้าย)</th><th>ชื่อ - สกุล</th><th>ลงชื่อ</th></tr>
    ${rows(forgot, `<td class="kind"><i></i>AKR &nbsp;<i></i>SUB</td><td style="text-align:center"><span class="digs"><i></i><i></i><i></i><i></i></span></td><td></td><td></td>`)}</table>
  <h2>2. ผู้ติดต่อ / บัตรชั่วคราว <span>แม่บ้าน · รปภ. · แขก · ผู้ติดต่อ</span></h2>
  <table><colgroup><col style="width:8mm"><col style="width:30mm"><col><col style="width:44mm"><col style="width:34mm"></colgroup>
    <tr><th>ที่</th><th>เลขบัตรผู้ติดต่อ</th><th>ชื่อ - สกุล</th><th>บริษัท / หน่วยงาน</th><th>ลงชื่อ</th></tr>
    ${rows(visit, "<td></td><td></td><td></td><td></td>")}</table>
  <h2>3. รับแทนเป็นกลุ่ม <span>ใส่จำนวนจริง · รายชื่อแนบหลังใบหรือส่งให้ HR</span></h2>
  <table><colgroup><col style="width:8mm"><col style="width:40mm"><col style="width:22mm"><col><col style="width:34mm"></colgroup>
    <tr><th>ที่</th><th>กะ / แผนก</th><th>จำนวน (ที่)</th><th>ชื่อผู้รับ</th><th>ลงชื่อ</th></tr>
    ${rows(group, "<td></td><td></td><td></td><td></td>")}</table>
  <div class="ft"><div><b>รวมทั้งใบ ............ ที่</b><br>ผู้ดูแลร้านนับ</div><div><b>ลงชื่อผู้ดูแลร้าน</b><br>................................................</div>
    <div><b>HR รับใบ / คีย์แล้ว</b><br>วันที่ ............................</div></div>
</section>`;
}
export function printSheets(list, title = "ใบลงชื่อทานอาหาร") {
  const w = window.open("", "_blank");
  if (!w) { alert("เบราว์เซอร์บล็อกหน้าต่างใหม่ — อนุญาต pop-up แล้วลองอีกครั้ง"); return; }
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>${SHEET_CSS} body{margin:0;background:#eef1f6} @media print{body{background:#fff}}</style></head>
    <body><div class="sht">${list.map(x => signSheet(x, { logo: location.origin + "/assets/logo.png" })).join("")}</div>
    <script>document.fonts.ready.then(()=>setTimeout(()=>print(),300))<\/script></body></html>`);
  w.document.close();
}
