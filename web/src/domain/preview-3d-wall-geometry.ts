import { createVec2 } from "./project-model";
import type { Project, Vec2 } from "./project-model";

export interface NodeWallAggregate {
  count: number;
  maxThicknessM: number;
  maxHeightM: number;
}

export interface WallOpeningRender {
  kind: "door" | "window";
  offsetM: number;
  widthM: number;
  heightM: number;
  sillHeightM: number;
}

export interface RenderWallRun {
  id: string;
  sourceWallIds: string[];
  levelId: string;
  wallTypeId: string;
  topMode: Project["walls"][number]["topMode"];
  startNodeId: string;
  endNodeId: string;
  start: Vec2;
  end: Vec2;
  openings: WallOpeningRender[];
}

export interface WallRenderInfo {
  wall: Project["walls"][number];
  start: Vec2;
  end: Vec2;
  lengthM: number;
  direction: Vec2;
  mergeKey: string;
}

export interface PreviewWallTopology {
  wallOpeningsByWallId: Map<string, WallOpeningRender[]>;
  nodeWallAggregates: Map<string, NodeWallAggregate>;
  wallRenderInfoById: Map<string, WallRenderInfo>;
  wallIdsByNodeId: Map<string, string[]>;
  renderWalls: RenderWallRun[];
}

export function getSegmentDirection2D(start: Vec2, end: Vec2) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthM = Math.hypot(deltaX, deltaY);
  if (lengthM < 0.0001) {
    return null;
  }

  return createVec2(deltaX / lengthM, deltaY / lengthM);
}

export function areDirectionsCollinear(left: Vec2, right: Vec2) {
  return Math.abs(left.x * right.x + left.y * right.y) > 0.9995;
}

function getOtherWallNodeId(wall: Project["walls"][number], nodeId: string) {
  return wall.startNodeId === nodeId ? wall.endNodeId : wall.startNodeId;
}

function collectWallOpenings(project: Project) {
  const wallOpeningsByWallId = new Map<string, WallOpeningRender[]>();

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

  return wallOpeningsByWallId;
}

function buildNodeWallAggregates(
  project: Project,
  wallTypeById: ReadonlyMap<string, Project["wallTypes"][number]>,
) {
  const nodeWallAggregates = new Map<string, NodeWallAggregate>();

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

  return nodeWallAggregates;
}

function buildWallRenderInfo(
  project: Project,
  nodeById: ReadonlyMap<string, Project["nodes"][number]>,
  wallTypeById: ReadonlyMap<string, Project["wallTypes"][number]>,
) {
  const wallRenderInfoById = new Map<string, WallRenderInfo>();
  const wallIdsByNodeId = new Map<string, string[]>();

  for (const wall of project.walls) {
    const wallType = wallTypeById.get(wall.wallTypeId);
    const startNode = nodeById.get(wall.startNodeId);
    const endNode = nodeById.get(wall.endNodeId);
    const direction =
      startNode && endNode
        ? getSegmentDirection2D(startNode.position, endNode.position)
        : null;
    if (!wallType || !startNode || !endNode || !direction) {
      continue;
    }

    wallRenderInfoById.set(wall.id, {
      wall,
      start: startNode.position,
      end: endNode.position,
      lengthM: Math.hypot(
        endNode.position.x - startNode.position.x,
        endNode.position.y - startNode.position.y,
      ),
      direction,
      mergeKey: `${wall.levelId}|${wall.wallTypeId}|${wall.topMode}`,
    });

    for (const nodeId of [wall.startNodeId, wall.endNodeId]) {
      const wallIds = wallIdsByNodeId.get(nodeId) ?? [];
      wallIds.push(wall.id);
      wallIdsByNodeId.set(nodeId, wallIds);
    }
  }

  return { wallRenderInfoById, wallIdsByNodeId };
}

