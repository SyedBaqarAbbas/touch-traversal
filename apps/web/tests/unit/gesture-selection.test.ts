import { describe, expect, it } from "vitest";

import rawFixtures from "../fixtures/gesture-fixtures.json";
import {
  expandGestureFixtures,
  findGestureFixture,
  palmScale,
  type GestureFixtureFile,
  type TimestampedLandmarkFrame,
} from "../../lib/gesture-classifier";
import {
  classifyPointingFrame,
  createPinchSelectionState,
  defaultPinchConfig,
  pinchRatio,
  runPinchSelection,
  updatePinchSelection,
} from "../../lib/gesture-selection";
import type { NormalizedHand } from "../../lib/hand-worker-protocol";

const fixtures = expandGestureFixtures(
  rawFixtures as unknown as GestureFixtureFile,
);

describe("gesture selection", () => {
  it("detects pointing intent while rejecting relaxed idle hands", () => {
    const pointing = classifyPointingFrame(
      findGestureFixture(fixtures, "pointing").frames[0]!,
    );
    const idle = classifyPointingFrame(
      findGestureFixture(fixtures, "idle").frames[0]!,
    );

    expect(pointing.pointing).toBe(true);
    expect(pointing.cursorUsable).toBe(true);
    expect(pointing.indexScore).toBeGreaterThan(pointing.foldedScore * 0.5);
    expect(idle.pointing).toBe(false);
  });

  it("computes pinch ratio from thumb/index distance over palm width", () => {
    const pinchHand = findGestureFixture(fixtures, "stable-pinch").frames[0]!
      .hand!;
    const pointingHand = findGestureFixture(fixtures, "pointing").frames[0]!
      .hand!;

    expect(palmScale(pinchHand)).toBeGreaterThan(0);
    expect(pinchRatio(pinchHand)).toBeLessThan(defaultPinchConfig.startRatio);
    expect(pinchRatio(pointingHand)).toBeGreaterThan(
      defaultPinchConfig.endRatio,
    );
  });

  it("emits begin and hold after a stable debounce window", () => {
    const events = runPinchSelection(
      findGestureFixture(fixtures, "stable-pinch").frames,
    );

    expect(events.map((event) => event.type)).toEqual(["begin"]);
    expect(events[0]).toMatchObject({
      phase: "pressed",
      timestampMs: 160,
      type: "begin",
    });

    const update = updatePinchSelection(
      { candidatePhase: "pressed", candidateSinceMs: 0, phase: "pressed" },
      findGestureFixture(fixtures, "stable-pinch").frames[2]!,
    );
    expect(update.event?.type).toBe("hold");
  });

  it("keeps noisy pinch below threshold from producing repeated transitions", () => {
    const events = runPinchSelection(
      findGestureFixture(fixtures, "noisy-pinch").frames,
    );

    expect(events.filter((event) => event.type === "begin")).toHaveLength(0);
    expect(events.filter((event) => event.type === "release")).toHaveLength(0);
  });

  it("uses hysteresis at threshold boundaries", () => {
    const baseFrame = findGestureFixture(fixtures, "stable-pinch").frames[0]!;
    const boundaryFrame = withPinchRatio(baseFrame, 100, 0.33);
    const releaseCandidateFrame = withPinchRatio(baseFrame, 260, 0.4);
    const releaseCommitFrame = withPinchRatio(baseFrame, 430, 0.4);

    let state = createPinchSelectionState(0);
    let update = updatePinchSelection(state, boundaryFrame);
    expect(update.state.phase).toBe("released");
    expect(update.event).toBeNull();

    state = {
      candidatePhase: "pressed",
      candidateSinceMs: 0,
      phase: "pressed",
    };
    update = updatePinchSelection(state, boundaryFrame);
    expect(update.state.phase).toBe("pressed");
    expect(update.event?.type).toBe("hold");

    update = updatePinchSelection(update.state, releaseCandidateFrame);
    expect(update.state.phase).toBe("pressed");
    expect(update.event?.type).toBe("hold");

    update = updatePinchSelection(update.state, releaseCommitFrame);
    expect(update.state.phase).toBe("released");
    expect(update.event?.type).toBe("release");
  });

  it("releases immediately when the hand is lost", () => {
    const frames = findGestureFixture(fixtures, "hand-loss").frames;
    const pressedState = {
      candidatePhase: "pressed" as const,
      candidateSinceMs: 0,
      phase: "pressed" as const,
    };
    const update = updatePinchSelection(pressedState, frames[2]!);

    expect(update.state.phase).toBe("released");
    expect(update.event?.type).toBe("release");
  });
});

function withPinchRatio(
  frame: TimestampedLandmarkFrame,
  timestampMs: number,
  ratio: number,
): TimestampedLandmarkFrame {
  if (!frame.hand) {
    throw new Error("Expected hand frame");
  }
  const hand = cloneHand(frame.hand);
  const scale = palmScale(hand);
  const indexTip = hand.landmarks[8]!;
  hand.landmarks[4] = {
    ...hand.landmarks[4]!,
    x: indexTip.x + scale * ratio,
    y: indexTip.y,
  };
  return {
    hand,
    timestampMs,
  };
}

function cloneHand(hand: NormalizedHand): NormalizedHand {
  return {
    ...hand,
    landmarks: hand.landmarks.map((landmark) => ({ ...landmark })),
  };
}
