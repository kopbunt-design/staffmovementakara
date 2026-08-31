import { supabase } from "./supabase-config.js";
import { allEmployees, esc, toast } from "./app.js";

// ============================================================================
// นำเข้าสายบังคับบัญชาเป็นชุด (600 คนกรอกทีละคนในฟอร์มไม่ไหว)
//
// ไฟล์แยกต่างหาก ไม่ใช่ไฟล์ import พนักงานปกติ — เขียนเฉพาะช่อง manager_code
// จึงไม่มีทางเผลอทับข้อมูลอื่น (ชีต Stafflist ต้นทางมี 229 คอลัมน์ ถ้าให้ไปเติมช่องเดียว
// ในนั้นต้องเลื่อนขวาผ่าน 200 กว่าคอลัมน์ พลาดง่ายมาก)
//
// ⚠️ ตรวจให้ครบก่อนเขียนเสมอ — ถ้าปล่อยให้ batch ล้มกลางทางเพราะ trigger กันวงกลม
//    จะเสียทั้งก้อน 600 แถว ไม่รู้ว่าเขียนไปถึงไหนแล้ว
// ============================================================================

const norm = s => String(s ?? "").replace(/\s+/g, " ").trim();
const key  = s => norm(s).toLowerCase();
const isActive = e => !e.status || e.status === "Active";
const fullTH = e => norm(`${e.firstname_th||""} ${e.lastname_th||""}`);
const fullEN = e => norm(`${e.firstname_en||""} ${e.lastname_en||""}`);

