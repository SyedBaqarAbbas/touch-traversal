import type { TutorialActionName } from "@/lib/tutorial-state";

export const TUTORIAL_ACTION_EVENT = "touch-traversal:tutorial-action";

export function announceTutorialAction(action: TutorialActionName): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(TUTORIAL_ACTION_EVENT, { detail: { action } }),
  );
}
