// ------------------------------------------------------------------
//  ตั้งค่า Firebase สำหรับตัวนับ "กำลังดูอยู่ X คน"
//  ค่าเหล่านี้เป็นค่าสาธารณะของเว็บแอป (ไม่ใช่รหัสลับ) — ความปลอดภัยคุมด้วย Realtime Database Rules
//
//  โปรเจกต์: test-stock-78d08 (ใช้ร่วมกับ Stock Control แต่เก็บใน Realtime Database แยกจาก Firestore)
//  ต้องสร้าง Realtime Database ในโปรเจกต์ก่อน (Build → Realtime Database → Create Database → Singapore)
//  ถ้าสร้างคนละ region ให้คัดลอก URL จากหน้า Realtime Database มาใส่ databaseURL แทน
//
//  ถ้าตั้งเป็น null ตัวนับจะซ่อนไป ส่วนอื่นของ Dashboard ใช้งานได้ปกติ
// ------------------------------------------------------------------
window.BP_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCZLsMItVmvKTBi459M1-zud_cDnCuyc6w",
  authDomain: "test-stock-78d08.firebaseapp.com",
  databaseURL: "https://test-stock-78d08-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "test-stock-78d08",
  storageBucket: "test-stock-78d08.firebasestorage.app",
  messagingSenderId: "652986400051",
  appId: "1:652986400051:web:4346884cfb97b514fe9246"
};

// ตำแหน่งที่เก็บข้อมูลในฐานข้อมูล
window.BP_PRESENCE_PATH = 'bp-dashboard/presence';
