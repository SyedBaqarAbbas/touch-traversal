import { describe, expect, it } from "vitest";

import {
  applyCameraViewControl,
  applyHandManipulationDelta,
  cameraPoseWithManipulation,
  cameraViewControlForKeyboard,
  cameraViewControlForWheel,
  createCameraManipulationState,
  defaultCameraManipulationLimits,
} from "../../lib/camera-manipulation";
import { getCameraPose } from "../../lib/scene-model";

describe("camera manipulation contract", () => {
  it("applies orbit, pan, and zoom without mutating the authored pose", () => {
    const pose = getCameraPose("overview");
    const state = applyHandManipulationDelta(createCameraManipulationState(), {
      orbitYaw: 0.24,
      panY: 0.18,
      zoom: 0.3,
    });
    const manipulated = cameraPoseWithManipulation(pose, state);

    expect(manipulated.position).not.toEqual(pose.position);
    expect(manipulated.target[1]).toBeCloseTo(0.18);
    expect(distance(manipulated.position, manipulated.target)).toBeLessThan(
      distance(pose.position, pose.target),
    );
    expect(getCameraPose("overview")).toEqual(pose);
  });

  it("clamps repeated controls and offers an exact accessible reset", () => {
    let state = createCameraManipulationState();
    for (let index = 0; index < 40; index += 1) {
      state = applyCameraViewControl(state, "zoom-in");
      state = applyCameraViewControl(state, "pan-up");
    }

    expect(state.zoom).toBe(defaultCameraManipulationLimits.maxZoomIn);
    expect(state.panY).toBe(defaultCameraManipulationLimits.maxPan);
    expect(applyCameraViewControl(state, "reset")).toEqual(
      createCameraManipulationState(),
    );
  });

  it("maps documented keyboard and wheel fallbacks without stealing modified shortcuts", () => {
    expect(keyboard("a")).toBe("orbit-left");
    expect(keyboard("D")).toBe("orbit-right");
    expect(keyboard("ArrowUp", { shiftKey: true })).toBe("pan-up");
    expect(keyboard("+")).toBe("zoom-in");
    expect(keyboard("-")).toBe("zoom-out");
    expect(keyboard("0")).toBe("reset");
    expect(keyboard("a", { ctrlKey: true })).toBeNull();
    expect(cameraViewControlForWheel(-24)).toBe("zoom-in");
    expect(cameraViewControlForWheel(24)).toBe("zoom-out");
    expect(cameraViewControlForWheel(0.2)).toBeNull();
  });
});

function keyboard(
  key: string,
  overrides: Partial<
    Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">
  > = {},
) {
  return cameraViewControlForKeyboard({
    altKey: false,
    ctrlKey: false,
    key,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  });
}

function distance(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}
