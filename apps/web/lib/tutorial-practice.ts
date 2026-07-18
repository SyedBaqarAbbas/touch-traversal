import type { HandManipulationDelta } from "@/lib/gesture-manipulation";
import type { TutorialActionName } from "@/lib/tutorial-state";

export type TutorialPracticeId = "hand" | "manipulation";

export type TutorialPracticeStep = {
  action: TutorialActionName;
  instruction: string;
  label: string;
};

export type TutorialPractice = {
  eyebrow: string;
  intro: string;
  steps: readonly TutorialPracticeStep[];
  title: string;
};

export const tutorialPractices: Record<TutorialPracticeId, TutorialPractice> = {
  hand: {
    eyebrow: "interactive hand practice",
    intro:
      "Select Enable hand camera when you are ready. Recognition and video stay in this browser.",
    title: "Traverse with your hand.",
    steps: [
      {
        action: "hand-point",
        instruction:
          "Extend only your index finger and hover any thought until it brightens.",
        label: "Point at a thought",
      },
      {
        action: "hand-select",
        instruction: "Briefly touch thumb to index, then fully release.",
        label: "Pinch to select",
      },
      {
        action: "hand-traverse",
        instruction:
          "Point at a highlighted connected thought and pinch a second time.",
        label: "Pinch to traverse",
      },
      {
        action: "hand-return",
        instruction:
          "After the camera settles, spread every finger and hold for half a second.",
        label: "Open palm to return",
      },
      {
        action: "hand-topology",
        instruction:
          "With an open, unpinched hand, make one quick horizontal swipe.",
        label: "Swipe to change topology",
      },
    ],
  },
  manipulation: {
    eyebrow: "interactive view practice",
    intro:
      "Select Enable hand camera when you are ready, then keep one pinch held through the movement sequence.",
    title: "Move the graph with one grab.",
    steps: [
      {
        action: "hand-grab",
        instruction: "Move clear of every node, pinch empty space, and hold.",
        label: "Grab empty space",
      },
      {
        action: "hand-orbit",
        instruction: "Keep pinching and move left or right.",
        label: "Orbit horizontally",
      },
      {
        action: "hand-pan",
        instruction: "Keep pinching and move up or down.",
        label: "Pan vertically",
      },
      {
        action: "hand-zoom",
        instruction: "Keep pinching and move toward or away from the camera.",
        label: "Zoom in depth",
      },
      {
        action: "hand-release",
        instruction:
          "Separate thumb and index. Use Reset view or 0 when you want the default view.",
        label: "Release the grab",
      },
    ],
  },
};

export function advanceTutorialPractice(
  practiceId: TutorialPracticeId,
  completedActions: readonly TutorialActionName[],
  action: TutorialActionName,
): { accepted: boolean; completedActions: TutorialActionName[] } {
  const practice = tutorialPractices[practiceId];
  const expected = practice.steps.find(
    (step) => !completedActions.includes(step.action),
  );
  if (!expected || expected.action !== action) {
    return { accepted: false, completedActions: [...completedActions] };
  }
  return {
    accepted: true,
    completedActions: [...completedActions, action],
  };
}

export function tutorialPracticeProgress(
  practiceId: TutorialPracticeId,
  completedActions: readonly TutorialActionName[],
): {
  complete: boolean;
  completedCount: number;
  currentStep: TutorialPracticeStep | null;
} {
  const steps = tutorialPractices[practiceId].steps;
  const completedCount = steps.filter((step) =>
    completedActions.includes(step.action),
  ).length;
  return {
    complete: completedCount === steps.length,
    completedCount,
    currentStep:
      steps.find((step) => !completedActions.includes(step.action)) ?? null,
  };
}

export function tutorialActionForManipulationDelta(
  delta: HandManipulationDelta,
): TutorialActionName | null {
  const candidates = [
    {
      action: "hand-orbit" as const,
      score: Math.abs(delta.orbitYaw) / 0.008,
    },
    { action: "hand-pan" as const, score: Math.abs(delta.panY) / 0.008 },
    { action: "hand-zoom" as const, score: Math.abs(delta.zoom) / 0.012 },
  ];
  const dominant = candidates.sort(
    (left, right) => right.score - left.score,
  )[0];
  return dominant && dominant.score >= 1 ? dominant.action : null;
}
