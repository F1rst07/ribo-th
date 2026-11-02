#!/usr/bin/env python3
"""
Static Inference Benchmark for RIBO-TH YOLO11n-seg Oil Detection
Tests the newly trained YOLO11n-seg model on:
1. Domestic cooking oil (clear/yellow droplets in bucket)
2. Cooking oil sheen / used dark oil
3. Mendeley chemical pollution sample
4. False alarm / Negative samples (ceiling moulding, white walls, clean water)
"""

import os
import sys
import time
from pathlib import Path
import cv2
import numpy as np

# Force offline mode
os.environ["YOLO_OFFLINE"] = "1"
os.environ["ULTRALYTICS_OFFLINE"] = "1"

try:
    from ultralytics import YOLO
except ImportError:
    print("[!] Ultralytics not found. Run in .venv.")
    sys.exit(1)

def run_benchmark():
    project_root = Path(__file__).resolve().parent.parent
    model_path = project_root / "models" / "oil" / "best.pt"

    if not model_path.exists():
        print(f"[!] Model not found at: {model_path}")
        sys.exit(1)

    print(f"=======================================================")
    print(f" RIBO-TH YOLO11n-seg Oil Spill Static Benchmark")
    print(f"=======================================================")
    print(f"[*] Model Path : {model_path}")

    model = YOLO(str(model_path))

    test_cases = [
        {
            "category": "C270 Clear Cooking Oil Droplets (Real Bucket)",
            "path": project_root / "datasets" / "oil" / "raw" / "c270_custom" / "c270_frame_a67b4afa.jpg",
            "expected_detection": True,
            "description": "User image showing oil drops in bucket where old NAFTA failed (0 detection)"
        },
        {
            "category": "C270 Oil Sheen / Used Oil (Real Bucket)",
            "path": project_root / "datasets" / "oil" / "raw" / "c270_custom" / "c270_frame_f86fd927.jpg",
            "expected_detection": True,
            "description": "Yellowish oil sheen spread in bucket"
        },
        {
            "category": "C270 Surface Oil (Real Bucket)",
            "path": project_root / "datasets" / "oil" / "raw" / "c270_custom" / "c270_frame_e394d240.jpg",
            "expected_detection": True,
            "description": "Surface oil sheen and reflection in bucket"
        },
        {
            "category": "Mendeley Chemical Pollution Sample",
            "path": project_root / "datasets" / "oil" / "raw" / "mendeley_chemical_pollution" / "chemical_004.jpg",
            "expected_detection": True,
            "description": "Chemical pollution foam from Mendeley dataset"
        },
        {
            "category": "NEGATIVE SAMPLE : Indoor Ceiling Moulding (Hallucination Test)",
            "path": project_root / "datasets" / "oil" / "raw" / "c270_custom" / "c270_frame_aa56415b.jpg",
            "expected_detection": False,
            "description": "Ceiling cornice where old NAFTA had 6 false positives (100% confidence)"
        },
        {
            "category": "NEGATIVE SAMPLE : White Wall / Room Corner",
            "path": project_root / "datasets" / "oil" / "raw" / "c270_custom" / "c270_frame_02f7ce16.jpg",
            "expected_detection": False,
            "description": "White interior wall corner"
        },
        {
            "category": "NEGATIVE SAMPLE : Clean Water Bucket",
            "path": project_root / "datasets" / "oil" / "raw" / "c270_custom" / "c270_frame_8db93e46.jpg",
            "expected_detection": False,
            "description": "Clean water with zero oil"
        }
    ]

    out_dir = project_root / "runs" / "oil_segment" / "static_test_results"
    out_dir.mkdir(parents=True, exist_ok=True)

    all_passed = True
    results_summary = []

    for i, test in enumerate(test_cases, 1):
        img_path = test["path"]
        print(f"\n--- [Test #{i}] {test['category']} ---")
        print(f"    File : {img_path.name}")
        print(f"    Desc : {test['description']}")

        if not img_path.exists():
            print(f"    [!] File not found: {img_path}")
            continue

        t0 = time.perf_counter()
        results = model.predict(
            source=str(img_path),
            conf=0.20,
            iou=0.45,
            device="mps",
            verbose=False
        )
        t_infer = (time.perf_counter() - t0) * 1000

        res = results[0]
        num_dets = len(res.boxes) if res.boxes is not None else 0
        has_masks = res.masks is not None and len(res.masks) > 0

        print(f"    Inference Time : {t_infer:.1f} ms")
        print(f"    Detections : {num_dets} object(s) detected")

        det_details = []
        if num_dets > 0:
            for j, box in enumerate(res.boxes):
                cls_id = int(box.cls[0].item())
                cls_name = res.names.get(cls_id, str(cls_id))
                conf = float(box.conf[0].item()) * 100
                xyxy = box.xyxy[0].cpu().numpy().tolist()

                mask_pts = 0
                if has_masks and j < len(res.masks.xy):
                    mask_pts = len(res.masks.xy[j])

                print(f"    -> #{j+1} [{cls_name}] Conf: {conf:.1f}% | Box: [{int(xyxy[0])}, {int(xyxy[1])}, {int(xyxy[2])}, {int(xyxy[3])}] | Polygon Points: {mask_pts}")
                det_details.append(f"{cls_name} ({conf:.1f}%)")

        # Save visualization
        annotated_img = res.plot()
        save_path = out_dir / f"test_{i}_{img_path.stem}_result.jpg"
        cv2.imwrite(str(save_path), annotated_img)
        print(f"    Visual Saved : {save_path.name}")

        # Evaluate success
        if test["expected_detection"]:
            passed = num_dets > 0
            status_str = "PASS (Detected as expected)" if passed else "FAIL (Expected oil detection)"
        else:
            passed = num_dets == 0
            status_str = "PASS (Clean - 0 False Alarms)" if passed else f"FAIL ({num_dets} False Alarm(s)!)"

        if not passed:
            all_passed = False

        print(f"    Evaluation : {status_str}")
        results_summary.append({
            "test_num": i,
            "category": test["category"],
            "filename": img_path.name,
            "infer_ms": t_infer,
            "dets": num_dets,
            "passed": passed,
            "status": status_str,
            "details": ", ".join(det_details) if det_details else "None"
        })

    print(f"\n=======================================================")
    print(f" BENCHMARK SUMMARY")
    print(f"=======================================================")
    for r in results_summary:
        mark = "✅" if r["passed"] else "❌"
        print(f"{mark} Test #{r['test_num']}: {r['category']}")
        print(f"   Detections: {r['dets']} | {r['status']} | {r['infer_ms']:.1f}ms")
    print(f"=======================================================")

    if all_passed:
        print("[+] ALL STATIC BENCHMARK TESTS PASSED PERFECTLY!")
    else:
        print("[!] SOME TESTS FAILED EVALUATION CRITERIA.")

if __name__ == "__main__":
    run_benchmark()
