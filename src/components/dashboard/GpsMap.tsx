import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Circle, Crosshair, ExternalLink, History, MapPin, Minus, Plus, Square } from "lucide-react";
import type { LatLngTuple, Map as LeafletMap, Marker, Polyline } from "leaflet";
import "leaflet/dist/leaflet.css";
import { gpsDistanceMetres, parseGpsFix, simulatedGpsFix, type Coordinates, type GpsFix, type GpsTelemetry } from "@/lib/gpsTelemetry";
import { GpsRouteHistory, MAX_HISTORY_ROUTES, MAX_ROUTE_POINTS, readRouteHistory, removeSavedRoute, ROUTE_GAP_MS, type SavedRoute } from "./GpsRouteHistory";
import type { Language } from "./translations";
import { useVesselGps } from "./useVesselGps";
import styles from "./dashboard.module.css";

interface GpsMapProps {
  lang: Language;
  initialPosition: Coordinates;
  simulated: boolean;
  boardIp?: string;
}

const INITIAL_ZOOM = 19;
const MAX_ZOOM = 21;
type TrailPoint = GpsFix & { startsSegment?: boolean };

const gpsStatus: Record<GpsTelemetry["status"], Record<Language, string>> = {
  simulated: { th: "GPS จำลอง", en: "Simulated GPS" },
  live: { th: "GPS LIVE", en: "GPS LIVE" },
  waiting: { th: "รอพิกัด GPS", en: "Waiting for GPS" },
  connected_no_fix: { th: "โมดูลพร้อม (รอสัญญาณดาวเทียม)", en: "Module OK (No Fix)" },
  stale: { th: "พิกัด GPS หมดอายุ", en: "GPS position is stale" },
  unavailable: { th: "รับข้อมูล GPS ไม่ได้", en: "GPS unavailable" },
};

function latLng(fix: Coordinates): LatLngTuple {
  return [fix.latitude, fix.longitude];
}

function fitRoute(instance: LeafletMap, route: Polyline) {
  const bounds = route.getBounds();
  if (!bounds.isValid()) return;
  const padding = Math.min(32, Math.round(Math.min(instance.getSize().x, instance.getSize().y) * 0.1));
  instance.fitBounds(bounds, { padding: [padding, padding], maxZoom: MAX_ZOOM, animate: false });
}

function restoreTrail(storageKey: string): TrailPoint[] {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
    if (!Array.isArray(saved)) return [];
    return saved.slice(-MAX_ROUTE_POINTS).flatMap((point: unknown) => {
      const fix = parseGpsFix(point);
      if (!fix || fix.observedAt > Date.now()) return [];
      return [(point as TrailPoint).startsSegment === true ? { ...fix, startsSegment: true } : fix];
    });
  } catch {
    return [];
  }
}

