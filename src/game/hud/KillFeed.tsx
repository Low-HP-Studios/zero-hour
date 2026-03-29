import { memo, useEffect, useState } from "react";
import type { KillFeedEntry } from "../types";

type KillFeedProps = {
  entries: KillFeedEntry[];
  visible: boolean;
};

const KILL_FEED_LIFETIME_MS = 5000;

function formatWeaponLabel(weapon: KillFeedEntry["weapon"]) {
  return weapon === "sniper" ? "SR" : "AR";
}

export const KillFeed = memo(function KillFeed({
  entries,
  visible,
}: KillFeedProps) {
  const [nowMs, setNowMs] = useState(() => performance.now());

  useEffect(() => {
    if (!visible) {
      return;
    }

    const timer = window.setInterval(() => {
      setNowMs(performance.now());
    }, 250);

    return () => {
      window.clearInterval(timer);
    };
  }, [visible]);

  if (!visible) {
    return null;
  }

  const activeEntries = entries
    .filter((entry) => nowMs - entry.timestamp <= KILL_FEED_LIFETIME_MS)
    .slice(0, 5);

  if (activeEntries.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 78,
        right: 24,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        width: 280,
        pointerEvents: "none",
      }}
    >
      {activeEntries.map((entry) => {
        const age = Math.min(1, (nowMs - entry.timestamp) / KILL_FEED_LIFETIME_MS);
        const opacity = 1 - age * 0.7;
        return (
          <div
            key={entry.id}
            style={{
              opacity,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 12,
              background: "rgba(7, 11, 18, 0.76)",
              border: `1px solid ${
                entry.isPlayerKill
                  ? "rgba(96, 165, 250, 0.35)"
                  : "rgba(248, 113, 113, 0.35)"
              }`,
              color: "#e5eef8",
              fontSize: 13,
              lineHeight: 1.2,
              backdropFilter: "blur(10px)",
            }}
          >
            <span style={{ color: entry.isPlayerKill ? "#93c5fd" : "#fca5a5" }}>
              {entry.killerName}
            </span>
            <span style={{ opacity: 0.65 }}>{formatWeaponLabel(entry.weapon)}</span>
            <span style={{ textAlign: "right" }}>{entry.victimName}</span>
          </div>
        );
      })}
    </div>
  );
});
