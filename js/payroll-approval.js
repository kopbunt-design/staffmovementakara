// ===== ใบสรุปอนุมัติเงินเดือน (Payroll Approval Cover Summary) =====
// ออกเป็น 2 ใบแยกกัน — งวดพนักงานประจำ กับ งวดลูกจ้างสัญญา (หัก ณ ที่จ่าย 3%)
//
// ⚠️ ความลับของข้อมูลเงินเดือน
// ไฟล์ BeforeProcessYDP มีเงินเดือนรายคนทั้งบริษัท หน้านี้อ่านไฟล์ "ในเบราว์เซอร์เท่านั้น"
// รวมเป็นยอดรวมแล้วทิ้งรายคนไปทันที — ไม่เคยส่งขึ้น Supabase และไม่เก็บลง localStorage
// (ผู้ใช้กำหนดไว้ตั้งแต่ทำหน้า Payroll Report: "upload ยอดแต่ช่องเข้าไป เพราะข้อมูลเงินเดือนเป็นความลับ")
import { esc, toast, can, allEmployees, sepYM, hcAtMonthEnd, lastDayOfMonth } from "./app.js";

const SHEET = "BeforeProcessYDP";

// ---------- การจัดกลุ่มคอลัมน์ ----------
// ชื่อคอลัมน์ต้องตรงกับหัวตารางในไฟล์ที่ระบบเงินเดือน export ออกมา
// ถ้าเจอคอลัมน์ที่ไม่มีในลิสต์ หน้าจะเตือน ไม่เงียบ — เพราะยอดที่หายไปเงียบ ๆ คือสิ่งที่อันตรายที่สุด
const ID_COLS = ["รหัสพนักงาน", "ชื่อ-นามสกุล", "สถานะคนลาออก"];
const TOTAL_COLS = ["รายได้สุทธิ", "รวมรายได้", "รวมรายหัก", "สุทธิ"];
const EMPLOYER_COLS = ["ประกันสังคมบริษัทสมทบ", "กองทุนบริษัทสมทบ", "กองทุนสงเคราะห์บริษัทสมทบ"];

// บรรทัดที่จะโชว์ในใบ — เรียงตามใบที่ HR เซ็นอยู่ทุกเดือน
const INCOME_LINES = [
  { key:"basic",     en:"Basic Salary",                    cols:["เงินเดือน","ตกเบิกเงินเดือน"] },
  { key:"ot",        en:"Overtime Pay",                    cols:["โอที 1","โอที 1.5","โอที 2","โอที 2.5","โอที 3","โอทีเหมาชม.","ตกเบิกโอที"] },
  { key:"shift",     en:"Shift Allowance",                 cols:["ค่ากะปกติ","ค่ากะ","ค่ากะโอที","ค่ากะเกินโอที"] },
  { key:"food",      en:"Food Allowance",                  cols:["ค่าอาหารปกติ","ค่าอาหารโอที","ค่าอาหารเกินโอที"] },
  { key:"transport", en:"Transportation Allowance",        cols:["เงินทดแทนการจัดรถรับส่ง"] },
  { key:"leavepay",  en:"Unused AL / CL Payout",           cols:["เงินจ่ายคืนวันลา"] },
  { key:"bonus",     en:"Bonus",                           cols:["โบนัส"] },
  { key:"ert",       en:"ERT Training",                    cols:["ค่าฝึกอบรม ERT"] },
  { key:"housing",   en:"Relocation Allowance",            cols:["เงินช่วยเหลือค่าเช่าที่พักอาศัย"] },
  { key:"cosec",     en:"Company Secretary Remuneration",  cols:["ค่าตอบแทนเลขานุการบริษัท"] },
  { key:"director",  en:"Directory Fee",                    cols:["ค่าตอบแทนกรรมการ"] },
  { key:"severance", en:"Severance Pay",                   cols:["เงินชดเชย1","เงินชดเชย2"] },
  { key:"taxborne",  en:"Tax Borne by Company",            cols:["ภาษีบริษัทจ่ายให้"] },
  { key:"advance",   en:"Advance Payment",                 cols:["เบิกเงินล่วงหน้า"] },
  { key:"otherInc",  en:"Other Income",                    cols:["รายได้อื่นๆ","รายการได้พิเศษ","รายการได้พิเศษ 1","รายการได้พิเศษ 2","รายการได้พิเศษ 3",
                                                                 "รายการได้ 12","รายการได้ 13","รายการได้ 14","รายการได้ 15","รายการได้ 16",
                                                                 "รายการได้ 17","รายการได้ 18","รายการได้ 19","รายการได้ 20"] },
];

const DEDUCT_LINES = [
  { key:"wht",       en:"Withholding Tax",        cols:["ภาษี","ภาษีเงินชดเชย"] },
  { key:"sso",       en:"Social Security Fund",   cols:["ประกันสังคม"] },
  { key:"pvd",       en:"Provident Fund",         cols:["กองทุนสำรองเลี้ยงชีพ"] },
  { key:"loan",      en:"Student Loan",           cols:["กยศ./กรอ."] },
  { key:"led",       en:"Legal Execution",        cols:["บังคับคดี"] },
  { key:"discipline",en:"Disciplinary Deduction", cols:["พักงาน"] },
  { key:"leaveded",  en:"Excess Leave Deduction", cols:["ขาด","ลา","มาสาย","ออกก่อน"] },
  { key:"welfare",   en:"Employee Welfare Fund",  cols:["กองทุนสงเคราะห์ลูกจ้าง"] },
  { key:"advded",    en:"Advance Repayment",      cols:["หักเบิกเงินล่วงหน้า"] },
  { key:"otherDed",  en:"Other Deductions",       cols:["รายการหัก 4","รายการหัก 5","รายการหัก 6","รายการหัก 7","รายการหัก 8","รายการหัก 9",
                                                        "รายการหัก 10","รายการหัก 11","รายการหัก 12","รายการหัก 13","รายการหัก 14","รายการหัก 15",
                                                        "รายการหัก 16","รายการหัก 17","รายการหัก 18","รายการหัก 19","รายการหัก 20"] },
];

