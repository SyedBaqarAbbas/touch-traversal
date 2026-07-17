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
});
