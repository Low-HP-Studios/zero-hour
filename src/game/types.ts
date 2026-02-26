export type PixelRatioScale = 0.75 | 1 | 1.25;
export type StressModeCount = 0 | 50 | 100 | 200;

export type GameSettings = {
  shadows: boolean;
  pixelRatioScale: PixelRatioScale;
  showPerfHud: boolean;
  showR3fPerf: boolean;
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
  pointerLocked: boolean;
  canInteract: boolean;
};

export const DEFAULT_PLAYER_SNAPSHOT: PlayerSnapshot = {
  x: 0,
  y: 1.65,
  z: 6,
  speed: 0,
  sprinting: false,
  moving: false,
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
};
