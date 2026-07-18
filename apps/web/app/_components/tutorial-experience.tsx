"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { personalGraphSessions } from "@/lib/personal-graph-session";
import {
  initialTutorialState,
  loadTutorialState,
  reduceTutorialState,
  saveTutorialState,
  TUTORIAL_SESSION_STORAGE_KEY,
  tutorialStepIds,
  type TutorialInputPath,
  type TutorialState,
  type TutorialStepId,
} from "@/lib/tutorial-state";

type TutorialStep = {
  id: TutorialStepId;
  eyebrow: string;
  title: string;
  body: string;
  details: readonly string[];
  practice?: { href: Route; label: string };
  optional?: boolean;
};

const steps: readonly TutorialStep[] = [
  {
    id: "model",
    eyebrow: "01 / the model",
    title: "Thoughts become nodes. Relationships become edges.",
    body: "Touch Traversal is a local-first view of a note graph. Selecting a thought changes the camera; following a relationship changes focus.",
    details: [
      "A node is one thought note.",
      "An edge explains why two thoughts connect.",
      "A topology changes the view, not your notes.",
    ],
  },
  {
    id: "sources",
    eyebrow: "02 / graph sources",
    title: "Practice with fiction before choosing personal notes.",
    body: "The demo uses a checked-in fictional graph. Studio can build a personal graph in memory only after you explicitly choose files or a folder.",
    details: [
      "No picker opens automatically.",
      "The source switch tells you which graph is visible.",
      "Leaving the tutorial restores your previous source.",
    ],
    practice: {
      href: "/studio?tutorial=sources",
      label: "Open source practice",
    },
  },
  {
    id: "mouse-keyboard",
    eyebrow: "03 / universal controls",
    title: "Focus, traverse, return, reshape, reset.",
    body: "Select a thought, select a connected thought to traverse, and press Escape to return. Keys 1–4 switch topology; A/D orbit, Shift + arrows pan, +/− zoom, and 0 resets the view.",
    details: [
      "Tab reaches every named control.",
      "Backspace restores the previous focused thought.",
      "Mouse and keyboard remain complete without camera access.",
    ],
    practice: {
      href: "/demo?input=mouse&tutorial=mouse",
      label: "Practice on the sample graph",
    },
  },
  {
    id: "hand",
    eyebrow: "04 / optional hand input",
    title: "Camera input is local, optional, and explicit.",
    body: "Only the Enable hand camera button requests access. Point moves the cursor, pinch selects, open palm returns, and a lateral swipe changes topology.",
    details: [
      "Calibration shows a mirrored local preview.",
      "Denied or unavailable camera access leaves mouse and keyboard active.",
      "You can skip this entire step.",
    ],
    optional: true,
    practice: {
      href: "/calibration?tutorial=hand",
      label: "Open optional calibration",
    },
  },
  {
    id: "manipulation",
    eyebrow: "05 / direct manipulation",
    title: "Grab empty space to move the view.",
    body: "With hand input active, pinch empty space and move to orbit or pan. Depth movement zooms. Release ends the grab; Reset view returns to the production default.",
    details: [
      "Node pinches still select or traverse.",
      "Mouse wheel and named view buttons teach the same camera model.",
      "Reduced motion shortens transitions.",
    ],
    optional: true,
    practice: {
      href: "/demo?tutorial=manipulation",
      label: "Practice view manipulation",
    },
  },
  {
    id: "performance",
    eyebrow: "06 / performance",
    title: "Compose a visible camera layer with the graph.",
    body: "Performance mode begins graph-only. Enabling the camera makes the local mirrored layer visible; framing, mirror, emphasis, and exit remain named controls.",
    details: [
      "No microphone is requested.",
      "The same stream powers the visible layer and hand tracking.",
      "Graph-only remains usable after denial.",
    ],
    optional: true,
    practice: {
      href: "/perform?tutorial=performance",
      label: "Open performance controls",
    },
  },
  {
    id: "recording",
    eyebrow: "07 / local recording",
    title: "Start, stop, download, or discard on this device.",
    body: "Recording appears only when supported and after the camera layer is active. A visible indicator and limits stay on screen; download or discard is always explicit.",
    details: [
      "Recordings are silent.",
      "Nothing uploads.",
      "Unsupported browsers provide a skippable explanation.",
    ],
    optional: true,
    practice: {
      href: "/perform?tutorial=recording",
      label: "Open recording practice",
    },
  },
  {
    id: "privacy",
    eyebrow: "08 / privacy and limits",
    title: "You decide what enters, remains, and leaves.",
    body: "Tutorial progress stores only versioned step and action names. Personal graph content stays in memory unless you explicitly export it.",
    details: [
      "Remove personal graph clears the in-memory session.",
      "Reset tutorial clears tutorial progress.",
      "Camera, files, downloads, and recording always require an action.",
    ],
  },
];

