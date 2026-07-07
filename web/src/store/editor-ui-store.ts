import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Project, Vec2 } from "../domain/project-model";
import { createVec2 } from "../domain/project-model";

export type EditorTool =
  | "Move"
  | "Node"
  | "Wall"
  | "Measure"
  | "Door"
  | "Window"
  | "Stair"
  | "Shape"
  | "Slab"
  | "Roof"
  | "RoofOpening"
  | "RoofWindow"
  | "Model"
  | "Ground"
  | "Rooms";
export type ViewportMode = "2d" | "3d";
export type WallAuthoringMode = "AutoWall" | "Topology";
export type SelectableEntityKind =
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
  | "groundSurface"
  | "room"
  | "externalModel";
export type SlabMode = "Rectangle" | "Circle";

export interface EditorSelection {
  kind: SelectableEntityKind;
  id: string;
}

export interface PanelVisibility {
  inspectorOpen: boolean;
  statusBarVisible: boolean;
  helpCardOpen: boolean;
}

export interface ViewportState {
  zoom: number;
  pan: Vec2;
  cursorWorld: Vec2 | null;
}

export interface StoredViewportState {
  zoom: number;
  pan: Vec2;
}

export interface ViewportPreset {
  id: string;
  label: string;
  viewport: StoredViewportState | null;
}

export type Preview3DRenderMode = "ArchitecturalJoin" | "NodePost";
export type Preview3DSurfaceMode = "LevelColor" | "GrayOpaque";
export type Preview3DCameraMode = "Orbit" | "FreeOrbit" | "FreeCamera";

export interface Preview3DState {
  cameraMode: Preview3DCameraMode;
  yawDeg: number;
  pitchDeg: number;
  distanceMultiplier: number;
  targetOffset: [number, number, number];
  cameraPositionOffset: [number, number, number] | null;
  renderMode: Preview3DRenderMode;
  surfaceMode: Preview3DSurfaceMode;
}

export interface EditorUiState {
  viewportMode: ViewportMode;
  wallAuthoringMode: WallAuthoringMode;
  activeTool: EditorTool;
  activeLevelId: string | null;
  activeRoofLayerId: string | null;
  activeWallTypeId: string | null;
  hiddenLevelIds2D: string[];
  hiddenLevelIds3D: string[];
  hiddenRoofLayerIds2D: string[];
  hiddenRoofLayerIds3D: string[];
  currentSelection: EditorSelection | null;
  selectionSet: EditorSelection[];
  pendingWallStartNodeId: string | null;
  slabMode: SlabMode;
  panelVisibility: PanelVisibility;
  viewport: ViewportState;
  preview3D: Preview3DState;
  viewportPresets: ViewportPreset[];
  setViewportMode: (mode: ViewportMode) => void;
  setWallAuthoringMode: (mode: WallAuthoringMode) => void;
  setActiveTool: (tool: EditorTool) => void;
  setActiveLevelId: (levelId: string | null) => void;
  setActiveRoofLayerId: (roofLayerId: string | null) => void;
  setActiveWallTypeId: (wallTypeId: string | null) => void;
  toggleLevelVisibility: (levelId: string, mode?: ViewportMode) => void;
  toggleRoofLayerVisibility: (roofLayerId: string, mode?: ViewportMode) => void;
  setCurrentSelection: (selection: EditorSelection | null) => void;
  setSelectionSet: (
    selectionSet: EditorSelection[],
    primarySelection?: EditorSelection | null,
  ) => void;
  clearSelection: () => void;
  setPendingWallStartNodeId: (nodeId: string | null) => void;
  clearPendingWallStartNodeId: () => void;
  setSlabMode: (mode: SlabMode) => void;
  setInspectorOpen: (isOpen: boolean) => void;
  setStatusBarVisible: (isVisible: boolean) => void;
  setHelpCardOpen: (isOpen: boolean) => void;
  setZoom: (zoom: number) => void;
  setPan: (pan: Vec2) => void;
  panBy: (delta: Vec2) => void;
  setCursorWorld: (cursorWorld: Vec2 | null) => void;
  setPreview3D: (preview: Partial<Preview3DState>) => void;
  resetPreview3D: () => void;
  resetViewport: () => void;
  saveViewportPreset: (presetId: string) => void;
  applyViewportPreset: (presetId: string) => void;
  clearViewportPreset: (presetId: string) => void;
  resetEditorUi: () => void;
  syncWithProject: (project: Project) => void;
}

