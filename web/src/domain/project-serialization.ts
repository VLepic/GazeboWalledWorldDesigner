import { z } from "zod";
import {
  DEFAULT_ROOF_LAYER_ID,
  DEFAULT_ROOF_LAYER_NAME,
  DEFAULT_PROJECT_SETTINGS,
  createDoorOpening,
  createExternalModel,
  createId,
  createLevel,
  createMeasurement,
  createNodeData,
  createPose2D,
  createRoofLayer,
  createRoofOpening,
  createRoofSketch,
  createShape,
  createSlab,
  createStair,
  createVec2,
  createWall,
  createWallType,
  createWindowOpening,
  ensureProjectDefaults,
} from "./project-model";
import type {
  DoorOpening,
  ExternalModel,
  Level,
  Measurement,
  NodeData,
  Project,
  ProjectSettings,
  RoofConstraint,
  RoofEdge,
  RoofEdgeRole,
  RoofFaceDefinition,
  RoofLayer,
  RoofOpening,
  RoofSketch,
  RoofVertex,
  RoofVertexElevationMode,
  RoofType,
  Shape,
  ShapeKind,
  Slab,
  SlabKind,
  Stair,
  Wall,
  WallTopMode,
  WallType,
  WindowOpening,
} from "./project-model";
import {
  projectSchema,
  roofEdgeRoleSchema,
  roofOpeningCutModeSchema,
  roofOpeningRotationDegSchema,
  roofTypeSchema,
  roofVertexElevationModeSchema,
  shapeKindSchema,
  slabKindSchema,
  wallTopModeSchema,
} from "./project-schemas";

const finiteNumberInputSchema = z.coerce.number().finite();
const booleanInputSchema = z.boolean();
const nonEmptyStringInputSchema = z.string().trim().min(1);
const unknownArraySchema = z.array(z.unknown());
const unknownObjectSchema = z.record(z.string(), z.unknown());
const numericTuple2Schema = z.tuple([finiteNumberInputSchema, finiteNumberInputSchema]);
const numericTuple6Schema = z.tuple([
  finiteNumberInputSchema,
  finiteNumberInputSchema,
  finiteNumberInputSchema,
  finiteNumberInputSchema,
  finiteNumberInputSchema,
  finiteNumberInputSchema,
]);

export class ProjectParseError extends Error {
  issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = "ProjectParseError";
    this.issues = issues;
  }
}

export interface ProjectParseResult {
  project: Project;
  warnings: string[];
}

function asObject(value: unknown) {
  const parsed = unknownObjectSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function asArray(value: unknown) {
  const parsed = unknownArraySchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

function pickNumber(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const parsed = finiteNumberInputSchema.safeParse(source[key]);
    if (parsed.success) {
      return parsed.data;
    }
  }

  return undefined;
}

function pickString(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const parsed = nonEmptyStringInputSchema.safeParse(source[key]);
    if (parsed.success) {
      return parsed.data;
    }
  }

  return undefined;
}

function normalizeHexColor(value: unknown) {
  const parsed = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).safeParse(value);
  return parsed.success ? parsed.data.toLowerCase() : undefined;
}

function pickBoolean(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const parsed = booleanInputSchema.safeParse(source[key]);
    if (parsed.success) {
      return parsed.data;
    }
  }

  return undefined;
}

