// เทสกติกาสายบังคับบัญชา — ดึงฟังก์ชันจริงจาก js/employees.js มารัน ไม่ก๊อปตรรกะ
// รัน:  osascript -l JavaScript test/reporting-line.test.js
ObjC.import('Foundation');
function read(p){ return $.NSString.stringWithContentsOfFileEncodingError(
  $(p), $.NSUTF8StringEncoding, null).js; }

const src = read('js/employees.js');
const blk = src.slice(src.indexOf('// ===== สายบังคับบัญชา ====='), src.indexOf('const selOpts ='));

// allEmployees เป็นตัวแปรที่ตรรกะในไฟล์ต้นทางอ้างถึง — ส่งเข้าไปตอนสร้างฟังก์ชัน
const EMP = [
  {emp_code:"A1", firstname_th:"สมชาย",  lastname_th:"ภูวเดช",     job_level:"M2", division:"Operations", department:"Processing", manager_code:null},
  {emp_code:"B1", firstname_th:"เชาว์ลิต", lastname_th:"ทองคำ",     job_level:"S3", division:"Operations", department:"Processing", manager_code:"A1"},
  {emp_code:"C1", firstname_th:"จิรายุ",  lastname_th:"ตันหยงทอง",  job_level:"S2", division:"Operations", department:"Processing", manager_code:"B1"},
  {emp_code:"D1", firstname_th:"นิรัน",   lastname_th:"ทองวิก",     job_level:"O3", division:"Operations", department:"Processing", manager_code:"C1"},
  {emp_code:"E1", firstname_th:"วิภาดา",  lastname_th:"ศรีทอง",     job_level:"M1", division:"Commercial", department:"Finance",    manager_code:null},
  {emp_code:"F1", firstname_th:"ปรีชา",   lastname_th:"วงศ์ทอง",    job_level:"S2", division:"Operations", department:"Mining",     manager_code:"A1"},
];

// สร้างฟังก์ชันจากซอร์สจริง แบบเดียวกับเทสอื่นในโปรเจกต์ (new Function ไม่ใช่ eval
// เพราะ const ที่ประกาศใน eval ไม่หลุดออกมาที่ scope นอก)
const api = new Function("allEmployees", `${blk}; return { rankOf, mgrItems, checkManager, LEVEL_RANK };`)(EMP);
const { rankOf, mgrItems, checkManager } = api;

let pass = 0, fail = 0;
function t(name, got, want){
  const ok = want === null ? (got === null || got === undefined) : got === want;
  if(ok){ pass++; } else { fail++; console.log("FAIL · " + name + "  (ได้ " + JSON.stringify(got) + ")"); }
}

// --- ลำดับศักดิ์ (HR ยืนยัน 2026-08-29: O < S < M · เลขมากกว่า = สูงกว่า) ---
t("O1 ต่ำสุด", rankOf("O1"), 1);
t("O3 < S1", rankOf("O3") < rankOf("S1"), true);
t("S3 < M1", rankOf("S3") < rankOf("M1"), true);
t("M4 สูงสุด", rankOf("M4"), 10);
t("ไม่ได้ใช้ sort_order (M1 ไม่ใช่อันดับ 1)", rankOf("M1") !== 1, true);
t("ระดับที่ไม่รู้จักคืน null", rankOf("X9"), null);

// --- บล็อก ---
t("บล็อก: เป็นหัวหน้าตัวเอง", checkManager("B1","B1","S3","Operations").block, true);
t("บล็อก: วงกลมตรง C1→B1", checkManager("B1","C1","S3","Operations").block, true);
t("บล็อก: วงกลมข้ามชั้น D1→B1", checkManager("B1","D1","S3","Operations").block, true);
t("บล็อก: รหัสไม่มีในระบบ", checkManager("B1","ZZ","S3","Operations").block, true);

// --- ผ่าน / เตือน ---
t("ผ่าน: B1 ขึ้นตรง A1 (M2 > S3, Division เดียวกัน)", checkManager("B1","A1","S3","Operations"), null);
t("ผ่าน: ไม่ได้เลือกหัวหน้า", checkManager("B1","","S3","Operations"), null);
t("เตือนไม่บล็อก: หัวหน้าระดับต่ำกว่า", (r => r && !r.block)(checkManager("B1","F1","S3","Operations")), true);
t("เตือนไม่บล็อก: หัวหน้าคนละ Division", (r => r && !r.block)(checkManager("B1","E1","S3","Operations")), true);

// --- ตัวเลือกหัวหน้า ---
t("ตัวเลือกไม่มีตัวเอง", mgrItems("B1").some(i => i.value === "B1"), false);
t("ตัวเลือกมีคนอื่นครบ", mgrItems("B1").length, 5);

console.log(fail ? ("ไม่ผ่าน " + fail + " เคส (ผ่าน " + pass + ")")
                 : ("ผ่านทั้งหมด " + pass + " เคส"));
