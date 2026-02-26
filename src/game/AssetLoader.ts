import type * as THREE from "three";

const glbCache = new Map<string, Promise<THREE.Group | null>>();
const audioBufferCache = new Map<string, Promise<AudioBuffer | null>>();

export function loadGlbAsset(url: string): Promise<THREE.Group | null> {
  const cached = glbCache.get(url);
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
        loader.load(url, resolve, undefined, reject);
      });
      return gltf.scene;
    } catch {
      return null;
    }
  })();

  glbCache.set(url, request);
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
