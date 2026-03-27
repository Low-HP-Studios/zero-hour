import { type AudioVolumeSettings, DEFAULT_AUDIO_VOLUMES } from "../Audio";
import {
  DEFAULT_PRACTICE_MAP_ID,
  DEFAULT_AIM_SENSITIVITY_SETTINGS,
  DEFAULT_CONTROLLER_BINDINGS,
  DEFAULT_CONTROLLER_SETTINGS,
  DEFAULT_CROUCH_MODE,
  DEFAULT_CONTROL_BINDINGS,
  DEFAULT_CROSSHAIR_SETTINGS,
  DEFAULT_HUD_OVERLAY_TOGGLES,
  DEFAULT_INVENTORY_OPEN_MODE,
  DEFAULT_WEAPON_ALIGNMENT,
  DEFAULT_MOVEMENT_SETTINGS,
  DEFAULT_WEAPON_RECOIL_PROFILES,
  PRACTICE_MAP_IDS,
  type CrouchMode,
  type CrosshairColor,
  type FpsCap,
  type InventoryOpenMode,
  type MapId,
  type WeaponRecoilProfiles,
  type WindowMode,
  type GameSettings,
  type HudOverlayToggles,
  type PixelRatioScale,
  type StressModeCount,
} from "../types";
import { PIXEL_RATIO_OPTIONS, STRESS_STEPS } from "./settings-constants";

const LEGACY_SETTINGS_STORAGE_KEY = "zerohour.settings.v1";
const PRE_RESET_SETTINGS_STORAGE_KEYS = [
  "greytrace.settings.v1",
  LEGACY_SETTINGS_STORAGE_KEY,
] as const;
export const SETTINGS_STORAGE_KEY = "greytrace.settings.v2";

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

function cloneDefaultControllerBindings() {
  return { ...DEFAULT_CONTROLLER_BINDINGS };
}

const LEGACY_STICK_CLICK_CONTROLLER_BINDINGS = {
  fire: 7,
  ads: 6,
  jump: 0,
  crouch: 1,
  pickup: 2,
  reload: 3,
  inventory: 8,
  pause: 9,
  sprint: 10,
  toggleView: 11,
  drop: 13,
  equipRifle: 14,
  equipSniper: 15,
} as const;

const CROSSHAIR_COLORS: CrosshairColor[] = [
  "white",
  "green",
  "red",
  "yellow",
  "cyan",
  "magenta",
];

const CROUCH_MODES: CrouchMode[] = ["hold", "toggle"];
const INVENTORY_OPEN_MODES: InventoryOpenMode[] = ["toggle", "hold"];

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  shadows: false,
  pixelRatioScale: 1,
  showR3fPerf: false,
  sensitivity: { ...DEFAULT_AIM_SENSITIVITY_SETTINGS },
  controller: { ...DEFAULT_CONTROLLER_SETTINGS },
  controllerBindings: cloneDefaultControllerBindings(),
  keybinds: { ...DEFAULT_CONTROL_BINDINGS },
  crouchMode: DEFAULT_CROUCH_MODE,
  inventoryOpenMode: DEFAULT_INVENTORY_OPEN_MODE,
  fov: 50,
  weaponAlignment: { ...DEFAULT_WEAPON_ALIGNMENT },
  crosshair: cloneDefaultCrosshairSettings(),
  movement: { ...DEFAULT_MOVEMENT_SETTINGS },
  weaponRecoilProfiles: {
    rifle: { ...DEFAULT_WEAPON_RECOIL_PROFILES.rifle },
    sniper: { ...DEFAULT_WEAPON_RECOIL_PROFILES.sniper },
  },
  fpsCap: 60,
  windowMode: "fullscreen",
};

export type PersistedSettings = {
  settings: GameSettings;
  hudPanels: HudOverlayToggles;
  stressCount: StressModeCount;
  audioVolumes: AudioVolumeSettings;
  selectedCharacterId: string;
  selectedMapId: MapId;
};

