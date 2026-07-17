import { describe, expect, it } from "vitest";

import {
  MAX_TRAVERSAL_DURATION_MS,
  MIN_TRAVERSAL_DURATION_MS,
  createTraversalChoreography,
  pulseOpacity,
  sampleTraversalChoreography,
  traversalDurationMs,
} from "../../lib/traversal-choreography";
import type { CameraPose } from "../../lib/scene-model";

const focusPose: CameraPose = {
  fov: 36,
  position: [0.16, 0.08, 2.2],
  target: [0, 0, 0],
};

describe("traversal choreography", () => {
  it("scales traversal duration by edge distance within bounded timing", () => {
    const shortDuration = traversalDurationMs(0.1);
    const mediumDuration = traversalDurationMs(0.8);
    const longDuration = traversalDurationMs(4);

    expect(shortDuration).toBeGreaterThanOrEqual(MIN_TRAVERSAL_DURATION_MS);
    expect(shortDuration).toBeLessThan(mediumDuration);
    expect(mediumDuration).toBeLessThan(longDuration);
    expect(longDuration).toBe(MAX_TRAVERSAL_DURATION_MS);
  });

  it("lags camera motion behind graph and pulse motion", () => {
    const choreography = createTraversalChoreography([0, 0, 0], [0.7, 0, 0]);
    const sample = sampleTraversalChoreography(
      choreography,
      choreography.durationMs * 0.22,
      focusPose,
    );

    expect(choreography.durationMs).toBeGreaterThanOrEqual(
      MIN_TRAVERSAL_DURATION_MS,
    );
    expect(choreography.durationMs).toBeLessThanOrEqual(
      MAX_TRAVERSAL_DURATION_MS,
    );
    expect(sample.graphProgress).toBeGreaterThan(sample.cameraProgress);
    expect(sample.pulseProgress).toBe(sample.graphProgress);
  });

  it("keeps pulse and camera synchronized across varying edge distances", () => {
    const targets: Array<[number, number, number]> = [
      [0.16, 0, 0],
      [0.72, 0.18, 0],
      [2.2, -0.3, 0.1],
    ];

    for (const target of targets) {
      const choreography = createTraversalChoreography([0, 0, 0], target);
      const early = sampleTraversalChoreography(
        choreography,
        choreography.durationMs * 0.25,
        focusPose,
      );
      const late = sampleTraversalChoreography(
        choreography,
        choreography.durationMs * 0.88,
        focusPose,
      );

      expect(early.graphProgress).toBeGreaterThan(early.cameraProgress);
      expect(early.pulseProgress).toBe(early.graphProgress);
      expect(late.pulseOpacity).toBeLessThan(early.pulseOpacity);
      expect(choreography.durationMs).toBeGreaterThanOrEqual(
        MIN_TRAVERSAL_DURATION_MS,
      );
      expect(choreography.durationMs).toBeLessThanOrEqual(
        MAX_TRAVERSAL_DURATION_MS,
      );
    }
  });

  it("keeps a curved orientation-preserving camera path and fades pulse by arrival", () => {
    const choreography = createTraversalChoreography([0, 0, 0], [0.7, 0.3, 0]);
    const midpoint = sampleTraversalChoreography(
      choreography,
      choreography.durationMs * 0.5,
      focusPose,
    );
    const arrival = sampleTraversalChoreography(
      choreography,
      choreography.durationMs,
      focusPose,
    );

    expect(midpoint.cameraPosition[0]).not.toBeCloseTo(focusPose.position[0]);
    expect(midpoint.cameraPosition[1]).not.toBeCloseTo(focusPose.position[1]);
    expect(midpoint.cameraTarget[2]).toBeCloseTo(0);
    expect(midpoint.pulseOpacity).toBeGreaterThan(0);
    expect(arrival.pulseOpacity).toBeCloseTo(0);
    expect(pulseOpacity(0)).toBeCloseTo(0);
    expect(pulseOpacity(1)).toBeCloseTo(0);
  });

  it("does not accumulate numerical drift after repeated source-target cycles", () => {
    const source: [number, number, number] = [0.11, -0.19, 0.04];
    const target: [number, number, number] = [0.74, 0.28, -0.02];

    for (let cycle = 0; cycle < 25; cycle += 1) {
      const forward = createTraversalChoreography(source, target);
      const forwardArrival = sampleTraversalChoreography(
        forward,
        forward.durationMs + 500,
        focusPose,
      );
      const backward = createTraversalChoreography(target, source);
      const backwardArrival = sampleTraversalChoreography(
        backward,
        backward.durationMs + 500,
        focusPose,
      );

      expect(forwardArrival.pulsePosition).toEqual(target);
      expect(forwardArrival.cameraTarget).toEqual(target);
      expect(backwardArrival.pulsePosition).toEqual(source);
      expect(backwardArrival.cameraTarget).toEqual(source);
      expect(forwardArrival.graphProgress).toBe(1);
      expect(backwardArrival.graphProgress).toBe(1);
    }
  });
});
