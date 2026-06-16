import { createVec2 } from "./project-model";
import type { Project, RoofConstraint, RoofEdge, RoofSketch, RoofType, Slab, Vec2 } from "./project-model";

export type RoofSurface = "outer" | "inner";
export type RoofFeatureKind = "eave" | "ridge" | "hip";

export interface SolvedRoofPlane {
  uCoeff: number;
  vCoeff: number;
  constantM: number;
}

export interface SolvedRoofFace {
  id: string;
  polygonLocal: Vec2[];
  polygonWorld: Vec2[];
  planeOuter: SolvedRoofPlane;
  thicknessM: number;
}

export interface SolvedRoofFeatureSegment {
  kind: RoofFeatureKind;
  startLocal: Vec2;
  endLocal: Vec2;
  startWorld: Vec2;
  endWorld: Vec2;
}

export interface SolvedRoof {
  sourceKind: "Sketch" | "LegacySlab";
  sourceId: string;
  slabId?: string;
  sketchId?: string;
  levelId: string;
  layerId?: string;
  roofType?: Exclude<RoofType, "Flat">;
  center: Vec2;
  yawDeg: number;
  widthM: number;
  depthM: number;
  thicknessM: number;
  eaveOuterHeightM: number;
  peakOuterHeightM: number;
  footprintLocal: Vec2[];
  footprintWorld: Vec2[];
  faces: SolvedRoofFace[];
  features: SolvedRoofFeatureSegment[];
  warnings: string[];
}

export interface RoofSliceSegment {
  start: Vec2;
  end: Vec2;
  faceId: string;
}

export interface RoofWallSegment {
  start: Vec2;
  end: Vec2;
  startHeightM: number;
  endHeightM: number;
  faceId: string;
}

const EPSILON = 0.000001;

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function localToWorldPlan(center: Vec2, yawDeg: number, point: Vec2) {
  const yawRad = toRadians(yawDeg);
  const cos = Math.cos(yawRad);
  const sin = Math.sin(yawRad);

  return createVec2(
    center.x + point.x * cos - point.y * sin,
    center.y + point.x * sin + point.y * cos,
  );
}

function worldToLocalPlan(center: Vec2, yawDeg: number, point: Vec2) {
  const yawRad = toRadians(yawDeg);
  const cos = Math.cos(yawRad);
  const sin = Math.sin(yawRad);
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  return createVec2(
    dx * cos + dy * sin,
    -dx * sin + dy * cos,
  );
}

function createPlaneFromLocalPoints(
  first: { point: Vec2; heightM: number },
  second: { point: Vec2; heightM: number },
  third: { point: Vec2; heightM: number },
): SolvedRoofPlane {
  const determinant =
    first.point.x * (second.point.y - third.point.y) +
    second.point.x * (third.point.y - first.point.y) +
    third.point.x * (first.point.y - second.point.y);

  if (Math.abs(determinant) < EPSILON) {
    return {
      uCoeff: 0,
      vCoeff: 0,
      constantM: first.heightM,
    };
  }

  const uCoeff =
    (first.heightM * (second.point.y - third.point.y) +
      second.heightM * (third.point.y - first.point.y) +
      third.heightM * (first.point.y - second.point.y)) /
    determinant;
  const vCoeff =
    (first.point.x * (second.heightM - third.heightM) +
      second.point.x * (third.heightM - first.heightM) +
      third.point.x * (first.heightM - second.heightM)) /
    determinant;
  const constantM = first.heightM - uCoeff * first.point.x - vCoeff * first.point.y;

  return { uCoeff, vCoeff, constantM };
}

function evaluatePlaneHeight(plane: SolvedRoofPlane, point: Vec2) {
  return plane.uCoeff * point.x + plane.vCoeff * point.y + plane.constantM;
}

function pointOnSegment(point: Vec2, start: Vec2, end: Vec2) {
  const cross =
    (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > 0.0001) {
    return false;
  }

  const dot =
    (point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y);
  if (dot < -EPSILON) {
    return false;
  }

  const squaredLength =
    (end.x - start.x) * (end.x - start.x) + (end.y - start.y) * (end.y - start.y);
  return dot <= squaredLength + EPSILON;
}

