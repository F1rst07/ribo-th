import { NextRequest } from "next/server";
import { corsPreflightResponse, jsonWithCors, withCors } from "@/lib/cors";
import { resolveUnoQHost, unoqApiUrl } from "@/lib/unoqEndpoint";

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const requestedIp = (
    searchParams.get("ip") ||
    process.env.NEXT_PUBLIC_UNOQ_IP ||
    "172.20.10.3"
  ).trim();

  const targetHost = await resolveUnoQHost(requestedIp);
  const targetUrls = [
    unoqApiUrl(targetHost, "snapshot", "/api/snapshot"),
  ];

  for (const url of targetUrls) {
    try {
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(6000),
        cache: "no-store",
      });

      if (resp.ok && resp.body) {
        return withCors(
          request,
          new Response(resp.body, {
            headers: {
              "Content-Type": "image/jpeg",
              "Cache-Control": "no-cache, no-store, must-revalidate",
              Pragma: "no-cache",
              Expires: "0",
            },
          })
        );
      }
    } catch {}
  }

  return jsonWithCors(
    request,
    { error: "No snapshot available from Arduino UNO Q" },
    { status: 503 }
  );
}
