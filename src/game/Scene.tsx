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
import { AudioManager, type AudioVolumeSettings } from "./Audio";
import { usePlayerController, type PlayerControllerApi } from "./PlayerController";
import {
  Targets,
  createDefaultTargets,
  raycastTargets,
  resetTargets,
  DAMAGE_PER_SHOT,
  RESPAWN_DELAY_MS,
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
  audioVolumes: AudioVolumeSettings;
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
  audioVolumes,
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
        previousTargets.map((target) => {
          if (target.id !== targetId) return target;
          const newHp = Math.max(0, target.hp - DAMAGE_PER_SHOT);
          const destroyed = newHp <= 0;
          return {
            ...target,
            hp: newHp,
            disabled: destroyed,
            hitUntil: nowMs + TARGET_FLASH_MS,
          };
        }),
      );
    });

    setTargets((prev) => {
      const target = prev.find((t) => t.id === targetId);
      if (target && target.hp - DAMAGE_PER_SHOT <= 0) {
        const existing = resetTimeoutsRef.current.get(targetId);
        if (existing !== undefined) {
          window.clearTimeout(existing);
        }
        const timeoutId = window.setTimeout(() => {
          resetTimeoutsRef.current.delete(targetId);
          startTransition(() => {
            setTargets((previousTargets) =>
              previousTargets.map((t) =>
                t.id === targetId ? { ...t, disabled: false, hp: t.maxHp } : t,
              ),
            );
          });
        }, RESPAWN_DELAY_MS);
        resetTimeoutsRef.current.set(targetId, timeoutId);
      }
      return prev;
    });
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
    const timeoutMap = resetTimeoutsRef.current;
    return () => {
      for (const timeoutId of timeoutMap.values()) {
        window.clearTimeout(timeoutId);
      }
      timeoutMap.clear();
    };
  }, []);

  return (
    <Canvas
      className="game-canvas"
      shadows={settings.shadows}
      dpr={dpr}
      camera={{ fov: 65, near: 0.1, far: 160, position: [0, 3.5, 12] }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <color attach="background" args={["#d5eeff"]} />
      <fog attach="fog" args={["#dff2ff", 42, 140]} />
      <hemisphereLight args={["#f0fbff", "#d0c4a2", 0.65]} />
      <ambientLight intensity={0.48} />
      <directionalLight
        position={[22, 28, 12]}
        intensity={2.1}
        color="#fff0c4"
        castShadow={settings.shadows}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={90}
        shadow-camera-left={-34}
        shadow-camera-right={34}
        shadow-camera-top={34}
        shadow-camera-bottom={-34}
      />
      <MapEnvironment shadows={settings.shadows} />
      <Targets targets={targets} shadows={settings.shadows} />
      <StressBoxes count={stressCount} shadows={settings.shadows} />
      <GameplayRuntime
        collisionRects={STATIC_COLLIDERS}
        worldBounds={WORLD_BOUNDS}
        audioVolumes={audioVolumes}
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
  audioVolumes: AudioVolumeSettings;
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
  audioVolumes,
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
  const playerCharacterRef = useRef<THREE.Group>(null);
  const characterWeaponRef = useRef<THREE.Group>(null);
  const characterMuzzleRef = useRef<THREE.Mesh>(null);
  const tracerRef = useRef<THREE.Mesh>(null);

  const tempEndRef = useRef(new THREE.Vector3());
  const tempMidRef = useRef(new THREE.Vector3());
  const tempTracerDirRef = useRef(new THREE.Vector3());
  const tempLookDirRef = useRef(new THREE.Vector3());
  const tempTracerOriginRef = useRef(new THREE.Vector3());

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
    const audio = audioRef.current;
    return () => {
      audio.dispose();
    };
  }, []);

  useEffect(() => {
    audioRef.current.setVolumes(audioVolumes);
  }, [audioVolumes]);

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

    audio.update(
      nowMs / 1000,
      controller.isMoving() && controller.isGrounded(),
      controller.isSprinting(),
    );

    const shots = weapon.update(clampedDelta, nowMs, camera);
    for (const shot of shots) {
      audio.playGunshot();
      controller.addRecoil(shot.recoilPitchRadians, shot.recoilYawRadians);

      const hit = raycastTargets(shot.origin, shot.direction, targetsRef.current);

      const playerPos = controller.getPosition();
      const tracerOrigin = tempTracerOriginRef.current;
      tracerOrigin.set(playerPos.x, playerPos.y + 1.0, playerPos.z);
      tracerOrigin.addScaledVector(shot.direction, 0.6);

      if (hit) {
        tempEndRef.current.copy(hit.point);
        targetHitCallbackRef.current(hit.id, nowMs);
        hitMarkerCallbackRef.current();
        audio.playHit();
      } else {
        tempEndRef.current
          .copy(tracerOrigin)
          .addScaledVector(shot.direction, TRACER_DISTANCE);
      }

      weapon.setTracer(tracerOrigin, tempEndRef.current, nowMs);
    }

    const playerChar = playerCharacterRef.current;
    if (playerChar) {
      const pos = controller.getPosition();
      playerChar.position.set(pos.x, pos.y, pos.z);
      playerChar.rotation.y = controller.getYaw();
    }

    updateWorldGunMesh(worldGunRef.current, weapon, nowMs);
    updateCharacterWeaponMesh(characterWeaponRef.current, characterMuzzleRef.current, weapon, nowMs);
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
      <group ref={playerCharacterRef}>
        {/* Torso */}
        <mesh position={[0, 1.0, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.4, 0.55, 0.25]} />
          <meshStandardMaterial color="#4a6b82" roughness={0.7} metalness={0.1} />
        </mesh>
        {/* Head */}
        <mesh position={[0, 1.48, 0]} castShadow receiveShadow>
          <sphereGeometry args={[0.14, 12, 12]} />
          <meshStandardMaterial color="#e8c9a4" roughness={0.85} metalness={0} />
        </mesh>
        {/* Left leg */}
        <mesh position={[-0.1, 0.3, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.14, 0.6, 0.16]} />
          <meshStandardMaterial color="#3a4d5c" roughness={0.8} metalness={0.05} />
        </mesh>
        {/* Right leg */}
        <mesh position={[0.1, 0.3, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.14, 0.6, 0.16]} />
          <meshStandardMaterial color="#3a4d5c" roughness={0.8} metalness={0.05} />
        </mesh>
        {/* Left arm */}
        <mesh position={[-0.28, 0.92, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.12, 0.48, 0.12]} />
          <meshStandardMaterial color="#4a6b82" roughness={0.7} metalness={0.1} />
        </mesh>
        {/* Right arm */}
        <mesh position={[0.28, 0.92, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.12, 0.48, 0.12]} />
          <meshStandardMaterial color="#4a6b82" roughness={0.7} metalness={0.1} />
        </mesh>

        {/* Character-held weapon */}
        <group ref={characterWeaponRef} position={[0.34, 0.82, -0.2]} visible={false}>
          <mesh castShadow receiveShadow>
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
          <mesh ref={characterMuzzleRef} position={[-0.44, 0.02, 0]} visible={false}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshBasicMaterial color="#ffd085" transparent opacity={0.9} />
          </mesh>
        </group>
      </group>

      {/* World gun (dropped state) */}
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
      <mesh position={[54, 42, -32]}>
        <sphereGeometry args={[4.8, 20, 20]} />
        <meshBasicMaterial color="#ffe28f" />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow={shadows}>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#94b68d" roughness={0.96} metalness={0.02} />
      </mesh>

      <gridHelper args={[80, 40, "#8db4c6", "#cde3ee"]} position={[0, 0.02, 0]} />

      <CoverBlock position={[-6, 1.1, -2]} size={[2.4, 2.2, 2.2]} shadows={shadows} color="#b7bcc3" />
      <CoverBlock position={[-2, 0.9, -8]} size={[2.5, 1.8, 1.8]} shadows={shadows} color="#a8b6c0" />
      <CoverBlock position={[4, 1.1, -11.5]} size={[3.8, 2.2, 2.2]} shadows={shadows} color="#bcc7d0" />
      <CoverBlock position={[13, 1.1, 5]} size={[3, 2.2, 2.2]} shadows={shadows} color="#c9c1b0" />

      <BuildingShell shadows={shadows} />

      <mesh position={[0, 0.02, -24]} receiveShadow={shadows}>
        <boxGeometry args={[24, 0.05, 12]} />
        <meshStandardMaterial color="#7f8d95" roughness={0.95} metalness={0} />
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
        <meshStandardMaterial color="#a6a295" roughness={0.98} metalness={0} />
      </mesh>

      <mesh
        position={[-BUILDING_WIDTH / 2 + WALL_THICKNESS / 2, BUILDING_HEIGHT / 2, 0]}
        castShadow={shadows}
        receiveShadow={shadows}
      >
        <boxGeometry args={[WALL_THICKNESS, BUILDING_HEIGHT, BUILDING_DEPTH]} />
        <meshStandardMaterial color="#ddd0b7" roughness={0.82} metalness={0.03} />
      </mesh>
      <mesh
        position={[BUILDING_WIDTH / 2 - WALL_THICKNESS / 2, BUILDING_HEIGHT / 2, 0]}
        castShadow={shadows}
        receiveShadow={shadows}
      >
        <boxGeometry args={[WALL_THICKNESS, BUILDING_HEIGHT, BUILDING_DEPTH]} />
        <meshStandardMaterial color="#ddd0b7" roughness={0.82} metalness={0.03} />
      </mesh>
      <mesh
        position={[0, BUILDING_HEIGHT / 2, -BUILDING_DEPTH / 2 + WALL_THICKNESS / 2]}
        castShadow={shadows}
        receiveShadow={shadows}
      >
        <boxGeometry args={[BUILDING_WIDTH, BUILDING_HEIGHT, WALL_THICKNESS]} />
        <meshStandardMaterial color="#ddd0b7" roughness={0.82} metalness={0.03} />
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
        <meshStandardMaterial color="#ddd0b7" roughness={0.82} metalness={0.03} />
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
        <meshStandardMaterial color="#ddd0b7" roughness={0.82} metalness={0.03} />
      </mesh>

      <mesh position={[0, BUILDING_HEIGHT + 0.1, 0]} castShadow={shadows} receiveShadow={shadows}>
        <boxGeometry args={[BUILDING_WIDTH + 0.5, 0.2, BUILDING_DEPTH + 0.5]} />
        <meshStandardMaterial color="#af8868" roughness={0.86} metalness={0.04} />
      </mesh>

      <mesh position={[0, DOOR_HEIGHT / 2, BUILDING_DEPTH / 2 - 0.03]} castShadow={shadows} receiveShadow={shadows}>
        <boxGeometry args={[DOOR_GAP_WIDTH - 0.15, DOOR_HEIGHT, 0.05]} />
        <meshStandardMaterial
          color="#8a7a66"
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
        color: i % 2 === 0 ? "#a3b6c0" : "#b8c7c7",
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

function updateCharacterWeaponMesh(
  weaponGroup: THREE.Group | null,
  muzzleFlashMesh: THREE.Mesh | null,
  weapon: WeaponSystem,
  nowMs: number,
) {
  if (!weaponGroup) {
    return;
  }

  const equipped = weapon.isEquipped();
  weaponGroup.visible = equipped;
  if (!equipped) {
    if (muzzleFlashMesh) {
      muzzleFlashMesh.visible = false;
    }
    return;
  }

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
