import type { ZodType } from "zod";

import type { ArtifactBundle } from "@/lib/artifacts/schema";
import {
  studioBuildRequestSchema,
  studioBuildResultSchema,
  studioCapabilitiesSchema,
  studioErrorResponseSchema,
  studioJobSnapshotSchema,
  type StudioBuildRequest,
  type StudioCapabilities,
  type StudioFailure,
  type StudioProgress,
} from "@/lib/personal-ingestion-contract";

export const defaultLocalStudioEndpoint = "http://127.0.0.1:8765";
export const localStudioRecoveryCommand =
  "cd pipeline && uv sync --extra embeddings --extra layouts --all-groups && uv run touch-traversal studio";

type FetchImplementation = typeof fetch;
type Sleep = (delayMs: number) => Promise<void>;

export type LocalStudioCapabilityDetection =
  | {
      available: true;
      endpoint: string;
      capabilities: StudioCapabilities;
    }
  | {
      available: false;
      endpoint: string;
      reason: "invalid-endpoint" | "unreachable" | "incompatible";
      message: string;
      recovery: string;
    };

export type PersonalGraphBuildObserver = {
  signal?: AbortSignal;
  onProgress?: (progress: StudioProgress) => void;
};

export interface PersonalGraphGenerationProvider {
  detectCapability(): Promise<LocalStudioCapabilityDetection>;
  build(
    request: StudioBuildRequest,
    observer?: PersonalGraphBuildObserver,
  ): Promise<ArtifactBundle>;
  cancel(requestId: string): Promise<void>;
}

export class LocalStudioProviderError extends Error {
  constructor(
    readonly code:
      | StudioFailure["code"]
      | "invalid_endpoint"
      | "unreachable"
      | "incompatible",
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "LocalStudioProviderError";
  }
}

export type LocalStudioProviderOptions = {
  endpoint?: string;
  fetchImplementation?: FetchImplementation;
  pollIntervalMs?: number;
  sleep?: Sleep;
};

export async function detectLocalStudioCapability(
  options: LocalStudioProviderOptions = {},
): Promise<LocalStudioCapabilityDetection> {
  const endpoint = options.endpoint ?? defaultLocalStudioEndpoint;
  const normalized = normalizeLoopbackEndpoint(endpoint);
  if (!normalized.ok) {
    return {
      available: false,
      endpoint,
      reason: "invalid-endpoint",
      message: normalized.message,
      recovery: localStudioRecoveryCommand,
    };
  }
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  try {
    const response = await fetchImplementation(
      `${normalized.endpoint}/v1/capabilities`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
        method: "GET",
      },
    );
    if (!response.ok) {
      return {
        available: false,
        endpoint: normalized.endpoint,
        reason: "unreachable",
        message: `Local studio capability probe returned HTTP ${response.status}.`,
        recovery: localStudioRecoveryCommand,
      };
    }
    const parsed = studioCapabilitiesSchema.safeParse(await response.json());
    if (!parsed.success) {
      return {
        available: false,
        endpoint: normalized.endpoint,
        reason: "incompatible",
        message:
          "Local studio is running but uses an incompatible capability contract.",
        recovery: localStudioRecoveryCommand,
      };
    }
    return {
      available: true,
      endpoint: normalized.endpoint,
      capabilities: parsed.data,
    };
  } catch {
    return {
      available: false,
      endpoint: normalized.endpoint,
      reason: "unreachable",
      message: "Personal graph studio is unavailable on this device.",
      recovery: localStudioRecoveryCommand,
    };
  }
}

export class LocalStudioProvider implements PersonalGraphGenerationProvider {
  readonly endpoint: string;
  private readonly fetchImplementation: FetchImplementation;
  private readonly pollIntervalMs: number;
  private readonly sleep: Sleep;
  private capabilities: StudioCapabilities | null = null;
  private readonly jobByRequest = new Map<string, string>();

  constructor(options: LocalStudioProviderOptions = {}) {
    const normalized = normalizeLoopbackEndpoint(
      options.endpoint ?? defaultLocalStudioEndpoint,
    );
    if (!normalized.ok) {
      throw new LocalStudioProviderError(
        "invalid_endpoint",
        normalized.message,
      );
    }
    this.endpoint = normalized.endpoint;
    this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? 120;
    this.sleep =
      options.sleep ??
      ((delayMs) =>
        new Promise((resolve) => {
          setTimeout(resolve, delayMs);
        }));
  }

