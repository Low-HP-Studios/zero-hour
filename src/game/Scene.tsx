import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Perf } from "r3f-perf";
import * as THREE from "three";
import { AudioManager } from "./Audio";
import { usePlayerController, type PlayerControllerApi } from "./PlayerController";
import {
  Targets,
  createDefaultTargets,
  raycastTargets,
  resetTargets,
} from "./Targets";
import { WeaponSystem } from "./Weapon";
import type {
  CollisionRect,
  GameSettings,
  PerfMetrics,
  PlayerSnapshot,
  StressModeCount,
  TargetState,
  WorldBounds,
} from "./types";

type SceneProps = {
  settings: GameSettings;
  stressCount: StressModeCount;
  onPlayerSnapshot: (snapshot: PlayerSnapshot) => void;
  onPerfMetrics: (metrics: PerfMetrics) => void;
  onHitMarker: () => void;
  onWeaponEquippedChange: (equipped: boolean) => void;
};

const WORLD_BOUNDS: WorldBounds = {
  minX: -19,
  maxX: 19,
  minZ: -19,
  maxZ: 19,
};

const BUILDING_CENTER = new THREE.Vector3(8, 0, -4);
const BUILDING_WIDTH = 10;
const BUILDING_DEPTH = 8;
const BUILDING_HEIGHT = 3.2;
const WALL_THICKNESS = 0.35;
const DOOR_GAP_WIDTH = 2.2;
const DOOR_HEIGHT = 2.2;
const TRACER_DISTANCE = 70;
const TARGET_FLASH_MS = 180;
const TARGET_DISABLE_MS = 200;

const STATIC_COLLIDERS: CollisionRect[] = [
  boxRect({ x: -6, z: -2 }, 2.4, 2.2),
  boxRect({ x: -2, z: -8 }, 2.5, 1.8),
  boxRect({ x: 4, z: -11.5 }, 3.8, 2.2),
  boxRect({ x: 13, z: 5 }, 3, 2.2),
  // Building walls (door opening on the south wall)
  boxRect(
    { x: BUILDING_CENTER.x - BUILDING_WIDTH / 2 + WALL_THICKNESS / 2, z: BUILDING_CENTER.z },
    WALL_THICKNESS,
    BUILDING_DEPTH,
  ),
  boxRect(
    { x: BUILDING_CENTER.x + BUILDING_WIDTH / 2 - WALL_THICKNESS / 2, z: BUILDING_CENTER.z },
    WALL_THICKNESS,
    BUILDING_DEPTH,
  ),
  boxRect(
    { x: BUILDING_CENTER.x, z: BUILDING_CENTER.z - BUILDING_DEPTH / 2 + WALL_THICKNESS / 2 },
    BUILDING_WIDTH,
    WALL_THICKNESS,
  ),
  boxRect(
    {
      x:
        BUILDING_CENTER.x -
        (DOOR_GAP_WIDTH / 2 + (BUILDING_WIDTH - DOOR_GAP_WIDTH) / 4),
      z: BUILDING_CENTER.z + BUILDING_DEPTH / 2 - WALL_THICKNESS / 2,
    },
    (BUILDING_WIDTH - DOOR_GAP_WIDTH) / 2,
    WALL_THICKNESS,
  ),
  boxRect(
    {
      x:
        BUILDING_CENTER.x +
        (DOOR_GAP_WIDTH / 2 + (BUILDING_WIDTH - DOOR_GAP_WIDTH) / 4),
      z: BUILDING_CENTER.z + BUILDING_DEPTH / 2 - WALL_THICKNESS / 2,
    },
    (BUILDING_WIDTH - DOOR_GAP_WIDTH) / 2,
    WALL_THICKNESS,
  ),
];

