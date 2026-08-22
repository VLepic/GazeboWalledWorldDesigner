# WaWoD Studio Roof System Plan

## Purpose

This document defines the planned roof system for WaWoD Studio.

The roof system should move from the current rectangle/slab roof prototype toward
a sketch-and-solver model:

- the user draws roof edges, ridge edges, apex points, and face connections in
  plan,
- the solver computes missing elevations from explicit heights or slope
  constraints,
- the solved output is a set of planar roof faces,
- renderers, wall-follow logic, attic planning, and roof-window tools consume the
  same solved roof representation.

Gazebo compatibility is not the primary design driver for this system. For
Gazebo, flat slab-like roofs can remain a simplified export path.

## Product Intention

Roofs belong primarily to the design and house-planning branch of the editor.

The current structural/Gazebo-oriented model already covers:

- walls,
- doors,
- windows,
- slabs,
- stairs.

The roof system should add the richer house-design layer needed for:

- attic modeling,
- roof-following walls,
- roof windows,
- roof materials,
- 2D plan projection,
- and custom 3D roof geometry.

## Core Direction

### 1. Roof types become templates, not truth

Terms like `shed`, `gable`, and `hip/tent` should become creation helpers.

The saved and solved model should not primarily be:

```ts
roofType: "Shed" | "Gable" | "Hip";
```

Instead, those tools should generate roof sketch primitives:

- shed/pultova roof: one lower edge + one upper edge + one face,
- gable/sedlova roof: two lower eave edges + one ridge edge + two faces,
- tent/stanova roof: multiple lower edges + one apex point or short ridge edges
  + triangular faces.

After creation, the roof is just a graph of vertices, edges, faces, and
constraints.

### 2. Solver first, mesh second

The system must first solve the roof mathematically.

Only then should it generate:

- 3D geometry,
- 2D projections,
- wall height adaptation,
- attic usable-space logic,
- roof-window placement planes,
- material and tile layers.

### 3. Shared points solve corner joins

Roof corner joins should not be a separate mesh trick.

If two or more roof faces meet in one vertex, the solver should give that vertex
one final elevation. The faces then linearly connect to that same point. This
naturally solves many corner and hip-style joins without special-case geometry.

### 4. 2D remains construction-clean

The 2D plan should stay close to structural/design intent:

- draw roof guide edges and face connections,
- set heights/slopes,
- show roof slices on relevant levels,
- avoid arbitrary freeform 3D-only roof edits in the structural layer.

The 3D view can later add design assets, materials, roof windows, tiles, and
visual details.

## Dedicated Roof Drawing Layer

Roofs need their own drawing layer, separate from normal floor levels.

Reason:

- a roof may start at 2.8 m while affecting walls on multiple levels,
- walls in all levels may need to query the same roof,
- attic planning needs roof projection even when the roof was not authored in
  that level,
- roof geometry should not be tied to only the active structural level.

Suggested concept:

```ts
interface RoofLayer {
  id: string;
  name: string;
  visible2D: boolean;
  visible3D: boolean;
  roofSketchIds: string[];
}
```

The first implementation can use one built-in roof layer named `Roofs`. Later,
multiple roof layers may help organize complex projects.

## New Domain Model Proposal

### RoofSketch

This is the user-authored roof graph.

```ts
interface RoofSketch {
  id: string;
  name: string;
  layerId: string;
  baseElevationM: number;
  thicknessM: number;
  vertices: RoofVertex[];
  edges: RoofEdge[];
  faces: RoofFaceDefinition[];
  constraints: RoofConstraint[];
}
```

Notes:

- `baseElevationM` is global/project elevation, not only relative to a floor.
- Existing level-relative UI can still edit it as `level elevation + offset`.
- `thicknessM` describes the roof shell thickness for the solved mesh.

### RoofVertex

```ts
type RoofVertexElevationMode = "Explicit" | "Computed";

interface RoofVertex {
  id: string;
  x: number;
  y: number;
  elevationMode: RoofVertexElevationMode;
  elevationM?: number;
}
```

