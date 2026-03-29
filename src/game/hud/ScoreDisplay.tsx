import { memo } from "react";

type ScoreDisplayProps = {
  blueScore: number;
  redScore: number;
  targetScore: number;
  visible: boolean;
};

export const ScoreDisplay = memo(function ScoreDisplay({
  blueScore,
  redScore,
  targetScore,
  visible,
}: ScoreDisplayProps) {
  if (!visible) {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 24,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 16px",
        borderRadius: 999,
        background: "rgba(7, 11, 18, 0.78)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        color: "#f8fafc",
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        backdropFilter: "blur(10px)",
        pointerEvents: "none",
      }}
    >
      <span style={{ color: "#60a5fa" }}>Blue {blueScore}</span>
      <span style={{ opacity: 0.65 }}>First to {targetScore}</span>
      <span style={{ color: "#f87171" }}>Red {redScore}</span>
    </div>
  );
});
