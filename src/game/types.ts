export type PixelRatioScale = 0.75 | 1 | 1.25;
export type StressModeCount = 0 | 50 | 100 | 200;

export type AimSensitivitySettings = {
  look: number;
  rifleAds: number;
  sniperAds: number;
  vertical: number;
};

export const DEFAULT_AIM_SENSITIVITY_SETTINGS: AimSensitivitySettings = {
  look: 100,
  rifleAds: 80,
  sniperAds: 55,
  vertical: 100,
};

export type ControlBindings = {
  moveForward: string;
  moveBackward: string;
  moveLeft: string;
  moveRight: string;
  sprint: string;
  jump: string;
  pickup: string;
  drop: string;
  reset: string;
  equipRifle: string;
  equipSniper: string;
  toggleView: string;
  shoulderLeft: string;
  shoulderRight: string;
};

export const DEFAULT_CONTROL_BINDINGS: ControlBindings = {
  moveForward: "KeyW",
  moveBackward: "KeyS",
  moveLeft: "KeyA",
  moveRight: "KeyD",
  sprint: "ShiftLeft",
  jump: "Space",
  pickup: "KeyF",
  drop: "KeyG",
  reset: "KeyR",
  equipRifle: "Digit1",
  equipSniper: "Digit2",
  toggleView: "KeyV",
  shoulderLeft: "KeyQ",
  shoulderRight: "KeyE",
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
  performance: true,
};

export type GameSettings = {
  shadows: boolean;
  pixelRatioScale: PixelRatioScale;
  showR3fPerf: boolean;
  sensitivity: AimSensitivitySettings;
  keybinds: ControlBindings;
};

export type PerfMetrics = {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
};

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

export type WorldBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type TargetState = {
  id: string;
  position: [number, number, number];
  radius: number;
  hitUntil: number;
  disabled: boolean;
  hp: number;
  maxHp: number;
};
