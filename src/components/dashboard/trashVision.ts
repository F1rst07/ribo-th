export type DetectionStatus = "DETECTED" | "TRACKED";
export type DetectionType = "trash" | "oil";

export interface TrashDetection {
  trackId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  pixelX: number;
  pixelY: number;
  confidence: number;
  classId: number;
  className: string;
  classNameEn: string;
  rawClassName: string;
  status: DetectionStatus;
  type?: DetectionType;
  points?: { x: number; y: number }[];
  areaPct?: number;
  autoEligible?: boolean;
}

export type VisionStatus = "idle" | "loading" | "ready" | "error";

export interface VisionMeta {
  source: "local";
  model: string;
  confidenceThreshold: number;
  nmsIou: number;
  inferenceImageSize: number;
  inputWidth: number;
  inputHeight: number;
  frameId: number;
  fps: number;
  totalMs: number;
  oilClasses?: Record<string, string>;
  oilTotalAreaPct?: number;
  oilRegionsCount?: number;
  oilAutoReady?: boolean;
  priorityDecision?: "trash_priority" | "trash" | "oil" | "searching";
  priorityDecisionTh?: string;
  priorityDecisionEn?: string;
  trashStatus?: "ACTIVE" | "INACTIVE" | "ERROR";
  oilStatus?: "ACTIVE" | "INACTIVE" | "PREPARING" | "ERROR";
}

export function getTrashTypeLabel(rawName: string, lang: "th" | "en" = "th"): string {
  const normalized = (rawName || "").toLowerCase();
  if (normalized.includes("can")) return lang === "th" ? "กระป๋อง" : "Can";
  if (normalized.includes("bottle") && !normalized.includes("cap")) return lang === "th" ? "ขวด" : "Bottle";
  if (normalized.includes("carton") || normalized.includes("box")) return lang === "th" ? "กล่อง" : "Box";
  if (normalized.includes("bag") || normalized.includes("wrapper") || normalized.includes("plastic bag")) {
    return lang === "th" ? "ถุงพลาสติก" : "Plastic Bag";
  }
  if (normalized.includes("cup")) return lang === "th" ? "แก้วน้ำ" : "Cup";
  if (normalized.includes("cap")) return lang === "th" ? "ฝาขวด" : "Bottle Cap";
  if (normalized.includes("cigarette")) return lang === "th" ? "ก้นบุหรี่" : "Cigarette";
  if (normalized.includes("other plastic")) return lang === "th" ? "พลาสติก" : "Plastic";
  return lang === "th" ? "ขยะ" : "Trash";
}

