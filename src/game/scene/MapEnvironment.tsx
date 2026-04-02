import { useEffect, useMemo, useRef, useState } from "react";

const EMPTY_STRING_ARRAY: readonly string[] = [];
const SCHOOL_DEFAULT_DOUBLE_SIDE: readonly string[] = [
  "walkable_slab",
  "blocker_wall",
];
import * as THREE from "three";
import {
  type BlockingVolume,
  getWalkableSurfaceThickness,
  type WalkableSurface,
} from "../map-layout";
import type { StressModeCount } from "../types";
import type { PracticeMapDefinition } from "./practice-maps";
import { RANGE_PRACTICE_MAP } from "./practice-maps";
import { OCEAN_LEVEL_Y } from "./scene-constants";
import {
  createAnimeGroundTexture,
  createIceTexture,
  createNightSkyTexture,
  createSkyTexture,
  createSpaceFloorTexture,
  createTundraTexture,
} from "./Textures";
import { loadGlbAsset, preloadTextureAsset } from "../AssetLoader";
import {
  DEFAULT_SKY_ASSET_URL,
  DEFAULT_SKY_ID,
  getSkyById,
  type RangeTextureKind,
  type SkyEnvironmentTheme,
} from "../sky-registry";

const VOID_SKY = new THREE.Color("#040405");
const LIVE_SKY = new THREE.Color("#b8d4e8");
const GRID_MAJOR_COLOR = new THREE.Color("#8fb3ff");
const GRID_MINOR_COLOR = new THREE.Color("#ffffff");
const TUNDRA_COLOR_VOID = new THREE.Color("#171d24");
const TUNDRA_COLOR_LIVE = new THREE.Color("#dde7f0");
const ICE_COLOR_VOID = new THREE.Color("#141e28");
const ICE_COLOR_LIVE = new THREE.Color("#7ab5c8");
const SCHOOL_BASE_VOID = new THREE.Color("#0b0b0d");
const SCHOOL_BASE_LIVE = new THREE.Color("#64615b");
const FLOOR_GRID_DIVISIONS = 16;
const BACKDROP_SHELF_PADDING = 26;
const BACKDROP_SHELF_MIN_SIZE = 196;
const OCEAN_PADDING = 84;
const SKY_ASSET_BASE_RADIUS = 500;
const WORLD_SKY_RADIUS = 560;

const POOL_MIN_X = 34;
const POOL_MAX_X = 40;
const POOL_MIN_Z = 16;
const POOL_MAX_Z = 34;
const POOL_WATER_Y = -1.1;
const POOL_FLOOR_Y = -1.75;
const POOL_WALL_HEIGHT = 1.6;
const DEFAULT_RANGE_THEME = getSkyById(DEFAULT_SKY_ID).environmentTheme;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function blendColor(from: THREE.Color, to: THREE.Color, amount: number) {
  return new THREE.Color().copy(from).lerp(to, clamp01(amount));
}

function blendNumber(from: number, to: number, amount: number) {
  return THREE.MathUtils.lerp(from, to, clamp01(amount));
}

function blendHexColor(from: string, to: string, amount: number) {
  return new THREE.Color(from).lerp(new THREE.Color(to), clamp01(amount));
}

function resolveRangeTexture(
  kind: RangeTextureKind,
  textures: Record<RangeTextureKind, THREE.Texture | null>,
) {
  return textures[kind] ?? undefined;
}

function RangeFloodlight({
  position,
  mastHeight,
  beamColor,
  beamIntensity,
  beamDistance,
}: {
  position: [number, number, number];
  mastHeight: number;
  beamColor: THREE.ColorRepresentation;
  beamIntensity: number;
  beamDistance: number;
}) {
  return (
    <group position={position}>
      <mesh position={[0, mastHeight / 2, 0]} castShadow={false} receiveShadow={false}>
        <boxGeometry args={[0.26, mastHeight, 0.26]} />
        <meshStandardMaterial color="#2a3141" roughness={0.5} metalness={0.58} />
      </mesh>
      <mesh position={[0, mastHeight + 0.42, 0]} castShadow={false} receiveShadow={false}>
        <boxGeometry args={[1.24, 0.46, 0.72]} />
        <meshStandardMaterial color="#343d56" roughness={0.38} metalness={0.68} />
      </mesh>
      <mesh position={[0, mastHeight + 0.42, 0.37]} castShadow={false} receiveShadow={false}>
        <boxGeometry args={[0.94, 0.18, 0.06]} />
        <meshBasicMaterial color={beamColor} toneMapped={false} />
      </mesh>
      <pointLight
        position={[0, mastHeight + 0.12, 0.24]}
        intensity={beamIntensity}
        distance={beamDistance}
        decay={1.35}
        color={beamColor}
      />
    </group>
  );
}

function RangePracticalLights({
  centerX,
  centerZ,
  sizeX,
  sizeZ,
  blend,
}: {
  centerX: number;
  centerZ: number;
  sizeX: number;
  sizeZ: number;
  blend: number;
}) {
  const liveBlend = clamp01((blend - 0.34) / 0.66);

  if (liveBlend <= 0.001) {
    return null;
  }

  const sideOffsetX = sizeX * 0.22;
  const nearLightZ = centerZ - sizeZ * 0.16;
  const farLightZ = centerZ - sizeZ * 0.34;
  const sideBeamIntensity = THREE.MathUtils.lerp(6, 42, liveBlend);
  const farBeamIntensity = THREE.MathUtils.lerp(5, 34, liveBlend);
  const nearFillIntensity = THREE.MathUtils.lerp(1.4, 18, liveBlend);
  const accentColor = "#dbe3ff";
  const fillColor = "#b6c8ff";
  const moonKeyIntensity = THREE.MathUtils.lerp(0.22, 0.78, liveBlend);
  const sideKeyIntensity = THREE.MathUtils.lerp(0.12, 0.42, liveBlend);

  return (
    <group>
      <RangeFloodlight
        position={[centerX - sideOffsetX, 0, nearLightZ]}
        mastHeight={9.2}
        beamColor={accentColor}
        beamIntensity={sideBeamIntensity}
        beamDistance={126}
      />
      <RangeFloodlight
        position={[centerX + sideOffsetX, 0, nearLightZ]}
        mastHeight={9.2}
        beamColor={accentColor}
        beamIntensity={sideBeamIntensity}
        beamDistance={126}
      />
      <RangeFloodlight
        position={[centerX, 0, farLightZ]}
        mastHeight={10.4}
        beamColor={fillColor}
        beamIntensity={farBeamIntensity}
        beamDistance={136}
      />
      <directionalLight
        position={[centerX, 18, centerZ + sizeZ * 0.22]}
        intensity={moonKeyIntensity}
        color="#dbe4ff"
      />
      <directionalLight
        position={[centerX + sizeX * 0.18, 11, centerZ + sizeZ * 0.08]}
        intensity={sideKeyIntensity}
        color="#8fb2ff"
      />
      <pointLight
        position={[centerX, 6.4, centerZ + sizeZ * 0.06]}
        intensity={nearFillIntensity}
        distance={94}
        decay={1.05}
        color="#eef3ff"
      />
    </group>
  );
}

