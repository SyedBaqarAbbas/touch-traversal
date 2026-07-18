"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { personalGraphSessions } from "@/lib/personal-graph-session";
import {
  loadTutorialState,
  reduceTutorialState,
  saveTutorialState,
  TUTORIAL_SESSION_STORAGE_KEY,
} from "@/lib/tutorial-state";

export function TutorialInvitation() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(
      () => setVisible(loadTutorialState(window.localStorage).status === "new"),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);
  if (!visible) return null;
  const remember = () =>
    window.sessionStorage.setItem(
      TUTORIAL_SESSION_STORAGE_KEY,
      JSON.stringify({
        path: "/#tutorial-entry",
        source: personalGraphSessions.snapshot().source,
      }),
    );
  return (
    <aside
      className="home-tutorial-invitation"
      id="tutorial-entry"
      aria-labelledby="home-tutorial-title"
    >
      <p className="eyebrow">new here?</p>
      <h2 id="home-tutorial-title">Take a calm, private first pass.</h2>
      <p>
        The sample tutorial is resumable. It never opens the camera or your
        files on its own.
      </p>
      <div className="tutorial-actions">
        <Link
          href="/tutorial"
          onClick={() => {
            remember();
            personalGraphSessions.selectSource("sample");
            const next = reduceTutorialState(
              loadTutorialState(window.localStorage),
              { type: "START", inputPath: "full" },
            );
            saveTutorialState(window.localStorage, next);
          }}
        >
          Start tutorial
        </Link>
        <Link
          href="/tutorial?path=mouse"
          onClick={() => {
            remember();
            personalGraphSessions.selectSource("sample");
            const next = reduceTutorialState(
              loadTutorialState(window.localStorage),
              { type: "START", inputPath: "mouse-keyboard" },
            );
            saveTutorialState(window.localStorage, next);
          }}
        >
          Mouse and keyboard only
        </Link>
        <button
          onClick={() => {
            const next = reduceTutorialState(
              loadTutorialState(window.localStorage),
              { type: "SKIP" },
            );
            saveTutorialState(window.localStorage, next);
            setVisible(false);
            setMessage("Tutorial skipped. It remains available from Help.");
          }}
          type="button"
        >
          Skip for now
        </button>
      </div>
      <p aria-live="polite">{message}</p>
    </aside>
  );
}
