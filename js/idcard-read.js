// ============================================================================
// อ่านบัตรประชาชนจากรูป / PDF ในเบราว์เซอร์ (Tesseract.js tha+eng · pdf.js) — ไฟล์ไม่ถูกส่งขึ้นที่ไหน
//   ใช้โดยหน้าสัญญาจ้าง (js/emp-contract.js) · ตัวแยกข้อความ parseIdCard อยู่ใน emp-contract-doc.js (มีเทส)
//   ไฟล์จริงที่เจอ (2026-10-15): ถ่ายรูปสำเนาบัตรบน A4 — บัตรเล็กกลางหน้า แสงไม่เท่ากัน มีลายมือทับ
//   → ปรับแสงพื้นหลังให้เรียบ · หาตำแหน่งบัตรจากความหนาแน่นของหมึก · ตัดเฉพาะบัตรแล้วขยายก่อนอ่าน
//   ห้าม import app.js
// ============================================================================
import { parseIdCard, mergeReads, readScore } from "./emp-contract-doc.js";

const CDN = { tess: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
  pdf: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", pdfWorker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js" };
export const setCdn = o => Object.assign(CDN, o);   // เทสใช้ไฟล์ในเครื่อง
let tessP = null, pdfP = null, workerOpts = {};
export const setWorkerOpts = o => { workerOpts = o; };
const script = (src, ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); };
const loadTess = () => tessP ||= new Promise((ok, no) => window.Tesseract ? ok(window.Tesseract) : script(CDN.tess, () => ok(window.Tesseract), () => { tessP = null; no(new Error("โหลดตัวอ่านภาพไม่สำเร็จ")); }));
const loadPdf = () => pdfP ||= new Promise((ok, no) => window.pdfjsLib ? ok(window.pdfjsLib) : script(CDN.pdf, () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker; ok(window.pdfjsLib); },
  () => { pdfP = null; no(new Error("โหลดตัวอ่าน PDF ไม่สำเร็จ")); }));

export const score = readScore;
const canvasOf = (w, h) => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

// หน้า PDF / รูป → canvas (+ ข้อความในไฟล์ ถ้า PDF มีตัวหนังสือ)
export async function pagesOf(file, max = 3) {
  if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
    const img = await createImageBitmap(file), c = canvasOf(img.width, img.height); c.getContext("2d").drawImage(img, 0, 0); return [{ text: "", canvas: c }];
  }
  const lib = await loadPdf(), doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise, out = [];
  for (let n = 1; n <= Math.min(max, doc.numPages); n++) {
    const page = await doc.getPage(n), tc = await page.getTextContent(), text = tc.items.map(i => i.str + (i.hasEOL ? "\n" : " ")).join("");
    const vp0 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: Math.min(4, 3000 / Math.max(vp0.width, vp0.height)) }), c = canvasOf(vp.width, vp.height);
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    out.push({ text, canvas: c });
  }
  return out;
}

// ขาวดำ + ปรับแสงพื้นหลังให้เรียบ (หารด้วยภาพเบลอ) + ยืดความต่าง · ปรับขนาดให้กว้าง targetW (ขยายไม่เกิน 4 เท่า)
export function normalize(src, rect = null, targetW = 2200) {
  const r = rect || { x: 0, y: 0, w: src.width, h: src.height }, k = Math.min(4, targetW / r.w);
  const c = canvasOf(r.w * k, r.h * k), g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high"; g.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  // พื้นหลัง = ค่าสว่างสุดในแต่ละช่อง (กระดาษ) ขยายเพื่อนบ้านอีก 1 ช่อง แล้วเกลี่ยกลับเต็มภาพ — ไม่เกิดขอบขาวรอบตัวหนังสือแบบหารด้วยภาพเบลอ
  const px = g.getImageData(0, 0, c.width, c.height), a = px.data, W = c.width, H = c.height, Y = new Float32Array(W * H);
  for (let i = 0, j = 0; j < Y.length; i += 4, j++) Y[j] = .299 * a[i] + .587 * a[i + 1] + .114 * a[i + 2];
  const B = Math.max(8, Math.round(Math.max(W, H) / 50)), bw = Math.ceil(W / B), bh = Math.ceil(H / B), mx = new Float32Array(bw * bh);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = ((y / B) | 0) * bw + ((x / B) | 0); if (Y[y * W + x] > mx[k]) mx[k] = Y[y * W + x]; }
  const s = canvasOf(bw, bh), sg = s.getContext("2d", { willReadFrequently: true }), si = sg.createImageData(bw, bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    let m = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < bh && xx >= 0 && xx < bw) m = Math.max(m, mx[yy * bw + xx]); }
    const o = (y * bw + x) * 4; si.data[o] = si.data[o + 1] = si.data[o + 2] = m; si.data[o + 3] = 255;
  }
  sg.putImageData(si, 0, 0); const b = canvasOf(W, H), bg = b.getContext("2d", { willReadFrequently: true });
  bg.imageSmoothingQuality = "high"; bg.drawImage(s, 0, 0, W, H);
  const bd = bg.getImageData(0, 0, W, H).data, hist = new Uint32Array(256);
  for (let i = 0, j = 0; j < Y.length; i += 4, j++) { const v = Math.min(255, Math.round(Y[j] / Math.max(30, bd[i]) * 255)); a[i] = v; hist[v]++; }
  // ยืดช่วง: มืดสุด 1% → ดำ · สว่างสุด 30% (กระดาษ) → ขาว
  const n = a.length / 4; let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * .01) { lo = v; break; } }
  acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * .3) { hi = v; break; } }
  const m = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < a.length; i += 4) { const v = Math.min(255, Math.max(0, (a[i] - lo) * m)); a[i] = a[i + 1] = a[i + 2] = v; }
  g.putImageData(px, 0, 0); return c;
}

