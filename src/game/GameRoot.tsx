import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { DEFAULT_AUDIO_VOLUMES, type AudioVolumeSettings } from "./Audio";
import { PerfHUD } from "./PerfHUD";
import { Scene, type HitMarkerKind } from "./Scene";
import type { SniperRechamberState, WeaponKind } from "./Weapon";
import {
  DEFAULT_AIM_SENSITIVITY_SETTINGS,
  DEFAULT_CONTROL_BINDINGS,
  DEFAULT_HUD_OVERLAY_TOGGLES,
  DEFAULT_PERF_METRICS,
  DEFAULT_PLAYER_SNAPSHOT,
  type ControlBindings,
  type GameSettings,
  type HudOverlayToggles,
  type PerfMetrics,
  type PixelRatioScale,
  type PlayerSnapshot,
  type StressModeCount,
} from "./types";

const STRESS_STEPS: StressModeCount[] = [0, 50, 100, 200];
const PIXEL_RATIO_OPTIONS: PixelRatioScale[] = [0.75, 1, 1.25];

type PauseMenuTab = "practice" | "gameplay" | "audio" | "controls" | "graphics" | "hud";
type BindingKey = keyof ControlBindings;

type MenuTabOption = {
  id: PauseMenuTab;
  label: string;
  hint: string;
};

type BindingDefinition = {
  key: BindingKey;
  label: string;
  hint: string;
};

const MENU_TABS: MenuTabOption[] = [
  { id: "practice", label: "Practice", hint: "Range presets" },
  { id: "gameplay", label: "Gameplay", hint: "Look & ADS" },
  { id: "audio", label: "Audio", hint: "Mix levels" },
  { id: "controls", label: "Controls", hint: "Keybinds" },
  { id: "graphics", label: "Graphics", hint: "Render" },
  { id: "hud", label: "HUD", hint: "Panels" },
];

const BINDING_ROWS: BindingDefinition[] = [
  { key: "moveForward", label: "Move Forward", hint: "Walk forward" },
  { key: "moveBackward", label: "Move Backward", hint: "Backpedal" },
  { key: "moveLeft", label: "Move Left", hint: "Strafe left" },
  { key: "moveRight", label: "Move Right", hint: "Strafe right" },
  { key: "sprint", label: "Sprint", hint: "Hold to sprint" },
  { key: "jump", label: "Jump", hint: "Hop" },
  { key: "toggleView", label: "Toggle View", hint: "FPP / TPP" },
  { key: "shoulderLeft", label: "Shoulder Left", hint: "TPP shoulder" },
  { key: "shoulderRight", label: "Shoulder Right", hint: "TPP shoulder" },
  { key: "equipRifle", label: "Equip Rifle", hint: "Weapon slot" },
  { key: "equipSniper", label: "Equip Sniper", hint: "Weapon slot" },
  { key: "reset", label: "Reset Targets", hint: "Practice reset" },
  { key: "pickup", label: "Pickup", hint: "Pickup weapon" },
  { key: "drop", label: "Drop", hint: "Drop weapon" },
];

const OVERLAY_ROWS: Array<{ key: keyof HudOverlayToggles; label: string; hint: string }> = [
  { key: "practice", label: "Practice panel", hint: "Top-left range status" },
  { key: "controls", label: "Controls panel", hint: "Bottom-left shortcut list" },
  { key: "settings", label: "Settings panel", hint: "Bottom-right quick settings" },
  { key: "performance", label: "Performance panel", hint: "Top-right perf HUD" },
];

