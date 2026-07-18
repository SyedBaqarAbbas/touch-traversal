import type { TimestampedLandmarkFrame } from "@/lib/gesture-classifier";
import {
  extractHandSignal,
  fadeHandSignal,
  smoothHandSignal,
  type HandSignal,
} from "@/lib/hand-signals";
import type { HandWorkerResultMessage } from "@/lib/hand-worker-protocol";

export type HandInputBridgeState = {
  lastSeenAtMs: number | null;
  signal: HandSignal | null;
};

export type HandInputBridgeUpdate = {
  landmarkFrame: TimestampedLandmarkFrame;
  state: HandInputBridgeState;
};

export function createHandInputBridgeState(): HandInputBridgeState {
  return {
    lastSeenAtMs: null,
    signal: null,
  };
}

export function updateHandInputBridge(
  state: HandInputBridgeState,
  message: HandWorkerResultMessage,
): HandInputBridgeUpdate {
  const hand = message.hands[0] ?? null;
  const landmarkFrame: TimestampedLandmarkFrame = {
    hand,
    timestampMs: message.timestampMs,
  };

  if (!hand) {
    return {
      landmarkFrame,
      state: {
        lastSeenAtMs: state.lastSeenAtMs,
        signal: state.signal
          ? fadeHandSignal(state.signal, message.timestampMs)
          : null,
      },
    };
  }

  const rawSignal = extractHandSignal(hand, message.timestampMs, state.signal);
  if (!rawSignal) {
    return {
      landmarkFrame,
      state,
    };
  }

  return {
    landmarkFrame,
    state: {
      lastSeenAtMs: message.timestampMs,
      signal: smoothHandSignal(state.signal, rawSignal),
    },
  };
}
