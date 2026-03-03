import {
  type CSSProperties,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type AudioVolumeSettings, DEFAULT_AUDIO_VOLUMES } from "./Audio";
import { PerfHUD } from "./PerfHUD";
import { type AimingState, type HitMarkerKind, Scene } from "./Scene";
import type { SniperRechamberState, WeaponKind } from "./Weapon";
import {
  type ControlBindings,
  DEFAULT_AIM_SENSITIVITY_SETTINGS,
  DEFAULT_CONTROL_BINDINGS,
  DEFAULT_HUD_OVERLAY_TOGGLES,
  DEFAULT_PERF_METRICS,
  DEFAULT_PLAYER_SNAPSHOT,
  DEFAULT_WEAPON_ALIGNMENT,
  type GameSettings,
  type HudOverlayToggles,
  type PerfMetrics,
  type PixelRatioScale,
  type PlayerSnapshot,
  type StressModeCount,
} from "./types";

const STRESS_STEPS: StressModeCount[] = [0, 50, 100, 200];
const PIXEL_RATIO_OPTIONS: Array<{ value: PixelRatioScale; label: string }> = [
  { value: 0.5, label: "Low" },
  { value: 0.75, label: "Normal" },
  { value: 1, label: "High" },
];

type PauseMenuTab =
  | "practice"
  | "gameplay"
  | "audio"
  | "controls"
  | "graphics"
  | "hud"
  | "updates";
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
  { id: "updates", label: "Updates", hint: "Patch & repair" },
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

const OVERLAY_ROWS: Array<
  { key: keyof HudOverlayToggles; label: string; hint: string }
> = [
  { key: "practice", label: "Practice panel", hint: "Top-left range status" },
  {
    key: "controls",
    label: "Controls panel",
    hint: "Bottom-left shortcut list",
  },
  {
    key: "settings",
    label: "Settings panel",
    hint: "Bottom-right quick settings",
  },
  {
    key: "performance",
    label: "Performance panel",
    hint: "Top-right perf HUD",
  },
];

const SETTINGS_STORAGE_KEY = "zerohour.settings.v1";

const DEFAULT_GAME_SETTINGS: GameSettings = {
  shadows: false,
  pixelRatioScale: 0.75,
  showR3fPerf: false,
  sensitivity: { ...DEFAULT_AIM_SENSITIVITY_SETTINGS },
  keybinds: { ...DEFAULT_CONTROL_BINDINGS },
  fov: 65,
  weaponAlignment: { ...DEFAULT_WEAPON_ALIGNMENT },
};

const DEFAULT_UPDATER_STATUS: UpdaterStatusPayload = {
  phase: "idle",
  currentVersion: "dev",
  message: "Updater is idle.",
};

type PersistedSettings = {
  settings: GameSettings;
  hudPanels: HudOverlayToggles;
  stressCount: StressModeCount;
  audioVolumes: AudioVolumeSettings;
};

