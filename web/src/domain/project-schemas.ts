import { z } from "zod";
import type {
  DoorOpening,
  ExternalModel,
  Level,
  Measurement,
  MeasurementUnit,
  NodeData,
  Pose2D,
  Project,
  ProjectSettings,
  RoofConstraint,
  RoofEdge,
  RoofEdgeRole,
  RoofFaceDefinition,
  RoofLayer,
  RoofOpening,
  RoofOpeningCutMode,
  RoofSketch,
  RoofType,
  RoofVertex,
  RoofVertexElevationMode,
  Shape,
  ShapeKind,
  Slab,
  SlabKind,
  Stair,
  Vec2,
  Wall,
  WallTopMode,
  WallType,
  WindowOpening,
} from "./project-model";

const finiteNumberSchema = z.number().finite();
const nonNegativeNumberSchema = finiteNumberSchema.nonnegative();
const positiveNumberSchema = finiteNumberSchema.positive();
const nonEmptyStringSchema = z.string().trim().min(1);

export const shapeKindSchema = z.enum(["Square", "Cylinder"]) satisfies z.ZodType<ShapeKind>;
export const slabKindSchema = z.enum(["Rectangle", "Circle"]) satisfies z.ZodType<SlabKind>;
export const roofTypeSchema = z.enum(["Flat", "Gable", "Shed", "Hip"]) satisfies z.ZodType<RoofType>;
export const wallTopModeSchema = z.enum(["FixedHeight", "FollowRoof"]) satisfies z.ZodType<WallTopMode>;
export const measurementUnitSchema = z.enum(["cm", "dm", "m"]) satisfies z.ZodType<MeasurementUnit>;
export const roofVertexElevationModeSchema = z.enum(["Explicit", "Computed"]) satisfies z.ZodType<RoofVertexElevationMode>;
export const roofEdgeRoleSchema = z.enum(["Generic", "LowerEave", "UpperEave", "Ridge", "Hip", "Valley"]) satisfies z.ZodType<RoofEdgeRole>;
export const roofOpeningCutModeSchema = z.enum(["NormalToRoof", "Vertical"]) satisfies z.ZodType<RoofOpeningCutMode>;
export const doorDesign3DKindSchema = z.enum(["Normal", "Garage"]);
export const door3DOpenStateSchema = z.enum(["Closed", "Open"]);
export const door3DHingeSideSchema = z.enum(["Left", "Right"]);
export const door3DSwingDirectionSchema = z.enum(["Inward", "Outward"]);

export const vec2Schema = z.object({
  x: finiteNumberSchema,
  y: finiteNumberSchema,
}) satisfies z.ZodType<Vec2>;

export const pose2DSchema = z.object({
  position: vec2Schema,
  yawDeg: finiteNumberSchema,
}) satisfies z.ZodType<Pose2D>;

export const projectSettingsSchema = z.object({
  gridSpacingM: positiveNumberSchema,
  nodeRadiusPx: nonNegativeNumberSchema,
  lineWidthPx: nonNegativeNumberSchema,
  gridLineWidthPx: nonNegativeNumberSchema,
  axisLineWidthPx: nonNegativeNumberSchema,
  pixelsPerMeter: positiveNumberSchema,
  snapToGrid: z.boolean(),
}) satisfies z.ZodType<ProjectSettings>;

export const levelSchema = z.object({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  elevationM: finiteNumberSchema,
}) satisfies z.ZodType<Level>;

export const wallTypeSchema = z.object({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  thicknessM: positiveNumberSchema,
  heightM: positiveNumberSchema,
}) satisfies z.ZodType<WallType>;

export const roofLayerSchema = z.object({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  visible2D: z.boolean(),
  visible3D: z.boolean(),
}) satisfies z.ZodType<RoofLayer>;

export const roofVertexSchema = z.object({
  id: nonEmptyStringSchema,
  position: vec2Schema,
  elevationMode: roofVertexElevationModeSchema,
  elevationM: finiteNumberSchema.optional(),
}) satisfies z.ZodType<RoofVertex>;

export const roofEdgeSchema = z.object({
  id: nonEmptyStringSchema,
  startVertexId: nonEmptyStringSchema,
  endVertexId: nonEmptyStringSchema,
  role: roofEdgeRoleSchema,
}) satisfies z.ZodType<RoofEdge>;

export const roofConstraintSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("VertexHeight"),
    id: nonEmptyStringSchema,
    vertexId: nonEmptyStringSchema,
    elevationM: finiteNumberSchema,
  }),
  z.object({
    kind: z.literal("EdgeHeight"),
    id: nonEmptyStringSchema,
    edgeId: nonEmptyStringSchema,
    elevationM: finiteNumberSchema,
  }),
  z.object({
    kind: z.literal("FaceSlope"),
    id: nonEmptyStringSchema,
    faceId: nonEmptyStringSchema,
    angleDeg: finiteNumberSchema,
    referenceEdgeId: nonEmptyStringSchema,
    direction: z.enum(["AwayFromReference", "TowardReference"]),
  }),
]) satisfies z.ZodType<RoofConstraint>;

export const roofFaceDefinitionSchema = z.object({
  id: nonEmptyStringSchema,
  vertexIds: z.array(nonEmptyStringSchema).min(3),
  edgeIds: z.array(nonEmptyStringSchema),
  constraintIds: z.array(nonEmptyStringSchema),
  thicknessM: positiveNumberSchema.optional(),
}) satisfies z.ZodType<RoofFaceDefinition>;

