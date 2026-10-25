-- How a chat ended. 'closed' reopens when the customer writes again;
-- 'muted' stays hidden and the AI stays quiet.
ALTER TABLE contacts ADD COLUMN status TEXT DEFAULT 'open';
ALTER TABLE contacts ADD COLUMN status_reason TEXT;
ALTER TABLE contacts ADD COLUMN status_by TEXT;
ALTER TABLE contacts ADD COLUMN status_at INTEGER DEFAULT 0;

-- Buttons above the composer. kind: text (goes into the composer to edit),
-- roomcard (the room photo cards + all topics), image (body = https JPEG/PNG URL).
CREATE TABLE shortcuts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  body TEXT,
  sort INTEGER DEFAULT 0,
  updated_by TEXT,
  updated_at INTEGER DEFAULT 0
);
INSERT INTO shortcuts (label, kind, body, sort) VALUES
 ('🖼️ การ์ดรูปห้อง', 'roomcard', '', 10),
 ('📋 ข้อมูลหอ', 'text', 'มามาแมนชั่น ฉลองกรุง 37
• แอร์ทุกห้อง • เฟอร์นิเจอร์ทุกห้อง • Wi-Fi ฟรี
ห้องมาตรฐาน (22 ตร.ม.) 4,000฿/เดือน
ห้องมุม (23 ตร.ม.) 4,500฿/เดือน
• ไฟ 8฿/หน่วย • น้ำ 18฿/หน่วย • ค่าส่วนกลาง 200฿/เดือน
จอดรถ (มีหลังคา) • มอเตอร์ไซค์ฟรี • รถยนต์ 800฿/เดือน
• สัญญาเช่า 1 ปี
• เข้าอยู่จ่าย 10,200-10,700฿ • จองห้อง 2,000฿', 20),
 ('💰 รูปเรทราคา', 'image', 'https://mm-v2.pages.dev/images/line/price-sheet-v2.jpg', 30),
 ('🔗 ลิงก์จองห้อง', 'text', 'จองห้องผ่านลิงก์นี้ได้เลยครับ https://liff.line.me/2011657200-OBxvsBpn', 40),
 ('🎥 รูปห้อง 360°', 'text', 'ดูรูปห้องและภาพ 360° ได้ที่นี่ครับ https://mm-v2.pages.dev/tour', 50),
 ('🕗 เวลาเข้าชม', 'text', 'เข้าชมห้องตัวอย่างได้ทุกวัน 08:00–17:00 น. ครับ', 60),
 ('📍 แผนที่', 'text', '📍 มามา แมนชั่น 45 ซอยฉลองกรุง 37 ลาดกระบัง
https://maps.app.goo.gl/Qktm2mDGPappQ8EZA', 70);
