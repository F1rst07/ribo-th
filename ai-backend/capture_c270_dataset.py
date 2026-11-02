#!/usr/bin/env python3
"""RIBO-TH — C270 Camera Dataset Collector Tool

บันทึกภาพจากกล้อง Logitech C270 เพื่อเตรียม Dataset สำหรับ YOLO11n-seg
รองรับการเก็บภาพตามหมวดหมู่:
1. clear_oil        : น้ำมันพืชใส / สีเหลืองอ่อน บนผิวน้ำ
2. used_oil         : น้ำมันพืชใช้แล้ว สีเข้ม บนผิวน้ำ
3. clean_water      : ผิวน้ำสะอาด ไม่มีน้ำมัน (Negative Sample)
4. glare_reflection : แสงสะท้อนหลอดไฟ / ระลอกคลื่น / ฟองอากาศ / เงา
5. container_rim    : ขอบอ่าง / ผนังห้อง / เพดาน (Negative Sample)

ป้องกัน Camera Conflict:
- โหมด 1: รับภาพสดจาก /tmp/live_cam_frame.jpg หรือ Local AI Server เมื่อเปิดเว็บอยู่
- โหมด 2: เปิดกล้อง C270 โดยตรงเมื่อไม่ได้เปิดเว็บแคมในระบบอื่น
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
import cv2

PROJECT_DIR = Path(__file__).resolve().parent.parent
BASE_OUTPUT_DIR = PROJECT_DIR / "datasets" / "oil" / "raw" / "c270_custom"

CATEGORIES = {
    "1": ("clear_oil", "น้ำมันพืชใสหรือสีเหลืองอ่อน"),
    "2": ("used_oil", "น้ำมันพืชใช้แล้วสีเข้ม"),
    "3": ("clean_water", "ผิวน้ำสะอาด (Negative Sample)"),
    "4": ("glare_reflection", "แสงสะท้อน / คลื่นน้ำ / ฟองอากาศ"),
    "5": ("container_rim", "ขอบอ่าง / ผนัง / เพดาน (Negative Sample)"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="RIBO-TH Logitech C270 Dataset Collector")
    parser.add_argument(
        "--category",
        choices=["clear_oil", "used_oil", "clean_water", "glare_reflection", "container_rim"],
        default=None,
        help="Category folder to store images",
    )
    parser.add_argument("--device", type=int, default=0, help="Webcam device index (default: 0)")
    parser.add_argument(
        "--from-stream",
        action="store_true",
        help="Read from active camera cache (/tmp/live_cam_frame.jpg) to avoid camera lock",
    )
    parser.add_argument("--lighting", default="indoor_lamp", help="Lighting condition tag")
    parser.add_argument("--interval", type=float, default=1.0, help="Interval for auto-burst capture (seconds)")
    return parser.parse_args()


def interactive_select_category() -> str:
    print("\n=== เลือกหมวดหมู่การเก็บภาพสำหรับ RIBO-TH ===")
    for key, (folder, desc) in CATEGORIES.items():
        print(f" [{key}] {folder:<18} : {desc}")
    while True:
        choice = input("\nกรุณากดหมายเลข [1-5] แล้วกด Enter: ").strip()
        if choice in CATEGORIES:
            return CATEGORIES[choice][0]
        print("ตัวเลือกไม่ถูกต้อง กรุณากด 1 ถึง 5")


def main() -> None:
    args = parse_args()
    category = args.category or interactive_select_category()
    out_dir = BASE_OUTPUT_DIR / category
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n[C270 Collector] กำลังบันทึกในหมวด: {category}")
    print(f"[C270 Collector] ปลายทาง: {out_dir}")
    print("กด [SPACE] หรือ [C] เพื่อบันทึก 1 ภาพ")
    print("กด [B] เพื่อเปิด/ปิดโหมด Burst Auto-Capture (ทุก ๆ 1 วินาที)")
    print("กด [Q] หรือ [ESC] เพื่อออกจากโปรแกรม\n")

    cap = None
    use_file_stream = args.from_stream or Path("/tmp/live_cam_frame.jpg").is_file()

    if not use_file_stream:
        cap = cv2.VideoCapture(args.device)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        if not cap.isOpened():
            print(f"[C270 Collector] ไม่สามารถเปิดกล้อง Device {args.device} ได้ สลับไปใช้ File Stream แทน")
            use_file_stream = True

    burst_mode = False
    last_burst_time = 0.0
    saved_count = 0

    try:
        while True:
            frame = None
            if use_file_stream:
                cache_file = Path("/tmp/live_cam_frame.jpg")
                if cache_file.is_file():
                    frame = cv2.imread(str(cache_file))
                time.sleep(0.04)
            elif cap is not None:
                ret, frame = cap.read()
                if not ret:
                    time.sleep(0.05)
                    continue

            if frame is None:
                continue

            display_frame = frame.copy()
            h, w = display_frame.shape[:2]

            # วาดแถบสถานะ
            burst_status = "BURST ON" if burst_mode else "MANUAL"
            cv2.rectangle(display_frame, (0, 0), (w, 40), (20, 20, 20), -1)
            cv2.putText(
                display_frame,
                f"RIBO-TH C270 Capture | Category: {category} | Saved: {saved_count} | Mode: {burst_status}",
                (12, 26),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (0, 220, 255),
                2,
            )

            cv2.imshow("RIBO-TH C270 Dataset Collector", display_frame)
            key = cv2.waitKey(20) & 0xFF

            now = time.time()
            trigger_save = False

            if key in (ord(" "), ord("c"), ord("C")):
                trigger_save = True
            elif key in (ord("b"), ord("B")):
                burst_mode = not burst_mode
                print(f"[C270 Collector] Burst mode: {'เปิด' if burst_mode else 'ปิด'}")
            elif key in (27, ord("q"), ord("Q")):
                break

            if burst_mode and (now - last_burst_time) >= args.interval:
                trigger_save = True
                last_burst_time = now

            if trigger_save:
                timestamp = int(time.time() * 1000)
                filename = f"c270_{category}_{timestamp}.jpg"
                save_path = out_dir / filename
                cv2.imwrite(str(save_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
                saved_count += 1
                print(f"  [+] บันทึกภาพที่ {saved_count}: {filename} ({w}x{h})")

    finally:
        if cap is not None:
            cap.release()
        cv2.destroyAllWindows()
        print(f"\n[C270 Collector] สรุป: บันทึกภาพรวมทั้งสิ้น {saved_count} ภาพใน {out_dir}")


if __name__ == "__main__":
    main()
