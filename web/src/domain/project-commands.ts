import { cloneProject } from "./project-serialization";
import {
  createDoorOpening as buildDoorOpening,
  createExternalModel as buildExternalModel,
  createLevel as buildLevel,
  createMeasurement as buildMeasurement,
  createNodeData,
  createShape as buildShape,
  createSlab as buildSlab,
  createStair as buildStair,
  createWall as buildWall,
  createWallType as buildWallType,
  createWindowOpening as buildWindowOpening,
  ensureProjectDefaults,
  getLevel,
  getNode,
  getWallType,
} from "./project-model";
import type {
  DoorOpening,
  ExternalModel,
  Level,
  MeasurementUnit,
  Project,
  ProjectSettings,
  Shape,
  Slab,
  Stair,
  Vec2,
  Wall,
  WallType,
  WindowOpening,
} from "./project-model";

export class ProjectCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectCommandError";
  }
}

export type ProjectCommand = (project: Project) => Project;

export interface CreateNodeInput {
  levelId: string;
  position: Vec2;
}

export interface CreateWallInput {
  levelId: string;
  wallTypeId: string;
  topMode?: Wall["topMode"];
  startNodeId: string;
  endNodeId: string;
}

export type UpdateWallInput = Partial<Omit<Wall, "id">>;
export interface CreateDoorInput {
  wallId: string;
  position: Vec2;
  widthM: number;
  heightM: number;
}
export type UpdateDoorInput = Partial<Omit<DoorOpening, "id" | "wallId">>;
export interface CreateWindowInput {
  wallId: string;
  position: Vec2;
  widthM: number;
  heightM: number;
  sillHeightM: number;
}
export type UpdateWindowInput = Partial<Omit<WindowOpening, "id" | "wallId">>;
export type CreateStairInput = Omit<Stair, "id"> & { id?: string };
export type UpdateStairInput = Partial<Omit<Stair, "id">>;
export type CreateShapeInput = Omit<Shape, "id"> & { id?: string };
export type UpdateShapeInput = Partial<Omit<Shape, "id">>;
export type CreateSlabInput = Omit<Slab, "id" | "roofType" | "roofRiseM"> & {
  id?: string;
  roofType?: Slab["roofType"];
  roofRiseM?: number;
};
export type UpdateSlabInput = Partial<Omit<Slab, "id">>;
export type CreateExternalModelInput = Omit<ExternalModel, "id"> & { id?: string };
export type UpdateExternalModelInput = Partial<Omit<ExternalModel, "id">>;
export interface CreateMeasurementInput {
  levelId: string;
  start: Vec2;
  end: Vec2;
  unit: MeasurementUnit;
  id?: string;
}
export type AddLevelInput = Omit<Level, "id"> & { id?: string };
export type UpdateLevelInput = Partial<Omit<Level, "id">>;
export type AddWallTypeInput = Omit<WallType, "id"> & { id?: string };
export type UpdateWallTypeInput = Partial<Omit<WallType, "id">>;

function normalizeProject(project: Project) {
  return cloneProject(ensureProjectDefaults(project));
}

function expectLevel(project: Project, levelId: string) {
  const level = getLevel(project, levelId);
  if (!level) {
    throw new ProjectCommandError(`Level "${levelId}" does not exist.`);
  }

  return level;
}

function expectWallType(project: Project, wallTypeId: string) {
  const wallType = getWallType(project, wallTypeId);
  if (!wallType) {
    throw new ProjectCommandError(`Wall type "${wallTypeId}" does not exist.`);
  }

  return wallType;
}

function expectNode(project: Project, nodeId: string) {
  const node = getNode(project, nodeId);
  if (!node) {
    throw new ProjectCommandError(`Node "${nodeId}" does not exist.`);
  }

  return node;
}

function expectShape(project: Project, shapeId: string) {
  const shape = project.shapes.find((item) => item.id === shapeId);
  if (!shape) {
    throw new ProjectCommandError(`Shape "${shapeId}" does not exist.`);
  }

  return shape;
}

function expectSlab(project: Project, slabId: string) {
  const slab = project.slabs.find((item) => item.id === slabId);
  if (!slab) {
    throw new ProjectCommandError(`Slab "${slabId}" does not exist.`);
  }

  return slab;
}

function wallHasOpenings(project: Project, wallId: string) {
  return (
    project.doors.some((door) => door.wallId === wallId) ||
    project.windows.some((windowOpening) => windowOpening.wallId === wallId)
  );
}

function validateSlabSurface(
  kind: Slab["kind"],
  roofType: Slab["roofType"],
  roofRiseM: number,
) {
  if (kind === "Circle" && roofType !== "Flat") {
    throw new ProjectCommandError("Only rectangle slabs can use generated roof types.");
  }

  if (roofRiseM < 0) {
    throw new ProjectCommandError("Roof rise must be non-negative.");
  }

  if (roofType !== "Flat") {
    expectPositive(roofRiseM, "Roof rise");
  }
}

function expectExternalModel(project: Project, modelId: string) {
  const model = project.externalModels.find((item) => item.id === modelId);
  if (!model) {
    throw new ProjectCommandError(`External model "${modelId}" does not exist.`);
  }

  return model;
}

function expectWall(project: Project, wallId: string) {
  const wall = project.walls.find((item) => item.id === wallId);
  if (!wall) {
    throw new ProjectCommandError(`Wall "${wallId}" does not exist.`);
  }

  return wall;
}

