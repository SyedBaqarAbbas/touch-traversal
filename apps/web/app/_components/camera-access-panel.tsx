"use client";

import { useRouter } from "next/navigation";
import {
  type CSSProperties,
  type MutableRefObject,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  PerformanceRecordingPanel,
  type PerformanceRecordingHandle,
} from "@/app/_components/performance-recording-panel";
import {
  cameraAccessCopy,
  classifyCameraAccessError,
  type CameraAccessEvent,
  type CameraAccessStatus,
  initialCameraAccessState,
  reduceCameraAccess,
} from "@/lib/camera-access";
import {
  stopCameraStream,
  watchCameraStreamEnded,
} from "@/lib/camera-stream-lifecycle";
import {
  handCursorCopy,
  handCursorFrameFromSignal,
  handCursorScreenStyle,
  interpolateHandCursorFrame,
  type HandCursorFrame,
  type HandCursorStatus,
} from "@/lib/hand-cursor";
import type { TimestampedLandmarkFrame } from "@/lib/gesture-classifier";
import {
  createHandInputBridgeState,
  updateHandInputBridge,
  type HandInputBridgeState,
} from "@/lib/hand-input-bridge";
import {
  createHandTrackingWorkerController,
  type HandTrackingWorkerController,
} from "@/lib/hand-tracking-client";
import {
  performanceCompositionPolicy,
  type PerformanceEmphasis,
} from "@/lib/performance-presentation";
import type { PerformanceRecordingOverlay } from "@/lib/performance-compositor";
import type { SceneQuality } from "@/lib/performance-policy";
import type {
  HandWorkerOutboundMessage,
  HandWorkerResultMessage,
} from "@/lib/hand-worker-protocol";

type HandWorkerPhase = "idle" | "loading" | "ready" | "error";

export type PerformanceCameraPresentation = {
  emphasis: PerformanceEmphasis;
  fixture: boolean;
  framingRevision: number;
  layerVisible: boolean;
  mirrored: boolean;
  onCycleEmphasis: () => void;
  onResetFraming: () => void;
  onToggleLayer: () => void;
  onToggleMirror: () => void;
  quality: SceneQuality["name"];
  recordingOverlay: PerformanceRecordingOverlay;
};

export type CameraAccessPanelProps = {
  compact?: boolean;
  onCursorFrame?: (frame: HandCursorFrame | null) => void;
  onLandmarkFrame?: (frame: TimestampedLandmarkFrame) => void;
  performance?: PerformanceCameraPresentation;
};

