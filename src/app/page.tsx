"use client";

import { useEffect, useState } from "react";
import packageJson from "../../package.json";

const FULL_TEXT = "กำลังพัฒนาอยู่...";

// ใช้ Intl.Segmenter เพื่อแบ่งพยางค์/กลุ่มอักษรภาษาไทยอย่างถูกต้อง
// เช่น ['กำ', 'ลั', 'ง', 'พั', 'ฒ', 'น', 'า', 'อ', 'ยู่', '.', '.', '.']
const getGraphemes = (text: string): string[] => {
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter("th", { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return text.split("");
};

const GRAPHEMES = getGraphemes(FULL_TEXT);

export default function HomePage() {
  const version = `v${packageJson.version}`;
  const [index, setIndex] = useState(0);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);

    // เคารพการตั้งค่า prefers-reduced-motion ของผู้ใช้
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setIndex(GRAPHEMES.length);
      return;
    }

    let timeoutId: NodeJS.Timeout;

    if (index < GRAPHEMES.length) {
      // แสดงอักษรทีละตัว (~140ms ต่อหน่วยอักขระ)
      timeoutId = setTimeout(() => {
        setIndex((prev) => prev + 1);
      }, 140);
    } else {
      // เมื่อแสดงเต็มข้อความแล้ว ให้หน่วงเวลา 1.5 วินาที (1500ms) แล้วเริ่มวนซ้ำใหม่
      timeoutId = setTimeout(() => {
        setIndex(0);
      }, 1500);
    }

    return () => clearTimeout(timeoutId);
  }, [index]);

  const displayedText = isMounted
    ? GRAPHEMES.slice(0, index).join("")
    : FULL_TEXT;

  return (
    <div className="page">
      <div className="hazard" aria-hidden="true"></div>
      <main>
        <section className="content" aria-labelledby="status-heading">
          <div className="symbol" aria-hidden="true">
            <span className="spinning-icon">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/icons/refresh-ccw.svg"
                alt=""
                width={47}
                height={47}
              />
            </span>
          </div>
          <h1 id="status-heading" aria-label={FULL_TEXT}>
            <span aria-hidden="true">{displayedText || "\u200B"}</span>
            <span className="cursor" aria-hidden="true" />
            <span className="sr-only">{FULL_TEXT}</span>
          </h1>
          <div className="badge-group">
            <span className="tag">UNDER CONSTRUCTION</span>
            <span
              className="version-badge"
              title={`เวอร์ชันของระบบ: ${version}`}
            >
              {version}
            </span>
          </div>
          <p className="description">
            ขณะนี้เว็บไซต์อยู่ระหว่างการพัฒนาและปรับปรุงระบบ
          </p>
          <p className="apology">ขออภัยในความไม่สะดวก</p>
        </section>
      </main>
      <footer>
        <p>© 2026 RIBO-TH. All Rights Reserved.</p>
        <p className="credit">Developed by K. Phiraphatz</p>
      </footer>
    </div>
  );
}
