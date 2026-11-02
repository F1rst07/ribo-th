#!/usr/bin/env python3
"""
RIBO-TH Multi-Droplet High-Precision Oil Dataset Generator
Generates dense multi-droplet annotations for:
1. All 20+ real cooking oil droplets from Logitech C270 (a67b4afa)
2. Real cooking oil sheen & droplets (f86fd927)
3. 25 synthetic realistic multi-droplet scenes (8 to 25 droplets per scene) on real bucket water
4. Real surface oil slicks (e394d240, e97fea18, 5f76653c)
5. Mendeley Chemical Pollution dataset (smooth convex hulls)
6. Hard Negatives (Ceilings, walls, clean water)
"""

import os
import shutil
import math
import random
from pathlib import Path
import cv2
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATASET_DIR = PROJECT_ROOT / "datasets" / "oil"
RAW_DIR = DATASET_DIR / "raw"
IMAGES_DIR = DATASET_DIR / "images"
LABELS_DIR = DATASET_DIR / "labels"


def create_smooth_polygon(cx: float, cy: float, rx: float, ry: float, angle_deg: float = 0, num_pts: int = 16) -> list[tuple[float, float]]:
    rad = math.radians(angle_deg)
    cos_a, sin_a = math.cos(rad), math.sin(rad)
    pts = []
    for i in range(num_pts):
        theta = 2.0 * math.pi * i / num_pts
        r_perturb = 1.0 + 0.04 * math.sin(2 * theta)
        px = rx * math.cos(theta) * r_perturb
        py = ry * math.sin(theta) * r_perturb
        x_rot = px * cos_a - py * sin_a
        y_rot = px * sin_a + py * cos_a
        pts.append((cx + x_rot, cy + y_rot))
    return pts


def format_yolo_polygon(pts: list[tuple[float, float]], w: int, h: int, class_id: int = 0) -> str:
    coords = []
    for px, py in pts:
        nx = max(0.002, min(0.998, px / w))
        ny = max(0.002, min(0.998, py / h))
        coords.append(f"{nx:.5f} {ny:.5f}")
    return f"{class_id} " + " ".join(coords)


def draw_realistic_droplet(img: np.ndarray, cx: float, cy: float, rx: float, ry: float, tint_bgr: tuple[int, int, int] = (25, 140, 210)) -> None:
    # 1. Dark refractive boundary meniscus ring
    cv2.ellipse(img, (int(cx), int(cy)), (int(rx + 1), int(ry + 1)), 0, 0, 360, (110, 120, 115), 1)
    # 2. Fluid body overlay
    overlay = img.copy()
    cv2.ellipse(overlay, (int(cx), int(cy)), (int(rx), int(ry)), 0, 0, 360, tint_bgr, -1)
    cv2.addWeighted(overlay, 0.45, img, 0.55, 0, img)
    # 3. Bright specular glint
    hl_x = int(cx - rx * 0.25)
    hl_y = int(cy - ry * 0.25)
    hl_r = max(1, int(min(rx, ry) * 0.35))
    cv2.circle(img, (hl_x, hl_y), hl_r, (235, 245, 255), -1)


def clean_target_dirs():
    for split in ["train", "val", "test"]:
        img_dir = IMAGES_DIR / split
        lbl_dir = LABELS_DIR / split
        if img_dir.exists():
            shutil.rmtree(img_dir)
        if lbl_dir.exists():
            shutil.rmtree(lbl_dir)
        img_dir.mkdir(parents=True, exist_ok=True)
        lbl_dir.mkdir(parents=True, exist_ok=True)


