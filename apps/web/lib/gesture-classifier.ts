import { normalizedToMirroredNdc, type Vec2 } from "@/lib/hand-signals";
import type {
  NormalizedHand,
  NormalizedHandLandmark,
} from "@/lib/hand-worker-protocol";

export type GestureFixtureName =
  | "conflicting-gesture"
  | "empty-space-grab"
  | "grab-release"
  | "hand-loss-mid-grab"
  | "idle"
  | "pointing"
  | "stable-pinch"
  | "noisy-pinch"
  | "noisy-depth"
  | "open-palm"
  | "orbit"
  | "pan"
  | "left-swipe"
  | "right-swipe"
  | "hand-loss"
  | "zoom-in"
  | "zoom-out";

export type TimestampedLandmarkFrame = {
  hand: NormalizedHand | null;
  label?: string;
  timestampMs: number;
};

export type LandmarkSource = {
  reset: (startAtMs?: number) => void;
  sample: (nowMs: number) => TimestampedLandmarkFrame;
};

export type GestureFixture = {
  frames: TimestampedLandmarkFrame[];
  name: GestureFixtureName;
};

export type GestureFixtureFile = {
  fixtures: CompactGestureFixture[];
  templates: Record<string, CompactLandmark[]>;
  version: 1;
};

export type CompactGestureFixture = {
  frames: CompactGestureFrame[];
  name: GestureFixtureName;
};

export type CompactGestureFrame = {
  hand?: null;
  handedness?: string | null;
  label?: string;
  offset?: [number, number];
  scale?: number;
  score?: number;
  t: number;
  template?: string;
};

export type CompactLandmark = [number, number] | [number, number, number];

export type FingerName = "thumb" | "index" | "middle" | "ring" | "pinky";

export type FingerExtension = {
  extended: boolean;
  score: number;
};

export type NormalizedClassifierInput = {
  confidence: number;
  fingers: Record<FingerName, FingerExtension>;
  hand: NormalizedHand | null;
  palmCenter: Vec2 | null;
  palmScale: number;
  timestampMs: number;
};

export type TimestampedPoint = {
  point: Vec2;
  timestampMs: number;
};

export type BooleanDebounceState = {
  candidate: boolean;
  candidateSinceMs: number;
  value: boolean;
};

const landmarkIndex = {
  indexMcp: 5,
  middleMcp: 9,
  pinkyMcp: 17,
  wrist: 0,
} as const;

const fingerDefinitions = {
  index: { mcp: 5, pip: 6, tip: 8 },
  middle: { mcp: 9, pip: 10, tip: 12 },
  pinky: { mcp: 17, pip: 18, tip: 20 },
  ring: { mcp: 13, pip: 14, tip: 16 },
  thumb: { mcp: 2, pip: 3, tip: 4 },
} as const satisfies Record<
  FingerName,
  { mcp: number; pip: number; tip: number }
>;

export function expandGestureFixtures(
  file: GestureFixtureFile,
): GestureFixture[] {
  return file.fixtures.map((fixture) => ({
    frames: fixture.frames.map((frame) =>
      expandGestureFrame(frame, file.templates),
    ),
    name: fixture.name,
  }));
}

export function findGestureFixture(
  fixtures: readonly GestureFixture[],
  name: GestureFixtureName,
): GestureFixture {
  const fixture = fixtures.find((candidate) => candidate.name === name);
  if (!fixture) {
    throw new Error(`Missing gesture fixture: ${name}`);
  }
  return fixture;
}

export function createGesturePlayback(
  fixture: GestureFixture,
  options: {
    loop?: boolean;
    startAtMs?: number;
    timeScale?: number;
  } = {},
): LandmarkSource {
  let startAtMs = options.startAtMs ?? 0;
  const timeScale = options.timeScale ?? 1;
  const durationMs =
    fixture.frames[fixture.frames.length - 1]?.timestampMs ??
    fixture.frames[0]?.timestampMs ??
    0;

  return {
    reset: (nextStartAtMs = startAtMs) => {
      startAtMs = nextStartAtMs;
    },
    sample: (nowMs: number) => {
      if (fixture.frames.length === 0) {
        return { hand: null, timestampMs: 0 };
      }

      const elapsedMs = Math.max(0, (nowMs - startAtMs) * timeScale);
      const fixtureTime =
        options.loop && durationMs > 0 ? elapsedMs % durationMs : elapsedMs;
      return (
        [...fixture.frames]
          .reverse()
          .find((frame) => frame.timestampMs <= fixtureTime) ??
        fixture.frames[0]!
      );
    },
  };
}

export function normalizeClassifierInput(
  frame: TimestampedLandmarkFrame,
): NormalizedClassifierInput {
  if (!frame.hand) {
    return {
      confidence: 0,
      fingers: emptyFingerExtensions(),
      hand: null,
      palmCenter: null,
      palmScale: 0,
      timestampMs: frame.timestampMs,
    };
  }

  const hand = frame.hand;
  return {
    confidence: poseConfidence(hand),
    fingers: {
      index: fingerExtension(hand, "index"),
      middle: fingerExtension(hand, "middle"),
      pinky: fingerExtension(hand, "pinky"),
      ring: fingerExtension(hand, "ring"),
      thumb: fingerExtension(hand, "thumb"),
    },
    hand,
    palmCenter: palmCenter(hand),
    palmScale: palmScale(hand),
    timestampMs: frame.timestampMs,
  };
}

