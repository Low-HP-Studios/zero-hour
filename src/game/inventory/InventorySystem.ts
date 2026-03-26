import type {
  InventoryAttachmentSlot,
  InventoryBackpackSnapshot,
  InventoryItemStackSnapshot,
  InventoryMoveLocation,
  InventoryMoveRequest,
  InventoryMoveResult,
  InventoryOpenMode,
  InventoryPanelSnapshot,
  InventoryWeaponEquipSlot,
  PlayerWeaponLoadoutSnapshot,
} from "../types";
import {
  BACKPACK_CAPACITY,
  INVENTORY_ITEM_DEFS,
  INVENTORY_NEARBY_RADIUS,
  type InventoryItemDefinition,
  type InventoryItemId,
  type StaticGroundSpawn,
} from "./inventory-data";

type RuntimeStack = {
  uid: string;
  itemId: InventoryItemId;
  quantity: number;
};

type RuntimeAttachmentSlots = Record<InventoryAttachmentSlot, RuntimeStack | null>;

type GroundItem = {
  id: string;
  stack: RuntimeStack;
  position: [number, number, number];
};

export type AttachmentRuntimeModifiers = {
  rifleMagBonus: number;
  sniperMagBonus: number;
  rifleRecoilScale: number;
  sniperRecoilScale: number;
};

export type GroundWeaponVisualState = {
  rifle: {
    isPresentOnGround: boolean;
    droppedPosition: [number, number, number] | null;
  };
  sniper: {
    isPresentOnGround: boolean;
    droppedPosition: [number, number, number] | null;
  };
};

export type GroundAmmoVisualState = {
  rifle: Array<[number, number, number]>;
  sniper: Array<[number, number, number]>;
};

const EMPTY_ATTACHMENTS: RuntimeAttachmentSlots = {
  scope: null,
  magazine: null,
  grip: null,
  muzzle: null,
};

const MAX_BACKPACK_SLOTS = 36;

function distanceXZ(a: [number, number, number], b: [number, number, number]) {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return Math.hypot(dx, dz);
}

function toSnapshotStack(stack: RuntimeStack): InventoryItemStackSnapshot {
  const definition = INVENTORY_ITEM_DEFS[stack.itemId];
  return {
    uid: stack.uid,
    itemId: stack.itemId,
    name: definition.name,
    icon: definition.icon,
    category: definition.category,
    quantity: stack.quantity,
  };
}

function isAttachmentCompatible(
  definition: InventoryItemDefinition,
  weaponSlot: InventoryWeaponEquipSlot,
  weaponLoadout: PlayerWeaponLoadoutSnapshot,
): boolean {
  if (definition.category !== "attachment" || !definition.attachmentSlot) {
    return false;
  }

  const weaponKind = weaponSlot === "primary"
    ? weaponLoadout.slotA.weaponKind
    : weaponLoadout.slotB.weaponKind;
  if (!weaponKind) {
    return false;
  }

  const weaponClass = weaponKind === "rifle" ? "rifle" : "sniper";
  const compatible = definition.compatibleWeaponClasses ?? [];
  return compatible.includes(weaponClass);
}

export class InventorySystem {
  private backpackSlots: Array<RuntimeStack | null> = Array.from(
    { length: MAX_BACKPACK_SLOTS },
    () => null,
  );

  private attachments: Record<InventoryWeaponEquipSlot, RuntimeAttachmentSlots> = {
    primary: { ...EMPTY_ATTACHMENTS },
    secondary: { ...EMPTY_ATTACHMENTS },
  };

  private activeQuickSlot: "primary" | "secondary" = "primary";

  private groundItems = new Map<string, GroundItem>();
  private stackCounter = 0;
  private groundCounter = 0;
  private revision = 0;
  private defaultGroundSpawns: readonly StaticGroundSpawn[] = [];
  private practiceAmmoSpawnPoints: {
    rifle: [number, number, number] | null;
    sniper: [number, number, number] | null;
  } = {
    rifle: null,
    sniper: null,
  };

