import * as THREE from 'three';
import type { CollisionRect, WorldBounds } from '../types';
import type { WeaponKind } from '../Weapon';

export const WORLD_BOUNDS: WorldBounds = {
  minX: -80,
  maxX: 80,
  minZ: -80,
  maxZ: 80,
};
export const WALKABLE_CENTER_X = (WORLD_BOUNDS.minX + WORLD_BOUNDS.maxX) / 2;
export const WALKABLE_CENTER_Z = (WORLD_BOUNDS.minZ + WORLD_BOUNDS.maxZ) / 2;
export const WALKABLE_SIZE_X = WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX;
export const WALKABLE_SIZE_Z = WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ;
export const SHORE_SHELF_PADDING = 0;
export const SHORE_SHELF_Y = -0.42;
export const SHORE_FOAM_RING_PADDING = 0;
export const OCEAN_LEVEL_Y = -4;
export const OCEAN_SIZE = 1600;
export const CLIFF_HEIGHT = 18;
export const CLIFF_THICKNESS = 6;

export const BUILDING_CENTER = new THREE.Vector3(8, 0, -4);
export const BUILDING_WIDTH = 10;
export const BUILDING_DEPTH = 8;
export const BUILDING_HEIGHT = 3.2;
export const WALL_THICKNESS = 0.35;
export const DOOR_GAP_WIDTH = 2.2;
export const DOOR_HEIGHT = 2.2;

export const TRACER_DISTANCE = 260;
export const TRACER_CAMERA_START_OFFSET = 0.32;
export const TRACER_MUZZLE_FORWARD_OFFSET = 0.09;
export const MIN_TRACER_DISTANCE = 10;
export const TARGET_FLASH_MS = 180;

export const MAX_BULLET_IMPACT_MARKS = 160;
export const BULLET_IMPACT_LIFETIME_MS = 5000;
export const BULLET_IMPACT_CLEANUP_INTERVAL_MS = 250;
export const BULLET_IMPACT_MARK_RADIUS = 0.05;
export const BULLET_IMPACT_MARK_SURFACE_OFFSET = 0.01;

export const MAX_BLOOD_SPLAT_MARKS = 400;
export const BLOOD_SPLAT_LIFETIME_MS = 650;
export const BLOOD_SPLAT_SURFACE_OFFSET = 0.014;
export const BULLET_HIT_EPSILON = 0.0001;

export const STATIC_COLLIDERS: CollisionRect[] = [
  { minX: -62, maxX: -58, minZ: -42, maxZ: -38 },
  { minX: 53, maxX: 57, minZ: 38, maxZ: 42 },
];
export const CANVAS_CAMERA = {
  fov: 45,
  near: 0.1,
  far: 650,
  position: [0, 3.5, 12] as [number, number, number],
};
export const CANVAS_GL = {
  antialias: true,
  powerPreference: 'high-performance' as const,
};
export const PLAYER_SPAWN_POSITION = new THREE.Vector3(0, 0, 6);
export const PLAYER_SPAWN_YAW = 0;
export const PLAYER_SPAWN_PITCH = -0.05;

export const Z_AXIS = new THREE.Vector3(0, 0, 1);

export const PATH_POINTS: [number, number][] = [
  [20, 60],
  [15, 45],
  [8, 30],
  [0, 15],
  [-5, 0],
  [-8, -15],
  [-3, -30],
  [5, -45],
  [12, -55],
  [18, -65],
];

export const CHARACTER_MODEL_URL =
  '/assets/models/character/Trooper/tactical guy.fbx';
export const CHARACTER_TARGET_HEIGHT = 1.65;
export const CHARACTER_YAW_OFFSET = Math.PI;
export const CHARACTER_TEXTURE_BASE =
  '/assets/models/character/Trooper/tactical guy.fbm/';
export const CHARACTER_TEXTURE_MAP: Record<
  string,
  { base: string; normal: string }
> = {
  Body: { base: 'Body_baseColor_0.png', normal: 'Body_normal_1.png' },
  Bottom: { base: 'Bottom_baseColor_2.png', normal: 'Bottom_normal_3.png' },
  Glove: { base: 'Glove_baseColor_4.png', normal: 'Glove_normal_5.png' },
  material: {
    base: 'material_baseColor_6.png',
    normal: 'material_normal_7.png',
  },
  Mask: { base: 'Mask_baseColor_8.png', normal: 'Mask_normal_9.png' },
  Shoes: { base: 'Shoes_baseColor_10.png', normal: 'Shoes_normal_11.png' },
  material_6: {
    base: 'material_6_baseColor_12.png',
    normal: 'material_6_normal_13.png',
  },
};