function createSkyMaterial(source: THREE.Material) {
  const texturedSource = source as THREE.Material & {
    emissiveMap?: THREE.Texture | null;
    map?: THREE.Texture | null;
  };
  const map = texturedSource.map ?? texturedSource.emissiveMap ?? null;
  if (map) {
    map.colorSpace = THREE.SRGBColorSpace;
  }

  const material = new THREE.MeshBasicMaterial({
    color: "#ffffff",
    map: map ?? undefined,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: false,
  });
  material.toneMapped = false;
  return material;
}

function disposeObjectMaterials(root: THREE.Object3D) {
  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      material?.dispose();
    }
  });
}

function prepareSkyAsset(root: THREE.Object3D) {
  root.traverse((child) => {
    child.userData.skipCollision = true;
    child.userData.bulletHittable = false;

    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = -100;
    mesh.frustumCulled = false;

    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => createSkyMaterial(material))
      : createSkyMaterial(mesh.material);
  });
}

function SkyBackdrop({
  centerX,
  centerZ,
  radius,
  skyAssetUrl = DEFAULT_SKY_ASSET_URL,
  fallbackColor,
  fallbackTexture,
}: {
  centerX: number;
  centerZ: number;
  radius: number;
  skyAssetUrl?: string;
  fallbackColor?: THREE.ColorRepresentation;
  fallbackTexture?: THREE.Texture | null;
}) {
  const [skyScene, setSkyScene] = useState<THREE.Group | null>(null);

  useEffect(() => {
    let disposed = false;
    let localScene: THREE.Group | null = null;
    setSkyScene(null);

    loadGlbAsset(skyAssetUrl).then((group) => {
      if (disposed || !group) return;
      const clone = group.clone(true);
      prepareSkyAsset(clone);
      localScene = clone;
      setSkyScene(clone);
    });

    return () => {
      disposed = true;
      if (localScene) {
        disposeObjectMaterials(localScene);
      }
    };
  }, [skyAssetUrl]);

  if (skyScene) {
    const scale = radius / SKY_ASSET_BASE_RADIUS;
    return (
      <group position={[centerX, 0, centerZ]} scale={[scale, scale, scale]}>
        <primitive object={skyScene} />
      </group>
    );
  }

  return (
    <mesh position={[centerX, 0, centerZ]}>
      <sphereGeometry args={[radius, 48, 32]} />
      <meshBasicMaterial
        color={fallbackColor}
        map={fallbackTexture ?? undefined}
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
      />
    </mesh>
  );
}

type SurfacePalette = {
  color: string;
  roughness: number;
  metalness: number;
};

const SURFACE_PALETTE: Record<
  NonNullable<WalkableSurface["material"]>,
  SurfacePalette
> = {
  yard: { color: "#6d675d", roughness: 1, metalness: 0.02 },
  interior: { color: "#a49a88", roughness: 0.96, metalness: 0.01 },
  upper: { color: "#c2b8a4", roughness: 0.94, metalness: 0.01 },
  poolDeck: { color: "#d0c7b0", roughness: 0.9, metalness: 0.02 },
  stair: { color: "#968e81", roughness: 0.96, metalness: 0.02 },
};

const BLOCKING_PALETTE: Record<
  NonNullable<BlockingVolume["material"]>,
  SurfacePalette
> = {
  wall: { color: "#7f7567", roughness: 0.95, metalness: 0.02 },
  railing: { color: "#4f555c", roughness: 0.7, metalness: 0.12 },
  cover: { color: "#6a4f39", roughness: 0.92, metalness: 0.02 },
};

