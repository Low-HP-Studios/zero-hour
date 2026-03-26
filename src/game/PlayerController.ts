import { useCallback, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GamepadManager, type GamepadFrameState } from './GamepadManager';
import {
  sampleWalkableSurfaceHeight,
  type BlockingVolume,
  type WalkableSurface,
} from './map-layout';
import type { WeaponKind } from './Weapon';
import {
  type AimSensitivitySettings,
  type CollisionCircle,
  type CollisionRect,
  type ControlBindings,
  type ControllerSettings,
  type CrouchMode,
  DEFAULT_PLAYER_SNAPSHOT,
  type InventoryOpenMode,
  type MovementTier,
  type PlayerSnapshot,
  type WorldBounds,
} from './types';
import {
  isSprintInputEligible,
  resolveDesiredPlanarVelocity,
  resolveJumpTakeoffMomentum,
  resolveSprintMomentumActive,
  stepAirbornePlanarVelocity,
  stepGroundedPlanarVelocity,
} from './movement';

type PlayerAction =
  | 'pickup'
  | 'drop'
  | 'unarm'
  | 'reload'
  | 'reset'
  | 'equipRifle'
  | 'equipSniper';

type MovementProfile = {
  walkScale: number;
  jogScale: number;
  sprintScale: number;
  allowSprint: boolean;
};

type UsePlayerControllerOptions = {
  collisionRects: CollisionRect[];
  collisionCircles: CollisionCircle[];
  blockingVolumes?: readonly BlockingVolume[];
  worldBounds: WorldBounds;
  spawnPosition: [number, number, number];
  groundLevelY?: number;
  walkableSurfaces?: readonly WalkableSurface[];
  spawnYaw: number;
  spawnPitch: number;
  sensitivity: AimSensitivitySettings;
  controllerSettings: ControllerSettings;
  keybinds: ControlBindings;
  crouchMode: CrouchMode;
  inventoryOpenMode: InventoryOpenMode;
  fov: number;
  inputEnabled: boolean;
  gameplayInputEnabled: boolean;
  cameraEnabled: boolean;
  allowLean?: boolean;
  onAction: (action: PlayerAction) => void;
  onPlayerSnapshot: (snapshot: PlayerSnapshot) => void;
  onTriggerChange: (firing: boolean) => void;
  onUserGesture: () => void;
  getWeaponEquipped: () => boolean;
  getActiveWeapon: () => WeaponKind;
  getIsWeaponBusy: () => boolean;
  onPauseMenuToggle?: () => void;
};

export type RunFacingPhase = 'off' | 'start' | 'running' | 'stop';

export type PlayerControllerApi = {
  addRecoil: (pitchRadians: number, yawRadians: number) => void;
  alignBodyToAim: (durationMs?: number) => void;
  getPosition: () => THREE.Vector3;
  getYaw: () => number;
  getAimYaw: () => number;
  getBodyYaw: () => number;
  getHeadYawOffset: () => number;
  getPitch: () => number;
  getLeanValue: () => number;
  getPlanarVelocity: () => THREE.Vector2;
  getPlanarSpeed: () => number;
  getMoveInput: () => THREE.Vector2;
  isFirstPerson: () => boolean;
  getViewModeLerp: () => number;
  isADS: () => boolean;
  getAdsLerp: () => number;
  getSniperZoom: () => number;
  isSprinting: () => boolean;
  isSprintPressed: () => boolean;
  isWalkPressed: () => boolean;
  isCrouched: () => boolean;
  isCrouchKeyHeld: () => boolean;
  isMoving: () => boolean;
  isGrounded: () => boolean;
  getMovementTier: () => MovementTier;
  setRunFacing: (phase: RunFacingPhase, headingYaw?: number) => void;
  setMovementProfile: (profile: Partial<MovementProfile>) => void;
  requestPointerLock: () => void;
  releasePointerLock: () => void;
  setPose: (
    position: THREE.Vector3,
    yawRadians: number,
    pitchRadians?: number,
  ) => void;
};

type KeyState = Record<string, boolean>;

const PLAYER_RADIUS = 0.35;
const WALK_SPEED = 5.3;
const SPRINT_SPEED = 8.2;
const LOOK_SENSITIVITY = 0.0022;
const MAX_PITCH = 0.85;
const MIN_PITCH = -1.5;
const GRAVITY_UP = -28;
const GRAVITY_PEAK = -16;
const GRAVITY_DOWN = -48;
const PEAK_VELOCITY_THRESHOLD = 1.4;
const JUMP_SPEED = 7.8;
const JUMP_PENALTY_PER_CONSECUTIVE = 0.12;
const MAX_CONSECUTIVE_JUMP_PENALTY = 0.4;
const CONSECUTIVE_JUMP_RESET_MS = 800;
const PLAYER_STAND_HEIGHT = 1.78;
const PLAYER_CROUCH_HEIGHT = 1.16;
const GROUND_STEP_UP_HEIGHT = 0.9;
const GROUND_STEP_DOWN_HEIGHT = 1.8;
const BLOCKING_TOP_EPSILON = 0.001;
const BLOCKING_TOP_MIN_WIDTH = 1.1;

const CAMERA_ARM_LENGTH = 2.25;
const CAMERA_ARM_LENGTH_ADS = 0.0;
const CAMERA_ARM_LENGTH_SNIPER_ADS = 0.78;
const CAMERA_HEIGHT_BIAS = 0.55;
const CAMERA_ARM_PITCH_SHORTEN = 0.3;
const CAMERA_MIN_ARM_SCALE = 0.55;
const CAMERA_MIN_Y_ABOVE_FEET = 0.5;
const LOOK_AT_HEIGHT = 1.2;
const SHOULDER_OFFSET = 0.2;
const SHOULDER_OFFSET_ADS = 0.2;
const SHOULDER_OFFSET_SNIPER_ADS = 0.16;
const AIM_LOOK_DISTANCE = 120;
const FIRST_PERSON_CAMERA_HEIGHT = 1.4;
// Keep crouched FPP above the upper torso so recoil does not drive the camera into the rig.
const FIRST_PERSON_CAMERA_HEIGHT_CROUCH = 1.08;
const TPP_CROUCH_LOOK_HEIGHT_OFFSET = -0.3;
const FIRST_PERSON_CAMERA_FORWARD_OFFSET = 0.06;
const RIFLE_ADS_FOV = 52;
const SNIPER_ADS_FOV = 32;
const VIEW_MODE_TRANSITION_SPEED = 13;
const CROUCH_TRANSITION_SPEED = 14;
const TPP_CROUCH_CAMERA_TRANSITION_SPEED = 12;
const TPP_CROUCH_CAMERA_ACTIVATION_THRESHOLD = 0.98;
const CROUCH_SPRINT_LOCK_THRESHOLD = 0.35;
const BODY_YAW_DAMP = 14;
const RUN_BODY_YAW_DAMP = 24;
const RUN_TRANSITION_BODY_YAW_DAMP = 16;
const ADS_BODY_YAW_DAMP = 22;
const SHOOT_BODY_YAW_DAMP = 34;
const SHOOT_ALIGN_WINDOW_MS = 180;
const CAMERA_BLOCKING_MARGIN = 0.38;
const HEAD_TURN_DEAD_ZONE = THREE.MathUtils.degToRad(45);

const cameraClipDir = new THREE.Vector3();
const cameraClipBoxMin = new THREE.Vector3();
const cameraClipBoxMax = new THREE.Vector3();

function rayAabbIntersectEnterDistance(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxT: number,
  boxMin: THREE.Vector3,
  boxMax: THREE.Vector3,
): number | null {
  let tMin = 0;
  let tMax = maxT;
  for (let i = 0; i < 3; i++) {
    const o = origin.getComponent(i);
    const d = dir.getComponent(i);
    const mn = boxMin.getComponent(i);
    const mx = boxMax.getComponent(i);
    if (Math.abs(d) < 1e-8) {
      if (o < mn || o > mx) return null;
      continue;
    }
    const invD = 1 / d;
    let t0 = (mn - o) * invD;
    let t1 = (mx - o) * invD;
    if (t0 > t1) {
      const s = t0;
      t0 = t1;
      t1 = s;
    }
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMin > tMax) return null;
  }
  if (tMin > maxT) return null;
  if (tMin < 0) {
    if (tMax < 0 || tMax > maxT) return null;
    return 0;
  }
  return tMin;
}