Rules:

- explicit vertices are fixed inputs,
- computed vertices are solved from constraints,
- if a computed vertex cannot be solved, the solver reports a validation error.

### RoofEdge

```ts
type RoofEdgeRole = "Generic" | "LowerEave" | "UpperEave" | "Ridge" | "Hip" | "Valley";

interface RoofEdge {
  id: string;
  startVertexId: string;
  endVertexId: string;
  role: RoofEdgeRole;
}
```

Rules:

- roles are metadata and UI hints, not hard solver behavior by themselves,
- an apex can be represented by a shared vertex connected by triangular faces,
- a very short ridge can be represented as a normal edge.

### RoofFaceDefinition

```ts
interface RoofFaceDefinition {
  id: string;
  vertexIds: string[];
  edgeIds: string[];
  constraintIds: string[];
}
```

Rules:

- each face should solve to one planar surface,
- faces may be triangles, quads, or simple polygons,
- non-planar results should be reported as errors unless the face is explicitly
  split into smaller planar faces.

### RoofConstraint

```ts
type RoofConstraint =
  | RoofVertexHeightConstraint
  | RoofEdgeHeightConstraint
  | RoofFaceSlopeConstraint;

interface RoofVertexHeightConstraint {
  kind: "VertexHeight";
  vertexId: string;
  elevationM: number;
}

interface RoofEdgeHeightConstraint {
  kind: "EdgeHeight";
  edgeId: string;
  elevationM: number;
}

interface RoofFaceSlopeConstraint {
  kind: "FaceSlope";
  faceId: string;
  angleDeg: number;
  referenceEdgeId: string;
  direction: "AwayFromReference" | "TowardReference";
}
```

Initial solver can start small:

- explicit vertex/edge heights,
- one slope constraint per face,
- shared vertices checked for consistent solved height.

Later solver versions can add stronger constraint solving.

## Solved Model

### SolvedRoof

```ts
interface SolvedRoof {
  sketchId: string;
  layerId: string;
  thicknessM: number;
  vertices: SolvedRoofVertex[];
  edges: SolvedRoofEdge[];
  faces: SolvedRoofFace[];
  validation: RoofSolverMessage[];
}
```

### SolvedRoofFace

```ts
interface SolvedRoofFace {
  id: string;
  vertexIds: string[];
  polygonWorld: Vec2[];
  planeOuter: RoofPlane;
  planeInner: RoofPlane;
}

interface RoofPlane {
  xCoeff: number;
  yCoeff: number;
  constantM: number;
}
```

The height query is:

```ts
z = xCoeff * x + yCoeff * y + constantM;
```

The inner plane can initially be approximated as:

```ts
innerZ = outerZ - thicknessM;
```

Later, true normal-offset thickness can be added for accurate shell geometry.

## Solver Behavior

The solver should:

- collect explicit vertex and edge heights,
- compute missing heights from face slope constraints,
- derive one plane per face,
- verify that every face is planar,
- verify that shared vertices have one consistent elevation,
- report impossible constraints instead of silently guessing,
- return solved faces even when non-fatal warnings exist.

Important validation examples:

- a face with a 30 degree slope from two reference edges may be impossible if
  both imply different heights for a shared vertex,
- a quad face with four explicitly set vertex heights may be non-planar,
- a ridge edge connected to two gable faces must have the same solved height for
  both faces.

## Derived APIs

The renderers and editors should consume solved roofs through small APIs:

```ts
function solveProjectRoofs(project: Project): SolvedRoof[];

function getRoofFaceAtPoint(
  roof: SolvedRoof,
  pointWorld: Vec2,
): SolvedRoofFace | null;

function getRoofHeightAtPoint(
  roof: SolvedRoof,
  pointWorld: Vec2,
  surface: "outer" | "inner",
): number | null;

function getRoofSliceSegmentsAtHeight(
  roof: SolvedRoof,
  heightM: number,
  surface: "outer" | "inner",
): RoofSliceSegment[];

function solveWallSegmentsAgainstRoofs(
  roofs: SolvedRoof[],
  startWorld: Vec2,
  endWorld: Vec2,
  wallBaseElevationM: number,
): RoofWallSegment[];
```

