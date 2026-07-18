# Interaction controls

The demo keeps controls small and graph-first. Keyboard shortcuts only apply when focus is not inside an editable field and no conflicting transition is active.

## Topology keys

| Key | Topology | Meaning |
| --- | --- | --- |
| `1` | semantic | Similar thoughts sit near each other. |
| `2` | communities | Cluster islands show topic neighborhoods. |
| `3` | temporal | Dated notes arrange by time when enough dates are available. |
| `4` | force | Settled force layout exposes graph structure. |

If temporal coverage is insufficient, the temporal button is disabled and the HUD shows the reason.

## Navigation keys

| Key | Action |
| --- | --- |
| `Escape` | Return from focus to overview. |

Mouse controls mirror the same topology modes through the sparse top-right HUD.

## Recording take

`/demo?recording=1` runs one deterministic 25-second take: constellation reveal, local hand
acquisition cue, selection, traversal, return with a community-topology morph, and a quiet closing
beat. The route removes navigation, node-rail, performance, and timing diagnostics from the frame.
Camera activation remains an explicit secondary control, and the take does not use audio.
