/**
 * Hardware Service for RIBO-TH
 * Manages Wi-Fi REST/HTTP & Web Serial connection to Arduino UNO Q and Camera streaming for Logitech C270
 */

let activeIp = "172.20.10.3";
let isWifiConnected = false;
let wifiPollTimer: ReturnType<typeof setInterval> | null = null;
let activePort: any = null;
let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let keepReading = false;
let activeCameraStream: MediaStream | null = null;

export function getUnoQIp(): string {
  if (typeof window !== "undefined") {
    if (window.location.hostname.endsWith(".local") || /^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^10\./.test(window.location.hostname)) {
      return window.location.hostname;
    }
    return localStorage.getItem("ribo_unoq_ip") || "172.20.10.3";
  }
  return "172.20.10.3";
}

export function setUnoQIp(ip: string): void {
  activeIp = ip.trim();
  if (typeof window !== "undefined") {
    localStorage.setItem("ribo_unoq_ip", activeIp);
  }
}

export function isArduinoConnectedWifi(): boolean {
  return isWifiConnected;
}

/**
 * Connect to Arduino UNO Q via Wi-Fi (Primary mode for autonomous vessel)
 */
export async function connectArduinoUnoQ(
  ipOrBaud?: string | number,
  onDataReceived?: (data: string) => void
): Promise<{ success: boolean; portName?: string; error?: string }> {
  if (typeof window === "undefined") {
    return { success: false, error: "Window is undefined" };
  }

  const targetIp =
    typeof ipOrBaud === "string" && ipOrBaud.trim().length > 0
      ? ipOrBaud.trim()
      : getUnoQIp();
  activeIp = targetIp;

  try {
    // 1. ตรวจสอบสถานะบอร์ดผ่าน Next.js status proxy (รองรับทั้ง Wi-Fi ตรงและ ADB forward)
    const resp = await fetch(
      `/api/arduino/status?ip=${encodeURIComponent(targetIp)}`,
      { cache: "no-store" }
    );
    const data = await resp.json().catch(() => ({}));

    if (data.connected) {
      isWifiConnected = true;
      const portLabel = `Wi-Fi : ${targetIp}`;

      // เริ่มต้นโพลสถานะและตรวจสอบสัญญาณเพื่อแสดงในหน้ากิจกรรม
      if (wifiPollTimer) clearInterval(wifiPollTimer);
      wifiPollTimer = setInterval(async () => {
        if (!isWifiConnected) return;
        try {
          const pollRes = await fetch(
            `/api/arduino/status?ip=${encodeURIComponent(activeIp)}`,
            { cache: "no-store" }
          );
          const pollData = await pollRes.json();
          if (!pollData.connected && isWifiConnected) {
            onDataReceived?.(
              "WARN : สัญญาณ Wi-Fi บอร์ดขาดหาย — กำลังพยายามเชื่อมต่อใหม่..."
            );
          }
        } catch {}
      }, 3500);

      onDataReceived?.(
        `INFO : เชื่อมต่อ Arduino UNO Q ผ่านเครือข่าย Wi-Fi สำเร็จ (${targetIp})`
      );
      return { success: true, portName: portLabel };
    }

    // 2. Direct browser fetch fallback
    try {
      const direct = await fetch(`http://${targetIp}:8000/api/health`, {
        mode: "cors",
        signal: AbortSignal.timeout(1500),
      });
      if (direct.ok) {
        isWifiConnected = true;
        return { success: true, portName: `Wi-Fi : ${targetIp}` };
      }
    } catch {}

    return {
      success: false,
      error: `ไม่สามารถเชื่อมต่อ Arduino UNO Q ที่ IP ${targetIp} (Wi-Fi)`,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "Failed to connect via Wi-Fi",
    };
  }
}

/**
 * Connect to Arduino UNO Q via Web Serial API (USB cable fallback)
 */