function clipThirdPersonCameraToVolumes(
  origin: THREE.Vector3,
  target: THREE.Vector3,
  volumes: readonly BlockingVolume[],
  margin: number,
  out: THREE.Vector3,
): void {
  cameraClipDir.subVectors(target, origin);
  const maxDist = cameraClipDir.length();
  if (maxDist < 1e-4) {
    out.copy(target);
    return;
  }
  cameraClipDir.normalize();
  let minHit = maxDist;
  for (const volume of volumes) {
    const hx = volume.size[0] / 2;
    const hy = volume.size[1] / 2;
    const hz = volume.size[2] / 2;
    cameraClipBoxMin.set(
      volume.center[0] - hx,
      volume.center[1] - hy,
      volume.center[2] - hz,
    );
    cameraClipBoxMax.set(
      volume.center[0] + hx,
      volume.center[1] + hy,
      volume.center[2] + hz,
    );
    const t = rayAabbIntersectEnterDistance(
      origin,
      cameraClipDir,
      maxDist,
      cameraClipBoxMin,
      cameraClipBoxMax,
    );
    if (t !== null && t > 0.02 && t < minHit) {
      minHit = t;
    }
  }
  if (minHit >= maxDist - 1e-3) {
    out.copy(target);
    return;
  }
  const dist = Math.max(0.12, minHit - margin);
  out.copy(origin).addScaledVector(cameraClipDir, Math.min(dist, maxDist));
}
const MAX_FREE_LOOK_YAW_OFFSET = THREE.MathUtils.degToRad(120);
const FORWARD_DIAGONAL_BODY_YAW_THRESHOLD = 0.35;
const DIAGONAL_BODY_YAW_OFFSET = THREE.MathUtils.degToRad(30);
const LEAN_TRANSITION_SPEED = 10;
const LEAN_CAMERA_OFFSET_X = 0.54;
const LEAN_CAMERA_TILT = THREE.MathUtils.degToRad(14.4);
// Hide the character early on FPP enter and show it later on FPP exit to reduce camera/model popping.
const FPP_ENTER_VISUAL_THRESHOLD = 0.35;
const FPP_EXIT_VISUAL_THRESHOLD = 0.75;
const CONTROLLER_WALK_THRESHOLD = 0.5;
const CONTROLLER_LOOK_SPEED_X = THREE.MathUtils.degToRad(220);
const CONTROLLER_LOOK_SPEED_Y = THREE.MathUtils.degToRad(160);
const CONTROLLER_INPUT_EPSILON = 0.001;

