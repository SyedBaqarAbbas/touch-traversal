"use client";

import { useEffect, useReducer, useRef } from "react";

import {
  cameraAccessCopy,
  classifyCameraAccessError,
  initialCameraAccessState,
  reduceCameraAccess,
} from "@/lib/camera-access";

export function CameraAccessPanel() {
  const [state, dispatch] = useReducer(
    reduceCameraAccess,
    initialCameraAccessState,
  );
  const streamRef = useRef<MediaStream | null>(null);
  const copy = cameraAccessCopy(state);

  useEffect(() => {
    return () => {
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
      dispatch({ type: "ACTIVE" });
    } catch (error: unknown) {
      stopStream(streamRef.current);
      streamRef.current = null;
      dispatch(classifyCameraAccessError(error));
    }
  };

  const disableCamera = () => {
    stopStream(streamRef.current);
    streamRef.current = null;
    dispatch({ type: "DISABLE" });
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
    </aside>
  );
}

function stopStream(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}