export async function connectArduinoUnoQSerial(
  baudRate = 115200,
  onDataReceived?: (data: string) => void
): Promise<{ success: boolean; portName?: string; error?: string }> {
  if (typeof window === "undefined" || !("serial" in navigator)) {
    return {
      success: false,
      error: "This browser does not support Web Serial",
    };
  }

  try {
    const serial = (navigator as any).serial;
    const port = await serial.requestPort();

    if (port.readable || port.writable) {
      try {
        if (!port.readable?.locked && !port.writable?.locked) {
          await port.close();
          await port.open({ baudRate });
        }
      } catch {}
    } else {
      try {
        await port.open({ baudRate });
      } catch (openErr: any) {
        if (!openErr.message?.toLowerCase().includes("already open")) {
          throw openErr;
        }
      }
    }

    keepReading = false;
    if (activeReader) {
      try {
        await activeReader.cancel();
      } catch {}
      try {
        activeReader.releaseLock();
      } catch {}
      activeReader = null;
    }

    activePort = port;
    keepReading = true;

    if (onDataReceived && port.readable && !port.readable.locked) {
      (async () => {
        const textDecoder = new TextDecoder();
        let lineBuffer = "";
        let lastLoggedMsg = "";
        let lastLoggedTime = 0;

        while (keepReading && activePort && activePort.readable) {
          try {
            const currentReader = activePort.readable.getReader();
            activeReader = currentReader;
            while (keepReading) {
              const { value, done } = await currentReader.read();
              if (done) break;
              if (value) {
                const decoded = textDecoder.decode(value);
                lineBuffer += decoded;
                const lines = lineBuffer.split(/[\r\n]+/);
                lineBuffer = lines.pop() || "";

                for (const rawLine of lines) {
                  const line = rawLine.trim();
                  if (!line) continue;

                  const now = Date.now();
                  if (line === lastLoggedMsg && now - lastLoggedTime < 3000) {
                    continue;
                  }
                  lastLoggedMsg = line;
                  lastLoggedTime = now;

                  onDataReceived(line);
                }
              }
            }
          } catch {
            break;
          } finally {
            if (activeReader) {
              try {
                activeReader.releaseLock();
              } catch {}
              activeReader = null;
            }
          }
        }
      })();
    }

    const info = port.getInfo ? port.getInfo() : {};
    const portLabel =
      info.usbVendorId && info.usbProductId
        ? `USB (VID:${info.usbVendorId.toString(16)} PID:${info.usbProductId.toString(16)})`
        : "USB Serial Port (115200)";

    return { success: true, portName: portLabel };
  } catch (err: any) {
    if (
      err.name === "NotFoundError" ||
      err.message?.includes("No port selected") ||
      err.message?.includes("cancelled")
    ) {
      return { success: false, error: "USER_CANCELLED" };
    }
    return {
      success: false,
      error: err.message || "Failed to open serial port",
    };
  }
}

/**
 * Disconnect from Arduino UNO Q (Wi-Fi and Serial)
 */
export async function disconnectArduinoUnoQ(): Promise<void> {
  isWifiConnected = false;
  if (wifiPollTimer) {
    clearInterval(wifiPollTimer);
    wifiPollTimer = null;
  }

  keepReading = false;

  if (activeReader) {
    try {
      await activeReader.cancel();
    } catch {}
    try {
      activeReader.releaseLock();
    } catch {}
    activeReader = null;
  }

  if (activePort) {
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
      if (!activePort.readable?.locked && !activePort.writable?.locked) {
        await activePort.close();
      }
    } catch (err) {
      console.warn("Notice on closing port:", err);
    }
    activePort = null;
  }
}

/**
 * Send command string to Arduino UNO Q over Wi-Fi (Primary) or Serial fallback
 */