export const roofSketchSchema = z.object({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  layerId: nonEmptyStringSchema,
  baseElevationM: finiteNumberSchema,
  thicknessM: positiveNumberSchema,
  vertices: z.array(roofVertexSchema).min(2),
  edges: z.array(roofEdgeSchema),
  faces: z.array(roofFaceDefinitionSchema),
  constraints: z.array(roofConstraintSchema),
}) satisfies z.ZodType<RoofSketch>;

export const roofOpeningSchema = z.object({
  id: nonEmptyStringSchema,
  roofSketchId: nonEmptyStringSchema,
  roofFaceId: nonEmptyStringSchema,
  center: vec2Schema,
  widthM: positiveNumberSchema,
  heightM: positiveNumberSchema,
  cutMode: roofOpeningCutModeSchema,
}) satisfies z.ZodType<RoofOpening>;

export const nodeDataSchema = z.object({
  id: nonEmptyStringSchema,
  levelId: nonEmptyStringSchema,
  position: vec2Schema,
}) satisfies z.ZodType<NodeData>;

export const wallSchema = z.object({
  id: nonEmptyStringSchema,
  levelId: nonEmptyStringSchema,
  wallTypeId: nonEmptyStringSchema,
  topMode: wallTopModeSchema,
  startNodeId: nonEmptyStringSchema,
  endNodeId: nonEmptyStringSchema,
}) satisfies z.ZodType<Wall>;

export const doorOpeningSchema = z.object({
  id: nonEmptyStringSchema,
  wallId: nonEmptyStringSchema,
  widthM: positiveNumberSchema,
  heightM: positiveNumberSchema,
  offsetM: nonNegativeNumberSchema,
  design3D: z
    .object({
      kind: doorDesign3DKindSchema,
      frameThicknessM: positiveNumberSchema,
      frameColorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      doorColorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      wallDepthOffsetM: z.number().finite(),
      openState: door3DOpenStateSchema,
      hingeSide: door3DHingeSideSchema,
      swingDirection: door3DSwingDirectionSchema,
    })
    .nullable()
    .optional(),
}) satisfies z.ZodType<DoorOpening>;

export const windowOpeningSchema = z.object({
  id: nonEmptyStringSchema,
  wallId: nonEmptyStringSchema,
  widthM: positiveNumberSchema,
  heightM: positiveNumberSchema,
  sillHeightM: nonNegativeNumberSchema,
  offsetM: nonNegativeNumberSchema,
  design3D: z
    .object({
      glassThicknessM: positiveNumberSchema,
      frameThicknessM: positiveNumberSchema,
      verticalDivisions: z.number().int().nonnegative(),
      horizontalDivisions: z.number().int().nonnegative(),
      wallDepthOffsetM: z.number().finite(),
      frameColorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    })
    .nullable()
    .optional(),
}) satisfies z.ZodType<WindowOpening>;

export const stairSchema = z.object({
  id: nonEmptyStringSchema,
  levelId: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  pathNodes: z.array(vec2Schema).min(2),
  widthM: positiveNumberSchema,
  endElevationM: finiteNumberSchema,
  riserHeightM: positiveNumberSchema,
  treadDepthM: positiveNumberSchema,
  landingLengthM: nonNegativeNumberSchema,
}) satisfies z.ZodType<Stair>;

export const shapeSchema = z.object({
  id: nonEmptyStringSchema,
  levelId: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  kind: shapeKindSchema,
  pose: pose2DSchema,
  sizeM: positiveNumberSchema,
  zStartM: finiteNumberSchema,
  heightM: positiveNumberSchema,
}) satisfies z.ZodType<Shape>;

export const slabSchema = z.object({
  id: nonEmptyStringSchema,
  levelId: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  kind: slabKindSchema,
  roofType: roofTypeSchema,
  pose: pose2DSchema,
  widthM: positiveNumberSchema,
  depthM: positiveNumberSchema,
  thicknessM: positiveNumberSchema,
  roofRiseM: nonNegativeNumberSchema,
  zOffsetM: finiteNumberSchema,
}) satisfies z.ZodType<Slab>;

export const externalModelSchema = z.object({
  id: nonEmptyStringSchema,
  levelId: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  uri: nonEmptyStringSchema,
  position: vec2Schema,
  zM: finiteNumberSchema,
  rollRad: finiteNumberSchema,
  pitchRad: finiteNumberSchema,
  yawRad: finiteNumberSchema,
}) satisfies z.ZodType<ExternalModel>;

export const measurementSchema = z.object({
  id: nonEmptyStringSchema,
  levelId: nonEmptyStringSchema,
  start: vec2Schema,
  end: vec2Schema,
  unit: measurementUnitSchema,
}) satisfies z.ZodType<Measurement>;

export const projectSchema = z.object({
  projectName: nonEmptyStringSchema,
  settings: projectSettingsSchema,
  levels: z.array(levelSchema).min(1),
  wallTypes: z.array(wallTypeSchema).min(1),
  roofLayers: z.array(roofLayerSchema).min(1),
  roofSketches: z.array(roofSketchSchema),
  roofOpenings: z.array(roofOpeningSchema),
  nodes: z.array(nodeDataSchema),
  walls: z.array(wallSchema),
  doors: z.array(doorOpeningSchema),
  windows: z.array(windowOpeningSchema),
  stairs: z.array(stairSchema),
  shapes: z.array(shapeSchema),
  slabs: z.array(slabSchema),
  externalModels: z.array(externalModelSchema),
  measurements: z.array(measurementSchema),
}) satisfies z.ZodType<Project>;

export type SerializedProject = z.infer<typeof projectSchema>;
