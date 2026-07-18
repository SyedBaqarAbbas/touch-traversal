import { describe, expect, it } from "vitest";

import rawFixtures from "../fixtures/gesture-fixtures.json";
import {
  expandGestureFixtures,
  findGestureFixture,
  type GestureFixtureFile,
} from "../../lib/gesture-classifier";
import {
  createHandInputBridgeState,
  updateHandInputBridge,
} from "../../lib/hand-input-bridge";
import type {
  HandWorkerResultMessage,
  NormalizedHand,
} from "../../lib/hand-worker-protocol";

const fixtures = expandGestureFixtures(
  rawFixtures as unknown as GestureFixtureFile,
);
const pointingHand = findGestureFixture(fixtures, "pointing").frames[0]!.hand!;

describe("live hand input bridge", () => {
  it("surfaces normalized landmarks with the worker timestamp and a smoothed signal", () => {
    const first = updateHandInputBridge(
      createHandInputBridgeState(),
      result(pointingHand, 100),
    );
    const movedHand = moveHand(pointingHand, 0.08);
    const second = updateHandInputBridge(first.state, result(movedHand, 140));

    expect(second.landmarkFrame).toEqual({
      hand: movedHand,
      timestampMs: 140,
    });
    expect(second.state.lastSeenAtMs).toBe(140);
    expect(second.state.signal).toMatchObject({
      confidence: pointingHand.score,
      timestampMs: 140,
    });
    expect(second.state.signal?.fingertip.x).not.toBe(
      first.state.signal?.fingertip.x,
    );
  });

  it("publishes explicit hand-loss frames and fades the prior signal", () => {
    const tracking = updateHandInputBridge(
      createHandInputBridgeState(),
      result(pointingHand, 100),
    );
    const lost = updateHandInputBridge(tracking.state, result(null, 280));

    expect(lost.landmarkFrame).toEqual({ hand: null, timestampMs: 280 });
    expect(lost.state.lastSeenAtMs).toBe(100);
    expect(lost.state.signal?.confidence).toBeLessThan(
      tracking.state.signal!.confidence,
    );
    expect(lost.state.signal?.swipeVelocity).toEqual({ x: 0, y: 0 });
  });

  it("keeps raw normalized landmarks observable when cursor extraction is unavailable", () => {
    const incompleteHand: NormalizedHand = {
      handedness: "Right",
      landmarks: [],
      score: 0.7,
    };
    const update = updateHandInputBridge(
      createHandInputBridgeState(),
      result(incompleteHand, 500),
    );

    expect(update.landmarkFrame.hand).toBe(incompleteHand);
    expect(update.state).toEqual(createHandInputBridgeState());
  });
});

function result(
  hand: NormalizedHand | null,
  timestampMs: number,
): HandWorkerResultMessage {
  return {
    hands: hand ? [hand] : [],
    height: 180,
    inferenceMs: 8,
    timestampMs,
    type: "RESULT",
    width: 320,
  };
}

function moveHand(hand: NormalizedHand, offsetX: number): NormalizedHand {
  return {
    ...hand,
    landmarks: hand.landmarks.map((landmark) => ({
      ...landmark,
      x: landmark.x + offsetX,
    })),
  };
}
