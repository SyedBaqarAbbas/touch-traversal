import {
  parseArtifactBundle,
  type ArtifactBundle,
} from "@/lib/artifacts/schema";
import { buildGraphModel, type GraphModel } from "@/lib/graph-model";

export type PersonalGraphSession = {
  id: string;
  bundle: ArtifactBundle;
  model: GraphModel;
};

export interface PersonalGraphSessionStore {
  activate(sessionId: string, input: unknown): PersonalGraphSession;
  current(): PersonalGraphSession | null;
  exportActiveBundle(): string;
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
  return { bundle, model: buildGraphModel(bundle) };
}

export function createMemoryPersonalGraphSessionStore(): PersonalGraphSessionStore {
  let active: PersonalGraphSession | null = null;

  return {
    activate(sessionId, input) {
      if (!sessionId.trim()) {
        throw new PersonalGraphSessionError(
          "Personal graph session id must not be blank.",
        );
      }
      const loaded = loadPersonalBundleForScene(input);
      active = { id: sessionId, ...loaded };
      return active;
    },
    current() {
      return active;
    },
    exportActiveBundle() {
      if (!active) {
        throw new PersonalGraphSessionError(
          "No personal graph session is active.",
        );
      }
      return `${JSON.stringify(active.bundle, null, 2)}\n`;
    },
    reset() {
      active = null;
    },
  };
}
