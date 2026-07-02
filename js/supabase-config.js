// ============================================================
// SUPABASE CONFIG
// 1. ไปที่ https://supabase.com → Project Settings → API
// 2. คัดลอก Project URL และ anon public key มาใส่ด้านล่าง
// ============================================================

const SUPABASE_URL = "https://degmbmegrhlddjdoumeu.supabase.co"const SUPABASE_ANON_KEY = "sb_publishable_Bb5f22N2KygZF4sLwJ0dQw_q-Wvyhmp"; // anon public key

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true }
});
