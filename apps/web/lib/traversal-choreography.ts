import type { CameraPose } from "@/lib/scene-model";
import type { Vec3 } from "@/lib/artifacts/schema";

export type TraversalChoreography = {
  cameraLagMs: number;
  distance: number;
  durationMs: number;
  sourcePosition: Vec3;
  targetPosition: Vec3;
};

export type TraversalSample = {
  cameraPosition: Vec3;
  cameraProgress: number;
  cameraTarget: Vec3;
  graphProgress: number;
  pulseOpacity: number;
  pulsePosition: Vec3;
  pulseProgress: number;
};

export const MIN_TRAVERSAL_DURATION_MS = 900;
export const MAX_TRAVERSAL_DURATION_MS = 1600;

export function createTraversalChoreography(
  sourcePosition: Vec3,
  targetPosition: Vec3,
): TraversalChoreography {
  const distance = vec3Distance(sourcePosition, targetPosition);
  const durationMs = traversalDurationMs(distance);
  return {
    cameraLagMs: durationMs * 0.14,
    distance,
    durationMs,
    sourcePosition,
    targetPosition,
  };
}

export function traversalDurationMs(distance: number): number {
  return clamp(
    MIN_TRAVERSAL_DURATION_MS + distance * 520,
    MIN_TRAVERSAL_DURATION_MS,
    MAX_TRAVERSAL_DURATION_MS,
  );
}

export function sampleTraversalChoreography(
  choreography: TraversalChoreography,
  elapsedMs: number,
  focusPose: CameraPose,
): TraversalSample {
  const graphProgress = easeInOutCubic(
    clamp(elapsedMs / choreography.durationMs, 0, 1),
  );
  const cameraProgress = easeInOutCubic(
    clamp(
      (elapsedMs - choreography.cameraLagMs) /
        Math.max(1, choreography.durationMs - choreography.cameraLagMs),
      0,
      1,
    ),
  );
  const pulseProgress = graphProgress;
  const pulsePosition = vec3Lerp(
    choreography.sourcePosition,
    choreography.targetPosition,
    pulseProgress,
  );
  const cameraTarget = vec3Lerp(
    choreography.sourcePosition,
    choreography.targetPosition,
    cameraProgress,
  );
  const arc = traversalArcOffset(
    choreography.sourcePosition,
    choreography.targetPosition,
    cameraProgress,
  );
  const cameraPosition = vec3Add(
    focusPose.position,
    vec3Add(vec3Scale(cameraTarget, 0.18), arc),
  );

  return {
    cameraPosition,
    cameraProgress,
    cameraTarget,
    graphProgress,
    pulseOpacity: pulseOpacity(pulseProgress),
    pulsePosition,
    pulseProgress,
  };
}

export function pulseOpacity(progress: number): number {
  const eased = clamp(progress, 0, 1);
  const arrivalFade = 1 - smoothstep(0.78, 1, eased);
  return Math.sin(Math.PI * eased) * arrivalFade;
}

function traversalArcOffset(
  source: Vec3,
  target: Vec3,
  progress: number,
): Vec3 {
  const dx = target[0] - source[0];
  const dy = target[1] - source[1];
  const length = Math.hypot(dx, dy) || 1;
  const normal: Vec3 = [-dy / length, dx / length, 0];
  const arcHeight = Math.min(0.18, Math.max(0.06, length * 0.18));
  return vec3Scale(normal, Math.sin(Math.PI * progress) * arcHeight);
}

function vec3Distance(left: Vec3, right: Vec3): number {
  return Math.hypot(right[0] - left[0], right[1] - left[1], right[2] - left[2]);
}

function vec3Add(left: Vec3, right: Vec3): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function vec3Scale(value: Vec3, scalar: number): Vec3 {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

function vec3Lerp(left: Vec3, right: Vec3, progress: number): Vec3 {
  if (progress <= 0) {
    return [left[0], left[1], left[2]];
  }
  if (progress >= 1) {
    return [right[0], right[1], right[2]];
  }
  return [
    left[0] + (right[0] - left[0]) * progress,
    left[1] + (right[1] - left[1]) * progress,
    left[2] + (right[2] - left[2]) * progress,
  ];
}

function easeInOutCubic(value: number): number {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const progress = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return progress * progress * (3 - 2 * progress);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