// หาตำแหน่งที่น่าจะเป็นบัตร: ย่อหน้าเป็นตาราง ช่องที่มีหมึกหนาแน่น → กลุ่มที่ต่อกัน → กรอบ (เรียงจากใหญ่ไปเล็ก)
export function regions(src, maxN = 3) {
  const W = 320, H = Math.round(src.height * W / src.width), n = normalize(src, null, W), d = n.getContext("2d").getImageData(0, 0, n.width, n.height).data;
  const C = 5, gw = Math.ceil(n.width / C), gh = Math.ceil(n.height / C), ink = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let dark = 0, tot = 0;
    for (let y = gy * C; y < Math.min(n.height, gy * C + C); y++) for (let x = gx * C; x < Math.min(n.width, gx * C + C); x++) { tot++; if (d[(y * n.width + x) * 4] < 140) dark++; }
    ink[gy * gw + gx] = dark / tot > .06 ? 1 : 0;
  }
  // ขยาย 1 ช่อง ให้ตัวอักษรในบรรทัดเดียวกันต่อกัน
  const dil = new Uint8Array(ink.length);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (ink[y * gw + x]) for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) dil[yy * gw + xx] = 1; }
  const seen = new Uint8Array(dil.length), comps = [];
  for (let i = 0; i < dil.length; i++) {
    if (!dil[i] || seen[i]) continue;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, cnt = 0; const st = [i]; seen[i] = 1;
    while (st.length) { const j = st.pop(), x = j % gw, y = (j / gw) | 0; cnt += ink[j]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy, k = yy * gw + xx; if (xx >= 0 && xx < gw && yy >= 0 && yy < gh && dil[k] && !seen[k]) { seen[k] = 1; st.push(k); } } }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw * bh > gw * gh * .015 && cnt > 12 && bw > 6) comps.push({ x0, y0, x1, y1, cnt });
  }
  const sx = src.width / n.width;
  return comps.sort((a, b) => b.cnt - a.cnt).slice(0, maxN).map(c => {
    const pad = 2; const x = Math.max(0, (c.x0 - pad) * C * sx), y = Math.max(0, (c.y0 - pad) * C * sx);
    return { x, y, w: Math.min(src.width - x, (c.x1 - c.x0 + 1 + 2 * pad) * C * sx), h: Math.min(src.height - y, (c.y1 - c.y0 + 1 + 2 * pad) * C * sx) };
  });
}