export function GameRoot() {
  const [settings, setSettings] = useState<GameSettings>({
    shadows: true,
    pixelRatioScale: 1,
    showR3fPerf: false,
    sensitivity: { ...DEFAULT_AIM_SENSITIVITY_SETTINGS },
    keybinds: { ...DEFAULT_CONTROL_BINDINGS },
  });
  const [hudPanels, setHudPanels] = useState<HudOverlayToggles>({ ...DEFAULT_HUD_OVERLAY_TOGGLES });
  const [menuTab, setMenuTab] = useState<PauseMenuTab>("gameplay");
  const [bindingCapture, setBindingCapture] = useState<BindingKey | null>(null);
  const [stressCount, setStressCount] = useState<StressModeCount>(0);
  const [audioVolumes, setAudioVolumes] = useState<AudioVolumeSettings>(DEFAULT_AUDIO_VOLUMES);
  const [perfMetrics, setPerfMetrics] = useState<PerfMetrics>(DEFAULT_PERF_METRICS);
  const [player, setPlayer] = useState<PlayerSnapshot>(DEFAULT_PLAYER_SNAPSHOT);
  const [weaponEquipped, setWeaponEquipped] = useState(true);
  const [activeWeapon, setActiveWeapon] = useState<WeaponKind>("rifle");
  const [sniperRechamber, setSniperRechamber] = useState<SniperRechamberState>({
    active: false,
    progress: 1,
    remainingMs: 0,
  });
  const [hitMarker, setHitMarker] = useState<{ until: number; kind: HitMarkerKind }>({
    until: 0,
    kind: "body",
  });
  const isPaused = !player.pointerLocked;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "KeyP" || event.repeat) {
        return;
      }

      setHudPanels((prev) => ({
        ...prev,
        performance: !prev.performance,
      }));
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!bindingCapture) {
      return;
    }

    const onCaptureKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      if (event.code === "Escape") {
        setBindingCapture(null);
        return;
      }

      setSettings((prev) => ({
        ...prev,
        keybinds: {
          ...prev.keybinds,
          [bindingCapture]: event.code,
        },
      }));
      setBindingCapture(null);
    };

    window.addEventListener("keydown", onCaptureKey, true);
    return () => window.removeEventListener("keydown", onCaptureKey, true);
  }, [bindingCapture]);

  useEffect(() => {
    if (!isPaused && bindingCapture) {
      setBindingCapture(null);
    }
  }, [bindingCapture, isPaused]);

  const hitMarkerVisible = hitMarker.until > performance.now();
  const stressLabel = stressCount === 0 ? "Off" : `${stressCount} boxes`;
  const lockLabel = player.pointerLocked ? "Live look mode" : "Paused / cursor shown";
  const crosshairStyle =
    activeWeapon === "sniper"
      ? ({
          ["--sniper-cycle-progress" as string]: `${sniperRechamber.progress}`,
        } as CSSProperties)
      : undefined;

  const playerSummary = useMemo(() => {
    return {
      x: player.x.toFixed(1),
      y: player.y.toFixed(1),
      z: player.z.toFixed(1),
      speed: player.speed.toFixed(2),
    };
  }, [player.speed, player.x, player.y, player.z]);

  const duplicateBindingCodes = useMemo(() => {
    const codeCounts = new Map<string, number>();
    for (const code of Object.values(settings.keybinds)) {
      codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
    }
    return new Set(
      [...codeCounts.entries()].filter(([, count]) => count > 1).map(([code]) => code),
    );
  }, [settings.keybinds]);

  const effectiveRifleAds = Math.round((settings.sensitivity.look * settings.sensitivity.rifleAds) / 100);
  const effectiveSniperAds = Math.round((settings.sensitivity.look * settings.sensitivity.sniperAds) / 100);
  const visibleOverlayCount = Object.values(hudPanels).filter(Boolean).length;

  const controlsPreview = useMemo(() => {
    const b = settings.keybinds;
    return [
      `${formatKeyCode(b.moveForward)}/${formatKeyCode(b.moveLeft)}/${formatKeyCode(b.moveBackward)}/${formatKeyCode(b.moveRight)} move`,
      `${formatKeyCode(b.sprint)} sprint`,
      `${formatKeyCode(b.jump)} jump`,
      `${formatKeyCode(b.toggleView)} FPP/TPP`,
      `${formatKeyCode(b.reset)} reset targets`,
      "Mouse look / fire / ADS",
      "P perf panel",
      "Esc pause",
    ];
  }, [settings.keybinds]);

  return (
    <div className={`app-shell ${isPaused ? "paused" : "playing"}`}>
      <Scene
        settings={settings}
        audioVolumes={audioVolumes}
        stressCount={stressCount}
        onPerfMetrics={setPerfMetrics}
        onPlayerSnapshot={setPlayer}
        onHitMarker={(kind) =>
          setHitMarker({
            kind,
            until: performance.now() + (kind === "kill" ? 170 : kind === "head" ? 120 : 90),
          })
        }
        onWeaponEquippedChange={setWeaponEquipped}
        onActiveWeaponChange={setActiveWeapon}
        onSniperRechamberChange={setSniperRechamber}
      />

      <div className="ui-overlay">
        {hudPanels.practice ? (
          <div className="corner-top-left panel tactical-panel practice-panel">
            <div className="panel-eyebrow">PindG / Practice Range</div>
            <div className="panel-title-row">
              <div className="brand-lockup" aria-label="PindG logo">
                <span className="brand-block">PIN</span>
                <span className="brand-mark">dG</span>
              </div>
              <div className="status-pill">
                <span className={`status-dot ${player.pointerLocked ? "locked" : ""}`} />
                <span>{lockLabel}</span>
              </div>
            </div>
            <dl className="stat-grid stat-grid-wide">
              <dt>Player</dt>
              <dd>
                {playerSummary.x}, {playerSummary.y}, {playerSummary.z}
              </dd>
              <dt>Speed</dt>
              <dd>{playerSummary.speed} u/s</dd>
              <dt>State</dt>
              <dd>
                {player.grounded
                  ? player.moving
                    ? player.sprinting
                      ? "Sprint"
                      : "Walk"
                    : "Idle"
                  : "Jump / Air"}
              </dd>
              <dt>Interact</dt>
              <dd>{player.canInteract ? "Pickup ready" : "-"}</dd>
              <dt>Weapon</dt>
              <dd>{weaponEquipped ? (activeWeapon === "sniper" ? "Sniper" : "Rifle") : "None"}</dd>
              <dt>Range Load</dt>
              <dd>{stressLabel}</dd>
            </dl>
          </div>
        ) : null}

        {hudPanels.performance ? (
          <div className="corner-top-right">
            <PerfHUD metrics={perfMetrics} visible />
          </div>
        ) : null}

        <div className="center-stack">
          {!isPaused ? (
            <div
              className={`crosshair ${activeWeapon === "sniper" ? "sniper" : "rifle"} ${
                activeWeapon === "sniper" && sniperRechamber.active ? "rechambering" : ""
              }`}
              style={crosshairStyle}
            >
              {activeWeapon === "sniper" ? (
                <div className={`crosshair-progress ${sniperRechamber.active ? "active" : ""}`} />
              ) : null}
            </div>
          ) : null}
          {!isPaused ? (
            <div className={`hit-marker ${hitMarkerVisible ? "visible" : ""} ${hitMarker.kind}`} />
          ) : null}

          {isPaused ? (
            <div className="pause-menu panel tactical-panel" role="dialog" aria-label="Pause menu">
              <div className="pause-shell">
                <aside className="pause-sidebar" aria-label="Menu sections">
                  <div className="pause-logo">
                    <div className="brand-lockup large" aria-hidden="true">
                      <span className="brand-block">PIN</span>
                      <span className="brand-mark">dG</span>
                    </div>
                    <p className="muted">Training lobby. Legacy bugs included at no extra cost.</p>
                  </div>
                  <div className="pause-status-card">
                    <div className="panel-eyebrow">Session</div>
                    <div className="pause-status-grid">
                      <span>Weapon</span>
                      <strong>{weaponEquipped ? activeWeapon : "unarmed"}</strong>
                      <span>Overlays</span>
                      <strong>{visibleOverlayCount} active</strong>
                      <span>Range load</span>
                      <strong>{stressLabel}</strong>
                    </div>
                  </div>
                  <div className="menu-tab-list" role="tablist" aria-label="Settings categories">
                    {MENU_TABS.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={menuTab === tab.id}
                        className={`menu-tab ${menuTab === tab.id ? "active" : ""}`}
                        onClick={() => {
                          setMenuTab(tab.id);
                          setBindingCapture(null);
                        }}
                      >
                        <span className="menu-tab-label">{tab.label}</span>
                        <span className="menu-tab-hint">{tab.hint}</span>
                      </button>
                    ))}
                  </div>
                  <div className="pause-footer-note muted">
                    Click anywhere in the scene to resume. <code>Esc</code> pauses.
                  </div>
                </aside>

                <section className="pause-content" role="tabpanel" aria-label={`${menuTab} settings`}>
                  <div className="pause-content-header">
                    <div>
                      <div className="panel-eyebrow">Paused Menu</div>
                      <h2>{menuTitle(menuTab)}</h2>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setBindingCapture(null)}
                      disabled={!bindingCapture}
                    >
                      Cancel capture
                    </button>
                  </div>

                  {menuTab === "practice" ? (
                    <div className="menu-sections">
                      <MenuSection title="Range Load" blurb="Stress mode scales target-box clutter and draw-call pain.">
                        <div className="segmented-row">
                          {STRESS_STEPS.map((value) => (
                            <button
                              key={value}
                              type="button"
                              className={`chip-btn ${stressCount === value ? "active" : ""}`}
                              onClick={() => setStressCount(value)}
                            >
                              {value === 0 ? "Off" : `${value} boxes`}
                            </button>
                          ))}
                        </div>
                        <p className="muted compact-note">
                          Reset targets uses your bound key: <code>{formatKeyCode(settings.keybinds.reset)}</code>
                        </p>
                      </MenuSection>

                      <MenuSection title="Combat Snapshot" blurb="Quick readout while you pretend this is a real lobby.">
                        <div className="metric-cards">
                          <MetricCard label="Weapon" value={weaponEquipped ? (activeWeapon === "sniper" ? "Sniper" : "Rifle") : "None"} />
                          <MetricCard label="Movement" value={player.moving ? (player.sprinting ? "Sprint" : "Walk") : "Idle"} />
                          <MetricCard label="Pointer" value={player.pointerLocked ? "Locked" : "Menu"} />
                          <MetricCard label="Interact" value={player.canInteract ? "Ready" : "None"} />
                        </div>
                      </MenuSection>

                      <MenuSection title="HUD Preset" blurb="Starting point for cleaner screen recording or debugging.">
                        <div className="preset-grid">
                          <button
                            type="button"
                            className="btn btn-wide"
                            onClick={() =>
                              setHudPanels({ practice: false, controls: false, settings: false, performance: true })
                            }
                          >
                            Perf Only
                          </button>
                          <button
                            type="button"
                            className="btn btn-wide"
                            onClick={() =>
                              setHudPanels({ practice: true, controls: true, settings: true, performance: true })
                            }
                          >
                            Show All Panels
                          </button>
                          <button
                            type="button"
                            className="btn btn-wide"
                            onClick={() =>
                              setHudPanels({ practice: false, controls: false, settings: false, performance: false })
                            }
                          >
                            Clean Screen
                          </button>
                        </div>
                      </MenuSection>
                    </div>
                  ) : null}

                  {menuTab === "gameplay" ? (
                    <div className="menu-sections">
                      <MenuSection
                        title="Look Sensitivity"
                        blurb="PUBG-style split: base camera sensitivity plus separate ADS multipliers for rifle and sniper."
                      >
                        <RangeField
                          label="Camera / Free Look"
                          value={settings.sensitivity.look}
                          min={20}
                          max={250}
                          step={1}
                          suffix="%"
                          onChange={(value) =>
                            setSettings((prev) => ({
                              ...prev,
                              sensitivity: { ...prev.sensitivity, look: value },
                            }))
                          }
                        />
                        <RangeField
                          label="Rifle ADS"
                          value={settings.sensitivity.rifleAds}
                          min={20}
                          max={200}
                          step={1}
                          suffix="%"
                          onChange={(value) =>
                            setSettings((prev) => ({
                              ...prev,
                              sensitivity: { ...prev.sensitivity, rifleAds: value },
                            }))
                          }
                        />
                        <RangeField
                          label="Sniper ADS"
                          value={settings.sensitivity.sniperAds}
                          min={15}
                          max={180}
                          step={1}
                          suffix="%"
                          onChange={(value) =>
                            setSettings((prev) => ({
                              ...prev,
                              sensitivity: { ...prev.sensitivity, sniperAds: value },
                            }))
                          }
                        />
                        <RangeField
                          label="Vertical Multiplier"
                          value={settings.sensitivity.vertical}
                          min={50}
                          max={200}
                          step={1}
                          suffix="%"
                          onChange={(value) =>
                            setSettings((prev) => ({
                              ...prev,
                              sensitivity: { ...prev.sensitivity, vertical: value },
                            }))
                          }
                        />
                        <div className="settings-chip-wrap">
                          <span className="pill-chip">Effective Rifle ADS: {effectiveRifleAds}%</span>
                          <span className="pill-chip">Effective Sniper ADS: {effectiveSniperAds}%</span>
                          <span className="pill-chip">Applies live while aiming</span>
                        </div>
                      </MenuSection>

                      <MenuSection title="View Defaults" blurb="Camera behavior is still keyboard/mouse only, but now the aim feel is configurable.">
                        <ul className="bullet-list muted">
                          <li>Hip-fire uses Camera / Free Look sensitivity.</li>
                          <li>Rifle ADS and Sniper ADS use separate multipliers.</li>
                          <li>Vertical multiplier lets you match recoil control preference.</li>
                        </ul>
                      </MenuSection>
                    </div>
                  ) : null}

                  {menuTab === "audio" ? (
                    <div className="menu-sections">
                      <MenuSection title="Volume Mixer" blurb="Separate sliders so footsteps don’t get buried under rifle spam.">
                        <VolumeSlider
                          label="Master"
                          value={audioVolumes.master}
                          onChange={(value) =>
                            setAudioVolumes((prev) => ({
                              ...prev,
                              master: value,
                            }))
                          }
                        />
                        <VolumeSlider
                          label="Gunshots"
                          value={audioVolumes.gunshot}
                          onChange={(value) =>
                            setAudioVolumes((prev) => ({
                              ...prev,
                              gunshot: value,
                            }))
                          }
                        />
                        <VolumeSlider
                          label="Footsteps"
                          value={audioVolumes.footsteps}
                          onChange={(value) =>
                            setAudioVolumes((prev) => ({
                              ...prev,
                              footsteps: value,
                            }))
                          }
                        />
                        <VolumeSlider
                          label="Hit / Kill"
                          value={audioVolumes.hit}
                          onChange={(value) =>
                            setAudioVolumes((prev) => ({
                              ...prev,
                              hit: value,
                            }))
                          }
                        />
                      </MenuSection>
                    </div>
                  ) : null}

                  {menuTab === "controls" ? (
                    <div className="menu-sections">
                      <MenuSection title="Keyboard Shortcuts" blurb="Click a row, press a key. Escape cancels capture.">
                        <div className="keybind-grid">
                          {BINDING_ROWS.map((row) => {
                            const code = settings.keybinds[row.key];
                            const duplicated = duplicateBindingCodes.has(code);
                            return (
                              <div
                                key={row.key}
                                className={`keybind-row ${bindingCapture === row.key ? "capturing" : ""} ${duplicated ? "duplicate" : ""}`}
                              >
                                <div>
                                  <div className="keybind-label">{row.label}</div>
                                  <div className="keybind-hint">{row.hint}</div>
                                </div>
                                <button
                                  type="button"
                                  className={`keybind-btn ${bindingCapture === row.key ? "active" : ""}`}
                                  onClick={() => setBindingCapture((prev) => (prev === row.key ? null : row.key))}
                                >
                                  {bindingCapture === row.key ? "Press key..." : formatKeyCode(code)}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        <div className="settings-chip-wrap">
                          <span className="pill-chip">Mouse Left: Fire (fixed)</span>
                          <span className="pill-chip">Mouse Right: ADS (fixed)</span>
                          <span className="pill-chip">P: Perf panel toggle (global)</span>
                        </div>
                        {duplicateBindingCodes.size > 0 ? (
                          <p className="warning-note">
                            Duplicate keys are allowed, but you are volunteering for weirdness.
                          </p>
                        ) : null}
                      </MenuSection>
                    </div>
                  ) : null}

                  {menuTab === "graphics" ? (
                    <div className="menu-sections">
                      <MenuSection title="Render Quality" blurb="Enough knobs to tune performance without pretending this is a benchmark suite.">
                        <SwitchRow
                          label="Shadows"
                          hint="Sun shadow maps for scene and targets"
                          checked={settings.shadows}
                          onChange={(checked) =>
                            setSettings((prev) => ({
                              ...prev,
                              shadows: checked,
                            }))
                          }
                        />
                        <SwitchRow
                          label="r3f-perf Overlay"
                          hint="Developer perf overlay (separate from PindG perf panel)"
                          checked={settings.showR3fPerf}
                          onChange={(checked) =>
                            setSettings((prev) => ({
                              ...prev,
                              showR3fPerf: checked,
                            }))
                          }
                        />
                        <div className="field-row">
                          <div>
                            <div className="field-label">Pixel Ratio</div>
                            <div className="field-hint">Render scale multiplier</div>
                          </div>
                          <div className="segmented-row compact">
                            {PIXEL_RATIO_OPTIONS.map((option) => (
                              <button
                                key={option}
                                type="button"
                                className={`chip-btn ${settings.pixelRatioScale === option ? "active" : ""}`}
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
                        </div>
                      </MenuSection>
                    </div>
                  ) : null}

                  {menuTab === "hud" ? (
                    <div className="menu-sections">
                      <MenuSection title="Overlay Panels" blurb="Toggle the old debug panels individually. Default preset is perf-only.">
                        {OVERLAY_ROWS.map((row) => (
                          <SwitchRow
                            key={row.key}
                            label={row.label}
                            hint={row.hint}
                            checked={hudPanels[row.key]}
                            onChange={(checked) =>
                              setHudPanels((prev) => ({
                                ...prev,
                                [row.key]: checked,
                              }))
                            }
                          />
                        ))}
                        <p className="muted compact-note">
                          Crosshair and hit markers stay visible during gameplay. This tab only controls the corner panels.
                        </p>
                      </MenuSection>
                    </div>
                  ) : null}
                </section>
              </div>
            </div>
          ) : null}
        </div>

        {hudPanels.controls ? (
          <div className="corner-bottom-left panel tactical-panel compact-panel">
            <div className="panel-eyebrow">Controls</div>
            <h2>Quick Reference</h2>
            <ul className="control-list">
              {controlsPreview.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {hudPanels.settings ? (
          <div className="corner-bottom-right panel tactical-panel compact-panel">
            <div className="panel-eyebrow">Settings Snapshot</div>
            <h2>Tactical Console</h2>
            <div className="quick-settings-stack">
              <SwitchRow
                label="Shadows"
                hint="World shadows"
                checked={settings.shadows}
                onChange={(checked) =>
                  setSettings((prev) => ({
                    ...prev,
                    shadows: checked,
                  }))
                }
              />
              <SwitchRow
                label="Perf Panel"
                hint="Top-right perf HUD"
                checked={hudPanels.performance}
                onChange={(checked) =>
                  setHudPanels((prev) => ({
                    ...prev,
                    performance: checked,
                  }))
                }
              />
              <div className="field-row">
                <div>
                  <div className="field-label">Pixel Ratio</div>
                  <div className="field-hint">Render scale</div>
                </div>
                <div className="segmented-row compact">
                  {PIXEL_RATIO_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`chip-btn ${settings.pixelRatioScale === option ? "active" : ""}`}
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
              </div>
              <div className="field-row">
                <div>
                  <div className="field-label">Stress Mode</div>
                  <div className="field-hint">Range clutter</div>
                </div>
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
          </div>
        ) : null}
      </div>
    </div>
  );
}

type MenuSectionProps = {
  title: string;
  blurb?: string;
  children: React.ReactNode;
};

function MenuSection({ title, blurb, children }: MenuSectionProps) {
  return (
    <section className="menu-section">
      <header className="menu-section-header">
        <h3>{title}</h3>
        {blurb ? <p className="muted">{blurb}</p> : null}
      </header>
      <div className="menu-section-body">{children}</div>
    </section>
  );
}

type MetricCardProps = {
  label: string;
  value: string;
};

function MetricCard({ label, value }: MetricCardProps) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

type SwitchRowProps = {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

function SwitchRow({ label, hint, checked, onChange }: SwitchRowProps) {
  return (
    <label className="switch-row">
      <span>
        <span className="field-label">{label}</span>
        <span className="field-hint">{hint}</span>
      </span>
      <span className="switch-shell">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span className="switch-track" aria-hidden="true">
          <span className="switch-thumb" />
        </span>
      </span>
    </label>
  );
}

type RangeFieldProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
};

function RangeField({ label, value, min, max, step, suffix, onChange }: RangeFieldProps) {
  return (
    <div className="range-field">
      <div className="range-label-row">
        <span className="field-label">{label}</span>
        <span className="range-value">
          {value}
          {suffix ?? ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </div>
  );
}

type VolumeSliderProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
};

function VolumeSlider({ label, value, onChange }: VolumeSliderProps) {
  return (
    <div className="range-field volume-field">
      <div className="range-label-row">
        <span className="field-label">{label}</span>
        <span className="range-value">{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </div>
  );
}

function menuTitle(tab: PauseMenuTab) {
  switch (tab) {
    case "practice":
      return "Practice Menu";
    case "gameplay":
      return "Gameplay Settings";
    case "audio":
      return "Audio Settings";
    case "controls":
      return "Control Settings";
    case "graphics":
      return "Graphics Settings";
    case "hud":
      return "HUD Settings";
    default:
      return "Settings";
  }
}

function formatKeyCode(code: string) {
  if (code.startsWith("Key")) return code.slice(3).toUpperCase();
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "Space") return "Space";
  if (code === "ShiftLeft") return "L-Shift";
  if (code === "ShiftRight") return "R-Shift";
  if (code === "ControlLeft") return "L-Ctrl";
  if (code === "ControlRight") return "R-Ctrl";
  if (code === "AltLeft") return "L-Alt";
  if (code === "AltRight") return "R-Alt";
  if (code.startsWith("Arrow")) return code.slice(5);
  return code;
}
