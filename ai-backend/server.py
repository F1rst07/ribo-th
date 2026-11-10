from __future__ import annotations

import argparse
import base64
import binascii
import json
import math
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent
def _first_existing(*paths: Path) -> Path | None:
    for path in paths:
        if path.is_file():
            return path
    return None


DEFAULT_MODEL = _first_existing(
    PROJECT_DIR / "models" / "trash_new.pt",
    PROJECT_DIR / "models" / "trash.pt",
    PROJECT_DIR / "models" / "trash_new.onnx",
)
# โมเดลตรวจจับคราบน้ำมัน YOLO11n-seg ใหม่ (Surface Water Floating Waste & Domestic Cooking Oil)
DEFAULT_NAFTA_MODEL: Path | None = None
DEFAULT_OIL_MODEL: Path | None = (
    PROJECT_DIR / "models" / "oil" / "best.pt"
    if (PROJECT_DIR / "models" / "oil" / "best.pt").is_file()
    else None
)
MAX_IMAGE_LENGTH = 1_500_000

os.environ.setdefault("YOLO_CONFIG_DIR", str(BACKEND_DIR / ".ultralytics"))
os.environ.setdefault("YOLO_OFFLINE", "1")
os.environ.setdefault("ULTRALYTICS_AUTOINSTALL", "0")

import cv2  # noqa: E402
import numpy as np  # noqa: E402
cv2.setNumThreads(1)
if os.environ.get("RIBO_RUNTIME") == "onnx":
    from onnx_runtime_adapter import YOLO  # noqa: E402
else:
    from ultralytics import YOLO  # noqa: E402


OIL_CLASS_MAP: dict[str, str] = {
    "oil": "คราบน้ำมัน (Oil Spill)",
    "rainbow": "ฟิล์มสีรุ้ง (Rainbow Sheen)",
    "sheen": "ฟิล์มสีเงิน (Silver Sheen)",
    "truecolor": "คราบหนา (True Color)",
}


TRASH_CLASS_MAP: dict[str, str] = {
    # อุตสาหกรรม — พลาสติก / แก้ว / กระดาษ
    "plastic water bottle": "ขวดน้ำดื่มพลาสติก (Plastic water bottle)",
    "clear glass bottle": "ขวดแก้วใส / ขวดชูกำลัง (Clear glass / energy drink bottle)",
    "energy drink bottle": "ขวดเครื่องดื่มชูกำลัง (Energy drink bottle)",
    "cardboard box": "กล่องลัง (Cardboard box)",
    "newspaper": "กระดาษหนังสือพิมพ์ (Newspaper)",
    "notebook": "สมุด / กระดาษ A4 (Notebook / A4 paper)",
    "a4 paper": "กระดาษ A4 / สมุด (A4 paper / notebook)",
    # โลหะ / อะลูมิเนียม
    "soda can": "กระป๋องน้ำอัดลม (Soda can)",
    "condensed milk can": "กระป๋องนมข้นหวาน (Condensed milk can)",
    "scrap metal": "เศษเหล็ก (Scrap metal)",
    # อิเล็กทรอนิกส์
    "battery": "ถ่านไฟฉาย / แบตเตอรี่มือถือ (Battery)",
    "phone battery": "แบตเตอรี่มือถือ (Phone battery)",
    "charging cable": "สายชาร์จเก่า (Charging cable)",
    # สารเคมี / ไวไฟ
    "fluorescent tube": "หลอดไฟฟลูออเรสเซนต์ (Fluorescent tube)",
    "spray can": "กระป๋องสเปรย์ (Spray can)",
    "toilet cleaner bottle": "ขวดน้ำยาล้างห้องน้ำ (Toilet cleaner bottle)",
    # ขยะติดเชื้อ
    "face mask": "หน้ากากอนามัย (Face mask)",
    "atk test kit": "ATK (ATK test kit)",
    # ขยะเรือ / รายการเดิมที่ยังเจอบ่อย
    "plastic bag": "ถุงพลาสติก (Plastic bag)",
    "styrofoam": "โฟม (Styrofoam)",
    "plastic bag & wrapper": "ถุงพลาสติกและซองขนม (Plastic bag & wrapper)",
    "cigarette": "ก้นบุหรี่ (Cigarette)",
    "bottle": "ขวดพลาสติก / ขวดน้ำ (Bottle)",
    "bottle cap": "ฝาขวด (Bottle cap)",
    "can": "กระป๋อง (Can)",
    "other plastic": "พลาสติกอื่น ๆ (Other plastic)",
    "carton": "กล่องนม / กล่องเครื่องดื่ม (Carton)",
    "cup": "แก้วน้ำ (Cup)",
    "other": "ขยะอื่น ๆ (Other)",
    "uht-box": "กล่องนม (Milk Carton)",
    "uht_box": "กล่องนม (Milk Carton)",
    "drink carton": "กล่องนม / กล่องเครื่องดื่ม (Carton)",
    "single-use-plastic": "ถุงพลาสติก (Plastic Bag)",
    "single_use_plastic": "ถุงพลาสติก (Plastic Bag)",
    "single-layer plastic": "ถุงพลาสติก (Plastic Bag)",
    "handbag": "ถุงพลาสติก (Plastic Bag)",
    "backpack": "ถุงพลาสติก (Plastic Bag)",
    "pet bottle": "ขวดน้ำพลาสติก (PET Bottle)",
    "hdpe plastic": "ขวดนม / พลาสติกทึบ (HDPE Bottle)",
    "multi-layer plastic": "ซองขนม / ซองพลาสติก (Snack Wrapper)",
    "squeeze-tube": "หลอดพลาสติก (Plastic Tube)",
    "bowl": "ภาชนะ / โฟม (Container)",
    "box": "กล่องกระดาษ (Box)",
    "cardboard": "กล่องลัง (Cardboard box)",
    "book": "กล่องกระดาษ (Carton)",
    "paper": "กระดาษ / หนังสือพิมพ์ / A4 (Paper / newspaper / A4)",
    "plastic": "พลาสติก / ขวดน้ำดื่ม (Plastic / water bottle)",
    "metal": "โลหะ / กระป๋องน้ำอัดลม / กระป๋องนม (Metal / soda or milk can)",
    "glass": "ขวดแก้ว (Glass)",
    "litter": "ขยะ (Litter)",
    "trash": "ขยะ (Trash)",
    "waste": "ขยะ (Waste)",
    "biological": "ขยะอินทรีย์ (Biological)",
    "brown-glass": "ขวดแก้วน้ำตาล (Brown glass)",
    "clothes": "เสื้อผ้า (Clothes)",
    "green-glass": "ขวดแก้วเขียว (Green glass)",
    "shoes": "รองเท้า (Shoes)",
    "white-glass": "ขวดแก้วใส / ขวดชูกำลัง (Clear glass / energy drink)",
}


def trash_display_names(raw_name: str) -> tuple[str, str]:
    return "ขยะ", "Trash"


class LockedTarget:
    """เป้าหมายเดี่ยวที่ระบบทำการล็อกไว้เหนียวแน่น (Sticky Target Lock-on) สำหรับเรืออัตโนมัติ"""

    def __init__(
        self,
        track_id: int,
        class_id: int,
        raw_name: str,
        box: list[float],
        conf: float,
        timestamp: float,
        confirmation_hits: int = 3,
    ) -> None:
        self.track_id = track_id
        self.class_id = class_id
        self.raw_name = raw_name
        self.box = list(box)  # [left, top, right, bottom]
        self.confidence = conf
        self.first_seen = timestamp
        self.last_seen = timestamp
        self.velocity = [0.0, 0.0]  # [vx, vy] in pixels per second
        self.hits = 1
        self.misses = 0
        self.confirmation_hits = max(1, confirmation_hits)
        self.hist: np.ndarray | None = None
        self.keep_layers: tuple[str, ...] = ("detect",)

    @property
    def is_confirmed(self) -> bool:
        return self.hits >= self.confirmation_hits

    def remember_appearance(self, image: np.ndarray) -> None:
        hist = crop_hsv_hist(image, self.box)
        if hist is None:
            return
        if self.hist is None:
            self.hist = hist
        else:
            self.hist = 0.62 * hist + 0.38 * self.hist

    def predicted_box(self, timestamp: float, img_w: int, img_h: int) -> list[float]:
        dt = max(0.01, min(0.40, timestamp - self.last_seen))
        dx = self.velocity[0] * dt
        dy = self.velocity[1] * dt
        return clamp_box(
            [self.box[0] + dx, self.box[1] + dy, self.box[2] + dx, self.box[3] + dy],
            img_w,
            img_h,
        )

    def update(
        self,
        box: list[float],
        conf: float,
        timestamp: float,
        alpha: float = 0.50,
        image: np.ndarray | None = None,
        layers: tuple[str, ...] = ("detect", "motion"),
    ) -> None:
        self.hits += 1
        self.misses = 0
        self.keep_layers = layers
        dt = max(0.01, min(0.40, timestamp - self.last_seen))
        old_cx = (self.box[0] + self.box[2]) / 2.0
        old_cy = (self.box[1] + self.box[3]) / 2.0
        new_cx = (box[0] + box[2]) / 2.0
        new_cy = (box[1] + box[3]) / 2.0

        # คำนวณความเร็วการเคลื่อนที่ (Velocity) พร้อมการปรับให้เรียบ
        inst_vx = (new_cx - old_cx) / dt
        inst_vy = (new_cy - old_cy) / dt
        self.velocity[0] = 0.60 * inst_vx + 0.40 * self.velocity[0]
        self.velocity[1] = 0.60 * inst_vy + 0.40 * self.velocity[1]
        self.velocity[0] = max(-700.0, min(700.0, self.velocity[0]))
        self.velocity[1] = max(-520.0, min(520.0, self.velocity[1]))

        # ปรับตำแหน่งกรอบด้วย EMA (Exponential Moving Average)
        # หากมีการเคลื่อนไหวเร็ว ให้ตอบสนองไว (alpha สูง) เพื่อไม่ให้กรอบลอยตามหลัง
        dx = abs(new_cx - old_cx)
        dy = abs(new_cy - old_cy)
        effective_alpha = 0.85 if (dx > 20.0 or dy > 20.0) else alpha
        old_area = max(1.0, (self.box[2] - self.box[0]) * (self.box[3] - self.box[1]))
        new_area = max(1.0, (box[2] - box[0]) * (box[3] - box[1]))
        if new_area < 0.92 * old_area:
            effective_alpha = max(effective_alpha, 0.84)

        self.box = [
            effective_alpha * new_v + (1.0 - effective_alpha) * old_v
            for new_v, old_v in zip(box, self.box)
        ]
        self.confidence = 0.70 * conf + 0.30 * self.confidence
        self.last_seen = timestamp
        if image is not None:
            tight = tighten_object_box(image, self.box)
            tight_area = max(1.0, (tight[2] - tight[0]) * (tight[3] - tight[1]))
            if 0.50 * old_area <= tight_area <= old_area:
                self.box = tight
            self.remember_appearance(image)


