"use client";

import React from "react";
import { Compass } from "lucide-react";
import { Translations } from "./translations";
import { MovementControl } from "./MovementControl";
import { EmergencyStop } from "./EmergencyStop";
import styles from "./dashboard.module.css";

export type OperationModeType = "auto" | "manual";

interface OperationModeProps {
  mode: OperationModeType;
  onModeChange: (mode: OperationModeType) => void;
  isLocked: boolean;
  onToggleEmergency: () => void;
  t: Translations;
  onMove?: (direction: string | null) => void;
  autoDirection?: string | null;
  autoStatusText?: string;
  collectedCount?: number;
}

export const OperationMode: React.FC<OperationModeProps> = ({
  mode,
  onModeChange,
  isLocked,
  onToggleEmergency,
  t,
  onMove,
  autoDirection,
  autoStatusText,
  collectedCount = 0,
}) => {
  const handleToggleAuto = () => {
    if (isLocked) return;
    onModeChange(mode === "auto" ? "manual" : "auto");
  };

  return (
    <section className={styles.card} aria-labelledby="mode-heading">
      <div className={styles.row} style={{ marginBottom: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Compass size={16} className={styles.accent} />
          <h2 id="mode-heading" className={styles.head} style={{ margin: 0, fontSize: "14px" }}>
            {t.operationAndMovement}
          </h2>
        </div>
        <span
          className={styles.pill}
          style={
            isLocked
              ? { backgroundColor: "#b63b3b", color: "#fff" }
              : mode === "auto"
              ? { backgroundColor: "#ffcc00", color: "#151515", fontWeight: 750 }
              : { backgroundColor: "#46515a", color: "#dce3e7" }
          }
        >
          {isLocked ? "STOPPED" : mode === "auto" ? t.auto : t.manual}
        </span>
      </div>

      {/* แผงควบคุมการเคลื่อนที่รวมในหน้าเดียว (มีปุ่มอัตโนมัติอยู่ตรงกลาง) */}
      <MovementControl
        mode={mode}
        onToggleAuto={handleToggleAuto}
        disabled={isLocked}
        t={t}
        onMove={onMove}
        autoDirection={autoDirection}
        autoStatusText={autoStatusText}
        collectedCount={collectedCount}
      />

      {/* ปุ่มหยุดฉุกเฉิน (E-Stop) */}
      <EmergencyStop
        isLocked={isLocked}
        onToggleEmergency={onToggleEmergency}
        t={t}
      />
    </section>
  );
};
