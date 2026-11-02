#!/usr/bin/env python3
"""RIBO-TH — Training Pipeline for YOLO11n-seg Oil Spill Segmentation

ฝึกฝนโมเดลตรวจจับและแบ่งส่วนคราบน้ำมันบนผิวน้ำ (YOLO11n-seg)
- Base Architecture: yolo11n-seg.pt
- Task: segment (Instance Segmentation)
- Class: 1 (0: oil)
- Hardware: Apple Silicon GPU (mps)
- Early Stopping: patience=20
- Export: models/oil/best.pt
"""

from __future__ import annotations

import os
import shutil
import time
from pathlib import Path
from ultralytics import YOLO
import torch

PROJECT_DIR = Path(__file__).resolve().parent.parent
DATA_YAML = PROJECT_DIR / "datasets" / "oil" / "data.yaml"
BASE_MODEL = PROJECT_DIR / "yolo11n-seg.pt"
OUTPUT_DIR = PROJECT_DIR / "models" / "oil"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def train_oil_model() -> None:
    print("\n=======================================================")
    print(" RIBO-TH YOLO11n-seg Oil Spill Training Pipeline")
    print("=======================================================\n")

    # Hardware detection
    device = "cpu"
    if torch.backends.mps.is_available():
        device = "mps"
    print(f"[*] Training Device: {device.upper()}")

    # Verify data.yaml
    if not DATA_YAML.is_file():
        raise FileNotFoundError(f"data.yaml not found: {DATA_YAML}")

    # Load base YOLO11n-seg model
    print(f"[*] Loading base model: yolo11n-seg.pt")
    model = YOLO("yolo11n-seg.pt")

    # Hyperparameters
    epochs = 50
    patience = 0
    imgsz = 640
    batch_size = 8

    print(f"[*] Starting training with:")
    print(f"    - Epochs: {epochs}")
    print(f"    - Patience: {patience} (disabled)")
    print(f"    - Image Size: {imgsz}")
    print(f"    - Batch Size: {batch_size}")
    print(f"    - Device: {device}\n")

    start_time = time.perf_counter()
    results = model.train(
        data=str(DATA_YAML),
        epochs=epochs,
        patience=patience,
        imgsz=imgsz,
        batch=batch_size,
        device=device,
        workers=0,
        deterministic=False,
        mosaic=0.0,
        project=str(PROJECT_DIR / "runs" / "oil_segment"),
        name="train_yolo11n_seg",
        exist_ok=True,
        verbose=True,
        save=True,
    )
    duration_s = time.perf_counter() - start_time

    # Identify best.pt
    best_weights = PROJECT_DIR / "runs" / "oil_segment" / "train_yolo11n_seg" / "weights" / "best.pt"
    if not best_weights.is_file():
        raise FileNotFoundError(f"Expected best weights not found: {best_weights}")

    target_best = OUTPUT_DIR / "best.pt"
    shutil.copy2(best_weights, target_best)
    print(f"\n[+] Successfully saved best trained model to: {target_best}")
    print(f"[+] Total Training Time: {duration_s / 60:.2f} minutes")

    # Run validation
    print("\n[*] Running final validation on test set...")
    val_model = YOLO(str(target_best))
    val_metrics = val_model.val(data=str(DATA_YAML), split="val", imgsz=imgsz, device=device)

    print("\n=======================================================")
    print(" Validation Metrics Summary:")
    print(f" Box mAP50    : {val_metrics.box.map50 * 100:.2f}%")
    print(f" Box mAP50-95 : {val_metrics.box.map * 100:.2f}%")
    print(f" Mask mAP50   : {val_metrics.seg.map50 * 100:.2f}%")
    print(f" Mask mAP50-95: {val_metrics.seg.map * 100:.2f}%")
    print("=======================================================\n")


if __name__ == "__main__":
    train_oil_model()
