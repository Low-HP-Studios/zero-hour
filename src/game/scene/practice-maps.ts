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

const SCHOOL_WORLD_BOUNDS: WorldBounds = {
  minX: -100,
  maxX: 100,
  minZ: -100,
  maxZ: 100,
};

const MAP1_COLLIDERS: readonly CollisionRect[] = [];

const MAP1_OCCLUDERS: readonly OccluderVolume[] = [];

const MAP1_PLAYER_SPAWN = {
  position: [0, 0.5, 2] as [number, number, number],
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
  label: 'School',
  description:
    'Movement-first school blockout with a 2-floor main building and pool wing.',
  supportsStressMode: false,
  worldBounds: SCHOOL_WORLD_BOUNDS,
  collisionRects: MAP1_COLLIDERS,
  occluderVolumes: MAP1_OCCLUDERS,
  playerSpawn: MAP1_PLAYER_SPAWN,
  targets: [],
  groundSpawns: [],
  walkableSurfaces: [],
  blockingVolumes: [],
  infiniteAmmo: true,
  spawnWithRifle: true,
  environment: {
    kind: 'school-glb',
    modelUrl: '/assets/map/map1.glb',
    scale: 0.75,
    doubleSideMeshNameIncludes: ['walkable_slab', 'blocker_wall', 'Cube'],
    wallFallbackTextureUrl: '/assets/space/glTF/Rocks_Desert_Diffuse.png',
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
