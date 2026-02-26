import { useEffect, useEffectEvent, useRef } from "react";
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
  isSprinting: () => boolean;
  isMoving: () => boolean;
};

type KeyState = Record<string, boolean>;

const PLAYER_RADIUS = 0.35;
const EYE_HEIGHT = 1.65;
const WALK_SPEED = 5.3;
const SPRINT_SPEED = 8.2;
const ACCEL = 18;
const AIR_DAMP = 12;
const LOOK_SENSITIVITY = 0.0022;
const MAX_PITCH = Math.PI / 2.15;

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
  const positionRef = useRef(new THREE.Vector3(0, EYE_HEIGHT, 6));
  const velocityRef = useRef(new THREE.Vector2(0, 0));
  const moveInputRef = useRef(new THREE.Vector2(0, 0));
  const resolvedXZRef = useRef(new THREE.Vector2(positionRef.current.x, positionRef.current.z));
  const pointerLockedRef = useRef(false);
  const triggerHeldRef = useRef(false);
  const movingRef = useRef(false);
  const sprintingRef = useRef(false);
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const targetYawRef = useRef(0);
  const targetPitchRef = useRef(0);
  const pendingMouseRef = useRef(new THREE.Vector2(0, 0));
  const recoilPitchRef = useRef(0);
  const recoilYawRef = useRef(0);
  const snapshotAccumulatorRef = useRef(0);

  const handleAction = useEffectEvent((action: PlayerAction) => {
    onAction(action);
  });

  const handleTrigger = useEffectEvent((firing: boolean) => {
    onTriggerChange(firing);
  });

  const emitSnapshot = useEffectEvent((snapshot: PlayerSnapshot) => {
    onPlayerSnapshot(snapshot);
  });

  const handleUserGesture = useEffectEvent(() => {
    onUserGesture();
  });

  useEffect(() => {
    camera.rotation.order = "YXZ";
  }, [camera]);

  useEffect(() => {
    const element = gl.domElement;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "KeyE" && !event.repeat) {
        handleAction("pickup");
      }
      if (event.code === "KeyG" && !event.repeat) {
        handleAction("drop");
      }
      if (event.code === "KeyR" && !event.repeat) {
        handleAction("reset");
      }

      keyStateRef.current[event.code] = true;
    };

    const onKeyUp = (event: KeyboardEvent) => {
      keyStateRef.current[event.code] = false;
    };

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) {
        return;
      }

      handleUserGesture();

      if (!pointerLockedRef.current) {
        element.requestPointerLock();
        return;
      }

      if (!triggerHeldRef.current) {
        triggerHeldRef.current = true;
        handleTrigger(true);
      }
    };

    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 0) {
        return;
      }

      if (triggerHeldRef.current) {
        triggerHeldRef.current = false;
        handleTrigger(false);
      }
    };

    const onMouseMove = (event: MouseEvent) => {
      if (!pointerLockedRef.current) {
        return;
      }

      pendingMouseRef.current.x += event.movementX;
      pendingMouseRef.current.y += event.movementY;
    };

    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === element;
      pointerLockedRef.current = locked;
      if (!locked && triggerHeldRef.current) {
        triggerHeldRef.current = false;
        handleTrigger(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    element.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onMouseMove);
    document.addEventListener("pointerlockchange", onPointerLockChange);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      element.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
    };
  }, [gl.domElement, handleAction, handleTrigger, handleUserGesture]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 20);
    const keys = keyStateRef.current;

    const mouse = pendingMouseRef.current;
    if (pointerLockedRef.current && (mouse.x !== 0 || mouse.y !== 0)) {
      targetYawRef.current -= mouse.x * LOOK_SENSITIVITY;
      targetPitchRef.current = THREE.MathUtils.clamp(
        targetPitchRef.current - mouse.y * LOOK_SENSITIVITY,
        -MAX_PITCH,
        MAX_PITCH,
      );
      mouse.set(0, 0);
    }

    yawRef.current = THREE.MathUtils.damp(yawRef.current, targetYawRef.current, 18, delta);
    pitchRef.current = THREE.MathUtils.damp(pitchRef.current, targetPitchRef.current, 22, delta);

    const forward = (keys.KeyW ? 1 : 0) + (keys.KeyS ? -1 : 0);
    const strafe = (keys.KeyD ? 1 : 0) + (keys.KeyA ? -1 : 0);
    moveInputRef.current.set(strafe, forward);
    if (moveInputRef.current.lengthSq() > 1) {
      moveInputRef.current.normalize();
    }

    const sprinting = Boolean(keys.ShiftLeft || keys.ShiftRight) && moveInputRef.current.y >= 0;
    const moveSpeed = sprinting ? SPRINT_SPEED : WALK_SPEED;

    const sinYaw = Math.sin(yawRef.current);
    const cosYaw = Math.cos(yawRef.current);
    const localX = moveInputRef.current.x;
    const localZ = moveInputRef.current.y;
    const desiredX = localX * cosYaw + localZ * sinYaw;
    const desiredZ = localZ * -cosYaw + localX * sinYaw;

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

    positionRef.current.set(resolvedXZRef.current.x, EYE_HEIGHT, resolvedXZRef.current.y);

    recoilPitchRef.current = THREE.MathUtils.damp(recoilPitchRef.current, 0, 18, delta);
    recoilYawRef.current = THREE.MathUtils.damp(recoilYawRef.current, 0, 18, delta);

    camera.position.copy(positionRef.current);
    camera.rotation.set(
      pitchRef.current + recoilPitchRef.current,
      yawRef.current + recoilYawRef.current,
      0,
      "YXZ",
    );

    const speed = Math.hypot(velocityRef.current.x, velocityRef.current.y);
    movingRef.current = speed > 0.15;
    sprintingRef.current = sprinting && movingRef.current;

    snapshotAccumulatorRef.current += delta;
    if (snapshotAccumulatorRef.current >= 0.05) {
      snapshotAccumulatorRef.current = 0;
      emitSnapshot({
        x: positionRef.current.x,
        y: positionRef.current.y,
        z: positionRef.current.z,
        speed,
        sprinting: sprintingRef.current,
        moving: movingRef.current,
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
        -MAX_PITCH,
        MAX_PITCH,
      );
      targetYawRef.current += yawRadians * 0.6;
    },
    getPosition: () => positionRef.current,
    isSprinting: () => sprintingRef.current,
    isMoving: () => movingRef.current,
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
