import { supabase } from "./supabase-config.js";
import { currentUser, can, esc, toast } from "./app.js";

let unsubUsers = null;
// รายชื่อ role ดึงจากตาราง app_roles ไม่ hardcode — ไม่งั้น role ที่แอดมินสร้างเองจะเลือกไม่ได้
let appRoles = [];

// Edge Function ตอบ non-2xx → supabase-js บอกแค่ "Edge Function returned a non-2xx status code"
// สาเหตุจริงอยู่ใน body ของ response — ดึงมาแสดง และแปลข้อความที่เจอบ่อยเป็นไทย
async function fnError(data, error) {
  let msg = data?.error || error?.message || "";
  try { const b = await error.context.json(); msg = b.error || b.message || msg; } catch {}
  if (/already.*registered|already exists/i.test(msg)) return "อีเมลนี้มีบัญชีในระบบอยู่แล้ว (อาจเคยลบออกจากรายชื่อแต่บัญชียังอยู่ — ใช้ปุ่มรีเซ็ตรหัสผ่าน หรือให้เขาเข้าด้วย Google)";
  if (/weak|pwned|leaked|characters|password should/i.test(msg)) return "รหัสผ่านไม่ผ่านเกณฑ์ความปลอดภัยของ Supabase (" + msg + ") — ลองกด 🎲 สุ่มรหัส";
  if (/requested function was not found|NOT_FOUND/i.test(msg)) return "ยังไม่ได้ deploy ฟังก์ชันนี้ใน Supabase";
  return msg || "ไม่ทราบสาเหตุ";
}