export function Scene({
  settings,
  stressCount,
  onPlayerSnapshot,
  onPerfMetrics,
  onHitMarker,
  onWeaponEquippedChange,
}: SceneProps) {
  const [targets, setTargets] = useState<TargetState[]>(() => createDefaultTargets());
  const resetTimeoutsRef = useRef<Map<string, number>>(new Map());

  const dpr = useMemo(() => {
    const devicePixelRatio =
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    return Math.min(2, Math.max(0.5, devicePixelRatio * settings.pixelRatioScale));
  }, [settings.pixelRatioScale]);

  const handleTargetHit = useCallback((targetId: string, nowMs: number) => {
    startTransition(() => {
      setTargets((previousTargets) =>
        previousTargets.map((target) =>
          target.id === targetId
            ? {
                ...target,
                disabled: true,
                hitUntil: nowMs + TARGET_FLASH_MS,
              }
            : target,
        ),
      );
    });

    const existing = resetTimeoutsRef.current.get(targetId);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }

    const timeoutId = window.setTimeout(() => {
      resetTimeoutsRef.current.delete(targetId);
      startTransition(() => {
        setTargets((previousTargets) =>
          previousTargets.map((target) =>
            target.id === targetId ? { ...target, disabled: false } : target,
          ),
        );
      });
    }, TARGET_DISABLE_MS);

    resetTimeoutsRef.current.set(targetId, timeoutId);
  }, []);

  const handleResetTargets = useCallback(() => {
    for (const timeoutId of resetTimeoutsRef.current.values()) {
      window.clearTimeout(timeoutId);
    }
    resetTimeoutsRef.current.clear();
    startTransition(() => {
      setTargets((previousTargets) => resetTargets(previousTargets));
    });
  }, []);

  useEffect(() => {
    return () => {
      for (const timeoutId of resetTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      resetTimeoutsRef.current.clear();
    };
  }, []);

  return (
    <Canvas
      className="game-canvas"
      shadows={settings.shadows}
      dpr={dpr}
      camera={{ fov: 75, near: 0.1, far: 160, position: [0, 1.65, 6] }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <color attach="background" args={["#0b1014"]} />
      <fog attach="fog" args={["#0b1014", 24, 90]} />
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[10, 16, 6]}
        intensity={1.2}
        castShadow={settings.shadows}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={60}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={24}
        shadow-camera-bottom={-24}
      />
      <MapEnvironment shadows={settings.shadows} />
      <Targets targets={targets} shadows={settings.shadows} />
      <StressBoxes count={stressCount} shadows={settings.shadows} />
      <GameplayRuntime
        collisionRects={STATIC_COLLIDERS}
        worldBounds={WORLD_BOUNDS}
        targets={targets}
        onTargetHit={handleTargetHit}
        onResetTargets={handleResetTargets}
        onPlayerSnapshot={onPlayerSnapshot}
        onPerfMetrics={onPerfMetrics}
        onHitMarker={onHitMarker}
        onWeaponEquippedChange={onWeaponEquippedChange}
      />
      {settings.showR3fPerf ? <Perf position="top-left" minimal /> : null}
    </Canvas>
  );
}

type GameplayRuntimeProps = {
  collisionRects: CollisionRect[];
  worldBounds: WorldBounds;
  targets: TargetState[];
  onTargetHit: (targetId: string, nowMs: number) => void;
  onResetTargets: () => void;
  onPlayerSnapshot: (snapshot: PlayerSnapshot) => void;
  onPerfMetrics: (metrics: PerfMetrics) => void;
  onHitMarker: () => void;
  onWeaponEquippedChange: (equipped: boolean) => void;
};

