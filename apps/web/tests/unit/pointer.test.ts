import { describe, expect, it } from "vitest";

import {
  advanceHoverState,
  createIdleHoverState,
  createUnifiedPointer,
  defaultHoverConfig,
  immediateHoverState,
  updateHoverCandidate,
} from "../../lib/pointer-model";

const rect = {
  left: 100,
  top: 50,
  width: 400,
  height: 200,
};

const pointer = (
  nodeId: string | null,
  x: number,
  y: number,
  timestampMs: number,
) => ({
  nodeId,
  pointer: createUnifiedPointer({
    clientX: x,
    clientY: y,
    rect,
    source: "mouse",
    timestampMs,
  }),
});

describe("pointer model", () => {
  it("normalizes screen coordinates into graph pointer space", () => {
    const unified = createUnifiedPointer({
      clientX: 300,
      clientY: 150,
      rect,
      source: "mouse",
      timestampMs: 12,
    });

    expect(unified.normalized).toEqual({ x: 0, y: -0 });
    expect(unified.screen).toEqual({ x: 300, y: 150 });
    expect(unified.active).toBe(true);
  });

  it("requires the hover entry delay before switching hovered node", () => {
    const first = updateHoverCandidate(
      createIdleHoverState(),
      pointer("a", 240, 120, 0),
    );
    const early = advanceHoverState(first, defaultHoverConfig.entryDelayMs - 1);
    const committed = advanceHoverState(first, defaultHoverConfig.entryDelayMs);

    expect(early.hoveredNodeId).toBeNull();
    expect(committed.hoveredNodeId).toBe("a");
  });

  it("retains the current hover inside the spatial dead zone", () => {
    const current = {
      ...immediateHoverState("a", 0),
      lastPointer: pointer("a", 250, 120, 0).pointer,
    };

    const retained = updateHoverCandidate(current, pointer("b", 260, 126, 120));
    const switched = updateHoverCandidate(current, pointer("b", 330, 160, 120));

    expect(retained.hoveredNodeId).toBe("a");
    expect(switched.candidateNodeId).toBe("b");
  });

  it("starts dwell preview after the configured hover duration", () => {
    const started = updateHoverCandidate(
      createIdleHoverState(),
      pointer("a", 240, 120, 0),
    );
    const hovered = advanceHoverState(started, defaultHoverConfig.entryDelayMs);
    const preview = advanceHoverState(
      hovered,
      defaultHoverConfig.dwellPreviewMs,
    );

    expect(hovered.previewNodeId).toBeNull();
    expect(preview.previewNodeId).toBe("a");
  });
});