// ผู้ลงนามที่ใช้ประจำ — เลือกจากลิสต์ได้ หรือพิมพ์เองก็ได้
// ช่องที่ 2 มีผู้ลงนามแทนได้ เมื่อ GM ไม่อยู่ให้ Deputy GM เซ็นแทน
const SIGNERS = [
  { name:"Mr. Suphachoke Phanthumitr", title:"Human Resources Manager" },
  { name:"Mr. Bob Kennedy",            title:"General Manager – Operations" },
  { name:"Mr. Craig Jacobson",         title:"Deputy General Manager – Operations" },
];

const norm = s => String(s ?? "").replace(/\s+/g, " ").trim();
const num = v => {
  if (v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/,/g, "").trim());
  return isFinite(n) ? n : 0;
};
export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const fmt = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmtI = n => Number(n || 0).toLocaleString("en-US");

// ---------- แกนกลาง: รวมไฟล์เป็นยอดรวม ----------
// รับ header + rows ที่อ่านมาจาก Excel แล้วคืนเฉพาะ "ยอดรวม" — ไม่คืนข้อมูลรายคนออกไปเลย
export function summarize(header, rows) {
  const H = header.map(norm);
  const idx = {};
  H.forEach((h, i) => { if (h && !(h in idx)) idx[h] = i; });

  const sumCols = cols => round2(cols.reduce((s, c) =>
    s + (idx[c] === undefined ? 0 : rows.reduce((t, r) => t + num(r[idx[c]]), 0)), 0));

  const income = INCOME_LINES.map(l => ({ ...l, amount: sumCols(l.cols) }));
  const deduct = DEDUCT_LINES.map(l => ({ ...l, amount: sumCols(l.cols) }));

  const grossCalc = round2(income.reduce((s, l) => s + l.amount, 0));
  const dedCalc   = round2(deduct.reduce((s, l) => s + l.amount, 0));

  // ยอดรวมที่ไฟล์คิดมาเอง — ใช้เป็นตัวตรวจว่าการจับกลุ่มคอลัมน์ครบไหม
  const grossFile = sumCols(["รวมรายได้"]);
  const dedFile   = sumCols(["รวมรายหัก"]);
  const netFile   = sumCols(["สุทธิ"]);

  // คอลัมน์ที่ระบบไม่รู้จัก — ต้องบอก ไม่ใช่ปล่อยให้ยอดหายไปเงียบ ๆ
  const known = new Set([...ID_COLS, ...TOTAL_COLS, ...EMPLOYER_COLS,
    ...INCOME_LINES.flatMap(l => l.cols), ...DEDUCT_LINES.flatMap(l => l.cols)].map(norm));
  const unknown = [];
  H.forEach((h, i) => {
    if (!h || known.has(h)) return;
    const t = round2(rows.reduce((s, r) => s + num(r[i]), 0));
    unknown.push({ col:h, total:t });
  });

  const empSso = sumCols(["ประกันสังคม"]);
  const empPvd = sumCols(["กองทุนสำรองเลี้ยงชีพ"]);
  // คนที่ยอดสุทธิเป็น 0 — ยังนับเป็นรายการในรอบจ่าย แค่เอาไว้เตือนบนหน้าจอว่ามีอยู่กี่คน
  const zeroNet = rows.filter(r => idx["สุทธิ"] !== undefined && num(r[idx["สุทธิ"]]) === 0).length;

  return {
    headcountInFile: rows.length,
    // Total Payroll Processing = ทุกคนในรอบจ่าย ไม่ใช่เฉพาะคนที่มียอดสุทธิ (ผู้ใช้ยืนยัน 2026-09-23)
    payees: rows.length,
    zeroNet,
    income, deduct,
    grossCalc, dedCalc, netCalc: round2(grossCalc - dedCalc),
    grossFile, dedFile, netFile,
    remit: {
      rd:    { emp: sumCols(["ภาษี","ภาษีเงินชดเชย"]), er: 0 },
      sso:   { emp: empSso, er: sumCols(["ประกันสังคมบริษัทสมทบ"]) },
      pvd:   { emp: empPvd, er: sumCols(["กองทุนบริษัทสมทบ"]) },
      loan:  { emp: sumCols(["กยศ./กรอ."]), er: 0 },
      led:   { emp: sumCols(["บังคับคดี"]), er: 0 },
      welfare:{ emp: sumCols(["กองทุนสงเคราะห์ลูกจ้าง"]), er: sumCols(["กองทุนสงเคราะห์บริษัทสมทบ"]) },
    },
    unknown,
    sheetMissing: false,
  };
}

