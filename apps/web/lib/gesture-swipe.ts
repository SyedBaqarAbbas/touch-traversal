import {
  cooldownReady,
  normalizeClassifierInput,
  palmCenter,
  velocityWindow,
  type TimestampedLandmarkFrame,
  type TimestampedPoint,
} from "@/lib/gesture-classifier";

export type SwipeDirection = "left" | "right";

export type SwipeConfig = {
  cooldownMs: number;
  directionStabilityMin: number;
  minDistance: number;
  minVelocity: number;
  windowMs: number;
};

export type SwipeContext = {
  pinchActive: boolean;
  topologyMorphing: boolean;
};

export type SwipeState = {
  lastTriggeredAtMs: number | null;
  samples: TimestampedPoint[];
};

export type SwipeMetrics = {
  direction: SwipeDirection | null;
  directionStability: number;
  displacement: number;
  velocity: number;
};

export type SwipeEvent = {
  direction: SwipeDirection;
  metrics: SwipeMetrics;
  timestampMs: number;
  type: "topology-swipe";
};

export type SwipeUpdate = {
  event: SwipeEvent | null;
  metrics: SwipeMetrics;
  state: SwipeState;
};

export const defaultSwipeConfig: SwipeConfig = {
  cooldownMs: 900,
  directionStabilityMin: 0.72,
  minDistance: 0.42,
  minVelocity: 2.1,
  windowMs: 240,
};

export function createSwipeState(): SwipeState {
  return {
    lastTriggeredAtMs: null,
    samples: [],
  };
}

export function updateSwipeRecognition(
  state: SwipeState,
  frame: TimestampedLandmarkFrame,
  context: SwipeContext,
  config: SwipeConfig = defaultSwipeConfig,
): SwipeUpdate {
  if (context.pinchActive || context.topologyMorphing || !frame.hand) {
    return {
      event: null,
      metrics: emptySwipeMetrics(),
      state: {
        lastTriggeredAtMs: state.lastTriggeredAtMs,
        samples: [],
      },
    };
  }

  const normalized = normalizeClassifierInput(frame);
  const point = normalized.palmCenter ?? palmCenter(frame.hand);
  if (!point) {
    return {
      event: null,
      metrics: emptySwipeMetrics(),
      state: {
        lastTriggeredAtMs: state.lastTriggeredAtMs,
        samples: [],
      },
    };
  }

  const samples = pruneSamples(
    [...state.samples, { point, timestampMs: frame.timestampMs }],
    frame.timestampMs,
    config.windowMs,
  );
  const metrics = swipeMetrics(samples, config.windowMs);
  const ready =
    metrics.direction != null &&
    Math.abs(metrics.displacement) >= config.minDistance &&
    Math.abs(metrics.velocity) >= config.minVelocity &&
    metrics.directionStability >= config.directionStabilityMin &&
    cooldownReady({
      cooldownMs: config.cooldownMs,
      lastTriggeredAtMs: state.lastTriggeredAtMs,
      nowMs: frame.timestampMs,
    });

  if (!ready || !metrics.direction) {
    return {
      event: null,
      metrics,
      state: {
        lastTriggeredAtMs: state.lastTriggeredAtMs,
        samples,
      },
    };
  }

  return {
    event: {
      direction: metrics.direction,
      metrics,
      timestampMs: frame.timestampMs,
      type: "topology-swipe",
    },
    metrics,
    state: {
      lastTriggeredAtMs: frame.timestampMs,
      samples: samples.slice(-1),
    },
  };
}

export function runSwipeRecognition(
  frames: readonly TimestampedLandmarkFrame[],
  context: SwipeContext,
  config: SwipeConfig = defaultSwipeConfig,
): SwipeEvent[] {
  let state = createSwipeState();
  const events: SwipeEvent[] = [];
  for (const frame of frames) {
    const update = updateSwipeRecognition(state, frame, context, config);
    state = update.state;
    if (update.event) {
      events.push(update.event);
    }
  }
  return events;
}

export function swipeMetrics(
  samples: readonly TimestampedPoint[],
  windowMs: number,
): SwipeMetrics {
  if (samples.length < 2) {
    return emptySwipeMetrics();
  }

  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const displacement = last.point.x - first.point.x;
  const velocity = velocityWindow(samples, windowMs).x;
  const pathDistance = samples.slice(1).reduce((total, sample, index) => {
    const previous = samples[index]!;
    return total + Math.abs(sample.point.x - previous.point.x);
  }, 0);
  const directionStability =
    pathDistance > 0 ? Math.min(1, Math.abs(displacement) / pathDistance) : 0;

  return {
    direction: displacement < 0 ? "left" : displacement > 0 ? "right" : null,
    directionStability,
    displacement,
    velocity,
  };
}

function pruneSamples(
  samples: readonly TimestampedPoint[],
  nowMs: number,
  windowMs: number,
): TimestampedPoint[] {
  return samples.filter((sample) => nowMs - sample.timestampMs <= windowMs);
}

function emptySwipeMetrics(): SwipeMetrics {
  return {
    direction: null,
    directionStability: 0,
    displacement: 0,
    velocity: 0,
  };
}
