// แทน js/app.js ภายในเว็บ /fund — index.html ใช้ import map ชี้ "/js/app.js" มาที่ไฟล์นี้
// เพื่อให้หน้าแบบฟอร์มกองทุนเดิม (js/fund-forms.js + hr-letters / mail-templates) ทำงานในเว็บ Akara Fund ได้
// โดยไม่บูตระบบ HR ทั้งก้อน (user 2026-11-13) · ชื่อที่ export ต้องครบทุกชื่อที่ไฟล์เหล่านั้น import จาก app.js:
//   allEmployees, can, currentUser, esc, notify, toast, userRole — เพิ่ม import จาก app.js ในไฟล์พวกนั้นเมื่อไร ต้องเพิ่มที่นี่ด้วย
import { supabase } from "../js/supabase-config.js";

export let allEmployees = [];
export let currentUser = null;
export let userRole = "user";
let perms = new Set(), toastFn = (m) => console.log(m);

export const can = key => perms.has(key);
export const esc = s => (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function toast(msg, type = "info") { toastFn(msg, type); }
export async function notify(title, detail = "", opts = {}) {
  const { type = "success", category = "default", toastMsg, silent = false, dedupKey = null, link = null } = opts;
  if (!silent) toast(toastMsg || (detail ? `${title} — ${detail}` : title), type);
  const row = { title, detail, category, dedup_key: dedupKey, created_by: currentUser?.id || null, ...(link ? { link } : {}) };
  const { error } = dedupKey ? await supabase.from("notifications").upsert(row, { onConflict: "dedup_key" }) : await supabase.from("notifications").insert(row);
  if (error) console.error("บันทึกแจ้งเตือนไม่สำเร็จ:", error.message);
}
// fx.js เรียกครั้งเดียวหลัง login
export function initShim(o) {
  if (o.employees) allEmployees = o.employees;
  if (o.user) currentUser = o.user;
  if (o.role) userRole = o.role;
  if (o.perms) perms = o.perms;
  if (o.toast) toastFn = o.toast;
}
