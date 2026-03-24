import * as THREE from "three";

export const SPRINT_FORWARD_THRESHOLD = 0.25;
export const SPRINT_LATERAL_RATIO = 0.8;

export type Phase1MovementConfig = {
  groundAccelRate: number;
  groundDecelRate: number;
  directionReversalDecelRate: number;
  sprintAccelRate: number;
  sprintDecelRate: number;
  velocitySnapThreshold: number;
  jumpCarrySpeedFloorFactor: number;
  airSteerTurnRate: number;
  locomotionVisualInputDamp: number;
  locomotionScaleMin: number;
  locomotionScaleMax: number;
  visualVelocityAuthorityStartSpeed: number;
  visualVelocityAuthorityFullSpeed: number;
};

export type PlanarMovementIntent = {
  moveX: number;
  moveY: number;
  aimYaw: number;
  desiredSpeed: number;
};

export type GroundedMomentumResponse =
  | "accelerate"
  | "decelerate"
  | "reversal"
  | "sprintCoast"
  | "stop";

export type GroundedMomentumStepState = {
  movementEnabled: boolean;
  hasDirectionalInput: boolean;
  sprinting: boolean;
  allowSprintMomentum: boolean;
};

export type AirborneMomentumStepState = {
  hasDirectionalInput: boolean;
  desiredHeadingYaw: number;
  momentumSpeed: number;
};

export const PHASE1_MOVEMENT_CONFIG: Phase1MovementConfig = {
  groundAccelRate: 10,
  groundDecelRate: 16,
  directionReversalDecelRate: 20,
  sprintAccelRate: 7.5,
  sprintDecelRate: 11,
  velocitySnapThreshold: 0.08,
  jumpCarrySpeedFloorFactor: 0.55,
  airSteerTurnRate: 1.6,
  locomotionVisualInputDamp: 8,
  locomotionScaleMin: 0.55,
  locomotionScaleMax: 1.25,
  visualVelocityAuthorityStartSpeed: 0.12,
  visualVelocityAuthorityFullSpeed: 0.9,
};

export const AIR_STEER_TURN_RATE = PHASE1_MOVEMENT_CONFIG.airSteerTurnRate;

const PLANAR_EPSILON = 1e-4;

export function isSprintInputEligible(moveX: number, moveY: number): boolean {
  return moveY > SPRINT_FORWARD_THRESHOLD &&
    moveY >= Math.abs(moveX) * SPRINT_LATERAL_RATIO;
}

export function resolveDesiredPlanarVelocity(
  out: THREE.Vector2,
  intent: PlanarMovementIntent,
): THREE.Vector2 {
  const { moveX, moveY, aimYaw, desiredSpeed } = intent;
  if (
    desiredSpeed <= PLANAR_EPSILON ||
    (Math.abs(moveX) <= PLANAR_EPSILON && Math.abs(moveY) <= PLANAR_EPSILON)
  ) {
    out.set(0, 0);
    return out;
  }

  const sinYaw = Math.sin(aimYaw);
  const cosYaw = Math.cos(aimYaw);
  out.set(
    (moveX * cosYaw - moveY * sinYaw) * desiredSpeed,
    (-moveX * sinYaw - moveY * cosYaw) * desiredSpeed,
  );
  return out;
}

export function resolveLocalPlanarVector(
  out: THREE.Vector2,
  worldX: number,
  worldZ: number,
  aimYaw: number,
): THREE.Vector2 {
  const sinYaw = Math.sin(aimYaw);
  const cosYaw = Math.cos(aimYaw);
  out.set(
    worldX * cosYaw - worldZ * sinYaw,
    -(worldX * sinYaw + worldZ * cosYaw),
  );
  return out;
}

export function resolveGroundedMomentumResponse(
  currentVelocity: THREE.Vector2,
  desiredVelocity: THREE.Vector2,
  state: GroundedMomentumStepState,
  config: Phase1MovementConfig = PHASE1_MOVEMENT_CONFIG,
): GroundedMomentumResponse {
  if (!state.movementEnabled || !state.hasDirectionalInput) {
    return "stop";
  }

  const dot =
    currentVelocity.x * desiredVelocity.x + currentVelocity.y * desiredVelocity.y;
  if (dot < 0) {
    return "reversal";
  }

  const desiredSq = desiredVelocity.lengthSq();
  const currentSq = currentVelocity.lengthSq();
  const carryingSprint = state.allowSprintMomentum &&
    !state.sprinting &&
    desiredSq > PLANAR_EPSILON &&
    currentSq > desiredSq + config.velocitySnapThreshold ** 2;

  if (carryingSprint) {
    return "sprintCoast";
  }

  if (desiredSq < currentSq) {
    return "decelerate";
  }

  return "accelerate";
}

