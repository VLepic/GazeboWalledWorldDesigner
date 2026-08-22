import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import {
  FloatingWindow,
  type FloatingWindowPosition,
} from "./components/floating-window";
import { ViewportScene } from "./components/viewport-scene";
import {
  ViewportScene3D,
  type ExternalShadingToolDesign,
  type SolarPanelToolDesign,
} from "./components/viewport-scene-3d";
import {
  createDoor,
  createMeasurement,
  createWindow,
  addLevel,
  addWallType,
  createExternalModel,
  createGroundSurface,
  createNode,
  createShape,
  createSlab,
  createRoofOpening,
  createRoofSketch,
  createSolarPanelArray,
  createRoom,
  createStair,
  createWall,
  deleteWallType,
  deleteLevel,
  deleteMeasurement,
  deleteDoor,
  deleteWindow,
  deleteRoofOpening,
  deleteSolarPanelArray,
  deleteRoom,
  deleteExternalModel,
  deleteGroundSurface,
  deleteNode,
  deleteShape,
  deleteSlab,
  deleteStair,
  deleteWall,
  deleteWallsConnectedToNode,
  insertNodeIntoWall,
  moveNode,
  updateDoor,
  updateWindow,
  updateExternalModel,
  updateGroundSurface,
  updateLevel,
  updateProjectSettings,
  updateRoofSketch,
  updateRoofOpening,
  updateSolarPanelArray,
  updateRoom,
  updateStair,
  updateWall,
  updateWallType,
  updateShape,
  updateSlab,
} from "./domain/project-commands";
import {
  type Door3DHingeSide,
  type Door3DOpenState,
  type Door3DSwingDirection,
  type DoorDesign3D,
  type DoorOpening,
  type ExternalBlindsDesign3D,
  type ExternalRollerShutterDesign3D,
  type GarageDoorStyle,
  type WindowOpening,
  type WindowDesign3D,
  calculatePolygonAreaM2,
  DEFAULT_ROOF_LAYER_ID,
  createExternalModel as buildExternalModel,
  createGroundSurface as buildGroundSurface,
  createId,
  createNodeData,
  createPose2D,
  createRoom as buildRoom,
  createShape as buildShape,
  createSlab as buildSlab,
  createVec2,
  createWall as buildWall,
  describeProject,
  type ExternalModel,
  type GroundSurface,
  type MeasurementUnit,
  type NodeData,
  type Project,
  type RoofSketch,
  type RoofOpeningCutMode,
  type RoofOpeningRotationDeg,
  type SolarPanelArray,
  type WallTopMode,
  type RoofType,
  type Room,
  type Shape,
  type Slab,
  type Stair,
  type Vec2,
  type Wall,
} from "./domain/project-model";
import {
  createProjectFileBlob,
  stringifyProject,
  validateProject,
} from "./domain/project-serialization";
import {
  createPreviewWindowSnapshot,
  createPreviewWindowUrl,
  PREVIEW_SYNC_CHANNEL,
  writePreviewWindowSnapshot,
  type PreviewWindowMessage,
} from "./domain/preview-window-sync";
import {
  createLocalPolygonFromWorld,
  getPolygonDimensions,
  getSlabWorldPolygon,
  unionConnectedPolygons,
} from "./domain/slab-geometry";
import {
  createViewportBoundsFromPoints,
  expandViewportBounds,
  getViewportFit,
  mergeViewportBounds,
  snapValueToGrid,
  type ViewportBounds,
} from "./domain/viewport";
import {
  type EditorMode,
  type EditorSelection,
  type EditorTool,
  type RoomToolMode,
  type WallAuthoringMode,
  useEditorUiStore,
} from "./store/editor-ui-store";
import { useProjectStore } from "./store/project-store";

const editorTools: EditorTool[] = [
  "Move",
  "Node",
  "Wall",
  "Measure",
  "Door",
  "Window",
  "Stair",
  "Shape",
  "Slab",
  "Model",
  "Ground",
  "Rooms",
];
const otherEditorTools: EditorTool[] = ["Model", "Ground", "Rooms"];

const roofLayerEditorTools: EditorTool[] = ["Move", "Measure", "Roof", "RoofOpening", "RoofWindow"];
const editorTools3D: EditorTool[] = [
  "Measure",
  "Door",
  "Window",
  "ExternalShading",
  "RoofWindow",
  "SolarPanels",
];
const editorModes: EditorMode[] = ["Building", "Design", "Terrain"];
const BUILT_IN_SAMPLE_URL = `${import.meta.env.BASE_URL}samples/default.wawod`;

function getEditorModeDescription(mode: EditorMode) {
  if (mode === "Design") {
    return "Furniture, materials, colors and interior details will be authored here.";
  }

  if (mode === "Terrain") {
    return "Terrain, gardens, slopes, paths and water features will be authored here.";
  }

  return "Structural plans, walls, openings, roofs, slabs and rooms are authored here.";
}

function getEditorToolLabel(tool: EditorTool) {
  if (tool === "ExternalShading") {
    return "External Shading";
  }

  if (tool === "RoofOpening") {
    return "Roof Opening";
  }

  if (tool === "SolarPanels") {
    return "Solar Panels";
  }

  return tool === "RoofWindow" ? "Roof Window" : tool;
}

function getSolarPanelToolDesign(array: SolarPanelArray): SolarPanelToolDesign {
  return {
    rows: array.rows,
    columns: array.columns,
    panelWidthM: array.panelWidthM,
    panelHeightM: array.panelHeightM,
    gapM: array.gapM,
    orientation: array.orientation,
    mountingOffsetM: array.mountingOffsetM,
    panelThicknessM: array.panelThicknessM,
    panelColorHex: array.panelColorHex,
    frameColorHex: array.frameColorHex,
  };
}

function toCentimeters(valueM: number) {
  return Number((valueM * 100).toFixed(1));
}

function toMetersFromCentimeters(valueCm: number) {
  return Number((valueCm / 100).toFixed(4));
}

function clampValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getWindowDepthOffsetLimitM(wallThicknessM: number, glassThicknessM: number) {
  return Math.max((wallThicknessM - Math.max(glassThicknessM, 0)) / 2, 0);
}

function getPolygonSignedArea(points: readonly Vec2[]) {
  let doubleArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    doubleArea += current.x * next.y - next.x * current.y;
  }

  return doubleArea / 2;
}

function getPolygonCenter(points: readonly Vec2[]) {
  if (points.length === 0) {
    return createVec2();
  }

  const total = points.reduce(
    (sum, point) => createVec2(sum.x + point.x, sum.y + point.y),
    createVec2(),
  );
  return createVec2(total.x / points.length, total.y / points.length);
}

