export function unoqHost(requested: string): string {
  const host = requested.trim();
  if (!/^[a-zA-Z0-9.-]+$/.test(host)) {
    throw new Error("Invalid UNO Q host");
  }
  return host;
}

export function isUnoQHealthPayload(data: unknown): data is {
  status?: string;
  platform?: string;
  connected?: boolean;
} {
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  if (record.connected === true) return true;
  return (
    record.status === "ok" &&
    String(record.platform || "").includes("Arduino UNO Q")
  );
}

export async function probeUnoQHealth(
  ip: string,
  timeoutMs = 900
): Promise<boolean> {
  const host = unoqHost(ip);
  const urls = [
    `http://${host}:8000/api/health`,
    `http://${host}:3000/api/arduino/status?ip=127.0.0.1`,
  ];
  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (isUnoQHealthPayload(data)) return true;
    } catch {}
  }
  return false;
}
