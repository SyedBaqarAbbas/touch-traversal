# Visual language

Touch Traversal uses the supplied camera reference as a direction, not as a literal split-screen template. The scene should feel like a sparse nocturnal graph projected into a room: quiet, legible, and mostly empty.

## Typography

- Primary titles use the system sans stack in off-white with light weight and tight tracking.
- Interface labels use the monospace stack at small sizes, lowercase, with modest letter spacing.
- Hover labels are title-only. Selected labels may show one excerpt. Neighbor labels stay low opacity and title-only.

## Palette

- Background: `#050505`.
- Primary text and node cores: `#F2F0EA` / `#FFFDF6`.
- Secondary annotation text: `#A6A39B`.
- Lines use the same off-white family through alpha rather than hue shifts.
- The scene avoids neon colors, dashboard fills, glass panels, and rainbow legends.

## Opacity

- Default relationship lines stay fine and low contrast.
- Selected-neighborhood edges and labels gain contrast, while unrelated content recedes.
- Neighbor labels use roughly one-third opacity so they read as context, not primary navigation.
- HUD rules and borders stay around the subtle-line range so the graph remains dominant.

## Spacing

- The HUD lives in the top-right with ample empty space around it.
- Route and camera controls stay low and small, leaving the graph as the primary viewport.
- The node chooser is a dot rail instead of an always-visible title list.
- DOM thought labels are projected near graph positions and clamped away from viewport edges.

## Reference translation

The product keeps the reference's bright-node rhythm, fine grayscale relationship lines, small topology explainer, and fingertip point cue. It intentionally does not recreate the camera pane, hand skeleton overlay, dashboard panels, or literal presentation slide.
