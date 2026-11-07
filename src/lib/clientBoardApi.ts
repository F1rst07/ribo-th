/** Browser opened on Vercel (or similar); API must hit the board on the LAN, not the cloud host. */

export function isCloudDashboard(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  if (h === "localhost" || h === "127.0.0.1") return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return false;
  if (h.endsWith(".local")) return false;
  return true;
}

export function boardSiteOrigin(ip: string): string {
  return `http://${ip.trim()}:3000`;
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
  const saved = typeof window !== "undefined" ? localStorage.getItem("ribo_unoq_ip") || "" : "";
  if (/^\d+\.\d+\.\d+\.\d+$/.test(saved)) {
    const ok = await probeBoardFromBrowser(saved);
    if (ok) return { found: true, ip: saved, source: "saved" };
  }

  for (const prefix of SUBNET_PREFIXES) {
    const chunk: number[] = [];
    for (let n = 1; n <= 254; n++) chunk.push(n);
    for (let i = 0; i < chunk.length; i += 24) {
      const slice = chunk.slice(i, i + 24);
      const hits = await Promise.all(
        slice.map(async (n) => {
          const ip = `${prefix}.${n}`;
          return (await probeBoardFromBrowser(ip)) ? ip : null;
        })
      );
      const ip = hits.find(Boolean);
      if (ip) return { found: true, ip, source: "scan" };
    }
  }
  return { found: false };
}

export async function probeBoardFromBrowser(ip: string, timeoutMs = 900): Promise<boolean> {
  try {
    const url = boardArduinoApi(ip, "status", { ip });
    const resp = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      mode: "cors",
    });
    if (!resp.ok) return false;
    const data = await resp.json().catch(() => ({}));
    return Boolean((data as { connected?: boolean }).connected);
  } catch {
    return false;
  }
}

export function mobileBoardUrl(ip: string): string {
  const host = ip.trim() || "192.168.100.15";
  return `${boardSiteOrigin(host)}/`;
}
