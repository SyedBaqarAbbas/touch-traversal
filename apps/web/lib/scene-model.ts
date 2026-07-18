import type { EdgeType, LayoutName, Vec3 } from "@/lib/artifacts/schema";
import type { GraphModel, ThoughtEdgeAttributes } from "@/lib/graph-model";

export const cameraModes = ["overview", "focus", "inspect"] as const;

export type CameraMode = (typeof cameraModes)[number];

export type CameraPose = {
  position: Vec3;
  target: Vec3;
  fov: number;
};

export type SceneNode = {
  id: string;
  title: string;
  position: Vec3;
  layoutPosition: Vec3;
  scale: number;
  opacity: number;
  cluster: number;
  hovered: number;
  selected: number;
  selectable: number;
  visible: number;
  focusDepth: number;
  focusRing: FocusRing;
  hitRadius: number;
  relationSector: number | null;
};

export type SceneNodeState = {
  hoverNodeId?: string | null;
  selectedNodeId?: string | null;
  hiddenNodeIds?: ReadonlySet<string>;
};

export type SceneEdge = {
  id: string;
  source: string;
  target: string;
  sourcePosition: Vec3;
  targetPosition: Vec3;
  opacity: number;
  width: number;
  type: EdgeType;
  typeBand: number;
  selected: number;
  visible: number;
};

export type SceneThoughtLabelKind = "hover" | "selected" | "neighbor";

export type SceneThoughtLabel = {
  nodeId: string;
  title: string;
  excerpt: string | null;
  kind: SceneThoughtLabelKind;
  position: Vec3;
  opacity: number;
};

export type FocusRing = "overview" | "selected" | "inner" | "outer" | "context";

export type TraversableNeighbor = {
  nodeId: string;
  edgeId: string;
  edgeType: EdgeType;
  weight: number;
  confidence: number;
  evidenceScore: number;
  relationTypeScore: number;
  score: number;
  rank: number;
  selectable: boolean;
};

export type TraversableNeighborOptions = {
  maxActiveTargets?: number;
  minimumActiveScore?: number;
};

export const MIN_ACTIVE_FOCUS_TARGETS = 5;
export const DEFAULT_MAX_ACTIVE_FOCUS_TARGETS = 8;
export const MAX_ACTIVE_FOCUS_TARGETS = 10;
export const MIN_TRAVERSABLE_NEIGHBOR_SCORE = 0.42;

const INNER_FOCUS_RING_TARGETS = 4;
const RELATION_SECTOR_COUNT = 6;

const cameraPoses: Record<CameraMode, CameraPose> = {
  overview: {
    position: [0, 0, 3.7],
    target: [0, 0, 0],
    fov: 44,
  },
  focus: {
    position: [0.16, 0.08, 2.2],
    target: [0, 0, 0],
    fov: 36,
  },
  inspect: {
    position: [0.62, 0.38, 2.85],
    target: [0.12, 0.02, 0],
    fov: 31,
  },
};

export function getCameraPose(mode: CameraMode): CameraPose {
  return cameraPoses[mode];
}

export function buildSceneNodes(
  model: GraphModel,
  layoutName: LayoutName,
  state: SceneNodeState = {},
): SceneNode[] {
  const clusters = new Set<string>();
  model.graph.forEachNode((_node, attributes) => {
    clusters.add(attributes.clusterId);
  });
  const clusterIndex = new Map(
    [...clusters].sort().map((clusterId, index) => [clusterId, index]),
  );

  const nodes: SceneNode[] = [];
  model.graph.forEachNode((node, attributes) => {
    const visible = state.hiddenNodeIds?.has(node) ? 0 : 1;
    const scale = 0.018 + attributes.thought.visual.size * 0.018;
    nodes.push({
      id: node,
      title: attributes.thought.title,
      position: attributes.layouts[layoutName],
      layoutPosition: attributes.layouts[layoutName],
      scale,
      opacity: attributes.baseOpacity,
      cluster: clusterIndex.get(attributes.clusterId) ?? 0,
      hovered: state.hoverNodeId === node ? 1 : 0,
      selected: state.selectedNodeId === node ? 1 : 0,
      selectable: visible,
      visible,
      focusDepth: Number.POSITIVE_INFINITY,
      focusRing: "overview",
      hitRadius: overviewHitRadius(scale),
      relationSector: null,
    });
  });
  return nodes;
}

