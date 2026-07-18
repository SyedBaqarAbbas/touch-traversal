import { describe, expect, it } from "vitest";

import {
  ArtifactValidationError,
  parseArtifactBundle,
} from "../../lib/artifacts/schema";
import {
  buildGraphModel,
  getAvailableLayoutNames,
  selectEdgeSummaries,
  selectLayoutPositions,
  selectNodeSummaries,
  type GraphModel,
} from "../../lib/graph-model";
import {
  loadArtifactModelFromSource,
  resolveArtifactViewState,
  type ArtifactViewState,
} from "../../app/_components/artifact-boundary";
import graph from "../../public/data/graph.json";
import layouts from "../../public/data/layouts.json";
import manifest from "../../public/data/manifest.json";
import report from "../../public/data/pipeline-report.json";

const validBundle = { graph, layouts, manifest, report };
const firstNode = graph.nodes[0];
const firstSemanticPosition = Object.entries(layouts.layouts.semantic).find(
  ([nodeId]) => nodeId === firstNode.id,
)?.[1];

describe("artifact runtime boundary", () => {
  it("validates checked-in artifacts and builds a Graphology model", () => {
    const bundle = parseArtifactBundle(validBundle);
    const model = buildGraphModel(bundle);

    expect(model.graph.order).toBe(graph.nodes.length);
    expect(model.graph.size).toBe(graph.edges.length);
    expect(model.temporal.available).toBe(true);
    expect(getAvailableLayoutNames(model)).toEqual([
      "semantic",
      "clusters",
      "temporal",
      "force",
    ]);
    expect(selectNodeSummaries(model)[0]).toMatchObject({ id: firstNode.id });
    expect(selectNodeSummaries(model)[0]?.degree).toBe(
      graph.edges.filter(
        (edge) => edge.source === firstNode.id || edge.target === firstNode.id,
      ).length,
    );
    expect(selectEdgeSummaries(model)).toHaveLength(graph.edges.length);
    expect(selectLayoutPositions(model, "semantic")[0]?.position).toEqual(
      firstSemanticPosition,
    );
  });

  it("loads an in-memory bundle without requesting fixed public URLs", async () => {
    const fetcher = async () => {
      throw new Error("bundle sources must not fetch");
    };
    const model = await loadArtifactModelFromSource(
      { kind: "bundle", bundle: validBundle },
      fetcher as typeof fetch,
    );

    expect(model.graph.order).toBe(graph.nodes.length);
  });

  it("rejects malformed artifact payloads with useful paths", () => {
    const malformed = structuredClone(validBundle);
    Reflect.deleteProperty(malformed.graph.nodes[0], "id");

    expect(() => parseArtifactBundle(malformed)).toThrow(
      ArtifactValidationError,
    );
    expect(() => parseArtifactBundle(malformed)).toThrow("graph.nodes.0.id");
  });

  it("rejects mismatched graph and layout node sets", () => {
    const mismatched = structuredClone(validBundle);
    Reflect.deleteProperty(mismatched.layouts.layouts.semantic, firstNode.id);

    expect(() => parseArtifactBundle(mismatched)).toThrow(
      "layout node ids must match graph node ids",
    );
  });

  it("resolves loading, error, empty, temporal, and ready view states", () => {
    const model = buildGraphModel(parseArtifactBundle(validBundle));
    const emptyModel = {
      ...model,
      graph: { order: 0 },
    } as GraphModel;
    const temporalModel = {
      ...model,
      temporal: {
        available: false,
        datedNodeCount: 1,
        requiredNodeCount: 2,
        reason: "Temporal topology needs at least 2 dated nodes; found 1.",
      },
    } satisfies GraphModel;

    const loading = resolveArtifactViewState({ status: "loading" });
    expect(loading).toMatchObject({
      kind: "loading",
      recovery: expect.stringContaining("mouse and keyboard"),
      title: "Preparing graph field",
    });
    expect(
      resolveArtifactViewState({ status: "error", message: "bad schema" }).kind,
    ).toBe("error");
    expect(
      resolveArtifactViewState({ status: "ready", model: emptyModel }).kind,
    ).toBe("empty");
    expect(
      resolveArtifactViewState({ status: "ready", model: temporalModel }).kind,
    ).toBe("insufficient-temporal");
    expect(
      (
        resolveArtifactViewState({
          status: "ready",
          model,
        }) as Extract<ArtifactViewState, { kind: "ready" }>
      ).model.graph.order,
    ).toBe(graph.nodes.length);
  });

  it("keeps non-ready transition copy calm and production-ready", () => {
    const model = buildGraphModel(parseArtifactBundle(validBundle));
    const emptyModel = {
      ...model,
      graph: { order: 0 },
    } as GraphModel;
    const states = [
      resolveArtifactViewState({ status: "loading" }),
      resolveArtifactViewState({
        status: "error",
        message: "Graph payload is missing graph.nodes.0.id.",
      }),
      resolveArtifactViewState({ status: "ready", model: emptyModel }),
    ];

    for (const state of states) {
      expect(state.kind).not.toBe("ready");
      if (state.kind === "ready") {
        continue;
      }
      expect(
        `${state.title} ${state.description} ${state.recovery}`,
      ).not.toMatch(/todo|placeholder|lorem|unknown/i);
    }
  });
});