function pointInPolygon(point: Vec2, polygon: Vec2[]) {
  if (polygon.length < 3) {
    return false;
  }

  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (pointOnSegment(point, start, end)) {
      return true;
    }
  }

  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const current = polygon[index];
    const before = polygon[previous];
    const intersects =
      current.y > point.y !== before.y > point.y &&
      point.x <
        ((before.x - current.x) * (point.y - current.y)) / (before.y - current.y + EPSILON) +
          current.x;
    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function dedupePoints(points: Vec2[]) {
  const deduped: Vec2[] = [];
  points.forEach((point) => {
    if (
      !deduped.some(
        (candidate) =>
          Math.abs(candidate.x - point.x) < 0.0001 &&
          Math.abs(candidate.y - point.y) < 0.0001,
      )
    ) {
      deduped.push(point);
    }
  });
  return deduped;
}

function dedupeScalars(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const result: number[] = [];
  sorted.forEach((value) => {
    if (result.length === 0 || Math.abs(result[result.length - 1] - value) > 0.0001) {
      result.push(value);
    }
  });
  return result;
}

function assignHeight(
  heights: Map<string, number>,
  vertexId: string,
  heightM: number,
  warnings: string[],
  label: string,
) {
  const current = heights.get(vertexId);
  if (current !== undefined && Math.abs(current - heightM) > 0.001) {
    warnings.push(
      `${label}: conflicting height for vertex "${vertexId}" (${current.toFixed(3)}m vs ${heightM.toFixed(3)}m).`,
    );
    return false;
  }

  heights.set(vertexId, heightM);
  return true;
}

function interpolateReferenceEdgeHeight(
  point: Vec2,
  start: Vec2,
  end: Vec2,
  startHeightM: number,
  endHeightM: number,
) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared < EPSILON) {
    return startHeightM;
  }

  const t = ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared;
  return startHeightM + (endHeightM - startHeightM) * t;
}

function signedDistanceFromEdge(point: Vec2, start: Vec2, end: Vec2) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const length = Math.hypot(deltaX, deltaY);
  if (length < EPSILON) {
    return 0;
  }

  return ((point.x - start.x) * deltaY - (point.y - start.y) * deltaX) / length;
}

function solveFaceSlopeConstraint(
  sketch: RoofSketch,
  constraint: Extract<RoofConstraint, { kind: "FaceSlope" }>,
  heights: Map<string, number>,
  warnings: string[],
) {
  const face = sketch.faces.find((candidate) => candidate.id === constraint.faceId);
  const referenceEdge = sketch.edges.find((edge) => edge.id === constraint.referenceEdgeId);
  if (!face || !referenceEdge) {
    return false;
  }

  const vertexById = new Map(sketch.vertices.map((vertex) => [vertex.id, vertex] as const));
  const referenceStart = vertexById.get(referenceEdge.startVertexId);
  const referenceEnd = vertexById.get(referenceEdge.endVertexId);
  const referenceStartHeightM = heights.get(referenceEdge.startVertexId);
  const referenceEndHeightM = heights.get(referenceEdge.endVertexId);
  if (
    !referenceStart ||
    !referenceEnd ||
    referenceStartHeightM === undefined ||
    referenceEndHeightM === undefined
  ) {
    return false;
  }

  const slope = Math.tan(toRadians(constraint.angleDeg));
  let changed = false;
  for (const vertexId of face.vertexIds) {
    const vertex = vertexById.get(vertexId);
    if (!vertex) {
      continue;
    }

    const distanceM = Math.abs(
      signedDistanceFromEdge(vertex.position, referenceStart.position, referenceEnd.position),
    );
    const referenceHeightM = interpolateReferenceEdgeHeight(
      vertex.position,
      referenceStart.position,
      referenceEnd.position,
      referenceStartHeightM,
      referenceEndHeightM,
    );
    const heightM =
      referenceHeightM +
      (constraint.direction === "AwayFromReference" ? 1 : -1) * slope * distanceM;
    const before = heights.get(vertexId);
    if (assignHeight(heights, vertexId, heightM, warnings, `roof "${sketch.id}" slope constraint`)) {
      changed = changed || before === undefined;
    }
  }

  return changed;
}

