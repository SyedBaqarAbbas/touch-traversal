import type { CameraPose } from "@/lib/scene-model";

import type { HandManipulationDelta } from "@/lib/gesture-manipulation";

export type CameraManipulationState = {
  orbitPitch: number;
  orbitYaw: number;
  panX: number;
  panY: number;
  zoom: number;
};

export type CameraViewControl =
  | "orbit-left"
  | "orbit-right"
  | "pan-down"
  | "pan-left"
  | "pan-right"
  | "pan-up"
  | "reset"
  | "zoom-in"
  | "zoom-out";

export const defaultCameraManipulationLimits = {
  maxOrbitPitch: 0.62,
  maxPan: 1.2,
  maxZoomIn: 1.05,
  maxZoomOut: 0.75,
} as const;

export function createCameraManipulationState(): CameraManipulationState {
  return {
    orbitPitch: 0,
    orbitYaw: 0,
    panX: 0,
    panY: 0,
    zoom: 0,
  };
}

export function applyHandManipulationDelta(
  state: CameraManipulationState,
  delta: HandManipulationDelta,
): CameraManipulationState {
  return clampCameraManipulation({
    ...state,
    orbitYaw: state.orbitYaw + delta.orbitYaw,
    panY: state.panY + delta.panY,
    zoom: state.zoom + delta.zoom,
  });
}

export function applyCameraViewControl(
  state: CameraManipulationState,
  control: CameraViewControl,
): CameraManipulationState {
  if (control === "reset") {
    return createCameraManipulationState();
  }
  const next = { ...state };
  switch (control) {
    case "orbit-left":
      next.orbitYaw -= 0.12;
      break;
    case "orbit-right":
      next.orbitYaw += 0.12;
      break;
    case "pan-down":
      next.panY -= 0.08;
      break;
    case "pan-left":
      next.panX -= 0.08;
      break;
    case "pan-right":
      next.panX += 0.08;
      break;
    case "pan-up":
      next.panY += 0.08;
      break;
    case "zoom-in":
      next.zoom += 0.1;
      break;
    case "zoom-out":
      next.zoom -= 0.1;
      break;
  }
  return clampCameraManipulation(next);
}

export function cameraViewControlForKeyboard(
  event: Pick<
    KeyboardEvent,
    "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
  >,
): CameraViewControl | null {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return null;
  }
  if (event.shiftKey) {
    switch (event.key) {
      case "ArrowDown":
        return "pan-down";
      case "ArrowLeft":
        return "pan-left";
      case "ArrowRight":
        return "pan-right";
      case "ArrowUp":
        return "pan-up";
      default:
        return null;
    }
  }
  switch (event.key.toLowerCase()) {
    case "a":
      return "orbit-left";
    case "d":
      return "orbit-right";
    case "+":
    case "=":
      return "zoom-in";
    case "-":
    case "_":
      return "zoom-out";
    case "0":
      return "reset";
    default:
      return null;
  }
}

export function cameraViewControlForWheel(
  deltaY: number,
): CameraViewControl | null {
  if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 1) {
    return null;
  }
  return deltaY < 0 ? "zoom-in" : "zoom-out";
}

export function cameraPoseWithManipulation(
  pose: CameraPose,
  manipulation: CameraManipulationState,
): CameraPose {
  const target: [number, number, number] = [
    pose.target[0] + manipulation.panX,
    pose.target[1] + manipulation.panY,
    pose.target[2],
  ];
  const offset = {
    x: pose.position[0] - pose.target[0],
    y: pose.position[1] - pose.target[1],
    z: pose.position[2] - pose.target[2],
  };
  const cosYaw = Math.cos(manipulation.orbitYaw);
  const sinYaw = Math.sin(manipulation.orbitYaw);
  const yawed = {
    x: offset.x * cosYaw + offset.z * sinYaw,
    y: offset.y,
    z: offset.z * cosYaw - offset.x * sinYaw,
  };
  const cosPitch = Math.cos(manipulation.orbitPitch);
  const sinPitch = Math.sin(manipulation.orbitPitch);
  const zoomScale = Math.exp(-manipulation.zoom * 0.72);
  const rotated = {
    x: yawed.x * zoomScale,
    y: (yawed.y * cosPitch - yawed.z * sinPitch) * zoomScale,
    z: (yawed.y * sinPitch + yawed.z * cosPitch) * zoomScale,
  };

  return {
    ...pose,
    position: [
      target[0] + rotated.x,
      target[1] + rotated.y,
      target[2] + rotated.z,
    ],
    target,
  };
}

function clampCameraManipulation(
  state: CameraManipulationState,
): CameraManipulationState {
  return {
    orbitPitch: clamp(
      state.orbitPitch,
      -defaultCameraManipulationLimits.maxOrbitPitch,
      defaultCameraManipulationLimits.maxOrbitPitch,
    ),
    orbitYaw: wrapRadians(state.orbitYaw),
    panX: clamp(
      state.panX,
      -defaultCameraManipulationLimits.maxPan,
      defaultCameraManipulationLimits.maxPan,
    ),
    panY: clamp(
      state.panY,
      -defaultCameraManipulationLimits.maxPan,
      defaultCameraManipulationLimits.maxPan,
    ),
    zoom: clamp(
      state.zoom,
      -defaultCameraManipulationLimits.maxZoomOut,
      defaultCameraManipulationLimits.maxZoomIn,
    ),
  };
}

function wrapRadians(value: number): number {
  const fullTurn = Math.PI * 2;
  return ((((value + Math.PI) % fullTurn) + fullTurn) % fullTurn) - Math.PI;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
