import {
  forwardRef,
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
import { raycastTargets, type TargetRaycastHit } from "../Targets";
import {
  type SniperRechamberState,
  type WeaponKind,
  type WeaponShotEvent,
  type WeaponSwitchState,
  WeaponSystem,
} from "../Weapon";
import type {
  CollisionRect,
  GameSettings,
  MovementProfileSettings,
  PerfMetrics,
  PlayerSnapshot,
  ScenePresentation,
  TargetState,
  WeaponAlignmentOffset,
  WeaponRecoilProfiles,
  WorldBounds,
} from "../types";
import { isSprintInputEligible } from "../movement";
import {
  type CharacterFootstepSample,
  normalizeBoneName,
  resolveFootstepPlaybackRate,
  useCharacterModel,
} from "./CharacterModel";
import { BloodImpactMarks, BulletImpactMarks } from "./ImpactMarks";
import {
  computeWeaponMuzzleOffset,
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
  PLAYER_SPAWN_PITCH,
  PLAYER_SPAWN_POSITION,
  PLAYER_SPAWN_YAW,
  RIFLE_RUN_START_MS,
  RIFLE_RUN_STOP_MS,
  TRACER_CAMERA_START_OFFSET,
  TRACER_DISTANCE,
  TRACER_MUZZLE_FORWARD_OFFSET,
  WEAPON_MODEL_TRANSFORMS,
  type WorldRaycastHit,
  Z_AXIS,
} from "./scene-constants";

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
  resetForMenu: () => void;
};

type GameplayRuntimeProps = {
  collisionRects: CollisionRect[];
  worldBounds: WorldBounds;
  audioVolumes: AudioVolumeSettings;
  presentation: ScenePresentation;
  sensitivity: GameSettings["sensitivity"];
  keybinds: GameSettings["keybinds"];
  crouchMode: GameSettings["crouchMode"];
  fov: number;
  weaponAlignment: WeaponAlignmentOffset;
  movement: MovementProfileSettings;
  weaponRecoilProfiles: WeaponRecoilProfiles;
  targets: TargetState[];
  onTargetHit: (targetId: string, damage: number, nowMs: number) => void;
  onResetTargets: () => void;
  onPlayerSnapshot: (snapshot: PlayerSnapshot) => void;
  onPerfMetrics: (metrics: PerfMetrics) => void;
  onHitMarker: (kind: HitMarkerKind) => void;
  onShotFired: (state: ShotFiredState) => void;
  onWeaponEquippedChange: (equipped: boolean) => void;
  onActiveWeaponChange: (weapon: WeaponKind) => void;
  onSniperRechamberChange: (state: SniperRechamberState) => void;
  onAimingStateChange: (state: AimingState) => void;
  onCriticalAssetsReadyChange?: (ready: boolean) => void;
};

const MENU_LOOK_HEIGHT = 1.06;
const MENU_FRONT_DISTANCE = 2.9;
const MENU_FRONT_HEIGHT = 1.2;
const MENU_SIDE_DRIFT = 0.16;
const MENU_VERTICAL_DRIFT = 0.04;
const MENU_LOOK_DRIFT = 0.08;
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
const CROUCH_AIM_HEAD_LIFT_ANGLE = THREE.MathUtils.degToRad(12);
const CROUCH_AIM_UPPER_TORSO_LIFT_ANGLE = THREE.MathUtils.degToRad(16);

// Aim follow: distribute camera pitch/yaw across spine and head for natural look
const AIM_PITCH_TORSO_FRACTION = 0.55;
const AIM_PITCH_HEAD_FRACTION = 0.35;
const AIM_YAW_TORSO_FRACTION = 0.6;
const RIFLE_READY_PITCH_TORSO_FRACTION = 0.82;
const RIFLE_READY_YAW_TORSO_FRACTION = 0.92;
const AIM_PITCH_TORSO_QUAT = new THREE.Quaternion();
const AIM_PITCH_HEAD_QUAT = new THREE.Quaternion();
const AIM_YAW_TORSO_QUAT = new THREE.Quaternion();
const RIFLE_READY_YAW_OFFSET = THREE.MathUtils.degToRad(-3.5);
const RIFLE_READY_YAW_QUAT = new THREE.Quaternion();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

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
const LOCOMOTION_VISUAL_INPUT_DAMP = 12;
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
const RIFLE_LOCOMOTION_SCALE_MIN = 0.9;
const RIFLE_LOCOMOTION_SCALE_MAX = 1.2;
// Keep these in sync with PlayerController movement constants.
const PLAYER_WALK_SPEED = 5.3;
const PLAYER_SPRINT_SPEED = 8.2;
const UNARMED_WALK_SPEED_SCALE = 0.68;

