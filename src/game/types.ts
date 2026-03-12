export type PixelRatioScale = 0.5 | 0.75 | 1;
export type StressModeCount = 0 | 50 | 100 | 200;

export type ExperiencePhase =
  | "menu"
  | "entering"
  | "playing"
  | "returning";

export type AimSensitivitySettings = {
  look: number;
  rifleAds: number;
  sniperAds: number;
  vertical: number;
};

export const DEFAULT_AIM_SENSITIVITY_SETTINGS: AimSensitivitySettings = {
  look: 0.54,
  rifleAds: 0.42,
  sniperAds: 0.83,
  vertical: 1,
};

export type ControlBindings = {
  moveForward: string;
  moveBackward: string;
  moveLeft: string;
  moveRight: string;
  sprint: string;
  walkModifier: string;
  crouch: string;
  jump: string;
  pickup: string;
  drop: string;
  reset: string;
  equipRifle: string;
  equipSniper: string;
  toggleView: string;
  peekLeft: string;
  peekRight: string;
};

export const DEFAULT_CONTROL_BINDINGS: ControlBindings = {
  moveForward: "KeyW",
  moveBackward: "KeyS",
  moveLeft: "KeyA",
  moveRight: "KeyD",
  sprint: "ShiftLeft",
  walkModifier: "ControlLeft",
  crouch: "KeyC",
  jump: "Space",
  pickup: "KeyF",
  drop: "KeyG",
  reset: "KeyR",
  equipRifle: "Digit1",
  equipSniper: "Digit2",
  toggleView: "KeyV",
  peekLeft: "KeyQ",
  peekRight: "KeyE",
};

export type HudOverlayToggles = {
  practice: boolean;
  controls: boolean;
  settings: boolean;
  performance: boolean;
};

export const DEFAULT_HUD_OVERLAY_TOGGLES: HudOverlayToggles = {
  practice: false,
  controls: false,
  settings: false,
  performance: false,
};

export type WeaponAlignmentOffset = {
  posX: number;
  posY: number;
  posZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
};

export const DEFAULT_WEAPON_ALIGNMENT: WeaponAlignmentOffset = {
  posX: 0.150,
  posY: 0.240,
  posZ: 0.040,
  rotX: -2.96,
  rotY: 0.13,
  rotZ: -1.23,
};

export type CrosshairColor =
  | "white"
  | "green"
  | "red"
  | "yellow"
  | "cyan"
  | "magenta";

export type CrosshairCenterDotSettings = {
  enabled: boolean;
  size: number;
  thickness: number;
};

export type CrosshairLineSettings = {
  enabled: boolean;
  length: number;
  thickness: number;
  gap: number;
};

export type CrosshairOutlineSettings = {
  enabled: boolean;
  thickness: number;
  opacity: number;
};

export type CrosshairDynamicSettings = {
  enabled: boolean;
  idleSpread: number;
  walkSpread: number;
  runSpread: number;
  shotKick: number;
  recoveryPerSecond: number;
};

export type CrosshairWeaponModifierSettings = {
  rifleGapMultiplier: number;
  sniperGapMultiplier: number;
};

export type CrosshairAdsSettings = {
  rifleDotSize: number;
  rifleDotColor: CrosshairColor;
  sniperDotSize: number;
  sniperDotColor: CrosshairColor;
};

export type CrosshairSettings = {
  color: CrosshairColor;
  centerDot: CrosshairCenterDotSettings;
  innerLines: CrosshairLineSettings;
  outerLines: CrosshairLineSettings;
  outline: CrosshairOutlineSettings;
  dynamic: CrosshairDynamicSettings;
  weaponModifiers: CrosshairWeaponModifierSettings;
  ads: CrosshairAdsSettings;
};

export type WeaponRecoilProfile = {
  recoilPitchBase: number;
  recoilPitchRamp: number;
  recoilYawRange: number;
  recoilYawDrift: number;
  moveSpreadBase: number;
  moveSpreadSprint: number;
};

export type WeaponRecoilProfiles = {
  rifle: WeaponRecoilProfile;
  sniper: WeaponRecoilProfile;
};

export type MovementProfileSettings = {
  rifleWalkSpeedScale: number;
  rifleJogSpeedScale: number;
  rifleRunSpeedScale: number;
  rifleFirePrepSpeedScale: number;
  crouchSpeedScale: number;
  rifleRunForwardThreshold: number;
  rifleRunLateralThreshold: number;
};

