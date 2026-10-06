import { supabase } from "./supabase-config.js";
import { esc as escText, toast } from "./app.js";
import { renderMail, mailList } from "./hr-letters.js";

// ============================================================================
// ตัวแก้แบบอีเมล (หัวเรื่อง + HTML + ผู้รับเพิ่ม/สำเนา + ตัวอย่างสด) — ใช้ร่วมกันหลายหน้า
//   ออกหนังสือ HR → ตั้งค่า        : แบบ request / approved / rejected
//   แบบฟอร์มกองทุน → ตั้งค่า        : แบบ fund_request / fund_approved / fund_rejected
// อีเมลผู้ส่ง/โหมดส่งตั้งที่เดียว (หน้าหนังสือ HR) — แต่ละหน้าแก้แค่เนื้อหาเมลของตัวเอง
// ============================================================================

const esc = v => escText(v == null ? "" : String(v));
const VARS = ["doc_no", "kind", "person", "emp_code", "link", "reason", "requester", "approver"];

// list = แถวจาก mail_templates · key = แบบที่เลือกอยู่ · recipient(key) = ข้อความบอกว่าผู้รับหลักคือใคร
export function tplEditorHTML(list, key, recipient) {
  const t = list.find(x => x.key === key) || list[0] || {};
  if (!t.key) return `<div class="text-muted">ยังไม่มีแบบอีเมล — รัน SQL ของหน้านี้ก่อน</div>`;
  return `<div class="text-muted" style="font-size:12.5px;margin-bottom:8px;">ใส่โค้ด HTML ได้ · ตัวแปร: ${VARS.map(v => `<code>{{${v}}}</code>`).join(" ")}</div>
    <div class="lt-mail-ed"><div>
      <select class="form-control" id="mtKey" style="max-width:280px;">${list.map(x => `<option value="${x.key}" ${x.key === t.key ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select>
      <div class="lt-hint" style="margin-top:8px;">ผู้รับหลักใส่ให้อัตโนมัติ: ${esc(recipient(t.key))} · ใส่เพิ่มได้ด้านล่าง คั่นด้วยจุลภาค</div>
      <label class="lt-f"><span>ส่งถึงเพิ่มเติม (To)</span><input class="form-control" id="mtTo" value="${esc(t.to_extra || "")}" placeholder="เช่น hr.team@akararesources.com"></label>
      <label class="lt-f"><span>สำเนาถึง (CC)</span><input class="form-control" id="mtCc" value="${esc(t.cc || "")}" placeholder="เช่น chalita@akararesources.com, kopbun@akararesources.com"></label>
      <label class="lt-f"><span>หัวเรื่อง</span><input class="form-control" id="mtSubject" value="${esc(t.subject || "")}"></label>
      <label class="lt-f"><span>เนื้อหา (HTML)</span><textarea class="form-control" id="mtHtml" rows="14" spellcheck="false" style="font-family:ui-monospace,Menlo,monospace;font-size:12px;">${esc(t.html || "")}</textarea></label>
      <button class="btn btn-primary" id="mtSave" style="margin-top:8px;">บันทึกแบบอีเมล</button></div>
      <div><div class="lt-f"><span>ตัวอย่าง</span></div><div class="lt-mail-subj" id="mtPrevSubj"></div><iframe id="mtPrev" title="ตัวอย่างอีเมล"></iframe></div></div>`;
}

// root = กล่องที่มีตัวแก้ · onSwitch(key) = เลือกแบบอื่นแล้วให้หน้าวาดใหม่ · sample = ค่าตัวอย่างของตัวแปร
export function wireTplEditor(root, list, { sample, onSwitch }) {
  const $ = s => root.querySelector(s);
  if (!$("#mtKey")) return;
  const cur = () => list.find(x => x.key === $("#mtKey").value);
  const prev = () => { $("#mtPrevSubj").textContent = renderMail($("#mtSubject").value, sample, false);
    $("#mtPrev").srcdoc = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:12px">${renderMail($("#mtHtml").value, sample, true)}</body></html>`; };
  prev();
  $("#mtSubject").oninput = prev; $("#mtHtml").oninput = prev;
  $("#mtKey").onchange = e => onSwitch(e.target.value);
  $("#mtSave").onclick = async () => {
    const to_extra = mailList($("#mtTo").value), cc = mailList($("#mtCc").value);
    const bad = [$("#mtTo").value, $("#mtCc").value].join(",").split(/[,;\s]+/).filter(x => x.trim() && !mailList(x));
    if (bad.length) { toast(`อีเมลไม่ถูกต้อง: ${bad.join(", ")}`, "error"); return; }
    const t = cur();
    const upd = { subject: $("#mtSubject").value, html: $("#mtHtml").value, to_extra: to_extra || null, cc: cc || null, updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from("mail_templates").update(upd).eq("key", t.key).select("key");
    if (error) { toast("บันทึกไม่สำเร็จ: " + error.message, "error"); return; }
    if (!data?.length) { toast("บันทึกไม่สำเร็จ — บัญชีนี้ไม่มีสิทธิ์แก้แบบอีเมลนี้", "error"); return; }
    Object.assign(t, upd); toast("บันทึกแบบอีเมลแล้ว", "success");
  };
}