// ---------- จำนวนพนักงานเข้า/ออก จากข้อมูลในระบบ ----------
// ใช้กติกาเดียวกับรายงานกำลังคน (sepYM / hcAtMonthEnd ใน app.js) ห้ามนิยามใหม่ที่นี่
// เป็นแค่ค่าตั้งต้น — ใบนี้เป็นของ "Thai Permanent Staff" ซึ่งขอบเขตอาจไม่ตรงกับทะเบียนพนักงานทั้งหมด
// HR แก้ตัวเลขได้ทุกช่อง
export function headcountFor(ym) {
  if (!ym) return { start:0, joiner:0, leaver:0, end:0 };
  const [y, m] = ym.split("-").map(Number);
  const prev = m === 1 ? `${y-1}-12` : `${y}-${String(m-1).padStart(2,"0")}`;
  const start  = hcAtMonthEnd(allEmployees, prev).length;
  const last   = lastDayOfMonth(ym);
  const joiner = allEmployees.filter(e => (e.join_date||"").substring(0,7) === ym).length;
  const leaver = allEmployees.filter(e => e.end_date && sepYM(e.end_date) === ym).length;
  const end    = hcAtMonthEnd(allEmployees, ym).length;
  return { start, joiner, leaver, end, last };
}

// ===================== หน้าเว็บ =====================
let mode = "permanent";              // permanent | contract
let src  = null;                     // ยอดรวมจากไฟล์ (ไม่มีรายคน)
let fileName = "";

const todayYM = () => new Date().toISOString().substring(0, 7);

// ค่าที่ HR กรอกเอง — แยกกันคนละชุดสำหรับสองใบ
const blankForm = () => ({
  period: todayYM(), payDate: "", staffType: "",
  start:"", joiner:"", leaver:"", end:"",
  ledDirectTx:"", ledDirectAmt:"",
  note:"",
  sig1Name:"Mr. Suphachoke Phanthumitr", sig1Title:"Human Resources Manager",
  sig2Name:"Mr. Bob Kennedy",           sig2Title:"General Manager – Operations",
});
const forms = {
  permanent: { ...blankForm(), staffType:"Thai Permanent Staff" },
  contract:  { ...blankForm(), staffType:"Temporary / Contract Staff",
               income:[{ label:"Fee", amount:"" }],
               deduct:[{ label:"Withholding Tax", amount:"" }, { label:"Legal Execution", amount:"" }] },
};
const F = () => forms[mode];

export function renderPayrollApproval() {
  const pg = document.getElementById("pagePayrollapproval");
  const canWrite = can("data.payroll.read");
  if (!canWrite) { pg.innerHTML = ""; return; }

  pg.innerHTML = `
  <div class="page-header">
    <div><div class="page-heading">ใบสรุปอนุมัติเงินเดือน</div>
    <div class="page-sub">Payroll Approval Cover Summary — ออกแยกกัน 2 ใบ สำหรับเซ็นอนุมัติ</div></div>
    <div class="header-actions">
      <button class="btn btn-gold" onclick="window._paPrint()">🖨 พิมพ์ / บันทึก PDF</button>
    </div>
  </div>

  <div class="section mt-4 pb-4">
    <div class="pa-modes">
      <button class="pa-mode ${mode==="permanent"?"on":""}" onclick="window._paMode('permanent')">
        <span class="pa-mode-t">งวดเงินเดือนปกติ</span>
        <span class="pa-mode-s">Thai Permanent Staff · อ่านยอดจากไฟล์ BeforeProcessYDP</span>
      </button>
      <button class="pa-mode ${mode==="contract"?"on":""}" onclick="window._paMode('contract')">
        <span class="pa-mode-t">ลูกจ้างสัญญา (หัก ณ ที่จ่าย 3%)</span>
        <span class="pa-mode-s">Temporary / Contract Staff · กรอกยอดเอง</span>
      </button>
    </div>
    <div id="paBody" class="mt-4">${mode==="permanent" ? permanentUI() : contractUI()}</div>
  </div>`;

  wire();
}

// ---------- ส่วนหัวที่ใช้ร่วมกันสองใบ ----------
function headUI() {
  const f = F();
  return `<div class="card card-body">
    <div class="card-title">ข้อมูลใบอนุมัติ</div>
    <div class="pa-grid mt-3">
      <div class="form-group"><label class="form-label">งวดเงินเดือน *</label>
        <input id="pa_period" type="month" class="form-input" value="${esc(f.period)}" onchange="window._paSet('period',this.value)"></div>
      <div class="form-group"><label class="form-label">วันที่จ่าย</label>
        <input id="pa_payDate" type="date" class="form-input" value="${esc(f.payDate)}" onchange="window._paSet('payDate',this.value)"></div>
      <div class="form-group"><label class="form-label">ประเภทพนักงาน</label>
        <input id="pa_staffType" class="form-input" value="${esc(f.staffType)}" onchange="window._paSet('staffType',this.value)"></div>
    </div>
    <div class="card-title mt-4">จำนวนพนักงาน (Headcount Movement)</div>
    ${mode==="permanent" ? `<div class="text-sm text-muted mt-1">
      กด “ดึงจากทะเบียนพนักงาน” เพื่อเติมค่าตั้งต้นตามกติกาเดียวกับรายงานกำลังคน — แก้ทับได้ทุกช่อง
      เพราะใบนี้เป็นของ Thai Permanent Staff ซึ่งขอบเขตอาจไม่ตรงกับทะเบียนทั้งหมด
      <button class="btn btn-secondary btn-sm" style="margin-left:8px;" onclick="window._paPullHc()">↩ ดึงจากทะเบียนพนักงาน</button>
    </div>` : ""}
    <div class="pa-grid mt-3">
      ${[["start","ยกมาต้นงวด (Starting)"],["joiner","เข้าใหม่ (New Joiner +)"],
         ["leaver","ออก (Leaver −)"],["end","คงเหลือสิ้นงวด (Ending)"]].map(([k,l]) =>
        `<div class="form-group"><label class="form-label">${l}</label>
          <input id="pa_${k}" type="number" min="0" class="form-input" value="${esc(f[k])}" onchange="window._paSet('${k}',this.value)"></div>`).join("")}
    </div>
    ${hcWarn()}
  </div>`;
}

