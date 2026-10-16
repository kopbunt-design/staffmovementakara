// เทส Personnel Action Form — ดึงฟังก์ชันจริงจาก js/paf-doc.js · ข้อมูลสมมติล้วน
// รัน:  osascript -l JavaScript test/paf.test.js
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;
const M = new Function(`${read(`${ROOT}/js/paf-doc.js`).replace(/^export /gm, "")}; return { suggestMovType, conditionLines, levelRank, thStamp, thLong, enLong, pafHTML };`)();
let P = 0, F = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) === JSON.stringify(b)) P++; else { F++; console.log("FAIL " + m + "\n  got =" + JSON.stringify(a) + "\n  want=" + JSON.stringify(b)); } };
const has = (s, x, m) => eq(s.includes(x), true, m);

const base = { emp_code: "AKR00000001", name_th: "นายทดสอบ สมมติ", division: "Processing", department: "Processing", section: "Process", position: "Operator", job_level: "O3", salary_from: 20000 };
eq(M.suggestMovType({ ...base, salary_to: 21000 }), "Salary Adjustment", "เปลี่ยนแค่เงินเดือน → Salary Adjustment");
eq(M.suggestMovType({ ...base, salary_to: 20000 }), "none", "เงินเดือนเท่าเดิม = ไม่ได้เปลี่ยน");
eq(M.suggestMovType({ ...base, job_level_to: "S1" }), "Promotion", "O → S = เลื่อน");
eq(M.suggestMovType({ ...base, job_level_to: "O2" }), "Demotion", "O3 → O2 = ลด");
eq(M.suggestMovType({ ...base, department_to: "Mining" }), "Transfer", "เปลี่ยนหน่วยงาน = โอนย้าย");
eq(M.suggestMovType({ ...base, department_to: "Mining", job_level_to: "O4", salary_to: 25000 }), "Promotion", "ระดับขึ้นมาก่อนโอนย้าย");
eq(M.suggestMovType({ ...base, position_to: "Operator" }), "none", "ตำแหน่งเดิมซ้ำ = ไม่เปลี่ยน");
eq([M.levelRank("O3") < M.levelRank("O10"), M.levelRank("S1") > M.levelRank("O9"), M.levelRank("M1") > M.levelRank("S5"), M.levelRank("X1")], [true, true, true, null], "ลำดับระดับ O < S < M");

const c = M.conditionLines({ ...base, salary_to: 23215.5, job_level_to: "O4" });
eq(c.cur, ["Monthly Salary: THB 20,000 (อัตราเงินเดือน 20,000 บาท)", "Job Level: O3 (ระดับตำแหน่ง O3)"], "สภาพการจ้างเดิม เฉพาะที่เปลี่ยน");
eq(c.rev, ["Monthly Salary: THB 23,215.5 (อัตราเงินเดือน 23,215.5 บาท)", "Job Level: O4 (ระดับตำแหน่ง O4)"], "สภาพการจ้างใหม่");
eq(M.thStamp("2026-10-06T02:25:00Z"), "6 ต.ค. 69 09:25", "เวลาในบันทึกการอนุมัติ = เวลาไทย");
eq(M.thStamp("2026-10-06T18:30:00Z"), "7 ต.ค. 69 01:30", "ข้ามเที่ยงคืนตามเวลาไทย");
eq([M.thLong("2026-10-01"), M.enLong("2026-10-01")], ["1 ตุลาคม 2569", "1 October 2026"], "วันที่มีผลสองภาษา");

const f = { ...base, status: "pending", cur_step: 2, doc_no: "PAF-001-2026", salary_to: 22000, subject_th: "พิจารณาอนุมัติปรับเงินเดือน", effective_date: "2026-10-01",
  steps: [{ step: 1, name_th: "ผู้จัดการ ทดสอบ" }, { step: 2, name_th: "GM ทดสอบ", title_th: "General Manager" }] };
const log = [{ action: "submit", at: "2026-10-06T02:25:00Z", actor_name: "HR ทดสอบ" }, { action: "approve", step: 1, at: "2026-10-06T08:55:00Z", actor_name: "ผู้จัดการ ทดสอบ", remark: "<b>ok</b>" }];
const h = M.pafHTML(f, log);
has(h, "เลขที่ / No. <b>PAF-001-2026</b>", "เลขที่บนหัวใบ");
has(h, "AKR-OHR-FM-031 Rev. 00", "รหัสแบบฟอร์ม");
has(h, "รอพิจารณา</span> ขั้น 2", "ขั้นที่รออยู่แสดงในบันทึก");
has(h, "รออนุมัติขั้นที่ 2 — GM ทดสอบ", "แถบสถานะรออนุมัติ");
has(h, "&lt;b&gt;ok&lt;/b&gt;", "หมายเหตุถูก escape");
has(h, "Processing</td>", "ฝ่ายซ้ำกับ department ไม่แสดงซ้ำ");
has(M.pafHTML({ ...f, status: "approved", cur_step: null, approved_at: "2026-10-07T03:00:00Z" }, log), "อนุมัติครบทุกขั้นแล้ว", "แถบอนุมัติครบ");

console.log(F === 0 ? `ผ่านทั้งหมด ${P} เคส` : `ผ่าน ${P} · ตก ${F}`);