export function usePlayerController({
  collisionRects,
  collisionCircles,
  blockingVolumes,
  worldBounds,
  spawnPosition,
  groundLevelY,
  walkableSurfaces,
  spawnYaw,
  spawnPitch,
  sensitivity,
  controllerSettings,
  keybinds,
  crouchMode,
  inventoryOpenMode,
  fov,
  inputEnabled,
  gameplayInputEnabled,
  cameraEnabled,
  allowLean = true,
  onAction,
  onPlayerSnapshot,
  onTriggerChange,
  onUserGesture,
  getWeaponEquipped,
  getActiveWeapon,
  getIsWeaponBusy,
  onPauseMenuToggle,
}: UsePlayerControllerOptions): PlayerControllerApi {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const initialGroundY = groundLevelY ?? spawnPosition[1];

  const keyStateRef = useRef<KeyState>({});
  const positionRef = useRef(
    new THREE.Vector3(spawnPosition[0], spawnPosition[1], spawnPosition[2]),
  );
  const velocityRef = useRef(new THREE.Vector2(0, 0));
  const desiredPlanarVelocityRef = useRef(new THREE.Vector2(0, 0));
  const moveInputRef = useRef(new THREE.Vector2(0, 0));
  const sprintPressedRef = useRef(false);
  const walkPressedRef = useRef(false);
  const controllerSprintToggleRef = useRef(false);
  const crouchedRef = useRef(false);
  const resolvedXZRef = useRef(
    new THREE.Vector2(spawnPosition[0], spawnPosition[2]),
  );
  const pointerLockedRef = useRef(false);
  const triggerHeldRef = useRef(false);
  const mouseTriggerHeldRef = useRef(false);
  const controllerTriggerHeldRef = useRef(false);
  const movementProfileRef = useRef<MovementProfile>({
    walkScale: 1,
    jogScale: 1,
    sprintScale: 1,
    allowSprint: true,
  });
  const movingRef = useRef(false);
  const sprintingRef = useRef(false);
  const planarSpeedRef = useRef(0);
  const movementTierRef = useRef<MovementTier>('jog');
  const groundedRef = useRef(true);
  const verticalVelocityRef = useRef(0);
  const airborneMomentumSpeedRef = useRef(0);
  const sprintMomentumRef = useRef(false);
  const jumpQueuedRef = useRef(false);
  const lastLandedAtRef = useRef(0);
  const consecutiveJumpsRef = useRef(0);
  const yawRef = useRef(spawnYaw);
  const bodyYawRef = useRef(spawnYaw);
  const pitchRef = useRef(spawnPitch);
  const targetYawRef = useRef(spawnYaw);
  const targetBodyYawRef = useRef(spawnYaw);
  const shootAlignUntilRef = useRef(0);
  const runFacingPhaseRef = useRef<RunFacingPhase>('off');
  const runFacingYawRef = useRef(spawnYaw);
  const headYawOffsetRef = useRef(0);
  const targetPitchRef = useRef(0);
  const pendingMouseRef = useRef(new THREE.Vector2(0, 0));
  const recoilPitchRef = useRef(0);
  const recoilYawRef = useRef(0);
  const firstPersonRef = useRef(false);
  const adsRef = useRef(false);
  const mouseAdsHeldRef = useRef(false);
  const controllerAdsHeldRef = useRef(false);
  const adsLerpRef = useRef(0);
  const crouchLerpRef = useRef(0);
  const crouchCameraLerpRef = useRef(0);
  const viewModeLerpRef = useRef(0);
  const crouchModeRef = useRef<CrouchMode>(crouchMode);
  const crouchHoldLatchRef = useRef(false);
  const inventoryPanelOpenRef = useRef(false);
  const inventoryRestorePointerLockRef = useRef(false);
  const controllerInventoryHeldRef = useRef(false);
  const inventoryOpenModeRef = useRef<InventoryOpenMode>(inventoryOpenMode);
  const leanTargetRef = useRef(0);
  const leanLerpRef = useRef(0);
  const sniperZoomRef = useRef(1); // 1 = default, 2 = 2x zoom
  const tempLookAtRef = useRef(new THREE.Vector3());
  const tempAimDirRef = useRef(new THREE.Vector3());
  const tempFirstPersonCameraPosRef = useRef(new THREE.Vector3());
  const tempThirdPersonCameraPosRef = useRef(new THREE.Vector3());
  const cameraClipEyeRef = useRef(new THREE.Vector3());
  const cameraClipOutRef = useRef(new THREE.Vector3());
  const snapshotAccumulatorRef = useRef(0);
  const snapshotObjectRef = useRef<PlayerSnapshot>({
    ...DEFAULT_PLAYER_SNAPSHOT,
  });
  const actionCallbackRef = useRef(onAction);
  const triggerCallbackRef = useRef(onTriggerChange);
  const snapshotCallbackRef = useRef(onPlayerSnapshot);
  const userGestureCallbackRef = useRef(onUserGesture);
  const weaponEquippedGetterRef = useRef(getWeaponEquipped);
  const activeWeaponGetterRef = useRef(getActiveWeapon);
  const weaponBusyGetterRef = useRef(getIsWeaponBusy);
  const sensitivityRef = useRef(sensitivity);
  const controllerSettingsRef = useRef(controllerSettings);
  const keybindsRef = useRef(keybinds);
  const crouchModeSettingRef = useRef(crouchMode);
  const inventoryOpenModeSettingRef = useRef(inventoryOpenMode);
  const fovRef = useRef(fov);
  const inputEnabledRef = useRef(inputEnabled);
  const gameplayInputEnabledRef = useRef(gameplayInputEnabled);
  const cameraEnabledRef = useRef(cameraEnabled);
  const groundLevelYRef = useRef(initialGroundY);
  const walkableSurfacesRef = useRef(walkableSurfaces ?? []);
  const blockingVolumesRef = useRef(blockingVolumes ?? []);
  const onPauseMenuToggleRef = useRef(onPauseMenuToggle);
  const gamepadManagerRef = useRef(new GamepadManager());
  const gamepadFrameStateRef = useRef<GamepadFrameState>({
    connected: false,
    moveX: 0,
    moveY: 0,
    moveMagnitude: 0,
    lookX: 0,
    lookY: 0,
    lookMagnitude: 0,
    fireHeld: false,
    adsHeld: false,
    sprintHeld: false,
    crouchHeld: false,
    inventoryHeld: false,
    jumpPressed: false,
    sprintPressed: false,
    crouchPressed: false,
    reloadPressed: false,
    toggleViewPressed: false,
    equipRiflePressed: false,
    equipSniperPressed: false,
    pickupPressed: false,
    dropPressed: false,
    inventoryPressed: false,
    pausePressed: false,
  });

  const syncTriggerHeld = useCallback((nextHeld: boolean) => {
    if (triggerHeldRef.current === nextHeld) {
      return;
    }
    triggerHeldRef.current = nextHeld;
    triggerCallbackRef.current(nextHeld);
  }, []);

  const clearHeldCombatInput = useCallback(() => {
    mouseTriggerHeldRef.current = false;
    controllerTriggerHeldRef.current = false;
    mouseAdsHeldRef.current = false;
    controllerAdsHeldRef.current = false;
    adsRef.current = false;
    syncTriggerHeld(false);
  }, [syncTriggerHeld]);

  const requestLock = useCallback((element: HTMLElement) => {
    if (document.pointerLockElement === element) return;
    if (document.pointerLockElement !== null) return;
    element.requestPointerLock();
  }, []);

  const closeInventoryPanel = useCallback((
    restorePointerLock = inventoryRestorePointerLockRef.current,
  ) => {
    if (!inventoryPanelOpenRef.current) {
      return;
    }
    inventoryPanelOpenRef.current = false;
    if (
      restorePointerLock &&
      inputEnabledRef.current &&
      gameplayInputEnabledRef.current &&
      document.pointerLockElement !== gl.domElement &&
      document.visibilityState === 'visible'
    ) {
      requestLock(gl.domElement);
    }
    inventoryRestorePointerLockRef.current = false;
  }, [gl.domElement, requestLock]);

  const openInventoryPanel = useCallback(() => {
    inventoryRestorePointerLockRef.current =
      document.pointerLockElement === gl.domElement;
    inventoryPanelOpenRef.current = true;
    clearHeldCombatInput();
    if (document.pointerLockElement === gl.domElement) {
      document.exitPointerLock();
    }
  }, [clearHeldCombatInput, gl.domElement]);

  useEffect(() => {
    onPauseMenuToggleRef.current = onPauseMenuToggle;
  }, [onPauseMenuToggle]);

  useEffect(() => {
    actionCallbackRef.current = onAction;
  }, [onAction]);

  useEffect(() => {
    triggerCallbackRef.current = onTriggerChange;
  }, [onTriggerChange]);

  useEffect(() => {
    snapshotCallbackRef.current = onPlayerSnapshot;
  }, [onPlayerSnapshot]);

  useEffect(() => {
    userGestureCallbackRef.current = onUserGesture;
  }, [onUserGesture]);

  useEffect(() => {
    weaponEquippedGetterRef.current = getWeaponEquipped;
  }, [getWeaponEquipped]);

  useEffect(() => {
    activeWeaponGetterRef.current = getActiveWeapon;
  }, [getActiveWeapon]);

  useEffect(() => {
    weaponBusyGetterRef.current = getIsWeaponBusy;
  }, [getIsWeaponBusy]);

  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);

  useEffect(() => {
    controllerSettingsRef.current = controllerSettings;
    if (!controllerSettings.toggleSprint) {
      controllerSprintToggleRef.current = false;
    }
  }, [controllerSettings]);

  useEffect(() => {
    keybindsRef.current = keybinds;
  }, [keybinds]);

  useEffect(() => {
    crouchModeSettingRef.current = crouchMode;
    crouchModeRef.current = crouchMode;
    crouchHoldLatchRef.current = false;
    if (
      crouchMode === 'hold' &&
      !isBindingDown(keyStateRef.current, keybindsRef.current.crouch) &&
      !gamepadFrameStateRef.current.crouchHeld
    ) {
      crouchedRef.current = false;
    }
  }, [crouchMode]);

  useEffect(() => {
    inventoryOpenModeSettingRef.current = inventoryOpenMode;
    inventoryOpenModeRef.current = inventoryOpenMode;
  }, [inventoryOpenMode]);

  useEffect(() => {
    fovRef.current = fov;
  }, [fov]);

  useEffect(() => {
    inputEnabledRef.current = inputEnabled;
    if (!inputEnabled) {
      keyStateRef.current = {};
      jumpQueuedRef.current = false;
      crouchedRef.current = false;
      crouchHoldLatchRef.current = false;
      controllerInventoryHeldRef.current = false;
      inventoryPanelOpenRef.current = false;
      sprintPressedRef.current = false;
      walkPressedRef.current = false;
      controllerSprintToggleRef.current = false;
      movementTierRef.current = 'jog';
      shootAlignUntilRef.current = 0;
      runFacingPhaseRef.current = 'off';
      runFacingYawRef.current = bodyYawRef.current;
      headYawOffsetRef.current = 0;
      leanTargetRef.current = 0;
      leanLerpRef.current = 0;
      clearHeldCombatInput();
      if (document.pointerLockElement === gl.domElement) {
        document.exitPointerLock();
      }
    }
  }, [clearHeldCombatInput, gl.domElement, inputEnabled]);

  useEffect(() => {
    gameplayInputEnabledRef.current = gameplayInputEnabled;
    if (!gameplayInputEnabled) {
      keyStateRef.current = {};
      jumpQueuedRef.current = false;
      crouchedRef.current = false;
      crouchHoldLatchRef.current = false;
      controllerInventoryHeldRef.current = false;
      inventoryPanelOpenRef.current = false;
      sprintPressedRef.current = false;
      walkPressedRef.current = false;
      controllerSprintToggleRef.current = false;
      movementTierRef.current = 'jog';
      shootAlignUntilRef.current = 0;
      runFacingPhaseRef.current = 'off';
      runFacingYawRef.current = bodyYawRef.current;
      headYawOffsetRef.current = 0;
      leanTargetRef.current = 0;
      leanLerpRef.current = 0;
      clearHeldCombatInput();
    }
  }, [clearHeldCombatInput, gameplayInputEnabled]);

  useEffect(() => {
    cameraEnabledRef.current = cameraEnabled;
  }, [cameraEnabled]);

  useEffect(() => {
    groundLevelYRef.current = groundLevelY ?? spawnPosition[1];
  }, [groundLevelY, spawnPosition]);

  useEffect(() => {
    walkableSurfacesRef.current = walkableSurfaces ?? [];
  }, [walkableSurfaces]);

  useEffect(() => {
    blockingVolumesRef.current = blockingVolumes ?? [];
  }, [blockingVolumes]);

  useEffect(() => {
    const element = gl.domElement;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!inputEnabledRef.current) {
        return;
      }

      if (event.code === 'Escape' && !event.repeat && onPauseMenuToggleRef.current) {
        event.preventDefault();
        onPauseMenuToggleRef.current();
        return;
      }

      if (!gameplayInputEnabledRef.current) {
        return;
      }

      const bindings = keybindsRef.current;
      const crouchBinding = bindings.crouch;

      keyStateRef.current[event.code] = true;

      if (event.code === bindings.pickup && !event.repeat) {
        actionCallbackRef.current('pickup');
      }
      if (event.code === bindings.drop && !event.repeat) {
        actionCallbackRef.current('drop');
      }
      if (event.code === bindings.unarm && !event.repeat) {
        actionCallbackRef.current('unarm');
      }
      if (event.code === bindings.reload && !event.repeat) {
        actionCallbackRef.current('reload');
      }
      if (
        event.code === bindings.reset &&
        !event.repeat &&
        event.code !== bindings.reload
      ) {
        actionCallbackRef.current('reset');
      }
      if (event.code === bindings.equipRifle && !event.repeat) {
        actionCallbackRef.current('equipRifle');
      }
      if (event.code === bindings.equipSniper && !event.repeat) {
        actionCallbackRef.current('equipSniper');
      }
      if (event.code === bindings.toggleView && !event.repeat) {
        firstPersonRef.current = !firstPersonRef.current;
      }
      if (event.code === bindings.tab) {
        event.preventDefault();
        if (inventoryOpenModeSettingRef.current === 'toggle') {
          if (!event.repeat) {
            if (inventoryPanelOpenRef.current) {
              closeInventoryPanel();
            } else {
              openInventoryPanel();
            }
          }
        } else {
          openInventoryPanel();
        }
      }

      if (
        event.code === crouchBinding &&
        (pointerLockedRef.current || inventoryPanelOpenRef.current)
      ) {
        if (crouchModeSettingRef.current === 'toggle') {
          if (!event.repeat) {
            crouchedRef.current = !crouchedRef.current;
          }
        } else if (!crouchHoldLatchRef.current) {
          crouchedRef.current = true;
        }
      }

      if (
        event.code === bindings.jump &&
        !event.repeat &&
        (pointerLockedRef.current || inventoryPanelOpenRef.current) &&
        groundedRef.current
      ) {
        if (crouchedRef.current) {
          crouchedRef.current = false;
          if (
            crouchModeSettingRef.current === 'hold' &&
            isBindingDown(keyStateRef.current, crouchBinding)
          ) {
            crouchHoldLatchRef.current = true;
          }
          jumpQueuedRef.current = false;
          return;
        }
        jumpQueuedRef.current = true;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      keyStateRef.current[event.code] = false;
      if (event.code === keybindsRef.current.crouch) {
        crouchHoldLatchRef.current = false;
        if (crouchModeSettingRef.current === 'hold') {
          crouchedRef.current = false;
        }
      }
      if (event.code === keybindsRef.current.tab) {
        if (inventoryOpenModeSettingRef.current === 'hold') {
          closeInventoryPanel();
        }
      }
    };

    const onMouseDown = (event: MouseEvent) => {
      if (!inputEnabledRef.current || !gameplayInputEnabledRef.current) {
        return;
      }
      if (inventoryPanelOpenRef.current) {
        return;
      }
      if (event.button === 2) {
        mouseAdsHeldRef.current =
          pointerLockedRef.current &&
          weaponEquippedGetterRef.current() &&
          !weaponBusyGetterRef.current();
        return;
      }

      if (event.button !== 0) {
        return;
      }

      userGestureCallbackRef.current();

      if (!pointerLockedRef.current) {
        requestLock(element);
        return;
      }

      mouseTriggerHeldRef.current = true;
      syncTriggerHeld(true);
    };

    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 2) {
        mouseAdsHeldRef.current = false;
        if (!controllerAdsHeldRef.current) {
          adsRef.current = false;
        }
        return;
      }

      if (event.button !== 0) {
        return;
      }

      mouseTriggerHeldRef.current = false;
      syncTriggerHeld(controllerTriggerHeldRef.current);
    };

    const onContextMenu = (event: Event) => {
      event.preventDefault();
    };

    const onWheel = (event: WheelEvent) => {
      if (
        !pointerLockedRef.current ||
        !inputEnabledRef.current ||
        !gameplayInputEnabledRef.current
      ) return;
      if (!adsRef.current || activeWeaponGetterRef.current() !== 'sniper') return;
      event.preventDefault();
      if (event.deltaY < 0) {
        // Scroll up → zoom in
        sniperZoomRef.current = Math.min(2, sniperZoomRef.current + 0.25);
      } else if (event.deltaY > 0) {
        // Scroll down → zoom out
        sniperZoomRef.current = Math.max(1, sniperZoomRef.current - 0.25);
      }
    };

    const onMouseMove = (event: MouseEvent) => {
      if (
        !pointerLockedRef.current ||
        !inputEnabledRef.current ||
        !gameplayInputEnabledRef.current
      ) {
        return;
      }

      pendingMouseRef.current.x += event.movementX;
      pendingMouseRef.current.y += event.movementY;
    };

    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === element;
      pointerLockedRef.current = locked;
      if (locked) {
        userGestureCallbackRef.current();
      }
      if (!locked) {
        mouseTriggerHeldRef.current = false;
        mouseAdsHeldRef.current = false;
        clearHeldCombatInput();
      }
      if (!locked) {
        if (!inventoryPanelOpenRef.current) {
          keyStateRef.current = {};
          jumpQueuedRef.current = false;
          crouchedRef.current = false;
          crouchHoldLatchRef.current = false;
          sprintPressedRef.current = false;
          walkPressedRef.current = false;
          sprintMomentumRef.current = false;
          movementTierRef.current = 'jog';
          shootAlignUntilRef.current = 0;
          runFacingPhaseRef.current = 'off';
          runFacingYawRef.current = bodyYawRef.current;
          headYawOffsetRef.current = 0;
          leanTargetRef.current = 0;
          leanLerpRef.current = 0;
          controllerInventoryHeldRef.current = false;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    element.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    element.addEventListener('contextmenu', onContextMenu);
    element.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('pointerlockchange', onPointerLockChange);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      element.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      element.removeEventListener('contextmenu', onContextMenu);
      element.removeEventListener('wheel', onWheel);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
    };
  }, [
    clearHeldCombatInput,
    closeInventoryPanel,
    gl.domElement,
    openInventoryPanel,
    requestLock,
    syncTriggerHeld,
  ]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 20);
    const nowMs = performance.now();
    const keys = keyStateRef.current;
    const controllerState = gamepadManagerRef.current.poll(
      controllerSettingsRef.current,
    );
    gamepadFrameStateRef.current = controllerState;
    const gameplayInputEnabled = gameplayInputEnabledRef.current;
    const controllerConnected = controllerState.connected;
    const keyboardMovementEnabled =
      gameplayInputEnabled && (pointerLockedRef.current || inventoryPanelOpenRef.current);
    const controllerMovementEnabled =
      gameplayInputEnabled && controllerConnected;
    const weaponEquipped = weaponEquippedGetterRef.current();
    const activeWeapon = activeWeaponGetterRef.current();
    const weaponBusy = weaponBusyGetterRef.current();
    const controllerSettingsValue = controllerSettingsRef.current;

    if (
      controllerConnected &&
      inputEnabledRef.current &&
      (controllerState.pausePressed ||
        controllerState.inventoryPressed ||
        controllerState.jumpPressed ||
        controllerState.crouchPressed ||
        controllerState.reloadPressed ||
        controllerState.toggleViewPressed ||
        controllerState.equipRiflePressed ||
        controllerState.equipSniperPressed ||
        controllerState.pickupPressed ||
        controllerState.dropPressed ||
        controllerState.fireHeld ||
        controllerState.adsHeld ||
        controllerState.sprintHeld)
    ) {
      userGestureCallbackRef.current();
    }

    if (controllerState.pausePressed && onPauseMenuToggleRef.current) {
      clearHeldCombatInput();
      controllerInventoryHeldRef.current = false;
      controllerSprintToggleRef.current = false;
      onPauseMenuToggleRef.current();
    }

    if (inputEnabledRef.current) {
      const controllerInventoryHeld =
        controllerMovementEnabled && controllerState.inventoryHeld;
      if (inventoryOpenModeSettingRef.current === 'toggle') {
        if (controllerState.inventoryPressed) {
          if (inventoryPanelOpenRef.current) {
            closeInventoryPanel();
          } else {
            openInventoryPanel();
          }
        }
      } else if (controllerInventoryHeld) {
        if (!inventoryPanelOpenRef.current) {
          openInventoryPanel();
        }
      } else if (controllerInventoryHeldRef.current) {
        closeInventoryPanel();
      }
      controllerInventoryHeldRef.current = controllerInventoryHeld;
    } else {
      controllerInventoryHeldRef.current = false;
    }

    const inventoryOpen = inventoryPanelOpenRef.current;
    const movementEnabled = keyboardMovementEnabled || controllerMovementEnabled;
    const mouseLookEnabled =
      gameplayInputEnabled && pointerLockedRef.current && !inventoryOpen;
    const controllerActionEnabled =
      controllerMovementEnabled && !inventoryOpen;
    const controllerLookEnabled = controllerActionEnabled;
    if (!controllerConnected || !controllerSettingsValue.toggleSprint) {
      controllerSprintToggleRef.current = false;
    } else if (controllerActionEnabled && controllerState.sprintPressed) {
      controllerSprintToggleRef.current = !controllerSprintToggleRef.current;
    }

    if (!weaponEquipped || weaponBusy) {
      if (
        adsRef.current ||
        mouseAdsHeldRef.current ||
        controllerAdsHeldRef.current
      ) {
        mouseAdsHeldRef.current = false;
        controllerAdsHeldRef.current = false;
        adsRef.current = false;
      }
    } else {
      controllerAdsHeldRef.current =
        controllerActionEnabled && controllerState.adsHeld;
      adsRef.current =
        !inventoryOpen &&
        ((pointerLockedRef.current && mouseAdsHeldRef.current) ||
          controllerAdsHeldRef.current);
    }

    controllerTriggerHeldRef.current =
      controllerActionEnabled && controllerState.fireHeld;
    syncTriggerHeld(
      (gameplayInputEnabled &&
        pointerLockedRef.current &&
        !inventoryOpen &&
        mouseTriggerHeldRef.current) ||
        controllerTriggerHeldRef.current,
    );

    const lookSensitivity = resolveLookSensitivity(
      sensitivityRef.current,
      activeWeapon,
      adsRef.current,
    );
    const hipLookSensitivity = resolveLookSensitivity(
      sensitivityRef.current,
      activeWeapon,
      false,
    );
    const controllerAdsScaleX =
      hipLookSensitivity.horizontal > 0
        ? lookSensitivity.horizontal / hipLookSensitivity.horizontal
        : 1;
    const controllerAdsScaleY =
      hipLookSensitivity.vertical > 0
        ? lookSensitivity.vertical / hipLookSensitivity.vertical
        : 1;

    const mouse = pendingMouseRef.current;
    if (mouseLookEnabled && (mouse.x !== 0 || mouse.y !== 0)) {
      targetYawRef.current -= mouse.x * lookSensitivity.horizontal;
      targetPitchRef.current = THREE.MathUtils.clamp(
        targetPitchRef.current - mouse.y * lookSensitivity.vertical,
        MIN_PITCH,
        MAX_PITCH,
      );
      mouse.set(0, 0);
    }
    if (controllerLookEnabled && controllerState.lookMagnitude > CONTROLLER_INPUT_EPSILON) {
      targetYawRef.current -=
        controllerState.lookX *
        CONTROLLER_LOOK_SPEED_X *
        controllerSettingsValue.lookSensitivityX *
        controllerAdsScaleX *
        delta;
      const controllerPitchDirection = controllerSettingsValue.invertY ? -1 : 1;
      targetPitchRef.current = THREE.MathUtils.clamp(
        targetPitchRef.current +
          controllerState.lookY *
            CONTROLLER_LOOK_SPEED_Y *
            controllerSettingsValue.lookSensitivityY *
            controllerAdsScaleY *
            controllerPitchDirection *
            delta,
        MIN_PITCH,
        MAX_PITCH,
      );
    }

    yawRef.current = targetYawRef.current;
    pitchRef.current = targetPitchRef.current;

    const bindings = keybindsRef.current;
    if (controllerActionEnabled) {
      if (controllerState.pickupPressed) {
        actionCallbackRef.current('pickup');
      }
      if (controllerState.dropPressed) {
        actionCallbackRef.current('drop');
      }
      if (controllerState.reloadPressed) {
        actionCallbackRef.current('reload');
      }
      if (controllerState.equipRiflePressed) {
        actionCallbackRef.current('equipRifle');
      }
      if (controllerState.equipSniperPressed) {
        actionCallbackRef.current('equipSniper');
      }
      if (controllerState.toggleViewPressed) {
        firstPersonRef.current = !firstPersonRef.current;
      }
    }

    const keyboardForward = keyboardMovementEnabled
      ? (isBindingDown(keys, bindings.moveForward) ? 1 : 0) +
        (isBindingDown(keys, bindings.moveBackward) ? -1 : 0)
      : 0;
    const keyboardStrafe = keyboardMovementEnabled
      ? (isBindingDown(keys, bindings.moveRight) ? 1 : 0) +
        (isBindingDown(keys, bindings.moveLeft) ? -1 : 0)
      : 0;
    const forward = THREE.MathUtils.clamp(
      keyboardForward + (controllerMovementEnabled ? controllerState.moveY : 0),
      -1,
      1,
    );
    const strafe = THREE.MathUtils.clamp(
      keyboardStrafe + (controllerMovementEnabled ? controllerState.moveX : 0),
      -1,
      1,
    );
    moveInputRef.current.set(strafe, forward);
    if (moveInputRef.current.lengthSq() > 1) {
      moveInputRef.current.normalize();
    }

    const crouchBinding = bindings.crouch;
    const crouchHeld =
      (keyboardMovementEnabled && isBindingDown(keys, crouchBinding)) ||
      (controllerMovementEnabled && controllerState.crouchHeld);
    if (controllerActionEnabled && controllerState.crouchPressed) {
      if (crouchModeSettingRef.current === 'toggle') {
        crouchedRef.current = !crouchedRef.current;
      } else if (!crouchHoldLatchRef.current) {
        crouchedRef.current = true;
      }
    }
    if (crouchModeRef.current === 'hold') {
      if (!movementEnabled) {
        crouchedRef.current = false;
      } else if (!crouchHeld) {
        crouchedRef.current = false;
        crouchHoldLatchRef.current = false;
      } else if (!crouchHoldLatchRef.current) {
        crouchedRef.current = true;
      }
    }

    const movementProfile = movementProfileRef.current;
    const hasDirectionalInput = moveInputRef.current.lengthSq() > 0.001;
    const controllerWalkPressed =
      controllerMovementEnabled &&
      controllerState.moveMagnitude > CONTROLLER_INPUT_EPSILON &&
      controllerState.moveMagnitude < CONTROLLER_WALK_THRESHOLD;
    const crouchSprintLocked =
      crouchedRef.current ||
      crouchLerpRef.current >= CROUCH_SPRINT_LOCK_THRESHOLD;
    if (controllerSettingsValue.toggleSprint &&
      (crouchSprintLocked || adsRef.current)
    ) {
      controllerSprintToggleRef.current = false;
    }
    const controllerSprintPressed =
      controllerMovementEnabled &&
      (controllerSettingsValue.toggleSprint
        ? controllerSprintToggleRef.current
        : controllerState.sprintHeld);
    const sprintPressed =
      ((keyboardMovementEnabled &&
        isBindingDown(keys, bindings.sprint)) ||
        controllerSprintPressed) &&
      !crouchSprintLocked &&
      !adsRef.current;
    const walkPressed =
      ((keyboardMovementEnabled &&
        isBindingDown(keys, bindings.walkModifier)) ||
        controllerWalkPressed) &&
      !crouchSprintLocked &&
      !sprintPressed;
    sprintPressedRef.current = sprintPressed;
    walkPressedRef.current = walkPressed;

    const sprintEligible =
      hasDirectionalInput &&
      isSprintInputEligible(moveInputRef.current.x, moveInputRef.current.y);
    const sprinting =
      movementEnabled &&
      movementProfile.allowSprint &&
      sprintPressed &&
      groundedRef.current &&
      sprintEligible;
    const previousMovementTier = movementTierRef.current;
    const movementTier: MovementTier = sprinting
      ? 'run'
      : walkPressed
        ? 'walk'
        : 'jog';

    const moveSpeed =
      movementTier === 'run'
        ? SPRINT_SPEED * movementProfile.sprintScale
        : WALK_SPEED *
          (movementTier === 'walk'
            ? movementProfile.walkScale
            : movementProfile.jogScale);

    const localX = moveInputRef.current.x;
    const localZ = moveInputRef.current.y;
    resolveDesiredPlanarVelocity(desiredPlanarVelocityRef.current, {
      moveX: localX,
      moveY: localZ,
      aimYaw: yawRef.current,
      desiredSpeed: moveSpeed,
    });
    const allowSprintMomentum =
      previousMovementTier === 'run' || sprintMomentumRef.current;
    movementTierRef.current = movementTier;

    if (groundedRef.current) {
      const groundedResponse = stepGroundedPlanarVelocity(
        velocityRef.current,
        desiredPlanarVelocityRef.current,
        delta,
        {
          movementEnabled,
          hasDirectionalInput,
          sprinting,
          allowSprintMomentum,
        },
      );
      sprintMomentumRef.current = resolveSprintMomentumActive(
        velocityRef.current,
        desiredPlanarVelocityRef.current,
        {
          movementEnabled,
          hasDirectionalInput,
          sprinting,
          allowSprintMomentum,
        },
        groundedResponse,
      );
    } else if (!movementEnabled) {
      velocityRef.current.set(0, 0);
      airborneMomentumSpeedRef.current = 0;
      sprintMomentumRef.current = false;
    } else {
      const desiredHeadingYaw = hasDirectionalInput
        ? Math.atan2(
            -desiredPlanarVelocityRef.current.x,
            -desiredPlanarVelocityRef.current.y,
          )
        : yawRef.current;
      stepAirbornePlanarVelocity(velocityRef.current, delta, {
        hasDirectionalInput,
        desiredHeadingYaw,
        momentumSpeed: airborneMomentumSpeedRef.current,
      });
    }
    planarSpeedRef.current = velocityRef.current.length();

    const fppLocked = firstPersonRef.current;
    const shootingAlignActive = nowMs < shootAlignUntilRef.current;
    if (fppLocked) {
      targetBodyYawRef.current = yawRef.current;
      bodyYawRef.current = yawRef.current;
      headYawOffsetRef.current = 0;
    } else if (adsRef.current || shootingAlignActive) {
      targetBodyYawRef.current = yawRef.current;
      bodyYawRef.current = dampAngle(
        bodyYawRef.current,
        targetBodyYawRef.current,
        shootingAlignActive ? SHOOT_BODY_YAW_DAMP : ADS_BODY_YAW_DAMP,
        delta,
      );
      headYawOffsetRef.current = 0;
    } else {
      const runFacingPhase = runFacingPhaseRef.current;
      const runFacingActive = runFacingPhase !== 'off';
      const movingWithInput = movementEnabled && hasDirectionalInput;
      const forwardDiagonalMove =
        movingWithInput &&
        localZ > FORWARD_DIAGONAL_BODY_YAW_THRESHOLD &&
        Math.abs(localX) > FORWARD_DIAGONAL_BODY_YAW_THRESHOLD;
      if (movingWithInput) {
        targetBodyYawRef.current = forwardDiagonalMove
          ? yawRef.current - Math.sign(localX) * DIAGONAL_BODY_YAW_OFFSET
          : yawRef.current;
      } else if (runFacingActive) {
        targetBodyYawRef.current = runFacingYawRef.current;
        headYawOffsetRef.current = 0;
      } else {
        const rawOffset = normalizeAngle(yawRef.current - bodyYawRef.current);
        if (Math.abs(rawOffset) <= HEAD_TURN_DEAD_ZONE) {
          targetBodyYawRef.current = bodyYawRef.current;
        } else {
          targetBodyYawRef.current =
            yawRef.current - Math.sign(rawOffset) * HEAD_TURN_DEAD_ZONE;
        }
      }
      const aimBodyDelta = normalizeAngle(
        yawRef.current - targetBodyYawRef.current,
      );
      if (Math.abs(aimBodyDelta) > MAX_FREE_LOOK_YAW_OFFSET) {
        targetBodyYawRef.current =
          yawRef.current - Math.sign(aimBodyDelta) * MAX_FREE_LOOK_YAW_OFFSET;
      }
      const bodyYawDamp =
        runFacingPhase === 'running'
          ? RUN_BODY_YAW_DAMP
          : movingWithInput
            ? RUN_TRANSITION_BODY_YAW_DAMP
            : runFacingActive
              ? RUN_TRANSITION_BODY_YAW_DAMP
              : BODY_YAW_DAMP;
      bodyYawRef.current = dampAngle(
        bodyYawRef.current,
        targetBodyYawRef.current,
        bodyYawDamp,
        delta,
      );
      if (movingWithInput) {
        headYawOffsetRef.current = forwardDiagonalMove
          ? THREE.MathUtils.clamp(
              normalizeAngle(yawRef.current - bodyYawRef.current),
              -HEAD_TURN_DEAD_ZONE,
              HEAD_TURN_DEAD_ZONE,
            )
          : 0;
      } else if (!runFacingActive) {
        headYawOffsetRef.current = THREE.MathUtils.clamp(
          normalizeAngle(yawRef.current - bodyYawRef.current),
          -HEAD_TURN_DEAD_ZONE,
          HEAD_TURN_DEAD_ZONE,
        );
      }
    }

    resolvedXZRef.current.set(positionRef.current.x, positionRef.current.z);
    resolvedXZRef.current.x += velocityRef.current.x * delta;
    resolvedXZRef.current.x = clamp(
      resolvedXZRef.current.x,
      worldBounds.minX + PLAYER_RADIUS,
      worldBounds.maxX - PLAYER_RADIUS,
    );
    resolveCollisions(resolvedXZRef.current, PLAYER_RADIUS, collisionRects);
    resolveCircleCollisions(
      resolvedXZRef.current,
      PLAYER_RADIUS,
      collisionCircles,
    );
    resolveBlockingVolumeCollisions(
      resolvedXZRef.current,
      PLAYER_RADIUS,
      positionRef.current.y,
      crouchedRef.current ? PLAYER_CROUCH_HEIGHT : PLAYER_STAND_HEIGHT,
      blockingVolumesRef.current,
    );

    resolvedXZRef.current.y += velocityRef.current.y * delta;
    resolvedXZRef.current.y = clamp(
      resolvedXZRef.current.y,
      worldBounds.minZ + PLAYER_RADIUS,
      worldBounds.maxZ - PLAYER_RADIUS,
    );
    resolveCollisions(resolvedXZRef.current, PLAYER_RADIUS, collisionRects);
    resolveCircleCollisions(
      resolvedXZRef.current,
      PLAYER_RADIUS,
      collisionCircles,
    );
    resolveBlockingVolumeCollisions(
      resolvedXZRef.current,
      PLAYER_RADIUS,
      positionRef.current.y,
      crouchedRef.current ? PLAYER_CROUCH_HEIGHT : PLAYER_STAND_HEIGHT,
      blockingVolumesRef.current,
    );

    positionRef.current.set(
      resolvedXZRef.current.x,
      positionRef.current.y,
      resolvedXZRef.current.y,
    );

    const readGroundSample = () => {
      const surfaces = walkableSurfacesRef.current;
      const surfaceHeight = surfaces.length > 0
        ? sampleWalkableSurfaceHeight(
            surfaces,
            positionRef.current.x,
            positionRef.current.z,
            positionRef.current.y,
            GROUND_STEP_UP_HEIGHT,
          )
        : null;
      const blockingTopHeight = sampleBlockingVolumeTop(
        blockingVolumesRef.current,
        positionRef.current.x,
        positionRef.current.z,
        positionRef.current.y,
        GROUND_STEP_UP_HEIGHT,
      );

      if (surfaceHeight === null && blockingTopHeight === null) {
        return undefined;
      }

      if (surfaceHeight === null) {
        return blockingTopHeight ?? undefined;
      }

      if (blockingTopHeight === null) {
        return surfaceHeight;
      }

      return Math.max(surfaceHeight, blockingTopHeight);
    };

    if (
      controllerActionEnabled &&
      controllerState.jumpPressed &&
      groundedRef.current
    ) {
      if (crouchedRef.current) {
        crouchedRef.current = false;
        if (
          crouchModeSettingRef.current === 'hold' &&
          controllerState.crouchHeld
        ) {
          crouchHoldLatchRef.current = true;
        }
        jumpQueuedRef.current = false;
      } else {
        jumpQueuedRef.current = true;
      }
    }

    const nowJumpMs = performance.now();
    if (
      movementEnabled &&
      jumpQueuedRef.current &&
      groundedRef.current
    ) {
      jumpQueuedRef.current = false;
      const jumpPenalty = Math.min(
        consecutiveJumpsRef.current * JUMP_PENALTY_PER_CONSECUTIVE,
        MAX_CONSECUTIVE_JUMP_PENALTY,
      );
      airborneMomentumSpeedRef.current = resolveJumpTakeoffMomentum(
        planarSpeedRef.current,
        moveSpeed,
        hasDirectionalInput,
      );
      groundedRef.current = false;
      verticalVelocityRef.current = JUMP_SPEED * (1 - jumpPenalty);
      consecutiveJumpsRef.current += 1;
    } else {
      jumpQueuedRef.current = false;
    }

    if (!groundedRef.current || verticalVelocityRef.current !== 0) {
      const vy = verticalVelocityRef.current;
      const gravity =
        vy > PEAK_VELOCITY_THRESHOLD
          ? GRAVITY_UP
          : vy > -PEAK_VELOCITY_THRESHOLD
            ? GRAVITY_PEAK
            : GRAVITY_DOWN;
      verticalVelocityRef.current += gravity * delta;
      positionRef.current.y += verticalVelocityRef.current * delta;
      const groundSample = readGroundSample();

      if (
        typeof groundSample === 'number' &&
        verticalVelocityRef.current <= 0 &&
        positionRef.current.y <= groundSample
      ) {
        positionRef.current.y = groundSample;
        verticalVelocityRef.current = 0;
        groundedRef.current = true;
        airborneMomentumSpeedRef.current = 0;
        lastLandedAtRef.current = nowJumpMs;
      } else if (
        walkableSurfacesRef.current.length === 0 &&
        positionRef.current.y <= groundLevelYRef.current
      ) {
        positionRef.current.y = groundLevelYRef.current;
        verticalVelocityRef.current = 0;
        groundedRef.current = true;
        airborneMomentumSpeedRef.current = 0;
        lastLandedAtRef.current = nowJumpMs;
      }
    } else {
      const groundSample = readGroundSample();

      if (typeof groundSample === 'number') {
        const deltaToGround = groundSample - positionRef.current.y;
        if (
          deltaToGround <= GROUND_STEP_UP_HEIGHT &&
          deltaToGround >= -GROUND_STEP_DOWN_HEIGHT
        ) {
          groundedRef.current = true;
          positionRef.current.y = groundSample;
          airborneMomentumSpeedRef.current = 0;
        } else if (deltaToGround < -GROUND_STEP_DOWN_HEIGHT) {
          groundedRef.current = false;
        }
      } else if (walkableSurfacesRef.current.length > 0) {
        groundedRef.current = false;
      } else {
        groundedRef.current = true;
        positionRef.current.y = groundLevelYRef.current;
        airborneMomentumSpeedRef.current = 0;
      }
    }

    if (
      groundedRef.current &&
      nowJumpMs - lastLandedAtRef.current >= CONSECUTIVE_JUMP_RESET_MS
    ) {
      consecutiveJumpsRef.current = 0;
    }

    recoilPitchRef.current = THREE.MathUtils.damp(
      recoilPitchRef.current,
      0,
      25,
      delta,
    );
    recoilYawRef.current = THREE.MathUtils.damp(
      recoilYawRef.current,
      0,
      30,
      delta,
    );

    const adsTarget = adsRef.current ? 1 : 0;
    adsLerpRef.current = THREE.MathUtils.damp(
      adsLerpRef.current,
      adsTarget,
      15,
      delta,
    );
    const adsT = adsLerpRef.current;
    const sniperADS = activeWeapon === 'sniper' ? adsT : 0;
    const crouchTarget = crouchedRef.current ? 1 : 0;
    crouchLerpRef.current = THREE.MathUtils.damp(
      crouchLerpRef.current,
      crouchTarget,
      CROUCH_TRANSITION_SPEED,
      delta,
    );
    const crouchT = crouchLerpRef.current;
    const crouchCameraTarget =
      crouchedRef.current && crouchT >= TPP_CROUCH_CAMERA_ACTIVATION_THRESHOLD
        ? 1
        : 0;
    crouchCameraLerpRef.current = THREE.MathUtils.damp(
      crouchCameraLerpRef.current,
      crouchCameraTarget,
      TPP_CROUCH_CAMERA_TRANSITION_SPEED,
      delta,
    );
    const crouchLookHeightOffset =
      TPP_CROUCH_LOOK_HEIGHT_OFFSET * crouchCameraLerpRef.current;
    const peekLeftHeld =
      movementEnabled && isBindingDown(keys, bindings.peekLeft);
    const peekRightHeld =
      movementEnabled && isBindingDown(keys, bindings.peekRight);
    leanTargetRef.current =
      allowLean && !sprinting && peekLeftHeld && !peekRightHeld
        ? -1
        : allowLean && !sprinting && peekRightHeld && !peekLeftHeld
          ? 1
          : 0;
    leanLerpRef.current = THREE.MathUtils.damp(
      leanLerpRef.current,
      leanTargetRef.current,
      LEAN_TRANSITION_SPEED,
      delta,
    );
    const leanT = leanLerpRef.current;
    const viewTarget = firstPersonRef.current || adsRef.current ? 1 : 0;
    if (adsRef.current && Math.abs(leanT) > 0.08) {
      viewModeLerpRef.current = 1;
    } else {
      viewModeLerpRef.current = THREE.MathUtils.damp(
        viewModeLerpRef.current,
        viewTarget,
        VIEW_MODE_TRANSITION_SPEED,
        delta,
      );
    }
    const viewT = viewModeLerpRef.current;

    const currentYaw = yawRef.current + recoilYawRef.current;
    const currentPitch = pitchRef.current + recoilPitchRef.current;
    const sinCurrentYaw = Math.sin(currentYaw);
    const cosCurrentYaw = Math.cos(currentYaw);
    const aimDir = tempAimDirRef.current;
    const pitchCos = Math.cos(currentPitch);
    aimDir
      .set(
        -sinCurrentYaw * pitchCos,
        Math.sin(currentPitch),
        -cosCurrentYaw * pitchCos,
      )
      .normalize();

    const fppCameraPos = tempFirstPersonCameraPosRef.current;
    fppCameraPos.set(
      positionRef.current.x,
      positionRef.current.y +
        THREE.MathUtils.lerp(
          FIRST_PERSON_CAMERA_HEIGHT,
          FIRST_PERSON_CAMERA_HEIGHT_CROUCH,
          crouchT,
        ),
      positionRef.current.z,
    );
    fppCameraPos.addScaledVector(aimDir, FIRST_PERSON_CAMERA_FORWARD_OFFSET);
    if (sniperADS > 0) {
      fppCameraPos.x += cosCurrentYaw * 0.045 * sniperADS;
      fppCameraPos.y -= 0.02 * sniperADS;
      fppCameraPos.z += -sinCurrentYaw * 0.045 * sniperADS;
    }
    const rifleADS = activeWeapon === 'rifle' ? adsT : 0;
    if (rifleADS > 0) {
      fppCameraPos.x += cosCurrentYaw * 0.03 * rifleADS;
      fppCameraPos.y -= 0.01 * rifleADS;
      fppCameraPos.z += -sinCurrentYaw * 0.03 * rifleADS;
    }

    // Arm shortens at extreme pitch (camera comes closer when looking up/down)
    const pitchMagnitude = Math.abs(currentPitch);
    const armShortenFactor = Math.max(
      CAMERA_MIN_ARM_SCALE,
      1 - pitchMagnitude * CAMERA_ARM_PITCH_SHORTEN,
    );

    const armLenAdsTarget =
      activeWeapon === 'sniper'
        ? CAMERA_ARM_LENGTH_SNIPER_ADS
        : CAMERA_ARM_LENGTH_ADS;
    const shoulderAdsTarget =
      activeWeapon === 'sniper'
        ? SHOULDER_OFFSET_SNIPER_ADS
        : SHOULDER_OFFSET_ADS;
    const baseArmLen = THREE.MathUtils.lerp(
      CAMERA_ARM_LENGTH,
      armLenAdsTarget,
      adsT,
    );
    const armLen = baseArmLen * armShortenFactor;
    const shoulder = THREE.MathUtils.lerp(
      SHOULDER_OFFSET,
      shoulderAdsTarget,
      adsT,
    );

    // PUBG-style orbit: camera extends opposite to aimDir from pivot.
    // This keeps the character head consistently near the crosshair.
    const orbitHorizontalDist = armLen * pitchCos;
    const orbitVerticalDist = armLen * (-Math.sin(currentPitch));

    const backX = sinCurrentYaw;
    const backZ = cosCurrentYaw;
    const rightX = cosCurrentYaw;
    const rightZ = -sinCurrentYaw;

    // Pivot = character shoulder area + height bias so head sits just below crosshair
    const pivotY =
      positionRef.current.y +
      LOOK_AT_HEIGHT +
      crouchLookHeightOffset +
      CAMERA_HEIGHT_BIAS -
      sniperADS * 0.08;

    const tppCameraPos = tempThirdPersonCameraPosRef.current;
    const rawCamY = pivotY + orbitVerticalDist;
    tppCameraPos.set(
      positionRef.current.x + orbitHorizontalDist * backX + shoulder * rightX,
      Math.max(positionRef.current.y + CAMERA_MIN_Y_ABOVE_FEET, rawCamY),
      positionRef.current.z + orbitHorizontalDist * backZ + shoulder * rightZ,
    );
    if (Math.abs(leanT) > 0.001) {
      const leanOffsetX = leanT * LEAN_CAMERA_OFFSET_X;
      fppCameraPos.x += cosCurrentYaw * leanOffsetX;
      fppCameraPos.z += -sinCurrentYaw * leanOffsetX;
      tppCameraPos.x += cosCurrentYaw * leanOffsetX;
      tppCameraPos.z += -sinCurrentYaw * leanOffsetX;
    }

    if (cameraEnabledRef.current) {
      const clipEye = cameraClipEyeRef.current;
      clipEye.set(
        positionRef.current.x,
        pivotY,
        positionRef.current.z,
      );
      if (Math.abs(leanT) > 0.001) {
        const leanOffsetX = leanT * LEAN_CAMERA_OFFSET_X;
        clipEye.x += cosCurrentYaw * leanOffsetX;
        clipEye.z += -sinCurrentYaw * leanOffsetX;
      }
      const clippedTpp = cameraClipOutRef.current;
      const volumes = blockingVolumesRef.current;
      if (volumes.length > 0 && viewT < 0.995) {
        clipThirdPersonCameraToVolumes(
          clipEye,
          tppCameraPos,
          volumes,
          CAMERA_BLOCKING_MARGIN,
          clippedTpp,
        );
        camera.position.copy(clippedTpp).lerp(fppCameraPos, viewT);
      } else {
        camera.position.copy(tppCameraPos).lerp(fppCameraPos, viewT);
      }

      // Preserve the dialed-in zoom while the player keeps the sniper equipped.
      if (activeWeapon !== 'sniper') {
        sniperZoomRef.current = 1;
      }

      if ('isPerspectiveCamera' in camera && camera.isPerspectiveCamera) {
        const baseFov = fovRef.current;
        const sniperAdsFov = SNIPER_ADS_FOV / sniperZoomRef.current;
        const adsFovTarget =
          activeWeapon === 'sniper' ? sniperAdsFov : RIFLE_ADS_FOV;
        const targetFov = THREE.MathUtils.lerp(baseFov, adsFovTarget, adsT);
        const perspectiveCamera = camera as THREE.PerspectiveCamera;
        const nextFov = THREE.MathUtils.damp(
          perspectiveCamera.fov,
          targetFov,
          14,
          delta,
        );
        if (Math.abs(nextFov - perspectiveCamera.fov) > 0.01) {
          perspectiveCamera.fov = nextFov;
          perspectiveCamera.updateProjectionMatrix();
        }
      }

      const lookAt = tempLookAtRef.current;
      lookAt.copy(camera.position).addScaledVector(aimDir, AIM_LOOK_DISTANCE);
      camera.lookAt(lookAt);
      if (Math.abs(leanT) > 0.001 && viewT > 0.95) {
        camera.rotateZ(-leanT * LEAN_CAMERA_TILT);
      }
    } else if ('isPerspectiveCamera' in camera && camera.isPerspectiveCamera) {
      const perspectiveCamera = camera as THREE.PerspectiveCamera;
      const nextFov = THREE.MathUtils.damp(
        perspectiveCamera.fov,
        fovRef.current,
        14,
        delta,
      );
      if (Math.abs(nextFov - perspectiveCamera.fov) > 0.01) {
        perspectiveCamera.fov = nextFov;
        perspectiveCamera.updateProjectionMatrix();
      }
    }

    const speed = planarSpeedRef.current;
    movingRef.current = speed > 0.15;
    sprintingRef.current =
      movementTierRef.current === 'run' && movingRef.current;

    snapshotAccumulatorRef.current += delta;
    if (snapshotAccumulatorRef.current >= 0.05) {
      snapshotAccumulatorRef.current = 0;
      const snap = snapshotObjectRef.current;
      snap.x = positionRef.current.x;
      snap.y = positionRef.current.y;
      snap.z = positionRef.current.z;
      snap.speed = speed;
      snap.sprinting = sprintingRef.current;
      snap.movementTier = movementTierRef.current;
      snap.crouched = crouchedRef.current;
      snap.moving = movingRef.current;
      snap.grounded = groundedRef.current;
      snap.pointerLocked = pointerLockedRef.current;
      snap.controllerConnected = controllerConnected;
      snap.canInteract = false;
      snap.interactWeaponKind = null;
      snap.inventoryPanelOpen = inventoryOpen;
      snap.inventoryPanelMode = inventoryOpenModeRef.current;
      snapshotCallbackRef.current(snap);
    }
  });

  return {
    addRecoil: (pitchRadians, yawRadians) => {
      // PUBG-style: recoil moves the actual aim point (crosshair climbs),
      // player compensates by pulling mouse down. Minimal visual shake.
      recoilPitchRef.current += pitchRadians * 0.12;
      recoilYawRef.current += yawRadians * 0.1;
      targetPitchRef.current = THREE.MathUtils.clamp(
        targetPitchRef.current + pitchRadians,
        MIN_PITCH,
        MAX_PITCH,
      );
      targetYawRef.current += yawRadians;
    },
    alignBodyToAim: (durationMs = SHOOT_ALIGN_WINDOW_MS) => {
      shootAlignUntilRef.current = Math.max(
        shootAlignUntilRef.current,
        performance.now() + Math.max(0, durationMs),
      );
    },
    getPosition: () => positionRef.current,
    getYaw: () => yawRef.current,
    getAimYaw: () => yawRef.current,
    getBodyYaw: () => bodyYawRef.current,
    getHeadYawOffset: () => headYawOffsetRef.current,
    getPitch: () => pitchRef.current + recoilPitchRef.current,
    getLeanValue: () => leanLerpRef.current,
    getPlanarVelocity: () => velocityRef.current,
    getPlanarSpeed: () => planarSpeedRef.current,
    getMoveInput: () => moveInputRef.current,
    isFirstPerson: () =>
      firstPersonRef.current
        ? viewModeLerpRef.current >= FPP_ENTER_VISUAL_THRESHOLD
        : viewModeLerpRef.current > FPP_EXIT_VISUAL_THRESHOLD,
    getViewModeLerp: () => viewModeLerpRef.current,
    isADS: () => adsRef.current,
    getAdsLerp: () => adsLerpRef.current,
    getSniperZoom: () => sniperZoomRef.current,
    isSprinting: () => sprintingRef.current,
    isSprintPressed: () => sprintPressedRef.current,
    isWalkPressed: () => walkPressedRef.current,
    isCrouched: () => crouchedRef.current,
    isCrouchKeyHeld: () =>
      isBindingDown(keyStateRef.current, keybindsRef.current.crouch) ||
      gamepadFrameStateRef.current.crouchHeld,
    isMoving: () => movingRef.current,
    isGrounded: () => groundedRef.current,
    getMovementTier: () => movementTierRef.current,
    setRunFacing: (phase, headingYaw) => {
      runFacingPhaseRef.current = phase;
      if (typeof headingYaw === 'number' && Number.isFinite(headingYaw)) {
        runFacingYawRef.current = normalizeAngle(headingYaw);
      }
      if (phase === 'off') {
        runFacingYawRef.current = bodyYawRef.current;
      }
    },
    setMovementProfile: (profile) => {
      movementProfileRef.current = {
        ...movementProfileRef.current,
        ...profile,
        walkScale: Math.max(
          0.15,
          profile.walkScale ?? movementProfileRef.current.walkScale,
        ),
        jogScale: Math.max(
          0.15,
          profile.jogScale ?? movementProfileRef.current.jogScale,
        ),
        sprintScale: Math.max(
          0.15,
          profile.sprintScale ?? movementProfileRef.current.sprintScale,
        ),
        allowSprint:
          profile.allowSprint ?? movementProfileRef.current.allowSprint,
      };
    },
    requestPointerLock: () => {
      userGestureCallbackRef.current();
      if (
        pointerLockedRef.current ||
        document.pointerLockElement === gl.domElement
      ) {
        return;
      }
      if (document.pointerLockElement !== null) {
        return;
      }
      gl.domElement.requestPointerLock();
    },
    releasePointerLock: () => {
      if (document.pointerLockElement === gl.domElement) {
        document.exitPointerLock();
      }
    },
    setPose: (position, yawRadians, pitchRadians = spawnPitch) => {
      positionRef.current.copy(position);
      resolvedXZRef.current.set(position.x, position.z);
      velocityRef.current.set(0, 0);
      desiredPlanarVelocityRef.current.set(0, 0);
      moveInputRef.current.set(0, 0);
      verticalVelocityRef.current = 0;
      airborneMomentumSpeedRef.current = 0;
      sprintMomentumRef.current = false;
      groundedRef.current = true;
      jumpQueuedRef.current = false;
      yawRef.current = yawRadians;
      targetYawRef.current = yawRadians;
      bodyYawRef.current = yawRadians;
      targetBodyYawRef.current = yawRadians;
      pitchRef.current = pitchRadians;
      targetPitchRef.current = pitchRadians;
      recoilPitchRef.current = 0;
      recoilYawRef.current = 0;
      pendingMouseRef.current.set(0, 0);
      adsRef.current = false;
      adsLerpRef.current = 0;
      crouchedRef.current = false;
      crouchLerpRef.current = 0;
      crouchCameraLerpRef.current = 0;
      crouchHoldLatchRef.current = false;
      inventoryPanelOpenRef.current = false;
      firstPersonRef.current = false;
      viewModeLerpRef.current = 0;
      headYawOffsetRef.current = 0;
      leanTargetRef.current = 0;
      leanLerpRef.current = 0;
      sprintPressedRef.current = false;
      walkPressedRef.current = false;
      movementTierRef.current = 'jog';
      shootAlignUntilRef.current = 0;
      runFacingPhaseRef.current = 'off';
      runFacingYawRef.current = yawRadians;
      planarSpeedRef.current = 0;
      keyStateRef.current = {};
      if (triggerHeldRef.current) {
        triggerHeldRef.current = false;
        triggerCallbackRef.current(false);
      }
      const snapshot = snapshotObjectRef.current;
      snapshot.x = position.x;
      snapshot.y = position.y;
      snapshot.z = position.z;
      snapshot.speed = 0;
      snapshot.sprinting = false;
      snapshot.movementTier = 'jog';
      snapshot.crouched = false;
      snapshot.moving = false;
      snapshot.grounded = true;
      snapshot.pointerLocked = pointerLockedRef.current;
      snapshot.canInteract = false;
      snapshot.interactWeaponKind = null;
      snapshot.inventoryPanelOpen = false;
      snapshot.inventoryPanelMode = inventoryOpenModeRef.current;
      snapshotCallbackRef.current(snapshot);
      movementProfileRef.current = {
        walkScale: 1,
        jogScale: 1,
        sprintScale: 1,
        allowSprint: true,
      };
    },
  };
}