function solveSketchVertexHeights(sketch: RoofSketch) {
  const warnings: string[] = [];
  const heights = new Map<string, number>();
  const edgeById = new Map(sketch.edges.map((edge) => [edge.id, edge] as const));

  sketch.vertices.forEach((vertex) => {
    if (vertex.elevationM !== undefined) {
      assignHeight(heights, vertex.id, vertex.elevationM, warnings, `roof "${sketch.id}" vertex`);
    } else if (vertex.elevationMode === "Explicit") {
      assignHeight(heights, vertex.id, sketch.baseElevationM, warnings, `roof "${sketch.id}" vertex`);
    }
  });

  sketch.constraints.forEach((constraint) => {
    if (constraint.kind === "VertexHeight") {
      assignHeight(heights, constraint.vertexId, constraint.elevationM, warnings, `roof "${sketch.id}" vertex constraint`);
    } else if (constraint.kind === "EdgeHeight") {
      const edge = edgeById.get(constraint.edgeId);
      if (edge) {
        assignHeight(heights, edge.startVertexId, constraint.elevationM, warnings, `roof "${sketch.id}" edge constraint`);
        assignHeight(heights, edge.endVertexId, constraint.elevationM, warnings, `roof "${sketch.id}" edge constraint`);
      }
    }
  });

  for (let iteration = 0; iteration < sketch.vertices.length + sketch.constraints.length; iteration += 1) {
    let changed = false;
    sketch.constraints.forEach((constraint) => {
      if (constraint.kind === "FaceSlope") {
        changed = solveFaceSlopeConstraint(sketch, constraint, heights, warnings) || changed;
      }
    });

    if (!changed) {
      break;
    }
  }

  return { heights, warnings };
}

function roleToFeatureKind(edge: RoofEdge): RoofFeatureKind | null {
  if (edge.role === "Ridge") {
    return "ridge";
  }

  if (edge.role === "Hip" || edge.role === "Valley") {
    return "hip";
  }

  if (edge.role === "LowerEave" || edge.role === "UpperEave") {
    return "eave";
  }

  return null;
}

export function solveRoofFromSketch(sketch: RoofSketch): SolvedRoof | null {
  if (sketch.vertices.length < 3 || sketch.faces.length === 0 || sketch.thicknessM <= 0) {
    return null;
  }

  const vertexById = new Map(sketch.vertices.map((vertex) => [vertex.id, vertex] as const));
  const { heights, warnings } = solveSketchVertexHeights(sketch);
  const faces: SolvedRoofFace[] = [];

  for (const face of sketch.faces) {
    const vertices = face.vertexIds
      .map((vertexId) => {
        const vertex = vertexById.get(vertexId);
        const heightM = heights.get(vertexId);
        return vertex && heightM !== undefined ? { point: vertex.position, heightM } : null;
      })
      .filter((vertex): vertex is { point: Vec2; heightM: number } => vertex !== null);

    if (vertices.length !== face.vertexIds.length || vertices.length < 3) {
      warnings.push(`roof "${sketch.id}" face "${face.id}": skipped face with unresolved vertex heights.`);
      continue;
    }

    const planeOuter = createPlaneFromLocalPoints(vertices[0], vertices[1], vertices[2]);
    const isPlanar = vertices.every(
      (vertex) => Math.abs(evaluatePlaneHeight(planeOuter, vertex.point) - vertex.heightM) <= 0.001,
    );
    if (!isPlanar) {
      warnings.push(`roof "${sketch.id}" face "${face.id}": face is not planar.`);
      continue;
    }

    const polygonLocal = vertices.map((vertex) => vertex.point);
    faces.push({
      id: face.id,
      polygonLocal,
      polygonWorld: polygonLocal.map((point) => createVec2(point.x, point.y)),
      planeOuter,
      thicknessM: face.thicknessM ?? sketch.thicknessM,
    });
  }

  if (faces.length === 0) {
    return null;
  }

  const allPoints = sketch.vertices.map((vertex) => vertex.position);
  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minY = Math.min(...allPoints.map((point) => point.y));
  const maxY = Math.max(...allPoints.map((point) => point.y));
  const solvedHeights = [...heights.values()];
  const eaveOuterHeightM = solvedHeights.length > 0 ? Math.min(...solvedHeights) : sketch.baseElevationM;
  const peakOuterHeightM = solvedHeights.length > 0 ? Math.max(...solvedHeights) : sketch.baseElevationM;
  const features = sketch.edges
    .map((edge) => {
      const kind = roleToFeatureKind(edge);
      const start = vertexById.get(edge.startVertexId);
      const end = vertexById.get(edge.endVertexId);
      return kind && start && end
        ? {
            kind,
            startLocal: start.position,
            endLocal: end.position,
            startWorld: start.position,
            endWorld: end.position,
          }
        : null;
    })
    .filter((feature): feature is SolvedRoofFeatureSegment => feature !== null);

  return {
    sourceKind: "Sketch",
    sourceId: sketch.id,
    sketchId: sketch.id,
    levelId: sketch.layerId,
    layerId: sketch.layerId,
    center: createVec2(0, 0),
    yawDeg: 0,
    widthM: maxX - minX,
    depthM: maxY - minY,
    thicknessM: sketch.thicknessM,
    eaveOuterHeightM,
    peakOuterHeightM,
    footprintLocal: allPoints,
    footprintWorld: allPoints,
    faces,
    features,
    warnings,
  };
}

