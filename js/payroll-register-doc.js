// ============================================================================
// Payroll Register — เอกสารสำหรับพิมพ์ (A4 แนวนอน) · pure ไม่ import js/app.js
// ใช้ร่วมกันระหว่างหน้าสร้าง Payroll Register (js/payroll-build-ui.js) กับหน้าเซ็นจากลิงก์อีเมล (payroll/sign.js)
// มีแต่ยอดรวมระดับแผนก (rep จาก buildReport / repFromRows) ไม่มีตัวเลขรายคน
// ============================================================================
import * as PB from "./payroll-build.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
export const fmt  = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits:2, maximumFractionDigits:2 });
export const fmtI = n => Number(n || 0).toLocaleString("en-US");
// ประกันสังคมฝั่งนายจ้างรายแผนก — เดือนที่บันทึกไว้ก่อนเพิ่มบรรทัดนี้ มียอดรวมทั้งบริษัทแต่ไม่มียอดรายแผนก
// ตัดขอบใส/ขาวรอบหมึกของรูปลายเซ็น — ไฟล์ลายเซ็นมีขอบใต้หมึกไม่เท่ากัน ถ้าไม่ตัด ลายเซ็นจะลอยเหนือเส้น (ใช้ในเบราว์เซอร์)
export function cropInk(url) {
  if (!url) return Promise.resolve(url);
  return new Promise(res => {
    const im = new Image();
    im.onload = () => {
      try {
        const W = im.naturalWidth, H = im.naturalHeight, c = document.createElement("canvas"); c.width = W; c.height = H;
        const g = c.getContext("2d"); g.drawImage(im, 0, 0);
        const px = g.getImageData(0, 0, W, H).data;
        let x0 = W, y0 = H, x1 = -1, y1 = -1;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          if (px[i + 3] > 40 && px[i] + px[i + 1] + px[i + 2] < 600) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        if (x1 < 0) return res(url);
        const m = Math.round((y1 - y0) * 0.04), cx = Math.max(0, x0 - m), cy = Math.max(0, y0 - m);
        const cw = Math.min(W, x1 + m + 1) - cx, ch = Math.min(H, y1 + m + 1) - cy;
        const o = document.createElement("canvas"); o.width = cw; o.height = ch;
        o.getContext("2d").drawImage(c, cx, cy, cw, ch, 0, 0, cw, ch);
        res(o.toDataURL("image/png"));
      } catch { res(url); }
    };
    im.onerror = () => res(url); im.src = url;
  });
}
export const ssoKnown = rep => !(rep.ded?.ssoEmployer) || [...rep.cells.keys()].some(k => k.startsWith("ded|ssoEmployer|"));

// ============================================================================
// ไฟล์ออก
// ============================================================================
// โครงใหม่ตามที่ตกลง: ชีตสรุป 1 ชีต แล้วแยกชีตตามสายงาน
// ของเดิมเป็นตารางเดียวกว้าง 27 คอลัมน์ ซึ่งพิมพ์ออกมาแล้วอ่านยาก
export const LINES = [
  ["sec",  "SENIOR STAFF",   "senior"],
  ["hc",   "Headcount",      "senior"],
  ...PB.SENIOR_LINES.map(l => ["amt", l, "senior"]),
  ["tot",  "Total — Senior Staff", "senior"],
  ["sec",  "STAFF",          "staff"],
  ["hc",   "Headcount",      "staff"],
  ...PB.STAFF_LINES.map(l => ["amt", l, "staff"]),
  ["tot",  "Total — Staff",  "staff"],
  ["sec",  "ANNUAL LEAVE (RESIGNED) & COMPENSATE", "annualLeave"],
  ["amt",  "Amount",         "annualLeave"],
  ["sec",  "EMPLOYEES BONUS", "bonus"],
  ["amt",  "Amount",         "bonus"],
  ["sec",  "PROVISION FOR SEVERANCE PAYMENTS", "severance"],
  ["amt",  "Amount",         "severance"],
  ["sec",  "CONSULTANTS — TECHNICAL", "consultants"],
  ["hc",   "Headcount",      "consultants"],
  ["amt",  "Amount",         "consultants"],
  ["sec",  "CONTRACTORS — OTHER", "contractors"],
  ["hc",   "Headcount",      "contractors"],
  ["amt",  "Amount",         "contractors"],
  ["sec",  "CASUAL LABOUR",  "casual"],
  ["hc",   "Headcount",      "casual"],
  ["amt",  "Amount",         "casual"],
  // กรรมการบริษัท — ไม่ใช่ทั้งที่ปรึกษาและจ้างเหมา จึงแยกเป็นหมวดของตัวเองต่อจากแรงงานรายวัน
  ["sec",  "DIRECTOR'S FEE", "director"],
  ["hc",   "Headcount",      "director"],
  ["amt",  "Amount",         "director"],
];
export const SECTION_LINES = { senior:PB.SENIOR_LINES, staff:PB.STAFF_LINES };

