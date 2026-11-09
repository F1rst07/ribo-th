import { NextRequest, NextResponse } from "next/server";
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

function isFormPost(request: NextRequest): boolean {
  const contentType = request.headers.get("content-type") || "";
  return (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  );
}

async function applyBoardWifi(
  ssid: string,
  password: string | undefined,
  boardIp: string,
  applyOnDevice: boolean
) {
  if (isRunningOnUnoQHost()) {
    return applyWifiOnDevice(ssid, password);
  }
  const host = boardIp || (await discoverBoardOnLan()).ip || "";
  if (host && applyOnDevice) {
    return pushWifiToBoard(ssid, password, host);
  }
  return connectUnoQWifi(ssid, password);
}

export async function POST(request: NextRequest) {
  if (!isSameRequestOrigin(request)) {
    return jsonWithCors(request, { success: false, message: "Forbidden" }, { status: 403 });
  }

  const form = isFormPost(request);
  let ssid = "";
  let password: string | undefined;
  let boardIp = "";
  let applyOnDevice = true;

  if (form) {
    const data = await request.formData();
    ssid = String(data.get("ssid") || "").trim();
    const rawPassword = String(data.get("password") || "");
    password = rawPassword.trim() ? rawPassword : undefined;
    boardIp = String(data.get("boardIp") || "").trim();
  } else {
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
    ssid = String(body.ssid || "").trim();
    password = body.password != null ? String(body.password) : undefined;
    boardIp = String(body.boardIp || "").trim();
    applyOnDevice = body.applyOnDevice !== false;
  }

  const result = await applyBoardWifi(ssid, password, boardIp, applyOnDevice);
  if (form) {
    const dest = new URL("/", request.url);
    dest.searchParams.set("wifi", result.success ? "ok" : "err");
    return NextResponse.redirect(dest, 303);
  }
  return jsonWithCors(request, result, { status: result.success ? 200 : 502 });
}
