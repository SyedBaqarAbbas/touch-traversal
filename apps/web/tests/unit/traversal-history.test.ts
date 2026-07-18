import { describe, expect, it, vi } from "vitest";

import {
  MAX_TRAVERSAL_HISTORY_ENTRIES,
  appendTraversalHistory,
  clearTraversalHistory,
  formatTraversalBreadcrumb,
  parseTraversalHistory,
  restorePreviousFocus,
  type TraversalHistoryEntry,
} from "../../lib/traversal-history";

const entry: TraversalHistoryEntry = {
  edgeId: "edge-a-b",
  sourceNodeId: "thought-a",
  targetNodeId: "thought-b",
  timestampMs: 100,
};

describe("traversal history", () => {
  it("reports whether personal-derived history was actually removed", () => {
    const removeItem = vi.fn();
    expect(clearTraversalHistory({ removeItem })).toBe(true);
    expect(removeItem).toHaveBeenCalledWith("touch-traversal:history");

    expect(
      clearTraversalHistory({
        removeItem: () => {
          throw new DOMException("blocked", "SecurityError");
        },
      }),
    ).toBe(false);
  });

  it("appends bounded source-target-edge history entries", () => {
    const history = Array.from(
      { length: MAX_TRAVERSAL_HISTORY_ENTRIES + 3 },
      (_value, index): TraversalHistoryEntry => ({
        edgeId: `edge-${index}`,
        sourceNodeId: `source-${index}`,
        targetNodeId: `target-${index}`,
        timestampMs: index,
      }),
    ).reduce<TraversalHistoryEntry[]>(
      (current, next) => appendTraversalHistory(current, next),
      [],
    );

    expect(history).toHaveLength(MAX_TRAVERSAL_HISTORY_ENTRIES);
    expect(history[0]?.edgeId).toBe("edge-3");
    expect(history.at(-1)?.edgeId).toBe(
      `edge-${MAX_TRAVERSAL_HISTORY_ENTRIES + 2}`,
    );
  });

  it("restores the previous focus only when the current target matches", () => {
    const restoration = restorePreviousFocus([entry], "thought-b");

    expect(restoration).toMatchObject({
      entry,
      history: [],
      nodeId: "thought-a",
    });
    expect(restorePreviousFocus([entry], "thought-c")).toBeNull();
  });

  it("formats and parses compact debug breadcrumbs", () => {
    const history = appendTraversalHistory([], entry);
    const serialized = JSON.stringify([
      entry,
      { ...entry, timestampMs: Number.NaN },
      { invalid: true },
    ]);

    expect(formatTraversalBreadcrumb(history)).toBe("thought-a → thought-b");
    expect(formatTraversalBreadcrumb([])).toBe("no traversal history");
    expect(parseTraversalHistory(serialized)).toEqual([entry]);
    expect(parseTraversalHistory("not json")).toEqual([]);
  });
});
