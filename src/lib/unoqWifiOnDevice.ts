import { execFile } from "child_process";
import { existsSync, readFileSync } from "fs";
import os from "os";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Wi-Fi address of this process when it is running on the UNO Q itself. */
export function deviceLanAddress(): string | undefined {
  if (!isRunningOnUnoQHost()) return undefined;
  const nets = os.networkInterfaces();
  const names = ["wlan0", ...Object.keys(nets)];
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (name === "lo" || /^(usb|rndis|docker|br-)/.test(name)) continue;
    for (const addr of nets[name] || []) {
      const ip = addr.address;
      if (addr.family !== "IPv4" || addr.internal) continue;
      if (ip.startsWith("192.168.") || ip.startsWith("10.")) return ip;
    }
  }
  return undefined;
}

export function isRunningOnUnoQHost(): boolean {
  if (process.env.RIBO_DEVICE_MODE === "true") return true;
  if (process.platform !== "linux") return false;
  try {
    const model = readFileSync("/proc/device-tree/model", "utf8");
    return /arduino/i.test(model);
  } catch {
    return existsSync("/home/arduino");
  }
}

export async function applyWifiOnDevice(
  ssid: string,
  password?: string
): Promise<{ success: boolean; message: string; wlanIp?: string }> {
  const trimmedSsid = ssid.trim();
  if (!trimmedSsid) {
    return { success: false, message: "กรุณาระบุชื่อ Wi-Fi" };
  }

  const pwd = password?.trim();
  const baseArgs = pwd
    ? ["device", "wifi", "connect", trimmedSsid, "password", pwd]
    : ["device", "wifi", "connect", trimmedSsid];

  let lastError = "";
  for (const cmd of [["nmcli", baseArgs], ["sudo", ["-n", "nmcli", ...baseArgs]]]) {
    try {
      const [bin, args] = cmd as [string, string[]];
      const { stdout, stderr } = await execFileAsync(bin, args, { timeout: 30000 });
      await new Promise((r) => setTimeout(r, 2000));
      let wlanIp: string | undefined;
      try {
        const { stdout: ipOut } = await execFileAsync("bash", [
          "-lc",
          "ip -4 -o addr show wlan0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1",
        ]);
        const ip = ipOut.trim();
        if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) wlanIp = ip;
      } catch {}
      return {
        success: true,
        wlanIp,
        message: (stdout || stderr || `เชื่อม Wi-Fi ${trimmedSsid} แล้ว`) + (wlanIp ? ` (IP ${wlanIp})` : ""),
      };
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : "nmcli failed";
    }
  }

  return {
    success: false,
    message: lastError || `ตั้ง Wi-Fi ${trimmedSsid} บนบอร์ดไม่สำเร็จ`,
  };
}
