"use client";

import { PerspectiveCamera } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame } from "@react-three/fiber";
import Link from "next/link";
import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

import { CameraAccessPanel } from "@/app/_components/camera-access-panel";
import type { LayoutName, Vec3 } from "@/lib/artifacts/schema";
import {
  cameraModeForInteraction,
  createInteractionState,
  reduceInteraction,
  type InteractionState,
} from "@/lib/interaction-model";
import {
  advanceHoverState,
  createIdleHoverState,
  createUnifiedPointer,
  defaultHoverConfig,
  immediateHoverState,
  type HoverState,
  type UnifiedPointer,
  updateHoverCandidate,
} from "@/lib/pointer-model";
import {
  chooseSceneQuality,
  limitThoughtLabels,
  limitVisibleItems,
  sceneQualityNotice,
} from "@/lib/performance-policy";
import {
  isEditableKeyboardTarget,
  isTopologyAvailable,
  topologyLayoutForKey,
  topologyModes,
  topologyModesByLayout,
} from "@/lib/topology-controls";
import {
  createTraversalChoreography,
  sampleTraversalChoreography,
  type TraversalChoreography,
} from "@/lib/traversal-choreography";
import {
  TRAVERSAL_HISTORY_STORAGE_KEY,
  appendTraversalHistory,
  restorePreviousFocus,
  type TraversalHistoryEntry,
} from "@/lib/traversal-history";
import { selectNodeSummaries, type GraphModel } from "@/lib/graph-model";
import {
  buildSceneEdges,
  buildFocusSceneNodes,
  buildSceneNodes,
  buildSceneThoughtLabels,
  cameraModes,
  getCameraPose,
  rankTraversableNeighbors,
  type CameraMode,
  type SceneEdge,
  type SceneNode,
  type SceneThoughtLabel,
} from "@/lib/scene-model";

const routes = [
  { href: "/", label: "home" },
  { href: "/demo", label: "demo" },
  { href: "/calibration", label: "calibration" },
  { href: "/debug", label: "debug" },
] as const;

const FOCUS_TRANSITION_MS = 1100;
export const SCENE_INTRO_DURATION_MS = 3000;

type PositionMotion = {
  currentPositions: Float32Array;
  startPositions: Float32Array;
  targetPositions: Float32Array;
  startedAtMs: number;
  durationMs: number;
};

type EdgeEndpointMotion = {
  currentEndpoints: Float32Array;
  startEndpoints: Float32Array;
  targetEndpoints: Float32Array;
  startedAtMs: number;
  durationMs: number;
};

type ActiveTraversal = TraversalChoreography & {
  edgeId: string;
  sourceNodeId: string;
  startedAtMs: number;
  targetNodeId: string;
};

type GraphSceneState = {
  hoverState: HoverState;
  interaction: InteractionState;
};

type GraphSceneAction =
  | {
      type: "POINTER_CANDIDATE";
      nodeId: string | null;
      pointer: UnifiedPointer;
    }
  | { type: "ADVANCE_HOVER"; timestampMs: number }
  | { type: "IMMEDIATE_HOVER"; nodeId: string | null; timestampMs: number }
  | { type: "SELECT_NODE"; nodeId: string; timestampMs: number }
  | { type: "FOCUS_COMPLETE"; timestampMs: number }
  | { type: "START_TRAVERSAL"; nodeId: string; timestampMs: number }
  | { type: "COMPLETE_TRAVERSAL"; nodeId: string; timestampMs: number }
  | { type: "RESTORE_FOCUS"; nodeId: string; timestampMs: number }
  | { type: "RETURN_OVERVIEW"; timestampMs: number };

export type GraphInputMode = "default" | "gesture-fixture" | "mouse";

type GestureHint = {
  label: string;
  visibleUntilMs: number;
};

type GestureActionRefs = {
  returnOverview: (timestampMs: number) => void;
  selectNode: (nodeId: string, timestampMs: number) => void;
  showGestureHint: (label: string, timestampMs?: number) => void;
  switchTopology: (nextLayoutName: LayoutName) => void;
};

