// ------------------------------------------------------------------
//  ตั้งค่า Firebase สำหรับตัวนับ "กำลังดูอยู่ X คน"
//  ค่าเหล่านี้เป็นค่าสาธารณะของเว็บแอป (ไม่ใช่รหัสลับ) — ความปลอดภัยคุมด้วย Realtime Database Rules
//
//  หาค่าได้ที่: Firebase Console → เลือกโปรเจกต์ → ⚙️ Project settings → General
//               → Your apps → (เว็บแอป </>) → SDK setup and configuration → Config
//  ต้องมี databaseURL (เปิด Realtime Database ในโปรเจกต์ก่อน)
//
//  ถ้าปล่อยเป็น null ตัวนับจะซ่อนไป ส่วนอื่นของ Dashboard ใช้งานได้ปกติ
// ------------------------------------------------------------------
window.BP_FIREBASE_CONFIG = null;
/* ตัวอย่าง:
window.BP_FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "your-project",
  appId: "1:1234567890:web:abcdef"
};
*/

// ตำแหน่งที่เก็บข้อมูลในฐานข้อมูล (แยกจากข้อมูลของแอปอื่น เช่น 5ส)
window.BP_PRESENCE_PATH = 'bp-dashboard/presence';
