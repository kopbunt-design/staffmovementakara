import { supabase } from "./supabase-config.js";
import { esc, toast } from "./app.js";

// ============================================================================
// จัดการสิทธิ์ — แอดมินสร้าง role เองได้ และติ๊กว่า role ไหนเห็น/ทำอะไรได้
//
// ตารางที่ใช้ (ดู sql/schema_rbac.sql):
//   app_roles        รายชื่อ role · is_system = true คือ admin/hr/user ลบไม่ได้
//   permissions      แคตตาล็อกสิทธิ์ — แก้จากหน้าเว็บไม่ได้ตั้งใจ (RLS ปิดไว้)
//                    ถ้าเพิ่ม key ที่โค้ดไม่ได้เช็ค จะได้สิทธิ์หลอกที่ไม่มีผลอะไร
//   role_permissions มีแถว = อนุญาต
//
// admin ผ่าน has_perm() เสมอในฝั่ง DB จึงล็อกช่องติ๊กไว้ กันเผลอถอนสิทธิ์ตัวเอง
// ============================================================================

const CAT = {
  page:  { label: "หน้าจอที่เปิดได้",  hint: "คุมทั้งเมนูและการเปิดหน้าตรง ๆ" },
  data:  { label: "ข้อมูลและการแก้ไข", hint: "บังคับที่ฐานข้อมูลจริง (RLS) ไม่ใช่แค่ซ่อนปุ่ม" },
  field: { label: "ช่องข้อมูลเฉพาะ",   hint: "ซ่อนเฉพาะช่องนั้นในหน้าเว็บ" },
};

let roles = [], perms = [], grant = new Set();   // grant: "role|perm"

export async function loadRbac() {
  const [r, p, rp] = await Promise.all([
    supabase.from("app_roles").select("*").order("sort_order"),
    supabase.from("permissions").select("*").order("sort_order"),
    supabase.from("role_permissions").select("*"),
  ]);
  if (r.error || p.error || rp.error) {
    const e = r.error || p.error || rp.error;
    throw new Error(e.message);
  }
  roles = r.data || [];
  perms = p.data || [];
  grant = new Set((rp.data || []).map(x => `${x.role_key}|${x.perm_key}`));
}

const has = (role, perm) => role === "admin" || grant.has(`${role}|${perm}`);

export function permissionsCardHTML() {
  if (!roles.length) {
    return `<div class="card card-body">
      <div class="card-title">สิทธิ์การใช้งาน</div>
      <div class="empty-sub">ยังไม่ได้ติดตั้งตารางสิทธิ์ — รัน <code>sql/schema_rbac.sql</code>
        ใน Supabase ก่อน แล้วรีเฟรชหน้านี้<br>
        <span class="text-muted">ระหว่างนี้ระบบใช้กติกาเดิม (admin/hr/user) ทำงานได้ตามปกติ</span></div>
    </div>`;
  }

  const byCat = c => perms.filter(p => p.category === c);
  const rowsFor = c => byCat(c).map(p => `
    <tr>
      <td class="perm-name">
        <div>${esc(p.label)}</div>
        ${p.description ? `<div class="perm-desc">${esc(p.description)}</div>` : ""}
        <div class="perm-key">${esc(p.key)}</div>
      </td>
      ${roles.map(r => `
      <td class="perm-cell">
        ${r.key === "admin"
          // ไม่ใช้ checkbox disabled — Chrome ทิ้ง accent-color ทำให้ดูเหมือนช่องว่าง
          // ทั้งที่ admin มีสิทธิ์ครบ อ่านผิดได้ง่ายมาก
          ? `<span class="perm-locked" title="Admin มีทุกสิทธิ์เสมอ ถอนไม่ได้" aria-label="อนุญาต (ล็อก)">
               <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                 <path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor"
                       stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
               </svg>
             </span>`
          : `<input type="checkbox" ${has(r.key, p.key) ? "checked" : ""}
                    onchange="window._permToggle('${esc(r.key)}','${esc(p.key)}',this)">`}
      </td>`).join("")}
    </tr>`).join("");

  const section = c => !byCat(c).length ? "" : `
    <tr class="perm-group">
      <td colspan="${roles.length + 1}">
        <b>${CAT[c].label}</b> <span>${CAT[c].hint}</span>
      </td>
    </tr>${rowsFor(c)}`;

  return `<div class="card card-body">
    <div style="display:flex;align-items:center;justify-content:space-between;
                margin-bottom:6px;gap:12px;flex-wrap:wrap;">
      <div class="card-title" style="margin:0;">สิทธิ์การใช้งาน</div>
      <button class="btn btn-primary btn-sm" onclick="window._roleModal()">+ เพิ่ม Role</button>
    </div>
    <div class="text-muted" style="font-size:12px;margin-bottom:14px;">
      ติ๊กแล้วบันทึกทันที · คนที่ล็อกอินค้างอยู่จะเห็นผลหลัง<b>ออกแล้วเข้าใหม่</b>
    </div>

    <div class="table-wrap">
      <table class="data-table perm-table">
        <thead><tr>
          <th style="min-width:230px;">สิทธิ์</th>
          ${roles.map(r => `<th class="perm-role">
            <div>${esc(r.label)}</div>
            <div class="perm-rolekey">${esc(r.key)}</div>
            ${r.is_system
              ? `<div class="perm-sys">ระบบ</div>`
              : `<button class="perm-edit" onclick="window._roleModal('${esc(r.key)}')">แก้ไข</button>`}
          </th>`).join("")}
        </tr></thead>
        <tbody>
          ${section("page")}
          ${section("data")}
          ${section("field")}
        </tbody>
      </table>
    </div>
  </div>`;
}