function WorldBackdrop({
  theme,
  worldBounds,
  showSkyBackdrop = true,
  skyAssetUrl = DEFAULT_SKY_ASSET_URL,
  rangeTheme,
  surfaceBlend = theme,
}: {
  theme: number;
  worldBounds: PracticeMapDefinition["worldBounds"];
  showSkyBackdrop?: boolean;
  skyAssetUrl?: string;
  rangeTheme?: SkyEnvironmentTheme;
  surfaceBlend?: number;
}) {
  const skyTexture = useMemo(() => createSkyTexture(), []);
  const nightSkyTexture = useMemo(() => createNightSkyTexture(), []);
  const tundraTexture = useMemo(() => createTundraTexture(), []);
  const iceTexture = useMemo(() => createIceTexture(), []);
  const animeTexture = useMemo(() => createAnimeGroundTexture(), []);
  const spaceTexture = useMemo(() => createSpaceFloorTexture(), []);
  const liveTheme = clamp01(theme);
  const rangeBlend = clamp01(surfaceBlend);
  const textureReveal = clamp01((liveTheme - 0.52) / 0.48);
  const allowTextures = textureReveal > 0.001;
  const walkableCenterX = (worldBounds.minX + worldBounds.maxX) / 2;
  const walkableCenterZ = (worldBounds.minZ + worldBounds.maxZ) / 2;
  const worldSizeX = worldBounds.maxX - worldBounds.minX;
  const worldSizeZ = worldBounds.maxZ - worldBounds.minZ;
  const backdropShelfSize = Math.max(
    Math.max(worldSizeX, worldSizeZ) + BACKDROP_SHELF_PADDING * 2,
    BACKDROP_SHELF_MIN_SIZE,
  );
  const oceanSize = backdropShelfSize + OCEAN_PADDING * 2;

  useEffect(() => {
    return () => {
      skyTexture?.dispose();
      nightSkyTexture?.dispose();
      tundraTexture?.dispose();
      iceTexture?.dispose();
      animeTexture?.dispose();
      spaceTexture?.dispose();
    };
  }, [
    animeTexture,
    iceTexture,
    nightSkyTexture,
    skyTexture,
    spaceTexture,
    tundraTexture,
  ]);

  const textureBank = useMemo<Record<RangeTextureKind, THREE.Texture | null>>(
    () => ({
      tundra: tundraTexture,
      ice: iceTexture,
      anime: animeTexture,
      space: spaceTexture,
    }),
    [animeTexture, iceTexture, spaceTexture, tundraTexture],
  );

  const backdropColor = rangeTheme
    ? blendHexColor(
        rangeTheme.range.menu.backdropColor,
        rangeTheme.range.gameplay.backdropColor,
        rangeBlend,
      )
    : blendColor(TUNDRA_COLOR_VOID, TUNDRA_COLOR_LIVE, liveTheme);
  const oceanColor = rangeTheme
    ? blendHexColor(
        rangeTheme.range.menu.oceanColor,
        rangeTheme.range.gameplay.oceanColor,
        rangeBlend,
      )
    : blendColor(ICE_COLOR_VOID, ICE_COLOR_LIVE, liveTheme);
  const backdropTexture = rangeTheme
    ? resolveRangeTexture(rangeTheme.range.backdropTexture, textureBank)
    : allowTextures
    ? tundraTexture ?? undefined
    : undefined;
  const oceanTexture = rangeTheme
    ? resolveRangeTexture(rangeTheme.range.oceanTexture, textureBank)
    : allowTextures
    ? iceTexture ?? undefined
    : undefined;
  const backdropRoughness = rangeTheme
    ? blendNumber(
        rangeTheme.range.menu.backdropRoughness,
        rangeTheme.range.gameplay.backdropRoughness,
        rangeBlend,
      )
    : 0.98;
  const backdropMetalness = rangeTheme
    ? blendNumber(
        rangeTheme.range.menu.backdropMetalness,
        rangeTheme.range.gameplay.backdropMetalness,
        rangeBlend,
      )
    : 0.03;
  const oceanRoughness = rangeTheme
    ? blendNumber(
        rangeTheme.range.menu.oceanRoughness,
        rangeTheme.range.gameplay.oceanRoughness,
        rangeBlend,
      )
    : THREE.MathUtils.lerp(0.96, 0.46, liveTheme);
  const oceanMetalness = rangeTheme
    ? blendNumber(
        rangeTheme.range.menu.oceanMetalness,
        rangeTheme.range.gameplay.oceanMetalness,
        rangeBlend,
      )
    : THREE.MathUtils.lerp(0.02, 0.18, liveTheme);
  const skyFallbackTexture = rangeTheme
    ? rangeTheme.range.backdropTexture === "space"
      ? nightSkyTexture
      : skyTexture
    : allowTextures
    ? skyTexture
    : nightSkyTexture;
  const skyFallbackColor = rangeTheme
    ? backdropColor
    : blendColor(VOID_SKY, LIVE_SKY, textureReveal);

  return (
    <group>
      {showSkyBackdrop ? (
        <SkyBackdrop
          centerX={walkableCenterX}
          centerZ={walkableCenterZ}
          radius={WORLD_SKY_RADIUS}
          skyAssetUrl={skyAssetUrl}
          fallbackColor={skyFallbackColor}
          fallbackTexture={skyFallbackTexture ?? undefined}
        />
      ) : null}

      <mesh
        position={[walkableCenterX, -0.12, walkableCenterZ]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[backdropShelfSize, backdropShelfSize]} />
        <meshStandardMaterial
          color={backdropColor}
          map={backdropTexture}
          roughness={backdropRoughness}
          metalness={backdropMetalness}
        />
      </mesh>

      <mesh
        position={[walkableCenterX, OCEAN_LEVEL_Y, walkableCenterZ]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[oceanSize, oceanSize]} />
        <meshStandardMaterial
          color={oceanColor}
          map={oceanTexture}
          roughness={oceanRoughness}
          metalness={oceanMetalness}
        />
      </mesh>
    </group>
  );
}

export type MapEnvironmentProps = {
  shadows: boolean;
  theme: number;
  floorGridOpacity: number;
  worldBounds?: PracticeMapDefinition["worldBounds"];
  showSkyBackdrop?: boolean;
  skyAssetUrl?: string;
  skyTheme?: SkyEnvironmentTheme;
  surfaceBlend?: number;
};