function resolveGroundedDampRate(
  response: GroundedMomentumResponse,
  state: GroundedMomentumStepState,
  config: Phase1MovementConfig,
) {
  switch (response) {
    case "reversal":
      return config.directionReversalDecelRate;
    case "sprintCoast":
      return config.sprintDecelRate;
    case "stop":
      return state.allowSprintMomentum || state.sprinting
        ? config.sprintDecelRate
        : config.groundDecelRate;
    case "accelerate":
      return state.sprinting ? config.sprintAccelRate : config.groundAccelRate;
    case "decelerate":
    default:
      return config.groundDecelRate;
  }
}

export function stepGroundedPlanarVelocity(
  velocity: THREE.Vector2,
  desiredVelocity: THREE.Vector2,
  delta: number,
  state: GroundedMomentumStepState,
  config: Phase1MovementConfig = PHASE1_MOVEMENT_CONFIG,
): GroundedMomentumResponse {
  const response = resolveGroundedMomentumResponse(
    velocity,
    desiredVelocity,
    state,
    config,
  );
  const dampRate = resolveGroundedDampRate(response, state, config);
  const targetX =
    response === "stop" || !state.movementEnabled || !state.hasDirectionalInput
      ? 0
      : desiredVelocity.x;
  const targetY =
    response === "stop" || !state.movementEnabled || !state.hasDirectionalInput
      ? 0
      : desiredVelocity.y;

  velocity.x = THREE.MathUtils.damp(velocity.x, targetX, dampRate, delta);
  velocity.y = THREE.MathUtils.damp(velocity.y, targetY, dampRate, delta);
  snapPlanarVelocity(velocity, config.velocitySnapThreshold);
  return response;
}

export function resolveSprintMomentumActive(
  velocity: THREE.Vector2,
  desiredVelocity: THREE.Vector2,
  state: GroundedMomentumStepState,
  response: GroundedMomentumResponse,
  config: Phase1MovementConfig = PHASE1_MOVEMENT_CONFIG,
): boolean {
  const speedSq = velocity.lengthSq();
  if (speedSq <= config.velocitySnapThreshold ** 2) {
    return false;
  }

  if (state.sprinting) {
    return true;
  }

  if (!state.allowSprintMomentum) {
    return false;
  }

  if (!state.movementEnabled || !state.hasDirectionalInput) {
    return true;
  }

  const desiredSq = desiredVelocity.lengthSq();
  if (desiredSq <= PLANAR_EPSILON) {
    return true;
  }

  if (response === "reversal") {
    return false;
  }

  const aligned =
    velocity.x * desiredVelocity.x + velocity.y * desiredVelocity.y >= 0;
  return aligned &&
    speedSq > desiredSq + config.velocitySnapThreshold ** 2;
}

export function resolveJumpTakeoffMomentum(
  currentPlanarSpeed: number,
  desiredGroundSpeed: number,
  hasDirectionalInput: boolean,
  config: Phase1MovementConfig = PHASE1_MOVEMENT_CONFIG,
): number {
  if (!hasDirectionalInput || desiredGroundSpeed <= PLANAR_EPSILON) {
    return currentPlanarSpeed;
  }

  return Math.max(
    currentPlanarSpeed,
    desiredGroundSpeed * config.jumpCarrySpeedFloorFactor,
  );
}

export function stepAirbornePlanarVelocity(
  velocity: THREE.Vector2,
  delta: number,
  state: AirborneMomentumStepState,
  config: Phase1MovementConfig = PHASE1_MOVEMENT_CONFIG,
): void {
  if (state.hasDirectionalInput) {
    if (velocity.lengthSq() <= PLANAR_EPSILON) {
      velocity.set(
        -Math.sin(state.desiredHeadingYaw),
        -Math.cos(state.desiredHeadingYaw),
      );
    } else {
      rotatePlanarVelocityTowards(
        velocity,
        state.desiredHeadingYaw,
        config.airSteerTurnRate * delta,
      );
    }
  }

  if (state.momentumSpeed <= config.velocitySnapThreshold) {
    velocity.set(0, 0);
    return;
  }

  if (velocity.lengthSq() <= PLANAR_EPSILON) {
    return;
  }

  velocity.setLength(state.momentumSpeed);
}

export function snapPlanarVelocity(
  velocity: THREE.Vector2,
  threshold: number = PHASE1_MOVEMENT_CONFIG.velocitySnapThreshold,
): void {
  if (velocity.lengthSq() <= threshold * threshold) {
    velocity.set(0, 0);
  }
}

export function rotatePlanarVelocityTowards(
  velocity: THREE.Vector2,
  desiredYaw: number,
  maxTurnRadians: number,
): void {
  const speed = velocity.length();
  if (speed <= PLANAR_EPSILON) {
    return;
  }
  const currentYaw = Math.atan2(-velocity.x, -velocity.y);
  const deltaYaw = Math.atan2(
    Math.sin(desiredYaw - currentYaw),
    Math.cos(desiredYaw - currentYaw),
  );
  const nextYaw = currentYaw + THREE.MathUtils.clamp(
    deltaYaw,
    -maxTurnRadians,
    maxTurnRadians,
  );
  velocity.set(-Math.sin(nextYaw) * speed, -Math.cos(nextYaw) * speed);
}
