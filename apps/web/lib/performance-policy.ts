export type ScenePerformanceScenario = {
  id: string;
  mode: "overview" | "focus";
  nodeCount: number;
  edgeCount: number;
};

export type SceneQuality = {
  name: "high" | "medium" | "low";
  dpr: [number, number];
  maxVisibleEdges: number;
  maxThoughtLabels: number;
};

export const scenePerformanceScenarios: ScenePerformanceScenario[] = [
  { id: "overview-100-400", mode: "overview", nodeCount: 100, edgeCount: 400 },
  { id: "focus-100-400", mode: "focus", nodeCount: 100, edgeCount: 400 },
  {
    id: "overview-300-1500",
    mode: "overview",
    nodeCount: 300,
    edgeCount: 1500,
  },
  { id: "focus-300-1500", mode: "focus", nodeCount: 300, edgeCount: 1500 },
];

export function chooseSceneQuality(input: {
  edgeCount: number;
  measuredFps?: number;
  nodeCount: number;
}): SceneQuality {
  if (
    (input.measuredFps != null && input.measuredFps < 45) ||
    input.edgeCount > 1200 ||
    input.nodeCount > 260
  ) {
    return {
      name: "low",
      dpr: [1, 1.15],
      maxThoughtLabels: 3,
      maxVisibleEdges: 900,
    };
  }

  if (
    (input.measuredFps != null && input.measuredFps < 58) ||
    input.edgeCount > 700 ||
    input.nodeCount > 160
  ) {
    return {
      name: "medium",
      dpr: [1, 1.4],
      maxThoughtLabels: 4,
      maxVisibleEdges: 1200,
    };
  }

  return {
    name: "high",
    dpr: [1, 1.75],
    maxThoughtLabels: 5,
    maxVisibleEdges: Number.POSITIVE_INFINITY,
  };
}

export function limitVisibleItems<T extends { id: string; visible: number }>(
  items: readonly T[],
  maximumVisible: number,
): T[] {
  if (!Number.isFinite(maximumVisible) || items.length <= maximumVisible) {
    return [...items];
  }

  const visibleIds = new Set(
    items.slice(0, maximumVisible).map((item) => item.id),
  );
  return items.map((item) =>
    visibleIds.has(item.id)
      ? item
      : {
          ...item,
          visible: 0,
        },
  );
}

export function limitThoughtLabels<
  T extends { kind: "hover" | "selected" | "neighbor"; nodeId: string },
>(labels: readonly T[], maximumVisible: number): T[] {
  if (labels.length <= maximumVisible) {
    return [...labels];
  }

  const priority = { selected: 0, hover: 1, neighbor: 2 } as const;
  return [...labels]
    .sort(
      (left, right) =>
        priority[left.kind] - priority[right.kind] ||
        left.nodeId.localeCompare(right.nodeId),
    )
    .slice(0, maximumVisible);
}

export function summarizeFrameDurations(frameDurationsMs: readonly number[]) {
  const sorted = [...frameDurationsMs].sort((left, right) => left - right);
  const averageFrameMs =
    frameDurationsMs.reduce((sum, value) => sum + value, 0) /
    Math.max(1, frameDurationsMs.length);
  const p95FrameMs = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  return {
    averageFps: Math.round((1000 / averageFrameMs) * 10) / 10,
    averageFrameMs: Math.round(averageFrameMs * 10) / 10,
    minimumFps: Math.round((1000 / Math.max(...sorted, 1)) * 10) / 10,
    p95FrameMs: Math.round(p95FrameMs * 10) / 10,
  };
}
