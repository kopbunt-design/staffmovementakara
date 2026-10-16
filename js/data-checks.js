// ============================================================================
// ตรวจข้อมูลแบบ "เอ๊ะใจ" ก่อนส่งรายงาน (user 2026-10-16: "ข้อมูลไปถึงหัวหน้าแล้วผิด — บันทึกโอนย้ายไม่แก้ทะเบียน / ลาออกขึ้นออกเลย")
//   ตรรกะล้วน (ไม่แตะ DOM / ไม่ import app.js) · เทส test/data-checks.test.js
//   ใช้ที่ Headcount Report · Movement Report · Staff Movement — ช่วยจับข้อมูลที่ขัดกันก่อนตัวเลขถึงมือหัวหน้า
//   กฎวันที่ใช้ของกลางจาก app.js เสมอ (ส่งเข้ามาทาง h = { sepYM, movYM, lastDayOfMonth, hcAtMonthEnd, orgAt }) — ห้ามนิยามซ้ำ
//   ระดับ: error = ตัวเลขรายงานผิดแน่ · warn = ข้อมูลไม่ครบ/ขัดกัน ควรแก้ · info = ข้อสังเกต (ตัวเลขอาจถูก แต่ควรรู้ก่อนส่ง)
// ============================================================================
const LEFT = ["Resigned", "Terminated", "Retired"];
const SEP = ["Resignation", "Termination", "Retirement"];
const ORG_TYPES = ["Transfer", "Promotion", "Demotion", "Secondment"];
const isActive = e => !e.status || e.status === "Active";
const nm = e => [e?.firstname_th, e?.lastname_th].filter(Boolean).join(" ") || [e?.firstname_en, e?.lastname_en].filter(Boolean).join(" ") || "";
const d10 = v => String(v || "").slice(0, 10);
const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

