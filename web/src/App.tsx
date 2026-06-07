import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import {
  FloatingWindow,
  type FloatingWindowPosition,
} from "./components/floating-window";
import { ViewportScene } from "./components/viewport-scene";
import { ViewportScene3D } from "./components/viewport-scene-3d";
import {
  createDoor,
  createMeasurement,
  createWindow,
  addLevel,
  addWallType,
  createExternalModel,
  createNode,
  createShape,
  createSlab,
  createRoofSketch,
  createStair,
  createWall,
  deleteWallType,
  deleteLevel,
  deleteMeasurement,
  deleteDoor,
  deleteWindow,
  deleteExternalModel,
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
  updateLevel,
  updateProjectSettings,
  updateRoofSketch,
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
  type WindowOpening,
  type WindowDesign3D,
  createExternalModel as buildExternalModel,
  createId,
  createNodeData,
  createPose2D,
  createShape as buildShape,
  createSlab as buildSlab,
  createVec2,
  createWall as buildWall,
  describeProject,
  type ExternalModel,
  type MeasurementUnit,
  type NodeData,
  type Project,
  type RoofSketch,
  type WallTopMode,
  type RoofType,
  type Shape,
  type Slab,
  type Stair,
  type Vec2,
  type Wall,
} from "./domain/project-model";
import { sampleProject } from "./domain/sample-project";
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
  createViewportBoundsFromPoints,
  expandViewportBounds,
  getViewportFit,
  mergeViewportBounds,
  snapValueToGrid,
  type ViewportBounds,
} from "./domain/viewport";
import {
  type EditorSelection,
  type EditorTool,
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
  "Roof",
  "Model",
];

const editorTools3D: EditorTool[] = ["Measure", "Door", "Window"];

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

interface SelectionClipboardPayload {
  nodes: NodeData[];
  walls: Wall[];
  shapes: Shape[];
  slabs: Slab[];
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
  const previewMenuRef = useRef<HTMLDivElement | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const previewWindowSourceIdRef = useRef(crypto.randomUUID());

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

  const activeTool = useEditorUiStore((state) => state.activeTool);
  const viewportMode = useEditorUiStore((state) => state.viewportMode);
  const wallAuthoringMode = useEditorUiStore((state) => state.wallAuthoringMode);
  const activeLevelId = useEditorUiStore((state) => state.activeLevelId);
  const activeWallTypeId = useEditorUiStore((state) => state.activeWallTypeId);
  const hiddenLevelIds2D = useEditorUiStore((state) => state.hiddenLevelIds2D);
  const hiddenLevelIds3D = useEditorUiStore((state) => state.hiddenLevelIds3D);
  const currentSelection = useEditorUiStore((state) => state.currentSelection);
  const selectionSet = useEditorUiStore((state) => state.selectionSet);
  const pendingWallStartNodeId = useEditorUiStore((state) => state.pendingWallStartNodeId);
  const slabMode = useEditorUiStore((state) => state.slabMode);
  const panelVisibility = useEditorUiStore((state) => state.panelVisibility);
  const viewport = useEditorUiStore((state) => state.viewport);
  const preview3D = useEditorUiStore((state) => state.preview3D);
  const viewportPresets = useEditorUiStore((state) => state.viewportPresets);
  const setViewportMode = useEditorUiStore((state) => state.setViewportMode);
  const setWallAuthoringMode = useEditorUiStore((state) => state.setWallAuthoringMode);
  const setActiveTool = useEditorUiStore((state) => state.setActiveTool);
  const setActiveLevelId = useEditorUiStore((state) => state.setActiveLevelId);
  const setActiveWallTypeId = useEditorUiStore((state) => state.setActiveWallTypeId);
  const toggleLevelVisibility = useEditorUiStore((state) => state.toggleLevelVisibility);
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
  const [viewportFrame, setViewportFrame] = useState({ widthPx: 0, heightPx: 0 });
  const [clipboardPayload, setClipboardPayload] = useState<SelectionClipboardPayload | null>(null);
  const [clipboardPasteCount, setClipboardPasteCount] = useState(0);
  const [projectNameDraft, setProjectNameDraft] = useState(project.projectName);
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
  const [door3DFrameThicknessM, setDoor3DFrameThicknessM] = useState(0.08);
  const [door3DFrameColorHex, setDoor3DFrameColorHex] = useState("#c4cbd6");
  const [door3DDoorColorHex, setDoor3DDoorColorHex] = useState("#8a5b3d");
  const [door3DWallDepthOffsetM, setDoor3DWallDepthOffsetM] = useState(0);
  const [door3DOpenState, setDoor3DOpenState] = useState<Door3DOpenState>("Closed");
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
  const [measureToolUnit, setMeasureToolUnit] = useState<MeasurementUnit>("m");
  const [measureToolPermanent, setMeasureToolPermanent] = useState(false);
  const [shapeToolKind, setShapeToolKind] = useState<Shape["kind"]>("Square");
  const [shapeToolBottomM, setShapeToolBottomM] = useState(0);
  const [shapeToolTopM, setShapeToolTopM] = useState(2.5);
  const [roofToolLineElevationM, setRoofToolLineElevationM] = useState(3);
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
      if (viewportMode === "3d") {
        return editorTools3D;
      }

