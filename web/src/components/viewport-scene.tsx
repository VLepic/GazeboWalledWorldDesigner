import { useEffect, useRef, useState } from "react";
import { createVec2 } from "../domain/project-model";
import type {
  DoorOpening,
  ExternalModel,
  Measurement,
  MeasurementUnit,
  NodeData,
  Project,
  Shape,
  Slab,
  Stair,
  Vec2,
  Wall,
  WindowOpening,
} from "../domain/project-model";
import {
  getGridLines,
  getViewportBounds,
  getZoomAroundPoint,
  screenToWorld,
  snapPointToGrid,
  worldToScreen,
} from "../domain/viewport";
import type {
  EditorSelection,
  EditorTool,
  SlabMode,
  ViewportState,
  WallAuthoringMode,
} from "../store/editor-ui-store";

interface ViewportSceneProps {
  project: Project;
  activeTool: EditorTool;
  wallAuthoringMode: WallAuthoringMode;
  activeLevelId: string | null;
  slabMode: SlabMode;
  pendingWallStartNodeId: string | null;
  currentSelection: EditorSelection | null;
  selectionSet: EditorSelection[];
  stairToolWidthM: number;
  viewport: ViewportState;
  onPanChange: (pan: Vec2) => void;
  onZoomChange: (zoom: number) => void;
  onCursorWorldChange: (cursorWorld: Vec2 | null) => void;
  onSelectionChange: (selection: EditorSelection | null) => void;
  onSelectionSetChange: (
    selectionSet: EditorSelection[],
    primarySelection?: EditorSelection | null,
  ) => void;
  onPendingWallStartNodeChange: (nodeId: string | null) => void;
  onCreateNodeAt: (position: Vec2) => void;
  onInsertNodeIntoWall: (wallId: string, position: Vec2) => void;
  onCreateDoorOnWall: (wallId: string, position: Vec2) => void;
  onCreateWindowOnWall: (wallId: string, position: Vec2) => void;
  onCreateMeasurement: (start: Vec2, end: Vec2, unit: MeasurementUnit) => void;
  onCreateStair: (pathNodes: Vec2[]) => void;
  onCreateShapeAt: (input: Vec2 & { sizeM?: number }) => void;
  onCreateSlabAt: (input: Vec2 & { widthM?: number; depthM?: number }) => void;
  onCreateRoofLine: (start: Vec2, end: Vec2) => void;
  onCreateRoofOpening: (input: { roofSketchId: string; roofFaceId: string; center: Vec2 }) => void;
  onCreateExternalModelAt: (position: Vec2) => void;
  onCreateWallBetweenNodes: (startNodeId: string, endNodeId: string) => void;
  onCreateWallByDrag: (input: {
    start: { nodeId: string | null; wallId: string | null; position: Vec2 };
    end: { nodeId: string | null; wallId: string | null; position: Vec2 };
  }) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteWall: (wallId: string) => void;
  onDeleteDoor: (doorId: string) => void;
  onDeleteWindow: (windowId: string) => void;
  onDeleteRoofOpening: (roofOpeningId: string) => void;
  onDeleteMeasurement: (measurementId: string) => void;
  onDeleteStair: (stairId: string) => void;
  onDeleteWallsConnectedToNode: (nodeId: string) => void;
  onDeleteShape: (shapeId: string) => void;
  onDeleteSlab: (slabId: string) => void;
  onDeleteExternalModel: (modelId: string) => void;
  onMoveInteractionStart: () => void;
  onMoveInteractionCommit: () => void;
  onMoveInteractionCancel: () => void;
  onMoveNode: (nodeId: string, position: Vec2) => void;
  onMoveDoor: (doorId: string, position: Vec2) => void;
  onMoveWindow: (windowId: string, position: Vec2) => void;
  onMoveShape: (shapeId: string, position: Vec2) => void;
  onMoveSlab: (slabId: string, position: Vec2) => void;
  onResizeSlab: (slabId: string, patch: { position: Vec2; widthM: number; depthM: number }) => void;
  onMoveRoofEdge: (roofEdgeId: string, position: Vec2) => void;
  onMoveRoofVertex: (roofSketchId: string, roofVertexId: string, position: Vec2) => void;
  onMoveRoofOpening: (roofOpeningId: string, position: Vec2) => void;
  onMoveExternalModel: (modelId: string, position: Vec2) => void;
  measureToolUnit: MeasurementUnit;
  measureToolPermanent: boolean;
}

interface PanDragState {
  kind: "pan";
  pointerId: number;
  lastClientX: number;
  lastClientY: number;
}

interface MoveDragState {
  kind: "move";
  pointerId: number;
  anchorEntityKind:
    | "node"
    | "door"
    | "window"
    | "shape"
    | "slab"
    | "roofEdge"
    | "roofOpening"
    | "externalModel";
  anchorEntityId: string;
  anchorStartPosition: Vec2;
  startPointerWorld: Vec2;
  items: Array<{
    entityKind:
      | "node"
      | "door"
      | "window"
      | "shape"
      | "slab"
      | "roofEdge"
      | "roofOpening"
      | "externalModel";
    entityId: string;
    startPosition: Vec2;
  }>;
}

interface RoofVertexDragState {
  kind: "roofVertex";
  pointerId: number;
  roofSketchId: string;
  roofEdgeId: string;
  roofVertexId: string;
  startPosition: Vec2;
  startPointerWorld: Vec2;
}

interface SlabResizeDragState {
  kind: "slabResize";
  pointerId: number;
  slabId: string;
  fixedCorner: Vec2;
  movingCornerSignX: -1 | 1;
  movingCornerSignY: -1 | 1;
  startWidthM: number;
  startDepthM: number;
}

type MoveDragItem = MoveDragState["items"][number];

type PlacementDraftState =
  | {
      kind: "node";
      pointerId: number;
      startWorld: Vec2;
      currentWorld: Vec2;
      startedFromExistingNode: boolean;
      splitWallId: string | null;
    }
  | {
      kind: "shape" | "slab";
      pointerId: number;
      startWorld: Vec2;
      currentWorld: Vec2;
    }
  | {
      kind: "wall";
      pointerId: number;
      startWorld: Vec2;
      currentWorld: Vec2;
      startNodeId: string | null;
      startWallId: string | null;
      hasDragged: boolean;
    }
  | {
      kind: "measure";
      pointerId: number;
      startWorld: Vec2;
      currentWorld: Vec2;
    }
  | {
      kind: "roofLine";
      pointerId: number;
      startWorld: Vec2;
      currentWorld: Vec2;
    };

interface BoxSelectDragState {
  kind: "select";
  pointerId: number;
  startWorld: Vec2;
  currentWorld: Vec2;
}

type DragState =
  | PanDragState
  | MoveDragState
  | RoofVertexDragState
  | SlabResizeDragState
  | BoxSelectDragState;

interface VisibleEntityStyle {
  stroke: string;
  fill: string;
  opacity: number;
  interactive: boolean;
}

function getLevelStyle(project: Project, levelId: string, activeLevelId: string | null): VisibleEntityStyle | null {
  const level = project.levels.find((item) => item.id === levelId);
  const activeLevel = project.levels.find((item) => item.id === activeLevelId);

  if (!level) {
    return null;
  }

  if (!activeLevel) {
    return {
      stroke: "#a8c7d8",
      fill: "rgba(168, 199, 216, 0.18)",
      opacity: 1,
      interactive: true,
    };
  }

  if (level.elevationM > activeLevel.elevationM) {
    return null;
  }

  if (level.id === activeLevel.id) {
    return {
      stroke: "#b4ecff",
      fill: "rgba(116, 210, 255, 0.24)",
      opacity: 1,
      interactive: true,
    };
  }

  return {
    stroke: "#9da8b0",
    fill: "rgba(157, 168, 176, 0.14)",
    opacity: 0.55,
    interactive: false,
  };
}

function isSelected(selection: EditorSelection | null, kind: EditorSelection["kind"], id: string) {
  return selection?.kind === kind && selection.id === id;
}

function isIncludedInSelectionSet(
  selectionSet: EditorSelection[],
  kind: EditorSelection["kind"],
  id: string,
) {
  return selectionSet.some((selection) => selection.kind === kind && selection.id === id);
}

function isViewportEntityTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest("[data-viewport-entity]") !== null;
}

function isEntityInteractiveForTool(
  activeTool: EditorTool,
  entityKind:
    | "node"
    | "wall"
    | "measure"
    | "door"
    | "window"
    | "stair"
    | "shape"
    | "slab"
    | "roofEdge"
    | "roofFace"
    | "roofOpening"
    | "externalModel",
) {
  switch (activeTool) {
    case "Move":
      return entityKind !== "wall" && entityKind !== "stair" && entityKind !== "roofFace";
    case "Node":
      return entityKind === "node" || entityKind === "wall";
    case "Wall":
      return entityKind === "node" || entityKind === "wall";
    case "Measure":
      return entityKind === "measure";
    case "Door":
      return entityKind === "wall" || entityKind === "door";
    case "Window":
      return entityKind === "wall" || entityKind === "window";
    case "Stair":
      return entityKind === "stair";
    case "Shape":
      return entityKind === "shape";
    case "Slab":
      return entityKind === "slab";
    case "Roof":
      return entityKind === "roofEdge" || entityKind === "roofFace";
    case "RoofOpening":
      return entityKind === "roofFace" || entityKind === "roofOpening";
    case "RoofWindow":
      return entityKind === "roofOpening";
    case "Model":
      return entityKind === "externalModel";
  }
}

function renderSquare(shape: Shape, metrics: Parameters<typeof worldToScreen>[1]) {
  const center = worldToScreen(shape.pose.position, metrics);
  const size = shape.sizeM * projectScale(metrics);

  return {
    x: center.x - size / 2,
    y: center.y - size / 2,
    width: size,
    height: size,
  };
}

function getDoorSegmentWorldPoints(door: DoorOpening, startNode: NodeData, endNode: NodeData) {
  return getWallOpeningSegmentWorldPoints(door, startNode, endNode);
}

function getWindowSegmentWorldPoints(windowOpening: WindowOpening, startNode: NodeData, endNode: NodeData) {
  return getWallOpeningSegmentWorldPoints(windowOpening, startNode, endNode);
}

function getWallOpeningSegmentWorldPoints(
  opening: Pick<DoorOpening, "widthM" | "offsetM">,
  startNode: NodeData,
  endNode: NodeData,
) {
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

function createSvgPathFromPoints(points: Vec2[], metrics: Parameters<typeof worldToScreen>[1]) {
  return points
    .map((point, index) => {
      const screenPoint = worldToScreen(point, metrics);
      return `${index === 0 ? "M" : "L"} ${screenPoint.x} ${screenPoint.y}`;
    })
    .join(" ");
}

function projectScale(metrics: Parameters<typeof worldToScreen>[1]) {
  return metrics.pixelsPerMeter * metrics.zoom;
}

function hasSamePosition(left: Vec2, right: Vec2) {
  return Math.abs(left.x - right.x) < 0.0001 && Math.abs(left.y - right.y) < 0.0001;
}

function projectPointOntoSegment(point: Vec2, start: Vec2, end: Vec2) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (lengthSquared < 0.000001) {
    return start;
  }

  const t =
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared;
  const clampedT = Math.max(0, Math.min(1, t));

  return createVec2(start.x + deltaX * clampedT, start.y + deltaY * clampedT);
}

function getCurrentEntityPosition(
  project: Project,
  entityKind: MoveDragItem["entityKind"],
  entityId: string,
) {
  switch (entityKind) {
    case "node":
      return project.nodes.find((item) => item.id === entityId)?.position ?? null;
    case "door": {
      const door = project.doors.find((item) => item.id === entityId);
      if (!door) {
        return null;
      }

      const wall = project.walls.find((item) => item.id === door.wallId);
      const startNode = wall
        ? project.nodes.find((node) => node.id === wall.startNodeId)
        : null;
      const endNode = wall
        ? project.nodes.find((node) => node.id === wall.endNodeId)
        : null;
      const segment = startNode && endNode ? getDoorSegmentWorldPoints(door, startNode, endNode) : null;
      return segment
        ? createVec2((segment.start.x + segment.end.x) / 2, (segment.start.y + segment.end.y) / 2)
        : null;
    }
    case "window": {
      const windowOpening = project.windows.find((item) => item.id === entityId);
      if (!windowOpening) {
        return null;
      }

      const wall = project.walls.find((item) => item.id === windowOpening.wallId);
      const startNode = wall
        ? project.nodes.find((node) => node.id === wall.startNodeId)
        : null;
      const endNode = wall
        ? project.nodes.find((node) => node.id === wall.endNodeId)
        : null;
      const segment =
        startNode && endNode
          ? getWindowSegmentWorldPoints(windowOpening, startNode, endNode)
          : null;
      return segment
        ? createVec2((segment.start.x + segment.end.x) / 2, (segment.start.y + segment.end.y) / 2)
        : null;
    }
    case "shape":
      return project.shapes.find((item) => item.id === entityId)?.pose.position ?? null;
    case "slab":
      return project.slabs.find((item) => item.id === entityId)?.pose.position ?? null;
    case "roofEdge": {
      const sketch = project.roofSketches.find((candidate) =>
        candidate.edges.some((edge) => edge.id === entityId),
      );
      const edge = sketch?.edges.find((candidate) => candidate.id === entityId);
      const startVertex =
        sketch && edge
          ? sketch.vertices.find((vertex) => vertex.id === edge.startVertexId)
          : null;
      const endVertex =
        sketch && edge
          ? sketch.vertices.find((vertex) => vertex.id === edge.endVertexId)
          : null;
      return startVertex && endVertex
        ? createVec2(
            (startVertex.position.x + endVertex.position.x) / 2,
            (startVertex.position.y + endVertex.position.y) / 2,
        )
        : null;
    }
    case "roofOpening":
      return project.roofOpenings.find((item) => item.id === entityId)?.center ?? null;
    case "externalModel":
      return project.externalModels.find((item) => item.id === entityId)?.position ?? null;
  }
}

function getPlacementBounds(startWorld: Vec2, currentWorld: Vec2) {
  const minX = Math.min(startWorld.x, currentWorld.x);
  const maxX = Math.max(startWorld.x, currentWorld.x);
  const minY = Math.min(startWorld.y, currentWorld.y);
  const maxY = Math.max(startWorld.y, currentWorld.y);

  return {
    minX,
    maxX,
    minY,
    maxY,
    widthM: maxX - minX,
    depthM: maxY - minY,
    centerWorld: createVec2((minX + maxX) / 2, (minY + maxY) / 2),
  };
}

