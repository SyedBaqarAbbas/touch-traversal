import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";

export const HAND_LANDMARKER_MODEL_URL =
  "/models/hand_landmarker/hand_landmarker.task";
export const HAND_LANDMARKER_MODEL_SHA256 =
  "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1";
export const MEDIAPIPE_WASM_BASE_URL = "/vendor/mediapipe/tasks-vision/wasm";
export const HAND_WORKER_TARGET_FPS = 24;
export const HAND_WORKER_MIN_FPS = 15;
export const HAND_WORKER_MAX_FPS = 30;

export type NormalizedHandLandmark = {
  x: number;
  y: number;
  z: number;
  visibility: number | null;
};

export type NormalizedHand = {
  handedness: string | null;
  landmarks: NormalizedHandLandmark[];
  score: number | null;
};

export type HandWorkerInitMessage = {
  modelUrl?: string;
  type: "INIT";
  wasmBaseUrl?: string;
};

export type HandWorkerFrameMessage = {
  frame: ImageBitmap;
  height: number;
  timestampMs: number;
  type: "FRAME";
  width: number;
};

export type HandWorkerDisposeMessage = {
  type: "DISPOSE";
};

export type HandWorkerInboundMessage =
  HandWorkerInitMessage | HandWorkerFrameMessage | HandWorkerDisposeMessage;

export type HandWorkerReadyMessage = {
  modelUrl: string;
  type: "READY";
  wasmBaseUrl: string;
};

export type HandWorkerResultMessage = {
  hands: NormalizedHand[];
  height: number;
  inferenceMs: number;
  timestampMs: number;
  type: "RESULT";
  width: number;
};

export type HandWorkerErrorMessage = {
  message: string;
  phase: "init" | "inference" | "dispose";
  type: "ERROR";
};

export type HandWorkerDisposedMessage = {
  type: "DISPOSED";
};

export type HandWorkerOutboundMessage =
  | HandWorkerReadyMessage
  | HandWorkerResultMessage
  | HandWorkerErrorMessage
  | HandWorkerDisposedMessage;

export type HandWorkerResponsiveness = {
  inferenceFps: number;
  renderFps: number;
  targetSatisfied: boolean;
};

export function normalizeHandLandmarkerResult(
  result: HandLandmarkerResult,
): NormalizedHand[] {
  return result.landmarks.map((landmarks, index) => {
    const handedness = result.handedness[index]?.[0] ?? null;
    return {
      handedness: handedness?.categoryName ?? null,
      landmarks: landmarks.map((landmark) => ({
        visibility: landmark.visibility ?? null,
        x: landmark.x,
        y: landmark.y,
        z: landmark.z,
      })),
      score: handedness?.score ?? null,
    };
  });
}

export function shouldSubmitHandFrame(input: {
  lastSubmittedAtMs: number | null;
  nowMs: number;
  targetFps?: number;
}): boolean {
  if (input.lastSubmittedAtMs == null) {
    return true;
  }
  const targetFps = clamp(
    input.targetFps ?? HAND_WORKER_TARGET_FPS,
    HAND_WORKER_MIN_FPS,
    HAND_WORKER_MAX_FPS,
  );
  return input.nowMs - input.lastSubmittedAtMs >= 1000 / targetFps;
}

export function summarizeHandWorkerResponsiveness(input: {
  inferenceTimestampsMs: readonly number[];
  renderFrameTimestampsMs: readonly number[];
}): HandWorkerResponsiveness {
  const inferenceFps = averageFps(input.inferenceTimestampsMs);
  const renderFps = averageFps(input.renderFrameTimestampsMs);
  return {
    inferenceFps,
    renderFps,
    targetSatisfied:
      inferenceFps >= HAND_WORKER_MIN_FPS &&
      inferenceFps <= HAND_WORKER_MAX_FPS &&
      renderFps >= 45,
  };
}

function averageFps(timestampsMs: readonly number[]): number {
  if (timestampsMs.length < 2) {
    return 0;
  }
  const elapsedMs = timestampsMs[timestampsMs.length - 1]! - timestampsMs[0]!;
  if (elapsedMs <= 0) {
    return 0;
  }
  return ((timestampsMs.length - 1) / elapsedMs) * 1000;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
