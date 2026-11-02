"use client";

import React from "react";
import { Anchor } from "lucide-react";
import { Language, Translations } from "./translations";
import styles from "./dashboard.module.css";

interface HeaderProps {
  lang: Language;
  onLanguageChange: (lang: Language) => void;
  t: Translations;
}

export const Header: React.FC<HeaderProps> = ({
  lang,
  onLanguageChange,
  t,
}) => {
  return (
    <>
      <div className={styles.hazard} aria-hidden="true"></div>
      <div className={styles.headerBar}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <div className={styles.logo} aria-hidden="true">
              <Anchor size={24} color="#171717" strokeWidth={2.5} />
            </div>
            <div className={styles.brandText}>
              <h1>RIBO-TH</h1>
              <p>{t.subtitle}</p>
            </div>
          </div>
          <div
            className={styles.lang}
            role="group"
            aria-label="Language selection"
          >
            <button
              type="button"
              className={`${styles.langBtn} ${
                lang === "th" ? styles.langBtnActive : ""
              }`}
              onClick={() => onLanguageChange("th")}
              aria-pressed={lang === "th"}
            >
              TH
            </button>
            <button
              type="button"
              className={`${styles.langBtn} ${
                lang === "en" ? styles.langBtnActive : ""
              }`}
              onClick={() => onLanguageChange("en")}
              aria-pressed={lang === "en"}
            >
              EN
            </button>
          </div>
        </header>
      </div>
    </>
  );
};