function resolveCollisions(
  positionXZ: THREE.Vector2,
  radius: number,
  collisionRects: CollisionRect[],
) {
  for (const rect of collisionRects) {
    resolveCircleRect(positionXZ, radius, rect);
  }
}

function resolveCircleCollisions(
  positionXZ: THREE.Vector2,
  radius: number,
  collisionCircles: CollisionCircle[],
) {
  for (const circle of collisionCircles) {
    resolveCircleCircle(positionXZ, radius, circle);
  }
}

function resolveBlockingVolumeCollisions(
  positionXZ: THREE.Vector2,
  radius: number,
  footY: number,
  height: number,
  blockingVolumes: readonly BlockingVolume[],
) {
  const playerTop = footY + height;

  for (const volume of blockingVolumes) {
    const halfHeight = volume.size[1] / 2;
    const minY = volume.center[1] - halfHeight;
    const maxY = volume.center[1] + halfHeight;

    if (playerTop <= minY || footY >= maxY) {
      continue;
    }

    resolveCircleRect(positionXZ, radius, {
      minX: volume.center[0] - volume.size[0] / 2,
      maxX: volume.center[0] + volume.size[0] / 2,
      minZ: volume.center[2] - volume.size[2] / 2,
      maxZ: volume.center[2] + volume.size[2] / 2,
    });
  }
}