function GameplayRuntime({
  collisionRects,
  worldBounds,
  targets,
  onTargetHit,
  onResetTargets,
  onPlayerSnapshot,
  onPerfMetrics,
  onHitMarker,
  onWeaponEquippedChange,
}: GameplayRuntimeProps) {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);

  const weaponRef = useRef<WeaponSystem>(new WeaponSystem());
  const audioRef = useRef<AudioManager>(new AudioManager());
  const controllerRef = useRef<PlayerControllerApi | null>(null);
  const targetsRef = useRef(targets);

  const playerSnapshotCallbackRef = useRef(onPlayerSnapshot);
  const perfCallbackRef = useRef(onPerfMetrics);
  const targetHitCallbackRef = useRef(onTargetHit);
  const resetTargetsCallbackRef = useRef(onResetTargets);
  const hitMarkerCallbackRef = useRef(onHitMarker);
  const weaponEquippedCallbackRef = useRef(onWeaponEquippedChange);

  const perfAccumulatorRef = useRef(0);
  const fpsFrameCountRef = useRef(0);
  const fpsTimeRef = useRef(0);
  const lastWeaponEquippedRef = useRef<boolean | null>(null);

  const worldGunRef = useRef<THREE.Group>(null);
  const viewWeaponRef = useRef<THREE.Group>(null);
  const muzzleFlashRef = useRef<THREE.Mesh>(null);
  const tracerRef = useRef<THREE.Mesh>(null);

  const tempEndRef = useRef(new THREE.Vector3());
  const tempMidRef = useRef(new THREE.Vector3());
  const tempTracerDirRef = useRef(new THREE.Vector3());
  const tempOffsetRef = useRef(new THREE.Vector3());
  const tempLookDirRef = useRef(new THREE.Vector3());

  useEffect(() => {
    targetsRef.current = targets;
  }, [targets]);

  useEffect(() => {
    playerSnapshotCallbackRef.current = onPlayerSnapshot;
  }, [onPlayerSnapshot]);

  useEffect(() => {
    perfCallbackRef.current = onPerfMetrics;
  }, [onPerfMetrics]);

  useEffect(() => {
    targetHitCallbackRef.current = onTargetHit;
  }, [onTargetHit]);

  useEffect(() => {
    resetTargetsCallbackRef.current = onResetTargets;
  }, [onResetTargets]);

  useEffect(() => {
    hitMarkerCallbackRef.current = onHitMarker;
  }, [onHitMarker]);

  useEffect(() => {
    weaponEquippedCallbackRef.current = onWeaponEquippedChange;
  }, [onWeaponEquippedChange]);

  useEffect(() => {
    return () => {
      audioRef.current.dispose();
    };
  }, []);

  const controller = usePlayerController({
    collisionRects,
    worldBounds,
    onAction: (action) => {
      const weapon = weaponRef.current;
      const playerPosition = controllerRef.current?.getPosition();
      if (!playerPosition) {
        return;
      }

      if (action === "pickup") {
        if (weapon.tryPickup(playerPosition)) {
          weaponEquippedCallbackRef.current(true);
        }
        return;
      }

      if (action === "drop") {
        camera.getWorldDirection(tempLookDirRef.current);
        if (weapon.drop(playerPosition, tempLookDirRef.current)) {
          weaponEquippedCallbackRef.current(false);
        }
        return;
      }

      if (action === "reset") {
        resetTargetsCallbackRef.current();
      }
    },
    onPlayerSnapshot: (snapshot) => {
      const playerPosition = controllerRef.current?.getPosition();
      const canInteract = playerPosition
        ? weaponRef.current.canPickup(playerPosition)
        : false;
      playerSnapshotCallbackRef.current({
        ...snapshot,
        canInteract,
      });
    },
    onTriggerChange: (firing) => {
      weaponRef.current.setTriggerHeld(firing);
    },
    onUserGesture: () => {
      audioRef.current.ensureStarted();
    },
  });

  controllerRef.current = controller;

  useFrame((_, delta) => {
    const clampedDelta = Math.min(delta, 1 / 20);
    const nowMs = performance.now();
    const weapon = weaponRef.current;
    const audio = audioRef.current;

    audio.update(nowMs / 1000, controller.isMoving(), controller.isSprinting());

    const shots = weapon.update(clampedDelta, nowMs, camera);
    for (const shot of shots) {
      audio.playGunshot();
      controller.addRecoil(shot.recoilPitchRadians, shot.recoilYawRadians);

      const hit = raycastTargets(shot.origin, shot.direction, targetsRef.current);
      if (hit) {
        tempEndRef.current.copy(hit.point);
        targetHitCallbackRef.current(hit.id, nowMs);
        hitMarkerCallbackRef.current();
        audio.playHit();
      } else {
        tempEndRef.current
          .copy(shot.origin)
          .addScaledVector(shot.direction, TRACER_DISTANCE);
      }

      weapon.setTracer(shot.origin, tempEndRef.current, nowMs);
    }

    updateWorldGunMesh(worldGunRef.current, weapon, nowMs);
    updateViewWeaponMesh(viewWeaponRef.current, muzzleFlashRef.current, weapon, camera, controller, nowMs, tempOffsetRef.current);
    updateTracerMesh(tracerRef.current, weapon, nowMs, tempMidRef.current, tempTracerDirRef.current);

    const equipped = weapon.isEquipped();
    if (lastWeaponEquippedRef.current !== equipped) {
      lastWeaponEquippedRef.current = equipped;
      weaponEquippedCallbackRef.current(equipped);
    }

    perfAccumulatorRef.current += clampedDelta;
    fpsTimeRef.current += clampedDelta;
    fpsFrameCountRef.current += 1;

    if (perfAccumulatorRef.current >= 0.2) {
      const fps = fpsTimeRef.current > 0 ? fpsFrameCountRef.current / fpsTimeRef.current : 0;
      perfCallbackRef.current({
        fps,
        frameMs: clampedDelta * 1000,
        drawCalls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
      });
      perfAccumulatorRef.current = 0;
      fpsTimeRef.current = 0;
      fpsFrameCountRef.current = 0;
    }
  });

  return (
    <>
      <group ref={worldGunRef} visible>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.7, 0.12, 0.18]} />
          <meshStandardMaterial color="#30363c" roughness={0.6} metalness={0.35} />
        </mesh>
        <mesh position={[0.22, -0.08, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.22, 0.18, 0.06]} />
          <meshStandardMaterial color="#514942" roughness={0.85} metalness={0.1} />
        </mesh>
        <mesh position={[-0.22, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
          <cylinderGeometry args={[0.02, 0.02, 0.55, 10]} />
          <meshStandardMaterial color="#1e2328" roughness={0.5} metalness={0.55} />
        </mesh>
      </group>

      <group ref={viewWeaponRef} visible={false}>
        <mesh>
          <boxGeometry args={[0.55, 0.09, 0.13]} />
          <meshStandardMaterial color="#30363c" roughness={0.55} metalness={0.4} />
        </mesh>
        <mesh position={[0.16, -0.08, 0.01]} rotation={[0.15, 0, -0.2]}>
          <boxGeometry args={[0.18, 0.17, 0.05]} />
          <meshStandardMaterial color="#4d463f" roughness={0.85} metalness={0.1} />
        </mesh>
        <mesh position={[-0.24, 0.015, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.015, 0.015, 0.42, 8]} />
          <meshStandardMaterial color="#20262b" roughness={0.4} metalness={0.6} />
        </mesh>
        <mesh ref={muzzleFlashRef} position={[-0.44, 0.02, 0]} visible={false}>
          <sphereGeometry args={[0.05, 8, 8]} />
          <meshBasicMaterial color="#ffd085" transparent opacity={0.9} />
        </mesh>
      </group>

      <mesh ref={tracerRef} visible={false}>
        <boxGeometry args={[0.02, 0.02, 1]} />
        <meshBasicMaterial color="#ffe3a6" transparent opacity={0.75} />
      </mesh>
    </>
  );
}

