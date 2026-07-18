import { describe, expect, it } from "vitest";

import {
  handCursorPointer,
  topologyAfterSwipe,
} from "../../lib/scene-gesture-input";

describe("scene gesture input", () => {
  it("maps the mirrored hand cursor into the shared pointer coordinates", () => {
    expect(
      handCursorPointer(
        {
          confidence: 0.92,
          pinchProgress: 0,
          position: { x: 0.5, y: -0.5 },
          status: "tracking",
          timestampMs: 420,
          visible: true,
        },
        { height: 400, left: 100, top: 50, width: 800 },
      ),
    ).toEqual({
      active: true,
      normalized: { x: 0.5, y: -0.5 },
      screen: { x: 700, y: 350 },
      source: "hand",
      timestampMs: 420,
    });
  });

  it("cycles swipe topology while skipping unavailable temporal data", () => {
    expect(topologyAfterSwipe("semantic", "right", true)).toBe("clusters");
    expect(topologyAfterSwipe("clusters", "right", false)).toBe("force");
    expect(topologyAfterSwipe("force", "left", false)).toBe("clusters");
    expect(topologyAfterSwipe("semantic", "left", true)).toBe("force");
  });
});
