import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Edges, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { buildPreview3DScene } from "../domain/preview-3d-geometry";
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
  WindowDesign3D,
  WindowOpening,
} from "../domain/project-model";

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
  door3DToolDesign?: DoorDesign3D;
  window3DToolDesign?: WindowDesign3D;
  hiddenRoofLayerIds?: string[];
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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
  const glassColor = selected ? "#8ecfe0" : "#93d1e7";
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

  useEffect(() => {
    const [x, y, z] = getCameraPosition(preview3D, target, radius);
    camera.position.set(x, y, z);
    camera.up.set(0, 1, 0);
    camera.lookAt(target[0], target[1], target[2]);
    const controls = controlsRef.current;
    if (controls) {
      controls.target.set(target[0], target[1], target[2]);
      controls.update();
    }
  }, [camera, preview3D, radius, target]);

  function handleOrbitEnd() {
    onOrbitingChange(false);
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }

    const position = controls.object.position as THREE.Vector3;
    const deltaX = position.x - target[0];
    const deltaY = position.y - target[1];
    const deltaZ = position.z - target[2];
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ);
    if (distance < 0.0001) {
      return;
    }

    const yawDeg = (Math.atan2(deltaZ, deltaX) * 180) / Math.PI;
    const pitchDeg = (Math.asin(clamp(deltaY / distance, -1, 1)) * 180) / Math.PI;
    const distanceMultiplier = distance / Math.max(radius, 1);
    const signature = `${yawDeg.toFixed(2)}|${pitchDeg.toFixed(2)}|${distanceMultiplier.toFixed(3)}`;
    if (signature === lastSignatureRef.current) {
      return;
    }

    lastSignatureRef.current = signature;
    onPreview3DChange({
      yawDeg: Number(yawDeg.toFixed(2)),
      pitchDeg: Number(pitchDeg.toFixed(2)),
      distanceMultiplier: Number(distanceMultiplier.toFixed(3)),
    });
  }

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.08}
      makeDefault
      onStart={() => onOrbitingChange(true)}
      onEnd={handleOrbitEnd}
    />
  );
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
  door3DToolDesign,
  window3DToolDesign,
  hiddenRoofLayerIds = [],
}: ViewportScene3DProps) {
  const [isOrbiting, setIsOrbiting] = useState(false);
  const [hoveredDoorId, setHoveredDoorId] = useState<string | null>(null);
  const [hoveredWindowId, setHoveredWindowId] = useState<string | null>(null);
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
  const grayMode = preview3D.surfaceMode === "GrayOpaque";

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
        </group>
        <gridHelper
          args={[Math.max(scene.radius * 4, 24), 48, "#87603a", "#31415f"]}
          position={[scene.target[0], 0, scene.target[2]]}
        />
        <PreviewCameraController
          preview3D={preview3D}
          target={scene.target}
          radius={scene.radius}
          onPreview3DChange={onPreview3DChange}
          onOrbitingChange={setIsOrbiting}
        />
      </Canvas>

      <div className="viewport-3d-overlay">
        <strong>3D Preview</strong>
        <span>
          Orbit drag, wheel zoom, right-drag pan
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