type MapEnvironmentProps = {
  shadows: boolean;
};

function MapEnvironment({ shadows }: MapEnvironmentProps) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow={shadows}>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#2a3432" roughness={0.95} metalness={0.02} />
      </mesh>

      <gridHelper args={[80, 40, "#2f4f61", "#1a232a"]} position={[0, 0.02, 0]} />

      <CoverBlock position={[-6, 1.1, -2]} size={[2.4, 2.2, 2.2]} shadows={shadows} color="#5a6269" />
      <CoverBlock position={[-2, 0.9, -8]} size={[2.5, 1.8, 1.8]} shadows={shadows} color="#53606b" />
      <CoverBlock position={[4, 1.1, -11.5]} size={[3.8, 2.2, 2.2]} shadows={shadows} color="#616c77" />
      <CoverBlock position={[13, 1.1, 5]} size={[3, 2.2, 2.2]} shadows={shadows} color="#6f6d62" />

      <BuildingShell shadows={shadows} />

      <mesh position={[0, 0.02, -24]} receiveShadow={shadows}>
        <boxGeometry args={[24, 0.05, 12]} />
        <meshStandardMaterial color="#1e2327" roughness={1} metalness={0} />
      </mesh>
    </group>
  );
}

type CoverBlockProps = {
  position: [number, number, number];
  size: [number, number, number];
  shadows: boolean;
  color: string;
};

function CoverBlock({ position, size, shadows, color }: CoverBlockProps) {
  return (
    <mesh position={position} castShadow={shadows} receiveShadow={shadows}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.86} metalness={0.08} />
    </mesh>
  );
}

