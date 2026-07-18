import {
  HAND_WORKER_TARGET_FPS,
  shouldSubmitHandFrame,
  type HandWorkerInboundMessage,
  type HandWorkerOutboundMessage,
} from "@/lib/hand-worker-protocol";

export type HandTrackingWorkerHandlers = {
  onError?: (
    message: Extract<HandWorkerOutboundMessage, { type: "ERROR" }>,
  ) => void;
  onMessage?: (message: HandWorkerOutboundMessage) => void;
  onResult?: (
    message: Extract<HandWorkerOutboundMessage, { type: "RESULT" }>,
  ) => void;
};

export type HandTrackingWorkerController = {
  dispose: () => void;
  setTargetFps: (targetFps: number) => void;
  submitVideoFrame: (
    video: HTMLVideoElement,
    timestampMs: number,
  ) => Promise<boolean>;
};

export function createHandTrackingWorkerController(
  handlers: HandTrackingWorkerHandlers = {},
): HandTrackingWorkerController {
  const worker = new Worker(new URL("./hand.worker.ts", import.meta.url), {
    type: "module",
  });
  let capturePending = false;
  let disposed = false;
  let frameInFlight = false;
  let lastSubmittedAtMs: number | null = null;
  let nativeFailureReported = false;
  let targetFps = HAND_WORKER_TARGET_FPS;

  const reportNativeFailure = (phase: "init" | "inference") => {
    if (disposed || nativeFailureReported) return;
    nativeFailureReported = true;
    disposed = true;
    frameInFlight = false;
    worker.terminate();
    const message = {
      message: "The local hand worker failed to load or process a frame.",
      phase,
      type: "ERROR",
    } as const;
    handlers.onMessage?.(message);
    handlers.onError?.(message);
  };

  worker.onmessage = (event: MessageEvent<HandWorkerOutboundMessage>) => {
    if (event.data.type === "RESULT" || event.data.type === "ERROR") {
      frameInFlight = false;
    }
    handlers.onMessage?.(event.data);
    if (event.data.type === "RESULT") {
      handlers.onResult?.(event.data);
    }
    if (event.data.type === "ERROR") {
      handlers.onError?.(event.data);
    }
  };
  worker.onerror = (event) => {
    event.preventDefault();
    reportNativeFailure(frameInFlight ? "inference" : "init");
  };
  worker.onmessageerror = () => reportNativeFailure("inference");
  post(worker, { type: "INIT" });

  return {
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      frameInFlight = false;
      post(worker, { type: "DISPOSE" });
      worker.terminate();
    },
    setTargetFps: (nextTargetFps: number) => {
      targetFps = nextTargetFps;
    },
    submitVideoFrame: async (
      video: HTMLVideoElement,
      timestampMs: number,
    ): Promise<boolean> => {
      if (
        disposed ||
        capturePending ||
        frameInFlight ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        video.videoWidth === 0 ||
        video.videoHeight === 0 ||
        !shouldSubmitHandFrame({
          lastSubmittedAtMs,
          nowMs: timestampMs,
          targetFps,
        })
      ) {
        return false;
      }

      capturePending = true;
      let frame: ImageBitmap | null = null;
      try {
        const size = scaledFrameSize(video.videoWidth, video.videoHeight, 320);
        frame = await createImageBitmap(video, {
          resizeHeight: size.height,
          resizeQuality: "low",
          resizeWidth: size.width,
        });
        if (disposed) {
          frame.close();
          frame = null;
          return false;
        }
        lastSubmittedAtMs = timestampMs;
        frameInFlight = true;
        try {
          post(
            worker,
            {
              frame,
              height: size.height,
              timestampMs,
              type: "FRAME",
              width: size.width,
            },
            [frame],
          );
        } catch (error) {
          frameInFlight = false;
          frame.close();
          frame = null;
          throw error;
        }
        frame = null;
        return true;
      } finally {
        frame?.close();
        capturePending = false;
      }
    },
  };
}

export function scaledFrameSize(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
): { height: number; width: number } {
  if (sourceWidth <= maxWidth) {
    return { height: sourceHeight, width: sourceWidth };
  }
  const scale = maxWidth / sourceWidth;
  return {
    height: Math.max(1, Math.round(sourceHeight * scale)),
    width: maxWidth,
  };
}

function post(
  worker: Worker,
  message: HandWorkerInboundMessage,
  transfer?: Transferable[],
) {
  worker.postMessage(message, transfer ?? []);
}
