"use client";

import React, { useState, useEffect } from "react";
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Bot,
} from "lucide-react";
import { Translations } from "./translations";
import { OperationModeType } from "./OperationMode";
import styles from "./dashboard.module.css";

interface MovementControlProps {
  mode: OperationModeType;
  onToggleAuto: () => void;
  t: Translations;
  disabled?: boolean;
  onMove?: (direction: string | null) => void;
  autoDirection?: string | null;
  autoStatusText?: string;
  collectedCount?: number;
}

export const MovementControl: React.FC<MovementControlProps> = ({
  mode,
  onToggleAuto,
  t,
  disabled = false,
  onMove,
  autoDirection,
  autoStatusText,
  collectedCount = 0,
}) => {
  const [activeDirection, setActiveDirection] = useState<string | null>(null);

  // กำหนดทิศทางที่แสดงผลว่ากำลังทำงาน (โหมด auto ดูจาก autoDirection, โหมด manual ดูจาก activeDirection)
  const currentDir = mode === "auto" ? autoDirection : activeDirection;

  // การกดปุ่มทิศทาง (ใช้ได้เมื่ออยู่ในโหมดบังคับมือ)
  const isManualActive = mode === "manual" && !disabled;

  // เริ่มกด (PointerDown / TouchStart / MouseDown)
  const handlePressStart = (dir: string, e: React.PointerEvent) => {
    if (!isManualActive) return;
    try {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {}
    setActiveDirection(dir);
    onMove?.(dir);
  };

  // ปล่อยมือ (PointerUp / PointerCancel / MouseUp / TouchEnd) -> หยุดทันที
  const handlePressEnd = (e?: React.PointerEvent) => {
    if (e) {
      try {
        (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {}
    }
    setActiveDirection(null);
    onMove?.(null);
  };

  // ป้องกันการค้างเมื่อปล่อยเมาส์/นิ้วนิมิตนอกจอ หรือสลับหน้าต่าง (Dead-man switch safety)
  useEffect(() => {
    const handleGlobalRelease = () => {
      setActiveDirection((prev) => {
        if (prev !== null) {
          onMove?.(null);
        }
        return null;
      });
    };

    window.addEventListener("pointerup", handleGlobalRelease);
    window.addEventListener("pointercancel", handleGlobalRelease);
    window.addEventListener("blur", handleGlobalRelease);

    return () => {
      window.removeEventListener("pointerup", handleGlobalRelease);
      window.removeEventListener("pointercancel", handleGlobalRelease);
      window.removeEventListener("blur", handleGlobalRelease);
    };
  }, [onMove]);

  return (
    <div>
      <div className={styles.pad} role="group" aria-label={t.movement}>
        {/* แถวที่ 1: ปุ่มเดินหน้า */}
        <div className={styles.padBlank} />
        <button
          type="button"
          className={`${styles.btn} ${styles.padBtn} ${
            currentDir === "forward" ? styles.btnPrimary : ""
          }`}
          disabled={!isManualActive}
          onPointerDown={(e) => handlePressStart("forward", e)}
          onPointerUp={handlePressEnd}
          onPointerLeave={handlePressEnd}
          onPointerCancel={handlePressEnd}
          onContextMenu={(e) => e.preventDefault()}
          style={{ touchAction: "none" }}
          aria-label={t.forward}
        >
          <ArrowUp size={15} />
          <span>{t.forward}</span>
        </button>
        <div className={styles.padBlank} />

        {/* แถวที่ 2: เลี้ยวซ้าย | ปุ่มกลางอัตโนมัติ (AUTO) | เลี้ยวขวา */}
        <button
          type="button"
          className={`${styles.btn} ${styles.padBtn} ${
            currentDir === "left" ? styles.btnPrimary : ""
          }`}
          disabled={!isManualActive}
          onPointerDown={(e) => handlePressStart("left", e)}
          onPointerUp={handlePressEnd}
          onPointerLeave={handlePressEnd}
          onPointerCancel={handlePressEnd}
          onContextMenu={(e) => e.preventDefault()}
          style={{ touchAction: "none" }}
          aria-label={t.left}
        >
          <ArrowLeft size={15} />
          <span>{t.left}</span>
        </button>

        {/* ปุ่มกลาง "อัตโนมัติ": สีเหลือง = โหมดอัตโนมัติ, สีเทา = โหมดบังคับมือ */}
        <button
          type="button"
          id="centerAutoBtn"
          className={`${styles.btn} ${styles.padBtn} ${
            mode === "auto" ? styles.padBtnAutoActive : styles.padBtnAutoIdle
          }`}
          disabled={disabled}
          onClick={onToggleAuto}
          aria-label={t.auto}
          aria-pressed={mode === "auto"}
          title={mode === "auto" ? t.autoActiveNote : t.manualActiveNote}
        >
          <Bot size={15} />
          <span style={{ fontSize: "10px", whiteSpace: "nowrap" }}>
            {t.auto}
          </span>
        </button>

        <button
          type="button"
          className={`${styles.btn} ${styles.padBtn} ${
            currentDir === "right" ? styles.btnPrimary : ""
          }`}
          disabled={!isManualActive}
          onPointerDown={(e) => handlePressStart("right", e)}
          onPointerUp={handlePressEnd}
          onPointerLeave={handlePressEnd}
          onPointerCancel={handlePressEnd}
          onContextMenu={(e) => e.preventDefault()}
          style={{ touchAction: "none" }}
          aria-label={t.right}
        >
          <ArrowRight size={15} />
          <span>{t.right}</span>
        </button>

        {/* แถวที่ 3: ปุ่มถอยหลัง */}
        <div className={styles.padBlank} />
        <button
          type="button"
          className={`${styles.btn} ${styles.padBtn} ${
            currentDir === "backward" || currentDir === "back" ? styles.btnPrimary : ""
          }`}
          disabled={!isManualActive}
          onPointerDown={(e) => handlePressStart("backward", e)}
          onPointerUp={handlePressEnd}
          onPointerLeave={handlePressEnd}
          onPointerCancel={handlePressEnd}
          onContextMenu={(e) => e.preventDefault()}
          style={{ touchAction: "none" }}
          aria-label={t.backward}
        >
          <ArrowDown size={15} />
          <span>{t.backward}</span>
        </button>
        <div className={styles.padBlank} />
      </div>

      {/* แถบแสดงสถานะการนำทางอัตโนมัติ (Autonomous Navigation Status Banner) */}
      {mode === "auto" ? (
        <div
          style={{
            marginTop: "10px",
            padding: "8px 10px",
            backgroundColor: "rgba(255, 204, 0, 0.08)",
            border: "1px solid rgba(255, 204, 0, 0.28)",
            borderRadius: "7px",
            display: "flex",
            flexDirection: "column",
            gap: "5px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: "#ffcc00",
                  boxShadow: "0 0 8px #ffcc00",
                  display: "inline-block",
                }}
              />
              <span style={{ fontWeight: 700, color: "#ffcc00", fontSize: "11px" }}>
                {t.autoNavActive}
              </span>
            </div>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#28a745",
                backgroundColor: "rgba(40, 167, 69, 0.15)",
                padding: "1px 7px",
                borderRadius: "4px",
                border: "1px solid rgba(40, 167, 69, 0.3)",
              }}
            >
              {t.collectedCountLabel}{collectedCount}
            </span>
          </div>
          <div
            style={{
              fontSize: "12px",
              color: "#e2e8f0",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "5px",
            }}
          >
            <span>🧭</span>
            <span>{autoStatusText || t.autoNavSearching}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
};