function createDefaultPersistedSettings(): PersistedSettings {
  return {
    settings: {
      ...DEFAULT_GAME_SETTINGS,
      sensitivity: { ...DEFAULT_AIM_SENSITIVITY_SETTINGS },
      keybinds: { ...DEFAULT_CONTROL_BINDINGS },
      weaponAlignment: { ...DEFAULT_WEAPON_ALIGNMENT },
    },
    hudPanels: { ...DEFAULT_HUD_OVERLAY_TOGGLES },
    stressCount: 0,
    audioVolumes: { ...DEFAULT_AUDIO_VOLUMES },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readClampedNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function migratePercent(value: unknown): unknown {
  if (typeof value === "number" && Number.isFinite(value) && value >= 5) {
    return value / 100;
  }
  return value;
}

function readPixelRatioScale(
  value: unknown,
  fallback: PixelRatioScale,
): PixelRatioScale {
  if (value === 1.25) {
    return 1;
  }
  return PIXEL_RATIO_OPTIONS.some((option) => option.value === value)
    ? (value as PixelRatioScale)
    : fallback;
}

function readStressModeCount(
  value: unknown,
  fallback: StressModeCount,
): StressModeCount {
  return STRESS_STEPS.includes(value as StressModeCount)
    ? (value as StressModeCount)
    : fallback;
}

function parsePersistedSettings(value: unknown): PersistedSettings {
  const defaults = createDefaultPersistedSettings();
  if (!isRecord(value)) {
    return defaults;
  }

  const settings = isRecord(value.settings) ? value.settings : {};
  const sensitivity = isRecord(settings.sensitivity)
    ? settings.sensitivity
    : {};
  const keybinds = isRecord(settings.keybinds) ? settings.keybinds : {};
  const weaponAlignment = isRecord(settings.weaponAlignment)
    ? settings.weaponAlignment
    : {};
  const hudPanels = isRecord(value.hudPanels) ? value.hudPanels : {};
  const audioVolumes = isRecord(value.audioVolumes) ? value.audioVolumes : {};

  return {
    settings: {
      shadows: readBoolean(settings.shadows, defaults.settings.shadows),
      pixelRatioScale: readPixelRatioScale(
        settings.pixelRatioScale,
        defaults.settings.pixelRatioScale,
      ),
      showR3fPerf: readBoolean(
        settings.showR3fPerf,
        defaults.settings.showR3fPerf,
      ),
      fov: readClampedNumber(settings.fov, 40, 120, defaults.settings.fov),
      sensitivity: {
        look: readClampedNumber(
          migratePercent(sensitivity.look),
          0.05,
          3,
          defaults.settings.sensitivity.look,
        ),
        rifleAds: readClampedNumber(
          migratePercent(sensitivity.rifleAds),
          0.05,
          2.5,
          defaults.settings.sensitivity.rifleAds,
        ),
        sniperAds: readClampedNumber(
          migratePercent(sensitivity.sniperAds),
          0.05,
          2,
          defaults.settings.sensitivity.sniperAds,
        ),
        vertical: readClampedNumber(
          migratePercent(sensitivity.vertical),
          0.3,
          2,
          defaults.settings.sensitivity.vertical,
        ),
      },
      keybinds: {
        moveForward: readString(
          keybinds.moveForward,
          defaults.settings.keybinds.moveForward,
        ),
        moveBackward: readString(
          keybinds.moveBackward,
          defaults.settings.keybinds.moveBackward,
        ),
        moveLeft: readString(
          keybinds.moveLeft,
          defaults.settings.keybinds.moveLeft,
        ),
        moveRight: readString(
          keybinds.moveRight,
          defaults.settings.keybinds.moveRight,
        ),
        sprint: readString(keybinds.sprint, defaults.settings.keybinds.sprint),
        jump: readString(keybinds.jump, defaults.settings.keybinds.jump),
        pickup: readString(keybinds.pickup, defaults.settings.keybinds.pickup),
        drop: readString(keybinds.drop, defaults.settings.keybinds.drop),
        reset: readString(keybinds.reset, defaults.settings.keybinds.reset),
        equipRifle: readString(
          keybinds.equipRifle,
          defaults.settings.keybinds.equipRifle,
        ),
        equipSniper: readString(
          keybinds.equipSniper,
          defaults.settings.keybinds.equipSniper,
        ),
        toggleView: readString(
          keybinds.toggleView,
          defaults.settings.keybinds.toggleView,
        ),
        shoulderLeft: readString(
          keybinds.shoulderLeft,
          defaults.settings.keybinds.shoulderLeft,
        ),
        shoulderRight: readString(
          keybinds.shoulderRight,
          defaults.settings.keybinds.shoulderRight,
        ),
      },
      weaponAlignment: {
        posX: readClampedNumber(
          weaponAlignment.posX,
          -0.5,
          0.5,
          defaults.settings.weaponAlignment.posX,
        ),
        posY: readClampedNumber(
          weaponAlignment.posY,
          -0.5,
          0.5,
          defaults.settings.weaponAlignment.posY,
        ),
        posZ: readClampedNumber(
          weaponAlignment.posZ,
          -0.5,
          0.5,
          defaults.settings.weaponAlignment.posZ,
        ),
        rotX: readClampedNumber(
          weaponAlignment.rotX,
          -Math.PI,
          Math.PI,
          defaults.settings.weaponAlignment.rotX,
        ),
        rotY: readClampedNumber(
          weaponAlignment.rotY,
          -Math.PI,
          Math.PI,
          defaults.settings.weaponAlignment.rotY,
        ),
        rotZ: readClampedNumber(
          weaponAlignment.rotZ,
          -Math.PI,
          Math.PI,
          defaults.settings.weaponAlignment.rotZ,
        ),
      },
    },
    hudPanels: {
      practice: readBoolean(hudPanels.practice, defaults.hudPanels.practice),
      controls: readBoolean(hudPanels.controls, defaults.hudPanels.controls),
      settings: readBoolean(hudPanels.settings, defaults.hudPanels.settings),
      performance: readBoolean(
        hudPanels.performance,
        defaults.hudPanels.performance,
      ),
    },
    stressCount: readStressModeCount(value.stressCount, defaults.stressCount),
    audioVolumes: {
      master: readClampedNumber(
        audioVolumes.master,
        0,
        1,
        defaults.audioVolumes.master,
      ),
      gunshot: readClampedNumber(
        audioVolumes.gunshot,
        0,
        1,
        defaults.audioVolumes.gunshot,
      ),
      footsteps: readClampedNumber(
        audioVolumes.footsteps,
        0,
        1,
        defaults.audioVolumes.footsteps,
      ),
      hit: readClampedNumber(audioVolumes.hit, 0, 1, defaults.audioVolumes.hit),
    },
  };
}

function loadPersistedSettings(): PersistedSettings {
  const fallback = createDefaultPersistedSettings();
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const rawSettings = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!rawSettings) {
      return fallback;
    }
    return parsePersistedSettings(JSON.parse(rawSettings));
  } catch {
    return fallback;
  }
}

