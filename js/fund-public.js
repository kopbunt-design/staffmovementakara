import { supabase } from "./supabase-config.js";
import { PVD_REQUESTS, PVD_POLICIES, PVD_MATCH, FORM_NAME, printSubmission, serviceYears, matchTier, employerMatch } from "./fund-print.js";

// ============================================================================
// หน้าพนักงานกรอกแบบฟอร์มกองทุน (fund.html?t=<token>) — ไม่ต้อง login
// เข้าได้เฉพาะคนที่ HR เชิญ: ลิงก์ส่วนตัว + รหัสพนักงาน + เลขบัตรประชาชน 5 ตัวท้าย
// เห็นเฉพาะฟอร์มที่ HR เปิดให้ (บางคนได้แค่ สกล.5 เช่น ยังไม่ผ่านโปร / เคยลาออกจากกองทุนสำรองฯ)
//
// ขั้นตอน: verify → choose → pvd | wef → review → done
// ข้อมูลพนักงานมาจาก fund_form_lookup() เท่านั้น (anon อ่านตาราง employees ไม่ได้)
// ตรวจข้อมูลที่นี่เพื่อให้พนักงานแก้ได้ทันที แต่ fund_form_submit() ตรวจซ้ำฝั่ง DB อีกชั้น
// ============================================================================