export function GpsMap({ lang, initialPosition, simulated, boardIp }: GpsMapProps) {
  const { latitude, longitude } = initialPosition;
  const trackingZoom = simulated ? MAX_ZOOM : INITIAL_ZOOM;
  const telemetry = useVesselGps(simulated, boardIp);
  const { position } = telemetry;
  const isThai = lang === "th";
  const title = isThai ? "แผนที่และตำแหน่งเรือ" : "Vessel map and location";
  const mapElement = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<{ instance: LeafletMap; marker: Marker; route: Polyline } | null>(null);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">("loading");
  const storageKey = simulated ? "ribo-gps-route-demo" : "ribo-gps-route-live";
  const historyKey = `${storageKey}-history`;
  const [trail, setTrail] = useState<TrailPoint[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingMetres, setRecordingMetres] = useState(0);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [lastKnown, setLastKnown] = useState<GpsFix | null>(null);
  const [history, setHistory] = useState<SavedRoute[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyButton = useRef<HTMLButtonElement>(null);
  const historyPanel = useRef<HTMLDivElement>(null);
  const [viewedRoute, setViewedRoute] = useState<SavedRoute | null>(null);
  const [saveStatus, setSaveStatus] = useState<"empty" | "failed" | null>(null);
  const [browserPos, setBrowserPos] = useState<Coordinates | null>(null);
  const recordedTrail = useRef<TrailPoint[]>([]);
  const startedAt = useRef(0);

  useEffect(() => {
    if (position || typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBrowserPos({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
      },
      () => {},
      { timeout: 6000, enableHighAccuracy: true }
    );
  }, [position]);

  const fallbackPos: Coordinates = browserPos ?? { latitude, longitude };
  const effectivePosition: GpsFix = position ?? lastKnown ?? {
    latitude: fallbackPos.latitude,
    longitude: fallbackPos.longitude,
    observedAt: Date.now(),
  };
  const markerPosition = isRecording && position ? trail.at(-1) ?? position : effectivePosition;

  useEffect(() => {
    setHistory(readRouteHistory(historyKey));
    const syncHistory = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || (event.key !== historyKey && event.key !== null)) return;
      const saved = readRouteHistory(historyKey);
      setHistory(saved);
      setViewedRoute((current) => current && saved.some((route) => route.startedAt === current.startedAt) ? current : null);
    };
    window.addEventListener("storage", syncHistory);
    return () => window.removeEventListener("storage", syncHistory);
  }, [historyKey]);

  useEffect(() => {
    const saved = restoreTrail(storageKey);
    setLastKnown(saved.at(-1) ?? null);
  }, [storageKey]);

  const appendFix = useCallback((fix: GpsFix) => {
    const points = recordedTrail.current;
    const last = points.at(-1);
    if (last && fix.observedAt <= last.observedAt) return;
    if (last && fix.observedAt - last.observedAt <= ROUTE_GAP_MS) {
      const distance = gpsDistanceMetres(last, fix);
      setRecordingMetres((total) => total + distance);
    }
    const next = [...points.slice(-(MAX_ROUTE_POINTS - 1)), fix];
    recordedTrail.current = next;
    setTrail(next);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // The route stays visible in memory when browser storage is unavailable.
    }
  }, [storageKey]);

  useEffect(() => {
    if (!position) return;
    setLastKnown(position);
    if (isRecording) appendFix(position);
  }, [appendFix, isRecording, position]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => {
      setRecordingSeconds(Math.max(0, Math.floor((Date.now() - startedAt.current) / 1000)));
    }, 250);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => {
    const container = mapElement.current;
    if (!container) return;
    let disposed = false;
    let instance: LeafletMap | undefined;

    void import("leaflet").then((leaflet) => {
      if (disposed) return;
      instance = leaflet.map(container, {
        attributionControl: false,
        zoomControl: false,
        scrollWheelZoom: false,
        trackResize: false,
        minZoom: 3,
        maxZoom: MAX_ZOOM,
      }).setView([latitude, longitude], trackingZoom);

      leaflet.control.scale({ imperial: false, position: "bottomleft" }).addTo(instance);
      const tiles = leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxNativeZoom: INITIAL_ZOOM,
        maxZoom: MAX_ZOOM,
        referrerPolicy: "strict-origin-when-cross-origin",
      });
      let tileLoaded = false;
      tiles.on("tileload", () => {
        tileLoaded = true;
        setMapStatus("ready");
      });
      tiles.on("load", () => {
        if (!tileLoaded) setMapStatus("error");
      });
      tiles.addTo(instance);

      const route = leaflet.polyline([], {
        color: "#c2410c",
        weight: 5,
        smoothFactor: 0,
        className: styles.gpsRouteStroke,
      }).addTo(instance);
      const marker = leaflet.marker([latitude, longitude], {
        title: "RIBO-TH",
        icon: leaflet.divIcon({
          className: styles.gpsVesselPin,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
      }).bindTooltip("RIBO-TH (LIVE)", {
        permanent: true,
        direction: "top",
        offset: [0, -16],
        className: styles.gpsVesselLabel,
      });
      setMap({ instance, marker, route });
    }).catch(() => {
      if (!disposed) setMapStatus("error");
    });

    return () => {
      disposed = true;
      instance?.remove();
    };
  }, [latitude, longitude, trackingZoom]);

  useEffect(() => {
    const container = mapElement.current;
    if (!map || !container) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!container.clientWidth || !container.clientHeight) return;
        map.instance.invalidateSize({ animate: false, debounceMoveend: true });
        if (viewedRoute) fitRoute(map.instance, map.route);
      });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [map, viewedRoute]);

  useEffect(() => {
    if (!map) return;
    if (!markerPosition || viewedRoute) {
      map.marker.remove();
      return;
    }
    const next = latLng(markerPosition);
    map.marker.setLatLng(next);
    if (!map.instance.hasLayer(map.marker)) {
      map.marker.addTo(map.instance);
      map.instance.setView(next, trackingZoom);
    }
    map.marker.setTooltipContent("RIBO-TH (LIVE)");
  }, [map, markerPosition, trackingZoom, viewedRoute]);

  useEffect(() => {
    if (!map) return;
    const segments: LatLngTuple[][] = [];
    const shownTrail: TrailPoint[] = viewedRoute?.points ?? (isRecording ? trail : []);
    shownTrail.forEach((fix, index) => {
      const previous = shownTrail[index - 1];
      if (!previous || fix.startsSegment || fix.observedAt - previous.observedAt > ROUTE_GAP_MS) {
        segments.push([]);
      }
      segments[segments.length - 1].push(latLng(fix));
    });
    map.route.setLatLngs(segments);
    if (viewedRoute) fitRoute(map.instance, map.route);
  }, [isRecording, map, trail, viewedRoute]);

  function closeHistory() {
    setHistoryOpen(false);
    setViewedRoute(null);
    historyButton.current?.focus();
  }

  function openHistory() {
    setHistoryOpen(true);
    requestAnimationFrame(() => {
      const mapBounds = mapElement.current?.getBoundingClientRect();
      const historyBounds = historyPanel.current?.querySelector("section")?.getBoundingClientRect();
      if (!mapBounds || !historyBounds || historyPanel.current?.dataset.open !== "true") return;

      const viewportHeight = window.innerHeight;
      const mapPeek = Math.min(mapBounds.height, viewportHeight * 0.32, 180);
      const revealHistoryBy = historyBounds.bottom - viewportHeight + 12;
      const keepMapBy = mapBounds.bottom - mapPeek;
      const scrollBy = Math.min(revealHistoryBy, keepMapBy);
      if (scrollBy > 0) {
        window.scrollBy({
          top: scrollBy,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        });
      }
    });
  }

  function toggleRecording() {
    const now = Date.now();
    setSaveStatus(null);
    if (!isRecording) {
      startedAt.current = now;
      setRecordingMetres(0);
      setRecordingSeconds(0);
      recordedTrail.current = [];
      setTrail([]);
      setViewedRoute(null);
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        // Recording can continue when browser storage is unavailable.
      }
      const first = simulated ? simulatedGpsFix(now) : position;
      if (first) appendFix(first);
      setIsRecording(true);
      return;
    }

    setIsRecording(false);
    const final = simulated ? simulatedGpsFix(now) : position;
    if (final) appendFix(final);
    const points = recordedTrail.current;
    if (!points.length) {
      setSaveStatus("empty");
      return;
    }
    const route = { startedAt: startedAt.current, endedAt: now, points };
    const previous = new Map([...readRouteHistory(historyKey), ...history].map((item) => [item.startedAt, item]));
    const next = [route, ...[...previous.values()].sort((a, b) => b.startedAt - a.startedAt)]
      .slice(0, MAX_HISTORY_ROUTES);
    setHistory(next);
    try {
      localStorage.setItem(historyKey, JSON.stringify(next));
    } catch {
      setSaveStatus("failed");
    }
  }

  const latest = markerPosition ?? lastKnown;
  const googleMapsUrl = latest
    ? "https://www.google.com/maps/search/?" + new URLSearchParams({ api: "1", query: latLng(latest).join(",") })
    : undefined;

  return (
    <section className={`${styles.card} ${styles.gpsMapCard}`} aria-labelledby="gps-map-heading">
      <div className={styles.gpsMapHeader}>
        <div className={styles.gpsMapHeading}>
          <h2 id="gps-map-heading" className={styles.gpsMapTitle}>
            <MapPin size={16} aria-hidden="true" />
            {title}
          </h2>
          <span className={styles.gpsMapBadge} role="status">
            {gpsStatus[telemetry.status][lang]}
            {telemetry.status === "connected_no_fix" && telemetry.hardware && (
              <span style={{ fontSize: "0.85em", opacity: 0.85, marginLeft: "5px" }}>
                ({telemetry.hardware.lines} sentences)
              </span>
            )}
          </span>
        </div>
        <div className={styles.gpsMapToolbar}>
          {isRecording && (
            <span className={styles.gpsMapRecordingStatus} role="status">
              {isThai ? "กำลังบันทึก" : "Recording"}
            </span>
          )}
          <button
            type="button"
            className={`${styles.gpsMapRecordButton} ${styles.gpsMapPrimaryButton}`}
            data-recording={isRecording}
            onClick={toggleRecording}
          >
            {isRecording ? <Square size={13} aria-hidden="true" /> : <Circle size={13} aria-hidden="true" />}
            {isRecording
              ? (isThai ? "หยุดบันทึก" : "Stop recording")
              : (isThai ? "เริ่มบันทึก" : "Start recording")}
          </button>
          <button
            ref={historyButton}
            type="button"
            className={styles.gpsMapRecordButton}
            aria-expanded={historyOpen}
            aria-controls="gps-route-history-panel"
            onClick={historyOpen ? closeHistory : openHistory}
          >
            <History size={14} aria-hidden="true" />
            {isThai ? "ประวัติการบันทึก" : "Recording history"}
            <ChevronDown className={styles.gpsRouteHistoryChevron} size={13} aria-hidden="true" />
          </button>
        </div>
      </div>
      {viewedRoute && (
        <div className={styles.gpsMapReview}>
          <span className={styles.gpsMapRecordingStatus}>{isThai ? "กำลังดูเส้นทางย้อนหลัง" : "Viewing recorded route"}</span>
          <button type="button" className={styles.gpsMapRecordButton} onClick={() => setViewedRoute(null)}>
            {isThai ? "กลับไปดู GPS สด" : "Return to live GPS"}
          </button>
        </div>
      )}
      <div className={styles.gpsMapViewport}>
        <div ref={mapElement} className={styles.gpsMapFrame} role="region" aria-label={title} />
        <div className={styles.gpsMapControls} role="group" aria-label={isThai ? "ควบคุมแผนที่" : "Map controls"}>
          <button type="button" disabled={!map} aria-label={isThai ? "ซูมเข้า" : "Zoom in"} onClick={() => map?.instance.zoomIn()}>
            <Plus size={16} aria-hidden="true" />
          </button>
          <button type="button" disabled={!map} aria-label={isThai ? "ซูมออก" : "Zoom out"} onClick={() => map?.instance.zoomOut()}>
            <Minus size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={!map || !latest || Boolean(viewedRoute)}
            aria-label={isThai ? "ไปที่พิกัดเรือล่าสุด" : "Center on last vessel position"}
            onClick={() => {
              if (latest) map?.instance.setView(latLng(latest), trackingZoom);
            }}
          >
            <Crosshair size={16} aria-hidden="true" />
          </button>
        </div>
        <a className={styles.gpsMapAttribution} href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
          © OpenStreetMap contributors
        </a>
        {mapStatus !== "ready" && (
          <span className={styles.gpsMapStatus} role="status">
            {mapStatus === "loading"
              ? (isThai ? "กำลังโหลดแผนที่…" : "Loading map…")
              : (isThai ? "โหลดแผนที่ไม่ได้" : "Map could not load")}
          </span>
        )}
      </div>
      <div className={styles.gpsMapFooter}>
        <div>
          <div className={styles.gpsMapSource}>u-blox NEO-6M</div>
          <div className={styles.gpsMapCoordinates}>
            {latest && (
              <>
                <span>{isThai ? "ละติจูด" : "Latitude"} <b>{latest.latitude.toFixed(5)}</b></span>
                <span>{isThai ? "ลองจิจูด" : "Longitude"} <b>{latest.longitude.toFixed(5)}</b></span>
              </>
            )}
            {isRecording && (
              <dl className={styles.gpsMapLiveStats} aria-label={isThai ? "สถิติการบันทึกสด" : "Live recording statistics"}>
                <div>
                  <dt>{isThai ? "ระยะทาง ≈" : "Distance ≈"}</dt>
                  <dd>{recordingMetres.toFixed(1)} {isThai ? "ม." : "m"}</dd>
                </div>
                <div>
                  <dt>{isThai ? "เวลาบันทึก" : "Recording time"}</dt>
                  <dd>{Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, "0")}</dd>
                </div>
              </dl>
            )}
          </div>
        </div>
        {googleMapsUrl && (
          <a className={styles.gpsMapLink} href={googleMapsUrl} target="_blank" rel="noopener noreferrer">
            {isThai ? "เปิดพิกัดล่าสุดใน Google Maps" : "Open latest position in Google Maps"}
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        )}
      </div>
      {saveStatus && (
        <p className={styles.gpsMapNotice} role="status">
          {saveStatus === "empty"
            ? (isThai ? "ไม่มีพิกัด GPS ในเที่ยวนี้ จึงไม่ได้บันทึก" : "No GPS fixes were received for this trip.")
            : (isThai ? "เก็บประวัติในเบราว์เซอร์ไม่ได้ กรุณาส่งออกก่อนปิดหน้านี้" : "Could not save to browser storage. Export before closing this page.")}
        </p>
      )}
      <div
        id="gps-route-history-panel"
        ref={historyPanel}
        className={styles.gpsRouteHistoryPanel}
        data-open={historyOpen}
        inert={!historyOpen}
      >
        <div>
          <GpsRouteHistory
            routes={history}
            lang={lang}
            open={historyOpen}
            simulated={simulated}
            onClose={closeHistory}
            onDeleteRoute={(startedAt) => {
              setHistory(removeSavedRoute(historyKey, history, startedAt));
              if (viewedRoute?.startedAt === startedAt) setViewedRoute(null);
            }}
            onViewRoute={!isRecording && map ? (route) => {
              setViewedRoute(route);
              document.getElementById("gps-map-heading")?.scrollIntoView({ block: "start" });
            } : undefined}
          />
        </div>
      </div>
    </section>
  );
}