type FootstepPhaseTracker = {
  cycle: number;
  lastNormalizedTime: number;
  state: CharacterAnimState | null;
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
): boolean {
  if (!sample) {
    tracker.state = null;
    tracker.cycle = 0;
    tracker.lastNormalizedTime = 0;
    return false;
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
    return false;
  }

  let cycle = tracker.cycle;
  if (normalizedTime + 0.001 < tracker.lastNormalizedTime) {
    cycle += 1;
  }

  const previousAbsolute = tracker.cycle + tracker.lastNormalizedTime;
  const currentAbsolute = cycle + normalizedTime;
  tracker.cycle = cycle;
  tracker.lastNormalizedTime = normalizedTime;

  for (const marker of getFootstepMarkers(sample.state)) {
    if (
      previousAbsolute < cycle + marker &&
      currentAbsolute >= cycle + marker
    ) {
      return true;
    }
  }

  return false;
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

function updateVisualLocomotionInput(
  current: THREE.Vector2,
  movementActive: boolean,
  moveX: number,
  moveY: number,
  delta: number,
): THREE.Vector2 {
  if (!movementActive) {
    current.set(0, 0);
    return current;
  }

  if (current.lengthSq() <= 0.0001) {
    current.set(moveX, moveY);
    return current;
  }

  current.x = THREE.MathUtils.damp(
    current.x,
    moveX,
    LOCOMOTION_VISUAL_INPUT_DAMP,
    delta,
  );
  current.y = THREE.MathUtils.damp(
    current.y,
    moveY,
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
      entries.push({
        material,
        category: resolveFirstPersonVisibilityCategory(material.name ?? ""),
        baseOpacity: material.opacity,
        baseTransparent: material.transparent,
      });
    }
  });

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
  adsActive: boolean,
  leanValue: number,
) {
  if (!weaponGroup) {
    return;
  }

  const equipped = weapon.isEquipped();
  weaponGroup.visible = equipped;
  if (!equipped) {
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

  const displayedWeapon = resolveDisplayedWeapon(weapon, switchState);
  const switchBlend = switchState.active
    ? Math.sin(Math.PI * switchState.progress)
    : 0;
  if (anchor) {
    weaponGroup.position.copy(anchor.position);
    weaponGroup.quaternion.copy(anchor.quaternion);
    weaponGroup.translateX(alignment.posX);
    weaponGroup.translateY(alignment.posY);
    weaponGroup.translateZ(alignment.posZ);
    weaponGroup.rotateX(alignment.rotX);
    weaponGroup.rotateY(alignment.rotY);
    weaponGroup.rotateZ(alignment.rotZ);
    if (switchBlend > 0) {
      weaponGroup.translateY(-switchBlend * 0.06);
      weaponGroup.rotateX(-switchBlend * 0.35);
    }
    if (firstPerson && Math.abs(leanValue) > 0.001) {
      const leanShift = leanValue * (adsActive ? 0.085 : 0.12);
      const leanRoll = -leanValue * (adsActive ? 0.11 : 0.16);
      const leanYaw = leanValue * (adsActive ? 0.04 : 0.07);
      weaponGroup.translateX(leanShift);
      weaponGroup.translateY(
        -(Math.abs(leanValue) * (adsActive ? 0.008 : 0.012)),
      );
      weaponGroup.rotateZ(leanRoll);
      weaponGroup.rotateY(leanYaw);
    }
  } else {
    weaponGroup.position.set(
      0.34,
      0.82 - switchBlend * 0.18,
      -0.2 + switchBlend * 0.06,
    );
    weaponGroup.rotation.set(
      -switchBlend * 0.42,
      switchBlend * 0.05,
      -switchBlend * 0.12,
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
): WeaponKind {
  if (!switchState.active) {
    return weapon.getActiveWeapon();
  }
  return switchState.progress < 0.5 ? switchState.from : switchState.to;
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
  collisionRects,
  worldBounds,
  audioVolumes,
  presentation,
  sensitivity,
  keybinds,
  crouchMode,
  fov,
  weaponAlignment,
  movement,
  weaponRecoilProfiles,
  targets,
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
  onCriticalAssetsReadyChange,
}: GameplayRuntimeProps, ref) {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);

  const {
    model: characterModel,
    ready: characterReady,
    setAnimState: setCharacterAnim,
    getFootstepSample,
  } = useCharacterModel();
  const weaponModels = useWeaponModels();
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
  const audioRef = useRef(sharedAudioManager);
  const controllerRef = useRef<PlayerControllerApi | null>(null);
  const targetsRef = useRef(targets);
  const [impactMarks, setImpactMarks] = useState<BulletImpactMark[]>([]);
  const [bloodSplats, setBloodSplats] = useState<BloodSplatMark[]>([]);

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
  const rifleRunHeadingYawRef = useRef(PLAYER_SPAWN_YAW);
  const crouchTransitionStateRef = useRef<CrouchTransitionState>("idle");
  const crouchTransitionStartedAtRef = useRef(0);
  const crouchTransitionDurationRef = useRef(0);
  const crouchTransitionUseRifleRef = useRef(false);
  const crouchTransitionPoseFromRef = useRef(0);
  const wasCrouchedRef = useRef(false);
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
  const unarmedWalkStateRef = useRef<UnarmedWalkVisualState>("idle");
  const unarmedWalkStateUntilRef = useRef(0);
  const lastCharacterAnimStateRef = useRef<CharacterAnimState>("idle");
  const lastPlanarPositionRef = useRef(
    new THREE.Vector2(PLAYER_SPAWN_POSITION.x, PLAYER_SPAWN_POSITION.z),
  );

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
  const tracerRef = useRef<THREE.Mesh>(null);

  const tempEndRef = useRef(new THREE.Vector3());
  const tempMidRef = useRef(new THREE.Vector3());
  const tempTracerDirRef = useRef(new THREE.Vector3());
  const tempLookDirRef = useRef(new THREE.Vector3());
  const tempAimPointRef = useRef(new THREE.Vector3());
  const tempFireDirectionRef = useRef(new THREE.Vector3());
  const tempTracerOriginRef = useRef(new THREE.Vector3());
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
  const characterWeaponAttachBoneRef = useRef<THREE.Bone | null>(null);
  const characterHeadBoneRef = useRef<THREE.Bone | null>(null);
  const characterUpperTorsoBoneRef = useRef<THREE.Bone | null>(null);
  const characterHeadBaseQuatRef = useRef<THREE.Quaternion | null>(null);
  const characterUpperTorsoBaseQuatRef = useRef<THREE.Quaternion | null>(null);
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
      characterHeadBaseQuatRef.current = null;
      characterUpperTorsoBaseQuatRef.current = null;
      characterWeaponAnchorRef.current = null;
      backWeaponAnchorRef.current = null;
      characterVisibilityMaterialsRef.current = [];
      return;
    }

    let rightHandBone: THREE.Bone | null = null;
    let headBone: THREE.Bone | null = null;
    let upperTorsoBone: THREE.Bone | null = null;
    let upperTorsoPriority = Number.POSITIVE_INFINITY;
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

    characterWeaponAttachBoneRef.current = resolvedRightHandBone;
    characterHeadBoneRef.current = resolvedHeadBone;
    characterUpperTorsoBoneRef.current = resolvedUpperTorsoBone;
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
    if (!resolvedRightHandBone) {
      console.warn(
        "[Character] Could not find right-hand bone for weapon attach",
      );
    }
  }, [characterModel]);

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

  const handleAction = useCallback(
    (action: string) => {
      const weapon = weaponRef.current;
      if (action === "equipRifle") {
        audioRef.current.cancelReload();
        audioRef.current.cancelSniperShelling();
        weapon.setActiveSlot("slotA");
        return;
      }
      if (action === "equipSniper") {
        audioRef.current.cancelReload();
        audioRef.current.cancelSniperShelling();
        weapon.setActiveSlot("slotB");
        return;
      }
      if (action === "reload") {
        weapon.beginReload(performance.now());
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
        weapon.pickSlotNearest(playerPosition);
        return;
      }

      if (action === "drop") {
        camera.getWorldDirection(tempLookDirRef.current);
        weapon.drop(playerPosition, tempLookDirRef.current);
      }
    },
    [camera],
  );

  const handlePlayerSnapshot = useCallback((snapshot: PlayerSnapshot) => {
    const playerPosition = controllerRef.current?.getPosition();
    const pickupState = playerPosition && presentation.inputEnabled
      ? weaponRef.current.getPickupState(playerPosition)
      : { canPickup: false, weaponKind: null };
    const nowMs = performance.now();
    playerSnapshotCallbackRef.current({
      ...snapshot,
      canInteract: pickupState.canPickup,
      interactWeaponKind: pickupState.weaponKind,
      weaponLoadout: weaponRef.current.getLoadoutState(),
      weaponReload: weaponRef.current.getReloadState(nowMs),
    });
  }, [presentation.inputEnabled]);

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
    collisionRects,
    collisionCircles: targetCollisionCircles,
    worldBounds,
    sensitivity,
    keybinds,
    crouchMode,
    fov,
    inputEnabled: presentation.inputEnabled,
    cameraEnabled: presentation.phase === "playing",
    onAction: handleAction,
    onPlayerSnapshot: handlePlayerSnapshot,
    onTriggerChange: handleTriggerChange,
    onUserGesture: handleUserGesture,
    getWeaponEquipped: handleGetWeaponEquipped,
    getActiveWeapon: handleGetActiveWeapon,
  });

  controllerRef.current = controller;

  const resetForMenu = useCallback(() => {
    audioRef.current.cancelReload();
    audioRef.current.cancelSniperShelling();
    weaponRef.current.reset();
    controllerRef.current?.setPose(
      PLAYER_SPAWN_POSITION,
      PLAYER_SPAWN_YAW,
      PLAYER_SPAWN_PITCH,
    );
    setImpactMarks([]);
    setBloodSplats([]);
    impactIdRef.current = 0;
    bloodSplatIdRef.current = 0;
    lastImpactCleanupAtRef.current = performance.now();
    lastWeaponEquippedRef.current = false;
    lastActiveWeaponRef.current = "rifle";
    lastADSRef.current = false;
    lastFirstPersonRef.current = false;
    lastSniperRechamberActiveRef.current = false;
    lastSniperRechamberProgressStepRef.current = 100;
    lastReloadActiveRef.current = false;
    lastReloadWeaponKindRef.current = null;
    rifleFireIntentRef.current = false;
    rifleRunStateRef.current = "idle";
    rifleRunStateUntilRef.current = 0;
    rifleRunInputGraceUntilRef.current = 0;
    rifleRunHeadingYawRef.current = PLAYER_SPAWN_YAW;
    crouchTransitionStateRef.current = "idle";
    crouchTransitionStartedAtRef.current = 0;
    crouchTransitionDurationRef.current = 0;
    crouchTransitionUseRifleRef.current = false;
    crouchTransitionPoseFromRef.current = 0;
    wasCrouchedRef.current = false;
    slideIntentHookRef.current = {
      eligible: false,
      lastIntentAtMs: -1,
      lastIntentSpeed: 0,
      lastIntentYaw: 0,
      lastIntentMoveX: 0,
      lastIntentMoveY: 0,
    };
    locomotionVisualInputRef.current.set(0, 0);
    unarmedWalkStateRef.current = "idle";
    unarmedWalkStateUntilRef.current = 0;
    footstepPhaseRef.current = {
      cycle: 0,
      lastNormalizedTime: 0,
      state: null,
    };
    lastCharacterAnimStateRef.current = "idle";
    lastPlanarPositionRef.current.set(
      PLAYER_SPAWN_POSITION.x,
      PLAYER_SPAWN_POSITION.z,
    );
    controllerRef.current?.setRunFacing("off");
    controllerRef.current?.setMovementProfile({
      walkScale: 1,
      jogScale: 1,
      sprintScale: 1,
      allowSprint: true,
    });
    weaponEquippedCallbackRef.current(false);
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
  }, []);

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
      camera.getWorldDirection(tempLookDirRef.current);
      weaponRef.current.drop(playerPosition, tempLookDirRef.current);
    },
    resetForMenu,
  }), [camera, resetForMenu]);

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
    const weapon = weaponRef.current;
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

    const moving = controller.isMoving() && controller.isGrounded();
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
      (!previousReloadActive || previousReloadWeaponKind !== weaponReload.weaponKind)
    ) {
      audio.playReload(weaponReload.weaponKind, reloadDurationSeconds);
    } else if (previousReloadActive && !reloadVisible) {
      audio.cancelReload();
    }
    lastReloadActiveRef.current = reloadVisible;
    lastReloadWeaponKindRef.current = reloadVisible ? weaponReload.weaponKind : null;
    const adsActive = controller.isADS();
    const firstPerson = controller.isFirstPerson();
    const moveInput = controller.getMoveInput();
    const playerPosition = controller.getPosition();
    const lastPlanarPosition = lastPlanarPositionRef.current;
    const planarDeltaX = playerPosition.x - lastPlanarPosition.x;
    const planarDeltaZ = playerPosition.z - lastPlanarPosition.y;
    const planarSpeed = clampedDelta > 0
      ? Math.hypot(planarDeltaX, planarDeltaZ) / clampedDelta
      : 0;
    lastPlanarPosition.set(playerPosition.x, playerPosition.z);
    const moveX = moveInput.x;
    const moveY = moveInput.y;
    const hasDirectionalInput = Math.abs(moveX) > 0.05 ||
      Math.abs(moveY) > 0.05;
    const movementActive = moving && hasDirectionalInput;
    const visualLocomotionInput = updateVisualLocomotionInput(
      locomotionVisualInputRef.current,
      movementActive,
      moveX,
      moveY,
      clampedDelta,
    );
    const animMoveX = visualLocomotionInput.x;
    const animMoveY = visualLocomotionInput.y;
    const isWeaponHoldEquipped = weaponEquipped;
    const previousRunState = rifleRunStateRef.current;
    const previousCrouched = wasCrouchedRef.current;
    const crouchEntered = crouched && !previousCrouched;
    const crouchExited = !crouched && previousCrouched;
    wasCrouchedRef.current = crouched;
    const slideIntent = slideIntentHookRef.current;
    slideIntent.eligible = isWeaponHoldEquipped &&
      !adsActive &&
      movementActive &&
      controller.isGrounded() &&
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

    if (crouchEntered || crouchExited) {
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
      }
    }
    crouchTransitionStateRef.current = crouchTransitionState;
    crouchTransitionStartedAtRef.current = crouchTransitionStartedAt;
    crouchTransitionDurationRef.current = crouchTransitionDuration;
    crouchTransitionUseRifleRef.current = crouchTransitionUseRifle;
    crouchTransitionPoseFromRef.current = crouchTransitionPoseFrom;

    const firePrepIntent = isWeaponHoldEquipped &&
      !adsActive &&
      !crouched &&
      rifleFireIntentRef.current;
    const firePrepVisual = firePrepIntent && !movementActive;
    const crouchAimCompositeActive = isWeaponHoldEquipped &&
      rifleFireIntentRef.current &&
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

    if (reloadVisible) {
      if (lowerBodyOverlayState) {
        nextAnimState = lowerBodyOverlayState;
        lowerBodyOverlayState = null;
      }
      upperBodyOverlayState = "rifleReload";
      rifleReadyPoseActive = false;
    }

    weapon.setTriggerHeld(rifleFireIntentRef.current);

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
    const movementProfileRunScale = THREE.MathUtils.lerp(
      standingRunScale,
      crouchSpeedScale,
      crouchPose,
    );
    const movementProfileAllowSprint = !adsActive &&
      !firePrepIntent &&
      crouchPose < CROUCH_SPRINT_RELEASE_POSE;
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
    const locomotionReferenceSpeed = runVisualState
      ? PLAYER_SPRINT_SPEED * movementProfileRunScale
      : PLAYER_WALK_SPEED * (
        !weaponEquipped && useUnarmedWalkLocomotion
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
      upperBodyLocomotionScale: characterLocomotionScale,
      upperBodySeekNormalizedTime: reloadVisible
        ? weaponReload.progress
        : undefined,
      upperBodyDesiredDurationSeconds: reloadVisible
        ? reloadDurationSeconds
        : undefined,
      upperBodyFadeDurationSeconds: reloadVisible ? 0.08 : undefined,
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
    const shoeVisibility = firstPersonBodyMaskBlend *
      downLookAmount *
      (controller.isGrounded() ? 1 : 0);
    const gloveVisibility = firstPersonBodyMaskBlend *
      THREE.MathUtils.lerp(1, 0.88, downLookAmount);
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
      const mixer = characterModel.userData.__mixer as
        | THREE.AnimationMixer
        | undefined;
      if (mixer) {
        mixer.update(clampedDelta);
      }
      if (
        consumeFootstepTrigger(footstepPhaseRef.current, getFootstepSample())
      ) {
        audio.playFootstep(footstepPlaybackRate);
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
    }

    const headBone = characterHeadBoneRef.current;
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
          ? RIFLE_READY_YAW_TORSO_FRACTION
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
      adsActive,
      leanValue,
    );

    const weaponSprinting = !weaponEquipped
      ? sprinting
      : nextAnimState === "rifleRun" ||
        nextAnimState === "rifleRunStart" ||
        nextAnimState === "rifleRunStop";
    weapon.setMovementState(movementActive, weaponSprinting);
    const shots = weapon.update(clampedDelta, nowMs, camera);
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

      const cameraTargetHit = raycastTargets(
        shot.origin,
        shot.direction,
        targetsRef.current,
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
      const muzzle = characterMuzzleRef.current;
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
      const targetHit = raycastTargets(
        tracerOrigin,
        fireDirection,
        targetsRef.current,
        maxFireDistance,
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
      const cameraTargetReachableFromMuzzle = !!cameraTargetHit &&
        (!worldHit ||
          cameraTargetDistanceFromMuzzle <=
            worldHit.distance + BULLET_HIT_EPSILON);
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
        hitMarkerCallbackRef.current(markerKind);
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
    const displayedWeapon = resolveDisplayedWeapon(weapon, switchState);
    const showBackSlots = presentation.phase === "playing" && !firstPerson;
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
        displayedWeapon !== "rifle",
      switchState,
      -1,
      backWeaponAnchor,
    );
    updateBackWeaponMesh(
      backSniperSlotRef.current,
      showBackSlots &&
        worldState.loadout.slotB.hasWeapon &&
        displayedWeapon !== "sniper",
      switchState,
      1,
      backWeaponAnchor,
    );

    updateWorldWeaponMesh(
      worldRiflePickupRef.current,
      worldState.rifle.isPresentOnGround,
      worldState.rifle.droppedPosition,
      presentation.pickupReveal,
      -Math.PI / 2,
    );
    updateWorldWeaponMesh(
      worldSniperPickupRef.current,
      worldState.sniper.isPresentOnGround,
      worldState.sniper.droppedPosition,
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
        .addScaledVector(right, swayX * MENU_SIDE_DRIFT);
      frontPos.y = position.y + MENU_FRONT_HEIGHT + swayY * MENU_VERTICAL_DRIFT;
      const frontLook = transitionFrontLookRef.current.copy(position);
      frontLook.y = position.y + MENU_LOOK_HEIGHT;
      frontLook.addScaledVector(right, swayX * MENU_LOOK_DRIFT);
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
        keyLight.intensity = 5.0 * menuLightBlend;
        keyLight.position.copy(frontPos);
        keyLight.position.y += 0.34;
        keyLight.position.addScaledVector(right, 0.14);
      }

      const rimLight = menuCharacterRimLightRef.current;
      if (rimLight) {
        rimLight.visible = menuLightBlend > 0.001;
        rimLight.intensity = 0.85 * menuLightBlend;
        rimLight.position.copy(position);
        rimLight.position.addScaledVector(forward, -1.55);
        rimLight.position.addScaledVector(right, -0.8);
        rimLight.position.y = position.y + 1.86;
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
          ? THREE.MathUtils.lerp(40, fov, easeInOutCubic(phaseProgress))
          : presentation.phase === "returning"
          ? THREE.MathUtils.lerp(fov, 40, easeInOutCubic(phaseProgress))
          : 40;
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

    if (perfAccumulatorRef.current >= 0.2) {
      const fps = fpsTimeRef.current > 0
        ? fpsFrameCountRef.current / fpsTimeRef.current
        : 0;
      perfCallbackRef.current({
        fps,
        frameMs: clampedDelta * 1000,
        drawCalls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
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
