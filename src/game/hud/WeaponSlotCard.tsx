import React from "react";
import type * as THREE from "three";
import type { PlayerWeaponSlotSnapshot } from "../types";
import { WeaponThumbnail } from "./WeaponThumbnail";

type WeaponSlotCardProps = {
  slot: PlayerWeaponSlotSnapshot;
  slotNumber: 1 | 2;
  isActive: boolean;
  weaponModel: THREE.Group | null;
};

function WeaponSlotCardInner({
  slot,
  slotNumber,
  isActive,
  weaponModel,
}: WeaponSlotCardProps) {
  const kind = slot.weaponKind;
  const className = [
    "pubg-weapon-card",
    isActive ? "active" : "",
    !slot.hasWeapon ? "empty" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      <span className="pubg-slot-number">{slotNumber}</span>
      {slot.hasWeapon && kind ? (
        <>
          <WeaponThumbnail model={weaponModel} kind={kind} />
          <div className="pubg-slot-ammo">
            <span className="pubg-slot-mag">{slot.magAmmo}</span>
            <span className="pubg-slot-divider">/</span>
            <span className="pubg-slot-reserve">
              {slot.infiniteReserveAmmo ? "∞" : slot.reserveAmmo}
            </span>
          </div>
        </>
      ) : (
        <div className="pubg-thumbnail-fallback">—</div>
      )}
    </div>
  );
}

export const WeaponSlotCard = React.memo(WeaponSlotCardInner);
