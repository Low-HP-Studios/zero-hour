export type WeaponShotEvent = {
  timestamp: number;
  shotIndex: number;
};

export type WeaponWorldState = {
  equipped: boolean;
  droppedPosition: [number, number, number] | null;
};

export const DEFAULT_WEAPON_WORLD_STATE: WeaponWorldState = {
  equipped: false,
  droppedPosition: [1.5, 0.35, 3.5],
};
