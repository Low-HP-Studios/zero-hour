import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type AudioVolumeSettings } from "./Audio";
import { PerfHUD } from "./PerfHUD";
import {
  type AimingState,
  type HitMarkerKind,
  Scene,
} from "./scene/SceneCanvas";
import {
  MenuSection,
  MetricCard,
  SwitchRow,
  RangeField,
  VolumeSlider,
  formatKeyCode,
  menuTitle,
} from "./SettingsPanels";
import type { SniperRechamberState, WeaponKind } from "./Weapon";
import {
  DEFAULT_PERF_METRICS,
  DEFAULT_PLAYER_SNAPSHOT,
  DEFAULT_WEAPON_ALIGNMENT,
  type GameSettings,
  type HudOverlayToggles,
  type PerfMetrics,
  type PlayerSnapshot,
  type StressModeCount,
} from "./types";
import {
  type BindingKey,
  type PauseMenuTab,
  STRESS_STEPS,
  PIXEL_RATIO_OPTIONS,
  MENU_TABS,
  BINDING_ROWS,
  OVERLAY_ROWS,
  loadPersistedSettings,
  savePersistedSettings,
} from "./settings";

const DEFAULT_UPDATER_STATUS: UpdaterStatusPayload = {
  phase: "idle",
  currentVersion: "dev",
  message: "Updater is idle.",
};

interface GameRootProps {
  onReturnToLobby?: () => void;
}