// ยกมา + เข้า − ออก ต้องเท่ากับคงเหลือ ไม่งั้นใบที่เซ็นไปจะขัดกันเอง
function hcWarn() {
  const f = F();
  const [s,j,l,e] = ["start","joiner","leaver","end"].map(k => Number(f[k]));
  if ([s,j,l,e].some(v => !isFinite(v) || f.start==="" || f.end==="")) return "";
  const calc = s + j - l;
  if (calc === e) return "";
  return `<div class="pa-warn mt-3">จำนวนไม่ลงตัว: ${s} + ${j} − ${l} = <b>${calc}</b> แต่กรอกคงเหลือไว้ <b>${e}</b></div>`;
}

// ---------- ใบพนักงานประจำ ----------
function permanentUI() {
  const f = F();
  return `${headUI()}
  <div class="card card-body mt-4">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div><div class="card-title" style="margin:0;">ยอดจากไฟล์เงินเดือน</div>
        <div class="text-sm text-muted">ไฟล์ <b>BeforeProcessYDP</b> — อ่านในเครื่องคุณเท่านั้น
          ระบบรวมเป็นยอดรวมแล้วทิ้งข้อมูลรายคนทันที ไม่ส่งขึ้นเซิร์ฟเวอร์</div></div>
      <div>
        <input type="file" id="paFile" accept=".xlsx,.xls" onchange="window._paUpload(this)"
               style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;border:0;overflow:hidden;clip:rect(0 0 0 0);">
        <label for="paFile" class="btn btn-primary" style="cursor:pointer;">📁 เลือกไฟล์ Excel</label>
      </div>
    </div>
    ${src ? srcSummary() : `<div class="pa-empty mt-3">ยังไม่ได้เลือกไฟล์ — ยอดในใบจะว่างจนกว่าจะอัปโหลด</div>`}
  </div>
  <div class="card card-body mt-4">
    <div class="card-title">การโอนเงินและหมายเหตุ</div>
    <div class="pa-grid mt-3">
      <div class="form-group"><label class="form-label">หักจ่ายตรงบังคับคดี — จำนวนรายการ</label>
        <input type="number" min="0" class="form-input" value="${esc(f.ledDirectTx)}" onchange="window._paSet('ledDirectTx',this.value)"></div>
      <div class="form-group"><label class="form-label">หักจ่ายตรงบังคับคดี — จำนวนเงิน</label>
        <input type="number" step="0.01" min="0" class="form-input" value="${esc(f.ledDirectAmt)}" onchange="window._paSet('ledDirectAmt',this.value)"></div>
    </div>
    <div class="form-group mt-2"><label class="form-label">หมายเหตุท้ายใบ</label>
      <textarea class="form-input" rows="2" onchange="window._paSet('note',this.value)"
        placeholder="เช่น Two leavers still have remaining income to be processed in this payroll period.">${esc(f.note)}</textarea></div>
    ${sigUI()}
  </div>`;
}

