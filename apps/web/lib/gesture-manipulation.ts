import {
  normalizeClassifierInput,
  type TimestampedLandmarkFrame,
} from "@/lib/gesture-classifier";
import type { PinchPhase, PinchSelectionEvent } from "@/lib/gesture-selection";

export type HandManipulationDelta = {
  orbitYaw: number;
  panY: number;
  zoom: number;
};

export type HandManipulationPhase = "grabbed" | "idle";

export type HandManipulationCancelReason = "conflict" | "hand-loss" | "release";

export type HandManipulationEvent =
  | {
      phase: "begin";
      timestampMs: number;
    }
  | {
      delta: HandManipulationDelta;
      firstMotion: boolean;
      phase: "update";
      timestampMs: number;
    }
  | {
      phase: "end";
      reason: "release";
      timestampMs: number;
    }
  | {
      phase: "cancel";
      reason: Exclude<HandManipulationCancelReason, "release">;
      timestampMs: number;
    };

export type HandManipulationState = {
  anchorPalmScale: number;
  appliedZoom: number;
  firstMotionReported: boolean;
  lastPalmCenter: { x: number; y: number } | null;
  phase: HandManipulationPhase;
  smoothedPalmCenter: { x: number; y: number } | null;
  smoothedPalmScale: number;
  startedAtMs: number | null;
};

export type HandManipulationContext = {
  allowed: boolean;
  pinchEvent: PinchSelectionEvent | null;
  pinchPhase: PinchPhase;
  targetNodeId: string | null;
};

export type HandManipulationConfig = {
  centerSmoothingAlpha: number;
  depthDeadZoneRatio: number;
  depthRangeRatio: number;
  maxOrbitDeltaRadians: number;
  maxPanDelta: number;
  motionDeadZonePalmRatio: number;
  orbitRadiansPerPalm: number;
  panUnitsPerPalm: number;
  scaleSmoothingAlpha: number;
  zoomRange: number;
};

export type HandManipulationUpdate = {
  event: HandManipulationEvent | null;
  state: HandManipulationState;
};

export const defaultHandManipulationConfig: HandManipulationConfig = {
  centerSmoothingAlpha: 0.42,
  depthDeadZoneRatio: 0.045,
  depthRangeRatio: 0.45,
  maxOrbitDeltaRadians: 0.14,
  maxPanDelta: 0.1,
  motionDeadZonePalmRatio: 0.018,
  orbitRadiansPerPalm: 0.82,
  panUnitsPerPalm: 0.52,
  scaleSmoothingAlpha: 0.32,
  zoomRange: 0.9,
};

const emptyDelta: HandManipulationDelta = {
  orbitYaw: 0,
  panY: 0,
  zoom: 0,
};

export function createHandManipulationState(): HandManipulationState {
  return {
    anchorPalmScale: 0,
    appliedZoom: 0,
    firstMotionReported: false,
    lastPalmCenter: null,
    phase: "idle",
    smoothedPalmCenter: null,
    smoothedPalmScale: 0,
    startedAtMs: null,
  };
}

export function updateHandManipulation(
  state: HandManipulationState,
  frame: TimestampedLandmarkFrame,
  context: HandManipulationContext,
  config: HandManipulationConfig = defaultHandManipulationConfig,
): HandManipulationUpdate {
  if (state.phase === "grabbed") {
    if (!frame.hand) {
      return cancelManipulation(frame.timestampMs, "hand-loss");
    }
    if (!context.allowed) {
      return cancelManipulation(frame.timestampMs, "conflict");
    }
    if (context.pinchPhase === "released") {
      return {
        event: {
          phase: "end",
          reason: "release",
          timestampMs: frame.timestampMs,
        },
        state: createHandManipulationState(),
      };
    }
    return updateGrabbedManipulation(state, frame, config);
  }

  if (
    !context.allowed ||
    context.targetNodeId !== null ||
    context.pinchEvent?.type !== "begin" ||
    !frame.hand
  ) {
    return { event: null, state };
  }

  const normalized = normalizeClassifierInput(frame);
  if (!normalized.palmCenter || normalized.palmScale <= 0) {
    return { event: null, state };
  }

  return {
    event: { phase: "begin", timestampMs: frame.timestampMs },
    state: {
      anchorPalmScale: normalized.palmScale,
      appliedZoom: 0,
      firstMotionReported: false,
      lastPalmCenter: normalized.palmCenter,
      phase: "grabbed",
      smoothedPalmCenter: normalized.palmCenter,
      smoothedPalmScale: normalized.palmScale,
      startedAtMs: frame.timestampMs,
    },
  };
}

