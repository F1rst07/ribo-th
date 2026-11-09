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

async function nmcli(args: string[]): Promise<{ ok: boolean; out: string }> {
  const attempts: Array<[string, string[]]> = [
    ["nmcli", args],
    ["sudo", ["-n", "nmcli", ...args]],
  ];
  let last = "";
  for (const [bin, argv] of attempts) {
    try {
      const { stdout, stderr } = await execFileAsync(bin, argv, { timeout: 25000 });
      return { ok: true, out: `${stdout || ""}\n${stderr || ""}`.trim() };
    } catch (err: unknown) {
      last = err instanceof Error ? err.message : "nmcli failed";
    }
  }
  return { ok: false, out: last };
}

async function connectionExists(name: string): Promise<boolean> {
  const listed = await nmcli(["-t", "-f", "NAME", "connection", "show"]);
  if (!listed.ok) return false;
  return listed.out.split("\n").some((line) => line.trim() === name);
}

/** Save a Wi-Fi profile on the board without dropping the current LAN session. */
export async function applyWifiOnDevice(
  ssid: string,
  password?: string
): Promise<{ success: boolean; message: string; wlanIp?: string }> {
  const trimmedSsid = ssid.trim();
  if (!trimmedSsid) {
    return { success: false, message: "กรุณาระบุชื่อ Wi-Fi" };
  }

  const pwd = password?.trim() || "";
  const exists = await connectionExists(trimmedSsid);
  const secArgs = pwd
    ? ["wifi-sec.key-mgmt", "wpa-psk", "wifi-sec.psk", pwd]
    : ["wifi-sec.key-mgmt", "none"];

  const saved = exists
    ? await nmcli([
        "connection",
        "modify",
        trimmedSsid,
        "connection.autoconnect",
        "yes",
        ...secArgs,
      ])
    : await nmcli([
        "connection",
        "add",
        "type",
        "wifi",
        "ifname",
        "wlan0",
        "con-name",
        trimmedSsid,
        "ssid",
        trimmedSsid,
        "connection.autoconnect",
        "yes",
        ...secArgs,
      ]);

  if (!saved.ok) {
    return {
      success: false,
      message: saved.out || `ตั้ง Wi-Fi ${trimmedSsid} บนบอร์ดไม่สำเร็จ`,
    };
  }

  let wlanIp: string | undefined;
  try {
    const { stdout: ipOut } = await execFileAsync("bash", [
      "-lc",
      "ip -4 -o addr show wlan0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1",
    ]);
    const ip = ipOut.trim();
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) wlanIp = ip;
  } catch {
    /* current IP is optional */
  }

  return {
    success: true,
    wlanIp,
    message: `บันทึกเน็ต ${trimmedSsid} บนบอร์ดแล้ว — จะเชื่อมอัตโนมัติเมื่อเจอสัญญาณ`,
  };
}
