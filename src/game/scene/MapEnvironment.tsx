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
import { OCEAN_LEVEL_Y, OCEAN_SIZE } from "./scene-constants";
import {
  createGrassTexture,
  createIceTexture,
  createNightSkyTexture,
  createSkyTexture,
  createTundraTexture,
} from "./Textures";
import { loadGlbAsset, preloadTextureAsset } from "../AssetLoader";

const VOID_SKY = new THREE.Color("#040405");
const LIVE_SKY = new THREE.Color("#b8d4e8");
const VOID_WALKABLE = new THREE.Color("#080809");
const LIVE_WALKABLE = new THREE.Color("#e8e8e8");
const GRID_MAJOR_COLOR = new THREE.Color("#8fb3ff");
const GRID_MINOR_COLOR = new THREE.Color("#ffffff");
const TUNDRA_COLOR_VOID = new THREE.Color("#06080c");
const TUNDRA_COLOR_LIVE = new THREE.Color("#dde7f0");
const ICE_COLOR_VOID = new THREE.Color("#07111c");
const ICE_COLOR_LIVE = new THREE.Color("#7ab5c8");
const SCHOOL_BASE_VOID = new THREE.Color("#0b0b0d");
const SCHOOL_BASE_LIVE = new THREE.Color("#64615b");
const FLOOR_GRID_DIVISIONS = 16;
const BACKDROP_SHELF_SIZE = 760;
const RANGE_FLOOR_TEXTURE_URL = "/assets/range-floor-texture.jpg";
const RANGE_FLOOR_METERS_PER_TILE = 8;
const SKY_ASSET_URL = "/assets/sky/sky.glb";
const SKY_ASSET_BASE_RADIUS = 500;
const WORLD_SKY_RADIUS = 560;

