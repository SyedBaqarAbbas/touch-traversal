import type { CameraAccessStatus } from "@/lib/camera-access";
import {
  createGestureControllerState,
  updateGestureController,
  type GestureControllerAction,
  type GestureControllerState,
} from "@/lib/gesture-controller";
import {
  defaultHandManipulationConfig,
  type HandManipulationConfig,
} from "@/lib/gesture-manipulation";
import {
  defaultPinchConfig,
  defaultPointingConfig,
  type PinchPhase,
} from "@/lib/gesture-selection";
import { defaultSwipeConfig, type SwipeDirection } from "@/lib/gesture-swipe";
import type { TimestampedLandmarkFrame } from "@/lib/gesture-classifier";

export const handGestureCalibrationOrder = [
  "point",
  "pinch",
  "open-palm",
  "horizontal-sweep",
  "empty-space-grab",
  "orbit",
  "pan",
  "depth-zoom",
  "release",
] as const;

export type HandGestureCalibrationId =
  (typeof handGestureCalibrationOrder)[number];

export type HandGestureCalibrationFeedback = {
  manipulationPhase: "grabbed" | "idle";
  openPalmProgress: number;
  pinchPhase: PinchPhase;
  pinchProgress: number;
  pointProgress: number;
  swipeDirection: SwipeDirection | null;
  swipeProgress: number;
};

export type HandGestureCalibrationState = {
  completed: HandGestureCalibrationId[];
  controller: GestureControllerState;
  feedback: HandGestureCalibrationFeedback;
};

export type HandGestureCalibrationStep = {
  detail: string;
  id: HandGestureCalibrationId;
  progress: number;
  state: "active" | "blocked" | "complete";
  title: string;
};

const idleFeedback: HandGestureCalibrationFeedback = {
  manipulationPhase: "idle",
  openPalmProgress: 0,
  pinchPhase: "released",
  pinchProgress: 0,
  pointProgress: 0,
  swipeDirection: null,
  swipeProgress: 0,
};

export function createHandGestureCalibrationState(): HandGestureCalibrationState {
  return {
    completed: [],
    controller: createGestureControllerState(),
    feedback: idleFeedback,
  };
}

export function updateHandGestureCalibration(
  state: HandGestureCalibrationState,
  frame: TimestampedLandmarkFrame,
  manipulationConfig: HandManipulationConfig = defaultHandManipulationConfig,
): HandGestureCalibrationState {
  const update = updateGestureController(state.controller, frame, {
    manipulationAllowed: true,
    manipulationConfig,
    safeToReturn: true,
    targetNodeId: null,
    topologyMorphing: false,
  });
  const completed = new Set(state.completed);

  if (update.diagnostics.pointing.pointing) {
    completed.add("point");
  }
  if (update.diagnostics.pinchPhase === "pressed") {
    completed.add("pinch");
  }
  for (const action of update.actions) {
    recordGestureAction(completed, action);
  }

  return {
    completed: handGestureCalibrationOrder.filter((id) => completed.has(id)),
    controller: update.state,
    feedback: {
      manipulationPhase: update.diagnostics.manipulationPhase,
      openPalmProgress: update.diagnostics.openPalmProgress,
      pinchPhase: update.diagnostics.pinchPhase,
      pinchProgress: pinchCalibrationProgress(update.diagnostics.pinchRatio),
      pointProgress: pointCalibrationProgress(update.diagnostics.pointing),
      swipeDirection: update.diagnostics.swipe.direction,
      swipeProgress: swipeCalibrationProgress(update.diagnostics.swipe),
    },
  };
}

export function buildHandGestureCalibrationSteps(input: {
  cameraStatus: CameraAccessStatus;
  state: HandGestureCalibrationState;
}): HandGestureCalibrationStep[] {
  const cameraActive = input.cameraStatus === "active";
  const completed = new Set(input.state.completed);
  const feedback = input.state.feedback;
  const progressById: Record<HandGestureCalibrationId, number> = {
    "depth-zoom": completed.has("depth-zoom") ? 1 : 0,
    "empty-space-grab":
      completed.has("empty-space-grab") ||
      feedback.manipulationPhase === "grabbed"
        ? 1
        : 0,
    "horizontal-sweep": completed.has("horizontal-sweep")
      ? 1
      : feedback.swipeProgress,
    "open-palm": completed.has("open-palm") ? 1 : feedback.openPalmProgress,
    orbit: completed.has("orbit") ? 1 : 0,
    pan: completed.has("pan") ? 1 : 0,
    pinch: completed.has("pinch") ? 1 : feedback.pinchProgress,
    point: completed.has("point") ? 1 : feedback.pointProgress,
    release: completed.has("release") ? 1 : 0,
  };

  return gestureStepDefinitions.map((definition) => {
    const isComplete = completed.has(definition.id);
    const progress = progressById[definition.id];
    return {
      detail: isComplete
        ? definition.complete
        : cameraActive
          ? `${definition.instruction} ${progressLabel(definition.id, progress, feedback)}`
          : "Enable the hand camera to rehearse this gesture with the production recognizer.",
      id: definition.id,
      progress,
      state: isComplete ? "complete" : cameraActive ? "active" : "blocked",
      title: definition.title,
    };
  });
}

