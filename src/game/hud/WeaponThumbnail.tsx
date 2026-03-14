import { useEffect, useState } from "react";
import * as THREE from "three";
import { cloneWeaponModel } from "../scene/WeaponModels";

type WeaponThumbnailProps = {
  model: THREE.Group | null;
  kind: "rifle" | "sniper";
};

const THUMB_WIDTH = 256;
const THUMB_HEIGHT = 128;

const THUMBNAIL_CACHE = new Map<string, string>();
let sharedThumbnailRenderer: THREE.WebGLRenderer | null = null;

function getThumbnailRenderer(): THREE.WebGLRenderer | null {
  if (sharedThumbnailRenderer) {
    const context = sharedThumbnailRenderer.getContext();
    if (!context.isContextLost()) {
      return sharedThumbnailRenderer;
    }
    try {
      sharedThumbnailRenderer.dispose();
      sharedThumbnailRenderer.forceContextLoss();
    } catch {
      // Ignore renderer teardown failures and recreate below.
    }
    sharedThumbnailRenderer = null;
  }

  try {
    sharedThumbnailRenderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: "low-power",
    });
    sharedThumbnailRenderer.setPixelRatio(1);
    sharedThumbnailRenderer.setSize(THUMB_WIDTH, THUMB_HEIGHT, false);
    sharedThumbnailRenderer.setClearColor(0x000000, 0);
    return sharedThumbnailRenderer;
  } catch (error) {
    console.warn("[WeaponThumbnail] Failed to create renderer", error);
    return null;
  }
}

function buildThumbnailCacheKey(source: THREE.Group, kind: WeaponThumbnailProps["kind"]) {
  return `${kind}:${source.uuid}`;
}

function renderThumbnail(
  source: THREE.Group,
  kind: WeaponThumbnailProps["kind"],
): string | null {
  const cacheKey = buildThumbnailCacheKey(source, kind);
  const cached = THUMBNAIL_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  const renderer = getThumbnailRenderer();
  if (!renderer) {
    return null;
  }

  const clone = cloneWeaponModel(source);
  if (!clone) return null;
  renderer.setSize(THUMB_WIDTH, THUMB_HEIGHT, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.add(clone);

  // Compute bounding box and frame with orthographic camera
  const box = new THREE.Box3().setFromObject(clone);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, size.z);
  const padding = maxDim * 0.15;
  const halfW = (size.x + padding) / 2;
  const halfH = (size.y + padding) / 2;
  const aspect = THUMB_WIDTH / THUMB_HEIGHT;

  let camHalfW: number;
  let camHalfH: number;
  if (halfW / halfH > aspect) {
    camHalfW = halfW;
    camHalfH = halfW / aspect;
  } else {
    camHalfH = halfH;
    camHalfW = halfH * aspect;
  }

  const camera = new THREE.OrthographicCamera(
    -camHalfW,
    camHalfW,
    camHalfH,
    -camHalfH,
    0.01,
    maxDim * 10,
  );

  // Side profile view (looking from +Z toward center)
  camera.position.set(center.x, center.y, center.z + maxDim * 3);
  camera.lookAt(center);

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambient);
  const directional = new THREE.DirectionalLight(0xffffff, 1.2);
  directional.position.set(2, 3, 5);
  scene.add(directional);

  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL("image/png");
  scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((m) => m?.dispose());
    }
  });

  THUMBNAIL_CACHE.set(cacheKey, dataUrl);
  return dataUrl;
}

export function WeaponThumbnail({ model, kind }: WeaponThumbnailProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!model) {
      setDataUrl(null);
      return;
    }

    const cacheKey = buildThumbnailCacheKey(model, kind);
    const cached = THUMBNAIL_CACHE.get(cacheKey);
    if (cached) {
      setDataUrl(cached);
      return;
    }

    // Render in next microtask to avoid blocking
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      const url = renderThumbnail(model, kind);
      if (!cancelled) {
        setDataUrl(url);
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [kind, model]);

  if (dataUrl) {
    return (
      <img
        className="pubg-weapon-thumbnail"
        src={dataUrl}
        alt={kind}
        draggable={false}
      />
    );
  }

  // Fallback: text label
  const label = kind === "rifle" ? "AR" : "SR";
  return <div className="pubg-thumbnail-fallback">{label}</div>;
}
