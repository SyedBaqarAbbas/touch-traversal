import { describe, expect, it } from "vitest";

import rawFixtures from "../fixtures/gesture-fixtures.json";
import {
  expandGestureFixtures,
  findGestureFixture,
  type GestureFixtureFile,
  type TimestampedLandmarkFrame,
} from "../../lib/gesture-classifier";
import {
  buildHandGestureCalibrationSteps,
  createHandGestureCalibrationState,
  handGestureCalibrationOrder,
  updateHandGestureCalibration,
  type HandGestureCalibrationState,
} from "../../lib/hand-gesture-calibration";

const fixtures = expandGestureFixtures(
  rawFixtures as unknown as GestureFixtureFile,
);

describe("hand gesture calibration", () => {
  it("rehearses the full production gesture vocabulary from deterministic fixtures", () => {
    expect(runFixture("pointing").completed).toContain("point");

    const pinch = runFixture("stable-pinch");
    expect(pinch.completed).toEqual(
      expect.arrayContaining(["pinch", "empty-space-grab"]),
    );

    const openPalm = fixturesForOpenPalmHold();
    expect(runFrames(openPalm).completed).toContain("open-palm");
    expect(runFixture("left-swipe").completed).toContain("horizontal-sweep");
    expect(runFixture("orbit").completed).toContain("orbit");
    expect(runFixture("pan").completed).toContain("pan");
    expect(runFixture("zoom-in").completed).toContain("depth-zoom");
    expect(runFixture("grab-release").completed).toContain("release");
  });

  it("surfaces live sweep progress from the same distance, speed, and stability metrics", () => {
    const frames = findGestureFixture(fixtures, "left-swipe").frames;
    const partial = runFrames(frames.slice(0, 2));
    const complete = runFrames(frames);

    expect(partial.feedback.swipeDirection).toBe("left");
    expect(partial.feedback.swipeProgress).toBeGreaterThan(0);
    expect(partial.feedback.swipeProgress).toBeLessThan(1);
    expect(complete.completed).toContain("horizontal-sweep");
    expect(complete.feedback.swipeProgress).toBe(1);
  });

  it("blocks rehearsal without an active camera and reports every gesture", () => {
    const state = createHandGestureCalibrationState();
    const blocked = buildHandGestureCalibrationSteps({
      cameraStatus: "idle",
      state,
    });
    const active = buildHandGestureCalibrationSteps({
      cameraStatus: "active",
      state,
    });

    expect(blocked.map((step) => step.id)).toEqual(handGestureCalibrationOrder);
    expect(blocked.every((step) => step.state === "blocked")).toBe(true);
    expect(active.every((step) => step.state === "active")).toBe(true);
    expect(
      active.find((step) => step.id === "horizontal-sweep")?.detail,
    ).toContain("sweep quickly and steadily");
  });

  it("does not count hand loss as an intentional grab release", () => {
    const state = runFixture("hand-loss-mid-grab");

    expect(state.completed).toContain("empty-space-grab");
    expect(state.completed).not.toContain("release");
  });
});

function runFixture(name: Parameters<typeof findGestureFixture>[1]) {
  return runFrames(findGestureFixture(fixtures, name).frames);
}

function runFrames(
  frames: readonly TimestampedLandmarkFrame[],
): HandGestureCalibrationState {
  return frames.reduce(
    (state, frame) => updateHandGestureCalibration(state, frame),
    createHandGestureCalibrationState(),
  );
}

function fixturesForOpenPalmHold(): TimestampedLandmarkFrame[] {
  const frame = findGestureFixture(fixtures, "open-palm").frames[0]!;
  return [0, 240, 480].map((timestampMs) => ({
    ...frame,
    timestampMs,
  }));
}
