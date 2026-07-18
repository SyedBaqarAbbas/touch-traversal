import { describe, expect, it, vi } from "vitest";

import { studioBuildRequestSchema } from "../../lib/personal-ingestion-contract";
import {
  buildStudioCorpusPreview,
  createStudioBuildRequest,
  normalizeStudioRelativePath,
  stripCommonDirectoryRoot,
  studioIntakeLimits,
  type StudioFileCandidate,
  type StudioFileLike,
} from "../../lib/studio-intake";

function candidate(
  id: string,
  relativePath: string,
  body: string | Uint8Array,
  overrides: Partial<StudioFileLike> = {},
): StudioFileCandidate {
  const bytes =
    typeof body === "string"
      ? new TextEncoder().encode(body)
      : new Uint8Array(body);
  return {
    id,
    relativePath,
    source: "folder",
    file: {
      name: relativePath.split("/").at(-1) ?? relativePath,
      size: bytes.byteLength,
      lastModified: Date.UTC(2026, 6, 18, 12),
      arrayBuffer: async () => bytes.slice().buffer,
      ...overrides,
    },
  };
}

describe("studio intake path handling", () => {
  it("normalizes Unicode, strips exactly one common selected root, and rejects traversal", () => {
    expect(normalizeStudioRelativePath("ideas/Cafe\u0301.md")).toBe(
      "ideas/Café.md",
    );
    expect(
      stripCommonDirectoryRoot([
        "private-notes/origin.md",
        "private-notes/nested/companion.txt",
      ]),
    ).toEqual(["origin.md", "nested/companion.txt"]);
    expect(stripCommonDirectoryRoot(["one.md", "nested/two.md"])).toEqual([
      "one.md",
      "nested/two.md",
    ]);
    expect(() => normalizeStudioRelativePath("../private.md")).toThrow(
      /traversal/i,
    );
    expect(() => normalizeStudioRelativePath("folder\\private.md")).toThrow(
      /safe relative/i,
    );
    expect(() => normalizeStudioRelativePath("/private.md")).toThrow(
      /safe relative/i,
    );
  });

  it("preserves deterministic relative-path ordering and collision-free nested basenames", async () => {
    const preview = await buildStudioCorpusPreview([
      candidate("z", "zeta/origin.md", "# Zeta\nA local note."),
      candidate("a", "alpha/origin.md", "# Alpha\nAnother local note."),
      candidate("b", "alpha/companion.txt", "Companion content."),
    ]);

    expect(preview.accepted.map((file) => file.relativePath)).toEqual([
      "alpha/companion.txt",
      "alpha/origin.md",
      "zeta/origin.md",
    ]);
    const request = createStudioBuildRequest(preview, "fixture-request");
    expect(request.notes.map((note) => [note.name, note.relativePath])).toEqual(
      [
        ["companion.txt", "alpha/companion.txt"],
        ["origin.md", "alpha/origin.md"],
        ["origin.md", "zeta/origin.md"],
      ],
    );
    expect(studioBuildRequestSchema.parse(request)).toEqual(request);
  });
});

