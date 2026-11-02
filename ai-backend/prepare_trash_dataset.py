#!/usr/bin/env python3
"""RIBO-TH Milk Carton & Marine Trash Fine-Tuning Dataset Generator

รวมภาพกล่องนมจาก /Volumes/Extreme SSD/RIBO-TH/milk (30 ภาพ)
รวมภาพกล่องนม Foremost ช็อกโกแลตจริงจากกล้อง C270 (media_1793533598639_eb0f174e.jpg)
รวมภาพตัวอย่างขยะอื่นๆ (ขวด, กระป๋อง, ซองพลาสติก)
และ Hard Negatives (อ่างน้ำเปล่า, ผิวน้ำ, แล็ปท็อป/โต๊ะทำงาน)
"""

from __future__ import annotations

import glob
import argparse
import json
import os
import random
import re
import shutil
from pathlib import Path
import cv2
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATASET_DIR = PROJECT_ROOT / "datasets" / "trash"
MILK_DIR = PROJECT_ROOT / "milk"
IMAGES_TRAIN = DATASET_DIR / "images" / "train"
IMAGES_VAL = DATASET_DIR / "images" / "val"
LABELS_TRAIN = DATASET_DIR / "labels" / "train"
LABELS_VAL = DATASET_DIR / "labels" / "val"

DATA_YAML = DATASET_DIR / "data.yaml"

CLASS_MAP = {
    "Plastic bag & wrapper": 0,
    "Cigarette": 1,
    "Bottle": 2,
    "Bottle cap": 3,
    "Can": 4,
    "Other plastic": 5,
    "Carton": 6,
    "Cup": 7,
    "Other": 8,
}


