#!/usr/bin/env python3
"""Build a YOLO industrial-waste dataset from official TACO COCO annotations."""
from __future__ import annotations

import json
import random
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "datasets" / "taco-yolo" / "data"
ANN = SRC / "annotations.json"
DST = ROOT / "datasets" / "industrial"

NAME_TO_INDUSTRIAL = {
    "Clear plastic bottle": "plastic water bottle",
    "Other plastic bottle": "plastic water bottle",
    "Glass bottle": "clear glass bottle",
    "Glass jar": "clear glass bottle",
    "Glass cup": "clear glass bottle",
    "Broken glass": "clear glass bottle",
    "Corrugated carton": "cardboard box",
    "Pizza box": "cardboard box",
    "Other carton": "cardboard box",
    "Egg carton": "cardboard box",
    "Meal carton": "cardboard box",
    "Drink carton": "cardboard box",
    "Magazine paper": "newspaper",
    "Wrapping paper": "newspaper",
    "Normal paper": "A4 paper",
    "Tissues": "A4 paper",
    "Toilet tube": "A4 paper",
    "Paper bag": "A4 paper",
    "Paper cup": "A4 paper",
    "Drink can": "soda can",
    "Food Can": "condensed milk can",
    "Scrap metal": "scrap metal",
    "Aluminium foil": "scrap metal",
    "Pop tab": "scrap metal",
    "Metal bottle cap": "scrap metal",
    "Metal lid": "scrap metal",
    "Battery": "battery",
    "Aerosol": "spray can",
    "Squeezable tube": "toilet cleaner bottle",
    "Other plastic container": "toilet cleaner bottle",
    "Plastic glooves": "face mask",
    "Single-use carrier bag": "plastic bag",
    "Garbage bag": "plastic bag",
    "Other plastic wrapper": "plastic bag",
    "Plastic film": "plastic bag",
    "Polypropylene bag": "plastic bag",
    "Plastified paper bag": "plastic bag",
    "Crisp packet": "plastic bag",
    "Six pack rings": "plastic bag",
    "Styrofoam piece": "styrofoam",
    "Foam cup": "styrofoam",
    "Foam food container": "styrofoam",
}

CLASS_ORDER = [
    "plastic water bottle",
    "clear glass bottle",
    "cardboard box",
    "newspaper",
    "A4 paper",
    "soda can",
    "condensed milk can",
    "scrap metal",
    "battery",
    "spray can",
    "toilet cleaner bottle",
    "face mask",
    "plastic bag",
    "styrofoam",
]


def main() -> None:
    coco = json.loads(ANN.read_text())
    cat_id_to_name = {c["id"]: c["name"] for c in coco["categories"]}
    images = {im["id"]: im for im in coco["images"]}
    boxes: dict[int, list[str]] = {im_id: [] for im_id in images}
    skipped = 0
    for ann in coco["annotations"]:
        taco_name = cat_id_to_name.get(ann["category_id"])
        dest_name = NAME_TO_INDUSTRIAL.get(taco_name or "")
        if dest_name is None:
            skipped += 1
            continue
        image = images[ann["image_id"]]
        bw = max(1.0, float(image["width"]))
        bh = max(1.0, float(image["height"]))
        x, y, w, h = (float(v) for v in ann["bbox"])
        if w < 2 or h < 2:
            continue
        xc = (x + w / 2.0) / bw
        yc = (y + h / 2.0) / bh
        nw = min(1.0, w / bw)
        nh = min(1.0, h / bh)
        if not (0 < nw <= 1 and 0 < nh <= 1):
            continue
        dest_id = CLASS_ORDER.index(dest_name)
        boxes[ann["image_id"]].append(f"{dest_id} {xc:.6f} {yc:.6f} {nw:.6f} {nh:.6f}")

    usable = [(im, rows) for im_id, rows in boxes.items() if rows and (im := images[im_id])]
    random.seed(42)
    random.shuffle(usable)
    split = max(1, int(len(usable) * 0.85))
    subsets = {"train": usable[:split], "val": usable[split:]}
    if DST.exists():
        shutil.rmtree(DST)
    counts = {name: 0 for name in CLASS_ORDER}
    kept = 0
    for split_name, items in subsets.items():
        img_dir = DST / "images" / split_name
        lbl_dir = DST / "labels" / split_name
        img_dir.mkdir(parents=True, exist_ok=True)
        lbl_dir.mkdir(parents=True, exist_ok=True)
        for image, rows in items:
            src = SRC / image["file_name"]
            if not src.is_file():
                continue
            stem = image["file_name"].replace("/", "_").rsplit(".", 1)[0]
            shutil.copy2(src, img_dir / f"{stem}{src.suffix.lower()}")
            (lbl_dir / f"{stem}.txt").write_text("\n".join(rows) + "\n")
            kept += 1
            for row in rows:
                counts[CLASS_ORDER[int(row.split()[0])]] += 1
    yaml = DST / "data.yaml"
    names = "\n".join(f"  {i}: {name}" for i, name in enumerate(CLASS_ORDER))
    yaml.write_text(f"path: {DST}\ntrain: images/train\nval: images/val\nnames:\n{names}\n")
    print(f"images={kept} skipped_anns={skipped}")
    for name, count in counts.items():
        print(f"  {count:5d}  {name}")
    print("yaml", yaml)


if __name__ == "__main__":
    main()