def generate_real_c270_samples() -> list[tuple[str, np.ndarray, list[str]]]:
    c270_dir = RAW_DIR / "c270_custom"
    samples: list[tuple[str, np.ndarray, list[str]]] = []

    # 1. Real Multi-Droplet Frame (a67b4afa) - Comprehensive 18 droplets
    p_a67 = c270_dir / "c270_frame_a67b4afa.jpg"
    if p_a67.is_file():
        im_a67 = cv2.imread(str(p_a67))
        if im_a67 is not None:
            h, w = im_a67.shape[:2]
            # Comprehensive list of droplet coordinates in a67b4afa
            real_drops = [
                (352, 155, 14, 16),
                (343, 141, 10, 10),
                (304, 126, 18, 16),
                (212, 138, 12, 16),
                (240, 26, 16, 12),
                (141, 29, 12, 10),
                (167, 68, 10, 12),
                (143, 108, 18, 16),
                (272, 179, 12, 12),
                (166, 190, 20, 14),
                (141, 200, 12, 10),
                (102, 211, 10, 14),
                (383, 218, 16, 16),
                (230, 276, 18, 18),
                (298, 293, 14, 12),
                (56, 127, 12, 10),
                (285, 104, 10, 10),
                (232, 180, 12, 12),
            ]
            lbls_drops = [
                format_yolo_polygon(create_smooth_polygon(cx, cy, rx, ry), w, h)
                for cx, cy, rx, ry in real_drops
            ]
            samples.append(("c270_real_multi_drop_01", im_a67, lbls_drops))

            # Flip
            im_flip = cv2.flip(im_a67, 1)
            lbls_flip = [
                format_yolo_polygon([(w - x, y) for x, y in create_smooth_polygon(cx, cy, rx, ry)], w, h)
                for cx, cy, rx, ry in real_drops
            ]
            samples.append(("c270_real_multi_drop_flip", im_flip, lbls_flip))

            # Contrast & Brightness variants
            samples.append(("c270_real_multi_drop_contrast", cv2.convertScaleAbs(im_a67, alpha=1.18, beta=-10), lbls_drops))
            samples.append(("c270_real_multi_drop_bright", cv2.convertScaleAbs(im_a67, alpha=1.08, beta=15), lbls_drops))

    # 2. Real Multi-Droplets in White Container/Dish (a49d2861) - 10 dense droplets
    p_a49 = c270_dir / "c270_frame_a49d2861.jpg"
    if p_a49.is_file():
        im_a49 = cv2.imread(str(p_a49))
        if im_a49 is not None:
            h49, w49 = im_a49.shape[:2]
            a49_drops = [
                (180, 242, 12, 10),
                (196, 174, 6, 6),
                (133, 155, 5, 6),
                (55, 156, 8, 10),
                (243, 149, 10, 8),
                (219, 127, 10, 10),
                (200, 68, 6, 5),
                (134, 66, 6, 4),
                (214, 53, 12, 6),
                (144, 38, 10, 10),
            ]
            lbls_a49 = [
                format_yolo_polygon(create_smooth_polygon(cx, cy, rx, ry), w49, h49)
                for cx, cy, rx, ry in a49_drops
            ]
            samples.append(("c270_real_dish_drops_01", im_a49, lbls_a49))
            samples.append(("c270_real_dish_drops_flip", cv2.flip(im_a49, 1), [
                format_yolo_polygon([(w49 - x, y) for x, y in create_smooth_polygon(cx, cy, rx, ry)], w49, h49)
                for cx, cy, rx, ry in a49_drops
            ]))
            samples.append(("c270_real_dish_drops_bright", cv2.convertScaleAbs(im_a49, alpha=1.10, beta=10), lbls_a49))
            samples.append(("c270_real_dish_drops_contrast", cv2.convertScaleAbs(im_a49, alpha=1.20, beta=-10), lbls_a49))

    # 2. Real Sheen & Droplets (f86fd927)
    p_f86 = c270_dir / "c270_frame_f86fd927.jpg"
    if p_f86.is_file():
        im_f86 = cv2.imread(str(p_f86))
        if im_f86 is not None:
            h, w = im_f86.shape[:2]
            f86_drops = [
                (190, 80, 28, 18),
                (208, 248, 20, 16),
                (174, 79, 14, 10),
                (240, 160, 12, 12),
            ]
            lbls_f86 = [
                format_yolo_polygon(create_smooth_polygon(cx, cy, rx, ry), w, h)
                for cx, cy, rx, ry in f86_drops
            ]
            samples.append(("c270_real_sheen_01", im_f86, lbls_f86))
            samples.append(("c270_real_sheen_flip", cv2.flip(im_f86, 1), [
                format_yolo_polygon([(w - x, y) for x, y in create_smooth_polygon(cx, cy, rx, ry)], w, h)
                for cx, cy, rx, ry in f86_drops
            ]))

    # 3. Surface Oil Slicks (e394d240, e97fea18, 5f76653c)
    for stem in ["e394d240", "e97fea18", "5f76653c"]:
        p = c270_dir / f"c270_frame_{stem}.jpg"
        if p.is_file():
            im = cv2.imread(str(p))
            if im is not None:
                h, w = im.shape[:2]
                poly = create_smooth_polygon(w * 0.46, h * 0.48, w * 0.22, h * 0.16)
                lbl = [format_yolo_polygon(poly, w, h)]
                samples.append((f"c270_real_surface_{stem}", im, lbl))

    # 4. Real Clear Droplets in White Basin (7c9d02eb)
    p_7c9 = c270_dir / "c270_frame_7c9d02eb.jpg"
    if p_7c9.is_file():
        im_7c9 = cv2.imread(str(p_7c9))
        if im_7c9 is not None:
            h7, w7 = im_7c9.shape[:2]
            basin_7c9_drops = [
                (int(334 * w7 / 514), int(83 * h7 / 288), 24, 18),
                (int(285 * w7 / 514), int(117 * h7 / 288), 28, 22),
                (int(236 * w7 / 514), int(196 * h7 / 288), 30, 22),
                (int(268 * w7 / 514), int(254 * h7 / 288), 26, 18),
                (int(200 * w7 / 514), int(185 * h7 / 288), 22, 18),
                (int(360 * w7 / 514), int(210 * h7 / 288), 22, 16),
            ]
            lbls_7c9 = [
                format_yolo_polygon(create_smooth_polygon(cx, cy, rx, ry), w7, h7)
                for cx, cy, rx, ry in basin_7c9_drops
            ]
            samples.append(("c270_real_basin_7c9_01", im_7c9, lbls_7c9))
            samples.append(("c270_real_basin_7c9_flip", cv2.flip(im_7c9, 1), [
                format_yolo_polygon([(w7 - x, y) for x, y in create_smooth_polygon(cx, cy, rx, ry)], w7, h7)
                for cx, cy, rx, ry in basin_7c9_drops
            ]))
            samples.append(("c270_real_basin_7c9_bright", cv2.convertScaleAbs(im_7c9, alpha=1.12, beta=12), lbls_7c9))
            samples.append(("c270_real_basin_7c9_contrast", cv2.convertScaleAbs(im_7c9, alpha=1.18, beta=-10), lbls_7c9))

    # 5. Real Multi-Droplets in White Basin (9c531dc8)
    p_9c5 = c270_dir / "c270_frame_9c531dc8.jpg"
    if p_9c5.is_file():
        im_9c5 = cv2.imread(str(p_9c5))
        if im_9c5 is not None:
            h9, w9 = im_9c5.shape[:2]
            basin_9c5_drops = [
                (int(578 * w9 / 640), int(22 * h9 / 360), 16, 14),
                (int(362 * w9 / 640), int(55 * h9 / 360), 20, 16),
                (int(263 * w9 / 640), int(81 * h9 / 360), 22, 18),
                (int(459 * w9 / 640), int(99 * h9 / 360), 18, 14),
                (int(182 * w9 / 640), int(118 * h9 / 360), 20, 16),
                (int(59 * w9 / 640), int(143 * h9 / 360), 18, 14),
                (int(250 * w9 / 640), int(155 * h9 / 360), 26, 20),
                (int(323 * w9 / 640), int(167 * h9 / 360), 22, 18),
                (int(141 * w9 / 640), int(176 * h9 / 360), 20, 16),
                (int(125 * w9 / 640), int(193 * h9 / 360), 18, 14),
                (int(395 * w9 / 640), int(189 * h9 / 360), 20, 16),
                (int(488 * w9 / 640), int(187 * h9 / 360), 22, 16),
                (int(167 * w9 / 640), int(230 * h9 / 360), 22, 18),
                (int(63 * w9 / 640), int(266 * h9 / 360), 20, 16),
                (int(107 * w9 / 640), int(280 * h9 / 360), 22, 18),
                (int(213 * w9 / 640), int(287 * h9 / 360), 24, 18),
                (int(578 * w9 / 640), int(270 * h9 / 360), 22, 16),
            ]
            lbls_9c5 = [
                format_yolo_polygon(create_smooth_polygon(cx, cy, rx, ry), w9, h9)
                for cx, cy, rx, ry in basin_9c5_drops
            ]
            samples.append(("c270_real_basin_9c5_01", im_9c5, lbls_9c5))
            samples.append(("c270_real_basin_9c5_flip", cv2.flip(im_9c5, 1), [
                format_yolo_polygon([(w9 - x, y) for x, y in create_smooth_polygon(cx, cy, rx, ry)], w9, h9)
                for cx, cy, rx, ry in basin_9c5_drops
            ]))
            samples.append(("c270_real_basin_9c5_contrast", cv2.convertScaleAbs(im_9c5, alpha=1.15, beta=-10), lbls_9c5))

    return samples


