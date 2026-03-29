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
  /** Multiple spawn positions for player respawn (TDM) */
  playerSpawns?: readonly [number, number, number][];
  /** Spawn positions for enemy bots */
  botSpawns?: readonly [number, number, number][];
  /** Patrol waypoints for bot AI */
  botWaypoints?: readonly [number, number, number][];
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

// ── TDM map constants ──────────────────────────────────────
// Arena: 100 wide (x ±50) × 70 deep (z ±35)

const TDM_WORLD_BOUNDS: WorldBounds = {
  minX: -52,
  maxX: 52,
  minZ: -37,
  maxZ: 37,
};

const W = 0.3; // wall thickness
const WH = 3.8; // wall height
const COVER_H = 1.3; // cover box height
const CH = COVER_H / 2;
const CATWALK_Y = 3; // elevated catwalk height
const RAILING_H = 1.0; // railing height on catwalk

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
function coverAt(
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sz: number,
  h = COVER_H,
): BlockingVolume {
  return { center: [cx, cy + h / 2, cz], size: [sx, h, sz], material: 'cover' };
}
function railing(
  cx: number,
  cz: number,
  sx: number,
  sz: number,
): BlockingVolume {
  return {
    center: [cx, CATWALK_Y + RAILING_H / 2, cz],
    size: [sx, RAILING_H, sz],
    material: 'railing',
  };
}

// ── TDM blocking volumes ───────────────────────────────────
const TDM_BLOCKING_VOLUMES: readonly BlockingVolume[] = [
  // ══════════════════════════════════════════════════════════
  // OUTER BOUNDARY
  // ══════════════════════════════════════════════════════════
  wall(0, -35, 100, W),         // north
  wall(0, 35, 100, W),          // south
  wall(-50, 0, W, 70),          // west
  wall(50, 0, W, 70),           // east

  // ══════════════════════════════════════════════════════════
  // CENTRAL WAREHOUSE (~24 x 18, centered at origin)
  // Walls have doorway gaps for entry
  // ══════════════════════════════════════════════════════════
  // ── north wall (z = -9): two segments with center gap (3u) + offset gap ──
  wall(-8.5, -9, 7, W),         // north wall left segment
  wall(8.5, -9, 7, W),          // north wall right segment
  // gap at x ∈ [-5, 5] = main door, gap at [5, 12] covered by right segment

  // ── south wall (z = 9): mirror of north ──
  wall(-8.5, 9, 7, W),          // south wall left segment
  wall(8.5, 9, 7, W),           // south wall right segment

  // ── west wall (x = -12): single segment with center gap ──
  wall(-12, -5.5, W, 7),        // west wall upper segment
  wall(-12, 5.5, W, 7),         // west wall lower segment
  // gap at z ∈ [-2, 2]

  // ── east wall (x = 12): mirror of west ──
  wall(12, -5.5, W, 7),         // east wall upper segment
  wall(12, 5.5, W, 7),          // east wall lower segment

  // ── warehouse interior cover ──
  cover(-6, -4, 2.5, 1.5),      // NW interior crate
  cover(6, -4, 2.5, 1.5),       // NE interior crate
  cover(-6, 4, 2.5, 1.5),       // SW interior crate
  cover(6, 4, 2.5, 1.5),        // SE interior crate
  cover(0, 0, 3, 2),            // center barrier
  cover(-3, 0, 1.5, 1.5),       // left of center
  cover(3, 0, 1.5, 1.5),        // right of center

  // ── catwalk railings (along the elevated walkway edges) ──
  railing(0, -2, 18, W),        // north railing
  railing(0, 2, 18, W),         // south railing
  // ramp-side walls (prevent walking off the ramp sides)
  wall(-11, 0, W, 4, CATWALK_Y),  // west ramp left wall
  wall(11, 0, W, 4, CATWALK_Y),   // east ramp right wall

  // ══════════════════════════════════════════════════════════
  // TEAM BASE A — BLUE (negative Z, z ∈ [-35, -14])
  // ══════════════════════════════════════════════════════════

  // ── left room (NW area) ──
  wall(-38, -28, 10, W),        // north wall
  wall(-43, -24, W, 8),         // west wall
  wall(-33, -26, W, 4),         // east wall (partial — doorway south)

  // ── right room (NE area) ──
  wall(38, -28, 10, W),         // north wall
  wall(43, -24, W, 8),          // east wall
  wall(33, -26, W, 4),          // west wall (partial — doorway south)

  // ── mid connector wall ──
  wall(0, -18, 8, W),           // horizontal wall between bases and mid

  // ── climbable crate stacks (left side) ──
  cover(-20, -28, 3, 3),                      // tier 1 — ground level
  coverAt(-20, COVER_H, -25, 2.5, 2.5),       // tier 2 — on top of tier 1
  coverAt(-20, COVER_H * 2, -22.5, 2, 2),     // tier 3 — on top of tier 2

  // ── climbable crate stacks (right side) ──
  cover(20, -28, 3, 3),                        // tier 1
  coverAt(20, COVER_H, -25, 2.5, 2.5),         // tier 2
  coverAt(20, COVER_H * 2, -22.5, 2, 2),       // tier 3

  // ── scattered cover in blue base ──
  cover(-10, -25, 2, 1.5),
  cover(10, -25, 2, 1.5),
  cover(0, -30, 3, 1.2),
  cover(-30, -20, 1.5, 2),
  cover(30, -20, 1.5, 2),

  // ══════════════════════════════════════════════════════════
  // TEAM BASE B — RED (positive Z, z ∈ [14, 35]) — mirror of blue
  // ══════════════════════════════════════════════════════════

  // ── left room (SW area) ──
  wall(-38, 28, 10, W),         // south wall
  wall(-43, 24, W, 8),          // west wall
  wall(-33, 26, W, 4),          // east wall (partial — doorway north)

  // ── right room (SE area) ──
  wall(38, 28, 10, W),          // south wall
  wall(43, 24, W, 8),           // east wall
  wall(33, 26, W, 4),           // west wall (partial — doorway north)

  // ── mid connector wall ──
  wall(0, 18, 8, W),            // horizontal wall between bases and mid

  // ── climbable crate stacks (left side) ──
  cover(-20, 28, 3, 3),
  coverAt(-20, COVER_H, 25, 2.5, 2.5),
  coverAt(-20, COVER_H * 2, 22.5, 2, 2),

  // ── climbable crate stacks (right side) ──
  cover(20, 28, 3, 3),
  coverAt(20, COVER_H, 25, 2.5, 2.5),
  coverAt(20, COVER_H * 2, 22.5, 2, 2),

  // ── scattered cover in red base ──
  cover(-10, 25, 2, 1.5),
  cover(10, 25, 2, 1.5),
  cover(0, 30, 3, 1.2),
  cover(-30, 20, 1.5, 2),
  cover(30, 20, 1.5, 2),

  // ══════════════════════════════════════════════════════════
  // MID-FIELD AREA (between bases and warehouse)
  // ══════════════════════════════════════════════════════════

  // ── mid-field walls (tactical dividers) ──
  wall(-25, -12, 6, W),         // NW mid
  wall(25, -12, 6, W),          // NE mid
  wall(-25, 12, 6, W),          // SW mid
  wall(25, 12, 6, W),           // SE mid

  // ── mid-field cover ──
  cover(-18, -12, 2, 2),
  cover(18, -12, 2, 2),
  cover(-18, 12, 2, 2),
  cover(18, 12, 2, 2),
  cover(-35, 0, 2, 3),          // far west mid
  cover(35, 0, 2, 3),           // far east mid

  // ── flanking corridor walls ──
  wall(-40, -12, W, 6),         // west corridor blue side
  wall(40, -12, W, 6),          // east corridor blue side
  wall(-40, 12, W, 6),          // west corridor red side
  wall(40, 12, W, 6),           // east corridor red side
];