  constructor(groundSpawns: readonly StaticGroundSpawn[] = []) {
    this.reset(groundSpawns);
  }

  grantStackInFirstBackpackSlot(itemId: InventoryItemId, quantity: number) {
    const definition = INVENTORY_ITEM_DEFS[itemId];
    const q = Math.max(1, Math.min(quantity, definition.maxStack));
    const stack = this.createStack(itemId, q);
    for (let index = 0; index < BACKPACK_CAPACITY; index += 1) {
      if (!this.backpackSlots[index]) {
        this.backpackSlots[index] = stack;
        this.bumpRevision();
        return true;
      }
    }
    return false;
  }

  reset(groundSpawns: readonly StaticGroundSpawn[] = this.defaultGroundSpawns) {
    this.defaultGroundSpawns = groundSpawns.map((spawn) => ({
      ...spawn,
      position: [...spawn.position] as [number, number, number],
    }));
    this.backpackSlots = Array.from({ length: MAX_BACKPACK_SLOTS }, () => null);
    this.attachments = {
      primary: { ...EMPTY_ATTACHMENTS },
      secondary: { ...EMPTY_ATTACHMENTS },
    };
    this.activeQuickSlot = "primary";
    this.groundItems.clear();
    this.practiceAmmoSpawnPoints = {
      rifle: null,
      sniper: null,
    };

    for (const spawn of this.defaultGroundSpawns) {
      this.addGroundItem(
        this.createStack(spawn.itemId, spawn.quantity),
        spawn.position,
      );
      if (spawn.itemId === "ammo_rifle") {
        this.practiceAmmoSpawnPoints.rifle = [...spawn.position] as [
          number,
          number,
          number,
        ];
      } else if (spawn.itemId === "ammo_sniper") {
        this.practiceAmmoSpawnPoints.sniper = [...spawn.position] as [
          number,
          number,
          number,
        ];
      }
    }

    this.bumpRevision();
  }

  setActiveQuickSlot(next: "primary" | "secondary") {
    if (this.activeQuickSlot === next) {
      return;
    }
    this.activeQuickSlot = next;
    this.bumpRevision();
  }

  getActiveQuickSlot() {
    return this.activeQuickSlot;
  }

  getNearbyGroundIds(playerPosition: [number, number, number]) {
    return [...this.groundItems.values()]
      .map((item) => ({
        id: item.id,
        distance: distanceXZ(item.position, playerPosition),
      }))
      .filter((entry) => entry.distance <= INVENTORY_NEARBY_RADIUS)
      .sort((a, b) => a.distance - b.distance);
  }

  getGroundItemId(groundId: string): InventoryItemId | null {
    return this.groundItems.get(groundId)?.stack.itemId ?? null;
  }

  getAmmoCount(itemId: "ammo_rifle" | "ammo_sniper") {
    let total = 0;
    for (const stack of this.backpackSlots) {
      if (stack?.itemId === itemId) {
        total += stack.quantity;
      }
    }
    return total;
  }

  getAmmoTotalsByWeaponKind() {
    return {
      rifle: this.getAmmoCount("ammo_rifle"),
      sniper: this.getAmmoCount("ammo_sniper"),
    };
  }

  consumeAmmo(itemId: "ammo_rifle" | "ammo_sniper", amount: number) {
    let remaining = Math.max(0, Math.floor(amount));
    if (remaining <= 0) {
      return 0;
    }

    let consumed = 0;
    for (let index = BACKPACK_CAPACITY - 1; index >= 0 && remaining > 0; index -= 1) {
      const stack = this.backpackSlots[index];
      if (!stack || stack.itemId !== itemId) {
        continue;
      }

      const take = Math.min(stack.quantity, remaining);
      stack.quantity -= take;
      consumed += take;
      remaining -= take;
      if (stack.quantity <= 0) {
        this.backpackSlots[index] = null;
      } else {
        this.backpackSlots[index] = stack;
      }
    }

    if (consumed > 0) {
      this.bumpRevision();
    }
    return consumed;
  }

