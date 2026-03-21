import {
  loadFbxAnimation,
  loadFbxAsset,
  preloadTextureAsset,
  type PreloadManifestEntry,
} from "./AssetLoader";
import type { AudioBufferKey, AudioManager } from "./Audio";
import {
  SIGHT_FBX_URL,
  SIGHT_TEXTURE_BASE,
  SIGHT_TEXTURE_MAP,
} from "./scene/scene-constants";

export const TARGET_CHARACTER_MODEL_URL =
  "/assets/models/character/Trooper/tactical guy.fbx";
export const TARGET_IDLE_ANIMATION_URL =
  "/assets/animations/movement/standing/idle.fbx";

export const TARGET_TEXTURE_URLS: string[] = [];

const DEFERRED_AUDIO_KEYS: readonly AudioBufferKey[] = [
  "rifleShot",
  "sniperShot",
  "sniperShell",
  "rifleReload",
  "sniperReload",
  "dryFire",
  "footstep",
  "kill",
  "hit",
];

const AUDIO_LABELS: Record<AudioBufferKey, string> = {
  rifleShot: "Rifle shot audio",
  sniperShot: "Sniper shot audio",
  sniperShell: "Sniper shell audio",
  rifleReload: "Rifle reload audio",
  sniperReload: "Sniper reload audio",
  dryFire: "Dry fire audio",
  footstep: "Footstep audio",
  kill: "Kill sound",
  hit: "Hit sound",
};

const AUDIO_WEIGHTS: Record<AudioBufferKey, number> = {
  rifleShot: 1.4,
  sniperShot: 1.4,
  sniperShell: 1.1,
  rifleReload: 1.1,
  sniperReload: 1.1,
  dryFire: 0.9,
  footstep: 1.6,
  kill: 1.0,
  hit: 0.8,
};

export function createDeferredBootPreloadManifest(
  audioManager: AudioManager,
): PreloadManifestEntry[] {
  return [
    {
      id: "sight:model",
      label: "Weapon sights model",
      weight: 3,
      bucket: "asset",
      load: () => loadFbxAsset(SIGHT_FBX_URL),
    },
    ...[
      ["rifle", SIGHT_TEXTURE_MAP.rifle.base],
      ["rifle", SIGHT_TEXTURE_MAP.rifle.metallic],
      ["rifle", SIGHT_TEXTURE_MAP.rifle.normal],
      ["rifle", SIGHT_TEXTURE_MAP.rifle.roughness],
    ]
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
      .map(([key, file]) => ({
        id: `texture:sight-${key}-${file}`,
        label: `Sight texture ${humanize(file)}`,
        weight: 1.5,
        bucket: "asset" as const,
        load: () => preloadTextureAsset(SIGHT_TEXTURE_BASE + file),
      })),
    {
      id: "target:character",
      label: "Target character",
      weight: 6,
      bucket: "asset",
      load: () => loadFbxAsset(TARGET_CHARACTER_MODEL_URL),
    },
    {
      id: "target:idle",
      label: "Target idle animation",
      weight: 2,
      bucket: "asset",
      load: () => loadFbxAnimation(TARGET_IDLE_ANIMATION_URL, "idle"),
    },
    ...TARGET_TEXTURE_URLS.map((url) => ({
      id: `texture:${url}`,
      label: `Target texture ${humanize(fileName(url))}`,
      weight: 5,
      bucket: "asset" as const,
      load: () => preloadTextureAsset(url),
    })),
    ...DEFERRED_AUDIO_KEYS.map((key) => ({
      id: `audio:${key}`,
      label: AUDIO_LABELS[key],
      weight: AUDIO_WEIGHTS[key],
      bucket: "audio" as const,
      load: () => audioManager.prepareBuffer(key),
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
