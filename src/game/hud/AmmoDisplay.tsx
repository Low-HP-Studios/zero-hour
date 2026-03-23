import React from "react";

type AmmoDisplayProps = {
  magAmmo: number;
  reserveAmmo: number;
  infiniteReserveAmmo: boolean;
  isReloading: boolean;
  reloadProgress: number;
};

function AmmoDisplayInner({
  magAmmo,
  reserveAmmo,
  infiniteReserveAmmo,
  isReloading,
  reloadProgress,
}: AmmoDisplayProps) {
  return (
    <div className="pubg-ammo-display">
      <span className="pubg-ammo-mag">{magAmmo}</span>
      <span className="pubg-ammo-separator">/</span>
      <span className="pubg-ammo-reserve">
        {infiniteReserveAmmo ? "∞" : reserveAmmo}
      </span>
      {isReloading ? (
        <div className="pubg-reload-bar">
          <div
            className="pubg-reload-fill"
            style={{
              width: `${Math.round(Math.max(0, Math.min(1, reloadProgress)) * 100)}%`,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

export const AmmoDisplay = React.memo(AmmoDisplayInner);
