import type { LayoutName, Vec3 } from "@/lib/artifacts/schema";
import {
  type LayoutRegistry,
  readLayoutPosition,
  startLayoutTransition,
  updateLayoutProgress,
} from "@/lib/layout-registry";

export const DEFAULT_LAYOUT_MORPH_DURATION_MS = 2200;

export type LayoutMorphState =
  | {
      mode: "idle";
      activeLayoutName: LayoutName;
      targetLayoutName: LayoutName;
    }
  | {
      mode: "morphing";
      activeLayoutName: LayoutName;
      durationMs: number;
      startedAtMs: number;
      targetLayoutName: LayoutName;
    };

export type EdgeEndpoints = {
  id: string;
  source: string;
  sourcePosition: Vec3;
  target: string;
  targetPosition: Vec3;
};

export function createIdleLayoutMorph(
  registry: LayoutRegistry,
): LayoutMorphState {
  return {
    mode: "idle",
    activeLayoutName: registry.activeLayoutName,
    targetLayoutName: registry.targetLayoutName,
  };
}

export function startLayoutMorph(
  registry: LayoutRegistry,
  targetLayoutName: LayoutName,
  timestampMs: number,
  durationMs = DEFAULT_LAYOUT_MORPH_DURATION_MS,
): LayoutMorphState {
  startLayoutTransition(registry, targetLayoutName);
  return {
    mode: "morphing",
    activeLayoutName: registry.activeLayoutName,
    durationMs,
    startedAtMs: timestampMs,
    targetLayoutName,
  };
}

export function updateLayoutMorph(
  registry: LayoutRegistry,
  morph: LayoutMorphState,
  timestampMs: number,
): LayoutMorphState {
  if (morph.mode === "idle") {
    return morph;
  }

  const linearProgress = clamp(
    (timestampMs - morph.startedAtMs) / morph.durationMs,
    0,
    1,
  );
  const easedProgress = easeInOutCubic(linearProgress);
  updateLayoutProgress(registry, easedProgress);

  if (linearProgress < 1) {
    return morph;
  }

  registry.currentPositions.set(registry.targetPositions);
  registry.activeLayoutName = morph.targetLayoutName;
  return {
    mode: "idle",
    activeLayoutName: morph.targetLayoutName,
    targetLayoutName: morph.targetLayoutName,
  };
}

export function buildRegistryPositionMap(
  registry: LayoutRegistry,
): ReadonlyMap<string, Vec3> {
  return new Map(
    registry.nodeIds.map((nodeId) => [
      nodeId,
      readLayoutPosition(registry, nodeId),
    ]),
  );
}

export function buildEdgeEndpointsFromRegistry(
  registry: LayoutRegistry,
  edges: readonly { id: string; source: string; target: string }[],
): EdgeEndpoints[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourcePosition: readLayoutPosition(registry, edge.source),
    target: edge.target,
    targetPosition: readLayoutPosition(registry, edge.target),
  }));
}

export function edgeEndpointBufferFromRegistry(
  registry: LayoutRegistry,
  edges: readonly { source: string; target: string }[],
): Float32Array {
  const endpoints = new Float32Array(edges.length * 6);
  edges.forEach((edge, index) => {
    const source = readLayoutPosition(registry, edge.source);
    const target = readLayoutPosition(registry, edge.target);
    const offset = index * 6;
    endpoints.set(source, offset);
    endpoints.set(target, offset + 3);
  });
  return endpoints;
}

export function easeInOutCubic(progress: number): number {
  const clamped = clamp(progress, 0, 1);
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
