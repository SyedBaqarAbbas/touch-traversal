import {
  studioContractVersion,
  type StudioBuildRequest,
} from "@/lib/personal-ingestion-contract";

export const studioIntakeLimits = {
  softFileCount: 100,
  hardFileCount: 200,
  softFileBytes: 1024 * 1024,
  hardFileBytes: 2 * 1024 * 1024,
  softTotalBytes: 8 * 1024 * 1024,
  hardTotalBytes: 16 * 1024 * 1024,
} as const;

export const studioSupportedExtensions = [".md", ".markdown", ".txt"] as const;

export type StudioIntakeSource = "files" | "folder" | "drop" | "directory-api";

export type StudioFileLike = {
  name: string;
  size: number;
  type?: string;
  lastModified?: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type StudioFileCandidate = {
  id: string;
  file: StudioFileLike;
  relativePath?: string;
  source: StudioIntakeSource;
};

export type StudioIntakeExclusionCode =
  | "unsafe_path"
  | "pipeline_excluded"
  | "unsupported_extension"
  | "duplicate_path"
  | "empty_file"
  | "binary_file"
  | "invalid_encoding"
  | "unreadable_file"
  | "file_too_large"
  | "file_count_limit"
  | "total_size_limit";

export type StudioIntakeNoticeCode =
  | "approaching_file_count"
  | "large_file"
  | "large_corpus"
  | "no_accepted_files";

export type StudioIntakeNotice = {
  code: StudioIntakeNoticeCode;
  message: string;
};

export type StudioAcceptedFile = {
  id: string;
  relativePath: string;
  name: string;
  extension: (typeof studioSupportedExtensions)[number];
  mediaType: "text/markdown" | "text/plain";
  bytes: number;
  modifiedAt: string | null;
  source: StudioIntakeSource;
  content: string;
};

export type StudioExcludedFile = {
  id: string;
  relativePath: string;
  bytes: number;
  source: StudioIntakeSource;
  code: StudioIntakeExclusionCode;
  message: string;
};

export type StudioCorpusPreview = {
  selectedCount: number;
  selectedBytes: number;
  acceptedCount: number;
  acceptedBytes: number;
  excludedCount: number;
  accepted: StudioAcceptedFile[];
  excluded: StudioExcludedFile[];
  warnings: StudioIntakeNotice[];
  canContinue: boolean;
};

type PreparedCandidate = StudioFileCandidate & {
  rawPath: string;
  relativePath: string;
  pathError: string | null;
};

const supportedExtensions = new Set<string>(studioSupportedExtensions);
const excludedDirectoryNames = new Set([
  ".git",
  "node_modules",
  "attachments",
  "generated",
]);

export function normalizeStudioRelativePath(path: string): string {
  if (
    path.length === 0 ||
    path.length > 512 ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(path)
  ) {
    throw new Error("Path must be a safe relative path.");
  }
  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment.length > 180 ||
        segment === "." ||
        segment === "..",
    )
  ) {
    throw new Error(
      "Path cannot contain empty, dot, traversal, or oversized segments.",
    );
  }
  return segments.map((segment) => segment.normalize("NFC")).join("/");
}

export function stripCommonDirectoryRoot(paths: readonly string[]): string[] {
  if (paths.length === 0) {
    return [];
  }
  const splitPaths = paths.map((path) => path.split("/"));
  const first = splitPaths[0]?.[0];
  if (
    !first ||
    splitPaths.some((segments) => segments.length < 2 || segments[0] !== first)
  ) {
    return [...paths];
  }
  return splitPaths.map((segments) => segments.slice(1).join("/"));
}

