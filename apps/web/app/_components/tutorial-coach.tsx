"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TUTORIAL_ACTION_EVENT } from "@/lib/tutorial-events";
import {
  loadTutorialState,
  reduceTutorialState,
  saveTutorialState,
  type TutorialActionName,
} from "@/lib/tutorial-state";

const labels: Record<TutorialActionName, string> = {
  focus: "Focused a thought.",
  traverse: "Traversed a relationship.",
  return: "Returned to overview.",
  topology: "Changed topology.",
  view: "Moved the view.",
  "view-reset": "Reset the view.",
  "manipulation-start": "Grab started.",
  "manipulation-update": "View moved with the grab.",
  "manipulation-end": "Grab released.",
};

export function TutorialCoach({
  context,
}: {
  context: "graph" | "studio" | "calibration" | "performance";
}) {
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    let hideTimer = 0;
    const timer = window.setTimeout(() => {
      const tutorial = new URLSearchParams(window.location.search).get(
        "tutorial",
      );
      const tutorialState = loadTutorialState(window.localStorage);
      const shouldEnable =
        Boolean(tutorial) && tutorialState.status === "active";
      setEnabled(shouldEnable);
      setVisible(shouldEnable);
      if (!shouldEnable) return;
      setMessage(
        context === "studio"
          ? "Choose the fictional sample or explicitly open local notes."
          : context === "calibration"
            ? "Camera is optional. Enable it only when you are ready."
            : context === "performance"
              ? "Begin graph-only; enable the camera or recording only by choice."
              : "Use the named controls. Successful production actions are recorded as progress.",
      );
      hideTimer = window.setTimeout(() => setVisible(false), 5200);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(hideTimer);
    };
  }, [context]);
  useEffect(() => {
    if (!enabled) return;
    let timer = 0;
    const onAction = (event: Event) => {
      const action = (event as CustomEvent<{ action: TutorialActionName }>)
        .detail.action;
      const current = loadTutorialState(window.localStorage);
      if (
        current.status !== "active" ||
        current.completedActions.includes(action)
      ) {
        return;
      }
      const next = reduceTutorialState(current, {
        type: "COMPLETE_ACTION",
        action,
      });
      saveTutorialState(window.localStorage, next);
      setMessage(labels[action]);
      setVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setVisible(false), 3200);
    };
    window.addEventListener(TUTORIAL_ACTION_EVENT, onAction);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(TUTORIAL_ACTION_EVENT, onAction);
    };
  }, [enabled]);
  if (!enabled) return null;
  return (
    <aside
      className="tutorial-coach"
      data-visible={visible ? "true" : "false"}
      aria-live="polite"
    >
      <p>{message}</p>
      <Link href="/tutorial">Return to tutorial</Link>
    </aside>
  );
}
