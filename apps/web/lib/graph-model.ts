import Graph from "graphology";

import type {
  ArtifactBundle,
  EdgeType,
  GraphManifest,
  LayoutName,
  PipelineReport,
  ThoughtEdge,
  ThoughtNode,
  Vec3,
} from "@/lib/artifacts/schema";
import { layoutNames } from "@/lib/artifacts/schema";

export type ThoughtNodeAttributes = {
  thought: ThoughtNode;
  layouts: Record<LayoutName, Vec3>;
  clusterId: string;
  importance: number;
  baseOpacity: number;
};

export type ThoughtEdgeAttributes = {
  relation: ThoughtEdge;
  type: EdgeType;
  weight: number;
  confidence: number;
  opacity: number;
  width: number;
};

export type ThoughtGraph = Graph<ThoughtNodeAttributes, ThoughtEdgeAttributes>;

export type TemporalAvailability = {
  available: boolean;
  datedNodeCount: number;
  requiredNodeCount: number;
  reason: string | null;
};

export type GraphModel = {
  graph: ThoughtGraph;
  manifest: GraphManifest;
  report: PipelineReport;
  temporal: TemporalAvailability;
};

export type NodeSummary = {
  id: string;
  title: string;
  summary: string;
  clusterId: string;
  degree: number;
  importance: number;
};

export type EdgeSummary = {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  weight: number;
  directed: boolean;
};

export type PositionedNode = NodeSummary & {
  position: Vec3;
};

export function buildGraphModel(bundle: ArtifactBundle): GraphModel {
  const graph = new Graph<ThoughtNodeAttributes, ThoughtEdgeAttributes>({
    allowSelfLoops: false,
    multi: false,
    type: "mixed",
  });

  for (const node of bundle.graph.nodes) {
    graph.addNode(node.id, {
      thought: node,
      layouts: {
        semantic: bundle.layouts.layouts.semantic[node.id],
        clusters: bundle.layouts.layouts.clusters[node.id],
        temporal: bundle.layouts.layouts.temporal[node.id],
        force: bundle.layouts.layouts.force[node.id],
      },
      clusterId: node.visual.clusterId,
      importance: node.metadata.importance,
      baseOpacity: node.visual.baseOpacity,
    });
  }

  for (const edge of bundle.graph.edges) {
    const attributes: ThoughtEdgeAttributes = {
      relation: edge,
      type: edge.type,
      weight: edge.weight,
      confidence: edge.confidence,
      opacity: edge.visual.opacity,
      width: edge.visual.width,
    };
    if (edge.directed) {
      graph.addDirectedEdgeWithKey(
        edge.id,
        edge.source,
        edge.target,
        attributes,
      );
    } else {
      graph.addUndirectedEdgeWithKey(
        edge.id,
        edge.source,
        edge.target,
        attributes,
      );
    }
  }

  return {
    graph,
    manifest: bundle.manifest,
    report: bundle.report,
    temporal: inspectTemporalAvailability(bundle.graph.nodes),
  };
}

export function selectNodeSummaries(model: GraphModel): NodeSummary[] {
  const summaries: NodeSummary[] = [];
  model.graph.forEachNode((node, attributes) => {
    summaries.push({
      id: node,
      title: attributes.thought.title,
      summary: attributes.thought.summary,
      clusterId: attributes.clusterId,
      degree: model.graph.degree(node),
      importance: attributes.importance,
    });
  });
  return summaries;
}

export function selectEdgeSummaries(model: GraphModel): EdgeSummary[] {
  const summaries: EdgeSummary[] = [];
  model.graph.forEachEdge(
    (
      edge,
      attributes,
      source,
      target,
      _sourceAttributes,
      _targetAttributes,
      undirected,
    ) => {
      summaries.push({
        id: edge,
        source,
        target,
        type: attributes.type,
        weight: attributes.weight,
        directed: !undirected,
      });
    },
  );
  return summaries;
}

export function selectLayoutPositions(
  model: GraphModel,
  layoutName: LayoutName,
): PositionedNode[] {
  return selectNodeSummaries(model).map((summary) => ({
    ...summary,
    position: model.graph.getNodeAttributes(summary.id).layouts[layoutName],
  }));
}

export function getAvailableLayoutNames(model: GraphModel): LayoutName[] {
  if (model.temporal.available) {
    return [...layoutNames];
  }
  return layoutNames.filter((layoutName) => layoutName !== "temporal");
}

function inspectTemporalAvailability(
  nodes: ThoughtNode[],
): TemporalAvailability {
  const datedNodeCount = nodes.filter(
    (node) =>
      node.metadata.createdAt != null || node.metadata.modifiedAt != null,
  ).length;
  const requiredNodeCount = Math.min(2, nodes.length);
  const available = nodes.length === 0 || datedNodeCount >= requiredNodeCount;
  return {
    available,
    datedNodeCount,
    requiredNodeCount,
    reason: available
      ? null
      : `Temporal topology needs at least ${requiredNodeCount} dated nodes; found ${datedNodeCount}.`,
  };
}
