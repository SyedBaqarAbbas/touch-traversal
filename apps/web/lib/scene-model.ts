import type { LayoutName, Vec3 } from "@/lib/artifacts/schema";
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
