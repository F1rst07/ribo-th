"use client";

import React from "react";
import { Search } from "lucide-react";
import { Translations, Language } from "./translations";
import { DetectionSummary } from "./DetectionSummary";
import { TrashDetection, VisionMeta, VisionStatus } from "./trashVision";
import styles from "./dashboard.module.css";

interface DetectionDetailsProps {
  t: Translations;
  lang?: Language;
  detections: TrashDetection[];
  status: VisionStatus;
  error: string;
  meta: VisionMeta | null;
  enableTrashModel?: boolean;
  enableOilModel?: boolean;
  onToggleTrashModel?: (enabled: boolean) => void;
  onToggleOilModel?: (enabled: boolean) => void;
}

export const DetectionDetails: React.FC<DetectionDetailsProps> = ({
  t,
  lang = "th",
  detections,
  status,
  error,
  meta,
  enableTrashModel = true,
  enableOilModel = true,
  onToggleTrashModel,
  onToggleOilModel,
}) => {
  const isThai = lang === "th";
  const trashItems = detections.filter(
    (item) => item.type !== "oil" && !(typeof item.className === "string" && item.className.includes("น้ำมัน"))
  );
  const oilItems = detections.filter(
    (item) => item.type === "oil" || (typeof item.className === "string" && item.className.includes("น้ำมัน"))
  );

  return (
    <section
      className={styles.card}
      aria-labelledby="detection-details-heading"
      style={{ padding: "12px 14px" }}
    >
      <div className={styles.row}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Search size={15} className={styles.accent} />
          <h2
            id="detection-details-heading"
            style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}
          >
            {t.details}
          </h2>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className={status === "ready" ? styles.aiPillLive : styles.aiPillOffline}>
            {status === "ready"
              ? `FPS : ${typeof meta?.fps === "number" && meta.fps > 0 ? meta.fps.toFixed(1) : "0.0"}`
              : status === "loading"
              ? (isThai ? "FPS : กำลังเริ่ม" : "FPS : Starting")
              : status === "error"
              ? (isThai ? "FPS : ขัดข้อง" : "FPS : Error")
              : "FPS : 0.0"}
          </span>
          {status === "ready" && <DetectionSummary t={t} totalDetected={detections.length} />}
        </div>
      </div>

      {status === "error" && error && <p role="alert">{isThai ? "ตรวจจับขัดข้อง: " : "Detection error: "}{error}</p>}

      {/* สรุปจำนวนการตรวจจับแยกประเภท พร้อมปุ่มเปิด/ปิดแต่ละโมเดล */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "8px",
          marginTop: "10px",
        }}
      >
        {/* โมเดลขยะ (Trash AI) */}
        <div
          style={{
            backgroundColor: enableTrashModel ? "rgba(255, 204, 0, 0.08)" : "rgba(255, 255, 255, 0.02)",
            border: enableTrashModel ? "1px solid rgba(255, 204, 0, 0.28)" : "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "6px",
            padding: "8px 10px",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            opacity: enableTrashModel ? 1 : 0.65,
            transition: "all 0.2s ease",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "11px", color: enableTrashModel ? "#eab308" : "#888888", fontWeight: 600 }}>
              {isThai ? "ขยะ" : "Trash"}
            </span>
            <button
              type="button"
              onClick={() => onToggleTrashModel?.(!enableTrashModel)}
              style={{
                background: enableTrashModel ? "rgba(234, 179, 8, 0.25)" : "rgba(255, 255, 255, 0.06)",
                border: enableTrashModel ? "1px solid #eab308" : "1px solid rgba(255, 255, 255, 0.15)",
                color: enableTrashModel ? "#fde047" : "#888888",
                fontSize: "10px",
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: "10px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                transition: "all 0.15s ease",
              }}
              title={isThai ? (enableTrashModel ? "กดเพื่อปิดการตรวจจับขยะ" : "กดเพื่อเปิดการตรวจจับขยะ") : (enableTrashModel ? "Click to disable trash AI" : "Click to enable trash AI")}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  backgroundColor: enableTrashModel ? "#eab308" : "#666666",
                  boxShadow: enableTrashModel ? "0 0 5px #eab308" : "none",
                }}
              />
              {enableTrashModel ? (isThai ? "เปิด" : "ON") : (isThai ? "ปิด" : "OFF")}
            </button>
          </div>
          <span style={{ fontSize: "13px", fontWeight: 750, color: enableTrashModel ? "#ffffff" : "#71717a" }}>
            {!enableTrashModel
              ? (isThai ? "ปิดใช้งาน" : "Disabled")
              : status === "ready"
              ? (isThai ? `ตรวจพบ : ${trashItems.length} ชิ้น` : `Found : ${trashItems.length} items`)
              : (isThai ? "ยังไม่พร้อมตรวจ" : "Detection unavailable")}
          </span>
        </div>

        {/* โมเดลคราบน้ำมัน (Oil AI) */}
        <div
          style={{
            backgroundColor: enableOilModel ? "rgba(249, 115, 22, 0.08)" : "rgba(255, 255, 255, 0.02)",
            border: enableOilModel ? "1px solid rgba(249, 115, 22, 0.28)" : "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "6px",
            padding: "8px 10px",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            opacity: enableOilModel ? 1 : 0.65,
            transition: "all 0.2s ease",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "11px", color: enableOilModel ? "#f97316" : "#888888", fontWeight: 600 }}>
              {isThai ? "คราบน้ำมัน" : "Oil Slick"}
            </span>
            <button
              type="button"
              onClick={() => onToggleOilModel?.(!enableOilModel)}
              style={{
                background: enableOilModel ? "rgba(249, 115, 22, 0.25)" : "rgba(255, 255, 255, 0.06)",
                border: enableOilModel ? "1px solid #f97316" : "1px solid rgba(255, 255, 255, 0.15)",
                color: enableOilModel ? "#fdba74" : "#888888",
                fontSize: "10px",
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: "10px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                transition: "all 0.15s ease",
              }}
              title={isThai ? (enableOilModel ? "กดเพื่อปิดการตรวจจับน้ำมัน" : "กดเพื่อเปิดการตรวจจับน้ำมัน") : (enableOilModel ? "Click to disable oil AI" : "Click to enable oil AI")}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  backgroundColor: enableOilModel ? "#f97316" : "#666666",
                  boxShadow: enableOilModel ? "0 0 5px #f97316" : "none",
                }}
              />
              {enableOilModel ? (isThai ? "เปิด" : "ON") : (isThai ? "ปิด" : "OFF")}
            </button>
          </div>
          <span style={{ fontSize: "13px", fontWeight: 750, color: enableOilModel ? "#ffffff" : "#71717a" }}>
            {!enableOilModel
              ? (isThai ? "ปิดใช้งาน" : "Disabled")
              : status === "ready"
              ? (meta?.oilClasses && Object.keys(meta.oilClasses).length > 0 && meta?.oilStatus !== "PREPARING"
                  ? (isThai
                      ? `ตรวจพบ : ${oilItems.length} จุด${typeof meta?.oilTotalAreaPct === "number" && meta.oilTotalAreaPct > 0 ? ` (${meta.oilTotalAreaPct.toFixed(1)}%)` : ""}`
                      : `Found : ${oilItems.length} spots${typeof meta?.oilTotalAreaPct === "number" && meta.oilTotalAreaPct > 0 ? ` (${meta.oilTotalAreaPct.toFixed(1)}%)` : ""}`)
                  : (isThai ? "AI คราบน้ำมัน : กำลังเตรียมโมเดล" : "Oil AI : Preparing Model"))
              : (isThai ? "ยังไม่พร้อมตรวจ" : "Detection unavailable")}
          </span>
        </div>
      </div>

      {/* กล่องแสดงรายละเอียดวัตถุที่ตรวจพบล่าสุด */}
      <div
        className={styles.inset}
        style={{
          padding: "8px 12px",
          marginTop: "8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
        }}
      >
        <span style={{ fontSize: "13px", color: "#c9d3d9", display: "flex", alignItems: "center", gap: "6px" }}>
          {!enableTrashModel && !enableOilModel
            ? (isThai ? "ปิดการตรวจจับโมเดลทั้งหมด" : "All AI models disabled")
            : status !== "ready"
            ? (isThai ? "ยังไม่พร้อมตรวจจับ" : "Detection unavailable")
            : trashItems.length > 0 && oilItems.length > 0
            ? (() => {
                const target = trashItems[0];
                const px = target?.pixelX ?? 0;
                const py = target?.pixelY ?? 0;
                return isThai
                  ? `ขยะ (${px}, ${py}) [พบคราบน้ำมันร่วมด้วย]`
                  : `Trash (${px}, ${py}) [Oil also detected]`;
              })()
            : detections.length > 0
            ? (() => {
                const target = detections[0];
                const isOilTarget = target?.type === "oil" || (typeof target?.className === "string" && target.className.includes("น้ำมัน"));
                const px = typeof target?.pixelX === "number" && !isNaN(target.pixelX)
                  ? target.pixelX
                  : typeof target?.x === "number"
                  ? Math.round(((target.x + target.width / 2) / 100) * 640)
                  : 0;
                const py = typeof target?.pixelY === "number" && !isNaN(target.pixelY)
                  ? target.pixelY
                  : typeof target?.y === "number"
                  ? Math.round(((target.y + target.height / 2) / 100) * 360)
                  : 0;
                const typeLabel = isOilTarget
                  ? (isThai ? "คราบน้ำมัน" : "Oil Spill")
                  : (isThai ? "ขยะ" : "Trash");
                return `${typeLabel} (${px}, ${py})`;
              })()
            : t.notFound}
        </span>
        <span className={styles.muted} style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
          {detections.length ? `${isThai ? "ค่าความมั่นใจ" : "Confidence"} : ${Math.round(Math.max(...detections.map((item) => item.confidence)) * 100)}%` : t.confidence}
        </span>
      </div>
    </section>
  );
};
