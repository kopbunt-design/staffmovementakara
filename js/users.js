import { supabase } from "./supabase-config.js";
import { currentUser, esc, toast } from "./app.js";

let unsubUsers = null;

export async function renderUsers() {
  const pg = document.getElementById("pageUsers");
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
  </div></div></div>`;

  const renderList = (users) => {
    document.getElementById("usersCount").textContent = `${users.length} ผู้ใช้`;
    const roleColors={admin:["var(--purple)","var(--purple-light)"],hr:["var(--green)","var(--green-light)"],user:["var(--muted)","#f1f5f9"]};
    document.getElementById("usersBody").innerHTML = users.map(u => {
      const [rc,rbg]=roleColors[u.role||"user"]||roleColors.user;
      const isSelf = u.user_id===currentUser?.id;
      return `<tr>
        <td style="font-weight:600;">${esc(u.name||"ไม่ระบุ")}</td>
        <td class="text-muted">${esc(u.email||"")}</td>
        <td><select class="filter-select" style="font-size:12px;padding:5px 8px;" onchange="window._changeRole('${u.user_id}',this.value)" ${isSelf?"disabled":""}>
          <option value="user" ${u.role==="user"?"selected":""}>User</option>
          <option value="hr" ${u.role==="hr"?"selected":""}>HR</option>
          <option value="admin" ${u.role==="admin"?"selected":""}>Admin</option>
        </select></td>
        <td><span class="badge" style="color:${rc};background:${rbg};">${{admin:"Admin",hr:"HR",user:"User"}[u.role||"user"]}</span></td>
        <td>${!isSelf?`<button class="btn btn-secondary btn-sm" style="color:var(--red);" onclick="window._removeUser('${u.user_id}','${esc(u.name||u.email||"")}')">ลบ</button>`:""}</td>
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
  window._openAddUser = ()=>{
    document.getElementById("modalPortal").innerHTML=`<div class="modal-overlay" id="addUserModal">
      <div class="modal" style="max-width:420px;">
        <div class="modal-header"><div class="modal-title">สร้างผู้ใช้ใหม่</div><button class="modal-close" onclick="document.getElementById('addUserModal').remove()">✕</button></div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:12px;">
          <div class="form-group"><label class="form-label">ชื่อ-นามสกุล</label><input id="nu_name" class="form-control" placeholder="สมชาย ใจดี"></div>
          <div class="form-group"><label class="form-label">อีเมล *</label><input id="nu_email" class="form-control" type="email" placeholder="email@akararesources.com"></div>
          <div class="form-group"><label class="form-label">รหัสผ่าน * (อย่างน้อย 6 ตัว)</label>
            <div style="display:flex;gap:8px;">
              <input id="nu_password" class="form-control" type="text" placeholder="ตั้งเองหรือกดสุ่ม" style="flex:1;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="window._genPassword()" style="white-space:nowrap;">🎲 สุ่มรหัส</button>
            </div>
          </div>
          <div class="form-group"><label class="form-label">Role</label><select id="nu_role" class="form-control"><option value="user">User</option><option value="hr">HR</option><option value="admin">Admin</option></select></div>
          <div style="padding:12px;background:var(--blue-light);border-radius:8px;font-size:12px;color:var(--blue-dark);line-height:1.6;">ระบบจะสร้างบัญชีให้ทันที กรุณาส่งอีเมลและรหัสผ่านนี้ให้ผู้ใช้เพื่อเข้าสู่ระบบ</div>
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
      const password=document.getElementById("nu_password").value;
      const role=document.getElementById("nu_role").value;
      const errEl=document.getElementById("nu_err");
      errEl.textContent="";
      if(!email){ errEl.textContent="กรุณากรอกอีเมล"; return; }
      if(!password||password.length<6){ errEl.textContent="รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร"; return; }
      const btn=document.getElementById("nu_submit");
      btn.disabled=true; btn.textContent="กำลังสร้าง...";
      const {data,error}=await supabase.functions.invoke("admin-create-user",{body:{email,password,name,role}});
      btn.disabled=false; btn.textContent="สร้างผู้ใช้";
      if(error||data?.error){ errEl.textContent="ไม่สำเร็จ: "+(data?.error||error.message); return; }
      showCredentials(name,email,password);
    };
  };

  // แสดงข้อมูลเข้าสู่ระบบหลังสร้างสำเร็จ ให้ admin คัดลอกไปแจ้งผู้ใช้
  const showCredentials=(name,email,password)=>{
    const credText=`ระบบ Akara HR System\n${name?`ชื่อ: ${name}\n`:""}อีเมล: ${email}\nรหัสผ่าน: ${password}\nเข้าใช้งานที่: ${window.location.origin}`;
    document.getElementById("modalPortal").innerHTML=`<div class="modal-overlay" id="credModal">
      <div class="modal" style="max-width:420px;">
        <div class="modal-header"><div class="modal-title">✅ สร้างผู้ใช้สำเร็จ</div><button class="modal-close" onclick="document.getElementById('credModal').remove()">✕</button></div>
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
