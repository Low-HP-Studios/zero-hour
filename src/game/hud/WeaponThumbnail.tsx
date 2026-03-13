import { useEffect, useState } from "react";
import * as THREE from "three";
import { cloneWeaponModel } from "../scene/WeaponModels";

type WeaponThumbnailProps = {
  model: THREE.Group | null;
  kind: "rifle" | "sniper";
};

const THUMB_WIDTH = 256;
const THUMB_HEIGHT = 128;

function renderThumbnail(source: THREE.Group): string | null {
  const clone = cloneWeaponModel(source);
  if (!clone) return null;

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(THUMB_WIDTH, THUMB_HEIGHT);
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

  // Dispose
  renderer.dispose();
  scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((m) => m?.dispose());
    }
  });

  return dataUrl;
}

export function WeaponThumbnail({ model, kind }: WeaponThumbnailProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!model) {
      setDataUrl(null);
      return;
    }

    // Render in next microtask to avoid blocking
    const id = requestAnimationFrame(() => {
      const url = renderThumbnail(model);
      setDataUrl(url);
    });

    return () => cancelAnimationFrame(id);
  }, [model]);

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
