import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Edges, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { buildPreview3DScene } from "../domain/preview-3d-geometry";
import { solveProjectRoofs } from "../domain/roof-solver";
import type {
  Preview3DBoxPrimitive,
  Preview3DCylinderPrimitive,
  Preview3DMeshPrimitive,
  Preview3DMarkerPrimitive,
} from "../domain/preview-3d-geometry";
import type { EditorTool, Preview3DState } from "../store/editor-ui-store";
import type {
  DoorDesign3D,
  DoorOpening,
  Project,
  RoofOpening,
  WindowDesign3D,
  WindowOpening,
} from "../domain/project-model";

const WINDOW_GLASS_COLOR = "#93d1e7";
const SELECTED_WINDOW_GLASS_COLOR = "#8ecfe0";

interface ViewportScene3DProps {
  project: Project;
  preview3D: Preview3DState;
  onPreview3DChange: (patch: Partial<Preview3DState>) => void;
  activeTool?: EditorTool;
  selectedDoorId?: string | null;
  onSelectDoor?: (doorId: string) => void;
  onInsertDoor3D?: (doorId: string) => void;
  selectedWindowId?: string | null;
  onSelectWindow?: (windowId: string) => void;
  onClearOpeningSelection?: () => void;
  onInsertWindow3D?: (windowId: string) => void;
  selectedRoofOpeningId?: string | null;
  onSelectRoofOpening?: (roofOpeningId: string) => void;
  onInsertRoofWindow3D?: (roofOpeningId: string) => void;
  door3DToolDesign?: DoorDesign3D;
  window3DToolDesign?: WindowDesign3D;
  hiddenRoofLayerIds?: string[];
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

type Vec3Tuple = [number, number, number];

function addVec3(left: Vec3Tuple, right: Vec3Tuple): Vec3Tuple {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function subtractVec3(left: Vec3Tuple, right: Vec3Tuple): Vec3Tuple {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function scaleVec3(value: Vec3Tuple, scalar: number): Vec3Tuple {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

function dotVec3(left: Vec3Tuple, right: Vec3Tuple) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function crossVec3(left: Vec3Tuple, right: Vec3Tuple): Vec3Tuple {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalizeVec3(value: Vec3Tuple): Vec3Tuple {
  const length = Math.hypot(value[0], value[1], value[2]);
  return length > 0.000001 ? scaleVec3(value, 1 / length) : [0, 0, 0];
}

function getCameraPosition(
  preview3D: Preview3DState,
  target: [number, number, number],
  radius: number,
) {
  const yawRad = (preview3D.yawDeg * Math.PI) / 180;
  const pitchRad = (preview3D.pitchDeg * Math.PI) / 180;
  const distance = Math.max(radius * preview3D.distanceMultiplier, 6);

  return [
    target[0] + Math.cos(pitchRad) * Math.cos(yawRad) * distance,
    target[1] + Math.sin(pitchRad) * distance,
    target[2] + Math.cos(pitchRad) * Math.sin(yawRad) * distance,
  ] as const;
}

function getPreview3DCameraMode(preview3D: Preview3DState) {
  const mode = preview3D.cameraMode as string | undefined;
  if (mode === "Free" || mode === "FreeOrbit") {
    return "FreeOrbit";
  }

  return mode === "FreeCamera" ? "FreeCamera" : "Orbit";
}

function getVec3Tuple(value: unknown, fallback: [number, number, number]): [number, number, number] {
  return Array.isArray(value) && value.length === 3
    ? [
        Number.isFinite(value[0]) ? value[0] : 0,
        Number.isFinite(value[1]) ? value[1] : 0,
        Number.isFinite(value[2]) ? value[2] : 0,
      ]
    : fallback;
}

function getPreview3DTargetOffset(preview3D: Preview3DState): [number, number, number] {
  return getVec3Tuple(preview3D.targetOffset, [0, 0, 0]);
}

function getPreview3DCameraPositionOffset(
  preview3D: Preview3DState,
  sceneTarget: [number, number, number],
  radius: number,
): [number, number, number] {
  if (preview3D.cameraPositionOffset) {
    return getVec3Tuple(preview3D.cameraPositionOffset, [0, 0, 0]);
  }

  const position = getCameraPosition(preview3D, sceneTarget, radius);
  return [
    position[0] - sceneTarget[0],
    position[1] - sceneTarget[1],
    position[2] - sceneTarget[2],
  ];
}

function getFreeCameraForward(preview3D: Preview3DState): Vec3Tuple {
  const yawRad = (preview3D.yawDeg * Math.PI) / 180;
  const pitchRad = (preview3D.pitchDeg * Math.PI) / 180;
  return normalizeVec3([
    -Math.cos(pitchRad) * Math.cos(yawRad),
    -Math.sin(pitchRad),
    -Math.cos(pitchRad) * Math.sin(yawRad),
  ]);
}

function lookFreeCamera(camera: THREE.Camera, preview3D: Preview3DState) {
  const forward = getFreeCameraForward(preview3D);
  camera.up.set(0, 1, 0);
  camera.lookAt(
    camera.position.x + forward[0],
    camera.position.y + forward[1],
    camera.position.z + forward[2],
  );
}

function getPreview3DTarget(
  preview3D: Preview3DState,
  sceneTarget: [number, number, number],
): [number, number, number] {
  if (getPreview3DCameraMode(preview3D) !== "FreeOrbit") {
    return sceneTarget;
  }

  const [offsetX, offsetY, offsetZ] = getPreview3DTargetOffset(preview3D);
  return [sceneTarget[0] + offsetX, sceneTarget[1] + offsetY, sceneTarget[2] + offsetZ];
}

function BoxPrimitive({
  primitive,
  grayMode,
}: {
  primitive: Preview3DBoxPrimitive;
  grayMode: boolean;
}) {
  return (
    <mesh
      position={primitive.center}
      rotation={[0, primitive.yawRad, 0]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={primitive.size} />
      <meshStandardMaterial
        color={primitive.color}
        roughness={grayMode ? 0.88 : 0.76}
        metalness={grayMode ? 0.04 : 0.08}
      />
      {grayMode ? <Edges scale={1.001} color="#424750" threshold={12} /> : null}
    </mesh>
  );
}

function CylinderPrimitive({
  primitive,
  grayMode,
}: {
  primitive: Preview3DCylinderPrimitive;
  grayMode: boolean;
}) {
  return (
    <mesh position={primitive.center} castShadow receiveShadow>
      <cylinderGeometry args={[primitive.radius, primitive.radius, primitive.height, 24]} />
      <meshStandardMaterial
        color={primitive.color}
        roughness={grayMode ? 0.84 : 0.72}
        metalness={grayMode ? 0.04 : 0.08}
      />
      {grayMode ? <Edges scale={1.001} color="#424750" threshold={12} /> : null}
    </mesh>
  );
}

function MarkerPrimitive({ primitive }: { primitive: Preview3DMarkerPrimitive }) {
  return (
    <mesh position={primitive.position}>
      <sphereGeometry args={[primitive.radius, 20, 20]} />
      <meshStandardMaterial color={primitive.color} roughness={0.35} metalness={0.08} />
    </mesh>
  );
}

function MeshPrimitive({
  primitive,
  grayMode,
}: {
  primitive: Preview3DMeshPrimitive;
  grayMode: boolean;
}) {
  const geometry = useMemo(() => {
    const meshGeometry = new THREE.BufferGeometry();
    meshGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(primitive.vertices.flat(), 3),
    );
    meshGeometry.setIndex(primitive.indices);
    meshGeometry.computeVertexNormals();
    return meshGeometry;
  }, [primitive.indices, primitive.vertices]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={primitive.color}
        roughness={grayMode ? 0.88 : 0.76}
        metalness={grayMode ? 0.04 : 0.08}
        transparent={primitive.opacity !== undefined && primitive.opacity < 1}
        opacity={primitive.opacity ?? 1}
        side={THREE.DoubleSide}
      />
      {grayMode ? <Edges scale={1.001} color="#424750" threshold={12} /> : null}
    </mesh>
  );
}

interface WindowOpening3DDescriptor {
  window: WindowOpening;
  wallThicknessM: number;
  center: [number, number, number];
  rotationY: number;
}

interface DoorOpening3DDescriptor {
  door: DoorOpening;
  wallThicknessM: number;
  center: [number, number, number];
  rotationY: number;
}

interface RoofOpening3DDescriptor {
  opening: RoofOpening;
  center: Vec3Tuple;
  widthAxis: Vec3Tuple;
  heightAxis: Vec3Tuple;
  normal: Vec3Tuple;
  widthM: number;
  heightM: number;
}

function buildWindowOpening3DDescriptors(project: Project): WindowOpening3DDescriptor[] {
  return project.windows.flatMap((windowOpening) => {
    const wall = project.walls.find((candidate) => candidate.id === windowOpening.wallId);
    if (!wall) {
      return [];
    }

    const level = project.levels.find((candidate) => candidate.id === wall.levelId);
    const wallType = project.wallTypes.find((candidate) => candidate.id === wall.wallTypeId);
    const startNode = project.nodes.find((candidate) => candidate.id === wall.startNodeId);
    const endNode = project.nodes.find((candidate) => candidate.id === wall.endNodeId);
    if (!level || !wallType || !startNode || !endNode) {
      return [];
    }

    const deltaX = endNode.position.x - startNode.position.x;
    const deltaY = endNode.position.y - startNode.position.y;
    const wallLengthM = Math.hypot(deltaX, deltaY);
    if (wallLengthM < 0.0001) {
      return [];
    }

    const directionX = deltaX / wallLengthM;
    const directionY = deltaY / wallLengthM;
    const centerPlanX = startNode.position.x + directionX * windowOpening.offsetM;
    const centerPlanY = startNode.position.y + directionY * windowOpening.offsetM;
    const yawRad = Math.atan2(deltaX, -deltaY);

    return [
      {
        window: windowOpening,
        wallThicknessM: wallType.thicknessM,
        center: [
          centerPlanX,
          level.elevationM + windowOpening.sillHeightM + windowOpening.heightM / 2,
          -centerPlanY,
        ],
        rotationY: yawRad,
      },
    ];
  });
}

function buildDoorOpening3DDescriptors(project: Project): DoorOpening3DDescriptor[] {
  return project.doors.flatMap((doorOpening) => {
    const wall = project.walls.find((candidate) => candidate.id === doorOpening.wallId);
    if (!wall) {
      return [];
    }

    const level = project.levels.find((candidate) => candidate.id === wall.levelId);
    const wallType = project.wallTypes.find((candidate) => candidate.id === wall.wallTypeId);
    const startNode = project.nodes.find((candidate) => candidate.id === wall.startNodeId);
    const endNode = project.nodes.find((candidate) => candidate.id === wall.endNodeId);
    if (!level || !wallType || !startNode || !endNode) {
      return [];
    }

    const deltaX = endNode.position.x - startNode.position.x;
    const deltaY = endNode.position.y - startNode.position.y;
    const wallLengthM = Math.hypot(deltaX, deltaY);
    if (wallLengthM < 0.0001) {
      return [];
    }

    const directionX = deltaX / wallLengthM;
    const directionY = deltaY / wallLengthM;
    const centerPlanX = startNode.position.x + directionX * doorOpening.offsetM;
    const centerPlanY = startNode.position.y + directionY * doorOpening.offsetM;
    const yawRad = Math.atan2(deltaX, -deltaY);

    return [
      {
        door: doorOpening,
        wallThicknessM: wallType.thicknessM,
        center: [centerPlanX, level.elevationM + doorOpening.heightM / 2, -centerPlanY],
        rotationY: yawRad,
      },
    ];
  });
}

function buildRoofOpening3DDescriptors(
  project: Project,
  hiddenRoofLayerIds: readonly string[],
): RoofOpening3DDescriptor[] {
  const hiddenRoofLayerIdSet = new Set(hiddenRoofLayerIds);
  const solvedRoofs = solveProjectRoofs(project);

  return project.roofOpenings.flatMap((opening) => {
    const roof = solvedRoofs.find(
      (candidate) =>
        candidate.sourceKind === "Sketch" &&
        candidate.sketchId === opening.roofSketchId &&
        !(candidate.layerId && hiddenRoofLayerIdSet.has(candidate.layerId)),
    );
    const face = roof?.faces.find((candidate) => candidate.id === opening.roofFaceId);
    if (!face || face.polygonLocal.length === 0) {
      return [];
    }

    const originPlan = face.polygonLocal[0];
    const origin: Vec3Tuple = [
      originPlan.x,
      face.planeOuter.uCoeff * originPlan.x +
        face.planeOuter.vCoeff * originPlan.y +
        face.planeOuter.constantM,
      -originPlan.y,
    ];
    const tangentX: Vec3Tuple = [1, face.planeOuter.uCoeff, 0];
    const tangentY: Vec3Tuple = [0, face.planeOuter.vCoeff, -1];
    const normal = normalizeVec3(crossVec3(tangentX, tangentY));
    const gradientLength = Math.hypot(face.planeOuter.uCoeff, face.planeOuter.vCoeff);
    const widthAxis =
      gradientLength > 0.0001
        ? normalizeVec3([-face.planeOuter.vCoeff, 0, -face.planeOuter.uCoeff])
        : normalizeVec3(tangentX);
    const heightAxis = normalizeVec3(crossVec3(normal, widthAxis));
    const toWorld = (point: { x: number; y: number }): Vec3Tuple => [
      point.x,
      face.planeOuter.uCoeff * point.x +
        face.planeOuter.vCoeff * point.y +
        face.planeOuter.constantM,
      -point.y,
    ];
    const toUv = (point: { x: number; y: number }) => {
      const delta = subtractVec3(toWorld(point), origin);
      return {
        x: dotVec3(delta, widthAxis),
        y: dotVec3(delta, heightAxis),
      };
    };
    const fromUv = (point: { x: number; y: number }) =>
      addVec3(origin, addVec3(scaleVec3(widthAxis, point.x), scaleVec3(heightAxis, point.y)));
    const center = fromUv(toUv(opening.center));
    const widthM = opening.rotationDeg === 90 ? opening.heightM : opening.widthM;
    const heightM = opening.rotationDeg === 90 ? opening.widthM : opening.heightM;

    return [
      {
        opening,
        center,
        widthAxis,
        heightAxis,
        normal,
        widthM,
        heightM,
      },
    ];
  });
}

function DoorInsertMesh({
  opening,
  design3D,
  preview = false,
  selected = false,
}: {
  opening: DoorOpening3DDescriptor;
  design3D: DoorDesign3D;
  preview?: boolean;
  selected?: boolean;
}) {
  const frameDepthM = Math.min(
    opening.wallThicknessM * 0.95,
    Math.max(design3D.frameThicknessM, 0.04),
  );
  const frameThicknessM = Math.min(
    Math.max(0.01, design3D.frameThicknessM),
    Math.min(opening.door.widthM, opening.door.heightM) / 2 - 0.01,
  );
  const innerWidthM = Math.max(0.08, opening.door.widthM - frameThicknessM * 2);
  const innerHeightM = Math.max(0.08, opening.door.heightM - frameThicknessM);
  const doorThicknessM = Math.min(Math.max(0.035, frameThicknessM * 0.7), opening.wallThicknessM * 0.7);
  const wallFaceInsetM = clamp(Math.min(0.01, opening.wallThicknessM * 0.08), 0.002, 0.01);
  const wallSafeMinX = -opening.wallThicknessM / 2 + wallFaceInsetM;
  const wallSafeMaxX = opening.wallThicknessM / 2 - wallFaceInsetM;
  const doorDepthMinCenter = wallSafeMinX + doorThicknessM / 2;
  const doorDepthMaxCenter = wallSafeMaxX - doorThicknessM / 2;
  const desiredDoorDepthCenter =
    doorDepthMinCenter <= doorDepthMaxCenter
      ? clamp(design3D.wallDepthOffsetM, doorDepthMinCenter, doorDepthMaxCenter)
      : 0;
  const frameDepthMinCenter = wallSafeMinX + frameDepthM / 2;
  const frameDepthMaxCenter = wallSafeMaxX - frameDepthM / 2;
  const frameDepthCenter =
    frameDepthMinCenter <= frameDepthMaxCenter
      ? clamp(desiredDoorDepthCenter, frameDepthMinCenter, frameDepthMaxCenter)
      : 0;
  const doorDepthCenter = desiredDoorDepthCenter;
  const frameColor = selected ? "#d2a45a" : design3D.frameColorHex;
  const doorColor = selected ? "#e2b472" : design3D.doorColorHex;
  const frameOpacity = preview ? 0.36 : 1;
  const doorOpacity = preview ? 0.32 : 1;
  const isOpen = design3D.openState === "Open";
  const topCenterY = opening.door.heightM / 2 - frameThicknessM / 2;
  const sideCenterY = frameThicknessM / 2;
  const sideHeightM = Math.max(opening.door.heightM - frameThicknessM, 0.08);

  const leafHeightM = Math.max(innerHeightM - frameThicknessM, 0.12);
  const leafWidthM = innerWidthM;
  const swingBaseSign = design3D.swingDirection === "Outward" ? 1 : -1;
  const hingeSign = design3D.hingeSide === "Left" ? 1 : -1;
  const swingAngleRad = isOpen ? swingBaseSign * hingeSign * Math.PI * 0.48 : 0;
  const hingeZ = design3D.hingeSide === "Left" ? -leafWidthM / 2 : leafWidthM / 2;
  const garageAngleRad = isOpen ? -Math.PI * 0.48 : 0;

  return (
    <group position={opening.center} rotation={[0, opening.rotationY, 0]}>
      <mesh position={[frameDepthCenter, topCenterY, 0]} castShadow receiveShadow>
        <boxGeometry args={[frameDepthM, frameThicknessM, opening.door.widthM]} />
        <meshStandardMaterial color={frameColor} roughness={0.7} metalness={0.08} transparent={preview} opacity={frameOpacity} />
      </mesh>
      <mesh position={[frameDepthCenter, sideCenterY, -opening.door.widthM / 2 + frameThicknessM / 2]} castShadow receiveShadow>
        <boxGeometry args={[frameDepthM, sideHeightM, frameThicknessM]} />
        <meshStandardMaterial color={frameColor} roughness={0.7} metalness={0.08} transparent={preview} opacity={frameOpacity} />
      </mesh>
      <mesh position={[frameDepthCenter, sideCenterY, opening.door.widthM / 2 - frameThicknessM / 2]} castShadow receiveShadow>
        <boxGeometry args={[frameDepthM, sideHeightM, frameThicknessM]} />
        <meshStandardMaterial color={frameColor} roughness={0.7} metalness={0.08} transparent={preview} opacity={frameOpacity} />
      </mesh>

      {design3D.kind === "Normal" ? (
        <group position={[doorDepthCenter, 0, hingeZ]} rotation={[0, swingAngleRad, 0]}>
          <mesh
            position={[0, -opening.door.heightM / 2 + frameThicknessM + leafHeightM / 2, design3D.hingeSide === "Left" ? leafWidthM / 2 : -leafWidthM / 2]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[doorThicknessM, leafHeightM, leafWidthM]} />
            <meshStandardMaterial color={doorColor} roughness={0.82} metalness={0.04} transparent={preview} opacity={doorOpacity} />
          </mesh>
        </group>
      ) : (
        <group position={[doorDepthCenter, opening.door.heightM / 2 - frameThicknessM, 0]} rotation={[0, 0, garageAngleRad]}>
          <mesh position={[0, -innerHeightM / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[doorThicknessM, innerHeightM, innerWidthM]} />
            <meshStandardMaterial color={doorColor} roughness={0.82} metalness={0.04} transparent={preview} opacity={doorOpacity} />
          </mesh>
          {Array.from({ length: 4 }, (_, index) => {
            const slatHeightM = innerHeightM / 4;
            const positionY = -innerHeightM / 2 + slatHeightM * index + slatHeightM / 2;
            return (
              <mesh key={`garage-slat-${index}`} position={[doorThicknessM / 2 + 0.001, positionY, 0]}>
                <boxGeometry args={[0.004, 0.01, innerWidthM]} />
                <meshStandardMaterial color="#2f3542" roughness={0.9} metalness={0.02} transparent={preview} opacity={preview ? 0.22 : 0.55} />
              </mesh>
            );
          })}
        </group>
      )}
    </group>
  );
}

function WindowInsertMesh({
  opening,
  design3D,
  preview = false,
  selected = false,
}: {
  opening: WindowOpening3DDescriptor;
  design3D: WindowDesign3D;
  preview?: boolean;
  selected?: boolean;
}) {
  const frameDepthM = Math.min(
    opening.wallThicknessM * 0.95,
    Math.max(design3D.frameThicknessM, design3D.glassThicknessM * 2, 0.04),
  );
  const frameThicknessM = Math.min(
    Math.max(0.01, design3D.frameThicknessM),
    Math.min(opening.window.widthM, opening.window.heightM) / 2 - 0.01,
  );
  const glassThicknessM = Math.min(
    Math.max(0.002, design3D.glassThicknessM),
    opening.wallThicknessM * 0.9,
  );
  const innerWidthM = Math.max(0.05, opening.window.widthM - frameThicknessM * 2);
  const innerHeightM = Math.max(0.05, opening.window.heightM - frameThicknessM * 2);
  const wallFaceInsetM = clamp(Math.min(0.01, opening.wallThicknessM * 0.08), 0.002, 0.01);
  const wallSafeMinX = -opening.wallThicknessM / 2 + wallFaceInsetM;
  const wallSafeMaxX = opening.wallThicknessM / 2 - wallFaceInsetM;
  const glassDepthMinCenter = wallSafeMinX + glassThicknessM / 2;
  const glassDepthMaxCenter = wallSafeMaxX - glassThicknessM / 2;
  const desiredGlassDepthCenter =
    glassDepthMinCenter <= glassDepthMaxCenter
      ? clamp(design3D.wallDepthOffsetM, glassDepthMinCenter, glassDepthMaxCenter)
      : 0;
  const frameDepthMinCenter = wallSafeMinX + frameDepthM / 2;
  const frameDepthMaxCenter = wallSafeMaxX - frameDepthM / 2;
  const frameDepthCenter =
    frameDepthMinCenter <= frameDepthMaxCenter
      ? clamp(desiredGlassDepthCenter, frameDepthMinCenter, frameDepthMaxCenter)
      : 0;
  const frameMinX = frameDepthCenter - frameDepthM / 2;
  const frameMaxX = frameDepthCenter + frameDepthM / 2;
  const glassDepthGapM = clamp(Math.min(0.005, frameDepthM * 0.08), 0.001, 0.005);
  const glassFrameMinCenter = frameMinX + glassDepthGapM + glassThicknessM / 2;
  const glassFrameMaxCenter = frameMaxX - glassDepthGapM - glassThicknessM / 2;
  const glassDepthCenter =
    glassFrameMinCenter <= glassFrameMaxCenter
      ? clamp(desiredGlassDepthCenter, glassFrameMinCenter, glassFrameMaxCenter)
      : frameDepthCenter;
  const baseFrameColor = design3D.frameColorHex;
  const frameColor = selected ? "#d2a45a" : preview ? baseFrameColor : baseFrameColor;
  const glassColor = selected ? SELECTED_WINDOW_GLASS_COLOR : WINDOW_GLASS_COLOR;
  const frameOpacity = preview ? 0.36 : 1;
  const glassOpacity = preview ? 0.18 : 0.42;
  const mullionThicknessM = Math.max(0.02, frameThicknessM * 0.72);
  const verticalDivisionCount = Math.max(0, Math.round(design3D.verticalDivisions));
  const horizontalDivisionCount = Math.max(0, Math.round(design3D.horizontalDivisions));

  return (
    <group position={opening.center} rotation={[0, opening.rotationY, 0]}>
      <mesh position={[frameDepthCenter, opening.window.heightM / 2 - frameThicknessM / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[frameDepthM, frameThicknessM, opening.window.widthM]} />
        <meshStandardMaterial color={frameColor} roughness={0.7} metalness={0.08} transparent={preview} opacity={frameOpacity} />
      </mesh>
      <mesh position={[frameDepthCenter, -opening.window.heightM / 2 + frameThicknessM / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[frameDepthM, frameThicknessM, opening.window.widthM]} />
        <meshStandardMaterial color={frameColor} roughness={0.7} metalness={0.08} transparent={preview} opacity={frameOpacity} />
      </mesh>
      <mesh position={[frameDepthCenter, 0, -opening.window.widthM / 2 + frameThicknessM / 2]} castShadow receiveShadow>
        <boxGeometry args={[frameDepthM, innerHeightM, frameThicknessM]} />
        <meshStandardMaterial color={frameColor} roughness={0.7} metalness={0.08} transparent={preview} opacity={frameOpacity} />
      </mesh>
      <mesh position={[frameDepthCenter, 0, opening.window.widthM / 2 - frameThicknessM / 2]} castShadow receiveShadow>
        <boxGeometry args={[frameDepthM, innerHeightM, frameThicknessM]} />
        <meshStandardMaterial color={frameColor} roughness={0.7} metalness={0.08} transparent={preview} opacity={frameOpacity} />
      </mesh>
      {Array.from({ length: verticalDivisionCount }, (_, index) => {
        const positionZ =
          -innerWidthM / 2 + ((index + 1) * innerWidthM) / (verticalDivisionCount + 1);
        return (
          <mesh
            key={`window-v-${index}`}
            position={[frameDepthCenter, 0, positionZ]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[frameDepthM, innerHeightM, mullionThicknessM]} />
            <meshStandardMaterial color={frameColor} roughness={0.7} metalness={0.08} transparent={preview} opacity={frameOpacity} />
          </mesh>
        );
      })}
      {Array.from({ length: horizontalDivisionCount }, (_, index) => {
        const positionY =
          -innerHeightM / 2 + ((index + 1) * innerHeightM) / (horizontalDivisionCount + 1);
        return (
          <mesh
            key={`window-h-${index}`}
            position={[frameDepthCenter, positionY, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[frameDepthM, mullionThicknessM, innerWidthM]} />
            <meshStandardMaterial color={frameColor} roughness={0.7} metalness={0.08} transparent={preview} opacity={frameOpacity} />
          </mesh>
        );
      })}
      <mesh position={[glassDepthCenter, 0, 0]} receiveShadow renderOrder={24}>
        <boxGeometry args={[glassThicknessM, innerHeightM, innerWidthM]} />
        <meshStandardMaterial
          color={glassColor}
          roughness={0.16}
          metalness={0}
          transparent
          opacity={glassOpacity}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

function RoofPlaneRectMesh({
  center,
  widthAxis,
  heightAxis,
  normal,
  widthM,
  heightM,
  offsetM = 0.035,
  color,
  opacity = 1,
  colorWrite = true,
  depthWrite = true,
  depthTest = true,
  onPointerOver,
  onPointerOut,
  onClick,
  onContextMenu,
}: {
  center: Vec3Tuple;
  widthAxis: Vec3Tuple;
  heightAxis: Vec3Tuple;
  normal: Vec3Tuple;
  widthM: number;
  heightM: number;
  offsetM?: number;
  color: string;
  opacity?: number;
  colorWrite?: boolean;
  depthWrite?: boolean;
  depthTest?: boolean;
  onPointerOver?: (event: any) => void;
  onPointerOut?: (event: any) => void;
  onClick?: (event: any) => void;
  onContextMenu?: (event: any) => void;
}) {
  const geometry = useMemo(() => {
    const offsetCenter = addVec3(center, scaleVec3(normal, offsetM));
    const halfWidth = widthM / 2;
    const halfHeight = heightM / 2;
    const vertices = [
      addVec3(addVec3(offsetCenter, scaleVec3(widthAxis, -halfWidth)), scaleVec3(heightAxis, -halfHeight)),
      addVec3(addVec3(offsetCenter, scaleVec3(widthAxis, halfWidth)), scaleVec3(heightAxis, -halfHeight)),
      addVec3(addVec3(offsetCenter, scaleVec3(widthAxis, halfWidth)), scaleVec3(heightAxis, halfHeight)),
      addVec3(addVec3(offsetCenter, scaleVec3(widthAxis, -halfWidth)), scaleVec3(heightAxis, halfHeight)),
    ];
    const meshGeometry = new THREE.BufferGeometry();
    meshGeometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices.flat(), 3));
    meshGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    meshGeometry.computeVertexNormals();
    return meshGeometry;
  }, [center, heightAxis, heightM, normal, offsetM, widthAxis, widthM]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh
      geometry={geometry}
      castShadow
      receiveShadow
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <meshStandardMaterial
        color={color}
        transparent={opacity < 1}
        opacity={opacity}
        roughness={0.32}
        metalness={0.02}
        emissive={color}
        emissiveIntensity={opacity < 1 && colorWrite ? 0.18 : 0}
        side={THREE.DoubleSide}
        colorWrite={colorWrite}
        depthWrite={depthWrite}
        depthTest={depthTest}
      />
    </mesh>
  );
}

function RoofPlaneBoxMesh({
  center,
  widthAxis,
  heightAxis,
  normal,
  widthM,
  heightM,
  depthM,
  offsetM = 0.035,
  color,
  opacity = 1,
}: {
  center: Vec3Tuple;
  widthAxis: Vec3Tuple;
  heightAxis: Vec3Tuple;
  normal: Vec3Tuple;
  widthM: number;
  heightM: number;
  depthM: number;
  offsetM?: number;
  color: string;
  opacity?: number;
}) {
  const geometry = useMemo(() => {
    const halfWidth = widthM / 2;
    const halfHeight = heightM / 2;
    const halfDepth = depthM / 2;
    const boxCenter = addVec3(center, scaleVec3(normal, offsetM + halfDepth));
    const corner = (widthSign: number, heightSign: number, depthSign: number): Vec3Tuple =>
      addVec3(
        addVec3(
          addVec3(boxCenter, scaleVec3(widthAxis, widthSign * halfWidth)),
          scaleVec3(heightAxis, heightSign * halfHeight),
        ),
        scaleVec3(normal, depthSign * halfDepth),
      );
    const vertices = [
      corner(-1, -1, -1),
      corner(1, -1, -1),
      corner(1, 1, -1),
      corner(-1, 1, -1),
      corner(-1, -1, 1),
      corner(1, -1, 1),
      corner(1, 1, 1),
      corner(-1, 1, 1),
    ];
    const meshGeometry = new THREE.BufferGeometry();
    meshGeometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices.flat(), 3));
    meshGeometry.setIndex([
      0, 2, 1, 0, 3, 2,
      4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4,
      1, 2, 6, 1, 6, 5,
      2, 3, 7, 2, 7, 6,
      3, 0, 4, 3, 4, 7,
    ]);
    meshGeometry.computeVertexNormals();
    return meshGeometry;
  }, [center, depthM, heightAxis, heightM, normal, offsetM, widthAxis, widthM]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={color}
        transparent={opacity < 1}
        opacity={opacity}
        roughness={0.58}
        metalness={0.06}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function RoofWindowInsertPreview({
  opening,
  design3D,
  selected = false,
  preview = false,
}: {
  opening: RoofOpening3DDescriptor;
  design3D: WindowDesign3D;
  selected?: boolean;
  preview?: boolean;
}) {
  const frameM = Math.min(
    Math.max(0.01, design3D.frameThicknessM),
    Math.max(Math.min(opening.widthM, opening.heightM) / 2 - 0.01, 0.01),
  );
  const innerWidthM = Math.max(0.05, opening.widthM - frameM * 2);
  const innerHeightM = Math.max(0.05, opening.heightM - frameM * 2);
  const frameColor = selected ? "#d2a45a" : design3D.frameColorHex;
  const frameOpacity = preview ? 0.42 : 1;
  const frameDepthM = Math.min(0.22, Math.max(0.035, design3D.frameThicknessM, design3D.glassThicknessM * 2));
  const mullionM = Math.max(0.02, frameM * 0.72);
  const verticalDivisionCount = Math.max(0, Math.round(design3D.verticalDivisions));
  const horizontalDivisionCount = Math.max(0, Math.round(design3D.horizontalDivisions));
  const frameOffsetM = 0.003;
  const glassOffsetM = frameOffsetM + Math.max(0.004, clamp(design3D.wallDepthOffsetM, -0.04, 0.04) * 0.05);

  return (
    <group>
      <RoofPlaneRectMesh
        center={opening.center}
        widthAxis={opening.widthAxis}
        heightAxis={opening.heightAxis}
        normal={opening.normal}
        widthM={innerWidthM}
        heightM={innerHeightM}
        offsetM={glassOffsetM}
        color={selected ? SELECTED_WINDOW_GLASS_COLOR : WINDOW_GLASS_COLOR}
        opacity={preview ? 0.2 : 0.44}
        depthWrite={false}
      />
      <RoofPlaneBoxMesh
        center={addVec3(opening.center, scaleVec3(opening.heightAxis, -(opening.heightM - frameM) / 2))}
        widthAxis={opening.widthAxis}
        heightAxis={opening.heightAxis}
        normal={opening.normal}
        widthM={opening.widthM}
        heightM={frameM}
        depthM={frameDepthM}
        offsetM={frameOffsetM}
        color={frameColor}
        opacity={frameOpacity}
      />
      <RoofPlaneBoxMesh
        center={addVec3(opening.center, scaleVec3(opening.heightAxis, (opening.heightM - frameM) / 2))}
        widthAxis={opening.widthAxis}
        heightAxis={opening.heightAxis}
        normal={opening.normal}
        widthM={opening.widthM}
        heightM={frameM}
        depthM={frameDepthM}
        offsetM={frameOffsetM}
        color={frameColor}
        opacity={frameOpacity}
      />
      <RoofPlaneBoxMesh
        center={addVec3(opening.center, scaleVec3(opening.widthAxis, -(opening.widthM - frameM) / 2))}
        widthAxis={opening.widthAxis}
        heightAxis={opening.heightAxis}
        normal={opening.normal}
        widthM={frameM}
        heightM={innerHeightM}
        depthM={frameDepthM}
        offsetM={frameOffsetM}
        color={frameColor}
        opacity={frameOpacity}
      />
      <RoofPlaneBoxMesh
        center={addVec3(opening.center, scaleVec3(opening.widthAxis, (opening.widthM - frameM) / 2))}
        widthAxis={opening.widthAxis}
        heightAxis={opening.heightAxis}
        normal={opening.normal}
        widthM={frameM}
        heightM={innerHeightM}
        depthM={frameDepthM}
        offsetM={frameOffsetM}
        color={frameColor}
        opacity={frameOpacity}
      />
      {Array.from({ length: verticalDivisionCount }, (_, index) => {
        const offset =
          -innerWidthM / 2 + ((index + 1) * innerWidthM) / (verticalDivisionCount + 1);
        return (
          <RoofPlaneBoxMesh
            key={`roof-window-v-${index}`}
            center={addVec3(opening.center, scaleVec3(opening.widthAxis, offset))}
            widthAxis={opening.widthAxis}
            heightAxis={opening.heightAxis}
            normal={opening.normal}
            widthM={mullionM}
            heightM={innerHeightM}
            depthM={frameDepthM}
            offsetM={frameOffsetM}
            color={frameColor}
            opacity={frameOpacity}
          />
        );
      })}
      {Array.from({ length: horizontalDivisionCount }, (_, index) => {
        const offset =
          -innerHeightM / 2 + ((index + 1) * innerHeightM) / (horizontalDivisionCount + 1);
        return (
          <RoofPlaneBoxMesh
            key={`roof-window-h-${index}`}
            center={addVec3(opening.center, scaleVec3(opening.heightAxis, offset))}
            widthAxis={opening.widthAxis}
            heightAxis={opening.heightAxis}
            normal={opening.normal}
            widthM={innerWidthM}
            heightM={mullionM}
            depthM={frameDepthM}
            offsetM={frameOffsetM}
            color={frameColor}
            opacity={frameOpacity}
          />
        );
      })}
    </group>
  );
}

function PreviewCameraController({
  preview3D,
  target,
  radius,
  onPreview3DChange,
  onOrbitingChange,
}: {
  preview3D: Preview3DState;
  target: [number, number, number];
  radius: number;
  onPreview3DChange: (patch: Partial<Preview3DState>) => void;
  onOrbitingChange: (isOrbiting: boolean) => void;
}) {
  const controlsRef = useRef<any>(null);
  const lastSignatureRef = useRef("");
  const { camera } = useThree();
  const activeTarget = getPreview3DTarget(preview3D, target);
  const cameraMode = getPreview3DCameraMode(preview3D);

  useEffect(() => {
    const [x, y, z] = getCameraPosition(preview3D, activeTarget, radius);
    camera.position.set(x, y, z);
    camera.up.set(0, 1, 0);
    camera.lookAt(activeTarget[0], activeTarget[1], activeTarget[2]);
    const controls = controlsRef.current;
    if (controls) {
      controls.target.set(activeTarget[0], activeTarget[1], activeTarget[2]);
      controls.update();
    }
  }, [activeTarget, camera, preview3D, radius]);

  function handleOrbitEnd() {
    onOrbitingChange(false);
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }

    const position = controls.object.position as THREE.Vector3;
    const controlTarget = controls.target as THREE.Vector3;
    const deltaX = position.x - controlTarget.x;
    const deltaY = position.y - controlTarget.y;
    const deltaZ = position.z - controlTarget.z;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ);
    if (distance < 0.0001) {
      return;
    }

    const yawDeg = (Math.atan2(deltaZ, deltaX) * 180) / Math.PI;
    const pitchDeg = (Math.asin(clamp(deltaY / distance, -1, 1)) * 180) / Math.PI;
    const distanceMultiplier = distance / Math.max(radius, 1);
    const targetOffset: [number, number, number] =
      cameraMode === "FreeOrbit"
        ? [
            Number((controlTarget.x - target[0]).toFixed(3)),
            Number((controlTarget.y - target[1]).toFixed(3)),
            Number((controlTarget.z - target[2]).toFixed(3)),
          ]
        : [0, 0, 0];
    const signature = `${cameraMode}|${yawDeg.toFixed(2)}|${pitchDeg.toFixed(2)}|${distanceMultiplier.toFixed(3)}|${targetOffset.join("|")}`;
    if (signature === lastSignatureRef.current) {
      return;
    }

    lastSignatureRef.current = signature;
    onPreview3DChange({
      yawDeg: Number(yawDeg.toFixed(2)),
      pitchDeg: Number(pitchDeg.toFixed(2)),
      distanceMultiplier: Number(distanceMultiplier.toFixed(3)),
      targetOffset,
      cameraPositionOffset: null,
    });
  }

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.08}
      makeDefault
      enablePan={cameraMode === "FreeOrbit"}
      screenSpacePanning
      onStart={() => onOrbitingChange(true)}
      onEnd={handleOrbitEnd}
    />
  );
}

function isEditableDomTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    tagName === "button"
  );
}

function FreeCameraController({
  preview3D,
  target,
  radius,
  onPreview3DChange,
  onOrbitingChange,
}: {
  preview3D: Preview3DState;
  target: [number, number, number];
  radius: number;
  onPreview3DChange: (patch: Partial<Preview3DState>) => void;
  onOrbitingChange: (isOrbiting: boolean) => void;
}) {
  const { camera, gl } = useThree();
  const pressedKeysRef = useRef(new Set<string>());
  const previewRef = useRef(preview3D);
  const pointerLookRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startYawDeg: number;
    startPitchDeg: number;
  } | null>(null);
  const lastSignatureRef = useRef("");

  useEffect(() => {
    previewRef.current = preview3D;
  }, [preview3D]);

  useEffect(() => {
    const offset = getPreview3DCameraPositionOffset(preview3D, target, radius);
    camera.position.set(target[0] + offset[0], target[1] + offset[1], target[2] + offset[2]);
    lookFreeCamera(camera, preview3D);
  }, [camera, preview3D, radius, target]);

  useEffect(() => {
    const element = gl.domElement;

    function commitCameraPose() {
      const currentPreview = previewRef.current;
      const cameraPositionOffset: [number, number, number] = [
        Number((camera.position.x - target[0]).toFixed(3)),
        Number((camera.position.y - target[1]).toFixed(3)),
        Number((camera.position.z - target[2]).toFixed(3)),
      ];
      const signature = `${currentPreview.yawDeg.toFixed(2)}|${currentPreview.pitchDeg.toFixed(2)}|${cameraPositionOffset.join("|")}`;
      if (signature === lastSignatureRef.current) {
        return;
      }

      lastSignatureRef.current = signature;
      onPreview3DChange({
        yawDeg: Number(currentPreview.yawDeg.toFixed(2)),
        pitchDeg: Number(currentPreview.pitchDeg.toFixed(2)),
        cameraPositionOffset,
      });
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.button !== 1) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      element.setPointerCapture(event.pointerId);
      pointerLookRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startYawDeg: previewRef.current.yawDeg,
        startPitchDeg: previewRef.current.pitchDeg,
      };
      onOrbitingChange(true);
    }

    function handlePointerMove(event: PointerEvent) {
      const drag = pointerLookRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      const yawDeg = drag.startYawDeg + (event.clientX - drag.startClientX) * 0.14;
      const pitchDeg = clamp(
        drag.startPitchDeg + (event.clientY - drag.startClientY) * 0.12,
        -82,
        82,
      );
      previewRef.current = {
        ...previewRef.current,
        yawDeg: Number(yawDeg.toFixed(2)),
        pitchDeg: Number(pitchDeg.toFixed(2)),
      };
      lookFreeCamera(camera, previewRef.current);
    }

    function handlePointerUp(event: PointerEvent) {
      const drag = pointerLookRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }

      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
      pointerLookRef.current = null;
      onOrbitingChange(false);
      commitCameraPose();
    }

    function handleContextMenu(event: MouseEvent) {
      event.preventDefault();
    }

    function handleAuxClick(event: MouseEvent) {
      if (event.button === 1) {
        event.preventDefault();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (isEditableDomTarget(event.target)) {
        return;
      }

      if (
        event.code === "KeyW" ||
        event.code === "KeyA" ||
        event.code === "KeyS" ||
        event.code === "KeyD" ||
        event.code === "Space" ||
        event.code === "ShiftLeft" ||
        event.code === "ShiftRight"
      ) {
        event.preventDefault();
        pressedKeysRef.current.add(event.code);
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      pressedKeysRef.current.delete(event.code);
    }

    element.addEventListener("pointerdown", handlePointerDown);
    element.addEventListener("pointermove", handlePointerMove);
    element.addEventListener("pointerup", handlePointerUp);
    element.addEventListener("contextmenu", handleContextMenu);
    element.addEventListener("auxclick", handleAuxClick);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      element.removeEventListener("pointerdown", handlePointerDown);
      element.removeEventListener("pointermove", handlePointerMove);
      element.removeEventListener("pointerup", handlePointerUp);
      element.removeEventListener("contextmenu", handleContextMenu);
      element.removeEventListener("auxclick", handleAuxClick);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      pressedKeysRef.current.clear();
      pointerLookRef.current = null;
      onOrbitingChange(false);
    };
  }, [camera, gl.domElement, onOrbitingChange, onPreview3DChange, target]);

