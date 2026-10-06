-- ============================================================================
-- แบบอีเมลกองทุน รุ่นรองรับ Outlook classic (Windows) — 2026-10-06
-- Outlook classic ใช้ตัวแสดงผลของ Word: ไม่รองรับ padding บน <a> / inline-block / div จัดหน้า
-- และล็อกระยะบรรทัดแล้วตัดสระไทย → รุ่นนี้ใช้ตารางล้วน ปุ่มเป็นช่องตาราง ฟอนต์ Leelawadee UI / Tahoma
-- ⚠️ รันไฟล์นี้ = แทนที่แบบอีเมลกองทุนทั้ง 3 แบบ (รวมที่แก้เองในหน้าเว็บ) — ตั้งใจรันเมื่อต้องการแบบนี้เท่านั้น
-- ============================================================================
update mail_templates set html = $h$<!-- akara-fund-v3 · Outlook-safe: ตารางล้วน ปุ่มเป็นช่องตาราง ไม่ล็อกระยะบรรทัด (Outlook classic ตัดสระไทย) -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EEF2F7" style="background:#EEF2F7;">
<tr><td align="center" style="padding:28px 12px;">
 <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:560px;max-width:560px;background:#FFFFFF;border:1px solid #E2E8F0;">
  <tr><td bgcolor="#0F1C4D" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#0F1C4D;color:#FFFFFF;padding:16px 28px;font-size:14px;line-height:150%;">HR · Akara Resources</td></tr>
  <tr><td align="center" style="padding:30px 28px 6px;">
   <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td width="56" height="56" align="center" valign="middle" bgcolor="#EDE9FE" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#EDE9FE;font-size:26px;line-height:150%;border-radius:28px;">✍</td></tr></table>
  </td></tr>
  <tr><td align="center" style="padding:12px 28px 0;">
   <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td bgcolor="#EDE9FE" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#EDE9FE;color:#6D28D9;font-size:13px;font-weight:bold;line-height:150%;padding:5px 16px;border-radius:14px;">● รอท่านลงนาม</td></tr></table>
  </td></tr>
  <tr><td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:14px 36px 4px;color:#0F1C4D;font-size:22px;font-weight:bold;line-height:150%;">แบบฟอร์มกองทุนรอคณะกรรมการ<br>ลงนามอนุมัติ</td></tr>
  <tr><td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:4px 36px 22px;color:#64748B;font-size:15px;line-height:160%;">HR รับเรื่องเรียบร้อยแล้ว<br>กรุณาตรวจสอบรายละเอียดและลงนามในระบบ</td></tr>
  <tr><td style="padding:0 28px;">
   <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F8FAFC" style="background:#F8FAFC;border:1px solid #E2E8F0;"><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;color:#64748B;font-size:14px;line-height:150%;" valign="top">เลขที่คำขอ</td>
        <td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;color:#1E293B;font-size:15px;line-height:150%;"><b>{{doc_no}}</b></td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">เรื่อง</td>
        <td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;">{{kind}}</td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">พนักงาน</td>
        <td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;">{{person}}<br><span style="color:#94A3B8;font-size:13px;">รหัส {{emp_code}}</span></td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">ส่งโดย</td>
        <td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;">{{requester}}</td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">สถานะ</td>
        <td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;"><span style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#EDE9FE;color:#6D28D9;font-size:13px;font-weight:bold;">&nbsp;● รอลงนาม&nbsp;</span></td></tr></table>
  </td></tr>
  <tr><td align="center" style="padding:28px 28px 6px;">
   <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td align="center" bgcolor="#2B5AC7" style="background:#2B5AC7;border-radius:9px;padding:14px 32px;">
     <a href="{{link}}" target="_blank" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;color:#FFFFFF;text-decoration:none;font-size:16px;font-weight:bold;line-height:150%;display:block;">เปิดแบบฟอร์มเพื่อลงนาม</a></td></tr></table>
  </td></tr>
  <tr><td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 28px 0;color:#94A3B8;font-size:12px;line-height:160%;">หากปุ่มไม่ทำงาน คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์<br>
   <a href="{{link}}" target="_blank" style="color:#2B5AC7;text-decoration:underline;">{{link}}</a></td></tr>
  <tr><td style="padding:22px 28px 30px;">
   <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td bgcolor="#F5F3FF" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#F5F3FF;border-left:4px solid #6D28D9;padding:12px 16px;color:#4C1D95;font-size:13px;line-height:160%;">🔒 ต้องเข้าสู่ระบบก่อนเปิดดู<br>ลายเซ็นของท่านจะลงในแบบฟอร์มเมื่อกดอนุมัติเท่านั้น</td></tr></table>
  </td></tr>
 </table>
 <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr>
  <td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:14px 0 0;color:#94A3B8;font-size:12px;line-height:150%;">ส่งจากระบบ HR · Akara Resources · อีเมลอัตโนมัติ กรุณาอย่าตอบกลับ</td></tr></table>
