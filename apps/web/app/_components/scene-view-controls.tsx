"use client";

import { useCallback, useEffect } from "react";

import {
  applyCameraViewControl,
  cameraViewControlForKeyboard,
  cameraViewControlForWheel,
  type CameraManipulationState,
  type CameraViewControl,
} from "@/lib/camera-manipulation";
import { isEditableKeyboardTarget } from "@/lib/topology-controls";

type MutableCameraManipulationRef = {
  current: CameraManipulationState;
};

export function SceneViewControls({
  disabled = false,
  manipulationRef,
  onControl,
}: {
  disabled?: boolean;
  manipulationRef: MutableCameraManipulationRef;
  onControl?: (
    control: CameraViewControl,
    source: "keyboard" | "mouse",
  ) => void;
}) {
  const applyControl = useCallback(
    (control: CameraViewControl, source: "keyboard" | "mouse") => {
      if (disabled) {
        return;
      }
      manipulationRef.current = applyCameraViewControl(
        manipulationRef.current,
        control,
      );
      onControl?.(control, source);
    },
    [disabled, manipulationRef, onControl],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }
      const control = cameraViewControlForKeyboard(event);
      if (!control) {
        return;
      }
      event.preventDefault();
      applyControl(control, "keyboard");
    };
    const onWheel = (event: WheelEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".scene-shell")) {
        return;
      }
      const control = cameraViewControlForWheel(event.deltaY);
      if (!control) {
        return;
      }
      event.preventDefault();
      applyControl(control, "mouse");
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("wheel", onWheel);
    };
  }, [applyControl]);

  return (
    <aside aria-label="View manipulation" className="scene-view-controls">
      <span>view</span>
      <div>
        {viewControls.map((control) => (
          <button
            aria-label={control.label}
            disabled={disabled}
            key={control.id}
            onClick={() => applyControl(control.id, "mouse")}
            title={control.title}
            type="button"
          >
            {control.glyph}
          </button>
        ))}
      </div>
    </aside>
  );
}

const viewControls: readonly {
  glyph: string;
  id: CameraViewControl;
  label: string;
  title: string;
}[] = [
  {
    glyph: "↶",
    id: "orbit-left",
    label: "Orbit view left",
    title: "Orbit left · A",
  },
  {
    glyph: "↷",
    id: "orbit-right",
    label: "Orbit view right",
    title: "Orbit right · D",
  },
  {
    glyph: "←",
    id: "pan-left",
    label: "Pan view left",
    title: "Pan left · Shift + Left Arrow",
  },
  {
    glyph: "↑",
    id: "pan-up",
    label: "Pan view up",
    title: "Pan up · Shift + Up Arrow",
  },
  {
    glyph: "↓",
    id: "pan-down",
    label: "Pan view down",
    title: "Pan down · Shift + Down Arrow",
  },
  {
    glyph: "→",
    id: "pan-right",
    label: "Pan view right",
    title: "Pan right · Shift + Right Arrow",
  },
  {
    glyph: "+",
    id: "zoom-in",
    label: "Zoom view in",
    title: "Zoom in · + or wheel",
  },
  {
    glyph: "−",
    id: "zoom-out",
    label: "Zoom view out",
    title: "Zoom out · - or wheel",
  },
  {
    glyph: "0",
    id: "reset",
    label: "Reset view",
    title: "Reset view · 0",
  },
];
