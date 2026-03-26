import {
  forwardRef,
  type MutableRefObject,
  startTransition,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { type AudioVolumeSettings, sharedAudioManager } from "../Audio";
import {
  type PlayerControllerApi,
  type RunFacingPhase,
  usePlayerController,
} from "../PlayerController";
import {
  raycastVisibleTargets,
  targetDummyGroupScale,
  type TargetRaycastHit,
  type TargetVisualHandle,
} from "../Targets";
import {
  type SniperRechamberState,
  type WeaponKind,
  type WeaponShotEvent,
  type WeaponSlotId,
  type WeaponSwitchState,
  WeaponSystem,
} from "../Weapon";
import { type GroundAmmoVisualState, InventorySystem } from "../inventory";
import type {
  GameSettings,
  InventoryMoveLocation,
  InventoryMoveRequest,
  InventoryMoveResult,
  MovementProfileSettings,
  PerfMetrics,
  PlayerSnapshot,
  ScenePresentation,
  TargetState,
  WeaponAlignmentOffset,
  WeaponRecoilProfiles,
} from "../types";
import {
  isSprintInputEligible,
  PHASE1_MOVEMENT_CONFIG,
  resolveLocalPlanarVector,
} from "../movement";
import {
  type CharacterFootstepSample,
  isEmbeddedGlbCharacterOverride,
  isSingleWeaponCharacterOverride,
  type CharacterModelOverride,
  normalizeBoneName,
  resolveFootstepPlaybackRate,
  useCharacterModel,
} from "./CharacterModel";
import { BloodImpactMarks, BulletImpactMarks } from "./ImpactMarks";
import {
  computeWeaponMuzzleOffset,
  useSightModels,
  useWeaponModels,
  WeaponModelInstance,
} from "./WeaponModels";
import {
  BLOOD_SPLAT_LIFETIME_MS,
  type BloodSplatMark,
  BULLET_HIT_EPSILON,
  BULLET_IMPACT_CLEANUP_INTERVAL_MS,
  BULLET_IMPACT_LIFETIME_MS,
  BULLET_IMPACT_MARK_SURFACE_OFFSET,
  type BulletImpactMark,
  CHARACTER_YAW_OFFSET,
  type CharacterAnimState,
  MAX_BLOOD_SPLAT_MARKS,
  MAX_BULLET_IMPACT_MARKS,
  MIN_TRACER_DISTANCE,
  RIFLE_RUN_START_MS,
  RIFLE_RUN_STOP_MS,
  SIGHT_MOUNT_TRANSFORMS,
  TRACER_CAMERA_START_OFFSET,
  TRACER_DISTANCE,
  TRACER_MUZZLE_FORWARD_OFFSET,
  WEAPON_MODEL_TRANSFORMS,
  type WorldRaycastHit,
  Z_AXIS,
} from "./scene-constants";
import type { PracticeMapDefinition } from "./practice-maps";
import type { StaticGroundSpawn } from "../inventory/inventory-data";

export type HitMarkerKind = "body" | "head" | "kill";
export type AimingState = {
  ads: boolean;
  firstPerson: boolean;
};

export type ShotFiredState = {
  weaponType: WeaponKind;
  shotCount: number;
  nowMs: number;
};

export type GameplayRuntimeHandle = {
  requestPointerLock: () => void;
  releasePointerLock: () => void;
  dropWeaponForReturn: () => void;
  moveInventoryItem: (request: InventoryMoveRequest) => InventoryMoveResult;
  quickMoveInventoryItem: (
    location: InventoryMoveLocation,
  ) => InventoryMoveResult;
  resetForMenu: () => void;
};

type GameplayRuntimeProps = {
  practiceMap: PracticeMapDefinition;
  audioVolumes: AudioVolumeSettings;
  presentation: ScenePresentation;
  gameplayInputEnabled: boolean;
  sensitivity: GameSettings["sensitivity"];
  controllerSettings: GameSettings["controller"];
  keybinds: GameSettings["keybinds"];
  crouchMode: GameSettings["crouchMode"];
  inventoryOpenMode: GameSettings["inventoryOpenMode"];
  fov: number;
  weaponAlignment: WeaponAlignmentOffset;
  movement: MovementProfileSettings;
  weaponRecoilProfiles: WeaponRecoilProfiles;
  targets: TargetState[];
  targetVisualRegistryRef: MutableRefObject<Map<string, TargetVisualHandle>>;
  onTargetHit: (targetId: string, damage: number, nowMs: number) => void;
  onResetTargets: () => void;
  onPlayerSnapshot: (snapshot: PlayerSnapshot) => void;
  onPerfMetrics: (metrics: PerfMetrics) => void;
  onHitMarker: (kind: HitMarkerKind, damage: number, targetId: string) => void;
  onShotFired: (state: ShotFiredState) => void;
  onWeaponEquippedChange: (equipped: boolean) => void;
  onActiveWeaponChange: (weapon: WeaponKind) => void;
  onSniperRechamberChange: (state: SniperRechamberState) => void;
  onAimingStateChange: (state: AimingState) => void;
  deferredAssetsEnabled?: boolean;
  onCriticalAssetsReadyChange?: (ready: boolean) => void;
  characterOverride?: CharacterModelOverride;
  onPauseMenuToggle?: () => void;
};

const MENU_LOOK_HEIGHT = 1.12;
const MENU_FRONT_DISTANCE = 1.95;
const MENU_FRONT_HEIGHT = 1.22;
const MENU_SIDE_DRIFT = 0.08;
const MENU_VERTICAL_DRIFT = 0.025;
const MENU_LOOK_DRIFT = 0.05;
const MENU_SHOULDER_OFFSET = 0.54;
const MENU_LOOK_SHOULDER_OFFSET = 0.16;
const MENU_FOV = 31;
// Aligned with PlayerController: CAMERA_ARM_LENGTH=2.25, CAMERA_DEFAULT_ELEVATION=0.35
// horizontalDist = 2.25 * cos(0.35) ≈ 2.11, verticalDist = 2.25 * sin(0.35) ≈ 0.77
// camera.y = LOOK_AT_HEIGHT(1.2) + verticalDist(0.77) ≈ 1.97
const TRANSITION_BACK_DISTANCE = 2.11;
const TRANSITION_BACK_HEIGHT = 1.97;
const TRANSITION_SHOULDER = 0.5;
const TRANSITION_LOOK_DISTANCE = 14;
const HEAD_YAW_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const HEAD_YAW_QUAT = new THREE.Quaternion();
const HEAD_PITCH_QUAT = new THREE.Quaternion();
const UPPER_TORSO_LEAN_QUAT = new THREE.Quaternion();
const UPPER_TORSO_PITCH_QUAT = new THREE.Quaternion();
const UPPER_TORSO_LEAN_ANGLE = THREE.MathUtils.degToRad(18);
const LOWER_TORSO_LEAN_ANGLE = THREE.MathUtils.degToRad(10);
const LOWER_TORSO_LEAN_QUAT = new THREE.Quaternion();
const CROUCH_AIM_HEAD_LIFT_ANGLE = THREE.MathUtils.degToRad(12);
const CROUCH_AIM_UPPER_TORSO_LIFT_ANGLE = THREE.MathUtils.degToRad(16);

// Aim follow: distribute camera pitch/yaw across spine and head for natural look
const AIM_PITCH_TORSO_FRACTION = 0.55;
const AIM_PITCH_HEAD_FRACTION = 0.35;
const AIM_YAW_TORSO_FRACTION = 0.6;
const RIFLE_READY_PITCH_TORSO_FRACTION = 0.82;
const AIM_PITCH_TORSO_QUAT = new THREE.Quaternion();
const AIM_PITCH_HEAD_QUAT = new THREE.Quaternion();
const AIM_YAW_TORSO_QUAT = new THREE.Quaternion();
const RIFLE_READY_YAW_OFFSET = THREE.MathUtils.degToRad(-3.5);
const RIFLE_READY_YAW_QUAT = new THREE.Quaternion();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const PRACTICE_AMMO_RESPAWN_MS = 5_000;
const PRACTICE_AMMO_RIFLE_REFILL = 240;
const PRACTICE_AMMO_SNIPER_REFILL = 120;

// ADS weapon positioning: camera-local offsets so the sight aligns with screen center.
// x = right, y = up, z = forward (in camera space). Will be tuned iteratively.
const RIFLE_ADS_CAMERA_OFFSET = { x: 0, y: -0.05, z: 0.264 };
const SNIPER_ADS_CAMERA_OFFSET = { x: 0.007, y: 0.016, z: 0.105 };

// The weapon model's base rotation to align its barrel with camera forward.
// The weapon FBX barrel points along +X in model space, so rotating +PI/2 around Y
// maps it to -Z (camera forward direction).
const WEAPON_ADS_BASE_EULER = new THREE.Euler(0, Math.PI / 2, 0);

// Pre-allocated temp objects for ADS weapon blend (avoid per-frame allocation)
const _tempHipPos = new THREE.Vector3();
const _tempHipQuat = new THREE.Quaternion();
const _tempAdsPos = new THREE.Vector3();
const _tempAdsQuat = new THREE.Quaternion();
const _tempCameraRight = new THREE.Vector3();
const _tempCameraUp = new THREE.Vector3();
const _tempCameraForward = new THREE.Vector3();
const _tempWeaponGroup = new THREE.Group();
const _tempAlignQuat = new THREE.Quaternion();

function resolveShotDamage(
  shot: WeaponShotEvent,
  targetHit: TargetRaycastHit,
): number {
  if (shot.weaponType === "sniper") {
    if (targetHit.zone === "head") {
      return 200;
    }
    if (targetHit.zone === "leg") {
      return 70;
    }
    return shot.damage;
  }

  if (targetHit.zone === "head") {
    const oneShotRange = 16;
    const falloffEndRange = 58;
    const t = clamp01(
      (targetHit.distance - oneShotRange) / (falloffEndRange - oneShotRange),
    );
    const headDamage = THREE.MathUtils.lerp(125, 62, t);
    return Math.round(headDamage);
  }

  if (targetHit.zone === "leg") {
    return Math.max(1, Math.round(shot.damage * 0.84));
  }

  return shot.damage;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function resolveStateDurationSeconds(progress: number, remainingMs: number) {
  const remainingFraction = Math.max(0.001, 1 - clamp01(progress));
  return Math.max(0.1, remainingMs / 1000 / remainingFraction);
}

function resolveCrouchTransitionTargetPose(
  state: Exclude<CrouchTransitionState, "idle">,
): number {
  return state === "enter" ? 1 : 0;
}

type RifleRunVisualState = "idle" | "start" | "running" | "stop";
type UnarmedWalkVisualState = "idle" | "start" | "moving" | "stop";
type CrouchTransitionState = "idle" | "enter" | "exit";
type CharacterVisibilityCategory = "glove" | "shoe" | "hidden";
type CharacterVisibilityMaterialEntry = {
  material: THREE.Material;
  category: CharacterVisibilityCategory;
  baseOpacity: number;
  baseTransparent: boolean;
};

type SlideIntentHookState = {
  eligible: boolean;
  lastIntentAtMs: number;
  lastIntentSpeed: number;
  lastIntentYaw: number;
  lastIntentMoveX: number;
  lastIntentMoveY: number;
};

const RIFLE_HOLD_DIAGONAL_THRESHOLD = 0.35;
const WALK_DIAGONAL_THRESHOLD = 0.35;
const LOCOMOTION_VISUAL_INPUT_DAMP =
  PHASE1_MOVEMENT_CONFIG.locomotionVisualInputDamp;
const LOCOMOTION_VISUAL_LATERAL_SWITCH_THRESHOLD = 0.42;
const LOCOMOTION_VISUAL_NEUTRAL_THRESHOLD = 0.18;
const UNARMED_WALK_START_MS = 220;
const UNARMED_WALK_STOP_MS = 220;
const CROUCH_TRANSITION_SPEED_MULTIPLIER = 1.2;
const CROUCH_ENTER_TRANSITION_MS = 200;
const CROUCH_ENTER_BLEND_SECONDS = 0.08;
const CROUCH_TRANSITION_MS = Math.round(
  260 / CROUCH_TRANSITION_SPEED_MULTIPLIER,
);
const CROUCH_SPRINT_RELEASE_POSE = 0.35;
const RIFLE_RUN_INPUT_GRACE_MS = 120;
const DIRECTION_CHANGE_THRESHOLD_RAD = Math.PI / 2;
const DIRECTION_CHANGE_PAUSE_MS = 180;
const DIRECTION_CHANGE_DAMP_RATE = 18;
const DIRECTION_CHANGE_MIN_INPUT_LENGTH = 0.3;
const SPRINT_STOP_RECOVERY_MS = 80;
const RIFLE_LOCOMOTION_SCALE_MIN = PHASE1_MOVEMENT_CONFIG.locomotionScaleMin;
const RIFLE_LOCOMOTION_SCALE_MAX = PHASE1_MOVEMENT_CONFIG.locomotionScaleMax;
const INVENTORY_DROP_ZONE_NEARBY = "__drop_to_ground__";
// Keep these in sync with PlayerController movement constants.
const PLAYER_WALK_SPEED = 5.3;
const PLAYER_SPRINT_SPEED = 8.2;
const UNARMED_WALK_SPEED_SCALE = 0.68;

type FootstepPhaseTracker = {
  cycle: number;
  lastNormalizedTime: number;
  state: CharacterAnimState | null;
};

type FootstepTrigger = {
  kind: "step";
  foot: "left" | "right";
} | {
  kind: "reset";
};

type VisualLocomotionUpdateOptions = {
  pauseActive?: boolean;
  pauseDampRate?: number;
  skipSnapFromZero?: boolean;
};

function getFootstepMarkers(state: CharacterAnimState): readonly number[] {
  if (
    state === "sprint" ||
    state === "rifleRun" ||
    state === "rifleRunStart" ||
    state === "rifleRunStop"
  ) {
    return [0.12, 0.62];
  }
  if (
    state === "crouchForward" ||
    state === "crouchBack" ||
    state === "crouchLeft" ||
    state === "crouchRight" ||
    state === "rifleCrouchWalk"
  ) {
    return [0.18, 0.68];
  }
  return [0.14, 0.64];
}

function consumeFootstepTrigger(
  tracker: FootstepPhaseTracker,
  sample: CharacterFootstepSample | null,
): FootstepTrigger | null {
  if (!sample) {
    const shouldReset = tracker.state !== null ||
      tracker.cycle !== 0 ||
      tracker.lastNormalizedTime !== 0;
    tracker.state = null;
    tracker.cycle = 0;
    tracker.lastNormalizedTime = 0;
    return shouldReset ? { kind: "reset" } : null;
  }

  const normalizedTime = THREE.MathUtils.clamp(
    sample.normalizedTime,
    0,
    0.9999,
  );
  if (tracker.state !== sample.state) {
    tracker.state = sample.state;
    tracker.cycle = 0;
    tracker.lastNormalizedTime = normalizedTime;
    return null;
  }

  let cycle = tracker.cycle;
  if (normalizedTime + 0.001 < tracker.lastNormalizedTime) {
    cycle += 1;
  }

  const previousAbsolute = tracker.cycle + tracker.lastNormalizedTime;
  const currentAbsolute = cycle + normalizedTime;
  tracker.cycle = cycle;
  tracker.lastNormalizedTime = normalizedTime;

  for (const [markerIndex, marker] of getFootstepMarkers(sample.state).entries()) {
    if (
      previousAbsolute < cycle + marker &&
      currentAbsolute >= cycle + marker
    ) {
      return {
        kind: "step",
        foot: markerIndex === 0 ? "left" : "right",
      };
    }
  }

  return null;
}

function createSometimesStepWindow() {
  return 4 + Math.floor(Math.random() * 5);
}

function filterPracticeGroundSpawns(
  groundSpawns: readonly StaticGroundSpawn[],
  rawCharacterSandboxMode: boolean,
  singleWeaponMode: boolean,
): StaticGroundSpawn[] {
  if (rawCharacterSandboxMode) {
    return [];
  }

  if (!singleWeaponMode) {
    return [...groundSpawns];
  }

  return groundSpawns.filter((spawn) =>
    spawn.itemId !== "weapon_rifle" &&
    spawn.itemId !== "weapon_sniper" &&
    spawn.itemId !== "ammo_sniper"
  );
}

function resolveRifleWalkState(
  moveX: number,
  moveY: number,
): CharacterAnimState {
  const absX = Math.abs(moveX);
  const absY = Math.abs(moveY);
  const movingDiagonally = absX > RIFLE_HOLD_DIAGONAL_THRESHOLD &&
    absY > RIFLE_HOLD_DIAGONAL_THRESHOLD;
  const movingForwardDiagonally = moveY > RIFLE_HOLD_DIAGONAL_THRESHOLD &&
    absX > RIFLE_HOLD_DIAGONAL_THRESHOLD;

  if (movingForwardDiagonally) {
    return "rifleWalk";
  }

  if (movingDiagonally) {
    if (moveY >= 0) {
      return moveX >= 0 ? "rifleWalkForwardRight" : "rifleWalkForwardLeft";
    }
    return moveX >= 0 ? "rifleWalkBackwardRight" : "rifleWalkBackwardLeft";
  }

  if (absY >= absX) {
    return moveY >= 0 ? "rifleWalk" : "rifleWalkBack";
  }

  return moveX >= 0 ? "rifleWalkRight" : "rifleWalkLeft";
}

function resolveRifleAimWalkState(
  moveX: number,
  moveY: number,
): CharacterAnimState {
  const absX = Math.abs(moveX);
  const absY = Math.abs(moveY);

  if (absY >= absX) {
    return moveY >= 0 ? "rifleAimWalk" : "rifleAimWalkBack";
  }

  return moveX >= 0 ? "rifleAimWalkRight" : "rifleAimWalkLeft";
}

type ForwardDiagonalStateOption = {
  useForwardDiagonalClip?: boolean;
};

function resolveWalkState(
  moveX: number,
  moveY: number,
  options?: ForwardDiagonalStateOption,
): CharacterAnimState {
  const absX = Math.abs(moveX);
  const absY = Math.abs(moveY);
  const useForwardDiagonalClip = options?.useForwardDiagonalClip ?? true;
  const movingDiagonally = absX > WALK_DIAGONAL_THRESHOLD &&
    absY > WALK_DIAGONAL_THRESHOLD;
  const movingForwardDiagonally = moveY > WALK_DIAGONAL_THRESHOLD &&
    absX > WALK_DIAGONAL_THRESHOLD;

  if (movingForwardDiagonally && !useForwardDiagonalClip) {
    return "walk";
  }

  if (movingDiagonally) {
    if (moveY >= 0) {
      return moveX >= 0 ? "walkForwardRight" : "walkForwardLeft";
    }
    return moveX >= 0 ? "walkBackwardRight" : "walkBackwardLeft";
  }

  if (absY >= absX) {
    return moveY >= 0 ? "walk" : "walkBack";
  }

  return moveX >= 0 ? "walkRight" : "walkLeft";
}

function resolveRifleJogState(
  moveX: number,
  moveY: number,
): CharacterAnimState {
  const absX = Math.abs(moveX);
  const absY = Math.abs(moveY);
  const movingDiagonally = absX > RIFLE_HOLD_DIAGONAL_THRESHOLD &&
    absY > RIFLE_HOLD_DIAGONAL_THRESHOLD;
  const movingForwardDiagonally = moveY > RIFLE_HOLD_DIAGONAL_THRESHOLD &&
    absX > RIFLE_HOLD_DIAGONAL_THRESHOLD;

  if (movingForwardDiagonally) {
    return "rifleJog";
  }

  if (movingDiagonally) {
    if (moveY >= 0) {
      return moveX >= 0 ? "rifleJogForwardRight" : "rifleJogForwardLeft";
    }
    return moveX >= 0 ? "rifleJogBackwardRight" : "rifleJogBackwardLeft";
  }

  if (absY >= absX) {
    return moveY >= 0 ? "rifleJog" : "rifleJogBack";
  }

  return moveX >= 0 ? "rifleJogRight" : "rifleJogLeft";
}

function resolveCrouchState(moveX: number, moveY: number): CharacterAnimState {
  if (Math.abs(moveY) >= Math.abs(moveX)) {
    return moveY >= 0 ? "crouchForward" : "crouchBack";
  }
  return moveX >= 0 ? "crouchRight" : "crouchLeft";
}

function computeInputAngleDelta(
  previous: THREE.Vector2,
  next: THREE.Vector2,
): number {
  const previousLengthSq = previous.lengthSq();
  const nextLengthSq = next.lengthSq();
  if (previousLengthSq <= 0.0001 || nextLengthSq <= 0.0001) {
    return 0;
  }

  const dot = (
    previous.x * next.x + previous.y * next.y
  ) / Math.sqrt(previousLengthSq * nextLengthSq);
  return Math.acos(THREE.MathUtils.clamp(dot, -1, 1));
}

function updateVisualLocomotionInput(
  current: THREE.Vector2,
  movementActive: boolean,
  moveX: number,
  moveY: number,
  localVelocityX: number,
  localVelocityY: number,
  planarSpeed: number,
  delta: number,
  options?: VisualLocomotionUpdateOptions,
): THREE.Vector2 {
  if (!movementActive) {
    current.set(0, 0);
    return current;
  }

  const pauseActive = options?.pauseActive ?? false;
  const pauseDampRate = options?.pauseDampRate ?? LOCOMOTION_VISUAL_INPUT_DAMP;
  const skipSnapFromZero = options?.skipSnapFromZero ?? false;

  if (pauseActive) {
    current.x = THREE.MathUtils.damp(current.x, 0, pauseDampRate, delta);
    current.y = THREE.MathUtils.damp(current.y, 0, pauseDampRate, delta);
    if (current.lengthSq() <= 0.0001) {
      current.set(0, 0);
    }
    return current;
  }

  let targetX = moveX;
  let targetY = moveY;
  const localVelocityLengthSq =
    localVelocityX * localVelocityX + localVelocityY * localVelocityY;
  if (localVelocityLengthSq > 0.0001) {
    const localVelocityLength = Math.sqrt(localVelocityLengthSq);
    const velocityAuthority = THREE.MathUtils.smoothstep(
      planarSpeed,
      PHASE1_MOVEMENT_CONFIG.visualVelocityAuthorityStartSpeed,
      PHASE1_MOVEMENT_CONFIG.visualVelocityAuthorityFullSpeed,
    );
    targetX = THREE.MathUtils.lerp(
      moveX,
      localVelocityX / localVelocityLength,
      velocityAuthority,
    );
    targetY = THREE.MathUtils.lerp(
      moveY,
      localVelocityY / localVelocityLength,
      velocityAuthority,
    );
  }

  if (current.lengthSq() <= 0.0001) {
    if (skipSnapFromZero) {
      current.x = THREE.MathUtils.damp(
        0,
        targetX,
        LOCOMOTION_VISUAL_INPUT_DAMP,
        delta,
      );
      current.y = THREE.MathUtils.damp(
        0,
        targetY,
        LOCOMOTION_VISUAL_INPUT_DAMP,
        delta,
      );
    } else {
      current.set(targetX, targetY);
    }
    if (current.lengthSq() > 1) {
      current.normalize();
    }
    return current;
  }

  current.x = THREE.MathUtils.damp(
    current.x,
    targetX,
    LOCOMOTION_VISUAL_INPUT_DAMP,
    delta,
  );
  current.y = THREE.MathUtils.damp(
    current.y,
    targetY,
    LOCOMOTION_VISUAL_INPUT_DAMP,
    delta,
  );

  if (current.lengthSq() > 1) {
    current.normalize();
  }

  return current;
}

function stabilizeLateralTransition(
  nextState: CharacterAnimState,
  previousState: CharacterAnimState,
  rawMoveX: number,
  rawMoveY: number,
  visualMoveX: number,
  visualMoveY: number,
  leftState: CharacterAnimState,
  rightState: CharacterAnimState,
): CharacterAnimState {
  const previousWasLateral = previousState === leftState ||
    previousState === rightState;
  const rawPureLateral = Math.abs(rawMoveX) > 0.55 && Math.abs(rawMoveY) < 0.2;

  if (!previousWasLateral || !rawPureLateral) {
    return nextState;
  }

  const targetState = rawMoveX >= 0 ? rightState : leftState;
  if (targetState === previousState) {
    return nextState;
  }

  const visualCommittedToTarget =
    Math.abs(visualMoveX) >= LOCOMOTION_VISUAL_LATERAL_SWITCH_THRESHOLD &&
    Math.sign(visualMoveX) === Math.sign(rawMoveX);
  const visualStaysNeutral =
    Math.abs(visualMoveY) < LOCOMOTION_VISUAL_NEUTRAL_THRESHOLD;

  if (!visualCommittedToTarget && visualStaysNeutral) {
    return previousState;
  }

  return nextState;
}

function shouldUseRifleRunInput(
  movementActive: boolean,
  runModifierPressed: boolean,
  moveX: number,
  moveY: number,
): boolean {
  return movementActive &&
    runModifierPressed &&
    isSprintInputEligible(moveX, moveY);
}

function isStandingRifleDirectionPauseEligible(
  grounded: boolean,
  moving: boolean,
  hasDirectionalInput: boolean,
  meaningfulInput: boolean,
  isWeaponHoldEquipped: boolean,
  adsActive: boolean,
  crouched: boolean,
  crouchTransitionState: CrouchTransitionState,
  firePrepIntent: boolean,
  runState: RifleRunVisualState,
): boolean {
  return grounded &&
    moving &&
    hasDirectionalInput &&
    meaningfulInput &&
    isWeaponHoldEquipped &&
    !adsActive &&
    !crouched &&
    crouchTransitionState === "idle" &&
    !firePrepIntent &&
    runState === "idle";
}

function normalizeAngle(angleRadians: number): number {
  return Math.atan2(Math.sin(angleRadians), Math.cos(angleRadians));
}

function resolveFirstPersonVisibilityCategory(
  materialName: string,
): CharacterVisibilityCategory {
  const normalized = materialName.trim().toLowerCase();
  if (normalized.includes("glove")) {
    return "glove";
  }
  if (normalized.includes("shoe")) {
    return "shoe";
  }
  return "hidden";
}

function collectCharacterVisibilityMaterials(
  model: THREE.Group,
): CharacterVisibilityMaterialEntry[] {
  const seen = new Set<THREE.Material>();
  const entries: CharacterVisibilityMaterialEntry[] = [];

  model.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) {
      return;
    }

    const mesh = child as THREE.Mesh;
    const materials = ([] as THREE.Material[]).concat(
      mesh.material as THREE.Material | THREE.Material[],
    );
    for (const material of materials) {
      if (!material || seen.has(material)) {
        continue;
      }
      seen.add(material);
      const category = mesh.userData?.characterEmbeddedWeapon
        ? "glove"
        : resolveFirstPersonVisibilityCategory(material.name ?? "");
      entries.push({
        material,
        category,
        baseOpacity: material.opacity,
        baseTransparent: material.transparent,
      });
    }
  });

  // If no material was categorized as "glove" or "shoe", this model doesn't
  // use the Trooper naming convention.  Show the entire character in first
  // person by treating all materials as visible ("glove").
  const hasVisibleParts = entries.some(
    (e) => e.category === "glove" || e.category === "shoe",
  );
  if (!hasVisibleParts) {
    for (const entry of entries) {
      entry.category = "glove";
    }
  }

  return entries;
}

