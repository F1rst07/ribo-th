"use client";

// @refresh reset
// Remount hardware control state after edits, including hook dependency changes.

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Language, strings } from "./translations";
import { Header } from "./Header";
import { ConnectionStatus } from "./ConnectionStatus";
import { CameraMonitor } from "./CameraMonitor";
import { DetectionDetails } from "./DetectionDetails";
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
} from "./hardwareService";
import styles from "./dashboard.module.css";
import { AutoTargetGate } from "./autoTargetGate";

const getFormattedTime = () =>
  new Date().toLocaleTimeString("en-GB", { hour12: false });

export const DashboardView: React.FC<{ controlAvailable?: boolean; macAiMode?: boolean }> = ({
  controlAvailable = true,
  macAiMode = false,
}) => {
  const [lang, setLang] = useState<Language>("th");
  const [mode, setMode] = useState<OperationModeType>("manual");
  const [isLocked, setIsLocked] = useState(false);
  const [isOilRunning, setIsOilRunning] = useState(false);
  const [armPosition, setArmPosition] = useState<"up" | "down" | "idle">("idle");
  const [isMounted, setIsMounted] = useState(false);
  const t = strings[isMounted ? lang : "th"];

  // สถานะการเชื่อมต่อฮาร์ดแวร์จริง (Arduino UNO Q & กล้อง Logitech C270)
  const [boardIp, setBoardIp] = useState<string>("");
  const [wifiSsid, setWifiSsid] = useState<string>("Tuangthong Mansion_5G");
  const [wifiPassword, setWifiPassword] = useState<string>("");
  const [adbUsbReady, setAdbUsbReady] = useState(false);
  const [networkHost, setNetworkHost] = useState("");
  const [isWifiSettingUp, setIsWifiSettingUp] = useState(false);
  const [connectionBanner, setConnectionBanner] = useState<string>("");
  const [connectionBannerTone, setConnectionBannerTone] = useState<
    "error" | "info"
  >("info");
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    setBoardIp(getUnoQIp());
    setWifiSsid(getUnoQWifiSsid());
  }, []);

  useEffect(() => {
    let cancelled = false;
    let inflight = false;
    const pollUsb = async () => {
      if (inflight) return;
      inflight = true;
      try {
        const status = await fetchUnoQBoardWifiStatus();
        if (cancelled) return;
        setAdbUsbReady(status.ready);
        if (status.hostname) setNetworkHost(status.hostname);
        if (status.wlanIp) {
          setBoardIp((prev) => {
            if (prev === status.wlanIp) return prev;
            setUnoQIp(status.wlanIp!);
            return status.wlanIp!;
          });
        } else if (status.boardReachable === false) {
          setBoardIp("");
        }
      } finally {
        inflight = false;
      }
    };
    void pollUsb();
    const timer = setInterval(pollUsb, 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const handleIpChange = (newIp: string) => {
    setBoardIp(newIp);
    setUnoQIp(newIp);
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
    "IDLE" | "SEARCHING" | "ALIGNING" | "APPROACHING" | "COLLECTING" | "REVERSING" | "STABILIZING"
  >("IDLE");
  const stateStartTimeRef = useRef<number>(0);
  const lastSentCommandRef = useRef<string | null>(null);
  const lastSentTimeRef = useRef<number>(0);
  const lastLoggedAutoDirRef = useRef<string | null>(null);
  const lastTargetPosRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastTargetTrackIdRef = useRef<number | null>(null);

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
          setBoardIp(result.wlanIp);
          setUnoQIp(result.wlanIp);
        }
        const refreshed = await fetchUnoQBoardWifiStatus();
        setAdbUsbReady(refreshed.ready);
        if (refreshed.wlanIp) {
          setBoardIp(refreshed.wlanIp);
          setUnoQIp(refreshed.wlanIp);
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
    if (macAiMode || !isConnected || cameraStream) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const pollCamera = async () => {
      const status = await checkUnoQCameraStatus(boardIp);
      if (stopped) return;
      setIsWifiStream(status.active);
      if (status.active && status.streamUrl) setWifiStreamUrl(status.streamUrl);
      timer = setTimeout(() => void pollCamera(), 8000);
    };
    void pollCamera();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [macAiMode, isConnected, cameraStream, boardIp]);

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
        ? enabled ? "เปิดใช้งานโมเดลตรวจจับคราบน้ำมัน (Oil AI : YOLO11n-seg)" : "ปิดการใช้งานโมเดลตรวจจับคราบน้ำมัน (Oil AI)"
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
    // หากไม่อยู่ในโหมดอัตโนมัติ หรือยังไม่ได้เชื่อมต่อ หรือติดสถานะ E-STOP ให้หยุดการนำทางทันที
    if (mode !== "auto" || !isConnected || isLocked || !controlAvailable) {
      autoTargetGate.current.reset();
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
          ? "[AUTO] เริ่มต้นระบบนำทางอัตโนมัติ — กำลังสแกนหาขยะในระยะกล้อง"
          : "[AUTO] Autonomous navigation started — Scanning for trash targets"
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

        if (dir !== lastLoggedAutoDirRef.current) {
          lastLoggedAutoDirRef.current = dir;
          if (dirLabel) {
            appendLog(
              "CMD",
              lang === "th"
                ? `[AUTO] สั่งการเคลื่อนที่ : ${dirLabel}`
                : `[AUTO] Command Move : ${cmd.replace("CMD:MOVE:", "")}`
            );
          }
        }
      };

      const vision = visionInput.current;
      if (vision.status !== "ready" || now - vision.receivedAt > 500) {
        sendAutoMove(null, "CMD:MOVE:STOP", "รอผลภาพใหม่");
        navStateRef.current = "SEARCHING";
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
          // ถอยหลังครบ 1.4 วินาทีแล้ว สลับเป็นสถานะ STABILIZING
          sendAutoMove(null, "CMD:MOVE:STOP", "หยุดนิ่งเพื่อปรับมุมมอง");
          navStateRef.current = "STABILIZING";
          stateStartTimeRef.current = now;
          setAutoStatusText(t.autoNavStabilizing);
          appendLog(
            "INFO",
            lang === "th"
              ? "[AUTO] ถอยหลังตั้งศูนย์สำเร็จ — พักปรับมุมมองกล้องเพื่อล็อกขยะชิ้นใหม่"
              : "[AUTO] Reversing complete — Stabilizing camera to acquire next target"
          );
          return;
        }
      }

      // 2. สถานะ STABILIZING (พักนิ่งชั่วขณะเพื่อให้ภาพนิ่งและระลอกน้ำสงบ ก่อนเริ่มสแกนจับชิ้นถัดไป)
      if (navStateRef.current === "STABILIZING") {
        const elapsed = now - stateStartTimeRef.current;
        if (elapsed < 450) {
          sendAutoMove(null, "CMD:MOVE:STOP", "");
          setAutoStatusText(t.autoNavStabilizing);
          return;
        } else {
          // ภาพนิ่งแล้ว สลับไป SEARCHING เพื่อให้ AI Backend เริ่มจับเป้าใหม่
          navStateRef.current = "SEARCHING";
          lastTargetPosRef.current = null;
          lastTargetTrackIdRef.current = null;
          autoTargetGate.current.reset();
          setAutoStatusText(t.autoNavSearching);
          return;
        }
      }

      // 3. สถานะ COLLECTING (ระยะเข้ากระชัง/ช่องเก็บขยะ เดินหน้าต่อสั้นๆ เพื่อกวาดเข้ากระชังให้หมด)
      if (navStateRef.current === "COLLECTING") {
        const elapsed = now - stateStartTimeRef.current;
        if (elapsed < 800) {
          sendAutoMove("forward", "CMD:MOVE:FORWARD", "เดินหน้ากวาดขยะเข้าช่องเก็บ");
          setAutoStatusText(t.autoNavCollecting);
          return;
        } else {
          // เก็บเสร็จแล้ว! เพิ่มจำนวนขยะที่เก็บได้ และเริ่มเข้าสู่ขั้นตอน REVERSING
          setCollectedCount((prev) => prev + 1);
          appendLog(
            "SUCCESS",
            lang === "th"
              ? `[AUTO] 🎉 เก็บขยะสำเร็จ! — เริ่มถอยหลังตั้งศูนย์ล็อกชิ้นใหม่`
              : `[AUTO] 🎉 Target collected! — Reversing to acquire next target`
          );
          navStateRef.current = "REVERSING";
          stateStartTimeRef.current = now;
          sendAutoMove("backward", "CMD:MOVE:BACK", "ถอยหลัง");
          setAutoStatusText(t.autoNavReversing);
          return;
        }
      }

      // พิกัดความกว้าง 640 x ความสูง 360
      // ศูนย์กลางกล้อง X = 320 (ช่วงที่ถือว่าตรงกลาง: 265 - 375 px)
      const centerMin = 265;
      const centerMax = 375;
      const intakeY = 275; // เข้าใกล้ถึงปากช่องเก็บ

      // 4. ตรวจสอบเป้าหมายจาก AI Vision
      // คัดเลือกเป้าหมายแบบ Sticky Target Lock: ยึด Track ID เดิมอย่างมั่นคง ไม่สลับเป้าหมายไปมาขณะเรือเลี้ยว
      const target = autoTargetGate.current.select(vision.items, vision.status, vision.receivedAt, vision.frame, now);

      if (!target) {
        navStateRef.current = "SEARCHING";
        sendAutoMove(null, "CMD:MOVE:STOP", "รอยืนยันเป้าหมายเดิมหรือเป้าใหม่");
        setAutoStatusText(t.autoNavSearching);
        return;
      }

      // บันทึกตำแหน่งล่าสุดของเป้าหมาย
      lastTargetPosRef.current = {
        x: target.pixelX,
        y: target.pixelY,
        time: now,
      };

      const px = target.pixelX;
      const py = target.pixelY;
      const isOilTarget = target.type === "oil" || (typeof target.className === "string" && target.className.includes("น้ำมัน"));

      // A. ถ้าถึงระยะช่องเก็บ (Y >= intakeY)
      if (py >= intakeY) {
        navStateRef.current = "COLLECTING";
        stateStartTimeRef.current = now;
        sendAutoMove("forward", "CMD:MOVE:FORWARD", isOilTarget ? "เดินหน้าเก็บคราบน้ำมัน" : "เดินหน้ากวาดเข้าช่องเก็บ");
        setAutoStatusText(t.autoNavCollecting);
        appendLog(
          "INFO",
          lang === "th"
            ? `[AUTO] ${isOilTarget ? "คราบน้ำมัน" : "ขยะ"}ถึงระยะเก็บ (${px}, ${py}) — เริ่มกระบวนการเก็บ`
            : `[AUTO] ${isOilTarget ? "Oil spill" : "Trash target"} in intake range (${px}, ${py}) — Collecting`
        );
        return;
      }

      // B. ถ้าขยะอยู่ทางซ้าย (X < 265) -> สั่งเลี้ยวซ้าย
      if (px < centerMin) {
        navStateRef.current = "ALIGNING";
        sendAutoMove("left", "CMD:MOVE:LEFT", "เลี้ยวซ้ายตั้งศูนย์");
        setAutoStatusText(`${t.autoNavAlignLeft} (${px}, ${py})`);
        return;
      }

      // C. ถ้าขยะอยู่ทางขวา (X > 375) -> สั่งเลี้ยวขวา
      if (px > centerMax) {
        navStateRef.current = "ALIGNING";
        sendAutoMove("right", "CMD:MOVE:RIGHT", "เลี้ยวขวาตั้งศูนย์");
        setAutoStatusText(`${t.autoNavAlignRight} (${px}, ${py})`);
        return;
      }

      // D. ถ้าขยะอยู่กึ่งกลาง (265 <= X <= 375) -> สั่งเดินหน้าเข้าหาขยะ
      navStateRef.current = "APPROACHING";
      sendAutoMove("forward", "CMD:MOVE:FORWARD", "เดินหน้าเข้าหาขยะ");
      setAutoStatusText(`${t.autoNavForward} (${px}, ${py})`);
    }, 100);

    return () => {
      clearInterval(intervalId);
    };
  }, [mode, isConnected, isLocked, controlAvailable, lang, t, appendLog]);

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
      setIsConnecting(true);
      setConnectionBanner("");

      let targetIp = boardIp.trim();
      const usbStatus = await fetchUnoQBoardWifiStatus();
      setAdbUsbReady(usbStatus.ready);
      if (usbStatus.wlanIp) {
        targetIp = usbStatus.wlanIp;
      } else {
        appendLog(
          "INFO",
          lang === "th"
            ? "กำลังค้นหาบอร์ดบน Wi-Fi นี้..."
            : "Searching for the board on this Wi-Fi..."
        );
        const found = await discoverUnoQOnLan();
        if (found.found && found.ip) {
          targetIp = found.ip;
          if (found.hostname) setNetworkHost(found.hostname);
          appendLog(
            "SUCCESS",
            lang === "th"
              ? `พบบอร์ดที่ ${targetIp} (${found.source || "scan"})`
              : `Found board at ${targetIp} (${found.source || "scan"})`
          );
        }
      }
      if (targetIp) {
        setBoardIp(targetIp);
        setUnoQIp(targetIp);
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
            const failMsg = t.boardNoResponse.replace("{ip}", targetIp);
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
          const camWarn =
            lang === "th"
              ? `ไม่พบสัญญาณกล้อง : ${camResult.error || "เสียบ Logitech C270 เข้า USB ของ UNO Q (ไม่ใช่ Mac) แล้วรอระบบตรวจซ้ำ"}`
              : `Camera not detected : ${camResult.error || "Plug Logitech C270 into UNO Q USB (not the Mac), then wait for retry"}`;
          appendLog("WARN", camWarn);
          setConnectionBanner(camWarn);
          setConnectionBannerTone("error");
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
      // ตัดการเชื่อมต่อ
      await sendCommandToArduino("CMD:DISCONNECT");
      await disconnectArduinoUnoQ();
      disconnectCameraStream();
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
          ? "⛔ กดปุ่มหยุดฉุกเฉิน (E-STOP) — ระงับทุกระบบทันที"
          : "⛔ Emergency Stop (E-STOP) triggered — All systems halted"
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
    <div className={styles.container}>
      <Header lang={lang} onLanguageChange={handleLanguageChange} t={t} />

      <main className={styles.wrap}>
        <div className={styles.layout}>
          {/* คอลัมน์ซ้าย (บน Desktop) */}
          <div className={styles.stack}>
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
          </div>

          {/* คอลัมน์ขวา (บน Desktop) */}
          <div className={styles.stack}>
            <div className={styles.areaStatus}>
              <ConnectionStatus
                t={t}
                isConnected={isConnected}
                cameraConnected={cameraConnected}
                cameraName={
                  isWifiStream
                    ? "Logitech C270"
                    : cameraStream?.getVideoTracks()[0]?.label || "Logitech C270"
                }
                isWifiStream={isWifiStream}
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
                adbUsbReady={adbUsbReady}
                networkHost={networkHost}
                statusBanner={connectionBanner}
                statusBannerTone={connectionBannerTone}
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
        </div>
      </main>

      <footer className={styles.footer}>
        <p>{t.footerCopy}</p>
        <p>{t.footerDev}</p>
      </footer>
    </div>
  );
};
