"use client";

import React from "react";
import { Droplet, Power } from "lucide-react";
import { Translations } from "./translations";
import { OperationModeType } from "./OperationMode";
import styles from "./dashboard.module.css";

interface OilControlProps {
  mode: OperationModeType;
  isLocked: boolean;
  isOilRunning: boolean;
  armPosition?: "up" | "down" | "idle";
  onSetOil: (running: boolean) => void;
  onSetArm?: (position: "up" | "down" | "idle") => void;
  t: Translations;
}

export const OilControl: React.FC<OilControlProps> = ({
  mode,
  isLocked,
  isOilRunning,
  onSetOil,
  t,
}) => {
  const handleToggleOil = () => {
    if (isLocked || mode === "auto") return;
    onSetOil(!isOilRunning);
  };

  return (
    <section className={styles.card} aria-labelledby="oil-heading">
      <div className={styles.head}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Droplet size={16} className={styles.accent} />
          <h2 id="oil-heading" style={{ margin: 0, fontSize: "14px" }}>
            {t.oilSys}
          </h2>
        </div>
        <span
          className={styles.pill}
          id="oilStatus"
          style={{
            backgroundColor: isOilRunning ? "#ffcc00" : "#333e48",
            color: isOilRunning ? "#151515" : "#94a3b8",
            borderColor: isOilRunning ? "#ffcc00" : "#455360",
            fontWeight: 750,
            transition: "all 0.2s ease",
          }}
        >
          {isOilRunning ? "ON" : "OFF"}
        </span>
      </div>

      {/* ปุ่มเดียวกดสลับ เปิด (สีเหลืองตามธีม) / ปิด (สีเทาตามธีม) — ไม่ใส่การ์ดหุ้มซ้ำซ้อน */}
      <button
        type="button"
        id="oilToggleBtn"
        className={styles.btn}
        disabled={isLocked || mode === "auto"}
        onClick={handleToggleOil}
        style={{
          width: "100%",
          marginTop: "10px",
          minHeight: "42px",
          fontSize: "14px",
          fontWeight: 750,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          borderRadius: "8px",
          backgroundColor: isOilRunning ? "#ffcc00" : "#333e48",
          color: isOilRunning ? "#151515" : "#cbd5e1",
          border: isOilRunning
            ? "1px solid #ffe066"
            : "1px solid #465563",
          boxShadow: isOilRunning
            ? "0 0 14px rgba(255, 204, 0, 0.35)"
            : "none",
          cursor: isLocked || mode === "auto" ? "not-allowed" : "pointer",
          transition: "all 0.2s ease",
        }}
      >
        <Power size={17} strokeWidth={isOilRunning ? 2.5 : 2} />
        <span>{isOilRunning ? "เปิด" : "ปิด"}</span>
      </button>
    </section>
  );
};
