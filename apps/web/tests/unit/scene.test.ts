import { describe, expect, it } from "vitest";

import {
  type EdgeType,
  parseArtifactBundle,
  type Vec3,
} from "../../lib/artifacts/schema";
import { buildGraphModel } from "../../lib/graph-model";
import {
  DEFAULT_MAX_ACTIVE_FOCUS_TARGETS,
  buildSceneEdges,
  buildFocusSceneNodes,
  buildSceneNodes,
  buildSceneThoughtLabels,
  cameraModes,
  getCameraPose,
  rankTraversableNeighbors,
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
    expect(depthOne.map((node) => node.focusRing)).toEqual(["inner", "outer"]);
    expect(depthOne.every((node) => node.selectable === 1)).toBe(true);
    expect(depthOne.every((node) => node.hitRadius > node.scale * 3.4)).toBe(
      true,
    );
    expect(pushed.every((node) => node.opacity <= 0.42)).toBe(true);
  });

  it("ranks focus neighbors, caps active targets, and retains weak context", () => {
    const rankingModel = buildRankingFixtureModel();
    const ranked = rankTraversableNeighbors(rankingModel, "thought-center");
    const active = ranked.filter((neighbor) => neighbor.selectable);
    const focusedNodes = buildFocusSceneNodes(
      rankingModel,
      "semantic",
      "thought-center",
    );
    const activeNodes = focusedNodes.filter((node) => node.focusDepth === 1);
    const weakNode = focusedNodes.find(
      (node) => node.id === "thought-neighbor-weak",
    );
    const contextualEdge = buildSceneEdges(rankingModel, "semantic", {
      selectedNodeId: "thought-center",
    }).find((edge) => edge.id === "edge-center-weak");

    expect(ranked).toHaveLength(12);
    expect(ranked[0]).toMatchObject({
      edgeType: "manual",
      nodeId: "thought-neighbor-manual",
      selectable: true,
    });
    expect(active).toHaveLength(DEFAULT_MAX_ACTIVE_FOCUS_TARGETS);
    expect(activeNodes).toHaveLength(DEFAULT_MAX_ACTIVE_FOCUS_TARGETS);
    expect(activeNodes.some((node) => node.focusRing === "inner")).toBe(true);
    expect(activeNodes.some((node) => node.focusRing === "outer")).toBe(true);
    expect(
      new Set(activeNodes.map((node) => node.relationSector)).size,
    ).toBeGreaterThan(1);
    expect(activeNodes.every((node) => node.hitRadius > node.scale * 3.4)).toBe(
      true,
    );
    expect(weakNode).toMatchObject({
      focusRing: "context",
      selectable: 0,
      visible: 1,
      hitRadius: 0,
    });
    expect(weakNode?.opacity).toBeLessThanOrEqual(0.26);
    expect(contextualEdge).toMatchObject({
      selected: 0,
      visible: 1,
    });
    expect(contextualEdge?.opacity).toBeGreaterThanOrEqual(0.1);
    expect(contextualEdge?.opacity).toBeLessThanOrEqual(0.28);
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

type RankingEdgeInput = {
  target: string;
  type: EdgeType;
  weight: number;
  confidence: number;
  sharedTerms?: string[];
  sharedEntities?: string[];
  similarity?: number;
};

function buildRankingFixtureModel() {
  const edgeInputs: RankingEdgeInput[] = [
    {
      confidence: 0.92,
      sharedEntities: ["operator", "choice"],
      sharedTerms: ["manual", "curation"],
      target: "thought-neighbor-manual",
      type: "manual",
      weight: 0.86,
    },
    {
      confidence: 0.96,
      sharedEntities: ["link"],
      sharedTerms: ["explicit", "edge"],
      target: "thought-neighbor-explicit-a",
      type: "explicit",
      weight: 0.84,
    },
    {
      confidence: 0.9,
      sharedTerms: ["semantic", "graph"],
      similarity: 0.88,
      target: "thought-neighbor-semantic-a",
      type: "semantic",
      weight: 0.83,
    },
    {
      confidence: 0.88,
      sharedEntities: ["entity"],
      sharedTerms: ["entity", "overlap"],
      target: "thought-neighbor-entity",
      type: "entity",
      weight: 0.8,
    },
    {
      confidence: 0.86,
      sharedTerms: ["timeline"],
      target: "thought-neighbor-temporal",
      type: "temporal",
      weight: 0.79,
    },
    {
      confidence: 0.82,
      sharedTerms: ["semantic", "choice"],
      similarity: 0.78,
      target: "thought-neighbor-semantic-b",
      type: "semantic",
      weight: 0.76,
    },
    {
      confidence: 0.8,
      sharedTerms: ["explicit"],
      target: "thought-neighbor-explicit-b",
      type: "explicit",
      weight: 0.72,
    },
    {
      confidence: 0.78,
      sharedTerms: ["structure"],
      target: "thought-neighbor-structural-a",
      type: "structural",
      weight: 0.7,
    },
    {
      confidence: 0.76,
      sharedTerms: ["manual"],
      target: "thought-neighbor-manual-b",
      type: "manual",
      weight: 0.66,
    },
    {
      confidence: 0.74,
      sharedTerms: ["semantic"],
      target: "thought-neighbor-semantic-c",
      type: "semantic",
      weight: 0.64,
    },
    {
      confidence: 0.72,
      sharedTerms: ["structure"],
      target: "thought-neighbor-structural-b",
      type: "structural",
      weight: 0.62,
    },
    {
      confidence: 0.18,
      target: "thought-neighbor-weak",
      type: "structural",
      weight: 0.12,
    },
  ];
  const nodeIds = ["thought-center", ...edgeInputs.map((edge) => edge.target)];
  const positions = Object.fromEntries(
    nodeIds.map((nodeId, index) => [nodeId, fixturePosition(index)]),
  );
  const edgeCounts = edgeInputs.reduce<Record<string, number>>(
    (counts, edge) => ({
      ...counts,
      [edge.type]: (counts[edge.type] ?? 0) + 1,
    }),
    {},
  );

  return buildGraphModel(
    parseArtifactBundle({
      graph: {
        edges: edgeInputs.map((edge) => ({
          confidence: edge.confidence,
          directed: false,
          evidence: {
            description: `Fixture evidence for ${edge.target}.`,
            sharedEntities: edge.sharedEntities ?? [],
            sharedTerms: edge.sharedTerms ?? [],
            similarity: edge.similarity,
          },
          id: `edge-center-${edge.target.replace("thought-neighbor-", "")}`,
          source: "thought-center",
          target: edge.target,
          type: edge.type,
          visual: {
            opacity: 0.5,
            width: 1,
          },
          weight: edge.weight,
        })),
        nodes: nodeIds.map((nodeId, index) => ({
          id: nodeId,
          metadata: {
            createdAt: "2026-07-10T09:00:00+00:00",
            entities: [],
            importance: index === 0 ? 1 : 0.5,
            modifiedAt: "2026-07-10T09:00:00+00:00",
            tags: [],
            wordCount: 8,
          },
          source: {
            documentId: nodeId,
            endLine: 2,
            headingPath: ["Fixture"],
            path: `notes/${nodeId}.md`,
            startLine: 1,
          },
          summary: `Summary for ${nodeId}.`,
          text: `Text for ${nodeId}.`,
          title: nodeId.replaceAll("-", " "),
          visual: {
            baseOpacity: 0.82,
            clusterId: index < 5 ? "cluster-a" : "cluster-b",
            size: index === 0 ? 1.5 : 1.1,
          },
        })),
        schemaVersion: 1,
      },
      layouts: {
        bounds: {
          max: [1, 1, 1],
          min: [-1, -1, -1],
        },
        layouts: {
          clusters: positions,
          force: positions,
          semantic: positions,
          temporal: positions,
        },
        version: 1,
      },
      manifest: {
        corpusName: "ranking fixture",
        edgeCount: edgeInputs.length,
        embeddingModel: "fixture",
        generatedAt: "2026-07-10T09:00:00+00:00",
        nodeCount: nodeIds.length,
        pipelineConfigHash: "fixture",
        schemaVersion: 1,
      },
      report: {
        averageDegree: (edgeInputs.length * 2) / nodeIds.length,
        buildDurationMs: 1,
        chunkCount: nodeIds.length,
        clusterCount: 2,
        edgeCount: edgeInputs.length,
        edgeCounts,
        fileCount: nodeIds.length,
        generatedAt: "2026-07-10T09:00:00+00:00",
        isolatedNodeCount: 0,
        nodeCount: nodeIds.length,
        schemaVersion: 1,
        similarityDistribution: {
          count: 1,
          maximum: 0.9,
          median: 0.7,
          minimum: 0.2,
          p95: 0.88,
        },
        warnings: [],
      },
    }),
  );
}

function fixturePosition(index: number): Vec3 {
  if (index === 0) {
    return [0, 0, 0];
  }
  const angle = (index / 12) * Math.PI * 2;
  return [Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 0];
}
