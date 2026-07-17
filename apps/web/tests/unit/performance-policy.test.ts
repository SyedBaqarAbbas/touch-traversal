import { describe, expect, it } from "vitest";

import {
  chooseSceneQuality,
  limitThoughtLabels,
  limitVisibleItems,
  scenePerformanceScenarios,
  summarizeFrameDurations,
} from "../../lib/performance-policy";

describe("performance policy", () => {
  it("documents the required measurement scenarios", () => {
    expect(scenePerformanceScenarios).toEqual([
      {
        id: "overview-100-400",
        mode: "overview",
        nodeCount: 100,
        edgeCount: 400,
      },
      { id: "focus-100-400", mode: "focus", nodeCount: 100, edgeCount: 400 },
      {
        id: "overview-300-1500",
        mode: "overview",
        nodeCount: 300,
        edgeCount: 1500,
      },
      { id: "focus-300-1500", mode: "focus", nodeCount: 300, edgeCount: 1500 },
    ]);
  });

  it("selects adaptive quality without hiding work on the sample graph", () => {
    expect(chooseSceneQuality({ nodeCount: 4, edgeCount: 4 }).name).toBe(
      "high",
    );
    expect(
      chooseSceneQuality({ nodeCount: 300, edgeCount: 1500 }),
    ).toMatchObject({
      name: "low",
      maxVisibleEdges: 900,
    });
  });

  it("limits edge and label density deterministically", () => {
    expect(
      limitVisibleItems(
        [
          { id: "a", visible: 1 },
          { id: "b", visible: 1 },
          { id: "c", visible: 1 },
        ],
        2,
      ),
    ).toEqual([
      { id: "a", visible: 1 },
      { id: "b", visible: 1 },
      { id: "c", visible: 0 },
    ]);

    expect(
      limitThoughtLabels(
        [
          { kind: "neighbor", nodeId: "c" },
          { kind: "hover", nodeId: "b" },
          { kind: "selected", nodeId: "a" },
        ],
        2,
      ),
    ).toEqual([
      { kind: "selected", nodeId: "a" },
      { kind: "hover", nodeId: "b" },
    ]);
  });

  it("summarizes frame durations into fps metrics", () => {
    expect(summarizeFrameDurations([16.7, 16.6, 20])).toMatchObject({
      averageFps: 56.3,
      minimumFps: 50,
      p95FrameMs: 20,
    });
  });
});
