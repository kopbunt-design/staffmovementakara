// ============================================================================
// ทะเบียนผู้รับเหมา (SUB) — ตรรกะล้วน · ใช้โดยเว็บ /sub (sub/sb.js) · เทส test/sub.test.js
//   ห้าม import app.js
// ไฟล์ต้นทาง: "ข้อมูลบัตรผู้รับเหมา - <บริษัท>.xlsx" โฟลเดอร์ละบริษัท — ใช้ไฟล์ที่แก้ล่าสุดของแต่ละโฟลเดอร์ (ผู้ใช้ 2026-10-15)
//   หัวตาราง: No. · SUB No. · AC NO. (เลขระบบประตู) · Card Back Number (เลขหลังบัตร) · Title · Name · Surname · Company · หมู่ · ตำบล · อำเภอ · จังหวัด · หมายเหตุ
//   สถานะ/สัญชาติ/พื้นที่ เขียนปนอยู่ในหมายเหตุ (ก.ย. 2569: ออก/ลาออก/ออกแล้ว · ชาวต่างชาติ · HQ / KM.20 · ซ้ำ)
// ============================================================================

const clean = v => String(v ?? "").replace(/\s+/g, " ").trim();
const key = v => clean(v).toLowerCase();

export function normTitle(t) {
  const k = key(t).replace(/\.+$/, "");
  return { mr: "Mr.", mrs: "Mrs.", mrss: "Mrs.", miss: "Miss", ms: "Ms.", "นาย": "นาย", "นาง": "นาง", "นางสาว": "นางสาว", "น.ส": "นางสาว" }[k] ?? clean(t);
}

// หมายเหตุ (+ ช่องเลขหลังบัตรที่บางไฟล์เขียนข้อความลงไป) → ธง
const LEFT_RE = /ออก|ลาออก|พ้นสภาพ|former|resign|returned/i;
export function noteFlags(note, cardBack = "") {
  const n = clean(note), c = clean(cardBack), all = `${n} ${/\d{6,}/.test(c) ? "" : c}`;
  const area = /\bKM\.?\s*\d+/i.test(n) ? n.match(/KM\.?\s*\d+/i)[0].replace(/\s+/g, "").toUpperCase().replace(/^KM\.?/, "KM.") : /\bHQ\b/i.test(n) ? "HQ" : null;
  return { left: LEFT_RE.test(all) && !/active employee/i.test(all), foreign: /ต่างชาติ|foreign/i.test(n), area, dup: /ซ้ำ|duplicate/i.test(n),
           cardText: /\d{6,}/.test(c) ? null : c || null };
}

const H = { no: /^no\.?$/i, sub: /^sub\s*no/i, ac: /^ac\s*no/i, card: /card\s*back/i, title: /^title$/i, first: /^name$/i, last: /^surname$/i, company: /^company$/i,
  village: /^หมู่/, subdistrict: /^ตำบล/, district: /^อำเภอ/, province: /^จังหวัด/, note: /^หมายเหตุ/ };
// rows = sheet_to_json(header:1) · folder = ชื่อโฟลเดอร์บริษัท · companies = ชื่อบริษัทที่รู้จัก (ชื่อโฟลเดอร์ทั้งหมด)
export function parseSheet(rows, folder, companies = []) {
  const hi = rows.findIndex(r => (r || []).some(c => H.sub.test(clean(c))) && (r || []).some(c => H.first.test(clean(c))));
  if (hi < 0) return { rows: [], error: "ไม่พบหัวตาราง (SUB No. / Name)" };
  const col = {}; rows[hi].forEach((c, i) => { for (const [k, re] of Object.entries(H)) if (col[k] == null && re.test(clean(c))) col[k] = i; });
  const g = (r, k) => col[k] == null ? "" : clean(r[col[k]]);
  const known = companies.map(c => [key(c), c]);
  const out = []; let section = null;
  for (const r of rows.slice(hi + 1)) {
    if (!r) continue;
    // แถวคั่นกลุ่ม (มีแต่ช่อง Company เช่น "Epiroc LHM Team") = ทีมของแถวถัด ๆ ไป
    if (!g(r, "first") && !g(r, "sub")) { if (g(r, "company")) section = g(r, "company").replace(new RegExp(`^${folder}\\s*`, "i"), "").trim(); continue; }
    const f = noteFlags(g(r, "note"), g(r, "card")), comp = g(r, "company");
    // ช่อง Company: ชื่อบริษัทอื่นที่รู้จัก = ย้ายไปบริษัทนั้น · มีคำว่า team = ทีมย่อย · ชื่อยาวที่มีชื่อโฟลเดอร์ = ชื่อเต็มบริษัท
    const other = known.find(([k]) => k === key(comp) && k !== key(folder));
    const team = /team/i.test(comp) ? comp.replace(new RegExp(`^${folder}\\s*`, "i"), "").trim() : section;
    const legal = !other && !team && comp && key(comp) !== key(folder) && key(comp).includes(key(folder).split(" ")[0]) ? comp : null;
    out.push({ company: other ? other[1] : folder, legal_name: legal, sub_no: g(r, "sub").toUpperCase() || null, ac_no: g(r, "ac") || null,
      card_no: /\d{6,}/.test(g(r, "card")) ? g(r, "card") : null, title: normTitle(g(r, "title")) || null, first_name: g(r, "first"), last_name: g(r, "last") || null,
      team, area: f.area, village: g(r, "village") || null, subdistrict: g(r, "subdistrict") || null, district: g(r, "district") || null, province: g(r, "province") || null,
      nationality: f.foreign ? "Foreign" : "Thai", status: f.left ? "left" : "active", remark: g(r, "note") || f.cardText || null, flags: f, movedFrom: other ? folder : null });
  }
  return { rows: out };
}

