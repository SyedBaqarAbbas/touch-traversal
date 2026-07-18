import { describe, expect, it, vi } from "vitest";

import { createPerformanceCompositor } from "../../lib/performance-compositor";
import {
  createLocalRecordingSession,
  detectPerformanceRecordingCapability,
  formatRecordingElapsed,
  initialPerformanceRecordingState,
  performanceRecordingFilename,
  performanceRecordingLimit,
  performanceRecordingOutputSize,
  reducePerformanceRecording,
  type PerformanceRecorderAdapter,
} from "../../lib/performance-recording";

function createRecorder() {
  let state: PerformanceRecorderAdapter["state"] = "inactive";
  let handlers: Parameters<PerformanceRecorderAdapter["subscribe"]>[0] | null =
    null;
  const unsubscribe = vi.fn();
  const adapter: PerformanceRecorderAdapter = {
    get state() {
      return state;
    },
    start: vi.fn(() => {
      state = "recording";
    }),
    stop: vi.fn(() => {
      state = "inactive";
      handlers?.onStop();
    }),
    subscribe: vi.fn((nextHandlers) => {
      handlers = nextHandlers;
      return unsubscribe;
    }),
  };
  return {
    adapter,
    emitData: (blob: Blob) => handlers?.onData(blob),
    emitError: (message: string) => handlers?.onError(message),
    unsubscribe,
  };
}

describe("performance recording policy", () => {
  it("selects supported WebM codecs before browser-proven MP4", () => {
    expect(
      detectPerformanceRecordingCapability({
        canvasCaptureStreamAvailable: true,
        isMimeTypeSupported: (mimeType) =>
          mimeType === "video/webm;codecs=vp8" || mimeType === "video/mp4",
        mediaRecorderAvailable: true,
      }),
    ).toEqual({
      extension: "webm",
      mimeType: "video/webm;codecs=vp8",
      supported: true,
    });
  });

  it("provides actionable unsupported fallbacks", () => {
    expect(
      detectPerformanceRecordingCapability({
        canvasCaptureStreamAvailable: true,
        isMimeTypeSupported: null,
        mediaRecorderAvailable: false,
      }),
    ).toMatchObject({ supported: false });
    expect(
      detectPerformanceRecordingCapability({
        canvasCaptureStreamAvailable: false,
        isMimeTypeSupported: () => true,
        mediaRecorderAvailable: true,
      }),
    ).toMatchObject({
      reason: expect.stringContaining("capture the composed canvas"),
      supported: false,
    });
  });

  it("uses bounded even output dimensions and privacy-safe filenames", () => {
    expect(
      performanceRecordingOutputSize({ height: 900, width: 1440 }),
    ).toEqual({ height: 720, width: 1152 });
    expect(
      performanceRecordingFilename(
        new Date("2026-07-18T12:34:56.789Z"),
        "webm",
      ),
    ).toBe("touch-traversal-performance-20260718T123456Z.webm");
    expect(formatRecordingElapsed(65_800)).toBe("01:05");
  });

  it("warns and stops at bounded duration or memory thresholds", () => {
    expect(
      performanceRecordingLimit({ bytes: 0, elapsedMs: 4 * 60 * 1000 }),
    ).toMatchObject({ level: "warning" });
    expect(
      performanceRecordingLimit({ bytes: 128 * 1024 * 1024, elapsedMs: 0 }),
    ).toMatchObject({ level: "stop" });
  });

  it("models explicit start, stop, ready, and immediate discard", () => {
    const recording = reducePerformanceRecording(
      initialPerformanceRecordingState,
      { mimeType: "video/webm", type: "START" },
    );
    const stopping = reducePerformanceRecording(recording, {
      type: "STOPPING",
    });
    const ready = reducePerformanceRecording(stopping, {
      bytes: 42,
      filename: "touch-traversal-performance.webm",
      mimeType: "video/webm",
      type: "READY",
    });
    expect(ready.phase).toBe("ready");
    expect(reducePerformanceRecording(ready, { type: "DISCARD" })).toEqual(
      initialPerformanceRecordingState,
    );
  });
});