export function buildFocusSceneNodes(
  model: GraphModel,
  layoutName: LayoutName,
  selectedNodeId: string | null,
  state: SceneNodeState = {},
): SceneNode[] {
  if (!selectedNodeId || !model.graph.hasNode(selectedNodeId)) {
    return buildSceneNodes(model, layoutName, state);
  }

  const rankedDepthOne = rankTraversableNeighbors(model, selectedNodeId);
  const placementsByNodeId = placeFocusNeighbors(rankedDepthOne);
  const depthOneIds = new Set(
    rankedDepthOne.map((neighbor) => neighbor.nodeId),
  );
  const depthTwoIds = new Set<string>();
  for (const neighbor of depthOneIds) {
    for (const secondHop of model.graph.neighbors(neighbor)) {
      if (secondHop !== selectedNodeId && !depthOneIds.has(secondHop)) {
        depthTwoIds.add(secondHop);
      }
    }
  }

  return buildSceneNodes(model, layoutName, {
    ...state,
    selectedNodeId,
  }).map((node) => {
    if (node.id === selectedNodeId) {
      return {
        ...node,
        position: [0, 0, 0],
        opacity: 1,
        scale: node.scale * 1.18,
        selectable: 1,
        selected: 1,
        focusDepth: 0,
        focusRing: "selected",
        hitRadius: focusTargetHitRadius(node.scale, "inner"),
        relationSector: null,
      };
    }

    const placement = placementsByNodeId.get(node.id);
    if (placement) {
      const active = placement.neighbor.selectable;
      return {
        ...node,
        position: placement.position,
        opacity: active ? Math.max(node.opacity, 0.72) : 0.26,
        selectable: active ? 1 : 0,
        visible: 1,
        focusDepth: active ? 1 : 2,
        focusRing: placement.focusRing,
        hitRadius: active
          ? focusTargetHitRadius(node.scale, placement.focusRing)
          : 0,
        relationSector: edgeTypeBand(placement.neighbor.edgeType),
      };
    }

    if (depthTwoIds.has(node.id)) {
      const depthTwoIndex = [...depthTwoIds].sort().indexOf(node.id);
      return {
        ...node,
        position: ringPosition(
          depthTwoIndex,
          depthTwoIds.size,
          0.88,
          node.layoutPosition[2] * 0.55,
        ),
        opacity: Math.min(node.opacity, 0.42),
        selectable: 0,
        focusDepth: 2,
        focusRing: "context",
        hitRadius: 0,
        relationSector: null,
      };
    }

    return {
      ...node,
      position: pushedOutPosition(node.layoutPosition),
      opacity: Math.min(node.opacity, 0.2),
      selectable: 0,
      visible: 1,
      focusDepth: 3,
      focusRing: "context",
      hitRadius: 0,
      relationSector: null,
    };
  });
}

export function selectNearbySceneNodes(
  nodes: readonly SceneNode[],
  anchorNodeId: string | null = null,
  limit = 5,
): SceneNode[] {
  const anchorPosition =
    nodes.find((node) => node.id === anchorNodeId)?.position ??
    ([0, 0, 0] as Vec3);
  const normalizedLimit = Number.isFinite(limit)
    ? Math.max(0, Math.floor(limit))
    : 0;

  return nodes
    .filter((node) => node.visible === 1 && node.selectable === 1)
    .map((node) => ({
      distanceSquared:
        (node.position[0] - anchorPosition[0]) ** 2 +
        (node.position[1] - anchorPosition[1]) ** 2 +
        (node.position[2] - anchorPosition[2]) ** 2,
      node,
    }))
    .sort(
      (left, right) =>
        left.distanceSquared - right.distanceSquared ||
        left.node.id.localeCompare(right.node.id),
    )
    .slice(0, normalizedLimit)
    .map(({ node }) => node);
}

