import { useEffect, useMemo, useRef, useState } from "react";
import { Download, MapPin, Trash2, X } from "lucide-react";
import { gpsDistanceMetres, parseGpsFix, type GpsFix } from "@/lib/gpsTelemetry";
import type { Language } from "./translations";
import styles from "./dashboard.module.css";

export const MAX_HISTORY_ROUTES = 10;
export const MAX_ROUTE_POINTS = 3600;
export const ROUTE_GAP_MS = 5000;

export type SavedRoute = {
  startedAt: number;
  endedAt: number;
  points: GpsFix[];
};

export function readRouteHistory(key: string): SavedRoute[] {
  try {
    const json: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(json)) return [];
    return json.slice(0, MAX_HISTORY_ROUTES).flatMap((item: Partial<SavedRoute> | null) => {
      if (!item || typeof item.startedAt !== "number" || typeof item.endedAt !== "number"
        || !Number.isSafeInteger(item.startedAt) || !Number.isSafeInteger(item.endedAt)
        || item.startedAt <= 0 || item.endedAt < item.startedAt || item.endedAt > Date.now()
        || !Array.isArray(item.points)) return [];
      const points = item.points.slice(-MAX_ROUTE_POINTS).flatMap((point) => {
        const fix = parseGpsFix(point);
        return fix ? [fix] : [];
      });
      return points.length ? [{ startedAt: item.startedAt, endedAt: item.endedAt, points }] : [];
    });
  } catch {
    return [];
  }
}

export function removeSavedRoute(key: string, routes: SavedRoute[], startedAt: number): SavedRoute[] {
  const saved = localStorage.getItem(key);
  if (saved !== null) {
    const persisted: unknown = JSON.parse(saved);
    if (!Array.isArray(persisted)) throw new Error("Invalid route history");
    localStorage.setItem(key, JSON.stringify(persisted.filter((route) => route?.startedAt !== startedAt)));
  }
  return routes.filter((route) => route.startedAt !== startedAt);
}

