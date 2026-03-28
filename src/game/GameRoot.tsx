import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { sharedAudioManager, type AudioVolumeSettings } from "./Audio";
import { preloadPracticeMapAssets, preloadSkyAsset } from "./boot-assets";
import { getCharacterById } from "./characters";
import { ControllerCursor } from "./ControllerCursor";
import { ExperienceMenuOverlay } from "./ExperienceMenuOverlay";
import { playControllerRumble } from "./GamepadHaptics";
import { findCompatibleGamepad } from "./GamepadManager";
import { MinimalStatsBar } from "./hud/MinimalStatsBar";
import { PubgHud } from "./hud/PubgHud";
import {
  type AimingState,
  type HitMarkerKind,
  type SceneHandle,
  type ShotFiredState,
  Scene,
} from "./scene/SceneCanvas";
import {
  MenuSection,
  SwitchRow,
  RangeField,
  VolumeSlider,
  formatKeyCode,
  menuTitle,
} from "./SettingsPanels";
import { PubgInventoryOverlay } from "./inventory/PubgInventoryOverlay";
import { useControllerUiNavigation } from "./useControllerUiNavigation";
import type { SniperRechamberState, WeaponKind } from "./Weapon";
import {
  DEFAULT_PERF_METRICS,
  DEFAULT_PLAYER_SNAPSHOT,
  type CrosshairColor,
  type ExperiencePhase,
  type GameSettings,
  type HudOverlayToggles,
  type InventoryMoveLocation,
  type InventoryMoveRequest,
  type InventoryMoveResult,
  type MapId,
  type PerfMetrics,
  type PlayerSnapshot,
  type ScenePresentation,
  type StressModeCount,
} from "./types";
import {
  getPracticeMapById,
} from "./scene/practice-maps";
import { LobbyMusicController } from "./LobbyMusicController";
import {
  type BindingKey,
  type SettingsTabId,
  PIXEL_RATIO_OPTIONS,
  MENU_TABS,
  BINDING_ROWS,
  CONTROLLER_BINDING_GROUPS,
  formatControllerButtonIndex,
  loadPersistedSettings,
  parsePersistedSettings,
  savePersistedSettings,
} from "./settings";
import {
  DEFAULT_CONTROLLER_BINDINGS,
  type ControllerBindingKey,
} from "./types";
import { SKY_IDS, type SkyId } from "./sky-registry";

const DEFAULT_UPDATER_STATUS: UpdaterStatusPayload = {
  phase: "idle",
  currentVersion: "dev",
  message: "Updater is idle.",
};

const ENTER_TRANSITION_MS = 1800;
const RETURN_TRANSITION_MS = 1350;
const RETURN_RESET_PROGRESS = 0.58;
const KILL_PULSE_MS = 450;
const CHECKING_UPDATE_TOAST_ID = "greytrace-updater-checking";
const UPDATE_AVAILABLE_TOAST_ID = "greytrace-updater-available";
const READY_TO_INSTALL_TOAST_ID = "greytrace-updater-ready";
const MENU_AUTO_UPDATE_CHECK_COOLDOWN_MS = 30_000;
const MAX_SHOT_BLOOM = 24;
const CONTROLLER_CAPTURE_CANCEL_HOLD_MS = 800;
const RIFLE_FIRE_RUMBLE = {
  durationMs: 24,
  weakMagnitude: 0.12,
  strongMagnitude: 0.22,
  throttleMs: 55,
} as const;
const SNIPER_FIRE_RUMBLE = {
  durationMs: 42,
  weakMagnitude: 0.2,
  strongMagnitude: 0.48,
  throttleMs: 120,
} as const;
const BODY_HIT_RUMBLE = {
  durationMs: 34,
  weakMagnitude: 0.16,
  strongMagnitude: 0.28,
  throttleMs: 40,
} as const;
const HEAD_HIT_RUMBLE = {
  durationMs: 50,
  weakMagnitude: 0.22,
  strongMagnitude: 0.44,
  throttleMs: 60,
} as const;
const KILL_HIT_RUMBLE = {
  durationMs: 92,
  weakMagnitude: 0.28,
  strongMagnitude: 0.78,
  throttleMs: 120,
} as const;

const CROSSHAIR_COLOR_HEX: Record<CrosshairColor, string> = {
  white: "#eff7ff",
  green: "#57f287",
  red: "#ff5666",
  yellow: "#ffd45e",
  cyan: "#53dfff",
  magenta: "#ff63df",
};

const CROSSHAIR_COLOR_OPTIONS: Array<{
  id: CrosshairColor;
  label: string;
}> = [
  { id: "white", label: "White" },
  { id: "green", label: "Green" },
  { id: "red", label: "Red" },
  { id: "yellow", label: "Yellow" },
  { id: "cyan", label: "Cyan" },
  { id: "magenta", label: "Magenta" },
];

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function easeInOutCubic(value: number) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function resolveKillPulseAmount(progress: number) {
  if (progress <= 0.35) {
    return easeInOutCubic(progress / 0.35);
  }
  return 1 - easeInOutCubic((progress - 0.35) / 0.65);
}

function isControllerCaptureButtonPressed(
  button: GamepadButton | undefined,
  index: number,
) {
  if (!button) {
    return false;
  }
  const threshold = index === 6 || index === 7 ? 0.2 : 0.5;
  return button.pressed || button.value >= threshold;
}

function resolveUiAudioButton(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return null;
  }

  const button = target.closest("button");
  return button instanceof HTMLButtonElement ? button : null;
}

function isUiAudioButtonEnabled(button: HTMLButtonElement) {
  return !button.disabled &&
    button.getAttribute("aria-disabled") !== "true" &&
    !button.classList.contains("locked");
}

function isLoadoutSlotEqual(
  previous: PlayerSnapshot["weaponLoadout"]["slotA"],
  next: PlayerSnapshot["weaponLoadout"]["slotA"],
) {
  return previous.weaponKind === next.weaponKind &&
    previous.hasWeapon === next.hasWeapon &&
    previous.magAmmo === next.magAmmo &&
    previous.reserveAmmo === next.reserveAmmo &&
    previous.infiniteReserveAmmo === next.infiniteReserveAmmo &&
    previous.maxMagAmmo === next.maxMagAmmo &&
    previous.maxReserveAmmo === next.maxReserveAmmo &&
    previous.maxPacks === next.maxPacks &&
    previous.packAmmo === next.packAmmo;
}

function isPlayerSnapshotEqual(previous: PlayerSnapshot, next: PlayerSnapshot) {
  return previous.x === next.x &&
    previous.y === next.y &&
    previous.z === next.z &&
    previous.speed === next.speed &&
    previous.grounded === next.grounded &&
    previous.moving === next.moving &&
    previous.sprinting === next.sprinting &&
    previous.movementTier === next.movementTier &&
    previous.crouched === next.crouched &&
    previous.pointerLocked === next.pointerLocked &&
    previous.controllerConnected === next.controllerConnected &&
    previous.canInteract === next.canInteract &&
    previous.interactWeaponKind === next.interactWeaponKind &&
    previous.inventoryPanelOpen === next.inventoryPanelOpen &&
    previous.inventoryPanelMode === next.inventoryPanelMode &&
    previous.inventory.revision === next.inventory.revision &&
    previous.weaponLoadout.activeSlot === next.weaponLoadout.activeSlot &&
    isLoadoutSlotEqual(previous.weaponLoadout.slotA, next.weaponLoadout.slotA) &&
    isLoadoutSlotEqual(previous.weaponLoadout.slotB, next.weaponLoadout.slotB) &&
    previous.weaponReload.active === next.weaponReload.active &&
    previous.weaponReload.weaponKind === next.weaponReload.weaponKind &&
    previous.weaponReload.progress === next.weaponReload.progress &&
    previous.weaponReload.remainingMs === next.weaponReload.remainingMs;
}

const BOOT_PRESENTATION: ScenePresentation = {
  phase: "playing",
  phaseProgress: 1,
  worldTheme: 1,
  pickupReveal: 1,
  targetReveal: 1,
  inputEnabled: false,
  killPulse: 0,
};

const INITIAL_PRACTICE_MAP_READY_STATE: Record<MapId, boolean> = {
  range: true,
  map1: false,
};

const INITIAL_SKY_ASSET_READY_STATE = SKY_IDS.reduce(
  (state, skyId) => {
    state[skyId] = false;
    return state;
  },
  {} as Record<SkyId, boolean>,
);

function PracticeLoadingOverlay({ mapLabel }: { mapLabel: string }) {
  return (
    <div className="loading-screen loading-screen--main">
      <div className="loading-main-backdrop" aria-hidden="true" />
      <div className="loading-main">
        <div className="loading-content">
          <div className="loading-hero">
            <h1 className="loading-logo-text">GreyTrace</h1>
          </div>
        </div>
        <div className="loading-bottom-left">
          <div className="loading-bottom-left-brand">Loading {mapLabel}</div>
          <p className="loading-alpha-note">
            Warming the map before we drop you in. Better a short curtain than
            admiring unfinished geometry.
          </p>
        </div>
      </div>
    </div>
  );
}

type GameRootProps = {
  booting: boolean;
  deferredAssetsEnabled: boolean;
  onSceneBootReady: () => void;
};

