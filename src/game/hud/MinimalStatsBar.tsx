import { memo } from "react";
import type { PerfMetrics } from "../types";
import "./minimal-stats-bar.css";

type MinimalStatsBarProps = {
  metrics: PerfMetrics;
  visible: boolean;
};

export const MinimalStatsBar = memo(function MinimalStatsBar({
  metrics,
  visible,
}: MinimalStatsBarProps) {
  if (!visible) {
    return null;
  }

  return (
    <div className="minimal-stats-bar" role="status">
      <span>Ping: -</span>
      <span>FPS: {Math.round(metrics.fps)}</span>
      <span>CPU: {metrics.cpuUtilPercent}%</span>
      <span>GPU: {metrics.gpuUtilPercent}%</span>
    </div>
  );
});