function updateGrabbedManipulation(
  state: HandManipulationState,
  frame: TimestampedLandmarkFrame,
  config: HandManipulationConfig,
): HandManipulationUpdate {
  const normalized = normalizeClassifierInput(frame);
  if (!normalized.palmCenter || normalized.palmScale <= 0) {
    return cancelManipulation(frame.timestampMs, "hand-loss");
  }

  const previousCenter = state.smoothedPalmCenter ?? normalized.palmCenter;
  const smoothedCenter = {
    x: lerp(
      previousCenter.x,
      normalized.palmCenter.x,
      config.centerSmoothingAlpha,
    ),
    y: lerp(
      previousCenter.y,
      normalized.palmCenter.y,
      config.centerSmoothingAlpha,
    ),
  };
  const smoothedPalmScale = lerp(
    state.smoothedPalmScale,
    normalized.palmScale,
    config.scaleSmoothingAlpha,
  );
  const motionScale = Math.max(0.04, smoothedPalmScale);
  const motionX = (smoothedCenter.x - previousCenter.x) / motionScale;
  const motionY = (smoothedCenter.y - previousCenter.y) / motionScale;
  const orbitYaw = deadZone(motionX, config.motionDeadZonePalmRatio);
  const panY = deadZone(motionY, config.motionDeadZonePalmRatio);
  const depthRatio = smoothedPalmScale / state.anchorPalmScale - 1;
  const desiredZoom =
    (deadZone(depthRatio, config.depthDeadZoneRatio) /
      Math.max(config.depthRangeRatio, 0.01)) *
    config.zoomRange;
  const zoomDelta = desiredZoom - state.appliedZoom;
  const delta = {
    orbitYaw: clamp(
      orbitYaw * config.orbitRadiansPerPalm,
      -config.maxOrbitDeltaRadians,
      config.maxOrbitDeltaRadians,
    ),
    panY: clamp(
      -panY * config.panUnitsPerPalm,
      -config.maxPanDelta,
      config.maxPanDelta,
    ),
    zoom: clamp(zoomDelta, -config.zoomRange, config.zoomRange),
  };
  const meaningful = hasMeaningfulDelta(delta);
  const firstMotion = meaningful && !state.firstMotionReported;

  return {
    event: meaningful
      ? {
          delta,
          firstMotion,
          phase: "update",
          timestampMs: frame.timestampMs,
        }
      : null,
    state: {
      ...state,
      appliedZoom: meaningful ? desiredZoom : state.appliedZoom,
      firstMotionReported: state.firstMotionReported || firstMotion,
      lastPalmCenter: normalized.palmCenter,
      smoothedPalmCenter: smoothedCenter,
      smoothedPalmScale,
    },
  };
}

function cancelManipulation(
  timestampMs: number,
  reason: "conflict" | "hand-loss",
): HandManipulationUpdate {
  return {
    event: { phase: "cancel", reason, timestampMs },
    state: createHandManipulationState(),
  };
}

function deadZone(value: number, threshold: number): number {
  if (Math.abs(value) <= threshold) {
    return 0;
  }
  return Math.sign(value) * (Math.abs(value) - threshold);
}

function hasMeaningfulDelta(delta: HandManipulationDelta): boolean {
  return (
    Math.abs(delta.orbitYaw) > 0.0001 ||
    Math.abs(delta.panY) > 0.0001 ||
    Math.abs(delta.zoom) > 0.0001
  );
}

function lerp(left: number, right: number, alpha: number): number {
  return left + (right - left) * clamp(alpha, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function emptyHandManipulationDelta(): HandManipulationDelta {
  return { ...emptyDelta };
}
