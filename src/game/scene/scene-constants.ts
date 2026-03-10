import * as THREE from "three";
import type { CollisionRect, WorldBounds } from "../types";
import type { WeaponKind } from "../Weapon";

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
export const CANVAS_CAMERA = { fov: 45, near: 0.1, far: 650, position: [0, 3.5, 12] as [number, number, number] };
export const CANVAS_GL = { antialias: true, powerPreference: "high-performance" as const };
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

export const CHARACTER_MODEL_URL = "/assets/models/character/Trooper/tactical guy.fbx";
export const CHARACTER_TARGET_HEIGHT = 1.65;
export const CHARACTER_YAW_OFFSET = Math.PI;
export const CHARACTER_TEXTURE_BASE = "/assets/models/character/Trooper/tactical guy.fbm/";
export const CHARACTER_TEXTURE_MAP: Record<string, { base: string; normal: string }> = {
  Body: { base: "Body_baseColor_0.png", normal: "Body_normal_1.png" },
  Bottom: { base: "Bottom_baseColor_2.png", normal: "Bottom_normal_3.png" },
  Glove: { base: "Glove_baseColor_4.png", normal: "Glove_normal_5.png" },
  material: { base: "material_baseColor_6.png", normal: "material_normal_7.png" },
  Mask: { base: "Mask_baseColor_8.png", normal: "Mask_normal_9.png" },
  Shoes: { base: "Shoes_baseColor_10.png", normal: "Shoes_normal_11.png" },
  material_6: { base: "material_6_baseColor_12.png", normal: "material_6_normal_13.png" },
};

export const ANIM_CLIPS: { name: string; url: string }[] = [
  { name: "idle", url: "/assets/animations/walking/Idle.fbx" },
  { name: "walk", url: "/assets/animations/walk/Walk Forward Animation.fbx" },
  { name: "walkBack", url: "/assets/animations/walk/Walk Backward Animation.fbx" },
  { name: "walkLeft", url: "/assets/animations/walk/Walk Left Animation.fbx" },
  { name: "walkRight", url: "/assets/animations/walk/Walk Right Animation.fbx" },
  { name: "walkStart", url: "/assets/animations/walk/Walk Start.fbx" },
  { name: "walkStop", url: "/assets/animations/walk/Walk Stop.fbx" },
  {
    name: "walkForwardLeft",
    url: "/assets/animations/walk/Walk Forward Left Animation.fbx",
  },
  {
    name: "walkForwardRight",
    url: "/assets/animations/walk/Walk Forward Right Animation.fbx",
  },
  {
    name: "walkBackwardLeft",
    url: "/assets/animations/walk/Walk Backward Left.fbx",
  },
  {
    name: "walkBackwardRight",
    url: "/assets/animations/walk/Walk Backward Right.fbx",
  },
  { name: "crouchEnter", url: "/assets/animations/crouch/Stand To Crouch.fbx" },
  { name: "crouchExit", url: "/assets/animations/crouch/Crouch To Stand.fbx" },
  { name: "crouchIdle", url: "/assets/animations/crouch/Crouch Idle.fbx" },
  {
    name: "crouchForward",
    url: "/assets/animations/crouch/Crouch Move Forward Stealth.fbx",
  },
  {
    name: "crouchBack",
    url: "/assets/animations/crouch/Crouch Move Backward Stealth.fbx",
  },
  {
    name: "crouchLeft",
    url: "/assets/animations/crouch/Crouch Move Left Stealth.fbx",
  },
  {
    name: "crouchRight",
    url: "/assets/animations/crouch/Crouch Move Right Stealth.fbx",
  },
  { name: "rifleAimHold", url: "/assets/animations/walking with gun/Rifle Aim Idle.fbx" },
  { name: "rifleIdle", url: "/assets/animations/rifle-hold/Rifle Hold Idle Animation.fbx" },
  {
    name: "rifleCrouchEnter",
    url: "/assets/animations/crouch/Rifle Hold To Crouch.fbx",
  },
  {
    name: "rifleCrouchExit",
    url: "/assets/animations/crouch/Rifle Crouch To Stand Hold.fbx",
  },
  { name: "rifleCrouchIdle", url: "/assets/animations/crouch/Rifle Crouch Idle.fbx" },
  {
    name: "rifleCrouchWalk",
    url: "/assets/animations/crouch/Rifle Crouch Walk Forward Loop.fbx",
  },
  { name: "rifleWalk", url: "/assets/animations/rifle-hold/Rifle Hold Walk Forward Loop.fbx" },
  { name: "rifleWalkBack", url: "/assets/animations/rifle-hold/Rifle Hold Walk Backward Loop.fbx" },
  { name: "rifleWalkLeft", url: "/assets/animations/rifle-hold/Rifle Hold Walk Left Loop.fbx" },
  { name: "rifleWalkRight", url: "/assets/animations/rifle-hold/Rifle Hold Walk Right Loop.fbx" },
  {
    name: "rifleWalkForwardLeft",
    url: "/assets/animations/rifle-hold/Rifle Hold Walk Forward Left Loop.fbx",
  },
  {
    name: "rifleWalkForwardRight",
    url: "/assets/animations/rifle-hold/Rifle Hold Walk Forward Right Loop.fbx",
  },
  {
    name: "rifleWalkBackwardLeft",
    url: "/assets/animations/rifle-hold/Rifle Hold Walk Backward Left Loop.fbx",
  },
  {
    name: "rifleWalkBackwardRight",
    url: "/assets/animations/rifle-hold/Rifle Hold Walk Backward Right Loop.fbx",
  },
  {
    name: "rifleJog",
    url: "/assets/animations/rifle-hold-jog/Rifle Hold Jog Forward Loop.fbx",
  },
  {
    name: "rifleJogBack",
    url: "/assets/animations/rifle-hold-jog/Rifle Hold Jog Backward Loop.fbx",
  },
  {
    name: "rifleJogLeft",
    url: "/assets/animations/rifle-hold-jog/Rifle Hold Jog Left Loop.fbx",
  },
  {
    name: "rifleJogRight",
    url: "/assets/animations/rifle-hold-jog/Rifle Hold Jog Right Loop.fbx",
  },
  {
    name: "rifleJogForwardLeft",
    url: "/assets/animations/rifle-hold-jog/Rifle Hold Jog Forward Left Loop.fbx",
  },
  {
    name: "rifleJogForwardRight",
    url: "/assets/animations/rifle-hold-jog/Rifle Hold Jog Forward Right Loop.fbx",
  },
  {
    name: "rifleJogBackwardLeft",
    url: "/assets/animations/rifle-hold-jog/Rifle Hold Jog Backward Left Loop.fbx",
  },
  {
    name: "rifleJogBackwardRight",
    url: "/assets/animations/rifle-hold-jog/Rifle Hold Jog Backward Right Loop.fbx",
  },
  {
    name: "rifleRun",
    url: "/assets/animations/rifle-hold-run/Rifle Hold Run Loop.fbx",
  },
  {
    name: "rifleRunStart",
    url: "/assets/animations/rifle-hold-run/Rifle Hold Run Start Animation.fbx",
  },
  {
    name: "rifleRunStop",
    url: "/assets/animations/rifle-hold-run/Rifle Hold Run Stop Animation.fbx",
  },
];

