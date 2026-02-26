import { useEffect, useMemo, useState } from "react";
import { PerfHUD } from "./PerfHUD";
import { Scene } from "./Scene";
import {
  DEFAULT_PERF_METRICS,
  DEFAULT_PLAYER_SNAPSHOT,
  type GameSettings,
  type PerfMetrics,
  type PixelRatioScale,
  type PlayerSnapshot,
  type StressModeCount,
} from "./types";

const STRESS_STEPS: StressModeCount[] = [0, 50, 100, 200];
const PIXEL_RATIO_OPTIONS: PixelRatioScale[] = [0.75, 1, 1.25];

export function GameRoot() {
  const [settings, setSettings] = useState<GameSettings>({
    shadows: true,
    pixelRatioScale: 1,
    showPerfHud: true,
    showR3fPerf: false,
  });
  const [stressCount, setStressCount] = useState<StressModeCount>(0);
  const [perfMetrics, setPerfMetrics] = useState<PerfMetrics>(DEFAULT_PERF_METRICS);
  const [player, setPlayer] = useState<PlayerSnapshot>(DEFAULT_PLAYER_SNAPSHOT);
  const [weaponEquipped, setWeaponEquipped] = useState(false);
  const [hitMarkerUntil, setHitMarkerUntil] = useState(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "KeyF" || event.repeat) {
        return;
      }

      setSettings((prev) => ({ ...prev, showPerfHud: !prev.showPerfHud }));
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const hitMarkerVisible = hitMarkerUntil > performance.now();
  const stressLabel = stressCount === 0 ? "Off" : `${stressCount} boxes`;
  const lockLabel = player.pointerLocked ? "Pointer locked" : "Pointer unlocked";

  const playerSummary = useMemo(() => {
    return {
      x: player.x.toFixed(1),
      y: player.y.toFixed(1),
      z: player.z.toFixed(1),
      speed: player.speed.toFixed(2),
    };
  }, [player.speed, player.x, player.y, player.z]);

  return (
    <div className="app-shell">
      <Scene
        settings={settings}
        stressCount={stressCount}
        onPerfMetrics={setPerfMetrics}
        onPlayerSnapshot={setPlayer}
        onHitMarker={() => setHitMarkerUntil(performance.now() + 90)}
        onWeaponEquippedChange={setWeaponEquipped}
      />

      <div className="ui-overlay" aria-hidden>
        <div className="corner-top-left panel">
          <h1>Practice FPS Prototype</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            Web/Tauri performance sandbox. Minimal on purpose. Future legacy guaranteed.
          </p>
          <div className="status-pill">
            <span className={`status-dot ${player.pointerLocked ? "locked" : ""}`} />
            <span>{lockLabel}</span>
          </div>
          <dl className="stat-grid">
            <dt>Player</dt>
            <dd>
              {playerSummary.x}, {playerSummary.y}, {playerSummary.z}
            </dd>
            <dt>Speed</dt>
            <dd>{playerSummary.speed} u/s</dd>
            <dt>Move</dt>
            <dd>{player.moving ? (player.sprinting ? "Sprint" : "Walk") : "Idle"}</dd>
            <dt>Interact</dt>
            <dd>{player.canInteract ? "Pickup (E)" : "-"}</dd>
            <dt>Weapon</dt>
            <dd>{weaponEquipped ? "Rifle equipped" : "On ground"}</dd>
          </dl>
        </div>

        <div className="corner-top-right">
          <PerfHUD metrics={perfMetrics} visible={settings.showPerfHud} />
        </div>

        <div className="center-stack">
          <div className="crosshair" />
          <div className={`hit-marker ${hitMarkerVisible ? "visible" : ""}`} />
        </div>

        <div className="corner-bottom-left panel">
          <h2>Controls</h2>
          <ul className="control-list">
            <li>
              <code>WASD</code> move
            </li>
            <li>
              <code>Mouse</code> look (after click / pointer lock)
            </li>
            <li>
              <code>Left Click</code> fire (hold)
            </li>
            <li>
              <code>Shift</code> sprint
            </li>
            <li>
              <code>E</code> pickup gun
            </li>
            <li>
              <code>G</code> drop gun
            </li>
            <li>
              <code>R</code> reset targets
            </li>
            <li>
              <code>Esc</code> unlock pointer
            </li>
            <li>
              <code>F</code> toggle perf HUD
            </li>
          </ul>
        </div>

        <div className="corner-bottom-right panel">
          <h2>Settings</h2>
          <div className="settings-grid">
            <div className="settings-row">
              <label>
                <input
                  type="checkbox"
                  checked={settings.shadows}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      shadows: event.currentTarget.checked,
                    }))
                  }
                />
                Shadows
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.showR3fPerf}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      showR3fPerf: event.currentTarget.checked,
                    }))
                  }
                />
                r3f-perf overlay
              </label>
            </div>

            <div className="settings-row">
              <span className="muted">Pixel ratio</span>
              {PIXEL_RATIO_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`btn ${settings.pixelRatioScale === option ? "active" : ""}`}
                  onClick={() =>
                    setSettings((prev) => ({
                      ...prev,
                      pixelRatioScale: option,
                    }))
                  }
                >
                  {option.toFixed(2)}x
                </button>
              ))}
            </div>

            <div className="settings-row">
              <span className="muted">Stress mode</span>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setStressCount((prev) => {
                    const currentIndex = STRESS_STEPS.indexOf(prev);
                    const nextIndex = (currentIndex + 1) % STRESS_STEPS.length;
                    return STRESS_STEPS[nextIndex];
                  });
                }}
              >
                {stressLabel}
              </button>
            </div>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            Stress mode is mostly draw-call pain right now. Adding full physics later is how you end up benchmarking regret instead of gameplay.
          </p>
        </div>
      </div>
    </div>
  );
}