export async function renderUsers() {
  const pg = document.getElementById("pageUsers");
  if (!can("page.users")) {
    pg.innerHTML = `<div class="empty-state" style="padding-top:80px;"><div class="empty-title">ไม่มีสิทธิ์เข้าถึง</div><div class="empty-sub">เฉพาะ Admin เท่านั้นที่จัดการผู้ใช้/สิทธิ์ได้</div></div>`;
    return;
  }
  pg.innerHTML = `
  <div class="page-header">
    <div><div class="page-heading">จัดการผู้ใช้ระบบ</div><div class="page-sub" id="usersCount">กำลังโหลด...</div></div>
    <button class="btn btn-primary" onclick="window._openAddUser()">+ สร้างผู้ใช้ใหม่</button>
  </div>
  <div class="section mt-4 pb-4"><div class="card"><div class="table-wrap">
    <table class="data-table">
      <thead><tr><th>ชื่อ</th><th>อีเมล</th><th>Role</th><th>สถานะ</th><th></th></tr></thead>
      <tbody id="usersBody"><tr><td colspan="5" class="text-center text-muted" style="padding:32px;">กำลังโหลด...</td></tr></tbody>
    </table>
  </div></div></div>
  <div class="section pb-4" id="secLog" style="display:none;"></div>`;
  renderSecurity(30);

  // ถ้ายังไม่ได้ติดตั้งตารางสิทธิ์ ให้ถอยไปใช้ 3 role เดิม
  const { data: rolesData } = await supabase.from("app_roles").select("key,label").order("sort_order");
  appRoles = rolesData?.length ? rolesData
           : [{key:"user",label:"User"},{key:"hr",label:"HR"},{key:"admin",label:"Admin"}];
  const roleLabel = k => appRoles.find(r => r.key === k)?.label || k || "User";

  const renderList = (users) => {
    document.getElementById("usersCount").textContent = `${users.length} ผู้ใช้`;
    const roleColors={admin:["var(--purple)","var(--purple-light)"],hr:["var(--green)","var(--green-light)"],user:["var(--muted)","#f1f5f9"]};
    document.getElementById("usersBody").innerHTML = users.map(u => {
      const [rc,rbg]=roleColors[u.role]||["var(--blue)","var(--blue-light)"];
      const isSelf = u.user_id===currentUser?.id;
      return `<tr>
        <td style="font-weight:600;">${esc(u.name||"ไม่ระบุ")}</td>
        <td class="text-muted">${esc(u.email||"")}</td>
        <td><select class="filter-select" style="font-size:12px;padding:5px 8px;" onchange="window._changeRole('${u.user_id}',this.value)" ${isSelf?"disabled":""}>
          ${appRoles.map(r=>`<option value="${esc(r.key)}" ${u.role===r.key?"selected":""}>${esc(r.label)}</option>`).join("")}
        </select></td>
        <td><span class="badge" style="color:${rc};background:${rbg};">${esc(roleLabel(u.role))}</span></td>
        <td style="white-space:nowrap;">${!isSelf?`<button class="btn btn-secondary btn-sm" style="color:var(--red);" onclick="window._removeUser('${u.user_id}','${esc(u.name||u.email||"")}')">ลบ</button>`:""}</td>
      </tr>`;
    }).join("")||`<tr><td colspan="5" class="text-center text-muted" style="padding:32px;">ยังไม่มีผู้ใช้</td></tr>`;
  };

  const { data } = await supabase.from("user_roles").select("*").order("role");
  if(data) renderList(data);

  // Realtime
  if(unsubUsers) supabase.removeChannel(unsubUsers);
  unsubUsers = supabase.channel("user-roles-changes")
    .on("postgres_changes",{event:"*",schema:"public",table:"user_roles"},async()=>{
      const {data:fresh}=await supabase.from("user_roles").select("*").order("role");
      if(fresh) renderList(fresh);
    }).subscribe();

  window._changeRole = async(uid,role) => {
    const {error}=await supabase.from("user_roles").update({role}).eq("user_id",uid);
    if(error) toast("เปลี่ยน role ไม่สำเร็จ","error");
    else toast(`เปลี่ยน role เป็น ${role} เรียบร้อย`,"success");
  };
  window._removeUser = async(uid,name)=>{
    if(!confirm(`ลบผู้ใช้ "${name}" ออกจากระบบ?`)) return;
    await supabase.from("user_roles").delete().eq("user_id",uid);
    toast("ลบผู้ใช้เรียบร้อย","info");
  };
  // ลืมรหัสผ่าน: ระบบสุ่มรหัสชั่วคราวให้ แอดมินแจ้งเจ้าตัว แล้วเจ้าตัวถูกบังคับตั้งรหัสใหม่เองตอนเข้าครั้งถัดไป
  window._resetPw = async(uid,name)=>{
    if(!confirm(`รีเซ็ตรหัสผ่านของ "${name}"?\n\nรหัสเดิมจะใช้ไม่ได้ทันที ระบบจะสร้างรหัสชั่วคราวให้แจ้งเจ้าตัว และเจ้าตัวต้องตั้งรหัสใหม่เองตอนเข้าระบบ`)) return;
    const {data,error}=await supabase.functions.invoke("admin-reset-password",{body:{user_id:uid}});
    if(error||data?.error){ toast("รีเซ็ตไม่สำเร็จ: "+await fnError(data,error),"error"); return; }
    showCredentials(name,data.email,data.password,true);
  };
  window._openAddUser = ()=>{
    document.getElementById("modalPortal").innerHTML=`<div class="modal-overlay" id="addUserModal">
      <div class="modal" style="max-width:420px;">
        <div class="modal-header"><div class="modal-title">สร้างผู้ใช้ใหม่</div><button class="modal-close" onclick="document.getElementById('addUserModal').remove()">✕</button></div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:12px;">
          <div class="form-group"><label class="form-label">ชื่อ-นามสกุล</label><input id="nu_name" class="form-control" placeholder="สมชาย ใจดี"></div>
          <div class="form-group"><label class="form-label">อีเมล *</label><input id="nu_email" class="form-control" type="email" placeholder="email@akararesources.com"></div>

          <div class="form-group"><label class="form-label">Role</label><select id="nu_role" class="form-control"><option value="user">User</option><option value="hr">HR</option><option value="admin">Admin</option></select></div>
          <div style="padding:12px;background:var(--blue-light);border-radius:8px;font-size:12px;color:var(--blue-dark);line-height:1.6;">ใช้อีเมลบริษัท (@akararesources.com) · ผู้ใช้เข้าด้วยบัญชี Microsoft ของตัวเอง ไม่ต้องตั้งรหัสผ่าน · <b>เฉพาะคนที่อยู่ในรายชื่อนี้เท่านั้นที่เข้าระบบได้</b></div>
          <div id="nu_err" style="color:var(--red);font-size:12px;"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('addUserModal').remove()">ยกเลิก</button>
          <button class="btn btn-primary" id="nu_submit" onclick="window._saveNewUser()">สร้างผู้ใช้</button>
        </div>
      </div>
    </div>`;
    window._genPassword=()=>{
      // สุ่ม 10 ตัว ตัดอักขระที่อ่านสับสน (0/O, 1/l/I) ออก
      const chars="abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
      let pw=""; const buf=new Uint32Array(10); crypto.getRandomValues(buf);
      for(const n of buf) pw+=chars[n%chars.length];
      document.getElementById("nu_password").value=pw;
    };
    window._saveNewUser=async()=>{
      const name=document.getElementById("nu_name").value.trim();
      const email=document.getElementById("nu_email").value.trim();

      const role=document.getElementById("nu_role").value;
      const errEl=document.getElementById("nu_err");
      errEl.textContent="";
      if(!email){ errEl.textContent="กรุณากรอกอีเมล"; return; }

      const btn=document.getElementById("nu_submit");
      btn.disabled=true; btn.textContent="กำลังสร้าง...";
      const {data,error}=await supabase.functions.invoke("admin-create-user",{body:{email,name,role}});
      btn.disabled=false; btn.textContent="สร้างผู้ใช้";
      if(error||data?.error){ errEl.textContent="ไม่สำเร็จ: "+await fnError(data,error); return; }
      document.getElementById("addUserModal")?.remove();
      toast(`เพิ่ม ${email} แล้ว — ให้เจ้าตัวเข้าระบบด้วยบัญชี Microsoft ของบริษัท`,"success");
    };
  };

  // แสดงข้อมูลเข้าสู่ระบบหลังสร้างสำเร็จ ให้ admin คัดลอกไปแจ้งผู้ใช้
  const showCredentials=(name,email,password,reset=false)=>{
    const credText=`ระบบ Akara HR System\n${name?`ชื่อ: ${name}\n`:""}อีเมล: ${email}\n${reset?"รหัสผ่านชั่วคราว":"รหัสผ่าน"}: ${password}\nเข้าใช้งานที่: ${window.location.origin}${reset?"\n(เข้าระบบแล้วจะให้ตั้งรหัสผ่านใหม่เองทันที)":""}`;
    document.getElementById("modalPortal").innerHTML=`<div class="modal-overlay" id="credModal">
      <div class="modal" style="max-width:420px;">
        <div class="modal-header"><div class="modal-title">✅ ${reset?"รีเซ็ตรหัสผ่านแล้ว":"สร้างผู้ใช้สำเร็จ"}</div><button class="modal-close" onclick="document.getElementById('credModal').remove()">✕</button></div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:12px;">
          <div style="padding:12px;background:var(--green-light);border-radius:8px;font-size:12px;color:var(--green);line-height:1.6;">คัดลอกข้อมูลด้านล่างส่งให้ผู้ใช้ — รหัสผ่านจะแสดงครั้งเดียวเท่านั้น ปิดหน้าต่างนี้แล้วจะดูอีกไม่ได้</div>
          <pre id="credText" style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:13px;line-height:1.8;white-space:pre-wrap;word-break:break-all;margin:0;">${esc(credText)}</pre>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('credModal').remove()">ปิด</button>
          <button class="btn btn-primary" id="credCopyBtn" onclick="window._copyCred()">📋 คัดลอก</button>
        </div>
      </div>
    </div>`;
    window._copyCred=async()=>{
      try{
        await navigator.clipboard.writeText(credText);
        document.getElementById("credCopyBtn").textContent="✅ คัดลอกแล้ว";
      }catch{
        // เบราว์เซอร์เก่า/ไม่อนุญาต clipboard — ให้เลือกข้อความแทน
        const r=document.createRange(); r.selectNodeContents(document.getElementById("credText"));
        const s=getSelection(); s.removeAllRanges(); s.addRange(r);
        toast("กด Ctrl+C เพื่อคัดลอก","info");
      }
    };
  };
}

