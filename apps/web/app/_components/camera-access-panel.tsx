"use client";

import {
  type CSSProperties,
  type MutableRefObject,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  cameraAccessCopy,
  classifyCameraAccessError,
  type CameraAccessStatus,
  initialCameraAccessState,
  reduceCameraAccess,
} from "@/lib/camera-access";
import {
  handCursorCopy,
  handCursorFrameFromSignal,
  handCursorScreenStyle,
  interpolateHandCursorFrame,
  type HandCursorFrame,
  type HandCursorStatus,
} from "@/lib/hand-cursor";
import {
  extractHandSignal,
  fadeHandSignal,
  smoothHandSignal,
  type HandSignal,
} from "@/lib/hand-signals";
import {
  createHandTrackingWorkerController,
  type HandTrackingWorkerController,
} from "@/lib/hand-tracking-client";
import type {
  HandWorkerOutboundMessage,
  HandWorkerResultMessage,
} from "@/lib/hand-worker-protocol";

type HandWorkerPhase = "idle" | "loading" | "ready" | "error";

export function CameraAccessPanel() {
  const [state, dispatch] = useReducer(
    reduceCameraAccess,
    initialCameraAccessState,
  );
  const [cursorFrame, setCursorFrame] = useState<HandCursorFrame | null>(null);
  const [workerPhase, setWorkerPhase] = useState<HandWorkerPhase>("idle");
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const workerRef = useRef<HandTrackingWorkerController | null>(null);
  const frameLoopRef = useRef<number | null>(null);
  const cursorLoopRef = useRef<number | null>(null);
  const signalRef = useRef<HandSignal | null>(null);
  const lastSeenAtRef = useRef<number | null>(null);
  const displayFrameRef = useRef<HandCursorFrame | null>(null);
  const copy = cameraAccessCopy(state);
  const handStatus = resolveHandStatus(state.status, cursorFrame);
  const handCopy = handCursorCopy(handStatus);
  const handStatusLabel = resolveHandStatusLabel(
    state.status,
    workerPhase,
    handCopy.label,
  );

  useEffect(() => {
    return () => {
      stopFrameLoop(frameLoopRef.current);
      stopFrameLoop(cursorLoopRef.current);
      workerRef.current?.dispose();
      stopStream(streamRef.current);
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
        lastSeenAtMs: lastSeenAtRef.current,
        nowMs,
        signal: signalRef.current,
      });

      if (targetFrame) {
        const displayFrame = interpolateHandCursorFrame({
          nowMs,
          previous: displayFrameRef.current,
          target: targetFrame,
        });
        displayFrameRef.current = displayFrame;
        setCursorFrame(displayFrame);
      } else {
        displayFrameRef.current = null;
        setCursorFrame(null);
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
    if (!navigator.mediaDevices?.getUserMedia) {
      dispatch({ type: "UNSUPPORTED" });
      return;
    }

    resetHandTrackingState({
      displayFrameRef,
      lastSeenAtRef,
      setCursorFrame,
      signalRef,
    });
    setWorkerPhase("loading");
    dispatch({ type: "REQUEST" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          height: { ideal: 480 },
          width: { ideal: 640 },
        },
      });
      stopStream(streamRef.current);
      streamRef.current = stream;
      void attachStream(videoRef.current, stream);
      startFrameLoop();
      dispatch({ type: "ACTIVE" });
    } catch (error: unknown) {
      stopFrameLoop(frameLoopRef.current);
      workerRef.current?.dispose();
      workerRef.current = null;
      setWorkerPhase("idle");
      stopStream(streamRef.current);
      streamRef.current = null;
      dispatch(classifyCameraAccessError(error));
    }
  };

  const disableCamera = () => {
    stopFrameLoop(frameLoopRef.current);
    stopFrameLoop(cursorLoopRef.current);
    workerRef.current?.dispose();
    workerRef.current = null;
    resetHandTrackingState({
      displayFrameRef,
      lastSeenAtRef,
      setCursorFrame,
      signalRef,
    });
    setWorkerPhase("idle");
    stopStream(streamRef.current);
    streamRef.current = null;
    dispatch({ type: "DISABLE" });
  };

  const startFrameLoop = () => {
    stopFrameLoop(frameLoopRef.current);

    const tick = () => {
      const video = videoRef.current;
      if (
        video &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        const controller =
          workerRef.current ??
          createHandTrackingWorkerController({
            onMessage: handleWorkerMessage,
            onError: (message) => {
              resetHandTrackingState({
                displayFrameRef,
                lastSeenAtRef,
                setCursorFrame,
                signalRef,
              });
              setWorkerPhase("error");
              dispatch({
                message: `Hand model failed: ${message.message}. Mouse and keyboard remain available.`,
                type: "ERROR",
              });
            },
            onResult: handleWorkerResult,
          });
        workerRef.current = controller;
        void controller
          .submitVideoFrame(video, performance.now())
          .catch((error: unknown) => {
            resetHandTrackingState({
              displayFrameRef,
              lastSeenAtRef,
              setCursorFrame,
              signalRef,
            });
            setWorkerPhase("error");
            dispatch(classifyCameraAccessError(error));
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

  const handleWorkerMessage = (message: HandWorkerOutboundMessage) => {
    if (message.type === "READY") {
      setWorkerPhase("ready");
    }
    if (message.type === "DISPOSED") {
      setWorkerPhase("idle");
    }
  };

  const handleWorkerResult = (message: HandWorkerResultMessage) => {
    const previous = signalRef.current;
    const hand = message.hands[0] ?? null;
    const nextRaw = hand
      ? extractHandSignal(hand, message.timestampMs, previous)
      : null;

    if (!nextRaw) {
      if (previous) {
        signalRef.current = fadeHandSignal(previous, message.timestampMs);
      }
      return;
    }

    signalRef.current = smoothHandSignal(previous, nextRaw);
    lastSeenAtRef.current = message.timestampMs;
  };

  return (
    <>
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
      >
        <div className="camera-access-panel__meta">
          <span className="camera-access-panel__status">
            {copy.statusLabel}
          </span>
          <span
            className="camera-access-panel__hand"
            data-hand-tone={handCopy.tone}
          >
            <span className="camera-access-panel__hand-dot" />
            {handStatusLabel}
          </span>
        </div>
        <strong>{copy.title}</strong>
        <p>{copy.description}</p>
        {copy.actionLabel ? (
          <button
            disabled={state.status === "requesting"}
            onClick={handleAction}
            type="button"
          >
            {copy.actionLabel}
          </button>
        ) : null}
        <video
          aria-hidden="true"
          className="camera-access-panel__video"
          muted
          playsInline
          ref={videoRef}
        />
      </aside>
    </>
  );
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
  lastSeenAtRef,
  setCursorFrame,
  signalRef,
}: {
  displayFrameRef: MutableRefObject<HandCursorFrame | null>;
  lastSeenAtRef: MutableRefObject<number | null>;
  setCursorFrame: (frame: HandCursorFrame | null) => void;
  signalRef: MutableRefObject<HandSignal | null>;
}) {
  signalRef.current = null;
  lastSeenAtRef.current = null;
  displayFrameRef.current = null;
  setCursorFrame(null);
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

function stopStream(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}
