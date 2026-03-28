import * as THREE from "three";

export type GltfResult = {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
};

export type PreloadBucket = "asset" | "audio";

export type PreloadManifestEntry = {
  id: string;
  label: string;
  weight: number;
  bucket: PreloadBucket;
  load: () => Promise<unknown>;
};

export type PreloadManifestProgress = {
  completedWeight: number;
  totalWeight: number;
  completedCount: number;
  totalCount: number;
  ratio: number;
  currentLabel: string;
};

const glbCache = new Map<string, Promise<THREE.Group | null>>();
const gltfFullCache = new Map<string, Promise<GltfResult | null>>();
const fbxCache = new Map<string, Promise<THREE.Group | null>>();
const audioBufferCache = new Map<string, Promise<AudioBuffer | null>>();
const textureCache = new Map<string, Promise<THREE.Texture | null>>();

THREE.Cache.enabled = true;

export function loadGlbAsset(url: string): Promise<THREE.Group | null> {
  const cacheKey = encodeURI(url);
  const cached = glbCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const request = (async () => {
    try {
      const [{ GLTFLoader }] = await Promise.all([
        import("three/examples/jsm/loaders/GLTFLoader.js"),
      ]);
      const loader = new GLTFLoader();
      const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
        loader.load(cacheKey, resolve, undefined, reject);
      });
      return gltf.scene;
    } catch {
      return null;
    }
  })();

  glbCache.set(cacheKey, request);
  return request;
}

export function loadGlbWithAnimations(url: string): Promise<GltfResult | null> {
  const cacheKey = encodeURI(url);
  const cached = gltfFullCache.get(cacheKey);
  if (cached) return cached;

  const request = (async () => {
    try {
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const loader = new GLTFLoader();
      const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(
        (resolve, reject) => {
          loader.load(cacheKey, resolve, undefined, reject);
        },
      );
      return { scene: gltf.scene, animations: gltf.animations };
    } catch {
      return null;
    }
  })();

  gltfFullCache.set(cacheKey, request);
  return request;
}

const fbxAnimCache = new Map<string, Promise<THREE.AnimationClip | null>>();

function pickFbxMotionClip(clips: THREE.AnimationClip[]): THREE.AnimationClip | null {
  if (clips.length === 0) return null;

  // Characters3D exports include a short "T-Pose" clip at index 0.
  // Prefer a non-T-pose motion clip when present.
  const motion = clips.find((clip) => {
    const lowerName = clip.name.toLowerCase();
    return !lowerName.includes("t-pose") && clip.duration > 0.1 && clip.tracks.length > 0;
  });
  if (motion) return motion;

  // Fallback: choose the longest clip so we still get something useful.
  let longest = clips[0];
  for (let i = 1; i < clips.length; i++) {
    if (clips[i].duration > longest.duration) {
      longest = clips[i];
    }
  }
  return longest;
}

export function loadFbxAnimation(url: string, clipName?: string): Promise<THREE.AnimationClip | null> {
  const cacheKey = `${url}::${clipName ?? ""}`;
  const cached = fbxAnimCache.get(cacheKey);
  if (cached) return cached;

  const request = (async () => {
    try {
      const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
      const loader = new FBXLoader();
      const fbx = await new Promise<THREE.Group>((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
      });
      const sourceClip = pickFbxMotionClip(fbx.animations);
      if (!sourceClip) return null;

      // Clone so renaming does not mutate shared loader instances.
      const clip = sourceClip.clone();
      if (clipName) clip.name = clipName;
      return clip;
    } catch (e) {
      console.warn("[AssetLoader] FBX animation load failed:", url, e);
      return null;
    }
  })();

  fbxAnimCache.set(cacheKey, request);
  return request;
}