const POOL_MIN_X = 34;
const POOL_MAX_X = 40;
const POOL_MIN_Z = 16;
const POOL_MAX_Z = 34;
const POOL_WATER_Y = -1.1;
const POOL_FLOOR_Y = -1.75;
const POOL_WALL_HEIGHT = 1.6;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function blendColor(from: THREE.Color, to: THREE.Color, amount: number) {
  return new THREE.Color().copy(from).lerp(to, clamp01(amount));
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
  fallbackColor,
  fallbackTexture,
}: {
  centerX: number;
  centerZ: number;
  radius: number;
  fallbackColor?: THREE.ColorRepresentation;
  fallbackTexture?: THREE.Texture | null;
}) {
  const [skyScene, setSkyScene] = useState<THREE.Group | null>(null);

  useEffect(() => {
    let disposed = false;
    let localScene: THREE.Group | null = null;

    loadGlbAsset(SKY_ASSET_URL).then((group) => {
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
  }, []);

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
}: {
  theme: number;
  worldBounds: PracticeMapDefinition["worldBounds"];
  showSkyBackdrop?: boolean;
}) {
  const skyTexture = useMemo(() => createSkyTexture(), []);
  const nightSkyTexture = useMemo(() => createNightSkyTexture(), []);
  const tundraTexture = useMemo(() => createTundraTexture(), []);
  const iceTexture = useMemo(() => createIceTexture(), []);
  const liveTheme = clamp01(theme);
  const textureReveal = clamp01((liveTheme - 0.52) / 0.48);
  const allowTextures = textureReveal > 0.001;
  const walkableCenterX = (worldBounds.minX + worldBounds.maxX) / 2;
  const walkableCenterZ = (worldBounds.minZ + worldBounds.maxZ) / 2;

  useEffect(() => {
    return () => {
      skyTexture?.dispose();
      nightSkyTexture?.dispose();
      tundraTexture?.dispose();
      iceTexture?.dispose();
    };
  }, [iceTexture, nightSkyTexture, skyTexture, tundraTexture]);

  return (
    <group>
      {showSkyBackdrop ? (
        <SkyBackdrop
          centerX={walkableCenterX}
          centerZ={walkableCenterZ}
          radius={WORLD_SKY_RADIUS}
          fallbackColor={blendColor(VOID_SKY, LIVE_SKY, textureReveal)}
          fallbackTexture={allowTextures ? skyTexture : nightSkyTexture}
        />
      ) : null}

      <mesh
        position={[walkableCenterX, -0.12, walkableCenterZ]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[BACKDROP_SHELF_SIZE, BACKDROP_SHELF_SIZE]} />
        <meshStandardMaterial
          color={blendColor(TUNDRA_COLOR_VOID, TUNDRA_COLOR_LIVE, liveTheme)}
          map={allowTextures ? tundraTexture ?? undefined : undefined}
          roughness={0.98}
          metalness={0.03}
        />
      </mesh>

      <mesh
        position={[walkableCenterX, OCEAN_LEVEL_Y, walkableCenterZ]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[OCEAN_SIZE, OCEAN_SIZE]} />
        <meshStandardMaterial
          color={blendColor(ICE_COLOR_VOID, ICE_COLOR_LIVE, liveTheme)}
          map={allowTextures ? iceTexture ?? undefined : undefined}
          roughness={THREE.MathUtils.lerp(0.96, 0.46, liveTheme)}
          metalness={THREE.MathUtils.lerp(0.02, 0.18, liveTheme)}
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
};

export function MapEnvironment({
  shadows,
  theme,
  floorGridOpacity,
  worldBounds = RANGE_PRACTICE_MAP.worldBounds,
  showSkyBackdrop = true,
}: MapEnvironmentProps) {
  const grassTexture = useMemo(() => createGrassTexture(), []);
  const [rangeFloorTexture, setRangeFloorTexture] = useState<
    THREE.Texture | null
  >(null);
  const floorGridRef = useRef<THREE.GridHelper>(null);
  const liveTheme = clamp01(theme);
  const textureReveal = clamp01((liveTheme - 0.52) / 0.48);
  const allowTextures = textureReveal > 0.001;
  const shadowEnabled = shadows && liveTheme > 0.6;
  const walkableCenterX = (worldBounds.minX + worldBounds.maxX) / 2;
  const walkableCenterZ = (worldBounds.minZ + worldBounds.maxZ) / 2;
  const walkableSizeX = worldBounds.maxX - worldBounds.minX;
  const walkableSizeZ = worldBounds.maxZ - worldBounds.minZ;

  useEffect(() => {
    let disposed = false;
    preloadTextureAsset(RANGE_FLOOR_TEXTURE_URL).then((tex) => {
      if (disposed || !tex) return;
      const floor = tex.clone();
      floor.wrapS = THREE.RepeatWrapping;
      floor.wrapT = THREE.RepeatWrapping;
      floor.repeat.set(
        walkableSizeX / RANGE_FLOOR_METERS_PER_TILE,
        walkableSizeZ / RANGE_FLOOR_METERS_PER_TILE,
      );
      floor.colorSpace = THREE.SRGBColorSpace;
      floor.needsUpdate = true;
      setRangeFloorTexture(floor);
    });
    return () => {
      disposed = true;
    };
  }, [walkableSizeX, walkableSizeZ]);

  useEffect(() => {
    return () => {
      grassTexture?.dispose();
    };
  }, [grassTexture]);

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

  return (
    <group>
      <WorldBackdrop
        theme={theme}
        worldBounds={worldBounds}
        showSkyBackdrop={showSkyBackdrop}
      />

      <ambientLight
        intensity={THREE.MathUtils.lerp(0, 0.25, liveTheme)}
        color="#ffffff"
      />
      <directionalLight
        position={[walkableCenterX + 20, 30, walkableCenterZ + 10]}
        intensity={THREE.MathUtils.lerp(0, 0.3, liveTheme)}
        color="#fff8ee"
      />

      <mesh
        position={[walkableCenterX, 0, walkableCenterZ]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow={shadowEnabled}
        userData={{ bulletHittable: true }}
      >
        <planeGeometry args={[walkableSizeX, walkableSizeZ]} />
        <meshStandardMaterial
          color={blendColor(VOID_WALKABLE, LIVE_WALKABLE, liveTheme)}
          map={allowTextures
            ? (rangeFloorTexture ?? grassTexture ?? undefined)
            : undefined}
          roughness={THREE.MathUtils.lerp(1, 0.85, liveTheme)}
          metalness={THREE.MathUtils.lerp(0, 0.02, liveTheme)}
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
}: {
  practiceMap: PracticeMapDefinition;
  shadows: boolean;
  theme: number;
  showSkyBackdrop: boolean;
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

function extractCollisionVolumes(
  root: THREE.Object3D,
  scale: number,
): BlockingVolume[] {
  const volumes: BlockingVolume[] = [];
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

    const size = new THREE.Vector3();
    box.getSize(size);

    if (size.y < MIN_WALL_HEIGHT) return;
    if (box.max.y < MIN_WALL_TOP_Y) return;

    const center = new THREE.Vector3();
    box.getCenter(center);

    volumes.push({
      center: [center.x, center.y, center.z],
      size: [size.x, size.y, size.z],
    });
  });

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
}: {
  practiceMap: PracticeMapDefinition;
  shadows: boolean;
  theme: number;
  onCollisionReady?: (volumes: readonly BlockingVolume[]) => void;
  showSkyBackdrop: boolean;
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

export function PracticeMapEnvironment({
  practiceMap,
  shadows,
  theme,
  floorGridOpacity,
  onCollisionReady,
  showSkyBackdrop = true,
}: {
  practiceMap: PracticeMapDefinition;
  shadows: boolean;
  theme: number;
  floorGridOpacity: number;
  onCollisionReady?: (volumes: readonly BlockingVolume[]) => void;
  showSkyBackdrop?: boolean;
}) {
  if (practiceMap.environment.kind === "school-glb") {
    return (
      <SchoolGlbEnvironment
        practiceMap={practiceMap}
        shadows={shadows}
        theme={theme}
        onCollisionReady={onCollisionReady}
        showSkyBackdrop={showSkyBackdrop}
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
    />
  );
}
