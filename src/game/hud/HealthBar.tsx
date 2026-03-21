import React from "react";

type HealthBarProps = {
  health: number;
  maxHealth: number;
};

function HealthBarInner({ health, maxHealth }: HealthBarProps) {
  const pct = Math.max(0, Math.min(1, health / maxHealth)) * 100;
  return (
    <div className="pubg-health-bar">
      <div className="pubg-health-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export const HealthBar = React.memo(HealthBarInner);
