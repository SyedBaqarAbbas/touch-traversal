import type { LayoutName } from "@/lib/artifacts/schema";
import type { HandCursorFrame } from "@/lib/hand-cursor";
import { createUnifiedPointer, type UnifiedPointer } from "@/lib/pointer-model";
import { isTopologyAvailable, topologyModes } from "@/lib/topology-controls";

export function handCursorPointer(
  frame: HandCursorFrame,
  rect: Pick<DOMRect, "height" | "left" | "top" | "width">,
): UnifiedPointer {
  const clientX = rect.left + ((frame.position.x + 1) / 2) * rect.width;
  const clientY = rect.top + ((1 - frame.position.y) / 2) * rect.height;
  return createUnifiedPointer({
    active: frame.visible,
    clientX,
    clientY,
    rect,
    source: "hand",
    timestampMs: frame.timestampMs,
  });
}

export function topologyAfterSwipe(
  current: LayoutName,
  direction: "left" | "right",
  temporalAvailable: boolean,
): LayoutName {
  const available = topologyModes.filter((mode) =>
    isTopologyAvailable(mode.layoutName, temporalAvailable),
  );
  const currentIndex = Math.max(
    0,
    available.findIndex((mode) => mode.layoutName === current),
  );
  const offset = direction === "right" ? 1 : -1;
  const nextIndex =
    (currentIndex + offset + available.length) % available.length;
  return available[nextIndex]?.layoutName ?? current;
}