class LockedOilTrack:
    """ล็อกคราบน้ำมันหลายเป้า — ชั้น detect/motion/appearance แบบขยะ สะบัดพ้นจอแล้วปล่อย"""

    def __init__(
        self,
        track_id: int,
        box: list[float],
        points: list[dict[str, float]],
        conf: float,
        area_pct: float,
        timestamp: float,
        oil_type: str = "คราบน้ำมัน",
        raw_name: str = "oil",
        confirmation_hits: int = 3,
    ) -> None:
        self.track_id = track_id
        self.box = list(box)
        self.points = list(points)
        self.confidence = conf
        self.area_pct = area_pct
        self.oil_type = oil_type
        self.raw_name = raw_name
        self.first_seen = timestamp
        self.last_seen = timestamp
        self.velocity = [0.0, 0.0]
        self.hits = 1
        self.misses = 0
        self.confirmation_hits = max(1, confirmation_hits)
        self.hist: np.ndarray | None = None
        self.keep_layers: tuple[str, ...] = ("detect",)

    @property
    def is_confirmed(self) -> bool:
        return self.hits >= self.confirmation_hits

    def remember_appearance(self, image: np.ndarray) -> None:
        hist = crop_hsv_hist(image, self.box)
        if hist is None:
            return
        if self.hist is None:
            self.hist = hist
        else:
            self.hist = 0.62 * hist + 0.38 * self.hist

    def predicted_box(self, timestamp: float, img_w: int, img_h: int) -> list[float]:
        dt = max(0.01, min(0.40, timestamp - self.last_seen))
        dx = self.velocity[0] * dt
        dy = self.velocity[1] * dt
        return clamp_box(
            [self.box[0] + dx, self.box[1] + dy, self.box[2] + dx, self.box[3] + dy],
            img_w,
            img_h,
        )

    def shift_points(self, dx: float, dy: float, img_w: int, img_h: int) -> list[dict[str, float]]:
        shifted: list[dict[str, float]] = []
        for point in self.points:
            shifted.append(
                {
                    "x": round(min(float(img_w), max(0.0, float(point["x"]) + dx)), 1),
                    "y": round(min(float(img_h), max(0.0, float(point["y"]) + dy)), 1),
                }
            )
        return shifted

    def update(
        self,
        box: list[float],
        points: list[dict[str, float]],
        conf: float,
        area_pct: float,
        timestamp: float,
        alpha: float = 0.50,
        image: np.ndarray | None = None,
        layers: tuple[str, ...] = ("detect", "motion"),
    ) -> None:
        self.hits += 1
        self.misses = 0
        self.keep_layers = layers
        dt = max(0.01, min(0.40, timestamp - self.last_seen))
        old_cx = (self.box[0] + self.box[2]) / 2.0
        old_cy = (self.box[1] + self.box[3]) / 2.0
        new_cx = (box[0] + box[2]) / 2.0
        new_cy = (box[1] + box[3]) / 2.0

        inst_vx = (new_cx - old_cx) / dt
        inst_vy = (new_cy - old_cy) / dt
        self.velocity[0] = 0.60 * inst_vx + 0.40 * self.velocity[0]
        self.velocity[1] = 0.60 * inst_vy + 0.40 * self.velocity[1]
        self.velocity[0] = max(-700.0, min(700.0, self.velocity[0]))
        self.velocity[1] = max(-520.0, min(520.0, self.velocity[1]))

        dx = abs(new_cx - old_cx)
        dy = abs(new_cy - old_cy)
        effective_alpha = 0.85 if (dx > 20.0 or dy > 20.0) else alpha
        old_area = max(1.0, (self.box[2] - self.box[0]) * (self.box[3] - self.box[1]))
        new_area = max(1.0, (box[2] - box[0]) * (box[3] - box[1]))
        if new_area < 0.92 * old_area:
            effective_alpha = max(effective_alpha, 0.84)

        shifted = self.shift_points(new_cx - old_cx, new_cy - old_cy, 10000, 10000)
        self.box = [
            effective_alpha * new_v + (1.0 - effective_alpha) * old_v
            for new_v, old_v in zip(box, self.box)
        ]
        if points and len(points) >= 3:
            self.points = points
        elif shifted:
            self.points = shifted
        self.confidence = 0.70 * conf + 0.30 * self.confidence
        self.area_pct = effective_alpha * area_pct + (1.0 - effective_alpha) * self.area_pct
        self.last_seen = timestamp
        if image is not None:
            self.remember_appearance(image)


def clamp_box(box: list[float], img_w: int, img_h: int) -> list[float]:
    left, top, right, bottom = (float(v) for v in box)
    width = max(2.0, right - left)
    height = max(2.0, bottom - top)
    left = min(max(0.0, left), max(0.0, img_w - width))
    top = min(max(0.0, top), max(0.0, img_h - height))
    return [left, top, min(float(img_w), left + width), min(float(img_h), top + height)]


def crop_hsv_hist(image: np.ndarray, box: list[float]) -> np.ndarray | None:
    img_h, img_w = image.shape[:2]
    left = int(max(0, box[0]))
    top = int(max(0, box[1]))
    right = int(min(img_w, box[2]))
    bottom = int(min(img_h, box[3]))
    if right - left < 8 or bottom - top < 8:
        return None
    crop = image[top:bottom, left:right]
    if crop.size == 0:
        return None
    small = cv2.resize(crop, (32, 32), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [12, 8], [0, 180, 0, 256])
    cv2.normalize(hist, hist)
    return hist


def hist_corr(hist_a: np.ndarray | None, hist_b: np.ndarray | None) -> float:
    if hist_a is None or hist_b is None:
        return 0.0
    return float(np.clip(cv2.compareHist(hist_a, hist_b, cv2.HISTCMP_CORREL), -1.0, 1.0))


def box_overlap_metrics(box_a: list[float], box_b: list[float]) -> tuple[float, float]:
    x_a = max(box_a[0], box_b[0])
    y_a = max(box_a[1], box_b[1])
    x_b = min(box_a[2], box_b[2])
    y_b = min(box_a[3], box_b[3])
    inter_area = max(0.0, x_b - x_a) * max(0.0, y_b - y_a)
    box_a_area = (box_a[2] - box_a[0]) * (box_a[3] - box_a[1])
    box_b_area = (box_b[2] - box_b[0]) * (box_b[3] - box_b[1])
    denom = box_a_area + box_b_area - inter_area
    iou = inter_area / denom if denom > 0 else 0.0
    min_area = min(box_a_area, box_b_area)
    ios = inter_area / min_area if min_area > 0 else 0.0
    return iou, ios


def lock_class_compatible(target_name: str, det_name: str) -> bool:
    """กระป๋องโลหะกับซองพลาสติกคนละชิ้น — trash ที่กระป๋องกะพริบยังถือว่าชิ้นเดิม"""
    target = (target_name or "").lower().strip()
    det = (det_name or "").lower().strip()
    if target == det:
        return True
    hard = {"metal", "glass"}
    wrapper = {"plastic", "paper"}
    if target in hard and det in wrapper:
        return False
    if target in wrapper and det in hard:
        return False
    return True


def compute_target_match_score(det: dict[str, Any], target: LockedTarget | LockedOilTrack, now: float) -> float:
    """Sticky lock: ชิ้นที่ล็อกก่อนติดตอนแพน ห้ามกระโดดไปชิ้นข้าง ๆ"""
    det_box = det["box"]
    target_box = target.box

    dt = max(0.01, min(0.40, now - target.last_seen))
    pred_cx = ((target_box[0] + target_box[2]) / 2.0) + (target.velocity[0] * dt)
    pred_cy = ((target_box[1] + target_box[3]) / 2.0) + (target.velocity[1] * dt)

    det_cx = (det_box[0] + det_box[2]) / 2.0
    det_cy = (det_box[1] + det_box[3]) / 2.0

    dx = abs(det_cx - pred_cx)
    dy = abs(det_cy - pred_cy)

    w_det = max(1.0, det_box[2] - det_box[0])
    h_det = max(1.0, det_box[3] - det_box[1])
    w_tgt = max(1.0, target_box[2] - target_box[0])
    h_tgt = max(1.0, target_box[3] - target_box[1])

    area_det = w_det * h_det
    area_tgt = w_tgt * h_tgt
    area_ratio = min(area_det, area_tgt) / max(area_det, area_tgt)
    if area_ratio < 0.10:
        return 0.0

    iou, ios = box_overlap_metrics(det_box, target_box)
    if iou < 0.04 and (dx > max(140.0, w_tgt * 1.8) or dy > max(110.0, h_tgt * 1.8)):
        return 0.0
    if area_det > area_tgt * 2.8 and iou < 0.22:
        return 0.0
    if iou < 0.04 and ios < 0.16 and dx > max(90.0, w_tgt * 1.1):
        return 0.0

    if not lock_class_compatible(target.raw_name, str(det.get("raw_name", ""))):
        if iou < 0.40:
            return 0.0

    spatial_score = (1.0 - min(1.0, dx / 320.0)) * (1.0 - min(1.0, dy / 240.0))
    overlap_score = max(iou, ios * max(area_ratio, 0.18))
    score = float(0.55 * overlap_score + 0.45 * spatial_score)
    if str(target.raw_name).lower().strip() == str(det.get("raw_name", "")).lower().strip():
        score += 0.08
    return score


def is_same_object_overlap(
    box_a: list[float],
    box_b: list[float],
    iou_th: float = 0.35,
    ios_th: float = 0.55,
) -> bool:
    iou, ios = box_overlap_metrics(box_a, box_b)
    return (iou >= iou_th) or (ios >= ios_th)


def is_plausible_oil_region(
    image: np.ndarray,
    box: list[float],
    conf: float,
    raw_name: str = "",
) -> bool:
    """ตัดผนัง ฝ้า ผ้าม่าน พื้นเรียบ — เหลือแต่ฟิล์ม/หยดที่สีไม่สม่ำเสมอ"""
    img_h, img_w = image.shape[:2]
    left, top, right, bottom = (float(v) for v in box)
    box_w = max(1.0, right - left)
    box_h = max(1.0, bottom - top)
    if box_w < 10.0 or box_h < 10.0:
        return False
    if max(box_w / box_h, box_h / box_w) > 4.2:
        return False

    y0, y1 = int(max(0, top)), int(min(img_h, bottom))
    x0, x1 = int(max(0, left)), int(min(img_w, right))
    crop = image[y0:y1, x0:x1]
    if crop.size == 0 or crop.shape[0] < 8 or crop.shape[1] < 8:
        return False

    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    hue, sat, val = cv2.split(hsv)
    sat_mean = float(sat.mean())
    sat_std = float(sat.std())
    hue_std = float(hue.std())
    val_mean = float(val.mean())
    val_std = float(val.std())

    if sat_std < 16.0 and hue_std < 14.0 and val_std < 24.0:
        return False
    if sat_mean < 42.0 and val_mean > 135.0 and hue_std < 16.0:
        return False
    if box_h > 2.3 * box_w and sat_std < 28.0:
        return False

    name = (raw_name or "").lower().strip()
    if name in {"truecolor", "oil"} and val_mean > 145.0 and sat_mean < 80.0 and hue_std < 18.0:
        return False

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    edge_density = float(np.sum(edges > 0)) / max(1, edges.size)
    if edge_density > 0.09 and conf < 0.70:
        return False
    if edge_density < 0.012 and sat_std < 22.0 and conf < 0.55:
        return False
    return True


