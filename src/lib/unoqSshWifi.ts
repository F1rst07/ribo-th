import { execFile } from "child_process";
import { existsSync } from "fs";
import { promisify } from "util";
import type { PushWifiResult } from "@/lib/pushWifiToBoard";

const execFileAsync = promisify(execFile);

function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function parseWlanIp(output: string): string | undefined {
  const match = output.match(/inet (\d+\.\d+\.\d+\.\d+)\/\d+/);
  return match?.[1];
}

/** Dev Mac only: set RIBO_UNOQ_SSH_PASSWORD in .env.local (never commit). */
export async function applyWifiViaSsh(
  boardIp: string,
  ssid: string,
  wifiPassword?: string
): Promise<PushWifiResult | null> {
  const sshPass = process.env.RIBO_UNOQ_SSH_PASSWORD?.trim();
  if (!sshPass) return null;
  if (!existsSync("/usr/bin/expect")) return null;

  const user = process.env.RIBO_UNOQ_SSH_USER?.trim() || "arduino";
  const host = boardIp.trim();
  if (!host || !ssid.trim()) return null;

  const pwd = wifiPassword?.trim();
  const nmcli = pwd
    ? `nmcli device wifi connect ${shSingleQuote(ssid)} password ${shSingleQuote(pwd)}`
    : `nmcli device wifi connect ${shSingleQuote(ssid)}`;
  const remote = `${nmcli} 2>&1; sleep 2; ip -4 -o addr show wlan0 2>/dev/null`;

  const expectScript = `
set timeout 45
spawn ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no ${user}@${host} ${shSingleQuote(remote)}
expect {
  -re "(?i)password:" { send "$env(RIBO_SSH_PASS)\\r"; exp_continue }
  eof
}
`;

  try {
    const { stdout, stderr } = await execFileAsync("/usr/bin/expect", ["-c", expectScript], {
      env: { ...process.env, RIBO_SSH_PASS: sshPass },
      maxBuffer: 512 * 1024,
      timeout: 50000,
    });
    const out = `${stdout || ""}\n${stderr || ""}`;
    if (/Permission denied/i.test(out)) {
      return {
        success: false,
        message: "SSH ไม่ผ่าน — ตรวจ RIBO_UNOQ_SSH_PASSWORD ใน .env.local",
      };
    }
    if (/successfully activated|Connection.*successfully/i.test(out)) {
      const wlanIp = parseWlanIp(out);
      return {
        success: true,
        wlanIp,
        message: wlanIp
          ? `ตั้ง Wi-Fi บนบอร์ดแล้ว (IP ${wlanIp})`
          : `ตั้ง Wi-Fi ${ssid.trim()} บนบอร์ดแล้ว`,
      };
    }
    const tail = out.trim().split("\n").slice(-3).join(" ").trim();
    return {
      success: false,
      message: tail || "ตั้ง Wi-Fi ผ่าน SSH ไม่สำเร็จ",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "SSH Wi-Fi failed";
    return { success: false, message };
  }
}
