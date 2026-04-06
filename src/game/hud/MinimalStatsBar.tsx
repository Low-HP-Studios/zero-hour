import { memo } from "react";
import type { PerfMetrics } from "../types";
import "./minimal-stats-bar.css";

type MinimalStatsBarProps = {
  metrics: PerfMetrics;
  pingMs: number | null;
  visible: boolean;
};

export const MinimalStatsBar = memo(function MinimalStatsBar({
  metrics,
  pingMs,
  visible,
}: MinimalStatsBarProps) {
  if (!visible) {
    return null;
  }

  return (
    <div className="minimal-stats-bar" role="status">
      <span>Ping: {pingMs === null ? "-" : `${pingMs}ms`}</span>
      <span>FPS: {Math.round(metrics.fps)}</span>
      <span>CPU: {metrics.cpuUtilPercent}%</span>
      <span>GPU: {metrics.gpuUtilPercent}%</span>
    </div>
  );
});
