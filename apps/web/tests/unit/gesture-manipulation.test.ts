import { describe, expect, it } from "vitest";

import rawFixtures from "../fixtures/gesture-fixtures.json";
import {
  expandGestureFixtures,
  findGestureFixture,
  type GestureFixtureFile,
  type TimestampedLandmarkFrame,
} from "../../lib/gesture-classifier";
import {
  createHandManipulationState,
  updateHandManipulation,
  type HandManipulationEvent,
} from "../../lib/gesture-manipulation";
import {
  createPinchSelectionState,
  updatePinchSelection,
} from "../../lib/gesture-selection";

const fixtures = expandGestureFixtures(
  rawFixtures as unknown as GestureFixtureFile,
);

describe("hand view manipulation", () => {
  it("acquires only a debounced empty-space pinch and emits authored orbit and pan deltas", () => {
    const orbit = runManipulation(findGestureFixture(fixtures, "orbit").frames);
    const pan = runManipulation(findGestureFixture(fixtures, "pan").frames);

    expect(orbit.events[0]).toMatchObject({ phase: "begin", timestampMs: 160 });
    expect(
      orbit.events.some(
        (event) =>
          event.phase === "update" && Math.abs(event.delta.orbitYaw) > 0.02,
      ),
    ).toBe(true);
    expect(
      pan.events.some(
        (event) =>
          event.phase === "update" && Math.abs(event.delta.panY) > 0.02,
      ),
    ).toBe(true);

    expect(
      runManipulation(findGestureFixture(fixtures, "empty-space-grab").frames, {
        targetNodeId: "node-a",
      }).events,
    ).toEqual([]);
  });

  it("maps palm-scale depth into stable zoom with a jitter dead zone", () => {
    const zoomIn = runManipulation(
      findGestureFixture(fixtures, "zoom-in").frames,
    );
    const zoomOut = runManipulation(
      findGestureFixture(fixtures, "zoom-out").frames,
    );
    const noisy = runManipulation(
      findGestureFixture(fixtures, "noisy-depth").frames,
    );

    expect(totalZoom(zoomIn.events)).toBeGreaterThan(0.08);
    expect(totalZoom(zoomOut.events)).toBeLessThan(-0.08);
    expect(Math.abs(totalZoom(noisy.events))).toBeLessThan(0.01);
  });

  it("ends on release and cancels safely on hand loss or a conflicting mode", () => {
    expect(
      runManipulation(findGestureFixture(fixtures, "grab-release").frames)
        .events,
    ).toContainEqual({
      phase: "end",
      reason: "release",
      timestampMs: 400,
    });
    expect(
      runManipulation(findGestureFixture(fixtures, "hand-loss-mid-grab").frames)
        .events,
    ).toContainEqual({
      phase: "cancel",
      reason: "hand-loss",
      timestampMs: 240,
    });

    const frames = findGestureFixture(fixtures, "orbit").frames;
    expect(
      runManipulation(frames, {
        allowed: (frame) => frame.timestampMs < 240,
      }).events,
    ).toContainEqual({
      phase: "cancel",
      reason: "conflict",
      timestampMs: 240,
    });
  });
});

function runManipulation(
  frames: readonly TimestampedLandmarkFrame[],
  options: {
    allowed?: (frame: TimestampedLandmarkFrame) => boolean;
    targetNodeId?: string | null;
  } = {},
): { events: HandManipulationEvent[] } {
  let pinch = createPinchSelectionState();
  let manipulation = createHandManipulationState();
  const events: HandManipulationEvent[] = [];
  for (const frame of frames) {
    const pinchUpdate = updatePinchSelection(pinch, frame);
    pinch = pinchUpdate.state;
    const update = updateHandManipulation(manipulation, frame, {
      allowed: options.allowed?.(frame) ?? true,
      pinchEvent: pinchUpdate.event,
      pinchPhase: pinchUpdate.state.phase,
      targetNodeId: options.targetNodeId ?? null,
    });
    manipulation = update.state;
    if (update.event) {
      events.push(update.event);
    }
  }
  return { events };
}

function totalZoom(events: readonly HandManipulationEvent[]): number {
  return events.reduce(
    (total, event) => total + (event.phase === "update" ? event.delta.zoom : 0),
    0,
  );
}
