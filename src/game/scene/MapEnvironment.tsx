import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { createNightSkyTexture } from "./Textures";
import type { StressModeCount } from "../types";
import {
  WALKABLE_CENTER_X,
  WALKABLE_CENTER_Z,
  WALKABLE_SIZE_X,
  WALKABLE_SIZE_Z,
  WORLD_BOUNDS,
} from "./scene-constants";
import {
  createSandTexture,
  createSkyTexture,
} from "./Textures";
import { DesertProps } from "./DesertProps";

const VOID_SKY = new THREE.Color("#0a1628");
const LIVE_SKY = new THREE.Color("#b8d4e8");
const VOID_WALKABLE = new THREE.Color("#1c1a14");
const LIVE_WALKABLE = new THREE.Color("#d4a862");
const MOON_COLOR = new THREE.Color("#e8eaf0");
const MOON_GLOW_COLOR = new THREE.Color("#9ab0d0");
const GRID_MAJOR_COLOR = new THREE.Color("#8fb3ff");
const GRID_MINOR_COLOR = new THREE.Color("#ffffff");
const SUN_CORE_COLOR = new THREE.Color("#ffe0b0");
const SUN_GLOW_COLOR = new THREE.Color("#ffb279");
const FAR_DESERT_COLOR = new THREE.Color("#c38a47");
const BORDER_COLOR = new THREE.Color("#f6d99a");
const BORDER_GLOW_COLOR = new THREE.Color("#d48b36");
const FLOOR_GRID_DIVISIONS = 16;
const FAR_DESERT_SIZE = 2200;
const BORDER_STRIP_THICKNESS = 0.9;
const BORDER_STRIP_HEIGHT = 0.18;
const BORDER_POST_SPACING = 20;
const BORDER_POST_HEIGHT = 1.4;
const BORDER_POST_WIDTH = 0.14;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function blendColor(from: THREE.Color, to: THREE.Color, amount: number) {
  return new THREE.Color().copy(from).lerp(to, clamp01(amount));
}

