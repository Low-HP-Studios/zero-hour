import * as THREE from "three";

export type WeaponShotEvent = {
  timestamp: number;
  shotIndex: number;
  weaponType: WeaponKind;
  damage: number;
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  recoilPitchRadians: number;
  recoilYawRadians: number;
};

export type WeaponKind = "rifle" | "sniper";

export type WeaponWorldState = {
  equipped: boolean;
  droppedPosition: [number, number, number] | null;
};

type TracerState = {
  from: THREE.Vector3;
  to: THREE.Vector3;
  until: number;
};

const TRACER_LIFETIME_MS = 70;
const WEAPON_SWITCH_DURATION_MS = 180;

type WeaponConfig = {
  fireIntervalMs: number;
  damage: number;
  muzzleFlashMs: number;
  rechamberMs?: number;
};

const WEAPON_CONFIG: Record<WeaponKind, WeaponConfig> = {
  rifle: {
    fireIntervalMs: 112,
    damage: 25,
    muzzleFlashMs: 45,
  },
  sniper: {
    fireIntervalMs: 700,
    damage: 90,
    muzzleFlashMs: 70,
    rechamberMs: 980,
  },
};

export type SniperRechamberState = {
  active: boolean;
  progress: number;
  remainingMs: number;
};

export type WeaponSwitchState = {
  active: boolean;
  progress: number;
  from: WeaponKind;
  to: WeaponKind;
  remainingMs: number;
};

const PICKUP_RANGE = 2.5;
const DROP_FORWARD_DISTANCE = 1.8;
const DROP_HEIGHT = 0.35;
const DEFAULT_DROPPED_POSITION = new THREE.Vector3(1.5, DROP_HEIGHT, 3.5);

export class WeaponSystem {
  private equipped = false;
  private activeWeapon: WeaponKind = "rifle";
  private droppedPosition = DEFAULT_DROPPED_POSITION.clone();
  private triggerHeld = false;
  private nextShotInMs = 0;
  private shotIndex = 0;
  private muzzleFlashUntil = 0;
  private tracer: TracerState | null = null;
  private sniperRechamberStartedAtMs = 0;
  private sniperRechamberUntilMs = 0;
  private pendingWeapon: WeaponKind | null = null;
  private switchFromWeapon: WeaponKind = "rifle";
  private switchStartedAtMs = 0;
  private switchUntilMs = 0;
  private _tempOrigin = new THREE.Vector3();
  private _tempDirection = new THREE.Vector3();

  setTriggerHeld(next: boolean) {
    this.triggerHeld = next;
    if (!next) {
      this.nextShotInMs = 0;
      this.shotIndex = 0;
    }
  }

  update(deltaSeconds: number, nowMs: number, camera: THREE.Camera): WeaponShotEvent[] {
    const shotEvents: WeaponShotEvent[] = [];
    this.applyPendingSwitch(nowMs);
    if (!this.equipped || !this.triggerHeld || this.isSwitching(nowMs)) {
      return shotEvents;
    }

    const config = WEAPON_CONFIG[this.activeWeapon];
    this.nextShotInMs -= deltaSeconds * 1000;

    if (this.activeWeapon === "sniper" && this.sniperRechamberUntilMs > nowMs) {
      this.nextShotInMs = Math.max(this.nextShotInMs, this.sniperRechamberUntilMs - nowMs);
      return shotEvents;
    }

    let burstGuard = 0;

    while (this.nextShotInMs <= 0 && burstGuard < 4) {
      burstGuard += 1;
      this.nextShotInMs += config.fireIntervalMs;

      const shotIndex = this.shotIndex;
      this.shotIndex += 1;

      camera.getWorldPosition(this._tempOrigin);
      camera.getWorldDirection(this._tempDirection).normalize();

      shotEvents.push({
        timestamp: nowMs,
        shotIndex,
        weaponType: this.activeWeapon,
        damage: config.damage,
        origin: this._tempOrigin.clone(),
        direction: this._tempDirection.clone(),
        recoilPitchRadians: 0,
        recoilYawRadians: 0,
      });

      this.muzzleFlashUntil = nowMs + config.muzzleFlashMs;
      if (this.activeWeapon === "sniper" && config.rechamberMs) {
        this.sniperRechamberStartedAtMs = nowMs;
        this.sniperRechamberUntilMs = nowMs + config.rechamberMs;
      }
    }

    return shotEvents;
  }

