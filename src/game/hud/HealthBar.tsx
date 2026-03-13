import React from "react";

const SEGMENT_COUNT = 4;

type HealthBarProps = {
  health: number;
  maxHealth: number;
};

function HealthBarInner({ health, maxHealth }: HealthBarProps) {
  const filledSegments = Math.round((health / maxHealth) * SEGMENT_COUNT);

  return (
    <div className="pubg-health-bar">
      {Array.from({ length: SEGMENT_COUNT }, (_, i) => (
        <div
          key={i}
          className={`pubg-health-segment${i >= filledSegments ? " empty" : ""}`}
        />
      ))}
    </div>
  );
}

export const HealthBar = React.memo(HealthBarInner);
