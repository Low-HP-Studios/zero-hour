import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Perf } from "r3f-perf";
import * as THREE from "three";
import { usePlayerController } from "./PlayerController";
import { Targets } from "./Targets";
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

const STATIC_COLLIDERS: CollisionRect[] = [
  boxRect({ x: -6, z: -2 }, 2.4, 2.2),
  boxRect({ x: -2, z: -8 }, 2.5, 1.8),
  boxRect({ x: 4, z: -11.5 }, 3.8, 2.2),
  boxRect({ x: 13, z: 5 }, 3, 2.2),
  // Building walls (door opening on the south wall)
  boxRect({ x: BUILDING_CENTER.x - BUILDING_WIDTH / 2 + WALL_THICKNESS / 2, z: BUILDING_CENTER.z }, WALL_THICKNESS, BUILDING_DEPTH),
  boxRect({ x: BUILDING_CENTER.x + BUILDING_WIDTH / 2 - WALL_THICKNESS / 2, z: BUILDING_CENTER.z }, WALL_THICKNESS, BUILDING_DEPTH),
  boxRect({ x: BUILDING_CENTER.x, z: BUILDING_CENTER.z - BUILDING_DEPTH / 2 + WALL_THICKNESS / 2 }, BUILDING_WIDTH, WALL_THICKNESS),
  boxRect(
    {
      x:
        BUILDING_CENTER.x - (DOOR_GAP_WIDTH / 2 + (BUILDING_WIDTH - DOOR_GAP_WIDTH) / 4),
      z: BUILDING_CENTER.z + BUILDING_DEPTH / 2 - WALL_THICKNESS / 2,
    },
    (BUILDING_WIDTH - DOOR_GAP_WIDTH) / 2,
    WALL_THICKNESS,
  ),
  boxRect(
    {
      x:
        BUILDING_CENTER.x + (DOOR_GAP_WIDTH / 2 + (BUILDING_WIDTH - DOOR_GAP_WIDTH) / 4),
      z: BUILDING_CENTER.z + BUILDING_DEPTH / 2 - WALL_THICKNESS / 2,
    },
    (BUILDING_WIDTH - DOOR_GAP_WIDTH) / 2,
    WALL_THICKNESS,
  ),
];

const BASE_TARGETS: TargetState[] = [
  { id: "t1", position: [-8, 1.5, -12], radius: 0.45, hitUntil: 0, disabled: false },
  { id: "t2", position: [1, 1.5, -15], radius: 0.45, hitUntil: 0, disabled: false },
  { id: "t3", position: [14, 1.5, -7], radius: 0.45, hitUntil: 0, disabled: false },
];

export function Scene({ settings, stressCount, onPlayerSnapshot, onPerfMetrics }: SceneProps) {
  const dpr = useMemo(() => {
    const devicePixelRatio = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    return Math.min(2, Math.max(0.5, devicePixelRatio * settings.pixelRatioScale));
  }, [settings.pixelRatioScale]);

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
      <Targets targets={BASE_TARGETS} now={performance.now()} shadows={settings.shadows} />
      <StressBoxes count={stressCount} shadows={settings.shadows} />
      <GameplayRuntime
        collisionRects={STATIC_COLLIDERS}
        worldBounds={WORLD_BOUNDS}
        onPlayerSnapshot={onPlayerSnapshot}
        onPerfMetrics={onPerfMetrics}
      />
      {settings.showR3fPerf ? <Perf position="top-left" minimal /> : null}
    </Canvas>
  );
}

type GameplayRuntimeProps = {
  collisionRects: CollisionRect[];
  worldBounds: WorldBounds;
  onPlayerSnapshot: (snapshot: PlayerSnapshot) => void;
  onPerfMetrics: (metrics: PerfMetrics) => void;
};

