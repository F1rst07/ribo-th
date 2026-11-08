import { NextRequest } from "next/server";
import { corsPreflightResponse, jsonWithCors } from "@/lib/cors";
import { connectUnoQWifi, discoverBoardOnLan, readUnoQLanStatus } from "@/lib/unoqAdb";
import { isSameRequestOrigin } from "@/lib/unoqEndpoint";
import { applyWifiOnDevice, isRunningOnUnoQHost } from "@/lib/unoqWifiOnDevice";
import { pushWifiToBoard } from "@/lib/pushWifiToBoard";

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(request: NextRequest) {
  const status = await readUnoQLanStatus();
  return jsonWithCors(request, status);
}

export async function POST(request: NextRequest) {
  if (!isSameRequestOrigin(request)) {
    return jsonWithCors(request, { success: false, message: "Forbidden" }, { status: 403 });
  }

  let body: {
    ssid?: string;
    password?: string;
    boardIp?: string;
    applyOnDevice?: boolean;
  } = {};
  try {
    body = await request.json();
  } catch {
    return jsonWithCors(request, { success: false, message: "Invalid JSON" }, { status: 400 });
  }

  const ssid = String(body.ssid || "").trim();
  const password = body.password != null ? String(body.password) : undefined;

  if (isRunningOnUnoQHost()) {
    const result = await applyWifiOnDevice(ssid, password);
    return jsonWithCors(request, result, { status: result.success ? 200 : 502 });
  }

  const boardIp =
    String(body.boardIp || "").trim() ||
    (await discoverBoardOnLan()).ip ||
    "";

  if (boardIp && body.applyOnDevice !== false) {
    const remote = await pushWifiToBoard(ssid, password, boardIp);
    return jsonWithCors(request, remote, { status: remote.success ? 200 : 502 });
  }

  const result = await connectUnoQWifi(ssid, password);
  return jsonWithCors(request, result, { status: result.success ? 200 : 502 });
}