function BuildingShell({ shadows }: { shadows: boolean }) {
  const leftSouthWidth = (BUILDING_WIDTH - DOOR_GAP_WIDTH) / 2;
  const rightSouthWidth = leftSouthWidth;

  return (
    <group position={[BUILDING_CENTER.x, 0, BUILDING_CENTER.z]}>
      <mesh position={[0, 0.01, 0]} receiveShadow={shadows}>
        <boxGeometry args={[BUILDING_WIDTH, 0.02, BUILDING_DEPTH]} />
        <meshStandardMaterial color="#31302b" roughness={0.98} metalness={0} />
      </mesh>

      <mesh
        position={[-BUILDING_WIDTH / 2 + WALL_THICKNESS / 2, BUILDING_HEIGHT / 2, 0]}
        castShadow={shadows}
        receiveShadow={shadows}
      >
        <boxGeometry args={[WALL_THICKNESS, BUILDING_HEIGHT, BUILDING_DEPTH]} />
        <meshStandardMaterial color="#7f7462" roughness={0.85} metalness={0.05} />
      </mesh>
      <mesh
        position={[BUILDING_WIDTH / 2 - WALL_THICKNESS / 2, BUILDING_HEIGHT / 2, 0]}
        castShadow={shadows}
        receiveShadow={shadows}
      >
        <boxGeometry args={[WALL_THICKNESS, BUILDING_HEIGHT, BUILDING_DEPTH]} />
        <meshStandardMaterial color="#7f7462" roughness={0.85} metalness={0.05} />
      </mesh>
      <mesh
        position={[0, BUILDING_HEIGHT / 2, -BUILDING_DEPTH / 2 + WALL_THICKNESS / 2]}
        castShadow={shadows}
        receiveShadow={shadows}
      >
        <boxGeometry args={[BUILDING_WIDTH, BUILDING_HEIGHT, WALL_THICKNESS]} />
        <meshStandardMaterial color="#7f7462" roughness={0.85} metalness={0.05} />
      </mesh>
      <mesh
        position={[
          -DOOR_GAP_WIDTH / 2 - leftSouthWidth / 2,
          BUILDING_HEIGHT / 2,
          BUILDING_DEPTH / 2 - WALL_THICKNESS / 2,
        ]}
        castShadow={shadows}
        receiveShadow={shadows}
      >
        <boxGeometry args={[leftSouthWidth, BUILDING_HEIGHT, WALL_THICKNESS]} />
        <meshStandardMaterial color="#7f7462" roughness={0.85} metalness={0.05} />
      </mesh>
      <mesh
        position={[
          DOOR_GAP_WIDTH / 2 + rightSouthWidth / 2,
          BUILDING_HEIGHT / 2,
          BUILDING_DEPTH / 2 - WALL_THICKNESS / 2,
        ]}
        castShadow={shadows}
        receiveShadow={shadows}
      >
        <boxGeometry args={[rightSouthWidth, BUILDING_HEIGHT, WALL_THICKNESS]} />
        <meshStandardMaterial color="#7f7462" roughness={0.85} metalness={0.05} />
      </mesh>

      <mesh position={[0, BUILDING_HEIGHT + 0.1, 0]} castShadow={shadows} receiveShadow={shadows}>
        <boxGeometry args={[BUILDING_WIDTH + 0.5, 0.2, BUILDING_DEPTH + 0.5]} />
        <meshStandardMaterial color="#5f5549" roughness={0.9} metalness={0.05} />
      </mesh>

      <mesh position={[0, DOOR_HEIGHT / 2, BUILDING_DEPTH / 2 - 0.03]} castShadow={shadows} receiveShadow={shadows}>
        <boxGeometry args={[DOOR_GAP_WIDTH - 0.15, DOOR_HEIGHT, 0.05]} />
        <meshStandardMaterial
          color="#39342e"
          roughness={0.7}
          metalness={0.12}
          transparent
          opacity={0.45}
        />
      </mesh>
    </group>
  );
}

