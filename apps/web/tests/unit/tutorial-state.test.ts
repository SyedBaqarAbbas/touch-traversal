import { describe, expect, it } from "vitest";

import {
  initialTutorialState,
  LEGACY_TUTORIAL_STORAGE_KEY,
  loadTutorialState,
  reduceTutorialState,
  saveTutorialState,
  TUTORIAL_STORAGE_KEY,
} from "../../lib/tutorial-state";

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

describe("tutorial state", () => {
  it("resumes explicit, content-free progress", () => {
    const storage = memoryStorage();
    let state = reduceTutorialState(initialTutorialState, {
      type: "START",
      inputPath: "mouse-keyboard",
    });
    state = reduceTutorialState(state, { type: "NEXT" });
    state = reduceTutorialState(state, {
      type: "COMPLETE_ACTION",
      action: "focus",
    });
    saveTutorialState(storage, state);

    expect(loadTutorialState(storage)).toMatchObject({
      completedActions: ["focus"],
      completedSteps: ["model"],
      currentStep: "sources",
      inputPath: "mouse-keyboard",
      status: "active",
      version: 2,
    });
    expect(storage.values.get(TUTORIAL_STORAGE_KEY)).not.toMatch(
      /note|filename|content|camera frame/i,
    );
  });

  it("migrates version 1 progress and removes the legacy key when saved", () => {
    const storage = memoryStorage({
      [LEGACY_TUTORIAL_STORAGE_KEY]: JSON.stringify({
        inputMode: "mouse",
        status: "active",
        step: 3,
        version: 1,
      }),
    });
    const migrated = loadTutorialState(storage);
    expect(migrated).toMatchObject({
      currentStep: "hand",
      inputPath: "mouse-keyboard",
      status: "active",
      version: 2,
    });

    saveTutorialState(storage, migrated);
    expect(storage.values.has(LEGACY_TUTORIAL_STORAGE_KEY)).toBe(false);
  });

  it("sanitizes malformed and unknown fields", () => {
    const storage = memoryStorage({
      [TUTORIAL_STORAGE_KEY]: JSON.stringify({
        completedActions: ["focus", "private-note-body"],
        completedSteps: ["model", "private-file"],
        currentStep: "sources",
        inputPath: "full",
        personalContent: "must not survive",
        status: "active",
        version: 2,
      }),
    });
    expect(loadTutorialState(storage)).toEqual({
      completedActions: ["focus"],
      completedSteps: ["model"],
      currentStep: "sources",
      inputPath: "full",
      status: "active",
      version: 2,
    });
  });

  it("supports skip, restart, and replay without retaining progress", () => {
    const skipped = reduceTutorialState(initialTutorialState, { type: "SKIP" });
    expect(skipped.status).toBe("skipped");

    const restarted = reduceTutorialState(skipped, {
      type: "START",
      inputPath: "full",
    });
    expect(restarted).toMatchObject({
      currentStep: "model",
      inputPath: "full",
      status: "active",
    });

    expect(reduceTutorialState(restarted, { type: "RESET" })).toEqual(
      initialTutorialState,
    );
  });

  it("keeps tutorial state usable when browser storage is blocked or full", () => {
    const unavailable = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    };
    const active = reduceTutorialState(initialTutorialState, {
      type: "START",
      inputPath: "mouse-keyboard",
    });

    expect(loadTutorialState(unavailable)).toEqual(initialTutorialState);
    expect(() => saveTutorialState(unavailable, active)).not.toThrow();
  });
});
