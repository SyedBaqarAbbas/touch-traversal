import { describe, expect, it } from "vitest";

import { buildSceneModeControls } from "../../lib/scene-mode-controls";

describe("scene mode controls", () => {
  it("disables actions that have no effect in overview", () => {
    const controls = buildSceneModeControls({
      cameraMode: "overview",
      focusTargetNodeId: null,
      focusTargetTitle: null,
      interactionMode: "IDLE",
      selectedNodeId: null,
    });

    expect(controls).toMatchObject([
      { action: null, disabled: true, id: "overview", pressed: true },
      { action: null, disabled: true, id: "focus", pressed: false },
      { action: null, disabled: true, id: "inspect", pressed: false },
      { action: null, disabled: true, id: "return", pressed: null },
    ]);
  });

  it("enables focus only for a hovered thought", () => {
    const controls = buildSceneModeControls({
      cameraMode: "overview",
      focusTargetNodeId: "thought-a",
      focusTargetTitle: "Constellations before filing",
      interactionMode: "HOVERING",
      selectedNodeId: null,
    });
    const focus = controls.find((control) => control.id === "focus");

    expect(focus).toMatchObject({
      action: "focus-hovered",
      disabled: false,
      tooltip: "Focus “Constellations before filing”.",
    });
  });

  it("enables overview and return after selection while keeping inspect honest", () => {
    const controls = buildSceneModeControls({
      cameraMode: "focus",
      focusTargetNodeId: "thought-b",
      focusTargetTitle: "Orientation before action",
      interactionMode: "FOCUSED",
      selectedNodeId: "thought-a",
    });

    expect(controls.find((control) => control.id === "overview")).toMatchObject(
      {
        action: "return-overview",
        disabled: false,
        pressed: false,
      },
    );
    expect(controls.find((control) => control.id === "focus")).toMatchObject({
      action: null,
      disabled: true,
      pressed: true,
    });
    expect(controls.find((control) => control.id === "inspect")).toMatchObject({
      action: null,
      disabled: true,
      tooltip:
        "Inspect view is reserved for a future detailed-reading mode and is not available yet.",
    });
    expect(controls.find((control) => control.id === "return")).toMatchObject({
      action: "return-overview",
      disabled: false,
    });
  });
});
