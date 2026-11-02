import type { TrashDetection, VisionStatus } from "./trashVision";

// This gate confirms observations, not model accuracy. Persistent model errors
// still need labelled positive/negative data from the deployment environment.
export class AutoTargetGate {
  private lockedKey: string | null = null;
  private lastSeen = 0;
  private lastFrame = -1;

  reset() {
    this.lockedKey = null;
    this.lastFrame = -1;
  }

  select(items: TrashDetection[], status: VisionStatus, receivedAt: number, frame: number, now: number): TrashDetection | null {
    if (status !== "ready" || now - receivedAt > 500) {
      return null;
    }
    const fresh = items.filter((item) => item.status === "DETECTED" &&
      (item.type !== "oil" || item.autoEligible === true));
    const key = (item: TrashDetection) => `${item.type || "trash"}:${item.trackId}`;
    if (this.lockedKey) {
      const same = fresh.find((item) => key(item) === this.lockedKey);
      if (same) {
        this.lastSeen = now;
        return same;
      }
      // Remember the identity, but never drive on its stale coordinates.
      if (now - this.lastSeen < 350) return null;
      this.lockedKey = null;
    }
    if (frame === this.lastFrame) return null;
    this.lastFrame = frame;
    const candidate = fresh[0];
    if (!candidate) return null;
    this.lockedKey = key(candidate);
    this.lastSeen = now;
    return candidate;
  }
}
