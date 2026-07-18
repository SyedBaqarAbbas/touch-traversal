import type { CameraAccessStatus } from "@/lib/camera-access";
import {
  handCursorFrameFromSignal,
  handCursorScreenStyle,
} from "@/lib/hand-cursor";
import { extractHandSignal, type HandSignal } from "@/lib/hand-signals";
import {
  defaultHandManipulationConfig,
  type HandManipulationConfig,
} from "@/lib/gesture-manipulation";
import type {
  NormalizedHand,
  NormalizedHandLandmark,
} from "@/lib/hand-worker-protocol";

export const HAND_CALIBRATION_VERSION = 2;
export const HAND_CALIBRATION_STORAGE_KEY =
  "touch-traversal.hand-calibration.v2";
const LEGACY_HAND_CALIBRATION_STORAGE_KEY =
  "touch-traversal.hand-calibration.v1";

export type HandCalibrationSettings = {
  confidenceFloor: number;
  cursorSmoothingMs: number;
  depthDeadZoneRatio: number;
  depthNeutralPalmScale: number;
  depthRangeRatio: number;
  mirrored: boolean;
  pinchClosedDistance: number;
  pinchOpenDistance: number;
  version: typeof HAND_CALIBRATION_VERSION;
};

export type CalibrationStepId =
  "permission-framing" | "fingertip-motion" | "pinch-threshold" | "depth-range";

export type CalibrationStepState = "active" | "blocked" | "complete";

export type CalibrationStep = {
  detail: string;
  id: CalibrationStepId;
  state: CalibrationStepState;
  title: string;
};

export type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export type CalibrationHandSummary = {
  confidence: number;
  cursorLeft: string;
  cursorTop: string;
  pinchProgress: number;
  signal: HandSignal;
};

export const defaultHandCalibrationSettings: HandCalibrationSettings = {
  confidenceFloor: 0.48,
  cursorSmoothingMs: 42,
  depthDeadZoneRatio: 0.045,
  depthNeutralPalmScale: 0.22,
  depthRangeRatio: 0.45,
  mirrored: true,
  pinchClosedDistance: 0.28,
  pinchOpenDistance: 0.78,
  version: HAND_CALIBRATION_VERSION,
};

export function loadHandCalibrationSettings(
  storage: StorageLike,
): HandCalibrationSettings {
  const current = storage.getItem(HAND_CALIBRATION_STORAGE_KEY);
  if (current) {
    return parseHandCalibrationSettings(current);
  }
  return migrateLegacyHandCalibrationSettings(
    storage.getItem(LEGACY_HAND_CALIBRATION_STORAGE_KEY),
  );
}

export function saveHandCalibrationSettings(
  storage: StorageLike,
  settings: HandCalibrationSettings,
): HandCalibrationSettings {
  const sanitized = sanitizeHandCalibrationSettings(settings);
  storage.setItem(HAND_CALIBRATION_STORAGE_KEY, JSON.stringify(sanitized));
  storage.removeItem(LEGACY_HAND_CALIBRATION_STORAGE_KEY);
  return sanitized;
}

export function resetHandCalibrationSettings(
  storage: StorageLike,
): HandCalibrationSettings {
  storage.removeItem(HAND_CALIBRATION_STORAGE_KEY);
  storage.removeItem(LEGACY_HAND_CALIBRATION_STORAGE_KEY);
  return defaultHandCalibrationSettings;
}

export function parseHandCalibrationSettings(
  value: string | null,
): HandCalibrationSettings {
  if (!value) {
    return defaultHandCalibrationSettings;
  }

  try {
    return sanitizeHandCalibrationSettings(JSON.parse(value));
  } catch {
    return defaultHandCalibrationSettings;
  }
}