export const WEAPON_MODEL_URLS: Record<WeaponKind, string> = {
  rifle: "/assets/weapons/pack/FBX/AssaultRifle_01.fbx",
  sniper: "/assets/weapons/pack/FBX/SniperRifle_01.fbx",
};

export type WeaponModelTransform = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
};

export const WEAPON_MODEL_TRANSFORMS: {
  character: Record<WeaponKind, WeaponModelTransform>;
  world: Record<WeaponKind, WeaponModelTransform>;
} = {
  character: {
    rifle: {
      position: [0.02, -0.03, 0],
      rotation: [0, -Math.PI / 2, 0],
      scale: 0.00145,
    },
    sniper: {
      position: [0.02, -0.04, 0],
      rotation: [0, -Math.PI / 2, 0],
      scale: 0.0016,
    },
  },
  world: {
    rifle: {
      position: [0, 0.02, 0],
      rotation: [0, -Math.PI / 2, 0],
      scale: 0.00145,
    },
    sniper: {
      position: [0, 0.02, 0],
      rotation: [0, -Math.PI / 2, 0],
      scale: 0.0016,
    },
  },
};

export const WALK_ANIM_TIME_SCALE = 1.18;
export const SPRINT_ANIM_TIME_SCALE = 1.9;
export const RIFLE_HOLD_WALK_TIME_SCALE = 0.58;
export const RIFLE_HOLD_JOG_TIME_SCALE = 0.96;
export const RIFLE_HOLD_RUN_TIME_SCALE = 1.6;
export const RIFLE_HOLD_RUN_START_TIME_SCALE = 1.2;
export const RIFLE_HOLD_RUN_STOP_TIME_SCALE = 1.2;
export const CROUCH_ANIM_TIME_SCALE = 0.92;
export const RIFLE_CROUCH_ANIM_TIME_SCALE = 0.8;
export const BASE_FOOTSTEP_INTERVAL_SECONDS = 0.566;
export const RIFLE_HOLD_WALK_SPEED_SCALE = 0.56;
export const RIFLE_HOLD_JOG_SPEED_SCALE = 0.82;
export const RIFLE_HOLD_RUN_SPEED_SCALE = 1.42;
export const RIFLE_HOLD_FIRE_PREP_SPEED_SCALE = 0.38;

export const RIFLE_RUN_STAMINA_MAX_MS = 2600;
export const RIFLE_RUN_STAMINA_DRAIN_PER_SEC = 1;
export const RIFLE_RUN_STAMINA_REGEN_PER_SEC = 0.55;
export const RIFLE_RUN_START_MS = 220;
export const RIFLE_RUN_STOP_MS = 220;

export type CharacterAnimState =
  | "idle"
  | "walk"
  | "walkStart"
  | "walkStop"
  | "walkBack"
  | "walkLeft"
  | "walkRight"
  | "walkForwardLeft"
  | "walkForwardRight"
  | "walkBackwardLeft"
  | "walkBackwardRight"
  | "crouchEnter"
  | "crouchExit"
  | "crouchIdle"
  | "crouchForward"
  | "crouchBack"
  | "crouchLeft"
  | "crouchRight"
  | "rifleIdle"
  | "rifleCrouchEnter"
  | "rifleCrouchExit"
  | "rifleCrouchIdle"
  | "rifleCrouchWalk"
  | "rifleWalk"
  | "rifleWalkBack"
  | "rifleWalkLeft"
  | "rifleWalkRight"
  | "rifleWalkForwardLeft"
  | "rifleWalkForwardRight"
  | "rifleWalkBackwardLeft"
  | "rifleWalkBackwardRight"
  | "rifleAimHold"
  | "rifleJog"
  | "rifleJogBack"
  | "rifleJogLeft"
  | "rifleJogRight"
  | "rifleJogForwardLeft"
  | "rifleJogForwardRight"
  | "rifleJogBackwardLeft"
  | "rifleJogBackwardRight"
  | "rifleRun"
  | "rifleRunStart"
  | "rifleRunStop"
  | "sprint";

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
