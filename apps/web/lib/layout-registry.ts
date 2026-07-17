import {
  layoutNames,
  type LayoutName,
  type Vec3,
} from "@/lib/artifacts/schema";
import type { GraphModel } from "@/lib/graph-model";

export class LayoutRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayoutRegistryError";
  }
}

export type LayoutRegistry = {
  activeLayoutName: LayoutName;
  currentPositions: Float32Array;
  indexByNodeId: ReadonlyMap<string, number>;
  layoutNames: readonly LayoutName[];
  layouts: Readonly<Record<LayoutName, Float32Array>>;
  nodeIds: readonly string[];
  startPositions: Float32Array;
  targetLayoutName: LayoutName;
  targetPositions: Float32Array;
};

export function createLayoutRegistry(
  model: GraphModel,
  initialLayoutName: LayoutName = "semantic",
): LayoutRegistry {
  const nodeIds: string[] = [];
  model.graph.forEachNode((nodeId) => nodeIds.push(nodeId));
  const indexByNodeId = new Map(
    nodeIds.map((nodeId, index) => [nodeId, index] as const),
  );
  const layouts = Object.fromEntries(
    layoutNames.map((layoutName) => [
      layoutName,
      buildLayoutBuffer(model, nodeIds, layoutName),
    ]),
  ) as Record<LayoutName, Float32Array>;

  const initial = layouts[initialLayoutName];
  if (!initial) {
    throw new LayoutRegistryError(
      `Unknown initial layout: ${initialLayoutName}`,
    );
  }

  return {
    activeLayoutName: initialLayoutName,
    currentPositions: initial.slice(),
    indexByNodeId,
    layoutNames,
    layouts,
    nodeIds,
    startPositions: initial.slice(),
    targetLayoutName: initialLayoutName,
    targetPositions: initial.slice(),
  };
}

export function startLayoutTransition(
  registry: LayoutRegistry,
  targetLayoutName: LayoutName,
) {
  const target = registry.layouts[targetLayoutName];
  if (!target) {
    throw new LayoutRegistryError(`Unknown target layout: ${targetLayoutName}`);
  }

  registry.startPositions.set(registry.currentPositions);
  registry.targetPositions.set(target);
  registry.targetLayoutName = targetLayoutName;
}

export function updateLayoutProgress(
  registry: LayoutRegistry,
  progress: number,
) {
  const eased = clamp(progress, 0, 1);
  for (let index = 0; index < registry.currentPositions.length; index += 1) {
    registry.currentPositions[index] =
      registry.startPositions[index] +
      (registry.targetPositions[index] - registry.startPositions[index]) *
        eased;
  }

  if (eased === 1) {
    registry.activeLayoutName = registry.targetLayoutName;
  }
}

export function readLayoutPosition(
  registry: LayoutRegistry,
  nodeId: string,
): Vec3 {
  const nodeIndex = registry.indexByNodeId.get(nodeId);
  if (nodeIndex == null) {
    throw new LayoutRegistryError(`Unknown node id: ${nodeId}`);
  }

  const offset = nodeIndex * 3;
  return [
    registry.currentPositions[offset],
    registry.currentPositions[offset + 1],
    registry.currentPositions[offset + 2],
  ];
}

function buildLayoutBuffer(
  model: GraphModel,
  nodeIds: readonly string[],
  layoutName: LayoutName,
): Float32Array {
  const positions = new Float32Array(nodeIds.length * 3);
  for (const [index, nodeId] of nodeIds.entries()) {
    const attributes = model.graph.getNodeAttributes(nodeId);
    const position = attributes.layouts[layoutName];
    if (!position) {
      throw new LayoutRegistryError(
        `Layout "${layoutName}" is missing node "${nodeId}"`,
      );
    }
    positions.set(position, index * 3);
  }
  return positions;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