function srcSummary() {
  const gDiff = round2(src.grossCalc - src.grossFile);
  const dDiff = round2(src.dedCalc - src.dedFile);
  const line = (l) => `<tr${l.amount ? "" : ' class="pa-zero"'}>
    <td>${esc(l.en)}</td><td class="text-right">${fmt(l.amount)}</td></tr>`;
  return `
  ${(gDiff || dDiff) ? `<div class="pa-bad mt-3">
    ยอดที่จับกลุ่มได้ไม่ตรงกับยอดรวมในไฟล์ — อย่าเพิ่งใช้ใบนี้<br>
    รายได้ ${fmt(src.grossCalc)} เทียบกับ ${fmt(src.grossFile)} (ต่าง ${fmt(gDiff)}) ·
    รายหัก ${fmt(src.dedCalc)} เทียบกับ ${fmt(src.dedFile)} (ต่าง ${fmt(dDiff)})
  </div>` : `<div class="pa-ok mt-3">ยอดตรงกับที่ไฟล์คิดมาเองทุกช่อง (รายได้ · รายหัก · สุทธิ)</div>`}
  ${src.unknown.length ? `<div class="pa-warn mt-3">
    มีคอลัมน์ที่ระบบยังไม่รู้จัก ${src.unknown.length} คอลัมน์ —
    ${src.unknown.map(u => `${esc(u.col)} (${fmt(u.total)})`).join(" · ")}
    <br>ยอดพวกนี้<b>ไม่ได้ถูกนับ</b>ในใบ ถ้ามีตัวเลขบอกผมเพื่อเพิ่มเข้าไป
  </div>` : ""}
  <div class="pa-src mt-3">
    <div><div class="pa-src-l">ไฟล์</div><div class="pa-src-v">${esc(fileName)}</div></div>
    <div><div class="pa-src-l">จำนวนคนในไฟล์</div><div class="pa-src-v">${fmtI(src.headcountInFile)}</div></div>
    ${src.zeroNet ? `<div><div class="pa-src-l">ยอดสุทธิเป็น 0</div><div class="pa-src-v" style="color:var(--amber);">${fmtI(src.zeroNet)}</div></div>` : ""}
    <div><div class="pa-src-l">รายได้รวม</div><div class="pa-src-v">${fmt(src.grossFile)}</div></div>
    <div><div class="pa-src-l">รายหักรวม</div><div class="pa-src-v">${fmt(src.dedFile)}</div></div>
    <div><div class="pa-src-l">จ่ายสุทธิ</div><div class="pa-src-v pa-net">${fmt(src.netFile)}</div></div>
  </div>
  <div class="pa-two mt-3">
    <table class="pa-tbl"><thead><tr><th>Income</th><th class="text-right">THB</th></tr></thead>
      <tbody>${src.income.map(line).join("")}
      <tr class="pa-tot"><td>TOTAL GROSS INCOME</td><td class="text-right">${fmt(src.grossCalc)}</td></tr></tbody></table>
    <table class="pa-tbl"><thead><tr><th>Deduction</th><th class="text-right">THB</th></tr></thead>
      <tbody>${src.deduct.map(line).join("")}
      <tr class="pa-tot"><td>TOTAL DEDUCTIONS</td><td class="text-right">${fmt(src.dedCalc)}</td></tr></tbody></table>
  </div>`;
}

// ---------- ใบลูกจ้างสัญญา ----------
function contractUI() {
  const f = F();
  const rowsUI = (which) => f[which].map((r, i) => `<div class="pa-row">
    <input class="form-input" value="${esc(r.label)}" placeholder="ชื่อรายการ"
           onchange="window._paLine('${which}',${i},'label',this.value)">
    <input class="form-input text-right" type="number" step="0.01" value="${esc(r.amount)}" placeholder="0.00"
           onchange="window._paLine('${which}',${i},'amount',this.value)">
    <button class="btn btn-secondary btn-sm" onclick="window._paLineDel('${which}',${i})" title="ลบบรรทัด">×</button>
  </div>`).join("");
  const sum = which => round2(f[which].reduce((s, r) => s + num(r.amount), 0));
  const gross = sum("income"), ded = sum("deduct");

  return `${headUI()}
  <div class="card card-body mt-4">
    <div class="card-title">รายการเงินได้ / เงินหัก</div>
    <div class="text-sm text-muted mt-1">ภาษีหัก ณ ที่จ่ายของลูกจ้างสัญญาคือ <b>3%</b> ของค่าจ้าง — กรอกยอดที่หักจริงลงช่อง Withholding Tax</div>
    <div class="pa-two mt-3">
      <div>
        <div class="pa-sub">Income</div>
        ${rowsUI("income")}
        <button class="btn btn-secondary btn-sm mt-2" onclick="window._paLineAdd('income')">+ เพิ่มบรรทัด</button>
        <div class="pa-linetot">TOTAL GROSS INCOME <b>${fmt(gross)}</b></div>
      </div>
      <div>
        <div class="pa-sub">Deduction</div>
        ${rowsUI("deduct")}
        <button class="btn btn-secondary btn-sm mt-2" onclick="window._paLineAdd('deduct')">+ เพิ่มบรรทัด</button>
        <div class="pa-linetot">TOTAL DEDUCTIONS <b>${fmt(ded)}</b></div>
      </div>
    </div>
    <div class="pa-netbar mt-3">Total Net Payroll Amount <b>${fmt(round2(gross - ded))}</b> THB</div>
  </div>
  <div class="card card-body mt-4">
    <div class="card-title">การโอนเงินและหมายเหตุ</div>
    <div class="pa-grid mt-3">
      <div class="form-group"><label class="form-label">หักจ่ายตรงบังคับคดี — จำนวนรายการ</label>
        <input type="number" min="0" class="form-input" value="${esc(f.ledDirectTx)}" onchange="window._paSet('ledDirectTx',this.value)"></div>
      <div class="form-group"><label class="form-label">หักจ่ายตรงบังคับคดี — จำนวนเงิน</label>
        <input type="number" step="0.01" min="0" class="form-input" value="${esc(f.ledDirectAmt)}" onchange="window._paSet('ledDirectAmt',this.value)"></div>
    </div>
    <div class="form-group mt-2"><label class="form-label">หมายเหตุท้ายใบ</label>
      <textarea class="form-input" rows="2" onchange="window._paSet('note',this.value)">${esc(f.note)}</textarea></div>
    ${sigUI()}
  </div>`;
}