export function GraphScene({
  inputMode = "default",
  model,
}: {
  inputMode?: GraphInputMode;
  model: GraphModel;
}) {
  const nodeSummaries = useMemo(() => selectNodeSummaries(model), [model]);
  const [{ hoverState, interaction }, dispatch] = useReducer(
    reduceGraphSceneState,
    undefined,
    createGraphSceneState,
  );
  const [layoutName, setLayoutName] = useState<LayoutName>("semantic");
  const [activeTraversal, setActiveTraversal] =
    useState<ActiveTraversal | null>(null);
  const [traversalHistory, setTraversalHistory] = useState<
    TraversalHistoryEntry[]
  >([]);
  const [gestureHint, setGestureHint] = useState<GestureHint | null>(null);
  const gestureActionsRef = useRef<GestureActionRefs | null>(null);
  const gestureFixtureStartedRef = useRef(false);
  const cameraMode = cameraModeForInteraction(interaction);
  const activeTopology = topologyModesByLayout[layoutName];
  const canSwitchTopology =
    interaction.mode !== "FOCUSING" &&
    interaction.mode !== "TRAVERSING" &&
    interaction.mode !== "MORPHING" &&
    interaction.mode !== "CALIBRATING";
  const hoverNodeId = hoverState.hoveredNodeId;
  const previewNodeId = hoverState.previewNodeId;
  const selectedNodeId = interaction.selectedNodeId;
  const labelHoverNodeId = selectedNodeId
    ? hoverNodeId
    : (previewNodeId ?? hoverNodeId);
  const selectedThought =
    selectedNodeId && model.graph.hasNode(selectedNodeId)
      ? model.graph.getNodeAttributes(selectedNodeId).thought
      : null;
  const activeTraversalLabel = useMemo(() => {
    if (!activeTraversal) {
      return null;
    }
    return {
      source: model.graph.hasNode(activeTraversal.sourceNodeId)
        ? model.graph.getNodeAttributes(activeTraversal.sourceNodeId).thought
            .title
        : activeTraversal.sourceNodeId,
      target: model.graph.hasNode(activeTraversal.targetNodeId)
        ? model.graph.getNodeAttributes(activeTraversal.targetNodeId).thought
            .title
        : activeTraversal.targetNodeId,
    };
  }, [activeTraversal, model]);
  const selectedNeighborCount =
    selectedNodeId && model.graph.hasNode(selectedNodeId)
      ? model.graph.degree(selectedNodeId)
      : null;
  const selectedActiveTargetCount = useMemo(
    () =>
      selectedNodeId
        ? rankTraversableNeighbors(model, selectedNodeId).filter(
            (neighbor) => neighbor.selectable,
          ).length
        : null,
    [model, selectedNodeId],
  );
  const sceneQuality = useMemo(
    () =>
      chooseSceneQuality({
        edgeCount: model.graph.size,
        nodeCount: model.graph.order,
      }),
    [model],
  );
  const sceneQualityNoticeCopy = sceneQualityNotice(sceneQuality);
  const sceneNodes = useMemo(
    () =>
      selectedNodeId
        ? buildFocusSceneNodes(model, layoutName, selectedNodeId, {
            hoverNodeId,
          })
        : buildSceneNodes(model, layoutName, {
            hoverNodeId,
          }),
    [hoverNodeId, layoutName, model, selectedNodeId],
  );
  const positionsByNodeId = useMemo(
    () => new Map(sceneNodes.map((node) => [node.id, node.position])),
    [sceneNodes],
  );
  const sceneEdges = useMemo(
    () =>
      limitVisibleItems(
        buildSceneEdges(
          model,
          layoutName,
          {
            hoverNodeId,
            selectedNodeId,
          },
          positionsByNodeId,
        ).sort(edgeRenderPriority),
        sceneQuality.maxVisibleEdges,
      ),
    [
      hoverNodeId,
      layoutName,
      model,
      positionsByNodeId,
      sceneQuality.maxVisibleEdges,
      selectedNodeId,
    ],
  );
  const sceneLabels = useMemo(
    () =>
      limitThoughtLabels(
        buildSceneThoughtLabels(model, sceneNodes, {
          hoverNodeId: labelHoverNodeId,
          selectedNodeId,
        }),
        sceneQuality.maxThoughtLabels,
      ),
    [
      labelHoverNodeId,
      model,
      sceneNodes,
      sceneQuality.maxThoughtLabels,
      selectedNodeId,
    ],
  );

  useEffect(() => {
    const timestampMs = performance.now();
    const candidateDeadline =
      hoverState.candidateEnteredAtMs == null
        ? null
        : hoverState.candidateEnteredAtMs + defaultHoverConfig.entryDelayMs;
    const dwellDeadline =
      hoverState.candidateEnteredAtMs == null
        ? null
        : hoverState.candidateEnteredAtMs + defaultHoverConfig.dwellPreviewMs;
    const nextDeadline =
      hoverState.hoveredNodeId !== hoverState.candidateNodeId
        ? candidateDeadline
        : hoverState.previewNodeId == null
          ? dwellDeadline
          : null;

    if (nextDeadline == null) {
      return;
    }

    const delay = Math.max(0, nextDeadline - timestampMs);
    const timeout = window.setTimeout(() => {
      dispatch({
        type: "ADVANCE_HOVER",
        timestampMs: performance.now(),
      });
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [hoverState]);

  const handlePointerCandidate = (
    nodeId: string | null,
    pointer: ReturnType<typeof pointerFromThreeEvent>,
  ) => {
    dispatch({
      type: "POINTER_CANDIDATE",
      nodeId,
      pointer,
    });
  };

  useEffect(() => {
    if (interaction.mode !== "FOCUSING") {
      return;
    }

    const timeout = window.setTimeout(() => {
      dispatch({
        type: "FOCUS_COMPLETE",
        timestampMs: performance.now(),
      });
    }, FOCUS_TRANSITION_MS);
    return () => window.clearTimeout(timeout);
  }, [interaction.mode, interaction.selectedNodeId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveTraversal(null);
        dispatch({
          type: "RETURN_OVERVIEW",
          timestampMs: event.timeStamp,
        });
        return;
      }

      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

      if (event.key === "Backspace") {
        const restoration = restorePreviousFocus(
          traversalHistory,
          selectedNodeId,
        );
        if (restoration) {
          event.preventDefault();
          setActiveTraversal(null);
          setTraversalHistory(restoration.history);
          persistTraversalHistory(restoration.history);
          dispatch({
            type: "RESTORE_FOCUS",
            nodeId: restoration.nodeId,
            timestampMs: event.timeStamp,
          });
        }
        return;
      }

      const nextLayoutName = topologyLayoutForKey(event);
      if (
        nextLayoutName &&
        canSwitchTopology &&
        isTopologyAvailable(nextLayoutName, model.temporal.available)
      ) {
        event.preventDefault();
        setLayoutName(nextLayoutName);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    canSwitchTopology,
    model.temporal.available,
    selectedNodeId,
    traversalHistory,
  ]);

  useEffect(() => {
    if (!activeTraversal || interaction.mode !== "TRAVERSING") {
      return;
    }

    const remainingMs = Math.max(
      0,
      activeTraversal.startedAtMs +
        activeTraversal.durationMs -
        performance.now(),
    );
    const timeout = window.setTimeout(() => {
      const completedAtMs = performance.now();
      setActiveTraversal(null);
      setTraversalHistory((history) => {
        const nextHistory = appendTraversalHistory(history, {
          edgeId: activeTraversal.edgeId,
          sourceNodeId: activeTraversal.sourceNodeId,
          targetNodeId: activeTraversal.targetNodeId,
          timestampMs: completedAtMs,
        });
        persistTraversalHistory(nextHistory);
        return nextHistory;
      });
      dispatch({
        type: "COMPLETE_TRAVERSAL",
        nodeId: activeTraversal.targetNodeId,
        timestampMs: completedAtMs,
      });
    }, remainingMs);
    return () => window.clearTimeout(timeout);
  }, [activeTraversal, interaction.mode]);

  const startTraversal = (
    sourceNodeId: string,
    targetNodeId: string,
    timestampMs: number,
  ): boolean => {
    const neighbor = rankTraversableNeighbors(model, sourceNodeId).find(
      (candidate) => candidate.nodeId === targetNodeId && candidate.selectable,
    );
    const sourcePosition = positionsByNodeId.get(sourceNodeId);
    const targetPosition = positionsByNodeId.get(targetNodeId);
    if (!neighbor || !sourcePosition || !targetPosition) {
      return false;
    }

    setActiveTraversal({
      ...createTraversalChoreography(sourcePosition, targetPosition),
      edgeId: neighbor.edgeId,
      sourceNodeId,
      startedAtMs: timestampMs,
      targetNodeId,
    });
    dispatch({
      type: "START_TRAVERSAL",
      nodeId: targetNodeId,
      timestampMs,
    });
    return true;
  };

  const selectNode = (nodeId: string, timestampMs: number) => {
    if (
      selectedNodeId &&
      selectedNodeId !== nodeId &&
      startTraversal(selectedNodeId, nodeId, timestampMs)
    ) {
      return;
    }

    setActiveTraversal(null);
    dispatch({
      type: "SELECT_NODE",
      nodeId,
      timestampMs,
    });
  };

  const returnOverview = (timestampMs: number) => {
    setActiveTraversal(null);
    dispatch({
      type: "RETURN_OVERVIEW",
      timestampMs,
    });
  };

  const switchTopology = (nextLayoutName: LayoutName) => {
    if (
      !canSwitchTopology ||
      !isTopologyAvailable(nextLayoutName, model.temporal.available)
    ) {
      return;
    }
    setLayoutName(nextLayoutName);
  };

  const showGestureHint = (label: string, timestampMs = performance.now()) => {
    const visibleUntilMs = timestampMs + 2200;
    setGestureHint({ label, visibleUntilMs });
    window.setTimeout(() => {
      setGestureHint((current) =>
        current?.visibleUntilMs === visibleUntilMs ? null : current,
      );
    }, 2250);
  };

  useEffect(() => {
    gestureActionsRef.current = {
      returnOverview,
      selectNode,
      showGestureHint,
      switchTopology,
    };
  });

  useEffect(() => {
    if (inputMode !== "gesture-fixture") {
      gestureFixtureStartedRef.current = false;
      return;
    }
    if (gestureFixtureStartedRef.current) {
      return;
    }

    const firstNodeId =
      nodeSummaries.find((node) => node.title === "Distributed note topology")
        ?.id ??
      nodeSummaries[1]?.id ??
      nodeSummaries[0]?.id;
    const traversalNodeId =
      nodeSummaries.find((node) => node.title === "Gesture traversal")?.id ??
      nodeSummaries[2]?.id ??
      firstNodeId;
    if (!firstNodeId || !traversalNodeId) {
      return;
    }

    gestureFixtureStartedRef.current = true;
    const timers = [
      window.setTimeout(() => {
        const timestampMs = performance.now();
        gestureActionsRef.current?.showGestureHint(
          "gesture / pinch select",
          timestampMs,
        );
        gestureActionsRef.current?.selectNode(firstNodeId, timestampMs);
      }, 500),
      window.setTimeout(() => {
        const timestampMs = performance.now();
        gestureActionsRef.current?.showGestureHint(
          "gesture / pinch traverse",
          timestampMs,
        );
        gestureActionsRef.current?.selectNode(traversalNodeId, timestampMs);
      }, 2800),
      window.setTimeout(() => {
        gestureActionsRef.current?.showGestureHint(
          "gesture / right swipe topology",
        );
        gestureActionsRef.current?.switchTopology("clusters");
      }, 5400),
      window.setTimeout(() => {
        const timestampMs = performance.now();
        gestureActionsRef.current?.showGestureHint(
          "gesture / open palm return",
          timestampMs,
        );
        gestureActionsRef.current?.returnOverview(timestampMs);
      }, 8200),
    ];
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      gestureFixtureStartedRef.current = false;
    };
  }, [inputMode, nodeSummaries]);

  return (
    <main className="scene-shell" style={sceneIntroStyle()}>
      <Canvas
        className="scene-canvas"
        dpr={sceneQuality.dpr}
        gl={{
          alpha: false,
          antialias: true,
          powerPreference: "high-performance",
        }}
      >
        <color attach="background" args={["#050505"]} />
        <CameraRig mode={cameraMode} traversal={activeTraversal} />
        <RelationshipEdgeInstances edges={sceneEdges} />
        {activeTraversal ? (
          <TraversalEdgePulse traversal={activeTraversal} />
        ) : null}
        <ThoughtNodeInstances halo nodes={sceneNodes} />
        <ThoughtNodeInstances nodes={sceneNodes} />
        <ThoughtNodeHitTargets
          nodes={sceneNodes}
          onPointerCandidate={handlePointerCandidate}
        />
      </Canvas>

      <header className="scene-header">
        <Link className="wordmark" href="/">
          touch traversal
        </Link>
        <p className="mode-label">
          {interaction.mode.toLowerCase()} / {cameraMode}
        </p>
      </header>

      <aside className="scene-topology-hud" aria-labelledby="topology-title">
        <p className="eyebrow">Topologies of Thoughts</p>
        <h2 id="topology-title">{activeTopology.title}</h2>
        <div className="scene-topology-glyph" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <i />
          <i />
          <i />
        </div>
        <dl>
          <div>
            <dt>mode</dt>
            <dd>{activeTopology.label}</dd>
          </div>
          <div>
            <dt>nodes</dt>
            <dd>thought notes</dd>
          </div>
          <div>
            <dt>edges</dt>
            <dd>typed relationships</dd>
          </div>
        </dl>
        <div className="scene-topology-controls" aria-label="Topology modes">
          {topologyModes.map((mode) => {
            const available = isTopologyAvailable(
              mode.layoutName,
              model.temporal.available,
            );
            return (
              <button
                aria-pressed={layoutName === mode.layoutName}
                disabled={!available || !canSwitchTopology}
                key={mode.layoutName}
                onClick={() => switchTopology(mode.layoutName)}
                title={
                  available
                    ? `${mode.description}; key ${mode.key}`
                    : (model.temporal.reason ??
                      "Temporal topology needs dated notes.")
                }
                type="button"
              >
                <span>{mode.label}</span>
                <kbd>{mode.key}</kbd>
              </button>
            );
          })}
        </div>
        {!model.temporal.available ? (
          <p className="scene-topology-note">
            temporal disabled: {model.temporal.reason}
          </p>
        ) : null}
      </aside>

      <section className="scene-overlay" aria-labelledby="scene-title">
        <p className="eyebrow">demo</p>
        <h1 id="scene-title">Graph artifact boundary</h1>
        {inputMode !== "default" ? (
          <p className="scene-input-mode">
            input / {inputMode === "mouse" ? "mouse" : "gesture fixture"}
          </p>
        ) : null}
        <p className="description">
          {model.graph.order} thoughts and {model.graph.size} relationships
          rendered as shared-buffer geometry from the {activeTopology.label}{" "}
          layout at {sceneQuality.name} quality.
        </p>

        <div className="scene-controls" aria-label="Camera modes">
          {cameraModes.map((mode) => (
            <button
              aria-pressed={cameraMode === mode}
              key={mode}
              disabled={mode !== "overview" && mode !== "focus"}
              onClick={(event) => {
                if (mode === "overview") {
                  returnOverview(event.timeStamp);
                } else if (mode === "focus" && hoverNodeId) {
                  selectNode(hoverNodeId, event.timeStamp);
                }
              }}
              type="button"
            >
              {mode}
            </button>
          ))}
          <button
            onClick={(event) => returnOverview(event.timeStamp)}
            type="button"
          >
            return
          </button>
        </div>
      </section>

      <aside className="scene-node-list" aria-label="Thought nodes">
        {nodeSummaries.slice(0, 5).map((node, index) => (
          <button
            aria-label={`Select ${node.title}`}
            aria-pressed={selectedNodeId === node.id}
            key={node.id}
            onClick={(event) => selectNode(node.id, event.timeStamp)}
            onPointerEnter={(event) =>
              dispatch({
                type: "IMMEDIATE_HOVER",
                nodeId: node.id,
                timestampMs: event.timeStamp,
              })
            }
            onPointerLeave={(event) =>
              dispatch({
                type: "IMMEDIATE_HOVER",
                nodeId: null,
                timestampMs: event.timeStamp,
              })
            }
            type="button"
          >
            <span>{node.title}</span>
            <small>{index + 1}</small>
          </button>
        ))}
      </aside>

      <div className="scene-label-layer" aria-live="polite">
        {sceneLabels.map((label) => (
          <aside
            className={`scene-thought-label scene-thought-label--${label.kind}`}
            key={`${label.kind}-${label.nodeId}`}
            style={sceneLabelStyle(label)}
          >
            <strong>{label.title}</strong>
            {label.excerpt ? <p>{label.excerpt}</p> : null}
          </aside>
        ))}
      </div>

      {hoverState.lastPointer ? (
        <span
          aria-hidden="true"
          className="scene-pointer-cue"
          style={pointerCueStyle(hoverState.lastPointer)}
        />
      ) : null}

      {selectedThought ? (
        <aside className="scene-selected-card" aria-live="polite">
          <span>selected thought</span>
          <strong>{selectedThought.title}</strong>
          <p>{selectedThought.summary}</p>
          <small>
            {selectedActiveTargetCount} active targets / {selectedNeighborCount}{" "}
            immediate neighbors
          </small>
        </aside>
      ) : null}

      {activeTraversal && activeTraversalLabel ? (
        <aside className="scene-traversal-status" aria-live="polite">
          <span>traversal edge</span>
          <strong>
            {activeTraversalLabel.source} → {activeTraversalLabel.target}
          </strong>
          <small>
            {Math.round(activeTraversal.durationMs)}ms path /{" "}
            {Math.round(activeTraversal.cameraLagMs)}ms camera lag
          </small>
        </aside>
      ) : null}

      {gestureHint ? (
        <aside className="scene-gesture-hint" aria-live="polite">
          {gestureHint.label}
        </aside>
      ) : null}

      {sceneQualityNoticeCopy ? (
        <aside className="scene-performance-note" aria-live="polite">
          <span>{sceneQualityNoticeCopy.title}</span>
          <p>{sceneQualityNoticeCopy.description}</p>
        </aside>
      ) : null}

      <CameraAccessPanel />

      <nav className="route-shell__nav scene-nav" aria-label="Prototype routes">
        {routes.map((route) => (
          <Link href={route.href} key={route.href}>
            {route.label}
          </Link>
        ))}
      </nav>
    </main>
  );
}

function sceneIntroStyle(): CSSProperties {
  return {
    "--scene-intro-duration": `${SCENE_INTRO_DURATION_MS}ms`,
    "--scene-ui-reveal-duration": `${Math.round(
      SCENE_INTRO_DURATION_MS * 0.68,
    )}ms`,
  } as CSSProperties;
}

function sceneLabelStyle(label: SceneThoughtLabel) {
  return {
    left: `${clampNumber(50 + label.position[0] * 34, 6, 92)}%`,
    opacity: label.opacity,
    top: `${clampNumber(50 - label.position[1] * 38, 9, 88)}%`,
  };
}

function pointerCueStyle(pointer: UnifiedPointer) {
  return {
    left: `${pointer.screen.x}px`,
    top: `${pointer.screen.y}px`,
  };
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function edgeRenderPriority(left: SceneEdge, right: SceneEdge): number {
  return (
    right.selected - left.selected ||
    right.opacity - left.opacity ||
    left.id.localeCompare(right.id)
  );
}

function createGraphSceneState(): GraphSceneState {
  return {
    hoverState: createIdleHoverState(),
    interaction: createInteractionState(),
  };
}

function reduceGraphSceneState(
  state: GraphSceneState,
  action: GraphSceneAction,
): GraphSceneState {
  switch (action.type) {
    case "POINTER_CANDIDATE": {
      const hoverState = updateHoverCandidate(state.hoverState, {
        nodeId: action.nodeId,
        pointer: action.pointer,
      });
      return {
        hoverState,
        interaction: syncInteractionHover(
          state.interaction,
          hoverState.hoveredNodeId,
          action.pointer.timestampMs,
        ),
      };
    }
    case "ADVANCE_HOVER": {
      const hoverState = advanceHoverState(
        state.hoverState,
        action.timestampMs,
      );
      return {
        hoverState,
        interaction: syncInteractionHover(
          state.interaction,
          hoverState.hoveredNodeId,
          action.timestampMs,
        ),
      };
    }
    case "IMMEDIATE_HOVER": {
      const hoverState = immediateHoverState(action.nodeId, action.timestampMs);
      return {
        hoverState,
        interaction: syncInteractionHover(
          state.interaction,
          hoverState.hoveredNodeId,
          action.timestampMs,
        ),
      };
    }
    case "SELECT_NODE":
      return {
        ...state,
        interaction: reduceInteraction(state.interaction, {
          type: "SELECT_NODE",
          nodeId: action.nodeId,
          timestampMs: action.timestampMs,
        }),
      };
    case "START_TRAVERSAL":
      return {
        ...state,
        interaction: reduceInteraction(state.interaction, {
          type: "START_TRAVERSAL",
          nodeId: action.nodeId,
          timestampMs: action.timestampMs,
        }),
      };
    case "COMPLETE_TRAVERSAL":
      return {
        ...state,
        interaction: reduceInteraction(state.interaction, {
          type: "COMPLETE_TRAVERSAL",
          nodeId: action.nodeId,
          timestampMs: action.timestampMs,
        }),
      };
    case "RESTORE_FOCUS":
      return {
        ...state,
        interaction: reduceInteraction(state.interaction, {
          type: "RESTORE_FOCUS",
          nodeId: action.nodeId,
          timestampMs: action.timestampMs,
        }),
      };
    case "FOCUS_COMPLETE":
      return {
        ...state,
        interaction: reduceInteraction(state.interaction, {
          type: "FOCUS_COMPLETE",
          timestampMs: action.timestampMs,
        }),
      };
    case "RETURN_OVERVIEW":
      return {
        hoverState: createIdleHoverState(),
        interaction: reduceInteraction(state.interaction, {
          type: "RETURN_OVERVIEW",
          timestampMs: action.timestampMs,
        }),
      };
  }
}

function syncInteractionHover(
  interaction: InteractionState,
  hoverNodeId: string | null,
  timestampMs: number,
): InteractionState {
  if (hoverNodeId && hoverNodeId !== interaction.hoveredNodeId) {
    return reduceInteraction(interaction, {
      type: "HOVER_START",
      nodeId: hoverNodeId,
      timestampMs,
    });
  }
  if (!hoverNodeId && interaction.hoveredNodeId) {
    return reduceInteraction(interaction, {
      type: "HOVER_END",
      timestampMs,
    });
  }
  return interaction;
}

function persistTraversalHistory(history: readonly TraversalHistoryEntry[]) {
  window.sessionStorage.setItem(
    TRAVERSAL_HISTORY_STORAGE_KEY,
    JSON.stringify(history),
  );
}

function CameraRig({
  mode,
  traversal,
}: {
  mode: CameraMode;
  traversal: ActiveTraversal | null;
}) {
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const target = useRef(new THREE.Vector3());
  const desiredPosition = useRef(new THREE.Vector3());
  const desiredTarget = useRef(new THREE.Vector3());
  const overview = getCameraPose("overview");

  useFrame((_state, delta) => {
    const camera = cameraRef.current;
    if (!camera) {
      return;
    }

    const pose = getCameraPose(mode);
    if (traversal) {
      const sample = sampleTraversalChoreography(
        traversal,
        performance.now() - traversal.startedAtMs,
        getCameraPose("focus"),
      );
      setVector(desiredPosition.current, sample.cameraPosition);
      setVector(desiredTarget.current, sample.cameraTarget);
    } else {
      setVector(desiredPosition.current, pose.position);
      setVector(desiredTarget.current, pose.target);
    }

    const alpha = 1 - Math.exp(-delta * 3.2);
    camera.position.lerp(desiredPosition.current, alpha);
    target.current.lerp(desiredTarget.current, alpha);
    camera.lookAt(target.current);
    camera.fov = THREE.MathUtils.lerp(camera.fov, pose.fov, alpha);
    camera.updateProjectionMatrix();
  });

  return (
    <PerspectiveCamera
      fov={overview.fov}
      makeDefault
      position={overview.position}
      ref={cameraRef}
    />
  );
}

function TraversalEdgePulse({ traversal }: { traversal: ActiveTraversal }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(() => {
    const mesh = meshRef.current;
    const material = materialRef.current;
    if (!mesh || !material) {
      return;
    }

    const sample = sampleTraversalChoreography(
      traversal,
      performance.now() - traversal.startedAtMs,
      getCameraPose("focus"),
    );
    mesh.position.set(...sample.pulsePosition);
    mesh.scale.setScalar(0.032 + sample.pulseOpacity * 0.03);
    material.opacity = sample.pulseOpacity * 0.66;
    mesh.visible = material.opacity > 0.01;
  });

  return (
    <mesh frustumCulled={false} ref={meshRef}>
      <sphereGeometry args={[1, 16, 8]} />
      <meshBasicMaterial
        attach="material"
        color="#fffdf6"
        depthWrite={false}
        opacity={0}
        ref={materialRef}
        transparent
      />
    </mesh>
  );
}

function setVector(target: THREE.Vector3, value: Vec3) {
  target.set(value[0], value[1], value[2]);
}

function ThoughtNodeHitTargets({
  nodes,
  onPointerCandidate,
}: {
  nodes: SceneNode[];
  onPointerCandidate: (
    nodeId: string | null,
    pointer: ReturnType<typeof pointerFromThreeEvent>,
  ) => void;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const scratch = useMemo(() => new THREE.Object3D(), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#ffffff",
        depthWrite: false,
        opacity: 0,
        transparent: true,
      }),
    [],
  );

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }

    nodes.forEach((node, index) => {
      scratch.position.set(...node.position);
      scratch.scale.setScalar(
        node.selectable > 0 && node.visible > 0 ? node.hitRadius : 0.0001,
      );
      scratch.updateMatrix();
      mesh.setMatrixAt(index, scratch.matrix);
    });
    mesh.count = nodes.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [nodes, scratch]);

  return (
    <instancedMesh
      args={[
        undefined as unknown as THREE.BufferGeometry,
        undefined as unknown as THREE.Material,
        Math.max(nodes.length, 1),
      ]}
      frustumCulled={false}
      onPointerMove={(event) => {
        event.stopPropagation();
        const node =
          typeof event.instanceId === "number" ? nodes[event.instanceId] : null;
        const nodeId =
          node && node.selectable > 0 && node.visible > 0 ? node.id : null;
        onPointerCandidate(nodeId ?? null, pointerFromThreeEvent(event));
      }}
      onPointerOut={(event) => {
        onPointerCandidate(null, pointerFromThreeEvent(event));
      }}
      ref={meshRef}
    >
      <sphereGeometry args={[1, 12, 8]} />
      <primitive attach="material" object={material} />
    </instancedMesh>
  );
}

