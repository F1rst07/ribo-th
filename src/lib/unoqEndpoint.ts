/** On the device, all hardware requests stay on its loopback service. */
export function unoqHost(requested: string): string {
  if (process.env.RIBO_DEVICE_MODE === "true") return "127.0.0.1";
  if (!/^[a-zA-Z0-9.-]+$/.test(requested)) throw new Error("Invalid UNO Q host");
  return requested;
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
  try {
    const actual = new URL(origin);
    const internal = new URL(request.url);
    const host = request.headers.get("host") || internal.host;
    return actual.protocol === internal.protocol && actual.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
