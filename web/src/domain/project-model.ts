export type ShapeKind = "Square" | "Cylinder";
export type SlabKind = "Rectangle" | "Circle";
export type RoofType = "Flat" | "Gable" | "Shed" | "Hip";
export type WallTopMode = "FixedHeight" | "FollowRoof";
export type MeasurementUnit = "cm" | "dm" | "m";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Pose2D {
  position: Vec2;
  yawDeg: number;
}

export interface ProjectSettings {
  gridSpacingM: number;
  nodeRadiusPx: number;
  lineWidthPx: number;
  gridLineWidthPx: number;
  axisLineWidthPx: number;
  pixelsPerMeter: number;
  snapToGrid: boolean;
}

export interface Level {
  id: string;
  name: string;
  elevationM: number;
}

export interface WallType {
  id: string;
  name: string;
  thicknessM: number;
  heightM: number;
}

export interface NodeData {
  id: string;
  levelId: string;
  position: Vec2;
}

export interface Wall {
  id: string;
  levelId: string;
  wallTypeId: string;
  topMode: WallTopMode;
  startNodeId: string;
  endNodeId: string;
}

export interface DoorOpening {
  id: string;
  wallId: string;
  widthM: number;
  heightM: number;
  offsetM: number;
  design3D?: DoorDesign3D | null;
}

export type DoorDesign3DKind = "Normal" | "Garage";
export type Door3DOpenState = "Closed" | "Open";
export type Door3DHingeSide = "Left" | "Right";
export type Door3DSwingDirection = "Inward" | "Outward";

export interface DoorDesign3D {
  kind: DoorDesign3DKind;
  frameThicknessM: number;
  frameColorHex: string;
  doorColorHex: string;
  wallDepthOffsetM: number;
  openState: Door3DOpenState;
  hingeSide: Door3DHingeSide;
  swingDirection: Door3DSwingDirection;
}

export interface WindowDesign3D {
  glassThicknessM: number;
  frameThicknessM: number;
  verticalDivisions: number;
  horizontalDivisions: number;
  wallDepthOffsetM: number;
  frameColorHex: string;
}

export interface WindowOpening {
  id: string;
  wallId: string;
  widthM: number;
  heightM: number;
  sillHeightM: number;
  offsetM: number;
  design3D?: WindowDesign3D | null;
}

export interface Stair {
  id: string;
  levelId: string;
  name: string;
  pathNodes: Vec2[];
  widthM: number;
  endElevationM: number;
  riserHeightM: number;
  treadDepthM: number;
  landingLengthM: number;
 }

export interface Shape {
  id: string;
  levelId: string;
  name: string;
  kind: ShapeKind;
  pose: Pose2D;
  sizeM: number;
  zStartM: number;
  heightM: number;
}

export interface Slab {
  id: string;
  levelId: string;
  name: string;
  kind: SlabKind;
  roofType: RoofType;
  pose: Pose2D;
  widthM: number;
  depthM: number;
  thicknessM: number;
  roofRiseM: number;
  zOffsetM: number;
}

export interface ExternalModel {
  id: string;
  levelId: string;
  name: string;
  uri: string;
  position: Vec2;
  zM: number;
  rollRad: number;
  pitchRad: number;
  yawRad: number;
}

export interface Measurement {
  id: string;
  levelId: string;
  start: Vec2;
  end: Vec2;
  unit: MeasurementUnit;
}

export interface Project {
  projectName: string;
  settings: ProjectSettings;
  levels: Level[];
  wallTypes: WallType[];
  nodes: NodeData[];
  walls: Wall[];
  doors: DoorOpening[];
  windows: WindowOpening[];
  stairs: Stair[];
  shapes: Shape[];
  slabs: Slab[];
  externalModels: ExternalModel[];
  measurements: Measurement[];
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  gridSpacingM: 1,
  nodeRadiusPx: 15,
  lineWidthPx: 7,
  gridLineWidthPx: 1,
  axisLineWidthPx: 2,
  pixelsPerMeter: 200,
  snapToGrid: true,
};

function randomToken() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  }

  return Math.random().toString(16).slice(2, 14).padEnd(12, "0");
}

export function createId(prefix: string) {
  return `${prefix}_${randomToken()}`;
}

export function createVec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function createPose2D(position: Vec2 = createVec2(), yawDeg = 0): Pose2D {
  return { position, yawDeg };
}

export function createLevel(overrides: Partial<Level> = {}): Level {
  return {
    id: overrides.id ?? createId("level"),
    name: overrides.name ?? "Level 0",
    elevationM: overrides.elevationM ?? 0,
  };
}

export function createWallType(overrides: Partial<WallType> = {}): WallType {
  return {
    id: overrides.id ?? createId("wall_type"),
    name: overrides.name ?? "Wall Type 1",
    thicknessM: overrides.thicknessM ?? 0.2,
    heightM: overrides.heightM ?? 2,
  };
}

export function createNodeData(overrides: Partial<NodeData> = {}): NodeData {
  return {
    id: overrides.id ?? createId("node"),
    levelId: overrides.levelId ?? "",
    position: overrides.position ?? createVec2(),
  };
}

export function createWall(overrides: Partial<Wall> = {}): Wall {
  return {
    id: overrides.id ?? createId("wall"),
    levelId: overrides.levelId ?? "",
    wallTypeId: overrides.wallTypeId ?? "",
    topMode: overrides.topMode ?? "FixedHeight",
    startNodeId: overrides.startNodeId ?? "",
    endNodeId: overrides.endNodeId ?? "",
  };
}