export function GameRoot({
  booting,
  deferredAssetsEnabled,
  onSceneBootReady,
}: GameRootProps) {
  const persistedSettings = useMemo(loadPersistedSettings, []);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const settingsModalRef = useRef<HTMLDivElement | null>(null);
  const [settings, setSettings] = useState<GameSettings>(
    persistedSettings.settings,
  );
  const [hudPanels, setHudPanels] = useState<HudOverlayToggles>(
    persistedSettings.hudPanels,
  );
  const [menuTab, setMenuTab] = useState<SettingsTabId>("sensitivity");
  const [crosshairSubTab, setCrosshairSubTab] = useState<"normal" | "redDot">("normal");
  const [bindingCapture, setBindingCapture] = useState<BindingKey | null>(null);
  const bindingCaptureRef = useRef<BindingKey | null>(null);
  const [controllerBindingCapture, setControllerBindingCapture] = useState<
    ControllerBindingKey | null
  >(null);
  const controllerBindingCaptureRef = useRef<ControllerBindingKey | null>(null);
  const [stressCount, setStressCount] = useState<StressModeCount>(
    persistedSettings.stressCount,
  );
  const [audioVolumes, setAudioVolumes] = useState<AudioVolumeSettings>(
    persistedSettings.audioVolumes,
  );
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>(
    persistedSettings.selectedCharacterId,
  );
  const [selectedSkyId, setSelectedSkyId] = useState<SkyId>(
    persistedSettings.selectedSkyId,
  );
  const [selectedMapId, setSelectedMapId] = useState<MapId>(
    persistedSettings.selectedMapId,
  );
  const practiceMapWarmupsRef = useRef<Partial<Record<MapId, Promise<void>>>>(
    {},
  );
  const skyAssetWarmupsRef = useRef<Partial<Record<SkyId, Promise<void>>>>({});
  const practiceEnterTokenRef = useRef(0);
  const [practiceMapReady, setPracticeMapReady] = useState<
    Record<MapId, boolean>
  >(INITIAL_PRACTICE_MAP_READY_STATE);
  const [skyAssetReady, setSkyAssetReady] = useState<Record<SkyId, boolean>>(
    INITIAL_SKY_ASSET_READY_STATE,
  );
  const [practiceLoading, setPracticeLoading] = useState(false);
  const selectedMap = useMemo(
    () => getPracticeMapById(selectedMapId),
    [selectedMapId],
  );
  const characterOverride = useMemo(() => {
    const def = getCharacterById(selectedCharacterId);
    return {
      modelUrl: def.modelUrl,
      textureBasePath: def.textureBasePath,
      textures: def.textures,
    };
  }, [selectedCharacterId]);
  const [perfMetrics, setPerfMetrics] = useState<PerfMetrics>(
    DEFAULT_PERF_METRICS,
  );
  const [player, setPlayerRaw] = useState<PlayerSnapshot>(
    DEFAULT_PLAYER_SNAPSHOT,
  );
  const playerRef = useRef(player);
  const setPlayer = useCallback((snapshot: PlayerSnapshot) => {
    const prev = playerRef.current;
    if (isPlayerSnapshotEqual(prev, snapshot)) {
      return;
    }
    playerRef.current = snapshot;
    setPlayerRaw(snapshot);
  }, []);
  const [, setWeaponEquipped] = useState(false);
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
  const [phase, setPhase] = useState<ExperiencePhase>("menu");
  const [phaseProgress, setPhaseProgress] = useState(0);
  const [menuSettingsOpen, setMenuSettingsOpen] = useState(false);
  const [pauseMenuOpen, setPauseMenuOpen] = useState(false);
  const pauseMenuOpenRef = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const [killPulseToken, setKillPulseToken] = useState(0);
  const [killPulseAmount, setKillPulseAmount] = useState(0);
  const [hitMarker, setHitMarker] = useState<
    { until: number; kind: HitMarkerKind }
  >({
    until: 0,
    kind: "body",
  });
  const [damageNumbers, setDamageNumbers] = useState<
    Array<{ id: number; targetId: string; damage: number; kind: HitMarkerKind; until: number }>
  >([]);
  const damageNumberIdRef = useRef(0);
  const damageNumberTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [shotBloom, setShotBloom] = useState(0);
  const shotBloomRef = useRef(0);
  const shotBloomFrameRef = useRef<number | null>(null);
  const shotBloomLastTimeRef = useRef(0);
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatusPayload>(
    DEFAULT_UPDATER_STATUS,
  );
  const [settingsImportDraft, setSettingsImportDraft] = useState("");
  const [updaterBusyAction, setUpdaterBusyAction] = useState<
    "check" | "install" | "repair" | null
  >(null);
  const updaterApi = window.electronAPI?.updater;
  const updaterAvailable = Boolean(updaterApi);
  const inventoryOpen = phase === "playing" && player.inventoryPanelOpen;
  const [hasBeenLocked, setHasBeenLocked] = useState(false);
  const returnResetDoneRef = useRef(false);
  const enteredPlayingAtRef = useRef(0);
  const [needsPointerLock, setNeedsPointerLock] = useState(false);
  const isGameplayPaused =
    booting ||
    phase !== "playing" ||
    pauseMenuOpen ||
    (phase === "playing" &&
      needsPointerLock &&
      !inventoryOpen &&
      !player.controllerConnected);

  useEffect(() => {
    pauseMenuOpenRef.current = pauseMenuOpen;
  }, [pauseMenuOpen]);

  useEffect(() => {
    bindingCaptureRef.current = bindingCapture;
  }, [bindingCapture]);

  useEffect(() => {
    controllerBindingCaptureRef.current = controllerBindingCapture;
  }, [controllerBindingCapture]);

  const previousUpdaterPhaseRef = useRef<UpdaterPhase | null>(null);
  const lastMenuAutoCheckAtRef = useRef(0);

  useEffect(() => {
    if (player.pointerLocked && !hasBeenLocked) {
      setHasBeenLocked(true);
    }
  }, [player.pointerLocked, hasBeenLocked]);

  useEffect(() => {
    if (phase !== "entering" && phase !== "returning") {
      setPhaseProgress(phase === "playing" ? 1 : 0);
      return;
    }

    const duration = phase === "entering"
      ? ENTER_TRANSITION_MS
      : RETURN_TRANSITION_MS;
    const startedAt = performance.now();
    returnResetDoneRef.current = false;
    let rafId = 0;

    const tick = (now: number) => {
      const progress = clamp01((now - startedAt) / duration);
      setPhaseProgress(progress);

      if (
        phase === "returning" &&
        progress >= RETURN_RESET_PROGRESS &&
        !returnResetDoneRef.current
      ) {
        returnResetDoneRef.current = true;
        sceneRef.current?.resetForMenu();
        setHitMarker({ until: 0, kind: "body" });
      }

      if (progress >= 1) {
        if (phase === "entering") {
          enteredPlayingAtRef.current = performance.now();
          setPhase("playing");
          setNeedsPointerLock(true);
        } else {
          setPhase("menu");
          setMenuSettingsOpen(false);
          setHasBeenLocked(false);
        }
        return;
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [phase]);

  useEffect(() => {
    window.electronAPI?.setGameplayActive(phase === "playing");
  }, [phase]);

  // Auto-lock the pointer once we enter playing state.
  // Browser requires a user gesture for requestPointerLock, so we add a
  // one-time click handler. In Electron/Tauri the synthetic click usually
  // suffices; in the browser the user will just need one click.
  useEffect(() => {
    if (!needsPointerLock) return;
    if (phase !== "playing") {
      setNeedsPointerLock(false);
      return;
    }

    const tryLock = () => {
      setNeedsPointerLock(false);
      sceneRef.current?.requestPointerLock();
    };

    // Use double-RAF: all sibling/child effects (including PlayerController's
    // inputEnabledRef update) finish synchronously before any RAF fires, so
    // inputEnabled is guaranteed true and the canvas is visible by then.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(tryLock);
    });

    // Fallback: real user click on the canvas (always works via PlayerController's
    // own mousedown handler, but keep this for non-Electron environments)
    const onClick = () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      tryLock();
    };
    document.addEventListener("click", onClick, { once: true });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      document.removeEventListener("click", onClick);
    };
  }, [needsPointerLock, phase]);

  useEffect(() => {
    if (killPulseToken <= 0) {
      return;
    }

    const startedAt = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const progress = clamp01((now - startedAt) / KILL_PULSE_MS);
      setKillPulseAmount(resolveKillPulseAmount(progress));
      if (progress >= 1) {
        setKillPulseAmount(0);
        return;
      }
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [killPulseToken]);

  const showPauseMenu = phase === "playing" && pauseMenuOpen;
  const inLobbyPhase = phase === "menu" || phase === "entering" ||
    phase === "returning";
  const showSettingsModal = menuSettingsOpen || showPauseMenu;
  const showClickToContinueOverlay =
    phase === "playing" &&
    needsPointerLock &&
    !showSettingsModal &&
    !player.controllerConnected;

  const handleCloseMenuAndResume = useCallback(() => {
    setBindingCapture(null);
    setControllerBindingCapture(null);
    setMenuSettingsOpen(false);
    setPauseMenuOpen(false);
    window.focus();
    if (phaseRef.current === "playing") {
      setNeedsPointerLock(true);
    }
  }, []);

  const handlePauseMenuToggle = useCallback(() => {
    if (bindingCaptureRef.current || controllerBindingCaptureRef.current) {
      return;
    }
    if (pauseMenuOpenRef.current) {
      handleCloseMenuAndResume();
      return;
    }
    setNeedsPointerLock(false);
    setBindingCapture(null);
    setControllerBindingCapture(null);
    setMenuSettingsOpen(false);
    setPauseMenuOpen(true);
    sceneRef.current?.releasePointerLock();
  }, [handleCloseMenuAndResume]);

  const handleCloseSettingsModal = useCallback(() => {
    setBindingCapture(null);
    setControllerBindingCapture(null);
    setMenuSettingsOpen(false);
  }, []);

  const handleOpenSettingsModal = useCallback(() => {
    setBindingCapture(null);
    setControllerBindingCapture(null);
    setMenuTab("sensitivity");
    setMenuSettingsOpen(true);
  }, []);

  const handleControllerOverlayBack = useCallback(() => {
    if (bindingCaptureRef.current) {
      setBindingCapture(null);
      return;
    }
    if (controllerBindingCaptureRef.current) {
      setControllerBindingCapture(null);
      return;
    }
    if (showPauseMenu) {
      handleCloseMenuAndResume();
      return;
    }
    if (menuSettingsOpen) {
      handleCloseSettingsModal();
    }
  }, [
    handleCloseMenuAndResume,
    handleCloseSettingsModal,
    menuSettingsOpen,
    showPauseMenu,
  ]);

  const warmPracticeMapAssets = useCallback((mapToWarm = selectedMap) => {
    const existing = practiceMapWarmupsRef.current[mapToWarm.id];
    if (existing) {
      return existing;
    }

    const request = preloadPracticeMapAssets(mapToWarm, selectedSkyId)
      .catch((error: unknown) => {
        console.warn("[Practice] Map warmup failed", {
          mapId: mapToWarm.id,
          error,
        });
      })
      .finally(() => {
        setPracticeMapReady((previous) =>
          previous[mapToWarm.id]
            ? previous
            : {
              ...previous,
              [mapToWarm.id]: true,
            }
        );
      });

    practiceMapWarmupsRef.current[mapToWarm.id] = request;
    return request;
  }, [selectedMap, selectedSkyId]);

  const warmSkyAsset = useCallback((skyIdToWarm: SkyId) => {
    const existing = skyAssetWarmupsRef.current[skyIdToWarm];
    if (existing) {
      return existing;
    }

    const request = preloadSkyAsset(skyIdToWarm)
      .catch((error: unknown) => {
        console.warn("[Practice] Sky warmup failed", {
          skyId: skyIdToWarm,
          error,
        });
      })
      .finally(() => {
        setSkyAssetReady((previous) =>
          previous[skyIdToWarm]
            ? previous
            : {
              ...previous,
              [skyIdToWarm]: true,
            }
        );
      });

    skyAssetWarmupsRef.current[skyIdToWarm] = request;
    return request;
  }, []);

  useEffect(() => {
    void warmPracticeMapAssets(selectedMap);
  }, [selectedMap, warmPracticeMapAssets]);

  useEffect(() => {
    for (const skyId of SKY_IDS) {
      void warmSkyAsset(skyId);
    }
  }, [warmSkyAsset]);

  useEffect(() => {
    if (!showSettingsModal) {
      return;
    }

    const focusModal = () => {
      window.focus();
      settingsModalRef.current?.focus({ preventScroll: true });
    };

    focusModal();
    const frameId = window.requestAnimationFrame(focusModal);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [showSettingsModal]);

  const startPracticeSession = useCallback(() => {
    flushSync(() => {
      setPracticeLoading(false);
      setMenuSettingsOpen(false);
      setPauseMenuOpen(false);
      setBindingCapture(null);
      setControllerBindingCapture(null);
      setHitMarker({ until: 0, kind: "body" });
      enteredPlayingAtRef.current = performance.now();
      setPhase("playing");
    });
    window.focus();
    setNeedsPointerLock(true);
  }, []);

  const handleEnterPractice = useCallback(() => {
    if (practiceMapReady[selectedMap.id] && skyAssetReady[selectedSkyId]) {
      startPracticeSession();
      return;
    }

    const token = practiceEnterTokenRef.current + 1;
    practiceEnterTokenRef.current = token;
    setPracticeLoading(true);
    void Promise.all([
      warmPracticeMapAssets(selectedMap),
      warmSkyAsset(selectedSkyId),
    ]).finally(() => {
      if (practiceEnterTokenRef.current !== token) {
        return;
      }
      startPracticeSession();
    });
  }, [
    practiceMapReady,
    selectedSkyId,
    skyAssetReady,
    selectedMap,
    startPracticeSession,
    warmSkyAsset,
    warmPracticeMapAssets,
  ]);

  const handleReturnToLobby = useCallback(() => {
    setNeedsPointerLock(false);
    setBindingCapture(null);
    setControllerBindingCapture(null);
    setMenuSettingsOpen(false);
    setPauseMenuOpen(false);
    sceneRef.current?.releasePointerLock();
    sceneRef.current?.dropWeaponForReturn();
    sceneRef.current?.resetForMenu();
    setHitMarker({ until: 0, kind: "body" });
    setHasBeenLocked(false);
    setPhase("menu");
  }, []);

  const reportInventoryResult = useCallback((result: InventoryMoveResult) => {
    if (result.ok) {
      return;
    }
    if (result.message) {
      toast.warning(result.message);
    }
  }, []);

  const handleMoveInventoryItem = useCallback((request: InventoryMoveRequest) => {
    const result = sceneRef.current?.moveInventoryItem(request) ?? {
      ok: false,
      message: "Inventory runtime unavailable.",
    };
    reportInventoryResult(result);
    return result;
  }, [reportInventoryResult]);

  const handleQuickMoveInventoryItem = useCallback((location: InventoryMoveLocation) => {
    const result = sceneRef.current?.quickMoveInventoryItem(location) ?? {
      ok: false,
      message: "Inventory runtime unavailable.",
    };
    reportInventoryResult(result);
    return result;
  }, [reportInventoryResult]);

  const handleHitMarker = useCallback(
    (kind: HitMarkerKind, damage: number, targetId: string) => {
      playControllerRumble(
        kind === "kill"
          ? KILL_HIT_RUMBLE
          : kind === "head"
          ? HEAD_HIT_RUMBLE
          : BODY_HIT_RUMBLE,
        {
          enabled: settings.controller.vibrationEnabled,
          channel: "impact",
        },
      );

      const now = performance.now();
      setHitMarker({
        kind,
        until: now + (kind === "kill" ? 170 : kind === "head" ? 120 : 90),
      });

      // Clear existing cleanup timer so accumulation isn't cut short
      const existingTimer = damageNumberTimersRef.current.get(targetId);
      if (existingTimer !== undefined) clearTimeout(existingTimer);

      setDamageNumbers((prev) => {
        const cleaned = prev.filter((d) => d.until > now);
        const existing = cleaned.find((d) => d.targetId === targetId);
        if (existing) {
          return cleaned.map((d) =>
            d.targetId === targetId
              ? { ...d, damage: d.damage + damage, kind, until: now + 800 }
              : d
          );
        }
        const id = ++damageNumberIdRef.current;
        return [...cleaned, { id, targetId, damage, kind, until: now + 800 }];
      });

      const timer = setTimeout(() => {
        damageNumberTimersRef.current.delete(targetId);
        setDamageNumbers((prev) => prev.filter((d) => d.targetId !== targetId));
      }, 820);
      damageNumberTimersRef.current.set(targetId, timer);

      if (kind === "kill" && phase === "playing") {
        setKillPulseAmount(0);
        setKillPulseToken((previous) => previous + 1);
      }
    },
    [phase, settings.controller.vibrationEnabled],
  );

  const handleShotFired = useCallback((state: ShotFiredState) => {
    if (phase !== "playing") {
      return;
    }

    playControllerRumble(
      state.weaponType === "sniper" ? SNIPER_FIRE_RUMBLE : RIFLE_FIRE_RUMBLE,
      {
        enabled: settings.controller.vibrationEnabled,
        channel: "fire",
      },
    );

    if (!settings.crosshair.dynamic.enabled) {
      return;
    }
    const kick = settings.crosshair.dynamic.shotKick;
    if (kick <= 0) {
      return;
    }
    setShotBloom((previous) => {
      const next = Math.min(MAX_SHOT_BLOOM, previous + kick);
      shotBloomRef.current = next;
      return next;
    });
    shotBloomLastTimeRef.current = state.nowMs;
  }, [
    phase,
    settings.controller.vibrationEnabled,
    settings.crosshair.dynamic.enabled,
    settings.crosshair.dynamic.shotKick,
  ]);

  const settingsProfileJson = useMemo(
    () =>
      JSON.stringify(
        {
          settings,
          hudPanels,
          stressCount,
          audioVolumes,
          selectedCharacterId,
          selectedSkyId,
          selectedMapId,
        },
        null,
        2,
      ),
    [
      settings,
      hudPanels,
      stressCount,
      audioVolumes,
      selectedCharacterId,
      selectedSkyId,
      selectedMapId,
    ],
  );

  const handleCopySettingsProfile = useCallback(async () => {
    if (!navigator.clipboard) {
      toast.error("Clipboard API is unavailable in this runtime.");
      return;
    }
    try {
      await navigator.clipboard.writeText(settingsProfileJson);
      toast.success("Settings profile copied.");
    } catch (error) {
      toast.error("Failed to copy settings profile.", {
        description: error instanceof Error ? error.message : "Unknown clipboard error.",
      });
    }
  }, [settingsProfileJson]);

  const handleImportSettingsProfile = useCallback(() => {
    const raw = settingsImportDraft.trim();
    if (!raw) {
      toast.error("Paste a settings profile JSON before importing.");
      return;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      const normalizedInput =
        parsed && typeof parsed === "object" && "settings" in parsed
          ? parsed
          : { settings: parsed };
      const next = parsePersistedSettings(normalizedInput);
      setSettings(next.settings);
      setHudPanels(next.hudPanels);
      setStressCount(next.stressCount);
      setAudioVolumes(next.audioVolumes);
      setSelectedCharacterId(next.selectedCharacterId);
      setSelectedSkyId(next.selectedSkyId);
      setSelectedMapId(next.selectedMapId);
      toast.success("Settings profile imported.");
    } catch (error) {
      toast.error("Invalid settings profile JSON.", {
        description: error instanceof Error ? error.message : "Unknown JSON parse error.",
      });
    }
  }, [settingsImportDraft]);

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

  useEffect(() => {
    if (phase !== "menu" || !updaterApi || booting) {
      return;
    }

    const now = Date.now();
    if (
      now - lastMenuAutoCheckAtRef.current < MENU_AUTO_UPDATE_CHECK_COOLDOWN_MS
    ) {
      return;
    }
    lastMenuAutoCheckAtRef.current = now;

    void updaterApi.check().catch(() => {
      // Updater status events surface errors to UI and toast channel.
    });
  }, [booting, phase, updaterApi]);

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
    if (inLobbyPhase && updaterApi) {
      return;
    }

    toast.dismiss(CHECKING_UPDATE_TOAST_ID);
    toast.dismiss(UPDATE_AVAILABLE_TOAST_ID);
    toast.dismiss(READY_TO_INSTALL_TOAST_ID);
  }, [inLobbyPhase, updaterApi]);

  useEffect(() => {
    const previousPhase = previousUpdaterPhaseRef.current;
    previousUpdaterPhaseRef.current = updaterStatus.phase;

    if (!inLobbyPhase || !updaterApi) {
      return;
    }

    if (updaterStatus.phase === "checking" && previousPhase !== "checking") {
      toast.info("Checking for latest release...", {
        id: CHECKING_UPDATE_TOAST_ID,
        duration: 5000,
        description: "Polling GitHub release metadata in the background.",
      });
    }

    if (updaterStatus.phase === "available" && previousPhase !== "available") {
      toast.info(`Update ${updaterStatus.targetVersion ?? "found"}.`, {
        id: UPDATE_AVAILABLE_TOAST_ID,
        duration: 5000,
        description: "Download started. Restart button appears when ready.",
      });
    }

    if (updaterStatus.phase === "downloaded") {
      toast.success(
        `Update ${updaterStatus.targetVersion ?? "package"} ready to install.`,
        {
          id: READY_TO_INSTALL_TOAST_ID,
          duration: Infinity,
          closeButton: false,
          action: {
            label: updaterBusyAction === "install"
              ? "Restarting..."
              : "Restart now",
            onClick: () => {
              void handleInstallUpdate();
            },
          },
        },
      );
    } else {
      toast.dismiss(READY_TO_INSTALL_TOAST_ID);
    }

    if (
      updaterStatus.phase !== "available" &&
      updaterStatus.phase !== "downloading"
    ) {
      toast.dismiss(UPDATE_AVAILABLE_TOAST_ID);
    }

    if (updaterStatus.phase === "error" && previousPhase !== "error") {
      toast.error("Updater hit an error.", {
        duration: 5000,
        description: updaterStatus.message ?? "Unknown updater failure.",
      });
    }
  }, [
    handleInstallUpdate,
    inLobbyPhase,
    updaterApi,
    updaterBusyAction,
    updaterStatus.message,
    updaterStatus.phase,
    updaterStatus.targetVersion,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "KeyP" || event.repeat) {
        return;
      }

      setHudPanels((prev) => ({
        ...prev,
        statsBar: !prev.statsBar,
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
      selectedCharacterId,
      selectedSkyId,
      selectedMapId,
    });
  }, [
    settings,
    hudPanels,
    stressCount,
    audioVolumes,
    selectedCharacterId,
    selectedSkyId,
    selectedMapId,
  ]);

  useEffect(() => {
    sharedAudioManager.setVolumes(audioVolumes);
  }, [audioVolumes]);

  useEffect(() => {
    const appShell = appShellRef.current;
    if (!appShell) {
      return;
    }

    const handlePointerOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") {
        return;
      }

      const button = resolveUiAudioButton(event.target);
      if (!button || !isUiAudioButtonEnabled(button)) {
        return;
      }

      const previousButton = resolveUiAudioButton(event.relatedTarget);
      if (button === previousButton) {
        return;
      }

      sharedAudioManager.playUiHover();
    };

    const handleClick = (event: MouseEvent) => {
      const button = resolveUiAudioButton(event.target);
      if (!button || !isUiAudioButtonEnabled(button)) {
        return;
      }

      sharedAudioManager.playUiPress();
    };

    appShell.addEventListener("pointerover", handlePointerOver, true);
    appShell.addEventListener("click", handleClick, true);

    return () => {
      appShell.removeEventListener("pointerover", handlePointerOver, true);
      appShell.removeEventListener("click", handleClick, true);
    };
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
    if (!controllerBindingCapture) {
      return;
    }

    let frameId = 0;
    let waitingForRelease = true;
    let pauseCandidateStartedAt = 0;

    const tick = () => {
      const gamepad = findCompatibleGamepad();
      if (!gamepad) {
        frameId = window.requestAnimationFrame(tick);
        return;
      }

      const pressedIndices = gamepad.buttons.flatMap((button, index) =>
        isControllerCaptureButtonPressed(button, index) ? [index] : []
      );

      if (waitingForRelease) {
        if (pressedIndices.length === 0) {
          waitingForRelease = false;
        }
        frameId = window.requestAnimationFrame(tick);
        return;
      }

      const now = performance.now();
      const firstNonPauseButton = pressedIndices.find((index) => index !== 9);
      if (typeof firstNonPauseButton === "number") {
        setSettings((prev) => ({
          ...prev,
          controllerBindings: {
            ...prev.controllerBindings,
            [controllerBindingCapture]: firstNonPauseButton,
          },
        }));
        setControllerBindingCapture(null);
        return;
      }

      if (pressedIndices.includes(9)) {
        if (pauseCandidateStartedAt === 0) {
          pauseCandidateStartedAt = now;
        } else if (now - pauseCandidateStartedAt >= CONTROLLER_CAPTURE_CANCEL_HOLD_MS) {
          setControllerBindingCapture(null);
          return;
        }
      } else if (pauseCandidateStartedAt > 0) {
        setSettings((prev) => ({
          ...prev,
          controllerBindings: {
            ...prev.controllerBindings,
            [controllerBindingCapture]: 9,
          },
        }));
        setControllerBindingCapture(null);
        return;
      }

      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [controllerBindingCapture]);

  useEffect(() => {
    if (!controllerBindingCapture) {
      return;
    }

    const onCancelCapture = (event: KeyboardEvent) => {
      if (event.code !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      setControllerBindingCapture(null);
    };

    window.addEventListener("keydown", onCancelCapture, true);
    return () => window.removeEventListener("keydown", onCancelCapture, true);
  }, [controllerBindingCapture]);

  useEffect(() => {
    if (!isGameplayPaused && (bindingCapture || controllerBindingCapture)) {
      setBindingCapture(null);
      setControllerBindingCapture(null);
    }
  }, [bindingCapture, controllerBindingCapture, isGameplayPaused]);

  useEffect(() => {
    if (phase !== "playing" && pauseMenuOpen) {
      setPauseMenuOpen(false);
    }
  }, [phase, pauseMenuOpen]);

  useEffect(() => {
    if (phase === "playing") {
      return;
    }
    setNeedsPointerLock(false);
  }, [phase]);

  useEffect(() => {
    if (phase !== "playing") {
      setHitMarker({ until: 0, kind: "body" });
      shotBloomRef.current = 0;
      setShotBloom(0);
    }
  }, [phase]);

  useEffect(() => {
    shotBloomRef.current = shotBloom;
  }, [shotBloom]);

  useEffect(() => {
    if (settings.crosshair.dynamic.enabled) {
      return;
    }
    if (shotBloomRef.current !== 0) {
      shotBloomRef.current = 0;
      setShotBloom(0);
    }
  }, [settings.crosshair.dynamic.enabled]);

  useEffect(() => {
    if (phase !== "playing" || isGameplayPaused) {
      if (shotBloomFrameRef.current !== null) {
        window.cancelAnimationFrame(shotBloomFrameRef.current);
        shotBloomFrameRef.current = null;
      }
      if (shotBloomRef.current !== 0) {
        shotBloomRef.current = 0;
        setShotBloom(0);
      }
      return;
    }

    shotBloomLastTimeRef.current = performance.now();
    const tick = (now: number) => {
      const previous = shotBloomRef.current;
      const dt = Math.min(0.06, Math.max(0, (now - shotBloomLastTimeRef.current) / 1000));
      shotBloomLastTimeRef.current = now;
      if (previous > 0.0001) {
        const recoveryPerSecond = settings.crosshair.dynamic.enabled
          ? settings.crosshair.dynamic.recoveryPerSecond
          : 120;
        const next = Math.max(0, previous - recoveryPerSecond * dt);
        if (Math.abs(next - previous) > 0.0001) {
          shotBloomRef.current = next;
          setShotBloom(next);
        }
      }
      shotBloomFrameRef.current = window.requestAnimationFrame(tick);
    };

    shotBloomFrameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (shotBloomFrameRef.current !== null) {
        window.cancelAnimationFrame(shotBloomFrameRef.current);
        shotBloomFrameRef.current = null;
      }
    };
  }, [isGameplayPaused, phase, settings.crosshair.dynamic.enabled, settings.crosshair.dynamic.recoveryPerSecond]);

  const scenePresentation = useMemo<ScenePresentation>(() => {
    const progress = clamp01(phaseProgress);
    switch (phase) {
      case "menu":
        return {
          phase,
          phaseProgress: 0,
          worldTheme: 0,
          pickupReveal: 0,
          targetReveal: 0,
          inputEnabled: false,
          killPulse: 0,
        };
      case "entering":
        return {
          phase,
          phaseProgress: progress,
          worldTheme: easeInOutCubic(clamp01(progress / 0.72)),
          pickupReveal: easeInOutCubic(clamp01((progress - 0.55) / 0.18)),
          targetReveal: easeInOutCubic(clamp01((progress - 0.72) / 0.18)),
          inputEnabled: false,
          killPulse: 0,
        };
      case "returning":
        return {
          phase,
          phaseProgress: progress,
          worldTheme: 1 - easeInOutCubic(clamp01(progress / 0.58)),
          pickupReveal: 1 - easeInOutCubic(clamp01((progress - 0.12) / 0.28)),
          targetReveal: 1 - easeInOutCubic(clamp01((progress - 0.08) / 0.24)),
          inputEnabled: false,
          killPulse: 0,
        };
      case "playing":
      default:
        return {
          phase: "playing",
          phaseProgress: 1,
          worldTheme: 1,
          pickupReveal: 1,
          targetReveal: 1,
          inputEnabled: true,
          killPulse: killPulseAmount,
        };
    }
  }, [killPulseAmount, phase, phaseProgress]);

  const renderedPresentation = booting ? BOOT_PRESENTATION : scenePresentation;

  const hitMarkerVisible = hitMarker.until > performance.now();
  const isAimingDownSight = aimingState.ads && phase === "playing" && !isGameplayPaused;
  const sniperRechamberProgress =
    activeWeapon === "sniper" && sniperRechamber.active
      ? sniperRechamber.progress
      : 1;
  const sceneStressCount = selectedMap.supportsStressMode ? stressCount : 0;
  const movementSpread = !settings.crosshair.dynamic.enabled
    ? 0
    : player.grounded && player.moving
    ? player.sprinting
      ? settings.crosshair.dynamic.runSpread
      : settings.crosshair.dynamic.walkSpread
    : settings.crosshair.dynamic.idleSpread;
  const weaponSpreadMultiplier = activeWeapon === "sniper"
    ? settings.crosshair.weaponModifiers.sniperGapMultiplier
    : settings.crosshair.weaponModifiers.rifleGapMultiplier;
  const spreadOffset = (settings.crosshair.dynamic.enabled
    ? movementSpread + shotBloom
    : 0) * weaponSpreadMultiplier;
  const innerGap = settings.crosshair.innerLines.gap + spreadOffset;
  const outerGap = settings.crosshair.outerLines.gap + spreadOffset * 1.15;
  const crosshairStyle = ({
    ["--ch-color" as string]: CROSSHAIR_COLOR_HEX[settings.crosshair.color],
    ["--ch-outline-enabled" as string]: settings.crosshair.outline.enabled
      ? "1"
      : "0",
    ["--ch-outline-thickness" as string]: `${settings.crosshair.outline.thickness}`,
    ["--ch-outline-opacity" as string]: `${settings.crosshair.outline.opacity}`,
    ["--ch-center-size" as string]: `${settings.crosshair.centerDot.size}`,
    ["--ch-center-thickness" as string]: `${settings.crosshair.centerDot.thickness}`,
    ["--ch-inner-length" as string]: `${settings.crosshair.innerLines.length}`,
    ["--ch-inner-thickness" as string]: `${settings.crosshair.innerLines.thickness}`,
    ["--ch-inner-gap" as string]: `${innerGap}`,
    ["--ch-outer-length" as string]: `${settings.crosshair.outerLines.length}`,
    ["--ch-outer-thickness" as string]: `${settings.crosshair.outerLines.thickness}`,
    ["--ch-outer-gap" as string]: `${outerGap}`,
    ["--sniper-cycle-progress" as string]: `${sniperRechamberProgress}`,
  } as CSSProperties);
  const redDotStyle = ({
    ["--ch-color" as string]: CROSSHAIR_COLOR_HEX[settings.crosshair.redDot.color],
    ["--ch-outline-enabled" as string]: settings.crosshair.redDot.outline.enabled
      ? "1"
      : "0",
    ["--ch-outline-thickness" as string]: `${settings.crosshair.redDot.outline.thickness}`,
    ["--ch-outline-opacity" as string]: `${settings.crosshair.redDot.outline.opacity}`,
    ["--ch-center-size" as string]: `${settings.crosshair.redDot.centerDot.size}`,
    ["--ch-center-thickness" as string]: `${settings.crosshair.redDot.centerDot.thickness}`,
    ["--ch-inner-length" as string]: `${settings.crosshair.redDot.innerLines.length}`,
    ["--ch-inner-thickness" as string]: `${settings.crosshair.redDot.innerLines.thickness}`,
    ["--ch-inner-gap" as string]: `${settings.crosshair.redDot.innerLines.gap}`,
    ["--ch-outer-length" as string]: `${settings.crosshair.redDot.outerLines.length}`,
    ["--ch-outer-thickness" as string]: `${settings.crosshair.redDot.outerLines.thickness}`,
    ["--ch-outer-gap" as string]: `${settings.crosshair.redDot.outerLines.gap}`,
  } as CSSProperties);
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
  const duplicateControllerButtonIndices = useMemo(() => {
    const buttonCounts = new Map<number, number>();
    for (const index of Object.values(settings.controllerBindings)) {
      buttonCounts.set(index, (buttonCounts.get(index) ?? 0) + 1);
    }
    return new Set(
      [...buttonCounts.entries()].filter(([, count]) => count > 1).map(([index]) =>
        index
      ),
    );
  }, [settings.controllerBindings]);

  const effectiveRifleAds =
    (settings.sensitivity.look * settings.sensitivity.rifleAds).toFixed(2);
  const effectiveSniperAds =
    (settings.sensitivity.look * settings.sensitivity.sniperAds).toFixed(2);
  const interactItemLabel = player.interactWeaponKind === "sniper"
    ? "Sniper"
    : player.interactWeaponKind === "rifle"
    ? "Rifle"
    : "Item";
  const pickupPromptLabel = player.controllerConnected
    ? formatControllerButtonIndex(settings.controllerBindings.pickup)
    : formatKeyCode(settings.keybinds.pickup);
  const interactPromptLabel = player.canInteract
    ? `Press ${pickupPromptLabel} to loot ${
      interactItemLabel
    }`
    : "";

  const canInstallUpdate = updaterStatus.phase === "downloaded";
  const installUpdateInProgress = updaterBusyAction === "install";
  const gameplayHudVisible = phase === "playing";
  const showInventoryOverlay = gameplayHudVisible && player.inventoryPanelOpen;
  const showInteractPrompt = gameplayHudVisible && !isGameplayPaused &&
    !showInventoryOverlay &&
    player.canInteract;
  const combatHudVisible = gameplayHudVisible && !showInventoryOverlay;
  const uiOverlayClassName = "ui-overlay";
  const renderCrosshair = (
    className = "",
    showProgress = false,
  ) => (
    <div
      className={`crosshair ${className}`.trim()}
      style={crosshairStyle}
    >
      {settings.crosshair.centerDot.enabled
        ? (
          <div className="crosshair-center" aria-hidden="true">
            <span className="crosshair-center-line horizontal" />
            <span className="crosshair-center-line vertical" />
          </div>
        )
        : null}
      {settings.crosshair.innerLines.enabled
        ? (
          <div className="crosshair-lines inner" aria-hidden="true">
            <span className="line top" />
            <span className="line right" />
            <span className="line bottom" />
            <span className="line left" />
          </div>
        )
        : null}
      {settings.crosshair.outerLines.enabled
        ? (
          <div className="crosshair-lines outer" aria-hidden="true">
            <span className="line top" />
            <span className="line right" />
            <span className="line bottom" />
            <span className="line left" />
          </div>
        )
        : null}
      {showProgress ? <div className="crosshair-progress active" /> : null}
    </div>
  );
  const renderRedDotCrosshair = (className = "") => (
    <div
      className={`crosshair ${className}`.trim()}
      style={redDotStyle}
    >
      {settings.crosshair.redDot.centerDot.enabled
        ? (
          <div className="crosshair-center" aria-hidden="true">
            <span className="crosshair-center-line horizontal" />
            <span className="crosshair-center-line vertical" />
          </div>
        )
        : null}
      {settings.crosshair.redDot.innerLines.enabled
        ? (
          <div className="crosshair-lines inner" aria-hidden="true">
            <span className="line top" />
            <span className="line right" />
            <span className="line bottom" />
            <span className="line left" />
          </div>
        )
        : null}
      {settings.crosshair.redDot.outerLines.enabled
        ? (
          <div className="crosshair-lines outer" aria-hidden="true">
            <span className="line top" />
            <span className="line right" />
            <span className="line bottom" />
            <span className="line left" />
          </div>
        )
        : null}
    </div>
  );

  useControllerUiNavigation({
    active: showSettingsModal,
    rootRef: settingsModalRef,
    onBack: handleControllerOverlayBack,
  });

  useControllerUiNavigation({
    active: !showSettingsModal && (phase === "menu" || showInventoryOverlay),
    rootRef: appShellRef,
  });

  return (
    <div
      ref={appShellRef}
      data-controller-nav-scope="true"
      className={`app-shell ${
        showInventoryOverlay ? "inventory-open" : isGameplayPaused ? "paused" : "playing"
      } phase-${phase}`}
    >
      <LobbyMusicController
        active={!booting && phase === "menu"}
        musicVolume={audioVolumes.music}
      />

      <Scene
        ref={sceneRef}
        settings={settings}
        audioVolumes={audioVolumes}
        stressCount={sceneStressCount}
        practiceMap={selectedMap}
        selectedSkyId={selectedSkyId}
        booting={booting}
        deferredAssetsEnabled={deferredAssetsEnabled}
        presentation={renderedPresentation}
        gameplayInputEnabled={!pauseMenuOpen && phase === "playing"}
        onPerfMetrics={setPerfMetrics}
        onPlayerSnapshot={setPlayer}
        onHitMarker={handleHitMarker}
        onShotFired={handleShotFired}
        onWeaponEquippedChange={setWeaponEquipped}
        onActiveWeaponChange={setActiveWeapon}
        onSniperRechamberChange={setSniperRechamber}
        onAimingStateChange={setAimingState}
        onBootReady={onSceneBootReady}
        characterOverride={characterOverride}
        onPauseMenuToggle={handlePauseMenuToggle}
      />

      {phase === "menu"
        ? (
          <ExperienceMenuOverlay
            onEnterPractice={handleEnterPractice}
            onOpenSettings={handleOpenSettingsModal}
            updateReadyToInstall={canInstallUpdate}
            updateTargetVersion={updaterStatus.targetVersion}
            installingUpdate={installUpdateInProgress}
            onInstallUpdate={() => { void handleInstallUpdate(); }}
            selectedCharacterId={selectedCharacterId}
            onCharacterSelect={setSelectedCharacterId}
            selectedSkyId={selectedSkyId}
            onSkySelect={setSelectedSkyId}
            selectedMapId={selectedMapId}
            onMapSelect={setSelectedMapId}
            updaterStatus={updaterStatus}
            updaterBusyAction={updaterBusyAction}
            updaterAvailable={updaterAvailable}
            onCheckForUpdates={() => { void handleCheckForUpdates(); }}
          />
        )
        : null}

      {practiceLoading ? <PracticeLoadingOverlay mapLabel={selectedMap.label} /> : null}

      <div className={uiOverlayClassName}>
        {combatHudVisible && hudPanels.statsBar
          ? (
            <div className="corner-top-right">
              <MinimalStatsBar metrics={perfMetrics} visible />
            </div>
          )
          : null}

        <div className="center-stack">
          {combatHudVisible && !isGameplayPaused && !isAimingDownSight
            ? (
              renderCrosshair(
                activeWeapon === "sniper" && sniperRechamber.active
                  ? "rechambering"
                  : "",
                activeWeapon === "sniper" && sniperRechamber.active,
              )
            )
            : null}
          {combatHudVisible && !isGameplayPaused && isAimingDownSight && activeWeapon === "rifle"
            ? renderRedDotCrosshair()
            : null}
          {isAimingDownSight && activeWeapon === "sniper" && combatHudVisible
            ? (
              <div
                className="sniper-scope-overlay"
                style={
                  {
                    "--scope-dot-size": `${settings.crosshair.ads.sniperDotSize}`,
                    "--scope-dot-color":
                      CROSSHAIR_COLOR_HEX[
                        settings.crosshair.ads.sniperDotColor
                      ],
                    "--ch-outline-enabled": settings.crosshair.outline.enabled
                      ? "1"
                      : "0",
                    "--ch-outline-thickness": `${settings.crosshair.outline.thickness}`,
                    "--ch-outline-opacity": `${settings.crosshair.outline.opacity}`,
                    "--sniper-cycle-progress": `${sniperRechamberProgress}`,
                  } as React.CSSProperties
                }
              >
                <div className="sniper-ads-reticle">
                  <div className="scope-reticle">
                    <div className="scope-line vertical" />
                    <div className="scope-line horizontal" />
                    <div className="scope-center-dot" />
                    <div className="scope-hash hash-1" />
                    <div className="scope-hash hash-2" />
                    <div className="scope-hash hash-3" />
                  </div>
                  {sniperRechamber.active
                    ? <div className="scope-rechamber" />
                    : null}
                </div>
              </div>
            )
            : null}
          {combatHudVisible && !isGameplayPaused
            ? (
              <div
                className={`hit-marker ${
                  hitMarkerVisible ? "visible" : ""
                } ${hitMarker.kind}`}
              />
            )
            : null}
          {combatHudVisible && !isGameplayPaused && damageNumbers.length > 0
            ? (
              <div className="damage-numbers-container">
                {damageNumbers.map((dn) => {
                  const fontSize = Math.min(
                    48,
                    18 + dn.damage * 0.2,
                  );
                  return (
                    <div
                      key={dn.id}
                      className={`damage-number ${dn.kind}`}
                      style={
                        { "--dmg-font-size": `${fontSize}px` } as CSSProperties
                      }
                    >
                      {Math.round(dn.damage)}
                    </div>
                  );
                })}
              </div>
            )
            : null}
          {showInteractPrompt
            ? (
              <div className="interact-prompt" role="status">
                {interactPromptLabel}
              </div>
            )
            : null}
          {showInventoryOverlay
            ? (
              <PubgInventoryOverlay
                inventory={player.inventory}
                player={player}
                keybinds={settings.keybinds}
                onMoveItem={handleMoveInventoryItem}
                onQuickMove={handleQuickMoveInventoryItem}
              />
            )
            : null}


          {showSettingsModal
            ? (
              <div
                className="lobby-settings-overlay"
                style={{ background: "rgba(5, 5, 5, 0.95)" }}
                onClick={menuSettingsOpen
                  ? handleCloseSettingsModal
                  : (e) => e.stopPropagation()}
                onMouseDown={menuSettingsOpen
                  ? handleCloseSettingsModal
                  : (e) => e.stopPropagation()}
              >
                <div
                  className="lobby-settings-modal"
                  ref={settingsModalRef}
                  data-controller-nav-scope="true"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.code !== "Escape") {
                      return;
                    }
                    if (showPauseMenu) {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    handleCloseSettingsModal();
                  }}
                  role="dialog"
                  aria-label={showPauseMenu ? "Pause menu" : "Settings"}
                  tabIndex={-1}
                >
                  <div className="lobby-settings-header">
                    <h2>{menuTitle(menuTab)}</h2>
                    <button
                      type="button"
                      className="lobby-settings-close"
                      aria-label={showPauseMenu ? "Resume game" : "Close settings"}
                      onClick={showPauseMenu
                        ? handleCloseMenuAndResume
                        : handleCloseSettingsModal}
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
                          data-controller-default-focus={menuTab === tab.id
                            ? "true"
                            : undefined}
                          className={`lobby-settings-tab ${
                            menuTab === tab.id ? "active" : ""
                          }`}
                          onClick={() => {
                            setMenuTab(tab.id);
                            setBindingCapture(null);
                            setControllerBindingCapture(null);
                          }}
                        >
                          <span className="settings-tab-copy">
                            <span className="settings-tab-label">{tab.label}</span>
                            <span className="settings-tab-hint">{tab.hint}</span>
                          </span>
                        </button>
                      ))}
                      <div style={{ marginTop: "auto" }}>
                        <button
                          type="button"
                          className="lobby-settings-tab"
                          onClick={showPauseMenu
                            ? handleCloseMenuAndResume
                            : handleCloseSettingsModal}
                        >
                          {showPauseMenu ? "Resume" : "Close"}
                        </button>
                        {showPauseMenu ? (
                          <button
                            type="button"
                            className="btn-lobby-return"
                            onClick={handleReturnToLobby}
                          >
                            Return to Lobby
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn-quit-app"
                          onClick={() => {
                            const api = (window as unknown as { electronAPI?: { quitApp?: () => void } }).electronAPI;
                            if (api?.quitApp) {
                              api.quitApp();
                            } else {
                              window.close();
                            }
                          }}
                        >
                          Quit Game
                        </button>
                      </div>
                    </aside>
                    <section
                      className="lobby-settings-content"
                      data-controller-scroll-container="true"
                    >

                    {menuTab === "sensitivity"
                      ? (
                        <div className="menu-sections">
                          <MenuSection
                            title="Mouse look"
                            blurb="Tune mouse aim speed and ADS multipliers. Changes apply live."
                          >
                            <RangeField
                              label="Look speed"
                              hint="Base mouse speed while hip-firing."
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
                              label="Rifle ADS multiplier"
                              hint="Mouse speed multiplier while aiming the rifle."
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
                              label="Sniper ADS multiplier"
                              hint="Mouse speed multiplier while aiming the sniper."
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
                              hint="Adjust vertical mouse speed without changing horizontal aim."
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
                            title="Controller look"
                            blurb="Make the sticks feel predictable instead of mushy."
                          >
                            <RangeField
                              label="Look sensitivity X"
                              hint="Horizontal camera speed on the right stick."
                              value={settings.controller.lookSensitivityX}
                              min={0.2}
                              max={3}
                              step={0.05}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  controller: {
                                    ...prev.controller,
                                    lookSensitivityX: value,
                                  },
                                }))}
                            />
                            <RangeField
                              label="Look sensitivity Y"
                              hint="Vertical camera speed on the right stick."
                              value={settings.controller.lookSensitivityY}
                              min={0.2}
                              max={3}
                              step={0.05}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  controller: {
                                    ...prev.controller,
                                    lookSensitivityY: value,
                                  },
                                }))}
                            />
                            <RangeField
                              label="Move deadzone"
                              hint="How far the left stick must move before movement starts."
                              value={settings.controller.moveDeadzone}
                              min={0}
                              max={0.4}
                              step={0.01}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  controller: {
                                    ...prev.controller,
                                    moveDeadzone: value,
                                  },
                                }))}
                            />
                            <RangeField
                              label="Look deadzone"
                              hint="How far the right stick must move before camera look starts."
                              value={settings.controller.lookDeadzone}
                              min={0}
                              max={0.35}
                              step={0.01}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  controller: {
                                    ...prev.controller,
                                    lookDeadzone: value,
                                  },
                                }))}
                            />
                            <SwitchRow
                              label="Invert look Y"
                              hint="Push up on the right stick to look down."
                              checked={settings.controller.invertY}
                              onChange={(checked) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  controller: {
                                    ...prev.controller,
                                    invertY: checked,
                                  },
                                }))}
                            />
                          </MenuSection>
                        </div>
                      )
                      : null}

                    {menuTab === "imports"
                      ? (
                        <div className="menu-sections">
                          <MenuSection
                            title="Settings profile"
                            blurb="Copy the current profile or import one from JSON."
                          >
                            <div className="settings-json-actions">
                              <button
                                type="button"
                                className="btn"
                                onClick={() => {
                                  void handleCopySettingsProfile();
                                }}
                              >
                                Copy Current Profile
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => setSettingsImportDraft(settingsProfileJson)}
                              >
                                Load Current to Import Box
                              </button>
                            </div>
                            <div className="settings-json-block">
                              <div className="field-label">Current Profile</div>
                              <textarea
                                className="settings-json-textarea"
                                readOnly
                                value={settingsProfileJson}
                              />
                            </div>
                            <div className="settings-json-block">
                              <div className="field-label">Import Profile JSON</div>
                              <textarea
                                className="settings-json-textarea"
                                value={settingsImportDraft}
                                onChange={(event) =>
                                  setSettingsImportDraft(event.target.value)}
                                placeholder="Paste settings JSON here"
                              />
                            </div>
                            <div className="settings-chip-wrap">
                              <button
                                type="button"
                                className="btn"
                                onClick={handleImportSettingsProfile}
                              >
                                Import Profile
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
                            blurb="Set the mix for music, weapons, footsteps, hit sounds, and UI."
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
                              label="Music"
                              value={audioVolumes.music}
                              onChange={(value) =>
                                setAudioVolumes((prev) => ({
                                  ...prev,
                                  music: value,
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
                            <VolumeSlider
                              label="UI"
                              value={audioVolumes.ui}
                              onChange={(value) =>
                                setAudioVolumes((prev) => ({
                                  ...prev,
                                  ui: value,
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
                            title="Input behavior"
                            blurb="Set the basics for movement, controller support, and how the inventory behaves."
                          >
                            <SwitchRow
                              label="Enable controller input"
                              hint="Allow gameplay input from the first compatible controller."
                              checked={settings.controller.enabled}
                              onChange={(checked) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  controller: {
                                    ...prev.controller,
                                    enabled: checked,
                                  },
                                }))}
                            />
                            <SwitchRow
                              label="Controller vibration"
                              hint="Rumble on UI confirm, shots, hits, and reloads when the controller supports it."
                              checked={settings.controller.vibrationEnabled}
                              onChange={(checked) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  controller: {
                                    ...prev.controller,
                                    vibrationEnabled: checked,
                                  },
                                }))}
                            />
                            <SwitchRow
                              label="Toggle sprint"
                              hint="Press the sprint button once to keep sprinting until you press it again."
                              checked={settings.controller.toggleSprint}
                              onChange={(checked) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  controller: {
                                    ...prev.controller,
                                    toggleSprint: checked,
                                  },
                                }))}
                            />
                            <SwitchRow
                              label="Invert move Y"
                              hint="Flip forward and backward on the left stick for controllers with odd axis reporting."
                              checked={settings.controller.invertMoveY}
                              onChange={(checked) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  controller: {
                                    ...prev.controller,
                                    invertMoveY: checked,
                                  },
                                }))}
                            />
                            <div className="field-row">
                              <div>
                                <div className="field-label">Crouch mode</div>
                                <div className="field-hint">
                                  Hold keeps crouch active while the button is down. Toggle switches stance each press.
                                </div>
                              </div>
                              <div className="segmented-row compact">
                                <button
                                  type="button"
                                  className={`chip-btn ${
                                    settings.crouchMode === "hold" ? "active" : ""
                                  }`}
                                  onClick={() =>
                                    setSettings((prev) => ({
                                      ...prev,
                                      crouchMode: "hold",
                                    }))}
                                >
                                  Hold
                                </button>
                                <button
                                  type="button"
                                  className={`chip-btn ${
                                    settings.crouchMode === "toggle" ? "active" : ""
                                  }`}
                                  onClick={() =>
                                    setSettings((prev) => ({
                                      ...prev,
                                      crouchMode: "toggle",
                                    }))}
                                >
                                  Toggle
                                </button>
                              </div>
                            </div>
                            <div className="field-row">
                              <div>
                                <div className="field-label">Inventory open mode</div>
                                <div className="field-hint">
                                  Toggle keeps the inventory open until you press again. Hold closes it on release.
                                </div>
                              </div>
                              <div className="segmented-row compact">
                                <button
                                  type="button"
                                  className={`chip-btn ${
                                    settings.inventoryOpenMode === "toggle" ? "active" : ""
                                  }`}
                                  onClick={() =>
                                    setSettings((prev) => ({
                                      ...prev,
                                      inventoryOpenMode: "toggle",
                                    }))}
                                >
                                  Toggle
                                </button>
                                <button
                                  type="button"
                                  className={`chip-btn ${
                                    settings.inventoryOpenMode === "hold" ? "active" : ""
                                  }`}
                                  onClick={() =>
                                    setSettings((prev) => ({
                                      ...prev,
                                      inventoryOpenMode: "hold",
                                    }))}
                                >
                                  Hold
                                </button>
                              </div>
                            </div>
                          </MenuSection>
                          <MenuSection
                            title="Controller bindings"
                            blurb="Gameplay remaps live here. Menu confirm and back stay fixed to A and B so the UI does not eat itself."
                          >
                            {CONTROLLER_BINDING_GROUPS.map((group) => (
                              <div key={group.title} className="binding-group">
                                <div className="binding-group-header">
                                  <div className="field-label">{group.title}</div>
                                  <div className="field-hint">{group.blurb}</div>
                                </div>
                                <div className="keybind-grid controller-bind-grid">
                                  {group.bindings.map((binding) => {
                                    const buttonIndex = settings.controllerBindings[binding.key];
                                    const duplicated = duplicateControllerButtonIndices.has(
                                      buttonIndex,
                                    );
                                    const capturing = controllerBindingCapture === binding.key;
                                    return (
                                      <div
                                        key={binding.key}
                                        className={`keybind-row ${
                                          capturing ? "capturing" : ""
                                        } ${duplicated ? "duplicate" : ""}`}
                                      >
                                        <div>
                                          <div className="keybind-label">
                                            {binding.label}
                                          </div>
                                          <div className="keybind-hint">
                                            {binding.hint}
                                          </div>
                                        </div>
                                        <div className="binding-action-buttons">
                                          <button
                                            type="button"
                                            className={`keybind-btn ${
                                              capturing ? "active" : ""
                                            }`}
                                            onClick={() => {
                                              setBindingCapture(null);
                                              setControllerBindingCapture((prev) =>
                                                prev === binding.key ? null : binding.key
                                              );
                                            }}
                                          >
                                            {capturing
                                              ? "Press button..."
                                              : formatControllerButtonIndex(buttonIndex)}
                                          </button>
                                          <button
                                            type="button"
                                            className="keybind-btn keybind-btn-secondary"
                                            onClick={() => {
                                              setControllerBindingCapture((prev) =>
                                                prev === binding.key ? null : prev
                                              );
                                              setSettings((prev) => ({
                                                ...prev,
                                                controllerBindings: {
                                                  ...prev.controllerBindings,
                                                  [binding.key]:
                                                    DEFAULT_CONTROLLER_BINDINGS[binding.key],
                                                },
                                              }));
                                            }}
                                          >
                                            Reset
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                            <div className="settings-chip-wrap">
                              <span className="pill-chip">
                                Click the highlighted bind button again to cancel
                              </span>
                              <span className="pill-chip">
                                Hold Menu / Options for 0.8s to cancel from controller
                              </span>
                              <span className="pill-chip">
                                Triggers still use the lower trigger threshold in gameplay
                              </span>
                            </div>
                            {duplicateControllerButtonIndices.size > 0
                              ? (
                                <p className="warning-note">
                                  Duplicate controller bindings are allowed, but they will happily cause overlap.
                                </p>
                              )
                              : null}
                          </MenuSection>
                          <MenuSection
                            title="Keyboard bindings"
                            blurb="Click a row, press a key, and press Escape to cancel."
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
                                      onClick={() => {
                                        setControllerBindingCapture(null);
                                        setBindingCapture((
                                          prev,
                                        ) => (prev === row.key
                                          ? null
                                          : row.key)
                                        );
                                      }}
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
                                Mouse Left: Fire
                              </span>
                              <span className="pill-chip">
                                Mouse Right: ADS
                              </span>
                              <span className="pill-chip">
                                Escape cancels key capture
                              </span>
                            </div>
                            {duplicateBindingCodes.size > 0
                              ? (
                                <p className="warning-note">
                                  Duplicate keys are allowed, but they can still create chaos.
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
                            title="Render quality"
                            blurb="Adjust the scene quality and the in-game performance readout."
                          >
                            <SwitchRow
                              label="Shadows"
                              hint="Enable real-time sun shadows for the scene and targets."
                              checked={settings.shadows}
                              onChange={(checked) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  shadows: checked,
                                }))}
                            />
                            <SwitchRow
                              label="Performance HUD"
                              hint="Show the top-right panel with FPS and hardware timings."
                              checked={hudPanels.statsBar}
                              onChange={(checked) =>
                                setHudPanels((prev) => ({
                                  ...prev,
                                  statsBar: checked,
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

                    {menuTab === "crosshair"
                      ? (
                        <>
                          <div className="crosshair-preview-sticky">
                            <div className="crosshair-preview-panel">
                              <div className="crosshair-preview-stage">
                                {crosshairSubTab === "normal"
                                  ? renderCrosshair("crosshair-preview-instance")
                                  : renderRedDotCrosshair("crosshair-preview-instance")}
                              </div>
                              <div className="settings-chip-wrap">
                                {crosshairSubTab === "normal"
                                  ? (
                                    <>
                                      <span className="pill-chip">
                                        Color: {CROSSHAIR_COLOR_OPTIONS.find((option) =>
                                          option.id === settings.crosshair.color
                                        )?.label ?? "White"}
                                      </span>
                                      <span className="pill-chip">
                                        Dynamic spread: {settings.crosshair.dynamic.enabled ? "On" : "Off"}
                                      </span>
                                      <span className="pill-chip">
                                        Outline: {settings.crosshair.outline.enabled ? "On" : "Off"}
                                      </span>
                                    </>
                                  )
                                  : (
                                    <>
                                      <span className="pill-chip">
                                        Color: {CROSSHAIR_COLOR_OPTIONS.find((option) =>
                                          option.id === settings.crosshair.redDot.color
                                        )?.label ?? "Red"}
                                      </span>
                                      <span className="pill-chip">
                                        Outline: {settings.crosshair.redDot.outline.enabled ? "On" : "Off"}
                                      </span>
                                    </>
                                  )}
                              </div>
                            </div>
                          </div>

                          <div className="crosshair-sub-tabs">
                            <button
                              type="button"
                              className={`crosshair-sub-tab ${crosshairSubTab === "normal" ? "active" : ""}`}
                              onClick={() => setCrosshairSubTab("normal")}
                            >
                              Normal
                            </button>
                            <button
                              type="button"
                              className={`crosshair-sub-tab ${crosshairSubTab === "redDot" ? "active" : ""}`}
                              onClick={() => setCrosshairSubTab("redDot")}
                            >
                              Red Dot (ADS)
                            </button>
                          </div>

                          <div className="menu-sections">
                          {crosshairSubTab === "normal"
                            ? (
                              <>
                          <MenuSection
                            title="Base crosshair"
                            blurb="Choose the shape, color, and spacing for the main reticle."
                          >
                            <div className="field-row">
                              <div>
                                <div className="field-label">Primary Color</div>
                                <div className="field-hint">
                                  Applies to center, inner, and outer lines
                                </div>
                              </div>
                              <div className="color-chip-row">
                                {CROSSHAIR_COLOR_OPTIONS.map((option) => (
                                  <button
                                    key={option.id}
                                    type="button"
                                    className={`color-chip ${
                                      settings.crosshair.color === option.id
                                        ? "active"
                                        : ""
                                    }`}
                                    onClick={() =>
                                      setSettings((prev) => ({
                                        ...prev,
                                        crosshair: {
                                          ...prev.crosshair,
                                          color: option.id,
                                        },
                                      }))}
                                  >
                                    <span
                                      className="color-chip-swatch"
                                      style={{
                                        backgroundColor:
                                          CROSSHAIR_COLOR_HEX[option.id],
                                      }}
                                    />
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <SwitchRow
                              label="Center Dot"
                              hint="Enable center mark"
                              checked={settings.crosshair.centerDot.enabled}
                              onChange={(checked) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    centerDot: {
                                      ...prev.crosshair.centerDot,
                                      enabled: checked,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Center Size"
                              value={settings.crosshair.centerDot.size}
                              min={1}
                              max={18}
                              step={0.5}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    centerDot: {
                                      ...prev.crosshair.centerDot,
                                      size: value,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Center Thickness"
                              value={settings.crosshair.centerDot.thickness}
                              min={1}
                              max={12}
                              step={0.5}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    centerDot: {
                                      ...prev.crosshair.centerDot,
                                      thickness: value,
                                    },
                                  },
                                }))}
                            />

                            <SwitchRow
                              label="Inner Lines"
                              hint="Main four lines around center"
                              checked={settings.crosshair.innerLines.enabled}
                              onChange={(checked) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    innerLines: {
                                      ...prev.crosshair.innerLines,
                                      enabled: checked,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Inner Length"
                              value={settings.crosshair.innerLines.length}
                              min={1}
                              max={28}
                              step={0.5}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    innerLines: {
                                      ...prev.crosshair.innerLines,
                                      length: value,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Inner Thickness"
                              value={settings.crosshair.innerLines.thickness}
                              min={1}
                              max={10}
                              step={0.5}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    innerLines: {
                                      ...prev.crosshair.innerLines,
                                      thickness: value,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Inner Gap"
                              value={settings.crosshair.innerLines.gap}
                              min={0}
                              max={28}
                              step={0.5}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    innerLines: {
                                      ...prev.crosshair.innerLines,
                                      gap: value,
                                    },
                                  },
                                }))}
                            />

                            <SwitchRow
                              label="Outer Lines"
                              hint="Secondary line ring"
                              checked={settings.crosshair.outerLines.enabled}
                              onChange={(checked) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    outerLines: {
                                      ...prev.crosshair.outerLines,
                                      enabled: checked,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Outer Length"
                              value={settings.crosshair.outerLines.length}
                              min={1}
                              max={28}
                              step={0.5}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    outerLines: {
                                      ...prev.crosshair.outerLines,
                                      length: value,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Outer Thickness"
                              value={settings.crosshair.outerLines.thickness}
                              min={1}
                              max={10}
                              step={0.5}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    outerLines: {
                                      ...prev.crosshair.outerLines,
                                      thickness: value,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Outer Gap"
                              value={settings.crosshair.outerLines.gap}
                              min={0}
                              max={36}
                              step={0.5}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    outerLines: {
                                      ...prev.crosshair.outerLines,
                                      gap: value,
                                    },
                                  },
                                }))}
                            />

                            <SwitchRow
                              label="Black Outline"
                              hint="Adds contrast behind center + lines"
                              checked={settings.crosshair.outline.enabled}
                              onChange={(checked) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    outline: {
                                      ...prev.crosshair.outline,
                                      enabled: checked,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Outline Thickness"
                              value={settings.crosshair.outline.thickness}
                              min={0}
                              max={4}
                              step={0.1}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    outline: {
                                      ...prev.crosshair.outline,
                                      thickness: value,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Outline Opacity"
                              value={settings.crosshair.outline.opacity}
                              min={0}
                              max={1}
                              step={0.01}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    outline: {
                                      ...prev.crosshair.outline,
                                      opacity: value,
                                    },
                                  },
                                }))}
                            />

                            <RangeField
                              label="Rifle Gap Multiplier"
                              value={settings.crosshair.weaponModifiers.rifleGapMultiplier}
                              min={0.5}
                              max={2}
                              step={0.01}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    weaponModifiers: {
                                      ...prev.crosshair.weaponModifiers,
                                      rifleGapMultiplier: value,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Sniper Gap Multiplier"
                              value={settings.crosshair.weaponModifiers.sniperGapMultiplier}
                              min={0.5}
                              max={2}
                              step={0.01}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    weaponModifiers: {
                                      ...prev.crosshair.weaponModifiers,
                                      sniperGapMultiplier: value,
                                    },
                                  },
                                }))}
                            />
                          </MenuSection>

                          <MenuSection
                            title="Dynamic Spread"
                            blurb="Optional visual bloom that reacts to movement and shots. It does not change weapon accuracy."
                          >
                            <SwitchRow
                              label="Dynamic Spread"
                              hint="Expand the crosshair while moving and firing."
                              checked={settings.crosshair.dynamic.enabled}
                              onChange={(checked) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    dynamic: {
                                      ...prev.crosshair.dynamic,
                                      enabled: checked,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Idle Spread"
                              value={settings.crosshair.dynamic.idleSpread}
                              min={0}
                              max={16}
                              step={0.1}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    dynamic: {
                                      ...prev.crosshair.dynamic,
                                      idleSpread: value,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Walk Spread"
                              value={settings.crosshair.dynamic.walkSpread}
                              min={0}
                              max={20}
                              step={0.1}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    dynamic: {
                                      ...prev.crosshair.dynamic,
                                      walkSpread: value,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Run Spread"
                              value={settings.crosshair.dynamic.runSpread}
                              min={0}
                              max={28}
                              step={0.1}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    dynamic: {
                                      ...prev.crosshair.dynamic,
                                      runSpread: value,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Shot Bloom Kick"
                              value={settings.crosshair.dynamic.shotKick}
                              min={0}
                              max={8}
                              step={0.1}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    dynamic: {
                                      ...prev.crosshair.dynamic,
                                      shotKick: value,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Bloom Recovery"
                              value={settings.crosshair.dynamic.recoveryPerSecond}
                              min={1}
                              max={60}
                              step={0.5}
                              suffix=" /s"
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    dynamic: {
                                      ...prev.crosshair.dynamic,
                                      recoveryPerSecond: value,
                                    },
                                  },
                                }))}
                            />
                          </MenuSection>

                          <MenuSection
                            title="Sniper scope"
                            blurb="Adjust the center dot used while aiming the sniper."
                          >
                            <RangeField
                              label="Sniper Dot Size"
                              value={settings.crosshair.ads.sniperDotSize}
                              min={1}
                              max={18}
                              step={0.5}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    ads: {
                                      ...prev.crosshair.ads,
                                      sniperDotSize: value,
                                    },
                                  },
                                }))}
                            />
                            <div className="field-row">
                              <div>
                                <div className="field-label">
                                  Sniper Dot Color
                                </div>
                                <div className="field-hint">
                                  Scope center marker
                                </div>
                              </div>
                              <div className="color-chip-row">
                                {CROSSHAIR_COLOR_OPTIONS.map((option) => (
                                  <button
                                    key={`sniper-dot-${option.id}`}
                                    type="button"
                                    className={`color-chip ${
                                      settings.crosshair.ads.sniperDotColor ===
                                        option.id
                                        ? "active"
                                        : ""
                                    }`}
                                    onClick={() =>
                                      setSettings((prev) => ({
                                        ...prev,
                                        crosshair: {
                                          ...prev.crosshair,
                                          ads: {
                                            ...prev.crosshair.ads,
                                            sniperDotColor: option.id,
                                          },
                                        },
                                      }))}
                                  >
                                    <span
                                      className="color-chip-swatch"
                                      style={{
                                        backgroundColor:
                                          CROSSHAIR_COLOR_HEX[option.id],
                                      }}
                                    />
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </MenuSection>
                              </>
                            )
                            : (
                              <>
                          <MenuSection
                            title="Red Dot Crosshair"
                            blurb="Shape and color for the rifle ADS reticle."
                          >
                            <div className="field-row">
                              <div>
                                <div className="field-label">Primary Color</div>
                                <div className="field-hint">
                                  Applies to center, inner, and outer lines
                                </div>
                              </div>
                              <div className="color-chip-row">
                                {CROSSHAIR_COLOR_OPTIONS.map((option) => (
                                  <button
                                    key={`rd-color-${option.id}`}
                                    type="button"
                                    className={`color-chip ${
                                      settings.crosshair.redDot.color === option.id
                                        ? "active"
                                        : ""
                                    }`}
                                    onClick={() =>
                                      setSettings((prev) => ({
                                        ...prev,
                                        crosshair: {
                                          ...prev.crosshair,
                                          redDot: {
                                            ...prev.crosshair.redDot,
                                            color: option.id,
                                          },
                                        },
                                      }))}
                                  >
                                    <span
                                      className="color-chip-swatch"
                                      style={{
                                        backgroundColor:
                                          CROSSHAIR_COLOR_HEX[option.id],
                                      }}
                                    />
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <SwitchRow
                              label="Center Dot"
                              hint="Enable center mark"
                              checked={settings.crosshair.redDot.centerDot.enabled}
                              onChange={(checked) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    redDot: {
                                      ...prev.crosshair.redDot,
                                      centerDot: {
                                        ...prev.crosshair.redDot.centerDot,
                                        enabled: checked,
                                      },
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Center Size"
                              value={settings.crosshair.redDot.centerDot.size}
                              min={1}
                              max={18}
                              step={0.5}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    redDot: {
                                      ...prev.crosshair.redDot,
                                      centerDot: {
                                        ...prev.crosshair.redDot.centerDot,
                                        size: value,
                                      },
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Center Thickness"
                              value={settings.crosshair.redDot.centerDot.thickness}
                              min={1}
                              max={12}
                              step={0.5}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    redDot: {
                                      ...prev.crosshair.redDot,
                                      centerDot: {
                                        ...prev.crosshair.redDot.centerDot,
                                        thickness: value,
                                      },
                                    },
                                  },
                                }))}
                            />

                            <SwitchRow
                              label="Inner Lines"
                              hint="Main four lines around center"
                              checked={settings.crosshair.redDot.innerLines.enabled}
                              onChange={(checked) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    redDot: {
                                      ...prev.crosshair.redDot,
                                      innerLines: {
                                        ...prev.crosshair.redDot.innerLines,
                                        enabled: checked,
                                      },
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Inner Length"
                              value={settings.crosshair.redDot.innerLines.length}
                              min={1}
                              max={28}
                              step={0.5}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    redDot: {
                                      ...prev.crosshair.redDot,
                                      innerLines: {
                                        ...prev.crosshair.redDot.innerLines,
                                        length: value,
                                      },
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Inner Thickness"
                              value={settings.crosshair.redDot.innerLines.thickness}
                              min={1}
                              max={10}
                              step={0.5}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    redDot: {
                                      ...prev.crosshair.redDot,
                                      innerLines: {
                                        ...prev.crosshair.redDot.innerLines,
                                        thickness: value,
                                      },
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Inner Gap"
                              value={settings.crosshair.redDot.innerLines.gap}
                              min={0}
                              max={28}
                              step={0.5}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    redDot: {
                                      ...prev.crosshair.redDot,
                                      innerLines: {
                                        ...prev.crosshair.redDot.innerLines,
                                        gap: value,
                                      },
                                    },
                                  },
                                }))}
                            />

                            <SwitchRow
                              label="Outer Lines"
                              hint="Secondary line ring"
                              checked={settings.crosshair.redDot.outerLines.enabled}
                              onChange={(checked) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    redDot: {
                                      ...prev.crosshair.redDot,
                                      outerLines: {
                                        ...prev.crosshair.redDot.outerLines,
                                        enabled: checked,
                                      },
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Outer Length"
                              value={settings.crosshair.redDot.outerLines.length}
                              min={1}
                              max={28}
                              step={0.5}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    redDot: {
                                      ...prev.crosshair.redDot,
                                      outerLines: {
                                        ...prev.crosshair.redDot.outerLines,
                                        length: value,
                                      },
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Outer Thickness"
                              value={settings.crosshair.redDot.outerLines.thickness}
                              min={1}
                              max={10}
                              step={0.5}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    redDot: {
                                      ...prev.crosshair.redDot,
                                      outerLines: {
                                        ...prev.crosshair.redDot.outerLines,
                                        thickness: value,
                                      },
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Outer Gap"
                              value={settings.crosshair.redDot.outerLines.gap}
                              min={0}
                              max={36}
                              step={0.5}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    redDot: {
                                      ...prev.crosshair.redDot,
                                      outerLines: {
                                        ...prev.crosshair.redDot.outerLines,
                                        gap: value,
                                      },
                                    },
                                  },
                                }))}
                            />

                            <SwitchRow
                              label="Black Outline"
                              hint="Adds contrast behind center + lines"
                              checked={settings.crosshair.redDot.outline.enabled}
                              onChange={(checked) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    redDot: {
                                      ...prev.crosshair.redDot,
                                      outline: {
                                        ...prev.crosshair.redDot.outline,
                                        enabled: checked,
                                      },
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Outline Thickness"
                              value={settings.crosshair.redDot.outline.thickness}
                              min={0}
                              max={4}
                              step={0.1}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    redDot: {
                                      ...prev.crosshair.redDot,
                                      outline: {
                                        ...prev.crosshair.redDot.outline,
                                        thickness: value,
                                      },
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Outline Opacity"
                              value={settings.crosshair.redDot.outline.opacity}
                              min={0}
                              max={1}
                              step={0.01}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  crosshair: {
                                    ...prev.crosshair,
                                    redDot: {
                                      ...prev.crosshair.redDot,
                                      outline: {
                                        ...prev.crosshair.redDot.outline,
                                        opacity: value,
                                      },
                                    },
                                  },
                                }))}
                            />
                          </MenuSection>
                              </>
                            )}
                          </div>
                        </>
                      )
                      : null}

                    {menuTab === "system"
                      ? (
                        <div className="menu-sections">
                          <MenuSection
                            title="Repair Installation"
                            blurb="Re-run the repair flow if files are missing or broken."
                          >
                            <div className="update-action-row">
                              <button
                                type="button"
                                className="btn"
                                onClick={() => { void handleRepairInstall(); }}
                                disabled={!updaterAvailable || updaterBusyAction !== null}
                              >
                                {updaterBusyAction === "repair"
                                  ? "Repairing..."
                                  : "Repair installation"}
                              </button>
                            </div>
                            {!updaterAvailable
                              ? (
                                <p className="warning-note">
                                  Updater API unavailable in this runtime.
                                </p>
                              )
                              : null}
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

        {combatHudVisible && !isGameplayPaused ? (
          <PubgHud player={player} visible />
        ) : null}

      </div>
      {showClickToContinueOverlay ? (
        <div
          className="click-to-continue-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Click to continue"
        >
          <p className="click-to-continue-label">Click to continue</p>
        </div>
      ) : null}
      <ControllerCursor
        enabled={settings.controller.enabled &&
          !practiceLoading &&
          (phase === "menu" || showSettingsModal || showInventoryOverlay)}
        scopeRef={showSettingsModal ? settingsModalRef : appShellRef}
        moveDeadzone={settings.controller.moveDeadzone}
        inputSuspended={controllerBindingCapture !== null}
        vibrationEnabled={settings.controller.vibrationEnabled}
        onBack={showSettingsModal ? handleControllerOverlayBack : undefined}
      />
      <div
        className="kill-pulse-overlay"
        style={{
          opacity: killPulseAmount * 0.72,
          ["--kill-pulse" as string]: `${killPulseAmount}`,
        }}
      />
    </div>
  );
}
