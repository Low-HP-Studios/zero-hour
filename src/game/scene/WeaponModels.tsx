import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { loadFbxAsset, preloadTextureAsset } from "../AssetLoader";
import {
  SIGHT_FBX_URL,
  SIGHT_MESH_NAMES,
  SIGHT_TEXTURE_BASE,
  SIGHT_TEXTURE_MAP,
  WEAPON_MODEL_URLS,
  type WeaponModelTransform,
} from "./scene-constants";

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

// ── Sight model loading ──

export type SightModelResult = {
  rifleSight: THREE.Group | null;
  sniperSight: THREE.Group | null;
  ready: boolean;
};

function extractSightMesh(
  fbxGroup: THREE.Group,
  nameSubstring: string,
): THREE.Mesh | null {
  const target = nameSubstring.toLowerCase().replace(/[^a-z0-9]/g, "");
  let exact: THREE.Mesh | null = null;
  let fallback: THREE.Mesh | null = null;
  fbxGroup.traverse((child) => {
    if (
      (child as THREE.Mesh).isMesh
    ) {
      const mesh = child as THREE.Mesh;
      const normalizedName = mesh.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!exact && normalizedName === target) {
        exact = mesh;
      } else if (!fallback && normalizedName.includes(target)) {
        fallback = mesh;
      }
    }
  });
  return exact ?? fallback;
}

async function applySightTextures(
  mesh: THREE.Mesh,
  textureDef: { base: string; metallic: string; normal?: string; roughness: string },
): Promise<void> {
  const [baseTex, metallicTex, normalTex, roughnessTex] = await Promise.all([
    preloadTextureAsset(SIGHT_TEXTURE_BASE + textureDef.base),
    preloadTextureAsset(SIGHT_TEXTURE_BASE + textureDef.metallic),
    textureDef.normal
      ? preloadTextureAsset(SIGHT_TEXTURE_BASE + textureDef.normal)
      : Promise.resolve(null),
    preloadTextureAsset(SIGHT_TEXTURE_BASE + textureDef.roughness),
  ]);

  const mat = new THREE.MeshStandardMaterial({
    name: `sight-${mesh.name}`,
    color: new THREE.Color(0xffffff),
    roughness: 0.5,
    metalness: 0.3,
  });

  if (baseTex) {
    baseTex.colorSpace = THREE.SRGBColorSpace;
    mat.map = baseTex;
  }
  if (metallicTex) {
    mat.metalnessMap = metallicTex;
  }
  if (normalTex) {
    mat.normalMap = normalTex;
  }
  if (roughnessTex) {
    mat.roughnessMap = roughnessTex;
  }

  mat.needsUpdate = true;
  mesh.material = mat;
}

