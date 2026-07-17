import { statSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  HAND_LANDMARKER_MODEL_SHA256,
  HAND_LANDMARKER_MODEL_URL,
  MEDIAPIPE_WASM_BASE_URL,
  normalizeHandLandmarkerResult,
  shouldSubmitHandFrame,
  summarizeHandWorkerResponsiveness,
} from "../../lib/hand-worker-protocol";

describe("hand worker protocol", () => {
  it("pins local model and wasm asset locations", () => {
    expect(HAND_LANDMARKER_MODEL_URL).toBe(
      "/models/hand_landmarker/hand_landmarker.task",
    );
    expect(HAND_LANDMARKER_MODEL_SHA256).toHaveLength(64);
    expect(MEDIAPIPE_WASM_BASE_URL).toBe("/vendor/mediapipe/tasks-vision/wasm");
    expect(
      statSync(
        new URL(
          "../../public/models/hand_landmarker/hand_landmarker.task",
          import.meta.url,
        ),
      ).size,
    ).toBeGreaterThan(7_000_000);
    expect(
      statSync(
        new URL(
          "../../public/vendor/mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm",
          import.meta.url,
        ),
      ).size,
    ).toBeGreaterThan(1_000_000);
  });

  it("throttles frame submission to the 15-30 FPS inference budget", () => {
    expect(shouldSubmitHandFrame({ lastSubmittedAtMs: null, nowMs: 0 })).toBe(
      true,
    );
    expect(
      shouldSubmitHandFrame({
        lastSubmittedAtMs: 100,
        nowMs: 120,
        targetFps: 30,
      }),
    ).toBe(false);
    expect(
      shouldSubmitHandFrame({
        lastSubmittedAtMs: 100,
        nowMs: 134,
        targetFps: 30,
      }),
    ).toBe(true);
  });

  it("normalizes MediaPipe results into serializable hand messages", () => {
    const [hand] = normalizeHandLandmarkerResult({
      handedness: [
        [
          {
            categoryName: "Right",
            displayName: "Right",
            index: 1,
            score: 0.94,
          },
        ],
      ],
      handednesses: [],
      landmarks: [
        [
          {
            visibility: 0.8,
            x: 0.25,
            y: 0.5,
            z: -0.1,
          },
        ],
      ],
      worldLandmarks: [],
    });

    expect(hand).toEqual({
      handedness: "Right",
      landmarks: [{ visibility: 0.8, x: 0.25, y: 0.5, z: -0.1 }],
      score: 0.94,
    });
  });

  it("summarizes inference and render responsiveness", () => {
    const summary = summarizeHandWorkerResponsiveness({
      inferenceTimestampsMs: [0, 42, 84, 126, 168],
      renderFrameTimestampsMs: [0, 16, 32, 48, 64, 80, 96],
    });

    expect(summary.inferenceFps).toBeGreaterThanOrEqual(23);
    expect(summary.inferenceFps).toBeLessThanOrEqual(25);
    expect(summary.renderFps).toBeGreaterThan(60);
    expect(summary.targetSatisfied).toBe(true);
  });
});