// ---- บันทึกความปลอดภัย (Azure เท่านั้น: /api/admin/security, admin) — ใครเข้าระบบ / ใครพยายามเข้า / IP ที่บล็อก
const SEC_KIND = {
  http_401: "เรียกข้อมูลโดยไม่ล็อกอิน", http_403: "ไม่มีสิทธิ์", blocked: "IP ถูกบล็อกแล้วยังเข้ามา",
  rate: "ยิงถี่เกินกำหนด", rate_public: "เปิดลิงก์/ฟอร์มถี่เกิน", ban: "แบนอัตโนมัติ",
  new_user: "บัญชีเข้าระบบครั้งแรก", foreign_account: "บัญชีนอกบริษัท", denied_account: "บัญชีที่ไม่ได้เพิ่มไว้ (ถูกปฏิเสธ)",
};
const secKind = k => SEC_KIND[k] || (k?.startsWith("public_") ? "ลิงก์/รหัสผิด (" + k.slice(7) + ")" : k);
const secTime = v => v ? new Date(v).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "–";
const secUA = ua => {
  if (!ua) return "–";
  if (/HeadlessChrome|PhantomJS|Puppeteer|Playwright/i.test(ua)) return "🤖 บอท (เบราว์เซอร์อัตโนมัติ)";
  if (/curl|python|wget|go-http|okhttp|java|libwww|scrapy|httpclient|axios|node-fetch/i.test(ua)) return "🤖 สคริปต์ (" + ua.split(/[\s/]/)[0] + ")";
  const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac OS/.test(ua) ? "Mac" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : ua.slice(0, 30);
  return [br, os].filter(Boolean).join(" · ");
};

