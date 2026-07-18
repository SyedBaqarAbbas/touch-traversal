"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { GraphScene, type GraphInputMode } from "@/app/_components/graph-scene";
import {
  ArtifactValidationError,
  parseArtifactBundle,
} from "@/lib/artifacts/schema";
import { buildGraphModel, type GraphModel } from "@/lib/graph-model";
import { publicAssetUrl } from "@/lib/public-url";
import { recordingModeEnabled } from "@/lib/recording-mode";
import {
  personalGraphSessions,
  type PersonalGraphSessionSnapshot,
} from "@/lib/personal-graph-session";

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
  graph: publicAssetUrl("/data/graph.json"),
  layouts: publicAssetUrl("/data/layouts.json"),
  manifest: publicAssetUrl("/data/manifest.json"),
  report: publicAssetUrl("/data/pipeline-report.json"),
} as const;

export async function loadArtifactModel(
  fetcher: typeof fetch = fetch,
): Promise<GraphModel> {
  return loadArtifactModelFromSource({ kind: "sample" }, fetcher);
}

export async function loadArtifactModelFromSource(
  source: { kind: "sample" } | { kind: "bundle"; bundle: unknown },
  fetcher: typeof fetch = fetch,
): Promise<GraphModel> {
  if (source.kind === "bundle") {
    return buildGraphModel(parseArtifactBundle(source.bundle));
  }
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

export function ArtifactBoundary({
  performanceMode = false,
}: {
  performanceMode?: boolean;
} = {}) {
  const [state, setState] = useState<ArtifactLoadState>({ status: "loading" });
  const { inputMode, performanceFixture, recordingMode } = useDemoOptions();
  const personalSnapshot = useSyncExternalStore(
    personalGraphSessions.subscribe,
    personalGraphSessions.snapshot,
    getServerPersonalSnapshot,
  );

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

  const selectedState: ArtifactLoadState =
    personalSnapshot.source === "personal" && personalSnapshot.personal
      ? { status: "ready", model: personalSnapshot.personal.model }
      : state;
  const viewState = resolveArtifactViewState(selectedState);
  if (viewState.kind !== "ready") {
    return (
      <>
        <ArtifactSourceControls snapshot={personalSnapshot} />
        <ArtifactStatusScreen state={viewState} />
      </>
    );
  }
  return (
    <>
      {!performanceMode && !recordingMode ? (
        <ArtifactSourceControls snapshot={personalSnapshot} />
      ) : null}
      <GraphScene
        key={`${personalSnapshot.source}-${personalSnapshot.personal?.id ?? "sample"}`}
        inputMode={inputMode}
        model={viewState.model}
        performanceFixture={performanceMode && performanceFixture}
        performanceMode={performanceMode}
        recordingMode={recordingMode}
      />
    </>
  );
}

const serverPersonalSnapshot: PersonalGraphSessionSnapshot = {
  revision: 0,
  source: "sample",
  personal: null,
};

function getServerPersonalSnapshot(): PersonalGraphSessionSnapshot {
  return serverPersonalSnapshot;
}

function ArtifactSourceControls({
  snapshot,
}: {
  snapshot: PersonalGraphSessionSnapshot;
}) {
  const [message, setMessage] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);

  const exportPersonal = () => {
    try {
      const contents = personalGraphSessions.exportActiveSession();
      const url = URL.createObjectURL(
        new Blob([contents], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "touch-traversal-personal-session.json";
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("Private session export prepared on this device.");
    } catch (error) {
      setMessage(formatArtifactError(error));
    }
  };

  const importPersonal = async (file: File | undefined) => {
    if (!file) return;
    try {
      const session = personalGraphSessions.importSession(await file.text());
      setMessage(
        `Imported ${session.metadata.nodeCount} nodes into memory. Source files were not changed.`,
      );
    } catch (error) {
      setMessage(formatArtifactError(error));
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  return (
    <aside className="artifact-source-controls" aria-label="Graph source">
      <div
        className="artifact-source-controls__switch"
        role="group"
        aria-label="Displayed graph"
      >
        <button
          type="button"
          aria-pressed={snapshot.source === "sample"}
          onClick={() => personalGraphSessions.selectSource("sample")}
        >
          sample
        </button>
        <button
          type="button"
          aria-pressed={snapshot.source === "personal"}
          disabled={!snapshot.personal}
          onClick={() => personalGraphSessions.selectSource("personal")}
        >
          personal
        </button>
      </div>
      <button type="button" onClick={() => importInputRef.current?.click()}>
        import private JSON
      </button>
      <input
        ref={importInputRef}
        className="studio-visually-hidden"
        type="file"
        accept="application/json,.json"
        aria-label="Import private graph JSON"
        onChange={(event) =>
          void importPersonal(event.currentTarget.files?.[0])
        }
      />
      {snapshot.personal ? (
        <>
          <button type="button" onClick={exportPersonal}>
            export private JSON
          </button>
          <button
            type="button"
            onClick={() => {
              personalGraphSessions.reset();
              setMessage(
                "Personal graph removed from memory. Original source files were not changed.",
              );
            }}
          >
            remove personal graph
          </button>
        </>
      ) : null}
      <span role="status" aria-live="polite">
        {message}
      </span>
    </aside>
  );
}

function useDemoOptions(): {
  inputMode: GraphInputMode;
  performanceFixture: boolean;
  recordingMode: boolean;
} {
  const search = useSyncExternalStore(
    subscribeToLocationSearch,
    getLocationSearch,
    getServerLocationSearch,
  );
  const input = new URLSearchParams(search).get("input");
  const performanceFixture =
    new URLSearchParams(search).get("fixture") === "camera-free";
  const recordingMode = recordingModeEnabled(search);
  if (input === "mouse") {
    return { inputMode: "mouse", performanceFixture, recordingMode };
  }
  if (input === "gesture-fixture") {
    return {
      inputMode: "gesture-fixture",
      performanceFixture,
      recordingMode,
    };
  }
  return { inputMode: "default", performanceFixture, recordingMode };
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
