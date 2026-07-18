# Interaction controls

The demo keeps controls small and graph-first. Keyboard shortcuts only apply when focus is not
inside an editable field and no conflicting transition is active. Camera permission is optional;
mouse and keyboard remain available after denial, device failure, or model failure.

## Topology keys

| Key | Topology    | Meaning                                                      |
| --- | ----------- | ------------------------------------------------------------ |
| `1` | semantic    | Similar thoughts sit near each other.                        |
| `2` | communities | Cluster islands show topic neighborhoods.                    |
| `3` | temporal    | Dated notes arrange by time when enough dates are available. |
| `4` | force       | Settled force layout exposes graph structure.                |

If temporal coverage is insufficient, the temporal button is disabled and the HUD shows the reason.

## Navigation keys

| Key         | Action                                                              |
| ----------- | ------------------------------------------------------------------- |
| `Escape`    | Return from focus to overview.                                      |
| `Backspace` | Restore the previous focused thought when traversal history exists. |

Mouse controls mirror topology modes through the sparse top-right HUD. Hovering a node reveals its
title, clicking focuses it, and clicking an active focused neighbor starts traversal.

## Live hand controls

After **Enable hand camera** starts the local worker:

| Gesture             | Action                                               |
| ------------------- | ---------------------------------------------------- |
| Point at a node     | Move the hand cursor and establish the hover target. |
| Pinch over a target | Focus it, or traverse when it is an active neighbor. |
| Hold an open palm   | Return from a focused thought to overview.           |
| Swipe horizontally  | Cycle through available topology modes.              |

Pinch hysteresis, open-palm hold time, swipe guards, and cooldowns prevent single-frame actions.
Recent mouse movement takes precedence for 700 ms, after which hand input resumes automatically.
The injected-fixture browser flow uses the same cursor and landmark handlers as live input.

## Recording take

`/demo?recording=1` runs one deterministic 25-second take: constellation reveal, local hand
acquisition cue, selection, traversal, return with a community-topology morph, and a quiet closing
beat. The route removes navigation, node-rail, performance, and timing diagnostics from the frame.
Camera activation remains an explicit secondary control, and the take does not use audio.
