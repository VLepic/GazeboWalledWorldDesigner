# Future Ideas

This file stores small product, UX, and rendering ideas that are worth keeping
for later, but are not important enough to interrupt current implementation
work.

## Structural Model

### Level Elevation Zones

- Add sub-level/elevation zones inside a regular level for cases such as a
  kitchen that is one step above a living room while still belonging to the same
  floor.
- Model this as a region or zone with a local elevation offset rather than as a
  full new level.
- Allow stairs to connect either two regular levels or two elevation zones
  within the same level.
- Keep this as part of the structural model because it affects floor slabs,
  wall bases, stairs, room detection, and later exports.

## Design And Materials

### Material And Texture Layer

- Add a separate material/finish layer for walls, floors, roofs, slabs, and
  shapes.
- Keep structural types separate from visual finishes. For example, a wall type
  should describe thickness/height, while a material assignment should describe
  plaster, brick, wood, tiles, paint, or other visible surfaces.
- Start with a small material library containing name, base color, optional
  texture asset, repeat scale, and assignment target.
- Use the 3D design renderer first; 2D plans can later show hatches or simple
  material markers only where useful.

### Exterior Window Blinds

- Add optional exterior blinds as a 3D window design extension.
- Treat blinds as a design add-on attached to `WindowDesign3D`, not as a new
  structural opening.
- Useful first parameters: enabled, color, slat angle, lowered/open amount, and
  offset in front of the window.
- A first renderer can generate a simple stack of thin slats in front of the
  window frame.

## Interaction Polish

### 3D Window Opening Interaction

- Replace the current invisible 3D opening hit-box selection feel with a more
  explicit outline-style highlight when a window opening is hovered or selected.
- Keep the hit target fully non-rendering for correctness, but add a separate
  visible outline or edge overlay so the active opening is clearer without
  relying on a nearly invisible box mesh.
- Prefer an outline, frame glow, or edge-only guide instead of any filled box,
  so the opening remains easy to read and does not interfere with glass/frame
  rendering again.