function expectMeasurement(project: Project, measurementId: string) {
  const measurement = project.measurements.find((item) => item.id === measurementId);
  if (!measurement) {
    throw new ProjectCommandError(`Measurement "${measurementId}" does not exist.`);
  }

  return measurement;
}

function expectDoor(project: Project, doorId: string) {
  const door = project.doors.find((item) => item.id === doorId);
  if (!door) {
    throw new ProjectCommandError(`Door "${doorId}" does not exist.`);
  }

  return door;
}

function expectWindow(project: Project, windowId: string) {
  const windowOpening = project.windows.find((item) => item.id === windowId);
  if (!windowOpening) {
    throw new ProjectCommandError(`Window "${windowId}" does not exist.`);
  }

  return windowOpening;
}

function expectStair(project: Project, stairId: string) {
  const stair = project.stairs.find((item) => item.id === stairId);
  if (!stair) {
    throw new ProjectCommandError(`Stair "${stairId}" does not exist.`);
  }

  return stair;
}

function expectPositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ProjectCommandError(`${label} must be a positive finite number.`);
  }
}

function expectFinite(value: number, label: string) {
  if (!Number.isFinite(value)) {
    throw new ProjectCommandError(`${label} must be a finite number.`);
  }
}

function expectNonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new ProjectCommandError(`${label} must be a non-negative finite number.`);
  }
}

function ensureNonEmptyName(value: string, label: string) {
  if (value.trim().length === 0) {
    throw new ProjectCommandError(`${label} must not be empty.`);
  }
}

function validateStairInput(project: Project, input: Omit<Stair, "id">, labelPrefix = "Stair") {
  expectLevel(project, input.levelId);
  ensureNonEmptyName(input.name, `${labelPrefix} name`);
  expectPositive(input.widthM, `${labelPrefix} width`);
  expectPositive(input.riserHeightM, `${labelPrefix} riser height`);
  expectPositive(input.treadDepthM, `${labelPrefix} tread depth`);
  expectNonNegative(input.landingLengthM, `${labelPrefix} landing length`);
  expectFinite(input.endElevationM, `${labelPrefix} end elevation`);

  if (input.pathNodes.length < 2) {
    throw new ProjectCommandError(`${labelPrefix} must have at least two path nodes.`);
  }

  input.pathNodes.forEach((node, index) => {
    expectFinite(node.x, `${labelPrefix} path node ${index + 1} X`);
    expectFinite(node.y, `${labelPrefix} path node ${index + 1} Y`);

    if (
      index > 0 &&
      Math.hypot(node.x - input.pathNodes[index - 1].x, node.y - input.pathNodes[index - 1].y) <
        0.0001
    ) {
      throw new ProjectCommandError(`${labelPrefix} path cannot contain duplicate consecutive nodes.`);
    }
  });

  const level = expectLevel(project, input.levelId);
  if (Math.abs(input.endElevationM - level.elevationM) < 0.0001) {
    throw new ProjectCommandError(`${labelPrefix} end elevation must differ from the host level elevation.`);
  }
}

function hasSameNodePosition(left: Vec2, right: Vec2) {
  return Math.abs(left.x - right.x) < 0.0001 && Math.abs(left.y - right.y) < 0.0001;
}

function hasSamePoint(left: Vec2, right: Vec2) {
  return Math.abs(left.x - right.x) < 0.0001 && Math.abs(left.y - right.y) < 0.0001;
}

function hasNodeAtPosition(
  project: Project,
  levelId: string,
  position: Vec2,
  ignoreNodeId?: string,
) {
  return project.nodes.some((node) => {
    if (node.levelId !== levelId) {
      return false;
    }

    if (ignoreNodeId && node.id === ignoreNodeId) {
      return false;
    }

    return hasSameNodePosition(node.position, position);
  });
}

function hasDuplicateWall(project: Project, candidate: CreateWallInput, ignoreWallId?: string) {
  return project.walls.some((wall) => {
    if (ignoreWallId && wall.id === ignoreWallId) {
      return false;
    }

    const sameNodes =
      (wall.startNodeId === candidate.startNodeId && wall.endNodeId === candidate.endNodeId) ||
      (wall.startNodeId === candidate.endNodeId && wall.endNodeId === candidate.startNodeId);

    return sameNodes && wall.levelId === candidate.levelId;
  });
}

function getWallGeometry(project: Project, wallId: string) {
  const wall = expectWall(project, wallId);
  const wallType = expectWallType(project, wall.wallTypeId);
  const startNode = expectNode(project, wall.startNodeId);
  const endNode = expectNode(project, wall.endNodeId);
  const lengthM = Math.hypot(
    endNode.position.x - startNode.position.x,
    endNode.position.y - startNode.position.y,
  );

  return { wall, wallType, startNode, endNode, lengthM };
}

function getOpeningInterval(opening: Pick<DoorOpening, "offsetM" | "widthM">) {
  return {
    startM: opening.offsetM - opening.widthM / 2,
    endM: opening.offsetM + opening.widthM / 2,
  };
}

function validateOpeningOffsetAgainstWall(
  project: Project,
  wallId: string,
  widthM: number,
  offsetM: number,
  openingLabel: string,
) {
  expectPositive(widthM, `${openingLabel} width`);
  expectNonNegative(offsetM, `${openingLabel} offset`);

  const { lengthM } = getWallGeometry(project, wallId);
  if (lengthM <= 0.0001) {
    throw new ProjectCommandError(`${openingLabel} host wall must have a positive length.`);
  }

  const halfWidthM = widthM / 2;
  if (halfWidthM > offsetM || offsetM > lengthM - halfWidthM) {
    throw new ProjectCommandError(`${openingLabel} opening must fit fully inside the selected wall segment.`);
  }
}

