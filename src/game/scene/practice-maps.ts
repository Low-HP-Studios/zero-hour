import type { BlockingVolume, WalkableSurface } from '../map-layout';
import type { CollisionRect, MapId, TargetState, WorldBounds } from '../types';
import { createDefaultTargets } from '../Targets';
import type { StaticGroundSpawn } from '../inventory/inventory-data';

export type OccluderVolume = {
  center: [number, number, number];
  size: [number, number, number];
};

export type PracticeMapEnvironment =
  | {
      kind: 'range-procedural';
    }
  | {
      kind: 'school-blockout';
    }
  | {
      kind: 'school-glb';
      modelUrl: string;
      scale?: number;
      hiddenMeshExactNames?: readonly string[];
      hiddenMeshNameIncludes?: readonly string[];
      doubleSideMeshNameIncludes?: readonly string[];
      wallFallbackTextureUrl?: string;
    }
  | {
      kind: 'tdm-procedural';
    };

export type PracticeMapDefinition = {
  id: MapId;
  label: string;
  description: string;
  supportsStressMode: boolean;
  worldBounds: WorldBounds;
  collisionRects: readonly CollisionRect[];
  occluderVolumes: readonly OccluderVolume[];
  playerSpawn: {
    position: [number, number, number];
    yaw: number;
    pitch: number;
  };
  targets: readonly TargetState[];
  groundSpawns: readonly StaticGroundSpawn[];
  walkableSurfaces?: readonly WalkableSurface[];
  blockingVolumes?: readonly BlockingVolume[];
  infiniteAmmo?: boolean;
  spawnWithRifle?: boolean;
  environment: PracticeMapEnvironment;
};

const DEFAULT_PLAYER_PITCH = -0.05;

const RANGE_WORLD_BOUNDS: WorldBounds = {
  minX: -80,
  maxX: 80,
  minZ: -80,
  maxZ: 80,
};

const RANGE_COLLIDERS: readonly CollisionRect[] = [
  { minX: -62, maxX: -58, minZ: -42, maxZ: -38 },
  { minX: 53, maxX: 57, minZ: 38, maxZ: 42 },
];

const RANGE_GROUND_SPAWNS: readonly StaticGroundSpawn[] = [
  { itemId: 'weapon_rifle', quantity: 1, position: [1.4, 0.05, 3.5] },
  { itemId: 'weapon_sniper', quantity: 1, position: [1.9, 0.05, 3.5] },
  { itemId: 'ammo_rifle', quantity: 150, position: [0.95, 0.14, 3.85] },
  { itemId: 'ammo_sniper', quantity: 30, position: [2.35, 0.14, 3.85] },
];

const TDM_WORLD_BOUNDS: WorldBounds = {
  minX: -32,
  maxX: 32,
  minZ: -22,
  maxZ: 22,
};

const W = 0.3; // wall thickness
const WH = 3.8; // wall height
const COVER_H = 1.3; // cover box height
const CH = COVER_H / 2;

function wall(
  cx: number,
  cz: number,
  sx: number,
  sz: number,
  h = WH,
): BlockingVolume {
  return { center: [cx, h / 2, cz], size: [sx, h, sz], material: 'wall' };
}
function cover(
  cx: number,
  cz: number,
  sx: number,
  sz: number,
): BlockingVolume {
  return { center: [cx, CH, cz], size: [sx, COVER_H, sz], material: 'cover' };
}