export function rankTraversableNeighbors(
  model: GraphModel,
  selectedNodeId: string | null,
  options: TraversableNeighborOptions = {},
): TraversableNeighbor[] {
  if (!selectedNodeId || !model.graph.hasNode(selectedNodeId)) {
    return [];
  }

  const maxActiveTargets = normalizeActiveTargetLimit(options.maxActiveTargets);
  const minimumActiveScore =
    options.minimumActiveScore ?? MIN_TRAVERSABLE_NEIGHBOR_SCORE;

  const ranked = model.graph
    .neighbors(selectedNodeId)
    .flatMap((nodeId) => {
      const relation = strongestNeighborRelation(model, selectedNodeId, nodeId);
      if (!relation) {
        return [];
      }
      return [
        {
          ...relation,
          nodeId,
        },
      ];
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.weight - left.weight ||
        right.confidence - left.confidence ||
        left.nodeId.localeCompare(right.nodeId),
    );

  return ranked.map((neighbor, index) => ({
    ...neighbor,
    rank: index + 1,
    selectable:
      index < maxActiveTargets && neighbor.score >= minimumActiveScore,
  }));
}

export function buildSceneEdges(
  model: GraphModel,
  layoutName: LayoutName,
  state: SceneNodeState = {},
  positionsByNodeId: ReadonlyMap<string, Vec3> | null = null,
): SceneEdge[] {
  const edges: SceneEdge[] = [];
  const focusNeighbors =
    state.selectedNodeId && model.graph.hasNode(state.selectedNodeId)
      ? new Map(
          rankTraversableNeighbors(model, state.selectedNodeId).map(
            (neighbor) => [neighbor.nodeId, neighbor],
          ),
        )
      : null;
  model.graph.forEachEdge(
    (edge, attributes, source, target, sourceAttributes, targetAttributes) => {
      const sourceSelected = source === state.selectedNodeId;
      const targetSelected = target === state.selectedNodeId;
      const sourceHovered = source === state.hoverNodeId;
      const targetHovered = target === state.hoverNodeId;
      const selectedNeighborId = sourceSelected
        ? target
        : targetSelected
          ? source
          : null;
      const focusNeighbor = selectedNeighborId
        ? focusNeighbors?.get(selectedNeighborId)
        : null;
      const contextNeighbor =
        focusNeighbor != null && focusNeighbor.selectable === false;
      const selected =
        focusNeighbor != null
          ? focusNeighbor.selectable
          : sourceSelected || targetSelected;
      const hovered = sourceHovered || targetHovered;
      const unrelated =
        Boolean(state.selectedNodeId) && !selected && !contextNeighbor;
      const strongEnough =
        selected ||
        contextNeighbor ||
        attributes.weight >= 0.5 ||
        attributes.confidence >= 0.7;
      const hidden =
        state.hiddenNodeIds?.has(source) === true ||
        state.hiddenNodeIds?.has(target) === true ||
        !strongEnough;

      edges.push({
        id: edge,
        source,
        target,
        sourcePosition:
          positionsByNodeId?.get(source) ??
          sourceAttributes.layouts[layoutName],
        targetPosition:
          positionsByNodeId?.get(target) ??
          targetAttributes.layouts[layoutName],
        opacity: edgeOpacity(attributes.type, attributes.weight, {
          context: contextNeighbor,
          hovered,
          selected,
          unrelated,
        }),
        width: edgeWidth(attributes.type, attributes.weight, selected),
        type: attributes.type,
        typeBand: edgeTypeBand(attributes.type),
        selected: selected ? 1 : 0,
        visible: hidden ? 0 : 1,
      });
    },
  );
  return edges;
}

export function buildSceneThoughtLabels(
  model: GraphModel,
  nodes: readonly SceneNode[],
  state: Pick<SceneNodeState, "hoverNodeId" | "selectedNodeId"> = {},
): SceneThoughtLabel[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const labels: SceneThoughtLabel[] = [];

  const selectedNodeId = state.selectedNodeId;
  if (selectedNodeId && model.graph.hasNode(selectedNodeId)) {
    const node = nodesById.get(selectedNodeId);
    if (node) {
      const thought = model.graph.getNodeAttributes(selectedNodeId).thought;
      labels.push({
        nodeId: selectedNodeId,
        title: thought.title,
        excerpt: thought.summary,
        kind: "selected",
        position: node.position,
        opacity: 0.96,
      });
    }

    const neighborIds = rankTraversableNeighbors(model, selectedNodeId)
      .filter((neighbor) => neighbor.selectable)
      .map((neighbor) => neighbor.nodeId);

    for (const neighborId of neighborIds) {
      if (neighborId === state.hoverNodeId) {
        continue;
      }
      const node = nodesById.get(neighborId);
      if (!node) {
        continue;
      }
      labels.push({
        nodeId: neighborId,
        title: model.graph.getNodeAttributes(neighborId).thought.title,
        excerpt: null,
        kind: "neighbor",
        position: node.position,
        opacity: 0.34,
      });
    }
  }

  if (
    state.hoverNodeId &&
    state.hoverNodeId !== state.selectedNodeId &&
    model.graph.hasNode(state.hoverNodeId)
  ) {
    const node = nodesById.get(state.hoverNodeId);
    if (node) {
      labels.push({
        nodeId: state.hoverNodeId,
        title: model.graph.getNodeAttributes(state.hoverNodeId).thought.title,
        excerpt: null,
        kind: "hover",
        position: node.position,
        opacity: 0.92,
      });
    }
  }

  return labels;
}

function strongestNeighborRelation(
  model: GraphModel,
  source: string,
  target: string,
): Omit<TraversableNeighbor, "nodeId" | "rank" | "selectable"> | null {
  let strongest: Omit<
    TraversableNeighbor,
    "nodeId" | "rank" | "selectable"
  > | null = null;
  model.graph.forEachEdge((edge, attributes, edgeSource, edgeTarget) => {
    if (
      (edgeSource === source && edgeTarget === target) ||
      (edgeSource === target && edgeTarget === source)
    ) {
      const evidenceScore = edgeEvidenceScore(attributes.relation);
      const relationTypeScore = edgeRelationTypeScore(attributes.type);
      const score = neighborScore({
        confidence: attributes.confidence,
        evidenceScore,
        relationTypeScore,
        weight: attributes.weight,
      });
      if (!strongest || score > strongest.score) {
        strongest = {
          confidence: attributes.confidence,
          edgeId: edge,
          edgeType: attributes.type,
          evidenceScore,
          relationTypeScore,
          score,
          weight: attributes.weight,
        };
      }
    }
  });
  return strongest;
}

type FocusNeighborPlacement = {
  focusRing: FocusRing;
  neighbor: TraversableNeighbor;
  position: Vec3;
};

function placeFocusNeighbors(
  neighbors: readonly TraversableNeighbor[],
): Map<string, FocusNeighborPlacement> {
  const placements = new Map<string, FocusNeighborPlacement>();
  const activeNeighbors = neighbors.filter((neighbor) => neighbor.selectable);
  const innerCount = Math.min(
    INNER_FOCUS_RING_TARGETS,
    Math.ceil(activeNeighbors.length * 0.5),
  );
  const ringByNodeId = new Map<string, FocusRing>();

  activeNeighbors.forEach((neighbor, index) => {
    ringByNodeId.set(neighbor.nodeId, index < innerCount ? "inner" : "outer");
  });
  for (const neighbor of neighbors) {
    if (!neighbor.selectable) {
      ringByNodeId.set(neighbor.nodeId, "context");
    }
  }

  const totalsByRingAndType = countRingAndType(neighbors, ringByNodeId);
  const indexesByRingAndType = new Map<string, number>();
  for (const neighbor of neighbors) {
    const focusRing = ringByNodeId.get(neighbor.nodeId);
    if (!focusRing) {
      continue;
    }
    const key = ringTypeKey(focusRing, neighbor.edgeType);
    const index = indexesByRingAndType.get(key) ?? 0;
    const count = totalsByRingAndType.get(key) ?? 1;
    indexesByRingAndType.set(key, index + 1);
    placements.set(neighbor.nodeId, {
      focusRing,
      neighbor,
      position: relationSectorPosition(
        neighbor.edgeType,
        index,
        count,
        focusRingRadius(focusRing),
      ),
    });
  }

  return placements;
}

function countRingAndType(
  neighbors: readonly TraversableNeighbor[],
  ringByNodeId: ReadonlyMap<string, FocusRing>,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const neighbor of neighbors) {
    const ring = ringByNodeId.get(neighbor.nodeId);
    if (!ring) {
      continue;
    }
    const key = ringTypeKey(ring, neighbor.edgeType);
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  return totals;
}

function ringTypeKey(ring: FocusRing, type: EdgeType): string {
  return `${ring}:${type}`;
}

function relationSectorPosition(
  type: EdgeType,
  index: number,
  count: number,
  radius: number,
): Vec3 {
  const sector = edgeTypeBand(type);
  const sectorWidth = (Math.PI * 2) / RELATION_SECTOR_COUNT;
  const sectorCenter = -Math.PI / 2 + sector * sectorWidth;
  const spread = sectorWidth * 0.52;
  const offset = count <= 1 ? 0 : (index / (count - 1) - 0.5) * spread;
  const angle = sectorCenter + offset;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius, 0.02 * sector];
}