function validateOpeningOverlap(
  project: Project,
  wallId: string,
  widthM: number,
  offsetM: number,
  ignoreDoorId?: string,
  ignoreWindowId?: string,
) {
  const candidateInterval = getOpeningInterval({ widthM, offsetM });
  const overlapsExistingDoor = project.doors.some((door) => {
    if (door.wallId !== wallId) {
      return false;
    }

    if (ignoreDoorId && door.id === ignoreDoorId) {
      return false;
    }

    const interval = getOpeningInterval(door);
    return (
      candidateInterval.startM < interval.endM - 0.0001 &&
      candidateInterval.endM > interval.startM + 0.0001
    );
  });

  const overlapsExistingWindow = project.windows.some((windowOpening) => {
    if (windowOpening.wallId !== wallId) {
      return false;
    }

    if (ignoreWindowId && windowOpening.id === ignoreWindowId) {
      return false;
    }

    const interval = getOpeningInterval(windowOpening);
    return (
      candidateInterval.startM < interval.endM - 0.0001 &&
      candidateInterval.endM > interval.startM + 0.0001
    );
  });

  if (overlapsExistingDoor || overlapsExistingWindow) {
    throw new ProjectCommandError("Wall opening overlaps another door or window on the same wall.");
  }
}

function validateDoorAgainstWall(
  project: Project,
  wallId: string,
  widthM: number,
  heightM: number,
  offsetM: number,
  ignoreDoorId?: string,
) {
  validateOpeningOffsetAgainstWall(project, wallId, widthM, offsetM, "Door");
  expectPositive(heightM, "Door height");

  const { wall, wallType } = getWallGeometry(project, wallId);
  if (wall.topMode === "FollowRoof") {
    throw new ProjectCommandError("Doors on roof-following walls are not supported yet.");
  }

  if (heightM > wallType.heightM + 0.0001) {
    throw new ProjectCommandError("Door height cannot exceed the height of its host wall.");
  }

  validateOpeningOverlap(project, wall.id, widthM, offsetM, ignoreDoorId);
}

function validateWindowAgainstWall(
  project: Project,
  wallId: string,
  widthM: number,
  heightM: number,
  sillHeightM: number,
  offsetM: number,
  ignoreWindowId?: string,
) {
  validateOpeningOffsetAgainstWall(project, wallId, widthM, offsetM, "Window");
  expectPositive(heightM, "Window height");
  expectNonNegative(sillHeightM, "Window sill height");

  const { wall, wallType } = getWallGeometry(project, wallId);
  if (wall.topMode === "FollowRoof") {
    throw new ProjectCommandError("Windows on roof-following walls are not supported yet.");
  }
  if (sillHeightM + heightM > wallType.heightM + 0.0001) {
    throw new ProjectCommandError("Window opening must fit below the top of its host wall.");
  }

  validateOpeningOverlap(project, wall.id, widthM, offsetM, undefined, ignoreWindowId);
}

function validateDoorsForWalls(project: Project, wallIds: string[]) {
  const uniqueWallIds = [...new Set(wallIds)];
  for (const wallId of uniqueWallIds) {
    for (const door of project.doors.filter((candidate) => candidate.wallId === wallId)) {
      validateDoorAgainstWall(project, door.wallId, door.widthM, door.heightM, door.offsetM, door.id);
    }
  }
}

function validateWindowsForWalls(project: Project, wallIds: string[]) {
  const uniqueWallIds = [...new Set(wallIds)];
  for (const wallId of uniqueWallIds) {
    for (const windowOpening of project.windows.filter((candidate) => candidate.wallId === wallId)) {
      validateWindowAgainstWall(
        project,
        windowOpening.wallId,
        windowOpening.widthM,
        windowOpening.heightM,
        windowOpening.sillHeightM,
        windowOpening.offsetM,
        windowOpening.id,
      );
    }
  }
}

function getNodesOnWallSegment(
  project: Project,
  input: CreateWallInput,
  startNode: { id: string; position: Vec2 },
  endNode: { id: string; position: Vec2 },
) {
  return project.nodes
    .filter((node) => {
      if (node.levelId !== input.levelId) {
        return false;
      }

      if (node.id === startNode.id || node.id === endNode.id) {
        return false;
      }

      const { t, distanceSquared } = projectPointOntoSegment(
        node.position,
        startNode.position,
        endNode.position,
      );

      return distanceSquared <= 0.0001 && t > 0.0001 && t < 0.9999;
    })
    .map((node) => ({
      node,
      t: projectPointOntoSegment(node.position, startNode.position, endNode.position).t,
    }))
    .sort((left, right) => left.t - right.t)
    .map((entry) => entry.node);
}

function projectPointOntoSegment(position: Vec2, start: Vec2, end: Vec2) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (lengthSquared < 0.000001) {
    return {
      projection: start,
      t: 0,
      distanceSquared: (position.x - start.x) ** 2 + (position.y - start.y) ** 2,
    };
  }

  const t =
    ((position.x - start.x) * deltaX + (position.y - start.y) * deltaY) / lengthSquared;
  const clampedT = Math.max(0, Math.min(1, t));
  const projection = {
    x: start.x + deltaX * clampedT,
    y: start.y + deltaY * clampedT,
  };

  return {
    projection,
    t: clampedT,
    distanceSquared: (position.x - projection.x) ** 2 + (position.y - projection.y) ** 2,
  };
}