export function TutorialExperience() {
  const router = useRouter();
  const [state, setState] = useState<TutorialState>(initialTutorialState);
  const [ready, setReady] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      let next = loadTutorialState(window.localStorage);
      const requestedStep =
        window.location.hash === "#controls"
          ? "mouse-keyboard"
          : window.location.hash === "#help"
            ? "model"
            : null;
      if (requestedStep) {
        next = reduceTutorialState(next, {
          type: "GO_TO",
          step: requestedStep,
        });
        saveTutorialState(window.localStorage, next);
      }
      if (next.status === "active") {
        personalGraphSessions.selectSource("sample");
      }
      setState(next);
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const update = (next: TutorialState, message: string) => {
    setState(next);
    saveTutorialState(window.localStorage, next);
    setAnnouncement(message);
    window.requestAnimationFrame(() => headingRef.current?.focus());
  };

  const start = (inputPath: TutorialInputPath) => {
    if (!window.sessionStorage.getItem(TUTORIAL_SESSION_STORAGE_KEY)) {
      window.sessionStorage.setItem(
        TUTORIAL_SESSION_STORAGE_KEY,
        JSON.stringify({
          path: "/",
          source: personalGraphSessions.snapshot().source,
        }),
      );
    }
    personalGraphSessions.selectSource("sample");
    update(
      reduceTutorialState(state, { type: "START", inputPath }),
      inputPath === "mouse-keyboard"
        ? "Mouse and keyboard tutorial started."
        : "Full tutorial started.",
    );
  };

  const exit = () => {
    const session = readReturnSession();
    if (session.source === "personal" && personalGraphSessions.current()) {
      personalGraphSessions.selectSource("personal");
    } else {
      personalGraphSessions.selectSource("sample");
    }
    window.sessionStorage.removeItem(TUTORIAL_SESSION_STORAGE_KEY);
    router.push(session.path as Route);
  };

  if (!ready) return <main className="tutorial-shell" aria-busy="true" />;
  if (state.status === "new" || state.status === "skipped") {
    return (
      <main className="tutorial-shell tutorial-shell--invitation">
        <header className="tutorial-header">
          <Link className="wordmark" href="/">
            touch traversal
          </Link>
          <span>guided orientation</span>
        </header>
        <section
          className="tutorial-invitation"
          aria-labelledby="tutorial-invitation-title"
        >
          <p className="eyebrow">a calm first pass</p>
          <h1 id="tutorial-invitation-title" ref={headingRef} tabIndex={-1}>
            Learn the graph at your pace.
          </h1>
          <p>
            Eight short, resumable steps use the fictional sample. Camera and
            local files stay off until you choose them.
          </p>
          <div className="tutorial-actions">
            <button onClick={() => start("full")} type="button">
              Start tutorial
            </button>
            <button onClick={() => start("mouse-keyboard")} type="button">
              Mouse and keyboard only
            </button>
            <button
              onClick={() => {
                const next = reduceTutorialState(state, { type: "SKIP" });
                saveTutorialState(window.localStorage, next);
                exit();
              }}
              type="button"
            >
              Skip for now
            </button>
          </div>
        </section>
        <p className="tutorial-live" aria-live="polite">
          {announcement}
        </p>
      </main>
    );
  }

  if (state.status === "complete") {
    return (
      <main className="tutorial-shell tutorial-shell--invitation">
        <section
          className="tutorial-invitation"
          aria-labelledby="tutorial-complete-title"
        >
          <p className="eyebrow">orientation complete</p>
          <h1 id="tutorial-complete-title" ref={headingRef} tabIndex={-1}>
            The graph is yours to explore.
          </h1>
          <p>
            Your progress contains no note content. Replay from the beginning or
            restore the route and graph source you arrived with.
          </p>
          <div className="tutorial-actions">
            <button
              onClick={() => update(initialTutorialState, "Tutorial reset.")}
              type="button"
            >
              Replay tutorial
            </button>
            <button onClick={exit} type="button">
              Exit tutorial
            </button>
          </div>
        </section>
      </main>
    );
  }

  const step =
    steps.find((candidate) => candidate.id === state.currentStep) ?? steps[0];
  const index = tutorialStepIds.indexOf(step.id);
  return (
    <main className="tutorial-shell">
      <header className="tutorial-header">
        <Link className="wordmark" href="/">
          touch traversal
        </Link>
        <span>
          step {index + 1} of {steps.length}
        </span>
      </header>
      <nav className="tutorial-progress" aria-label="Tutorial progress">
        {steps.map((candidate, stepIndex) => (
          <button
            aria-current={candidate.id === step.id ? "step" : undefined}
            aria-label={`Go to step ${stepIndex + 1}: ${candidate.title}`}
            key={candidate.id}
            onClick={() =>
              update(
                reduceTutorialState(state, {
                  type: "GO_TO",
                  step: candidate.id,
                }),
                `Step ${stepIndex + 1} of ${steps.length}.`,
              )
            }
            type="button"
          >
            <span>{stepIndex + 1}</span>
          </button>
        ))}
      </nav>
      <article
        className="tutorial-card"
        id={
          step.id === "mouse-keyboard"
            ? "controls"
            : step.id === "model"
              ? "help"
              : undefined
        }
      >
        <p className="eyebrow">
          {step.eyebrow}
          {step.optional ? " / optional" : ""}
        </p>
        <h1 ref={headingRef} tabIndex={-1}>
          {step.title}
        </h1>
        <p className="description">{step.body}</p>
        <ul>
          {step.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
        {step.practice ? (
          <Link className="tutorial-practice" href={step.practice.href}>
            {step.practice.label}
          </Link>
        ) : null}
      </article>
      <div className="tutorial-navigation" aria-label="Tutorial step controls">
        <button
          disabled={index === 0}
          onClick={() =>
            update(
              reduceTutorialState(state, { type: "BACK" }),
              `Step ${index} of ${steps.length}.`,
            )
          }
          type="button"
        >
          Back
        </button>
        <button onClick={exit} type="button">
          Exit
        </button>
        <button
          onClick={() =>
            update(
              reduceTutorialState(state, { type: "NEXT" }),
              index === steps.length - 1
                ? "Tutorial complete."
                : `Step ${index + 2} of ${steps.length}.`,
            )
          }
          type="button"
        >
          {index === steps.length - 1
            ? "Finish"
            : step.optional
              ? "Next / skip optional"
              : "Next"}
        </button>
      </div>
      <p className="tutorial-live" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </main>
  );
}

function readReturnSession(): { path: string; source: "sample" | "personal" } {
  try {
    const value = JSON.parse(
      window.sessionStorage.getItem(TUTORIAL_SESSION_STORAGE_KEY) ?? "null",
    ) as { path?: unknown; source?: unknown } | null;
    const path =
      typeof value?.path === "string" &&
      value.path.startsWith("/") &&
      !value.path.startsWith("//")
        ? value.path
        : "/";
    return {
      path,
      source: value?.source === "personal" ? "personal" : "sample",
    };
  } catch {
    return { path: "/", source: "sample" };
  }
}
