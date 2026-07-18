import { describe, expect, it } from "vitest";

import {
  initialPerformancePresentationState,
  performanceCompositionPolicy,
  reducePerformancePresentation,
} from "../../lib/performance-presentation";

describe("performance presentation", () => {
  it("switches presentation without discarding the mounted scene state", () => {
    const graphOnly = reducePerformancePresentation(
      initialPerformancePresentationState,
      { type: "TOGGLE_LAYER" },
    );
    const visibleAgain = reducePerformancePresentation(graphOnly, {
      type: "TOGGLE_LAYER",
    });

    expect(graphOnly).toMatchObject({
      emphasis: "balanced",
      layerVisible: false,
      mirrored: true,
    });
    expect(visibleAgain).toEqual(initialPerformancePresentationState);
  });

  it("cycles emphasis, mirror, and framing deterministically", () => {
    const graph = reducePerformancePresentation(
      initialPerformancePresentationState,
      { type: "CYCLE_EMPHASIS" },
    );
    const video = reducePerformancePresentation(graph, {
      type: "CYCLE_EMPHASIS",
    });
    const unmirrored = reducePerformancePresentation(video, {
      type: "TOGGLE_MIRROR",
    });
    const reset = reducePerformancePresentation(unmirrored, {
      type: "RESET_FRAMING",
    });

    expect(graph.emphasis).toBe("graph");
    expect(video.emphasis).toBe("video");
    expect(unmirrored.mirrored).toBe(false);
    expect(reset.framingRevision).toBe(1);
  });

  it("degrades video and inference before graph interaction thresholds", () => {
    expect(performanceCompositionPolicy("high", "video")).toEqual({
      targetInferenceFps: 24,
      videoOpacity: 0.82,
    });
    expect(performanceCompositionPolicy("medium", "video")).toEqual({
      targetInferenceFps: 20,
      videoOpacity: 0.64,
    });
    expect(performanceCompositionPolicy("low", "video")).toEqual({
      targetInferenceFps: 15,
      videoOpacity: 0.5,
    });
  });
});