export function loadFbxAsset(url: string): Promise<THREE.Group | null> {
  const cached = fbxCache.get(url);
  if (cached) {
    return cached;
  }

  const request = (async () => {
    try {
      const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
      const loader = new FBXLoader();
      const resourcePath = url.substring(0, url.lastIndexOf("/") + 1);
      loader.setResourcePath(resourcePath);
      const fbx = await new Promise<THREE.Group>((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
      });
      return fbx;
    } catch (e) {
      console.warn("[AssetLoader] FBX load failed:", url, e);
      return null;
    }
  })();

  fbxCache.set(url, request);
  return request;
}

export function preloadTextureAsset(url: string): Promise<THREE.Texture | null> {
  const cacheKey = encodeURI(url);
  const cached = textureCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const request = (async () => {
    try {
      const loader = new THREE.TextureLoader();
      return await new Promise<THREE.Texture>((resolve, reject) => {
        loader.load(cacheKey, resolve, undefined, reject);
      });
    } catch (error) {
      console.warn("[AssetLoader] Texture load failed:", cacheKey, error);
      return null;
    }
  })();

  textureCache.set(cacheKey, request);
  return request;
}

export async function fetchBinaryAsset(url: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

export function loadAudioBuffer(
  context: BaseAudioContext,
  url: string,
): Promise<AudioBuffer | null> {
  const cacheKey = `${url}::${context.sampleRate}`;
  const cached = audioBufferCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const request = (async () => {
    const bytes = await fetchBinaryAsset(url);
    if (!bytes) {
      return null;
    }

    try {
      // decodeAudioData mutates / detaches buffers in some engines, so hand it a copy.
      const cloned = bytes.slice(0);
      return await context.decodeAudioData(cloned);
    } catch {
      return null;
    }
  })();

  audioBufferCache.set(cacheKey, request);
  return request;
}

type RunPreloadManifestOptions = {
  concurrency?: Partial<Record<PreloadBucket, number>>;
  onProgress?: (progress: PreloadManifestProgress) => void;
};

export async function runPreloadManifest(
  entries: PreloadManifestEntry[],
  options: RunPreloadManifestOptions = {},
): Promise<{ errors: Array<{ id: string; error: unknown }> }> {
  const totalCount = entries.length;
  const totalWeight = entries.reduce(
    (sum, entry) => sum + Math.max(0.0001, entry.weight),
    0,
  );
  let completedCount = 0;
  let completedWeight = 0;
  let currentLabel = entries[0]?.label ?? "Ready";

  const reportProgress = () => {
    options.onProgress?.({
      completedWeight,
      totalWeight,
      completedCount,
      totalCount,
      ratio: totalWeight > 0 ? completedWeight / totalWeight : 1,
      currentLabel,
    });
  };

  reportProgress();

  if (entries.length === 0) {
    return { errors: [] };
  }

  const errors: Array<{ id: string; error: unknown }> = [];
  const concurrency = {
    asset: options.concurrency?.asset ?? 3,
    audio: options.concurrency?.audio ?? 2,
  } satisfies Record<PreloadBucket, number>;

  const runBucket = async (bucket: PreloadBucket) => {
    const bucketEntries = entries.filter((entry) => entry.bucket === bucket);
    if (bucketEntries.length === 0) {
      return;
    }

    let nextIndex = 0;
    const workerCount = Math.max(1, concurrency[bucket]);

    const runNext = async (): Promise<void> => {
      const entry = bucketEntries[nextIndex];
      nextIndex += 1;

      if (!entry) {
        return;
      }

      currentLabel = entry.label;
      reportProgress();

      try {
        await entry.load();
      } catch (error) {
        console.warn("[AssetLoader] Preload entry failed:", entry.id, error);
        errors.push({ id: entry.id, error });
      } finally {
        completedCount += 1;
        completedWeight += Math.max(0.0001, entry.weight);
        currentLabel = completedCount >= totalCount ? "Ready" : entry.label;
        reportProgress();
      }

      await runNext();
    };

    await Promise.all(
      Array.from(
        { length: Math.min(workerCount, bucketEntries.length) },
        () => runNext(),
      ),
    );
  };

  await Promise.all([runBucket("asset"), runBucket("audio")]);

  currentLabel = "Ready";
  reportProgress();

  return { errors };
}