function sampleBlockingVolumeTop(
  blockingVolumes: readonly BlockingVolume[],
  x: number,
  z: number,
  currentY: number,
  maxStepUp = Number.POSITIVE_INFINITY,
) {
  let resolvedHeight: number | null = null;
  const maxAllowedHeight = currentY + maxStepUp;

  for (const volume of blockingVolumes) {
    if (
      volume.size[0] < BLOCKING_TOP_MIN_WIDTH ||
      volume.size[2] < BLOCKING_TOP_MIN_WIDTH
    ) {
      continue;
    }

    const minX = volume.center[0] - volume.size[0] / 2;
    const maxX = volume.center[0] + volume.size[0] / 2;
    const minZ = volume.center[2] - volume.size[2] / 2;
    const maxZ = volume.center[2] + volume.size[2] / 2;

    if (
      x < minX - BLOCKING_TOP_EPSILON ||
      x > maxX + BLOCKING_TOP_EPSILON ||
      z < minZ - BLOCKING_TOP_EPSILON ||
      z > maxZ + BLOCKING_TOP_EPSILON
    ) {
      continue;
    }

    const topY = volume.center[1] + volume.size[1] / 2;
    if (topY > maxAllowedHeight) {
      continue;
    }

    if (resolvedHeight === null || topY > resolvedHeight) {
      resolvedHeight = topY;
    }
  }

  return resolvedHeight;
}

