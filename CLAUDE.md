# CLAUDE.md — Dashboard ผลวัดความดัน พขร. TPT

## กฎที่ต้องทำตามเสมอ
- **ทุกหน้าเว็บต้องมี "Made By Suwarot Thanabat L150081"** ที่ท้ายหน้า (ผู้ใช้กำหนด)
  ใน `site/index.html` อยู่ที่ `<div class="madeby">` ใต้ `<footer>` — ห้ามลบ และหน้าใหม่ต้องใส่ด้วย
- ตอบผู้ใช้เป็นภาษาไทย

## โครงสร้าง
- `data/*.xlsx` ไฟล์ต้นฉบับ (ซิงก์อัตโนมัติจากโฟลเดอร์แชร์ด้วย `tools/sync-from-share.ps1`)
- `scripts/build_data.py` แปลง Excel → `site/data.json` (GitHub Actions รันตอน deploy)
- `site/index.html` หน้า Dashboard · `site/firebase-config.js` ตัวนับผู้ใช้ online (Realtime Database ใช้ร่วมกับแอป 5ส — ห้ามแก้ rules ส่วนอื่น)
- push เข้า `main` = deploy GitHub Pages อัตโนมัติ
