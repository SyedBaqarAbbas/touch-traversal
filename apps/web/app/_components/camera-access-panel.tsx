"use client";

import { useEffect, useReducer, useRef } from "react";

import {
  cameraAccessCopy,
  classifyCameraAccessError,
  initialCameraAccessState,
  reduceCameraAccess,
} from "@/lib/camera-access";
import {
  createHandTrackingWorkerController,
  type HandTrackingWorkerController,
} from "@/lib/hand-tracking-client";

export function CameraAccessPanel() {
  const [state, dispatch] = useReducer(
    reduceCameraAccess,
    initialCameraAccessState,
  );
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const workerRef = useRef<HandTrackingWorkerController | null>(null);
  const frameLoopRef = useRef<number | null>(null);
  const copy = cameraAccessCopy(state);

  useEffect(() => {
    return () => {
      stopFrameLoop(frameLoopRef.current);
      workerRef.current?.dispose();
      stopStream(streamRef.current);
    };
  }, []);

  const requestCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      dispatch({ type: "UNSUPPORTED" });
      return;
    }

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
      stopStream(streamRef.current);
      streamRef.current = null;
      dispatch(classifyCameraAccessError(error));
    }
  };

  const disableCamera = () => {
    stopFrameLoop(frameLoopRef.current);
    workerRef.current?.dispose();
    workerRef.current = null;
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
            onError: (message) => {
              dispatch({
                message: `Hand model failed: ${message.message}. Mouse and keyboard remain available.`,
                type: "ERROR",
              });
            },
          });
        workerRef.current = controller;
        void controller
          .submitVideoFrame(video, performance.now())
          .catch((error: unknown) => {
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

  return (
    <aside
      aria-live="polite"
      className="camera-access-panel"
      data-camera-status={state.status}
    >
      <span className="camera-access-panel__status">{copy.statusLabel}</span>
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
  );
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
