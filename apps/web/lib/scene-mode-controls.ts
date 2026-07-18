import type { InteractionMode } from "@/lib/interaction-model";
import type { CameraMode } from "@/lib/scene-model";

export const sceneModeControlIds = [
  "overview",
  "focus",
  "inspect",
  "return",
] as const;

export type SceneModeControlId = (typeof sceneModeControlIds)[number];

export type SceneModeControlAction = "focus-hovered" | "return-overview";

export type SceneModeControlState = {
  action: SceneModeControlAction | null;
  disabled: boolean;
  id: SceneModeControlId;
  label: string;
  pressed: boolean | null;
  tooltip: string;
};

export function buildSceneModeControls(input: {
  cameraMode: CameraMode;
  focusTargetNodeId: string | null;
  focusTargetTitle: string | null;
  interactionMode: InteractionMode;
  selectedNodeId: string | null;
}): SceneModeControlState[] {
  const canReturn = input.selectedNodeId !== null;
  const canFocus =
    input.selectedNodeId === null &&
    input.focusTargetNodeId !== null &&
    (input.interactionMode === "IDLE" || input.interactionMode === "HOVERING");

  return [
    {
      action: canReturn ? "return-overview" : null,
      disabled: !canReturn,
      id: "overview",
      label: "overview",
      pressed: input.cameraMode === "overview",
      tooltip: canReturn
        ? "Clear the selected thought and restore the full-graph overview."
        : "Full-graph overview is already active.",
    },
    {
      action: canFocus ? "focus-hovered" : null,
      disabled: !canFocus,
      id: "focus",
      label: "focus",
      pressed: input.cameraMode === "focus",
      tooltip: input.selectedNodeId
        ? "A thought is already focused. Choose a connected thought to traverse, or return first."
        : canFocus
          ? `Focus “${input.focusTargetTitle ?? "the most recently hovered thought"}”.`
          : "Hover a thought with the mouse or hand cursor to enable focus.",
    },
    {
      action: null,
      disabled: true,
      id: "inspect",
      label: "inspect",
      pressed: input.cameraMode === "inspect",
      tooltip:
        "Inspect view is reserved for a future detailed-reading mode and is not available yet.",
    },
    {
      action: canReturn ? "return-overview" : null,
      disabled: !canReturn,
      id: "return",
      label: "return",
      pressed: null,
      tooltip: canReturn
        ? "Clear the selected thought and return to overview. Escape does the same."
        : "Return becomes available after a thought is selected.",
    },
  ];
}
