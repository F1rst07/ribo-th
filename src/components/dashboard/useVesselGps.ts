import { useEffect, useState } from "react";
import { parseGpsFix, simulatedGpsFix, type GpsTelemetry } from "@/lib/gpsTelemetry";

export function useVesselGps(simulated = false, boardIp?: string) {
  const [telemetry, setTelemetry] = useState<GpsTelemetry>(() =>
    simulated
      ? { status: "simulated", position: simulatedGpsFix(Date.now()) }
      : { status: "waiting", position: null }
  );

  useEffect(() => {
    if (simulated) {
      setTelemetry({ status: "simulated", position: simulatedGpsFix(Date.now()) });
      const interval = setInterval(() => {
        setTelemetry({ status: "simulated", position: simulatedGpsFix(Date.now()) });
      }, 1000);
      return () => clearInterval(interval);
    }

    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const ipQuery = boardIp?.trim() ? `?ip=${encodeURIComponent(boardIp.trim())}` : "";
    const poll = async () => {
      try {
        const response = await fetch(`/api/gps${ipQuery}`, {
          cache: "no-store",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(2500)]),
        });
        if (!response.ok) throw new Error("GPS request failed");
        const data = await response.json();
        if (abort.signal.aborted) return;

        const position = parseGpsFix(data.position);
        if (position && (data.status === "simulated" || data.status === "live")) {
          setTelemetry({ status: data.status, position, hardware: data.hardware ?? null });
        } else if (data.status === "waiting" || data.status === "stale" || data.status === "connected_no_fix") {
          setTelemetry({ status: data.status, position: null, hardware: data.hardware ?? null });
        } else {
          setTelemetry({ status: "unavailable", position: null, hardware: null });
        }
      } catch {
        if (!abort.signal.aborted) setTelemetry({ status: "unavailable", position: null });
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 2000);
      }
    };

    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [simulated, boardIp]);

  return telemetry;
}