function summarizeRoute(points: GpsFix[]) {
  const radians = Math.PI / 180;
  const longitudeScale = Math.cos(points[0].latitude * radians);
  const xy = points.map(({ latitude, longitude }) => [longitude * longitudeScale, -latitude]);
  const minX = Math.min(...xy.map(([x]) => x));
  const minY = Math.min(...xy.map(([, y]) => y));
  const width = Math.max(...xy.map(([x]) => x)) - minX;
  const height = Math.max(...xy.map(([, y]) => y)) - minY;
  const imageHeight = height > width ? 280 : 160;
  const scale = Math.min(288 / (width || 1e-10), (imageHeight - 32) / (height || 1e-10));
  const projected = xy.map(([x, y]) => [
    160 + (x - minX - width / 2) * scale,
    imageHeight / 2 + (y - minY - height / 2) * scale,
  ]);
  let metres = 0;
  let segment = 0;
  const rows = points.map((point, index) => {
    const previous = points[index - 1];
    const newSegment = !previous || point.observedAt - previous.observedAt > ROUTE_GAP_MS;
    if (newSegment) {
      segment++;
    } else {
      metres += gpsDistanceMetres(previous, point);
    }
    return {
      point,
      segment,
      newSegment,
      xy: projected[index],
      path: (newSegment ? "M" : "L") + projected[index].map((value) => value.toFixed(2)).join(" "),
    };
  });
  return { metres, rows, imageHeight, start: projected[0], end: projected[projected.length - 1] };
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportPng(svg: SVGSVGElement, name: string) {
  const canvas = document.createElement("canvas");
  const size = svg.viewBox.baseVal;
  canvas.width = size.width * 4;
  canvas.height = size.height * 4;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");

  const artwork = svg.cloneNode(true) as SVGSVGElement;
  artwork.setAttribute("width", String(canvas.width));
  artwork.setAttribute("height", String(canvas.height));
  const url = URL.createObjectURL(new Blob(
    [new XMLSerializer().serializeToString(artwork)],
    { type: "image/svg+xml;charset=utf-8" },
  ));
  try {
    const rendered = new Image();
    rendered.src = url;
    await rendered.decode();
    context.drawImage(rendered, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("PNG unavailable");
    download(name, png);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function GpsRouteHistory({ routes, lang, open, simulated, onClose, onViewRoute, onDeleteRoute }: {
  routes: SavedRoute[];
  lang: Language;
  open: boolean;
  simulated: boolean;
  onClose: () => void;
  onViewRoute?: (route: SavedRoute) => void;
  onDeleteRoute: (startedAt: number) => void;
}) {
  const isThai = lang === "th";
  const [selected, setSelected] = useState<number>();
  const [imageError, setImageError] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number>();
  const [deleteStatus, setDeleteStatus] = useState<"deleted" | "failed">();
  const image = useRef<SVGSVGElement>(null);
  const route = routes.find(({ startedAt }) => startedAt === selected) ?? routes[0];

  useEffect(() => {
    setSelected(routes[0]?.startedAt);
  }, [routes]);

  useEffect(() => {
    if (open) return;
    setDeleteTarget(undefined);
    setDeleteStatus(undefined);
  }, [open]);

  const title = isThai ? "ประวัติการบันทึก" : "Recording history";
  const dates = new Intl.DateTimeFormat(isThai ? "th-TH" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
  });
  const duration = route ? Math.floor((route.endedAt - route.startedAt) / 1000) : 0;
  const summary = useMemo(() => route && summarizeRoute(route.points), [route]);
  const filename = route
    ? `ribo-route-${simulated ? "demo-" : ""}${new Date(route.startedAt).toISOString().replace(/[:.]/g, "-")}`
    : "";

  return (
    <section className={styles.gpsRouteHistory} aria-labelledby="gps-route-history-heading">
      <div className={styles.gpsRouteHistoryHeader}>
        <h3 id="gps-route-history-heading">{title}</h3>
        <button
          type="button"
          className={`${styles.gpsMapRecordButton} ${styles.gpsRouteClose}`}
          aria-label={isThai ? "ปิดประวัติการบันทึก" : "Close recording history"}
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {route && summary ? (
        <div className={styles.gpsRouteLayout}>
          <figure className={styles.gpsRouteFigure}>
            <div className={styles.gpsRouteArtwork}>
              <svg ref={image} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 320 ${summary.imageHeight}`} role="img" aria-label={isThai ? "ภาพเส้นทางที่บันทึก" : "Recorded route image"}>
                <rect width="320" height={summary.imageHeight} fill="#18232d" rx="8" />
                <path d={summary.rows.map(({ path }) => path).join(" ")} fill="none" stroke="#ff8a50" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                {summary.rows.filter(({ newSegment }) => newSegment).map(({ segment, xy }) => (
                  <circle key={segment} cx={xy[0]} cy={xy[1]} r="3" fill="#ff8a50" />
                ))}
                <circle cx={summary.start[0]} cy={summary.start[1]} r="5" fill="#69d7a0" />
                <circle cx={summary.end[0]} cy={summary.end[1]} r="4" fill="#fff" />
              </svg>
            </div>
            <figcaption className={styles.gpsRouteLegend}>
              <span>{isThai ? "จุดเริ่ม" : "Start"}</span>
              <span>{isThai ? "จุดสิ้นสุด" : "Finish"}</span>
            </figcaption>
          </figure>
          <div className={styles.gpsRouteDetails}>
            <label>
              {isThai ? "เลือกเที่ยว" : "Select trip"}
              <select value={route.startedAt} onChange={(event) => {
                setSelected(Number(event.target.value));
                setImageError(false);
                setDeleteTarget(undefined);
                setDeleteStatus(undefined);
              }}>
                {routes.map(({ startedAt }) => (
                  <option key={startedAt} value={startedAt}>{dates.format(startedAt)}</option>
                ))}
              </select>
            </label>
            <dl className={styles.gpsRouteSummary}>
              <div><dt>{isThai ? "ระยะทางโดยประมาณ" : "Estimated distance"}</dt><dd>{summary.metres.toFixed(1)} {isThai ? "ม." : "m"}</dd></div>
              <div><dt>{isThai ? "เวลาบันทึก" : "Recording time"}</dt><dd>{Math.floor(duration / 60)} {isThai ? "นาที" : "min"} {duration % 60} {isThai ? "วินาที" : "sec"}</dd></div>
            </dl>
            {route.points.length < 3 && (
              <p>{isThai ? "เที่ยวนี้มีพิกัดน้อยเกินกว่าจะแสดงทางโค้ง" : "This trip has too few GPS points to show turns."}</p>
            )}
            <div className={styles.gpsRouteActions}>
              <button type="button" className={styles.gpsMapRecordButton} disabled={!onViewRoute} onClick={() => onViewRoute?.(route)}>
                <MapPin size={13} aria-hidden="true" />
                {isThai ? "แสดงบนแผนที่" : "View on map"}
              </button>
              <button type="button" className={styles.gpsMapRecordButton} onClick={() => {
                const source = simulated ? "พิกัดจำลอง" : "GPS จริง";
                const rows = summary.rows.map(({ point, segment }) =>
                  [new Date(point.observedAt).toISOString(), point.latitude, point.longitude, segment, source].join(","));
                const csv = ["วันเวลา (UTC),ละติจูด,ลองจิจูด,ช่วงเส้นทาง,แหล่งพิกัด", ...rows, ""].join("\r\n");
                download(`${filename}.csv`, new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
              }}><Download size={13} aria-hidden="true" />{isThai ? "ส่งออกไฟล์.csv" : "Export CSV"}</button>
              <button type="button" className={styles.gpsMapRecordButton} onClick={() => {
                if (!image.current) return;
                setImageError(false);
                void exportPng(image.current, `${filename}.png`).catch(() => setImageError(true));
              }}><Download size={13} aria-hidden="true" />{isThai ? "ส่งออกรูปภาพ" : "Export PNG image"}</button>
              <button type="button" className={`${styles.gpsMapRecordButton} ${styles.gpsMapDangerButton}`} onClick={() => {
                setDeleteTarget(route.startedAt);
                setDeleteStatus(undefined);
              }}>
                <Trash2 size={13} aria-hidden="true" />
                {isThai ? "ลบเที่ยวนี้" : "Delete selected trip"}
              </button>
            </div>
            {deleteTarget === route.startedAt && (
              <div className={styles.gpsRouteDeleteConfirm} role="group" aria-labelledby="gps-route-delete-message">
                <p id="gps-route-delete-message">{isThai ? "ต้องการลบเที่ยววันที่" : "Delete the trip recorded on"} {dates.format(route.startedAt)}?</p>
                <div className={styles.gpsMapActions}>
                  <button type="button" className={styles.gpsMapRecordButton} onClick={() => setDeleteTarget(undefined)}>
                    {isThai ? "ยกเลิก" : "Cancel"}
                  </button>
                  <button type="button" className={`${styles.gpsMapRecordButton} ${styles.gpsMapDangerButton}`} onClick={() => {
                    try {
                      onDeleteRoute(route.startedAt);
                      setDeleteTarget(undefined);
                      setDeleteStatus("deleted");
                    } catch {
                      setDeleteStatus("failed");
                    }
                  }}>
                    {isThai ? "ยืนยันการลบ" : "Confirm deletion"}
                  </button>
                </div>
              </div>
            )}
            {imageError && <p role="status">{isThai ? "ส่งออกภาพไม่ได้ กรุณาลองใหม่" : "Image export failed. Try again."}</p>}
          </div>
        </div>
      ) : <p>{isThai ? "ยังไม่มีเที่ยวที่บันทึก กดเริ่มและหยุดบันทึกหลังได้รับพิกัด GPS" : "No saved trips. Start and stop recording after receiving a GPS position."}</p>}
      {deleteStatus && <p role="status">{deleteStatus === "deleted"
        ? (isThai ? "ลบเที่ยวที่เลือกแล้ว" : "Selected trip deleted.")
        : (isThai ? "ลบเที่ยวไม่ได้ กรุณาลองใหม่" : "Could not delete the trip. Try again.")}</p>}
    </section>
  );
}
