import type { HandSignal, Vec2 } from "@/lib/hand-signals";

export type HandCursorStatus =
  "idle" | "acquiring" | "tracking" | "low-confidence" | "lost";

export type HandCursorFrame = {
  confidence: number;
  pinchProgress: number;
  position: Vec2;
  status: HandCursorStatus;
  timestampMs: number;
  visible: boolean;
};

export type HandCursorStatusInput = {
  cameraActive: boolean;
  lastSeenAtMs: number | null;
  lowConfidenceThreshold?: number;
  lostAfterMs?: number;
  nowMs: number;
  signal: Pick<HandSignal, "confidence"> | null;
};

export type HandCursorCopy = {
  label: string;
  tone: "muted" | "active" | "warning" | "lost";
};

const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.48;
const DEFAULT_LOST_AFTER_MS = 520;
const DEFAULT_CURSOR_LATENCY_MS = 42;
const PINCH_OPEN_DISTANCE = 0.78;
const PINCH_CLOSED_DISTANCE = 0.28;

export function classifyHandCursorStatus({
  cameraActive,
  lastSeenAtMs,
  lostAfterMs = DEFAULT_LOST_AFTER_MS,
  lowConfidenceThreshold = DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  nowMs,
  signal,
}: HandCursorStatusInput): HandCursorStatus {
  if (!cameraActive) {
    return "idle";
  }
  if (!signal || lastSeenAtMs == null) {
    return "acquiring";
  }
  if (nowMs - lastSeenAtMs > lostAfterMs || signal.confidence <= 0.08) {
    return "lost";
  }
  if (signal.confidence < lowConfidenceThreshold) {
    return "low-confidence";
  }
  return "tracking";
}

export function handCursorFrameFromSignal(input: {
  cameraActive: boolean;
  lastSeenAtMs: number | null;
  nowMs: number;
  signal: HandSignal | null;
}): HandCursorFrame | null {
  const status = classifyHandCursorStatus(input);
  const signal = input.signal;
  if (!signal) {
    return null;
  }

  return {
    confidence: clamp(signal.confidence, 0, 1),
    pinchProgress: pinchProgress(signal.pinchDistance),
    position: signal.fingertip,
    status,
    timestampMs: input.nowMs,
    visible: status !== "idle" && status !== "acquiring",
  };
}

export function interpolateHandCursorFrame(input: {
  latencyMs?: number;
  nowMs: number;
  previous: HandCursorFrame | null;
  target: HandCursorFrame;
}): HandCursorFrame {
  if (!input.previous) {
    return { ...input.target, timestampMs: input.nowMs };
  }

  const elapsedMs = Math.max(0, input.nowMs - input.previous.timestampMs);
  const latencyMs = Math.max(1, input.latencyMs ?? DEFAULT_CURSOR_LATENCY_MS);
  const alpha = 1 - Math.exp(-elapsedMs / latencyMs);
  return {
    ...input.target,
    confidence: lerp(input.previous.confidence, input.target.confidence, alpha),
    pinchProgress: lerp(
      input.previous.pinchProgress,
      input.target.pinchProgress,
      alpha,
    ),
    position: lerpVec2(input.previous.position, input.target.position, alpha),
    timestampMs: input.nowMs,
  };
}

export function handCursorScreenStyle(frame: HandCursorFrame): {
  left: string;
  top: string;
} {
  return {
    left: `${clamp(((frame.position.x + 1) / 2) * 100, 2, 98).toFixed(2)}%`,
    top: `${clamp(((1 - frame.position.y) / 2) * 100, 2, 98).toFixed(2)}%`,
  };
}

export function handCursorCopy(status: HandCursorStatus): HandCursorCopy {
  switch (status) {
    case "tracking":
      return { label: "hand tracking", tone: "active" };
    case "low-confidence":
      return { label: "hand low confidence", tone: "warning" };
    case "lost":
      return { label: "hand lost", tone: "lost" };
    case "acquiring":
      return { label: "acquiring hand", tone: "muted" };
    case "idle":
      return { label: "hand idle", tone: "muted" };
  }
}

export function pinchProgress(pinchDistance: number): number {
  return clamp(
    (PINCH_OPEN_DISTANCE - pinchDistance) /
      (PINCH_OPEN_DISTANCE - PINCH_CLOSED_DISTANCE),
    0,
    1,
  );
}

function lerpVec2(left: Vec2, right: Vec2, alpha: number): Vec2 {
  return {
    x: lerp(left.x, right.x, alpha),
    y: lerp(left.y, right.y, alpha),
  };
}

function lerp(left: number, right: number, alpha: number): number {
  return left + (right - left) * alpha;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
