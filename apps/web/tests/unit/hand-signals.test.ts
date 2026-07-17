import { describe, expect, it } from "vitest";

import {
  adaptiveAlpha,
  extractHandSignal,
  fadeHandSignal,
  normalizedToMirroredNdc,
  smoothHandSignal,
  type HandSignal,
} from "../../lib/hand-signals";
import type {
  NormalizedHand,
  NormalizedHandLandmark,
} from "../../lib/hand-worker-protocol";

describe("hand signals", () => {
  it("maps normalized index-tip coordinates into mirrored NDC space", () => {
    expect(normalizedToMirroredNdc({ x: 0.2, y: 0.25 })).toEqual({
      x: 0.6,
      y: 0.5,
    });
    expect(normalizedToMirroredNdc({ x: 0.8, y: 0.25 })).toEqual({
      x: -0.6000000000000001,
      y: 0.5,
    });
  });

  it("normalizes pinch distance by palm size", () => {
    const narrow = extractHandSignal(makeHand({ palmHalfWidth: 0.08 }), 1000);
    const wide = extractHandSignal(makeHand({ palmHalfWidth: 0.16 }), 1000);

    expect(narrow?.pinchDistance).toBeGreaterThan(wide?.pinchDistance ?? 0);
    expect(narrow?.palmSize).toBeCloseTo(0.32);
    expect(wide?.palmSize).toBeCloseTo(0.64);
  });

  it("uses lower latency during fast motion than slow motion", () => {
    expect(adaptiveAlpha(0.1)).toBeLessThan(adaptiveAlpha(5));
  });

  it("smooths fingertip, palm, pinch, and swipe channels independently", () => {
    const previous = makeSignal({
      fingertip: { x: 0, y: 0 },
      palmCenter: { x: 0, y: 0 },
      pinchDistance: 0.4,
      swipeVelocity: { x: 0, y: 0 },
      timestampMs: 0,
    });
    const next = makeSignal({
      fingertip: { x: 0.1, y: 0 },
      palmCenter: { x: 0.8, y: 0 },
      pinchDistance: 1.4,
      swipeVelocity: { x: 9, y: 0 },
      timestampMs: 100,
    });
    const smoothed = smoothHandSignal(previous, next);

    expect(smoothed.fingertip.x).toBeGreaterThan(0);
    expect(smoothed.fingertip.x).toBeLessThan(next.fingertip.x);
    expect(smoothed.palmCenter.x).toBeGreaterThan(smoothed.fingertip.x);
    expect(smoothed.pinchDistance).toBeGreaterThan(previous.pinchDistance);
    expect(smoothed.pinchDistance).toBeLessThan(next.pinchDistance);
    expect(smoothed.swipeVelocity.x).toBeGreaterThan(0);
    expect(smoothed.swipeVelocity.x).toBeLessThan(next.swipeVelocity.x);
  });

  it("fades confidence gracefully when the hand leaves frame", () => {
    const previous = makeSignal({ confidence: 0.8, timestampMs: 1000 });
    const faded = fadeHandSignal(previous, 1180);

    expect(faded.confidence).toBeCloseTo(0.4);
    expect(faded.swipeVelocity).toEqual({ x: 0, y: 0 });
    expect(faded.fingertip).toEqual(previous.fingertip);
  });
});

function makeHand({
  palmHalfWidth,
}: {
  palmHalfWidth: number;
}): NormalizedHand {
  const landmarks = Array.from({ length: 21 }, (): NormalizedHandLandmark => ({
    visibility: null,
    x: 0.5,
    y: 0.5,
    z: 0,
  }));
  landmarks[0] = { visibility: null, x: 0.5, y: 0.72, z: 0 };
  landmarks[4] = { visibility: null, x: 0.44, y: 0.38, z: 0 };
  landmarks[5] = { visibility: null, x: 0.5 - palmHalfWidth, y: 0.58, z: 0 };
  landmarks[8] = { visibility: null, x: 0.54, y: 0.34, z: 0 };
  landmarks[9] = { visibility: null, x: 0.5, y: 0.55, z: 0 };
  landmarks[17] = { visibility: null, x: 0.5 + palmHalfWidth, y: 0.58, z: 0 };

  return {
    handedness: "Right",
    landmarks,
    score: 0.9,
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
