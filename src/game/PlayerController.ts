import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { WeaponKind } from './Weapon';
import {
  type AimSensitivitySettings,
  type CollisionCircle,
  type CollisionRect,
  type ControlBindings,
  type CrouchMode,
  DEFAULT_PLAYER_SNAPSHOT,
  type InventoryOpenMode,
  type MovementTier,
  type PlayerSnapshot,
  type WorldBounds,
} from './types';
import {
  AIR_STEER_TURN_RATE,
  isSprintInputEligible,
  rotatePlanarVelocityTowards,
} from './movement';
import {
  PLAYER_SPAWN_PITCH,
  PLAYER_SPAWN_POSITION,
} from './scene/scene-constants';

type PlayerAction =
  | 'pickup'
  | 'drop'
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
  worldBounds: WorldBounds;
  sensitivity: AimSensitivitySettings;
  keybinds: ControlBindings;
  crouchMode: CrouchMode;
  inventoryOpenMode: InventoryOpenMode;
  fov: number;
  inputEnabled: boolean;
  cameraEnabled: boolean;
  onAction: (action: PlayerAction) => void;
  onPlayerSnapshot: (snapshot: PlayerSnapshot) => void;
  onTriggerChange: (firing: boolean) => void;
  onUserGesture: () => void;
  getWeaponEquipped: () => boolean;
  getActiveWeapon: () => WeaponKind;
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
  getPlanarSpeed: () => number;
  getMoveInput: () => THREE.Vector2;
  isFirstPerson: () => boolean;
  getViewModeLerp: () => number;
  isADS: () => boolean;
  isSprinting: () => boolean;
  isSprintPressed: () => boolean;
  isWalkPressed: () => boolean;
  isCrouched: () => boolean;
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
const GROUND_Y = 0;
const WALK_SPEED = 5.3;
const SPRINT_SPEED = 8.2;
const LOOK_SENSITIVITY = 0.0022;
const MAX_PITCH = 0.85;
const MIN_PITCH = -1.5;
const GRAVITY_UP = -28;
const GRAVITY_PEAK = -16;
const GRAVITY_DOWN = -48;
const PEAK_VELOCITY_THRESHOLD = 1.4;
const JUMP_SPEED = 10.4;

const CAMERA_ARM_LENGTH = 2.25;
const CAMERA_ARM_LENGTH_ADS = 0.0;
const CAMERA_ARM_LENGTH_SNIPER_ADS = 0.78;
const CAMERA_DEFAULT_ELEVATION = 0.23;
const CAMERA_MIN_ELEVATION = 0.05;
const CAMERA_MAX_ELEVATION = 1.2;
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
const SNIPER_ADS_FOV = 26;
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
const HEAD_TURN_DEAD_ZONE = THREE.MathUtils.degToRad(45);
const MAX_FREE_LOOK_YAW_OFFSET = THREE.MathUtils.degToRad(120);
const FORWARD_DIAGONAL_BODY_YAW_THRESHOLD = 0.35;
const LEAN_TRANSITION_SPEED = 10;
const LEAN_CAMERA_OFFSET_X = 0.54;
const LEAN_CAMERA_TILT = THREE.MathUtils.degToRad(14.4);
// Hide the character early on FPP enter and show it later on FPP exit to reduce camera/model popping.
const FPP_ENTER_VISUAL_THRESHOLD = 0.35;
const FPP_EXIT_VISUAL_THRESHOLD = 0.75;

