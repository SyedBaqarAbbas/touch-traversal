# Direct hand manipulation

The graph keeps its authored coordinates. Direct manipulation changes only a camera-view transform
held outside React render state.

## Stable mapping

- Pinch a node: select it, or traverse to it from focus mode.
- Pinch and hold empty graph space for the existing 160 ms pinch debounce: acquire the view.
- Move the grabbed hand horizontally: orbit around the graph's vertical axis.
- Move the grabbed hand vertically: pan the camera target up or down.
- Move the grabbed hand closer or farther: zoom using the palm-scale change from the start of the
  grab. A calibrated relative dead zone removes depth jitter, and the camera clamps the result.
- Release the pinch: release the view immediately. There is no inertial continuation, including
  when reduced motion is enabled.

Motion is normalized by the detected palm scale before it becomes orbit or pan. Depth uses a
smoothed palm-scale ratio, so the same relative hand movement behaves consistently across the
camera frame. Calibration stores versioned numeric neutral-scale, dead-zone, and comfortable-range
values only; no frames or landmarks are persisted.

## Mouse and keyboard fallback

The on-screen view controls expose orbit left/right, pan in four directions, zoom in/out, and reset
as ordinary buttons, so they work with a mouse, touch, switch input, and keyboard focus. The same
actions also have direct keys:

| Action     | Keyboard             | Mouse                 |
| ---------- | -------------------- | --------------------- |
| Orbit      | `A` / `D`            | orbit buttons         |
| Pan        | `Shift` + arrow keys | pan buttons           |
| Zoom       | `+` / `-`            | zoom buttons or wheel |
| Reset view | `0`                  | reset view button     |

Reset is immediate and is always available outside an editable field. Camera denial, camera
disable, hand loss, and worker failure do not affect these controls. Reset has no hand gesture;
horizontal hand movement is reserved for orbit, while the named buttons and `Shift` + left/right
provide horizontal pan.

## Pointer hover and action ownership

The mouse and visible fingertip cursor feed the same node-hover state. Moving either cursor over a
thought immediately brightens it and shows the same title label; whichever cursor moved most
recently owns hover. Losing the tracked hand does not clear a newer mouse-owned hover.

The 700 ms recent-mouse guard applies only to pinch, swipe, and direct-manipulation actions. It does
not delay fingertip hover feedback. This keeps the visible cursor responsive while preventing an
incidental gesture command during active mouse control.

## Conflict matrix

| Condition at pinch begin or during grab             | Result                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| Selectable node under the pointer                   | Keep select/traverse meaning; never acquire the view               |
| Empty graph space and stable pinch                  | Acquire the view                                                   |
| Active traversal, topology morph, or calibration    | Block acquisition; cancel an existing grab                         |
| Recent mouse input suppression window               | Block acquisition; cancel an existing grab                         |
| Open palm or topology-swipe pose while grabbed      | Manipulation owns the pinch; return/swipe stay suppressed          |
| Pinch release                                       | End cleanly with no inertia                                        |
| Hand loss, camera disable, permission/model failure | Cancel and reset the grab state                                    |
| Reduced motion                                      | Retain direct controls with no inertial or decorative continuation |

The acquisition hint appears when empty-space grab begins. A second auto-hiding hint appears on the
first meaningful orbit, pan, or zoom delta; it is not emitted continuously. The optional
`/demo?tutorial=manipulation` flow adds a persistent ordered checklist and confirms only the dominant
intentional axis for each practice movement, preventing small multi-axis landmark jitter from
completing multiple steps.
