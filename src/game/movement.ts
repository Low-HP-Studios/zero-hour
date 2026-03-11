import * as THREE from "three";

export const SPRINT_FORWARD_THRESHOLD = 0.25;
export const SPRINT_LATERAL_RATIO = 0.8;
export const AIR_STEER_TURN_RATE = 2.2;

export function isSprintInputEligible(moveX: number, moveY: number): boolean {
  return moveY > SPRINT_FORWARD_THRESHOLD &&
    moveY >= Math.abs(moveX) * SPRINT_LATERAL_RATIO;
}

export function rotatePlanarVelocityTowards(
  velocity: THREE.Vector2,
  desiredYaw: number,
  maxTurnRadians: number,
): void {
  const speed = velocity.length();
  if (speed <= 0.0001) {
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
