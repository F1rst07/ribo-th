# RIBO-TH MCU firmware

เฟิร์มแวร์ C++ สำหรับ STM32U585 บน Arduino UNO Q รับคำสั่งจากแดชบอร์ด:

`CMD:INIT` `CMD:MOVE:*` `CMD:OIL:*` `CMD:ARM:*` `CMD:MODE:*` `CMD:ESTOP:*` `CMD:DISCONNECT`

มอเตอร์/ปั๊ม/แขน **ยังไม่ขับจริง** จนกว่าจะตั้ง `RIBO_PINMAP_VERIFIED` เป็น `1` ใน `include/Pins.h` หลังตรวจผังขาแล้ว

## อัปโหลดด้วย PlatformIO

แพลตฟอร์ม UNO Q ต้องบิลด์บน Linux (x86_64 หรือ aarch64 ของบอร์ด) Mac บิลด์ตรงไม่ได้

บน UNO Q:

```bash
cd firmware
pio run -t upload
pio device monitor -b 115200
```

จาก Mac ผ่าน Remote (ต้องรัน `pio remote agent start` บนบอร์ด):

```bash
cd firmware
pio remote run -r -t upload
```

`Serial` ของ UNO Q ต้องมี `Arduino_RouterBridge` — ใส่ไว้ใน `platformio.ini` แล้ว