## Wall-to-Roof Integration

Walls need two top behaviors:

- `FixedHeight`,
- `FollowRoof`.

Important rules:

- `FollowRoof` remains a per-wall property, not a wall-type property.
- Walls should query all solved roofs in the project, not only roofs in their own
  level.
- The matching roof should be selected by plan overlap and elevation range.
- If multiple roofs match, the solver should choose the nearest roof surface
  above the wall base/top reference and report ambiguity if needed.
- Wall segmentation should happen after architectural wall joins are applied so
  corners remain clean.

This is a direct fix for the current same-level limitation in the slab roof
prototype.

## 2D Plan Projection

The roof system must project into 2D floor plans.

Required projections:

- roof sketch layer visibility,
- ridge/eave/hip/valley guide lines,
- horizontal slices at level elevation,
- low-clearance zones for attic work,
- wall-follow preview lines.

The key primitive is still a horizontal slice:

```ts
getRoofSliceSegmentsAtHeight(roof, levelElevationM, "inner")
```

Later this can become region output for usable attic area, but line output is
enough for the first projection pass.

## Templates

Templates are creation helpers that produce `RoofSketch` objects.

### Shed / Pultova

- one lower edge,
- one upper edge,
- one quad face,
- optional slope constraint.

### Gable / Sedlova

- two lower eave edges,
- one ridge edge,
- two quad faces,
- shared ridge vertices,
- optional slope constraint applied to both faces.

### Tent / Hip / Stanova

- multiple lower eave edges,
- one apex vertex or short top ridge,
- triangular faces connected to the apex or ridge,
- optional slope constraint applied to each face.

### Generic Face Tool

Later, a generic roof face tool can allow:

- draw lower edge,
- draw upper edge or apex,
- connect them into a planar face,
- ask solver to compute missing height from slope or explicit endpoint heights.

## Legacy Slab Roof Prototype

The current implementation stores generated roofs on `Slab`:

```ts
interface Slab {
  roofType: "Flat" | "Gable" | "Shed" | "Hip";
  roofRiseM: number;
}
```

This should now be treated as a prototype/migration bridge.

Short-term compatibility path:

- keep reading old slab roof data,
- convert non-flat slab roofs into generated `RoofSketch` templates at solve
  time,
- keep the old rectangle roof tool working while the new roof layer arrives,
- do not extend the slab model with more roof complexity.

Long-term path:

- `Slab` returns to being a slab/floor/plate concept,
- roof data lives in roof sketches,
- import/export writes roof sketches as first-class project entities.

## Implementation Checklist

### Phase 0: Documentation and migration shape

- [ ] Mark current slab roof model as legacy/prototype.
- [ ] Define `RoofSketch`, `RoofVertex`, `RoofEdge`, `RoofFaceDefinition`, and
  `RoofConstraint`.
- [ ] Decide where first-class roof sketches live in `Project`.
- [ ] Decide whether there is one default `Roofs` layer or multiple named roof
  layers from the beginning.

### Phase 1: Solver kernel

- [ ] Add pure domain solver for explicit vertex/edge heights.
- [ ] Add planar face generation from solved vertices.
- [ ] Add line-to-line face solving.
- [ ] Add line-to-point triangular face solving.
- [ ] Add basic slope constraint solving.
- [ ] Add conflict reporting for impossible constraints.
- [ ] Keep output independent from React and Three.js.

### Phase 2: Template generation

- [ ] Generate shed template as lower edge + upper edge + face.
- [ ] Generate gable template as two lower edges + shared ridge + two faces.
- [ ] Generate tent/hip template as perimeter lower edges + apex + triangular
  faces.
