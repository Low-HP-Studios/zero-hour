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
export const SHORE_SHELF_PADDING = 28;
export const SHORE_SHELF_Y = -0.42;
export const SHORE_FOAM_RING_PADDING = 10;
export const OCEAN_LEVEL_Y = -2.7;
export const OCEAN_SIZE = 1600;
export const CLIFF_HEIGHT = 0.7;
export const CLIFF_THICKNESS = 1.15;

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

export const MAX_BLOOD_SPLAT_MARKS = 280;
export const BLOOD_SPLAT_LIFETIME_MS = 1100;
export const BLOOD_SPLAT_SURFACE_OFFSET = 0.014;
export const BULLET_HIT_EPSILON = 0.0001;

export const STATIC_COLLIDERS: CollisionRect[] = [];
export const CANVAS_CAMERA = { fov: 65, near: 0.1, far: 650, position: [0, 3.5, 12] as [number, number, number] };
export const CANVAS_GL = { antialias: true, powerPreference: "high-performance" as const };
export const PLAYER_SPAWN_POSITION = new THREE.Vector3(0, 0, 6);
export const PLAYER_SPAWN_YAW = 0;
export const PLAYER_SPAWN_PITCH = 0;

export const Z_AXIS = new THREE.Vector3(0, 0, 1);

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
  { name: "walk", url: "/assets/animations/walking/Walk Forward.fbx" },
  { name: "walkBack", url: "/assets/animations/walking/Walk Backward.fbx" },
  { name: "walkLeft", url: "/assets/animations/walking/Walk Left.fbx" },
  { name: "walkRight", url: "/assets/animations/walking/Walk Right.fbx" },
  { name: "rifleIdle", url: "/assets/animations/walking with gun/Rifle Aim Idle.fbx" },
  { name: "rifleWalk", url: "/assets/animations/walking with gun/Rifle Aim Walk Forward Loop.fbx" },
  { name: "rifleWalkBack", url: "/assets/animations/walking with gun/Rifle Aim Walk Backward Loop.fbx" },
  { name: "rifleWalkLeft", url: "/assets/animations/walking with gun/Rifle Aim Walk Left Loop.fbx" },
  { name: "rifleWalkRight", url: "/assets/animations/walking with gun/Rifle Aim Walk Right Loop.fbx" },
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
export const BASE_FOOTSTEP_INTERVAL_SECONDS = 0.566;

export type CharacterAnimState =
  | "idle"
  | "walk"
  | "walkBack"
  | "walkLeft"
  | "walkRight"
  | "rifleIdle"
  | "rifleWalk"
  | "rifleWalkBack"
  | "rifleWalkLeft"
  | "rifleWalkRight"
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
  position: [number, number, number];
  quaternion: [number, number, number, number];
  radius: number;
  opacity: number;
};

export type WorldRaycastHit = {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
};
