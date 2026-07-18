export const performanceRecordingMimeCandidates = [
  { extension: "webm", mimeType: "video/webm;codecs=vp9" },
  { extension: "webm", mimeType: "video/webm;codecs=vp8" },
  { extension: "webm", mimeType: "video/webm" },
  { extension: "mp4", mimeType: "video/mp4;codecs=avc1.42E01E" },
  { extension: "mp4", mimeType: "video/mp4" },
] as const;

export const performanceRecordingLimits = {
  maximumBytes: 128 * 1024 * 1024,
  maximumDurationMs: 5 * 60 * 1000,
  warningBytes: 96 * 1024 * 1024,
  warningDurationMs: 4 * 60 * 1000,
} as const;

export type PerformanceRecordingCapability =
  | {
      extension: "mp4" | "webm";
      mimeType: string;
      supported: true;
    }
  | {
      reason: string;
      supported: false;
    };

export type PerformanceRecordingPhase =
  "idle" | "recording" | "stopping" | "ready" | "error";

export type PerformanceRecordingState = {
  bytes: number;
  elapsedMs: number;
  error: string | null;
  filename: string | null;
  mimeType: string | null;
  phase: PerformanceRecordingPhase;
  warning: string | null;
};

export type PerformanceRecordingAction =
  | { mimeType: string; type: "START" }
  | { bytes: number; elapsedMs: number; type: "PROGRESS" }
  | { warning: string; type: "WARNING" }
  | { warning?: string; type: "STOPPING" }
  | {
      bytes: number;
      filename: string;
      mimeType: string;
      warning?: string;
      type: "READY";
    }
  | { message: string; type: "ERROR" }
  | { type: "DISCARD" };

export const initialPerformanceRecordingState: PerformanceRecordingState = {
  bytes: 0,
  elapsedMs: 0,
  error: null,
  filename: null,
  mimeType: null,
  phase: "idle",
  warning: null,
};

export function detectPerformanceRecordingCapability(input: {
  canvasCaptureStreamAvailable: boolean;
  isMimeTypeSupported: ((mimeType: string) => boolean) | null;
  mediaRecorderAvailable: boolean;
}): PerformanceRecordingCapability {
  if (!input.mediaRecorderAvailable) {
    return {
      reason:
        "This browser cannot create local recordings. Live performance mode remains available.",
      supported: false,
    };
  }
  if (!input.canvasCaptureStreamAvailable) {
    return {
      reason:
        "This browser cannot capture the composed canvas. Live performance mode remains available.",
      supported: false,
    };
  }
  if (!input.isMimeTypeSupported) {
    return {
      reason:
        "This browser cannot confirm a playable recording format. Live performance mode remains available.",
      supported: false,
    };
  }
  for (const candidate of performanceRecordingMimeCandidates) {
    if (input.isMimeTypeSupported(candidate.mimeType)) {
      return { ...candidate, supported: true };
    }
  }
  return {
    reason:
      "No supported WebM or MP4 recording codec was reported. Live performance mode remains available.",
    supported: false,
  };
}

export function reducePerformanceRecording(
  state: PerformanceRecordingState,
  action: PerformanceRecordingAction,
): PerformanceRecordingState {
  switch (action.type) {
    case "START":
      return {
        ...initialPerformanceRecordingState,
        mimeType: action.mimeType,
        phase: "recording",
      };
    case "PROGRESS":
      return {
        ...state,
        bytes: action.bytes,
        elapsedMs: action.elapsedMs,
      };
    case "WARNING":
      return { ...state, warning: action.warning };
    case "STOPPING":
      return {
        ...state,
        phase: "stopping",
        warning: action.warning ?? state.warning,
      };
    case "READY":
      return {
        ...state,
        bytes: action.bytes,
        error: null,
        filename: action.filename,
        mimeType: action.mimeType,
        phase: "ready",
        warning: action.warning ?? state.warning,
      };
    case "ERROR":
      return {
        ...state,
        error: action.message,
        phase: "error",
      };
    case "DISCARD":
      return initialPerformanceRecordingState;
  }
}

export type PerformanceRecordingLimit =
  | { level: "none" }
  | { level: "warning"; message: string }
  | { level: "stop"; message: string };