</td></tr></table>$h$, updated_at = now() where key = 'fund_request';
update mail_templates set html = $h$<!-- akara-fund-v3 · Outlook-safe: ตารางล้วน ปุ่มเป็นช่องตาราง ไม่ล็อกระยะบรรทัด (Outlook classic ตัดสระไทย) -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EEF2F7" style="background:#EEF2F7;">
<tr><td align="center" style="padding:28px 12px;">
 <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:560px;max-width:560px;background:#FFFFFF;border:1px solid #E2E8F0;">
  <tr><td bgcolor="#0F1C4D" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#0F1C4D;color:#FFFFFF;padding:16px 28px;font-size:14px;line-height:150%;">HR · Akara Resources</td></tr>
  <tr><td align="center" style="padding:30px 28px 6px;">
   <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td width="56" height="56" align="center" valign="middle" bgcolor="#E6F5EE" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#E6F5EE;font-size:26px;line-height:150%;border-radius:28px;">✓</td></tr></table>
  </td></tr>
  <tr><td align="center" style="padding:12px 28px 0;">
   <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td bgcolor="#E6F5EE" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#E6F5EE;color:#0D7C4B;font-size:13px;font-weight:bold;line-height:150%;padding:5px 16px;border-radius:14px;">✓ อนุมัติแล้ว</td></tr></table>
  </td></tr>
  <tr><td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:14px 36px 4px;color:#0F1C4D;font-size:22px;font-weight:bold;line-height:150%;">คณะกรรมการกองทุน<br>ลงนามอนุมัติแล้ว</td></tr>
  <tr><td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:4px 36px 22px;color:#64748B;font-size:15px;line-height:160%;">ลงนามโดย {{approver}}</td></tr>
  <tr><td style="padding:0 28px;">
   <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F8FAFC" style="background:#F8FAFC;border:1px solid #E2E8F0;"><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;color:#64748B;font-size:14px;line-height:150%;" valign="top">เลขที่คำขอ</td>
        <td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;color:#1E293B;font-size:15px;line-height:150%;"><b>{{doc_no}}</b></td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">เรื่อง</td>
        <td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;">{{kind}}</td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">พนักงาน</td>
        <td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;">{{person}}<br><span style="color:#94A3B8;font-size:13px;">รหัส {{emp_code}}</span></td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">สถานะ</td>
        <td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;"><span style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#E6F5EE;color:#0D7C4B;font-size:13px;font-weight:bold;">&nbsp;✓ อนุมัติแล้ว&nbsp;</span></td></tr></table>
  </td></tr>
  <tr><td align="center" style="padding:28px 28px 6px;">
   <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td align="center" bgcolor="#2B5AC7" style="background:#2B5AC7;border-radius:9px;padding:14px 32px;">
     <a href="{{link}}" target="_blank" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;color:#FFFFFF;text-decoration:none;font-size:16px;font-weight:bold;line-height:150%;display:block;">เปิดแบบฟอร์ม</a></td></tr></table>
  </td></tr>
  <tr><td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 28px 0;color:#94A3B8;font-size:12px;line-height:160%;">หากปุ่มไม่ทำงาน คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์<br>
   <a href="{{link}}" target="_blank" style="color:#2B5AC7;text-decoration:underline;">{{link}}</a></td></tr>
  <tr><td style="padding:22px 28px 30px;">
   <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td bgcolor="#F5F3FF" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#F5F3FF;border-left:4px solid #6D28D9;padding:12px 16px;color:#4C1D95;font-size:13px;line-height:160%;">พิมพ์แบบฟอร์มที่มีลายเซ็นครบได้จากหน้าแบบฟอร์มกองทุน แล้วดำเนินการส่งบริษัทจัดการกองทุนต่อ</td></tr></table>
  </td></tr>
 </table>
 <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr>
  <td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:14px 0 0;color:#94A3B8;font-size:12px;line-height:150%;">ส่งจากระบบ HR · Akara Resources · อีเมลอัตโนมัติ กรุณาอย่าตอบกลับ</td></tr></table>