function recordGestureAction(
  completed: Set<HandGestureCalibrationId>,
  action: GestureControllerAction,
) {
  if (action.type === "return") {
    completed.add("open-palm");
    return;
  }
  if (action.type === "topology") {
    completed.add("horizontal-sweep");
    return;
  }
  if (action.type !== "manipulation") {
    return;
  }

  if (action.event.phase === "begin") {
    completed.add("empty-space-grab");
    return;
  }
  if (action.event.phase === "end") {
    completed.add("release");
    return;
  }
  if (action.event.phase !== "update") {
    return;
  }
  if (Math.abs(action.event.delta.orbitYaw) > 0.0001) {
    completed.add("orbit");
  }
  if (Math.abs(action.event.delta.panY) > 0.0001) {
    completed.add("pan");
  }
  if (Math.abs(action.event.delta.zoom) > 0.0001) {
    completed.add("depth-zoom");
  }
}

function pointCalibrationProgress(input: {
  confidence: number;
  foldedScore: number;
  indexScore: number;
  pointing: boolean;
}): number {
  if (input.pointing) return 1;
  const confidence =
    input.confidence / defaultPointingConfig.poseConfidenceFloor;
  const index = input.indexScore / defaultPointingConfig.indexExtensionMin;
  const folded =
    input.foldedScore /
    Math.max(0.01, 1 - defaultPointingConfig.foldedFingerMaxExtension);
  return clamp(Math.min(confidence, index, folded), 0, 0.99);
}

function pinchCalibrationProgress(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return clamp(
    (1 - ratio) / Math.max(0.01, 1 - defaultPinchConfig.startRatio),
    0,
    1,
  );
}

function swipeCalibrationProgress(input: {
  directionStability: number;
  displacement: number;
  velocity: number;
}): number {
  if (Math.abs(input.displacement) <= 0) return 0;
  return clamp(
    Math.min(
      Math.abs(input.displacement) / defaultSwipeConfig.minDistance,
      Math.abs(input.velocity) / defaultSwipeConfig.minVelocity,
      input.directionStability / defaultSwipeConfig.directionStabilityMin,
    ),
    0,
    1,
  );
}

function progressLabel(
  id: HandGestureCalibrationId,
  progress: number,
  feedback: HandGestureCalibrationFeedback,
): string {
  if (id === "horizontal-sweep" && feedback.swipeDirection) {
    return `Live ${feedback.swipeDirection} sweep: ${Math.round(progress * 100)}%.`;
  }
  if (id === "pinch" && feedback.pinchPhase === "pressed") {
    return "Pinch held.";
  }
  if (id === "empty-space-grab" && feedback.manipulationPhase === "grabbed") {
    return "Grab held; keep pinching for orbit, pan, and depth zoom.";
  }
  if (progress > 0) {
    return `Live recognition: ${Math.round(progress * 100)}%.`;
  }
  return "Waiting for the gesture.";
}

const gestureStepDefinitions: readonly {
  complete: string;
  id: HandGestureCalibrationId;
  instruction: string;
  title: string;
}[] = [
  {
    complete:
      "Point recognized. Pointing now moves the cursor and brightens a thought; pinching performs selection.",
    id: "point",
    instruction:
      "Extend your index finger, fold the other fingers, and move the fingertip across the preview.",
    title: "Finger point",
  },
  {
    complete:
      "Stable pinch recognized. The same pinch focuses a thought or traverses to a connected thought.",
    id: "pinch",
    instruction:
      "Touch thumb and index finger together and hold until the debounce completes.",
    title: "Pinch select or traverse",
  },
  {
    complete: "Open-palm hold recognized as the return gesture.",
    id: "open-palm",
    instruction:
      "Open all five fingers and hold the palm steady for about half a second.",
    title: "Open-palm return",
  },
  {
    complete:
      "Horizontal sweep passed the production distance, speed, and direction-stability thresholds.",
    id: "horizontal-sweep",
    instruction:
      "With an open, unpinched hand, sweep quickly and steadily from one side to the other.",
    title: "Horizontal topology sweep",
  },
  {
    complete: "Empty-space pinch grab recognized.",
    id: "empty-space-grab",
    instruction:
      "Pinch and keep holding. In the graph, begin this away from every thought.",
    title: "Empty-space grab",
  },
  {
    complete: "Horizontal grabbed movement recognized as orbit.",
    id: "orbit",
    instruction: "Keep the empty-space pinch held and move left or right.",
    title: "Grab and orbit",
  },
  {
    complete: "Vertical grabbed movement recognized as pan.",
    id: "pan",
    instruction: "Keep the empty-space pinch held and move up or down.",
    title: "Grab and pan",
  },
  {
    complete: "Grabbed palm-scale movement recognized as depth zoom.",
    id: "depth-zoom",
    instruction:
      "Keep the empty-space pinch held and move your hand closer to or farther from the camera.",
    title: "Grab and depth zoom",
  },
  {
    complete: "Pinch release recognized; the view grab ends safely.",
    id: "release",
    instruction: "Open thumb and index finger to release the view grab.",
    title: "Release grab",
  },
];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
