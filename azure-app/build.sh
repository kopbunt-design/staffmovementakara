#!/bin/sh
# สร้างแพ็กเกจสำหรับอัปโหลดขึ้น App Service akarahr2 → azure-app/dist.zip
# ใส่โปรแกรม Python + หน้าเว็บชุดเดิม (ไม่มีไฟล์ SQL / เทส / Edge Function / รหัสใด ๆ)
set -e
cd "$(dirname "$0")"
rm -rf dist dist.zip && mkdir -p dist/site
cp app.py requirements.txt dist/
for p in index.html fund.html vercel.json assets css js expense uniform contract sub docs econtract paf payroll; do
  [ -e "../$p" ] && cp -R "../$p" dist/site/
done
find dist -name .DS_Store -delete
(cd dist && zip -qr ../dist.zip .)
echo "dist.zip ready: $(du -h dist.zip | cut -f1)"