- [ ] Convert old slab roofs into sketches for backward compatibility.

### Phase 3: 3D geometry

- [ ] Build custom roof shell geometry from solved faces.
- [ ] Render hollow roofs with opaque/semi-opaque material options.
- [ ] Keep roof mesh generation separate from solver.
- [ ] Preserve the existing detached 3D preview behavior.

### Phase 4: 2D roof layer

- [ ] Add visible roof drawing layer.
- [ ] Add roof layer 2D/3D visibility.
- [ ] Render roof sketch edges in plan.
- [ ] Render roof slices into relevant structural levels.
- [ ] Keep regular 2D structural editing clean and predictable.

### Phase 5: FollowRoof integration

- [ ] Change wall follow logic to query all solved roofs, not same-level roofs
  only.
- [ ] Select matching roof by plan overlap and elevation.
- [ ] Split walls by roof face boundaries.
- [ ] Preserve architectural wall joins for sloped roof-follow walls.
- [ ] Report ambiguous or missing roof matches clearly.

### Phase 6: Advanced roof features

- [ ] Roof windows as openings in solved roof faces.
- [ ] Roof materials and texture layers.
- [ ] Tile/ridge/edge detail generation.
- [ ] Dormers.
- [ ] Composite roof joining and valley generation.
- [ ] Attic usable-space regions.

## Test Strategy

### Solver tests

- [ ] Explicit triangle face produces one expected plane.
- [ ] Explicit quad face produces one expected plane.
- [ ] Non-planar explicit quad reports validation error.
- [ ] Line-to-line roof face computes missing upper edge height from slope.
- [ ] Line-to-point roof face computes apex height from slope.
- [ ] Shared vertex used by multiple faces keeps one consistent elevation.
- [ ] Conflicting slope constraints report an error.

### Template tests

- [ ] Shed template creates one face.
- [ ] Gable template creates two faces sharing one ridge edge.
- [ ] Tent template creates triangular faces sharing one apex.
- [ ] Generated faces have no duplicate or degenerate vertices.

### Wall integration tests

- [ ] `FollowRoof` wall finds a roof in a different roof layer/global elevation.
- [ ] Wall under one roof face produces one sloped segment.
- [ ] Wall crossing two roof faces splits into multiple segments.
- [ ] Wall outside all roofs keeps fixed/fallback behavior with a warning.
- [ ] Roof-follow wall corner joins remain aligned after architectural extension.

### 2D projection tests

- [ ] Roof slice at a level returns expected segments.
- [ ] Slice exactly touching an edge is stable.
- [ ] Slice below/above roof returns empty result.
- [ ] Multiple levels can display projection from the same roof.

### Rendering tests

- [ ] Solved roof mesh has non-zero vertices and faces.
- [ ] Mesh bounds match solved roof footprint.
- [ ] Hollow shell has top and underside geometry.
- [ ] No inverted triangles for shed/gable/tent templates.

## Open Questions

- Should slope angle or explicit height be the canonical UI input when both are
  present?
- How should overhangs be modeled: as edge offsets, separate faces, or render
  modifiers?
- Should the first roof layer be always global, or should projects allow several
  named roof layers immediately?
- How should ambiguous roof matching be shown to the user?
- Should attic usability use one global minimum clear height or per-room/per-level
  settings?
- Should future composite roof joins be manual, automatic, or a mixed workflow?

## Immediate Next Step

Before changing production code, implement the new model in small slices:

1. Add the first-class roof sketch types and keep old slab roofs as legacy input.
2. Build a pure solver for explicit planar faces.
3. Add one simple template generator, likely shed or gable.
4. Replace renderer usage behind the existing roof preview without changing the
   2D workflow.
5. Only then move wall-follow logic from same-level slab roofs to global solved
   roof sketches.

This keeps the system disciplined:

- sketch data first,
- solver second,
- renderers and wall behavior derived from the solver,
- design details later.
