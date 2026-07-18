"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";

import {
  buildStudioCorpusPreview,
  createStudioBuildRequest,
  formatBytes,
  stripCommonDirectoryRoot,
  type StudioCorpusPreview,
  type StudioFileCandidate,
  type StudioIntakeSource,
} from "@/lib/studio-intake";
import type { StudioBuildRequest } from "@/lib/personal-ingestion-contract";
import type { ArtifactBundle } from "@/lib/artifacts/schema";
import {
  LocalStudioProvider,
  LocalStudioProviderError,
  localStudioRecoveryCommand,
  type LocalStudioCapabilityDetection,
} from "@/lib/local-studio-provider";
import { personalGraphSessions } from "@/lib/personal-graph-session";
import type { StudioProgress } from "@/lib/personal-ingestion-contract";

type DirectoryHandle = {
  kind: "directory";
  name: string;
  values: () => AsyncIterableIterator<DirectoryHandle | FileHandle>;
};

type FileHandle = {
  kind: "file";
  name: string;
  getFile: () => Promise<File>;
};

type LegacyEntry = {
  isDirectory: boolean;
  isFile: boolean;
  name: string;
};

type LegacyFileEntry = LegacyEntry & {
  file: (
    success: (file: File) => void,
    failure: (error: DOMException) => void,
  ) => void;
};

type LegacyDirectoryEntry = LegacyEntry & {
  createReader: () => {
    readEntries: (
      success: (entries: LegacyEntry[]) => void,
      failure: (error: DOMException) => void,
    ) => void;
  };
};

type StudioWindow = Window & {
  showDirectoryPicker?: () => Promise<DirectoryHandle>;
};

const accept = ".md,.markdown,.txt,text/markdown,text/plain";

type GenerationState =
  | { status: "idle" }
  | { status: "checking" }
  | {
      status: "unavailable";
      detection: Exclude<LocalStudioCapabilityDetection, { available: true }>;
    }
  | {
      status: "ready";
      detection: Extract<LocalStudioCapabilityDetection, { available: true }>;
    }
  | { status: "building"; progress: StudioProgress | null }
  | { status: "cancelled"; message: string; elapsedMs: number }
  | { status: "error"; message: string; retryable: boolean; elapsedMs: number }
  | {
      status: "succeeded";
      bundle: ArtifactBundle;
      elapsedMs: number;
      sessionId: string;
    };