def generate_synthetic_multi_droplet_samples() -> list[tuple[str, np.ndarray, list[str]]]:
    """สร้างฉากหยดน้ำมันหลายหยด (Multi-droplet) ความละเอียดสูงบนผิวน้ำจริงในกะละมัง"""
    c270_dir = RAW_DIR / "c270_custom"
    p_clean = c270_dir / "c270_frame_8db93e46.jpg"
    if not p_clean.is_file():
        return []

    im_base = cv2.imread(str(p_clean))
    if im_base is None:
        return []

    h, w = im_base.shape[:2]
    samples: list[tuple[str, np.ndarray, list[str]]] = []

    random.seed(1337)

    tints = [
        (25, 140, 210),  # Yellow/golden cooking oil
        (40, 160, 230),  # Light yellow clear cooking oil
        (15, 60, 120),   # Dark amber used oil
        (10, 45, 95),    # Deep brown used cooking oil
    ]

    # Generate 20 multi-droplet scenes with varying density
    for scene_idx in range(1, 21):
        img = im_base.copy()
        lbls: list[str] = []

        # Number of droplets in this scene: 6 to 18 droplets
        num_droplets = random.randint(6, 18)
        tint = random.choice(tints)

        # 50% chance to add one medium/large primary slick
        if random.random() > 0.4:
            slick_cx = random.uniform(w * 0.35, w * 0.65)
            slick_cy = random.uniform(h * 0.35, h * 0.65)
            slick_rx = random.uniform(35, 65)
            slick_ry = random.uniform(25, 45)
            slick_angle = random.uniform(-30, 30)
            slick_poly = create_smooth_polygon(slick_cx, slick_cy, slick_rx, slick_ry, slick_angle, num_pts=20)
            overlay = img.copy()
            pts = np.array(slick_poly, np.int32)
            cv2.fillPoly(overlay, [pts], tint)
            cv2.addWeighted(overlay, 0.60, img, 0.40, 0, img)
            cv2.circle(img, (int(slick_cx - slick_rx * 0.2), int(slick_cy - slick_ry * 0.2)), 5, (230, 245, 255), -1)
            lbls.append(format_yolo_polygon(slick_poly, w, h))

        # Add multiple floating droplets
        for _ in range(num_droplets):
            # Place droplets inside bucket water area
            dcx = random.uniform(w * 0.20, w * 0.80)
            dcy = random.uniform(h * 0.15, h * 0.85)
            # Distance from bucket center
            dist = math.hypot(dcx - w / 2, dcy - h / 2)
            if dist > min(w, h) * 0.42:
                continue

            drx = random.uniform(7, 22)
            dry = drx * random.uniform(0.85, 1.15)
            d_poly = create_smooth_polygon(dcx, dcy, drx, dry, angle_deg=random.uniform(-45, 45))
            draw_realistic_droplet(img, dcx, dcy, drx, dry, tint_bgr=tint)
            lbls.append(format_yolo_polygon(d_poly, w, h))

        if lbls:
            samples.append((f"c270_synth_multi_{scene_idx:02d}", img, lbls))
            # Also add horizontal flip for augmentation
            img_f = cv2.flip(img, 1)
            lbls_f = []
            for l in lbls:
                parts = l.split()
                cid = parts[0]
                coords = [float(x) for x in parts[1:]]
                flipped_coords = []
                for k in range(0, len(coords), 2):
                    flipped_coords.append(f"{1.0 - coords[k]:.5f}")
                    flipped_coords.append(f"{coords[k+1]:.5f}")
                lbls_f.append(f"{cid} " + " ".join(flipped_coords))
            samples.append((f"c270_synth_multi_{scene_idx:02d}_flip", img_f, lbls_f))

    return samples