  ensurePracticeAmmoStock(rifleAmount = 120, sniperAmount = 30) {
    const nextRifleAmount = Math.max(0, Math.floor(rifleAmount));
    const nextSniperAmount = Math.max(0, Math.floor(sniperAmount));

    let changed = false;
    if (
      nextRifleAmount > 0 &&
      !this.hasGroundItemWithId("ammo_rifle") &&
      this.practiceAmmoSpawnPoints.rifle
    ) {
      this.addGroundItem(
        this.createStack("ammo_rifle", nextRifleAmount),
        this.practiceAmmoSpawnPoints.rifle,
      );
      changed = true;
    }

    if (
      nextSniperAmount > 0 &&
      !this.hasGroundItemWithId("ammo_sniper") &&
      this.practiceAmmoSpawnPoints.sniper
    ) {
      this.addGroundItem(
        this.createStack("ammo_sniper", nextSniperAmount),
        this.practiceAmmoSpawnPoints.sniper,
      );
      changed = true;
    }

    if (changed) {
      this.bumpRevision();
    }

    return changed;
  }

  quickPickupClosestNearby(
    playerPosition: [number, number, number],
    weaponLoadout: PlayerWeaponLoadoutSnapshot,
  ): InventoryMoveResult {
    const nearest = this.getNearbyGroundIds(playerPosition)[0];
    if (!nearest) {
      return { ok: false, message: "No nearby item." };
    }
    return this.quickMove(
      {
        zone: "nearby",
        id: nearest.id,
      },
      playerPosition,
      weaponLoadout,
    );
  }

  moveItem(
    request: InventoryMoveRequest,
    playerPosition: [number, number, number],
    weaponLoadout: PlayerWeaponLoadoutSnapshot,
  ): InventoryMoveResult {
    if (this.isWeaponEquipLocation(request.from) || this.isWeaponEquipLocation(request.to)) {
      return {
        ok: false,
        message: "Weapon slot operations are handled separately.",
      };
    }

    const sourceStack = this.getStackFromLocation(request.from);
    if (!sourceStack) {
      return { ok: false, message: "Source slot is empty." };
    }

    if (!this.canPlaceOnTarget(sourceStack, request.to, weaponLoadout)) {
      return { ok: false, message: "Item cannot be placed in that slot." };
    }

    const targetStack = this.getStackFromLocation(request.to);
    if (targetStack) {
      if (targetStack.itemId === sourceStack.itemId) {
        const merged = this.tryMergeStacks(targetStack, sourceStack);
        if (merged > 0) {
          this.setStackAtLocation(
            request.from,
            sourceStack.quantity > 0 ? sourceStack : null,
            playerPosition,
          );
          this.setStackAtLocation(request.to, targetStack, playerPosition);
          this.bumpRevision();
          return { ok: true };
        }
      }

      if (!this.canPlaceOnTarget(targetStack, request.from, weaponLoadout)) {
        return {
          ok: false,
          message: "Target item cannot swap back to source slot.",
        };
      }

      this.setStackAtLocation(request.from, targetStack, playerPosition);
      this.setStackAtLocation(request.to, sourceStack, playerPosition);
      this.bumpRevision();
      return { ok: true };
    }

    this.setStackAtLocation(request.from, null, playerPosition);
    this.setStackAtLocation(request.to, sourceStack, playerPosition);
    this.bumpRevision();
    return { ok: true };
  }

