import {
  createVec2,
} from "./project-model";
import type {
  Project,
  Shape,
  Slab,
  Stair,
  Vec2,
} from "./project-model";
import {
  getRoofHeightAtPoint,
  solveProjectRoofs,
  solveRoofFromSlab,
  solveWallSegmentsAgainstRoof,
} from "./roof-solver";
import type { RoofWallSegment } from "./roof-solver";
import type {
  Preview3DRenderMode,
  Preview3DSurfaceMode,
} from "../store/editor-ui-store";

export interface Preview3DBoxPrimitive {
  kind: "box";
  center: [number, number, number];
  size: [number, number, number];
  yawRad: number;
  color: string;
}

export interface Preview3DCylinderPrimitive {
  kind: "cylinder";
  center: [number, number, number];
  radius: number;
  height: number;
  color: string;
}

export interface Preview3DMarkerPrimitive {
  kind: "marker";
  position: [number, number, number];
  radius: number;
  color: string;
}

export interface Preview3DMeshPrimitive {
  kind: "mesh";
  vertices: [number, number, number][];
  indices: number[];
  color: string;
  opacity?: number;
}

export interface Preview3DSceneData {
  boxes: Preview3DBoxPrimitive[];
  cylinders: Preview3DCylinderPrimitive[];
  markers: Preview3DMarkerPrimitive[];
  meshes: Preview3DMeshPrimitive[];
  target: [number, number, number];
  radius: number;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface NodeWallAggregate {
  count: number;
  maxThicknessM: number;
  maxHeightM: number;
}

interface WallOpeningRender {
  kind: "door" | "window";
  offsetM: number;
  widthM: number;
  heightM: number;
  sillHeightM: number;
}

function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

function add3(left: Vec3, right: Vec3) {
  return vec3(left.x + right.x, left.y + right.y, left.z + right.z);
}

function subtract3(left: Vec3, right: Vec3) {
  return vec3(left.x - right.x, left.y - right.y, left.z - right.z);
}

function scale3(value: Vec3, scalar: number) {
  return vec3(value.x * scalar, value.y * scalar, value.z * scalar);
}

function dot3(left: Vec3, right: Vec3) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function cross3(left: Vec3, right: Vec3) {
  return vec3(
    left.y * right.z - left.z * right.y,
    left.z * right.x - left.x * right.z,
    left.x * right.y - left.y * right.x,
  );
}

function length3(value: Vec3) {
  return Math.sqrt(dot3(value, value));
}

function normalize3(value: Vec3) {
  const length = length3(value);
  if (length < 0.000001) {
    return vec3();
  }

  return scale3(value, 1 / length);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function signedPolygonArea(points: Vec2[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }

  return area / 2;
}

function lineIntersection2D(
  lineStart: Vec2,
  lineEnd: Vec2,
  clipStart: Vec2,
  clipEnd: Vec2,
) {
  const lineDeltaX = lineEnd.x - lineStart.x;
  const lineDeltaY = lineEnd.y - lineStart.y;
  const clipDeltaX = clipEnd.x - clipStart.x;
  const clipDeltaY = clipEnd.y - clipStart.y;
  const denominator = lineDeltaX * clipDeltaY - lineDeltaY * clipDeltaX;
  if (Math.abs(denominator) < 0.000001) {
    return lineEnd;
  }

  const t =
    ((clipStart.x - lineStart.x) * clipDeltaY -
      (clipStart.y - lineStart.y) * clipDeltaX) /
    denominator;
  return createVec2(lineStart.x + lineDeltaX * t, lineStart.y + lineDeltaY * t);
}

function clipPolygonToConvexPolygon(subject: Vec2[], clipPolygon: Vec2[]) {
  if (subject.length < 3 || clipPolygon.length < 3) {
    return [];
  }

  const orientation = signedPolygonArea(clipPolygon) >= 0 ? 1 : -1;
  let output = subject;

  for (let clipIndex = 0; clipIndex < clipPolygon.length; clipIndex += 1) {
    const clipStart = clipPolygon[clipIndex];
    const clipEnd = clipPolygon[(clipIndex + 1) % clipPolygon.length];
    const input = output;
    output = [];

    if (input.length === 0) {
      break;
    }

    const isInside = (point: Vec2) => {
      const cross =
        (clipEnd.x - clipStart.x) * (point.y - clipStart.y) -
        (clipEnd.y - clipStart.y) * (point.x - clipStart.x);
      return orientation * cross >= -0.000001;
    };

    let previous = input[input.length - 1];
    let previousInside = isInside(previous);

    for (const current of input) {
      const currentInside = isInside(current);
      if (currentInside) {
        if (!previousInside) {
          output.push(lineIntersection2D(previous, current, clipStart, clipEnd));
        }
        output.push(current);
      } else if (previousInside) {
        output.push(lineIntersection2D(previous, current, clipStart, clipEnd));
      }

      previous = current;
      previousInside = currentInside;
    }
  }

  return output.filter(
    (point, index, points) =>
      index === 0 ||
      Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > 0.0001,
  );
}

function uniqueSortedCuts(values: number[]) {
  return [...values]
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)
    .filter((value, index, sorted) => index === 0 || Math.abs(value - sorted[index - 1]) > 0.001);
}

function toWorldPoint2D(position: Vec2, elevationM: number) {
  return vec3(position.x, elevationM, -position.y);
}

function rgbToCss(color: RgbColor) {
  return `rgb(${Math.round(color.r)} ${Math.round(color.g)} ${Math.round(color.b)})`;
}

function shadeColor(color: RgbColor, factor: number) {
  const mix = clamp(factor, 0, 1.5);
  return {
    r: clamp(color.r * mix, 0, 255),
    g: clamp(color.g * mix, 0, 255),
    b: clamp(color.b * mix, 0, 255),
  };
}

function levelColor(index: number): RgbColor {
  const palette: RgbColor[] = [
    { r: 197, g: 157, b: 95 },
    { r: 116, g: 175, b: 208 },
    { r: 139, g: 188, b: 143 },
    { r: 206, g: 132, b: 96 },
  ];

  return palette[index % palette.length];
}

function getBaseSurfaceColor(index: number, surfaceMode: Preview3DSurfaceMode) {
  if (surfaceMode === "GrayOpaque") {
    const grayPalette: RgbColor[] = [
      { r: 154, g: 158, b: 164 },
      { r: 144, g: 148, b: 154 },
      { r: 168, g: 172, b: 178 },
    ];

    return grayPalette[index % grayPalette.length];
  }

  return levelColor(index);
}

function pointAlongWall(start: Vec3, direction: Vec3, offsetM: number) {
  return add3(start, scale3(direction, offsetM));
}

function interpolateVec2(start: Vec2, end: Vec2, t: number) {
  return createVec2(
    start.x + (end.x - start.x) * t,
    start.y + (end.y - start.y) * t,
  );
}

function splitAndClampRoofWallSegmentHeight(
  segment: RoofWallSegment,
  minTopHeightM: number,
  maxTopHeightM: number,
) {
  const clampTopHeight = (heightM: number) => clamp(heightM, minTopHeightM, maxTopHeightM);
  const startHeightM = clampTopHeight(segment.startHeightM);
  const endHeightM = clampTopHeight(segment.endHeightM);
  const crossesMax =
    (segment.startHeightM < maxTopHeightM && segment.endHeightM > maxTopHeightM) ||
    (segment.startHeightM > maxTopHeightM && segment.endHeightM < maxTopHeightM);

  if (!crossesMax || Math.abs(segment.endHeightM - segment.startHeightM) < 0.000001) {
    return [
      {
        ...segment,
        startHeightM,
        endHeightM,
      },
    ];
  }

  const t = clamp(
    (maxTopHeightM - segment.startHeightM) /
      (segment.endHeightM - segment.startHeightM),
    0,
    1,
  );
  const splitPoint = interpolateVec2(segment.start, segment.end, t);
  const first: RoofWallSegment = {
    ...segment,
    end: splitPoint,
    startHeightM,
    endHeightM: maxTopHeightM,
  };
  const second: RoofWallSegment = {
    ...segment,
    start: splitPoint,
    startHeightM: maxTopHeightM,
    endHeightM,
  };

  return [first, second];
}

function extendWallEndpoint(
  start: Vec3,
  end: Vec3,
  extensionM: number,
  direction: "start" | "end",
) {
  const delta = subtract3(end, start);
  const directionVector = normalize3(vec3(delta.x, 0, delta.z));
  const signedExtension = direction === "start" ? -extensionM : extensionM;
  return add3(
    direction === "start" ? start : end,
    scale3(directionVector, signedExtension),
  );
}

function computeAngularWallExtension(
  currentDirection: Vec3,
  neighborDirection: Vec3,
  currentThicknessM: number,
  neighborThicknessM: number,
) {
  const normalizedDot = clamp(dot3(currentDirection, neighborDirection), -1, 1);
  const angleRad = Math.acos(normalizedDot);

  if (angleRad < 0.05 || angleRad > Math.PI - 0.05) {
    return 0;
  }

  const halfReferenceThicknessM = Math.max(currentThicknessM, neighborThicknessM) / 2;
  const rawExtensionM = halfReferenceThicknessM / Math.tan(angleRad / 2);
  const limitedExtensionM = clamp(
    rawExtensionM,
    0,
    Math.max(currentThicknessM, neighborThicknessM) * 3,
  );

  return Number.isFinite(limitedExtensionM) ? limitedExtensionM : 0;
}

function trimSegmentLengthForLanding(segmentLengthM: number, trimM: number) {
  return Math.max(0, Math.min(trimM, Math.max(segmentLengthM / 2 - 0.05, 0)));
}

function pointAlong2DSegment(start: Vec2, end: Vec2, offsetM: number) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthM = Math.hypot(deltaX, deltaY);
  if (lengthM < 0.0001) {
    return start;
  }

