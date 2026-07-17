import { describe, expect, it } from "vitest";

import { parseArtifactBundle } from "../../lib/artifacts/schema";
import { buildGraphModel } from "../../lib/graph-model";
import {
  buildSceneNodes,
  cameraModes,
  getCameraPose,
} from "../../lib/scene-model";
import graph from "../../public/data/graph.json";
import layouts from "../../public/data/layouts.json";
import manifest from "../../public/data/manifest.json";
import report from "../../public/data/pipeline-report.json";

const model = buildGraphModel(
  parseArtifactBundle({ graph, layouts, manifest, report }),
);

describe("scene model", () => {
  it("defines explicit camera modes with stable poses", () => {
    expect(cameraModes).toEqual(["overview", "focus", "inspect"]);
    for (const mode of cameraModes) {
      const pose = getCameraPose(mode);
      expect(pose.position).toHaveLength(3);
      expect(pose.target).toHaveLength(3);
      expect(pose.fov).toBeGreaterThan(20);
      expect(pose.fov).toBeLessThan(55);
    }
  });

  it("projects graph nodes into per-instance scene values", () => {
    const nodes = buildSceneNodes(model, "semantic", {
      hoverNodeId: "thought-distributed-notes",
      selectedNodeId: "thought-grounded-language",
      hiddenNodeIds: new Set(["thought-debug-evidence"]),
    });

    expect(nodes).toHaveLength(graph.nodes.length);
    expect(nodes[0]).toMatchObject({
      id: "thought-grounded-language",
      position: [-0.78, -0.18, 0.12],
      selected: 1,
      visible: 1,
    });
    expect(
      nodes.find((node) => node.id === "thought-distributed-notes"),
    ).toMatchObject({
      hovered: 1,
    });
    expect(
      nodes.find((node) => node.id === "thought-debug-evidence"),
    ).toMatchObject({
      visible: 0,
    });
    expect(nodes.every((node) => node.scale > 0 && node.opacity > 0)).toBe(
      true,
    );
  });
});
