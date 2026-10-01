// Edge Function: letter-notify
// ส่งอีเมลแจ้งเรื่องหนังสือ HR จากอีเมลกลางผ่าน Microsoft 365 (Microsoft Graph · sendMail)
//   action = "request"  → แจ้งผู้อนุมัติ (HR Manager) ว่ามีหนังสือรออนุมัติ
//   action = "approved" | "rejected" → แจ้งคนที่ส่งขออนุมัติ
//   action = "test"     → ส่งเมลทดสอบหาคนที่กด (ปุ่ม "ทดสอบส่งเมล" ในหน้าตั้งค่า)
//
// ค่าตั้ง (Tenant / Client ID / Secret / ผู้ส่ง) ตั้งในหน้าเว็บ: ออกหนังสือ HR → ตั้งค่า → การส่งอีเมล
//   ใช้แอปเดียวกับที่ TigerSoft ใช้ส่งเมลได้ (ต้องมีสิทธิ์ Mail.Send แบบ Application)
//   แบบอีเมล (หัวเรื่อง + HTML) แก้ได้ในหน้าเดียวกัน — ตาราง mail_templates
// ⚠️ ในเมลไม่มีตัวเลขเงินเดือน — มีแค่เลขที่ ประเภท ชื่อผู้รับ และลิงก์เข้าไปดูในระบบ (ต้อง login)
//
// Deploy ครั้งเดียว: Supabase Dashboard → Edge Functions → Deploy a new function → Via Editor
//   ชื่อ letter-notify → วางโค้ดไฟล์นี้ทั้งไฟล์ → Deploy (ไม่ต้องตั้ง secret ใด ๆ)
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
// แทนค่า {{ตัวแปร}} — ค่าที่มาจากข้อมูลถูก escape ก่อนใส่ HTML เสมอ
// อีเมลคั่นด้วย , ; หรือช่องว่าง → รายการที่ถูกรูปแบบ ไม่ซ้ำ
const list = (s: string | null | undefined) =>
  [...new Set(String(s || "").split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))];
const fill = (tpl: string, v: Record<string, string>, html: boolean) =>
  tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => html ? esc(v[k] ?? "") : (v[k] ?? ""));

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
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    const { letter_id, action } = await req.json();
    const { data: ms } = await admin.from("mail_settings").select("*").eq("id", 1).maybeSingle();
    const { data: sec } = await admin.from("mail_secret").select("client_secret").eq("id", 1).maybeSingle();
    const cfg = {
      tenant: ms?.tenant_id || Deno.env.get("MS_TENANT_ID"), client: ms?.client_id || Deno.env.get("MS_CLIENT_ID"),
      secret: sec?.client_secret || Deno.env.get("MS_CLIENT_SECRET"), sender: ms?.sender || Deno.env.get("MS_SENDER"),
    };
    if (action !== "test" && ms?.mode !== "auto") return json({ sent: false, reason: "outlook_mode" });
    if (!cfg.tenant || !cfg.client || !cfg.secret || !cfg.sender) return json({ sent: false, reason: "not_configured" });

    let to = "", subject = "", html = "", extraTo: string[] = [], cc: string[] = [];
    const appUrl = (Deno.env.get("APP_URL") || req.headers.get("origin") || "").replace(/\/$/, "");
    if (action === "test") {
      to = user.email || "";
      subject = "ทดสอบส่งเมลจากระบบ HR";
      html = `<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px">ตั้งค่าการส่งอีเมลถูกต้อง — ระบบส่งเมลจาก <b>${esc(cfg.sender)}</b> ได้แล้ว</div>`;
    } else {
      const { data: l, error } = await caller.from("hr_letters").select("*").eq("id", letter_id).single();
      if (error || !l) return json({ error: "ไม่พบหนังสือ หรือไม่มีสิทธิ์" }, 403);
      const nameOf = async (uid: string | null) => {
        if (!uid) return "";
        const { data: s } = await admin.from("letter_signers").select("name_th,name_en,email").eq("user_id", uid).maybeSingle();
        const u = (await admin.auth.admin.getUserById(uid)).data.user;
        return { name: s?.name_th || s?.name_en || (u?.user_metadata?.full_name as string) || u?.email || "", email: s?.email || u?.email || "" };
      };
      const req_ = await nameOf(l.requested_by) as { name: string; email: string };
      const appr = await nameOf(l.approved_by || l.approver_id) as { name: string; email: string };
      if (action === "request") {
        if (l.status !== "pending") return json({ error: "หนังสือไม่ได้อยู่ในสถานะรออนุมัติ" }, 400);
        to = appr.email;
      } else if (action === "approved" || action === "rejected") {
        to = l.requested_email || req_.email;
      } else return json({ error: "action ไม่ถูกต้อง" }, 400);
      const { data: t } = await admin.from("mail_templates").select("subject,html,to_extra,cc").eq("key", action).maybeSingle();
      if (!t) return json({ sent: false, reason: "no_template" });
      const v = { doc_no: l.doc_no || "", kind: KIND[l.kind] || l.kind, person: l.person_name || "",
                  emp_code: l.emp_code ? `(${l.emp_code})` : "", link: `${appUrl}/?letter=${l.id}`,
                  reason: l.reject_reason || "-", requester: req_.name, approver: appr.name };
      subject = fill(t.subject, v, false); html = fill(t.html, v, true);
      extraTo = list(t.to_extra); cc = list(t.cc);
    }
    const toAll = [...new Set([...list(to), ...extraTo])];
    if (!toAll.length) return json({ sent: false, reason: "no_recipient" });

    const tok = await fetch(`https://login.microsoftonline.com/${cfg.tenant}/oauth2/v2.0/token`, {
      method: "POST",
      body: new URLSearchParams({ client_id: cfg.client!, client_secret: cfg.secret!, grant_type: "client_credentials",
                                  scope: "https://graph.microsoft.com/.default" }),
    });
    const tj = await tok.json();
    if (!tok.ok) return json({ sent: false, reason: "auth_error", detail: tj.error_description || tj.error });
    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.sender!)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tj.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { subject, body: { contentType: "HTML", content: html },
                                        toRecipients: toAll.map(address => ({ emailAddress: { address } })),
                                        ccRecipients: cc.filter(x => !toAll.includes(x)).map(address => ({ emailAddress: { address } })) },
                             saveToSentItems: true }),
    });
    if (!r.ok) return json({ sent: false, reason: "graph_error", detail: await r.text() });
    return json({ sent: true, to: toAll.join(", ") + (cc.length ? ` (cc ${cc.join(", ")})` : "") });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
