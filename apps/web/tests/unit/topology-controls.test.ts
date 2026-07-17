import { describe, expect, it } from "vitest";

import {
  isTopologyAvailable,
  topologyLayoutForKey,
  topologyModes,
  topologyModesByLayout,
} from "../../lib/topology-controls";

describe("topology controls", () => {
  it("documents the four topology modes and numeric keys", () => {
    expect(topologyModes.map((mode) => [mode.key, mode.layoutName])).toEqual([
      ["1", "semantic"],
      ["2", "clusters"],
      ["3", "temporal"],
      ["4", "force"],
    ]);
    expect(topologyModesByLayout.clusters.title).toBe("community topology");
  });

  it("maps unmodified number keys while ignoring global-key conflicts", () => {
    expect(
      topologyLayoutForKey({
        altKey: false,
        code: "Digit2",
        ctrlKey: false,
        key: "2",
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe("clusters");
    expect(
      topologyLayoutForKey({
        altKey: false,
        code: "Digit2",
        ctrlKey: false,
        key: "2",
        metaKey: true,
        shiftKey: false,
      }),
    ).toBeNull();
  });

  it("disables temporal topology when dated coverage is unavailable", () => {
    expect(isTopologyAvailable("semantic", false)).toBe(true);
    expect(isTopologyAvailable("temporal", false)).toBe(false);
    expect(isTopologyAvailable("temporal", true)).toBe(true);
  });
});
