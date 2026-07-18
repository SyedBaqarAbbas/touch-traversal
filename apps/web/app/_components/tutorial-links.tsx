"use client";

import Link from "next/link";

import { personalGraphSessions } from "@/lib/personal-graph-session";
import { TUTORIAL_SESSION_STORAGE_KEY } from "@/lib/tutorial-state";

export function HelpTutorialLinks() {
  const rememberReturn = () => {
    try {
      window.sessionStorage.setItem(
        TUTORIAL_SESSION_STORAGE_KEY,
        JSON.stringify({
          path: `${window.location.pathname}${window.location.search}`,
          source: personalGraphSessions.snapshot().source,
        }),
      );
    } catch {
      // A blocked return-route hint must not block help navigation.
    }
  };
  return (
    <nav className="tutorial-links" aria-label="Help and controls">
      <Link href="/tutorial#help" onClick={rememberReturn}>
        help
      </Link>
      <Link href="/tutorial" onClick={rememberReturn}>
        tutorial
      </Link>
      <Link href="/tutorial#controls" onClick={rememberReturn}>
        controls
      </Link>
    </nav>
  );
}