export function CameraAccessPanel({
  compact = false,
  onCursorFrame,
  onLandmarkFrame,
  performance: performancePresentation,
}: CameraAccessPanelProps = {}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(
    reduceCameraAccess,
    initialCameraAccessState,
  );
  const [cursorFrame, setCursorFrame] = useState<HandCursorFrame | null>(null);
  const [workerPhase, setWorkerPhase] = useState<HandWorkerPhase>("idle");
  const [recordingActive, setRecordingActive] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const workerRef = useRef<HandTrackingWorkerController | null>(null);
  const frameLoopRef = useRef<number | null>(null);
  const cursorLoopRef = useRef<number | null>(null);
  const detachTrackEndedRef = useRef<(() => void) | null>(null);
  const recordingRef = useRef<PerformanceRecordingHandle>(null);
  const cameraRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const pageVisibleRef = useRef(true);
  const handInputRef = useRef<HandInputBridgeState>(
    createHandInputBridgeState(),
  );
  const displayFrameRef = useRef<HandCursorFrame | null>(null);
  const onCursorFrameRef = useRef(onCursorFrame);
  const onLandmarkFrameRef = useRef(onLandmarkFrame);
  const composition = performancePresentation
    ? performanceCompositionPolicy(
        performancePresentation.quality,
        performancePresentation.emphasis,
      )
    : null;
  const copy = cameraAccessCopy(state);
  const handStatus = resolveHandStatus(state.status, cursorFrame);
  const handCopy = handCursorCopy(handStatus);
  const handStatusLabel = resolveHandStatusLabel(
    state.status,
    workerPhase,
    handCopy.label,
  );

  useEffect(() => {
    onCursorFrameRef.current = onCursorFrame;
    onLandmarkFrameRef.current = onLandmarkFrame;
  }, [onCursorFrame, onLandmarkFrame]);

  useEffect(() => {
    workerRef.current?.setTargetFps(composition?.targetInferenceFps ?? 24);
  }, [composition?.targetInferenceFps]);

  useEffect(() => {
    const updateVisibility = () => {
      pageVisibleRef.current = document.visibilityState !== "hidden";
    };
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () =>
      document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    const recordingHandleRef = recordingRef;
    const videoElementRef = videoRef;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cameraRequestRef.current += 1;
      recordingHandleRef.current?.discard();
      stopFrameLoop(frameLoopRef.current);
      stopFrameLoop(cursorLoopRef.current);
      workerRef.current?.dispose();
      detachTrackEndedRef.current?.();
      stopCameraStream(streamRef.current);
      streamRef.current = null;
      if (videoElementRef.current) videoElementRef.current.srcObject = null;
    };
  }, []);

  useEffect(() => {
    stopFrameLoop(cursorLoopRef.current);
    cursorLoopRef.current = null;

    if (state.status !== "active") {
      displayFrameRef.current = null;
      return;
    }

    const tick = (nowMs: number) => {
      const targetFrame = handCursorFrameFromSignal({
        cameraActive: true,
        lastSeenAtMs: handInputRef.current.lastSeenAtMs,
        nowMs,
        signal: handInputRef.current.signal,
      });

      if (targetFrame) {
        const displayFrame = interpolateHandCursorFrame({
          nowMs,
          previous: displayFrameRef.current,
          target: targetFrame,
        });
        displayFrameRef.current = displayFrame;
        setCursorFrame(displayFrame);
        onCursorFrameRef.current?.(displayFrame);
      } else {
        const hadDisplayFrame = displayFrameRef.current !== null;
        displayFrameRef.current = null;
        setCursorFrame(null);
        if (hadDisplayFrame) {
          onCursorFrameRef.current?.(null);
        }
      }

      cursorLoopRef.current = window.requestAnimationFrame(tick);
    };

    cursorLoopRef.current = window.requestAnimationFrame(tick);
    return () => {
      stopFrameLoop(cursorLoopRef.current);
      cursorLoopRef.current = null;
    };
  }, [state.status]);

  const requestCamera = async () => {
    if (
      !performancePresentation?.fixture &&
      !navigator.mediaDevices?.getUserMedia
    ) {
      dispatch({ type: "UNSUPPORTED" });
      return;
    }
    const request = ++cameraRequestRef.current;

    resetHandTrackingState({
      displayFrameRef,
      handInputRef,
      onCursorFrame: onCursorFrameRef.current,
      onLandmarkFrame: onLandmarkFrameRef.current,
      setCursorFrame,
    });
    setWorkerPhase("loading");
    dispatch({ type: "REQUEST" });

    if (performancePresentation?.fixture) {
      await Promise.resolve();
      if (!mountedRef.current || request !== cameraRequestRef.current) return;
      setWorkerPhase("ready");
      dispatch({ type: "ACTIVE" });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          height: { ideal: 480 },
          width: { ideal: 640 },
        },
      });
      if (!mountedRef.current || request !== cameraRequestRef.current) {
        stopCameraStream(stream);
        return;
      }
      detachTrackEndedRef.current?.();
      stopCameraStream(streamRef.current);
      streamRef.current = stream;
      detachTrackEndedRef.current = watchCameraStreamEnded(stream, () => {
        recordingRef.current?.discard();
        stopFrameLoop(frameLoopRef.current);
        stopFrameLoop(cursorLoopRef.current);
        workerRef.current?.dispose();
        workerRef.current = null;
        detachTrackEndedRef.current?.();
        detachTrackEndedRef.current = null;
        stopCameraStream(streamRef.current);
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        resetHandTrackingState({
          displayFrameRef,
          handInputRef,
          onCursorFrame: onCursorFrameRef.current,
          onLandmarkFrame: onLandmarkFrameRef.current,
          setCursorFrame,
        });
        setWorkerPhase("error");
        dispatch({
          message:
            "Camera stream ended. Retry once the device is available; mouse and keyboard remain available.",
          type: "ERROR",
        });
      });
      void attachStream(videoRef.current, stream);
      startFrameLoop();
      dispatch({ type: "ACTIVE" });
    } catch (error: unknown) {
      if (!mountedRef.current || request !== cameraRequestRef.current) return;
      recordingRef.current?.discard();
      stopFrameLoop(frameLoopRef.current);
      workerRef.current?.dispose();
      workerRef.current = null;
      setWorkerPhase("idle");
      detachTrackEndedRef.current?.();
      detachTrackEndedRef.current = null;
      stopCameraStream(streamRef.current);
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      dispatch(classifyCameraAccessError(error));
    }
  };

  const disableCamera = () => {
    cameraRequestRef.current += 1;
    recordingRef.current?.discard();
    stopFrameLoop(frameLoopRef.current);
    stopFrameLoop(cursorLoopRef.current);
    workerRef.current?.dispose();
    workerRef.current = null;
    resetHandTrackingState({
      displayFrameRef,
      handInputRef,
      onCursorFrame: onCursorFrameRef.current,
      onLandmarkFrame: onLandmarkFrameRef.current,
      setCursorFrame,
    });
    setWorkerPhase("idle");
    detachTrackEndedRef.current?.();
    detachTrackEndedRef.current = null;
    stopCameraStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    dispatch({ type: "DISABLE" });
  };

  const startFrameLoop = () => {
    stopFrameLoop(frameLoopRef.current);

    const stopAfterWorkerFailure = (event: CameraAccessEvent) => {
      cameraRequestRef.current += 1;
      recordingRef.current?.discard();
      stopFrameLoop(frameLoopRef.current);
      detachTrackEndedRef.current?.();
      detachTrackEndedRef.current = null;
      stopCameraStream(streamRef.current);
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      workerRef.current?.dispose();
      workerRef.current = null;
      resetHandTrackingState({
        displayFrameRef,
        handInputRef,
        onCursorFrame: onCursorFrameRef.current,
        onLandmarkFrame: onLandmarkFrameRef.current,
        setCursorFrame,
      });
      setWorkerPhase("error");
      dispatch(event);
    };

    const tick = () => {
      const video = videoRef.current;
      if (
        pageVisibleRef.current &&
        video &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        let controller = workerRef.current;
        if (!controller) {
          try {
            controller = createHandTrackingWorkerController({
              onMessage: handleWorkerMessage,
              onError: () =>
                stopAfterWorkerFailure({
                  message:
                    "Hand model could not load. Mouse and keyboard remain available.",
                  type: "ERROR",
                }),
              onResult: handleWorkerResult,
            });
          } catch {
            stopAfterWorkerFailure({
              message:
                "Hand worker could not start. Mouse and keyboard remain available.",
              type: "ERROR",
            });
            return;
          }
        }
        controller.setTargetFps(composition?.targetInferenceFps ?? 24);
        workerRef.current = controller;
        void controller
          .submitVideoFrame(video, performance.now())
          .catch((error: unknown) => {
            stopAfterWorkerFailure(classifyCameraAccessError(error));
          });
      }

      frameLoopRef.current = window.requestAnimationFrame(tick);
    };

    frameLoopRef.current = window.requestAnimationFrame(tick);
  };

  const handleAction = () => {
    if (state.status === "active") {
      disableCamera();
      return;
    }
    void requestCamera();
  };

  const handleExitPerformance = () => {
    disableCamera();
    router.push("/demo");
  };

  const handleWorkerMessage = (message: HandWorkerOutboundMessage) => {
    if (message.type === "READY") {
      setWorkerPhase("ready");
    }
    if (message.type === "DISPOSED") {
      setWorkerPhase("idle");
    }
  };

  const handleWorkerResult = (message: HandWorkerResultMessage) => {
    const update = updateHandInputBridge(handInputRef.current, message);
    handInputRef.current = update.state;
    onLandmarkFrameRef.current?.(update.landmarkFrame);
  };

  return (
    <>
      {performancePresentation ? (
        <div
          aria-hidden="true"
          className="performance-camera-layer"
          data-active={state.status === "active" ? "true" : "false"}
          data-emphasis={performancePresentation.emphasis}
          data-fixture={performancePresentation.fixture ? "true" : "false"}
          data-framing-revision={performancePresentation.framingRevision}
          data-mirrored={performancePresentation.mirrored ? "true" : "false"}
          data-visible={performancePresentation.layerVisible ? "true" : "false"}
          style={performanceVideoStyle(composition?.videoOpacity ?? 0)}
        >
          <video
            className="performance-camera-layer__video"
            muted
            playsInline
            ref={videoRef}
          />
          {performancePresentation.fixture ? (
            <div className="performance-camera-layer__fixture">
              <span />
            </div>
          ) : null}
          <span className="performance-camera-layer__contrast" />
        </div>
      ) : (
        <video
          aria-hidden="true"
          className="camera-access-panel__video"
          muted
          playsInline
          ref={videoRef}
        />
      )}
      {cursorFrame?.visible ? (
        <span
          aria-hidden="true"
          className="hand-gesture-cursor"
          data-hand-status={cursorFrame.status}
          style={handCursorVisualStyle(cursorFrame)}
        >
          <span className="hand-gesture-cursor__ring" />
          <span className="hand-gesture-cursor__core" />
        </span>
      ) : null}
      <aside
        aria-live="polite"
        className="camera-access-panel"
        data-camera-status={state.status}
        data-compact={compact ? "true" : "false"}
        data-performance={performancePresentation ? "true" : "false"}
      >
        <div className="camera-access-panel__meta">
          <span className="camera-access-panel__status">
            {performancePresentation?.fixture && state.status === "active"
              ? "camera fixture / no device"
              : copy.statusLabel}
          </span>
          <span
            className="camera-access-panel__hand"
            data-hand-tone={handCopy.tone}
          >
            <span className="camera-access-panel__hand-dot" />
            {handStatusLabel}
          </span>
        </div>
        {!compact ? <strong>{copy.title}</strong> : null}
        {!compact ? <p>{copy.description}</p> : null}
        {performancePresentation && state.status !== "active" ? (
          <p className="performance-camera-consent">
            Camera stays off until you enable it. Video has no audio and never
            leaves this browser.
          </p>
        ) : null}
        {copy.actionLabel ? (
          <button
            disabled={state.status === "requesting"}
            onClick={handleAction}
            type="button"
          >
            {recordingActive && state.status === "active"
              ? "Disable camera + discard recording"
              : copy.actionLabel}
          </button>
        ) : null}
        {performancePresentation ? (
          <>
            <PerformanceRecordingPanel
              cameraActive={state.status === "active"}
              cursorFrame={cursorFrame}
              fixture={performancePresentation.fixture}
              layerVisible={performancePresentation.layerVisible}
              mirrored={performancePresentation.mirrored}
              onRecordingChange={setRecordingActive}
              overlay={performancePresentation.recordingOverlay}
              ref={recordingRef}
              videoOpacity={composition?.videoOpacity ?? 0}
              videoRef={videoRef}
            />
            <div
              aria-label="Performance presentation"
              className="performance-presentation-controls"
            >
              <button
                aria-pressed={!performancePresentation.layerVisible}
                onClick={performancePresentation.onToggleLayer}
                type="button"
              >
                {performancePresentation.layerVisible
                  ? "Graph only"
                  : "Show video layer"}
              </button>
              <button
                aria-label={`Graph and video emphasis: ${performancePresentation.emphasis}`}
                onClick={performancePresentation.onCycleEmphasis}
                type="button"
              >
                emphasis / {performancePresentation.emphasis}
              </button>
              <button
                aria-pressed={performancePresentation.mirrored}
                onClick={performancePresentation.onToggleMirror}
                type="button"
              >
                mirror
              </button>
              <button
                onClick={performancePresentation.onResetFraming}
                type="button"
              >
                reset framing
              </button>
              <button onClick={handleExitPerformance} type="button">
                exit performance
              </button>
            </div>
          </>
        ) : null}
      </aside>
    </>
  );
}