function applyCharacterFirstPersonMask(
  entries: CharacterVisibilityMaterialEntry[],
  maskBlend: number,
  gloveVisibility: number,
  shoeVisibility: number,
): void {
  const clampedMaskBlend = THREE.MathUtils.clamp(maskBlend, 0, 1);
  if (clampedMaskBlend <= 0.001) {
    for (const entry of entries) {
      const nextTransparent = entry.baseTransparent;
      if (entry.material.transparent !== nextTransparent) {
        entry.material.transparent = nextTransparent;
        entry.material.needsUpdate = true;
      }
      entry.material.visible = true;
      entry.material.opacity = entry.baseOpacity;
    }
    return;
  }

  for (const entry of entries) {
    const categoryVisibility = entry.category === "glove"
      ? gloveVisibility
      : entry.category === "shoe"
      ? shoeVisibility
      : 0;
    const nextOpacity = entry.baseOpacity * THREE.MathUtils.clamp(
      categoryVisibility,
      0,
      1,
    );
    const nextVisible = nextOpacity > 0.02;
    const nextTransparent = entry.baseTransparent || nextOpacity < 0.999;
    if (entry.material.transparent !== nextTransparent) {
      entry.material.transparent = nextTransparent;
      entry.material.needsUpdate = true;
    }
    entry.material.visible = nextVisible;
    entry.material.opacity = nextOpacity;
  }
}

function resolveMovementHeadingYaw(
  aimYaw: number,
  moveX: number,
  moveY: number,
  fallbackYaw: number,
): number {
  if (Math.abs(moveX) <= 0.001 && Math.abs(moveY) <= 0.001) {
    return fallbackYaw;
  }
  const sinYaw = Math.sin(aimYaw);
  const cosYaw = Math.cos(aimYaw);
  const desiredX = moveX * cosYaw - moveY * sinYaw;
  const desiredZ = -moveX * sinYaw - moveY * cosYaw;
  if (Math.abs(desiredX) <= 0.0001 && Math.abs(desiredZ) <= 0.0001) {
    return fallbackYaw;
  }
  return normalizeAngle(Math.atan2(-desiredX, -desiredZ));
}

function easeInOutCubic(value: number) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function updateWorldWeaponMesh(
  mesh: THREE.Group | null,
  isPresentOnGround: boolean,
  droppedPosition: [number, number, number] | null,
  reveal: number,
  rotationY: number,
) {
  if (!mesh) {
    return;
  }

  const visible = isPresentOnGround && droppedPosition !== null &&
    reveal > 0.02;
  mesh.visible = visible;
  if (!visible) {
    return;
  }

  mesh.scale.setScalar(0.82 + reveal * 0.18);
  mesh.position.set(
    droppedPosition[0],
    droppedPosition[1],
    droppedPosition[2],
  );
  mesh.rotation.set(0.2, rotationY, 0);
}

function updateBackWeaponMesh(
  mesh: THREE.Group | null,
  visible: boolean,
  switchState: WeaponSwitchState,
  holsterDirection: number,
  anchor: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null,
) {
  if (!mesh) {
    return;
  }

  const shouldShow = visible && Boolean(anchor);
  mesh.visible = shouldShow;
  if (!shouldShow || !anchor) {
    return;
  }

  mesh.position.copy(anchor.position);
  mesh.quaternion.copy(anchor.quaternion);

  const switchBlend = switchState.active
    ? Math.sin(Math.PI * switchState.progress)
    : 0;
  mesh.translateX(holsterDirection * switchBlend * 0.016);
  mesh.translateY(switchBlend * 0.025);
  mesh.translateZ(-switchBlend * 0.03);
  mesh.rotateY(holsterDirection * switchBlend * 0.08);
  mesh.rotateZ(holsterDirection * switchBlend * 0.08);
}

function updateCharacterWeaponMesh(
  weaponGroup: THREE.Group | null,
  rifleModel: THREE.Group | null,
  sniperModel: THREE.Group | null,
  muzzleFlashMesh: THREE.Mesh | null,
  weapon: WeaponSystem,
  nowMs: number,
  switchState: WeaponSwitchState,
  anchor: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null,
  alignment: WeaponAlignmentOffset,
  rifleMuzzleOffset: THREE.Vector3,
  sniperMuzzleOffset: THREE.Vector3,
  firstPerson: boolean,
  adsT: number,
  camera: THREE.Camera,
  activeWeapon: WeaponKind,
  forcedWeapon: WeaponKind | null,
) {
  if (!weaponGroup) {
    return;
  }

  const displayedWeapon = resolveDisplayedWeapon(
    weapon,
    switchState,
    forcedWeapon,
  );
  const shouldShowWeapon = displayedWeapon !== null;
  weaponGroup.visible = shouldShowWeapon;
  if (!shouldShowWeapon) {
    if (rifleModel) {
      rifleModel.visible = false;
    }
    if (sniperModel) {
      sniperModel.visible = false;
    }
    if (muzzleFlashMesh) {
      muzzleFlashMesh.visible = false;
    }
    return;
  }

  const switchPoseBlend = !switchState.active
    ? 0
    : switchState.fromHolstered && !switchState.toHolstered
    ? 1 - easeInOutCubic(switchState.progress)
    : !switchState.fromHolstered && switchState.toHolstered
    ? easeInOutCubic(switchState.progress)
    : switchState.progress < 0.5
    ? easeInOutCubic(switchState.progress * 2)
    : 1 - easeInOutCubic((switchState.progress - 0.5) * 2);
  const holsterDirection = displayedWeapon === "rifle" ? -1 : 1;

  if (anchor && firstPerson && adsT > 0.001) {
    // ── Blended ADS positioning ──
    // Compute hip-fire position from hand bone + alignment offsets
    _tempWeaponGroup.position.copy(anchor.position);
    _tempWeaponGroup.quaternion.copy(anchor.quaternion);
    _tempWeaponGroup.rotation.setFromQuaternion(_tempWeaponGroup.quaternion);
    _tempWeaponGroup.translateX(alignment.posX);
    _tempWeaponGroup.translateY(alignment.posY);
    _tempWeaponGroup.translateZ(alignment.posZ);
    _tempWeaponGroup.rotateX(alignment.rotX);
    _tempWeaponGroup.rotateY(alignment.rotY);
    _tempWeaponGroup.rotateZ(alignment.rotZ);
    if (switchPoseBlend > 0) {
      _tempWeaponGroup.translateX(holsterDirection * switchPoseBlend * 0.035);
      _tempWeaponGroup.translateY(-switchPoseBlend * 0.1);
      _tempWeaponGroup.translateZ(-switchPoseBlend * 0.08);
      _tempWeaponGroup.rotateX(-switchPoseBlend * 0.65);
      _tempWeaponGroup.rotateY(holsterDirection * switchPoseBlend * 0.18);
      _tempWeaponGroup.rotateZ(holsterDirection * switchPoseBlend * 0.12);
    }
    _tempHipPos.copy(_tempWeaponGroup.position);
    _tempHipQuat.copy(_tempWeaponGroup.quaternion);

    // Compute camera-relative ADS position
    const adsOffset = activeWeapon === "sniper"
      ? SNIPER_ADS_CAMERA_OFFSET
      : RIFLE_ADS_CAMERA_OFFSET;
    _tempCameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _tempCameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    _tempCameraForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    _tempAdsPos.copy(camera.position);
    _tempAdsPos.addScaledVector(_tempCameraRight, adsOffset.x);
    _tempAdsPos.addScaledVector(_tempCameraUp, adsOffset.y);
    _tempAdsPos.addScaledVector(_tempCameraForward, adsOffset.z);

    // ADS quaternion: camera rotation + weapon model base rotation only
    // (NOT the alignment rotation — that's for hand bone space, not camera space)
    _tempAlignQuat.setFromEuler(WEAPON_ADS_BASE_EULER);
    _tempAdsQuat.copy(camera.quaternion).multiply(_tempAlignQuat);

    // Blend between hip-fire and ADS
    weaponGroup.position.lerpVectors(_tempHipPos, _tempAdsPos, adsT);
    weaponGroup.quaternion.slerpQuaternions(_tempHipQuat, _tempAdsQuat, adsT);
  } else if (anchor) {
    // ── Standard hip-fire positioning (unchanged) ──
    weaponGroup.position.copy(anchor.position);
    weaponGroup.quaternion.copy(anchor.quaternion);
    weaponGroup.translateX(alignment.posX);
    weaponGroup.translateY(alignment.posY);
    weaponGroup.translateZ(alignment.posZ);
    weaponGroup.rotateX(alignment.rotX);
    weaponGroup.rotateY(alignment.rotY);
    weaponGroup.rotateZ(alignment.rotZ);
    if (switchPoseBlend > 0) {
      weaponGroup.translateX(holsterDirection * switchPoseBlend * 0.035);
      weaponGroup.translateY(-switchPoseBlend * 0.1);
      weaponGroup.translateZ(-switchPoseBlend * 0.08);
      weaponGroup.rotateX(-switchPoseBlend * 0.65);
      weaponGroup.rotateY(holsterDirection * switchPoseBlend * 0.18);
      weaponGroup.rotateZ(holsterDirection * switchPoseBlend * 0.12);
    }
  } else {
    weaponGroup.position.set(
      0.34,
      0.82 - switchPoseBlend * 0.24,
      -0.2 + switchPoseBlend * 0.11,
    );
    weaponGroup.rotation.set(
      -switchPoseBlend * 0.75,
      holsterDirection * switchPoseBlend * 0.16,
      -holsterDirection * switchPoseBlend * 0.18,
    );
  }

  if (rifleModel) {
    rifleModel.visible = displayedWeapon === "rifle";
  }
  if (sniperModel) {
    sniperModel.visible = displayedWeapon === "sniper";
  }

  if (muzzleFlashMesh) {
    if (displayedWeapon === "sniper") {
      muzzleFlashMesh.position.copy(sniperMuzzleOffset);
      muzzleFlashMesh.scale.setScalar(1.15);
    } else {
      muzzleFlashMesh.position.copy(rifleMuzzleOffset);
      muzzleFlashMesh.scale.setScalar(1);
    }
    muzzleFlashMesh.visible = weapon.hasMuzzleFlash(nowMs);
  }
}

function resolveDisplayedWeapon(
  weapon: WeaponSystem,
  switchState: WeaponSwitchState,
  forcedWeapon: WeaponKind | null = null,
): WeaponKind | null {
  if (forcedWeapon) {
    return forcedWeapon;
  }
  if (!switchState.active) {
    return weapon.getRaisedWeapon();
  }
  if (switchState.fromHolstered && !switchState.toHolstered) {
    return switchState.to;
  }
  if (!switchState.fromHolstered && switchState.toHolstered) {
    return switchState.from;
  }
  return switchState.progress < 0.5 ? switchState.from : switchState.to;
}

function shouldShowBackWeapon(
  weaponKind: WeaponKind,
  displayedWeapon: WeaponKind | null,
  switchState: WeaponSwitchState,
) {
  if (!displayedWeapon) {
    return true;
  }

  if (switchState.active) {
    if (!switchState.fromHolstered && switchState.toHolstered) {
      return weaponKind === switchState.from || displayedWeapon !== weaponKind;
    }
    if (switchState.fromHolstered && !switchState.toHolstered) {
      if (weaponKind === switchState.to) {
        return switchState.progress < 0.75;
      }
    }
  }

  return displayedWeapon !== weaponKind;
}

function updateTracerMesh(
  tracerMesh: THREE.Mesh | null,
  weapon: WeaponSystem,
  nowMs: number,
  tempMid: THREE.Vector3,
  tempDir: THREE.Vector3,
) {
  if (!tracerMesh) {
    return;
  }

  const tracer = weapon.getActiveTracer(nowMs);
  if (!tracer) {
    tracerMesh.visible = false;
    return;
  }

  tempDir.copy(tracer.to).sub(tracer.from);
  const length = tempDir.length();
  if (length <= 0.0001) {
    tracerMesh.visible = false;
    return;
  }

  tracerMesh.visible = true;
  tempMid.copy(tracer.from).lerp(tracer.to, 0.5);
  tracerMesh.position.copy(tempMid);
  tracerMesh.scale.set(1, 1, length);
  tracerMesh.quaternion.setFromUnitVectors(Z_AXIS, tempDir.normalize());
}

