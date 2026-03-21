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
import { type AudioVolumeSettings } from "./Audio";
import { getCharacterById } from "./characters";
import { ExperienceMenuOverlay } from "./ExperienceMenuOverlay";
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
  MetricCard,
  SwitchRow,
  RangeField,
  VolumeSlider,
  formatKeyCode,
  menuTitle,
} from "./SettingsPanels";
import { PubgInventoryOverlay } from "./inventory/PubgInventoryOverlay";
import type { SniperRechamberState, WeaponKind } from "./Weapon";
import {
  DEFAULT_PERF_METRICS,
  DEFAULT_PLAYER_SNAPSHOT,
  DEFAULT_WEAPON_RECOIL_PROFILES,
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
  PRACTICE_MAP_OPTIONS,
} from "./scene/practice-maps";
import {
  type BindingKey,
  type PauseMenuTab,
  STRESS_STEPS,
  PIXEL_RATIO_OPTIONS,
  MENU_TABS,
  BINDING_ROWS,
  OVERLAY_ROWS,
  loadPersistedSettings,
  parsePersistedSettings,
  savePersistedSettings,
} from "./settings";

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

function isLoadoutSlotEqual(
  previous: PlayerSnapshot["weaponLoadout"]["slotA"],
  next: PlayerSnapshot["weaponLoadout"]["slotA"],
) {
  return previous.weaponKind === next.weaponKind &&
    previous.hasWeapon === next.hasWeapon &&
    previous.magAmmo === next.magAmmo &&
    previous.reserveAmmo === next.reserveAmmo &&
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
  const sceneRef = useRef<SceneHandle | null>(null);
  const settingsModalRef = useRef<HTMLDivElement | null>(null);
  const [settings, setSettings] = useState<GameSettings>(
    persistedSettings.settings,
  );
  const [hudPanels, setHudPanels] = useState<HudOverlayToggles>(
    persistedSettings.hudPanels,
  );
  const [menuTab, setMenuTab] = useState<PauseMenuTab>("gameplay");
  const [bindingCapture, setBindingCapture] = useState<BindingKey | null>(null);
  const bindingCaptureRef = useRef<BindingKey | null>(null);
  const [stressCount, setStressCount] = useState<StressModeCount>(
    persistedSettings.stressCount,
  );
  const [audioVolumes, setAudioVolumes] = useState<AudioVolumeSettings>(
    persistedSettings.audioVolumes,
  );
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>(
    persistedSettings.selectedCharacterId,
  );
  const [selectedMapId, setSelectedMapId] = useState<MapId>(
    persistedSettings.selectedMapId,
  );
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
  const [weaponEquipped, setWeaponEquipped] = useState(false);
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
    (phase === "playing" && needsPointerLock && !inventoryOpen);

  useEffect(() => {
    pauseMenuOpenRef.current = pauseMenuOpen;
  }, [pauseMenuOpen]);

  useEffect(() => {
    bindingCaptureRef.current = bindingCapture;
  }, [bindingCapture]);

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
  }, [needsPointerLock]);

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
    phase === "playing" && needsPointerLock && !showSettingsModal;

  const handleCloseMenuAndResume = useCallback(() => {
    setBindingCapture(null);
    setMenuSettingsOpen(false);
    setPauseMenuOpen(false);
    window.focus();
    setNeedsPointerLock(true);
  }, []);

  const handlePauseMenuToggle = useCallback(() => {
    if (bindingCaptureRef.current) {
      return;
    }
    if (pauseMenuOpenRef.current) {
      handleCloseMenuAndResume();
      return;
    }
    setNeedsPointerLock(false);
    setBindingCapture(null);
    setMenuSettingsOpen(false);
    setPauseMenuOpen(true);
    sceneRef.current?.releasePointerLock();
  }, [handleCloseMenuAndResume]);

  const handleCloseSettingsModal = useCallback(() => {
    setBindingCapture(null);
    setMenuSettingsOpen(false);
  }, []);

  const handleOpenSettingsModal = useCallback(() => {
    setBindingCapture(null);
    setMenuSettingsOpen(true);
  }, []);

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

  const handleEnterPractice = useCallback(() => {
    flushSync(() => {
      setMenuSettingsOpen(false);
      setPauseMenuOpen(false);
      setBindingCapture(null);
      setHitMarker({ until: 0, kind: "body" });
      enteredPlayingAtRef.current = performance.now();
      setPhase("playing");
    });
    window.focus();
    setNeedsPointerLock(true);
  }, []);

  const handleReturnToLobby = useCallback(() => {
    setNeedsPointerLock(false);
    setBindingCapture(null);
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
    [phase],
  );

  const handleShotFired = useCallback((state: ShotFiredState) => {
    if (phase !== "playing") {
      return;
    }
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
  }, [phase, settings.crosshair.dynamic.enabled, settings.crosshair.dynamic.shotKick]);

  const settingsProfileJson = useMemo(
    () =>
      JSON.stringify(
        {
          settings,
          hudPanels,
          stressCount,
          audioVolumes,
          selectedCharacterId,
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
      selectedMapId,
    });
  }, [
    settings,
    hudPanels,
    stressCount,
    audioVolumes,
    selectedCharacterId,
    selectedMapId,
  ]);

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
    if (!isGameplayPaused && bindingCapture) {
      setBindingCapture(null);
    }
  }, [bindingCapture, isGameplayPaused]);

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
  const practiceMapLocked = phase !== "menu";
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
  const movementTierLabel = player.movementTier === "run"
    ? "Run"
    : player.movementTier === "walk"
    ? "Walk"
    : "Jog";
  const interactItemLabel = player.interactWeaponKind === "sniper"
    ? "Sniper"
    : player.interactWeaponKind === "rifle"
    ? "Rifle"
    : "Item";
  const interactPromptLabel = player.canInteract
    ? `Press ${formatKeyCode(settings.keybinds.pickup)} to loot ${
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
  return (
    <div
      className={`app-shell ${
        showInventoryOverlay ? "inventory-open" : isGameplayPaused ? "paused" : "playing"
      } phase-${phase}`}
    >
      <Scene
        ref={sceneRef}
        settings={settings}
        audioVolumes={audioVolumes}
        stressCount={sceneStressCount}
        practiceMap={selectedMap}
        booting={booting}
        deferredAssetsEnabled={deferredAssetsEnabled}
        presentation={renderedPresentation}
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
            selectedMapId={selectedMapId}
            onMapSelect={setSelectedMapId}
            updaterStatus={updaterStatus}
            updaterBusyAction={updaterBusyAction}
            updaterAvailable={updaterAvailable}
            onCheckForUpdates={() => { void handleCheckForUpdates(); }}
          />
        )
        : null}

      <div className={uiOverlayClassName}>
        {combatHudVisible && hudPanels.statsBar
          ? (
            <div className="corner-top-right">
              <MinimalStatsBar metrics={perfMetrics} visible />
            </div>
          )
          : null}

        <div className="center-stack">
          {combatHudVisible && !isGameplayPaused && (!isAimingDownSight || activeWeapon === "rifle")
            ? (
              <div
                className={`crosshair ${
                  activeWeapon === "sniper" && sniperRechamber.active
                    ? "rechambering"
                    : ""
                }`}
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
                      <div style={{ marginTop: "auto" }}>
                        <button
                          type="button"
                          className="lobby-settings-tab"
                          onClick={handleCloseMenuAndResume}
                        >
                          Resume
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
                    <section className="lobby-settings-content">

                    {menuTab === "practice"
                      ? (
                        <div className="menu-sections">
                          <MenuSection
                            title="Map"
                            blurb="Choose the practice map before you drop into the run."
                          >
                            <div className="segmented-row">
                              {PRACTICE_MAP_OPTIONS.map((option) => (
                                <button
                                  key={option.id}
                                  type="button"
                                  className={`chip-btn ${
                                    selectedMapId === option.id ? "active" : ""
                                  }`}
                                  onClick={() => setSelectedMapId(option.id)}
                                  disabled={practiceMapLocked}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                            <p className="muted compact-note">
                              {selectedMap.description}
                            </p>
                            {practiceMapLocked ? (
                              <p className="muted compact-note">
                                Map changes are locked during a run. Return to the lobby to switch.
                              </p>
                            ) : null}
                          </MenuSection>

                          {selectedMap.supportsStressMode ? (
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
                          ) : (
                            <MenuSection
                              title="Traversal"
                              blurb="School is a clean movement sandbox while you block out the map."
                            >
                              <p className="muted compact-note">
                                No bots, no weapon spawns, and no stress boxes. This lane is movement-only for now.
                              </p>
                            </MenuSection>
                          )}

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
                                value={player.crouched
                                  ? (player.moving ? "Crouch Move" : "Crouch Idle")
                                  : player.moving
                                  ? movementTierLabel
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
                            title="Weapon Recoil Tuning"
                            blurb="Tune recoil and movement spread for rifle and sniper. Values apply immediately."
                          >
                            <div className="settings-chip-wrap">
                              <span className="pill-chip">Rifle Recoil</span>
                            </div>
                            <RangeField
                              label="Rifle Pitch Base"
                              value={settings.weaponRecoilProfiles.rifle.recoilPitchBase}
                              min={0}
                              max={0.25}
                              step={0.0001}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  weaponRecoilProfiles: {
                                    ...prev.weaponRecoilProfiles,
                                    rifle: {
                                      ...prev.weaponRecoilProfiles.rifle,
                                      recoilPitchBase: value,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Rifle Pitch Ramp"
                              value={settings.weaponRecoilProfiles.rifle.recoilPitchRamp}
                              min={0}
                              max={0.02}
                              step={0.00001}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  weaponRecoilProfiles: {
                                    ...prev.weaponRecoilProfiles,
                                    rifle: {
                                      ...prev.weaponRecoilProfiles.rifle,
                                      recoilPitchRamp: value,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Rifle Yaw Range"
                              value={settings.weaponRecoilProfiles.rifle.recoilYawRange}
                              min={0}
                              max={0.15}
                              step={0.0001}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  weaponRecoilProfiles: {
                                    ...prev.weaponRecoilProfiles,
                                    rifle: {
                                      ...prev.weaponRecoilProfiles.rifle,
                                      recoilYawRange: value,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Rifle Yaw Drift"
                              value={settings.weaponRecoilProfiles.rifle.recoilYawDrift}
                              min={0}
                              max={0.02}
                              step={0.00001}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  weaponRecoilProfiles: {
                                    ...prev.weaponRecoilProfiles,
                                    rifle: {
                                      ...prev.weaponRecoilProfiles.rifle,
                                      recoilYawDrift: value,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Rifle Move Spread Base"
                              value={settings.weaponRecoilProfiles.rifle.moveSpreadBase}
                              min={0}
                              max={1}
                              step={0.01}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  weaponRecoilProfiles: {
                                    ...prev.weaponRecoilProfiles,
                                    rifle: {
                                      ...prev.weaponRecoilProfiles.rifle,
                                      moveSpreadBase: value,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Rifle Move Spread Sprint"
                              value={settings.weaponRecoilProfiles.rifle.moveSpreadSprint}
                              min={0}
                              max={1}
                              step={0.01}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  weaponRecoilProfiles: {
                                    ...prev.weaponRecoilProfiles,
                                    rifle: {
                                      ...prev.weaponRecoilProfiles.rifle,
                                      moveSpreadSprint: value,
                                    },
                                  },
                                }))}
                            />

                            <div className="settings-chip-wrap">
                              <span className="pill-chip">Sniper Recoil</span>
                            </div>
                            <RangeField
                              label="Sniper Pitch Base"
                              value={settings.weaponRecoilProfiles.sniper.recoilPitchBase}
                              min={0}
                              max={0.5}
                              step={0.001}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  weaponRecoilProfiles: {
                                    ...prev.weaponRecoilProfiles,
                                    sniper: {
                                      ...prev.weaponRecoilProfiles.sniper,
                                      recoilPitchBase: value,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Sniper Pitch Ramp"
                              value={settings.weaponRecoilProfiles.sniper.recoilPitchRamp}
                              min={0}
                              max={0.04}
                              step={0.0001}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  weaponRecoilProfiles: {
                                    ...prev.weaponRecoilProfiles,
                                    sniper: {
                                      ...prev.weaponRecoilProfiles.sniper,
                                      recoilPitchRamp: value,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Sniper Yaw Range"
                              value={settings.weaponRecoilProfiles.sniper.recoilYawRange}
                              min={0}
                              max={1}
                              step={0.001}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  weaponRecoilProfiles: {
                                    ...prev.weaponRecoilProfiles,
                                    sniper: {
                                      ...prev.weaponRecoilProfiles.sniper,
                                      recoilYawRange: value,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Sniper Yaw Drift"
                              value={settings.weaponRecoilProfiles.sniper.recoilYawDrift}
                              min={0}
                              max={0.02}
                              step={0.0001}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  weaponRecoilProfiles: {
                                    ...prev.weaponRecoilProfiles,
                                    sniper: {
                                      ...prev.weaponRecoilProfiles.sniper,
                                      recoilYawDrift: value,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Sniper Move Spread Base"
                              value={settings.weaponRecoilProfiles.sniper.moveSpreadBase}
                              min={0}
                              max={1}
                              step={0.01}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  weaponRecoilProfiles: {
                                    ...prev.weaponRecoilProfiles,
                                    sniper: {
                                      ...prev.weaponRecoilProfiles.sniper,
                                      moveSpreadBase: value,
                                    },
                                  },
                                }))}
                            />
                            <RangeField
                              label="Sniper Move Spread Sprint"
                              value={settings.weaponRecoilProfiles.sniper.moveSpreadSprint}
                              min={0}
                              max={1}
                              step={0.01}
                              onChange={(value) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  weaponRecoilProfiles: {
                                    ...prev.weaponRecoilProfiles,
                                    sniper: {
                                      ...prev.weaponRecoilProfiles.sniper,
                                      moveSpreadSprint: value,
                                    },
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
                                    weaponRecoilProfiles: {
                                      rifle: {
                                        ...DEFAULT_WEAPON_RECOIL_PROFILES.rifle,
                                      },
                                      sniper: {
                                        ...DEFAULT_WEAPON_RECOIL_PROFILES.sniper,
                                      },
                                    },
                                  }))}
                              >
                                Reset Recoil Tuning
                              </button>
                            </div>
                          </MenuSection>

                          <MenuSection
                            title="Settings Profile JSON"
                            blurb="Copy your full profile or import someone else's object for instant presets."
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
                            <div className="field-row">
                              <div>
                                <div className="field-label">Crouch Mode</div>
                                <div className="field-hint">
                                  Hold keeps crouch active while pressed. Toggle flips state per key press.
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
                                <div className="field-label">Inventory Open Mode</div>
                                <div className="field-hint">
                                  Toggle keeps TAB inventory open until pressed again. Hold closes on key release.
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
                            title="In-game overlay"
                            blurb="Top-right network and performance readout."
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
                          </MenuSection>

                          <MenuSection
                            title="Crosshair"
                            blurb="Valorant-style base profile with weapon modifiers."
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
                            blurb="Movement + firing bloom feedback. Visual only."
                          >
                            <SwitchRow
                              label="Dynamic Spread"
                              hint="Enable idle/walk/run + shot bloom expansion"
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
                            title="Sniper Scope"
                            blurb="Sniper scope center-dot tuning."
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
                        </div>
                      )
                      : null}

                    {menuTab === "system"
                      ? (
                        <div className="menu-sections">
                          <MenuSection
                            title="Repair Installation"
                            blurb="Re-runs the update/reinstall flow to fix corrupted files. Not a full disk scan."
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
