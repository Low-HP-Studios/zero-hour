import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { loadGlbAsset } from "../AssetLoader";

const GLTF_BASE = "/assets/space/glTF/";

type Placement = [number, number, number, number];

function seededRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const DEAD_TREES: Placement[] = [
  [-55, -10, 0.3, 1.33],
  [48, -30, 2.4, 1.47],
  [-8, 58, 1.9, 1.18],
];

const COMMON_TREES: Placement[] = [
  [-68, -70, 0.8, 0.84],
  [70, 68, 2.5, 0.8],
];

const BUSHES: Placement[] = [
  [-40, -15, 0.4, 0.84],
  [34, 18, 1.8, 0.72],
];

const ROCKS_MEDIUM: Placement[] = [
  [-60, -40, 0.5, 1.05],
  [55, 40, 2.3, 1.26],
  [20, 68, 0.2, 0.94],
];

const PLANTS: Placement[] = [
  [-35, -18, 0.6, 0.7],
  [44, -8, 2.1, 0.76],
  [-18, 34, 1.6, 0.66],
];

const OUTER_DEAD_TREES: Placement[] = [
  [-116, -92, 1.1, 1.42],
  [128, -104, 0.4, 1.58],
  [-148, 104, 2.5, 1.26],
  [104, 138, 1.8, 1.34],
];

const OUTER_COMMON_TREES: Placement[] = [
  [-188, -42, 2.1, 1.05],
  [176, 66, 0.9, 0.96],
  [96, -176, 2.8, 1.1],
];

const OUTER_BUSHES: Placement[] = [
  [-96, -54, 0.6, 0.92],
  [114, 78, 2.1, 0.88],
  [-142, 118, 1.2, 0.81],
  [154, -134, 2.7, 0.86],
];

const OUTER_ROCKS_MEDIUM: Placement[] = [
  [-94, 36, 0.8, 1.22],
  [136, 24, 2.5, 1.35],
  [-174, -94, 0.3, 1.44],
  [166, 146, 1.6, 1.52],
  [88, -118, 2.2, 1.18],
];

const OUTER_PLANTS: Placement[] = [
  [-108, -20, 0.2, 0.88],
  [102, 104, 1.7, 0.84],
  [-124, 152, 2.3, 0.78],
  [148, -52, 0.9, 0.8],
];

export const PATH_POINTS: [number, number][] = [
  [20, 60],
  [15, 45],
  [8, 30],
  [0, 15],
  [-5, 0],
  [-8, -15],
  [-3, -30],
  [5, -45],
  [12, -55],
  [18, -65],
];

function useLoadedModel(name: string) {
  const [model, setModel] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadGlbAsset(`${GLTF_BASE}${name}.gltf`).then((result) => {
      if (!cancelled && result) {
        setModel(result);
      }
    });
    return () => { cancelled = true; };
  }, [name]);
  return model;
}

function useLoadedModels(names: string[]) {
  const [models, setModels] = useState<(THREE.Group | null)[]>(() => names.map(() => null));
  const namesKey = names.join(",");
  useEffect(() => {
    let cancelled = false;
    Promise.all(names.map((n) => loadGlbAsset(`${GLTF_BASE}${n}.gltf`))).then((results) => {
      if (!cancelled) {
        setModels(results);
      }
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey]);
  return models;
}

function PlacedModel({
  model,
  x,
  z,
  rotY,
  scale,
  castShadow,
}: {
  model: THREE.Group;
  x: number;
  z: number;
  rotY: number;
  scale: number;
  castShadow: boolean;
}) {
  const cloned = useMemo(() => {
    const c = model.clone(true);
    c.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        (child as THREE.Mesh).castShadow = castShadow;
        (child as THREE.Mesh).receiveShadow = castShadow;
      }
    });
    return c;
  }, [model, castShadow]);

  return (
    <primitive
      object={cloned}
      position={[x, 0, z]}
      rotation={[0, rotY, 0]}
      scale={[scale, scale, scale]}
    />
  );
}

function PlacedModels({
  models,
  placements,
  shadows,
  variantCount,
}: {
  models: (THREE.Group | null)[];
  placements: Placement[];
  shadows: boolean;
  variantCount: number;
}) {
  return (
    <>
      {placements.map(([x, z, rotY, scale], i) => {
        const variant = models[i % variantCount];
        if (!variant) return null;
        return (
          <PlacedModel
            key={`${x}_${z}_${i}`}
            model={variant}
            x={x}
            z={z}
            rotY={rotY}
            scale={scale}
            castShadow={shadows}
          />
        );
      })}
    </>
  );
}

function InstancedGrass({ theme, shadows }: { theme: number; shadows: boolean }) {
  const grassModels = useLoadedModels([
    "Grass_Common_Short",
    "Grass_Common_Tall",
    "Grass_Wispy_Short",
    "Grass_Wispy_Tall",
  ]);

  const loaded = grassModels.every((m) => m !== null);
  if (!loaded) return null;

  const rng = seededRandom(12345);
  const positions: Placement[] = [];
  for (let i = 0; i < 12; i++) {
    const x = (rng() - 0.5) * 160;
    const z = (rng() - 0.5) * 160;
    const rotY = rng() * Math.PI * 2;
    const scale = 0.2 + rng() * 0.22;
    positions.push([x, z, rotY, scale]);
  }

  return (
    <group visible={theme >= 0.45}>
      <PlacedModels
        models={grassModels}
        placements={positions}
        shadows={shadows}
        variantCount={4}
      />
    </group>
  );
}

