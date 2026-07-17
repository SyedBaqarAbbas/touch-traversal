"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import {
  cameraAccessCopy,
  classifyCameraAccessError,
  initialCameraAccessState,
  reduceCameraAccess,
} from "@/lib/camera-access";
import {
  adjustPinchThresholds,
  buildHandCalibrationSteps,
  createInjectedCalibrationHand,
  defaultHandCalibrationSettings,
  loadHandCalibrationSettings,
  resetHandCalibrationSettings,
  saveHandCalibrationSettings,
  summarizeCalibrationHand,
  HAND_CALIBRATION_STORAGE_KEY,
  type HandCalibrationSettings,
} from "@/lib/hand-calibration";
import { extractHandSignal, smoothHandSignal } from "@/lib/hand-signals";
import {
  createHandTrackingWorkerController,
  type HandTrackingWorkerController,
} from "@/lib/hand-tracking-client";
import type {
  NormalizedHand,
  NormalizedHandLandmark,
} from "@/lib/hand-worker-protocol";

type HandCalibrationPanelProps = {
  mode: "calibration" | "debug";
};

const handConnections = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
] as const;

export function HandCalibrationPanel({ mode }: HandCalibrationPanelProps) {
  const [cameraState, dispatchCamera] = useReducer(
    reduceCameraAccess,
    initialCameraAccessState,
  );
  const [settings, setSettings] = useState(defaultHandCalibrationSettings);
  const [latestHand, setLatestHand] = useState<NormalizedHand | null>(null);
  const [latestSignal, setLatestSignal] = useState(
    summarizeCalibrationHand({
      hand: createInjectedCalibrationHand(),
      nowMs: 1000,
      settings: defaultHandCalibrationSettings,
    })?.signal ?? null,
  );
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const workerRef = useRef<HandTrackingWorkerController | null>(null);
  const frameLoopRef = useRef<number | null>(null);
  const signalRef = useRef(latestSignal);
  const injectedHand = useMemo(() => createInjectedCalibrationHand(), []);
  const displayHand = latestHand ?? injectedHand;
  const summary = useMemo(
    () =>
      summarizeCalibrationHand({
        hand: displayHand,
        nowMs: latestSignal?.timestampMs ?? 1000,
        settings,
      }),
    [displayHand, latestSignal?.timestampMs, settings],
  );
  const steps = buildHandCalibrationSteps({
    cameraStatus: cameraState.status,
    settings,
    signal: cameraState.status === "active" && latestHand ? latestSignal : null,
  });
  const copy = cameraAccessCopy(cameraState);
  const heading =
    mode === "debug" ? "Hand input debug" : "Calibrate hand traversal.";

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setSettings(loadHandCalibrationSettings(window.localStorage));
    });
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    return () => {
      stopFrameLoop(frameLoopRef.current);
      workerRef.current?.dispose();
      stopStream(streamRef.current);
    };
  }, []);

  const persistSettings = (nextSettings: HandCalibrationSettings) => {
    const saved = saveHandCalibrationSettings(
      window.localStorage,
      nextSettings,
    );
    setSettings(saved);
  };

  const resetSettings = () => {
    setSettings(resetHandCalibrationSettings(window.localStorage));
  };

  const requestCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      dispatchCamera({ type: "UNSUPPORTED" });
      return;
    }

    dispatchCamera({ type: "REQUEST" });
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
      await attachStream(videoRef.current, stream);
      startFrameLoop();
      dispatchCamera({ type: "ACTIVE" });
    } catch (error: unknown) {
      stopFrameLoop(frameLoopRef.current);
      workerRef.current?.dispose();
      workerRef.current = null;
      stopStream(streamRef.current);
      streamRef.current = null;
      dispatchCamera(classifyCameraAccessError(error));
    }
  };

  const disableCamera = () => {
    stopFrameLoop(frameLoopRef.current);
    workerRef.current?.dispose();
    workerRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    setLatestHand(null);
    setLatestSignal(summary?.signal ?? null);
    signalRef.current = summary?.signal ?? null;
    dispatchCamera({ type: "DISABLE" });
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
              dispatchCamera({
                message: `Hand model failed: ${message.message}. Calibration can continue with injected landmarks.`,
                type: "ERROR",
              });
            },
            onResult: (message) => {
              const hand = message.hands[0] ?? null;
              setLatestHand(hand);
              if (!hand) {
                return;
              }
              const rawSignal = extractHandSignal(
                hand,
                message.timestampMs,
                signalRef.current,
              );
              if (!rawSignal) {
                return;
              }
              const smoothedSignal = smoothHandSignal(
                signalRef.current,
                rawSignal,
              );
              signalRef.current = smoothedSignal;
              setLatestSignal(smoothedSignal);
            },
          });
        workerRef.current = controller;
        void controller
          .submitVideoFrame(video, performance.now())
          .catch((error: unknown) => {
            dispatchCamera(classifyCameraAccessError(error));
          });
      }

      frameLoopRef.current = window.requestAnimationFrame(tick);
    };

    frameLoopRef.current = window.requestAnimationFrame(tick);
  };

  const handleCameraAction = () => {
    if (cameraState.status === "active") {
      disableCamera();
      return;
    }
    void requestCamera();
  };

  return (
    <section
      aria-labelledby={`${mode}-hand-calibration-title`}
      className="hand-calibration-panel"
      data-calibration-mode={mode}
    >
      <div className="hand-calibration-panel__intro">
        <p className="eyebrow">
          {mode === "debug" ? "debug / hand" : "calibration / hand"}
        </p>
        <h2 id={`${mode}-hand-calibration-title`}>{heading}</h2>
        <p>
          Verify framing, fingertip mapping, and pinch thresholds locally. Video
          frames stay in this browser and are never uploaded.
        </p>
      </div>

      <div className="hand-calibration-panel__workspace">
        <article className="hand-preview-card">
          <div className="hand-preview" data-camera-status={cameraState.status}>
            <video
              aria-label="Mirrored hand camera preview"
              className="hand-preview__video"
              muted
              playsInline
              ref={videoRef}
            />
            <HandSkeleton hand={displayHand} />
            {summary ? (
              <span
                aria-hidden="true"
                className="hand-preview__cursor"
                style={{
                  left: summary.cursorLeft,
                  top: summary.cursorTop,
                }}
              />
            ) : null}
            <span className="hand-preview__label">
              {latestHand ? "live landmarks" : "injected landmarks"}
            </span>
          </div>

          <div className="hand-preview-card__actions">
            <div>
              <span className="camera-access-panel__status">
                {copy.statusLabel}
              </span>
              <strong>{copy.title}</strong>
            </div>
            {copy.actionLabel ? (
              <button
                disabled={cameraState.status === "requesting"}
                onClick={handleCameraAction}
                type="button"
              >
                {copy.actionLabel}
              </button>
            ) : null}
          </div>

          <p className="hand-preview-card__privacy">
            Privacy: camera access is optional, hand tracking runs locally, and
            only versioned calibration numbers are saved under{" "}
            <code>{HAND_CALIBRATION_STORAGE_KEY}</code>.
          </p>
        </article>

        <article className="hand-calibration-steps">
          <h3>Calibration steps</h3>
          <ol>
            {steps.map((step) => (
              <li data-step-state={step.state} key={step.id}>
                <span>{step.state}</span>
                <strong>{step.title}</strong>
                <p>{step.detail}</p>
              </li>
            ))}
          </ol>
        </article>

        <article className="hand-calibration-metrics">
          <h3>Metrics</h3>
          <dl>
            <Metric
              label="confidence"
              value={summary ? summary.confidence.toFixed(2) : "—"}
            />
            <Metric
              label="pinch distance"
              value={summary ? summary.signal.pinchDistance.toFixed(2) : "—"}
            />
            <Metric
              label="pinch progress"
              value={
                summary ? `${Math.round(summary.pinchProgress * 100)}%` : "—"
              }
            />
            <Metric label="mirrored" value={settings.mirrored ? "yes" : "no"} />
          </dl>

          <div className="hand-calibration-actions">
            <button
              onClick={() =>
                persistSettings(adjustPinchThresholds(settings, "tighter"))
              }
              type="button"
            >
              tighten pinch
            </button>
            <button
              onClick={() =>
                persistSettings(adjustPinchThresholds(settings, "looser"))
              }
              type="button"
            >
              loosen pinch
            </button>
            <button onClick={resetSettings} type="button">
              reset calibration
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}

function HandSkeleton({ hand }: { hand: NormalizedHand }) {
  return (
    <svg
      aria-hidden="true"
      className="hand-preview__skeleton"
      preserveAspectRatio="none"
      viewBox="0 0 100 100"
    >
      {handConnections.map(([start, end]) => (
        <line
          key={`${start}-${end}`}
          x1={previewX(hand.landmarks[start])}
          x2={previewX(hand.landmarks[end])}
          y1={previewY(hand.landmarks[start])}
          y2={previewY(hand.landmarks[end])}
        />
      ))}
      {hand.landmarks.map((landmark, index) => (
        <circle
          cx={previewX(landmark)}
          cy={previewY(landmark)}
          key={index}
          r={index === 8 ? 1.55 : 0.82}
        />
      ))}
    </svg>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function previewX(landmark: NormalizedHandLandmark): number {
  return (1 - landmark.x) * 100;
}

function previewY(landmark: NormalizedHandLandmark): number {
  return landmark.y * 100;
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
    // Calibration can still show permission/framing state if autoplay stalls.
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
