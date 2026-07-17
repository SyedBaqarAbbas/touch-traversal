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
});
