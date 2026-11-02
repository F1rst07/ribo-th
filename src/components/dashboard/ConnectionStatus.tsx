"use client";

import React from "react";
import { Cpu, Camera, Zap, Unplug, Loader2 } from "lucide-react";
import { Language, Translations } from "./translations";
import styles from "./dashboard.module.css";

interface ConnectionStatusProps {
  t: Translations;
  isConnected: boolean;
  cameraConnected: boolean;
  cameraName: string;
  isWifiStream?: boolean;
  isConnecting: boolean;
  onToggleConnect: () => void;
  lang: Language;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  t,
  isConnected,
  cameraConnected,
  cameraName,
  isWifiStream = false,
  isConnecting,
  onToggleConnect,
  lang,
}) => {
  return (
    <section className={styles.statusGrid} aria-label="Connection Status">
      {/* การ์ด Arduino UNO Q */}
      <div className={styles.statusCard}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "6px",
          }}
        >
          <div className={styles.statusHeader}>
            <Cpu size={16} color="#ffcc00" />
            <span>Arduino UNO Q</span>
          </div>

          <button
            type="button"
            className={`${styles.btn} ${
              isConnected ? styles.btnConnected : styles.btnConnect
            }`}
            onClick={onToggleConnect}
            disabled={isConnecting}
            title={isConnected ? t.disconnect : t.connect}
          >
            {isConnecting ? (
              <>
                <Loader2 size={12} className={styles.spin} />
                <span>{t.connecting}</span>
              </>
            ) : isConnected ? (
              <>
                <Unplug size={12} />
                <span>{t.disconnect}</span>
              </>
            ) : (
              <>
                <Zap size={12} />
                <span>{t.connect}</span>
              </>
            )}
          </button>
        </div>

        <div className={styles.offline}>
          <span
            className={isConnected ? styles.onlineDot : styles.offlineDot}
            aria-hidden="true"
          />
          <span
            style={
              isConnected ? { color: "#4ade80", fontWeight: 600 } : undefined
            }
          >
            {isConnected ? t.connected : t.offline}
          </span>
        </div>
      </div>

      {/* สถานะกล้องจาก MediaStream ที่เปิดอยู่จริง */}
      <div className={styles.statusCard}>
        <div className={styles.statusHeader}>
          <Camera size={16} color="#ffcc00" />
          <span>{cameraName}</span>
        </div>
        <div className={styles.offline}>
          <span
            className={cameraConnected ? styles.onlineDot : styles.offlineDot}
            aria-hidden="true"
          />
          <span
            style={
              cameraConnected ? { color: "#4ade80", fontWeight: 600 } : undefined
            }
          >
            {cameraConnected
              ? isWifiStream
                ? lang === "th"
                  ? "เปิดกล้องแล้ว (Wi-Fi)"
                  : "Camera Active (Wi-Fi)"
                : t.cameraActive
              : t.offline}
          </span>
        </div>
      </div>
    </section>
  );
};
