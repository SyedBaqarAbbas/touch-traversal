import { describe, expect, it } from "vitest";

import {
  classifyHandCursorStatus,
  handCursorFrameFromSignal,
  handCursorScreenStyle,
  interpolateHandCursorFrame,
  pinchProgress,
  type HandCursorFrame,
} from "../../lib/hand-cursor";
import type { HandSignal } from "../../lib/hand-signals";

describe("hand cursor", () => {
  it("classifies acquisition, tracking, low-confidence, and hand loss", () => {
    expect(
      classifyHandCursorStatus({
        cameraActive: true,
        lastSeenAtMs: null,
        nowMs: 1000,
        signal: null,
      }),
    ).toBe("acquiring");
    expect(
      classifyHandCursorStatus({
        cameraActive: true,
        lastSeenAtMs: 960,
        nowMs: 1000,
        signal: { confidence: 0.9 },
      }),
    ).toBe("tracking");
    expect(
      classifyHandCursorStatus({
        cameraActive: true,
        lastSeenAtMs: 960,
        nowMs: 1000,
        signal: { confidence: 0.32 },
      }),
    ).toBe("low-confidence");
    expect(
      classifyHandCursorStatus({
        cameraActive: true,
        lastSeenAtMs: 400,
        nowMs: 1000,
        signal: { confidence: 0.8 },
      }),
    ).toBe("lost");
  });

  it("interpolates the display cursor toward new inference positions", () => {
    const previous = makeFrame({
      position: { x: -0.6, y: 0.2 },
      timestampMs: 1000,
    });
    const target = makeFrame({
      position: { x: 0.6, y: 0.4 },
      timestampMs: 1016,
    });
    const interpolated = interpolateHandCursorFrame({
      latencyMs: 42,
      nowMs: 1016,
      previous,
      target,
    });

    expect(interpolated.position.x).toBeGreaterThan(previous.position.x);
    expect(interpolated.position.x).toBeLessThan(target.position.x);
    expect(interpolated.position.y).toBeGreaterThan(previous.position.y);
    expect(interpolated.timestampMs).toBe(1016);
  });

  it("maps mirrored NDC to clamped screen percentage styles", () => {
    expect(
      handCursorScreenStyle(
        makeFrame({ position: { x: 0, y: 0 }, timestampMs: 1000 }),
      ),
    ).toEqual({ left: "50.00%", top: "50.00%" });
    expect(
      handCursorScreenStyle(
        makeFrame({ position: { x: 2, y: -2 }, timestampMs: 1000 }),
      ),
    ).toEqual({ left: "98.00%", top: "98.00%" });
  });

  it("converts pinch distance into future progress ring values", () => {
    expect(pinchProgress(0.9)).toBe(0);
    expect(pinchProgress(0.28)).toBe(1);
    expect(pinchProgress(0.53)).toBeCloseTo(0.5);
  });

  it("builds cursor frames from smoothed hand signals", () => {
    const frame = handCursorFrameFromSignal({
      cameraActive: true,
      lastSeenAtMs: 1000,
      nowMs: 1016,
      signal: makeSignal({
        confidence: 0.74,
        fingertip: { x: 0.2, y: -0.1 },
        pinchDistance: 0.53,
      }),
    });

    expect(frame).toMatchObject({
      confidence: 0.74,
      position: { x: 0.2, y: -0.1 },
      status: "tracking",
      visible: true,
    });
    expect(frame?.pinchProgress).toBeCloseTo(0.5);
  });
});

function makeFrame(overrides: Partial<HandCursorFrame>): HandCursorFrame {
  return {
    confidence: 1,
    pinchProgress: 0,
    position: { x: 0, y: 0 },
    status: "tracking",
    timestampMs: 0,
    visible: true,
    ...overrides,
  };
}

function makeSignal(overrides: Partial<HandSignal>): HandSignal {
  return {
    confidence: 1,
    fingertip: { x: 0, y: 0 },
    palmCenter: { x: 0, y: 0 },
    palmSize: 0.3,
    pinchDistance: 0,
    swipeVelocity: { x: 0, y: 0 },
    timestampMs: 0,
    ...overrides,
  };
}
