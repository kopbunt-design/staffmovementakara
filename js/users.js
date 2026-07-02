import { supabase } from "./supabase-config.js";
import { currentUser, esc, toast } from "./app.js";

let unsubUsers = null;

export async function renderUsers() {
  const pg = document.getElementById("pageUsers");
  pg.innerHTML = `
  <div class="page-header">
    <div><div class="page-heading">จัดการผู้ใช้ระบบ</div><div class="page-sub" id="usersCount">กำลังโหลด...</div></div>
    <button class="btn btn-primary" onclick="window._openAddUser()">+ เพิ่มผู้ใช้ล่วงหน้า</button>
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
        <div class="modal-header"><div class="modal-title">เพิ่มผู้ใช้ล่วงหน้า</div><button class="modal-close" onclick="document.getElementById('addUserModal').remove()">✕</button></div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:12px;">
          <div class="form-group"><label class="form-label">ชื่อ-นามสกุล</label><input id="nu_name" class="form-control" placeholder="สมชาย ใจดี"></div>
          <div class="form-group"><label class="form-label">อีเมล</label><input id="nu_email" class="form-control" type="email" placeholder="email@akararesources.com"></div>
          <div class="form-group"><label class="form-label">Role</label><select id="nu_role" class="form-control"><option value="user">User</option><option value="hr">HR</option><option value="admin">Admin</option></select></div>
          <div style="padding:12px;background:var(--blue-light);border-radius:8px;font-size:12px;color:var(--blue-dark);line-height:1.6;">หลังเพิ่มแล้ว ส่งลิงก์ระบบให้ผู้ใช้สมัครหรือล็อกอิน ระบบจะกำหนด role ให้อัตโนมัติ</div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('addUserModal').remove()">ยกเลิก</button>
          <button class="btn btn-primary" onclick="window._saveNewUser()">เพิ่มผู้ใช้</button>
        </div>
      </div>
    </div>`;
    window._saveNewUser=async()=>{
      const name=document.getElementById("nu_name").value.trim();
      const email=document.getElementById("nu_email").value.trim();
      const role=document.getElementById("nu_role").value;
      if(!email){ toast("กรุณากรอกอีเมล","error"); return; }
      const key=email.toLowerCase().replace(/[.@]/g,"_");
      const {error}=await supabase.from("pending_roles").upsert({email_key:key,name,email,role});
      if(error){ toast("ไม่สำเร็จ: "+error.message,"error"); return; }
      document.getElementById("addUserModal").remove();
      toast(`เพิ่ม ${name||email} เรียบร้อย`,"success");
    };
  };
}
