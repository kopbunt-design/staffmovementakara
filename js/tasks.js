// ===== งานที่รอคุณดำเนินการ (หน้าหลัก) =====
// รวมงานค้าง "ของคนที่ล็อกอิน" จากทุกระบบ — ต่างจากกระดิ่งซึ่งเป็นแจ้งเตือนรวมที่ทุกคนเห็นเหมือนกัน
// แต่ละแหล่งดึงเฉพาะเมื่อมีสิทธิ์ (RLS ก็กันอยู่แล้ว) · แหล่งไหนล้ม (ยังไม่ได้รัน SQL) ข้ามไป ไม่ทำให้หน้าหลักพัง
// เพิ่มงานจากระบบใหม่: เพิ่ม source ใน SOURCES — คืนรายการ { kind, title, sub, at, link }
import { supabase } from "./supabase-config.js";
import { can, currentUser } from "./app.js";

const LETTER_KIND = {
  th: { cert_th: "หนังสือรับรองการทำงาน (ไทย)", cert_en: "หนังสือรับรองการทำงาน (อังกฤษ)", salary_th: "หนังสือรับรองเงินเดือน (ไทย)",
        salary_en: "หนังสือรับรองเงินเดือน (อังกฤษ)", offer_en: "Offer Letter" },
  en: { cert_th: "Employment certificate (TH)", cert_en: "Employment certificate (EN)", salary_th: "Salary certificate (TH)",
        salary_en: "Salary certificate (EN)", offer_en: "Offer letter" },
};
const T = {
  th: { approve: no => `อนุมัติหนังสือ ${no}`, fix: no => `แก้ไขหนังสือ ${no} ที่ถูกส่งกลับ`,
        fund: n => `แบบฟอร์มกองทุนรอรับเรื่อง ${n} รายการ`, fundSub: "พนักงานส่งแบบฟอร์มแล้ว รอ HR กดรับ" },
  en: { approve: no => `Approve letter ${no}`, fix: no => `Revise letter ${no} (sent back)`,
        fund: n => `${n} fund form${n > 1 ? "s" : ""} to receive`, fundSub: "Submitted by employees, waiting for HR" },
};

const SOURCES = [
  // หนังสือ HR ที่ส่งถึงฉันให้อนุมัติ (อนุมัติได้เฉพาะคนที่ถูกเลือก)
  { when: () => can("data.letters.approve"), load: async (L) => {
    const { data, error } = await supabase.from("hr_letters").select("id,doc_no,kind,person_name,requested_at")
      .eq("status", "pending").eq("approver_id", currentUser?.id).order("requested_at");
    if (error) throw error;
    return data.map(l => ({ kind: "approve", title: T[L].approve(l.doc_no || ""), at: l.requested_at,
      sub: [LETTER_KIND[L][l.kind], l.person_name].filter(Boolean).join(" · "), link: `letters?letter=${l.id}` }));
  } },
  // หนังสือที่ฉันส่งไปแล้วถูกส่งกลับให้แก้
  { when: () => can("data.letters.write"), load: async (L) => {
    const { data, error } = await supabase.from("hr_letters").select("id,doc_no,kind,person_name,reject_reason,updated_at")
      .eq("status", "rejected").eq("requested_by", currentUser?.id).order("updated_at");
    if (error) throw error;
    return data.map(l => ({ kind: "fix", title: T[L].fix(l.doc_no || ""), at: l.updated_at,
      sub: [l.person_name, l.reject_reason].filter(Boolean).join(" · "), link: `letters?letter=${l.id}` }));
  } },
  // แบบฟอร์มกองทุนที่พนักงานส่งแล้ว รอ HR รับเรื่อง — นับเฉพาะฉบับล่าสุดของแต่ละคน (ตรงกับหน้าแบบฟอร์มกองทุน)
  { when: () => can("data.fundforms.write"), load: async (L) => {
    const { data, error } = await supabase.from("fund_form_submission").select("id,emp_code,status,submitted_at")
      .order("submitted_at", { ascending: false });
    if (error) throw error;
    const latest = new Map();
    for (const r of data) if (r.status !== "cancelled" && !latest.has(r.emp_code)) latest.set(r.emp_code, r);
    const wait = [...latest.values()].filter(r => r.status === "submitted");
    return wait.length ? [{ kind: "fund", title: T[L].fund(wait.length), sub: T[L].fundSub,
      at: wait.reduce((m, r) => r.submitted_at < m ? r.submitted_at : m, wait[0].submitted_at), link: "fundforms" }] : [];
  } },
];

// null = ผู้ใช้นี้ไม่มีสิทธิ์ในงานแบบไหนเลย (ไม่ต้องแสดงกล่อง) · [] = มีสิทธิ์แต่ไม่มีงานค้าง
export async function myTasks(lang = "th") {
  const L = lang === "en" ? "en" : "th";
  const active = SOURCES.filter(s => s.when());
  if (!active.length) return null;
  const parts = await Promise.all(active.map(s => s.load(L).catch(e => { console.warn("งานค้าง: ข้ามแหล่งที่โหลดไม่ได้", e?.message || e); return []; })));
  return parts.flat().sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));   // ค้างนานสุดขึ้นก่อน
}
