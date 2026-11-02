#!/usr/bin/env python3
"""RIBO-TH — YOLO11 Polygon Segmentation Annotation Tool

เครื่องมือทำ Label คราบน้ำมันสำหรับ YOLO11n-seg (Polygon Segmentation Format)
รองรับ:
- การคลิกกำหนดจุด Polygon ทีละจุดรอบขอบเขตคราบน้ำมัน
- รองรับหลายคราบน้ำมันใน 1 ภาพ
- รองรับการกดปุ่ม [N] เพื่อระบุว่าเป็น Negative Sample (น้ำสะอาด / ผนัง / แสงสะท้อน) โดยบันทึกไฟล์ว่าง 0 bytes
- บันทึกไฟล์พิกัดตามมาตรฐาน YOLO Segmentation: 0 x1 y1 x2 y2 x3 y3 ... (พิกัด Normalized 0.0 - 1.0)
- โหลด Label เดิมขึ้นมาแสดงและแก้ไขได้

ปุ่มควบคุม:
- คลิกซ้าย           : วางจุดยอด Polygon
- คลิกขวา           : ลบจุดยอดย้อนหลัง 1 จุด (Undo point)
- [ENTER] หรือ [SPACE]: สิ้นสุด Polygon นี้และเริ่มวาดคราบถัดไปในภาพเดียวกัน
- [S]               : บันทึก Label ทั้งหมดของภาพนี้ แล้วไปภาพถัดไป
- [N]               : กำหนดเป็น Negative Sample (ไม่มีน้ำมัน) แล้วไปภาพถัดไป
- [C]               : ล้างจุด Polygon ที่กำลังวาดอยู่
- [R]               : รีเซ็ตลบ Label ทั้งหมดของภาพปัจจุบัน
- [D] หรือ ลูกศรขวา   : ข้ามไปภาพถัดไป
- [A] หรือ ลูกศรซ้าย   : ย้อนกลับไปภาพก่อนหน้า
- [Q] หรือ [ESC]     : บันทึกและออกจากโปรแกรม
"""

from __future__ import annotations

import argparse
import glob
from pathlib import Path
import cv2
import numpy as np

PROJECT_DIR = Path(__file__).resolve().parent.parent


