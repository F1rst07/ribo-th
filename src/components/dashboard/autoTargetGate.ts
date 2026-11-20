import type { TrashDetection, VisionStatus } from "./trashVision";

// หลุดจากชิ้นที่ล็อกได้ไม่เกิน 2 วินาที แล้วถือว่ายังเป็นเป้าเดิม
export const LOST_GRACE_MS = 2000;

export type AutoLockState = "locked" | "grace" | "search";

export interface AutoLockResult {
  state: AutoLockState;
  target: TrashDetection | null;
  released: boolean;
  switched: boolean;
}

// This gate confirms observations, not model accuracy. Persistent model errors
// still need labelled positive/negative data from the deployment environment.
export class AutoTargetGate {
  private lockedKey: string | null = null;
  private lastSeen = 0;

  reset() {
    this.lockedKey = null;
    this.lastSeen = 0;
  }

  // ดูรายการล่าสุดทุกครั้ง แม้เลขเฟรมจะซ้ำ
  // ลูปนำทางเร็วกว่าภาพ AI ถ้าทิ้งเฟรมซ้ำ เรือจะหมุนหาต่อทั้งที่มีกรอบขยะ
  select(items: TrashDetection[], status: VisionStatus, receivedAt: number, _frame: number, now: number): AutoLockResult {
    if (status !== "ready" || now - receivedAt > 1500) {
      return { state: "search", target: null, released: false, switched: false };
    }

    const fresh = items.filter((item) =>
      (item.status === "DETECTED" || item.status === "TRACKED") &&
      (item.type !== "oil" || item.autoEligible === true));
    const key = (item: TrashDetection) => `${item.type || "trash"}:${item.trackId}`;
    const closest = (list: TrashDetection[]) => {
      let best = list[0];
      let bestDistance = Math.abs(best.pixelX - 320);
      for (const item of list) {
        const distance = Math.abs(item.pixelX - 320);
        if (distance < bestDistance) {
          best = item;
          bestDistance = distance;
        }
      }
      return best;
    };
    const preferTrash = (list: TrashDetection[]) => {
      const trash = list.filter((item) => item.type !== "oil");
      return closest(trash.length > 0 ? trash : list);
    };

    if (this.lockedKey) {
      const trash = fresh.filter((item) => item.type !== "oil");
      if (this.lockedKey.startsWith("oil:") && trash.length > 0) {
        const next = closest(trash);
        this.lockedKey = key(next);
        this.lastSeen = now;
        return { state: "locked", target: next, released: false, switched: true };
      }
      const same = fresh.find((item) => key(item) === this.lockedKey);
      if (same) {
        this.lastSeen = now;
        return { state: "locked", target: same, released: false, switched: false };
      }
      if (fresh.length > 0) {
        const next = preferTrash(fresh);
        this.lockedKey = key(next);
        this.lastSeen = now;
        return { state: "locked", target: next, released: false, switched: true };
      }
      if (now - this.lastSeen < LOST_GRACE_MS) {
        return { state: "grace", target: null, released: false, switched: false };
      }
      this.lockedKey = null;
      return { state: "search", target: null, released: true, switched: false };
    }

    if (fresh.length === 0) {
      return { state: "search", target: null, released: false, switched: false };
    }
    const candidate = preferTrash(fresh);
    this.lockedKey = key(candidate);
    this.lastSeen = now;
    return { state: "locked", target: candidate, released: false, switched: false };
  }
}
