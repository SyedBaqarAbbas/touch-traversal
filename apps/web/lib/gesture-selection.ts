import {
  normalizeClassifierInput,
  palmScale,
  type NormalizedClassifierInput,
  type TimestampedLandmarkFrame,
} from "@/lib/gesture-classifier";
import type { NormalizedHand } from "@/lib/hand-worker-protocol";

export type PointingConfig = {
  cursorConfidenceFloor: number;
  foldedFingerMaxExtension: number;
  indexExtensionMin: number;
  poseConfidenceFloor: number;
};

export type PointingIntent = {
  confidence: number;
  cursorUsable: boolean;
  foldedScore: number;
  indexScore: number;
  pointing: boolean;
};

export type PinchConfig = {
  debounceMs: number;
  endRatio: number;
  startRatio: number;
};

export type PinchPhase = "pressed" | "released";

export type PinchSelectionState = {
  candidatePhase: PinchPhase;
  candidateSinceMs: number;
  phase: PinchPhase;
};

export type PinchSelectionEvent = {
  phase: PinchPhase;
  ratio: number;
  timestampMs: number;
  type: "begin" | "hold" | "release";
};

export type PinchSelectionUpdate = {
  event: PinchSelectionEvent | null;
  ratio: number;
  state: PinchSelectionState;
};

export const defaultPointingConfig: PointingConfig = {
  cursorConfidenceFloor: 0.24,
  foldedFingerMaxExtension: 0.46,
  indexExtensionMin: 0.54,
  poseConfidenceFloor: 0.34,
};

export const defaultPinchConfig: PinchConfig = {
  debounceMs: 160,
  endRatio: 0.38,
  startRatio: 0.28,
};

const thumbTipIndex = 4;
const indexTipIndex = 8;

export function createPinchSelectionState(
  timestampMs = 0,
): PinchSelectionState {
  return {
    candidatePhase: "released",
    candidateSinceMs: timestampMs,
    phase: "released",
  };
}

export function classifyPointingIntent(
  input: NormalizedClassifierInput,
  config: PointingConfig = defaultPointingConfig,
): PointingIntent {
  const otherFingerScores = [
    input.fingers.middle.score,
    input.fingers.ring.score,
    input.fingers.pinky.score,
  ];
  const foldedScore = 1 - Math.max(...otherFingerScores);
  const indexScore = input.fingers.index.score;
  const cursorUsable =
    input.confidence >= config.cursorConfidenceFloor &&
    indexScore >= config.indexExtensionMin * 0.68;
  const pointing =
    input.confidence >= config.poseConfidenceFloor &&
    indexScore >= config.indexExtensionMin &&
    otherFingerScores.every(
      (score) => score <= config.foldedFingerMaxExtension,
    );

  return {
    confidence: input.confidence,
    cursorUsable,
    foldedScore,
    indexScore,
    pointing,
  };
}

export function classifyPointingFrame(
  frame: TimestampedLandmarkFrame,
  config: PointingConfig = defaultPointingConfig,
): PointingIntent {
  return classifyPointingIntent(normalizeClassifierInput(frame), config);
}

export function pinchRatio(hand: NormalizedHand | null): number {
  if (!hand) {
    return Number.POSITIVE_INFINITY;
  }

  const thumbTip = hand.landmarks[thumbTipIndex];
  const indexTip = hand.landmarks[indexTipIndex];
  const scale = palmScale(hand);
  if (!thumbTip || !indexTip || scale <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y) / scale;
}

export function updatePinchSelection(
  state: PinchSelectionState,
  frame: TimestampedLandmarkFrame,
  config: PinchConfig = defaultPinchConfig,
): PinchSelectionUpdate {
  const ratio = pinchRatio(frame.hand);
  if (!frame.hand) {
    const nextState = {
      candidatePhase: "released" as const,
      candidateSinceMs: frame.timestampMs,
      phase: "released" as const,
    };
    return {
      event:
        state.phase === "pressed"
          ? {
              phase: "released",
              ratio,
              timestampMs: frame.timestampMs,
              type: "release",
            }
          : null,
      ratio,
      state: nextState,
    };
  }

  const candidatePhase = nextPinchCandidatePhase(state.phase, ratio, config);
  const candidateSinceMs =
    candidatePhase === state.candidatePhase
      ? state.candidateSinceMs
      : frame.timestampMs;
  const shouldCommit =
    candidatePhase !== state.phase &&
    frame.timestampMs - candidateSinceMs >= config.debounceMs;
  const nextPhase = shouldCommit ? candidatePhase : state.phase;
  const nextState = {
    candidatePhase,
    candidateSinceMs,
    phase: nextPhase,
  };

  return {
    event: pinchEventForTransition({
      frame,
      nextPhase,
      previousPhase: state.phase,
      ratio,
    }),
    ratio,
    state: nextState,
  };
}

export function runPinchSelection(
  frames: readonly TimestampedLandmarkFrame[],
  config: PinchConfig = defaultPinchConfig,
): PinchSelectionEvent[] {
  let state = createPinchSelectionState(frames[0]?.timestampMs ?? 0);
  const events: PinchSelectionEvent[] = [];
  for (const frame of frames) {
    const update = updatePinchSelection(state, frame, config);
    state = update.state;
    if (update.event) {
      events.push(update.event);
    }
  }
  return events;
}

function nextPinchCandidatePhase(
  phase: PinchPhase,
  ratio: number,
  config: PinchConfig,
): PinchPhase {
  if (phase === "pressed") {
    return ratio >= config.endRatio ? "released" : "pressed";
  }
  return ratio <= config.startRatio ? "pressed" : "released";
}

function pinchEventForTransition({
  frame,
  nextPhase,
  previousPhase,
  ratio,
}: {
  frame: TimestampedLandmarkFrame;
  nextPhase: PinchPhase;
  previousPhase: PinchPhase;
  ratio: number;
}): PinchSelectionEvent | null {
  if (previousPhase === "released" && nextPhase === "pressed") {
    return {
      phase: nextPhase,
      ratio,
      timestampMs: frame.timestampMs,
      type: "begin",
    };
  }
  if (previousPhase === "pressed" && nextPhase === "released") {
    return {
      phase: nextPhase,
      ratio,
      timestampMs: frame.timestampMs,
      type: "release",
    };
  }
  if (nextPhase === "pressed") {
    return {
      phase: nextPhase,
      ratio,
      timestampMs: frame.timestampMs,
      type: "hold",
    };
  }
  return null;
}