function savePersistedSettings(settings: PersistedSettings) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage write failures (private mode/quota) and keep game usable.
  }
}

export function GameRoot() {
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
  const visibleOverlayCount = Object.values(hudPanels).filter(Boolean).length;

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
              <div className="panel-eyebrow">Zero Hour / Practice Range</div>
              <div className="panel-title-row">
                <div className="brand-lockup" aria-label="Zero Hour logo">
                  <span className="brand-word">Zero Hour</span>
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

          {isPaused
            ? (
              <div
                className="pause-menu panel tactical-panel"
                role="dialog"
                aria-label="Pause menu"
              >
                <button
                  type="button"
                  className="pause-close-btn"
                  aria-label="Close settings and resume game"
                  onClick={handleCloseMenuAndResume}
                >
                  <span aria-hidden="true">×</span>
                </button>
                <div className="pause-shell">
                  <aside className="pause-sidebar" aria-label="Menu sections">
                    <div className="pause-logo">
                      <div className="brand-lockup large" aria-hidden="true">
                        <span className="brand-word">Zero Hour</span>
                      </div>
                      <p className="muted">
                        Training lobby. Legacy bugs included at no extra cost.
                      </p>
                    </div>
                    <div className="pause-status-card">
                      <div className="panel-eyebrow">Session</div>
                      <div className="pause-status-grid">
                        <span>Weapon</span>
                        <strong>
                          {weaponEquipped ? activeWeapon : "unarmed"}
                        </strong>
                        <span>Overlays</span>
                        <strong>{visibleOverlayCount} active</strong>
                        <span>Range load</span>
                        <strong>{stressLabel}</strong>
                      </div>
                    </div>
                    <div
                      className="menu-tab-list"
                      role="tablist"
                      aria-label="Settings categories"
                    >
                      {MENU_TABS.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          aria-selected={menuTab === tab.id}
                          className={`menu-tab ${
                            menuTab === tab.id ? "active" : ""
                          }`}
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
                      Press <code>Esc</code> to pause again after resuming.
                    </div>
                  </aside>

                  <section
                    className="pause-content"
                    role="tabpanel"
                    aria-label={`${menuTab} settings`}
                  >
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
                              hint="Developer perf overlay (separate from Zero Hour perf panel)"
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

type MenuSectionProps = {
  title: string;
  blurb?: string;
  children: React.ReactNode;
};

const MenuSection = memo(
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
  },
);

type MetricCardProps = {
  label: string;
  value: string;
};

const MetricCard = memo(function MetricCard({ label, value }: MetricCardProps) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
});

type SwitchRowProps = {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

const SwitchRow = memo(
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
  },
);

type RangeFieldProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
};

const RangeField = memo(function RangeField(
  { label, value, min, max, step, suffix, onChange }: RangeFieldProps,
) {
  const decimals = step < 1 ? Math.max(0, Math.ceil(-Math.log10(step))) : 0;
  const display = decimals > 0 ? value.toFixed(decimals) : String(value);

  return (
    <div className="range-field">
      <div className="range-label-row">
        <span className="field-label">{label}</span>
        <span className="range-value">
          {display}
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
});

type VolumeSliderProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
};

const VolumeSlider = memo(
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
  },
);

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
    case "updates":
      return "Updates & Repair";
    default:
      return "Settings";
  }
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
