#!/usr/bin/env python3
"""Bake industrial waste vocabulary into YOLOE and export ONNX for UNO Q."""
from __future__ import annotations

import shutil
from pathlib import Path

from ultralytics import YOLOE

ROOT = Path(__file__).resolve().parent.parent
DEST_ONNX = ROOT / "models" / "trash_new.onnx"
DEST_PT = ROOT / "models" / "trash_new.pt"

# Prompts the open-vocab model actually looks for. Keep them short and visual.
INDUSTRIAL_WASTE_CLASSES = [
    "plastic water bottle",
    "clear glass bottle",
    "energy drink bottle",
    "cardboard box",
    "newspaper",
    "notebook",
    "A4 paper",
    "soda can",
    "condensed milk can",
    "scrap metal",
    "battery",
    "phone battery",
    "charging cable",
    "fluorescent tube",
    "spray can",
    "toilet cleaner bottle",
    "face mask",
    "ATK test kit",
    "plastic bag",
    "styrofoam",
]


def main() -> None:
    model = YOLOE("yoloe-11m-seg.pt")
    names = list(INDUSTRIAL_WASTE_CLASSES)
    model.set_classes(names, model.get_text_pe(names))
    exported = Path(
        model.export(
            format="onnx",
            imgsz=320,
            opset=17,
            simplify=True,
            dynamic=True,
            nms=False,
            device="cpu",
        )
    )
    DEST_ONNX.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(exported, DEST_ONNX)
    fused = ROOT / "models" / "trash_new_industrial.pt"
    model.save(str(fused))
    shutil.copy2(fused, DEST_PT)
    print("classes", len(names), names)
    print("onnx", DEST_ONNX, DEST_ONNX.stat().st_size)
    print("pt", DEST_PT, DEST_PT.stat().st_size)


if __name__ == "__main__":
    main()
