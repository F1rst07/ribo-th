import { NextRequest } from "next/server";
import { corsPreflightResponse, jsonWithCors } from "@/lib/cors";
import { resolveUnoQHost, unoqApiUrl, unoqHost } from "@/lib/unoqEndpoint";
import { isUnoQHealthPayload } from "@/lib/unoqBoardProbe";

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const requestedIp = (
    searchParams.get("ip") ||
    process.env.NEXT_PUBLIC_UNOQ_IP ||
    ""
  ).trim();

  if (!requestedIp) {
    return jsonWithCors(
      request,
      {
        connected: false,
        ip: "",
        error: "Board IP is required",
      },
      { status: 200 }
    );
  }

  const targetHost = await resolveUnoQHost(requestedIp);
  const host = unoqHost(targetHost);
  const onDevice = process.env.RIBO_DEVICE_MODE === "true";
  const targetUrls = onDevice
    ? [`http://${host}:8000/api/health`]
    : [
        `http://${host}:3000/api/arduino/status?ip=${encodeURIComponent(requestedIp)}`,
        unoqApiUrl(targetHost, "status", "/api/health"),
        `http://${host}:8000/api/health`,
      ];

  for (const url of targetUrls) {
    try {
      const resp = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(2200),
        cache: "no-store",
      });

      if (resp.ok) {
        const data = await resp.json();
        if (!isUnoQHealthPayload(data)) continue;
        const board = { ...data } as Record<string, unknown>;
        delete board.ip;
        return jsonWithCors(request, {
          connected: true,
          targetUrl: url,
          ...board,
          ip: requestedIp,
        });
      }
    } catch {
      // Try next candidate
    }
  }

  return jsonWithCors(
    request,
    {
      connected: false,
      ip: requestedIp,
      error: `UNO Q is not answering at ${requestedIp}`,
    },
    { status: 200 }
  );
}
