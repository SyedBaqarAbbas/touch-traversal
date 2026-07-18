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
import {
  advanceTutorialPractice,
  tutorialPracticeProgress,
  tutorialPractices,
  type TutorialPracticeId,
} from "@/lib/tutorial-practice";

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
  "hand-point": "Point recognized over a thought.",
  "hand-select": "Pinch selected a thought.",
  "hand-traverse": "Pinch traversed a connected thought.",
  "hand-return": "Open palm returned to overview.",
  "hand-topology": "Swipe changed the topology.",
  "hand-grab": "Empty-space grab started.",
  "hand-orbit": "Horizontal movement orbited the view.",
  "hand-pan": "Vertical movement panned the view.",
  "hand-zoom": "Depth movement zoomed the view.",
  "hand-release": "Grab released.",
};

export function TutorialCoach({
  context,
}: {
  context: "graph" | "studio" | "calibration" | "performance";
}) {
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState(true);
  const [practiceId, setPracticeId] = useState<TutorialPracticeId | null>(null);
  const [completedActions, setCompletedActions] = useState<
    TutorialActionName[]
  >([]);
  useEffect(() => {
    let hideTimer = 0;
    const timer = window.setTimeout(() => {
      const tutorial = new URLSearchParams(window.location.search).get(
        "tutorial",
      );
      const requestedPractice =
        tutorial === "hand" || tutorial === "manipulation" ? tutorial : null;
      const tutorialState = loadTutorialState(window.localStorage);
      const shouldEnable =
        Boolean(tutorial) && tutorialState.status === "active";
      setEnabled(shouldEnable);
      setVisible(shouldEnable);
      setPracticeId(requestedPractice);
      setCompletedActions(tutorialState.completedActions);
      if (!shouldEnable) return;
      if (requestedPractice) {
        const progress = tutorialPracticeProgress(
          requestedPractice,
          tutorialState.completedActions,
        );
        setMessage(
          progress.currentStep?.instruction ??
            "Practice complete. Repeat any gesture on the graph or return to the tutorial.",
        );
        return;
      }
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
      const practiceUpdate = practiceId
        ? advanceTutorialPractice(practiceId, current.completedActions, action)
        : null;
      if (practiceUpdate && !practiceUpdate.accepted) return;
      const next = reduceTutorialState(current, {
        type: "COMPLETE_ACTION",
        action,
      });
      saveTutorialState(window.localStorage, next);
      setCompletedActions(next.completedActions);
      if (practiceId) {
        const progress = tutorialPracticeProgress(
          practiceId,
          next.completedActions,
        );
        setMessage(
          progress.complete
            ? `${labels[action]} Interactive practice complete.`
            : `${labels[action]} Next: ${progress.currentStep?.instruction ?? "continue"}`,
        );
      } else {
        setMessage(labels[action]);
      }
      setVisible(true);
      if (!practiceId) {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => setVisible(false), 3200);
      }
    };
    window.addEventListener(TUTORIAL_ACTION_EVENT, onAction);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(TUTORIAL_ACTION_EVENT, onAction);
    };
  }, [enabled, practiceId]);
  if (!enabled) return null;
  if (practiceId) {
    const practice = tutorialPractices[practiceId];
    const progress = tutorialPracticeProgress(practiceId, completedActions);
    return (
      <aside
        aria-labelledby="tutorial-practice-title"
        className="tutorial-coach tutorial-coach--interactive"
        data-complete={progress.complete ? "true" : "false"}
        data-visible="true"
      >
        <p className="eyebrow">{practice.eyebrow}</p>
        <h2 id="tutorial-practice-title">{practice.title}</h2>
        <p className="tutorial-coach__intro">{practice.intro}</p>
        <p className="tutorial-coach__progress">
          {progress.complete
            ? `${practice.steps.length} of ${practice.steps.length} movements recognized`
            : `${progress.completedCount + 1} of ${practice.steps.length} · ${progress.currentStep?.label}`}
        </p>
        <ol>
          {practice.steps.map((step, index) => {
            const complete = completedActions.includes(step.action);
            const current = step.action === progress.currentStep?.action;
            return (
              <li
                aria-current={current ? "step" : undefined}
                data-step-state={
                  complete ? "complete" : current ? "current" : "pending"
                }
                key={step.action}
              >
                <span>{complete ? "✓" : index + 1}</span>
                <div>
                  <strong>{step.label}</strong>
                  <p>{step.instruction}</p>
                </div>
              </li>
            );
          })}
        </ol>
        <p
          aria-atomic="true"
          aria-live="polite"
          className="tutorial-coach__message"
        >
          {message}
        </p>
        <nav aria-label="Interactive tutorial links">
          <Link href="/calibration?tutorial=hand">calibrate</Link>
          <Link href="/tutorial">return to tutorial</Link>
        </nav>
      </aside>
    );
  }
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
