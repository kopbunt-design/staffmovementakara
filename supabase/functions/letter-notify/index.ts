// Edge Function: letter-notify
// ส่งอีเมลแจ้งเรื่องหนังสือ HR ผ่าน Microsoft 365 (Microsoft Graph · sendMail)
//   action = "request"  → แจ้งผู้อนุมัติ (HR Manager) ว่ามีหนังสือรออนุมัติ
//   action = "approved" | "rejected" → แจ้งคนที่ส่งขออนุมัติ
//
// ⚠️ ในเมลไม่มีตัวเลขเงินเดือน — มีแค่เลขที่ ประเภท ชื่อผู้รับ และลิงก์เข้าไปดูในระบบ (ต้อง login)
//
// ตั้งค่า (Supabase Dashboard > Edge Functions > Secrets) — IT ต้องลงทะเบียนแอปใน Microsoft Entra ID ก่อน:
//   MS_TENANT_ID      Directory (tenant) ID
//   MS_CLIENT_ID      Application (client) ID
//   MS_CLIENT_SECRET  Client secret
//   MS_SENDER         อีเมลกล่องที่ใช้ส่ง เช่น hr-system@akararesources.com
//   APP_URL           https://staffmovementakara.vercel.app
// ยังไม่ตั้งค่า → ตอบ { sent:false, reason:"not_configured" } หน้าเว็บจะแจ้งในระบบแทน ไม่ error
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const KIND: Record<string, string> = {
  cert_th: "หนังสือรับรองการทำงาน (ภาษาไทย)", cert_en: "Certificate of Employment (EN)",
  salary_th: "หนังสือรับรองเงินเดือน (ภาษาไทย)", salary_en: "Salary Certificate (EN)", offer_en: "Offer Letter",
};
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function graphToken() {
  const t = Deno.env.get("MS_TENANT_ID"), id = Deno.env.get("MS_CLIENT_ID"), sec = Deno.env.get("MS_CLIENT_SECRET");
  const r = await fetch(`https://login.microsoftonline.com/${t}/oauth2/v2.0/token`, {
    method: "POST",
    body: new URLSearchParams({ client_id: id!, client_secret: sec!, grant_type: "client_credentials",
                                scope: "https://graph.microsoft.com/.default" }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("ขอ token Microsoft ไม่สำเร็จ: " + (j.error_description || r.status));
  return j.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Missing authorization header" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    // อ่านด้วยสิทธิ์ของผู้เรียก — ถ้าเขาอ่านหนังสือฉบับนี้ไม่ได้ (RLS) ก็ส่งเมลเรื่องนี้ไม่ได้
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: uerr } = await caller.auth.getUser();
    if (uerr || !user) return json({ error: "Invalid session" }, 401);

    const { letter_id, action } = await req.json();
    const { data: l, error } = await caller.from("hr_letters").select("*").eq("id", letter_id).single();
    if (error || !l) return json({ error: "ไม่พบหนังสือ หรือไม่มีสิทธิ์" }, 403);

    const needed = ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "MS_SENDER"];
    if (needed.some(k => !Deno.env.get(k))) return json({ sent: false, reason: "not_configured" });

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    let to = "", subject = "", lead = "";
    if (action === "request") {
      if (l.status !== "pending") return json({ error: "หนังสือไม่ได้อยู่ในสถานะรออนุมัติ" }, 400);
      const { data: s } = await admin.from("letter_signers").select("email").eq("user_id", l.approver_id).single();
      to = s?.email || (await admin.auth.admin.getUserById(l.approver_id)).data.user?.email || "";
      subject = `[ขออนุมัติ] ${l.doc_no} ${KIND[l.kind] || ""} — ${l.person_name || ""}`;
      lead = "มีหนังสือรอการอนุมัติจากท่าน";
    } else if (action === "approved" || action === "rejected") {
      to = (await admin.auth.admin.getUserById(l.requested_by)).data.user?.email || "";
      subject = `[${action === "approved" ? "อนุมัติแล้ว" : "ส่งกลับแก้ไข"}] ${l.doc_no} — ${l.person_name || ""}`;
      lead = action === "approved" ? "หนังสือได้รับการอนุมัติแล้ว พิมพ์/ดาวน์โหลดได้ในระบบ"
                                   : `หนังสือถูกส่งกลับให้แก้ไข${l.reject_reason ? `: ${l.reject_reason}` : ""}`;
    } else return json({ error: "action ไม่ถูกต้อง" }, 400);
    if (!to) return json({ sent: false, reason: "no_recipient" });

    const link = `${(Deno.env.get("APP_URL") || "").replace(/\/$/, "")}/?letter=${l.id}`;
    const html = `<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;color:#1e293b">
      <p>${esc(lead)}</p>
      <table style="border-collapse:collapse;margin:10px 0">
        <tr><td style="padding:4px 14px 4px 0;color:#64748b">เลขที่</td><td><b>${esc(l.doc_no)}</b></td></tr>
        <tr><td style="padding:4px 14px 4px 0;color:#64748b">ประเภท</td><td>${esc(KIND[l.kind] || l.kind)}</td></tr>
        <tr><td style="padding:4px 14px 4px 0;color:#64748b">ออกให้</td><td>${esc(l.person_name)} ${l.emp_code ? `(${esc(l.emp_code)})` : ""}</td></tr>
      </table>
      <p><a href="${esc(link)}" style="display:inline-block;background:#2B5AC7;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">เปิดหนังสือในระบบ</a></p>
      <p style="color:#94a3b8;font-size:12px">อีเมลนี้ส่งอัตโนมัติจากระบบ HR · รายละเอียดหนังสือดูได้ในระบบเท่านั้น</p></div>`;

    const token = await graphToken();
    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(Deno.env.get("MS_SENDER")!)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { subject, body: { contentType: "HTML", content: html },
                                        toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: true }),
    });
    if (!r.ok) return json({ sent: false, reason: "graph_error", detail: await r.text() });
    return json({ sent: true, to });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