function isPointInsideBounds(point: Vec2, bounds: ReturnType<typeof getPlacementBounds>) {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

function getSquarePlacementBounds(startWorld: Vec2, currentWorld: Vec2) {
  const deltaX = currentWorld.x - startWorld.x;
  const deltaY = currentWorld.y - startWorld.y;
  const sizeM = Math.max(Math.abs(deltaX), Math.abs(deltaY));
  const signedEnd = createVec2(
    startWorld.x + (deltaX >= 0 ? sizeM : -sizeM),
    startWorld.y + (deltaY >= 0 ? sizeM : -sizeM),
  );

  return getPlacementBounds(startWorld, signedEnd);
}

function getCirclePlacement(centerWorld: Vec2, currentWorld: Vec2) {
  const deltaX = currentWorld.x - centerWorld.x;
  const deltaY = currentWorld.y - centerWorld.y;
  const radiusM = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

  return {
    centerWorld,
    radiusM,
    diameterM: radiusM * 2,
  };
}

function formatDistance(value: number) {
  return `${value.toFixed(2)} m`;
}

function formatMeasurementDistance(valueM: number, unit: MeasurementUnit) {
  if (unit === "cm") {
    return `${(valueM * 100).toFixed(0)} cm`;
  }

  if (unit === "dm") {
    return `${(valueM * 10).toFixed(1)} dm`;
  }

  return `${valueM.toFixed(2)} m`;
}

interface StairPlanSegment {
  start: Vec2;
  end: Vec2;
  lengthM: number;
  directionX: number;
  directionY: number;
  normalX: number;
  normalY: number;
  trimmedStartM: number;
  trimmedEndM: number;
}

function trimSegmentLengthForLanding(lengthM: number, landingHalfM: number) {
  return Math.min(landingHalfM, Math.max(0, lengthM / 2 - 0.05));
}

function buildStairPlanSegments(stair: Stair) {
  const landingHalfM = stair.pathNodes.length > 2 ? stair.landingLengthM / 2 : 0;

  return stair.pathNodes
    .slice(0, -1)
    .map((start, index) => {
      const end = stair.pathNodes[index + 1];
      const deltaX = end.x - start.x;
      const deltaY = end.y - start.y;
      const lengthM = Math.hypot(deltaX, deltaY);
      if (lengthM < 0.0001) {
        return null;
      }

      const trimmedStartM =
        index > 0 ? trimSegmentLengthForLanding(lengthM, landingHalfM) : 0;
      const trimmedEndM =
        index < stair.pathNodes.length - 2
          ? trimSegmentLengthForLanding(lengthM, landingHalfM)
          : 0;

      return {
        start,
        end,
        lengthM,
        directionX: deltaX / lengthM,
        directionY: deltaY / lengthM,
        normalX: -deltaY / lengthM,
        normalY: deltaX / lengthM,
        trimmedStartM,
        trimmedEndM,
      } satisfies StairPlanSegment;
    })
    .filter((segment): segment is StairPlanSegment => segment !== null);
}

function pointOnStairSegment(segment: StairPlanSegment, offsetM: number) {
  return createVec2(
    segment.start.x + segment.directionX * offsetM,
    segment.start.y + segment.directionY * offsetM,
  );
}

function getStairArrowWorldPoints(stair: Stair, segments: StairPlanSegment[]) {
  if (segments.length === 0) {
    return null;
  }

  const lastSegment = segments[segments.length - 1];
  const arrowHeadOffsetM = Math.max(
    lastSegment.trimmedStartM + 0.2,
    lastSegment.lengthM - lastSegment.trimmedEndM - 0.18,
  );
  const arrowTailOffsetM = Math.max(
    lastSegment.trimmedStartM + 0.05,
    arrowHeadOffsetM - Math.max(0.9, stair.widthM * 0.9),
  );

  if (arrowHeadOffsetM - arrowTailOffsetM < 0.1) {
    return null;
  }

  return {
    tail: pointOnStairSegment(lastSegment, arrowTailOffsetM),
    head: pointOnStairSegment(lastSegment, arrowHeadOffsetM),
    directionX: lastSegment.directionX,
    directionY: lastSegment.directionY,
    normalX: lastSegment.normalX,
    normalY: lastSegment.normalY,
  };
}

type RenderedSlabOutline =
  | {
      kind: "circle";
      center: Vec2;
      radius: number;
    }
  | {
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
    };

function renderSlabOutline(slab: Slab, metrics: Parameters<typeof worldToScreen>[1]) {
  const center = worldToScreen(slab.pose.position, metrics);
  const scale = projectScale(metrics);

  if (slab.kind === "Circle") {
    return {
      kind: "circle" as const,
      center,
      radius: (Math.max(slab.widthM, slab.depthM) / 2) * scale,
    } satisfies RenderedSlabOutline;
  }

  return {
    kind: "rect" as const,
    x: center.x - (slab.widthM * scale) / 2,
    y: center.y - (slab.depthM * scale) / 2,
    width: slab.widthM * scale,
    height: slab.depthM * scale,
  } satisfies RenderedSlabOutline;
}

export function ViewportScene({
  project,
  activeTool,
  wallAuthoringMode,
  activeLevelId,
  slabMode,
  pendingWallStartNodeId,
  currentSelection,
  selectionSet,
  stairToolWidthM,
  viewport,
  onPanChange,
  onZoomChange,
  onCursorWorldChange,
  onSelectionChange,
  onSelectionSetChange,
  onPendingWallStartNodeChange,
  onCreateNodeAt,
  onInsertNodeIntoWall,
  onCreateDoorOnWall,
  onCreateWindowOnWall,
  onCreateMeasurement,
  onCreateStair,
  onCreateShapeAt,
  onCreateSlabAt,
  onCreateRoofLine,
  onCreateRoofOpening,
  onCreateExternalModelAt,
  onCreateWallBetweenNodes,
  onCreateWallByDrag,
  onDeleteNode,
  onDeleteWall,
  onDeleteDoor,
  onDeleteWindow,
  onDeleteRoofOpening,
  onDeleteMeasurement,
  onDeleteStair,
  onDeleteWallsConnectedToNode,
  onDeleteShape,
  onDeleteSlab,
  onDeleteExternalModel,
  onMoveInteractionStart,
  onMoveInteractionCommit,
  onMoveInteractionCancel,
  onMoveNode,
  onMoveDoor,
  onMoveWindow,
  onMoveShape,
  onMoveSlab,
  onResizeSlab,
  onMoveRoofEdge,
  onMoveRoofVertex,
  onMoveRoofOpening,
  onMoveExternalModel,
  measureToolUnit,
  measureToolPermanent,
}: ViewportSceneProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [placementDraft, setPlacementDraft] = useState<PlacementDraftState | null>(null);
  const [stairDraftPoints, setStairDraftPoints] = useState<Vec2[]>([]);

  useEffect(() => {
    if (activeTool !== "Stair") {
      setStairDraftPoints([]);
    }
  }, [activeTool]);

  useEffect(() => {
    setStairDraftPoints([]);
  }, [activeLevelId]);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) {
      return;
    }
    const rootElement = element;

    function handleNativePlacementToolPointerDown(event: PointerEvent) {
      if (
        (!activeLevelId &&
          activeTool !== "Roof" &&
          activeTool !== "RoofOpening" &&
          activeTool !== "RoofWindow") ||
        (activeTool !== "Node" &&
          activeTool !== "Wall" &&
          activeTool !== "Measure" &&
          activeTool !== "Door" &&
          activeTool !== "Window" &&
          activeTool !== "Stair" &&
          activeTool !== "Shape" &&
          activeTool !== "Slab" &&
          activeTool !== "Roof" &&
          activeTool !== "RoofOpening" &&
          activeTool !== "RoofWindow" &&
          activeTool !== "Model")
      ) {
        return;
      }

      const target = event.target;
      const nodeElement =
        target instanceof Element ? target.closest<SVGElement>("[data-node-id]") : null;
      const wallElement =
        target instanceof Element ? target.closest<SVGElement>("[data-wall-id]") : null;
      const doorElement =
        target instanceof Element ? target.closest<SVGElement>("[data-door-id]") : null;
      const windowElement =
        target instanceof Element ? target.closest<SVGElement>("[data-window-id]") : null;
      const measurementElement =
        target instanceof Element ? target.closest<SVGElement>("[data-measure-id]") : null;
      const stairElement =
        target instanceof Element ? target.closest<SVGElement>("[data-stair-id]") : null;
      const shapeElement =
        target instanceof Element ? target.closest<SVGElement>("[data-shape-id]") : null;
      const slabElement =
        target instanceof Element ? target.closest<SVGElement>("[data-slab-id]") : null;
      const roofEdgeElement =
        target instanceof Element ? target.closest<SVGElement>("[data-roof-edge-id]") : null;
      const roofFaceElement =
        target instanceof Element ? target.closest<SVGElement>("[data-roof-face-id]") : null;
      const roofOpeningElement =
        target instanceof Element ? target.closest<SVGElement>("[data-roof-opening-id]") : null;
      const modelElement =
        target instanceof Element ? target.closest<SVGElement>("[data-model-id]") : null;

      if (event.button === 2) {
        if (activeTool === "Node" && nodeElement) {
          const nodeId = nodeElement.getAttribute("data-node-id");
          if (!nodeId) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = true;
          onDeleteNode(nodeId);
          return;
        }

        if (activeTool === "Shape" && shapeElement) {
          const shapeId = shapeElement.getAttribute("data-shape-id");
          if (!shapeId) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = true;
          onDeleteShape(shapeId);
          return;
        }

        if (activeTool === "Door" && doorElement) {
          const doorId = doorElement.getAttribute("data-door-id");
          if (!doorId) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = true;
          onDeleteDoor(doorId);
          return;
        }

        if (activeTool === "Window" && windowElement) {
          const windowId = windowElement.getAttribute("data-window-id");
          if (!windowId) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = true;
          onDeleteWindow(windowId);
          return;
        }

        if (activeTool === "RoofOpening" && roofOpeningElement) {
          const roofOpeningId = roofOpeningElement.getAttribute("data-roof-opening-id");
          if (!roofOpeningId) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = true;
          onDeleteRoofOpening(roofOpeningId);
          return;
        }

        if (activeTool === "Measure" && measurementElement) {
          const measurementId = measurementElement.getAttribute("data-measure-id");
          if (!measurementId) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = true;
          onDeleteMeasurement(measurementId);
          return;
        }

        if (activeTool === "Stair") {
          if (stairElement) {
            const stairId = stairElement.getAttribute("data-stair-id");
            if (!stairId) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            suppressClickRef.current = true;
            onDeleteStair(stairId);
            setStairDraftPoints([]);
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = true;
          if (stairDraftPoints.length >= 2) {
            onCreateStair(stairDraftPoints);
          }
          setStairDraftPoints([]);
          return;
        }

        if ((activeTool === "Slab" || activeTool === "Roof") && slabElement) {
          const slabId = slabElement.getAttribute("data-slab-id");
          if (!slabId) {
            return;
          }

          const slab = project.slabs.find((item) => item.id === slabId);
          if (!slab) {
            return;
          }

          const matchesTool =
            activeTool === "Roof" ? slab.roofType !== "Flat" : slab.roofType === "Flat";
          if (!matchesTool) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = true;
          onDeleteSlab(slabId);
          return;
        }

        if (activeTool === "Model" && modelElement) {
          const modelId = modelElement.getAttribute("data-model-id");
          if (!modelId) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = true;
          onDeleteExternalModel(modelId);
        }

        return;
      }

      const rect = rootElement.getBoundingClientRect();
      const pointerWorld = screenToWorld(
        createVec2(event.clientX - rect.left, event.clientY - rect.top),
        {
          widthPx: size.width,
          heightPx: size.height,
          pixelsPerMeter: project.settings.pixelsPerMeter,
          zoom: viewport.zoom,
          pan: viewport.pan,
        },
      );

      const nextPosition = project.settings.snapToGrid
        ? snapPointToGrid(pointerWorld, project.settings.gridSpacingM)
        : pointerWorld;

      if (activeTool === "Node") {
        if (event.button !== 0) {
          return;
        }

        if (isViewportEntityTarget(target) && !nodeElement && !wallElement) {
          return;
        }

        const wallId = wallElement?.getAttribute("data-wall-id") ?? null;
        const wall =
          wallId !== null ? project.walls.find((candidate) => candidate.id === wallId) ?? null : null;
        const splitStartWorld =
          wall !== null
            ? (() => {
                const startNode = project.nodes.find((node) => node.id === wall.startNodeId);
                const endNode = project.nodes.find((node) => node.id === wall.endNodeId);
                if (!startNode || !endNode) {
                  return nextPosition;
                }

                return projectPointOntoSegment(nextPosition, startNode.position, endNode.position);
              })()
            : null;

        const startWorld = nodeElement
          ? project.nodes.find((node) => node.id === nodeElement.getAttribute("data-node-id"))
              ?.position ?? nextPosition
          : splitStartWorld ?? nextPosition;

        event.preventDefault();
        suppressClickRef.current = true;
        rootElement.setPointerCapture(event.pointerId);
        setPlacementDraft({
          kind: "node",
          pointerId: event.pointerId,
          startWorld,
          currentWorld: startWorld,
          startedFromExistingNode: nodeElement !== null,
          splitWallId: wallId,
        });
        return;
      }

      if (activeTool === "Measure") {
        if (event.button !== 0) {
          return;
        }

        event.preventDefault();
        suppressClickRef.current = true;
        rootElement.setPointerCapture(event.pointerId);
        setPlacementDraft({
          kind: "measure",
          pointerId: event.pointerId,
          startWorld: nextPosition,
          currentWorld: nextPosition,
        });
        return;
      }

      if (activeTool === "Wall") {
        if (wallAuthoringMode !== "AutoWall") {
          return;
        }

        if (event.button !== 0) {
          return;
        }

        if (isViewportEntityTarget(target) && !nodeElement && !wallElement) {
          return;
        }

        const wallId = wallElement?.getAttribute("data-wall-id") ?? null;
        const wall =
          wallId !== null ? project.walls.find((candidate) => candidate.id === wallId) ?? null : null;
        const projectedStartWorld =
          wall !== null
            ? (() => {
                const startNode = project.nodes.find((node) => node.id === wall.startNodeId);
                const endNode = project.nodes.find((node) => node.id === wall.endNodeId);
                if (!startNode || !endNode) {
                  return nextPosition;
                }

                return projectPointOntoSegment(nextPosition, startNode.position, endNode.position);
              })()
            : null;
        const startNodeId = nodeElement?.getAttribute("data-node-id") ?? null;
        const startWorld = startNodeId
          ? project.nodes.find((node) => node.id === startNodeId)?.position ?? nextPosition
          : projectedStartWorld ?? nextPosition;

        rootElement.setPointerCapture(event.pointerId);
        setPlacementDraft({
          kind: "wall",
          pointerId: event.pointerId,
          startWorld,
          currentWorld: startWorld,
          startNodeId,
          startWallId: wallId,
          hasDragged: false,
        });
        suppressClickRef.current = false;
        return;
      }

      if (activeTool === "Door") {
        if (event.button !== 0 || !wallElement) {
          return;
        }

        const wallId = wallElement.getAttribute("data-wall-id");
        if (!wallId) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        suppressClickRef.current = true;
        onCreateDoorOnWall(wallId, nextPosition);
        return;
      }

      if (activeTool === "Window") {
        if (event.button !== 0 || !wallElement) {
          return;
        }

        const wallId = wallElement.getAttribute("data-wall-id");
        if (!wallId) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        suppressClickRef.current = true;
        onCreateWindowOnWall(wallId, nextPosition);
        return;
      }

      if (activeTool === "Stair") {
        if (event.button !== 0 || stairElement) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        suppressClickRef.current = true;
        setStairDraftPoints((current) => {
          const next = [...current, nextPosition];
          if (
            next.length >= 2 &&
            hasSamePosition(next[next.length - 2], next[next.length - 1])
          ) {
            return current;
          }

          return next;
        });
        return;
      }

      if (activeTool === "Roof" && event.button === 0 && !isViewportEntityTarget(target)) {
        event.preventDefault();
        suppressClickRef.current = true;
        rootElement.setPointerCapture(event.pointerId);
        setPlacementDraft({
          kind: "roofLine",
          pointerId: event.pointerId,
          startWorld: nextPosition,
          currentWorld: nextPosition,
        });
        return;
      }

      if (activeTool === "Roof" && event.button === 0 && (roofEdgeElement || roofFaceElement)) {
        return;
      }

      if (activeTool === "RoofOpening" && event.button === 0 && roofFaceElement) {
        return;
      }

      if (event.button !== 0 || (isViewportEntityTarget(target) && !roofEdgeElement && !roofFaceElement)) {
        return;
      }

      event.preventDefault();
      suppressClickRef.current = true;
      if (activeTool === "Shape") {
        rootElement.setPointerCapture(event.pointerId);
        setPlacementDraft({
          kind: "shape",
          pointerId: event.pointerId,
          startWorld: nextPosition,
          currentWorld: nextPosition,
        });
        return;
      }

      if (activeTool === "Slab") {
        rootElement.setPointerCapture(event.pointerId);
        setPlacementDraft({
          kind: "slab",
          pointerId: event.pointerId,
          startWorld: nextPosition,
          currentWorld: nextPosition,
        });
        return;
      }

      if (activeTool === "Model") {
        onCreateExternalModelAt(nextPosition);
      }
    }

    rootElement.addEventListener("pointerdown", handleNativePlacementToolPointerDown, true);

    return () => {
      rootElement.removeEventListener("pointerdown", handleNativePlacementToolPointerDown, true);
    };
  }, [
    activeLevelId,
    activeTool,
    onCreateDoorOnWall,
    onCreateWindowOnWall,
    onCreateMeasurement,
    onCreateStair,
    onCreateExternalModelAt,
    onCreateNodeAt,
    onCreateShapeAt,
    onCreateSlabAt,
    onCreateRoofLine,
    onCreateRoofOpening,
    onDeleteDoor,
    onDeleteWindow,
    onDeleteRoofOpening,
    onDeleteMeasurement,
    onDeleteStair,
    onDeleteExternalModel,
    onDeleteNode,
    onDeleteShape,
    onDeleteSlab,
    project,
    wallAuthoringMode,
    project.settings.gridSpacingM,
    project.settings.pixelsPerMeter,
    project.settings.snapToGrid,
    size.height,
    size.width,
    viewport.pan,
    viewport.zoom,
    stairDraftPoints,
  ]);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) {
      return;
    }
    const rootElement = element;

    function handleNativeWheel(event: WheelEvent) {
      event.preventDefault();

      const rect = rootElement.getBoundingClientRect();
      const nextZoom = Math.max(0.1, viewport.zoom + (event.deltaY > 0 ? -0.12 : 0.12));
      const cursor = createVec2(event.clientX - rect.left, event.clientY - rect.top);
      const nextPan = getZoomAroundPoint(nextZoom, cursor, {
        widthPx: size.width,
        heightPx: size.height,
        pixelsPerMeter: project.settings.pixelsPerMeter,
        zoom: viewport.zoom,
        pan: viewport.pan,
      });

      onPanChange(nextPan);
      onZoomChange(nextZoom);
    }

    rootElement.addEventListener("wheel", handleNativeWheel, { passive: false });

    return () => {
      rootElement.removeEventListener("wheel", handleNativeWheel);
    };
  }, [
    onPanChange,
    onZoomChange,
    project.settings.pixelsPerMeter,
    size.height,
    size.width,
    viewport.pan,
    viewport.zoom,
  ]);

  const metrics = {
    widthPx: size.width,
    heightPx: size.height,
    pixelsPerMeter: project.settings.pixelsPerMeter,
    zoom: viewport.zoom,
    pan: viewport.pan,
  };

  const bounds =
    size.width > 0 && size.height > 0 ? getViewportBounds(metrics) : null;
  const gridLines =
    bounds !== null ? getGridLines(bounds, project.settings.gridSpacingM) : null;
  const snappedCursor =
    viewport.cursorWorld !== null
      ? (project.settings.snapToGrid
          ? snapPointToGrid(viewport.cursorWorld, project.settings.gridSpacingM)
          : viewport.cursorWorld)
      : null;
  const pendingWallStartNode =
    pendingWallStartNodeId !== null
      ? project.nodes.find((node) => node.id === pendingWallStartNodeId) ?? null
      : null;
  const placementDraftBounds =
    placementDraft !== null
      ? placementDraft.kind === "shape"
        ? getSquarePlacementBounds(placementDraft.startWorld, placementDraft.currentWorld)
        : placementDraft.kind === "slab" && slabMode === "Circle"
          ? null
        : placementDraft.kind === "slab"
            ? getPlacementBounds(placementDraft.startWorld, placementDraft.currentWorld)
            : null
      : null;
  const placementDraftCircle =
    placementDraft !== null &&
    placementDraft.kind === "slab" &&
    activeTool !== "Roof" &&
    slabMode === "Circle"
      ? getCirclePlacement(placementDraft.startWorld, placementDraft.currentWorld)
      : null;
  const nodePlacementDraft = placementDraft?.kind === "node" ? placementDraft : null;
  const wallPlacementDraft = placementDraft?.kind === "wall" ? placementDraft : null;
  const measurePlacementDraft = placementDraft?.kind === "measure" ? placementDraft : null;
  const roofLinePlacementDraft = placementDraft?.kind === "roofLine" ? placementDraft : null;
  const stairToolWidthPx = Math.max(stairToolWidthM, 0.3) * projectScale(metrics);

  function consumeSuppressedClick() {
    if (!suppressClickRef.current) {
      return false;
    }

    suppressClickRef.current = false;
    return true;
  }

  function getWorldFromClient(clientX: number, clientY: number) {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) {
      return null;
    }

    return screenToWorld(
      createVec2(clientX - rect.left, clientY - rect.top),
      metrics,
    );
  }

  function updateCursor(clientX: number, clientY: number) {
    const world = getWorldFromClient(clientX, clientY);
    if (!world) {
      return;
    }

    onCursorWorldChange({
      x: Number(world.x.toFixed(2)),
      y: Number(world.y.toFixed(2)),
    });

    return world;
  }

  function getNormalizedPointerWorld(pointerWorld: Vec2) {
    return project.settings.snapToGrid
      ? snapPointToGrid(pointerWorld, project.settings.gridSpacingM)
      : pointerWorld;
  }

  function getPlacementTargetAtClient(clientX: number, clientY: number) {
    const target = document.elementFromPoint(clientX, clientY);
    const nodeElement =
      target instanceof Element ? target.closest<SVGElement>("[data-node-id]") : null;
    const wallElement =
      target instanceof Element ? target.closest<SVGElement>("[data-wall-id]") : null;

    return {
      nodeId: nodeElement?.getAttribute("data-node-id") ?? null,
      wallId: wallElement?.getAttribute("data-wall-id") ?? null,
    };
  }

  function getProjectedWallPoint(wallId: string, point: Vec2) {
    const wall = project.walls.find((candidate) => candidate.id === wallId);
    if (!wall) {
      return point;
    }

    const startNode = project.nodes.find((node) => node.id === wall.startNodeId);
    const endNode = project.nodes.find((node) => node.id === wall.endNodeId);
    if (!startNode || !endNode) {
      return point;
    }

    return projectPointOntoSegment(point, startNode.position, endNode.position);
  }

  function getMoveSelectionItems(
    anchorEntityKind: MoveDragState["anchorEntityKind"],
    anchorEntityId: string,
    anchorEntityPosition: Vec2,
  ): MoveDragItem[] {
    const anchorIsInSelectionSet = isIncludedInSelectionSet(
      selectionSet,
      anchorEntityKind,
      anchorEntityId,
    );

    if (!anchorIsInSelectionSet || selectionSet.length === 0) {
      return [
        {
          entityKind: anchorEntityKind,
          entityId: anchorEntityId,
          startPosition: anchorEntityPosition,
        },
      ];
    }

    return selectionSet.flatMap<MoveDragItem>((selection) => {
      switch (selection.kind) {
        case "node": {
          const node = project.nodes.find((item) => item.id === selection.id);
          return node
            ? [{ entityKind: "node" as const, entityId: node.id, startPosition: node.position }]
            : [];
        }
        case "door": {
          const position = getCurrentEntityPosition(project, "door", selection.id);
          return position
            ? [{ entityKind: "door" as const, entityId: selection.id, startPosition: position }]
            : [];
        }
        case "window": {
          const position = getCurrentEntityPosition(project, "window", selection.id);
          return position
            ? [{ entityKind: "window" as const, entityId: selection.id, startPosition: position }]
            : [];
        }
        case "measure":
          return [];
        case "roofEdge": {
          const position = getCurrentEntityPosition(project, "roofEdge", selection.id);
          return position
            ? [{ entityKind: "roofEdge" as const, entityId: selection.id, startPosition: position }]
            : [];
        }
        case "roofOpening": {
          const position = getCurrentEntityPosition(project, "roofOpening", selection.id);
          return position
            ? [
                {
                  entityKind: "roofOpening" as const,
                  entityId: selection.id,
                  startPosition: position,
                },
              ]
            : [];
        }
        case "roofFace":
          return [];
        case "stair":
          return [];
        case "shape": {
          const shape = project.shapes.find((item) => item.id === selection.id);
          return shape
            ? [
                {
                  entityKind: "shape" as const,
                  entityId: shape.id,
                  startPosition: shape.pose.position,
                },
              ]
            : [];
        }
        case "slab": {
          const slab = project.slabs.find((item) => item.id === selection.id);
          return slab
            ? [
                {
                  entityKind: "slab" as const,
                  entityId: slab.id,
                  startPosition: slab.pose.position,
                },
              ]
            : [];
        }
        case "externalModel": {
          const model = project.externalModels.find((item) => item.id === selection.id);
          return model
            ? [
                {
                  entityKind: "externalModel" as const,
                  entityId: model.id,
                  startPosition: model.position,
                },
              ]
            : [];
        }
        case "wall":
          return [];
      }
    });
  }

  function startMoveDrag(
    event: React.PointerEvent<SVGElement>,
    entityKind: MoveDragState["anchorEntityKind"],
    entityId: string,
    entityPosition: Vec2,
    interactive: boolean,
  ) {
    if (activeTool !== "Move" || event.button !== 0 || !interactive) {
      return;
    }

    const pointerWorld = updateCursor(event.clientX, event.clientY);
    if (!pointerWorld) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    rootRef.current?.setPointerCapture(event.pointerId);
    const moveItems = getMoveSelectionItems(entityKind, entityId, entityPosition);
    if (!isIncludedInSelectionSet(selectionSet, entityKind, entityId)) {
      onSelectionChange({ kind: entityKind, id: entityId });
    }
    onMoveInteractionStart();
    setDragState({
      kind: "move",
      pointerId: event.pointerId,
      anchorEntityKind: entityKind,
      anchorEntityId: entityId,
      anchorStartPosition: entityPosition,
      startPointerWorld: pointerWorld,
      items: moveItems,
    });
  }

  function startRoofVertexDrag(
    event: React.PointerEvent<SVGElement>,
    roofSketchId: string,
    roofEdgeId: string,
    roofVertexId: string,
    vertexPosition: Vec2,
  ) {
    if (activeTool !== "Move" || event.button !== 0) {
      return;
    }

    const pointerWorld = updateCursor(event.clientX, event.clientY);
    if (!pointerWorld) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    rootRef.current?.setPointerCapture(event.pointerId);
    if (!isIncludedInSelectionSet(selectionSet, "roofEdge", roofEdgeId)) {
      onSelectionSetChange([{ kind: "roofEdge", id: roofEdgeId }], { kind: "roofEdge", id: roofEdgeId });
    }
    onMoveInteractionStart();
    setDragState({
      kind: "roofVertex",
      pointerId: event.pointerId,
      roofSketchId,
      roofEdgeId,
      roofVertexId,
      startPosition: vertexPosition,
      startPointerWorld: pointerWorld,
    });
  }

  function startSlabResizeDrag(
    event: React.PointerEvent<SVGElement>,
    slab: Slab,
    movingCornerSignX: -1 | 1,
    movingCornerSignY: -1 | 1,
    interactive: boolean,
  ) {
    if (activeTool !== "Move" || event.button !== 0 || !interactive || slab.kind !== "Rectangle") {
      return;
    }

    const pointerWorld = updateCursor(event.clientX, event.clientY);
    if (!pointerWorld) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    rootRef.current?.setPointerCapture(event.pointerId);
    if (!isIncludedInSelectionSet(selectionSet, "slab", slab.id)) {
      onSelectionSetChange([{ kind: "slab", id: slab.id }], { kind: "slab", id: slab.id });
    }
    onMoveInteractionStart();
    setDragState({
      kind: "slabResize",
      pointerId: event.pointerId,
      slabId: slab.id,
      fixedCorner: createVec2(
        slab.pose.position.x - movingCornerSignX * slab.widthM / 2,
        slab.pose.position.y - movingCornerSignY * slab.depthM / 2,
      ),
      movingCornerSignX,
      movingCornerSignY,
      startWidthM: slab.widthM,
      startDepthM: slab.depthM,
    });
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (activeTool === "Move" && event.button === 2) {
      const pointerWorld = updateCursor(event.clientX, event.clientY);
      if (!pointerWorld) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragState({
        kind: "select",
        pointerId: event.pointerId,
        startWorld: getNormalizedPointerWorld(pointerWorld),
        currentWorld: getNormalizedPointerWorld(pointerWorld),
      });
      return;
    }

    if (event.button !== 1) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({
      kind: "pan",
      pointerId: event.pointerId,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
    });
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const pointerWorld = updateCursor(event.clientX, event.clientY);

    if (!dragState || dragState.pointerId !== event.pointerId) {
      if (placementDraft?.pointerId === event.pointerId && pointerWorld) {
        const normalizedWorld = getNormalizedPointerWorld(pointerWorld);
        const didDrag =
          placementDraft.kind === "wall"
            ? Math.hypot(
                normalizedWorld.x - placementDraft.startWorld.x,
                normalizedWorld.y - placementDraft.startWorld.y,
              ) >= (project.settings.snapToGrid ? project.settings.gridSpacingM * 0.25 : 0.15)
            : true;
        if (didDrag) {
          suppressClickRef.current = true;
        }
        setPlacementDraft((current) =>
          current && current.pointerId === event.pointerId
            ? {
                ...current,
                currentWorld: normalizedWorld,
                ...(current.kind === "wall" ? { hasDragged: current.hasDragged || didDrag } : {}),
              }
            : current,
        );
      }
      return;
    }

    if (dragState.kind === "pan") {
      const deltaX = event.clientX - dragState.lastClientX;
      const deltaY = event.clientY - dragState.lastClientY;
      const scale = projectScale(metrics);

      if (deltaX !== 0 || deltaY !== 0) {
        suppressClickRef.current = true;
      }

      onPanChange(
        createVec2(
          viewport.pan.x + deltaX / scale,
          viewport.pan.y - deltaY / scale,
        ),
      );

      setDragState({
        kind: "pan",
        pointerId: event.pointerId,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
      });
      return;
    }

    if (dragState.kind === "select") {
      if (!pointerWorld) {
        return;
      }

      suppressClickRef.current = true;
      setDragState({
        ...dragState,
        currentWorld: getNormalizedPointerWorld(pointerWorld),
      });
      return;
    }

    if (!pointerWorld) {
      return;
    }

    if (dragState.kind === "roofVertex") {
      const rawTarget = createVec2(
        dragState.startPosition.x + pointerWorld.x - dragState.startPointerWorld.x,
        dragState.startPosition.y + pointerWorld.y - dragState.startPointerWorld.y,
      );
      const nextPosition = project.settings.snapToGrid
        ? snapPointToGrid(rawTarget, project.settings.gridSpacingM)
        : rawTarget;

      if (!hasSamePosition(dragState.startPosition, nextPosition)) {
        suppressClickRef.current = true;
        onMoveRoofVertex(dragState.roofSketchId, dragState.roofVertexId, nextPosition);
      }
      return;
    }

    if (dragState.kind === "slabResize") {
      const target = project.settings.snapToGrid
        ? snapPointToGrid(pointerWorld, project.settings.gridSpacingM)
        : pointerWorld;
      const rawDeltaX = target.x - dragState.fixedCorner.x;
      const rawDeltaY = target.y - dragState.fixedCorner.y;
      const signX =
        rawDeltaX === 0 ? dragState.movingCornerSignX : rawDeltaX > 0 ? 1 : -1;
      const signY =
        rawDeltaY === 0 ? dragState.movingCornerSignY : rawDeltaY > 0 ? 1 : -1;
      const minimumSizeM = project.settings.snapToGrid
        ? Math.max(project.settings.gridSpacingM, 0.01)
        : 0.05;
      const nextWidthM = Math.max(Math.abs(rawDeltaX), minimumSizeM);
      const nextDepthM = Math.max(Math.abs(rawDeltaY), minimumSizeM);
      const nextPosition = createVec2(
        dragState.fixedCorner.x + signX * nextWidthM / 2,
        dragState.fixedCorner.y + signY * nextDepthM / 2,
      );
      const currentSlab = project.slabs.find((slab) => slab.id === dragState.slabId);
      if (
        currentSlab &&
        (!hasSamePosition(currentSlab.pose.position, nextPosition) ||
          Math.abs(currentSlab.widthM - nextWidthM) > 0.0001 ||
          Math.abs(currentSlab.depthM - nextDepthM) > 0.0001)
      ) {
        suppressClickRef.current = true;
        onResizeSlab(dragState.slabId, {
          position: nextPosition,
          widthM: nextWidthM,
          depthM: nextDepthM,
        });
      }
      return;
    }

    const rawDelta = createVec2(
      pointerWorld.x - dragState.startPointerWorld.x,
      pointerWorld.y - dragState.startPointerWorld.y,
    );
    const anchorRawTarget = createVec2(
      dragState.anchorStartPosition.x + rawDelta.x,
      dragState.anchorStartPosition.y + rawDelta.y,
    );
    const anchorTarget = project.settings.snapToGrid
      ? snapPointToGrid(anchorRawTarget, project.settings.gridSpacingM)
      : anchorRawTarget;
    const appliedDelta = createVec2(
      anchorTarget.x - dragState.anchorStartPosition.x,
      anchorTarget.y - dragState.anchorStartPosition.y,
    );

    let movedAny = false;
    for (const item of dragState.items) {
      const nextPosition = createVec2(
        item.startPosition.x + appliedDelta.x,
        item.startPosition.y + appliedDelta.y,
      );
      const currentPosition = getCurrentEntityPosition(project, item.entityKind, item.entityId);

      if (currentPosition && hasSamePosition(currentPosition, nextPosition)) {
        continue;
      }

      switch (item.entityKind) {
        case "node":
          onMoveNode(item.entityId, nextPosition);
          movedAny = true;
          break;
        case "door":
          onMoveDoor(item.entityId, nextPosition);
          movedAny = true;
          break;
        case "window":
          onMoveWindow(item.entityId, nextPosition);
          movedAny = true;
          break;
        case "shape":
          onMoveShape(item.entityId, nextPosition);
          movedAny = true;
          break;
        case "slab":
          onMoveSlab(item.entityId, nextPosition);
          movedAny = true;
          break;
        case "roofEdge":
          onMoveRoofEdge(item.entityId, nextPosition);
          movedAny = true;
          break;
        case "roofOpening":
          onMoveRoofOpening(item.entityId, nextPosition);
          movedAny = true;
          break;
        case "externalModel":
          onMoveExternalModel(item.entityId, nextPosition);
          movedAny = true;
          break;
      }
    }

    if (movedAny) {
      suppressClickRef.current = true;
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (placementDraft?.pointerId === event.pointerId) {
      if (rootRef.current?.hasPointerCapture(event.pointerId)) {
        rootRef.current.releasePointerCapture(event.pointerId);
      }

      if (placementDraft.kind === "node") {
        const releaseTarget = getPlacementTargetAtClient(event.clientX, event.clientY);

        if (releaseTarget.wallId) {
          onInsertNodeIntoWall(
            releaseTarget.wallId,
            getProjectedWallPoint(releaseTarget.wallId, placementDraft.currentWorld),
          );
          setPlacementDraft(null);
          return;
        }

        if (releaseTarget.nodeId) {
          setPlacementDraft(null);
          return;
        }

        if (
          !placementDraft.startedFromExistingNode ||
          !hasSamePosition(placementDraft.startWorld, placementDraft.currentWorld)
        ) {
          onCreateNodeAt(placementDraft.currentWorld);
        }

        setPlacementDraft(null);
        return;
      }

      if (placementDraft.kind === "wall") {
        if (!placementDraft.hasDragged) {
          suppressClickRef.current = true;
          setPlacementDraft(null);
          return;
        }

        const releaseTarget = getPlacementTargetAtClient(event.clientX, event.clientY);
        onCreateWallByDrag({
          start: {
            nodeId: placementDraft.startNodeId,
            wallId: placementDraft.startWallId,
            position: placementDraft.startWorld,
          },
          end: {
            nodeId: releaseTarget.nodeId,
            wallId: releaseTarget.wallId,
            position:
              releaseTarget.wallId !== null
                ? getProjectedWallPoint(releaseTarget.wallId, placementDraft.currentWorld)
                : placementDraft.currentWorld,
          },
        });
        setPlacementDraft(null);
        return;
      }

      if (placementDraft.kind === "measure") {
        const distanceM = Math.hypot(
          placementDraft.currentWorld.x - placementDraft.startWorld.x,
          placementDraft.currentWorld.y - placementDraft.startWorld.y,
        );

        if (measureToolPermanent && distanceM >= 0.0001) {
          onCreateMeasurement(
            placementDraft.startWorld,
            placementDraft.currentWorld,
            measureToolUnit,
          );
        }

        setPlacementDraft(null);
        return;
      }

      if (placementDraft.kind === "roofLine") {
        const distanceM = Math.hypot(
          placementDraft.currentWorld.x - placementDraft.startWorld.x,
          placementDraft.currentWorld.y - placementDraft.startWorld.y,
        );

        if (distanceM >= 0.0001) {
          onCreateRoofLine(placementDraft.startWorld, placementDraft.currentWorld);
        }

        setPlacementDraft(null);
        return;
      }

      const minimumSizeM = project.settings.snapToGrid
        ? project.settings.gridSpacingM
        : 0.2;

      if (placementDraft.kind === "shape") {
        const bounds = getSquarePlacementBounds(
          placementDraft.startWorld,
          placementDraft.currentWorld,
        );
        onCreateShapeAt({
          x: bounds.centerWorld.x,
          y: bounds.centerWorld.y,
          sizeM: Math.max(bounds.widthM, bounds.depthM, minimumSizeM),
        });
      } else if (activeTool !== "Roof" && slabMode === "Circle") {
        const circle = getCirclePlacement(
          placementDraft.startWorld,
          placementDraft.currentWorld,
        );
        onCreateSlabAt({
          x: circle.centerWorld.x,
          y: circle.centerWorld.y,
          widthM: Math.max(circle.diameterM, minimumSizeM),
          depthM: Math.max(circle.diameterM, minimumSizeM),
        });
      } else {
        const bounds = getPlacementBounds(
          placementDraft.startWorld,
          placementDraft.currentWorld,
        );
        onCreateSlabAt({
          x: bounds.centerWorld.x,
          y: bounds.centerWorld.y,
          widthM: Math.max(bounds.widthM, minimumSizeM),
          depthM: Math.max(bounds.depthM, minimumSizeM),
        });
      }

      setPlacementDraft(null);
      return;
    }

    if (dragState?.pointerId === event.pointerId) {
      if (rootRef.current?.hasPointerCapture(event.pointerId)) {
        rootRef.current.releasePointerCapture(event.pointerId);
      }

      if (dragState.kind === "select") {
        const selectionBounds = getPlacementBounds(dragState.startWorld, dragState.currentWorld);
        const nextSelectionSet: EditorSelection[] = [];

        for (const node of project.nodes) {
          if (node.levelId === activeLevelId && isPointInsideBounds(node.position, selectionBounds)) {
            nextSelectionSet.push({ kind: "node", id: node.id });
          }
        }

        for (const shape of project.shapes) {
          if (
            shape.levelId === activeLevelId &&
            isPointInsideBounds(shape.pose.position, selectionBounds)
          ) {
            nextSelectionSet.push({ kind: "shape", id: shape.id });
          }
        }

        for (const slab of project.slabs) {
          if (
            slab.levelId === activeLevelId &&
            isPointInsideBounds(slab.pose.position, selectionBounds)
          ) {
            nextSelectionSet.push({ kind: "slab", id: slab.id });
          }
        }

        for (const model of project.externalModels) {
          if (
            model.levelId === activeLevelId &&
            isPointInsideBounds(model.position, selectionBounds)
          ) {
            nextSelectionSet.push({ kind: "externalModel", id: model.id });
          }
        }

        onSelectionSetChange(nextSelectionSet, nextSelectionSet[0] ?? null);
        setDragState(null);
        return;
      }

      if (
        dragState.kind === "move" ||
        dragState.kind === "roofVertex" ||
        dragState.kind === "slabResize"
      ) {
        onMoveInteractionCommit();
      }

      setDragState(null);
    }
  }

  function handleBackgroundClick() {
    if (consumeSuppressedClick()) {
      return;
    }

    if (activeLevelId && snappedCursor) {
      if (activeTool === "Model") {
        onCreateExternalModelAt(snappedCursor);
        return;
      }
    }

    if (activeTool === "Wall") {
      onPendingWallStartNodeChange(null);
    }

    onSelectionChange(null);
  }

  function renderWall(wall: Wall) {
    const startNode = project.nodes.find((node) => node.id === wall.startNodeId);
    const endNode = project.nodes.find((node) => node.id === wall.endNodeId);
    const wallType = project.wallTypes.find((item) => item.id === wall.wallTypeId);
    const levelStyle = getLevelStyle(project, wall.levelId, activeLevelId);

    if (!startNode || !endNode || !wallType || !levelStyle) {
      return null;
    }

    const start = worldToScreen(startNode.position, metrics);
    const end = worldToScreen(endNode.position, metrics);
    const selected =
      isSelected(currentSelection, "wall", wall.id) ||
      isIncludedInSelectionSet(selectionSet, "wall", wall.id);
    const isToolInteractive = isEntityInteractiveForTool(activeTool, "wall");

    return (
      <line
        key={wall.id}
        data-viewport-entity="wall"
        data-wall-id={wall.id}
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        stroke={selected ? "#ffd166" : levelStyle.stroke}
        strokeWidth={Math.max(2, wallType.thicknessM * projectScale(metrics))}
        strokeOpacity={levelStyle.opacity}
        strokeLinecap="round"
        pointerEvents={levelStyle.interactive && isToolInteractive ? "auto" : "none"}
        onClick={(event) => {
          if (consumeSuppressedClick()) {
            event.stopPropagation();
            return;
          }

          event.stopPropagation();
          onSelectionChange({ kind: "wall", id: wall.id });
        }}
        onContextMenu={(event) => {
          if (activeTool !== "Wall" || !levelStyle.interactive) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          onDeleteWall(wall.id);
        }}
      />
    );
  }

  function renderDoor(door: DoorOpening) {
    const wall = project.walls.find((item) => item.id === door.wallId);
    if (!wall) {
      return null;
    }

    const startNode = project.nodes.find((node) => node.id === wall.startNodeId);
    const endNode = project.nodes.find((node) => node.id === wall.endNodeId);
    const wallType = project.wallTypes.find((item) => item.id === wall.wallTypeId);
    const levelStyle = getLevelStyle(project, wall.levelId, activeLevelId);
    if (!startNode || !endNode || !wallType || !levelStyle) {
      return null;
    }

    const segment = getDoorSegmentWorldPoints(door, startNode, endNode);
    if (!segment) {
      return null;
    }

    const start = worldToScreen(segment.start, metrics);
    const end = worldToScreen(segment.end, metrics);
    const selected =
      isSelected(currentSelection, "door", door.id) ||
      isIncludedInSelectionSet(selectionSet, "door", door.id);
    const isToolInteractive = isEntityInteractiveForTool(activeTool, "door");
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthPx = Math.hypot(dx, dy);
    const normalX = lengthPx > 0.001 ? -dy / lengthPx : 0;
    const normalY = lengthPx > 0.001 ? dx / lengthPx : 0;
    const tickLengthPx = selected ? 10 : 8;
    const strokeWidthPx = Math.max(6, wallType.thicknessM * projectScale(metrics) * 0.55);

    return (
      <g
        key={door.id}
        data-viewport-entity="door"
        data-door-id={door.id}
        opacity={levelStyle.opacity}
        pointerEvents={levelStyle.interactive && isToolInteractive ? "auto" : "none"}
        onPointerDown={(event) =>
          startMoveDrag(
            event,
            "door",
            door.id,
            createVec2((segment.start.x + segment.end.x) / 2, (segment.start.y + segment.end.y) / 2),
            levelStyle.interactive,
          )
        }
        onClick={(event) => {
          if (consumeSuppressedClick()) {
            event.stopPropagation();
            return;
          }

          event.stopPropagation();
          onSelectionChange({ kind: "door", id: door.id });
        }}
        onContextMenu={(event) => {
          if (activeTool !== "Door" || !levelStyle.interactive) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          onDeleteDoor(door.id);
        }}
      >
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke={selected ? "#ffd166" : "#cf8f5b"}
          strokeWidth={strokeWidthPx}
          strokeLinecap="round"
        />
        <line
          x1={start.x - normalX * tickLengthPx}
          y1={start.y - normalY * tickLengthPx}
          x2={start.x + normalX * tickLengthPx}
          y2={start.y + normalY * tickLengthPx}
          stroke={selected ? "#ffe3ad" : "#f3d2b2"}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <line
          x1={end.x - normalX * tickLengthPx}
          y1={end.y - normalY * tickLengthPx}
          x2={end.x + normalX * tickLengthPx}
          y2={end.y + normalY * tickLengthPx}
          stroke={selected ? "#ffe3ad" : "#f3d2b2"}
          strokeWidth={2}
          strokeLinecap="round"
        />
      </g>
    );
  }

  function renderWindow(windowOpening: WindowOpening) {
    const wall = project.walls.find((item) => item.id === windowOpening.wallId);
    if (!wall) {
      return null;
    }

    const startNode = project.nodes.find((node) => node.id === wall.startNodeId);
    const endNode = project.nodes.find((node) => node.id === wall.endNodeId);
    const wallType = project.wallTypes.find((item) => item.id === wall.wallTypeId);
    const levelStyle = getLevelStyle(project, wall.levelId, activeLevelId);
    if (!startNode || !endNode || !wallType || !levelStyle) {
      return null;
    }

    const segment = getWindowSegmentWorldPoints(windowOpening, startNode, endNode);
    if (!segment) {
      return null;
    }

    const start = worldToScreen(segment.start, metrics);
    const end = worldToScreen(segment.end, metrics);
    const selected =
      isSelected(currentSelection, "window", windowOpening.id) ||
      isIncludedInSelectionSet(selectionSet, "window", windowOpening.id);
    const isToolInteractive = isEntityInteractiveForTool(activeTool, "window");
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthPx = Math.hypot(dx, dy);
    const normalX = lengthPx > 0.001 ? -dy / lengthPx : 0;
    const normalY = lengthPx > 0.001 ? dx / lengthPx : 0;
    const tickLengthPx = selected ? 12 : 10;
    const strokeWidthPx = Math.max(6, wallType.thicknessM * projectScale(metrics) * 0.5);

    return (
      <g
        key={windowOpening.id}
        data-viewport-entity="window"
        data-window-id={windowOpening.id}
        opacity={levelStyle.opacity}
        pointerEvents={levelStyle.interactive && isToolInteractive ? "auto" : "none"}
        onPointerDown={(event) =>
          startMoveDrag(
            event,
            "window",
            windowOpening.id,
            createVec2((segment.start.x + segment.end.x) / 2, (segment.start.y + segment.end.y) / 2),
            levelStyle.interactive,
          )
        }
        onClick={(event) => {
          if (consumeSuppressedClick()) {
            event.stopPropagation();
            return;
          }

          event.stopPropagation();
          onSelectionChange({ kind: "window", id: windowOpening.id });
        }}
        onContextMenu={(event) => {
          if (activeTool !== "Window" || !levelStyle.interactive) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          onDeleteWindow(windowOpening.id);
        }}
      >
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke={selected ? "#ffd166" : "#74c6f9"}
          strokeWidth={strokeWidthPx}
          strokeLinecap="round"
        />
        <line
          x1={start.x - normalX * tickLengthPx}
          y1={start.y - normalY * tickLengthPx}
          x2={start.x + normalX * tickLengthPx}
          y2={start.y + normalY * tickLengthPx}
          stroke={selected ? "#ffe3ad" : "#dff4ff"}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <line
          x1={end.x - normalX * tickLengthPx}
          y1={end.y - normalY * tickLengthPx}
          x2={end.x + normalX * tickLengthPx}
          y2={end.y + normalY * tickLengthPx}
          stroke={selected ? "#ffe3ad" : "#dff4ff"}
          strokeWidth={2}
          strokeLinecap="round"
        />
      </g>
    );
  }

  function renderMeasurement(measurement: Measurement) {
    const levelStyle = getLevelStyle(project, measurement.levelId, activeLevelId);
    if (!levelStyle) {
      return null;
    }

    const start = worldToScreen(measurement.start, metrics);
    const end = worldToScreen(measurement.end, metrics);
    const selected =
      isSelected(currentSelection, "measure", measurement.id) ||
      isIncludedInSelectionSet(selectionSet, "measure", measurement.id);
    const isToolInteractive = isEntityInteractiveForTool(activeTool, "measure");
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthPx = Math.hypot(dx, dy);
    const normalX = lengthPx > 0.001 ? -dy / lengthPx : 0;
    const normalY = lengthPx > 0.001 ? dx / lengthPx : 0;
    const tickHalfPx = 8;
    const label = formatMeasurementDistance(
      Math.hypot(
        measurement.end.x - measurement.start.x,
        measurement.end.y - measurement.start.y,
      ),
      measurement.unit,
    );
    const labelWidth = label.length * 6.4 + 18;
    const midX = (start.x + end.x) / 2 + normalX * 16;
    const midY = (start.y + end.y) / 2 + normalY * 16;

    return (
      <g
        key={measurement.id}
        data-viewport-entity="measure"
        data-measure-id={measurement.id}
        opacity={levelStyle.opacity}
        pointerEvents={levelStyle.interactive && isToolInteractive ? "auto" : "none"}
      >
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke={selected ? "#ffd166" : "#f3dfbf"}
          strokeWidth={2}
          strokeDasharray="8 4"
          strokeLinecap="round"
        />
        <line
          x1={start.x - normalX * tickHalfPx}
          y1={start.y - normalY * tickHalfPx}
          x2={start.x + normalX * tickHalfPx}
          y2={start.y + normalY * tickHalfPx}
          stroke={selected ? "#ffe7b5" : "#f8f6f2"}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <line
          x1={end.x - normalX * tickHalfPx}
          y1={end.y - normalY * tickHalfPx}
          x2={end.x + normalX * tickHalfPx}
          y2={end.y + normalY * tickHalfPx}
          stroke={selected ? "#ffe7b5" : "#f8f6f2"}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <g transform={`translate(${midX - labelWidth / 2} ${midY - 14})`} pointerEvents="none">
          <rect
            x={0}
            y={0}
            width={labelWidth}
            height={24}
            rx={10}
            fill="rgba(8, 12, 22, 0.88)"
            stroke={selected ? "rgba(255, 209, 102, 0.42)" : "rgba(243, 223, 191, 0.32)"}
            strokeWidth={1}
          />
          <text
            x={labelWidth / 2}
            y={15}
            fill="#f8f6f2"
            fontSize={12}
            fontFamily="Aptos, Segoe UI Variable, sans-serif"
            textAnchor="middle"
          >
            {label}
          </text>
        </g>
      </g>
    );
  }

  function renderStair(stair: Stair) {
    const levelStyle = getLevelStyle(project, stair.levelId, activeLevelId);
    if (!levelStyle || stair.pathNodes.length < 2) {
      return null;
    }

    const selected =
      isSelected(currentSelection, "stair", stair.id) ||
      isIncludedInSelectionSet(selectionSet, "stair", stair.id);
    const isToolInteractive = isEntityInteractiveForTool(activeTool, "stair");
    const pathData = createSvgPathFromPoints(stair.pathNodes, metrics);
    const stairWidthPx = Math.max(10, stair.widthM * projectScale(metrics));
    const segments = buildStairPlanSegments(stair);
    const riserStroke = selected ? "#ffe3ad" : "#f2fbff";
    const corridorFill = selected ? "rgba(255, 209, 102, 0.14)" : "rgba(10, 18, 24, 0.76)";
    const corridorInner = selected ? "rgba(255, 209, 102, 0.08)" : "rgba(116, 198, 249, 0.08)";
    const outlineStroke = selected ? "#ffd166" : "#cdeeff";
    const arrow = getStairArrowWorldPoints(stair, segments);

    return (
      <g
        key={stair.id}
        data-viewport-entity="stair"
        data-stair-id={stair.id}
        opacity={levelStyle.opacity}
        pointerEvents={levelStyle.interactive && isToolInteractive ? "auto" : "none"}
        onClick={(event) => {
          if (consumeSuppressedClick()) {
            event.stopPropagation();
            return;
          }

          event.stopPropagation();
          onSelectionChange({ kind: "stair", id: stair.id });
        }}
        onContextMenu={(event) => {
          if (activeTool !== "Stair" || !levelStyle.interactive) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          onDeleteStair(stair.id);
        }}
      >
        <path
          d={pathData}
          fill="none"
          stroke={outlineStroke}
          strokeWidth={stairWidthPx}
          strokeLinejoin="round"
          strokeLinecap="butt"
        />
        <path
          d={pathData}
          fill="none"
          stroke={corridorFill}
          strokeWidth={Math.max(2, stairWidthPx - 3)}
          strokeLinejoin="round"
          strokeLinecap="butt"
        />
        <path
          d={pathData}
          fill="none"
          stroke={corridorInner}
          strokeWidth={Math.max(2, stairWidthPx * 0.18)}
          strokeLinejoin="round"
          strokeLinecap="butt"
        />
        {segments.flatMap((segment, segmentIndex) => {
          const usableLengthM =
            segment.lengthM - segment.trimmedStartM - segment.trimmedEndM;
          if (usableLengthM <= 0.08) {
            return [];
          }

          const riserCount = Math.max(
            1,
            Math.floor(usableLengthM / Math.max(0.18, stair.treadDepthM)),
          );
          const stepSpacingM = usableLengthM / riserCount;
          const tickHalfWidthPx = Math.max(6, stairWidthPx * 0.36);

          return Array.from({ length: riserCount }, (_, riserIndex) => {
            const offsetM =
              segment.trimmedStartM + stepSpacingM * (riserIndex + 0.5);
            const centerWorld = pointOnStairSegment(segment, offsetM);
            const center = worldToScreen(centerWorld, metrics);
            return (
              <line
                key={`${stair.id}-riser-${segmentIndex}-${riserIndex}`}
                x1={center.x - segment.normalX * tickHalfWidthPx}
                y1={center.y + segment.normalY * tickHalfWidthPx}
                x2={center.x + segment.normalX * tickHalfWidthPx}
                y2={center.y - segment.normalY * tickHalfWidthPx}
                stroke={riserStroke}
                strokeWidth={Math.max(1.5, stairWidthPx * 0.07)}
                strokeLinecap="round"
              />
            );
          });
        })}
        {arrow ? (
          <g>
            <line
              x1={worldToScreen(arrow.tail, metrics).x}
              y1={worldToScreen(arrow.tail, metrics).y}
              x2={worldToScreen(arrow.head, metrics).x}
              y2={worldToScreen(arrow.head, metrics).y}
              stroke={outlineStroke}
              strokeWidth={Math.max(2, stairWidthPx * 0.08)}
              strokeLinecap="round"
            />
            {(() => {
              const arrowHead = worldToScreen(arrow.head, metrics);
              const arrowSizePx = Math.max(9, stairWidthPx * 0.18);
              const leftX =
                arrowHead.x -
                arrow.directionX * arrowSizePx -
                arrow.normalX * (arrowSizePx * 0.6);
              const leftY =
                arrowHead.y +
                arrow.directionY * arrowSizePx +
                arrow.normalY * (arrowSizePx * 0.6);
              const rightX =
                arrowHead.x -
                arrow.directionX * arrowSizePx +
                arrow.normalX * (arrowSizePx * 0.6);
              const rightY =
                arrowHead.y +
                arrow.directionY * arrowSizePx -
                arrow.normalY * (arrowSizePx * 0.6);
              const labelX = arrowHead.x + arrow.normalX * (arrowSizePx * 1.25);
              const labelY = arrowHead.y - arrow.normalY * (arrowSizePx * 1.25);

              return (
                <>
                  <polygon
                    points={`${arrowHead.x},${arrowHead.y} ${leftX},${leftY} ${rightX},${rightY}`}
                    fill={outlineStroke}
                  />
                  <text
                    x={labelX}
                    y={labelY}
                    fill={outlineStroke}
                    fontSize={Math.max(10, stairWidthPx * 0.18)}
                    fontWeight={700}
                    fontFamily="Aptos, Segoe UI Variable, sans-serif"
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    UP
                  </text>
                </>
              );
            })()}
          </g>
        ) : null}
      </g>
    );
  }

  function renderNode(node: NodeData) {
    const levelStyle = getLevelStyle(project, node.levelId, activeLevelId);
    if (!levelStyle) {
      return null;
    }

    const point = worldToScreen(node.position, metrics);
    const selected =
      isSelected(currentSelection, "node", node.id) ||
      isIncludedInSelectionSet(selectionSet, "node", node.id) ||
      pendingWallStartNodeId === node.id;
    const isToolInteractive = isEntityInteractiveForTool(activeTool, "node");

    return (
      <circle
        key={node.id}
        data-viewport-entity="node"
        cx={point.x}
        cy={point.y}
        r={selected ? project.settings.nodeRadiusPx * 0.85 : project.settings.nodeRadiusPx * 0.72}
        fill={selected ? "#ffe6a7" : "#f7fbfe"}
        stroke={selected ? "#b97b00" : levelStyle.stroke}
        strokeWidth={2}
        fillOpacity={0.98}
        opacity={levelStyle.opacity}
        pointerEvents={levelStyle.interactive && isToolInteractive ? "auto" : "none"}
        data-node-id={node.id}
        onPointerDown={(event) =>
          startMoveDrag(event, "node", node.id, node.position, levelStyle.interactive)
        }
        onClick={(event) => {
          if (consumeSuppressedClick()) {
            event.stopPropagation();
            return;
          }

          if (activeTool === "Node") {
            return;
          }

          event.stopPropagation();
          if (activeTool === "Wall") {
            if (!levelStyle.interactive) {
              return;
            }

            if (pendingWallStartNodeId === null) {
              onPendingWallStartNodeChange(node.id);
              onSelectionChange({ kind: "node", id: node.id });
              return;
            }

            if (pendingWallStartNodeId === node.id) {
              onPendingWallStartNodeChange(null);
              onSelectionChange({ kind: "node", id: node.id });
              return;
            }

            onCreateWallBetweenNodes(pendingWallStartNodeId, node.id);
            onPendingWallStartNodeChange(null);
            return;
          }

          onSelectionChange({ kind: "node", id: node.id });
        }}
        onContextMenu={(event) => {
          if (!levelStyle.interactive) {
            return;
          }

          if (activeTool === "Wall") {
            event.preventDefault();
            event.stopPropagation();
            onDeleteWallsConnectedToNode(node.id);
            onPendingWallStartNodeChange(null);
            return;
          }

          if (activeTool !== "Node") {
            return;
          }
        }}
      />
    );
  }

  function renderShape(shape: Shape) {
    const levelStyle = getLevelStyle(project, shape.levelId, activeLevelId);
    if (!levelStyle) {
      return null;
    }

    const selected =
      isSelected(currentSelection, "shape", shape.id) ||
      isIncludedInSelectionSet(selectionSet, "shape", shape.id);
    const isToolInteractive = isEntityInteractiveForTool(activeTool, "shape");

    if (shape.kind === "Cylinder") {
      const center = worldToScreen(shape.pose.position, metrics);
      return (
        <circle
          key={shape.id}
          data-viewport-entity="shape"
          data-shape-id={shape.id}
          cx={center.x}
          cy={center.y}
          r={(shape.sizeM / 2) * projectScale(metrics)}
          fill={selected ? "rgba(255, 209, 102, 0.38)" : levelStyle.fill}
          stroke={selected ? "#ffd166" : "#8ed0ff"}
          strokeWidth={selected ? 3 : 2}
          opacity={levelStyle.opacity}
          pointerEvents={levelStyle.interactive && isToolInteractive ? "auto" : "none"}
          onPointerDown={(event) =>
            startMoveDrag(event, "shape", shape.id, shape.pose.position, levelStyle.interactive)
          }
          onClick={(event) => {
            if (consumeSuppressedClick()) {
              event.stopPropagation();
              return;
            }

            event.stopPropagation();
            if (activeTool === "Shape") {
              return;
            }

            onSelectionChange({ kind: "shape", id: shape.id });
          }}
          onContextMenu={(event) => {
            if (activeTool === "Shape" && levelStyle.interactive) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        />
      );
    }

    const square = renderSquare(shape, metrics);

    return (
      <rect
        key={shape.id}
        data-viewport-entity="shape"
        data-shape-id={shape.id}
        x={square.x}
        y={square.y}
        width={square.width}
        height={square.height}
        fill={selected ? "rgba(255, 209, 102, 0.38)" : levelStyle.fill}
        stroke={selected ? "#ffd166" : "#7fd1b9"}
        strokeWidth={selected ? 3 : 2}
        opacity={levelStyle.opacity}
        pointerEvents={levelStyle.interactive && isToolInteractive ? "auto" : "none"}
        onPointerDown={(event) =>
          startMoveDrag(event, "shape", shape.id, shape.pose.position, levelStyle.interactive)
        }
        onClick={(event) => {
          if (consumeSuppressedClick()) {
            event.stopPropagation();
            return;
          }

          event.stopPropagation();
          if (activeTool === "Shape") {
            return;
          }

          onSelectionChange({ kind: "shape", id: shape.id });
        }}
        onContextMenu={(event) => {
          if (activeTool === "Shape" && levelStyle.interactive) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      />
    );
  }

  function renderSlab(slab: Slab) {
    const levelStyle = getLevelStyle(project, slab.levelId, activeLevelId);
    if (!levelStyle) {
      return null;
    }

    const selected =
      isSelected(currentSelection, "slab", slab.id) ||
      isIncludedInSelectionSet(selectionSet, "slab", slab.id);
    const outline = renderSlabOutline(slab, metrics);
    const matchesSlabTool = activeTool === "Slab" && slab.roofType === "Flat";
    const matchesRoofTool = activeTool === "Roof" && slab.roofType !== "Flat";
    const isToolInteractive =
      activeTool === "Slab" || activeTool === "Roof"
        ? matchesSlabTool || matchesRoofTool
        : isEntityInteractiveForTool(activeTool, "slab");
    const baseFill =
      slab.roofType === "Flat" ? "rgba(96, 181, 127, 0.12)" : "rgba(201, 129, 77, 0.14)";
    const baseStroke = slab.roofType === "Flat" ? "#60b57f" : "#c9814d";

    if (outline.kind === "circle") {
      return (
        <circle
          key={slab.id}
          data-viewport-entity="slab"
          data-slab-id={slab.id}
          cx={outline.center.x}
          cy={outline.center.y}
          r={outline.radius}
          fill={selected ? "rgba(255, 209, 102, 0.18)" : baseFill}
          stroke={selected ? "#ffd166" : baseStroke}
          strokeWidth={selected ? 3 : 2}
          opacity={levelStyle.opacity}
          pointerEvents={levelStyle.interactive && isToolInteractive ? "auto" : "none"}
          onPointerDown={(event) =>
            startMoveDrag(event, "slab", slab.id, slab.pose.position, levelStyle.interactive)
          }
          onClick={(event) => {
            if (consumeSuppressedClick()) {
              event.stopPropagation();
              return;
            }

            event.stopPropagation();
            if (matchesSlabTool || matchesRoofTool) {
              return;
            }

            onSelectionChange({ kind: "slab", id: slab.id });
          }}
          onContextMenu={(event) => {
            if ((matchesSlabTool || matchesRoofTool) && levelStyle.interactive) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        />
      );
    }

    const handleSizePx = 10;
    const resizeHandles =
      selected && activeTool === "Move" && levelStyle.interactive
        ? ([
            { xSign: -1, ySign: 1, cursor: "nwse-resize" },
            { xSign: 1, ySign: 1, cursor: "nesw-resize" },
            { xSign: 1, ySign: -1, cursor: "nwse-resize" },
            { xSign: -1, ySign: -1, cursor: "nesw-resize" },
          ] as const)
        : [];

    return (
      <g key={slab.id}>
        <rect
          data-viewport-entity="slab"
          data-slab-id={slab.id}
          x={outline.x}
          y={outline.y}
          width={outline.width}
          height={outline.height}
          fill={selected ? "rgba(255, 209, 102, 0.18)" : baseFill}
          stroke={selected ? "#ffd166" : baseStroke}
          strokeWidth={selected ? 3 : 2}
          opacity={levelStyle.opacity}
          pointerEvents={levelStyle.interactive && isToolInteractive ? "auto" : "none"}
          onPointerDown={(event) =>
            startMoveDrag(event, "slab", slab.id, slab.pose.position, levelStyle.interactive)
          }
          onClick={(event) => {
            if (consumeSuppressedClick()) {
              event.stopPropagation();
              return;
            }

            event.stopPropagation();
            if (matchesSlabTool || matchesRoofTool) {
              return;
            }

            onSelectionChange({ kind: "slab", id: slab.id });
          }}
          onContextMenu={(event) => {
            if ((matchesSlabTool || matchesRoofTool) && levelStyle.interactive) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        />
        {resizeHandles.map((handle) => {
          const position = worldToScreen(
            createVec2(
              slab.pose.position.x + handle.xSign * slab.widthM / 2,
              slab.pose.position.y + handle.ySign * slab.depthM / 2,
            ),
            metrics,
          );

          return (
            <rect
              key={`${slab.id}-resize-${handle.xSign}-${handle.ySign}`}
              x={position.x - handleSizePx / 2}
              y={position.y - handleSizePx / 2}
              width={handleSizePx}
              height={handleSizePx}
              rx={3}
              fill="#111827"
              stroke="#ffd166"
              strokeWidth={2}
              opacity={levelStyle.opacity}
              pointerEvents="auto"
              style={{ cursor: handle.cursor }}
              onPointerDown={(event) =>
                startSlabResizeDrag(
                  event,
                  slab,
                  handle.xSign,
                  handle.ySign,
                  levelStyle.interactive,
                )
              }
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            />
          );
        })}
      </g>
    );
  }

  function renderRoofSketchFaces() {
    return project.roofSketches.flatMap((sketch) => {
      const vertexById = new Map(sketch.vertices.map((vertex) => [vertex.id, vertex] as const));

      return sketch.faces.map((face) => {
        const points = face.vertexIds
          .map((vertexId) => vertexById.get(vertexId)?.position ?? null)
          .filter((point): point is Vec2 => point !== null);
        if (points.length < 3) {
          return null;
        }

        const selected =
          isSelected(currentSelection, "roofFace", face.id) ||
          isIncludedInSelectionSet(selectionSet, "roofFace", face.id);
        return (
          <path
            key={face.id}
            data-viewport-entity="roofFace"
            data-roof-face-id={face.id}
            pointerEvents={
              activeTool === "Roof" || activeTool === "RoofOpening" ? "auto" : "none"
            }
            d={`${createSvgPathFromPoints(points, metrics)} Z`}
            fill={selected ? "rgba(255, 209, 102, 0.20)" : "rgba(201, 129, 77, 0.16)"}
            stroke={selected ? "#ffd166" : "rgba(201, 129, 77, 0.42)"}
            strokeWidth={selected ? 2.5 : 1.5}
            strokeLinejoin="round"
            onClick={(event) => {
              if (consumeSuppressedClick()) {
                event.stopPropagation();
                return;
              }

              event.stopPropagation();
              const selection = { kind: "roofFace" as const, id: face.id };
              onSelectionSetChange([selection], selection);
              if (activeTool === "RoofOpening") {
                const center = getWorldFromClient(event.clientX, event.clientY);
                if (center) {
                  onCreateRoofOpening({
                    roofSketchId: sketch.id,
                    roofFaceId: face.id,
                    center,
                  });
                }
              }
            }}
          />
        );
      });
    });
  }

  function renderRoofSketchEdges() {
    return project.roofSketches.flatMap((sketch) => {
      const vertexById = new Map(sketch.vertices.map((vertex) => [vertex.id, vertex] as const));

      return sketch.edges.map((edge) => {
        const start = vertexById.get(edge.startVertexId);
        const end = vertexById.get(edge.endVertexId);
        if (!start || !end) {
          return null;
        }

        const startScreen = worldToScreen(start.position, metrics);
        const endScreen = worldToScreen(end.position, metrics);
        const selected =
          isSelected(currentSelection, "roofEdge", edge.id) ||
          isIncludedInSelectionSet(selectionSet, "roofEdge", edge.id);
        const startElevationM = start.elevationM ?? sketch.baseElevationM;
        const endElevationM = end.elevationM ?? sketch.baseElevationM;
        const label =
          Math.abs(startElevationM - endElevationM) < 0.001
            ? `${startElevationM.toFixed(2)} m`
            : `${startElevationM.toFixed(2)} -> ${endElevationM.toFixed(2)} m`;
        const midpoint = {
          x: (startScreen.x + endScreen.x) / 2,
          y: (startScreen.y + endScreen.y) / 2,
        };
        const worldMidpoint = createVec2(
          (start.position.x + end.position.x) / 2,
          (start.position.y + end.position.y) / 2,
        );
        const labelWidth = label.length * 6.4 + 14;

        return (
          <g
            key={edge.id}
            data-viewport-entity="roofEdge"
            data-roof-edge-id={edge.id}
            pointerEvents={activeTool === "Roof" || activeTool === "Move" ? "auto" : "none"}
            onPointerDown={(event) =>
              startMoveDrag(event, "roofEdge", edge.id, worldMidpoint, true)
            }
            onClick={(event) => {
              if (consumeSuppressedClick()) {
                event.stopPropagation();
                return;
              }

              event.stopPropagation();
              const selection = { kind: "roofEdge" as const, id: edge.id };
              const isAlreadySelected = isIncludedInSelectionSet(selectionSet, "roofEdge", edge.id);
              const nextSelectionSet = isAlreadySelected
                ? selectionSet.filter(
                    (item) => !(item.kind === "roofEdge" && item.id === edge.id),
                  )
                : [...selectionSet.filter((item) => item.kind === "roofEdge"), selection];
              onSelectionSetChange(nextSelectionSet, selection);
            }}
          >
            <line
              x1={startScreen.x}
              y1={startScreen.y}
              x2={endScreen.x}
              y2={endScreen.y}
              stroke={selected ? "#ffd166" : "#d9965a"}
              strokeWidth={selected ? 5 : 3}
              strokeLinecap="round"
            />
            <line
              x1={startScreen.x}
              y1={startScreen.y}
              x2={endScreen.x}
              y2={endScreen.y}
              stroke="transparent"
              strokeWidth={16}
              strokeLinecap="round"
            />
            <circle
              cx={startScreen.x}
              cy={startScreen.y}
              r={11}
              fill="transparent"
              pointerEvents={activeTool === "Move" ? "auto" : "none"}
              onPointerDown={(event) =>
                startRoofVertexDrag(event, sketch.id, edge.id, edge.startVertexId, start.position)
              }
            />
            <circle
              cx={startScreen.x}
              cy={startScreen.y}
              r={selected ? 5 : 4}
              fill={selected ? "#ffe0a1" : "#f1b879"}
              stroke="#7f4a26"
              strokeWidth={1.5}
              pointerEvents={activeTool === "Move" ? "auto" : "none"}
              onPointerDown={(event) =>
                startRoofVertexDrag(event, sketch.id, edge.id, edge.startVertexId, start.position)
              }
            />
            <circle
              cx={endScreen.x}
              cy={endScreen.y}
              r={11}
              fill="transparent"
              pointerEvents={activeTool === "Move" ? "auto" : "none"}
              onPointerDown={(event) =>
                startRoofVertexDrag(event, sketch.id, edge.id, edge.endVertexId, end.position)
              }
            />
            <circle
              cx={endScreen.x}
              cy={endScreen.y}
              r={selected ? 5 : 4}
              fill={selected ? "#ffe0a1" : "#f1b879"}
              stroke="#7f4a26"
              strokeWidth={1.5}
              pointerEvents={activeTool === "Move" ? "auto" : "none"}
              onPointerDown={(event) =>
                startRoofVertexDrag(event, sketch.id, edge.id, edge.endVertexId, end.position)
              }
            />
            <g transform={`translate(${midpoint.x + 8} ${midpoint.y - 8})`}>
              <rect
                x={0}
                y={-16}
                width={labelWidth}
                height={22}
                rx={8}
                fill="rgba(8, 12, 22, 0.82)"
                stroke="rgba(217, 150, 90, 0.44)"
                strokeWidth={1}
              />
              <text
                x={7}
                y={-1}
                fill="#f8f6f2"
                fontSize={11}
                fontFamily="Aptos, Segoe UI Variable, sans-serif"
              >
                {label}
              </text>
            </g>
          </g>
        );
      });
    });
  }

  function renderRoofOpenings() {
    return project.roofOpenings.map((opening) => {
      const center = worldToScreen(opening.center, metrics);
      const widthM = opening.rotationDeg === 90 ? opening.widthM : opening.heightM;
      const heightM = opening.rotationDeg === 90 ? opening.heightM : opening.widthM;
      const widthPx = widthM * projectScale(metrics);
      const heightPx = heightM * projectScale(metrics);
      const selected =
        isSelected(currentSelection, "roofOpening", opening.id) ||
        isIncludedInSelectionSet(selectionSet, "roofOpening", opening.id);
      const isToolInteractive = isEntityInteractiveForTool(activeTool, "roofOpening");
      return (
        <g
          key={opening.id}
          data-viewport-entity="roofOpening"
          data-roof-opening-id={opening.id}
          pointerEvents={isToolInteractive ? "auto" : "none"}
          onPointerDown={(event) =>
            startMoveDrag(event, "roofOpening", opening.id, opening.center, true)
          }
          onClick={(event) => {
            if (consumeSuppressedClick()) {
              event.stopPropagation();
              return;
            }

            event.stopPropagation();
            const selection = { kind: "roofOpening" as const, id: opening.id };
            onSelectionSetChange([selection], selection);
          }}
        >
          <rect
            x={center.x - widthPx / 2}
            y={center.y - heightPx / 2}
            width={widthPx}
            height={heightPx}
            rx={4}
            fill={selected ? "rgba(255, 209, 102, 0.32)" : "rgba(88, 166, 255, 0.26)"}
            stroke={selected ? "#ffd166" : "#58a6ff"}
            strokeWidth={selected ? 3 : 2}
            strokeDasharray={opening.cutMode === "Vertical" ? "6 4" : undefined}
          />
          <rect
            x={center.x - widthPx / 2 - 5}
            y={center.y - heightPx / 2 - 5}
            width={widthPx + 10}
            height={heightPx + 10}
            rx={8}
            fill="transparent"
          />
          <line
            x1={center.x - widthPx / 2}
            y1={center.y}
            x2={center.x + widthPx / 2}
            y2={center.y}
            stroke={selected ? "rgba(255, 255, 255, 0.88)" : "rgba(255, 255, 255, 0.62)"}
            strokeWidth={1.5}
          />
        </g>
      );
    });
  }

  function renderExternalModel(model: ExternalModel) {
    const levelStyle = getLevelStyle(project, model.levelId, activeLevelId);
    if (!levelStyle) {
      return null;
    }

    const point = worldToScreen(model.position, metrics);
    const selected =
      isSelected(currentSelection, "externalModel", model.id) ||
      isIncludedInSelectionSet(selectionSet, "externalModel", model.id);
    const isToolInteractive = isEntityInteractiveForTool(activeTool, "externalModel");

    return (
      <g
        key={model.id}
        data-viewport-entity="externalModel"
        data-model-id={model.id}
        opacity={levelStyle.opacity}
        pointerEvents={levelStyle.interactive && isToolInteractive ? "auto" : "none"}
        onPointerDown={(event) =>
          startMoveDrag(event, "externalModel", model.id, model.position, levelStyle.interactive)
        }
        onClick={(event) => {
          if (consumeSuppressedClick()) {
            event.stopPropagation();
            return;
          }

          event.stopPropagation();
          if (activeTool === "Model") {
            return;
          }

          onSelectionChange({ kind: "externalModel", id: model.id });
        }}
        onContextMenu={(event) => {
          if (activeTool === "Model" && levelStyle.interactive) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <circle
          cx={point.x}
          cy={point.y}
          r={selected ? 10 : 8}
          fill={selected ? "#ffd166" : "#ff8b5e"}
          stroke="#fff5ef"
          strokeWidth={2}
        />
        <line x1={point.x - 12} y1={point.y} x2={point.x + 12} y2={point.y} stroke="#fff5ef" strokeWidth={1.5} />
        <line x1={point.x} y1={point.y - 12} x2={point.x} y2={point.y + 12} stroke="#fff5ef" strokeWidth={1.5} />
        <text
          x={point.x + 14}
          y={point.y - 14}
          fill="#fff6f1"
          fontSize={12}
          fontFamily="Aptos, Segoe UI Variable, sans-serif"
        >
          {model.name}
        </text>
      </g>
    );
  }

  function renderSelectionOverlay() {
    if (!currentSelection) {
      return null;
    }

    switch (currentSelection.kind) {
      case "node": {
        const node = project.nodes.find((item) => item.id === currentSelection.id);
        const levelStyle = node ? getLevelStyle(project, node.levelId, activeLevelId) : null;
        if (!node || !levelStyle) {
          return null;
        }

        const point = worldToScreen(node.position, metrics);
        const connectedWalls = project.walls.filter(
          (wall) => wall.startNodeId === node.id || wall.endNodeId === node.id,
        );

        return (
          <g pointerEvents="none">
            {connectedWalls.map((wall) => {
              const startNode = project.nodes.find((item) => item.id === wall.startNodeId);
              const endNode = project.nodes.find((item) => item.id === wall.endNodeId);
              if (!startNode || !endNode) {
                return null;
              }

              const start = worldToScreen(startNode.position, metrics);
              const end = worldToScreen(endNode.position, metrics);
              return (
                <line
                  key={`selection-node-wall-${wall.id}`}
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke="rgba(255, 209, 102, 0.72)"
                  strokeWidth={4}
                  strokeLinecap="round"
                />
              );
            })}
            <circle
              cx={point.x}
              cy={point.y}
              r={project.settings.nodeRadiusPx * 1.45}
              fill="none"
              stroke="#ffd166"
              strokeWidth={3}
            />
            <circle
              cx={point.x}
              cy={point.y}
              r={project.settings.nodeRadiusPx * 1.9}
              fill="none"
              stroke="rgba(255, 209, 102, 0.45)"
              strokeWidth={2}
              strokeDasharray="6 6"
            />
          </g>
        );
      }
      case "wall": {
        const wall = project.walls.find((item) => item.id === currentSelection.id);
        if (!wall) {
          return null;
        }

        const startNode = project.nodes.find((item) => item.id === wall.startNodeId);
        const endNode = project.nodes.find((item) => item.id === wall.endNodeId);
        const levelStyle = getLevelStyle(project, wall.levelId, activeLevelId);
        if (!startNode || !endNode || !levelStyle) {
          return null;
        }

        const start = worldToScreen(startNode.position, metrics);
        const end = worldToScreen(endNode.position, metrics);
        return (
          <g pointerEvents="none">
            <line
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke="rgba(255, 209, 102, 0.32)"
              strokeWidth={12}
              strokeLinecap="round"
            />
            <circle cx={start.x} cy={start.y} r={10} fill="#ffe6a7" stroke="#b97b00" strokeWidth={2} />
            <circle cx={end.x} cy={end.y} r={10} fill="#ffe6a7" stroke="#b97b00" strokeWidth={2} />
          </g>
        );
      }
      case "measure": {
        const measurement = project.measurements.find((item) => item.id === currentSelection.id);
        const levelStyle = measurement
          ? getLevelStyle(project, measurement.levelId, activeLevelId)
          : null;
        if (!measurement || !levelStyle) {
          return null;
        }

        const start = worldToScreen(measurement.start, metrics);
        const end = worldToScreen(measurement.end, metrics);
        return (
          <g pointerEvents="none">
            <line
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke="rgba(255, 209, 102, 0.4)"
              strokeWidth={10}
              strokeLinecap="round"
            />
          </g>
        );
      }
      case "door": {
        const door = project.doors.find((item) => item.id === currentSelection.id);
        if (!door) {
          return null;
        }

        const wall = project.walls.find((item) => item.id === door.wallId);
        if (!wall) {
          return null;
        }

        const startNode = project.nodes.find((item) => item.id === wall.startNodeId);
        const endNode = project.nodes.find((item) => item.id === wall.endNodeId);
        if (!startNode || !endNode) {
          return null;
        }

        const segment = getDoorSegmentWorldPoints(door, startNode, endNode);
        if (!segment) {
          return null;
        }

        const start = worldToScreen(segment.start, metrics);
        const end = worldToScreen(segment.end, metrics);
        return (
          <g pointerEvents="none">
            <line
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke="rgba(255, 209, 102, 0.36)"
              strokeWidth={16}
              strokeLinecap="round"
            />
            <line
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke="#ffd166"
              strokeWidth={8}
              strokeLinecap="round"
            />
          </g>
        );
      }
      case "window": {
        const windowOpening = project.windows.find((item) => item.id === currentSelection.id);
        if (!windowOpening) {
          return null;
        }

        const wall = project.walls.find((item) => item.id === windowOpening.wallId);
        if (!wall) {
          return null;
        }

        const startNode = project.nodes.find((item) => item.id === wall.startNodeId);
        const endNode = project.nodes.find((item) => item.id === wall.endNodeId);
        if (!startNode || !endNode) {
          return null;
        }

        const segment = getWindowSegmentWorldPoints(windowOpening, startNode, endNode);
        if (!segment) {
          return null;
        }

        const start = worldToScreen(segment.start, metrics);
        const end = worldToScreen(segment.end, metrics);
        return (
          <g pointerEvents="none">
            <line
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke="rgba(116, 198, 249, 0.28)"
              strokeWidth={18}
              strokeLinecap="round"
            />
            <line
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke="#ffd166"
              strokeWidth={7}
              strokeLinecap="round"
            />
          </g>
        );
      }
      case "stair": {
        const stair = project.stairs.find((item) => item.id === currentSelection.id);
        const levelStyle = stair ? getLevelStyle(project, stair.levelId, activeLevelId) : null;
        if (!stair || !levelStyle || stair.pathNodes.length < 2) {
          return null;
        }

        return (
          <g pointerEvents="none">
            <path
              d={createSvgPathFromPoints(stair.pathNodes, metrics)}
              fill="none"
              stroke="rgba(255, 209, 102, 0.24)"
              strokeWidth={Math.max(18, stair.widthM * projectScale(metrics) + 10)}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <path
              d={createSvgPathFromPoints(stair.pathNodes, metrics)}
              fill="none"
              stroke="#ffd166"
              strokeWidth={Math.max(4, stair.widthM * projectScale(metrics) * 0.22)}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        );
      }
      case "shape": {
        const shape = project.shapes.find((item) => item.id === currentSelection.id);
        const levelStyle = shape ? getLevelStyle(project, shape.levelId, activeLevelId) : null;
        if (!shape || !levelStyle) {
          return null;
        }

        if (shape.kind === "Cylinder") {
          const center = worldToScreen(shape.pose.position, metrics);
          return (
            <circle
              pointerEvents="none"
              cx={center.x}
              cy={center.y}
              r={(shape.sizeM / 2) * projectScale(metrics) + 8}
              fill="none"
              stroke="#ffd166"
              strokeWidth={3}
              strokeDasharray="8 6"
            />
          );
        }

        const square = renderSquare(shape, metrics);
        return (
          <rect
            pointerEvents="none"
            x={square.x - 8}
            y={square.y - 8}
            width={square.width + 16}
            height={square.height + 16}
            fill="none"
            stroke="#ffd166"
            strokeWidth={3}
            strokeDasharray="8 6"
          />
        );
      }
      case "slab": {
        const slab = project.slabs.find((item) => item.id === currentSelection.id);
        const levelStyle = slab ? getLevelStyle(project, slab.levelId, activeLevelId) : null;
        if (!slab || !levelStyle) {
          return null;
        }

        const outline = renderSlabOutline(slab, metrics);
        if (outline.kind === "circle") {
          return (
            <circle
              pointerEvents="none"
              cx={outline.center.x}
              cy={outline.center.y}
              r={outline.radius + 8}
              fill="none"
              stroke="#ffd166"
              strokeWidth={3}
              strokeDasharray="10 6"
            />
          );
        }

        return (
          <rect
            pointerEvents="none"
            x={outline.x - 8}
            y={outline.y - 8}
            width={outline.width + 16}
            height={outline.height + 16}
            fill="none"
            stroke="#ffd166"
            strokeWidth={3}
            strokeDasharray="10 6"
          />
        );
      }
      case "roofEdge": {
        const sketch = project.roofSketches.find((candidate) =>
          candidate.edges.some((edge) => edge.id === currentSelection.id),
        );
        const edge = sketch?.edges.find((candidate) => candidate.id === currentSelection.id);
        if (!sketch || !edge) {
          return null;
        }

        const startVertex = sketch.vertices.find((vertex) => vertex.id === edge.startVertexId);
        const endVertex = sketch.vertices.find((vertex) => vertex.id === edge.endVertexId);
        if (!startVertex || !endVertex) {
          return null;
        }

        const start = worldToScreen(startVertex.position, metrics);
        const end = worldToScreen(endVertex.position, metrics);
        return (
          <line
            pointerEvents="none"
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            stroke="rgba(255, 209, 102, 0.42)"
            strokeWidth={14}
            strokeLinecap="round"
          />
        );
      }
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
        if (points.length < 3) {
          return null;
        }

        return (
          <path
            pointerEvents="none"
            d={`${createSvgPathFromPoints(points, metrics)} Z`}
            fill="rgba(255, 209, 102, 0.10)"
            stroke="rgba(255, 209, 102, 0.55)"
            strokeWidth={4}
            strokeLinejoin="round"
            strokeDasharray="12 7"
          />
        );
      }
      case "externalModel": {
        const model = project.externalModels.find((item) => item.id === currentSelection.id);
        const levelStyle = model ? getLevelStyle(project, model.levelId, activeLevelId) : null;
        if (!model || !levelStyle) {
          return null;
        }

        const point = worldToScreen(model.position, metrics);
        return (
          <g pointerEvents="none">
            <circle
              cx={point.x}
              cy={point.y}
              r={16}
              fill="none"
              stroke="#ffd166"
              strokeWidth={3}
            />
            <circle
              cx={point.x}
              cy={point.y}
              r={22}
              fill="none"
              stroke="rgba(255, 209, 102, 0.45)"
              strokeWidth={2}
              strokeDasharray="8 6"
            />
          </g>
        );
      }
    }
  }

  return (
    <div
      ref={rootRef}
      className="viewport-scene"
      onPointerDownCapture={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onContextMenu={(event) => event.preventDefault()}
      onPointerLeave={() => {
        if (!dragState) {
          onCursorWorldChange(null);
        }
      }}
      onPointerCancel={() => {
        if (dragState?.kind === "move" || dragState?.kind === "roofVertex") {
          onMoveInteractionCancel();
        }
        setDragState(null);
        setPlacementDraft(null);
        onCursorWorldChange(null);
      }}
      onClick={handleBackgroundClick}
    >
      {size.width > 0 && size.height > 0 ? (
        <svg className="viewport-svg" width={size.width} height={size.height}>
          {gridLines !== null
            ? gridLines.vertical.map((x) => {
                const start = worldToScreen(createVec2(x, bounds!.minY), metrics);
                const end = worldToScreen(createVec2(x, bounds!.maxY), metrics);
                const isAxis = Math.abs(x) < project.settings.gridSpacingM * 0.25;

                return (
                  <line
                    key={`grid-x-${x}`}
                    x1={start.x}
                    y1={start.y}
                    x2={end.x}
                    y2={end.y}
                    stroke={isAxis ? "#4fa0dc" : "rgba(164, 185, 198, 0.22)"}
                    strokeWidth={isAxis ? project.settings.axisLineWidthPx : project.settings.gridLineWidthPx}
                  />
                );
              })
            : null}

          {gridLines !== null
            ? gridLines.horizontal.map((y) => {
                const start = worldToScreen(createVec2(bounds!.minX, y), metrics);
                const end = worldToScreen(createVec2(bounds!.maxX, y), metrics);
                const isAxis = Math.abs(y) < project.settings.gridSpacingM * 0.25;

                return (
                  <line
                    key={`grid-y-${y}`}
                    x1={start.x}
                    y1={start.y}
                    x2={end.x}
                    y2={end.y}
                    stroke={isAxis ? "#df8e52" : "rgba(164, 185, 198, 0.22)"}
                    strokeWidth={isAxis ? project.settings.axisLineWidthPx : project.settings.gridLineWidthPx}
                  />
                );
              })
            : null}

          {project.walls.map(renderWall)}
          {renderRoofSketchFaces()}
          {project.slabs.map(renderSlab)}
          {renderRoofOpenings()}
          {renderRoofSketchEdges()}
          {project.shapes.map(renderShape)}
          {project.externalModels.map(renderExternalModel)}
          {project.doors.map(renderDoor)}
          {project.windows.map(renderWindow)}
          {project.measurements.map(renderMeasurement)}
          {project.stairs.map(renderStair)}
          {project.nodes.map(renderNode)}
          {renderSelectionOverlay()}

          {dragState?.kind === "select" ? (
            <rect
              pointerEvents="none"
              x={worldToScreen(getPlacementBounds(dragState.startWorld, dragState.currentWorld).centerWorld, metrics).x - (getPlacementBounds(dragState.startWorld, dragState.currentWorld).widthM * projectScale(metrics)) / 2}
              y={worldToScreen(getPlacementBounds(dragState.startWorld, dragState.currentWorld).centerWorld, metrics).y - (getPlacementBounds(dragState.startWorld, dragState.currentWorld).depthM * projectScale(metrics)) / 2}
              width={getPlacementBounds(dragState.startWorld, dragState.currentWorld).widthM * projectScale(metrics)}
              height={getPlacementBounds(dragState.startWorld, dragState.currentWorld).depthM * projectScale(metrics)}
              fill="rgba(255, 209, 102, 0.12)"
              stroke="#ffd166"
              strokeDasharray="8 6"
              strokeWidth={2}
            />
          ) : null}

          {activeTool === "Wall" && pendingWallStartNode && snappedCursor ? (
            <line
              pointerEvents="none"
              x1={worldToScreen(pendingWallStartNode.position, metrics).x}
              y1={worldToScreen(pendingWallStartNode.position, metrics).y}
              x2={worldToScreen(snappedCursor, metrics).x}
              y2={worldToScreen(snappedCursor, metrics).y}
              stroke="#ffd166"
              strokeWidth={3}
              strokeDasharray="8 6"
              strokeLinecap="round"
            />
          ) : null}

          {activeTool === "Wall" && wallPlacementDraft && wallPlacementDraft.hasDragged ? (
            <g pointerEvents="none">
              <line
                x1={worldToScreen(wallPlacementDraft.startWorld, metrics).x}
                y1={worldToScreen(wallPlacementDraft.startWorld, metrics).y}
                x2={worldToScreen(wallPlacementDraft.currentWorld, metrics).x}
                y2={worldToScreen(wallPlacementDraft.currentWorld, metrics).y}
                stroke="#ffd166"
                strokeWidth={3}
                strokeDasharray="8 6"
                strokeLinecap="round"
              />
              <circle
                cx={worldToScreen(wallPlacementDraft.startWorld, metrics).x}
                cy={worldToScreen(wallPlacementDraft.startWorld, metrics).y}
                r={project.settings.nodeRadiusPx * 0.74}
                fill="rgba(255, 209, 102, 0.16)"
                stroke="#ffde9a"
                strokeWidth={2}
              />
              <circle
                cx={worldToScreen(wallPlacementDraft.currentWorld, metrics).x}
                cy={worldToScreen(wallPlacementDraft.currentWorld, metrics).y}
                r={project.settings.nodeRadiusPx * 0.7}
                fill="rgba(255, 209, 102, 0.18)"
                stroke="#ffd166"
                strokeDasharray="6 4"
                strokeWidth={2}
              />
              <g
                transform={`translate(${worldToScreen(wallPlacementDraft.currentWorld, metrics).x + 14} ${worldToScreen(wallPlacementDraft.currentWorld, metrics).y - 18})`}
              >
                {(() => {
                  const deltaX = wallPlacementDraft.currentWorld.x - wallPlacementDraft.startWorld.x;
                  const deltaY = wallPlacementDraft.currentWorld.y - wallPlacementDraft.startWorld.y;
                  const distanceM = Math.hypot(deltaX, deltaY);
                  const label = `dx ${formatDistance(deltaX)}  dy ${formatDistance(deltaY)}  d ${formatDistance(distanceM)}`;
                  const labelWidth = label.length * 6.4 + 18;

                  return (
                    <>
                      <rect
                        x={0}
                        y={-20}
                        width={labelWidth}
                        height={28}
                        rx={10}
                        fill="rgba(8, 12, 22, 0.88)"
                        stroke="rgba(255, 209, 102, 0.42)"
                        strokeWidth={1}
                      />
                      <text
                        x={10}
                        y={-2}
                        fill="#f8f6f2"
                        fontSize={12}
                        fontFamily="Aptos, Segoe UI Variable, sans-serif"
                      >
                        {label}
                      </text>
                    </>
                  );
                })()}
              </g>
            </g>
          ) : null}

          {activeTool === "Measure" && measurePlacementDraft ? (
            <g pointerEvents="none">
              <line
                x1={worldToScreen(measurePlacementDraft.startWorld, metrics).x}
                y1={worldToScreen(measurePlacementDraft.startWorld, metrics).y}
                x2={worldToScreen(measurePlacementDraft.currentWorld, metrics).x}
                y2={worldToScreen(measurePlacementDraft.currentWorld, metrics).y}
                stroke="#ffd166"
                strokeWidth={2.5}
                strokeDasharray="8 6"
                strokeLinecap="round"
              />
              <circle
                cx={worldToScreen(measurePlacementDraft.startWorld, metrics).x}
                cy={worldToScreen(measurePlacementDraft.startWorld, metrics).y}
                r={project.settings.nodeRadiusPx * 0.4}
                fill="rgba(255, 209, 102, 0.16)"
                stroke="#ffde9a"
                strokeWidth={2}
              />
              <circle
                cx={worldToScreen(measurePlacementDraft.currentWorld, metrics).x}
                cy={worldToScreen(measurePlacementDraft.currentWorld, metrics).y}
                r={project.settings.nodeRadiusPx * 0.38}
                fill="rgba(255, 209, 102, 0.18)"
                stroke="#ffd166"
                strokeDasharray="6 4"
                strokeWidth={2}
              />
              <g
                transform={`translate(${worldToScreen(measurePlacementDraft.currentWorld, metrics).x + 14} ${worldToScreen(measurePlacementDraft.currentWorld, metrics).y - 18})`}
              >
                {(() => {
                  const deltaX = measurePlacementDraft.currentWorld.x - measurePlacementDraft.startWorld.x;
                  const deltaY = measurePlacementDraft.currentWorld.y - measurePlacementDraft.startWorld.y;
                  const distanceM = Math.hypot(deltaX, deltaY);
                  const label = `dx ${formatMeasurementDistance(deltaX, measureToolUnit)}  dy ${formatMeasurementDistance(deltaY, measureToolUnit)}  d ${formatMeasurementDistance(distanceM, measureToolUnit)}`;
                  const labelWidth = label.length * 6.4 + 18;

                  return (
                    <>
                      <rect
                        x={0}
                        y={-20}
                        width={labelWidth}
                        height={28}
                        rx={10}
                        fill="rgba(8, 12, 22, 0.88)"
                        stroke="rgba(255, 209, 102, 0.42)"
                        strokeWidth={1}
                      />
                      <text
                        x={10}
                        y={-2}
                        fill="#f8f6f2"
                        fontSize={12}
                        fontFamily="Aptos, Segoe UI Variable, sans-serif"
                      >
                        {label}
                      </text>
                    </>
                  );
                })()}
              </g>
            </g>
          ) : null}

          {activeTool === "Roof" && roofLinePlacementDraft ? (
            <g pointerEvents="none">
              <line
                x1={worldToScreen(roofLinePlacementDraft.startWorld, metrics).x}
                y1={worldToScreen(roofLinePlacementDraft.startWorld, metrics).y}
                x2={worldToScreen(roofLinePlacementDraft.currentWorld, metrics).x}
                y2={worldToScreen(roofLinePlacementDraft.currentWorld, metrics).y}
                stroke="#d9965a"
                strokeWidth={3}
                strokeDasharray="8 6"
                strokeLinecap="round"
              />
              <circle
                cx={worldToScreen(roofLinePlacementDraft.startWorld, metrics).x}
                cy={worldToScreen(roofLinePlacementDraft.startWorld, metrics).y}
                r={project.settings.nodeRadiusPx * 0.42}
                fill="rgba(217, 150, 90, 0.18)"
                stroke="#f1b879"
                strokeWidth={2}
              />
              <circle
                cx={worldToScreen(roofLinePlacementDraft.currentWorld, metrics).x}
                cy={worldToScreen(roofLinePlacementDraft.currentWorld, metrics).y}
                r={project.settings.nodeRadiusPx * 0.4}
                fill="rgba(217, 150, 90, 0.2)"
                stroke="#d9965a"
                strokeDasharray="6 4"
                strokeWidth={2}
              />
              <g
                transform={`translate(${worldToScreen(roofLinePlacementDraft.currentWorld, metrics).x + 14} ${worldToScreen(roofLinePlacementDraft.currentWorld, metrics).y - 18})`}
              >
                {(() => {
                  const deltaX = roofLinePlacementDraft.currentWorld.x - roofLinePlacementDraft.startWorld.x;
                  const deltaY = roofLinePlacementDraft.currentWorld.y - roofLinePlacementDraft.startWorld.y;
                  const distanceM = Math.hypot(deltaX, deltaY);
                  const label = `roof line ${formatDistance(distanceM)}`;
                  const labelWidth = label.length * 6.4 + 18;

                  return (
                    <>
                      <rect
                        x={0}
                        y={-20}
                        width={labelWidth}
                        height={28}
                        rx={10}
                        fill="rgba(8, 12, 22, 0.88)"
                        stroke="rgba(217, 150, 90, 0.48)"
                        strokeWidth={1}
                      />
                      <text
                        x={10}
                        y={-2}
                        fill="#f8f6f2"
                        fontSize={12}
                        fontFamily="Aptos, Segoe UI Variable, sans-serif"
                      >
                        {label}
                      </text>
                    </>
                  );
                })()}
              </g>
            </g>
          ) : null}

          {activeTool === "Stair" && stairDraftPoints.length > 0 ? (
            <g pointerEvents="none">
              <path
                d={createSvgPathFromPoints(
                  snappedCursor ? [...stairDraftPoints, snappedCursor] : stairDraftPoints,
                  metrics,
                )}
                fill="none"
                stroke="rgba(116, 198, 249, 0.22)"
                strokeWidth={Math.max(10, stairToolWidthPx)}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <path
                d={createSvgPathFromPoints(
                  snappedCursor ? [...stairDraftPoints, snappedCursor] : stairDraftPoints,
                  metrics,
                )}
                fill="none"
                stroke="#8fd6ff"
                strokeWidth={Math.max(2, stairToolWidthPx * 0.18)}
                strokeDasharray="10 6"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {stairDraftPoints.map((point, index) => {
                const screenPoint = worldToScreen(point, metrics);
                return (
                  <circle
                    key={`stair-draft-${index}`}
                    cx={screenPoint.x}
                    cy={screenPoint.y}
                    r={index === 0 ? 6 : 4.5}
                    fill="#dff4ff"
                    stroke="#5ea8d6"
                    strokeWidth={2}
                  />
                );
              })}
            </g>
          ) : null}

          {activeTool === "Node" && activeLevelId && snappedCursor ? (
            nodePlacementDraft ? (
              <g pointerEvents="none">
                {!hasSamePosition(nodePlacementDraft.startWorld, nodePlacementDraft.currentWorld) ? (
                  <>
                    <line
                      x1={worldToScreen(nodePlacementDraft.startWorld, metrics).x}
                      y1={worldToScreen(nodePlacementDraft.startWorld, metrics).y}
                      x2={worldToScreen(nodePlacementDraft.currentWorld, metrics).x}
                      y2={worldToScreen(nodePlacementDraft.currentWorld, metrics).y}
                      stroke="#ffd166"
                      strokeWidth={2.5}
                      strokeDasharray="8 6"
                      strokeLinecap="round"
                    />
                    <circle
                      cx={worldToScreen(nodePlacementDraft.startWorld, metrics).x}
                      cy={worldToScreen(nodePlacementDraft.startWorld, metrics).y}
                      r={project.settings.nodeRadiusPx * 0.78}
                      fill="rgba(255, 209, 102, 0.16)"
                      stroke="#ffde9a"
                      strokeWidth={2}
                    />
                    <g
                      transform={`translate(${worldToScreen(nodePlacementDraft.currentWorld, metrics).x + 14} ${worldToScreen(nodePlacementDraft.currentWorld, metrics).y - 18})`}
                    >
                      {(() => {
                        const deltaX = nodePlacementDraft.currentWorld.x - nodePlacementDraft.startWorld.x;
                        const deltaY = nodePlacementDraft.currentWorld.y - nodePlacementDraft.startWorld.y;
                        const distanceM = Math.hypot(deltaX, deltaY);
                        const label = `dx ${formatDistance(deltaX)}  dy ${formatDistance(deltaY)}  d ${formatDistance(distanceM)}`;
                        const labelWidth = label.length * 6.4 + 18;

                        return (
                          <>
                            <rect
                              x={0}
                              y={-20}
                              width={labelWidth}
                              height={28}
                              rx={10}
                              fill="rgba(8, 12, 22, 0.88)"
                              stroke="rgba(255, 209, 102, 0.42)"
                              strokeWidth={1}
                            />
                            <text
                              x={10}
                              y={-2}
                              fill="#f8f6f2"
                              fontSize={12}
                              fontFamily="Aptos, Segoe UI Variable, sans-serif"
                            >
                              {label}
                            </text>
                          </>
                        );
                      })()}
                    </g>
                  </>
                ) : null}
                <circle
                  cx={worldToScreen(nodePlacementDraft.currentWorld, metrics).x}
                  cy={worldToScreen(nodePlacementDraft.currentWorld, metrics).y}
                  r={project.settings.nodeRadiusPx * 0.72}
                  fill="rgba(255, 209, 102, 0.18)"
                  stroke="#ffd166"
                  strokeDasharray="6 4"
                  strokeWidth={2}
                />
              </g>
            ) : (
              <circle
                pointerEvents="none"
                cx={worldToScreen(snappedCursor, metrics).x}
                cy={worldToScreen(snappedCursor, metrics).y}
                r={project.settings.nodeRadiusPx * 0.7}
                fill="rgba(255, 209, 102, 0.18)"
                stroke="#ffd166"
                strokeDasharray="6 4"
                strokeWidth={2}
              />
            )
          ) : null}

          {activeTool === "Shape" && activeLevelId && placementDraftBounds ? (
              <rect
                pointerEvents="none"
                x={
                  worldToScreen(placementDraftBounds.centerWorld, metrics).x -
                  (Math.max(
                    placementDraftBounds.widthM,
                    placementDraftBounds.depthM,
                    project.settings.snapToGrid ? project.settings.gridSpacingM : 0.2,
                  ) *
                    projectScale(metrics)) /
                    2
                }
                y={
                  worldToScreen(placementDraftBounds.centerWorld, metrics).y -
                  (Math.max(
                    placementDraftBounds.widthM,
                    placementDraftBounds.depthM,
                    project.settings.snapToGrid ? project.settings.gridSpacingM : 0.2,
                  ) *
                    projectScale(metrics)) /
                    2
                }
                width={
                  Math.max(
                    placementDraftBounds.widthM,
                    placementDraftBounds.depthM,
                    project.settings.snapToGrid ? project.settings.gridSpacingM : 0.2,
                  ) * projectScale(metrics)
                }
                height={
                  Math.max(
                    placementDraftBounds.widthM,
                    placementDraftBounds.depthM,
                    project.settings.snapToGrid ? project.settings.gridSpacingM : 0.2,
                  ) * projectScale(metrics)
                }
                fill="rgba(127, 209, 185, 0.12)"
                stroke="#7fd1b9"
                strokeDasharray="6 4"
                strokeWidth={2}
              />
            
          ) : null}

          {activeTool === "Slab" && activeLevelId ? (
            placementDraftCircle ? (
              <circle
                pointerEvents="none"
                cx={worldToScreen(placementDraftCircle.centerWorld, metrics).x}
                cy={worldToScreen(placementDraftCircle.centerWorld, metrics).y}
                r={
                  (Math.max(
                    placementDraftCircle.radiusM,
                    (project.settings.snapToGrid ? project.settings.gridSpacingM : 0.2) / 2,
                  )) * projectScale(metrics)
                }
                fill="rgba(96, 181, 127, 0.08)"
                stroke="#60b57f"
                strokeDasharray="8 6"
                strokeWidth={2}
              />
            ) : placementDraftBounds ? (
              slabMode === "Circle" ? (
                <circle
                  pointerEvents="none"
                  cx={worldToScreen(placementDraftBounds.centerWorld, metrics).x}
                  cy={worldToScreen(placementDraftBounds.centerWorld, metrics).y}
                  r={
                    (Math.max(
                      placementDraftBounds.widthM,
                      placementDraftBounds.depthM,
                      project.settings.snapToGrid ? project.settings.gridSpacingM : 0.2,
                    ) /
                      2) *
                    projectScale(metrics)
                  }
                  fill="rgba(96, 181, 127, 0.08)"
                  stroke="#60b57f"
                  strokeDasharray="8 6"
                  strokeWidth={2}
                />
              ) : (
                <rect
                  pointerEvents="none"
                  x={
                    worldToScreen(placementDraftBounds.centerWorld, metrics).x -
                    (Math.max(
                      placementDraftBounds.widthM,
                      project.settings.snapToGrid ? project.settings.gridSpacingM : 0.2,
                    ) *
                      projectScale(metrics)) /
                      2
                  }
                  y={
                    worldToScreen(placementDraftBounds.centerWorld, metrics).y -
                    (Math.max(
                      placementDraftBounds.depthM,
                      project.settings.snapToGrid ? project.settings.gridSpacingM : 0.2,
                    ) *
                      projectScale(metrics)) /
                      2
                  }
                  width={
                    Math.max(
                      placementDraftBounds.widthM,
                      project.settings.snapToGrid ? project.settings.gridSpacingM : 0.2,
                    ) * projectScale(metrics)
                  }
                  height={
                    Math.max(
                      placementDraftBounds.depthM,
                      project.settings.snapToGrid ? project.settings.gridSpacingM : 0.2,
                    ) * projectScale(metrics)
                  }
                  fill="rgba(96, 181, 127, 0.08)"
                  stroke="#60b57f"
                  strokeDasharray="8 6"
                  strokeWidth={2}
                />
              )
            ) : null
          ) : null}

          {activeTool === "Model" && activeLevelId && snappedCursor ? (
            <g pointerEvents="none">
              <circle
                cx={worldToScreen(snappedCursor, metrics).x}
                cy={worldToScreen(snappedCursor, metrics).y}
                r={8}
                fill="rgba(255, 139, 94, 0.18)"
                stroke="#ff8b5e"
                strokeDasharray="4 4"
                strokeWidth={2}
              />
              <line
                x1={worldToScreen(snappedCursor, metrics).x - 12}
                y1={worldToScreen(snappedCursor, metrics).y}
                x2={worldToScreen(snappedCursor, metrics).x + 12}
                y2={worldToScreen(snappedCursor, metrics).y}
                stroke="#ffb18c"
                strokeWidth={1.5}
              />
              <line
                x1={worldToScreen(snappedCursor, metrics).x}
                y1={worldToScreen(snappedCursor, metrics).y - 12}
                x2={worldToScreen(snappedCursor, metrics).x}
                y2={worldToScreen(snappedCursor, metrics).y + 12}
                stroke="#ffb18c"
                strokeWidth={1.5}
              />
            </g>
          ) : null}
        </svg>
      ) : null}
    </div>
  );
}
