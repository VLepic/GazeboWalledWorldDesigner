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
import type { Project } from "../domain/project-model";
import type { Preview3DState } from "../store/editor-ui-store";

interface ViewportScene3DProps {
  project: Project;
  preview3D: Preview3DState;
  onPreview3DChange: (patch: Partial<Preview3DState>) => void;
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
}: ViewportScene3DProps) {
  const [isOrbiting, setIsOrbiting] = useState(false);
  const scene = useMemo(
    () => buildPreview3DScene(project, preview3D.renderMode, preview3D.surfaceMode),
    [preview3D.renderMode, preview3D.surfaceMode, project],
  );
  const grayMode = preview3D.surfaceMode === "GrayOpaque";

  return (
    <div className={isOrbiting ? "viewport-scene-3d is-orbiting" : "viewport-scene-3d"}>
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