export const DEFAULT_CROSSHAIR_SETTINGS: CrosshairSettings = {
  color: "white",
  centerDot: {
    enabled: true,
    size: 3.5,
    thickness: 3,
  },
  innerLines: {
    enabled: false,
    length: 6.5,
    thickness: 1.5,
    gap: 8.5,
  },
  outerLines: {
    enabled: false,
    length: 7,
    thickness: 2,
    gap: 13,
  },
  outline: {
    enabled: true,
    thickness: 1,
    opacity: 0.85,
  },
  dynamic: {
    enabled: false,
    idleSpread: 0.6,
    walkSpread: 0.8,
    runSpread: 1.1,
    shotKick: 0.3,
    recoveryPerSecond: 3.5,
  },
  weaponModifiers: {
    rifleGapMultiplier: 1,
    sniperGapMultiplier: 1.25,
  },
  ads: {
    rifleDotSize: 5,
    rifleDotColor: "red",
    sniperDotSize: 6,
    sniperDotColor: "red",
  },
};

export const DEFAULT_WEAPON_RECOIL_PROFILES: WeaponRecoilProfiles = {
  rifle: {
    recoilPitchBase: 0.0055,
    recoilPitchRamp: 0.00055,
    recoilYawRange: 0.006,
    recoilYawDrift: 0.0005,
    moveSpreadBase: 0.02,
    moveSpreadSprint: 0.02,
  },
  sniper: {
    recoilPitchBase: 0.008,
    recoilPitchRamp: 0,
    recoilYawRange: 0.01,
    recoilYawDrift: 0.0002,
    moveSpreadBase: 0.01,
    moveSpreadSprint: 0.01,
  },
};

export const DEFAULT_MOVEMENT_SETTINGS: MovementProfileSettings = {
  rifleWalkSpeedScale: 0.2,
  rifleJogSpeedScale: 1.08,
  rifleRunSpeedScale: 1.13,
  rifleFirePrepSpeedScale: 0.37,
  crouchSpeedScale: 0.52,
  rifleRunForwardThreshold: 1,
  rifleRunLateralThreshold: 1,
};

export type EnemyOutlineColor = "red" | "yellow" | "cyan" | "magenta";
export type CrouchMode = "hold" | "toggle";
export const DEFAULT_CROUCH_MODE: CrouchMode = "toggle";

export type EnemyOutlineSettings = {
  enabled: boolean;
  color: EnemyOutlineColor;
  thickness: number;
  opacity: number;
};

export const DEFAULT_ENEMY_OUTLINE_SETTINGS: EnemyOutlineSettings = {
  enabled: true,
  color: "red",
  thickness: 8,
  opacity: 1,
};

export type GameSettings = {
  shadows: boolean;
  pixelRatioScale: PixelRatioScale;
  showR3fPerf: boolean;
  sensitivity: AimSensitivitySettings;
  keybinds: ControlBindings;
  crouchMode: CrouchMode;
  fov: number;
  weaponAlignment: WeaponAlignmentOffset;
  crosshair: CrosshairSettings;
  enemyOutline: EnemyOutlineSettings;
  movement: MovementProfileSettings;
  weaponRecoilProfiles: WeaponRecoilProfiles;
};

export type PerfMetrics = {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
};

export type MovementTier = "walk" | "jog" | "run";

export const DEFAULT_PERF_METRICS: PerfMetrics = {
  fps: 0,
  frameMs: 0,
  drawCalls: 0,
  triangles: 0,
  geometries: 0,
  textures: 0,
};

export type PlayerSnapshot = {
  x: number;
  y: number;
  z: number;
  speed: number;
  sprinting: boolean;
  movementTier: MovementTier;
  crouched: boolean;
  moving: boolean;
  grounded: boolean;
  pointerLocked: boolean;
  canInteract: boolean;
};

export const DEFAULT_PLAYER_SNAPSHOT: PlayerSnapshot = {
  x: 0,
  y: 0,
  z: 6,
  speed: 0,
  sprinting: false,
  movementTier: "jog",
  crouched: false,
  moving: false,
  grounded: true,
  pointerLocked: false,
  canInteract: false,
};

export type CollisionRect = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type CollisionCircle = {
  x: number;
  z: number;
  radius: number;
};

export type WorldBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type ScenePresentation = {
  phase: ExperiencePhase;
  phaseProgress: number;
  worldTheme: number;
  pickupReveal: number;
  targetReveal: number;
  inputEnabled: boolean;
  killPulse: number;
};

export type TargetState = {
  id: string;
  position: [number, number, number];
  facingYaw: number;
  radius: number;
  hitUntil: number;
  disabled: boolean;
  hp: number;
  maxHp: number;
};
