import { NextRequest, NextResponse } from "next/server";
import { unoqApiUrl } from "@/lib/unoqEndpoint";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const requestedIp = (searchParams.get("ip") || process.env.NEXT_PUBLIC_UNOQ_IP || "172.20.10.3").trim();

  const targetUrls = [
    unoqApiUrl(requestedIp, "status", "/api/health"),
  ];

  for (const url of targetUrls) {
    try {
      const resp = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(1500),
        cache: "no-store",
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data.status !== "ok" || !data.platform?.includes("Arduino UNO Q")) continue;
        return NextResponse.json({
          connected: true,
          targetUrl: url,
          ip: requestedIp,
          ...data,
        });
      }
    } catch {
      // Try next candidate
    }
  }

  return NextResponse.json(
    {
      connected: false,
      ip: requestedIp,
      error: `Cannot reach Arduino UNO Q at ${requestedIp}:8000`,
    },
    { status: 200 }
  );
}
