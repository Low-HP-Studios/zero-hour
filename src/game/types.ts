export type PixelRatioScale = 0.5 | 0.75 | 1;
export type StressModeCount = 0 | 50 | 100 | 200;
export type FpsCap = 0 | 30 | 60 | 120 | 144 | 240; // 0 = uncapped
export type WindowMode = "windowed" | "fullscreen" | "borderless";
export type MapId = "range" | "map1";
export const DEFAULT_PRACTICE_MAP_ID: MapId = "range";
export const PRACTICE_MAP_IDS: readonly MapId[] = ["range", "map1"];

export type ExperiencePhase = 'menu' | 'entering' | 'playing' | 'returning';

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

export type ControllerSettings = {
  enabled: boolean;
  vibrationEnabled: boolean;
  moveDeadzone: number;
  lookDeadzone: number;
  lookSensitivityX: number;
  lookSensitivityY: number;
  toggleSprint: boolean;
  invertMoveY: boolean;
  invertY: boolean;
};

export const DEFAULT_CONTROLLER_SETTINGS: ControllerSettings = {
  enabled: true,
  vibrationEnabled: true,
  moveDeadzone: 0.15,
  lookDeadzone: 0.12,
  lookSensitivityX: 1,
  lookSensitivityY: 1,
  toggleSprint: true,
  invertMoveY: true,
  invertY: true,
};

export type ControllerBindingKey =
  | "fire"
  | "ads"
  | "jump"
  | "crouch"
  | "peekLeft"
  | "peekRight"
  | "pickup"
  | "reload"
  | "inventory"
  | "pause"
  | "sprint"
  | "toggleView"
  | "drop"
  | "equipRifle"
  | "equipSniper";

export type ControllerBindings = Record<ControllerBindingKey, number>;

export const DEFAULT_CONTROLLER_BINDINGS: ControllerBindings = {
  fire: 7,
  ads: 6,
  jump: 0,
  crouch: 1,
  peekLeft: 4,
  peekRight: 5,
  pickup: 2,
  reload: 3,
  inventory: 8,
  pause: 9,
  sprint: 10,
  toggleView: 11,
  drop: 13,
  equipRifle: 14,
  equipSniper: 15,
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
  unarm: string;
  reload: string;
  reset: string;
  tab: string;
  equipRifle: string;
  equipSniper: string;
  toggleView: string;
  peekLeft: string;
  peekRight: string;
};

export const DEFAULT_CONTROL_BINDINGS: ControlBindings = {
  moveForward: 'KeyW',
  moveBackward: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  sprint: 'ShiftLeft',
  walkModifier: 'ControlLeft',
  crouch: 'KeyC',
  jump: 'Space',
  pickup: 'KeyF',
  drop: 'KeyG',
  unarm: 'KeyX',
  reload: 'KeyR',
  reset: 'KeyT',
  tab: 'Tab',
  equipRifle: 'Digit1',
  equipSniper: 'Digit2',
  toggleView: 'KeyV',
  peekLeft: 'KeyQ',
  peekRight: 'KeyE',
};

export type HudOverlayToggles = {
  statsBar: boolean;
};

export const DEFAULT_HUD_OVERLAY_TOGGLES: HudOverlayToggles = {
  statsBar: true,
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
  posX: 0.15,
  posY: 0.24,
  posZ: 0.04,
  rotX: -2.96,
  rotY: 0.13,
  rotZ: -1.23,
};

export type CrosshairColor =
  | 'white'
  | 'green'
  | 'red'
  | 'yellow'
  | 'cyan'
  | 'magenta';

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
  sniperDotSize: number;
  sniperDotColor: CrosshairColor;
};