def is_edge_sliver_artifact(box: list[float], img_w: int, img_h: int, is_oil: bool = False) -> bool:
    """กรองวัตถุลวงที่เกิดจากขอบเลนส์กล้องหรือการถูกตัดที่ขอบภาพ (Edge Vignette / Boundary Sliver Artifact)"""
    left, top, right, bottom = box
    box_w = max(1.0, right - left)
    box_h = max(1.0, bottom - top)

    touches_x = (left <= 4.0) or (right >= img_w - 4.0)
    touches_y = (top <= 4.0) or (bottom >= img_h - 4.0)

    min_ratio = 0.06 if is_oil else 0.08

    # 1. แถบแคบชิดขอบภาพด้านข้าง
    if touches_x and (box_w < min_ratio * img_w):
        return True

    # 2. แถบแคบชิดขอบภาพด้านบน/ล่าง
    if touches_y and (box_h < min_ratio * img_h):
        return True

    # 3. ติ่งมุมกล้อง (Corner Glitch) ที่ชิดทั้งแกน X และ Y และมีพื้นที่ขนาดเล็ก
    corner_ratio = 0.06 if is_oil else 0.08
    if touches_x and touches_y and (box_w * box_h < corner_ratio * img_w * img_h):
        return True

    return False


def is_valid_trash_candidate(
    box: list[float],
    image: np.ndarray,
    conf: float,
    oil_boxes: list[list[float]] | None = None,
) -> bool:
    """ตรวจสอบความสมบูรณ์ของวัตถุขยะ ป้องกันภาพหลอนจากก้นถังสีขาว ระลอกคลื่นน้ำ และคราบน้ำมัน"""
    left, top, right, bottom = box
    box_w = max(1.0, right - left)
    box_h = max(1.0, bottom - top)
    img_h, img_w = image.shape[:2]

    # 1. กรองขนาดที่ใหญ่เกินจริง (ครอบทั้งห้อง/ผนัง/เพดาน)
    if (box_w >= 0.90 * img_w and box_h >= 0.85 * img_h) or (box_w * box_h >= 0.70 * img_w * img_h):
        return False
    if box_w < 14.0 or box_h < 14.0:
        return False
    if box_w * box_h < 0.004 * img_w * img_h:
        return False

    # 2. กรองสัดส่วน Aspect Ratio ผิดรูป (ขอบปากอ่าง/เงาขอบโค้ง)
    ar = max(box_w / box_h, box_h / box_w)
    # สายชาร์จ หลอดไฟฟลูออเรสเซนต์ และกระดาษม้วนเป็นของยาว — ห้ามตัดที่ 4.5
    if ar > 14.0:
        return False

    # 3. กรองการทับซ้อนกับคราบน้ำมัน (ถ้าเป็นหยดน้ำมันแต่โมเดลขยะสับสนว่าเป็นซองพลาสติก/ขวดใส)
    overlaps_oil = False
    if oil_boxes:
        for ob in oil_boxes:
            ix1 = max(left, ob[0])
            iy1 = max(top, ob[1])
            ix2 = min(right, ob[2])
            iy2 = min(bottom, ob[3])
            inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
            if inter > 0:
                ios = inter / min(box_w * box_h, max(1.0, (ob[2] - ob[0]) * (ob[3] - ob[1])))
                if ios > 0.35:
                    overlaps_oil = True
                    break

    # 4. วิเคราะห์เนื้อสัมผัส (Texture) และขอบคม (Edge Density) ใน Crop ของวัตถุ
    # ผิวน้ำใสและก้นอ่างพลาสติกขาวจะมีความแปรปรวนของสีและขอบ Canny ต่ำมาก
    crop = image[int(max(0, top)):int(min(img_h, bottom)), int(max(0, left)):int(min(img_w, right))]
    if crop.size > 0:
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        std_val = float(np.std(gray))
        # ก้นอ่างสีขาวและน้ำใสจะมีค่า Standard Deviation ต่ำมาก (< 18.0)
        if std_val < 16.0 and conf < 0.40:
            return False
        edges = cv2.Canny(gray, 35, 110)
        edge_density = float(np.sum(edges > 0)) / edges.size
        # ผิวน้ำที่ไม่มีขยะจริงจะมีความหนาแน่นของเส้นขอบต่ำมาก
        if edge_density < 0.012 and conf < 0.40:
            return False
        # หากทับซ้อนกับคราบน้ำมันและไม่มีลายฉลาก/ขอบแข็งของขยะจริง ให้ปฏิเสธ (ให้น้ำหนักกับโมเดลน้ำมัน)
        if overlaps_oil and (std_val < 26.0 or edge_density < 0.030):
            return False

    return True


COCO_WASTE_LIKE = {
    "backpack",
    "handbag",
    "suitcase",
    "bottle",
    "wine glass",
    "cup",
    "fork",
    "knife",
    "spoon",
    "bowl",
    "banana",
    "apple",
    "sandwich",
    "orange",
    "broccoli",
    "carrot",
    "hot dog",
    "pizza",
    "donut",
    "cake",
    "cell phone",
    "book",
    "vase",
    "scissors",
    "toothbrush",
    "teddy bear",
    "sports ball",
}


def trash_class_is_vague(raw_name: str) -> bool:
    name = (raw_name or "").lower().strip()
    return name in {"other", "other plastic", "unknown"} or name.startswith("other ")


def is_waste_like_class(raw_name: str, class_names: dict[int, str]) -> bool:
    """COCO-80 nano is for speed on UNO Q; keep only object types that can be litter."""
    if len(class_names) != 80:
        return True
    return (raw_name or "").lower().strip() in COCO_WASTE_LIKE


def is_structure_false_positive(
    box: list[float],
    img_w: int,
    img_h: int,
    raw_name: str,
    conf: float,
) -> bool:
    """ขอบเพดาน ประตู หรือวงกบที่โมเดลคลาส Other มักยิงใส่"""
    left, top, right, bottom = box
    box_w = max(1.0, right - left)
    box_h = max(1.0, bottom - top)
    touches_top = top <= img_h * 0.10
    wide_short = box_w >= img_w * 0.22 and box_h <= img_h * 0.40
    if touches_top and wide_short and conf < 0.85:
        return True
    touches_side = left <= img_w * 0.04 or right >= img_w * 0.96
    tall_thin = box_h >= img_h * 0.45 and box_w <= img_w * 0.18
    if touches_side and tall_thin and conf < 0.55:
        return True
    return False


# กระป๋อง (metal) จูนไว้ที่ 0.32 แล้ว — ประเภทอื่นโมเดลมั่นใจต่ำกว่า ต้องเกณฑ์คนละชุด
ACQUIRE_CONF = {
    "metal": 0.32,
    "glass": 0.26,
    "paper": 0.20,
    "plastic": 0.20,
    "trash": 0.22,
}
ACQUIRE_MIN_SIDE = {
    "metal": 22.0,
    "glass": 20.0,
    "paper": 18.0,
    "plastic": 16.0,
    "trash": 24.0,
}
ACQUIRE_MIN_AREA = {
    "metal": 0.012,
    "glass": 0.010,
    "paper": 0.008,
    "plastic": 0.006,
    "trash": 0.015,
}


def _box_from_stats(x: float, y: float, bw: float, bh: float, img_w: int, img_h: int, tw: int, th: int, pad: float = 0.015) -> list[float]:
    sx = img_w / float(tw)
    sy = img_h / float(th)
    left = x * sx
    top = y * sy
    right = (x + bw) * sx
    bottom = (y + bh) * sy
    box_w = max(1.0, right - left)
    box_h = max(1.0, bottom - top)
    left = max(0.0, left - box_w * pad)
    top = max(0.0, top - box_h * pad)
    right = min(float(img_w), right + box_w * pad)
    bottom = min(float(img_h), bottom + box_h * pad)
    return [left, top, right, bottom]


def _box_edge_hugs(box: list[float], img_w: int, img_h: int, margin: float = 0.04) -> int:
    left, top, right, bottom = box
    return (
        int(left <= img_w * margin)
        + int(right >= img_w * (1.0 - margin))
        + int(top <= img_h * margin)
        + int(bottom >= img_h * (1.0 - margin))
    )


def _hue_entropy(hsv_crop: np.ndarray) -> float:
    if hsv_crop.size == 0:
        return 0.0
    sat = hsv_crop[:, :, 1]
    hue = hsv_crop[:, :, 0]
    mask = sat > 40
    if int(np.count_nonzero(mask)) < 10:
        return 0.0
    hist, _ = np.histogram(hue[mask], bins=12, range=(0, 180))
    probs = hist.astype(np.float64)
    probs = probs / (probs.sum() + 1e-6)
    probs = probs[probs > 0]
    return float(-(probs * np.log(probs + 1e-9)).sum())


def _accept_object_box(box: list[float], image: np.ndarray, *, min_frac: float, max_frac: float, min_std: float) -> bool:
    img_h, img_w = image.shape[:2]
    left, top, right, bottom = box
    box_w = max(1.0, right - left)
    box_h = max(1.0, bottom - top)
    boxfrac = (box_w * box_h) / float(img_w * img_h)
    if boxfrac < min_frac or boxfrac > max_frac:
        return False
    if _box_edge_hugs(box, img_w, img_h, 0.03) >= 3:
        return False
    crop = image[int(max(0, top)) : int(min(img_h, bottom)), int(max(0, left)) : int(min(img_w, right))]
    if crop.size == 0:
        return False
    return float(np.std(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY))) >= min_std


def tighten_object_box(image: np.ndarray, box: list[float]) -> list[float]:
    """รัดกรอบให้ชิดขยะ — ตัดผนังมืด/พื้นโต๊ะ/ขอบจอ ที่ไม่ใช่ตัวซอง"""
    img_h, img_w = image.shape[:2]
    left, top, right, bottom = (float(v) for v in box)
    x1 = int(max(0, left))
    y1 = int(max(0, top))
    x2 = int(min(img_w, right))
    y2 = int(min(img_h, bottom))
    if x2 - x1 < 20 or y2 - y1 < 20:
        return [left, top, right, bottom]
    crop = image[y1:y2, x1:x2]
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1]
    val = hsv[:, :, 2]
    ch, cw = crop.shape[:2]
    min_w = max(16, int(cw * 0.62))
    min_h = max(16, int(ch * 0.70))
    lx, ty, rx, by = 0, 0, cw, ch

    def col_window_dark(x: int) -> bool:
        x0, x1 = max(lx, x - 1), min(rx, x + 2)
        dark = 0
        for cx in range(x0, x1):
            s = float(sat[:, cx].mean())
            v = float(val[:, cx].mean())
            if v < 72.0 or s > 155.0:
                dark += 1
        return dark >= max(1, x1 - x0 - 1)

    def row_is_dark_clutter(y: int) -> bool:
        v = float(val[y, lx:rx].mean())
        if v < 78.0:
            return True
        prev = float(val[max(0, y - 2), lx:rx].mean())
        nxt = float(val[min(ch - 1, y + 2), lx:rx].mean())
        return v > 150.0 and (prev < 78.0 or nxt < 78.0)

    def top_window_dark() -> bool:
        y_end = min(by, ty + 6)
        dark = sum(1 for y in range(ty, y_end) if row_is_dark_clutter(y))
        return dark >= 4

    while rx - lx > min_w and col_window_dark(lx):
        lx += 1
    while rx - lx > min_w and col_window_dark(rx - 1):
        rx -= 1
    while by - ty > min_h and top_window_dark():
        ty += 1
    pad = 0.012
    tw = float(max(1, rx - lx))
    th = float(max(1, by - ty))
    tight = [
        max(0.0, float(x1 + lx) - tw * pad),
        max(0.0, float(y1 + ty) - th * pad),
        min(float(img_w), float(x1 + rx) + tw * pad),
        min(float(img_h), float(y1 + by) + th * pad),
    ]
    return tight