// data = { employees, movements, masters: { departments, sections, teams }, today, ym }
// h = { sepYM, movYM, lastDayOfMonth, hcAtMonthEnd, orgAt? }
export function runChecks(data, h) {
  const { employees = [], movements = [], masters = {}, today, ym } = data;
  const byCode = new Map(employees.filter(e => e.emp_code).map(e => [e.emp_code, e]));
  const movOf = new Map();
  for (const m of movements) if (m.emp_code) (movOf.get(m.emp_code) || movOf.set(m.emp_code, []).get(m.emp_code)).push(m);
  const latest = (code, types) => (movOf.get(code) || []).filter(m => types.includes(m.type))
    .sort((a, b) => d10(b.date).localeCompare(d10(a.date)) || String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
  const hasConfirm = movements.some(m => "sep_confirmed_at" in m);
  const out = [];
  const add = (key, level, title, why, items) => { if (items.length) out.push({ key, level, title, why, items }); };
  const it = (e, detail, m) => ({ emp_code: e?.emp_code || m?.emp_code || "", name: nm(e) || m?.name || "", detail, mov_id: m?.id ?? null });

  // ---------- พ้นสภาพ ----------
  const pending = hasConfirm ? movements.filter(m => SEP.includes(m.type) && !m.sep_confirmed_at) : [];
  add("sep_due", "error", "ถึงวันพ้นสภาพแล้ว แต่ยังไม่กดยืนยัน",
    "ทะเบียนยังขึ้น Active — รายชื่อพนักงาน / Export Excel ยังมีคนนี้ (ตัวเลขรายงานกำลังคนนับออกให้แล้ว)",
    pending.filter(m => m.date && d10(m.date) <= today).map(m => it(byCode.get(m.emp_code), `${m.type} มีผล ${d10(m.date)} · ยืนยันที่หน้า Staff Movement`, m)));
  add("left_no_end", "error", "สถานะพ้นสภาพ แต่ไม่มีวันพ้นสภาพ",
    "รายงานไม่รู้ว่าออกเดือนไหน → ยังนับอยู่ในกำลังคนทุกเดือน",
    employees.filter(e => LEFT.includes(e.status) && !e.end_date).map(e => it(e, `สถานะ ${e.status}`)));
  add("left_future", "warn", "ขึ้นพ้นสภาพก่อนถึงวันที่มีผล",
    "รายชื่อ / Export ไม่มีคนนี้แล้ว ทั้งที่ยังทำงานอยู่",
    employees.filter(e => LEFT.includes(e.status) && e.end_date && d10(e.end_date) > today).map(e => it(e, `สถานะ ${e.status} · วันพ้นสภาพ ${d10(e.end_date)}`)));
  const pendingCodes = new Set(pending.map(m => m.emp_code));
  add("active_past_end", "error", "ยัง Active แต่วันพ้นสภาพผ่านไปแล้ว",
    "รายงานกำลังคนนับออกแล้ว แต่ทะเบียน / Export ยังมี → ตัวเลขสองที่ไม่ตรงกัน",
    employees.filter(e => isActive(e) && e.end_date && d10(e.end_date) <= today && !pendingCodes.has(e.emp_code)).map(e => it(e, `วันพ้นสภาพ ${d10(e.end_date)} · ไม่มีรายการรอยืนยัน`)));
  const sepRows = [], sepNoEnd = [];
  for (const [code, list] of movOf) {
    const m = latest(code, SEP), e = byCode.get(code); if (!m || !e) continue;
    if (!e.end_date) sepNoEnd.push(it(e, `${m.type} มีผล ${d10(m.date)} แต่ทะเบียนไม่มีวันพ้นสภาพ`, m));
    else if (m.date && d10(m.date) !== d10(e.end_date) && h.sepYM(m.date) !== h.sepYM(e.end_date))
      sepRows.push(it(e, `รายการ ${m.type} ${d10(m.date)} (นับออกเดือน ${h.sepYM(m.date)}) · ทะเบียน ${d10(e.end_date)} (หลุดกำลังคนเดือน ${h.sepYM(e.end_date)})`, m));
  }
  add("sep_mismatch", "error", "วันลาออกในรายการ Movement กับในทะเบียนอยู่คนละเดือน",
    "ยอดลาออกนับตามรายการ แต่กำลังคนนับตามทะเบียน → ยกมา + เข้า − ออก ≠ ยกไป", sepRows);
  add("sep_no_end", "error", "มีรายการพ้นสภาพ แต่ทะเบียนไม่มีวันพ้นสภาพ", "นับเป็นคนออกแล้ว แต่ยังอยู่ในกำลังคน → ยอดไม่ balance", sepNoEnd);

  // ---------- โอนย้าย / เลื่อนตำแหน่ง ----------
  const notApplied = [];
  for (const [code] of movOf) {
    const m = latest(code, ORG_TYPES), e = byCode.get(code); if (!m || !e || !isActive(e)) continue;
    const to = m.org_to && typeof m.org_to === "object" ? m.org_to : null;
    let bad = [];
    if (to) bad = ["division", "department", "section", "team", "position"].filter(k => to[k] && !same(to[k], e[k])).map(k => `${k}: รายการ “${to[k]}” · ทะเบียน “${e[k] || "-"}”`);
    else {
      const [dep, pos] = String(m.to_dept || "").split(" / ").map(x => x.trim());
      if (dep && !same(dep, e.department)) bad.push(`แผนก: รายการ “${dep}” · ทะเบียน “${e.department || "-"}”`);
      if (pos && !same(pos, e.position)) bad.push(`ตำแหน่ง: รายการ “${pos}” · ทะเบียน “${e.position || "-"}”`);
    }
    if (m.job_level && !same(m.job_level, e.job_level)) bad.push(`ระดับ: รายการ ${m.job_level} · ทะเบียน ${e.job_level || "-"}`);
    if (bad.length) notApplied.push(it(e, `${m.type} มีผล ${d10(m.date)} — ${bad.join(" · ")}`, m));
  }
  add("move_not_applied", "error", "บันทึกโอนย้าย/เลื่อนตำแหน่งแล้ว แต่ทะเบียนพนักงานไม่ตรงกับรายการ",
    "รายงานแยกหน่วยงาน / Export / Workforce ใช้ค่าในทะเบียน → คนนี้ไปโผล่ผิดหน่วยงาน", notApplied);

  // ---------- เข้าใหม่ ----------
  const nh = [];
  for (const [code] of movOf) {
    const m = latest(code, ["New Hire"]), e = byCode.get(code); if (!m || !e || !m.date) continue;
    if (!e.join_date) nh.push(it(e, `New Hire มีผล ${d10(m.date)} แต่ทะเบียนไม่มีวันเริ่มงาน`, m));
    else if (d10(m.date).slice(0, 7) !== d10(e.join_date).slice(0, 7)) nh.push(it(e, `รายการ New Hire ${d10(m.date)} · ทะเบียนเริ่มงาน ${d10(e.join_date)}`, m));
  }
  add("hire_mismatch", "warn", "วันเริ่มงานในรายการ New Hire กับทะเบียนอยู่คนละเดือน", "ยอดเข้าใหม่นับตามรายการ แต่กำลังคนนับตามทะเบียน", nh);
  add("no_join", "warn", "พนักงาน Active ไม่มีวันเริ่มงาน", "นับอยู่ในกำลังคนทุกเดือนย้อนหลัง ไม่เคยนับเป็นเข้าใหม่",
    employees.filter(e => isActive(e) && !e.join_date).map(e => it(e, "ไม่มี join_date")));

  // ---------- โครงสร้างหน่วยงาน ----------
  const miss = employees.filter(e => isActive(e) && ["division", "department", "position", "job_level"].some(k => !String(e[k] || "").trim() || e[k] === "-"))
    .map(e => it(e, `ขาด ${["division", "department", "position", "job_level"].filter(k => !String(e[k] || "").trim() || e[k] === "-").join(", ")}`));
  add("missing_org", "warn", "ข้อมูลหน่วยงาน/ตำแหน่ง/ระดับไม่ครบ", "รายงานแยกหน่วยงานจะไปกองที่ “(ไม่ระบุ)”", miss);
  const dep = new Map((masters.departments || []).map(d => [d.name, d.master_divisions?.name || d.division || ""]));
  const sec = new Map((masters.sections || []).map(s => [s.name, s.master_departments?.name || ""]));
  const team = new Map((masters.teams || []).map(t => [t.name, t.master_sections?.name || ""]));
  const tree = [];
  for (const e of employees.filter(isActive)) {
    const p = [];
    if (e.department && dep.get(e.department) && e.division && !same(dep.get(e.department), e.division)) p.push(`Department “${e.department}” อยู่ใต้ ${dep.get(e.department)} ไม่ใช่ ${e.division}`);
    if (e.section && sec.get(e.section) && e.department && !same(sec.get(e.section), e.department)) p.push(`Section “${e.section}” อยู่ใต้ ${sec.get(e.section)} ไม่ใช่ ${e.department}`);
    if (e.team && team.get(e.team) && e.section && !same(team.get(e.team), e.section)) p.push(`Team “${e.team}” อยู่ใต้ ${team.get(e.team)} ไม่ใช่ ${e.section}`);
    if (p.length) tree.push(it(e, p.join(" · ")));
  }
  add("org_tree", "warn", "หน่วยงานไม่ตรงโครงสร้าง (Department ไม่อยู่ใต้ Division ที่ระบุ ฯลฯ)",
    "มักเกิดจากโอนย้ายแล้วแก้แค่บางช่อง → รายงานแยก Division กับแยก Department ยอดไม่ตรงกัน", tree);
  add("mov_no_emp", "warn", "รายการ Movement ที่ไม่พบรหัสในทะเบียนพนักงาน", "รายงานจับคู่ไม่ได้ → ไม่รู้ระดับ/หน่วยงาน",
    movements.filter(m => !m.emp_code || !byCode.has(m.emp_code)).map(m => it(null, `${m.type} ${d10(m.date)} · รหัส “${m.emp_code || "ว่าง"}”`, m)));
  const names = new Map();
  for (const e of employees.filter(isActive)) { const n = nm(e).replace(/\s+/g, " ").trim(); if (n) (names.get(n) || names.set(n, []).get(n)).push(e); }
  add("dup_name", "info", "ชื่อซ้ำกันหลายรหัส (Active)", "อาจคีย์คนเดียวซ้ำ → นับเกิน 1 คน",
    [...names.values()].filter(l => l.length > 1).flatMap(l => l.map(e => it(e, `ชื่อเดียวกับ ${l.filter(x => x !== e).map(x => x.emp_code).join(", ")}`))));

  // ---------- เฉพาะเดือนที่ดู ----------
  if (ym) {
    const end = h.lastDayOfMonth(ym);
    const late = movements.filter(m => {
      const inMonth = SEP.includes(m.type) ? h.sepYM(m.date) === ym : h.movYM(m) === ym;
      return inMonth && m.created_at && d10(m.created_at) > end;
    }).map(m => it(byCode.get(m.emp_code), `${m.type} มีผล ${d10(m.date)} · บันทึกเมื่อ ${d10(m.created_at)} (หลังปิดเดือน)`, m));
    add("late_entry", "info", `รายการของเดือนนี้ที่บันทึกหลังสิ้นเดือน`, "ถ้าส่งรายงานเดือนนี้ไปแล้ว ตัวเลขตอนนี้จะต่างจากฉบับที่ส่ง", late);
    if (h.hcAtMonthEnd && h.orgAt) {
      const [y, mo] = ym.split("-").map(Number), prev = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
      const cnt = k => { const c = {}; for (const e of h.hcAtMonthEnd(employees, k)) { const d = h.orgAt(e, h.lastDayOfMonth(k)).department || "(ไม่ระบุ)"; c[d] = (c[d] || 0) + 1; } return c; };
      const a = cnt(prev), b = cnt(ym);
      const swing = [...new Set([...Object.keys(a), ...Object.keys(b)])].map(d => ({ d, x: a[d] || 0, y: b[d] || 0 }))
        .filter(r => Math.abs(r.y - r.x) >= 3 && Math.abs(r.y - r.x) / Math.max(r.x, 1) >= 0.2)
        .map(r => ({ emp_code: "", name: r.d, detail: `${r.x} → ${r.y} คน (${r.y - r.x > 0 ? "+" : ""}${r.y - r.x}) เทียบเดือนก่อน`, mov_id: null }));
      add("swing", "info", "หน่วยงานที่จำนวนคนเปลี่ยนแรงผิดปกติ (≥ 20% และ ≥ 3 คน)", "ถ้าไม่มีเหตุการณ์จริง (ย้ายยกทีม / รับเข้าล็อตใหญ่) อาจเป็นข้อมูลผิด", swing);
    }
  }
  const order = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

const escH = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LV = { error: ["ต้องแก้", "#B42318", "#FEF3F2", "#FECDCA"], warn: ["ควรเช็ก", "#B54708", "#FFFAEB", "#FEDF89"], info: ["ข้อสังเกต", "#175CD3", "#EFF8FF", "#B2DDFF"] };
// แผงผลตรวจ — ปุ่ม data-chk-emp / data-chk-mov ให้หน้าที่เรียกต่อสายไปเปิดทะเบียน / รายการ
export function checksPanelHTML(res, opts = {}) {
  const n = l => res.filter(r => r.level === l).reduce((s, r) => s + r.items.length, 0);
  const e = n("error"), w = n("warn"), i = n("info");
  if (!res.length) return `<div class="dck ok"><b>✓ ตรวจข้อมูลแล้ว ไม่พบจุดที่ขัดกัน</b><span>${escH(opts.scope || "")}</span></div>`;
  const tone = e ? "error" : w ? "warn" : "info", [, c, bg, bd] = LV[tone];
  return `<details class="dck" style="--c:${c};--bg:${bg};--bd:${bd}" ${opts.open ?? e ? "open" : ""}>
    <summary><b>เอ๊ะ! ตรวจข้อมูลก่อนส่งรายงาน</b> <span>${[e && `ต้องแก้ ${e}`, w && `ควรเช็ก ${w}`, i && `ข้อสังเกต ${i}`].filter(Boolean).join(" · ")}${opts.scope ? ` · ${escH(opts.scope)}` : ""}</span></summary>
    ${res.map(r => { const [t, cc, bb, bdd] = LV[r.level];
      return `<details class="dck-g" style="--c:${cc};--bg:${bb};--bd:${bdd}"><summary><i>${t}</i><b>${escH(r.title)}</b><em>${r.items.length}</em></summary>
        <div class="dck-why">${escH(r.why)}</div>
        <table>${r.items.slice(0, 200).map(x => `<tr><td>${x.emp_code ? `<b>${escH(x.emp_code)}</b> ` : ""}${escH(x.name)}</td><td>${escH(x.detail)}</td>
          <td>${x.emp_code && !opts.noEmp ? `<button data-chk-emp="${escH(x.emp_code)}">ทะเบียน</button>` : ""}${x.mov_id != null ? `<button data-chk-mov="${escH(x.mov_id)}">รายการ</button>` : ""}</td></tr>`).join("")}</table>
        ${r.items.length > 200 ? `<div class="dck-why">แสดง 200 จาก ${r.items.length}</div>` : ""}</details>`; }).join("")}
  </details>`;
}
