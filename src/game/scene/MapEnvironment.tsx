import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { createNightSkyTexture } from "./Textures";
import type { StressModeCount } from "../types";
import {
  CLIFF_HEIGHT,
  CLIFF_THICKNESS,
  OCEAN_LEVEL_Y,
  OCEAN_SIZE,
  SHORE_FOAM_RING_PADDING,
  SHORE_SHELF_PADDING,
  SHORE_SHELF_Y,
  WALKABLE_CENTER_X,
  WALKABLE_CENTER_Z,
  WALKABLE_SIZE_X,
  WALKABLE_SIZE_Z,
  WORLD_BOUNDS,
} from "./scene-constants";
import {
  createOceanTexture,
  createSandTexture,
  createSkyTexture,
} from "./Textures";

const VOID_SKY = new THREE.Color("#0a1628");
const LIVE_SKY = new THREE.Color("#86c8ff");
const VOID_OCEAN = new THREE.Color("#071420");
const LIVE_OCEAN = new THREE.Color("#2b5f77");
const VOID_SHELF = new THREE.Color("#1a1812");
const LIVE_SHELF = new THREE.Color("#b79059");
const VOID_WALKABLE = new THREE.Color("#1c1a14");
const LIVE_WALKABLE = new THREE.Color("#ebd6a8");
const VOID_CLIFF = new THREE.Color("#151210");
const LIVE_CLIFF = new THREE.Color("#7d6445");
const MOON_COLOR = new THREE.Color("#e8eaf0");
const MOON_GLOW_COLOR = new THREE.Color("#9ab0d0");
const OUTLINE_COLOR = new THREE.Color("#edf1fb");
const GRID_MAJOR_COLOR = new THREE.Color("#8fb3ff");
const GRID_MINOR_COLOR = new THREE.Color("#ffffff");
const SUN_CORE_COLOR = new THREE.Color("#ffe0b0");
const SUN_GLOW_COLOR = new THREE.Color("#ffb279");
const FLOOR_GRID_DIVISIONS = 16;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function blendColor(from: THREE.Color, to: THREE.Color, amount: number) {
  return new THREE.Color().copy(from).lerp(to, clamp01(amount));
}

