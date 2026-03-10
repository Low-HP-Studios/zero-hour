import { type AudioVolumeSettings, DEFAULT_AUDIO_VOLUMES } from "../Audio";
import {
  DEFAULT_AIM_SENSITIVITY_SETTINGS,
  DEFAULT_CROUCH_MODE,
  DEFAULT_CONTROL_BINDINGS,
  DEFAULT_CROSSHAIR_SETTINGS,
  DEFAULT_ENEMY_OUTLINE_SETTINGS,
  DEFAULT_HUD_OVERLAY_TOGGLES,
  DEFAULT_WEAPON_ALIGNMENT,
  DEFAULT_MOVEMENT_SETTINGS,
  DEFAULT_WEAPON_RECOIL_PROFILES,
  type CrouchMode,
  type CrosshairColor,
  type EnemyOutlineColor,
  type WeaponRecoilProfiles,
  type GameSettings,
  type HudOverlayToggles,
  type PixelRatioScale,
  type StressModeCount,
} from "../types";
import { PIXEL_RATIO_OPTIONS, STRESS_STEPS } from "./settings-constants";

const LEGACY_SETTINGS_STORAGE_KEY = "zerohour.settings.v1";
export const SETTINGS_STORAGE_KEY = "greytrace.settings.v1";

function cloneDefaultCrosshairSettings() {
  return {
    ...DEFAULT_CROSSHAIR_SETTINGS,
    centerDot: { ...DEFAULT_CROSSHAIR_SETTINGS.centerDot },
    innerLines: { ...DEFAULT_CROSSHAIR_SETTINGS.innerLines },
    outerLines: { ...DEFAULT_CROSSHAIR_SETTINGS.outerLines },
    outline: { ...DEFAULT_CROSSHAIR_SETTINGS.outline },
    dynamic: { ...DEFAULT_CROSSHAIR_SETTINGS.dynamic },
    weaponModifiers: { ...DEFAULT_CROSSHAIR_SETTINGS.weaponModifiers },
    ads: { ...DEFAULT_CROSSHAIR_SETTINGS.ads },
  };
}

function cloneDefaultEnemyOutlineSettings() {
  return { ...DEFAULT_ENEMY_OUTLINE_SETTINGS };
}

const CROSSHAIR_COLORS: CrosshairColor[] = [
  "white",
  "green",
  "red",
  "yellow",
  "cyan",
  "magenta",
];

const ENEMY_OUTLINE_COLORS: EnemyOutlineColor[] = [
  "red",
  "yellow",
  "cyan",
  "magenta",
];

const CROUCH_MODES: CrouchMode[] = ["hold", "toggle"];

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  shadows: false,
  pixelRatioScale: 1,
  showR3fPerf: true,
  sensitivity: { ...DEFAULT_AIM_SENSITIVITY_SETTINGS },
  keybinds: { ...DEFAULT_CONTROL_BINDINGS },
  crouchMode: DEFAULT_CROUCH_MODE,
  fov: 50,
  weaponAlignment: { ...DEFAULT_WEAPON_ALIGNMENT },
  crosshair: cloneDefaultCrosshairSettings(),
  enemyOutline: cloneDefaultEnemyOutlineSettings(),
  movement: { ...DEFAULT_MOVEMENT_SETTINGS },
  weaponRecoilProfiles: {
    rifle: { ...DEFAULT_WEAPON_RECOIL_PROFILES.rifle },
    sniper: { ...DEFAULT_WEAPON_RECOIL_PROFILES.sniper },
  },
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
      crosshair: cloneDefaultCrosshairSettings(),
      enemyOutline: cloneDefaultEnemyOutlineSettings(),
      movement: { ...DEFAULT_MOVEMENT_SETTINGS },
      weaponRecoilProfiles: {
        rifle: { ...DEFAULT_WEAPON_RECOIL_PROFILES.rifle },
        sniper: { ...DEFAULT_WEAPON_RECOIL_PROFILES.sniper },
      },
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

function readCrosshairColor(
  value: unknown,
  fallback: CrosshairColor,
): CrosshairColor {
  return CROSSHAIR_COLORS.includes(value as CrosshairColor)
    ? (value as CrosshairColor)
    : fallback;
}

