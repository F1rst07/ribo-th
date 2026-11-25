import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { corsPreflightResponse, jsonWithCors } from "@/lib/cors";
import { resolveUnoQHost } from "@/lib/unoqEndpoint";
import { parseGpsFix, simulatedGpsFix, type GpsTelemetry } from "@/lib/gpsTelemetry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FIX_AGE_MS = 5_000;

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

function reply(request: NextRequest, data: GpsTelemetry) {
  return jsonWithCors(request, data, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const now = Date.now();
  if (process.env.RIBO_GPS_MODE === "simulated") {
    return reply(request, { status: "simulated", position: simulatedGpsFix(now) });
  }

  const requestedIp = (new URL(request.url).searchParams.get("ip") || "").trim();
  if (process.env.RIBO_DEVICE_MODE !== "true" && requestedIp) {
    try {
      const host = await resolveUnoQHost(requestedIp);
      if (!["localhost", "127.0.0.1"].includes(host)) {
        const statusResp = await fetch(`http://${host}:3000/api/arduino/status?ip=127.0.0.1`, {
          cache: "no-store",
          signal: AbortSignal.timeout(4000),
        });
        if (statusResp.ok) {
          const statusData = (await statusResp.json()) as { gps?: GpsTelemetry };
          if (statusData.gps) {
            return reply(request, statusData.gps);
          }
        }
      }
    } catch {
      return reply(request, { status: "unavailable", position: null });
    }
  }

  const path = process.env.RIBO_GPS_FIX_PATH ||
    (process.env.RIBO_DEVICE_MODE === "true" && process.getuid
      ? join(tmpdir(), `ribo-gps-${process.getuid()}.json`)
      : undefined);
  if (!path) return reply(request, { status: "waiting", position: null });

  try {
    const fix = parseGpsFix(JSON.parse(await readFile(path, "utf8")));
    if (!fix || fix.observedAt > now) return reply(request, { status: "waiting", position: null });
    if (now - fix.observedAt > MAX_FIX_AGE_MS) return reply(request, { status: "stale", position: null });
    return reply(request, { status: "live", position: fix });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return reply(request, { status: "waiting", position: null });
    }
    return reply(request, { status: "unavailable", position: null });
  }
}