export function palmScale(hand: NormalizedHand): number {
  const indexMcp = hand.landmarks[landmarkIndex.indexMcp];
  const pinkyMcp = hand.landmarks[landmarkIndex.pinkyMcp];
  if (indexMcp && pinkyMcp) {
    return Math.max(0.001, distance2d(indexMcp, pinkyMcp));
  }

  const wrist = hand.landmarks[landmarkIndex.wrist];
  const middleMcp = hand.landmarks[landmarkIndex.middleMcp];
  return wrist && middleMcp ? Math.max(0.001, distance2d(wrist, middleMcp)) : 0;
}

export function palmCenter(hand: NormalizedHand): Vec2 | null {
  const wrist = hand.landmarks[landmarkIndex.wrist];
  const indexMcp = hand.landmarks[landmarkIndex.indexMcp];
  const pinkyMcp = hand.landmarks[landmarkIndex.pinkyMcp];
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

export function fingerExtension(
  hand: NormalizedHand,
  finger: FingerName,
  threshold = 0.5,
): FingerExtension {
  const definition = fingerDefinitions[finger];
  const mcp = hand.landmarks[definition.mcp];
  const pip = hand.landmarks[definition.pip];
  const tip = hand.landmarks[definition.tip];
  const scale = palmScale(hand);
  if (!mcp || !pip || !tip || scale <= 0) {
    return { extended: false, score: 0 };
  }

  const score =
    finger === "thumb"
      ? clamp(distance2d(tip, mcp) / scale, 0, 1)
      : clamp((pip.y - tip.y) / scale, 0, 1);
  return {
    extended: score >= threshold,
    score,
  };
}

export function poseConfidence(hand: NormalizedHand): number {
  const visibilityConfidence =
    hand.landmarks.reduce((total, landmark) => {
      return total + (landmark.visibility ?? 1);
    }, 0) / Math.max(1, hand.landmarks.length);
  return clamp((hand.score ?? 1) * visibilityConfidence, 0, 1);
}

export function velocityWindow(
  samples: readonly TimestampedPoint[],
  windowMs: number,
): Vec2 {
  if (samples.length < 2) {
    return { x: 0, y: 0 };
  }

  const latest = samples[samples.length - 1]!;
  const earliest =
    samples.find(
      (sample) => latest.timestampMs - sample.timestampMs <= windowMs,
    ) ?? samples[0]!;
  const elapsedSeconds = Math.max(
    0.001,
    (latest.timestampMs - earliest.timestampMs) / 1000,
  );
  return {
    x: (latest.point.x - earliest.point.x) / elapsedSeconds,
    y: (latest.point.y - earliest.point.y) / elapsedSeconds,
  };
}

export function createBooleanDebounceState(
  initialValue = false,
  timestampMs = 0,
): BooleanDebounceState {
  return {
    candidate: initialValue,
    candidateSinceMs: timestampMs,
    value: initialValue,
  };
}

export function updateBooleanDebounce(
  state: BooleanDebounceState,
  nextCandidate: boolean,
  timestampMs: number,
  holdMs: number,
): BooleanDebounceState {
  if (nextCandidate !== state.candidate) {
    return {
      candidate: nextCandidate,
      candidateSinceMs: timestampMs,
      value: state.value,
    };
  }

  if (
    nextCandidate !== state.value &&
    timestampMs - state.candidateSinceMs >= holdMs
  ) {
    return {
      candidate: nextCandidate,
      candidateSinceMs: state.candidateSinceMs,
      value: nextCandidate,
    };
  }

  return state;
}

export function cooldownReady(input: {
  cooldownMs: number;
  lastTriggeredAtMs: number | null;
  nowMs: number;
}): boolean {
  return (
    input.lastTriggeredAtMs == null ||
    input.nowMs - input.lastTriggeredAtMs >= input.cooldownMs
  );
}

function expandGestureFrame(
  frame: CompactGestureFrame,
  templates: Record<string, CompactLandmark[]>,
): TimestampedLandmarkFrame {
  if (frame.hand === null) {
    return {
      hand: null,
      label: frame.label,
      timestampMs: frame.t,
    };
  }

  if (!frame.template || !templates[frame.template]) {
    throw new Error(`Missing gesture template for frame at ${frame.t}ms`);
  }

  const [offsetX, offsetY] = frame.offset ?? [0, 0];
  const scale = frame.scale ?? 1;
  const anchorX = 0.5;
  const anchorY = 0.6;
  return {
    hand: {
      handedness: frame.handedness ?? "Right",
      landmarks: templates[frame.template].map(([x, y, z = 0]) => ({
        visibility: null,
        x: clamp(anchorX + (x - anchorX) * scale + offsetX, 0, 1),
        y: clamp(anchorY + (y - anchorY) * scale + offsetY, 0, 1),
        z,
      })),
      score: frame.score ?? 0.9,
    },
    label: frame.label,
    timestampMs: frame.t,
  };
}

function emptyFingerExtensions(): Record<FingerName, FingerExtension> {
  return {
    index: { extended: false, score: 0 },
    middle: { extended: false, score: 0 },
    pinky: { extended: false, score: 0 },
    ring: { extended: false, score: 0 },
    thumb: { extended: false, score: 0 },
  };
}

function distance2d(
  left: Pick<NormalizedHandLandmark, "x" | "y">,
  right: Pick<NormalizedHandLandmark, "x" | "y">,
): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