  useFrame((_, delta) => {
    const keys = pressedKeysRef.current;
    if (keys.size === 0) {
      return;
    }

    const currentPreview = previewRef.current;
    const forwardTuple = getFreeCameraForward(currentPreview);
    const forward = new THREE.Vector3(forwardTuple[0], forwardTuple[1], forwardTuple[2]);
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const move = new THREE.Vector3();

    if (keys.has("KeyW")) {
      move.add(forward);
    }
    if (keys.has("KeyS")) {
      move.sub(forward);
    }
    if (keys.has("KeyD")) {
      move.add(right);
    }
    if (keys.has("KeyA")) {
      move.sub(right);
    }
    if (keys.has("Space")) {
      move.y += 1;
    }
    if (keys.has("ShiftLeft") || keys.has("ShiftRight")) {
      move.y -= 1;
    }

    if (move.lengthSq() <= 0.000001) {
      return;
    }

    const speedMps = Math.max(4, Math.min(18, radius * 0.55));
    move.normalize().multiplyScalar(speedMps * Math.min(delta, 0.05));
    camera.position.add(move);
    lookFreeCamera(camera, currentPreview);

    const cameraPositionOffset: [number, number, number] = [
      Number((camera.position.x - target[0]).toFixed(3)),
      Number((camera.position.y - target[1]).toFixed(3)),
      Number((camera.position.z - target[2]).toFixed(3)),
    ];
    const signature = `${currentPreview.yawDeg.toFixed(2)}|${currentPreview.pitchDeg.toFixed(2)}|${cameraPositionOffset.join("|")}`;
    if (signature !== lastSignatureRef.current) {
      lastSignatureRef.current = signature;
      onPreview3DChange({ cameraPositionOffset });
    }
  });