function sigUI() {
  const f = F();
  const block = (n) => {
    const name = f[`sig${n}Name`], title = f[`sig${n}Title`];
    const match = SIGNERS.findIndex(p => p.name === name && p.title === title);
    return `<div class="pa-sig">
      <div class="pa-sig-h">ผู้ลงนามที่ ${n}</div>
      <select class="filter-select" onchange="window._paSigPick(${n}, this.value)">
        ${SIGNERS.map((p, i) => `<option value="${i}" ${i===match?"selected":""}>${esc(p.name)} — ${esc(p.title)}</option>`).join("")}
        <option value="x" ${match<0?"selected":""}>อื่น ๆ (พิมพ์เอง)</option>
      </select>
      <input class="form-input mt-2" value="${esc(name)}" placeholder="ชื่อ"
             onchange="window._paSet('sig${n}Name',this.value)">
      <input class="form-input mt-2" value="${esc(title)}" placeholder="ตำแหน่ง"
             onchange="window._paSet('sig${n}Title',this.value)">
    </div>`;
  };
  return `<div class="card-title mt-4">ผู้ลงนาม</div>
  <div class="text-sm text-muted mt-1">ช่องวันที่เว้นว่างไว้ให้เซ็นด้วยมือ · เลือกจากรายชื่อหรือพิมพ์เองก็ได้</div>
  <div class="pa-sigs mt-3">${block(1)}${block(2)}</div>`;
}

// ---------- ผูก event ----------
function wire() {
  window._paMode = m => { mode = m; renderPayrollApproval(); };
  window._paSet  = (k, v) => { F()[k] = v; renderPayrollApproval(); };
  window._paLineAdd = which => { F()[which].push({ label:"", amount:"" }); renderPayrollApproval(); };
  window._paLineDel = (which, i) => { F()[which].splice(i, 1); renderPayrollApproval(); };
  window._paLine = (which, i, k, v) => { F()[which][i][k] = v; renderPayrollApproval(); };
  window._paSigPick = (n, v) => {
    if (v === "x") return;                    // "พิมพ์เอง" — ปล่อยให้แก้ในช่องข้างล่าง
    const p = SIGNERS[Number(v)];
    if (!p) return;
    F()[`sig${n}Name`] = p.name; F()[`sig${n}Title`] = p.title;
    renderPayrollApproval();
  };

  window._paPullHc = () => {
    const hc = headcountFor(F().period);
    Object.assign(F(), { start:String(hc.start), joiner:String(hc.joiner), leaver:String(hc.leaver), end:String(hc.end) });
    toast("เติมจากทะเบียนพนักงานแล้ว — ตรวจให้ตรงกับขอบเขตของใบนี้ด้วย", "info");
    renderPayrollApproval();
  };

  window._paUpload = inputEl => {
    const file = inputEl.files?.[0];
    inputEl.value = "";
    if (!file) return;
    if (!window.XLSX) { toast("กรุณารอโหลด library", "error"); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb = window.XLSX.read(ev.target.result, { type:"binary" });
        const name = wb.SheetNames.find(n => norm(n) === SHEET) || wb.SheetNames[0];
        const aoa = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header:1, defval:"", raw:true });
        if (aoa.length < 2) { toast(`ชีต "${name}" ไม่มีข้อมูล`, "error"); return; }
        const [header, ...rows] = aoa;
        if (!header.map(norm).includes("รวมรายได้")) {
          toast(`ชีต "${name}" ไม่มีคอลัมน์ "รวมรายได้" — น่าจะไม่ใช่ไฟล์ BeforeProcessYDP`, "error");
          return;
        }
        // เก็บเฉพาะยอดรวม — ตัวแปร rows หลุด scope ตรงนี้ ข้อมูลรายคนไม่ถูกเก็บไว้ที่ไหนเลย
        src = summarize(header, rows.filter(r => norm(r[0])));
        fileName = file.name;
        if (!F().end) F().end = String(src.headcountInFile);
        toast(`อ่านแล้ว ${src.headcountInFile} คน · จ่ายสุทธิ ${fmt(src.netFile)}`, "success");
        renderPayrollApproval();
      } catch (err) {
        toast("อ่านไฟล์ไม่ได้: " + err.message, "error");
      }
    };
    reader.readAsBinaryString(file);
  };

  window._paPrint = () => {
    if (mode === "permanent" && !src) { toast("ยังไม่ได้เลือกไฟล์เงินเดือน", "error"); return; }
    openPrint(buildDoc());
  };
}

// ===================== เอกสารที่พิมพ์ =====================
const thMonthEN = ym => {
  if (!ym) return "";
  const [y, m] = ym.split("-").map(Number);
  return `${["January","February","March","April","May","June","July","August","September","October","November","December"][m-1]} ${y}`;
};
const dateEN = d => {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return `${dt.getDate()} ${["January","February","March","April","May","June","July","August","September","October","November","December"][dt.getMonth()]} ${dt.getFullYear()}`;
};

