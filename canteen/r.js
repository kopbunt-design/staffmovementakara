// หน้าสหกรณ์เปิดใบแจ้งยอดจากลิงก์ในเมล (ไม่ต้อง login) · พิมพ์/PDF/Excel รายชื่อ · user 2026-11-26 · ห้าม import js/app.js
import { supabase } from "../js/supabase-config.js";
import { noticeDoc, namesWorkbook, DOC_CSS, dTH } from "./doc.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const token = new URLSearchParams(location.search).get("t") || "";
history.replaceState(null, "", location.pathname + "?t=" + encodeURIComponent(token));

const st = document.createElement("style"); st.textContent = DOC_CSS; document.head.appendChild(st);
const fail = (t, d) => { $("#sub").textContent = ""; $("#docs").innerHTML = `<div class="msg"><div style="font-size:42px">⚠️</div><h2>${esc(t)}</h2><p>${esc(d)}</p></div>`; };

(async () => {
  const { data, error } = await supabase.rpc("cn_link_get", { p_token: token });
  if (error || !data || data.error) return fail("เปิดใบไม่ได้", error ? "ลองใหม่อีกครั้ง หรือติดต่อฝ่ายบุคคล" : data?.error || "ลิงก์ไม่ถูกต้อง");
  if (!data.notices.length) return fail("ยังไม่มีใบของวันนี้", "ใบอาจถูกยกเลิกเพื่อแก้ไข — ฝ่ายบุคคลจะส่งใหม่");
  $("#ttl").textContent = `ใบแจ้งยอดร้านค้า · วันที่ทาน ${dTH(data.d)}`;
  $("#sub").textContent = `${data.notices.length} ใบ · ลงนามอิเล็กทรอนิกส์โดยฝ่ายบุคคล Akara Resources`;
  $("#sum").innerHTML = data.notices.map(n => `<div><small>${esc(n.doc_no)} · ${esc(n.unit === "CN" ? "Chatree North" : n.label)}</small><b>฿${money(n.amount)}</b>
    <span> · ${n.meals.toLocaleString("en-US")} อิ่ม</span></div>`).join("");
  $("#docs").innerHTML = `<div class="cnd">${data.notices.map(n => noticeDoc(n, data.art)).join("")}</div>`;
  document.title = `ใบแจ้งยอดร้านค้า ${data.d}`;
  $("#bP").hidden = $("#bX").hidden = false;
  $("#bP").onclick = () => print();
  $("#bX").onclick = () => XLSX.writeFile(namesWorkbook(data.notices), `รายชื่อทานอาหาร ${data.d}.xlsx`);
})();
