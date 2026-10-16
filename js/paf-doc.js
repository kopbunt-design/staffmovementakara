// ============================================================================
// Personnel Action Form (AKR-OHR-FM-031 Rev. 00) — ใบ A4 + ข้อความสภาพการจ้าง + เดาประเภท Movement
//   ใช้ทั้งหน้า PAF (js/paf.js) และหน้าอนุมัติจากลิงก์ (paf/approve.js) · ห้าม import อะไรที่ดึง js/app.js
//   แบบใบ: ตามไฟล์สแกนที่ HR ใช้ (2026-10-16) แต่ช่องลายเซ็น HR / GM แทนด้วย "บันทึกการอนุมัติ" แบบ AKARA Approval System
//   ช่องพนักงานลงนามรับทราบยังเซ็นมือบนกระดาษ
// ============================================================================

export const FORM = { code: "AKR-OHR-FM-031 Rev. 00", effective: "Effective Date: 02-Sep-2026" };
export const STEPS = [{ step: 1, label: "HR Manager", label_th: "ผู้จัดการฝ่ายทรัพยากรบุคคล" }, { step: 2, label: "General Manager", label_th: "ผู้จัดการทั่วไป" }];
// เรื่องที่ใช้บ่อย (เลือกแล้วแก้ต่อได้)
export const SUBJECTS = [
  { th: "พิจารณาอนุมัติปรับเงินเดือน", en: "Request for Approval of Salary Adjustment" },
  { th: "พิจารณาอนุมัติปรับเงินเดือนเพื่อความสอดคล้องภายใน", en: "Request for Approval of Salary Alignment for Internal Equity" },
  { th: "พิจารณาอนุมัติเลื่อนตำแหน่ง", en: "Request for Approval of Promotion" },
  { th: "พิจารณาอนุมัติปรับระดับตำแหน่ง", en: "Request for Approval of Job Level Adjustment" },
  { th: "พิจารณาอนุมัติโอนย้ายหน่วยงาน", en: "Request for Approval of Transfer" },
  { th: "พิจารณาอนุมัติเปลี่ยนตำแหน่งงาน", en: "Request for Approval of Change of Position" },
];
export const MOV_LABEL = { Transfer: "โอนย้าย (Transfer)", Promotion: "เลื่อนตำแหน่ง (Promotion)", Demotion: "ปรับลดตำแหน่ง (Demotion)",
  "Salary Adjustment": "ปรับเงินเดือน (Salary Adjustment)", none: "ไม่บันทึก Movement" };