function isBindingDown(keys: KeyState, bindingCode: string) {
  return Boolean(bindingCode && keys[bindingCode]);
}

function normalizeAngle(angleRadians: number) {
  return Math.atan2(Math.sin(angleRadians), Math.cos(angleRadians));
}

function dampAngle(
  current: number,
  target: number,
  smoothing: number,
  delta: number,
) {
  const deltaAngle = normalizeAngle(target - current);
  const next = THREE.MathUtils.damp(0, deltaAngle, smoothing, delta);
  return normalizeAngle(current + next);
}

function resolveLookSensitivity(
  sensitivity: AimSensitivitySettings,
  activeWeapon: WeaponKind,
  adsActive: boolean,
) {
  const baseMultiplier = clamp(sensitivity.look, 0.01, 5);
  const adsMultiplier = adsActive
    ? clamp(
        activeWeapon === 'sniper'
          ? sensitivity.sniperAds
          : sensitivity.rifleAds,
        0.01,
        5,
      )
    : 1;
  const verticalMultiplier = clamp(sensitivity.vertical, 0.1, 3);
  const horizontal = LOOK_SENSITIVITY * baseMultiplier * adsMultiplier;

  return {
    horizontal,
    vertical: horizontal * verticalMultiplier,
  };
}

function resolveCircleRect(
  positionXZ: THREE.Vector2,
  radius: number,
  rect: CollisionRect,
) {
  const closestX = clamp(positionXZ.x, rect.minX, rect.maxX);
  const closestZ = clamp(positionXZ.y, rect.minZ, rect.maxZ);
  let dx = positionXZ.x - closestX;
  let dz = positionXZ.y - closestZ;
  let distSq = dx * dx + dz * dz;

  if (distSq >= radius * radius) {
    return;
  }

  if (distSq < 1e-8) {
    const left = Math.abs(positionXZ.x - rect.minX);
    const right = Math.abs(rect.maxX - positionXZ.x);
    const top = Math.abs(positionXZ.y - rect.minZ);
    const bottom = Math.abs(rect.maxZ - positionXZ.y);
    const minPenetration = Math.min(left, right, top, bottom);

    if (minPenetration === left) {
      dx = -1;
      dz = 0;
      distSq = 1;
    } else if (minPenetration === right) {
      dx = 1;
      dz = 0;
      distSq = 1;
    } else if (minPenetration === top) {
      dx = 0;
      dz = -1;
      distSq = 1;
    } else {
      dx = 0;
      dz = 1;
      distSq = 1;
    }
  }

  const dist = Math.sqrt(distSq);
  const pushDistance = radius - dist;
  positionXZ.x += (dx / dist) * pushDistance;
  positionXZ.y += (dz / dist) * pushDistance;
}

function resolveCircleCircle(
  positionXZ: THREE.Vector2,
  radius: number,
  circle: CollisionCircle,
) {
  const dx = positionXZ.x - circle.x;
  const dz = positionXZ.y - circle.z;
  const minDistance = radius + circle.radius;
  const distSq = dx * dx + dz * dz;
  if (distSq >= minDistance * minDistance) {
    return;
  }

  if (distSq < 1e-8) {
    positionXZ.x += minDistance;
    return;
  }

  const dist = Math.sqrt(distSq);
  const pushDistance = minDistance - dist;
  positionXZ.x += (dx / dist) * pushDistance;
  positionXZ.y += (dz / dist) * pushDistance;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
