import React, { useEffect, useState } from "react";
import type * as THREE from "three";
import { loadFbxAsset } from "../AssetLoader";
import { WEAPON_MODEL_URLS } from "../scene/scene-constants";
import type { PlayerSnapshot } from "../types";
import { AmmoDisplay } from "./AmmoDisplay";
import { HealthBar } from "./HealthBar";
import { WeaponSlotCard } from "./WeaponSlotCard";
import "./pubg-hud.css";

type PubgHudProps = {
  player: PlayerSnapshot;
  visible: boolean;
};

type WeaponModelsState = {
  rifle: THREE.Group | null;
  sniper: THREE.Group | null;
};

function PubgHudInner({ player, visible }: PubgHudProps) {
  const [models, setModels] = useState<WeaponModelsState>({
    rifle: null,
    sniper: null,
  });

  // Load weapon models (cache-hitting — already loaded by the game scene)
  useEffect(() => {
    let disposed = false;

    Promise.all([
      loadFbxAsset(WEAPON_MODEL_URLS.rifle),
      loadFbxAsset(WEAPON_MODEL_URLS.sniper),
    ])
      .then(([rifle, sniper]) => {
        if (!disposed) setModels({ rifle, sniper });
      })
      .catch(() => {
        // Models may not be available — thumbnails will use fallback text
      });

    return () => {
      disposed = true;
    };
  }, []);

  if (!visible) return null;

  const { weaponLoadout, weaponReload } = player;
  const slotA = weaponLoadout.slotA;
  const slotB = weaponLoadout.slotB;
  const isSlotAActive = weaponLoadout.activeSlot === "slotA";
  const activeSlot = isSlotAActive ? slotA : slotB;

  return (
    <div className="pubg-hud">
      <div className="pubg-weapon-slots">
        <WeaponSlotCard
          slot={slotA}
          slotNumber={1}
          isActive={isSlotAActive}
          weaponModel={models.rifle}
        />
        <WeaponSlotCard
          slot={slotB}
          slotNumber={2}
          isActive={!isSlotAActive}
          weaponModel={models.sniper}
        />
      </div>

      {activeSlot.hasWeapon ? (
        <AmmoDisplay
          magAmmo={activeSlot.magAmmo}
          reserveAmmo={activeSlot.reserveAmmo}
          isReloading={weaponReload.active}
          reloadProgress={weaponReload.progress}
        />
      ) : null}

      <HealthBar health={100} maxHealth={100} />
    </div>
  );
}

export const PubgHud = React.memo(PubgHudInner);
