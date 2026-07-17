"use client";

import { useEffect, useState } from "react";

import {
  TRAVERSAL_HISTORY_STORAGE_KEY,
  formatTraversalBreadcrumb,
  parseTraversalHistory,
  type TraversalHistoryEntry,
} from "@/lib/traversal-history";

export function TraversalHistoryDebugPanel() {
  const [history, setHistory] = useState<TraversalHistoryEntry[]>([]);

  useEffect(() => {
    const readHistory = () => {
      setHistory(
        parseTraversalHistory(
          window.sessionStorage.getItem(TRAVERSAL_HISTORY_STORAGE_KEY),
        ),
      );
    };

    readHistory();
    window.addEventListener("focus", readHistory);
    window.addEventListener("storage", readHistory);
    document.addEventListener("visibilitychange", readHistory);
    return () => {
      window.removeEventListener("focus", readHistory);
      window.removeEventListener("storage", readHistory);
      document.removeEventListener("visibilitychange", readHistory);
    };
  }, []);

  return (
    <article className="debug-panel debug-history-panel">
      <h2>Traversal history</h2>
      <p className="debug-history-breadcrumb">
        {formatTraversalBreadcrumb(history)}
      </p>
      {history.length > 0 ? (
        <ol className="debug-history-list">
          {history.slice(-5).map((entry) => (
            <li key={`${entry.edgeId}-${entry.timestampMs}`}>
              <span>{entry.edgeId}</span>
              <small>
                {entry.sourceNodeId} → {entry.targetNodeId}
              </small>
            </li>
          ))}
        </ol>
      ) : (
        <p className="debug-history-empty">
          Traverse between focused thoughts in the demo route to populate this
          session breadcrumb.
        </p>
      )}
    </article>
  );
}
