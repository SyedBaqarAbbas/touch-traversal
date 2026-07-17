import { describe, expect, it } from "vitest";

import { parseArtifactBundle } from "../../lib/artifacts/schema";
import { buildGraphModel } from "../../lib/graph-model";
import {
  buildSceneEdges,
  buildFocusSceneNodes,
  buildSceneNodes,
  buildSceneThoughtLabels,
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

  it("projects relationship edges with selected-neighborhood emphasis", () => {
    const edges = buildSceneEdges(model, "semantic", {
      selectedNodeId: "thought-grounded-language",
    });
    const selected = edges.filter((edge) => edge.selected === 1);
    const unrelated = edges.filter((edge) => edge.selected === 0);

    expect(edges).toHaveLength(graph.edges.length);
    expect(selected.length).toBeGreaterThan(0);
    expect(unrelated.length).toBeGreaterThan(0);
    expect(
      Math.min(...selected.map((edge) => edge.opacity)),
    ).toBeGreaterThanOrEqual(0.55);
    expect(
      Math.max(...unrelated.map((edge) => edge.opacity)),
    ).toBeLessThanOrEqual(0.04);
    expect(new Set(edges.map((edge) => edge.width)).size).toBeGreaterThan(1);
    expect(edges.every((edge) => edge.visible === 1)).toBe(true);
  });

  it("creates a selected-node focus topology with ranked inner neighbors", () => {
    const nodes = buildFocusSceneNodes(
      model,
      "semantic",
      "thought-grounded-language",
    );
    const selected = nodes.find(
      (node) => node.id === "thought-grounded-language",
    );
    const depthOne = nodes.filter((node) => node.focusDepth === 1);
    const pushed = nodes.filter((node) => node.focusDepth > 1);

    expect(selected?.position).toEqual([0, 0, 0]);
    expect(selected?.selected).toBe(1);
    expect(depthOne.map((node) => node.id)).toEqual([
      "thought-distributed-notes",
      "thought-debug-evidence",
    ]);
    expect(pushed.every((node) => node.opacity <= 0.42)).toBe(true);
  });

  it("builds sparse hover, selected, and neighbor labels", () => {
    const overviewLabels = buildSceneThoughtLabels(
      model,
      buildSceneNodes(model, "semantic"),
      {
        hoverNodeId: "thought-distributed-notes",
      },
    );

    expect(overviewLabels).toEqual([
      expect.objectContaining({
        nodeId: "thought-distributed-notes",
        kind: "hover",
        title: "Distributed note topology",
        excerpt: null,
      }),
    ]);

    const focusLabels = buildSceneThoughtLabels(
      model,
      buildFocusSceneNodes(model, "semantic", "thought-grounded-language"),
      {
        hoverNodeId: "thought-distributed-notes",
        selectedNodeId: "thought-grounded-language",
      },
    );

    expect(focusLabels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "thought-grounded-language",
          kind: "selected",
          excerpt:
            "Language invention starts from grounded perception and action.",
        }),
        expect.objectContaining({
          nodeId: "thought-debug-evidence",
          kind: "neighbor",
          excerpt: null,
          opacity: 0.34,
        }),
        expect.objectContaining({
          nodeId: "thought-distributed-notes",
          kind: "hover",
          excerpt: null,
        }),
      ]),
    );
  });
});
