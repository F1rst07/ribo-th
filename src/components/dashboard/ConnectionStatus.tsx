"use client";

import React, { useState } from "react";
import { Cpu, Zap, Unplug, Loader2, ExternalLink, Wifi } from "lucide-react";
import { Language, Translations } from "./translations";
import {
  DEFAULT_BOARD_IP,
  boardDisplayHost,
  boardSiteOrigin,
  mobileBoardUrl,
} from "@/lib/clientBoardApi";
import styles from "./dashboard.module.css";

interface ConnectionStatusProps {
  t: Translations;
  isConnected: boolean;
  cameraConnected: boolean;
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
  showWifiSetup: boolean;
  adbUsbReady: boolean;
  statusBanner?: string;
  statusBannerTone?: "error" | "info";
  cloudLauncher?: boolean;
  onOpenBoard?: () => boolean | void;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  t,
  isConnected,
  cameraConnected,
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
  showWifiSetup,
  statusBanner,
  statusBannerTone = "info",
  cloudLauncher = Boolean(process.env.VERCEL),
  onOpenBoard,
}) => {
  const [wifiPanelOpen, setWifiPanelOpen] = useState(false);
  const displayIp = boardDisplayHost(boardIp);
  const boardUrl = mobileBoardUrl(displayIp || DEFAULT_BOARD_IP);
  const wifiPostUrl = `${boardSiteOrigin(displayIp || DEFAULT_BOARD_IP)}/api/arduino/wifi`;
  const openLabel = t.openBoardOnLan.replace("{url}", boardUrl);
  const wifiFields = (
    <>
      <label className={styles.setupLabel}>
        <span>{t.wifiSsidLabel}</span>
        <input
          className={styles.setupInput}
          type="text"
          name="ssid"
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
          name="password"
          autoComplete="new-password"
          value={wifiPassword}
          onChange={(e) => onWifiPasswordChange(e.target.value)}
          disabled={isWifiSettingUp}
          placeholder={t.wifiPasswordOptional}
        />
      </label>
    </>
  );

  return (
    <section className={styles.statusGrid} aria-label="Connection Status">
      <div
        className={`${styles.statusCard} ${styles.statusCardWide} ${styles.statusCardLauncher}`}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            flexWrap: "wrap",
          }}
        >
          <div className={styles.statusHeader}>
            <Cpu size={18} color="#ffcc00" />
            <span>Arduino UNO Q</span>
          </div>

          {showWifiSetup ? (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnWifiSetup}`}
              onClick={() => setWifiPanelOpen((open) => !open)}
              disabled={isWifiSettingUp || isConnecting}
            >
              <Wifi size={12} />
              <span>{t.wifiSetup}</span>
            </button>
          ) : null}
        </div>

        {cloudLauncher ? null : (
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
        )}

        <div className={styles.boardSetup}>
          <label className={styles.setupLabel}>
            <span>{t.boardIpLabel}</span>
            <input
              className={styles.setupInput}
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              value={displayIp}
              onChange={(e) => onBoardIpChange(e.target.value)}
              disabled={isConnected || isConnecting}
              placeholder={DEFAULT_BOARD_IP}
            />
          </label>

          {showWifiSetup && wifiPanelOpen ? (
            cloudLauncher ? (
              <form method="POST" action={wifiPostUrl}>
                {wifiFields}
                <button
                  type="submit"
                  className={`${styles.btn} ${styles.btnConnectionAction} ${styles.btnConnect} ${styles.btnOpenBoard}`}
                  disabled={isWifiSettingUp || !wifiSsid.trim()}
                >
                  <Wifi size={16} />
                  <span>{t.wifiSaveToBoard}</span>
                </button>
              </form>
            ) : (
              <>
                {wifiFields}
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnConnectionAction} ${styles.btnConnect} ${styles.btnOpenBoard}`}
                  onClick={onSetupWifi}
                  disabled={isWifiSettingUp || !wifiSsid.trim()}
                >
                  {isWifiSettingUp ? (
                    <>
                      <Loader2 size={16} className={styles.spin} />
                      <span>{t.wifiSetupBusy}</span>
                    </>
                  ) : (
                    <>
                      <Wifi size={16} />
                      <span>{t.wifiSaveToBoard}</span>
                    </>
                  )}
                </button>
              </>
            )
          ) : null}

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

          {cloudLauncher && !isConnected ? (
            <a
              className={`${styles.btn} ${styles.btnConnectionAction} ${styles.btnConnect} ${styles.btnOpenBoard}`}
              href={boardUrl}
              onClick={(event) => {
                const allowed = onOpenBoard?.();
                if (allowed === false) event.preventDefault();
              }}
            >
              <ExternalLink size={16} />
              <span>{openLabel}</span>
            </a>
          ) : (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnConnectionAction} ${
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
          )}
        </div>
      </div>
    </section>
  );
};