export function updateProjectSettings(
  project: Project,
  patch: Partial<ProjectSettings>,
) {
  const nextProject = normalizeProject(project);
  const settings = {
    ...nextProject.settings,
    ...patch,
  };

  expectPositive(settings.gridSpacingM, "Grid spacing");
  expectPositive(settings.pixelsPerMeter, "Pixels per meter");
  expectFinite(settings.nodeRadiusPx, "Node radius");
  expectFinite(settings.lineWidthPx, "Line width");
  expectFinite(settings.gridLineWidthPx, "Grid line width");
  expectFinite(settings.axisLineWidthPx, "Axis line width");

  return normalizeProject({
    ...nextProject,
    settings,
  });
}

export function deleteLevel(project: Project, levelId: string) {
  const nextProject = normalizeProject(project);
  const level = expectLevel(nextProject, levelId);

  if (nextProject.levels.length <= 1) {
    throw new ProjectCommandError("At least one level must remain in the project.");
  }

  if (Math.abs(level.elevationM) < 0.0001) {
    throw new ProjectCommandError("Ground floor cannot be removed.");
  }

  const removedNodeIds = new Set(
    nextProject.nodes.filter((node) => node.levelId === levelId).map((node) => node.id),
  );
  const removedWallIds = new Set(
    nextProject.walls
      .filter(
        (wall) =>
          wall.levelId === levelId ||
          removedNodeIds.has(wall.startNodeId) ||
          removedNodeIds.has(wall.endNodeId),
      )
      .map((wall) => wall.id),
  );

  return normalizeProject({
    ...nextProject,
    levels: nextProject.levels.filter((item) => item.id !== levelId),
    nodes: nextProject.nodes.filter((node) => node.levelId !== levelId),
    walls: nextProject.walls.filter(
      (wall) =>
        wall.levelId !== levelId &&
        !removedNodeIds.has(wall.startNodeId) &&
        !removedNodeIds.has(wall.endNodeId),
    ),
    doors: nextProject.doors.filter((door) => !removedWallIds.has(door.wallId)),
    windows: nextProject.windows.filter((windowOpening) => !removedWallIds.has(windowOpening.wallId)),
    stairs: nextProject.stairs.filter((stair) => stair.levelId !== levelId),
    shapes: nextProject.shapes.filter((shape) => shape.levelId !== levelId),
    slabs: nextProject.slabs.filter((slab) => slab.levelId !== levelId),
    externalModels: nextProject.externalModels.filter((model) => model.levelId !== levelId),
  });
}

export function createNode(project: Project, input: CreateNodeInput) {
  const nextProject = normalizeProject(project);
  expectLevel(nextProject, input.levelId);
  expectFinite(input.position.x, "Node X");
  expectFinite(input.position.y, "Node Y");

  if (hasNodeAtPosition(nextProject, input.levelId, input.position)) {
    throw new ProjectCommandError("A node already exists at this position on the active level.");
  }

  return normalizeProject({
    ...nextProject,
    nodes: [
      ...nextProject.nodes,
      createNodeData({
        levelId: input.levelId,
        position: input.position,
      }),
    ],
  });
}

export function deleteNode(project: Project, nodeId: string) {
  const nextProject = normalizeProject(project);
  expectNode(nextProject, nodeId);
  const removedWallIds = new Set(
    nextProject.walls
      .filter((wall) => wall.startNodeId === nodeId || wall.endNodeId === nodeId)
      .map((wall) => wall.id),
  );

  return normalizeProject({
    ...nextProject,
    nodes: nextProject.nodes.filter((node) => node.id !== nodeId),
    walls: nextProject.walls.filter(
      (wall) => wall.startNodeId !== nodeId && wall.endNodeId !== nodeId,
    ),
    doors: nextProject.doors.filter((door) => !removedWallIds.has(door.wallId)),
    windows: nextProject.windows.filter((windowOpening) => !removedWallIds.has(windowOpening.wallId)),
  });
}

export function moveNode(project: Project, nodeId: string, position: Vec2) {
  const nextProject = normalizeProject(project);
  const node = expectNode(nextProject, nodeId);
  expectFinite(position.x, "Node X");
  expectFinite(position.y, "Node Y");

  if (hasNodeAtPosition(nextProject, node.levelId, position, nodeId)) {
    throw new ProjectCommandError("Another node already exists at this position on the active level.");
  }

  const connectedWallIds = nextProject.walls
    .filter((wall) => wall.startNodeId === nodeId || wall.endNodeId === nodeId)
    .map((wall) => wall.id);

  const movedProject = normalizeProject({
    ...nextProject,
    nodes: nextProject.nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            position,
          }
        : node,
    ),
  });

  validateDoorsForWalls(movedProject, connectedWallIds);
  validateWindowsForWalls(movedProject, connectedWallIds);
  return movedProject;
}

