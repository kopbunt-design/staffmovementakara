#!/bin/sh
# สร้างแพ็กเกจสำหรับอัปโหลดขึ้น App Service akarahr2 → azure-app/dist.zip
# ใส่โปรแกรม Python + หน้าเว็บชุดเดิม (ไม่มีไฟล์ SQL / เทส / Edge Function / รหัสใด ๆ)
set -e
cd "$(dirname "$0")"
rm -rf dist dist.zip && mkdir -p dist/site
cp app.py db.py rest.py rpc.py hooks.py mail.py storage.py tables.json schema_full.sql security_rules.json requirements.txt dist/
for p in index.html fund.html vercel.json assets css js expense uniform contract sub docs econtract paf payroll; do
  [ -e "../$p" ] && cp -R "../$p" dist/site/
done
cp ../js/supabase-config.js dist/site/js/supabase-direct.js   # ตัวต่อ Supabase เดิม — ใช้เฉพาะหน้าย้ายข้อมูล /migrate/
cp -R web/. dist/site/      # หน้าที่มีเฉพาะบน Azure (/migrate/) + js/supabase-config.js รุ่น Azure ทับของเดิม
find dist -name .DS_Store -delete
(cd dist && zip -qr ../dist.zip .)
echo "dist.zip ready: $(du -h dist.zip | cut -f1)"