  quickMove(
    source: InventoryMoveLocation,
    playerPosition: [number, number, number],
    weaponLoadout: PlayerWeaponLoadoutSnapshot,
  ): InventoryMoveResult {
    if (this.isWeaponEquipLocation(source)) {
      return {
        ok: false,
        message: "Weapon slot operations are handled separately.",
      };
    }

    const sourceStack = this.getStackFromLocation(source);
    if (!sourceStack) {
      return { ok: false, message: "Source slot is empty." };
    }

    if (source.zone === "nearby") {
      const autoEquip = this.resolveAutoEquipTarget(sourceStack, weaponLoadout);
      if (autoEquip) {
        const result = this.moveItem(
          { from: source, to: autoEquip },
          playerPosition,
          weaponLoadout,
        );
        if (result.ok) {
          return result;
        }
      }

      const backpackIndex = this.findFirstBackpackSlotFor(sourceStack);
      if (backpackIndex === -1) {
        return { ok: false, message: "Backpack is full." };
      }

      return this.moveItem(
        {
          from: source,
          to: {
            zone: "backpack",
            index: backpackIndex,
          },
        },
        playerPosition,
        weaponLoadout,
      );
    }

    if (source.zone === "backpack") {
      const autoEquip = this.resolveAutoEquipTarget(sourceStack, weaponLoadout);
      if (autoEquip) {
        return this.moveItem(
          { from: source, to: autoEquip },
          playerPosition,
          weaponLoadout,
        );
      }
      return { ok: false, message: "No valid quick-move target." };
    }

    if (source.zone === "attachment") {
      const backpackIndex = this.findFirstBackpackSlotFor(sourceStack);
      if (backpackIndex === -1) {
        return { ok: false, message: "Backpack is full." };
      }
      return this.moveItem(
        {
          from: source,
          to: {
            zone: "backpack",
            index: backpackIndex,
          },
        },
        playerPosition,
        weaponLoadout,
      );
    }

    return { ok: false, message: "Unsupported quick move." };
  }

  dropWeaponItemToGround(
    itemId: "weapon_rifle" | "weapon_sniper",
    playerPosition: [number, number, number],
  ) {
    this.addGroundItem(
      this.createStack(itemId, 1),
      [playerPosition[0] + 0.9, 0.05, playerPosition[2] + 0.6],
    );
    this.bumpRevision();
  }

  consumeGroundWeaponItem(id: string): "weapon_rifle" | "weapon_sniper" | null {
    const item = this.groundItems.get(id);
    if (!item) {
      return null;
    }

    const definition = INVENTORY_ITEM_DEFS[item.stack.itemId];
    if (
      definition.id !== "weapon_rifle" &&
      definition.id !== "weapon_sniper"
    ) {
      return null;
    }

    this.groundItems.delete(id);
    this.bumpRevision();
    return definition.id;
  }

  getAttachmentModifiers(): AttachmentRuntimeModifiers {
    const primaryMag = this.resolveAttachmentModifier(
      this.attachments.primary.magazine,
      "magazineBonus",
    );
    const secondaryMag = this.resolveAttachmentModifier(
      this.attachments.secondary.magazine,
      "magazineBonus",
    );

    const primaryRecoil = this.resolveRecoilScale("primary");
    const secondaryRecoil = this.resolveRecoilScale("secondary");

    return {
      rifleMagBonus: primaryMag,
      sniperMagBonus: secondaryMag,
      rifleRecoilScale: primaryRecoil,
      sniperRecoilScale: secondaryRecoil,
    };
  }

  getGroundWeaponVisualState(): GroundWeaponVisualState {
    const riflePosition = this.findGroundWeaponPosition("weapon_rifle");
    const sniperPosition = this.findGroundWeaponPosition("weapon_sniper");
    return {
      rifle: {
        isPresentOnGround: riflePosition !== null,
        droppedPosition: riflePosition,
      },
      sniper: {
        isPresentOnGround: sniperPosition !== null,
        droppedPosition: sniperPosition,
      },
    };
  }

  getGroundAmmoVisualState(): GroundAmmoVisualState {
    const rifle: Array<[number, number, number]> = [];
    const sniper: Array<[number, number, number]> = [];
    for (const item of this.groundItems.values()) {
      if (item.stack.itemId === "ammo_rifle") {
        rifle.push([item.position[0], item.position[1], item.position[2]]);
      } else if (item.stack.itemId === "ammo_sniper") {
        sniper.push([item.position[0], item.position[1], item.position[2]]);
      }
    }

    return { rifle, sniper };
  }

