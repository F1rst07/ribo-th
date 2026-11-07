import { NextRequest, NextResponse } from "next/server";
import { unoqApiUrl } from "@/lib/unoqEndpoint";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const requestedIp = (
    searchParams.get("ip") ||
    process.env.NEXT_PUBLIC_UNOQ_IP ||
    "172.20.10.3"
  ).trim();

  const targetUrls = [
    unoqApiUrl(requestedIp, "camera", "/camera/status"),
  ];

  for (const url of targetUrls) {
    try {
      const resp = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(900),
        cache: "no-store",
      });

      if (resp.ok) {
        const data = await resp.json();
        if (typeof data.active !== "boolean") continue;
        return NextResponse.json({
          ...data,
          streamUrl: `/api/arduino/stream?ip=${encodeURIComponent(requestedIp)}`,
        });
      }
    } catch {}
  }

  return NextResponse.json(
    {
      active: false,
      deviceName: "Logitech C270",
      error: "Camera service not reachable",
    },
    { status: 200 }
  );
}