const DEFAULT_EDITOR_TOOL: EditorTool = "Move";
const DEFAULT_SLAB_MODE: SlabMode = "Rectangle";
const DEFAULT_VIEWPORT_MODE: ViewportMode = "2d";
const DEFAULT_WALL_AUTHORING_MODE: WallAuthoringMode = "AutoWall";

const defaultViewport = (): ViewportState => ({
  zoom: 1,
  pan: createVec2(),
  cursorWorld: null,
});

const defaultPreview3D = (): Preview3DState => ({
  cameraMode: "Orbit",
  yawDeg: -35,
  pitchDeg: 28,
  distanceMultiplier: 2.8,
  targetOffset: [0, 0, 0],
  cameraPositionOffset: null,
  renderMode: "ArchitecturalJoin",
  surfaceMode: "LevelColor",
});

const defaultPanelVisibility = (): PanelVisibility => ({
  inspectorOpen: true,
  statusBarVisible: true,
  helpCardOpen: true,
});

const defaultViewportPresets = (): ViewportPreset[] => [
  { id: "preset_1", label: "Preset 1", viewport: null },
  { id: "preset_2", label: "Preset 2", viewport: null },
  { id: "preset_3", label: "Preset 3", viewport: null },
];

function isSelectionValid(selection: EditorSelection | null, project: Project) {
  if (!selection) {
    return true;
  }

  switch (selection.kind) {
    case "node":
      return project.nodes.some((node) => node.id === selection.id);
    case "wall":
      return project.walls.some((wall) => wall.id === selection.id);
    case "measure":
      return project.measurements.some((measurement) => measurement.id === selection.id);
    case "shape":
      return project.shapes.some((shape) => shape.id === selection.id);
    case "slab":
      return project.slabs.some((slab) => slab.id === selection.id);
    case "groundSurface":
      return project.groundSurfaces.some((groundSurface) => groundSurface.id === selection.id);
    case "room":
      return project.rooms.some((room) => room.id === selection.id);
    case "roofEdge":
      return project.roofSketches.some((sketch) =>
        sketch.edges.some((edge) => edge.id === selection.id),
      );
    case "roofFace":
      return project.roofSketches.some((sketch) =>
        sketch.faces.some((face) => face.id === selection.id),
      );
    case "roofOpening":
      return project.roofOpenings.some((opening) => opening.id === selection.id);
    case "door":
      return project.doors.some((door) => door.id === selection.id);
    case "window":
      return project.windows.some((windowOpening) => windowOpening.id === selection.id);
    case "stair":
      return project.stairs.some((stair) => stair.id === selection.id);
    case "externalModel":
      return project.externalModels.some((model) => model.id === selection.id);
    default:
      return false;
  }
}

function isSelectionCompatibleWithTool(selection: EditorSelection | null, tool: EditorTool) {
  if (!selection) {
    return true;
  }

  switch (tool) {
    case "Move":
      return selection.kind !== "wall" && selection.kind !== "stair" && selection.kind !== "roofFace";
    case "Node":
      return selection.kind === "node";
    case "Wall":
      return selection.kind === "node" || selection.kind === "wall";
    case "Measure":
      return selection.kind === "measure";
    case "Door":
      return selection.kind === "wall" || selection.kind === "door";
    case "Window":
      return selection.kind === "wall" || selection.kind === "window";
    case "Stair":
      return selection.kind === "stair";
    case "Shape":
      return selection.kind === "shape";
    case "Slab":
      return selection.kind === "slab";
    case "Roof":
      return selection.kind === "roofEdge" || selection.kind === "roofFace";
    case "RoofOpening":
      return selection.kind === "roofFace" || selection.kind === "roofOpening";
    case "RoofWindow":
      return selection.kind === "roofOpening";
    case "Model":
      return selection.kind === "externalModel";
    case "Ground":
      return selection.kind === "groundSurface";
    case "Rooms":
      return selection.kind === "room";
  }
}

