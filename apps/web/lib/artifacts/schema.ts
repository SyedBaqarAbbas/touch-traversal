import { z } from "zod";

export const edgeTypes = [
  "explicit",
  "structural",
  "semantic",
  "temporal",
  "entity",
  "manual",
] as const;

export const layoutNames = [
  "semantic",
  "clusters",
  "temporal",
  "force",
] as const;

const edgeTypeSet = new Set<string>(edgeTypes);
const finiteNumber = z.number().refine(Number.isFinite, "must be finite");
const nonEmptyString = z.string().trim().min(1);
const unitFloat = finiteNumber.min(0).max(1);
const positiveFloat = finiteNumber.positive();
const timestamp = z.string().datetime({ offset: true });
const nullableTimestamp = timestamp.nullable().optional();

export const edgeTypeSchema = z.enum(edgeTypes);
export const layoutNameSchema = z.enum(layoutNames);
export const vec3Schema = z.tuple([finiteNumber, finiteNumber, finiteNumber]);

export const sourceProvenanceSchema = z
  .object({
    path: nonEmptyString,
    documentId: nonEmptyString,
    headingPath: z.array(z.string()).default([]),
    startLine: z.number().int().min(1).nullable().optional(),
    endLine: z.number().int().min(1).nullable().optional(),
  })
  .strict()
  .superRefine((source, context) => {
    if (
      source.startLine != null &&
      source.endLine != null &&
      source.endLine < source.startLine
    ) {
      context.addIssue({
        code: "custom",
        message: "endLine must be greater than or equal to startLine",
        path: ["endLine"],
      });
    }
  });

export const thoughtNodeSchema = z
  .object({
    id: nonEmptyString,
    title: nonEmptyString,
    text: nonEmptyString,
    summary: nonEmptyString,
    source: sourceProvenanceSchema,
    metadata: z
      .object({
        createdAt: nullableTimestamp,
        modifiedAt: nullableTimestamp,
        tags: z.array(z.string()).default([]),
        entities: z.array(z.string()).default([]),
        wordCount: z.number().int().min(0),
        importance: unitFloat,
      })
      .strict(),
    visual: z
      .object({
        clusterId: nonEmptyString,
        size: positiveFloat,
        baseOpacity: unitFloat,
      })
      .strict(),
  })
  .strict();

export const thoughtEdgeSchema = z
  .object({
    id: nonEmptyString,
    source: nonEmptyString,
    target: nonEmptyString,
    directed: z.boolean(),
    type: edgeTypeSchema,
    weight: unitFloat,
    confidence: unitFloat,
    evidence: z
      .object({
        description: nonEmptyString,
        sharedTerms: z.array(z.string()).default([]),
        sharedEntities: z.array(z.string()).default([]),
        similarity: unitFloat.nullable().optional(),
        timeDistanceDays: finiteNumber.min(0).nullable().optional(),
      })
      .strict(),
    visual: z
      .object({
        opacity: unitFloat,
        width: positiveFloat,
      })
      .strict(),
  })
  .strict()
  .superRefine((edge, context) => {
    if (edge.source === edge.target) {
      context.addIssue({
        code: "custom",
        message: "source and target must identify different nodes",
        path: ["target"],
      });
    }
  });

export const graphArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    nodes: z.array(thoughtNodeSchema),
    edges: z.array(thoughtEdgeSchema),
  })
  .strict()
  .superRefine((graph, context) => {
    const nodeIds = new Set<string>();
    for (const [index, node] of graph.nodes.entries()) {
      if (nodeIds.has(node.id)) {
        context.addIssue({
          code: "custom",
          message: `duplicate node id: ${node.id}`,
          path: ["nodes", index, "id"],
        });
      }
      nodeIds.add(node.id);
    }

    const edgeIds = new Set<string>();
    for (const [index, edge] of graph.edges.entries()) {
      if (edgeIds.has(edge.id)) {
        context.addIssue({
          code: "custom",
          message: `duplicate edge id: ${edge.id}`,
          path: ["edges", index, "id"],
        });
      }
      edgeIds.add(edge.id);

      for (const endpoint of ["source", "target"] as const) {
        if (!nodeIds.has(edge[endpoint])) {
          context.addIssue({
            code: "custom",
            message: `edge references unknown node id: ${edge[endpoint]}`,
            path: ["edges", index, endpoint],
          });
        }
      }
    }
  });

const layoutMapSchema = z.record(nonEmptyString, vec3Schema);

export const layoutArtifactSchema = z
  .object({
    version: z.literal(1),
    bounds: z
      .object({
        min: vec3Schema,
        max: vec3Schema,
      })
      .strict()
      .superRefine((bounds, context) => {
        for (const [axis, lower] of bounds.min.entries()) {
          if (lower > bounds.max[axis]) {
            context.addIssue({
              code: "custom",
              message: "bounds.min must not exceed bounds.max on any axis",
              path: ["min", axis],
            });
          }
        }
      }),
    layouts: z
      .object({
        semantic: layoutMapSchema,
        clusters: layoutMapSchema,
        temporal: layoutMapSchema,
        force: layoutMapSchema,
      })
      .strict()
      .superRefine((layouts, context) => {
        const expected = Object.keys(layouts.semantic).sort();
        for (const layoutName of layoutNames) {
          const actual = Object.keys(layouts[layoutName]).sort();
          if (!sameOrdered(actual, expected)) {
            context.addIssue({
              code: "custom",
              message: `${layoutName} node ids must match semantic node ids`,
              path: [layoutName],
            });
          }
        }
      }),
  })
  .strict();

