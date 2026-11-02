"use client";

import React from "react";
import { Translations } from "./translations";
import styles from "./dashboard.module.css";

interface DetectionSummaryProps {
  t: Translations;
  totalDetected?: number;
}

export const DetectionSummary: React.FC<DetectionSummaryProps> = ({
  totalDetected = 0,
}) => {
  return (
    <span className={styles.pill}>
      {totalDetected} DETECTED
    </span>
  );
};
