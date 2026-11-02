"use client";

import React, { useEffect } from "react";
import { Droplet, Play, Square, ArrowUp, ArrowDown } from "lucide-react";
import { Translations } from "./translations";
import { OperationModeType } from "./OperationMode";
import styles from "./dashboard.module.css";

interface OilControlProps {
  mode: OperationModeType;
  isLocked: boolean;
  isOilRunning: boolean;
  armPosition: "up" | "down" | "idle";
  onSetOil: (running: boolean) => void;
  onSetArm: (position: "up" | "down" | "idle") => void;
  t: Translations;
}

export const OilControl: React.FC<OilControlProps> = ({
  mode,
  isLocked,
  isOilRunning,
  armPosition,
  onSetOil,
  onSetArm,
  t,
}) => {
  const isArmPressedRef = React.useRef(false);

  // ระบบเดิมสำหรับ "การหมุนกลไกเก็บน้ำมัน": กด "หมุน" ทำงานต่อเนื่อง, กด "หยุด" เพื่อหยุด
  const handleStartOil = () => {
    if (isLocked) return;
    onSetOil(true);
  };

  const handleStopOil = () => {
    if (isLocked) return;
    onSetOil(false);
  };

  // Push Button (กดค้าง-ปล่อยหยุด) สำหรับแขนกล ขึ้น / ลง
  const handleArmStart = (dir: "up" | "down", e: React.PointerEvent) => {
    if (isLocked) return;
    try {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {}
    isArmPressedRef.current = true;
    onSetArm(dir);
  };

  const handleArmEnd = (e?: React.PointerEvent) => {
    if (e) {
      try {
        (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {}
    }
    if (isArmPressedRef.current) {
      isArmPressedRef.current = false;
      onSetArm("idle");
    }
  };

  // ป้องกันแขนกลค้างเมื่อปล่อยเมาส์/นิ้วนิมิตนอกจอ หรือสลับหน้าต่าง (สำหรับแขนกล Push Button)
  useEffect(() => {
    const handleGlobalRelease = () => {
      if (isArmPressedRef.current) {
        isArmPressedRef.current = false;
        onSetArm("idle");
      }
    };

    window.addEventListener("pointerup", handleGlobalRelease);
    window.addEventListener("pointercancel", handleGlobalRelease);
    window.addEventListener("blur", handleGlobalRelease);

    return () => {
      window.removeEventListener("pointerup", handleGlobalRelease);
      window.removeEventListener("pointercancel", handleGlobalRelease);
      window.removeEventListener("blur", handleGlobalRelease);
    };
  }, [onSetArm]);

  return (
    <section className={styles.card} aria-labelledby="oil-heading">
      <div className={styles.head}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Droplet size={16} className={styles.accent} />
          <h2 id="oil-heading" style={{ margin: 0, fontSize: "14px" }}>
            {t.oilSys}
          </h2>
        </div>
      </div>

      {/* ควบคุมตำแหน่งแขนเก็บน้ำมัน (ขึ้น / ลง) */}
      <div className={styles.inset}>
        <div className={styles.row}>
          <b>{t.arm}</b>
          <span
            className={styles.pill}
            id="armStatus"
            style={{
              backgroundColor:
                armPosition === "up" || armPosition === "down"
                  ? "#dcae00"
                  : undefined,
              color:
                armPosition === "up" || armPosition === "down"
                  ? "#161616"
                  : undefined,
            }}
          >
            {armPosition === "up"
              ? t.up
              : armPosition === "down"
              ? t.down
              : t.idle}
          </span>
        </div>
        <div className={styles.grid2} style={{ marginTop: "12px" }}>
          <button
            type="button"
            id="armUp"
            className={`${styles.btn} ${
              armPosition === "up" ? styles.btnPrimary : ""
            }`}
            disabled={isLocked}
            onPointerDown={(e) => handleArmStart("up", e)}
            onPointerUp={handleArmEnd}
            onPointerLeave={handleArmEnd}
            onPointerCancel={handleArmEnd}
            onContextMenu={(e) => e.preventDefault()}
            style={{ touchAction: "none" }}
          >
            <ArrowUp size={15} />
            <span>{t.raise}</span>
          </button>
          <button
            type="button"
            id="armDown"
            className={`${styles.btn} ${
              armPosition === "down" ? styles.btnPrimary : ""
            }`}
            disabled={isLocked}
            onPointerDown={(e) => handleArmStart("down", e)}
            onPointerUp={handleArmEnd}
            onPointerLeave={handleArmEnd}
            onPointerCancel={handleArmEnd}
            onContextMenu={(e) => e.preventDefault()}
            style={{ touchAction: "none" }}
          >
            <ArrowDown size={15} />
            <span>{t.lower}</span>
          </button>
        </div>
      </div>

      {/* ควบคุมการหมุนกลไกเก็บน้ำมัน */}
      <div className={styles.inset} style={{ marginTop: "10px" }}>
        <div className={styles.row}>
          <b>{t.rotation}</b>
          <span
            className={styles.pill}
            id="oilStatus"
            style={
              isOilRunning
                ? { backgroundColor: "#2b8158", color: "#ffffff" }
                : undefined
            }
          >
            {isOilRunning ? "ON" : "OFF"}
          </span>
        </div>
        {/* ปุ่มหมุน / หยุดหมุน */}
        <div className={styles.grid2} style={{ marginTop: "10px" }}>
          <button
            type="button"
            id="oilStart"
            className={`${styles.btn} ${styles.btnStart}`}
            disabled={isLocked || isOilRunning || mode === "auto"}
            onClick={handleStartOil}
          >
            <Play size={15} />
            <span>{t.start}</span>
          </button>
          <button
            type="button"
            id="oilStop"
            className={`${styles.btn} ${styles.btnStop}`}
            disabled={isLocked || !isOilRunning || mode === "auto"}
            onClick={handleStopOil}
          >
            <Square size={15} />
            <span>{t.stop}</span>
          </button>
        </div>
      </div>
    </section>
  );
};
