"""On-board camera and inference service; never actuates from detections.

The MCU bridge is deliberately unavailable until a verified vessel firmware
and its pin mapping are installed. Never report simulated motor success.
"""
import base64
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

os.environ["RIBO_RUNTIME"] = "onnx"
os.environ["RIBO_ORT_THREADS"] = "2"
from server import LocalTrashDetector, MAX_IMAGE_LENGTH
from device_camera import CameraStreamer


class Handler(BaseHTTPRequestHandler):
    detector = None
    streamer = None
    inference_lock = threading.Lock()
    next_available = 0.0

    def json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if status == 429:
            self.send_header("Retry-After", "1")
        self.end_headers()
        self.wfile.write(body)

    def camera_status(self):
        active = self.streamer.current_jpeg is not None and time.time() - self.streamer.last_frame_time < 3
        return {"active": active, "deviceName": self.streamer.device_name, "fps": self.streamer.fps if active else 0,
                "width": 640, "height": 480, "streamUrl": "/camera/stream"}

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/health", "/api/health", "/api/status"):
            return self.json(200, {**self.detector.health(), "platform": "Arduino UNO Q ARM64", "runtime": "onnx",
                                   "ort_threads": int(os.environ["RIBO_ORT_THREADS"]),
                                   "bridge": "unavailable", "control_ready": False,
                                   "control_error": "MCU control is not configured or verified",
                                   "camera": self.camera_status()})
        if path in ("/camera/status", "/api/camera/status"):
            return self.json(200, self.camera_status())
        if path in ("/camera/snapshot", "/api/snapshot"):
            with self.streamer.lock:
                frame = self.streamer.current_jpeg if self.camera_status()["active"] else None
            if not frame:
                return self.json(503, {"error": "No fresh camera frame"})
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(frame)))
            self.end_headers()
            self.wfile.write(frame)
            return
        if path in ("/camera/stream", "/api/stream"):
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.connection.settimeout(3)
            sequence = -1
            try:
                while True:
                    with self.streamer.frame_ready:
                        self.streamer.frame_ready.wait_for(lambda: self.streamer.frame_sequence != sequence, timeout=1)
                        if not self.camera_status()["active"]:
                            break
                        if self.streamer.frame_sequence == sequence:
                            continue
                        sequence = self.streamer.frame_sequence
                        frame = self.streamer.current_jpeg
                    self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(frame)).encode() + b"\r\n\r\n" + frame + b"\r\n")
                    self.wfile.flush()
            except (OSError, TimeoutError):
                pass
            return
        self.json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path == "/api/command":
            return self.json(503, {"success": False, "error": "MCU control unavailable; no command was sent"})
        if self.path != "/detect":
            return self.json(404, {"error": "Not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_IMAGE_LENGTH:
                return self.json(413, {"error": "Invalid image size"})
            encoded = self.rfile.read(length).decode("ascii")
            if not self.inference_lock.acquire(blocking=False):
                return self.json(429, {"error": "Inference busy; submit a fresh frame later"})
            try:
                if time.monotonic() < Handler.next_available:
                    return self.json(429, {"error": "Retry with a fresh frame shortly"})
                result = self.detector.detect(encoded, enable_trash=self.headers.get("X-Enable-Trash", "1") != "0",
                                               enable_oil=self.headers.get("X-Enable-Oil", "1") != "0")
                # Give other clients a chance even if an older dashboard
                # immediately resubmits after every completed request.
                Handler.next_available = time.monotonic() + 0.05
            finally:
                self.inference_lock.release()
            self.json(200, result)
        except (ValueError, UnicodeError):
            self.json(400, {"error": "Invalid image"})
        except Exception as error:
            print(f"[device] Inference failed: {type(error).__name__}", flush=True)
            self.json(500, {"error": "Inference failed"})


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent / "models"
    Handler.detector = LocalTrashDetector(root / "trash_new.onnx", oil_model_path=root / "oil_best.onnx",
                                          secondary_model_path=root / "milk.onnx", oil_fallback_path=root / "oil_fallback.onnx",
                                          oil_confidence=0.36, image_size=448,
                                          hold_timeout=0.35, oil_hold_timeout=0.50,
                                          confirmation_hits=1, oil_confirmation_hits=1,
                                          parallel_inference=True)
    if Handler.detector.secondary_model is None or Handler.detector.oil_model is None or Handler.detector.oil_fallback_model is None:
        raise RuntimeError("All four device models must load before the service becomes ready")
    Handler.streamer = CameraStreamer()
    Handler.streamer.start()
    ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("RIBO_AI_PORT", "8000"))), Handler).serve_forever()