function GameplayRuntime({ collisionRects, worldBounds, onPlayerSnapshot, onPerfMetrics }: GameplayRuntimeProps) {
  const perfCallbackRef = useRef(onPerfMetrics);
  const playerCallbackRef = useRef(onPlayerSnapshot);
  const perfAccumulatorRef = useRef(0);
  const fpsFrameCountRef = useRef(0);
  const fpsTimeRef = useRef(0);

  useEffect(() => {
    perfCallbackRef.current = onPerfMetrics;
  }, [onPerfMetrics]);

  useEffect(() => {
    playerCallbackRef.current = onPlayerSnapshot;
  }, [onPlayerSnapshot]);

  usePlayerController({
    collisionRects,
    worldBounds,
    onAction: () => {
      // Step 4/5 wire this to weapon + target reset actions.
    },
    onPlayerSnapshot: (snapshot) => {
      playerCallbackRef.current(snapshot);
    },
    onTriggerChange: () => {
      // Step 4 wire this to automatic fire.
    },
    onUserGesture: () => {
      // Step 6 initializes audio here.
    },
  });

  const gl = useThree((state) => state.gl);

  useFrame((_, delta) => {
    perfAccumulatorRef.current += delta;
    fpsTimeRef.current += delta;
    fpsFrameCountRef.current += 1;

    if (perfAccumulatorRef.current < 0.2) {
      return;
    }

    const fps = fpsTimeRef.current > 0 ? fpsFrameCountRef.current / fpsTimeRef.current : 0;
    fpsTimeRef.current = 0;
    fpsFrameCountRef.current = 0;
    perfAccumulatorRef.current = 0;

    perfCallbackRef.current({
      fps,
      frameMs: delta * 1000,
      drawCalls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
    });
  });

  return null;
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
  const wallMaterial = <meshStandardMaterial color="#7f7462" roughness={0.85} metalness={0.05} />;
  const roofMaterial = <meshStandardMaterial color="#5f5549" roughness={0.9} metalness={0.05} />;

  const leftSouthWidth = (BUILDING_WIDTH - DOOR_GAP_WIDTH) / 2;
  const rightSouthWidth = leftSouthWidth;

  return (
    <group position={[BUILDING_CENTER.x, 0, BUILDING_CENTER.z]}>
      <mesh position={[0, 0.01, 0]} receiveShadow={shadows}>
        <boxGeometry args={[BUILDING_WIDTH, 0.02, BUILDING_DEPTH]} />
        <meshStandardMaterial color="#31302b" roughness={0.98} metalness={0} />
      </mesh>

      <mesh position={[-BUILDING_WIDTH / 2 + WALL_THICKNESS / 2, BUILDING_HEIGHT / 2, 0]} castShadow={shadows} receiveShadow={shadows}>
        <boxGeometry args={[WALL_THICKNESS, BUILDING_HEIGHT, BUILDING_DEPTH]} />
        {wallMaterial}
      </mesh>
      <mesh position={[BUILDING_WIDTH / 2 - WALL_THICKNESS / 2, BUILDING_HEIGHT / 2, 0]} castShadow={shadows} receiveShadow={shadows}>
        <boxGeometry args={[WALL_THICKNESS, BUILDING_HEIGHT, BUILDING_DEPTH]} />
        {wallMaterial}
      </mesh>
      <mesh position={[0, BUILDING_HEIGHT / 2, -BUILDING_DEPTH / 2 + WALL_THICKNESS / 2]} castShadow={shadows} receiveShadow={shadows}>
        <boxGeometry args={[BUILDING_WIDTH, BUILDING_HEIGHT, WALL_THICKNESS]} />
        {wallMaterial}
      </mesh>
      <mesh
        position={[-DOOR_GAP_WIDTH / 2 - leftSouthWidth / 2, BUILDING_HEIGHT / 2, BUILDING_DEPTH / 2 - WALL_THICKNESS / 2]}
        castShadow={shadows}
        receiveShadow={shadows}
      >
        <boxGeometry args={[leftSouthWidth, BUILDING_HEIGHT, WALL_THICKNESS]} />
        {wallMaterial}
      </mesh>
      <mesh
        position={[DOOR_GAP_WIDTH / 2 + rightSouthWidth / 2, BUILDING_HEIGHT / 2, BUILDING_DEPTH / 2 - WALL_THICKNESS / 2]}
        castShadow={shadows}
        receiveShadow={shadows}
      >
        <boxGeometry args={[rightSouthWidth, BUILDING_HEIGHT, WALL_THICKNESS]} />
        {wallMaterial}
      </mesh>

      <mesh position={[0, BUILDING_HEIGHT + 0.1, 0]} castShadow={shadows} receiveShadow={shadows}>
        <boxGeometry args={[BUILDING_WIDTH + 0.5, 0.2, BUILDING_DEPTH + 0.5]} />
        {roofMaterial}
      </mesh>

      <mesh position={[0, DOOR_HEIGHT / 2, BUILDING_DEPTH / 2 - 0.03]} castShadow={shadows} receiveShadow={shadows}>
        <boxGeometry args={[DOOR_GAP_WIDTH - 0.15, DOOR_HEIGHT, 0.05]} />
        <meshStandardMaterial color="#39342e" roughness={0.7} metalness={0.12} transparent opacity={0.45} />
      </mesh>
    </group>
  );
}

function StressBoxes({ count, shadows }: { count: StressModeCount; shadows: boolean }) {
  const instances = useMemo(() => {
    if (count === 0) {
      return [] as Array<{ position: [number, number, number]; scale: [number, number, number]; color: string }>;
    }

    const next: Array<{ position: [number, number, number]; scale: [number, number, number]; color: string }> = [];
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
        <mesh key={`${index}-${instance.position[0]}-${instance.position[2]}`} position={instance.position} castShadow={shadows} receiveShadow={shadows}>
          <boxGeometry args={instance.scale} />
          <meshStandardMaterial color={instance.color} roughness={0.8} metalness={0.08} />
        </mesh>
      ))}
    </group>
  );
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
