import dns from "dns";

type CachedHost = { host: string; ip: string; time: number };
const globalForUnoq = globalThis as typeof globalThis & {
  __riboUnoqIpv4Cache?: CachedHost;
  __riboUnoqIpv4Inflight?: Promise<string>;
};

export async function resolveUnoQHost(requested: string): Promise<string> {
  const host = unoqHost(requested);
  if (!host.endsWith(".local")) return host;
  if (host === "ribo-th.local") return "192.168.0.5";
  const cached = globalForUnoq.__riboUnoqIpv4Cache;
  if (cached && cached.host === host && Date.now() - cached.time < 300_000) {
    return cached.ip;
  }
  if (globalForUnoq.__riboUnoqIpv4Inflight) {
    return globalForUnoq.__riboUnoqIpv4Inflight;
  }
  const lookupPromise = (async () => {
    try {
      const res = await dns.promises.lookup(host, { family: 4 });
      if (res?.address) {
        globalForUnoq.__riboUnoqIpv4Cache = { host, ip: res.address, time: Date.now() };
        return res.address;
      }
    } catch {}
    if (globalForUnoq.__riboUnoqIpv4Cache?.host === host) {
      return globalForUnoq.__riboUnoqIpv4Cache.ip;
    }
    return host;
  })();
  globalForUnoq.__riboUnoqIpv4Inflight = lookupPromise;
  try {
    return await lookupPromise;
  } finally {
    if (globalForUnoq.__riboUnoqIpv4Inflight === lookupPromise) {
      globalForUnoq.__riboUnoqIpv4Inflight = undefined;
    }
  }
}

/** On the device, all hardware requests stay on its loopback service. */
export function unoqHost(requested: string): string {
  if (process.env.RIBO_DEVICE_MODE === "true") return "127.0.0.1";
  if (!/^[a-zA-Z0-9.-]+$/.test(requested)) throw new Error("Invalid UNO Q host");
  return requested;
}

export function unoqDirectApiUrl(requested: string, backendPath: string): string {
  const host = unoqHost(requested);
  if (process.env.RIBO_DEVICE_MODE === "true") return `http://${host}:8000${backendPath}`;
  return `http://${host}:8000${backendPath}`;
}

export function unoqApiUrl(requested: string, route: string, backendPath: string): string {
  const host = unoqHost(requested);
  if (process.env.RIBO_DEVICE_MODE === "true") return `http://${host}:8000${backendPath}`;
  if (["localhost", "127.0.0.1"].includes(host)) throw new Error("Choose the UNO Q network address");
  return `http://${host}:3000/api/arduino/${route}`;
}

/** Standalone Next.js may use localhost in request.url behind its server. */
export function isSameRequestOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  if (isTrustedDashboardOrigin(origin)) return true;
  try {
    const actual = new URL(origin);
    const internal = new URL(request.url);
    const host = request.headers.get("host") || internal.host;
    return actual.protocol === internal.protocol && actual.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export function isTrustedDashboardOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.hostname === "ribo-th.vercel.app" || u.hostname.endsWith(".vercel.app")) return true;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) return true;
    if (u.hostname.endsWith(".local")) return true;
    return false;
  } catch {
    return false;
  }
}
