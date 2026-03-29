import React, { useEffect, useState } from "react";
import type * as THREE from "three";
import { loadFbxAsset } from "../AssetLoader";
import { WEAPON_MODEL_URLS } from "../scene/scene-constants";
import type { PlayerHealthState, PlayerSnapshot } from "../types";
import { AmmoDisplay } from "./AmmoDisplay";
import { HealthBar } from "./HealthBar";
import { WeaponSlotCard } from "./WeaponSlotCard";
import "./pubg-hud.css";

type PubgHudProps = {
  player: PlayerSnapshot;
  playerHealth: PlayerHealthState;
  visible: boolean;
};

type WeaponModelsState = {
  rifle: THREE.Group | null;
  sniper: THREE.Group | null;
};

const CONTROLLER_HELP_ROWS = [
  { button: "RT", action: "Fire" },
  { button: "LT", action: "Aim / ADS" },
  { button: "A", action: "Jump" },
  { button: "B", action: "Crouch" },
  { button: "L3", action: "Sprint / Toggle Run" },
  { button: "Y", action: "Reload" },
  { button: "X", action: "Loot / Pickup" },
  { button: "View", action: "Inventory" },
  { button: "Menu", action: "Pause" },
] as const;

function PubgHudInner({ player, playerHealth, visible }: PubgHudProps) {
  const [models, setModels] = useState<WeaponModelsState>({
    rifle: null,
    sniper: null,
  });

  useEffect(() => {
    let disposed = false;

    Promise.all([
      loadFbxAsset(WEAPON_MODEL_URLS.rifle),
      loadFbxAsset(WEAPON_MODEL_URLS.sniper),
    ])
      .then(([rifle, sniper]) => {
        if (!disposed) setModels({ rifle, sniper });
      })
      .catch(() => {});

    return () => {
      disposed = true;
    };
  }, []);

  if (!visible) return null;

  const { weaponLoadout, weaponReload } = player;
  const slotA = weaponLoadout.slotA;
  const slotB = weaponLoadout.slotB;
  const isSlotAActive = weaponLoadout.weaponRaised &&
    weaponLoadout.activeSlot === "slotA";
  const isSlotBActive = weaponLoadout.weaponRaised &&
    weaponLoadout.activeSlot === "slotB";
  const activeSlot = isSlotAActive ? slotA : slotB;

  return (
    <>
      {player.controllerConnected ? (
        <div className="pubg-hud pubg-hud--left">
          <div className="pubg-controller-help">
            <div className="pubg-controller-title">Controller</div>
            <div className="pubg-controller-list">
              {CONTROLLER_HELP_ROWS.map((row) => (
                <div key={row.button} className="pubg-controller-row">
                  <span className="pubg-controller-badge">{row.button}</span>
                  <span className="pubg-controller-action">{row.action}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="pubg-hud pubg-hud--right">
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
            isActive={isSlotBActive}
            weaponModel={models.sniper}
          />
        </div>
      </div>

      <div className="pubg-hud pubg-hud--center">
        {weaponLoadout.weaponRaised && activeSlot.hasWeapon ? (
          <AmmoDisplay
            magAmmo={activeSlot.magAmmo}
            reserveAmmo={activeSlot.reserveAmmo}
            infiniteReserveAmmo={activeSlot.infiniteReserveAmmo}
            isReloading={weaponReload.active}
            reloadProgress={weaponReload.progress}
          />
        ) : null}
        <HealthBar health={playerHealth.hp} maxHealth={playerHealth.maxHp} />
      </div>
    </>
  );
}

export const PubgHud = React.memo(PubgHudInner);