class OilPolygonAnnotator:
    def __init__(self, image_dir: Path, label_dir: Path) -> None:
        self.image_dir = image_dir.resolve()
        self.label_dir = label_dir.resolve()
        self.label_dir.mkdir(parents=True, exist_ok=True)

        # ค้นหาภาพทั้งหมด
        extensions = ("*.jpg", "*.jpeg", "*.png", "*.bmp", "*.JPG", "*.JPEG", "*.PNG")
        self.image_paths: list[Path] = []
        for ext in extensions:
            self.image_paths.extend(self.image_dir.glob(ext))
        self.image_paths = sorted(self.image_paths)

        if not self.image_paths:
            print(f"[Annotator] ไม่พบไฟล์ภาพในโฟลเดอร์: {self.image_dir}")
            return

        self.current_idx = 0
        self.current_points: list[tuple[int, int]] = []
        self.completed_polygons: list[list[tuple[int, int]]] = []
        self.window_name = "RIBO-TH Oil Spill Segmentation Annotator"

    def mouse_callback(self, event: int, x: int, y: int, flags: int, param: Any) -> None:
        if event == cv2.EVENT_LBUTTONDOWN:
            self.current_points.append((x, y))
        elif event == cv2.EVENT_RBUTTONDOWN:
            if self.current_points:
                self.current_points.pop()

    def get_label_path(self, img_path: Path) -> Path:
        return self.label_dir / f"{img_path.stem}.txt"

    def load_existing_annotation(self, img_path: Path, img_w: int, img_h: int) -> None:
        self.completed_polygons = []
        self.current_points = []
        lbl_path = self.get_label_path(img_path)
        if not lbl_path.is_file():
            return

        with open(lbl_path, "r", encoding="utf-8") as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) < 7:  # class_id + at least 3 points (6 coords)
                    continue
                coords = [float(val) for val in parts[1:]]
                poly_pts: list[tuple[int, int]] = []
                for i in range(0, len(coords) - 1, 2):
                    px = int(round(coords[i] * img_w))
                    py = int(round(coords[i + 1] * img_h))
                    poly_pts.append((px, py))
                if len(poly_pts) >= 3:
                    self.completed_polygons.append(poly_pts)

    def save_annotation(self, img_path: Path, img_w: int, img_h: int, is_negative: bool = False) -> None:
        lbl_path = self.get_label_path(img_path)
        if is_negative:
            # Negative Sample: empty file
            with open(lbl_path, "w", encoding="utf-8") as f:
                pass
            print(f"  [Negative Sample] บันทึกไฟล์ว่าง: {lbl_path.name}")
            return

        lines: list[str] = []
        # รวม current_points หากมีมากกว่าหรือเท่ากับ 3 จุด
        all_polys = list(self.completed_polygons)
        if len(self.current_points) >= 3:
            all_polys.append(self.current_points)

        for poly in all_polys:
            if len(poly) < 3:
                continue
            normalized_coords = []
            for px, py in poly:
                nx = max(0.0, min(1.0, px / float(img_w)))
                ny = max(0.0, min(1.0, py / float(img_h)))
                normalized_coords.extend([f"{nx:.6f}", f"{ny:.6f}"])
            line = f"0 " + " ".join(normalized_coords)
            lines.append(line)

        with open(lbl_path, "w", encoding="utf-8") as f:
            for l in lines:
                f.write(l + "\n")
        print(f"  [Saved] บันทึก {len(lines)} Polygons ใน: {lbl_path.name}")

    def run(self) -> None:
        if not self.image_paths:
            return

        cv2.namedWindow(self.window_name, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(self.window_name, 1280, 720)
        cv2.setMouseCallback(self.window_name, self.mouse_callback)

        total_images = len(self.image_paths)
        print("\n=== เริ่มต้นระบบ Annotation สำหรับ RIBO-TH ===")
        print(f"จำนวนภาพทั้งหมด: {total_images} ภาพ")
        print("คำสั่ง: [คลิกซ้าย] วางจุด | [Space] จบ Polygon | [S] บันทึก | [N] ภาพว่าง | [A/D] ก่อนหน้า/ถัดไป\n")

        while 0 <= self.current_idx < total_images:
            img_path = self.image_paths[self.current_idx]
            raw_img = cv2.imread(str(img_path))
            if raw_img is None:
                print(f"[Warning] ไม่สามารถเปิดไฟล์ภาพ: {img_path.name}")
                self.current_idx += 1
                continue

            img_h, img_w = raw_img.shape[:2]
            self.load_existing_annotation(img_path, img_w, img_h)

            while True:
                display = raw_img.copy()

                # 1. วาด Polygons ที่เสร็จแล้ว (สีส้มโปร่งแสง + เส้นทึบ)
                overlay = display.copy()
                for poly in self.completed_polygons:
                    if len(poly) >= 3:
                        pts = np.array(poly, np.int32)
                        cv2.fillPoly(overlay, [pts], (22, 115, 249))  # BGR Orange
                        cv2.polylines(display, [pts], isClosed=True, color=(0, 140, 255), thickness=2)
                        # จุด centroid
                        M = cv2.moments(pts)
                        if M["m00"] > 0:
                            cx, cy = int(M["m10"] / M["m00"]), int(M["m01"] / M["m00"])
                            cv2.circle(display, (cx, cy), 4, (0, 255, 255), -1)
                            cv2.putText(display, "oil", (cx + 6, cy - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)

                cv2.addWeighted(overlay, 0.35, display, 0.65, 0, display)

                # 2. วาด Polygon ที่กำลังคลิกอยู่ (สีเหลือง)
                if len(self.current_points) > 0:
                    for pt in self.current_points:
                        cv2.circle(display, pt, 4, (0, 255, 255), -1)
                    if len(self.current_points) >= 2:
                        pts = np.array(self.current_points, np.int32)
                        cv2.polylines(display, [pts], isClosed=False, color=(0, 255, 255), thickness=2)

                # 3. แถบข้อมูลด้านบน
                lbl_exists = self.get_label_path(img_path).is_file()
                status_lbl = "LABELED" if lbl_exists else "UNLABELED"
                cv2.rectangle(display, (0, 0), (img_w, 42), (25, 25, 25), -1)
                info_text = (
                    f"[{self.current_idx + 1}/{total_images}] {img_path.name} | "
                    f"Polygons: {len(self.completed_polygons)} | Status: {status_lbl}"
                )
                cv2.putText(display, info_text, (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 230, 255), 2)

                cv2.imshow(self.window_name, display)
                key = cv2.waitKey(20) & 0xFF

                # จัดการปุ่มกด
                if key in (13, 32):  # Enter หรือ Space: จบ Polygon นี้
                    if len(self.current_points) >= 3:
                        self.completed_polygons.append(list(self.current_points))
                        self.current_points = []
                        print(f"  [+] เพิ่ม Polygon {len(self.completed_polygons)}")
                elif key in (ord("s"), ord("S")):  # บันทึก
                    self.save_annotation(img_path, img_w, img_h, is_negative=False)
                    self.current_idx += 1
                    break
                elif key in (ord("n"), ord("N")):  # Negative sample
                    self.save_annotation(img_path, img_w, img_h, is_negative=True)
                    self.current_idx += 1
                    break
                elif key in (ord("c"), ord("C")):  # เคลียร์จุดปัจจุบัน
                    self.current_points = []
                elif key in (ord("r"), ord("R")):  # รีเซ็ตทั้งหมดในภาพ
                    self.current_points = []
                    self.completed_polygons = []
                    lbl_file = self.get_label_path(img_path)
                    if lbl_file.is_file():
                        lbl_file.unlink()
                        print(f"  [-] ลบ Label เดิม: {lbl_file.name}")
                elif key in (ord("d"), ord("D"), 83):  # ถัดไป
                    self.current_idx += 1
                    break
                elif key in (ord("a"), ord("A"), 81):  # ก่อนหน้า
                    self.current_idx = max(0, self.current_idx - 1)
                    break
                elif key in (27, ord("q"), ord("Q")):  # ออก
                    cv2.destroyAllWindows()
                    print("\n[Annotator] บันทึกสถานะและปิดโปรแกรมเรียบร้อย")
                    return

        cv2.destroyAllWindows()
        print("\n[Annotator] ดำเนินการเสร็จสิ้นทุกภาพในรายการ")


def main() -> None:
    parser = argparse.ArgumentParser(description="RIBO-TH YOLO11 Segmentation Annotator")
    parser.add_argument(
        "--images",
        type=Path,
        default=PROJECT_DIR / "datasets" / "oil" / "raw" / "mendeley_chemical_pollution",
        help="Path to folder containing images",
    )
    parser.add_argument(
        "--labels",
        type=Path,
        default=PROJECT_DIR / "datasets" / "oil" / "labels" / "train",
        help="Path to folder to save labels",
    )
    args = parser.parse_args()
    annotator = OilPolygonAnnotator(args.images, args.labels)
    annotator.run()


if __name__ == "__main__":
    main()
