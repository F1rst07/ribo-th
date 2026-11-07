import type { Metadata } from "next";
import { DashboardView } from "@/components/dashboard/DashboardView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "RIBO-TH — Robot Control System",
  description: "ระบบควบคุมเรือหุ่นยนต์อัตโนมัติ RIBO-TH",
  robots: {
    index: false,
    follow: false,
  },
};

export default function HomePage() {
  return (
    <DashboardView
      controlAvailable={process.env.RIBO_DEVICE_MODE !== "true"}
      macAiMode={process.env.RIBO_MAC_AI === "true"}
    />
  );
}