function createLegacySlabRoofSketch(slab: Slab, levelElevationM: number): RoofSketch | null {
  if (slab.kind !== "Rectangle" || slab.roofType === "Flat") {
    return null;
  }

  const halfWidth = slab.widthM / 2;
  const halfDepth = slab.depthM / 2;
  const eaveOuterHeightM = levelElevationM + slab.zOffsetM + slab.thicknessM;
  const peakOuterHeightM = eaveOuterHeightM + slab.roofRiseM;
  const toWorld = (id: string, x: number, y: number, elevationM: number) => ({
    id: `${slab.id}_${id}`,
    position: localToWorldPlan(slab.pose.position, slab.pose.yawDeg, createVec2(x, y)),
    elevationMode: "Explicit" as const,
    elevationM,
  });
  const edge = (id: string, start: string, end: string, role: RoofEdge["role"]) => ({
    id: `${slab.id}_${id}`,
    startVertexId: `${slab.id}_${start}`,
    endVertexId: `${slab.id}_${end}`,
    role,
  });
  const face = (id: string, vertexIds: string[], edgeIds: string[]) => ({
    id: `${slab.id}_${id}`,
    vertexIds: vertexIds.map((vertexId) => `${slab.id}_${vertexId}`),
    edgeIds: edgeIds.map((edgeId) => `${slab.id}_${edgeId}`),
    constraintIds: [],
  });

  if (slab.roofType === "Shed") {
    const slopeAcrossWidth = slab.widthM <= slab.depthM;
    const vertices = slopeAcrossWidth
      ? [
          toWorld("v1", -halfWidth, -halfDepth, peakOuterHeightM),
          toWorld("v2", halfWidth, -halfDepth, eaveOuterHeightM),
          toWorld("v3", halfWidth, halfDepth, eaveOuterHeightM),
          toWorld("v4", -halfWidth, halfDepth, peakOuterHeightM),
        ]
      : [
          toWorld("v1", -halfWidth, -halfDepth, eaveOuterHeightM),
          toWorld("v2", halfWidth, -halfDepth, eaveOuterHeightM),
          toWorld("v3", halfWidth, halfDepth, peakOuterHeightM),
          toWorld("v4", -halfWidth, halfDepth, peakOuterHeightM),
        ];
    return {
      id: `${slab.id}_roof_sketch`,
      name: slab.name,
      layerId: slab.levelId,
      baseElevationM: eaveOuterHeightM,
      thicknessM: slab.thicknessM,
      vertices,
      edges: [
        edge("e1", "v1", "v2", slopeAcrossWidth ? "Generic" : "LowerEave"),
        edge("e2", "v2", "v3", slopeAcrossWidth ? "LowerEave" : "Generic"),
        edge("e3", "v3", "v4", slopeAcrossWidth ? "Generic" : "UpperEave"),
        edge("e4", "v4", "v1", slopeAcrossWidth ? "UpperEave" : "Generic"),
      ],
      faces: [face("face_1", ["v1", "v2", "v3", "v4"], ["e1", "e2", "e3", "e4"])],
      constraints: [],
    };
  }

  if (slab.roofType === "Gable") {
    const ridgeAlongWidth = slab.widthM >= slab.depthM;
    const vertices = ridgeAlongWidth
      ? [
          toWorld("v1", -halfWidth, -halfDepth, eaveOuterHeightM),
          toWorld("v2", halfWidth, -halfDepth, eaveOuterHeightM),
          toWorld("v3", halfWidth, halfDepth, eaveOuterHeightM),
          toWorld("v4", -halfWidth, halfDepth, eaveOuterHeightM),
          toWorld("r1", -halfWidth, 0, peakOuterHeightM),
          toWorld("r2", halfWidth, 0, peakOuterHeightM),
        ]
      : [
          toWorld("v1", -halfWidth, -halfDepth, eaveOuterHeightM),
          toWorld("v2", halfWidth, -halfDepth, eaveOuterHeightM),
          toWorld("v3", halfWidth, halfDepth, eaveOuterHeightM),
          toWorld("v4", -halfWidth, halfDepth, eaveOuterHeightM),
          toWorld("r1", 0, -halfDepth, peakOuterHeightM),
          toWorld("r2", 0, halfDepth, peakOuterHeightM),
        ];
    const edges = ridgeAlongWidth
      ? [
          edge("e1", "v1", "v2", "LowerEave"),
          edge("e2", "v3", "v4", "LowerEave"),
          edge("ridge", "r1", "r2", "Ridge"),
        ]
      : [
          edge("e1", "v1", "v4", "LowerEave"),
          edge("e2", "v2", "v3", "LowerEave"),
          edge("ridge", "r1", "r2", "Ridge"),
        ];
    const faces = ridgeAlongWidth
      ? [
          face("face_1", ["v1", "v2", "r2", "r1"], ["e1", "ridge"]),
          face("face_2", ["r1", "r2", "v3", "v4"], ["e2", "ridge"]),
        ]
      : [
          face("face_1", ["v1", "r1", "r2", "v4"], ["e1", "ridge"]),
          face("face_2", ["r1", "v2", "v3", "r2"], ["e2", "ridge"]),
        ];
    return {
      id: `${slab.id}_roof_sketch`,
      name: slab.name,
      layerId: slab.levelId,
      baseElevationM: eaveOuterHeightM,
      thicknessM: slab.thicknessM,
      vertices,
      edges,
      faces,
      constraints: [],
    };
  }

  const vertices = [
    toWorld("v1", -halfWidth, -halfDepth, eaveOuterHeightM),
    toWorld("v2", halfWidth, -halfDepth, eaveOuterHeightM),
    toWorld("v3", halfWidth, halfDepth, eaveOuterHeightM),
    toWorld("v4", -halfWidth, halfDepth, eaveOuterHeightM),
    toWorld("apex", 0, 0, peakOuterHeightM),
  ];

  return {
    id: `${slab.id}_roof_sketch`,
    name: slab.name,
    layerId: slab.levelId,
    baseElevationM: eaveOuterHeightM,
    thicknessM: slab.thicknessM,
    vertices,
    edges: [
      edge("e1", "v1", "v2", "LowerEave"),
      edge("e2", "v2", "v3", "LowerEave"),
      edge("e3", "v3", "v4", "LowerEave"),
      edge("e4", "v4", "v1", "LowerEave"),
      edge("h1", "v1", "apex", "Hip"),
      edge("h2", "v2", "apex", "Hip"),
      edge("h3", "v3", "apex", "Hip"),
      edge("h4", "v4", "apex", "Hip"),
    ],
    faces: [
      face("face_1", ["v1", "v2", "apex"], ["e1", "h1", "h2"]),
      face("face_2", ["v2", "v3", "apex"], ["e2", "h2", "h3"]),
      face("face_3", ["v3", "v4", "apex"], ["e3", "h3", "h4"]),
      face("face_4", ["v4", "v1", "apex"], ["e4", "h4", "h1"]),
    ],
    constraints: [],
  };
}