export function createWall(project: Project, input: CreateWallInput) {
  const nextProject = normalizeProject(project);
  expectLevel(nextProject, input.levelId);
  expectWallType(nextProject, input.wallTypeId);

  const startNode = expectNode(nextProject, input.startNodeId);
  const endNode = expectNode(nextProject, input.endNodeId);

  if (input.startNodeId === input.endNodeId) {
    throw new ProjectCommandError("A wall must connect two different nodes.");
  }

  if (startNode.levelId !== input.levelId || endNode.levelId !== input.levelId) {
    throw new ProjectCommandError("Both wall nodes must belong to the wall level.");
  }

  if (hasDuplicateWall(nextProject, input)) {
    throw new ProjectCommandError("Duplicate wall between the same two nodes is not allowed.");
  }

  const segmentNodeIds = [
    input.startNodeId,
    ...getNodesOnWallSegment(nextProject, input, startNode, endNode).map((node) => node.id),
    input.endNodeId,
  ];

  const segmentInputs = segmentNodeIds.slice(0, -1).map((startNodeId, index) => ({
    levelId: input.levelId,
    wallTypeId: input.wallTypeId,
    topMode: input.topMode ?? "FixedHeight",
    startNodeId,
    endNodeId: segmentNodeIds[index + 1],
  }));

  const duplicateSegment = segmentInputs.find((segmentInput) =>
    hasDuplicateWall(nextProject, segmentInput),
  );

  if (duplicateSegment) {
    throw new ProjectCommandError(
      "A wall segment along this path already exists, so the wall cannot be created.",
    );
  }

  return normalizeProject({
    ...nextProject,
    walls: [
      ...nextProject.walls,
      ...segmentInputs.map((segmentInput) =>
        buildWall({
          levelId: segmentInput.levelId,
          wallTypeId: segmentInput.wallTypeId,
          topMode: segmentInput.topMode,
          startNodeId: segmentInput.startNodeId,
          endNodeId: segmentInput.endNodeId,
        }),
      ),
    ],
  });
}

export function insertNodeIntoWall(project: Project, wallId: string, position: Vec2) {
  const nextProject = normalizeProject(project);
  const wall = expectWall(nextProject, wallId);
  const startNode = expectNode(nextProject, wall.startNodeId);
  const endNode = expectNode(nextProject, wall.endNodeId);

  expectFinite(position.x, "Node X");
  expectFinite(position.y, "Node Y");

  if (
    nextProject.doors.some((door) => door.wallId === wallId) ||
    nextProject.windows.some((windowOpening) => windowOpening.wallId === wallId)
  ) {
    throw new ProjectCommandError("Cannot split a wall that already contains door or window openings.");
  }

  if (hasNodeAtPosition(nextProject, wall.levelId, position)) {
    throw new ProjectCommandError("A node already exists at this position on the active level.");
  }

  const { projection, t, distanceSquared } = projectPointOntoSegment(
    position,
    startNode.position,
    endNode.position,
  );

  if (distanceSquared > 0.0001) {
    throw new ProjectCommandError("Inserted node must lie on the selected wall.");
  }

  if (t <= 0.0001 || t >= 0.9999) {
    throw new ProjectCommandError("Inserted node must split the wall between its two endpoints.");
  }

  const insertedNode = createNodeData({
    levelId: wall.levelId,
    position: projection,
  });

  return normalizeProject({
    ...nextProject,
    nodes: [...nextProject.nodes, insertedNode],
    walls: [
      ...nextProject.walls.filter((item) => item.id !== wallId),
      buildWall({
        levelId: wall.levelId,
        wallTypeId: wall.wallTypeId,
        topMode: wall.topMode,
        startNodeId: wall.startNodeId,
        endNodeId: insertedNode.id,
      }),
      buildWall({
        levelId: wall.levelId,
        wallTypeId: wall.wallTypeId,
        topMode: wall.topMode,
        startNodeId: insertedNode.id,
        endNodeId: wall.endNodeId,
      }),
    ],
  });
}

export function deleteWall(project: Project, wallId: string) {
  const nextProject = normalizeProject(project);
  expectWall(nextProject, wallId);

  return normalizeProject({
    ...nextProject,
    walls: nextProject.walls.filter((wall) => wall.id !== wallId),
    doors: nextProject.doors.filter((door) => door.wallId !== wallId),
    windows: nextProject.windows.filter((windowOpening) => windowOpening.wallId !== wallId),
  });
}

export function deleteWallsConnectedToNode(project: Project, nodeId: string) {
  const nextProject = normalizeProject(project);
  expectNode(nextProject, nodeId);
  const removedWallIds = new Set(
    nextProject.walls
      .filter((wall) => wall.startNodeId === nodeId || wall.endNodeId === nodeId)
      .map((wall) => wall.id),
  );

  return normalizeProject({
    ...nextProject,
    walls: nextProject.walls.filter(
      (wall) => wall.startNodeId !== nodeId && wall.endNodeId !== nodeId,
    ),
    doors: nextProject.doors.filter((door) => !removedWallIds.has(door.wallId)),
    windows: nextProject.windows.filter((windowOpening) => !removedWallIds.has(windowOpening.wallId)),
  });
}