  switchWeapon(next: WeaponKind, nowMs: number): boolean {
    if (this.pendingWeapon === next || (this.activeWeapon === next && !this.isSwitching(nowMs))) {
      return false;
    }
    this.applyPendingSwitch(nowMs);
    this.switchFromWeapon = this.activeWeapon;
    this.pendingWeapon = next;
    this.switchStartedAtMs = nowMs;
    this.switchUntilMs = nowMs + WEAPON_SWITCH_DURATION_MS;
    this.setTriggerHeld(false);
    this.sniperRechamberStartedAtMs = 0;
    this.sniperRechamberUntilMs = 0;
    this.muzzleFlashUntil = nowMs;
    this.clearTracer();
    return true;
  }

  getActiveWeapon(): WeaponKind {
    return this.activeWeapon;
  }

  getSwitchState(nowMs: number): WeaponSwitchState {
    this.applyPendingSwitch(nowMs);
    if (!this.pendingWeapon || this.switchUntilMs <= nowMs) {
      return {
        active: false,
        progress: 1,
        from: this.activeWeapon,
        to: this.activeWeapon,
        remainingMs: 0,
      };
    }

    const durationMs = Math.max(1, this.switchUntilMs - this.switchStartedAtMs);
    const elapsedMs = Math.max(0, nowMs - this.switchStartedAtMs);
    return {
      active: true,
      progress: Math.min(1, elapsedMs / durationMs),
      from: this.switchFromWeapon,
      to: this.pendingWeapon,
      remainingMs: Math.max(0, this.switchUntilMs - nowMs),
    };
  }

  getSniperRechamberState(nowMs: number): SniperRechamberState {
    if (this.sniperRechamberUntilMs <= nowMs) {
      return { active: false, progress: 1, remainingMs: 0 };
    }
    const durationMs = Math.max(1, this.sniperRechamberUntilMs - this.sniperRechamberStartedAtMs);
    const elapsedMs = Math.max(0, nowMs - this.sniperRechamberStartedAtMs);
    return {
      active: true,
      progress: Math.min(1, elapsedMs / durationMs),
      remainingMs: Math.max(0, this.sniperRechamberUntilMs - nowMs),
    };
  }

  tryPickup(playerPosition: THREE.Vector3): boolean {
    if (this.equipped) return false;
    const dx = playerPosition.x - this.droppedPosition.x;
    const dz = playerPosition.z - this.droppedPosition.z;
    if (dx * dx + dz * dz > PICKUP_RANGE * PICKUP_RANGE) return false;
    this.equipped = true;
    return true;
  }

  drop(playerPosition: THREE.Vector3, cameraForward: THREE.Vector3): boolean {
    if (!this.equipped) return false;
    this.equipped = false;
    this.droppedPosition.set(
      playerPosition.x + cameraForward.x * DROP_FORWARD_DISTANCE,
      DROP_HEIGHT,
      playerPosition.z + cameraForward.z * DROP_FORWARD_DISTANCE,
    );
    this.setTriggerHeld(false);
    this.muzzleFlashUntil = 0;
    this.clearTracer();
    return true;
  }

  canPickup(playerPosition: THREE.Vector3): boolean {
    if (this.equipped) return false;
    const dx = playerPosition.x - this.droppedPosition.x;
    const dz = playerPosition.z - this.droppedPosition.z;
    return dx * dx + dz * dz <= PICKUP_RANGE * PICKUP_RANGE;
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

  clearTracer() {
    this.tracer = null;
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

  reset() {
    this.equipped = false;
    this.activeWeapon = "rifle";
    this.droppedPosition.copy(DEFAULT_DROPPED_POSITION);
    this.triggerHeld = false;
    this.nextShotInMs = 0;
    this.shotIndex = 0;
    this.muzzleFlashUntil = 0;
    this.sniperRechamberStartedAtMs = 0;
    this.sniperRechamberUntilMs = 0;
    this.pendingWeapon = null;
    this.switchFromWeapon = "rifle";
    this.switchStartedAtMs = 0;
    this.switchUntilMs = 0;
    this.clearTracer();
  }

  private applyPendingSwitch(nowMs: number) {
    if (!this.pendingWeapon || nowMs < this.switchUntilMs) {
      return;
    }
    this.activeWeapon = this.pendingWeapon;
    this.pendingWeapon = null;
  }

  private isSwitching(nowMs: number) {
    return !!this.pendingWeapon && nowMs < this.switchUntilMs;
  }
}

export const DEFAULT_WEAPON_WORLD_STATE: WeaponWorldState = {
  equipped: false,
  droppedPosition: [1.5, DROP_HEIGHT, 3.5],
};