const TH_MF = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const TH_M = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const EN_MF = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const ymd = iso => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? [+m[1], +m[2], +m[3]] : null; };
export const thLong = iso => { const d = ymd(iso); return d ? `${d[2]} ${TH_MF[d[1] - 1]} ${d[0] + 543}` : ""; };
export const enLong = iso => { const d = ymd(iso); return d ? `${d[2]} ${EN_MF[d[1] - 1]} ${d[0]}` : ""; };
// เวลาในบันทึกการอนุมัติ = เวลาไทยเสมอ (ไม่ขึ้นกับเครื่องที่เปิด)
export const thStamp = ts => {
  if (!ts) return "";
  const t = new Date(new Date(ts).getTime() + 7 * 3600e3), p = n => String(n).padStart(2, "0");
  return `${t.getUTCDate()} ${TH_M[t.getUTCMonth()]} ${String(t.getUTCFullYear() + 543).slice(-2)} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};
const EN_M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const enStamp = ts => {
  if (!ts) return "";
  const t = new Date(new Date(ts).getTime() + 7 * 3600e3), p = n => String(n).padStart(2, "0");
  return `${t.getUTCDate()} ${EN_M[t.getUTCMonth()]} ${t.getUTCFullYear()} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const money = n => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const has = v => v !== null && v !== undefined && String(v).trim() !== "";

// ระดับตำแหน่ง: ตัวอักษรก่อน (O < S < M < E) แล้วตัวเลข — ไม่รู้จัก = null
const LV = ["O", "S", "M", "E"];
export function levelRank(lv) {
  const m = String(lv || "").trim().toUpperCase().match(/^([A-Z])\s*(\d*)/); if (!m) return null;
  const i = LV.indexOf(m[1]); return i < 0 ? null : i * 100 + (+m[2] || 0);
}
const changed = (f, k) => has(f[`${k}_to`]) && String(f[`${k}_to`]).trim() !== String(f[k] ?? "").trim();
export const salaryChanged = f => has(f.salary_to) && Number(f.salary_to) !== Number(f.salary_from);
// เดาประเภท Movement จากสิ่งที่เปลี่ยน — HR เปลี่ยนเองได้ในฟอร์ม
export function suggestMovType(f) {
  const org = ["division", "department", "section", "team"].some(k => changed(f, k));
  const pos = changed(f, "position"), lv = changed(f, "job_level");
  if (lv) { const a = levelRank(f.job_level), b = levelRank(f.job_level_to); if (a != null && b != null && a !== b) return b > a ? "Promotion" : "Demotion"; }
  if (org) return "Transfer";
  if (pos || lv) return "Promotion";
  if (salaryChanged(f)) return "Salary Adjustment";
  return "none";
}

// ข้อความในกล่องสภาพการจ้างเดิม / ใหม่ — เฉพาะเรื่องที่เปลี่ยน (สองภาษาแบบใบจริง)
export function conditionLines(f) {
  const cur = [], rev = [];
  if (salaryChanged(f)) {
    cur.push(`Monthly Salary: THB ${money(f.salary_from)} (อัตราเงินเดือน ${money(f.salary_from)} บาท)`);
    rev.push(`Monthly Salary: THB ${money(f.salary_to)} (อัตราเงินเดือน ${money(f.salary_to)} บาท)`);
  }
  const row = (k, en, th) => { if (!changed(f, k)) return; cur.push(`${en}: ${f[k] || "-"} (${th} ${f[k] || "-"})`); rev.push(`${en}: ${f[`${k}_to`]} (${th} ${f[`${k}_to`]})`); };
  row("position", "Position", "ตำแหน่ง"); row("job_level", "Job Level", "ระดับตำแหน่ง");
  row("division", "Division", "ฝ่าย"); row("department", "Department", "ฝ่าย/แผนก"); row("section", "Section", "แผนก"); row("team", "Team", "ทีมงาน");
  return { cur, rev };
}

const CSS = `@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');
@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font-family:'Sarabun',Tahoma,sans-serif;color:#111;font-size:12.5px;line-height:1.45;background:#fff}
.pg{width:210mm;min-height:297mm;padding:12mm 13mm 14mm;position:relative;display:flex;flex-direction:column}
.hd{display:flex;align-items:flex-end;gap:10px;border-bottom:2.5px solid #2457a6;padding-bottom:4px}.hd img{height:13mm}.hd .sp{flex:1}
.hd .r{text-align:right;font-size:11px;color:#2457a6;font-weight:600}.hd .no{font-size:11.5px;color:#111;font-weight:400}.hd .no b{font-size:13px}
.ttl{margin-top:5mm;background:#e6e6e6;border:1px solid #444;text-align:center;padding:6px 0 5px}.ttl b{font-size:15px;display:block}.ttl span{font-size:12px;font-weight:600}
table{width:100%;border-collapse:collapse}td,th{border:1px solid #444;padding:3px 6px;vertical-align:top}
.k{width:22%;font-weight:600}.k small{display:block;font-weight:700;font-size:11.5px}.v{text-align:center;vertical-align:middle}.v small{display:block}
.blk{margin-top:2.5mm}.subj .k{width:18%}.subj .v b{font-size:14px}
.cond th{background:#e6e6e6;font-weight:600;text-align:center;width:50%}.cond th small{display:block;font-weight:700}
.cond td{height:72mm;font-size:12px}.cond p{margin:0 0 5px}.cond .nt{margin-top:10px;white-space:pre-wrap}
.eff .k{width:26%}
h4{margin:4mm 0 1.5mm;font-size:12.5px;color:#2457a6}
h4 span{font-weight:600;color:#6b7a99;font-size:11.5px;margin-left:4px}
.log th{background:#eef2f8;font-weight:600;font-size:11.5px;text-align:left;color:#334;line-height:1.25}.log th small{display:block;font-weight:500;font-size:10px;color:#6b7a99}
.log td{font-size:11.5px}.log .n{width:7mm;text-align:center}.log .w small,.log .a small{display:block;color:#666;font-size:10px}
.log .w{width:30mm;white-space:nowrap}.log .a{width:38mm}.log .p small{display:block;color:#555;font-size:10.5px}
.tag{display:inline-block;padding:0 7px;border-radius:9px;font-size:10.5px;font-weight:600;background:#eef1f5;color:#334}
.tag.ok{background:#dcfce7;color:#166534}.tag.no{background:#fee2e2;color:#991b1b}.tag.wait{background:#fef3c7;color:#92400e}
.log tr.pend td{color:#888}
.ban{margin-top:2mm;border:1px solid;border-radius:6px;padding:6px 10px;display:flex;gap:9px;align-items:center;font-size:11.5px}
.ban b{display:block;font-size:12.5px}.ban i{font-style:normal;width:20px;height:20px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:700;flex:none}
.ban.ok{border-color:#86efac;background:#f0fdf4;color:#166534}.ban.ok i{background:#16a34a}
.ban.wait{border-color:#fcd34d;background:#fffbeb;color:#92400e}.ban.wait i{background:#d97706}
.ban.no{border-color:#fca5a5;background:#fef2f2;color:#991b1b}.ban.no i{background:#dc2626}
.ack{margin-top:4mm}.ack .k{width:24%}.ack td{height:13mm;vertical-align:middle}.ack .d{width:10%}.ack .dv{width:16%;text-align:center}
.ft{margin-top:auto;padding-top:5mm;display:flex;justify-content:space-between;font-size:10.5px;color:#444}
.draft{position:absolute;top:38%;left:0;right:0;text-align:center;font-size:64px;color:rgba(200,0,0,.10);transform:rotate(-24deg);font-weight:700;pointer-events:none}
@media print{.pg{min-height:0;height:297mm}}`;

// สองภาษา — GM เป็นชาวต่างชาติ (user 2026-10-16) · ส่วนอื่นของใบมีอังกฤษอยู่แล้ว
const ACT = { submit: ["ยื่นคำขอ · Submitted", ""], approve: ["อนุมัติ · Approved", "ok"], reject: ["ส่งกลับแก้ไข · Returned", "no"], cancel: ["ยกเลิก · Cancelled", "no"], ack: ["พนักงานรับทราบ · Acknowledged", ""] };

// f = แถว paf_forms · log = แถว paf_log (เรียงตามเวลา) · opts.logo, opts.draft, opts.printedBy
export function pafHTML(f, log = [], opts = {}) {
  const { cur, rev } = conditionLines(f), steps = Array.isArray(f.steps) && f.steps.length ? f.steps : [];
  const lg = log.filter(l => l.action !== "ack");
  const rows = lg.map((l, i) => {
    const [t, c] = ACT[l.action] || [l.action, ""];
    const st = l.step && steps.find(s => s.step === l.step), en = st?.name_en && st.name_en !== l.actor_name ? st.name_en : "";
    return `<tr><td class="n">${i + 1}</td><td class="w">${esc(thStamp(l.at))}<small>${esc(enStamp(l.at))}</small></td><td class="a"><span class="tag ${c}">${t}</span>${l.action === "approve" || l.action === "reject" ? `<small>ขั้น ${l.step} · Step ${l.step}</small>` : ""}</td>
      <td class="p"><b>${esc(l.actor_name || "-")}</b>${en ? `<small>${esc(en)}</small>` : ""}${l.actor_detail ? `<small>${esc(l.actor_detail)}</small>` : ""}${st?.title_en ? `<small>${esc(st.title_en)}</small>` : ""}</td><td>${esc(l.remark || "")}</td></tr>`;
  });
  // ขั้นที่ยังไม่ถึง — แสดงเป็นแถวจาง ๆ ให้เห็นลำดับทั้งหมด
  if (f.status === "pending") for (const s of steps.filter(s => s.step >= (f.cur_step || 1)))
    rows.push(`<tr class="pend"><td class="n">${rows.length + 1}</td><td class="w">—</td><td class="a"><span class="tag wait">${s.step === f.cur_step ? "รอพิจารณา · Pending" : "ลำดับถัดไป · Next"}</span><small>ขั้น ${s.step} · Step ${s.step}</small></td>
      <td class="p"><b>${esc(s.name_th || "-")}</b>${s.name_en && s.name_en !== s.name_th ? `<small>${esc(s.name_en)}</small>` : ""}<small>${esc([s.emp_code, s.title_th || s.label].filter(Boolean).join(" · "))}</small>${s.title_en ? `<small>${esc(s.title_en)}</small>` : ""}</td><td></td></tr>`);
  const last = [...lg].reverse().find(l => l.action === "approve");
  const cur1 = steps.find(s => s.step === f.cur_step);
  const at = f.approved_at || last?.at;
  const ban = f.status === "approved" ? `<div class="ban ok"><i>✓</i><div><b>อนุมัติครบทุกขั้นแล้ว · Fully approved</b>อนุมัติในระบบเมื่อ ${esc(thStamp(at))} · Approved in system on ${esc(enStamp(at))}</div></div>`
    : f.status === "pending" ? `<div class="ban wait"><i>…</i><div><b>รออนุมัติขั้นที่ ${f.cur_step} · Awaiting step ${f.cur_step} approval${cur1 ? ` — ${esc(cur1.name_en || cur1.name_th)}` : ""}</b>ใบนี้ยังไม่มีผลจนกว่าจะอนุมัติครบทุกขั้น · Not effective until all steps are approved</div></div>`
    : f.status === "rejected" ? `<div class="ban no"><i>!</i><div><b>ส่งกลับแก้ไข · Returned for revision</b>${esc(f.reject_reason || "")}</div></div>`
    : f.status === "cancelled" ? `<div class="ban no"><i>✕</i><div><b>ยกเลิกแล้ว · Cancelled</b>${esc(f.cancel_reason || "")}</div></div>` : "";
  const uniq = a => [...new Set(a.filter(Boolean))].join(" / ") || "-", org = uniq([f.division, f.department]), sec = uniq([f.section, f.team]);
  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>${esc(f.doc_no || "Personnel Action Form")}</title><style>${CSS}</style></head><body>
<section class="pg">${opts.draft ? `<div class="draft">${esc(opts.draft)}</div>` : ""}
  <div class="hd"><img src="${esc(opts.logo || "/assets/logo.png")}" alt="Akara Resources"><div class="sp"></div>
    <div class="r">Chatree Gold Mine<div class="no">เลขที่ / No. <b>${esc(f.doc_no || "—")}</b></div></div></div>
  <div class="ttl"><b>แบบปฏิบัติการด้านทรัพยากรบุคคล</b><span>Personnel Action Form</span></div>
  <table class="blk subj"><tr><td class="k">เรื่อง<small>Subject</small></td><td class="v"><b>${esc(f.subject_th || "")}</b><small>${esc(f.subject_en || "")}</small></td></tr></table>
  <table class="blk"><tr><td class="k">รหัสพนักงาน<small>Employee ID</small></td><td class="v">${esc(f.emp_code)}</td><td class="k">ชื่อ - นามสกุล<small>Name - Surname</small></td><td class="v">${esc(f.name_th || "")}<small>${esc(f.name_en || "")}</small></td></tr>
    <tr><td class="k">ฝ่าย<small>Department</small></td><td class="v">${esc(org)}</td><td class="k">แผนก / ทีมงาน<small>Section / Team</small></td><td class="v">${esc(sec)}</td></tr>
    <tr><td class="k">ตำแหน่ง<small>Position</small></td><td class="v">${esc(f.position || "-")}</td><td class="k">ระดับตำแหน่ง<small>Job Level</small></td><td class="v">${esc(f.job_level || "-")}</td></tr></table>
  <table class="blk cond"><tr><th>สภาพการจ้างเดิม<small>Current Employment Conditions</small></th><th>สภาพการจ้างใหม่ (ที่เปลี่ยนแปลง)<small>Revised Employment Conditions</small></th></tr>
    <tr><td>${cur.map(x => `<p>${esc(x)}</p>`).join("")}</td><td>${rev.map(x => `<p>${esc(x)}</p>`).join("")}
      ${f.note_en || f.note_th ? `<div class="nt">${f.note_en ? `Note: ${esc(f.note_en)}` : ""}${f.note_en && f.note_th ? "\n" : ""}${esc(f.note_th || "")}</div>` : ""}</td></tr></table>
  <table class="blk eff"><tr><td class="k">วันที่มีผล<small>Effective Date</small></td><td class="v">${esc(thLong(f.effective_date))}<small>${esc(enLong(f.effective_date))}</small></td></tr></table>
  <h4>บันทึกการอนุมัติ <span>Approval Record</span></h4>
  <table class="log"><tr><th class="n">ที่<small>No.</small></th><th class="w">เมื่อ<small>Date &amp; Time</small></th><th class="a">กระบวนการพิจารณา<small>Action</small></th><th>ผู้ดำเนินการ<small>Action By</small></th><th>หมายเหตุ<small>Remark</small></th></tr>
    ${rows.join("") || `<tr><td colspan="5" style="text-align:center;color:#888">ยังไม่ได้ส่งอนุมัติ · Not yet submitted</td></tr>`}</table>
  ${ban}
  <table class="ack"><tr><td class="k">พนักงานลงนามรับทราบ<small>Employee Acknowledgement</small></td><td></td><td class="d k">วันที่<small>Date</small></td><td class="dv">${f.ack_date ? esc(thLong(f.ack_date)) : ""}</td></tr></table>
  <div class="ft"><span>${FORM.code}</span><span>${FORM.effective}</span><span>Page 1 of 1</span></div>
</section></body></html>`;
}
