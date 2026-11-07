import { unoqHost } from "@/lib/unoqBoardProbe";
import { unoqDirectApiUrl } from "@/lib/unoqEndpoint";
import { applyWifiViaSsh } from "@/lib/unoqSshWifi";
import { applyWifiOnDevice, isRunningOnUnoQHost } from "@/lib/unoqWifiOnDevice";

export type PushWifiResult = {
  success: boolean;
  message: string;
  wlanIp?: string;
};

export async function pushWifiToBoard(
  ssid: string,
  password: string | undefined,
  boardIp: string
): Promise<PushWifiResult> {
  if (isRunningOnUnoQHost()) {
    return applyWifiOnDevice(ssid, password);
  }

  const trimmed = ssid.trim();
  if (!trimmed) {
    return { success: false, message: "กรุณาระบุชื่อ Wi-Fi" };
  }

  const host = unoqHost(boardIp);
  const attempts: { url: string; body: Record<string, unknown> }[] = [
    {
      url: `http://${host}:3000/api/arduino/wifi`,
      body: { ssid: trimmed, password, applyOnDevice: true },
    },
    {
      url: unoqDirectApiUrl(host, "/api/network/wifi"),
      body: { ssid: trimmed, password },
    },
    {
      url: `http://${host}:3000/api/arduino/command`,
      body: { command: `WIFI:CONNECT:${trimmed}`, ssid: trimmed, password, ip: host },
    },
  ];

  let last = "";
  for (const { url, body } of attempts) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(35000),
        cache: "no-store",
      });
      const data = (await resp.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
        error?: string;
        wlanIp?: string;
      };
      if (data.success) {
        return {
          success: true,
          message: data.message || data.error || "เชื่อม Wi-Fi บนบอร์ดแล้ว",
          wlanIp: data.wlanIp,
        };
      }
      if (resp.status !== 404) {
        last = data.message || data.error || `HTTP ${resp.status}`;
      }
    } catch (err: unknown) {
      last = err instanceof Error ? err.message : "request failed";
    }
  }

  const sshResult = await applyWifiViaSsh(host, trimmed, password);
  if (sshResult) return sshResult;

  return {
    success: false,
    message:
      last ||
      "ตั้ง Wi-Fi ไม่สำเร็จ — ตรวจว่าบอร์ดออนไลน์ หรือใส่ RIBO_UNOQ_SSH_PASSWORD ใน .env.local แล้วรีสตาร์ท dev",
  };
}