export function solveRoofFromSlab(slab: Slab, levelElevationM: number): SolvedRoof | null {
  const sketch = createLegacySlabRoofSketch(slab, levelElevationM);
  const solvedRoof = sketch ? solveRoofFromSketch(sketch) : null;
  return solvedRoof
    ? {
        ...solvedRoof,
        sourceKind: "LegacySlab",
        sourceId: slab.id,
        slabId: slab.id,
        sketchId: undefined,
        levelId: slab.levelId,
        layerId: undefined,
        roofType: slab.roofType === "Flat" ? undefined : slab.roofType,
      }
    : null;
}

export function solveProjectRoofs(project: Project) {
  const levelById = new Map(project.levels.map((level) => [level.id, level] as const));
  const sketchRoofs = project.roofSketches
    .map((sketch) => solveRoofFromSketch(sketch))
    .filter((roof): roof is SolvedRoof => roof !== null);
  const legacySlabRoofs = project.slabs
    .map((slab) => {
      const level = levelById.get(slab.levelId);
      return level ? solveRoofFromSlab(slab, level.elevationM) : null;
    })
    .filter((roof): roof is SolvedRoof => roof !== null);
  return [...sketchRoofs, ...legacySlabRoofs];
}

export function getRoofFaceAtPoint(roof: SolvedRoof, pointWorld: Vec2) {
  const pointLocal = worldToLocalPlan(roof.center, roof.yawDeg, pointWorld);
  return roof.faces.find((face) => pointInPolygon(pointLocal, face.polygonLocal)) ?? null;
}

