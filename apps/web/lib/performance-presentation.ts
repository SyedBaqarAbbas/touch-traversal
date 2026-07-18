import type { SceneQuality } from "@/lib/performance-policy";

export const performanceEmphasisModes = ["balanced", "graph", "video"] as const;

export type PerformanceEmphasis = (typeof performanceEmphasisModes)[number];

export type PerformancePresentationState = {
  emphasis: PerformanceEmphasis;
  framingRevision: number;
  layerVisible: boolean;
  mirrored: boolean;
};

export type PerformancePresentationAction =
  | { type: "TOGGLE_LAYER" }
  | { type: "CYCLE_EMPHASIS" }
  | { type: "TOGGLE_MIRROR" }
  | { type: "RESET_FRAMING" };

export type PerformanceCompositionPolicy = {
  targetInferenceFps: number;
  videoOpacity: number;
};

export const initialPerformancePresentationState: PerformancePresentationState =
  {
    emphasis: "balanced",
    framingRevision: 0,
    layerVisible: true,
    mirrored: true,
  };

export function reducePerformancePresentation(
  state: PerformancePresentationState,
  action: PerformancePresentationAction,
): PerformancePresentationState {
  switch (action.type) {
    case "TOGGLE_LAYER":
      return { ...state, layerVisible: !state.layerVisible };
    case "CYCLE_EMPHASIS": {
      const index = performanceEmphasisModes.indexOf(state.emphasis);
      return {
        ...state,
        emphasis:
          performanceEmphasisModes[
            (index + 1) % performanceEmphasisModes.length
          ]!,
      };
    }
    case "TOGGLE_MIRROR":
      return { ...state, mirrored: !state.mirrored };
    case "RESET_FRAMING":
      return { ...state, framingRevision: state.framingRevision + 1 };
  }
}

export function performanceCompositionPolicy(
  quality: SceneQuality["name"],
  emphasis: PerformanceEmphasis,
): PerformanceCompositionPolicy {
  const opacityByEmphasis = {
    balanced: 0.68,
    graph: 0.46,
    video: 0.82,
  } as const;

  switch (quality) {
    case "high":
      return {
        targetInferenceFps: 24,
        videoOpacity: opacityByEmphasis[emphasis],
      };
    case "medium":
      return {
        targetInferenceFps: 20,
        videoOpacity: Math.min(opacityByEmphasis[emphasis], 0.64),
      };
    case "low":
      return {
        targetInferenceFps: 15,
        videoOpacity: Math.min(opacityByEmphasis[emphasis], 0.5),
      };
  }
}
