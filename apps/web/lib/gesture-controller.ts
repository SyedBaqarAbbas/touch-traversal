import {
  normalizeClassifierInput,
  type TimestampedLandmarkFrame,
} from "@/lib/gesture-classifier";
import {
  createOpenPalmReturnState,
  updateOpenPalmReturn,
  type OpenPalmReturnState,
} from "@/lib/gesture-return";
import {
  classifyPointingIntent,
  createPinchSelectionState,
  updatePinchSelection,
  type PinchSelectionState,
} from "@/lib/gesture-selection";
import {
  createSwipeState,
  updateSwipeRecognition,
  type SwipeState,
} from "@/lib/gesture-swipe";

export type GestureControllerAction =
  | { type: "pointer"; timestampMs: number }
  | { nodeId: string; timestampMs: number; type: "select" }
  | { timestampMs: number; type: "return" }
  | { direction: "left" | "right"; timestampMs: number; type: "topology" }
  | { expiresAtMs: number; label: string; timestampMs: number; type: "hint" };

export type GestureControllerContext = {
  mouseSuppressionUntilMs?: number;
  safeToReturn: boolean;
  targetNodeId: string | null;
  topologyMorphing: boolean;
};

export type GestureControllerState = {
  openPalm: OpenPalmReturnState;
  pinch: PinchSelectionState;
  swipe: SwipeState;
};

export type GestureControllerUpdate = {
  actions: GestureControllerAction[];
  state: GestureControllerState;
};

export function createGestureControllerState(): GestureControllerState {
  return {
    openPalm: createOpenPalmReturnState(),
    pinch: createPinchSelectionState(),
    swipe: createSwipeState(),
  };
}

export function updateGestureController(
  state: GestureControllerState,
  frame: TimestampedLandmarkFrame,
  context: GestureControllerContext,
): GestureControllerUpdate {
  const handSuppressed =
    context.mouseSuppressionUntilMs != null &&
    frame.timestampMs < context.mouseSuppressionUntilMs;
  const actions: GestureControllerAction[] = [];
  const classifierInput = normalizeClassifierInput(frame);
  const pointing = classifyPointingIntent(classifierInput);
  const pinchUpdate = updatePinchSelection(state.pinch, frame);
  const openPalmUpdate = updateOpenPalmReturn(state.openPalm, frame, {
    safeToReturn: context.safeToReturn && !handSuppressed,
  });
  const swipeUpdate = updateSwipeRecognition(state.swipe, frame, {
    pinchActive: pinchUpdate.state.phase === "pressed",
    topologyMorphing: context.topologyMorphing || handSuppressed,
  });

  if (!handSuppressed && pointing.cursorUsable) {
    actions.push({
      timestampMs: frame.timestampMs,
      type: "pointer",
    });
  }

  if (
    !handSuppressed &&
    pinchUpdate.event?.type === "begin" &&
    context.targetNodeId
  ) {
    actions.push({
      nodeId: context.targetNodeId,
      timestampMs: frame.timestampMs,
      type: "select",
    });
  }

  if (!handSuppressed && openPalmUpdate.event) {
    actions.push({
      timestampMs: frame.timestampMs,
      type: "return",
    });
  }

  if (!handSuppressed && swipeUpdate.event) {
    actions.push({
      direction: swipeUpdate.event.direction,
      timestampMs: frame.timestampMs,
      type: "topology",
    });
  }

  const hint = gestureHint(actions, frame.timestampMs);
  if (hint) {
    actions.push(hint);
  }

  return {
    actions,
    state: {
      openPalm: openPalmUpdate.state,
      pinch: pinchUpdate.state,
      swipe: swipeUpdate.state,
    },
  };
}

function gestureHint(
  actions: readonly GestureControllerAction[],
  timestampMs: number,
): GestureControllerAction | null {
  const primary = actions.find((action) => action.type !== "pointer");
  if (!primary) {
    return actions.some((action) => action.type === "pointer")
      ? {
          expiresAtMs: timestampMs + 900,
          label: "gesture / pointing",
          timestampMs,
          type: "hint",
        }
      : null;
  }

  switch (primary.type) {
    case "select":
      return {
        expiresAtMs: timestampMs + 1400,
        label: "gesture / pinch select",
        timestampMs,
        type: "hint",
      };
    case "return":
      return {
        expiresAtMs: timestampMs + 1400,
        label: "gesture / open palm return",
        timestampMs,
        type: "hint",
      };
    case "topology":
      return {
        expiresAtMs: timestampMs + 1400,
        label: `gesture / ${primary.direction} swipe topology`,
        timestampMs,
        type: "hint",
      };
    case "hint":
      return null;
  }
}