function StressBoxes({ count, shadows }: { count: StressModeCount; shadows: boolean }) {
  const instances = useMemo(() => {
    if (count === 0) {
      return [] as Array<{
        position: [number, number, number];
        scale: [number, number, number];
        color: string;
      }>;
    }

    const next: Array<{
      position: [number, number, number];
      scale: [number, number, number];
      color: string;
    }> = [];
    const side = Math.ceil(Math.sqrt(count));
    for (let i = 0; i < count; i += 1) {
      const row = Math.floor(i / side);
      const col = i % side;
      const x = -18 + col * 1.8;
      const z = 10 + row * 1.8;
      const height = 0.4 + ((i % 5) * 0.22 + 0.2);
      next.push({
        position: [x, height / 2, z],
        scale: [0.9, height, 0.9],
        color: i % 2 === 0 ? "#465663" : "#59696c",
      });
    }
    return next;
  }, [count]);

  if (instances.length === 0) {
    return null;
  }

  return (
    <group>
      {instances.map((instance, index) => (
        <mesh
          key={`${index}-${instance.position[0]}-${instance.position[2]}`}
          position={instance.position}
          castShadow={shadows}
          receiveShadow={shadows}
        >
          <boxGeometry args={instance.scale} />
          <meshStandardMaterial color={instance.color} roughness={0.8} metalness={0.08} />
        </mesh>
      ))}
    </group>
  );
}

function updateWorldGunMesh(
  mesh: THREE.Group | null,
  weapon: WeaponSystem,
  nowMs: number,
) {
  if (!mesh) {
    return;
  }

  const visible = !weapon.isEquipped();
  mesh.visible = visible;
  if (!visible) {
    return;
  }

  const droppedPosition = weapon.getDroppedPosition();
  mesh.position.set(
    droppedPosition.x,
    droppedPosition.y + Math.sin(nowMs * 0.006) * 0.04,
    droppedPosition.z,
  );
  mesh.rotation.set(0.2, nowMs * 0.0016, 0);
}

function updateViewWeaponMesh(
  viewMesh: THREE.Group | null,
  muzzleFlashMesh: THREE.Mesh | null,
  weapon: WeaponSystem,
  camera: THREE.Camera,
  controller: PlayerControllerApi,
  nowMs: number,
  tempOffset: THREE.Vector3,
) {
  if (!viewMesh) {
    return;
  }

  const visible = weapon.isEquipped();
  viewMesh.visible = visible;
  if (!visible) {
    if (muzzleFlashMesh) {
      muzzleFlashMesh.visible = false;
    }
    return;
  }

  const swayX = controller.isMoving() ? Math.sin(nowMs * 0.01) * 0.015 : 0;
  const swayY = controller.isMoving() ? Math.cos(nowMs * 0.016) * 0.008 : 0;
  tempOffset.set(0.24 + swayX, -0.19 + swayY, -0.45);
  tempOffset.applyQuaternion(camera.quaternion);

  viewMesh.position.copy(camera.position).add(tempOffset);
  viewMesh.quaternion.copy(camera.quaternion);

  if (muzzleFlashMesh) {
    muzzleFlashMesh.visible = weapon.hasMuzzleFlash(nowMs);
  }
}

function updateTracerMesh(
  tracerMesh: THREE.Mesh | null,
  weapon: WeaponSystem,
  nowMs: number,
  tempMid: THREE.Vector3,
  tempDir: THREE.Vector3,
) {
  if (!tracerMesh) {
    return;
  }

  const tracer = weapon.getActiveTracer(nowMs);
  if (!tracer) {
    tracerMesh.visible = false;
    return;
  }

  tempDir.copy(tracer.to).sub(tracer.from);
  const length = tempDir.length();
  if (length <= 0.0001) {
    tracerMesh.visible = false;
    return;
  }

  tracerMesh.visible = true;
  tempMid.copy(tracer.from).lerp(tracer.to, 0.5);
  tracerMesh.position.copy(tempMid);
  tracerMesh.scale.set(1, 1, length);
  tracerMesh.quaternion.setFromUnitVectors(Z_AXIS, tempDir.normalize());
}

function boxRect(center: { x: number; z: number }, width: number, depth: number): CollisionRect {
  const halfW = width / 2;
  const halfD = depth / 2;
  return {
    minX: center.x - halfW,
    maxX: center.x + halfW,
    minZ: center.z - halfD,
    maxZ: center.z + halfD,
  };
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);
