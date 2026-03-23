import * as THREE from 'three';
import { type WeaponRecoilProfiles } from './types';

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

export type WeaponKind = 'rifle' | 'sniper';

export type WeaponSlotId = 'slotA' | 'slotB';

export type WeaponSlotState = {
  weaponKind: WeaponKind | null;
  hasWeapon: boolean;
  magAmmo: number;
  reserveAmmo: number;
  infiniteReserveAmmo: boolean;
  maxMagAmmo: number;
  maxReserveAmmo: number;
  maxPacks: number;
  packAmmo: number;
};

export type WeaponLoadoutState = {
  activeSlot: WeaponSlotId;
  weaponRaised: boolean;
  slotA: WeaponSlotState;
  slotB: WeaponSlotState;
};

export type WeaponReloadState = {
  active: boolean;
  weaponKind: WeaponKind | null;
  progress: number;
  remainingMs: number;
};

export type WeaponFireBlockReason =
  | "none"
  | "noWeapon"
  | "switching"
  | "reloading"
  | "empty"
  | "sniperRechamber";

export type WeaponFireState = {
  blocked: boolean;
  reason: WeaponFireBlockReason;
};

export type WeaponPickupState = {
  canPickup: boolean;
  weaponKind: WeaponKind | null;
};

export type WeaponWorldState = {
  rifle: {
    isPresentOnGround: boolean;
    droppedPosition: [number, number, number] | null;
  };
  sniper: {
    isPresentOnGround: boolean;
    droppedPosition: [number, number, number] | null;
  };
  activeSlot: WeaponSlotId;
  loadout: WeaponLoadoutState;
  reload: WeaponReloadState;
};

type TracerState = {
  from: THREE.Vector3;
  to: THREE.Vector3;
  until: number;
};

type WeaponProfile = {
  baseMagAmmo: number;
  ammoPerPack: number;
  maxPacks: number;
  fireIntervalMs: number;
  damage: number;
  muzzleFlashMs: number;
  rechamberMs?: number;
  reloadMs: number;
  recoilPitchBase: number;
  recoilPitchRamp: number;
  recoilYawRange: number;
  recoilYawDrift: number;
  moveSpreadBase: number;
  moveSpreadSprint: number;
};

const WEAPON_CONFIG: Record<WeaponKind, WeaponProfile> = {
  rifle: {
    baseMagAmmo: 30,
    ammoPerPack: 30,
    maxPacks: 8,
    fireIntervalMs: 130,
    damage: 15,
    muzzleFlashMs: 15,
    recoilPitchBase: 0.0007,
    recoilPitchRamp: 0.00015,
    recoilYawRange: 0.003,
    recoilYawDrift: 0.000005,
    moveSpreadBase: 0.1,
    moveSpreadSprint: 0.1,
    reloadMs: 3000,
  },
  sniper: {
    baseMagAmmo: 7,
    ammoPerPack: 30,
    maxPacks: 4,
    fireIntervalMs: 700,
    damage: 60,
    muzzleFlashMs: 70,
    rechamberMs: 1100,
    recoilPitchBase: 0.05,
    recoilPitchRamp: 0,
    recoilYawRange: 0.05,
    recoilYawDrift: 0.0005,
    moveSpreadBase: 0.05,
    moveSpreadSprint: 0.05,
    reloadMs: 3000,
  },
};

