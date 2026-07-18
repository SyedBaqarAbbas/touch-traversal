export const TUTORIAL_STORAGE_KEY = "touch-traversal:tutorial:v2";
export const LEGACY_TUTORIAL_STORAGE_KEY = "touch-traversal:tutorial";
export const TUTORIAL_SESSION_STORAGE_KEY = "touch-traversal:tutorial:return";
export const tutorialVersion = 2 as const;

export const tutorialStepIds = [
  "model",
  "sources",
  "mouse-keyboard",
  "hand",
  "manipulation",
  "performance",
  "recording",
  "privacy",
] as const;

export type TutorialStepId = (typeof tutorialStepIds)[number];
export type TutorialInputPath = "full" | "mouse-keyboard";
export type TutorialStatus = "new" | "active" | "skipped" | "complete";
export type TutorialActionName =
  | "focus"
  | "traverse"
  | "return"
  | "topology"
  | "view"
  | "view-reset"
  | "manipulation-start"
  | "manipulation-update"
  | "manipulation-end";

export type TutorialState = {
  version: typeof tutorialVersion;
  status: TutorialStatus;
  currentStep: TutorialStepId;
  inputPath: TutorialInputPath;
  completedSteps: TutorialStepId[];
  completedActions: TutorialActionName[];
};

export type TutorialStateEvent =
  | { type: "START"; inputPath: TutorialInputPath }
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "GO_TO"; step: TutorialStepId }
  | { type: "SKIP" }
  | { type: "RESET" }
  | { type: "COMPLETE_ACTION"; action: TutorialActionName };

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem" | "removeItem">;

export const initialTutorialState: TutorialState = {
  version: tutorialVersion,
  status: "new",
  currentStep: "model",
  inputPath: "full",
  completedSteps: [],
  completedActions: [],
};

export function reduceTutorialState(
  state: TutorialState,
  event: TutorialStateEvent,
): TutorialState {
  if (event.type === "RESET") return initialTutorialState;
  if (event.type === "SKIP") return { ...state, status: "skipped" };
  if (event.type === "START") {
    return {
      ...state,
      status: "active",
      inputPath: event.inputPath,
      currentStep:
        state.status === "active" ? state.currentStep : tutorialStepIds[0],
    };
  }
  if (event.type === "COMPLETE_ACTION") {
    return state.completedActions.includes(event.action)
      ? state
      : {
          ...state,
          completedActions: [...state.completedActions, event.action],
        };
  }
  if (event.type === "GO_TO") {
    return { ...state, status: "active", currentStep: event.step };
  }

  const index = tutorialStepIds.indexOf(state.currentStep);
  if (event.type === "BACK") {
    return {
      ...state,
      currentStep: tutorialStepIds[Math.max(0, index - 1)],
    };
  }
  const completedSteps = state.completedSteps.includes(state.currentStep)
    ? state.completedSteps
    : [...state.completedSteps, state.currentStep];
  if (index === tutorialStepIds.length - 1) {
    return { ...state, completedSteps, status: "complete" };
  }
  return {
    ...state,
    completedSteps,
    currentStep: tutorialStepIds[index + 1],
  };
}

export function loadTutorialState(storage: StorageReader): TutorialState {
  try {
    return (
      parseTutorialState(storage.getItem(TUTORIAL_STORAGE_KEY)) ??
      migrateLegacyTutorialState(
        storage.getItem(LEGACY_TUTORIAL_STORAGE_KEY),
      ) ??
      initialTutorialState
    );
  } catch {
    return initialTutorialState;
  }
}

export function saveTutorialState(
  storage: StorageWriter,
  state: TutorialState,
): void {
  try {
    storage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify(state));
    storage.removeItem(LEGACY_TUTORIAL_STORAGE_KEY);
  } catch {
    // Progress remains usable in React state when storage is blocked or full.
  }
}

export function resetTutorialState(storage: StorageWriter): void {
  try {
    storage.removeItem(TUTORIAL_STORAGE_KEY);
    storage.removeItem(LEGACY_TUTORIAL_STORAGE_KEY);
  } catch {
    // Reset remains an in-memory action when browser storage is unavailable.
  }
}

function parseTutorialState(raw: string | null): TutorialState | null {
  const value = parseRecord(raw);
  if (!value || value.version !== tutorialVersion) return null;
  const status = tutorialStatus(value.status);
  const currentStep = tutorialStep(value.currentStep);
  const inputPath = tutorialInputPath(value.inputPath);
  if (!status || !currentStep || !inputPath) return null;
  return {
    version: tutorialVersion,
    status,
    currentStep,
    inputPath,
    completedSteps: arrayOf(value.completedSteps, tutorialStep),
    completedActions: arrayOf(value.completedActions, tutorialAction),
  };
}

function migrateLegacyTutorialState(raw: string | null): TutorialState | null {
  const value = parseRecord(raw);
  if (!value || value.version !== 1) return null;
  const status = tutorialStatus(value.status) ?? "new";
  const currentStep =
    tutorialStep(value.currentStep) ??
    tutorialStepIds[
      Math.min(
        tutorialStepIds.length - 1,
        Math.max(0, typeof value.step === "number" ? value.step : 0),
      )
    ];
  return {
    ...initialTutorialState,
    status,
    currentStep,
    inputPath:
      value.inputMode === "mouse" || value.inputPath === "mouse-keyboard"
        ? "mouse-keyboard"
        : "full",
  };
}

function parseRecord(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function arrayOf<T>(
  value: unknown,
  parse: (candidate: unknown) => T | null,
): T[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.map(parse).filter((item): item is T => item != null)),
  ];
}

function tutorialStatus(value: unknown): TutorialStatus | null {
  return value === "new" ||
    value === "active" ||
    value === "skipped" ||
    value === "complete"
    ? value
    : null;
}

function tutorialStep(value: unknown): TutorialStepId | null {
  return tutorialStepIds.includes(value as TutorialStepId)
    ? (value as TutorialStepId)
    : null;
}

function tutorialInputPath(value: unknown): TutorialInputPath | null {
  return value === "full" || value === "mouse-keyboard" ? value : null;
}

function tutorialAction(value: unknown): TutorialActionName | null {
  return typeof value === "string" &&
    tutorialActions.has(value as TutorialActionName)
    ? (value as TutorialActionName)
    : null;
}

const tutorialActions = new Set<TutorialActionName>([
  "focus",
  "traverse",
  "return",
  "topology",
  "view",
  "view-reset",
  "manipulation-start",
  "manipulation-update",
  "manipulation-end",
]);