def find_carton_box(img: np.ndarray) -> list[tuple[int, int, int, int]]:
    """หา Bounding Box ของกล่องนมบนพื้นหลังสตูดิโอ/เรียบ"""
    h, w = img.shape[:2]
    corners = [img[0, 0], img[0, w - 1], img[h - 1, 0], img[h - 1, w - 1]]
    mean_corner = np.mean(corners, axis=0)
    diff = np.linalg.norm(img.astype(float) - mean_corner.astype(float), axis=2)
    mask = (diff > 25).astype(np.uint8) * 255
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
    mask_clean = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask_clean = cv2.morphologyEx(mask_clean, cv2.MORPH_OPEN, kernel)
    contours, _ = cv2.findContours(mask_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area > 0.04 * w * h:
            bx, by, bw, bh = cv2.boundingRect(cnt)
            boxes.append((bx, by, bw, bh))
    if not boxes:
        # Fallback: assume centered object
        boxes.append((int(0.15 * w), int(0.10 * h), int(0.70 * w), int(0.80 * h)))
    return boxes


def format_yolo_bbox(bx: int, by: int, bw: int, bh: int, img_w: int, img_h: int, cls_id: int = 6) -> str:
    cx = (bx + bw / 2.0) / img_w
    cy = (by + bh / 2.0) / img_h
    nw = bw / img_w
    nh = bh / img_h
    cx = max(0.001, min(0.999, cx))
    cy = max(0.001, min(0.999, cy))
    nw = max(0.005, min(0.999, nw))
    nh = max(0.005, min(0.999, nh))
    return f"{cls_id} {cx:.6f} {cy:.6f} {nw:.6f} {nh:.6f}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=PROJECT_ROOT / "datasets" / "trash_grouped_v2")
    args = parser.parse_args()
    global DATASET_DIR, IMAGES_TRAIN, IMAGES_VAL, LABELS_TRAIN, LABELS_VAL, DATA_YAML
    DATASET_DIR = args.output.resolve()
    IMAGES_TRAIN, IMAGES_VAL = DATASET_DIR / "images/train", DATASET_DIR / "images/val"
    LABELS_TRAIN, LABELS_VAL = DATASET_DIR / "labels/train", DATASET_DIR / "labels/val"
    DATA_YAML = DATASET_DIR / "data.yaml"
    random.seed(42)
    np.random.seed(42)

    # Preserve earlier datasets; each preparation run uses a fresh directory.
    if DATASET_DIR.is_dir() and any(DATASET_DIR.iterdir()):
        raise FileExistsError(f"Use a new output directory to preserve existing data: {DATASET_DIR}")
    for p in [IMAGES_TRAIN, IMAGES_VAL, LABELS_TRAIN, LABELS_VAL]:
        p.mkdir(parents=True, exist_ok=True)

    print("[*] Generating RIBO-TH Trash Dataset...")
    records: list[tuple[np.ndarray, list[str], str]] = []

    # 1. กล่องนม 30 ภาพจากโฟลเดอร์ /Volumes/Extreme SSD/RIBO-TH/milk
    milk_files = sorted(glob.glob(str(MILK_DIR / "*.jpg")))
    print(f"[*] Found {len(milk_files)} milk carton images in {MILK_DIR}")
    for idx, fpath in enumerate(milk_files):
        img = cv2.imread(fpath)
        if img is None:
            continue
        h, w = img.shape[:2]
        boxes = find_carton_box(img)
        labels = [format_yolo_bbox(bx, by, bw, bh, w, h, cls_id=6) for bx, by, bw, bh in boxes]
        records.append((img, labels, f"milk_{idx+1:02d}"))

        # Augmented variations (Horizontal flip, brightness variations)
        flip_img = cv2.flip(img, 1)
        flip_labels = []
        for bx, by, bw, bh in boxes:
            new_bx = w - (bx + bw)
            flip_labels.append(format_yolo_bbox(new_bx, by, bw, bh, w, h, cls_id=6))
        records.append((flip_img, flip_labels, f"milk_{idx+1:02d}_flip"))

        # Contrast variation
        bright_img = cv2.convertScaleAbs(img, alpha=1.15, beta=10)
        records.append((bright_img, labels, f"milk_{idx+1:02d}_bright"))

    # 2. กล่องนมจริง Foremost ช็อกโกแลตจากกล้อง C270 (media_1793533598639_eb0f174e.jpg)
    foremost_img = cv2.imread("scratch/foremost_cam_crop.jpg")
    if foremost_img is not None:
        fh, fw = foremost_img.shape[:2]
        # Bounding box of Foremost chocolate carton in camera crop (640x360)
        # Bbox: x: 105 to 205, y: 75 to 275 -> bx=105, by=75, bw=100, bh=200
        f_box = (105, 75, 100, 200)
        f_label = format_yolo_bbox(f_box[0], f_box[1], f_box[2], f_box[3], fw, fh, cls_id=6)
        records.append((foremost_img, [f_label], "c270_foremost_orig"))

        # Crop carton patch for synthetic composition
        carton_crop = foremost_img[f_box[1]:f_box[1]+f_box[3], f_box[0]:f_box[0]+f_box[2]]

        # Variations of camera frame
        for v in range(12):
            aug = foremost_img.copy()
            alpha_val = random.uniform(0.85, 1.25)
            beta_val = random.randint(-15, 20)
            aug = cv2.convertScaleAbs(aug, alpha=alpha_val, beta=beta_val)
            # Brightness changes do not move the object or its label.
            cur_box = f_box
            lbl = format_yolo_bbox(cur_box[0], cur_box[1], cur_box[2], cur_box[3], fw, fh, cls_id=6)
            records.append((aug, [lbl], f"c270_foremost_aug_{v+1:02d}"))

        # Synthetic composition of Foremost carton floating in water basin
        basin_bg = cv2.imread("scratch/extracted_basin_feed.jpg")
        if basin_bg is not None:
            basin_bg_resized = cv2.resize(basin_bg, (640, 360))
            for s in range(15):
                comp = basin_bg_resized.copy()
                scale = random.uniform(0.65, 1.1)
                nw = int(carton_crop.shape[1] * scale)
                nh = int(carton_crop.shape[0] * scale)
                scaled_carton = cv2.resize(carton_crop, (nw, nh))

                px = random.randint(30, 640 - nw - 30)
                py = random.randint(20, 360 - nh - 20)

                # Alpha blend into water
                overlay = comp[py:py+nh, px:px+nw]
                blended = cv2.addWeighted(scaled_carton, 0.90, overlay, 0.10, 0)
                comp[py:py+nh, px:px+nw] = blended

                lbl = format_yolo_bbox(px, py, nw, nh, 640, 360, cls_id=6)
                records.append((comp, [lbl], f"c270_foremost_water_synth_{s+1:02d}"))

    # 3. ตัวอย่างขยะจริงประเภทอื่นๆ (ขวด, กระป๋อง, ซองพลาสติก) จาก test_samples
    samples = [
        ("ai-backend/test_samples/bottle.jpg", 2, (297, 83, 74, 268)), # Bottle / Can
        ("ai-backend/test_samples/can.jpg", 4, (230, 232, 149, 183)),   # Can
        ("ai-backend/test_samples/carton.jpg", 6, (152, 107, 176, 566)), # Carton
        ("ai-backend/test_samples/plastic_bag.jpg", 0, (184, 162, 362, 154)), # Plastic bag
    ]
    for spath, scls, (sbx, sby, sbw, sbh) in samples:
        simg = cv2.imread(spath)
        if simg is not None:
            sh, sw = simg.shape[:2]
            slbl = format_yolo_bbox(sbx, sby, sbw, sbh, sw, sh, cls_id=scls)
            records.append((simg, [slbl], Path(spath).stem))

    # 4. Hard Negatives (ผิวน้ำเปล่าในอ่าง, ก้นอ่างสีขาว, แล็ปท็อป/โต๊ะทำงาน) -> Label ว่างเปล่า
    hard_negs = [
        "scratch/extracted_basin_feed.jpg",
        "scratch/laptop_cam_crop.jpg",
        "/Users/k.phiraphat/.gemini/antigravity/brain/bae91d34-f210-4019-b732-aca280b41245/.user_uploaded/media_1793529432041_7c9d02eb.jpg",
        "/Users/k.phiraphat/.gemini/antigravity/brain/bae91d34-f210-4019-b732-aca280b41245/.user_uploaded/media_1793529585183_bf6aae54.jpg",
    ]
    for hn_idx, hpath in enumerate(hard_negs):
        himg = cv2.imread(hpath)
        if himg is not None:
            records.append((himg, [], f"hard_neg_{hn_idx+1:02d}"))
            # Crops of clean water
            hh, hw = himg.shape[:2]
            for c in range(3):
                cx1 = random.randint(0, max(1, hw - 300))
                cy1 = random.randint(0, max(1, hh - 200))
                crop_hn = himg[cy1:cy1+200, cx1:cx1+300]
                records.append((crop_hn, [], f"hard_neg_{hn_idx+1:02d}_crop_{c+1}"))

    def source_group(name: str) -> str:
        if name.startswith("c270_foremost"):
            return "c270_foremost"
        match = re.match(r"(milk_\d+|hard_neg_\d+)", name)
        return match.group(1) if match else name

    # Split source photographs before assigning their derived variants.
    groups = sorted({source_group(name) for _, _, name in records if name.startswith(("milk_", "hard_neg_"))})
    random.shuffle(groups)
    val_groups = set(groups[:max(1, round(len(groups) * 0.20))])
    train_records = [record for record in records if source_group(record[2]) not in val_groups]
    val_records = [record for record in records if source_group(record[2]) in val_groups]
    manifest = {split: [{"name": name, "source_group": source_group(name)} for _, _, name in batch]
                for split, batch in [("train", train_records), ("val", val_records)]}
    (DATASET_DIR / "split_manifest.json").write_text(json.dumps(manifest, indent=2))

    print(f"[*] Total dataset: {len(records)} images (Train: {len(train_records)}, Val: {len(val_records)})")

    for img, labels, name in train_records:
        cv2.imwrite(str(IMAGES_TRAIN / f"{name}.jpg"), img)
        with open(LABELS_TRAIN / f"{name}.txt", "w") as f:
            f.write("\n".join(labels) + ("\n" if labels else ""))

    for img, labels, name in val_records:
        cv2.imwrite(str(IMAGES_VAL / f"{name}.jpg"), img)
        with open(LABELS_VAL / f"{name}.txt", "w") as f:
            f.write("\n".join(labels) + ("\n" if labels else ""))

    # สร้าง data.yaml
    yaml_content = f"""path: {DATASET_DIR.resolve()}
train: images/train
val: images/val

nc: 9
names:
  0: Plastic bag & wrapper
  1: Cigarette
  2: Bottle
  3: Bottle cap
  4: Can
  5: Other plastic
  6: Carton
  7: Cup
  8: Other
"""
    with open(DATA_YAML, "w") as f:
        f.write(yaml_content)

    print(f"[+] Dataset successfully created at {DATASET_DIR}")
    print(f"[+] data.yaml written to {DATA_YAML}")


if __name__ == "__main__":
    main()
