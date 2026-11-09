"use client";

import React from "react";
import { OctagonAlert, RotateCw } from "lucide-react";
import { Translations } from "./translations";
import styles from "./dashboard.module.css";

interface EmergencyStopProps {
  isLocked: boolean;
  onToggleEmergency: () => void;
  t: Translations;
}

export const EmergencyStop: React.FC<EmergencyStopProps> = ({
  isLocked,
  onToggleEmergency,
  t,
}) => {
  return (
    <div>
      <button
        type="button"
        id="emergency"
        className={`${styles.btn} ${
          isLocked ? styles.btnReset : styles.btnDanger
        }`}
        onClick={onToggleEmergency}
        aria-live="assertive"
      >
        {isLocked ? (
          <>
            <RotateCw size={16} />
            <span>{t.reset}</span>
          </>
        ) : (
          <>
            <OctagonAlert size={16} />
            <span>{t.estop}</span>
          </>
        )}
      </button>
    </div>
  );
};