// เลือกไฟล์ล่าสุดของแต่ละโฟลเดอร์ — files = [{ path: "SUB/Chanon/x.xlsx", lastModified }] (webkitRelativePath)
export function pickLatest(files) {
  const by = new Map();
  for (const f of files) {
    const parts = f.path.split("/"), name = parts[parts.length - 1];
    if (!/\.xlsx?$/i.test(name) || name.startsWith("~$") || parts.length < 2) continue;
    const folder = parts.length >= 3 ? parts[parts.length - 2] : parts[0];
    const cur = by.get(folder); if (!cur || f.lastModified > cur.lastModified) by.set(folder, f);
  }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([folder, file]) => ({ folder, file }));
}

// เทียบกับทะเบียน: จับคู่ด้วย SUB No. ก่อน ไม่มีค่อยใช้ ชื่อ+สกุล+บริษัท
export const COMPARE = ["sub_no", "ac_no", "card_no", "title", "first_name", "last_name", "team", "area", "village", "subdistrict", "district", "province", "nationality"];
export function diffImport(existing, incoming, companyIdOf) {
  const bySub = new Map(existing.filter(w => w.sub_no).map(w => [w.sub_no.toUpperCase(), w]));
  const byName = new Map(existing.map(w => [`${w.company_id}|${key(w.first_name)}|${key(w.last_name)}`, w]));
  const add = [], update = [], same = [], seen = new Set(), dupInFile = [];
  const subsInFile = new Map();
  for (const r of incoming) {
    if (r.sub_no) { if (subsInFile.has(r.sub_no)) { dupInFile.push(r); continue; } subsInFile.set(r.sub_no, r); }
    const cid = companyIdOf(r.company);
    const m = (r.sub_no && bySub.get(r.sub_no)) || byName.get(`${cid}|${key(r.first_name)}|${key(r.last_name)}`);
    if (!m) { add.push({ ...r, company_id: cid }); continue; }
    seen.add(m.id);
    const ch = {};
    for (const k of COMPARE) if (r[k] != null && r[k] !== "" && clean(r[k]) !== clean(m[k])) ch[k] = r[k];
    if (cid && cid !== m.company_id) ch.company_id = cid;
    if (r.status === "left" && m.status === "active") ch.status = "left";
    (Object.keys(ch).length ? update : same).push({ id: m.id, row: r, changes: ch, before: m });
  }
  const files = new Set(incoming.map(r => companyIdOf(r.company)));
  const missing = existing.filter(w => w.status === "active" && files.has(w.company_id) && !seen.has(w.id));
  return { add, update, same, missing, dupInFile };
}

// ---------------------------------------------------------------- รายงานรายเดือน
// อยู่ ณ สิ้นเดือน = เริ่มไม่เกินสิ้นเดือน (ว่าง = มีชื่อก่อนนำเข้า) และยังไม่ออก หรือออกหลังสิ้นเดือน
// left_on = วันทำงานวันสุดท้าย → นับออกในเดือนของ left_on · ต้นเดือน + เข้าใหม่ − ออก = สิ้นเดือน
export const lastDay = ym => { const [y, m] = ym.split("-").map(Number); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`; };
export const prevYM = ym => { const [y, m] = ym.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };
export const activeAt = (w, day) => (!w.start_date || w.start_date <= day) && (!w.left_on || w.left_on > day);
export function monthly(workers, companies, ym) {
  const end = lastDay(ym), pend = lastDay(prevYM(ym));
  const rows = companies.map(c => {
    const ws = workers.filter(w => w.company_id === c.id);
    const r = { company_id: c.id, name: c.name, opening: ws.filter(w => activeAt(w, pend)).length,
      joined: ws.filter(w => w.start_date && w.start_date.startsWith(ym)).length, left: ws.filter(w => w.left_on && w.left_on.startsWith(ym)).length };
    const end_ = ws.filter(w => activeAt(w, end));
    return { ...r, ending: end_.length, thai: end_.filter(w => w.nationality === "Thai").length, foreign: end_.filter(w => w.nationality !== "Thai").length };
  }).filter(r => r.opening || r.joined || r.left || r.ending);
  const sum = k => rows.reduce((s, r) => s + r[k], 0);
  return { rows, total: { opening: sum("opening"), joined: sum("joined"), left: sum("left"), ending: sum("ending"), thai: sum("thai"), foreign: sum("foreign") } };
}

// เอกสารที่หมดหรือใกล้หมด (ภายใน days วัน) ของคนที่ยังทำงานอยู่
export const EXPIRY_DAYS = 30;
const DOCS = [["card_expiry", "บัตรเข้าพื้นที่"], ["induction_expiry", "อบรม Induction"], ["medical_expiry", "ใบรับรองแพทย์"], ["work_permit_expiry", "Work Permit"], ["visa_expiry", "Visa"]];
export function expiring(w, today, days = EXPIRY_DAYS) {
  if (w.status !== "active") return [];
  const t0 = Date.parse(today + "T00:00:00Z"), out = [];
  const chk = (label, d) => { if (!d) return; const left = Math.round((Date.parse(d + "T00:00:00Z") - t0) / 864e5); if (left <= days) out.push({ label, date: d, left }); };
  for (const [k, l] of DOCS) chk(l, w[k]);
  for (const x of w.licenses || []) chk(x.name || "ใบอนุญาต", x.expiry);
  return out.sort((a, b) => a.left - b.left);
}
