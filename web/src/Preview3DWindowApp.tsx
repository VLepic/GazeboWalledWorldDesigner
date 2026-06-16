import { useEffect, useMemo, useState } from "react";
import { FloatingWindow, type FloatingWindowPosition } from "./components/floating-window";
import { ViewportScene3D } from "./components/viewport-scene-3d";
import {
  PREVIEW_SNAPSHOT_STORAGE_KEY,
  PREVIEW_SYNC_CHANNEL,
  readPreviewWindowSnapshot,
  type PreviewWindowMessage,
} from "./domain/preview-window-sync";
import {
  DEFAULT_ROOF_LAYER_ID,
  createEmptyProject,
  createId,
  ensureProjectDefaults,
  type Project,
} from "./domain/project-model";
import { parseProjectJson } from "./domain/project-serialization";
import type { Preview3DState } from "./store/editor-ui-store";

const DEFAULT_PREVIEW_3D: Preview3DState = {
  cameraMode: "Orbit",
  yawDeg: -35,
  pitchDeg: 28,
  distanceMultiplier: 2.8,
  targetOffset: [0, 0, 0],
  cameraPositionOffset: null,
  renderMode: "ArchitecturalJoin",
  surfaceMode: "LevelColor",
};

function loadInitialPreviewState() {
  const snapshot = readPreviewWindowSnapshot();
  return snapshot?.preview3D ?? DEFAULT_PREVIEW_3D;
}

function loadInitialHiddenLevelIds3D() {
  const snapshot = readPreviewWindowSnapshot();
  return snapshot?.hiddenLevelIds3D ?? [];
}

function loadInitialHiddenRoofLayerIds3D() {
  const snapshot = readPreviewWindowSnapshot();
  return snapshot?.hiddenRoofLayerIds3D ?? [];
}

function loadInitialProject() {
  const snapshot = readPreviewWindowSnapshot();
  if (!snapshot) {
    return ensureProjectDefaults(createEmptyProject());
  }

  try {
    return parseProjectJson(snapshot.projectJson).project;
  } catch {
    return ensureProjectDefaults(createEmptyProject());
  }
}

