# ตั้งค่าการส่งอีเมลของระบบออกหนังสือ HR

มี 2 โหมด เลือกได้ที่ **ออกหนังสือ HR → ตั้งค่า → การส่งอีเมล** (เฉพาะผู้มีสิทธิ์อนุมัติหนังสือ)

| โหมด | ทำงานอย่างไร | ต้องตั้งอะไร |
|---|---|---|
| **เปิดใน Outlook** (ค่าเริ่มต้น) | ตอนส่งขออนุมัติ/อนุมัติ/ส่งกลับ เว็บดาวน์โหลดไฟล์เมล (.eml) → เปิดไฟล์ Outlook ขึ้นเมลที่เขียนไว้แล้ว กด Send | ไม่ต้องตั้งอะไร |
| **ส่งอัตโนมัติจากอีเมลกลาง** | ส่งจากอีเมลกลางผ่าน Microsoft 365 ทันที ไม่ต้องเปิด Outlook | ข้อ 1–2 ด้านล่าง |

## 1. Deploy ฟังก์ชันส่งเมล (ครั้งเดียว)
Supabase Dashboard → **Edge Functions** → **Deploy a new function** → **Via Editor**
→ ตั้งชื่อ `letter-notify` → วางโค้ดจาก `supabase/functions/letter-notify/index.ts` ทั้งไฟล์ → **Deploy**
(ไม่ต้องตั้ง Secrets ใน Supabase — ค่าทั้งหมดกรอกในหน้าเว็บ)

## 2. กรอกค่าในหน้าเว็บ
ใช้ค่าเดียวกับที่ TigerSoft ใช้ส่งเมลได้ (ตั้งค่าการส่งเมล → TenantID / ClientID / ClientSecret / From)

- **Tenant ID**, **Client ID**, **Client Secret**, **อีเมลผู้ส่ง (From)** เช่น `hr.online@akararesources.com`
- เลือก **ส่งอัตโนมัติจากอีเมลกลาง** → บันทึก → กด **ทดสอบส่งเมล (ถึงตัวเอง)**

Client Secret เก็บแยกในระบบ อ่านกลับออกมาไม่ได้แม้ผู้ดูแล ใช้ได้เฉพาะตอนส่งเมล

ถ้าทดสอบไม่ผ่าน:
- "Tenant/Client ID/Secret ไม่ถูกต้อง" → secret หมดอายุหรือพิมพ์ผิด (ให้ IT สร้างใหม่ใน Entra ID → App registrations → Certificates & secrets)
- "อีเมลผู้ส่งไม่ถูกต้อง หรือแอปไม่มีสิทธิ์ Mail.Send" → แอปต้องมีสิทธิ์ Microsoft Graph `Mail.Send` แบบ **Application** และได้ admin consent

## แบบอีเมล
แก้หัวเรื่องและเนื้อหา (HTML) ได้ในหน้าเดียวกัน มีตัวอย่างให้ดูทันที
ตัวแปร: `{{doc_no}}` `{{kind}}` `{{person}}` `{{emp_code}}` `{{link}}` `{{reason}}` `{{requester}}` `{{approver}}`
ในเมลไม่มีตัวเลขเงินเดือน — มีแค่ลิงก์ให้ login เข้าไปดูหนังสือ
