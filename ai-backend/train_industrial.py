#!/usr/bin/env python3
"""Train YOLO11m on remapped industrial waste classes, then export ONNX 320."""
from __future__ import annotations

import shutil
from pathlib import Path

import torch
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "datasets" / "industrial" / "data.yaml"
DEST_PT = ROOT / "models" / "trash_new.pt"
DEST_ONNX = ROOT / "models" / "trash_new.onnx"
RUNS = ROOT / "runs" / "industrial"


def main() -> None:
    if not DATA.is_file():
        raise FileNotFoundError(DATA)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print("device", device)
    model = YOLO("yolo11s.pt")
    model.train(
        data=str(DATA),
        epochs=50,
        imgsz=640,
        batch=16 if device == "mps" else 8,
        device=device,
        workers=4,
        patience=12,
        optimizer="AdamW",
        lr0=0.002,
        lrf=0.01,
        warmup_epochs=3,
        mosaic=0.8,
        close_mosaic=8,
        hsv_h=0.015,
        hsv_s=0.6,
        hsv_v=0.4,
        degrees=8.0,
        translate=0.12,
        scale=0.6,
        fliplr=0.5,
        val=True,
        save=True,
        project=str(RUNS),
        name="train",
        exist_ok=True,
        plots=False,
        verbose=True,
    )
    best = RUNS / "train" / "weights" / "best.pt"
    if not best.is_file():
        best = RUNS / "train" / "weights" / "last.pt"
    shutil.copy2(best, DEST_PT)
    trained = YOLO(str(DEST_PT))
    exported = Path(
        trained.export(
            format="onnx",
            imgsz=320,
            opset=17,
            simplify=True,
            dynamic=True,
            nms=False,
            device="cpu",
        )
    )
    shutil.copy2(exported, DEST_ONNX)
    print("pt", DEST_PT, DEST_PT.stat().st_size)
    print("onnx", DEST_ONNX, DEST_ONNX.stat().st_size)


if __name__ == "__main__":
    main()
