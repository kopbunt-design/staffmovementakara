// Edge Function: admin-reset-password
// แอดมินรีเซ็ตรหัสผ่านให้คนที่ลืมรหัส — ไม่ผ่านอีเมล
//   ตั้งรหัสชั่วคราวที่สุ่มที่นี่ (หน้าเว็บไม่ได้เลือกเอง) แล้วติดธง must_change_password
//   คนนั้นเข้าด้วยรหัสชั่วคราวแล้วถูกบังคับตั้งรหัสใหม่เองทันที แอดมินจึงไม่รู้รหัสจริงของใคร
// เรียกได้เฉพาะคนที่มีสิทธิ์ page.users และรีเซ็ตบัญชี admin ได้เฉพาะ admin (กันยกระดับสิทธิ์)
//
// Deploy ครั้งเดียว: Supabase Dashboard → Edge Functions → Deploy a new function → Via Editor
//   ชื่อ admin-reset-password → วางโค้ดไฟล์นี้ทั้งไฟล์ → Deploy (ไม่ต้องตั้ง secret ใด ๆ)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// 10 ตัว ตัดอักขระที่อ่านสับสน (0/O, 1/l/I) — แบบเดียวกับปุ่มสุ่มรหัสตอนสร้างผู้ใช้
const tempPassword = () => {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const buf = new Uint32Array(10); crypto.getRandomValues(buf);
  return [...buf].map(n => chars[n % chars.length]).join("");
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Missing authorization header" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: uerr } = await caller.auth.getUser();
    if (uerr || !user) return json({ error: "Invalid session" }, 401);

    const { data: allowed } = await caller.rpc("has_perm", { p: "page.users" });
    if (!allowed) return json({ error: "ไม่มีสิทธิ์รีเซ็ตรหัสผ่าน" }, 403);

    const { user_id } = await req.json();
    if (!user_id) return json({ error: "ไม่ระบุผู้ใช้" }, 400);
    if (user_id === user.id) return json({ error: "รหัสของตัวเองให้เปลี่ยนที่ปุ่มกุญแจ" }, 400);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: rows } = await admin.from("user_roles").select("user_id,role").in("user_id", [user.id, user_id]);
    const roleOf = (id: string) => rows?.find(r => r.user_id === id)?.role;
    if (!roleOf(user_id)) return json({ error: "ไม่พบผู้ใช้นี้" }, 404);
    if (roleOf(user_id) === "admin" && roleOf(user.id) !== "admin")
      return json({ error: "รีเซ็ตรหัสของ Admin ได้เฉพาะ Admin" }, 403);

    const { data: target, error: gerr } = await admin.auth.admin.getUserById(user_id);
    if (gerr || !target?.user) return json({ error: "ไม่พบบัญชีผู้ใช้นี้" }, 404);
    const password = tempPassword();
    const { error } = await admin.auth.admin.updateUserById(user_id, {
      password,
      user_metadata: { ...target.user.user_metadata, must_change_password: true },
    });
    if (error) return json({ error: error.message }, 400);
    return json({ success: true, email: target.user.email, password });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