const WEAPON_RECOIL_PROFILE: WeaponRecoilProfiles = {
  rifle: {
    recoilPitchBase: 0.0007,
    recoilPitchRamp: 0.00015,
    recoilYawRange: 0.003,
    recoilYawDrift: 0.000005,
    moveSpreadBase: 0.1,
    moveSpreadSprint: 0.1,
  },
  sniper: {
    recoilPitchBase: 0.05,
    recoilPitchRamp: 0,
    recoilYawRange: 0.05,
    recoilYawDrift: 0.0005,
    moveSpreadBase: 0.05,
    moveSpreadSprint: 0.05,
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
  from: WeaponKind | null;
  to: WeaponKind | null;
  fromHolstered: boolean;
  toHolstered: boolean;
  remainingMs: number;
};

export type WeaponAttachmentRuntimeModifiers = {
  rifleMagBonus: number;
  sniperMagBonus: number;
  rifleRecoilScale: number;
  sniperRecoilScale: number;
};

const PICKUP_RANGE = 2.5;
const DROP_FORWARD_DISTANCE = 1.8;
const DROP_HEIGHT = 0.05;
const DEFAULT_DROPPED_POSITION = {
  rifle: new THREE.Vector3(1.4, DROP_HEIGHT, 3.5),
  sniper: new THREE.Vector3(1.9, DROP_HEIGHT, 3.5),
};
const WEAPON_DRAW_DURATION_MS = 260;
const WEAPON_HOLSTER_DURATION_MS = 260;
const WEAPON_SWAP_DURATION_MS =
  WEAPON_DRAW_DURATION_MS + WEAPON_HOLSTER_DURATION_MS;

function resolveDefaultSlot(weaponKind: WeaponKind): WeaponSlotState {
  return {
    weaponKind,
    hasWeapon: false,
    magAmmo: 0,
    reserveAmmo: 0,
    infiniteReserveAmmo: false,
    maxMagAmmo: WEAPON_CONFIG[weaponKind].baseMagAmmo,
    maxReserveAmmo:
      WEAPON_CONFIG[weaponKind].ammoPerPack *
      WEAPON_CONFIG[weaponKind].maxPacks,
    maxPacks: WEAPON_CONFIG[weaponKind].maxPacks,
    packAmmo: WEAPON_CONFIG[weaponKind].ammoPerPack,
  };
}

const DEFAULT_SLOT_A = resolveDefaultSlot('rifle');
const DEFAULT_SLOT_B = resolveDefaultSlot('sniper');

type WeaponDropState = {
  isPresentOnGround: boolean;
  position: THREE.Vector3;
};

function clampProfileValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export class WeaponSystem {
  private slotA: WeaponSlotState = { ...DEFAULT_SLOT_A };
  private slotB: WeaponSlotState = { ...DEFAULT_SLOT_B };
  private activeSlot: WeaponSlotId = 'slotA';
  private raisedSlot: WeaponSlotId | null = null;
  private droppedRifle: WeaponDropState = {
    isPresentOnGround: false,
    position: DEFAULT_DROPPED_POSITION.rifle.clone(),
  };
  private droppedSniper: WeaponDropState = {
    isPresentOnGround: false,
    position: DEFAULT_DROPPED_POSITION.sniper.clone(),
  };

  private triggerHeld = false;
  private nextShotInMs = 0;
  private shotIndex = 0;
  private muzzleFlashUntil = 0;
  private tracer: TracerState | null = null;

  private sniperRechamberStartedAtMs = 0;
  private sniperRechamberUntilMs = 0;
  private sniperRechamberRestartPending = false;

  private switchActive = false;
  private switchFromSlot: WeaponSlotId | null = null;
  private switchToSlot: WeaponSlotId | null = null;
  private switchFromKind: WeaponKind | null = null;
  private switchToKind: WeaponKind | null = null;
  private switchStartedAtMs = 0;
  private switchUntilMs = 0;

  private reloadSlot: WeaponSlotId | null = null;
  private reloadWeaponKind: WeaponKind | null = null;
  private reloadStartedAtMs = 0;
  private reloadUntilMs = 0;
  private reloadAmmoToLoad = 0;

  private moving = false;
  private sprinting = false;
  private rifleMagBonus = 0;
  private sniperMagBonus = 0;
  private rifleRecoilScale = 1;
  private sniperRecoilScale = 1;
  private recoilProfiles: WeaponRecoilProfiles = {
    rifle: { ...WEAPON_RECOIL_PROFILE.rifle },
    sniper: { ...WEAPON_RECOIL_PROFILE.sniper },
  };

  private tempOrigin = new THREE.Vector3();
  private tempDirection = new THREE.Vector3();
  private tempSpreadRight = new THREE.Vector3();
  private tempSpreadUp = new THREE.Vector3();
  private yawDriftDirection = 1;

  setTriggerHeld(next: boolean) {
    this.triggerHeld = next;
    if (!next) {
      this.nextShotInMs = 0;
      this.shotIndex = 0;
      this.yawDriftDirection = Math.random() > 0.5 ? 1 : -1;
    }
  }

  setMovementState(moving: boolean, sprinting: boolean) {
    this.moving = moving;
    this.sprinting = sprinting;
  }

  setRecoilProfiles(next: WeaponRecoilProfiles) {
    this.recoilProfiles = {
      rifle: {
        recoilPitchBase: clampProfileValue(next.rifle.recoilPitchBase, 0, 0.25),
        recoilPitchRamp: clampProfileValue(next.rifle.recoilPitchRamp, 0, 0.02),
        recoilYawRange: clampProfileValue(next.rifle.recoilYawRange, 0, 0.15),
        recoilYawDrift: clampProfileValue(next.rifle.recoilYawDrift, 0, 0.02),
        moveSpreadBase: clampProfileValue(next.rifle.moveSpreadBase, 0, 1),
        moveSpreadSprint: clampProfileValue(next.rifle.moveSpreadSprint, 0, 1),
      },
      sniper: {
        recoilPitchBase: clampProfileValue(next.sniper.recoilPitchBase, 0, 0.5),
        recoilPitchRamp: clampProfileValue(
          next.sniper.recoilPitchRamp,
          0,
          0.04,
        ),
        recoilYawRange: clampProfileValue(next.sniper.recoilYawRange, 0, 1),
        recoilYawDrift: clampProfileValue(next.sniper.recoilYawDrift, 0, 0.02),
        moveSpreadBase: clampProfileValue(next.sniper.moveSpreadBase, 0, 1),
        moveSpreadSprint: clampProfileValue(next.sniper.moveSpreadSprint, 0, 1),
      },
    };
  }

  setAttachmentRuntimeModifiers(next: WeaponAttachmentRuntimeModifiers) {
    this.rifleMagBonus = Math.round(
      clampProfileValue(next.rifleMagBonus, 0, 30),
    );
    this.sniperMagBonus = Math.round(
      clampProfileValue(next.sniperMagBonus, 0, 30),
    );
    this.rifleRecoilScale = clampProfileValue(next.rifleRecoilScale, 0.45, 1.25);
    this.sniperRecoilScale = clampProfileValue(
      next.sniperRecoilScale,
      0.45,
      1.25,
    );
    this.refreshSlotMagCapacity('slotA');
    this.refreshSlotMagCapacity('slotB');
  }

  getActiveSlotId(): WeaponSlotId {
    return this.activeSlot;
  }

  hasWeaponInSlot(slotId: WeaponSlotId) {
    return this.getSlotById(slotId).hasWeapon;
  }

  equipSlotWithWeapon(
    slotId: WeaponSlotId,
    kind: WeaponKind,
    options?: {
      magAmmo?: number;
      reserveAmmo?: number;
      infiniteReserveAmmo?: boolean;
    },
  ) {
    const hadOwnedWeapon = this.hasAnyWeapon();
    const hadRaisedWeapon = this.raisedSlot !== null;
    const config = WEAPON_CONFIG[kind];
    const slot = this.getSlotById(slotId);
    this.applySlotDefaultsForWeapon(slot, kind);
    slot.infiniteReserveAmmo = options?.infiniteReserveAmmo ?? false;
    slot.hasWeapon = true;
    slot.magAmmo = Math.min(
      slot.maxMagAmmo,
      Math.max(0, options?.magAmmo ?? slot.maxMagAmmo),
    );
    slot.reserveAmmo = slot.infiniteReserveAmmo
      ? slot.maxReserveAmmo
      : Math.min(
        slot.maxReserveAmmo,
        Math.max(
          0,
          options?.reserveAmmo ?? config.ammoPerPack * config.maxPacks,
        ),
      );
    this.setSlotById(slotId, slot);

    if (!this.getSlotById(this.activeSlot).hasWeapon) {
      this.activeSlot = slotId;
    }
    if (!hadOwnedWeapon && !hadRaisedWeapon) {
      this.activeSlot = slotId;
      this.raisedSlot = slotId;
    }
    this.activeWeaponChanged();
  }

  clearWeaponFromSlot(slotId: WeaponSlotId) {
    const slot = this.getSlotById(slotId);
    if (!slot.hasWeapon || !slot.weaponKind) {
      return null;
    }
    const previous = { ...slot };
    const otherSlotId = this.getOtherSlotId(slotId);
    const otherSlotHasWeapon = this.getSlotById(otherSlotId).hasWeapon;
    if (this.raisedSlot === slotId) {
      this.raisedSlot = otherSlotHasWeapon ? otherSlotId : null;
    }
    this.clearSlot(slotId);
    if (this.activeSlot === slotId) {
      if (otherSlotHasWeapon) {
        this.activeSlot = otherSlotId;
      }
    }
    this.activeWeaponChanged();
    return previous;
  }

  private getSlotById(slotId: WeaponSlotId): WeaponSlotState {
    return slotId === 'slotA' ? this.slotA : this.slotB;
  }

  private setSlotById(slotId: WeaponSlotId, next: WeaponSlotState) {
    if (slotId === 'slotA') {
      this.slotA = { ...next };
    } else {
      this.slotB = { ...next };
    }
  }

  private getOtherSlotId(slotId: WeaponSlotId): WeaponSlotId {
    return slotId === 'slotA' ? 'slotB' : 'slotA';
  }

  private getDropState(kind: WeaponKind): WeaponDropState {
    return kind === 'rifle' ? this.droppedRifle : this.droppedSniper;
  }

  private hasAnyWeapon() {
    return this.slotA.hasWeapon || this.slotB.hasWeapon;
  }

  private resolveActiveSlot(): WeaponSlotState {
    return this.getSlotById(this.activeSlot);
  }

  private resolveActiveWeaponKind(): WeaponKind | null {
    const active = this.resolveActiveSlot();
    return active.hasWeapon ? active.weaponKind : null;
  }

  private resolveRaisedSlotState(): WeaponSlotState | null {
    if (!this.raisedSlot) {
      return null;
    }
    const slot = this.getSlotById(this.raisedSlot);
    return slot.hasWeapon ? slot : null;
  }

  private resolveRaisedWeaponKind(): WeaponKind | null {
    const raised = this.resolveRaisedSlotState();
    return raised?.weaponKind ?? null;
  }

  private clearSniperRechamber() {
    this.sniperRechamberStartedAtMs = 0;
    this.sniperRechamberUntilMs = 0;
  }

  private startSniperRechamber(nowMs: number) {
    const rechamberMs = WEAPON_CONFIG.sniper.rechamberMs ?? 0;
    if (rechamberMs <= 0) {
      return;
    }
    this.sniperRechamberRestartPending = false;
    this.sniperRechamberStartedAtMs = nowMs;
    this.sniperRechamberUntilMs = nowMs + rechamberMs;
  }

  private getMagBonus(kind: WeaponKind) {
    return kind === 'rifle' ? this.rifleMagBonus : this.sniperMagBonus;
  }

  private getRecoilScale(kind: WeaponKind) {
    return kind === 'rifle' ? this.rifleRecoilScale : this.sniperRecoilScale;
  }

  private resolveMaxMagAmmo(kind: WeaponKind) {
    return Math.max(1, WEAPON_CONFIG[kind].baseMagAmmo + this.getMagBonus(kind));
  }

  private refreshSlotMagCapacity(slotId: WeaponSlotId) {
    const slot = this.getSlotById(slotId);
    if (!slot.hasWeapon || !slot.weaponKind) {
      return;
    }
    slot.maxMagAmmo = this.resolveMaxMagAmmo(slot.weaponKind);
    slot.magAmmo = Math.min(slot.magAmmo, slot.maxMagAmmo);
    this.setSlotById(slotId, slot);
  }

  private nearestDrop(playerPosition: THREE.Vector3): WeaponKind | null {
    const rifle = this.droppedRifle;
    const sniper = this.droppedSniper;
    const limitSq = PICKUP_RANGE * PICKUP_RANGE;

    const rifleDx = playerPosition.x - rifle.position.x;
    const rifleDz = playerPosition.z - rifle.position.z;
    const rifleDistSq = rifleDx * rifleDx + rifleDz * rifleDz;
    const sniperDx = playerPosition.x - sniper.position.x;
    const sniperDz = playerPosition.z - sniper.position.z;
    const sniperDistSq = sniperDx * sniperDx + sniperDz * sniperDz;

    const canRifle = rifle.isPresentOnGround && rifleDistSq <= limitSq;
    const canSniper = sniper.isPresentOnGround && sniperDistSq <= limitSq;

    if (canRifle && canSniper) {
      return rifleDistSq <= sniperDistSq ? 'rifle' : 'sniper';
    }
    if (canRifle) {
      return 'rifle';
    }
    if (canSniper) {
      return 'sniper';
    }
    return null;
  }

  private applySlotDefaultsForWeapon(slot: WeaponSlotState, kind: WeaponKind) {
    const config = WEAPON_CONFIG[kind];
    slot.weaponKind = kind;
    slot.maxMagAmmo = this.resolveMaxMagAmmo(kind);
    slot.maxReserveAmmo = config.ammoPerPack * config.maxPacks;
    slot.maxPacks = config.maxPacks;
    slot.packAmmo = config.ammoPerPack;
  }

  private equipToSlot(slotId: WeaponSlotId, kind: WeaponKind) {
    const slot = this.getSlotById(slotId);
    this.applySlotDefaultsForWeapon(slot, kind);
    slot.hasWeapon = true;
    slot.magAmmo = 0;
    slot.reserveAmmo = 0;
    slot.infiniteReserveAmmo = false;
    this.setSlotById(slotId, slot);
  }

  private clearSlot(slotId: WeaponSlotId) {
    const slot = this.getSlotById(slotId);
    this.setSlotById(slotId, {
      ...slot,
      weaponKind: null,
      hasWeapon: false,
      magAmmo: 0,
      reserveAmmo: 0,
      infiniteReserveAmmo: false,
      maxReserveAmmo: 0,
      maxPacks: 0,
      packAmmo: WEAPON_CONFIG.rifle.ammoPerPack,
    });
  }

  private isSwitching(nowMs: number) {
    return this.switchActive &&
      nowMs >= this.switchStartedAtMs &&
      nowMs < this.switchUntilMs;
  }

  private clearSwitchState() {
    this.switchActive = false;
    this.switchFromSlot = null;
    this.switchToSlot = null;
    this.switchFromKind = null;
    this.switchToKind = null;
    this.switchStartedAtMs = 0;
    this.switchUntilMs = 0;
  }

  private beginSwitchToSlot(slotId: WeaponSlotId | null, nowMs: number) {
    this.applyPendingSwitch(nowMs);
    if (this.isSwitching(nowMs)) {
      return false;
    }

    const currentRaisedSlot = this.resolveRaisedSlotState()
      ? this.raisedSlot
      : null;
    const currentRaisedKind = currentRaisedSlot
      ? this.getSlotById(currentRaisedSlot).weaponKind
      : null;

    if (slotId) {
      const targetSlot = this.getSlotById(slotId);
      if (!targetSlot.hasWeapon || !targetSlot.weaponKind) {
        return false;
      }
      this.activeSlot = slotId;
    }

    if (currentRaisedSlot === slotId) {
      return false;
    }

    if (
      currentRaisedKind === "sniper" &&
      currentRaisedSlot !== slotId &&
      this.sniperRechamberUntilMs > nowMs
    ) {
      this.clearSniperRechamber();
      this.sniperRechamberRestartPending = true;
    }

    const switchDurationMs = currentRaisedSlot && slotId
      ? WEAPON_SWAP_DURATION_MS
      : currentRaisedSlot
      ? WEAPON_HOLSTER_DURATION_MS
      : slotId
      ? WEAPON_DRAW_DURATION_MS
      : 0;
    if (switchDurationMs <= 0) {
      return false;
    }

    this.switchActive = true;
    this.switchFromSlot = currentRaisedSlot;
    this.switchToSlot = slotId;
    this.switchFromKind = currentRaisedSlot
      ? this.getSlotById(currentRaisedSlot).weaponKind
      : null;
    this.switchToKind = slotId
      ? this.getSlotById(slotId).weaponKind
      : null;
    this.switchStartedAtMs = nowMs;
    this.switchUntilMs = nowMs + switchDurationMs;
    this.setTriggerHeld(false);
    this.clearTracer();
    return true;
  }

  private applyPendingSwitch(nowMs: number) {
    if (!this.switchActive || nowMs < this.switchUntilMs) {
      return;
    }
    this.raisedSlot = this.switchToSlot &&
        this.getSlotById(this.switchToSlot).hasWeapon
      ? this.switchToSlot
      : null;
    if (
      this.resolveRaisedWeaponKind() === "sniper" &&
      this.sniperRechamberRestartPending
    ) {
      this.startSniperRechamber(nowMs);
    }
    this.clearSwitchState();
    this.clearTracer();
    this.setTriggerHeld(false);
  }

  private getSlotIdForKind(kind: WeaponKind): WeaponSlotId {
    if (kind === 'rifle') {
      return 'slotA';
    }
    return 'slotB';
  }

  private applyPendingReloadCompletion(nowMs: number) {
    if (
      !this.reloadWeaponKind ||
      !this.reloadSlot ||
      nowMs < this.reloadUntilMs
    ) {
      return;
    }

    const slot = this.getSlotById(this.reloadSlot);
    const activeKind = slot.weaponKind;
    if (slot.hasWeapon && activeKind === this.reloadWeaponKind) {
      const needed = Math.max(0, slot.maxMagAmmo - slot.magAmmo);
      const availableReserve = slot.infiniteReserveAmmo
        ? this.reloadAmmoToLoad
        : slot.reserveAmmo;
      const load = Math.min(needed, this.reloadAmmoToLoad, availableReserve);
      if (load > 0) {
        slot.magAmmo = Math.min(slot.maxMagAmmo, slot.magAmmo + load);
        slot.reserveAmmo = slot.infiniteReserveAmmo
          ? slot.maxReserveAmmo
          : Math.max(0, slot.reserveAmmo - load);
        this.setSlotById(this.reloadSlot, slot);
      }
    }

    this.reloadWeaponKind = null;
    this.reloadSlot = null;
    this.reloadStartedAtMs = 0;
    this.reloadUntilMs = 0;
    this.reloadAmmoToLoad = 0;
  }

  update(
    deltaSeconds: number,
    nowMs: number,
    camera: THREE.Camera,
  ): WeaponShotEvent[] {
    const shotEvents: WeaponShotEvent[] = [];

    this.applyPendingSwitch(nowMs);
    this.applyPendingReloadCompletion(nowMs);

    const raisedSlotId = this.raisedSlot;
    const activeSlot = this.resolveRaisedSlotState();
    const activeKind = this.resolveRaisedWeaponKind();
    const reloading = this.isReloading(nowMs);

    // Auto-reload when magazine is empty, regardless of trigger state
    if (
      !reloading &&
      !this.isSwitching(nowMs) &&
      activeSlot &&
      activeKind &&
      activeSlot.magAmmo <= 0 &&
      (activeSlot.infiniteReserveAmmo || activeSlot.reserveAmmo > 0)
    ) {
      this.beginReload(nowMs);
      return shotEvents;
    }

    if (
      this.isSwitching(nowMs) ||
      !activeSlot ||
      !activeKind ||
      !this.triggerHeld ||
      reloading
    ) {
      return shotEvents;
    }

    if (activeSlot.magAmmo <= 0) {
      return shotEvents;
    }

    const config = WEAPON_CONFIG[activeKind];
    const recoilProfile = this.recoilProfiles[activeKind];
    const recoilScale = this.getRecoilScale(activeKind);

    if (this.sniperRechamberUntilMs > nowMs) {
      this.nextShotInMs = Math.max(
        this.nextShotInMs,
        this.sniperRechamberUntilMs - nowMs,
      );
      return shotEvents;
    }

    this.nextShotInMs -= deltaSeconds * 1000;

    let burstGuard = 0;
    while (this.nextShotInMs <= 0 && burstGuard < 4) {
      burstGuard += 1;
      this.nextShotInMs += config.fireIntervalMs;

      camera.getWorldPosition(this.tempOrigin);
      camera.getWorldDirection(this.tempDirection).normalize();

      let spreadAngle = 0;
      if (this.sprinting) {
        spreadAngle = recoilProfile.moveSpreadSprint * recoilScale;
      } else if (this.moving) {
        spreadAngle = recoilProfile.moveSpreadBase * recoilScale;
      }

      if (spreadAngle > 0) {
        this.tempSpreadUp.set(0, 1, 0);
        this.tempSpreadRight
          .crossVectors(this.tempDirection, this.tempSpreadUp)
          .normalize();
        this.tempSpreadUp
          .crossVectors(this.tempSpreadRight, this.tempDirection)
          .normalize();

        const angle = Math.random() * Math.PI * 2;
        const radius = spreadAngle * Math.sqrt(Math.random());
        this.tempDirection
          .addScaledVector(this.tempSpreadRight, Math.cos(angle) * radius)
          .addScaledVector(this.tempSpreadUp, Math.sin(angle) * radius)
          .normalize();
      }

      const shotIndex = this.shotIndex;
      this.shotIndex += 1;
      activeSlot.magAmmo = Math.max(0, activeSlot.magAmmo - 1);

      const recoilPitch =
        (recoilProfile.recoilPitchBase +
          recoilProfile.recoilPitchRamp * shotIndex) * recoilScale;
      let recoilYaw = (Math.random() - 0.5) *
        2 *
        (recoilProfile.recoilYawRange * recoilScale);
      recoilYaw += this.yawDriftDirection *
        (recoilProfile.recoilYawDrift * recoilScale);
      if (
        shotIndex > 0 &&
        shotIndex % (5 + Math.floor(Math.random() * 4)) === 0
      ) {
        this.yawDriftDirection *= -1;
      }

      shotEvents.push({
        timestamp: nowMs,
        shotIndex,
        weaponType: activeKind,
        damage: config.damage,
        origin: this.tempOrigin.clone(),
        direction: this.tempDirection.clone(),
        recoilPitchRadians: recoilPitch,
        recoilYawRadians: recoilYaw,
      });

      this.muzzleFlashUntil = nowMs + config.muzzleFlashMs;
      if (activeKind === 'sniper' && config.rechamberMs !== undefined) {
        this.startSniperRechamber(nowMs);
      }

      if (raisedSlotId) {
        this.setSlotById(raisedSlotId, { ...activeSlot });
      }
      this.applyPendingReloadCompletion(nowMs + 1);
      if (activeSlot.magAmmo <= 0 && this.reloadSlot === null) {
        this.beginReload(nowMs);
        break;
      }
    }

    return shotEvents;
  }

  getActiveWeaponPayload(): WeaponKind | null {
    this.applyPendingSwitch(performance.now());
    const active = this.resolveActiveWeaponKind();
    if (active) {
      return active;
    }
    if (this.slotA.hasWeapon && this.slotA.weaponKind) {
      return this.slotA.weaponKind;
    }
    if (this.slotB.hasWeapon && this.slotB.weaponKind) {
      return this.slotB.weaponKind;
    }
    return null;
  }

  getActiveWeapon(): WeaponKind {
    return this.getActiveWeaponPayload() ?? 'rifle';
  }

  getRaisedWeapon(): WeaponKind | null {
    this.applyPendingSwitch(performance.now());
    return this.resolveRaisedWeaponKind();
  }

  getSlotStateForLoadout(slotId: WeaponSlotId): WeaponSlotState {
    return { ...this.getSlotById(slotId) };
  }

  getLoadoutState(): WeaponLoadoutState {
    this.applyPendingSwitch(performance.now());
    return {
      activeSlot: this.activeSlot,
      weaponRaised: this.isEquipped(),
      slotA: { ...this.slotA },
      slotB: { ...this.slotB },
    };
  }

  getPickupState(playerPosition: THREE.Vector3): WeaponPickupState {
    const nearest = this.nearestDrop(playerPosition);
    return {
      canPickup: nearest !== null,
      weaponKind: nearest,
    };
  }

  getWorldState(): WeaponWorldState {
    return {
      rifle: {
        isPresentOnGround: this.droppedRifle.isPresentOnGround,
        droppedPosition: this.droppedRifle.isPresentOnGround
          ? [
              this.droppedRifle.position.x,
              this.droppedRifle.position.y,
              this.droppedRifle.position.z,
            ]
          : null,
      },
      sniper: {
        isPresentOnGround: this.droppedSniper.isPresentOnGround,
        droppedPosition: this.droppedSniper.isPresentOnGround
          ? [
              this.droppedSniper.position.x,
              this.droppedSniper.position.y,
              this.droppedSniper.position.z,
            ]
          : null,
      },
      activeSlot: this.activeSlot,
      loadout: this.getLoadoutState(),
      reload: this.getReloadState(performance.now()),
    };
  }

  canPickup(playerPosition: THREE.Vector3) {
    return this.getPickupState(playerPosition).canPickup;
  }

  pickSlotNearest(_playerPosition: THREE.Vector3): boolean {
    const nearest = this.nearestDrop(_playerPosition);
    if (!nearest) {
      return false;
    }

    const targetSlotId = this.getSlotIdForKind(nearest);
    const targetSlot = this.getSlotById(targetSlotId);
    if (targetSlot.hasWeapon) {
      return false;
    }

    this.equipToSlot(targetSlotId, nearest);
    this.getDropState(nearest).isPresentOnGround = false;
    if (!this.resolveRaisedSlotState()) {
      this.activeSlot = targetSlotId;
      this.raisedSlot = targetSlotId;
    }
    this.activeWeaponChanged();
    return true;
  }

  private activeWeaponChanged() {
    this.setTriggerHeld(false);
    this.nextShotInMs = 0;
    this.shotIndex = 0;
    this.clearSniperRechamber();
    if (!this.slotB.hasWeapon || this.slotB.weaponKind !== "sniper") {
      this.sniperRechamberRestartPending = false;
    }
    if (this.raisedSlot && !this.getSlotById(this.raisedSlot).hasWeapon) {
      this.raisedSlot = null;
    }
    this.clearSwitchState();
    this.clearTracer();
  }

  switchWeapon(next: WeaponKind, nowMs: number): boolean {
    const targetSlot = this.getSlotIdForKind(next);
    const slotState = this.getSlotById(targetSlot);
    if (!slotState.hasWeapon || slotState.weaponKind !== next) {
      return false;
    }
    this.activeSlot = targetSlot;
    return this.beginSwitchToSlot(targetSlot, nowMs);
  }

  setActiveSlot(slotId: WeaponSlotId): boolean {
    const nowMs = performance.now();
    const targetSlot = this.getSlotById(slotId);
    if (!targetSlot.hasWeapon || !targetSlot.weaponKind) {
      return false;
    }

    this.activeSlot = slotId;
    return this.beginSwitchToSlot(slotId, nowMs);
  }

  unarm(nowMs: number): boolean {
    return this.beginSwitchToSlot(null, nowMs);
  }

  drop(playerPosition: THREE.Vector3, cameraForward: THREE.Vector3): boolean {
    const slotId = this.raisedSlot ?? this.activeSlot;
    const slot = this.getSlotById(slotId);
    if (!slot.hasWeapon || !slot.weaponKind) {
      return false;
    }

    const kind = slot.weaponKind;
    const drop = this.getDropState(kind);
    drop.isPresentOnGround = true;
    drop.position.set(
      playerPosition.x + cameraForward.x * DROP_FORWARD_DISTANCE,
      DROP_HEIGHT,
      playerPosition.z + cameraForward.z * DROP_FORWARD_DISTANCE,
    );

    this.clearSlot(slotId);

    const otherSlotId = this.getOtherSlotId(slotId);
    if (this.getSlotById(otherSlotId).hasWeapon) {
      this.activeSlot = otherSlotId;
      this.raisedSlot = otherSlotId;
    } else {
      this.raisedSlot = null;
    }

    this.activeWeaponChanged();
    return true;
  }

  setReserveAmmoForKind(kind: WeaponKind, reserveAmmo: number) {
    const slotId = this.getSlotIdForKind(kind);
    const slot = this.getSlotById(slotId);
    if (!slot.hasWeapon || slot.weaponKind !== kind) {
      return false;
    }

    const next = Math.max(0, Math.min(slot.maxReserveAmmo, Math.floor(reserveAmmo)));
    if (slot.reserveAmmo === next) {
      return false;
    }

    slot.reserveAmmo = next;
    if (this.reloadSlot === slotId && this.reloadWeaponKind === kind) {
      this.reloadAmmoToLoad = slot.infiniteReserveAmmo
        ? this.reloadAmmoToLoad
        : Math.min(this.reloadAmmoToLoad, slot.reserveAmmo);
    }
    this.setSlotById(slotId, slot);
    return true;
  }

  setInfiniteReserveAmmoForKind(kind: WeaponKind, infinite: boolean) {
    const slotId = this.getSlotIdForKind(kind);
    const slot = this.getSlotById(slotId);
    if (!slot.hasWeapon || slot.weaponKind !== kind) {
      return false;
    }

    if (slot.infiniteReserveAmmo === infinite) {
      if (infinite && slot.reserveAmmo !== slot.maxReserveAmmo) {
        slot.reserveAmmo = slot.maxReserveAmmo;
        this.setSlotById(slotId, slot);
        return true;
      }
      return false;
    }

    slot.infiniteReserveAmmo = infinite;
    if (infinite) {
      slot.reserveAmmo = slot.maxReserveAmmo;
    } else if (this.reloadSlot === slotId && this.reloadWeaponKind === kind) {
      this.reloadAmmoToLoad = Math.min(this.reloadAmmoToLoad, slot.reserveAmmo);
    }
    this.setSlotById(slotId, slot);
    return true;
  }

  beginReload(nowMs: number): boolean {
    this.applyPendingReloadCompletion(nowMs);
    this.applyPendingSwitch(nowMs);

    const slotId = this.raisedSlot;
    if (this.isReloading(nowMs)) {
      return false;
    }
    if (!slotId) {
      return false;
    }
    const slot = this.getSlotById(slotId);
    if (!slot.hasWeapon || !slot.weaponKind) {
      return false;
    }

    const need = Math.max(0, slot.maxMagAmmo - slot.magAmmo);
    if (need <= 0 || (!slot.infiniteReserveAmmo && slot.reserveAmmo <= 0)) {
      return false;
    }

    const profile = WEAPON_CONFIG[slot.weaponKind];
    this.reloadSlot = slotId;
    this.reloadWeaponKind = slot.weaponKind;
    this.reloadAmmoToLoad = slot.infiniteReserveAmmo
      ? need
      : Math.min(need, slot.reserveAmmo);
    this.reloadStartedAtMs = nowMs;
    this.reloadUntilMs = nowMs + profile.reloadMs;
    return true;
  }

  getReloadState(nowMs: number): WeaponReloadState {
    if (this.reloadUntilMs <= nowMs || this.reloadWeaponKind === null) {
      return {
        active: false,
        weaponKind: null,
        progress: 1,
        remainingMs: 0,
      };
    }

    const duration = Math.max(1, this.reloadUntilMs - this.reloadStartedAtMs);
    const elapsed = Math.max(0, nowMs - this.reloadStartedAtMs);
    return {
      active: true,
      weaponKind: this.reloadWeaponKind,
      progress: Math.min(1, elapsed / duration),
      remainingMs: Math.max(0, this.reloadUntilMs - nowMs),
    };
  }

  isReloading(nowMs: number) {
    return this.reloadUntilMs > nowMs;
  }

  getFireState(nowMs: number): WeaponFireState {
    const active = this.resolveRaisedSlotState();
    const activeKind = this.resolveRaisedWeaponKind();
    if (!active || !activeKind) {
      return { blocked: true, reason: "noWeapon" };
    }

    if (this.isSwitching(nowMs)) {
      return { blocked: true, reason: "switching" };
    }

    if (this.isReloading(nowMs)) {
      return { blocked: true, reason: "reloading" };
    }

    if (activeKind === "sniper" && this.sniperRechamberUntilMs > nowMs) {
      return { blocked: true, reason: "sniperRechamber" };
    }

    if (active.magAmmo <= 0) {
      return { blocked: true, reason: "empty" };
    }

    return { blocked: false, reason: "none" };
  }

  getSniperRechamberState(nowMs: number): SniperRechamberState {
    if (this.sniperRechamberUntilMs <= nowMs) {
      return {
        active: false,
        progress: 1,
        remainingMs: 0,
      };
    }

    const duration = Math.max(
      1,
      this.sniperRechamberUntilMs - this.sniperRechamberStartedAtMs,
    );
    const elapsed = Math.max(0, nowMs - this.sniperRechamberStartedAtMs);
    return {
      active: true,
      progress: Math.min(1, elapsed / duration),
      remainingMs: Math.max(0, this.sniperRechamberUntilMs - nowMs),
    };
  }

  getSwitchState(nowMs: number): WeaponSwitchState {
    this.applyPendingSwitch(nowMs);
    if (!this.switchActive) {
      const active = this.resolveRaisedWeaponKind();
      return {
        active: false,
        progress: 1,
        from: active,
        to: active,
        fromHolstered: active === null,
        toHolstered: active === null,
        remainingMs: 0,
      };
    }

    const duration = Math.max(1, this.switchUntilMs - this.switchStartedAtMs);
    const elapsed = Math.max(0, nowMs - this.switchStartedAtMs);
    return {
      active: true,
      progress: Math.min(1, elapsed / duration),
      from: this.switchFromKind,
      to: this.switchToKind,
      fromHolstered: this.switchFromSlot === null,
      toHolstered: this.switchToSlot === null,
      remainingMs: Math.max(0, this.switchUntilMs - nowMs),
    };
  }

  setSwitchTarget(nextSlotKind: WeaponKind, nowMs: number): boolean {
    return this.switchWeapon(nextSlotKind, nowMs);
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
    this.tracer.until = nowMs + 70;
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
    return this.isEquipped() && this.muzzleFlashUntil > nowMs;
  }

  isEquipped(): boolean {
    this.applyPendingSwitch(performance.now());
    return !this.switchActive && this.resolveRaisedSlotState() !== null;
  }

  getDropPosition(kind: WeaponKind): THREE.Vector3 | null {
    const drop = this.getDropState(kind);
    return drop.isPresentOnGround ? drop.position : null;
  }

  getSlotFromKey(code: string): WeaponSlotId | null {
    if (code === 'slotA') {
      return 'slotA';
    }
    if (code === 'slotB') {
      return 'slotB';
    }
    return null;
  }

  reset() {
    this.slotA = { ...DEFAULT_SLOT_A };
    this.slotB = { ...DEFAULT_SLOT_B };
    this.activeSlot = 'slotA';
    this.raisedSlot = null;

    this.droppedRifle.isPresentOnGround = false;
    this.droppedRifle.position.copy(DEFAULT_DROPPED_POSITION.rifle);
    this.droppedSniper.isPresentOnGround = false;
    this.droppedSniper.position.copy(DEFAULT_DROPPED_POSITION.sniper);

    this.triggerHeld = false;
    this.nextShotInMs = 0;
    this.shotIndex = 0;
    this.muzzleFlashUntil = 0;
    this.clearSniperRechamber();
    this.sniperRechamberRestartPending = false;

    this.clearSwitchState();

    this.reloadWeaponKind = null;
    this.reloadSlot = null;
    this.reloadStartedAtMs = 0;
    this.reloadUntilMs = 0;
    this.reloadAmmoToLoad = 0;

    this.rifleMagBonus = 0;
    this.sniperMagBonus = 0;
    this.rifleRecoilScale = 1;
    this.sniperRecoilScale = 1;
    this.moving = false;
    this.sprinting = false;
    this.clearTracer();
  }
}

export const DEFAULT_WEAPON_WORLD_STATE: WeaponWorldState = {
  rifle: {
    isPresentOnGround: false,
    droppedPosition: null,
  },
  sniper: {
    isPresentOnGround: false,
    droppedPosition: null,
  },
  activeSlot: 'slotA',
  loadout: {
    activeSlot: 'slotA',
    weaponRaised: false,
    slotA: resolveDefaultSlot('rifle'),
    slotB: resolveDefaultSlot('sniper'),
  },
  reload: {
    active: false,
    weaponKind: null,
    progress: 1,
    remainingMs: 0,
  },
};
