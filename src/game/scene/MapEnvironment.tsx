import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { createNightSkyTexture } from "./Textures";
import type { StressModeCount } from "../types";
import {
  OCEAN_LEVEL_Y,
  OCEAN_SIZE,
  WALKABLE_CENTER_X,
  WALKABLE_CENTER_Z,
  WALKABLE_SIZE_X,
  WALKABLE_SIZE_Z,
} from "./scene-constants";
import {
  createGrassTexture,
  createSkyTexture,
} from "./Textures";

const VOID_SKY = new THREE.Color("#0a1628");
const LIVE_SKY = new THREE.Color("#b8d4e8");
const VOID_WALKABLE = new THREE.Color("#1c1a14");
const LIVE_WALKABLE = new THREE.Color("#4d8f44");
const GRID_MAJOR_COLOR = new THREE.Color("#8fb3ff");
const GRID_MINOR_COLOR = new THREE.Color("#ffffff");
const SAND_COLOR_VOID = new THREE.Color("#1e1a10");
const SAND_COLOR_LIVE = new THREE.Color("#c4a96a");
const WATER_COLOR_VOID = new THREE.Color("#0a1520");
const WATER_COLOR_LIVE = new THREE.Color("#1e4a61");
const FLOOR_GRID_DIVISIONS = 16;
const SAND_STRIP_SIZE = 320;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function blendColor(from: THREE.Color, to: THREE.Color, amount: number) {
  return new THREE.Color().copy(from).lerp(to, clamp01(amount));
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
  const grassTexture = useMemo(() => createGrassTexture(), []);
  const skyTexture = useMemo(() => createSkyTexture(), []);
  const floorGridRef = useRef<THREE.GridHelper>(null);

  useEffect(() => {
    return () => {
      skyTexture?.dispose();
      grassTexture?.dispose();
    };
  }, [grassTexture, skyTexture]);

  const liveTheme = clamp01(theme);
  const textureReveal = clamp01((liveTheme - 0.52) / 0.48);
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

  useEffect(() => {
    return () => {
      nightSkyTexture?.dispose();
    };
  }, [nightSkyTexture]);

  return (
    <group>
      {/* Sky sphere */}
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

      {/* Sand strip beyond walkable area */}
      <mesh
        position={[WALKABLE_CENTER_X, -0.12, WALKABLE_CENTER_Z]}
        rotation={[-Math.PI / 2, 0, 0]}
        userData={{ bulletHittable: true }}
      >
        <planeGeometry args={[SAND_STRIP_SIZE, SAND_STRIP_SIZE]} />
        <meshStandardMaterial
          color={blendColor(SAND_COLOR_VOID, SAND_COLOR_LIVE, liveTheme)}
          roughness={1}
          metalness={0}
        />
      </mesh>

      {/* Water plane */}
      <mesh
        position={[WALKABLE_CENTER_X, OCEAN_LEVEL_Y, WALKABLE_CENTER_Z]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[OCEAN_SIZE, OCEAN_SIZE]} />
        <meshStandardMaterial
          color={blendColor(WATER_COLOR_VOID, WATER_COLOR_LIVE, liveTheme)}
          roughness={1}
          metalness={0}
        />
      </mesh>

      {/* Walkable grassy floor */}
      <mesh
        position={[WALKABLE_CENTER_X, 0, WALKABLE_CENTER_Z]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow={shadowEnabled}
        userData={{ bulletHittable: true }}
      >
        <planeGeometry args={[WALKABLE_SIZE_X, WALKABLE_SIZE_Z]} />
        <meshStandardMaterial
          color={blendColor(VOID_WALKABLE, LIVE_WALKABLE, liveTheme)}
          map={allowTextures ? grassTexture ?? undefined : undefined}
          roughness={THREE.MathUtils.lerp(1, 0.85, liveTheme)}
          metalness={THREE.MathUtils.lerp(0, 0.02, liveTheme)}
        />
      </mesh>

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
    </group>
  );
}

export function StressBoxes({ count, shadows }: { count: StressModeCount; shadows: boolean }) {
  void count;
  void shadows;
  return null;
}