export function StudioIntake() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<StudioFileCandidate[]>([]);
  const [preview, setPreview] = useState<StudioCorpusPreview | null>(null);
  const [status, setStatus] = useState(
    "No personal files selected. The fictional sample remains available.",
  );
  const [processing, setProcessing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [generation, setGeneration] = useState<GenerationState>({
    status: "idle",
  });
  const [elapsedMs, setElapsedMs] = useState(0);
  const chooseFilesButtonRef = useRef<HTMLButtonElement>(null);
  const standardInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const fileSequenceRef = useRef(0);
  const previewSequenceRef = useRef(0);
  const confirmedRequestRef = useRef<StudioBuildRequest | null>(null);
  const providerRef = useRef<LocalStudioProvider | null>(null);
  const buildAbortRef = useRef<AbortController | null>(null);
  const buildStartedAtRef = useRef<number | null>(null);
  if (providerRef.current == null) {
    providerRef.current = new LocalStudioProvider();
  }

  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    return () => {
      previewSequenceRef.current += 1;
      buildAbortRef.current?.abort();
      confirmedRequestRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (generation.status !== "building") return;
    const update = () => {
      if (buildStartedAtRef.current !== null) {
        setElapsedMs(performance.now() - buildStartedAtRef.current);
      }
    };
    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [generation.status]);

  const assignCandidates = useCallback(
    (
      files: readonly File[],
      source: StudioIntakeSource,
      relativePaths?: readonly string[],
    ): StudioFileCandidate[] =>
      files.map((file, index) => ({
        id: `selected-${fileSequenceRef.current++}`,
        file,
        relativePath:
          relativePaths?.[index] ||
          (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
          file.name,
        source,
      })),
    [],
  );

  const updatePreview = useCallback(
    async (nextCandidates: StudioFileCandidate[]) => {
      const sequence = ++previewSequenceRef.current;
      confirmedRequestRef.current = null;
      setGeneration({ status: "idle" });
      setCandidates(nextCandidates);
      if (nextCandidates.length === 0) {
        setPreview(null);
        setProcessing(false);
        setStatus("Selection cleared. No personal files remain in memory.");
        return;
      }
      setProcessing(true);
      setStatus(
        `Reading metadata and validating ${nextCandidates.length} selected files locally.`,
      );
      const nextPreview = await buildStudioCorpusPreview(nextCandidates);
      if (sequence !== previewSequenceRef.current) {
        return;
      }
      setPreview(nextPreview);
      setProcessing(false);
      setStatus(
        `${nextPreview.acceptedCount} accepted, ${nextPreview.excludedCount} excluded, ${formatBytes(nextPreview.acceptedBytes)} ready locally.`,
      );
      requestAnimationFrame(() => previewHeadingRef.current?.focus());
    },
    [],
  );

  const addCandidates = useCallback(
    async (incoming: StudioFileCandidate[]) => {
      await updatePreview([...candidates, ...incoming]);
    },
    [candidates, updatePreview],
  );

  const onStandardFiles = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = "";
      await addCandidates(assignCandidates(files, "files"));
    },
    [addCandidates, assignCandidates],
  );

  const onFolderFiles = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = "";
      const uploadedPaths = files.map(
        (file) =>
          (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
          file.name,
      );
      const relativePaths = stripCommonDirectoryRoot(uploadedPaths);
      await addCandidates(assignCandidates(files, "folder", relativePaths));
    },
    [addCandidates, assignCandidates],
  );

  const chooseFolder = useCallback(async () => {
    const picker = (window as StudioWindow).showDirectoryPicker;
    if (!picker) {
      folderInputRef.current?.click();
      return;
    }
    try {
      const handle = await picker();
      const collected = await collectDirectoryHandle(handle);
      await addCandidates(
        assignCandidates(
          collected.map((entry) => entry.file),
          "directory-api",
          collected.map((entry) => entry.relativePath),
        ),
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("Folder selection cancelled. Existing preview is unchanged.");
        return;
      }
      setStatus(
        "The folder picker could not read that folder. Use the file picker fallback.",
      );
    }
  }, [addCandidates, assignCandidates]);

  const onDrop = useCallback(
    async (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setDragActive(false);
      setStatus("Inspecting dropped files locally.");
      try {
        const dropped = await collectDroppedFiles(event.dataTransfer);
        await addCandidates(
          assignCandidates(
            dropped.map((entry) => entry.file),
            "drop",
            dropped.map((entry) => entry.relativePath),
          ),
        );
      } catch {
        setStatus(
          "The browser could not read the dropped files. Use Choose files instead.",
        );
      }
    },
    [addCandidates, assignCandidates],
  );

  const removeCandidate = useCallback(
    async (id: string) => {
      await updatePreview(
        candidates.filter((candidate) => candidate.id !== id),
      );
    },
    [candidates, updatePreview],
  );

  const clearSelection = useCallback(() => {
    previewSequenceRef.current += 1;
    confirmedRequestRef.current = null;
    buildAbortRef.current?.abort();
    setGeneration({ status: "idle" });
    setCandidates([]);
    setPreview(null);
    setProcessing(false);
    setStatus("Selection cleared. No personal files remain in memory.");
    if (standardInputRef.current) standardInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
    requestAnimationFrame(() => chooseFilesButtonRef.current?.focus());
  }, []);

  const continueToGeneration = useCallback(async () => {
    if (!preview?.canContinue) return;
    confirmedRequestRef.current = createStudioBuildRequest(
      preview,
      `studio-${Date.now().toString(36)}`,
    );
    setGeneration({ status: "checking" });
    setStatus(
      `${confirmedRequestRef.current.notes.length} notes confirmed in memory. Checking the loopback companion before any note is sent.`,
    );
    const detection = await providerRef.current!.detectCapability();
    if (detection.available) {
      setGeneration({ status: "ready", detection });
      setStatus(
        `Local studio ${detection.capabilities.pipelineVersion} is ready. Review the local-only disclosure, then start generation.`,
      );
    } else {
      setGeneration({ status: "unavailable", detection });
      setStatus(`${detection.message} No note contents were sent.`);
    }
  }, [preview]);

  const startGeneration = useCallback(async () => {
    const request = confirmedRequestRef.current;
    if (!request || generation.status === "building") return;
    const controller = new AbortController();
    buildAbortRef.current = controller;
    buildStartedAtRef.current = performance.now();
    setElapsedMs(0);
    setGeneration({ status: "building", progress: null });
    setStatus(`Starting a local build for ${request.notes.length} notes.`);
    try {
      const bundle = await providerRef.current!.build(request, {
        signal: controller.signal,
        onProgress: (progress) => {
          setGeneration({ status: "building", progress });
          setStatus(
            `${progress.message} — stage ${progress.stageIndex + 1} of ${progress.totalStages}.`,
          );
        },
      });
      const duration =
        performance.now() - (buildStartedAtRef.current ?? performance.now());
      const session = personalGraphSessions.activate(
        request.requestId,
        bundle,
        {
          noteCount: request.notes.length,
          origin: "generated",
        },
      );
      setElapsedMs(duration);
      setGeneration({
        status: "succeeded",
        bundle,
        elapsedMs: duration,
        sessionId: session.id,
      });
      setStatus(
        `Personal graph ready: ${session.metadata.nodeCount} nodes and ${session.metadata.edgeCount} edges.`,
      );
    } catch (error) {
      const duration =
        performance.now() - (buildStartedAtRef.current ?? performance.now());
      if (
        controller.signal.aborted ||
        (error instanceof LocalStudioProviderError &&
          error.code === "cancelled")
      ) {
        setGeneration({
          status: "cancelled",
          message: "Build cancelled. The previously displayed graph was kept.",
          elapsedMs: duration,
        });
        setStatus("Build cancelled. The previously displayed graph was kept.");
      } else {
        const message = generationErrorMessage(error);
        setGeneration({
          status: "error",
          message,
          retryable:
            error instanceof LocalStudioProviderError ? error.retryable : false,
          elapsedMs: duration,
        });
        setStatus(`${message} The previously displayed graph was kept.`);
      }
    } finally {
      if (buildAbortRef.current === controller) buildAbortRef.current = null;
      buildStartedAtRef.current = null;
    }
  }, [generation.status]);

  const cancelGeneration = useCallback(() => {
    buildAbortRef.current?.abort();
  }, []);

  return (
    <main className="studio-shell">
      <header className="studio-header">
        <Link className="wordmark" href="/">
          touch traversal
        </Link>
        <p className="mode-label">local / studio intake</p>
      </header>

      <section className="studio-hero" aria-labelledby="studio-title">
        <p className="eyebrow">private corpus intake</p>
        <h1 id="studio-title">Choose notes for a local graph.</h1>
        <p className="description">
          Preview filenames and metadata before continuing. File contents stay
          in this browser tab, and selection never starts a network request or
          writes into the repository.
        </p>
        <Link className="studio-sample-link" href="/demo?input=mouse">
          Explore the fictional sample instead
        </Link>
      </section>

      <section
        className="studio-dropzone"
        data-drag-active={dragActive ? "true" : "false"}
        aria-labelledby="studio-select-title"
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setDragActive(false);
          }
        }}
        onDrop={onDrop}
      >
        <div>
          <p className="eyebrow">selection</p>
          <h2 id="studio-select-title">Drop a folder or choose local notes</h2>
          <p>
            Markdown and plain-text files only. Hidden paths, generated folders,
            and unsupported files appear as excluded metadata before anything
            can continue.
          </p>
        </div>
        <div className="studio-actions">
          <button
            ref={chooseFilesButtonRef}
            className="studio-button"
            type="button"
            onClick={() => standardInputRef.current?.click()}
          >
            Choose files
          </button>
          <input
            ref={standardInputRef}
            className="studio-visually-hidden"
            id="studio-files"
            type="file"
            accept={accept}
            multiple
            aria-label="Choose note files"
            onChange={onStandardFiles}
          />
          <button
            className="studio-button studio-button--quiet"
            type="button"
            onClick={chooseFolder}
          >
            Choose folder
          </button>
          <input
            ref={folderInputRef}
            className="studio-visually-hidden"
            id="studio-folder"
            type="file"
            accept={accept}
            multiple
            aria-label="Choose a folder of notes"
            onChange={onFolderFiles}
          />
        </div>
      </section>

      <p
        className="studio-live"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {status}
      </p>

      {preview ? (
        <section
          className="studio-preview"
          aria-labelledby="studio-preview-title"
        >
          <div className="studio-preview__heading">
            <div>
              <p className="eyebrow">privacy preview</p>
              <h2
                id="studio-preview-title"
                ref={previewHeadingRef}
                tabIndex={-1}
              >
                Review before continuing
              </h2>
            </div>
            <button
              className="studio-text-button"
              type="button"
              onClick={clearSelection}
            >
              Clear selection
            </button>
          </div>

          <dl className="studio-summary" aria-label="Selection summary">
            <div>
              <dt>selected</dt>
              <dd>{preview.selectedCount}</dd>
            </div>
            <div>
              <dt>accepted</dt>
              <dd>{preview.acceptedCount}</dd>
            </div>
            <div>
              <dt>excluded</dt>
              <dd>{preview.excludedCount}</dd>
            </div>
            <div>
              <dt>ready bytes</dt>
              <dd>{formatBytes(preview.acceptedBytes)}</dd>
            </div>
          </dl>

          {preview.warnings.length > 0 ? (
            <div
              className="studio-notices"
              role="alert"
              aria-label="Intake warnings"
            >
              <h3>Before continuing</h3>
              <ul>
                {preview.warnings.map((warning) => (
                  <li key={warning.code}>{warning.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.accepted.length > 0 ? (
            <div className="studio-file-group">
              <h3>Accepted notes</h3>
              <ul className="studio-file-list">
                {preview.accepted.map((file) => (
                  <li key={file.id}>
                    <div>
                      <strong>{file.relativePath}</strong>
                      <span>
                        {file.extension} · {formatBytes(file.bytes)} ·{" "}
                        {file.modifiedAt
                          ? new Date(file.modifiedAt).toLocaleString()
                          : "modified date unavailable"}{" "}
                        · {file.source}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void removeCandidate(file.id)}
                      aria-label={`Remove ${file.relativePath}`}
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.excluded.length > 0 ? (
            <div className="studio-file-group">
              <h3>Excluded files</h3>
              <ul className="studio-file-list studio-file-list--excluded">
                {preview.excluded.map((file) => (
                  <li key={file.id}>
                    <div>
                      <strong>{file.relativePath}</strong>
                      <span>
                        {formatBytes(file.bytes)} · {file.message}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void removeCandidate(file.id)}
                      aria-label={`Remove ${file.relativePath}`}
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="studio-confirm">
            <p>
              Continuing creates an in-memory request only. No note body is
              displayed, logged, or sent during intake.
            </p>
            <button
              className="studio-button"
              type="button"
              disabled={!preview.canContinue || processing}
              onClick={continueToGeneration}
            >
              Continue to graph generation
            </button>
          </div>

          <StudioGenerationPanel
            state={generation}
            elapsedMs={elapsedMs}
            onCancel={cancelGeneration}
            onOpen={() => {
              personalGraphSessions.selectSource("personal");
              router.push("/demo");
            }}
            onRetry={() => void continueToGeneration()}
            onStart={() => void startGeneration()}
          />
        </section>
      ) : null}

      {processing ? (
        <p className="studio-processing">Validating locally…</p>
      ) : null}

      <nav
        className="route-shell__nav studio-nav"
        aria-label="Prototype routes"
      >
        <Link href="/">home</Link>
        <Link href="/demo">demo</Link>
        <Link href="/perform">perform</Link>
        <Link href="/studio">studio</Link>
        <Link href="/calibration">calibration</Link>
        <Link href="/debug">debug</Link>
      </nav>
    </main>
  );
}

function StudioGenerationPanel({
  state,
  elapsedMs,
  onCancel,
  onOpen,
  onRetry,
  onStart,
}: {
  state: GenerationState;
  elapsedMs: number;
  onCancel: () => void;
  onOpen: () => void;
  onRetry: () => void;
  onStart: () => void;
}) {
  if (state.status === "idle") return null;
  return (
    <section
      className="studio-generation"
      aria-labelledby="studio-generation-title"
      aria-busy={state.status === "checking" || state.status === "building"}
    >
      <p className="eyebrow">local generation</p>
      <h3 id="studio-generation-title">
        {state.status === "checking"
          ? "Checking the local companion"
          : state.status === "ready"
            ? "Ready to send notes over loopback"
            : state.status === "unavailable"
              ? "Local studio needs to be started"
              : state.status === "building"
                ? "Building your personal graph"
                : state.status === "succeeded"
                  ? "Personal graph ready"
                  : state.status === "cancelled"
                    ? "Build cancelled"
                    : "Build stopped safely"}
      </h3>

      {state.status === "checking" ? (
        <p>No note names or contents are included in the capability probe.</p>
      ) : null}

      {state.status === "unavailable" ? (
        <>
          <p>{state.detection.message}</p>
          <p>
            Start the local Python companion in another terminal, then retry:
          </p>
          <code>{state.detection.recovery}</code>
          <button
            className="studio-button studio-button--quiet"
            type="button"
            onClick={onRetry}
          >
            Check again
          </button>
        </>
      ) : null}

      {state.status === "ready" ? (
        <>
          <p>
            This sends accepted note contents only to {state.detection.endpoint}
            . Pipeline version {state.detection.capabilities.pipelineVersion}{" "}
            reports no content logging, no public-data writes, and no persistent
            personal cache.
          </p>
          <p>
            The first build may download local model weights; that download
            contains no note data.
          </p>
          <button className="studio-button" type="button" onClick={onStart}>
            Start local graph build
          </button>
        </>
      ) : null}

      {state.status === "building" ? (
        <>
          <p>
            {state.progress?.message ??
              "Waiting for the local studio to accept the request."}
          </p>
          <progress
            max={state.progress?.totalStages ?? 9}
            value={state.progress ? state.progress.stageIndex + 1 : 0}
          >
            {state.progress ? state.progress.stageIndex + 1 : 0} of{" "}
            {state.progress?.totalStages ?? 9}
          </progress>
          <p className="studio-generation__elapsed">
            Elapsed {formatElapsed(elapsedMs)}
          </p>
          <button
            className="studio-button studio-button--quiet"
            type="button"
            onClick={onCancel}
          >
            Cancel build
          </button>
        </>
      ) : null}

      {state.status === "error" || state.status === "cancelled" ? (
        <>
          <p role={state.status === "error" ? "alert" : "status"}>
            {state.message}
          </p>
          <p>
            Elapsed {formatElapsed(state.elapsedMs)}. Your selected source files
            were not changed.
          </p>
          <button
            className="studio-button studio-button--quiet"
            type="button"
            onClick={onRetry}
          >
            Retry local build
          </button>
        </>
      ) : null}

      {state.status === "succeeded" ? (
        <>
          <dl
            className="studio-build-summary"
            aria-label="Personal graph build summary"
          >
            <div>
              <dt>notes</dt>
              <dd>{state.bundle.report.fileCount}</dd>
            </div>
            <div>
              <dt>nodes</dt>
              <dd>{state.bundle.graph.nodes.length}</dd>
            </div>
            <div>
              <dt>edges</dt>
              <dd>{state.bundle.graph.edges.length}</dd>
            </div>
            <div>
              <dt>elapsed</dt>
              <dd>{formatElapsed(state.elapsedMs)}</dd>
            </div>
          </dl>
          {state.bundle.report.warnings.length > 0 ? (
            <p>
              {state.bundle.report.warnings.length} pipeline warnings are
              included in the private export.
            </p>
          ) : null}
          <button className="studio-button" type="button" onClick={onOpen}>
            Open personal graph
          </button>
        </>
      ) : null}
    </section>
  );
}

function formatElapsed(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.max(0, Math.round(milliseconds))} ms`;
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

function generationErrorMessage(error: unknown): string {
  if (error instanceof LocalStudioProviderError) {
    if (error.code === "unreachable") {
      return `The loopback companion disconnected. Restart it with: ${localStudioRecoveryCommand}`;
    }
    if (error.code === "incompatible" || error.code === "protocol_mismatch") {
      return "The local companion uses an incompatible protocol. Update and restart the companion.";
    }
    if (error.code === "pipeline_unavailable") {
      return `The local graph model or pipeline is unavailable. Run: ${localStudioRecoveryCommand}`;
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "The local build stopped before returning a readable error.";
}

async function collectDirectoryHandle(
  directory: DirectoryHandle,
  prefix = "",
): Promise<Array<{ file: File; relativePath: string }>> {
  const entries: Array<{ file: File; relativePath: string }> = [];
  const handles: Array<DirectoryHandle | FileHandle> = [];
  for await (const handle of directory.values()) handles.push(handle);
  handles.sort((left, right) => left.name.localeCompare(right.name, "en-US"));
  for (const handle of handles) {
    const relativePath = prefix ? `${prefix}/${handle.name}` : handle.name;
    if (handle.kind === "file") {
      entries.push({ file: await handle.getFile(), relativePath });
    } else {
      entries.push(...(await collectDirectoryHandle(handle, relativePath)));
    }
  }
  return entries;
}

async function collectDroppedFiles(
  transfer: DataTransfer,
): Promise<Array<{ file: File; relativePath: string }>> {
  const items = Array.from(transfer.items);
  const handleItems = items.filter(
    (item) =>
      typeof (item as DataTransferItem & { getAsFileSystemHandle?: unknown })
        .getAsFileSystemHandle === "function",
  );
  if (handleItems.length > 0) {
    const collected: Array<{ file: File; relativePath: string }> = [];
    for (const item of handleItems) {
      const handle = await (
        item as DataTransferItem & {
          getAsFileSystemHandle: () => Promise<
            DirectoryHandle | FileHandle | null
          >;
        }
      ).getAsFileSystemHandle();
      if (!handle) continue;
      if (handle.kind === "file") {
        collected.push({
          file: await handle.getFile(),
          relativePath: handle.name,
        });
      } else {
        collected.push(...(await collectDirectoryHandle(handle)));
      }
    }
    if (collected.length > 0) return collected;
  }

  const legacyEntries: LegacyEntry[] = [];
  for (const item of items) {
    const getter = (
      item as unknown as {
        webkitGetAsEntry?: () => LegacyEntry | null;
      }
    ).webkitGetAsEntry;
    const entry = getter?.call(item);
    if (entry) legacyEntries.push(entry);
  }
  if (legacyEntries.length > 0) {
    const collected: Array<{ file: File; relativePath: string }> = [];
    for (const entry of legacyEntries)
      collected.push(...(await collectLegacyEntry(entry, "")));
    if (collected.length > 0) return collected;
  }

  return Array.from(transfer.files).map((file) => ({
    file,
    relativePath:
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name,
  }));
}

async function collectLegacyEntry(
  entry: LegacyEntry,
  prefix: string,
): Promise<Array<{ file: File; relativePath: string }>> {
  const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as LegacyFileEntry).file(resolve, reject),
    );
    return [{ file, relativePath }];
  }
  const directory = entry as LegacyDirectoryEntry;
  const reader = directory.createReader();
  const children: LegacyEntry[] = [];
  while (true) {
    const page = await new Promise<LegacyEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (page.length === 0) break;
    children.push(...page);
  }
  children.sort((left, right) => left.name.localeCompare(right.name, "en-US"));
  const collected: Array<{ file: File; relativePath: string }> = [];
  for (const child of children)
    collected.push(...(await collectLegacyEntry(child, relativePath)));
  return collected;
}
