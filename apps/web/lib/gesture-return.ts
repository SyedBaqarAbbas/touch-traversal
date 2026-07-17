import {
  normalizeClassifierInput,
  palmScale,
  type NormalizedClassifierInput,
  type TimestampedLandmarkFrame,
} from "@/lib/gesture-classifier";

export type OpenPalmReturnConfig = {
  fingerExtensionMin: number;
  holdMs: number;
  poseConfidenceFloor: number;
  thumbSeparationMin: number;
};

export type OpenPalmPose = {
  confidence: number;
  open: boolean;
  thumbSeparated: boolean;
};

export type OpenPalmReturnState = {
  holdStartedAtMs: number | null;
  progress: number;
  triggered: boolean;
};

export type OpenPalmReturnEvent = {
  progress: number;
  timestampMs: number;
  type: "return";
};

export type OpenPalmReturnUpdate = {
  event: OpenPalmReturnEvent | null;
  pose: OpenPalmPose;
  state: OpenPalmReturnState;
};

export const defaultOpenPalmReturnConfig: OpenPalmReturnConfig = {
  fingerExtensionMin: 0.52,
  holdMs: 480,
  poseConfidenceFloor: 0.38,
  thumbSeparationMin: 0.58,
};

const thumbTipIndex = 4;
const indexMcpIndex = 5;

export function createOpenPalmReturnState(): OpenPalmReturnState {
  return {
    holdStartedAtMs: null,
    progress: 0,
    triggered: false,
  };
}

export function classifyOpenPalmPose(
  input: NormalizedClassifierInput,
  config: OpenPalmReturnConfig = defaultOpenPalmReturnConfig,
): OpenPalmPose {
  if (!input.hand) {
    return {
      confidence: 0,
      open: false,
      thumbSeparated: false,
    };
  }

  const fourFingersExtended =
    input.fingers.index.score >= config.fingerExtensionMin &&
    input.fingers.middle.score >= config.fingerExtensionMin &&
    input.fingers.ring.score >= config.fingerExtensionMin &&
    input.fingers.pinky.score >= config.fingerExtensionMin;
  const thumbSeparated =
    input.fingers.thumb.score >= config.fingerExtensionMin ||
    thumbSeparationScore(input) >= config.thumbSeparationMin;
  const confidence = input.confidence;

  return {
    confidence,
    open:
      confidence >= config.poseConfidenceFloor &&
      fourFingersExtended &&
      thumbSeparated,
    thumbSeparated,
  };
}

export function classifyOpenPalmFrame(
  frame: TimestampedLandmarkFrame,
  config: OpenPalmReturnConfig = defaultOpenPalmReturnConfig,
): OpenPalmPose {
  return classifyOpenPalmPose(normalizeClassifierInput(frame), config);
}

export function updateOpenPalmReturn(
  state: OpenPalmReturnState,
  frame: TimestampedLandmarkFrame,
  context: { safeToReturn: boolean },
  config: OpenPalmReturnConfig = defaultOpenPalmReturnConfig,
): OpenPalmReturnUpdate {
  const pose = classifyOpenPalmFrame(frame, config);
  if (!context.safeToReturn || !pose.open) {
    return {
      event: null,
      pose,
      state: createOpenPalmReturnState(),
    };
  }

  const holdStartedAtMs = state.holdStartedAtMs ?? frame.timestampMs;
  const progress = Math.min(
    1,
    Math.max(0, (frame.timestampMs - holdStartedAtMs) / config.holdMs),
  );
  const shouldTrigger = progress >= 1 && !state.triggered;
  const nextState = {
    holdStartedAtMs,
    progress,
    triggered: state.triggered || shouldTrigger,
  };

  return {
    event: shouldTrigger
      ? {
          progress,
          timestampMs: frame.timestampMs,
          type: "return",
        }
      : null,
    pose,
    state: nextState,
  };
}

export function runOpenPalmReturn(
  frames: readonly TimestampedLandmarkFrame[],
  context: { safeToReturn: boolean },
  config: OpenPalmReturnConfig = defaultOpenPalmReturnConfig,
): OpenPalmReturnEvent[] {
  let state = createOpenPalmReturnState();
  const events: OpenPalmReturnEvent[] = [];
  for (const frame of frames) {
    const update = updateOpenPalmReturn(state, frame, context, config);
    state = update.state;
    if (update.event) {
      events.push(update.event);
    }
  }
  return events;
}

function thumbSeparationScore(input: NormalizedClassifierInput): number {
  const hand = input.hand;
  if (!hand) {
    return 0;
  }

  const thumbTip = hand.landmarks[thumbTipIndex];
  const indexMcp = hand.landmarks[indexMcpIndex];
  const scale = palmScale(hand);
  if (!thumbTip || !indexMcp || scale <= 0) {
    return 0;
  }

  return Math.min(
    1,
    Math.hypot(thumbTip.x - indexMcp.x, thumbTip.y - indexMcp.y) / scale,
  );
}