export const ANIM_CLIPS: { name: string; url: string }[] = [
  { name: 'idle', url: '/assets/animations/movement/standing/idle.fbx' },
  {
    name: 'walk',
    url: '/assets/animations/movement/standing/walk-forward.fbx',
  },
  {
    name: 'walkBack',
    url: '/assets/animations/movement/standing/walk-backward.fbx',
  },
  {
    name: 'walkLeft',
    url: '/assets/animations/movement/standing/walk-left.fbx',
  },
  {
    name: 'walkRight',
    url: '/assets/animations/movement/standing/walk-right.fbx',
  },
  {
    name: 'walkStart',
    url: '/assets/animations/movement/standing/walk-start.fbx',
  },
  {
    name: 'walkStop',
    url: '/assets/animations/movement/standing/walk-stop.fbx',
  },
  {
    name: 'sprint',
    url: '/assets/animations/movement/standing/sprint-forward.fbx',
  },
  {
    name: 'walkForwardLeft',
    url: '/assets/animations/movement/standing/walk-forward-left.fbx',
  },
  {
    name: 'walkForwardRight',
    url: '/assets/animations/movement/standing/walk-forward-right.fbx',
  },
  {
    name: 'walkBackwardLeft',
    url: '/assets/animations/movement/standing/walk-backward-left.fbx',
  },
  {
    name: 'walkBackwardRight',
    url: '/assets/animations/movement/standing/walk-backward-right.fbx',
  },
  { name: 'crouchEnter', url: '/assets/animations/movement/crouch/enter.fbx' },
  { name: 'crouchExit', url: '/assets/animations/movement/crouch/exit.fbx' },
  { name: 'crouchIdle', url: '/assets/animations/movement/crouch/idle.fbx' },
  {
    name: 'crouchForward',
    url: '/assets/animations/movement/crouch/move-forward.fbx',
  },
  {
    name: 'crouchBack',
    url: '/assets/animations/movement/crouch/move-backward.fbx',
  },
  {
    name: 'crouchLeft',
    url: '/assets/animations/movement/crouch/move-left.fbx',
  },
  {
    name: 'crouchRight',
    url: '/assets/animations/movement/crouch/move-right.fbx',
  },
  {
    name: 'rifleAimHold',
    url: '/assets/animations/rifle/aim/idle.fbx',
  },
  {
    name: 'rifleAimWalk',
    url: '/assets/animations/rifle/aim/walk-forward.fbx',
  },
  {
    name: 'rifleAimWalkBack',
    url: '/assets/animations/rifle/aim/walk-backward.fbx',
  },
  {
    name: 'rifleAimWalkLeft',
    url: '/assets/animations/rifle/aim/walk-left.fbx',
  },
  {
    name: 'rifleAimWalkRight',
    url: '/assets/animations/rifle/aim/walk-right.fbx',
  },
  {
    name: 'rifleIdle',
    url: '/assets/animations/rifle/ready/idle.fbx',
  },
  {
    name: 'rifleCrouchEnter',
    url: '/assets/animations/rifle/ready/crouch-enter.fbx',
  },
  {
    name: 'rifleCrouchExit',
    url: '/assets/animations/rifle/ready/crouch-exit.fbx',
  },
  {
    name: 'rifleCrouchIdle',
    url: '/assets/animations/rifle/ready/crouch-idle.fbx',
  },
  {
    name: 'rifleCrouchWalk',
    url: '/assets/animations/rifle/ready/crouch-forward.fbx',
  },
  {
    name: 'rifleWalk',
    url: '/assets/animations/rifle/ready/walk-forward.fbx',
  },
  {
    name: 'rifleWalkBack',
    url: '/assets/animations/rifle/ready/walk-backward.fbx',
  },
  {
    name: 'rifleWalkLeft',
    url: '/assets/animations/rifle/ready/walk-left.fbx',
  },
  {
    name: 'rifleWalkRight',
    url: '/assets/animations/rifle/ready/walk-right.fbx',
  },
  {
    name: 'rifleWalkForwardLeft',
    url: '/assets/animations/rifle/ready/walk-forward-left.fbx',
  },
  {
    name: 'rifleWalkForwardRight',
    url: '/assets/animations/rifle/ready/walk-forward-right.fbx',
  },
  {
    name: 'rifleWalkBackwardLeft',
    url: '/assets/animations/rifle/ready/walk-backward-left.fbx',
  },
  {
    name: 'rifleWalkBackwardRight',
    url: '/assets/animations/rifle/ready/walk-backward-right.fbx',
  },
  {
    name: 'rifleJog',
    url: '/assets/animations/rifle/ready/jog-forward.fbx',
  },
  {
    name: 'rifleJogBack',
    url: '/assets/animations/rifle/ready/jog-backward.fbx',
  },
  {
    name: 'rifleJogLeft',
    url: '/assets/animations/rifle/ready/jog-left.fbx',
  },
  {
    name: 'rifleJogRight',
    url: '/assets/animations/rifle/ready/jog-right.fbx',
  },
  {
    name: 'rifleJogForwardLeft',
    url: '/assets/animations/rifle/ready/jog-forward-left.fbx',
  },
  {
    name: 'rifleJogForwardRight',
    url: '/assets/animations/rifle/ready/jog-forward-right.fbx',
  },
  {
    name: 'rifleJogBackwardLeft',
    url: '/assets/animations/rifle/ready/jog-backward-left.fbx',
  },
  {
    name: 'rifleJogBackwardRight',
    url: '/assets/animations/rifle/ready/jog-backward-right.fbx',
  },
  {
    name: 'rifleRun',
    url: '/assets/animations/rifle/ready/run-forward.fbx',
  },
  {
    name: 'rifleRunStart',
    url: '/assets/animations/rifle/ready/run-start.fbx',
  },
  {
    name: 'rifleRunStop',
    url: '/assets/animations/rifle/ready/run-stop.fbx',
  },
  {
    name: 'rifleReload',
    url: '/assets/animations/rifle/reload/reload-animation.fbx',
  },
];