export function updateWall(project: Project, wallId: string, patch: UpdateWallInput) {
  const nextProject = normalizeProject(project);
  const currentWall = expectWall(nextProject, wallId);

  const candidate: CreateWallInput = {
    levelId: patch.levelId ?? currentWall.levelId,
    wallTypeId: patch.wallTypeId ?? currentWall.wallTypeId,
    startNodeId: patch.startNodeId ?? currentWall.startNodeId,
    endNodeId: patch.endNodeId ?? currentWall.endNodeId,
  };

  expectLevel(nextProject, candidate.levelId);
  expectWallType(nextProject, candidate.wallTypeId);

  const nextTopMode = patch.topMode ?? currentWall.topMode;
  if (nextTopMode === "FollowRoof" && wallHasOpenings(nextProject, wallId)) {
    throw new ProjectCommandError("Walls with doors or windows cannot follow the roof yet.");
  }

  const startNode = expectNode(nextProject, candidate.startNodeId);
  const endNode = expectNode(nextProject, candidate.endNodeId);

  if (candidate.startNodeId === candidate.endNodeId) {
    throw new ProjectCommandError("A wall must connect two different nodes.");
  }

  if (startNode.levelId !== candidate.levelId || endNode.levelId !== candidate.levelId) {
    throw new ProjectCommandError("Both wall nodes must belong to the wall level.");
  }

  if (hasDuplicateWall(nextProject, candidate, wallId)) {
    throw new ProjectCommandError("Duplicate wall between the same two nodes is not allowed.");
  }

  const updatedProject = normalizeProject({
    ...nextProject,
    walls: nextProject.walls.map((wall) =>
      wall.id === wallId
        ? {
            ...currentWall,
            ...patch,
          }
        : wall,
    ),
  });

  validateDoorsForWalls(updatedProject, [wallId]);
  validateWindowsForWalls(updatedProject, [wallId]);
  return updatedProject;
}

export function createDoor(project: Project, input: CreateDoorInput) {
  const nextProject = normalizeProject(project);
  const { startNode, endNode } = getWallGeometry(nextProject, input.wallId);

  expectFinite(input.position.x, "Door X");
  expectFinite(input.position.y, "Door Y");

  const { projection, distanceSquared } = projectPointOntoSegment(
    input.position,
    startNode.position,
    endNode.position,
  );

  if (distanceSquared > 0.0001) {
    throw new ProjectCommandError("Door opening must be placed on the selected wall.");
  }

  const offsetM = Math.hypot(
    projection.x - startNode.position.x,
    projection.y - startNode.position.y,
  );

  validateDoorAgainstWall(nextProject, input.wallId, input.widthM, input.heightM, offsetM);

  return normalizeProject({
    ...nextProject,
    doors: [
      ...nextProject.doors,
      buildDoorOpening({
        wallId: input.wallId,
        widthM: input.widthM,
        heightM: input.heightM,
        offsetM,
      }),
    ],
  });
}

export function updateDoor(project: Project, doorId: string, patch: UpdateDoorInput) {
  const nextProject = normalizeProject(project);
  const currentDoor = expectDoor(nextProject, doorId);
  const candidate = {
    widthM: patch.widthM ?? currentDoor.widthM,
    heightM: patch.heightM ?? currentDoor.heightM,
    offsetM: patch.offsetM ?? currentDoor.offsetM,
  };

  validateDoorAgainstWall(
    nextProject,
    currentDoor.wallId,
    candidate.widthM,
    candidate.heightM,
    candidate.offsetM,
    doorId,
  );

  return normalizeProject({
    ...nextProject,
    doors: nextProject.doors.map((door) =>
      door.id === doorId
        ? {
            ...door,
            ...patch,
          }
        : door,
    ),
  });
}

export function deleteDoor(project: Project, doorId: string) {
  const nextProject = normalizeProject(project);
  expectDoor(nextProject, doorId);

  return normalizeProject({
    ...nextProject,
    doors: nextProject.doors.filter((door) => door.id !== doorId),
  });
}

export function createWindow(project: Project, input: CreateWindowInput) {
  const nextProject = normalizeProject(project);
  const { startNode, endNode } = getWallGeometry(nextProject, input.wallId);

  expectFinite(input.position.x, "Window X");
  expectFinite(input.position.y, "Window Y");

  const { projection, distanceSquared } = projectPointOntoSegment(
    input.position,
    startNode.position,
    endNode.position,
  );

  if (distanceSquared > 0.0001) {
    throw new ProjectCommandError("Window opening must be placed on the selected wall.");
  }

  const offsetM = Math.hypot(
    projection.x - startNode.position.x,
    projection.y - startNode.position.y,
  );

  validateWindowAgainstWall(
    nextProject,
    input.wallId,
    input.widthM,
    input.heightM,
    input.sillHeightM,
    offsetM,
  );

  return normalizeProject({
    ...nextProject,
    windows: [
      ...nextProject.windows,
      buildWindowOpening({
        wallId: input.wallId,
        widthM: input.widthM,
        heightM: input.heightM,
        sillHeightM: input.sillHeightM,
        offsetM,
      }),
    ],
  });
}

export function updateWindow(project: Project, windowId: string, patch: UpdateWindowInput) {
  const nextProject = normalizeProject(project);
  const currentWindow = expectWindow(nextProject, windowId);
  const candidate = {
    widthM: patch.widthM ?? currentWindow.widthM,
    heightM: patch.heightM ?? currentWindow.heightM,
    sillHeightM: patch.sillHeightM ?? currentWindow.sillHeightM,
    offsetM: patch.offsetM ?? currentWindow.offsetM,
  };

  validateWindowAgainstWall(
    nextProject,
    currentWindow.wallId,
    candidate.widthM,
    candidate.heightM,
    candidate.sillHeightM,
    candidate.offsetM,
    windowId,
  );

  return normalizeProject({
    ...nextProject,
    windows: nextProject.windows.map((windowOpening) =>
      windowOpening.id === windowId
        ? {
            ...windowOpening,
            ...patch,
          }
        : windowOpening,
    ),
  });
}

export function deleteWindow(project: Project, windowId: string) {
  const nextProject = normalizeProject(project);
  expectWindow(nextProject, windowId);

  return normalizeProject({
    ...nextProject,
    windows: nextProject.windows.filter((windowOpening) => windowOpening.id !== windowId),
  });
}

