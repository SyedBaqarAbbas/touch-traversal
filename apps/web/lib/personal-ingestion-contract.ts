import { z } from "zod";

import { artifactBundleSchema } from "@/lib/artifacts/schema";

export const studioContractVersion = 1 as const;
export const studioProgressStages = [
  "accepted",
  "materializing",
  "ingesting",
  "chunking",
  "relating",
  "embedding",
  "laying_out",
  "validating",
  "complete",
] as const;

export const studioJobStates = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export const studioErrorCodes = [
  "invalid_request",
  "unauthorized",
  "unsupported_origin",
  "payload_too_large",
  "not_found",
  "result_not_ready",
  "pipeline_unavailable",
  "build_failed",
  "cancelled",
  "protocol_mismatch",
] as const;

const requestIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[\w.-]+$/);
const noteName = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .refine(
    (value) =>
      value !== "." &&
      value !== ".." &&
      !value.includes("/") &&
      !value.includes("\\") &&
      !value.includes("\0"),
    "must be a single local filename without path components",
  );
const noteRelativePath = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => {
    if (
      value.startsWith("/") ||
      value.endsWith("/") ||
      value.includes("\\") ||
      value.includes("\0") ||
      /[\u0000-\u001f\u007f]/u.test(value)
    ) {
      return false;
    }
    const segments = value.split("/");
    return segments.every(
      (segment) =>
        segment.length > 0 &&
        segment.length <= 180 &&
        segment !== "." &&
        segment !== "..",
    );
  }, "must be a safe canonical POSIX path relative to the selected folder");

export const studioNoteSchema = z
  .object({
    name: noteName,
    relativePath: noteRelativePath.optional(),
    mediaType: z.enum(["text/markdown", "text/plain"]),
    content: z.string().min(1),
    modifiedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .strict()
  .superRefine((note, context) => {
    if (
      note.relativePath !== undefined &&
      note.relativePath.split("/").at(-1) !== note.name
    ) {
      context.addIssue({
        code: "custom",
        message: "relativePath must end with name",
        path: ["relativePath"],
      });
    }
  });

export const studioBuildRequestSchema = z
  .object({
    contractVersion: z.literal(studioContractVersion),
    requestId: requestIdentifier,
    notes: z.array(studioNoteSchema).min(1).max(200),
  })
  .strict()
  .superRefine((request, context) => {
    const paths = new Set<string>();
    for (const [index, note] of request.notes.entries()) {
      const folded = (note.relativePath ?? note.name).toLocaleLowerCase(
        "en-US",
      );
      if (paths.has(folded)) {
        context.addIssue({
          code: "custom",
          message: "note relative paths must be unique ignoring case",
          path: ["notes", index, note.relativePath ? "relativePath" : "name"],
        });
      }
      paths.add(folded);
    }
  });

export const studioProgressSchema = z
  .object({
    sequence: z.number().int().min(0),
    stage: z.enum(studioProgressStages),
    stageIndex: z
      .number()
      .int()
      .min(0)
      .max(studioProgressStages.length - 1),
    totalStages: z.literal(studioProgressStages.length),
    message: z.string().min(1),
  })
  .strict()
  .superRefine((progress, context) => {
    if (studioProgressStages[progress.stageIndex] !== progress.stage) {
      context.addIssue({
        code: "custom",
        message:
          "stageIndex must identify stage in the versioned stage sequence",
        path: ["stageIndex"],
      });
    }
  });

export const studioFailureSchema = z
  .object({
    code: z.enum(studioErrorCodes),
    message: z.string().min(1),
    retryable: z.boolean(),
  })
  .strict();

export const studioJobSnapshotSchema = z
  .object({
    contractVersion: z.literal(studioContractVersion),
    requestId: requestIdentifier,
    jobId: requestIdentifier,
    state: z.enum(studioJobStates),
    progress: studioProgressSchema,
    resultAvailable: z.boolean(),
    error: studioFailureSchema.nullable().optional(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.resultAvailable !== (snapshot.state === "succeeded")) {
      context.addIssue({
        code: "custom",
        message: "resultAvailable must be true only for succeeded jobs",
        path: ["resultAvailable"],
      });
    }
    if ((snapshot.state === "failed") !== (snapshot.error != null)) {
      context.addIssue({
        code: "custom",
        message: "failed jobs must expose exactly one typed error",
        path: ["error"],
      });
    }
  });

export const studioBuildResultSchema = z
  .object({
    contractVersion: z.literal(studioContractVersion),
    requestId: requestIdentifier,
    jobId: requestIdentifier,
    bundle: artifactBundleSchema,
  })
  .strict();

export const studioCapabilitiesSchema = z
  .object({
    contractVersion: z.literal(studioContractVersion),
    provider: z.literal("localhost-python"),
    status: z.literal("ready"),
    pipelineVersion: z.string().min(1),
    sessionToken: z.string().min(32),
    progressStages: z
      .array(z.enum(studioProgressStages))
      .length(studioProgressStages.length),
    limits: z
      .object({
        maxNotes: z.number().int().min(1),
        maxNoteBytes: z.number().int().min(1),
        maxRequestBytes: z.number().int().min(1),
      })
      .strict(),
    privacy: z
      .object({
        transport: z.literal("loopback-http"),
        noteContentsLogged: z.literal(false),
        writesTrackedPublicData: z.literal(false),
        persistentPersonalCache: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((capabilities, context) => {
    if (
      capabilities.progressStages.some(
        (stage, index) => stage !== studioProgressStages[index],
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "progressStages must match the versioned stage sequence",
        path: ["progressStages"],
      });
    }
  });

export const studioErrorResponseSchema = z
  .object({
    contractVersion: z.literal(studioContractVersion),
    error: studioFailureSchema,
  })
  .strict();

export type StudioNote = z.infer<typeof studioNoteSchema>;
export type StudioBuildRequest = z.infer<typeof studioBuildRequestSchema>;
export type StudioProgress = z.infer<typeof studioProgressSchema>;
export type StudioFailure = z.infer<typeof studioFailureSchema>;
export type StudioJobSnapshot = z.infer<typeof studioJobSnapshotSchema>;
export type StudioBuildResult = z.infer<typeof studioBuildResultSchema>;
export type StudioCapabilities = z.infer<typeof studioCapabilitiesSchema>;