export default function Preview3DWindowApp() {
  const [project, setProject] = useState<Project>(() => loadInitialProject());
  const [preview3D, setPreview3D] = useState<Preview3DState>(() => loadInitialPreviewState());
  const [hiddenLevelIds3D, setHiddenLevelIds3D] = useState<string[]>(() =>
    loadInitialHiddenLevelIds3D(),
  );
  const [hiddenRoofLayerIds3D, setHiddenRoofLayerIds3D] = useState<string[]>(() =>
    loadInitialHiddenRoofLayerIds3D(),
  );
  const [syncStatus, setSyncStatus] = useState("Waiting for editor snapshot...");
  const [settingsWindowPosition, setSettingsWindowPosition] = useState<FloatingWindowPosition>({
    horizontal: "right",
    vertical: "top",
    offsetX: 24,
    offsetY: 24,
  });
  const [levelsWindowPosition, setLevelsWindowPosition] = useState<FloatingWindowPosition>({
    horizontal: "right",
    vertical: "bottom",
    offsetX: 24,
    offsetY: 24,
  });

  const sourceId = useMemo(() => createId("preview_source"), []);
  const hiddenLevelIdSet3D = useMemo(() => new Set(hiddenLevelIds3D), [hiddenLevelIds3D]);
  const hiddenRoofLayerIdSet3D = useMemo(
    () => new Set(hiddenRoofLayerIds3D),
    [hiddenRoofLayerIds3D],
  );
  const defaultRoofLayer =
    project.roofLayers.find((roofLayer) => roofLayer.id === DEFAULT_ROOF_LAYER_ID) ??
    project.roofLayers[0] ??
    null;
  const visibleProject3D = useMemo(() => {
    if (hiddenLevelIdSet3D.size === 0) {
      return project;
    }

    const visibleWalls = project.walls.filter((wall) => !hiddenLevelIdSet3D.has(wall.levelId));
    const visibleWallIdSet = new Set(visibleWalls.map((wall) => wall.id));

    return {
      ...project,
      nodes: project.nodes.filter((node) => !hiddenLevelIdSet3D.has(node.levelId)),
      walls: visibleWalls,
      doors: project.doors.filter((door) => visibleWallIdSet.has(door.wallId)),
      windows: project.windows.filter((windowOpening) => visibleWallIdSet.has(windowOpening.wallId)),
      stairs: project.stairs.filter((stair) => !hiddenLevelIdSet3D.has(stair.levelId)),
      shapes: project.shapes.filter((shape) => !hiddenLevelIdSet3D.has(shape.levelId)),
      slabs: project.slabs.filter((slab) => !hiddenLevelIdSet3D.has(slab.levelId)),
      externalModels: project.externalModels.filter(
        (model) => !hiddenLevelIdSet3D.has(model.levelId),
      ),
      measurements: project.measurements.filter(
        (measurement) => !hiddenLevelIdSet3D.has(measurement.levelId),
      ),
    } satisfies Project;
  }, [hiddenLevelIdSet3D, project]);
  const editorUrl = useMemo(() => {
    const url = new URL(window.location.href);
    url.hash = "";
    return url.toString();
  }, []);

  useEffect(() => {
    const snapshot = readPreviewWindowSnapshot();
    if (snapshot) {
      try {
        setProject(parseProjectJson(snapshot.projectJson).project);
        setHiddenLevelIds3D(snapshot.hiddenLevelIds3D);
        setHiddenRoofLayerIds3D(snapshot.hiddenRoofLayerIds3D);
        setSyncStatus(`Loaded local snapshot from ${new Date(snapshot.updatedAtIso).toLocaleTimeString()}.`);
      } catch {
        setSyncStatus("Local preview snapshot was invalid.");
      }
    }

    if (!("BroadcastChannel" in window)) {
      setSyncStatus("BroadcastChannel is not available in this browser.");
      return;
    }

    const channel = new BroadcastChannel(PREVIEW_SYNC_CHANNEL);
    const handleMessage = (event: MessageEvent<PreviewWindowMessage>) => {
      const message = event.data;
      if (!message || message.sourceId === sourceId) {
        return;
      }

      if (message.type === "project-snapshot") {
        try {
          const nextProject = parseProjectJson(message.snapshot.projectJson).project;
          setProject(nextProject);
          setHiddenLevelIds3D((current) =>
            current.filter((levelId) =>
              nextProject.levels.some((level) => level.id === levelId),
            ),
          );
          setHiddenRoofLayerIds3D((current) =>
            current.filter((roofLayerId) =>
              nextProject.roofLayers.some((roofLayer) => roofLayer.id === roofLayerId),
            ),
          );
          setSyncStatus(
            `Live sync active. Last update ${new Date(message.snapshot.updatedAtIso).toLocaleTimeString()}.`,
          );
        } catch {
          setSyncStatus("Received an invalid live snapshot.");
        }
      }
    };

    channel.addEventListener("message", handleMessage);
    channel.postMessage({
      type: "request-project-snapshot",
      sourceId,
    } satisfies PreviewWindowMessage);

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== PREVIEW_SNAPSHOT_STORAGE_KEY || !event.newValue) {
        return;
      }

      try {
        const snapshot = JSON.parse(event.newValue) as {
          projectJson: string;
          preview3D: Preview3DState;
          hiddenLevelIds3D: string[];
          hiddenRoofLayerIds3D?: string[];
          updatedAtIso: string;
        };
        const nextProject = parseProjectJson(snapshot.projectJson).project;
        setProject(nextProject);
        setHiddenLevelIds3D((current) =>
          current.filter((levelId) =>
            nextProject.levels.some((level) => level.id === levelId),
          ),
        );
        setHiddenRoofLayerIds3D((current) =>
          current.filter((roofLayerId) =>
            nextProject.roofLayers.some((roofLayer) => roofLayer.id === roofLayerId),
          ),
        );
        setSyncStatus(
          `Storage snapshot refreshed at ${new Date(snapshot.updatedAtIso).toLocaleTimeString()}.`,
        );
      } catch {
        setSyncStatus("Storage snapshot refresh failed.");
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      channel.removeEventListener("message", handleMessage);
      channel.close();
    };
  }, [sourceId]);

  function toggleLevelVisibility(levelId: string) {
    setHiddenLevelIds3D((current) =>
      current.includes(levelId)
        ? current.filter((id) => id !== levelId)
        : [...current, levelId],
    );
  }

  function toggleRoofLayerVisibility(roofLayerId: string) {
    setHiddenRoofLayerIds3D((current) =>
      current.includes(roofLayerId)
        ? current.filter((id) => id !== roofLayerId)
        : [...current, roofLayerId],
    );
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

  return (
    <main className="preview-window-page">
      <header className="preview-window-toolbar">
        <div>
          <p className="section-kicker">Detached Preview</p>
          <h1>{project.projectName}</h1>
        </div>
        <div className="preview-window-meta">
          <span>{syncStatus}</span>
          <a className="toolbar-button ghost preview-window-link" href={editorUrl}>
            Open Editor
          </a>
        </div>
      </header>

      <section className="preview-window-shell">
        <ViewportScene3D
          project={visibleProject3D}
          preview3D={preview3D}
          hiddenRoofLayerIds={hiddenRoofLayerIds3D}
          onPreview3DChange={(patch) =>
            setPreview3D((current) => ({
              ...current,
              ...patch,
            }))
          }
        />
        <FloatingWindow
          title="3D View"
          kicker="Preview"
          position={settingsWindowPosition}
          width={320}
          onPositionChange={setSettingsWindowPosition}
        >
          <label className="field-label">
            <span>3D Camera Mode</span>
            <select
              value={
                (preview3D.cameraMode as string | undefined) === "Free"
                  ? "FreeOrbit"
                  : (preview3D.cameraMode ?? "Orbit")
              }
              onChange={(event) =>
                setPreview3D((current) => ({
                  ...current,
                  cameraMode: event.target.value as Preview3DState["cameraMode"],
                  targetOffset:
                    event.target.value === "FreeOrbit"
                      ? (current.targetOffset ?? [0, 0, 0])
                      : [0, 0, 0],
                  cameraPositionOffset:
                    event.target.value === "FreeCamera"
                      ? (current.cameraPositionOffset ?? null)
                      : null,
                }))
              }
            >
              <option value="Orbit">Orbit Center</option>
              <option value="FreeOrbit">Free Orbit</option>
              <option value="FreeCamera">Free Camera</option>
            </select>
          </label>
          <label className="field-label">
            <span>3D Join Mode</span>
            <select
              value={preview3D.renderMode}
              onChange={(event) =>
                setPreview3D((current) => ({
                  ...current,
                  renderMode: event.target.value as typeof current.renderMode,
                }))
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
                setPreview3D((current) => ({
                  ...current,
                  surfaceMode: event.target.value as typeof current.surfaceMode,
                }))
              }
            >
              <option value="LevelColor">Color By Level</option>
              <option value="GrayOpaque">Gray Opaque</option>
            </select>
          </label>
          <div className="button-row">
            <button type="button" onClick={() => setPreview3D(DEFAULT_PREVIEW_3D)}>
              Reset 3D Camera
            </button>
          </div>
        </FloatingWindow>
        <FloatingWindow
          title="Levels"
          kicker="Preview"
          position={levelsWindowPosition}
          width={360}
          onPositionChange={setLevelsWindowPosition}
        >
          <p className="muted">Visibility for 3D preview.</p>
          <div className="list-selector list-selector-scroll">
            {project.levels.map((level) => (
              <div key={level.id} className="segmented-list-row">
                <button
                  type="button"
                  className={
                    hiddenLevelIdSet3D.has(level.id)
                      ? "list-visibility-toggle is-off"
                      : "list-visibility-toggle"
                  }
                  onClick={() => toggleLevelVisibility(level.id)}
                  aria-label={`${hiddenLevelIdSet3D.has(level.id) ? "Show" : "Hide"} ${level.name}`}
                  aria-pressed={!hiddenLevelIdSet3D.has(level.id)}
                  title={hiddenLevelIdSet3D.has(level.id) ? "Show level" : "Hide level"}
                >
                  <EyeToggleIcon visible={!hiddenLevelIdSet3D.has(level.id)} />
                </button>
                <div className="list-selector-item segmented-list-item">
                  <strong>{level.name}</strong>
                  <span>{level.elevationM.toFixed(2)} m</span>
                </div>
              </div>
            ))}
            {defaultRoofLayer ? (
              <div key={defaultRoofLayer.id} className="segmented-list-row">
                <button
                  type="button"
                  className={
                    hiddenRoofLayerIdSet3D.has(defaultRoofLayer.id)
                      ? "list-visibility-toggle is-off"
                      : "list-visibility-toggle"
                  }
                  onClick={() => toggleRoofLayerVisibility(defaultRoofLayer.id)}
                  aria-label={`${hiddenRoofLayerIdSet3D.has(defaultRoofLayer.id) ? "Show" : "Hide"} Roof`}
                  aria-pressed={!hiddenRoofLayerIdSet3D.has(defaultRoofLayer.id)}
                  title={
                    hiddenRoofLayerIdSet3D.has(defaultRoofLayer.id)
                      ? "Show roof layer"
                      : "Hide roof layer"
                  }
                >
                  <EyeToggleIcon visible={!hiddenRoofLayerIdSet3D.has(defaultRoofLayer.id)} />
                </button>
                <div className="list-selector-item segmented-list-item">
                  <strong>{defaultRoofLayer.name}</strong>
                  <span>roof drawing layer</span>
                </div>
              </div>
            ) : null}
          </div>
        </FloatingWindow>
      </section>
    </main>
  );
}
