import { describe, expect, it } from "vitest";

import rawFixtures from "../fixtures/gesture-fixtures.json";
import {
  expandGestureFixtures,
  findGestureFixture,
  type GestureFixtureFile,
  type TimestampedLandmarkFrame,
} from "../../lib/gesture-classifier";
import {
  createGestureControllerState,
  updateGestureController,
  type GestureControllerAction,
} from "../../lib/gesture-controller";

const fixtures = expandGestureFixtures(
  rawFixtures as unknown as GestureFixtureFile,
);

describe("gesture controller", () => {
  it("routes pinch begin into a unified select action and hint", () => {
    const actions = runController(
      findGestureFixture(fixtures, "stable-pinch").frames,
      {
        safeToReturn: true,
        targetNodeId: "node-a",
        topologyMorphing: false,
      },
    );

    expect(actions).toContainEqual({
      nodeId: "node-a",
      timestampMs: 160,
      type: "select",
    });
    expect(actions).toContainEqual({
      expiresAtMs: 1560,
      label: "gesture / pinch select",
      timestampMs: 160,
      type: "hint",
    });
  });

  it("routes open palm hold into return action", () => {
    const openPalm = findGestureFixture(fixtures, "open-palm").frames[0]!;
    const actions = runController(retime(openPalm, [0, 240, 480]), {
      safeToReturn: true,
      targetNodeId: "node-a",
      topologyMorphing: false,
    });

    expect(actions).toContainEqual({
      timestampMs: 480,
      type: "return",
    });
    expect(
      actions.some(
        (action) =>
          action.type === "hint" &&
          action.label === "gesture / open palm return",
      ),
    ).toBe(true);
  });

  it("routes horizontal swipes into topology actions", () => {
    const actions = runController(
      findGestureFixture(fixtures, "left-swipe").frames,
      {
        safeToReturn: true,
        targetNodeId: "node-a",
        topologyMorphing: false,
      },
    );

    expect(actions).toContainEqual({
      direction: "left",
      timestampMs: 180,
      type: "topology",
    });
  });

  it("suppresses hand actions shortly after mouse activity without disabling state updates", () => {
    const actions = runController(
      findGestureFixture(fixtures, "stable-pinch").frames,
      {
        mouseSuppressionUntilMs: 500,
        safeToReturn: true,
        targetNodeId: "node-a",
        topologyMorphing: false,
      },
    );

    expect(actions.some((action) => action.type === "select")).toBe(false);
    expect(actions.some((action) => action.type === "hint")).toBe(false);
  });

  it("routes an empty-space pinch through manipulation while preserving node selection", () => {
    const emptySpaceActions = runController(
      findGestureFixture(fixtures, "orbit").frames,
      {
        manipulationAllowed: true,
        safeToReturn: true,
        targetNodeId: null,
        topologyMorphing: false,
      },
    );
    const nodeActions = runController(
      findGestureFixture(fixtures, "stable-pinch").frames,
      {
        manipulationAllowed: true,
        safeToReturn: true,
        targetNodeId: "node-a",
        topologyMorphing: false,
      },
    );

    expect(emptySpaceActions).toContainEqual({
      event: { phase: "begin", timestampMs: 160 },
      timestampMs: 160,
      type: "manipulation",
    });
    expect(
      emptySpaceActions.some(
        (action) =>
          action.type === "manipulation" && action.event.phase === "update",
      ),
    ).toBe(true);
    expect(emptySpaceActions.some((action) => action.type === "select")).toBe(
      false,
    );
    expect(nodeActions).toContainEqual({
      nodeId: "node-a",
      timestampMs: 160,
      type: "select",
    });
    expect(nodeActions.some((action) => action.type === "manipulation")).toBe(
      false,
    );
  });

  it("cancels an active grab when a traversal or morph conflict begins", () => {
    let state = createGestureControllerState();
    const frames = findGestureFixture(fixtures, "orbit").frames;
    const actions: GestureControllerAction[] = [];
    for (const frame of frames) {
      const update = updateGestureController(state, frame, {
        manipulationAllowed: frame.timestampMs < 240,
        safeToReturn: true,
        targetNodeId: null,
        topologyMorphing: frame.timestampMs >= 240,
      });
      state = update.state;
      actions.push(...update.actions);
    }

    expect(actions).toContainEqual({
      event: {
        phase: "cancel",
        reason: "conflict",
        timestampMs: 240,
      },
      timestampMs: 240,
      type: "manipulation",
    });
    expect(actions.some((action) => action.type === "topology")).toBe(false);
  });
});

function runController(
  frames: readonly TimestampedLandmarkFrame[],
  context: Parameters<typeof updateGestureController>[2],
): GestureControllerAction[] {
  let state = createGestureControllerState();
  const actions: GestureControllerAction[] = [];
  for (const frame of frames) {
    const update = updateGestureController(state, frame, context);
    state = update.state;
    actions.push(...update.actions);
  }
  return actions;
}

function retime(
  frame: TimestampedLandmarkFrame,
  timestampsMs: readonly number[],
): TimestampedLandmarkFrame[] {
  return timestampsMs.map((timestampMs) => ({
    ...frame,
    timestampMs,
  }));
}