function buildDoc() {
  const f = F();
  let income, deduct, gross, ded, remit, payees;

  if (mode === "permanent") {
    income = src.income.filter(l => l.amount).map(l => [l.en, l.amount]);
    deduct = src.deduct.filter(l => l.amount).map(l => [l.en, l.amount]);
    gross = src.grossCalc; ded = src.dedCalc;
    payees = src.payees;
    remit = [
      ["Revenue Dept. (RD)",   src.remit.rd.emp,   src.remit.rd.er],
      ["Social Security (SSO)",src.remit.sso.emp,  src.remit.sso.er],
      ["Provident Fund (PVD)", src.remit.pvd.emp,  src.remit.pvd.er],
      ["Student Loan",         src.remit.loan.emp, src.remit.loan.er],
      ["Legal Execution (LED)",src.remit.led.emp,  src.remit.led.er],
      ["Employee Welfare Fund",src.remit.welfare.emp, src.remit.welfare.er],
    ].filter(r => r[1] || r[2]);
  } else {
    income = f.income.filter(r => norm(r.label) || num(r.amount)).map(r => [r.label, num(r.amount)]);
    deduct = f.deduct.filter(r => norm(r.label) || num(r.amount)).map(r => [r.label, num(r.amount)]);
    gross = round2(income.reduce((s, r) => s + r[1], 0));
    ded   = round2(deduct.reduce((s, r) => s + r[1], 0));
    payees = Number(f.end) || 0;
    // ใบสัญญาจ้างส่งเงินให้กรมสรรพากรกับบังคับคดีเท่านั้น — ดึงจากบรรทัดที่ชื่อตรงกัน
    const pick = re => round2(deduct.filter(r => re.test(r[0])).reduce((s, r) => s + r[1], 0));
    remit = [
      ["Revenue Dept. (RD)",    pick(/withholding|ภาษี/i), 0],
      ["Legal Execution (LED)", pick(/legal|บังคับคดี/i),  0],
    ].filter(r => r[1] || r[2]);
  }

  const net = round2(gross - ded);
  const ledTx  = Number(f.ledDirectTx) || 0;
  const ledAmt = round2(num(f.ledDirectAmt));
  // ใบจริงนับแบบนี้: ตั้งต้นที่จำนวนรายการจ่ายทั้งหมด แล้ว "หัก" รายการที่จ่ายตรงบังคับคดีออก
  // เหลือเป็นจำนวนรายการที่โอนผ่านธนาคาร (ส.ค. 2026: 489 - 1 = 488 · ลูกจ้างสัญญา: 9 - 1 = 8)
  const processTx  = payees;
  const processAmt = round2(net + ledAmt);
  const transferTx = Math.max(0, payees - ledTx);

  const rows = (list) => {
    const n = Math.max(list.length, 1);
    return { n, html: list.map(([l, v]) =>
      `<tr><td>${esc(l)}</td><td class="n">${fmt(v)}</td></tr>`).join("") };
  };
  const inc = rows(income), dedR = rows(deduct);
  // สองคอลัมน์ต้องสูงเท่ากัน เติมแถวว่างฝั่งที่สั้นกว่า — ใบจริงก็เว้นบรรทัดว่างไว้แบบนี้
  const pad = k => Array.from({ length: Math.max(0, Math.max(inc.n, dedR.n) - k) },
    () => `<tr><td>&nbsp;</td><td class="n"></td></tr>`).join("");

  const logo = new URL("assets/logo.png", location.href).href;
  const hc = [["Starting Staff", f.start], ["New Joiner (+)", f.joiner],
              ["Leaver (-)", f.leaver], ["Ending Staff", f.end]];

  return `
<div class="sheet">
  <div class="top">
    <img class="logo" src="${logo}" alt="Akara Resources">
    <div class="site">Chatree Gold Mine</div>
  </div>
  <div class="rule"></div>

  <h1>PAYROLL APPROVAL COVER SUMMARY</h1>

  <table class="meta">
    <tr>
      <th>Payroll Period</th><td>${esc(thMonthEN(f.period))}</td>
      <th>Pay Date</th><td>${esc(dateEN(f.payDate))}</td>
      <th>Type</th><td>${esc(f.staffType)}</td>
    </tr>
  </table>

  <h2>HEADCOUNT MOVEMENT</h2>
  <table class="grid hc">
    <tr>${hc.map(([l]) => `<th>${l}</th>`).join("")}</tr>
    <tr>${hc.map(([, v]) => `<td class="c">${esc(v === "" ? "—" : v)}</td>`).join("")}</tr>
  </table>

  <h2>TRANSACTIONS BREAKDOWN (THB)</h2>
  <table class="grid br">
    <tr><th colspan="2">Income</th><th colspan="2">Deduction</th></tr>
    <tr>
      <td class="half" colspan="2"><table class="inner">${inc.html}${pad(inc.n)}</table></td>
      <td class="half" colspan="2"><table class="inner">${dedR.html}${pad(dedR.n)}</table></td>
    </tr>
    <tr class="tot">
      <td>TOTAL GROSS INCOME</td><td class="n">${fmt(gross)}</td>
      <td>TOTAL DEDUCTIONS</td><td class="n">${fmt(ded)}</td>
    </tr>
    <tr class="net">
      <td colspan="2">Total Net Payroll Amount:&nbsp; THB</td>
      <td colspan="2" class="n">${fmt(net)}</td>
    </tr>
  </table>

  <h2>BANK DISBURSEMENT &amp; EXCEPTION SUMMARY</h2>
  <table class="grid">
    <tr><th>Description</th><th class="c">Transactions</th><th class="c">Amount (THB)</th></tr>
    <tr><td>Total Payroll Processing</td><td class="c">${fmtI(processTx)}</td><td class="n">${fmt(processAmt)}</td></tr>
    <tr><td>Less: Legal Execution Direct Pay</td><td class="c">${ledTx ? fmtI(ledTx) : "—"}</td><td class="n">${ledAmt ? fmt(ledAmt) : "—"}</td></tr>
    <tr class="tot"><td>Net Transfer via K-CASH Connect Plus</td><td class="c">${fmtI(transferTx)}</td><td class="n">${fmt(net)}</td></tr>
  </table>

  <h2>EXTERNAL REMITTANCE SUMMARY</h2>
  <table class="grid">
    <tr><th>Beneficiary / Agency</th><th class="c">Employee Portion (THB)</th><th class="c">Employer Portion (THB)</th><th class="c">Total Remittance (THB)</th></tr>
    ${remit.length ? remit.map(([l, e, r]) =>
      `<tr><td>${esc(l)}</td><td class="n">${e ? fmt(e) : ""}</td><td class="n">${r ? fmt(r) : ""}</td><td class="n">${fmt(round2(e + r))}</td></tr>`).join("")
      : `<tr><td colspan="4" class="c">—</td></tr>`}
  </table>

  ${f.note ? `<p class="note"><b>Note:</b> ${esc(f.note)}</p>` : ""}

  <div class="sigs">
    ${[[f.sig1Name, f.sig1Title], [f.sig2Name, f.sig2Title]].map(([n, t]) => `
      <div class="sig">
        <div class="sigline"></div>
        <div class="signame">(${esc(n)})</div>
        <div class="sigtitle">${esc(t)}</div>
        <div class="sigdate">Date ______________________</div>
      </div>`).join("")}
  </div>
</div>`;
}

