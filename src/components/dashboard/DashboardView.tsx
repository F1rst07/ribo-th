"use client";

// @refresh reset
// Remount hardware control state after edits, including hook dependency changes.

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Language, strings } from "./translations";
import { Header } from "./Header";
import { ConnectionStatus } from "./ConnectionStatus";
import { CameraMonitor } from "./CameraMonitor";
import { DetectionDetails } from "./DetectionDetails";
import { GpsMap } from "./GpsMap";
import { demoGpsCenter } from "@/lib/gpsTelemetry";
import { ActivityLog, LogEntry, ClearLogOptions } from "./ActivityLog";
import { OperationMode, OperationModeType } from "./OperationMode";
import { OilControl } from "./OilControl";
import { TrashDetection, VisionMeta, VisionStatus } from "./trashVision";
import {
  connectArduinoUnoQ,
  disconnectArduinoUnoQ,
  sendCommandToArduino,
  connectCameraStream,
  checkUnoQCameraStatus,
  disconnectCameraStream,
  listenToHardwareHotplug,
  getUnoQIp,
  setUnoQIp,
  getUnoQWifiSsid,
  setUnoQWifiSsid,
  fetchUnoQBoardWifiStatus,
  setupUnoQBoardWifi,
  discoverUnoQOnLan,
  isDemoBoardHost,
} from "./hardwareService";
import styles from "./dashboard.module.css";
import { AutoTargetGate } from "./autoTargetGate";
import {
  advanceMission,
  advanceOilAlign,
  advanceSearch,
  beginMission,
  beginSearch,
  COLLECT_GONE_MS,
  INTAKE_Y,
  OIL_SPRAY_MS,
  pauseMission,
  type MissionClock,
  type SearchState,
} from "./autoNav";
import {
  BOARD_MDNS_HOST,
  CLOUD_LAUNCHER_URL,
  DEFAULT_BOARD_IP,
  boardDisplayHost,
  getBrowserLanIPv4s,
  isCloudDashboard,
  isIpv4,
  openBoardDashboard,
  resolveBoardIp,
  sameLan,
} from "@/lib/clientBoardApi";

const getFormattedTime = () =>
  new Date().toLocaleTimeString("en-GB", { hour12: false });

const isBoardDashboardHost = (hostname: string) =>
  hostname.endsWith(".local") ||
  /^192\.168\./.test(hostname) ||
  /^10\./.test(hostname) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);

const OIL_MATCH_PX = 180;

function isOilItem(item: TrashDetection) {
  return item.type === "oil" || (typeof item.className === "string" && item.className.includes("น้ำมัน"));
}

function oilDistance2(mark: { x: number; y: number }, item: TrashDetection) {
  const dx = item.pixelX - mark.x;
  const dy = item.pixelY - mark.y;
  return dx * dx + dy * dy;
}

function coversSprayedOil(mark: { x: number; y: number }, item: TrashDetection) {
  if (oilDistance2(mark, item) <= OIL_MATCH_PX * OIL_MATCH_PX) return true;
  const halfW = (item.width / 100) * 320 + 40;
  const halfH = (item.height / 100) * 240 + 40;
  return Math.abs(item.pixelX - mark.x) <= halfW && Math.abs(item.pixelY - mark.y) <= halfH;
}