function pickParsedValue<T>(
  source: Record<string, unknown>,
  parser: (value: unknown) => T | undefined,
  ...keys: string[]
) {
  for (const key of keys) {
    const parsed = parser(source[key]);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

function pickVec2(source: Record<string, unknown>) {
  const nestedPosition = source.position;
  const nestedObject = asObject(nestedPosition);
  if (nestedObject) {
    const x = pickNumber(nestedObject, "x");
    const y = pickNumber(nestedObject, "y");
    if (x !== undefined && y !== undefined) {
      return createVec2(x, y);
    }
  }

  const x = pickNumber(source, "x");
  const y = pickNumber(source, "y");
  if (x !== undefined && y !== undefined) {
    return createVec2(x, y);
  }

  return undefined;
}

function pickPose2D(source: Record<string, unknown>) {
  const nestedPose = asObject(source.pose);
  if (nestedPose) {
    const position = pickVec2(nestedPose);
    const yawDeg =
      pickNumber(nestedPose, "yawDeg", "yaw_deg", "rotation_deg") ??
      pickNumber(source, "yawDeg", "yaw_deg", "rotation_deg") ??
      0;

    if (position) {
      return createPose2D(position, yawDeg);
    }
  }

  const position = pickVec2(source);
  if (!position) {
    return undefined;
  }

  const yawDeg = pickNumber(source, "yawDeg", "yaw_deg", "rotation_deg") ?? 0;
  return createPose2D(position, yawDeg);
}

function resolveReference(
  value: unknown,
  validIds: string[],
  fallbackId: string,
  label: string,
  warnings: string[],
  itemLabel: string,
) {
  const asString = nonEmptyStringInputSchema.safeParse(value);
  if (asString.success && validIds.includes(asString.data)) {
    return asString.data;
  }

  const asIndex = z.number().int().safeParse(value);
  if (asIndex.success && asIndex.data >= 0 && asIndex.data < validIds.length) {
    return validIds[asIndex.data];
  }

  warnings.push(`${itemLabel}: invalid ${label}, using fallback "${fallbackId}".`);
  return fallbackId;
}

function ensureUniqueIds<T extends { id: string }>(
  items: T[],
  prefix: string,
  label: string,
  warnings: string[],
) {
  const seen = new Set<string>();

  for (const item of items) {
    if (!item.id || seen.has(item.id)) {
      const previousId = item.id;
      item.id = createId(prefix);
      warnings.push(
        `${label}: reassigned ${previousId ? `duplicate` : "missing"} id to "${item.id}".`,
      );
    }

    seen.add(item.id);
  }
}

function parseSettings(data: unknown, warnings: string[]) {
  const source = asObject(data) ?? {};

  const settings: ProjectSettings = {
    gridSpacingM:
      pickNumber(source, "gridSpacingM", "grid_spacing_m", "grid_spacing") ??
      DEFAULT_PROJECT_SETTINGS.gridSpacingM,
    nodeRadiusPx:
      pickNumber(source, "nodeRadiusPx", "node_radius_px", "node_radius") ??
      DEFAULT_PROJECT_SETTINGS.nodeRadiusPx,
    lineWidthPx:
      pickNumber(source, "lineWidthPx", "line_width_px", "line_width") ??
      DEFAULT_PROJECT_SETTINGS.lineWidthPx,
    gridLineWidthPx:
      pickNumber(source, "gridLineWidthPx", "grid_line_width_px", "grid_line_width") ??
      DEFAULT_PROJECT_SETTINGS.gridLineWidthPx,
    axisLineWidthPx:
      pickNumber(source, "axisLineWidthPx", "axis_line_width_px", "axis_line_width") ??
      DEFAULT_PROJECT_SETTINGS.axisLineWidthPx,
    pixelsPerMeter:
      pickNumber(source, "pixelsPerMeter", "pixels_per_meter") ??
      DEFAULT_PROJECT_SETTINGS.pixelsPerMeter,
    snapToGrid:
      pickBoolean(source, "snapToGrid", "snap_to_grid") ??
      DEFAULT_PROJECT_SETTINGS.snapToGrid,
  };

  if (settings.gridSpacingM <= 0) {
    settings.gridSpacingM = DEFAULT_PROJECT_SETTINGS.gridSpacingM;
    warnings.push("settings: invalid grid spacing, restored default value.");
  }

  if (settings.pixelsPerMeter <= 0) {
    settings.pixelsPerMeter = DEFAULT_PROJECT_SETTINGS.pixelsPerMeter;
    warnings.push("settings: invalid pixels-per-meter, restored default value.");
  }

  return settings;
}

function parseLevels(data: unknown, warnings: string[]) {
  const levels: Level[] = [];

  for (const [index, item] of asArray(data).entries()) {
    const source = asObject(item);
    if (!source) {
      warnings.push(`levels[${index}]: skipped invalid level entry.`);
      continue;
    }

    levels.push(
      createLevel({
        id: pickString(source, "id") ?? createId("level"),
        name: pickString(source, "name") ?? `Level ${index}`,
        elevationM: pickNumber(source, "elevationM", "elevation_m", "elevation") ?? 0,
      }),
    );
  }

  return levels;
}

function parseWallTypes(
  data: unknown,
  settingsSource: unknown,
  warnings: string[],
) {
  const wallTypes: WallType[] = [];

  for (const [index, item] of asArray(data).entries()) {
    const source = asObject(item);
    if (!source) {
      warnings.push(`wallTypes[${index}]: skipped invalid wall type entry.`);
      continue;
    }

    const thicknessM =
      pickNumber(source, "thicknessM", "thickness_m", "thickness") ?? 0.2;
    const heightM = pickNumber(source, "heightM", "height_m", "height") ?? 2;

    if (thicknessM <= 0 || heightM <= 0) {
      warnings.push(`wallTypes[${index}]: skipped wall type with non-positive dimensions.`);
      continue;
    }

    wallTypes.push(
      createWallType({
        id: pickString(source, "id") ?? createId("wall_type"),
        name: pickString(source, "name") ?? `Wall Type ${index + 1}`,
        thicknessM,
        heightM,
      }),
    );
  }

  if (wallTypes.length === 0) {
    const settings = asObject(settingsSource) ?? {};
    wallTypes.push(
      createWallType({
        name: "Wall Type 1",
        thicknessM: pickNumber(settings, "wall_thickness") ?? 0.2,
        heightM: pickNumber(settings, "wall_height") ?? 2,
      }),
    );
    warnings.push("wallTypes: no wall types supplied, created a default wall type.");
  }

  return wallTypes;
}

function parseRoofLayers(data: unknown, warnings: string[]) {
  const roofLayers: RoofLayer[] = [];

  for (const [index, item] of asArray(data).entries()) {
    const source = asObject(item);
    if (!source) {
      warnings.push(`roofLayers[${index}]: skipped invalid roof layer entry.`);
      continue;
    }

    roofLayers.push(
      createRoofLayer({
        id: pickString(source, "id") ?? createId("roof_layer"),
        name: pickString(source, "name") ?? `Roof Layer ${index + 1}`,
        visible2D: pickBoolean(source, "visible2D", "visible_2d") ?? true,
        visible3D: pickBoolean(source, "visible3D", "visible_3d") ?? true,
      }),
    );
  }

  if (roofLayers.length === 0) {
    roofLayers.push(createRoofLayer({ id: DEFAULT_ROOF_LAYER_ID, name: DEFAULT_ROOF_LAYER_NAME }));
  }

  return roofLayers;
}

function parseRoofConstraints(data: unknown, warnings: string[], itemLabel: string) {
  const constraints: RoofConstraint[] = [];

  for (const [index, value] of asArray(data).entries()) {
    const source = asObject(value);
    if (!source) {
      warnings.push(`${itemLabel}.constraints[${index}]: skipped invalid constraint.`);
      continue;
    }

    const kind = pickString(source, "kind");
    if (kind === "VertexHeight") {
      const vertexId = pickString(source, "vertexId", "vertex_id");
      const elevationM = pickNumber(source, "elevationM", "elevation_m", "heightM", "height_m");
      if (!vertexId || elevationM === undefined) {
        warnings.push(`${itemLabel}.constraints[${index}]: skipped invalid vertex height constraint.`);
        continue;
      }

      constraints.push({ kind, id: pickString(source, "id") ?? createId("roof_constraint"), vertexId, elevationM });
      continue;
    }

    if (kind === "EdgeHeight") {
      const edgeId = pickString(source, "edgeId", "edge_id");
      const elevationM = pickNumber(source, "elevationM", "elevation_m", "heightM", "height_m");
      if (!edgeId || elevationM === undefined) {
        warnings.push(`${itemLabel}.constraints[${index}]: skipped invalid edge height constraint.`);
        continue;
      }

      constraints.push({ kind, id: pickString(source, "id") ?? createId("roof_constraint"), edgeId, elevationM });
      continue;
    }

    if (kind === "FaceSlope") {
      const faceId = pickString(source, "faceId", "face_id");
      const referenceEdgeId = pickString(source, "referenceEdgeId", "reference_edge_id");
      const angleDeg = pickNumber(source, "angleDeg", "angle_deg", "slopeDeg", "slope_deg");
      const rawDirection = pickString(source, "direction");
      const direction = rawDirection === "TowardReference" ? "TowardReference" : "AwayFromReference";
      if (!faceId || !referenceEdgeId || angleDeg === undefined) {
        warnings.push(`${itemLabel}.constraints[${index}]: skipped invalid face slope constraint.`);
        continue;
      }

      constraints.push({
        kind,
        id: pickString(source, "id") ?? createId("roof_constraint"),
        faceId,
        referenceEdgeId,
        angleDeg,
        direction,
      });
      continue;
    }

    warnings.push(`${itemLabel}.constraints[${index}]: skipped unsupported constraint kind.`);
  }

  return constraints;
}

function parseRoofSketches(
  data: unknown,
  roofLayerIds: string[],
  warnings: string[],
) {
  const roofSketches: RoofSketch[] = [];
  const fallbackLayerId = roofLayerIds[0] ?? "roof_layer_default";

  for (const [index, item] of asArray(data).entries()) {
    const source = asObject(item);
    const itemLabel = `roofSketches[${index}]`;
    if (!source) {
      warnings.push(`${itemLabel}: skipped invalid roof sketch entry.`);
      continue;
    }

    const vertices: RoofVertex[] = [];
    for (const [vertexIndex, vertexValue] of asArray(source.vertices).entries()) {
      const vertexSource = asObject(vertexValue);
      if (!vertexSource) {
        warnings.push(`${itemLabel}.vertices[${vertexIndex}]: skipped invalid vertex.`);
        continue;
      }

      const position = pickVec2(vertexSource);
      if (!position) {
        warnings.push(`${itemLabel}.vertices[${vertexIndex}]: skipped vertex without coordinates.`);
        continue;
      }

      const elevationMode =
        pickParsedValue(
          vertexSource,
          (value) => {
            const parsed = roofVertexElevationModeSchema.safeParse(value);
            return parsed.success ? parsed.data : undefined;
          },
          "elevationMode",
          "elevation_mode",
        ) ?? ("Explicit" satisfies RoofVertexElevationMode);
      const elevationM = pickNumber(vertexSource, "elevationM", "elevation_m", "heightM", "height_m");
      vertices.push({
        id: pickString(vertexSource, "id") ?? createId("roof_vertex"),
        position,
        elevationMode,
        elevationM,
      });
    }

    const vertexIds = new Set(vertices.map((vertex) => vertex.id));
    const edges: RoofEdge[] = [];
    for (const [edgeIndex, edgeValue] of asArray(source.edges).entries()) {
      const edgeSource = asObject(edgeValue);
      if (!edgeSource) {
        warnings.push(`${itemLabel}.edges[${edgeIndex}]: skipped invalid edge.`);
        continue;
      }

      const startVertexId = pickString(edgeSource, "startVertexId", "start_vertex_id", "start");
      const endVertexId = pickString(edgeSource, "endVertexId", "end_vertex_id", "end");
      if (!startVertexId || !endVertexId || !vertexIds.has(startVertexId) || !vertexIds.has(endVertexId)) {
        warnings.push(`${itemLabel}.edges[${edgeIndex}]: skipped edge with invalid vertices.`);
        continue;
      }

      const role =
        pickParsedValue(
          edgeSource,
          (value) => {
            const parsed = roofEdgeRoleSchema.safeParse(value);
            return parsed.success ? parsed.data : undefined;
          },
          "role",
        ) ?? ("Generic" satisfies RoofEdgeRole);
      edges.push({
        id: pickString(edgeSource, "id") ?? createId("roof_edge"),
        startVertexId,
        endVertexId,
        role,
      });
    }

    const edgeIds = new Set(edges.map((edge) => edge.id));
    const constraints = parseRoofConstraints(source.constraints, warnings, itemLabel);
    const constraintIds = new Set(constraints.map((constraint) => constraint.id));
    const faces: RoofFaceDefinition[] = [];
    for (const [faceIndex, faceValue] of asArray(source.faces).entries()) {
      const faceSource = asObject(faceValue);
      if (!faceSource) {
        warnings.push(`${itemLabel}.faces[${faceIndex}]: skipped invalid face.`);
        continue;
      }

      const ids = asArray(faceSource.vertexIds ?? faceSource.vertex_ids)
        .map((value) => nonEmptyStringInputSchema.safeParse(value))
        .filter((parsed): parsed is z.ZodSafeParseSuccess<string> => parsed.success)
        .map((parsed) => parsed.data);
      const faceEdgeIds = asArray(faceSource.edgeIds ?? faceSource.edge_ids)
        .map((value) => nonEmptyStringInputSchema.safeParse(value))
        .filter((parsed): parsed is z.ZodSafeParseSuccess<string> => parsed.success)
        .map((parsed) => parsed.data)
        .filter((id) => edgeIds.has(id));
      const faceConstraintIds = asArray(faceSource.constraintIds ?? faceSource.constraint_ids)
        .map((value) => nonEmptyStringInputSchema.safeParse(value))
        .filter((parsed): parsed is z.ZodSafeParseSuccess<string> => parsed.success)
        .map((parsed) => parsed.data)
        .filter((id) => constraintIds.has(id));

      if (ids.length < 3 || ids.some((id) => !vertexIds.has(id))) {
        warnings.push(`${itemLabel}.faces[${faceIndex}]: skipped face with invalid vertices.`);
        continue;
      }

      const faceThicknessM = pickNumber(faceSource, "thicknessM", "thickness_m", "thickness");
      faces.push({
        id: pickString(faceSource, "id") ?? createId("roof_face"),
        vertexIds: ids,
        edgeIds: faceEdgeIds,
        constraintIds: faceConstraintIds,
        thicknessM: faceThicknessM !== undefined && faceThicknessM > 0 ? faceThicknessM : undefined,
      });
    }

    const thicknessM = pickNumber(source, "thicknessM", "thickness_m", "thickness") ?? 0.2;
    if (vertices.length < 2 || edges.length === 0 || thicknessM <= 0) {
      warnings.push(`${itemLabel}: skipped roof sketch with insufficient geometry.`);
      continue;
    }

    roofSketches.push(
      createRoofSketch({
        id: pickString(source, "id") ?? createId("roof"),
        name: pickString(source, "name") ?? `roof_${index + 1}`,
        layerId: resolveReference(
          source.layerId ?? source.layer_id ?? source.layer,
          roofLayerIds,
          fallbackLayerId,
          "roof layer",
          warnings,
          itemLabel,
        ),
        baseElevationM: pickNumber(source, "baseElevationM", "base_elevation_m", "base_elevation") ?? 0,
        thicknessM,
        vertices,
        edges,
        faces,
        constraints,
      }),
    );
  }

  return roofSketches;
}

function parseRoofOpenings(data: unknown, roofSketches: RoofSketch[], warnings: string[]) {
  const roofOpenings: RoofOpening[] = [];
  const roofSketchById = new Map(roofSketches.map((sketch) => [sketch.id, sketch] as const));

  for (const [index, item] of asArray(data).entries()) {
    const source = asObject(item);
    const itemLabel = `roofOpenings[${index}]`;
    if (!source) {
      warnings.push(`${itemLabel}: skipped invalid roof opening entry.`);
      continue;
    }

    const roofSketchId = pickString(source, "roofSketchId", "roof_sketch_id", "sketchId", "sketch_id");
    const roofFaceId = pickString(source, "roofFaceId", "roof_face_id", "faceId", "face_id");
    const roofSketch = roofSketchId ? roofSketchById.get(roofSketchId) : null;
    if (!roofSketch || !roofFaceId || !roofSketch.faces.some((face) => face.id === roofFaceId)) {
      warnings.push(`${itemLabel}: skipped opening with invalid roof face reference.`);
      continue;
    }

    const centerSource = asObject(source.center ?? source.position) ?? source;
    const center = pickVec2(centerSource);
    if (!center) {
      warnings.push(`${itemLabel}: skipped opening with invalid center.`);
      continue;
    }
    const widthM = pickNumber(source, "widthM", "width_m", "width") ?? 0.8;
    const heightM = pickNumber(source, "heightM", "height_m", "height") ?? 1.0;
    if (widthM <= 0 || heightM <= 0) {
      warnings.push(`${itemLabel}: skipped opening with invalid dimensions.`);
      continue;
    }

    const cutMode =
      pickParsedValue(
        source,
        (value) => {
          const parsed = roofOpeningCutModeSchema.safeParse(value);
          return parsed.success ? parsed.data : undefined;
        },
        "cutMode",
        "cut_mode",
      ) ?? "NormalToRoof";
    const rotationDeg =
      pickParsedValue(
        source,
        (value) => {
          const parsed = roofOpeningRotationDegSchema.safeParse(value);
          return parsed.success ? parsed.data : undefined;
        },
        "rotationDeg",
        "rotation_deg",
        "rotation",
      ) ?? 0;
    const design3DSource = asObject(source.design3D ?? source.design_3d ?? source.window3D ?? source.window_3d);
    const glassThicknessM =
      (design3DSource && pickNumber(design3DSource, "glassThicknessM", "glass_thickness_m")) ?? 0.02;
    const frameThicknessM =
      (design3DSource && pickNumber(design3DSource, "frameThicknessM", "frame_thickness_m")) ?? 0.08;
    const verticalDivisions =
      (design3DSource && pickNumber(design3DSource, "verticalDivisions", "vertical_divisions")) ?? 0;
    const horizontalDivisions =
      (design3DSource && pickNumber(design3DSource, "horizontalDivisions", "horizontal_divisions")) ?? 0;
    const frameColorHex =
      (design3DSource &&
        (normalizeHexColor(design3DSource.frameColorHex) ??
          normalizeHexColor(design3DSource.frame_color_hex))) ??
      "#c4cbd6";
    const wallDepthOffsetM =
      (design3DSource && pickNumber(design3DSource, "wallDepthOffsetM", "wall_depth_offset_m")) ?? 0;
    const design3D =
      design3DSource &&
      glassThicknessM > 0 &&
      frameThicknessM > 0 &&
      verticalDivisions >= 0 &&
      horizontalDivisions >= 0 &&
      Number.isFinite(wallDepthOffsetM)
        ? {
            glassThicknessM,
            frameThicknessM,
            verticalDivisions: Math.round(verticalDivisions),
            horizontalDivisions: Math.round(horizontalDivisions),
            wallDepthOffsetM,
            frameColorHex,
          }
        : null;

    roofOpenings.push(
      createRoofOpening({
        id: pickString(source, "id") ?? createId("roof_opening"),
        roofSketchId: roofSketch.id,
        roofFaceId,
        center,
        widthM,
        heightM,
        cutMode,
        rotationDeg,
        design3D,
      }),
    );
  }

  return roofOpenings;
}

function parseNodes(data: unknown, levelIds: string[], warnings: string[]) {
  const nodes: NodeData[] = [];
  const fallbackLevelId = levelIds[0];

  for (const [index, item] of asArray(data).entries()) {
    const tupleMatch = numericTuple2Schema.safeParse(item);
    if (tupleMatch.success) {
      const [x, y] = tupleMatch.data;
      nodes.push(
        createNodeData({
          id: createId("node"),
          levelId: fallbackLevelId,
          position: createVec2(x, y),
        }),
      );
      warnings.push(`nodes[${index}]: migrated legacy tuple node to canonical object form.`);
      continue;
    }

    const source = asObject(item);
    if (!source) {
      warnings.push(`nodes[${index}]: skipped invalid node entry.`);
      continue;
    }

    const position = pickVec2(source);
    if (!position) {
      warnings.push(`nodes[${index}]: skipped node without valid coordinates.`);
      continue;
    }

    nodes.push(
      createNodeData({
        id: pickString(source, "id") ?? createId("node"),
        levelId: resolveReference(
          source.levelId ?? source.level_id ?? source.level,
          levelIds,
          fallbackLevelId,
          "level",
          warnings,
          `nodes[${index}]`,
        ),
        position,
      }),
    );
  }

  return nodes;
}

function parseWalls(
  data: unknown,
  connections: unknown,
  levelIds: string[],
  wallTypeIds: string[],
  nodes: NodeData[],
  warnings: string[],
) {
  const walls: Wall[] = [];
  const fallbackLevelId = levelIds[0];
  const fallbackWallTypeId = wallTypeIds[0];
  const nodeIds = nodes.map((node) => node.id);

  for (const [index, item] of asArray(data).entries()) {
    const source = asObject(item);
    if (!source) {
      warnings.push(`walls[${index}]: skipped invalid wall entry.`);
      continue;
    }

    const startNodeId = resolveReference(
      source.startNodeId ?? source.start_node_id,
      nodeIds,
      "",
      "start node",
      warnings,
      `walls[${index}]`,
    );
    const endNodeId = resolveReference(
      source.endNodeId ?? source.end_node_id,
      nodeIds,
      "",
      "end node",
      warnings,
      `walls[${index}]`,
    );

    if (!startNodeId || !endNodeId || startNodeId === endNodeId) {
      warnings.push(`walls[${index}]: skipped invalid wall connection.`);
      continue;
    }

    walls.push(
      createWall({
        id: pickString(source, "id") ?? createId("wall"),
        levelId: resolveReference(
          source.levelId ?? source.level_id ?? source.level,
          levelIds,
          fallbackLevelId,
          "level",
          warnings,
          `walls[${index}]`,
        ),
        wallTypeId: resolveReference(
          source.wallTypeId ?? source.wall_type_id ?? source.wall_type,
          wallTypeIds,
          fallbackWallTypeId,
          "wall type",
          warnings,
          `walls[${index}]`,
        ),
        topMode:
          pickParsedValue(
            source,
            (value) => {
              const parsed = wallTopModeSchema.safeParse(value);
              return parsed.success ? parsed.data : undefined;
            },
            "topMode",
            "top_mode",
          ) ?? ("FixedHeight" satisfies WallTopMode),
        startNodeId,
        endNodeId,
      }),
    );
  }

  if (walls.length > 0 || asArray(connections).length === 0) {
    return walls;
  }

  for (const [index, item] of asArray(connections).entries()) {
    const tupleMatch = z.tuple([z.number().int(), z.number().int()]).safeParse(item);
    if (tupleMatch.success) {
      const [startIndex, endIndex] = tupleMatch.data;
      const startNodeId = nodeIds[startIndex];
      const endNodeId = nodeIds[endIndex];

      if (!startNodeId || !endNodeId || startNodeId === endNodeId) {
        warnings.push(`connections[${index}]: skipped invalid node indexes.`);
        continue;
      }

      walls.push(
        createWall({
          levelId: fallbackLevelId,
          wallTypeId: fallbackWallTypeId,
          topMode: "FixedHeight",
          startNodeId,
          endNodeId,
        }),
      );
      warnings.push(`connections[${index}]: migrated legacy connection to wall entity.`);
      continue;
    }

    const source = asObject(item);
    if (!source) {
      warnings.push(`connections[${index}]: skipped invalid connection entry.`);
      continue;
    }

    const nodesTuple = z.tuple([z.number().int(), z.number().int()]).safeParse(source.nodes);
    if (!nodesTuple.success) {
      warnings.push(`connections[${index}]: skipped invalid node pair.`);
      continue;
    }

    const [startIndex, endIndex] = nodesTuple.data;
    const startNodeId = nodeIds[startIndex];
    const endNodeId = nodeIds[endIndex];
    if (!startNodeId || !endNodeId || startNodeId === endNodeId) {
      warnings.push(`connections[${index}]: skipped invalid node indexes.`);
      continue;
    }

    walls.push(
      createWall({
        levelId: resolveReference(
          source.level,
          levelIds,
          fallbackLevelId,
          "level",
          warnings,
          `connections[${index}]`,
        ),
        wallTypeId: resolveReference(
          source.wall_type ?? source.wallTypeId,
          wallTypeIds,
          fallbackWallTypeId,
          "wall type",
          warnings,
          `connections[${index}]`,
        ),
        topMode:
          pickParsedValue(
            source,
            (value) => {
              const parsed = wallTopModeSchema.safeParse(value);
              return parsed.success ? parsed.data : undefined;
            },
            "topMode",
            "top_mode",
          ) ?? ("FixedHeight" satisfies WallTopMode),
        startNodeId,
        endNodeId,
      }),
    );
    warnings.push(`connections[${index}]: migrated legacy connection object to wall entity.`);
  }

  return walls;
}

function parseShapes(
  data: unknown,
  levelIds: string[],
  pixelsPerMeter: number,
  warnings: string[],
) {
  const shapes: Shape[] = [];
  const fallbackLevelId = levelIds[0];

  for (const [index, item] of asArray(data).entries()) {
    const source = asObject(item);
    if (!source) {
      warnings.push(`shapes[${index}]: skipped invalid shape entry.`);
      continue;
    }

    const pose = pickPose2D(source);
    if (!pose) {
      warnings.push(`shapes[${index}]: skipped shape without valid pose.`);
      continue;
    }

    const kind =
      pickParsedValue(
        source,
        (value) => {
          const parsed = shapeKindSchema.safeParse(value);
          return parsed.success ? parsed.data : undefined;
        },
        "kind",
        "type",
      ) ?? ("Square" satisfies ShapeKind);
    const zStartM = pickNumber(source, "zStartM", "z_start_m", "z_start") ?? 0;
    const zEnd = pickNumber(source, "z_end");
    const heightM =
      pickNumber(source, "heightM", "height_m") ??
      (zEnd !== undefined ? zEnd - zStartM : undefined) ??
      2;
    const sizeM =
      pickNumber(source, "sizeM", "size_m") ??
      ((pickNumber(source, "size") ?? 0) > 0
        ? (pickNumber(source, "size") ?? 0) / pixelsPerMeter
        : undefined) ??
      0.5;

    if (heightM <= 0 || sizeM <= 0) {
      warnings.push(`shapes[${index}]: skipped shape with non-positive dimensions.`);
      continue;
    }

    shapes.push(
      createShape({
        id: pickString(source, "id") ?? createId("shape"),
        levelId: resolveReference(
          source.levelId ?? source.level_id ?? source.level,
          levelIds,
          fallbackLevelId,
          "level",
          warnings,
          `shapes[${index}]`,
        ),
        name: pickString(source, "name") ?? `shape_${index + 1}`,
        kind,
        pose,
        sizeM,
        zStartM,
        heightM,
      }),
    );
  }

  return shapes;
}

function parseSlabs(data: unknown, levelIds: string[], warnings: string[]) {
  const slabs: Slab[] = [];
  const fallbackLevelId = levelIds[0];

  for (const [index, item] of asArray(data).entries()) {
    const source = asObject(item);
    if (!source) {
      warnings.push(`slabs[${index}]: skipped invalid slab entry.`);
      continue;
    }

    const pose = pickPose2D(source);
    if (!pose) {
      warnings.push(`slabs[${index}]: skipped slab without valid pose.`);
      continue;
    }

    const kind =
      pickParsedValue(
        source,
        (value) => {
          const parsed = slabKindSchema.safeParse(value);
          return parsed.success ? parsed.data : undefined;
        },
        "kind",
        "shape",
      ) ?? ("Rectangle" satisfies SlabKind);
    const roofType =
      pickParsedValue(
        source,
        (value) => {
          const parsed = roofTypeSchema.safeParse(value);
          return parsed.success ? parsed.data : undefined;
        },
        "roofType",
        "roof_type",
      ) ?? ("Flat" satisfies RoofType);
    const widthM = pickNumber(source, "widthM", "width_m", "width") ?? 1;
    const depthM = pickNumber(source, "depthM", "depth_m", "depth") ?? 1;
    const thicknessM = pickNumber(source, "thicknessM", "thickness_m", "thickness") ?? 0.2;
    const roofRiseM = pickNumber(source, "roofRiseM", "roof_rise_m", "roof_rise") ?? 1.2;
    const zOffsetM = pickNumber(source, "zOffsetM", "z_offset_m", "z_offset") ?? 0;

    if (widthM <= 0 || depthM <= 0 || thicknessM <= 0 || roofRiseM < 0) {
      warnings.push(`slabs[${index}]: skipped slab with non-positive dimensions.`);
      continue;
    }

    slabs.push(
      createSlab({
        id: pickString(source, "id") ?? createId("slab"),
        levelId: resolveReference(
          source.levelId ?? source.level_id ?? source.level,
          levelIds,
          fallbackLevelId,
          "level",
          warnings,
          `slabs[${index}]`,
        ),
        name: pickString(source, "name") ?? `slab_${index + 1}`,
        kind,
        roofType: kind === "Circle" ? "Flat" : roofType,
        pose,
        widthM,
        depthM,
        thicknessM,
        roofRiseM,
        zOffsetM,
      }),
    );
  }

  return slabs;
}

function parseExternalModels(data: unknown, levelIds: string[], warnings: string[]) {
  const externalModels: ExternalModel[] = [];
  const fallbackLevelId = levelIds[0];

  for (const [index, item] of asArray(data).entries()) {
    const source = asObject(item);
    if (!source) {
      warnings.push(`externalModels[${index}]: skipped invalid external model entry.`);
      continue;
    }

    const poseTuple = numericTuple6Schema.safeParse(source.pose);
    const position =
      pickVec2(source) ??
      (poseTuple.success ? createVec2(poseTuple.data[0], poseTuple.data[1]) : undefined);

    if (!position) {
      warnings.push(`externalModels[${index}]: skipped model without valid position.`);
      continue;
    }

    const zM = pickNumber(source, "zM", "z_m") ?? (poseTuple.success ? poseTuple.data[2] : 0);
    const rollRad =
      pickNumber(source, "rollRad", "roll_rad") ?? (poseTuple.success ? poseTuple.data[3] : 0);
    const pitchRad =
      pickNumber(source, "pitchRad", "pitch_rad") ?? (poseTuple.success ? poseTuple.data[4] : 0);
    const yawRad =
      pickNumber(source, "yawRad", "yaw_rad") ?? (poseTuple.success ? poseTuple.data[5] : 0);

    externalModels.push(
      createExternalModel({
        id: pickString(source, "id") ?? createId("model"),
        levelId: resolveReference(
          source.levelId ?? source.level_id ?? source.level,
          levelIds,
          fallbackLevelId,
          "level",
          warnings,
          `externalModels[${index}]`,
        ),
        name: pickString(source, "name") ?? `model_${index + 1}`,
        uri: pickString(source, "uri") ?? "model://unknown",
        position,
        zM,
        rollRad,
        pitchRad,
        yawRad,
      }),
    );
  }

  return externalModels;
}

function parseDoors(data: unknown, wallIds: string[], warnings: string[]) {
  const doors: DoorOpening[] = [];

  for (const [index, item] of asArray(data).entries()) {
    const source = asObject(item);
    if (!source) {
      warnings.push(`doors[${index}]: skipped invalid door entry.`);
      continue;
    }

    const wallIdCandidate = pickString(source, "wallId", "wall_id", "wall");
    const wallIndexCandidate = z.number().int().safeParse(source.wallId ?? source.wall_id ?? source.wall);
    const wallId =
      (wallIdCandidate && wallIds.includes(wallIdCandidate)
        ? wallIdCandidate
        : undefined) ??
      (wallIndexCandidate.success &&
      wallIndexCandidate.data >= 0 &&
      wallIndexCandidate.data < wallIds.length
        ? wallIds[wallIndexCandidate.data]
        : undefined);

    if (!wallId) {
      warnings.push(`doors[${index}]: skipped door without valid host wall.`);
      continue;
    }

    const widthM = pickNumber(source, "widthM", "width_m", "width") ?? 0.9;
    const heightM = pickNumber(source, "heightM", "height_m", "height") ?? 2.1;
    const offsetM = pickNumber(source, "offsetM", "offset_m", "offset") ?? 0;
    const design3DSource = asObject(source.design3D ?? source.design_3d ?? source.door3D ?? source.door_3d);
    const kind =
      (design3DSource && pickParsedValue(design3DSource, (value) => {
        const parsed = z.enum(["Normal", "Garage"]).safeParse(value);
        return parsed.success ? parsed.data : undefined;
      }, "kind")) ?? "Normal";
    const frameThicknessM =
      (design3DSource && pickNumber(design3DSource, "frameThicknessM", "frame_thickness_m")) ?? 0.08;
    const frameColorHex =
      (design3DSource &&
        (normalizeHexColor(design3DSource.frameColorHex) ??
          normalizeHexColor(design3DSource.frame_color_hex))) ??
      "#c4cbd6";
    const doorColorHex =
      (design3DSource &&
        (normalizeHexColor(design3DSource.doorColorHex) ??
          normalizeHexColor(design3DSource.door_color_hex))) ??
      "#8a5b3d";
    const wallDepthOffsetM =
      (design3DSource && pickNumber(design3DSource, "wallDepthOffsetM", "wall_depth_offset_m")) ?? 0;
    const openState =
      (design3DSource && pickParsedValue(design3DSource, (value) => {
        const parsed = z.enum(["Closed", "Open"]).safeParse(value);
        return parsed.success ? parsed.data : undefined;
      }, "openState", "open_state")) ?? "Closed";
    const hingeSide =
      (design3DSource && pickParsedValue(design3DSource, (value) => {
        const parsed = z.enum(["Left", "Right"]).safeParse(value);
        return parsed.success ? parsed.data : undefined;
      }, "hingeSide", "hinge_side")) ?? "Left";
    const swingDirection =
      (design3DSource && pickParsedValue(design3DSource, (value) => {
        const parsed = z.enum(["Inward", "Outward"]).safeParse(value);
        return parsed.success ? parsed.data : undefined;
      }, "swingDirection", "swing_direction")) ?? "Inward";

    if (widthM <= 0 || heightM <= 0 || offsetM < 0) {
      warnings.push(`doors[${index}]: skipped door with invalid dimensions.`);
      continue;
    }

    const design3D =
      design3DSource && frameThicknessM > 0 && Number.isFinite(wallDepthOffsetM)
        ? {
            kind,
            frameThicknessM,
            frameColorHex,
            doorColorHex,
            wallDepthOffsetM,
            openState,
            hingeSide,
            swingDirection,
          }
        : null;

    doors.push(
      createDoorOpening({
        id: pickString(source, "id") ?? createId("door"),
        wallId,
        widthM,
        heightM,
        offsetM,
        design3D,
      }),
    );
  }

  return doors;
}

function parseWindows(
  data: unknown,
  walls: Project["walls"],
  wallTypes: Project["wallTypes"],
  warnings: string[],
) {
  const windows: WindowOpening[] = [];
  const wallIds = walls.map((wall) => wall.id);
  const wallById = new Map(walls.map((wall) => [wall.id, wall]));
  const wallTypeById = new Map(wallTypes.map((wallType) => [wallType.id, wallType]));

  for (const [index, item] of asArray(data).entries()) {
    const source = asObject(item);
    if (!source) {
      warnings.push(`windows[${index}]: skipped invalid window entry.`);
      continue;
    }

    const wallIdCandidate = pickString(source, "wallId", "wall_id", "wall");
    const wallIndexCandidate = z.number().int().safeParse(source.wallId ?? source.wall_id ?? source.wall);
    const wallId =
      (wallIdCandidate && wallIds.includes(wallIdCandidate) ? wallIdCandidate : undefined) ??
      (wallIndexCandidate.success &&
      wallIndexCandidate.data >= 0 &&
      wallIndexCandidate.data < wallIds.length
        ? wallIds[wallIndexCandidate.data]
        : undefined);

    if (!wallId) {
      warnings.push(`windows[${index}]: skipped window without valid host wall.`);
      continue;
    }

    const widthM = pickNumber(source, "widthM", "width_m", "width") ?? 1.2;
    const heightM = pickNumber(source, "heightM", "height_m", "height") ?? 1.2;
    const sillHeightM = pickNumber(source, "sillHeightM", "sill_height_m", "sillHeight", "sill_height") ?? 0.9;
    const offsetM = pickNumber(source, "offsetM", "offset_m", "offset") ?? 0;
    const design3DSource = asObject(source.design3D ?? source.design_3d ?? source.window3D ?? source.window_3d);
    const glassThicknessM =
      (design3DSource && pickNumber(design3DSource, "glassThicknessM", "glass_thickness_m")) ?? 0.02;
    const frameThicknessM =
      (design3DSource && pickNumber(design3DSource, "frameThicknessM", "frame_thickness_m")) ?? 0.08;
    const verticalDivisions =
      (design3DSource && pickNumber(design3DSource, "verticalDivisions", "vertical_divisions")) ?? 0;
    const horizontalDivisions =
      (design3DSource && pickNumber(design3DSource, "horizontalDivisions", "horizontal_divisions")) ?? 0;
    const frameColorHex =
      (design3DSource &&
        (normalizeHexColor(design3DSource.frameColorHex) ??
          normalizeHexColor(design3DSource.frame_color_hex))) ??
      "#c4cbd6";
    const wallDepthOffsetMDirect =
      design3DSource &&
      pickNumber(design3DSource, "wallDepthOffsetM", "wall_depth_offset_m");
    const legacyWallDepthPosition =
      design3DSource &&
      pickNumber(design3DSource, "wallDepthPosition", "wall_depth_position");
    const hostWall = wallById.get(wallId);
    const hostWallThicknessM =
      (hostWall && wallTypeById.get(hostWall.wallTypeId)?.thicknessM) ?? null;
    const legacyMaxOffsetM =
      hostWallThicknessM !== null
        ? Math.max((hostWallThicknessM - glassThicknessM) / 2, 0)
        : null;
    const wallDepthOffsetM =
      wallDepthOffsetMDirect ??
      (legacyWallDepthPosition !== undefined &&
      legacyWallDepthPosition !== null &&
      legacyWallDepthPosition >= 0 &&
      legacyWallDepthPosition <= 1 &&
      legacyMaxOffsetM !== null
        ? (legacyWallDepthPosition * 2 - 1) * legacyMaxOffsetM
        : 0);

    if (widthM <= 0 || heightM <= 0 || sillHeightM < 0 || offsetM < 0) {
      warnings.push(`windows[${index}]: skipped window with invalid dimensions.`);
      continue;
    }

    const design3D =
      design3DSource &&
      glassThicknessM > 0 &&
      frameThicknessM > 0 &&
      verticalDivisions >= 0 &&
      horizontalDivisions >= 0 &&
      Number.isFinite(wallDepthOffsetM)
        ? {
            glassThicknessM,
            frameThicknessM,
            verticalDivisions: Math.round(verticalDivisions),
            horizontalDivisions: Math.round(horizontalDivisions),
            wallDepthOffsetM,
            frameColorHex,
          }
        : null;

    windows.push(
      createWindowOpening({
        id: pickString(source, "id") ?? createId("window"),
        wallId,
        widthM,
        heightM,
        sillHeightM,
        offsetM,
        design3D,
      }),
    );
  }

  return windows;
}

function parseStairs(data: unknown, levelIds: string[], warnings: string[]) {
  const stairs: Stair[] = [];
  const fallbackLevelId = levelIds[0];

  for (const [index, item] of asArray(data).entries()) {
    const source = asObject(item);
    if (!source) {
      warnings.push(`stairs[${index}]: skipped invalid stair entry.`);
      continue;
    }

    const pathNodes = asArray(source.pathNodes ?? source.path_nodes)
      .map((nodeValue) => {
        const tupleMatch = numericTuple2Schema.safeParse(nodeValue);
        if (tupleMatch.success) {
          return createVec2(tupleMatch.data[0], tupleMatch.data[1]);
        }

        const nodeObject = asObject(nodeValue);
        return nodeObject ? pickVec2(nodeObject) : undefined;
      })
      .filter((node): node is ReturnType<typeof createVec2> => node !== undefined);

    if (pathNodes.length < 2) {
      warnings.push(`stairs[${index}]: skipped stair without at least two path nodes.`);
      continue;
    }

    const widthM = pickNumber(source, "widthM", "width_m", "width") ?? 1.1;
    const endElevationM = pickNumber(source, "endElevationM", "end_elevation_m", "end_elevation") ?? 3;
    const riserHeightM = pickNumber(source, "riserHeightM", "riser_height_m", "riser_height") ?? 0.17;
    const treadDepthM = pickNumber(source, "treadDepthM", "tread_depth_m", "tread_depth") ?? 0.28;
    const landingLengthM =
      pickNumber(source, "landingLengthM", "landing_length_m", "landing_length") ?? 1.2;

    if (
      widthM <= 0 ||
      !Number.isFinite(endElevationM) ||
      riserHeightM <= 0 ||
      treadDepthM <= 0 ||
      landingLengthM < 0
    ) {
      warnings.push(`stairs[${index}]: skipped stair with invalid dimensions.`);
      continue;
    }

    stairs.push(
      createStair({
        id: pickString(source, "id") ?? createId("stair"),
        levelId: resolveReference(
          source.levelId ?? source.level_id ?? source.level,
          levelIds,
          fallbackLevelId,
          "level",
          warnings,
          `stairs[${index}]`,
        ),
        name: pickString(source, "name") ?? `stairs_${index + 1}`,
        pathNodes,
        widthM,
        endElevationM,
        riserHeightM,
        treadDepthM,
        landingLengthM,
      }),
    );
  }

  return stairs;
}

function parseMeasurements(data: unknown, levelIds: string[], warnings: string[]) {
  const measurements: Measurement[] = [];
  const fallbackLevelId = levelIds[0];

  for (const [index, item] of asArray(data).entries()) {
    const source = asObject(item);
    if (!source) {
      warnings.push(`measurements[${index}]: skipped invalid measurement entry.`);
      continue;
    }

    const start =
      pickVec2(asObject(source.start) ?? source) ??
      (numericTuple2Schema.safeParse(source.start).success
        ? createVec2(
            numericTuple2Schema.parse(source.start)[0],
            numericTuple2Schema.parse(source.start)[1],
          )
        : undefined);
    const end =
      pickVec2(asObject(source.end) ?? source) ??
      (numericTuple2Schema.safeParse(source.end).success
        ? createVec2(
            numericTuple2Schema.parse(source.end)[0],
            numericTuple2Schema.parse(source.end)[1],
          )
        : undefined);

    if (!start || !end) {
      warnings.push(`measurements[${index}]: skipped measurement without valid endpoints.`);
      continue;
    }

    if (Math.hypot(end.x - start.x, end.y - start.y) < 0.0001) {
      warnings.push(`measurements[${index}]: skipped zero-length measurement.`);
      continue;
    }

    const rawUnit = pickString(source, "unit");
    const unit = rawUnit === "cm" || rawUnit === "dm" || rawUnit === "m" ? rawUnit : "m";

    measurements.push(
      createMeasurement({
        id: pickString(source, "id") ?? createId("measure"),
        levelId: resolveReference(
          source.levelId ?? source.level_id ?? source.level,
          levelIds,
          fallbackLevelId,
          "level",
          warnings,
          `measurements[${index}]`,
        ),
        start,
        end,
        unit,
      }),
    );
  }

  return measurements;
}

function repairProject(project: Project, warnings: string[]) {
  const levelIds = new Set(project.levels.map((level) => level.id));
  const wallTypeIds = new Set(project.wallTypes.map((wallType) => wallType.id));
  const roofLayerIds = new Set(project.roofLayers.map((roofLayer) => roofLayer.id));

  project.roofSketches = project.roofSketches.filter((sketch) => {
    const vertexIds = new Set(sketch.vertices.map((vertex) => vertex.id));
    const edgeIds = new Set(sketch.edges.map((edge) => edge.id));
    const constraintIds = new Set(sketch.constraints.map((constraint) => constraint.id));
    const hasValidLayer = roofLayerIds.has(sketch.layerId);
    const hasValidDimensions = sketch.thicknessM > 0 && Number.isFinite(sketch.baseElevationM);
    const hasValidEdges = sketch.edges.every(
      (edge) =>
        vertexIds.has(edge.startVertexId) &&
        vertexIds.has(edge.endVertexId) &&
        edge.startVertexId !== edge.endVertexId,
    );
    const hasValidConstraints = sketch.constraints.every((constraint) => {
      if (constraint.kind === "VertexHeight") {
        return vertexIds.has(constraint.vertexId);
      }
      if (constraint.kind === "EdgeHeight") {
        return edgeIds.has(constraint.edgeId);
      }
      return (
        edgeIds.has(constraint.referenceEdgeId) &&
        sketch.faces.some((face) => face.id === constraint.faceId)
      );
    });
    const hasValidFaces = sketch.faces.every(
      (face) =>
        face.vertexIds.length >= 3 &&
        face.vertexIds.every((vertexId) => vertexIds.has(vertexId)) &&
        face.edgeIds.every((edgeId) => edgeIds.has(edgeId)) &&
        face.constraintIds.every((constraintId) => constraintIds.has(constraintId)) &&
        (face.thicknessM === undefined || face.thicknessM > 0),
    );

    const isValid =
      hasValidLayer &&
      hasValidDimensions &&
      sketch.vertices.length >= 2 &&
      sketch.edges.length > 0 &&
      hasValidEdges &&
      hasValidConstraints &&
      hasValidFaces;

    if (!isValid) {
      warnings.push(`roofSketches: dropped roof sketch "${sketch.id}" with invalid data.`);
    }

    return isValid;
  });
  const roofSketchById = new Map(project.roofSketches.map((sketch) => [sketch.id, sketch] as const));
  project.roofOpenings = (project.roofOpenings ?? [])
    .map((opening) =>
      createRoofOpening({
        ...opening,
        center: { ...opening.center },
        rotationDeg: opening.rotationDeg ?? 0,
      }),
    )
    .filter((opening) => {
      const roofSketch = roofSketchById.get(opening.roofSketchId);
      const isValid =
        roofSketch !== undefined &&
        roofSketch.faces.some((face) => face.id === opening.roofFaceId) &&
        Number.isFinite(opening.center.x) &&
        Number.isFinite(opening.center.y) &&
        opening.widthM > 0 &&
        opening.heightM > 0 &&
        (opening.rotationDeg === 0 || opening.rotationDeg === 90);

      if (!isValid) {
        warnings.push(`roofOpenings: dropped roof opening "${opening.id}" with invalid data.`);
      }

      return isValid;
    });

  project.nodes = project.nodes.filter((node) => levelIds.has(node.levelId));
  const nodeIds = new Set(project.nodes.map((node) => node.id));

  project.walls = project.walls.filter((wall) => {
    const isValid =
      levelIds.has(wall.levelId) &&
      wallTypeIds.has(wall.wallTypeId) &&
      nodeIds.has(wall.startNodeId) &&
      nodeIds.has(wall.endNodeId) &&
      wall.startNodeId !== wall.endNodeId;

    if (!isValid) {
      warnings.push(`walls: dropped wall "${wall.id}" with dangling references.`);
    }

    return isValid;
  });

  const wallIds = new Set(project.walls.map((wall) => wall.id));
  const wallTypeById = new Map(project.wallTypes.map((wallType) => [wallType.id, wallType] as const));
  project.doors = project.doors.filter((door) => {
    const wall = project.walls.find((candidate) => candidate.id === door.wallId);
    if (!wall || !wallIds.has(door.wallId) || door.widthM <= 0 || door.heightM <= 0 || door.offsetM < 0) {
      warnings.push(`doors: dropped door "${door.id}" with invalid host wall or dimensions.`);
      return false;
    }

    const wallType = wallTypeById.get(wall.wallTypeId);
    const startNode = project.nodes.find((node) => node.id === wall.startNodeId);
    const endNode = project.nodes.find((node) => node.id === wall.endNodeId);
    if (!wallType || !startNode || !endNode) {
      warnings.push(`doors: dropped door "${door.id}" because its host wall is incomplete.`);
      return false;
    }

    const wallLengthM = Math.hypot(
      endNode.position.x - startNode.position.x,
      endNode.position.y - startNode.position.y,
    );
    const halfWidthM = door.widthM / 2;
    const fitsWall = halfWidthM <= door.offsetM && door.offsetM <= wallLengthM - halfWidthM;
    const fitsHeight = door.heightM <= wallType.heightM + 0.0001;
    if (!fitsWall || !fitsHeight) {
      warnings.push(`doors: dropped door "${door.id}" because it no longer fits its host wall.`);
      return false;
    }

    return true;
  });

  project.windows = project.windows.filter((windowOpening) => {
    const wall = project.walls.find((candidate) => candidate.id === windowOpening.wallId);
    if (
      !wall ||
      !wallIds.has(windowOpening.wallId) ||
      windowOpening.widthM <= 0 ||
      windowOpening.heightM <= 0 ||
      windowOpening.sillHeightM < 0 ||
      windowOpening.offsetM < 0
    ) {
      warnings.push(
        `windows: dropped window "${windowOpening.id}" with invalid host wall or dimensions.`,
      );
      return false;
    }

    const wallType = wallTypeById.get(wall.wallTypeId);
    const startNode = project.nodes.find((node) => node.id === wall.startNodeId);
    const endNode = project.nodes.find((node) => node.id === wall.endNodeId);
    if (!wallType || !startNode || !endNode) {
      warnings.push(
        `windows: dropped window "${windowOpening.id}" because its host wall is incomplete.`,
      );
      return false;
    }

    const wallLengthM = Math.hypot(
      endNode.position.x - startNode.position.x,
      endNode.position.y - startNode.position.y,
    );
    const halfWidthM = windowOpening.widthM / 2;
    const fitsWall =
      halfWidthM <= windowOpening.offsetM &&
      windowOpening.offsetM <= wallLengthM - halfWidthM;
    const fitsHeight =
      windowOpening.sillHeightM + windowOpening.heightM <= wallType.heightM + 0.0001;
    if (!fitsWall || !fitsHeight) {
      warnings.push(
        `windows: dropped window "${windowOpening.id}" because it no longer fits its host wall.`,
      );
      return false;
    }

    return true;
  });

  project.stairs = project.stairs.filter((stair) => {
    const level = project.levels.find((candidate) => candidate.id === stair.levelId);
    const hasValidSegments =
      stair.pathNodes.length >= 2 &&
      stair.pathNodes.every(
        (node, index, nodes) =>
          Number.isFinite(node.x) &&
          Number.isFinite(node.y) &&
          (index === 0 ||
            Math.hypot(node.x - nodes[index - 1].x, node.y - nodes[index - 1].y) > 0.0001),
      );
    const isValid =
      !!level &&
      hasValidSegments &&
      stair.widthM > 0 &&
      stair.riserHeightM > 0 &&
      stair.treadDepthM > 0 &&
      stair.landingLengthM >= 0 &&
      Math.abs(stair.endElevationM - level.elevationM) > 0.0001;

    if (!isValid) {
      warnings.push(`stairs: dropped stair "${stair.id}" with invalid data.`);
    }

    return isValid;
  });

  project.shapes = project.shapes.filter((shape) => {
    const isValid = levelIds.has(shape.levelId) && shape.sizeM > 0 && shape.heightM > 0;
    if (!isValid) {
      warnings.push(`shapes: dropped shape "${shape.id}" with invalid data.`);
    }

    return isValid;
  });

  project.slabs = project.slabs.filter((slab) => {
    const isValid =
      levelIds.has(slab.levelId) &&
      slab.widthM > 0 &&
      slab.depthM > 0 &&
      slab.thicknessM > 0 &&
      slab.roofRiseM >= 0 &&
      (slab.kind === "Rectangle" || slab.roofType === "Flat");
    if (!isValid) {
      warnings.push(`slabs: dropped slab "${slab.id}" with invalid data.`);
    }

    return isValid;
  });

  project.externalModels = project.externalModels.filter((model) => {
    const isValid = levelIds.has(model.levelId) && model.uri.trim().length > 0;
    if (!isValid) {
      warnings.push(`externalModels: dropped model "${model.id}" with invalid data.`);
    }

    return isValid;
  });

  project.measurements = project.measurements.filter((measurement) => {
    const isValid =
      levelIds.has(measurement.levelId) &&
      Math.hypot(
        measurement.end.x - measurement.start.x,
        measurement.end.y - measurement.start.y,
      ) >= 0.0001;
    if (!isValid) {
      warnings.push(`measurements: dropped measurement "${measurement.id}" with invalid data.`);
    }

    return isValid;
  });
}

export function validateProject(project: Project) {
  return projectSchema.safeParse(project);
}

export function parseProjectData(data: unknown): ProjectParseResult {
  const warnings: string[] = [];
  const root = asObject(data);

  if (!root) {
    throw new ProjectParseError("Project payload must be a JSON object.");
  }

  const settings = parseSettings(root.settings, warnings);
  const levels = parseLevels(root.levels, warnings);
  const wallTypes = parseWallTypes(root.wallTypes ?? root.wall_types, root.settings, warnings);
  const roofLayers = parseRoofLayers(root.roofLayers ?? root.roof_layers, warnings);
  const projectBase = ensureProjectDefaults({
    projectName: pickString(root, "projectName", "project_name", "name") ?? "WaWoD Studio",
    settings,
    levels,
    wallTypes,
    roofLayers,
    roofSketches: [],
    roofOpenings: [],
    nodes: [],
    walls: [],
    doors: [],
    windows: [],
    stairs: [],
    shapes: [],
    slabs: [],
    externalModels: [],
    measurements: [],
  });

  ensureUniqueIds(projectBase.levels, "level", "levels", warnings);
  ensureUniqueIds(projectBase.wallTypes, "wall_type", "wallTypes", warnings);
  ensureUniqueIds(projectBase.roofLayers, "roof_layer", "roofLayers", warnings);

  const levelIds = projectBase.levels.map((level) => level.id);
  const wallTypeIds = projectBase.wallTypes.map((wallType) => wallType.id);
  const roofLayerIds = projectBase.roofLayers.map((roofLayer) => roofLayer.id);

  projectBase.roofSketches = parseRoofSketches(
    root.roofSketches ?? root.roof_sketches,
    roofLayerIds,
    warnings,
  );
  projectBase.roofOpenings = parseRoofOpenings(
    root.roofOpenings ?? root.roof_openings,
    projectBase.roofSketches,
    warnings,
  );
  projectBase.nodes = parseNodes(root.nodes, levelIds, warnings);
  ensureUniqueIds(projectBase.nodes, "node", "nodes", warnings);

  projectBase.walls = parseWalls(
    root.walls,
    root.connections,
    levelIds,
    wallTypeIds,
    projectBase.nodes,
    warnings,
  );
  const wallIds = projectBase.walls.map((wall) => wall.id);
  projectBase.doors = parseDoors(root.doors, wallIds, warnings);
  projectBase.windows = parseWindows(root.windows, projectBase.walls, projectBase.wallTypes, warnings);
  projectBase.stairs = parseStairs(root.stairs, levelIds, warnings);
  projectBase.shapes = parseShapes(root.shapes, levelIds, settings.pixelsPerMeter, warnings);
  projectBase.slabs = parseSlabs(root.slabs, levelIds, warnings);
  projectBase.externalModels = parseExternalModels(
    root.externalModels ?? root.external_models,
    levelIds,
    warnings,
  );
  projectBase.measurements = parseMeasurements(
    root.measurements ?? root.dimensions ?? root.dimensionLines,
    levelIds,
    warnings,
  );

  ensureUniqueIds(projectBase.walls, "wall", "walls", warnings);
  ensureUniqueIds(projectBase.doors, "door", "doors", warnings);
  ensureUniqueIds(projectBase.windows, "window", "windows", warnings);
  ensureUniqueIds(projectBase.stairs, "stair", "stairs", warnings);
  ensureUniqueIds(projectBase.shapes, "shape", "shapes", warnings);
  ensureUniqueIds(projectBase.slabs, "slab", "slabs", warnings);
  ensureUniqueIds(projectBase.roofSketches, "roof", "roofSketches", warnings);
  ensureUniqueIds(projectBase.roofOpenings, "roof_opening", "roofOpenings", warnings);
  ensureUniqueIds(projectBase.externalModels, "model", "externalModels", warnings);
  ensureUniqueIds(projectBase.measurements, "measure", "measurements", warnings);

  repairProject(projectBase, warnings);

  const validation = projectSchema.safeParse(projectBase);
  if (!validation.success) {
    throw new ProjectParseError(
      "Project validation failed after migration.",
      validation.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }

  return {
    project: validation.data,
    warnings,
  };
}

export function parseProjectJson(source: string) {
  let data: unknown;

  try {
    data = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error.";
    throw new ProjectParseError(`Project JSON is invalid: ${message}`);
  }

  return parseProjectData(data);
}

export function serializeProject(project: Project) {
  const validation = projectSchema.safeParse(project);
  if (!validation.success) {
    throw new ProjectParseError(
      "Project cannot be serialized because it is invalid.",
      validation.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }

  return validation.data;
}

export function cloneProject(project: Project) {
  return serializeProject(project);
}

export function stringifyProject(project: Project) {
  return JSON.stringify(serializeProject(project), null, 2);
}

export async function readProjectFile(file: File) {
  return parseProjectJson(await file.text());
}

export function createProjectFileBlob(project: Project) {
  return new Blob([stringifyProject(project)], { type: "application/vnd.wawod.project+json" });
}
