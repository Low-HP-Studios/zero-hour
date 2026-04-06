import type { BlockingVolume, JumpPad, WalkableSurface } from '../map-layout';
import type { CollisionRect, MapId, TargetState, WorldBounds } from '../types';
import { createDefaultTargets } from '../Targets';
import type { StaticGroundSpawn } from '../inventory/inventory-data';

export type OccluderVolume = {
  center: [number, number, number];
  size: [number, number, number];
};

export type PracticeMapEnvironment =
  | { kind: 'range-procedural' }
  | { kind: 'school-blockout' }
  | {
      kind: 'school-glb';
      modelUrl: string;
      scale?: number;
      hiddenMeshExactNames?: readonly string[];
      hiddenMeshNameIncludes?: readonly string[];
      doubleSideMeshNameIncludes?: readonly string[];
      wallFallbackTextureUrl?: string;
    }
  | { kind: 'tdm-procedural' };

export type PracticeMapDefinition = {
  id: MapId;
  label: string;
  description: string;
  supportsStressMode: boolean;
  worldBounds: WorldBounds;
  playerBounds?: WorldBounds;
  collisionRects: readonly CollisionRect[];
  occluderVolumes: readonly OccluderVolume[];
  playerSpawn: {
    position: [number, number, number];
    yaw: number;
    pitch: number;
  };
  multiplayerSpawns?: Array<{
      position: [number, number, number];
      yaw: number;
      pitch: number;
    }>;
  targets: readonly TargetState[];
  groundSpawns: readonly StaticGroundSpawn[];
  walkableSurfaces?: readonly WalkableSurface[];
  blockingVolumes?: readonly BlockingVolume[];
  jumpPads?: readonly JumpPad[];
  infiniteAmmo?: boolean;
  spawnWithRifle?: boolean;
  environment: PracticeMapEnvironment;
};

const DEFAULT_PLAYER_PITCH = -0.05;

// ── Practice Range ─────────────────────────────────────────

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

// ═══════════════════════════════════════════════════════════
// TDM — PUBG-style arena
//
// Play area :  84 wide  (x: −42 … +42)
//             110 deep  (z: −55 … +55)
//
// Zones:
//   BLUE SPAWN  z ∈ [−55, −32]   (23 deep)
//   MID         z ∈ [−32, +32]   (64 deep)
//   RED SPAWN   z ∈ [+32, +55]   (23 deep)
// ═══════════════════════════════════════════════════════════

const TDM_WORLD_BOUNDS: WorldBounds = {
  minX: -44,
  maxX: 44,
  minZ: -57,
  maxZ: 57,
};

// ── Geometry helpers ──────────────────────────────────────

const W = 0.3; // wall panel thickness
const WH = 3.8; // standard wall height

/** Full-height wall panel centered at (cx, cz). */
function wall(
  cx: number,
  cz: number,
  sx: number,
  sz: number,
  h = WH,
): BlockingVolume {
  return { center: [cx, h / 2, cz], size: [sx, h, sz], material: 'wall' };
}

/** Tall climbable crate/container — height `h` (default 2.6). */
function crate(
  cx: number,
  cz: number,
  sx: number,
  sz: number,
  h = 2.6,
): BlockingVolume {
  return { center: [cx, h / 2, cz], size: [sx, h, sz], material: 'cover' };
}

// ── Outer boundary ─────────────────────────────────────────
const BOUNDARY: readonly BlockingVolume[] = [
  wall(0, -55, 84, W), // north
  wall(0, 55, 84, W), // south
  wall(-42, 0, W, 110), // west
  wall(42, 0, W, 110), // east
];

const TDM_PLAYER_BOUNDS: WorldBounds = {
  minX: -42 + W / 2,
  maxX: 42 - W / 2,
  minZ: -55 + W / 2,
  maxZ: 55 - W / 2,
};