export function parseDetections(value: unknown, width: number, height: number): TrashDetection[] {
  if (!Array.isArray(value)) throw new Error("Invalid predictions");
  const allParsed = value.flatMap((item, index): TrashDetection[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const x = Number(record.x);
    const y = Number(record.y);
    const boxWidth = Number(record.width);
    const boxHeight = Number(record.height);
    const confidence = Number(record.confidence);
    const classId = Number.isInteger(record.class_id) ? (record.class_id as number) : 0;
    const className = typeof record.class_name === "string" && record.class_name ? record.class_name : "ขยะ";
    const classNameEn = typeof record.class_name_en === "string" && record.class_name_en ? record.class_name_en : "Trash";
    const rawClassName = typeof record.raw_class_name === "string" ? record.raw_class_name : "unknown";
    const rawTrackId = record.track_id ?? record.trackId;
    const parsedId = typeof rawTrackId === "number" ? Math.round(rawTrackId) : parseInt(String(rawTrackId), 10);
    const trackId = Number.isInteger(parsedId) && parsedId > 0 ? parsedId : index + 1;
    const status: DetectionStatus = record.status === "TRACKED" ? "TRACKED" : "DETECTED";

    if (![x, y, boxWidth, boxHeight, confidence].every(Number.isFinite) ||
      confidence < 0.05 || confidence > 1 || boxWidth <= 0 || boxHeight <= 0) return [];

    // กรองกรอบที่ครอบเกือบเต็มทั้งจอออก (ป้องกัน Background False Positive ครอบทั้งห้อง/ผนัง)
    const isOilRecord = record.type === "oil" || (typeof record.class_name === "string" && record.class_name.includes("น้ำมัน"));
    if (isOilRecord) {
      if ((boxWidth >= 0.85 * width && boxHeight >= 0.70 * height) || (boxWidth * boxHeight >= 0.50 * width * height)) return [];
    } else if ((boxWidth >= 0.80 * width && boxHeight >= 0.80 * height) || (boxWidth * boxHeight >= 0.60 * width * height)) {
      return [];
    }

    const left = Math.max(0, Math.min(width, x - boxWidth / 2));
    const top = Math.max(0, Math.min(height, y - boxHeight / 2));
    const right = Math.max(0, Math.min(width, x + boxWidth / 2));
    const bottom = Math.max(0, Math.min(height, y + boxHeight / 2));
    if (right <= left || bottom <= top) return [];

    // กรองติ่งวัตถุลวงชิดขอบหรือมุมกล้อง (Edge Vignette / Boundary Sliver Artifact)
    const touchesX = left <= 4 || right >= width - 4;
    const touchesY = top <= 4 || bottom >= height - 4;
    const minEdgeRatio = isOilRecord ? 0.06 : 0.08;
    if (touchesX && boxWidth < minEdgeRatio * width) return [];
    if (touchesY && boxHeight < minEdgeRatio * height) return [];
    const minCornerRatio = isOilRecord ? 0.06 : 0.08;
    if (touchesX && touchesY && (boxWidth * boxHeight < minCornerRatio * width * height)) return [];

    const rawPixelX = record.pixel_x ?? record.pixelX ?? x;
    const rawPixelY = record.pixel_y ?? record.pixelY ?? y;
    const pixelX = Number.isFinite(Number(rawPixelX))
      ? Math.round(Number(rawPixelX))
      : Math.round((left + right) / 2);
    const pixelY = Number.isFinite(Number(rawPixelY))
      ? Math.round(Number(rawPixelY))
      : Math.round((top + bottom) / 2);

    const rawType = record.type === "oil" || (typeof record.class_name === "string" && record.class_name.includes("น้ำมัน"))
      ? ("oil" as const)
      : ("trash" as const);

    const rawPoints = Array.isArray(record.points) ? record.points : undefined;
    const points = rawPoints
      ? rawPoints
          .map((p) => {
            if (!p || typeof p !== "object") return null;
            const pt = p as Record<string, unknown>;
            const px = Number(pt.x);
            const py = Number(pt.y);
            return Number.isFinite(px) && Number.isFinite(py) ? { x: px, y: py } : null;
          })
          .filter((p): p is { x: number; y: number } => p !== null)
      : undefined;

    const areaPct = typeof record.area_pct === "number" && Number.isFinite(record.area_pct)
      ? record.area_pct
      : undefined;

    return [{
      trackId,
      x: left / width * 100,
      y: top / height * 100,
      width: (right - left) / width * 100,
      height: (bottom - top) / height * 100,
      pixelX,
      pixelY,
      confidence,
      classId,
      className,
      classNameEn,
      rawClassName,
      status,
      type: rawType,
      points,
      areaPct,
      autoEligible: rawType === "oil" ? record.auto_eligible === true : true,
    }];
  });

  const trashItems = allParsed.filter(d => d.type !== "oil" && !d.className?.includes("น้ำมัน"));
  const oilItems = allParsed
    .filter(d => d.type === "oil" || d.className?.includes("น้ำมัน"))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);

  return [...trashItems, ...oilItems];
}

export function parseVisionMeta(value: unknown): VisionMeta {
  if (!value || typeof value !== "object") throw new Error("Invalid local AI metadata");
  const meta = value as Record<string, unknown>;
  const numericFields = [
    meta.confidence_threshold,
    meta.nms_iou,
    meta.inference_imgsz,
    meta.input_width,
    meta.input_height,
    meta.frame_id,
    meta.fps,
    meta.total_ms,
  ];
  if (meta.source !== "local" || typeof meta.model !== "string" ||
    !numericFields.every(Number.isFinite)) {
    throw new Error("Invalid local AI metadata");
  }
  return {
    source: "local",
    model: meta.model,
    confidenceThreshold: meta.confidence_threshold as number,
    nmsIou: meta.nms_iou as number,
    inferenceImageSize: meta.inference_imgsz as number,
    inputWidth: meta.input_width as number,
    inputHeight: meta.input_height as number,
    frameId: meta.frame_id as number,
    fps: meta.fps as number,
    totalMs: meta.total_ms as number,
    oilClasses: (meta.oil_classes && typeof meta.oil_classes === "object") ? (meta.oil_classes as Record<string, string>) : {},
    oilTotalAreaPct: typeof meta.oil_total_area_pct === "number" ? meta.oil_total_area_pct : undefined,
    oilRegionsCount: typeof meta.oil_regions_count === "number" ? meta.oil_regions_count : undefined,
    oilAutoReady: meta.oil_auto_ready === true,
    priorityDecision: typeof meta.priority_decision === "string" ? (meta.priority_decision as any) : undefined,
    priorityDecisionTh: typeof meta.priority_decision_th === "string" ? meta.priority_decision_th : undefined,
    priorityDecisionEn: typeof meta.priority_decision_en === "string" ? meta.priority_decision_en : undefined,
    trashStatus: typeof meta.trash_status === "string" ? (meta.trash_status as any) : undefined,
    oilStatus: typeof meta.oil_status === "string" ? (meta.oil_status as any) : undefined,
  };
}