  getSnapshot(
    playerPosition: [number, number, number],
    open: boolean,
    openMode: InventoryOpenMode,
  ): InventoryPanelSnapshot {
    const nearby = [...this.groundItems.values()]
      .map((item) => ({
        id: item.id,
        distance: distanceXZ(item.position, playerPosition),
        stack: toSnapshotStack(item.stack),
      }))
      .filter((item) => item.distance <= INVENTORY_NEARBY_RADIUS)
      .sort((a, b) => a.distance - b.distance);

    return {
      revision: this.revision,
      open,
      openMode,
      nearby,
      backpack: this.getBackpackSnapshot(),
      equipped: {
        primaryAttachments: {
          scope: this.attachments.primary.scope
            ? toSnapshotStack(this.attachments.primary.scope)
            : null,
          magazine: this.attachments.primary.magazine
            ? toSnapshotStack(this.attachments.primary.magazine)
            : null,
          grip: this.attachments.primary.grip
            ? toSnapshotStack(this.attachments.primary.grip)
            : null,
          muzzle: this.attachments.primary.muzzle
            ? toSnapshotStack(this.attachments.primary.muzzle)
            : null,
        },
        secondaryAttachments: {
          scope: this.attachments.secondary.scope
            ? toSnapshotStack(this.attachments.secondary.scope)
            : null,
          magazine: this.attachments.secondary.magazine
            ? toSnapshotStack(this.attachments.secondary.magazine)
            : null,
          grip: this.attachments.secondary.grip
            ? toSnapshotStack(this.attachments.secondary.grip)
            : null,
          muzzle: this.attachments.secondary.muzzle
            ? toSnapshotStack(this.attachments.secondary.muzzle)
            : null,
        },
        activeQuickSlot: this.activeQuickSlot,
      },
    };
  }

  private getBackpackSnapshot(): InventoryBackpackSnapshot {
    return {
      columns: 6,
      capacity: BACKPACK_CAPACITY,
      slots: this.backpackSlots.map((slot) => (slot ? toSnapshotStack(slot) : null)),
    };
  }

  private resolveAutoEquipTarget(
    stack: RuntimeStack,
    weaponLoadout: PlayerWeaponLoadoutSnapshot,
  ): InventoryMoveLocation | null {
    const definition = INVENTORY_ITEM_DEFS[stack.itemId];

    if (definition.category === "attachment" && definition.attachmentSlot) {
      if (isAttachmentCompatible(definition, "primary", weaponLoadout)) {
        return {
          zone: "attachment",
          weaponSlot: "primary",
          slot: definition.attachmentSlot,
        };
      }
      if (isAttachmentCompatible(definition, "secondary", weaponLoadout)) {
        return {
          zone: "attachment",
          weaponSlot: "secondary",
          slot: definition.attachmentSlot,
        };
      }
    }

    return null;
  }

  private canPlaceOnTarget(
    sourceStack: RuntimeStack,
    target: InventoryMoveLocation,
    weaponLoadout: PlayerWeaponLoadoutSnapshot,
  ) {
    const definition = INVENTORY_ITEM_DEFS[sourceStack.itemId];

    if (target.zone === "nearby") {
      return true;
    }

    if (target.zone === "backpack") {
      if (definition.category === "weapon") {
        return false;
      }
      return target.index >= 0 && target.index < BACKPACK_CAPACITY;
    }

    if (target.zone === "equip") {
      return false;
    }

    if (target.zone === "attachment") {
      return isAttachmentCompatible(definition, target.weaponSlot, weaponLoadout) &&
        definition.attachmentSlot === target.slot;
    }

    return false;
  }

  private tryMergeStacks(target: RuntimeStack, source: RuntimeStack) {
    const definition = INVENTORY_ITEM_DEFS[target.itemId];
    const free = Math.max(0, definition.maxStack - target.quantity);
    if (free <= 0) {
      return 0;
    }
    const moved = Math.min(free, source.quantity);
    target.quantity += moved;
    source.quantity -= moved;
    return moved;
  }