async function worker(onProgress) {
  const T = await loadTess();
  return T.createWorker(["tha", "eng"], 1, { ...workerOpts, logger: m => m.status === "recognizing text" && onProgress?.(Math.round(m.progress * 100)) });
}
// เก็บกรอบบรรทัดที่มีตัวเลข 12–14 ตัว (บรรทัดเลขบัตร) ไว้อ่านซ้ำแบบตัวเลขล้วนถ้าเลขตรวจสอบไม่ผ่าน
const ocr = async (w, canvas) => {
  const { data } = await w.recognize(canvas), r = parseIdCard(data.text);
  const ln = (data.lines || []).find(l => { const n = (l.text.match(/\d/g) || []).length; return n >= 11 && n <= 15; });
  return { ...r, raw: data.text, idSrc: ln ? { canvas, box: ln.bbox } : null };
};
// อ่านบรรทัดเลขบัตรซ้ำ: ตัด เฉพาะบรรทัด ขยายให้สูง ~90px · Tesseract อังกฤษ รับเฉพาะตัวเลข โหมดบรรทัดเดียว · ลองหลายขนาด เอาชุดที่เลขตรวจสอบผ่าน
async function rereadId(srcs) {
  if (!srcs.length) return "";
  const T = await loadTess(), w = await T.createWorker("eng", 1, workerOpts);
  try {
    await w.setParameters({ tessedit_char_whitelist: "0123456789 ", tessedit_pageseg_mode: "7" });
    for (const { canvas, box } of srcs) for (const h of [90, 60, 130]) {
      const bh = box.y1 - box.y0, pad = bh * .35, x = Math.max(0, box.x0 - pad), y = Math.max(0, box.y0 - pad), cw = Math.min(canvas.width - x, box.x1 - box.x0 + 2 * pad), ch = Math.min(canvas.height - y, bh + 2 * pad), k = h / bh;
      const c = canvasOf(cw * k, ch * k), g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = "high"; g.drawImage(canvas, x, y, cw, ch, 0, 0, c.width, c.height);
      const { data } = await w.recognize(c), r = parseIdCard(data.text);
      if (r.idOk) return r.id;
    }
  } finally { await w.terminate(); }
  return "";
}

// อ่านทั้งไฟล์: ข้อความใน PDF → ทั้งหน้า → ตัดเฉพาะส่วนที่น่าจะเป็นบัตร · รวมช่องที่ดีสุดจากทุกรอบ + หน้า (ไว้ให้ HR ลากกรอบเองถ้ายังไม่ครบ)
export const complete = r => !!(r && r.idOk && r.name_th && r.birth_date && r.address);
export async function readIdCard(file, onProgress = () => {}) {
  const pages = await pagesOf(file), reads = []; let w = null, merged = null;
  const keep = r => { reads.push(r); merged = mergeReads(reads); return complete(merged); };
  try {
    pg: for (let i = 0; i < pages.length; i++) {
      const pg = pages[i], base = { page: i + 1, canvas: pg.canvas };
      if (keep({ ...parseIdCard(pg.text), raw: pg.text, ...base })) break;
      w ||= await worker(p => onProgress(`หน้า ${i + 1}: อ่านทั้งหน้า ${p}%`));
      if (keep({ ...(await ocr(w, normalize(pg.canvas))), ...base })) break;
      // สำเนาหน้า-หลังบัตรมักติดกันเป็นก้อนสูง → ลองส่วนบนขนาดเท่าบัตร (กว้าง:สูง ≈ 1.58) ก่อน
      const rs = regions(pg.canvas).flatMap(r => r.h > r.w * .8 ? [{ ...r, h: r.w / 1.45 }, r] : [r]);
      for (let k = 0; k < rs.length; k++) {
        onProgress(`หน้า ${i + 1}: อ่านเฉพาะบัตร (${k + 1}/${rs.length})`);
        if (keep({ ...(await ocr(w, normalize(pg.canvas, rs[k], 2000))), ...base, rect: rs[k] })) break pg;
      }
      if (merged.idOk && merged.name_th) break;
    }
    if (!merged.idOk) { onProgress("อ่านเลขบัตรซ้ำ"); const id = await rereadId(reads.filter(r => r.idSrc).map(r => r.idSrc)); if (id) merged = { ...merged, id, idOk: true }; }
  } finally { if (w) await w.terminate(); }
  const { idSrc, ...out } = merged;
  return { ...out, raw: reads.map(r => r.raw).filter(Boolean).join("\n――――\n"), pages };
}
// HR ลากกรอบเอง → อ่านเฉพาะในกรอบ
export async function readRegion(canvas, rect, onProgress = () => {}) {
  const w = await worker(p => onProgress(`อ่านส่วนที่เลือก ${p}%`));
  try { const r = await ocr(w, normalize(canvas, rect, 2000));
    if (!r.idOk && r.idSrc) { const id = await rereadId([r.idSrc]); if (id) Object.assign(r, { id, idOk: true }); }
    delete r.idSrc; return { ...r, canvas, rect };
  } finally { await w.terminate(); }
}