export function useSightModels(enabled = true): SightModelResult {
  const [result, setResult] = useState<SightModelResult>({
    rifleSight: null,
    sniperSight: null,
    ready: false,
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let disposed = false;

    (async () => {
      try {
        const fbx = await loadFbxAsset(SIGHT_FBX_URL);
        if (disposed || !fbx) {
          if (!disposed) {
            setResult({ rifleSight: null, sniperSight: null, ready: true });
          }
          return;
        }

        // Log child names for debugging sight mesh identification
        console.log(
          "[Sights] FBX children:",
          fbx.children.map((c) => `${c.name} (${c.type})`),
        );

        const rifleMesh = extractSightMesh(fbx, SIGHT_MESH_NAMES.rifle);
        console.log("[Sights] rifle mesh:", rifleMesh?.name ?? "not found");

        // Apply PBR textures in parallel
        const textureWork: Promise<void>[] = [];
        if (rifleMesh) {
          textureWork.push(applySightTextures(rifleMesh, SIGHT_TEXTURE_MAP.rifle));
        }
        await Promise.all(textureWork);
        if (disposed) return;

        // Wrap each extracted mesh in a group for easy mounting.
        // Center the mesh at origin so mount transforms work predictably.
        const wrapInGroup = (mesh: THREE.Mesh | null, label: string): THREE.Group | null => {
          if (!mesh) return null;
          const group = new THREE.Group();
          group.name = `sight-${label}`;
          const clone = mesh.clone();
          const lensNodes: THREE.Object3D[] = [];
          clone.traverse((child) => {
            if (child !== clone && /lens/i.test(child.name)) {
              lensNodes.push(child);
            }
          });
          for (const lensNode of lensNodes) {
            lensNode.parent?.remove(lensNode);
          }
          clone.geometry = clone.geometry.clone();
          clone.castShadow = true;
          clone.receiveShadow = true;
          clone.frustumCulled = false;

          // Center the mesh at origin by subtracting its bounding box center
          clone.geometry.computeBoundingBox();
          const box = clone.geometry.boundingBox;
          if (box) {
            const center = new THREE.Vector3();
            box.getCenter(center);
            clone.geometry.translate(-center.x, -center.y, -center.z);
            console.log(`[Sights] ${label} centered from`, center.toArray(), 'box size:', new THREE.Vector3().subVectors(box.max, box.min).toArray());
          }
          // The source FBX arranges all sights in a catalog, so keep rotation/scale
          // but clear the showroom position before mounting the optic on a weapon.
          clone.position.set(0, 0, 0);

          group.add(clone);
          return group;
        };

        setResult({
          rifleSight: wrapInGroup(rifleMesh, "rifle-reddot"),
          sniperSight: null,
          ready: true,
        });
      } catch (error) {
        console.warn("[Sights] Sight model loading failed", error);
        if (!disposed) {
          setResult({ rifleSight: null, sniperSight: null, ready: true });
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [enabled]);

  return result;
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
  const size = new THREE.Vector3();
  box.getSize(size);

  const axisOrder = ["x", "y", "z"] as const;
  const dominantAxis = axisOrder.reduce((bestAxis, axis) =>
    size[axis] > size[bestAxis] ? axis : bestAxis
  , "x" as const);
  const perpendicularAxes = axisOrder.filter((axis) => axis !== dominantAxis);
  const axisMin = box.min[dominantAxis];
  const axisMax = box.max[dominantAxis];
  const axisLength = axisMax - axisMin;
  const sliceThickness = Math.max(axisLength * 0.04, 0.008);

  const tempPoint = new THREE.Vector3();
  const minSlice = {
    count: 0,
    sumA: 0,
    sumB: 0,
    maxRadiusSq: 0,
  };
  const maxSlice = {
    count: 0,
    sumA: 0,
    sumB: 0,
    maxRadiusSq: 0,
  };

  tempGroup.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) {
      return;
    }

    const mesh = child as THREE.Mesh;
    const positions = mesh.geometry.getAttribute("position");
    if (!positions || positions.itemSize < 3) {
      return;
    }

    for (let index = 0; index < positions.count; index += 1) {
      tempPoint.fromBufferAttribute(positions, index);
      tempPoint.applyMatrix4(mesh.matrixWorld);

      const axisValue = tempPoint[dominantAxis];
      const perpendicularA = tempPoint[perpendicularAxes[0]];
      const perpendicularB = tempPoint[perpendicularAxes[1]];
      const radiusSq = perpendicularA * perpendicularA + perpendicularB * perpendicularB;

      if (axisValue <= axisMin + sliceThickness) {
        minSlice.count += 1;
        minSlice.sumA += perpendicularA;
        minSlice.sumB += perpendicularB;
        minSlice.maxRadiusSq = Math.max(minSlice.maxRadiusSq, radiusSq);
      }

      if (axisValue >= axisMax - sliceThickness) {
        maxSlice.count += 1;
        maxSlice.sumA += perpendicularA;
        maxSlice.sumB += perpendicularB;
        maxSlice.maxRadiusSq = Math.max(maxSlice.maxRadiusSq, radiusSq);
      }
    }
  });

  const minRadius = minSlice.count > 0
    ? Math.sqrt(minSlice.maxRadiusSq)
    : Number.POSITIVE_INFINITY;
  const maxRadius = maxSlice.count > 0
    ? Math.sqrt(maxSlice.maxRadiusSq)
    : Number.POSITIVE_INFINITY;
  const useMinSlice = minRadius <= maxRadius;
  const chosenSlice = useMinSlice ? minSlice : maxSlice;
  const axisPadding = Math.min(axisLength * 0.015, 0.01);

  const muzzleOffset = new THREE.Vector3(
    (box.min.x + box.max.x) / 2,
    (box.min.y + box.max.y) / 2,
    (box.min.z + box.max.z) / 2,
  );
  muzzleOffset[dominantAxis] = useMinSlice ? axisMin - axisPadding : axisMax + axisPadding;
  if (chosenSlice.count > 0) {
    muzzleOffset[perpendicularAxes[0]] = chosenSlice.sumA / chosenSlice.count;
    muzzleOffset[perpendicularAxes[1]] = chosenSlice.sumB / chosenSlice.count;
  }

  tempGroup.remove(clone);
  return muzzleOffset;
}