export const WEAPON_MODEL_URLS: Record<WeaponKind, string> = {
  rifle: '/assets/weapons/pack/FBX/AssaultRifle_01.fbx',
  sniper: '/assets/weapons/pack/FBX/SniperRifle_01.fbx',
};

export type WeaponModelTransform = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
};

export const WEAPON_MODEL_TRANSFORMS: {
  character: Record<WeaponKind, WeaponModelTransform>;
  back: Record<WeaponKind, WeaponModelTransform>;
  world: Record<WeaponKind, WeaponModelTransform>;
} = {
  character: {
    rifle: {
      position: [0.02, -0.03, 0],
      rotation: [0, -Math.PI / 2, 0],
      scale: 0.0013,
    },
    sniper: {
      position: [-0.085, -0.05, -0.006],
      rotation: [0, -Math.PI / 2, 0],
      scale: 0.0018,
    },
  },
  back: {
    rifle: {
      position: [-0.0, -0.1, -0.2],
      rotation: [-1.5, -Math.PI * -0.08, 1],
      scale: 0.0013,
    },
    sniper: {
      position: [-0.18, -0.1, -0.2],
      rotation: [-1.5, -Math.PI * -0.08, -0.18],
      scale: 0.0018,
    },
  },
  world: {
    rifle: {
      position: [0, 0.02, 0],
      rotation: [0, -Math.PI / 2, 0],
      scale: 0.0013,
    },
    sniper: {
      position: [0, 0.02, 0],
      rotation: [0, -Math.PI / 2, 0],
      scale: 0.0018,
    },
  },
};

// ── Sight / scope assets ──
export const SIGHT_FBX_URL = '/assets/weapons/sights/source/Scopes Part 1.fbx';
export const SIGHT_TEXTURE_BASE = '/assets/weapons/sights/textures/';

export const SIGHT_TEXTURE_MAP: Record<
  string,
  { base: string; metallic: string; normal?: string; roughness: string }
> = {
  rifle: {
    base: 'Sight1_Base_color.png',
    metallic: 'Sight1_Metallic.png',
    normal: 'Sight1_Normal_DirectX.png',
    roughness: 'Sight1_Roughness.png',
  },
  sniper: {
    base: 'Sight5_Base_color.png',
    metallic: 'Sight5_Metallic.png',
    normal: 'Sight5_Normal_DirectX.png',
    roughness: 'Sight5_Roughness.png',
  },
};

// Substring identifiers to find the right child meshes inside the multi-mesh FBX.
// These will be matched via child.name.includes(). If the loaded FBX uses different
// names, inspect the children via console.log and update these values.
export const SIGHT_MESH_NAMES: Record<string, string> = {
  rifle: 'Sight1',
  sniper: 'Sight5',
};

