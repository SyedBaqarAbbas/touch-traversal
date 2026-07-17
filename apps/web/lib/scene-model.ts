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
  scale: number;
  opacity: number;
  cluster: number;
  hovered: number;
  selected: number;
  visible: number;
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
      scale: 0.018 + attributes.thought.visual.size * 0.018,
      opacity: attributes.baseOpacity,
      cluster: clusterIndex.get(attributes.clusterId) ?? 0,
      hovered: state.hoverNodeId === node ? 1 : 0,
      selected: state.selectedNodeId === node ? 1 : 0,
      visible: state.hiddenNodeIds?.has(node) ? 0 : 1,
    });
  });
  return nodes;
}

export function buildSceneEdges(
  model: GraphModel,
  layoutName: LayoutName,
  state: SceneNodeState = {},
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
        sourcePosition: sourceAttributes.layouts[layoutName],
        targetPosition: targetAttributes.layouts[layoutName],
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