export function sanitizeHandCalibrationSettings(
  value: unknown,
): HandCalibrationSettings {
  if (!isRecord(value) || value.version !== HAND_CALIBRATION_VERSION) {
    return defaultHandCalibrationSettings;
  }

  const pinchClosedDistance = readNumber(
    value.pinchClosedDistance,
    defaultHandCalibrationSettings.pinchClosedDistance,
    0.12,
    0.64,
  );
  const pinchOpenDistance = readNumber(
    value.pinchOpenDistance,
    defaultHandCalibrationSettings.pinchOpenDistance,
    pinchClosedDistance + 0.1,
    1.4,
  );

  return {
    confidenceFloor: readNumber(
      value.confidenceFloor,
      defaultHandCalibrationSettings.confidenceFloor,
      0.1,
      0.9,
    ),
    cursorSmoothingMs: readNumber(
      value.cursorSmoothingMs,
      defaultHandCalibrationSettings.cursorSmoothingMs,
      8,
      160,
    ),
    depthDeadZoneRatio: readNumber(
      value.depthDeadZoneRatio,
      defaultHandCalibrationSettings.depthDeadZoneRatio,
      0.015,
      0.12,
    ),
    depthNeutralPalmScale: readNumber(
      value.depthNeutralPalmScale,
      defaultHandCalibrationSettings.depthNeutralPalmScale,
      0.05,
      0.6,
    ),
    depthRangeRatio: readNumber(
      value.depthRangeRatio,
      defaultHandCalibrationSettings.depthRangeRatio,
      0.18,
      0.9,
    ),
    mirrored:
      typeof value.mirrored === "boolean"
        ? value.mirrored
        : defaultHandCalibrationSettings.mirrored,
    pinchClosedDistance,
    pinchOpenDistance,
    version: HAND_CALIBRATION_VERSION,
  };
}

export function adjustPinchThresholds(
  settings: HandCalibrationSettings,
  direction: "looser" | "tighter",
): HandCalibrationSettings {
  const delta = direction === "looser" ? 0.04 : -0.04;
  return sanitizeHandCalibrationSettings({
    ...settings,
    pinchClosedDistance: settings.pinchClosedDistance + delta,
    pinchOpenDistance: settings.pinchOpenDistance + delta,
  });
}

export function adjustDepthRange(
  settings: HandCalibrationSettings,
  direction: "less-sensitive" | "more-sensitive",
): HandCalibrationSettings {
  const delta = direction === "more-sensitive" ? -0.05 : 0.05;
  return sanitizeHandCalibrationSettings({
    ...settings,
    depthRangeRatio: settings.depthRangeRatio + delta,
  });
}

export function captureNeutralPalmScale(
  settings: HandCalibrationSettings,
  palmScale: number,
): HandCalibrationSettings {
  return sanitizeHandCalibrationSettings({
    ...settings,
    depthNeutralPalmScale: palmScale,
  });
}

export function manipulationConfigFromCalibration(
  settings: HandCalibrationSettings,
): HandManipulationConfig {
  return {
    ...defaultHandManipulationConfig,
    depthDeadZoneRatio: settings.depthDeadZoneRatio,
    depthRangeRatio: settings.depthRangeRatio,
  };
}

export function buildHandCalibrationSteps(input: {
  cameraStatus: CameraAccessStatus;
  settings: HandCalibrationSettings;
  signal: Pick<HandSignal, "confidence" | "palmSize" | "pinchDistance"> | null;
}): CalibrationStep[] {
  const cameraBlocked =
    input.cameraStatus === "denied" ||
    input.cameraStatus === "error" ||
    input.cameraStatus === "unsupported";
  const cameraActive = input.cameraStatus === "active";
  const signalConfident =
    !!input.signal && input.signal.confidence >= input.settings.confidenceFloor;
  const pinchSeen =
    !!input.signal &&
    input.signal.pinchDistance <= input.settings.pinchOpenDistance;
  const depthSeen =
    signalConfident &&
    !!input.signal &&
    input.signal.palmSize >= 0.05 &&
    input.signal.palmSize <= 0.6;

  return [
    {
      detail: cameraBlocked
        ? "Camera access is unavailable; mouse and keyboard still work."
        : cameraActive
          ? "Camera is active and the preview is mirrored for natural motion."
          : "Enable the local camera and frame one hand inside the preview.",
      id: "permission-framing",
      state: cameraBlocked ? "blocked" : cameraActive ? "complete" : "active",
      title: "Permission and framing",
    },
    {
      detail: signalConfident
        ? "Fingertip motion is producing a stable cursor signal."
        : cameraActive
          ? "Move your index fingertip slowly across the preview."
          : "Complete camera permission before checking fingertip motion.",
      id: "fingertip-motion",
      state: signalConfident ? "complete" : cameraActive ? "active" : "blocked",
      title: "Fingertip motion",
    },
    {
      detail: pinchSeen
        ? "Pinch distance is inside the calibrated open/closed range."
        : cameraActive
          ? "Pinch thumb and index finger, then adjust thresholds if needed."
          : "Complete camera permission before tuning pinch thresholds.",
      id: "pinch-threshold",
      state: pinchSeen ? "complete" : cameraActive ? "active" : "blocked",
      title: "Pinch threshold",
    },
    {
      detail: depthSeen
        ? "Palm scale is available as a stable local depth reference. Move closer and farther to check the comfortable range."
        : cameraActive
          ? "Hold an open hand at a comfortable neutral depth, then move slightly closer and farther."
          : "Complete camera permission before tuning depth range.",
      id: "depth-range",
      state: depthSeen ? "complete" : cameraActive ? "active" : "blocked",
      title: "Depth range",
    },
  ];
}