  return null;
}

export function ViewportScene3D({
  project,
  preview3D,
  onPreview3DChange,
  activeTool = "Move",
  selectedDoorId = null,
  onSelectDoor,
  onInsertDoor3D,
  selectedWindowId = null,
  onSelectWindow,
  onClearOpeningSelection,
  onInsertWindow3D,
  selectedRoofOpeningId = null,
  onSelectRoofOpening,
  onInsertRoofWindow3D,
  door3DToolDesign,
  window3DToolDesign,
  hiddenRoofLayerIds = [],
}: ViewportScene3DProps) {
  const [isOrbiting, setIsOrbiting] = useState(false);
  const [hoveredDoorId, setHoveredDoorId] = useState<string | null>(null);
  const [hoveredWindowId, setHoveredWindowId] = useState<string | null>(null);
  const [hoveredRoofOpeningId, setHoveredRoofOpeningId] = useState<string | null>(null);
  const suppressNextContextClearRef = useRef(false);
  const scene = useMemo(
    () =>
      buildPreview3DScene(
        project,
        preview3D.renderMode,
        preview3D.surfaceMode,
        hiddenRoofLayerIds,
      ),
    [hiddenRoofLayerIds, preview3D.renderMode, preview3D.surfaceMode, project],
  );
  const doorOpenings3D = useMemo(() => buildDoorOpening3DDescriptors(project), [project]);
  const windowOpenings3D = useMemo(() => buildWindowOpening3DDescriptors(project), [project]);
  const roofOpenings3D = useMemo(
    () => buildRoofOpening3DDescriptors(project, hiddenRoofLayerIds),
    [hiddenRoofLayerIds, project],
  );
  const grayMode = preview3D.surfaceMode === "GrayOpaque";
  const cameraMode = getPreview3DCameraMode(preview3D);

  return (
    <div
      className={isOrbiting ? "viewport-scene-3d is-orbiting" : "viewport-scene-3d"}
      onContextMenu={(event) => {
        event.preventDefault();
        if (suppressNextContextClearRef.current) {
          suppressNextContextClearRef.current = false;
          return;
        }
        onClearOpeningSelection?.();
      }}
    >
      <Canvas
        className="viewport-3d-canvas"
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        camera={{ fov: 42, near: 0.1, far: 2000 }}
      >
        <color attach="background" args={["#0a1122"]} />
        <fog attach="fog" args={["#0a1122", scene.radius * 4, scene.radius * 12]} />
        <ambientLight intensity={grayMode ? 0.9 : 0.75} />
        <hemisphereLight
          intensity={grayMode ? 0.75 : 0.55}
          color="#f8f6f2"
          groundColor="#1a2032"
        />
        <directionalLight
          position={[14, 18, 10]}
          intensity={grayMode ? 1.8 : 1.3}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />
        <directionalLight position={[-10, 7, -8]} intensity={grayMode ? 0.45 : 0.25} />
        <group>
          {scene.boxes.map((primitive, index) => (
            <BoxPrimitive
              key={`box-${index}`}
              primitive={primitive}
              grayMode={grayMode}
            />
          ))}
          {scene.cylinders.map((primitive, index) => (
            <CylinderPrimitive
              key={`cylinder-${index}`}
              primitive={primitive}
              grayMode={grayMode}
            />
          ))}
          {scene.markers.map((primitive, index) => (
            <MarkerPrimitive key={`marker-${index}`} primitive={primitive} />
          ))}
          {scene.meshes.map((primitive, index) => (
            <MeshPrimitive key={`mesh-${index}`} primitive={primitive} grayMode={grayMode} />
          ))}
          {doorOpenings3D.map((opening) => {
            const isHovered = hoveredDoorId === opening.door.id;
            const isSelected = selectedDoorId === opening.door.id;
            const hasInsert = opening.door.design3D !== null;
            const shouldShowPreview = activeTool === "Door" && isHovered;
            return (
              <group key={`door-opening-${opening.door.id}`}>
                <mesh
                  position={opening.center}
                  rotation={[0, opening.rotationY, 0]}
                  onPointerOver={(event) => {
                    event.stopPropagation();
                    setHoveredDoorId(opening.door.id);
                  }}
                  onPointerOut={(event) => {
                    event.stopPropagation();
                    setHoveredDoorId((current) => (current === opening.door.id ? null : current));
                  }}
                  onClick={(event) => {
                    if (activeTool !== "Door") {
                      return;
                    }

                    event.stopPropagation();
                    onInsertDoor3D?.(opening.door.id);
                  }}
                  onContextMenu={(event) => {
                    event.stopPropagation();
                    event.nativeEvent.preventDefault();
                    suppressNextContextClearRef.current = true;
                    onSelectDoor?.(opening.door.id);
                  }}
                >
                  <boxGeometry
                    args={[
                      Math.max(opening.wallThicknessM * 0.92, 0.02),
                      opening.door.heightM,
                      opening.door.widthM,
                    ]}
                  />
                  <meshBasicMaterial
                    transparent
                    opacity={0}
                    color={isSelected ? "#d29a52" : "#ffffff"}
                    colorWrite={false}
                    depthWrite={false}
                    depthTest={false}
                  />
                </mesh>
                {hasInsert && opening.door.design3D ? (
                  <DoorInsertMesh
                    opening={opening}
                    design3D={opening.door.design3D}
                    selected={isSelected}
                  />
                ) : null}
                {shouldShowPreview ? (
                  <DoorInsertMesh
                    opening={opening}
                    design3D={
                      door3DToolDesign ??
                      opening.door.design3D ?? {
                        kind: "Normal",
                        frameThicknessM: 0.08,
                        frameColorHex: "#c4cbd6",
                        doorColorHex: "#8a5b3d",
                        wallDepthOffsetM: 0,
                        openState: "Closed",
                        hingeSide: "Left",
                        swingDirection: "Inward",
                      }
                    }
                    preview
                    selected={isSelected}
                  />
                ) : null}
              </group>
            );
          })}
          {windowOpenings3D.map((opening) => {
            const isHovered = hoveredWindowId === opening.window.id;
            const isSelected = selectedWindowId === opening.window.id;
            const hasInsert = opening.window.design3D !== null;
            const shouldShowPreview = activeTool === "Window" && isHovered;
            return (
              <group key={`window-opening-${opening.window.id}`}>
                <mesh
                  position={opening.center}
                  rotation={[0, opening.rotationY, 0]}
                  onPointerOver={(event) => {
                    event.stopPropagation();
                    setHoveredWindowId(opening.window.id);
                  }}
                  onPointerOut={(event) => {
                    event.stopPropagation();
                    setHoveredWindowId((current) => (current === opening.window.id ? null : current));
                  }}
                  onClick={(event) => {
                    if (activeTool !== "Window") {
                      return;
                    }

                    event.stopPropagation();
                    onInsertWindow3D?.(opening.window.id);
                  }}
                  onContextMenu={(event) => {
                    event.stopPropagation();
                    event.nativeEvent.preventDefault();
                    suppressNextContextClearRef.current = true;
                    onSelectWindow?.(opening.window.id);
                  }}
                >
                  <boxGeometry
                    args={[
                      Math.max(opening.wallThicknessM * 0.92, 0.02),
                      opening.window.heightM,
                      opening.window.widthM,
                    ]}
                  />
                  <meshBasicMaterial
                    transparent
                    opacity={0}
                    color={isSelected ? "#d29a52" : "#ffffff"}
                    colorWrite={false}
                    depthWrite={false}
                    depthTest={false}
                    />
                </mesh>
                {hasInsert && opening.window.design3D ? (
                  <WindowInsertMesh
                    opening={opening}
                    design3D={opening.window.design3D}
                    selected={isSelected}
                  />
                ) : null}
                {shouldShowPreview ? (
                  <WindowInsertMesh
                    opening={opening}
                    design3D={window3DToolDesign ?? opening.window.design3D ?? {
                      glassThicknessM: 0.02,
                      frameThicknessM: 0.08,
                      verticalDivisions: 0,
                      horizontalDivisions: 0,
                      wallDepthOffsetM: 0,
                      frameColorHex: "#c4cbd6",
                    }}
                    preview
                    selected={isSelected}
                  />
                ) : null}
              </group>
            );
          })}
          {roofOpenings3D.map((opening) => {
            const isHovered = hoveredRoofOpeningId === opening.opening.id;
            const isSelected = selectedRoofOpeningId === opening.opening.id;
            const hasInsert = opening.opening.design3D !== null;
            const shouldShowPreview = activeTool === "RoofWindow" && isHovered && !hasInsert;
            return (
              <group key={`roof-opening-${opening.opening.id}`}>
                <RoofPlaneRectMesh
                  center={opening.center}
                  widthAxis={opening.widthAxis}
                  heightAxis={opening.heightAxis}
                  normal={opening.normal}
                  widthM={Math.max(opening.widthM, 0.02)}
                  heightM={Math.max(opening.heightM, 0.02)}
                  offsetM={0.075}
                  color={isSelected ? "#d29a52" : "#ffffff"}
                  opacity={0}
                  colorWrite={false}
                  depthWrite={false}
                  depthTest={false}
                  onPointerOver={(event) => {
                    event.stopPropagation();
                    setHoveredRoofOpeningId(opening.opening.id);
                  }}
                  onPointerOut={(event) => {
                    event.stopPropagation();
                    setHoveredRoofOpeningId((current) =>
                      current === opening.opening.id ? null : current,
                    );
                  }}
                  onClick={(event) => {
                    if (activeTool !== "RoofWindow") {
                      return;
                    }

                    event.stopPropagation();
                    onInsertRoofWindow3D?.(opening.opening.id);
                  }}
                  onContextMenu={(event) => {
                    event.stopPropagation();
                    event.nativeEvent.preventDefault();
                    suppressNextContextClearRef.current = true;
                    onSelectRoofOpening?.(opening.opening.id);
                  }}
                />
                {hasInsert && opening.opening.design3D ? (
                  <RoofWindowInsertPreview
                    opening={opening}
                    design3D={opening.opening.design3D}
                    selected={isSelected}
                  />
                ) : null}
                {shouldShowPreview ? (
                  <RoofWindowInsertPreview
                    opening={opening}
                    design3D={
                      window3DToolDesign ??
                      opening.opening.design3D ?? {
                        glassThicknessM: 0.02,
                        frameThicknessM: 0.08,
                        verticalDivisions: 0,
                        horizontalDivisions: 0,
                        wallDepthOffsetM: 0,
                        frameColorHex: "#c4cbd6",
                      }
                    }
                    preview
                    selected={isSelected}
                  />
                ) : null}
              </group>
            );
          })}
        </group>
        <gridHelper
          args={[Math.max(scene.radius * 4, 24), 48, "#87603a", "#31415f"]}
          position={[scene.target[0], 0, scene.target[2]]}
        />
        {cameraMode === "FreeCamera" ? (
          <FreeCameraController
            preview3D={preview3D}
            target={scene.target}
            radius={scene.radius}
            onPreview3DChange={onPreview3DChange}
            onOrbitingChange={setIsOrbiting}
          />
        ) : (
          <PreviewCameraController
            preview3D={preview3D}
            target={scene.target}
            radius={scene.radius}
            onPreview3DChange={onPreview3DChange}
            onOrbitingChange={setIsOrbiting}
          />
        )}
      </Canvas>

      <div className="viewport-3d-overlay">
        <strong>3D Preview</strong>
        <span>
          {cameraMode === "FreeCamera"
            ? "Middle-drag look, WASD fly, Space up, Shift down"
            : `Orbit drag, wheel zoom${cameraMode === "FreeOrbit" ? ", right-drag pan" : ""}`}
        </span>
        <span>
          Floors {project.levels.length} | Walls {project.walls.length} | Stairs {project.stairs.length}
        </span>
        <span>
          Join {preview3D.renderMode === "ArchitecturalJoin" ? "Architectural" : "Node Post"}
        </span>
        <span>
          Surface {grayMode ? "Gray Opaque" : "Level Color"}
        </span>
      </div>
    </div>
  );
}
