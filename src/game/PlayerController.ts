import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { WeaponKind } from "./Weapon";
import type {
  AimSensitivitySettings,
  CollisionRect,
  ControlBindings,
  PlayerSnapshot,
  WorldBounds,
} from "./types";
import {
  PLAYER_SPAWN_PITCH,
  PLAYER_SPAWN_POSITION,
} from "./scene/scene-constants";

type PlayerAction =
  | "pickup"
  | "drop"
  | "reset"
  | "equipRifle"
  | "equipSniper";

type UsePlayerControllerOptions = {
  collisionRects: CollisionRect[];
  worldBounds: WorldBounds;
  sensitivity: AimSensitivitySettings;
  keybinds: ControlBindings;
  fov: number;
  inputEnabled: boolean;
  cameraEnabled: boolean;
  onAction: (action: PlayerAction) => void;
  onPlayerSnapshot: (snapshot: PlayerSnapshot) => void;
  onTriggerChange: (firing: boolean) => void;
  onUserGesture: () => void;
  getActiveWeapon: () => WeaponKind;
};

export type PlayerControllerApi = {
  addRecoil: (pitchRadians: number, yawRadians: number) => void;
  getPosition: () => THREE.Vector3;
  getYaw: () => number;
  getMoveInput: () => THREE.Vector2;
  isFirstPerson: () => boolean;
  isADS: () => boolean;
  isSprinting: () => boolean;
  isMoving: () => boolean;
  isGrounded: () => boolean;
  requestPointerLock: () => void;
  releasePointerLock: () => void;
  setPose: (position: THREE.Vector3, yawRadians: number, pitchRadians?: number) => void;
};

type KeyState = Record<string, boolean>;

const PLAYER_RADIUS = 0.35;
const GROUND_Y = 0;
const WALK_SPEED = 5.3;
const SPRINT_SPEED = 8.2;
const LOOK_SENSITIVITY = 0.0022;
const MAX_PITCH = 0.85;
const MIN_PITCH = -0.5;
const GRAVITY_UP = -28;
const GRAVITY_PEAK = -16;
const GRAVITY_DOWN = -48;
const PEAK_VELOCITY_THRESHOLD = 1.4;
const JUMP_SPEED = 10.4;

const CAMERA_ARM_LENGTH = 2.25;
const CAMERA_ARM_LENGTH_ADS = 1.55;
const CAMERA_ARM_LENGTH_SNIPER_ADS = 0.78;
const CAMERA_DEFAULT_ELEVATION = 0.35;
const CAMERA_MIN_ELEVATION = 0.05;
const CAMERA_MAX_ELEVATION = 1.2;
const LOOK_AT_HEIGHT = 1.2;
const SHOULDER_OFFSET = 0.5;
const SHOULDER_OFFSET_ADS = 0.3;
const SHOULDER_OFFSET_SNIPER_ADS = 0.16;
const AIM_LOOK_DISTANCE = 120;
const FIRST_PERSON_CAMERA_HEIGHT = 1.55;
const FIRST_PERSON_CAMERA_FORWARD_OFFSET = 0.06;
const RIFLE_ADS_FOV = 58;
const SNIPER_ADS_FOV = 26;
const VIEW_MODE_TRANSITION_SPEED = 10;
const SHOULDER_SWAP_TRANSITION_SPEED = 12;
// Hide the character early on FPP enter and show it later on FPP exit to reduce camera/model popping.
const FPP_ENTER_VISUAL_THRESHOLD = 0.35;
const FPP_EXIT_VISUAL_THRESHOLD = 0.75;

