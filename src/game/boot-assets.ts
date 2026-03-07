import {
  loadFbxAnimation,
  loadFbxAsset,
  loadGlbAsset,
  loadGlbWithAnimations,
  preloadTextureAsset,
  type PreloadManifestEntry,
} from "./AssetLoader";
import type { AudioBufferKey, AudioManager } from "./Audio";
import {
  ANIM_CLIPS,
  CHARACTER_MODEL_URL,
  CHARACTER_TEXTURE_BASE,
  CHARACTER_TEXTURE_MAP,
  WEAPON_MODEL_URLS,
} from "./scene/scene-constants";

export const TARGET_CHARACTER_MODEL_URL =
  "/assets/models/character/robot/robot.gltf";

export const TARGET_TEXTURE_URLS: string[] = [];

export const DESERT_MODEL_NAMES = [
  "DeadTree_1",
  "DeadTree_2",
  "CommonTree_1",
  "CommonTree_2",
  "Bush_Common",
  "Rock_Medium_1",
  "Rock_Medium_2",
  "Fern_1",
  "Plant_1",
  "Flower_3_Group",
  "Grass_Common_Short",
  "Grass_Common_Tall",
  "Grass_Wispy_Short",
  "Grass_Wispy_Tall",
  "Pebble_Round_1",
  "Pebble_Round_2",
  "Pebble_Round_3",
  "Pebble_Square_1",
  "Pebble_Square_2",
  "Pebble_Square_3",
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
  "Clover_1",
  "Clover_2",
  "Petal_1",
  "Petal_2",
  "Petal_3",
] as const;

export const DESERT_TEXTURE_URLS = [
  "/assets/space/glTF/Bark_DeadTree.png",
  "/assets/space/glTF/Bark_NormalTree.png",
  "/assets/space/glTF/Bark_TwistedTree.png",
  "/assets/space/glTF/Leaves.png",
  "/assets/space/glTF/Leaves_NormalTree_C.png",
  "/assets/space/glTF/Leaves_TwistedTree_C.png",
  "/assets/space/glTF/Flowers.png",
  "/assets/space/glTF/Grass.png",
  "/assets/space/glTF/Rocks_Diffuse.png",
  "/assets/space/glTF/PathRocks_Diffuse.png",
] as const;

const BOOT_AUDIO_KEYS: readonly AudioBufferKey[] = [
  "rifleShot",
  "sniperShot",
  "sniperShell",
  "footstep",
  "kill",
];

const AUDIO_LABELS: Record<AudioBufferKey, string> = {
  rifleShot: "Rifle shot audio",
  sniperShot: "Sniper shot audio",
  sniperShell: "Sniper shell audio",
  footstep: "Footstep audio",
  kill: "Kill sound",
  hit: "Hit sound",
};

const AUDIO_WEIGHTS: Record<AudioBufferKey, number> = {
  rifleShot: 1.4,
  sniperShot: 1.4,
  sniperShell: 1.1,
  footstep: 1.6,
  kill: 1.0,
  hit: 0.8,
};

export const CHARACTER_TEXTURE_URLS = Array.from(
  new Set(
    Object.values(CHARACTER_TEXTURE_MAP).flatMap(({ base, normal }) => [
      `${CHARACTER_TEXTURE_BASE}${base}`,
      `${CHARACTER_TEXTURE_BASE}${normal}`,
    ]),
  ),
);

export function createBootPreloadManifest(
  audioManager: AudioManager,
): PreloadManifestEntry[] {
  return [
    {
      id: "character:model",
      label: "Character model",
      weight: 7,
      bucket: "asset",
      load: () => loadFbxAsset(CHARACTER_MODEL_URL),
    },
    ...ANIM_CLIPS.map((clip) => ({
      id: `anim:${clip.name}`,
      label: `${humanize(clip.name)} animation`,
      weight: 3,
      bucket: "asset" as const,
      load: () => loadFbxAnimation(clip.url, clip.name),
    })),
    {
      id: "weapon:rifle",
      label: "Rifle model",
      weight: 3.5,
      bucket: "asset",
      load: () => loadFbxAsset(WEAPON_MODEL_URLS.rifle),
    },
    {
      id: "weapon:sniper",
      label: "Sniper model",
      weight: 3.5,
      bucket: "asset",
      load: () => loadFbxAsset(WEAPON_MODEL_URLS.sniper),
    },
    ...CHARACTER_TEXTURE_URLS.map((url) => ({
      id: `texture:${url}`,
      label: `Character texture ${humanize(fileName(url))}`,
      weight: characterTextureWeight(url),
      bucket: "asset" as const,
      load: () => preloadTextureAsset(url),
    })),
    {
      id: "target:robot",
      label: "Target robot",
      weight: 6,
      bucket: "asset",
      load: () => loadGlbWithAnimations(TARGET_CHARACTER_MODEL_URL),
    },
    ...TARGET_TEXTURE_URLS.map((url) => ({
      id: `texture:${url}`,
      label: `Target texture ${humanize(fileName(url))}`,
      weight: 5,
      bucket: "asset" as const,
      load: () => preloadTextureAsset(url),
    })),
    ...BOOT_AUDIO_KEYS.map((key) => ({
      id: `audio:${key}`,
      label: AUDIO_LABELS[key],
      weight: AUDIO_WEIGHTS[key],
      bucket: "audio" as const,
      load: () => audioManager.prepareBuffer(key),
    })),
    ...DESERT_MODEL_NAMES.map((name) => ({
      id: `desert:${name}`,
      label: `Environment model ${humanize(name)}`,
      weight: desertModelWeight(name),
      bucket: "asset" as const,
      load: () => loadGlbAsset(`/assets/space/glTF/${name}.gltf`),
    })),
    ...DESERT_TEXTURE_URLS.map((url) => ({
      id: `texture:${url}`,
      label: `Environment texture ${humanize(fileName(url))}`,
      weight: desertTextureWeight(url),
      bucket: "asset" as const,
      load: () => preloadTextureAsset(url),
    })),
  ];
}

function fileName(url: string) {
  const lastSlash = url.lastIndexOf("/");
  return lastSlash >= 0 ? url.slice(lastSlash + 1) : url;
}

function humanize(value: string) {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function characterTextureWeight(url: string) {
  return url.includes("Body_") ? 3 : 2;
}

function desertTextureWeight(url: string) {
  if (url.includes("Rocks_Desert") || url.includes("Rocks_Diffuse")) {
    return 3;
  }
  return 2;
}

function desertModelWeight(name: string) {
  if (
    name.startsWith("DeadTree") ||
    name.startsWith("TwistedTree") ||
    name.startsWith("CommonTree")
  ) {
    return 2.2;
  }
  if (
    name.startsWith("RockPath") ||
    name.startsWith("Grass") ||
    name.startsWith("Pebble")
  ) {
    return 1.2;
  }
  return 1.5;
}
