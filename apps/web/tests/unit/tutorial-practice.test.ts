import { describe, expect, it } from "vitest";

import {
  advanceTutorialPractice,
  tutorialActionForManipulationDelta,
  tutorialPracticeProgress,
  tutorialPractices,
} from "../../lib/tutorial-practice";
import type { TutorialActionName } from "../../lib/tutorial-state";

describe("interactive tutorial practice", () => {
  it("advances the hand guide only in its taught order", () => {
    let completed: TutorialActionName[] = [];

    expect(
      advanceTutorialPractice("hand", completed, "hand-select"),
    ).toMatchObject({ accepted: false, completedActions: [] });

    for (const step of tutorialPractices.hand.steps) {
      const update = advanceTutorialPractice("hand", completed, step.action);
      expect(update.accepted).toBe(true);
      completed = update.completedActions;
    }

    expect(tutorialPracticeProgress("hand", completed)).toEqual({
      complete: true,
      completedCount: tutorialPractices.hand.steps.length,
      currentStep: null,
    });
  });

  it("keeps repeated and unrelated actions idempotent", () => {
    const first = advanceTutorialPractice("hand", [], "hand-point");

    expect(
      advanceTutorialPractice("hand", first.completedActions, "hand-point"),
    ).toEqual({ accepted: false, completedActions: ["hand-point"] });
    expect(
      advanceTutorialPractice("hand", first.completedActions, "focus"),
    ).toEqual({ accepted: false, completedActions: ["hand-point"] });
  });

  it("classifies only the dominant, intentional manipulation direction", () => {
    expect(
      tutorialActionForManipulationDelta({
        orbitYaw: 0.04,
        panY: 0.002,
        zoom: 0.003,
      }),
    ).toBe("hand-orbit");
    expect(
      tutorialActionForManipulationDelta({
        orbitYaw: 0.001,
        panY: -0.035,
        zoom: 0.004,
      }),
    ).toBe("hand-pan");
    expect(
      tutorialActionForManipulationDelta({
        orbitYaw: 0.001,
        panY: 0.002,
        zoom: 0.08,
      }),
    ).toBe("hand-zoom");
    expect(
      tutorialActionForManipulationDelta({
        orbitYaw: 0.002,
        panY: 0.002,
        zoom: 0.004,
      }),
    ).toBeNull();
  });
});
