import { NextRequest } from "next/server";
import { corsPreflightResponse, jsonWithCors } from "@/lib/cors";
import { isSameRequestOrigin, unoqApiUrl } from "@/lib/unoqEndpoint";

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function POST(request: NextRequest) {
  if (!isSameRequestOrigin(request)) {
    return jsonWithCors(
      request,
      { success: false, error: "Invalid origin" },
      { status: 403 }
    );
  }
  try {
    const body = await request.json().catch(() => ({}));
    const command = body.command || "";
    const requestedIp = (body.ip || process.env.NEXT_PUBLIC_UNOQ_IP || "172.20.10.3").trim();

    const targetUrls = [unoqApiUrl(requestedIp, "command", "/api/command")];

    let lastError: unknown = null;

    for (const url of targetUrls) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command,
            ssid: body.ssid,
            password: body.password,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!resp.ok) {
          return jsonWithCors(request, await resp.json(), { status: resp.status });
        }

        const data = await resp.json();
        return jsonWithCors(request, {
          success: true,
          targetUrl: url,
          ...data,
        });
      } catch (err) {
        lastError = err;
      }
    }

    return jsonWithCors(
      request,
      {
        success: false,
        error: `Could not send command to Arduino UNO Q at ${requestedIp}:8000`,
        details: lastError instanceof Error ? lastError.message : undefined,
      },
      { status: 502 }
    );
  } catch (err: unknown) {
    return jsonWithCors(
      request,
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
