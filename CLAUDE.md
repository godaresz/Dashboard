# CLAUDE.md — Dashboard ผลวัดความดัน พขร. TPT

## กฎที่ต้องทำตามเสมอ
- **ทุกหน้าเว็บต้องมี "Made By Suwarot Thanabat L150081"** (ผู้ใช้กำหนด)
  ใน `site/index.html` คือ `<div class="madeby">` **ค้างมุมซ้ายบน (position:fixed) ตลอดแม้เลื่อนหน้า** — ห้ามลบ หน้าใหม่ต้องใส่แบบเดียวกัน
- ตอบผู้ใช้เป็นภาษาไทย

## โครงสร้าง
- `data/*.xlsx` ไฟล์ต้นฉบับ (ซิงก์อัตโนมัติจากโฟลเดอร์แชร์ด้วย `tools/sync-from-share.ps1`)
- `scripts/build_data.py` แปลง Excel → `site/data.json` (GitHub Actions รันตอน deploy)
- `site/index.html` หน้า Dashboard · `site/firebase-config.js` ตัวนับผู้ใช้ online (Realtime Database ใช้ร่วมกับแอป 5ส — ห้ามแก้ rules ส่วนอื่น)
- `site/notes.js` หมายเหตุรายบุคคล + ภาพแนบ (RTDB `bp-dashboard/notes`, `noteImages`, `editors`) · เขียนได้เฉพาะ UID ใน `editors` · Rules อยู่ใน README
  ต้องใช้แพลนฟรี (Spark) ได้เสมอ — ห้ามใช้ Firebase Storage (ต้อง Blaze) · แก้ notes.js แล้ว BUILD_ID เปลี่ยนเอง (workflow hash รวมไฟล์นี้)
- push เข้า `main` = deploy GitHub Pages อัตโนมัติ
