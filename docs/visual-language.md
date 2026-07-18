# Visual language

Touch Traversal uses the supplied camera reference as a direction, not as a literal split-screen
template. The default graph scene feels like a sparse nocturnal field; opt-in performance mode
projects that graph over a mirrored person while keeping both layers quiet and legible.

## Reference audit

- Line density: relationship edges should feel numerous in overview, but each line stays fine and low alpha so the graph reads as a field rather than a mesh block.
- Bright-node rhythm: only a few nodes carry strong off-white cores at once; selected and gesture targets get the brightest treatment.
- Grayscale restraint: clusters and relationship types are separated by opacity and small luminance shifts, not hue families.
- Text scale: route title, topology annotation, hints, and hand status stay small enough to frame the graph instead of competing with it.
- Annotation placement: title and route controls sit low-left, topology context sits top-right, node dots and hand status sit low-right.

## Typography

- Primary titles use the system sans stack in off-white with light weight and tight tracking.
- Interface labels use the monospace stack at small sizes, lowercase, with modest letter spacing.
- Hover labels are title-only. Selected labels may show one excerpt. Neighbor labels stay low opacity and title-only.

## Palette

- Background: `#050505`.
- Primary text and node cores: `#F2F0EA` / `#FFFDF6`.
- Secondary annotation text: `#A6A39B`.
- Lines use the same off-white family through alpha rather than hue shifts.
- Cluster and relation differences remain monochrome/desaturated: edge and node shaders use small luminance bands only.
- The hand warning tone is desaturated (`#BDB6A0`) and should not read as yellow UI chrome.

## Opacity

- Default relationship lines stay fine and low contrast.
- Selected-neighborhood edges and labels gain contrast, while unrelated content recedes.
- Neighbor labels use roughly one-third opacity so they read as context, not primary navigation.
- HUD rules and borders stay around the subtle-line range so the graph remains dominant.

## Spacing

- The HUD lives in the top-right with ample empty space around it.
- Route and camera controls stay low and small, leaving the graph as the primary viewport.
- The node chooser ranks the nearest selectable thoughts in the current scene and shows a compact title-and-summary list by default. “Hide text” collapses it to the original dot rail without removing the accessible node controls.
- DOM thought labels are projected near graph positions and clamped away from viewport edges.
- Panels are matte, not blurred glass. They can use one-pixel rules and low-alpha fills, but no frosted-card treatment.

## Reference translation

The product keeps the reference's bright-node rhythm, fine grayscale relationship lines, small
topology explainer, and fingertip point cue. Performance mode translates its live-camera
composition into one full-viewport layer with dark safe-area gradients; it does not recreate the
hand skeleton overlay, dashboard panels, or literal presentation slide. The default `/demo` route
still has no visible camera pane.

## Rejection rules

- No neon cyberpunk palette.
- No rainbow gradients or cluster legends.
- No glass cards, large dashboard panels, or high-opacity controls over the graph.
- No oversized topology controls.
- No dense always-visible node labels.

## Screenshots

Captured on July 17, 2026 from the local demo route after the THO-52 visual pass:

- Overview: `docs/assets/visual-language-overview.png` from `/demo?input=mouse`, 1440×900.
- Focused node: `docs/assets/visual-language-focus.png` from `/demo?input=mouse` after selecting “Distributed note topology”, 1440×900.