export async function sendCommandToArduino(command: string): Promise<boolean> {
  // 1. ส่งผ่าน Wi-Fi API proxy (รองรับคำสั่งเดินเรือ, แขนกล, กลไกน้ำมัน และหยุดฉุกเฉิน)
  try {
    const resp = await fetch("/api/arduino/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, ip: activeIp }),
    });
    if (resp.ok) {
      const data = await resp.json().catch(() => ({}));
      if (data.success) return true;
    }
  } catch (err) {
    console.warn("Wi-Fi API proxy error:", err);
  }

  // 2. ส่งตรงไปยังบอร์ด HTTP REST (Direct Wi-Fi fallback)
  try {
    const directResp = await fetch(`http://${activeIp}:8000/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
      signal: AbortSignal.timeout(1000),
    });
    if (directResp.ok) return true;
  } catch {}

  // 3. ส่งผ่านพอร์ต USB Serial หากเปิดพอร์ตอยู่
  if (activePort && activePort.writable) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(command + "\n");
      const writer = activePort.writable.getWriter();
      await writer.write(data);
      writer.releaseLock();
      return true;
    } catch (err) {
      console.warn("Failed to write to serial:", err);
      return false;
    }
  }

  return false;
}

/**
 * Check if Logitech C270 is connected to Arduino UNO Q and streaming via Wi-Fi
 */
export async function checkUnoQCameraStatus(targetIp?: string): Promise<{
  active: boolean;
  deviceName?: string;
  streamUrl?: string;
  fps?: number;
  error?: string;
}> {
  const ip = targetIp || getUnoQIp();
  try {
    const resp = await fetch(`/api/arduino/camera?ip=${encodeURIComponent(ip)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (resp.ok) {
      const data = await resp.json();
      return {
        active: Boolean(data.active),
        deviceName: data.deviceName || "Logitech C270",
        streamUrl: data.streamUrl || `/api/arduino/stream?ip=${encodeURIComponent(ip)}`,
        fps: data.fps || 0,
        error: data.error,
      };
    }
  } catch {}
  return { active: false, deviceName: "Logitech C270", error: "ติดต่อบริการกล้องบน UNO Q ไม่สำเร็จ — ตรวจสอบ Wi-Fi และโปรแกรมกล้องบนบอร์ด" };
}

/**
 * Connect to Logitech C270 Camera (Dual mode: Wi-Fi stream from Arduino UNO Q or USB local fallback)
 */
export async function connectCameraStream(preferLocalUsb = false): Promise<{
  success: boolean;
  stream: MediaStream | null;
  isWifiStream?: boolean;
  streamUrl?: string;
  deviceName?: string;
  error?: string;
}> {
  if (!preferLocalUsb) {
    // In vessel mode, the camera attached to UNO Q remains the primary source.
    const unoqCam = await checkUnoQCameraStatus(activeIp);
    if (unoqCam.active) {
      return {
        success: true,
        stream: null,
        isWifiStream: true,
        streamUrl: unoqCam.streamUrl || `/api/arduino/stream?ip=${encodeURIComponent(activeIp)}`,
        deviceName: unoqCam.deviceName || "Logitech C270",
      };
    }

    if (isWifiConnected) {
      return {
        success: false,
        stream: null,
        deviceName: "Logitech C270",
        error: unoqCam.error || "UNO Q ยังไม่มีเฟรมภาพจากกล้อง — ต้องตรวจ USB, สิทธิ์อุปกรณ์ และโปรแกรมกล้องบนบอร์ด",
      };
    }
  }

  // 2. หากไม่ได้เชื่อมต่อ Wi-Fi และต้องการทดสอบ Local USB บนคอมพิวเตอร์
  if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return { success: false, stream: null, error: "Media devices not supported" };
  }

  try {
    // สแกนรายชื่ออุปกรณ์โดยตรง (ห้ามเรียก getUserMedia ล่วงหน้าเพื่อป้องกันไฟกล้องหน้า Mac ติด)
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const videoDevices = devices.filter((d) => d.kind === "videoinput");

    // ค้นหาเฉพาะกล้อง Logitech C270 อย่างเจาะจงเท่านั้น (บล็อกกล้อง MacBook Air / FaceTime 100%)
    const targetDevice = videoDevices.find((d) => /logitech|c270/i.test(d.label));

    if (!targetDevice) {
      return {
        success: false,
        stream: null,
        deviceName: "Logitech C270",
        error: "ไม่พบกล้อง Logitech C270 ที่ต่อกับคอมพิวเตอร์",
      };
    }

    // เปิดเฉพาะกล้อง Logitech C270 เท่านั้นตาม deviceId ที่พบ
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: targetDevice.deviceId },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    activeCameraStream = stream;
    const track = stream.getVideoTracks()[0];
    const deviceName = track?.label || targetDevice.label || "Logitech C270 HD Webcam";

    return {
      success: true,
      stream,
      isWifiStream: false,
      deviceName,
    };
  } catch (err: any) {
    return {
      success: false,
      stream: null,
      error: err.message || "Could not access camera",
    };
  }
}

/**
 * Disconnect and stop camera stream
 */
export function disconnectCameraStream(): void {
  if (activeCameraStream) {
    try {
      activeCameraStream.getTracks().forEach((track) => track.stop());
    } catch {}
    activeCameraStream = null;
  }
}

/**
 * Listen to hardware hotplug events (USB Plug in / Pull out)
 */
export function listenToHardwareHotplug(callbacks: {
  onPluggedIn: () => void;
  onUnplugged: () => void;
}): () => void {
  if (typeof window === "undefined" || !("serial" in navigator)) {
    return () => {};
  }

  const serial = (navigator as any).serial;
  const handleConnect = () => {
    if (!isWifiConnected) {
      callbacks.onPluggedIn();
    }
  };

  const handleDisconnect = (event: Event & { port?: unknown }) => {
    if (!isWifiConnected && activePort && (event.port === activePort || event.target === activePort)) {
      callbacks.onUnplugged();
    }
  };

  try {
    serial.addEventListener("connect", handleConnect);
    serial.addEventListener("disconnect", handleDisconnect);
  } catch {}

  return () => {
    try {
      serial.removeEventListener("connect", handleConnect);
      serial.removeEventListener("disconnect", handleDisconnect);
    } catch {}
  };
}
