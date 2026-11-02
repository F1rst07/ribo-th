#!/usr/bin/env python3
"""RIBO-TH Fine-Tuning Pipeline for Trash Detection (Milk Carton + Marine Litter)

ฝึกฝนโมเดลตรวจจับกล่องนม (Foremost & Commercial Cartons) และขยะทางน้ำ
- Base Weights: models/trash_new.pt
- Dataset: datasets/trash/data.yaml (138 ภาพ รวมภาพกล่องนม 30 ภาพ และภาพจริงจาก C270)
- Device: Apple Silicon GPU (mps)
- Early Stopping: patience=15
- Output: models/trash_new.pt
"""

from __future__ import annotations

import os
import shutil
import time
from pathlib import Path
import torch
from ultralytics import YOLO

PROJECT_DIR = Path(__file__).resolve().parent.parent
DATA_YAML = PROJECT_DIR / "datasets" / "trash" / "data.yaml"
BASE_MODEL = PROJECT_DIR / "models" / "trash_new.pt"
OUTPUT_MODEL = PROJECT_DIR / "models" / "trash_new.pt"
BACKUP_MODEL = PROJECT_DIR / "models" / "trash_new.pt.bak"


def main() -> None:
    print("\n=======================================================")
    print(" RIBO-TH Fine-Tuning Trash Model (Milk Carton Focus)")
    print("=======================================================\n")

    device = "cpu"
    if torch.backends.mps.is_available():
        device = "mps"
    print(f"[*] Training Device: {device.upper()}")

    if not DATA_YAML.is_file():
        raise FileNotFoundError(f"data.yaml not found: {DATA_YAML}")
    if not BASE_MODEL.is_file():
        raise FileNotFoundError(f"Base model not found: {BASE_MODEL}")

    # Backup current model
    if BASE_MODEL.is_file() and not BACKUP_MODEL.is_file():
        shutil.copy2(BASE_MODEL, BACKUP_MODEL)
        print(f"[*] Backed up current model to {BACKUP_MODEL}")

    print(f"[*] Loading base model: {BASE_MODEL.name}")
    model = YOLO(str(BASE_MODEL))

    started = time.perf_counter()
    print("[*] Starting training (35 epochs, fine-tuning lr0=0.001)...")

    results = model.train(
        data=str(DATA_YAML),
        epochs=35,
        imgsz=640,
        batch=8,
        device=device,
        workers=2,
        lr0=0.001,
        lrf=0.01,
        warmup_epochs=2,
        patience=15,
        optimizer="AdamW",
        val=True,
        save=True,
        project=str(PROJECT_DIR / "runs" / "trash_milk"),
        name="train",
        exist_ok=True,
        verbose=True,
    )

    elapsed_min = (time.perf_counter() - started) / 60.0
    print(f"\n[+] Training finished in {elapsed_min:.1f} minutes!")

    # Check best model weights
    best_weights = PROJECT_DIR / "runs" / "trash_milk" / "train" / "weights" / "best.pt"
    if not best_weights.is_file():
        best_weights = PROJECT_DIR / "runs" / "trash_milk" / "train" / "weights" / "last.pt"

    if best_weights.is_file():
        shutil.copy2(best_weights, OUTPUT_MODEL)
        print(f"[+] Successfully exported best model to: {OUTPUT_MODEL}")
    else:
        print(f"[!] Warning: No weights file found at {best_weights}")


if __name__ == "__main__":
    main()
