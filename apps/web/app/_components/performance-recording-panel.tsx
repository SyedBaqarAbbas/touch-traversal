"use client";

import {
  forwardRef,
  type MutableRefObject,
  useEffect,
  useImperativeHandle,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  createPerformanceCompositor,
  type PerformanceRecordingOverlay,
} from "@/lib/performance-compositor";
import {
  createLocalRecordingSession,
  detectPerformanceRecordingCapability,
  formatRecordingElapsed,
  initialPerformanceRecordingState,
  performanceRecordingFilename,
  performanceRecordingLimit,
  reducePerformanceRecording,
  type LocalRecordingSession,
  type PerformanceRecorderAdapter,
  type PerformanceRecordingCapability,
} from "@/lib/performance-recording";
import type { HandCursorFrame } from "@/lib/hand-cursor";

export type PerformanceRecordingHandle = {
  discard: () => void;
};

export type PerformanceRecordingPanelProps = {
  cameraActive: boolean;
  cursorFrame: HandCursorFrame | null;
  fixture: boolean;
  layerVisible: boolean;
  mirrored: boolean;
  onRecordingChange: (active: boolean) => void;
  overlay: PerformanceRecordingOverlay;
  videoOpacity: number;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
};

type RecordingRuntime = {
  compositor: ReturnType<typeof createPerformanceCompositor>;
  session: LocalRecordingSession;
};

export const PerformanceRecordingPanel = forwardRef<
  PerformanceRecordingHandle,
  PerformanceRecordingPanelProps
