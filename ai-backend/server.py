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
DEFAULT_MODEL = (
    PROJECT_DIR / "models" / "trash_new.pt"
    if (PROJECT_DIR / "models" / "trash_new.pt").is_file()
    else PROJECT_DIR / "models" / "trash.pt"
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
    # TACO Dataset Classes (fabiocigaina/TACO-yolo11s)
    "plastic bag & wrapper": "ถุงพลาสติกและซองขนม (Plastic bag & wrapper)",
    "cigarette": "ก้นบุหรี่ (Cigarette)",
    "bottle": "ขวดพลาสติก / ขวดน้ำ (Bottle)",
    "bottle cap": "ฝาขวด (Bottle cap)",
    "can": "กระป๋อง (Can)",
    "other plastic": "พลาสติกอื่น ๆ (Other plastic)",
    "carton": "กล่องนม / กล่องเครื่องดื่ม (Carton)",
    "cup": "แก้วน้ำ (Cup)",
    "other": "ขยะอื่น ๆ (Other)",
    # หมวดหมู่เสริมสำหรับกล่องนมและบรรจุภัณฑ์เครื่องดื่ม
    "uht-box": "กล่องนม (Milk Carton)",
    "uht_box": "กล่องนม (Milk Carton)",
    "drink carton": "กล่องนม / กล่องเครื่องดื่ม (Carton)",
    # ถุงพลาสติกและพลาสติกแบบใช้ครั้งเดียว
    "single-use-plastic": "ถุงพลาสติก (Plastic Bag)",
    "single_use_plastic": "ถุงพลาสติก (Plastic Bag)",
    "single-layer plastic": "ถุงพลาสติก (Plastic Bag)",
    "plastic bag": "ถุงพลาสติก (Plastic Bag)",
    "handbag": "ถุงพลาสติก (Plastic Bag)",
    "backpack": "ถุงพลาสติก (Plastic Bag)",
    # ขวดน้ำและขวดนม
    "pet bottle": "ขวดน้ำพลาสติก (PET Bottle)",
    "hdpe plastic": "ขวดนม / พลาสติกทึบ (HDPE Bottle)",
    "multi-layer plastic": "ซองขนม / ซองพลาสติก (Snack Wrapper)",
    "squeeze-tube": "หลอดพลาสติก (Plastic Tube)",
    # แก้ว กระป๋อง และภาชนะ
    "bowl": "ภาชนะ / โฟม (Container)",
    # กล่องและกระดาษ
    "box": "กล่องกระดาษ (Box)",
    "cardboard": "กล่องกระดาษ (Cardboard)",
    "book": "กล่องกระดาษ (Carton)",
    "paper": "กระดาษ (Paper)",
    "plastic": "พลาสติก (Plastic)",
    "metal": "โลหะ (Metal)",
    "glass": "ขวดแก้ว (Glass)",
    "litter": "ขยะ (Litter)",
    "trash": "ขยะ (Trash)",
    "waste": "ขยะ (Waste)",
}


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

    @property
    def is_confirmed(self) -> bool:
        return self.hits >= self.confirmation_hits

    def update(
        self,
        box: list[float],
        conf: float,
        timestamp: float,
        alpha: float = 0.50,
    ) -> None:
        self.hits += 1
        self.misses = 0
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
        self.velocity[0] = max(-400.0, min(400.0, self.velocity[0]))
        self.velocity[1] = max(-300.0, min(300.0, self.velocity[1]))

        # ปรับตำแหน่งกรอบด้วย EMA (Exponential Moving Average)
        # หากมีการเคลื่อนไหวเร็ว ให้ตอบสนองไว (alpha สูง) เพื่อไม่ให้กรอบลอยตามหลัง
        dx = abs(new_cx - old_cx)
        dy = abs(new_cy - old_cy)
        effective_alpha = 0.85 if (dx > 20.0 or dy > 20.0) else alpha

        self.box = [
            effective_alpha * new_v + (1.0 - effective_alpha) * old_v
            for new_v, old_v in zip(box, self.box)
        ]
        self.confidence = 0.70 * conf + 0.30 * self.confidence
        self.last_seen = timestamp