function focusRingRadius(ring: FocusRing): number {
  if (ring === "inner") {
    return 0.46;
  }
  if (ring === "outer") {
    return 0.72;
  }
  return 0.96;
}

function overviewHitRadius(scale: number): number {
  return Math.max(0.11, scale * 3.4);
}

function focusTargetHitRadius(scale: number, ring: FocusRing): number {
  const multiplier = ring === "inner" ? 4.9 : 4.4;
  return Math.max(ring === "inner" ? 0.16 : 0.145, scale * multiplier);
}

function normalizeActiveTargetLimit(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) {
    return DEFAULT_MAX_ACTIVE_FOCUS_TARGETS;
  }
  return Math.min(
    MAX_ACTIVE_FOCUS_TARGETS,
    Math.max(MIN_ACTIVE_FOCUS_TARGETS, Math.floor(value)),
  );
}

function neighborScore(input: {
  weight: number;
  confidence: number;
  evidenceScore: number;
  relationTypeScore: number;
}): number {
  return clamp(
    input.weight * 0.45 +
      input.confidence * 0.25 +
      input.evidenceScore * 0.2 +
      input.relationTypeScore * 0.1,
    0,
    1,
  );
}

function edgeEvidenceScore(
  relation: ThoughtEdgeAttributes["relation"],
): number {
  const evidence = relation.evidence;
  const descriptionScore = evidence.description.trim().length > 0 ? 0.12 : 0;
  const termScore = Math.min(0.3, evidence.sharedTerms.length * 0.075);
  const entityScore = Math.min(0.28, evidence.sharedEntities.length * 0.1);
  const similarityScore =
    typeof evidence.similarity === "number" ? evidence.similarity * 0.22 : 0;
  const temporalScore =
    typeof evidence.timeDistanceDays === "number"
      ? Math.max(0, 1 - Math.min(evidence.timeDistanceDays, 30) / 30) * 0.16
      : 0;
  return clamp(
    descriptionScore +
      termScore +
      entityScore +
      similarityScore +
      temporalScore,
    0,
    1,
  );
}