>(function PerformanceRecordingPanel(
  {
    cameraActive,
    cursorFrame,
    fixture,
    layerVisible,
    mirrored,
    onRecordingChange,
    overlay,
    videoOpacity,
    videoRef,
  },
  ref,
) {
  const [capability, setCapability] =
    useState<PerformanceRecordingCapability | null>(null);
  const [state, dispatch] = useReducer(
    reducePerformanceRecording,
    initialPerformanceRecordingState,
  );
  const runtimeRef = useRef<RecordingRuntime | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const capturedAtRef = useRef(new Date(0));
  const byteCountRef = useRef(0);
  const warningRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const discardActionRef = useRef<(notify?: boolean) => void>(() => {});
  const stopActionRef = useRef<(warning?: string) => void>(() => {});
  const latestRef = useRef({
    cursorFrame,
    layerVisible,
    mirrored,
    overlay,
    videoOpacity,
  });
  latestRef.current = {
    cursorFrame,
    layerVisible,
    mirrored,
    overlay,
    videoOpacity,
  };

  useEffect(() => {
    const canvas = document.createElement("canvas");
    setCapability(
      detectPerformanceRecordingCapability({
        canvasCaptureStreamAvailable:
          typeof canvas.captureStream === "function",
        isMimeTypeSupported:
          typeof MediaRecorder !== "undefined" &&
          typeof MediaRecorder.isTypeSupported === "function"
            ? (mimeType) => MediaRecorder.isTypeSupported(mimeType)
            : null,
        mediaRecorderAvailable: typeof MediaRecorder !== "undefined",
      }),
    );
  }, []);

  useEffect(() => {
    onRecordingChange(
      state.phase === "recording" || state.phase === "stopping",
    );
  }, [onRecordingChange, state.phase]);

  useEffect(() => {
    if (!cameraActive) discardActionRef.current();
  }, [cameraActive]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && runtimeRef.current) {
        stopActionRef.current(
          "Recording stopped because the tab moved to the background.",
        );
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      discardActionRef.current(false);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    discard: () => discardActionRef.current(),
  }));

  const startRecording = () => {
    if (!cameraActive || !capability?.supported || runtimeRef.current) return;
    const video = videoRef.current;
    const shell = video?.closest(".scene-shell");
    const graphCanvas = shell?.querySelector<HTMLCanvasElement>("canvas");
    if (!video || !shell || !graphCanvas) {
      dispatch({
        message: "The live graph composition is not ready to record.",
        type: "ERROR",
      });
      return;
    }

    revokeObjectUrl();
    blobRef.current = null;
    byteCountRef.current = 0;
    warningRef.current = null;
    startedAtRef.current = performance.now();
    capturedAtRef.current = new Date();

    let pendingCompositor: ReturnType<
      typeof createPerformanceCompositor
    > | null = null;
    try {
      const compositor = createPerformanceCompositor({
        fixture,
        graphCanvas,
        onError: (message) => failRecording(message),
        overlay: () => latestRef.current.overlay,
        presentation: () => ({
          cursorFrame: latestRef.current.cursorFrame,
          layerVisible: latestRef.current.layerVisible,
          mirrored: latestRef.current.mirrored,
          videoOpacity: latestRef.current.videoOpacity,
        }),
        sourceHeight: shell.clientHeight,
        sourceWidth: shell.clientWidth,
        video,
      });
      pendingCompositor = compositor;
      const recorder = createNativeRecorderAdapter(
        compositor.stream,
        capability.mimeType,
      );
      const session = createLocalRecordingSession({
        mimeType: capability.mimeType,
        onBytes: (bytes) => {
          byteCountRef.current = bytes;
          if (mountedRef.current) {
            dispatch({
              bytes,
              elapsedMs: performance.now() - startedAtRef.current,
              type: "PROGRESS",
            });
          }
        },
        onComplete: (blob) => completeRecording(blob, capability),
        onDiscarded: () => {},
        onError: (message) => failRecording(message),
        onLimit: (message) => {
          warningRef.current = message;
          if (mountedRef.current) {
            dispatch({ type: "STOPPING", warning: message });
          }
        },
        recorder,
        release: () => compositor.stop(),
      });
      runtimeRef.current = { compositor, session };
      pendingCompositor = null;
      session.start();
      dispatch({ mimeType: capability.mimeType, type: "START" });
      elapsedTimerRef.current = window.setInterval(updateProgress, 250);
      compositor.start();
    } catch (error: unknown) {
      pendingCompositor?.stop();
      failRecording(
        error instanceof Error ? error.message : "Recording could not start.",
      );
    }
  };

  const updateProgress = () => {
    const elapsedMs = performance.now() - startedAtRef.current;
    const limit = performanceRecordingLimit({
      bytes: byteCountRef.current,
      elapsedMs,
    });
    dispatch({ bytes: byteCountRef.current, elapsedMs, type: "PROGRESS" });
    if (limit.level === "warning" && warningRef.current !== limit.message) {
      warningRef.current = limit.message;
      dispatch({ type: "WARNING", warning: limit.message });
    }
    if (limit.level === "stop") stopRecording(limit.message);
  };

  const stopRecording = (warning?: string) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    dispatch({ type: "STOPPING", warning });
    if (warning) warningRef.current = warning;
    clearElapsedTimer();
    runtime.session.stop();
  };

  const completeRecording = (
    blob: Blob,
    recordingCapability: Extract<
      PerformanceRecordingCapability,
      { supported: true }
    >,
  ) => {
    clearElapsedTimer();
    runtimeRef.current = null;
    blobRef.current = blob;
    const filename = performanceRecordingFilename(
      capturedAtRef.current,
      recordingCapability.extension,
    );
    objectUrlRef.current = URL.createObjectURL(blob);
    if (mountedRef.current) {
      dispatch({
        bytes: blob.size,
        filename,
        mimeType: blob.type || recordingCapability.mimeType,
        type: "READY",
        warning: warningRef.current ?? undefined,
      });
    }
  };

  const failRecording = (message: string) => {
    clearElapsedTimer();
    const runtime = runtimeRef.current;
    runtimeRef.current = null;
    runtime?.session.discard();
    runtime?.compositor.stop();
    revokeObjectUrl();
    blobRef.current = null;
    if (mountedRef.current) dispatch({ message, type: "ERROR" });
  };

  const discardRecording = (notify = true) => {
    clearElapsedTimer();
    const runtime = runtimeRef.current;
    runtimeRef.current = null;
    runtime?.session.discard();
    runtime?.compositor.stop();
    revokeObjectUrl();
    blobRef.current = null;
    byteCountRef.current = 0;
    warningRef.current = null;
    if (notify && mountedRef.current) dispatch({ type: "DISCARD" });
  };

  discardActionRef.current = discardRecording;
  stopActionRef.current = stopRecording;

  const downloadRecording = () => {
    if (!objectUrlRef.current || !state.filename || !blobRef.current) return;
    const anchor = document.createElement("a");
    anchor.href = objectUrlRef.current;
    anchor.download = state.filename;
    anchor.rel = "noopener";
    anchor.click();
    window.setTimeout(() => discardRecording(), 0);
  };

  const clearElapsedTimer = () => {
    if (elapsedTimerRef.current != null) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  };

  const revokeObjectUrl = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  const active = state.phase === "recording" || state.phase === "stopping";

  return (
    <section
      aria-label="Local performance recording"
      className="performance-recording-panel"
      data-recording-state={state.phase}
    >
      <div className="performance-recording-panel__status" role="status">
        {active ? <span aria-hidden="true" /> : null}
        <strong>{recordingStatusLabel(state.phase)}</strong>
        {active ? <time>{formatRecordingElapsed(state.elapsedMs)}</time> : null}
      </div>
      {capability?.supported ? (
        <p>
          Local {capability.extension.toUpperCase()} · microphone off · nothing
          uploads. The red UI indicator is not included in the saved frame.
        </p>
      ) : capability ? (
        <p className="performance-recording-panel__warning">
          {capability.reason}
        </p>
      ) : (
        <p>Checking local recording support…</p>
      )}
      {!cameraActive ? <p>Enable the camera before recording.</p> : null}
      {state.warning ? (
        <p className="performance-recording-panel__warning">{state.warning}</p>
      ) : null}
      {state.error ? (
        <p className="performance-recording-panel__warning">{state.error}</p>
      ) : null}
      <div className="performance-recording-panel__actions">
        {cameraActive &&
        capability?.supported &&
        !active &&
        state.phase !== "ready" ? (
          <button
            disabled={!layerVisible}
            onClick={startRecording}
            type="button"
          >
            Start recording
          </button>
        ) : null}
        {!layerVisible && cameraActive && state.phase === "idle" ? (
          <small>
            Show the video layer to start a webcam + graph recording.
          </small>
        ) : null}
        {active ? (
          <>
            <button onClick={() => stopRecording()} type="button">
              Stop recording
            </button>
            <button onClick={() => discardRecording()} type="button">
              Discard recording
            </button>
          </>
        ) : null}
        {state.phase === "ready" ? (
          <>
            <button onClick={downloadRecording} type="button">
              Download recording
            </button>
            <button onClick={() => discardRecording()} type="button">
              Discard recording
            </button>
            <small>
              {formatBytes(state.bytes)} · {state.mimeType}
            </small>
          </>
        ) : null}
      </div>
    </section>
  );
});