export function createStair(project: Project, input: CreateStairInput) {
  const nextProject = normalizeProject(project);
  validateStairInput(nextProject, input);

  return normalizeProject({
    ...nextProject,
    stairs: [
      ...nextProject.stairs,
      buildStair({
        ...input,
        pathNodes: input.pathNodes.map((node) => ({ ...node })),
      }),
    ],
  });
}

export function updateStair(project: Project, stairId: string, patch: UpdateStairInput) {
  const nextProject = normalizeProject(project);
  const currentStair = expectStair(nextProject, stairId);
  const candidate: Omit<Stair, "id"> = {
    levelId: patch.levelId ?? currentStair.levelId,
    name: patch.name ?? currentStair.name,
    pathNodes: (patch.pathNodes ?? currentStair.pathNodes).map((node) => ({ ...node })),
    widthM: patch.widthM ?? currentStair.widthM,
    endElevationM: patch.endElevationM ?? currentStair.endElevationM,
    riserHeightM: patch.riserHeightM ?? currentStair.riserHeightM,
    treadDepthM: patch.treadDepthM ?? currentStair.treadDepthM,
    landingLengthM: patch.landingLengthM ?? currentStair.landingLengthM,
  };

  validateStairInput(nextProject, candidate);

  return normalizeProject({
    ...nextProject,
    stairs: nextProject.stairs.map((stair) =>
      stair.id === stairId
        ? {
            ...currentStair,
            ...patch,
            pathNodes: candidate.pathNodes,
          }
        : stair,
    ),
  });
}

export function deleteStair(project: Project, stairId: string) {
  const nextProject = normalizeProject(project);
  expectStair(nextProject, stairId);

  return normalizeProject({
    ...nextProject,
    stairs: nextProject.stairs.filter((stair) => stair.id !== stairId),
  });
}

export function createShape(project: Project, input: CreateShapeInput) {
  const nextProject = normalizeProject(project);
  expectLevel(nextProject, input.levelId);
  ensureNonEmptyName(input.name, "Shape name");
  expectPositive(input.sizeM, "Shape size");
  expectPositive(input.heightM, "Shape height");

  return normalizeProject({
    ...nextProject,
    shapes: [
      ...nextProject.shapes,
      buildShape(input),
    ],
  });
}

export function updateShape(project: Project, shapeId: string, patch: UpdateShapeInput) {
  const nextProject = normalizeProject(project);
  const currentShape = expectShape(nextProject, shapeId);

  if (patch.levelId) {
    expectLevel(nextProject, patch.levelId);
  }
  if (patch.name !== undefined) {
    ensureNonEmptyName(patch.name, "Shape name");
  }
  if (patch.sizeM !== undefined) {
    expectPositive(patch.sizeM, "Shape size");
  }
  if (patch.heightM !== undefined) {
    expectPositive(patch.heightM, "Shape height");
  }

  return normalizeProject({
    ...nextProject,
    shapes: nextProject.shapes.map((shape) =>
      shape.id === shapeId
        ? {
            ...currentShape,
            ...patch,
          }
        : shape,
    ),
  });
}

export function deleteShape(project: Project, shapeId: string) {
  const nextProject = normalizeProject(project);
  expectShape(nextProject, shapeId);

  return normalizeProject({
    ...nextProject,
    shapes: nextProject.shapes.filter((shape) => shape.id !== shapeId),
  });
}

export function createSlab(project: Project, input: CreateSlabInput) {
  const nextProject = normalizeProject(project);
  expectLevel(nextProject, input.levelId);
  ensureNonEmptyName(input.name, "Slab name");
  expectPositive(input.widthM, "Slab width");
  expectPositive(input.depthM, "Slab depth");
  expectPositive(input.thicknessM, "Slab thickness");
  validateSlabSurface(input.kind, input.roofType ?? "Flat", input.roofRiseM ?? 1.2);

  return normalizeProject({
    ...nextProject,
    slabs: [
      ...nextProject.slabs,
      buildSlab(input),
    ],
  });
}

export function updateSlab(project: Project, slabId: string, patch: UpdateSlabInput) {
  const nextProject = normalizeProject(project);
  const currentSlab = expectSlab(nextProject, slabId);

  if (patch.levelId) {
    expectLevel(nextProject, patch.levelId);
  }
  if (patch.name !== undefined) {
    ensureNonEmptyName(patch.name, "Slab name");
  }
  if (patch.widthM !== undefined) {
    expectPositive(patch.widthM, "Slab width");
  }
  if (patch.depthM !== undefined) {
    expectPositive(patch.depthM, "Slab depth");
  }
  if (patch.thicknessM !== undefined) {
    expectPositive(patch.thicknessM, "Slab thickness");
  }
  const nextKind = patch.kind ?? currentSlab.kind;
  const nextRoofType = patch.roofType ?? currentSlab.roofType;
  const nextRoofRiseM = patch.roofRiseM ?? currentSlab.roofRiseM;
  validateSlabSurface(nextKind, nextRoofType, nextRoofRiseM);

  return normalizeProject({
    ...nextProject,
    slabs: nextProject.slabs.map((slab) =>
      slab.id === slabId
        ? {
            ...currentSlab,
            ...patch,
          }
        : slab,
    ),
  });
}

export function deleteSlab(project: Project, slabId: string) {
  const nextProject = normalizeProject(project);
  expectSlab(nextProject, slabId);

  return normalizeProject({
    ...nextProject,
    slabs: nextProject.slabs.filter((slab) => slab.id !== slabId),
  });
}