export function usePlayerController({
  collisionRects,
  collisionCircles,
  worldBounds,
  sensitivity,
  keybinds,
  crouchMode,
  inventoryOpenMode,
  fov,
  inputEnabled,
  cameraEnabled,
  onAction,
  onPlayerSnapshot,
  onTriggerChange,
  onUserGesture,
  getWeaponEquipped,
  getActiveWeapon,
}: UsePlayerControllerOptions): PlayerControllerApi {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);

  const keyStateRef = useRef<KeyState>({});
  const positionRef = useRef(PLAYER_SPAWN_POSITION.clone());
  const velocityRef = useRef(new THREE.Vector2(0, 0));
  const moveInputRef = useRef(new THREE.Vector2(0, 0));
  const sprintPressedRef = useRef(false);
  const walkPressedRef = useRef(false);
  const crouchedRef = useRef(false);
  const resolvedXZRef = useRef(
    new THREE.Vector2(positionRef.current.x, positionRef.current.z),
  );
  const pointerLockedRef = useRef(false);
  const triggerHeldRef = useRef(false);
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
  const jumpQueuedRef = useRef(false);
  const yawRef = useRef(0);
  const bodyYawRef = useRef(0);
  const pitchRef = useRef(0);
  const targetYawRef = useRef(0);
  const targetBodyYawRef = useRef(0);
  const shootAlignUntilRef = useRef(0);
  const runFacingPhaseRef = useRef<RunFacingPhase>('off');
  const runFacingYawRef = useRef(0);
  const headYawOffsetRef = useRef(0);
  const targetPitchRef = useRef(0);
  const pendingMouseRef = useRef(new THREE.Vector2(0, 0));
  const recoilPitchRef = useRef(0);
  const recoilYawRef = useRef(0);
  const firstPersonRef = useRef(false);
  const adsRef = useRef(false);
  const adsLerpRef = useRef(0);
  const crouchLerpRef = useRef(0);
  const crouchCameraLerpRef = useRef(0);
  const viewModeLerpRef = useRef(0);
  const crouchModeRef = useRef<CrouchMode>(crouchMode);
  const crouchHoldLatchRef = useRef(false);
  const inventoryPanelOpenRef = useRef(false);
  const inventoryOpenModeRef = useRef<InventoryOpenMode>(inventoryOpenMode);
  const leanTargetRef = useRef(0);
  const leanLerpRef = useRef(0);
  const tempLookAtRef = useRef(new THREE.Vector3());
  const tempAimDirRef = useRef(new THREE.Vector3());
  const tempFirstPersonCameraPosRef = useRef(new THREE.Vector3());
  const tempThirdPersonCameraPosRef = useRef(new THREE.Vector3());
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
  const sensitivityRef = useRef(sensitivity);
  const keybindsRef = useRef(keybinds);
  const crouchModeSettingRef = useRef(crouchMode);
  const inventoryOpenModeSettingRef = useRef(inventoryOpenMode);
  const fovRef = useRef(fov);
  const inputEnabledRef = useRef(inputEnabled);
  const cameraEnabledRef = useRef(cameraEnabled);

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
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);

  useEffect(() => {
    keybindsRef.current = keybinds;
  }, [keybinds]);

  useEffect(() => {
    crouchModeSettingRef.current = crouchMode;
    crouchModeRef.current = crouchMode;
    crouchHoldLatchRef.current = false;
    if (
      crouchMode === 'hold' &&
      !isBindingDown(keyStateRef.current, keybindsRef.current.crouch)
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
      adsRef.current = false;
      crouchedRef.current = false;
      crouchHoldLatchRef.current = false;
      inventoryPanelOpenRef.current = false;
      sprintPressedRef.current = false;
      walkPressedRef.current = false;
      movementTierRef.current = 'jog';
      shootAlignUntilRef.current = 0;
      runFacingPhaseRef.current = 'off';
      runFacingYawRef.current = bodyYawRef.current;
      headYawOffsetRef.current = 0;
      leanTargetRef.current = 0;
      leanLerpRef.current = 0;
      if (triggerHeldRef.current) {
        triggerHeldRef.current = false;
        triggerCallbackRef.current(false);
      }
      if (document.pointerLockElement === gl.domElement) {
        document.exitPointerLock();
      }
    }
  }, [gl.domElement, inputEnabled]);

  useEffect(() => {
    cameraEnabledRef.current = cameraEnabled;
  }, [cameraEnabled]);

  useEffect(() => {
    const element = gl.domElement;

    const requestLock = (el: HTMLElement) => {
      if (document.pointerLockElement !== null) return;
      el.requestPointerLock();
    };

    const closeInventoryPanel = () => {
      if (!inventoryPanelOpenRef.current) {
        return;
      }
      inventoryPanelOpenRef.current = false;
      if (
        inputEnabledRef.current &&
        document.pointerLockElement === null &&
        document.visibilityState === 'visible'
      ) {
        requestLock(element);
      }
    };

    const openInventoryPanel = () => {
      inventoryPanelOpenRef.current = true;
      adsRef.current = false;
      if (triggerHeldRef.current) {
        triggerHeldRef.current = false;
        triggerCallbackRef.current(false);
      }
      if (document.pointerLockElement === element) {
        document.exitPointerLock();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!inputEnabledRef.current) {
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
      if (!inputEnabledRef.current) {
        return;
      }
      if (inventoryPanelOpenRef.current) {
        return;
      }
      if (event.button === 2) {
        adsRef.current =
          pointerLockedRef.current && weaponEquippedGetterRef.current();
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

      if (!triggerHeldRef.current) {
        triggerHeldRef.current = true;
        triggerCallbackRef.current(true);
      }
    };

    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 2) {
        adsRef.current = false;
        return;
      }

      if (event.button !== 0) {
        return;
      }

      if (triggerHeldRef.current) {
        triggerHeldRef.current = false;
        triggerCallbackRef.current(false);
      }
    };

    const onContextMenu = (event: Event) => {
      event.preventDefault();
    };

    const onMouseMove = (event: MouseEvent) => {
      if (!pointerLockedRef.current || !inputEnabledRef.current) {
        return;
      }

      pendingMouseRef.current.x += event.movementX;
      pendingMouseRef.current.y += event.movementY;
    };

    const onPointerLockChange = () => {
      const locked = document.pointerLockElement !== null;
      pointerLockedRef.current = locked;
      if (locked) {
        userGestureCallbackRef.current();
      }
      if (!locked && triggerHeldRef.current) {
        triggerHeldRef.current = false;
        triggerCallbackRef.current(false);
      }
      if (!locked) {
        if (!inventoryPanelOpenRef.current) {
          keyStateRef.current = {};
          jumpQueuedRef.current = false;
          crouchedRef.current = false;
          crouchHoldLatchRef.current = false;
          sprintPressedRef.current = false;
          walkPressedRef.current = false;
          movementTierRef.current = 'jog';
          shootAlignUntilRef.current = 0;
          runFacingPhaseRef.current = 'off';
          runFacingYawRef.current = bodyYawRef.current;
          headYawOffsetRef.current = 0;
          leanTargetRef.current = 0;
          leanLerpRef.current = 0;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    element.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    element.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('pointerlockchange', onPointerLockChange);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      element.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      element.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
    };
  }, [gl.domElement]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 20);
    const nowMs = performance.now();
    const keys = keyStateRef.current;
    const inventoryOpen = inventoryPanelOpenRef.current;
    const movementEnabled =
      inputEnabledRef.current && (pointerLockedRef.current || inventoryOpen);
    const lookEnabled =
      inputEnabledRef.current && pointerLockedRef.current && !inventoryOpen;
    const weaponEquipped = weaponEquippedGetterRef.current();
    const activeWeapon = activeWeaponGetterRef.current();
    if (!weaponEquipped && adsRef.current) {
      adsRef.current = false;
    }
    const lookSensitivity = resolveLookSensitivity(
      sensitivityRef.current,
      activeWeapon,
      adsRef.current,
    );

    const mouse = pendingMouseRef.current;
    if (lookEnabled && (mouse.x !== 0 || mouse.y !== 0)) {
      targetYawRef.current -= mouse.x * lookSensitivity.horizontal;
      targetPitchRef.current = THREE.MathUtils.clamp(
        targetPitchRef.current - mouse.y * lookSensitivity.vertical,
        MIN_PITCH,
        MAX_PITCH,
      );
      mouse.set(0, 0);
    }

    yawRef.current = targetYawRef.current;
    pitchRef.current = targetPitchRef.current;

    const bindings = keybindsRef.current;
    const forward = movementEnabled
      ? (isBindingDown(keys, bindings.moveForward) ? 1 : 0) +
        (isBindingDown(keys, bindings.moveBackward) ? -1 : 0)
      : 0;
    const strafe = movementEnabled
      ? (isBindingDown(keys, bindings.moveRight) ? 1 : 0) +
        (isBindingDown(keys, bindings.moveLeft) ? -1 : 0)
      : 0;
    moveInputRef.current.set(strafe, forward);
    if (moveInputRef.current.lengthSq() > 1) {
      moveInputRef.current.normalize();
    }

    const crouchBinding = bindings.crouch;
    const crouchHeld = movementEnabled && isBindingDown(keys, crouchBinding);
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
    const crouchSprintLocked =
      crouchedRef.current ||
      crouchLerpRef.current >= CROUCH_SPRINT_LOCK_THRESHOLD;
    const sprintPressed =
      movementEnabled &&
      isBindingDown(keys, bindings.sprint) &&
      !crouchSprintLocked &&
      !adsRef.current;
    const walkPressed =
      movementEnabled &&
      isBindingDown(keys, bindings.walkModifier) &&
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
    const movementTier: MovementTier = sprinting
      ? 'run'
      : walkPressed
        ? 'walk'
        : 'jog';
    movementTierRef.current = movementTier;

    const moveSpeed =
      movementTier === 'run'
        ? SPRINT_SPEED * movementProfile.sprintScale
        : WALK_SPEED *
          (movementTier === 'walk'
            ? movementProfile.walkScale
            : movementProfile.jogScale);

    const sinYaw = Math.sin(yawRef.current);
    const cosYaw = Math.cos(yawRef.current);
    const localX = moveInputRef.current.x;
    const localZ = moveInputRef.current.y;
    const desiredX = localX * cosYaw - localZ * sinYaw;
    const desiredZ = -localX * sinYaw - localZ * cosYaw;

    if (groundedRef.current) {
      if (movementEnabled) {
        velocityRef.current.x = desiredX * moveSpeed;
        velocityRef.current.y = desiredZ * moveSpeed;
      } else {
        velocityRef.current.set(0, 0);
      }
    } else if (!movementEnabled) {
      velocityRef.current.set(0, 0);
      airborneMomentumSpeedRef.current = 0;
    } else if (hasDirectionalInput) {
      const desiredHeadingYaw = Math.atan2(-desiredX, -desiredZ);
      rotatePlanarVelocityTowards(
        velocityRef.current,
        desiredHeadingYaw,
        AIR_STEER_TURN_RATE * delta,
      );
      const airborneSpeed = airborneMomentumSpeedRef.current;
      if (airborneSpeed > 0.0001) {
        velocityRef.current.setLength(airborneSpeed);
      }
    }
    planarSpeedRef.current = Math.hypot(
      velocityRef.current.x,
      velocityRef.current.y,
    );

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
          ? yawRef.current - Math.sign(localX) * HEAD_TURN_DEAD_ZONE
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

    positionRef.current.set(
      resolvedXZRef.current.x,
      positionRef.current.y,
      resolvedXZRef.current.y,
    );

    if (movementEnabled && jumpQueuedRef.current && groundedRef.current) {
      jumpQueuedRef.current = false;
      airborneMomentumSpeedRef.current = planarSpeedRef.current;
      groundedRef.current = false;
      verticalVelocityRef.current = JUMP_SPEED;
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

      if (positionRef.current.y <= GROUND_Y) {
        positionRef.current.y = GROUND_Y;
        verticalVelocityRef.current = 0;
        groundedRef.current = true;
        airborneMomentumSpeedRef.current = 0;
      }
    } else {
      groundedRef.current = true;
      positionRef.current.y = GROUND_Y;
      airborneMomentumSpeedRef.current = 0;
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
      !sprinting && peekLeftHeld && !peekRightHeld
        ? -1
        : !sprinting && peekRightHeld && !peekLeftHeld
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

    const elevationAngle = clamp(
      CAMERA_DEFAULT_ELEVATION - currentPitch * 0.6 - sniperADS * 0.05,
      CAMERA_MIN_ELEVATION,
      CAMERA_MAX_ELEVATION,
    );

    const armLenAdsTarget =
      activeWeapon === 'sniper'
        ? CAMERA_ARM_LENGTH_SNIPER_ADS
        : CAMERA_ARM_LENGTH_ADS;
    const shoulderAdsTarget =
      activeWeapon === 'sniper'
        ? SHOULDER_OFFSET_SNIPER_ADS
        : SHOULDER_OFFSET_ADS;
    const armLen = THREE.MathUtils.lerp(
      CAMERA_ARM_LENGTH,
      armLenAdsTarget,
      adsT,
    );
    const shoulder = THREE.MathUtils.lerp(
      SHOULDER_OFFSET,
      shoulderAdsTarget,
      adsT,
    );

    const horizontalDist = armLen * Math.cos(elevationAngle);
    const verticalDist = armLen * Math.sin(elevationAngle);

    const backX = sinCurrentYaw;
    const backZ = cosCurrentYaw;
    const rightX = cosCurrentYaw;
    const rightZ = -sinCurrentYaw;

    const tppCameraPos = tempThirdPersonCameraPosRef.current;
    tppCameraPos.set(
      positionRef.current.x + horizontalDist * backX + shoulder * rightX,
      positionRef.current.y +
        LOOK_AT_HEIGHT +
        crouchLookHeightOffset +
        verticalDist -
        sniperADS * 0.08,
      positionRef.current.z + horizontalDist * backZ + shoulder * rightZ,
    );
    if (Math.abs(leanT) > 0.001) {
      const leanOffsetX = leanT * LEAN_CAMERA_OFFSET_X;
      fppCameraPos.x += cosCurrentYaw * leanOffsetX;
      fppCameraPos.z += -sinCurrentYaw * leanOffsetX;
      tppCameraPos.x += cosCurrentYaw * leanOffsetX;
      tppCameraPos.z += -sinCurrentYaw * leanOffsetX;
    }

    if (cameraEnabledRef.current) {
      camera.position.copy(tppCameraPos).lerp(fppCameraPos, viewT);

      if ('isPerspectiveCamera' in camera && camera.isPerspectiveCamera) {
        const baseFov = fovRef.current;
        const adsFovTarget =
          activeWeapon === 'sniper' ? SNIPER_ADS_FOV : RIFLE_ADS_FOV;
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
    getPlanarSpeed: () => planarSpeedRef.current,
    getMoveInput: () => moveInputRef.current,
    isFirstPerson: () =>
      firstPersonRef.current
        ? viewModeLerpRef.current >= FPP_ENTER_VISUAL_THRESHOLD
        : viewModeLerpRef.current > FPP_EXIT_VISUAL_THRESHOLD,
    getViewModeLerp: () => viewModeLerpRef.current,
    isADS: () => adsRef.current,
    isSprinting: () => sprintingRef.current,
    isSprintPressed: () => sprintPressedRef.current,
    isWalkPressed: () => walkPressedRef.current,
    isCrouched: () => crouchedRef.current,
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
      if (!inputEnabledRef.current) return;
      userGestureCallbackRef.current();
      if (pointerLockedRef.current) return;
      gl.domElement.requestPointerLock();
    },
    releasePointerLock: () => {
      if (document.pointerLockElement === gl.domElement) {
        document.exitPointerLock();
      }
    },
    setPose: (position, yawRadians, pitchRadians = PLAYER_SPAWN_PITCH) => {
      positionRef.current.copy(position);
      resolvedXZRef.current.set(position.x, position.z);
      velocityRef.current.set(0, 0);
      moveInputRef.current.set(0, 0);
      verticalVelocityRef.current = 0;
      airborneMomentumSpeedRef.current = 0;
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
