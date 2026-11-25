export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface GpsFix extends Coordinates {
  observedAt: number;
}

export interface GpsHardwareDiag {
  bytes: number;
  lines: number;
  fix: boolean;
  sats: number;
  raw: string;
  observedAt?: number;
}

export type GpsTelemetry =
  | { status: "simulated" | "live"; position: GpsFix; hardware?: GpsHardwareDiag | null }
  | { status: "waiting" | "connected_no_fix" | "stale" | "unavailable"; position: null; hardware?: GpsHardwareDiag | null };

export const demoGpsCenter: Coordinates = { latitude: 13.73697, longitude: 100.52872 };

export function gpsDistanceMetres(from: Coordinates, to: Coordinates): number {
  const radians = Math.PI / 180;
  const a = Math.sin((to.latitude - from.latitude) * radians / 2) ** 2
    + Math.cos(from.latitude * radians) * Math.cos(to.latitude * radians)
    * Math.sin((to.longitude - from.longitude) * radians / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(Math.min(1, a)));
}

export function simulatedGpsFix(observedAt: number): GpsFix {
  const angle = (observedAt % 32_000) / 32_000 * 2 * Math.PI;
  return {
    latitude: demoGpsCenter.latitude + 0.000022 * Math.sin(angle),
    longitude: demoGpsCenter.longitude + 0.000032 * Math.cos(angle),
    observedAt,
  };
}

export function parseGpsFix(data: unknown): GpsFix | null {
  if (typeof data !== "object" || data === null) return null;
  const { latitude, longitude, observedAt } = data as Partial<GpsFix>;
  if (
    typeof latitude !== "number" || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
    typeof longitude !== "number" || !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
    typeof observedAt !== "number" || !Number.isSafeInteger(observedAt) || observedAt <= 0
  ) return null;
  return { latitude, longitude, observedAt };
}