export const DashboardView: React.FC<{
  controlAvailable?: boolean;
  macAiMode?: boolean;
  simulatedGps?: boolean;
}> = ({
  controlAvailable = true,
  macAiMode = false,
  simulatedGps = false,
}) => {
  const [lang, setLang] = useState<Language>("th");
  const [mode, setMode] = useState<OperationModeType>("manual");
  const [isLocked, setIsLocked] = useState(false);
  const [isOilRunning, setIsOilRunning] = useState(false);
  const [armPosition, setArmPosition] = useState<"up" | "down" | "idle">("idle");
  const [isMounted, setIsMounted] = useState(false);
  const t = strings[isMounted ? lang : "th"];

  // สถานะการเชื่อมต่อฮาร์ดแวร์จริง (Arduino UNO Q & กล้อง Logitech C270)
  const [boardIp, setBoardIp] = useState<string>(DEFAULT_BOARD_IP);
  const [wifiSsid, setWifiSsid] = useState<string>("");
  const [wifiPassword, setWifiPassword] = useState<string>("");
  const [adbUsbReady, setAdbUsbReady] = useState(false);
  const [isWifiSettingUp, setIsWifiSettingUp] = useState(false);
  const [connectionBanner, setConnectionBanner] = useState<string>("");
  const [connectionBannerTone, setConnectionBannerTone] = useState<
    "error" | "info"
  >("info");
  const [isConnected, setIsConnected] = useState(false);
  const isConnectedRef = useRef(false);
  isConnectedRef.current = isConnected;
  const [isConnecting, setIsConnecting] = useState(false);
  const [deviceLanIp, setDeviceLanIp] = useState("");
  const isDemoMode = isDemoBoardHost(boardIp);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hostname = window.location.hostname;
    if (isBoardDashboardHost(hostname)) {
      setBoardIp(BOARD_MDNS_HOST);
      setUnoQIp(BOARD_MDNS_HOST);
      setIsConnected(true);
      return;
    }
    const saved = getUnoQIp() || DEFAULT_BOARD_IP;
    const ssid = getUnoQWifiSsid();
    setBoardIp(saved);
    setUnoQIp(saved);
    setWifiSsid(ssid);
    void getBrowserLanIPv4s().then((ips) => {
      setDeviceLanIp(ips[0] || "");
    });
  }, []);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      (isCloudDashboard() || isBoardDashboardHost(window.location.hostname))
    ) {
      return;
    }
    let cancelled = false;
    let inflight = false;
    const pollBoard = async () => {
      if (inflight || isConnectedRef.current) return;
      inflight = true;
      try {
        const found = await discoverUnoQOnLan();
        if (cancelled) return;

        if (!found.found || !found.ip) {
          setAdbUsbReady(false);
          return;
        }

        const status = await fetchUnoQBoardWifiStatus(found.ip);
        if (cancelled) return;
        setAdbUsbReady(status.ready);
        const detectedIp = status.wlanIp || found.ip;
        const detectedSsid = status.wifiSsid || getUnoQWifiSsid();
        setBoardIp(boardDisplayHost(detectedIp));
        setUnoQIp(boardDisplayHost(detectedIp));
        setWifiSsid(detectedSsid);
        if (detectedSsid) setUnoQWifiSsid(detectedSsid);
      } finally {
        inflight = false;
      }
    };
    void pollBoard();
    const timer = setInterval(pollBoard, 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const handleIpChange = (newIp: string) => {
    const host = boardDisplayHost(newIp);
    setBoardIp(host);
    setUnoQIp(host);
  };

  const handleWifiSsidChange = (ssid: string) => {
    setWifiSsid(ssid);
    setUnoQWifiSsid(ssid);
  };

  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isWifiStream, setIsWifiStream] = useState<boolean>(false);
  const [wifiStreamUrl, setWifiStreamUrl] = useState<string>("/api/arduino/stream");
  const [trashDetections, setTrashDetections] = useState<TrashDetection[]>([]);
  const [visionStatus, setVisionStatus] = useState<VisionStatus>("idle");
  const [visionError, setVisionError] = useState("");
  const [visionMeta, setVisionMeta] = useState<VisionMeta | null>(null);
  const autoConnectHandledRef = useRef(false);
  const autoTargetGate = useRef(new AutoTargetGate());
  const visionInput = useRef({ items: [] as TrashDetection[], status: "idle" as VisionStatus, receivedAt: 0, frame: 0 });
  const handleVisionResult = useCallback((detections: TrashDetection[], status: VisionStatus, error = "", meta?: VisionMeta) => {
    visionInput.current = { items: detections, status, receivedAt: Date.now(), frame: visionInput.current.frame + 1 };
    setTrashDetections(detections);
    setVisionStatus(status);
    setVisionError(error);
    if (meta) setVisionMeta(meta);
    if (status === "idle") setVisionMeta(null);
  }, []);

  // สวิตช์เปิด/ปิดการทำงานของแต่ละโมเดล AI (Trash AI & Oil AI)
  // The server and initial client render must agree; restore preferences on mount.
  const [enableTrashModel, setEnableTrashModel] = useState<boolean>(true);
  const [enableOilModel, setEnableOilModel] = useState<boolean>(true);

  // บันทึกกิจกรรมแบบไดนามิก (Dynamic Activity Log)
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logIdCounter = useRef(1);
  const lastMoveDir = useRef<string | null>(null);

  // ระบบนำทางอัตโนมัติตามพิกัดเป้าหมาย (Autonomous Visual Servoing Navigation)
  const [collectedCount, setCollectedCount] = useState<number>(0);
  const [autoDirection, setAutoDirection] = useState<string | null>(null);
  const [autoStatusText, setAutoStatusText] = useState<string>("");

  const navStateRef = useRef<
    "IDLE" | "SEARCHING" | "SPIN_SEARCH" | "ALIGNING" | "APPROACHING" | "COLLECTING" | "SPRAYING" | "RESTING" | "REVERSING" | "STABILIZING"
  >("IDLE");
  const searchRef = useRef<SearchState | null>(null);
  const missionRef = useRef<MissionClock | null>(null);
  const missionPhaseRef = useRef<string>("");
  const stateStartTimeRef = useRef<number>(0);
  const lastSentCommandRef = useRef<string | null>(null);
  const lastSentTimeRef = useRef<number>(0);
  const lastLoggedAutoDirRef = useRef<string | null>(null);
  const lastTargetPosRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastTargetTrackIdRef = useRef<number | null>(null);
  const collectTrackRef = useRef<string | null>(null);
  const collectGoneAtRef = useRef<number | null>(null);
  const oilPumpOnRef = useRef(false);
  const sprayedOilRef = useRef<{ key: string; x: number; y: number; missingSince: number | null }[]>([]);
  const oilSprayTargetRef = useRef<{ key: string; x: number; y: number } | null>(null);
  const restKindRef = useRef<"trash" | "oil">("trash");

  const appendLog = useCallback(
    (type: LogEntry["type"], message: string) => {
      const now = Date.now();
      setLogs((prev) => [
        ...prev,
        {
          id: `log-${now}-${logIdCounter.current++}`,
          time: getFormattedTime(),
          timestamp: now,
          type,
          message,
        },
      ]);
    },
    []
  );

  const handleSetupWifi = useCallback(async () => {
    if (isWifiSettingUp) return;
    setIsWifiSettingUp(true);
    appendLog(
      "INFO",
      lang === "th"
        ? `กำลังตั้ง Wi-Fi บนบอร์ด : ${wifiSsid.trim()}...`
        : `Configuring board Wi-Fi: ${wifiSsid.trim()}...`
    );
    try {
      const result = await setupUnoQBoardWifi(
        wifiSsid,
        wifiPassword,
        boardIp.trim() || undefined
      );
      if (result.success) {
        appendLog("SUCCESS", result.message);
        setConnectionBanner(t.wifiSetupOk);
        setConnectionBannerTone("info");
        if (result.wlanIp) {
          setBoardIp(boardDisplayHost(result.wlanIp));
          setUnoQIp(boardDisplayHost(result.wlanIp));
        }
        const refreshed = await fetchUnoQBoardWifiStatus(
          result.wlanIp || boardIp.trim()
        );
        setAdbUsbReady(refreshed.ready);
        if (refreshed.wlanIp) {
          setBoardIp(boardDisplayHost(refreshed.wlanIp));
          setUnoQIp(boardDisplayHost(refreshed.wlanIp));
        }
        if (refreshed.wifiSsid) {
          setWifiSsid(refreshed.wifiSsid);
          setUnoQWifiSsid(refreshed.wifiSsid);
        }
      } else {
        appendLog("WARN", result.message);
        setConnectionBanner(result.message);
        setConnectionBannerTone("error");
      }
    } finally {
      setIsWifiSettingUp(false);
    }
  }, [appendLog, boardIp, isWifiSettingUp, t.wifiSetupOk, wifiPassword, wifiSsid]);

  // Camera can appear after the board connection (USB hotplug or service startup).
  useEffect(() => {
    if (macAiMode || isDemoMode || !isConnected || cameraStream) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let missedCameraPolls = 0;
    const pollCamera = async () => {
      const status = await checkUnoQCameraStatus(boardIp);
      if (stopped) return;
      if (status.active) {
        missedCameraPolls = 0;
        setIsWifiStream(true);
        if (status.streamUrl) setWifiStreamUrl(status.streamUrl);
      } else {
        missedCameraPolls += 1;
        if (missedCameraPolls >= 3) {
          setIsWifiStream(false);
        }
      }
      timer = setTimeout(() => void pollCamera(), 8000);
    };
    void pollCamera();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [macAiMode, isDemoMode, isConnected, cameraStream, boardIp]);

  // Hot reload or a late USB connection can leave the board connected while
  // the local C270 has not been opened yet. Retry it in Mac AI mode.
  useEffect(() => {
    if (!macAiMode || !isConnected || cameraStream || isWifiStream) return;
    let stopped = false;
    void connectCameraStream(true).then((result) => {
      if (stopped) {
        result.stream?.getTracks().forEach((track) => track.stop());
        return;
      }
      if (!result.success || !result.stream) return;
      setCameraStream(result.stream);
      setIsWifiStream(false);
      appendLog(
        "SUCCESS",
        lang === "th"
          ? `เชื่อมต่อกล้อง Logitech C270 บน Mac สำเร็จ (${result.deviceName || "720p 30fps"})`
          : `Logitech C270 connected on Mac (${result.deviceName || "720p 30fps"})`
      );
    });
    return () => {
      stopped = true;
    };
  }, [macAiMode, isConnected, cameraStream, isWifiStream, lang, appendLog]);

  const handleToggleTrashModel = useCallback((enabled: boolean) => {
    setEnableTrashModel(enabled);
    if (typeof window !== "undefined") {
      localStorage.setItem("ribo_trash_model_enabled", String(enabled));
    }
    appendLog(
      "INFO",
      lang === "th"
        ? enabled ? "เปิดใช้งานโมเดลตรวจจับขยะ (Trash AI)" : "ปิดการใช้งานโมเดลตรวจจับขยะ (Trash AI)"
        : enabled ? "Trash detection model enabled" : "Trash detection model disabled"
    );
  }, [lang, appendLog]);

  const handleToggleOilModel = useCallback((enabled: boolean) => {
    setEnableOilModel(enabled);
    if (typeof window !== "undefined") {
      localStorage.setItem("ribo_oil_model_enabled", String(enabled));
    }
    appendLog(
      "INFO",
      lang === "th"
        ? enabled ? "เปิดใช้งานโมเดลตรวจจับคราบน้ำมัน (Oil AI : YOLO-seg 5 เป้า)" : "ปิดการใช้งานโมเดลตรวจจับคราบน้ำมัน (Oil AI)"
        : enabled ? "Oil detection model enabled (Oil AI : YOLO11n-seg)" : "Oil detection model disabled"
    );
  }, [lang, appendLog]);

  // กรองผลตรวจจับเฉพาะโมเดลที่ผู้ใช้เปิดใช้งาน (Active Detections)
  const activeDetections = trashDetections.filter((item) => {
    const isOil = item.type === "oil" || (typeof item.className === "string" && item.className.includes("น้ำมัน"));
    if (isOil && !enableOilModel) return false;
    if (!isOil && !enableTrashModel) return false;
    return true;
  });
  useEffect(() => {
    visionInput.current.items = activeDetections;
  }, [trashDetections, enableTrashModel, enableOilModel]);

  const handleClearLogs = useCallback(
    (options: ClearLogOptions) => {
      if (
        options.mode === "range" &&
        options.startTimestamp !== undefined &&
        options.endTimestamp !== undefined
      ) {
        setLogs((prev) => {
          const start = options.startTimestamp!;
          const end = options.endTimestamp!;
          // ลบเฉพาะรายการที่อยู่ในช่วงเวลา [start, end]
          return prev.filter((item) => {
            const t = item.timestamp || 0;
            return t < start || t > end;
          });
        });
      } else if (
        options.mode === "before" &&
        options.cutoffTimestamp !== undefined
      ) {
        setLogs((prev) => {
          const cutoff = options.cutoffTimestamp!;
          // ลบรายการที่ <= cutoff
          return prev.filter((item) => {
            const t = item.timestamp || 0;
            return t > cutoff;
          });
        });
      } else {
        // ล้างทั้งหมด
        setLogs([]);
      }
    },
    []
  );

  // โหลดภาษาที่เคยเลือกไว้จาก localStorage เมื่อ Component ทำงานบนเบราว์เซอร์
  useEffect(() => {
    setIsMounted(true);
    const savedTrash = localStorage.getItem("ribo_trash_model_enabled");
    const savedOil = localStorage.getItem("ribo_oil_model_enabled");
    if (savedTrash !== null) setEnableTrashModel(savedTrash === "true");
    if (savedOil !== null) setEnableOilModel(savedOil === "true");
    const savedLang = localStorage.getItem("ribo_dashboard_lang") as Language | null;
    const currentLang: Language = savedLang === "th" || savedLang === "en" ? savedLang : "th";
    if (savedLang) {
      setLang(savedLang);
    }

    const wifiResult = new URLSearchParams(window.location.search).get("wifi");
    if (wifiResult === "ok") {
      setConnectionBanner(
        strings[currentLang].wifiSetupOk
      );
      setConnectionBannerTone("info");
      const cleaned = new URL(window.location.href);
      cleaned.searchParams.delete("wifi");
      window.history.replaceState({}, "", cleaned.toString());
    } else if (wifiResult === "err") {
      setConnectionBanner(
        currentLang === "th"
          ? "บันทึก Wi-Fi บนบอร์ดไม่สำเร็จ — ตรวจชื่อและรหัสแล้วลองใหม่"
          : "Could not save Wi-Fi on the board — check the name and password"
      );
      setConnectionBannerTone("error");
      const cleaned = new URL(window.location.href);
      cleaned.searchParams.delete("wifi");
      window.history.replaceState({}, "", cleaned.toString());
    }

    const now = Date.now();
    // เริ่มต้นระบบบันทึก Log ของจริง (ล้างค่า Mock ทั้งหมด)
    setLogs([
      {
        id: "init-1",
        time: getFormattedTime(),
        timestamp: now - 3000,
        type: "SYSTEM",
        message:
          currentLang === "th"
            ? "เริ่มต้นระบบ Dashboard RIBO-TH พร้อมทำงาน"
            : "RIBO-TH Dashboard initialized for production control",
      },
      {
        id: "init-2",
        time: getFormattedTime(),
        timestamp: now - 2000,
        type: "INFO",
        message:
          currentLang === "th"
            ? "รอการเชื่อมต่อ Arduino UNO Q ผ่านเครือข่าย Wi-Fi"
            : "Awaiting Arduino UNO Q Wi-Fi connection",
      },
      {
        id: "init-3",
        time: getFormattedTime(),
        timestamp: now - 1000,
        type: "WARN",
        message:
          currentLang === "th"
            ? "กล้อง Logitech C270 ยังไม่ได้เปิดในเบราว์เซอร์"
            : "Logitech C270 camera is not open in this browser",
      },
      {
        id: "init-4",
        time: getFormattedTime(),
        timestamp: now,
        type: "INFO",
        message:
          currentLang === "th"
            ? "ระบบบังคับเรือและกลไกอยู่ในโหมดพร้อมรับคำสั่ง"
            : "Vessel navigation and mechanisms ready for commands",
      },
    ]);
  }, []);

  // ตรวจจับการเสียบสาย USB และการถอดสาย USB จากอุปกรณ์จริง (Hotplug Detection)
  useEffect(() => {
    const unbindHotplug = listenToHardwareHotplug({
      onPluggedIn: () => {
        appendLog(
          "SUCCESS",
          lang === "th"
            ? "ตรวจพบการเสียบสาย USB Arduino UNO Q — พร้อมกดเชื่อมต่อ"
            : "Arduino UNO Q USB cable plugged in — Ready to connect"
        );
      },
      onUnplugged: async () => {
        appendLog(
          "WARN",
          lang === "th"
            ? "ตรวจพบการถอดสาย USB Arduino UNO Q — ระบบตัดการเชื่อมต่ออัตโนมัติ"
            : "Arduino UNO Q USB cable unplugged — Automatically disconnected"
        );
        await disconnectArduinoUnoQ();
        disconnectCameraStream();
        setCameraStream(null);
        setIsWifiStream(false);
        setIsConnected(false);
        setIsOilRunning(false);
        setArmPosition("idle");
      },
    });

    return () => {
      unbindHotplug();
    };
  }, [lang, appendLog]);

  // Cleanup ฮาร์ดแวร์และกล้องเมื่อออกจากหน้า Dashboard
  useEffect(() => {
    return () => {
      disconnectCameraStream();
      disconnectArduinoUnoQ();
    };
  }, []);

  // ระบบนำทางอัตโนมัติตามพิกัดภาพ (Autonomous Visual Servoing Navigation Loop)
  useEffect(() => {
    const stopOilPump = () => {
      if (!oilPumpOnRef.current) return;
      oilPumpOnRef.current = false;
      setIsOilRunning(false);
      if (isConnected) {
        sendCommandToArduino("CMD:OIL:STOP");
        appendLog("CMD", lang === "th" ? "[AUTO] ปิดพ่นน้ำมัน" : "[AUTO] Stop oil spray");
      }
    };

    // หากไม่อยู่ในโหมดอัตโนมัติ หรือยังไม่ได้เชื่อมต่อ หรือติดสถานะ E-STOP ให้หยุดการนำทางทันที
    if (mode !== "auto" || !isConnected || isLocked || !controlAvailable) {
      stopOilPump();
      autoTargetGate.current.reset();
      searchRef.current = null;
      missionRef.current = null;
      missionPhaseRef.current = "";
      collectTrackRef.current = null;
      collectGoneAtRef.current = null;
      oilSprayTargetRef.current = null;
      if (navStateRef.current !== "IDLE") {
        navStateRef.current = "IDLE";
        setAutoDirection(null);
        setAutoStatusText("");
        lastLoggedAutoDirRef.current = null;
        if (isConnected && !isLocked && lastSentCommandRef.current !== "CMD:MOVE:STOP") {
          sendCommandToArduino("CMD:MOVE:STOP");
          lastSentCommandRef.current = "CMD:MOVE:STOP";
        }
      }
      return;
    }

    // เริ่มต้นระบบนำทางอัตโนมัติ
    if (navStateRef.current === "IDLE") {
      navStateRef.current = "SEARCHING";
      stateStartTimeRef.current = Date.now();
      setAutoStatusText(t.autoNavSearching);
      appendLog(
        "INFO",
        lang === "th"
          ? "[AUTO] ระบบนำทางอัตโนมัติ : กำลังสแกนหาขยะในระยะกล้อง"
          : "[AUTO] Autonomous navigation : Scanning for trash targets"
      );
    }

    const intervalId = setInterval(() => {
      const now = Date.now();

      // ฟังก์ชันส่งคำสั่งการเคลื่อนที่เข้า Arduino พร้อมป้องกันคำสั่งล้น Serial
      const sendAutoMove = (dir: string | null, cmd: string, dirLabel: string) => {
        setAutoDirection(dir);
        const shouldSend =
          lastSentCommandRef.current !== cmd ||
          now - lastSentTimeRef.current >= 450;

        if (shouldSend) {
          lastSentCommandRef.current = cmd;
          lastSentTimeRef.current = now;
          sendCommandToArduino(cmd);
        }

        const logKey = dirLabel || dir || "";
        if (logKey !== lastLoggedAutoDirRef.current) {
          lastLoggedAutoDirRef.current = logKey;
          if (dirLabel) {
            appendLog(
              "CMD",
              lang === "th"
                ? `[AUTO] สั่งการเคลื่อนที่ : ${dirLabel}`
                : `[AUTO] Command Move : ${cmd === "CMD:MOVE:STOP" ? dirLabel : cmd.replace("CMD:MOVE:", "")}`
            );
          }
        }
      };
      const startOilPump = () => {
        if (oilPumpOnRef.current) return;
        oilPumpOnRef.current = true;
        setIsOilRunning(true);
        sendCommandToArduino("CMD:OIL:START");
        appendLog("CMD", lang === "th" ? "[AUTO] เปิดพ่นน้ำมัน" : "[AUTO] Start oil spray");
        lastLoggedAutoDirRef.current = lang === "th" ? "เปิดพ่นน้ำมัน" : "Start oil spray";
      };
      const stopOilPumpNow = () => {
        if (!oilPumpOnRef.current) return;
        oilPumpOnRef.current = false;
        setIsOilRunning(false);
        sendCommandToArduino("CMD:OIL:STOP");
        appendLog("CMD", lang === "th" ? "[AUTO] ปิดพ่นน้ำมัน" : "[AUTO] Stop oil spray");
        lastLoggedAutoDirRef.current = lang === "th" ? "ปิดพ่นน้ำมัน" : "Stop oil spray";
      };

      const vision = visionInput.current;
      const frameReady = vision.status === "ready" && now - vision.receivedAt <= 1500;
      if (frameReady) {
        const oils = vision.items.filter((item) =>
          isOilItem(item) &&
          enableOilModel &&
          (item.status === "DETECTED" || item.status === "TRACKED"));
        const nextMarks: { key: string; x: number; y: number; missingSince: number | null }[] = [];
        const used = new Set<number>();
        for (const mark of sprayedOilRef.current) {
          let bestIndex = -1;
          let bestDist = Number.POSITIVE_INFINITY;
          oils.forEach((oil, index) => {
            if (used.has(index) || !coversSprayedOil(mark, oil)) return;
            const dist = oilDistance2(mark, oil);
            if (dist < bestDist) {
              bestDist = dist;
              bestIndex = index;
            }
          });
          if (bestIndex >= 0) {
            used.add(bestIndex);
            const oil = oils[bestIndex];
            nextMarks.push({ key: `oil:${oil.trackId}`, x: oil.pixelX, y: oil.pixelY, missingSince: null });
          } else if (mark.missingSince === null) {
            nextMarks.push({ ...mark, missingSince: now });
          } else if (now - mark.missingSince < 500) {
            nextMarks.push(mark);
          }
        }
        sprayedOilRef.current = nextMarks;
      }

      if (navStateRef.current === "RESTING") {
        const elapsed = now - stateStartTimeRef.current;
        if (elapsed < 3000) {
          sendAutoMove(null, "CMD:MOVE:STOP", lang === "th" ? "พักอยู่" : "Resting");
          setAutoStatusText(restKindRef.current === "oil"
            ? (lang === "th" ? "พักหลังพ่นน้ำมัน : รีเลย์ดับ 3 วินาที" : "Rest after spraying : relays off for 3 seconds")
            : (lang === "th" ? "พักหลังเก็บ 1 ชิ้น : รีเลย์ดับ 3 วินาที" : "Rest after one piece : relays off for 3 seconds"));
          return;
        }
        navStateRef.current = "SPIN_SEARCH";
        searchRef.current = beginSearch(now);
        appendLog(
          "INFO",
          lang === "th"
            ? "[AUTO] พักครบแล้ว : เริ่มหมุนขวาหาขยะ"
            : "[AUTO] Rest complete : start spinning right to search"
        );
        sendAutoMove("right", "CMD:MOVE:RIGHT", "หมุนขวาหาขยะ");
        setAutoStatusText(lang === "th" ? "หมุนขวาหาขยะ" : "Spin right to search");
        return;
      }

      if (navStateRef.current === "SPRAYING") {
        const trashVisible = frameReady && enableTrashModel && vision.items.some((item) =>
          !isOilItem(item) && (item.status === "DETECTED" || item.status === "TRACKED"));
        if (trashVisible) {
          stopOilPumpNow();
          oilSprayTargetRef.current = null;
          navStateRef.current = "SEARCHING";
          missionRef.current = null;
          missionPhaseRef.current = "";
          return;
        }
        if (now - stateStartTimeRef.current < OIL_SPRAY_MS) {
          sendAutoMove(null, "CMD:MOVE:STOP", "");
          setAutoStatusText(lang === "th" ? "เปิดพ่นน้ำมัน" : "Spraying oil");
          return;
        }
        stopOilPumpNow();
        if (oilSprayTargetRef.current) {
          sprayedOilRef.current = [
            ...sprayedOilRef.current,
            { ...oilSprayTargetRef.current, missingSince: null },
          ];
          oilSprayTargetRef.current = null;
        }
        restKindRef.current = "oil";
        navStateRef.current = "RESTING";
        stateStartTimeRef.current = now;
        autoTargetGate.current.reset();
        missionRef.current = null;
        missionPhaseRef.current = "";
        searchRef.current = null;
        sendAutoMove(null, "CMD:MOVE:STOP", lang === "th" ? "พักอยู่" : "Resting");
        setAutoStatusText(lang === "th" ? "พักหลังพ่นน้ำมัน : รีเลย์ดับ 3 วินาที" : "Rest after spraying : relays off for 3 seconds");
        return;
      }

      if (navStateRef.current === "COLLECTING") {
        if (!frameReady) {
          collectGoneAtRef.current = null;
          sendAutoMove("forward", "CMD:MOVE:FORWARD", "เดินหน้าให้ขยะเข้าช่องเก็บ");
          setAutoStatusText(lang === "th" ? "กวาดขยะ : รอภาพจากกล้อง" : "Sweeping : waiting for a camera frame");
          return;
        }
        const seen = vision.items.filter((item) =>
          !isOilItem(item) &&
          enableTrashModel &&
          (item.status === "DETECTED" || item.status === "TRACKED"));
        const itemKey = (item: TrashDetection) => `${item.type || "trash"}:${item.trackId}`;
        const same = seen.find((item) => itemKey(item) === collectTrackRef.current) ?? null;
        const visible = same ?? seen.reduce<TrashDetection | null>((best, item) => {
          if (!best || item.pixelY > best.pixelY) return item;
          return best;
        }, null);
        if (visible) {
          const cameBack = collectGoneAtRef.current !== null;
          collectGoneAtRef.current = null;
          collectTrackRef.current = itemKey(visible);
          if (visible.pixelY >= INTAKE_Y) {
            sendAutoMove("forward", "CMD:MOVE:FORWARD", "เดินหน้าให้ขยะเข้าช่องเก็บ");
            setAutoStatusText(lang === "th" ? "กวาดขยะ : รอให้ลอดใต้กล้อง" : "Sweeping : waiting for the trash to pass under the camera");
            return;
          }
          if (cameBack) {
            appendLog(
              "INFO",
              lang === "th"
                ? "[AUTO] ขยะกลับมา : ยังไม่นับ ไปจับต่อ"
                : "[AUTO] Trash returned : not counted, continue chasing"
            );
          }
          navStateRef.current = "SEARCHING";
          collectTrackRef.current = null;
          missionRef.current = {
            phase: "approach",
            trackKey: itemKey(visible),
            seenMs: 0,
            lastTick: now,
            heldCommand: null,
            heldDirection: null,
            heldSince: now,
          };
          missionPhaseRef.current = "approach";
        } else {
          if (collectGoneAtRef.current === null) {
            collectGoneAtRef.current = now;
            appendLog(
              "INFO",
              lang === "th"
                ? "[AUTO] ขยะลอดใต้กล้อง : รอหายครบ 1.5 วินาที"
                : "[AUTO] Trash passed under the camera : wait 1.5 seconds"
            );
          }
          if (now - collectGoneAtRef.current >= COLLECT_GONE_MS) {
            setCollectedCount((prev) => prev + 1);
            appendLog(
              "SUCCESS",
              lang === "th"
                ? "[AUTO] เก็บได้ 1 ชิ้น : พัก 3 วินาทีก่อนไปจับขยะ"
                : "[AUTO] One piece collected : rest 3 seconds before the next target"
            );
            navStateRef.current = "RESTING";
            restKindRef.current = "trash";
            stateStartTimeRef.current = now;
            collectTrackRef.current = null;
            collectGoneAtRef.current = null;
            autoTargetGate.current.reset();
            missionRef.current = null;
            missionPhaseRef.current = "";
            searchRef.current = null;
            lastLoggedAutoDirRef.current = null;
            sendAutoMove(null, "CMD:MOVE:STOP", lang === "th" ? "พักอยู่" : "Resting");
            setAutoStatusText(lang === "th" ? "พักหลังเก็บ 1 ชิ้น : รีเลย์ดับ 3 วินาที" : "Rest after one piece : relays off for 3 seconds");
            return;
          }
          sendAutoMove("forward", "CMD:MOVE:FORWARD", "เดินหน้าให้ขยะเข้าช่องเก็บ");
          setAutoStatusText(lang === "th" ? "ขยะลอดใต้กล้อง : รอหายครบ 1.5 วินาที" : "Trash under the camera : wait 1.5 seconds");
          return;
        }
      }
      if (vision.status !== "ready" || now - vision.receivedAt > 1500) {
        if (missionRef.current) {
          missionRef.current = pauseMission(missionRef.current, now);
        }
        sendAutoMove(null, "CMD:MOVE:STOP", "รอผลภาพใหม่");
        if (navStateRef.current !== "REVERSING") {
          navStateRef.current = "SEARCHING";
        }
        setAutoStatusText(t.autoNavSearching);
        return;
      }

      // 1. สถานะ REVERSING (ถอยหลังเมื่อเก็บขยะเสร็จแล้ว เพื่อถอยออกมาตั้งศูนย์ล็อกขยะชิ้นใหม่ตามคลิปอ้างอิง)
      if (navStateRef.current === "REVERSING") {
        const elapsed = now - stateStartTimeRef.current;
        if (elapsed < 1400) {
          sendAutoMove("backward", "CMD:MOVE:BACK", "ถอยหลัง");
          setAutoStatusText(t.autoNavReversing);
          return;
        } else {
          sendAutoMove(null, "CMD:MOVE:STOP", "");
          navStateRef.current = "SEARCHING";
          lastTargetPosRef.current = null;
          lastTargetTrackIdRef.current = null;
          autoTargetGate.current.reset();
          missionRef.current = null;
          missionPhaseRef.current = "";
          searchRef.current = null;
          setAutoStatusText(t.autoNavSearching);
          appendLog(
            "INFO",
            lang === "th"
              ? "[AUTO] พักครบแล้ว : ไปหาขยะชิ้นถัดไป"
              : "[AUTO] Rest complete : searching for the next piece"
          );
          return;
        }
      }

      // 2. สถานะ STABILIZING (พักนิ่งชั่วขณะเพื่อให้ภาพนิ่งและระลอกน้ำสงบ ก่อนเริ่มสแกนจับชิ้นถัดไป)
      if (navStateRef.current === "STABILIZING") {
        const elapsed = now - stateStartTimeRef.current;
        if (elapsed < 1000) {
          sendAutoMove(null, "CMD:MOVE:STOP", "");
          setAutoStatusText(t.autoNavStabilizing);
          return;
        } else {
          // ภาพนิ่งแล้ว สลับไป SEARCHING เพื่อให้ AI Backend เริ่มจับเป้าใหม่
          navStateRef.current = "SEARCHING";
          lastTargetPosRef.current = null;
          lastTargetTrackIdRef.current = null;
          autoTargetGate.current.reset();
          missionRef.current = null;
          missionPhaseRef.current = "";
          setAutoStatusText(t.autoNavSearching);
          return;
        }
      }

      // 4. ตรวจสอบเป้าหมายจาก AI Vision
      // คัดเลือกเป้าหมายแบบ Sticky Target Lock: ยึด Track ID เดิมอย่างมั่นคง ไม่สลับเป้าหมายไปมาขณะเรือเลี้ยว
      const gateItems = vision.items.filter((item) => {
        const live = item.status === "DETECTED" || item.status === "TRACKED";
        if (!live) return false;
        if (isOilItem(item)) {
          if (!enableOilModel) return false;
          return !sprayedOilRef.current.some((mark) => coversSprayedOil(mark, item));
        }
        return enableTrashModel;
      });
      const lock = autoTargetGate.current.select(gateItems, vision.status, vision.receivedAt, vision.frame, now);

      const wasCollectingRun =
        missionPhaseRef.current === "approach" ||
        missionPhaseRef.current === "intake" ||
        missionPhaseRef.current === "collect" ||
        navStateRef.current === "APPROACHING";
      if (wasCollectingRun && (lock.state !== "locked" || !lock.target || isOilItem(lock.target))) {
        if (!collectTrackRef.current && missionRef.current) {
          collectTrackRef.current = missionRef.current.trackKey;
        }
        navStateRef.current = "COLLECTING";
        if (collectGoneAtRef.current === null) {
          collectGoneAtRef.current = now;
          appendLog(
            "INFO",
            lang === "th"
              ? "[AUTO] ขยะลอดใต้กล้อง : รอหายครบ 1.5 วินาที"
              : "[AUTO] Trash passed under the camera : wait 1.5 seconds"
          );
        }
        sendAutoMove("forward", "CMD:MOVE:FORWARD", "เดินหน้าเข้าหาขยะ");
        setAutoStatusText(lang === "th" ? "ขยะลอดใต้กล้อง : รอหายครบ 1.5 วินาที" : "Trash under the camera : wait 1.5 seconds");
        return;
      }

      if (lock.state === "grace") {
        if (missionRef.current) {
          missionRef.current = pauseMission(missionRef.current, now);
        }
        setAutoStatusText(lang === "th"
          ? "หลุดล็อกชั่วคราว : ไปต่อถ้าเจอเป้าเดิมภายใน 2 วินาที"
          : "Lock dropped briefly : continue if the same target returns within 2 seconds");
        return;
      }

      if (lock.state === "search" || !lock.target) {
        if (navStateRef.current !== "SPIN_SEARCH") {
          if (lock.released) {
            appendLog(
              "INFO",
              lang === "th"
                ? "[AUTO] หลุดล็อกเกิน 2 วินาที : หยุดแล้วหมุนขวาหาขยะใหม่"
                : "[AUTO] Lock lost for over 2 seconds : stop and spin right to search"
            );
          }
          navStateRef.current = "SPIN_SEARCH";
          searchRef.current = beginSearch(now);
          missionRef.current = null;
          missionPhaseRef.current = "";
          sendAutoMove(null, "CMD:MOVE:STOP", "");
          setAutoStatusText(t.autoNavSearching);
          return;
        }

        const searching = searchRef.current ?? beginSearch(now);
        const step = advanceSearch(searching, now);
        searchRef.current = step.state;
        const searchLabel = step.direction === "forward"
          ? (lang === "th" ? "เดินหน้าหาขยะ" : "Drive forward to search")
          : (lang === "th" ? "หมุนขวาหาขยะ" : "Spin right to search");
        sendAutoMove(step.direction, step.command, searchLabel);
        setAutoStatusText(searchLabel);
        return;
      }

      const target = lock.target;

      // บันทึกตำแหน่งล่าสุดของเป้าหมาย
      lastTargetPosRef.current = {
        x: target.pixelX,
        y: target.pixelY,
        time: now,
      };

      const px = target.pixelX;
      const py = target.pixelY;
      const isOilTarget = target.type === "oil" || (typeof target.className === "string" && target.className.includes("น้ำมัน"));
      const trackKey = `${target.type || "trash"}:${target.trackId}`;
      searchRef.current = null;

      let clock = missionRef.current;
      if (!clock || clock.trackKey !== trackKey) {
        clock = beginMission(now, trackKey);
        missionPhaseRef.current = "";
        if (lock.switched) {
          appendLog(
            "INFO",
            isOilTarget
              ? (lang === "th"
                ? "[AUTO] เจอคราบน้ำมัน : หยุดแล้วเริ่มตรวจใหม่ตั้งแต่ต้น"
                : "[AUTO] Oil found : stop and restart verification from the beginning")
              : (lang === "th"
                ? "[AUTO] เจอขยะ : หยุดแล้วเริ่มตรวจใหม่ตั้งแต่ต้น"
                : "[AUTO] New target : stop and restart verification from the beginning")
          );
        }
      }

      if (isOilTarget) {
        const oilStep = advanceOilAlign(clock, now, px);
        missionRef.current = oilStep.clock;
        if (oilStep.phase !== missionPhaseRef.current) {
          missionPhaseRef.current = oilStep.phase;
          const oilLog = oilStep.phase === "confirm"
            ? (lang === "th" ? "[AUTO] หยุดตรวจ" : "[AUTO] Confirm")
            : oilStep.phase === "center"
              ? (lang === "th" ? "[AUTO] พบคราบน้ำมัน : หมุนให้คราบอยู่กลางจอ" : "[AUTO] Oil found : center it on screen")
              : (lang === "th" ? "[AUTO] พบคราบน้ำมัน : เปิดพ่น" : "[AUTO] Oil found : spray");
          appendLog("INFO", oilLog);
        }
        if (oilStep.phase === "spray") {
          oilSprayTargetRef.current = { key: trackKey, x: px, y: py };
          navStateRef.current = "SPRAYING";
          stateStartTimeRef.current = now;
          sendAutoMove(null, "CMD:MOVE:STOP", "");
          startOilPump();
          setAutoStatusText(lang === "th" ? "เปิดพ่นน้ำมัน" : "Spraying oil");
          return;
        }
        if (oilStep.phase === "confirm") {
          navStateRef.current = "SEARCHING";
          sendAutoMove(null, oilStep.command, "");
          setAutoStatusText(lang === "th" ? "หยุดตรวจ" : "Confirm");
          return;
        }
        navStateRef.current = "ALIGNING";
        const centerLabel = oilStep.direction === "left"
          ? (lang === "th" ? "หมุนซ้ายให้คราบน้ำมันอยู่กลางจอ" : "Spin left to center the oil")
          : (lang === "th" ? "หมุนขวาให้คราบน้ำมันอยู่กลางจอ" : "Spin right to center the oil");
        sendAutoMove(oilStep.direction, oilStep.command, centerLabel);
        setAutoStatusText(centerLabel);
        return;
      }

      const step = advanceMission(clock, now, px, py);
      missionRef.current = step.phase === "collect" ? null : step.clock;

      if (step.phase !== missionPhaseRef.current) {
        const previousPhase = missionPhaseRef.current;
        missionPhaseRef.current = step.phase;
        const justConfirmed = previousPhase === "confirm";
        const phaseLog = justConfirmed && step.phase === "center"
          ? (lang === "th" ? "[AUTO] พบขยะ : หมุนให้ขยะอยู่กลางจอ" : "[AUTO] Trash found : center it on screen")
          : justConfirmed && (step.phase === "approach" || step.phase === "intake" || step.phase === "collect")
            ? (lang === "th" ? "[AUTO] พบขยะ : เดินหน้า" : "[AUTO] Trash found : drive forward")
            : step.phase === "confirm"
          ? (lang === "th" ? "[AUTO] หยุดตรวจ" : "[AUTO] Confirm")
          : step.phase === "commit"
            ? (lang === "th" ? "[AUTO] พักรีเลย์ : ดับ 1 วินาที" : "[AUTO] Relay rest : off for 1 second")
            : step.phase === "center"
              ? ""
              : step.phase === "approach"
                ? (lang === "th" ? "[AUTO] เข้าหา : เริ่มเดินหน้า" : "[AUTO] Approach : moving forward")
              : step.phase === "intake"
                ? (lang === "th" ? "[AUTO] ระยะเก็บ : ยืนยันอีก 1.2 วินาที" : "[AUTO] Intake : confirm for 1.2 seconds")
                : (lang === "th"
                  ? `[AUTO] เก็บขยะ (${px}, ${py}) : เดินหน้าจนลอดใต้กล้อง แล้วรอหาย 1.5 วินาที`
                  : `[AUTO] Collect trash (${px}, ${py}) : drive until it passes under the camera, then wait 1.5 seconds`);
        if (phaseLog) appendLog("INFO", phaseLog);
      }

      if (step.phase === "collect") {
        navStateRef.current = "COLLECTING";
        stateStartTimeRef.current = now;
        collectTrackRef.current = trackKey;
        collectGoneAtRef.current = null;
        sendAutoMove("forward", step.command, "เดินหน้าให้ขยะเข้าช่องเก็บ");
        setAutoStatusText(lang === "th" ? "กวาดขยะ : รอให้ลอดใต้กล้อง" : "Sweeping : waiting for the trash to pass under the camera");
        return;
      }

      if (step.phase === "confirm") {
        navStateRef.current = "SEARCHING";
        sendAutoMove(null, step.command, "");
        setAutoStatusText(lang === "th" ? "หยุดตรวจ" : "Confirm");
        return;
      }

      if (step.phase === "commit") {
        navStateRef.current = "SEARCHING";
        sendAutoMove(null, step.command, "");
        setAutoStatusText(lang === "th" ? "พักรีเลย์ : หยุด 1 วินาทีก่อนจับขยะ" : "Relay rest : stopped for 1 second before chasing");
        return;
      }

      if (step.phase === "center") {
        navStateRef.current = "ALIGNING";
        const centerLabel = step.direction === "left"
          ? (lang === "th" ? "หมุนซ้ายให้ขยะอยู่กลางจอ" : "Spin left to center the target")
          : (lang === "th" ? "หมุนขวาให้ขยะอยู่กลางจอ" : "Spin right to center the target");
        sendAutoMove(step.direction, step.command, centerLabel);
        setAutoStatusText(lang === "th"
          ? `ตั้งกลางจอ : ${centerLabel} (${px}, ${py})`
          : `Center : ${centerLabel} (${px}, ${py})`);
        return;
      }

      if (step.phase === "intake") {
        navStateRef.current = "APPROACHING";
        sendAutoMove("forward", step.command, "ยืนยันระยะเก็บ");
        setAutoStatusText(lang === "th"
          ? `ระยะเก็บ : ยืนยันก่อนกวาด (${px}, ${py})`
          : `Intake : confirming before sweep (${px}, ${py})`);
        return;
      }

      if (step.direction === "left") {
        navStateRef.current = "ALIGNING";
        sendAutoMove("left", step.command, "หมุนซ้ายกันหลุดจากภาพ");
        setAutoStatusText(`${t.autoNavAlignLeft} (${px}, ${py})`);
        return;
      }

      if (step.direction === "right") {
        navStateRef.current = "ALIGNING";
        sendAutoMove("right", step.command, "หมุนขวากันหลุดจากภาพ");
        setAutoStatusText(`${t.autoNavAlignRight} (${px}, ${py})`);
        return;
      }

      navStateRef.current = "APPROACHING";
      sendAutoMove("forward", step.command, "เดินหน้าเข้าหาขยะ");
      setAutoStatusText(`${t.autoNavForward} (${px}, ${py})`);
    }, 100);

    return () => {
      clearInterval(intervalId);
    };
  }, [mode, isConnected, isLocked, controlAvailable, lang, t, appendLog, enableOilModel, enableTrashModel]);

  const lanMismatchMessage = useCallback(
    (board: string, lan: string) =>
      t.lanMismatch
        .replace("{lan}", lan)
        .replace("{board}", board)
        .replace("{ssid}", wifiSsid.trim() || "Wi-Fi ของบอร์ด"),
    [t, wifiSsid]
  );

  const canOpenBoardOnLan = useCallback(
    (rawIp: string) => {
      const ip = resolveBoardIp(rawIp);
      if (!isIpv4(ip)) return true;
      if (deviceLanIp && !sameLan(deviceLanIp, ip)) {
        setConnectionBanner(lanMismatchMessage(ip, deviceLanIp));
        setConnectionBannerTone("error");
        return false;
      }
      return true;
    },
    [deviceLanIp, lanMismatchMessage]
  );

  useEffect(() => {
    if (typeof window === "undefined" || !isCloudDashboard() || !deviceLanIp) return;
    const ip = resolveBoardIp(boardIp);
    if (isIpv4(ip) && !sameLan(deviceLanIp, ip)) {
      setConnectionBanner(lanMismatchMessage(ip, deviceLanIp));
      setConnectionBannerTone("error");
      return;
    }
    setConnectionBanner("");
  }, [boardIp, deviceLanIp, lanMismatchMessage]);

  const handleLanguageChange = (newLang: Language) => {
    setLang(newLang);
    if (typeof window !== "undefined") {
      localStorage.setItem("ribo_dashboard_lang", newLang);
      document.documentElement.lang = newLang;
    }
  };

  // การเชื่อมต่อ/ตัดการเชื่อมต่อฮาร์ดแวร์จริง (Arduino UNO Q + Logitech C270)
  const handleToggleConnect = async () => {
    if (isConnecting) return;

    if (!isConnected) {
      if (isCloudDashboard() && !isDemoMode) {
        if (!canOpenBoardOnLan(boardIp)) return;
        openBoardDashboard(boardIp);
        return;
      }
      setIsConnecting(true);
      setConnectionBanner("");

      let targetIp = boardIp.trim();
      const ipReady = /^\d+\.\d+\.\d+\.\d+$/.test(targetIp) || isDemoBoardHost(targetIp);
      if (!ipReady) {
        const usbStatus = await fetchUnoQBoardWifiStatus();
        setAdbUsbReady(usbStatus.ready);
        if (usbStatus.wlanIp) {
          targetIp = usbStatus.wlanIp;
        } else if (!isCloudDashboard()) {
          appendLog(
            "INFO",
            lang === "th"
              ? "กำลังค้นหาบอร์ดบน Wi-Fi นี้..."
              : "Searching for the board on this Wi-Fi..."
          );
          const found = await discoverUnoQOnLan();
          if (found.found && found.ip) {
            targetIp = found.ip;
            appendLog(
              "SUCCESS",
              lang === "th"
                ? `พบบอร์ดที่ ${targetIp} (${found.source || "scan"})`
                : `Found board at ${targetIp} (${found.source || "scan"})`
            );
          }
        }
      }
      if (targetIp) {
        setBoardIp(boardDisplayHost(targetIp));
        setUnoQIp(boardDisplayHost(targetIp));
      } else {
        const offlineMsg = t.boardNotFoundWifi;
        appendLog("WARN", offlineMsg);
        setConnectionBanner(offlineMsg);
        setConnectionBannerTone("error");
        setIsConnecting(false);
        return;
      }

      appendLog(
        "INFO",
        lang === "th"
          ? `กำลังตรวจสอบการเชื่อมต่อ Arduino UNO Q ผ่าน Wi-Fi (${targetIp})...`
          : `Connecting to Arduino UNO Q via Wi-Fi (${targetIp})...`
      );

      try {
        const result = await connectArduinoUnoQ(targetIp, (incomingLine) => {
          // จัดกลุ่มประเภทข้อความจาก Arduino ให้ตรงความหมาย โดยไม่บันทึกข้อความขยะ
          const upper = incomingLine.toUpperCase();
          if (upper.includes("ERROR") || upper.includes("FAIL")) {
            appendLog("ERROR", `Arduino : ${incomingLine}`);
          } else if (upper.includes("WARN") || upper.includes("STOP")) {
            appendLog("WARN", `Arduino : ${incomingLine}`);
          } else if (
            upper.includes("OK") ||
            upper.includes("READY") ||
            upper.includes("SUCCESS") ||
            upper.includes("BOOTED")
          ) {
            appendLog("SUCCESS", `Arduino : ${incomingLine}`);
          } else {
            appendLog("INFO", `Arduino : ${incomingLine}`);
          }
        });

        if (!result.success) {
          if (result.error === "USER_CANCELLED") {
            appendLog(
              "WARN",
              lang === "th"
                ? "ยกเลิกการเลือกพอร์ต Arduino UNO Q"
                : "Cancelled Arduino UNO Q port selection"
            );
          } else {
            const failMsg =
              typeof window !== "undefined" && isCloudDashboard()
                ? t.cloudBoardBlocked.replace("{ip}", targetIp)
                : t.boardNoResponse.replace("{ip}", targetIp);
            appendLog("WARN", failMsg);
            setConnectionBanner(failMsg);
            setConnectionBannerTone("error");
          }
          setIsConnecting(false);
          return;
        }

        appendLog(
          "SUCCESS",
          lang === "th"
            ? `เชื่อมต่อ Arduino UNO Q ผ่าน Wi-Fi สำเร็จ (${result.portName || boardIp}) — เปิดการทำงานระบบ`
            : `Connected to Arduino UNO Q via Wi-Fi (${result.portName || boardIp}) — Systems active`
        );
        setConnectionBanner("");

        if (isCloudDashboard() && !isDemoMode) {
          openBoardDashboard(targetIp);
          return;
        }

        // ส่งคำสั่งเริ่มต้นระบบไปยัง Arduino UNO Q
        await sendCommandToArduino("CMD:INIT");

        // ตรวจสอบและเปิดกล้อง Logitech C270 (รองรับทั้ง Wi-Fi จากบอร์ด และ USB ในเครื่อง)
        appendLog(
          "INFO",
          lang === "th"
            ? "กำลังตรวจสอบสัญญาณภาพกล้อง Logitech C270..."
            : "Checking Logitech C270 camera stream..."
        );

        const camResult = await connectCameraStream(macAiMode);
        if (camResult.success) {
          if (camResult.isWifiStream) {
            setIsWifiStream(true);
            setWifiStreamUrl(camResult.streamUrl || `/api/arduino/stream?ip=${encodeURIComponent(boardIp)}`);
            setCameraStream(null);
            appendLog(
              "SUCCESS",
              lang === "th"
                ? `รับสัญญาณภาพสดกล้อง Logitech C270 ผ่าน Wi-Fi สำเร็จ (${camResult.deviceName || "Arduino UNO Q"})`
                : `Receiving live Logitech C270 stream over Wi-Fi (${camResult.deviceName || "Arduino UNO Q"})`
            );
          } else if (camResult.stream) {
            setIsWifiStream(false);
            setCameraStream(camResult.stream);
            appendLog(
              "SUCCESS",
              lang === "th"
                ? `เชื่อมต่อกล้อง Logitech C270 สำเร็จ (${camResult.deviceName || "720p 30fps"})`
                : `Logitech C270 camera connected (${camResult.deviceName || "720p 30fps"})`
            );
          }
        } else {
          setIsWifiStream(false);
          setCameraStream(null);
        }

        setIsConnected(true);
      } catch (err: any) {
        appendLog(
          "ERROR",
          lang === "th"
            ? `เกิดข้อผิดพลาดในการเชื่อมต่อ : ${err.message || "ไม่ทราบสาเหตุ"}`
            : `Connection error : ${err.message || "Unknown"}`
        );
      } finally {
        setIsConnecting(false);
      }
    } else {
      autoConnectHandledRef.current = true;
      try {
        await sendCommandToArduino("CMD:DISCONNECT");
      } catch {
        /* still leave the board page */
      }
      try {
        await disconnectArduinoUnoQ();
      } catch {
        /* still leave the board page */
      }
      disconnectCameraStream();
      if (
        !isDemoMode &&
        typeof window !== "undefined" &&
        isBoardDashboardHost(window.location.hostname)
      ) {
        window.location.replace(CLOUD_LAUNCHER_URL);
        return;
      }
      setCameraStream(null);
      setIsWifiStream(false);
      setIsConnected(false);
      setIsOilRunning(false);
      setArmPosition("idle");

      appendLog(
        "WARN",
        lang === "th"
          ? "ตัดการเชื่อมต่อ Arduino UNO Q และกล้อง Logitech C270 เรียบร้อยแล้ว"
          : "Disconnected from Arduino UNO Q and Logitech C270 camera"
      );
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hostname = window.location.hostname;

    if (
      autoConnectHandledRef.current ||
      isConnected ||
      !boardIp.trim() ||
      !isBoardDashboardHost(hostname)
    ) {
      return;
    }

    const currentUrl = new URL(window.location.href);
    autoConnectHandledRef.current = true;
    if (currentUrl.searchParams.has("autoconnect")) {
      currentUrl.searchParams.delete("autoconnect");
      window.history.replaceState({}, "", currentUrl.toString());
    }
    void handleToggleConnect();
  }, [boardIp, isConnected]);

  const handleModeChange = (newMode: OperationModeType) => {
    if (isLocked) return;
    setMode(newMode);
    setIsOilRunning(false);
    setArmPosition("idle");

    if (isConnected) {
      sendCommandToArduino(`CMD:MODE:${newMode.toUpperCase()}`);
    }
    appendLog(
      "CMD",
      lang === "th"
        ? `สลับโหมดการทำงาน : ${newMode === "auto" ? "อัตโนมัติ" : "บังคับด้วยมือ"}`
        : `Mode changed : ${newMode.toUpperCase()}`
    );
  };

  const handleToggleEmergency = () => {
    if (!isLocked) {
      // กดหยุดฉุกเฉิน (E-Stop): สั่งหยุดทุกกลไกทันทีและล็อกสถานะ
      setIsLocked(true);
      setIsOilRunning(false);
      setArmPosition("idle");

      if (isConnected) {
        sendCommandToArduino("CMD:ESTOP:ACTIVE");
      }
      appendLog(
        "ERROR",
        lang === "th"
          ? "⛔ กดปุ่มหยุดฉุกเฉิน (E-STOP) : ระงับทุกระบบทันที"
          : "⛔ Emergency Stop (E-STOP) : All systems halted"
      );
    } else {
      // กดปลดล็อก (Reset)
      setIsLocked(false);
      if (isConnected) {
        sendCommandToArduino("CMD:ESTOP:RESET");
      }
      appendLog(
        "SUCCESS",
        lang === "th"
          ? "↻ ปลดล็อกระบบฉุกเฉิน — พร้อมรับคำสั่งใหม่"
          : "↻ Emergency Stop reset — Ready for commands"
      );
    }
  };

  const handleMove = (direction: string | null) => {
    if (isLocked || mode !== "manual") return;

    if (!isConnected) {
      if (direction) {
        appendLog(
          "WARN",
          lang === "th"
            ? "กรุณากดเชื่อมต่อ Arduino UNO Q ก่อนส่งคำสั่งเคลื่อนที่"
            : "Please connect Arduino UNO Q before sending movement commands"
        );
      }
      return;
    }

    if (lastMoveDir.current === direction) return;
    lastMoveDir.current = direction;

    if (direction) {
      const dirUpper =
        direction === "backward" || direction === "back"
          ? "BACK"
          : direction.toUpperCase();
      sendCommandToArduino(`CMD:MOVE:${dirUpper}`);
      const thDir =
        direction === "forward"
          ? "เดินหน้า"
          : direction === "backward" || direction === "back"
          ? "ถอยหลัง"
          : direction === "left"
          ? "เลี้ยวซ้าย"
          : "เลี้ยวขวา";
      appendLog(
        "CMD",
        lang === "th" ? `สั่งการเคลื่อนที่ : ${thDir}` : `Command Move : ${dirUpper}`
      );
    } else {
      sendCommandToArduino("CMD:MOVE:STOP");
      appendLog(
        "CMD",
        lang === "th" ? "หยุดการเคลื่อนที่" : "Command Move : STOP"
      );
    }
  };

  const handleSetOil = (running: boolean) => {
    if (isLocked || mode !== "manual") {
      return;
    }

    if (!isConnected) {
      appendLog(
        "WARN",
        lang === "th"
          ? "กรุณากดเชื่อมต่อ Arduino UNO Q ก่อนควบคุมระบบฉีดพ่นกำจัดน้ำมัน"
          : "Please connect Arduino UNO Q before controlling oil spray system"
      );
      return;
    }

    setIsOilRunning(running);
    sendCommandToArduino(running ? "CMD:OIL:START" : "CMD:OIL:STOP");
    appendLog(
      "CMD",
      running
        ? lang === "th"
          ? "เปิดระบบฉีดพ่นกำจัดน้ำมัน"
          : "Command Spray : START"
        : lang === "th"
        ? "ปิดระบบฉีดพ่นกำจัดน้ำมัน"
        : "Command Spray : STOP"
    );
  };

  const handleSetArm = (position: "up" | "down" | "idle") => {
    if (isLocked) {
      return;
    }
    if (armPosition === position) {
      return;
    }

    if (!isConnected) {
      if (position !== "idle") {
        appendLog(
          "WARN",
          lang === "th"
            ? "กรุณากดเชื่อมต่อ Arduino UNO Q ก่อนปรับระดับแขนกล"
            : "Please connect Arduino UNO Q before adjusting arm position"
        );
      }
      return;
    }

    setArmPosition(position);
    sendCommandToArduino(`CMD:ARM:${position.toUpperCase()}`);
    appendLog(
      "CMD",
      position === "up"
        ? lang === "th"
          ? "ปรับตำแหน่งแขนกล : ยกขึ้น"
          : "Command Arm : RAISE UP"
        : position === "down"
        ? lang === "th"
          ? "ปรับตำแหน่งแขนกล : ลดลง"
          : "Command Arm : LOWER DOWN"
        : lang === "th"
        ? "หยุดการเคลื่อนไหวแขนกล"
        : "Command Arm : STOP"
    );
  };

  const cameraConnected = Boolean(
    isWifiStream ||
    cameraStream?.getVideoTracks().some((track) => track.readyState === "live")
  );

  return (
    <div
      className={`${styles.container} ${
        !isConnected ? styles.containerLauncher : ""
      }`}
    >
      <Header lang={lang} onLanguageChange={handleLanguageChange} t={t} />

      <main
        className={`${styles.wrap} ${
          !isConnected ? styles.wrapLauncher : ""
        }`}
      >
        <div
          className={`${styles.layout} ${
            isConnected ? "" : styles.layoutDisconnected
          }`}
        >
          <div className={styles.areaStatus}>
            <ConnectionStatus
              t={t}
              isConnected={isConnected}
              cameraConnected={cameraConnected}
              isConnecting={isConnecting}
              onToggleConnect={handleToggleConnect}
              lang={lang}
              boardIp={boardIp}
              onBoardIpChange={handleIpChange}
              wifiSsid={wifiSsid}
              onWifiSsidChange={handleWifiSsidChange}
              wifiPassword={wifiPassword}
              onWifiPasswordChange={setWifiPassword}
              onSetupWifi={handleSetupWifi}
              isWifiSettingUp={isWifiSettingUp}
              showWifiSetup={true}
              cloudLauncher={isCloudDashboard()}
              onOpenBoard={() => {
                if (!canOpenBoardOnLan(boardIp)) return false;
                openBoardDashboard(boardIp);
                return true;
              }}
              adbUsbReady={adbUsbReady}
              statusBanner={connectionBanner}
              statusBannerTone={connectionBannerTone}
            />
          </div>

          {isConnected ? (
            <div className={`${styles.stack} ${styles.layoutMedia}`}>
              <div className={styles.areaMap}>
                <GpsMap
                  lang={lang}
                  initialPosition={demoGpsCenter}
                  simulated={simulatedGps || isDemoMode}
                  boardIp={boardIp}
                />
              </div>
              <div className={styles.areaCamera}>
                <CameraMonitor
                  t={t}
                  isConnected={cameraConnected}
                  boardConnected={isConnected}
                  stream={cameraStream}
                  isWifiStream={isWifiStream}
                  wifiStreamUrl={wifiStreamUrl}
                  detections={activeDetections}
                  onResult={handleVisionResult}
                  lang={lang}
                  enableTrashModel={enableTrashModel}
                  enableOilModel={enableOilModel}
                />
              </div>
            </div>
          ) : null}

          {isConnected ? (
            <div className={`${styles.stack} ${styles.layoutControls}`}>
              <div className={styles.areaDetails}>
                <DetectionDetails
                  t={t}
                  lang={lang}
                  detections={activeDetections}
                  status={visionStatus}
                  error={visionError}
                  meta={visionMeta}
                  enableTrashModel={enableTrashModel}
                  enableOilModel={enableOilModel}
                  onToggleTrashModel={handleToggleTrashModel}
                  onToggleOilModel={handleToggleOilModel}
                />
              </div>

              <div className={styles.areaMode}>
                {!controlAvailable && <p role="status">กล้องและ AI พร้อมทดสอบ — ยังควบคุมมอเตอร์ไม่ได้ ต้องติดตั้งเฟิร์มแวร์ MCU และตรวจผังขาก่อน</p>}
                <OperationMode
                  mode={mode}
                  onModeChange={handleModeChange}
                  isLocked={isLocked || !controlAvailable}
                  onToggleEmergency={handleToggleEmergency}
                  t={t}
                  onMove={handleMove}
                  autoDirection={autoDirection}
                  autoStatusText={autoStatusText}
                  collectedCount={collectedCount}
                />
              </div>

              <div className={styles.areaOil}>
                <OilControl
                  mode={mode}
                  isLocked={isLocked || !controlAvailable}
                  isOilRunning={isOilRunning}
                  armPosition={armPosition}
                  onSetOil={handleSetOil}
                  onSetArm={handleSetArm}
                  t={t}
                />
              </div>

              <div className={styles.areaLog}>
                <ActivityLog
                  t={t}
                  logs={logs}
                  onClearLogs={handleClearLogs}
                  lang={lang}
                />
              </div>
            </div>
          ) : null}
        </div>
      </main>

      <footer className={styles.footer}>
        <p>{t.footerCopy}</p>
        <p>{t.footerDev}</p>
      </footer>
    </div>
  );
};