function buildRenderWallRuns(
  nodeById: ReadonlyMap<string, Project["nodes"][number]>,
  wallOpeningsByWallId: ReadonlyMap<string, WallOpeningRender[]>,
  wallRenderInfoById: ReadonlyMap<string, WallRenderInfo>,
  wallIdsByNodeId: ReadonlyMap<string, string[]>,
) {
  const getMergeNeighbor = (
    current: {
      wall: Project["walls"][number];
      direction: Vec2;
      mergeKey: string;
    },
    nodeId: string,
    blockedWallIds: ReadonlySet<string>,
  ) => {
    const candidateWallIds = wallIdsByNodeId.get(nodeId) ?? [];
    if (candidateWallIds.length !== 2) {
      return null;
    }

    const candidateWallId = candidateWallIds.find(
      (wallId) => wallId !== current.wall.id && !blockedWallIds.has(wallId),
    );
    if (!candidateWallId) {
      return null;
    }

    const candidate = wallRenderInfoById.get(candidateWallId);
    if (!candidate || candidate.mergeKey !== current.mergeKey) {
      return null;
    }

    return areDirectionsCollinear(current.direction, candidate.direction) ? candidate : null;
  };

  const renderWalls: RenderWallRun[] = [];
  const visitedWallIds = new Set<string>();

  for (const initialInfo of wallRenderInfoById.values()) {
    if (visitedWallIds.has(initialInfo.wall.id)) {
      continue;
    }

    let startInfo = initialInfo;
    let startNodeId = initialInfo.wall.startNodeId;
    const reverseWalkWallIds = new Set<string>([initialInfo.wall.id]);
    while (true) {
      const neighbor = getMergeNeighbor(startInfo, startNodeId, reverseWalkWallIds);
      if (!neighbor) {
        break;
      }

      reverseWalkWallIds.add(neighbor.wall.id);
      startNodeId = getOtherWallNodeId(neighbor.wall, startNodeId);
      startInfo = neighbor;
    }

    const runInfos: WallRenderInfo[] = [];
    const runWallIds = new Set<string>();
    let currentInfo = startInfo;
    let currentStartNodeId = startNodeId;
    let finalEndNodeId = startNodeId;

    while (true) {
      runInfos.push(currentInfo);
      runWallIds.add(currentInfo.wall.id);
      visitedWallIds.add(currentInfo.wall.id);
      const currentEndNodeId = getOtherWallNodeId(currentInfo.wall, currentStartNodeId);
      finalEndNodeId = currentEndNodeId;
      const neighbor = getMergeNeighbor(currentInfo, currentEndNodeId, runWallIds);
      if (!neighbor) {
        break;
      }

      currentStartNodeId = currentEndNodeId;
      currentInfo = neighbor;
    }

    const startNode = nodeById.get(startNodeId);
    const endNode = nodeById.get(finalEndNodeId);
    if (!startNode || !endNode || runInfos.length === 0) {
      continue;
    }

    const openings: WallOpeningRender[] = [];
    let runOffsetM = 0;
    let segmentStartNodeId = startNodeId;
    for (const info of runInfos) {
      const segmentEndNodeId = getOtherWallNodeId(info.wall, segmentStartNodeId);
      const isForward = info.wall.startNodeId === segmentStartNodeId;
      for (const opening of wallOpeningsByWallId.get(info.wall.id) ?? []) {
        openings.push({
          ...opening,
          offsetM: runOffsetM + (isForward ? opening.offsetM : info.lengthM - opening.offsetM),
        });
      }

      runOffsetM += info.lengthM;
      segmentStartNodeId = segmentEndNodeId;
    }

    renderWalls.push({
      id: runInfos.map((info) => info.wall.id).join("__"),
      sourceWallIds: runInfos.map((info) => info.wall.id),
      levelId: initialInfo.wall.levelId,
      wallTypeId: initialInfo.wall.wallTypeId,
      topMode: initialInfo.wall.topMode,
      startNodeId,
      endNodeId: finalEndNodeId,
      start: startNode.position,
      end: endNode.position,
      openings,
    });
  }

  return renderWalls;
}

export function buildPreviewWallTopology(
  project: Project,
  nodeById: ReadonlyMap<string, Project["nodes"][number]>,
  wallTypeById: ReadonlyMap<string, Project["wallTypes"][number]>,
): PreviewWallTopology {
  const wallOpeningsByWallId = collectWallOpenings(project);
  const nodeWallAggregates = buildNodeWallAggregates(project, wallTypeById);
  const { wallRenderInfoById, wallIdsByNodeId } = buildWallRenderInfo(
    project,
    nodeById,
    wallTypeById,
  );
  const renderWalls = buildRenderWallRuns(
    nodeById,
    wallOpeningsByWallId,
    wallRenderInfoById,
    wallIdsByNodeId,
  );

  return {
    wallOpeningsByWallId,
    nodeWallAggregates,
    wallRenderInfoById,
    wallIdsByNodeId,
    renderWalls,
  };
}