export function MapEnvironment({
  shadows,
  theme,
  floorGridOpacity,
  worldBounds = RANGE_PRACTICE_MAP.worldBounds,
  showSkyBackdrop = true,
  skyAssetUrl = DEFAULT_SKY_ASSET_URL,
  skyTheme = DEFAULT_RANGE_THEME,
  surfaceBlend = theme,
}: MapEnvironmentProps) {
  const tundraTexture = useMemo(() => createTundraTexture(), []);
  const animeTexture = useMemo(() => createAnimeGroundTexture(), []);
  const spaceTexture = useMemo(() => createSpaceFloorTexture(), []);
  const floorGridRef = useRef<THREE.GridHelper>(null);
  const shadowEnabled = shadows && clamp01(surfaceBlend) > 0.6;
  const walkableCenterX = (worldBounds.minX + worldBounds.maxX) / 2;
  const walkableCenterZ = (worldBounds.minZ + worldBounds.maxZ) / 2;
  const walkableSizeX = worldBounds.maxX - worldBounds.minX;
  const walkableSizeZ = worldBounds.maxZ - worldBounds.minZ;
  const rangeBlend = clamp01(surfaceBlend);

  useEffect(() => {
    return () => {
      tundraTexture?.dispose();
      animeTexture?.dispose();
      spaceTexture?.dispose();
    };
  }, [animeTexture, spaceTexture, tundraTexture]);

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

  const floorTextures = useMemo<Record<RangeTextureKind, THREE.Texture | null>>(
    () => ({
      tundra: tundraTexture,
      ice: tundraTexture,
      anime: animeTexture,
      space: spaceTexture,
    }),
    [animeTexture, spaceTexture, tundraTexture],
  );

  const floorMaterial = skyTheme.range;
  const showSpaceFloodlights = floorMaterial.floorTexture === "space";
  const floorTexture = resolveRangeTexture(
    floorMaterial.floorTexture,
    floorTextures,
  );
  const floorColor = blendHexColor(
    floorMaterial.menu.floorColor,
    floorMaterial.gameplay.floorColor,
    rangeBlend,
  );
  const floorRoughness = blendNumber(
    floorMaterial.menu.floorRoughness,
    floorMaterial.gameplay.floorRoughness,
    rangeBlend,
  );
  const floorMetalness = blendNumber(
    floorMaterial.menu.floorMetalness,
    floorMaterial.gameplay.floorMetalness,
    rangeBlend,
  );

  return (
    <group>
      <WorldBackdrop
        theme={theme}
        worldBounds={worldBounds}
        showSkyBackdrop={showSkyBackdrop}
        skyAssetUrl={skyAssetUrl}
        rangeTheme={skyTheme}
        surfaceBlend={surfaceBlend}
      />

      <mesh
        position={[walkableCenterX, 0, walkableCenterZ]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow={shadowEnabled}
        userData={{ bulletHittable: true }}
      >
        <planeGeometry args={[walkableSizeX, walkableSizeZ]} />
        <meshStandardMaterial
          color={floorColor}
          map={floorTexture}
          roughness={floorRoughness}
          metalness={floorMetalness}
        />
      </mesh>

      {floorGridOpacity > 0.001
        ? (
          <gridHelper
            ref={floorGridRef}
            args={[
              walkableSizeX,
              FLOOR_GRID_DIVISIONS,
              GRID_MAJOR_COLOR,
              GRID_MINOR_COLOR,
            ]}
            position={[walkableCenterX, 0.05, walkableCenterZ]}
            renderOrder={5}
          />
        )
        : null}

      {showSpaceFloodlights
        ? (
          <RangePracticalLights
            centerX={walkableCenterX}
            centerZ={walkableCenterZ}
            sizeX={walkableSizeX}
            sizeZ={walkableSizeZ}
            blend={rangeBlend}
          />
        )
        : null}
    </group>
  );
}

function SchoolSurface({
  surface,
  shadows,
}: {
  surface: WalkableSurface;
  shadows: boolean;
}) {
  const thickness = getWalkableSurfaceThickness(surface);
  const palette = SURFACE_PALETTE[surface.material ?? "interior"];

  if (surface.kind === "slab") {
    return (
      <mesh
        position={[
          (surface.minX + surface.maxX) / 2,
          surface.y - thickness / 2,
          (surface.minZ + surface.maxZ) / 2,
        ]}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
      >
        <boxGeometry
          args={[
            surface.maxX - surface.minX,
            thickness,
            surface.maxZ - surface.minZ,
          ]}
        />
        <meshStandardMaterial {...palette} />
      </mesh>
    );
  }

  const run = surface.axis === "x"
    ? surface.maxX - surface.minX
    : surface.maxZ - surface.minZ;
  const rise = surface.endY - surface.startY;
  const angle = Math.atan2(rise, run);
  const length = Math.hypot(run, rise);
  const centerY = (surface.startY + surface.endY) / 2 -
    (thickness / 2) * Math.cos(angle);
  const centerX = (surface.minX + surface.maxX) / 2;
  const centerZ = (surface.minZ + surface.maxZ) / 2;

  return (
    <mesh
      position={[centerX, centerY, centerZ]}
      rotation={surface.axis === "x" ? [0, 0, angle] : [-angle, 0, 0]}
      receiveShadow={shadows}
      userData={{ bulletHittable: true }}
    >
      <boxGeometry
        args={surface.axis === "x"
          ? [length, thickness, surface.maxZ - surface.minZ]
          : [surface.maxX - surface.minX, thickness, length]}
      />
      <meshStandardMaterial {...palette} />
    </mesh>
  );
}

function SchoolBlocker({
  blocker,
  shadows,
}: {
  blocker: BlockingVolume;
  shadows: boolean;
}) {
  const palette = BLOCKING_PALETTE[blocker.material ?? "wall"];

  return (
    <mesh
      position={blocker.center}
      castShadow={shadows}
      receiveShadow={shadows}
      userData={{ bulletHittable: true }}
    >
      <boxGeometry args={blocker.size} />
      <meshStandardMaterial {...palette} />
    </mesh>
  );
}

function PoolDetails({ shadows }: { shadows: boolean }) {
  const centerX = (POOL_MIN_X + POOL_MAX_X) / 2;
  const centerZ = (POOL_MIN_Z + POOL_MAX_Z) / 2;
  const width = POOL_MAX_X - POOL_MIN_X;
  const depth = POOL_MAX_Z - POOL_MIN_Z;

  return (
    <group>
      <mesh position={[centerX, POOL_FLOOR_Y, centerZ]} receiveShadow={shadows}>
        <boxGeometry args={[width, 0.25, depth]} />
        <meshStandardMaterial
          color="#325365"
          roughness={0.95}
          metalness={0.04}
        />
      </mesh>

      <mesh position={[centerX, POOL_WATER_Y, centerZ]}>
        <boxGeometry args={[width - 0.2, 0.12, depth - 0.2]} />
        <meshStandardMaterial
          color="#2f7ea1"
          roughness={0.2}
          metalness={0.08}
          transparent
          opacity={0.86}
        />
      </mesh>

      <mesh
        position={[centerX, POOL_WATER_Y - POOL_WALL_HEIGHT / 2, POOL_MIN_Z]}
      >
        <boxGeometry args={[width, POOL_WALL_HEIGHT, 0.35]} />
        <meshStandardMaterial
          color="#9ba7aa"
          roughness={0.9}
          metalness={0.04}
        />
      </mesh>
      <mesh
        position={[centerX, POOL_WATER_Y - POOL_WALL_HEIGHT / 2, POOL_MAX_Z]}
      >
        <boxGeometry args={[width, POOL_WALL_HEIGHT, 0.35]} />
        <meshStandardMaterial
          color="#9ba7aa"
          roughness={0.9}
          metalness={0.04}
        />
      </mesh>
      <mesh
        position={[POOL_MIN_X, POOL_WATER_Y - POOL_WALL_HEIGHT / 2, centerZ]}
      >
        <boxGeometry args={[0.35, POOL_WALL_HEIGHT, depth]} />
        <meshStandardMaterial
          color="#9ba7aa"
          roughness={0.9}
          metalness={0.04}
        />
      </mesh>
      <mesh
        position={[POOL_MAX_X, POOL_WATER_Y - POOL_WALL_HEIGHT / 2, centerZ]}
      >
        <boxGeometry args={[0.35, POOL_WALL_HEIGHT, depth]} />
        <meshStandardMaterial
          color="#9ba7aa"
          roughness={0.9}
          metalness={0.04}
        />
      </mesh>
    </group>
  );
}

function SchoolBlockoutEnvironment({
  practiceMap,
  shadows,
  theme,
  showSkyBackdrop,
  skyAssetUrl,
}: {
  practiceMap: PracticeMapDefinition;
  shadows: boolean;
  theme: number;
  showSkyBackdrop: boolean;
  skyAssetUrl: string;
}) {
  const worldBounds = practiceMap.worldBounds;
  const surfaces = practiceMap.walkableSurfaces ?? [];
  const blockers = practiceMap.blockingVolumes ?? [];
  const centerX = (worldBounds.minX + worldBounds.maxX) / 2;
  const centerZ = (worldBounds.minZ + worldBounds.maxZ) / 2;
  const sizeX = worldBounds.maxX - worldBounds.minX;
  const sizeZ = worldBounds.maxZ - worldBounds.minZ;
  const liveTheme = clamp01(theme);

  return (
    <group>
      <WorldBackdrop
        theme={theme}
        worldBounds={worldBounds}
        showSkyBackdrop={showSkyBackdrop}
        skyAssetUrl={skyAssetUrl}
      />

      <mesh
        position={[centerX, -0.18, centerZ]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[sizeX + 28, sizeZ + 28]} />
        <meshStandardMaterial
          color={blendColor(SCHOOL_BASE_VOID, SCHOOL_BASE_LIVE, liveTheme)}
          roughness={1}
          metalness={0.01}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>

      <ambientLight intensity={0.46} color="#fff2de" />
      <hemisphereLight args={["#dcecff", "#6b5438", 0.58]} />
      <directionalLight
        position={[centerX + 20, 28, centerZ + 12]}
        intensity={0.74}
        color="#ffe0b8"
      />
      <directionalLight
        position={[centerX - 16, 14, centerZ - 18]}
        intensity={0.28}
        color="#9fcbff"
      />

      {surfaces.map((surface, index) => (
        <SchoolSurface
          key={`${practiceMap.id}-surface-${index}`}
          surface={surface}
          shadows={shadows}
        />
      ))}

      {blockers.map((blocker, index) => (
        <SchoolBlocker
          key={`${practiceMap.id}-blocker-${index}`}
          blocker={blocker}
          shadows={shadows}
        />
      ))}

      <PoolDetails shadows={shadows} />
    </group>
  );
}

const MIN_WALL_HEIGHT = 0.5;
const MIN_WALL_TOP_Y = 0.3;
const FLOOR_LIKE_MAX_HEIGHT = 0.55;
const FLOOR_LIKE_MIN_SPAN = 2;
const LARGE_HULL_MIN_SPAN = 10;
const LARGE_HULL_MIN_HEIGHT = 4;
const HULL_FACE_PANEL_THICKNESS = 0.5;
const WALL_LIKE_MAX_THIN_AXIS = 1.35;
const WALL_LIKE_MIN_LONG_AXIS = 2;
const THICK_WALL_LIKE_MAX_SHORT_AXIS = 5.5;
const THICK_WALL_LIKE_MIN_LONG_AXIS = 8;
const THICK_WALL_LIKE_MIN_ASPECT_RATIO = 2.25;
const THICK_WALL_LIKE_MIN_HEIGHT = 4;
const GENERIC_CUBE_PROP_MIN_SPAN = 2;
const GENERIC_CUBE_PROP_MAX_SPAN = 4.5;
const GENERIC_CUBE_PROP_MAX_HEIGHT = 4.5;
const GENERIC_CUBE_PROP_MAX_TOP_Y = 6.5;
const SCHOOL_COLLISION_IGNORE_RE =
  /^(outerground|plane|circle|cylinder)/i;
const SCHOOL_COLLISION_DIRECT_INCLUDE_RE =
  /(wall_firstage|container|trafficbarrier|concrete_barrier|pallet|barricade|table|wood|car|tent)/i;


function isFloorLikeVolume(size: THREE.Vector3) {
  return (
    size.y <= FLOOR_LIKE_MAX_HEIGHT &&
    Math.max(size.x, size.z) >= FLOOR_LIKE_MIN_SPAN
  );
}

function isLargeHullVolume(size: THREE.Vector3) {
  return (
    size.x >= LARGE_HULL_MIN_SPAN &&
    size.z >= LARGE_HULL_MIN_SPAN &&
    size.y >= LARGE_HULL_MIN_HEIGHT
  );
}

function isWallLikeVolume(size: THREE.Vector3) {
  const thinAxis = Math.min(size.x, size.z);
  const longAxis = Math.max(size.x, size.z);
  return (
    thinAxis <= WALL_LIKE_MAX_THIN_AXIS &&
    longAxis >= WALL_LIKE_MIN_LONG_AXIS &&
    size.y >= MIN_WALL_HEIGHT
  );
}

function isThickWallLikeVolume(size: THREE.Vector3) {
  const shortAxis = Math.min(size.x, size.z);
  const longAxis = Math.max(size.x, size.z);
  return (
    shortAxis <= THICK_WALL_LIKE_MAX_SHORT_AXIS &&
    longAxis >= THICK_WALL_LIKE_MIN_LONG_AXIS &&
    longAxis / Math.max(shortAxis, 0.001) >=
      THICK_WALL_LIKE_MIN_ASPECT_RATIO &&
    size.y >= THICK_WALL_LIKE_MIN_HEIGHT
  );
}

function isGenericCubePropVolume(size: THREE.Vector3, box: THREE.Box3) {
  return (
    size.x >= GENERIC_CUBE_PROP_MIN_SPAN &&
    size.z >= GENERIC_CUBE_PROP_MIN_SPAN &&
    size.x <= GENERIC_CUBE_PROP_MAX_SPAN &&
    size.z <= GENERIC_CUBE_PROP_MAX_SPAN &&
    size.y <= GENERIC_CUBE_PROP_MAX_HEIGHT &&
    box.max.y <= GENERIC_CUBE_PROP_MAX_TOP_Y
  );
}


function shouldExtractCollisionVolume(
  name: string,
  size: THREE.Vector3,
  box: THREE.Box3,
) {
  if (SCHOOL_COLLISION_IGNORE_RE.test(name)) {
    return false;
  }

  if (isFloorLikeVolume(size)) {
    return false;
  }

  if (SCHOOL_COLLISION_DIRECT_INCLUDE_RE.test(name)) {
    return true;
  }

  if (isLargeHullVolume(size)) {
    return false;
  }

  return (
    isWallLikeVolume(size) ||
    isThickWallLikeVolume(size) ||
    isGenericCubePropVolume(size, box)
  );
}

function extractCollisionVolumes(
  root: THREE.Object3D,
  scale: number,
): BlockingVolume[] {
  const volumes: BlockingVolume[] = [];
  const mergedBoxes = new Map<string, THREE.Box3>();
  root.updateMatrixWorld(true);

  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    if (!mesh.geometry) return;
    if (!mesh.visible) return;
    if (mesh.userData.skipCollision) return;

    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) return;

    box.min.multiplyScalar(scale);
    box.max.multiplyScalar(scale);
    // Use uuid as key so each mesh gets its own bounding box.
    // Name-based merging ("wall_1"+"wall_2" → "wall") would silently union ALL
    // meshes that share a collapsed name — for Sketchfab-style exports where
    // every mesh is named "Object_N", this produces a single map-spanning box
    // that defeats collision entirely.
    const collisionName = mesh.uuid;
    const existingBox = mergedBoxes.get(collisionName);

    if (existingBox) {
      existingBox.union(box);
      return;
    }

    mergedBoxes.set(collisionName, box.clone());
  });

  for (const [name, box] of mergedBoxes) {
    const size = new THREE.Vector3();
    box.getSize(size);

    if (size.y < MIN_WALL_HEIGHT) continue;
    if (box.max.y < MIN_WALL_TOP_Y) continue;

    if (shouldExtractCollisionVolume(name, size, box)) {
      const center = new THREE.Vector3();
      box.getCenter(center);
      volumes.push({
        center: [center.x, center.y, center.z],
        size: [size.x, size.y, size.z],
      });
    } else if (isLargeHullVolume(size)) {
      // Large hulls enclose rooms — a single solid box would push the player
      // out. Instead, place thin panels at each bounding-box face so the
      // player can move freely inside but cannot walk through the perimeter.
      const center = new THREE.Vector3();
      box.getCenter(center);
      const t = HULL_FACE_PANEL_THICKNESS;
      // left / right (X faces)
      volumes.push({
        center: [box.min.x + t / 2, center.y, center.z],
        size: [t, size.y, size.z],
      });
      volumes.push({
        center: [box.max.x - t / 2, center.y, center.z],
        size: [t, size.y, size.z],
      });
      // front / back (Z faces)
      volumes.push({
        center: [center.x, center.y, box.min.z + t / 2],
        size: [size.x, size.y, t],
      });
      volumes.push({
        center: [center.x, center.y, box.max.z - t / 2],
        size: [size.x, size.y, t],
      });
    }
  }

  return volumes;
}