  const t = offsetM / lengthM;
  return {
    x: start.x + deltaX * t,
    y: start.y + deltaY * t,
  };
}

function createYawBoxVertices(center: Vec3, sizeX: number, sizeY: number, sizeZ: number, yawRad: number) {
  const halfX = sizeX / 2;
  const halfY = sizeY / 2;
  const halfZ = sizeZ / 2;
  const cos = Math.cos(yawRad);
  const sin = Math.sin(yawRad);
  const localVertices = [
    vec3(-halfX, -halfY, -halfZ),
    vec3(halfX, -halfY, -halfZ),
    vec3(halfX, halfY, -halfZ),
    vec3(-halfX, halfY, -halfZ),
    vec3(-halfX, -halfY, halfZ),
    vec3(halfX, -halfY, halfZ),
    vec3(halfX, halfY, halfZ),
    vec3(-halfX, halfY, halfZ),
  ];

  return localVertices.map((vertex) =>
    add3(
      center,
      vec3(
        vertex.x * cos - vertex.z * sin,
        vertex.y,
        vertex.x * sin + vertex.z * cos,
      ),
    ),
  );
}

export function buildPreview3DScene(
  project: Project,
  renderMode: Preview3DRenderMode,
  surfaceMode: Preview3DSurfaceMode,
  hiddenRoofLayerIds: readonly string[] = [],
): Preview3DSceneData {
  const levelById = new Map(project.levels.map((level) => [level.id, level] as const));
  const levelIndexById = new Map(project.levels.map((level, index) => [level.id, index] as const));
  const hiddenRoofLayerIdSet = new Set(hiddenRoofLayerIds);
  const wallTypeById = new Map(project.wallTypes.map((wallType) => [wallType.id, wallType] as const));
  const nodeById = new Map(project.nodes.map((node) => [node.id, node] as const));
  const wallOpeningsByWallId = new Map<string, WallOpeningRender[]>();
  const nodeWallAggregates = new Map<string, NodeWallAggregate>();
  const solvedRoofs = solveProjectRoofs(project);

  const boxes: Preview3DBoxPrimitive[] = [];
  const cylinders: Preview3DCylinderPrimitive[] = [];
  const markers: Preview3DMarkerPrimitive[] = [];
  const meshes: Preview3DMeshPrimitive[] = [];
  const worldPoints: Vec3[] = [];

  const registerPoints = (points: Vec3[]) => {
    worldPoints.push(...points);
  };

  const addBoxPrimitive = (
    center: Vec3,
    sizeX: number,
    sizeY: number,
    sizeZ: number,
    yawRad: number,
    color: RgbColor,
  ) => {
    boxes.push({
      kind: "box",
      center: [center.x, center.y, center.z],
      size: [sizeX, sizeY, sizeZ],
      yawRad,
      color: rgbToCss(color),
    });
    registerPoints(createYawBoxVertices(center, sizeX, sizeY, sizeZ, yawRad));
  };

  const addCylinderPrimitive = (
    center: Vec3,
    radius: number,
    height: number,
    color: RgbColor,
  ) => {
    cylinders.push({
      kind: "cylinder",
      center: [center.x, center.y, center.z],
      radius,
      height,
      color: rgbToCss(color),
    });
    registerPoints([
      vec3(center.x - radius, center.y - height / 2, center.z - radius),
      vec3(center.x + radius, center.y + height / 2, center.z + radius),
    ]);
  };

  const addMeshPrimitive = (
    vertices: Vec3[],
    indices: number[],
    color: RgbColor,
    opacity?: number,
  ) => {
    meshes.push({
      kind: "mesh",
      vertices: vertices.map((vertex) => [vertex.x, vertex.y, vertex.z]),
      indices,
      color: rgbToCss(color),
      opacity,
    });
    registerPoints(vertices);
  };

  type SolvedRoof = ReturnType<typeof solveProjectRoofs>[number];
  type SolvedRoofFace = SolvedRoof["faces"][number];

  const getRoofFaceBasis = (face: SolvedRoofFace) => {
    const originPlan = face.polygonLocal[0] ?? createVec2();
    const origin = vec3(
      originPlan.x,
      face.planeOuter.uCoeff * originPlan.x +
        face.planeOuter.vCoeff * originPlan.y +
        face.planeOuter.constantM,
      -originPlan.y,
    );
    const tangentX = vec3(1, face.planeOuter.uCoeff, 0);
    const tangentY = vec3(0, face.planeOuter.vCoeff, -1);
    const normal = normalize3(cross3(tangentX, tangentY));
    const gradientLength = Math.hypot(face.planeOuter.uCoeff, face.planeOuter.vCoeff);
    const widthAxis =
      gradientLength > 0.0001
        ? normalize3(vec3(-face.planeOuter.vCoeff, 0, -face.planeOuter.uCoeff))
        : normalize3(tangentX);
    const heightAxis = normalize3(cross3(normal, widthAxis));

    const toWorld = (point: Vec2) => {
      return vec3(
        point.x,
        face.planeOuter.uCoeff * point.x +
          face.planeOuter.vCoeff * point.y +
          face.planeOuter.constantM,
        -point.y,
      );
    };
    const toUv = (point: Vec2) => {
      const delta = subtract3(toWorld(point), origin);
      return createVec2(dot3(delta, widthAxis), dot3(delta, heightAxis));
    };
    const fromUv = (point: Vec2) =>
      add3(origin, add3(scale3(widthAxis, point.x), scale3(heightAxis, point.y)));

    return { origin, widthAxis, heightAxis, normal, toUv, fromUv };
  };

  const getRoofOpeningDimensions = (opening: Project["roofOpenings"][number]) => {
    return opening.rotationDeg === 90
      ? { widthM: opening.heightM, heightM: opening.widthM }
      : { widthM: opening.widthM, heightM: opening.heightM };
  };

  const addRoofFaceShell = (topVertices: Vec3[], thicknessM: number, color: RgbColor) => {
    if (topVertices.length < 3) {
      return;
    }

    const safeThicknessM = Math.max(thicknessM, 0.01);
    const bottomVertices = topVertices.map((vertex) =>
      vec3(vertex.x, vertex.y - safeThicknessM, vertex.z),
    );
    const vertices = [...topVertices, ...bottomVertices];
    const vertexCount = topVertices.length;
    const indices: number[] = [];

    for (let index = 1; index < vertexCount - 1; index += 1) {
      indices.push(0, index, index + 1);
    }

    for (let index = 1; index < vertexCount - 1; index += 1) {
      indices.push(vertexCount, vertexCount + index + 1, vertexCount + index);
    }

    for (let index = 0; index < vertexCount; index += 1) {
      const nextIndex = (index + 1) % vertexCount;
      const topStart = index;
      const topEnd = nextIndex;
      const bottomStart = vertexCount + index;
      const bottomEnd = vertexCount + nextIndex;
      indices.push(topStart, topEnd, bottomEnd, topStart, bottomEnd, bottomStart);
    }

    addMeshPrimitive(vertices, indices, color);
  };

  const addSectionBox = (
    thicknessM: number,
    heightM: number,
    zStartM: number,
    start: Vec3,
    end: Vec3,
    color: RgbColor,
  ) => {
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.sqrt(dx * dx + dz * dz);
    const yawRad = Math.atan2(dx, dz);
    const center = vec3(
      (start.x + end.x) / 2,
      start.y + zStartM + heightM / 2,
      (start.z + end.z) / 2,
    );

    addBoxPrimitive(center, thicknessM, heightM, Math.max(length, 0.01), yawRad, color);
  };

  const addSlopedWallSection = (
    thicknessM: number,
    bottomHeightM: number,
    startTopHeightM: number,
    endTopHeightM: number,
    start: Vec3,
    end: Vec3,
    color: RgbColor,
  ) => {
    const deltaX = end.x - start.x;
    const deltaZ = end.z - start.z;
    const lengthM = Math.hypot(deltaX, deltaZ);
    if (lengthM < 0.0001) {
      return;
    }

    const halfThicknessM = thicknessM / 2;
    const normalX = -deltaZ / lengthM;
    const normalZ = deltaX / lengthM;
    const startLeft = vec3(start.x + normalX * halfThicknessM, bottomHeightM, start.z + normalZ * halfThicknessM);
    const startRight = vec3(start.x - normalX * halfThicknessM, bottomHeightM, start.z - normalZ * halfThicknessM);
    const endRight = vec3(end.x - normalX * halfThicknessM, bottomHeightM, end.z - normalZ * halfThicknessM);
    const endLeft = vec3(end.x + normalX * halfThicknessM, bottomHeightM, end.z + normalZ * halfThicknessM);
    const topStartLeft = vec3(startLeft.x, startTopHeightM, startLeft.z);
    const topStartRight = vec3(startRight.x, startTopHeightM, startRight.z);
    const topEndRight = vec3(endRight.x, endTopHeightM, endRight.z);
    const topEndLeft = vec3(endLeft.x, endTopHeightM, endLeft.z);

    addMeshPrimitive(
      [
        startLeft,
        startRight,
        endRight,
        endLeft,
        topStartLeft,
        topStartRight,
        topEndRight,
        topEndLeft,
      ],
      [
        0, 2, 1,
        0, 3, 2,
        0, 1, 5,
        0, 5, 4,
        1, 2, 6,
        1, 6, 5,
        2, 3, 7,
        2, 7, 6,
        3, 0, 4,
        3, 4, 7,
        4, 5, 6,
        4, 6, 7,
      ],
      color,
    );
  };

  const addShapePrimitive = (shape: Shape, levelElevationM: number, color: RgbColor) => {
    const center = vec3(
      shape.pose.position.x,
      levelElevationM + shape.zStartM + shape.heightM / 2,
      -shape.pose.position.y,
    );

    if (shape.kind === "Cylinder") {
      addCylinderPrimitive(center, shape.sizeM / 2, shape.heightM, color);
      return;
    }

    addBoxPrimitive(center, shape.sizeM, shape.heightM, shape.sizeM, 0, color);
  };

  const addSolvedRoofMesh = (solvedRoof: SolvedRoof, color: RgbColor) => {
    solvedRoof.faces.forEach((face) => {
      const faceOpenings = project.roofOpenings.filter(
        (opening) =>
          opening.roofSketchId === solvedRoof.sketchId && opening.roofFaceId === face.id,
      );
      const thicknessM = Math.max(face.thicknessM, 0.01);

      if (faceOpenings.length === 0) {
        const topVertices = face.polygonLocal.map((localPoint) =>
          vec3(
            localPoint.x,
            face.planeOuter.uCoeff * localPoint.x +
              face.planeOuter.vCoeff * localPoint.y +
              face.planeOuter.constantM,
            -localPoint.y,
          ),
        );
        addRoofFaceShell(topVertices, thicknessM, color);
        return;
      }

      const basis = getRoofFaceBasis(face);
      const polygonUv = face.polygonLocal.map((localPoint) => basis.toUv(localPoint));
      const minU = Math.min(...polygonUv.map((point) => point.x));
      const maxU = Math.max(...polygonUv.map((point) => point.x));
      const minV = Math.min(...polygonUv.map((point) => point.y));
      const maxV = Math.max(...polygonUv.map((point) => point.y));
      const openingRects = faceOpenings.map((opening) => {
        const centerUv = basis.toUv(opening.center);
        const { widthM, heightM } = getRoofOpeningDimensions(opening);
        return {
          minU: centerUv.x - widthM / 2,
          maxU: centerUv.x + widthM / 2,
          minV: centerUv.y - heightM / 2,
          maxV: centerUv.y + heightM / 2,
        };
      });
      const uCuts = uniqueSortedCuts([
        minU,
        maxU,
        ...openingRects.flatMap((rect) => [
          clamp(rect.minU, minU, maxU),
          clamp(rect.maxU, minU, maxU),
        ]),
      ]);
      const vCuts = uniqueSortedCuts([
        minV,
        maxV,
        ...openingRects.flatMap((rect) => [
          clamp(rect.minV, minV, maxV),
          clamp(rect.maxV, minV, maxV),
        ]),
      ]);

      for (let uIndex = 0; uIndex < uCuts.length - 1; uIndex += 1) {
        for (let vIndex = 0; vIndex < vCuts.length - 1; vIndex += 1) {
          const cellMinU = uCuts[uIndex];
          const cellMaxU = uCuts[uIndex + 1];
          const cellMinV = vCuts[vIndex];
          const cellMaxV = vCuts[vIndex + 1];
          if (cellMaxU - cellMinU < 0.001 || cellMaxV - cellMinV < 0.001) {
            continue;
          }

          const intersectsOpening = openingRects.some(
            (rect) =>
              cellMaxU > rect.minU + 0.001 &&
              cellMinU < rect.maxU - 0.001 &&
              cellMaxV > rect.minV + 0.001 &&
              cellMinV < rect.maxV - 0.001,
          );
          if (intersectsOpening) {
            continue;
          }

          const clippedCell = clipPolygonToConvexPolygon(
            [
              createVec2(cellMinU, cellMinV),
              createVec2(cellMaxU, cellMinV),
              createVec2(cellMaxU, cellMaxV),
              createVec2(cellMinU, cellMaxV),
            ],
            polygonUv,
          );
          if (clippedCell.length < 3) {
            continue;
          }

          addRoofFaceShell(
            clippedCell.map((point) => basis.fromUv(point)),
            thicknessM,
            color,
          );
        }
      }
    });
  };

  const addSlabPrimitive = (slab: Slab, levelElevationM: number, color: RgbColor) => {
    const center = vec3(
      slab.pose.position.x,
      levelElevationM + slab.zOffsetM + slab.thicknessM / 2,
      -slab.pose.position.y,
    );

    if (slab.kind === "Circle") {
      addCylinderPrimitive(center, Math.max(slab.widthM, slab.depthM) / 2, slab.thicknessM, color);
      return;
    }

    if (slab.roofType !== "Flat") {
      const solvedRoof =
        solvedRoofs.find((roof) => roof.sourceKind === "LegacySlab" && roof.slabId === slab.id) ??
        solveRoofFromSlab(slab, levelElevationM);
      if (!solvedRoof) {
        return;
      }

      addSolvedRoofMesh(solvedRoof, shadeColor(color, 0.78));
      return;
    }

    addBoxPrimitive(center, slab.widthM, slab.thicknessM, slab.depthM, 0, color);
  };

  const addStairPrimitives = (stair: Stair, levelElevationM: number, color: RgbColor) => {
    if (stair.pathNodes.length < 2) {
      return;
    }

    const segmentDefinitions = stair.pathNodes
      .slice(0, -1)
      .map((startPoint, index) => {
        const endPoint = stair.pathNodes[index + 1];
        const lengthM = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);
        return { index, startPoint, endPoint, lengthM };
      })
      .filter((segment) => segment.lengthM > 0.0001);

    if (segmentDefinitions.length === 0) {
      return;
    }

    const landingHalfM = stair.landingLengthM / 2;
    const effectiveSegments = segmentDefinitions.map((segment, index, segments) => {
      const startTrimM = index > 0 ? trimSegmentLengthForLanding(segment.lengthM, landingHalfM) : 0;
      const endTrimM =
        index < segments.length - 1
          ? trimSegmentLengthForLanding(segment.lengthM, landingHalfM)
          : 0;

      return {
        ...segment,
        startTrimM,
        endTrimM,
        effectiveLengthM: Math.max(segment.lengthM - startTrimM - endTrimM, 0),
      };
    });

    const totalEffectiveRunM = effectiveSegments.reduce(
      (sum, segment) => sum + segment.effectiveLengthM,
      0,
    );
    const totalRiseM = stair.endElevationM - levelElevationM;
    const sections = effectiveSegments.filter((segment) => segment.effectiveLengthM > 0.0001);
    const sectionCount = sections.length;
    const totalStepCount = Math.max(
      sectionCount,
      Math.round(Math.abs(totalRiseM) / stair.riserHeightM),
    );
    const stepCounts = sections.map(() => 1);
    let remainingStepCount = Math.max(0, totalStepCount - sectionCount);

    const weightedAdditionalCounts = sections.map((section) => {
      if (remainingStepCount === 0 || totalEffectiveRunM <= 0.0001) {
        return { integer: 0, remainder: 0 };
      }

      const rawAdditional = (section.effectiveLengthM / totalEffectiveRunM) * remainingStepCount;
      const integer = Math.floor(rawAdditional);
      return {
        integer,
        remainder: rawAdditional - integer,
      };
    });

    weightedAdditionalCounts.forEach((allocation, index) => {
      stepCounts[index] += allocation.integer;
      remainingStepCount -= allocation.integer;
    });

    weightedAdditionalCounts
      .map((allocation, index) => ({ ...allocation, index }))
      .sort((left, right) => right.remainder - left.remainder)
      .slice(0, remainingStepCount)
      .forEach((allocation) => {
        stepCounts[allocation.index] += 1;
      });

    let accumulatedElevationM = levelElevationM;
    sections.forEach((section, sectionIndex) => {
      const segmentStepCount = stepCounts[sectionIndex];
      const segmentRiseM =
        totalEffectiveRunM > 0.0001
          ? (totalRiseM * section.effectiveLengthM) / totalEffectiveRunM
          : totalRiseM / sectionCount;
      const stepRiseM = segmentRiseM / segmentStepCount;
      const stepRunM = section.effectiveLengthM / segmentStepCount;

      for (let stepIndex = 0; stepIndex < segmentStepCount; stepIndex += 1) {
        const localStartOffsetM = section.startTrimM + stepRunM * stepIndex;
        const localEndOffsetM = section.startTrimM + stepRunM * (stepIndex + 1);
        const startPoint2D = pointAlong2DSegment(
          section.startPoint,
          section.endPoint,
          localStartOffsetM,
        );
        const endPoint2D = pointAlong2DSegment(
          section.startPoint,
          section.endPoint,
          localEndOffsetM,
        );
        const stepStartElevationM = accumulatedElevationM + stepRiseM * stepIndex;
        const stepEndElevationM = accumulatedElevationM + stepRiseM * (stepIndex + 1);
        const stepBottomElevationM = Math.min(stepStartElevationM, stepEndElevationM);
        const stepHeightM = Math.max(Math.abs(stepEndElevationM - stepStartElevationM), 0.02);

        addSectionBox(
          stair.widthM,
          stepHeightM,
          stepBottomElevationM - levelElevationM,
          toWorldPoint2D(startPoint2D, levelElevationM),
          toWorldPoint2D(endPoint2D, levelElevationM),
          color,
        );
      }

      accumulatedElevationM += segmentRiseM;
    });

    if (stair.pathNodes.length > 2) {
      const platformSizeM = Math.max(stair.widthM, stair.landingLengthM || stair.widthM);
      let consumedRunM = 0;

      effectiveSegments.forEach((segment, index) => {
        consumedRunM += segment.effectiveLengthM;
        const nodeIndex = index + 1;
        if (nodeIndex >= stair.pathNodes.length - 1) {
          return;
        }

        const landingElevationM =
          totalEffectiveRunM > 0.0001
            ? levelElevationM + (totalRiseM * consumedRunM) / totalEffectiveRunM
            : levelElevationM;
        const sectionStepCount = Math.max(stepCounts[Math.min(index, stepCounts.length - 1)] ?? 1, 1);
        const segmentRiseM =
          totalEffectiveRunM > 0.0001
            ? (totalRiseM * segment.effectiveLengthM) / totalEffectiveRunM
            : totalRiseM / Math.max(sections.length, 1);
        const platformHeightM = Math.max(Math.abs(segmentRiseM / sectionStepCount), 0.02);
        const platformBottomM =
          totalRiseM >= 0 ? landingElevationM - platformHeightM : landingElevationM;
        const nodePoint = stair.pathNodes[nodeIndex];

        addBoxPrimitive(
          vec3(nodePoint.x, platformBottomM + platformHeightM / 2, -nodePoint.y),
          platformSizeM,
          platformHeightM,
          platformSizeM,
          0,
          shadeColor(color, 0.94),
        );
      });
    }
  };

  for (const door of project.doors) {
    const currentOpenings = wallOpeningsByWallId.get(door.wallId) ?? [];
    currentOpenings.push({
      kind: "door",
      offsetM: door.offsetM,
      widthM: door.widthM,
      heightM: door.heightM,
      sillHeightM: 0,
    });
    wallOpeningsByWallId.set(door.wallId, currentOpenings);
  }

  for (const windowOpening of project.windows) {
    const currentOpenings = wallOpeningsByWallId.get(windowOpening.wallId) ?? [];
    currentOpenings.push({
      kind: "window",
      offsetM: windowOpening.offsetM,
      widthM: windowOpening.widthM,
      heightM: windowOpening.heightM,
      sillHeightM: windowOpening.sillHeightM,
    });
    wallOpeningsByWallId.set(windowOpening.wallId, currentOpenings);
  }

  for (const wall of project.walls) {
    const wallType = wallTypeById.get(wall.wallTypeId);
    if (!wallType) {
      continue;
    }

    for (const nodeId of [wall.startNodeId, wall.endNodeId]) {
      const current = nodeWallAggregates.get(nodeId) ?? {
        count: 0,
        maxThicknessM: 0,
        maxHeightM: 0,
      };
      nodeWallAggregates.set(nodeId, {
        count: current.count + 1,
        maxThicknessM: Math.max(current.maxThicknessM, wallType.thicknessM),
        maxHeightM: Math.max(current.maxHeightM, wallType.heightM),
      });
    }
  }

  for (const wall of project.walls) {
    const level = levelById.get(wall.levelId);
    const wallType = wallTypeById.get(wall.wallTypeId);
    const startNode = nodeById.get(wall.startNodeId);
    const endNode = nodeById.get(wall.endNodeId);
    if (!level || !wallType || !startNode || !endNode) {
      continue;
    }

    const startAggregate = nodeWallAggregates.get(wall.startNodeId);
    const endAggregate = nodeWallAggregates.get(wall.endNodeId);
    const startWorld = toWorldPoint2D(startNode.position, level.elevationM);
    const endWorld = toWorldPoint2D(endNode.position, level.elevationM);
    const startDirection = normalize3(subtract3(endWorld, startWorld));
    const endDirection = normalize3(subtract3(startWorld, endWorld));
    const startFallbackExtensionM =
      renderMode === "ArchitecturalJoin" && (startAggregate?.count ?? 0) > 1
        ? (startAggregate?.maxThicknessM ?? wallType.thicknessM) / 2
        : 0;
    const endFallbackExtensionM =
      renderMode === "ArchitecturalJoin" && (endAggregate?.count ?? 0) > 1
        ? (endAggregate?.maxThicknessM ?? wallType.thicknessM) / 2
        : 0;
    const startNeighborWall =
      renderMode === "ArchitecturalJoin" && (startAggregate?.count ?? 0) === 2
        ? project.walls.find(
            (candidate) =>
              candidate.id !== wall.id &&
              (candidate.startNodeId === wall.startNodeId ||
                candidate.endNodeId === wall.startNodeId),
          ) ?? null
        : null;
    const endNeighborWall =
      renderMode === "ArchitecturalJoin" && (endAggregate?.count ?? 0) === 2
        ? project.walls.find(
            (candidate) =>
              candidate.id !== wall.id &&
              (candidate.startNodeId === wall.endNodeId ||
                candidate.endNodeId === wall.endNodeId),
          ) ?? null
        : null;
    const startNeighborDirection =
      startNeighborWall
        ? (() => {
            const neighborStartNode = nodeById.get(startNeighborWall.startNodeId);
            const neighborEndNode = nodeById.get(startNeighborWall.endNodeId);
            if (!neighborStartNode || !neighborEndNode) {
              return null;
            }

            const neighborStartWorld = toWorldPoint2D(neighborStartNode.position, level.elevationM);
            const neighborEndWorld = toWorldPoint2D(neighborEndNode.position, level.elevationM);
            return startNeighborWall.startNodeId === wall.startNodeId
              ? normalize3(subtract3(neighborEndWorld, neighborStartWorld))
              : normalize3(subtract3(neighborStartWorld, neighborEndWorld));
          })()
        : null;
    const endNeighborDirection =
      endNeighborWall
        ? (() => {
            const neighborStartNode = nodeById.get(endNeighborWall.startNodeId);
            const neighborEndNode = nodeById.get(endNeighborWall.endNodeId);
            if (!neighborStartNode || !neighborEndNode) {
              return null;
            }

            const neighborStartWorld = toWorldPoint2D(neighborStartNode.position, level.elevationM);
            const neighborEndWorld = toWorldPoint2D(neighborEndNode.position, level.elevationM);
            return endNeighborWall.startNodeId === wall.endNodeId
              ? normalize3(subtract3(neighborEndWorld, neighborStartWorld))
              : normalize3(subtract3(neighborStartWorld, neighborEndWorld));
          })()
        : null;
    const startExtensionM =
      startNeighborWall && startNeighborDirection
        ? computeAngularWallExtension(
            startDirection,
            startNeighborDirection,
            wallType.thicknessM,
            wallTypeById.get(startNeighborWall.wallTypeId)?.thicknessM ?? wallType.thicknessM,
          )
        : startFallbackExtensionM;
    const endExtensionM =
      endNeighborWall && endNeighborDirection
        ? computeAngularWallExtension(
            endDirection,
            endNeighborDirection,
            wallType.thicknessM,
            wallTypeById.get(endNeighborWall.wallTypeId)?.thicknessM ?? wallType.thicknessM,
          )
        : endFallbackExtensionM;

    const wallColor = getBaseSurfaceColor(levelIndexById.get(level.id) ?? 0, surfaceMode);
    const wallStart = extendWallEndpoint(startWorld, endWorld, startExtensionM, "start");
    const wallEnd = extendWallEndpoint(startWorld, endWorld, endExtensionM, "end");
    const wallDirection = normalize3(subtract3(endWorld, startWorld));
    const wallLengthM = length3(subtract3(endWorld, startWorld));
    const wallOpenings = (wallOpeningsByWallId.get(wall.id) ?? [])
      .slice()
      .sort((left, right) => left.offsetM - right.offsetM);
    const getWallOffsetForPlanPoint = (point: Vec2) => {
      const pointWorld = toWorldPoint2D(point, level.elevationM);
      const delta = subtract3(pointWorld, startWorld);
      return dot3(delta, wallDirection);
    };

    if (wall.topMode === "FollowRoof") {
      const matchingRoof = solvedRoofs.find((roof) => {
        const wallSegments = solveWallSegmentsAgainstRoof(
          roof,
          createVec2(startWorld.x, -startWorld.z),
          createVec2(endWorld.x, -endWorld.z),
        );
        return wallSegments.length > 0;
      });

      if (matchingRoof) {
        const roofWallSegments = solveWallSegmentsAgainstRoof(
          matchingRoof,
          createVec2(startWorld.x, -startWorld.z),
          createVec2(endWorld.x, -endWorld.z),
        );
        const adjustedRoofWallSegments = roofWallSegments.map((segment, index) => {
          if (index === 0) {
            const extendedStart = createVec2(wallStart.x, -wallStart.z);
            const extendedStartHeightM =
              getRoofHeightAtPoint(matchingRoof, extendedStart, "inner") ?? segment.startHeightM;
            return {
              ...segment,
              start: extendedStart,
              startHeightM: extendedStartHeightM,
            };
          }

          if (index === roofWallSegments.length - 1) {
            const extendedEnd = createVec2(wallEnd.x, -wallEnd.z);
            const extendedEndHeightM =
              getRoofHeightAtPoint(matchingRoof, extendedEnd, "inner") ?? segment.endHeightM;
            return {
              ...segment,
              end: extendedEnd,
              endHeightM: extendedEndHeightM,
            };
          }

          return segment;
        });

        const maxWallTopHeightM = level.elevationM + wallType.heightM;
        const renderFollowRoofSpan = (
          segmentStartOffsetM: number,
          segmentEndOffsetM: number,
          bottomHeightM: number,
          topStartHeightM: number,
          topEndHeightM: number,
        ) => {
          if (segmentEndOffsetM <= segmentStartOffsetM + 0.0001) {
            return;
          }

          if (Math.max(topStartHeightM, topEndHeightM) <= bottomHeightM + 0.0001) {
            return;
          }

          addSlopedWallSection(
            wallType.thicknessM,
            bottomHeightM,
            Math.max(topStartHeightM, bottomHeightM),
            Math.max(topEndHeightM, bottomHeightM),
            pointAlongWall(startWorld, wallDirection, segmentStartOffsetM),
            pointAlongWall(startWorld, wallDirection, segmentEndOffsetM),
            wallColor,
          );
        };

        const renderFollowRoofSegmentWithOpenings = (segment: RoofWallSegment) => {
          const rawStartOffsetM = getWallOffsetForPlanPoint(segment.start);
          const rawEndOffsetM = getWallOffsetForPlanPoint(segment.end);
          if (Math.abs(rawEndOffsetM - rawStartOffsetM) < 0.0001) {
            return;
          }

          const startOffsetM = Math.min(rawStartOffsetM, rawEndOffsetM);
          const endOffsetM = Math.max(rawStartOffsetM, rawEndOffsetM);
          const heightAtOffset = (offsetM: number) => {
            const t = clamp(
              (offsetM - rawStartOffsetM) / (rawEndOffsetM - rawStartOffsetM),
              0,
              1,
            );
            return segment.startHeightM + (segment.endHeightM - segment.startHeightM) * t;
          };
          let cursorOffsetM = startOffsetM;

          for (const opening of wallOpenings) {
            const openingStartOffsetM = opening.offsetM - opening.widthM / 2;
            const openingEndOffsetM = opening.offsetM + opening.widthM / 2;
            const clippedOpeningStartM = Math.max(openingStartOffsetM, startOffsetM);
            const clippedOpeningEndM = Math.min(openingEndOffsetM, endOffsetM);
            if (clippedOpeningEndM <= clippedOpeningStartM + 0.0001) {
              continue;
            }

            if (clippedOpeningStartM > cursorOffsetM + 0.0001) {
              renderFollowRoofSpan(
                cursorOffsetM,
                clippedOpeningStartM,
                level.elevationM,
                heightAtOffset(cursorOffsetM),
                heightAtOffset(clippedOpeningStartM),
              );
            }

            if (opening.kind === "door") {
              const lintelBottomM = level.elevationM + opening.heightM;
              renderFollowRoofSpan(
                clippedOpeningStartM,
                clippedOpeningEndM,
                lintelBottomM,
                heightAtOffset(clippedOpeningStartM),
                heightAtOffset(clippedOpeningEndM),
              );
            } else {
              const sillTopM = level.elevationM + opening.sillHeightM;
              const openingTopM = sillTopM + opening.heightM;
              if (opening.sillHeightM > 0.0001) {
                renderFollowRoofSpan(
                  clippedOpeningStartM,
                  clippedOpeningEndM,
                  level.elevationM,
                  Math.min(sillTopM, heightAtOffset(clippedOpeningStartM)),
                  Math.min(sillTopM, heightAtOffset(clippedOpeningEndM)),
                );
              }
              renderFollowRoofSpan(
                clippedOpeningStartM,
                clippedOpeningEndM,
                openingTopM,
                heightAtOffset(clippedOpeningStartM),
                heightAtOffset(clippedOpeningEndM),
              );
            }

            cursorOffsetM = Math.max(cursorOffsetM, clippedOpeningEndM);
          }

          if (cursorOffsetM < endOffsetM - 0.0001) {
            renderFollowRoofSpan(
              cursorOffsetM,
              endOffsetM,
              level.elevationM,
              heightAtOffset(cursorOffsetM),
              heightAtOffset(endOffsetM),
            );
          }
        };

        adjustedRoofWallSegments
          .flatMap((segment) =>
            splitAndClampRoofWallSegmentHeight(
              segment,
              level.elevationM,
              maxWallTopHeightM,
            ),
          )
          .forEach((segment) => {
            if (
              Math.max(segment.startHeightM, segment.endHeightM) <=
              level.elevationM + 0.0001
            ) {
              return;
            }

            if (wallOpenings.length === 0) {
              addSlopedWallSection(
                wallType.thicknessM,
                level.elevationM,
                segment.startHeightM,
                segment.endHeightM,
                vec3(segment.start.x, level.elevationM, -segment.start.y),
                vec3(segment.end.x, level.elevationM, -segment.end.y),
                wallColor,
              );
              return;
            }

            renderFollowRoofSegmentWithOpenings(segment);
          });
        continue;
      }
    }

    if (wallOpenings.length === 0) {
      addSectionBox(
        wallType.thicknessM,
        wallType.heightM,
        0,
        wallStart,
        wallEnd,
        wallColor,
      );
      continue;
    }

    let segmentStartOffsetM = -startExtensionM;
    for (const opening of wallOpenings) {
      const openingStartOffsetM = opening.offsetM - opening.widthM / 2;
      const openingEndOffsetM = opening.offsetM + opening.widthM / 2;

      if (openingStartOffsetM > segmentStartOffsetM + 0.0001) {
        addSectionBox(
          wallType.thicknessM,
          wallType.heightM,
          0,
          pointAlongWall(startWorld, wallDirection, segmentStartOffsetM),
          pointAlongWall(startWorld, wallDirection, openingStartOffsetM),
          wallColor,
        );
      }

      if (opening.kind === "door") {
        const lintelHeightM = Math.max(wallType.heightM - opening.heightM, 0);
        if (lintelHeightM > 0.0001) {
          addSectionBox(
            wallType.thicknessM,
            lintelHeightM,
            opening.heightM,
            pointAlongWall(startWorld, wallDirection, openingStartOffsetM),
            pointAlongWall(startWorld, wallDirection, openingEndOffsetM),
            wallColor,
          );
        }
      } else {
        if (opening.sillHeightM > 0.0001) {
          addSectionBox(
            wallType.thicknessM,
            opening.sillHeightM,
            0,
            pointAlongWall(startWorld, wallDirection, openingStartOffsetM),
            pointAlongWall(startWorld, wallDirection, openingEndOffsetM),
            wallColor,
          );
        }

        const upperWindowWallHeightM = Math.max(
          wallType.heightM - opening.sillHeightM - opening.heightM,
          0,
        );
        if (upperWindowWallHeightM > 0.0001) {
          addSectionBox(
            wallType.thicknessM,
            upperWindowWallHeightM,
            opening.sillHeightM + opening.heightM,
            pointAlongWall(startWorld, wallDirection, openingStartOffsetM),
            pointAlongWall(startWorld, wallDirection, openingEndOffsetM),
            wallColor,
          );
        }
      }

      segmentStartOffsetM = openingEndOffsetM;
    }

    if (segmentStartOffsetM < wallLengthM + endExtensionM - 0.0001) {
      addSectionBox(
        wallType.thicknessM,
        wallType.heightM,
        0,
        pointAlongWall(startWorld, wallDirection, segmentStartOffsetM),
        pointAlongWall(startWorld, wallDirection, wallLengthM + endExtensionM),
        wallColor,
      );
    }
  }

  if (renderMode === "NodePost") {
    for (const node of project.nodes) {
      const level = levelById.get(node.levelId);
      const aggregate = nodeWallAggregates.get(node.id);
      if (!level || !aggregate || aggregate.count === 0) {
        continue;
      }

      addCylinderPrimitive(
        vec3(
          node.position.x,
          level.elevationM + aggregate.maxHeightM / 2,
          -node.position.y,
        ),
        Math.max(aggregate.maxThicknessM / 2, 0.04),
        aggregate.maxHeightM,
        shadeColor(getBaseSurfaceColor(levelIndexById.get(level.id) ?? 0, surfaceMode), 0.72),
      );
    }
  }

  for (const stair of project.stairs) {
    const level = levelById.get(stair.levelId);
    if (!level) {
      continue;
    }

    addStairPrimitives(
      stair,
      level.elevationM,
      surfaceMode === "GrayOpaque"
        ? { r: 150, g: 154, b: 160 }
        : { r: 134, g: 196, b: 231 },
    );
  }

  for (const slab of project.slabs) {
    const level = levelById.get(slab.levelId);
    if (!level) {
      continue;
    }

    addSlabPrimitive(
      slab,
      level.elevationM,
      shadeColor(
        getBaseSurfaceColor(levelIndexById.get(level.id) ?? 0, surfaceMode),
        surfaceMode === "GrayOpaque" ? 0.9 : 0.82,
      ),
    );
  }

  for (const roof of solvedRoofs) {
    if (roof.sourceKind !== "Sketch") {
      continue;
    }

    if (roof.layerId && hiddenRoofLayerIdSet.has(roof.layerId)) {
      continue;
    }

    addSolvedRoofMesh(
      roof,
      surfaceMode === "GrayOpaque"
        ? { r: 132, g: 136, b: 142 }
        : { r: 186, g: 124, b: 82 },
    );
  }
  for (const shape of project.shapes) {
    const level = levelById.get(shape.levelId);
    if (!level) {
      continue;
    }

    addShapePrimitive(
      shape,
      level.elevationM,
      surfaceMode === "GrayOpaque"
        ? { r: 156, g: 160, b: 166 }
        : shape.kind === "Cylinder"
          ? { r: 110, g: 193, b: 205 }
          : { r: 125, g: 209, b: 185 },
    );
  }

  for (const model of project.externalModels) {
    const level = levelById.get(model.levelId);
    if (!level) {
      continue;
    }

    const position = vec3(model.position.x, level.elevationM + model.zM, -model.position.y);
    markers.push({
      kind: "marker",
      position: [position.x, position.y, position.z],
      color: rgbToCss({ r: 255, g: 139, b: 94 }),
      radius: 0.12,
    });
    registerPoints([
      vec3(position.x - 0.12, position.y - 0.12, position.z - 0.12),
      vec3(position.x + 0.12, position.y + 0.12, position.z + 0.12),
    ]);
  }

  if (worldPoints.length === 0) {
    return {
      boxes,
      cylinders,
      markers,
      meshes,
      target: [0, 0, 0],
      radius: 10,
    };
  }

  const min = vec3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const max = vec3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  for (const point of worldPoints) {
    min.x = Math.min(min.x, point.x);
    min.y = Math.min(min.y, point.y);
    min.z = Math.min(min.z, point.z);
    max.x = Math.max(max.x, point.x);
    max.y = Math.max(max.y, point.y);
    max.z = Math.max(max.z, point.z);
  }

  return {
    boxes,
    cylinders,
    markers,
    meshes,
    target: [
      (min.x + max.x) / 2,
      (min.y + max.y) / 2,
      (min.z + max.z) / 2,
    ],
    radius: Math.max(4, length3(subtract3(max, min)) * 0.55),
  };
}