// ═══════════════════════════════════════════════════════════
// BLUE SPAWN  (z: −55 … −32)
//
//  z=−55  ████████████████████████████████████████  back wall
//         [  open spawn area — no obstacles      ]
//  z=−33  [left gap]  ████████████  [right gap]
//              single wall blocks view from mid
//  z=−32  ────────────────────────────────────────  mid boundary
// ═══════════════════════════════════════════════════════════
//
// One wall at z=−33 spans x=−20…+20, blocking direct fire from mid.
// Players exit left (x < −20) or right (x > +20) to reach mid.

const BLUE_SPAWN: readonly BlockingVolume[] = [
  wall(0, -33, 40, W), // single wall — blocks line-of-sight from mid
];

// RED SPAWN is the exact z-mirror of blue.
const RED_SPAWN: readonly BlockingVolume[] = BLUE_SPAWN.map((vol) => ({
  ...vol,
  center: [vol.center[0], vol.center[1], -vol.center[2]] as [
    number,
    number,
    number,
  ],
}));

// ═══════════════════════════════════════════════════════════
// MID  (z: −32 … +32)
//
//  Single warehouse centered at origin — 48 wide × 36 deep.
//  One doorway on each of the 4 sides (8-unit gap at center).
//  Roof slab sits flush on top of the walls (y = WH).
// ═══════════════════════════════════════════════════════════

// Warehouse  (x: −24…+24, z: −18…+18)
const WAREHOUSE: readonly BlockingVolume[] = [
  // ── north wall (z = −18) — doorway x −4…+4 ──
  wall(-14, -18, 20, W), // west half  (x −24 to −4)
  wall(14, -18, 20, W), // east half  (x +4 to +24)

  // ── south wall (z = +18) ──
  wall(-14, 18, 20, W),
  wall(14, 18, 20, W),

  // ── west wall (x = −24) — doorway z −4…+4 ──
  wall(-24, -11, W, 14), // north half  (z −18 to −4)
  wall(-24, 11, W, 14), // south half  (z +4 to +18)

  // ── east wall (x = +24) ──
  wall(24, -11, W, 14),
  wall(24, 11, W, 14),

  // ── roof slab (sits flush on top of walls at y = WH) ──
  {
    center: [0, WH + W / 2, 0] as [number, number, number],
    size: [48, W, 36] as [number, number, number],
    material: 'wall',
  },

  // ── interior crates ──
  crate(-12, -6, 6, 6, 2.6),
  crate(12, 6, 6, 6, 2.6),
];

// Flank crates — one per open corridor outside the warehouse walls.
// Offset from the direct sightline so players coming from spawn have cover
// before peeking into mid, and campers at the warehouse doorways are blocked.
//
//  blue side (z < 0):  left flank x=−33  |  right flank x=+33  at z=−24
//  red  side (z > 0):  mirrored at z=+24
const FLANK_CRATES: readonly BlockingVolume[] = [
  crate(-33, -24, 5, 5, 2.6), // left-blue
  crate(33, -24, 5, 5, 2.6), // right-blue
  crate(-33, 24, 5, 5, 2.6), // left-red
  crate(33, 24, 5, 5, 2.6), // right-red
];

const TDM_BLOCKING_VOLUMES: readonly BlockingVolume[] = [
  ...BOUNDARY,
  ...BLUE_SPAWN,
  ...RED_SPAWN,
  ...WAREHOUSE,
  ...FLANK_CRATES,
];

// ── Walkable surfaces ──────────────────────────────────────
const TDM_WALKABLE_SURFACES: readonly WalkableSurface[] = [
  // Ground floor — full play area
  {
    kind: 'slab',
    minX: -42,
    maxX: 42,
    minZ: -55,
    maxZ: 55,
    y: 0,
    material: 'yard',
  },

  // Warehouse interior crate tops  (matches crate(-12,-6,6,6) and crate(12,6,6,6))
  {
    kind: 'slab',
    minX: -15,
    maxX: -9,
    minZ: -9,
    maxZ: -3,
    y: 2.6,
    material: 'upper',
  },
  {
    kind: 'slab',
    minX: 9,
    maxX: 15,
    minZ: 3,
    maxZ: 9,
    y: 2.6,
    material: 'upper',
  },
];

