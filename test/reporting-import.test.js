// เทสตัวตรวจไฟล์นำเข้าสายบังคับบัญชา — ดึง validate() จริงจาก js/reporting-import.js
// รัน:  osascript -l JavaScript test/reporting-import.test.js
ObjC.import('Foundation');
const read = p => $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null).js;

const src = read('js/reporting-import.js');
const body = src.slice(src.indexOf('const norm ='), src.indexOf('// ---------- เขียนลง DB'))
  .replace(/^export /gm, '');   // ตัด export ออก ไม่งั้น new Function มองเป็น syntax error

const EMP = [
  {emp_code:"A1", firstname_th:"สมชาย", lastname_th:"ภูวเดช",   job_level:"M2", division:"Operations", department:"Processing", status:"Active",   manager_code:null},
  {emp_code:"B1", firstname_th:"เชาว์ลิต",lastname_th:"ทองคำ",   job_level:"S3", division:"Operations", department:"Processing", status:"Active",   manager_code:null},
  {emp_code:"C1", firstname_th:"จิรายุ", lastname_th:"ตันหยงทอง",job_level:"S2", division:"Operations", department:"Processing", status:"Active",   manager_code:"B1"},
  {emp_code:"D1", firstname_th:"วิภาดา", lastname_th:"ศรีทอง",   job_level:"M1", division:"Commercial", department:"Finance",    status:"Active",   manager_code:null},
  {emp_code:"E1", firstname_th:"อดีต",   lastname_th:"พนักงาน",  job_level:"M2", division:"Operations", department:"Processing", status:"Resigned", manager_code:null},
  {emp_code:"F1", firstname_th:"สมชาย", lastname_th:"ภูวเดช",   job_level:"S1", division:"Exploration",department:"Geology",    status:"Active",   manager_code:null},
];
const api = new Function("allEmployees","esc","toast",
  `${body}; return { validate, resolveManager };`)(EMP, s=>s, ()=>{});

let P=0, F=0;
const t=(n,got,want)=>{ if(JSON.stringify(got)===JSON.stringify(want)) P++;
  else { F++; console.log(`FAIL · ${n}\n   got =${JSON.stringify(got)}\n   want=${JSON.stringify(want)}`); } };
const K = "หัวหน้าโดยตรง (กรอกช่องนี้)";
const run = rows => api.validate(rows);
const lvlOf = (res,code) => res.rows.find(r=>r.code===code)?.level ?? null;
const msgOf = (res,code) => (res.rows.find(r=>r.code===code)?.msgs||[]).map(m=>m.msg).join(" | ");

// --- รับได้ทั้งรหัสและชื่อ ---
t("รับรหัสตรง ๆ", run([{ "รหัสพนักงาน":"B1", [K]:"A1" }]).ok, 1);
t("รับชื่อไทย", run([{ "รหัสพนักงาน":"C1", [K]:"เชาว์ลิต ทองคำ" }]).ok, 1);
t("รับรูปแบบ 'รหัส — ชื่อ' ที่ฟอร์มใส่มา", run([{ "รหัสพนักงาน":"C1", [K]:"A1 — สมชาย ภูวเดช" }]).ok, 1);
t("เว้นว่าง = ข้าม ไม่ใช่ error", run([{ "รหัสพนักงาน":"B1", [K]:"" }]).blocked, 0);

// --- บล็อก ---
t("รหัสพนักงานไม่มีในระบบ", lvlOf(run([{ "รหัสพนักงาน":"ZZ", [K]:"A1" }]),"ZZ"), "block");
t("หัวหน้าไม่มีในระบบ", lvlOf(run([{ "รหัสพนักงาน":"B1", [K]:"XX99999999" }]),"B1"), "block");
t("ชื่อหัวหน้าไม่มีในระบบ", lvlOf(run([{ "รหัสพนักงาน":"B1", [K]:"ไม่มี คนนี้" }]),"B1"), "block");
t("เป็นหัวหน้าตัวเอง", lvlOf(run([{ "รหัสพนักงาน":"B1", [K]:"B1" }]),"B1"), "block");
t("หัวหน้าลาออกแล้ว", lvlOf(run([{ "รหัสพนักงาน":"B1", [K]:"E1" }]),"B1"), "block");

// ชื่อซ้ำต้องบอกให้ใส่รหัส (A1 กับ F1 ชื่อ 'สมชาย ภูวเดช' เหมือนกัน)
const dup = run([{ "รหัสพนักงาน":"B1", [K]:"สมชาย ภูวเดช" }]);
t("ชื่อซ้ำ = block", lvlOf(dup,"B1"), "block");
t("ชื่อซ้ำ บอกรหัสให้เลือก", /A1.*F1|F1.*A1/.test(msgOf(dup,"B1")), true);

// --- วงกลม (จุดสำคัญ: ต้องมองรวมกับข้อมูลเดิมใน DB) ---
// C1→B1 อยู่แล้วใน DB · ไฟล์สั่ง B1→C1 = วน
t("วงกลมร่วมกับข้อมูลเดิมใน DB", lvlOf(run([{ "รหัสพนักงาน":"B1", [K]:"C1" }]),"B1"), "block");
// วงในไฟล์เดียวกัน: A1→B1 และ B1→A1
const cyc = run([{ "รหัสพนักงาน":"A1", [K]:"B1" }, { "รหัสพนักงาน":"B1", [K]:"A1" }]);
t("วงกลมภายในไฟล์เดียวกัน ต้องจับได้", cyc.blocked > 0, true);
t("วงกลมแล้วไม่มีอะไรถูกบันทึกผิด ๆ", cyc.ok < 2, true);

// --- เตือน (บันทึกได้) ---
const low = run([{ "รหัสพนักงาน":"A1", [K]:"C1" }]);   // A1=M2 · C1=S2 ต่ำกว่า
t("หัวหน้าระดับต่ำกว่า = warn ไม่ block", lvlOf(low,"A1"), "warn");
t("warn ยังนับเป็นบันทึกได้", low.ok, 1);
const cross = run([{ "รหัสพนักงาน":"B1", [K]:"D1" }]); // คนละ Division
t("คนละ Division = warn", lvlOf(cross,"B1"), "warn");
t("คนละ Division ยังบันทึกได้", cross.ok, 1);

// --- payload เขียนเฉพาะ manager_code ---
const pl = run([{ "รหัสพนักงาน":"B1", [K]:"A1" }]).payload;
t("payload มีแค่ 2 คีย์", Object.keys(pl[0]).sort(), ["emp_code","manager_code"]);
t("payload ค่าถูกต้อง", pl[0], {emp_code:"B1", manager_code:"A1"});

// --- แถวที่ block ต้องไม่หลุดเข้า payload ---
const mix = run([{ "รหัสพนักงาน":"B1", [K]:"A1" }, { "รหัสพนักงาน":"C1", [K]:"C1" }]);
t("แถว block ไม่เข้า payload", mix.payload.length, 1);
t("นับ ok/blocked ถูก", [mix.ok, mix.blocked], [1,1]);

console.log(F ? `ไม่ผ่าน ${F} เคส (ผ่าน ${P})` : `ผ่านทั้งหมด ${P} เคส`);