export async function buildStudioCorpusPreview(
  candidates: readonly StudioFileCandidate[],
  options: { stripCommonRoot?: boolean } = {},
): Promise<StudioCorpusPreview> {
  const rawPaths = candidates.map(
    (candidate) => candidate.relativePath || candidate.file.name,
  );
  const relativePaths = options.stripCommonRoot
    ? stripCommonDirectoryRoot(rawPaths)
    : rawPaths;
  const prepared: PreparedCandidate[] = candidates.map((candidate, index) => {
    const rawPath = relativePaths[index] ?? candidate.file.name;
    try {
      return {
        ...candidate,
        rawPath,
        relativePath: normalizeStudioRelativePath(rawPath),
        pathError: null,
      };
    } catch (error) {
      return {
        ...candidate,
        rawPath,
        relativePath: rawPath || candidate.file.name,
        pathError: error instanceof Error ? error.message : "Path is unsafe.",
      };
    }
  });
  prepared.sort(comparePreparedCandidates);

  const selectedBytes = prepared.reduce(
    (sum, candidate) => sum + candidate.file.size,
    0,
  );
  const excluded: StudioExcludedFile[] = [];
  const eligible: PreparedCandidate[] = [];
  const foldedPathCounts = new Map<string, number>();
  for (const candidate of prepared) {
    if (candidate.pathError === null) {
      const folded = candidate.relativePath.toLocaleLowerCase("en-US");
      foldedPathCounts.set(folded, (foldedPathCounts.get(folded) ?? 0) + 1);
    }
  }

  for (const [index, candidate] of prepared.entries()) {
    const base = exclusionBase(candidate);
    if (candidate.pathError !== null) {
      excluded.push({
        ...base,
        code: "unsafe_path",
        message: candidate.pathError,
      });
      continue;
    }
    const segments = candidate.relativePath.split("/");
    if (
      segments.some((segment) => segment.startsWith(".")) ||
      segments
        .slice(0, -1)
        .some((segment) =>
          excludedDirectoryNames.has(segment.toLocaleLowerCase("en-US")),
        ) ||
      segments.at(-1)?.toLocaleLowerCase("en-US") === "agents.md"
    ) {
      excluded.push({
        ...base,
        code: "pipeline_excluded",
        message: "Excluded by the public pipeline corpus rules.",
      });
      continue;
    }
    const extension = extensionFor(candidate.relativePath);
    if (!supportedExtensions.has(extension)) {
      excluded.push({
        ...base,
        code: "unsupported_extension",
        message: "Only .md, .markdown, and .txt files are supported.",
      });
      continue;
    }
    if (
      (foldedPathCounts.get(
        candidate.relativePath.toLocaleLowerCase("en-US"),
      ) ?? 0) > 1
    ) {
      excluded.push({
        ...base,
        code: "duplicate_path",
        message:
          "Another selected file has the same relative path ignoring case.",
      });
      continue;
    }
    if (candidate.file.size === 0) {
      excluded.push({
        ...base,
        code: "empty_file",
        message: "The file is empty.",
      });
      continue;
    }
    if (candidate.file.size > studioIntakeLimits.hardFileBytes) {
      excluded.push({
        ...base,
        code: "file_too_large",
        message: `The file exceeds the ${formatBytes(studioIntakeLimits.hardFileBytes)} per-file limit.`,
      });
      continue;
    }
    if (index >= studioIntakeLimits.hardFileCount) {
      excluded.push({
        ...base,
        code: "file_count_limit",
        message: `Only the first ${studioIntakeLimits.hardFileCount} files in path order can be accepted.`,
      });
      continue;
    }
    eligible.push(candidate);
  }

  const withinTotalBudget: PreparedCandidate[] = [];
  let plannedBytes = 0;
  for (const candidate of eligible) {
    if (
      plannedBytes + candidate.file.size >
      studioIntakeLimits.hardTotalBytes
    ) {
      excluded.push({
        ...exclusionBase(candidate),
        code: "total_size_limit",
        message: `Accepting this file would exceed the ${formatBytes(studioIntakeLimits.hardTotalBytes)} corpus limit.`,
      });
      continue;
    }
    plannedBytes += candidate.file.size;
    withinTotalBudget.push(candidate);
  }

  const accepted: StudioAcceptedFile[] = [];
  for (const candidate of withinTotalBudget) {
    try {
      const buffer = await candidate.file.arrayBuffer();
      const bytes = buffer.byteLength;
      if (bytes === 0) {
        excluded.push({
          ...exclusionBase(candidate),
          bytes,
          code: "empty_file",
          message: "The file is empty.",
        });
        continue;
      }
      if (bytes > studioIntakeLimits.hardFileBytes) {
        excluded.push({
          ...exclusionBase(candidate),
          bytes,
          code: "file_too_large",
          message: `The file exceeds the ${formatBytes(studioIntakeLimits.hardFileBytes)} per-file limit.`,
        });
        continue;
      }
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      } catch {
        excluded.push({
          ...exclusionBase(candidate),
          bytes,
          code: "invalid_encoding",
          message: "The file is not valid UTF-8 text.",
        });
        continue;
      }
      if (looksBinary(content)) {
        excluded.push({
          ...exclusionBase(candidate),
          bytes,
          code: "binary_file",
          message: "The file looks like binary data rather than a note.",
        });
        continue;
      }
      if (content.trim().length === 0) {
        excluded.push({
          ...exclusionBase(candidate),
          bytes,
          code: "empty_file",
          message: "The file contains no readable note text.",
        });
        continue;
      }
      const extension = extensionFor(
        candidate.relativePath,
      ) as StudioAcceptedFile["extension"];
      accepted.push({
        id: candidate.id,
        relativePath: candidate.relativePath,
        name: candidate.relativePath.split("/").at(-1) ?? candidate.file.name,
        extension,
        mediaType: extension === ".txt" ? "text/plain" : "text/markdown",
        bytes,
        modifiedAt: modifiedAt(candidate.file.lastModified),
        source: candidate.source,
        content,
      });
    } catch {
      excluded.push({
        ...exclusionBase(candidate),
        code: "unreadable_file",
        message:
          "The browser could not read this file. Check its permissions and try again.",
      });
    }
  }

  accepted.sort((left, right) =>
    comparePaths(left.relativePath, right.relativePath),
  );
  excluded.sort((left, right) =>
    comparePaths(left.relativePath, right.relativePath),
  );
  const acceptedBytes = accepted.reduce((sum, file) => sum + file.bytes, 0);
  const warnings: StudioIntakeNotice[] = [];
  if (prepared.length > studioIntakeLimits.softFileCount) {
    warnings.push({
      code: "approaching_file_count",
      message: `This selection has more than ${studioIntakeLimits.softFileCount} files; preview and graph generation may take longer.`,
    });
  }
  if (accepted.some((file) => file.bytes > studioIntakeLimits.softFileBytes)) {
    warnings.push({
      code: "large_file",
      message: `One or more accepted files exceed the ${formatBytes(studioIntakeLimits.softFileBytes)} soft file budget.`,
    });
  }
  if (acceptedBytes > studioIntakeLimits.softTotalBytes) {
    warnings.push({
      code: "large_corpus",
      message: `Accepted files exceed the ${formatBytes(studioIntakeLimits.softTotalBytes)} soft corpus budget.`,
    });
  }
  if (accepted.length === 0 && prepared.length > 0) {
    warnings.push({
      code: "no_accepted_files",
      message:
        "No supported readable notes are ready. Remove excluded files or choose another folder.",
    });
  }

  return {
    selectedCount: prepared.length,
    selectedBytes,
    acceptedCount: accepted.length,
    acceptedBytes,
    excludedCount: excluded.length,
    accepted,
    excluded,
    warnings,
    canContinue: accepted.length > 0,
  };
}