function fixGlbMaterials(root: THREE.Object3D, shadows: boolean) {
  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    mesh.userData.bulletHittable = true;

    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];

    for (const mat of materials) {
      if (!mat || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        continue;
      }
      const stdMat = mat as THREE.MeshStandardMaterial;
      if (stdMat.map) stdMat.map.colorSpace = THREE.SRGBColorSpace;
      if (stdMat.emissiveMap) {
        stdMat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
      }
      stdMat.needsUpdate = true;
    }
  });
}

function hideSchoolGlbMeshes(
  root: THREE.Object3D,
  exactNames: readonly string[],
  nameIncludes: readonly string[],
) {
  root.traverse((child) => {
    const name = child.name ?? "";
    if (exactNames.includes(name)) {
      child.visible = false;
      child.userData.skipCollision = true;
      return;
    }
    for (const part of nameIncludes) {
      if (part && name.includes(part)) {
        child.visible = false;
        child.userData.skipCollision = true;
        return;
      }
    }
  });
}

function meshNameMatchesAny(name: string, patterns: readonly string[]) {
  return patterns.some((p) => p && name.includes(p));
}

function applySchoolGlbMaterialEnhancements(
  root: THREE.Object3D,
  opts: {
    yardAlbedo: THREE.Texture | null;
    wallAlbedo: THREE.Texture | null;
    doubleSideMeshIncludes: readonly string[];
  },
) {
  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const doubleSide = meshNameMatchesAny(mesh.name, opts.doubleSideMeshIncludes);
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];

    for (const mat of materials) {
      if (!mat || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        continue;
      }
      const stdMat = mat as THREE.MeshStandardMaterial;
      const matName = stdMat.name ?? "";
      if (doubleSide) {
        stdMat.side = THREE.DoubleSide;
      }
      if (!stdMat.map) {
        if (opts.yardAlbedo && matName.startsWith("M_School_yard")) {
          stdMat.map = opts.yardAlbedo;
          stdMat.map.colorSpace = THREE.SRGBColorSpace;
        } else if (
          opts.wallAlbedo && /^Material(\.|$)/.test(matName)
        ) {
          stdMat.map = opts.wallAlbedo;
          stdMat.map.colorSpace = THREE.SRGBColorSpace;
        }
      }
      stdMat.needsUpdate = true;
    }
  });
}