function getRoomPolygonKey(points: readonly Vec2[]) {
  return points
    .map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`)
    .sort()
    .join("|");
}

function discoverRoomPolygonsFromWalls(project: Project, levelId: string) {
  const levelNodes = project.nodes.filter((node) => node.levelId === levelId);
  const nodeById = new Map(levelNodes.map((node) => [node.id, node] as const));
  const adjacency = new Map<string, string[]>();
  const edgeKeys = new Set<string>();

  for (const wall of project.walls.filter((item) => item.levelId === levelId)) {
    const startNode = nodeById.get(wall.startNodeId);
    const endNode = nodeById.get(wall.endNodeId);
    if (!startNode || !endNode || startNode.id === endNode.id) {
      continue;
    }

    const undirectedKey = [startNode.id, endNode.id].sort().join(":");
    if (edgeKeys.has(undirectedKey)) {
      continue;
    }

    edgeKeys.add(undirectedKey);
    adjacency.set(startNode.id, [...(adjacency.get(startNode.id) ?? []), endNode.id]);
    adjacency.set(endNode.id, [...(adjacency.get(endNode.id) ?? []), startNode.id]);
  }

  for (const [nodeId, neighbors] of adjacency) {
    const node = nodeById.get(nodeId);
    if (!node) {
      continue;
    }

    neighbors.sort((leftId, rightId) => {
      const left = nodeById.get(leftId);
      const right = nodeById.get(rightId);
      if (!left || !right) {
        return 0;
      }

      return (
        Math.atan2(left.position.y - node.position.y, left.position.x - node.position.x) -
        Math.atan2(right.position.y - node.position.y, right.position.x - node.position.x)
      );
    });
  }

  const visitedDirectedEdges = new Set<string>();
  const polygons: Vec2[][] = [];
  const polygonKeys = new Set<string>();

  for (const [startId, neighbors] of adjacency) {
    for (const nextId of neighbors) {
      const initialKey = `${startId}->${nextId}`;
      if (visitedDirectedEdges.has(initialKey)) {
        continue;
      }

      const cycleNodeIds: string[] = [];
      let currentStartId = startId;
      let currentEndId = nextId;
      let isClosed = false;

      for (let guard = 0; guard < edgeKeys.size * 4 + 4; guard += 1) {
        const directedKey = `${currentStartId}->${currentEndId}`;
        if (visitedDirectedEdges.has(directedKey)) {
          isClosed = currentStartId === startId && currentEndId === nextId;
          break;
        }

        visitedDirectedEdges.add(directedKey);
        cycleNodeIds.push(currentStartId);

        const endNeighbors = adjacency.get(currentEndId) ?? [];
        const reverseIndex = endNeighbors.indexOf(currentStartId);
        if (reverseIndex < 0 || endNeighbors.length === 0) {
          break;
        }

        const nextNeighborIndex = (reverseIndex - 1 + endNeighbors.length) % endNeighbors.length;
        const nextNeighborId = endNeighbors[nextNeighborIndex];
        currentStartId = currentEndId;
        currentEndId = nextNeighborId;

        if (currentStartId === startId && currentEndId === nextId) {
          isClosed = true;
          break;
        }
      }

      if (!isClosed || cycleNodeIds.length < 3) {
        continue;
      }

      const polygon = cycleNodeIds
        .map((nodeId) => nodeById.get(nodeId)?.position ?? null)
        .filter((point): point is Vec2 => point !== null);
      const areaM2 = getPolygonSignedArea(polygon);
      if (areaM2 <= 0.05) {
        continue;
      }

      const key = getRoomPolygonKey(polygon);
      if (polygonKeys.has(key)) {
        continue;
      }

      polygonKeys.add(key);
      polygons.push(polygon);
    }
  }

  return polygons;
}

interface SelectionClipboardPayload {
  nodes: NodeData[];
  walls: Wall[];
  shapes: Shape[];
  slabs: Slab[];
  groundSurfaces: GroundSurface[];
  rooms: Room[];
  models: ExternalModel[];
}

interface WallDragAnchor {
  nodeId: string | null;
  wallId: string | null;
  position: Vec2;
}

type FloatingWindowId =
  | "levels"
  | "levelEdit"
  | "wallTypes"
  | "wallTypeEdit"
  | "grid"
  | "tool"
  | "context";

function formatNumber(value: number) {
  return value.toFixed(2);
}

function EyeToggleIcon({ visible }: { visible: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M2.2 12c2.3-4 5.9-6 9.8-6s7.5 2 9.8 6c-2.3 4-5.9 6-9.8 6s-7.5-2-9.8-6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="12"
        r="3.1"
        fill={visible ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.4"
      />
      {!visible ? (
        <path
          d="M4 20 20 4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}

function DraftTextInput({
  value,
  onCommit,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: string;
  onCommit: (nextValue: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit() {
    if (draft !== value) {
      onCommit(draft);
    }
  }

  return (
    <input
      {...props}
      type="text"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
          return;
        }

        if (event.key === "Escape") {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function DraftNumberInput({
  value,
  onCommit,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number;
  onCommit: (nextValue: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commit() {
    const nextValue = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(nextValue)) {
      setDraft(String(value));
      return;
    }

    if (nextValue !== value) {
      onCommit(nextValue);
    }
  }

  return (
    <input
      {...props}
      type="number"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
          return;
        }

        if (event.key === "Escape") {
          setDraft(String(value));
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function createDefaultExternalBlindsDesign3D(openingWidthM = 1.2): ExternalBlindsDesign3D {
  return {
    colorHex: "#8f949c",
    coveragePercent: 100,
    slatAngleDeg: 35,
    slatCount: 16,
    slatDepthM: 0.055,
    blindWidthM: openingWidthM,
    boxWidthM: openingWidthM,
    side: "Front",
  };
}

function createDefaultExternalRollerShutterDesign3D(
  openingWidthM = 1.2,
): ExternalRollerShutterDesign3D {
  return {
    colorHex: "#8b929b",
    coveragePercent: 100,
    slatHeightM: 0.045,
    shutterDepthM: 0.025,
    shutterWidthM: openingWidthM,
    boxWidthM: openingWidthM,
    side: "Front",
  };
}

function ExternalBlindsControls({
  blinds,
  onAdd,
  onChange,
  onRemove,
  subtitle = "Fixed to this opening",
}: {
  blinds?: ExternalBlindsDesign3D | null;
  onAdd?: () => void;
  onChange: (patch: Partial<ExternalBlindsDesign3D>) => void;
  onRemove?: () => void;
  subtitle?: string;
}) {
  if (!blinds) {
    if (!onAdd) {
      return null;
    }

    return (
      <button
        type="button"
        className="toolbar-button field-grid-wide"
        onClick={onAdd}
      >
        Add External Blinds
      </button>
    );
  }

  return (
    <>
      <div className="field-grid-section-label">
        <strong>External Blinds</strong>
        <span>{subtitle}</span>
      </div>
      <label className="field-label">
        <span>Lowered ({Math.round(blinds.coveragePercent)}%)</span>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={blinds.coveragePercent}
          onChange={(event) => onChange({ coveragePercent: Number(event.target.value) })}
        />
      </label>
      <label className="field-label">
        <span>Slat Angle ({Math.round(blinds.slatAngleDeg)}°)</span>
        <input
          type="range"
          min="-80"
          max="80"
          step="1"
          value={blinds.slatAngleDeg}
          onChange={(event) => onChange({ slatAngleDeg: Number(event.target.value) })}
        />
      </label>
      <label className="field-label">
        <span>Slat Count</span>
        <DraftNumberInput
          min="1"
          max="200"
          step="1"
          value={blinds.slatCount}
          onCommit={(nextValue) =>
            onChange({ slatCount: Math.max(1, Math.min(200, Math.round(nextValue))) })
          }
        />
      </label>
      <label className="field-label">
        <span>Blind Width (m)</span>
        <DraftNumberInput
          min="0.05"
          step="0.05"
          value={blinds.blindWidthM}
          onCommit={(nextValue) => {
            if (nextValue > 0) {
              onChange({ blindWidthM: nextValue });
            }
          }}
        />
      </label>
      <label className="field-label">
        <span>Slat Depth (cm)</span>
        <DraftNumberInput
          min="1"
          max="50"
          step="0.5"
          value={toCentimeters(blinds.slatDepthM)}
          onCommit={(nextValue) => {
            if (nextValue > 0) {
              onChange({ slatDepthM: toMetersFromCentimeters(nextValue) });
            }
          }}
        />
      </label>
      <label className="field-label">
        <span>Box Width (m)</span>
        <DraftNumberInput
          min="0.05"
          step="0.05"
          value={blinds.boxWidthM}
          onCommit={(nextValue) => {
            if (nextValue > 0) {
              onChange({ boxWidthM: nextValue });
            }
          }}
        />
      </label>
      <label className="field-label">
        <span>Slat Color</span>
        <input
          type="color"
          value={blinds.colorHex}
          onChange={(event) => onChange({ colorHex: event.target.value })}
        />
      </label>
      <label className="field-label">
        <span>Wall Side</span>
        <select
          value={blinds.side}
          onChange={(event) =>
            onChange({ side: event.target.value as ExternalBlindsDesign3D["side"] })
          }
        >
          <option value="Front">Front</option>
          <option value="Back">Back</option>
        </select>
      </label>
      {onRemove ? (
        <button
          type="button"
          className="toolbar-button field-grid-wide"
          onClick={onRemove}
        >
          Remove External Blinds
        </button>
      ) : null}
    </>
  );
}

function ExternalRollerShutterControls({
  shutter,
  onAdd,
  onChange,
  onRemove,
  subtitle = "Fixed to this opening",
}: {
  shutter?: ExternalRollerShutterDesign3D | null;
  onAdd?: () => void;
  onChange: (patch: Partial<ExternalRollerShutterDesign3D>) => void;
  onRemove?: () => void;
  subtitle?: string;
}) {
  if (!shutter) {
    if (!onAdd) {
      return null;
    }

    return (
      <button type="button" className="toolbar-button field-grid-wide" onClick={onAdd}>
        Add Roller Shutter
      </button>
    );
  }

  return (
    <>
      <div className="field-grid-section-label">
        <strong>Roller Shutter</strong>
        <span>{subtitle}</span>
      </div>
      <label className="field-label">
        <span>Lowered ({Math.round(shutter.coveragePercent)}%)</span>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={shutter.coveragePercent}
          onChange={(event) => onChange({ coveragePercent: Number(event.target.value) })}
        />
      </label>
      <label className="field-label">
        <span>Shutter Width (m)</span>
        <DraftNumberInput
          min="0.05"
          step="0.05"
          value={shutter.shutterWidthM}
          onCommit={(nextValue) => {
            if (nextValue > 0) {
              onChange({ shutterWidthM: nextValue });
            }
          }}
        />
      </label>
      <label className="field-label">
        <span>Slat Height (cm)</span>
        <DraftNumberInput
          min="1"
          max="25"
          step="0.5"
          value={toCentimeters(shutter.slatHeightM)}
          onCommit={(nextValue) => {
            if (nextValue > 0) {
              onChange({ slatHeightM: toMetersFromCentimeters(nextValue) });
            }
          }}
        />
      </label>
      <label className="field-label">
        <span>Shutter Depth (cm)</span>
        <DraftNumberInput
          min="1"
          max="50"
          step="0.5"
          value={toCentimeters(shutter.shutterDepthM)}
          onCommit={(nextValue) => {
            if (nextValue > 0) {
              onChange({ shutterDepthM: toMetersFromCentimeters(nextValue) });
            }
          }}
        />
      </label>
      <label className="field-label">
        <span>Box Width (m)</span>
        <DraftNumberInput
          min="0.05"
          step="0.05"
          value={shutter.boxWidthM}
          onCommit={(nextValue) => {
            if (nextValue > 0) {
              onChange({ boxWidthM: nextValue });
            }
          }}
        />
      </label>
      <label className="field-label">
        <span>Shutter Color</span>
        <input
          type="color"
          value={shutter.colorHex}
          onChange={(event) => onChange({ colorHex: event.target.value })}
        />
      </label>
      <label className="field-label">
        <span>Wall Side</span>
        <select
          value={shutter.side}
          onChange={(event) =>
            onChange({ side: event.target.value as ExternalRollerShutterDesign3D["side"] })
          }
        >
          <option value="Front">Front</option>
          <option value="Back">Back</option>
        </select>
      </label>
      {onRemove ? (
        <button type="button" className="toolbar-button field-grid-wide" onClick={onRemove}>
          Remove Roller Shutter
        </button>
      ) : null}
    </>
  );
}

function toProjectFileName(projectName: string) {
  const normalized = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? `${normalized}.wawod` : "wawod-studio.wawod";
}

function getDoorWorldEndpoints(project: Project, door: DoorOpening) {
  return getWallOpeningEndpoints(project, door);
}

function getWindowWorldEndpoints(project: Project, windowOpening: WindowOpening) {
  return getWallOpeningEndpoints(project, windowOpening);
}

function getWallOpeningEndpoints(
  project: Project,
  opening: Pick<DoorOpening, "wallId" | "widthM" | "offsetM">,
) {
  const wall = project.walls.find((candidate) => candidate.id === opening.wallId);
  if (!wall) {
    return null;
  }

  const startNode = project.nodes.find((node) => node.id === wall.startNodeId);
  const endNode = project.nodes.find((node) => node.id === wall.endNodeId);
  if (!startNode || !endNode) {
    return null;
  }

  const deltaX = endNode.position.x - startNode.position.x;
  const deltaY = endNode.position.y - startNode.position.y;
  const lengthM = Math.hypot(deltaX, deltaY);
  if (lengthM < 0.0001) {
    return null;
  }

  const directionX = deltaX / lengthM;
  const directionY = deltaY / lengthM;
  const startOffsetM = opening.offsetM - opening.widthM / 2;
  const endOffsetM = opening.offsetM + opening.widthM / 2;

  return {
    wall,
    startNode,
    endNode,
    start: createVec2(
      startNode.position.x + directionX * startOffsetM,
      startNode.position.y + directionY * startOffsetM,
    ),
    end: createVec2(
      startNode.position.x + directionX * endOffsetM,
      startNode.position.y + directionY * endOffsetM,
    ),
  };
}

function getWallOpeningOffsetFromPosition(project: Project, wallId: string, position: Vec2) {
  const wall = project.walls.find((candidate) => candidate.id === wallId);
  if (!wall) {
    return null;
  }

  const startNode = project.nodes.find((node) => node.id === wall.startNodeId);
  const endNode = project.nodes.find((node) => node.id === wall.endNodeId);
  if (!startNode || !endNode) {
    return null;
  }

  const deltaX = endNode.position.x - startNode.position.x;
  const deltaY = endNode.position.y - startNode.position.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared < 0.000001) {
    return null;
  }

  const t =
    ((position.x - startNode.position.x) * deltaX + (position.y - startNode.position.y) * deltaY) /
    lengthSquared;
  const clampedT = Math.max(0, Math.min(1, t));
  const projection = createVec2(
    startNode.position.x + deltaX * clampedT,
    startNode.position.y + deltaY * clampedT,
  );

  return Math.hypot(
    projection.x - startNode.position.x,
    projection.y - startNode.position.y,
  );
}

function pruneOrphanNodes(project: Project) {
  const connectedNodeIds = new Set(
    project.walls.flatMap((wall) => [wall.startNodeId, wall.endNodeId]),
  );
  const nextNodes = project.nodes.filter((node) => connectedNodeIds.has(node.id));

  if (nextNodes.length === project.nodes.length) {
    return project;
  }

  return {
    ...project,
    nodes: nextNodes,
  } satisfies Project;
}

function projectPointOntoSegment(position: Vec2, start: Vec2, end: Vec2) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (lengthSquared < 0.000001) {
    return {
      projection: start,
      t: 0,
      distanceSquared:
        (position.x - start.x) * (position.x - start.x) +
        (position.y - start.y) * (position.y - start.y),
    };
  }

  const t =
    ((position.x - start.x) * deltaX + (position.y - start.y) * deltaY) / lengthSquared;
  const clampedT = Math.max(0, Math.min(1, t));
  const projection = createVec2(
    start.x + deltaX * clampedT,
    start.y + deltaY * clampedT,
  );
  const diffX = position.x - projection.x;
  const diffY = position.y - projection.y;

  return {
    projection,
    t: clampedT,
    distanceSquared: diffX * diffX + diffY * diffY,
  };
}

function distanceSquared(left: Vec2, right: Vec2) {
  return (left.x - right.x) * (left.x - right.x) + (left.y - right.y) * (left.y - right.y);
}

function getRoofEdgeChainId(edge: RoofSketch["edges"][number]) {
  return edge.chainId ?? edge.id;
}

function findRoofVertexNear(sketch: RoofSketch, position: Vec2, toleranceM: number) {
  let nearest: RoofSketch["vertices"][number] | null = null;
  let nearestDistanceSquared = toleranceM * toleranceM;

  for (const vertex of sketch.vertices) {
    const currentDistanceSquared = distanceSquared(vertex.position, position);
    if (currentDistanceSquared <= nearestDistanceSquared) {
      nearest = vertex;
      nearestDistanceSquared = currentDistanceSquared;
    }
  }

  return nearest;
}

function getRoofChainVertexIds(sketch: RoofSketch, chainEdgeIds: readonly string[]) {
  const selectedEdgeIdSet = new Set(chainEdgeIds);
  const chainEdges = sketch.edges.filter((edge) => selectedEdgeIdSet.has(edge.id));
  if (chainEdges.length === 0) {
    return [];
  }

  const adjacency = new Map<string, Array<{ edgeId: string; neighborId: string }>>();
  for (const edge of chainEdges) {
    adjacency.set(edge.startVertexId, [
      ...(adjacency.get(edge.startVertexId) ?? []),
      { edgeId: edge.id, neighborId: edge.endVertexId },
    ]);
    adjacency.set(edge.endVertexId, [
      ...(adjacency.get(edge.endVertexId) ?? []),
      { edgeId: edge.id, neighborId: edge.startVertexId },
    ]);
  }

  const endpoints = [...adjacency.entries()]
    .filter(([, neighbors]) => neighbors.length === 1)
    .map(([vertexId]) => vertexId);
  const startVertexId = endpoints[0] ?? chainEdges[0].startVertexId;
  const orderedVertexIds = [startVertexId];
  const usedEdgeIds = new Set<string>();
  let currentVertexId = startVertexId;

  while (usedEdgeIds.size < chainEdges.length) {
    const next = (adjacency.get(currentVertexId) ?? []).find(
      (candidate) => !usedEdgeIds.has(candidate.edgeId),
    );
    if (!next) {
      break;
    }

    usedEdgeIds.add(next.edgeId);
    currentVertexId = next.neighborId;
    if (currentVertexId === startVertexId) {
      break;
    }
    orderedVertexIds.push(currentVertexId);
  }

  return orderedVertexIds;
}

function compactRoofFaceVertexIds(vertexIds: readonly string[]) {
  const compacted: string[] = [];
  for (const vertexId of vertexIds) {
    if (compacted[compacted.length - 1] !== vertexId) {
      compacted.push(vertexId);
    }
  }

  if (compacted.length > 1 && compacted[0] === compacted[compacted.length - 1]) {
    compacted.pop();
  }

  return compacted;
}

function splitDisconnectedRoofChainEdges(edges: RoofSketch["edges"]) {
  const edgesByChainId = new Map<string, RoofSketch["edges"]>();
  for (const edge of edges) {
    const chainId = getRoofEdgeChainId(edge);
    edgesByChainId.set(chainId, [...(edgesByChainId.get(chainId) ?? []), edge]);
  }

  return [...edgesByChainId.values()].flatMap((chainEdges) => {
    if (chainEdges.length <= 1) {
      return chainEdges;
    }

    const edgeById = new Map(chainEdges.map((edge) => [edge.id, edge] as const));
    const edgeIdsByVertexId = new Map<string, string[]>();
    for (const edge of chainEdges) {
      edgeIdsByVertexId.set(edge.startVertexId, [
        ...(edgeIdsByVertexId.get(edge.startVertexId) ?? []),
        edge.id,
      ]);
      edgeIdsByVertexId.set(edge.endVertexId, [
        ...(edgeIdsByVertexId.get(edge.endVertexId) ?? []),
        edge.id,
      ]);
    }

    const visitedEdgeIds = new Set<string>();
    const nextEdges: RoofSketch["edges"] = [];
    for (const edge of chainEdges) {
      if (visitedEdgeIds.has(edge.id)) {
        continue;
      }

      const componentEdgeIds = new Set<string>();
      const stack = [edge.id];
      while (stack.length > 0) {
        const edgeId = stack.pop();
        if (!edgeId || visitedEdgeIds.has(edgeId)) {
          continue;
        }

        const currentEdge = edgeById.get(edgeId);
        if (!currentEdge) {
          continue;
        }

        visitedEdgeIds.add(edgeId);
        componentEdgeIds.add(edgeId);
        for (const vertexId of [currentEdge.startVertexId, currentEdge.endVertexId]) {
          for (const neighborEdgeId of edgeIdsByVertexId.get(vertexId) ?? []) {
            if (!visitedEdgeIds.has(neighborEdgeId)) {
              stack.push(neighborEdgeId);
            }
          }
        }
      }

      const componentChainId = edge.id;
      for (const componentEdgeId of componentEdgeIds) {
        const componentEdge = edgeById.get(componentEdgeId);
        if (componentEdge) {
          nextEdges.push({ ...componentEdge, chainId: componentChainId });
        }
      }
    }

    return nextEdges;
  });
}

function findWallAtPoint(project: Project, levelId: string, position: Vec2, preferredWallId?: string | null) {
  const candidates = preferredWallId
    ? [
        ...project.walls.filter((wall) => wall.id === preferredWallId),
        ...project.walls.filter((wall) => wall.id !== preferredWallId),
      ]
    : project.walls;

  for (const wall of candidates) {
    if (wall.levelId !== levelId) {
      continue;
    }

    const startNode = project.nodes.find((node) => node.id === wall.startNodeId);
    const endNode = project.nodes.find((node) => node.id === wall.endNodeId);
    if (!startNode || !endNode) {
      continue;
    }

    const projection = projectPointOntoSegment(position, startNode.position, endNode.position);
    if (projection.distanceSquared <= 0.0001 && projection.t > 0.0001 && projection.t < 0.9999) {
      return wall;
    }
  }

  return null;
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const viewportCanvasRef = useRef<HTMLDivElement | null>(null);
  const otherToolsMenuRef = useRef<HTMLDivElement | null>(null);
  const editorMenuRef = useRef<HTMLDivElement | null>(null);
  const doorToolsMenuRef = useRef<HTMLDivElement | null>(null);
  const windowToolsMenuRef = useRef<HTMLDivElement | null>(null);
  const previewMenuRef = useRef<HTMLDivElement | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const previewWindowSourceIdRef = useRef(createId("preview_source"));

  const project = useProjectStore((state) => state.project);
  const isDirty = useProjectStore((state) => state.isDirty);
  const canUndo = useProjectStore((state) => state.canUndo);
  const canRedo = useProjectStore((state) => state.canRedo);
  const isHistoryTransactionOpen = useProjectStore((state) => state.isHistoryTransactionOpen);
  const historyLength = useProjectStore((state) => state.historyLength);
  const futureLength = useProjectStore((state) => state.futureLength);
  const lastImportWarnings = useProjectStore((state) => state.lastImportWarnings);
  const replaceProject = useProjectStore((state) => state.replaceProject);
  const applyCommand = useProjectStore((state) => state.applyCommand);
  const beginHistoryTransaction = useProjectStore((state) => state.beginHistoryTransaction);
  const commitHistoryTransaction = useProjectStore((state) => state.commitHistoryTransaction);
  const cancelHistoryTransaction = useProjectStore((state) => state.cancelHistoryTransaction);
  const undo = useProjectStore((state) => state.undo);
  const redo = useProjectStore((state) => state.redo);
  const resetProject = useProjectStore((state) => state.resetProject);
  const importProjectJson = useProjectStore((state) => state.importProjectJson);
  const markSaved = useProjectStore((state) => state.markSaved);

  const editorMode = useEditorUiStore((state) => state.editorMode);
  const activeTool = useEditorUiStore((state) => state.activeTool);
  const viewportMode = useEditorUiStore((state) => state.viewportMode);
  const wallAuthoringMode = useEditorUiStore((state) => state.wallAuthoringMode);
  const activeLevelId = useEditorUiStore((state) => state.activeLevelId);
  const activeRoofLayerId = useEditorUiStore((state) => state.activeRoofLayerId);
  const activeWallTypeId = useEditorUiStore((state) => state.activeWallTypeId);
  const hiddenLevelIds2D = useEditorUiStore((state) => state.hiddenLevelIds2D);
  const hiddenLevelIds3D = useEditorUiStore((state) => state.hiddenLevelIds3D);
  const hiddenRoofLayerIds2D = useEditorUiStore((state) => state.hiddenRoofLayerIds2D);
  const hiddenRoofLayerIds3D = useEditorUiStore((state) => state.hiddenRoofLayerIds3D);
  const currentSelection = useEditorUiStore((state) => state.currentSelection);
  const selectionSet = useEditorUiStore((state) => state.selectionSet);
  const pendingWallStartNodeId = useEditorUiStore((state) => state.pendingWallStartNodeId);
  const slabMode = useEditorUiStore((state) => state.slabMode);
  const panelVisibility = useEditorUiStore((state) => state.panelVisibility);
  const viewport = useEditorUiStore((state) => state.viewport);
  const preview3D = useEditorUiStore((state) => state.preview3D);
  const viewportPresets = useEditorUiStore((state) => state.viewportPresets);
  const setEditorMode = useEditorUiStore((state) => state.setEditorMode);
  const setViewportMode = useEditorUiStore((state) => state.setViewportMode);
  const setWallAuthoringMode = useEditorUiStore((state) => state.setWallAuthoringMode);
  const setActiveTool = useEditorUiStore((state) => state.setActiveTool);
  const setActiveLevelId = useEditorUiStore((state) => state.setActiveLevelId);
  const setActiveRoofLayerId = useEditorUiStore((state) => state.setActiveRoofLayerId);
  const setActiveWallTypeId = useEditorUiStore((state) => state.setActiveWallTypeId);
  const toggleLevelVisibility = useEditorUiStore((state) => state.toggleLevelVisibility);
  const toggleRoofLayerVisibility = useEditorUiStore((state) => state.toggleRoofLayerVisibility);
  const setSelectionSet = useEditorUiStore((state) => state.setSelectionSet);
  const clearSelection = useEditorUiStore((state) => state.clearSelection);
  const setPendingWallStartNodeId = useEditorUiStore((state) => state.setPendingWallStartNodeId);
  const clearPendingWallStartNodeId = useEditorUiStore((state) => state.clearPendingWallStartNodeId);
  const setSlabMode = useEditorUiStore((state) => state.setSlabMode);
  const setInspectorOpen = useEditorUiStore((state) => state.setInspectorOpen);
  const setStatusBarVisible = useEditorUiStore((state) => state.setStatusBarVisible);
  const setHelpCardOpen = useEditorUiStore((state) => state.setHelpCardOpen);
  const setPan = useEditorUiStore((state) => state.setPan);
  const setZoom = useEditorUiStore((state) => state.setZoom);
  const panBy = useEditorUiStore((state) => state.panBy);
  const setCursorWorld = useEditorUiStore((state) => state.setCursorWorld);
  const setPreview3D = useEditorUiStore((state) => state.setPreview3D);
  const resetPreview3D = useEditorUiStore((state) => state.resetPreview3D);
  const resetViewport = useEditorUiStore((state) => state.resetViewport);
  const saveViewportPreset = useEditorUiStore((state) => state.saveViewportPreset);
  const applyViewportPreset = useEditorUiStore((state) => state.applyViewportPreset);
  const clearViewportPreset = useEditorUiStore((state) => state.clearViewportPreset);
  const syncWithProject = useEditorUiStore((state) => state.syncWithProject);

  const [activityMessage, setActivityMessage] = useState(
    "History transactions now collapse drag edits into single undo and redo steps.",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [slabConnectEnabled, setSlabConnectEnabled] = useState(false);
  const [viewportFrame, setViewportFrame] = useState({ widthPx: 0, heightPx: 0 });
  const [clipboardPayload, setClipboardPayload] = useState<SelectionClipboardPayload | null>(null);
  const [clipboardPasteCount, setClipboardPasteCount] = useState(0);
  const [projectNameDraft, setProjectNameDraft] = useState(project.projectName);
  const [isOtherToolsMenuOpen, setIsOtherToolsMenuOpen] = useState(false);
  const [isEditorMenuOpen, setIsEditorMenuOpen] = useState(false);
  const [openingToolsMenuOpen, setOpeningToolsMenuOpen] = useState<"Door" | "Window" | null>(null);
  const [externalShadingToolbarAnchor, setExternalShadingToolbarAnchor] =
    useState<"Door" | "Window">("Window");
  const [isPreviewMenuOpen, setIsPreviewMenuOpen] = useState(false);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [editingLevelId, setEditingLevelId] = useState<string | null>(null);
  const [editingWallTypeId, setEditingWallTypeId] = useState<string | null>(null);
  const [floatingWindowVisibility, setFloatingWindowVisibility] = useState<
    Record<FloatingWindowId, boolean>
  >({
    levels: true,
    levelEdit: true,
    wallTypes: true,
    wallTypeEdit: true,
    grid: true,
    tool: true,
    context: true,
  });
  const [floatingWindowPositions, setFloatingWindowPositions] = useState<
    Record<FloatingWindowId, FloatingWindowPosition>
  >({
    levels: { horizontal: "right", vertical: "top", offsetX: 24, offsetY: 112 },
    levelEdit: { horizontal: "right", vertical: "top", offsetX: 360, offsetY: 112 },
    wallTypes: { horizontal: "right", vertical: "bottom", offsetX: 24, offsetY: 88 },
    wallTypeEdit: { horizontal: "right", vertical: "bottom", offsetX: 348, offsetY: 88 },
    grid: { horizontal: "left", vertical: "bottom", offsetX: 24, offsetY: 88 },
    tool: { horizontal: "left", vertical: "top", offsetX: 380, offsetY: 112 },
    context: { horizontal: "left", vertical: "top", offsetX: 740, offsetY: 112 },
  });
  const [doorToolWidthM, setDoorToolWidthM] = useState(0.9);
  const [doorToolHeightM, setDoorToolHeightM] = useState(2.1);
  const [door3DKind, setDoor3DKind] = useState<DoorDesign3D["kind"]>("Normal");
  const [door3DGarageDoorStyle, setDoor3DGarageDoorStyle] =
    useState<GarageDoorStyle>("SinglePanel");
  const [door3DFrameThicknessM, setDoor3DFrameThicknessM] = useState(0.08);
  const [door3DFrameColorHex, setDoor3DFrameColorHex] = useState("#c4cbd6");
  const [door3DDoorColorHex, setDoor3DDoorColorHex] = useState("#8a5b3d");
  const [door3DWallDepthOffsetM, setDoor3DWallDepthOffsetM] = useState(0);
  const [door3DOpenState, setDoor3DOpenState] = useState<Door3DOpenState>("Closed");
  const [door3DOpenPercent, setDoor3DOpenPercent] = useState(0);
  const [door3DHingeSide, setDoor3DHingeSide] = useState<Door3DHingeSide>("Left");
  const [door3DSwingDirection, setDoor3DSwingDirection] = useState<Door3DSwingDirection>("Inward");
  const [windowToolWidthM, setWindowToolWidthM] = useState(1.2);
  const [windowToolHeightM, setWindowToolHeightM] = useState(1.2);
  const [windowToolSillHeightM, setWindowToolSillHeightM] = useState(0.9);
  const [window3DGlassThicknessM, setWindow3DGlassThicknessM] = useState(0.02);
  const [window3DFrameThicknessM, setWindow3DFrameThicknessM] = useState(0.08);
  const [window3DFrameColorHex, setWindow3DFrameColorHex] = useState("#c4cbd6");
  const [window3DVerticalDivisions, setWindow3DVerticalDivisions] = useState(0);
  const [window3DHorizontalDivisions, setWindow3DHorizontalDivisions] = useState(0);
  const [window3DWallDepthOffsetM, setWindow3DWallDepthOffsetM] = useState(0);
  const [externalShadingKind, setExternalShadingKind] =
    useState<ExternalShadingToolDesign["kind"]>("ExternalBlinds");
  const [externalBlindsToolDesign, setExternalBlindsToolDesign] =
    useState<ExternalBlindsDesign3D>(() => createDefaultExternalBlindsDesign3D());
  const [externalRollerShutterToolDesign, setExternalRollerShutterToolDesign] =
    useState<ExternalRollerShutterDesign3D>(() => createDefaultExternalRollerShutterDesign3D());
  const [externalShadingFitOpeningWidth, setExternalShadingFitOpeningWidth] = useState(true);
  const [measureToolUnit, setMeasureToolUnit] = useState<MeasurementUnit>("m");
  const [measureToolPermanent, setMeasureToolPermanent] = useState(false);
  const [shapeToolKind, setShapeToolKind] = useState<Shape["kind"]>("Square");
  const [shapeToolBottomM, setShapeToolBottomM] = useState(0);
  const [shapeToolTopM, setShapeToolTopM] = useState(2.5);
  const [groundToolKind, setGroundToolKind] = useState<GroundSurface["kind"]>("Floor");
  const [roomToolMode, setRoomToolMode] = useState<RoomToolMode>("Rectangle");
  const [roomConnectEnabled, setRoomConnectEnabled] = useState(false);
  const [roomToolName, setRoomToolName] = useState("Room");
  const [roofToolStartElevationM, setRoofToolStartElevationM] = useState(3);
  const [roofToolEndElevationM, setRoofToolEndElevationM] = useState(3);
  const [roofToolEndElevationLocked, setRoofToolEndElevationLocked] = useState(true);
  const [roofWindowToolWidthM, setRoofWindowToolWidthM] = useState(0.8);
  const [roofWindowToolHeightM, setRoofWindowToolHeightM] = useState(1.0);
  const [roofWindowToolCutMode, setRoofWindowToolCutMode] =
    useState<RoofOpeningCutMode>("NormalToRoof");
  const [roofWindowToolRotationDeg, setRoofWindowToolRotationDeg] =
    useState<RoofOpeningRotationDeg>(0);
  const [solarPanelToolDesign, setSolarPanelToolDesign] = useState<SolarPanelToolDesign>({
    rows: 2,
    columns: 4,
    panelWidthM: 1.134,
    panelHeightM: 1.722,
    gapM: 0.03,
    orientation: "Portrait",
    mountingOffsetM: 0.08,
    panelThicknessM: 0.04,
    panelColorHex: "#173f68",
    frameColorHex: "#b8c1ca",
  });
  const [stairToolWidthM, setStairToolWidthM] = useState(1.1);
  const [stairToolEndElevationOffsetM, setStairToolEndElevationOffsetM] = useState(3);
  const [stairToolRiserHeightM, setStairToolRiserHeightM] = useState(0.17);
  const [stairToolTreadDepthM, setStairToolTreadDepthM] = useState(0.28);
  const [stairToolLandingLengthM, setStairToolLandingLengthM] = useState(1.2);
  const [newWallsFollowRoof, setNewWallsFollowRoof] = useState(true);
  const last2DToolRef = useRef<EditorTool>("Move");
  const last3DToolRef = useRef<EditorTool>("Window");

  const projectSummary = describeProject(project);
  const projectValidation = validateProject(project);
  const availableEditorTools = useMemo(
    () => {
      if (editorMode !== "Building") {
        return [];
      }

      if (viewportMode === "3d") {
        return editorTools3D;
      }

      if (activeRoofLayerId) {
        return roofLayerEditorTools;
      }

      return wallAuthoringMode === "AutoWall"
        ? editorTools.filter((tool) => tool !== "Node")
        : editorTools;
    },
    [activeRoofLayerId, editorMode, viewportMode, wallAuthoringMode],
  );
  const hiddenLevelIdSet2D = useMemo(() => new Set(hiddenLevelIds2D), [hiddenLevelIds2D]);
  const hiddenLevelIdSet3D = useMemo(() => new Set(hiddenLevelIds3D), [hiddenLevelIds3D]);
  const hiddenRoofLayerIdSet2D = useMemo(
    () => new Set(hiddenRoofLayerIds2D),
    [hiddenRoofLayerIds2D],
  );
  const hiddenRoofLayerIdSet3D = useMemo(
    () => new Set(hiddenRoofLayerIds3D),
    [hiddenRoofLayerIds3D],
  );

  const filterProjectByHiddenLevels = useMemo(
    () =>
      (hiddenLevelIdSet: Set<string>) => {
        if (hiddenLevelIdSet.size === 0) {
          return project;
        }

        const visibleWalls = project.walls.filter((wall) => !hiddenLevelIdSet.has(wall.levelId));
        const visibleWallIdSet = new Set(visibleWalls.map((wall) => wall.id));

        return {
          ...project,
          nodes: project.nodes.filter((node) => !hiddenLevelIdSet.has(node.levelId)),
          walls: visibleWalls,
          doors: project.doors.filter((door) => visibleWallIdSet.has(door.wallId)),
          windows: project.windows.filter(
            (windowOpening) => visibleWallIdSet.has(windowOpening.wallId),
          ),
          stairs: project.stairs.filter((stair) => !hiddenLevelIdSet.has(stair.levelId)),
          shapes: project.shapes.filter((shape) => !hiddenLevelIdSet.has(shape.levelId)),
          slabs: project.slabs.filter((slab) => !hiddenLevelIdSet.has(slab.levelId)),
          rooms: project.rooms.filter((room) => !hiddenLevelIdSet.has(room.levelId)),
          externalModels: project.externalModels.filter(
            (model) => !hiddenLevelIdSet.has(model.levelId),
          ),
          measurements: project.measurements.filter(
            (measurement) => !hiddenLevelIdSet.has(measurement.levelId),
          ),
        } satisfies Project;
      },
    [project],
  );
  const visibleProject2D = useMemo(
    () => {
      const baseProject = filterProjectByHiddenLevels(hiddenLevelIdSet2D);
      return {
        ...baseProject,
        roofSketches: baseProject.roofSketches.filter((sketch) =>
          !hiddenRoofLayerIdSet2D.has(sketch.layerId),
        ),
        roofOpenings: baseProject.roofOpenings.filter((opening) =>
          baseProject.roofSketches.some(
            (sketch) =>
              sketch.id === opening.roofSketchId &&
              !hiddenRoofLayerIdSet2D.has(sketch.layerId),
          ),
        ),
        solarPanelArrays: baseProject.solarPanelArrays.filter((array) =>
          baseProject.roofSketches.some(
            (sketch) =>
              sketch.id === array.roofSketchId &&
              !hiddenRoofLayerIdSet2D.has(sketch.layerId),
          ),
        ),
      } satisfies Project;
    },
    [filterProjectByHiddenLevels, hiddenLevelIdSet2D, hiddenRoofLayerIdSet2D],
  );
  const visibleProject3D = useMemo(
    () => filterProjectByHiddenLevels(hiddenLevelIdSet3D),
    [filterProjectByHiddenLevels, hiddenLevelIdSet3D],
  );
  const currentHiddenLevelIdSet = viewportMode === "3d" ? hiddenLevelIdSet3D : hiddenLevelIdSet2D;
  const currentHiddenRoofLayerIdSet =
    viewportMode === "3d" ? hiddenRoofLayerIdSet3D : hiddenRoofLayerIdSet2D;
  const activeLevel = project.levels.find((level) => level.id === activeLevelId) ?? null;
  const defaultRoofLayer =
    project.roofLayers.find((roofLayer) => roofLayer.id === DEFAULT_ROOF_LAYER_ID) ??
    project.roofLayers[0] ??
    null;
  const isDefaultRoofLayerVisible =
    defaultRoofLayer !== null && !currentHiddenRoofLayerIdSet.has(defaultRoofLayer.id);
  const editingLevel =
    editingLevelId ? project.levels.find((level) => level.id === editingLevelId) ?? null : null;
  const activeWallType =
    project.wallTypes.find((wallType) => wallType.id === activeWallTypeId) ?? null;
  const editingWallType =
    editingWallTypeId
      ? project.wallTypes.find((wallType) => wallType.id === editingWallTypeId) ?? null
      : null;
  const activeLevelName = activeLevel?.name ?? "None";
  const activeWallTypeName = activeWallType?.name ?? "None";
  const isGroundLevel = activeLevel ? Math.abs(activeLevel.elevationM) < 0.0001 : false;
  const canRemoveActiveLevel =
    activeLevel !== null && project.levels.length > 1 && !isGroundLevel;
  const recentNodesOnActiveLevel = activeLevelId
    ? project.nodes.filter((node) => node.levelId === activeLevelId)
    : [];
  const selectedNode =
    currentSelection?.kind === "node"
      ? (project.nodes.find((node) => node.id === currentSelection.id) ?? null)
      : null;
  const selectedWall =
    currentSelection?.kind === "wall"
      ? (project.walls.find((wall) => wall.id === currentSelection.id) ?? null)
      : null;
  const selectedDoor =
    currentSelection?.kind === "door"
      ? (project.doors.find((door) => door.id === currentSelection.id) ?? null)
      : null;
  const selectedWindow =
    currentSelection?.kind === "window"
      ? (project.windows.find((windowOpening) => windowOpening.id === currentSelection.id) ?? null)
      : null;
  const selectedMeasurement =
    currentSelection?.kind === "measure"
      ? (project.measurements.find((measurement) => measurement.id === currentSelection.id) ?? null)
      : null;
  const selectedStair =
    currentSelection?.kind === "stair"
      ? (project.stairs.find((stair) => stair.id === currentSelection.id) ?? null)
      : null;
  const selectedShape =
    currentSelection?.kind === "shape"
      ? (project.shapes.find((shape) => shape.id === currentSelection.id) ?? null)
      : null;
  const selectedSlab =
    currentSelection?.kind === "slab"
      ? (project.slabs.find((slab) => slab.id === currentSelection.id) ?? null)
      : null;
  const selectedGroundSurface =
    currentSelection?.kind === "groundSurface"
      ? (project.groundSurfaces.find((groundSurface) => groundSurface.id === currentSelection.id) ?? null)
      : null;
  const selectedRoom =
    currentSelection?.kind === "room"
      ? (project.rooms.find((room) => room.id === currentSelection.id) ?? null)
      : null;
  const selectedRoofSketch =
    currentSelection?.kind === "roofEdge"
      ? (project.roofSketches.find((sketch) =>
          sketch.edges.some((edge) => edge.id === currentSelection.id),
        ) ?? null)
      : null;
  const selectedRoofEdge =
    currentSelection?.kind === "roofEdge" && selectedRoofSketch
      ? (selectedRoofSketch.edges.find((edge) => edge.id === currentSelection.id) ?? null)
      : null;
  const selectedRoofEdgeStartVertex =
    selectedRoofSketch && selectedRoofEdge
      ? (selectedRoofSketch.vertices.find(
          (vertex) => vertex.id === selectedRoofEdge.startVertexId,
        ) ?? null)
      : null;
  const selectedRoofEdgeEndVertex =
    selectedRoofSketch && selectedRoofEdge
      ? (selectedRoofSketch.vertices.find(
          (vertex) => vertex.id === selectedRoofEdge.endVertexId,
        ) ?? null)
      : null;
  const selectedRoofVertexSketch =
    currentSelection?.kind === "roofVertex"
      ? (project.roofSketches.find((sketch) =>
          sketch.vertices.some((vertex) => vertex.id === currentSelection.id),
        ) ?? null)
      : null;
  const selectedRoofVertex =
    currentSelection?.kind === "roofVertex" && selectedRoofVertexSketch
      ? (selectedRoofVertexSketch.vertices.find((vertex) => vertex.id === currentSelection.id) ?? null)
      : null;
  const selectedRoofFaceSketch =
    currentSelection?.kind === "roofFace"
      ? (project.roofSketches.find((sketch) =>
          sketch.faces.some((face) => face.id === currentSelection.id),
        ) ?? null)
      : null;
  const selectedRoofFace =
    currentSelection?.kind === "roofFace" && selectedRoofFaceSketch
      ? (selectedRoofFaceSketch.faces.find((face) => face.id === currentSelection.id) ?? null)
      : null;
  const selectedRoofOpening =
    currentSelection?.kind === "roofOpening"
      ? (project.roofOpenings.find((opening) => opening.id === currentSelection.id) ?? null)
      : null;
  const selectedSolarPanelArray =
    currentSelection?.kind === "solarPanelArray"
      ? (project.solarPanelArrays.find((array) => array.id === currentSelection.id) ?? null)
      : null;
  const selectedExternalModel =
    currentSelection?.kind === "externalModel"
      ? (project.externalModels.find((model) => model.id === currentSelection.id) ?? null)
      : null;
  const selectedDoorWall =
    selectedDoor ? project.walls.find((wall) => wall.id === selectedDoor.wallId) ?? null : null;
  const selectedDoorWallType =
    selectedDoorWall
      ? project.wallTypes.find((wallType) => wallType.id === selectedDoorWall.wallTypeId) ?? null
      : null;
  const selectedDoorEffective3DDesign =
    selectedDoor?.design3D ?? createCurrentDoor3DDesign();
  const selectedDoorDepthOffsetLimitM =
    selectedDoorWallType
      ? getWindowDepthOffsetLimitM(
          selectedDoorWallType.thicknessM,
          Math.max(selectedDoorEffective3DDesign.frameThicknessM * 0.5, 0.02),
        )
      : null;
  const selectedWindowWall =
    selectedWindow
      ? project.walls.find((wall) => wall.id === selectedWindow.wallId) ?? null
      : null;
  const selectedWindowWallType =
    selectedWindowWall
      ? project.wallTypes.find((wallType) => wallType.id === selectedWindowWall.wallTypeId) ?? null
      : null;
  const selectedWindowEffective3DDesign =
    selectedWindow?.design3D ?? createCurrentWindow3DDesign();
  const selectedWindowDepthOffsetLimitM =
    selectedWindowWallType
      ? getWindowDepthOffsetLimitM(
          selectedWindowWallType.thicknessM,
          selectedWindowEffective3DDesign.glassThicknessM,
        )
      : null;
  const selectedStairLevel =
    selectedStair
      ? project.levels.find((level) => level.id === selectedStair.levelId) ?? null
      : null;
  const selectedNodeIds = selectionSet
    .filter((selection) => selection.kind === "node")
    .map((selection) => selection.id);
  const selectedShapeIds = selectionSet
    .filter((selection) => selection.kind === "shape")
    .map((selection) => selection.id);
  const selectedSlabIds = selectionSet
    .filter((selection) => selection.kind === "slab")
    .map((selection) => selection.id);
  const selectedGroundSurfaceIds = selectionSet
    .filter((selection) => selection.kind === "groundSurface")
    .map((selection) => selection.id);
  const selectedRoomIds = selectionSet
    .filter((selection) => selection.kind === "room")
    .map((selection) => selection.id);
  const selectedRoofEdgeIds = selectionSet
    .filter((selection) => selection.kind === "roofEdge")
    .map((selection) => selection.id);
  const selectedRoofVertexIds = selectionSet
    .filter((selection) => selection.kind === "roofVertex")
    .map((selection) => selection.id);
  const selectedRoofChainIds = useMemo(() => {
    const chainIds = new Set<string>();
    for (const edgeId of selectedRoofEdgeIds) {
      const edge = project.roofSketches
        .flatMap((sketch) => sketch.edges)
        .find((candidate) => candidate.id === edgeId);
      if (edge) {
        chainIds.add(getRoofEdgeChainId(edge));
      }
    }

    return [...chainIds];
  }, [project.roofSketches, selectedRoofEdgeIds]);
  const selectedModelIds = selectionSet
    .filter((selection) => selection.kind === "externalModel")
    .map((selection) => selection.id);
  function setSingleSelection(selection: EditorSelection | null) {
    if (!selection) {
      clearSelection();
      return;
    }

    setSelectionSet([selection], selection);
  }

  useEffect(() => {
    syncWithProject(project);
  }, [project, syncWithProject]);

  useEffect(() => {
    if (viewportMode === "3d") {
      setCursorWorld(null);
    }
  }, [setCursorWorld, viewportMode]);

  useEffect(() => {
    if (editorMode !== "Building") {
      return;
    }

    if (viewportMode === "2d" && !editorTools3D.includes(activeTool)) {
      last2DToolRef.current = activeTool;
    }

    if (viewportMode === "3d" && editorTools3D.includes(activeTool)) {
      last3DToolRef.current = activeTool;
    }
  }, [activeTool, editorMode, viewportMode]);

  const previousViewportModeRef = useRef(viewportMode);
  useEffect(() => {
    if (editorMode !== "Building") {
      previousViewportModeRef.current = viewportMode;
      return;
    }

    const previousMode = previousViewportModeRef.current;
    previousViewportModeRef.current = viewportMode;

    if (previousMode === viewportMode) {
      return;
    }

    if (viewportMode === "3d") {
      if (!editorTools3D.includes(activeTool)) {
        setActiveTool(last3DToolRef.current);
      }
      return;
    }

    if (editorTools3D.includes(activeTool)) {
      setActiveTool(last2DToolRef.current);
    }
  }, [activeTool, editorMode, setActiveTool, viewportMode]);

  useEffect(() => {
    if (editorMode !== "Building") {
      return;
    }

    if (wallAuthoringMode === "AutoWall" && activeTool === "Node") {
      setActiveTool("Wall");
    }
  }, [activeTool, editorMode, setActiveTool, wallAuthoringMode]);

  useEffect(() => {
    if (editorMode !== "Building" || availableEditorTools.length === 0) {
      return;
    }

    if (availableEditorTools.includes(activeTool)) {
      return;
    }

    setActiveTool(
      activeRoofLayerId && availableEditorTools.includes("Roof")
        ? "Roof"
        : availableEditorTools[0],
    );
  }, [activeRoofLayerId, activeTool, availableEditorTools, editorMode, setActiveTool]);

  useEffect(() => {
    setIsOtherToolsMenuOpen(false);
    setOpeningToolsMenuOpen(null);
    setIsPreviewMenuOpen(false);
    setIsSettingsMenuOpen(false);
    setEditingLevelId(null);
    setEditingWallTypeId(null);
  }, [editorMode]);

  useEffect(() => {
    setProjectNameDraft(project.projectName);
  }, [project.projectName]);

  useEffect(() => {
    if (editingWallTypeId && !project.wallTypes.some((wallType) => wallType.id === editingWallTypeId)) {
      setEditingWallTypeId(null);
    }
  }, [editingWallTypeId, project.wallTypes]);

  useEffect(() => {
    if (editingLevelId && !project.levels.some((level) => level.id === editingLevelId)) {
      setEditingLevelId(null);
    }
  }, [editingLevelId, project.levels]);

  useEffect(() => {
    console.log("[FloatingWindowPositions]", floatingWindowPositions);
  }, [floatingWindowPositions]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!otherToolsMenuRef.current?.contains(target)) {
        setIsOtherToolsMenuOpen(false);
      }
      if (!editorMenuRef.current?.contains(target)) {
        setIsEditorMenuOpen(false);
      }
      if (
        !doorToolsMenuRef.current?.contains(target) &&
        !windowToolsMenuRef.current?.contains(target)
      ) {
        setOpeningToolsMenuOpen(null);
      }
      if (!previewMenuRef.current?.contains(target)) {
        setIsPreviewMenuOpen(false);
      }
      if (!settingsMenuRef.current?.contains(target)) {
        setIsSettingsMenuOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    const snapshot = createPreviewWindowSnapshot(
      stringifyProject(project),
      preview3D,
      hiddenLevelIds3D,
      hiddenRoofLayerIds3D,
    );
    writePreviewWindowSnapshot(snapshot);

    if (!("BroadcastChannel" in window)) {
      return;
    }

    const sourceId = previewWindowSourceIdRef.current;
    const channel = new BroadcastChannel(PREVIEW_SYNC_CHANNEL);
    channel.postMessage({
      type: "project-snapshot",
      sourceId,
      snapshot,
    } satisfies PreviewWindowMessage);

    const handleMessage = (event: MessageEvent<PreviewWindowMessage>) => {
      const message = event.data;
      if (
        !message ||
        message.sourceId === sourceId ||
        message.type !== "request-project-snapshot"
      ) {
        return;
      }

      channel.postMessage({
        type: "project-snapshot",
        sourceId,
        snapshot: createPreviewWindowSnapshot(
          stringifyProject(project),
          preview3D,
          hiddenLevelIds3D,
          hiddenRoofLayerIds3D,
        ),
      } satisfies PreviewWindowMessage);
    };

    channel.addEventListener("message", handleMessage);
    return () => {
      channel.removeEventListener("message", handleMessage);
      channel.close();
    };
  }, [hiddenLevelIds3D, hiddenRoofLayerIds3D, preview3D, project]);

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) {
        return false;
      }

      const tagName = target.tagName.toLowerCase();
      return (
        target.isContentEditable ||
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select"
      );
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (
        !(event.ctrlKey || event.metaKey) ||
        isEditableTarget(event.target) ||
        isHistoryTransactionOpen
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        if (!canUndo) {
          return;
        }

        event.preventDefault();
        undo();
        reportSuccess("Undid the last editor change.");
        return;
      }

      if (key === "y" || (key === "z" && event.shiftKey)) {
        if (!canRedo) {
          return;
        }

        event.preventDefault();
        redo();
        reportSuccess("Redid the next editor change.");
        return;
      }

      if (key === "c") {
        if (editorMode !== "Building") {
          return;
        }

        if (selectionSet.length === 0) {
          return;
        }

        event.preventDefault();
        handleCopySelection();
        return;
      }

      if (key === "v") {
        if (editorMode !== "Building") {
          return;
        }

        if (!clipboardPayload) {
          return;
        }

        event.preventDefault();
        handlePasteSelection();
        return;
      }

      if (key === "f") {
        event.preventDefault();
        if (event.shiftKey) {
          handleFitActiveLevel();
        } else {
          handleFitSelection();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [canRedo, canUndo, clipboardPayload, editorMode, isHistoryTransactionOpen, redo, selectionSet, undo]);

  useEffect(() => {
    const element = viewportCanvasRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      setViewportFrame({
        widthPx: entry.contentRect.width,
        heightPx: entry.contentRect.height,
      });
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  function reportSuccess(message: string) {
    setErrorMessage(null);
    setActivityMessage(message);
  }

  function reportError(message: string) {
    setErrorMessage(message);
  }

  function removeSelectionEntry(kind: EditorSelection["kind"], id: string) {
    const nextSelectionSet = selectionSet.filter(
      (selection) => !(selection.kind === kind && selection.id === id),
    );
    setSelectionSet(nextSelectionSet, nextSelectionSet[0] ?? null);
  }

  function commitNumericInput(value: number, onValid: (nextValue: number) => void) {
    if (!Number.isFinite(value)) {
      return;
    }

    onValid(value);
  }

  function commitCoordinateInput(value: number, onValid: (nextValue: number) => void) {
    commitNumericInput(
      project.settings.snapToGrid
        ? snapValueToGrid(value, project.settings.gridSpacingM)
        : value,
      onValid,
    );
  }

  function focusSelection(selection: EditorSelection | null) {
    setSingleSelection(selection);
  }

  function createClipboardPayload(): SelectionClipboardPayload | null {
    const nodeIds = new Set(selectedNodeIds);
    const nodes = project.nodes.filter((node) => nodeIds.has(node.id));
    const walls = project.walls.filter(
      (wall) => nodeIds.has(wall.startNodeId) && nodeIds.has(wall.endNodeId),
    );
    const shapes = project.shapes.filter((shape) => selectedShapeIds.includes(shape.id));
    const slabs = project.slabs.filter((slab) => selectedSlabIds.includes(slab.id));
    const groundSurfaces = project.groundSurfaces.filter((groundSurface) =>
      selectedGroundSurfaceIds.includes(groundSurface.id),
    );
    const rooms = project.rooms.filter((room) => selectedRoomIds.includes(room.id));
    const models = project.externalModels.filter((model) => selectedModelIds.includes(model.id));

    if (
      nodes.length === 0 &&
      walls.length === 0 &&
      shapes.length === 0 &&
      slabs.length === 0 &&
      groundSurfaces.length === 0 &&
      rooms.length === 0 &&
      models.length === 0
    ) {
      return null;
    }

    return { nodes, walls, shapes, slabs, groundSurfaces, rooms, models };
  }

  function handleCopySelection() {
    const payload = createClipboardPayload();
    if (!payload) {
      reportError("Nothing movable is selected for copy.");
      return;
    }

    setClipboardPayload(payload);
    setClipboardPasteCount(0);
    reportSuccess(
      `Copied ${payload.nodes.length} node(s), ${payload.shapes.length} shape(s), ${payload.slabs.length} slab(s), ${payload.groundSurfaces.length} ground surface(s), ${payload.rooms.length} room(s), ${payload.models.length} model marker(s) and ${payload.walls.length} wall(s).`,
    );
  }

  function handlePasteSelection() {
    if (!clipboardPayload) {
      reportError("Clipboard is empty.");
      return;
    }

    const offsetM = project.settings.gridSpacingM;
    const pasteIndex = clipboardPasteCount + 1;
    const delta = createVec2(offsetM * pasteIndex, offsetM * pasteIndex);

    const newSelections: EditorSelection[] = [];

    applyCommand((current) => {
      const nodeIdMap = new Map<string, string>();
      const nextNodes = clipboardPayload.nodes.map((node) => {
        const nextNode = createNodeData({
          levelId: node.levelId,
          position: createVec2(node.position.x + delta.x, node.position.y + delta.y),
        });
        nodeIdMap.set(node.id, nextNode.id);
        newSelections.push({ kind: "node", id: nextNode.id });
        return nextNode;
      });

      const nextWalls = clipboardPayload.walls.flatMap((wall) => {
        const nextStartNodeId = nodeIdMap.get(wall.startNodeId);
        const nextEndNodeId = nodeIdMap.get(wall.endNodeId);
        if (!nextStartNodeId || !nextEndNodeId) {
          return [];
        }

        return [
          buildWall({
            levelId: wall.levelId,
            wallTypeId: wall.wallTypeId,
            startNodeId: nextStartNodeId,
            endNodeId: nextEndNodeId,
          }),
        ];
      });

      const nextShapes = clipboardPayload.shapes.map((shape) => {
        const nextShape = buildShape({
          levelId: shape.levelId,
          name: shape.name,
          kind: shape.kind,
          pose: createPose2D(
            createVec2(shape.pose.position.x + delta.x, shape.pose.position.y + delta.y),
            shape.pose.yawDeg,
          ),
          sizeM: shape.sizeM,
          zStartM: shape.zStartM,
          heightM: shape.heightM,
        });
        newSelections.push({ kind: "shape", id: nextShape.id });
        return nextShape;
      });

      const nextSlabs = clipboardPayload.slabs.map((slab) => {
        const nextSlab = buildSlab({
          levelId: slab.levelId,
          name: slab.name,
          kind: slab.kind,
          roofType: slab.roofType,
          pose: createPose2D(
            createVec2(slab.pose.position.x + delta.x, slab.pose.position.y + delta.y),
            slab.pose.yawDeg,
          ),
          widthM: slab.widthM,
          depthM: slab.depthM,
          thicknessM: slab.thicknessM,
          roofRiseM: slab.roofRiseM,
          zOffsetM: slab.zOffsetM,
          polygon: slab.polygon,
          connectWithOtherSlabs: slab.connectWithOtherSlabs,
        });
        newSelections.push({ kind: "slab", id: nextSlab.id });
        return nextSlab;
      });

      const nextGroundSurfaces = clipboardPayload.groundSurfaces.map((groundSurface) => {
        const nextGroundSurface = buildGroundSurface({
          name: groundSurface.name,
          kind: groundSurface.kind,
          pose: createPose2D(
            createVec2(
              groundSurface.pose.position.x + delta.x,
              groundSurface.pose.position.y + delta.y,
            ),
            groundSurface.pose.yawDeg,
          ),
          widthM: groundSurface.widthM,
          depthM: groundSurface.depthM,
        });
        newSelections.push({ kind: "groundSurface", id: nextGroundSurface.id });
        return nextGroundSurface;
      });

      const nextRooms = clipboardPayload.rooms.map((room) => {
        const nextRoom = buildRoom({
          levelId: room.levelId,
          name: room.name,
          polygon: room.polygon.map((point) => createVec2(point.x + delta.x, point.y + delta.y)),
        });
        newSelections.push({ kind: "room", id: nextRoom.id });
        return nextRoom;
      });

      const nextModels = clipboardPayload.models.map((model) => {
        const nextModel = buildExternalModel({
          levelId: model.levelId,
          name: model.name,
          uri: model.uri,
          position: createVec2(model.position.x + delta.x, model.position.y + delta.y),
          zM: model.zM,
          rollRad: model.rollRad,
          pitchRad: model.pitchRad,
          yawRad: model.yawRad,
        });
        newSelections.push({ kind: "externalModel", id: nextModel.id });
        return nextModel;
      });

      return {
        ...current,
        nodes: [...current.nodes, ...nextNodes],
        walls: [...current.walls, ...nextWalls],
        shapes: [...current.shapes, ...nextShapes],
        slabs: [...current.slabs, ...nextSlabs],
        groundSurfaces: [...current.groundSurfaces, ...nextGroundSurfaces],
        rooms: [...current.rooms, ...nextRooms],
        externalModels: [...current.externalModels, ...nextModels],
      };
    });

    setClipboardPasteCount(pasteIndex);
    setSelectionSet(newSelections, newSelections[0] ?? null);
    reportSuccess("Pasted the copied selection with an offset.");
  }

  function createRectBounds(
    center: Vec2,
    widthM: number,
    heightM: number,
  ): ViewportBounds {
    return {
      minX: center.x - widthM / 2,
      maxX: center.x + widthM / 2,
      minY: center.y - heightM / 2,
      maxY: center.y + heightM / 2,
    };
  }

  function createCircularBounds(center: Vec2, radiusM: number): ViewportBounds {
    return createRectBounds(center, radiusM * 2, radiusM * 2);
  }

  function getSelectionBounds(): ViewportBounds | null {
    if (!currentSelection) {
      return null;
    }

    switch (currentSelection.kind) {
      case "node":
        return selectedNode ? createCircularBounds(selectedNode.position, 0.75) : null;
      case "wall": {
        if (!selectedWall) {
          return null;
        }

        const startNode = project.nodes.find((node) => node.id === selectedWall.startNodeId);
        const endNode = project.nodes.find((node) => node.id === selectedWall.endNodeId);
        if (!startNode || !endNode) {
          return null;
        }

        return createViewportBoundsFromPoints([startNode.position, endNode.position]);
      }
      case "door": {
        if (!selectedDoor) {
          return null;
        }

        const endpoints = getDoorWorldEndpoints(project, selectedDoor);
        return endpoints
          ? createViewportBoundsFromPoints([endpoints.start, endpoints.end])
          : null;
      }
      case "window": {
        if (!selectedWindow) {
          return null;
        }

        const endpoints = getWindowWorldEndpoints(project, selectedWindow);
        return endpoints
          ? createViewportBoundsFromPoints([endpoints.start, endpoints.end])
          : null;
      }
      case "measure":
        return selectedMeasurement
          ? createViewportBoundsFromPoints([selectedMeasurement.start, selectedMeasurement.end])
          : null;
      case "stair":
        return selectedStair
          ? createViewportBoundsFromPoints(selectedStair.pathNodes)
          : null;
      case "shape":
        if (!selectedShape) {
          return null;
        }

        return createRectBounds(
          selectedShape.pose.position,
          selectedShape.sizeM,
          selectedShape.sizeM,
        );
      case "slab":
        if (!selectedSlab) {
          return null;
        }

        return selectedSlab.kind === "Freeform"
          ? createViewportBoundsFromPoints(getSlabWorldPolygon(selectedSlab))
          : createRectBounds(
              selectedSlab.pose.position,
              selectedSlab.widthM,
              selectedSlab.depthM,
            );
      case "groundSurface":
        if (!selectedGroundSurface) {
          return null;
        }

        return createRectBounds(
          selectedGroundSurface.pose.position,
          selectedGroundSurface.widthM,
          selectedGroundSurface.depthM,
        );
      case "room":
        return selectedRoom ? createViewportBoundsFromPoints(selectedRoom.polygon) : null;
      case "roofEdge": {
        const sketch = project.roofSketches.find((candidate) =>
          candidate.edges.some((edge) => edge.id === currentSelection.id),
        );
        const edge = sketch?.edges.find((candidate) => candidate.id === currentSelection.id);
        const startVertex =
          sketch && edge
            ? sketch.vertices.find((vertex) => vertex.id === edge.startVertexId)
            : null;
        const endVertex =
          sketch && edge
            ? sketch.vertices.find((vertex) => vertex.id === edge.endVertexId)
            : null;
        return startVertex && endVertex
          ? createViewportBoundsFromPoints([startVertex.position, endVertex.position])
          : null;
      }
      case "roofVertex":
        return selectedRoofVertex ? createCircularBounds(selectedRoofVertex.position, 0.45) : null;
      case "roofFace": {
        const sketch = project.roofSketches.find((candidate) =>
          candidate.faces.some((face) => face.id === currentSelection.id),
        );
        const face = sketch?.faces.find((candidate) => candidate.id === currentSelection.id);
        if (!sketch || !face) {
          return null;
        }

        const vertexById = new Map(sketch.vertices.map((vertex) => [vertex.id, vertex] as const));
        const points = face.vertexIds
          .map((vertexId) => vertexById.get(vertexId)?.position ?? null)
          .filter((point): point is Vec2 => point !== null);
        return points.length >= 3 ? createViewportBoundsFromPoints(points) : null;
      }
      case "roofOpening": {
        const opening = project.roofOpenings.find((candidate) => candidate.id === currentSelection.id);
        if (!opening) {
          return null;
        }

        const widthM = opening.rotationDeg === 90 ? opening.widthM : opening.heightM;
        const heightM = opening.rotationDeg === 90 ? opening.heightM : opening.widthM;
        return createRectBounds(opening.center, widthM, heightM);
      }
      case "solarPanelArray":
        return selectedSolarPanelArray
          ? createCircularBounds(selectedSolarPanelArray.center, 1)
          : null;
      case "externalModel":
        return selectedExternalModel
          ? createCircularBounds(selectedExternalModel.position, 0.8)
          : null;
    }
  }

  function getActiveLevelBounds(): ViewportBounds | null {
    if (!activeLevelId) {
      return null;
    }

    let bounds: ViewportBounds | null = null;
    const levelNodes = project.nodes.filter((node) => node.levelId === activeLevelId);
    const nodeById = new Map(levelNodes.map((node) => [node.id, node] as const));

    if (levelNodes.length > 0) {
      bounds = mergeViewportBounds(
        bounds,
        createViewportBoundsFromPoints(levelNodes.map((node) => node.position)),
      );
    }

    for (const wall of project.walls.filter((item) => item.levelId === activeLevelId)) {
      const startNode = nodeById.get(wall.startNodeId);
      const endNode = nodeById.get(wall.endNodeId);
      if (!startNode || !endNode) {
        continue;
      }

      bounds = mergeViewportBounds(
        bounds,
        createViewportBoundsFromPoints([startNode.position, endNode.position]),
      );
    }

    for (const shape of project.shapes.filter((item) => item.levelId === activeLevelId)) {
      bounds = mergeViewportBounds(
        bounds,
        createRectBounds(shape.pose.position, shape.sizeM, shape.sizeM),
      );
    }

    for (const slab of project.slabs.filter((item) => item.levelId === activeLevelId)) {
      bounds = mergeViewportBounds(
        bounds,
        slab.kind === "Freeform"
          ? createViewportBoundsFromPoints(getSlabWorldPolygon(slab))
          : createRectBounds(slab.pose.position, slab.widthM, slab.depthM),
      );
    }

    for (const groundSurface of project.groundSurfaces) {
      bounds = mergeViewportBounds(
        bounds,
        createRectBounds(groundSurface.pose.position, groundSurface.widthM, groundSurface.depthM),
      );
    }

    for (const room of project.rooms.filter((item) => item.levelId === activeLevelId)) {
      bounds = mergeViewportBounds(bounds, createViewportBoundsFromPoints(room.polygon));
    }

    for (const model of project.externalModels.filter((item) => item.levelId === activeLevelId)) {
      bounds = mergeViewportBounds(bounds, createCircularBounds(model.position, 0.8));
    }

    for (const door of project.doors) {
      const endpoints = getDoorWorldEndpoints(project, door);
      if (!endpoints || endpoints.wall.levelId !== activeLevelId) {
        continue;
      }

      bounds = mergeViewportBounds(
        bounds,
        createViewportBoundsFromPoints([endpoints.start, endpoints.end]),
      );
    }

    for (const windowOpening of project.windows) {
      const endpoints = getWindowWorldEndpoints(project, windowOpening);
      if (!endpoints || endpoints.wall.levelId !== activeLevelId) {
        continue;
      }

      bounds = mergeViewportBounds(
        bounds,
        createViewportBoundsFromPoints([endpoints.start, endpoints.end]),
      );
    }

    for (const stair of project.stairs.filter((item) => item.levelId === activeLevelId)) {
      bounds = mergeViewportBounds(
        bounds,
        createViewportBoundsFromPoints(stair.pathNodes),
      );
    }

    return bounds;
  }

  function applyViewportBoundsFit(bounds: ViewportBounds | null, message: string) {
    if (!bounds) {
      reportError("Nothing visible is available for this fit action.");
      return;
    }

    if (viewportFrame.widthPx <= 0 || viewportFrame.heightPx <= 0) {
      reportError("Viewport frame is not ready yet.");
      return;
    }

    const fit = getViewportFit(
      expandViewportBounds(bounds, 0.8),
      viewportFrame,
      project.settings.pixelsPerMeter,
    );
    setZoom(fit.zoom);
    setPan(fit.pan);
    reportSuccess(message);
  }

  function handleFitSelection() {
    applyViewportBoundsFit(getSelectionBounds(), "Fitted viewport to current selection.");
  }

  function handleFitActiveLevel() {
    applyViewportBoundsFit(
      getActiveLevelBounds(),
      `Fitted viewport to ${activeLevelName}.`,
    );
  }

  function handleSaveViewportPreset(presetId: string, label: string) {
    saveViewportPreset(presetId);
    reportSuccess(`Saved ${label.toLowerCase()} from the current viewport.`);
  }

  function handleApplyViewportPreset(presetId: string, label: string) {
    const preset = viewportPresets.find((item) => item.id === presetId);
    if (!preset?.viewport) {
      reportError(`${label} is empty.`);
      return;
    }

    applyViewportPreset(presetId);
    reportSuccess(`Loaded ${label.toLowerCase()} into the viewport.`);
  }

  function handleClearViewportPreset(presetId: string, label: string) {
    clearViewportPreset(presetId);
    reportSuccess(`Cleared ${label.toLowerCase()}.`);
  }

  function handleUndo() {
    if (!canUndo || isHistoryTransactionOpen) {
      return;
    }

    undo();
    reportSuccess("Undid the last editor change.");
  }

  function handleRedo() {
    if (!canRedo || isHistoryTransactionOpen) {
      return;
    }

    redo();
    reportSuccess("Redid the next editor change.");
  }

  function handleMoveInteractionStart() {
    beginHistoryTransaction("move-drag");
  }

  function handleMoveInteractionCommit() {
    commitHistoryTransaction();
  }

  function handleMoveInteractionCancel() {
    cancelHistoryTransaction();
    reportSuccess("Canceled the active move drag.");
  }

  async function handleImportFile(file: File) {
    try {
      const result = importProjectJson(await file.text());
      reportSuccess(
        result.warnings.length > 0
          ? `Imported "${file.name}" with ${result.warnings.length} migration warning(s).`
          : `Imported "${file.name}" successfully.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown import failure.";
      reportError(message);
    }
  }

  async function handleLoadBuiltInSample() {
    try {
      const response = await fetch(BUILT_IN_SAMPLE_URL, { cache: "no-cache" });
      if (!response.ok) {
        throw new Error(`Sample project could not be loaded (${response.status}).`);
      }

      const result = importProjectJson(await response.text());
      reportSuccess(
        result.warnings.length > 0
          ? `Loaded built-in sample with ${result.warnings.length} migration warning(s).`
          : "Loaded the built-in sample project.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Built-in sample load failed.";
      reportError(message);
    }
  }

  async function handleImportChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    await handleImportFile(file);
    event.target.value = "";
  }

  function handleExport() {
    try {
      const blob = createProjectFileBlob(project);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = toProjectFileName(project.projectName);
      anchor.click();
      URL.revokeObjectURL(url);
      markSaved();
      reportSuccess("Exported the current project to local JSON.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown export failure.";
      reportError(message);
    }
  }

  function handleTogglePreviewMode() {
    setViewportMode(viewportMode === "2d" ? "3d" : "2d");
    setIsPreviewMenuOpen(false);
  }

  function handleOpenPreviewInNewTab() {
    const snapshot = createPreviewWindowSnapshot(
      stringifyProject(project),
      preview3D,
      hiddenLevelIds3D,
      hiddenRoofLayerIds3D,
    );
    writePreviewWindowSnapshot(snapshot);
    window.open(createPreviewWindowUrl(window.location.href), "_blank", "noopener,noreferrer");
    setIsPreviewMenuOpen(false);
    reportSuccess("Opened the 3D preview in a new tab.");
  }

  function setFloatingWindowPosition(id: FloatingWindowId, position: FloatingWindowPosition) {
    setFloatingWindowPositions((current) => ({
      ...current,
      [id]: position,
    }));
  }

  function toggleFloatingWindow(id: FloatingWindowId) {
    setFloatingWindowVisibility((current) => ({
      ...current,
      [id]: !current[id],
    }));
  }

  function handleSetRoofToolStartElevation(nextValue: number) {
    if (!Number.isFinite(nextValue)) {
      return;
    }

    setRoofToolStartElevationM(nextValue);
    if (roofToolEndElevationLocked) {
      setRoofToolEndElevationM(nextValue);
    }
  }

  function handleSetRoofToolEndElevation(nextValue: number) {
    if (Number.isFinite(nextValue)) {
      setRoofToolEndElevationM(nextValue);
    }
  }

  function handleToggleRoofToolEndElevationLock() {
    setRoofToolEndElevationLocked((current) => {
      const nextLocked = !current;
      if (nextLocked) {
        setRoofToolEndElevationM(roofToolStartElevationM);
      }
      return nextLocked;
    });
  }

  function handleCreateNode() {
    if (!activeLevelId) {
      reportError("Select an active level before creating a node.");
      return;
    }

    try {
      applyCommand((current) =>
        createNode(current, {
          levelId: activeLevelId,
          position: createVec2(recentNodesOnActiveLevel.length * 1.5, 0),
        }),
      );
      reportSuccess("Created a node through the command layer.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Node create failed.";
      reportError(message);
    }
  }

  function handleCreateNodeAt(position: { x: number; y: number }) {
    if (!activeLevelId) {
      reportError("Select an active level before creating a node.");
      return;
    }

    try {
      applyCommand((current) =>
        createNode(current, {
          levelId: activeLevelId,
          position: createVec2(position.x, position.y),
        }),
      );
      reportSuccess(
        `Created a node at ${formatNumber(position.x)}, ${formatNumber(position.y)}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Node create failed.";
      reportError(message);
    }
  }

  function handleInsertNodeIntoWall(wallId: string, position: Vec2) {
    try {
      applyCommand((current) => insertNodeIntoWall(current, wallId, createVec2(position.x, position.y)));
      reportSuccess(
        `Inserted a node into the wall at ${formatNumber(position.x)}, ${formatNumber(position.y)}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wall split failed.";
      reportError(message);
    }
  }

  function handleCreateDoorOnWall(wallId: string, position: Vec2) {
    try {
      applyCommand((current) =>
        createDoor(current, {
          wallId,
          position: createVec2(position.x, position.y),
          widthM: doorToolWidthM,
          heightM: doorToolHeightM,
        }),
      );
      reportSuccess(
        `Placed a door opening at ${formatNumber(position.x)}, ${formatNumber(position.y)}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Door create failed.";
      reportError(message);
    }
  }

  function handleCreateWindowOnWall(wallId: string, position: Vec2) {
    try {
      applyCommand((current) =>
        createWindow(current, {
          wallId,
          position: createVec2(position.x, position.y),
          widthM: windowToolWidthM,
          heightM: windowToolHeightM,
          sillHeightM: windowToolSillHeightM,
        }),
      );
      reportSuccess(
        `Placed a window opening at ${formatNumber(position.x)}, ${formatNumber(position.y)}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Window create failed.";
      reportError(message);
    }
  }

  function handleCreateMeasurement(start: Vec2, end: Vec2, unit: MeasurementUnit) {
    if (!activeLevelId) {
      reportError("Select an active level before creating a measurement.");
      return;
    }

    try {
      applyCommand((current) =>
        createMeasurement(current, {
          levelId: activeLevelId,
          start: createVec2(start.x, start.y),
          end: createVec2(end.x, end.y),
          unit,
        }),
      );
      reportSuccess("Created a permanent 2D measurement.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Measurement create failed.";
      reportError(message);
    }
  }

  function handleCreateStair(pathNodes: Vec2[]) {
    if (!activeLevelId || !activeLevel) {
      reportError("Select an active level before creating stairs.");
      return;
    }

    try {
      applyCommand((current) =>
        createStair(current, {
          levelId: activeLevelId,
          name: `stairs_${current.stairs.length + 1}`,
          pathNodes,
          widthM: stairToolWidthM,
          endElevationM: activeLevel.elevationM + stairToolEndElevationOffsetM,
          riserHeightM: stairToolRiserHeightM,
          treadDepthM: stairToolTreadDepthM,
          landingLengthM: stairToolLandingLengthM,
        }),
      );
      reportSuccess(`Created stair path with ${pathNodes.length} node(s).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stair create failed.";
      reportError(message);
    }
  }

  function handleDeleteNode(nodeId: string) {
    try {
      applyCommand((current) => deleteNode(current, nodeId));
      if (currentSelection?.kind === "node" && currentSelection.id === nodeId) {
        removeSelectionEntry("node", nodeId);
      }
      reportSuccess("Deleted node and any connected walls.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Node delete failed.";
      reportError(message);
    }
  }

  function handleCreateWallBetweenNodes(startNodeId: string, endNodeId: string) {
    if (!activeLevelId || !activeWallTypeId) {
      reportError("Select an active level and wall type before creating a wall.");
      return;
    }

    try {
      applyCommand((current) =>
        createWall(current, {
          levelId: activeLevelId,
          wallTypeId: activeWallTypeId,
          topMode: newWallsFollowRoof ? "FollowRoof" : "FixedHeight",
          startNodeId,
          endNodeId,
        }),
      );
      reportSuccess("Created a wall between the selected nodes.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wall command failed.";
      reportError(message);
    }
  }

  function handleCreateWallByDrag(input: { start: WallDragAnchor; end: WallDragAnchor }) {
    if (!activeLevelId || !activeWallTypeId) {
      reportError("Select an active level and wall type before creating a wall.");
      return;
    }

    const levelId = activeLevelId;
    const wallTypeId = activeWallTypeId;

    try {
      applyCommand((current) => {
        function appendOrSplitNode(projectState: Project, anchor: WallDragAnchor) {
          if (anchor.nodeId && projectState.nodes.some((node) => node.id === anchor.nodeId)) {
            return { project: projectState, nodeId: anchor.nodeId };
          }

          const targetWall =
            anchor.wallId && projectState.walls.some((wall) => wall.id === anchor.wallId)
              ? projectState.walls.find((wall) => wall.id === anchor.wallId) ?? null
              : findWallAtPoint(projectState, levelId, anchor.position, anchor.wallId);

          if (targetWall) {
            const nextProject = insertNodeIntoWall(
              projectState,
              targetWall.id,
              createVec2(anchor.position.x, anchor.position.y),
            );
            const insertedNode = nextProject.nodes.find(
              (node) => !projectState.nodes.some((previousNode) => previousNode.id === node.id),
            );
            if (!insertedNode) {
              throw new Error("Inserted wall split node could not be resolved.");
            }

            return { project: nextProject, nodeId: insertedNode.id };
          }

          const nextProject = createNode(projectState, {
            levelId,
            position: createVec2(anchor.position.x, anchor.position.y),
          });
          const createdNode = nextProject.nodes.find(
            (node) => !projectState.nodes.some((previousNode) => previousNode.id === node.id),
          );
          if (!createdNode) {
            throw new Error("Created wall endpoint node could not be resolved.");
          }

          return { project: nextProject, nodeId: createdNode.id };
        }

        const startResult = appendOrSplitNode(current, input.start);
        const endResult = appendOrSplitNode(startResult.project, input.end);

        return createWall(endResult.project, {
          levelId,
          wallTypeId,
          topMode: newWallsFollowRoof ? "FollowRoof" : "FixedHeight",
          startNodeId: startResult.nodeId,
          endNodeId: endResult.nodeId,
        });
      });
      reportSuccess("Created a wall from the drag gesture.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wall drag create failed.";
      reportError(message);
    }
  }

  function handleDeleteWall(wallId: string) {
    try {
      applyCommand((current) => {
        const nextProject = deleteWall(current, wallId);
        return wallAuthoringMode === "AutoWall" ? pruneOrphanNodes(nextProject) : nextProject;
      });
      if (currentSelection?.kind === "wall" && currentSelection.id === wallId) {
        removeSelectionEntry("wall", wallId);
      }
      reportSuccess("Deleted wall.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wall delete failed.";
      reportError(message);
    }
  }

  function handleDeleteDoor(doorId: string) {
    try {
      applyCommand((current) => deleteDoor(current, doorId));
      if (currentSelection?.kind === "door" && currentSelection.id === doorId) {
        removeSelectionEntry("door", doorId);
      }
      reportSuccess("Deleted door opening.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Door delete failed.";
      reportError(message);
    }
  }

  function handleDeleteWindow(windowId: string) {
    try {
      applyCommand((current) => deleteWindow(current, windowId));
      if (currentSelection?.kind === "window" && currentSelection.id === windowId) {
        removeSelectionEntry("window", windowId);
      }
      reportSuccess("Deleted window opening.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Window delete failed.";
      reportError(message);
    }
  }

  function handleDeleteRoofOpening(roofOpeningId: string) {
    try {
      applyCommand((current) => deleteRoofOpening(current, roofOpeningId));
      if (currentSelection?.kind === "roofOpening" && currentSelection.id === roofOpeningId) {
        removeSelectionEntry("roofOpening", roofOpeningId);
      }
      reportSuccess("Deleted roof window opening.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Roof window delete failed.";
      reportError(message);
    }
  }

  function createCurrentWindow3DDesign(): WindowDesign3D {
    return {
      glassThicknessM: window3DGlassThicknessM,
      frameThicknessM: window3DFrameThicknessM,
      frameColorHex: window3DFrameColorHex,
      verticalDivisions: Math.max(0, Math.round(window3DVerticalDivisions)),
      horizontalDivisions: Math.max(0, Math.round(window3DHorizontalDivisions)),
      wallDepthOffsetM: window3DWallDepthOffsetM,
    };
  }

  function createCurrentDoor3DDesign(): DoorDesign3D {
    return {
      kind: door3DKind,
      garageDoorStyle: door3DGarageDoorStyle,
      frameThicknessM: door3DFrameThicknessM,
      frameColorHex: door3DFrameColorHex,
      doorColorHex: door3DDoorColorHex,
      wallDepthOffsetM: door3DWallDepthOffsetM,
      openState: door3DOpenState,
      openPercent: door3DOpenPercent,
      hingeSide: door3DHingeSide,
      swingDirection: door3DSwingDirection,
    };
  }

  function createCurrentExternalShadingDesign(openingWidthM: number): ExternalShadingToolDesign {
    if (externalShadingKind === "ExternalBlinds") {
      return {
        kind: "ExternalBlinds",
        design: {
          ...externalBlindsToolDesign,
          blindWidthM: externalShadingFitOpeningWidth
            ? openingWidthM
            : externalBlindsToolDesign.blindWidthM,
          boxWidthM: externalShadingFitOpeningWidth
            ? openingWidthM
            : externalBlindsToolDesign.boxWidthM,
        },
      };
    }

    return {
      kind: "RollerShutter",
      design: {
        ...externalRollerShutterToolDesign,
        shutterWidthM: externalShadingFitOpeningWidth
          ? openingWidthM
          : externalRollerShutterToolDesign.shutterWidthM,
        boxWidthM: externalShadingFitOpeningWidth
          ? openingWidthM
          : externalRollerShutterToolDesign.boxWidthM,
      },
    };
  }

  function handleApplyDoor3DInsert(doorId: string) {
    try {
      const toolDesign = createCurrentDoor3DDesign();
      applyCommand((current) => {
        const currentDoor = current.doors.find((door) => door.id === doorId);
        const design3D: DoorDesign3D = {
          ...toolDesign,
          externalBlinds: currentDoor?.design3D?.externalBlinds ?? null,
          externalRollerShutter: currentDoor?.design3D?.externalRollerShutter ?? null,
        };
        return updateDoor(current, doorId, { design3D });
      });
      setSingleSelection({ kind: "door", id: doorId });
      reportSuccess("Inserted 3D door into the selected opening.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "3D door insert failed.";
      reportError(message);
    }
  }

  function handleRemoveDoor3DInsert(doorId: string) {
    try {
      applyCommand((current) => updateDoor(current, doorId, { design3D: null }));
      reportSuccess("Removed 3D door from the selected opening.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "3D door removal failed.";
      reportError(message);
    }
  }

  function handleApplyExternalShadingToDoor(doorId: string) {
    try {
      applyCommand((current) => {
        const door = current.doors.find((candidate) => candidate.id === doorId);
        if (!door) {
          throw new Error(`Door opening "${doorId}" does not exist.`);
        }

        const shading = createCurrentExternalShadingDesign(door.widthM);
        const baseDesign = door.design3D ?? createCurrentDoor3DDesign();
        return updateDoor(current, doorId, {
          design3D:
            shading.kind === "ExternalBlinds"
              ? {
                  ...baseDesign,
                  externalBlinds: shading.design,
                  externalRollerShutter: null,
                }
              : {
                  ...baseDesign,
                  externalBlinds: null,
                  externalRollerShutter: shading.design,
                },
        });
      });
      reportSuccess(
        externalShadingKind === "ExternalBlinds"
          ? "Applied external blinds to the door."
          : "Applied a roller shutter to the door.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "External shading failed.";
      reportError(message);
    }
  }

  function handleDeleteRoofEdge(roofEdgeId: string) {
    try {
      let removedFaceCount = 0;
      applyCommand((current) => {
        const sketch = current.roofSketches.find((candidate) =>
          candidate.edges.some((edge) => edge.id === roofEdgeId),
        );
        const edge = sketch?.edges.find((candidate) => candidate.id === roofEdgeId);
        if (!sketch || !edge) {
          throw new Error(`Roof line segment "${roofEdgeId}" does not exist.`);
        }

        const removedFaceIds = new Set(
          sketch.faces
            .filter(
              (face) =>
                face.edgeIds.includes(roofEdgeId) ||
                face.vertexIds.includes(edge.startVertexId) ||
                face.vertexIds.includes(edge.endVertexId),
            )
            .map((face) => face.id),
        );
        removedFaceCount = removedFaceIds.size;
        const remainingEdges = splitDisconnectedRoofChainEdges(
          sketch.edges.filter((candidate) => candidate.id !== roofEdgeId),
        );
        const remainingFaces = sketch.faces.filter((face) => !removedFaceIds.has(face.id));
        const referencedVertexIds = new Set([
          ...remainingEdges.flatMap((candidate) => [
            candidate.startVertexId,
            candidate.endVertexId,
          ]),
          ...remainingFaces.flatMap((face) => face.vertexIds),
        ]);
        const prunedVertices = sketch.vertices.filter((vertex) =>
          referencedVertexIds.has(vertex.id),
        );
        const remainingVertices = prunedVertices.length >= 2 ? prunedVertices : sketch.vertices;
        const remainingConstraints = sketch.constraints.filter((constraint) => {
          if (constraint.kind === "EdgeHeight") {
            return constraint.edgeId !== roofEdgeId;
          }
          if (constraint.kind === "FaceSlope") {
            return !removedFaceIds.has(constraint.faceId);
          }
          return referencedVertexIds.has(constraint.vertexId);
        });

        const updatedProject = updateRoofSketch(current, sketch.id, {
          vertices: remainingVertices,
          edges: remainingEdges,
          faces: remainingFaces,
          constraints: remainingConstraints,
        });

        return {
          ...updatedProject,
          roofOpenings: updatedProject.roofOpenings.filter(
            (opening) =>
              opening.roofSketchId !== sketch.id || !removedFaceIds.has(opening.roofFaceId),
          ),
        };
      });

      const nextSelectionSet = selectionSet.filter((selection) => {
        if (selection.kind === "roofEdge" && selection.id === roofEdgeId) {
          return false;
        }
        if (selection.kind === "roofFace" && currentSelection?.kind === "roofFace") {
          return false;
        }
        return true;
      });
      setSelectionSet(nextSelectionSet, nextSelectionSet[0] ?? null);
      reportSuccess(
        removedFaceCount > 0
          ? `Deleted roof line segment and ${removedFaceCount} dependent roof face(s).`
          : "Deleted roof line segment.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Roof line segment delete failed.";
      reportError(message);
    }
  }

  function handleSelectDoor3D(doorId: string) {
    const targetDoor = project.doors.find((doorOpening) => doorOpening.id === doorId);
    if (!targetDoor) {
      return;
    }

    setActiveTool("Door");
    setSingleSelection({ kind: "door", id: doorId });
    reportSuccess(`Selected door opening "${doorId}" for 3D editing.`);
  }

  function handleApplyWindow3DInsert(windowId: string) {
    try {
      const toolDesign = createCurrentWindow3DDesign();
      applyCommand((current) => {
        const currentWindow = current.windows.find((windowOpening) => windowOpening.id === windowId);
        const design3D: WindowDesign3D = {
          ...toolDesign,
          externalBlinds: currentWindow?.design3D?.externalBlinds ?? null,
          externalRollerShutter: currentWindow?.design3D?.externalRollerShutter ?? null,
        };
        return updateWindow(current, windowId, { design3D });
      });
      setSingleSelection({ kind: "window", id: windowId });
      reportSuccess("Inserted 3D window into the selected opening.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "3D window insert failed.";
      reportError(message);
    }
  }

  function handleRemoveWindow3DInsert(windowId: string) {
    try {
      applyCommand((current) => updateWindow(current, windowId, { design3D: null }));
      reportSuccess("Removed 3D window from the selected opening.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "3D window removal failed.";
      reportError(message);
    }
  }

  function handleApplyExternalShadingToWindow(windowId: string) {
    try {
      applyCommand((current) => {
        const windowOpening = current.windows.find((candidate) => candidate.id === windowId);
        if (!windowOpening) {
          throw new Error(`Window opening "${windowId}" does not exist.`);
        }

        const shading = createCurrentExternalShadingDesign(windowOpening.widthM);
        const baseDesign = windowOpening.design3D ?? createCurrentWindow3DDesign();
        return updateWindow(current, windowId, {
          design3D:
            shading.kind === "ExternalBlinds"
              ? {
                  ...baseDesign,
                  externalBlinds: shading.design,
                  externalRollerShutter: null,
                }
              : {
                  ...baseDesign,
                  externalBlinds: null,
                  externalRollerShutter: shading.design,
                },
        });
      });
      reportSuccess(
        externalShadingKind === "ExternalBlinds"
          ? "Applied external blinds to the window."
          : "Applied a roller shutter to the window.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "External shading failed.";
      reportError(message);
    }
  }

  function handleSelectWindow3D(windowId: string) {
    const targetWindow = project.windows.find((windowOpening) => windowOpening.id === windowId);
    if (!targetWindow) {
      return;
    }

    setActiveTool("Window");
    setSingleSelection({ kind: "window", id: windowId });
    reportSuccess(`Selected window opening "${windowId}" for 3D editing.`);
  }

  function handleSelectRoofWindow3D(roofOpeningId: string) {
    const targetRoofOpening = project.roofOpenings.find(
      (roofOpening) => roofOpening.id === roofOpeningId,
    );
    if (!targetRoofOpening) {
      return;
    }

    setActiveTool("RoofWindow");
    setSingleSelection({ kind: "roofOpening", id: roofOpeningId });
    reportSuccess(`Selected roof window opening "${roofOpeningId}" for 3D editing.`);
  }

  function handleApplyRoofWindow3DInsert(roofOpeningId: string) {
    try {
      const design3D = createCurrentWindow3DDesign();
      applyCommand((current) => updateRoofOpening(current, roofOpeningId, { design3D }));
      setSingleSelection({ kind: "roofOpening", id: roofOpeningId });
      reportSuccess("Inserted 3D skylight into the selected roof opening.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "3D skylight insert failed.";
      reportError(message);
    }
  }

  function handleRemoveRoofWindow3DInsert(roofOpeningId: string) {
    try {
      applyCommand((current) => updateRoofOpening(current, roofOpeningId, { design3D: null }));
      reportSuccess("Removed 3D skylight from the selected roof opening.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "3D skylight removal failed.";
      reportError(message);
    }
  }

  function handleCreateSolarPanelArray(input: {
    roofSketchId: string;
    roofFaceId: string;
    center: Vec2;
  }) {
    try {
      const id = createId("solar_array");
      applyCommand((current) =>
        createSolarPanelArray(current, {
          id,
          ...input,
          ...solarPanelToolDesign,
        }),
      );
      setSingleSelection({ kind: "solarPanelArray", id });
      reportSuccess(
        `Placed ${solarPanelToolDesign.rows} x ${solarPanelToolDesign.columns} solar panel array.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Solar panel placement failed.";
      reportError(message);
    }
  }

  function handleSelectSolarPanelArray(solarPanelArrayId: string) {
    if (!project.solarPanelArrays.some((array) => array.id === solarPanelArrayId)) {
      return;
    }

    setActiveTool("SolarPanels");
    setSingleSelection({ kind: "solarPanelArray", id: solarPanelArrayId });
    reportSuccess(`Selected solar panel array "${solarPanelArrayId}".`);
  }

  function handleMoveSolarPanelArray(solarPanelArrayId: string, center: Vec2) {
    try {
      applyCommand((current) => updateSolarPanelArray(current, solarPanelArrayId, { center }));
      reportSuccess("Moved solar panel array on its roof plane.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Solar panel move failed.";
      reportError(message);
    }
  }

  function handleCommitSolarPanelToolDesign(
    patch: Partial<SolarPanelToolDesign>,
    message: string,
  ) {
    try {
      if (selectedSolarPanelArray) {
        applyCommand((current) =>
          updateSolarPanelArray(current, selectedSolarPanelArray.id, patch),
        );
      } else {
        setSolarPanelToolDesign((current) => ({ ...current, ...patch }));
      }
      reportSuccess(message);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Solar panel update failed.";
      reportError(errorMessage);
    }
  }

  function handleDeleteSolarPanelArray(solarPanelArrayId: string) {
    try {
      applyCommand((current) => deleteSolarPanelArray(current, solarPanelArrayId));
      if (
        currentSelection?.kind === "solarPanelArray" &&
        currentSelection.id === solarPanelArrayId
      ) {
        clearSelection();
      }
      reportSuccess("Deleted solar panel array.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Solar panel delete failed.";
      reportError(message);
    }
  }

  function handleToggleSolarPanels2D() {
    applyCommand((current) =>
      updateProjectSettings(current, {
        showSolarPanels2D: !current.settings.showSolarPanels2D,
      }),
    );
    reportSuccess(
      project.settings.showSolarPanels2D
        ? "Solar panels hidden from the 2D plan."
        : "Solar panels shown in the 2D plan.",
    );
  }

  function handleClear3DOpeningSelection() {
    if (
      currentSelection?.kind !== "window" &&
      currentSelection?.kind !== "door" &&
      currentSelection?.kind !== "roofOpening" &&
      currentSelection?.kind !== "solarPanelArray"
    ) {
      return;
    }

    clearSelection();
  }

  function handleDeleteMeasurement(measurementId: string) {
    try {
      applyCommand((current) => deleteMeasurement(current, measurementId));
      reportSuccess("Deleted the measurement.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Measurement delete failed.";
      reportError(message);
    }
  }

  function handleDeleteStair(stairId: string) {
    try {
      applyCommand((current) => deleteStair(current, stairId));
      if (currentSelection?.kind === "stair" && currentSelection.id === stairId) {
        removeSelectionEntry("stair", stairId);
      }
      reportSuccess("Deleted stair.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stair delete failed.";
      reportError(message);
    }
  }

  function handleDeleteWallsConnectedToNode(nodeId: string) {
    try {
      const connectedWalls = project.walls.filter(
        (wall) => wall.startNodeId === nodeId || wall.endNodeId === nodeId,
      );

      if (connectedWalls.length === 0) {
        reportSuccess("This node has no connected walls to delete.");
        return;
      }

      applyCommand((current) => {
        const nextProject = deleteWallsConnectedToNode(current, nodeId);
        return wallAuthoringMode === "AutoWall" ? pruneOrphanNodes(nextProject) : nextProject;
      });
      if (
        currentSelection?.kind === "wall" &&
        connectedWalls.some((wall) => wall.id === currentSelection.id)
      ) {
        removeSelectionEntry("wall", currentSelection.id);
      }
      reportSuccess(`Deleted ${connectedWalls.length} wall(s) connected to the selected node.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Connected wall delete failed.";
      reportError(message);
    }
  }

  function handleMoveNode(nodeId: string, position: Vec2) {
    try {
      applyCommand((current) => moveNode(current, nodeId, createVec2(position.x, position.y)));
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Node move failed.";
      reportError(message);
    }
  }

  function handleMoveShape(shapeId: string, position: Vec2) {
    try {
      applyCommand((current) => {
        const shape = current.shapes.find((item) => item.id === shapeId);
        if (!shape) {
          throw new Error(`Shape "${shapeId}" does not exist.`);
        }

        return updateShape(current, shapeId, {
          pose: {
            ...shape.pose,
            position: createVec2(position.x, position.y),
          },
        });
      });
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Shape move failed.";
      reportError(message);
    }
  }

  function handleMoveSlab(slabId: string, position: Vec2) {
    try {
      applyCommand((current) => {
        const slab = current.slabs.find((item) => item.id === slabId);
        if (!slab) {
          throw new Error(`Slab "${slabId}" does not exist.`);
        }

        return updateSlab(current, slabId, {
          pose: {
            ...slab.pose,
            position: createVec2(position.x, position.y),
          },
        });
      });
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Slab move failed.";
      reportError(message);
    }
  }

  function handleMoveGroundSurface(groundSurfaceId: string, position: Vec2) {
    try {
      applyCommand((current) => {
        const groundSurface = current.groundSurfaces.find((item) => item.id === groundSurfaceId);
        if (!groundSurface) {
          throw new Error(`Ground surface "${groundSurfaceId}" does not exist.`);
        }

        return updateGroundSurface(current, groundSurfaceId, {
          pose: {
            ...groundSurface.pose,
            position: createVec2(position.x, position.y),
          },
        });
      });
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ground surface move failed.";
      reportError(message);
    }
  }

  function handleMoveRoom(roomId: string, position: Vec2) {
    try {
      applyCommand((current) => {
        const room = current.rooms.find((item) => item.id === roomId);
        if (!room) {
          throw new Error(`Room "${roomId}" does not exist.`);
        }

        const center = getPolygonCenter(room.polygon);
        const delta = createVec2(position.x - center.x, position.y - center.y);
        return updateRoom(current, roomId, {
          polygon: room.polygon.map((point) => createVec2(point.x + delta.x, point.y + delta.y)),
        });
      });
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Room move failed.";
      reportError(message);
    }
  }

  function handleResizeSlab(
    slabId: string,
    patch: { position: Vec2; widthM: number; depthM: number },
  ) {
    try {
      applyCommand((current) => {
        const slab = current.slabs.find((item) => item.id === slabId);
        if (!slab) {
          throw new Error(`Slab "${slabId}" does not exist.`);
        }

        return updateSlab(current, slabId, {
          pose: {
            ...slab.pose,
            position: createVec2(patch.position.x, patch.position.y),
          },
          widthM: patch.widthM,
          depthM: patch.depthM,
        });
      });
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Slab resize failed.";
      reportError(message);
    }
  }

  function handleUpdateSlabPolygon(slabId: string, polygon: Vec2[]) {
    try {
      const dimensions = getPolygonDimensions(polygon);
      applyCommand((current) =>
        updateSlab(current, slabId, {
          polygon,
          widthM: Math.max(dimensions.widthM, 0.01),
          depthM: Math.max(dimensions.depthM, 0.01),
        }),
      );
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Slab vertex move failed.";
      reportError(message);
    }
  }

  function handleMoveRoofEdge(roofEdgeId: string, position: Vec2) {
    try {
      applyCommand((current) => {
        const sketch = current.roofSketches.find((candidate) =>
          candidate.edges.some((edge) => edge.id === roofEdgeId),
        );
        const edge = sketch?.edges.find((candidate) => candidate.id === roofEdgeId);
        if (!sketch || !edge) {
          throw new Error(`Roof line "${roofEdgeId}" does not exist.`);
        }

        const startVertex = sketch.vertices.find((vertex) => vertex.id === edge.startVertexId);
        const endVertex = sketch.vertices.find((vertex) => vertex.id === edge.endVertexId);
        if (!startVertex || !endVertex) {
          throw new Error(`Roof line "${roofEdgeId}" has missing vertices.`);
        }

        const currentMidpoint = createVec2(
          (startVertex.position.x + endVertex.position.x) / 2,
          (startVertex.position.y + endVertex.position.y) / 2,
        );
        const delta = createVec2(position.x - currentMidpoint.x, position.y - currentMidpoint.y);
        if (Math.hypot(delta.x, delta.y) < 0.0001) {
          return current;
        }

        const movedVertexIds = new Set([edge.startVertexId, edge.endVertexId]);
        return updateRoofSketch(current, sketch.id, {
          vertices: sketch.vertices.map((vertex) =>
            movedVertexIds.has(vertex.id)
              ? {
                  ...vertex,
                  position: createVec2(
                    vertex.position.x + delta.x,
                    vertex.position.y + delta.y,
                  ),
                }
              : vertex,
          ),
        });
      });
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Roof line move failed.";
      reportError(message);
    }
  }

  function handleMoveRoofVertex(roofSketchId: string, roofVertexId: string, position: Vec2) {
    try {
      applyCommand((current) => {
        const sketch = current.roofSketches.find((candidate) => candidate.id === roofSketchId);
        const vertex = sketch?.vertices.find((candidate) => candidate.id === roofVertexId);
        if (!sketch || !vertex) {
          throw new Error(`Roof vertex "${roofVertexId}" does not exist.`);
        }

        if (Math.hypot(vertex.position.x - position.x, vertex.position.y - position.y) < 0.0001) {
          return current;
        }

        return updateRoofSketch(current, roofSketchId, {
          vertices: sketch.vertices.map((candidate) =>
            candidate.id === roofVertexId
              ? {
                  ...candidate,
                  position: createVec2(position.x, position.y),
                }
              : candidate,
          ),
        });
      });
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Roof line endpoint move failed.";
      reportError(message);
    }
  }

  function handleMoveRoofOpening(roofOpeningId: string, position: Vec2) {
    try {
      applyCommand((current) =>
        updateRoofOpening(current, roofOpeningId, {
          center: createVec2(position.x, position.y),
        }),
      );
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Roof window move failed.";
      reportError(message);
    }
  }

  function handleUpdateSelectedRoofEdgeEndpointElevations(
    startElevationM: number,
    endElevationM: number,
    message = "Updated roof line endpoint elevations.",
  ) {
    if (
      !selectedRoofSketch ||
      !selectedRoofEdge ||
      !selectedRoofEdgeStartVertex ||
      !selectedRoofEdgeEndVertex
    ) {
      reportError("Select a roof line before editing its elevation.");
      return;
    }

    try {
      applyCommand((current) =>
        updateRoofSketch(current, selectedRoofSketch.id, {
          vertices: selectedRoofSketch.vertices.map((vertex) =>
            vertex.id === selectedRoofEdge.startVertexId
              ? {
                  ...vertex,
                  elevationMode: "Explicit",
                  elevationM: startElevationM,
                }
              : vertex.id === selectedRoofEdge.endVertexId
                ? {
                    ...vertex,
                    elevationMode: "Explicit",
                    elevationM: endElevationM,
                  }
              : vertex,
          ),
        }),
      );
      reportSuccess(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Roof line elevation update failed.";
      reportError(message);
    }
  }

  function handleUpdateSelectedRoofEdgeElevation(elevationM: number) {
    handleUpdateSelectedRoofEdgeEndpointElevations(
      elevationM,
      elevationM,
      `Updated roof line elevation to ${formatNumber(elevationM)} m.`,
    );
  }

  function handleUpdateSelectedRoofFaceThickness(thicknessM: number) {
    if (!selectedRoofFaceSketch || !selectedRoofFace) {
      reportError("Select a roof face before editing its thickness.");
      return;
    }

    if (!Number.isFinite(thicknessM) || thicknessM <= 0) {
      reportError("Roof face thickness must be greater than zero.");
      return;
    }

    try {
      applyCommand((current) =>
        updateRoofSketch(current, selectedRoofFaceSketch.id, {
          faces: selectedRoofFaceSketch.faces.map((face) =>
            face.id === selectedRoofFace.id
              ? {
                  ...face,
                  thicknessM,
                }
              : face,
          ),
        }),
      );
      reportSuccess(`Updated roof face thickness to ${formatNumber(thicknessM)} m.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Roof face thickness update failed.";
      reportError(message);
    }
  }

  function handleMoveExternalModel(modelId: string, position: Vec2) {
    try {
      applyCommand((current) =>
        updateExternalModel(current, modelId, {
          position: createVec2(position.x, position.y),
        }),
      );
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "External model move failed.";
      reportError(message);
    }
  }

  function handleMoveDoor(doorId: string, position: Vec2) {
    try {
      const door = project.doors.find((item) => item.id === doorId);
      if (!door) {
        throw new Error(`Door "${doorId}" does not exist.`);
      }

      const nextOffsetM = getWallOpeningOffsetFromPosition(project, door.wallId, position);
      if (nextOffsetM === null) {
        throw new Error(`Door "${doorId}" cannot resolve its host wall geometry.`);
      }

      applyCommand((current) => updateDoor(current, doorId, { offsetM: nextOffsetM }));
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Door move failed.";
      reportError(message);
    }
  }

  function handleMoveWindow(windowId: string, position: Vec2) {
    try {
      const windowOpening = project.windows.find((item) => item.id === windowId);
      if (!windowOpening) {
        throw new Error(`Window "${windowId}" does not exist.`);
      }

      const nextOffsetM = getWallOpeningOffsetFromPosition(
        project,
        windowOpening.wallId,
        position,
      );
      if (nextOffsetM === null) {
        throw new Error(`Window "${windowId}" cannot resolve its host wall geometry.`);
      }

      applyCommand((current) => updateWindow(current, windowId, { offsetM: nextOffsetM }));
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Window move failed.";
      reportError(message);
    }
  }

  function handleDeleteShape(shapeId: string) {
    try {
      applyCommand((current) => deleteShape(current, shapeId));
      if (currentSelection?.kind === "shape" && currentSelection.id === shapeId) {
        removeSelectionEntry("shape", shapeId);
      }
      reportSuccess("Deleted shape.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Shape delete failed.";
      reportError(message);
    }
  }

  function handleDeleteSlab(slabId: string) {
    try {
      applyCommand((current) => deleteSlab(current, slabId));
      if (currentSelection?.kind === "slab" && currentSelection.id === slabId) {
        removeSelectionEntry("slab", slabId);
      }
      reportSuccess("Deleted slab.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Slab delete failed.";
      reportError(message);
    }
  }

  function handleDeleteGroundSurface(groundSurfaceId: string) {
    try {
      applyCommand((current) => deleteGroundSurface(current, groundSurfaceId));
      if (currentSelection?.kind === "groundSurface" && currentSelection.id === groundSurfaceId) {
        removeSelectionEntry("groundSurface", groundSurfaceId);
      }
      reportSuccess("Deleted ground surface.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ground surface delete failed.";
      reportError(message);
    }
  }

  function handleDeleteRoom(roomId: string) {
    try {
      applyCommand((current) => deleteRoom(current, roomId));
      if (currentSelection?.kind === "room" && currentSelection.id === roomId) {
        removeSelectionEntry("room", roomId);
      }
      reportSuccess("Deleted room.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Room delete failed.";
      reportError(message);
    }
  }

  function handleDeleteExternalModel(modelId: string) {
    try {
      applyCommand((current) => deleteExternalModel(current, modelId));
      if (currentSelection?.kind === "externalModel" && currentSelection.id === modelId) {
        removeSelectionEntry("externalModel", modelId);
      }
      reportSuccess("Deleted external model marker.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "External model delete failed.";
      reportError(message);
    }
  }

  function handleUpdateSelectedDoor(patch: Partial<DoorOpening>, message: string) {
    if (!selectedDoor) {
      return;
    }

    try {
      applyCommand((current) => updateDoor(current, selectedDoor.id, patch));
      reportSuccess(message);
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Door update failed.";
      reportError(nextMessage);
    }
  }

  function handleUpdateSelectedWindow(patch: Partial<WindowOpening>, message: string) {
    if (!selectedWindow) {
      return;
    }

    try {
      applyCommand((current) => updateWindow(current, selectedWindow.id, patch));
      reportSuccess(message);
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Window update failed.";
      reportError(nextMessage);
    }
  }

  function handleUpdateSelectedRoofOpening(
    patch: Parameters<typeof updateRoofOpening>[2],
    message: string,
  ) {
    if (!selectedRoofOpening) {
      return;
    }

    try {
      applyCommand((current) => updateRoofOpening(current, selectedRoofOpening.id, patch));
      reportSuccess(message);
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Roof window update failed.";
      reportError(nextMessage);
    }
  }

  function handleCommitWindow3DToolDesign(
    patch: Partial<WindowDesign3D>,
    message = "Updated 3D window design.",
  ) {
    if (selectedRoofOpening) {
      const nextDesign: WindowDesign3D = {
        ...(selectedRoofOpening.design3D ?? createCurrentWindow3DDesign()),
        ...patch,
      };

      handleUpdateSelectedRoofOpening({ design3D: nextDesign }, message);
      return;
    }

    if (!selectedWindow) {
      const nextDesign: WindowDesign3D = {
        ...createCurrentWindow3DDesign(),
        ...patch,
      };

      setWindow3DGlassThicknessM(nextDesign.glassThicknessM);
      setWindow3DFrameThicknessM(nextDesign.frameThicknessM);
      setWindow3DFrameColorHex(nextDesign.frameColorHex);
      setWindow3DVerticalDivisions(nextDesign.verticalDivisions);
      setWindow3DHorizontalDivisions(nextDesign.horizontalDivisions);
      setWindow3DWallDepthOffsetM(nextDesign.wallDepthOffsetM);
      return;
    }

    const nextDesign: WindowDesign3D = {
      ...(selectedWindow.design3D ?? createCurrentWindow3DDesign()),
      ...patch,
    };

    handleUpdateSelectedWindow({ design3D: nextDesign }, message);
  }

  function handleCommitDoor3DToolDesign(
    patch: Partial<DoorDesign3D>,
    message = "Updated 3D door design.",
  ) {
    const normalizedPatch: Partial<DoorDesign3D> = {
      ...patch,
      ...(patch.openState !== undefined && patch.openPercent === undefined
        ? { openPercent: patch.openState === "Open" ? 100 : 0 }
        : {}),
      ...(patch.openPercent !== undefined && patch.openState === undefined
        ? { openState: patch.openPercent > 0 ? "Open" : "Closed" }
        : {}),
    };

    if (!selectedDoor) {
      const nextDesign: DoorDesign3D = {
        ...createCurrentDoor3DDesign(),
        ...normalizedPatch,
      };

      setDoor3DKind(nextDesign.kind);
      setDoor3DGarageDoorStyle(nextDesign.garageDoorStyle ?? "SinglePanel");
      setDoor3DFrameThicknessM(nextDesign.frameThicknessM);
      setDoor3DFrameColorHex(nextDesign.frameColorHex);
      setDoor3DDoorColorHex(nextDesign.doorColorHex);
      setDoor3DWallDepthOffsetM(nextDesign.wallDepthOffsetM);
      setDoor3DOpenState(nextDesign.openState);
      setDoor3DOpenPercent(nextDesign.openPercent);
      setDoor3DHingeSide(nextDesign.hingeSide);
      setDoor3DSwingDirection(nextDesign.swingDirection);
      return;
    }

    const nextDesign: DoorDesign3D = {
      ...(selectedDoor.design3D ?? createCurrentDoor3DDesign()),
      ...normalizedPatch,
    };

    handleUpdateSelectedDoor({ design3D: nextDesign }, message);
  }

  function handleUpdateSelectedStair(patch: Partial<Stair>, message: string) {
    if (!selectedStair) {
      return;
    }

    try {
      applyCommand((current) => updateStair(current, selectedStair.id, patch));
      reportSuccess(message);
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Stair update failed.";
      reportError(nextMessage);
    }
  }

  function handleUpdateSelectedShape(
    patch: Parameters<typeof updateShape>[2],
    message = "Updated shape inspector values.",
  ) {
    if (!selectedShape) {
      return;
    }

    try {
      applyCommand((current) => updateShape(current, selectedShape.id, patch));
      setErrorMessage(null);
      setActivityMessage(message);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Shape update failed.";
      reportError(text);
    }
  }

  function handleUpdateSelectedSlab(
    patch: Parameters<typeof updateSlab>[2],
    message = "Updated slab inspector values.",
  ) {
    if (!selectedSlab) {
      return;
    }

    try {
      applyCommand((current) => updateSlab(current, selectedSlab.id, patch));
      setErrorMessage(null);
      setActivityMessage(message);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Slab update failed.";
      reportError(text);
    }
  }

  function handleUpdateSelectedGroundSurface(
    patch: Parameters<typeof updateGroundSurface>[2],
    message = "Updated ground surface values.",
  ) {
    if (!selectedGroundSurface) {
      return;
    }

    try {
      applyCommand((current) => updateGroundSurface(current, selectedGroundSurface.id, patch));
      setErrorMessage(null);
      setActivityMessage(message);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ground surface update failed.";
      reportError(text);
    }
  }

  function handleUpdateSelectedRoom(
    patch: Parameters<typeof updateRoom>[2],
    message = "Updated room values.",
  ) {
    if (!selectedRoom) {
      return;
    }

    try {
      applyCommand((current) => updateRoom(current, selectedRoom.id, patch));
      setErrorMessage(null);
      setActivityMessage(message);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Room update failed.";
      reportError(text);
    }
  }

  function handleUpdateSelectedExternalModel(
    patch: Parameters<typeof updateExternalModel>[2],
    message = "Updated model inspector values.",
  ) {
    if (!selectedExternalModel) {
      return;
    }

    try {
      applyCommand((current) => updateExternalModel(current, selectedExternalModel.id, patch));
      setErrorMessage(null);
      setActivityMessage(message);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Model update failed.";
      reportError(text);
    }
  }

  function handleUpdateActiveLevel(
    patch: Parameters<typeof updateLevel>[2],
    message = "Updated active level.",
  ) {
    if (!activeLevel) {
      return;
    }

    try {
      applyCommand((current) => updateLevel(current, activeLevel.id, patch));
      setErrorMessage(null);
      setActivityMessage(message);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Level update failed.";
      reportError(text);
    }
  }

  function handleUpdateLevelById(
    levelId: string,
    patch: Parameters<typeof updateLevel>[2],
    message = "Updated level.",
  ) {
    try {
      applyCommand((current) => updateLevel(current, levelId, patch));
      setErrorMessage(null);
      setActivityMessage(message);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Level update failed.";
      reportError(text);
    }
  }

  function handleUpdateActiveWallType(
    patch: Parameters<typeof updateWallType>[2],
    message = "Updated active wall type.",
  ) {
    if (!activeWallType) {
      return;
    }

    try {
      applyCommand((current) => updateWallType(current, activeWallType.id, patch));
      setErrorMessage(null);
      setActivityMessage(message);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Wall type update failed.";
      reportError(text);
    }
  }

  function handleUpdateWallTypeById(
    wallTypeId: string,
    patch: Parameters<typeof updateWallType>[2],
    message = "Updated wall type.",
  ) {
    try {
      applyCommand((current) => updateWallType(current, wallTypeId, patch));
      setErrorMessage(null);
      setActivityMessage(message);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Wall type update failed.";
      reportError(text);
    }
  }

  function handleUpdateSelectedWall(
    patch: Parameters<typeof updateWall>[2],
    message = "Updated wall inspector values.",
  ) {
    if (!selectedWall) {
      return;
    }

    try {
      applyCommand((current) => updateWall(current, selectedWall.id, patch));
      setErrorMessage(null);
      setActivityMessage(message);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Wall update failed.";
      reportError(text);
    }
  }

  function handleCreateWall() {
    if (!activeLevelId || !activeWallTypeId) {
      reportError("Select an active level and wall type before creating a wall.");
      return;
    }

    if (recentNodesOnActiveLevel.length < 2) {
      reportError("Create at least two nodes on the active level before linking a wall.");
      return;
    }

    const [startNode, endNode] = recentNodesOnActiveLevel.slice(-2);
    try {
      applyCommand((current) =>
        createWall(current, {
          levelId: activeLevelId,
          wallTypeId: activeWallTypeId,
          topMode: newWallsFollowRoof ? "FollowRoof" : "FixedHeight",
          startNodeId: startNode.id,
          endNodeId: endNode.id,
        }),
      );
      reportSuccess("Linked the two most recent nodes with a wall command.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wall command failed.";
      reportError(message);
    }
  }

  function handleCreateShape() {
    if (!activeLevelId) {
      reportError("Select an active level before creating a shape.");
      return;
    }

    applyCommand((current) =>
      createShape(current, {
        levelId: activeLevelId,
        name: `shape_${current.shapes.length + 1}`,
        kind: shapeToolKind,
        pose: createPose2D(createVec2(current.shapes.length + 1, 1.25), 0),
        sizeM: 0.8,
        zStartM: shapeToolBottomM,
        heightM: Math.max(0.1, shapeToolTopM - shapeToolBottomM),
      }),
    );
    reportSuccess("Created a shape through the command layer.");
  }

  function handleCreateShapeAt(position: Vec2 & { sizeM?: number }) {
    if (!activeLevelId) {
      reportError("Select an active level before creating a shape.");
      return;
    }

    applyCommand((current) =>
      createShape(current, {
        levelId: activeLevelId,
        name: `shape_${current.shapes.length + 1}`,
        kind: shapeToolKind,
        pose: createPose2D(createVec2(position.x, position.y), 0),
        sizeM: position.sizeM ?? 0.8,
        zStartM: shapeToolBottomM,
        heightM: Math.max(0.1, shapeToolTopM - shapeToolBottomM),
      }),
    );
    reportSuccess(
      `Placed a shape at ${formatNumber(position.x)}, ${formatNumber(position.y)} with size ${formatNumber(position.sizeM ?? 0.8)}m.`,
    );
  }

  function handleCreateSlab() {
    if (!activeLevelId) {
      reportError("Select an active level before creating a slab.");
      return;
    }

    applyCommand((current) =>
      createSlab(current, {
        levelId: activeLevelId,
        name: `slab_${current.slabs.length + 1}`,
        kind: slabMode,
        roofType: "Flat",
        pose: createPose2D(createVec2(current.slabs.length + 1, -1.5), 0),
        widthM: 2.4,
        depthM: slabMode === "Circle" ? 2.4 : 1.8,
        thicknessM: 0.2,
        roofRiseM: 1.2,
        zOffsetM: 0,
      }),
    );
    reportSuccess("Created a slab through the command layer.");
  }

  function handleCreateSlabFromPolygon(worldPolygon: Vec2[]) {
    if (!activeLevelId || worldPolygon.length < 3) {
      reportError("Select an active level and close a slab outline with at least three points.");
      return;
    }

    let mergedSlabCount = 0;
    applyCommand((current) => {
      let mergedPolygon = worldPolygon;
      const mergedSlabIds = new Set<string>();

      if (slabConnectEnabled) {
        let mergedAnotherSlab = true;
        while (mergedAnotherSlab) {
          mergedAnotherSlab = false;
          for (const candidate of current.slabs) {
            if (
              mergedSlabIds.has(candidate.id) ||
              candidate.levelId !== activeLevelId ||
              candidate.kind === "Circle" ||
              candidate.roofType !== "Flat" ||
              Math.abs(candidate.thicknessM - 0.2) > 0.0001 ||
              Math.abs(candidate.zOffsetM) > 0.0001
            ) {
              continue;
            }

            const union = unionConnectedPolygons(
              mergedPolygon,
              getSlabWorldPolygon(candidate),
            );
            if (!union) {
              continue;
            }

            mergedPolygon = union;
            mergedSlabIds.add(candidate.id);
            mergedAnotherSlab = true;
          }
        }
      }

      mergedSlabCount = mergedSlabIds.size;
      const localized = createLocalPolygonFromWorld(mergedPolygon);
      const dimensions = getPolygonDimensions(mergedPolygon);
      const withoutMergedSlabs = {
        ...current,
        slabs: current.slabs.filter((slab) => !mergedSlabIds.has(slab.id)),
      };

      return createSlab(withoutMergedSlabs, {
        levelId: activeLevelId,
        name: `slab_${current.slabs.length + 1}`,
        kind: "Freeform",
        roofType: "Flat",
        pose: createPose2D(localized.center, 0),
        widthM: Math.max(dimensions.widthM, 0.01),
        depthM: Math.max(dimensions.depthM, 0.01),
        thicknessM: 0.2,
        roofRiseM: 1.2,
        zOffsetM: 0,
        polygon: localized.polygon,
        connectWithOtherSlabs: slabConnectEnabled,
      });
    });

    reportSuccess(
      mergedSlabCount > 0
        ? `Created a freeform slab and joined ${mergedSlabCount} connected slab(s).`
        : "Created a freeform slab.",
    );
  }

  function handleCreateSlabAt(position: Vec2 & { widthM?: number; depthM?: number }) {
    if (!activeLevelId) {
      reportError("Select an active level before creating a slab.");
      return;
    }

    if (slabMode === "Rectangle" && slabConnectEnabled) {
      const widthM = position.widthM ?? 2.4;
      const depthM = position.depthM ?? 1.8;
      handleCreateSlabFromPolygon([
        createVec2(position.x - widthM / 2, position.y - depthM / 2),
        createVec2(position.x + widthM / 2, position.y - depthM / 2),
        createVec2(position.x + widthM / 2, position.y + depthM / 2),
        createVec2(position.x - widthM / 2, position.y + depthM / 2),
      ]);
      return;
    }

    applyCommand((current) =>
      createSlab(current, {
        levelId: activeLevelId,
        name: `slab_${current.slabs.length + 1}`,
        kind: slabMode,
        roofType: "Flat",
        pose: createPose2D(createVec2(position.x, position.y), 0),
        widthM: position.widthM ?? 2.4,
        depthM:
          slabMode === "Circle"
            ? position.widthM ?? position.depthM ?? 2.4
            : position.depthM ?? 1.8,
        thicknessM: 0.2,
        roofRiseM: 1.2,
        zOffsetM: 0,
        connectWithOtherSlabs: slabConnectEnabled,
      }),
    );
    reportSuccess(
      `Placed a ${slabMode.toLowerCase()} slab at ${formatNumber(position.x)}, ${formatNumber(position.y)} with size ${formatNumber(position.widthM ?? 2.4)} x ${formatNumber(
        slabMode === "Circle"
          ? position.widthM ?? position.depthM ?? 2.4
          : position.depthM ?? 1.8,
      )}m.`,
    );
  }

  function handleCreateGroundSurfaceAt(position: Vec2 & { widthM?: number; depthM?: number }) {
    applyCommand((current) =>
      createGroundSurface(current, {
        name: `ground_${current.groundSurfaces.length + 1}`,
        kind: groundToolKind,
        pose: createPose2D(createVec2(position.x, position.y), 0),
        widthM: position.widthM ?? 2.4,
        depthM: position.depthM ?? 1.8,
      }),
    );
    reportSuccess(
      `Painted ${groundToolKind.toLowerCase()} ground at ${formatNumber(position.x)}, ${formatNumber(position.y)} with size ${formatNumber(position.widthM ?? 2.4)} x ${formatNumber(position.depthM ?? 1.8)}m.`,
    );
  }

  function handleCreateRoomFromPolygon(polygon: Vec2[]) {
    if (!activeLevelId) {
      reportError("Select an active level before creating a room.");
      return;
    }

    const areaM2 = calculatePolygonAreaM2(polygon);
    if (areaM2 < 0.05) {
      reportError("Room area is too small.");
      return;
    }

    let createdRoomId: string | null = null;
    let mergedRoomCount = 0;
    let finalAreaM2 = areaM2;
    applyCommand((current) => {
      let mergedPolygon = polygon;
      const mergedRoomIds = new Set<string>();

      if (roomConnectEnabled) {
        let mergedAnotherRoom = true;
        while (mergedAnotherRoom) {
          mergedAnotherRoom = false;
          for (const candidate of current.rooms) {
            if (
              mergedRoomIds.has(candidate.id) ||
              candidate.levelId !== activeLevelId
            ) {
              continue;
            }

            const union = unionConnectedPolygons(mergedPolygon, candidate.polygon);
            if (!union) {
              continue;
            }

            mergedPolygon = union;
            mergedRoomIds.add(candidate.id);
            mergedAnotherRoom = true;
          }
        }
      }

      mergedRoomCount = mergedRoomIds.size;
      finalAreaM2 = calculatePolygonAreaM2(mergedPolygon);
      const nextRoomName =
        roomToolName.trim().length > 0
          ? roomToolName.trim()
          : `Room ${current.rooms.length + 1}`;
      const withoutMergedRooms = {
        ...current,
        rooms: current.rooms.filter((room) => !mergedRoomIds.has(room.id)),
      };
      const nextProject = createRoom(withoutMergedRooms, {
        levelId: activeLevelId,
        name: nextRoomName,
        polygon: mergedPolygon,
      });
      createdRoomId = nextProject.rooms[nextProject.rooms.length - 1]?.id ?? null;
      return nextProject;
    });
    if (createdRoomId) {
      setSingleSelection({ kind: "room", id: createdRoomId });
    }
    reportSuccess(
      mergedRoomCount > 0
        ? `Created room "${roomToolName.trim() || "Room"}" and joined ${mergedRoomCount} connected room(s) (${formatNumber(finalAreaM2)} m2).`
        : `Created room "${roomToolName.trim() || "Room"}" (${formatNumber(finalAreaM2)} m2).`,
    );
  }

  function handleDiscoverRooms() {
    if (!activeLevelId) {
      reportError("Select an active level before discovering rooms.");
      return;
    }

    const discoveredPolygons = discoverRoomPolygonsFromWalls(project, activeLevelId);
    if (discoveredPolygons.length === 0) {
      reportError("No closed wall-bounded rooms were found on the active level.");
      return;
    }

    const existingKeys = new Set(
      project.rooms
        .filter((room) => room.levelId === activeLevelId)
        .map((room) => getRoomPolygonKey(room.polygon)),
    );
    const newPolygons = discoveredPolygons.filter(
      (polygon) => !existingKeys.has(getRoomPolygonKey(polygon)),
    );

    if (newPolygons.length === 0) {
      reportSuccess("All discovered rooms already exist.");
      return;
    }

    const newSelections: EditorSelection[] = [];
    applyCommand((current) => {
      let nextProject = current;
      for (const polygon of newPolygons) {
        nextProject = createRoom(nextProject, {
          levelId: activeLevelId,
          name: `${roomToolName.trim() || "Room"} ${nextProject.rooms.length + 1}`,
          polygon,
        });
        const createdRoom = nextProject.rooms[nextProject.rooms.length - 1];
        if (createdRoom) {
          newSelections.push({ kind: "room", id: createdRoom.id });
        }
      }

      return nextProject;
    });

    setSelectionSet(newSelections, newSelections[0] ?? null);
    reportSuccess(`Discovered ${newPolygons.length} room(s) from closed walls.`);
  }

  function getManualRoofSketch(projectToSearch: Project): RoofSketch | null {
    return (
      projectToSearch.roofSketches.find((sketch) => sketch.name === "Manual Roof Sketch") ??
      projectToSearch.roofSketches[0] ??
      null
    );
  }

  function handleCreateRoofLine(start: Vec2, end: Vec2) {
    const lengthM = Math.hypot(end.x - start.x, end.y - start.y);
    if (lengthM < 0.0001) {
      return;
    }

    let createdEdgeId: string | null = null;
    applyCommand((current) => {
      const roofLayer =
        current.roofLayers.find((candidate) => candidate.id === activeRoofLayerId) ??
        current.roofLayers.find((candidate) => candidate.id === DEFAULT_ROOF_LAYER_ID) ??
        current.roofLayers[0];
      if (!roofLayer) {
        throw new Error("Project has no roof layer.");
      }

      const existingSketch = getManualRoofSketch(current);
      const matchToleranceM = Math.max(current.settings.snapToGrid ? current.settings.gridSpacingM * 0.2 : 0.05, 0.02);
      const matchedStartVertex = existingSketch
        ? findRoofVertexNear(existingSketch, start, matchToleranceM)
        : null;
      const matchedEndVertex = existingSketch
        ? findRoofVertexNear(existingSketch, end, matchToleranceM)
        : null;
      const edgeId = createId("roof_edge");
      const startVertexId = matchedStartVertex?.id ?? createId("roof_vertex");
      const endVertexId = matchedEndVertex?.id ?? createId("roof_vertex");
      const incidentStartEdge =
        existingSketch && matchedStartVertex
          ? existingSketch.edges.find(
              (edge) =>
                edge.startVertexId === matchedStartVertex.id ||
                edge.endVertexId === matchedStartVertex.id,
            )
          : null;
      const incidentEndEdge =
        existingSketch && matchedEndVertex
          ? existingSketch.edges.find(
              (edge) =>
                edge.startVertexId === matchedEndVertex.id ||
                edge.endVertexId === matchedEndVertex.id,
            )
          : null;
      const chainId =
        incidentStartEdge
          ? getRoofEdgeChainId(incidentStartEdge)
          : incidentEndEdge
            ? getRoofEdgeChainId(incidentEndEdge)
            : edgeId;
      createdEdgeId = edgeId;
      const vertices: RoofSketch["vertices"] = [];
      if (!matchedStartVertex) {
        vertices.push({
          id: startVertexId,
          position: createVec2(start.x, start.y),
          elevationMode: "Explicit",
          elevationM: roofToolStartElevationM,
        });
      }
      if (!matchedEndVertex) {
        vertices.push({
          id: endVertexId,
          position: createVec2(end.x, end.y),
          elevationMode: "Explicit",
          elevationM: roofToolEndElevationM,
        });
      }
      const edge = {
        id: edgeId,
        startVertexId,
        endVertexId,
        role: "Generic" as const,
        chainId,
      };

      if (!existingSketch) {
        return createRoofSketch(current, {
          name: "Manual Roof Sketch",
          layerId: roofLayer.id,
          baseElevationM: Math.min(roofToolStartElevationM, roofToolEndElevationM),
          thicknessM: 0.2,
          vertices,
          edges: [edge],
          faces: [],
          constraints: [],
        });
      }

      return updateRoofSketch(current, existingSketch.id, {
        vertices: [...existingSketch.vertices, ...vertices],
        edges: [...existingSketch.edges, edge],
      });
    });

    if (createdEdgeId) {
      setSelectionSet([{ kind: "roofEdge", id: createdEdgeId }], { kind: "roofEdge", id: createdEdgeId });
    }
    reportSuccess(
      `Created roof line segment from ${formatNumber(roofToolStartElevationM)} m to ${formatNumber(roofToolEndElevationM)} m, length ${formatNumber(lengthM)} m.`,
    );
  }

  function handleCreateRoofOpening(input: {
    roofSketchId: string;
    roofFaceId: string;
    center: Vec2;
  }) {
    try {
      applyCommand((current) =>
        createRoofOpening(current, {
          roofSketchId: input.roofSketchId,
          roofFaceId: input.roofFaceId,
          center: createVec2(input.center.x, input.center.y),
          widthM: roofWindowToolWidthM,
          heightM: roofWindowToolHeightM,
          cutMode: roofWindowToolCutMode,
          rotationDeg: roofWindowToolRotationDeg,
        }),
      );
      reportSuccess(
        `Placed roof window opening ${formatNumber(roofWindowToolWidthM)} x ${formatNumber(roofWindowToolHeightM)} m.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Roof window create failed.";
      reportError(message);
    }
  }

  function handleLinkSelectedRoofEdges() {
    if (selectedRoofChainIds.length !== 2) {
      reportError("Select exactly two roof line chains before linking them.");
      return;
    }

    let linkedFaceId: string | null = null;
    applyCommand((current) => {
      const sketch = current.roofSketches.find((candidate) =>
        selectedRoofEdgeIds.every((edgeId) => candidate.edges.some((edge) => edge.id === edgeId)),
      );
      if (!sketch) {
        throw new Error("Selected roof line chains must belong to the same roof sketch.");
      }

      const edgeGroups = selectedRoofChainIds.map((chainId) =>
        sketch.edges.filter(
          (edge) => selectedRoofEdgeIds.includes(edge.id) && getRoofEdgeChainId(edge) === chainId,
        ),
      );
      const [firstGroup, secondGroup] = edgeGroups;
      if (!firstGroup || !secondGroup || firstGroup.length === 0 || secondGroup.length === 0) {
        throw new Error("Selected roof line chain no longer exists.");
      }

      const vertexById = new Map(sketch.vertices.map((vertex) => [vertex.id, vertex] as const));
      const firstVertexIds = getRoofChainVertexIds(sketch, firstGroup.map((edge) => edge.id));
      const secondVertexIds = getRoofChainVertexIds(sketch, secondGroup.map((edge) => edge.id));
      const firstStart = vertexById.get(firstVertexIds[0]);
      const firstEnd = vertexById.get(firstVertexIds[firstVertexIds.length - 1]);
      const secondStart = vertexById.get(secondVertexIds[0]);
      const secondEnd = vertexById.get(secondVertexIds[secondVertexIds.length - 1]);
      if (!firstStart || !firstEnd || !secondStart || !secondEnd) {
        throw new Error("Selected roof line chain has missing vertices.");
      }

      const sameDirectionCost =
        distanceSquared(firstStart.position, secondStart.position) +
        distanceSquared(firstEnd.position, secondEnd.position);
      const oppositeDirectionCost =
        distanceSquared(firstStart.position, secondEnd.position) +
        distanceSquared(firstEnd.position, secondStart.position);
      const secondEdgeVertexIds =
        sameDirectionCost <= oppositeDirectionCost
          ? [...secondVertexIds].reverse()
          : secondVertexIds;
      const faceId = createId("roof_face");
      linkedFaceId = faceId;
      return updateRoofSketch(current, sketch.id, {
        faces: [
          ...sketch.faces,
          {
            id: faceId,
            vertexIds: compactRoofFaceVertexIds([
              ...firstVertexIds,
              ...secondEdgeVertexIds,
            ]),
            edgeIds: [...firstGroup, ...secondGroup].map((edge) => edge.id),
            constraintIds: [],
            thicknessM: sketch.thicknessM,
          },
        ],
      });
    });

    clearSelection();
    reportSuccess(
      linkedFaceId
        ? `Linked selected roof lines into face ${linkedFaceId}.`
        : "Linked selected roof lines into a roof face.",
    );
  }

  function handleLinkSelectedRoofEdgeToEndpoint() {
    if (selectedRoofEdgeIds.length !== 2) {
      reportError("Select exactly two roof lines before linking one line to an endpoint.");
      return;
    }

    let linkedFaceId: string | null = null;
    applyCommand((current) => {
      const sketch = current.roofSketches.find((candidate) =>
        selectedRoofEdgeIds.every((edgeId) => candidate.edges.some((edge) => edge.id === edgeId)),
      );
      if (!sketch) {
        throw new Error("Selected roof lines must belong to the same roof sketch.");
      }

      const [baseEdgeId, endpointEdgeId] = selectedRoofEdgeIds;
      const baseEdge = sketch.edges.find((edge) => edge.id === baseEdgeId);
      const endpointEdge = sketch.edges.find((edge) => edge.id === endpointEdgeId);
      if (!baseEdge || !endpointEdge) {
        throw new Error("Selected roof line no longer exists.");
      }

      const vertexById = new Map(sketch.vertices.map((vertex) => [vertex.id, vertex] as const));
      const baseStart = vertexById.get(baseEdge.startVertexId);
      const baseEnd = vertexById.get(baseEdge.endVertexId);
      const endpointStart = vertexById.get(endpointEdge.startVertexId);
      const endpointEnd = vertexById.get(endpointEdge.endVertexId);
      if (!baseStart || !baseEnd || !endpointStart || !endpointEnd) {
        throw new Error("Selected roof line has missing vertices.");
      }

      const baseVertexIds = new Set([baseEdge.startVertexId, baseEdge.endVertexId]);
      const endpointCandidates = [
        { id: endpointEdge.startVertexId, vertex: endpointStart },
        { id: endpointEdge.endVertexId, vertex: endpointEnd },
      ]
        .filter((candidate) => !baseVertexIds.has(candidate.id))
        .map((candidate) => ({
          ...candidate,
          distanceSquared: projectPointOntoSegment(
            candidate.vertex.position,
            baseStart.position,
            baseEnd.position,
          ).distanceSquared,
        }))
        .sort((left, right) => left.distanceSquared - right.distanceSquared);

      const endpoint = endpointCandidates[0];
      if (!endpoint) {
        throw new Error("The second roof line does not have a free endpoint for a triangular face.");
      }

      const faceId = createId("roof_face");
      linkedFaceId = faceId;
      return updateRoofSketch(current, sketch.id, {
        faces: [
          ...sketch.faces,
          {
            id: faceId,
            vertexIds: [baseEdge.startVertexId, baseEdge.endVertexId, endpoint.id],
            edgeIds: [baseEdge.id, endpointEdge.id],
            constraintIds: [],
            thicknessM: sketch.thicknessM,
          },
        ],
      });
    });

    clearSelection();
    reportSuccess(
      linkedFaceId
        ? `Linked selected roof line to endpoint into triangular face ${linkedFaceId}.`
        : "Linked selected roof line to endpoint into a triangular roof face.",
    );
  }

  function handleLinkSelectedRoofChainToVertex() {
    if (selectedRoofChainIds.length !== 1 || selectedRoofVertexIds.length !== 1) {
      reportError("Select exactly one roof line chain and one roof node before linking them.");
      return;
    }

    let linkedFaceId: string | null = null;
    applyCommand((current) => {
      const selectedVertexId = selectedRoofVertexIds[0];
      const chainId = selectedRoofChainIds[0];
      const sketch = current.roofSketches.find((candidate) => {
        const hasSelectedVertex = candidate.vertices.some((vertex) => vertex.id === selectedVertexId);
        const hasSelectedChain = candidate.edges.some(
          (edge) => selectedRoofEdgeIds.includes(edge.id) && getRoofEdgeChainId(edge) === chainId,
        );
        return hasSelectedVertex && hasSelectedChain;
      });
      if (!sketch) {
        throw new Error("Selected roof line chain and roof node must belong to the same roof sketch.");
      }

      const chainEdges = sketch.edges.filter(
        (edge) => selectedRoofEdgeIds.includes(edge.id) && getRoofEdgeChainId(edge) === chainId,
      );
      const chainVertexIds = getRoofChainVertexIds(sketch, chainEdges.map((edge) => edge.id));
      if (chainVertexIds.length < 2) {
        throw new Error("Selected roof line chain has too few vertices.");
      }

      if (chainVertexIds.includes(selectedVertexId)) {
        throw new Error("Selected roof node is already part of the selected roof line chain.");
      }

      const faceId = createId("roof_face");
      linkedFaceId = faceId;
      return updateRoofSketch(current, sketch.id, {
        faces: [
          ...sketch.faces,
          {
            id: faceId,
            vertexIds: compactRoofFaceVertexIds([...chainVertexIds, selectedVertexId]),
            edgeIds: chainEdges.map((edge) => edge.id),
            constraintIds: [],
            thicknessM: sketch.thicknessM,
          },
        ],
      });
    });

    clearSelection();
    reportSuccess(
      linkedFaceId
        ? `Linked selected roof line chain to roof node into face ${linkedFaceId}.`
        : "Linked selected roof line chain to roof node.",
    );
  }

  function handleCreateModel() {
    if (!activeLevelId) {
      reportError("Select an active level before placing an external model marker.");
      return;
    }

    applyCommand((current) =>
      createExternalModel(current, {
        levelId: activeLevelId,
        name: `model_${current.externalModels.length + 1}`,
        uri: "model://demo_marker",
        position: createVec2(current.externalModels.length + 1, 2.1),
        zM: 0,
        rollRad: 0,
        pitchRad: 0,
        yawRad: 0,
      }),
    );
    reportSuccess("Placed an external model marker through the command layer.");
  }

  function handleCreateExternalModelAt(position: Vec2) {
    if (!activeLevelId) {
      reportError("Select an active level before placing an external model marker.");
      return;
    }

    applyCommand((current) =>
      createExternalModel(current, {
        levelId: activeLevelId,
        name: `model_${current.externalModels.length + 1}`,
        uri: "model://demo_marker",
        position: createVec2(position.x, position.y),
        zM: 0,
        rollRad: 0,
        pitchRad: 0,
        yawRad: 0,
      }),
    );
    reportSuccess(
      `Placed a model marker at ${formatNumber(position.x)}, ${formatNumber(position.y)}.`,
    );
  }

  function handleAddLevel() {
    applyCommand((current) =>
      addLevel(current, {
        name: `Level ${current.levels.length}`,
        elevationM: current.levels.length * 3,
      }),
    );
    reportSuccess("Added a new level.");
  }

  function handleRemoveLevel() {
    if (!activeLevel) {
      reportError("Select a level before removing it.");
      return;
    }

    try {
      applyCommand((current) => deleteLevel(current, activeLevel.id));
      reportSuccess(`Removed level "${activeLevel.name}" and its entities.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Level delete failed.";
      reportError(message);
    }
  }

  function handleToggleDefaultRoofLayerVisibility() {
    if (!defaultRoofLayer) {
      reportError("Project has no roof layer.");
      return;
    }

    const nextVisible = currentHiddenRoofLayerIdSet.has(defaultRoofLayer.id);
    toggleRoofLayerVisibility(defaultRoofLayer.id, viewportMode);
    reportSuccess(`${nextVisible ? "Showing" : "Hiding"} Roof in ${viewportMode.toUpperCase()}.`);
  }

  function handleAddWallType() {
    applyCommand((current) =>
      addWallType(current, {
        name: `Wall Type ${current.wallTypes.length + 1}`,
        thicknessM: 0.16 + current.wallTypes.length * 0.02,
        heightM: 2.8,
      }),
    );
    reportSuccess("Added a new wall type.");
  }

  function handleRemoveWallType() {
    if (!activeWallType) {
      return;
    }

    try {
      applyCommand((current) => {
        const nextProject = deleteWallType(current, activeWallType.id);
        return wallAuthoringMode === "AutoWall" ? pruneOrphanNodes(nextProject) : nextProject;
      });
      if (editingWallTypeId === activeWallType.id) {
        setEditingWallTypeId(null);
      }
      reportSuccess(`Removed wall type "${activeWallType.name}" and deleted its walls.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wall type delete failed.";
      reportError(message);
    }
  }

  function handleToggleSnap() {
    applyCommand((current) =>
      updateProjectSettings(current, {
        snapToGrid: !current.settings.snapToGrid,
      }),
    );
    reportSuccess(
      project.settings.snapToGrid ? "Grid snapping disabled." : "Grid snapping enabled.",
    );
  }

  function handleGridStep(delta: number) {
    applyCommand((current) =>
      updateProjectSettings(current, {
        gridSpacingM: Number(Math.max(0.01, current.settings.gridSpacingM + delta).toFixed(2)),
      }),
    );
    reportSuccess("Adjusted grid spacing.");
  }

  function handleSetGridSpacing(nextValue: number) {
    applyCommand((current) =>
      updateProjectSettings(current, {
        gridSpacingM: Number(Math.max(0.01, nextValue).toFixed(2)),
      }),
    );
    reportSuccess("Updated grid spacing.");
  }

  function handlePixelsPerMeterStep(delta: number) {
    applyCommand((current) =>
      updateProjectSettings(current, {
        pixelsPerMeter: Math.max(40, current.settings.pixelsPerMeter + delta),
      }),
    );
    reportSuccess("Adjusted display scale.");
  }

  const showToolWindow =
    editorMode === "Building" &&
    floatingWindowVisibility.tool &&
    (activeTool === "Measure" ||
      activeTool === "Door" ||
      activeTool === "Window" ||
      activeTool === "ExternalShading" ||
      activeTool === "Shape" ||
      activeTool === "Stair" ||
      activeTool === "Slab" ||
      activeTool === "Ground" ||
      activeTool === "Rooms" ||
      activeTool === "Roof" ||
      activeTool === "RoofOpening" ||
      activeTool === "RoofWindow" ||
      activeTool === "SolarPanels" ||
      viewportMode === "3d");

  const showContextWindow =
    editorMode === "Building" &&
    floatingWindowVisibility.context &&
    currentSelection !== null &&
    !(
      viewportMode === "3d" &&
      ((activeTool === "Window" && currentSelection.kind === "window") ||
        (activeTool === "Door" && currentSelection.kind === "door") ||
        (activeTool === "RoofWindow" && currentSelection.kind === "roofOpening") ||
        (activeTool === "SolarPanels" && currentSelection.kind === "solarPanelArray"))
    );

  function renderToolWindowContent() {
    if (viewportMode === "3d") {
      if (activeTool === "ExternalShading") {
        return (
          <div className="field-grid">
            <label className="field-label field-grid-wide">
              <span>Shading Type</span>
              <select
                value={externalShadingKind}
                onChange={(event) =>
                  setExternalShadingKind(event.target.value as ExternalShadingToolDesign["kind"])
                }
              >
                <option value="ExternalBlinds">External Blinds</option>
                <option value="RollerShutter">Roller Shutter</option>
              </select>
            </label>
            <label className="field-label field-grid-wide">
              <span>Width</span>
              <button
                type="button"
                className={externalShadingFitOpeningWidth ? "is-active" : undefined}
                onClick={() => setExternalShadingFitOpeningWidth((current) => !current)}
              >
                {externalShadingFitOpeningWidth ? "Fit Opening Width" : "Use Preset Width"}
              </button>
            </label>
            {externalShadingKind === "ExternalBlinds" ? (
              <ExternalBlindsControls
                blinds={externalBlindsToolDesign}
                subtitle="Preset for clicked openings"
                onChange={(patch) =>
                  setExternalBlindsToolDesign((current) => ({ ...current, ...patch }))
                }
              />
            ) : (
              <ExternalRollerShutterControls
                shutter={externalRollerShutterToolDesign}
                subtitle="Preset for clicked openings"
                onChange={(patch) =>
                  setExternalRollerShutterToolDesign((current) => ({ ...current, ...patch }))
                }
              />
            )}
            <p className="muted field-grid-wide">
              Hover an existing wall opening to preview the preset, then left-click to apply it.
            </p>
          </div>
        );
      }

      if (activeTool === "Measure") {
        return (
          <div className="field-stack">
            <label className="field-label">
              <span>Units</span>
              <select
                value={measureToolUnit}
                onChange={(event) => setMeasureToolUnit(event.target.value as MeasurementUnit)}
              >
                <option value="cm">cm</option>
                <option value="dm">dm</option>
                <option value="m">m</option>
              </select>
            </label>
            <p className="muted">
              3D measuring will use a different interaction flow than 2D plan dimensions.
              For now this tool menu keeps only the measurement unit ready.
            </p>
          </div>
        );
      }

      if (activeTool === "Door") {
        const effectiveDoor3DDesign = selectedDoor?.design3D ?? createCurrentDoor3DDesign();
        const depthOffsetLimitCm =
          selectedDoorDepthOffsetLimitM !== null
            ? toCentimeters(selectedDoorDepthOffsetLimitM)
            : null;
        return (
          <div className="field-grid">
            {selectedDoor ? (
              <>
                <div className="stat-row">
                  <span>Selected Opening</span>
                  <strong>{selectedDoor.id}</strong>
                </div>
                <div className="stat-row">
                  <span>Host Wall</span>
                  <strong>{selectedDoor.wallId}</strong>
                </div>
                <div className="stat-row">
                  <span>Opening Size</span>
                  <strong>
                    {formatNumber(selectedDoor.widthM)} x {formatNumber(selectedDoor.heightM)} m
                  </strong>
                </div>
              </>
            ) : null}
            <label className="field-label">
              <span>Door Type</span>
              <select
                value={effectiveDoor3DDesign.kind}
                onChange={(event) =>
                  handleCommitDoor3DToolDesign(
                    { kind: event.target.value as DoorDesign3D["kind"] },
                    "Updated 3D door type.",
                  )
                }
              >
                <option value="Normal">Normal</option>
                <option value="Garage">Garage</option>
                <option value="Glass">Glass Door</option>
                <option value="HSPortal">HS Portal</option>
              </select>
            </label>
            {effectiveDoor3DDesign.kind === "Garage" ? (
              <label className="field-label">
                <span>Garage Door Style</span>
                <select
                  value={effectiveDoor3DDesign.garageDoorStyle ?? "SinglePanel"}
                  onChange={(event) =>
                    handleCommitDoor3DToolDesign(
                      { garageDoorStyle: event.target.value as GarageDoorStyle },
                      "Updated garage door style.",
                    )
                  }
                >
                  <option value="SinglePanel">Single Panel</option>
                  <option value="Sectional">Sectional</option>
                </select>
              </label>
            ) : null}
            <label className="field-label">
              <span>State</span>
              <select
                value={effectiveDoor3DDesign.openState}
                onChange={(event) =>
                  handleCommitDoor3DToolDesign(
                    { openState: event.target.value as Door3DOpenState },
                    "Updated 3D door state.",
                  )
                }
              >
                <option value="Closed">Closed</option>
                <option value="Open">Open</option>
              </select>
            </label>
            <label className="field-label">
              <span>Open Percent ({Math.round(effectiveDoor3DDesign.openPercent)}%)</span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={effectiveDoor3DDesign.openPercent}
                onChange={(event) => {
                  const openPercent = clampValue(Number(event.target.value), 0, 100);
                  handleCommitDoor3DToolDesign(
                    { openPercent },
                    "Updated 3D door open percent.",
                  );
                }}
              />
            </label>
            <label className="field-label">
              <span>Frame Thickness (m)</span>
              <DraftNumberInput
                step="0.01"
                min="0.005"
                value={effectiveDoor3DDesign.frameThicknessM}
                onCommit={(nextValue) => {
                  if (nextValue > 0) {
                    handleCommitDoor3DToolDesign(
                      { frameThicknessM: nextValue },
                      "Updated 3D door frame thickness.",
                    );
                  }
                }}
              />
            </label>
            <label className="field-label">
              <span>Depth Offset From Wall Center (cm)</span>
              <DraftNumberInput
                step="0.5"
                min={depthOffsetLimitCm !== null ? String(-depthOffsetLimitCm) : undefined}
                max={depthOffsetLimitCm !== null ? String(depthOffsetLimitCm) : undefined}
                value={toCentimeters(effectiveDoor3DDesign.wallDepthOffsetM)}
                onCommit={(nextValue) => {
                  const nextOffsetM =
                    depthOffsetLimitCm !== null
                      ? clampValue(
                          toMetersFromCentimeters(nextValue),
                          -selectedDoorDepthOffsetLimitM!,
                          selectedDoorDepthOffsetLimitM!,
                        )
                      : toMetersFromCentimeters(nextValue);
                  handleCommitDoor3DToolDesign(
                    { wallDepthOffsetM: nextOffsetM },
                    "Updated 3D door depth offset.",
                  );
                }}
              />
            </label>
            <label className="field-label">
              <span>Frame Color</span>
              <input
                type="color"
                value={effectiveDoor3DDesign.frameColorHex}
                onChange={(event) =>
                  handleCommitDoor3DToolDesign(
                    { frameColorHex: event.target.value },
                    "Updated 3D door frame color.",
                  )
                }
              />
            </label>
            <label className="field-label">
              <span>Door Color</span>
              <input
                type="color"
                value={effectiveDoor3DDesign.doorColorHex}
                onChange={(event) =>
                  handleCommitDoor3DToolDesign(
                    { doorColorHex: event.target.value },
                    "Updated 3D door color.",
                  )
                }
              />
            </label>
            {effectiveDoor3DDesign.kind === "Normal" || effectiveDoor3DDesign.kind === "Glass" ? (
              <>
                <label className="field-label">
                  <span>Hinge Side</span>
                  <select
                    value={effectiveDoor3DDesign.hingeSide}
                    onChange={(event) =>
                      handleCommitDoor3DToolDesign(
                        { hingeSide: event.target.value as Door3DHingeSide },
                        "Updated 3D door hinge side.",
                      )
                    }
                  >
                    <option value="Left">Left</option>
                    <option value="Right">Right</option>
                  </select>
                </label>
                <label className="field-label">
                  <span>Swing Direction</span>
                  <select
                    value={effectiveDoor3DDesign.swingDirection}
                    onChange={(event) =>
                      handleCommitDoor3DToolDesign(
                        { swingDirection: event.target.value as Door3DSwingDirection },
                        "Updated 3D door swing direction.",
                      )
                    }
                  >
                    <option value="Inward">Inward</option>
                    <option value="Outward">Outward</option>
                  </select>
                </label>
              </>
            ) : effectiveDoor3DDesign.kind === "HSPortal" ? (
              <label className="field-label">
                <span>Sliding Panel</span>
                <select
                  value={effectiveDoor3DDesign.hingeSide}
                  onChange={(event) =>
                    handleCommitDoor3DToolDesign(
                      { hingeSide: event.target.value as Door3DHingeSide },
                      "Updated HS portal sliding panel.",
                    )
                  }
                >
                  <option value="Left">Left Panel</option>
                  <option value="Right">Right Panel</option>
                </select>
              </label>
            ) : null}
            {effectiveDoor3DDesign.kind === "Garage" ? (
              <label className="field-label">
                <span>Open Direction</span>
                <select
                  value={effectiveDoor3DDesign.swingDirection}
                  onChange={(event) =>
                    handleCommitDoor3DToolDesign(
                      { swingDirection: event.target.value as Door3DSwingDirection },
                      "Updated garage door opening direction.",
                    )
                  }
                >
                  <option value="Inward">Inward</option>
                  <option value="Outward">Outward</option>
                </select>
              </label>
            ) : null}
            {selectedDoor ? (
              <>
                <ExternalBlindsControls
                  blinds={effectiveDoor3DDesign.externalBlinds}
                  onAdd={() =>
                    handleCommitDoor3DToolDesign(
                      {
                        externalBlinds: createDefaultExternalBlindsDesign3D(selectedDoor.widthM),
                        externalRollerShutter: null,
                      },
                      "Added external blinds to the selected door.",
                    )
                  }
                  onChange={(patch) =>
                    handleCommitDoor3DToolDesign(
                      {
                        externalBlinds: {
                          ...(effectiveDoor3DDesign.externalBlinds ??
                            createDefaultExternalBlindsDesign3D(selectedDoor.widthM)),
                          ...patch,
                        },
                        externalRollerShutter: null,
                      },
                      "Updated external door blinds.",
                    )
                  }
                  onRemove={() =>
                    handleCommitDoor3DToolDesign(
                      { externalBlinds: null },
                      "Removed external blinds from the selected door.",
                    )
                  }
                />
                <ExternalRollerShutterControls
                  shutter={effectiveDoor3DDesign.externalRollerShutter}
                  onAdd={() =>
                    handleCommitDoor3DToolDesign(
                      {
                        externalBlinds: null,
                        externalRollerShutter: createDefaultExternalRollerShutterDesign3D(
                          selectedDoor.widthM,
                        ),
                      },
                      "Added a roller shutter to the selected door.",
                    )
                  }
                  onChange={(patch) =>
                    handleCommitDoor3DToolDesign(
                      {
                        externalBlinds: null,
                        externalRollerShutter: {
                          ...(effectiveDoor3DDesign.externalRollerShutter ??
                            createDefaultExternalRollerShutterDesign3D(selectedDoor.widthM)),
                          ...patch,
                        },
                      },
                      "Updated the external door roller shutter.",
                    )
                  }
                  onRemove={() =>
                    handleCommitDoor3DToolDesign(
                      { externalRollerShutter: null },
                      "Removed the roller shutter from the selected door.",
                    )
                  }
                />
                <div className="window-tool-action-row">
                  <button
                    type="button"
                    className="toolbar-button"
                    onClick={() => handleRemoveDoor3DInsert(selectedDoor.id)}
                  >
                    Delete Door
                  </button>
                  <button
                    type="button"
                    className="toolbar-button"
                    onClick={() => handleDeleteDoor(selectedDoor.id)}
                  >
                    Delete Opening
                  </button>
                </div>
              </>
            ) : null}
          </div>
        );
      }

      if (activeTool === "Window") {
        const effectiveWindow3DDesign = selectedWindow?.design3D ?? createCurrentWindow3DDesign();
        const depthOffsetLimitCm =
          selectedWindowDepthOffsetLimitM !== null
            ? toCentimeters(selectedWindowDepthOffsetLimitM)
            : null;
        return (
          <div className="field-grid">
            {selectedWindow ? (
              <>
                <div className="stat-row">
                  <span>Selected Opening</span>
                  <strong>{selectedWindow.id}</strong>
                </div>
                <div className="stat-row">
                  <span>Host Wall</span>
                  <strong>{selectedWindow.wallId}</strong>
                </div>
                <div className="stat-row">
                  <span>Opening Size</span>
                  <strong>
                    {formatNumber(selectedWindow.widthM)} x {formatNumber(selectedWindow.heightM)} m
                  </strong>
                </div>
              </>
            ) : null}
            <label className="field-label">
              <span>Glass Thickness (m)</span>
              <DraftNumberInput
                step="0.005"
                min="0.001"
                value={effectiveWindow3DDesign.glassThicknessM}
                onCommit={(nextValue) => {
                  if (nextValue > 0) {
                    handleCommitWindow3DToolDesign(
                      { glassThicknessM: nextValue },
                      "Updated 3D window glass thickness.",
                    );
                  }
                }}
              />
            </label>
            <label className="field-label">
              <span>Frame Thickness (m)</span>
              <DraftNumberInput
                step="0.01"
                min="0.005"
                value={effectiveWindow3DDesign.frameThicknessM}
                onCommit={(nextValue) => {
                  if (nextValue > 0) {
                    handleCommitWindow3DToolDesign(
                      { frameThicknessM: nextValue },
                      "Updated 3D window frame thickness.",
                    );
                  }
                }}
              />
            </label>
            <label className="field-label">
              <span>Frame Color</span>
              <input
                type="color"
                value={effectiveWindow3DDesign.frameColorHex}
                onChange={(event) =>
                  handleCommitWindow3DToolDesign(
                    { frameColorHex: event.target.value },
                    "Updated 3D window frame color.",
                  )
                }
              />
            </label>
            <label className="field-label">
              <span>Vertical Divisions</span>
              <DraftNumberInput
                step="1"
                min="0"
                value={effectiveWindow3DDesign.verticalDivisions}
                onCommit={(nextValue) => {
                  if (nextValue >= 0) {
                    handleCommitWindow3DToolDesign(
                      { verticalDivisions: Math.max(0, Math.round(nextValue)) },
                      "Updated 3D window vertical divisions.",
                    );
                  }
                }}
              />
            </label>
            <label className="field-label">
              <span>Horizontal Divisions</span>
              <DraftNumberInput
                step="1"
                min="0"
                value={effectiveWindow3DDesign.horizontalDivisions}
                onCommit={(nextValue) => {
                  if (nextValue >= 0) {
                    handleCommitWindow3DToolDesign(
                      { horizontalDivisions: Math.max(0, Math.round(nextValue)) },
                      "Updated 3D window horizontal divisions.",
                    );
                  }
                }}
              />
            </label>
            <label className="field-label">
              <span>Depth Offset From Wall Center (cm)</span>
              <DraftNumberInput
                step="0.5"
                min={depthOffsetLimitCm !== null ? String(-depthOffsetLimitCm) : undefined}
                max={depthOffsetLimitCm !== null ? String(depthOffsetLimitCm) : undefined}
                value={toCentimeters(effectiveWindow3DDesign.wallDepthOffsetM)}
                onCommit={(nextValue) => {
                  const nextOffsetM =
                    depthOffsetLimitCm !== null
                      ? clampValue(
                          toMetersFromCentimeters(nextValue),
                          -selectedWindowDepthOffsetLimitM!,
                          selectedWindowDepthOffsetLimitM!,
                        )
                      : toMetersFromCentimeters(nextValue);
                  handleCommitWindow3DToolDesign(
                    { wallDepthOffsetM: nextOffsetM },
                    "Updated 3D window depth offset.",
                  );
                }}
              />
            </label>
            {selectedWindow ? (
              <>
                <ExternalBlindsControls
                  blinds={effectiveWindow3DDesign.externalBlinds}
                  onAdd={() =>
                    handleCommitWindow3DToolDesign(
                      {
                        externalBlinds: createDefaultExternalBlindsDesign3D(selectedWindow.widthM),
                        externalRollerShutter: null,
                      },
                      "Added external blinds to the selected window.",
                    )
                  }
                  onChange={(patch) =>
                    handleCommitWindow3DToolDesign(
                      {
                        externalBlinds: {
                          ...(effectiveWindow3DDesign.externalBlinds ??
                            createDefaultExternalBlindsDesign3D(selectedWindow.widthM)),
                          ...patch,
                        },
                        externalRollerShutter: null,
                      },
                      "Updated external window blinds.",
                    )
                  }
                  onRemove={() =>
                    handleCommitWindow3DToolDesign(
                      { externalBlinds: null },
                      "Removed external blinds from the selected window.",
                    )
                  }
                />
                <ExternalRollerShutterControls
                  shutter={effectiveWindow3DDesign.externalRollerShutter}
                  onAdd={() =>
                    handleCommitWindow3DToolDesign(
                      {
                        externalBlinds: null,
                        externalRollerShutter: createDefaultExternalRollerShutterDesign3D(
                          selectedWindow.widthM,
                        ),
                      },
                      "Added a roller shutter to the selected window.",
                    )
                  }
                  onChange={(patch) =>
                    handleCommitWindow3DToolDesign(
                      {
                        externalBlinds: null,
                        externalRollerShutter: {
                          ...(effectiveWindow3DDesign.externalRollerShutter ??
                            createDefaultExternalRollerShutterDesign3D(selectedWindow.widthM)),
                          ...patch,
                        },
                      },
                      "Updated the external window roller shutter.",
                    )
                  }
                  onRemove={() =>
                    handleCommitWindow3DToolDesign(
                      { externalRollerShutter: null },
                      "Removed the roller shutter from the selected window.",
                    )
                  }
                />
                <div className="window-tool-action-row">
                  <button
                    type="button"
                    className="toolbar-button"
                    onClick={() => handleRemoveWindow3DInsert(selectedWindow.id)}
                  >
                    Delete Window
                  </button>
                  <button
                    type="button"
                    className="toolbar-button"
                    onClick={() => handleDeleteWindow(selectedWindow.id)}
                  >
                    Delete Opening
                  </button>
                </div>
              </>
            ) : null}
          </div>
        );
      }

      if (activeTool === "RoofWindow") {
        const effectiveRoofWindow3DDesign =
          selectedRoofOpening?.design3D ?? createCurrentWindow3DDesign();
        return (
          <div className="field-grid">
            {selectedRoofOpening ? (
              <>
                <div className="stat-row">
                  <span>Selected Roof Opening</span>
                  <strong>{selectedRoofOpening.id}</strong>
                </div>
                <div className="stat-row">
                  <span>Opening Size</span>
                  <strong>
                    {formatNumber(selectedRoofOpening.widthM)} x{" "}
                    {formatNumber(selectedRoofOpening.heightM)} m
                  </strong>
                </div>
              </>
            ) : null}
            <label className="field-label">
              <span>Glass Thickness (m)</span>
              <DraftNumberInput
                step="0.005"
                min="0.001"
                value={effectiveRoofWindow3DDesign.glassThicknessM}
                onCommit={(nextValue) => {
                  if (nextValue > 0) {
                    handleCommitWindow3DToolDesign(
                      { glassThicknessM: nextValue },
                      "Updated skylight glass thickness.",
                    );
                  }
                }}
              />
            </label>
            <label className="field-label">
              <span>Frame Thickness (m)</span>
              <DraftNumberInput
                step="0.01"
                min="0.005"
                value={effectiveRoofWindow3DDesign.frameThicknessM}
                onCommit={(nextValue) => {
                  if (nextValue > 0) {
                    handleCommitWindow3DToolDesign(
                      { frameThicknessM: nextValue },
                      "Updated skylight frame thickness.",
                    );
                  }
                }}
              />
            </label>
            <label className="field-label">
              <span>Frame Color</span>
              <input
                type="color"
                value={effectiveRoofWindow3DDesign.frameColorHex}
                onChange={(event) =>
                  handleCommitWindow3DToolDesign(
                    { frameColorHex: event.target.value },
                    "Updated skylight frame color.",
                  )
                }
              />
            </label>
            <label className="field-label">
              <span>Vertical Divisions</span>
              <DraftNumberInput
                step="1"
                min="0"
                value={effectiveRoofWindow3DDesign.verticalDivisions}
                onCommit={(nextValue) => {
                  if (nextValue >= 0) {
                    handleCommitWindow3DToolDesign(
                      { verticalDivisions: Math.max(0, Math.round(nextValue)) },
                      "Updated skylight vertical divisions.",
                    );
                  }
                }}
              />
            </label>
            <label className="field-label">
              <span>Horizontal Divisions</span>
              <DraftNumberInput
                step="1"
                min="0"
                value={effectiveRoofWindow3DDesign.horizontalDivisions}
                onCommit={(nextValue) => {
                  if (nextValue >= 0) {
                    handleCommitWindow3DToolDesign(
                      { horizontalDivisions: Math.max(0, Math.round(nextValue)) },
                      "Updated skylight horizontal divisions.",
                    );
                  }
                }}
              />
            </label>
            <label className="field-label">
              <span>Depth Offset From Roof Surface (cm)</span>
              <DraftNumberInput
                step="0.5"
                value={toCentimeters(effectiveRoofWindow3DDesign.wallDepthOffsetM)}
                onCommit={(nextValue) =>
                  handleCommitWindow3DToolDesign(
                    { wallDepthOffsetM: toMetersFromCentimeters(nextValue) },
                    "Updated skylight depth offset.",
                  )
                }
              />
            </label>
            {selectedRoofOpening ? (
              <div className="window-tool-action-row">
                <button
                  type="button"
                  className="toolbar-button"
                  onClick={() =>
                    selectedRoofOpening.design3D
                      ? handleRemoveRoofWindow3DInsert(selectedRoofOpening.id)
                      : handleApplyRoofWindow3DInsert(selectedRoofOpening.id)
                  }
                >
                  {selectedRoofOpening.design3D ? "Remove 3D Window" : "Insert 3D Window"}
                </button>
              </div>
            ) : null}
          </div>
        );
      }

      if (activeTool === "SolarPanels") {
        const effectiveDesign = selectedSolarPanelArray
          ? getSolarPanelToolDesign(selectedSolarPanelArray)
          : solarPanelToolDesign;
        return (
          <div className="field-grid">
            {selectedSolarPanelArray ? (
              <div className="stat-row field-grid-wide">
                <span>Selected Array</span>
                <strong>{selectedSolarPanelArray.id}</strong>
              </div>
            ) : (
              <p className="muted field-grid-wide">
                Move over a roof face for a preview, then click to place the array.
              </p>
            )}
            <label className="field-label">
              <span>Rows</span>
              <DraftNumberInput
                value={effectiveDesign.rows}
                min="1"
                max="40"
                step="1"
                onCommit={(value) =>
                  handleCommitSolarPanelToolDesign(
                    { rows: clampValue(Math.round(value), 1, 40) },
                    "Updated solar panel rows.",
                  )
                }
              />
            </label>
            <label className="field-label">
              <span>Columns</span>
              <DraftNumberInput
                value={effectiveDesign.columns}
                min="1"
                max="40"
                step="1"
                onCommit={(value) =>
                  handleCommitSolarPanelToolDesign(
                    { columns: clampValue(Math.round(value), 1, 40) },
                    "Updated solar panel columns.",
                  )
                }
              />
            </label>
            <label className="field-label">
              <span>Orientation</span>
              <select
                value={effectiveDesign.orientation}
                onChange={(event) =>
                  handleCommitSolarPanelToolDesign(
                    { orientation: event.target.value as SolarPanelArray["orientation"] },
                    "Updated solar panel orientation.",
                  )
                }
              >
                <option value="Portrait">Portrait</option>
                <option value="Landscape">Landscape</option>
              </select>
            </label>
            <label className="field-label">
              <span>Module Width (m)</span>
              <DraftNumberInput
                value={effectiveDesign.panelWidthM}
                min="0.1"
                step="0.01"
                onCommit={(value) => {
                  if (value > 0) {
                    handleCommitSolarPanelToolDesign(
                      { panelWidthM: value },
                      "Updated solar module width.",
                    );
                  }
                }}
              />
            </label>
            <label className="field-label">
              <span>Module Height (m)</span>
              <DraftNumberInput
                value={effectiveDesign.panelHeightM}
                min="0.1"
                step="0.01"
                onCommit={(value) => {
                  if (value > 0) {
                    handleCommitSolarPanelToolDesign(
                      { panelHeightM: value },
                      "Updated solar module height.",
                    );
                  }
                }}
              />
            </label>
            <label className="field-label">
              <span>Module Gap (cm)</span>
              <DraftNumberInput
                value={toCentimeters(effectiveDesign.gapM)}
                min="0"
                step="0.5"
                onCommit={(value) =>
                  handleCommitSolarPanelToolDesign(
                    { gapM: Math.max(0, toMetersFromCentimeters(value)) },
                    "Updated solar module gap.",
                  )
                }
              />
            </label>
            <label className="field-label">
              <span>Mounting Offset (cm)</span>
              <DraftNumberInput
                value={toCentimeters(effectiveDesign.mountingOffsetM)}
                min="0"
                step="0.5"
                onCommit={(value) =>
                  handleCommitSolarPanelToolDesign(
                    { mountingOffsetM: Math.max(0, toMetersFromCentimeters(value)) },
                    "Updated solar mounting offset.",
                  )
                }
              />
            </label>
            <label className="field-label">
              <span>Panel Thickness (cm)</span>
              <DraftNumberInput
                value={toCentimeters(effectiveDesign.panelThicknessM)}
                min="0.1"
                step="0.5"
                onCommit={(value) => {
                  if (value > 0) {
                    handleCommitSolarPanelToolDesign(
                      { panelThicknessM: toMetersFromCentimeters(value) },
                      "Updated solar panel thickness.",
                    );
                  }
                }}
              />
            </label>
            <label className="field-label">
              <span>Panel Color</span>
              <input
                type="color"
                value={effectiveDesign.panelColorHex}
                onChange={(event) =>
                  handleCommitSolarPanelToolDesign(
                    { panelColorHex: event.target.value },
                    "Updated solar panel color.",
                  )
                }
              />
            </label>
            <label className="field-label">
              <span>Frame Color</span>
              <input
                type="color"
                value={effectiveDesign.frameColorHex}
                onChange={(event) =>
                  handleCommitSolarPanelToolDesign(
                    { frameColorHex: event.target.value },
                    "Updated solar panel frame color.",
                  )
                }
              />
            </label>
            <button
              type="button"
              className={project.settings.showSolarPanels2D ? "is-active field-grid-wide" : "field-grid-wide"}
              onClick={handleToggleSolarPanels2D}
            >
              {project.settings.showSolarPanels2D ? "Shown In 2D Plan" : "Hidden From 2D Plan"}
            </button>
            {selectedSolarPanelArray ? (
              <button
                type="button"
                className="toolbar-button field-grid-wide"
                onClick={() => handleDeleteSolarPanelArray(selectedSolarPanelArray.id)}
              >
                Delete Solar Panel Array
              </button>
            ) : null}
          </div>
        );
      }

      return <p className="muted">Select a 3D tool to configure it here.</p>;
    }

    if (activeTool === "Door") {
      return (
        <div className="field-grid">
          <label className="field-label">
            <span>Width (m)</span>
            <DraftNumberInput
              step="0.1"
              min="0.2"
              value={doorToolWidthM}
              onCommit={(nextValue) => {
                if (nextValue > 0) {
                  setDoorToolWidthM(nextValue);
                }
              }}
            />
          </label>
          <label className="field-label">
            <span>Height (m)</span>
            <DraftNumberInput
              step="0.1"
              min="0.5"
              value={doorToolHeightM}
              onCommit={(nextValue) => {
                if (nextValue > 0) {
                  setDoorToolHeightM(nextValue);
                }
              }}
            />
          </label>
        </div>
      );
    }

    if (activeTool === "Measure") {
      return (
        <div className="field-grid">
          <label className="field-label">
            <span>Units</span>
            <select
              value={measureToolUnit}
              onChange={(event) => setMeasureToolUnit(event.target.value as MeasurementUnit)}
            >
              <option value="cm">cm</option>
              <option value="dm">dm</option>
              <option value="m">m</option>
            </select>
          </label>
          <label className="field-label">
            <span>Storage</span>
            <button
              type="button"
              className={measureToolPermanent ? "is-active" : undefined}
              onClick={() => setMeasureToolPermanent((current) => !current)}
            >
              {measureToolPermanent ? "Permanent" : "Temporary"}
            </button>
          </label>
        </div>
      );
    }

    if (activeTool === "Window") {
      return (
        <div className="field-grid">
          <label className="field-label">
            <span>Width (m)</span>
            <DraftNumberInput
              step="0.1"
              min="0.2"
              value={windowToolWidthM}
              onCommit={(nextValue) => {
                if (nextValue > 0) {
                  setWindowToolWidthM(nextValue);
                }
              }}
            />
          </label>
          <label className="field-label">
            <span>Height (m)</span>
            <DraftNumberInput
              step="0.1"
              min="0.2"
              value={windowToolHeightM}
              onCommit={(nextValue) => {
                if (nextValue > 0) {
                  setWindowToolHeightM(nextValue);
                }
              }}
            />
          </label>
          <label className="field-label">
            <span>Sill Height (m)</span>
            <DraftNumberInput
              step="0.1"
              min="0"
              value={windowToolSillHeightM}
              onCommit={(nextValue) => {
                if (nextValue >= 0) {
                  setWindowToolSillHeightM(nextValue);
                }
              }}
            />
          </label>
        </div>
      );
    }

    if (activeTool === "Shape") {
      return (
        <div className="field-grid">
          <label className="field-label">
            <span>Kind</span>
            <select
              value={shapeToolKind}
              onChange={(event) => setShapeToolKind(event.target.value as Shape["kind"])}
            >
              <option value="Square">Square</option>
              <option value="Cylinder">Cylinder</option>
            </select>
          </label>
          <label className="field-label">
            <span>Bottom (m)</span>
            <DraftNumberInput
              step="0.1"
              value={shapeToolBottomM}
              onCommit={(nextValue) => {
                setShapeToolBottomM(nextValue);
              }}
            />
          </label>
          <label className="field-label">
            <span>Top (m)</span>
            <DraftNumberInput
              step="0.1"
              value={shapeToolTopM}
              onCommit={(nextValue) => {
                setShapeToolTopM(nextValue);
              }}
            />
          </label>
        </div>
      );
    }

    if (activeTool === "Stair") {
      return (
        <div className="field-grid">
          <label className="field-label">
            <span>Width (m)</span>
            <DraftNumberInput
              step="0.1"
              min="0.3"
              value={stairToolWidthM}
              onCommit={(nextValue) => {
                if (nextValue > 0) {
                  setStairToolWidthM(nextValue);
                }
              }}
            />
          </label>
          <label className="field-label">
            <span>Top Above Level (m)</span>
            <DraftNumberInput
              step="0.1"
              value={stairToolEndElevationOffsetM}
              onCommit={(nextValue) => {
                setStairToolEndElevationOffsetM(nextValue);
              }}
            />
          </label>
          <label className="field-label">
            <span>Riser Height (m)</span>
            <DraftNumberInput
              step="0.01"
              min="0.05"
              value={stairToolRiserHeightM}
              onCommit={(nextValue) => {
                if (nextValue > 0) {
                  setStairToolRiserHeightM(nextValue);
                }
              }}
            />
          </label>
          <label className="field-label">
            <span>Tread Depth (m)</span>
            <DraftNumberInput
              step="0.01"
              min="0.05"
              value={stairToolTreadDepthM}
              onCommit={(nextValue) => {
                if (nextValue > 0) {
                  setStairToolTreadDepthM(nextValue);
                }
              }}
            />
          </label>
          <label className="field-label">
            <span>Landing Length (m)</span>
            <DraftNumberInput
              step="0.1"
              min="0"
              value={stairToolLandingLengthM}
              onCommit={(nextValue) => {
                if (nextValue >= 0) {
                  setStairToolLandingLengthM(nextValue);
                }
              }}
            />
          </label>
        </div>
      );
    }

    if (activeTool === "Slab") {
      return (
        <div className="field-stack">
          <div className="button-row">
            <button
              type="button"
              className={slabMode === "Rectangle" ? "is-active" : undefined}
              onClick={() => setSlabMode("Rectangle")}
            >
              Rectangle
            </button>
            <button
              type="button"
              className={slabMode === "Circle" ? "is-active" : undefined}
              onClick={() => setSlabMode("Circle")}
            >
              Circle
            </button>
            <button
              type="button"
              className={slabMode === "Freeform" ? "is-active" : undefined}
              onClick={() => setSlabMode("Freeform")}
            >
              Freeform
            </button>
          </div>
          <button
            type="button"
            className={slabConnectEnabled ? "is-active" : undefined}
            onClick={() => setSlabConnectEnabled((enabled) => !enabled)}
          >
            Connect With Other Slabs
          </button>
          {slabMode === "Freeform" ? (
            <p className="muted">Click corners and click the first point to close the slab.</p>
          ) : null}
        </div>
      );
    }

    if (activeTool === "Ground") {
      return (
        <div className="field-stack">
          <p className="muted">
            Drag in the 2D plan to paint a zero-height ground rectangle at world elevation 0.
          </p>
          <label className="field-label">
            <span>Ground Surface</span>
            <select
              value={groundToolKind}
              onChange={(event) => setGroundToolKind(event.target.value as GroundSurface["kind"])}
            >
              <option value="Floor">Floor - gray indoor surface</option>
              <option value="Grass">Grass - green outdoor surface</option>
            </select>
          </label>
        </div>
      );
    }

    if (activeTool === "Rooms") {
      return (
        <div className="field-stack">
          <p className="muted">
            Draw a rectangular or freeform room, or discover closed wall-bounded rooms on the active level.
          </p>
          <div className="button-row">
            <button
              type="button"
              className={roomToolMode === "Rectangle" ? "is-active" : undefined}
              onClick={() => setRoomToolMode("Rectangle")}
            >
              Rectangle
            </button>
            <button
              type="button"
              className={roomToolMode === "Freeform" ? "is-active" : undefined}
              onClick={() => setRoomToolMode("Freeform")}
            >
              Freeform
            </button>
            <button
              type="button"
              className={roomToolMode === "Auto" ? "is-active" : undefined}
              onClick={() => setRoomToolMode("Auto")}
            >
              Auto
            </button>
          </div>
          <label className="field-label">
            <span>{roomToolMode === "Auto" ? "Name Prefix" : "Room Name"}</span>
            <DraftTextInput
              value={roomToolName}
              onCommit={(nextValue) => setRoomToolName(nextValue.trim() || "Room")}
            />
          </label>
          {roomToolMode !== "Auto" ? (
            <button
              type="button"
              className={roomConnectEnabled ? "is-active" : undefined}
              onClick={() => setRoomConnectEnabled((enabled) => !enabled)}
            >
              Connect With Other Rooms
            </button>
          ) : null}
          {roomToolMode === "Freeform" ? (
            <p className="muted">
              Click room corners and click the first point to close the outline. Right-click empty space to cancel.
            </p>
          ) : null}
          {roomToolMode === "Auto" ? (
            <button type="button" onClick={handleDiscoverRooms}>
              Discover Rooms
            </button>
          ) : null}
        </div>
      );
    }

    if (activeTool === "Roof") {
      return (
        <div className="field-stack">
          <p className="muted">
            Drag in the roof layer to draw a roof line. Click two roof lines and link them into one roof face.
          </p>
          <div className="field-grid">
            <label className="field-label">
              <span>Line Elevation (m)</span>
              <DraftNumberInput
                value={roofToolStartElevationM}
                step="0.1"
                min="0"
                onCommit={handleSetRoofToolStartElevation}
              />
            </label>
            {!roofToolEndElevationLocked ? (
              <label className="field-label">
                <span>Line End Elevation (m)</span>
                <DraftNumberInput
                  value={roofToolEndElevationM}
                  step="0.1"
                  min="0"
                  onCommit={handleSetRoofToolEndElevation}
                />
              </label>
            ) : null}
          </div>
          <div className="button-row">
            <button
              type="button"
              className={roofToolEndElevationLocked ? "toggle-button is-active" : "toggle-button"}
              onClick={handleToggleRoofToolEndElevationLock}
            >
              End Follows Start
            </button>
          </div>
          <div className="button-row">
            <button
              type="button"
              onClick={handleLinkSelectedRoofEdges}
              disabled={selectedRoofChainIds.length !== 2}
            >
              Link Selected Lines
            </button>
            <button
              type="button"
              onClick={handleLinkSelectedRoofEdgeToEndpoint}
              disabled={selectedRoofEdgeIds.length !== 2}
            >
              Link Line To Endpoint
            </button>
            <button
              type="button"
              onClick={handleLinkSelectedRoofChainToVertex}
              disabled={selectedRoofChainIds.length !== 1 || selectedRoofVertexIds.length !== 1}
            >
              Link Line To Node
            </button>
            <button
              type="button"
              onClick={clearSelection}
              disabled={selectedRoofEdgeIds.length === 0 && selectedRoofVertexIds.length === 0}
            >
              Clear Selection
            </button>
          </div>
          <p className="muted">
            Selected roof line chains: {selectedRoofChainIds.length} ({selectedRoofEdgeIds.length} segment(s)),
            roof nodes: {selectedRoofVertexIds.length}.
            Link Selected Lines creates a face from two selected chains. Link Line To Endpoint uses the first
            selected segment as the full edge and the closest free endpoint of the second selected segment
            as a triangular face tip. Link Line To Node connects one selected chain directly to one selected node.
          </p>
        </div>
      );
    }

    if (activeTool === "RoofOpening") {
      return (
        <div className="field-stack">
          {selectedRoofOpening ? (
            <>
              <div className="stat-row">
                <span>Selected Roof Opening</span>
                <strong>{selectedRoofOpening.id}</strong>
              </div>
              <div className="stat-row">
                <span>Opening Size</span>
                <strong>
                  {formatNumber(selectedRoofOpening.widthM)} x{" "}
                  {formatNumber(selectedRoofOpening.heightM)} m
                </strong>
              </div>
            </>
          ) : null}
          <label className="field-label">
            <span>Opening Width (m)</span>
            <DraftNumberInput
              value={roofWindowToolWidthM}
              step="0.1"
              min="0.1"
              onCommit={(nextValue) => {
                if (nextValue > 0) {
                  setRoofWindowToolWidthM(nextValue);
                }
              }}
            />
          </label>
          <label className="field-label">
            <span>Opening Height (m)</span>
            <DraftNumberInput
              value={roofWindowToolHeightM}
              step="0.1"
              min="0.1"
              onCommit={(nextValue) => {
                if (nextValue > 0) {
                  setRoofWindowToolHeightM(nextValue);
                }
              }}
            />
          </label>
          <label className="field-label">
            <span>Cut Mode</span>
            <select
              value={roofWindowToolCutMode}
              onChange={(event) =>
                setRoofWindowToolCutMode(event.target.value as RoofOpeningCutMode)
              }
            >
              <option value="NormalToRoof">Normal To Roof</option>
              <option value="Vertical">Vertical</option>
            </select>
          </label>
          <label className="field-label">
            <span>Rotation</span>
            <select
              value={roofWindowToolRotationDeg}
              onChange={(event) =>
                setRoofWindowToolRotationDeg(Number(event.target.value) as RoofOpeningRotationDeg)
              }
            >
              <option value={0}>0 deg</option>
              <option value={90}>90 deg</option>
            </select>
          </label>
          {selectedRoofOpening ? (
            <div className="window-tool-action-row">
              <button
                type="button"
                className="toolbar-button"
                onClick={() => handleDeleteRoofOpening(selectedRoofOpening.id)}
              >
                Delete Opening
              </button>
            </div>
          ) : null}
          <p className="muted">
            Click a roof face to place a roof opening. Right-click an opening while this tool is
            active to delete it.
          </p>
        </div>
      );
    }

    if (activeTool === "RoofWindow") {
      const effectiveRoofWindow3DDesign =
        selectedRoofOpening?.design3D ?? createCurrentWindow3DDesign();
      return (
        <div className="field-stack">
          {selectedRoofOpening ? (
            <>
              <div className="stat-row">
                <span>Selected Roof Opening</span>
                <strong>{selectedRoofOpening.id}</strong>
              </div>
              <div className="stat-row">
                <span>Opening Size</span>
                <strong>
                  {formatNumber(selectedRoofOpening.widthM)} x{" "}
                  {formatNumber(selectedRoofOpening.heightM)} m
                </strong>
              </div>
            </>
          ) : (
            <p className="muted">
              Select a roof opening in 2D or right-click one in the 3D view, then insert or edit the
              skylight frame and glass.
            </p>
          )}
          <label className="field-label">
            <span>Glass Thickness (m)</span>
            <DraftNumberInput
              value={effectiveRoofWindow3DDesign.glassThicknessM}
              step="0.005"
              min="0.001"
              onCommit={(nextValue) => {
                if (nextValue > 0) {
                  handleCommitWindow3DToolDesign(
                    { glassThicknessM: nextValue },
                    "Updated skylight glass thickness.",
                  );
                }
              }}
            />
          </label>
          <label className="field-label">
            <span>Frame Thickness (m)</span>
            <DraftNumberInput
              value={effectiveRoofWindow3DDesign.frameThicknessM}
              step="0.01"
              min="0.005"
              onCommit={(nextValue) => {
                if (nextValue > 0) {
                  handleCommitWindow3DToolDesign(
                    { frameThicknessM: nextValue },
                    "Updated skylight frame thickness.",
                  );
                }
              }}
            />
          </label>
          <label className="field-label">
            <span>Frame Color</span>
            <input
              type="color"
              value={effectiveRoofWindow3DDesign.frameColorHex}
              onChange={(event) =>
                handleCommitWindow3DToolDesign(
                  { frameColorHex: event.target.value },
                  "Updated skylight frame color.",
                )
              }
            />
          </label>
          <label className="field-label">
            <span>Vertical Divisions</span>
            <DraftNumberInput
              value={effectiveRoofWindow3DDesign.verticalDivisions}
              step="1"
              min="0"
              onCommit={(nextValue) => {
                if (nextValue >= 0) {
                  handleCommitWindow3DToolDesign(
                    { verticalDivisions: Math.max(0, Math.round(nextValue)) },
                    "Updated skylight vertical divisions.",
                  );
                }
              }}
            />
          </label>
          <label className="field-label">
            <span>Horizontal Divisions</span>
            <DraftNumberInput
              value={effectiveRoofWindow3DDesign.horizontalDivisions}
              step="1"
              min="0"
              onCommit={(nextValue) => {
                if (nextValue >= 0) {
                  handleCommitWindow3DToolDesign(
                    { horizontalDivisions: Math.max(0, Math.round(nextValue)) },
                    "Updated skylight horizontal divisions.",
                  );
                }
              }}
            />
          </label>
          <label className="field-label">
            <span>Depth Offset From Roof Surface (cm)</span>
            <DraftNumberInput
              value={toCentimeters(effectiveRoofWindow3DDesign.wallDepthOffsetM)}
              step="0.5"
              onCommit={(nextValue) =>
                handleCommitWindow3DToolDesign(
                  { wallDepthOffsetM: toMetersFromCentimeters(nextValue) },
                  "Updated skylight depth offset.",
                )
              }
            />
          </label>
          {selectedRoofOpening ? (
              <div className="window-tool-action-row">
                <button
                  type="button"
                  className="toolbar-button"
                  onClick={() =>
                    selectedRoofOpening.design3D
                      ? handleRemoveRoofWindow3DInsert(selectedRoofOpening.id)
                      : handleApplyRoofWindow3DInsert(selectedRoofOpening.id)
                  }
                >
                  {selectedRoofOpening.design3D ? "Remove 3D Window" : "Insert 3D Window"}
                </button>
              </div>
          ) : null}
          <p className="muted">
            Use Roof Opening to create or delete the hole. This tool only inserts and edits the
            skylight frame and glass inside an existing opening.
          </p>
        </div>
      );
    }

    return (
      <p className="muted">
        This tool works directly in the viewport and does not need a dedicated floating panel.
      </p>
    );
  }

  function renderContextWindowContent() {
    if (selectedNode) {
      return (
        <div className="field-grid">
          <label className="field-label">
            <span>X</span>
            <input
              type="number"
              step="0.1"
              value={selectedNode.position.x}
              onChange={(event) =>
                commitCoordinateInput(event.target.valueAsNumber, (value) =>
                  handleMoveNode(selectedNode.id, createVec2(value, selectedNode.position.y)),
                )
              }
            />
          </label>
          <label className="field-label">
            <span>Y</span>
            <input
              type="number"
              step="0.1"
              value={selectedNode.position.y}
              onChange={(event) =>
                commitCoordinateInput(event.target.valueAsNumber, (value) =>
                  handleMoveNode(selectedNode.id, createVec2(selectedNode.position.x, value)),
                )
              }
            />
          </label>
          <div className="button-row">
            <button type="button" onClick={() => handleDeleteNode(selectedNode.id)}>
              Delete Node
            </button>
          </div>
        </div>
      );
    }

    if (selectedWall) {
      return (
        <div className="field-stack">
          <label className="field-label">
            <span>Wall Type</span>
            <select
              value={selectedWall.wallTypeId}
              onChange={(event) =>
                handleUpdateSelectedWall(
                  { wallTypeId: event.target.value },
                  "Updated wall type assignment.",
                )
              }
            >
              {project.wallTypes.map((wallType) => (
                <option key={wallType.id} value={wallType.id}>
                  {wallType.name} ({formatNumber(wallType.thicknessM)} m)
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            <span>Wall Top</span>
            <select
              value={selectedWall.topMode}
              onChange={(event) =>
                handleUpdateSelectedWall(
                  { topMode: event.target.value as WallTopMode },
                  `Updated wall top mode to ${event.target.value}.`,
                )
              }
            >
              <option value="FixedHeight">Fixed Height</option>
              <option value="FollowRoof">Follow Roof</option>
            </select>
          </label>
          <div className="button-row">
            <button type="button" onClick={() => handleDeleteWall(selectedWall.id)}>
              Delete Wall
            </button>
          </div>
        </div>
      );
    }

    if (selectedDoor) {
      return (
        <div className="field-grid">
          <label className="field-label">
            <span>Width (m)</span>
            <input
              type="number"
              step="0.1"
              min="0.2"
              value={selectedDoor.widthM}
              onChange={(event) =>
                commitNumericInput(event.target.valueAsNumber, (value) =>
                  handleUpdateSelectedDoor({ widthM: value }, "Updated door width."),
                )
              }
            />
          </label>
          <label className="field-label">
            <span>Height (m)</span>
            <input
              type="number"
              step="0.1"
              min="0.2"
              value={selectedDoor.heightM}
              onChange={(event) =>
                commitNumericInput(event.target.valueAsNumber, (value) =>
                  handleUpdateSelectedDoor({ heightM: value }, "Updated door height."),
                )
              }
            />
          </label>
          <label className="field-label">
            <span>Offset (m)</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={selectedDoor.offsetM}
              onChange={(event) =>
                commitNumericInput(event.target.valueAsNumber, (value) =>
                  handleUpdateSelectedDoor({ offsetM: value }, "Updated door position."),
                )
              }
            />
          </label>
          <div className="button-row">
            <button type="button" onClick={() => handleDeleteDoor(selectedDoor.id)}>
              Delete Door
            </button>
          </div>
        </div>
      );
    }

    if (selectedWindow) {
      return (
        <div className="field-grid">
          <label className="field-label">
            <span>Width (m)</span>
            <input
              type="number"
              step="0.1"
              min="0.2"
              value={selectedWindow.widthM}
              onChange={(event) =>
                commitNumericInput(event.target.valueAsNumber, (value) =>
                  handleUpdateSelectedWindow({ widthM: value }, "Updated window width."),
                )
              }
            />
          </label>
          <label className="field-label">
            <span>Height (m)</span>
            <input
              type="number"
              step="0.1"
              min="0.2"
              value={selectedWindow.heightM}
              onChange={(event) =>
                commitNumericInput(event.target.valueAsNumber, (value) =>
                  handleUpdateSelectedWindow({ heightM: value }, "Updated window height."),
                )
              }
            />
          </label>
          <label className="field-label">
            <span>Sill Height (m)</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={selectedWindow.sillHeightM}
              onChange={(event) =>
                commitNumericInput(event.target.valueAsNumber, (value) =>
                  handleUpdateSelectedWindow(
                    { sillHeightM: value },
                    "Updated window sill height.",
                  ),
                )
              }
            />
          </label>
          <label className="field-label">
            <span>Offset (m)</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={selectedWindow.offsetM}
              onChange={(event) =>
                commitNumericInput(event.target.valueAsNumber, (value) =>
                  handleUpdateSelectedWindow({ offsetM: value }, "Updated window position."),
                )
              }
              />
            </label>
          {viewportMode === "3d" ? (
            <>
              <label className="field-label">
                <span>Glass Thickness (m)</span>
                <input
                  type="number"
                  step="0.005"
                  min="0.001"
                  value={selectedWindow.design3D?.glassThicknessM ?? window3DGlassThicknessM}
                  onChange={(event) =>
                    commitNumericInput(event.target.valueAsNumber, (value) =>
                      handleUpdateSelectedWindow(
                        {
                          design3D: {
                            ...(selectedWindow.design3D ?? createCurrentWindow3DDesign()),
                            glassThicknessM: value,
                          },
                        },
                        "Updated 3D window glass thickness.",
                      ),
                    )
                  }
                />
              </label>
              <label className="field-label">
                <span>Frame Thickness (m)</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.005"
                  value={selectedWindow.design3D?.frameThicknessM ?? window3DFrameThicknessM}
                  onChange={(event) =>
                    commitNumericInput(event.target.valueAsNumber, (value) =>
                      handleUpdateSelectedWindow(
                        {
                          design3D: {
                            ...(selectedWindow.design3D ?? createCurrentWindow3DDesign()),
                            frameThicknessM: value,
                          },
                        },
                        "Updated 3D window frame thickness.",
                      ),
                    )
                  }
                />
              </label>
            </>
          ) : null}
          <div className="button-row">
            {viewportMode === "3d" ? (
              <button
                type="button"
                className="toolbar-button"
                onClick={() =>
                  selectedWindow.design3D
                    ? handleRemoveWindow3DInsert(selectedWindow.id)
                    : handleApplyWindow3DInsert(selectedWindow.id)
                }
              >
                {selectedWindow.design3D ? "Delete Window" : "Insert 3D Window"}
              </button>
            ) : null}
            <button
              type="button"
              className="toolbar-button"
              onClick={() => handleDeleteWindow(selectedWindow.id)}
            >
              Delete Opening
            </button>
          </div>
        </div>
      );
    }

    if (selectedStair) {
      return (
        <div className="field-grid">
          <label className="field-label">
            <span>Width (m)</span>
            <input
              type="number"
              step="0.1"
              min="0.3"
              value={selectedStair.widthM}
              onChange={(event) =>
                commitNumericInput(event.target.valueAsNumber, (value) =>
                  handleUpdateSelectedStair({ widthM: value }, "Updated stair width."),
                )
              }
            />
          </label>
          <label className="field-label">
            <span>Top Above Level (m)</span>
            <input
              type="number"
              step="0.1"
              value={
                selectedStairLevel
                  ? selectedStair.endElevationM - selectedStairLevel.elevationM
                  : selectedStair.endElevationM
              }
              onChange={(event) =>
                commitNumericInput(event.target.valueAsNumber, (value) =>
                  handleUpdateSelectedStair(
                    {
                      endElevationM: selectedStairLevel
                        ? selectedStairLevel.elevationM + value
                        : value,
                    },
                    "Updated stair end elevation.",
                  ),
                )
              }
            />
          </label>
          <div className="button-row">
            <button type="button" onClick={() => handleDeleteStair(selectedStair.id)}>
              Delete Stair
            </button>
          </div>
        </div>
      );
    }

    if (selectedShape) {
      return (
        <div className="field-grid">
          <label className="field-label">
            <span>Kind</span>
            <select
              value={selectedShape.kind}
              onChange={(event) =>
                handleUpdateSelectedShape(
                  { kind: event.target.value as Shape["kind"] },
                  `Changed shape kind to ${event.target.value}.`,
                )
              }
            >
              <option value="Square">Square</option>
              <option value="Cylinder">Cylinder</option>
            </select>
          </label>
          <label className="field-label">
            <span>Size (m)</span>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={selectedShape.sizeM}
              onChange={(event) =>
                commitNumericInput(event.target.valueAsNumber, (value) =>
                  handleUpdateSelectedShape({ sizeM: value }, "Updated shape size."),
                )
              }
            />
          </label>
          <label className="field-label">
            <span>Height (m)</span>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={selectedShape.heightM}
              onChange={(event) =>
                commitNumericInput(event.target.valueAsNumber, (value) =>
                  handleUpdateSelectedShape({ heightM: value }, "Updated shape height."),
                )
              }
            />
          </label>
          <div className="button-row">
            <button type="button" onClick={() => handleDeleteShape(selectedShape.id)}>
              Delete Shape
            </button>
          </div>
        </div>
      );
    }

    if (selectedSlab) {
      return (
        <div className="field-grid">
          {selectedSlab.kind === "Rectangle" ? (
            <label className="field-label">
              <span>Roof Type</span>
              <select
                value={selectedSlab.roofType}
                onChange={(event) =>
                  handleUpdateSelectedSlab(
                    { roofType: event.target.value as RoofType },
                    `Updated slab roof type to ${event.target.value}.`,
                  )
                }
              >
                <option value="Flat">Flat</option>
                <option value="Gable">Sedlova</option>
                <option value="Shed">Pultova</option>
                <option value="Hip">Stanova</option>
              </select>
            </label>
          ) : null}
          {selectedSlab.kind !== "Freeform" ? (
            <>
              <label className="field-label">
                <span>Width (m)</span>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={selectedSlab.widthM}
                  onChange={(event) =>
                    commitNumericInput(event.target.valueAsNumber, (value) =>
                      handleUpdateSelectedSlab({ widthM: value }, "Updated slab width."),
                    )
                  }
                />
              </label>
              <label className="field-label">
                <span>Depth (m)</span>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={selectedSlab.depthM}
                  onChange={(event) =>
                    commitNumericInput(event.target.valueAsNumber, (value) =>
                      handleUpdateSelectedSlab({ depthM: value }, "Updated slab depth."),
                    )
                  }
                />
              </label>
            </>
          ) : (
            <div className="stat-row">
              <span>Editable Corners</span>
              <strong>{selectedSlab.polygon.length}</strong>
            </div>
          )}
          {selectedSlab.kind === "Rectangle" && selectedSlab.roofType !== "Flat" ? (
            <label className="field-label">
              <span>Roof Rise (m)</span>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={selectedSlab.roofRiseM}
                onChange={(event) =>
                  commitNumericInput(event.target.valueAsNumber, (value) =>
                    handleUpdateSelectedSlab(
                      { roofRiseM: value },
                      "Updated roof rise.",
                    ),
                  )
                }
              />
            </label>
          ) : null}
          <div className="button-row">
            <button type="button" onClick={() => handleDeleteSlab(selectedSlab.id)}>
              Delete Slab
            </button>
          </div>
        </div>
      );
    }

    if (selectedGroundSurface) {
      return (
        <div className="field-grid">
          <label className="field-label">
            <span>Surface</span>
            <select
              value={selectedGroundSurface.kind}
              onChange={(event) =>
                handleUpdateSelectedGroundSurface(
                  { kind: event.target.value as GroundSurface["kind"] },
                  `Updated ground surface to ${event.target.value}.`,
                )
              }
            >
              <option value="Floor">Floor</option>
              <option value="Grass">Grass</option>
            </select>
          </label>
          <label className="field-label">
            <span>Width (m)</span>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={selectedGroundSurface.widthM}
              onChange={(event) =>
                commitNumericInput(event.target.valueAsNumber, (value) =>
                  handleUpdateSelectedGroundSurface({ widthM: value }, "Updated ground width."),
                )
              }
            />
          </label>
          <label className="field-label">
            <span>Depth (m)</span>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={selectedGroundSurface.depthM}
              onChange={(event) =>
                commitNumericInput(event.target.valueAsNumber, (value) =>
                  handleUpdateSelectedGroundSurface({ depthM: value }, "Updated ground depth."),
                )
              }
            />
          </label>
          <div className="button-row">
            <button
              type="button"
              onClick={() => handleDeleteGroundSurface(selectedGroundSurface.id)}
            >
              Delete Ground
            </button>
          </div>
        </div>
      );
    }

    if (selectedRoom) {
      return (
        <div className="field-grid">
          <label className="field-label">
            <span>Name</span>
            <DraftTextInput
              value={selectedRoom.name}
              onCommit={(nextValue) =>
                handleUpdateSelectedRoom(
                  { name: nextValue.trim() || "Room" },
                  `Renamed room to "${nextValue.trim() || "Room"}".`,
                )
              }
            />
          </label>
          <div className="stat-row">
            <span>Area</span>
            <strong>{formatNumber(calculatePolygonAreaM2(selectedRoom.polygon))} m2</strong>
          </div>
          <div className="stat-row">
            <span>Points</span>
            <strong>{selectedRoom.polygon.length}</strong>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => handleDeleteRoom(selectedRoom.id)}>
              Delete Room
            </button>
          </div>
        </div>
      );
    }

    if (
      selectedRoofSketch &&
      selectedRoofEdge &&
      selectedRoofEdgeStartVertex &&
      selectedRoofEdgeEndVertex
    ) {
      const startElevationM =
        selectedRoofEdgeStartVertex.elevationM ?? selectedRoofSketch.baseElevationM;
      const endElevationM =
        selectedRoofEdgeEndVertex.elevationM ?? selectedRoofSketch.baseElevationM;
      const commonElevationM = (startElevationM + endElevationM) / 2;
      return (
        <div className="field-grid">
          <label className="field-label">
            <span>Start Elevation (m)</span>
            <DraftNumberInput
              step="0.1"
              value={startElevationM}
              onCommit={(nextValue) =>
                handleUpdateSelectedRoofEdgeEndpointElevations(
                  nextValue,
                  endElevationM,
                  `Updated roof line start elevation to ${formatNumber(nextValue)} m.`,
                )
              }
            />
          </label>
          <label className="field-label">
            <span>End Elevation (m)</span>
            <DraftNumberInput
              step="0.1"
              value={endElevationM}
              onCommit={(nextValue) =>
                handleUpdateSelectedRoofEdgeEndpointElevations(
                  startElevationM,
                  nextValue,
                  `Updated roof line end elevation to ${formatNumber(nextValue)} m.`,
                )
              }
            />
          </label>
          <label className="field-label">
            <span>Set Both (m)</span>
            <DraftNumberInput
              step="0.1"
              value={commonElevationM}
              onCommit={handleUpdateSelectedRoofEdgeElevation}
            />
          </label>
          <div className="field-label">
            <span>Start</span>
            <strong>
              {formatNumber(selectedRoofEdgeStartVertex.position.x)},{" "}
              {formatNumber(selectedRoofEdgeStartVertex.position.y)} /{" "}
              {formatNumber(startElevationM)} m
            </strong>
          </div>
          <div className="field-label">
            <span>End</span>
            <strong>
              {formatNumber(selectedRoofEdgeEndVertex.position.x)},{" "}
              {formatNumber(selectedRoofEdgeEndVertex.position.y)} /{" "}
              {formatNumber(endElevationM)} m
            </strong>
          </div>
          <p className="muted">
            Start and end elevations can differ, so one roof line can slope along its length.
            Set Both keeps the line level when you need a classic eave or ridge.
          </p>
        </div>
      );
    }

    if (selectedRoofFaceSketch && selectedRoofFace) {
      const faceThicknessM = selectedRoofFace.thicknessM ?? selectedRoofFaceSketch.thicknessM;
      return (
        <div className="field-grid">
          <label className="field-label">
            <span>Thickness Down (m)</span>
            <DraftNumberInput
              min={0.01}
              step="0.01"
              value={faceThicknessM}
              onCommit={handleUpdateSelectedRoofFaceThickness}
            />
          </label>
          <div className="field-label">
            <span>Vertices</span>
            <strong>{selectedRoofFace.vertexIds.length}</strong>
          </div>
          <div className="field-label">
            <span>Sketch</span>
            <strong>{selectedRoofFaceSketch.name}</strong>
          </div>
          <p className="muted">
            Roof face thickness is currently extruded vertically downward in 3D and used by roof-following walls.
          </p>
        </div>
      );
    }

    if (selectedExternalModel) {
      return (
        <div className="field-grid">
          <label className="field-label">
            <span>Name</span>
            <input
              type="text"
              value={selectedExternalModel.name}
              onChange={(event) =>
                handleUpdateSelectedExternalModel(
                  { name: event.target.value },
                  `Updated model "${event.target.value}".`,
                )
              }
            />
          </label>
          <label className="field-label">
            <span>URI</span>
            <input
              type="text"
              value={selectedExternalModel.uri}
              onChange={(event) =>
                handleUpdateSelectedExternalModel(
                  { uri: event.target.value },
                  "Updated model URI.",
                )
              }
            />
          </label>
          <div className="button-row">
            <button type="button" onClick={() => handleDeleteExternalModel(selectedExternalModel.id)}>
              Delete Model
            </button>
          </div>
        </div>
      );
    }

    return <p className="muted">Select an entity to edit it here.</p>;
  }

  return (
    <main className="shell-page">
      <input
        ref={fileInputRef}
        type="file"
        accept=".wawod,.json,application/json"
        hidden
        onChange={handleImportChange}
      />

      <header className="top-toolbar top-toolbar-overlay">
        <div className="toolbar-group">
          <span className="brand-mark">WaWoD Studio</span>
          <div className="tool-strip">
            {availableEditorTools.map((tool) => {
              if (tool === "ExternalShading") {
                return null;
              }

              if (otherEditorTools.includes(tool)) {
                return tool === otherEditorTools[0] ? (
                  <div key="other-tools" ref={otherToolsMenuRef} className="toolbar-split-menu">
                    <button
                      type="button"
                      className={
                        otherEditorTools.includes(activeTool)
                          ? "toolbar-button is-active"
                          : "toolbar-button"
                      }
                      onClick={() => {
                        setIsOtherToolsMenuOpen((current) => !current);
                        setOpeningToolsMenuOpen(null);
                        setIsPreviewMenuOpen(false);
                        setIsSettingsMenuOpen(false);
                      }}
                      aria-haspopup="menu"
                      aria-expanded={isOtherToolsMenuOpen}
                    >
                      Other Tools
                    </button>
                    {isOtherToolsMenuOpen ? (
                      <div className="toolbar-menu-panel">
                        {otherEditorTools.map((otherTool) => (
                          <button
                            key={otherTool}
                            type="button"
                            className={
                              otherTool === activeTool
                                ? "toolbar-menu-item is-active"
                                : "toolbar-menu-item"
                            }
                            onClick={() => {
                              setActiveTool(otherTool);
                              setIsOtherToolsMenuOpen(false);
                            }}
                          >
                            {getEditorToolLabel(otherTool)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null;
              }

              if (viewportMode === "3d" && (tool === "Door" || tool === "Window")) {
                const isShadingAnchor =
                  activeTool === "ExternalShading" && externalShadingToolbarAnchor === tool;
                return (
                  <div
                    key={tool}
                    ref={tool === "Door" ? doorToolsMenuRef : windowToolsMenuRef}
                    className="toolbar-split-menu"
                  >
                    <button
                      type="button"
                      className={tool === activeTool ? "toolbar-button is-active" : "toolbar-button"}
                      onClick={() => {
                        setActiveTool(tool);
                        setOpeningToolsMenuOpen(null);
                      }}
                    >
                      {getEditorToolLabel(tool)}
                    </button>
                    <button
                      type="button"
                      className={
                        isShadingAnchor
                          ? "toolbar-button toolbar-split-toggle is-active"
                          : "toolbar-button toolbar-split-toggle"
                      }
                      onClick={() => {
                        setOpeningToolsMenuOpen((current) => (current === tool ? null : tool));
                        setIsOtherToolsMenuOpen(false);
                        setIsPreviewMenuOpen(false);
                        setIsSettingsMenuOpen(false);
                      }}
                      aria-label={`${tool} related tools`}
                      aria-haspopup="menu"
                      aria-expanded={openingToolsMenuOpen === tool}
                    >
                      v
                    </button>
                    {openingToolsMenuOpen === tool ? (
                      <div className="toolbar-menu-panel">
                        <button
                          type="button"
                          className={
                            activeTool === "ExternalShading"
                              ? "toolbar-menu-item is-active"
                              : "toolbar-menu-item"
                          }
                          onClick={() => {
                            setExternalShadingToolbarAnchor(tool);
                            setActiveTool("ExternalShading");
                            setOpeningToolsMenuOpen(null);
                          }}
                        >
                          External Shading
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              }

              return (
                <button
                  key={tool}
                  type="button"
                  className={tool === activeTool ? "toolbar-button is-active" : "toolbar-button"}
                  onClick={() => setActiveTool(tool)}
                >
                  {getEditorToolLabel(tool)}
                </button>
              );
            })}
            {editorMode !== "Building" ? (
              <span className="toolbar-empty-state">Tools will be added here</span>
            ) : null}
          </div>
        </div>

        <div className="toolbar-group toolbar-actions">
          <span className="toolbar-chip">{project.projectName}</span>
          <button
            type="button"
            className="toolbar-button"
            onClick={handleUndo}
            disabled={!canUndo || isHistoryTransactionOpen}
          >
            Undo
          </button>
          <button
            type="button"
            className="toolbar-button"
            onClick={handleRedo}
            disabled={!canRedo || isHistoryTransactionOpen}
          >
            Redo
          </button>
          <button
            type="button"
            className="toolbar-button"
            onClick={() => fileInputRef.current?.click()}
          >
            Import JSON
          </button>
          <button type="button" className="toolbar-button" onClick={handleExport}>
            Export JSON
          </button>
          <div ref={previewMenuRef} className="toolbar-split-menu">
            <button
              type="button"
              className={viewportMode === "3d" ? "toolbar-button is-active" : "toolbar-button ghost"}
              onClick={handleTogglePreviewMode}
            >
              {viewportMode === "3d" ? "Back To 2D" : "Open 3D View"}
            </button>
            <button
              type="button"
              className="toolbar-button ghost toolbar-split-toggle"
              onClick={() => {
                setIsPreviewMenuOpen((current) => !current);
                setIsOtherToolsMenuOpen(false);
                setIsSettingsMenuOpen(false);
              }}
              aria-label="Preview options"
              aria-expanded={isPreviewMenuOpen}
            >
              v
            </button>
            {isPreviewMenuOpen ? (
              <div className="toolbar-menu-panel">
                <button
                  type="button"
                  className="toolbar-menu-item"
                  onClick={handleOpenPreviewInNewTab}
                >
                  Detached Preview
                </button>
              </div>
            ) : null}
          </div>
          <div ref={editorMenuRef} className="toolbar-split-menu editor-mode-menu">
            <button
              type="button"
              className="toolbar-button is-active editor-mode-button"
              onClick={() => {
                setIsEditorMenuOpen((current) => !current);
                setIsOtherToolsMenuOpen(false);
                setOpeningToolsMenuOpen(null);
                setIsPreviewMenuOpen(false);
                setIsSettingsMenuOpen(false);
              }}
              aria-haspopup="menu"
              aria-expanded={isEditorMenuOpen}
            >
              {editorMode} Editor
            </button>
            <button
              type="button"
              className="toolbar-button toolbar-split-toggle is-active"
              onClick={() => {
                setIsEditorMenuOpen((current) => !current);
                setIsOtherToolsMenuOpen(false);
                setOpeningToolsMenuOpen(null);
                setIsPreviewMenuOpen(false);
                setIsSettingsMenuOpen(false);
              }}
              aria-label="Choose editor"
              aria-haspopup="menu"
              aria-expanded={isEditorMenuOpen}
            >
              v
            </button>
            {isEditorMenuOpen ? (
              <div className="toolbar-menu-panel editor-mode-menu-panel">
                {editorModes.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={
                      mode === editorMode
                        ? "toolbar-menu-item is-active"
                        : "toolbar-menu-item"
                    }
                    onClick={() => {
                      setEditorMode(mode);
                      setIsEditorMenuOpen(false);
                      reportSuccess(`Switched to ${mode} Editor.`);
                    }}
                  >
                    <strong>{mode} Editor</strong>
                    <span>{getEditorModeDescription(mode)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
            <div ref={settingsMenuRef} className="toolbar-split-menu">
              <button
                type="button"
                className="toolbar-button ghost toolbar-icon-button"
                onClick={() => {
                  setIsSettingsMenuOpen((current) => !current);
                  setIsOtherToolsMenuOpen(false);
                  setIsPreviewMenuOpen(false);
                }}
                aria-label="Project settings"
                aria-expanded={isSettingsMenuOpen}
              >
                ⚙
              </button>
              {isSettingsMenuOpen ? (
                <div className="toolbar-menu-panel toolbar-menu-panel-wide">
                  <label className="field-label">
                    <span>Project Name</span>
                    <DraftTextInput
                      value={projectNameDraft}
                      onCommit={(nextValue) => {
                        setProjectNameDraft(nextValue);
                        replaceProject(
                          {
                            ...project,
                            projectName: nextValue,
                          },
                          true,
                        );
                      }}
                    />
                  </label>
                  <label className="field-label">
                    <span>Wall Authoring</span>
                    <select
                      value={wallAuthoringMode}
                      onChange={(event) =>
                        setWallAuthoringMode(event.target.value as WallAuthoringMode)
                      }
                    >
                      <option value="AutoWall">AutoWall</option>
                      <option value="Topology">Topology</option>
                    </select>
                  </label>
                  <div className="field-stack">
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={floatingWindowVisibility.levels}
                        onChange={() => toggleFloatingWindow("levels")}
                      />
                      <span>Show Levels</span>
                    </label>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={floatingWindowVisibility.wallTypes}
                        onChange={() => toggleFloatingWindow("wallTypes")}
                      />
                      <span>Show Wall Types</span>
                    </label>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={floatingWindowVisibility.grid}
                        onChange={() => toggleFloatingWindow("grid")}
                      />
                      <span>Show Grid</span>
                    </label>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={floatingWindowVisibility.tool}
                        onChange={() => toggleFloatingWindow("tool")}
                      />
                      <span>Show Tool Window</span>
                    </label>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={floatingWindowVisibility.context}
                        onChange={() => toggleFloatingWindow("context")}
                      />
                      <span>Show Context Window</span>
                    </label>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={panelVisibility.statusBarVisible}
                        onChange={() => setStatusBarVisible(!panelVisibility.statusBarVisible)}
                      />
                      <span>Show Footer Overlay</span>
                    </label>
                  </div>
                  <p className="muted">`F` fits selection. `Shift+F` fits the active level.</p>
                  <div className="button-row">
                    <button type="button" onClick={resetViewport}>
                      Reset View
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        resetProject();
                        clearSelection();
                        reportSuccess("Reset the project back to an empty WaWoD Studio baseline.");
                      }}
                    >
                      Reset Project
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          <span className={isDirty ? "state-pill is-dirty" : "state-pill"}>
            {isDirty ? "Unsaved Changes" : "Saved"}
          </span>
        </div>
      </header>

      <section className="workspace-layout">
        <section className="viewport-shell">
          <div className="viewport-header">
            <div>
              <p className="section-kicker">Viewport</p>
              <DraftTextInput
                className="project-title-input"
                value={projectNameDraft}
                onCommit={(nextValue) => {
                  setProjectNameDraft(nextValue);
                  replaceProject(
                    {
                      ...project,
                      projectName: nextValue,
                    },
                    true,
                  );
                }}
                aria-label="Project name"
              />
            </div>
            <div className="viewport-meta">
              <span>{projectSummary}</span>
              <span>Editor: {editorMode}</span>
              {editorMode === "Building" ? <span>Tool: {activeTool}</span> : null}
              {editorMode === "Building" ? <span>Level: {activeLevelName}</span> : null}
              {editorMode === "Building" ? <span>Wall Type: {activeWallTypeName}</span> : null}
            </div>
          </div>

          <div ref={viewportCanvasRef} className="viewport-canvas">
            {viewportMode === "2d" ? (
              <>
                <ViewportScene
                  project={visibleProject2D}
                  readOnly={editorMode !== "Building"}
                  activeTool={activeTool}
                  wallAuthoringMode={wallAuthoringMode}
                  activeLevelId={activeLevelId}
                  slabMode={slabMode}
                  groundToolKind={groundToolKind}
                  roomToolMode={roomToolMode}
                  pendingWallStartNodeId={pendingWallStartNodeId}
                  currentSelection={currentSelection}
                  selectionSet={selectionSet}
                  stairToolWidthM={stairToolWidthM}
                  viewport={viewport}
                  onPanChange={setPan}
                  onZoomChange={setZoom}
                  onCursorWorldChange={setCursorWorld}
                  onSelectionChange={setSingleSelection}
                  onSelectionSetChange={setSelectionSet}
                  onPendingWallStartNodeChange={setPendingWallStartNodeId}
                  onCreateNodeAt={handleCreateNodeAt}
                  onInsertNodeIntoWall={handleInsertNodeIntoWall}
                  onCreateDoorOnWall={handleCreateDoorOnWall}
                  onCreateWindowOnWall={handleCreateWindowOnWall}
                  onCreateMeasurement={handleCreateMeasurement}
                  onCreateStair={handleCreateStair}
                  onCreateShapeAt={handleCreateShapeAt}
                  onCreateSlabAt={handleCreateSlabAt}
                  onCreateSlabFromPolygon={handleCreateSlabFromPolygon}
                  onCreateGroundSurfaceAt={handleCreateGroundSurfaceAt}
                  onCreateRoomFromPolygon={handleCreateRoomFromPolygon}
                  onCreateRoofLine={handleCreateRoofLine}
                  onCreateRoofOpening={handleCreateRoofOpening}
                  onCreateExternalModelAt={handleCreateExternalModelAt}
                  onCreateWallBetweenNodes={handleCreateWallBetweenNodes}
                  onCreateWallByDrag={handleCreateWallByDrag}
                  onDeleteNode={handleDeleteNode}
                  onDeleteWall={handleDeleteWall}
                  onDeleteDoor={handleDeleteDoor}
                  onDeleteWindow={handleDeleteWindow}
                  onDeleteRoofOpening={handleDeleteRoofOpening}
                  onDeleteRoofEdge={handleDeleteRoofEdge}
                  onDeleteMeasurement={handleDeleteMeasurement}
                  onDeleteStair={handleDeleteStair}
                  onDeleteWallsConnectedToNode={handleDeleteWallsConnectedToNode}
                  onDeleteShape={handleDeleteShape}
                  onDeleteSlab={handleDeleteSlab}
                  onDeleteGroundSurface={handleDeleteGroundSurface}
                  onDeleteRoom={handleDeleteRoom}
                  onDeleteExternalModel={handleDeleteExternalModel}
                  measureToolUnit={measureToolUnit}
                  measureToolPermanent={measureToolPermanent}
                  onMoveInteractionStart={handleMoveInteractionStart}
                  onMoveInteractionCommit={handleMoveInteractionCommit}
                  onMoveInteractionCancel={handleMoveInteractionCancel}
                  onMoveNode={handleMoveNode}
                  onMoveDoor={handleMoveDoor}
                  onMoveWindow={handleMoveWindow}
                  onMoveShape={handleMoveShape}
                  onMoveSlab={handleMoveSlab}
                  onMoveGroundSurface={handleMoveGroundSurface}
                  onMoveRoom={handleMoveRoom}
                  onResizeSlab={handleResizeSlab}
                  onUpdateSlabPolygon={handleUpdateSlabPolygon}
                  onMoveRoofEdge={handleMoveRoofEdge}
                  onMoveRoofVertex={handleMoveRoofVertex}
                  onMoveRoofOpening={handleMoveRoofOpening}
                  onMoveExternalModel={handleMoveExternalModel}
                />
                <div className="viewport-overlay viewport-overlay-top">+Y</div>
                <div className="viewport-overlay viewport-overlay-right">+X</div>
              </>
            ) : (
              <ViewportScene3D
                project={visibleProject3D}
                preview3D={preview3D}
                onPreview3DChange={setPreview3D}
                activeTool={editorMode === "Building" ? activeTool : undefined}
                selectedDoorId={editorMode === "Building" ? selectedDoor?.id ?? null : null}
                onSelectDoor={editorMode === "Building" ? handleSelectDoor3D : undefined}
                onInsertDoor3D={editorMode === "Building" ? handleApplyDoor3DInsert : undefined}
                onApplyExternalShadingToDoor={editorMode === "Building" ? handleApplyExternalShadingToDoor : undefined}
                selectedWindowId={editorMode === "Building" ? selectedWindow?.id ?? null : null}
                onSelectWindow={editorMode === "Building" ? handleSelectWindow3D : undefined}
                onClearOpeningSelection={editorMode === "Building" ? handleClear3DOpeningSelection : undefined}
                onInsertWindow3D={editorMode === "Building" ? handleApplyWindow3DInsert : undefined}
                onApplyExternalShadingToWindow={editorMode === "Building" ? handleApplyExternalShadingToWindow : undefined}
                selectedRoofOpeningId={editorMode === "Building" ? selectedRoofOpening?.id ?? null : null}
                onSelectRoofOpening={editorMode === "Building" ? handleSelectRoofWindow3D : undefined}
                onInsertRoofWindow3D={editorMode === "Building" ? handleApplyRoofWindow3DInsert : undefined}
                selectedSolarPanelArrayId={editorMode === "Building" ? selectedSolarPanelArray?.id ?? null : null}
                onSelectSolarPanelArray={editorMode === "Building" ? handleSelectSolarPanelArray : undefined}
                onCreateSolarPanelArray={editorMode === "Building" ? handleCreateSolarPanelArray : undefined}
                onMoveSolarPanelArray={editorMode === "Building" ? handleMoveSolarPanelArray : undefined}
                solarPanelToolDesign={solarPanelToolDesign}
                door3DToolDesign={createCurrentDoor3DDesign()}
                window3DToolDesign={createCurrentWindow3DDesign()}
                externalShadingToolDesign={
                  externalShadingKind === "ExternalBlinds"
                    ? { kind: "ExternalBlinds", design: externalBlindsToolDesign }
                    : { kind: "RollerShutter", design: externalRollerShutterToolDesign }
                }
                externalShadingFitOpeningWidth={externalShadingFitOpeningWidth}
                hiddenRoofLayerIds={hiddenRoofLayerIds3D}
              />
            )}

            {editorMode !== "Building" ? (
              <div className={`editor-workspace-placeholder is-${editorMode.toLowerCase()}`}>
                <p className="section-kicker">{editorMode} Editor</p>
                <h2>Workspace ready for future tools</h2>
                <p>{getEditorModeDescription(editorMode)}</p>
                <span>
                  The building model is a read-only reference. Switch between 2D and 3D without changing structural data.
                </span>
              </div>
            ) : null}

            <div className="activity-banner">
              <strong>{activityMessage}</strong>
              {errorMessage ? <span className="error-text">{errorMessage}</span> : null}
            </div>

            {panelVisibility.helpCardOpen ? (
            <div className="viewport-card viewport-card-overlay">
              <div className="viewport-card-header">
                <div>
                  <p className="section-kicker">Hint</p>
                  <h2>{editorMode === "Building" ? "Current editor controls" : `${editorMode} Editor`}</h2>
                </div>
                <button
                  type="button"
                  className="viewport-card-close"
                  onClick={() => setHelpCardOpen(false)}
                  aria-label="Hide help"
                >
                  x
                </button>
              </div>
              {editorMode === "Building" ? (
              <>
              <p>
                Frontend mode is now tuned around direct viewport editing, grouped history,
                local import/export and tool-specific left-place or right-delete behavior.
              </p>
              <p className="muted">
                Move Tool: left-drag moves the current entity or the whole selected set,
                drag roof line endpoints to stretch roof lines, right-drag draws a box selection,
                and Ctrl/Cmd+C then Ctrl/Cmd+V copies and pastes the current movable selection
                with a small offset.
              </p>
              <p className="muted">
                Node Tool: left-click places a node, or hold and drag to measure from the start point
                and place the node on release. Right-click deletes a node, and duplicate nodes cannot
                be placed on the same spot. If several entities overlap under a right-click, choose
                the intended entity from the viewport menu instead.
              </p>
              <p className="muted">
                Wall Tool: click one node to arm the start point, click a second
                node to create a wall, right-click a wall to delete just that wall, and
                right-click a node to delete all walls connected to that node.
              </p>
              <p className="muted">
                Measure Tool: drag a 2D ruler to read distance in cm, dm or m. With permanent
                storage enabled, releasing creates a plan measurement. Right-click a stored
                measurement while Measure Tool is active to delete it.
              </p>
              <p className="muted">
                Door Tool: click an existing wall to insert a door opening with the current
                width and height defaults, then adjust the exact values in the inspector.
                Right-click a door while Door Tool is active to delete it.
              </p>
              <p className="muted">
                Window Tool: click an existing wall to insert a window opening with width,
                height and sill defaults. Right-click a window while Window Tool is active to
                delete it.
              </p>
              <p className="muted">
                Stair Tool: left-click places stair path nodes, and right-click finishes the
                current path into a generated stair. Intermediate path nodes create flat landings.
              </p>
              <p className="muted">
                Shape Tool: click and drag to draw the shape size. Slab Tool: drag to draw
                a rectangle slab, in circle mode click for center and drag radius, or in freeform
                mode click straight-edged corners and close the outline at its first point. Connected
                slab mode unions touching or overlapping flat outlines. Rooms Tool can draw rectangles,
                close freeform outlines, or discover wall-bounded rooms automatically. Its optional
                connected mode unions touching or overlapping rooms on the active level. Ground Tool
                paints floor or grass rectangles, and Model Tool places a marker.
              </p>
              <p className="muted">
                Shape, Slab and Model delete: right-click the entity while its matching tool
                is active, or use the inspector delete action on the current selection.
              </p>
              <p className="muted">
                The right panel controls active level, wall type, grid, display presets and
                selection inspectors. Ground floor cannot be removed, but other levels can.
              </p>
              <p className="muted">
                Inspector focus keeps the related entity selected, and X/Y edits follow grid snap
                whenever snapping is enabled.
              </p>
              <p className="muted">
                Fit actions can frame the current selection or the whole active level, and
                preset slots save the current zoom/pan for quick recall.
              </p>
              <p className="muted">
                Undo/Redo is available from the toolbar and through Ctrl/Cmd+Z and
                Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z when focus is not inside a form field.
              </p>
              <p className="muted">
                Move drags now open a temporary history transaction and commit only once
                when the pointer is released.
              </p>
              <p className="muted">
                3D View: swap the main canvas into the shared spatial editor that renders all
                floors, walls, slabs, shapes and model markers together. Drag to orbit and use
                the wheel to zoom; available 3D tools depend on the current editor.
              </p>
              <p className="muted">
                3D Join Mode: use Architectural Join for cleaner house corners, or Node Post
                to generate cylindrical connection posts sized from connected wall thickness and height.
              </p>
              <p className="muted">
                3D Surface Mode: switch between level colors or a gray opaque textured massing view.
              </p>

              <div className="quick-actions">
                <button
                  type="button"
                  onClick={() => setViewportMode(viewportMode === "2d" ? "3d" : "2d")}
                >
                  {viewportMode === "2d" ? "Open 3D View" : "Back To 2D"}
                </button>
                <button type="button" onClick={resetPreview3D}>
                  Reset 3D Camera
                </button>
                <button
                  type="button"
                  onClick={() => void handleLoadBuiltInSample()}
                >
                  Load Built-In Sample
                </button>
                <button type="button" onClick={handleCreateNode}>
                  Create Node
                </button>
                <button type="button" onClick={handleCreateWall}>
                  Link Last Two Nodes
                </button>
                <button type="button" onClick={handleCreateShape}>
                  Create Shape
                </button>
                <button type="button" onClick={handleCreateSlab}>
                  Create Slab
                </button>
                <button type="button" onClick={handleCreateModel}>
                  Place Model Marker
                </button>
              </div>

              <div className="viewport-summary-grid">
                <div>
                  <span className="summary-label">Selection</span>
                  <strong>
                    {currentSelection
                      ? `${currentSelection.kind}:${currentSelection.id}`
                      : "None"}
                  </strong>
                </div>
                <div>
                  <span className="summary-label">Viewport</span>
                  <strong>
                    Zoom {formatNumber(viewport.zoom)} | Pan {formatNumber(viewport.pan.x)}/
                    {formatNumber(viewport.pan.y)}
                  </strong>
                </div>
                <div>
                  <span className="summary-label">Validation</span>
                  <strong>{projectValidation.success ? "Valid Project" : "Invalid Project"}</strong>
                </div>
                <div>
                  <span className="summary-label">History</span>
                  <strong>
                    Undo {historyLength} | Redo {futureLength}
                  </strong>
                  <div className="muted">
                    {isHistoryTransactionOpen ? "Grouping active drag..." : "Ready"}
                  </div>
                </div>
              </div>
              </>
              ) : (
              <>
                <p>
                  The {editorMode} Editor workspace is now part of the shared WaWoD project.
                </p>
                <p className="muted">{getEditorModeDescription(editorMode)}</p>
                <p className="muted">
                  No authoring tools are enabled yet. The building remains visible as a read-only
                  reference in both views, so this editor can grow without risking structural data.
                </p>
                <div className="quick-actions">
                  <button
                    type="button"
                    onClick={() => setViewportMode(viewportMode === "2d" ? "3d" : "2d")}
                  >
                    {viewportMode === "2d" ? "Open 3D View" : "Back To 2D"}
                  </button>
                  <button type="button" onClick={resetPreview3D}>
                    Reset 3D Camera
                  </button>
                </div>
                <div className="viewport-summary-grid">
                  <div>
                    <span className="summary-label">Editor</span>
                    <strong>{editorMode}</strong>
                  </div>
                  <div>
                    <span className="summary-label">View</span>
                    <strong>{viewportMode === "2d" ? "2D" : "3D"}</strong>
                  </div>
                  <div>
                    <span className="summary-label">Building Reference</span>
                    <strong>Read Only</strong>
                  </div>
                  <div>
                    <span className="summary-label">Tools</span>
                    <strong>Coming Next</strong>
                  </div>
                </div>
              </>
              )}
            </div>
            ) : null}

            {editorMode === "Building" && floatingWindowVisibility.levels ? (
              <FloatingWindow
                title="Levels"
                kicker="Structure"
                position={floatingWindowPositions.levels}
                width={360}
                onPositionChange={(position) => setFloatingWindowPosition("levels", position)}
              >
                <p className="muted">
                  Visibility for {viewportMode === "3d" ? "3D preview" : "2D editor"}.
                </p>
                <div className="list-selector list-selector-scroll">
                  {project.levels.map((level) => (
                    <div key={level.id} className="segmented-list-row">
                      <button
                        type="button"
                        className={
                          currentHiddenLevelIdSet.has(level.id)
                            ? "list-visibility-toggle is-off"
                            : "list-visibility-toggle"
                        }
                        onClick={() => toggleLevelVisibility(level.id, viewportMode)}
                        aria-label={`${currentHiddenLevelIdSet.has(level.id) ? "Show" : "Hide"} ${level.name}`}
                        aria-pressed={!currentHiddenLevelIdSet.has(level.id)}
                        title={currentHiddenLevelIdSet.has(level.id) ? "Show level" : "Hide level"}
                      >
                        <EyeToggleIcon visible={!currentHiddenLevelIdSet.has(level.id)} />
                      </button>
                      <button
                        type="button"
                        className={
                          !activeRoofLayerId && level.id === activeLevelId
                            ? "list-selector-item segmented-list-item is-active"
                            : "list-selector-item segmented-list-item"
                        }
                        onClick={() => setActiveLevelId(level.id)}
                      >
                        <strong>{level.name}</strong>
                        <span>{formatNumber(level.elevationM)} m</span>
                      </button>
                      <button
                        type="button"
                        className="list-selector-action segmented-list-action"
                        onClick={() => {
                          setActiveLevelId(level.id);
                          setEditingLevelId(level.id);
                        }}
                        aria-label={`Edit ${level.name}`}
                      >
                        Edit
                      </button>
                    </div>
                  ))}
                  {defaultRoofLayer ? (
                    <div key={defaultRoofLayer.id} className="segmented-list-row">
                      <button
                        type="button"
                        className={
                          isDefaultRoofLayerVisible
                            ? "list-visibility-toggle"
                            : "list-visibility-toggle is-off"
                        }
                        onClick={handleToggleDefaultRoofLayerVisibility}
                        aria-label={`${isDefaultRoofLayerVisible ? "Hide" : "Show"} Roof`}
                        aria-pressed={isDefaultRoofLayerVisible}
                        title={isDefaultRoofLayerVisible ? "Hide roof layer" : "Show roof layer"}
                      >
                        <EyeToggleIcon visible={isDefaultRoofLayerVisible} />
                      </button>
                      <button
                        type="button"
                        className={
                          activeRoofLayerId === defaultRoofLayer.id
                            ? "list-selector-item segmented-list-item is-active"
                            : "list-selector-item segmented-list-item"
                        }
                        onClick={() => {
                          setActiveRoofLayerId(defaultRoofLayer.id);
                          setActiveTool("Roof");
                        }}
                      >
                        <strong>{defaultRoofLayer.name}</strong>
                        <span>roof drawing layer</span>
                      </button>
                      <button
                        type="button"
                        className="list-selector-action segmented-list-action"
                        disabled
                        aria-label="Roof layer is locked"
                        title="Default roof layer is locked for now"
                      >
                        Locked
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="button-row">
                  <button type="button" onClick={handleAddLevel}>
                    Add Level
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveLevel}
                    disabled={!canRemoveActiveLevel}
                  >
                    Remove Level
                  </button>
                </div>
              </FloatingWindow>
            ) : null}

            {editorMode === "Building" && editingLevel && floatingWindowVisibility.levelEdit ? (
              <FloatingWindow
                title="Edit Level"
                kicker="Structure"
                position={floatingWindowPositions.levelEdit}
                width={320}
                onPositionChange={(position) => setFloatingWindowPosition("levelEdit", position)}
              >
                <div className="field-grid">
                  <label className="field-label">
                    <span>Name</span>
                    <DraftTextInput
                      value={editingLevel.name}
                      onCommit={(nextValue) =>
                        handleUpdateLevelById(
                          editingLevel.id,
                          { name: nextValue },
                          `Updated level "${nextValue}".`,
                        )
                      }
                    />
                  </label>
                  <label className="field-label">
                    <span>Elevation (m)</span>
                    <DraftNumberInput
                      step="0.1"
                      value={editingLevel.elevationM}
                      onCommit={(value) =>
                        handleUpdateLevelById(
                          editingLevel.id,
                          { elevationM: value },
                          "Updated level elevation.",
                        )
                      }
                    />
                  </label>
                </div>
                <div className="button-row">
                  <button type="button" onClick={() => setEditingLevelId(null)}>
                    Close
                  </button>
                </div>
              </FloatingWindow>
            ) : null}

            {editorMode === "Building" && floatingWindowVisibility.wallTypes ? (
              <FloatingWindow
                title="Wall Types"
                kicker="Structure"
                position={floatingWindowPositions.wallTypes}
                width={384}
                onPositionChange={(position) => setFloatingWindowPosition("wallTypes", position)}
              >
                <div className="list-selector list-selector-scroll">
                  {project.wallTypes.map((wallType) => (
                    <div key={wallType.id} className="segmented-list-row">
                      <button
                        type="button"
                        className={
                          wallType.id === activeWallTypeId
                            ? "list-selector-item segmented-list-item is-active"
                            : "list-selector-item segmented-list-item"
                        }
                        onClick={() => setActiveWallTypeId(wallType.id)}
                      >
                        <strong>{wallType.name}</strong>
                        <span>{formatNumber(wallType.thicknessM)} m / {formatNumber(wallType.heightM)} m</span>
                      </button>
                      <button
                        type="button"
                        className="list-selector-action segmented-list-action"
                        onClick={() => {
                          setActiveWallTypeId(wallType.id);
                          setEditingWallTypeId(wallType.id);
                        }}
                        aria-label={`Edit ${wallType.name}`}
                      >
                        Edit
                      </button>
                    </div>
                  ))}
                </div>
                <div className="button-row">
                  <button type="button" onClick={handleAddWallType}>
                    Add Wall Type
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveWallType}
                    disabled={!activeWallType || project.wallTypes.length <= 1}
                  >
                    Remove Wall Type
                  </button>
                </div>
                <button
                  type="button"
                  className={newWallsFollowRoof ? "toggle-button is-active" : "toggle-button"}
                  onClick={() => setNewWallsFollowRoof((current) => !current)}
                >
                  Follow Roof
                </button>
              </FloatingWindow>
            ) : null}

            {editorMode === "Building" && editingWallType && floatingWindowVisibility.wallTypeEdit ? (
              <FloatingWindow
                title="Edit Wall Type"
                kicker="Structure"
                position={floatingWindowPositions.wallTypeEdit}
                width={320}
                onPositionChange={(position) => setFloatingWindowPosition("wallTypeEdit", position)}
              >
                <div className="field-grid">
                  <label className="field-label">
                    <span>Name</span>
                    <DraftTextInput
                      value={editingWallType.name}
                      onCommit={(nextValue) =>
                        handleUpdateWallTypeById(
                          editingWallType.id,
                          { name: nextValue },
                          `Updated wall type "${nextValue}".`,
                        )
                      }
                    />
                  </label>
                  <label className="field-label">
                    <span>Thickness (m)</span>
                    <DraftNumberInput
                      step="0.01"
                      value={editingWallType.thicknessM}
                      onCommit={(value) =>
                        handleUpdateWallTypeById(
                          editingWallType.id,
                          { thicknessM: value },
                          "Updated wall thickness.",
                        )
                      }
                    />
                  </label>
                  <label className="field-label">
                    <span>Height (m)</span>
                    <DraftNumberInput
                      step="0.1"
                      value={editingWallType.heightM}
                      onCommit={(value) =>
                        handleUpdateWallTypeById(
                          editingWallType.id,
                          { heightM: value },
                          "Updated wall height.",
                        )
                      }
                    />
                  </label>
                </div>
                <div className="button-row">
                  <button type="button" onClick={() => setEditingWallTypeId(null)}>
                    Close
                  </button>
                </div>
              </FloatingWindow>
            ) : null}

            {editorMode === "Building" && floatingWindowVisibility.grid ? (
              <FloatingWindow
                title="Grid Settings"
                kicker="Viewport"
                position={floatingWindowPositions.grid}
                width={280}
                onPositionChange={(position) => setFloatingWindowPosition("grid", position)}
              >
                <div className="button-row">
                  <button
                    type="button"
                    className={project.settings.snapToGrid ? "is-active" : undefined}
                    onClick={handleToggleSnap}
                  >
                    Toggle Snap
                  </button>
                </div>
                <div className="compact-control-row">
                  <span>Grid (m)</span>
                  <div className="compact-control-group">
                    <button type="button" onClick={() => handleGridStep(-0.1)}>
                      -
                    </button>
                    <DraftNumberInput
                      className="compact-control-input"
                      step="0.01"
                      min="0.01"
                      value={project.settings.gridSpacingM}
                      onCommit={handleSetGridSpacing}
                    />
                    <button type="button" onClick={() => handleGridStep(0.1)}>
                      +
                    </button>
                  </div>
                </div>
                <div className="compact-control-row">
                  <span>Scale</span>
                  <div className="compact-control-group">
                    <button type="button" onClick={() => handlePixelsPerMeterStep(-20)}>
                      -
                    </button>
                    <strong>{project.settings.pixelsPerMeter} px/m</strong>
                    <button type="button" onClick={() => handlePixelsPerMeterStep(20)}>
                      +
                    </button>
                  </div>
                </div>
                <p className="muted">`F` fits selection. `Shift+F` fits the active level.</p>
              </FloatingWindow>
            ) : null}

            {showToolWindow ? (
              <FloatingWindow
                title={`${getEditorToolLabel(activeTool)} Tool`}
                kicker="Tool"
                position={floatingWindowPositions.tool}
                width={320}
                onPositionChange={(position) => setFloatingWindowPosition("tool", position)}
              >
                {renderToolWindowContent()}
              </FloatingWindow>
            ) : null}

            {showContextWindow ? (
              <FloatingWindow
                title="Context"
                kicker="Selection"
                position={floatingWindowPositions.context}
                width={340}
                onPositionChange={(position) => setFloatingWindowPosition("context", position)}
              >
                {renderContextWindowContent()}
              </FloatingWindow>
            ) : null}
          </div>
        </section>

        <aside
          className={
            panelVisibility.inspectorOpen
              ? "inspector-panel"
              : "inspector-panel is-collapsed"
          }
        >
          {panelVisibility.inspectorOpen ? (
            <>
              <section className="inspector-section">
                <p className="section-kicker">Levels</p>
                <h2>Active Level</h2>
                <select
                  value={activeLevelId ?? ""}
                  onChange={(event) =>
                    setActiveLevelId(event.target.value.length > 0 ? event.target.value : null)
                  }
                >
                  {project.levels.map((level) => (
                    <option key={level.id} value={level.id}>
                      {level.name} ({formatNumber(level.elevationM)} m)
                    </option>
                  ))}
                </select>
                {activeLevel ? (
                  <div className="field-grid">
                    <label className="field-label">
                      <span>Name</span>
                      <input
                        type="text"
                        value={activeLevel.name}
                        onChange={(event) =>
                          handleUpdateActiveLevel(
                            { name: event.target.value },
                            `Updated level "${event.target.value}".`,
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Elevation (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        value={activeLevel.elevationM}
                        onChange={(event) =>
                          commitNumericInput(event.target.valueAsNumber, (value) =>
                            handleUpdateActiveLevel(
                              { elevationM: value },
                              "Updated level elevation.",
                            ),
                          )
                        }
                      />
                    </label>
                  </div>
                ) : null}
                <div className="button-row">
                  <button type="button" onClick={handleAddLevel}>
                    Add Level
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveLevel}
                    disabled={!canRemoveActiveLevel}
                  >
                    Remove Level
                  </button>
                </div>
              </section>

              <section className="inspector-section">
                <p className="section-kicker">Walls</p>
                <h2>Wall Types</h2>
                <select
                  value={activeWallTypeId ?? ""}
                  onChange={(event) =>
                    setActiveWallTypeId(
                      event.target.value.length > 0 ? event.target.value : null,
                    )
                  }
                >
                  {project.wallTypes.map((wallType) => (
                    <option key={wallType.id} value={wallType.id}>
                      {wallType.name} ({formatNumber(wallType.thicknessM)} m)
                    </option>
                  ))}
                </select>
                {activeWallType ? (
                  <div className="field-grid">
                    <label className="field-label">
                      <span>Name</span>
                      <input
                        type="text"
                        value={activeWallType.name}
                        onChange={(event) =>
                          handleUpdateActiveWallType(
                            { name: event.target.value },
                            `Updated wall type "${event.target.value}".`,
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Thickness (m)</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={activeWallType.thicknessM}
                        onChange={(event) =>
                          commitNumericInput(event.target.valueAsNumber, (value) =>
                            handleUpdateActiveWallType(
                              { thicknessM: value },
                              "Updated wall thickness.",
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Height (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        value={activeWallType.heightM}
                        onChange={(event) =>
                          commitNumericInput(event.target.valueAsNumber, (value) =>
                            handleUpdateActiveWallType(
                              { heightM: value },
                              "Updated wall height.",
                            ),
                          )
                        }
                      />
                    </label>
                  </div>
                ) : null}
                <div className="button-row">
                  <button type="button" onClick={handleAddWallType}>
                    Add Wall Type
                  </button>
                  <button
                    type="button"
                    onClick={() => clearPendingWallStartNodeId()}
                    disabled={pendingWallStartNodeId === null}
                  >
                    Clear Wall Start
                  </button>
                  <button type="button" onClick={clearSelection}>
                    Clear Selection
                  </button>
                </div>
                <p className="muted">
                  Pending wall start: {pendingWallStartNodeId ?? "none"}
                </p>
              </section>

              <section className="inspector-section">
                <p className="section-kicker">Grid</p>
                <h2>Grid Settings</h2>
                <div className="stat-row">
                  <span>Snap to grid</span>
                  <strong>{project.settings.snapToGrid ? "On" : "Off"}</strong>
                </div>
                <div className="stat-row">
                  <span>Grid spacing</span>
                  <strong>{formatNumber(project.settings.gridSpacingM)} m</strong>
                </div>
                <div className="stat-row">
                  <span>Pixels per meter</span>
                  <strong>{project.settings.pixelsPerMeter}</strong>
                </div>
                <p className="muted">
                  Inspector X/Y edits {project.settings.snapToGrid ? "snap to the current grid." : "stay freeform."}
                </p>
                <div className="button-row">
                  <button type="button" onClick={handleToggleSnap}>
                    Toggle Snap
                  </button>
                  <button type="button" onClick={() => handleGridStep(-0.1)}>
                    Grid -
                  </button>
                  <button type="button" onClick={() => handleGridStep(0.1)}>
                    Grid +
                  </button>
                  <button type="button" onClick={() => handlePixelsPerMeterStep(-20)}>
                    Scale -
                  </button>
                  <button type="button" onClick={() => handlePixelsPerMeterStep(20)}>
                    Scale +
                  </button>
                </div>
              </section>

              <section className="inspector-section">
                <p className="section-kicker">Display</p>
                <h2>Panels And View</h2>
                <div className="button-row">
                  <button type="button" onClick={handleFitSelection}>
                    Fit Selection
                  </button>
                  <button type="button" onClick={handleFitActiveLevel}>
                    Fit Active Level
                  </button>
                </div>
                <div className="button-row">
                  <button type="button" onClick={() => setStatusBarVisible(!panelVisibility.statusBarVisible)}>
                    {panelVisibility.statusBarVisible ? "Hide Status Line" : "Show Status Line"}
                  </button>
                  <button type="button" onClick={resetViewport}>
                    Reset Viewport
                  </button>
                  <button type="button" onClick={() => panBy(createVec2(0.5, 0.25))}>
                    Nudge Pan
                  </button>
                </div>
                {viewportMode === "3d" ? (
                  <div className="field-stack">
                    <div className="stat-row">
                      <span>3D Camera Mode</span>
                      <strong>
                        {(preview3D.cameraMode as string | undefined) === "FreeCamera"
                          ? "Free Camera"
                          : (preview3D.cameraMode as string | undefined) === "FreeOrbit" ||
                              (preview3D.cameraMode as string | undefined) === "Free"
                            ? "Free Orbit"
                            : "Orbit Center"}
                      </strong>
                    </div>
                    <label className="field-label">
                      <span>3D Camera Mode</span>
                      <select
                        value={
                          (preview3D.cameraMode as string | undefined) === "Free"
                            ? "FreeOrbit"
                            : (preview3D.cameraMode ?? "Orbit")
                        }
                        onChange={(event) =>
                          setPreview3D({
                            cameraMode: event.target.value as typeof preview3D.cameraMode,
                            targetOffset:
                              event.target.value === "FreeOrbit"
                                ? (preview3D.targetOffset ?? [0, 0, 0])
                                : [0, 0, 0],
                            cameraPositionOffset:
                              event.target.value === "FreeCamera"
                                ? (preview3D.cameraPositionOffset ?? null)
                                : null,
                          })
                        }
                      >
                        <option value="Orbit">Orbit Center</option>
                        <option value="FreeOrbit">Free Orbit</option>
                        <option value="FreeCamera">Free Camera</option>
                      </select>
                    </label>
                    <div className="stat-row">
                      <span>3D Join Mode</span>
                      <strong>
                        {preview3D.renderMode === "ArchitecturalJoin"
                          ? "Architectural Join"
                          : "Node Post"}
                      </strong>
                    </div>
                    <label className="field-label">
                      <span>3D Join Mode</span>
                      <select
                        value={preview3D.renderMode}
                        onChange={(event) =>
                          setPreview3D({
                            renderMode: event.target.value as typeof preview3D.renderMode,
                          })
                        }
                      >
                        <option value="ArchitecturalJoin">Architectural Join</option>
                        <option value="NodePost">Node Post</option>
                      </select>
                    </label>
                    <label className="field-label">
                      <span>3D Surface Mode</span>
                      <select
                        value={preview3D.surfaceMode}
                        onChange={(event) =>
                          setPreview3D({
                            surfaceMode: event.target.value as typeof preview3D.surfaceMode,
                          })
                        }
                      >
                        <option value="LevelColor">Color By Level</option>
                        <option value="GrayOpaque">Gray Opaque</option>
                      </select>
                    </label>
                    <div className="button-row">
                      <button type="button" onClick={resetPreview3D}>
                        Reset 3D Camera
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="preset-stack">
                  {viewportPresets.map((preset) => (
                    <div key={preset.id} className="preset-row">
                      <div>
                        <strong>{preset.label}</strong>
                        <div className="muted">
                          {preset.viewport
                            ? `Zoom ${formatNumber(preset.viewport.zoom)} | Pan ${formatNumber(preset.viewport.pan.x)}/${formatNumber(preset.viewport.pan.y)}`
                            : "Empty slot"}
                        </div>
                      </div>
                      <div className="button-row">
                        <button
                          type="button"
                          onClick={() => handleApplyViewportPreset(preset.id, preset.label)}
                          disabled={!preset.viewport}
                        >
                          Load
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveViewportPreset(preset.id, preset.label)}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => handleClearViewportPreset(preset.id, preset.label)}
                          disabled={!preset.viewport}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {activeTool === "Door" ? (
                <section className="inspector-section">
                  <p className="section-kicker">Door Tool</p>
                  <h2>Door Defaults</h2>
                  <p className="muted">
                    Click an existing wall to insert a door opening. Width and height are applied
                    to the selected host wall, and the wall above the door is kept automatically.
                  </p>
                  <div className="field-grid">
                    <label className="field-label">
                      <span>Width (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0.2"
                        value={doorToolWidthM}
                        onChange={(event) => {
                          const nextValue = event.target.valueAsNumber;
                          if (Number.isFinite(nextValue) && nextValue > 0) {
                            setDoorToolWidthM(nextValue);
                          }
                        }}
                      />
                    </label>
                    <label className="field-label">
                      <span>Height (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0.5"
                        value={doorToolHeightM}
                        onChange={(event) => {
                          const nextValue = event.target.valueAsNumber;
                          if (Number.isFinite(nextValue) && nextValue > 0) {
                            setDoorToolHeightM(nextValue);
                          }
                        }}
                      />
                    </label>
                  </div>
                </section>
              ) : null}

              {activeTool === "Window" ? (
                <section className="inspector-section">
                  <p className="section-kicker">Window Tool</p>
                  <h2>Window Defaults</h2>
                  <p className="muted">
                    Click an existing wall to insert a window opening. Width, height and sill
                    height are applied to the selected host wall, and parapet plus over-window
                    wall segments are generated automatically in 3D.
                  </p>
                  <div className="field-grid">
                    <label className="field-label">
                      <span>Width (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0.2"
                        value={windowToolWidthM}
                        onChange={(event) => {
                          const nextValue = event.target.valueAsNumber;
                          if (Number.isFinite(nextValue) && nextValue > 0) {
                            setWindowToolWidthM(nextValue);
                          }
                        }}
                      />
                    </label>
                    <label className="field-label">
                      <span>Height (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0.2"
                        value={windowToolHeightM}
                        onChange={(event) => {
                          const nextValue = event.target.valueAsNumber;
                          if (Number.isFinite(nextValue) && nextValue > 0) {
                            setWindowToolHeightM(nextValue);
                          }
                        }}
                      />
                    </label>
                    <label className="field-label">
                      <span>Sill Height (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={windowToolSillHeightM}
                        onChange={(event) => {
                          const nextValue = event.target.valueAsNumber;
                          if (Number.isFinite(nextValue) && nextValue >= 0) {
                            setWindowToolSillHeightM(nextValue);
                          }
                        }}
                      />
                    </label>
                  </div>
                </section>
              ) : null}

              {activeTool === "Stair" ? (
                <section className="inspector-section">
                  <p className="section-kicker">Stair Tool</p>
                  <h2>Stair Defaults</h2>
                  <p className="muted">
                    Place path nodes from stair start to stair end. The first node is the base,
                    the last node is the top exit, and intermediate nodes generate flat landings.
                  </p>
                  <div className="field-grid">
                    <label className="field-label">
                      <span>Width (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0.3"
                        value={stairToolWidthM}
                        onChange={(event) => {
                          const nextValue = event.target.valueAsNumber;
                          if (Number.isFinite(nextValue) && nextValue > 0) {
                            setStairToolWidthM(nextValue);
                          }
                        }}
                      />
                    </label>
                    <label className="field-label">
                      <span>Top Above Level (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        value={stairToolEndElevationOffsetM}
                        onChange={(event) => {
                          const nextValue = event.target.valueAsNumber;
                          if (Number.isFinite(nextValue)) {
                            setStairToolEndElevationOffsetM(nextValue);
                          }
                        }}
                      />
                    </label>
                    <label className="field-label">
                      <span>Riser Height (m)</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0.05"
                        value={stairToolRiserHeightM}
                        onChange={(event) => {
                          const nextValue = event.target.valueAsNumber;
                          if (Number.isFinite(nextValue) && nextValue > 0) {
                            setStairToolRiserHeightM(nextValue);
                          }
                        }}
                      />
                    </label>
                    <label className="field-label">
                      <span>Tread Depth (m)</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0.05"
                        value={stairToolTreadDepthM}
                        onChange={(event) => {
                          const nextValue = event.target.valueAsNumber;
                          if (Number.isFinite(nextValue) && nextValue > 0) {
                            setStairToolTreadDepthM(nextValue);
                          }
                        }}
                      />
                    </label>
                    <label className="field-label">
                      <span>Landing Length (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={stairToolLandingLengthM}
                        onChange={(event) => {
                          const nextValue = event.target.valueAsNumber;
                          if (Number.isFinite(nextValue) && nextValue >= 0) {
                            setStairToolLandingLengthM(nextValue);
                          }
                        }}
                      />
                    </label>
                  </div>
                </section>
              ) : null}

              {activeTool === "Slab" ? (
                <section className="inspector-section">
                  <p className="section-kicker">Slab Tool</p>
                  <h2>Contextual Slab Settings</h2>
                  <div className="button-row">
                    <button
                      type="button"
                      className={slabMode === "Rectangle" ? "is-active" : undefined}
                      onClick={() => setSlabMode("Rectangle")}
                    >
                      Rectangle
                    </button>
                    <button
                      type="button"
                      className={slabMode === "Circle" ? "is-active" : undefined}
                      onClick={() => setSlabMode("Circle")}
                    >
                      Circle
                    </button>
                    <button
                      type="button"
                      className={slabMode === "Freeform" ? "is-active" : undefined}
                      onClick={() => setSlabMode("Freeform")}
                    >
                      Freeform
                    </button>
                  </div>
                  <button
                    type="button"
                    className={slabConnectEnabled ? "is-active" : undefined}
                    onClick={() => setSlabConnectEnabled((enabled) => !enabled)}
                  >
                    Connect With Other Slabs
                  </button>
                  {slabMode === "Freeform" ? (
                    <p className="muted">Click corners and click the first point to close.</p>
                  ) : null}
                </section>
              ) : null}

              {selectedNode ? (
                <section
                  className="inspector-section"
                  onFocusCapture={() => focusSelection({ kind: "node", id: selectedNode.id })}
                >
                  <p className="section-kicker">Selection</p>
                  <h2>Node Inspector</h2>
                  <div className="stat-row">
                    <span>Level</span>
                    <strong>
                      {project.levels.find((level) => level.id === selectedNode.levelId)?.name ??
                        selectedNode.levelId}
                    </strong>
                  </div>
                  <div className="field-grid">
                    <label className="field-label">
                      <span>X</span>
                      <input
                        type="number"
                        step="0.1"
                        value={selectedNode.position.x}
                        onChange={(event) =>
                          commitCoordinateInput(event.target.valueAsNumber, (value) =>
                            handleMoveNode(
                              selectedNode.id,
                              createVec2(value, selectedNode.position.y),
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Y</span>
                      <input
                        type="number"
                        step="0.1"
                        value={selectedNode.position.y}
                        onChange={(event) =>
                          commitCoordinateInput(event.target.valueAsNumber, (value) =>
                            handleMoveNode(
                              selectedNode.id,
                              createVec2(selectedNode.position.x, value),
                            ),
                          )
                        }
                      />
                    </label>
                  </div>
                  <div className="button-row">
                    <button type="button" onClick={() => handleDeleteNode(selectedNode.id)}>
                      Delete Node
                    </button>
                  </div>
                </section>
              ) : null}

              {selectedWall ? (
                <section
                  className="inspector-section"
                  onFocusCapture={() => focusSelection({ kind: "wall", id: selectedWall.id })}
                >
                  <p className="section-kicker">Selection</p>
                  <h2>Wall Inspector</h2>
                  <div className="stat-row">
                    <span>Start Node</span>
                    <strong>{selectedWall.startNodeId}</strong>
                  </div>
                  <div className="stat-row">
                    <span>End Node</span>
                    <strong>{selectedWall.endNodeId}</strong>
                  </div>
                  <div className="stat-row">
                    <span>Level</span>
                    <strong>
                      {project.levels.find((level) => level.id === selectedWall.levelId)?.name ??
                        selectedWall.levelId}
                    </strong>
                  </div>
                  <label className="field-label">
                    <span>Wall Type</span>
                    <select
                      value={selectedWall.wallTypeId}
                      onChange={(event) =>
                        handleUpdateSelectedWall(
                          { wallTypeId: event.target.value },
                          "Updated wall type assignment.",
                        )
                      }
                    >
                      {project.wallTypes.map((wallType) => (
                        <option key={wallType.id} value={wallType.id}>
                          {wallType.name} ({formatNumber(wallType.thicknessM)} m)
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-label">
                    <span>Wall Top</span>
                    <select
                      value={selectedWall.topMode}
                      onChange={(event) =>
                        handleUpdateSelectedWall(
                          { topMode: event.target.value as WallTopMode },
                          `Updated wall top mode to ${event.target.value}.`,
                        )
                      }
                    >
                      <option value="FixedHeight">Fixed Height</option>
                      <option value="FollowRoof">Follow Roof</option>
                    </select>
                  </label>
                  <div className="button-row">
                    <button type="button" onClick={() => handleDeleteWall(selectedWall.id)}>
                      Delete Wall
                    </button>
                  </div>
                </section>
              ) : null}

              {selectedDoor ? (
                <section
                  className="inspector-section"
                  onFocusCapture={() => focusSelection({ kind: "door", id: selectedDoor.id })}
                >
                  <p className="section-kicker">Selection</p>
                  <h2>Door Inspector</h2>
                  <div className="stat-row">
                    <span>Host Wall</span>
                    <strong>{selectedDoor.wallId}</strong>
                  </div>
                  <div className="stat-row">
                    <span>Host Wall Height</span>
                    <strong>
                      {selectedDoorWallType
                        ? `${formatNumber(selectedDoorWallType.heightM)} m`
                        : "Unknown"}
                    </strong>
                  </div>
                  <div className="field-grid">
                    <label className="field-label">
                      <span>Width (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0.2"
                        value={selectedDoor.widthM}
                        onChange={(event) =>
                          commitNumericInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedDoor({ widthM: value }, "Updated door width."),
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Height (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0.5"
                        value={selectedDoor.heightM}
                        onChange={(event) =>
                          commitNumericInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedDoor({ heightM: value }, "Updated door height."),
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Center Offset (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={selectedDoor.offsetM}
                        onChange={(event) =>
                          commitNumericInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedDoor({ offsetM: value }, "Updated door position."),
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Lintel Height (m)</span>
                      <input
                        type="number"
                        value={
                          selectedDoorWallType
                            ? Number(
                                Math.max(
                                  selectedDoorWallType.heightM - selectedDoor.heightM,
                                  0,
                                ).toFixed(2),
                              )
                            : 0
                        }
                        readOnly
                      />
                    </label>
                    {viewportMode === "3d" ? (
                      <>
                        <label className="field-label">
                          <span>Door Type</span>
                          <select
                            value={selectedDoor.design3D?.kind ?? door3DKind}
                            onChange={(event) =>
                              handleUpdateSelectedDoor(
                                {
                                  design3D: {
                                    ...(selectedDoor.design3D ?? createCurrentDoor3DDesign()),
                                    kind: event.target.value as DoorDesign3D["kind"],
                                  },
                                },
                                "Updated 3D door type.",
                              )
                            }
                          >
                            <option value="Normal">Normal</option>
                            <option value="Garage">Garage</option>
                            <option value="Glass">Glass Door</option>
                            <option value="HSPortal">HS Portal</option>
                          </select>
                        </label>
                        {(selectedDoor.design3D?.kind ?? door3DKind) === "Garage" ? (
                          <label className="field-label">
                            <span>Garage Door Style</span>
                            <select
                              value={
                                selectedDoor.design3D?.garageDoorStyle ?? door3DGarageDoorStyle
                              }
                              onChange={(event) =>
                                handleUpdateSelectedDoor(
                                  {
                                    design3D: {
                                      ...(selectedDoor.design3D ?? createCurrentDoor3DDesign()),
                                      garageDoorStyle: event.target.value as GarageDoorStyle,
                                    },
                                  },
                                  "Updated garage door style.",
                                )
                              }
                            >
                              <option value="SinglePanel">Single Panel</option>
                              <option value="Sectional">Sectional</option>
                            </select>
                          </label>
                        ) : null}
                        <label className="field-label">
                          <span>State</span>
                          <select
                            value={selectedDoor.design3D?.openState ?? door3DOpenState}
                            onChange={(event) =>
                              handleUpdateSelectedDoor(
                                {
                                  design3D: {
                                    ...(selectedDoor.design3D ?? createCurrentDoor3DDesign()),
                                    openState: event.target.value as Door3DOpenState,
                                    openPercent:
                                      (event.target.value as Door3DOpenState) === "Open"
                                        ? 100
                                        : 0,
                                  },
                                },
                                "Updated 3D door state.",
                              )
                            }
                          >
                            <option value="Closed">Closed</option>
                            <option value="Open">Open</option>
                          </select>
                        </label>
                        <label className="field-label">
                          <span>
                            Open Percent (
                            {Math.round(
                              selectedDoor.design3D?.openPercent ?? door3DOpenPercent,
                            )}
                            %)
                          </span>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            value={selectedDoor.design3D?.openPercent ?? door3DOpenPercent}
                            onChange={(event) => {
                              const openPercent = clampValue(Number(event.target.value), 0, 100);
                              handleUpdateSelectedDoor(
                                {
                                  design3D: {
                                    ...(selectedDoor.design3D ?? createCurrentDoor3DDesign()),
                                    openPercent,
                                    openState: openPercent > 0 ? "Open" : "Closed",
                                  },
                                },
                                "Updated 3D door open percent.",
                              );
                            }}
                          />
                        </label>
                        <label className="field-label">
                          <span>Frame Thickness (m)</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0.005"
                            value={selectedDoor.design3D?.frameThicknessM ?? door3DFrameThicknessM}
                            onChange={(event) =>
                              commitNumericInput(event.target.valueAsNumber, (value) =>
                                handleUpdateSelectedDoor(
                                  {
                                    design3D: {
                                      ...(selectedDoor.design3D ?? createCurrentDoor3DDesign()),
                                      frameThicknessM: value,
                                    },
                                  },
                                  "Updated 3D door frame thickness.",
                                ),
                              )
                            }
                          />
                        </label>
                        <label className="field-label">
                          <span>Depth Offset From Wall Center (cm)</span>
                          <input
                            type="number"
                            step="0.5"
                            min={
                              selectedDoorDepthOffsetLimitM !== null
                                ? String(-toCentimeters(selectedDoorDepthOffsetLimitM))
                                : undefined
                            }
                            max={
                              selectedDoorDepthOffsetLimitM !== null
                                ? String(toCentimeters(selectedDoorDepthOffsetLimitM))
                                : undefined
                            }
                            value={toCentimeters(
                              selectedDoor.design3D?.wallDepthOffsetM ?? door3DWallDepthOffsetM,
                            )}
                            onChange={(event) =>
                              commitNumericInput(event.target.valueAsNumber, (value) =>
                                handleUpdateSelectedDoor(
                                  {
                                    design3D: {
                                      ...(selectedDoor.design3D ?? createCurrentDoor3DDesign()),
                                      wallDepthOffsetM:
                                        selectedDoorDepthOffsetLimitM !== null
                                          ? clampValue(
                                              toMetersFromCentimeters(value),
                                              -selectedDoorDepthOffsetLimitM,
                                              selectedDoorDepthOffsetLimitM,
                                            )
                                          : toMetersFromCentimeters(value),
                                    },
                                  },
                                  "Updated 3D door depth offset.",
                                ),
                              )
                            }
                          />
                        </label>
                        <label className="field-label">
                          <span>Frame Color</span>
                          <input
                            type="color"
                            value={selectedDoor.design3D?.frameColorHex ?? door3DFrameColorHex}
                            onChange={(event) =>
                              handleUpdateSelectedDoor(
                                {
                                  design3D: {
                                    ...(selectedDoor.design3D ?? createCurrentDoor3DDesign()),
                                    frameColorHex: event.target.value,
                                  },
                                },
                                "Updated 3D door frame color.",
                              )
                            }
                          />
                        </label>
                        <label className="field-label">
                          <span>Door Color</span>
                          <input
                            type="color"
                            value={selectedDoor.design3D?.doorColorHex ?? door3DDoorColorHex}
                            onChange={(event) =>
                              handleUpdateSelectedDoor(
                                {
                                  design3D: {
                                    ...(selectedDoor.design3D ?? createCurrentDoor3DDesign()),
                                    doorColorHex: event.target.value,
                                  },
                                },
                                "Updated 3D door color.",
                              )
                            }
                          />
                        </label>
                        {(selectedDoor.design3D?.kind ?? door3DKind) === "Normal" ||
                        (selectedDoor.design3D?.kind ?? door3DKind) === "Glass" ? (
                          <>
                            <label className="field-label">
                              <span>Hinge Side</span>
                              <select
                                value={selectedDoor.design3D?.hingeSide ?? door3DHingeSide}
                                onChange={(event) =>
                                  handleUpdateSelectedDoor(
                                    {
                                      design3D: {
                                        ...(selectedDoor.design3D ?? createCurrentDoor3DDesign()),
                                        hingeSide: event.target.value as Door3DHingeSide,
                                      },
                                    },
                                    "Updated 3D door hinge side.",
                                  )
                                }
                              >
                                <option value="Left">Left</option>
                                <option value="Right">Right</option>
                              </select>
                            </label>
                            <label className="field-label">
                              <span>Swing Direction</span>
                              <select
                                value={selectedDoor.design3D?.swingDirection ?? door3DSwingDirection}
                                onChange={(event) =>
                                  handleUpdateSelectedDoor(
                                    {
                                      design3D: {
                                        ...(selectedDoor.design3D ?? createCurrentDoor3DDesign()),
                                        swingDirection: event.target.value as Door3DSwingDirection,
                                      },
                                    },
                                    "Updated 3D door swing direction.",
                                  )
                                }
                              >
                                <option value="Inward">Inward</option>
                                <option value="Outward">Outward</option>
                              </select>
                            </label>
                          </>
                        ) : (selectedDoor.design3D?.kind ?? door3DKind) === "HSPortal" ? (
                          <label className="field-label">
                            <span>Sliding Panel</span>
                            <select
                              value={selectedDoor.design3D?.hingeSide ?? door3DHingeSide}
                              onChange={(event) =>
                                handleUpdateSelectedDoor(
                                  {
                                    design3D: {
                                      ...(selectedDoor.design3D ?? createCurrentDoor3DDesign()),
                                      hingeSide: event.target.value as Door3DHingeSide,
                                    },
                                  },
                                  "Updated HS portal sliding panel.",
                                )
                              }
                            >
                              <option value="Left">Left Panel</option>
                              <option value="Right">Right Panel</option>
                            </select>
                          </label>
                        ) : null}
                        {(selectedDoor.design3D?.kind ?? door3DKind) === "Garage" ? (
                          <label className="field-label">
                            <span>Open Direction</span>
                            <select
                              value={selectedDoor.design3D?.swingDirection ?? door3DSwingDirection}
                              onChange={(event) =>
                                handleUpdateSelectedDoor(
                                  {
                                    design3D: {
                                      ...(selectedDoor.design3D ?? createCurrentDoor3DDesign()),
                                      swingDirection: event.target.value as Door3DSwingDirection,
                                    },
                                  },
                                  "Updated garage door opening direction.",
                                )
                              }
                            >
                              <option value="Inward">Inward</option>
                              <option value="Outward">Outward</option>
                            </select>
                          </label>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                  <div className="button-row">
                    {viewportMode === "3d" ? (
                      <button
                        type="button"
                        onClick={() =>
                          selectedDoor.design3D
                            ? handleRemoveDoor3DInsert(selectedDoor.id)
                            : handleApplyDoor3DInsert(selectedDoor.id)
                        }
                      >
                        {selectedDoor.design3D ? "Delete Door" : "Insert 3D Door"}
                      </button>
                    ) : null}
                    <button type="button" onClick={() => handleDeleteDoor(selectedDoor.id)}>
                      Delete Opening
                    </button>
                  </div>
                </section>
              ) : null}

              {selectedWindow ? (
                <section
                  className="inspector-section"
                  onFocusCapture={() => focusSelection({ kind: "window", id: selectedWindow.id })}
                >
                  <p className="section-kicker">Selection</p>
                  <h2>Window Inspector</h2>
                  <div className="stat-row">
                    <span>Host Wall</span>
                    <strong>{selectedWindow.wallId}</strong>
                  </div>
                  <div className="stat-row">
                    <span>Host Wall Height</span>
                    <strong>
                      {selectedWindowWallType
                        ? `${formatNumber(selectedWindowWallType.heightM)} m`
                        : "Unknown"}
                    </strong>
                  </div>
                  <div className="field-grid">
                    <label className="field-label">
                      <span>Width (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0.2"
                        value={selectedWindow.widthM}
                        onChange={(event) =>
                          commitNumericInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedWindow(
                              { widthM: value },
                              "Updated window width.",
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Height (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0.2"
                        value={selectedWindow.heightM}
                        onChange={(event) =>
                          commitNumericInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedWindow(
                              { heightM: value },
                              "Updated window height.",
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Sill Height (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={selectedWindow.sillHeightM}
                        onChange={(event) =>
                          commitNumericInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedWindow(
                              { sillHeightM: value },
                              "Updated window sill height.",
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Center Offset (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={selectedWindow.offsetM}
                        onChange={(event) =>
                          commitNumericInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedWindow(
                              { offsetM: value },
                              "Updated window position.",
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Over-Window Height (m)</span>
                      <input
                        type="number"
                        value={
                          selectedWindowWallType
                            ? Number(
                                Math.max(
                                  selectedWindowWallType.heightM -
                                    selectedWindow.sillHeightM -
                                    selectedWindow.heightM,
                                  0,
                                ).toFixed(2),
                              )
                            : 0
                        }
                        readOnly
                      />
                    </label>
                    <label className="field-label">
                      <span>Parapet Height (m)</span>
                      <input
                        type="number"
                        value={Number(selectedWindow.sillHeightM.toFixed(2))}
                        readOnly
                      />
                    </label>
                    {viewportMode === "3d" ? (
                      <>
                        <label className="field-label">
                          <span>Glass Thickness (m)</span>
                          <input
                            type="number"
                            step="0.005"
                            min="0.001"
                            value={selectedWindow.design3D?.glassThicknessM ?? window3DGlassThicknessM}
                            onChange={(event) =>
                              commitNumericInput(event.target.valueAsNumber, (value) =>
                                handleUpdateSelectedWindow(
                                  {
                                    design3D: {
                                      ...(selectedWindow.design3D ?? createCurrentWindow3DDesign()),
                                      glassThicknessM: value,
                                    },
                                  },
                                  "Updated 3D window glass thickness.",
                                ),
                              )
                            }
                          />
                        </label>
                        <label className="field-label">
                          <span>Frame Thickness (m)</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0.005"
                            value={selectedWindow.design3D?.frameThicknessM ?? window3DFrameThicknessM}
                            onChange={(event) =>
                              commitNumericInput(event.target.valueAsNumber, (value) =>
                                handleUpdateSelectedWindow(
                                  {
                                    design3D: {
                                      ...(selectedWindow.design3D ?? createCurrentWindow3DDesign()),
                                      frameThicknessM: value,
                                    },
                                  },
                                  "Updated 3D window frame thickness.",
                                ),
                              )
                            }
                          />
                        </label>
                        <label className="field-label">
                          <span>Frame Color</span>
                          <input
                            type="color"
                            value={selectedWindow.design3D?.frameColorHex ?? window3DFrameColorHex}
                            onChange={(event) =>
                              handleUpdateSelectedWindow(
                                {
                                  design3D: {
                                    ...(selectedWindow.design3D ?? createCurrentWindow3DDesign()),
                                    frameColorHex: event.target.value,
                                  },
                                },
                                "Updated 3D window frame color.",
                              )
                            }
                          />
                        </label>
                        <label className="field-label">
                          <span>Vertical Divisions</span>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            value={selectedWindow.design3D?.verticalDivisions ?? window3DVerticalDivisions}
                            onChange={(event) =>
                              commitNumericInput(event.target.valueAsNumber, (value) =>
                                handleUpdateSelectedWindow(
                                  {
                                    design3D: {
                                      ...(selectedWindow.design3D ?? createCurrentWindow3DDesign()),
                                      verticalDivisions: Math.max(0, Math.round(value)),
                                    },
                                  },
                                  "Updated 3D window vertical divisions.",
                                ),
                              )
                            }
                          />
                        </label>
                        <label className="field-label">
                          <span>Horizontal Divisions</span>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            value={selectedWindow.design3D?.horizontalDivisions ?? window3DHorizontalDivisions}
                            onChange={(event) =>
                              commitNumericInput(event.target.valueAsNumber, (value) =>
                                handleUpdateSelectedWindow(
                                  {
                                    design3D: {
                                      ...(selectedWindow.design3D ?? createCurrentWindow3DDesign()),
                                      horizontalDivisions: Math.max(0, Math.round(value)),
                                    },
                                  },
                                  "Updated 3D window horizontal divisions.",
                                ),
                              )
                            }
                          />
                        </label>
                        <label className="field-label">
                          <span>Depth Offset From Wall Center (cm)</span>
                          <input
                            type="number"
                            step="0.5"
                            min={
                              selectedWindowDepthOffsetLimitM !== null
                                ? String(-toCentimeters(selectedWindowDepthOffsetLimitM))
                                : undefined
                            }
                            max={
                              selectedWindowDepthOffsetLimitM !== null
                                ? String(toCentimeters(selectedWindowDepthOffsetLimitM))
                                : undefined
                            }
                            value={toCentimeters(
                              selectedWindow.design3D?.wallDepthOffsetM ?? window3DWallDepthOffsetM,
                            )}
                            onChange={(event) =>
                              commitNumericInput(event.target.valueAsNumber, (value) =>
                                handleUpdateSelectedWindow(
                                  {
                                    design3D: {
                                      ...(selectedWindow.design3D ?? createCurrentWindow3DDesign()),
                                      wallDepthOffsetM:
                                        selectedWindowDepthOffsetLimitM !== null
                                          ? clampValue(
                                              toMetersFromCentimeters(value),
                                              -selectedWindowDepthOffsetLimitM,
                                              selectedWindowDepthOffsetLimitM,
                                            )
                                          : toMetersFromCentimeters(value),
                                    },
                                  },
                                  "Updated 3D window depth offset.",
                                ),
                              )
                            }
                          />
                        </label>
                      </>
                    ) : null}
                  </div>
                  <div className="button-row">
                    {viewportMode === "3d" ? (
                      <button
                        type="button"
                        onClick={() =>
                          selectedWindow.design3D
                            ? handleRemoveWindow3DInsert(selectedWindow.id)
                            : handleApplyWindow3DInsert(selectedWindow.id)
                        }
                      >
                        {selectedWindow.design3D ? "Remove 3D Window" : "Insert 3D Window"}
                      </button>
                    ) : null}
                    <button type="button" onClick={() => handleDeleteWindow(selectedWindow.id)}>
                      Delete Window
                    </button>
                  </div>
                </section>
              ) : null}

              {selectedStair ? (
                <section
                  className="inspector-section"
                  onFocusCapture={() => focusSelection({ kind: "stair", id: selectedStair.id })}
                >
                  <p className="section-kicker">Selection</p>
                  <h2>Stair Inspector</h2>
                  <div className="stat-row">
                    <span>Host Level</span>
                    <strong>
                      {project.levels.find((level) => level.id === selectedStair.levelId)?.name ??
                        selectedStair.levelId}
                    </strong>
                  </div>
                  <div className="stat-row">
                    <span>Path Nodes</span>
                    <strong>{selectedStair.pathNodes.length}</strong>
                  </div>
                  <div className="field-grid">
                    <label className="field-label">
                      <span>Name</span>
                      <input
                        type="text"
                        value={selectedStair.name}
                        onChange={(event) =>
                          handleUpdateSelectedStair(
                            { name: event.target.value },
                            `Updated stair "${event.target.value}".`,
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Width (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0.3"
                        value={selectedStair.widthM}
                        onChange={(event) =>
                          commitNumericInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedStair({ widthM: value }, "Updated stair width."),
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>End Elevation (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        value={selectedStair.endElevationM}
                        onChange={(event) =>
                          commitNumericInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedStair(
                              { endElevationM: value },
                              "Updated stair end elevation.",
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Riser Height (m)</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0.05"
                        value={selectedStair.riserHeightM}
                        onChange={(event) =>
                          commitNumericInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedStair(
                              { riserHeightM: value },
                              "Updated stair riser height.",
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Tread Depth (m)</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0.05"
                        value={selectedStair.treadDepthM}
                        onChange={(event) =>
                          commitNumericInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedStair(
                              { treadDepthM: value },
                              "Updated stair tread depth.",
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Landing Length (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={selectedStair.landingLengthM}
                        onChange={(event) =>
                          commitNumericInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedStair(
                              { landingLengthM: value },
                              "Updated stair landing length.",
                            ),
                          )
                        }
                      />
                    </label>
                  </div>
                  <div className="button-row">
                    <button type="button" onClick={() => handleDeleteStair(selectedStair.id)}>
                      Delete Stair
                    </button>
                  </div>
                </section>
              ) : null}

              {selectedShape ? (
                <section
                  className="inspector-section"
                  onFocusCapture={() => focusSelection({ kind: "shape", id: selectedShape.id })}
                >
                  <p className="section-kicker">Selection</p>
                  <h2>Shape Inspector</h2>
                  <div className="field-stack">
                    <label className="field-label">
                      <span>Name</span>
                      <input
                        type="text"
                        value={selectedShape.name}
                        onChange={(event) =>
                          handleUpdateSelectedShape(
                            { name: event.target.value },
                            `Updated shape "${event.target.value}".`,
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Kind</span>
                      <select
                        value={selectedShape.kind}
                        onChange={(event) =>
                          handleUpdateSelectedShape(
                            { kind: event.target.value as typeof selectedShape.kind },
                            `Changed shape kind to ${event.target.value}.`,
                          )
                        }
                      >
                        <option value="Square">Square</option>
                        <option value="Cylinder">Cylinder</option>
                      </select>
                    </label>
                  </div>
                  <div className="field-grid">
                    <label className="field-label">
                      <span>X</span>
                      <input
                        type="number"
                        step="0.1"
                        value={selectedShape.pose.position.x}
                        onChange={(event) =>
                          commitCoordinateInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedShape(
                              {
                                pose: {
                                  ...selectedShape.pose,
                                  position: createVec2(value, selectedShape.pose.position.y),
                                },
                              },
                              "Updated shape position.",
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Y</span>
                      <input
                        type="number"
                        step="0.1"
                        value={selectedShape.pose.position.y}
                        onChange={(event) =>
                          commitCoordinateInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedShape(
                              {
                                pose: {
                                  ...selectedShape.pose,
                                  position: createVec2(selectedShape.pose.position.x, value),
                                },
                              },
                              "Updated shape position.",
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Size (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        value={selectedShape.sizeM}
                        onChange={(event) =>
                          commitNumericInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedShape({ sizeM: value }, "Updated shape size."),
                          )
                        }
                      />
                    </label>
          <label className="field-label">
            <span>Bottom (m)</span>
            <input
              type="number"
              step="0.1"
              value={selectedShape.zStartM}
              onChange={(event) =>
                commitNumericInput(event.target.valueAsNumber, (value) =>
                  handleUpdateSelectedShape(
                    { zStartM: value },
                    "Updated shape bottom elevation.",
                  ),
                )
              }
            />
          </label>
          <label className="field-label">
            <span>Top (m)</span>
            <input
              type="number"
              step="0.1"
              value={selectedShape.zStartM + selectedShape.heightM}
              onChange={(event) =>
                commitNumericInput(event.target.valueAsNumber, (value) =>
                  handleUpdateSelectedShape(
                    { heightM: Math.max(0.1, value - selectedShape.zStartM) },
                    "Updated shape top elevation.",
                  ),
                )
              }
                      />
                    </label>
                  </div>
                  <div className="button-row">
                    <button type="button" onClick={() => handleDeleteShape(selectedShape.id)}>
                      Delete Shape
                    </button>
                  </div>
                </section>
              ) : null}

              {selectedSlab ? (
                <section
                  className="inspector-section"
                  onFocusCapture={() => focusSelection({ kind: "slab", id: selectedSlab.id })}
                >
                  <p className="section-kicker">Selection</p>
                  <h2>Slab Inspector</h2>
                  <div className="field-stack">
                    <label className="field-label">
                      <span>Name</span>
                      <input
                        type="text"
                        value={selectedSlab.name}
                        onChange={(event) =>
                          handleUpdateSelectedSlab(
                            { name: event.target.value },
                            `Updated slab "${event.target.value}".`,
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Kind</span>
                      <select
                        value={selectedSlab.kind}
                        onChange={(event) => {
                          const nextKind = event.target.value as typeof selectedSlab.kind;
                          handleUpdateSelectedSlab(
                            nextKind === "Freeform"
                              ? {
                                  kind: nextKind,
                                  roofType: "Flat",
                                  polygon: [
                                    createVec2(-selectedSlab.widthM / 2, -selectedSlab.depthM / 2),
                                    createVec2(selectedSlab.widthM / 2, -selectedSlab.depthM / 2),
                                    createVec2(selectedSlab.widthM / 2, selectedSlab.depthM / 2),
                                    createVec2(-selectedSlab.widthM / 2, selectedSlab.depthM / 2),
                                  ],
                                }
                              : nextKind === "Circle"
                                ? { kind: nextKind, roofType: "Flat" }
                                : { kind: nextKind },
                            `Changed slab kind to ${nextKind}.`,
                          );
                        }}
                      >
                        <option value="Rectangle">Rectangle</option>
                        <option value="Circle">Circle</option>
                        <option value="Freeform">Freeform</option>
                      </select>
                    </label>
                    {selectedSlab.kind === "Rectangle" ? (
                      <label className="field-label">
                        <span>Roof Type</span>
                        <select
                          value={selectedSlab.roofType}
                          onChange={(event) =>
                            handleUpdateSelectedSlab(
                              { roofType: event.target.value as RoofType },
                              `Changed slab roof type to ${event.target.value}.`,
                            )
                          }
                        >
                          <option value="Flat">Flat</option>
                          <option value="Gable">Sedlova</option>
                          <option value="Shed">Pultova</option>
                          <option value="Hip">Stanova</option>
                        </select>
                      </label>
                    ) : null}
                  </div>
                  <div className="field-grid">
                    <label className="field-label">
                      <span>X</span>
                      <input
                        type="number"
                        step="0.1"
                        value={selectedSlab.pose.position.x}
                        onChange={(event) =>
                          commitCoordinateInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedSlab(
                              {
                                pose: {
                                  ...selectedSlab.pose,
                                  position: createVec2(value, selectedSlab.pose.position.y),
                                },
                              },
                              "Updated slab position.",
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Y</span>
                      <input
                        type="number"
                        step="0.1"
                        value={selectedSlab.pose.position.y}
                        onChange={(event) =>
                          commitCoordinateInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedSlab(
                              {
                                pose: {
                                  ...selectedSlab.pose,
                                  position: createVec2(selectedSlab.pose.position.x, value),
                                },
                              },
                              "Updated slab position.",
                            ),
                          )
                        }
                      />
                    </label>
                    {selectedSlab.kind !== "Freeform" ? (
                      <>
                        <label className="field-label">
                          <span>Width (m)</span>
                          <input
                            type="number"
                            step="0.1"
                            min="0.1"
                            value={selectedSlab.widthM}
                            onChange={(event) =>
                              commitNumericInput(event.target.valueAsNumber, (value) =>
                                handleUpdateSelectedSlab({ widthM: value }, "Updated slab width."),
                              )
                            }
                          />
                        </label>
                        <label className="field-label">
                          <span>Depth (m)</span>
                          <input
                            type="number"
                            step="0.1"
                            min="0.1"
                            value={selectedSlab.depthM}
                            onChange={(event) =>
                              commitNumericInput(event.target.valueAsNumber, (value) =>
                                handleUpdateSelectedSlab({ depthM: value }, "Updated slab depth."),
                              )
                            }
                          />
                        </label>
                      </>
                    ) : (
                      <div className="stat-row">
                        <span>Editable Corners</span>
                        <strong>{selectedSlab.polygon.length}</strong>
                      </div>
                    )}
                    <label className="field-label">
                      <span>Thickness (m)</span>
                      <input
                        type="number"
                        step="0.05"
                        min="0.05"
                        value={selectedSlab.thicknessM}
                        onChange={(event) =>
                          commitNumericInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedSlab(
                              { thicknessM: value },
                              "Updated slab thickness.",
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Z Offset (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        value={selectedSlab.zOffsetM}
                        onChange={(event) =>
                          commitNumericInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedSlab(
                              { zOffsetM: value },
                              "Updated slab z offset.",
                            ),
                          )
                        }
                      />
                    </label>
                    {selectedSlab.kind === "Rectangle" && selectedSlab.roofType !== "Flat" ? (
                      <label className="field-label">
                        <span>Roof Rise (m)</span>
                        <input
                          type="number"
                          step="0.1"
                          min="0.1"
                          value={selectedSlab.roofRiseM}
                          onChange={(event) =>
                            commitNumericInput(event.target.valueAsNumber, (value) =>
                              handleUpdateSelectedSlab(
                                { roofRiseM: value },
                                "Updated roof rise.",
                              ),
                            )
                          }
                        />
                      </label>
                    ) : null}
                  </div>
                  <div className="button-row">
                    <button type="button" onClick={() => handleDeleteSlab(selectedSlab.id)}>
                      Delete Slab
                    </button>
                  </div>
                </section>
              ) : null}

              {selectedExternalModel ? (
                <section
                  className="inspector-section"
                  onFocusCapture={() =>
                    focusSelection({ kind: "externalModel", id: selectedExternalModel.id })
                  }
                >
                  <p className="section-kicker">Selection</p>
                  <h2>Model Inspector</h2>
                  <div className="field-stack">
                    <label className="field-label">
                      <span>Name</span>
                      <input
                        type="text"
                        value={selectedExternalModel.name}
                        onChange={(event) =>
                          handleUpdateSelectedExternalModel(
                            { name: event.target.value },
                            `Updated model "${event.target.value}".`,
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>URI</span>
                      <input
                        type="text"
                        value={selectedExternalModel.uri}
                        onChange={(event) =>
                          handleUpdateSelectedExternalModel(
                            { uri: event.target.value },
                            "Updated model URI.",
                          )
                        }
                      />
                    </label>
                  </div>
                  <div className="field-grid">
                    <label className="field-label">
                      <span>X</span>
                      <input
                        type="number"
                        step="0.1"
                        value={selectedExternalModel.position.x}
                        onChange={(event) =>
                          commitCoordinateInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedExternalModel(
                              {
                                position: createVec2(value, selectedExternalModel.position.y),
                              },
                              "Updated model position.",
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Y</span>
                      <input
                        type="number"
                        step="0.1"
                        value={selectedExternalModel.position.y}
                        onChange={(event) =>
                          commitCoordinateInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedExternalModel(
                              {
                                position: createVec2(selectedExternalModel.position.x, value),
                              },
                              "Updated model position.",
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Z (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        value={selectedExternalModel.zM}
                        onChange={(event) =>
                          commitNumericInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedExternalModel(
                              { zM: value },
                              "Updated model elevation.",
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>Yaw (rad)</span>
                      <input
                        type="number"
                        step="0.1"
                        value={selectedExternalModel.yawRad}
                        onChange={(event) =>
                          commitNumericInput(event.target.valueAsNumber, (value) =>
                            handleUpdateSelectedExternalModel(
                              { yawRad: value },
                              "Updated model yaw.",
                            ),
                          )
                        }
                      />
                    </label>
                  </div>
                  <div className="button-row">
                    <button
                      type="button"
                      onClick={() => handleDeleteExternalModel(selectedExternalModel.id)}
                    >
                      Delete Model
                    </button>
                  </div>
                </section>
              ) : null}

              <section className="inspector-section">
                <p className="section-kicker">Import</p>
                <h2>Warnings</h2>
                <p className="muted">
                  Latest import warnings: {lastImportWarnings.length}
                </p>
                <ul className="warning-list">
                  {lastImportWarnings.length > 0 ? (
                    lastImportWarnings.map((warning) => <li key={warning}>{warning}</li>)
                  ) : (
                    <li>No import warnings.</li>
                  )}
                </ul>
                <div className="button-row">
                  <button
                    type="button"
                    onClick={() => {
                      resetProject();
                      clearSelection();
                      reportSuccess("Reset the project back to an empty WaWoD Studio baseline.");
                    }}
                  >
                    Reset Project
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleLoadBuiltInSample()}
                  >
                    Load Built-In Sample
                  </button>
                </div>
              </section>
            </>
          ) : (
            <div className="collapsed-panel">
              <span>Inspector</span>
              <button type="button" onClick={() => setInspectorOpen(true)}>
                Open
              </button>
            </div>
          )}
        </aside>
      </section>

      {panelVisibility.statusBarVisible ? (
        <footer className="status-line status-line-overlay">
          <span>Editor {editorMode}</span>
          <span>View {viewportMode === "2d" ? "2D" : "3D"}</span>
          {editorMode === "Building" ? <span>Tool {activeTool}</span> : <span>Tools pending</span>}
          {editorMode === "Building" ? <span>Level {activeLevelName}</span> : null}
          {editorMode === "Building" ? <span>Wall Type {activeWallTypeName}</span> : null}
          {viewportMode === "2d" ? (
            <>
              <span>
                Cursor{" "}
                {viewport.cursorWorld
                  ? `${formatNumber(viewport.cursorWorld.x)}, ${formatNumber(viewport.cursorWorld.y)}`
                  : "off-canvas"}
              </span>
              <span>
                Zoom {formatNumber(viewport.zoom)} | Pan {formatNumber(viewport.pan.x)}/
                {formatNumber(viewport.pan.y)}
              </span>
            </>
          ) : (
            <span>
              Camera {(preview3D.cameraMode as string | undefined) === "FreeCamera" ? "Free" : (preview3D.cameraMode as string | undefined) === "FreeOrbit" || (preview3D.cameraMode as string | undefined) === "Free" ? "Free Orbit" : "Orbit"} | Yaw {formatNumber(preview3D.yawDeg)} | Pitch {formatNumber(preview3D.pitchDeg)} | Distance {formatNumber(preview3D.distanceMultiplier)}x | Join {preview3D.renderMode === "ArchitecturalJoin" ? "Architectural" : "Node Post"} | Surface {preview3D.surfaceMode === "LevelColor" ? "Level Color" : "Gray Opaque"}
            </span>
          )}
          <span>
            Undo {historyLength} | Redo {futureLength}
          </span>
          <span>{isHistoryTransactionOpen ? "History grouping active" : "History idle"}</span>
          <span>{projectValidation.success ? "Project valid" : "Project invalid"}</span>
          <button
            type="button"
            className="status-line-help-button"
            onClick={() => setHelpCardOpen(!panelVisibility.helpCardOpen)}
            aria-label={panelVisibility.helpCardOpen ? "Hide help" : "Show help"}
            title={panelVisibility.helpCardOpen ? "Hide help" : "Show help"}
          >
            ?
          </button>
        </footer>
      ) : null}
    </main>
  );
}
