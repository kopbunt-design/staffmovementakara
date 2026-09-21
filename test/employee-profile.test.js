// เทสตัวคำนวณของหน้าประวัติพนักงาน — ดึงฟังก์ชันจริงจาก js/employee-profile.js มารัน ไม่ก๊อปตรรกะ
// รัน:  osascript -l JavaScript test/employee-profile.test.js
ObjC.import('Foundation');
function read(p){ return $.NSString.stringWithContentsOfFileEncodingError(
  $(p), $.NSUTF8StringEncoding, null).js; }

const src = read('js/employee-profile.js');
const blk = src.slice(src.indexOf('// ===== ตัวช่วยคำนวณ ====='), src.indexOf('const avatarHTML ='));

// ผังทดสอบ:  A1 (บนสุด) -> B1 -> C1 -> D1        E1 ไม่มีหัวหน้า
//            X1 <-> Y1 คือข้อมูลเพี้ยนที่วนเป็นวงกลม
//            Z1 ชี้ไปหารหัสที่ไม่มีในระบบ
const EMP = [
  {emp_code:"A1", firstname_th:"สมชาย",  lastname_th:"ภูวเดช",    manager_code:null, status:"Active"},
  {emp_code:"B1", firstname_th:"เชาว์ลิต", lastname_th:"ทองคำ",    manager_code:"A1", status:"Active"},
  {emp_code:"C1", firstname_th:"จิรายุ",  lastname_th:"ตันหยงทอง", manager_code:"B1", status:"Active"},
  {emp_code:"D1", firstname_th:"นิรัน",   lastname_th:"ทองวิก",    manager_code:"C1", status:"Active"},
  {emp_code:"E1", firstname_th:"วิภาดา",  lastname_th:"ศรีทอง",    manager_code:null, status:"Active"},
  {emp_code:"R1", firstname_th:"อดีต",    lastname_th:"พนักงาน",   manager_code:"C1", status:"Resigned"},
  {emp_code:"X1", firstname_th:"วน",      lastname_th:"หนึ่ง",     manager_code:"Y1", status:"Active"},
  {emp_code:"Y1", firstname_th:"วน",      lastname_th:"สอง",       manager_code:"X1", status:"Active"},
  {emp_code:"Z1", firstname_th:"ชี้",     lastname_th:"ผิด",       manager_code:"ไม่มีรหัสนี้", status:"Active"},
];

const api = new Function("allEmployees", `${blk}; return { ymd, ymdText, chainUp, reportsOf, empOf, fullTH };`)(EMP);
const { ymd, ymdText, chainUp, reportsOf } = api;

let pass = 0, fail = 0;
function t(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if(ok){ pass++; } else { fail++; console.log("FAIL · " + name + "  (ได้ " + JSON.stringify(got) + " ควรเป็น " + JSON.stringify(want) + ")"); }
}

// --- ymd: ช่วงเวลาแบบ ปี/เดือน/วัน ---
t("ครบปีพอดี", ymd("2020-01-01","2023-01-01"), {y:3,m:0,d:0});
t("ขาดหนึ่งวันไม่ครบปี", ymd("2020-01-01","2022-12-31"), {y:2,m:11,d:30});
t("ข้ามเดือน ต้องยืมวันจากเดือนก่อนหน้า", ymd("2024-01-31","2024-03-01"), {y:0,m:1,d:1});
t("กุมภาพันธ์ปีอธิกสุรทิน", ymd("2024-02-29","2025-02-28"), {y:0,m:11,d:30});
t("วันเดียวกัน = ศูนย์", ymd("2026-09-21","2026-09-21"), {y:0,m:0,d:0});
t("ไม่มีวันเริ่ม = null", ymd(null,"2026-01-01"), null);
t("วันที่เพี้ยนอ่านไม่ออก = null", ymd("ยังไม่ได้รับ","2026-01-01"), null);
// วันสิ้นสุดมาก่อนวันเริ่ม = ข้อมูลผิด ต้องคืน null ไม่ใช่เลขติดลบที่ดูเหมือนใช้ได้
t("วันสิ้นสุดก่อนวันเริ่ม = null", ymd("2026-01-01","2020-01-01"), null);

t("ข้อความอ่านง่าย", ymdText({y:9,m:6,d:20}), "9 ปี 6 เดือน 20 วัน");
t("ข้อความเมื่อไม่มีค่า", ymdText(null), "—");

// --- chainUp: ไล่สายบังคับบัญชาขึ้นไป (ใกล้ตัวที่สุดอยู่ต้นรายการ) ---
const codes = e => chainUp(e).map(x => x.emp_code);
t("ไล่ขึ้นสามชั้น", codes(EMP[3]), ["C1","B1","A1"]);
t("ขึ้นชั้นเดียว", codes(EMP[1]), ["A1"]);
t("ไม่มีหัวหน้า = ว่าง", codes(EMP[4]), []);
// ข้อมูลเพี้ยนต้องไม่ทำให้หน้าค้าง — DB มี trigger กันวน แต่แถวเก่าอาจรอดมาได้
t("วงกลมต้องหยุด ไม่วนไม่รู้จบ", codes(EMP[6]), ["Y1"]);
t("ชี้ไปหารหัสที่ไม่มี = ว่าง", codes(EMP[8]), []);

// --- reportsOf: ลูกน้องโดยตรง ---
t("นับลูกน้องโดยตรง", reportsOf("B1").map(e=>e.emp_code), ["C1"]);
t("ไม่มีลูกน้อง", reportsOf("D1").map(e=>e.emp_code), []);
// คนลาออกแล้วต้องไม่โผล่ในทีม ไม่งั้นจำนวนลูกน้องจะเกินจริง
t("ไม่นับคนที่ลาออกแล้ว", reportsOf("C1").map(e=>e.emp_code), ["D1"]);
t("ลูกน้องเรียงตามชื่อไทย", reportsOf("A1").map(e=>e.emp_code), ["B1"]);

console.log(fail === 0 ? `ผ่านทั้งหมด ${pass} เคส` : `ผ่าน ${pass} · ตก ${fail}`);