function createNativeRecorderAdapter(
  stream: MediaStream,
  mimeType: string,
): PerformanceRecorderAdapter {
  const recorder = new MediaRecorder(stream, {
    audioBitsPerSecond: undefined,
    mimeType,
    videoBitsPerSecond: 5_000_000,
  });
  return {
    start: (timesliceMs) => recorder.start(timesliceMs),
    get state() {
      return recorder.state;
    },
    stop: () => recorder.stop(),
    subscribe: ({ onData, onError, onStop }) => {
      const handleData = (event: BlobEvent) => onData(event.data);
      const handleError = (event: Event) =>
        onError(
          "error" in event && event.error instanceof Error
            ? event.error.message
            : "unknown encoder error",
        );
      recorder.addEventListener("dataavailable", handleData);
      recorder.addEventListener("error", handleError);
      recorder.addEventListener("stop", onStop);
      return () => {
        recorder.removeEventListener("dataavailable", handleData);
        recorder.removeEventListener("error", handleError);
        recorder.removeEventListener("stop", onStop);
      };
    },
  };
}

function recordingStatusLabel(
  phase: (typeof initialPerformanceRecordingState)["phase"],
): string {
  switch (phase) {
    case "recording":
      return "recording locally";
    case "stopping":
      return "finishing local file";
    case "ready":
      return "recording ready";
    case "error":
      return "recording unavailable";
    case "idle":
      return "not recording";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024)
    return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