class LockedOilTrack:
    """การติดตามและหน่วงตำแหน่งคราบน้ำมัน/หยดน้ำมัน (Temporal Oil Tracking with Anti-Ghost Confirmation)"""

    def __init__(
        self,
        track_id: int,
        box: list[float],
        points: list[dict[str, float]],
        conf: float,
        area_pct: float,
        timestamp: float,
        oil_type: str = "คราบน้ำมัน",
        confirmation_hits: int = 3,
    ) -> None:
        self.track_id = track_id
        self.box = list(box)
        self.points = list(points)
        self.confidence = conf
        self.area_pct = area_pct
        self.oil_type = oil_type
        self.first_seen = timestamp
        self.last_seen = timestamp
        self.velocity = [0.0, 0.0]
        self.hits = 1
        self.misses = 0
        self.confirmation_hits = max(1, confirmation_hits)

    def update(
        self,
        box: list[float],
        points: list[dict[str, float]],
        conf: float,
        area_pct: float,
        timestamp: float,
        alpha: float = 0.60,
    ) -> None:
        dt = max(0.01, min(0.40, timestamp - self.last_seen))
        old_cx = (self.box[0] + self.box[2]) / 2.0
        old_cy = (self.box[1] + self.box[3]) / 2.0
        new_cx = (box[0] + box[2]) / 2.0
        new_cy = (box[1] + box[3]) / 2.0

        inst_vx = (new_cx - old_cx) / dt
        inst_vy = (new_cy - old_cy) / dt
        self.velocity[0] = 0.50 * inst_vx + 0.50 * self.velocity[0]
        self.velocity[1] = 0.50 * inst_vy + 0.50 * self.velocity[1]
        self.velocity[0] = max(-300.0, min(300.0, self.velocity[0]))
        self.velocity[1] = max(-250.0, min(250.0, self.velocity[1]))

        self.box = [
            alpha * new_v + (1.0 - alpha) * old_v
            for new_v, old_v in zip(box, self.box)
        ]
        if points and len(points) >= 3:
            self.points = points
        self.confidence = 0.70 * conf + 0.30 * self.confidence
        self.area_pct = alpha * area_pct + (1.0 - alpha) * self.area_pct
        self.last_seen = timestamp
        self.hits += 1
        self.misses = 0

    @property
    def is_confirmed(self) -> bool:
        return self.hits >= self.confirmation_hits


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


def compute_target_match_score(det: dict[str, Any], target: LockedTarget, now: float) -> float:
    """Conservative spatial association; this is not appearance re-identification."""
    det_box = det["box"]
    target_box = target.box

    dt = max(0.01, min(0.40, now - target.last_seen))
    # ตำแหน่งคาดการณ์ตามทิศทางและความเร็วการเคลื่อนไหวของเป้าหมายเดิม (Motion Projection)
    pred_cx = ((target_box[0] + target_box[2]) / 2.0) + (target.velocity[0] * dt * 0.5)
    pred_cy = ((target_box[1] + target_box[3]) / 2.0) + (target.velocity[1] * dt * 0.5)

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
    # วัตถุขนาดต่างกันมาก ไม่ใช่ชิ้นเดียวกันแน่นอน
    if area_ratio < 0.22:
        return 0.0

    ar_det = h_det / w_det
    ar_tgt = h_tgt / w_tgt
    ar_ratio = min(ar_det, ar_tgt) / max(ar_det, ar_tgt)
    # อัตราส่วนความกว้าง/สูงต่างกันมาก ไม่ใช่ชิ้นเดียวกัน
    if ar_ratio < 0.28:
        return 0.0

    iou, ios = box_overlap_metrics(det_box, target_box)
    same_class = (det["class_id"] == target.class_id)
    if not same_class and det["raw_name"].lower() != target.raw_name.lower():
        return 0.0

    # หากไม่มีการทับซ้อน ให้ตรวจสอบขอบเขตระยะกระโดดสูงสุด (รองรับการแพนกล้องกว้างขณะหมุนเรือ)
    if iou < 0.10:
        if dx > max(40.0, w_tgt * 0.75) or dy > max(40.0, h_tgt * 0.75):
            return 0.0

    spatial_score = (1.0 - min(1.0, dx / 360.0)) * (1.0 - min(1.0, dy / 140.0))
    class_bonus = 0.25 if same_class else 0.0
    overlap_score = max(iou, ios * area_ratio)

    score = (
        0.35 * overlap_score
        + 0.40 * (spatial_score * area_ratio)
        + class_bonus
    )
    return float(score)


