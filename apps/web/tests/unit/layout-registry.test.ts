import { describe, expect, it } from "vitest";

import { parseArtifactBundle } from "../../lib/artifacts/schema";
import { buildGraphModel } from "../../lib/graph-model";
import {
  createLayoutRegistry,
  LayoutRegistryError,
  readLayoutPosition,
  startLayoutTransition,
  updateLayoutProgress,
} from "../../lib/layout-registry";
import graph from "../../public/data/graph.json";
import layouts from "../../public/data/layouts.json";
import manifest from "../../public/data/manifest.json";
import report from "../../public/data/pipeline-report.json";

const buildModel = () =>
  buildGraphModel(parseArtifactBundle({ graph, layouts, manifest, report }));
const firstNodeId = graph.nodes[0].id;

describe("layout registry", () => {
  it("registers every persistent topology into index-stable buffers", () => {
    const model = buildModel();
    const registry = createLayoutRegistry(model);

    expect(registry.layoutNames).toEqual([
      "semantic",
      "clusters",
      "temporal",
      "force",
    ]);
    expect(registry.nodeIds).toEqual(graph.nodes.map((node) => node.id));
    expect(registry.currentPositions).toBeInstanceOf(Float32Array);
    expect(registry.startPositions).toBeInstanceOf(Float32Array);
    expect(registry.targetPositions).toBeInstanceOf(Float32Array);
    expect(registry.layouts.semantic).toHaveLength(graph.nodes.length * 3);
    expect(registry.indexByNodeId.get(firstNodeId)).toBe(0);
  });

  it("starts transitions from current positions and interpolates target buffers", () => {
    const registry = createLayoutRegistry(buildModel());
    const originalSemantic = readLayoutPosition(registry, firstNodeId);

    startLayoutTransition(registry, "clusters");
    expect([...registry.startPositions.slice(0, 3)]).toEqual([
      ...registry.currentPositions.slice(0, 3),
    ]);
    updateLayoutProgress(registry, 0.5);
    const halfway = readLayoutPosition(registry, firstNodeId);
    updateLayoutProgress(registry, 1);
    const final = readLayoutPosition(registry, firstNodeId);

    expect(halfway).not.toEqual(originalSemantic);
    expect(final).toEqual([...registry.layouts.clusters.slice(0, 3)]);
    expect(registry.activeLayoutName).toBe("clusters");
  });

  it("throws clear errors for incompatible layouts and unknown nodes", () => {
    const model = buildModel();
    Reflect.deleteProperty(
      model.graph.getNodeAttributes(firstNodeId).layouts,
      "force",
    );

    expect(() => createLayoutRegistry(model)).toThrow(LayoutRegistryError);
    expect(() => createLayoutRegistry(model)).toThrow(
      `Layout "force" is missing node "${firstNodeId}"`,
    );

    const registry = createLayoutRegistry(buildModel());
    expect(() => readLayoutPosition(registry, "missing-node")).toThrow(
      "Unknown node id: missing-node",
    );
  });
});
