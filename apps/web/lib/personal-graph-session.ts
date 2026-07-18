import {
  parseArtifactBundle,
  type ArtifactBundle,
} from "@/lib/artifacts/schema";
import { buildGraphModel, type GraphModel } from "@/lib/graph-model";

export const personalGraphSessionVersion = 1 as const;
export const maximumPersonalGraphImportBytes = 32 * 1024 * 1024;

export type PersonalGraphSessionMetadata = {
  sessionVersion: typeof personalGraphSessionVersion;
  id: string;
  origin: "generated" | "imported";
  createdAt: string;
  noteCount: number;
  nodeCount: number;
  edgeCount: number;
  corpusName: string;
};

export type PersonalGraphSession = {
  id: string;
  metadata: PersonalGraphSessionMetadata;
  bundle: ArtifactBundle;
  model: GraphModel;
};

export type PersonalGraphSource = "sample" | "personal";

export type PersonalGraphSessionSnapshot = {
  revision: number;
  source: PersonalGraphSource;
  personal: PersonalGraphSession | null;
};

export type PersonalGraphActivationOptions = {
  origin?: PersonalGraphSessionMetadata["origin"];
  createdAt?: string;
  noteCount?: number;
};

export interface PersonalGraphSessionStore {
  activate(
    sessionId: string,
    input: unknown,
    options?: PersonalGraphActivationOptions,
  ): PersonalGraphSession;
  current(): PersonalGraphSession | null;
  snapshot(): PersonalGraphSessionSnapshot;
  subscribe(listener: () => void): () => void;
  selectSource(source: PersonalGraphSource): void;
  exportActiveBundle(): string;
  exportActiveSession(): string;
  importSession(input: string): PersonalGraphSession;
  reset(): void;
}

export class PersonalGraphSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonalGraphSessionError";
  }
}

export function loadPersonalBundleForScene(input: unknown): {
  bundle: ArtifactBundle;
  model: GraphModel;
} {
  const bundle = parseArtifactBundle(input);
  const model = buildGraphModel(bundle);
  if (model.graph.order === 0) {
    throw new PersonalGraphSessionError(
      "The personal bundle contains no graph nodes, so the current graph was kept.",
    );
  }
  return { bundle, model };
}

export function createMemoryPersonalGraphSessionStore(): PersonalGraphSessionStore {
  let active: PersonalGraphSession | null = null;
  let revision = 0;
  let source: PersonalGraphSource = "sample";
  let currentSnapshot: PersonalGraphSessionSnapshot = {
    revision,
    source,
    personal: active,
  };
  const listeners = new Set<() => void>();

  const publish = () => {
    revision += 1;
    currentSnapshot = { revision, source, personal: active };
    for (const listener of listeners) listener();
  };

  const activate = (
    sessionId: string,
    input: unknown,
    options: PersonalGraphActivationOptions = {},
  ): PersonalGraphSession => {
    if (!sessionId.trim()) {
      throw new PersonalGraphSessionError(
        "Personal graph session id must not be blank.",
      );
    }
    const loaded = loadPersonalBundleForScene(input);
    const createdAt = options.createdAt ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(createdAt))) {
      throw new PersonalGraphSessionError(
        "Personal graph session createdAt must be an ISO timestamp.",
      );
    }
    const noteCount = options.noteCount ?? loaded.bundle.report.fileCount;
    if (!Number.isInteger(noteCount) || noteCount < 0) {
      throw new PersonalGraphSessionError(
        "Personal graph session noteCount must be a non-negative integer.",
      );
    }
    const next: PersonalGraphSession = {
      id: sessionId,
      metadata: {
        sessionVersion: personalGraphSessionVersion,
        id: sessionId,
        origin: options.origin ?? "generated",
        createdAt,
        noteCount,
        nodeCount: loaded.bundle.graph.nodes.length,
        edgeCount: loaded.bundle.graph.edges.length,
        corpusName: loaded.bundle.manifest.corpusName,
      },
      ...loaded,
    };
    active = next;
    source = "personal";
    publish();
    return next;
  };

  return {
    activate,
    current() {
      return active;
    },
    snapshot() {
      return currentSnapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    selectSource(nextSource) {
      if (nextSource === "personal" && !active) {
        throw new PersonalGraphSessionError(
          "Build or import a personal graph before selecting it.",
        );
      }
      if (nextSource === source) return;
      source = nextSource;
      publish();
    },
    exportActiveBundle() {
      if (!active) {
        throw new PersonalGraphSessionError(
          "No personal graph session is active.",
        );
      }
      return `${JSON.stringify(active.bundle, null, 2)}\n`;
    },
    exportActiveSession() {
      if (!active) {
        throw new PersonalGraphSessionError(
          "No personal graph session is active.",
        );
      }
      return `${JSON.stringify(
        {
          sessionVersion: personalGraphSessionVersion,
          metadata: active.metadata,
          bundle: active.bundle,
        },
        null,
        2,
      )}\n`;
    },
    importSession(input) {
      if (input.length > maximumPersonalGraphImportBytes) {
        throw new PersonalGraphSessionError(
          "The selected personal graph file exceeds the 32 MiB private import limit.",
        );
      }
      let value: unknown;
      try {
        value = JSON.parse(input);
      } catch {
        throw new PersonalGraphSessionError(
          "The selected personal graph file is not valid JSON.",
        );
      }
      if (!isImportEnvelope(value)) {
        throw new PersonalGraphSessionError(
          "The selected file is not a compatible version 1 personal graph session.",
        );
      }
      return activate(value.metadata.id, value.bundle, {
        origin: "imported",
        createdAt: value.metadata.createdAt,
        noteCount: value.metadata.noteCount,
      });
    },
    reset() {
      active = null;
      source = "sample";
      publish();
    },
  };
}

export const personalGraphSessions = createMemoryPersonalGraphSessionStore();

function isImportEnvelope(value: unknown): value is {
  sessionVersion: 1;
  metadata: { id: string; createdAt: string; noteCount: number };
  bundle: unknown;
} {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Record<string, unknown>;
  if (envelope.sessionVersion !== personalGraphSessionVersion) return false;
  const metadata = envelope.metadata;
  return (
    Boolean(metadata) &&
    typeof metadata === "object" &&
    typeof (metadata as Record<string, unknown>).id === "string" &&
    typeof (metadata as Record<string, unknown>).createdAt === "string" &&
    typeof (metadata as Record<string, unknown>).noteCount === "number" &&
    "bundle" in envelope
  );
}
