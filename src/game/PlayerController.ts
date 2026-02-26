import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { CollisionRect, PlayerSnapshot, WorldBounds } from "./types";

type PlayerAction = "pickup" | "drop" | "reset";

type UsePlayerControllerOptions = {
  collisionRects: CollisionRect[];
  worldBounds: WorldBounds;
  onAction: (action: PlayerAction) => void;
  onPlayerSnapshot: (snapshot: PlayerSnapshot) => void;
  onTriggerChange: (firing: boolean) => void;
  onUserGesture: () => void;
};

export type PlayerControllerApi = {
  addRecoil: (pitchRadians: number, yawRadians: number) => void;
  getPosition: () => THREE.Vector3;
  getYaw: () => number;
  isADS: () => boolean;
  isSprinting: () => boolean;
  isMoving: () => boolean;
  isGrounded: () => boolean;
  requestPointerLock: () => void;
};

type KeyState = Record<string, boolean>;

const PLAYER_RADIUS = 0.35;
const GROUND_Y = 0;
const WALK_SPEED = 5.3;
const SPRINT_SPEED = 8.2;
const ACCEL = 18;
const AIR_DAMP = 12;
const LOOK_SENSITIVITY = 0.0022;
const MAX_PITCH = 0.85;
const MIN_PITCH = -0.5;
const GRAVITY_UP = -22;
const GRAVITY_PEAK = -10;
const GRAVITY_DOWN = -38;
const PEAK_VELOCITY_THRESHOLD = 2.0;
const JUMP_SPEED = 11.5;

const CAMERA_ARM_LENGTH = 6;
const CAMERA_ARM_LENGTH_ADS = 3.0;
const CAMERA_DEFAULT_ELEVATION = 0.35;
const CAMERA_MIN_ELEVATION = 0.05;
const CAMERA_MAX_ELEVATION = 1.2;
const LOOK_AT_HEIGHT = 1.2;
const SHOULDER_OFFSET = 1.2;
const SHOULDER_OFFSET_ADS = 0.5;

