import { describe, expect, it } from "vitest";

import { parseArtifactBundle } from "../../lib/artifacts/schema";
import { buildGraphModel, selectEdgeSummaries } from "../../lib/graph-model";
import {
  createLayoutRegistry,
  readLayoutPosition,
} from "../../lib/layout-registry";
import {
  buildEdgeEndpointsFromRegistry,
  createIdleLayoutMorph,
  DEFAULT_LAYOUT_MORPH_DURATION_MS,
  easeInOutCubic,
  edgeEndpointBufferFromRegistry,
  startLayoutMorph,
  updateLayoutMorph,
} from "../../lib/layout-morph";
import graph from "../../public/data/graph.json";
import layouts from "../../public/data/layouts.json";
import manifest from "../../public/data/manifest.json";
import report from "../../public/data/pipeline-report.json";

const buildModel = () =>
  buildGraphModel(parseArtifactBundle({ graph, layouts, manifest, report }));

describe("layout morph controller", () => {
  it("uses a default duration inside the planned full-layout range", () => {
    expect(DEFAULT_LAYOUT_MORPH_DURATION_MS).toBeGreaterThanOrEqual(1800);
    expect(DEFAULT_LAYOUT_MORPH_DURATION_MS).toBeLessThanOrEqual(2600);
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(1)).toBe(1);
  });

  it("starts from current positions and finishes exactly at target values", () => {
    const registry = createLayoutRegistry(buildModel());
    let morph = createIdleLayoutMorph(registry);

    morph = startLayoutMorph(registry, "clusters", 1000);
    const semanticStart = [...registry.layouts.semantic.slice(0, 3)];
    expect([...registry.startPositions.slice(0, 3)]).toEqual(semanticStart);

    morph = updateLayoutMorph(registry, morph, 2100);
    const halfway = readLayoutPosition(registry, "thought-grounded-language");
    const clusterTarget = [...registry.layouts.clusters.slice(0, 3)];
    expect(halfway).not.toEqual(semanticStart);
    halfway.forEach((value, axis) => {
      expect(value).toBeGreaterThanOrEqual(
        Math.min(semanticStart[axis]!, clusterTarget[axis]!),
      );
      expect(value).toBeLessThanOrEqual(
        Math.max(semanticStart[axis]!, clusterTarget[axis]!),
      );
    });
    expect(morph.mode).toBe("morphing");

    morph = updateLayoutMorph(registry, morph, 3200);
    expect(morph).toMatchObject({
      mode: "idle",
      activeLayoutName: "clusters",
      targetLayoutName: "clusters",
    });
    expect([...registry.currentPositions.slice(0, 3)]).toEqual([
      ...registry.layouts.clusters.slice(0, 3),
    ]);
  });

  it("keeps edge endpoints synchronized with current registry positions", () => {
    const model = buildModel();
    const registry = createLayoutRegistry(model);
    const edge = selectEdgeSummaries(model)[0];
    if (!edge) {
      throw new Error("expected fixture edge");
    }

    let morph = startLayoutMorph(registry, "force", 0);
    morph = updateLayoutMorph(registry, morph, 1100);

    const [endpoint] = buildEdgeEndpointsFromRegistry(registry, [edge]);
    if (!endpoint) {
      throw new Error("expected endpoint");
    }
    expect(endpoint.sourcePosition).toEqual(
      readLayoutPosition(registry, edge.source),
    );
    expect(endpoint.targetPosition).toEqual(
      readLayoutPosition(registry, edge.target),
    );

    const endpointBuffer = edgeEndpointBufferFromRegistry(registry, [edge]);
    expect([...endpointBuffer.slice(0, 3)]).toEqual(endpoint.sourcePosition);
    expect([...endpointBuffer.slice(3, 6)]).toEqual(endpoint.targetPosition);
    expect(morph.mode).toBe("morphing");
  });
});
