/** Browser opened on Vercel (or similar); API must hit the board on the LAN, not the cloud host. */

export function isMobileBrowser(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod|Android|Mobile/i.test(ua)) return true;
  return window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 900;
}

export function isCloudDashboard(): boolean {
  if (typeof window === "undefined") {
    return Boolean(process.env.VERCEL);
  }
  const h = window.location.hostname;
  if (h === "localhost" || h === "127.0.0.1") return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return false;
  if (h.endsWith(".local")) return false;
  return true;
}

export const BOARD_MDNS_HOST = "ribo-th.local";
export const CLOUD_LAUNCHER_URL = "https://ribo-th.vercel.app/";

export function isIpv4(value: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(value.trim());
}

/** DHCP numbers change; the UI always shows the stable mDNS name. */
export function boardDisplayHost(value?: string): string {
  const v = (value || "").trim();
  if (!v || isIpv4(v)) return BOARD_MDNS_HOST;
  return v;
}

export function boardSiteOrigin(host: string): string {
  return `http://${host.trim()}:3000`;
}

export function boardArduinoApi(ip: string, route: string, searchParams?: Record<string, string>): string {
  const q =
    searchParams && Object.keys(searchParams).length
      ? `?${new URLSearchParams(searchParams).toString()}`
      : "";
  if (isCloudDashboard() && ip.trim()) {
    return `${boardSiteOrigin(ip)}/api/arduino/${route}${q}`;
  }
  return `/api/arduino/${route}${q}`;
}

export function boardVisionApi(ip: string): string {
  if (isCloudDashboard() && ip.trim()) {
    return `${boardSiteOrigin(ip)}/api/vision`;
  }
  return "/api/vision";
}

const SUBNET_PREFIXES = ["192.168.100", "192.168.1", "192.168.0", "10.0.0", "172.20.10"];

export async function discoverBoardFromBrowser(): Promise<{
  found: boolean;
  ip?: string;
  source?: string;
}> {
  if (await probeBoardFromBrowser(BOARD_MDNS_HOST, 1800)) {
    return { found: true, ip: BOARD_MDNS_HOST, source: "mdns" };
  }

  const saved = typeof window !== "undefined" ? localStorage.getItem("ribo_unoq_ip") || "" : "";
  if (isIpv4(saved) || saved.endsWith(".local")) {
    const ok = await probeBoardFromBrowser(saved);
    if (ok) return { found: true, ip: saved, source: "saved" };
  }

  for (const prefix of SUBNET_PREFIXES) {
    const likely = `${prefix}.15`;
    if (await probeBoardFromBrowser(likely, 2500)) {
      return { found: true, ip: likely, source: "wifi" };
    }
  }

  return { found: false };
}

export async function probeBoardFromBrowser(ip: string, timeoutMs = 3200): Promise<boolean> {
  try {
    const url = boardArduinoApi(ip, "status", { ip });
    const resp = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      mode: "cors",
      credentials: "omit",
    });
    if (!resp.ok) return false;
    const data = await resp.json().catch(() => ({}));
    return Boolean((data as { connected?: boolean }).connected);
  } catch {
    return false;
  }
}

export const DEFAULT_BOARD_IP = BOARD_MDNS_HOST;

export function resolveBoardIp(raw: string): string {
  const host = raw.trim();
  if (isIpv4(host)) return host;
  if (host.endsWith(".local")) return host;
  return BOARD_MDNS_HOST;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 127) return false;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function sameLan(a: string, b: string): boolean {
  const pa = a.trim().split(".").map(Number);
  const pb = b.trim().split(".").map(Number);
  if (pa.length !== 4 || pb.length !== 4) return false;
  if (pa[0] === pb[0] && pa[1] === pb[1] && pa[2] === pb[2]) return true;
  if (pa[0] === 192 && pa[1] === 168 && pb[0] === 192 && pb[1] === 168 && (pa[2] >> 1) === (pb[2] >> 1)) {
    return Math.abs(pa[2] - pb[2]) <= 1;
  }
  return false;
}

export async function getBrowserLanIPv4s(): Promise<string[]> {
  if (typeof RTCPeerConnection === "undefined") return [];
  const ips = new Set<string>();
  const pc = new RTCPeerConnection({ iceServers: [] });
  try {
    pc.createDataChannel("ribo");
    const done = new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 900);
      pc.onicecandidate = (event) => {
        const line = event.candidate?.candidate || "";
        const match = line.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
        if (match && isPrivateIpv4(match[1])) ips.add(match[1]);
        if (event.candidate === null) {
          window.clearTimeout(timer);
          resolve();
        }
      };
    });
    await pc.setLocalDescription(await pc.createOffer());
    await done;
  } catch {
    return [];
  } finally {
    pc.close();
  }
  return [...ips];
}

export function mobileBoardUrl(ip: string): string {
  return `${boardSiteOrigin(resolveBoardIp(ip))}/`;
}

export function openBoardDashboard(ip: string): void {
  if (typeof window === "undefined") return;
  const resolved = resolveBoardIp(ip);
  localStorage.setItem("ribo_unoq_ip", resolved);
  window.location.assign(mobileBoardUrl(resolved));
}
