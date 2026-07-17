import type {
  NormalizedHand,
  NormalizedHandLandmark,
} from "@/lib/hand-worker-protocol";

export type Vec2 = {
  x: number;
  y: number;
};

export type HandSignal = {
  confidence: number;
  fingertip: Vec2;
  palmCenter: Vec2;
  palmSize: number;
  pinchDistance: number;
  swipeVelocity: Vec2;
  timestampMs: number;
};

export type HandSmoothingConfig = {
  confidenceHalfLifeMs: number;
  fastAlpha: number;
  fastVelocity: number;
  slowAlpha: number;
};

export const defaultHandSmoothingConfig: HandSmoothingConfig = {
  confidenceHalfLifeMs: 180,
  fastAlpha: 0.58,
  fastVelocity: 3.2,
  slowAlpha: 0.18,
};

const landmarkIndex = {
  indexMcp: 5,
  indexTip: 8,
  middleMcp: 9,
  pinkyMcp: 17,
  thumbTip: 4,
  wrist: 0,
} as const;

export function normalizedToMirroredNdc(point: Pick<Vec2, "x" | "y">): Vec2 {
  return {
    x: 1 - point.x * 2,
    y: 1 - point.y * 2,
  };
}

export function extractHandSignal(
  hand: NormalizedHand,
  timestampMs: number,
  previous: HandSignal | null = null,
): HandSignal | null {
  const indexTip = hand.landmarks[landmarkIndex.indexTip];
  const thumbTip = hand.landmarks[landmarkIndex.thumbTip];
  const palmCenter = estimatePalmCenter(hand.landmarks);
  const palmSize = estimatePalmSize(hand.landmarks);
  if (!indexTip || !thumbTip || !palmCenter || palmSize <= 0) {
    return null;
  }

  const fingertip = normalizedToMirroredNdc(indexTip);
  const mirroredThumbTip = normalizedToMirroredNdc(thumbTip);
  const pinchDistance = distance(fingertip, mirroredThumbTip) / palmSize;
  const dtSeconds =
    previous == null
      ? 0
      : Math.max(0.001, (timestampMs - previous.timestampMs) / 1000);
  const swipeVelocity =
    previous == null
      ? { x: 0, y: 0 }
      : {
          x: (palmCenter.x - previous.palmCenter.x) / dtSeconds,
          y: (palmCenter.y - previous.palmCenter.y) / dtSeconds,
        };

  return {
    confidence: clamp(hand.score ?? 1, 0, 1),
    fingertip,
    palmCenter,
    palmSize,
    pinchDistance,
    swipeVelocity,
    timestampMs,
  };
}

export function smoothHandSignal(
  previous: HandSignal | null,
  next: HandSignal,
  config: HandSmoothingConfig = defaultHandSmoothingConfig,
): HandSignal {
  if (!previous) {
    return next;
  }

  const dtSeconds = Math.max(
    0.001,
    (next.timestampMs - previous.timestampMs) / 1000,
  );
  const fingertipVelocity =
    distance(previous.fingertip, next.fingertip) / dtSeconds;
  const fingertipAlpha = adaptiveAlpha(fingertipVelocity, config);
  const palmVelocity =
    distance(previous.palmCenter, next.palmCenter) / dtSeconds;
  const palmAlpha = adaptiveAlpha(palmVelocity, config);

  return {
    confidence: lerp(previous.confidence, next.confidence, 0.42),
    fingertip: lerpVec2(previous.fingertip, next.fingertip, fingertipAlpha),
    palmCenter: lerpVec2(previous.palmCenter, next.palmCenter, palmAlpha),
    palmSize: lerp(previous.palmSize, next.palmSize, 0.28),
    pinchDistance: lerp(previous.pinchDistance, next.pinchDistance, 0.34),
    swipeVelocity: lerpVec2(previous.swipeVelocity, next.swipeVelocity, 0.3),
    timestampMs: next.timestampMs,
  };
}

export function fadeHandSignal(
  previous: HandSignal,
  timestampMs: number,
  config: Pick<
    HandSmoothingConfig,
    "confidenceHalfLifeMs"
  > = defaultHandSmoothingConfig,
): HandSignal {
  const elapsedMs = Math.max(0, timestampMs - previous.timestampMs);
  const decay = Math.pow(0.5, elapsedMs / config.confidenceHalfLifeMs);
  return {
    ...previous,
    confidence: previous.confidence * decay,
    swipeVelocity: { x: 0, y: 0 },
    timestampMs,
  };
}

export function adaptiveAlpha(
  velocity: number,
  config: HandSmoothingConfig = defaultHandSmoothingConfig,
): number {
  const progress = clamp(velocity / config.fastVelocity, 0, 1);
  return lerp(config.slowAlpha, config.fastAlpha, progress);
}

function estimatePalmCenter(
  landmarks: readonly NormalizedHandLandmark[],
): Vec2 | null {
  const wrist = landmarks[landmarkIndex.wrist];
  const indexMcp = landmarks[landmarkIndex.indexMcp];
  const pinkyMcp = landmarks[landmarkIndex.pinkyMcp];
  if (!wrist || !indexMcp || !pinkyMcp) {
    return null;
  }

  const mirroredWrist = normalizedToMirroredNdc(wrist);
  const mirroredIndexMcp = normalizedToMirroredNdc(indexMcp);
  const mirroredPinkyMcp = normalizedToMirroredNdc(pinkyMcp);
  return {
    x: (mirroredWrist.x + mirroredIndexMcp.x + mirroredPinkyMcp.x) / 3,
    y: (mirroredWrist.y + mirroredIndexMcp.y + mirroredPinkyMcp.y) / 3,
  };
}

function estimatePalmSize(
  landmarks: readonly NormalizedHandLandmark[],
): number {
  const indexMcp = landmarks[landmarkIndex.indexMcp];
  const pinkyMcp = landmarks[landmarkIndex.pinkyMcp];
  if (indexMcp && pinkyMcp) {
    return Math.max(
      0.001,
      distance(
        normalizedToMirroredNdc(indexMcp),
        normalizedToMirroredNdc(pinkyMcp),
      ),
    );
  }

  const wrist = landmarks[landmarkIndex.wrist];
  const middleMcp = landmarks[landmarkIndex.middleMcp];
  if (wrist && middleMcp) {
    return Math.max(
      0.001,
      distance(
        normalizedToMirroredNdc(wrist),
        normalizedToMirroredNdc(middleMcp),
      ),
    );
  }

  return 0;
}

function distance(left: Vec2, right: Vec2): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
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
