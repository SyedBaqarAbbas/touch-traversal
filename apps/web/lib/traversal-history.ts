export type TraversalHistoryEntry = {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  timestampMs: number;
};

export type FocusRestoration = {
  entry: TraversalHistoryEntry;
  history: TraversalHistoryEntry[];
  nodeId: string;
};

export const TRAVERSAL_HISTORY_STORAGE_KEY = "touch-traversal:history";
export const MAX_TRAVERSAL_HISTORY_ENTRIES = 24;

export function clearTraversalHistory(
  storage: Pick<Storage, "removeItem">,
): boolean {
  try {
    storage.removeItem(TRAVERSAL_HISTORY_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function appendTraversalHistory(
  history: readonly TraversalHistoryEntry[],
  entry: TraversalHistoryEntry,
): TraversalHistoryEntry[] {
  return [...history, entry].slice(-MAX_TRAVERSAL_HISTORY_ENTRIES);
}

export function restorePreviousFocus(
  history: readonly TraversalHistoryEntry[],
  currentNodeId: string | null,
): FocusRestoration | null {
  if (!currentNodeId || history.length === 0) {
    return null;
  }

  const entry = history[history.length - 1];
  if (entry.targetNodeId !== currentNodeId) {
    return null;
  }

  return {
    entry,
    history: history.slice(0, -1),
    nodeId: entry.sourceNodeId,
  };
}

export function formatTraversalBreadcrumb(
  history: readonly TraversalHistoryEntry[],
): string {
  if (history.length === 0) {
    return "no traversal history";
  }
  return history
    .map((entry) => `${entry.sourceNodeId} → ${entry.targetNodeId}`)
    .join(" / ");
}

export function parseTraversalHistory(
  serialized: string | null,
): TraversalHistoryEntry[] {
  if (!serialized) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isTraversalHistoryEntry);
  } catch {
    return [];
  }
}

function isTraversalHistoryEntry(
  value: unknown,
): value is TraversalHistoryEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.edgeId === "string" &&
    typeof candidate.sourceNodeId === "string" &&
    typeof candidate.targetNodeId === "string" &&
    typeof candidate.timestampMs === "number" &&
    Number.isFinite(candidate.timestampMs)
  );
}
