import { describe, expect, it, vi } from "vitest";

import {
  parseArtifactBundle,
  type ArtifactBundle,
} from "../../lib/artifacts/schema";
import {
  defaultLocalStudioEndpoint,
  detectLocalStudioCapability,
  LocalStudioProvider,
  LocalStudioProviderError,
  localStudioRecoveryCommand,
} from "../../lib/local-studio-provider";
import {
  createMemoryPersonalGraphSessionStore,
  PersonalGraphSessionError,
} from "../../lib/personal-graph-session";
import {
  studioContractVersion,
  studioProgressSchema,
  studioProgressStages,
  type StudioBuildRequest,
  type StudioCapabilities,
  type StudioJobSnapshot,
} from "../../lib/personal-ingestion-contract";
import graph from "../../public/data/graph.json";
import layouts from "../../public/data/layouts.json";
import manifest from "../../public/data/manifest.json";
import report from "../../public/data/pipeline-report.json";

const token = "fixture-process-token-with-at-least-32-characters";
const request: StudioBuildRequest = {
  contractVersion: studioContractVersion,
  requestId: "two-note-browser-slice",
  notes: [
    {
      name: "origin.md",
      mediaType: "text/markdown",
      content: "PRIVATE_LOOPBACK_MARKER Origin links to the companion note.",
    },
    {
      name: "companion.txt",
      mediaType: "text/plain",
      content: "A second fictional note stays local and deterministic.",
    },
  ],
};

const capabilities: StudioCapabilities = {
  contractVersion: studioContractVersion,
  provider: "localhost-python",
  status: "ready",
  pipelineVersion: "0.1.0",
  sessionToken: token,
  progressStages: [...studioProgressStages],
  limits: {
    maxNotes: 200,
    maxNoteBytes: 2 * 1024 * 1024,
    maxRequestBytes: 20 * 1024 * 1024,
  },
  privacy: {
    transport: "loopback-http",
    noteContentsLogged: false,
    writesTrackedPublicData: false,
    persistentPersonalCache: false,
  },
};

function progress(
  stage: (typeof studioProgressStages)[number],
  sequence: number,
) {
  return {
    sequence,
    stage,
    stageIndex: studioProgressStages.indexOf(stage),
    totalStages: studioProgressStages.length as 9,
    message: `fixture / ${stage}`,
  };
}

function snapshot(
  state: StudioJobSnapshot["state"],
  stage: (typeof studioProgressStages)[number],
  sequence: number,
): StudioJobSnapshot {
  return {
    contractVersion: studioContractVersion,
    requestId: request.requestId,
    jobId: "job-fixture",
    state,
    progress: progress(stage, sequence),
    resultAvailable: state === "succeeded",
    error: null,
  };
}