const CSS = `
@page { size: A4 portrait; margin: 11mm 13mm; }
*{box-sizing:border-box;}
body{font-family:'Sarabun',system-ui,sans-serif;font-size:9.5pt;color:#000;background:#fff;margin:0;}
.sheet{max-width:186mm;margin:0 auto;}
.top{display:flex;align-items:flex-end;justify-content:space-between;}
.logo{height:13mm;}
.site{font-size:10pt;font-weight:700;color:#1a3e9a;}
.rule{height:1.6pt;background:#1a3e9a;margin:1.5mm 0 3mm;}
h1{font-size:12pt;text-align:center;letter-spacing:.3pt;margin:0 0 3mm;}
h2{font-size:9pt;font-weight:700;margin:3mm 0 1.2mm;}
table{border-collapse:collapse;width:100%;}
.meta th,.meta td,.grid th,.grid td{border:.6pt solid #000;padding:1mm 2mm;}
.meta th{background:#fff;font-weight:700;text-align:left;white-space:nowrap;}
.grid th{background:#fff;font-weight:700;text-align:left;}
.c{text-align:center;} .n{text-align:right;font-variant-numeric:tabular-nums;}
.hc th,.hc td{text-align:center;}
/* ช่องรายได้/รายหักเป็นตารางซ้อน เพื่อให้สองฝั่งสูงเท่ากันและเส้นตรงกัน */
.br .half{padding:0;vertical-align:top;}
.inner{width:100%;}
.inner td{border:0;border-bottom:.4pt solid #bbb;padding:.9mm 2mm;}
.inner tr:last-child td{border-bottom:0;}
.tot td{font-weight:700;}
.net td{font-weight:700;text-align:center;}
.net td.n{text-align:right;}
.note{font-size:8.5pt;margin:3mm 0 0;}
.sigs{display:flex;gap:18mm;margin-top:6mm;page-break-inside:avoid;}
.sig{flex:1;text-align:center;}
.sigline{height:9mm;}
.signame{border-top:0;font-size:9pt;}
.sigtitle{font-size:8.5pt;}
.sigdate{font-size:8.5pt;margin-top:3mm;}
.noprint{margin-top:8mm;text-align:center;}
.noprint #fitNote{font-size:8.5pt;color:#b54708;margin-top:4mm;}
.noprint button{font:inherit;padding:8px 18px;cursor:pointer;border:1px solid #1a3e9a;background:#1a3e9a;color:#fff;border-radius:6px;}
@media print{.noprint{display:none;}}
`;

// ย่อทั้งใบให้จบในหน้าเดียวเสมอ — เดือนที่มีรายการเงินได้/เงินหักเยอะกว่าปกติจะไม่ตกไปหน้า 2
// ต้องรอฟอนต์โหลดก่อนถึงวัดได้ตรง ไม่งั้นความสูงที่วัดได้เป็นของฟอนต์สำรอง
const FIT = `
document.fonts.ready.then(function(){
  var sheet = document.querySelector(".sheet");
  var avail = (297 - 22) * 3.779527;          // A4 สูง 297mm ลบขอบบน+ล่างที่ตั้งไว้ใน @page
  var h = sheet.getBoundingClientRect().height;
  if (h <= avail) return;
  var k = Math.max(0.7, avail / h);            // ไม่ย่อต่ำกว่า 70% เพราะจะอ่านไม่ออก
  sheet.style.zoom = k;
  document.getElementById("fitNote").textContent =
    "ย่อขนาดลงเหลือ " + Math.round(k * 100) + "% เพื่อให้จบในหน้าเดียว";
});
`;

function openPrint(body) {
  const w = window.open("", "_blank");
  if (!w) { toast("เบราว์เซอร์บล็อกป็อปอัป — อนุญาตแล้วลองใหม่", "error"); return; }
  w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8">
    <title>Payroll Approval Summary</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
    <style>${CSS}</style></head><body>${body}
    <div class="noprint"><button onclick="window.print()">🖨 พิมพ์ / บันทึกเป็น PDF</button>
      <div id="fitNote"></div></div>
    <script>${FIT}<\/script>
    </body></html>`);
  w.document.close();
}