function RelationshipEdgeInstances({ edges }: { edges: SceneEdge[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const scratch = useMemo(() => new THREE.Object3D(), []);
  const material = useMemo(() => createEdgeMaterial(), []);
  const axis = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const midpoint = useMemo(() => new THREE.Vector3(), []);
  const motionRef = useRef<EdgeEndpointMotion>({
    currentEndpoints: new Float32Array(),
    durationMs: FOCUS_TRANSITION_MS,
    startedAtMs: 0,
    startEndpoints: new Float32Array(),
    targetEndpoints: new Float32Array(),
  });

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }

    const targetEndpoints = edgeEndpoints(edges);
    const motion = motionRef.current;
    if (motion.currentEndpoints.length !== targetEndpoints.length) {
      motion.currentEndpoints = targetEndpoints.slice();
      motion.startEndpoints = targetEndpoints.slice();
    } else {
      motion.startEndpoints = motion.currentEndpoints.slice();
    }
    motion.targetEndpoints = targetEndpoints;
    motion.startedAtMs = performance.now();
    motion.durationMs = FOCUS_TRANSITION_MS;

    const opacity = new Float32Array(edges.length);
    const typeBand = new Float32Array(edges.length);
    const selected = new Float32Array(edges.length);
    const visibility = new Float32Array(edges.length);

    edges.forEach((edge, index) => {
      opacity[index] = edge.opacity;
      typeBand[index] = edge.typeBand;
      selected[index] = edge.selected;
      visibility[index] = edge.visible;
    });

    mesh.count = edges.length;
    writeEdgeMatrices(
      mesh,
      edges,
      motion.currentEndpoints,
      scratch,
      axis,
      direction,
      midpoint,
    );
    mesh.geometry.setAttribute(
      "edgeOpacity",
      new THREE.InstancedBufferAttribute(opacity, 1),
    );
    mesh.geometry.setAttribute(
      "edgeTypeBand",
      new THREE.InstancedBufferAttribute(typeBand, 1),
    );
    mesh.geometry.setAttribute(
      "edgeSelected",
      new THREE.InstancedBufferAttribute(selected, 1),
    );
    mesh.geometry.setAttribute(
      "edgeVisibility",
      new THREE.InstancedBufferAttribute(visibility, 1),
    );
  }, [axis, direction, edges, midpoint, scratch]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }

    const motion = motionRef.current;
    if (motion.targetEndpoints.length !== edges.length * 6) {
      return;
    }

    interpolateBuffer(
      motion.currentEndpoints,
      motion.startEndpoints,
      motion.targetEndpoints,
      transitionProgress(motion.startedAtMs, motion.durationMs),
    );
    writeEdgeMatrices(
      mesh,
      edges,
      motion.currentEndpoints,
      scratch,
      axis,
      direction,
      midpoint,
    );
  });

  return (
    <instancedMesh
      args={[
        undefined as unknown as THREE.BufferGeometry,
        undefined as unknown as THREE.Material,
        Math.max(edges.length, 1),
      ]}
      frustumCulled={false}
      ref={meshRef}
    >
      <cylinderGeometry args={[1, 1, 1, 6, 1, true]} />
      <primitive attach="material" object={material} />
    </instancedMesh>
  );
}