function readEnemyOutlineColor(
  value: unknown,
  fallback: EnemyOutlineColor,
): EnemyOutlineColor {
  return ENEMY_OUTLINE_COLORS.includes(value as EnemyOutlineColor)
    ? (value as EnemyOutlineColor)
    : fallback;
}

function readCrouchMode(
  value: unknown,
  fallback: CrouchMode,
): CrouchMode {
  return CROUCH_MODES.includes(value as CrouchMode)
    ? (value as CrouchMode)
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
  const crosshair = isRecord(settings.crosshair) ? settings.crosshair : {};
  const centerDot = isRecord(crosshair.centerDot) ? crosshair.centerDot : {};
  const innerLines = isRecord(crosshair.innerLines) ? crosshair.innerLines : {};
  const outerLines = isRecord(crosshair.outerLines) ? crosshair.outerLines : {};
  const crosshairOutline = isRecord(crosshair.outline) ? crosshair.outline : {};
  const crosshairDynamic = isRecord(crosshair.dynamic) ? crosshair.dynamic : {};
  const crosshairWeaponModifiers = isRecord(crosshair.weaponModifiers)
    ? crosshair.weaponModifiers
    : {};
  const crosshairAds = isRecord(crosshair.ads) ? crosshair.ads : {};
  const enemyOutline = isRecord(settings.enemyOutline)
    ? settings.enemyOutline
    : {};
  const movement = isRecord(settings.movement) ? settings.movement : {};
  const weaponRecoilProfiles = isRecord(settings.weaponRecoilProfiles)
    ? settings.weaponRecoilProfiles
    : {};
  const rifleRecoilProfile = isRecord(weaponRecoilProfiles.rifle)
    ? weaponRecoilProfiles.rifle
    : {};
  const sniperRecoilProfile = isRecord(weaponRecoilProfiles.sniper)
    ? weaponRecoilProfiles.sniper
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
      fov: readClampedNumber(settings.fov, 45, 120, defaults.settings.fov),
      crouchMode: readCrouchMode(
        settings.crouchMode,
        defaults.settings.crouchMode,
      ),
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
        walkModifier: readString(
          keybinds.walkModifier,
          defaults.settings.keybinds.walkModifier,
        ),
        crouch: readString(keybinds.crouch, defaults.settings.keybinds.crouch),
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
        peekLeft: readString(
          keybinds.peekLeft,
          readString(
            keybinds.shoulderLeft,
            defaults.settings.keybinds.peekLeft,
          ),
        ),
        peekRight: readString(
          keybinds.peekRight,
          readString(
            keybinds.shoulderRight,
            defaults.settings.keybinds.peekRight,
          ),
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
      crosshair: {
        color: readCrosshairColor(
          crosshair.color,
          defaults.settings.crosshair.color,
        ),
        centerDot: {
          enabled: readBoolean(
            centerDot.enabled,
            defaults.settings.crosshair.centerDot.enabled,
          ),
          size: readClampedNumber(
            centerDot.size,
            1,
            18,
            defaults.settings.crosshair.centerDot.size,
          ),
          thickness: readClampedNumber(
            centerDot.thickness,
            1,
            12,
            defaults.settings.crosshair.centerDot.thickness,
          ),
        },
        innerLines: {
          enabled: readBoolean(
            innerLines.enabled,
            defaults.settings.crosshair.innerLines.enabled,
          ),
          length: readClampedNumber(
            innerLines.length,
            1,
            28,
            defaults.settings.crosshair.innerLines.length,
          ),
          thickness: readClampedNumber(
            innerLines.thickness,
            1,
            10,
            defaults.settings.crosshair.innerLines.thickness,
          ),
          gap: readClampedNumber(
            innerLines.gap,
            0,
            28,
            defaults.settings.crosshair.innerLines.gap,
          ),
        },
        outerLines: {
          enabled: readBoolean(
            outerLines.enabled,
            defaults.settings.crosshair.outerLines.enabled,
          ),
          length: readClampedNumber(
            outerLines.length,
            1,
            28,
            defaults.settings.crosshair.outerLines.length,
          ),
          thickness: readClampedNumber(
            outerLines.thickness,
            1,
            10,
            defaults.settings.crosshair.outerLines.thickness,
          ),
          gap: readClampedNumber(
            outerLines.gap,
            0,
            36,
            defaults.settings.crosshair.outerLines.gap,
          ),
        },
        outline: {
          enabled: readBoolean(
            crosshairOutline.enabled,
            defaults.settings.crosshair.outline.enabled,
          ),
          thickness: readClampedNumber(
            crosshairOutline.thickness,
            0,
            4,
            defaults.settings.crosshair.outline.thickness,
          ),
          opacity: readClampedNumber(
            crosshairOutline.opacity,
            0,
            1,
            defaults.settings.crosshair.outline.opacity,
          ),
        },
        dynamic: {
          enabled: readBoolean(
            crosshairDynamic.enabled,
            defaults.settings.crosshair.dynamic.enabled,
          ),
          idleSpread: readClampedNumber(
            crosshairDynamic.idleSpread,
            0,
            16,
            defaults.settings.crosshair.dynamic.idleSpread,
          ),
          walkSpread: readClampedNumber(
            crosshairDynamic.walkSpread,
            0,
            20,
            defaults.settings.crosshair.dynamic.walkSpread,
          ),
          runSpread: readClampedNumber(
            crosshairDynamic.runSpread,
            0,
            28,
            defaults.settings.crosshair.dynamic.runSpread,
          ),
          shotKick: readClampedNumber(
            crosshairDynamic.shotKick,
            0,
            8,
            defaults.settings.crosshair.dynamic.shotKick,
          ),
          recoveryPerSecond: readClampedNumber(
            crosshairDynamic.recoveryPerSecond,
            1,
            60,
            defaults.settings.crosshair.dynamic.recoveryPerSecond,
          ),
        },
        weaponModifiers: {
          rifleGapMultiplier: readClampedNumber(
            crosshairWeaponModifiers.rifleGapMultiplier,
            0.5,
            2,
            defaults.settings.crosshair.weaponModifiers.rifleGapMultiplier,
          ),
          sniperGapMultiplier: readClampedNumber(
            crosshairWeaponModifiers.sniperGapMultiplier,
            0.5,
            2,
            defaults.settings.crosshair.weaponModifiers.sniperGapMultiplier,
          ),
        },
        ads: {
          rifleDotSize: readClampedNumber(
            crosshairAds.rifleDotSize,
            1,
            16,
            defaults.settings.crosshair.ads.rifleDotSize,
          ),
          rifleDotColor: readCrosshairColor(
            crosshairAds.rifleDotColor,
            defaults.settings.crosshair.ads.rifleDotColor,
          ),
          sniperDotSize: readClampedNumber(
            crosshairAds.sniperDotSize,
            1,
            18,
            defaults.settings.crosshair.ads.sniperDotSize,
          ),
          sniperDotColor: readCrosshairColor(
            crosshairAds.sniperDotColor,
            defaults.settings.crosshair.ads.sniperDotColor,
          ),
        },
      },
      enemyOutline: {
        enabled: readBoolean(
          enemyOutline.enabled,
          defaults.settings.enemyOutline.enabled,
        ),
        color: readEnemyOutlineColor(
          enemyOutline.color,
          defaults.settings.enemyOutline.color,
        ),
        thickness: readClampedNumber(
          enemyOutline.thickness,
          0,
          8,
          defaults.settings.enemyOutline.thickness,
        ),
        opacity: readClampedNumber(
          enemyOutline.opacity,
          0,
          1,
          defaults.settings.enemyOutline.opacity,
        ),
      },
      movement: {
        rifleWalkSpeedScale: readClampedNumber(
          movement.rifleWalkSpeedScale,
          0.2,
          3,
          defaults.settings.movement.rifleWalkSpeedScale,
        ),
        rifleJogSpeedScale: readClampedNumber(
          movement.rifleJogSpeedScale,
          0.2,
          3,
          defaults.settings.movement.rifleJogSpeedScale,
        ),
        rifleRunSpeedScale: readClampedNumber(
          movement.rifleRunSpeedScale,
          0.5,
          3.5,
          defaults.settings.movement.rifleRunSpeedScale,
        ),
        rifleFirePrepSpeedScale: readClampedNumber(
          movement.rifleFirePrepSpeedScale,
          0.1,
          2,
          defaults.settings.movement.rifleFirePrepSpeedScale,
        ),
        crouchSpeedScale: readClampedNumber(
          movement.crouchSpeedScale,
          0.2,
          1.2,
          defaults.settings.movement.crouchSpeedScale,
        ),
        rifleRunStaminaMaxMs: readClampedNumber(
          movement.rifleRunStaminaMaxMs,
          400,
          12000,
          defaults.settings.movement.rifleRunStaminaMaxMs,
        ),
        rifleRunStaminaDrainPerSec: readClampedNumber(
          movement.rifleRunStaminaDrainPerSec,
          0.05,
          12,
          defaults.settings.movement.rifleRunStaminaDrainPerSec,
        ),
        rifleRunStaminaRegenPerSec: readClampedNumber(
          movement.rifleRunStaminaRegenPerSec,
          0,
          12,
          defaults.settings.movement.rifleRunStaminaRegenPerSec,
        ),
        rifleRunStartMs: readClampedNumber(
          movement.rifleRunStartMs,
          60,
          2200,
          defaults.settings.movement.rifleRunStartMs,
        ),
        rifleRunStopMs: readClampedNumber(
          movement.rifleRunStopMs,
          60,
          2200,
          defaults.settings.movement.rifleRunStopMs,
        ),
        rifleRunForwardThreshold: readClampedNumber(
          movement.rifleRunForwardThreshold,
          0,
          1,
          defaults.settings.movement.rifleRunForwardThreshold,
        ),
        rifleRunLateralThreshold: readClampedNumber(
          movement.rifleRunLateralThreshold,
          0,
          1,
          defaults.settings.movement.rifleRunLateralThreshold,
        ),
      },
      weaponRecoilProfiles: {
        rifle: {
          recoilPitchBase: readClampedNumber(
            rifleRecoilProfile.recoilPitchBase,
            0,
            0.25,
            defaults.settings.weaponRecoilProfiles.rifle.recoilPitchBase,
          ),
          recoilPitchRamp: readClampedNumber(
            rifleRecoilProfile.recoilPitchRamp,
            0,
            0.02,
            defaults.settings.weaponRecoilProfiles.rifle.recoilPitchRamp,
          ),
          recoilYawRange: readClampedNumber(
            rifleRecoilProfile.recoilYawRange,
            0,
            0.15,
            defaults.settings.weaponRecoilProfiles.rifle.recoilYawRange,
          ),
          recoilYawDrift: readClampedNumber(
            rifleRecoilProfile.recoilYawDrift,
            0,
            0.02,
            defaults.settings.weaponRecoilProfiles.rifle.recoilYawDrift,
          ),
          moveSpreadBase: readClampedNumber(
            rifleRecoilProfile.moveSpreadBase,
            0,
            1,
            defaults.settings.weaponRecoilProfiles.rifle.moveSpreadBase,
          ),
          moveSpreadSprint: readClampedNumber(
            rifleRecoilProfile.moveSpreadSprint,
            0,
            1,
            defaults.settings.weaponRecoilProfiles.rifle.moveSpreadSprint,
          ),
        },
        sniper: {
          recoilPitchBase: readClampedNumber(
            sniperRecoilProfile.recoilPitchBase,
            0,
            0.5,
            defaults.settings.weaponRecoilProfiles.sniper.recoilPitchBase,
          ),
          recoilPitchRamp: readClampedNumber(
            sniperRecoilProfile.recoilPitchRamp,
            0,
            0.04,
            defaults.settings.weaponRecoilProfiles.sniper.recoilPitchRamp,
          ),
          recoilYawRange: readClampedNumber(
            sniperRecoilProfile.recoilYawRange,
            0,
            1,
            defaults.settings.weaponRecoilProfiles.sniper.recoilYawRange,
          ),
          recoilYawDrift: readClampedNumber(
            sniperRecoilProfile.recoilYawDrift,
            0,
            0.02,
            defaults.settings.weaponRecoilProfiles.sniper.recoilYawDrift,
          ),
          moveSpreadBase: readClampedNumber(
            sniperRecoilProfile.moveSpreadBase,
            0,
            1,
            defaults.settings.weaponRecoilProfiles.sniper.moveSpreadBase,
          ),
          moveSpreadSprint: readClampedNumber(
            sniperRecoilProfile.moveSpreadSprint,
            0,
            1,
            defaults.settings.weaponRecoilProfiles.sniper.moveSpreadSprint,
          ),
        },
      } as WeaponRecoilProfiles,
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
