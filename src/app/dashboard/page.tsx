import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardView } from "@/components/dashboard/DashboardView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "RIBO-TH Dashboard — Robot Control System",
  description: "ระบบควบคุมเรือหุ่นยนต์อัตโนมัติ RIBO-TH",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DashboardPage() {
  // ระบบป้องกันความปลอดภัยฝั่งเซิร์ฟเวอร์ (Server-Side Protection):
  // ป้องกันการเข้าถึงบน Production โดยเด็ดขาดจนกว่าจะได้รับคำสั่งให้เปิดใช้งานจริง
  // หากเป็น Production จะส่ง 404 Not Found ทันที เสมือนว่าไม่มีหน้านี้อยู่
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_PUBLIC_DASHBOARD !== "true" &&
    process.env.RIBO_DEVICE_MODE !== "true"
  ) {
    notFound();
  }

  return (
    <DashboardView
      controlAvailable={process.env.RIBO_DEVICE_MODE !== "true"}
      macAiMode={process.env.RIBO_MAC_AI === "true"}
    />
  );
}