function pointerFromThreeEvent(event: ThreeEvent<PointerEvent>) {
  const target = event.nativeEvent.target;
  const rect =
    target instanceof HTMLElement
      ? target.getBoundingClientRect()
      : {
          left: 0,
          top: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        };
  return createUnifiedPointer({
    clientX: event.nativeEvent.clientX,
    clientY: event.nativeEvent.clientY,
    rect,
    source:
      event.nativeEvent.pointerType === "touch"
        ? "touch"
        : event.nativeEvent.pointerType === "pen"
          ? "hand"
          : "mouse",
    timestampMs: performance.now(),
  });
}

function ThoughtNodeInstances({
  halo = false,
  nodes,
}: {
  halo?: boolean;
  nodes: SceneNode[];
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const scratch = useMemo(() => new THREE.Object3D(), []);
  const material = useMemo(() => createNodeMaterial(halo), [halo]);
  const motionRef = useRef<PositionMotion>({
    currentPositions: new Float32Array(),
    durationMs: FOCUS_TRANSITION_MS,
    startedAtMs: 0,
    startPositions: new Float32Array(),
    targetPositions: new Float32Array(),
  });

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }

    const targetPositions = nodePositions(nodes);
    const motion = motionRef.current;
    if (motion.currentPositions.length !== targetPositions.length) {
      motion.currentPositions = targetPositions.slice();
      motion.startPositions = targetPositions.slice();
    } else {
      motion.startPositions = motion.currentPositions.slice();
    }
    motion.targetPositions = targetPositions;
    motion.startedAtMs = performance.now();
    motion.durationMs = FOCUS_TRANSITION_MS;

    const opacity = new Float32Array(nodes.length);
    const cluster = new Float32Array(nodes.length);
    const hover = new Float32Array(nodes.length);
    const selected = new Float32Array(nodes.length);
    const visibility = new Float32Array(nodes.length);

    nodes.forEach((node, index) => {
      opacity[index] = node.opacity;
      cluster[index] = node.cluster;
      hover[index] = node.hovered;
      selected[index] = node.selected;
      visibility[index] = node.visible;
    });

    mesh.count = nodes.length;
    writeNodeMatrices(mesh, nodes, motion.currentPositions, scratch, halo);
    mesh.geometry.setAttribute(
      "instanceOpacity",
      new THREE.InstancedBufferAttribute(opacity, 1),
    );
    mesh.geometry.setAttribute(
      "instanceCluster",
      new THREE.InstancedBufferAttribute(cluster, 1),
    );
    mesh.geometry.setAttribute(
      "instanceHover",
      new THREE.InstancedBufferAttribute(hover, 1),
    );
    mesh.geometry.setAttribute(
      "instanceSelected",
      new THREE.InstancedBufferAttribute(selected, 1),
    );
    mesh.geometry.setAttribute(
      "instanceVisibility",
      new THREE.InstancedBufferAttribute(visibility, 1),
    );
  }, [halo, nodes, scratch]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }

    const motion = motionRef.current;
    if (motion.targetPositions.length !== nodes.length * 3) {
      return;
    }

    interpolateBuffer(
      motion.currentPositions,
      motion.startPositions,
      motion.targetPositions,
      transitionProgress(motion.startedAtMs, motion.durationMs),
    );
    writeNodeMatrices(mesh, nodes, motion.currentPositions, scratch, halo);
  });

  return (
    <instancedMesh
      args={[
        undefined as unknown as THREE.BufferGeometry,
        undefined as unknown as THREE.Material,
        Math.max(nodes.length, 1),
      ]}
      frustumCulled={false}
      ref={meshRef}
    >
      <sphereGeometry args={[1, halo ? 10 : 14, halo ? 6 : 8]} />
      <primitive attach="material" object={material} />
    </instancedMesh>
  );
}