function InstancedPebbles({ theme, shadows }: { theme: number; shadows: boolean }) {
  const pebbleModels = useLoadedModels([
    "Pebble_Round_1",
    "Pebble_Round_2",
    "Pebble_Round_3",
    "Pebble_Square_1",
    "Pebble_Square_2",
    "Pebble_Square_3",
  ]);

  const loaded = pebbleModels.some((m) => m !== null);
  if (!loaded) return null;

  const rng = seededRandom(54321);
  const positions: Placement[] = [];

  for (const [px, pz] of PATH_POINTS) {
    const offsetX = (rng() - 0.5) * 12;
    const offsetZ = (rng() - 0.5) * 8;
    positions.push([
      px + offsetX,
      pz + offsetZ,
      rng() * Math.PI * 2,
      0.21 + rng() * 0.35,
    ]);
  }

  for (let i = 0; i < 3; i++) {
    positions.push([
      (rng() - 0.5) * 140,
      (rng() - 0.5) * 140,
      rng() * Math.PI * 2,
      0.21 + rng() * 0.28,
    ]);
  }

  return (
    <group visible={theme >= 0.3}>
      <PlacedModels
        models={pebbleModels}
        placements={positions}
        shadows={shadows}
        variantCount={6}
      />
    </group>
  );
}

function StonePath({ theme, shadows }: { theme: number; shadows: boolean }) {
  const pathModels = useLoadedModels([
    "RockPath_Round_Small_1",
    "RockPath_Round_Small_2",
    "RockPath_Round_Small_3",
    "RockPath_Round_Thin",
    "RockPath_Round_Wide",
    "RockPath_Square_Small_1",
    "RockPath_Square_Small_2",
    "RockPath_Square_Small_3",
    "RockPath_Square_Thin",
    "RockPath_Square_Wide",
  ]);

  const loaded = pathModels.some((m) => m !== null);
  if (!loaded) return null;

  const rng = seededRandom(77777);
  const placements: Placement[] = [];

  for (let i = 0; i < PATH_POINTS.length - 1; i += 3) {
    const [x1, z1] = PATH_POINTS[i];
    const x = x1 + (rng() - 0.5) * 4;
    const z = z1 + (rng() - 0.5) * 3;
    placements.push([x, z, rng() * Math.PI * 2, 0.56 + rng() * 0.56]);
  }

  return (
    <group position={[0, -0.02, 0]} visible={theme >= 0.3}>
      <PlacedModels
        models={pathModels}
        placements={placements}
        shadows={shadows}
        variantCount={10}
      />
    </group>
  );
}

export function DesertProps({ theme, shadows }: { theme: number; shadows: boolean }) {
  const deadTreeModels = useLoadedModels(["DeadTree_1", "DeadTree_2"]);
  const commonTreeModels = useLoadedModels(["CommonTree_1", "CommonTree_2"]);
  const bushModel = useLoadedModel("Bush_Common");
  const rockModels = useLoadedModels(["Rock_Medium_1", "Rock_Medium_2"]);
  const plantModels = useLoadedModels(["Plant_1"]);

  return (
    <group visible={theme >= 0.2}>
      <PlacedModels
        models={deadTreeModels}
        placements={DEAD_TREES}
        shadows={shadows}
        variantCount={2}
      />

      <PlacedModels
        models={rockModels}
        placements={OUTER_ROCKS_MEDIUM}
        shadows={shadows}
        variantCount={2}
      />

      <PlacedModels
        models={deadTreeModels}
        placements={OUTER_DEAD_TREES}
        shadows={shadows}
        variantCount={2}
      />

      <PlacedModels
        models={commonTreeModels}
        placements={COMMON_TREES}
        shadows={shadows}
        variantCount={2}
      />

      <PlacedModels
        models={commonTreeModels}
        placements={OUTER_COMMON_TREES}
        shadows={shadows}
        variantCount={2}
      />

      <PlacedModels
        models={bushModel ? [bushModel] : []}
        placements={BUSHES}
        shadows={shadows}
        variantCount={1}
      />

      <PlacedModels
        models={bushModel ? [bushModel] : []}
        placements={OUTER_BUSHES}
        shadows={shadows}
        variantCount={1}
      />

      <PlacedModels
        models={rockModels}
        placements={ROCKS_MEDIUM}
        shadows={shadows}
        variantCount={2}
      />

      <PlacedModels
        models={plantModels}
        placements={PLANTS}
        shadows={shadows}
        variantCount={1}
      />

      <PlacedModels
        models={plantModels}
        placements={OUTER_PLANTS}
        shadows={shadows}
        variantCount={1}
      />

      <StonePath theme={theme} shadows={shadows} />
      <InstancedGrass theme={theme} shadows={shadows} />
      <InstancedPebbles theme={theme} shadows={shadows} />
    </group>
  );
}
