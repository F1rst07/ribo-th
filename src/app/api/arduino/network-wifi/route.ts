import { NextRequest, NextResponse } from "next/server";
import { isSameRequestOrigin } from "@/lib/unoqEndpoint";
import { discoverBoardOnLan } from "@/lib/unoqAdb";
import { pushWifiToBoard } from "@/lib/pushWifiToBoard";

export async function POST(request: NextRequest) {
  if (!isSameRequestOrigin(request)) {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }

  let body: { ssid?: string; password?: string; ip?: string; boardIp?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON" }, { status: 400 });
  }

  const ssid = String(body.ssid || "").trim();
  const password = body.password != null ? String(body.password) : undefined;
  const requestedIp =
    String(body.boardIp || body.ip || "").trim() || (await discoverBoardOnLan()).ip || "";

  if (!requestedIp) {
    return NextResponse.json(
      { success: false, message: "ต้องระบุ IP บอร์ดหรือค้นหาบอร์ดก่อน" },
      { status: 400 }
    );
  }

  const result = await pushWifiToBoard(ssid, password, requestedIp);
  return NextResponse.json(result, { status: result.success ? 200 : 502 });
}