export function createStudioBuildRequest(
  preview: StudioCorpusPreview,
  requestId: string,
): StudioBuildRequest {
  return {
    contractVersion: studioContractVersion,
    requestId,
    notes: preview.accepted.map((file) => ({
      name: file.name,
      ...(file.relativePath === file.name
        ? {}
        : { relativePath: file.relativePath }),
      mediaType: file.mediaType,
      content: file.content,
      modifiedAt: file.modifiedAt,
    })),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function comparePreparedCandidates(
  left: PreparedCandidate,
  right: PreparedCandidate,
): number {
  return (
    comparePaths(left.relativePath, right.relativePath) ||
    left.id.localeCompare(right.id)
  );
}

function comparePaths(left: string, right: string): number {
  return left.localeCompare(right, "en-US", { sensitivity: "variant" });
}

function extensionFor(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLocaleLowerCase("en-US");
}

function exclusionBase(candidate: PreparedCandidate) {
  return {
    id: candidate.id,
    relativePath: candidate.relativePath,
    bytes: candidate.file.size,
    source: candidate.source,
  };
}

function modifiedAt(lastModified: number | undefined): string | null {
  if (
    lastModified === undefined ||
    !Number.isFinite(lastModified) ||
    lastModified <= 0
  ) {
    return null;
  }
  return new Date(lastModified).toISOString();
}

function looksBinary(content: string): boolean {
  if (content.includes("\0")) {
    return true;
  }
  let controls = 0;
  for (const character of content) {
    const code = character.codePointAt(0) ?? 0;
    if (
      code < 32 &&
      character !== "\n" &&
      character !== "\r" &&
      character !== "\t"
    ) {
      controls += 1;
    }
  }
  return content.length > 0 && controls / content.length > 0.05;
}
