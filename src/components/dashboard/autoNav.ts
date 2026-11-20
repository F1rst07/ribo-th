// ภาพกว้าง 640 จุด
// ชิ้นใหม่ต้องหมุนให้เข้ากลางจอก่อน ชิ้นเดิมที่ล็อกแล้วไม่หมุนตั้งกลางซ้ำ
// ระหว่างเข้าหา หมุนเฉพาะตอนจุดขยะชิดขอบจนใกล้หลุดจากภาพ
export const VIEW_LEFT = 40;
export const VIEW_RIGHT = 600;
export const CENTER_X = 320;
export const CENTER_BAND = 60;
export const INTAKE_Y = 275;
export const SEARCH_SPIN_MS = 30000;
export const SEARCH_FORWARD_MS = 20000;
export const RELAY_REST_MS = 1000;
export const CONFIRM_MS = 500;
export const COMMIT_MS = RELAY_REST_MS;
export const INTAKE_HOLD_MS = 1200;
export const COLLECT_GONE_MS = 1500;
export const OIL_SPRAY_MS = 500;
export const COMMAND_HOLD_MS = 800;

export type SearchPhase = "spin" | "forward";
export type MissionPhase = "confirm" | "commit" | "center" | "approach" | "intake";
export type MoveCommand =
  | "CMD:MOVE:FORWARD"
  | "CMD:MOVE:BACK"
  | "CMD:MOVE:LEFT"
  | "CMD:MOVE:RIGHT"
  | "CMD:MOVE:STOP";

export interface SearchState {
  phase: SearchPhase;
  startedAt: number;
}

export function beginSearch(now: number): SearchState {
  return { phase: "spin", startedAt: now };
}

export function steerLockedTarget(
  px: number,
  py: number,
  holding: "left" | "right" | "forward" | null = null
): {
  direction: "left" | "right" | "forward";
  command: MoveCommand;
  collect: boolean;
} {
  if (py >= INTAKE_Y) {
    return { direction: "forward", command: "CMD:MOVE:FORWARD", collect: true };
  }
  const leftLimit = holding === "left" ? 90 : VIEW_LEFT;
  const rightLimit = holding === "right" ? 550 : VIEW_RIGHT;
  if (px < leftLimit) {
    return { direction: "left", command: "CMD:MOVE:LEFT", collect: false };
  }
  if (px > rightLimit) {
    return { direction: "right", command: "CMD:MOVE:RIGHT", collect: false };
  }
  return { direction: "forward", command: "CMD:MOVE:FORWARD", collect: false };
}

export interface MissionClock {
  phase: MissionPhase;
  trackKey: string;
  seenMs: number;
  lastTick: number;
  heldCommand: MoveCommand | null;
  heldDirection: "left" | "right" | "forward" | null;
  heldSince: number;
}

export interface MissionStep {
  clock: MissionClock;
  command: MoveCommand;
  direction: "left" | "right" | "forward" | null;
  phase: MissionPhase | "collect";
}

export function beginMission(now: number, trackKey: string): MissionClock {
  return {
    phase: "confirm",
    trackKey,
    seenMs: 0,
    lastTick: now,
    heldCommand: "CMD:MOVE:STOP",
    heldDirection: null,
    heldSince: now,
  };
}

export function pauseMission(clock: MissionClock, now: number): MissionClock {
  return { ...clock, lastTick: now };
}

function seenFor(clock: MissionClock, now: number): number {
  const gap = now - clock.lastTick;
  const step = gap < 0 ? 0 : gap > 250 ? 250 : gap;
  return clock.seenMs + step;
}

function isCentered(px: number, holding: "left" | "right" | "forward" | null): boolean {
  if (holding === "left") {
    return px >= CENTER_X - 30;
  }
  if (holding === "right") {
    return px <= CENTER_X + 30;
  }
  return px >= CENTER_X - CENTER_BAND && px <= CENTER_X + CENTER_BAND;
}

function stepCenter(clock: MissionClock, now: number, px: number, py: number): MissionStep {
  if (isCentered(px, clock.heldDirection)) {
    const approach: MissionClock = {
      ...clock,
      phase: "approach",
      seenMs: 0,
      lastTick: now,
      heldCommand: null,
      heldDirection: null,
      heldSince: now,
    };
    return stepApproach(approach, now, px, py);
  }

  const direction = px < CENTER_X ? "left" : "right";
  const command = direction === "left" ? "CMD:MOVE:LEFT" : "CMD:MOVE:RIGHT";
  const next: MissionClock = {
    ...clock,
    phase: "center",
    lastTick: now,
    heldCommand: command,
    heldDirection: direction,
    heldSince: clock.heldCommand === command ? clock.heldSince : now,
  };
  return { clock: next, command, direction, phase: "center" };
}

