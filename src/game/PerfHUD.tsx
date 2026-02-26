import type { PerfMetrics } from "./types";

type PerfHUDProps = {
  metrics: PerfMetrics;
  visible: boolean;
};

export function PerfHUD({ metrics, visible }: PerfHUDProps) {
  if (!visible) {
    return null;
  }

  return (
    <div className="panel tactical-panel compact-panel perf-panel">
      <h2>Perf HUD</h2>
      <dl className="stat-grid">
        <dt>FPS</dt>
        <dd>{metrics.fps.toFixed(0)}</dd>
        <dt>Frame</dt>
        <dd>{metrics.frameMs.toFixed(2)} ms</dd>
        <dt>Draw Calls</dt>
        <dd>{metrics.drawCalls}</dd>
        <dt>Triangles</dt>
        <dd>{metrics.triangles}</dd>
        <dt>Geometries</dt>
        <dd>{metrics.geometries}</dd>
        <dt>Textures</dt>
        <dd>{metrics.textures}</dd>
      </dl>
      <p className="muted" style={{ marginTop: 8 }}>
        Numbers are sampled in-app, not lab-grade. Good enough to catch bad ideas.
      </p>
    </div>
  );
}