// ── Jump pads ─────────────────────────────────────────────
// Two pads per spawn side (left + right of the spawn wall gap), 4 total.
// Placed inside the protected spawn flank lanes at z=±40.
const TDM_JUMP_PAD_BOOST = 35;
const TDM_JUMP_PAD_LAUNCH_SPEED = 21;
const TDM_JUMP_PAD_BASE_WIDTH = 8;
const TDM_JUMP_PAD_BASE_DEPTH = 6;
const TDM_JUMP_PAD_AREA_SCALE = 0.6;
const TDM_JUMP_PAD_DIMENSION_SCALE = Math.sqrt(TDM_JUMP_PAD_AREA_SCALE);
const TDM_JUMP_PAD_WIDTH = TDM_JUMP_PAD_BASE_WIDTH *
  TDM_JUMP_PAD_DIMENSION_SCALE;
const TDM_JUMP_PAD_DEPTH = TDM_JUMP_PAD_BASE_DEPTH *
  TDM_JUMP_PAD_DIMENSION_SCALE;

function createTdmJumpPad(centerX: number, centerZ: number): JumpPad {
  const halfWidth = TDM_JUMP_PAD_WIDTH / 2;
  const halfDepth = TDM_JUMP_PAD_DEPTH / 2;
  return {
    minX: centerX - halfWidth,
    maxX: centerX + halfWidth,
    minZ: centerZ - halfDepth,
    maxZ: centerZ + halfDepth,
    y: 0,
    boostVelocity: TDM_JUMP_PAD_BOOST,
    launchPlanarSpeed: TDM_JUMP_PAD_LAUNCH_SPEED,
  };
}

const TDM_JUMP_PADS: readonly JumpPad[] = [
  // blue side
  createTdmJumpPad(-31, -40),
  createTdmJumpPad(31, -40),
  // red side (z-mirrored)
  createTdmJumpPad(-31, 40),
  createTdmJumpPad(31, 40),
];

// ── Spawn ─────────────────────────────────────────────────
// Player spawns in blue base (z = −50), between the truck and first sandbag row.
const MAP1_PLAYER_SPAWN = {
  position: [0, 0.5, -50] as [number, number, number],
  yaw: Math.PI, // facing south → toward mid
  pitch: DEFAULT_PLAYER_PITCH,
};

// ── Map definitions ────────────────────────────────────────

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
  multiplayerSpawns: [
    {
      position: [-1.4, 0, 6],
      yaw: 0,
      pitch: DEFAULT_PLAYER_PITCH,
    },
    {
      position: [1.4, 0, 6],
      yaw: 0,
      pitch: DEFAULT_PLAYER_PITCH,
    },
  ],
  targets: createDefaultTargets(),
  groundSpawns: RANGE_GROUND_SPAWNS,
  environment: { kind: 'range-procedural' },
};

export const MAP1_PRACTICE_MAP: PracticeMapDefinition = {
  id: 'map1',
  label: 'TDM',
  description:
    'PUBG-style Team Deathmatch — mirrored bases, buildings, and center lane.',
  supportsStressMode: false,
  worldBounds: TDM_WORLD_BOUNDS,
  playerBounds: TDM_PLAYER_BOUNDS,
  collisionRects: [],
  occluderVolumes: [],
  playerSpawn: MAP1_PLAYER_SPAWN,
  multiplayerSpawns: [
    MAP1_PLAYER_SPAWN,
    {
      position: [0, 0.5, 50],
      yaw: 0,
      pitch: DEFAULT_PLAYER_PITCH,
    },
  ],
  targets: [],
  groundSpawns: [],
  walkableSurfaces: TDM_WALKABLE_SURFACES,
  blockingVolumes: TDM_BLOCKING_VOLUMES,
  jumpPads: TDM_JUMP_PADS,
  infiniteAmmo: true,
  spawnWithRifle: true,
  environment: { kind: 'tdm-procedural' },
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
