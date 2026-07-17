export type PointerSource = "mouse" | "touch" | "hand";

export type UnifiedPointer = {
  source: PointerSource;
  active: boolean;
  normalized: {
    x: number;
    y: number;
  };
  screen: {
    x: number;
    y: number;
  };
  timestampMs: number;
};

export type HoverConfig = {
  entryDelayMs: number;
  deadZonePx: number;
  dwellPreviewMs: number;
};

export type HoverState = {
  candidateNodeId: string | null;
  candidateEnteredAtMs: number | null;
  hoveredNodeId: string | null;
  hoveredAtMs: number | null;
  previewNodeId: string | null;
  lastPointer: UnifiedPointer | null;
};

export const defaultHoverConfig: HoverConfig = {
  entryDelayMs: 90,
  deadZonePx: 18,
  dwellPreviewMs: 450,
};

export function createIdleHoverState(): HoverState {
  return {
    candidateNodeId: null,
    candidateEnteredAtMs: null,
    hoveredNodeId: null,
    hoveredAtMs: null,
    previewNodeId: null,
    lastPointer: null,
  };
}

export function createUnifiedPointer(input: {
  source: PointerSource;
  active?: boolean;
  clientX: number;
  clientY: number;
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">;
  timestampMs: number;
}): UnifiedPointer {
  const relativeX = (input.clientX - input.rect.left) / input.rect.width;
  const relativeY = (input.clientY - input.rect.top) / input.rect.height;
  return {
    source: input.source,
    active: input.active ?? true,
    normalized: {
      x: clamp(relativeX * 2 - 1, -1, 1),
      y: clamp(-(relativeY * 2 - 1), -1, 1),
    },
    screen: {
      x: input.clientX,
      y: input.clientY,
    },
    timestampMs: input.timestampMs,
  };
}

export function updateHoverCandidate(
  state: HoverState,
  next: {
    nodeId: string | null;
    pointer: UnifiedPointer;
  },
  config: HoverConfig = defaultHoverConfig,
): HoverState {
  if (state.hoveredNodeId && shouldRetainHover(state, next, config)) {
    return advanceHoverState(
      {
        ...state,
        lastPointer: next.pointer,
      },
      next.pointer.timestampMs,
      config,
    );
  }

  if (next.nodeId === null) {
    return {
      ...createIdleHoverState(),
      lastPointer: next.pointer,
    };
  }

  if (next.nodeId === state.hoveredNodeId) {
    return advanceHoverState(
      {
        ...state,
        candidateNodeId: next.nodeId,
        candidateEnteredAtMs:
          state.candidateEnteredAtMs ?? next.pointer.timestampMs,
        lastPointer: next.pointer,
      },
      next.pointer.timestampMs,
      config,
    );
  }

  if (next.nodeId === state.candidateNodeId) {
    return advanceHoverState(
      {
        ...state,
        lastPointer: next.pointer,
      },
      next.pointer.timestampMs,
      config,
    );
  }

  return {
    candidateNodeId: next.nodeId,
    candidateEnteredAtMs: next.pointer.timestampMs,
    hoveredNodeId: state.hoveredNodeId,
    hoveredAtMs: state.hoveredAtMs,
    previewNodeId: null,
    lastPointer: next.pointer,
  };
}

export function advanceHoverState(
  state: HoverState,
  timestampMs: number,
  config: HoverConfig = defaultHoverConfig,
): HoverState {
  if (state.candidateNodeId && state.candidateEnteredAtMs != null) {
    const candidateAge = timestampMs - state.candidateEnteredAtMs;
    if (
      state.hoveredNodeId !== state.candidateNodeId &&
      candidateAge >= config.entryDelayMs
    ) {
      return {
        ...state,
        hoveredNodeId: state.candidateNodeId,
        hoveredAtMs: timestampMs,
        previewNodeId:
          candidateAge >= config.dwellPreviewMs ? state.candidateNodeId : null,
      };
    }

    if (
      state.hoveredNodeId === state.candidateNodeId &&
      candidateAge >= config.dwellPreviewMs
    ) {
      return {
        ...state,
        previewNodeId: state.candidateNodeId,
      };
    }
  }

  return state;
}

export function immediateHoverState(
  nodeId: string | null,
  timestampMs: number,
): HoverState {
  return {
    candidateNodeId: nodeId,
    candidateEnteredAtMs: nodeId ? timestampMs : null,
    hoveredNodeId: nodeId,
    hoveredAtMs: nodeId ? timestampMs : null,
    previewNodeId: null,
    lastPointer: null,
  };
}

function shouldRetainHover(
  state: HoverState,
  next: { nodeId: string | null; pointer: UnifiedPointer },
  config: HoverConfig,
): boolean {
  if (!state.lastPointer || next.nodeId === state.hoveredNodeId) {
    return false;
  }
  return (
    distance(state.lastPointer.screen, next.pointer.screen) <= config.deadZonePx
  );
}

function distance(
  left: { x: number; y: number },
  right: { x: number; y: number },
): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
