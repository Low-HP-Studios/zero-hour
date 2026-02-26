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

const TRACER_LIFETIME_MS = 55;

type WeaponConfig = {
  fireIntervalMs: number;
  damage: number;
  muzzleFlashMs: number;
  rechamberMs?: number;
};

const WEAPON_CONFIG: Record<WeaponKind, WeaponConfig> = {
  rifle: {
    fireIntervalMs: 78,
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

export class WeaponSystem {
  private equipped = true;
  private activeWeapon: WeaponKind = "rifle";
  private droppedPosition = new THREE.Vector3(1.5, 0.35, 3.5);
  private triggerHeld = false;
  private nextShotInMs = 0;
  private shotIndex = 0;
  private muzzleFlashUntil = 0;
  private tracer: TracerState | null = null;
  private sniperRechamberStartedAtMs = 0;
  private sniperRechamberUntilMs = 0;

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

      const origin = new THREE.Vector3();
      camera.getWorldPosition(origin);

      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction).normalize();

      shotEvents.push({
        timestamp: nowMs,
        shotIndex,
        weaponType: this.activeWeapon,
        damage: config.damage,
        origin,
        direction,
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

  switchWeapon(next: WeaponKind): boolean {
    if (this.activeWeapon === next) {
      return false;
    }
    this.activeWeapon = next;
    this.setTriggerHeld(false);
    return true;
  }

  getActiveWeapon(): WeaponKind {
    return this.activeWeapon;
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
    void playerPosition;
    return false;
  }

  drop(playerPosition: THREE.Vector3, cameraForward: THREE.Vector3): boolean {
    void playerPosition;
    void cameraForward;
    return false;
  }

  canPickup(playerPosition: THREE.Vector3): boolean {
    void playerPosition;
    return false;
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
  equipped: true,
  droppedPosition: null,
};
