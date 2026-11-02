#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RIBO-TH Autonomous Vessel Vision Server for Arduino UNO Q (ARM64)
- Runs YOLO ONNX models via onnxruntime on Qualcomm QRB2210 (Quad Cortex-A53)
- Real-time Dual-model Ensemble: trash_new.onnx + milk.onnx + oil/best.onnx
- Built-in Autonomous Visual Servoing with direct Arduino Bridge / Serial control
- Hosts real-time MJPEG live camera stream over Wi-Fi
- Serves HTTP REST API for Next.js Web Dashboard over Wi-Fi
"""

import sys
import os
import time
import math
import json
import base64
import argparse
import threading
import glob
import subprocess
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

import numpy as np
try:
    import cv2
except ImportError:
    cv2 = None

try:
    import onnxruntime as ort
except ImportError:
    ort = None

try:
    from arduino.app_utils import Bridge
    HAS_BRIDGE = True
except ImportError:
    HAS_BRIDGE = False

# Class names for primary marine litter model
TRASH_CLASSES = {
    0: "Plastic bag & wrapper",
    1: "Cigarette",
    2: "Bottle",
    3: "Bottle cap",
    4: "Can",
    5: "Other plastic",
    6: "Carton",
    7: "Cup",
    8: "Other",
}

SECONDARY_CLASSES = {
    0: "Plastic bag & wrapper",
    1: "Cigarette",
    2: "Bottle",
    3: "Bottle cap",
    4: "Can",
    5: "Other plastic",
    6: "Carton",
    7: "Cup",
    8: "Other",
}


def nms(boxes, scores, iou_threshold=0.45):
    """Simple Non-Maximum Suppression"""
    if len(boxes) == 0:
        return []
    x1 = boxes[:, 0]
    y1 = boxes[:, 1]
    x2 = boxes[:, 2]
    y2 = boxes[:, 3]
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]
    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        w = np.maximum(0.0, xx2 - xx1)
        h = np.maximum(0.0, yy2 - yy1)
        inter = w * h
        ovr = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)
        inds = np.where(ovr <= iou_threshold)[0]
        order = order[inds + 1]
    return keep


class CameraStreamer:
    """Background camera capture thread for USB UVC webcams (Logitech C270)"""
    def __init__(self):
        self.cap = None
        self.lock = threading.Lock()
        self.frame_ready = threading.Condition(self.lock)
        self.frame_sequence = 0
        self.running = False
        self.current_frame = None
        self.current_jpeg = None
        self.device_index = None
        self.device_name = "Logitech C270"
        self.thread = None
        self.last_frame_time = 0.0
        self.fps = 0.0

    def find_camera(self):
        if cv2 is None:
            return False

        # Gather video device candidates
        devs = sorted(glob.glob("/dev/video*"))
        test_indices = []
        for dev in devs:
            try:
                num = int(dev.replace("/dev/video", ""))
                if num >= 2:
                    test_indices.append(num)
            except ValueError:
                pass
        for dev in devs:
            try:
                num = int(dev.replace("/dev/video", ""))
                if num < 2:
                    test_indices.append(num)
            except ValueError:
                pass
        if not test_indices:
            test_indices = [2, 3, 0, 1]

        for idx in test_indices:
            try:
                backend = cv2.CAP_V4L2 if hasattr(cv2, "CAP_V4L2") else cv2.CAP_ANY
                cap = cv2.VideoCapture(idx, backend)
                if cap.isOpened():
                    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
                    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                    cap.set(cv2.CAP_PROP_FPS, 30)
                    # V4L2 needs a queued buffer while the previous frame is decoded.
                    cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)
                    # Keep auto exposure, but do not let it reduce the frame rate.
                    # v4l2-ctl is present on UNO Q; other installations may omit it.
                    try:
                        subprocess.run(
                            ["v4l2-ctl", "-d", f"/dev/video{idx}",
                             "--set-ctrl=exposure_dynamic_framerate=0"],
                            capture_output=True, timeout=2, check=False,
                        )
                    except (OSError, subprocess.SubprocessError):
                        pass
                    ret, frame = cap.read()
                    if ret and frame is not None and frame.shape[0] > 0:
                        self.cap = cap
                        self.device_index = idx
                        self.device_name = f"Logitech C270 (/dev/video{idx})"
                        print(f"[UnoQ Camera] Successfully connected to video device {idx}")
                        return True
                    cap.release()
            except Exception:
                pass
        return False

    def start(self):
        if self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._capture_loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False
        if self.cap:
            try:
                self.cap.release()
            except Exception:
                pass
            self.cap = None

    def _capture_loop(self):
        frame_count = 0
        last_encoded_at = 0.0
        fps_start = time.time()
        while self.running:
            if self.cap is None or not self.cap.isOpened():
                if not self.find_camera():
                    time.sleep(1.5)
                    continue

            try:
                ret, frame = self.cap.read()
                if not ret or frame is None or frame.shape[0] == 0:
                    print("[UnoQ Camera] Frame read error, re-probing camera...")
                    if self.cap:
                        try:
                            self.cap.release()
                        except Exception:
                            pass
                    self.cap = None
                    time.sleep(1.0)
                    continue

                # Encode only the newest frame, up to 15 FPS, while draining capture.
                if time.monotonic() - last_encoded_at < 0.9 / 15:
                    continue
                last_encoded_at = time.monotonic()
                # Encode frame to JPEG
                ret, jpeg = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
                if ret:
                    with self.frame_ready:
                        self.current_frame = frame
                        self.current_jpeg = jpeg.tobytes()
                        self.last_frame_time = time.time()
                        self.frame_sequence += 1
                        self.frame_ready.notify_all()

                frame_count += 1
                now = time.time()
                if now - fps_start >= 1.0:
                    self.fps = round(frame_count / (now - fps_start), 1)
                    frame_count = 0
                    fps_start = now

                # VideoCapture.read() is paced by the camera.
                # Sleeping here lets old frames accumulate in the driver.
            except Exception as e:
                print(f"[UnoQ Camera] Capture loop exception: {e}")
                time.sleep(0.5)


class UnoQVisionDetector:
    def __init__(
        self,
        trash_model_path: str = "/home/arduino/ribo-ai/models/trash_new_int8.onnx",
        milk_model_path: str = "/home/arduino/ribo-ai/models/milk_int8.onnx",
        oil_model_path: str = "/home/arduino/ribo-ai/models/oil_best_int8.onnx",
        conf_thresh: float = 0.35,
        oil_conf_thresh: float = 0.36,
        hold_timeout: float = 0.80,
    ):
        self.conf_thresh = conf_thresh
        self.oil_conf_thresh = oil_conf_thresh
        self.hold_timeout = hold_timeout
        self.input_size = 640

        opts = ort.SessionOptions() if ort else None
        if opts:
            opts.intra_op_num_threads = 4
            opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        providers = ["CPUExecutionProvider"]
        print(f"[UnoQ Vision] Initializing ONNX models with providers: {providers}")

        self.session_trash = None
        if ort and os.path.exists(trash_model_path):
            self.session_trash = ort.InferenceSession(trash_model_path, opts, providers=providers)
            print(f"[UnoQ Vision] Loaded primary trash model: {trash_model_path}")

        self.session_milk = None
        if ort and os.path.exists(milk_model_path):
            self.session_milk = ort.InferenceSession(milk_model_path, opts, providers=providers)
            print(f"[UnoQ Vision] Loaded milk specialist model: {milk_model_path}")

        self.session_oil = None
        if ort and os.path.exists(oil_model_path):
            self.session_oil = ort.InferenceSession(oil_model_path, opts, providers=providers)
            print(f"[UnoQ Vision] Loaded oil model: {oil_model_path}")

        # Tracking state
        self.last_target = None
        self.last_target_time = 0.0
        self.track_id_counter = 1

    def preprocess(self, img_bgr):
        orig_h, orig_w = img_bgr.shape[:2]
        # Letterbox / resize to 640x640
        scale = min(self.input_size / orig_w, self.input_size / orig_h)
        new_w = int(orig_w * scale)
        new_h = int(orig_h * scale)
        pad_x = (self.input_size - new_w) // 2
        pad_y = (self.input_size - new_h) // 2

        resized = cv2.resize(img_bgr, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
        canvas = np.zeros((self.input_size, self.input_size, 3), dtype=np.uint8)
        canvas[pad_y:pad_y + new_h, pad_x:pad_x + new_w] = resized

        rgb = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)
        tensor = rgb.transpose(2, 0, 1).astype(np.float32) / 255.0
        tensor = np.expand_dims(tensor, axis=0)
        return tensor, scale, pad_x, pad_y, orig_w, orig_h

    def _postprocess_yolo(self, output, scale, pad_x, pad_y, orig_w, orig_h, conf_thresh, class_names):
        preds = output[0].T  # (8400, 4 + num_classes)
        boxes_raw = preds[:, :4]
        scores_raw = preds[:, 4:]

        class_ids = np.argmax(scores_raw, axis=1)
        confidences = np.max(scores_raw, axis=1)

        mask = confidences >= conf_thresh
        if not np.any(mask):
            return []

        boxes_filt = boxes_raw[mask]
        confs_filt = confidences[mask]
        cls_filt = class_ids[mask]

        cx = boxes_filt[:, 0]
        cy = boxes_filt[:, 1]
        w = boxes_filt[:, 2]
        h = boxes_filt[:, 3]

        x1 = cx - w / 2.0
        y1 = cy - h / 2.0
        x2 = cx + w / 2.0
        y2 = cy + h / 2.0

        x1 = (x1 - pad_x) / scale
        y1 = (y1 - pad_y) / scale
        x2 = (x2 - pad_x) / scale
        y2 = (y2 - pad_y) / scale

        x1 = np.clip(x1, 0, orig_w)
        y1 = np.clip(y1, 0, orig_h)
        x2 = np.clip(x2, 0, orig_w)
        y2 = np.clip(y2, 0, orig_h)

        xyxy = np.column_stack([x1, y1, x2, y2])
        keep = nms(xyxy, confs_filt, iou_threshold=0.45)

        results = []
        for idx in keep:
            box = xyxy[idx].tolist()
            bw = box[2] - box[0]
            bh = box[3] - box[1]

            # Reject full-room false positives
            if (bw >= 0.90 * orig_w and bh >= 0.85 * orig_h) or (bw * bh >= 0.70 * orig_w * orig_h):
                continue
            if bw < 12.0 or bh < 12.0:
                continue

            ar = max(bw / max(1.0, bh), bh / max(1.0, bw))
            if ar > 4.5:
                continue

            results.append({
                "class_id": int(cls_filt[idx]),
                "raw_name": class_names.get(int(cls_filt[idx]), "trash"),
                "conf": float(confs_filt[idx]),
                "box": box,
            })
        return results

    def detect(self, img_bgr, enable_trash=True, enable_oil=True):
        now = time.time()
        orig_h, orig_w = img_bgr.shape[:2]
        tensor, scale, pad_x, pad_y, orig_w, orig_h = self.preprocess(img_bgr)

        t_start = time.perf_counter()
        raw_detections = []

        if enable_trash:
            if self.session_trash is not None:
                out = self.session_trash.run(None, {"images": tensor})
                dets = self._postprocess_yolo(out[0], scale, pad_x, pad_y, orig_w, orig_h, self.conf_thresh, TRASH_CLASSES)
                raw_detections.extend(dets)

            if self.session_milk is not None:
                out = self.session_milk.run(None, {"images": tensor})
                dets = self._postprocess_yolo(out[0], scale, pad_x, pad_y, orig_w, orig_h, self.conf_thresh, SECONDARY_CLASSES)
                raw_detections.extend(dets)

        # Intra-frame NMS
        raw_detections.sort(key=lambda d: d["conf"], reverse=True)
        deduped = []
        for det in raw_detections:
            det_box = det["box"]
            overlap = False
            for kept in deduped:
                k_box = kept["box"]
                ix1 = max(det_box[0], k_box[0])
                iy1 = max(det_box[1], k_box[1])
                ix2 = min(det_box[2], k_box[2])
                iy2 = min(det_box[3], k_box[3])
                inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
                if inter > 0:
                    area_a = (det_box[2] - det_box[0]) * (det_box[3] - det_box[1])
                    area_b = (k_box[2] - k_box[0]) * (k_box[3] - k_box[1])
                    iou = inter / (area_a + area_b - inter + 1e-6)
                    if iou > 0.35:
                        overlap = True
                        break
            if not overlap:
                deduped.append(det)

        # Single locked target tracking
        predictions = []
        if deduped:
            best = deduped[0]
            self.last_target = best
            self.last_target_time = now
            l, t, r, b = best["box"]
            cx = (l + r) / 2.0
            cy = (t + b) / 2.0
            predictions.append({
                "track_id": self.track_id_counter,
                "class_id": best["class_id"],
                "class_name": "ขยะ",
                "class_name_en": "Trash",
                "raw_class_name": best["raw_name"],
                "type": "trash",
                "confidence": round(best["conf"], 3),
                "status": "DETECTED",
                "x": cx,
                "y": cy,
                "pixel_x": round(cx),
                "pixel_y": round(cy),
                "width": r - l,
                "height": b - t,
            })
        elif self.last_target and (now - self.last_target_time) <= self.hold_timeout:
            elapsed = now - self.last_target_time
            decay = max(0.20, self.last_target["conf"] * (1.0 - (elapsed / self.hold_timeout) * 0.40))
            l, t, r, b = self.last_target["box"]
            cx = (l + r) / 2.0
            cy = (t + b) / 2.0
            predictions.append({
                "track_id": self.track_id_counter,
                "class_id": self.last_target["class_id"],
                "class_name": "ขยะ",
                "class_name_en": "Trash",
                "raw_class_name": self.last_target["raw_name"],
                "type": "trash",
                "confidence": round(decay, 3),
                "status": "TRACKED",
                "x": cx,
                "y": cy,
                "pixel_x": round(cx),
                "pixel_y": round(cy),
                "width": r - l,
                "height": b - t,
            })
        else:
            self.last_target = None

        latency_ms = round((time.perf_counter() - t_start) * 1000.0, 1)

        # Autonomous Control Trigger via Arduino Bridge
        if HAS_BRIDGE and predictions:
            px = predictions[0]["pixel_x"]
            py = predictions[0]["pixel_y"]
            if py >= 275:
                Bridge.call("vessel_command", "MOVE:FORWARD")
            elif px < 265:
                Bridge.call("vessel_command", "MOVE:LEFT")
            elif px > 375:
                Bridge.call("vessel_command", "MOVE:RIGHT")
            else:
                Bridge.call("vessel_command", "MOVE:FORWARD")

        return {
            "predictions": predictions,
            "trash_predictions": predictions,
            "oil_predictions": [],
            "latency_ms": latency_ms,
            "meta": {
                "source": "arduino_uno_q_onnx",
                "device": "qualcomm_qrb2210_arm64",
                "hold_timeout": self.hold_timeout,
            }
        }


class UnoQVisionHandler(BaseHTTPRequestHandler):
    detector: UnoQVisionDetector = None
    streamer: CameraStreamer = None

    def send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        # Health check
        if self.path in ("/health", "/api/health"):
            cam_active = (
                self.streamer is not None
                and self.streamer.current_jpeg is not None
                and (time.time() - self.streamer.last_frame_time) < 3.0
            )
            self.send_json(200, {
                "status": "ok",
                "platform": "Arduino UNO Q ARM64",
                "models": ["trash_new", "milk", "oil_best"],
                "bridge": "active" if HAS_BRIDGE else "ready",
                "camera": {
                    "active": cam_active,
                    "deviceName": self.streamer.device_name if cam_active else "Logitech C270",
                    "fps": self.streamer.fps if cam_active else 0.0,
                },
                "timestamp": time.time()
            })
            return

        # Camera status
        if self.path in ("/api/camera/status", "/api/camera", "/camera"):
            cam_active = (
                self.streamer is not None
                and self.streamer.current_jpeg is not None
                and (time.time() - self.streamer.last_frame_time) < 3.0
            )
            self.send_json(200, {
                "active": cam_active,
                "deviceName": self.streamer.device_name if cam_active else "Logitech C270",
                "fps": self.streamer.fps if cam_active else 0.0,
                "width": 640,
                "height": 480,
                "streamUrl": "/api/stream",
                "timestamp": time.time()
            })
            return

        # Snapshot single JPEG
        if self.path in ("/api/snapshot", "/snapshot.jpg", "/api/camera/snapshot"):
            frame_bytes = None
            if self.streamer:
                with self.streamer.lock:
                    if self.streamer.current_jpeg and (time.time() - self.streamer.last_frame_time) < 3.0:
                        frame_bytes = self.streamer.current_jpeg
            if frame_bytes:
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Content-Length", str(len(frame_bytes)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                self.end_headers()
                self.wfile.write(frame_bytes)
            else:
                self.send_json(404, {"error": "No camera frame available"})
            return

        # Live MJPEG video stream
        if self.path in ("/api/stream", "/video_feed", "/stream"):
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            last_sequence = 0
            # Drop a stalled client instead of queuing seconds of old video.
            self.connection.settimeout(3.0)
            while True:
                try:
                    frame_bytes = None
                    if self.streamer:
                        with self.streamer.frame_ready:
                            self.streamer.frame_ready.wait_for(
                                lambda: self.streamer.frame_sequence != last_sequence,
                                timeout=1.0,
                            )
                            if self.streamer.frame_sequence == last_sequence:
                                if (time.time() - self.streamer.last_frame_time) >= 3.0:
                                    break
                                continue
                            last_sequence = self.streamer.frame_sequence
                            if self.streamer.current_jpeg and (time.time() - self.streamer.last_frame_time) < 3.0:
                                frame_bytes = self.streamer.current_jpeg
                    if frame_bytes:
                        self.wfile.write(b"--frame\r\n")
                        self.wfile.write(b"Content-Type: image/jpeg\r\n")
                        self.wfile.write(f"Content-Length: {len(frame_bytes)}\r\n\r\n".encode("ascii"))
                        self.wfile.write(frame_bytes)
                        self.wfile.write(b"\r\n")
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    break
                except Exception:
                    break
            return

        if self.path in ("/api/status", "/api/telemetry", "/status"):
            self.send_json(200, {
                "status": "ok",
                "platform": "Arduino UNO Q ARM64",
                "uptime": time.time(),
                "bridge": "active" if HAS_BRIDGE else "ready",
                "last_target": self.detector.last_target if self.detector else None
            })
            return

        self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path in ("/api/command", "/command"):
            content_length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else ""
            action = ""
            try:
                data = json.loads(raw)
                action = data.get("command", "") or data.get("action", "")
            except Exception:
                action = raw.strip()

            if action.startswith("CMD:"):
                action = action[4:]

            print(f"[UnoQ Command] Executing action: {action}")
            bridge_status = "simulated_ok"
            if HAS_BRIDGE:
                try:
                    Bridge.call("vessel_command", action)
                    bridge_status = "sent_to_stm32"
                except Exception as e:
                    bridge_status = f"bridge_error: {e}"

            self.send_json(200, {
                "status": "ok",
                "action": action,
                "bridge": bridge_status,
                "timestamp": time.time()
            })
            return

        if self.path != "/detect":
            self.send_json(404, {"error": "Not found"})
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        img_bgr = None

        if content_length > 0:
            raw_data = self.rfile.read(content_length).decode("ascii")
            if "," in raw_data:
                raw_data = raw_data.split(",", 1)[1]
            try:
                img_bytes = base64.b64decode(raw_data)
                np_arr = np.frombuffer(img_bytes, dtype=np.uint8)
                img_bgr = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            except Exception:
                img_bgr = None

        # Fallback to internal camera frame if payload is empty or not provided
        if img_bgr is None and self.streamer:
            with self.streamer.lock:
                if self.streamer.current_frame is not None:
                    img_bgr = self.streamer.current_frame.copy()

        if img_bgr is None:
            self.send_json(400, {"error": "Failed to decode image or camera unavailable"})
            return

        enable_trash = self.headers.get("X-Enable-Trash", "1") != "0"
        enable_oil = self.headers.get("X-Enable-Oil", "1") != "0"

        res = self.detector.detect(img_bgr, enable_trash=enable_trash, enable_oil=enable_oil)
        self.send_json(200, res)

    def log_message(self, format, *args):
        return


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    detector = UnoQVisionDetector()
    UnoQVisionHandler.detector = detector

    streamer = CameraStreamer()
    streamer.start()
    UnoQVisionHandler.streamer = streamer

    server = ThreadingHTTPServer((args.host, args.port), UnoQVisionHandler)
    print(f"[UnoQ Vision] Multi-threaded server listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[UnoQ Vision] Stopping server.")
        streamer.stop()


if __name__ == "__main__":
    main()