def refine_center_object_box(image: np.ndarray, *, strict: bool = False) -> list[float] | None:
    """ซอง/ถุงที่ YOLO พลาด — เลือกก้อนสีฉลากบนโต๊ะ แล้วค่อย GrabCut"""
    img_h, img_w = image.shape[:2]
    min_frac, max_frac = (0.10, 0.48) if strict else (0.07, 0.52)
    min_std = 22.0 if strict else 16.0
    tw, th = 160, 120
    small = cv2.resize(image, (tw, th), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    filled = np.zeros((th, tw), np.uint8)
    seeds = [
        (2, 2),
        (tw - 3, 2),
        (2, th - 3),
        (tw - 3, th - 3),
        (tw // 2, 2),
        (2, th // 2),
        (tw - 3, th // 2),
        (tw // 2, th - 3),
    ]
    for seed_x, seed_y in seeds:
        tmp = small.copy()
        mask = np.zeros((th + 2, tw + 2), np.uint8)
        cv2.floodFill(
            tmp,
            mask,
            (seed_x, seed_y),
            (0, 0, 0),
            loDiff=(16, 16, 16),
            upDiff=(16, 16, 16),
            flags=4 | cv2.FLOODFILL_MASK_ONLY | (255 << 8),
        )
        filled |= mask[1:-1, 1:-1]
    obj = (filled == 0).astype(np.uint8) * 255
    obj = cv2.morphologyEx(obj, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    obj = cv2.morphologyEx(obj, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    mx = max(2, int(tw * 0.05))
    obj[:, :mx] = 0
    obj[:, tw - mx :] = 0
    _n, _labels, stats, _ = cv2.connectedComponentsWithStats(obj, 8)
    best: tuple[float, list[float]] | None = None
    for i in range(1, len(stats)):
        x, y, bw, bh, area = (float(v) for v in stats[i][:5])
        if bw < 14 or bh < 14:
            continue
        crop = hsv[int(y) : int(y + bh), int(x) : int(x + bw)]
        sat = float(np.mean(crop[:, :, 1])) if crop.size else 0.0
        box = _box_from_stats(x, y, bw, bh, img_w, img_h, tw, th)
        hugs = _box_edge_hugs(box, img_w, img_h)
        # ตลับเมตร/เครื่องมือสีฉูดชิดขอบ — อย่าให้ชนะซองกลางจอ
        if hugs and sat > 110.0:
            continue
        entropy = _hue_entropy(crop)
        if sat < 28.0 or entropy < 0.80:
            continue
        if not _accept_object_box(box, image, min_frac=min_frac, max_frac=max_frac, min_std=min_std):
            continue
        cx = (box[0] + box[2]) / 2.0
        cy = (box[1] + box[3]) / 2.0
        dist = math.hypot((cx - img_w / 2.0) / img_w, (cy - img_h / 2.0) / img_h)
        score = (entropy + 0.15) * math.sqrt(max(1.0, area)) * max(0.25, 1.20 - dist)
        if hugs:
            score *= 0.40
        if best is None or score > best[0]:
            best = (score, box)
    if best is not None:
        return tighten_object_box(image, best[1])

    tw, th = 128, 96
    small = cv2.resize(image, (tw, th), interpolation=cv2.INTER_AREA)
    mx, my = 8, 6
    gc = np.zeros((th, tw), np.uint8)
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(small, gc, (mx, my, tw - 2 * mx, th - 2 * my), bgd, fgd, 1, cv2.GC_INIT_WITH_RECT)
    fg = (gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD)
    ys, xs = np.where(fg)
    if xs.size < 80:
        return None
    box = [
        float(xs.min()) * img_w / tw,
        float(ys.min()) * img_h / th,
        float(xs.max()) * img_w / tw,
        float(ys.max()) * img_h / th,
    ]
    if not _accept_object_box(box, image, min_frac=min_frac, max_frac=max_frac, min_std=min_std):
        return None
    return tighten_object_box(image, box)


def _plastic_fallback_class(names: dict[int, str]) -> tuple[int, str]:
    for class_id, name in names.items():
        if str(name).lower().strip() == "plastic":
            return int(class_id), str(name)
    return 3, "plastic"


def acquire_score(det: dict[str, Any], img_w: int, img_h: int) -> float:
    """กระป๋อง/ขวดจาก YOLO มาก่อน ของชิดขอบ (ตะกร้า/วงกบ) ดึงออก"""
    conf = float(det["conf"])
    raw = str(det.get("raw_name", "")).lower().strip()
    hugs = _box_edge_hugs(det["box"], img_w, img_h)
    if hugs:
        conf *= 0.35
    if raw in {"metal", "glass"}:
        conf += 0.10
    elif raw == "plastic":
        conf += 0.04
    return conf


def can_acquire_trash(det: dict[str, Any], img_w: int, img_h: int) -> bool:
    """เริ่มล็อกตามชนิดขยะ — ซอง/กล่อง/พลาสติกเข้าได้ง่ายกว่า trash คลุมเครือ"""
    if int(det.get("class_id", 0)) >= 100:
        return False
    conf = float(det["conf"])
    raw = str(det.get("raw_name", "")).lower().strip()
    if trash_class_is_vague(raw):
        raw = "trash"
    left, top, right, bottom = det["box"]
    box_w = max(1.0, right - left)
    box_h = max(1.0, bottom - top)
    min_side = ACQUIRE_MIN_SIDE.get(raw, 22.0)
    min_area = ACQUIRE_MIN_AREA.get(raw, 0.012)
    need_conf = ACQUIRE_CONF.get(raw, 0.32)
    if box_w < min_side or box_h < min_side:
        return False
    if box_w * box_h < min_area * img_w * img_h:
        return False
    if _box_edge_hugs(det["box"], img_w, img_h) and raw in {"trash", "other"} and conf < 0.55:
        return False
    return conf >= need_conf


def trash_center_left_view(box: list[float], img_w: int, img_h: int) -> bool:
    cx = (box[0] + box[2]) / 2.0
    cy = (box[1] + box[3]) / 2.0
    return cx < 0.0 or cy < 0.0 or cx > img_w or cy > img_h


class LocalTrashDetector:
    def __init__(
        self,
        model_path: Path | None,
        oil_model_path: Path | None = DEFAULT_OIL_MODEL,
        nafta_model_path: Path | None = DEFAULT_NAFTA_MODEL,
        secondary_model_path: Path | None = None,
        confidence: float = 0.35,
        oil_confidence: float = 0.38,
        iou: float = 0.45,
        image_size: int = 640,
        hold_timeout: float = 0.80,
        oil_hold_timeout: float = 1.80,
        alpha: float = 0.50,
        max_targets: int = 1,
        max_oil_targets: int = 5,
        oil_fallback_path: Path | None = None,
        confirmation_hits: int = 3,
        oil_confirmation_hits: int = 3,
        parallel_inference: bool = False,
    ) -> None:
        self.model_path = model_path.resolve() if model_path and model_path.is_file() else None
        self.confidence = confidence
        self.oil_confidence = oil_confidence
        self.iou = iou
        self.image_size = image_size
        self.hold_timeout = hold_timeout
        self.oil_hold_timeout = oil_hold_timeout
        self.alpha = alpha
        self.max_targets = max(0, max_targets)
        self.max_oil_targets = max(1, min(5, max_oil_targets))
        self.confirmation_hits = max(1, confirmation_hits)
        self.oil_confirmation_hits = max(1, oil_confirmation_hits)
        self.parallel_inference = parallel_inference

        # Hardware acceleration: use Apple Silicon MPS if available, otherwise CPU
        self.device = "cpu"
        try:
            import torch
            if torch.backends.mps.is_available():
                self.device = "mps"
        except Exception:
            self.device = "cpu"

        self.model = None
        self.names: dict[int, str] = {}
        if self.model_path is not None:
            self.model = YOLO(str(self.model_path))
            self.names = {int(class_id): str(name) for class_id, name in self.model.names.items()}
        else:
            print("[local-ai] Trash model not installed — skip trash inference", flush=True)

        # NAFTA Oil Spill Semantic Segmentation (ResNet50-PSPNet)
        self.nafta_model = None
        self.nafta_model_path = None
        self.nafta_device = self.device
        self.smoothed_oil_prob = None
        self.last_oil_detect_time = 0.0
        self.cached_oil_predictions: list[dict[str, Any]] = []
        if nafta_model_path and nafta_model_path.is_file():
            try:
                import sys
                import torch
                if str(PROJECT_DIR) not in sys.path:
                    sys.path.insert(0, str(PROJECT_DIR))
                from models.nafta.nafta_pspnet import ResNet50_PSPNet_PyTorch, load_nafta_weights
                self.torch = torch
                self.nafta_model_path = nafta_model_path.resolve()
                self.nafta_model = ResNet50_PSPNet_PyTorch(n_classes=2)
                load_nafta_weights(self.nafta_model, str(self.nafta_model_path))
                self.nafta_device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
                self.nafta_model.to(self.nafta_device)
                self.nafta_model.eval()
                print(f"[local-ai] Loaded NAFTA PSPNet model on {self.nafta_device}: {self.nafta_model_path.name}", flush=True)
            except Exception as error:
                print(f"[local-ai] Warning: could not load NAFTA model: {error}", flush=True)

        # Oil spill segmentation model (models/oil.pt)
        self.oil_model = None
        self.oil_model_path = None
        self.oil_names = {}
        self.oil_auto_ready = False
        if oil_model_path and oil_model_path.is_file():
            try:
                self.oil_model_path = oil_model_path.resolve()
                self.oil_model = YOLO(str(self.oil_model_path))
                self.oil_names = {int(class_id): str(name) for class_id, name in self.oil_model.names.items()}
                validation_path = self.oil_model_path.with_suffix(".validation.json")
                if validation_path.is_file():
                    try:
                        validation = json.loads(validation_path.read_text())
                        self.oil_auto_ready = validation.get("auto_ready") is True
                    except (OSError, ValueError, AttributeError):
                        self.oil_auto_ready = False
                print(f"[local-ai] Loaded oil spill model: {self.oil_model_path.name} (classes: {self.oil_names})", flush=True)
            except Exception as error:
                print(f"[local-ai] Warning: could not load oil model: {error}", flush=True)

        # Optional secondary offline model
        self.oil_fallback_model = None
        self.oil_fallback_model_path = None
        if oil_fallback_path and oil_fallback_path.is_file():
            fallback = YOLO(str(oil_fallback_path))
            if fallback.task != "segment" or fallback.names != self.oil_names:
                raise ValueError("Oil fallback must have matching segmentation classes")
            self.oil_fallback_model = fallback
            self.oil_fallback_model_path = oil_fallback_path.resolve()
            # This cascade includes an experimental model; keep oil AUTO disabled.
            self.oil_auto_ready = False

        # Optional secondary offline model
        self.secondary_model = None
        self.secondary_model_path = None
        self.secondary_names = {}
        if secondary_model_path and secondary_model_path.is_file():
            try:
                self.secondary_model_path = secondary_model_path.resolve()
                self.secondary_model = YOLO(str(self.secondary_model_path))
                self.secondary_names = {
                    int(class_id): str(name)
                    for class_id, name in self.secondary_model.names.items()
                }
            except Exception as error:
                print(f"[local-ai] Warning: could not load secondary model: {error}", flush=True)

        self.lock = threading.Lock()
        self.frame_id = 0
        self.locked_target: LockedTarget | None = None
        self.primary_track_id: int | None = None
        self.locked_oil: LockedTarget | None = None
        self.primary_oil_track_id: int | None = None
        self.oil_tracks: dict[int, LockedOilTrack] = {}
        self.next_oil_track_id = 1
        self.tracked_objects: dict[int, Any] = {}
        self.next_track_id = 1
        self.last_frame_timestamp = 0.0
        self._detect_tick = 0
        self._cached_oil_result = None
        self._cached_secondary_boxes: list[Any] = []
        self.inference_executor = ThreadPoolExecutor(max_workers=2) if parallel_inference else None
        self._oil_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="oil") if self.oil_model is not None else None
        self._oil_future: Any | None = None

    def _predict_once(self, model: Any, image: np.ndarray, confidence: float) -> Any | None:
        results = model.predict(
            source=image,
            conf=confidence,
            iou=self.iou,
            agnostic_nms=True,
            imgsz=self.image_size,
            device=self.device,
            verbose=False,
        )
        return results[0] if results else None

    def _segment_oil_nafta(self, image: np.ndarray, now: float) -> tuple[list[dict[str, Any]], float]:
        """NAFTA ResNet50-PSPNet Semantic Segmentation for surface oil spills (with Temporal Smoothing & Noise Filtering)"""
        if self.nafta_model is None:
            return [], 0.0

        orig_h, orig_w = image.shape[:2]
        # Preprocessing: resize to 576x384 (divisible by 192), ImageNet BGR sub-mean
        resized = cv2.resize(image, (576, 384)).astype(np.float32)
        means = [103.939, 116.779, 123.68]
        for i in range(3):
            resized[:, :, i] -= means[i]
        tensor = self.torch.from_numpy(resized.transpose(2, 0, 1)).unsqueeze(0).to(self.nafta_device)

        with self.torch.no_grad():
            import torch.nn.functional as F
            logits = self.nafta_model(tensor)
            logits_orig = F.interpolate(logits, size=(orig_h, orig_w), mode="bilinear", align_corners=False)
            probs = F.softmax(logits_orig, dim=1)[0].cpu().numpy()
            raw_oil_prob = probs[1]

        # STEP 5: Temporal Probability Smoothing (EMA) เพื่อป้องกัน Mask กะพริบ
        if self.smoothed_oil_prob is None or self.smoothed_oil_prob.shape != raw_oil_prob.shape:
            self.smoothed_oil_prob = raw_oil_prob
        else:
            self.smoothed_oil_prob = 0.65 * raw_oil_prob + 0.35 * self.smoothed_oil_prob

        oil_prob = self.smoothed_oil_prob

        # STEP 6: Binary Thresholding & Morphological Noise Cleanup
        binary_mask = (oil_prob >= 0.45).astype(np.uint8) * 255
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        clean_mask = cv2.morphologyEx(binary_mask, cv2.MORPH_OPEN, kernel)
        clean_mask = cv2.morphologyEx(clean_mask, cv2.MORPH_CLOSE, kernel)

        contours, _ = cv2.findContours(clean_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        oil_predictions: list[dict[str, Any]] = []
        total_oil_area = 0.0

        for idx, c in enumerate(contours):
            area = cv2.contourArea(c)
            if area < 75.0:  # กรองจุดรบกวนขนาดเล็กมาก
                continue
            x, y, w, h = cv2.boundingRect(c)
            # กรองภาพเสียที่คลุมเกือบทั้งหน้าจอ (>94% ทั้งกว้างและยาว)
            if w >= 0.94 * orig_w and h >= 0.94 * orig_h:
                continue
            # กรองแถบลวงชิดขอบหรือติ่งมุมกล้อง (Edge Vignette / Boundary Sliver Artifact)
            if is_edge_sliver_artifact([float(x), float(y), float(x + w), float(y + h)], orig_w, orig_h, is_oil=True):
                continue

            total_oil_area += area
            M = cv2.moments(c)
            if M["m00"] > 0:
                cx = float(M["m10"] / M["m00"])
                cy = float(M["m01"] / M["m00"])
            else:
                cx, cy = float(x + w / 2.0), float(y + h / 2.0)

            # Approximate Polygon Points สำหรับการเรนเดอร์ขอบเขตคราบน้ำมันที่แนบเนียนบนหน้าเว็บ
            epsilon = 0.007 * cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, epsilon, True)
            pts = [{"x": round(float(p[0][0]), 1), "y": round(float(p[0][1]), 1)} for p in approx]

            # คำนวณค่า Confidence สูงสุดและเฉลี่ยภายในบริเวณคราบ
            patch_mask = np.zeros_like(clean_mask)
            cv2.drawContours(patch_mask, [c], -1, 1, -1)
            conf = float(np.max(oil_prob[patch_mask == 1])) if np.count_nonzero(patch_mask) > 0 else 0.50

            oil_predictions.append({
                "track_id": idx + 1,
                "class_id": 1,
                "class_name": "คราบน้ำมัน",
                "class_name_en": "Oil Spill",
                "raw_class_name": "oil_spill",
                "oil_type": "คราบน้ำมัน (Oil Spill)",
                "type": "oil",
                "confidence": round(conf, 3),
                "status": "DETECTED",
                "x": round(cx, 1),
                "y": round(cy, 1),
                "pixel_x": round(cx),
                "pixel_y": round(cy),
                "width": round(float(w), 1),
                "height": round(float(h), 1),
                "area_px": int(round(area)),
                "area_pct": round(float(area / (orig_w * orig_h) * 100), 2),
                "points": pts,
            })

        # Short Persistence Timeout (0.50s) คง Mask สั้นเพื่อกันภาพกะพริบ
        if oil_predictions:
            self.cached_oil_predictions = oil_predictions
            self.last_oil_detect_time = now
        elif (now - self.last_oil_detect_time) <= 0.50 and self.cached_oil_predictions:
            elapsed = now - self.last_oil_detect_time
            decay = max(0.5, 1.0 - (elapsed / 0.50) * 0.3)
            oil_predictions = [
                {**item, "status": "TRACKED", "confidence": round(item["confidence"] * decay, 3)}
                for item in self.cached_oil_predictions
            ]
        else:
            self.cached_oil_predictions = []

        total_area_pct = round(float(total_oil_area / (orig_w * orig_h) * 100), 2)
        return oil_predictions, total_area_pct

        # Optional secondary offline model
        self.secondary_model = None
        self.secondary_model_path = None
        self.secondary_names = {}
        if secondary_model_path and secondary_model_path.is_file():
            try:
                self.secondary_model_path = secondary_model_path.resolve()
                self.secondary_model = YOLO(str(self.secondary_model_path))
                self.secondary_names = {
                    int(class_id): str(name)
                    for class_id, name in self.secondary_model.names.items()
                }
            except Exception as error:
                print(f"[local-ai] Warning: could not load secondary model: {error}", flush=True)

        self.lock = threading.Lock()
        self.frame_id = 0
        self.locked_target: LockedTarget | None = None
        self.primary_track_id: int | None = None
        self.locked_oil: LockedTarget | None = None
        self.primary_oil_track_id: int | None = None
        self.oil_tracks: dict[int, LockedOilTrack] = {}
        self.next_oil_track_id = 1
        self.tracked_objects: dict[int, Any] = {}
        self.next_track_id = 1
        self.last_frame_timestamp = 0.0

    def detect(self, encoded_image: str, enable_trash: bool = True, enable_oil: bool = True) -> dict[str, Any]:
        if not encoded_image or len(encoded_image) > MAX_IMAGE_LENGTH:
            raise ValueError("Image is empty or too large")
        try:
            image_bytes = base64.b64decode(encoded_image, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("Image is not valid base64") from error

        image_array = np.frombuffer(image_bytes, dtype=np.uint8)
        image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("Image is not a valid JPG or PNG")
        return self.detect_frame(image, enable_trash=enable_trash, enable_oil=enable_oil)

    def detect_frame(self, image: np.ndarray, enable_trash: bool = True, enable_oil: bool = True) -> dict[str, Any]:
        if image is None or image.size == 0:
            raise ValueError("Image is not a valid JPG or PNG")
        if self.frame_id % 30 == 0:
            cv2.imwrite("/tmp/live_cam_frame.jpg", image)

        now = time.perf_counter()
        idle_reset_timeout = max(2.0, self.hold_timeout, self.oil_hold_timeout)
        if self.last_frame_timestamp > 0 and (now - self.last_frame_timestamp) > idle_reset_timeout:
            self.locked_target = None
            self.primary_track_id = None
            self.locked_oil = None
            self.primary_oil_track_id = None
            self.oil_tracks.clear()
            self.tracked_objects.clear()
            self.next_track_id = 1
        self.last_frame_timestamp = now

        started = time.perf_counter()
        result = None
        oil_result = None
        secondary_boxes = []

        with self.lock:
            self._detect_tick += 1
            # ขยะทุกเฟรมบนเธรดหลัก — น้ำมันรันพื้นหลังแล้วส่งผลมาล็อก ไม่ฉุดเป้าขยะ
            run_aux = self._detect_tick % 8 == 0
            inference_jobs: dict[str, tuple[Any, float]] = {}
            if enable_trash and self.model is not None:
                inference_jobs["trash"] = (self.model, self.confidence)
                if run_aux and self.secondary_model is not None:
                    inference_jobs["secondary"] = (self.secondary_model, max(0.20, self.confidence))
            else:
                self.locked_target = None
                self.primary_track_id = None

            if not enable_oil:
                self.oil_tracks.clear()
                self.locked_oil = None
                self.primary_oil_track_id = None

            inference_results: dict[str, Any | None] = {}
            if self.inference_executor is not None and len(inference_jobs) > 1:
                futures = {
                    name: self.inference_executor.submit(self._predict_once, model, image, confidence)
                    for name, (model, confidence) in inference_jobs.items()
                }
                for name, future in futures.items():
                    try:
                        inference_results[name] = future.result()
                    except Exception as err:
                        print(f"[local-ai] {name} model inference warning: {err}", flush=True)
            else:
                for name, (model, confidence) in inference_jobs.items():
                    try:
                        inference_results[name] = self._predict_once(model, image, confidence)
                    except Exception as err:
                        print(f"[local-ai] {name} model inference warning: {err}", flush=True)

            result = inference_results.get("trash")
            secondary_result = inference_results.get("secondary")
            if secondary_result is not None and secondary_result.boxes is not None:
                secondary_boxes = secondary_result.boxes
                self._cached_secondary_boxes = secondary_boxes
            elif not run_aux:
                secondary_boxes = self._cached_secondary_boxes

            oil_result = None
            if enable_oil and self.oil_model is not None:
                if self._oil_future is not None and self._oil_future.done():
                    try:
                        oil_result = self._oil_future.result()
                        self._cached_oil_result = oil_result
                    except Exception as err:
                        print(f"[local-ai] oil model inference warning: {err}", flush=True)
                    self._oil_future = None
                if self._oil_future is None and self._oil_executor is not None:
                    self._oil_future = self._oil_executor.submit(
                        self._predict_once, self.oil_model, image.copy(), self.oil_confidence
                    )

            self.frame_id += 1
            frame_id = self.frame_id
        elapsed_ms = (time.perf_counter() - started) * 1000

        # สกัดกล่องคราบน้ำมันดิบสำหรับตรวจสอบการทับซ้อนกับขยะ (Cross-Model Overlap Filter)
        current_oil_boxes: list[list[float]] = []
        oil_box_source = oil_result if oil_result is not None else self._cached_oil_result
        if oil_box_source is not None and oil_box_source.boxes is not None and len(oil_box_source.boxes) > 0:
            for ob in oil_box_source.boxes:
                current_oil_boxes.append([float(v) for v in ob.xyxy[0].tolist()])

        # --- A. ประมวลผลและกรองขยะ (Trash Detection Standard) ---
        raw_detections: list[dict[str, Any]] = []
        img_h, img_w = image.shape[:2]

        if enable_trash and result is not None and result.boxes is not None and len(result.boxes) > 0:
            for box in result.boxes:
                left, top, right, bottom = (float(value) for value in box.xyxy[0].tolist())
                conf = float(box.conf.item())
                if not is_valid_trash_candidate([left, top, right, bottom], image, conf, current_oil_boxes):
                    continue
                if is_edge_sliver_artifact([left, top, right, bottom], img_w, img_h):
                    continue
                class_id = int(box.cls.item())
                raw_name = self.names.get(class_id, "unknown")
                if not is_waste_like_class(raw_name, self.names):
                    continue
                if is_structure_false_positive([left, top, right, bottom], img_w, img_h, raw_name, conf):
                    continue
                raw_detections.append(
                    {
                        "class_id": class_id,
                        "raw_name": raw_name,
                        "conf": conf,
                        "box": [left, top, right, bottom],
                    }
                )

        if secondary_boxes:
            for box in secondary_boxes:
                left, top, right, bottom = (float(value) for value in box.xyxy[0].tolist())
                conf = float(box.conf.item())
                if not is_valid_trash_candidate([left, top, right, bottom], image, conf, current_oil_boxes):
                    continue
                if is_edge_sliver_artifact([left, top, right, bottom], img_w, img_h):
                    continue
                class_id = int(box.cls.item())
                raw_name = self.secondary_names.get(class_id, "box")
                raw_detections.append(
                    {
                        "class_id": 100 + class_id,
                        "raw_name": raw_name,
                        "conf": conf,
                        "box": [left, top, right, bottom],
                    }
                )

        # Intra-frame NMS: ตัดกรอบซ้อนทับกันเองในเฟรมเดียวกัน
        raw_detections.sort(key=lambda d: d["conf"], reverse=True)
        deduped_detections: list[dict[str, Any]] = []
        for det in raw_detections:
            if not any(
                is_same_object_overlap(det["box"], kept["box"], iou_th=0.35, ios_th=0.55)
                for kept in deduped_detections
            ):
                deduped_detections.append(det)

        locked_raw = str(self.locked_target.raw_name).lower().strip() if self.locked_target is not None else ""
        yolo_solid = any(
            can_acquire_trash(det, img_w, img_h) and str(det.get("raw_name", "")).lower().strip() == "metal"
            for det in deduped_detections
        )
        skip_wrapper_fallback = yolo_solid or locked_raw in {"metal", "glass"}
        if enable_trash and not skip_wrapper_fallback:
            try:
                refined = refine_center_object_box(image, strict=False)
            except Exception:
                refined = None
            if refined is not None and self.locked_target is not None:
                if not is_same_object_overlap(refined, self.locked_target.box, iou_th=0.20, ios_th=0.35):
                    refined = None
            if refined is not None:
                plastic_id, plastic_name = _plastic_fallback_class(self.names)
                fallback = {
                    "class_id": plastic_id,
                    "raw_name": plastic_name,
                    "conf": 0.46,
                    "box": refined,
                    "source": "fallback",
                }
                overlaps_locked = any(
                    is_same_object_overlap(refined, det["box"], iou_th=0.35, ios_th=0.55)
                    for det in deduped_detections
                    if can_acquire_trash(det, img_w, img_h)
                )
                if (
                    not overlaps_locked
                    and is_valid_trash_candidate(refined, image, 0.46, current_oil_boxes)
                    and can_acquire_trash(fallback, img_w, img_h)
                ):
                    deduped_detections.append(fallback)

        # ล็อกชิ้นเดิมตอนแพนข้ามชิ้นข้าง ๆ — สะบัดพ้นจอแล้วปล่อยกรอบทันที
        if self.locked_target is not None and trash_center_left_view(self.locked_target.box, img_w, img_h):
            self.locked_target = None
            self.primary_track_id = None

        matched_det: dict[str, Any] | None = None
        dropped_box: list[float] | None = None
        dropped_raw = ""
        if self.locked_target is not None:
            ranked: list[tuple[float, float, int, float]] = []
            for idx, det in enumerate(deduped_detections):
                if det.get("source") == "fallback" and locked_raw in {"metal", "glass"}:
                    continue
                geo = compute_target_match_score(det, self.locked_target, now)
                appearance = hist_corr(self.locked_target.hist, crop_hsv_hist(image, det["box"]))
                det_cx = (det["box"][0] + det["box"][2]) / 2.0
                det_cy = (det["box"][1] + det["box"][3]) / 2.0
                tgt_cx = (self.locked_target.box[0] + self.locked_target.box[2]) / 2.0
                tgt_cy = (self.locked_target.box[1] + self.locked_target.box[3]) / 2.0
                w_tgt = max(1.0, self.locked_target.box[2] - self.locked_target.box[0])
                h_tgt = max(1.0, self.locked_target.box[3] - self.locked_target.box[1])
                near = abs(det_cx - tgt_cx) < max(130.0, w_tgt * 1.6) and abs(det_cy - tgt_cy) < max(110.0, h_tgt * 1.6)
                # ลายเดิมใกล้กรอบเดิม = ชิ้นเดิมแม้ YOLO มั่นใจต่ำ; ซองคนละลายจะไม่ผ่าน
                if geo < 0.12 and not (appearance >= 0.50 and near):
                    continue
                fused = 0.50 * max(geo, 0.0) + 0.50 * max(appearance, 0.0)
                if fused < 0.18 and not (appearance >= 0.55 and near):
                    continue
                iou, _ios = box_overlap_metrics(det["box"], self.locked_target.box)
                ranked.append((fused, iou, idx, appearance))
            if ranked:
                _fused, _iou, best_idx, appearance = max(ranked)
                matched_det = deduped_detections[best_idx]
                layers = ("detect", "motion")
                if appearance >= 0.45:
                    layers = ("detect", "motion", "appearance")
                self.locked_target.update(
                    matched_det["box"],
                    matched_det["conf"],
                    now,
                    alpha=self.alpha,
                    image=image,
                    layers=layers,
                )
            else:
                pred_box = self.locked_target.predicted_box(now, img_w, img_h)
                coast_app = hist_corr(self.locked_target.hist, crop_hsv_hist(image, pred_box))
                still_in_view = not trash_center_left_view(pred_box, img_w, img_h)
                # ลายชิ้นเดิมยังอยู่ที่จุดที่คาด = แพนตามเป้า ล็อกต่อ; สะบัดไปฉากใหม่ลายไม่ตรง = ปล่อยทันที
                if still_in_view and coast_app >= 0.45:
                    self.locked_target.update(
                        pred_box,
                        max(0.30, float(self.locked_target.confidence) * 0.94),
                        now,
                        alpha=0.32,
                        image=image,
                        layers=("appearance", "hold"),
                    )
                    matched_det = {
                        "class_id": self.locked_target.class_id,
                        "raw_name": self.locked_target.raw_name,
                        "conf": self.locked_target.confidence,
                        "box": list(self.locked_target.box),
                    }
                elif still_in_view and (now - self.locked_target.last_seen) <= max(0.28, float(self.hold_timeout)):
                    self.locked_target.misses += 1
                    self.locked_target.keep_layers = ("hold",)
                    matched_det = {
                        "class_id": self.locked_target.class_id,
                        "raw_name": self.locked_target.raw_name,
                        "conf": self.locked_target.confidence,
                        "box": list(self.locked_target.box),
                    }
                else:
                    dropped_box = list(self.locked_target.box)
                    dropped_raw = self.locked_target.raw_name
                    self.locked_target = None
                    self.primary_track_id = None

        if self.locked_target is None:
            acquirable = [det for det in deduped_detections if can_acquire_trash(det, img_w, img_h)]
            if dropped_box is not None:
                acquirable = [
                    det
                    for det in acquirable
                    if lock_class_compatible(dropped_raw, str(det.get("raw_name", "")))
                    and is_same_object_overlap(det["box"], dropped_box, iou_th=0.18, ios_th=0.32)
                ]
            if acquirable:
                best_cand = max(acquirable, key=lambda d: acquire_score(d, img_w, img_h))
                best_cand = {**best_cand, "box": tighten_object_box(image, best_cand["box"])}
                target_id = self.next_track_id
                self.next_track_id += 1
                self.locked_target = LockedTarget(
                    track_id=target_id,
                    class_id=best_cand["class_id"],
                    raw_name=best_cand["raw_name"],
                    box=best_cand["box"],
                    conf=best_cand["conf"],
                    timestamp=now,
                    confirmation_hits=self.confirmation_hits,
                )
                self.locked_target.remember_appearance(image)
                self.locked_target.keep_layers = ("detect", "motion", "appearance")
                self.primary_track_id = target_id
                matched_det = best_cand

        predictions: list[dict[str, Any]] = []
        if self.max_targets > 1:
            for idx, det in enumerate(deduped_detections[: self.max_targets]):
                left, top, right, bottom = det["box"]
                center_x = (left + right) / 2.0
                center_y = (top + bottom) / 2.0
                predictions.append(
                    {
                        "track_id": idx + 1,
                        "class_id": det["class_id"],
                        "class_name": trash_display_names(det["raw_name"])[0],
                        "class_name_en": trash_display_names(det["raw_name"])[1],
                        "raw_class_name": det["raw_name"],
                        "type": "trash",
                        "confidence": float(det["conf"]),
                        "status": "DETECTED",
                        "x": center_x,
                        "y": center_y,
                        "pixel_x": round(center_x),
                        "pixel_y": round(center_y),
                        "width": right - left,
                        "height": bottom - top,
                    }
                )
        elif (
            self.locked_target is not None
            and self.locked_target.is_confirmed
            and matched_det is not None
        ):
            status = "DETECTED"
            conf = float(self.locked_target.confidence)

            left, top, right, bottom = self.locked_target.box
            center_x = (left + right) / 2.0
            center_y = (top + bottom) / 2.0
            predictions.append(
                {
                    "track_id": self.locked_target.track_id,
                    "class_id": self.locked_target.class_id,
                    "class_name": trash_display_names(self.locked_target.raw_name)[0],
                    "class_name_en": trash_display_names(self.locked_target.raw_name)[1],
                    "raw_class_name": self.locked_target.raw_name,
                    "type": "trash",
                    "confidence": conf,
                    "status": status,
                    "x": center_x,
                    "y": center_y,
                    "pixel_x": round(center_x),
                    "pixel_y": round(center_y),
                    "width": right - left,
                    "height": bottom - top,
                    "lock_layers": list(self.locked_target.keep_layers),
                }
            )

        # --- B. ประมวลผลและกรองคราบน้ำมัน (Oil Spill Segmentation & Tracking) ---
        oil_predictions: list[dict[str, Any]] = []
        oil_total_area_pct: float = 0.0

        if not enable_oil:
            oil_predictions = []
            oil_total_area_pct = 0.0
            self.oil_tracks.clear()
            self.locked_oil = None
            self.primary_oil_track_id = None
        elif self.nafta_model is not None:
            # 1. NAFTA ResNet50-PSPNet Semantic Segmentation (Pixel-precise Masks & Polygons)
            oil_predictions, oil_total_area_pct = self._segment_oil_nafta(image, now)
        elif self.oil_model is not None:
            # 2. YOLO11n-seg Instance Segmentation for Oil Spill with Multi-Track Temporal Hold
            raw_oil_detections: list[dict[str, Any]] = []
            if oil_result is not None and oil_result.boxes is not None and len(oil_result.boxes) > 0:
                has_masks = oil_result.masks is not None and len(oil_result.masks) > 0
                for i, box in enumerate(oil_result.boxes):
                    left, top, right, bottom = (float(v) for v in box.xyxy[0].tolist())
                    box_w = right - left
                    box_h = bottom - top
                    # กรองวัตถุที่กินพื้นที่ทั้งจอหรือขอบจอ (เช่น ลายเพดานหรือฝ้าเพดานที่กินพื้นที่เกือบทั้งภาพ)
                    if (box_w >= 0.85 * img_w and box_h >= 0.70 * img_h) or (box_w * box_h >= 0.50 * img_w * img_h):
                        continue
                    if box_w < 8.0 or box_h < 8.0:
                        continue
                    # กรองเส้นลวงยาวแคบผิดปกติ — ฟิล์มบางบนน้ำยาวได้มากกว่ากระเบื้อง
                    if (box_w / (box_h + 1e-4) > 6.0) or (box_h / (box_w + 1e-4) > 6.0):
                        continue
                    if is_edge_sliver_artifact([left, top, right, bottom], img_w, img_h, is_oil=True):
                        continue
                    class_id = int(box.cls.item())
                    raw_name = self.oil_names.get(class_id, "oil")
                    conf = float(box.conf.item())

                    # สกัด Polygon Points จาก YOLO11-seg mask สำหรับวาดเส้นครอบบน Dashboard
                    poly_pts: list[dict[str, float]] = []
                    if has_masks and i < len(oil_result.masks.xy):
                        poly = oil_result.masks.xy[i]
                        if len(poly) >= 3:
                            poly_arr = np.array(poly, dtype=np.int32)
                            poly_area = cv2.contourArea(poly_arr)
                            hull_area = cv2.contourArea(cv2.convexHull(poly_arr))
                            solidity = poly_area / (hull_area + 1e-5)
                            extent = poly_area / (box_w * box_h + 1e-5)
                            # กรองเส้นซิกแซกลายกระเบื้องฝ้าเพดานและรอยตะเข็บยาว (ลายเพดานจะมี solidity และ extent ต่ำมาก)
                            if solidity < 0.32 or extent < 0.16:
                                continue
                            step = max(1, len(poly) // 32)
                            poly_pts = [{"x": round(float(pt[0]), 1), "y": round(float(pt[1]), 1)} for pt in poly[::step]]

                    area_pct = round(((box_w * box_h) / (img_w * img_h)) * 100, 2)
                    if area_pct > 50.0:
                        continue
                    if not is_plausible_oil_region(image, [left, top, right, bottom], conf, raw_name):
                        continue

                    raw_oil_detections.append(
                        {
                            "class_id": class_id,
                            "raw_name": raw_name,
                            "oil_type": OIL_CLASS_MAP.get(raw_name, "คราบน้ำมัน"),
                            "conf": conf,
                            "box": [left, top, right, bottom],
                            "points": poly_pts,
                            "area_pct": area_pct,
                        }
                    )

            # Intra-frame NMS สำหรับคราบน้ำมัน: คัดเฉพาะหยดที่ชัดเจนและตัดกล่องทับซ้อนกันเอง
            raw_oil_detections.sort(key=lambda d: d["conf"], reverse=True)
            deduped_oil_detections: list[dict[str, Any]] = []
            for det in raw_oil_detections:
                if not any(
                    is_same_object_overlap(det["box"], kept["box"], iou_th=0.25, ios_th=0.35)
                    for kept in deduped_oil_detections
                ):
                    deduped_oil_detections.append(det)

            max_oil_regions = min(5, getattr(self, "max_oil_targets", 5))
            oil_hold = max(0.28, float(self.oil_hold_timeout))
            matched_track_ids: set[int] = set()
            used_det_indices: set[int] = set()

            for track_id, track in list(self.oil_tracks.items()):
                if trash_center_left_view(track.box, img_w, img_h) or not is_plausible_oil_region(
                    image, track.box, track.confidence, track.raw_name
                ):
                    del self.oil_tracks[track_id]

            for track_id, track in list(self.oil_tracks.items()):
                ranked: list[tuple[float, int, float]] = []
                for d_idx, det in enumerate(deduped_oil_detections):
                    if d_idx in used_det_indices:
                        continue
                    geo = compute_target_match_score(det, track, now)
                    appearance = hist_corr(track.hist, crop_hsv_hist(image, det["box"]))
                    det_cx = (det["box"][0] + det["box"][2]) / 2.0
                    det_cy = (det["box"][1] + det["box"][3]) / 2.0
                    tgt_cx = (track.box[0] + track.box[2]) / 2.0
                    tgt_cy = (track.box[1] + track.box[3]) / 2.0
                    w_tgt = max(1.0, track.box[2] - track.box[0])
                    h_tgt = max(1.0, track.box[3] - track.box[1])
                    near = abs(det_cx - tgt_cx) < max(130.0, w_tgt * 1.6) and abs(det_cy - tgt_cy) < max(110.0, h_tgt * 1.6)
                    if geo < 0.12 and not (appearance >= 0.50 and near):
                        continue
                    fused = 0.50 * max(geo, 0.0) + 0.50 * max(appearance, 0.0)
                    if fused < 0.18 and not (appearance >= 0.55 and near):
                        continue
                    ranked.append((fused, d_idx, appearance))
                if ranked:
                    _fused, best_idx, appearance = max(ranked)
                    matched = deduped_oil_detections[best_idx]
                    layers: tuple[str, ...] = ("detect", "motion")
                    if appearance >= 0.45:
                        layers = ("detect", "motion", "appearance")
                    track.update(
                        matched["box"],
                        matched["points"],
                        matched["conf"],
                        matched["area_pct"],
                        now,
                        alpha=self.alpha,
                        image=image,
                        layers=layers,
                    )
                    track.raw_name = str(matched.get("raw_name", track.raw_name))
                    track.oil_type = str(matched.get("oil_type", track.oil_type))
                    matched_track_ids.add(track_id)
                    used_det_indices.add(best_idx)
                    continue

                pred_box = track.predicted_box(now, img_w, img_h)
                coast_app = hist_corr(track.hist, crop_hsv_hist(image, pred_box))
                still_in_view = not trash_center_left_view(pred_box, img_w, img_h)
                if (
                    still_in_view
                    and coast_app >= 0.45
                    and is_plausible_oil_region(image, pred_box, track.confidence, track.raw_name)
                ):
                    pred_area = ((pred_box[2] - pred_box[0]) * (pred_box[3] - pred_box[1]) / (img_w * img_h)) * 100
                    track.update(
                        pred_box,
                        [],
                        max(0.30, float(track.confidence) * 0.94),
                        pred_area,
                        now,
                        alpha=0.32,
                        image=image,
                        layers=("appearance", "hold"),
                    )
                    matched_track_ids.add(track_id)
                elif still_in_view and (now - track.last_seen) <= oil_hold:
                    track.misses += 1
                    track.keep_layers = ("hold",)
                    matched_track_ids.add(track_id)
                else:
                    del self.oil_tracks[track_id]

            open_slots = max(0, max_oil_regions - len(self.oil_tracks))
            for d_idx, det in enumerate(deduped_oil_detections):
                if open_slots <= 0:
                    break
                if d_idx in used_det_indices:
                    continue
                if any(
                    is_same_object_overlap(det["box"], track.box, iou_th=0.25, ios_th=0.35)
                    for track in self.oil_tracks.values()
                ):
                    continue
                t_id = self.next_oil_track_id
                self.next_oil_track_id += 1
                new_track = LockedOilTrack(
                    track_id=t_id,
                    box=det["box"],
                    points=det["points"],
                    conf=det["conf"],
                    area_pct=det["area_pct"],
                    timestamp=now,
                    oil_type=det["oil_type"],
                    raw_name=str(det.get("raw_name", "oil")),
                    confirmation_hits=self.oil_confirmation_hits,
                )
                new_track.remember_appearance(image)
                new_track.keep_layers = ("detect", "motion", "appearance")
                self.oil_tracks[t_id] = new_track
                matched_track_ids.add(t_id)
                open_slots -= 1

            valid_tracks = [
                (track_id, track, now - track.last_seen)
                for track_id, track in self.oil_tracks.items()
                if track.is_confirmed and track.confidence >= max(0.32, float(self.oil_confidence) * 0.85)
            ]
            valid_tracks.sort(key=lambda item: item[1].confidence, reverse=True)

            for t_id, track, elapsed_hold in valid_tracks[:max_oil_regions]:
                status = "DETECTED" if t_id in matched_track_ids and "hold" not in track.keep_layers else "TRACKED"
                if "detect" in track.keep_layers:
                    status = "DETECTED"
                conf = track.confidence
                if status == "TRACKED":
                    decay = max(0.0, 1.0 - (elapsed_hold / max(oil_hold, 1e-3)) * 0.25)
                    conf = max(0.20, conf * decay)

                left, top, right, bottom = track.box
                center_x = (left + right) / 2.0
                center_y = (top + bottom) / 2.0
                oil_predictions.append(
                    {
                        "track_id": t_id,
                        "class_id": 0,
                        "class_name": "คราบน้ำมัน",
                        "class_name_en": "Oil Spill",
                        "raw_class_name": track.raw_name,
                        "oil_type": track.oil_type,
                        "type": "oil",
                        "confidence": float(conf),
                        "status": status,
                        "x": center_x,
                        "y": center_y,
                        "pixel_x": round(center_x),
                        "pixel_y": round(center_y),
                        "width": right - left,
                        "height": bottom - top,
                        "points": track.points,
                        "area_pct": track.area_pct,
                        "lock_layers": list(track.keep_layers),
                    }
                )

            oil_total_area_pct = round(sum(d["area_pct"] for d in oil_predictions), 2)
            self.primary_oil_track_id = oil_predictions[0]["track_id"] if oil_predictions else None

        for item in oil_predictions:
            item["auto_eligible"] = self.oil_auto_ready
        all_predictions = predictions + oil_predictions

        # --- STEP 9: Priority Decision System (ขยะอันดับ 1, คราบน้ำมันอันดับ 2) ---
        has_trash = len(predictions) > 0
        has_oil = len(oil_predictions) > 0
        if has_trash and has_oil:
            priority_decision = "trash_priority"
            priority_th = "พบขยะและน้ำมัน (เก็บขยะก่อน)"
            priority_en = "Trash & Oil (Trash Priority)"
        elif has_trash:
            priority_decision = "trash"
            priority_th = "พบขยะ"
            priority_en = "Trash Target"
        elif has_oil:
            priority_decision = "oil"
            priority_th = "พบคราบน้ำมัน"
            priority_en = "Oil Spill Target"
        else:
            priority_decision = "searching"
            priority_th = "กำลังค้นหาเป้าหมาย"
            priority_en = "Searching"

        timing = (
            {key: round(float(value), 3) for key, value in result.speed.items()}
            if (result is not None and hasattr(result, "speed") and isinstance(result.speed, dict))
            else (
                {key: round(float(value), 3) for key, value in oil_result.speed.items()}
                if (oil_result is not None and hasattr(oil_result, "speed") and isinstance(oil_result.speed, dict))
                else {"preprocess": 0.0, "inference": 0.0, "postprocess": 0.0}
            )
        )
        active_models = []
        if enable_trash and self.model_path is not None:
            active_models.append(self.model_path.name)
        if enable_oil:
            if self.nafta_model is not None and self.nafta_model_path is not None:
                active_models.append(f"NAFTA PSPNet ({self.nafta_model_path.name})")
            elif self.oil_model is not None and self.oil_model_path is not None:
                active_models.append(self.oil_model_path.name)
        if enable_trash and self.secondary_model is not None and self.secondary_model_path is not None:
            active_models.append(self.secondary_model_path.name)
        active_model_desc = " + ".join(active_models) if active_models else "None"
        if enable_oil and self.oil_fallback_model_path is not None:
            active_model_desc += f" + oil-fallback:{self.oil_fallback_model_path.name}"

        response = {
            "predictions": all_predictions,
            "trash_predictions": predictions,
            "oil_predictions": oil_predictions,
            "meta": {
                "source": "local",
                "model": active_model_desc,
                "device": self.device,
                "classes": self.names,
                "oil_classes": ({"1": "คราบน้ำมัน (Oil Spill)"} if self.nafta_model is not None else {str(k): OIL_CLASS_MAP.get(v, v) for k, v in self.oil_names.items()}) if (self.nafta_model is not None or self.oil_model is not None) else {},
                "confidence_threshold": self.confidence,
                "oil_confidence_threshold": 0.45 if self.nafta_model is not None else self.oil_confidence,
                "nms_iou": self.iou,
                "inference_imgsz": self.image_size,
                "parallel_inference": self.parallel_inference,
                "hold_timeout": self.hold_timeout,
                "confirmation_hits": self.confirmation_hits,
                "oil_confirmation_hits": self.oil_confirmation_hits,
                "ema_alpha": self.alpha,
                "max_targets": self.max_targets,
                "max_oil_targets": self.max_oil_targets,
                "primary_track_id": self.locked_target.track_id if self.locked_target is not None else None,
                "primary_oil_track_id": oil_predictions[0]["track_id"] if oil_predictions else None,
                "oil_total_area_pct": oil_total_area_pct,
                "oil_regions_count": len(oil_predictions),
                "oil_auto_ready": self.oil_auto_ready,
                "priority_decision": priority_decision,
                "priority_decision_th": priority_th,
                "priority_decision_en": priority_en,
                "trash_status": "ACTIVE" if enable_trash and self.model is not None else "DISABLED",
                "oil_status": ("ACTIVE" if (self.nafta_model is not None or self.oil_model is not None) else "PREPARING") if enable_oil else "DISABLED",
                "input_width": int(image.shape[1]),
                "input_height": int(image.shape[0]),
                "frame_id": frame_id,
                "fps": round(1000 / elapsed_ms, 2) if elapsed_ms > 0 else 0,
                "total_ms": round(elapsed_ms, 3),
                "timing_ms": timing,
            },
        }
        trash_info = ", ".join(
            f"Trash ID {item['track_id']} ({item['raw_class_name']}) : {item['confidence']:.2f} at ({item['pixel_x']},{item['pixel_y']})"
            for item in predictions
        ) or "none"
        oil_log_part = ""
        if self.nafta_model is not None or self.oil_model is not None:
            oil_info = ", ".join(
                f"Oil ID {item['track_id']} ({item['raw_class_name']}) : {item['confidence']:.2f} at ({item['pixel_x']},{item['pixel_y']})"
                for item in oil_predictions
            ) or "none"
            oil_log_part = f" oil={len(oil_predictions)} [{oil_info}]"
        print(
            f"[local-ai] frame={frame_id} input={image.shape[1]}x{image.shape[0]} "
            f"trash={len(predictions)} [{trash_info}]{oil_log_part} total={elapsed_ms:.1f}ms",
            flush=True,
        )
        # Measure idle gaps between requests, excluding time spent inferring.
        self.last_frame_timestamp = time.perf_counter()
        return response

    def health(self) -> dict[str, Any]:
        active_models = [self.model_path.name] if self.model_path is not None else []
        if self.nafta_model is not None and self.nafta_model_path is not None:
            active_models.append(f"NAFTA PSPNet ({self.nafta_model_path.name})")
        elif self.oil_model is not None and self.oil_model_path is not None:
            active_models.append(self.oil_model_path.name)
        if self.secondary_model is not None and self.secondary_model_path is not None:
            active_models.append(self.secondary_model_path.name)
        active_model_desc = " + ".join(active_models)
        if self.oil_fallback_model_path is not None:
            active_model_desc += f" + oil-fallback:{self.oil_fallback_model_path.name}"
        if self.nafta_model is not None:
            oil_classes = {"1": "คราบน้ำมัน (Oil Spill)"}
        elif self.oil_model is not None:
            oil_classes = {str(k): OIL_CLASS_MAP.get(v, v) for k, v in self.oil_names.items()}
        else:
            oil_classes = {}
        return {
            "status": "ok",
            "source": "local",
            "model": active_model_desc,
            "device": self.device,
            "task": self.model.task if self.model is not None else "none",
            "classes": self.names,
            "oil_classes": oil_classes,
            "oil_auto_ready": self.oil_auto_ready,
            "confidence_threshold": self.confidence,
            "oil_confidence_threshold": 0.45 if self.nafta_model is not None else self.oil_confidence,
            "nms_iou": self.iou,
            "inference_imgsz": self.image_size,
            "parallel_inference": self.parallel_inference,
            "max_targets": self.max_targets,
            "max_oil_targets": self.max_oil_targets,
            "hold_timeout": self.hold_timeout,
            "oil_hold_timeout": self.oil_hold_timeout,
            "confirmation_hits": self.confirmation_hits,
            "oil_confirmation_hits": self.oil_confirmation_hits,
            "trash_status": "ACTIVE" if self.model is not None else "DISABLED",
            "oil_status": "ACTIVE" if (self.nafta_model is not None or self.oil_model is not None) else "PREPARING",
        }


class DetectionHandler(BaseHTTPRequestHandler):
    detector: LocalTrashDetector

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self.send_json(200, self.detector.health())
            return
        if self.path == "/reset":
            with self.detector.lock:
                self.detector.locked_target = None
                self.detector.primary_track_id = None
                self.detector.locked_oil = None
                self.detector.primary_oil_track_id = None
                self.detector.oil_tracks.clear()
                self.detector.next_oil_track_id = 1
                self.detector.tracked_objects.clear()
                self.detector.next_track_id = 1
            self.send_json(200, {"status": "ok", "message": "Tracker state reset"})
            return
        self.send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/detect":
            self.send_json(404, {"error": "Not found"})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"error": "Invalid Content-Length"})
            return
        if content_length <= 0 or content_length > MAX_IMAGE_LENGTH:
            self.send_json(413, {"error": "Image is empty or too large"})
            return
        try:
            encoded_image = self.rfile.read(content_length).decode("ascii")
            enable_trash = self.headers.get("X-Enable-Trash", "1") != "0"
            enable_oil = self.headers.get("X-Enable-Oil", "1") != "0"
            self.send_json(200, self.detector.detect(encoded_image, enable_trash=enable_trash, enable_oil=enable_oil))
        except UnicodeDecodeError:
            self.send_json(400, {"error": "Image body must be base64 ASCII"})
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except Exception as error:
            print(f"[local-ai] ERROR {type(error).__name__}: {error}", flush=True)
            self.send_json(500, {"error": "Local inference failed"})

    def log_message(self, format: str, *args: Any) -> None:
        return


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Local offline dual trash & oil inference server with tracking")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL, help="Primary trash detection weights (optional)")
    parser.add_argument(
        "--oil-model",
        type=Path,
        default=DEFAULT_OIL_MODEL,
        help="Path to oil spill segmentation model",
    )
    parser.add_argument(
        "--nafta-model",
        type=Path,
        default=DEFAULT_NAFTA_MODEL,
        help="Optional NAFTA ResNet50-PSPNet weights for oil spill semantic segmentation",
    )
    parser.add_argument("--oil-fallback-model", type=Path, default=None,
                        help="Optional preview segmentation model, used only on empty primary results")
    parser.add_argument(
        "--secondary-model",
        type=Path,
        default=None,
        help="Optional secondary complementary model (disabled by default to prevent false positives)",
    )
    parser.add_argument("--conf", type=float, default=0.35, help="Confidence threshold for trash detection (default: 0.35)")
    parser.add_argument(
        "--oil-conf",
        type=float,
        default=0.25,
        help="Confidence threshold for oil spill detection (default: 0.25)",
    )
    parser.add_argument("--iou", type=float, default=0.45, help="NMS IoU threshold for overlap suppression")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--hold", type=float, default=0.80, help="Temporary lost hold timeout in seconds (default: 0.80)")
    parser.add_argument(
        "--oil-hold",
        type=float,
        default=0.32,
        help="Temporary lost hold timeout for oil in seconds (default: 0.32, shake-off like trash)",
    )
    parser.add_argument("--alpha", type=float, default=0.50, help="Exponential moving average factor for box smoothing")
    parser.add_argument(
        "--max-targets",
        type=int,
        default=1,
        help="Maximum targets to return (1 = single highest confidence target)",
    )
    parser.add_argument(
        "--max-oil-targets",
        type=int,
        default=5,
        help="Maximum oil spots/droplets to detect and track (default: 5, max: 5)",
    )
    args = parser.parse_args()
    if not 0 < args.conf <= 1:
        parser.error("--conf must be in the range (0, 1]")
    if not 0 < args.oil_conf <= 1:
        parser.error("--oil-conf must be in the range (0, 1]")
    if not 0 < args.iou <= 1:
        parser.error("--iou must be in the range (0, 1]")
    if args.imgsz <= 0:
        parser.error("--imgsz must be greater than zero")
    if not 0.05 <= args.hold <= 5.0:
        parser.error("--hold must be in the range [0.05, 5.0]")
    if not 0.05 <= args.oil_hold <= 5.0:
        parser.error("--oil-hold must be in the range [0.05, 5.0]")
    if not 0.05 <= args.alpha <= 1.0:
        parser.error("--alpha must be in the range [0.05, 1.0]")
    if args.max_targets < 0:
        parser.error("--max-targets must be greater than or equal to 0")
    if not 1 <= args.max_oil_targets <= 10:
        parser.error("--max-oil-targets must be in the range [1, 10]")
    return args


def main() -> None:
    args = parse_args()
    detector = LocalTrashDetector(
        args.model,
        oil_model_path=args.oil_model,
        nafta_model_path=args.nafta_model,
        secondary_model_path=args.secondary_model,
        confidence=args.conf,
        oil_confidence=args.oil_conf,
        iou=args.iou,
        image_size=args.imgsz,
        hold_timeout=args.hold,
        oil_hold_timeout=args.oil_hold,
        alpha=args.alpha,
        max_targets=args.max_targets,
        max_oil_targets=args.max_oil_targets,
        oil_fallback_path=args.oil_fallback_model,
    )
    DetectionHandler.detector = detector
    server = ThreadingHTTPServer((args.host, args.port), DetectionHandler)
    sec_info = f" + {detector.secondary_model_path.name}" if detector.secondary_model is not None else ""
    oil_info = (
        f" + NAFTA PSPNet ({detector.nafta_model_path.name})"
        if detector.nafta_model is not None
        else (f" + {detector.oil_model_path.name}" if detector.oil_model is not None else "")
    )
    print(
        f"[local-ai] ready http://{args.host}:{args.port} model={(detector.model_path.name if detector.model_path else 'none')}{oil_info}{sec_info} "
        f"device={detector.device} conf={args.conf} oil_conf={args.oil_conf} iou={args.iou} imgsz={args.imgsz} "
        f"hold={args.hold}s alpha={args.alpha} max_targets={detector.max_targets}",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("[local-ai] stopped", flush=True)


if __name__ == "__main__":
    main()