export function usePlayerController({
  collisionRects,
  worldBounds,
  sensitivity,
  keybinds,
  fov,
  inputEnabled,
  cameraEnabled,
  onAction,
  onPlayerSnapshot,
  onTriggerChange,
  onUserGesture,
  getActiveWeapon,
}: UsePlayerControllerOptions): PlayerControllerApi {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);

  const keyStateRef = useRef<KeyState>({});
  const positionRef = useRef(PLAYER_SPAWN_POSITION.clone());
  const velocityRef = useRef(new THREE.Vector2(0, 0));
  const moveInputRef = useRef(new THREE.Vector2(0, 0));
  const resolvedXZRef = useRef(new THREE.Vector2(positionRef.current.x, positionRef.current.z));
  const pointerLockedRef = useRef(false);
  const triggerHeldRef = useRef(false);
  const movingRef = useRef(false);
  const sprintingRef = useRef(false);
  const groundedRef = useRef(true);
  const verticalVelocityRef = useRef(0);
  const jumpQueuedRef = useRef(false);
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const targetYawRef = useRef(0);
  const targetPitchRef = useRef(0);
  const pendingMouseRef = useRef(new THREE.Vector2(0, 0));
  const recoilPitchRef = useRef(0);
  const recoilYawRef = useRef(0);
  const firstPersonRef = useRef(false);
  const adsRef = useRef(false);
  const adsLerpRef = useRef(0);
  const viewModeLerpRef = useRef(0);
  const shoulderSideTargetRef = useRef(1);
  const shoulderSideLerpRef = useRef(1);
  const tempLookAtRef = useRef(new THREE.Vector3());
  const tempAimDirRef = useRef(new THREE.Vector3());
  const tempFirstPersonCameraPosRef = useRef(new THREE.Vector3());
  const tempThirdPersonCameraPosRef = useRef(new THREE.Vector3());
  const snapshotAccumulatorRef = useRef(0);
  const snapshotObjectRef = useRef<PlayerSnapshot>({
    x: 0, y: 0, z: 0, speed: 0,
    sprinting: false, moving: false, grounded: true,
    pointerLocked: false, canInteract: false,
  });
  const actionCallbackRef = useRef(onAction);
  const triggerCallbackRef = useRef(onTriggerChange);
  const snapshotCallbackRef = useRef(onPlayerSnapshot);
  const userGestureCallbackRef = useRef(onUserGesture);
  const activeWeaponGetterRef = useRef(getActiveWeapon);
  const sensitivityRef = useRef(sensitivity);
  const keybindsRef = useRef(keybinds);
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
    activeWeaponGetterRef.current = getActiveWeapon;
  }, [getActiveWeapon]);

  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);

  useEffect(() => {
    keybindsRef.current = keybinds;
  }, [keybinds]);

  useEffect(() => {
    fovRef.current = fov;
  }, [fov]);

  useEffect(() => {
    inputEnabledRef.current = inputEnabled;
    if (!inputEnabled) {
      keyStateRef.current = {};
      jumpQueuedRef.current = false;
      adsRef.current = false;
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

    const onKeyDown = (event: KeyboardEvent) => {
      if (!inputEnabledRef.current) {
        return;
      }
      const bindings = keybindsRef.current;

      if (event.code === bindings.pickup && !event.repeat) {
        actionCallbackRef.current("pickup");
      }
      if (event.code === bindings.drop && !event.repeat) {
        actionCallbackRef.current("drop");
      }
      if (event.code === bindings.reset && !event.repeat) {
        actionCallbackRef.current("reset");
      }
      if (event.code === bindings.equipRifle && !event.repeat) {
        actionCallbackRef.current("equipRifle");
      }
      if (event.code === bindings.equipSniper && !event.repeat) {
        actionCallbackRef.current("equipSniper");
      }
      if (event.code === bindings.toggleView && !event.repeat) {
        firstPersonRef.current = !firstPersonRef.current;
      }
      if (event.code === bindings.shoulderLeft && !event.repeat) {
        shoulderSideTargetRef.current = -1;
      }
      if (event.code === bindings.shoulderRight && !event.repeat) {
        shoulderSideTargetRef.current = 1;
      }

      if (event.code === bindings.jump && !event.repeat && pointerLockedRef.current && groundedRef.current) {
        jumpQueuedRef.current = true;
      }

      keyStateRef.current[event.code] = true;
    };

    const onKeyUp = (event: KeyboardEvent) => {
      keyStateRef.current[event.code] = false;
    };

    const onMouseDown = (event: MouseEvent) => {
      if (!inputEnabledRef.current) {
        return;
      }
      if (event.button === 2) {
        if (pointerLockedRef.current) {
          adsRef.current = true;
        }
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
        keyStateRef.current = {};
        jumpQueuedRef.current = false;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    element.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onMouseMove);
    element.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("pointerlockchange", onPointerLockChange);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      element.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      element.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
    };
  }, [gl.domElement]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 20);
    const keys = keyStateRef.current;
    const controlsEnabled = pointerLockedRef.current && inputEnabledRef.current;
    const activeWeapon = activeWeaponGetterRef.current();
    const lookSensitivity = resolveLookSensitivity(
      sensitivityRef.current,
      activeWeapon,
      adsRef.current,
    );

    const mouse = pendingMouseRef.current;
    if (controlsEnabled && (mouse.x !== 0 || mouse.y !== 0)) {
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
    const forward = controlsEnabled
      ? (isBindingDown(keys, bindings.moveForward) ? 1 : 0) + (isBindingDown(keys, bindings.moveBackward) ? -1 : 0)
      : 0;
    const strafe = controlsEnabled
      ? (isBindingDown(keys, bindings.moveRight) ? 1 : 0) + (isBindingDown(keys, bindings.moveLeft) ? -1 : 0)
      : 0;
    moveInputRef.current.set(strafe, forward);
    if (moveInputRef.current.lengthSq() > 1) {
      moveInputRef.current.normalize();
    }

    const sprinting =
      controlsEnabled &&
      isBindingDown(keys, bindings.sprint) &&
      moveInputRef.current.y >= 0 &&
      groundedRef.current;
    const moveSpeed = sprinting ? SPRINT_SPEED : WALK_SPEED;

    const sinYaw = Math.sin(yawRef.current);
    const cosYaw = Math.cos(yawRef.current);
    const localX = moveInputRef.current.x;
    const localZ = moveInputRef.current.y;
    const desiredX = localX * cosYaw - localZ * sinYaw;
    const desiredZ = -localX * sinYaw - localZ * cosYaw;

    if (controlsEnabled) {
      velocityRef.current.x = desiredX * moveSpeed;
      velocityRef.current.y = desiredZ * moveSpeed;
    } else {
      velocityRef.current.set(0, 0);
    }

    resolvedXZRef.current.set(positionRef.current.x, positionRef.current.z);
    resolvedXZRef.current.x += velocityRef.current.x * delta;
    resolvedXZRef.current.x = clamp(
      resolvedXZRef.current.x,
      worldBounds.minX + PLAYER_RADIUS,
      worldBounds.maxX - PLAYER_RADIUS,
    );
    resolveCollisions(resolvedXZRef.current, PLAYER_RADIUS, collisionRects);

    resolvedXZRef.current.y += velocityRef.current.y * delta;
    resolvedXZRef.current.y = clamp(
      resolvedXZRef.current.y,
      worldBounds.minZ + PLAYER_RADIUS,
      worldBounds.maxZ - PLAYER_RADIUS,
    );
    resolveCollisions(resolvedXZRef.current, PLAYER_RADIUS, collisionRects);

    positionRef.current.set(resolvedXZRef.current.x, positionRef.current.y, resolvedXZRef.current.y);

    if (controlsEnabled && jumpQueuedRef.current && groundedRef.current) {
      jumpQueuedRef.current = false;
      groundedRef.current = false;
      verticalVelocityRef.current = JUMP_SPEED;
    } else {
      jumpQueuedRef.current = false;
    }

    if (!groundedRef.current || verticalVelocityRef.current !== 0) {
      const vy = verticalVelocityRef.current;
      const gravity =
        vy > PEAK_VELOCITY_THRESHOLD ? GRAVITY_UP :
        vy > -PEAK_VELOCITY_THRESHOLD ? GRAVITY_PEAK :
        GRAVITY_DOWN;
      verticalVelocityRef.current += gravity * delta;
      positionRef.current.y += verticalVelocityRef.current * delta;

      if (positionRef.current.y <= GROUND_Y) {
        positionRef.current.y = GROUND_Y;
        verticalVelocityRef.current = 0;
        groundedRef.current = true;
      }
    } else {
      groundedRef.current = true;
      positionRef.current.y = GROUND_Y;
    }

    recoilPitchRef.current = THREE.MathUtils.damp(recoilPitchRef.current, 0, 18, delta);
    recoilYawRef.current = THREE.MathUtils.damp(recoilYawRef.current, 0, 18, delta);

    const adsTarget = adsRef.current ? 1 : 0;
    adsLerpRef.current = THREE.MathUtils.damp(adsLerpRef.current, adsTarget, 12, delta);
    const adsT = adsLerpRef.current;
    const sniperADS = activeWeapon === "sniper" ? adsT : 0;
    const viewTarget = firstPersonRef.current || adsRef.current ? 1 : 0;
    viewModeLerpRef.current = THREE.MathUtils.damp(
      viewModeLerpRef.current,
      viewTarget,
      VIEW_MODE_TRANSITION_SPEED,
      delta,
    );
    const viewT = viewModeLerpRef.current;
    shoulderSideLerpRef.current = THREE.MathUtils.damp(
      shoulderSideLerpRef.current,
      shoulderSideTargetRef.current,
      SHOULDER_SWAP_TRANSITION_SPEED,
      delta,
    );
    const shoulderSide = shoulderSideLerpRef.current;

    const currentYaw = yawRef.current + recoilYawRef.current;
    const currentPitch = pitchRef.current + recoilPitchRef.current;
    const sinCurrentYaw = Math.sin(currentYaw);
    const cosCurrentYaw = Math.cos(currentYaw);
    const aimDir = tempAimDirRef.current;
    const pitchCos = Math.cos(currentPitch);
    aimDir.set(
      -sinCurrentYaw * pitchCos,
      Math.sin(currentPitch),
      -cosCurrentYaw * pitchCos,
    ).normalize();

    const fppCameraPos = tempFirstPersonCameraPosRef.current;
    fppCameraPos.set(
      positionRef.current.x,
      positionRef.current.y + FIRST_PERSON_CAMERA_HEIGHT,
      positionRef.current.z,
    );
    fppCameraPos.addScaledVector(aimDir, FIRST_PERSON_CAMERA_FORWARD_OFFSET);
    if (sniperADS > 0) {
      fppCameraPos.x += cosCurrentYaw * (0.045 * shoulderSide) * sniperADS;
      fppCameraPos.y -= 0.02 * sniperADS;
      fppCameraPos.z += -sinCurrentYaw * (0.045 * shoulderSide) * sniperADS;
    }

    const elevationAngle = clamp(
      CAMERA_DEFAULT_ELEVATION - currentPitch * 0.6 - sniperADS * 0.05,
      CAMERA_MIN_ELEVATION,
      CAMERA_MAX_ELEVATION,
    );

    const armLenAdsTarget = activeWeapon === "sniper" ? CAMERA_ARM_LENGTH_SNIPER_ADS : CAMERA_ARM_LENGTH_ADS;
    const shoulderAdsTarget = activeWeapon === "sniper" ? SHOULDER_OFFSET_SNIPER_ADS : SHOULDER_OFFSET_ADS;
    const armLen = THREE.MathUtils.lerp(CAMERA_ARM_LENGTH, armLenAdsTarget, adsT);
    const shoulder = THREE.MathUtils.lerp(SHOULDER_OFFSET, shoulderAdsTarget, adsT) * shoulderSide;

    const horizontalDist = armLen * Math.cos(elevationAngle);
    const verticalDist = armLen * Math.sin(elevationAngle);

    const backX = sinCurrentYaw;
    const backZ = cosCurrentYaw;
    const rightX = cosCurrentYaw;
    const rightZ = -sinCurrentYaw;

    const tppCameraPos = tempThirdPersonCameraPosRef.current;
    tppCameraPos.set(
      positionRef.current.x + horizontalDist * backX + shoulder * rightX,
      positionRef.current.y + LOOK_AT_HEIGHT + verticalDist - sniperADS * 0.08,
      positionRef.current.z + horizontalDist * backZ + shoulder * rightZ,
    );

    if (cameraEnabledRef.current) {
      camera.position.copy(tppCameraPos).lerp(fppCameraPos, viewT);

      if ("isPerspectiveCamera" in camera && camera.isPerspectiveCamera) {
        const baseFov = fovRef.current;
        const adsFovTarget = activeWeapon === "sniper"
          ? SNIPER_ADS_FOV
          : RIFLE_ADS_FOV;
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
    } else if ("isPerspectiveCamera" in camera && camera.isPerspectiveCamera) {
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

    const speed = Math.hypot(velocityRef.current.x, velocityRef.current.y);
    movingRef.current = speed > 0.15;
    sprintingRef.current = sprinting && movingRef.current;

    snapshotAccumulatorRef.current += delta;
    if (snapshotAccumulatorRef.current >= 0.05) {
      snapshotAccumulatorRef.current = 0;
      const snap = snapshotObjectRef.current;
      snap.x = positionRef.current.x;
      snap.y = positionRef.current.y;
      snap.z = positionRef.current.z;
      snap.speed = speed;
      snap.sprinting = sprintingRef.current;
      snap.moving = movingRef.current;
      snap.grounded = groundedRef.current;
      snap.pointerLocked = pointerLockedRef.current;
      snap.canInteract = false;
      snapshotCallbackRef.current(snap);
    }
  });

  return {
    addRecoil: (pitchRadians, yawRadians) => {
      recoilPitchRef.current += pitchRadians;
      recoilYawRef.current += yawRadians;
      targetPitchRef.current = THREE.MathUtils.clamp(
        targetPitchRef.current + pitchRadians * 0.9,
        MIN_PITCH,
        MAX_PITCH,
      );
      targetYawRef.current += yawRadians * 0.6;
    },
    getPosition: () => positionRef.current,
    getYaw: () => yawRef.current,
    getMoveInput: () => moveInputRef.current,
    isFirstPerson: () =>
      firstPersonRef.current
        ? viewModeLerpRef.current >= FPP_ENTER_VISUAL_THRESHOLD
        : viewModeLerpRef.current > FPP_EXIT_VISUAL_THRESHOLD,
    isADS: () => adsRef.current,
    isSprinting: () => sprintingRef.current,
    isMoving: () => movingRef.current,
    isGrounded: () => groundedRef.current,
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
      groundedRef.current = true;
      jumpQueuedRef.current = false;
      yawRef.current = yawRadians;
      targetYawRef.current = yawRadians;
      pitchRef.current = pitchRadians;
      targetPitchRef.current = pitchRadians;
      recoilPitchRef.current = 0;
      recoilYawRef.current = 0;
      pendingMouseRef.current.set(0, 0);
      adsRef.current = false;
      adsLerpRef.current = 0;
      firstPersonRef.current = false;
      viewModeLerpRef.current = 0;
      shoulderSideTargetRef.current = 1;
      shoulderSideLerpRef.current = 1;
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
      snapshot.moving = false;
      snapshot.grounded = true;
      snapshot.pointerLocked = pointerLockedRef.current;
      snapshot.canInteract = false;
      snapshotCallbackRef.current(snapshot);
    },
  };
}

function resolveCollisions(positionXZ: THREE.Vector2, radius: number, collisionRects: CollisionRect[]) {
  for (const rect of collisionRects) {
    resolveCircleRect(positionXZ, radius, rect);
  }
}

function isBindingDown(keys: KeyState, bindingCode: string) {
  return Boolean(bindingCode && keys[bindingCode]);
}

function resolveLookSensitivity(
  sensitivity: AimSensitivitySettings,
  activeWeapon: WeaponKind,
  adsActive: boolean,
) {
  const baseMultiplier = clamp(sensitivity.look, 0.01, 5);
  const adsMultiplier = adsActive
    ? clamp(activeWeapon === "sniper" ? sensitivity.sniperAds : sensitivity.rifleAds, 0.01, 5)
    : 1;
  const verticalMultiplier = clamp(sensitivity.vertical, 0.1, 3);
  const horizontal = LOOK_SENSITIVITY * baseMultiplier * adsMultiplier;

  return {
    horizontal,
    vertical: horizontal * verticalMultiplier,
  };
}

function resolveCircleRect(positionXZ: THREE.Vector2, radius: number, rect: CollisionRect) {
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