// Transform for mounting sights on top of the weapon model rail.
// The sight meshes are centered at origin after extraction.
// Position is in the weapon group's local space (same space as WEAPON_MODEL_TRANSFORMS.character).
// Scale should match the weapon model scale so FBX units are consistent.
// Rotation matches the weapon's rotation so the sight barrel-axis aligns.
export const SIGHT_MOUNT_TRANSFORMS: Record<WeaponKind, WeaponModelTransform> =
  {
    rifle: {
      position: [-0.04, 0.04, 0],
      rotation: [0, -Math.PI / 2, 0],
      scale: 0.0013,
    },
    sniper: {
      position: [-0.04, 0.04, 0],
      rotation: [0, -Math.PI / 2, 0],
      scale: 0.0018,
    },
  };

const SPRINT_ANIM_PLAYBACK_SCALE = 0.6;
const RIFLE_RUN_TRANSITION_DURATION_SCALE = 1 / SPRINT_ANIM_PLAYBACK_SCALE;

export const WALK_ANIM_TIME_SCALE = 1.18;
export const SPRINT_ANIM_TIME_SCALE = 1.9 * SPRINT_ANIM_PLAYBACK_SCALE;
export const RIFLE_HOLD_WALK_TIME_SCALE = 0.58;
export const RIFLE_HOLD_JOG_TIME_SCALE = 0.96;
export const RIFLE_HOLD_RUN_TIME_SCALE = 1.6 * SPRINT_ANIM_PLAYBACK_SCALE;
export const RIFLE_HOLD_RUN_START_TIME_SCALE = 1.2 * SPRINT_ANIM_PLAYBACK_SCALE;
export const RIFLE_HOLD_RUN_STOP_TIME_SCALE = 1.2 * SPRINT_ANIM_PLAYBACK_SCALE;
export const CROUCH_ANIM_TIME_SCALE = 1.2;
export const RIFLE_CROUCH_ANIM_TIME_SCALE = CROUCH_ANIM_TIME_SCALE;
export const BASE_FOOTSTEP_INTERVAL_SECONDS = 0.566;
export const RIFLE_HOLD_WALK_SPEED_SCALE = 0.56;
export const RIFLE_HOLD_JOG_SPEED_SCALE = 0.82;
export const RIFLE_HOLD_FIRE_PREP_SPEED_SCALE = 0.38;

// Keep rifle run transitions in sync with the slower playback rate.
export const RIFLE_RUN_START_MS = Math.round(
  220 * RIFLE_RUN_TRANSITION_DURATION_SCALE,
);
export const RIFLE_RUN_STOP_MS = Math.round(
  220 * RIFLE_RUN_TRANSITION_DURATION_SCALE,
);

export type CharacterAnimState =
  | 'idle'
  | 'walk'
  | 'walkStart'
  | 'walkStop'
  | 'walkBack'
  | 'walkLeft'
  | 'walkRight'
  | 'walkForwardLeft'
  | 'walkForwardRight'
  | 'walkBackwardLeft'
  | 'walkBackwardRight'
  | 'crouchEnter'
  | 'crouchExit'
  | 'crouchIdle'
  | 'crouchForward'
  | 'crouchBack'
  | 'crouchLeft'
  | 'crouchRight'
  | 'rifleIdle'
  | 'rifleCrouchEnter'
  | 'rifleCrouchExit'
  | 'rifleCrouchIdle'
  | 'rifleCrouchWalk'
  | 'rifleWalk'
  | 'rifleWalkBack'
  | 'rifleWalkLeft'
  | 'rifleWalkRight'
  | 'rifleWalkForwardLeft'
  | 'rifleWalkForwardRight'
  | 'rifleWalkBackwardLeft'
  | 'rifleWalkBackwardRight'
  | 'rifleAimHold'
  | 'rifleAimWalk'
  | 'rifleAimWalkBack'
  | 'rifleAimWalkLeft'
  | 'rifleAimWalkRight'
  | 'rifleJog'
  | 'rifleJogBack'
  | 'rifleJogLeft'
  | 'rifleJogRight'
  | 'rifleJogForwardLeft'
  | 'rifleJogForwardRight'
  | 'rifleJogBackwardLeft'
  | 'rifleJogBackwardRight'
  | 'rifleRun'
  | 'rifleRunStart'
  | 'rifleRunStop'
  | 'rifleReload'
  | 'sprint';

export type BulletImpactMark = {
  id: number;
  expiresAt: number;
  position: [number, number, number];
  quaternion: [number, number, number, number];
};

export type BloodSplatMark = {
  id: number;
  expiresAt: number;
  createdAt: number;
  position: [number, number, number];
  velocity: [number, number, number];
  quaternion: [number, number, number, number];
  radius: number;
  opacity: number;
};

export type WorldRaycastHit = {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
};
