import { NextRequest } from "next/server";
import os from "os";
import { corsPreflightResponse, jsonWithCors } from "@/lib/cors";
import { discoverBoardOnLan } from "@/lib/unoqAdb";
import { probeUnoQHealth } from "@/lib/unoqBoardProbe";
import { deviceLanAddress } from "@/lib/unoqWifiOnDevice";

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

function lanPrefixes(): string[] {
  const prefixes: string[] = [];
  const nets = os.networkInterfaces();
  for (const addrs of Object.values(nets)) {
    for (const addr of addrs || []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      const parts = addr.address.split(".");
      if (parts.length !== 4) continue;
      const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
      if (!prefixes.includes(prefix)) prefixes.push(prefix);
    }
  }
  return prefixes.sort((a, b) => {
    const rank = (p: string) => (p === "192.168.100" ? 0 : p.startsWith("172.20.10") ? 2 : 1);
    return rank(a) - rank(b);
  });
}

export async function GET(request: NextRequest) {
  const self = deviceLanAddress();
  if (self) {
    return jsonWithCors(request, {
      found: true,
      ip: self,
      hostname: "KPhiraphat.local",
      source: "device",
    });
  }

  const mDNS = await discoverBoardOnLan();
  if (mDNS.ip) {
    return jsonWithCors(request, {
      found: true,
      ip: mDNS.ip,
      hostname: mDNS.hostname,
      source: "mdns",
    });
  }

  const own = new Set(
    Object.values(os.networkInterfaces() || {})
      .flat()
      .filter((a) => a?.family === "IPv4" && !a.internal)
      .map((a) => a!.address)
  );

  const prefixes = lanPrefixes();
  const likelyPrefixes = prefixes.includes("192.168.100")
    ? prefixes
    : ["192.168.100", ...prefixes];
  for (const prefix of likelyPrefixes) {
    const likely = `${prefix}.15`;
    if (!own.has(likely) && (await probeUnoQHealth(likely, 1200))) {
      return jsonWithCors(request, { found: true, ip: likely, source: "wifi" });
    }
  }

  for (const prefix of prefixes) {
    const candidates = Array.from({ length: 254 }, (_, i) => i + 1).filter((n) => {
      const ip = `${prefix}.${n}`;
      return !own.has(ip) && n !== 15;
    });
    const chunkSize = 24;
    for (let i = 0; i < candidates.length; i += chunkSize) {
      const chunk = candidates.slice(i, i + chunkSize);
      const probes = await Promise.all(
        chunk.map(async (n) => {
          const ip = `${prefix}.${n}`;
          const ok = await probeUnoQHealth(ip, 700);
          return ok ? ip : null;
        })
      );
      const hit = probes.find(Boolean);
      if (hit) {
        return jsonWithCors(request, {
          found: true,
          ip: hit,
          source: "scan",
        });
      }
    }
  }

  return jsonWithCors(request, {
    found: false,
    error: "No responding Arduino UNO Q on this Wi-Fi",
  });
}
