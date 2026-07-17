import type { EdgeType, LayoutName, Vec3 } from "@/lib/artifacts/schema";
import type { GraphModel } from "@/lib/graph-model";

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
  visible: number;
  focusDepth: number;
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
    nodes.push({
      id: node,
      title: attributes.thought.title,
      position: attributes.layouts[layoutName],
      layoutPosition: attributes.layouts[layoutName],
      scale: 0.018 + attributes.thought.visual.size * 0.018,
      opacity: attributes.baseOpacity,
      cluster: clusterIndex.get(attributes.clusterId) ?? 0,
      hovered: state.hoverNodeId === node ? 1 : 0,
      selected: state.selectedNodeId === node ? 1 : 0,
      visible: state.hiddenNodeIds?.has(node) ? 0 : 1,
      focusDepth: Number.POSITIVE_INFINITY,
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

  const rankedDepthOne = model.graph
    .neighbors(selectedNodeId)
    .map((nodeId) => ({
      nodeId,
      weight: strongestEdgeWeight(model, selectedNodeId, nodeId),
    }))
    .sort(
      (left, right) =>
        right.weight - left.weight || left.nodeId.localeCompare(right.nodeId),
    );
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
        selected: 1,
        focusDepth: 0,
      };
    }

    const depthOneIndex = rankedDepthOne.findIndex(
      (neighbor) => neighbor.nodeId === node.id,
    );
    if (depthOneIndex >= 0) {
      return {
        ...node,
        position: ringPosition(
          depthOneIndex,
          rankedDepthOne.length,
          0.48,
          node.layoutPosition[2],
        ),
        opacity: Math.max(node.opacity, 0.72),
        focusDepth: 1,
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
        focusDepth: 2,
      };
    }

    return {
      ...node,
      position: pushedOutPosition(node.layoutPosition),
      opacity: Math.min(node.opacity, 0.2),
      visible: 1,
      focusDepth: 3,
    };
  });
}

export function buildSceneEdges(
  model: GraphModel,
  layoutName: LayoutName,
  state: SceneNodeState = {},
  positionsByNodeId: ReadonlyMap<string, Vec3> | null = null,
): SceneEdge[] {
  const edges: SceneEdge[] = [];
  model.graph.forEachEdge(
    (edge, attributes, source, target, sourceAttributes, targetAttributes) => {
      const sourceSelected = source === state.selectedNodeId;
      const targetSelected = target === state.selectedNodeId;
      const sourceHovered = source === state.hoverNodeId;
      const targetHovered = target === state.hoverNodeId;
      const selected = sourceSelected || targetSelected;
      const hovered = sourceHovered || targetHovered;
      const unrelated = Boolean(state.selectedNodeId) && !selected;
      const strongEnough =
        attributes.weight >= 0.5 || attributes.confidence >= 0.7;
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

    const neighborIds = [...model.graph.neighbors(selectedNodeId)].sort(
      (left, right) =>
        strongestEdgeWeight(model, selectedNodeId, right) -
          strongestEdgeWeight(model, selectedNodeId, left) ||
        left.localeCompare(right),
    );

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

function strongestEdgeWeight(
  model: GraphModel,
  source: string,
  target: string,
): number {
  let strongest = 0;
  model.graph.forEachEdge((_edge, attributes, edgeSource, edgeTarget) => {
    if (
      (edgeSource === source && edgeTarget === target) ||
      (edgeSource === target && edgeTarget === source)
    ) {
      strongest = Math.max(strongest, attributes.weight);
    }
  });
  return strongest;
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
  state: { hovered: boolean; selected: boolean; unrelated: boolean },
): number {
  const base = clamp(edgeTypeBaseOpacity(type) + weight * 0.06, 0.04, 0.2);
  if (state.selected) {
    return clamp(0.55 + weight * 0.36, 0.55, 0.95);
  }
  if (state.hovered) {
    return clamp(0.28 + weight * 0.18, 0.28, 0.5);
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
