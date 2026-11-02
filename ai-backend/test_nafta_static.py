#!/usr/bin/env python3
"""
RIBO-TH: NAFTA PSPNet Static Image Segmentation Benchmark
Tests 3 categories of images:
  1. Clean water without oil
  2. Water surface with real oil spill
  3. Water surface with glare / reflections / shadows
Outputs:
  - Original Image
  - Segmentation Binary Mask
  - Semi-Transparent Overlay with Contours & Centroids
  - Quantitative Metrics: Area (px, %), Max/Mean Probability, Inference Time (ms)
"""
import os
import sys
import time
from pathlib import Path
import cv2
import numpy as np
import torch
import torch.nn.functional as F

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent
NAFTA_WEIGHTS = PROJECT_DIR / "models" / "nafta" / "ResNet50_PSPNet.00050"
OUTPUT_DIR = PROJECT_DIR / "ai-backend" / "nafta_test_results"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Add project root to sys.path to import nafta_pspnet
sys.path.insert(0, str(PROJECT_DIR))
from models.nafta.nafta_pspnet import ResNet50_PSPNet_PyTorch, load_nafta_weights


def load_model():
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"[nafta-test] Loading model onto device: {device}")
    model = ResNet50_PSPNet_PyTorch(n_classes=2)
    load_nafta_weights(model, str(NAFTA_WEIGHTS))
    model.to(device)
    model.eval()
    return model, device


def run_inference(model, device, img_bgr, conf_thresh=0.50, input_w=576, input_h=384):
    orig_h, orig_w = img_bgr.shape[:2]
    # Keras sub_mean preprocessing: ImageNet BGR means
    resized = cv2.resize(img_bgr, (input_w, input_h)).astype(np.float32)
    means = [103.939, 116.779, 123.68]
    for i in range(3):
        resized[:, :, i] -= means[i]
    tensor = torch.from_numpy(resized.transpose(2, 0, 1)).unsqueeze(0).to(device)

    # Warmup / synchronize for accurate timing
    if device.type == "mps":
        torch.mps.synchronize()
    t0 = time.perf_counter()

    with torch.no_grad():
        logits = model(tensor)
        # Bilinear interpolation back to native camera resolution
        logits_orig = F.interpolate(logits, size=(orig_h, orig_w), mode="bilinear", align_corners=False)
        probs = F.softmax(logits_orig, dim=1)[0].cpu().numpy()
        oil_prob = probs[1]

    if device.type == "mps":
        torch.mps.synchronize()
    elapsed_ms = (time.perf_counter() - t0) * 1000

    # Binary mask from threshold
    binary_mask = (oil_prob >= conf_thresh).astype(np.uint8) * 255

    # Extract polygon contours and centroid points
    contours, _ = cv2.findContours(binary_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    regions = []
    min_region_area = 50  # Filter sub-pixel noise
    for c in contours:
        area = cv2.contourArea(c)
        if area >= min_region_area:
            M = cv2.moments(c)
            if M["m00"] > 0:
                cx = int(M["m10"] / M["m00"])
                cy = int(M["m01"] / M["m00"])
            else:
                x, y, w, h = cv2.boundingRect(c)
                cx, cy = x + w // 2, y + h // 2
            # Sample confidence inside contour
            mask_c = np.zeros_like(oil_prob, dtype=np.uint8)
            cv2.drawContours(mask_c, [c], -1, 1, -1)
            mean_conf = float(np.mean(oil_prob[mask_c == 1]))
            max_conf = float(np.max(oil_prob[mask_c == 1]))
            # Approximate polygon points for frontend rendering
            epsilon = 0.008 * cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, epsilon, True)
            pts = [{"x": float(p[0][0]), "y": float(p[0][1])} for p in approx]
            x, y, w, h = cv2.boundingRect(c)
            regions.append({
                "area_px": int(area),
                "area_pct": float(area / (orig_w * orig_h) * 100),
                "centroid": (cx, cy),
                "bbox": [x, y, x + w, y + h],
                "mean_conf": mean_conf,
                "max_conf": max_conf,
                "points": pts,
            })

    # Create semi-transparent overlay matching the user's reference image
    overlay = img_bgr.copy()
    color_bgr = (0, 140, 255)  # Vibrant orange (or 200, 50, 180 for violet)
    overlay[binary_mask > 0] = color_bgr
    blended = cv2.addWeighted(overlay, 0.45, img_bgr, 0.55, 0)

    # Draw border contours and badges
    for r in regions:
        # Draw contour line
        pts_arr = np.array([[int(p["x"]), int(p["y"])] for p in r["points"]], dtype=np.int32)
        cv2.polylines(blended, [pts_arr], True, (0, 100, 255), 2, cv2.LINE_AA)
        cx, cy = r["centroid"]
        label = f"Oil Spill : {int(round(r['max_conf'] * 100))}%"
        # Badge background
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        bx1, by1 = max(0, cx - tw // 2 - 4), max(0, cy - th - 6)
        bx2, by2 = min(orig_w, bx1 + tw + 8), min(orig_h, by1 + th + 8)
        cv2.rectangle(blended, (bx1, by1), (bx2, by2), (20, 26, 32), -1)
        cv2.rectangle(blended, (bx1, by1), (bx2, by2), (0, 140, 255), 1)
        cv2.putText(blended, label, (bx1 + 4, by1 + th + 2), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 180, 255), 1, cv2.LINE_AA)
        # Center dot
        cv2.circle(blended, (cx, cy), 3, (0, 220, 255), -1)

    total_oil_px = int(np.count_nonzero(binary_mask))
    total_oil_pct = float(total_oil_px / (orig_w * orig_h) * 100)

    return {
        "elapsed_ms": elapsed_ms,
        "max_prob": float(np.max(oil_prob)),
        "mean_prob": float(np.mean(oil_prob)),
        "total_oil_px": total_oil_px,
        "total_oil_pct": total_oil_pct,
        "regions_count": len(regions),
        "regions": regions,
        "binary_mask": binary_mask,
        "blended_overlay": blended,
    }