function edgeRelationTypeScore(type: EdgeType): number {
  const values: Record<EdgeType, number> = {
    manual: 1,
    explicit: 0.95,
    semantic: 0.78,
    entity: 0.68,
    temporal: 0.54,
    structural: 0.35,
  };
  return values[type];
}

function ringPosition(
  index: number,
  count: number,
  radius: number,
  z: number,
): Vec3 {
  const safeCount = Math.max(1, count);
  const angle = -Math.PI / 2 + (index / safeCount) * Math.PI * 2;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius, z * 0.4];
}

function pushedOutPosition(position: Vec3): Vec3 {
  const length = Math.hypot(position[0], position[1]) || 1;
  return [
    (position[0] / length) * 1.28,
    (position[1] / length) * 1.28,
    position[2] * 0.25,
  ];
}

function edgeOpacity(
  type: EdgeType,
  weight: number,
  state: {
    context: boolean;
    hovered: boolean;
    selected: boolean;
    unrelated: boolean;
  },
): number {
  const base = clamp(edgeTypeBaseOpacity(type) + weight * 0.06, 0.04, 0.2);
  if (state.selected) {
    return clamp(0.55 + weight * 0.36, 0.55, 0.95);
  }
  if (state.hovered) {
    return clamp(0.28 + weight * 0.18, 0.28, 0.5);
  }
  if (state.context) {
    return clamp(0.1 + weight * 0.18, 0.1, 0.28);
  }
  if (state.unrelated) {
    return clamp(base * 0.18, 0.01, 0.04);
  }
  return base;
}

function edgeWidth(type: EdgeType, weight: number, selected: boolean): number {
  const base = edgeTypeWidth(type) + weight * 0.0012;
  return selected ? base * 2.2 : base;
}

function edgeTypeBaseOpacity(type: EdgeType): number {
  const values: Record<EdgeType, number> = {
    explicit: 0.12,
    structural: 0.04,
    semantic: 0.09,
    temporal: 0.06,
    entity: 0.08,
    manual: 0.14,
  };
  return values[type];
}

function edgeTypeWidth(type: EdgeType): number {
  const values: Record<EdgeType, number> = {
    explicit: 0.0032,
    structural: 0.0017,
    semantic: 0.0026,
    temporal: 0.0021,
    entity: 0.0024,
    manual: 0.0036,
  };
  return values[type];
}

function edgeTypeBand(type: EdgeType): number {
  const values: Record<EdgeType, number> = {
    explicit: 0,
    structural: 1,
    semantic: 2,
    temporal: 3,
    entity: 4,
    manual: 0,
  };
  return values[type];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