export function createDoorOpening(overrides: Partial<DoorOpening> = {}): DoorOpening {
  return {
    id: overrides.id ?? createId("door"),
    wallId: overrides.wallId ?? "",
    widthM: overrides.widthM ?? 0.9,
    heightM: overrides.heightM ?? 2.1,
    offsetM: overrides.offsetM ?? 0,
    design3D: overrides.design3D ?? null,
  };
}

export function createWindowOpening(overrides: Partial<WindowOpening> = {}): WindowOpening {
  return {
    id: overrides.id ?? createId("window"),
    wallId: overrides.wallId ?? "",
    widthM: overrides.widthM ?? 1.2,
    heightM: overrides.heightM ?? 1.2,
    sillHeightM: overrides.sillHeightM ?? 0.9,
    offsetM: overrides.offsetM ?? 0,
    design3D: overrides.design3D ?? null,
  };
}

export function createStair(overrides: Partial<Stair> = {}): Stair {
  return {
    id: overrides.id ?? createId("stair"),
    levelId: overrides.levelId ?? "",
    name: overrides.name ?? "stairs",
    pathNodes: overrides.pathNodes ?? [createVec2(), createVec2(3, 0)],
    widthM: overrides.widthM ?? 1.1,
    endElevationM: overrides.endElevationM ?? 3,
    riserHeightM: overrides.riserHeightM ?? 0.17,
    treadDepthM: overrides.treadDepthM ?? 0.28,
    landingLengthM: overrides.landingLengthM ?? 1.2,
  };
}

export function createShape(overrides: Partial<Shape> = {}): Shape {
  return {
    id: overrides.id ?? createId("shape"),
    levelId: overrides.levelId ?? "",
    name: overrides.name ?? "shape",
    kind: overrides.kind ?? "Square",
    pose: overrides.pose ?? createPose2D(),
    sizeM: overrides.sizeM ?? 0.5,
    zStartM: overrides.zStartM ?? 0,
    heightM: overrides.heightM ?? 2,
  };
}

export function createSlab(overrides: Partial<Slab> = {}): Slab {
  return {
    id: overrides.id ?? createId("slab"),
    levelId: overrides.levelId ?? "",
    name: overrides.name ?? "slab",
    kind: overrides.kind ?? "Rectangle",
    roofType: overrides.roofType ?? "Flat",
    pose: overrides.pose ?? createPose2D(),
    widthM: overrides.widthM ?? 4,
    depthM: overrides.depthM ?? 4,
    thicknessM: overrides.thicknessM ?? 0.2,
    roofRiseM: overrides.roofRiseM ?? 1.2,
    zOffsetM: overrides.zOffsetM ?? 0,
  };
}

export function createExternalModel(
  overrides: Partial<ExternalModel> = {},
): ExternalModel {
  return {
    id: overrides.id ?? createId("model"),
    levelId: overrides.levelId ?? "",
    name: overrides.name ?? "model",
    uri: overrides.uri ?? "",
    position: overrides.position ?? createVec2(),
    zM: overrides.zM ?? 0,
    rollRad: overrides.rollRad ?? 0,
    pitchRad: overrides.pitchRad ?? 0,
    yawRad: overrides.yawRad ?? 0,
  };
}

export function createMeasurement(overrides: Partial<Measurement> = {}): Measurement {
  return {
    id: overrides.id ?? createId("measure"),
    levelId: overrides.levelId ?? "",
    start: overrides.start ?? createVec2(),
    end: overrides.end ?? createVec2(1, 0),
    unit: overrides.unit ?? "m",
  };
}

export function createEmptyProject(overrides: Partial<Project> = {}): Project {
  const project: Project = {
    projectName: overrides.projectName ?? "WaWoD Studio",
    settings: overrides.settings ?? { ...DEFAULT_PROJECT_SETTINGS },
    levels: overrides.levels ?? [],
    wallTypes: overrides.wallTypes ?? [],
    nodes: overrides.nodes ?? [],
    walls: overrides.walls ?? [],
    doors: overrides.doors ?? [],
    windows: overrides.windows ?? [],
    stairs: overrides.stairs ?? [],
    shapes: overrides.shapes ?? [],
    slabs: overrides.slabs ?? [],
    externalModels: overrides.externalModels ?? [],
    measurements: overrides.measurements ?? [],
  };

  return ensureProjectDefaults(project);
}

export function ensureProjectDefaults(project: Project): Project {
  const levels = project.levels.length > 0 ? [...project.levels] : [createLevel()];
  const wallTypes =
    project.wallTypes.length > 0 ? [...project.wallTypes] : [createWallType()];

  return {
    ...project,
    projectName:
      project.projectName.trim().length > 0 ? project.projectName : "WaWoD Studio",
    settings: { ...DEFAULT_PROJECT_SETTINGS, ...project.settings },
    levels,
    wallTypes,
  };
}

export function getLevel(project: Project, levelId: string) {
  return project.levels.find((level) => level.id === levelId);
}

export function getWallType(project: Project, wallTypeId: string) {
  return project.wallTypes.find((wallType) => wallType.id === wallTypeId);
}

export function getNode(project: Project, nodeId: string) {
  return project.nodes.find((node) => node.id === nodeId);
}

export function describeProject(project: Project) {
  return [
    `${project.levels.length} level(s)`,
    `${project.wallTypes.length} wall type(s)`,
    `${project.nodes.length} node(s)`,
    `${project.walls.length} wall(s)`,
    `${project.doors.length} door(s)`,
    `${project.windows.length} window(s)`,
    `${project.stairs.length} stair(s)`,
    `${project.shapes.length} shape(s)`,
    `${project.slabs.length} slab(s)`,
    `${project.externalModels.length} external model(s)`,
    `${project.measurements.length} measurement(s)`,
  ].join(" | ");
}
