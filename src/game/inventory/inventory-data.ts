import type {
  InventoryAttachmentSlot,
  InventoryCategory,
  WeaponSnapshotKind,
} from "../types";

export type WeaponClass = "rifle" | "sniper";

export type InventoryItemId =
  | "weapon_rifle"
  | "weapon_sniper"
  | "ammo_rifle"
  | "ammo_sniper";

export type InventoryItemDefinition = {
  id: InventoryItemId;
  name: string;
  icon: string;
  category: InventoryCategory;
  maxStack: number;
  weaponKind?: WeaponSnapshotKind;
  weaponClass?: WeaponClass;
  attachmentSlot?: InventoryAttachmentSlot;
  compatibleWeaponClasses?: WeaponClass[];
  modifiers?: {
    magazineBonus?: number;
    recoilScale?: number;
    adsSpeedScale?: number;
  };
};

export const INVENTORY_ITEM_DEFS: Record<InventoryItemId, InventoryItemDefinition> = {
  weapon_rifle: {
    id: "weapon_rifle",
    name: "M416 Rifle",
    icon: "AR",
    category: "weapon",
    maxStack: 1,
    weaponKind: "rifle",
    weaponClass: "rifle",
  },
  weapon_sniper: {
    id: "weapon_sniper",
    name: "Kar98k Sniper",
    icon: "SR",
    category: "weapon",
    maxStack: 1,
    weaponKind: "sniper",
    weaponClass: "sniper",
  },
  ammo_rifle: {
    id: "ammo_rifle",
    name: "Rifle Ammo",
    icon: "BLU",
    category: "ammo",
    maxStack: 150,
  },
  ammo_sniper: {
    id: "ammo_sniper",
    name: "Sniper Ammo",
    icon: "RED",
    category: "ammo",
    maxStack: 30,
  },
};

export type StaticGroundSpawn = {
  itemId: InventoryItemId;
  quantity: number;
  position: [number, number, number];
};

export const PRACTICE_AMMO_SPAWNS = {
  rifle: [0.95, 0.14, 3.85] as [number, number, number],
  sniper: [2.35, 0.14, 3.85] as [number, number, number],
};

// Spawn weapons plus basic rifle/sniper ammo pickups.
export const STATIC_GROUND_SPAWNS: StaticGroundSpawn[] = [
  { itemId: "weapon_rifle", quantity: 1, position: [1.4, 0.05, 3.5] },
  { itemId: "weapon_sniper", quantity: 1, position: [1.9, 0.05, 3.5] },
  { itemId: "ammo_rifle", quantity: 150, position: PRACTICE_AMMO_SPAWNS.rifle },
  { itemId: "ammo_sniper", quantity: 30, position: PRACTICE_AMMO_SPAWNS.sniper },
];

export const BACKPACK_CAPACITY = 24;

export const INVENTORY_NEARBY_RADIUS = 2.5;