export function calibrationPinchProgress(
  settings: HandCalibrationSettings,
  pinchDistance: number,
): number {
  return clamp(
    (settings.pinchOpenDistance - pinchDistance) /
      (settings.pinchOpenDistance - settings.pinchClosedDistance),
    0,
    1,
  );
}

export function summarizeCalibrationHand(input: {
  hand: NormalizedHand;
  nowMs: number;
  settings: HandCalibrationSettings;
}): CalibrationHandSummary | null {
  const signal = extractHandSignal(input.hand, input.nowMs);
  if (!signal) {
    return null;
  }

  const cursor = handCursorFrameFromSignal({
    cameraActive: true,
    lastSeenAtMs: input.nowMs,
    nowMs: input.nowMs,
    signal,
  });
  if (!cursor) {
    return null;
  }

  const screen = handCursorScreenStyle(cursor);
  return {
    confidence: signal.confidence,
    cursorLeft: screen.left,
    cursorTop: screen.top,
    pinchProgress: calibrationPinchProgress(
      input.settings,
      signal.pinchDistance,
    ),
    signal,
  };
}

export function createInjectedCalibrationHand(
  overrides: Partial<NormalizedHandLandmark>[] = [],
): NormalizedHand {
  const landmarks: NormalizedHandLandmark[] = Array.from(
    { length: 21 },
    (_, index) => ({
      visibility: null,
      x: 0.5 + Math.cos(index) * 0.018,
      y: 0.52 + Math.sin(index) * 0.018,
      z: 0,
    }),
  );
  landmarks[0] = { visibility: null, x: 0.5, y: 0.74, z: 0 };
  landmarks[4] = { visibility: null, x: 0.43, y: 0.42, z: 0 };
  landmarks[5] = { visibility: null, x: 0.4, y: 0.58, z: 0 };
  landmarks[8] = { visibility: null, x: 0.56, y: 0.31, z: 0 };
  landmarks[9] = { visibility: null, x: 0.5, y: 0.55, z: 0 };
  landmarks[17] = { visibility: null, x: 0.62, y: 0.59, z: 0 };

  for (const [index, override] of overrides.entries()) {
    landmarks[index] = {
      ...landmarks[index],
      ...override,
    };
  }

  return {
    handedness: "Right",
    landmarks,
    score: 0.86,
  };
}

function readNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return clamp(value, minimum, maximum);
}

function migrateLegacyHandCalibrationSettings(
  value: string | null,
): HandCalibrationSettings {
  if (!value) {
    return defaultHandCalibrationSettings;
  }
  try {
    const legacy = JSON.parse(value);
    if (!isRecord(legacy) || legacy.version !== 1) {
      return defaultHandCalibrationSettings;
    }
    return sanitizeHandCalibrationSettings({
      ...legacy,
      depthDeadZoneRatio: defaultHandCalibrationSettings.depthDeadZoneRatio,
      depthNeutralPalmScale:
        defaultHandCalibrationSettings.depthNeutralPalmScale,
      depthRangeRatio: defaultHandCalibrationSettings.depthRangeRatio,
      version: HAND_CALIBRATION_VERSION,
    });
  } catch {
    return defaultHandCalibrationSettings;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
