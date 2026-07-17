import { describe, expect, it } from "vitest";

import {
  cameraModeForInteraction,
  createInteractionState,
  interactionModes,
  reduceInteraction,
} from "../../lib/interaction-model";

describe("interaction state machine", () => {
  it("documents the full interaction mode set", () => {
    expect(interactionModes).toEqual([
      "IDLE",
      "HOVERING",
      "FOCUSING",
      "FOCUSED",
      "TRAVERSING",
      "MORPHING",
      "CALIBRATING",
    ]);
  });

  it("moves from hover to focus and back to overview", () => {
    const initial = createInteractionState(0);
    const hovering = reduceInteraction(initial, {
      type: "HOVER_START",
      nodeId: "a",
      timestampMs: 20,
    });
    const focusing = reduceInteraction(hovering, {
      type: "SELECT_NODE",
      nodeId: "a",
      timestampMs: 40,
    });
    const focused = reduceInteraction(focusing, {
      type: "FOCUS_COMPLETE",
      timestampMs: 1140,
    });
    const returned = reduceInteraction(focused, {
      type: "RETURN_OVERVIEW",
      timestampMs: 1600,
    });

    expect(hovering.mode).toBe("HOVERING");
    expect(focusing.mode).toBe("FOCUSING");
    expect(focused.mode).toBe("FOCUSED");
    expect(cameraModeForInteraction(focused)).toBe("focus");
    expect(returned).toMatchObject({
      mode: "IDLE",
      hoveredNodeId: null,
      selectedNodeId: null,
    });
  });

  it("settles traversal back into focused mode", () => {
    const focused = reduceInteraction(
      reduceInteraction(createInteractionState(0), {
        type: "SELECT_NODE",
        nodeId: "source",
        timestampMs: 20,
      }),
      {
        type: "FOCUS_COMPLETE",
        timestampMs: 1120,
      },
    );
    const traversing = reduceInteraction(focused, {
      type: "START_TRAVERSAL",
      nodeId: "target",
      timestampMs: 1300,
    });
    const settled = reduceInteraction(traversing, {
      type: "FOCUS_COMPLETE",
      timestampMs: 2500,
    });

    expect(traversing).toMatchObject({
      hoveredNodeId: "target",
      mode: "TRAVERSING",
      selectedNodeId: "target",
    });
    expect(settled).toMatchObject({
      mode: "FOCUSED",
      selectedNodeId: "target",
    });
  });
});