const $app = document.getElementById("app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

const RELATIONS = ["บิดา", "มารดา", "คู่สมรส", "บุตร", "พี่น้อง", "ญาติ", "อื่น ๆ"];
const NAT_TH = { Thai: "ไทย", Lao: "ลาว", Australian: "ออสเตรเลีย" };
const STATUS_TH = { submitted: "ส่งแล้ว รอ HR รับเรื่อง", accepted: "HR รับเรื่องแล้ว", received: "HR รับเอกสารตัวจริงแล้ว", approved: "อนุมัติแล้ว",
                    sent: "ส่งหน่วยงานแล้ว", rejected: "ส่งกลับให้แก้ไข", cancelled: "ยกเลิก" };
const ERR_TH = {
  ALREADY_SUBMITTED: "ท่านส่งแบบฟอร์มแล้ว แก้ไขเองไม่ได้ — ถ้าต้องการแก้ไขหรือเปลี่ยนกองทุน กรุณาติดต่อ HR",
  VERIFY_FAILED: "ยืนยันตัวตนไม่ผ่าน กรุณาเริ่มใหม่",
  LOCKED: "กรอกผิดหลายครั้งเกินไป ระบบล็อกลิงก์นี้ไว้ 30 นาที — ถ้ามั่นใจว่าข้อมูลถูก ติดต่อ HR",
  EXPIRED: "ลิงก์นี้หมดอายุแล้ว กรุณาติดต่อ HR เพื่อขอลิงก์ใหม่",
  CANCELLED: "ลิงก์นี้ถูกยกเลิกแล้ว กรุณาติดต่อ HR",
  FORM_NOT_ALLOWED: "แบบฟอร์มนี้ไม่ได้เปิดให้ท่านกรอก",
  WEF_ID_MISMATCH: "เลขประจำตัวประชาชนไม่ตรงกับเลข 5 ตัวท้ายที่ใช้ยืนยันตัว",
  NO_CONSENT: "กรุณาติ๊กยินยอมก่อนส่ง",
  PVD_PERCENT_SUM: "ร้อยละของผู้รับผลประโยชน์ต้องรวมได้ 100",
  PVD_RATE: "อัตราเงินสะสมต้องอยู่ระหว่าง 2–15%",
  PVD_POLICY: "กรุณาเลือกนโยบายการลงทุน",
  WEF_ID_CARD: "เลขประจำตัวประชาชนของท่านไม่ถูกต้อง",
  WEF_BENEF_ID: "เลขประจำตัวประชาชนของผู้รับประโยชน์ไม่ถูกต้อง",
};
const errMsg = e => { const m = String(e?.message || e); const k = Object.keys(ERR_TH).find(x => m.includes(x)); return k ? ERR_TH[k] : "เกิดข้อผิดพลาด: " + m; };

// เลขบัตรประชาชนไทย — ตรงกับ fund_valid_thai_id() ใน SQL
function validThaiId(s) {
  if (!/^\d{13}$/.test(s || "")) return false;
  let sum = 0; for (let i = 0; i < 12; i++) sum += +s[i] * (13 - i);
  return (11 - sum % 11) % 10 === +s[12];
}
const digits = s => String(s || "").replace(/\D/g, "");
const ageFrom = dob => { if (!dob) return ""; const d = new Date(dob), n = new Date();
  let a = n.getFullYear() - d.getFullYear(); if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--; return a; };

// ------------------------------------------------------------------ state
const S = {
  step: "verify", busy: false, err: "",
  token: new URLSearchParams(location.search).get("t") || "",
  cred: { code: "", last5: "" },
  emp: null,          // ผลจาก fund_form_lookup
  form: null,         // 'pvd' | 'wef'
  pvd: null, wef: null,
  result: null,       // { id, submitted_at }
};
// คนที่ HR เชิญคือคนที่ยังไม่เป็นสมาชิก — ติ๊ก "สมัคร" ไว้ให้ก่อน เปลี่ยนเองได้
const newPvd = () => ({ requests: ["apply"], beneficiaries: [{ name: "", relation: "", other: "", percent: "" }],
  rate: "", policy: "", consent: false });

// ร้อยละผู้รับผลประโยชน์ พนักงานกำหนดเองอิสระ ระบบไม่เฉลี่ยให้ — แค่บอกยอดรวม และส่งได้เมื่อรวมได้ 100 พอดี
const pctTotal = p => p.beneficiaries.reduce((s, b) => s + (+b.percent || 0), 0);
function sumBadge(tot) {
  const cls = tot === 100 ? "ok" : "bad";
  const txt = tot === 100 ? "รวม 100% ✓" : tot > 100 ? `รวม ${tot}% · เกินมา ${tot - 100}%` : `รวม ${tot}% · ขาดอีก ${100 - tot}%`;
  return `<span class="fx-sum ${cls}" id="fxSum">${txt}</span>`;
}
const shareHint = w => { const tot = w.beneficiaries.reduce((s, b) => s + (+b.shares || 0), 0);
  return (tot ? `แบ่งเป็น ${tot} ส่วน: ${w.beneficiaries.map(b => `${esc(b.name || "?")} ${+b.shares || 0}/${tot}`).join(" · ")}`
              : "ถ้าไม่ระบุจำนวนส่วน ทุกคนจะได้รับเท่ากัน")
       + (w.beneficiaries.length > 4 ? " · เกิน 4 คน ระบบจะพิมพ์แบบฟอร์มเป็น 2 แผ่น" : ""); };
const newWef = e => ({
  title: ["นาย", "นาง", "นางสาว"].includes(e.title) ? e.title : e.gender === "Male" ? "นาย" : "",
  age: ageFrom(e.dob), is_thai: true, nationality: "ไทย",
  id_card: "", passport: "", phone: e.phone || "", written_at: "บริษัท อัครา รีซอร์สเซส จำกัด (มหาชน)",
  addr: { no: "", moo: "", soi: "", road: "", subdistrict: "", district: "", province: "", zip: "" },
  beneficiaries: [{ name: "", relation: "", other: "", id_card: "", address: "", sameAddr: false, shares: "" }],
  consent: false,
});

// ---------------------------------------------------- ฉบับที่ HR ส่งกลับให้แก้
// ฉบับล่าสุดของคนนี้ (ฟอร์มใดก็ได้) — ได้สองกองทุนก็ต้องเลือกอย่างเดียว ส่งแบบใหม่ = แทนฉบับเดิม
const latestAny = () => (S.emp?.history || []).find(x => x.status !== "cancelled");
// HR รับเรื่องไปแล้ว → ส่งใหม่ไม่ได้ จนกว่า HR จะส่งกลับให้แก้ (DB กันซ้ำอีกชั้น)
// ส่งแล้ว = ล็อกทันที แก้เองไม่ได้ ต้องให้ HR ยกเลิกให้ก่อน (status = rejected จึงกรอกใหม่ได้)
const locked = () => ["submitted", "accepted", "received", "approved", "sent"].includes(latestAny()?.status);
const latestOf = f => (S.emp?.history || []).find(x => x.form_type === f && x.status !== "cancelled");
const relIn = r => RELATIONS.includes(r) ? { relation: r, other: "" } : { relation: r ? "อื่น ๆ" : "", other: r || "" };
function pvdFromDraft(d) {
  const bs = (d.beneficiaries || []).map(b => ({ name: b.name || "", ...relIn(b.relation), percent: b.percent ? String(b.percent) : "" }));
  return { ...newPvd(), requests: d.requests?.length ? d.requests : ["apply"],
           beneficiaries: bs.length ? bs : newPvd().beneficiaries,
           rate: d.rate ? String(d.rate) : "", policy: d.policy || "" };
}
function wefFromDraft(d, emp) {
  const w = newWef(emp);
  const bs = (d.beneficiaries || []).map(b => ({ name: b.name || "", ...relIn(b.relation), id_card: b.id_card || "",
    address: b.address || "", sameAddr: false, shares: b.shares ? String(b.shares) : "" }));
  return { ...w, title: d.title || w.title, age: d.age ?? w.age, is_thai: d.is_thai !== false,
           nationality: d.nationality || w.nationality, id_card: d.id_card || "", passport: d.passport || "",
           phone: d.phone || w.phone, written_at: d.written_at || w.written_at, addr: { ...w.addr, ...(d.addr || {}) },
           beneficiaries: bs.length ? bs : w.beneficiaries };
}
// เปิดฟอร์ม — ถ้าฉบับล่าสุดถูกส่งกลับ เติมข้อมูลเดิมให้แก้ต่อ
function startForm(f) {
  S.form = f; S.result = null;
  const d = latestOf(f)?.status === "rejected" && latestAny()?.form_type === f ? S.emp.drafts?.[f] : null;
  if (f === "pvd" && !S.pvd) S.pvd = d ? pvdFromDraft(d) : newPvd();
  if (f === "wef" && !S.wef) S.wef = d ? wefFromDraft(d, S.emp) : newWef(S.emp);
  go(f);
}
const rejectBox = f => { const x = latestAny(); if (x?.form_type !== f || x.status !== "rejected") return "";
  return `<div class="fx-err" style="margin-top:8px;"><b>HR ส่งกลับให้แก้ไข</b>${x.hr_note ? `: ${esc(x.hr_note)}` : ""}
    <div class="fx-small">ข้อมูลเดิมกรอกไว้ให้แล้ว แก้ตามที่แจ้ง แล้วส่งใหม่ได้เลย</div></div>`; };

function go(step) { S.step = step; S.err = ""; render(); window.scrollTo({ top: 0, behavior: "smooth" }); }

// ---------------------------------------------------------------- render
function render() {
  const v = { verify, choose, compare, pvd: pvdForm, wef: wefForm, review, done }[S.step];
  $app.innerHTML = v();
  if (S.step === "review") initPad();
}

// ---------------------------------------------------------- ลายเซ็นบนหน้าจอ
// ไม่บังคับ — ถ้าเซ็นที่นี่ แบบฟอร์มที่พิมพ์จะมีลายเซ็นพนักงานอยู่แล้ว เหลือแค่พยานเซ็นบนกระดาษ
// เก็บเป็น PNG ขนาดคงที่ 600×200 ใน payload.signature
const cur = () => S.form === "pvd" ? S.pvd : S.wef;
function initPad() {
  const c = $app.querySelector("#fxPad"); if (!c) return;
  const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
  const g = c.getContext("2d");
  g.scale(dpr, dpr); g.lineWidth = 2.4; g.lineCap = g.lineJoin = "round"; g.strokeStyle = "#0b2e8a";
  if (cur().signature) { const im = new Image(); im.onload = () => g.drawImage(im, 0, 0, r.width, r.height); im.src = cur().signature; }
  let down = false, last = null, drew = false;
  const pt = e => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  c.onpointerdown = e => { down = true; last = pt(e); c.setPointerCapture(e.pointerId); e.preventDefault(); };
  c.onpointermove = e => { if (!down) return; const p = pt(e);
    g.beginPath(); g.moveTo(...last); g.lineTo(...p); g.stroke(); last = p; drew = true; };
  c.onpointerup = c.onpointercancel = () => {
    if (!down) return; down = false; if (!drew) return;
    const out = document.createElement("canvas"); out.width = 600; out.height = 200;
    out.getContext("2d").drawImage(c, 0, 0, 600, 200);
    cur().signature = out.toDataURL("image/png");
    $app.querySelector("#fxSigState").textContent = "เซ็นแล้ว ✓";
  };
}

const stepper = () => {
  const i = { choose: 0, compare: 0, pvd: 1, wef: 1, review: 2, done: 3 }[S.step] ?? 0;
  return `<ol class="fx-steps">${["เลือกแบบฟอร์ม", "กรอกข้อมูล", "ตรวจทาน", "ส่งแล้ว"]
    .map((t, k) => `<li class="${k < i ? "done" : k === i ? "on" : ""}"><b>${k + 1}</b><span>${t}</span></li>`).join("")}</ol>`;
};
const errBox = () => S.err ? `<div class="fx-err">${esc(S.err)}</div>` : "";

function verify() {
  if (!S.token) return `<div class="fx-card fx-narrow fx-center">
    <h1>ต้องใช้ลิงก์ที่ HR ส่งให้</h1>
    <p class="fx-muted">แบบฟอร์มกองทุนเปิดเฉพาะพนักงานที่ฝ่ายทรัพยากรบุคคลแจ้งไว้ กรุณาเปิดจากลิงก์ส่วนตัวที่ได้รับ</p></div>`;
  return `<div class="fx-card fx-narrow">
    <h1>ยืนยันตัวตน</h1>
    <p class="fx-muted">กรอกรหัสพนักงาน และเลขบัตรประชาชน 5 ตัวท้าย เพื่อเริ่มกรอกแบบฟอร์ม</p>
    <form data-act="verify">
      <label class="fx-l">รหัสพนักงาน<input class="fx-i" name="code" value="${esc(S.cred.code)}" placeholder="เช่น AKR23030950" autocomplete="off" autocapitalize="characters" required></label>
      <label class="fx-l">เลขบัตรประชาชน 5 ตัวท้าย<input class="fx-i" name="last5" value="${esc(S.cred.last5)}" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" autocomplete="off" placeholder="เช่น 12345" required></label>
      ${errBox()}
      <button class="fx-btn fx-primary fx-block" ${S.busy ? "disabled" : ""}>${S.busy ? "กำลังตรวจสอบ…" : "ถัดไป"}</button>
    </form>
  </div>`;
}

function choose() {
  const e = S.emp, h = e.history || [], forms = e.forms || [];
  const card = (k, title, sub, meta) => `<button class="fx-choice" data-act="pick" data-form="${k}">
      <div class="fx-choice-t">${title}</div><div class="fx-choice-s">${sub}</div><div class="fx-choice-m">${meta}</div></button>`;
  return `${stepper()}
  <div class="fx-card">
    <div class="fx-hello">สวัสดีคุณ ${esc(e.name)}<span>${esc(e.emp_code)} · ${esc(e.department || "-")}</span></div>
    ${locked() ? `<div class="fx-hint" style="margin-top:12px;"><b>${latestAny().status === "submitted" ? "ท่านส่งแบบฟอร์มแล้ว" : "HR รับเรื่องของท่านแล้ว"}</b> (${esc(FORM_NAME[latestAny().form_type])} #${latestAny().id})
      <div class="fx-small">แก้ไขเองไม่ได้ · ถ้าต้องการแก้ไขหรือเปลี่ยนกองทุน กรุณาติดต่อ HR</div>
      ${S.emp.latest ? `<button class="fx-btn fx-primary fx-block" data-act="dl" type="button" style="margin-top:10px;">⬇ ดาวน์โหลด PDF ฉบับที่ส่งไว้</button>` : ""}</div>` : `
    <p class="fx-muted">${forms.length > 1 ? "ท่านเลือกได้ <b>1 แบบ</b> — ส่งแล้วแก้ไขเองไม่ได้ ถ้าต้องการเปลี่ยนภายหลัง ต้องติดต่อ HR" : "แบบฟอร์มที่ HR เปิดให้ท่านกรอก"}</p>
    ${forms.length > 1 ? `<button class="fx-btn fx-ghost fx-block fx-cmp-btn" data-act="compare" type="button">📊 เปรียบเทียบก่อนเลือก — สองกองทุนต่างกันอย่างไร</button>` : ""}
    <div class="fx-choices">
      ${forms.includes("pvd") ? card("pvd", "กองทุนสำรองเลี้ยงชีพ", "สมัครสมาชิก · เปลี่ยนผู้รับผลประโยชน์ · เปลี่ยนอัตราเงินสะสม · เปลี่ยนนโยบายการลงทุน", "แบบฟอร์ม AKR-OHR-FM-020") : ""}
      ${forms.includes("wef") ? card("wef", "กองทุนสงเคราะห์ลูกจ้าง", "ระบุผู้รับประโยชน์ กรณีลูกจ้างเสียชีวิต (ส่งกรมสวัสดิการและคุ้มครองแรงงาน)", "แบบ สกล.5") : ""}
    </div>`}
    ${h.length ? `<div class="fx-hist"><div class="fx-hist-t">คำขอที่เคยส่ง</div>${h.map(x => {
      // ยึดฉบับล่าสุดฉบับเดียว — ฉบับก่อนหน้าแสดงเป็นยกเลิก ให้พนักงานเห็นชัดว่าอันไหนใช้จริง
      const old = x !== latestAny() && x.status !== "cancelled";
      return `
      <div class="fx-hist-r${old || x.status === "cancelled" ? " fx-hist-old" : ""}"><span>#${x.id} ${esc(FORM_NAME[x.form_type])}</span>
      <span class="fx-muted">${new Date(x.submitted_at).toLocaleDateString("th-TH")}</span>
      <span class="fx-tag st-${old ? "cancelled" : x.status}">${old ? "ยกเลิก · ใช้ฉบับล่าสุดแทน" : STATUS_TH[x.status] || x.status}</span>
      ${!old && S.emp.latest?.id === x.id && x.status !== "rejected" ? `<button class="fx-btn fx-dl" data-act="dl" type="button">⬇ ดาวน์โหลด PDF</button>` : ""}
      ${!old && x.status === "rejected" && x.hr_note ? `<div class="fx-small" style="flex-basis:100%;color:var(--red);">เหตุผล: ${esc(x.hr_note)}</div>` : ""}</div>`; }).join("")}
</div>` : ""}
    <button class="fx-btn fx-link" data-act="logout">ไม่ใช่ฉัน / ออก</button>
  </div>`;
}

// ------------------------------------------------ เปรียบเทียบสองกองทุน
// ข้อมูลกองทุนสงเคราะห์ลูกจ้าง: พ.ร.บ.คุ้มครองแรงงาน 2541 หมวด 13 + ประกาศเริ่มจัดเก็บ 1 ต.ค. 2569
// (กรมสวัสดิการและคุ้มครองแรงงาน ewf.labour.go.th) — เหมือนกันทุกบริษัท
// ข้อมูลกองทุนสำรองเลี้ยงชีพ: ระเบียบบริษัทข้อ 14.2 (อัตราสมทบตาม PVD_MATCH) — ถ้าระเบียบเปลี่ยน แก้ PVD_MATCH ที่เดียว
function compare() {
  const yrs = serviceYears(S.emp?.join_date), tier = matchTier(yrs);
  const caps = PVD_MATCH.map(t => `${t.cap}%`).join(" / ");
  const rows = [
    ["ลักษณะ", "ภาคบังคับตามกฎหมาย สำหรับพนักงานที่ไม่ได้เป็นสมาชิกกองทุนสำรองเลี้ยงชีพ", "สมัครใจ — เป็นสวัสดิการที่บริษัทจัดให้"],
    ["กฎหมายอ้างอิง", "พ.ร.บ.คุ้มครองแรงงาน พ.ศ. 2541 หมวด 13", "พ.ร.บ.กองทุนสำรองเลี้ยงชีพ พ.ศ. 2530"],
    ["ผู้บริหารกองทุน", "กรมสวัสดิการและคุ้มครองแรงงาน", "บริษัทจัดการกองทุน (บลจ.) — เค มาสเตอร์ พูล ฟันด์"],
    ["วัตถุประสงค์", "หลักประกันเมื่อออกจากงานหรือเสียชีวิต และคุ้มครองกรณีนายจ้างไม่จ่ายเงินตามกฎหมาย", "ออมเงินระยะยาวเพื่อเกษียณ"],
    ["ท่านจ่าย (เงินสะสม)", "0.25% ของค่าจ้าง (เพิ่มเป็น 0.50% ตั้งแต่ 1 ต.ค. 2574)", "เลือกเองได้ 2%–15% ของเงินเดือน"],
    ["บริษัทจ่ายให้ (เงินสมทบ)", "0.25% ของค่าจ้าง (เพิ่มเป็น 0.50% ตั้งแต่ 1 ต.ค. 2574)",
      `เท่ากับที่ท่านสะสม ไม่เกินเพดานตามอายุงาน ${caps}${tier ? ` — อายุงานท่าน ${yrs} ปี เพดาน <b>${tier.cap}%</b>` : ""}`],
    ["เลือกการลงทุน", "ไม่ได้ — กองทุนเป็นผู้ดูแล", `เลือกได้ ${PVD_POLICIES.length} แผน รวมแผน DIY จัดสัดส่วนเองในแอปฯ`],
    ["สิทธิลดหย่อนภาษี", "ไม่มี", "เงินสะสมของท่านลดหย่อนภาษีได้ตามที่จ่ายจริง (ตามเงื่อนไขกฎหมาย)"],
    ["ได้เงินคืนเมื่อไร", "เมื่อออกจากงานไม่ว่ากรณีใด (ลาออก ถูกเลิกจ้าง เกษียณ) — ได้เงินสะสม + เงินสมทบ + ดอกผล",
      "เมื่อลาออก / เกษียณ — ได้เงินสะสม + เงินสมทบ + ผลประโยชน์ ตามข้อบังคับกองทุน"],
    ["กรณีเสียชีวิต", "จ่ายให้ผู้รับประโยชน์ตามแบบ สกล.5 (ไม่ระบุ = แบ่งเท่ากันให้บุตร คู่สมรส บิดา มารดา)",
      "จ่ายให้ผู้รับผลประโยชน์ที่ระบุในแบบฟอร์ม (ส่วนที่ 2)"],
    ["เปลี่ยนแปลงภายหลัง", "แจ้งเปลี่ยนผู้รับประโยชน์ได้ ด้วยแบบ สกล.5 ฉบับใหม่", "เปลี่ยนอัตราเงินสะสมได้ปีละ 1 ครั้ง · เปลี่ยนแผนลงทุน / ผู้รับผลประโยชน์ได้"],
  ];
  // ตัวอย่างเงินเดือน 20,000 บาท — ใช้เพดานของท่านถ้ารู้อายุงาน ไม่งั้นใช้ขั้นแรก
  const cap = (tier || PVD_MATCH[0]).cap, sal = 20000, fmt = n => n.toLocaleString("th-TH");
  const wef = sal * 0.0025, pvd = sal * cap / 100;
  return `${stepper()}
  <div class="fx-card">
    <h1>เปรียบเทียบสองกองทุน</h1>
    <p class="fx-muted">ท่านเข้าได้ <b>อย่างใดอย่างหนึ่ง</b> — ถ้าเป็นสมาชิกกองทุนสำรองเลี้ยงชีพ ไม่ต้องจ่ายกองทุนสงเคราะห์ลูกจ้าง
      ถ้าไม่สมัครกองทุนสำรองเลี้ยงชีพ กฎหมายกำหนดให้เข้ากองทุนสงเคราะห์ลูกจ้าง (เริ่มหักเงิน 1 ต.ค. 2569)</p>
    <div class="fx-cmp">
      <div class="fx-cmp-h"><span></span><span class="w">กองทุนสงเคราะห์ลูกจ้าง</span><span class="p">กองทุนสำรองเลี้ยงชีพ</span></div>
      ${rows.map(([k, w, p]) => `<div class="fx-cmp-r"><b>${k}</b>
        <div class="w"><i>สงเคราะห์ลูกจ้าง</i>${w}</div><div class="p"><i>สำรองเลี้ยงชีพ</i>${p}</div></div>`).join("")}
    </div>
    <div class="fx-sec"><div class="fx-sec-t">ตัวอย่าง เงินเดือน ${fmt(sal)} บาท</div>
      <div class="fx-ex">
        <div class="w"><b>กองทุนสงเคราะห์ลูกจ้าง</b><span>ท่าน ${fmt(wef)} + บริษัท ${fmt(wef)}</span><em>= ${fmt(wef * 2)} บาท/เดือน</em></div>
        <div class="p"><b>กองทุนสำรองเลี้ยงชีพ (สะสม ${cap}%)</b><span>ท่าน ${fmt(pvd)} + บริษัท ${fmt(pvd)}</span><em>= ${fmt(pvd * 2)} บาท/เดือน</em></div>
      </div>
      <div class="fx-small fx-muted" style="margin-top:6px;">กองทุนสำรองเลี้ยงชีพ: ยอดจริงขึ้นกับอัตราที่ท่านเลือกและผลการลงทุน · ตัวอย่างนี้ใช้เพดานสมทบ${tier ? "ตามอายุงานของท่าน" : "ขั้นแรก"}</div></div>
    <p class="fx-small fx-muted" style="margin-top:14px;">ข้อมูลกองทุนสงเคราะห์ลูกจ้างจากกรมสวัสดิการและคุ้มครองแรงงาน (ewf.labour.go.th) ·
      กองทุนสำรองเลี้ยงชีพตามระเบียบบริษัท ข้อ 14.2 · ข้อมูล ณ ก.ย. 2569 · สงสัยสอบถาม HR</p>
    <div class="fx-sec"><div class="fx-sec-t">เลือกกองทุนของท่าน</div>
      <div class="fx-pick">
        <button class="fx-btn w" data-act="pick" data-form="wef" type="button">กองทุนสงเคราะห์ลูกจ้าง<small>กรอกแบบ สกล.5</small></button>
        <button class="fx-btn p" data-act="pick" data-form="pvd" type="button">กองทุนสำรองเลี้ยงชีพ<small>สมัครสมาชิก · เลือกอัตราสะสมและแผนลงทุน</small></button>
      </div></div>
    ${(S.emp?.history || []).length ? `<button class="fx-btn fx-link" data-act="back" type="button">ดูคำขอที่เคยส่ง</button>` : ""}
    <button class="fx-btn fx-link" data-act="logout" type="button">ไม่ใช่ฉัน / ออก</button>
  </div>`;
}

// ---------------------------------------------------------- PVD form
// บอกแค่ว่าพนักงานสะสมเท่าไร บริษัทสมทบเท่าไร (ระเบียบข้อ 14.2.2 — เพดานตามอายุงานใน PVD_MATCH)
// ตารางเพดานเต็มอยู่ในหน้าเปรียบเทียบแล้ว ตรงนี้ผู้ใช้ขอให้สั้นที่สุด
function matchBox(rate) {
  if (!rate) return "";
  const er = employerMatch(rate, serviceYears(S.emp?.join_date));
  return `<div class="fx-hint fx-match">ท่านสะสม <b>${+rate}%</b> · บริษัทสมทบ <b>${er == null ? "ตามอายุงาน" : `${er}%`}</b></div>`;
}
const pvdNeeds = p => { const r = new Set(p.requests), a = r.has("apply");
  return { ben: a || r.has("beneficiary"), rate: a || r.has("rate"), pol: a || r.has("policy") }; };

function relSelect(prefix, i, b) {
  return `<select class="fx-i" data-f="${prefix}.${i}.relation">
      <option value="">— เลือก —</option>${RELATIONS.map(r => `<option ${b.relation === r ? "selected" : ""}>${r}</option>`).join("")}</select>
    ${b.relation === "อื่น ๆ" ? `<input class="fx-i" data-f="${prefix}.${i}.other" value="${esc(b.other)}" placeholder="ระบุความสัมพันธ์">` : ""}`;
}

function pvdForm() {
  const p = S.pvd, need = pvdNeeds(p), apply = p.requests.includes("apply");
  return `${stepper()}
  <div class="fx-card">
    <h1>กองทุนสำรองเลี้ยงชีพ</h1>
    ${rejectBox("pvd")}
    <div class="fx-sec"><div class="fx-sec-t">เรื่องที่ขอ <span class="fx-muted">(เลือกได้มากกว่า 1 ข้อ)</span></div>
      ${PVD_REQUESTS.map(r => { const dis = apply && r.key !== "apply";
        return `<label class="fx-chk ${dis ? "dis" : ""}"><input type="checkbox" data-act="req" value="${r.key}"
          ${p.requests.includes(r.key) || dis ? "checked" : ""} ${dis ? "disabled" : ""}>
          <span>${r.label}</span></label>`; }).join("")}
      ${apply ? `<div class="fx-hint">สมัครใหม่ต้องกรอกทุกส่วน (ผู้รับผลประโยชน์ · อัตราเงินสะสม · นโยบายการลงทุน)</div>` : ""}
    </div>

    ${need.ben ? `<div class="fx-sec"><div class="fx-sec-t">ผู้รับผลประโยชน์ <span class="fx-muted">(สูงสุด 3 คน)</span>
        ${sumBadge(pctTotal(p))}</div>
      ${p.beneficiaries.map((b, i) => `<div class="fx-person">
        <div class="fx-person-h">คนที่ ${i + 1}${p.beneficiaries.length > 1 ? `<button class="fx-x" data-act="delben" data-i="${i}" type="button">ลบ</button>` : ""}</div>
        <label class="fx-l">ชื่อ-นามสกุล<input class="fx-i" data-f="pben.${i}.name" value="${esc(b.name)}"></label>
        <div class="fx-row"><label class="fx-l">ความสัมพันธ์${relSelect("pben", i, b)}</label>
          <label class="fx-l fx-w30">ร้อยละ<input class="fx-i" inputmode="numeric" maxlength="3" autocomplete="off" data-f="pben.${i}.percent" value="${esc(b.percent)}"></label></div>
      </div>`).join("")}
      ${p.beneficiaries.length < 3 ? `<button class="fx-btn fx-ghost" data-act="addben" type="button">+ เพิ่มผู้รับผลประโยชน์</button>` : ""}
    </div>` : ""}

    ${need.rate ? `<div class="fx-sec"><div class="fx-sec-t">อัตราเงินสะสม</div>
      <label class="fx-l">หักจากเงินเดือนร้อยละ<select class="fx-i fx-w30" data-f="rate"><option value="">—</option>
        ${Array.from({ length: 14 }, (_, k) => k + 2).map(n => `<option value="${n}" ${+p.rate === n ? "selected" : ""}>${n}%</option>`).join("")}</select></label>
      ${matchBox(p.rate)}</div>` : ""}

    ${need.pol ? `<div class="fx-sec"><div class="fx-sec-t">นโยบายการลงทุน</div>
      ${PVD_POLICIES.map(x => `<label class="fx-radio"><input type="radio" name="pol" data-f="policy" value="${x.key}" ${p.policy === x.key ? "checked" : ""}>
        <span><b>${x.label}</b> <span class="fx-muted">(${x.key})</span><br><span class="fx-small fx-muted">${x.risk}${x.note ? ` · ${x.note}` : ""}</span></span></label>`).join("")}
    </div>` : ""}

    ${errBox()}
    <div class="fx-nav"><button class="fx-btn fx-ghost" data-act="back">ย้อนกลับ</button>
      <button class="fx-btn fx-primary" data-act="toreview">ตรวจทาน</button></div>
  </div>`;
}

// ---------------------------------------------------------- WEF form
function wefForm() {
  const w = S.wef, a = w.addr, e = S.emp;
  const idOk = !w.id_card || (validThaiId(w.id_card) && w.id_card.endsWith(S.cred.last5));
  const inp = (label, f, v, extra = "") => `<label class="fx-l">${label}<input class="fx-i" data-f="${f}" value="${esc(v)}" ${extra}></label>`;
  return `${stepper()}
  <div class="fx-card">
    <h1>กองทุนสงเคราะห์ลูกจ้าง <span class="fx-muted fx-small">แบบ สกล.5</span></h1>
    ${rejectBox("wef")}
    <p class="fx-muted">ระบุผู้ที่จะได้รับเงินจากกองทุน หากท่านเสียชีวิต</p>

    <div class="fx-sec"><div class="fx-sec-t">ข้อมูลของท่าน</div>
      <div class="fx-row"><label class="fx-l fx-w30">คำนำหน้า<select class="fx-i" data-f="title">
          ${["", "นาย", "นาง", "นางสาว"].map(t => `<option value="${t}" ${w.title === t ? "selected" : ""}>${t || "—"}</option>`).join("")}</select></label>
        <label class="fx-l">ชื่อ-สกุล<input class="fx-i" value="${esc(e.name)}" disabled></label></div>
      <div class="fx-row">${inp("อายุ (ปี)", "age", w.age, 'type="number" inputmode="numeric"')}
        <label class="fx-l">สัญชาติ<select class="fx-i" data-f="is_thai"><option value="1" ${w.is_thai ? "selected" : ""}>ไทย</option><option value="0" ${!w.is_thai ? "selected" : ""}>ไม่ใช่สัญชาติไทย</option></select></label></div>
      ${w.is_thai
        ? `<label class="fx-l">เลขประจำตัวประชาชน 13 หลัก<input class="fx-i ${idOk ? "" : "bad"}" data-f="id_card" value="${esc(w.id_card)}" inputmode="numeric" maxlength="13"></label>
           ${idOk ? "" : `<div class="fx-bad">${validThaiId(w.id_card) ? "เลขบัตรไม่ตรงกับ 5 ตัวท้ายที่ใช้ยืนยันตัว" : "เลขบัตรไม่ถูกต้อง ตรวจอีกครั้ง"}</div>`}`
        : `<div class="fx-row">${inp("สัญชาติ", "nationality", w.nationality)}${inp("เลขหนังสือเดินทาง / บัตรผู้ไม่มีสัญชาติไทย", "passport", w.passport)}</div>`}
      <div class="fx-sub">ที่อยู่ปัจจุบัน</div>
      <div class="fx-row">${inp("บ้านเลขที่", "addr.no", a.no)}${inp("หมู่ที่", "addr.moo", a.moo)}</div>
      <div class="fx-row">${inp("ตรอก/ซอย", "addr.soi", a.soi)}${inp("ถนน", "addr.road", a.road)}</div>
      <div class="fx-row">${inp("ตำบล/แขวง", "addr.subdistrict", a.subdistrict)}${inp("อำเภอ/เขต", "addr.district", a.district)}</div>
      <div class="fx-row">${inp("จังหวัด", "addr.province", a.province)}${inp("รหัสไปรษณีย์", "addr.zip", a.zip, 'inputmode="numeric" maxlength="5"')}</div>
      ${inp("โทรศัพท์", "phone", w.phone, 'inputmode="tel"')}
      ${inp("เขียนที่", "written_at", w.written_at)}
    </div>

    <div class="fx-sec"><div class="fx-sec-t">ผู้รับประโยชน์ <span class="fx-muted">(สูงสุด 8 คน)</span></div>
      ${w.beneficiaries.map((b, i) => { const ok = !b.id_card || validThaiId(b.id_card); return `<div class="fx-person">
        <div class="fx-person-h">คนที่ ${i + 1}${w.beneficiaries.length > 1 ? `<button class="fx-x" data-act="delwben" data-i="${i}" type="button">ลบ</button>` : ""}</div>
        ${inp("ชื่อ-สกุล", `wben.${i}.name`, b.name)}
        <div class="fx-row"><label class="fx-l">เกี่ยวข้องเป็น${relSelect("wben", i, b)}</label>
          <label class="fx-l fx-w30">ได้รับ (ส่วน)<input class="fx-i" inputmode="numeric" maxlength="3" autocomplete="off" data-f="wben.${i}.shares" value="${esc(b.shares)}" placeholder="เท่ากัน"></label></div>
        <label class="fx-l">เลขประจำตัวประชาชน (ต้องระบุ)<input class="fx-i ${ok ? "" : "bad"}" data-f="wben.${i}.id_card" value="${esc(b.id_card)}" inputmode="numeric" maxlength="13"></label>
        ${ok ? "" : `<div class="fx-bad">เลขบัตรไม่ถูกต้อง</div>`}
        <label class="fx-chk"><input type="checkbox" data-act="sameaddr" data-i="${i}" ${b.sameAddr ? "checked" : ""}><span>ที่อยู่เดียวกับข้าพเจ้า</span></label>
        ${b.sameAddr ? "" : `<label class="fx-l">ที่อยู่ปัจจุบัน/ที่ติดต่อ<textarea class="fx-i" rows="2" data-f="wben.${i}.address">${esc(b.address)}</textarea></label>`}
      </div>`; }).join("")}
      ${w.beneficiaries.length < 8 ? `<button class="fx-btn fx-ghost" data-act="addwben" type="button">+ เพิ่มผู้รับประโยชน์</button>` : ""}
      <div class="fx-hint" id="fxShareHint">${shareHint(w)}</div>
    </div>

    ${errBox()}
    <div class="fx-nav"><button class="fx-btn fx-ghost" data-act="back">ย้อนกลับ</button>
      <button class="fx-btn fx-primary" data-act="toreview">ตรวจทาน</button></div>
  </div>`;
}

// --------------------------------------------------------- build + check
const relOf = b => b.relation === "อื่น ๆ" ? (b.other || "").trim() : b.relation;
const addrText = a => [a.no && `เลขที่ ${a.no}`, a.moo && `หมู่ ${a.moo}`, a.soi && `ซอย ${a.soi}`, a.road && `ถนน ${a.road}`,
  a.subdistrict && `ต.${a.subdistrict}`, a.district && `อ.${a.district}`, a.province && `จ.${a.province}`, a.zip].filter(Boolean).join(" ");

// คืน [payload, errorText]
function build() {
  if (S.form === "pvd") {
    const p = S.pvd, need = pvdNeeds(p);
    if (!p.requests.length) return [null, "กรุณาเลือกเรื่องที่ขออย่างน้อย 1 ข้อ"];
    const out = { requests: p.requests.includes("apply") ? ["apply"] : [...p.requests], consent: p.consent };
    if (need.ben) {
      const bs = p.beneficiaries.map(b => ({ name: b.name.trim(), relation: relOf(b), percent: +b.percent || 0 }));
      if (bs.some(b => !b.name || !b.relation || !b.percent)) return [null, "กรอกชื่อ ความสัมพันธ์ และร้อยละของผู้รับผลประโยชน์ให้ครบ"];
      const tot = bs.reduce((s, b) => s + b.percent, 0);
      if (tot !== 100) return [null, `ร้อยละของผู้รับผลประโยชน์ต้องรวมได้ 100 (ตอนนี้ ${tot})`];
      out.beneficiaries = bs;
    }
    if (need.rate) { if (!(+p.rate >= 2 && +p.rate <= 15)) return [null, "กรุณาเลือกอัตราเงินสะสม"]; out.rate = +p.rate; }
    if (need.pol) { if (!p.policy) return [null, "กรุณาเลือกนโยบายการลงทุน"]; out.policy = p.policy; }
    if (p.signature) out.signature = p.signature;
    return [out, ""];
  }
  const w = S.wef;
  if (!w.title) return [null, "กรุณาเลือกคำนำหน้า"];
  if (w.is_thai && !validThaiId(w.id_card)) return [null, "เลขประจำตัวประชาชนของท่านไม่ถูกต้อง"];
  if (w.is_thai && !w.id_card.endsWith(S.cred.last5)) return [null, "เลขประจำตัวประชาชนของท่านไม่ตรงกับ 5 ตัวท้ายที่ใช้ยืนยันตัว"];
  if (!w.is_thai && !w.passport.trim()) return [null, "กรุณากรอกเลขหนังสือเดินทาง"];
  if (!w.addr.no || !w.addr.subdistrict || !w.addr.district || !w.addr.province) return [null, "กรอกที่อยู่ให้ครบ (บ้านเลขที่ ตำบล อำเภอ จังหวัด)"];
  const me = addrText(w.addr);
  const bs = w.beneficiaries.map(b => ({ name: b.name.trim(), relation: relOf(b), id_card: b.id_card,
    address: b.sameAddr ? me : b.address.trim(), shares: +b.shares || null }));
  for (const [i, b] of bs.entries()) {
    if (!b.name || !b.relation || !b.address) return [null, `กรอกข้อมูลผู้รับประโยชน์คนที่ ${i + 1} ให้ครบ`];
    if (!validThaiId(b.id_card)) return [null, `เลขประจำตัวประชาชนของผู้รับประโยชน์คนที่ ${i + 1} ไม่ถูกต้อง`];
  }
  if (bs.some(b => b.shares) && bs.some(b => !b.shares)) return [null, "ถ้าระบุจำนวนส่วน ต้องระบุให้ครบทุกคน (หรือเว้นว่างทุกคนเพื่อแบ่งเท่ากัน)"];
  return [{ title: w.title, age: +w.age || null, is_thai: w.is_thai, nationality: w.is_thai ? "ไทย" : w.nationality.trim(),
    id_card: w.is_thai ? w.id_card : "", passport: w.is_thai ? "" : w.passport.trim(), addr: { ...w.addr },
    phone: w.phone.trim(), written_at: w.written_at.trim(), beneficiaries: bs, consent: w.consent,
    ...(w.signature ? { signature: w.signature } : {}) }, ""];
}

const subOf = payload => ({ form_type: S.form, emp_code: S.emp.emp_code,
  emp_name: S.emp.name || "", department: S.emp.department,
  payload, id: S.result?.id, submitted_at: S.result?.submitted_at || new Date().toISOString() });

function review() {
  const [p] = build(), f = S.form === "pvd" ? S.pvd : S.wef;
  const row = (k, v) => `<div class="fx-kv"><span>${k}</span><b>${v}</b></div>`;
  let body = "";
  if (S.form === "pvd") {
    body += row("เรื่องที่ขอ", p.requests.map(k => PVD_REQUESTS.find(r => r.key === k).label).join("<br>"));
    if (p.beneficiaries) body += row("ผู้รับผลประโยชน์", p.beneficiaries.map(b => `${esc(b.name)} (${esc(b.relation)}) ${b.percent}%`).join("<br>"));
    if (p.rate) body += row("อัตราเงินสะสม", `${p.rate}% ของเงินเดือน`);
    if (p.policy) body += row("นโยบายการลงทุน", `${PVD_POLICIES.find(x => x.key === p.policy).label} (${p.policy})`);
  } else {
    body += row("ผู้แสดงเจตนา", `${esc(p.title)} ${esc(S.emp.name)} · อายุ ${p.age || "-"} ปี · สัญชาติ${esc(p.nationality)}`);
    body += row(p.is_thai ? "เลขประจำตัวประชาชน" : "เลขหนังสือเดินทาง", esc(p.is_thai ? p.id_card : p.passport));
    body += row("ที่อยู่", esc(addrText(p.addr)) + (p.phone ? ` · โทร ${esc(p.phone)}` : ""));
    const tot = p.beneficiaries.reduce((s, b) => s + (b.shares || 0), 0);
    body += row(`ผู้รับประโยชน์ ${p.beneficiaries.length} คน`, p.beneficiaries.map(b =>
      `${esc(b.name)} (${esc(b.relation)}) — ${tot ? `${b.shares}/${tot} ส่วน` : "ส่วนเท่ากัน"}<br><span class="fx-small fx-muted">${esc(b.id_card)} · ${esc(b.address)}</span>`).join("<br>"));
  }
  return `${stepper()}
  <div class="fx-card">
    <h1>ตรวจทานก่อนส่ง</h1>
    <div class="fx-muted">${FORM_NAME[S.form]}</div>
    <div class="fx-review">${body}</div>
    <div class="fx-sec"><div class="fx-sec-t">ลงลายมือชื่อ <span class="fx-muted">(ไม่บังคับ)</span>
        <span class="fx-sum ${f.signature ? "ok" : ""}" id="fxSigState">${f.signature ? "เซ็นแล้ว ✓" : "ยังไม่เซ็น"}</span></div>
      <p class="fx-muted fx-small">ใช้นิ้วเซ็นในกรอบ ถ้าเซ็นที่นี่ แบบฟอร์มที่พิมพ์จะมีลายเซ็นของท่านแล้ว เหลือให้พยานเซ็นบนกระดาษ · ถ้าไม่เซ็น ให้เซ็นบนกระดาษเอง</p>
      <canvas id="fxPad" class="fx-pad"></canvas>
      <button class="fx-btn fx-link" data-act="clearsig" type="button">ล้างลายเซ็น</button></div>
    <button class="fx-btn fx-ghost fx-block" data-act="preview" type="button">ดูตัวอย่างแบบฟอร์มที่จะพิมพ์</button>
    <label class="fx-chk fx-consent"><input type="checkbox" data-act="consent" ${f.consent ? "checked" : ""}>
      <span>ข้าพเจ้ายืนยันว่าข้อมูลถูกต้อง และยินยอมให้บริษัทเก็บและใช้ข้อมูลนี้ รวมถึงข้อมูลของผู้รับประโยชน์
      เพื่อดำเนินการเรื่องกองทุนเท่านั้น${S.form === "wef" ? " และส่งให้กรมสวัสดิการและคุ้มครองแรงงาน" : " และส่งให้บริษัทจัดการกองทุน"}
      ทั้งนี้ข้าพเจ้าได้แจ้งผู้รับประโยชน์แล้ว</span></label>
    <div class="fx-err" style="background:var(--amber-light);color:#92400E;"><b>ตรวจให้ครบก่อนส่ง</b> — ส่งแล้วแก้ไขเองไม่ได้
      ถ้าต้องการแก้ไขหรือเปลี่ยนกองทุนภายหลัง ต้องติดต่อ HR</div>
    ${errBox()}
    <div class="fx-nav"><button class="fx-btn fx-ghost" data-act="edit">แก้ไข</button>
      <button class="fx-btn fx-primary" data-act="submit" ${f.consent && !S.busy ? "" : "disabled"}>${S.busy ? "กำลังส่ง…" : "ส่งแบบฟอร์ม"}</button></div>
  </div>`;
}

function done() {
  const wit = S.form === "wef" ? "พยาน 2 คน" : "พยาน 1 คน", signed = !!cur()?.signature;
  return `${stepper()}
  <div class="fx-card fx-center">
    <div class="fx-ok">✓</div>
    <h1>ส่งเรียบร้อย</h1>
    <p>เลขที่คำขอ <b>#${S.result.id}</b></p>
    <div class="fx-todo">
      <div class="fx-todo-t">ขั้นตอนต่อไป</div>
      <ol><li>กดปุ่มด้านล่างเพื่อพิมพ์แบบฟอร์ม (หรือบันทึกเป็น PDF แล้วไปพิมพ์ทีหลัง)</li>
        <li>${signed ? `ให้${wit}ลงชื่อ (ลายเซ็นของท่านอยู่ในแบบฟอร์มแล้ว)` : `ลงชื่อ พร้อมให้${wit}ลงชื่อ`}</li>
        <li>ส่งตัวจริงที่ฝ่ายทรัพยากรบุคคล</li></ol>
      <div class="fx-small fx-muted">ถ้าพิมพ์เองไม่ได้ แจ้ง HR ด้วยเลขที่คำขอ HR พิมพ์ให้ได้</div>
    </div>
    <button class="fx-btn fx-primary fx-block" data-act="print">พิมพ์ / บันทึก PDF</button>
    <button class="fx-btn fx-ghost fx-block" data-act="again">กลับหน้าแรก</button>
  </div>`;
}

// ---------------------------------------------------------------- actions
async function doVerify(form) {
  S.cred = { code: form.code.value.trim().toUpperCase(), last5: digits(form.last5.value) };
  S.busy = true; S.err = ""; render();
  const { data, error } = await supabase.rpc("fund_form_lookup", { p_token: S.token, p_emp_code: S.cred.code, p_last5: S.cred.last5 });
  S.busy = false;
  if (error) { S.err = errMsg(error); render(); return; }
  if (!data) { S.err = "ข้อมูลไม่ตรงกับคำเชิญ ตรวจรหัสพนักงานและเลขบัตร 5 ตัวท้ายอีกครั้ง (ถ้ายังไม่ได้ ติดต่อ HR)"; render(); return; }
  S.emp = data;
  // เปิดให้ฟอร์มเดียวและยังไม่ได้ส่ง (หรือถูกส่งกลับ) → เข้าฟอร์มเลย · ส่งไปแล้วให้เห็นสถานะที่หน้าเลือกก่อน
  const only = (data.forms || []).length === 1 && data.forms[0];
  if (only && !locked() && (!latestOf(only) || latestOf(only).status === "rejected")) { startForm(only); return; }
  // เลือกได้สองกองทุนและยังไม่เคยส่ง → เริ่มที่หน้าเปรียบเทียบ เลือกกองทุนได้จากหน้านั้นเลย
  // (เคยส่งแล้วให้เห็นสถานะ / ดาวน์โหลด PDF ที่หน้าแรกก่อน)
  if ((data.forms || []).length > 1 && !locked() && !latestAny()) { go("compare"); return; }
  go("choose");
}

async function doSubmit() {
  const [payload, e] = build();
  if (e) { S.err = e; render(); return; }
  S.busy = true; S.err = ""; render();
  const { data, error } = await supabase.rpc("fund_form_submit", {
    p_token: S.token, p_emp_code: S.cred.code, p_last5: S.cred.last5, p_form_type: S.form, p_payload: payload });
  S.busy = false;
  if (error) { S.err = errMsg(error); render(); return; }
  S.result = data;
  S.emp.history = [{ id: data.id, form_type: S.form, status: "submitted", submitted_at: data.submitted_at }, ...(S.emp.history || [])];
  S.emp.latest = { id: data.id, form_type: S.form, status: "submitted", submitted_at: data.submitted_at, payload };
  go("done");
}

// ใส่ค่าลง state ตาม data-f="a.b.c" (pben/wben = รายชื่อผู้รับประโยชน์ของแต่ละฟอร์ม)
function setField(path, value) {
  const [head, ...rest] = path.split(".");
  let obj = head === "pben" ? S.pvd.beneficiaries : head === "wben" ? S.wef.beneficiaries : S.form === "pvd" ? S.pvd : S.wef;
  const keys = head === "pben" || head === "wben" ? rest : [head, ...rest];
  for (const k of keys.slice(0, -1)) obj = obj[k];
  const last = keys[keys.length - 1];
  if (last === "id_card" || last === "zip") value = digits(value);
  if (last === "is_thai") value = value === "1";
  obj[last] = value;
}

$app.addEventListener("submit", e => { e.preventDefault(); if (e.target.dataset.act === "verify") doVerify(e.target); });

$app.addEventListener("input", e => {
  const f = e.target.dataset.f; if (!f) return;
  setField(f, e.target.value);
  // เฉพาะช่องที่ต้องแสดงผลใหม่ (ยอดรวม / เลขบัตรผิด) — ช่องพิมพ์ทั่วไปไม่ render เพื่อไม่ให้เคอร์เซอร์หลุด
  // ร้อยละ / จำนวนส่วน: อัปเดตแค่ยอดรวม ไม่ render ทั้งหน้า (render ทำให้เคอร์เซอร์กระโดด พิมพ์ลำบาก)
  if (/percent|shares/.test(f)) {
    const clean = f.endsWith("percent") ? String(Math.min(100, +digits(e.target.value) || 0) || "") : digits(e.target.value);
    if (e.target.value !== clean) e.target.value = clean;
    setField(f, clean);
    if (f.endsWith("percent")) { $app.querySelector("#fxSum").outerHTML = sumBadge(pctTotal(S.pvd)); }
    else $app.querySelector("#fxShareHint").innerHTML = shareHint(S.wef);
    return;
  }
  if (/id_card/.test(f) && e.target.value.length >= 13) rerenderKeepFocus(e.target);
});
$app.addEventListener("change", e => {
  const t = e.target, f = t.dataset.f;
  if (f && (t.tagName === "SELECT" || t.type === "radio")) { setField(f, t.value); render(); return; }
  if (f && /id_card/.test(f)) { rerenderKeepFocus(t); return; }
  const act = t.dataset.act;
  if (act === "req") {
    const r = new Set(S.pvd.requests); t.checked ? r.add(t.value) : r.delete(t.value);
    if (t.value === "apply" && t.checked) r.clear(), r.add("apply");
    S.pvd.requests = [...r]; render();
  }
  if (act === "sameaddr") { S.wef.beneficiaries[+t.dataset.i].sameAddr = t.checked; render(); }
  if (act === "consent") { (S.form === "pvd" ? S.pvd : S.wef).consent = t.checked; render(); }
});

function rerenderKeepFocus(el) {
  const f = el.dataset.f, pos = el.selectionStart;
  render();
  const n = $app.querySelector(`[data-f="${f}"]`);
  if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) { /* number input */ } }
}