function nodePositions(nodes: SceneNode[]): Float32Array {
  const positions = new Float32Array(nodes.length * 3);
  nodes.forEach((node, index) => {
    const offset = index * 3;
    positions[offset] = node.position[0];
    positions[offset + 1] = node.position[1];
    positions[offset + 2] = node.position[2];
  });
  return positions;
}

function edgeEndpoints(edges: SceneEdge[]): Float32Array {
  const endpoints = new Float32Array(edges.length * 6);
  edges.forEach((edge, index) => {
    const offset = index * 6;
    endpoints[offset] = edge.sourcePosition[0];
    endpoints[offset + 1] = edge.sourcePosition[1];
    endpoints[offset + 2] = edge.sourcePosition[2];
    endpoints[offset + 3] = edge.targetPosition[0];
    endpoints[offset + 4] = edge.targetPosition[1];
    endpoints[offset + 5] = edge.targetPosition[2];
  });
  return endpoints;
}

function interpolateBuffer(
  current: Float32Array,
  start: Float32Array,
  target: Float32Array,
  progress: number,
) {
  for (let index = 0; index < current.length; index += 1) {
    current[index] = THREE.MathUtils.lerp(
      start[index],
      target[index],
      progress,
    );
  }
}

function transitionProgress(startedAtMs: number, durationMs: number): number {
  const linear = THREE.MathUtils.clamp(
    (performance.now() - startedAtMs) / durationMs,
    0,
    1,
  );
  return linear * linear * (3 - 2 * linear);
}