async function renderSecurity(days) {
  const box = document.getElementById("secLog");
  if (!box) return;
  let d;
  try {
    const r = await fetch(`/api/admin/security?days=${days}`, { credentials: "same-origin" });
    if (!r.ok) return;                       // ไม่ใช่ admin / ไม่ได้รันบน Azure → ไม่แสดง
    d = await r.json();
  } catch { return; }
  if (d.error) return;
  const office = new Set(d.office || []);
  const ipCell = ip => `<a href="https://ipinfo.io/${encodeURIComponent(ip)}" target="_blank" rel="noopener" style="font-family:monospace;">${esc(ip)}</a>${office.has(ip) ? ` <span class="badge" style="color:var(--green);background:var(--green-light);">ออฟฟิศ</span>` : ""}`;

  // ใครเข้าระบบ: รวมต่อบัญชี
  const byUser = {};
  for (const l of d.logins || []) {
    const u = byUser[l.email] ||= { email: l.email, name: l.name, ips: new Set(), days: new Set(), first: l.first, last: l.last, ua: l.user_agent };
    u.ips.add(l.ip); u.days.add(l.day);
    if (l.first < u.first) u.first = l.first;
    if (l.last > u.last) { u.last = l.last; u.ua = l.user_agent; }
  }
  const users = Object.values(byUser).sort((a, b) => b.last.localeCompare(a.last));
  const newUsers = new Set((d.events || []).filter(e => e.kind === "new_user").map(e => (e.detail || "").split(" ")[0]));
  const attackers = (d.top_ips || []).filter(t => !t.kinds.every(k => k === "new_user"));
  const blocks = d.blocks || [];
  const tile = (n, label, color) => `<div class="card" style="padding:14px 16px;flex:1;min-width:140px;"><div style="font-size:24px;font-weight:700;color:${color};">${n}</div><div class="text-muted" style="font-size:12px;">${label}</div></div>`;

  box.style.display = "";
  box.innerHTML = `
  <div class="page-header" style="margin-top:8px;">
    <div><div class="page-heading" style="font-size:18px;">🛡️ บันทึกความปลอดภัย</div>
      <div class="page-sub">ใครเข้าระบบ · ใครพยายามเข้าโดยไม่ได้ล็อกอิน · IP ที่บล็อก (เวลาไทย · เริ่มบันทึก 2 พ.ย. 2026)</div></div>
    <select class="filter-select" id="secDays">${[1, 7, 30, 90].map(n => `<option value="${n}" ${n === days ? "selected" : ""}>${n} วันล่าสุด</option>`).join("")}</select>
  </div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
    ${tile(users.length, "บัญชีที่เข้าระบบ", "var(--blue)")}
    ${tile(attackers.length, "IP ที่ถูกปฏิเสธ", attackers.length ? "var(--red)" : "var(--green)")}
    ${tile(blocks.length + (d.seed || []).length, "IP ที่บล็อกอยู่", "var(--purple)")}
  </div>

  <div class="card" style="margin-bottom:12px;"><div style="padding:12px 16px;font-weight:600;">👤 ใครเข้าระบบ</div><div class="table-wrap"><table class="data-table">
    <thead><tr><th>ผู้ใช้</th><th>IP</th><th>เครื่อง</th><th>วันที่เข้า</th><th>ครั้งแรก</th><th>ล่าสุด</th></tr></thead>
    <tbody>${users.map(u => `<tr>
      <td><div style="font-weight:600;">${esc(u.name || u.email)}</div><div class="text-muted" style="font-size:12px;">${esc(u.email)}
        ${!u.email.endsWith("@akararesources.com") ? ` <span class="badge" style="color:var(--red);background:var(--red-light);">นอกบริษัท</span>` : ""}
        ${newUsers.has(u.email) ? ` <span class="badge" style="color:var(--orange,#c2410c);background:#fff7ed;">เข้าครั้งแรก</span>` : ""}</div></td>
      <td>${[...u.ips].map(ipCell).join("<br>")}</td>
      <td class="text-muted" style="font-size:12px;">${esc(secUA(u.ua))}</td>
      <td>${u.days.size} วัน</td>
      <td style="white-space:nowrap;">${secTime(u.first)}</td>
      <td style="white-space:nowrap;">${secTime(u.last)}</td>
    </tr>`).join("") || `<tr><td colspan="6" class="text-center text-muted" style="padding:24px;">ยังไม่มีบันทึก</td></tr>`}</tbody>
  </table></div></div>

  <div class="card" style="margin-bottom:12px;"><div style="padding:12px 16px;font-weight:600;">🚨 ใครพยายามเข้า (ไม่ได้ล็อกอิน / ลิงก์ผิด / ถูกบล็อก)</div><div class="table-wrap"><table class="data-table">
    <thead><tr><th>IP</th><th>ทำอะไร</th><th>เครื่องมือ</th><th>ครั้ง*</th><th>ครั้งแรก</th><th>ล่าสุด</th><th></th></tr></thead>
    <tbody>${attackers.map(t => `<tr>
      <td>${ipCell(t.ip)}</td>
      <td style="font-size:12px;">${t.kinds.filter(k => k !== "new_user").map(k => esc(secKind(k))).join("<br>")}</td>
      <td class="text-muted" style="font-size:12px;">${esc(secUA(t.user_agent))}</td>
      <td>${t.events}</td>
      <td style="white-space:nowrap;">${secTime(t.first)}</td>
      <td style="white-space:nowrap;">${secTime(t.last)}</td>
      <td>${blocks.some(b => b.ip === t.ip) || (d.seed || []).includes(t.ip) || office.has(t.ip) ? "" : `<button class="btn btn-secondary btn-sm" style="color:var(--red);" onclick="window._secBlock('${esc(t.ip)}')">⛔ บล็อก</button>`}</td>
    </tr>`).join("") || `<tr><td colspan="7" class="text-center text-muted" style="padding:24px;">✅ ไม่มีใครพยายามเข้าในช่วงนี้</td></tr>`}</tbody>
  </table></div>
  <div class="text-muted" style="font-size:11px;padding:8px 16px;">* นับได้สูงสุดนาทีละ 1 ครั้งต่อประเภท (ยิงถล่มก็ไม่ทำให้ฐานข้อมูลเต็ม) · คลิก IP เพื่อดูประเทศ/ผู้ให้บริการ · ยิงผิดเกิน 30 ครั้งใน 15 นาที ระบบแบนเอง 1 ชม.</div></div>

  <div class="card"><div style="padding:12px 16px;font-weight:600;display:flex;justify-content:space-between;align-items:center;">⛔ IP ที่บล็อก
    <button class="btn btn-secondary btn-sm" onclick="window._secBlock('')">+ บล็อก IP</button></div><div class="table-wrap"><table class="data-table">
    <thead><tr><th>IP</th><th>เหตุผล</th><th>ถึง</th><th>โดย</th><th></th></tr></thead>
    <tbody>${(d.seed || []).map(ip => `<tr><td>${ipCell(ip)}</td><td class="text-muted">ผู้โจมตีระบบ Azure อื่นของบริษัท 31 ต.ค.–1 พ.ย. (ฝังในโปรแกรม)</td><td>ถาวร</td><td>ระบบ</td><td></td></tr>`).join("")}
    ${blocks.map(b => `<tr><td>${ipCell(b.ip)}</td><td>${esc(b.reason || "")}</td>
      <td style="white-space:nowrap;">${b.until ? (new Date(b.until) < new Date() ? "หมดแล้ว " : "") + secTime(b.until) : "ถาวร"}</td>
      <td class="text-muted" style="font-size:12px;">${esc(b.created_by === "guard" ? "แบนอัตโนมัติ" : b.created_by || "")}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="window._secUnblock('${esc(b.ip)}')">ปลดบล็อก</button></td></tr>`).join("")}</tbody>
  </table></div></div>`;

  document.getElementById("secDays").onchange = e => renderSecurity(Number(e.target.value));
  const post = async body => {
    const r = await fetch("/api/admin/security/block", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { toast("ไม่สำเร็จ: " + ((await r.json().catch(() => ({}))).detail || r.status), "error"); return false; }
    return true;
  };
  window._secBlock = async ip => {
    ip = ip || prompt("IP ที่จะบล็อก")?.trim();
    if (!ip) return;
    if (office.has(ip)) { toast("นี่คือ IP ออฟฟิศ บล็อกไม่ได้", "error"); return; }
    const reason = prompt(`เหตุผลที่บล็อก ${ip}`, "พยายามเข้าระบบ");
    if (reason === null) return;
    if (await post({ ip, on: true, reason })) { toast(`บล็อก ${ip} แล้ว (มีผลภายใน 1 นาที)`, "success"); renderSecurity(days); }
  };
  window._secUnblock = async ip => {
    if (!confirm(`ปลดบล็อก ${ip}?`)) return;
    if (await post({ ip, on: false })) { toast(`ปลดบล็อก ${ip} แล้ว`, "success"); renderSecurity(days); }
  };
}