  private findFirstBackpackSlotFor(stack: RuntimeStack) {
    for (let index = 0; index < BACKPACK_CAPACITY; index += 1) {
      const candidate = this.backpackSlots[index];
      if (!candidate) {
        return index;
      }
      if (candidate.itemId === stack.itemId) {
        const definition = INVENTORY_ITEM_DEFS[candidate.itemId];
        if (candidate.quantity < definition.maxStack) {
          return index;
        }
      }
    }

    return -1;
  }

  private getStackFromLocation(location: InventoryMoveLocation): RuntimeStack | null {
    if (location.zone === "nearby") {
      return this.groundItems.get(location.id)?.stack ?? null;
    }

    if (location.zone === "backpack") {
      return this.backpackSlots[location.index] ?? null;
    }

    if (location.zone === "attachment") {
      return this.attachments[location.weaponSlot][location.slot];
    }

    return null;
  }

  private setStackAtLocation(
    location: InventoryMoveLocation,
    stack: RuntimeStack | null,
    playerPosition: [number, number, number],
  ) {
    if (location.zone === "nearby") {
      if (!stack) {
        this.groundItems.delete(location.id);
        return;
      }
      const existing = this.groundItems.get(location.id);
      if (existing) {
        existing.stack = stack;
        return;
      }
      this.addGroundItem(
        stack,
        [playerPosition[0] + 0.85, 0.05, playerPosition[2] + 0.55],
      );
      return;
    }

    if (location.zone === "backpack") {
      this.backpackSlots[location.index] = stack;
      return;
    }

    if (location.zone === "attachment") {
      this.attachments[location.weaponSlot][location.slot] = stack;
    }
  }

  private createStack(itemId: InventoryItemId, quantity: number): RuntimeStack {
    this.stackCounter += 1;
    const definition = INVENTORY_ITEM_DEFS[itemId];
    return {
      uid: `stk_${this.stackCounter}`,
      itemId,
      quantity: Math.max(1, Math.min(quantity, definition.maxStack)),
    };
  }

  private addGroundItem(stack: RuntimeStack, position: [number, number, number]) {
    this.groundCounter += 1;
    const id = `ground_${this.groundCounter}`;
    this.groundItems.set(id, {
      id,
      stack,
      position,
    });
  }

  private bumpRevision() {
    this.revision += 1;
  }

  private resolveAttachmentModifier(
    stack: RuntimeStack | null,
    key: "magazineBonus",
  ) {
    if (!stack) {
      return 0;
    }
    const modifier = INVENTORY_ITEM_DEFS[stack.itemId].modifiers;
    return modifier?.[key] ?? 0;
  }

  private resolveRecoilScale(weaponSlot: InventoryWeaponEquipSlot) {
    const grip = this.attachments[weaponSlot].grip;
    const muzzle = this.attachments[weaponSlot].muzzle;
    const gripScale = grip
      ? (INVENTORY_ITEM_DEFS[grip.itemId].modifiers?.recoilScale ?? 1)
      : 1;
    const muzzleScale = muzzle
      ? (INVENTORY_ITEM_DEFS[muzzle.itemId].modifiers?.recoilScale ?? 1)
      : 1;
    return gripScale * muzzleScale;
  }

  private findGroundWeaponPosition(
    itemId: "weapon_rifle" | "weapon_sniper",
  ): [number, number, number] | null {
    for (const item of this.groundItems.values()) {
      if (item.stack.itemId === itemId) {
        return [item.position[0], item.position[1], item.position[2]];
      }
    }
    return null;
  }

  private hasGroundItemWithId(itemId: InventoryItemId) {
    for (const item of this.groundItems.values()) {
      if (item.stack.itemId === itemId) {
        return true;
      }
    }
    return false;
  }

  private isWeaponEquipLocation(location: InventoryMoveLocation) {
    return location.zone === "equip" &&
      (location.slot === "primary" || location.slot === "secondary");
  }
}