export function performanceRecordingLimit(input: {
  bytes: number;
  elapsedMs: number;
}): PerformanceRecordingLimit {
  if (input.bytes >= performanceRecordingLimits.maximumBytes) {
    return {
      level: "stop",
      message: "Recording stopped at the 128 MiB local memory limit.",
    };
  }
  if (input.elapsedMs >= performanceRecordingLimits.maximumDurationMs) {
    return {
      level: "stop",
      message: "Recording stopped at the five-minute duration limit.",
    };
  }
  if (input.bytes >= performanceRecordingLimits.warningBytes) {
    return {
      level: "warning",
      message: "Recording is approaching the 128 MiB local memory limit.",
    };
  }
  if (input.elapsedMs >= performanceRecordingLimits.warningDurationMs) {
    return {
      level: "warning",
      message: "Recording will stop automatically at five minutes.",
    };
  }
  return { level: "none" };
}

export function performanceRecordingFilename(
  capturedAt: Date,
  extension: "mp4" | "webm",
): string {
  const timestamp = capturedAt
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `touch-traversal-performance-${timestamp}.${extension}`;
}

export function formatRecordingElapsed(elapsedMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function performanceRecordingOutputSize(input: {
  height: number;
  width: number;
}): { height: number; width: number } {
  const width = Math.max(2, input.width);
  const height = Math.max(2, input.height);
  const scale = Math.min(1, 1280 / width, 720 / height);
  return {
    height: evenDimension(height * scale),
    width: evenDimension(width * scale),
  };
}

export type PerformanceRecorderAdapter = {
  start: (timesliceMs: number) => void;
  state: "inactive" | "recording" | "paused";
  stop: () => void;
  subscribe: (handlers: {
    onData: (blob: Blob) => void;
    onError: (message: string) => void;
    onStop: () => void;
  }) => () => void;
};

export type LocalRecordingSession = {
  discard: () => void;
  start: () => void;
  stop: () => void;
};

export function createLocalRecordingSession(input: {
  maximumBytes?: number;
  mimeType: string;
  onBytes: (bytes: number) => void;
  onComplete: (blob: Blob) => void;
  onDiscarded: () => void;
  onError: (message: string) => void;
  onLimit: (message: string) => void;
  recorder: PerformanceRecorderAdapter;
  release: () => void;
}): LocalRecordingSession {
  const maximumBytes =
    input.maximumBytes ?? performanceRecordingLimits.maximumBytes;
  const chunks: Blob[] = [];
  let byteCount = 0;
  let discarded = false;
  let finished = false;
  let unsubscribe = () => {};

  const release = () => {
    input.release();
  };
  const finishDiscard = () => {
    if (finished) return;
    finished = true;
    chunks.length = 0;
    unsubscribe();
    release();
    input.onDiscarded();
  };
  const fail = (message: string) => {
    if (finished) return;
    finished = true;
    chunks.length = 0;
    unsubscribe();
    release();
    input.onError(message);
  };
  const stop = () => {
    if (!finished && input.recorder.state !== "inactive") {
      input.recorder.stop();
    }
  };

  unsubscribe = input.recorder.subscribe({
    onData: (blob) => {
      if (discarded || finished || blob.size === 0) return;
      chunks.push(blob);
      byteCount += blob.size;
      input.onBytes(byteCount);
      if (byteCount >= maximumBytes) {
        input.onLimit("Recording stopped at the 128 MiB local memory limit.");
        stop();
      }
    },
    onError: (message) => fail(`Recording encoder failed: ${message}`),
    onStop: () => {
      if (discarded) {
        finishDiscard();
        return;
      }
      if (finished) return;
      if (chunks.length === 0 || byteCount === 0) {
        fail("Recording stopped without producing a playable local file.");
        return;
      }
      finished = true;
      const blob = new Blob(chunks, { type: input.mimeType });
      chunks.length = 0;
      unsubscribe();
      release();
      input.onComplete(blob);
    },
  });

  return {
    discard: () => {
      if (finished) return;
      discarded = true;
      chunks.length = 0;
      if (input.recorder.state !== "inactive") {
        input.recorder.stop();
      }
      finishDiscard();
    },
    start: () => input.recorder.start(1000),
    stop,
  };
}

function evenDimension(value: number): number {
  const rounded = Math.max(2, Math.floor(value));
  return rounded - (rounded % 2);
}