// ---------- บันทึกการติ๊ก ----------
export function wirePermissions(rerender) {
  window._permToggle = async (role, perm, el) => {
    const on = el.checked;
    el.disabled = true;
    const { error } = on
      ? await supabase.from("role_permissions").insert({ role_key: role, perm_key: perm })
      : await supabase.from("role_permissions").delete().eq("role_key", role).eq("perm_key", perm);
    el.disabled = false;
    if (error) {
      el.checked = !on;
      toast(error.message.includes("row-level security")
        ? "ไม่มีสิทธิ์แก้สิทธิ์ผู้ใช้" : "บันทึกไม่สำเร็จ: " + error.message, "error");
      return;
    }
    const k = `${role}|${perm}`;
    on ? grant.add(k) : grant.delete(k);
  };

  window._roleModal = (key) => openRoleModal(key, rerender);
}

function openRoleModal(key, rerender) {
  const r = roles.find(x => x.key === key) || null;
  const isEdit = !!r;
  const wrap = document.createElement("div");
  wrap.id = "roleModal";
  wrap.className = "modal-overlay";
  wrap.innerHTML = `
    <div class="modal" style="max-width:460px;">
      <div class="modal-header">
        <div class="modal-title">${isEdit ? "แก้ไข Role" : "เพิ่ม Role ใหม่"}</div>
        <button class="modal-close" onclick="document.getElementById('roleModal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">รหัส (key)</label>
          <input id="rl_key" class="form-control" value="${esc(r?.key || "")}"
                 ${isEdit ? "readonly" : ""} placeholder="manager">
          <div class="text-muted" style="font-size:11px;margin-top:3px;">
            ${isEdit ? "รหัสแก้ไม่ได้ เพราะผูกกับผู้ใช้ที่ถือ role นี้อยู่"
                     : "ตัวพิมพ์เล็ก/ตัวเลข/ขีดล่าง เท่านั้น ตั้งแล้วเปลี่ยนไม่ได้"}
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">ชื่อที่แสดง</label>
          <input id="rl_label" class="form-control" value="${esc(r?.label || "")}" placeholder="ผู้จัดการ">
        </div>
        <div class="form-group">
          <label class="form-label">คำอธิบาย</label>
          <input id="rl_desc" class="form-control" value="${esc(r?.description || "")}"
                 placeholder="เห็นรายงานทุกหน้า แต่แก้ข้อมูลไม่ได้">
        </div>
      </div>
      <div class="modal-footer">
        ${isEdit && !r.is_system
          ? `<button class="btn btn-danger" onclick="window._roleDelete('${esc(r.key)}')">ลบ Role</button>` : ""}
        <div style="flex:1;"></div>
        <button class="btn btn-secondary" onclick="document.getElementById('roleModal').remove()">ยกเลิก</button>
        <button class="btn btn-primary" onclick="window._roleSave(${isEdit ? `'${esc(r.key)}'` : "null"})">บันทึก</button>
      </div>
    </div>`;
  document.getElementById("modalPortal").appendChild(wrap);

  window._roleSave = async (editKey) => {
    const g = id => document.getElementById(id).value.trim();
    const key = (editKey || g("rl_key")).toLowerCase();
    const label = g("rl_label");
    if (!key || !/^[a-z][a-z0-9_]*$/.test(key)) {
      toast("รหัส role ต้องขึ้นต้นด้วยตัวอักษรเล็ก และมีได้แค่ a-z 0-9 _", "error"); return;
    }
    if (!label) { toast("กรุณากรอกชื่อที่แสดง", "error"); return; }
    const payload = { key, label, description: g("rl_desc") };
    const { error } = editKey
      ? await supabase.from("app_roles").update({ label: payload.label, description: payload.description }).eq("key", key)
      : await supabase.from("app_roles").insert({ ...payload, sort_order: 100 });
    if (error) {
      toast(error.message.includes("duplicate") ? `มี role "${key}" อยู่แล้ว`
          : error.message.includes("row-level security") ? "ไม่มีสิทธิ์จัดการ role"
          : "บันทึกไม่สำเร็จ: " + error.message, "error");
      return;
    }
    document.getElementById("roleModal").remove();
    toast(editKey ? "บันทึกแล้ว" : `เพิ่ม role "${label}" แล้ว — ติ๊กสิทธิ์ให้ในตารางได้เลย`, "success");
    await loadRbac(); rerender();
  };

  window._roleDelete = async (key) => {
    const { count } = await supabase.from("user_roles")
      .select("user_id", { count: "exact", head: true }).eq("role", key);
    if (count) {
      toast(`ลบไม่ได้ — ยังมีผู้ใช้ ${count} คนถือ role นี้อยู่ ย้ายเขาไป role อื่นก่อน`, "error");
      return;
    }
    if (!confirm(`ลบ role "${key}" ?`)) return;
    const { error } = await supabase.from("app_roles").delete().eq("key", key);
    if (error) { toast("ลบไม่สำเร็จ: " + error.message, "error"); return; }
    document.getElementById("roleModal").remove();
    toast("ลบแล้ว", "info");
    await loadRbac(); rerender();
  };
}
