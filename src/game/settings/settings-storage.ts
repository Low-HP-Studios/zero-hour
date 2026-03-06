import { type AudioVolumeSettings, DEFAULT_AUDIO_VOLUMES } from "../Audio";
import {
  DEFAULT_AIM_SENSITIVITY_SETTINGS,
  DEFAULT_CONTROL_BINDINGS,
  DEFAULT_HUD_OVERLAY_TOGGLES,
  DEFAULT_WEAPON_ALIGNMENT,
  type GameSettings,
  type HudOverlayToggles,
  type PixelRatioScale,
  type StressModeCount,
} from "../types";
import { PIXEL_RATIO_OPTIONS, STRESS_STEPS } from "./settings-constants";

const LEGACY_SETTINGS_STORAGE_KEY = "zerohour.settings.v1";
export const SETTINGS_STORAGE_KEY = "greytrace.settings.v1";

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  shadows: false,
  pixelRatioScale: 0.75,
  showR3fPerf: false,
  sensitivity: { ...DEFAULT_AIM_SENSITIVITY_SETTINGS },
  keybinds: { ...DEFAULT_CONTROL_BINDINGS },
  fov: 65,
  weaponAlignment: { ...DEFAULT_WEAPON_ALIGNMENT },
};

export type PersistedSettings = {
  settings: GameSettings;
  hudPanels: HudOverlayToggles;
  stressCount: StressModeCount;
  audioVolumes: AudioVolumeSettings;
};

export function createDefaultPersistedSettings(): PersistedSettings {
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

export function parsePersistedSettings(value: unknown): PersistedSettings {
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

export function loadPersistedSettings(): PersistedSettings {
  const fallback = createDefaultPersistedSettings();
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const rawSettings = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (rawSettings) {
      return parsePersistedSettings(JSON.parse(rawSettings));
    }

    const legacySettings = window.localStorage.getItem(
      LEGACY_SETTINGS_STORAGE_KEY,
    );
    if (!legacySettings) {
      return fallback;
    }

    const migratedSettings = parsePersistedSettings(JSON.parse(legacySettings));
    try {
      window.localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify(migratedSettings),
      );
      window.localStorage.removeItem(LEGACY_SETTINGS_STORAGE_KEY);
    } catch {
      // Keep running even if migration persistence fails.
    }
    return migratedSettings;
  } catch {
    return fallback;
  }
}

export function savePersistedSettings(settings: PersistedSettings) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage write failures (private mode/quota) and keep game usable.
  }
}