function performanceVideoStyle(videoOpacity: number): CSSProperties {
  return {
    "--performance-video-opacity": videoOpacity.toFixed(2),
  } as CSSProperties;
}

function resolveHandStatus(
  cameraStatus: CameraAccessStatus,
  cursorFrame: HandCursorFrame | null,
): HandCursorStatus {
  if (cursorFrame) {
    return cursorFrame.status;
  }
  if (cameraStatus === "active") {
    return "acquiring";
  }
  return "idle";
}

function resolveHandStatusLabel(
  cameraStatus: CameraAccessStatus,
  workerPhase: HandWorkerPhase,
  fallbackLabel: string,
): string {
  if (cameraStatus === "active" && workerPhase === "loading") {
    return "loading hand model";
  }
  if (workerPhase === "error") {
    return "hand model unavailable";
  }
  return fallbackLabel;
}

function handCursorVisualStyle(frame: HandCursorFrame): CSSProperties {
  const positionStyle = handCursorScreenStyle(frame);
  return {
    ...positionStyle,
    "--hand-cursor-confidence": frame.confidence.toFixed(3),
    "--hand-cursor-progress": frame.pinchProgress.toFixed(3),
  } as CSSProperties;
}

function resetHandTrackingState({
  displayFrameRef,
  handInputRef,
  onCursorFrame,
  onLandmarkFrame,
  setCursorFrame,
}: {
  displayFrameRef: MutableRefObject<HandCursorFrame | null>;
  handInputRef: MutableRefObject<HandInputBridgeState>;
  onCursorFrame: CameraAccessPanelProps["onCursorFrame"];
  onLandmarkFrame: CameraAccessPanelProps["onLandmarkFrame"];
  setCursorFrame: (frame: HandCursorFrame | null) => void;
}) {
  const timestampMs =
    handInputRef.current.signal?.timestampMs ??
    displayFrameRef.current?.timestampMs ??
    0;
  handInputRef.current = createHandInputBridgeState();
  displayFrameRef.current = null;
  setCursorFrame(null);
  onCursorFrame?.(null);
  onLandmarkFrame?.({ hand: null, timestampMs });
}

async function attachStream(
  video: HTMLVideoElement | null,
  stream: MediaStream,
) {
  if (!video) {
    return;
  }
  video.srcObject = stream;
  await video.play().catch(() => {
    // The permission state is still useful even if autoplay is unavailable.
  });
}

function stopFrameLoop(frameId: number | null) {
  if (frameId != null) {
    window.cancelAnimationFrame(frameId);
  }
}