  async detectCapability(): Promise<LocalStudioCapabilityDetection> {
    const detection = await detectLocalStudioCapability({
      endpoint: this.endpoint,
      fetchImplementation: this.fetchImplementation,
    });
    this.capabilities = detection.available ? detection.capabilities : null;
    return detection;
  }

  async build(
    requestInput: StudioBuildRequest,
    observer: PersonalGraphBuildObserver = {},
  ): Promise<ArtifactBundle> {
    const request = studioBuildRequestSchema.parse(requestInput);
    const capabilities = await this.requireCapabilities();
    enforceCapabilityLimits(request, capabilities);
    assertNotAborted(observer.signal);

    let jobId: string | null = null;
    let cleanupTerminalJob = false;
    try {
      let snapshot = await this.requestJson(
        studioJobSnapshotSchema,
        "/v1/jobs",
        capabilities.sessionToken,
        {
          body: JSON.stringify(request),
          headers: { "Content-Type": "application/json" },
          method: "POST",
          signal: observer.signal,
        },
      );
      jobId = snapshot.jobId;
      this.jobByRequest.set(request.requestId, jobId);
      let lastSequence = -1;

      while (snapshot.state === "queued" || snapshot.state === "running") {
        if (snapshot.progress.sequence !== lastSequence) {
          observer.onProgress?.(snapshot.progress);
          lastSequence = snapshot.progress.sequence;
        }
        assertNotAborted(observer.signal);
        await this.sleep(this.pollIntervalMs);
        assertNotAborted(observer.signal);
        snapshot = await this.requestJson(
          studioJobSnapshotSchema,
          `/v1/jobs/${encodeURIComponent(jobId)}`,
          capabilities.sessionToken,
          { method: "GET", signal: observer.signal },
        );
      }

      observer.onProgress?.(snapshot.progress);
      cleanupTerminalJob = true;
      if (snapshot.state === "failed" && snapshot.error) {
        throw new LocalStudioProviderError(
          snapshot.error.code,
          snapshot.error.message,
          snapshot.error.retryable,
        );
      }
      if (snapshot.state === "cancelled") {
        throw new LocalStudioProviderError(
          "cancelled",
          "Personal graph build was cancelled.",
        );
      }
      if (snapshot.state !== "succeeded") {
        throw new LocalStudioProviderError(
          "incompatible",
          `Unexpected terminal studio state: ${snapshot.state}.`,
        );
      }

      const result = await this.requestJson(
        studioBuildResultSchema,
        `/v1/jobs/${encodeURIComponent(jobId)}/result`,
        capabilities.sessionToken,
        { method: "GET", signal: observer.signal },
      );
      if (result.requestId !== request.requestId || result.jobId !== jobId) {
        throw new LocalStudioProviderError(
          "incompatible",
          "Local studio returned a result for a different request.",
        );
      }
      return result.bundle;
    } catch (error) {
      if (observer.signal?.aborted) {
        if (jobId) {
          await this.cancelJob(jobId, capabilities.sessionToken);
        }
        throw new LocalStudioProviderError(
          "cancelled",
          "Personal graph build was cancelled.",
        );
      }
      if (jobId && !cleanupTerminalJob) {
        await this.cancelJob(jobId, capabilities.sessionToken);
      }
      throw error;
    } finally {
      this.jobByRequest.delete(request.requestId);
      if (jobId && cleanupTerminalJob) {
        try {
          await this.cleanupJob(jobId, capabilities.sessionToken);
        } catch {
          // Result/error delivery wins over best-effort terminal metadata cleanup.
        }
      }
    }
  }

  async cancel(requestId: string): Promise<void> {
    const jobId = this.jobByRequest.get(requestId);
    if (!jobId) {
      return;
    }
    const capabilities = await this.requireCapabilities();
    await this.cancelJob(jobId, capabilities.sessionToken);
    this.jobByRequest.delete(requestId);
  }

