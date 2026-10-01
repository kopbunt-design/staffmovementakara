# ตั้งค่าอีเมลอัตโนมัติของระบบออกหนังสือ HR (สำหรับ IT)

ระบบออกหนังสือ HR ส่งอีเมลขออนุมัติไปหา HR Manager และแจ้งผลกลับหา HR ผ่าน **Microsoft 365 (Microsoft Graph)**
ระหว่างที่ยังไม่ได้ตั้งค่า ระบบยังใช้งานได้ปกติ — แจ้งเตือนในเว็บแทน (กระดิ่ง + แท็บ "รออนุมัติ")

## 1. ลงทะเบียนแอปใน Microsoft Entra ID (ทำครั้งเดียว · ต้องเป็น admin ของ tenant)
1. Entra admin center → App registrations → **New registration** · ชื่อ `HR System Mailer` · Single tenant
2. API permissions → Add → Microsoft Graph → **Application permissions** → `Mail.Send` → **Grant admin consent**
3. Certificates & secrets → **New client secret** → จดค่า Value ไว้
4. จด **Directory (tenant) ID** และ **Application (client) ID** จากหน้า Overview
5. (แนะนำ) จำกัดให้แอปส่งได้จากกล่องเดียว ด้วย Exchange Online PowerShell:
   `New-ApplicationAccessPolicy -AppId <client id> -PolicyScopeGroupId <กลุ่มที่มีกล่องผู้ส่ง> -AccessRight RestrictAccess`

## 2. ใส่ค่าใน Supabase
Supabase Dashboard → Edge Functions → Secrets → เพิ่ม:

| ชื่อ | ค่า |
|---|---|
| `MS_TENANT_ID` | Directory (tenant) ID |
| `MS_CLIENT_ID` | Application (client) ID |
| `MS_CLIENT_SECRET` | client secret ข้อ 1.3 |
| `MS_SENDER` | กล่องผู้ส่ง เช่น `hr-system@akararesources.com` |
| `APP_URL` | `https://staffmovementakara.vercel.app` |

## 3. Deploy function
```
supabase functions deploy letter-notify
```

## ทดสอบ
ออกหนังสือ 1 ฉบับ → ส่งขออนุมัติ → ข้อความยืนยันต้องขึ้นว่า "ส่งอีเมลถึง … แล้ว"
ในอีเมล **ไม่มีตัวเลขเงินเดือน** — มีแค่เลขที่ ประเภท ชื่อผู้รับ และลิงก์ให้ login เข้าไปดู
