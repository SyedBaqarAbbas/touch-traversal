"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  ArtifactValidationError,
  parseArtifactBundle,
} from "@/lib/artifacts/schema";
import {
  buildGraphModel,
  getAvailableLayoutNames,
  selectEdgeSummaries,
  selectLayoutPositions,
  selectNodeSummaries,
  type GraphModel,
} from "@/lib/graph-model";

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

const routes = [
  { href: "/", label: "home" },
  { href: "/demo", label: "demo" },
  { href: "/calibration", label: "calibration" },
  { href: "/debug", label: "debug" },
] as const;

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
  return <ArtifactSummary model={viewState.model} />;
}

function ArtifactSummary({ model }: { model: GraphModel }) {
  const nodeSummaries = useMemo(() => selectNodeSummaries(model), [model]);
  const edgeSummaries = useMemo(() => selectEdgeSummaries(model), [model]);
  const semanticPositions = useMemo(
    () => selectLayoutPositions(model, "semantic"),
    [model],
  );
  const availableLayouts = getAvailableLayoutNames(model);

  return (
    <main className="artifact-shell">
      <header className="artifact-header">
        <Link className="wordmark" href="/">
          touch traversal
        </Link>
        <p className="mode-label">artifact boundary / validated</p>
      </header>

      <section className="artifact-hero" aria-labelledby="artifact-title">
        <p className="eyebrow">demo</p>
        <h1 id="artifact-title">Graph artifact boundary</h1>
        <p className="description">
          {model.manifest.corpusName} loaded through Zod and Graphology with{" "}
          {availableLayouts.length} validated layouts.
        </p>
      </section>

      <section className="artifact-grid" aria-label="Graph summary">
        <article>
          <span>nodes</span>
          <strong>{model.graph.order}</strong>
        </article>
        <article>
          <span>edges</span>
          <strong>{model.graph.size}</strong>
        </article>
        <article>
          <span>average degree</span>
          <strong>{model.report.averageDegree.toFixed(2)}</strong>
        </article>
        <article>
          <span>dated nodes</span>
          <strong>{model.temporal.datedNodeCount}</strong>
        </article>
      </section>

      <section className="artifact-panels" aria-label="Graph model details">
        <article className="artifact-panel">
          <h2>Node selectors</h2>
          <ol className="artifact-list">
            {nodeSummaries.slice(0, 5).map((node) => (
              <li key={node.id}>
                <span>{node.title}</span>
                <small>
                  {node.clusterId} / degree {node.degree}
                </small>
              </li>
            ))}
          </ol>
        </article>

        <article className="artifact-panel">
          <h2>Edge selectors</h2>
          <ol className="artifact-list">
            {edgeSummaries.slice(0, 5).map((edge) => (
              <li key={edge.id}>
                <span>{edge.type}</span>
                <small>
                  {edge.source} {"->"} {edge.target}
                </small>
              </li>
            ))}
          </ol>
        </article>

        <article className="artifact-panel artifact-panel--wide">
          <h2>Semantic positions</h2>
          <pre>
            {JSON.stringify(
              semanticPositions.map((node) => ({
                id: node.id,
                position: node.position,
              })),
              null,
              2,
            )}
          </pre>
        </article>
      </section>

      <nav className="route-shell__nav" aria-label="Prototype routes">
        {routes.map((route) => (
          <Link href={route.href} key={route.href}>
            {route.label}
          </Link>
        ))}
      </nav>
    </main>
  );
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