function OutlinePlane({
  size,
  position,
  rotation,
  opacity,
}: {
  size: [number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  opacity: number;
}) {
  if (opacity <= 0.001) {
    return null;
  }

  return (
    <lineSegments position={position} rotation={rotation} renderOrder={4}>
      <edgesGeometry args={[new THREE.PlaneGeometry(size[0], size[1])]} />
      <lineBasicMaterial
        color={OUTLINE_COLOR}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </lineSegments>
  );
}

function OutlineBox({
  size,
  position,
  opacity,
}: {
  size: [number, number, number];
  position: [number, number, number];
  opacity: number;
}) {
  if (opacity <= 0.001) {
    return null;
  }

  return (
    <lineSegments position={position} renderOrder={4}>
      <edgesGeometry args={[new THREE.BoxGeometry(size[0], size[1], size[2])]} />
      <lineBasicMaterial
        color={OUTLINE_COLOR}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </lineSegments>
  );
}

export type MapEnvironmentProps = {
  shadows: boolean;
  theme: number;
  floorGridOpacity: number;
};

export function MapEnvironment({
  shadows,
  theme,
  floorGridOpacity,
}: MapEnvironmentProps) {
  const sandTexture = useMemo(() => createSandTexture(), []);
  const oceanTexture = useMemo(() => createOceanTexture(), []);
  const skyTexture = useMemo(() => createSkyTexture(), []);
  const floorGridRef = useRef<THREE.GridHelper>(null);

  useEffect(() => {
    return () => {
      skyTexture?.dispose();
      sandTexture?.dispose();
      oceanTexture?.dispose();
    };
  }, [oceanTexture, sandTexture, skyTexture]);

  useFrame((_, delta) => {
    if (!oceanTexture || theme <= 0.55) {
      return;
    }
    oceanTexture.offset.x = (oceanTexture.offset.x + delta * 0.012) % 1;
    oceanTexture.offset.y = (oceanTexture.offset.y + delta * 0.006) % 1;
  });

  const liveTheme = clamp01(theme);
  const outlineOpacity = 0.08 + (1 - liveTheme) * 0.78;
  const textureReveal = clamp01((liveTheme - 0.52) / 0.48);
  const sunOpacity = clamp01((liveTheme - 0.42) / 0.48);
  const shelfSizeX = WALKABLE_SIZE_X + SHORE_SHELF_PADDING * 2;
  const shelfSizeZ = WALKABLE_SIZE_Z + SHORE_SHELF_PADDING * 2;
  const foamRingSizeX = WALKABLE_SIZE_X + SHORE_FOAM_RING_PADDING * 2;
  const foamRingSizeZ = WALKABLE_SIZE_Z + SHORE_FOAM_RING_PADDING * 2;
  const cliffY = 0 - CLIFF_HEIGHT / 2;
  const allowTextures = textureReveal > 0.001;
  const shadowEnabled = shadows && liveTheme > 0.6;

  useEffect(() => {
    const helper = floorGridRef.current;
    if (!helper) {
      return;
    }

    const materials = Array.isArray(helper.material)
      ? helper.material
      : [helper.material];

    for (const material of materials) {
      const lineMaterial = material as THREE.LineBasicMaterial;
      lineMaterial.transparent = true;
      lineMaterial.opacity = floorGridOpacity;
      lineMaterial.depthWrite = false;
      lineMaterial.needsUpdate = true;
    }
  }, [floorGridOpacity]);

  const nightSkyTexture = useMemo(() => createNightSkyTexture(), []);
  const moonOpacity = clamp01(1 - liveTheme * 2.2);

  useEffect(() => {
    return () => {
      nightSkyTexture?.dispose();
    };
  }, [nightSkyTexture]);

  return (
    <group>
      <mesh>
        <sphereGeometry args={[560, 48, 32]} />
        <meshBasicMaterial
          color={blendColor(VOID_SKY, LIVE_SKY, textureReveal)}
          map={allowTextures ? skyTexture ?? undefined : (nightSkyTexture ?? undefined)}
          side={THREE.BackSide}
          depthWrite={false}
          fog={false}
        />
      </mesh>

      {/* Moon – visible during night/menu, fades out as day theme comes in */}
      {moonOpacity > 0.001 ? (
        <group position={[-140, 180, -220]}>
          <mesh>
            <sphereGeometry args={[12, 32, 32]} />
            <meshBasicMaterial
              color={MOON_COLOR}
              transparent
              opacity={moonOpacity}
            />
          </mesh>
          <mesh>
            <sphereGeometry args={[18, 28, 28]} />
            <meshBasicMaterial
              color={MOON_GLOW_COLOR}
              transparent
              opacity={moonOpacity * 0.18}
              depthWrite={false}
            />
          </mesh>
          <mesh>
            <sphereGeometry args={[28, 24, 24]} />
            <meshBasicMaterial
              color={MOON_GLOW_COLOR}
              transparent
              opacity={moonOpacity * 0.07}
              depthWrite={false}
            />
          </mesh>
        </group>
      ) : null}

      {sunOpacity > 0.001 ? (
        <group position={[124, 24, -174]}>
          <mesh>
            <sphereGeometry args={[5.2, 28, 28]} />
            <meshBasicMaterial
              color={SUN_CORE_COLOR}
              transparent
              opacity={sunOpacity}
            />
          </mesh>
          <mesh>
            <sphereGeometry args={[8.4, 26, 26]} />
            <meshBasicMaterial
              color={SUN_GLOW_COLOR}
              transparent
              opacity={sunOpacity * 0.24}
              depthWrite={false}
            />
          </mesh>
          <mesh>
            <sphereGeometry args={[11.8, 24, 24]} />
            <meshBasicMaterial
              color={SUN_GLOW_COLOR}
              transparent
              opacity={sunOpacity * 0.11}
              depthWrite={false}
            />
          </mesh>
        </group>
      ) : null}

      <mesh
        position={[WALKABLE_CENTER_X, OCEAN_LEVEL_Y, WALKABLE_CENTER_Z]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[OCEAN_SIZE, OCEAN_SIZE]} />
        <meshStandardMaterial
          color={blendColor(VOID_OCEAN, LIVE_OCEAN, liveTheme)}
          map={allowTextures ? oceanTexture ?? undefined : undefined}
          roughness={THREE.MathUtils.lerp(0.95, 0.28, liveTheme)}
          metalness={THREE.MathUtils.lerp(0, 0.1, liveTheme)}
        />
      </mesh>
      {liveTheme > 0.45 ? (
        <mesh
          position={[WALKABLE_CENTER_X, OCEAN_LEVEL_Y + 0.06, WALKABLE_CENTER_Z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[OCEAN_SIZE, OCEAN_SIZE]} />
          <meshBasicMaterial
            color="#80cae4"
            transparent
            opacity={0.07 * textureReveal}
            depthWrite={false}
          />
        </mesh>
      ) : null}

      <mesh
        position={[WALKABLE_CENTER_X, SHORE_SHELF_Y, WALKABLE_CENTER_Z]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow={shadowEnabled}
        userData={{ bulletHittable: true }}
      >
        <planeGeometry args={[shelfSizeX, shelfSizeZ]} />
        <meshStandardMaterial
          color={blendColor(VOID_SHELF, LIVE_SHELF, liveTheme)}
          roughness={THREE.MathUtils.lerp(1, 0.98, liveTheme)}
          metalness={0.01}
        />
      </mesh>
      <OutlinePlane
        size={[shelfSizeX, shelfSizeZ]}
        position={[WALKABLE_CENTER_X, SHORE_SHELF_Y + 0.02, WALKABLE_CENTER_Z]}
        rotation={[-Math.PI / 2, 0, 0]}
        opacity={outlineOpacity * 0.28}
      />

      {liveTheme > 0.35 ? (
        <mesh
          position={[WALKABLE_CENTER_X, SHORE_SHELF_Y + 0.03, WALKABLE_CENTER_Z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[foamRingSizeX, foamRingSizeZ]} />
          <meshBasicMaterial
            color="#f7dcb8"
            transparent
            opacity={0.08 * textureReveal}
            depthWrite={false}
          />
        </mesh>
      ) : null}

      <mesh
        position={[WALKABLE_CENTER_X, 0, WALKABLE_CENTER_Z]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow={shadowEnabled}
        userData={{ bulletHittable: true }}
      >
        <planeGeometry args={[WALKABLE_SIZE_X, WALKABLE_SIZE_Z]} />
        <meshStandardMaterial
          color={blendColor(VOID_WALKABLE, LIVE_WALKABLE, liveTheme)}
          map={allowTextures ? sandTexture ?? undefined : undefined}
          roughness={THREE.MathUtils.lerp(1, 0.97, liveTheme)}
          metalness={0}
        />
      </mesh>
      <OutlinePlane
        size={[WALKABLE_SIZE_X, WALKABLE_SIZE_Z]}
        position={[WALKABLE_CENTER_X, 0.03, WALKABLE_CENTER_Z]}
        rotation={[-Math.PI / 2, 0, 0]}
        opacity={outlineOpacity}
      />
      {floorGridOpacity > 0.001 ? (
        <gridHelper
          ref={floorGridRef}
          args={[
            WALKABLE_SIZE_X,
            FLOOR_GRID_DIVISIONS,
            GRID_MAJOR_COLOR,
            GRID_MINOR_COLOR,
          ]}
          position={[WALKABLE_CENTER_X, 0.05, WALKABLE_CENTER_Z]}
          renderOrder={5}
        />
      ) : null}

      <mesh
        position={[WALKABLE_CENTER_X, cliffY, WORLD_BOUNDS.maxZ + CLIFF_THICKNESS / 2]}
        castShadow={shadowEnabled}
        receiveShadow={shadowEnabled}
        userData={{ bulletHittable: true }}
      >
        <boxGeometry args={[WALKABLE_SIZE_X + CLIFF_THICKNESS, CLIFF_HEIGHT, CLIFF_THICKNESS]} />
        <meshStandardMaterial
          color={blendColor(VOID_CLIFF, LIVE_CLIFF, liveTheme)}
          roughness={0.93}
          metalness={0.02}
        />
      </mesh>
      <OutlineBox
        size={[WALKABLE_SIZE_X + CLIFF_THICKNESS, CLIFF_HEIGHT, CLIFF_THICKNESS]}
        position={[WALKABLE_CENTER_X, cliffY, WORLD_BOUNDS.maxZ + CLIFF_THICKNESS / 2]}
        opacity={outlineOpacity * 0.65}
      />

      <mesh
        position={[WALKABLE_CENTER_X, cliffY, WORLD_BOUNDS.minZ - CLIFF_THICKNESS / 2]}
        castShadow={shadowEnabled}
        receiveShadow={shadowEnabled}
        userData={{ bulletHittable: true }}
      >
        <boxGeometry args={[WALKABLE_SIZE_X + CLIFF_THICKNESS, CLIFF_HEIGHT, CLIFF_THICKNESS]} />
        <meshStandardMaterial
          color={blendColor(VOID_CLIFF, LIVE_CLIFF, liveTheme)}
          roughness={0.93}
          metalness={0.02}
        />
      </mesh>
      <OutlineBox
        size={[WALKABLE_SIZE_X + CLIFF_THICKNESS, CLIFF_HEIGHT, CLIFF_THICKNESS]}
        position={[WALKABLE_CENTER_X, cliffY, WORLD_BOUNDS.minZ - CLIFF_THICKNESS / 2]}
        opacity={outlineOpacity * 0.65}
      />

      <mesh
        position={[WORLD_BOUNDS.maxX + CLIFF_THICKNESS / 2, cliffY, WALKABLE_CENTER_Z]}
        castShadow={shadowEnabled}
        receiveShadow={shadowEnabled}
        userData={{ bulletHittable: true }}
      >
        <boxGeometry args={[CLIFF_THICKNESS, CLIFF_HEIGHT, WALKABLE_SIZE_Z + CLIFF_THICKNESS * 2]} />
        <meshStandardMaterial
          color={blendColor(VOID_CLIFF, LIVE_CLIFF, liveTheme)}
          roughness={0.93}
          metalness={0.02}
        />
      </mesh>
      <OutlineBox
        size={[CLIFF_THICKNESS, CLIFF_HEIGHT, WALKABLE_SIZE_Z + CLIFF_THICKNESS * 2]}
        position={[WORLD_BOUNDS.maxX + CLIFF_THICKNESS / 2, cliffY, WALKABLE_CENTER_Z]}
        opacity={outlineOpacity * 0.65}
      />

      <mesh
        position={[WORLD_BOUNDS.minX - CLIFF_THICKNESS / 2, cliffY, WALKABLE_CENTER_Z]}
        castShadow={shadowEnabled}
        receiveShadow={shadowEnabled}
        userData={{ bulletHittable: true }}
      >
        <boxGeometry args={[CLIFF_THICKNESS, CLIFF_HEIGHT, WALKABLE_SIZE_Z + CLIFF_THICKNESS * 2]} />
        <meshStandardMaterial
          color={blendColor(VOID_CLIFF, LIVE_CLIFF, liveTheme)}
          roughness={0.93}
          metalness={0.02}
        />
      </mesh>
      <OutlineBox
        size={[CLIFF_THICKNESS, CLIFF_HEIGHT, WALKABLE_SIZE_Z + CLIFF_THICKNESS * 2]}
        position={[WORLD_BOUNDS.minX - CLIFF_THICKNESS / 2, cliffY, WALKABLE_CENTER_Z]}
        opacity={outlineOpacity * 0.65}
      />
    </group>
  );
}

export function StressBoxes({ count, shadows }: { count: StressModeCount; shadows: boolean }) {
  void count;
  void shadows;
  return null;
}
