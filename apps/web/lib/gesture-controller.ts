import {
  normalizeClassifierInput,
  type TimestampedLandmarkFrame,
} from "@/lib/gesture-classifier";
import {
  createHandManipulationState,
  updateHandManipulation,
  type HandManipulationConfig,
  type HandManipulationEvent,
  type HandManipulationState,
} from "@/lib/gesture-manipulation";
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
  | {
      event: HandManipulationEvent;
      timestampMs: number;
      type: "manipulation";
    }
  | { timestampMs: number; type: "return" }
  | { direction: "left" | "right"; timestampMs: number; type: "topology" }
  | { expiresAtMs: number; label: string; timestampMs: number; type: "hint" };

export type GestureControllerContext = {
  manipulationAllowed?: boolean;
  manipulationConfig?: HandManipulationConfig;
  mouseSuppressionUntilMs?: number;
  safeToReturn: boolean;
  targetNodeId: string | null;
  topologyMorphing: boolean;
};

export type GestureControllerState = {
  manipulation: HandManipulationState;
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
    manipulation: createHandManipulationState(),
    openPalm: createOpenPalmReturnState(),
    pinch: createPinchSelectionState(),
    swipe: createSwipeState(),
  };
}

export function cancelGestureControllerManipulation(
  state: GestureControllerState,
): GestureControllerState {
  if (state.manipulation.phase === "idle") {
    return state;
  }
  return {
    ...state,
    manipulation: createHandManipulationState(),
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
  const manipulationUpdate = updateHandManipulation(
    state.manipulation,
    frame,
    {
      allowed: Boolean(context.manipulationAllowed) && !handSuppressed,
      pinchEvent: pinchUpdate.event,
      pinchPhase: pinchUpdate.state.phase,
      targetNodeId: context.targetNodeId,
    },
    context.manipulationConfig,
  );
  const manipulationBusy =
    state.manipulation.phase === "grabbed" ||
    manipulationUpdate.state.phase === "grabbed";
  const openPalmUpdate = updateOpenPalmReturn(state.openPalm, frame, {
    safeToReturn: context.safeToReturn && !handSuppressed && !manipulationBusy,
  });
  const swipeUpdate = updateSwipeRecognition(state.swipe, frame, {
    pinchActive: pinchUpdate.state.phase === "pressed",
    topologyMorphing:
      context.topologyMorphing || handSuppressed || manipulationBusy,
  });

  if (!handSuppressed && !manipulationBusy && pointing.cursorUsable) {
    actions.push({
      timestampMs: frame.timestampMs,
      type: "pointer",
    });
  }

  if (manipulationUpdate.event) {
    actions.push({
      event: manipulationUpdate.event,
      timestampMs: manipulationUpdate.event.timestampMs,
      type: "manipulation",
    });
  }

  if (
    !handSuppressed &&
    !manipulationBusy &&
    pinchUpdate.event?.type === "begin" &&
    context.targetNodeId
  ) {
    actions.push({
      nodeId: context.targetNodeId,
      timestampMs: frame.timestampMs,
      type: "select",
    });
  }

  if (!handSuppressed && !manipulationBusy && openPalmUpdate.event) {
    actions.push({
      timestampMs: frame.timestampMs,
      type: "return",
    });
  }

  if (!handSuppressed && !manipulationBusy && swipeUpdate.event) {
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
      manipulation: manipulationUpdate.state,
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
    case "manipulation":
      if (primary.event.phase === "begin") {
        return {
          expiresAtMs: timestampMs + 1600,
          label: "gesture / pinch empty space to grab",
          timestampMs,
          type: "hint",
        };
      }
      if (primary.event.phase === "update" && primary.event.firstMotion) {
        return {
          expiresAtMs: timestampMs + 1800,
          label: "gesture / orbit · pan · depth zoom",
          timestampMs,
          type: "hint",
        };
      }
      return null;
    case "hint":
      return null;
  }
}
