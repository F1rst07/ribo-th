"""USB capture shared by the standalone UNO Q service."""
import glob
import subprocess
import threading
import time
import cv2

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

                # Drain capture continuously; encode only fresh frames near 15 FPS.
                if time.monotonic() - last_encoded_at < 0.9 / 15:
                    continue
                last_encoded_at = time.monotonic()
                # Encode frame to JPEG (Quality 70, target 15 FPS)
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
