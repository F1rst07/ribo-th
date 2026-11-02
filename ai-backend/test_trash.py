from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent
DEFAULT_MODEL = PROJECT_DIR / "models" / "trash.pt"
DEFAULT_RESULTS_DIR = BACKEND_DIR / "results"
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png"}
DEFAULT_THRESHOLDS = (0.05, 0.15, 0.25, 0.40)

# Keep Ultralytics settings local to this backend instead of writing to a user profile.
os.environ.setdefault("YOLO_CONFIG_DIR", str(BACKEND_DIR / ".ultralytics"))

import cv2  # noqa: E402
from ultralytics import YOLO  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Test the local trash.pt model against one image at multiple confidence thresholds."
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--image", type=Path, help="JPG, JPEG, or PNG image to test")
    source.add_argument(
        "--camera-index",
        type=int,
        help="Capture one still image from this OpenCV camera index before testing",
    )
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--results-dir", type=Path, default=DEFAULT_RESULTS_DIR)
    parser.add_argument("--imgsz", type=int, default=640, help="YOLO inference image size")
    parser.add_argument("--iou", type=float, default=0.70, help="NMS IoU threshold")
    parser.add_argument(
        "--thresholds",
        type=float,
        nargs="+",
        default=DEFAULT_THRESHOLDS,
        help="Confidence thresholds to compare",
    )
    parser.add_argument(
        "--warmup-frames",
        type=int,
        default=15,
        help="Frames to discard before saving a camera still",
    )
    return parser.parse_args()


def validate_args(args: argparse.Namespace) -> None:
    if not args.model.is_file():
        raise FileNotFoundError(f"Model not found: {args.model}")
    if args.image is not None:
        if not args.image.is_file():
            raise FileNotFoundError(f"Image not found: {args.image}")
        if args.image.suffix.lower() not in SUPPORTED_EXTENSIONS:
            supported = ", ".join(sorted(SUPPORTED_EXTENSIONS))
            raise ValueError(f"Unsupported image type. Expected one of: {supported}")
    if args.imgsz <= 0:
        raise ValueError("--imgsz must be greater than zero")
    if not 0 < args.iou <= 1:
        raise ValueError("--iou must be in the range (0, 1]")
    if not args.thresholds or any(not 0 < value <= 1 for value in args.thresholds):
        raise ValueError("Every confidence threshold must be in the range (0, 1]")
    if args.warmup_frames < 0:
        raise ValueError("--warmup-frames cannot be negative")


def capture_camera_still(camera_index: int, warmup_frames: int, destination: Path) -> Path:
    capture = cv2.VideoCapture(camera_index, cv2.CAP_AVFOUNDATION)
    try:
        if not capture.isOpened():
            raise RuntimeError(
                "Camera could not be opened. Close the Dashboard camera stream and allow Camera access "
                "for the terminal application in macOS System Settings > Privacy & Security > Camera."
            )
        capture.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

        frame = None
        for _ in range(max(1, warmup_frames + 1)):
            ok, candidate = capture.read()
            if ok and candidate is not None:
                frame = candidate
            time.sleep(0.03)
        if frame is None:
            raise RuntimeError("Camera opened but did not return a valid frame")

        destination.parent.mkdir(parents=True, exist_ok=True)
        if not cv2.imwrite(str(destination), frame):
            raise RuntimeError(f"Failed to save captured frame: {destination}")
        return destination
    finally:
        capture.release()


def serialize_detections(result: Any, names: dict[int, str]) -> list[dict[str, Any]]:
    if result.boxes is None:
        return []
    detections: list[dict[str, Any]] = []
    for box in result.boxes:
        class_id = int(box.cls.item())
        detections.append(
            {
                "class_id": class_id,
                "class_name": names[class_id],
                "confidence": round(float(box.conf.item()), 6),
                "xyxy": [round(float(value), 2) for value in box.xyxy[0].tolist()],
            }
        )
    return detections


def main() -> int:
    args = parse_args()
    validate_args(args)
    args.results_dir.mkdir(parents=True, exist_ok=True)

    if args.camera_index is not None:
        timestamp = time.strftime("%Y%m%d-%H%M%S")
        image_path = capture_camera_still(
            args.camera_index,
            args.warmup_frames,
            args.results_dir / f"c270-{timestamp}.jpg",
        )
    else:
        image_path = args.image.resolve()

    image = cv2.imread(str(image_path))
    if image is None:
        raise RuntimeError(f"OpenCV could not decode image: {image_path}")

    model = YOLO(str(args.model.resolve()))
    names = {int(class_id): str(name) for class_id, name in model.names.items()}
    stem = image_path.stem
    original_path = args.results_dir / f"{stem}-original.jpg"
    if not cv2.imwrite(str(original_path), image):
        raise RuntimeError(f"Failed to save original image: {original_path}")

    report: dict[str, Any] = {
        "model": str(args.model.resolve()),
        "model_type": type(model.model).__name__,
        "classes": names,
        "source": str(image_path),
        "original_result": str(original_path),
        "input_width": int(image.shape[1]),
        "input_height": int(image.shape[0]),
        "inference_imgsz": args.imgsz,
        "nms_iou": args.iou,
        "thresholds": [],
    }

    for threshold in sorted(set(args.thresholds)):
        results = model.predict(
            source=image,
            conf=threshold,
            iou=args.iou,
            imgsz=args.imgsz,
            device="cpu",
            verbose=False,
        )
        result = results[0]
        detections = serialize_detections(result, names)
        suffix = f"{round(threshold * 100):02d}"
        annotated_path = args.results_dir / f"{stem}-conf-{suffix}.jpg"
        if not cv2.imwrite(str(annotated_path), result.plot()):
            raise RuntimeError(f"Failed to save annotated image: {annotated_path}")

        timing = {key: round(float(value), 3) for key, value in result.speed.items()}
        report["thresholds"].append(
            {
                "confidence_threshold": threshold,
                "detected_count": len(detections),
                "detections": detections,
                "timing_ms": timing,
                "annotated_result": str(annotated_path),
            }
        )

    report_path = args.results_dir / f"{stem}-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Model: {report['model']}")
    print(f"Classes: {names}")
    print(f"Input: {image.shape[1]}x{image.shape[0]} -> inference imgsz={args.imgsz}")
    print(f"NMS IoU: {args.iou}")
    for comparison in report["thresholds"]:
        print(
            f"conf={comparison['confidence_threshold']:.2f}: "
            f"{comparison['detected_count']} detections, "
            f"inference={comparison['timing_ms'].get('inference', 0):.3f} ms"
        )
        for detection in comparison["detections"]:
            print(
                f"  - {detection['class_name']} "
                f"{detection['confidence']:.3f} xyxy={detection['xyxy']}"
            )
    print(f"Report: {report_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FileNotFoundError, RuntimeError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1) from error