function dedupeSelectionSet(selectionSet: EditorSelection[]) {
  const seen = new Set<string>();
  return selectionSet.filter((selection) => {
    const key = `${selection.kind}:${selection.id}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function isSelectionSetCompatibleWithTool(selectionSet: EditorSelection[], tool: EditorTool) {
  return selectionSet.filter((selection) => isSelectionCompatibleWithTool(selection, tool));
}

function getValidSelectionSet(selectionSet: EditorSelection[], project: Project) {
  return dedupeSelectionSet(selectionSet).filter((selection) => isSelectionValid(selection, project));
}

export const useEditorUiStore = create<EditorUiState>()(
  persist(
    (set, get) => ({
      viewportMode: DEFAULT_VIEWPORT_MODE,
      wallAuthoringMode: DEFAULT_WALL_AUTHORING_MODE,
      activeTool: DEFAULT_EDITOR_TOOL,
      activeLevelId: null,
      activeRoofLayerId: null,
      activeWallTypeId: null,
      hiddenLevelIds2D: [],
      hiddenLevelIds3D: [],
      hiddenRoofLayerIds2D: [],
      hiddenRoofLayerIds3D: [],
      currentSelection: null,
      selectionSet: [],
      pendingWallStartNodeId: null,
      slabMode: DEFAULT_SLAB_MODE,
      panelVisibility: defaultPanelVisibility(),
      viewport: defaultViewport(),
      preview3D: defaultPreview3D(),
      viewportPresets: defaultViewportPresets(),

      setViewportMode: (mode) => {
        set({ viewportMode: mode });
      },

      setWallAuthoringMode: (mode) => {
        set((state) => ({
          wallAuthoringMode: mode,
          activeTool:
            mode === "AutoWall" && state.activeTool === "Node" ? "Wall" : state.activeTool,
        }));
      },

      setActiveTool: (tool) => {
        const state = get();
        const nextSelectionSet = isSelectionSetCompatibleWithTool(state.selectionSet, tool);
        const nextCurrentSelection =
          state.currentSelection && isSelectionCompatibleWithTool(state.currentSelection, tool)
            ? state.currentSelection
            : (nextSelectionSet[0] ?? null);
        set({
          activeTool: tool,
          currentSelection: nextCurrentSelection,
          selectionSet: nextSelectionSet,
          pendingWallStartNodeId: tool === "Wall" ? state.pendingWallStartNodeId : null,
        });
      },

      setActiveLevelId: (levelId) => {
        set({ activeLevelId: levelId, activeRoofLayerId: null });
      },

      setActiveRoofLayerId: (roofLayerId) => {
        set({ activeRoofLayerId: roofLayerId, activeLevelId: roofLayerId ? null : get().activeLevelId });
      },

      setActiveWallTypeId: (wallTypeId) => {
        set({ activeWallTypeId: wallTypeId });
      },

      toggleLevelVisibility: (levelId, mode) => {
        set((state) => {
          const targetMode = mode ?? state.viewportMode;
          const key = targetMode === "3d" ? "hiddenLevelIds3D" : "hiddenLevelIds2D";
          const currentIds = state[key];
          return {
            [key]: currentIds.includes(levelId)
              ? currentIds.filter((id) => id !== levelId)
              : [...currentIds, levelId],
          } satisfies Partial<EditorUiState>;
        });
      },

      toggleRoofLayerVisibility: (roofLayerId, mode) => {
        set((state) => {
          const targetMode = mode ?? state.viewportMode;
          const key = targetMode === "3d" ? "hiddenRoofLayerIds3D" : "hiddenRoofLayerIds2D";
          const currentIds = state[key];
          return {
            [key]: currentIds.includes(roofLayerId)
              ? currentIds.filter((id) => id !== roofLayerId)
              : [...currentIds, roofLayerId],
          } satisfies Partial<EditorUiState>;
        });
      },

      setCurrentSelection: (selection) => {
        set({
          currentSelection: selection,
          selectionSet: selection ? [selection] : [],
        });
      },

      setSelectionSet: (selectionSet, primarySelection = selectionSet[0] ?? null) => {
        const nextSelectionSet = dedupeSelectionSet(selectionSet);
        const nextPrimarySelection =
          primarySelection &&
          nextSelectionSet.some(
            (selection) =>
              selection.kind === primarySelection.kind && selection.id === primarySelection.id,
          )
            ? primarySelection
            : (nextSelectionSet[0] ?? null);

        set({
          currentSelection: nextPrimarySelection,
          selectionSet: nextSelectionSet,
        });
      },

      clearSelection: () => {
        set({ currentSelection: null, selectionSet: [] });
      },

      setPendingWallStartNodeId: (nodeId) => {
        set({ pendingWallStartNodeId: nodeId });
      },

      clearPendingWallStartNodeId: () => {
        set({ pendingWallStartNodeId: null });
      },

      setSlabMode: (mode) => {
        set({ slabMode: mode });
      },

      setInspectorOpen: (isOpen) => {
        set((state) => ({
          panelVisibility: {
            ...state.panelVisibility,
            inspectorOpen: isOpen,
          },
        }));
      },

      setStatusBarVisible: (isVisible) => {
        set((state) => ({
          panelVisibility: {
            ...state.panelVisibility,
            statusBarVisible: isVisible,
          },
        }));
      },

      setHelpCardOpen: (isOpen) => {
        set((state) => ({
          panelVisibility: {
            ...state.panelVisibility,
            helpCardOpen: isOpen,
          },
        }));
      },

      setZoom: (zoom) => {
        set((state) => ({
          viewport: {
            ...state.viewport,
            zoom: Math.max(0.1, zoom),
          },
        }));
      },

      setPan: (pan) => {
        set((state) => ({
          viewport: {
            ...state.viewport,
            pan,
          },
        }));
      },

      panBy: (delta) => {
        set((state) => ({
          viewport: {
            ...state.viewport,
            pan: createVec2(state.viewport.pan.x + delta.x, state.viewport.pan.y + delta.y),
          },
        }));
      },

      setCursorWorld: (cursorWorld) => {
        set((state) => ({
          viewport: {
            ...state.viewport,
            cursorWorld,
          },
        }));
      },

      setPreview3D: (preview) => {
        set((state) => ({
          preview3D: {
            ...state.preview3D,
            ...preview,
          },
        }));
      },

      resetPreview3D: () => {
        set({ preview3D: defaultPreview3D() });
      },

      resetViewport: () => {
        set({ viewport: defaultViewport() });
      },

      saveViewportPreset: (presetId) => {
        const state = get();
        set({
          viewportPresets: state.viewportPresets.map((preset) =>
            preset.id === presetId
              ? {
                  ...preset,
                  viewport: {
                    zoom: state.viewport.zoom,
                    pan: state.viewport.pan,
                  },
                }
              : preset,
          ),
        });
      },

      applyViewportPreset: (presetId) => {
        const preset = get().viewportPresets.find((item) => item.id === presetId);
        if (!preset?.viewport) {
          return;
        }

        set((state) => ({
          viewport: {
            ...state.viewport,
            zoom: preset.viewport!.zoom,
            pan: preset.viewport!.pan,
          },
        }));
      },

      clearViewportPreset: (presetId) => {
        set((state) => ({
          viewportPresets: state.viewportPresets.map((preset) =>
            preset.id === presetId
              ? {
                  ...preset,
                  viewport: null,
                }
              : preset,
          ),
        }));
      },

      resetEditorUi: () => {
        set({
          viewportMode: DEFAULT_VIEWPORT_MODE,
          wallAuthoringMode: DEFAULT_WALL_AUTHORING_MODE,
          activeTool: DEFAULT_EDITOR_TOOL,
          activeLevelId: null,
          activeRoofLayerId: null,
          activeWallTypeId: null,
          hiddenLevelIds2D: [],
          hiddenLevelIds3D: [],
          hiddenRoofLayerIds2D: [],
          hiddenRoofLayerIds3D: [],
          currentSelection: null,
          selectionSet: [],
          pendingWallStartNodeId: null,
          slabMode: DEFAULT_SLAB_MODE,
          panelVisibility: defaultPanelVisibility(),
          viewport: defaultViewport(),
          preview3D: defaultPreview3D(),
          viewportPresets: defaultViewportPresets(),
        });
      },

      syncWithProject: (project) => {
        const state = get();
        const nextRoofLayerId =
          state.activeRoofLayerId &&
          project.roofLayers.some((roofLayer) => roofLayer.id === state.activeRoofLayerId)
            ? state.activeRoofLayerId
            : null;
        const nextLevelId =
          nextRoofLayerId !== null
            ? null
            : state.activeLevelId &&
                project.levels.some((level) => level.id === state.activeLevelId)
              ? state.activeLevelId
              : (project.levels[0]?.id ?? null);
        const nextWallTypeId =
          state.activeWallTypeId &&
          project.wallTypes.some((wallType) => wallType.id === state.activeWallTypeId)
            ? state.activeWallTypeId
            : (project.wallTypes[0]?.id ?? null);
        const nextSelectionSet = getValidSelectionSet(state.selectionSet, project);
        const nextSelection =
          state.currentSelection && isSelectionValid(state.currentSelection, project)
            ? state.currentSelection
            : (nextSelectionSet[0] ?? null);
        const nextPendingWallStartNodeId =
          state.pendingWallStartNodeId &&
          project.nodes.some((node) => node.id === state.pendingWallStartNodeId)
            ? state.pendingWallStartNodeId
            : null;
        const nextHiddenLevelIds2D = state.hiddenLevelIds2D.filter((levelId) =>
          project.levels.some((level) => level.id === levelId),
        );
        const nextHiddenLevelIds3D = state.hiddenLevelIds3D.filter((levelId) =>
          project.levels.some((level) => level.id === levelId),
        );
        const nextHiddenRoofLayerIds2D = state.hiddenRoofLayerIds2D.filter((roofLayerId) =>
          project.roofLayers.some((roofLayer) => roofLayer.id === roofLayerId),
        );
        const nextHiddenRoofLayerIds3D = state.hiddenRoofLayerIds3D.filter((roofLayerId) =>
          project.roofLayers.some((roofLayer) => roofLayer.id === roofLayerId),
        );

        set({
          activeLevelId: nextLevelId,
          activeRoofLayerId: nextRoofLayerId,
          activeWallTypeId: nextWallTypeId,
          hiddenLevelIds2D: nextHiddenLevelIds2D,
          hiddenLevelIds3D: nextHiddenLevelIds3D,
          hiddenRoofLayerIds2D: nextHiddenRoofLayerIds2D,
          hiddenRoofLayerIds3D: nextHiddenRoofLayerIds3D,
          currentSelection: nextSelection,
          selectionSet: nextSelectionSet,
          pendingWallStartNodeId: nextPendingWallStartNodeId,
        });
      },
    }),
    {
      name: "wawod-studio-ui",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        wallAuthoringMode: state.wallAuthoringMode,
        hiddenLevelIds2D: state.hiddenLevelIds2D,
        hiddenLevelIds3D: state.hiddenLevelIds3D,
        hiddenRoofLayerIds2D: state.hiddenRoofLayerIds2D,
        hiddenRoofLayerIds3D: state.hiddenRoofLayerIds3D,
        viewportPresets: state.viewportPresets,
      }),
    },
  ),
);
