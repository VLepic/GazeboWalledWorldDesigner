# WaWoD Studio Curtain Wall and Glazed Roof Plan

## Purpose

This document defines a reusable construction-system approach for conservatories,
pergolas, glazed extensions, canopies, and similar lightweight structures.

The editor should not model a conservatory as one opaque special-purpose object.
It should reuse the existing wall and roof topology and let their construction
system decide how the final geometry is generated.

## Core Direction

Separate authored shape from generated construction:

- wall nodes and segments define the wall path,
- roof vertices, edges, and faces define the roof surface,
- a wall or roof system defines whether that shape becomes a solid shell, framed
  glass, polycarbonate, or another future assembly,
- renderers and exporters consume the generated geometry.

This keeps curtain walls connectable to normal walls and glazed roof faces
connectable to normal roof faces without introducing parallel editing tools.

## Curtain Wall System

The user draws a curtain wall with the existing Wall Tool and shared wall nodes.
The wall system generates:

- terminal and intermediate vertical profiles,
- top and bottom profiles,
- optional horizontal transoms,
- glass, polycarbonate, opaque, or open infill panels,
- optional selected bays converted to doors or sliding portals.

Suggested parameters:

```ts
interface CurtainWallSystem {
  kind: "CurtainWall";
  frameWidthM: number;
  frameDepthM: number;
  frameColorHex: string;
  glassThicknessM: number;
  glassColorHex: string;
  maxBayWidthM: number;
  horizontalDivisionCount: number;
  defaultInfill: "Glass" | "Polycarbonate" | "Opaque" | "Open";
}
```

The wall retains normal wall capabilities including base elevation, height, and
`FollowRoof`. A junction with a solid wall should generate a terminal profile or
adapter instead of treating the curtain wall as a transparent solid box.

## Glazed Roof System

The user authors the roof with the existing roof graph and solver. Once the roof
faces are solved, the roof system generates:

- perimeter profiles,
- rafters and optional cross-members,
- glass or polycarbonate infill panels,
- open faces when the system is used as a pergola,
- future roof-window or ventilation panels.

Suggested parameters:

```ts
interface GlazedRoofSystem {
  kind: "GlazedRoof";
  frameWidthM: number;
  frameDepthM: number;
  frameColorHex: string;
  panelThicknessM: number;
  panelColorHex: string;
  maxPanelWidthM: number;
  infill: "Glass" | "Polycarbonate" | "Open";
}
```

The existing roof solver remains responsible for elevations and planar faces.
The glazed-roof generator only subdivides each solved face and emits its frame
and infill geometry.

## Pergola and Conservatory Generator

A future `Pergola / Conservatory` tool should be a creation assistant, not a new
saved geometry type. It can:

1. collect a polygonal footprint,
2. create curtain-wall segments on selected sides,
3. create a solved roof sketch above them,
4. assign a glazed, polycarbonate, or open roof system,
5. leave every generated wall and roof element editable by the normal tools.

This allows rectangular, L-shaped, trapezoidal, and other straight-edged
structures while preserving normal node and roof-face editing.

## Rendering and Export

- The 3D building renderer should emit explicit frame and panel geometry.
- Gazebo export can emit the same profiles and panes as boxes, or use a simplified
  collision shell while retaining transparent visual panels.
- Detached preview and future design renderers should consume the same derived
  construction geometry.
- Materials and textures belong to renderer-specific output, not the structural
  wall or roof graph.

## Implementation Checklist

- [ ] Add wall-system identity independently of wall geometry and wall type size.
- [ ] Implement curtain-wall bay subdivision and frame generation.
- [ ] Add per-bay infill overrides and door/portal conversion.
- [ ] Add roof-system identity independently of solved roof geometry.
- [ ] Implement glazed-roof panel subdivision and frame generation.
- [ ] Define wall-to-curtain-wall and solid-to-glazed-roof junction behavior.
- [ ] Add simplified Gazebo collision output.
- [ ] Add the optional Pergola / Conservatory creation assistant.