// ค่าของช่องหนึ่งในตาราง (คืน null เมื่อบรรทัดนั้นไม่มีค่า เช่นแถวหัวข้อ)
export function valueOf(rep, kind, line, section, dept) {
  if (kind === "hc")  return rep.headcount(section, dept);
  if (kind === "amt") return rep.get(section, line, dept);
  if (kind === "tot") return (SECTION_LINES[section] || []).reduce((s, l) => s + rep.get(section, l, dept), 0);
  return null;
}
export const costCodeOf = (section, dept) => {
  const i = PB.SECTION_KEYS.indexOf(section);
  const c = PB.COST_CODES[dept]?.[i];
  return c && c !== "n/a" ? c : "";
};

// signers: [{ role, dept, name, title, sig?: รูปลายเซ็น (data URL / URL), date?: "19 Oct 2026" }]
// opts.toolbar = ปุ่มพิมพ์ใต้เอกสาร (หน้าพิมพ์ของ HR) · หน้าลิงก์อนุมัติไม่ใส่
export function registerDoc(rep, month, signers, opts = {}) {
  const logo = opts.logo || new URL("/assets/logo.png", location.href).href;

  const sigBlock = `<div class="sigs">${signers.map(sg => `
    <div class="sig">
      <div class="sig-role">${esc((sg.role || "").toUpperCase())}</div>
      ${sg.dept ? `<div class="sig-dept">${esc(sg.dept)}</div>` : ""}
      <div class="sig-space">${sg.sig ? `<img src="${esc(sg.sig)}" alt="">` : ""}</div>
      <div class="sig-rule"></div>
      <div class="sig-name">${esc(sg.name || "")}</div>
      <div class="sig-title">${esc(sg.title || "")}</div>
      <div class="sig-date">Date&nbsp;&nbsp;${sg.date ? esc(sg.date) : "______________________"}</div>
    </div>`).join("")}</div>`;

  const head = sub => `
    <div class="top">
      <div class="brand"><img class="logo" src="${logo}" alt="Akara Resources">
        <div class="bw2">Chatree Gold Mine</div></div>
      <div class="meta"><div class="m1">PAYROLL REGISTER</div>
        <div class="m2">${esc(sub)}${month ? `  ·  ${esc(monthLabel(month))}` : ""}</div></div>
    </div>
    <div class="rule"></div>`;

  // คอลัมน์แผนกกว้างเท่ากันทุกช่องเสมอ ไม่ว่าสายงานนั้นจะมีกี่แผนก
  const cols = n => `<colgroup><col class="c-item"><col class="c-code">${
    Array.from({ length:n }, () => `<col class="c-dep" style="width:${(61 / n).toFixed(3)}%">`).join("")}<col class="c-tot"></colgroup>`;

  // ลายเซ็นผู้อนุมัติ (ช่องสุดท้าย) แปะมุมขวาล่างทุกหน้าแยกสายงาน — แบบอักษรย่อมุมหน้า Offer Letter (user 2026-10-21)
  //   หน้าสรุปมีช่องลงนามเต็มอยู่แล้ว · ขึ้นเฉพาะเมื่อผู้อนุมัติลงนามแล้ว
  const apr = signers[signers.length - 1];
  const corner = apr?.sig ? `<img class="foot-sig" src="${esc(apr.sig)}" alt="" title="${esc(apr.name || "")}">` : "";
  const page = (title, depts) => `
    <div class="sheet">
      ${head(title)}
      <table class="grid">
        ${cols(depts.length)}
        <thead><tr><th class="l">ITEM</th><th class="c">COST CODE</th>
          ${depts.map(d => `<th class="n">${esc(d)}</th>`).join("")}<th class="n">TOTAL</th></tr></thead>
        <tbody>
        ${LINES.map(([kind, line, section]) => {
          if (kind === "sec") return `<tr class="sec"><td class="l">${esc(line)}</td><td></td>${
            depts.map(d => `<td class="cc">${esc(costCodeOf(section, d))}</td>`).join("")}<td></td></tr>`;
          const vals = depts.map(d => valueOf(rep, kind, line, section, d));
          const sum = vals.reduce((a, b) => a + b, 0);
          const f = v => kind === "hc" ? fmtI(v) : fmt(v);
          return `<tr class="${kind === "tot" ? "tot" : ""}"><td class="l">${esc(line)}</td>
            <td class="c u">${kind === "hc" ? "persons" : ""}</td>
            ${vals.map(v => `<td class="n">${f(v)}</td>`).join("")}
            <td class="n b">${f(sum)}</td></tr>`;
        }).join("")}
        <tr class="hcrow"><td class="l">TOTAL HEADCOUNT</td><td class="c u">persons</td>
          ${depts.map(d => `<td class="n">${fmtI(PB.deptHeadcount(rep, d))}</td>`).join("")}
          <td class="n b">${fmtI(depts.reduce((t, d) => t + PB.deptHeadcount(rep, d), 0))}</td></tr>
        <tr class="gt"><td class="l">GRAND TOTAL — PAYROLL EXPENSE</td><td></td>
          ${depts.map(d => `<td class="n">${fmt(PB.deptTotal(rep, d))}</td>`).join("")}
          <td class="n">${fmt(depts.reduce((t, d) => t + PB.deptTotal(rep, d), 0))}</td></tr>
        ${dedRows(depts)}
        </tbody>
      </table>
      <div class="flex"></div>
      <div class="foot"><span>${esc(title)}  ·  ${esc(monthLabel(month))}</span>${corner}</div>
    </div>`;

  // รายการหักแยกรายแผนก — ต้นฉบับแสดงแบบนี้ในทุกคอลัมน์แผนก
  const dedRows = depts => {
    const known = rep.dedByDept !== false;
    const row = (label, code, fn, cls = "", knownIf = true) => {
      const ok = known && knownIf;
      const vals = depts.map(fn);
      return `<tr class="${cls}"><td class="l">${esc(label)}</td><td class="cc c">${esc(code || "")}</td>
        ${vals.map(v => `<td class="n">${ok ? fmt(v) : "—"}</td>`).join("")}
        <td class="n b">${ok ? fmt(vals.reduce((a, b) => a + b, 0)) : "—"}</td></tr>`;
    };
    return `<tr class="sec"><td class="l" colspan="2">DEDUCTION — STAFF EXPENSES</td>${depts.map(() => "<td></td>").join("")}<td></td></tr>
      ${PB.DED_LINES.map(([k, l]) => row(l, PB.DED_CODES[k], d => PB.deptDed(rep, d, k))).join("")}
      ${row("GRAND TOTAL — DEDUCTION", "", d => PB.deptDeduction(rep, d), "tot")}
      ${row("NET SALARY", "", d => PB.deptNet(rep, d), "gt")}
      <tr class="sec"><td class="l" colspan="2">PROVIDENT FUND : K MASTER POOL FUND</td>${depts.map(() => "<td></td>").join("")}<td></td></tr>
      ${row("Provident Fund Employer Contribution", PB.DED_CODES.pvdEmployer, d => PB.deptDed(rep, d, "pvdEmployer"))}
      <tr class="sec"><td class="l" colspan="2">SOCIAL SECURITY</td>${depts.map(() => "<td></td>").join("")}<td></td></tr>
      ${row("Social Security Employer Contribution", "", d => PB.deptDed(rep, d, "ssoEmployer"), "", ssoKnown(rep))}`;
  };

  const hcOf = g => ["senior","staff","consultants","contractors","casual"].reduce((t, s) => t + PB.groupHc(rep, s, g), 0);
  const summary = `
    <div class="sheet">
      ${head("Summary")}
      <div class="kpis">
        ${[["Total Payroll Expense", fmt(PB.grandExpense(rep))],
           ["Total Deduction", fmt(PB.totalDeduction(rep))],
           ["Net Salary", fmt(PB.netSalary(rep))],
           ["Total Headcount (persons)", fmtI(PB.grandHeadcount(rep))]]
          .map(([l, v], i) => `<div class="kpi ${i === 2 ? "kpi-net" : ""}"><div class="kl">${esc(l)}</div><div class="kv">${v}</div></div>`).join("")}
      </div>
      <div class="two">
        <table class="grid">
          <colgroup><col style="width:46%"><col style="width:22%"><col style="width:32%"></colgroup>
          <thead><tr><th class="l">DIVISION</th><th class="n">HEADCOUNT (persons)</th><th class="n">PAYROLL EXPENSE (THB)</th></tr></thead>
          <tbody>
          ${PB.GROUPS.map(g => `<tr><td class="l">${esc(g.name)}</td><td class="n">${fmtI(hcOf(g))}</td>
            <td class="n">${fmt(g.depts.reduce((t, d) => t + PB.deptTotal(rep, d), 0))}</td></tr>`).join("")}
          ${PB.STANDALONE.map(d => `<tr><td class="l">${esc(d)}</td>
            <td class="n">${fmtI(["senior","staff","consultants","contractors","casual"].reduce((t, s) => t + rep.headcount(s, d), 0))}</td>
            <td class="n">${fmt(PB.deptTotal(rep, d))}</td></tr>`).join("")}
          <tr class="gt"><td class="l">GRAND TOTAL</td><td class="n">${fmtI(PB.grandHeadcount(rep))}</td>
            <td class="n">${fmt(PB.grandExpense(rep))}</td></tr>
          </tbody>
        </table>
        <table class="grid">
          <colgroup><col style="width:52%"><col style="width:22%"><col style="width:26%"></colgroup>
          <thead><tr><th class="l">DEDUCTION — STAFF EXPENSES</th><th class="c">COST CODE</th><th class="n">THB</th></tr></thead>
          <tbody>
          ${[["Provident Fund", PB.DED_CODES.pvd, rep.ded.pvd],
             ["Social Security", PB.DED_CODES.sso, rep.ded.sso],
             ["Student Loan (general)", PB.DED_CODES.studentLoan, rep.ded.studentLoan],
             ["Legal Execution Department", PB.DED_CODES.led, rep.ded.led],
             ["Clearing Account — Employee W/Tax (PND 1)", PB.DED_CODES.pnd1, rep.ded.pnd1],
             ["CL ACC EXP — Clearing Account W/Tax (PND 3)", PB.DED_CODES.pnd3, rep.ded.pnd3]]
            .map(([l, c, v]) => `<tr><td class="l">${esc(l)}</td><td class="cc">${esc(c)}</td><td class="n">${fmt(v)}</td></tr>`).join("")}
          <tr class="tot"><td class="l">GRAND TOTAL — DEDUCTION</td><td></td><td class="n b">${fmt(PB.totalDeduction(rep))}</td></tr>
          <tr class="gt"><td class="l">NET SALARY</td><td></td><td class="n">${fmt(PB.netSalary(rep))}</td></tr>
          <tr><td class="l pf">Provident Fund Employer Contribution</td><td class="cc">${esc(PB.DED_CODES.pvdEmployer)}</td>
            <td class="n">${fmt(rep.ded.pvdEmployer)}</td></tr>
          <tr><td class="l pf">Social Security Employer Contribution</td><td class="cc"></td>
            <td class="n">${fmt(rep.ded.ssoEmployer || 0)}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="flex"></div>
      ${sigBlock}
    </div>`;

  const pages = [summary, ...PB.GROUPS.map(g => page(g.name, g.depts)), page("BKK Office & Legal", PB.STANDALONE)];

  return `<!doctype html><html lang="th"><head><meta charset="utf-8">
    <title>Payroll Register ${esc(month)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>${PRINT_CSS}</style></head><body>${pages.join("")}
    ${opts.toolbar ? `<div class="noprint"><button onclick="window.print()">🖨 พิมพ์ / บันทึกเป็น PDF</button>
      <div class="tip">ตั้ง Paper size = A4 · Layout = Landscape · ปิด Headers and footers</div></div>` : ""}
    </body></html>`;
}