const GRASS_TEXTURE_URL = "/assets/grass-texture.jpg";
const SCHOOL_BACKDROP_PAD = 20;
const SCHOOL_SKY_RADIUS_FACTOR = 1.35;
const SCHOOL_SKY_RADIUS_MIN = 120;
const SCHOOL_SKY_RADIUS_MAX = 620;
const GRASS_METERS_PER_TILE = 400 / 60;

function SchoolGlbEnvironment({
  practiceMap,
  shadows,
  theme: _theme,
  onCollisionReady,
  showSkyBackdrop,
  skyAssetUrl,
}: {
  practiceMap: PracticeMapDefinition;
  shadows: boolean;
  theme: number;
  onCollisionReady?: (volumes: readonly BlockingVolume[]) => void;
  showSkyBackdrop: boolean;
  skyAssetUrl: string;
}) {
  void _theme;
  const worldBounds = practiceMap.worldBounds;
  const centerX = (worldBounds.minX + worldBounds.maxX) / 2;
  const centerZ = (worldBounds.minZ + worldBounds.maxZ) / 2;
  const sizeX = worldBounds.maxX - worldBounds.minX;
  const sizeZ = worldBounds.maxZ - worldBounds.minZ;
  const grassPlaneW = sizeX + SCHOOL_BACKDROP_PAD;
  const grassPlaneD = sizeZ + SCHOOL_BACKDROP_PAD;
  const skyRadius = THREE.MathUtils.clamp(
    SCHOOL_SKY_RADIUS_FACTOR * Math.max(sizeX, sizeZ),
    SCHOOL_SKY_RADIUS_MIN,
    SCHOOL_SKY_RADIUS_MAX,
  );
  const schoolEnv = practiceMap.environment.kind === "school-glb"
    ? practiceMap.environment
    : null;
  const modelUrl = schoolEnv?.modelUrl ?? "";
  const modelScale = schoolEnv?.scale ?? 1;
  const wallFallbackUrl = schoolEnv?.wallFallbackTextureUrl ?? "";

  const hiddenExact = useMemo(
    () => schoolEnv?.hiddenMeshExactNames ?? EMPTY_STRING_ARRAY,
    [schoolEnv],
  );
  const hiddenIncludes = useMemo(
    () => schoolEnv?.hiddenMeshNameIncludes ?? EMPTY_STRING_ARRAY,
    [schoolEnv],
  );
  const doubleSideIncludes = useMemo(
    () =>
      schoolEnv?.doubleSideMeshNameIncludes ?? SCHOOL_DEFAULT_DOUBLE_SIDE,
    [schoolEnv],
  );
  const onCollisionReadyRef = useRef(onCollisionReady);
  onCollisionReadyRef.current = onCollisionReady;

  const [mapScene, setMapScene] = useState<THREE.Group | null>(null);
  const [grassTexture, setGrassTexture] = useState<THREE.Texture | null>(null);
  const [yardGrassTexture, setYardGrassTexture] = useState<
    THREE.Texture | null
  >(null);
  const [wallFallbackTexture, setWallFallbackTexture] = useState<
    THREE.Texture | null
  >(null);

  useEffect(() => {
    let disposed = false;
    preloadTextureAsset(GRASS_TEXTURE_URL).then((tex) => {
      if (disposed || !tex) return;
      const ground = tex.clone();
      ground.wrapS = THREE.RepeatWrapping;
      ground.wrapT = THREE.RepeatWrapping;
      ground.repeat.set(
        grassPlaneW / GRASS_METERS_PER_TILE,
        grassPlaneD / GRASS_METERS_PER_TILE,
      );
      ground.colorSpace = THREE.SRGBColorSpace;
      ground.needsUpdate = true;
      setGrassTexture(ground);

      const yard = tex.clone();
      yard.wrapS = THREE.RepeatWrapping;
      yard.wrapT = THREE.RepeatWrapping;
      yard.repeat.set(6, 6);
      yard.colorSpace = THREE.SRGBColorSpace;
      yard.needsUpdate = true;
      setYardGrassTexture(yard);
    });
    return () => {
      disposed = true;
    };
  }, [grassPlaneW, grassPlaneD]);

  useEffect(() => {
    if (!wallFallbackUrl) {
      setWallFallbackTexture(null);
      return;
    }
    let disposed = false;
    preloadTextureAsset(wallFallbackUrl).then((tex) => {
      if (disposed || !tex) return;
      const wall = tex.clone();
      wall.wrapS = THREE.RepeatWrapping;
      wall.wrapT = THREE.RepeatWrapping;
      wall.repeat.set(3, 3);
      wall.colorSpace = THREE.SRGBColorSpace;
      wall.needsUpdate = true;
      setWallFallbackTexture(wall);
    });
    return () => {
      disposed = true;
    };
  }, [wallFallbackUrl]);

  useEffect(() => {
    if (!modelUrl) return;
    let disposed = false;
    loadGlbAsset(modelUrl).then((group) => {
      if (disposed || !group) return;
      const clone = group.clone(true);
      fixGlbMaterials(clone, shadows);
      hideSchoolGlbMeshes(clone, hiddenExact, hiddenIncludes);

      const volumes = extractCollisionVolumes(clone, modelScale);
      onCollisionReadyRef.current?.(volumes);

      setMapScene(clone);
    });
    return () => {
      disposed = true;
    };
  }, [modelUrl, shadows, modelScale, hiddenExact, hiddenIncludes]);

  useEffect(() => {
    if (!mapScene) return;
    applySchoolGlbMaterialEnhancements(mapScene, {
      yardAlbedo: yardGrassTexture,
      wallAlbedo: wallFallbackTexture,
      doubleSideMeshIncludes: doubleSideIncludes,
    });
  }, [
    mapScene,
    yardGrassTexture,
    wallFallbackTexture,
    doubleSideIncludes,
  ]);

  const skyTexture = useMemo(() => createSkyTexture(), []);

  useEffect(() => {
    return () => {
      skyTexture?.dispose();
    };
  }, [skyTexture]);

  return (
    <group>
      {showSkyBackdrop ? (
        <SkyBackdrop
          centerX={centerX}
          centerZ={centerZ}
          radius={skyRadius}
          skyAssetUrl={skyAssetUrl}
          fallbackTexture={skyTexture}
        />
      ) : null}

      <mesh
        position={[centerX, -0.02, centerZ]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
      >
        <planeGeometry args={[grassPlaneW, grassPlaneD]} />
        <meshStandardMaterial
          map={grassTexture}
          color="#5f7f43"
          roughness={0.96}
          metalness={0}
        />
      </mesh>

      <ambientLight intensity={0.52} color="#fff2de" />
      <hemisphereLight args={["#dcecff", "#6b5438", 0.62]} />
      <directionalLight
        position={[centerX + 20, 28, centerZ + 12]}
        intensity={0.82}
        color="#ffe0b8"
      />
      <directionalLight
        position={[centerX - 16, 14, centerZ - 18]}
        intensity={0.34}
        color="#9fcbff"
      />

      {mapScene && (
        <primitive
          object={mapScene}
          scale={[modelScale, modelScale, modelScale]}
        />
      )}
    </group>
  );
}

export function StressBoxes(
  { count, shadows }: { count: StressModeCount; shadows: boolean },
) {
  void count;
  void shadows;
  return null;
}

// ── Procedural TDM environment ──────────────────────────────

// Floor zone colours
const TDM_FLOOR_BLUE  = new THREE.Color("#3b4f6b");
const TDM_FLOOR_RED   = new THREE.Color("#6b3b3b");
const TDM_FLOOR_MID   = new THREE.Color("#4a5568");
const TDM_MIDLINE     = new THREE.Color("#e8d44d");

// Volume colours per zone
const TDM_WALL_BLUE   = new THREE.Color("#4e6180");
const TDM_WALL_RED    = new THREE.Color("#804e4e");
const TDM_WALL_MID    = new THREE.Color("#5a5a6a");
const TDM_COVER_BLUE  = new THREE.Color("#7a9ab8");
const TDM_COVER_RED   = new THREE.Color("#b87a7a");
const TDM_COVER_MID   = new THREE.Color("#a0816c");
const TDM_BOUNDARY    = new THREE.Color("#2d3748");

// z split between spawn zones and mid
const TDM_SPAWN_Z = 32;

function tdmVolumeColor(vol: BlockingVolume): THREE.Color {
  if (vol.size[0] >= 80 || vol.size[2] >= 100) return TDM_BOUNDARY;
  const z = vol.center[2];
  if (vol.material === "cover") {
    if (z < -TDM_SPAWN_Z) return TDM_COVER_BLUE;
    if (z >  TDM_SPAWN_Z) return TDM_COVER_RED;
    return TDM_COVER_MID;
  }
  if (z < -TDM_SPAWN_Z) return TDM_WALL_BLUE;
  if (z >  TDM_SPAWN_Z) return TDM_WALL_RED;
  return TDM_WALL_MID;
}

function TdmProceduralEnvironment({
  practiceMap,
  shadows,
  theme,
  showSkyBackdrop,
  skyAssetUrl,
}: {
  practiceMap: PracticeMapDefinition;
  shadows: boolean;
  theme: number;
  showSkyBackdrop: boolean;
  skyAssetUrl: string;
}) {
  const { worldBounds, blockingVolumes = [] } = practiceMap;
  const mapW  = worldBounds.maxX - worldBounds.minX;
  const mapCx = (worldBounds.minX + worldBounds.maxX) / 2;

  // Hard floor zones matching the map geometry
  const blueMinZ = -55, blueMaxZ = -TDM_SPAWN_Z;
  const redMinZ  =  TDM_SPAWN_Z, redMaxZ = 55;
  const midDepth = TDM_SPAWN_Z * 2;

  const shadowR = Math.max(worldBounds.maxX, worldBounds.maxZ) + 6;

  return (
    <group>
      <WorldBackdrop
        theme={theme}
        worldBounds={worldBounds}
        showSkyBackdrop={showSkyBackdrop}
        skyAssetUrl={skyAssetUrl}
        rangeTheme={DEFAULT_RANGE_THEME}
        surfaceBlend={theme}
      />

      {/* ── Blue base floor ── */}
      <mesh
        position={[mapCx, -0.05, (blueMinZ + blueMaxZ) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
      >
        <planeGeometry args={[mapW, blueMaxZ - blueMinZ]} />
        <meshStandardMaterial color={TDM_FLOOR_BLUE} roughness={0.85} />
      </mesh>

      {/* ── Neutral mid floor ── */}
      <mesh
        position={[mapCx, -0.05, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
      >
        <planeGeometry args={[mapW, midDepth]} />
        <meshStandardMaterial color={TDM_FLOOR_MID} roughness={0.85} />
      </mesh>

      {/* ── Red base floor ── */}
      <mesh
        position={[mapCx, -0.05, (redMinZ + redMaxZ) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
      >
        <planeGeometry args={[mapW, redMaxZ - redMinZ]} />
        <meshStandardMaterial color={TDM_FLOOR_RED} roughness={0.85} />
      </mesh>

      {/* ── Midfield warning strips ── */}
      <mesh position={[mapCx, -0.04, -TDM_SPAWN_Z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[mapW, 0.4]} />
        <meshStandardMaterial color={TDM_MIDLINE} emissive={TDM_MIDLINE} emissiveIntensity={0.3} roughness={0.6} />
      </mesh>
      <mesh position={[mapCx, -0.04, TDM_SPAWN_Z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[mapW, 0.4]} />
        <meshStandardMaterial color={TDM_MIDLINE} emissive={TDM_MIDLINE} emissiveIntensity={0.3} roughness={0.6} />
      </mesh>

      {/* ── Blocking volumes ── */}
      {blockingVolumes.map((vol, i) => (
        <mesh
          key={i}
          position={vol.center}
          castShadow={shadows}
          receiveShadow={shadows}
          userData={{ bulletHittable: true }}
        >
          <boxGeometry args={vol.size as [number, number, number]} />
          <meshStandardMaterial color={tdmVolumeColor(vol)} roughness={0.75} />
        </mesh>
      ))}

      {/* ── Team banners ── */}
      <mesh position={[-15, 3.5, -52]}><boxGeometry args={[0.25, 7, 0.08]} /><meshStandardMaterial color="#2563eb" emissive="#2563eb" emissiveIntensity={0.6} /></mesh>
      <mesh position={[ 15, 3.5, -52]}><boxGeometry args={[0.25, 7, 0.08]} /><meshStandardMaterial color="#2563eb" emissive="#2563eb" emissiveIntensity={0.6} /></mesh>
      <mesh position={[-15, 3.5,  52]}><boxGeometry args={[0.25, 7, 0.08]} /><meshStandardMaterial color="#dc2626" emissive="#dc2626" emissiveIntensity={0.6} /></mesh>
      <mesh position={[ 15, 3.5,  52]}><boxGeometry args={[0.25, 7, 0.08]} /><meshStandardMaterial color="#dc2626" emissive="#dc2626" emissiveIntensity={0.6} /></mesh>

      {/* ── Lighting ── */}
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[25, 40, 15]}
        intensity={1.2}
        castShadow={shadows}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-shadowR}
        shadow-camera-right={shadowR}
        shadow-camera-top={shadowR}
        shadow-camera-bottom={-shadowR}
      />
    </group>
  );
}

export function PracticeMapEnvironment({
  practiceMap,
  shadows,
  theme,
  floorGridOpacity,
  onCollisionReady,
  showSkyBackdrop = true,
  skyAssetUrl = DEFAULT_SKY_ASSET_URL,
  skyTheme = DEFAULT_RANGE_THEME,
  surfaceBlend = theme,
}: {
  practiceMap: PracticeMapDefinition;
  shadows: boolean;
  theme: number;
  floorGridOpacity: number;
  onCollisionReady?: (volumes: readonly BlockingVolume[]) => void;
  showSkyBackdrop?: boolean;
  skyAssetUrl?: string;
  skyTheme?: SkyEnvironmentTheme;
  surfaceBlend?: number;
}) {
  if (practiceMap.environment.kind === "school-glb") {
    return (
      <SchoolGlbEnvironment
        practiceMap={practiceMap}
        shadows={shadows}
        theme={theme}
        onCollisionReady={onCollisionReady}
        showSkyBackdrop={showSkyBackdrop}
        skyAssetUrl={skyAssetUrl}
      />
    );
  }

  if (practiceMap.environment.kind === "school-blockout") {
    return (
      <SchoolBlockoutEnvironment
        practiceMap={practiceMap}
        shadows={shadows}
        theme={theme}
        showSkyBackdrop={showSkyBackdrop}
        skyAssetUrl={skyAssetUrl}
      />
    );
  }

  if (practiceMap.environment.kind === "tdm-procedural") {
    return (
      <TdmProceduralEnvironment
        practiceMap={practiceMap}
        shadows={shadows}
        theme={theme}
        showSkyBackdrop={showSkyBackdrop}
        skyAssetUrl={skyAssetUrl ?? DEFAULT_SKY_ASSET_URL}
      />
    );
  }

  return (
    <MapEnvironment
      shadows={shadows}
      theme={theme}
      floorGridOpacity={floorGridOpacity}
      worldBounds={practiceMap.worldBounds}
      showSkyBackdrop={showSkyBackdrop}
      skyAssetUrl={skyAssetUrl}
      skyTheme={skyTheme}
      surfaceBlend={surfaceBlend}
    />
  );
}
