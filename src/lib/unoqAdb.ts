import { execFile } from "child_process";
import { lookup } from "dns/promises";
import { promisify } from "util";
import { resolveAdbPath } from "./adbPath";
import { probeUnoQHealth } from "./unoqBoardProbe";

const execFileAsync = promisify(execFile);

export type UnoQAdbDevice = {
  serial: string;
  state: string;
  product?: string;
};

export type UnoQWifiStatus = {
  adbPath: string | null;
  adbError?: string;
  devices: UnoQAdbDevice[];
  ready: boolean;
  wlanIp?: string;
  wifiSsid?: string;
  hostname?: string;
};

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

async function adbShell(command: string, timeoutMs = 12000): Promise<string> {
  const adb = resolveAdbPath();
  if (!adb) throw new Error("ADB not found");
  const { stdout } = await execFileAsync(adb, ["shell", command], {
    timeout: timeoutMs,
    maxBuffer: 1024 * 512,
  });
  return stdout.trim();
}

export async function listUnoQAdbDevices(): Promise<{
  adbPath: string | null;
  devices: UnoQAdbDevice[];
  error?: string;
}> {
  const adbPath = resolveAdbPath();
  if (!adbPath) {
    return { adbPath: null, devices: [], error: "ไม่พบ adb บนคอมพิวเตอร์" };
  }
  try {
    const { stdout } = await execFileAsync(adbPath, ["devices", "-l"], { timeout: 1500 });
    const devices: UnoQAdbDevice[] = [];
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("List of devices")) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) continue;
      const [serial, state] = parts;
      if (state === "offline" || serial.startsWith("*")) continue;
      const product = trimmed.match(/product:(\S+)/)?.[1];
      devices.push({ serial, state, product });
    }
    return { adbPath, devices };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "ADB failed";
    return { adbPath, devices: [], error: message };
  }
}

const LAN_NAMES = ["KPhiraphat.local", "kphiraphat.local"];
let lanCache: { ip: string; hostname: string; at: number } | null = null;

async function lookupLanName(hostname: string): Promise<{ ip: string; hostname: string }> {
  const found = await lookup(hostname, { family: 4 });
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(found.address)) {
    throw new Error("no ipv4");
  }
  return { ip: found.address, hostname };
}

/** mDNS lookup; cached IP is kept only while the board still answers health checks. */
export async function discoverBoardOnLan(): Promise<{ ip?: string; hostname?: string }> {
  let candidate: { ip: string; hostname: string } | null = null;

  try {
    const found = await Promise.any(
      LAN_NAMES.map((hostname) =>
        Promise.race([
          lookupLanName(hostname),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("lookup timeout")), 700);
          }),
        ])
      )
    );
    candidate = found;
    if (await probeUnoQHealth(found.ip, 700)) {
      lanCache = { ...found, at: Date.now() };
      return found;
    }
  } catch {
    if (lanCache && Date.now() - lanCache.at < 120_000) {
      candidate = { ip: lanCache.ip, hostname: lanCache.hostname };
      if (await probeUnoQHealth(candidate.ip, 700)) {
        return candidate;
      }
    }
  }

  lanCache = null;
  return candidate && (await probeUnoQHealth(candidate.ip, 700)) ? candidate : {};
}

/** Dashboard poll path: LAN only. ADB is not on this path. */
export async function readUnoQLanStatus(): Promise<
  UnoQWifiStatus & { boardReachable?: boolean }
> {
  const lan = await discoverBoardOnLan();
  const boardReachable = Boolean(lan.ip);
  return {
    adbPath: null,
    devices: [],
    ready: false,
    wlanIp: boardReachable ? lan.ip : undefined,
    hostname: lan.hostname,
    boardReachable,
  };
}

export async function readUnoQWifiStatus(): Promise<UnoQWifiStatus> {
  const [listed, lan] = await Promise.all([
    listUnoQAdbDevices(),
    discoverBoardOnLan(),
  ]);
  const ready = listed.devices.some((d) => d.state === "device");
  const base: UnoQWifiStatus = {
    adbPath: listed.adbPath,
    adbError: listed.error,
    devices: listed.devices,
    ready,
    wlanIp: lan.ip,
    hostname: lan.hostname,
  };
  if (!ready) return base;

  try {
    const ipRaw = await adbShell(
      "ip -4 -o addr show wlan0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1"
    );
    if (ipRaw && /^\d+\.\d+\.\d+\.\d+$/.test(ipRaw)) {
      base.wlanIp = ipRaw;
    }
  } catch {}

  try {
    const ssidRaw = await adbShell(
      "nmcli -t -f ACTIVE,SSID dev wifi 2>/dev/null | grep '^yes:' | head -1 | cut -d: -f2-"
    );
    if (ssidRaw) base.wifiSsid = ssidRaw;
  } catch {}

  return base;
}

export async function connectUnoQWifi(
  ssid: string,
  password?: string
): Promise<{ success: boolean; wlanIp?: string; message: string }> {
  const listed = await listUnoQAdbDevices();
  if (!listed.devices.some((d) => d.state === "device")) {
    return {
      success: false,
      message:
        "ไม่พบบอร์ดผ่าน USB/ADB — ใช้สาย USB-C ต่อตรงกับ Mac รอบอร์ดบูตเสร็จ (LED เป็นจังหวะหัวใจ) แล้วลองใหม่",
    };
  }

  const trimmedSsid = ssid.trim();
  if (!trimmedSsid) {
    return { success: false, message: "กรุณาระบุชื่อ Wi-Fi (SSID)" };
  }

  const pwd = password?.trim();
  const connectCmd =
    pwd && pwd.length > 0
      ? `sudo -n nmcli device wifi connect ${shellQuote(trimmedSsid)} password ${shellQuote(pwd)}`
      : `sudo -n nmcli device wifi connect ${shellQuote(trimmedSsid)}`;

  try {
    const out = await adbShell(connectCmd, 25000);
    await new Promise((r) => setTimeout(r, 2500));
    const status = await readUnoQWifiStatus();
    if (status.wlanIp) {
      return {
        success: true,
        wlanIp: status.wlanIp,
        message: out || `เชื่อม Wi-Fi ${trimmedSsid} สำเร็จ (IP ${status.wlanIp})`,
      };
    }
    if (status.wifiSsid && status.wifiSsid === trimmedSsid) {
      return {
        success: true,
        message: out || `เชื่อม Wi-Fi ${trimmedSsid} แล้ว — กำลังรอ IP`,
      };
    }
    return {
      success: false,
      message:
        out ||
        "สั่งเชื่อม Wi-Fi แล้วแต่ยังไม่มี IP — ถ้า sudo ไม่ผ่าน ให้ตั้งรหัสผ่าน linux บนบอร์ดหรือรันคำสั่ง nmcli บนเครื่องบอร์ด",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Wi-Fi setup failed";
    if (/sudo|password|authentication/i.test(message)) {
      return {
        success: false,
        message:
          "sudo บนบอร์ดไม่ผ่าน — เปิดเทอร์มินัลบนบอร์ดแล้วรัน nmcli เอง หรือตั้ง sudo ให้ user arduino",
      };
    }
    return { success: false, message };
  }
}