def is_same_object_overlap(
    box_a: list[float],
    box_b: list[float],
    iou_th: float = 0.35,
    ios_th: float = 0.55,
) -> bool:
    iou, ios = box_overlap_metrics(box_a, box_b)
    return (iou >= iou_th) or (ios >= ios_th)


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
    if box_w < 12.0 or box_h < 12.0:
        return False

    # 2. กรองสัดส่วน Aspect Ratio ผิดรูป (ขอบปากอ่าง/เงาขอบโค้ง)
    ar = max(box_w / box_h, box_h / box_w)
    if ar > 4.5:
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
        if std_val < 18.0 and conf < 0.75:
            return False
        edges = cv2.Canny(gray, 35, 110)
        edge_density = float(np.sum(edges > 0)) / edges.size
        # ผิวน้ำที่ไม่มีขยะจริงจะมีความหนาแน่นของเส้นขอบต่ำมาก (< 0.014)
        if edge_density < 0.014 and conf < 0.65:
            return False
        # หากทับซ้อนกับคราบน้ำมันและไม่มีลายฉลาก/ขอบแข็งของขยะจริง ให้ปฏิเสธ (ให้น้ำหนักกับโมเดลน้ำมัน)
        if overlaps_oil and (std_val < 26.0 or edge_density < 0.030):
            return False

    return True