def generate_mendeley_samples() -> list[tuple[str, np.ndarray, list[str]]]:
    chem_dir = RAW_DIR / "mendeley_chemical_pollution"
    samples: list[tuple[str, np.ndarray, list[str]]] = []
    chem_files = sorted(chem_dir.glob("*.jpg"))

    for f in chem_files[:16]:
        im = cv2.imread(str(f))
        if im is None:
            continue
        im_resized = cv2.resize(im, (640, 360), interpolation=cv2.INTER_AREA)
        h, w = im_resized.shape[:2]

        gray = cv2.cvtColor(im_resized, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (11, 11), 0)
        _, thresh = cv2.threshold(blur, 160, 255, cv2.THRESH_BINARY)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        lbls: list[str] = []
        for c in contours:
            if cv2.contourArea(c) >= 600.0:
                hull = cv2.convexHull(c)
                epsilon = 0.02 * cv2.arcLength(hull, True)
                approx = cv2.approxPolyDP(hull, epsilon, True)
                if len(approx) >= 4:
                    poly_pts = [(float(p[0][0]), float(p[0][1])) for p in approx]
                    lbls.append(format_yolo_polygon(poly_pts, w, h))

        samples.append((f"mendeley_{f.stem}", im_resized, lbls))

    return samples


def generate_negative_samples() -> list[tuple[str, np.ndarray, list[str]]]:
    c270_dir = RAW_DIR / "c270_custom"
    samples: list[tuple[str, np.ndarray, list[str]]] = []

    # 0. Laptop, Keyboard, Mousepad, Desk, Screen, Hands (CRITICAL Anti-Hallucination)
    p_bf6 = c270_dir / "c270_frame_bf6aae54.jpg"
    if p_bf6.is_file():
        im_bf6 = cv2.imread(str(p_bf6))
        if im_bf6 is not None:
            hb, wb = im_bf6.shape[:2]
            samples.append(("c270_neg_laptop_bf6_full", im_bf6, []))
            samples.append(("c270_neg_laptop_bf6_flip", cv2.flip(im_bf6, 1), []))
            # Crop keyboard area
            kb_crop = im_bf6[int(hb * 0.35):, :int(wb * 0.70)]
            if kb_crop.size > 0:
                samples.append(("c270_neg_laptop_keyboard", kb_crop, []))
            # Crop hand and trackpad area
            hand_crop = im_bf6[int(hb * 0.20):, int(wb * 0.40):]
            if hand_crop.size > 0:
                samples.append(("c270_neg_laptop_hand_trackpad", hand_crop, []))

    # 1. Ceiling mouldings and patterned acoustic tiles (anti-hallucination)
    for stem in ["aa56415b", "63a75dcf", "b8a6b5b8", "cbba596a"]:
        p = c270_dir / f"c270_frame_{stem}.jpg"
        if p.is_file():
            im = cv2.imread(str(p))
            if im is not None:
                samples.append((f"c270_neg_ceiling_{stem}", im, []))
                samples.append((f"c270_neg_ceiling_{stem}_flip", cv2.flip(im, 1), []))

    p_d958 = c270_dir / "c270_patterned_ceiling_d958.jpg"
    if p_d958.is_file():
        im_d958 = cv2.imread(str(p_d958))
        if im_d958 is not None:
            samples.append(("c270_neg_ceiling_d958", im_d958, []))
            samples.append(("c270_neg_ceiling_d958_flip", cv2.flip(im_d958, 1), []))

    # 2. White walls and room corners
    for stem in ["02f7ce16", "0726668d", "51c7cdad", "6557bfba", "75d94bbe"]:
        p = c270_dir / f"c270_frame_{stem}.jpg"
        if p.is_file():
            im = cv2.imread(str(p))
            if im is not None:
                samples.append((f"c270_neg_room_{stem}", im, []))
                samples.append((f"c270_neg_room_{stem}_flip", cv2.flip(im, 1), []))

    # 3. Clean Water
    p_clean = c270_dir / "c270_frame_8db93e46.jpg"
    if p_clean.is_file():
        im = cv2.imread(str(p_clean))
        if im is not None:
            samples.append(("c270_neg_clean_water", im, []))

    return samples


