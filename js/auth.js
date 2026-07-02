import { supabase } from "./supabase-config.js";

const loginScreen = document.getElementById("loginScreen");
const appShell = document.getElementById("appShell");
const errEl = document.getElementById("loginError");

// Google sign-in
document.getElementById("googleBtn")?.addEventListener("click", async () => {
  errEl.textContent = "";
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin }
  });
  if (error) errEl.textContent = error.message;
});

// Email login
document.getElementById("loginForm")?.addEventListener("submit", async e => {
  e.preventDefault(); errEl.textContent = "";
  const { error } = await supabase.auth.signInWithPassword({
    email: document.getElementById("loginEmail").value.trim(),
    password: document.getElementById("loginPassword").value
  });
  if (error) errEl.textContent = friendlyErr(error);
});

// Sign up
document.getElementById("signupForm")?.addEventListener("submit", async e => {
  e.preventDefault(); errEl.textContent = "";
  const name = document.getElementById("signupName").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  const { error } = await supabase.auth.signUp({
    email, password,
    options: { data: { full_name: name } }
  });
  if (error) errEl.textContent = friendlyErr(error);
  else errEl.style.color = "var(--green)", errEl.textContent = "สมัครสำเร็จ กรุณาตรวจสอบอีเมลยืนยัน (ถ้าไม่มี อาจเข้าสู่ระบบได้เลย)";
});

// Toggle signup/login
document.getElementById("showSignup")?.addEventListener("click", e => {
  e.preventDefault();
  const sf = document.getElementById("signupForm");
  const lf = document.getElementById("loginForm");
  const showing = sf.style.display !== "none";
  sf.style.display = showing ? "none" : "block";
  lf.style.display = showing ? "block" : "none";
  document.getElementById("showSignup").textContent = showing ? "สมัครใช้งาน" : "กลับไปเข้าสู่ระบบ";
  errEl.textContent = "";
});

export async function logout() {
  await supabase.auth.signOut();
}

function friendlyErr(err) {
  if (!err) return "";
  const msg = err.message || "";
  if (msg.includes("Invalid login")) return "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
  if (msg.includes("Email not confirmed")) return "กรุณายืนยันอีเมลก่อน";
  if (msg.includes("already registered")) return "อีเมลนี้ถูกใช้สมัครแล้ว";
  if (msg.includes("Password should be")) return "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร";
  return msg;
}

// Auth state listener
supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) {
    loginScreen.style.display = "none";
    appShell.style.display = "flex";
  } else {
    loginScreen.style.display = "flex";
    appShell.style.display = "none";
  }
});
