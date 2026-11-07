"use client";

import React from "react";
import { Cpu, Camera, Zap, Unplug, Loader2, Wifi } from "lucide-react";
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
  boardIp: string;
  onBoardIpChange: (ip: string) => void;
  wifiSsid: string;
  onWifiSsidChange: (ssid: string) => void;
  wifiPassword: string;
  onWifiPasswordChange: (password: string) => void;
  onSetupWifi: () => void;
  isWifiSettingUp: boolean;
  adbUsbReady: boolean;
  networkHost?: string;
  statusBanner?: string;
  statusBannerTone?: "error" | "info";
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
  boardIp,
  onBoardIpChange,
  wifiSsid,
  onWifiSsidChange,
  wifiPassword,
  onWifiPasswordChange,
  onSetupWifi,
  isWifiSettingUp,
  adbUsbReady,
  networkHost,
  statusBanner,
  statusBannerTone = "info",
}) => {
  return (
    <section className={styles.statusGrid} aria-label="Connection Status">
      <div className={`${styles.statusCard} ${styles.statusCardWide}`}>
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
            disabled={isConnecting || isWifiSettingUp}
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
            className={
              isConnected
                ? cameraConnected
                  ? styles.onlineDot
                  : styles.warnDot
                : styles.offlineDot
            }
            aria-hidden="true"
          />
          <span
            style={
              isConnected
                ? {
                    color: cameraConnected ? "#4ade80" : "#fbbf24",
                    fontWeight: 600,
                  }
                : undefined
            }
          >
            {isConnected
              ? cameraConnected
                ? t.connected
                : lang === "th"
                  ? "บอร์ดเชื่อมต่อแล้ว (กล้องยังไม่ส่งภาพ)"
                  : "Board connected (camera not streaming)"
              : t.offline}
          </span>
        </div>

        <div className={styles.boardSetup}>
          <label className={styles.setupLabel}>
            <span>{t.boardIpLabel}</span>
            <input
              className={styles.setupInput}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              value={boardIp}
              onChange={(e) => onBoardIpChange(e.target.value)}
              disabled={isConnected || isConnecting}
              placeholder={lang === "th" ? "กำลังค้นหาบอร์ด..." : "Looking for the board..."}
            />
          </label>

          {adbUsbReady || !networkHost ? (
            <p className={styles.setupHint}>
              <Wifi size={12} aria-hidden />
              {adbUsbReady
                ? lang === "th"
                  ? "ตรวจพบบอร์ดผ่าน USB — ตั้ง Wi-Fi ได้จากด้านล่าง"
                  : "Board detected over USB — configure Wi-Fi below"
                : lang === "th"
                  ? "กำลังหา KPhiraphat.local บน Wi-Fi นี้ — ไม่ใช้ IP เก่าอีกแล้ว"
                  : "Looking for KPhiraphat.local on this Wi-Fi"}
            </p>
          ) : null}

          <label className={styles.setupLabel}>
            <span>{t.wifiSsidLabel}</span>
            <input
              className={styles.setupInput}
              type="text"
              autoComplete="off"
              value={wifiSsid}
              onChange={(e) => onWifiSsidChange(e.target.value)}
              disabled={isWifiSettingUp}
            />
          </label>

          <label className={styles.setupLabel}>
            <span>{t.wifiPasswordLabel}</span>
            <input
              className={styles.setupInput}
              type="password"
              autoComplete="off"
              value={wifiPassword}
              onChange={(e) => onWifiPasswordChange(e.target.value)}
              disabled={isWifiSettingUp}
              placeholder={t.wifiPasswordOptional}
            />
          </label>

          <p className={styles.setupMicro}>{t.wifiOpenNetwork}</p>

          {statusBanner ? (
            <p
              className={
                statusBannerTone === "error"
                  ? styles.setupError
                  : styles.setupInfo
              }
              role="status"
            >
              {statusBanner}
            </p>
          ) : null}

          <button
            type="button"
            className={`${styles.btn} ${styles.btnWifiSetup}`}
            onClick={onSetupWifi}
            disabled={
              isWifiSettingUp || isConnecting || !wifiSsid.trim() || !boardIp.trim()
            }
          >
            {isWifiSettingUp ? (
              <>
                <Loader2 size={12} className={styles.spin} />
                <span>{t.wifiSetupBusy}</span>
              </>
            ) : (
              <>
                <Wifi size={12} />
                <span>{t.wifiSetup}</span>
              </>
            )}
          </button>
        </div>
      </div>

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
