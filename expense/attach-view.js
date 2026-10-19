// ============================================================================
// ตัวดูไฟล์แนบในหน้า — ใช้ทั้งหน้าใบแจ้งหนี้ในระบบ (ผู้ตรวจ/ผู้อนุมัติ) และหน้าอนุมัติจากลิงก์อีเมล
//   แถบเลือกไฟล์ + พรีวิว: รูป = <img> · PDF = pdf.js วาดทุกหน้า · อื่น ๆ (Excel/Word) = ปุ่มดาวน์โหลด
//   จำว่าไฟล์ไหนเปิดดูแล้ว (unviewed()) เพื่อเตือนก่อนกดอนุมัติ — ไม่บังคับ (user, 2026-10-19)
//   ห้าม import js/app.js
// ============================================================================
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
      PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const MAX_PAGES = 30;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const kind = f => /\.pdf$/i.test(f.name) ? "pdf" : /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name) ? "img" : "other";
const fmtSize = n => !n ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

let pdfP = null;
const loadPdf = () => pdfP ||= new Promise((ok, no) => {
  if (window.pdfjsLib) return ok(window.pdfjsLib);
  const s = document.createElement("script"); s.src = PDFJS;
  s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; ok(window.pdfjsLib); };
  s.onerror = () => { pdfP = null; no(new Error("โหลดตัวแสดง PDF ไม่สำเร็จ")); };
  document.head.appendChild(s);
});

const CSS = `
.av-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.av-tab{display:flex;align-items:center;gap:6px;max-width:100%;padding:6px 10px;border:1px solid var(--line2,#CED5DF);border-radius:999px;background:#fff;font:inherit;font-size:13px;color:var(--ink2,#4B5565);cursor:pointer}
.av-tab span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px}
.av-tab i{font-style:normal;font-size:11px;color:var(--ink4,#9AA4B2)}
.av-tab.on{border-color:var(--blue,#2B5DA8);background:var(--blue-50,#EEF3FB);color:var(--blue,#2B5DA8);font-weight:500}
.av-tab.seen i{color:var(--green,#1F8A4C)}
.av-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;font-size:12.5px;color:var(--ink3,#6B7585)}
.av-bar .grow{flex:1;min-width:0;overflow-wrap:anywhere}
.av-view{border:1px solid var(--line,#E4E8EE);border-radius:var(--r-md,8px);background:#EEF0F3;max-height:80vh;overflow:auto;padding:10px;display:flex;flex-direction:column;align-items:center;gap:10px}
.av-view img,.av-view canvas{display:block;max-width:100%;height:auto;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.15)}
.av-msg{padding:36px 16px;text-align:center;color:var(--ink3,#6B7585);font-size:13.5px}
.av-sum{margin-top:8px;font-size:12.5px;color:var(--ink3,#6B7585)}.av-sum b{color:var(--ink,#121926)}
`;
function injectCss() {
  if (document.getElementById("avCss")) return;
  const s = document.createElement("style"); s.id = "avCss"; s.textContent = CSS; document.head.appendChild(s);
}