export type RedDotCrosshairSettings = {
  color: CrosshairColor;
  centerDot: CrosshairCenterDotSettings;
  innerLines: CrosshairLineSettings;
  outerLines: CrosshairLineSettings;
  outline: CrosshairOutlineSettings;
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
  redDot: RedDotCrosshairSettings;
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
  color: 'green',
  centerDot: {
    enabled: true,
    size: 3.5,
    thickness: 3,
  },
  innerLines: {
    enabled: true,
    length: 6.5,
    thickness: 1.5,
    gap: 3.5,
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
    sniperDotSize: 6,
    sniperDotColor: 'red',
  },
  redDot: {
    color: 'red',
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
  },
};

export const DEFAULT_WEAPON_RECOIL_PROFILES: WeaponRecoilProfiles = {
  rifle: {
    recoilPitchBase: 0.0045,
    recoilPitchRamp: 0.00037,
    recoilYawRange: 0.0022,
    recoilYawDrift: 0.00013,
    moveSpreadBase: 0.01,
    moveSpreadSprint: 0.01,
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

export type CrouchMode = 'hold' | 'toggle';
export const DEFAULT_CROUCH_MODE: CrouchMode = 'hold';
export type InventoryOpenMode = 'toggle' | 'hold';
export const DEFAULT_INVENTORY_OPEN_MODE: InventoryOpenMode = 'hold';

export type GameSettings = {
  shadows: boolean;
  pixelRatioScale: PixelRatioScale;
  showR3fPerf: boolean;
  sensitivity: AimSensitivitySettings;
  controller: ControllerSettings;
  controllerBindings: ControllerBindings;
  keybinds: ControlBindings;
  crouchMode: CrouchMode;
  inventoryOpenMode: InventoryOpenMode;
  fov: number;
  weaponAlignment: WeaponAlignmentOffset;
  crosshair: CrosshairSettings;
  movement: MovementProfileSettings;
  weaponRecoilProfiles: WeaponRecoilProfiles;
  fpsCap: FpsCap;
  windowMode: WindowMode;
};

export type PerfMetrics = {
  fps: number;
  frameMs: number;
  cpuUtilPercent: number;
  gpuUtilPercent: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
};

export type MovementTier = 'walk' | 'jog' | 'run';

export type WeaponSnapshotKind = 'rifle' | 'sniper';

export type PlayerWeaponSlotSnapshot = {
  weaponKind: WeaponSnapshotKind | null;
  hasWeapon: boolean;
  magAmmo: number;
  reserveAmmo: number;
  infiniteReserveAmmo: boolean;
  maxMagAmmo: number;
  maxReserveAmmo: number;
  maxPacks: number;
  packAmmo: number;
};

export type PlayerWeaponLoadoutSnapshot = {
  activeSlot: 'slotA' | 'slotB';
  weaponRaised: boolean;
  slotA: PlayerWeaponSlotSnapshot;
  slotB: PlayerWeaponSlotSnapshot;
};

export type PlayerWeaponReloadSnapshot = {
  active: boolean;
  weaponKind: WeaponSnapshotKind | null;
  progress: number;
  remainingMs: number;
};

export type InventoryCategory =
  | 'weapon'
  | 'ammo'
  | 'attachment';

export type InventoryAttachmentSlot = 'scope' | 'magazine' | 'grip' | 'muzzle';
export type InventoryWeaponEquipSlot = 'primary' | 'secondary';
export type InventoryEquipSlot = InventoryWeaponEquipSlot;

export type InventoryItemStackSnapshot = {
  uid: string;
  itemId: string;
  name: string;
  icon: string;
  category: InventoryCategory;
  quantity: number;
};

export type InventoryNearbyItemSnapshot = {
  id: string;
  distance: number;
  stack: InventoryItemStackSnapshot;
};

export type InventoryAttachmentSlotsSnapshot = Record<
  InventoryAttachmentSlot,
  InventoryItemStackSnapshot | null
>;

export type InventoryBackpackSnapshot = {
  columns: number;
  capacity: number;
  slots: Array<InventoryItemStackSnapshot | null>;
};

export type InventoryEquippedSnapshot = {
  primaryAttachments: InventoryAttachmentSlotsSnapshot;
  secondaryAttachments: InventoryAttachmentSlotsSnapshot;
  activeQuickSlot: 'primary' | 'secondary';
};

export type InventoryPanelSnapshot = {
  revision: number;
  open: boolean;
  openMode: InventoryOpenMode;
  nearby: InventoryNearbyItemSnapshot[];
  backpack: InventoryBackpackSnapshot;
  equipped: InventoryEquippedSnapshot;
};

export type InventoryMoveLocation =
  | {
      zone: 'nearby';
      id: string;
    }
  | {
      zone: 'backpack';
      index: number;
    }
  | {
      zone: 'equip';
      slot: InventoryEquipSlot;
    }
  | {
      zone: 'attachment';
      weaponSlot: InventoryWeaponEquipSlot;
      slot: InventoryAttachmentSlot;
    };

export type InventoryMoveRequest = {
  from: InventoryMoveLocation;
  to: InventoryMoveLocation;
};

export type InventoryMoveResult = {
  ok: boolean;
  message?: string;
};

export const DEFAULT_PERF_METRICS: PerfMetrics = {
  fps: 0,
  frameMs: 0,
  cpuUtilPercent: 0,
  gpuUtilPercent: 0,
  drawCalls: 0,
  triangles: 0,
  geometries: 0,
  textures: 0,
};

const EMPTY_INVENTORY_ATTACHMENT_SLOTS: InventoryAttachmentSlotsSnapshot = {
  scope: null,
  magazine: null,
  grip: null,
  muzzle: null,
};

export const DEFAULT_INVENTORY_PANEL_SNAPSHOT: InventoryPanelSnapshot = {
  revision: 0,
  open: false,
  openMode: DEFAULT_INVENTORY_OPEN_MODE,
  nearby: [],
  backpack: {
    columns: 6,
    capacity: 24,
    slots: Array.from({ length: 36 }, () => null),
  },
  equipped: {
    primaryAttachments: { ...EMPTY_INVENTORY_ATTACHMENT_SLOTS },
    secondaryAttachments: { ...EMPTY_INVENTORY_ATTACHMENT_SLOTS },
    activeQuickSlot: 'primary',
  },
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
  controllerConnected: boolean;
  canInteract: boolean;
  interactWeaponKind: WeaponSnapshotKind | null;
  inventoryPanelOpen: boolean;
  inventoryPanelMode: InventoryOpenMode;
  inventory: InventoryPanelSnapshot;
  weaponLoadout: PlayerWeaponLoadoutSnapshot;
  weaponReload: PlayerWeaponReloadSnapshot;
};

export const DEFAULT_PLAYER_SNAPSHOT: PlayerSnapshot = {
  x: 0,
  y: 0,
  z: 6,
  speed: 0,
  sprinting: false,
  movementTier: 'jog',
  crouched: false,
  moving: false,
  grounded: true,
  pointerLocked: false,
  controllerConnected: false,
  canInteract: false,
  interactWeaponKind: null,
  inventoryPanelOpen: false,
  inventoryPanelMode: DEFAULT_INVENTORY_OPEN_MODE,
  inventory: DEFAULT_INVENTORY_PANEL_SNAPSHOT,
  weaponLoadout: {
    activeSlot: 'slotA',
    weaponRaised: false,
    slotA: {
      weaponKind: 'rifle',
      hasWeapon: false,
      magAmmo: 0,
      reserveAmmo: 0,
      infiniteReserveAmmo: false,
      maxMagAmmo: 30,
      maxReserveAmmo: 240,
      maxPacks: 8,
      packAmmo: 30,
    },
    slotB: {
      weaponKind: 'sniper',
      hasWeapon: false,
      magAmmo: 0,
      reserveAmmo: 0,
      infiniteReserveAmmo: false,
      maxMagAmmo: 7,
      maxReserveAmmo: 120,
      maxPacks: 4,
      packAmmo: 30,
    },
  },
  weaponReload: {
    active: false,
    weaponKind: null,
    progress: 1,
    remainingMs: 0,
  },
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
