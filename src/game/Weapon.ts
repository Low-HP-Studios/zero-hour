import * as THREE from "three";

export type WeaponShotEvent = {
  timestamp: number;
  shotIndex: number;
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  recoilPitchRadians: number;
  recoilYawRadians: number;
};

export type WeaponWorldState = {
  equipped: boolean;
  droppedPosition: [number, number, number] | null;
};

type TracerState = {
  from: THREE.Vector3;
  to: THREE.Vector3;
  until: number;
};

const FIRE_INTERVAL_MS = 78;
const PICKUP_RANGE = 1.8;
const TRACER_LIFETIME_MS = 55;
const MUZZLE_FLASH_MS = 45;

export class WeaponSystem {
  private equipped = false;
  private droppedPosition = new THREE.Vector3(1.5, 0.35, 3.5);
  private triggerHeld = false;
  private nextShotInMs = 0;
  private shotIndex = 0;
  private muzzleFlashUntil = 0;
  private tracer: TracerState | null = null;
  private readonly tempForward = new THREE.Vector3();

  setTriggerHeld(next: boolean) {
    this.triggerHeld = next;
    if (!next) {
      this.nextShotInMs = 0;
      this.shotIndex = 0;
    }
  }

  update(deltaSeconds: number, nowMs: number, camera: THREE.Camera): WeaponShotEvent[] {
    const shotEvents: WeaponShotEvent[] = [];
    if (!this.equipped || !this.triggerHeld) {
      return shotEvents;
    }

    this.nextShotInMs -= deltaSeconds * 1000;
    let burstGuard = 0;

    while (this.nextShotInMs <= 0 && burstGuard < 4) {
      burstGuard += 1;
      this.nextShotInMs += FIRE_INTERVAL_MS;

      const shotIndex = this.shotIndex;
      this.shotIndex += 1;

      const origin = new THREE.Vector3();
      camera.getWorldPosition(origin);

      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction).normalize();

      const recoilPitchDegrees = 0.18 + Math.min(1.1, shotIndex * 0.055);
      const horizontalDriftDegrees =
        (Math.random() - 0.5) * (0.12 + Math.min(0.65, shotIndex * 0.016));

      shotEvents.push({
        timestamp: nowMs,
        shotIndex,
        origin,
        direction,
        recoilPitchRadians: THREE.MathUtils.degToRad(recoilPitchDegrees),
        recoilYawRadians: THREE.MathUtils.degToRad(horizontalDriftDegrees),
      });

      this.muzzleFlashUntil = nowMs + MUZZLE_FLASH_MS;
    }

    return shotEvents;
  }

  tryPickup(playerPosition: THREE.Vector3): boolean {
    if (this.equipped) {
      return false;
    }

    if (playerPosition.distanceTo(this.droppedPosition) > PICKUP_RANGE) {
      return false;
    }

    this.equipped = true;
    return true;
  }

  drop(playerPosition: THREE.Vector3, cameraForward: THREE.Vector3): boolean {
    if (!this.equipped) {
      return false;
    }

    this.equipped = false;
    this.setTriggerHeld(false);

    this.tempForward.copy(cameraForward);
    this.tempForward.y = 0;
    if (this.tempForward.lengthSq() < 1e-5) {
      this.tempForward.set(0, 0, -1);
    } else {
      this.tempForward.normalize();
    }

    this.droppedPosition
      .copy(playerPosition)
      .addScaledVector(this.tempForward, 1.25)
      .setY(0.35);

    return true;
  }

  canPickup(playerPosition: THREE.Vector3): boolean {
    return !this.equipped && playerPosition.distanceTo(this.droppedPosition) <= PICKUP_RANGE;
  }

  isEquipped(): boolean {
    return this.equipped;
  }

  getDroppedPosition(): THREE.Vector3 {
    return this.droppedPosition;
  }

  getWorldState(): WeaponWorldState {
    return {
      equipped: this.equipped,
      droppedPosition: this.equipped
        ? null
        : [this.droppedPosition.x, this.droppedPosition.y, this.droppedPosition.z],
    };
  }

  setTracer(from: THREE.Vector3, to: THREE.Vector3, nowMs: number) {
    if (!this.tracer) {
      this.tracer = {
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        until: 0,
      };
    }

    this.tracer.from.copy(from);
    this.tracer.to.copy(to);
    this.tracer.until = nowMs + TRACER_LIFETIME_MS;
  }

  getActiveTracer(nowMs: number): TracerState | null {
    if (!this.tracer || this.tracer.until <= nowMs) {
      return null;
    }
    return this.tracer;
  }

  hasMuzzleFlash(nowMs: number): boolean {
    return this.equipped && this.muzzleFlashUntil > nowMs;
  }
}

export const DEFAULT_WEAPON_WORLD_STATE: WeaponWorldState = {
  equipped: false,
  droppedPosition: [1.5, 0.35, 3.5],
};
