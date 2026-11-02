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
    unoqApiUrl(requestedIp, "snapshot", "/api/snapshot"),
  ];

  for (const url of targetUrls) {
    try {
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(2000),
        cache: "no-store",
      });

      if (resp.ok && resp.body) {
        return new Response(resp.body, {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
            Expires: "0",
          },
        });
      }
    } catch {}
  }

  return NextResponse.json(
    { error: "No snapshot available from Arduino UNO Q" },
    { status: 503 }
  );
}