export function getRoofHeightAtPoint(
  roof: SolvedRoof,
  pointWorld: Vec2,
  surface: RoofSurface = "outer",
) {
  const pointLocal = worldToLocalPlan(roof.center, roof.yawDeg, pointWorld);
  const face = roof.faces.find((candidate) => pointInPolygon(pointLocal, candidate.polygonLocal));
  if (!face) {
    return null;
  }

  const outerHeightM = evaluatePlaneHeight(face.planeOuter, pointLocal);
  return surface === "outer" ? outerHeightM : outerHeightM - face.thicknessM;
}

export function getRoofSliceSegmentsAtHeight(
  roof: SolvedRoof,
  heightM: number,
  surface: RoofSurface = "inner",
) {
  const segments: RoofSliceSegment[] = [];

  roof.faces.forEach((face) => {
    const intersections: Vec2[] = [];

    for (let index = 0; index < face.polygonLocal.length; index += 1) {
      const start = face.polygonLocal[index];
      const end = face.polygonLocal[(index + 1) % face.polygonLocal.length];
      const startHeightM =
        evaluatePlaneHeight(face.planeOuter, start) - (surface === "inner" ? face.thicknessM : 0);
      const endHeightM =
        evaluatePlaneHeight(face.planeOuter, end) - (surface === "inner" ? face.thicknessM : 0);
      const startDelta = startHeightM - heightM;
      const endDelta = endHeightM - heightM;

      if (Math.abs(startDelta) < 0.0001) {
        intersections.push(start);
      }

      if (Math.abs(endDelta) < 0.0001) {
        intersections.push(end);
      }

      if ((startDelta < 0 && endDelta > 0) || (startDelta > 0 && endDelta < 0)) {
        const t = (heightM - startHeightM) / (endHeightM - startHeightM);
        intersections.push(
          createVec2(
            start.x + (end.x - start.x) * t,
            start.y + (end.y - start.y) * t,
          ),
        );
      }
    }

    const deduped = dedupePoints(intersections);
    if (deduped.length < 2) {
      return;
    }

    let bestPair: [Vec2, Vec2] = [deduped[0], deduped[1]];
    let bestDistance = -1;
    for (let leftIndex = 0; leftIndex < deduped.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < deduped.length; rightIndex += 1) {
        const left = deduped[leftIndex];
        const right = deduped[rightIndex];
        const distance =
          (left.x - right.x) * (left.x - right.x) + (left.y - right.y) * (left.y - right.y);
        if (distance > bestDistance) {
          bestDistance = distance;
          bestPair = [left, right];
        }
      }
    }

    segments.push({
      faceId: face.id,
      start: localToWorldPlan(roof.center, roof.yawDeg, bestPair[0]),
      end: localToWorldPlan(roof.center, roof.yawDeg, bestPair[1]),
    });
  });

  return segments;
}

