// เทสว่าทุกเมนูในแถบข้างมีสิทธิ์รองรับจริง
// รัน:  osascript -l JavaScript test/nav-permissions.test.js
//
// ทำไมต้องมีเทสนี้: applyNavPermissions() ซ่อนเมนูที่ can("page.<หน้า>") เป็น false
// เมนูใหม่ที่ไม่มี permission key ใน DB จึง "หายไปเฉย ๆ" โดยไม่มี error ให้เห็นเลย
// (เกิดจริงกับเมนู "เทียบค่ากะรายคน" 2026-09-21 — router ปล่อยผ่านแต่เมนูถูกซ่อน)
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;
const ROOT = $.NSFileManager.defaultManager.currentDirectoryPath.js;

const html = read(`${ROOT}/index.html`);
const app  = read(`${ROOT}/js/app.js`);

// เมนูทั้งหมดในแถบข้าง
const navPages = [...new Set(
  (html.match(/data-page="([a-z]+)"/g) || []).map(m => m.match(/"([a-z]+)"/)[1])
)];

// ตารางสิทธิ์ทดแทน (หน้าที่ยืมสิทธิ์ของหน้าอื่น)
const aliasSrc = (app.match(/const PERM_ALIAS = \{([^}]*)\}/) || [])[1] || "";
const ALIAS = {};
for (const m of aliasSrc.matchAll(/(\w+)\s*:\s*"([^"]+)"/g)) ALIAS[m[1]] = m[2];

// permission key ที่ seed ไว้ในไฟล์ SQL ทั้งหมด
const fm = $.NSFileManager.defaultManager;
const sqlFiles = ObjC.deepUnwrap(fm.contentsOfDirectoryAtPathError(`${ROOT}/sql`, null))
  .filter(f => f.endsWith(".sql"));
const seeded = new Set();
for (const f of sqlFiles)
  for (const m of read(`${ROOT}/sql/${f}`).matchAll(/'(page\.[a-z]+)'/g)) seeded.add(m[1]);

// หน้าที่ router รู้จัก
const pagesSrc = (app.match(/const pages = \[([^\]]*)\]/) || [])[1] || "";
const routerPages = [...pagesSrc.matchAll(/"([a-z]+)"/g)].map(m => m[1]);

let P = 0, F = 0;
const t = (name, ok, detail) => { if (ok) P++; else { F++; console.log("FAIL · " + name + (detail ? "  " + detail : "")); } };

t("อ่านเมนูจาก index.html ได้", navPages.length > 5, `เจอ ${navPages.length} เมนู`);
t("อ่าน PERM_ALIAS จาก app.js ได้", Object.keys(ALIAS).length > 0);
t("อ่าน permission key จาก sql/ ได้", seeded.size > 10, `เจอ ${seeded.size} key`);

// ข้อหลัก: ทุกเมนูต้องมีสิทธิ์ที่มีอยู่จริง ไม่งั้นเมนูจะถูกซ่อนจากทุกคน
for (const page of navPages) {
  const key = ALIAS[page] || `page.${page}`;
  t(`เมนู "${page}" มีสิทธิ์รองรับ (${key})`, seeded.has(key),
    ALIAS[page] ? `alias ชี้ไป ${key} ซึ่งไม่มีใน sql/` : `ต้อง seed '${key}' ใน sql/ หรือใส่ alias ใน PERM_ALIAS`);
}

// ทุกเมนูต้องมีหน้าใน router ด้วย ไม่งั้นกดแล้วไม่มีอะไรเกิดขึ้น
for (const page of navPages)
  t(`เมนู "${page}" มีอยู่ใน router`, routerPages.includes(page));

// ทุกหน้าใน router ต้องมี <div id="pageXxx"> รองรับ
for (const page of routerPages) {
  const id = "page" + page[0].toUpperCase() + page.slice(1);
  t(`หน้า "${page}" มี <div id="${id}">`, html.includes(`id="${id}"`));
}

// alias ต้องชี้ไปหาสิทธิ์ที่มีจริง และต้องไม่ชี้ทับ key ของตัวเอง
for (const [page, key] of Object.entries(ALIAS)) {
  t(`alias ${page} ชี้ไปสิทธิ์ที่มีจริง`, seeded.has(key), key);
  t(`alias ${page} ไม่ซ้ำกับ key ของตัวเอง`, key !== `page.${page}`);
}

console.log(F === 0 ? `ผ่านทั้งหมด ${P} เคส` : `ผ่าน ${P} · ตก ${F}`);