export function createDefaultPersistedSettings(): PersistedSettings {
  return {
    settings: {
      ...DEFAULT_GAME_SETTINGS,
      sensitivity: { ...DEFAULT_AIM_SENSITIVITY_SETTINGS },
      controller: { ...DEFAULT_CONTROLLER_SETTINGS },
      controllerBindings: cloneDefaultControllerBindings(),
      keybinds: { ...DEFAULT_CONTROL_BINDINGS },
      weaponAlignment: { ...DEFAULT_WEAPON_ALIGNMENT },
      crosshair: cloneDefaultCrosshairSettings(),
      movement: { ...DEFAULT_MOVEMENT_SETTINGS },
      weaponRecoilProfiles: {
        rifle: { ...DEFAULT_WEAPON_RECOIL_PROFILES.rifle },
        sniper: { ...DEFAULT_WEAPON_RECOIL_PROFILES.sniper },
      },
    },
    hudPanels: { ...DEFAULT_HUD_OVERLAY_TOGGLES },
    stressCount: 0,
    audioVolumes: { ...DEFAULT_AUDIO_VOLUMES },
    selectedCharacterId: "trooper",
    selectedMapId: DEFAULT_PRACTICE_MAP_ID,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readHudOverlayToggles(
  raw: unknown,
  defaults: HudOverlayToggles,
): HudOverlayToggles {
  const hud = isRecord(raw) ? raw : {};
  if (typeof hud.statsBar === "boolean") {
    return { statsBar: hud.statsBar };
  }
  if (typeof hud.performance === "boolean") {
    return { statsBar: hud.performance };
  }
  return { ...defaults };
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readMapId(value: unknown, fallback: MapId): MapId {
  return PRACTICE_MAP_IDS.includes(value as MapId)
    ? (value as MapId)
    : fallback;
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

function readGamepadButtonIndex(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(15, Math.max(0, Math.round(value)));
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

function readCrouchMode(
  value: unknown,
  fallback: CrouchMode,
): CrouchMode {
  return CROUCH_MODES.includes(value as CrouchMode)
    ? (value as CrouchMode)
    : fallback;
}

function readInventoryOpenMode(
  value: unknown,
  fallback: InventoryOpenMode,
): InventoryOpenMode {
  return INVENTORY_OPEN_MODES.includes(value as InventoryOpenMode)
    ? (value as InventoryOpenMode)
    : fallback;
}

const FPS_CAP_VALUES: FpsCap[] = [0, 30, 60, 120, 144, 240];
const WINDOW_MODE_VALUES: WindowMode[] = ["windowed", "fullscreen", "borderless"];

function readFpsCap(value: unknown, fallback: FpsCap): FpsCap {
  return FPS_CAP_VALUES.includes(value as FpsCap) ? (value as FpsCap) : fallback;
}

function readWindowMode(value: unknown, fallback: WindowMode): WindowMode {
  return WINDOW_MODE_VALUES.includes(value as WindowMode)
    ? (value as WindowMode)
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
  const controller = isRecord(settings.controller) ? settings.controller : {};
  const controllerBindings = isRecord(settings.controllerBindings)
    ? settings.controllerBindings
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
  const audioVolumes = isRecord(value.audioVolumes) ? value.audioVolumes : {};
  const hasExplicitReloadBinding = typeof keybinds.reload === "string" &&
    keybinds.reload.length > 0;
  const parsedReloadBinding = readString(
    keybinds.reload,
    defaults.settings.keybinds.reload,
  );
  const parsedResetBinding = readString(
    keybinds.reset,
    defaults.settings.keybinds.reset,
  );
  const parsedTabBinding = readString(
    keybinds.tab,
    defaults.settings.keybinds.tab,
  );
  // v1 used KeyR for reset and had no reload binding; migrate reset off R.
  const migratedResetBinding = !hasExplicitReloadBinding &&
      parsedResetBinding === "KeyR"
    ? defaults.settings.keybinds.reset
    : parsedResetBinding;

  const hasPeekLeftBinding = Object.prototype.hasOwnProperty.call(
    controllerBindings,
    "peekLeft",
  );
  const hasPeekRightBinding = Object.prototype.hasOwnProperty.call(
    controllerBindings,
    "peekRight",
  );
  const parsedControllerBindings = {
    fire: readGamepadButtonIndex(
      controllerBindings.fire,
      defaults.settings.controllerBindings.fire,
    ),
    ads: readGamepadButtonIndex(
      controllerBindings.ads,
      defaults.settings.controllerBindings.ads,
    ),
    jump: readGamepadButtonIndex(
      controllerBindings.jump,
      defaults.settings.controllerBindings.jump,
    ),
    crouch: readGamepadButtonIndex(
      controllerBindings.crouch,
      defaults.settings.controllerBindings.crouch,
    ),
    peekLeft: readGamepadButtonIndex(
      controllerBindings.peekLeft,
      defaults.settings.controllerBindings.peekLeft,
    ),
    peekRight: readGamepadButtonIndex(
      controllerBindings.peekRight,
      defaults.settings.controllerBindings.peekRight,
    ),
    pickup: readGamepadButtonIndex(
      controllerBindings.pickup,
      defaults.settings.controllerBindings.pickup,
    ),
    reload: readGamepadButtonIndex(
      controllerBindings.reload,
      defaults.settings.controllerBindings.reload,
    ),
    inventory: readGamepadButtonIndex(
      controllerBindings.inventory,
      defaults.settings.controllerBindings.inventory,
    ),
    pause: readGamepadButtonIndex(
      controllerBindings.pause,
      defaults.settings.controllerBindings.pause,
    ),
    sprint: readGamepadButtonIndex(
      controllerBindings.sprint,
      defaults.settings.controllerBindings.sprint,
    ),
    toggleView: readGamepadButtonIndex(
      controllerBindings.toggleView,
      defaults.settings.controllerBindings.toggleView,
    ),
    drop: readGamepadButtonIndex(
      controllerBindings.drop,
      defaults.settings.controllerBindings.drop,
    ),
    equipRifle: readGamepadButtonIndex(
      controllerBindings.equipRifle,
      defaults.settings.controllerBindings.equipRifle,
    ),
    equipSniper: readGamepadButtonIndex(
      controllerBindings.equipSniper,
      defaults.settings.controllerBindings.equipSniper,
    ),
  };
  const isLegacyStickClickLayout = (
    Object.entries(LEGACY_STICK_CLICK_CONTROLLER_BINDINGS) as Array<
      [keyof typeof LEGACY_STICK_CLICK_CONTROLLER_BINDINGS, number]
    >
  ).every(([key, value]) => parsedControllerBindings[key] === value);
  if (
    !hasPeekLeftBinding &&
    !hasPeekRightBinding &&
    isLegacyStickClickLayout
  ) {
    parsedControllerBindings.sprint = DEFAULT_CONTROLLER_BINDINGS.sprint;
    parsedControllerBindings.toggleView =
      DEFAULT_CONTROLLER_BINDINGS.toggleView;
    parsedControllerBindings.peekLeft = DEFAULT_CONTROLLER_BINDINGS.peekLeft;
    parsedControllerBindings.peekRight = DEFAULT_CONTROLLER_BINDINGS.peekRight;
  }

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
      inventoryOpenMode: readInventoryOpenMode(
        settings.inventoryOpenMode,
        defaults.settings.inventoryOpenMode,
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
      controller: {
        enabled: readBoolean(
          controller.enabled,
          defaults.settings.controller.enabled,
        ),
        vibrationEnabled: readBoolean(
          controller.vibrationEnabled,
          defaults.settings.controller.vibrationEnabled,
        ),
        moveDeadzone: readClampedNumber(
          controller.moveDeadzone,
          0,
          0.4,
          defaults.settings.controller.moveDeadzone,
        ),
        lookDeadzone: readClampedNumber(
          controller.lookDeadzone,
          0,
          0.35,
          defaults.settings.controller.lookDeadzone,
        ),
        lookSensitivityX: readClampedNumber(
          controller.lookSensitivityX,
          0.2,
          3,
          defaults.settings.controller.lookSensitivityX,
        ),
        lookSensitivityY: readClampedNumber(
          controller.lookSensitivityY,
          0.2,
          3,
          defaults.settings.controller.lookSensitivityY,
        ),
        toggleSprint: readBoolean(
          controller.toggleSprint,
          defaults.settings.controller.toggleSprint,
        ),
        invertMoveY: readBoolean(
          controller.invertMoveY,
          defaults.settings.controller.invertMoveY,
        ),
        invertY: readBoolean(
          controller.invertY,
          defaults.settings.controller.invertY,
        ),
      },
      controllerBindings: parsedControllerBindings,
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
        unarm: readString(keybinds.unarm, defaults.settings.keybinds.unarm),
        reload: parsedReloadBinding,
        reset: migratedResetBinding,
        tab: parsedTabBinding,
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
      fpsCap: readFpsCap(settings.fpsCap, defaults.settings.fpsCap),
      windowMode: readWindowMode(settings.windowMode, defaults.settings.windowMode),
    },
    hudPanels: readHudOverlayToggles(value.hudPanels, defaults.hudPanels),
    stressCount: readStressModeCount(value.stressCount, defaults.stressCount),
    selectedCharacterId: readString(
      value.selectedCharacterId,
      defaults.selectedCharacterId,
    ),
    selectedMapId: readMapId(value.selectedMapId, defaults.selectedMapId),
    audioVolumes: {
      master: readClampedNumber(
        audioVolumes.master,
        0,
        1,
        defaults.audioVolumes.master,
      ),
      music: readClampedNumber(
        migratePercent(audioVolumes.music),
        0,
        1,
        defaults.audioVolumes.music,
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
      ui: readClampedNumber(audioVolumes.ui, 0, 1, defaults.audioVolumes.ui),
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
  } catch {
    return fallback;
  }

  try {
    // v2 intentionally ignores older saved settings so shipped defaults win.
    for (const storageKey of PRE_RESET_SETTINGS_STORAGE_KEYS) {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // Ignore storage cleanup failures and keep the app usable.
  }

  return fallback;
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