function twoNoteBundle(): ArtifactBundle {
  const nodes = graph.nodes.slice(0, 2);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
  );
  const positions = (layout: Record<string, number[]>) =>
    Object.fromEntries(
      Object.entries(layout).filter(([nodeId]) => nodeIds.has(nodeId)),
    );
  const edgeCounts = Object.fromEntries(
    Object.keys(report.edgeCounts).map((edgeType) => [
      edgeType,
      edges.filter((edge) => edge.type === edgeType).length,
    ]),
  );
  const degree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  return parseArtifactBundle({
    graph: { ...graph, nodes, edges },
    layouts: {
      ...layouts,
      layouts: {
        semantic: positions(layouts.layouts.semantic),
        clusters: positions(layouts.layouts.clusters),
        temporal: positions(layouts.layouts.temporal),
        force: positions(layouts.layouts.force),
      },
    },
    manifest: {
      ...manifest,
      corpusName: "two-note-browser-slice",
      nodeCount: nodes.length,
      edgeCount: edges.length,
    },
    report: {
      ...report,
      fileCount: 2,
      chunkCount: 2,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      edgeCounts,
      isolatedNodeCount: [...degree.values()].filter((value) => value === 0)
        .length,
      averageDegree:
        [...degree.values()].reduce((sum, value) => sum + value, 0) /
        nodes.length,
      clusterCount: new Set(nodes.map((node) => node.visual.clusterId)).size,
      similarityDistribution: {
        count: 0,
      },
      buildDurationMs: 0,
      warnings: [],
    },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("local personal-ingestion provider", () => {
  it("keeps note contents on loopback and loads a validated two-note session", async () => {
    const bundle = twoNoteBundle();
    let poll = 0;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImplementation = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith("/v1/capabilities")) {
          return jsonResponse(capabilities);
        }
        if (url.endsWith("/v1/jobs") && init?.method === "POST") {
          return jsonResponse(snapshot("queued", "accepted", 0), 202);
        }
        if (url.endsWith("/v1/jobs/job-fixture") && init?.method === "GET") {
          poll += 1;
          return jsonResponse(
            poll === 1
              ? snapshot("running", "ingesting", 2)
              : snapshot("succeeded", "complete", 9),
          );
        }
        if (url.endsWith("/v1/jobs/job-fixture/result")) {
          return jsonResponse({
            contractVersion: studioContractVersion,
            requestId: request.requestId,
            jobId: "job-fixture",
            bundle,
          });
        }
        if (url.endsWith("/v1/jobs/job-fixture") && init?.method === "DELETE") {
          return new Response(null, { status: 204 });
        }
        return jsonResponse({ error: "unexpected fixture request" }, 500);
      },
    );
    const observed: string[] = [];
    const provider = new LocalStudioProvider({
      fetchImplementation: fetchImplementation as typeof fetch,
      pollIntervalMs: 0,
      sleep: async () => undefined,
    });

    const result = await provider.build(request, {
      onProgress: (update) => observed.push(update.stage),
    });
    const sessions = createMemoryPersonalGraphSessionStore();
    const session = sessions.activate("personal-two-note", result);

    expect(session.model.graph.order).toBe(2);
    expect(JSON.parse(sessions.exportActiveBundle())).toEqual(bundle);
    expect(observed).toEqual(["accepted", "ingesting", "complete"]);
    expect(
      calls.every((call) => call.url.startsWith(defaultLocalStudioEndpoint)),
    ).toBe(true);
    const noteRequest = calls.find((call) => call.init?.method === "POST");
    expect(noteRequest?.init?.body).toContain("PRIVATE_LOOPBACK_MARKER");
    for (const call of calls.filter(
      (candidate) => !candidate.url.endsWith("/v1/capabilities"),
    )) {
      expect(new Headers(call.init?.headers).get("Authorization")).toBe(
        `Bearer ${token}`,
      );
    }
    expect(calls.at(-1)?.init?.method).toBe("DELETE");
  });

  it("rejects remote endpoints before any note-bearing transport", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const detection = await detectLocalStudioCapability({
      endpoint: "https://ingestion.example.test",
      fetchImplementation,
    });

    expect(detection).toMatchObject({
      available: false,
      reason: "invalid-endpoint",
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(
      () =>
        new LocalStudioProvider({
          endpoint: "https://ingestion.example.test",
          fetchImplementation,
        }),
    ).toThrow(LocalStudioProviderError);
  });

  it("returns a truthful actionable response when local studio is absent", async () => {
    const detection = await detectLocalStudioCapability({
      fetchImplementation: vi.fn(async () => {
        throw new TypeError("connection refused");
      }) as typeof fetch,
    });

    expect(detection).toEqual({
      available: false,
      endpoint: defaultLocalStudioEndpoint,
      reason: "unreachable",
      message: "Personal graph studio is unavailable on this device.",
      recovery: localStudioRecoveryCommand,
    });
  });

  it("cancels the loopback job when the browser signal aborts", async () => {
    const controller = new AbortController();
    const methods: string[] = [];
    const fetchImplementation = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        methods.push(`${init?.method ?? "GET"} ${url}`);
        if (url.endsWith("/v1/capabilities")) {
          return jsonResponse(capabilities);
        }
        if (url.endsWith("/v1/jobs") && init?.method === "POST") {
          return jsonResponse(snapshot("running", "ingesting", 2), 202);
        }
        if (init?.method === "DELETE") {
          return jsonResponse(snapshot("running", "ingesting", 2), 202);
        }
        return jsonResponse(snapshot("running", "ingesting", 2));
      },
    );
    const provider = new LocalStudioProvider({
      fetchImplementation: fetchImplementation as typeof fetch,
      pollIntervalMs: 0,
      sleep: async () => {
        controller.abort();
      },
    });

    await expect(
      provider.build(request, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(methods.some((method) => method.startsWith("DELETE "))).toBe(true);
  });
});

describe("personal graph contracts and memory lifecycle", () => {
  it("rejects progress stages whose numeric position drifts", () => {
    expect(
      studioProgressSchema.safeParse({
        ...progress("embedding", 5),
        stageIndex: 1,
      }).success,
    ).toBe(false);
  });

  it("validates before activation, exports explicitly, and clears on reset", () => {
    const store = createMemoryPersonalGraphSessionStore();
    const bundle = twoNoteBundle();
    const invalid = structuredClone(bundle);
    Reflect.deleteProperty(
      invalid.layouts.layouts.semantic,
      invalid.graph.nodes[0]!.id,
    );

    expect(() => store.activate("invalid", invalid)).toThrow(
      "layout node ids must match graph node ids",
    );
    expect(store.current()).toBeNull();
    expect(() => store.exportActiveBundle()).toThrow(PersonalGraphSessionError);

    store.activate("two-note", bundle);
    expect(store.current()?.model.graph.order).toBe(2);
    store.reset();
    expect(store.current()).toBeNull();
  });
});