$app.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b || b.tagName === "INPUT" || b.tagName === "FORM") return;
  const act = b.dataset.act, i = +b.dataset.i;
  if (act === "pick") startForm(b.dataset.form);
  else if (act === "logout") { Object.assign(S, { emp: null, pvd: null, wef: null, cred: { code: "", last5: "" } }); go("verify"); }
  else if (act === "back") go("choose");
  else if (act === "compare") go("compare");
  else if (act === "edit") go(S.form);
  else if (act === "toreview") { const [, err] = build(); if (err) { S.err = err; render(); return; } go("review"); }
  else if (act === "addben") { S.pvd.beneficiaries.push({ name: "", relation: "", other: "", percent: "" }); render(); }
  else if (act === "delben") { S.pvd.beneficiaries.splice(i, 1); render(); }
  else if (act === "addwben") { S.wef.beneficiaries.push({ name: "", relation: "", other: "", id_card: "", address: "", sameAddr: false, shares: "" }); render(); }
  else if (act === "delwben") { S.wef.beneficiaries.splice(i, 1); render(); }
  else if (act === "preview") { const [p] = build(); printSubmission(subOf(p)); }
  else if (act === "submit") doSubmit();
  // ฉบับล่าสุดที่ส่งไว้ — เปิดหน้าพิมพ์ เลือก "บันทึกเป็น PDF" ได้
  else if (act === "dl") { const l = S.emp.latest; if (l) printSubmission({ ...l, emp_code: S.emp.emp_code,
    emp_name: S.emp.name || "", department: S.emp.department }); }
  else if (act === "clearsig") { cur().signature = null; render(); }
  else if (act === "print") { const [p] = build(); printSubmission(subOf(p)); }
  else if (act === "again") { if (S.form === "pvd") S.pvd = null; else S.wef = null; S.result = null; go("choose"); }
});

render();