function raycastBulletWorld(
  hittables: THREE.Object3D[],
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  raycaster: THREE.Raycaster,
  tempNormal: THREE.Vector3,
  tempNormalMatrix: THREE.Matrix3,
  maxDistance = Number.POSITIVE_INFINITY,
): WorldRaycastHit | null {
  if (maxDistance <= 0 || hittables.length === 0) {
    return null;
  }

  raycaster.near = 0;
  raycaster.far = maxDistance;
  raycaster.set(origin, direction);
  const intersections = raycaster.intersectObjects(hittables, false);

  for (const intersection of intersections) {
    if (intersection.distance <= 0 || intersection.distance > maxDistance) {
      continue;
    }

    const object = intersection.object;
    if (intersection.face) {
      tempNormal.copy(intersection.face.normal);
      tempNormalMatrix.getNormalMatrix(object.matrixWorld);
      tempNormal.applyMatrix3(tempNormalMatrix).normalize();
    } else {
      tempNormal.set(0, 1, 0);
    }

    return {
      point: intersection.point,
      normal: tempNormal,
      distance: intersection.distance,
    };
  }

  return null;
}

export const GameplayRuntime = forwardRef<
  GameplayRuntimeHandle,
  GameplayRuntimeProps
>(function GameplayRuntime({
  practiceMap,
  audioVolumes,
  presentation,
  gameplayInputEnabled,
  sensitivity,
  controllerSettings,
  keybinds,
  crouchMode,
  inventoryOpenMode,
  fov,
  weaponAlignment,
  movement,
  weaponRecoilProfiles,
  targets,
  targetVisualRegistryRef,
  onTargetHit,
  onResetTargets,
  onPlayerSnapshot,
  onPerfMetrics,
  onHitMarker,
  onShotFired,
  onWeaponEquippedChange,
  onActiveWeaponChange,
  onSniperRechamberChange,
  onAimingStateChange,
  deferredAssetsEnabled = true,
  onCriticalAssetsReadyChange,
  characterOverride,
  onPauseMenuToggle,
}: GameplayRuntimeProps, ref) {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const spawnPosition = practiceMap.playerSpawn.position;
  const spawnYaw = practiceMap.playerSpawn.yaw;
  const spawnPitch = practiceMap.playerSpawn.pitch;
  const spawnPositionVector = useMemo(
    () => new THREE.Vector3(spawnPosition[0], spawnPosition[1], spawnPosition[2]),
    [spawnPosition],
  );

  const {
    model: characterModel,
    ready: characterReady,
    embeddedWeapon,
    setAnimState: setCharacterAnim,
    getFootstepSample,
  } = useCharacterModel(characterOverride);
  const rawCharacterSandboxMode =
    isEmbeddedGlbCharacterOverride(characterOverride);
  const singleWeaponMode = isSingleWeaponCharacterOverride(characterOverride);
  const runtimeGroundSpawns = useMemo(
    () =>
      filterPracticeGroundSpawns(
        practiceMap.groundSpawns,
        rawCharacterSandboxMode,
        singleWeaponMode,
      ),
    [practiceMap.groundSpawns, rawCharacterSandboxMode, singleWeaponMode],
  );
  const weaponModels = useWeaponModels();
  const sightModels = useSightModels(deferredAssetsEnabled);
  const rifleMuzzleOffsetRef = useRef(new THREE.Vector3(-0.44, 0.02, 0));
  const sniperMuzzleOffsetRef = useRef(new THREE.Vector3(-0.66, 0.02, 0));

  useEffect(() => {
    if (weaponModels.rifle) {
      rifleMuzzleOffsetRef.current = computeWeaponMuzzleOffset(
        weaponModels.rifle,
        WEAPON_MODEL_TRANSFORMS.character.rifle,
      );
    }
    if (weaponModels.sniper) {
      sniperMuzzleOffsetRef.current = computeWeaponMuzzleOffset(
        weaponModels.sniper,
        WEAPON_MODEL_TRANSFORMS.character.sniper,
      );
    }
  }, [weaponModels]);

  const weaponRef = useRef<WeaponSystem>(new WeaponSystem());
  const inventoryRef = useRef<InventorySystem>(
    new InventorySystem(runtimeGroundSpawns),
  );
  const audioRef = useRef(sharedAudioManager);
  const controllerRef = useRef<PlayerControllerApi | null>(null);
  const targetsRef = useRef(targets);
  const targetRevealRef = useRef(presentation.targetReveal);
  targetRevealRef.current = presentation.targetReveal;
  const latestControllerSnapshotRef = useRef<PlayerSnapshot | null>(null);
  const lastHudSyncKeyRef = useRef("");
  const ammoVisualRevisionRef = useRef(-1);
  const practiceAmmoRespawnAtRef = useRef<number | null>(null);
  const [impactMarks, setImpactMarks] = useState<BulletImpactMark[]>([]);
  const [bloodSplats, setBloodSplats] = useState<BloodSplatMark[]>([]);
  const [groundAmmoVisualState, setGroundAmmoVisualState] = useState<
    GroundAmmoVisualState
  >(
    () => inventoryRef.current.getGroundAmmoVisualState(),
  );

  const playerSnapshotCallbackRef = useRef(onPlayerSnapshot);
  const perfCallbackRef = useRef(onPerfMetrics);
  const targetHitCallbackRef = useRef(onTargetHit);
  const resetTargetsCallbackRef = useRef(onResetTargets);
  const hitMarkerCallbackRef = useRef(onHitMarker);
  const shotFiredCallbackRef = useRef(onShotFired);
  const weaponEquippedCallbackRef = useRef(onWeaponEquippedChange);
  const activeWeaponCallbackRef = useRef(onActiveWeaponChange);
  const sniperRechamberCallbackRef = useRef(onSniperRechamberChange);
  const aimingStateCallbackRef = useRef(onAimingStateChange);

  const perfAccumulatorRef = useRef(0);
  const perfFrameMsEmaRef = useRef(0);
  const fpsFrameCountRef = useRef(0);
  const fpsTimeRef = useRef(0);
  const lastWeaponEquippedRef = useRef<boolean | null>(null);
  const lastActiveWeaponRef = useRef<WeaponKind | null>(null);
  const lastADSRef = useRef<boolean | null>(null);
  const lastFirstPersonRef = useRef<boolean | null>(null);
  const rifleFireIntentRef = useRef(false);
  const rifleRunStateRef = useRef<RifleRunVisualState>("idle");
  const rifleRunStateUntilRef = useRef(0);
  const rifleRunInputGraceUntilRef = useRef(0);
  const rifleRunHeadingYawRef = useRef(spawnYaw);
  const crouchTransitionStateRef = useRef<CrouchTransitionState>("idle");
  const crouchTransitionStartedAtRef = useRef(0);
  const crouchTransitionDurationRef = useRef(0);
  const crouchTransitionUseRifleRef = useRef(false);
  const crouchTransitionPoseFromRef = useRef(0);
  const wasCrouchedRef = useRef(false);
  const wasGroundedRef = useRef(true);
  const slideIntentHookRef = useRef<SlideIntentHookState>({
    eligible: false,
    lastIntentAtMs: -1,
    lastIntentSpeed: 0,
    lastIntentYaw: 0,
    lastIntentMoveX: 0,
    lastIntentMoveY: 0,
  });
  const movementSettingsRef = useRef<MovementProfileSettings>(movement);
  const locomotionVisualInputRef = useRef(new THREE.Vector2());
  const locomotionLocalVelocityRef = useRef(new THREE.Vector2());
  const directionChangeTrackedInputRef = useRef(new THREE.Vector2());
  const directionChangePauseUntilRef = useRef(0);
  const sprintStopRecoveryUntilRef = useRef(0);
  const skipDirectionChangeSnapRef = useRef(false);
  const unarmedWalkStateRef = useRef<UnarmedWalkVisualState>("idle");
  const unarmedWalkStateUntilRef = useRef(0);
  const lastCharacterAnimStateRef = useRef<CharacterAnimState>("idle");

  const worldRiflePickupRef = useRef<THREE.Group>(null);
  const worldSniperPickupRef = useRef<THREE.Group>(null);
  const menuCharacterKeyLightRef = useRef<THREE.PointLight>(null);
  const menuCharacterRimLightRef = useRef<THREE.PointLight>(null);
  const playerCharacterRef = useRef<THREE.Group>(null);
  const backRifleSlotRef = useRef<THREE.Group>(null);
  const backSniperSlotRef = useRef<THREE.Group>(null);
  const characterWeaponRef = useRef<THREE.Group>(null);
  const characterRifleModelRef = useRef<THREE.Group>(null);
  const characterSniperModelRef = useRef<THREE.Group>(null);
  const characterMuzzleRef = useRef<THREE.Mesh>(null);
  const embeddedWeaponMuzzleRef = useRef<THREE.Mesh>(null);
  const tracerRef = useRef<THREE.Mesh>(null);

  const tempEndRef = useRef(new THREE.Vector3());
  const tempMidRef = useRef(new THREE.Vector3());
  const tempTracerDirRef = useRef(new THREE.Vector3());
  const tempLookDirRef = useRef(new THREE.Vector3());
  const tempAimPointRef = useRef(new THREE.Vector3());
  const tempFireDirectionRef = useRef(new THREE.Vector3());
  const tempTracerOriginRef = useRef(new THREE.Vector3());
  const tempEmbeddedWeaponMuzzleWorldRef = useRef(new THREE.Vector3());
  const tempEmbeddedWeaponWorldQuatRef = useRef(new THREE.Quaternion());
  const tempImpactNormalRef = useRef(new THREE.Vector3());
  const tempImpactNormalMatrixRef = useRef(new THREE.Matrix3());
  const tempImpactQuaternionRef = useRef(new THREE.Quaternion());
  const tempImpactPositionRef = useRef(new THREE.Vector3());
  const tempBloodTangentRef = useRef(new THREE.Vector3());
  const tempBloodBitangentRef = useRef(new THREE.Vector3());
  const raycasterRef = useRef(new THREE.Raycaster());
  const bulletHittableMeshesRef = useRef<THREE.Object3D[]>([]);
  const bulletHittableMeshesDirtyRef = useRef(true);
  const impactIdRef = useRef(0);
  const bloodSplatIdRef = useRef(0);
  const lastImpactCleanupAtRef = useRef(0);
  const lastSniperRechamberActiveRef = useRef<boolean | null>(null);
  const lastSniperRechamberProgressStepRef = useRef(-1);
  const lastReloadActiveRef = useRef<boolean | null>(null);
  const lastReloadWeaponKindRef = useRef<WeaponKind | null>(null);
  const characterWeaponAttachBoneRef = useRef<THREE.Object3D | null>(null);
  const characterHeadBoneRef = useRef<THREE.Bone | null>(null);
  const characterUpperTorsoBoneRef = useRef<THREE.Bone | null>(null);
  const characterLowerTorsoBoneRef = useRef<THREE.Bone | null>(null);
  const characterHeadBaseQuatRef = useRef<THREE.Quaternion | null>(null);
  const characterUpperTorsoBaseQuatRef = useRef<THREE.Quaternion | null>(null);
  const characterLowerTorsoBaseQuatRef = useRef<THREE.Quaternion | null>(null);
  const tempCharacterWeaponAnchorWorldRef = useRef(new THREE.Vector3());
  const tempBoneWorldQuatRef = useRef(new THREE.Quaternion());
  const tempBackWeaponAnchorWorldRef = useRef(new THREE.Vector3());
  const tempBackWeaponAnchorQuatRef = useRef(new THREE.Quaternion());
  const characterWeaponAnchorRef = useRef<
    {
      position: THREE.Vector3;
      quaternion: THREE.Quaternion;
    } | null
  >(null);
  const backWeaponAnchorRef = useRef<
    {
      position: THREE.Vector3;
      quaternion: THREE.Quaternion;
    } | null
  >(null);
  const characterVisibilityMaterialsRef = useRef<
    CharacterVisibilityMaterialEntry[]
  >([]);
  const footstepPhaseRef = useRef<FootstepPhaseTracker>({
    cycle: 0,
    lastNormalizedTime: 0,
    state: null,
  });
  const stepsBeforeSometimesRef = useRef(createSometimesStepWindow());
  const returningFreezePosRef = useRef(new THREE.Vector3());
  const returningFreezeLookRef = useRef(new THREE.Vector3());
  const lastPhaseRef = useRef(presentation.phase);
  const transitionForwardRef = useRef(new THREE.Vector3());
  const transitionRightRef = useRef(new THREE.Vector3());
  const transitionFrontPosRef = useRef(new THREE.Vector3());
  const transitionFrontLookRef = useRef(new THREE.Vector3());
  const transitionBackPosRef = useRef(new THREE.Vector3());
  const transitionBackLookRef = useRef(new THREE.Vector3());

  useEffect(() => {
    targetsRef.current = targets;
  }, [targets]);

  useEffect(() => {
    playerSnapshotCallbackRef.current = onPlayerSnapshot;
  }, [onPlayerSnapshot]);

  useEffect(() => {
    perfCallbackRef.current = onPerfMetrics;
  }, [onPerfMetrics]);

  useEffect(() => {
    targetHitCallbackRef.current = onTargetHit;
  }, [onTargetHit]);

  useEffect(() => {
    resetTargetsCallbackRef.current = onResetTargets;
  }, [onResetTargets]);

  useEffect(() => {
    hitMarkerCallbackRef.current = onHitMarker;
  }, [onHitMarker]);

  useEffect(() => {
    shotFiredCallbackRef.current = onShotFired;
  }, [onShotFired]);

  useEffect(() => {
    weaponEquippedCallbackRef.current = onWeaponEquippedChange;
  }, [onWeaponEquippedChange]);

  useEffect(() => {
    activeWeaponCallbackRef.current = onActiveWeaponChange;
  }, [onActiveWeaponChange]);

  useEffect(() => {
    sniperRechamberCallbackRef.current = onSniperRechamberChange;
  }, [onSniperRechamberChange]);

  useEffect(() => {
    aimingStateCallbackRef.current = onAimingStateChange;
  }, [onAimingStateChange]);

  useEffect(() => {
    if (!characterModel) {
      characterWeaponAttachBoneRef.current = null;
      characterHeadBoneRef.current = null;
      characterUpperTorsoBoneRef.current = null;
      characterLowerTorsoBoneRef.current = null;
      characterHeadBaseQuatRef.current = null;
      characterUpperTorsoBaseQuatRef.current = null;
      characterLowerTorsoBaseQuatRef.current = null;
      characterWeaponAnchorRef.current = null;
      backWeaponAnchorRef.current = null;
      characterVisibilityMaterialsRef.current = [];
      return;
    }

    let rightHandBone: THREE.Bone | null = null;
    let headBone: THREE.Bone | null = null;
    let upperTorsoBone: THREE.Bone | null = null;
    let upperTorsoPriority = Number.POSITIVE_INFINITY;
    const embeddedWeaponSocket = characterOverride?.embeddedWeapon?.socketName
      ? characterModel.getObjectByName(characterOverride.embeddedWeapon.socketName)
      : null;
    characterModel.traverse((child) => {
      if (!(child as THREE.Bone).isBone) return;
      const bone = child as THREE.Bone;
      const normalized = normalizeBoneName(bone.name).toLowerCase();
      if (
        !rightHandBone &&
        (normalized === "r_hand" ||
          normalized === "righthand" ||
          normalized === "right_hand" ||
          normalized === "hand_r" ||
          normalized === "hand.r" ||
          normalized.includes("r_hand") ||
          normalized.includes("right_hand") ||
          normalized.includes("righthand") ||
          normalized.includes("hand_r"))
      ) {
        rightHandBone = bone;
      }
      if (
        !headBone &&
        (normalized === "head" ||
          normalized === "head_end" ||
          normalized.includes("head"))
      ) {
        if (normalized === "head") {
          headBone = bone;
        } else if (!headBone) {
          headBone = bone;
        }
      }
      const torsoPriority =
        normalized === "upper_chest" || normalized === "upperchest"
          ? 0
          : normalized === "chest"
          ? 1
          : normalized === "spine"
          ? 2
          : Number.POSITIVE_INFINITY;
      if (torsoPriority < upperTorsoPriority) {
        upperTorsoBone = bone;
        upperTorsoPriority = torsoPriority;
      }
    });

    const resolvedRightHandBone = rightHandBone as THREE.Bone | null;
    const resolvedHeadBone = headBone as THREE.Bone | null;
    const resolvedUpperTorsoBone = upperTorsoBone as THREE.Bone | null;

    // Find lower torso bone (spine ancestor of the upper torso bone) for deeper lean.
    let resolvedLowerTorsoBone: THREE.Bone | null = null;
    if (resolvedUpperTorsoBone) {
      let ancestor = resolvedUpperTorsoBone.parent as THREE.Object3D | null;
      while (ancestor) {
        if ((ancestor as THREE.Bone).isBone) {
          const ancestorName = normalizeBoneName(ancestor.name).toLowerCase();
          if (
            ancestorName === "spine1" ||
            ancestorName === "spine_01" ||
            ancestorName === "spine"
          ) {
            resolvedLowerTorsoBone = ancestor as THREE.Bone;
            break;
          }
        }
        ancestor = ancestor.parent;
      }
    }

    characterWeaponAttachBoneRef.current = embeddedWeaponSocket ?? resolvedRightHandBone;
    characterHeadBoneRef.current = resolvedHeadBone;
    characterUpperTorsoBoneRef.current = resolvedUpperTorsoBone;
    characterLowerTorsoBoneRef.current = resolvedLowerTorsoBone;
    if (resolvedHeadBone) {
      characterHeadBaseQuatRef.current = resolvedHeadBone.quaternion.clone();
    } else {
      characterHeadBaseQuatRef.current = null;
    }
    if (resolvedUpperTorsoBone) {
      characterUpperTorsoBaseQuatRef.current = resolvedUpperTorsoBone.quaternion
        .clone();
    } else {
      characterUpperTorsoBaseQuatRef.current = null;
    }
    if (resolvedLowerTorsoBone) {
      characterLowerTorsoBaseQuatRef.current = resolvedLowerTorsoBone.quaternion
        .clone();
    } else {
      characterLowerTorsoBaseQuatRef.current = null;
    }
    if (!embeddedWeaponSocket && !resolvedRightHandBone) {
      console.warn(
        "[Character] Could not find right-hand bone for weapon attach",
      );
    }
  }, [characterModel, characterOverride?.embeddedWeapon?.socketName]);

  useEffect(() => {
    if (!characterModel) {
      characterVisibilityMaterialsRef.current = [];
      return;
    }

    const visibilityMaterials = collectCharacterVisibilityMaterials(
      characterModel,
    );
    characterVisibilityMaterialsRef.current = visibilityMaterials;
    applyCharacterFirstPersonMask(visibilityMaterials, 0, 1, 1);

    return () => {
      applyCharacterFirstPersonMask(visibilityMaterials, 0, 1, 1);
      characterVisibilityMaterialsRef.current = [];
    };
  }, [characterModel]);

  useEffect(() => {
    audioRef.current.setVolumes(audioVolumes);
  }, [audioVolumes]);

  useEffect(() => {
    movementSettingsRef.current = movement;
  }, [movement]);

  useEffect(() => {
    weaponRef.current.setRecoilProfiles(weaponRecoilProfiles);
  }, [weaponRecoilProfiles]);

  useEffect(() => {
    onCriticalAssetsReadyChange?.(characterReady && weaponModels.ready);
  }, [characterReady, onCriticalAssetsReadyChange, weaponModels.ready]);

  const pushImpactMark = useCallback(
    (point: THREE.Vector3, normal: THREE.Vector3) => {
      const safeNormal = tempImpactNormalRef.current;
      safeNormal.copy(normal);
      if (safeNormal.lengthSq() < 1e-6) {
        safeNormal.set(0, 1, 0);
      } else {
        safeNormal.normalize();
      }

      const position = tempImpactPositionRef.current
        .copy(point)
        .addScaledVector(safeNormal, BULLET_IMPACT_MARK_SURFACE_OFFSET);
      const quaternion = tempImpactQuaternionRef.current.setFromUnitVectors(
        Z_AXIS,
        safeNormal,
      );
      const nowMs = performance.now();
      const nextMark: BulletImpactMark = {
        id: impactIdRef.current,
        expiresAt: nowMs + BULLET_IMPACT_LIFETIME_MS,
        position: [position.x, position.y, position.z],
        quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
      };
      impactIdRef.current += 1;

      startTransition(() => {
        setImpactMarks((previous) => {
          const alive = previous.filter((mark) => mark.expiresAt > nowMs);
          if (alive.length >= MAX_BULLET_IMPACT_MARKS) {
            return [...alive.slice(1), nextMark];
          }
          return [...alive, nextMark];
        });
      });
    },
    [],
  );

  const pushBloodSpray = useCallback(
    (
      point: THREE.Vector3,
      normal: THREE.Vector3,
      hitType: "body" | "head" | "leg",
    ) => {
      const safeNormal = tempImpactNormalRef.current;
      safeNormal.copy(normal);
      if (safeNormal.lengthSq() < 1e-6) {
        safeNormal.set(0, 1, 0);
      } else {
        safeNormal.normalize();
      }

      const tangent = tempBloodTangentRef.current;
      tangent.set(
        Math.abs(safeNormal.y) > 0.9 ? 1 : 0,
        Math.abs(safeNormal.y) > 0.9 ? 0 : 1,
        0,
      );
      tangent.cross(safeNormal).normalize();
      const bitangent = tempBloodBitangentRef.current
        .copy(safeNormal)
        .cross(tangent)
        .normalize();

      const nowMs = performance.now();
      const splatCount = hitType === "head" ? 18 : hitType === "body" ? 10 : 6;
      const spraySpeed = hitType === "head"
        ? 3.5
        : hitType === "body"
        ? 2.2
        : 1.4;
      const spreadAngle = hitType === "head"
        ? 0.8
        : hitType === "body"
        ? 0.6
        : 0.4;
      const lifetimeMs = hitType === "head"
        ? BLOOD_SPLAT_LIFETIME_MS + 200
        : hitType === "body"
        ? BLOOD_SPLAT_LIFETIME_MS
        : BLOOD_SPLAT_LIFETIME_MS - 100;
      const nextSplats: BloodSplatMark[] = [];

      for (let i = 0; i < splatCount; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const coneSpread = Math.random() * spreadAngle;
        // Velocity: spray outward along the hit normal with randomized cone spread
        const speed = spraySpeed * (0.4 + Math.random() * 0.8);
        const vx = safeNormal.x * speed +
          tangent.x * Math.cos(angle) * coneSpread * speed +
          bitangent.x * Math.sin(angle) * coneSpread * speed;
        const vy = safeNormal.y * speed +
          tangent.y * Math.cos(angle) * coneSpread * speed +
          bitangent.y * Math.sin(angle) * coneSpread * speed +
          Math.random() * 1.2; // slight upward bias
        const vz = safeNormal.z * speed +
          tangent.z * Math.cos(angle) * coneSpread * speed +
          bitangent.z * Math.sin(angle) * coneSpread * speed;

        const quaternion = tempImpactQuaternionRef.current.set(
          Math.random() - 0.5,
          Math.random() - 0.5,
          Math.random() - 0.5,
          Math.random(),
        ).normalize();

        nextSplats.push({
          id: bloodSplatIdRef.current,
          createdAt: nowMs,
          expiresAt: nowMs + lifetimeMs + Math.random() * 120,
          position: [point.x, point.y, point.z],
          velocity: [vx, vy, vz],
          quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
          radius:
            (hitType === "head" ? 0.055 : hitType === "body" ? 0.04 : 0.03) *
            (0.5 + Math.random() * 0.8),
          opacity: hitType === "head"
            ? 0.95 - Math.random() * 0.15
            : 0.85 - Math.random() * 0.2,
        });
        bloodSplatIdRef.current += 1;
      }

      setBloodSplats((previous) => {
        const alive = previous.filter((splat) => splat.expiresAt > nowMs);
        const merged = [...alive, ...nextSplats];
        if (merged.length > MAX_BLOOD_SPLAT_MARKS) {
          return merged.slice(merged.length - MAX_BLOOD_SPLAT_MARKS);
        }
        return merged;
      });
    },
    [],
  );

  const emitPlayerSnapshot = useCallback((override?: PlayerSnapshot) => {
    const baseSnapshot = override ?? latestControllerSnapshotRef.current;
    if (!baseSnapshot) {
      return;
    }

    const playerPosition = controllerRef.current?.getPosition();
    const playerPositionTuple: [number, number, number] = playerPosition
      ? [playerPosition.x, playerPosition.y, playerPosition.z]
      : [...spawnPosition];
    const inventorySnapshot = inventoryRef.current.getSnapshot(
      playerPositionTuple,
      baseSnapshot.inventoryPanelOpen,
      baseSnapshot.inventoryPanelMode,
    );
    if (ammoVisualRevisionRef.current !== inventorySnapshot.revision) {
      ammoVisualRevisionRef.current = inventorySnapshot.revision;
      setGroundAmmoVisualState(inventoryRef.current.getGroundAmmoVisualState());
    }

    const nearestItem = inventorySnapshot.nearby[0] ?? null;
    const nearestWeaponKind = nearestItem?.stack.itemId === "weapon_sniper"
      ? "sniper"
      : nearestItem?.stack.itemId === "weapon_rifle"
      ? "rifle"
      : null;
    const nowMs = performance.now();
    playerSnapshotCallbackRef.current({
      ...baseSnapshot,
      canInteract: inventorySnapshot.nearby.length > 0,
      interactWeaponKind: nearestWeaponKind,
      inventory: inventorySnapshot,
      weaponLoadout: weaponRef.current.getLoadoutState(),
      weaponReload: weaponRef.current.getReloadState(nowMs),
      singleWeaponMode,
    });
  }, [singleWeaponMode, spawnPosition]);

  const syncWeaponAmmoFromInventory = useCallback(() => {
    const ammo = inventoryRef.current.getAmmoTotalsByWeaponKind();
    if (!practiceMap.infiniteAmmo) {
      weaponRef.current.setReserveAmmoForKind("rifle", ammo.rifle);
    }
    weaponRef.current.setReserveAmmoForKind("sniper", ammo.sniper);
    return ammo;
  }, [practiceMap.infiniteAmmo]);

  const isAmmoItemId = useCallback((
    itemId: string | null,
  ): itemId is "ammo_rifle" | "ammo_sniper" => {
    return itemId === "ammo_rifle" || itemId === "ammo_sniper";
  }, []);

  const schedulePracticeAmmoRefill = useCallback(() => {
    practiceAmmoRespawnAtRef.current = performance.now() +
      PRACTICE_AMMO_RESPAWN_MS;
  }, []);

  const applyScheduledPracticeAmmoRefill = useCallback(() => {
    const changed = inventoryRef.current.ensurePracticeAmmoStock(
      PRACTICE_AMMO_RIFLE_REFILL,
      singleWeaponMode ? 0 : PRACTICE_AMMO_SNIPER_REFILL,
    );
    if (!changed) {
      return;
    }
    setGroundAmmoVisualState(inventoryRef.current.getGroundAmmoVisualState());
    emitPlayerSnapshot();
  }, [emitPlayerSnapshot, singleWeaponMode]);

  const resolveWeaponSlotId = useCallback(
    (slot: "primary" | "secondary"): WeaponSlotId => {
      return slot === "primary" ? "slotA" : "slotB";
    },
    [],
  );

  const resolveWeaponItemId = useCallback((kind: WeaponKind) => {
    return kind === "rifle" ? "weapon_rifle" : "weapon_sniper";
  }, []);

  const equipGroundWeaponToSlot = useCallback((
    groundId: string,
    slot: "primary" | "secondary",
    fallbackDropPosition?: [number, number, number],
  ): InventoryMoveResult => {
    const weaponId = inventoryRef.current.consumeGroundWeaponItem(groundId);
    if (!weaponId) {
      return { ok: false, message: "No weapon item in that ground slot." };
    }

    const slotId = resolveWeaponSlotId(slot);
    const weaponKind: WeaponKind = weaponId === "weapon_rifle"
      ? "rifle"
      : "sniper";
    const expectedSlot = weaponKind === "rifle" ? "slotA" : "slotB";
    if (slotId !== expectedSlot) {
      inventoryRef.current.dropWeaponItemToGround(weaponId, [
        fallbackDropPosition?.[0] ?? spawnPosition[0],
        0,
        fallbackDropPosition?.[2] ?? spawnPosition[2],
      ]);
      return {
        ok: false,
        message: `That weapon only fits ${
          weaponKind === "rifle" ? "Primary" : "Secondary"
        } slot.`,
      };
    }

    if (weaponRef.current.hasWeaponInSlot(slotId)) {
      inventoryRef.current.dropWeaponItemToGround(weaponId, [
        fallbackDropPosition?.[0] ?? spawnPosition[0],
        0,
        fallbackDropPosition?.[2] ?? spawnPosition[2],
      ]);
      return { ok: false, message: "Weapon slot already occupied." };
    }

    const ammoTotals = inventoryRef.current.getAmmoTotalsByWeaponKind();
    weaponRef.current.equipSlotWithWeapon(slotId, weaponKind, {
      magAmmo: 0,
      reserveAmmo: weaponKind === "rifle"
        ? ammoTotals.rifle
        : ammoTotals.sniper,
      infiniteReserveAmmo: practiceMap.infiniteAmmo && weaponKind === "rifle",
    });
    weaponRef.current.beginReload(performance.now());
    return { ok: true };
  }, [practiceMap.infiniteAmmo, resolveWeaponSlotId, spawnPosition]);

  const dropWeaponFromSlot = useCallback((
    slot: "primary" | "secondary",
    position: [number, number, number],
  ): InventoryMoveResult => {
    const slotId = resolveWeaponSlotId(slot);
    const removed = weaponRef.current.clearWeaponFromSlot(slotId);
    if (!removed?.weaponKind) {
      return { ok: false, message: "Weapon slot is already empty." };
    }
    inventoryRef.current.dropWeaponItemToGround(
      resolveWeaponItemId(removed.weaponKind),
      position,
    );
    return { ok: true };
  }, [resolveWeaponItemId, resolveWeaponSlotId]);

  const handleAction = useCallback(
    (action: string) => {
      const weapon = weaponRef.current;
      if (action === "equipRifle") {
        audioRef.current.cancelReload();
        audioRef.current.cancelSniperShelling();
        weapon.setActiveSlot("slotA");
        inventoryRef.current.setActiveQuickSlot("primary");
        emitPlayerSnapshot();
        return;
      }
      if (action === "equipSniper") {
        if (singleWeaponMode) {
          return;
        }
        audioRef.current.cancelReload();
        audioRef.current.cancelSniperShelling();
        weapon.setActiveSlot("slotB");
        inventoryRef.current.setActiveQuickSlot("secondary");
        emitPlayerSnapshot();
        return;
      }
      if (action === "unarm") {
        audioRef.current.cancelReload();
        audioRef.current.cancelSniperShelling();
        weapon.unarm(performance.now());
        emitPlayerSnapshot();
        return;
      }
      if (action === "reload") {
        weapon.beginReload(performance.now());
        emitPlayerSnapshot();
        return;
      }
      if (action === "reset") {
        resetTargetsCallbackRef.current();
        return;
      }

      const playerPosition = controllerRef.current?.getPosition();
      if (!playerPosition) {
        return;
      }

      if (action === "pickup") {
        const playerPosTuple: [number, number, number] = [
          playerPosition.x,
          playerPosition.y,
          playerPosition.z,
        ];
        const nearbyIds = inventoryRef.current.getNearbyGroundIds(
          playerPosTuple,
        );
        const nearest = nearbyIds[0];
        const nearestItemId = nearest
          ? inventoryRef.current.getGroundItemId(nearest.id) ?? null
          : null;
        if (nearest) {
          if (nearestItemId === "weapon_rifle") {
            equipGroundWeaponToSlot(nearest.id, "primary", playerPosTuple);
            syncWeaponAmmoFromInventory();
            emitPlayerSnapshot();
            return;
          }
          if (nearestItemId === "weapon_sniper") {
            if (singleWeaponMode) {
              emitPlayerSnapshot();
              return;
            }
            equipGroundWeaponToSlot(nearest.id, "secondary", playerPosTuple);
            syncWeaponAmmoFromInventory();
            emitPlayerSnapshot();
            return;
          }
        }
        const result = inventoryRef.current.quickPickupClosestNearby(
          playerPosTuple,
          weapon.getLoadoutState(),
        );
        if (result.ok && isAmmoItemId(nearestItemId ?? null)) {
          schedulePracticeAmmoRefill();
        }
        syncWeaponAmmoFromInventory();
        emitPlayerSnapshot();
        return;
      }

      if (action === "drop") {
        const slotId = weapon.getActiveSlotId();
        const activeSlot = slotId === "slotA" ? "primary" : "secondary";
        dropWeaponFromSlot(activeSlot, [
          playerPosition.x,
          playerPosition.y,
          playerPosition.z,
        ]);
        emitPlayerSnapshot();
      }
    },
    [
      dropWeaponFromSlot,
      emitPlayerSnapshot,
      equipGroundWeaponToSlot,
      singleWeaponMode,
      syncWeaponAmmoFromInventory,
      isAmmoItemId,
      schedulePracticeAmmoRefill,
    ],
  );

  const handlePlayerSnapshot = useCallback((snapshot: PlayerSnapshot) => {
    latestControllerSnapshotRef.current = snapshot;
    emitPlayerSnapshot(snapshot);
  }, [emitPlayerSnapshot]);

  const handleTriggerChange = useCallback((firing: boolean) => {
    rifleFireIntentRef.current = firing;
    if (!firing) {
      weaponRef.current.setTriggerHeld(false);
    }
  }, []);

  const handleUserGesture = useCallback(() => {
    audioRef.current.ensureStarted();
  }, []);

  const handleGetWeaponEquipped = useCallback(() => {
    return weaponRef.current.isEquipped();
  }, []);

  const handleGetActiveWeapon = useCallback(() => {
    return weaponRef.current.getActiveWeapon();
  }, []);

  const handleGetIsWeaponBusy = useCallback(() => {
    const nowMs = performance.now();
    const weapon = weaponRef.current;
    return weapon.isReloading(nowMs) ||
      weapon.getSniperRechamberState(nowMs).active ||
      weapon.getSwitchState(nowMs).active;
  }, []);

  const targetCollisionCircles = useMemo(
    () =>
      targets
        .filter((target) => !target.disabled)
        .map((target) => {
          const [x, , z] = target.position;
          return {
            x,
            z,
            radius: target.radius,
          };
        }),
    [targets],
  );

  const controller = usePlayerController({
    collisionRects: [...practiceMap.collisionRects],
    collisionCircles: targetCollisionCircles,
    blockingVolumes: practiceMap.blockingVolumes,
    worldBounds: practiceMap.worldBounds,
    spawnPosition,
    groundLevelY: spawnPosition[1],
    walkableSurfaces: practiceMap.walkableSurfaces,
    spawnYaw,
    spawnPitch,
    sensitivity,
    controllerSettings,
    keybinds,
    crouchMode,
    inventoryOpenMode,
    fov,
    inputEnabled: presentation.inputEnabled,
    gameplayInputEnabled,
    cameraEnabled: presentation.phase === "playing",
    allowLean: !rawCharacterSandboxMode,
    onAction: handleAction,
    onPlayerSnapshot: handlePlayerSnapshot,
    onTriggerChange: handleTriggerChange,
    onUserGesture: handleUserGesture,
    getWeaponEquipped: handleGetWeaponEquipped,
    getActiveWeapon: handleGetActiveWeapon,
    getIsWeaponBusy: handleGetIsWeaponBusy,
    onPauseMenuToggle:
      presentation.phase === "playing" ? onPauseMenuToggle : undefined,
  });

  controllerRef.current = controller;

  const resetForMenu = useCallback(() => {
    audioRef.current.cancelReload();
    audioRef.current.cancelSniperShelling();
    weaponRef.current.reset();
    controllerRef.current?.setPose(
      spawnPositionVector,
      spawnYaw,
      spawnPitch,
    );
    setImpactMarks([]);
    setBloodSplats([]);
    impactIdRef.current = 0;
    bloodSplatIdRef.current = 0;
    lastImpactCleanupAtRef.current = performance.now();
    lastActiveWeaponRef.current = "rifle";
    lastADSRef.current = false;
    lastFirstPersonRef.current = false;
    lastSniperRechamberActiveRef.current = false;
    lastSniperRechamberProgressStepRef.current = 100;
    lastReloadActiveRef.current = false;
    lastReloadWeaponKindRef.current = null;
    lastHudSyncKeyRef.current = "";
    practiceAmmoRespawnAtRef.current = null;
    bulletHittableMeshesRef.current = [];
    bulletHittableMeshesDirtyRef.current = true;
    rifleFireIntentRef.current = false;
    rifleRunStateRef.current = "idle";
    rifleRunStateUntilRef.current = 0;
    rifleRunInputGraceUntilRef.current = 0;
    rifleRunHeadingYawRef.current = spawnYaw;
    crouchTransitionStateRef.current = "idle";
    crouchTransitionStartedAtRef.current = 0;
    crouchTransitionDurationRef.current = 0;
    crouchTransitionUseRifleRef.current = false;
    crouchTransitionPoseFromRef.current = 0;
    wasCrouchedRef.current = false;
    wasGroundedRef.current = true;
    slideIntentHookRef.current = {
      eligible: false,
      lastIntentAtMs: -1,
      lastIntentSpeed: 0,
      lastIntentYaw: 0,
      lastIntentMoveX: 0,
      lastIntentMoveY: 0,
    };
    locomotionVisualInputRef.current.set(0, 0);
    locomotionLocalVelocityRef.current.set(0, 0);
    directionChangeTrackedInputRef.current.set(0, 0);
    directionChangePauseUntilRef.current = 0;
    sprintStopRecoveryUntilRef.current = 0;
    skipDirectionChangeSnapRef.current = false;
    unarmedWalkStateRef.current = "idle";
    unarmedWalkStateUntilRef.current = 0;
    footstepPhaseRef.current = {
      cycle: 0,
      lastNormalizedTime: 0,
      state: null,
    };
    stepsBeforeSometimesRef.current = createSometimesStepWindow();
    lastCharacterAnimStateRef.current = "idle";
    controllerRef.current?.setRunFacing("off");
    controllerRef.current?.setMovementProfile({
      walkScale: 1,
      jogScale: 1,
      sprintScale: 1,
      allowSprint: true,
    });
    activeWeaponCallbackRef.current("rifle");
    sniperRechamberCallbackRef.current({
      active: false,
      progress: 1,
      remainingMs: 0,
    });
    aimingStateCallbackRef.current({
      ads: false,
      firstPerson: false,
    });
    inventoryRef.current.reset(runtimeGroundSpawns);
    ammoVisualRevisionRef.current = -1;
    setGroundAmmoVisualState(inventoryRef.current.getGroundAmmoVisualState());
    if (singleWeaponMode || practiceMap.spawnWithRifle) {
      if (!practiceMap.infiniteAmmo) {
        inventoryRef.current.grantStackInFirstBackpackSlot("ammo_rifle", 150);
      }
      const rifleSlotDefaults = weaponRef.current.getSlotStateForLoadout("slotA");
      const reserveAmmo = practiceMap.infiniteAmmo
        ? rifleSlotDefaults.maxReserveAmmo
        : inventoryRef.current.getAmmoTotalsByWeaponKind().rifle;
      weaponRef.current.equipSlotWithWeapon("slotA", "rifle", {
        magAmmo: 30,
        reserveAmmo,
        infiniteReserveAmmo: practiceMap.infiniteAmmo,
      });
      inventoryRef.current.setActiveQuickSlot("primary");
      lastWeaponEquippedRef.current = true;
      weaponEquippedCallbackRef.current(true);
    } else {
      lastWeaponEquippedRef.current = false;
      weaponEquippedCallbackRef.current(false);
    }
    latestControllerSnapshotRef.current = null;
  }, [
    practiceMap.infiniteAmmo,
    practiceMap.spawnWithRifle,
    runtimeGroundSpawns,
    singleWeaponMode,
    spawnPitch,
    spawnPosition,
    spawnPositionVector,
    spawnYaw,
  ]);

  const handleMoveInventoryItem = useCallback((
    request: InventoryMoveRequest,
  ): InventoryMoveResult => {
    const playerPosition = controllerRef.current?.getPosition();
    const playerTuple: [number, number, number] = playerPosition
      ? [playerPosition.x, playerPosition.y, playerPosition.z]
      : [...spawnPosition];

    if (request.to.zone === "equip" && request.to.slot === "primary") {
      if (request.from.zone !== "nearby") {
        return {
          ok: false,
          message: "Only nearby rifle items can fill Primary.",
        };
      }
      const result = equipGroundWeaponToSlot(
        request.from.id,
        "primary",
        playerTuple,
      );
      syncWeaponAmmoFromInventory();
      emitPlayerSnapshot();
      return result;
    }
    if (request.to.zone === "equip" && request.to.slot === "secondary") {
      if (singleWeaponMode) {
        return {
          ok: false,
          message: "Secondary weapon slot is disabled for this character.",
        };
      }
      if (request.from.zone !== "nearby") {
        return {
          ok: false,
          message: "Only nearby sniper items can fill Secondary.",
        };
      }
      const result = equipGroundWeaponToSlot(
        request.from.id,
        "secondary",
        playerTuple,
      );
      syncWeaponAmmoFromInventory();
      emitPlayerSnapshot();
      return result;
    }

    if (request.from.zone === "equip" && request.from.slot === "primary") {
      if (request.to.zone === "nearby") {
        const result = dropWeaponFromSlot("primary", playerTuple);
        emitPlayerSnapshot();
        return result;
      }
      return {
        ok: false,
        message: "Primary can only be dropped to ground in this build.",
      };
    }
    if (request.from.zone === "equip" && request.from.slot === "secondary") {
      if (singleWeaponMode) {
        return {
          ok: false,
          message: "Secondary weapon slot is disabled for this character.",
        };
      }
      if (request.to.zone === "nearby") {
        const result = dropWeaponFromSlot("secondary", playerTuple);
        emitPlayerSnapshot();
        return result;
      }
      return {
        ok: false,
        message: "Secondary can only be dropped to ground in this build.",
      };
    }

    const normalizedRequest = request.to.zone === "nearby" &&
        request.to.id !== INVENTORY_DROP_ZONE_NEARBY &&
        request.from.zone !== "nearby"
      ? {
        ...request,
        to: {
          zone: "nearby",
          id: INVENTORY_DROP_ZONE_NEARBY,
        } as const,
      }
      : request;

    const result = inventoryRef.current.moveItem(
      normalizedRequest,
      playerTuple,
      weaponRef.current.getLoadoutState(),
    );
    if (result.ok) {
      const sourceItemId = request.from.zone === "nearby"
        ? inventoryRef.current.getGroundItemId(request.from.id)
        : null;
      if (isAmmoItemId(sourceItemId)) {
        schedulePracticeAmmoRefill();
      }
      syncWeaponAmmoFromInventory();
      emitPlayerSnapshot();
    }
    return result;
  }, [
    dropWeaponFromSlot,
    emitPlayerSnapshot,
    equipGroundWeaponToSlot,
    syncWeaponAmmoFromInventory,
    isAmmoItemId,
    schedulePracticeAmmoRefill,
    singleWeaponMode,
    spawnPosition,
  ]);

  const handleQuickMoveInventoryItem = useCallback((
    location: InventoryMoveLocation,
  ): InventoryMoveResult => {
    const playerPosition = controllerRef.current?.getPosition();
    const playerTuple: [number, number, number] = playerPosition
      ? [playerPosition.x, playerPosition.y, playerPosition.z]
      : [...spawnPosition];

    if (location.zone === "equip" && location.slot === "primary") {
      const result = dropWeaponFromSlot("primary", playerTuple);
      emitPlayerSnapshot();
      return result;
    }
    if (location.zone === "equip" && location.slot === "secondary") {
      if (singleWeaponMode) {
        return {
          ok: false,
          message: "Secondary weapon slot is disabled for this character.",
        };
      }
      const result = dropWeaponFromSlot("secondary", playerTuple);
      emitPlayerSnapshot();
      return result;
    }

    if (location.zone === "nearby") {
      const itemId = inventoryRef.current.getGroundItemId(location.id);
      if (itemId === "weapon_rifle") {
        const result = equipGroundWeaponToSlot(
          location.id,
          "primary",
          playerTuple,
        );
        syncWeaponAmmoFromInventory();
        emitPlayerSnapshot();
        return result;
      }
      if (itemId === "weapon_sniper") {
        if (singleWeaponMode) {
          return {
            ok: false,
            message: "Secondary weapon slot is disabled for this character.",
          };
        }
        const result = equipGroundWeaponToSlot(
          location.id,
          "secondary",
          playerTuple,
        );
        syncWeaponAmmoFromInventory();
        emitPlayerSnapshot();
        return result;
      }
    }

    const movedItemId = location.zone === "nearby"
      ? inventoryRef.current.getGroundItemId(location.id)
      : null;

    const result = inventoryRef.current.quickMove(
      location,
      playerTuple,
      weaponRef.current.getLoadoutState(),
    );
    if (result.ok) {
      if (isAmmoItemId(movedItemId)) {
        schedulePracticeAmmoRefill();
      }
      syncWeaponAmmoFromInventory();
      emitPlayerSnapshot();
    }
    return result;
  }, [
    dropWeaponFromSlot,
    emitPlayerSnapshot,
    equipGroundWeaponToSlot,
    syncWeaponAmmoFromInventory,
    isAmmoItemId,
    schedulePracticeAmmoRefill,
    singleWeaponMode,
    spawnPosition,
  ]);

  useEffect(() => {
    resetForMenu();
  }, [practiceMap.id, resetForMenu]);

  useImperativeHandle(ref, () => ({
    requestPointerLock: () => {
      controllerRef.current?.requestPointerLock();
    },
    releasePointerLock: () => {
      controllerRef.current?.releasePointerLock();
    },
    dropWeaponForReturn: () => {
      const playerPosition = controllerRef.current?.getPosition();
      if (!playerPosition) {
        return;
      }
      const activeSlot = weaponRef.current.getActiveSlotId() === "slotA"
        ? "primary"
        : "secondary";
      dropWeaponFromSlot(activeSlot, [
        playerPosition.x,
        playerPosition.y,
        playerPosition.z,
      ]);
    },
    moveInventoryItem: (request) => {
      return handleMoveInventoryItem(request);
    },
    quickMoveInventoryItem: (location) => {
      return handleQuickMoveInventoryItem(location);
    },
    resetForMenu,
  }), [
    dropWeaponFromSlot,
    handleMoveInventoryItem,
    handleQuickMoveInventoryItem,
    resetForMenu,
  ]);

  useEffect(() => {
    if (lastPhaseRef.current === presentation.phase) {
      return;
    }
    if (presentation.phase === "returning") {
      returningFreezePosRef.current.copy(camera.position);
      camera.getWorldDirection(tempLookDirRef.current);
      returningFreezeLookRef.current
        .copy(camera.position)
        .addScaledVector(tempLookDirRef.current, 24);
    }
    lastPhaseRef.current = presentation.phase;
  }, [camera, presentation.phase]);

  useFrame((_, delta) => {
    const clampedDelta = Math.min(delta, 1 / 20);
    const nowMs = performance.now();
    const practiceAmmoRespawnAt = practiceAmmoRespawnAtRef.current;
    if (
      practiceAmmoRespawnAt !== null &&
      nowMs >= practiceAmmoRespawnAt
    ) {
      practiceAmmoRespawnAtRef.current = null;
      applyScheduledPracticeAmmoRefill();
    }
    const weapon = weaponRef.current;
    weapon.setAttachmentRuntimeModifiers(
      inventoryRef.current.getAttachmentModifiers(),
    );
    const audio = audioRef.current;
    const activeWeaponKind = weapon.getActiveWeapon();
    const movementSettings = movementSettingsRef.current;
    const rifleWalkSpeedScale = Math.max(
      0.2,
      movementSettings.rifleWalkSpeedScale,
    );
    const rifleJogSpeedScale = Math.max(
      0.2,
      movementSettings.rifleJogSpeedScale,
    );
    const rifleRunSpeedScale = Math.max(
      0.2,
      movementSettings.rifleRunSpeedScale,
    );
    const rifleFirePrepSpeedScale = Math.max(
      0.1,
      movementSettings.rifleFirePrepSpeedScale,
    );
    const crouchSpeedScale = THREE.MathUtils.clamp(
      movementSettings.crouchSpeedScale,
      0.2,
      1.2,
    );
    const rifleRunForwardThreshold = THREE.MathUtils.clamp(
      movementSettings.rifleRunForwardThreshold,
      0.05,
      1,
    );
    const rifleRunLateralThreshold = THREE.MathUtils.clamp(
      movementSettings.rifleRunLateralThreshold,
      0,
      1,
    );

    if (
      nowMs - lastImpactCleanupAtRef.current >=
        BULLET_IMPACT_CLEANUP_INTERVAL_MS
    ) {
      lastImpactCleanupAtRef.current = nowMs;
      setImpactMarks((previous) => {
        const alive = previous.filter((mark) => mark.expiresAt > nowMs);
        return alive.length === previous.length ? previous : alive;
      });
      setBloodSplats((previous) => {
        const alive = previous.filter((splat) => splat.expiresAt > nowMs);
        return alive.length === previous.length ? previous : alive;
      });
    }

    const sniperRechamber = weapon.getSniperRechamberState(nowMs);
    const sniperRechamberProgressStep = Math.floor(
      sniperRechamber.progress * 100,
    );
    const previousSniperRechamberActive = lastSniperRechamberActiveRef.current;
    if (
      previousSniperRechamberActive !== sniperRechamber.active ||
      lastSniperRechamberProgressStepRef.current !==
        sniperRechamberProgressStep
    ) {
      lastSniperRechamberActiveRef.current = sniperRechamber.active;
      lastSniperRechamberProgressStepRef.current = sniperRechamberProgressStep;
      sniperRechamberCallbackRef.current(sniperRechamber);
      if (
        !previousSniperRechamberActive &&
        sniperRechamber.active &&
        activeWeaponKind === "sniper"
      ) {
        audio.playSniperShelling();
      } else if (
        previousSniperRechamberActive &&
        (!sniperRechamber.active || activeWeaponKind !== "sniper")
      ) {
        audio.cancelSniperShelling();
      }
    }

    const grounded = controller.isGrounded();
    const moving = controller.isMoving() && grounded;
    const sprinting = controller.isSprinting();
    const sprintPressed = controller.isSprintPressed();
    const walkPressed = controller.isWalkPressed();
    const movementTier = controller.getMovementTier();
    const crouched = controller.isCrouched();
    const weaponEquipped = weapon.isEquipped();
    const weaponReload = weapon.getReloadState(nowMs);
    const reloadVisible = weaponReload.active &&
      weaponReload.weaponKind !== null &&
      weaponEquipped &&
      activeWeaponKind === weaponReload.weaponKind;
    const reloadDurationSeconds = reloadVisible
      ? resolveStateDurationSeconds(
        weaponReload.progress,
        weaponReload.remainingMs,
      )
      : undefined;
    const previousReloadActive = lastReloadActiveRef.current;
    const previousReloadWeaponKind = lastReloadWeaponKindRef.current;
    if (
      reloadVisible &&
      weaponReload.weaponKind &&
      (!previousReloadActive ||
        previousReloadWeaponKind !== weaponReload.weaponKind)
    ) {
      audio.playReload(weaponReload.weaponKind, reloadDurationSeconds);
    } else if (previousReloadActive && !reloadVisible) {
      audio.cancelReload();
    }
    lastReloadActiveRef.current = reloadVisible;
    lastReloadWeaponKindRef.current = reloadVisible
      ? weaponReload.weaponKind
      : null;
    const adsActive = controller.isADS();
    const firstPerson = controller.isFirstPerson();
    const moveInput = controller.getMoveInput();
    const planarVelocity = controller.getPlanarVelocity();
    const planarSpeed = controller.getPlanarSpeed();
    const localPlanarVelocity = resolveLocalPlanarVector(
      locomotionLocalVelocityRef.current,
      planarVelocity.x,
      planarVelocity.y,
      controller.getAimYaw(),
    );
    const moveX = moveInput.x;
    const moveY = moveInput.y;
    const meaningfulDirectionInput =
      moveX * moveX + moveY * moveY >=
        DIRECTION_CHANGE_MIN_INPUT_LENGTH * DIRECTION_CHANGE_MIN_INPUT_LENGTH;
    const hasDirectionalInput = Math.abs(moveX) > 0.05 ||
      Math.abs(moveY) > 0.05;
    const movementActive = grounded && (moving || hasDirectionalInput);
    const isWeaponHoldEquipped = weaponEquipped;
    const previousRunState = rifleRunStateRef.current;
    const previousCrouched = wasCrouchedRef.current;
    const crouchEntered = crouched && !previousCrouched;
    const crouchExited = !crouched && previousCrouched;
    wasCrouchedRef.current = crouched;
    const previousGrounded = wasGroundedRef.current;
    const justLanded = grounded && !previousGrounded;
    wasGroundedRef.current = grounded;
    if (justLanded) {
      audio.playLanding();
    }
    const slideIntent = slideIntentHookRef.current;
    slideIntent.eligible = isWeaponHoldEquipped &&
      !adsActive &&
      movementActive &&
      grounded &&
      moveY > rifleRunForwardThreshold &&
      Math.abs(moveX) <= rifleRunLateralThreshold &&
      (
        previousRunState === "start" ||
        previousRunState === "running" ||
        sprintPressed
      );
    if (crouchEntered && slideIntent.eligible) {
      slideIntent.lastIntentAtMs = nowMs;
      slideIntent.lastIntentSpeed = planarSpeed;
      slideIntent.lastIntentYaw = controller.getBodyYaw();
      slideIntent.lastIntentMoveX = moveX;
      slideIntent.lastIntentMoveY = moveY;
    }

    let crouchTransitionState = crouchTransitionStateRef.current;
    let crouchTransitionStartedAt = crouchTransitionStartedAtRef.current;
    let crouchTransitionDuration = crouchTransitionDurationRef.current;
    let crouchTransitionUseRifle = crouchTransitionUseRifleRef.current;
    let crouchTransitionPoseFrom = crouchTransitionPoseFromRef.current;
    let crouchTransitionSeekNormalized: number | undefined;
    let currentCrouchPose = previousCrouched ? 1 : 0;

    if (
      crouchTransitionState !== "idle" &&
      crouchTransitionDuration > 0
    ) {
      const targetPose = resolveCrouchTransitionTargetPose(
        crouchTransitionState,
      );
      const progress = clamp01(
        (nowMs - crouchTransitionStartedAt) / crouchTransitionDuration,
      );
      currentCrouchPose = THREE.MathUtils.lerp(
        crouchTransitionPoseFrom,
        targetPose,
        progress,
      );
      if (progress >= 1) {
        crouchTransitionState = "idle";
        crouchTransitionStartedAt = 0;
        crouchTransitionDuration = 0;
        crouchTransitionPoseFrom = targetPose;
        currentCrouchPose = targetPose;
      }
    }

    const startCrouchTransition = (
      nextState: Exclude<CrouchTransitionState, "idle">,
      fromPose: number,
    ) => {
      const targetPose = resolveCrouchTransitionTargetPose(nextState);
      const remainingDistance = Math.abs(targetPose - fromPose);
      if (remainingDistance <= 0.001) {
        crouchTransitionState = "idle";
        crouchTransitionStartedAt = 0;
        crouchTransitionDuration = 0;
        crouchTransitionPoseFrom = targetPose;
        currentCrouchPose = targetPose;
        return;
      }
      crouchTransitionState = nextState;
      crouchTransitionUseRifle = weaponEquipped;
      crouchTransitionStartedAt = nowMs;
      crouchTransitionDuration = (
        nextState === "enter"
          ? CROUCH_ENTER_TRANSITION_MS
          : CROUCH_TRANSITION_MS
      ) * remainingDistance;
      crouchTransitionPoseFrom = fromPose;
      currentCrouchPose = fromPose;
      crouchTransitionSeekNormalized = nextState === "enter"
        ? fromPose
        : 1 - fromPose;
    };

    const crouchKeyStillHeld = controller.isCrouchKeyHeld();
    const suppressCrouchExit =
      crouchExited && crouchKeyStillHeld && crouchMode === "hold";
    if ((crouchEntered || crouchExited) && !suppressCrouchExit) {
      const requestedState: Exclude<CrouchTransitionState, "idle"> =
        crouchEntered ? "enter" : "exit";
      const requestedPose = resolveCrouchTransitionTargetPose(requestedState);
      if (Math.abs(currentCrouchPose - requestedPose) <= 0.001) {
        crouchTransitionState = "idle";
        crouchTransitionStartedAt = 0;
        crouchTransitionDuration = 0;
        crouchTransitionPoseFrom = requestedPose;
      } else if (
        crouchTransitionState === "idle" ||
        crouchTransitionState !== requestedState
      ) {
        startCrouchTransition(requestedState, currentCrouchPose);
        if (requestedState === "enter") {
          audio.playCrouchEnter();
        }
      }
    }
    crouchTransitionStateRef.current = crouchTransitionState;
    crouchTransitionStartedAtRef.current = crouchTransitionStartedAt;
    crouchTransitionDurationRef.current = crouchTransitionDuration;
    crouchTransitionUseRifleRef.current = crouchTransitionUseRifle;
    crouchTransitionPoseFromRef.current = crouchTransitionPoseFrom;

    const activeQuickSlot = inventoryRef.current.getActiveQuickSlot();
    const weaponControlEnabled = activeQuickSlot === "primary" ||
      activeQuickSlot === "secondary";
    const fireInputHeld = weaponControlEnabled && rifleFireIntentRef.current;
    const preUpdateFireState = weapon.getFireState(nowMs);
    const fireAnimationIntent = fireInputHeld &&
      preUpdateFireState.reason === "none";
    const firePrepIntent = isWeaponHoldEquipped &&
      !adsActive &&
      !crouched &&
      fireAnimationIntent;
    const firePrepVisual = firePrepIntent && !movementActive;
    const crouchAimCompositeActive = isWeaponHoldEquipped &&
      fireAnimationIntent &&
      !adsActive &&
      (crouched || crouchTransitionState !== "idle");
    const movementHeadingYaw = resolveMovementHeadingYaw(
      controller.getAimYaw(),
      moveX,
      moveY,
      rifleRunHeadingYawRef.current,
    );

    let runState: RifleRunVisualState;
    let unarmedWalkState = unarmedWalkStateRef.current;
    let unarmedWalkUntil = unarmedWalkStateUntilRef.current;

    if (!isWeaponHoldEquipped || adsActive || crouched) {
      runState = "idle";
      rifleRunStateRef.current = "idle";
      rifleRunStateUntilRef.current = 0;
      rifleRunInputGraceUntilRef.current = 0;
      rifleRunHeadingYawRef.current = controller.getBodyYaw();
      if (!isWeaponHoldEquipped && !crouched) {
        if (!movementActive) {
          if (
            unarmedWalkState === "start" ||
            unarmedWalkState === "moving"
          ) {
            unarmedWalkState = "stop";
            unarmedWalkUntil = nowMs + UNARMED_WALK_STOP_MS;
          } else if (
            unarmedWalkState === "stop" &&
            nowMs >= unarmedWalkUntil
          ) {
            unarmedWalkState = "idle";
            unarmedWalkUntil = 0;
          }
        } else if (
          unarmedWalkState === "idle" ||
          unarmedWalkState === "stop"
        ) {
          unarmedWalkState = "start";
          unarmedWalkUntil = nowMs + UNARMED_WALK_START_MS;
        } else if (
          unarmedWalkState === "start" &&
          nowMs >= unarmedWalkUntil
        ) {
          unarmedWalkState = "moving";
          unarmedWalkUntil = 0;
        }
      } else {
        unarmedWalkState = "idle";
        unarmedWalkUntil = 0;
      }

      rifleRunStateRef.current = "idle";
      rifleRunStateUntilRef.current = 0;
    } else {
      let nextRunState = rifleRunStateRef.current;
      let runStateUntil = rifleRunStateUntilRef.current;
      const runInputActive = shouldUseRifleRunInput(
        movementActive,
        sprintPressed,
        moveX,
        moveY,
      ) && !firePrepIntent;
      if (runInputActive) {
        rifleRunInputGraceUntilRef.current = nowMs + RIFLE_RUN_INPUT_GRACE_MS;
      }
      const runInputAllowed = !firePrepIntent &&
        (
          runInputActive ||
          (
            nextRunState !== "idle" &&
            nowMs < rifleRunInputGraceUntilRef.current
          )
        );
      const runStartDurationMs = RIFLE_RUN_START_MS;
      const runStopDurationMs = RIFLE_RUN_STOP_MS;

      if (!runInputAllowed) {
        if (
          nextRunState === "start" ||
          nextRunState === "running"
        ) {
          nextRunState = "stop";
          runStateUntil = nowMs + runStopDurationMs;
        } else if (nextRunState === "stop" && nowMs >= runStateUntil) {
          nextRunState = "idle";
          runStateUntil = 0;
        }
      } else if (nextRunState === "idle") {
        nextRunState = "start";
        runStateUntil = nowMs + runStartDurationMs;
        rifleRunHeadingYawRef.current = movementHeadingYaw;
      } else if (
        nextRunState === "start" &&
        nowMs >= runStateUntil
      ) {
        nextRunState = "running";
        runStateUntil = 0;
      } else if (
        nextRunState === "stop" &&
        nowMs >= runStateUntil &&
        runInputActive
      ) {
        nextRunState = "start";
        runStateUntil = nowMs + runStartDurationMs;
        rifleRunHeadingYawRef.current = movementHeadingYaw;
      }

      if (nextRunState === "running" && movementActive) {
        rifleRunHeadingYawRef.current = movementHeadingYaw;
      }

      if (nextRunState === "stop" && nowMs >= runStateUntil) {
        nextRunState = "idle";
        runStateUntil = 0;
      }

      runState = nextRunState;
      rifleRunStateRef.current = nextRunState;
      rifleRunStateUntilRef.current = runStateUntil;

      unarmedWalkState = "idle";
      unarmedWalkUntil = 0;
    }

    unarmedWalkStateRef.current = unarmedWalkState;
    unarmedWalkStateUntilRef.current = unarmedWalkUntil;
    const runFacingPhase: RunFacingPhase = runState === "start" ||
        runState === "running" ||
        runState === "stop"
      ? runState
      : "off";
    if (runFacingPhase === "off") {
      controller.setRunFacing("off");
    } else {
      controller.setRunFacing(runFacingPhase, rifleRunHeadingYawRef.current);
    }

    let sprintStopRecoveryUntil = sprintStopRecoveryUntilRef.current;
    if (previousRunState === "stop" && runState === "idle") {
      sprintStopRecoveryUntil = nowMs + SPRINT_STOP_RECOVERY_MS;
    }

    let directionChangePauseUntil = directionChangePauseUntilRef.current;
    let skipDirectionChangeSnap = skipDirectionChangeSnapRef.current;
    const trackedDirectionInput = directionChangeTrackedInputRef.current;
    const standingRifleDirectionPauseEligible =
      isStandingRifleDirectionPauseEligible(
        grounded,
        moving,
        hasDirectionalInput,
        meaningfulDirectionInput,
        isWeaponHoldEquipped,
        adsActive,
        crouched,
        crouchTransitionState,
        firePrepIntent,
        runState,
      );
    const directionChangePauseWasActive = directionChangePauseUntil > nowMs;
    const phase2RecoveryActive = nowMs < sprintStopRecoveryUntil;

    if (!standingRifleDirectionPauseEligible) {
      trackedDirectionInput.set(0, 0);
      directionChangePauseUntil = 0;
      sprintStopRecoveryUntil = 0;
      skipDirectionChangeSnap = false;
    } else {
      if (!directionChangePauseWasActive && directionChangePauseUntil > 0) {
        directionChangePauseUntil = 0;
        skipDirectionChangeSnap = true;
      }

      if (meaningfulDirectionInput) {
        if (directionChangePauseWasActive || phase2RecoveryActive) {
          trackedDirectionInput.set(moveX, moveY);
        } else if (trackedDirectionInput.lengthSq() > 0.0001) {
          const angleDelta = computeInputAngleDelta(
            trackedDirectionInput,
            moveInput,
          );
          trackedDirectionInput.set(moveX, moveY);
          if (angleDelta > DIRECTION_CHANGE_THRESHOLD_RAD) {
            directionChangePauseUntil = nowMs + DIRECTION_CHANGE_PAUSE_MS;
            skipDirectionChangeSnap = false;
          }
        } else {
          trackedDirectionInput.set(moveX, moveY);
        }
      } else {
        trackedDirectionInput.set(0, 0);
      }
    }

    const directionChangePauseActive = standingRifleDirectionPauseEligible &&
      !phase2RecoveryActive &&
      directionChangePauseUntil > nowMs;
    const visualLocomotionInput = updateVisualLocomotionInput(
      locomotionVisualInputRef.current,
      movementActive,
      moveX,
      moveY,
      localPlanarVelocity.x,
      localPlanarVelocity.y,
      planarSpeed,
      clampedDelta,
      {
        pauseActive: directionChangePauseActive,
        pauseDampRate: DIRECTION_CHANGE_DAMP_RATE,
        skipSnapFromZero: skipDirectionChangeSnap,
      },
    );
    if (skipDirectionChangeSnap && !directionChangePauseActive) {
      skipDirectionChangeSnap = false;
    }
    directionChangePauseUntilRef.current = directionChangePauseUntil;
    sprintStopRecoveryUntilRef.current = sprintStopRecoveryUntil;
    skipDirectionChangeSnapRef.current = skipDirectionChangeSnap;
    const animMoveX = visualLocomotionInput.x;
    const animMoveY = visualLocomotionInput.y;

    const useUnarmedWalkLocomotion = !weaponEquipped &&
      movementTier !== "run";

    let nextAnimState: CharacterAnimState = weaponEquipped
      ? "rifleAimHold"
      : "idle";
    let lowerBodyOverlayState: CharacterAnimState | null = null;
    let upperBodyOverlayState: CharacterAnimState | null = null;
    if (crouchTransitionState === "enter") {
      nextAnimState = crouchAimCompositeActive
        ? "rifleAimHold"
        : crouchTransitionUseRifle
        ? "rifleCrouchEnter"
        : "crouchEnter";
      lowerBodyOverlayState = crouchAimCompositeActive ? "crouchEnter" : null;
    } else if (crouchTransitionState === "exit") {
      nextAnimState = crouchAimCompositeActive
        ? "rifleAimHold"
        : crouchTransitionUseRifle
        ? "rifleCrouchExit"
        : "crouchExit";
      lowerBodyOverlayState = crouchAimCompositeActive ? "crouchExit" : null;
    } else if (crouched) {
      if (weaponEquipped) {
        if (crouchAimCompositeActive) {
          nextAnimState = movementActive
            ? resolveRifleAimWalkState(animMoveX, animMoveY)
            : "rifleAimHold";
          lowerBodyOverlayState = movementActive
            ? resolveCrouchState(animMoveX, animMoveY)
            : "crouchIdle";
        } else {
          nextAnimState = movementActive
            ? resolveCrouchState(animMoveX, animMoveY)
            : "crouchIdle";
          upperBodyOverlayState = movementActive
            ? "rifleCrouchWalk"
            : "rifleCrouchIdle";
        }
      } else {
        nextAnimState = movementActive
          ? resolveCrouchState(moveX, moveY)
          : "crouchIdle";
      }
    } else if (movementActive) {
      if (!weaponEquipped) {
        if (movementTier === "run") {
          nextAnimState = "sprint";
        } else if (unarmedWalkState === "start") {
          nextAnimState = "walkStart";
        } else if (unarmedWalkState === "stop") {
          nextAnimState = "walkStop";
        } else {
          nextAnimState = stabilizeLateralTransition(
            resolveWalkState(animMoveX, animMoveY, {
              useForwardDiagonalClip: useUnarmedWalkLocomotion ||
                movementTier === "walk",
            }),
            lastCharacterAnimStateRef.current,
            moveX,
            moveY,
            animMoveX,
            animMoveY,
            "walkLeft",
            "walkRight",
          );
        }
      } else if (isWeaponHoldEquipped && firePrepIntent) {
        nextAnimState = resolveRifleAimWalkState(animMoveX, animMoveY);
      } else if (isWeaponHoldEquipped && !adsActive) {
        if (runState === "start") {
          nextAnimState = "rifleRunStart";
        } else if (runState === "running") {
          nextAnimState = "rifleRun";
        } else if (runState === "stop") {
          nextAnimState = "rifleRunStop";
        } else if (directionChangePauseActive) {
          nextAnimState = "rifleJog";
        } else if (walkPressed) {
          nextAnimState = stabilizeLateralTransition(
            resolveRifleWalkState(animMoveX, animMoveY),
            lastCharacterAnimStateRef.current,
            moveX,
            moveY,
            animMoveX,
            animMoveY,
            "rifleWalkLeft",
            "rifleWalkRight",
          );
        } else {
          nextAnimState = stabilizeLateralTransition(
            resolveRifleJogState(animMoveX, animMoveY),
            lastCharacterAnimStateRef.current,
            moveX,
            moveY,
            animMoveX,
            animMoveY,
            "rifleJogLeft",
            "rifleJogRight",
          );
        }
      } else if (movementTier === "run") {
        nextAnimState = "sprint";
      } else if (Math.abs(animMoveY) >= Math.abs(animMoveX)) {
        nextAnimState = animMoveY >= 0
          ? (weaponEquipped ? "rifleWalk" : "walk")
          : (weaponEquipped ? "rifleWalkBack" : "walkBack");
      } else if (animMoveX >= 0) {
        nextAnimState = weaponEquipped ? "rifleWalkRight" : "walkRight";
      } else {
        nextAnimState = weaponEquipped ? "rifleWalkLeft" : "walkLeft";
      }
    } else if (firePrepVisual) {
      nextAnimState = weaponEquipped ? "rifleAimHold" : "idle";
    }

    // Rifle ready-pose: blend rifleAimHold upper body during standing rifle locomotion
    // so the weapon is raised to a ready position (like PUBG/Apex).
    let rifleReadyPoseActive = false;
    // Excludes: running (weapon lowered), fire prep (already aiming),
    //           crouch (has own overlay), aim-walk (already raised).
    if (
      isWeaponHoldEquipped &&
      !firePrepVisual &&
      !crouched &&
      crouchTransitionState === "idle" &&
      upperBodyOverlayState === null
    ) {
      const isRunState = nextAnimState === "rifleRun" ||
        nextAnimState === "rifleRunStart" ||
        nextAnimState === "rifleRunStop";
      const isAimState = nextAnimState === "rifleAimHold" ||
        (nextAnimState as string).startsWith("rifleAimWalk");
      if (!isRunState && !isAimState) {
        upperBodyOverlayState = "rifleAimHold";
        rifleReadyPoseActive = true;
      }
    }

    const embeddedFireLoopActive = singleWeaponMode &&
      isWeaponHoldEquipped &&
      fireAnimationIntent &&
      !reloadVisible &&
      presentation.phase === "playing";
    if (embeddedFireLoopActive) {
      upperBodyOverlayState = "rifleReload";
      rifleReadyPoseActive = false;
    }

    if (reloadVisible) {
      if (lowerBodyOverlayState) {
        nextAnimState = lowerBodyOverlayState;
        lowerBodyOverlayState = null;
      }
      upperBodyOverlayState = "rifleReload";
      rifleReadyPoseActive = false;
    }

    if (presentation.phase === "menu") {
      nextAnimState = "rifleIdle";
      lowerBodyOverlayState = null;
      upperBodyOverlayState = null;
      rifleReadyPoseActive = false;
    }

    const triggerHeldForWeapon = fireInputHeld;
    weapon.setTriggerHeld(triggerHeldForWeapon);

    const crouchPose = crouchTransitionState !== "idle"
      ? currentCrouchPose
      : crouched
      ? 1
      : 0;
    const crouchAimCompositePose = crouchAimCompositeActive ? crouchPose : 0;
    const standingWalkScale = !weaponEquipped
      ? UNARMED_WALK_SPEED_SCALE
      : firePrepIntent
      ? rifleFirePrepSpeedScale
      : rifleWalkSpeedScale;
    const standingJogScale = !weaponEquipped
      ? 1
      : firePrepIntent
      ? rifleFirePrepSpeedScale
      : rifleJogSpeedScale;
    const standingRunScale = !weaponEquipped
      ? 1
      : firePrepIntent
      ? rifleFirePrepSpeedScale
      : rifleRunSpeedScale;
    const movementProfileWalkScale = THREE.MathUtils.lerp(
      standingWalkScale,
      crouchSpeedScale,
      crouchPose,
    );
    const movementProfileJogScale = THREE.MathUtils.lerp(
      standingJogScale,
      crouchSpeedScale,
      crouchPose,
    );
    const baseRunScale = THREE.MathUtils.lerp(
      standingRunScale,
      crouchSpeedScale,
      crouchPose,
    );
    const runStopFactor = runState === "stop"
      ? 1 -
        clamp01(
          (nowMs - (rifleRunStateUntilRef.current - RIFLE_RUN_STOP_MS)) /
            RIFLE_RUN_STOP_MS,
        )
      : 1;
    const movementProfileRunScale = baseRunScale * runStopFactor;
    const movementProfileAllowSprint = !adsActive &&
      !firePrepIntent &&
      crouchPose < CROUCH_SPRINT_RELEASE_POSE &&
      runState !== "stop";
    controller.setMovementProfile({
      walkScale: movementProfileWalkScale,
      jogScale: movementProfileJogScale,
      sprintScale: movementProfileRunScale,
      allowSprint: movementProfileAllowSprint,
    });

    const rifleLocomotionState = nextAnimState.startsWith("rifleWalk") ||
      nextAnimState.startsWith("rifleJog") ||
      nextAnimState === "rifleRun" ||
      nextAnimState === "rifleRunStart" ||
      nextAnimState === "rifleRunStop";
    const unarmedSharedLocomotionState = nextAnimState === "walk" ||
      nextAnimState === "walkBack" ||
      nextAnimState === "walkLeft" ||
      nextAnimState === "walkRight" ||
      nextAnimState === "walkForwardLeft" ||
      nextAnimState === "walkForwardRight" ||
      nextAnimState === "walkBackwardLeft" ||
      nextAnimState === "walkBackwardRight";
    const runVisualState = nextAnimState === "rifleRun" ||
      nextAnimState === "rifleRunStart" ||
      nextAnimState === "rifleRunStop";
    const directionChangePauseNeutralJog = directionChangePauseActive &&
      nextAnimState === "rifleJog";
    const locomotionReferenceSpeed = runVisualState
      ? PLAYER_SPRINT_SPEED * movementProfileRunScale
      : PLAYER_WALK_SPEED * (
        !weaponEquipped && useUnarmedWalkLocomotion
          ? movementProfileJogScale
          : directionChangePauseNeutralJog
          ? movementProfileJogScale
          : movementTier === "walk"
          ? movementProfileWalkScale
          : movementProfileJogScale
      );
    const characterLocomotionScale =
      rifleLocomotionState || unarmedSharedLocomotionState
        ? THREE.MathUtils.clamp(
          controller.getPlanarSpeed() /
            Math.max(0.01, locomotionReferenceSpeed),
          RIFLE_LOCOMOTION_SCALE_MIN,
          RIFLE_LOCOMOTION_SCALE_MAX,
        )
        : 1;
    const lowerBodyOverlayLocomotionScale = lowerBodyOverlayState &&
        (
          lowerBodyOverlayState.startsWith("crouch") ||
          lowerBodyOverlayState.startsWith("rifleCrouch")
        )
      ? THREE.MathUtils.clamp(
        controller.getPlanarSpeed() /
          Math.max(0.01, PLAYER_WALK_SPEED * movementProfileWalkScale),
        RIFLE_LOCOMOTION_SCALE_MIN,
        RIFLE_LOCOMOTION_SCALE_MAX,
      )
      : 1;
    const audioAnimState = lowerBodyOverlayState ?? nextAnimState;

    setCharacterAnim(nextAnimState, {
      locomotionScale: characterLocomotionScale,
      seekNormalizedTime: crouchTransitionSeekNormalized,
      desiredDurationSeconds:
        nextAnimState === "crouchEnter" || nextAnimState === "rifleCrouchEnter"
          ? CROUCH_ENTER_TRANSITION_MS / 1000
          : undefined,
      fadeDurationSeconds:
        nextAnimState === "crouchEnter" || nextAnimState === "rifleCrouchEnter"
          ? CROUCH_ENTER_BLEND_SECONDS
          : undefined,
      lowerBodyState: lowerBodyOverlayState,
      lowerBodyLocomotionScale: lowerBodyOverlayLocomotionScale,
      lowerBodySeekNormalizedTime: crouchTransitionSeekNormalized,
      lowerBodyDesiredDurationSeconds: lowerBodyOverlayState === "crouchEnter"
        ? CROUCH_ENTER_TRANSITION_MS / 1000
        : undefined,
      lowerBodyFadeDurationSeconds: lowerBodyOverlayState === "crouchEnter"
        ? CROUCH_ENTER_BLEND_SECONDS
        : 0.12,
      upperBodyState: upperBodyOverlayState,
      upperBodyLoopMode: reloadVisible
        ? "once"
        : embeddedFireLoopActive
        ? "repeat"
        : undefined,
      upperBodyLocomotionScale: characterLocomotionScale,
      upperBodySeekNormalizedTime: reloadVisible
        ? weaponReload.progress
        : undefined,
      upperBodyDesiredDurationSeconds: reloadVisible
        ? reloadDurationSeconds
        : undefined,
      upperBodyFadeDurationSeconds: reloadVisible
        ? 0.08
        : embeddedFireLoopActive
        ? 0.06
        : undefined,
    });
    lastCharacterAnimStateRef.current = nextAnimState;
    const footstepPlaybackRate = resolveFootstepPlaybackRate(
      audioAnimState,
      {
        locomotionScale: lowerBodyOverlayState
          ? lowerBodyOverlayLocomotionScale
          : characterLocomotionScale,
      },
    );

    if (
      lastADSRef.current !== adsActive ||
      lastFirstPersonRef.current !== firstPerson
    ) {
      lastADSRef.current = adsActive;
      lastFirstPersonRef.current = firstPerson;
      aimingStateCallbackRef.current({
        ads: adsActive,
        firstPerson,
      });
    }

    const viewLerp = controller.getViewModeLerp();
    const firstPersonBodyMaskBlend = presentation.phase === "playing"
      ? THREE.MathUtils.smoothstep(viewLerp, 0.68, 0.9)
      : 0;
    const downLookAmount = THREE.MathUtils.smoothstep(
      -controller.getPitch(),
      0.58,
      1.04,
    );
    const adsLerp = controller.getAdsLerp();
    const shoeVisibility = firstPersonBodyMaskBlend *
      downLookAmount *
      (controller.isGrounded() ? 1 : 0);
    // During ADS, fade out gloves so they don't float detached from the weapon
    const gloveVisibility = firstPersonBodyMaskBlend *
      THREE.MathUtils.lerp(1, 0.88, downLookAmount) *
      (1 - adsLerp);
    applyCharacterFirstPersonMask(
      characterVisibilityMaterialsRef.current,
      firstPersonBodyMaskBlend,
      gloveVisibility,
      shoeVisibility,
    );

    const playerChar = playerCharacterRef.current;
    if (playerChar) {
      const position = controller.getPosition();
      playerChar.position.set(position.x, position.y, position.z);
      playerChar.rotation.y = controller.getBodyYaw() + CHARACTER_YAW_OFFSET;
      playerChar.visible = true;
      playerChar.updateMatrixWorld(true);
    }

    if (characterModel) {
      const headBone = characterHeadBoneRef.current;
      const headBaseQuat = characterHeadBaseQuatRef.current;
      if (headBone && headBaseQuat) {
        headBone.quaternion.copy(headBaseQuat);
      }
      const upperTorsoBone = characterUpperTorsoBoneRef.current;
      const upperTorsoBaseQuat = characterUpperTorsoBaseQuatRef.current;
      if (upperTorsoBone && upperTorsoBaseQuat) {
        upperTorsoBone.quaternion.copy(upperTorsoBaseQuat);
      }
      const lowerTorsoBone = characterLowerTorsoBoneRef.current;
      const lowerTorsoBaseQuat = characterLowerTorsoBaseQuatRef.current;
      if (lowerTorsoBone && lowerTorsoBaseQuat) {
        lowerTorsoBone.quaternion.copy(lowerTorsoBaseQuat);
      }
      const mixer = characterModel.userData.__mixer as
        | THREE.AnimationMixer
        | undefined;
      if (mixer) {
        mixer.update(clampedDelta);
      }
      const footstepTrigger = consumeFootstepTrigger(
        footstepPhaseRef.current,
        getFootstepSample(),
      );
      if (footstepTrigger?.kind === "reset") {
        stepsBeforeSometimesRef.current = createSometimesStepWindow();
      } else if (footstepTrigger?.kind === "step") {
        const footstepVariant = stepsBeforeSometimesRef.current <= 0
          ? "sometimes"
          : footstepTrigger.foot;
        if (footstepVariant === "sometimes") {
          stepsBeforeSometimesRef.current = createSometimesStepWindow();
        } else {
          stepsBeforeSometimesRef.current -= 1;
        }
        audio.playFootstep(footstepVariant, footstepPlaybackRate);
      }
      if (headBone) {
        if (!characterHeadBaseQuatRef.current) {
          characterHeadBaseQuatRef.current = headBone.quaternion.clone();
        } else {
          characterHeadBaseQuatRef.current.copy(headBone.quaternion);
        }
      }
      if (upperTorsoBone) {
        if (!characterUpperTorsoBaseQuatRef.current) {
          characterUpperTorsoBaseQuatRef.current = upperTorsoBone.quaternion
            .clone();
        } else {
          characterUpperTorsoBaseQuatRef.current.copy(
            upperTorsoBone.quaternion,
          );
        }
      }
      if (lowerTorsoBone) {
        if (!characterLowerTorsoBaseQuatRef.current) {
          characterLowerTorsoBaseQuatRef.current = lowerTorsoBone.quaternion
            .clone();
        } else {
          characterLowerTorsoBaseQuatRef.current.copy(
            lowerTorsoBone.quaternion,
          );
        }
      }
    }

    const headBone = characterHeadBoneRef.current;
    if (rawCharacterSandboxMode) {
      headBone?.scale.setScalar(1);
    } else {
      if (headBone) {
        if (presentation.phase === "playing") {
          const viewLerp = controller.getViewModeLerp();
          const headScale = 1 - THREE.MathUtils.smoothstep(viewLerp, 0.2, 0.5);
          headBone.scale.setScalar(headScale);
        } else {
          headBone.scale.setScalar(1);
        }
        if (presentation.phase === "playing" && !firstPerson) {
          const headYawOffset = controller.getHeadYawOffset();
          if (Math.abs(headYawOffset) > 0.001) {
            HEAD_YAW_QUAT.setFromAxisAngle(HEAD_YAW_AXIS, headYawOffset);
            headBone.quaternion.premultiply(HEAD_YAW_QUAT);
          }
          if (crouchAimCompositePose > 0.001) {
            HEAD_PITCH_QUAT.setFromAxisAngle(
              X_AXIS,
              -CROUCH_AIM_HEAD_LIFT_ANGLE * crouchAimCompositePose,
            );
            headBone.quaternion.premultiply(HEAD_PITCH_QUAT);
          }
          // Aim pitch follow: tilt head to follow camera pitch when weapon equipped
          if (weaponEquipped && !sprinting) {
            const aimPitch = controller.getPitch();
            const headPitchContrib = -aimPitch * AIM_PITCH_HEAD_FRACTION;
            if (Math.abs(headPitchContrib) > 0.001) {
              AIM_PITCH_HEAD_QUAT.setFromAxisAngle(X_AXIS, headPitchContrib);
              headBone.quaternion.premultiply(AIM_PITCH_HEAD_QUAT);
            }
          }
        }
      }

      const leanValue = controller.getLeanValue();
      const upperTorsoBone = characterUpperTorsoBoneRef.current;
      if (upperTorsoBone && presentation.phase === "playing") {
        if (crouchAimCompositePose > 0.001) {
          UPPER_TORSO_PITCH_QUAT.setFromAxisAngle(
            X_AXIS,
            -CROUCH_AIM_UPPER_TORSO_LIFT_ANGLE * crouchAimCompositePose,
          );
          upperTorsoBone.quaternion.premultiply(UPPER_TORSO_PITCH_QUAT);
        }
        // Keep the ready-pose from visually drifting the muzzle away from the crosshair.
        if (rifleReadyPoseActive && !firstPerson) {
          RIFLE_READY_YAW_QUAT.setFromAxisAngle(Y_AXIS, RIFLE_READY_YAW_OFFSET);
          upperTorsoBone.quaternion.premultiply(RIFLE_READY_YAW_QUAT);
        }
        // Aim follow: when the rifle ready-pose is code-driven, the upper torso needs
        // stronger tracking or the weapon visually points off-crosshair until firing.
        if (
          weaponEquipped && !sprinting && (!firstPerson || rifleReadyPoseActive)
        ) {
          const aimPitch = controller.getPitch();
          const torsoPitchFraction = rifleReadyPoseActive
            ? RIFLE_READY_PITCH_TORSO_FRACTION
            : AIM_PITCH_TORSO_FRACTION;
          const torsoPitchContrib = -aimPitch * torsoPitchFraction;
          if (Math.abs(torsoPitchContrib) > 0.001) {
            AIM_PITCH_TORSO_QUAT.setFromAxisAngle(X_AXIS, torsoPitchContrib);
            upperTorsoBone.quaternion.premultiply(AIM_PITCH_TORSO_QUAT);
          }
          // Yaw: rotate torso towards aim direction (offset from body facing)
          const aimBodyYawOffset = normalizeAngle(
            controller.getYaw() - controller.getBodyYaw(),
          );
          const torsoYawFraction = rifleReadyPoseActive
            ? 1.0
            : AIM_YAW_TORSO_FRACTION;
          const torsoYawContrib = aimBodyYawOffset * torsoYawFraction;
          if (Math.abs(torsoYawContrib) > 0.001) {
            AIM_YAW_TORSO_QUAT.setFromAxisAngle(Y_AXIS, torsoYawContrib);
            upperTorsoBone.quaternion.premultiply(AIM_YAW_TORSO_QUAT);
          }
        }
        if (Math.abs(leanValue) > 0.001) {
          UPPER_TORSO_LEAN_QUAT.setFromAxisAngle(
            Z_AXIS,
            leanValue * UPPER_TORSO_LEAN_ANGLE,
          );
          upperTorsoBone.quaternion.premultiply(UPPER_TORSO_LEAN_QUAT);
        }
      }

      const lowerTorsoBoneForLean = characterLowerTorsoBoneRef.current;
      if (
        lowerTorsoBoneForLean &&
        presentation.phase === "playing" &&
        Math.abs(leanValue) > 0.001
      ) {
        LOWER_TORSO_LEAN_QUAT.setFromAxisAngle(
          Z_AXIS,
          leanValue * LOWER_TORSO_LEAN_ANGLE,
        );
        lowerTorsoBoneForLean.quaternion.premultiply(LOWER_TORSO_LEAN_QUAT);
      }
    }

    const switchState = weapon.getSwitchState(nowMs);
    const handBone = characterWeaponAttachBoneRef.current;
    let characterWeaponAnchor = characterWeaponAnchorRef.current;
    if (handBone) {
      handBone.getWorldPosition(tempCharacterWeaponAnchorWorldRef.current);
      handBone.getWorldQuaternion(tempBoneWorldQuatRef.current);
      if (!characterWeaponAnchor) {
        characterWeaponAnchor = {
          position: tempCharacterWeaponAnchorWorldRef.current,
          quaternion: tempBoneWorldQuatRef.current,
        };
        characterWeaponAnchorRef.current = characterWeaponAnchor;
      }
    } else {
      characterWeaponAnchor = null;
    }
    const embeddedMuzzleMesh = embeddedWeaponMuzzleRef.current;
    if (singleWeaponMode && embeddedWeapon?.object && embeddedMuzzleMesh) {
      tempEmbeddedWeaponMuzzleWorldRef.current
        .copy(embeddedWeapon.muzzleLocalOffset);
      embeddedWeapon.object.localToWorld(
        tempEmbeddedWeaponMuzzleWorldRef.current,
      );
      embeddedWeapon.object.getWorldQuaternion(
        tempEmbeddedWeaponWorldQuatRef.current,
      );
      embeddedMuzzleMesh.position.copy(tempEmbeddedWeaponMuzzleWorldRef.current);
      embeddedMuzzleMesh.quaternion.copy(tempEmbeddedWeaponWorldQuatRef.current);
      embeddedMuzzleMesh.visible = weapon.hasMuzzleFlash(nowMs);
      embeddedMuzzleMesh.scale.setScalar(1);
    } else if (embeddedMuzzleMesh) {
      embeddedMuzzleMesh.visible = false;
    }

    if (singleWeaponMode) {
      if (characterWeaponRef.current) {
        characterWeaponRef.current.visible = false;
      }
      if (characterRifleModelRef.current) {
        characterRifleModelRef.current.visible = false;
      }
      if (characterSniperModelRef.current) {
        characterSniperModelRef.current.visible = false;
      }
      if (characterMuzzleRef.current) {
        characterMuzzleRef.current.visible = false;
      }
    } else {
      updateCharacterWeaponMesh(
        characterWeaponRef.current,
        characterRifleModelRef.current,
        characterSniperModelRef.current,
        characterMuzzleRef.current,
        weapon,
        nowMs,
        switchState,
        characterWeaponAnchor,
        weaponAlignment,
        rifleMuzzleOffsetRef.current,
        sniperMuzzleOffsetRef.current,
        firstPerson,
        controller.getAdsLerp(),
        camera,
        weapon.getActiveWeapon(),
        presentation.phase === "menu" ? "rifle" : null,
      );
    }

    const weaponSprinting = !weaponEquipped
      ? sprinting
      : nextAnimState === "rifleRun" ||
        nextAnimState === "rifleRunStart" ||
        nextAnimState === "rifleRunStop";
    weapon.setMovementState(movementActive, weaponSprinting);
    syncWeaponAmmoFromInventory();
    const preUpdateLoadout = weapon.getLoadoutState();
    const shots = weapon.update(clampedDelta, nowMs, camera);
    const fireState = weapon.getFireState(nowMs);
    if (
      triggerHeldForWeapon &&
      shots.length === 0 &&
      fireState.blocked &&
      fireState.reason === "empty"
    ) {
      audio.playDryFire();
    }
    const postUpdateLoadout = weapon.getLoadoutState();
    const rifleReserveSpent = postUpdateLoadout.slotA.hasWeapon &&
        postUpdateLoadout.slotA.weaponKind === "rifle"
      ? Math.max(
        0,
        preUpdateLoadout.slotA.reserveAmmo -
          postUpdateLoadout.slotA.reserveAmmo,
      )
      : 0;
    const sniperReserveSpent = postUpdateLoadout.slotB.hasWeapon &&
        postUpdateLoadout.slotB.weaponKind === "sniper"
      ? Math.max(
        0,
        preUpdateLoadout.slotB.reserveAmmo -
          postUpdateLoadout.slotB.reserveAmmo,
      )
      : 0;
    if (rifleReserveSpent > 0 && !practiceMap.infiniteAmmo) {
      inventoryRef.current.consumeAmmo("ammo_rifle", rifleReserveSpent);
    }
    if (sniperReserveSpent > 0 && !practiceMap.infiniteAmmo) {
      inventoryRef.current.consumeAmmo("ammo_sniper", sniperReserveSpent);
    }

    const postUpdateReload = weapon.getReloadState(nowMs);
    const hudSyncKey = [
      postUpdateLoadout.slotA.magAmmo,
      postUpdateLoadout.slotA.reserveAmmo,
      postUpdateLoadout.slotB.magAmmo,
      postUpdateLoadout.slotB.reserveAmmo,
      postUpdateReload.active ? 1 : 0,
      postUpdateReload.weaponKind ?? "none",
      Math.floor(postUpdateReload.progress * 100),
    ].join("|");
    if (hudSyncKey !== lastHudSyncKeyRef.current) {
      lastHudSyncKeyRef.current = hudSyncKey;
      emitPlayerSnapshot();
    }

    if (shots.length > 0) {
      controller.alignBodyToAim();
    }
    if (shots.length > 0 && bulletHittableMeshesDirtyRef.current) {
      const meshes: THREE.Object3D[] = [];
      scene.traverse((child) => {
        if (
          (child as THREE.Mesh).isMesh &&
          child.userData?.bulletHittable === true
        ) {
          meshes.push(child);
        }
      });
      bulletHittableMeshesRef.current = meshes;
      bulletHittableMeshesDirtyRef.current = false;
    }

    for (const shot of shots) {
      shotFiredCallbackRef.current({
        weaponType: shot.weaponType,
        shotCount: shot.shotIndex + 1,
        nowMs,
      });
      audio.playGunshot(shot.weaponType);
      if (shot.recoilPitchRadians !== 0 || shot.recoilYawRadians !== 0) {
        controller.addRecoil(shot.recoilPitchRadians, shot.recoilYawRadians);
      }

      const targetVisualScale = targetDummyGroupScale(targetRevealRef.current);
      const cameraTargetHit = raycastVisibleTargets(
        shot.origin,
        shot.direction,
        targetsRef.current,
        targetVisualRegistryRef.current,
        raycasterRef.current,
        Number.POSITIVE_INFINITY,
        targetVisualScale,
      );
      const cameraWorldHit = raycastBulletWorld(
        bulletHittableMeshesRef.current,
        shot.origin,
        shot.direction,
        raycasterRef.current,
        tempImpactNormalRef.current,
        tempImpactNormalMatrixRef.current,
      );

      const tracerOrigin = tempTracerOriginRef.current;
      const muzzle = singleWeaponMode
        ? embeddedWeaponMuzzleRef.current
        : characterMuzzleRef.current;
      const usedMuzzle = !!muzzle && !!playerChar?.visible;
      if (usedMuzzle) {
        muzzle.getWorldPosition(tracerOrigin);
      } else {
        tracerOrigin.copy(shot.origin);
      }

      const cameraTargetVisible = !!cameraTargetHit &&
        (!cameraWorldHit ||
          cameraTargetHit.distance <=
            cameraWorldHit.distance + BULLET_HIT_EPSILON);

      const aimPoint = tempAimPointRef.current;
      if (cameraTargetHit && cameraTargetVisible) {
        aimPoint.copy(cameraTargetHit.point);
      } else if (cameraWorldHit) {
        aimPoint.copy(cameraWorldHit.point);
      } else {
        aimPoint.copy(shot.origin).addScaledVector(
          shot.direction,
          TRACER_DISTANCE,
        );
      }

      const fireDirection = tempFireDirectionRef.current;
      fireDirection.copy(aimPoint).sub(tracerOrigin);
      let fireDistance = fireDirection.length();
      if (fireDistance > BULLET_HIT_EPSILON) {
        fireDirection.multiplyScalar(1 / fireDistance);
      } else {
        fireDirection.copy(shot.direction);
        fireDistance = TRACER_DISTANCE;
      }

      if (usedMuzzle) {
        tracerOrigin.addScaledVector(
          fireDirection,
          TRACER_MUZZLE_FORWARD_OFFSET,
        );
        fireDirection.copy(aimPoint).sub(tracerOrigin);
        fireDistance = fireDirection.length();
        if (fireDistance > BULLET_HIT_EPSILON) {
          fireDirection.multiplyScalar(1 / fireDistance);
        } else {
          fireDirection.copy(shot.direction);
          fireDistance = TRACER_DISTANCE;
        }
      }

      const maxFireDistance = fireDistance + BULLET_HIT_EPSILON;
      const targetHit = raycastVisibleTargets(
        tracerOrigin,
        fireDirection,
        targetsRef.current,
        targetVisualRegistryRef.current,
        raycasterRef.current,
        maxFireDistance,
        targetVisualScale,
      );
      const worldHit = raycastBulletWorld(
        bulletHittableMeshesRef.current,
        tracerOrigin,
        fireDirection,
        raycasterRef.current,
        tempImpactNormalRef.current,
        tempImpactNormalMatrixRef.current,
        maxFireDistance,
      );
      const targetVisible = !!targetHit &&
        (!worldHit ||
          targetHit.distance <= worldHit.distance + BULLET_HIT_EPSILON);
      const cameraTargetDistanceFromMuzzle = cameraTargetHit
        ? tracerOrigin.distanceTo(cameraTargetHit.point)
        : Number.POSITIVE_INFINITY;
      const cameraHeadButMuzzleOtherZone = !!cameraTargetHit &&
        cameraTargetHit.zone === "head" &&
        !!targetHit &&
        targetHit.id === cameraTargetHit.id &&
        targetHit.zone !== "head";
      const cameraTargetReachableFromMuzzle = !!cameraTargetHit &&
        (!worldHit ||
          cameraTargetDistanceFromMuzzle <=
            worldHit.distance + BULLET_HIT_EPSILON ||
          cameraHeadButMuzzleOtherZone);
      const preferCameraTarget = !!cameraTargetHit &&
        cameraTargetVisible &&
        cameraTargetReachableFromMuzzle &&
        (!targetHit || targetHit.id === cameraTargetHit.id);
      const resolvedTargetHit = preferCameraTarget
        ? {
          ...cameraTargetHit,
          distance: cameraTargetDistanceFromMuzzle,
        }
        : targetVisible
        ? targetHit
        : null;

      if (resolvedTargetHit) {
        tempEndRef.current.copy(resolvedTargetHit.point);
        const resolvedDamage = resolveShotDamage(shot, resolvedTargetHit);
        const targetBeforeHit = targetsRef.current.find((target) =>
          target.id === resolvedTargetHit.id
        );
        const killed = targetBeforeHit
          ? targetBeforeHit.hp - resolvedDamage <= 0
          : false;
        const hitType: "head" | "body" | "leg" = resolvedTargetHit.zone;

        // Immediately update targetsRef so subsequent shots in this frame
        // (and future frames before React re-renders) see the correct HP/disabled state.
        if (targetBeforeHit) {
          const newHp = Math.max(0, targetBeforeHit.hp - resolvedDamage);
          targetsRef.current = targetsRef.current.map((target) =>
            target.id === resolvedTargetHit.id
              ? { ...target, hp: newHp, disabled: newHp <= 0 }
              : target
          );
        }

        pushBloodSpray(
          resolvedTargetHit.point,
          resolvedTargetHit.normal,
          hitType,
        );
        targetHitCallbackRef.current(
          resolvedTargetHit.id,
          resolvedDamage,
          nowMs,
        );
        const markerKind: HitMarkerKind = killed
          ? "kill"
          : hitType === "head"
          ? "head"
          : "body";
        hitMarkerCallbackRef.current(markerKind, resolvedDamage, resolvedTargetHit.id);
        if (killed) {
          audio.playKill();
        }
      } else if (worldHit) {
        tempEndRef.current.copy(worldHit.point);
        pushImpactMark(worldHit.point, worldHit.normal);
      } else {
        tempEndRef.current.copy(aimPoint);
      }

      if (
        !usedMuzzle &&
        tracerOrigin.distanceToSquared(tempEndRef.current) >
          (TRACER_CAMERA_START_OFFSET + 0.04) ** 2
      ) {
        tracerOrigin.addScaledVector(fireDirection, TRACER_CAMERA_START_OFFSET);
      }

      const tracerDistance = tracerOrigin.distanceTo(tempEndRef.current);
      if (tracerDistance < MIN_TRACER_DISTANCE) {
        weapon.clearTracer();
        continue;
      }

      weapon.setTracer(tracerOrigin, tempEndRef.current, nowMs);
    }

    const worldState = weapon.getWorldState();
    const groundWeaponState = inventoryRef.current.getGroundWeaponVisualState();
    const displayedWeapon = resolveDisplayedWeapon(
      weapon,
      switchState,
      presentation.phase === "menu" ? "rifle" : null,
    );
    const showBackSlots = presentation.phase === "playing" &&
      !firstPerson &&
      !singleWeaponMode;
    const upperTorsoBoneForBack = characterUpperTorsoBoneRef.current;
    let backWeaponAnchor = backWeaponAnchorRef.current;
    if (upperTorsoBoneForBack) {
      upperTorsoBoneForBack.getWorldPosition(
        tempBackWeaponAnchorWorldRef.current,
      );
      upperTorsoBoneForBack.getWorldQuaternion(
        tempBackWeaponAnchorQuatRef.current,
      );
      if (!backWeaponAnchor) {
        backWeaponAnchor = {
          position: tempBackWeaponAnchorWorldRef.current,
          quaternion: tempBackWeaponAnchorQuatRef.current,
        };
        backWeaponAnchorRef.current = backWeaponAnchor;
      }
    } else {
      backWeaponAnchor = null;
    }

    updateBackWeaponMesh(
      backRifleSlotRef.current,
      showBackSlots &&
        worldState.loadout.slotA.hasWeapon &&
        shouldShowBackWeapon("rifle", displayedWeapon, switchState),
      switchState,
      -1,
      backWeaponAnchor,
    );
    updateBackWeaponMesh(
      backSniperSlotRef.current,
      showBackSlots &&
        worldState.loadout.slotB.hasWeapon &&
        shouldShowBackWeapon("sniper", displayedWeapon, switchState),
      switchState,
      1,
      backWeaponAnchor,
    );

    updateWorldWeaponMesh(
      worldRiflePickupRef.current,
      groundWeaponState.rifle.isPresentOnGround,
      groundWeaponState.rifle.droppedPosition,
      presentation.pickupReveal,
      -Math.PI / 2,
    );
    updateWorldWeaponMesh(
      worldSniperPickupRef.current,
      groundWeaponState.sniper.isPresentOnGround,
      groundWeaponState.sniper.droppedPosition,
      presentation.pickupReveal,
      -Math.PI / 2,
    );
    updateTracerMesh(
      tracerRef.current,
      weapon,
      nowMs,
      tempMidRef.current,
      tempTracerDirRef.current,
    );

    if (presentation.phase !== "playing") {
      const position = controller.getPosition();
      const yaw = controller.getAimYaw();
      const phaseProgress = clamp01(presentation.phaseProgress);
      const forward = transitionForwardRef.current.set(
        -Math.sin(yaw),
        0,
        -Math.cos(yaw),
      );
      const right = transitionRightRef.current.set(
        Math.cos(yaw),
        0,
        -Math.sin(yaw),
      );
      const swayX = Math.sin(nowMs * 0.00075);
      const swayY = Math.sin(nowMs * 0.00105);
      const frontPos = transitionFrontPosRef.current
        .copy(position)
        .addScaledVector(forward, MENU_FRONT_DISTANCE)
        .addScaledVector(
          right,
          MENU_SHOULDER_OFFSET + swayX * MENU_SIDE_DRIFT,
        );
      frontPos.y = position.y + MENU_FRONT_HEIGHT + swayY * MENU_VERTICAL_DRIFT;
      const frontLook = transitionFrontLookRef.current.copy(position);
      frontLook.y = position.y + MENU_LOOK_HEIGHT;
      frontLook.addScaledVector(
        right,
        MENU_LOOK_SHOULDER_OFFSET + swayX * MENU_LOOK_DRIFT,
      );
      const backPos = transitionBackPosRef.current
        .copy(position)
        .addScaledVector(forward, -TRANSITION_BACK_DISTANCE)
        .addScaledVector(right, TRANSITION_SHOULDER);
      backPos.y = position.y + TRANSITION_BACK_HEIGHT;
      const backLook = transitionBackLookRef.current.copy(position);
      backLook.y = position.y + 1.16;
      backLook
        .addScaledVector(forward, TRANSITION_LOOK_DISTANCE)
        .addScaledVector(right, TRANSITION_SHOULDER * 0.9);
      const menuLightBlend = presentation.phase === "menu"
        ? 1
        : presentation.phase === "entering"
        ? 1 - clamp01(phaseProgress / 0.72)
        : phaseProgress < 0.52
        ? 0
        : clamp01((phaseProgress - 0.52) / 0.22);

      const keyLight = menuCharacterKeyLightRef.current;
      if (keyLight) {
        keyLight.visible = menuLightBlend > 0.001;
        keyLight.intensity = 7.25 * menuLightBlend;
        keyLight.position.copy(frontPos);
        keyLight.position.y += 0.2;
        keyLight.position.addScaledVector(right, 0.22);
        keyLight.position.addScaledVector(forward, 0.36);
      }

      const rimLight = menuCharacterRimLightRef.current;
      if (rimLight) {
        rimLight.visible = menuLightBlend > 0.001;
        rimLight.intensity = 1.2 * menuLightBlend;
        rimLight.position.copy(position);
        rimLight.position.addScaledVector(forward, -1.22);
        rimLight.position.addScaledVector(right, -1.02);
        rimLight.position.y = position.y + 1.74;
      }

      if (presentation.phase === "menu") {
        camera.position.copy(frontPos);
        camera.lookAt(frontLook);
      } else if (presentation.phase === "entering") {
        const blend = easeInOutCubic(phaseProgress);
        camera.position.lerpVectors(frontPos, backPos, blend);
        tempAimPointRef.current.lerpVectors(frontLook, backLook, blend);
        camera.lookAt(tempAimPointRef.current);
      } else if (presentation.phase === "returning") {
        if (phaseProgress < 0.52) {
          camera.position.copy(returningFreezePosRef.current);
          camera.lookAt(returningFreezeLookRef.current);
        } else {
          camera.position.copy(frontPos);
          camera.lookAt(frontLook);
        }
      }

      if ("isPerspectiveCamera" in camera && camera.isPerspectiveCamera) {
        const perspectiveCamera = camera as THREE.PerspectiveCamera;
        const phaseFov = presentation.phase === "entering"
          ? THREE.MathUtils.lerp(
            MENU_FOV,
            fov,
            easeInOutCubic(phaseProgress),
          )
          : presentation.phase === "returning"
          ? THREE.MathUtils.lerp(
            fov,
            MENU_FOV,
            easeInOutCubic(phaseProgress),
          )
          : MENU_FOV;
        const nextFov = THREE.MathUtils.damp(
          perspectiveCamera.fov,
          phaseFov,
          10,
          clampedDelta,
        );
        if (Math.abs(nextFov - perspectiveCamera.fov) > 0.01) {
          perspectiveCamera.fov = nextFov;
          perspectiveCamera.updateProjectionMatrix();
        }
      }
    } else {
      const keyLight = menuCharacterKeyLightRef.current;
      if (keyLight) {
        keyLight.visible = false;
        keyLight.intensity = 0;
      }
      const rimLight = menuCharacterRimLightRef.current;
      if (rimLight) {
        rimLight.visible = false;
        rimLight.intensity = 0;
      }
    }

    const equipped = weapon.isEquipped();
    if (lastWeaponEquippedRef.current !== equipped) {
      lastWeaponEquippedRef.current = equipped;
      weaponEquippedCallbackRef.current(equipped);
    }

    const currentActiveWeapon = weapon.getActiveWeapon();
    if (lastActiveWeaponRef.current !== currentActiveWeapon) {
      lastActiveWeaponRef.current = currentActiveWeapon;
      activeWeaponCallbackRef.current(currentActiveWeapon);
    }

    perfAccumulatorRef.current += clampedDelta;
    fpsTimeRef.current += clampedDelta;
    fpsFrameCountRef.current += 1;

    const frameMs = clampedDelta * 1000;
    const emaAlpha = 0.12;
    const prevEma = perfFrameMsEmaRef.current;
    perfFrameMsEmaRef.current = prevEma === 0
      ? frameMs
      : prevEma * (1 - emaAlpha) + frameMs * emaAlpha;

    if (perfAccumulatorRef.current >= 0.2) {
      const fps = fpsTimeRef.current > 0
        ? fpsFrameCountRef.current / fpsTimeRef.current
        : 0;
      const ema = perfFrameMsEmaRef.current;
      const budgetMs = 1000 / 60;
      const cpuUtilPercent = Math.min(100, Math.round((ema / budgetMs) * 100));
      const draws = gl.info.render.calls;
      const tris = gl.info.render.triangles;
      const gpuUtilPercent = Math.min(
        100,
        Math.round(
          Math.min(100, (draws / 4000) * 42 + (tris / 2_500_000) * 58),
        ),
      );
      perfCallbackRef.current({
        fps,
        frameMs,
        cpuUtilPercent,
        gpuUtilPercent,
        drawCalls: draws,
        triangles: tris,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
      });
      perfAccumulatorRef.current = 0;
      fpsTimeRef.current = 0;
      fpsFrameCountRef.current = 0;
    }
  });

  return (
    <>
      <pointLight
        ref={menuCharacterKeyLightRef}
        position={[0, 0, 0]}
        intensity={0}
        distance={9}
        decay={1.55}
        color="#ffe7c8"
      />
      <pointLight
        ref={menuCharacterRimLightRef}
        position={[0, 0, 0]}
        intensity={0}
        distance={12}
        decay={2}
        color="#8eb5ff"
      />
      <group ref={playerCharacterRef}>
        {characterModel ? <primitive object={characterModel} /> : (
          <>
            <mesh position={[0, 1.0, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.4, 0.55, 0.25]} />
              <meshStandardMaterial
                color="#4a6b82"
                roughness={0.7}
                metalness={0.1}
              />
            </mesh>
            <mesh position={[0, 1.48, 0]} castShadow receiveShadow>
              <sphereGeometry args={[0.14, 12, 12]} />
              <meshStandardMaterial
                color="#e8c9a4"
                roughness={0.85}
                metalness={0}
              />
            </mesh>
            <mesh position={[-0.1, 0.3, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.14, 0.6, 0.16]} />
              <meshStandardMaterial
                color="#3a4d5c"
                roughness={0.8}
                metalness={0.05}
              />
            </mesh>
            <mesh position={[0.1, 0.3, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.14, 0.6, 0.16]} />
              <meshStandardMaterial
                color="#3a4d5c"
                roughness={0.8}
                metalness={0.05}
              />
            </mesh>
            <mesh position={[-0.28, 0.92, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.12, 0.48, 0.12]} />
              <meshStandardMaterial
                color="#4a6b82"
                roughness={0.7}
                metalness={0.1}
              />
            </mesh>
            <mesh position={[0.28, 0.92, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.12, 0.48, 0.12]} />
              <meshStandardMaterial
                color="#4a6b82"
                roughness={0.7}
                metalness={0.1}
              />
            </mesh>
          </>
        )}
      </group>

      <mesh ref={embeddedWeaponMuzzleRef} visible={false}>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshBasicMaterial color="#ffd085" transparent opacity={0.9} />
      </mesh>

      <group ref={backRifleSlotRef} visible={false}>
        {weaponModels.rifle
          ? (
            <WeaponModelInstance
              source={weaponModels.rifle}
              transform={WEAPON_MODEL_TRANSFORMS.back.rifle}
            />
          )
          : (
            <mesh castShadow receiveShadow>
              <boxGeometry args={[0.58, 0.08, 0.12]} />
              <meshStandardMaterial
                color="#2f363c"
                roughness={0.58}
                metalness={0.42}
              />
            </mesh>
          )}
      </group>
      <group ref={backSniperSlotRef} visible={false}>
        {weaponModels.sniper
          ? (
            <WeaponModelInstance
              source={weaponModels.sniper}
              transform={WEAPON_MODEL_TRANSFORMS.back.sniper}
            />
          )
          : (
            <mesh castShadow receiveShadow>
              <boxGeometry args={[0.74, 0.08, 0.11]} />
              <meshStandardMaterial
                color="#242a30"
                roughness={0.52}
                metalness={0.44}
              />
            </mesh>
          )}
      </group>

      <group ref={characterWeaponRef} visible={false}>
        <group ref={characterRifleModelRef}>
          {weaponModels.rifle
            ? (
              <WeaponModelInstance
                source={weaponModels.rifle}
                transform={WEAPON_MODEL_TRANSFORMS.character.rifle}
              />
            )
            : (
              <>
                <mesh castShadow receiveShadow>
                  <boxGeometry args={[0.55, 0.09, 0.13]} />
                  <meshStandardMaterial
                    color="#30363c"
                    roughness={0.55}
                    metalness={0.4}
                  />
                </mesh>
                <mesh
                  position={[0.16, -0.08, 0.01]}
                  rotation={[0.15, 0, -0.2]}
                >
                  <boxGeometry args={[0.18, 0.17, 0.05]} />
                  <meshStandardMaterial
                    color="#4d463f"
                    roughness={0.85}
                    metalness={0.1}
                  />
                </mesh>
                <mesh
                  position={[-0.24, 0.015, 0]}
                  rotation={[0, 0, Math.PI / 2]}
                >
                  <cylinderGeometry args={[0.015, 0.015, 0.42, 8]} />
                  <meshStandardMaterial
                    color="#20262b"
                    roughness={0.4}
                    metalness={0.6}
                  />
                </mesh>
              </>
            )}
          {sightModels.rifleSight
            ? (
              <group
                position={SIGHT_MOUNT_TRANSFORMS.rifle.position}
                rotation={SIGHT_MOUNT_TRANSFORMS.rifle.rotation}
                scale={[
                  SIGHT_MOUNT_TRANSFORMS.rifle.scale,
                  SIGHT_MOUNT_TRANSFORMS.rifle.scale,
                  SIGHT_MOUNT_TRANSFORMS.rifle.scale,
                ]}
              >
                <primitive object={sightModels.rifleSight} />
              </group>
            )
            : null}
        </group>
        <group ref={characterSniperModelRef}>
          {weaponModels.sniper
            ? (
              <WeaponModelInstance
                source={weaponModels.sniper}
                transform={WEAPON_MODEL_TRANSFORMS.character.sniper}
              />
            )
            : (
              <>
                <mesh castShadow receiveShadow>
                  <boxGeometry args={[0.72, 0.08, 0.11]} />
                  <meshStandardMaterial
                    color="#2a3036"
                    roughness={0.53}
                    metalness={0.42}
                  />
                </mesh>
                <mesh
                  position={[0.2, -0.07, 0.01]}
                  rotation={[0.14, 0, -0.2]}
                >
                  <boxGeometry args={[0.2, 0.16, 0.05]} />
                  <meshStandardMaterial
                    color="#4a4139"
                    roughness={0.86}
                    metalness={0.08}
                  />
                </mesh>
                <mesh position={[-0.08, 0.07, 0]}>
                  <cylinderGeometry args={[0.03, 0.03, 0.28, 12]} />
                  <meshStandardMaterial
                    color="#1d2227"
                    roughness={0.42}
                    metalness={0.58}
                  />
                </mesh>
                <mesh
                  position={[-0.34, 0.01, 0]}
                  rotation={[0, 0, Math.PI / 2]}
                >
                  <cylinderGeometry args={[0.014, 0.014, 0.68, 10]} />
                  <meshStandardMaterial
                    color="#1b2025"
                    roughness={0.45}
                    metalness={0.62}
                  />
                </mesh>
              </>
            )}
        </group>
        <mesh ref={characterMuzzleRef} position={[0, 0, 0]} visible={false}>
          <sphereGeometry args={[0.05, 8, 8]} />
          <meshBasicMaterial color="#ffd085" transparent opacity={0.9} />
        </mesh>
      </group>

      <group ref={worldRiflePickupRef} visible>
        {weaponModels.rifle
          ? (
            <WeaponModelInstance
              source={weaponModels.rifle}
              transform={WEAPON_MODEL_TRANSFORMS.world.rifle}
            />
          )
          : (
            <>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[0.7, 0.12, 0.18]} />
                <meshStandardMaterial
                  color="#30363c"
                  roughness={0.6}
                  metalness={0.35}
                />
              </mesh>
              <mesh position={[0.22, -0.08, 0]} castShadow receiveShadow>
                <boxGeometry args={[0.22, 0.18, 0.06]} />
                <meshStandardMaterial
                  color="#514942"
                  roughness={0.85}
                  metalness={0.1}
                />
              </mesh>
              <mesh
                position={[-0.22, 0, 0]}
                rotation={[0, 0, Math.PI / 2]}
                castShadow
                receiveShadow
              >
                <cylinderGeometry args={[0.02, 0.02, 0.55, 10]} />
                <meshStandardMaterial
                  color="#1e2328"
                  roughness={0.5}
                  metalness={0.55}
                />
              </mesh>
            </>
          )}
      </group>

      <group ref={worldSniperPickupRef} visible>
        {weaponModels.sniper
          ? (
            <WeaponModelInstance
              source={weaponModels.sniper}
              transform={WEAPON_MODEL_TRANSFORMS.world.sniper}
            />
          )
          : (
            <>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[0.78, 0.08, 0.11]} />
                <meshStandardMaterial
                  color="#2a3036"
                  roughness={0.52}
                  metalness={0.4}
                />
              </mesh>
              <mesh
                position={[-0.36, 0.01, 0]}
                rotation={[0, 0, Math.PI / 2]}
                castShadow
                receiveShadow
              >
                <cylinderGeometry args={[0.014, 0.014, 0.72, 10]} />
                <meshStandardMaterial
                  color="#1b2025"
                  roughness={0.45}
                  metalness={0.62}
                />
              </mesh>
            </>
          )}
      </group>

      {groundAmmoVisualState.rifle.map((position, index) => (
        <mesh
          key={`ammo-rifle-${index}-${position.join("-")}`}
          position={position}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[0.24, 0.24, 0.24]} />
          <meshStandardMaterial
            color="#3b82f6"
            roughness={0.42}
            metalness={0.18}
          />
        </mesh>
      ))}
      {groundAmmoVisualState.sniper.map((position, index) => (
        <mesh
          key={`ammo-sniper-${index}-${position.join("-")}`}
          position={position}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[0.24, 0.24, 0.24]} />
          <meshStandardMaterial
            color="#ef4444"
            roughness={0.42}
            metalness={0.18}
          />
        </mesh>
      ))}

      <mesh
        ref={tracerRef}
        visible={false}
        frustumCulled={false}
        renderOrder={8}
      >
        <boxGeometry args={[0.004, 0.004, 1]} />
        <meshBasicMaterial
          color="#ffeaba"
          transparent
          opacity={0.12}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <BloodImpactMarks impacts={bloodSplats} />
      <BulletImpactMarks impacts={impactMarks} />
    </>
  );
});