      return wallAuthoringMode === "AutoWall"
        ? editorTools.filter((tool) => tool !== "Node")
        : editorTools;
    },
    [viewportMode, wallAuthoringMode],
  );
  const hiddenLevelIdSet2D = useMemo(() => new Set(hiddenLevelIds2D), [hiddenLevelIds2D]);
  const hiddenLevelIdSet3D = useMemo(() => new Set(hiddenLevelIds3D), [hiddenLevelIds3D]);

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
    () => filterProjectByHiddenLevels(hiddenLevelIdSet2D),
    [filterProjectByHiddenLevels, hiddenLevelIdSet2D],
  );
  const visibleProject3D = useMemo(
    () => filterProjectByHiddenLevels(hiddenLevelIdSet3D),
    [filterProjectByHiddenLevels, hiddenLevelIdSet3D],
  );
  const currentHiddenLevelIdSet = viewportMode === "3d" ? hiddenLevelIdSet3D : hiddenLevelIdSet2D;
  const activeLevel = project.levels.find((level) => level.id === activeLevelId) ?? null;
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
  const selectedRoofEdgeIds = selectionSet
    .filter((selection) => selection.kind === "roofEdge")
    .map((selection) => selection.id);
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
    if (viewportMode === "2d" && !editorTools3D.includes(activeTool)) {
      last2DToolRef.current = activeTool;
    }

    if (viewportMode === "3d" && editorTools3D.includes(activeTool)) {
      last3DToolRef.current = activeTool;
    }
  }, [activeTool, viewportMode]);

  const previousViewportModeRef = useRef(viewportMode);
  useEffect(() => {
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
  }, [activeTool, setActiveTool, viewportMode]);

  useEffect(() => {
    if (wallAuthoringMode === "AutoWall" && activeTool === "Node") {
      setActiveTool("Wall");
    }
  }, [activeTool, setActiveTool, wallAuthoringMode]);

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
        ),
      } satisfies PreviewWindowMessage);
    };

    channel.addEventListener("message", handleMessage);
    return () => {
      channel.removeEventListener("message", handleMessage);
      channel.close();
    };
  }, [hiddenLevelIds3D, preview3D, project]);

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
        if (selectionSet.length === 0) {
          return;
        }

        event.preventDefault();
        handleCopySelection();
        return;
      }

      if (key === "v") {
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
  }, [canRedo, canUndo, clipboardPayload, isHistoryTransactionOpen, redo, selectionSet, undo]);

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
    const models = project.externalModels.filter((model) => selectedModelIds.includes(model.id));

    if (
      nodes.length === 0 &&
      walls.length === 0 &&
      shapes.length === 0 &&
      slabs.length === 0 &&
      models.length === 0
    ) {
      return null;
    }

    return { nodes, walls, shapes, slabs, models };
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
      `Copied ${payload.nodes.length} node(s), ${payload.shapes.length} shape(s), ${payload.slabs.length} slab(s), ${payload.models.length} model marker(s) and ${payload.walls.length} wall(s).`,
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
        });
        newSelections.push({ kind: "slab", id: nextSlab.id });
        return nextSlab;
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

        return createRectBounds(
          selectedSlab.pose.position,
          selectedSlab.widthM,
          selectedSlab.depthM,
        );
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
        createRectBounds(slab.pose.position, slab.widthM, slab.depthM),
      );
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
      frameThicknessM: door3DFrameThicknessM,
      frameColorHex: door3DFrameColorHex,
      doorColorHex: door3DDoorColorHex,
      wallDepthOffsetM: door3DWallDepthOffsetM,
      openState: door3DOpenState,
      hingeSide: door3DHingeSide,
      swingDirection: door3DSwingDirection,
    };
  }

  function handleApplyDoor3DInsert(doorId: string) {
    try {
      const design3D = createCurrentDoor3DDesign();
      applyCommand((current) => updateDoor(current, doorId, { design3D }));
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
      const design3D = createCurrentWindow3DDesign();
      applyCommand((current) => updateWindow(current, windowId, { design3D }));
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

  function handleSelectWindow3D(windowId: string) {
    const targetWindow = project.windows.find((windowOpening) => windowOpening.id === windowId);
    if (!targetWindow) {
      return;
    }

    setActiveTool("Window");
    setSingleSelection({ kind: "window", id: windowId });
    reportSuccess(`Selected window opening "${windowId}" for 3D editing.`);
  }

  function handleClear3DOpeningSelection() {
    if (currentSelection?.kind !== "window" && currentSelection?.kind !== "door") {
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

  function handleUpdateSelectedRoofEdgeElevation(elevationM: number) {
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
      const vertexIds = new Set([
        selectedRoofEdge.startVertexId,
        selectedRoofEdge.endVertexId,
      ]);
      applyCommand((current) =>
        updateRoofSketch(current, selectedRoofSketch.id, {
          vertices: selectedRoofSketch.vertices.map((vertex) =>
            vertexIds.has(vertex.id)
              ? {
                  ...vertex,
                  elevationMode: "Explicit",
                  elevationM,
                }
              : vertex,
          ),
        }),
      );
      reportSuccess(`Updated roof line elevation to ${formatNumber(elevationM)} m.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Roof line elevation update failed.";
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

  function handleCommitWindow3DToolDesign(
    patch: Partial<WindowDesign3D>,
    message = "Updated 3D window design.",
  ) {
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
    if (!selectedDoor) {
      const nextDesign: DoorDesign3D = {
        ...createCurrentDoor3DDesign(),
        ...patch,
      };

      setDoor3DKind(nextDesign.kind);
      setDoor3DFrameThicknessM(nextDesign.frameThicknessM);
      setDoor3DFrameColorHex(nextDesign.frameColorHex);
      setDoor3DDoorColorHex(nextDesign.doorColorHex);
      setDoor3DWallDepthOffsetM(nextDesign.wallDepthOffsetM);
      setDoor3DOpenState(nextDesign.openState);
      setDoor3DHingeSide(nextDesign.hingeSide);
      setDoor3DSwingDirection(nextDesign.swingDirection);
      return;
    }

    const nextDesign: DoorDesign3D = {
      ...(selectedDoor.design3D ?? createCurrentDoor3DDesign()),
      ...patch,
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

  function handleCreateSlabAt(position: Vec2 & { widthM?: number; depthM?: number }) {
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
        pose: createPose2D(createVec2(position.x, position.y), 0),
        widthM: position.widthM ?? 2.4,
        depthM:
          slabMode === "Circle"
            ? position.widthM ?? position.depthM ?? 2.4
            : position.depthM ?? 1.8,
        thicknessM: 0.2,
        roofRiseM: 1.2,
        zOffsetM: 0,
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
      const roofLayer = current.roofLayers[0];
      if (!roofLayer) {
        throw new Error("Project has no roof layer.");
      }

      const startVertexId = createId("roof_vertex");
      const endVertexId = createId("roof_vertex");
      const edgeId = createId("roof_edge");
      createdEdgeId = edgeId;
      const vertices = [
        {
          id: startVertexId,
          position: createVec2(start.x, start.y),
          elevationMode: "Explicit" as const,
          elevationM: roofToolLineElevationM,
        },
        {
          id: endVertexId,
          position: createVec2(end.x, end.y),
          elevationMode: "Explicit" as const,
          elevationM: roofToolLineElevationM,
        },
      ];
      const edge = {
        id: edgeId,
        startVertexId,
        endVertexId,
        role: "Generic" as const,
      };
      const existingSketch = getManualRoofSketch(current);

      if (!existingSketch) {
        return createRoofSketch(current, {
          name: "Manual Roof Sketch",
          layerId: roofLayer.id,
          baseElevationM: roofToolLineElevationM,
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
      `Created roof line at ${formatNumber(roofToolLineElevationM)} m, length ${formatNumber(lengthM)} m.`,
    );
  }

  function handleLinkSelectedRoofEdges() {
    if (selectedRoofEdgeIds.length !== 2) {
      reportError("Select exactly two roof lines before linking them.");
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

      const [firstEdgeId, secondEdgeId] = selectedRoofEdgeIds;
      const firstEdge = sketch.edges.find((edge) => edge.id === firstEdgeId);
      const secondEdge = sketch.edges.find((edge) => edge.id === secondEdgeId);
      if (!firstEdge || !secondEdge) {
        throw new Error("Selected roof line no longer exists.");
      }

      const vertexById = new Map(sketch.vertices.map((vertex) => [vertex.id, vertex] as const));
      const firstStart = vertexById.get(firstEdge.startVertexId);
      const firstEnd = vertexById.get(firstEdge.endVertexId);
      const secondStart = vertexById.get(secondEdge.startVertexId);
      const secondEnd = vertexById.get(secondEdge.endVertexId);
      if (!firstStart || !firstEnd || !secondStart || !secondEnd) {
        throw new Error("Selected roof line has missing vertices.");
      }

      const sameDirectionCost =
        distanceSquared(firstStart.position, secondStart.position) +
        distanceSquared(firstEnd.position, secondEnd.position);
      const oppositeDirectionCost =
        distanceSquared(firstStart.position, secondEnd.position) +
        distanceSquared(firstEnd.position, secondStart.position);
      const secondEdgeVertexIds =
        sameDirectionCost <= oppositeDirectionCost
          ? [secondEdge.endVertexId, secondEdge.startVertexId]
          : [secondEdge.startVertexId, secondEdge.endVertexId];
      const faceId = createId("roof_face");
      linkedFaceId = faceId;
      return updateRoofSketch(current, sketch.id, {
        faces: [
          ...sketch.faces,
          {
            id: faceId,
            vertexIds: [
              firstEdge.startVertexId,
              firstEdge.endVertexId,
              ...secondEdgeVertexIds,
            ],
            edgeIds: [firstEdge.id, secondEdge.id],
            constraintIds: [],
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
    floatingWindowVisibility.tool &&
    (activeTool === "Measure" ||
      activeTool === "Door" ||
      activeTool === "Window" ||
      activeTool === "Shape" ||
      activeTool === "Stair" ||
      activeTool === "Slab" ||
      activeTool === "Roof" ||
      viewportMode === "3d");

  const showContextWindow =
    floatingWindowVisibility.context &&
    currentSelection !== null &&
    !(
      viewportMode === "3d" &&
      ((activeTool === "Window" && currentSelection.kind === "window") ||
        (activeTool === "Door" && currentSelection.kind === "door"))
    );

  function renderToolWindowContent() {
    if (viewportMode === "3d") {
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
              </select>
            </label>
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
            {effectiveDoor3DDesign.kind === "Normal" ? (
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
            ) : null}
            {selectedDoor ? (
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
        </div>
      );
    }

    if (activeTool === "Roof") {
      return (
        <div className="field-stack">
          <p className="muted">
            Drag in the roof layer to draw a roof line. Click two roof lines and link them into one roof face.
          </p>
          <label className="field-label">
            <span>Line Elevation (m)</span>
            <DraftNumberInput
              value={roofToolLineElevationM}
              step="0.1"
              min="0"
              onCommit={(nextValue) => {
                if (Number.isFinite(nextValue)) {
                  setRoofToolLineElevationM(nextValue);
                }
              }}
            />
          </label>
          <div className="button-row">
            <button
              type="button"
              onClick={handleLinkSelectedRoofEdges}
              disabled={selectedRoofEdgeIds.length !== 2}
            >
              Link Selected Lines
            </button>
            <button type="button" onClick={clearSelection} disabled={selectedRoofEdgeIds.length === 0}>
              Clear Selection
            </button>
          </div>
          <p className="muted">
            Selected roof lines: {selectedRoofEdgeIds.length}. First version links the two selected lines as
            a single four-point planar face.
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
            <span>Line Elevation (m)</span>
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
            Editing the line elevation sets both roof-line endpoints to the same height and updates connected faces.
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
            {availableEditorTools.map((tool) => (
              <button
                key={tool}
                type="button"
                className={tool === activeTool ? "toolbar-button is-active" : "toolbar-button"}
                onClick={() => setActiveTool(tool)}
              >
                {tool}
              </button>
            ))}
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
              {viewportMode === "3d" ? "Back To 2D" : "Open 3D Preview"}
            </button>
            <button
              type="button"
              className="toolbar-button ghost toolbar-split-toggle"
              onClick={() => setIsPreviewMenuOpen((current) => !current)}
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
                  Open In New Tab
                </button>
                </div>
              ) : null}
            </div>
            <div ref={settingsMenuRef} className="toolbar-split-menu">
              <button
                type="button"
                className="toolbar-button ghost toolbar-icon-button"
                onClick={() => setIsSettingsMenuOpen((current) => !current)}
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
              <span>Tool: {activeTool}</span>
              <span>Level: {activeLevelName}</span>
              <span>Wall Type: {activeWallTypeName}</span>
            </div>
          </div>

          <div ref={viewportCanvasRef} className="viewport-canvas">
            {viewportMode === "2d" ? (
              <>
                <ViewportScene
                  project={visibleProject2D}
                  activeTool={activeTool}
                  wallAuthoringMode={wallAuthoringMode}
                  activeLevelId={activeLevelId}
                  slabMode={slabMode}
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
                  onCreateRoofLine={handleCreateRoofLine}
                  onCreateExternalModelAt={handleCreateExternalModelAt}
                  onCreateWallBetweenNodes={handleCreateWallBetweenNodes}
                  onCreateWallByDrag={handleCreateWallByDrag}
                  onDeleteNode={handleDeleteNode}
                  onDeleteWall={handleDeleteWall}
                  onDeleteDoor={handleDeleteDoor}
                  onDeleteWindow={handleDeleteWindow}
                  onDeleteMeasurement={handleDeleteMeasurement}
                  onDeleteStair={handleDeleteStair}
                  onDeleteWallsConnectedToNode={handleDeleteWallsConnectedToNode}
                  onDeleteShape={handleDeleteShape}
                  onDeleteSlab={handleDeleteSlab}
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
                  onMoveRoofEdge={handleMoveRoofEdge}
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
                activeTool={activeTool}
                selectedDoorId={selectedDoor?.id ?? null}
                onSelectDoor={handleSelectDoor3D}
                onInsertDoor3D={handleApplyDoor3DInsert}
                selectedWindowId={selectedWindow?.id ?? null}
                onSelectWindow={handleSelectWindow3D}
                onClearOpeningSelection={handleClear3DOpeningSelection}
                onInsertWindow3D={handleApplyWindow3DInsert}
                door3DToolDesign={createCurrentDoor3DDesign()}
                window3DToolDesign={createCurrentWindow3DDesign()}
              />
            )}

            <div className="activity-banner">
              <strong>{activityMessage}</strong>
              {errorMessage ? <span className="error-text">{errorMessage}</span> : null}
            </div>

            {panelVisibility.helpCardOpen ? (
            <div className="viewport-card">
              <div className="viewport-card-header">
                <div>
                  <p className="section-kicker">Hint</p>
                  <h2>Current editor controls</h2>
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
              <p>
                Frontend mode is now tuned around direct viewport editing, grouped history,
                local import/export and tool-specific left-place or right-delete behavior.
              </p>
              <p className="muted">
                Move Tool: left-drag moves the current entity or the whole selected set,
                right-drag draws a box selection, and Ctrl/Cmd+C then Ctrl/Cmd+V copies and pastes
                the current movable selection with a small offset.
              </p>
              <p className="muted">
                Node Tool: left-click places a node, or hold and drag to measure from the start point
                and place the node on release. Right-click deletes a node, and duplicate nodes cannot
                be placed on the same spot.
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
                a rectangle slab, or in circle mode click for center and drag radius. Model Tool:
                left-click places a marker.
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
                3D Preview: swap the main canvas into a read-only orbit view that renders all
                floors, walls, slabs, shapes and model markers together. Drag to orbit and use
                the wheel to zoom.
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
                  {viewportMode === "2d" ? "Open 3D Preview" : "Back To 2D"}
                </button>
                <button type="button" onClick={resetPreview3D}>
                  Reset 3D Camera
                </button>
                <button
                  type="button"
                  onClick={() => {
                    replaceProject(sampleProject, false);
                    reportSuccess("Loaded the built-in sample project into the shell.");
                  }}
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
            </div>
            ) : null}

            {floatingWindowVisibility.levels ? (
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
                          level.id === activeLevelId
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

            {editingLevel && floatingWindowVisibility.levelEdit ? (
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

            {floatingWindowVisibility.wallTypes ? (
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

            {editingWallType && floatingWindowVisibility.wallTypeEdit ? (
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

            {floatingWindowVisibility.grid ? (
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
                title={viewportMode === "3d" ? `${activeTool} Tool` : `${activeTool} Tool`}
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
                  </div>
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
                          </select>
                        </label>
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
                        {(selectedDoor.design3D?.kind ?? door3DKind) === "Normal" ? (
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
                        onChange={(event) =>
                          handleUpdateSelectedSlab(
                            event.target.value === "Circle"
                              ? {
                                  kind: event.target.value as typeof selectedSlab.kind,
                                  roofType: "Flat",
                                }
                              : { kind: event.target.value as typeof selectedSlab.kind },
                            `Changed slab kind to ${event.target.value}.`,
                          )
                        }
                      >
                        <option value="Rectangle">Rectangle</option>
                        <option value="Circle">Circle</option>
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
                    onClick={() => {
                      replaceProject(sampleProject, false);
                      reportSuccess("Loaded the built-in sample project into the shell.");
                    }}
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
          <span>View {viewportMode === "2d" ? "2D Editor" : "3D Preview"}</span>
          <span>Tool {activeTool}</span>
          <span>Level {activeLevelName}</span>
          <span>Wall Type {activeWallTypeName}</span>
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
              Orbit Yaw {formatNumber(preview3D.yawDeg)} | Pitch {formatNumber(preview3D.pitchDeg)} | Distance {formatNumber(preview3D.distanceMultiplier)}x | Join {preview3D.renderMode === "ArchitecturalJoin" ? "Architectural" : "Node Post"} | Surface {preview3D.surfaceMode === "LevelColor" ? "Level Color" : "Gray Opaque"}
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
