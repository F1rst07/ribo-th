# Changelog — ประวัติเวอร์ชัน RIBO-TH

เอกสารบันทึกการเปลี่ยนแปลงและประวัติเวอร์ชันของโครงการ สามารถย้อนกลับไปยังเวอร์ชันใดก็ได้ผ่าน Git Tags

---

## [v0.1.0] - 2026-10-31 (Phase 2)
### Added
- ย้ายโครงสร้างโปรเจกต์สู่ **Next.js (App Router + TypeScript)** ตามคำแนะนำใน `README.md`
- จัดเก็บไอคอน Lucide `refresh-ccw.svg` ในเครื่อง (Local Asset) พร้อมไฟล์ลิขสิทธิ์ ISC License ไม่พึ่งพา CDN ภายนอก
- ปรับปรุงการแสดงผลแบบ Responsive เต็มรูปแบบ รองรับทั้งมือถือ (300px+), แท็บเล็ต และเดสก์ท็อป พร้อม Mobile Safe Area Inset
- แสดงป้ายกำกับเวอร์ชัน `v0.1.0` บนหน้าเว็บแบบ Minimal Industrial
- Deploy ขึ้น **Vercel** สำเร็จบนโดเมน [https://ribo-th.vercel.app](https://ribo-th.vercel.app)

---

## [v0.0.1] - 2026-10-31 (Phase 1)
### Added
- หน้า Under Construction แบบ Static HTML ในโฟลเดอร์ `dist/index.html`
- เอกสารคู่มือระบบ `README.md`, `DESIGN_SYSTEM.md`, และ `ROADMAP.md`
- โทนสีและแอนิเมชันตามข้อกำหนดสเปก Design System เบื้องต้น

---

## วิธีย้อนกลับเวอร์ชัน (Git Rollback / Checkout)

คุณสามารถย้อนกลับไปดูหรือทดสอบโค้ดในแต่ละเวอร์ชันได้ง่ายๆ ผ่าน Git:

```bash
# ดูรายการเวอร์ชันทั้งหมดที่มีแท็กไว้
git tag -l

# ย้อนกลับไปยังเวอร์ชัน v0.0.1 (Phase 1 HTML ดั้งเดิม)
git checkout v0.0.1

# ย้อนกลับไปยังเวอร์ชัน v0.1.0 (Phase 2 Next.js)
git checkout v0.1.0

# สลับกลับมาที่เวอร์ชันล่าสุด
git checkout main
```
