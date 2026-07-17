import type { CameraMode } from "@/lib/scene-model";

export const interactionModes = [
  "IDLE",
  "HOVERING",
  "FOCUSING",
  "FOCUSED",
  "TRAVERSING",
  "MORPHING",
  "CALIBRATING",
] as const;

export type InteractionMode = (typeof interactionModes)[number];

export type InteractionState = {
  mode: InteractionMode;
  hoveredNodeId: string | null;
  selectedNodeId: string | null;
  previousCameraMode: CameraMode;
  startedAtMs: number;
};

export type InteractionEvent =
  | { type: "HOVER_START"; nodeId: string; timestampMs: number }
  | { type: "HOVER_END"; timestampMs: number }
  | { type: "SELECT_NODE"; nodeId: string; timestampMs: number }
  | { type: "FOCUS_COMPLETE"; timestampMs: number }
  | { type: "RETURN_OVERVIEW"; timestampMs: number }
  | { type: "START_TRAVERSAL"; nodeId: string; timestampMs: number }
  | { type: "START_MORPH"; timestampMs: number }
  | { type: "START_CALIBRATION"; timestampMs: number };

export function createInteractionState(timestampMs = 0): InteractionState {
  return {
    mode: "IDLE",
    hoveredNodeId: null,
    selectedNodeId: null,
    previousCameraMode: "overview",
    startedAtMs: timestampMs,
  };
}

export function reduceInteraction(
  state: InteractionState,
  event: InteractionEvent,
): InteractionState {
  switch (event.type) {
    case "HOVER_START":
      if (state.selectedNodeId) {
        return { ...state, hoveredNodeId: event.nodeId };
      }
      return {
        ...state,
        mode: "HOVERING",
        hoveredNodeId: event.nodeId,
        startedAtMs: event.timestampMs,
      };
    case "HOVER_END":
      return {
        ...state,
        mode: state.selectedNodeId ? state.mode : "IDLE",
        hoveredNodeId: null,
        startedAtMs: event.timestampMs,
      };
    case "SELECT_NODE":
      return {
        mode: "FOCUSING",
        hoveredNodeId: event.nodeId,
        selectedNodeId: event.nodeId,
        previousCameraMode: state.previousCameraMode,
        startedAtMs: event.timestampMs,
      };
    case "FOCUS_COMPLETE":
      if (
        !state.selectedNodeId ||
        (state.mode !== "FOCUSING" && state.mode !== "TRAVERSING")
      ) {
        return state;
      }
      return {
        ...state,
        mode: "FOCUSED",
        startedAtMs: event.timestampMs,
      };
    case "RETURN_OVERVIEW":
      return {
        mode: "IDLE",
        hoveredNodeId: null,
        selectedNodeId: null,
        previousCameraMode: state.previousCameraMode,
        startedAtMs: event.timestampMs,
      };
    case "START_TRAVERSAL":
      return {
        ...state,
        mode: "TRAVERSING",
        selectedNodeId: event.nodeId,
        hoveredNodeId: event.nodeId,
        startedAtMs: event.timestampMs,
      };
    case "START_MORPH":
      return {
        ...state,
        mode: "MORPHING",
        startedAtMs: event.timestampMs,
      };
    case "START_CALIBRATION":
      return {
        ...state,
        mode: "CALIBRATING",
        startedAtMs: event.timestampMs,
      };
  }
}

export function cameraModeForInteraction(state: InteractionState): CameraMode {
  return state.selectedNodeId ? "focus" : "overview";
}
