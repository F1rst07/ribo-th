"""On-board camera and inference service; never actuates from detections.

The MCU bridge is deliberately unavailable until a verified vessel firmware
and its pin mapping are installed. Never report simulated motor success.
"""
import base64
import json
import os
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

os.environ["RIBO_RUNTIME"] = "onnx"
os.environ["RIBO_ORT_THREADS"] = "2"
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")
from server import LocalTrashDetector, MAX_IMAGE_LENGTH
from device_camera import CameraStreamer


class Handler(BaseHTTPRequestHandler):
    detector = None
    streamer = None
    latest = None
    latest_at = 0.0
    latest_ready = threading.Event()
    flags_lock = threading.Lock()
    enable_trash = True
    enable_oil = True

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

    def connect_wifi(self, ssid: str, password: str | None = None):
        ssid = (ssid or "").strip()
        if not ssid:
            return self.json(400, {"success": False, "error": "SSID required"})
        pwd = (password or "").strip()
        attempts = [
            ["nmcli", "device", "wifi", "connect", ssid] + (["password", pwd] if pwd else []),
            ["sudo", "-n", "nmcli", "device", "wifi", "connect", ssid] + (["password", pwd] if pwd else []),
        ]
        last = ""
        for cmd in attempts:
            try:
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30, check=False)
                out = (proc.stdout or proc.stderr or "").strip()
                if proc.returncode == 0:
                    wlan_ip = ""
                    try:
                        ip_proc = subprocess.run(
                            ["bash", "-lc", "ip -4 -o addr show wlan0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1"],
                            capture_output=True,
                            text=True,
                            timeout=5,
                            check=False,
                        )
                        wlan_ip = (ip_proc.stdout or "").strip()
                    except Exception:
                        pass
                    return self.json(200, {
                        "success": True,
                        "message": out or f"Connected to {ssid}",
                        "wlanIp": wlan_ip or None,
                    })
                last = out or f"exit {proc.returncode}"
            except Exception as error:
                last = str(error)
        return self.json(502, {"success": False, "error": last or "Wi-Fi connect failed"})

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/health", "/api/health", "/api/status"):
            payload = {**self.detector.health(), "platform": "Arduino UNO Q ARM64", "runtime": "onnx",
                       "ort_threads": int(os.environ["RIBO_ORT_THREADS"]),
                       "bridge": "unavailable", "control_ready": False,
                       "control_error": "MCU control is not configured or verified",
                       "camera": self.camera_status()}
            if Handler.latest is not None:
                payload["last_detect_age_ms"] = round((time.monotonic() - Handler.latest_at) * 1000, 1)
            return self.json(200, payload)
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
        if path in ("/detect", "/api/detect"):
            return self.serve_latest(wait_s=0.05)
        self.json(404, {"error": "Not found"})

    def do_POST(self):
        path = self.path.split("?")[0]
        if path in ("/api/network/wifi", "/api/wifi/connect"):
            length = int(self.headers.get("Content-Length", "0") or "0")
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            try:
                data = json.loads(raw or "{}")
            except json.JSONDecodeError:
                return self.json(400, {"success": False, "error": "Invalid JSON"})
            return self.connect_wifi(data.get("ssid", ""), data.get("password"))
        if path == "/api/command":
            length = int(self.headers.get("Content-Length", "0") or "0")
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            try:
                data = json.loads(raw or "{}")
            except json.JSONDecodeError:
                data = {}
            command = str(data.get("command", "") or "").strip()
            if command.startswith("WIFI:CONNECT:"):
                ssid = command.split(":", 2)[-1].strip() or str(data.get("ssid", "")).strip()
                return self.connect_wifi(ssid, data.get("password"))
            return self.json(503, {"success": False, "error": "MCU control unavailable; no command was sent"})
        if path != "/detect":
            return self.json(404, {"error": "Not found"})
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length > MAX_IMAGE_LENGTH:
            return self.json(413, {"error": "Invalid image size"})
        remaining = max(0, length)
        while remaining > 0:
            chunk = self.rfile.read(min(65536, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
        with Handler.flags_lock:
            Handler.enable_trash = self.headers.get("X-Enable-Trash", "1") != "0"
            Handler.enable_oil = self.headers.get("X-Enable-Oil", "1") != "0"
        return self.serve_latest(wait_s=0.55)

    def serve_latest(self, wait_s: float = 0.55):
        if Handler.latest is None or (time.monotonic() - Handler.latest_at) > 1.2:
            Handler.latest_ready.clear()
            Handler.latest_ready.wait(timeout=max(0.05, wait_s))
        if Handler.latest is None:
            return self.json(503, {"error": "Vision warming up"})
        return self.json(200, Handler.latest)


def _existing(path: Path) -> Path | None:
    return path if path.is_file() else None


def _infer_loop() -> None:
    import numpy as np

    detector = Handler.detector
    dummy = np.zeros((360, 480, 3), dtype=np.uint8)
    try:
        detector.detect_frame(dummy, enable_trash=True, enable_oil=False)
        print("[device] trash warmup done", flush=True)
    except Exception as error:
        print(f"[device] warmup skipped: {type(error).__name__}", flush=True)
    while True:
        with Handler.streamer.lock:
            frame = None if Handler.streamer.current_frame is None else Handler.streamer.current_frame.copy()
        if frame is None:
            time.sleep(0.03)
            continue
        with Handler.flags_lock:
            enable_trash = Handler.enable_trash
            enable_oil = Handler.enable_oil
        started = time.monotonic()
        try:
            result = detector.detect_frame(frame, enable_trash=enable_trash, enable_oil=enable_oil)
            Handler.latest = result
            Handler.latest_at = time.monotonic()
            Handler.latest_ready.set()
        except Exception as error:
            print(f"[device] infer loop: {type(error).__name__}", flush=True)
        # พักซีพียูระหว่างเฟรม — คงรอบ ~4.5 fps ให้จับปั๊บ/หายปั๊บเหมือนเดิม
        spent = time.monotonic() - started
        time.sleep(max(0.04, 0.22 - spent))


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent / "models"
    Handler.detector = LocalTrashDetector(
        _existing(root / "trash_new.onnx"),
        oil_model_path=_existing(root / "oil_best.onnx"),
        secondary_model_path=None,
        oil_fallback_path=None,
        confidence=0.15,
        oil_confidence=0.42,
        image_size=320,
        hold_timeout=0.32,
        max_targets=1,
        max_oil_targets=5,
        oil_hold_timeout=0.32,
        confirmation_hits=1,
        oil_confirmation_hits=1,
        parallel_inference=False,
    )
    if Handler.detector.oil_model is None:
        print("[device] oil model not loaded — trash-only until a new oil set is installed", flush=True)
    Handler.streamer = CameraStreamer()
    Handler.streamer.start()
    threading.Thread(target=_infer_loop, name="ribo-infer", daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("RIBO_AI_PORT", "8000"))), Handler).serve_forever()
