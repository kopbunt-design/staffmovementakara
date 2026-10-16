// Edge Function: letter-notify
// ส่งอีเมลแจ้งเรื่องหนังสือ HR จากอีเมลกลางผ่าน Microsoft 365 (Microsoft Graph · sendMail)
//   action = "request"  → แจ้งผู้อนุมัติ (HR Manager) ว่ามีหนังสือรออนุมัติ
//   action = "approved" | "rejected" → แจ้งคนที่ส่งขออนุมัติ
//   action = "test"     → ส่งเมลทดสอบหาคนที่กด (ปุ่ม "ทดสอบส่งเมล" ในหน้าตั้งค่า)
//   fund_id + action = "fund_request" | "fund_approved" | "fund_rejected"
//   ec_id + action = "ec_sign" (ถึงผู้แทนบริษัท + พยานที่ยังไม่เซ็น) | "ec_signed" | "ec_rejected" (ถึง HR ที่ส่ง) — สัญญาจ้างงาน
//                       → แบบฟอร์มกองทุนสำรองเลี้ยงชีพ: ขอคณะกรรมการลงนาม / แจ้ง HR ผล (schema_fund_approval.sql)
//   exp_id + action = "exp_review" | "exp_approve" | "exp_approved" | "exp_rejected"
//                       → HR Invoice Hub ใบแจ้งหนี้: ขอตรวจ / ขออนุมัติ / แจ้งผู้จัดทำ (schema_expense.sql)
//                         exp_approve ส่งลิงก์อนุมัติไม่ต้อง login (/expense/approve.html?t=...) ถึงผู้อนุมัติ
//   exp_token (ไม่ต้อง login) → หน้า approve.html แจ้งผู้จัดทำหลังผู้อนุมัติกดจากลิงก์ (ภายใน 30 นาทีหลังกด)
//   paf_id + action = "paf_request" → ผู้อนุมัติขั้นที่รออยู่ ได้ลิงก์ /paf/approve.html?t=… (ไม่ต้อง login) · "paf_approved" / "paf_rejected" → HR ผู้ส่ง
//   paf_token (ไม่ต้อง login) → หลังผู้อนุมัติกดจากลิงก์: ขอขั้นถัดไป หรือแจ้ง HR (อนุมัติครบ/ส่งกลับ)
//   ec_token + action = "ec_files" → ลิงก์ชั่วคราวของรูปลายเซ็นผู้แทน/พยาน ให้หน้า /econtract/sign.html (ไม่ต้อง login)
//   ec_token (ไม่ต้อง login) → หลังผู้แทนกดจากลิงก์: แจ้ง HR ผู้ส่ง (ลงนามครบ/ส่งกลับ) หรือแจ้งพยานที่ยังไม่ลงนาม
//   ec_id + action = "ec_sign" + role = "signer" | "witness" → ผู้แทนได้ลิงก์ลงนามไม่ต้อง login · พยานได้ลิงก์เข้าระบบ (ส่งแยกกัน)
//   exp_token + action = "exp_files" → ลิงก์ชั่วคราว (1 ชม.) ของไฟล์แนบ + รูปลายเซ็น ให้หน้า approve.html แสดงใบ A4 / เปิดไฟล์แนบ
//   ⚠️ หน้า approve.html เรียกโดยไม่ได้ login → ต้องปิด "Enforce JWT verification" ของฟังก์ชันนี้
//      (ฟังก์ชันตรวจ session เองทุกทางอยู่แล้ว ยกเว้นทาง exp_token ที่ตรวจด้วย token แทน)
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
    const { letter_id, fund_id, exp_id, exp_token, ec_id, ec_token, paf_id, paf_token, role, action: action_ } = await req.json();
    let action = action_;
    // ผู้อนุมัติกดจากลิงก์ในเมล (ไม่ได้ login) — ยืนยันด้วย token ที่เพิ่งใช้ แทน session
    let caller: any = null, user: any = null;
    if (exp_token && action === "exp_files") {
      const { data: t } = await admin.from("exp_approve_tokens").select("invoice_id,expires_at").eq("token", String(exp_token)).maybeSingle();
      if (!t || new Date(t.expires_at) <= new Date()) return json({ error: "ลิงก์ไม่ถูกต้องหรือหมดอายุ" }, 403);
      const { data: x } = await admin.from("exp_invoices").select("preparer,reviewer,approver").eq("id", t.invoice_id).single();
      const { data: fs } = await admin.from("exp_files").select("id,name,path").eq("invoice_id", t.invoice_id);
      const sign = async (bucket: string, path?: string | null) =>
        path ? (await admin.storage.from(bucket).createSignedUrl(path, 3600)).data?.signedUrl || null : null;
      const files = await Promise.all((fs || []).map(async f => ({ id: f.id, url: await sign("expense-files", f.path) })));
      const sig: Record<string, string | null> = {};
      for (const k of ["preparer", "reviewer", "approver"]) sig[k] = await sign("letter-assets", x?.[k]?.signature_path);
      return json({ files, sig });
    }
    if (ec_token && action === "ec_files") {
      const { data: t } = await admin.from("ec_sign_tokens").select("contract_id,expires_at").eq("token", String(ec_token)).maybeSingle();
      if (!t || new Date(t.expires_at) <= new Date()) return json({ error: "ลิงก์ไม่ถูกต้องหรือหมดอายุ" }, 403);
      const { data: c } = await admin.from("emp_contracts").select("signer,witness").eq("id", t.contract_id).single();
      const sign = async (path?: string | null) => path ? (await admin.storage.from("letter-assets").createSignedUrl(path, 3600)).data?.signedUrl || null : null;
      return json({ sig: { signer: await sign(c?.signer?.signature_path), witness: await sign(c?.witness?.signature_path) } });
    }
    if (!exp_token && !ec_token && !paf_token) {
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
    } else if (ec_id || ec_token) {
      // สัญญาจ้างงาน — อ่านด้วยสิทธิ์ผู้เรียก (RLS: HR ที่ทำสัญญา หรือผู้ลงนาม/พยานของฉบับนั้น) · หรือ token ที่ผู้แทนเพิ่งใช้ (ภายใน 30 นาที)
      let c: any = null, who = role;
      if (ec_token) {
        const { data: t } = await admin.from("ec_sign_tokens").select("contract_id,used_at").eq("token", String(ec_token)).maybeSingle();
        if (!t?.used_at || Date.now() - new Date(t.used_at).getTime() > 30 * 60e3) return json({ error: "ลิงก์ไม่ถูกต้องหรือหมดเวลาแจ้งผล" }, 403);
        c = (await admin.from("emp_contracts").select("*").eq("id", t.contract_id).single()).data;
        action = c?.status === "signed" ? "ec_signed" : c?.status === "rejected" ? "ec_rejected" : c?.status === "pending" && !c.witnessed_at ? "ec_sign" : "";
        who = "witness";
        if (!action) return json({ error: "สัญญานี้ไม่ได้อยู่ในสถานะที่ต้องแจ้ง" }, 400);
      } else {
        const { data, error } = await caller.from("emp_contracts").select("*").eq("id", ec_id).single();
        if (error || !data) return json({ error: "ไม่พบสัญญา หรือไม่มีสิทธิ์" }, 403);
        c = data;
      }
      const sg = await nameOf(c.signer_id), wt = await nameOf(c.witness_id), rq = await nameOf(c.requested_by);
      let link = `${appUrl}/?econtract=${c.id}`;
      if (action === "ec_sign") {
        if (c.status !== "pending") return json({ error: "สัญญาไม่ได้รอลงนาม" }, 400);
        // ผู้แทนกับพยานได้ลิงก์คนละแบบ → ส่งแยกฉบับ (role) · ไม่ระบุ = คนที่ยังไม่ลงนาม เริ่มจากผู้แทน
        if (!who) who = !c.signed_at ? "signer" : "witness";
        if (who === "signer") {
          if (c.signed_at) return json({ error: "ผู้แทนบริษัทลงนามแล้ว" }, 400);
          to = sg.email;
          const { data: t } = await admin.from("ec_sign_tokens").select("token,used_at,expires_at").eq("contract_id", c.id).maybeSingle();
          if (t && !t.used_at && new Date(t.expires_at) > new Date()) link = `${appUrl}/econtract/sign.html?t=${t.token}`;
        } else {
          if (c.witnessed_at) return json({ error: "พยานลงนามแล้ว" }, 400);
          to = wt.email;
        }
      } else if (action === "ec_signed" || action === "ec_rejected") to = c.requested_email || rq.email;
      else return json({ error: "action ไม่ถูกต้อง" }, 400);
      const me = ec_token ? sg : await nameOf(user?.id || null);
      const ok = await tplVars(action, { doc_no: "", kind: `สัญญาจ้างงาน · ${c.position_th || ""}`, person: `${c.title_th || ""}${c.name_th || ""}`,
        emp_code: c.start_date ? `เริ่มงาน ${c.start_date}` : "", link, reason: c.reject_reason || "-",
        requester: rq.name, approver: action === "ec_sign" ? (who === "signer" ? sg.name : wt.name) : me.name });
      if (!ok) return json({ sent: false, reason: "no_template" });
      if (link.includes("/econtract/sign.html")) { extraTo = []; cc = []; }   // ลิงก์ลงนามแทนบริษัทไปถึงผู้แทนคนเดียว
    } else if (paf_id || paf_token) {
      // Personnel Action Form — อ่านด้วยสิทธิ์ผู้เรียก (RLS: data.paf.write) · หรือ token ที่ผู้อนุมัติเพิ่งใช้ (ภายใน 30 นาที)
      let f: any = null;
      if (paf_token) {
        const { data: t } = await admin.from("paf_tokens").select("paf_id,used_at").eq("token", String(paf_token)).maybeSingle();
        if (!t?.used_at || Date.now() - new Date(t.used_at).getTime() > 30 * 60e3) return json({ error: "ลิงก์ไม่ถูกต้องหรือหมดเวลาแจ้งผล" }, 403);
        f = (await admin.from("paf_forms").select("*").eq("id", t.paf_id).single()).data;
        action = f?.status === "approved" ? "paf_approved" : f?.status === "rejected" ? "paf_rejected" : f?.status === "pending" ? "paf_request" : "";
        if (!action) return json({ error: "PAF นี้ไม่ได้อยู่ในสถานะที่ต้องแจ้ง" }, 400);
      } else {
        const { data, error } = await caller.from("paf_forms").select("*").eq("id", paf_id).single();
        if (error || !data) return json({ error: "ไม่พบ PAF หรือไม่มีสิทธิ์" }, 403);
        f = data;
      }
      const cur = (f.steps || []).find((s: any) => s.step === f.cur_step) || {};
      const { data: lg } = await admin.from("paf_log").select("actor_name,action").eq("paf_id", f.id).order("at", { ascending: false }).limit(1);
      let link = `${appUrl}/?paf=${f.id}`;
      if (action === "paf_request") {
        if (f.status !== "pending") return json({ error: "PAF ไม่ได้รออนุมัติ" }, 400);
        to = cur.email || "";
        const { data: t } = await admin.from("paf_tokens").select("token,used_at,expires_at").eq("paf_id", f.id).eq("step", f.cur_step).maybeSingle();
        if (t && !t.used_at && new Date(t.expires_at) > new Date()) link = `${appUrl}/paf/approve.html?t=${t.token}`;
      } else if (action === "paf_approved" || action === "paf_rejected") to = f.requested_email || "";
      else return json({ error: "action ไม่ถูกต้อง" }, 400);
      const ok = await tplVars(action, { doc_no: f.doc_no || "", kind: f.subject_th || "Personnel Action Form", person: f.name_th || "", emp_code: `(${f.emp_code})`,
        link, reason: f.reject_reason || "-", requester: f.requested_name || "", approver: action === "paf_request" ? (cur.name_th || "") : (lg?.[0]?.actor_name || "") });
      if (!ok) return json({ sent: false, reason: "no_template" });
      if (link.includes("/paf/approve.html")) { extraTo = []; cc = []; }   // ลิงก์อนุมัติไปถึงผู้อนุมัติคนเดียว
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
