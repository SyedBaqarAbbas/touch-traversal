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
  let disposed = false;
  let lastSubmittedAtMs: number | null = null;

  worker.onmessage = (event: MessageEvent<HandWorkerOutboundMessage>) => {
    handlers.onMessage?.(event.data);
    if (event.data.type === "RESULT") {
      handlers.onResult?.(event.data);
    }
    if (event.data.type === "ERROR") {
      handlers.onError?.(event.data);
    }
  };
  post(worker, { type: "INIT" });

  return {
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      post(worker, { type: "DISPOSE" });
      worker.terminate();
    },
    submitVideoFrame: async (
      video: HTMLVideoElement,
      timestampMs: number,
    ): Promise<boolean> => {
      if (
        disposed ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        video.videoWidth === 0 ||
        video.videoHeight === 0 ||
        !shouldSubmitHandFrame({
          lastSubmittedAtMs,
          nowMs: timestampMs,
          targetFps: HAND_WORKER_TARGET_FPS,
        })
      ) {
        return false;
      }

      const size = scaledFrameSize(video.videoWidth, video.videoHeight, 320);
      const frame = await createImageBitmap(video, {
        resizeHeight: size.height,
        resizeQuality: "low",
        resizeWidth: size.width,
      });
      lastSubmittedAtMs = timestampMs;
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
      return true;
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
