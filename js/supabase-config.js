const SUPABASE_URL = "https://degmbmegrhlddjdoumeu.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Bb5f22N2KygZF4sLwJ0dQw_q-Wvyhmp";

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true }
});
