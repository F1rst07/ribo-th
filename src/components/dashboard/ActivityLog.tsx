"use client";

import React, { useEffect, useRef, useState } from "react";
import { Terminal, Trash2, Calendar, X, Clock, ArrowRight } from "lucide-react";
import { Translations, Language } from "./translations";
import styles from "./dashboard.module.css";

export interface LogEntry {
  id: string;
  time: string;
  timestamp?: number;
  type: "SYSTEM" | "INFO" | "SUCCESS" | "WARN" | "CMD" | "ERROR";
  message: string;
}

export interface ClearLogOptions {
  mode: "all" | "before" | "range";
  cutoffTimestamp?: number;
  startTimestamp?: number;
  endTimestamp?: number;
}

interface ActivityLogProps {
  t: Translations;
  logs: LogEntry[];
  onClearLogs?: (options: ClearLogOptions) => void;
  lang?: Language;
}

const formatDateTimeLocal = (date: Date) => {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${y}-${m}-${d}T${hh}:${mm}`;
};

export const ActivityLog: React.FC<ActivityLogProps> = ({
  t,
  logs,
  onClearLogs,
  lang = "th",
}) => {
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [showClearPanel, setShowClearPanel] = useState(false);
  const [clearMode, setClearMode] = useState<
    "all" | "5m" | "1h" | "before" | "range"
  >("all");
  const [customDateTime, setCustomDateTime] = useState<string>("");
  const [rangeStart, setRangeStart] = useState<string>("");
  const [rangeEnd, setRangeEnd] = useState<string>("");

  // อัปเดตเวลาเริ่มต้น-สิ้นสุดให้เป็นปัจจุบันทุกครั้งที่เปิดแผงควบคุม
  useEffect(() => {
    if (showClearPanel) {
      const now = new Date();
      setCustomDateTime(formatDateTimeLocal(now));
      setRangeEnd(formatDateTimeLocal(now));
      setRangeStart(
        formatDateTimeLocal(new Date(now.getTime() - 30 * 60 * 1000))
      );
    }
  }, [showClearPanel]);

  // เลื่อนลงมาที่ข้อความล่าสุดอัตโนมัติเมื่อมีเหตุการณ์ใหม่
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const handleExecuteClear = () => {
    if (!onClearLogs) return;

    if (clearMode === "all") {
      onClearLogs({ mode: "all" });
    } else if (clearMode === "range") {
      // ครอบคลุมจนถึงวินาทีที่ 59.999 ของนาทีสิ้นสุด
      const start = new Date(rangeStart).getTime();
      const end = new Date(rangeEnd).getTime() + 59999;
      if (!isNaN(start) && !isNaN(end)) {
        onClearLogs({
          mode: "range",
          startTimestamp: Math.min(start, end),
          endTimestamp: Math.max(start, end),
        });
      }
    } else if (clearMode === "5m") {
      onClearLogs({
        mode: "before",
        cutoffTimestamp: Date.now() - 5 * 60 * 1000,
      });
    } else if (clearMode === "1h") {
      onClearLogs({
        mode: "before",
        cutoffTimestamp: Date.now() - 60 * 60 * 1000,
      });
    } else {
      // "before" (ก่อนเวลาที่ระบุ)
      const targetTime = new Date(customDateTime).getTime() + 59999;
      if (!isNaN(targetTime)) {
        onClearLogs({
          mode: "before",
          cutoffTimestamp: targetTime,
        });
      }
    }
    setShowClearPanel(false);
  };

  const getLogColor = (type: LogEntry["type"]) => {
    switch (type) {
      case "SYSTEM":
        return "#9bcbaa";
      case "SUCCESS":
        return "#4ade80";
      case "CMD":
        return "#38bdf8";
      case "WARN":
        return "#facc15";
      case "ERROR":
        return "#f87171";
      case "INFO":
      default:
        return "#cbd5e1";
    }
  };

  return (
    <section className={styles.card} aria-labelledby="activity-log-heading">
      <div className={styles.head}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Terminal size={16} className={styles.accent} />
          <h2 id="activity-log-heading" style={{ margin: 0, fontSize: "14px" }}>
            {t.logs}
          </h2>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span className={styles.pill}>{logs.length} EVENTS</span>
          <button
            type="button"
            className={styles.btnClearLogTrigger}
            onClick={() => setShowClearPanel((prev) => !prev)}
            title={t.clearLogTitle}
            aria-expanded={showClearPanel}
          >
            <Trash2 size={12} />
            <span>{t.clearLog}</span>
          </button>
        </div>
      </div>

      {/* แผงควบคุมการล้าง Log แบบเลือกวันเวลา / ช่วงเวลา */}
      {showClearPanel && (
        <div className={styles.logClearPanel}>
          <div className={styles.logClearHeader}>
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <Calendar size={13} color="#ffcc00" />
              <span>{t.clearLogTitle}</span>
            </div>
            <button
              type="button"
              className={styles.btnClosePanel}
              onClick={() => setShowClearPanel(false)}
              aria-label="Close"
            >
              <X size={13} />
            </button>
          </div>

          {/* ปุ่มด่วน (Quick Presets & Modes) */}
          <div className={styles.quickChips}>
            <button
              type="button"
              className={`${styles.chip} ${
                clearMode === "all" ? styles.chipActive : ""
              }`}
              onClick={() => setClearMode("all")}
            >
              {t.clearAll}
            </button>
            <button
              type="button"
              className={`${styles.chip} ${
                clearMode === "5m" ? styles.chipActive : ""
              }`}
              onClick={() => {
                setClearMode("5m");
                setCustomDateTime(
                  formatDateTimeLocal(new Date(Date.now() - 5 * 60 * 1000))
                );
              }}
            >
              {t.clearBefore5m}
            </button>
            <button
              type="button"
              className={`${styles.chip} ${
                clearMode === "1h" ? styles.chipActive : ""
              }`}
              onClick={() => {
                setClearMode("1h");
                setCustomDateTime(
                  formatDateTimeLocal(new Date(Date.now() - 60 * 60 * 1000))
                );
              }}
            >
              {t.clearBefore1h}
            </button>
            <button
              type="button"
              className={`${styles.chip} ${
                clearMode === "before" ? styles.chipActive : ""
              }`}
              onClick={() => {
                setClearMode("before");
                setCustomDateTime(formatDateTimeLocal(new Date()));
              }}
            >
              {t.clearCustom}
            </button>
            <button
              type="button"
              className={`${styles.chip} ${
                clearMode === "range" ? styles.chipActive : ""
              }`}
              onClick={() => {
                const now = new Date();
                setClearMode("range");
                setRangeEnd(formatDateTimeLocal(now));
                setRangeStart(
                  formatDateTimeLocal(new Date(now.getTime() - 30 * 60 * 1000))
                );
              }}
            >
              {t.clearRange}
            </button>
          </div>

          {/* โหมดเลือกช่วงเวลา (ตั้งแต่ ... ถึง ...) */}
          {clearMode === "range" && (
            <div className={styles.rangeRow}>
              <div className={styles.rangeField}>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <Clock size={11} color="#8b99a3" />
                  <span style={{ fontSize: "11px", color: "#b8c4cc" }}>
                    {t.rangeFrom}
                  </span>
                </div>
                <input
                  type="datetime-local"
                  value={rangeStart}
                  onChange={(e) => setRangeStart(e.target.value)}
                  className={styles.dateInput}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", paddingBottom: "2px" }}>
                <ArrowRight size={13} color="#637585" />
              </div>

              <div className={styles.rangeField}>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <Clock size={11} color="#8b99a3" />
                  <span style={{ fontSize: "11px", color: "#b8c4cc" }}>
                    {t.rangeTo}
                  </span>
                </div>
                <input
                  type="datetime-local"
                  value={rangeEnd}
                  onChange={(e) => setRangeEnd(e.target.value)}
                  className={styles.dateInput}
                />
              </div>
            </div>
          )}

          {/* โหมดเลือกล้างก่อนเวลาที่ระบุ (Before) */}
          {clearMode !== "all" && clearMode !== "range" && (
            <div className={styles.customDateRow}>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <Clock size={12} color="#8b99a3" />
                <span style={{ fontSize: "11px", color: "#b8c4cc" }}>
                  {t.clearBeforeLabel}
                </span>
              </div>
              <input
                type="datetime-local"
                value={customDateTime}
                onChange={(e) => setCustomDateTime(e.target.value)}
                className={styles.dateInput}
              />
            </div>
          )}

          {/* ปุ่มคำสั่ง ยืนยัน / ยกเลิก */}
          <div className={styles.logClearActions}>
            <button
              type="button"
              className={styles.btnConfirmClear}
              onClick={handleExecuteClear}
            >
              <Trash2 size={12} />
              <span>
                {clearMode === "range"
                  ? t.clearConfirmRange
                  : t.clearConfirm}
              </span>
            </button>
            <button
              type="button"
              className={styles.btnCancelClear}
              onClick={() => setShowClearPanel(false)}
            >
              {t.clearCancel}
            </button>
          </div>
        </div>
      )}

      {/* กล่องแสดงรายการ Log */}
      <div
        ref={logContainerRef}
        className={styles.log}
        role="log"
        aria-live="polite"
      >
        {logs.length === 0 ? (
          <div
            style={{
              color: "#64748b",
              fontStyle: "italic",
              padding: "12px 6px",
              textAlign: "center",
              fontSize: "11.5px",
            }}
          >
            {lang === "th"
              ? "ไม่มีประวัติการทำงาน (ล้างประวัติแล้ว)"
              : "No activity records (History cleared)"}
          </div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "6px",
                lineHeight: 1.45,
              }}
            >
              <span style={{ color: "#64748b", flexShrink: 0 }}>[{log.time}]</span>
              <span
                style={{
                  color: getLogColor(log.type),
                  fontWeight: 650,
                  flexShrink: 0,
                }}
              >
                [{log.type}]
              </span>
              <span style={{ color: "#e2e8f0" }}>{log.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
};
