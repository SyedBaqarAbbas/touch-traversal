"use client";

import { useEffect, useState } from "react";

import { GraphScene } from "@/app/_components/graph-scene";
import {
  ArtifactValidationError,
  parseArtifactBundle,
} from "@/lib/artifacts/schema";
import { buildGraphModel, type GraphModel } from "@/lib/graph-model";

type ArtifactLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; model: GraphModel };

export type ArtifactViewState =
  | { kind: "loading"; title: string; description: string }
  | { kind: "error"; title: string; description: string }
  | { kind: "empty"; title: string; description: string }
  | { kind: "insufficient-temporal"; title: string; description: string }
  | { kind: "ready"; model: GraphModel };

const artifactPaths = {
  graph: "/data/graph.json",
  layouts: "/data/layouts.json",
  manifest: "/data/manifest.json",
  report: "/data/pipeline-report.json",
} as const;

export async function loadArtifactModel(
  fetcher: typeof fetch = fetch,
): Promise<GraphModel> {
  const [graph, layouts, manifest, report] = await Promise.all([
    fetchJson(fetcher, artifactPaths.graph),
    fetchJson(fetcher, artifactPaths.layouts),
    fetchJson(fetcher, artifactPaths.manifest),
    fetchJson(fetcher, artifactPaths.report),
  ]);
  return buildGraphModel(
    parseArtifactBundle({ graph, layouts, manifest, report }),
  );
}

export function resolveArtifactViewState(
  state: ArtifactLoadState,
): ArtifactViewState {
  if (state.status === "loading") {
    return {
      kind: "loading",
      title: "Loading graph artifacts",
      description: "Reading the static pipeline bundle from /data.",
    };
  }
  if (state.status === "error") {
    return {
      kind: "error",
      title: "Graph artifacts failed validation",
      description: state.message,
    };
  }
  if (state.model.graph.order === 0) {
    return {
      kind: "empty",
      title: "No graph data",
      description:
        "The artifact bundle is valid, but it does not contain nodes yet.",
    };
  }
  if (!state.model.temporal.available) {
    return {
      kind: "insufficient-temporal",
      title: "Temporal data unavailable",
      description:
        state.model.temporal.reason ??
        "Temporal topology needs more dated nodes before it can be shown.",
    };
  }
  return { kind: "ready", model: state.model };
}

export function ArtifactBoundary() {
  const [state, setState] = useState<ArtifactLoadState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    loadArtifactModel()
      .then((model) => {
        if (active) {
          setState({ status: "ready", model });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({ status: "error", message: formatArtifactError(error) });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const viewState = resolveArtifactViewState(state);
  if (viewState.kind !== "ready") {
    return <ArtifactStatusScreen state={viewState} />;
  }
  return <GraphScene model={viewState.model} />;
}

function ArtifactStatusScreen({
  state,
}: {
  state: Exclude<ArtifactViewState, { kind: "ready" }>;
}) {
  const role = state.kind === "error" ? "alert" : "status";
  return (
    <main className="artifact-status-screen" role={role}>
      <section aria-labelledby="artifact-status-title">
        <p className="eyebrow">{state.kind}</p>
        <h1 id="artifact-status-title">{state.title}</h1>
        <p className="description">{state.description}</p>
      </section>
    </main>
  );
}

async function fetchJson(
  fetcher: typeof fetch,
  path: string,
): Promise<unknown> {
  const response = await fetcher(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load ${path}: HTTP ${response.status}`);
  }
  return response.json();
}

function formatArtifactError(error: unknown): string {
  if (error instanceof ArtifactValidationError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown artifact loading error.";
}