describe("studio intake validation", () => {
  it("previews supported metadata while mirroring pipeline exclusions", async () => {
    const preview = await buildStudioCorpusPreview([
      candidate(
        "accepted",
        "journal/entry.markdown",
        "# Entry\nPrivate marker never renders.",
      ),
      candidate("agents", "AGENTS.md", "Instructions"),
      candidate("hidden", ".private/secret.md", "Secret"),
      candidate("generated", "generated/output.txt", "Output"),
      candidate("unsupported", "photo.png", "not really a photo"),
      candidate("empty", "empty.txt", "   \n"),
    ]);

    expect(preview).toMatchObject({
      acceptedCount: 1,
      excludedCount: 5,
      selectedCount: 6,
      canContinue: true,
    });
    expect(preview.accepted[0]).toMatchObject({
      relativePath: "journal/entry.markdown",
      extension: ".markdown",
      mediaType: "text/markdown",
      source: "folder",
    });
    expect(preview.excluded.map((file) => file.code).sort()).toEqual([
      "empty_file",
      "pipeline_excluded",
      "pipeline_excluded",
      "pipeline_excluded",
      "unsupported_extension",
    ]);
  });

  it("excludes every case-insensitive duplicate and unsafe path", async () => {
    const preview = await buildStudioCorpusPreview([
      candidate("one", "nested/Origin.md", "First"),
      candidate("two", "nested/origin.md", "Second"),
      candidate("unsafe", "nested/../private.md", "Private"),
    ]);

    expect(preview.acceptedCount).toBe(0);
    expect(preview.excluded.map((file) => file.code)).toEqual([
      "unsafe_path",
      "duplicate_path",
      "duplicate_path",
    ]);
    expect(preview.warnings).toContainEqual(
      expect.objectContaining({ code: "no_accepted_files" }),
    );
  });

  it("detects invalid UTF-8, binary-looking, and unreadable notes without leaking bodies", async () => {
    const unreadable = vi.fn(async () => {
      throw new DOMException("permission denied", "NotReadableError");
    });
    const preview = await buildStudioCorpusPreview([
      candidate("encoding", "encoding.md", new Uint8Array([0xff, 0xfe, 0xfd])),
      candidate("binary", "binary.txt", "ok\0\0\0\0"),
      candidate("unreadable", "unreadable.md", "declared", {
        arrayBuffer: unreadable,
      }),
    ]);

    expect(preview.acceptedCount).toBe(0);
    expect(preview.excluded.map((file) => file.code)).toEqual([
      "binary_file",
      "invalid_encoding",
      "unreadable_file",
    ]);
    expect(JSON.stringify(preview.excluded)).not.toContain("permission denied");
    expect(unreadable).toHaveBeenCalledOnce();
  });

  it("applies hard file, count, and corpus budgets before reading excluded files", async () => {
    const oversizedRead = vi.fn(async () => new ArrayBuffer(0));
    const countCandidates = Array.from(
      { length: studioIntakeLimits.hardFileCount + 1 },
      (_, index) =>
        candidate(
          `count-${index}`,
          `notes/${String(index).padStart(3, "0")}.txt`,
          "x",
        ),
    );
    const preview = await buildStudioCorpusPreview([
      ...countCandidates,
      candidate("oversized", "oversized.md", "declared", {
        size: studioIntakeLimits.hardFileBytes + 1,
        arrayBuffer: oversizedRead,
      }),
    ]);

    expect(preview.acceptedCount).toBe(studioIntakeLimits.hardFileCount);
    expect(preview.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "file_count_limit" }),
        expect.objectContaining({ code: "file_too_large" }),
      ]),
    );
    expect(preview.warnings).toContainEqual(
      expect.objectContaining({ code: "approaching_file_count" }),
    );
    expect(oversizedRead).not.toHaveBeenCalled();
  });

  it("greedily enforces the total budget in stable path order", async () => {
    const reads = Array.from({ length: 9 }, () =>
      vi.fn(async () => new TextEncoder().encode("fixture").buffer),
    );
    const candidates = reads.map((read, index) =>
      candidate(`total-${index}`, `${index}.md`, "fixture", {
        size: studioIntakeLimits.hardFileBytes,
        arrayBuffer: read,
      }),
    );
    const preview = await buildStudioCorpusPreview(candidates.toReversed());

    expect(preview.accepted.map((file) => file.relativePath)).toEqual(
      Array.from({ length: 8 }, (_, index) => `${index}.md`),
    );
    expect(preview.excluded).toContainEqual(
      expect.objectContaining({
        relativePath: "8.md",
        code: "total_size_limit",
      }),
    );
    expect(reads[8]).not.toHaveBeenCalled();
  });
});