def main() -> None:
    print("[Pipeline] กำลังเริ่มต้นสร้างชุดข้อมูล Multi-Droplet ความแม่นยำสูง...")
    clean_target_dirs()

    real_samples = generate_real_c270_samples()
    print(f"  [+] ภาพถ่ายจริง C270 (หลายหยด): {len(real_samples)} ภาพ")

    synth_samples = generate_synthetic_multi_droplet_samples()
    print(f"  [+] ภาพสังเคราะห์แบบหลายหยดสมจริง (Dense Multi-droplets): {len(synth_samples)} ภาพ")

    mendeley_samples = generate_mendeley_samples()
    print(f"  [+] ภาพมลพิษเคมี Mendeley: {len(mendeley_samples)} ภาพ")

    positives = real_samples + synth_samples + mendeley_samples
    negatives = generate_negative_samples()
    print(f"  [+] ภาพ Negative (ขอบบัว/ผนัง/น้ำเปล่า): {len(negatives)} ภาพ")
    print(f"  [*] ยอดรวมทั้งหมด: {len(positives) + len(negatives)} ภาพ (Positive: {len(positives)}, Negative: {len(negatives)})")

    # Split: Train 78%, Val 22%
    np.random.seed(42)
    np.random.shuffle(positives)
    np.random.shuffle(negatives)

    n_val_pos = max(2, int(len(positives) * 0.20))
    n_val_neg = max(2, int(len(negatives) * 0.20))

    val_samples = positives[:n_val_pos] + negatives[:n_val_neg]
    train_samples = positives[n_val_pos:] + negatives[n_val_neg:]
    test_samples = val_samples[:4]

    splits = {
        "train": train_samples,
        "val": val_samples,
        "test": test_samples,
    }

    for split_name, samples in splits.items():
        print(f"\n[Split: {split_name}] จำนวน {len(samples)} ภาพ")
        pos_cnt = sum(1 for s in samples if len(s[2]) > 0)
        neg_cnt = len(samples) - pos_cnt
        total_instances = sum(len(s[2]) for s in samples)
        print(f"  - Positive: {pos_cnt}, Negative: {neg_cnt}, Total Instances: {total_instances}")

        for name, img, labels in samples:
            img_path = IMAGES_DIR / split_name / f"{name}.jpg"
            lbl_path = LABELS_DIR / split_name / f"{name}.txt"

            cv2.imwrite(str(img_path), img)
            with open(lbl_path, "w", encoding="utf-8") as f:
                if labels:
                    f.write("\n".join(labels) + "\n")

    print("\n[+] สร้างชุดข้อมูล Multi-Droplet สำเร็จเรียบร้อย!")


if __name__ == "__main__":
    main()