</td></tr></table>$h$, updated_at = now() where key = 'fund_approved';
update mail_templates set html = $h$<!-- akara-fund-v3 · Outlook-safe: ตารางล้วน ปุ่มเป็นช่องตาราง ไม่ล็อกระยะบรรทัด (Outlook classic ตัดสระไทย) -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EEF2F7" style="background:#EEF2F7;">
<tr><td align="center" style="padding:28px 12px;">
 <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:560px;max-width:560px;background:#FFFFFF;border:1px solid #E2E8F0;">
  <tr><td bgcolor="#0F1C4D" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#0F1C4D;color:#FFFFFF;padding:16px 28px;font-size:14px;line-height:150%;">HR · Akara Resources</td></tr>
  <tr><td align="center" style="padding:30px 28px 6px;">
   <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td width="56" height="56" align="center" valign="middle" bgcolor="#FDECEA" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#FDECEA;font-size:26px;line-height:150%;border-radius:28px;">↩</td></tr></table>
  </td></tr>
  <tr><td align="center" style="padding:12px 28px 0;">
   <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td bgcolor="#FDECEA" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#FDECEA;color:#C0392B;font-size:13px;font-weight:bold;line-height:150%;padding:5px 16px;border-radius:14px;">↩ ส่งกลับ</td></tr></table>
  </td></tr>
  <tr><td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:14px 36px 4px;color:#0F1C4D;font-size:22px;font-weight:bold;line-height:150%;">กรรมการส่งแบบฟอร์ม<br>กลับมาให้ HR</td></tr>
  <tr><td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:4px 36px 22px;color:#64748B;font-size:15px;line-height:160%;">โดย {{approver}}</td></tr>
  <tr><td style="padding:0 28px;">
   <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F8FAFC" style="background:#F8FAFC;border:1px solid #E2E8F0;"><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;color:#64748B;font-size:14px;line-height:150%;" valign="top">เลขที่คำขอ</td>
        <td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;color:#1E293B;font-size:15px;line-height:150%;"><b>{{doc_no}}</b></td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">เรื่อง</td>
        <td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;">{{kind}}</td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">พนักงาน</td>
        <td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;">{{person}}<br><span style="color:#94A3B8;font-size:13px;">รหัส {{emp_code}}</span></td></tr><tr><td width="120" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;line-height:150%;" valign="top">เหตุผล</td>
        <td style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 18px;border-top:1px solid #E2E8F0;color:#1E293B;font-size:15px;line-height:150%;"><span style="color:#C0392B;">{{reason}}</span></td></tr></table>
  </td></tr>
  <tr><td align="center" style="padding:28px 28px 6px;">
   <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td align="center" bgcolor="#2B5AC7" style="background:#2B5AC7;border-radius:9px;padding:14px 32px;">
     <a href="{{link}}" target="_blank" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;color:#FFFFFF;text-decoration:none;font-size:16px;font-weight:bold;line-height:150%;display:block;">เปิดแบบฟอร์ม</a></td></tr></table>
  </td></tr>
  <tr><td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:12px 28px 0;color:#94A3B8;font-size:12px;line-height:160%;">หากปุ่มไม่ทำงาน คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์<br>
   <a href="{{link}}" target="_blank" style="color:#2B5AC7;text-decoration:underline;">{{link}}</a></td></tr>
  <tr><td style="padding:22px 28px 30px;">
   <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td bgcolor="#F5F3FF" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;background:#F5F3FF;border-left:4px solid #6D28D9;padding:12px 16px;color:#4C1D95;font-size:13px;line-height:160%;">แก้ไขตามเหตุผลแล้วส่งให้กรรมการลงนามใหม่ได้จากหน้าแบบฟอร์มกองทุน</td></tr></table>
  </td></tr>
 </table>
 <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr>
  <td align="center" style="font-family:'Leelawadee UI',Leelawadee,Tahoma,Arial,sans-serif;padding:14px 0 0;color:#94A3B8;font-size:12px;line-height:150%;">ส่งจากระบบ HR · Akara Resources · อีเมลอัตโนมัติ กรุณาอย่าตอบกลับ</td></tr></table>
</td></tr></table>$h$, updated_at = now() where key = 'fund_rejected';
