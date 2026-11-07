"use client";

import React, { useEffect, useRef, useState } from "react";
import { Camera, Scan } from "lucide-react";
import { Translations } from "./translations";
import {
  parseDetections,
  parseVisionMeta,
  TrashDetection,
  VisionMeta,
  VisionStatus,
} from "./trashVision";
import styles from "./dashboard.module.css";
import { boardArduinoApi, boardVisionApi } from "@/lib/clientBoardApi";
import { getUnoQIp } from "./hardwareService";

/** Gap after each AI result. The live picture is a separate MJPEG and is never copied onto a canvas. */
const WIFI_VISION_MS = 200;
const USB_VISION_MIN_MS = 280;

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

interface CameraMonitorProps {
  t: Translations;
  isConnected: boolean;
  boardConnected?: boolean;
  stream: MediaStream | null;
  isWifiStream?: boolean;
  wifiStreamUrl?: string;
  detections: TrashDetection[];
  onResult: (detections: TrashDetection[], status: VisionStatus, error?: string, meta?: VisionMeta) => void;
  lang: "th" | "en";
  enableTrashModel?: boolean;
  enableOilModel?: boolean;
}

export const CameraMonitor: React.FC<CameraMonitorProps> = ({
  t,
  isConnected,
  boardConnected = false,
  stream,
  isWifiStream = false,
  wifiStreamUrl = "/api/arduino/stream",
  detections,
  onResult,
  lang,
  enableTrashModel = true,
  enableOilModel = true,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [streamAttempt, setStreamAttempt] = useState(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(retryTimer.current), []);

  // เชื่อมโยง MediaStream จากกล้องจริงเข้ากับแท็ก <video>
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (stream && isConnected) {
      // ห้ามผูก stream และสั่ง play ซ้ำทุกครั้งที่ผลตรวจจับ render ใหม่
      if (video.srcObject !== stream) {
        video.srcObject = stream;
      }
      if (video.paused) {
        video.play().catch(() => { });
      }
    } else if (video.srcObject) {
      video.srcObject = null;
    }
  }, [stream, isConnected]);

  useEffect(() => {
    if (!isConnected || !isWifiStream) {
      if (!isWifiStream) return;
      onResult([], "idle");
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const controller = new AbortController();
    onResult([], "loading");

    const wifiScan = async () => {
      if (stopped) return;
      let nextDelay = WIFI_VISION_MS;
      try {
        const ip = getUnoQIp();
        const snapResp = await fetch(boardArduinoApi(ip, "snapshot", { ip }), {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
          mode: "cors",
        });
        if (!snapResp.ok) throw new Error(`snapshot ${snapResp.status}`);
        const blob = await snapResp.blob();
        const bitmap = await createImageBitmap(blob);
        const frameW = bitmap.width;
        const frameH = bitmap.height;
        bitmap.close();
        const image = await blobToBase64(blob);
        const response = await fetch(boardVisionApi(ip), {
          method: "POST",
          headers: {
            "Content-Type": "text/plain",
            "X-Enable-Trash": enableTrashModel ? "1" : "0",
            "X-Enable-Oil": enableOilModel ? "1" : "0",
            ...(boardVisionApi(ip).startsWith("/") ? { "X-UNOQ-IP": ip } : {}),
          },
          body: image,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        });
        if (response.status === 429) {
          if (!stopped) timer = setTimeout(() => void wifiScan(), WIFI_VISION_MS);
          return;
        }
        const result = await response.json();
        if (!response.ok) {
          throw new Error(typeof result.error === "string" ? result.error : `HTTP ${response.status}`);
        }
        const parsed = parseDetections(result.predictions, frameW, frameH);
        const meta = parseVisionMeta(result.meta);
        if (!stopped) {
          failures = 0;
          onResult(parsed, "ready", "", meta);
        }
      } catch (error) {
        if (!stopped) {
          failures += 1;
          nextDelay = Math.min(15000, WIFI_VISION_MS * 2 ** Math.min(failures, 3));
          onResult([], "error", error instanceof Error ? error.message : "Inference failed");
        }
      }
      if (!stopped) timer = setTimeout(() => void wifiScan(), nextDelay);
    };
    void wifiScan();
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [isWifiStream, isConnected, onResult, enableTrashModel, enableOilModel]);

  useEffect(() => {
    if (!stream || isWifiStream || !isConnected) {
      if (!stream) onResult([], "idle");
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const controller = new AbortController();
    const track = stream?.getVideoTracks()[0];
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext("2d");
    const onEnded = () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      onResult([], "idle");
    };
    track?.addEventListener("ended", onEnded);
    onResult([], "loading");

    const scan = async () => {
      if (stopped) return;
      const scanStarted = performance.now();
      let nextDelay = 100;
      const video = videoRef.current;

      try {
        let frameAvailable = false;
        if (!context) throw new Error("Camera frame unavailable");

        if (stream && video && video.videoWidth && video.videoHeight && track?.readyState === "live") {
          const sourceWidth = Math.min(video.videoWidth, video.videoHeight * 16 / 9);
          const sourceHeight = sourceWidth * 9 / 16;
          context.drawImage(
            video,
            (video.videoWidth - sourceWidth) / 2,
            (video.videoHeight - sourceHeight) / 2,
            sourceWidth,
            sourceHeight,
            0,
            0,
            canvas.width,
            canvas.height
          );
          frameAvailable = true;
        }

        if (frameAvailable) {
          const image = canvas.toDataURL("image/jpeg", 0.72).split(",")[1];
          const response = await fetch("/api/vision", {
            method: "POST",
            headers: {
              "X-Enable-Trash": enableTrashModel ? "1" : "0",
              "X-Enable-Oil": enableOilModel ? "1" : "0",
              "X-UNOQ-IP": getUnoQIp(),
            },
            body: image,
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
          });
          if (response.status === 429) {
            // Another dashboard is inferring. Keep its result timestamp old;
            // the next scan captures a fresh frame rather than queuing this one.
            if (!stopped) timer = setTimeout(() => void scan(), 750 + Math.random() * 500);
            return;
          }
          const result = await response.json();
          if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : `HTTP ${response.status}`);
          const parsed = parseDetections(result.predictions, canvas.width, canvas.height);
          const meta = parseVisionMeta(result.meta);
          if (!stopped) {
            failures = 0;
            onResult(parsed, "ready", "", meta);
            // Leave bandwidth/CPU for live video; never queue inference work.
            nextDelay = Math.max(USB_VISION_MIN_MS, 180 - (performance.now() - scanStarted));
          }
        }
      } catch (error) {
        if (!stopped) {
          failures += 1;
          nextDelay = Math.min(30000, 2000 * 2 ** Math.min(failures - 1, 4));
          onResult([], "error", error instanceof Error ? error.message : "Inference failed");
        }
      }

      // Only one request at a time; take the newest frame after the previous result.
      if (!stopped) timer = setTimeout(() => void scan(), nextDelay);
    };
    void scan();
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      track?.removeEventListener("ended", onEnded);
    };
  }, [stream, isWifiStream, isConnected, onResult, enableTrashModel, enableOilModel]);

  return (
    <section className={styles.card} aria-labelledby="camera-heading">
      <div className={styles.head}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <Scan size={16} className={styles.accent} />
          <h2 id="camera-heading" style={{ margin: 0, fontSize: "14px" }}>
            {t.camera}
          </h2>
        </div>
        <span
          className={styles.pill}
          style={
            isConnected
              ? { backgroundColor: "#15803d", color: "#ffffff", border: "none" }
              : undefined
          }
        >
          {isConnected ? "CAM 01 • LIVE" : "CAM 01"}
        </span>
      </div>

      <div className={styles.camera} role="region" aria-label={t.camera}>
        {/* เลเยอร์แสดงภาพกล้องจริง (รองรับทั้ง Wi-Fi Stream จาก Arduino UNO Q และ Local WebCam) */}
        {isConnected && (stream || isWifiStream) ? (
          <>
            {stream ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={styles.cameraVideo}
              />
            ) : (
              <img
                ref={imageRef}
                src={`${wifiStreamUrl}${wifiStreamUrl.includes("?") ? "&" : "?"}live=${streamAttempt}`}
                onError={() => {
                  clearTimeout(retryTimer.current);
                  retryTimer.current = setTimeout(() => setStreamAttempt((attempt) => attempt + 1), 1500);
                }}
                alt="Live Camera Feed"
                className={styles.cameraVideo}
              />
            )}
            <div className={styles.detectionOverlay} aria-hidden="true">
              {/* เลเยอร์ SVG สำหรับแสดง Segmentation Mask ของคราบน้ำมันแบบโปร่งแสงตามรูปทรงจริง */}
              {(() => {
                const oilWithPoints = detections.filter(
                  (d) =>
                    (d.type === "oil" || (typeof d.className === "string" && d.className.includes("น้ำมัน"))) &&
                    d.points &&
                    d.points.length >= 3
                );
                if (oilWithPoints.length === 0) return null;
                return (
                  <svg
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      pointerEvents: "none",
                      zIndex: 2,
                    }}
                    viewBox="0 0 640 360"
                    preserveAspectRatio="none"
                  >
                    {oilWithPoints.map((detection, index) => {
                      const pts = detection.points!.map((p) => `${p.x},${p.y}`).join(" ");
                      return (
                        <g key={`oil-poly-${detection.trackId ?? index}`}>
                          {/* แผ่นระบายสีโปร่งแสงแนบไปกับผิวน้ำที่มีคราบน้ำมันจริง */}
                          <polygon
                            points={pts}
                            fill="rgba(249, 115, 22, 0.40)"
                            stroke="#f97316"
                            strokeWidth="2.5"
                            strokeLinejoin="round"
                          />
                          {/* จุดกึ่งกลางคราบน้ำมัน (Centroid Point) */}
                          <circle
                            cx={detection.pixelX}
                            cy={detection.pixelY}
                            r="4.5"
                            fill="#ffedd5"
                            stroke="#ea580c"
                            strokeWidth="2"
                          />
                        </g>
                      );
                    })}
                  </svg>
                );
              })()}

              {/* ป้ายกำกับ (Badge) ของคราบน้ำมันที่แสดงตรงกลางจุดคราบแต่ละจุด */}
              {detections
                .filter(
                  (d) =>
                    (d.type === "oil" || (typeof d.className === "string" && d.className.includes("น้ำมัน"))) &&
                    d.points &&
                    d.points.length >= 3
                )
                .map((detection, index) => {
                  const isThai = lang === "th";
                  const px = detection.pixelX;
                  const py = detection.pixelY;
                  const coord = `(${px}, ${py})`;
                  const label = isThai
                    ? `คราบน้ำมัน : ${Math.round(detection.confidence * 100)}% ${coord}`
                    : `Oil Spill : ${Math.round(detection.confidence * 100)}% ${coord}`;
                  const leftPct = Math.max(2, Math.min(85, (px / 640) * 100));
                  const topPct = Math.max(4, Math.min(92, (py / 360) * 100));
                  return (
                    <div
                      key={`oil-badge-${detection.trackId ?? index}`}
                      style={{
                        position: "absolute",
                        left: `${leftPct}%`,
                        top: `${topPct}%`,
                        transform: "translate(-50%, -100%)",
                        pointerEvents: "none",
                        zIndex: 5,
                        transition: "all 0.08s ease-out",
                      }}
                    >
                      <span
                        className={styles.boxBadge}
                        style={{
                          position: "static",
                          backgroundColor: "rgba(17, 26, 34, 0.94)",
                          color: "#f97316",
                          borderColor: "#f97316",
                          boxShadow: "0 2px 6px rgba(0,0,0,0.6)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {label}
                      </span>
                    </div>
                  );
                })}

              {/* แสดงกรอบ Bounding Box มาตรฐานสำหรับขยะ (หรือคราบน้ำมันกรณีไม่มี Polygon Points) */}
              {detections
                .filter(
                  (d) =>
                    !(
                      (d.type === "oil" || (typeof d.className === "string" && d.className.includes("น้ำมัน"))) &&
                      d.points &&
                      d.points.length >= 3
                    )
                )
                .map((detection, index) => {
                  const isThai = lang === "th";
                  const px = typeof detection.pixelX === "number" && !isNaN(detection.pixelX)
                    ? detection.pixelX
                    : Math.round(((detection.x + detection.width / 2) / 100) * 640);
                  const py = typeof detection.pixelY === "number" && !isNaN(detection.pixelY)
                    ? detection.pixelY
                    : Math.round(((detection.y + detection.height / 2) / 100) * 360);
                  const isOil = detection.type === "oil" || (typeof detection.className === "string" && detection.className.includes("น้ำมัน"));
                  const coord = `(${px}, ${py})`;
                  const label = isOil
                    ? (isThai
                      ? `คราบน้ำมัน : ${Math.round(detection.confidence * 100)}% ${coord}`
                      : `Oil : ${Math.round(detection.confidence * 100)}% ${coord}`)
                    : (isThai
                      ? `ขยะ : ${Math.round(detection.confidence * 100)}% ${coord}`
                      : `Trash : ${Math.round(detection.confidence * 100)}% ${coord}`);
                  const accentColor = isOil ? "#f97316" : "#ffc107";

                  // บังคับขอบเขตกรอบให้อยู่ในจอภาพ ไม่หลุดล้นขอบจอ
                  const left = Math.max(0.5, Math.min(99.5 - detection.width, detection.x));
                  const top = Math.max(0.5, Math.min(99.5 - detection.height, detection.y));
                  const width = Math.min(100 - left, Math.max(2, detection.width));
                  const height = Math.min(100 - top, Math.max(2, detection.height));

                  // ถ้ากรอบอยู่ชิดขอบบนจอ (top < 7.5%) ให้นำป้าย Badge มาแสดงด้านในกรอบ ไม่ให้ออกนอกจอและโดนตัดทิ้ง
                  const isNearTop = top < 7.5;
                  const isNearRight = (left + width) > 75;

                  return (
                    <div
                      key={detection.trackId ?? index}
                      className={`${styles.boundingBox} ${styles.boxTrash}`}
                      style={{
                        left: `${left}%`,
                        top: `${top}%`,
                        width: `${width}%`,
                        height: `${height}%`,
                        borderColor: isOil ? "#f97316" : undefined,
                        boxShadow: isOil ? "0 0 10px rgba(249, 115, 22, 0.4)" : undefined,
                        transition: "all 0.08s ease-out",
                      }}
                    >
                      <span
                        className={styles.boxBadge}
                        style={{
                          top: isNearTop ? "4px" : "-24px",
                          left: isNearRight ? "auto" : "0",
                          right: isNearRight ? "0" : "auto",
                          backgroundColor: isNearTop ? "rgba(17, 26, 34, 0.94)" : "#111a22",
                          color: accentColor,
                          borderColor: accentColor,
                          boxShadow: "0 2px 6px rgba(0,0,0,0.6)",
                        }}
                      >
                        {label}
                      </span>
                      {/* จุดกึ่งกลางเป้าหมาย (Target Center Point) */}
                      <div
                        style={{
                          position: "absolute",
                          left: "50%",
                          top: "50%",
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          backgroundColor: accentColor,
                          boxShadow: `0 0 6px ${accentColor}`,
                          transform: "translate(-50%, -50%)",
                          pointerEvents: "none",
                        }}
                        aria-hidden="true"
                      />
                    </div>
                  );
                })}
            </div>
          </>
        ) : (
          <>
            <div className={styles.cameraIcon}>
              <Camera size={36} />
            </div>
            <div style={{ fontWeight: 600, fontSize: "13px" }}>{t.noSignal}</div>
            <small style={{ color: "#8b99a3" }}>
              {boardConnected
                ? lang === "th"
                  ? "เชื่อมต่อบอร์ดแล้ว • กำลังรอภาพจากกล้อง USB บน UNO Q และตรวจซ้ำอัตโนมัติ"
                  : "Board connected • Waiting for USB camera frames on UNO Q; retrying automatically"
                : t.cameraWait}
            </small>
          </>
        )}

        {/* HUD Viewfinder Corners */}
        <div className={styles.viewfinderTL} aria-hidden="true" />
        <div className={styles.viewfinderTR} aria-hidden="true" />
        <div className={styles.viewfinderBL} aria-hidden="true" />
        <div className={styles.viewfinderBR} aria-hidden="true" />
      </div>
    </section>
  );
};
