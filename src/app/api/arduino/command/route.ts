import { NextRequest, NextResponse } from "next/server";
import { isSameRequestOrigin, unoqApiUrl } from "@/lib/unoqEndpoint";

export async function POST(request: NextRequest) {
  if (!isSameRequestOrigin(request)) {
    return NextResponse.json({ success: false, error: "Invalid origin" }, { status: 403 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const command = body.command || "";
    const requestedIp = (body.ip || process.env.NEXT_PUBLIC_UNOQ_IP || "172.20.10.3").trim();

    // Priority targets:
    // 1. Target Wi-Fi IP on port 8000
    // 2. Local ADB port forward 8001 / 8000 if running locally
    const targetUrls = [
      unoqApiUrl(requestedIp, "command", "/api/command"),
    ];

    let lastError: any = null;

    for (const url of targetUrls) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!resp.ok) {
          return NextResponse.json(await resp.json(), { status: resp.status });
        }

        if (resp.ok) {
          const data = await resp.json();
          return NextResponse.json({
            success: true,
            targetUrl: url,
            ...data,
          });
        }
      } catch (err) {
        lastError = err;
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: `Could not send command to Arduino UNO Q at ${requestedIp}:8000`,
        details: lastError?.message,
      },
      { status: 502 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