def main():
    model, device = load_model()

    test_cases = [
        {
            "name": "1_clean_water",
            "title": "Clean Water (No Oil)",
            "path": "/tmp/user_crop_3.jpg",
        },
        {
            "name": "2_oil_spill",
            "title": "Water Surface with Real Oil Spill",
            "path": "/tmp/crop_screen_oil.jpg",
        },
        {
            "name": "3_reflection_glare",
            "title": "Water Surface with Lighting / Glare / Shadows",
            "path": "/tmp/live_cam_frame.jpg",
        },
    ]

    print("=" * 70)
    print("RIBO-TH: NAFTA PSPNET STATIC BENCHMARK RESULTS")
    print("=" * 70)

    for tc in test_cases:
        p = tc["path"]
        if not os.path.exists(p):
            print(f"[SKIP] File not found: {p}")
            continue

        img = cv2.imread(p)
        res = run_inference(model, device, img, conf_thresh=0.45)

        # Save files
        orig_out = OUTPUT_DIR / f"{tc['name']}_orig.jpg"
        mask_out = OUTPUT_DIR / f"{tc['name']}_mask.png"
        overlay_out = OUTPUT_DIR / f"{tc['name']}_overlay.jpg"

        cv2.imwrite(str(orig_out), img)
        cv2.imwrite(str(mask_out), res["binary_mask"])
        cv2.imwrite(str(overlay_out), res["blended_overlay"])

        print(f"\n--- Category: {tc['title']} ({tc['name']}) ---")
        print(f"  Input Resolution  : {img.shape[1]}x{img.shape[0]} px")
        print(f"  Inference Time    : {res['elapsed_ms']:.2f} ms (~{1000/res['elapsed_ms']:.1f} FPS)")
        print(f"  Max Oil Prob      : {res['max_prob']*100:.2f}%")
        print(f"  Mean Oil Prob     : {res['mean_prob']*100:.2f}%")
        print(f"  Detected Regions  : {res['regions_count']} distinct areas")
        print(f"  Oil Surface Area  : {res['total_oil_px']} px ({res['total_oil_pct']:.2f}% of image)")
        for i, r in enumerate(res["regions"]):
            print(f"    Region #{i+1} : Area={r['area_px']} px ({r['area_pct']:.2f}%), Centroid={r['centroid']}, Max Conf={r['max_conf']*100:.1f}%, Points={len(r['points'])}")
        print(f"  Outputs Saved To  : {overlay_out.name}, {mask_out.name}")

    print("\n" + "=" * 70)
    print(f"All benchmark artifacts saved in: {OUTPUT_DIR}")
    print("=" * 70)


if __name__ == "__main__":
    main()
