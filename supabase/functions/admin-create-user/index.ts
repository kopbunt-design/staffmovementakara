// Edge Function: admin-create-user
// สร้างบัญชีผู้ใช้จริงใน Supabase Auth โดยตรง — เรียกได้เฉพาะ admin เท่านั้น
// ใช้ service_role key (Deno.env ที่ Supabase inject ให้อัตโนมัติ ไม่ต้องตั้งเอง)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // client ผูกกับ JWT ของผู้เรียก ใช้เช็คสิทธิ์เท่านั้น
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) throw new Error("Invalid session");

    const { data: roleRow } = await callerClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .single();

    if (roleRow?.role !== "admin") {
      return new Response(JSON.stringify({ error: "เฉพาะ Admin เท่านั้นที่สร้างผู้ใช้ได้" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { email, password, name, role } = await req.json();
    if (!email || !password) throw new Error("กรุณากรอกอีเมลและรหัสผ่าน");
    if (String(password).length < 6) throw new Error("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร");
    if (!["user", "hr", "admin"].includes(role)) throw new Error("Role ไม่ถูกต้อง");

    // client แยกต่างหาก ใช้ service_role เพื่อสร้าง user จริง (ไม่กระทบ session ของ admin ที่ล็อกอินอยู่)
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name || "" },
    });
    if (createErr) throw createErr;

    const { error: roleErr } = await adminClient.from("user_roles").upsert({
      user_id: created.user.id,
      name: name || "",
      email,
      role,
    });
    if (roleErr) throw roleErr;

    return new Response(JSON.stringify({ success: true, user_id: created.user.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