function buildBorderPostPositions() {
  const positions: Array<[number, number]> = [];

  for (
    let x = WORLD_BOUNDS.minX;
    x <= WORLD_BOUNDS.maxX;
    x += BORDER_POST_SPACING
  ) {
    positions.push([x, WORLD_BOUNDS.minZ], [x, WORLD_BOUNDS.maxZ]);
  }

  for (
    let z = WORLD_BOUNDS.minZ + BORDER_POST_SPACING;
    z < WORLD_BOUNDS.maxZ;
    z += BORDER_POST_SPACING
  ) {
    positions.push([WORLD_BOUNDS.minX, z], [WORLD_BOUNDS.maxX, z]);
  }

  return positions;
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
  const farSandTexture = useMemo(() => {
    const texture = createSandTexture();
    if (texture) {
      texture.repeat.set(120, 120);
    }
    return texture;
  }, []);
  const skyTexture = useMemo(() => createSkyTexture(), []);
  const floorGridRef = useRef<THREE.GridHelper>(null);
  const borderPosts = useMemo(() => buildBorderPostPositions(), []);

  useEffect(() => {
    return () => {
      skyTexture?.dispose();
      sandTexture?.dispose();
      farSandTexture?.dispose();
    };
  }, [farSandTexture, sandTexture, skyTexture]);

  const liveTheme = clamp01(theme);
  const textureReveal = clamp01((liveTheme - 0.52) / 0.48);
  const sunOpacity = clamp01((liveTheme - 0.42) / 0.48);
  const allowTextures = textureReveal > 0.001;
  const shadowEnabled = shadows && liveTheme > 0.6;
  const borderGlow = THREE.MathUtils.lerp(0.45, 1.05, liveTheme);

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
        <group position={[24, 430, -32]}>
          <mesh>
            <sphereGeometry args={[9, 28, 28]} />
            <meshBasicMaterial
              color={SUN_CORE_COLOR}
              transparent
              opacity={sunOpacity}
            />
          </mesh>
          <mesh>
            <sphereGeometry args={[18, 26, 26]} />
            <meshBasicMaterial
              color={SUN_GLOW_COLOR}
              transparent
              opacity={sunOpacity * 0.34}
              depthWrite={false}
            />
          </mesh>
          <mesh>
            <sphereGeometry args={[30, 24, 24]} />
            <meshBasicMaterial
              color={SUN_GLOW_COLOR}
              transparent
              opacity={sunOpacity * 0.16}
              depthWrite={false}
            />
          </mesh>
        </group>
      ) : null}

      <mesh
        position={[WALKABLE_CENTER_X, -0.12, WALKABLE_CENTER_Z]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow={shadowEnabled}
        userData={{ bulletHittable: true }}
      >
        <planeGeometry args={[FAR_DESERT_SIZE, FAR_DESERT_SIZE]} />
        <meshStandardMaterial
          color={blendColor(VOID_WALKABLE, FAR_DESERT_COLOR, liveTheme)}
          map={allowTextures ? farSandTexture ?? undefined : undefined}
          roughness={1}
          metalness={0}
        />
      </mesh>

      {/* Walkable desert floor */}
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
          roughness={THREE.MathUtils.lerp(1, 0.92, liveTheme)}
          metalness={0}
        />
      </mesh>

      {[
        {
          key: "north",
          position: [WALKABLE_CENTER_X, BORDER_STRIP_HEIGHT / 2, WORLD_BOUNDS.minZ],
          size: [WALKABLE_SIZE_X + BORDER_STRIP_THICKNESS, BORDER_STRIP_HEIGHT, BORDER_STRIP_THICKNESS],
        },
        {
          key: "south",
          position: [WALKABLE_CENTER_X, BORDER_STRIP_HEIGHT / 2, WORLD_BOUNDS.maxZ],
          size: [WALKABLE_SIZE_X + BORDER_STRIP_THICKNESS, BORDER_STRIP_HEIGHT, BORDER_STRIP_THICKNESS],
        },
        {
          key: "west",
          position: [WORLD_BOUNDS.minX, BORDER_STRIP_HEIGHT / 2, WALKABLE_CENTER_Z],
          size: [BORDER_STRIP_THICKNESS, BORDER_STRIP_HEIGHT, WALKABLE_SIZE_Z + BORDER_STRIP_THICKNESS],
        },
        {
          key: "east",
          position: [WORLD_BOUNDS.maxX, BORDER_STRIP_HEIGHT / 2, WALKABLE_CENTER_Z],
          size: [BORDER_STRIP_THICKNESS, BORDER_STRIP_HEIGHT, WALKABLE_SIZE_Z + BORDER_STRIP_THICKNESS],
        },
      ].map(({ key, position, size }) => (
        <mesh key={key} position={position as [number, number, number]}>
          <boxGeometry args={size as [number, number, number]} />
          <meshStandardMaterial
            color={BORDER_COLOR}
            emissive={BORDER_GLOW_COLOR}
            emissiveIntensity={borderGlow}
            roughness={0.48}
            metalness={0.06}
          />
        </mesh>
      ))}

      {borderPosts.map(([x, z], index) => (
        <group key={`border-post-${index}`} position={[x, 0, z]}>
          <mesh position={[0, BORDER_POST_HEIGHT * 0.5, 0]}>
            <boxGeometry args={[BORDER_POST_WIDTH, BORDER_POST_HEIGHT, BORDER_POST_WIDTH]} />
            <meshStandardMaterial
              color="#7f5a34"
              roughness={0.92}
              metalness={0.04}
            />
          </mesh>
          <mesh position={[0, BORDER_POST_HEIGHT + 0.18, 0]}>
            <sphereGeometry args={[0.12, 10, 10]} />
            <meshStandardMaterial
              color={BORDER_COLOR}
              emissive={BORDER_GLOW_COLOR}
              emissiveIntensity={borderGlow * 1.1}
              roughness={0.36}
              metalness={0.05}
            />
          </mesh>
        </group>
      ))}

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

      <DesertProps theme={liveTheme} shadows={shadowEnabled} />
    </group>
  );
}

export function StressBoxes({ count, shadows }: { count: StressModeCount; shadows: boolean }) {
  void count;
  void shadows;
  return null;
}