  private async requireCapabilities(): Promise<StudioCapabilities> {
    if (this.capabilities) {
      return this.capabilities;
    }
    const detection = await this.detectCapability();
    if (!detection.available) {
      throw new LocalStudioProviderError(
        detection.reason === "invalid-endpoint"
          ? "invalid_endpoint"
          : detection.reason,
        `${detection.message} Run: ${detection.recovery}`,
      );
    }
    return detection.capabilities;
  }

  private async cancelJob(jobId: string, token: string): Promise<void> {
    try {
      await this.fetchImplementation(
        `${this.endpoint}/v1/jobs/${encodeURIComponent(jobId)}`,
        {
          cache: "no-store",
          headers: authorizationHeaders(token),
          method: "DELETE",
        },
      );
    } catch {
      // A cancelled caller must return promptly; the companion still cleans its temp workspace.
    }
  }

  private async cleanupJob(jobId: string, token: string): Promise<void> {
    const response = await this.fetchImplementation(
      `${this.endpoint}/v1/jobs/${encodeURIComponent(jobId)}`,
      {
        cache: "no-store",
        headers: authorizationHeaders(token),
        method: "DELETE",
      },
    );
    if (!response.ok && response.status !== 404) {
      throw new LocalStudioProviderError(
        "unreachable",
        `Local studio cleanup returned HTTP ${response.status}.`,
        true,
      );
    }
  }

  private async requestJson<Output>(
    schema: ZodType<Output>,
    path: string,
    token: string,
    init: RequestInit,
  ): Promise<Output> {
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.endpoint}${path}`, {
        ...init,
        cache: "no-store",
        headers: {
          ...authorizationHeaders(token),
          ...headersToRecord(init.headers),
        },
      });
    } catch (error) {
      if (init.signal?.aborted) {
        throw error;
      }
      throw new LocalStudioProviderError(
        "unreachable",
        "Could not reach the loopback studio companion.",
        true,
      );
    }
    if (!response.ok) {
      const parsedError = studioErrorResponseSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (parsedError.success) {
        throw new LocalStudioProviderError(
          parsedError.data.error.code,
          parsedError.data.error.message,
          parsedError.data.error.retryable,
        );
      }
      throw new LocalStudioProviderError(
        "incompatible",
        `Local studio returned HTTP ${response.status} without a typed failure.`,
      );
    }
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) {
      throw new LocalStudioProviderError(
        "incompatible",
        "Local studio returned an incompatible response contract.",
      );
    }
    return parsed.data;
  }
}

function enforceCapabilityLimits(
  request: StudioBuildRequest,
  capabilities: StudioCapabilities,
): void {
  if (request.notes.length > capabilities.limits.maxNotes) {
    throw new LocalStudioProviderError(
      "payload_too_large",
      `Local studio accepts at most ${capabilities.limits.maxNotes} notes per request.`,
    );
  }
  const encoder = new TextEncoder();
  for (const note of request.notes) {
    if (
      encoder.encode(note.content).byteLength > capabilities.limits.maxNoteBytes
    ) {
      throw new LocalStudioProviderError(
        "payload_too_large",
        `Each local note must be at most ${capabilities.limits.maxNoteBytes} UTF-8 bytes.`,
      );
    }
  }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new LocalStudioProviderError(
      "cancelled",
      "Personal graph build was cancelled.",
    );
  }
}

function authorizationHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function headersToRecord(
  headers: HeadersInit | undefined,
): Record<string, string> {
  if (!headers) {
    return {};
  }
  return Object.fromEntries(new Headers(headers).entries());
}

function normalizeLoopbackEndpoint(
  endpoint: string,
): { ok: true; endpoint: string } | { ok: false; message: string } {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return { ok: false, message: "Local studio endpoint must be a valid URL." };
  }
  const hostname = parsed.hostname
    .replace(/^\[|\]$/g, "")
    .toLocaleLowerCase("en-US");
  const loopback =
    hostname === "localhost" ||
    hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (parsed.protocol !== "http:" || !loopback) {
    return {
      ok: false,
      message: "Local studio endpoint must use HTTP on a loopback hostname.",
    };
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    return {
      ok: false,
      message:
        "Local studio endpoint must not contain credentials, query, or fragment data.",
    };
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return { ok: true, endpoint: parsed.toString().replace(/\/$/, "") };
}