describe("local MediaRecorder session", () => {
  it("produces a non-empty Blob only after stop and releases its stream", () => {
    const recorder = createRecorder();
    const onComplete = vi.fn();
    const release = vi.fn();
    const session = createLocalRecordingSession({
      mimeType: "video/webm;codecs=vp8",
      onBytes: vi.fn(),
      onComplete,
      onDiscarded: vi.fn(),
      onError: vi.fn(),
      onLimit: vi.fn(),
      recorder: recorder.adapter,
      release,
    });

    session.start();
    recorder.emitData(new Blob(["composed frame"]));
    expect(onComplete).not.toHaveBeenCalled();
    session.stop();

    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0]?.[0]).toMatchObject({
      size: 14,
      type: "video/webm;codecs=vp8",
    });
    expect(release).toHaveBeenCalledOnce();
    expect(recorder.unsubscribe).toHaveBeenCalledOnce();
  });

  it("discards immediately and never creates an output Blob", () => {
    const recorder = createRecorder();
    const onComplete = vi.fn();
    const onDiscarded = vi.fn();
    const release = vi.fn();
    const session = createLocalRecordingSession({
      mimeType: "video/webm",
      onBytes: vi.fn(),
      onComplete,
      onDiscarded,
      onError: vi.fn(),
      onLimit: vi.fn(),
      recorder: recorder.adapter,
      release,
    });
    session.start();
    recorder.emitData(new Blob(["private bytes"]));
    session.discard();

    expect(onComplete).not.toHaveBeenCalled();
    expect(onDiscarded).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("releases resources on encoder error and rejects empty output", () => {
    const errorRecorder = createRecorder();
    const onError = vi.fn();
    const release = vi.fn();
    const failed = createLocalRecordingSession({
      mimeType: "video/webm",
      onBytes: vi.fn(),
      onComplete: vi.fn(),
      onDiscarded: vi.fn(),
      onError,
      onLimit: vi.fn(),
      recorder: errorRecorder.adapter,
      release,
    });
    failed.start();
    errorRecorder.emitError("codec lost");
    expect(onError).toHaveBeenCalledWith(
      "Recording encoder failed: codec lost",
    );
    expect(release).toHaveBeenCalledOnce();

    const emptyRecorder = createRecorder();
    const emptyError = vi.fn();
    const empty = createLocalRecordingSession({
      mimeType: "video/webm",
      onBytes: vi.fn(),
      onComplete: vi.fn(),
      onDiscarded: vi.fn(),
      onError: emptyError,
      onLimit: vi.fn(),
      recorder: emptyRecorder.adapter,
      release: vi.fn(),
    });
    empty.start();
    empty.stop();
    expect(emptyError).toHaveBeenCalledWith(
      "Recording stopped without producing a playable local file.",
    );
  });
});

describe("performance compositor lifecycle", () => {
  it("releases the capture track after a composition draw failure", () => {
    const stopTrack = vi.fn();
    const onError = vi.fn();
    const canvas = {
      captureStream: () =>
        ({ getTracks: () => [{ stop: stopTrack }] }) as unknown as MediaStream,
      dataset: {} as DOMStringMap,
      getContext: () => ({
        save: () => {
          throw new Error("private frame could not be composed");
        },
      }),
      height: 0,
      width: 0,
    } as unknown as HTMLCanvasElement;

    vi.stubGlobal("document", { createElement: () => canvas });
    vi.stubGlobal("window", {
      cancelAnimationFrame: vi.fn(),
      requestAnimationFrame: vi.fn(() => 1),
    });
    try {
      const compositor = createPerformanceCompositor({
        fixture: true,
        graphCanvas: canvas,
        onError,
        overlay: () => ({
          cameraMode: "overview",
          edgeCount: 0,
          interactionMode: "OVERVIEW",
          nodeCount: 0,
          selectedTitle: null,
          topologyLabel: "distributed",
          topologyTitle: "Topologies of Thoughts",
          traversalLabel: null,
        }),
        presentation: () => ({
          cursorFrame: null,
          layerVisible: true,
          mirrored: true,
          videoOpacity: 1,
        }),
        sourceHeight: 720,
        sourceWidth: 1280,
        video: {} as HTMLVideoElement,
      });

      compositor.start();
      compositor.stop();

      expect(onError).toHaveBeenCalledWith(
        "private frame could not be composed",
      );
      expect(stopTrack).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