export function GameRoot({ onReturnToLobby }: GameRootProps) {
  const persistedSettings = useMemo(loadPersistedSettings, []);
  const [settings, setSettings] = useState<GameSettings>(
    persistedSettings.settings,
  );
  const [hudPanels, setHudPanels] = useState<HudOverlayToggles>(
    persistedSettings.hudPanels,
  );
  const [menuTab, setMenuTab] = useState<PauseMenuTab>("gameplay");
  const [bindingCapture, setBindingCapture] = useState<BindingKey | null>(null);
  const [stressCount, setStressCount] = useState<StressModeCount>(
    persistedSettings.stressCount,
  );
  const [audioVolumes, setAudioVolumes] = useState<AudioVolumeSettings>(
    persistedSettings.audioVolumes,
  );
  const [perfMetrics, setPerfMetrics] = useState<PerfMetrics>(
    DEFAULT_PERF_METRICS,
  );
  const [player, setPlayerRaw] = useState<PlayerSnapshot>(
    DEFAULT_PLAYER_SNAPSHOT,
  );
  const playerRef = useRef(player);
  const setPlayer = useCallback((snapshot: PlayerSnapshot) => {
    const prev = playerRef.current;
    if (
      prev.x === snapshot.x &&
      prev.y === snapshot.y &&
      prev.z === snapshot.z &&
      prev.speed === snapshot.speed &&
      prev.grounded === snapshot.grounded &&
      prev.moving === snapshot.moving &&
      prev.sprinting === snapshot.sprinting &&
      prev.pointerLocked === snapshot.pointerLocked &&
      prev.canInteract === snapshot.canInteract
    ) {
      return;
    }
    playerRef.current = snapshot;
    setPlayerRaw(snapshot);
  }, []);
  const [weaponEquipped, setWeaponEquipped] = useState(true);
  const [activeWeapon, setActiveWeapon] = useState<WeaponKind>("rifle");
  const [sniperRechamber, setSniperRechamber] = useState<SniperRechamberState>({
    active: false,
    progress: 1,
    remainingMs: 0,
  });
  const [aimingState, setAimingState] = useState<AimingState>({
    ads: false,
    firstPerson: false,
  });
  const [resumePointerLockRequestId, setResumePointerLockRequestId] = useState(
    0,
  );
  const [hitMarker, setHitMarker] = useState<
    { until: number; kind: HitMarkerKind }
  >({
    until: 0,
    kind: "body",
  });
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatusPayload>(
    DEFAULT_UPDATER_STATUS,
  );
  const [updaterBusyAction, setUpdaterBusyAction] = useState<
    "check" | "install" | "repair" | null
  >(null);
  const updaterApi = window.electronAPI?.updater;
  const updaterAvailable = Boolean(updaterApi);
  const isPaused = !player.pointerLocked;
  const [hasBeenLocked, setHasBeenLocked] = useState(false);

  useEffect(() => {
    if (player.pointerLocked && !hasBeenLocked) {
      setHasBeenLocked(true);
    }
  }, [player.pointerLocked, hasBeenLocked]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const canvas = document.querySelector(".game-canvas");
        if (canvas instanceof HTMLCanvasElement) {
          const result = canvas.requestPointerLock();
          if (result && typeof result.then === "function") {
            void result.catch(() => {});
          }
        }
      } catch {}
      setResumePointerLockRequestId(1);
    }, 200);
    return () => clearTimeout(timer);
  }, []);

  const showPauseMenu = hasBeenLocked && isPaused;

  const handleCloseMenuAndResume = useCallback(() => {
    setBindingCapture(null);
    const canvas = document.querySelector(".game-canvas");
    if (canvas instanceof HTMLCanvasElement) {
      try {
        const result = canvas.requestPointerLock();
        if (result && typeof result.then === "function") {
          void result.catch(() => {});
        }
      } catch {
        // Controller fallback path below handles Tauri/broken pointer-lock scenarios.
      }
    }
    setResumePointerLockRequestId((previous) => previous + 1);
  }, []);

  const handleHitMarker = useCallback((kind: HitMarkerKind) => {
    setHitMarker({
      kind,
      until: performance.now() +
        (kind === "kill" ? 170 : kind === "head" ? 120 : 90),
    });
  }, []);

  useEffect(() => {
    if (!updaterApi) {
      return;
    }

    let mounted = true;
    const unsubscribe = updaterApi.onStatus((status: UpdaterStatusPayload) => {
      if (!mounted) {
        return;
      }
      setUpdaterStatus(status);
    });

    void updaterApi.getStatus()
      .then((status: UpdaterStatusPayload) => {
        if (!mounted) {
          return;
        }
        setUpdaterStatus(status);
      })
      .catch((error: unknown) => {
        if (!mounted) {
          return;
        }
        setUpdaterStatus((prev) => ({
          ...prev,
          phase: "error",
          message: `Updater unavailable: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        }));
      });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [updaterApi]);

  const handleCheckForUpdates = useCallback(async () => {
    if (!updaterApi) {
      return;
    }

    setUpdaterBusyAction("check");
    try {
      await updaterApi.check();
    } finally {
      setUpdaterBusyAction(null);
    }
  }, [updaterApi]);

  const handleInstallUpdate = useCallback(async () => {
    if (!updaterApi) {
      return;
    }

    setUpdaterBusyAction("install");
    try {
      await updaterApi.installNow();
    } finally {
      setUpdaterBusyAction(null);
    }
  }, [updaterApi]);

  const handleRepairInstall = useCallback(async () => {
    if (!updaterApi) {
      return;
    }

    setUpdaterBusyAction("repair");
    try {
      await updaterApi.repair();
    } finally {
      setUpdaterBusyAction(null);
    }
  }, [updaterApi]);

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
    savePersistedSettings({
      settings,
      hudPanels,
      stressCount,
      audioVolumes,
    });
  }, [settings, hudPanels, stressCount, audioVolumes]);

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
  const sniperScopeActive = activeWeapon === "sniper" && aimingState.ads &&
    !isPaused;
  const rifleScopeActive = activeWeapon === "rifle" && aimingState.ads &&
    !isPaused;
  const stressLabel = stressCount === 0 ? "Off" : `${stressCount} boxes`;
  const lockLabel = player.pointerLocked
    ? "Live look mode"
    : "Paused / cursor shown";
  const crosshairStyle =
    activeWeapon === "sniper" && (sniperRechamber.active || sniperScopeActive)
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
      [...codeCounts.entries()].filter(([, count]) => count > 1).map(([code]) =>
        code
      ),
    );
  }, [settings.keybinds]);

  const effectiveRifleAds =
    (settings.sensitivity.look * settings.sensitivity.rifleAds).toFixed(2);
  const effectiveSniperAds =
    (settings.sensitivity.look * settings.sensitivity.sniperAds).toFixed(2);

  const controlsPreview = useMemo(() => {
    const b = settings.keybinds;
    return [
      `${formatKeyCode(b.moveForward)}/${formatKeyCode(b.moveLeft)}/${
        formatKeyCode(b.moveBackward)
      }/${formatKeyCode(b.moveRight)} move`,
      `${formatKeyCode(b.sprint)} sprint`,
      `${formatKeyCode(b.jump)} jump`,
      `${formatKeyCode(b.toggleView)} FPP/TPP`,
      `${formatKeyCode(b.reset)} reset targets`,
      "Mouse look / fire / ADS",
      "P perf panel",
      "Esc pause",
    ];
  }, [settings.keybinds]);
  const updaterPhaseLabel = formatUpdaterPhase(updaterStatus.phase);
  const updaterPhaseClass = updaterStatus.phase === "error"
    ? "error"
    : updaterStatus.phase === "downloaded"
    ? "ok"
    : updaterStatus.phase === "downloading" ||
        updaterStatus.phase === "checking"
    ? "warn"
    : "idle";
  const canInstallUpdate = updaterStatus.phase === "downloaded";
  const downloaderProgressLabel = updaterStatus.phase === "downloading" &&
      typeof updaterStatus.progress === "number"
    ? `${updaterStatus.progress}%`
    : null;

  return (
    <div className={`app-shell ${isPaused ? "paused" : "playing"}`}>
      <Scene
        settings={settings}
        audioVolumes={audioVolumes}
        stressCount={stressCount}
        resumePointerLockRequestId={resumePointerLockRequestId}
        onPerfMetrics={setPerfMetrics}
        onPlayerSnapshot={setPlayer}
        onHitMarker={handleHitMarker}
        onWeaponEquippedChange={setWeaponEquipped}
        onActiveWeaponChange={setActiveWeapon}
        onSniperRechamberChange={setSniperRechamber}
        onAimingStateChange={setAimingState}
      />

      <div className="ui-overlay">
        {hudPanels.practice
          ? (
            <div className="corner-top-left panel tactical-panel practice-panel">
              <div className="panel-eyebrow">GreyTrace / Practice Range</div>
              <div className="panel-title-row">
                <div className="brand-lockup" aria-label="GreyTrace logo">
                  <span className="brand-word">GreyTrace</span>
                </div>
                <div className="status-pill">
                  <span
                    className={`status-dot ${
                      player.pointerLocked ? "locked" : ""
                    }`}
                  />
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
                      ? player.sprinting ? "Sprint" : "Walk"
                      : "Idle"
                    : "Jump / Air"}
                </dd>
                <dt>Interact</dt>
                <dd>{player.canInteract ? "Pickup ready" : "-"}</dd>
                <dt>Weapon</dt>
                <dd>
                  {weaponEquipped
                    ? (activeWeapon === "sniper" ? "Sniper" : "Rifle")
                    : "None"}
                </dd>
                <dt>Range Load</dt>
                <dd>{stressLabel}</dd>
              </dl>
            </div>
          )
          : null}

        {hudPanels.performance
          ? (
            <div className="corner-top-right">
              <PerfHUD metrics={perfMetrics} visible />
            </div>
          )
          : null}

        <div className="center-stack">
          {!isPaused && !sniperScopeActive && !rifleScopeActive
            ? (
              <div
                className={`crosshair ${
                  activeWeapon === "sniper" ? "sniper-hip" : "rifle"
                } ${
                  activeWeapon === "sniper" && sniperRechamber.active
                    ? "rechambering"
                    : ""
                }`}
                style={crosshairStyle}
              >
                {activeWeapon === "sniper"
                  ? (
                    <div className="sniper-hip-lines" aria-hidden="true">
                      <span className="line top" />
                      <span className="line right" />
                      <span className="line bottom" />
                      <span className="line left" />
                    </div>
                  )
                  : null}
                {activeWeapon === "sniper" && sniperRechamber.active
                  ? (
                    <div
                      className={`crosshair-progress ${
                        sniperRechamber.active ? "active" : ""
                      }`}
                    />
                  )
                  : null}
              </div>
            )
            : null}
          {rifleScopeActive
            ? (
              <div className="rifle-ads-overlay">
                <div className="rifle-ads-ring" />
                <div className="rifle-ads-dot" />
              </div>
            )
            : null}
          {sniperScopeActive
            ? (
              <div className="sniper-scope-overlay" style={crosshairStyle}>
                <div className="scope-outside" />
                <div className="scope-lens">
                  <div className="scope-reticle">
                    <span className="scope-line vertical" />
                    <span className="scope-line horizontal" />
                    <span className="scope-center-dot" />
                    <span className="scope-hash hash-1" />
                    <span className="scope-hash hash-2" />
                    <span className="scope-hash hash-3" />
                    {sniperRechamber.active
                      ? <span className="scope-rechamber" />
                      : null}
                  </div>
                </div>
              </div>
            )
            : null}
          {!isPaused
            ? (
              <div
                className={`hit-marker ${
                  hitMarkerVisible ? "visible" : ""
                } ${hitMarker.kind}`}
              />
            )
            : null}

          {showPauseMenu
            ? (
              <div
                className="lobby-settings-overlay"
                style={{ background: "rgba(5, 5, 5, 0.95)" }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div
                  className="lobby-settings-modal"
                  role="dialog"
                  aria-label="Pause menu"
                >
                  <div className="lobby-settings-header">
                    <h2>{menuTitle(menuTab)}</h2>
                    <button
                      type="button"
                      className="lobby-settings-close"
                      aria-label="Resume game"
                      onClick={handleCloseMenuAndResume}
                    >
                      ×
                    </button>
                  </div>
                  <div className="lobby-settings-body">
                    <aside className="lobby-settings-sidebar">
                      {MENU_TABS.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          aria-selected={menuTab === tab.id}
                          className={`lobby-settings-tab ${
                            menuTab === tab.id ? "active" : ""
                          }`}
                          onClick={() => {
                            setMenuTab(tab.id);
                            setBindingCapture(null);
                          }}
                        >
                          {tab.label}
                        </button>
                      ))}
                      <div style={{ flex: 1 }} />
                      <button
                        type="button"
                        className="lobby-settings-tab"
                        onClick={handleCloseMenuAndResume}
                      >
                        Resume
                      </button>
                      {onReturnToLobby && (
                        <button
                          type="button"
                          className="btn-lobby-return"
                          onClick={onReturnToLobby}
                        >
                          Return to Lobby
                        </button>
                      )}
                    </aside>
                    <section className="lobby-settings-content">

                    {menuTab === "practice"
                      ? (
                        <div className="menu-sections">
                          <MenuSection
                            title="Range Load"
                            blurb="Stress mode scales target-box clutter and draw-call pain."
                          >
                            <div className="segmented-row">
                              {STRESS_STEPS.map((value) => (
                                <button
                                  key={value}
                                  type="button"
                                  className={`chip-btn ${
                                    stressCount === value ? "active" : ""
                                  }`}
                                  onClick={() => setStressCount(value)}
                                >
                                  {value === 0 ? "Off" : `${value} boxes`}
                                </button>
                              ))}
                            </div>
                            <p className="muted compact-note">
                              Reset targets uses your bound key:{" "}
                              <code>
                                {formatKeyCode(settings.keybinds.reset)}
                              </code>
                            </p>
                          </MenuSection>

                          <MenuSection
                            title="Combat Snapshot"
                            blurb="Quick readout while you pretend this is a real lobby."
                          >
                            <div className="metric-cards">
                              <MetricCard
                                label="Weapon"
                                value={weaponEquipped
                                  ? (activeWeapon === "sniper"
                                    ? "Sniper"
                                    : "Rifle")
                                  : "None"}
                              />
                              <MetricCard
                                label="Movement"
                                value={player.moving
                                  ? (player.sprinting ? "Sprint" : "Walk")
                                  : "Idle"}
                              />
                              <MetricCard
                                label="Pointer"
                                value={player.pointerLocked ? "Locked" : "Menu"}
                              />
                              <MetricCard
                                label="Interact"
                                value={player.canInteract ? "Ready" : "None"}
                              />
                            </div>
                          </MenuSection>

                          <MenuSection
                            title="HUD Preset"
                            blurb="Starting point for cleaner screen recording or debugging."
                          >
                            <div className="preset-grid">
                              <button
                                type="button"
                                className="btn btn-wide"
                                onClick={() =>
                                  setHudPanels({
                                    practice: false,
                                    controls: false,
                                    settings: false,
                                    performance: true,
                                  })}
                              >
                                Perf Only
                              </button>
                              <button
                                type="button"
                                className="btn btn-wide"
                                onClick={() =>
                                  setHudPanels({
                                    practice: true,
                                    controls: true,
                                    settings: true,
                                    performance: true,
                                  })}
                              >
                                Show All Panels
                              </button>
                              <button
                                type="button"
                                className="btn btn-wide"
                                onClick={() =>
                                  setHudPanels({
                                    practice: false,
                                    controls: false,
                                    settings: false,
                                    performance: false,
                                  })}
                              >
                                Clean Screen
                              </button>
                            </div>
                          </MenuSection>
                        </div>
                      )
                      : null}

                    {menuTab === "gameplay"
                      ? (
                        <div className="menu-sections">
                          <MenuSection
                            title="Look Sensitivity"
                            blurb="Valorant-style decimals: lower = slower. Great for high-DPI mice."
                          >
                            <RangeField
                              label="Camera / Free Look"
                              value={settings.sensitivity.look}
                              min={0.05}
                              max={3}
                              step={0.01}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  sensitivity: {
                                    ...prev.sensitivity,
                                    look: value,
                                  },
                                }))}
                            />
                            <RangeField
                              label="Rifle ADS"
                              value={settings.sensitivity.rifleAds}
                              min={0.05}
                              max={2.5}
                              step={0.01}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  sensitivity: {
                                    ...prev.sensitivity,
                                    rifleAds: value,
                                  },
                                }))}
                            />
                            <RangeField
                              label="Sniper ADS"
                              value={settings.sensitivity.sniperAds}
                              min={0.05}
                              max={2}
                              step={0.01}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  sensitivity: {
                                    ...prev.sensitivity,
                                    sniperAds: value,
                                  },
                                }))}
                            />
                            <RangeField
                              label="Vertical Multiplier"
                              value={settings.sensitivity.vertical}
                              min={0.3}
                              max={2}
                              step={0.01}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  sensitivity: {
                                    ...prev.sensitivity,
                                    vertical: value,
                                  },
                                }))}
                            />
                            <div className="settings-chip-wrap">
                              <span className="pill-chip">
                                Effective Rifle ADS: {effectiveRifleAds}
                              </span>
                              <span className="pill-chip">
                                Effective Sniper ADS: {effectiveSniperAds}
                              </span>
                              <span className="pill-chip">
                                Applies live while aiming
                              </span>
                            </div>
                          </MenuSection>

                          <MenuSection
                            title="Field of View"
                            blurb="PUBG-style FOV: wider = more peripheral vision but smaller targets. Applies to both FPP and TPP."
                          >
                            <RangeField
                              label="Base FOV"
                              value={settings.fov}
                              min={40}
                              max={120}
                              step={1}
                              suffix="°"
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  fov: value,
                                }))}
                            />
                            <div className="settings-chip-wrap">
                              <span className="pill-chip">
                                Low (40-55): Zoomed, sniper-friendly
                              </span>
                              <span className="pill-chip">
                                Normal (60-75): Balanced
                              </span>
                              <span className="pill-chip">
                                Wide (80-120): Max awareness
                              </span>
                            </div>
                          </MenuSection>

                          <MenuSection
                            title="Weapon Alignment (Debug)"
                            blurb="Tweak weapon position and rotation on the hand bone. Values are saved. Hit Reset to start over."
                          >
                            <RangeField
                              label="Offset X (left/right)"
                              value={settings.weaponAlignment.posX}
                              min={-0.5}
                              max={0.5}
                              step={0.005}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  weaponAlignment: {
                                    ...prev.weaponAlignment,
                                    posX: value,
                                  },
                                }))}
                            />
                            <RangeField
                              label="Offset Y (up/down)"
                              value={settings.weaponAlignment.posY}
                              min={-0.5}
                              max={0.5}
                              step={0.005}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  weaponAlignment: {
                                    ...prev.weaponAlignment,
                                    posY: value,
                                  },
                                }))}
                            />
                            <RangeField
                              label="Offset Z (forward/back)"
                              value={settings.weaponAlignment.posZ}
                              min={-0.5}
                              max={0.5}
                              step={0.005}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  weaponAlignment: {
                                    ...prev.weaponAlignment,
                                    posZ: value,
                                  },
                                }))}
                            />
                            <RangeField
                              label="Rotation X (pitch)"
                              value={settings.weaponAlignment.rotX}
                              min={-3.14}
                              max={3.14}
                              step={0.01}
                              suffix=" rad"
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  weaponAlignment: {
                                    ...prev.weaponAlignment,
                                    rotX: value,
                                  },
                                }))}
                            />
                            <RangeField
                              label="Rotation Y (yaw)"
                              value={settings.weaponAlignment.rotY}
                              min={-3.14}
                              max={3.14}
                              step={0.01}
                              suffix=" rad"
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  weaponAlignment: {
                                    ...prev.weaponAlignment,
                                    rotY: value,
                                  },
                                }))}
                            />
                            <RangeField
                              label="Rotation Z (roll)"
                              value={settings.weaponAlignment.rotZ}
                              min={-3.14}
                              max={3.14}
                              step={0.01}
                              suffix=" rad"
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  weaponAlignment: {
                                    ...prev.weaponAlignment,
                                    rotZ: value,
                                  },
                                }))}
                            />
                            <div className="settings-chip-wrap">
                              <button
                                type="button"
                                className="btn"
                                onClick={() =>
                                  setSettings((prev) => ({
                                    ...prev,
                                    weaponAlignment: {
                                      ...DEFAULT_WEAPON_ALIGNMENT,
                                    },
                                  }))}
                              >
                                Reset Alignment
                              </button>
                            </div>
                          </MenuSection>
                        </div>
                      )
                      : null}

                    {menuTab === "audio"
                      ? (
                        <div className="menu-sections">
                          <MenuSection
                            title="Volume Mixer"
                            blurb="Separate sliders so footsteps don’t get buried under rifle spam."
                          >
                            <VolumeSlider
                              label="Master"
                              value={audioVolumes.master}
                              onChange={(value) =>
                                setAudioVolumes((prev) => ({
                                  ...prev,
                                  master: value,
                                }))}
                            />
                            <VolumeSlider
                              label="Gunshots"
                              value={audioVolumes.gunshot}
                              onChange={(value) =>
                                setAudioVolumes((prev) => ({
                                  ...prev,
                                  gunshot: value,
                                }))}
                            />
                            <VolumeSlider
                              label="Footsteps"
                              value={audioVolumes.footsteps}
                              onChange={(value) =>
                                setAudioVolumes((prev) => ({
                                  ...prev,
                                  footsteps: value,
                                }))}
                            />
                            <VolumeSlider
                              label="Hit / Kill"
                              value={audioVolumes.hit}
                              onChange={(value) =>
                                setAudioVolumes((prev) => ({
                                  ...prev,
                                  hit: value,
                                }))}
                            />
                          </MenuSection>
                        </div>
                      )
                      : null}

                    {menuTab === "controls"
                      ? (
                        <div className="menu-sections">
                          <MenuSection
                            title="Keyboard Shortcuts"
                            blurb="Click a row, press a key. Escape cancels capture."
                          >
                            <div className="keybind-grid">
                              {BINDING_ROWS.map((row) => {
                                const code = settings.keybinds[row.key];
                                const duplicated = duplicateBindingCodes.has(
                                  code,
                                );
                                return (
                                  <div
                                    key={row.key}
                                    className={`keybind-row ${
                                      bindingCapture === row.key
                                        ? "capturing"
                                        : ""
                                    } ${duplicated ? "duplicate" : ""}`}
                                  >
                                    <div>
                                      <div className="keybind-label">
                                        {row.label}
                                      </div>
                                      <div className="keybind-hint">
                                        {row.hint}
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      className={`keybind-btn ${
                                        bindingCapture === row.key
                                          ? "active"
                                          : ""
                                      }`}
                                      onClick={() =>
                                        setBindingCapture((
                                          prev,
                                        ) => (prev === row.key
                                          ? null
                                          : row.key)
                                        )}
                                    >
                                      {bindingCapture === row.key
                                        ? "Press key..."
                                        : formatKeyCode(code)}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="settings-chip-wrap">
                              <span className="pill-chip">
                                Mouse Left: Fire (fixed)
                              </span>
                              <span className="pill-chip">
                                Mouse Right: ADS (fixed)
                              </span>
                              <span className="pill-chip">
                                P: Perf panel toggle (global)
                              </span>
                            </div>
                            {duplicateBindingCodes.size > 0
                              ? (
                                <p className="warning-note">
                                  Duplicate keys are allowed, but you are
                                  volunteering for weirdness.
                                </p>
                              )
                              : null}
                          </MenuSection>
                        </div>
                      )
                      : null}

                    {menuTab === "graphics"
                      ? (
                        <div className="menu-sections">
                          <MenuSection
                            title="Render Quality"
                            blurb="Enough knobs to tune performance without pretending this is a benchmark suite."
                          >
                            <SwitchRow
                              label="Shadows"
                              hint="Sun shadow maps for scene and targets"
                              checked={settings.shadows}
                              onChange={(checked) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  shadows: checked,
                                }))}
                            />
                            <SwitchRow
                              label="r3f-perf Overlay"
                              hint="Developer perf overlay (separate from GreyTrace perf panel)"
                              checked={settings.showR3fPerf}
                              onChange={(checked) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  showR3fPerf: checked,
                                }))}
                            />
                            <div className="field-row">
                              <div>
                                <div className="field-label">Pixel Ratio</div>
                                <div className="field-hint">
                                  Render scale multiplier
                                </div>
                              </div>
                              <div className="segmented-row compact">
                                {PIXEL_RATIO_OPTIONS.map((option) => (
                                  <button
                                    key={option.value}
                                    type="button"
                                    className={`chip-btn ${
                                      settings.pixelRatioScale === option.value
                                        ? "active"
                                        : ""
                                    }`}
                                    onClick={() =>
                                      setSettings((prev) => ({
                                        ...prev,
                                        pixelRatioScale: option.value,
                                      }))}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </MenuSection>
                        </div>
                      )
                      : null}

                    {menuTab === "hud"
                      ? (
                        <div className="menu-sections">
                          <MenuSection
                            title="Overlay Panels"
                            blurb="Toggle the old debug panels individually. Default preset is perf-only."
                          >
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
                                  }))}
                              />
                            ))}
                            <p className="muted compact-note">
                              Crosshair and hit markers stay visible during
                              gameplay. This tab only controls the corner
                              panels.
                            </p>
                          </MenuSection>
                        </div>
                      )
                      : null}

                    {menuTab === "updates"
                      ? (
                        <div className="menu-sections">
                          <MenuSection
                            title="Version Status"
                            blurb="Discord-style background updater, but with fewer corporate layers."
                          >
                            <div className="update-summary-grid">
                              <div className="metric-card">
                                <span>Current build</span>
                                <strong>{updaterStatus.currentVersion}</strong>
                              </div>
                              <div className="metric-card">
                                <span>Latest known</span>
                                <strong>
                                  {updaterStatus.targetVersion ?? "-"}
                                </strong>
                              </div>
                              <div className="metric-card">
                                <span>Platform</span>
                                <strong>
                                  {window.electronAPI?.platform ?? "web"}
                                </strong>
                              </div>
                              <div className="metric-card">
                                <span>Status</span>
                                <strong>{updaterPhaseLabel}</strong>
                              </div>
                            </div>
                            <div className="update-status-row">
                              <span
                                className={`status-pill status-pill-inline status-${updaterPhaseClass}`}
                              >
                                {updaterPhaseLabel}
                              </span>
                              {downloaderProgressLabel
                                ? (
                                  <span className="pill-chip">
                                    Download {downloaderProgressLabel}
                                  </span>
                                )
                                : null}
                            </div>
                            <p className="muted compact-note">
                              {updaterStatus.message ?? "No updater message."}
                            </p>
                          </MenuSection>

                          <MenuSection
                            title="Actions"
                            blurb="Check now, install now, or run repair/reinstall flow."
                          >
                            <div className="update-action-row">
                              <button
                                type="button"
                                className="btn"
                                onClick={handleCheckForUpdates}
                                disabled={!updaterAvailable ||
                                  updaterBusyAction !== null}
                              >
                                {updaterBusyAction === "check"
                                  ? "Checking..."
                                  : "Check for updates"}
                              </button>
                              <button
                                type="button"
                                className="btn"
                                onClick={handleInstallUpdate}
                                disabled={!updaterAvailable ||
                                  !canInstallUpdate ||
                                  updaterBusyAction !== null}
                              >
                                {updaterBusyAction === "install"
                                  ? "Installing..."
                                  : "Restart to install"}
                              </button>
                              <button
                                type="button"
                                className="btn"
                                onClick={handleRepairInstall}
                                disabled={!updaterAvailable ||
                                  updaterBusyAction !== null}
                              >
                                {updaterBusyAction === "repair"
                                  ? "Repairing..."
                                  : "Repair installation"}
                              </button>
                            </div>
                            {!updaterAvailable
                              ? (
                                <p className="warning-note">
                                  Updater API is unavailable in this runtime.
                                </p>
                              )
                              : null}
                            <p className="muted compact-note">
                              Repair verifies download integrity via updater
                              metadata and runs update/reinstall flow. It is not
                              a full disk-level forensic scan.
                            </p>
                          </MenuSection>
                        </div>
                      )
                      : null}
                    </section>
                  </div>
                </div>
              </div>
            )
            : null}
        </div>

        {hudPanels.controls
          ? (
            <div className="corner-bottom-left panel tactical-panel compact-panel">
              <div className="panel-eyebrow">Controls</div>
              <h2>Quick Reference</h2>
              <ul className="control-list">
                {controlsPreview.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </div>
          )
          : null}

        {hudPanels.settings
          ? (
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
                    }))}
                />
                <SwitchRow
                  label="Perf Panel"
                  hint="Top-right perf HUD"
                  checked={hudPanels.performance}
                  onChange={(checked) =>
                    setHudPanels((prev) => ({
                      ...prev,
                      performance: checked,
                    }))}
                />
                <div className="field-row">
                  <div>
                    <div className="field-label">Pixel Ratio</div>
                    <div className="field-hint">Render scale</div>
                  </div>
                  <div className="segmented-row compact">
                    {PIXEL_RATIO_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`chip-btn ${
                          settings.pixelRatioScale === option.value
                            ? "active"
                            : ""
                        }`}
                        onClick={() =>
                          setSettings((prev) => ({
                            ...prev,
                            pixelRatioScale: option.value,
                          }))}
                      >
                        {option.label}
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
                        const nextIndex = (currentIndex + 1) %
                          STRESS_STEPS.length;
                        return STRESS_STEPS[nextIndex];
                      });
                    }}
                  >
                    {stressLabel}
                  </button>
                </div>
              </div>
            </div>
          )
          : null}
      </div>
    </div>
  );
}

function formatUpdaterPhase(phase: UpdaterStatusPayload["phase"]) {
  switch (phase) {
    case "idle":
      return "Idle";
    case "checking":
      return "Checking";
    case "available":
      return "Update available";
    case "downloading":
      return "Downloading";
    case "downloaded":
      return "Ready to install";
    case "none":
      return "Up to date";
    case "error":
      return "Error";
    default:
      return "Unknown";
  }
}
