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
  resolveArtifactViewState,
  type ArtifactViewState,
} from "../../app/_components/artifact-boundary";
import graph from "../../public/data/graph.json";
import layouts from "../../public/data/layouts.json";
import manifest from "../../public/data/manifest.json";
import report from "../../public/data/pipeline-report.json";

const validBundle = { graph, layouts, manifest, report };

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
    expect(selectNodeSummaries(model)[0]).toMatchObject({
      id: "thought-grounded-language",
      degree: 2,
    });
    expect(selectEdgeSummaries(model)).toHaveLength(graph.edges.length);
    expect(selectLayoutPositions(model, "semantic")[0]?.position).toEqual([
      -0.78, -0.18, 0.12,
    ]);
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
    Reflect.deleteProperty(
      mismatched.layouts.layouts.semantic,
      "thought-debug-evidence",
    );

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

    expect(resolveArtifactViewState({ status: "loading" }).kind).toBe(
      "loading",
    );
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
});
