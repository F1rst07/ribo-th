"""Export current checkpoints without quantizing weights or changing labels.

Run with the existing training environment: python export_models.py OUTPUT_DIR
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

os.environ["ULTRALYTICS_AUTOINSTALL"] = "0"
os.environ["YOLO_OFFLINE"] = "1"
from ultralytics import YOLO

root = Path(__file__).resolve().parents[2]
output = Path(sys.argv[1]).resolve()
output.mkdir(parents=True, exist_ok=True)
manifest = []
for name, relative in [("trash_new", "models/trash_new.pt"), ("milk", "models/milk.pt"),
                       ("oil_best", "models/oil/best.pt"), ("oil_fallback", "models/oil/basin_adapt_v2.pt")]:
    source = root / relative
    checkpoint = output / f"{name}.pt"
    shutil.copy2(source, checkpoint)
    model = YOLO(str(checkpoint))
    exported = Path(model.export(format="onnx", imgsz=640, opset=17, simplify=False, dynamic=True, nms=False, device="cpu"))
    manifest.append({"name": name, "source": relative, "task": model.task, "classes": model.names,
                     "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                     "onnx_sha256": hashlib.sha256(exported.read_bytes()).hexdigest()})
(output / "manifest.json").write_text(json.dumps(manifest, indent=2))