// ── TDM walkable surfaces ──────────────────────────────────
const TDM_WALKABLE_SURFACES: readonly WalkableSurface[] = [
  // main ground floor
  {
    kind: 'slab',
    minX: -50,
    maxX: 50,
    minZ: -35,
    maxZ: 35,
    y: 0,
    material: 'yard',
  },
  // warehouse catwalk (elevated platform running E-W through center)
  {
    kind: 'slab',
    minX: -9,
    maxX: 9,
    minZ: -2,
    maxZ: 2,
    y: CATWALK_Y,
    material: 'upper',
  },
  // west ramp (ground to catwalk)
  {
    kind: 'ramp',
    minX: -12,
    maxX: -9,
    minZ: -2,
    maxZ: 2,
    startY: 0,
    endY: CATWALK_Y,
    axis: 'x',
    material: 'stair',
  },
  // east ramp (ground to catwalk)
  {
    kind: 'ramp',
    minX: 9,
    maxX: 12,
    minZ: -2,
    maxZ: 2,
    startY: CATWALK_Y,
    endY: 0,
    axis: 'x',
    material: 'stair',
  },
];

// ── spawn points ──────────────────────────────────────────
const TDM_BLUE_SPAWNS: readonly [number, number, number][] = [
  [-10, 0.5, -28],
  [0, 0.5, -28],
  [10, 0.5, -28],
  [-15, 0.5, -25],
  [15, 0.5, -25],
];

const TDM_RED_SPAWNS: readonly [number, number, number][] = [
  [-10, 0.5, 28],
  [0, 0.5, 28],
  [10, 0.5, 28],
  [-15, 0.5, 25],
  [15, 0.5, 25],
];

// ── bot waypoints (patrol route for red team bots) ─────────
const TDM_RED_WAYPOINTS: readonly [number, number, number][] = [
  [0, 0, 28],       // red base center
  [-15, 0, 25],     // red base left
  [15, 0, 25],      // red base right
  [-20, 0, 18],     // mid-field left approach
  [20, 0, 18],      // mid-field right approach
  [-10, 0, 12],     // mid-field left
  [10, 0, 12],      // mid-field right
  [0, 0, 8],        // approaching warehouse south
  [-7, 0, 0],       // warehouse west entry
  [7, 0, 0],        // warehouse east entry
  [0, 0, 0],        // warehouse center
  [0, 0, -8],       // warehouse north exit (push into blue territory)
];

const MAP1_PLAYER_SPAWN = {
  position: [0, 0.5, -25] as [number, number, number],
  yaw: Math.PI,
  pitch: DEFAULT_PLAYER_PITCH,
};

// ── Range map ──────────────────────────────────────────────
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

// ── TDM map ────────────────────────────────────────────────
export const MAP1_PRACTICE_MAP: PracticeMapDefinition = {
  id: 'map1',
  label: 'TDM',
  description: 'Team Deathmatch arena with warehouse, team bases, and AI bots.',
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
  playerSpawns: TDM_BLUE_SPAWNS,
  botSpawns: TDM_RED_SPAWNS,
  botWaypoints: TDM_RED_WAYPOINTS,
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