export const graphManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: timestamp,
    corpusName: nonEmptyString,
    nodeCount: z.number().int().min(0),
    edgeCount: z.number().int().min(0),
    embeddingModel: nonEmptyString,
    pipelineConfigHash: nonEmptyString,
  })
  .strict();

export const similarityDistributionSchema = z
  .object({
    count: z.number().int().min(0),
    minimum: unitFloat.nullable().optional(),
    median: unitFloat.nullable().optional(),
    p95: unitFloat.nullable().optional(),
    maximum: unitFloat.nullable().optional(),
  })
  .strict()
  .superRefine((distribution, context) => {
    const values = [
      distribution.minimum,
      distribution.median,
      distribution.p95,
      distribution.maximum,
    ];
    if (distribution.count === 0) {
      if (values.some((value) => value != null)) {
        context.addIssue({
          code: "custom",
          message: "an empty distribution must not include summary values",
          path: ["count"],
        });
      }
      return;
    }

    if (values.some((value) => value == null)) {
      context.addIssue({
        code: "custom",
        message:
          "a non-empty distribution requires minimum, median, p95, and maximum",
        path: ["count"],
      });
      return;
    }

    const numericValues = values as number[];
    for (let index = 1; index < numericValues.length; index += 1) {
      if (numericValues[index] < numericValues[index - 1]) {
        context.addIssue({
          code: "custom",
          message: "similarity summary values must be ordered",
          path: ["maximum"],
        });
        return;
      }
    }
  });

const edgeCountsSchema = z.record(z.string(), z.number().int().min(0));

export const pipelineReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: timestamp,
    fileCount: z.number().int().min(0),
    chunkCount: z.number().int().min(0),
    nodeCount: z.number().int().min(0),
    edgeCount: z.number().int().min(0),
    edgeCounts: edgeCountsSchema,
    isolatedNodeCount: z.number().int().min(0),
    averageDegree: finiteNumber.min(0),
    clusterCount: z.number().int().min(0),
    similarityDistribution: similarityDistributionSchema,
    buildDurationMs: finiteNumber.min(0),
    warnings: z.array(z.string()).default([]),
  })
  .strict()
  .superRefine((report, context) => {
    const total = Object.entries(report.edgeCounts).reduce(
      (sum, [type, count]) => {
        if (!edgeTypeSet.has(type)) {
          context.addIssue({
            code: "custom",
            message: `unknown edge type in edgeCounts: ${type}`,
            path: ["edgeCounts", type],
          });
        }
        return sum + count;
      },
      0,
    );

    if (total !== report.edgeCount) {
      context.addIssue({
        code: "custom",
        message: "edgeCounts values must sum to edgeCount",
        path: ["edgeCounts"],
      });
    }
    if (report.isolatedNodeCount > report.nodeCount) {
      context.addIssue({
        code: "custom",
        message: "isolatedNodeCount must not exceed nodeCount",
        path: ["isolatedNodeCount"],
      });
    }
    if (report.clusterCount > report.nodeCount) {
      context.addIssue({
        code: "custom",
        message: "clusterCount must not exceed nodeCount",
        path: ["clusterCount"],
      });
    }
  });

export const artifactBundleSchema = z
  .object({
    graph: graphArtifactSchema,
    layouts: layoutArtifactSchema,
    manifest: graphManifestSchema,
    report: pipelineReportSchema,
  })
  .strict()
  .superRefine((bundle, context) => {
    const graphNodeIds = bundle.graph.nodes.map((node) => node.id).sort();
    const layoutNodeIds = Object.keys(bundle.layouts.layouts.semantic).sort();
    if (!sameOrdered(graphNodeIds, layoutNodeIds)) {
      context.addIssue({
        code: "custom",
        message: "layout node ids must match graph node ids",
        path: ["layouts", "layouts", "semantic"],
      });
    }
    if (bundle.manifest.nodeCount !== bundle.graph.nodes.length) {
      context.addIssue({
        code: "custom",
        message: "manifest nodeCount must match graph node count",
        path: ["manifest", "nodeCount"],
      });
    }
    if (bundle.manifest.edgeCount !== bundle.graph.edges.length) {
      context.addIssue({
        code: "custom",
        message: "manifest edgeCount must match graph edge count",
        path: ["manifest", "edgeCount"],
      });
    }
    if (bundle.report.nodeCount !== bundle.graph.nodes.length) {
      context.addIssue({
        code: "custom",
        message: "report nodeCount must match graph node count",
        path: ["report", "nodeCount"],
      });
    }
    if (bundle.report.edgeCount !== bundle.graph.edges.length) {
      context.addIssue({
        code: "custom",
        message: "report edgeCount must match graph edge count",
        path: ["report", "edgeCount"],
      });
    }
  });

export class ArtifactValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactValidationError";
  }
}

export function parseArtifactBundle(input: unknown): ArtifactBundle {
  const result = artifactBundleSchema.safeParse(input);
  if (!result.success) {
    throw new ArtifactValidationError(formatZodError(result.error));
  }
  return result.data;
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "artifact";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function sameOrdered(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export type EdgeType = z.infer<typeof edgeTypeSchema>;
export type LayoutName = z.infer<typeof layoutNameSchema>;
export type Vec3 = z.infer<typeof vec3Schema>;
export type ThoughtNode = z.infer<typeof thoughtNodeSchema>;
export type ThoughtEdge = z.infer<typeof thoughtEdgeSchema>;
export type GraphArtifact = z.infer<typeof graphArtifactSchema>;
export type LayoutArtifact = z.infer<typeof layoutArtifactSchema>;
export type GraphManifest = z.infer<typeof graphManifestSchema>;
export type PipelineReport = z.infer<typeof pipelineReportSchema>;
export type ArtifactBundle = z.infer<typeof artifactBundleSchema>;
