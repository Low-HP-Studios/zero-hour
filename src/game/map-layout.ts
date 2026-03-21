export type WalkableSurfaceMaterial =
  | "yard"
  | "interior"
  | "upper"
  | "poolDeck"
  | "stair";

export type WalkableSlab = {
  kind: "slab";
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number;
  thickness?: number;
  material?: WalkableSurfaceMaterial;
};

export type WalkableRamp = {
  kind: "ramp";
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  startY: number;
  endY: number;
  axis: "x" | "z";
  thickness?: number;
  material?: WalkableSurfaceMaterial;
};

export type WalkableSurface = WalkableSlab | WalkableRamp;

export type BlockingVolumeMaterial = "wall" | "railing" | "cover";

export type BlockingVolume = {
  center: [number, number, number];
  size: [number, number, number];
  material?: BlockingVolumeMaterial;
};

const SURFACE_EPSILON = 0.001;

export function getWalkableSurfaceHeight(
  surface: WalkableSurface,
  x: number,
  z: number,
): number | null {
  if (
    x < surface.minX - SURFACE_EPSILON ||
    x > surface.maxX + SURFACE_EPSILON ||
    z < surface.minZ - SURFACE_EPSILON ||
    z > surface.maxZ + SURFACE_EPSILON
  ) {
    return null;
  }

  if (surface.kind === "slab") {
    return surface.y;
  }

  if (surface.axis === "x") {
    const width = Math.max(SURFACE_EPSILON, surface.maxX - surface.minX);
    const t = (x - surface.minX) / width;
    return lerp(surface.startY, surface.endY, clamp01(t));
  }

  const depth = Math.max(SURFACE_EPSILON, surface.maxZ - surface.minZ);
  const t = (z - surface.minZ) / depth;
  return lerp(surface.startY, surface.endY, clamp01(t));
}

export function sampleWalkableSurfaceHeight(
  surfaces: readonly WalkableSurface[],
  x: number,
  z: number,
  currentY: number,
  maxStepUp = Number.POSITIVE_INFINITY,
): number | null {
  let resolvedHeight: number | null = null;
  const maxAllowedHeight = currentY + maxStepUp;

  for (const surface of surfaces) {
    const height = getWalkableSurfaceHeight(surface, x, z);
    if (height === null) {
      continue;
    }
    if (height > maxAllowedHeight) {
      continue;
    }

    if (resolvedHeight === null || height > resolvedHeight) {
      resolvedHeight = height;
    }
  }

  return resolvedHeight;
}

export function getWalkableSurfaceThickness(surface: WalkableSurface): number {
  return surface.thickness ?? 0.6;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}
