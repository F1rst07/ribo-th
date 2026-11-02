import { NextRequest, NextResponse } from "next/server";
import { unoqApiUrl } from "@/lib/unoqEndpoint";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const requestedIp = (searchParams.get("ip") || process.env.NEXT_PUBLIC_UNOQ_IP || "172.20.10.3").trim();

  const targetUrls = [
    unoqApiUrl(requestedIp, "stream", "/camera/stream"),
  ];

  for (const url of targetUrls) {
    const controller = new AbortController();
    // Limit the wait for headers, not the lifetime of the live video feed.
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const resp = await fetch(url, {
        signal: AbortSignal.any([request.signal, controller.signal]),
        cache: "no-store",
      });
      clearTimeout(timeout);

      if (resp.ok && resp.body && resp.headers.get("Content-Type")?.includes("multipart/x-mixed-replace")) {
        return new Response(resp.body, {
          headers: {
            "Content-Type": resp.headers.get("Content-Type") || "multipart/x-mixed-replace; boundary=frame",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
            Expires: "0",
          },
        });
      }
      await resp.body?.cancel();
    } catch {} finally {
      clearTimeout(timeout);
    }
  }

  return NextResponse.json(
    { error: "No video stream available from Arduino UNO Q" },
    { status: 503 }
  );
}