function segmentIntersectionParameters(
  lineStart: Vec2,
  lineEnd: Vec2,
  edgeStart: Vec2,
  edgeEnd: Vec2,
) {
  const r = createVec2(lineEnd.x - lineStart.x, lineEnd.y - lineStart.y);
  const s = createVec2(edgeEnd.x - edgeStart.x, edgeEnd.y - edgeStart.y);
  const denominator = r.x * s.y - r.y * s.x;

  if (Math.abs(denominator) < EPSILON) {
    return null;
  }

  const qp = createVec2(edgeStart.x - lineStart.x, edgeStart.y - lineStart.y);
  const t = (qp.x * s.y - qp.y * s.x) / denominator;
  const u = (qp.x * r.y - qp.y * r.x) / denominator;

  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) {
    return null;
  }

  return clamp(t, 0, 1);
}

export function solveWallSegmentsAgainstRoof(
  roof: SolvedRoof,
  startWorld: Vec2,
  endWorld: Vec2,
): RoofWallSegment[] {
  const startLocal = worldToLocalPlan(roof.center, roof.yawDeg, startWorld);
  const endLocal = worldToLocalPlan(roof.center, roof.yawDeg, endWorld);
  const breakpoints = [0, 1];

  roof.faces.forEach((face) => {
    for (let index = 0; index < face.polygonLocal.length; index += 1) {
      const edgeStart = face.polygonLocal[index];
      const edgeEnd = face.polygonLocal[(index + 1) % face.polygonLocal.length];
      const intersectionT = segmentIntersectionParameters(
        startLocal,
        endLocal,
        edgeStart,
        edgeEnd,
      );
      if (intersectionT !== null) {
        breakpoints.push(intersectionT);
      }
    }
  });

  const segments: RoofWallSegment[] = [];
  const sortedBreakpoints = dedupeScalars(breakpoints);
  for (let index = 0; index < sortedBreakpoints.length - 1; index += 1) {
    const t0 = sortedBreakpoints[index];
    const t1 = sortedBreakpoints[index + 1];
    if (t1 - t0 < 0.0001) {
      continue;
    }

    const midpointT = (t0 + t1) / 2;
    const midpointLocal = createVec2(
      startLocal.x + (endLocal.x - startLocal.x) * midpointT,
      startLocal.y + (endLocal.y - startLocal.y) * midpointT,
    );
    const face = roof.faces.find((candidate) => pointInPolygon(midpointLocal, candidate.polygonLocal));
    if (!face) {
      continue;
    }

    const segmentStartLocal = createVec2(
      startLocal.x + (endLocal.x - startLocal.x) * t0,
      startLocal.y + (endLocal.y - startLocal.y) * t0,
    );
    const segmentEndLocal = createVec2(
      startLocal.x + (endLocal.x - startLocal.x) * t1,
      startLocal.y + (endLocal.y - startLocal.y) * t1,
    );
    segments.push({
      start: localToWorldPlan(roof.center, roof.yawDeg, segmentStartLocal),
      end: localToWorldPlan(roof.center, roof.yawDeg, segmentEndLocal),
      startHeightM: evaluatePlaneHeight(face.planeOuter, segmentStartLocal) - face.thicknessM,
      endHeightM: evaluatePlaneHeight(face.planeOuter, segmentEndLocal) - face.thicknessM,
      faceId: face.id,
    });
  }

  return segments;
}