class LocalTrashDetector:
    def __init__(
        self,
        model_path: Path,
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
        if not model_path.is_file():
            raise FileNotFoundError(f"Model not found: {model_path}")
        self.model_path = model_path.resolve()
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

        self.model = YOLO(str(self.model_path))
        self.names = {int(class_id): str(name) for class_id, name in self.model.names.items()}

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
        self.inference_executor = ThreadPoolExecutor(max_workers=4) if parallel_inference else None

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
            inference_jobs: dict[str, tuple[Any, float]] = {}
            if enable_trash:
                inference_jobs["trash"] = (self.model, self.confidence)
                if self.secondary_model is not None:
                    inference_jobs["secondary"] = (self.secondary_model, max(0.20, self.confidence))
            else:
                self.locked_target = None
                self.primary_track_id = None

            if enable_oil:
                if self.oil_model is not None:
                    inference_jobs["oil"] = (self.oil_model, self.oil_confidence)
                    if self.inference_executor is not None and self.oil_fallback_model is not None:
                        inference_jobs["oil_fallback"] = (self.oil_fallback_model, self.oil_confidence)
            else:
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
            oil_result = inference_results.get("oil")
            oil_fallback_result = inference_results.get("oil_fallback")
            secondary_result = inference_results.get("secondary")
            if secondary_result is not None and secondary_result.boxes is not None:
                secondary_boxes = secondary_result.boxes

            if (enable_oil and self.oil_fallback_model is not None and oil_result is not None
                    and oil_result.boxes is not None and len(oil_result.boxes) == 0):
                if oil_fallback_result is not None:
                    oil_result = oil_fallback_result
                else:
                    try:
                        oil_result = self._predict_once(self.oil_fallback_model, image, self.oil_confidence)
                    except Exception as err:
                        print(f"[local-ai] Oil fallback model inference warning: {err}", flush=True)

            self.frame_id += 1
            frame_id = self.frame_id
        elapsed_ms = (time.perf_counter() - started) * 1000

        # สกัดกล่องคราบน้ำมันดิบสำหรับตรวจสอบการทับซ้อนกับขยะ (Cross-Model Overlap Filter)
        current_oil_boxes: list[list[float]] = []
        if oil_result is not None and oil_result.boxes is not None and len(oil_result.boxes) > 0:
            for ob in oil_result.boxes:
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

        # Device CPU inference may take longer than the normal hold window.
        # Allow a current spatial/class match to confirm the next observation;
        # never extend a missing target's hold window.
        if self.locked_target is not None:
            has_current_match = any(compute_target_match_score(det, self.locked_target, now) >= 0.18 for det in deduped_detections)
            if not has_current_match and (now - self.locked_target.last_seen) > self.hold_timeout:
                self.locked_target = None
                self.primary_track_id = None

        matched_det: dict[str, Any] | None = None
        if self.locked_target is not None:
            best_score = 0.0
            best_idx = None
            for idx, det in enumerate(deduped_detections):
                score = compute_target_match_score(det, self.locked_target, now)
                if score > best_score and score >= 0.18:
                    best_score = score
                    best_idx = idx

            if best_idx is not None:
                matched_det = deduped_detections[best_idx]
                self.locked_target.update(
                    matched_det["box"],
                    matched_det["conf"],
                    now,
                    alpha=self.alpha,
                )
            else:
                self.locked_target.misses += 1
                # หากเป็นเป้าหมายชั่วคราว 1 เฟรมที่ยังไม่ยืนยัน และเฟรมนี้ไม่เจอซ้ำ ให้ลบทันที ป้องกันภาพหลอนลอยค้าง
                if not self.locked_target.is_confirmed:
                    self.locked_target = None
                    self.primary_track_id = None
        else:
            if deduped_detections:
                best_cand = max(deduped_detections, key=lambda d: d["conf"])
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
                        "class_name": "ขยะ",
                        "class_name_en": "Trash",
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
            and (now - self.locked_target.last_seen) <= self.hold_timeout
        ):
            status = "DETECTED" if matched_det is not None else "TRACKED"
            conf = float(self.locked_target.confidence)
            if status == "TRACKED":
                elapsed_hold = now - self.locked_target.last_seen
                decay = max(0.0, 1.0 - (elapsed_hold / self.hold_timeout) * 0.40)
                conf = max(0.20, conf * decay)

            left, top, right, bottom = self.locked_target.box
            center_x = (left + right) / 2.0
            center_y = (top + bottom) / 2.0
            predictions.append(
                {
                    "track_id": self.locked_target.track_id,
                    "class_id": self.locked_target.class_id,
                    "class_name": "ขยะ",
                    "class_name_en": "Trash",
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
                    # กรองเส้นลวงยาวแคบผิดปกติ (Tile seam, grout lines, ceiling grooves)
                    if (box_w / (box_h + 1e-4) > 3.8) or (box_h / (box_w + 1e-4) > 3.8):
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

                    # กรองแป้นพิมพ์คีย์บอร์ดและลายตารางแห้ง (Keyboard / Dense Grid False Positives)
                    oil_crop = image[int(max(0, top)):int(min(img_h, bottom)), int(max(0, left)):int(min(img_w, right))]
                    if oil_crop.size > 0:
                        o_gray = cv2.cvtColor(oil_crop, cv2.COLOR_BGR2GRAY)
                        o_edges = cv2.Canny(o_gray, 50, 150)
                        o_edge_density = float(np.sum(o_edges > 0)) / o_edges.size
                        if o_edge_density > 0.09 and conf < 0.70:
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

            # --- ระบบหน่วงและจำตำแหน่งคราบน้ำมัน (Sticky Visual Servoing & Hold Timeout) ---
            matched_track_ids = set()
            used_det_indices = set()

            # 1. จับคู่ผลตรวจจับใหม่เข้ากับรอยคราบ/หยดน้ำมันเดิมในหน่วยความจำ
            for track_id, track in list(self.oil_tracks.items()):
                best_match_idx = None
                best_dist = math.inf
                for d_idx, det in enumerate(deduped_oil_detections):
                    if d_idx in used_det_indices:
                        continue
                    iou, _ = box_overlap_metrics(det["box"], track.box)
                    det_cx = (det["box"][0] + det["box"][2]) / 2.0
                    det_cy = (det["box"][1] + det["box"][3]) / 2.0
                    trk_cx = (track.box[0] + track.box[2]) / 2.0
                    trk_cy = (track.box[1] + track.box[3]) / 2.0
                    dist = math.hypot(det_cx - trk_cx, det_cy - trk_cy)
                    if (iou >= 0.20 or dist <= 50.0) and dist < best_dist:
                        best_match_idx = d_idx
                        best_dist = dist

                if best_match_idx is not None:
                    matched_det = deduped_oil_detections[best_match_idx]
                    track.update(
                        matched_det["box"],
                        matched_det["points"],
                        matched_det["conf"],
                        matched_det["area_pct"],
                        now,
                        alpha=self.alpha,
                    )
                    matched_track_ids.add(track_id)
                    used_det_indices.add(best_match_idx)

            # 2. เพิ่มคราบน้ำมันจุดใหม่ที่ไม่ตรงกับจุดเดิม
            for d_idx, det in enumerate(deduped_oil_detections):
                if d_idx not in used_det_indices:
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
                        confirmation_hits=self.oil_confirmation_hits,
                    )
                    self.oil_tracks[t_id] = new_track
                    matched_track_ids.add(t_id)

            # 3. ตรวจสอบและหน่วงเวลาเป้าหมายที่มองไม่เห็นชั่วคราว (Hold Timeout & Anti-Ghost Confirmation)
            active_tracks = []
            for track_id, track in list(self.oil_tracks.items()):
                if track_id not in matched_track_ids:
                    track.misses += 1
                elapsed_hold = now - track.last_seen

                # หากเป็นเป้าหมายชั่วคราว 1 เฟรมที่ยังไม่ยืนยัน และเฟรมนี้ไม่เจอซ้ำ ให้ลบทันที ป้องกันภาพหลอนลอยค้าง
                if not track.is_confirmed and elapsed_hold > 0.15:
                    del self.oil_tracks[track_id]
                elif elapsed_hold > self.oil_hold_timeout:
                    del self.oil_tracks[track_id]
                else:
                    active_tracks.append((track_id, track, elapsed_hold))

            # จำกัดจำนวนตรวจพบคราบน้ำมันไม่เกิน 5 จุดตามคำสั่งผู้ใช้ ป้องกันความแออัดและตรวจจับมั่ว
            max_oil_regions = min(5, getattr(self, "max_oil_targets", 5))
            # คัดเฉพาะเป้าหมายที่ได้รับการยืนยันแล้ว และมีค่าความมั่นใจที่เหมาะสม
            valid_tracks = [
                item for item in active_tracks
                if item[1].is_confirmed and item[1].confidence >= 0.20
            ]
            valid_tracks.sort(key=lambda item: item[1].confidence, reverse=True)

            for t_id, track, elapsed_hold in valid_tracks[:max_oil_regions]:
                status = "DETECTED" if t_id in matched_track_ids else "TRACKED"
                conf = track.confidence
                if status == "TRACKED":
                    decay = max(0.0, 1.0 - (elapsed_hold / self.oil_hold_timeout) * 0.25)
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
                        "raw_class_name": "oil",
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
        if enable_trash:
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
                "trash_status": "ACTIVE" if enable_trash else "DISABLED",
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
        active_models = [self.model_path.name]
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
            "task": self.model.task,
            "classes": self.names,
            "oil_classes": oil_classes,
            "oil_auto_ready": self.oil_auto_ready,
            "confidence_threshold": self.confidence,
            "oil_confidence_threshold": 0.45 if self.nafta_model is not None else self.oil_confidence,
            "nms_iou": self.iou,
            "inference_imgsz": self.image_size,
            "parallel_inference": self.parallel_inference,
            "max_targets": self.max_targets,
            "hold_timeout": self.hold_timeout,
            "oil_hold_timeout": self.oil_hold_timeout,
            "confirmation_hits": self.confirmation_hits,
            "oil_confirmation_hits": self.oil_confirmation_hits,
            "trash_status": "ACTIVE",
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
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
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
        default=1.80,
        help="Temporary lost hold timeout for oil in seconds (default: 1.80)",
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
        f"[local-ai] ready http://{args.host}:{args.port} model={detector.model_path.name}{oil_info}{sec_info} "
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