export function createExternalModel(project: Project, input: CreateExternalModelInput) {
  const nextProject = normalizeProject(project);
  expectLevel(nextProject, input.levelId);
  ensureNonEmptyName(input.name, "External model name");
  ensureNonEmptyName(input.uri, "External model URI");

  return normalizeProject({
    ...nextProject,
    externalModels: [
      ...nextProject.externalModels,
      buildExternalModel(input),
    ],
  });
}

export function updateExternalModel(
  project: Project,
  modelId: string,
  patch: UpdateExternalModelInput,
) {
  const nextProject = normalizeProject(project);
  const currentModel = expectExternalModel(nextProject, modelId);

  if (patch.levelId) {
    expectLevel(nextProject, patch.levelId);
  }
  if (patch.name !== undefined) {
    ensureNonEmptyName(patch.name, "External model name");
  }
  if (patch.uri !== undefined) {
    ensureNonEmptyName(patch.uri, "External model URI");
  }

  return normalizeProject({
    ...nextProject,
    externalModels: nextProject.externalModels.map((model) =>
      model.id === modelId
        ? {
            ...currentModel,
            ...patch,
          }
        : model,
    ),
  });
}

export function deleteExternalModel(project: Project, modelId: string) {
  const nextProject = normalizeProject(project);
  expectExternalModel(nextProject, modelId);

  return normalizeProject({
    ...nextProject,
    externalModels: nextProject.externalModels.filter((model) => model.id !== modelId),
  });
}

export function createMeasurement(project: Project, input: CreateMeasurementInput) {
  const nextProject = normalizeProject(project);
  expectLevel(nextProject, input.levelId);
  expectFinite(input.start.x, "Measurement start X");
  expectFinite(input.start.y, "Measurement start Y");
  expectFinite(input.end.x, "Measurement end X");
  expectFinite(input.end.y, "Measurement end Y");

  if (hasSamePoint(input.start, input.end)) {
    throw new ProjectCommandError("Measurement start and end must not be the same point.");
  }

  return normalizeProject({
    ...nextProject,
    measurements: [
      ...nextProject.measurements,
      buildMeasurement({
        id: input.id,
        levelId: input.levelId,
        start: { ...input.start },
        end: { ...input.end },
        unit: input.unit,
      }),
    ],
  });
}

export function deleteMeasurement(project: Project, measurementId: string) {
  const nextProject = normalizeProject(project);
  expectMeasurement(nextProject, measurementId);

  return normalizeProject({
    ...nextProject,
    measurements: nextProject.measurements.filter(
      (measurement) => measurement.id !== measurementId,
    ),
  });
}

export function addLevel(project: Project, input: AddLevelInput) {
  const nextProject = normalizeProject(project);
  ensureNonEmptyName(input.name, "Level name");

  return normalizeProject({
    ...nextProject,
    levels: [
      ...nextProject.levels,
      buildLevel(input),
    ],
  });
}

export function updateLevel(project: Project, levelId: string, patch: UpdateLevelInput) {
  const nextProject = normalizeProject(project);
  const currentLevel = expectLevel(nextProject, levelId);

  if (patch.name !== undefined) {
    ensureNonEmptyName(patch.name, "Level name");
  }

  return normalizeProject({
    ...nextProject,
    levels: nextProject.levels.map((level) =>
      level.id === levelId
        ? {
            ...currentLevel,
            ...patch,
          }
        : level,
    ),
  });
}

export function addWallType(project: Project, input: AddWallTypeInput) {
  const nextProject = normalizeProject(project);
  ensureNonEmptyName(input.name, "Wall type name");
  expectPositive(input.thicknessM, "Wall thickness");
  expectPositive(input.heightM, "Wall height");

  return normalizeProject({
    ...nextProject,
    wallTypes: [
      ...nextProject.wallTypes,
      buildWallType(input),
    ],
  });
}

export function updateWallType(project: Project, wallTypeId: string, patch: UpdateWallTypeInput) {
  const nextProject = normalizeProject(project);
  const currentWallType = expectWallType(nextProject, wallTypeId);

  if (patch.name !== undefined) {
    ensureNonEmptyName(patch.name, "Wall type name");
  }
  if (patch.thicknessM !== undefined) {
    expectPositive(patch.thicknessM, "Wall thickness");
  }
  if (patch.heightM !== undefined) {
    expectPositive(patch.heightM, "Wall height");
  }

  return normalizeProject({
    ...nextProject,
    wallTypes: nextProject.wallTypes.map((wallType) =>
      wallType.id === wallTypeId
        ? {
            ...currentWallType,
            ...patch,
          }
        : wallType,
    ),
  });
}

export function deleteWallType(project: Project, wallTypeId: string) {
  const nextProject = normalizeProject(project);
  expectWallType(nextProject, wallTypeId);

  if (nextProject.wallTypes.length <= 1) {
    throw new ProjectCommandError("At least one wall type must remain in the project.");
  }

  const removedWallIds = new Set(
    nextProject.walls
      .filter((wall) => wall.wallTypeId === wallTypeId)
      .map((wall) => wall.id),
  );

  return normalizeProject({
    ...nextProject,
    wallTypes: nextProject.wallTypes.filter((wallType) => wallType.id !== wallTypeId),
    walls: nextProject.walls.filter((wall) => wall.wallTypeId !== wallTypeId),
    doors: nextProject.doors.filter((door) => !removedWallIds.has(door.wallId)),
    windows: nextProject.windows.filter((windowOpening) => !removedWallIds.has(windowOpening.wallId)),
  });
}
