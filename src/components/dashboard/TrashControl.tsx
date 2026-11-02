"use client";

import React from "react";
import { Trash2, Play, Square } from "lucide-react";
import { Translations } from "./translations";
import { OperationModeType } from "./OperationMode";
import styles from "./dashboard.module.css";

interface TrashControlProps {
  mode: OperationModeType;
  isLocked: boolean;
  isTrashRunning: boolean;
  onSetTrash: (running: boolean) => void;
  t: Translations;
  collectedCount?: number;
}

export const TrashControl: React.FC<TrashControlProps> = ({
  mode,
  isLocked,
  isTrashRunning,
  onSetTrash,
  t,
  collectedCount = 0,
}) => {
  return (
    <section className={styles.card} aria-labelledby="trash-heading">
      <div className={styles.head}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Trash2 size={18} className={styles.accent} />
          <h2 id="trash-heading" style={{ margin: 0, fontSize: "16px" }}>
            {t.trashSys}
          </h2>
        </div>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>{t.motor}</span>
        <span
          className={styles.pill}
          id="trashStatus"
          style={
            isTrashRunning
              ? { backgroundColor: "#2b8158", color: "#ffffff" }
              : undefined
          }
        >
          {isTrashRunning ? "ON" : "OFF"}
        </span>
      </div>

      <p className={styles.muted} style={{ margin: "10px 0" }}>
        {t.collected.replace("0", collectedCount.toString())}
      </p>

      {mode === "manual" ? (
        <div className={styles.grid2} style={{ marginTop: "12px" }}>
          <button
            type="button"
            id="trashStart"
            className={`${styles.btn} ${styles.btnStart}`}
            disabled={isLocked || isTrashRunning}
            onClick={() => onSetTrash(true)}
          >
            <Play size={16} />
            <span>{t.start}</span>
          </button>
          <button
            type="button"
            id="trashStop"
            className={`${styles.btn} ${styles.btnStop}`}
            disabled={isLocked || !isTrashRunning}
            onClick={() => onSetTrash(false)}
          >
            <Square size={16} />
            <span>{t.stop}</span>
          </button>
        </div>
      ) : (
        <p className={styles.note} style={{ textAlign: "left", marginTop: "12px" }}>
          {t.autoTrash}
        </p>
      )}
    </section>
  );
};
