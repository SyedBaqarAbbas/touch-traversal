"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { GraphScene, type GraphInputMode } from "@/app/_components/graph-scene";
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
  | {
      description: string;
      kind: "loading";
      recovery: string;
      title: string;
    }
  | {
      description: string;
      kind: "error";
      recovery: string;
      title: string;
    }
  | {
      description: string;
      kind: "empty";
      recovery: string;
      title: string;
    }
  | {
      description: string;
      kind: "insufficient-temporal";
      recovery: string;
      title: string;
    }
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
      title: "Preparing graph field",
      description:
        "Loading the static graph bundle into a quiet scene before the constellation appears.",
      recovery:
        "Hand tracking stays optional; mouse and keyboard are ready first.",
    };
  }
  if (state.status === "error") {
    return {
      kind: "error",
      title: "Graph artifacts could not load",
      description: state.message,
      recovery:
        "Check the exported graph bundle, then reload the demo. Camera access is not required.",
    };
  }
  if (state.model.graph.order === 0) {
    return {
      kind: "empty",
      title: "No notes to draw",
      description:
        "The graph bundle loaded, but it does not contain thought nodes yet.",
      recovery:
        "Add notes, rebuild the artifacts, and the demo will open here.",
    };
  }
  if (!state.model.temporal.available) {
    return {
      kind: "insufficient-temporal",
      title: "Temporal topology unavailable",
      description:
        state.model.temporal.reason ??
        "Temporal topology needs more dated nodes before it can be shown.",
      recovery:
        "Add dated notes or use semantic, community, and force layouts after rebuilding.",
    };
  }
  return { kind: "ready", model: state.model };
}

export function ArtifactBoundary() {
  const [state, setState] = useState<ArtifactLoadState>({ status: "loading" });
  const inputMode = useInputMode();

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
  return <GraphScene inputMode={inputMode} model={viewState.model} />;
}

function useInputMode(): GraphInputMode {
  const search = useSyncExternalStore(
    subscribeToLocationSearch,
    getLocationSearch,
    getServerLocationSearch,
  );
  const input = new URLSearchParams(search).get("input");
  if (input === "mouse") {
    return "mouse";
  }
  if (input === "gesture-fixture") {
    return "gesture-fixture";
  }
  return "default";
}

function subscribeToLocationSearch(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

function getLocationSearch() {
  return window.location.search;
}

function getServerLocationSearch() {
  return "";
}

function ArtifactStatusScreen({
  state,
}: {
  state: Exclude<ArtifactViewState, { kind: "ready" }>;
}) {
  const role = state.kind === "error" ? "alert" : "status";
  return (
    <main
      className={`artifact-status-screen artifact-status-screen--${state.kind}`}
      data-state={state.kind}
      role={role}
    >
      <section aria-labelledby="artifact-status-title">
        <p className="eyebrow">{state.kind}</p>
        <h1 id="artifact-status-title">{state.title}</h1>
        <p className="description">{state.description}</p>
        <p className="artifact-status-screen__recovery">{state.recovery}</p>
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
  return "Artifact loading stopped before returning a readable error.";
}