export const monthLabel = ym => {
  if (!ym) return "";
  const [y, m] = ym.split("-").map(Number);
  return `${["January","February","March","April","May","June","July","August","September","October","November","December"][m-1]} ${y}`;
};

const PRINT_CSS = `
/* ดีไซน์ตามที่วางไว้ใน Figma — เรียบ ทางการ ไม่มีเส้นตารางทึบทั้งผืน
   ใช้หัวตารางสีกรมท่า เส้นคั่นบาง ๆ และตัวเลขแบบความกว้างเท่ากันทุกหลัก */
@page { size: A4 landscape; margin: 10mm 11mm; }
*{box-sizing:border-box;}
body{font-family:'Sarabun',system-ui,sans-serif;font-size:6.7pt;color:#101828;background:#fff;margin:0;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;}
.sheet{page-break-after:always;display:flex;flex-direction:column;min-height:178mm;}
.sheet:last-of-type{page-break-after:auto;}
.flex{flex:1;}

/* หัวกระดาษ */
.top{display:flex;align-items:center;justify-content:space-between;}
.brand{display:flex;align-items:center;gap:4mm;}
.logo{height:8.5mm;}
.bw2{font-size:7.4pt;font-weight:600;color:#1A3E9A;letter-spacing:.2pt;}
.meta{text-align:right;}
.m1{font-size:10pt;font-weight:700;letter-spacing:.3pt;}
.m2{font-size:7.4pt;color:#667085;}
.rule{height:1.4pt;background:#0F1C4D;margin:1.1mm 0 2mm;}

/* ตาราง */
table.grid{border-collapse:collapse;width:100%;table-layout:fixed;}
/* ความกว้างคอลัมน์ต้องกำหนดเอง ไม่งั้น ITEM แคบจนหัวข้อยาว ๆ ขึ้นสองบรรทัดแล้วกินที่ทั้งหน้า */
.c-item{width:21%;} .c-code{width:7%;} .c-tot{width:11%;}
.grid th,.grid td{padding:.16mm 1.3mm;overflow:hidden;line-height:1.16;white-space:nowrap;text-overflow:ellipsis;}
.grid thead th{white-space:normal;}
.grid thead th{background:#0F1C4D;color:#fff;font-weight:600;font-size:6.8pt;
  text-align:right;vertical-align:bottom;line-height:1.2;}
.grid thead th.l{text-align:left;} .grid thead th.c{text-align:center;}
.grid tbody tr{border-bottom:.4pt solid #E4E7EC;}
.l{text-align:left;} .c{text-align:center;} .n{text-align:right;font-variant-numeric:tabular-nums;}
.b{font-weight:600;} .u{color:#667085;font-size:6.6pt;}
.cc{text-align:right;font-size:5.8pt;color:#98A2B3;letter-spacing:.1pt;}
tr.sec td{background:#EEF1F8;font-weight:700;font-size:6.7pt;}
tr.sec td.cc{font-weight:400;}
tr.tot td{background:#F7FAFC;font-weight:600;}
tr.hcrow td{background:#F7FAFC;font-weight:600;border-top:.8pt solid #CBD5E1;}
tr.gt td{border-top:1.4pt solid #0F1C4D;border-bottom:0;font-weight:700;color:#0F1C4D;font-size:7.5pt;
  padding-top:.9mm;padding-bottom:.9mm;}
.pf{color:#475467;}

/* หน้าสรุป */
.kpis{display:flex;gap:3mm;margin-bottom:3mm;}
.kpi{flex:1;background:#F7FAFC;border:.4pt solid #E4E7EC;border-radius:2mm;padding:2.4mm 3mm;}
.kl{font-size:6.6pt;color:#667085;}
.kv{font-size:12pt;font-weight:700;color:#0F1C4D;font-variant-numeric:tabular-nums;}
.kpi-net .kv{color:#0D7C4B;}
.two{display:flex;gap:6mm;align-items:flex-start;}
.two>table{flex:1;}

/* ลายเซ็น */
.sigs{display:flex;gap:14mm;padding-top:4mm;page-break-inside:avoid;}
.sig{flex:1;}
.sig-role{font-size:6pt;font-weight:700;color:#101828;letter-spacing:.7pt;}
.sig-dept{font-size:6.4pt;color:#B7791F;}
.sig-space{height:8mm;position:relative;}
/* ให้ดูเหมือนเซ็นมือจริงบนกระดาษ (ตัวอย่างที่ user ส่ง 2026-10-21): ใหญ่ เริ่มเยื้องจากซ้ายเล็กน้อย หมึกทับเส้นลงไปนิดหนึ่ง */
.sig-space img{position:absolute;left:12%;bottom:-3mm;height:13mm;max-width:70%;object-fit:contain;object-position:left bottom;mix-blend-mode:multiply;z-index:1;}
.sig-rule{height:.5pt;background:#101828;}
.sig-name{font-size:7.4pt;font-weight:600;margin-top:1.4mm;}
.sig-title{font-size:6.8pt;color:#667085;}
.sig-date{font-size:6.8pt;color:#667085;margin-top:1.2mm;}

.foot{font-size:6.4pt;color:#98A2B3;text-align:right;padding-top:2mm;border-top:.4pt solid #E4E7EC;display:flex;justify-content:flex-end;align-items:flex-end;gap:4mm;}
.foot-sig{height:8mm;max-width:30mm;object-fit:contain;object-position:right bottom;mix-blend-mode:multiply;margin:-3mm 0 -1mm;}
.noprint{margin:6mm 0;text-align:center;}
.noprint button{font:inherit;padding:8px 18px;cursor:pointer;border:1px solid #0F1C4D;background:#0F1C4D;color:#fff;border-radius:6px;}
.noprint .tip{font-size:8pt;color:#667085;margin-top:3mm;}
@media print{.noprint{display:none;}}
/* บนจอ (หน้าลิงก์ลงนาม / หน้าพรีวิว) — แสดงเป็นแผ่นกระดาษแยกกัน ไม่ให้หัวหน้าถัดไปชนช่องลงนาม */
@media screen{
  body{background:#E9ECF1;padding:6mm 0;}
  .sheet{background:#fff;width:297mm;min-height:210mm;padding:10mm 11mm;margin:0 auto 6mm;box-shadow:0 1px 4px rgba(16,24,40,.12);}
}
`;