// ---------- ฟอร์มเปล่า ----------
// ใส่ข้อมูลคนให้แล้ว เหลือช่องหัวหน้าว่างช่องเดียว · เอาเฉพาะคนที่ยังทำงานอยู่
// คนพ้นสภาพไม่ต้องมีหัวหน้า และถ้าใส่มาในฟอร์มจะทำให้คนกรอกสับสนว่าต้องกรอกด้วยไหม
export function downloadTemplate() {
  if(!window.XLSX){ toast("กรุณารอโหลด library","error"); return; }
  const act = allEmployees.filter(isActive)
    .sort((a,b) => (a.division||"").localeCompare(b.division||"")
                || (a.department||"").localeCompare(b.department||"")
                || (a.emp_code||"").localeCompare(b.emp_code||""));
  const h = ["รหัสพนักงาน","ชื่อ-นามสกุล","Division","Department","Section","ตำแหน่ง","ระดับ","หัวหน้าโดยตรง (กรอกช่องนี้)"];
  const rows = act.map(e => [e.emp_code, fullTH(e), e.division||"", e.department||"",
                             e.section||"", e.position||"", e.job_level||"",
                             e.manager_code ? codeToName(e.manager_code) : ""]);
  const ws = window.XLSX.utils.aoa_to_sheet([h, ...rows]);
  ws["!cols"] = [{wch:15},{wch:26},{wch:16},{wch:22},{wch:18},{wch:30},{wch:8},{wch:30}];
  ws["!freeze"] = { xSplit:2, ySplit:1 };
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "สายบังคับบัญชา");
  window.XLSX.writeFile(wb, `reporting_line_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast(`สร้างฟอร์มแล้ว ${rows.length} คน (เฉพาะที่ยังทำงานอยู่)`, "success");
}
const codeToName = c => {
  const m = allEmployees.find(e => e.emp_code === c);
  return m ? `${c} — ${fullTH(m)}` : c;
};

// ---------- แปลงค่าในช่องหัวหน้าเป็น emp_code ----------
// รับได้ทั้ง "AKR17030070" · "สมชาย ภูวเดช" · "AKR17030070 — สมชาย ภูวเดช" (ที่ฟอร์มใส่มาให้)
function resolveManager(raw) {
  const v = norm(raw);
  if(!v) return { code:null };

  // เทียบกับรหัสที่มีจริงในระบบ ไม่ใช้ regex เดารูปแบบรหัส
  // (ถ้าบริษัทเปลี่ยนรูปแบบรหัสวันหลัง regex จะพังเงียบ ๆ แบบไม่มีใครรู้)
  const byCode = c => allEmployees.find(e => key(e.emp_code) === key(c));

  const exact = byCode(v);
  if(exact) return { code:exact.emp_code };

  // รูปแบบ "รหัส — ชื่อ" ที่ฟอร์มใส่มาให้ · ลองทุก token เผื่อคนสลับลำดับ
  for(const tok of v.split(/[\s—–-]+/).filter(Boolean)){
    const hit = byCode(tok);
    if(hit) return { code:hit.emp_code };
  }

  // ไม่ใช่รหัส -> จับจากชื่อ (ไทยก่อน แล้วอังกฤษ)
  const hits = allEmployees.filter(e => key(fullTH(e)) === key(v) || key(fullEN(e)) === key(v));
  if(hits.length === 1) return { code:hits[0].emp_code };
  if(hits.length === 0) return { error:`ไม่พบพนักงานหรือรหัส "${v}" ในระบบ` };
  return { error:`ชื่อ "${v}" ซ้ำกัน ${hits.length} คน (${hits.map(h=>h.emp_code).join(", ")}) — ใส่รหัสแทนชื่อ` };
}

// ---------- ตรวจทั้งไฟล์ ----------
// คืน { rows, ok, blocked, warned } — ยังไม่เขียนอะไรลง DB
export function validate(sheetRows) {
  const byCode = Object.fromEntries(allEmployees.map(e => [e.emp_code, e]));
  const LEVEL = { O1:1,O2:2,O3:3, S1:4,S2:5,S3:6, M1:7,M2:8,M3:9,M4:10 };
  const rank = lv => LEVEL[String(lv||"").toUpperCase().trim()] ?? null;

  // ผลลัพธ์ที่จะเกิดขึ้นถ้าเขียนไฟล์นี้ลงไป = ของเดิมใน DB + ที่ไฟล์กำหนดทับ
  // ต้องมองรวมกันถึงจะตรวจวงกลมได้ถูก (ไฟล์อาจสร้างวงร่วมกับข้อมูลเดิม)
  const nextMgr = Object.fromEntries(allEmployees.map(e => [e.emp_code, e.manager_code || null]));

  const out = [];
  for(const [i, r] of sheetRows.entries()) {
    const code = norm(r["รหัสพนักงาน"] ?? r["Employee Code"] ?? r["รหัส"] ?? "");
    const rawM = r["หัวหน้าโดยตรง (กรอกช่องนี้)"] ?? r["หัวหน้าโดยตรง"] ?? r["Manager"] ?? r["ผู้บังคับบัญชา"] ?? "";
    const row = { line:i+2, code, raw:norm(rawM), mgr:null, level:null, msgs:[] };
    const add = (lvl, msg) => { row.msgs.push({lvl, msg}); if(lvl==="block") row.level="block";
                                else if(row.level!=="block") row.level="warn"; };

    if(!code){ continue; }                       // แถวว่าง ข้ามเงียบ ๆ
    const self = byCode[code];
    if(!self){ add("block", `ไม่พบรหัสพนักงาน "${code}" ในระบบ`); out.push(row); continue; }
    row.name = fullTH(self);
    if(!row.raw){ continue; }                    // ไม่ได้กรอกหัวหน้า = ข้าม ไม่ใช่ error

    // คนพ้นสภาพไม่ต้องมีหัวหน้า
    if(!isActive(self)) add("warn", `พนักงานคนนี้สถานะ ${self.status} แล้ว — ปกติไม่ต้องกรอกหัวหน้า`);

    const res = resolveManager(row.raw);
    if(res.error){ add("block", res.error); out.push(row); continue; }
    row.mgr = res.code;
    const m = byCode[row.mgr];

    if(row.mgr === code){ add("block", "เป็นหัวหน้าตัวเองไม่ได้"); out.push(row); continue; }
    // หัวหน้าที่ลาออกไปแล้ว — ผังจะชี้ไปหาคนที่ไม่อยู่แล้ว
    if(!isActive(m)) add("block", `หัวหน้า ${m.emp_code} สถานะ ${m.status} แล้ว — เลือกคนที่ยังทำงานอยู่`);

    const rm = rank(m.job_level), rs = rank(self.job_level);
    if(rm != null && rs != null && rm < rs)
      add("warn", `หัวหน้าระดับ ${m.job_level} ต่ำกว่าลูกน้องระดับ ${self.job_level}`);
    if(self.division && m.division && self.division !== m.division)
      add("warn", `หัวหน้าอยู่คนละ Division (${m.division})`);

    if(!row.level) nextMgr[code] = row.mgr;      // ผ่านแล้วค่อยใส่ลงกราฟ
    row.mgrName = fullTH(m);
    out.push(row);
  }

  // ตรวจวงกลมบนกราฟรวม หลังใส่ครบทุกแถวแล้ว
  for(const row of out){
    if(row.level === "block" || !row.mgr) continue;
    let cur = row.mgr, hops = 0, path = [row.code];
    while(cur && hops < 100){
      path.push(cur);
      if(cur === row.code){
        row.level = "block";
        row.msgs.push({ lvl:"block", msg:`สายวนเป็นวงกลม: ${path.join(" → ")}` });
        nextMgr[row.code] = allEmployees.find(e=>e.emp_code===row.code)?.manager_code || null;
        break;
      }
      cur = nextMgr[cur]; hops++;
    }
  }

  const changed = out.filter(r => r.mgr && r.level !== "block");
  return {
    rows: out,
    ok: changed.length,
    blocked: out.filter(r => r.level === "block").length,
    warned: out.filter(r => r.level === "warn").length,
    payload: changed.map(r => ({ emp_code:r.code, manager_code:r.mgr })),
  };
}

// ---------- เขียนลง DB ----------
// เขียนเฉพาะ manager_code · แถวที่ block ถูกตัดออกไปแล้วตั้งแต่ validate
export async function commit(payload) {
  let done = 0;
  for(let i = 0; i < payload.length; i += 200){
    const chunk = payload.slice(i, i + 200);
    // upsert ต้องมีคอลัมน์อื่นครบ ไม่งั้นจะถูกล้าง — ใช้ update ทีละคนแทนเพื่อความปลอดภัย
    const results = await Promise.all(chunk.map(p =>
      supabase.from("employees").update({ manager_code:p.manager_code, updated_at:new Date().toISOString() })
        .eq("emp_code", p.emp_code)));
    const bad = results.find(r => r.error);
    if(bad?.error) throw new Error(bad.error.message);
    done += chunk.length;
  }
  return done;
}

// ============================================================================
// หน้าจอ — ดาวน์โหลดฟอร์ม → อัปโหลด → ดูผลตรวจ → ยืนยัน
// ตั้งใจให้เห็นผลตรวจก่อนเขียนเสมอ ไม่มีปุ่มอัปแล้วเขียนเลย
// ============================================================================
export function openDialog() {
  const el = document.createElement("div");
  el.className = "modal-overlay"; el.id = "rlModal";
  el.innerHTML = `<div class="modal modal-lg">
    <div class="modal-header">
      <div class="modal-title">นำเข้าสายบังคับบัญชา</div>
      <button class="modal-close" onclick="document.getElementById('rlModal').remove()">✕</button>
    </div>
    <div class="modal-body" id="rlBody">
      <div class="rl-steps">
        <div class="rl-step">
          <div class="rl-num">1</div>
          <div>
            <div class="rl-h">ดาวน์โหลดฟอร์ม</div>
            <div class="rl-d">ได้ไฟล์ที่มีรหัส ชื่อ แผนก ตำแหน่ง ระดับ ครบแล้ว เหลือช่องหัวหน้าให้เติม<br>
              <b>เฉพาะพนักงานที่ยังทำงานอยู่</b> — คนพ้นสภาพไม่ต้องกรอก</div>
            <button class="btn btn-secondary" style="margin-top:9px;" onclick="window._rlTemplate()">📄 ดาวน์โหลดฟอร์ม</button>
          </div>
        </div>
        <div class="rl-step">
          <div class="rl-num">2</div>
          <div>
            <div class="rl-h">ให้หัวหน้าแผนกช่วยกันเติม</div>
            <div class="rl-d">ช่องหัวหน้าใส่ได้ทั้ง <b>รหัส</b> (AKR17030001) หรือ <b>ชื่อ-นามสกุล</b> (สมชาย ภูวเดช)<br>
              ถ้าชื่อซ้ำกันหลายคน ระบบจะบอกให้ใส่รหัสแทน</div>
          </div>
        </div>
        <div class="rl-step">
          <div class="rl-num">3</div>
          <div>
            <div class="rl-h">อัปโหลดกลับมาตรวจ</div>
            <div class="rl-d">ระบบตรวจให้ครบก่อน แล้วค่อยให้กดยืนยัน — ยังไม่เขียนอะไรตอนอัปโหลด</div>
            <label class="btn btn-gold" style="margin-top:9px;">📤 เลือกไฟล์
              <input type="file" accept=".xlsx,.xls" style="display:none;" onchange="window._rlUpload(this)">
            </label>
          </div>
        </div>
      </div>
    </div>
  </div>`;
  document.getElementById("modalPortal").appendChild(el);

  window._rlTemplate = downloadTemplate;
  window._rlUpload = input => {
    const f = input.files?.[0]; if(!f) return;
    if(!window.XLSX){ toast("กรุณารอโหลด library","error"); return; }
    const rd = new FileReader();
    rd.onload = ev => {
      try {
        const wb = window.XLSX.read(ev.target.result, { type:"binary" });
        const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval:"" });
        if(!rows.length){ toast("ไฟล์ว่าง ไม่มีข้อมูล","error"); return; }
        showReport(validate(rows));
      } catch(e){ console.error(e); toast("อ่านไฟล์ไม่ได้: "+e.message,"error"); }
      finally { input.value = ""; }
    };
    rd.readAsBinaryString(f);
  };
}

function showReport(res) {
  const body = document.getElementById("rlBody"); if(!body) return;
  const bad  = res.rows.filter(r => r.level === "block");
  const warn = res.rows.filter(r => r.level === "warn");
  const list = (arr, cls) => arr.map(r => `
    <div class="rl-row ${cls}">
      <div class="rl-line">แถว ${r.line}</div>
      <div>
        <div class="rl-who"><b>${esc(r.code)}</b> ${esc(r.name||"")}
          ${r.mgr?`<span class="rl-arrow">→</span> ${esc(r.mgrName||r.mgr)}`:""}</div>
        ${r.msgs.map(m=>`<div class="rl-msg">${esc(m.msg)}</div>`).join("")}
      </div>
    </div>`).join("");

  body.innerHTML = `
    <div class="rl-sum">
      <div class="rl-stat ok"><b>${res.ok}</b><span>พร้อมบันทึก</span></div>
      <div class="rl-stat ${res.blocked?"bad":""}"><b>${res.blocked}</b><span>ต้องแก้ก่อน</span></div>
      <div class="rl-stat ${res.warned?"warn":""}"><b>${res.warned}</b><span>เตือน (บันทึกได้)</span></div>
    </div>
    ${res.blocked?`<div class="rl-note bad">แถวที่ต้องแก้จะ<b>ไม่ถูกบันทึก</b> — แก้ในไฟล์แล้วอัปใหม่ได้ ส่วนแถวที่เหลือบันทึกได้เลย</div>`:""}
    ${bad.length?`<div class="rl-sec">ต้องแก้ก่อน (${bad.length})</div><div class="rl-list">${list(bad,"bad")}</div>`:""}
    ${warn.length?`<div class="rl-sec">เตือน — บันทึกได้แต่ควรดูอีกที (${warn.length})</div><div class="rl-list">${list(warn,"warn")}</div>`:""}
    ${!res.ok?`<div class="rl-note">ไม่มีแถวไหนบันทึกได้เลย</div>`:""}
    <div class="modal-footer" style="padding:16px 0 0;border:none;">
      <button class="btn btn-secondary" onclick="document.getElementById('rlModal').remove()">ยกเลิก</button>
      <button class="btn btn-primary" id="rlGo" ${res.ok?"":"disabled"}>
        บันทึก ${res.ok} รายการ</button>
    </div>`;

  document.getElementById("rlGo")?.addEventListener("click", async ev => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = "กำลังบันทึก…";
    try {
      const n = await commit(res.payload);
      toast(`บันทึกสายบังคับบัญชา ${n} รายการแล้ว`, "success");
      document.getElementById("rlModal")?.remove();
      const { renderEmployees } = await import("./employees.js");
      const { loadEmployees } = await import("./app.js");
      if(loadEmployees) await loadEmployees();
      renderEmployees();
    } catch(e){
      b.disabled = false; b.textContent = `บันทึก ${res.ok} รายการ`;
      toast("บันทึกไม่สำเร็จ: " + e.message, "error");
    }
  });
}