// box = element ที่จะวาดลงไป · files = [{id,name,size}] · getUrl(file) → Promise<url|"">
// seen = Set ของ id ที่ดูแล้ว — ส่งตัวเดิมเข้ามาเมื่อวาดใหม่ จะได้ไม่ลืมว่าดูไปแล้ว
export function attachViewer(box, files, getUrl, seen = new Set()) {
  injectCss();
  const urls = new Map();
  let cur = null, ticket = 0;
  const url = async f => { if (!urls.has(f.id)) urls.set(f.id, await getUrl(f).catch(() => "")); return urls.get(f.id); };

  function tabs() {
    return files.map(f => `<button type="button" class="av-tab${f.id === cur ? " on" : ""}${seen.has(f.id) ? " seen" : ""}" data-av="${f.id}" title="${esc(f.name)}">
      <span>${esc(f.name)}</span><i>${seen.has(f.id) ? "✓ ดูแล้ว" : kind(f) === "other" ? "ดาวน์โหลด" : "ยังไม่ดู"}</i></button>`).join("");
  }
  function draw() {
    if (!files.length) { box.innerHTML = `<div class="hint">ไม่มีเอกสารแนบ</div>`; return; }
    box.innerHTML = `<div class="av-tabs">${tabs()}</div><div class="av-bar" id="avBar"></div><div class="av-view" id="avView"></div>
      <div class="av-sum" id="avSum"></div>`;
    box.querySelectorAll("[data-av]").forEach(b => b.onclick = () => show(+b.dataset.av));
    show(cur ?? files[0].id);
  }
  const refreshTabs = () => {
    const t = box.querySelector(".av-tabs"); if (!t) return;
    t.innerHTML = tabs(); t.querySelectorAll("[data-av]").forEach(b => b.onclick = () => show(+b.dataset.av));
    const n = files.filter(f => seen.has(f.id)).length, sum = box.querySelector("#avSum");
    if (sum) sum.innerHTML = files.length > 1 ? `ดูแล้ว <b>${n}/${files.length}</b> ไฟล์${n < files.length ? " — กดชื่อไฟล์ด้านบนเพื่อดูไฟล์ถัดไป" : ""}` : "";
  };

  async function show(id) {
    const f = files.find(x => x.id === id); if (!f) return;
    cur = id; const my = ++ticket;
    const view = box.querySelector("#avView"), bar = box.querySelector("#avBar");
    view.innerHTML = `<div class="av-msg">กำลังโหลด ${esc(f.name)}…</div>`; refreshTabs();
    const u = await url(f); if (my !== ticket) return;
    if (!u) { bar.innerHTML = ""; view.innerHTML = `<div class="av-msg">เปิดไฟล์นี้ไม่ได้ — แจ้ง HR</div>`; return; }
    bar.innerHTML = `<span class="grow"><b>${esc(f.name)}</b> ${fmtSize(f.size)}</span>
      <a class="btn btn-s btn-sm" href="${esc(u)}" target="_blank" rel="noopener noreferrer" data-open>เปิดเต็มจอ ↗</a>`;
    bar.querySelector("[data-open]").addEventListener("click", () => { seen.add(f.id); refreshTabs(); });
    const k = kind(f);
    if (k === "img") {
      view.innerHTML = `<img alt="${esc(f.name)}">`;
      const im = view.querySelector("img");
      im.onload = () => { seen.add(f.id); refreshTabs(); };
      im.onerror = () => { view.innerHTML = `<div class="av-msg">แสดงรูปไม่ได้ — กด “เปิดเต็มจอ”</div>`; };
      im.src = u;
    } else if (k === "pdf") {
      try {
        const lib = await loadPdf();
        const buf = await fetch(u).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); });
        const doc = await lib.getDocument({ data: buf }).promise; if (my !== ticket) return;
        view.innerHTML = "";
        const w = Math.max(320, view.clientWidth - 20), dpr = Math.min(2, window.devicePixelRatio || 1);
        const n = Math.min(doc.numPages, MAX_PAGES);
        for (let p = 1; p <= n; p++) {
          const page = await doc.getPage(p); if (my !== ticket) return;
          const vp0 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: w / vp0.width * dpr });
          const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height; c.style.width = w + "px";
          view.appendChild(c);
          await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
          if (p === 1) { seen.add(f.id); refreshTabs(); }
        }
        if (doc.numPages > n) view.insertAdjacentHTML("beforeend", `<div class="av-msg">แสดง ${n} จาก ${doc.numPages} หน้า — กด “เปิดเต็มจอ” เพื่อดูทั้งหมด</div>`);
      } catch (_) {
        if (my === ticket) view.innerHTML = `<div class="av-msg">แสดง PDF ในหน้านี้ไม่ได้ — กด “เปิดเต็มจอ”</div>`;
      }
    } else {
      view.innerHTML = `<div class="av-msg">ไฟล์ชนิดนี้แสดงในหน้าไม่ได้<br><a class="btn btn-p btn-sm" style="margin-top:10px" href="${esc(u)}" target="_blank" rel="noopener noreferrer" data-dl>ดาวน์โหลด ${esc(f.name)}</a></div>`;
      view.querySelector("[data-dl]").addEventListener("click", () => { seen.add(f.id); refreshTabs(); });
    }
  }

  draw();
  return { unviewed: () => files.filter(f => !seen.has(f.id)) };
}

// ข้อความเตือนก่อนอนุมัติ ("" = ดูครบแล้ว)
export const unviewedWarning = list => !list.length ? "" :
  `ยังไม่ได้เปิดดูเอกสารแนบ ${list.length} ไฟล์:\n${list.map(f => "• " + f.name).join("\n")}\n\n`;