export function usePlayerController({
  collisionRects,
  worldBounds,
  onAction,
  onPlayerSnapshot,
  onTriggerChange,
  onUserGesture,
}: UsePlayerControllerOptions): PlayerControllerApi {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);

  const keyStateRef = useRef<KeyState>({});
  const positionRef = useRef(new THREE.Vector3(0, GROUND_Y, 6));
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
  const adsRef = useRef(false);
  const adsLerpRef = useRef(0);
  const tempLookAtRef = useRef(new THREE.Vector3());
  const snapshotAccumulatorRef = useRef(0);
  const actionCallbackRef = useRef(onAction);
  const triggerCallbackRef = useRef(onTriggerChange);
  const snapshotCallbackRef = useRef(onPlayerSnapshot);
  const userGestureCallbackRef = useRef(onUserGesture);

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

  const fallbackActiveRef = useRef(false);

  useEffect(() => {
    const element = gl.domElement;
    const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

    const enterFallbackCapture = () => {
      if (fallbackActiveRef.current) return;
      fallbackActiveRef.current = true;
      pointerLockedRef.current = true;
      userGestureCallbackRef.current();
      console.log("[PointerLock] Fallback capture mode activated (Tauri)");
    };

    const exitFallbackCapture = () => {
      if (!fallbackActiveRef.current) return;
      fallbackActiveRef.current = false;
      pointerLockedRef.current = false;
      if (triggerHeldRef.current) {
        triggerHeldRef.current = false;
        triggerCallbackRef.current(false);
      }
      keyStateRef.current = {};
      jumpQueuedRef.current = false;
      adsRef.current = false;
    };

    const requestLock = (el: HTMLElement) => {
      if (document.pointerLockElement !== null) return;
      try {
        const result = el.requestPointerLock();
        if (result && typeof result.then === "function") {
          result.then(() => {
            console.log("[PointerLock] Acquired via browser API");
          }).catch(() => {
            if (isTauri) {
              enterFallbackCapture();
            }
          });
        }
      } catch {
        if (isTauri) {
          enterFallbackCapture();
        }
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Escape" && !event.repeat && fallbackActiveRef.current) {
        exitFallbackCapture();
        return;
      }

      if (event.code === "KeyF" && !event.repeat) {
        actionCallbackRef.current("pickup");
      }
      if (event.code === "KeyG" && !event.repeat) {
        actionCallbackRef.current("drop");
      }
      if (event.code === "KeyR" && !event.repeat) {
        actionCallbackRef.current("reset");
      }

      if (event.code === "Space" && !event.repeat && pointerLockedRef.current && groundedRef.current) {
        jumpQueuedRef.current = true;
      }

      keyStateRef.current[event.code] = true;
    };

    const onKeyUp = (event: KeyboardEvent) => {
      keyStateRef.current[event.code] = false;
    };

    const onMouseDown = (event: MouseEvent) => {
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
      if (!pointerLockedRef.current) {
        return;
      }

      pendingMouseRef.current.x += event.movementX;
      pendingMouseRef.current.y += event.movementY;
    };

    const onPointerLockChange = () => {
      if (fallbackActiveRef.current) return;
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
    const controlsEnabled = pointerLockedRef.current;

    const mouse = pendingMouseRef.current;
    if (controlsEnabled && (mouse.x !== 0 || mouse.y !== 0)) {
      targetYawRef.current -= mouse.x * LOOK_SENSITIVITY;
      targetPitchRef.current = THREE.MathUtils.clamp(
        targetPitchRef.current - mouse.y * LOOK_SENSITIVITY,
        MIN_PITCH,
        MAX_PITCH,
      );
      mouse.set(0, 0);
    }

    yawRef.current = THREE.MathUtils.damp(yawRef.current, targetYawRef.current, 18, delta);
    pitchRef.current = THREE.MathUtils.damp(pitchRef.current, targetPitchRef.current, 22, delta);

    const forward = controlsEnabled ? (keys.KeyW ? 1 : 0) + (keys.KeyS ? -1 : 0) : 0;
    const strafe = controlsEnabled ? (keys.KeyD ? 1 : 0) + (keys.KeyA ? -1 : 0) : 0;
    moveInputRef.current.set(strafe, forward);
    if (moveInputRef.current.lengthSq() > 1) {
      moveInputRef.current.normalize();
    }

    const sprinting =
      controlsEnabled &&
      Boolean(keys.ShiftLeft || keys.ShiftRight) &&
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
      velocityRef.current.x = THREE.MathUtils.damp(
        velocityRef.current.x,
        desiredX * moveSpeed,
        desiredX !== 0 ? ACCEL : AIR_DAMP,
        delta,
      );
      velocityRef.current.y = THREE.MathUtils.damp(
        velocityRef.current.y,
        desiredZ * moveSpeed,
        desiredZ !== 0 ? ACCEL : AIR_DAMP,
        delta,
      );
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

    positionRef.current.set(resolvedXZRef.current.x, GROUND_Y, resolvedXZRef.current.y);

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

    const currentYaw = yawRef.current + recoilYawRef.current;
    const currentPitch = pitchRef.current + recoilPitchRef.current;
    const elevationAngle = clamp(
      CAMERA_DEFAULT_ELEVATION - currentPitch * 0.6,
      CAMERA_MIN_ELEVATION,
      CAMERA_MAX_ELEVATION,
    );

    const armLen = THREE.MathUtils.lerp(CAMERA_ARM_LENGTH, CAMERA_ARM_LENGTH_ADS, adsT);
    const shoulder = THREE.MathUtils.lerp(SHOULDER_OFFSET, SHOULDER_OFFSET_ADS, adsT);

    const horizontalDist = armLen * Math.cos(elevationAngle);
    const verticalDist = armLen * Math.sin(elevationAngle);

    const backX = Math.sin(currentYaw);
    const backZ = Math.cos(currentYaw);
    const rightX = Math.cos(currentYaw);
    const rightZ = -Math.sin(currentYaw);

    camera.position.set(
      positionRef.current.x + horizontalDist * backX + shoulder * rightX,
      positionRef.current.y + LOOK_AT_HEIGHT + verticalDist,
      positionRef.current.z + horizontalDist * backZ + shoulder * rightZ,
    );

    const lookAt = tempLookAtRef.current;
    lookAt.set(
      positionRef.current.x + shoulder * rightX,
      positionRef.current.y + LOOK_AT_HEIGHT,
      positionRef.current.z + shoulder * rightZ,
    );
    camera.lookAt(lookAt);

    const speed = Math.hypot(velocityRef.current.x, velocityRef.current.y);
    movingRef.current = speed > 0.15;
    sprintingRef.current = sprinting && movingRef.current;

    snapshotAccumulatorRef.current += delta;
    if (snapshotAccumulatorRef.current >= 0.05) {
      snapshotAccumulatorRef.current = 0;
      snapshotCallbackRef.current({
        x: positionRef.current.x,
        y: positionRef.current.y,
        z: positionRef.current.z,
        speed,
        sprinting: sprintingRef.current,
        moving: movingRef.current,
        grounded: groundedRef.current,
        pointerLocked: pointerLockedRef.current,
        canInteract: false,
      });
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
    isADS: () => adsRef.current,
    isSprinting: () => sprintingRef.current,
    isMoving: () => movingRef.current,
    isGrounded: () => groundedRef.current,
    requestPointerLock: () => {
      userGestureCallbackRef.current();
      if (pointerLockedRef.current) return;
      const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
      try {
        const result = gl.domElement.requestPointerLock();
        if (result && typeof result.then === "function") {
          result.catch(() => {
            if (isTauri) {
              fallbackActiveRef.current = true;
              pointerLockedRef.current = true;
            }
          });
        }
      } catch {
        if (isTauri) {
          fallbackActiveRef.current = true;
          pointerLockedRef.current = true;
        }
      }
    },
  };
}

function resolveCollisions(positionXZ: THREE.Vector2, radius: number, collisionRects: CollisionRect[]) {
  for (const rect of collisionRects) {
    resolveCircleRect(positionXZ, radius, rect);
  }
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
