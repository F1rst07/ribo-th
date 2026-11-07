import { NextResponse } from "next/server";
import os from "os";
import { discoverBoardOnLan } from "@/lib/unoqAdb";
import { probeUnoQHealth } from "@/lib/unoqBoardProbe";

function localSubnetPrefix(): string {
  const nets = os.networkInterfaces();
  for (const addrs of Object.values(nets)) {
    for (const addr of addrs || []) {
      if (addr.family === "IPv4" && !addr.internal) {
        const parts = addr.address.split(".");
        if (parts.length === 4) {
          return `${parts[0]}.${parts[1]}.${parts[2]}`;
        }
      }
    }
  }
  return "192.168.100";
}

export async function GET() {
  const mDNS = await discoverBoardOnLan();
  if (mDNS.ip) {
    return NextResponse.json({
      found: true,
      ip: mDNS.ip,
      hostname: mDNS.hostname,
      source: "mdns",
    });
  }

  const prefix = localSubnetPrefix();
  const own = Object.values(os.networkInterfaces() || {})
    .flat()
    .find((a) => a?.family === "IPv4" && !a.internal)?.address;
  const candidates = Array.from({ length: 254 }, (_, i) => i + 1).filter((n) => {
    const ip = `${prefix}.${n}`;
    return ip !== own;
  });

  const chunkSize = 48;
  for (let i = 0; i < candidates.length; i += chunkSize) {
    const chunk = candidates.slice(i, i + chunkSize);
    const probes = await Promise.all(
      chunk.map(async (n) => {
        const ip = `${prefix}.${n}`;
        const ok = await probeUnoQHealth(ip, 220);
        return ok ? ip : null;
      })
    );
    const hit = probes.find(Boolean);
    if (hit) {
      return NextResponse.json({
        found: true,
        ip: hit,
        source: "scan",
      });
    }
  }

  return NextResponse.json({
    found: false,
    error: "No responding Arduino UNO Q on this Wi-Fi",
  });
}