function writeNodeMatrices(
  mesh: THREE.InstancedMesh,
  nodes: SceneNode[],
  positions: Float32Array,
  scratch: THREE.Object3D,
  halo: boolean,
) {
  nodes.forEach((node, index) => {
    const offset = index * 3;
    const stateScale = 1 + node.hovered * 0.22 + node.selected * 0.36;
    scratch.position.set(
      positions[offset],
      positions[offset + 1],
      positions[offset + 2],
    );
    scratch.scale.setScalar(node.scale * stateScale * (halo ? 2.15 : 1));
    scratch.updateMatrix();
    mesh.setMatrixAt(index, scratch.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

function writeEdgeMatrices(
  mesh: THREE.InstancedMesh,
  edges: SceneEdge[],
  endpoints: Float32Array,
  scratch: THREE.Object3D,
  axis: THREE.Vector3,
  direction: THREE.Vector3,
  midpoint: THREE.Vector3,
) {
  edges.forEach((edge, index) => {
    const offset = index * 6;
    const sourceX = endpoints[offset];
    const sourceY = endpoints[offset + 1];
    const sourceZ = endpoints[offset + 2];
    const targetX = endpoints[offset + 3];
    const targetY = endpoints[offset + 4];
    const targetZ = endpoints[offset + 5];

    direction.set(targetX - sourceX, targetY - sourceY, targetZ - sourceZ);
    const rawLength = direction.length();
    const length = Math.max(rawLength, 0.0001);
    if (rawLength < 0.0001) {
      direction.copy(axis);
    } else {
      direction.normalize();
    }
    midpoint.set(
      (sourceX + targetX) * 0.5,
      (sourceY + targetY) * 0.5,
      (sourceZ + targetZ) * 0.5,
    );

    scratch.position.copy(midpoint);
    scratch.quaternion.setFromUnitVectors(axis, direction);
    scratch.scale.set(edge.width, length, edge.width);
    scratch.updateMatrix();
    mesh.setMatrixAt(index, scratch.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

function createNodeMaterial(halo: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthTest: true,
    depthWrite: !halo,
    fragmentShader: nodeFragmentShader,
    transparent: true,
    uniforms: {
      uHalo: { value: halo ? 1 : 0 },
    },
    vertexShader: nodeVertexShader,
  });
}

function createEdgeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthTest: true,
    depthWrite: false,
    fragmentShader: edgeFragmentShader,
    transparent: true,
    vertexShader: edgeVertexShader,
  });
}

const edgeVertexShader = `
attribute float edgeOpacity;
attribute float edgeTypeBand;
attribute float edgeSelected;
attribute float edgeVisibility;

varying float vOpacity;
varying vec3 vColor;

void main() {
  vec3 base = vec3(0.82, 0.80, 0.75);
  vec3 context = vec3(0.50, 0.49, 0.46);
  vec3 bridge = vec3(0.64, 0.63, 0.58);
  vec3 distant = vec3(0.38, 0.38, 0.36);

  vColor = base;
  vColor = mix(vColor, context, step(0.5, edgeTypeBand) * 0.55);
  vColor = mix(vColor, bridge, step(1.5, edgeTypeBand) * 0.34);
  vColor = mix(vColor, distant, step(2.5, edgeTypeBand) * 0.24);
  vColor = mix(vColor, vec3(0.96, 0.94, 0.88), edgeSelected * 0.32);
  vOpacity = edgeOpacity * edgeVisibility;

  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const edgeFragmentShader = `
varying float vOpacity;
varying vec3 vColor;

void main() {
  gl_FragColor = vec4(vColor, vOpacity);
}
`;

const nodeVertexShader = `
attribute float instanceOpacity;
attribute float instanceCluster;
attribute float instanceHover;
attribute float instanceSelected;
attribute float instanceVisibility;

uniform float uHalo;

varying float vOpacity;
varying vec3 vColor;

void main() {
  float emphasis = max(instanceHover * 0.2, instanceSelected * 0.36);
  float haloScale = mix(1.0, 0.09, uHalo);
  vOpacity = clamp(instanceOpacity * instanceVisibility * haloScale * (1.0 + emphasis), 0.0, 1.0);

  vec3 base = vec3(0.96, 0.94, 0.88);
  vec3 clusterA = vec3(0.76, 0.75, 0.70);
  vec3 clusterB = vec3(0.66, 0.65, 0.61);
  float clusterBand = mod(instanceCluster, 3.0);
  vColor = mix(base, clusterA, step(0.5, clusterBand) * 0.18);
  vColor = mix(vColor, clusterB, step(1.5, clusterBand) * 0.14);
  vColor = mix(vColor, vec3(1.0, 0.99, 0.96), instanceSelected * 0.48);

  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const nodeFragmentShader = `
varying float vOpacity;
varying vec3 vColor;

void main() {
  gl_FragColor = vec4(vColor, vOpacity);
}
`;