function stepApproach(clock: MissionClock, now: number, px: number, py: number): MissionStep {
  const steer = steerLockedTarget(px, py, clock.heldDirection);
  if (steer.collect) {
    const intake: MissionClock = {
      ...clock,
      phase: "intake",
      seenMs: 0,
      lastTick: now,
      heldCommand: "CMD:MOVE:FORWARD",
      heldDirection: "forward",
      heldSince: now,
    };
    return { clock: intake, command: "CMD:MOVE:FORWARD", direction: "forward", phase: "intake" };
  }

  const age = now - clock.heldSince;
  const leavingFrame = steer.direction === "left" || steer.direction === "right";
  const keepHold =
    clock.heldCommand !== null &&
    clock.heldDirection !== null &&
    age < COMMAND_HOLD_MS &&
    !(leavingFrame && clock.heldDirection === "forward");

  if (keepHold && clock.heldCommand && clock.heldDirection) {
    return {
      clock: { ...clock, lastTick: now },
      command: clock.heldCommand,
      direction: clock.heldDirection,
      phase: "approach",
    };
  }

  const sameCommand = clock.heldCommand === steer.command;
  const next: MissionClock = {
    ...clock,
    phase: "approach",
    lastTick: now,
    heldCommand: steer.command,
    heldDirection: steer.direction,
    heldSince: sameCommand ? clock.heldSince : now,
  };
  return { clock: next, command: steer.command, direction: steer.direction, phase: "approach" };
}

export function advanceMission(clock: MissionClock, now: number, px: number, py: number): MissionStep {
  const seenMs = seenFor(clock, now);

  if (clock.phase === "confirm") {
    if (seenMs < CONFIRM_MS) {
      const waiting: MissionClock = { ...clock, seenMs, lastTick: now };
      return { clock: waiting, command: "CMD:MOVE:STOP", direction: null, phase: "confirm" };
    }
    const center: MissionClock = {
      ...clock,
      phase: "center",
      seenMs: 0,
      lastTick: now,
      heldCommand: null,
      heldDirection: null,
      heldSince: now,
    };
    return stepCenter(center, now, px, py);
  }

  if (clock.phase === "center") {
    return stepCenter({ ...clock, lastTick: now }, now, px, py);
  }

  if (clock.phase === "intake") {
    if (py < INTAKE_Y) {
      const back: MissionClock = {
        ...clock,
        phase: "approach",
        seenMs: 0,
        lastTick: now,
        heldCommand: null,
        heldDirection: null,
        heldSince: now,
      };
      return stepApproach(back, now, px, py);
    }
    if (seenMs < INTAKE_HOLD_MS) {
      const waiting: MissionClock = {
        ...clock,
        seenMs,
        lastTick: now,
        heldCommand: "CMD:MOVE:FORWARD",
        heldDirection: "forward",
      };
      return { clock: waiting, command: "CMD:MOVE:FORWARD", direction: "forward", phase: "intake" };
    }
    return { clock, command: "CMD:MOVE:FORWARD", direction: "forward", phase: "collect" };
  }

  return stepApproach({ ...clock, lastTick: now }, now, px, py);
}

export interface OilAlignStep {
  clock: MissionClock;
  command: MoveCommand;
  direction: "left" | "right" | null;
  phase: "confirm" | "center" | "spray";
}

// คราบน้ำมันไม่เดินหน้าลอดใต้กล้อง พออยู่กลางจอแล้วหยุดแล้วพ่น
export function advanceOilAlign(clock: MissionClock, now: number, px: number): OilAlignStep {
  const seenMs = seenFor(clock, now);
  if (clock.phase === "confirm") {
    if (seenMs < CONFIRM_MS) {
      return {
        clock: { ...clock, seenMs, lastTick: now },
        command: "CMD:MOVE:STOP",
        direction: null,
        phase: "confirm",
      };
    }
  }

  const holding = clock.phase === "center" ? clock.heldDirection : null;
  if (isCentered(px, holding)) {
    const stopped: MissionClock = {
      ...clock,
      phase: "center",
      seenMs: 0,
      lastTick: now,
      heldCommand: "CMD:MOVE:STOP",
      heldDirection: null,
      heldSince: now,
    };
    return { clock: stopped, command: "CMD:MOVE:STOP", direction: null, phase: "spray" };
  }

  const direction = px < CENTER_X ? "left" : "right";
  const command = direction === "left" ? "CMD:MOVE:LEFT" : "CMD:MOVE:RIGHT";
  const turning: MissionClock = {
    ...clock,
    phase: "center",
    seenMs: 0,
    lastTick: now,
    heldCommand: command,
    heldDirection: direction,
    heldSince: clock.heldCommand === command ? clock.heldSince : now,
  };
  return { clock: turning, command, direction, phase: "center" };
}

export function advanceSearch(state: SearchState, now: number): {
  state: SearchState;
  command: MoveCommand;
  direction: "right" | "forward";
} {
  const elapsed = now - state.startedAt;
  if (state.phase === "spin") {
    if (elapsed < SEARCH_SPIN_MS) {
      return { state, command: "CMD:MOVE:RIGHT", direction: "right" };
    }
    const forward: SearchState = { phase: "forward", startedAt: now };
    return { state: forward, command: "CMD:MOVE:FORWARD", direction: "forward" };
  }

  if (elapsed < SEARCH_FORWARD_MS) {
    return { state, command: "CMD:MOVE:FORWARD", direction: "forward" };
  }

  const spin: SearchState = { phase: "spin", startedAt: now };
  return { state: spin, command: "CMD:MOVE:RIGHT", direction: "right" };
}
