// Edge Function: letter-notify
// ส่งอีเมลแจ้งเรื่องหนังสือ HR จากอีเมลกลางผ่าน Microsoft 365 (Microsoft Graph · sendMail)
//   action = "request"  → แจ้งผู้อนุมัติ (HR Manager) ว่ามีหนังสือรออนุมัติ
//   action = "approved" | "rejected" → แจ้งคนที่ส่งขออนุมัติ
//   action = "test"     → ส่งเมลทดสอบหาคนที่กด (ปุ่ม "ทดสอบส่งเมล" ในหน้าตั้งค่า)
//   fund_id + action = "fund_request" | "fund_approved" | "fund_rejected"
//                       → แบบฟอร์มกองทุนสำรองเลี้ยงชีพ: ขอคณะกรรมการลงนาม / แจ้ง HR ผล (schema_fund_approval.sql)
//   exp_id + action = "exp_review" | "exp_approve" | "exp_approved" | "exp_rejected"
//                       → HR Invoice Hub ใบแจ้งหนี้: ขอตรวจ / ขออนุมัติ / แจ้งผู้จัดทำ (schema_expense.sql)
//                         exp_approve ส่งลิงก์อนุมัติไม่ต้อง login (/expense/approve.html?t=...) ถึงผู้อนุมัติ
//   exp_token (ไม่ต้อง login) → หน้า approve.html แจ้งผู้จัดทำหลังผู้อนุมัติกดจากลิงก์ (ภายใน 30 นาทีหลังกด)
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
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { letter_id, fund_id, exp_id, exp_token, action: action_ } = await req.json();
    let action = action_;
    // ผู้อนุมัติกดจากลิงก์ในเมล (ไม่ได้ login) — ยืนยันด้วย token ที่เพิ่งใช้ แทน session
    let caller: any = null, user: any = null;
    if (!exp_token) {
      const auth = req.headers.get("Authorization");
      if (!auth) return json({ error: "Missing authorization header" }, 401);
      // อ่านด้วยสิทธิ์ของผู้เรียก — ถ้าเขาอ่านหนังสือฉบับนี้ไม่ได้ (RLS) ก็ส่งเมลเรื่องนี้ไม่ได้
      caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
      const { data: { user: u }, error: uerr } = await caller.auth.getUser();
      if (uerr || !u) return json({ error: "Invalid session" }, 401);
      user = u;
    }
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
    const nameOf = async (uid: string | null) => {
      if (!uid) return { name: "", email: "" };
      const { data: s } = await admin.from("letter_signers").select("name_th,name_en,email").eq("user_id", uid).maybeSingle();
      const u = (await admin.auth.admin.getUserById(uid)).data.user;
      return { name: s?.name_th || s?.name_en || (u?.user_metadata?.full_name as string) || u?.email || "", email: s?.email || u?.email || "" };
    };
    const tplVars = async (key: string, v: Record<string, string>) => {
      const { data: t } = await admin.from("mail_templates").select("subject,html,to_extra,cc").eq("key", key).maybeSingle();
      if (!t) return false;
      subject = fill(t.subject, v, false); html = fill(t.html, v, true);
      extraTo = list(t.to_extra); cc = list(t.cc);
      return true;
    };
    if (exp_id || exp_token) {
      let x: any = null;
      if (exp_token) {
        const { data: t } = await admin.from("exp_approve_tokens").select("invoice_id,used_at").eq("token", String(exp_token)).maybeSingle();
        if (!t?.used_at || Date.now() - new Date(t.used_at).getTime() > 30 * 60e3) return json({ error: "ลิงก์ไม่ถูกต้องหรือหมดเวลาแจ้งผล" }, 403);
        x = (await admin.from("exp_invoices").select("*").eq("id", t.invoice_id).single()).data;
        action = x?.status === "approved" ? "exp_approved" : x?.status === "rejected" ? "exp_rejected" : "";
        if (!action) return json({ error: "ใบนี้ไม่ได้อยู่ในสถานะที่ต้องแจ้ง" }, 400);
      } else {
        const { data, error } = await caller.from("exp_invoices").select("*").eq("id", exp_id).single();
        if (error || !data) return json({ error: "ไม่พบใบแจ้งหนี้ หรือไม่มีสิทธิ์" }, 403);
        x = data;
      }
      const { data: ln } = await admin.from("exp_invoice_lines").select("detail").eq("invoice_id", x.id).order("line_no").limit(1);
      const prep = await nameOf(x.prepared_by), rev = await nameOf(x.reviewer_id), appr = await nameOf(x.approver_id);
      const money = (n: number) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " บาท";
      if (action === "exp_review") { if (x.status !== "review") return json({ error: "ใบนี้ไม่ได้รอตรวจ" }, 400); to = rev.email; }
      else if (action === "exp_approve") { if (x.status !== "approval") return json({ error: "ใบนี้ไม่ได้รออนุมัติ" }, 400); to = appr.email; }
      else if (action === "exp_approved" || action === "exp_rejected") to = prep.email;
      else return json({ error: "action ไม่ถูกต้อง" }, 400);
      // ส่งกลับโดยผู้อนุมัติ = ผู้ตรวจผ่านไปแล้วในรอบนี้ (reviewed_at หลังส่งตรวจล่าสุด)
      const byApprover = x.reviewed_at && x.submitted_at && new Date(x.reviewed_at) > new Date(x.submitted_at);
      const decider = action === "exp_rejected" ? (byApprover ? appr.name : rev.name) : appr.name;
      let link = `${appUrl}/expense/#/invoice/${x.id}`;
      if (action === "exp_approve") {   // ลิงก์อนุมัติไม่ต้อง login — ไปถึงผู้อนุมัติเท่านั้น (ไม่ใส่ให้ผู้รับเพิ่ม/สำเนา)
        const { data: t } = await admin.from("exp_approve_tokens").select("token,used_at,expires_at").eq("invoice_id", x.id).maybeSingle();
        if (t && !t.used_at && new Date(t.expires_at) > new Date()) link = `${appUrl}/expense/approve.html?t=${t.token}`;
      }
      const ok = await tplVars(action, { doc_no: x.inv_no || "", person: x.vendor?.name || "", kind: ln?.[0]?.detail || x.category || "",
        emp_code: money(x.net), link, reason: x.reject_reason || "-",
        requester: action === "exp_approve" ? rev.name : prep.name, approver: decider });
      if (!ok) return json({ sent: false, reason: "no_template" });
      if (action === "exp_approve" && link.includes("approve.html")) { extraTo = []; cc = []; }
    } else if (fund_id) {
      // อ่านด้วยสิทธิ์ผู้เรียก — ต้องเปิดหน้าแบบฟอร์มกองทุนได้ (RLS) ถึงส่งเมลเรื่องนี้ได้
      const { data: f, error } = await caller.from("fund_form_submission").select("*").eq("id", fund_id).single();
      if (error || !f) return json({ error: "ไม่พบคำขอ หรือไม่มีสิทธิ์" }, 403);
      const reqBy = await nameOf(f.approval_requested_by), appr = await nameOf(f.approver_id || f.approved_by);
      if (action === "fund_request") {
        if (f.status !== "pending_approval") return json({ error: "คำขอไม่ได้รอกรรมการลงนาม" }, 400);
        to = appr.email;
      } else if (action === "fund_approved" || action === "fund_rejected") to = reqBy.email;
      else return json({ error: "action ไม่ถูกต้อง" }, 400);
      const ok = await tplVars(action, { doc_no: `#${f.id}`, kind: "แบบฟอร์มกองทุนสำรองเลี้ยงชีพ", person: f.emp_name || "",
        emp_code: f.emp_code ? `(${f.emp_code})` : "", link: `${appUrl}/?fund=${f.id}`, reason: f.approval_note || "-",
        requester: reqBy.name, approver: appr.name });
      if (!ok) return json({ sent: false, reason: "no_template" });
    } else if (action === "test") {
      if (!user) return json({ error: "Invalid session" }, 401);
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
