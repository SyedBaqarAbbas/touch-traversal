/// <reference lib="webworker" />

import {
  FilesetResolver,
  HandLandmarker,
  type ImageSource,
} from "@mediapipe/tasks-vision";

import {
  HAND_LANDMARKER_MODEL_URL,
  MEDIAPIPE_WASM_BASE_URL,
  normalizeHandLandmarkerResult,
  type HandWorkerInboundMessage,
  type HandWorkerOutboundMessage,
} from "@/lib/hand-worker-protocol";

declare const self: DedicatedWorkerGlobalScope;

let handLandmarker: HandLandmarker | null = null;
let initPromise: Promise<void> | null = null;
let modelUrl = HAND_LANDMARKER_MODEL_URL;
let wasmBaseUrl = MEDIAPIPE_WASM_BASE_URL;

self.onmessage = (event: MessageEvent<HandWorkerInboundMessage>) => {
  void handleMessage(event.data);
};

async function handleMessage(message: HandWorkerInboundMessage) {
  switch (message.type) {
    case "INIT":
      modelUrl = message.modelUrl ?? HAND_LANDMARKER_MODEL_URL;
      wasmBaseUrl = message.wasmBaseUrl ?? MEDIAPIPE_WASM_BASE_URL;
      await initialize();
      return;
    case "FRAME":
      await runInference(message);
      return;
    case "DISPOSE":
      disposeLandmarker();
      post({ type: "DISPOSED" });
      return;
  }
}

async function initialize() {
  if (handLandmarker) {
    post({ modelUrl, type: "READY", wasmBaseUrl });
    return;
  }

  if (!initPromise) {
    initPromise = createLandmarker().catch((error: unknown) => {
      initPromise = null;
      post({
        message: formatWorkerError(error),
        phase: "init",
        type: "ERROR",
      });
      throw error;
    });
  }

  try {
    await initPromise;
    post({ modelUrl, type: "READY", wasmBaseUrl });
  } catch {
    // Error already posted above.
  }
}

async function createLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(wasmBaseUrl);
  handLandmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: modelUrl,
    },
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    numHands: 1,
    runningMode: "VIDEO",
  });
}

async function runInference(
  message: Extract<HandWorkerInboundMessage, { type: "FRAME" }>,
) {
  try {
    await initialize();
    if (!handLandmarker) {
      message.frame.close();
      return;
    }

    const startedAtMs = performance.now();
    const result = handLandmarker.detectForVideo(
      message.frame as ImageSource,
      message.timestampMs,
    );
    const inferenceMs = performance.now() - startedAtMs;
    message.frame.close();
    post({
      hands: normalizeHandLandmarkerResult(result),
      height: message.height,
      inferenceMs,
      timestampMs: message.timestampMs,
      type: "RESULT",
      width: message.width,
    });
  } catch (error: unknown) {
    message.frame.close();
    post({
      message: formatWorkerError(error),
      phase: "inference",
      type: "ERROR",
    });
  }
}

function disposeLandmarker() {
  try {
    handLandmarker?.close();
  } catch (error: unknown) {
    post({
      message: formatWorkerError(error),
      phase: "dispose",
      type: "ERROR",
    });
  } finally {
    handLandmarker = null;
    initPromise = null;
  }
}

function post(message: HandWorkerOutboundMessage) {
  self.postMessage(message);
}

function formatWorkerError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown hand worker error.";
}
