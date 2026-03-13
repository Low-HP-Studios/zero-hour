import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { loadFbxAsset } from "../AssetLoader";
import { WEAPON_MODEL_URLS, type WeaponModelTransform } from "./scene-constants";

export type WeaponModelResult = {
  rifle: THREE.Group | null;
  sniper: THREE.Group | null;
  ready: boolean;
};

export function useWeaponModels(): WeaponModelResult {
  const [models, setModels] = useState<WeaponModelResult>({
    rifle: null,
    sniper: null,
    ready: false,
  });

  useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        const [rifle, sniper] = await Promise.all([
          loadFbxAsset(WEAPON_MODEL_URLS.rifle),
          loadFbxAsset(WEAPON_MODEL_URLS.sniper),
        ]);
        if (disposed) return;

        setModels({
          rifle,
          sniper,
          ready: true,
        });
      } catch (error) {
        console.warn("[Weapons] Weapon warm-up failed", error);
        if (!disposed) {
          setModels({
            rifle: null,
            sniper: null,
            ready: true,
          });
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, []);

  return models;
}

function normalizeWeaponMaterial(material: THREE.Material): THREE.Material {
  if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial &&
    !(material as THREE.MeshPhongMaterial).isMeshPhongMaterial &&
    !(material as THREE.MeshLambertMaterial).isMeshLambertMaterial &&
    !(material as THREE.MeshBasicMaterial).isMeshBasicMaterial) {
    return material.clone();
  }

  const source = material as THREE.MeshStandardMaterial &
    THREE.MeshPhongMaterial & THREE.MeshLambertMaterial & THREE.MeshBasicMaterial;
  const normalized = new THREE.MeshStandardMaterial({
    name: material.name,
    color: source.color ? source.color.clone() : new THREE.Color(0x8a9098),
    roughness: (source as THREE.MeshStandardMaterial).roughness ?? 0.64,
    metalness: (source as THREE.MeshStandardMaterial).metalness ?? 0.16,
    transparent: source.transparent,
    opacity: source.opacity,
    side: source.side,
  });
  normalized.map = source.map ?? null;
  normalized.normalMap = source.normalMap ?? null;
  normalized.alphaMap = source.alphaMap ?? null;
  normalized.aoMap = source.aoMap ?? null;
  normalized.emissiveMap = source.emissiveMap ?? null;
  normalized.roughnessMap = source.roughnessMap ?? null;
  normalized.metalnessMap = source.metalnessMap ?? null;

  if (normalized.map) {
    normalized.map.colorSpace = THREE.SRGBColorSpace;
  }

  // Some pack materials are near-black by default; lift them so details are visible.
  const maxChannel = Math.max(
    normalized.color.r,
    normalized.color.g,
    normalized.color.b,
  );
  if (!normalized.map && maxChannel < 0.18) {
    const scale = 0.22 / Math.max(maxChannel, 0.01);
    normalized.color.multiplyScalar(scale);
  }

  normalized.needsUpdate = true;
  return normalized;
}

export function cloneWeaponModel(source: THREE.Group | null): THREE.Group | null {
  if (!source) return null;

  const clone = source.clone(true);
  clone.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mesh.material = materials.map((material) => normalizeWeaponMaterial(material));
  });
  return clone;
}

type WeaponModelInstanceProps = {
  source: THREE.Group | null;
  transform: WeaponModelTransform;
};

export function WeaponModelInstance({ source, transform }: WeaponModelInstanceProps) {
  const instance = useMemo(() => cloneWeaponModel(source), [source]);
  if (!instance) return null;

  return (
    <group
      position={transform.position}
      rotation={transform.rotation}
      scale={[transform.scale, transform.scale, transform.scale]}
    >
      <primitive object={instance} />
    </group>
  );
}

export function computeWeaponMuzzleOffset(
  model: THREE.Group,
  transform: WeaponModelTransform,
): THREE.Vector3 {
  const tempGroup = new THREE.Group();
  tempGroup.position.set(...transform.position);
  tempGroup.rotation.set(...(transform.rotation as [number, number, number]));
  tempGroup.scale.setScalar(transform.scale);
  const clone = model.clone(true);
  tempGroup.add(clone);
  tempGroup.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(tempGroup);
  tempGroup.remove(clone);
  return new THREE.Vector3(
    box.min.x,
    (box.min.y + box.max.y) / 2,
    (box.min.z + box.max.z) / 2,
  );
}