// ── TDM map geometry ───────────────────────────────────────
// Arena: 60 wide (x ±30) × 40 deep (z ±20)
const TDM_BLOCKING_VOLUMES: readonly BlockingVolume[] = [
  // ── outer boundary ──
  wall(0, -20, 60, W),        // north
  wall(0, 20, 60, W),         // south
  wall(-30, 0, W, 40),        // west
  wall(30, 0, W, 40),         // east

  // ── building A (NW corner) ──
  wall(-22, -16, 8, W),       // north wall
  wall(-26, -13.5, W, 5),     // west wall
  wall(-18, -16.5, W, 3),     // east wall (partial – doorway south)

  // ── building B (NE corner) ──
  wall(22, -16, 8, W),        // north wall
  wall(26, -13.5, W, 5),      // east wall
  wall(18, -16.5, W, 3),      // west wall (partial – doorway south)

  // ── building C (SW corner) ──
  wall(-22, 16, 8, W),        // south wall
  wall(-26, 13.5, W, 5),      // west wall
  wall(-18, 16.5, W, 3),      // east wall (partial – doorway north)

  // ── building D (SE corner) ──
  wall(22, 16, 8, W),         // south wall
  wall(26, 13.5, W, 5),       // east wall
  wall(18, 16.5, W, 3),       // west wall (partial – doorway north)

  // ── center structure (cross-shaped divider) ──
  wall(0, -6, W, 8),          // north arm
  wall(0, 6, W, 8),           // south arm
  wall(-5, 0, 6, W),          // west arm
  wall(5, 0, 6, W),           // east arm

  // ── mid-field walls ──
  wall(-12, -6, 6, W),        // NW mid
  wall(12, -6, 6, W),         // NE mid
  wall(-12, 6, 6, W),         // SW mid
  wall(12, 6, 6, W),          // SE mid

  // ── scattered cover boxes ──
  cover(-8, 0, 2, 2),
  cover(8, 0, 2, 2),
  cover(0, -14, 3, 1.2),
  cover(0, 14, 3, 1.2),
  cover(-20, 0, 1.5, 3),
  cover(20, 0, 1.5, 3),
  cover(-14, -14, 1.5, 1.5),
  cover(14, -14, 1.5, 1.5),
  cover(-14, 14, 1.5, 1.5),
  cover(14, 14, 1.5, 1.5),
];

const TDM_WALKABLE_SURFACES: readonly WalkableSurface[] = [
  {
    kind: 'slab',
    minX: -30,
    maxX: 30,
    minZ: -20,
    maxZ: 20,
    y: 0,
    material: 'yard',
  },
];

const MAP1_PLAYER_SPAWN = {
  position: [0, 0.5, -10] as [number, number, number],
  yaw: Math.PI,
  pitch: DEFAULT_PLAYER_PITCH,
};

export const RANGE_PRACTICE_MAP: PracticeMapDefinition = {
  id: 'range',
  label: 'Range',
  description:
    'Procedural practice range with the existing stress-box load test.',
  supportsStressMode: true,
  worldBounds: RANGE_WORLD_BOUNDS,
  collisionRects: RANGE_COLLIDERS,
  occluderVolumes: [],
  playerSpawn: {
    position: [0, 0, 6],
    yaw: 0,
    pitch: DEFAULT_PLAYER_PITCH,
  },
  targets: createDefaultTargets(),
  groundSpawns: RANGE_GROUND_SPAWNS,
  environment: {
    kind: 'range-procedural',
  },
};

export const MAP1_PRACTICE_MAP: PracticeMapDefinition = {
  id: 'map1',
  label: 'TDM',
  description: 'Procedural TDM arena with four corner rooms and a center cross.',
  supportsStressMode: false,
  worldBounds: TDM_WORLD_BOUNDS,
  collisionRects: [],
  occluderVolumes: [],
  playerSpawn: MAP1_PLAYER_SPAWN,
  targets: [],
  groundSpawns: [],
  walkableSurfaces: TDM_WALKABLE_SURFACES,
  blockingVolumes: TDM_BLOCKING_VOLUMES,
  infiniteAmmo: true,
  spawnWithRifle: true,
  environment: {
    kind: 'tdm-procedural',
  },
};

export const PRACTICE_MAPS: Record<MapId, PracticeMapDefinition> = {
  range: RANGE_PRACTICE_MAP,
  map1: MAP1_PRACTICE_MAP,
};

export const PRACTICE_MAP_OPTIONS = [
  {
    id: RANGE_PRACTICE_MAP.id,
    label: RANGE_PRACTICE_MAP.label,
    description: RANGE_PRACTICE_MAP.description,
  },
  {
    id: MAP1_PRACTICE_MAP.id,
    label: MAP1_PRACTICE_MAP.label,
    description: MAP1_PRACTICE_MAP.description,
  },
] as const;

export function getPracticeMapById(mapId: MapId) {
  return PRACTICE_MAPS[mapId];
}

export function clonePracticeMapTargets(
  targets: readonly TargetState[],
): TargetState[] {
  return targets.map((target) => ({
    ...target,
    position: [...target.position] as [number, number, number],
  }));
}
