import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { loadFbxAnimation, loadFbxAsset } from "./AssetLoader";
import type { TargetState } from "./types";

type TargetsProps = {
  targets: TargetState[];
  shadows: boolean;
  reveal: number;
};

export type TargetRaycastHit = {
  id: string;
  zone: TargetHitZone;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
};

export type TargetHitZone = "head" | "body" | "leg";

const DAMAGE_PER_SHOT = 25;
const RESPAWN_DELAY_MS = 2000;
const TARGET_CHARACTER_MODEL_URL = "/assets/models/character/Trooper/tactical guy.fbx";
const TARGET_CHARACTER_IDLE_ANIM_URL = "/assets/animations/walking/Idle.fbx";
const TARGET_CHARACTER_HEIGHT = 1.65;

type TargetCharacterAsset = {
  model: THREE.Group | null;
  idleClip: THREE.AnimationClip | null;
};

export function createDefaultTargets(): TargetState[] {
  const layout: Array<[number, number]> = [
    [-54, -22], [-36, -20], [-18, -24], [0, -22], [18, -24], [36, -20], [54, -22],
    [-48, -34], [-30, -36], [-12, -34], [6, -36], [24, -34], [42, -36],
    [-52, -48], [-34, -50], [-16, -52], [2, -50], [20, -52], [38, -50], [56, -48],
    [-44, -64], [-22, -68], [0, -66], [22, -68], [44, -64],
  ];

  return layout.map(([x, z], index) => ({
    id: `t${index + 1}`,
    position: [x, 0, z],
    radius: 0.6,
    hitUntil: 0,
    disabled: false,
    hp: 100,
    maxHp: 100,
  }));
}

export function resetTargets(targets: TargetState[]): TargetState[] {
  return targets.map((target) => ({
    ...target,
    hitUntil: 0,
    disabled: false,
    hp: target.maxHp,
  }));
}

export { DAMAGE_PER_SHOT, RESPAWN_DELAY_MS };

const _tempSpherePoint = new THREE.Vector3();
const _tempSphereNormal = new THREE.Vector3();
const _tempAabbNearNormal = new THREE.Vector3();
const _tempAabbFarNormal = new THREE.Vector3();
const _tempAabbPoint = new THREE.Vector3();

export function raycastTargets(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  targets: TargetState[],
  maxDistance = Number.POSITIVE_INFINITY,
): TargetRaycastHit | null {
  let closestHit: TargetRaycastHit | null = null;

  for (const target of targets) {
    if (target.disabled) {
      continue;
    }

    const [x, baseY, z] = target.position;

    const partHits: Array<TargetRaycastHit | null> = [
      raycastSpherePart(target.id, "head", origin, direction, x, baseY + 1.6, z, 0.22),
      raycastAabbPart(target.id, "body", origin, direction, x, baseY + 1.05, z, 0.25, 0.35, 0.15),
      raycastAabbPart(target.id, "leg", origin, direction, x - 0.2, baseY + 0.35, z, 0.08, 0.35, 0.08),
      raycastAabbPart(target.id, "leg", origin, direction, x + 0.2, baseY + 0.35, z, 0.08, 0.35, 0.08),
    ];

    let targetClosestHit: TargetRaycastHit | null = null;
    for (const partHit of partHits) {
      if (!partHit) {
        continue;
      }
      if (partHit.distance > maxDistance) {
        continue;
      }
      if (!targetClosestHit || partHit.distance < targetClosestHit.distance) {
        targetClosestHit = partHit;
      }
    }

    if (targetClosestHit && (!closestHit || targetClosestHit.distance < closestHit.distance)) {
      closestHit = targetClosestHit;
    }
  }

  return closestHit;
}

function raycastSpherePart(
  id: string,
  zone: TargetHitZone,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
): TargetRaycastHit | null {
  const ox = origin.x - cx;
  const oy = origin.y - cy;
  const oz = origin.z - cz;

  const b = ox * direction.x + oy * direction.y + oz * direction.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) {
    return null;
  }

  const sqrtDisc = Math.sqrt(discriminant);
  const nearT = -b - sqrtDisc;
  const farT = -b + sqrtDisc;
  const distance = nearT > 0 ? nearT : farT > 0 ? farT : -1;
  if (distance <= 0) {
    return null;
  }

  const point = _tempSpherePoint.set(
    origin.x + direction.x * distance,
    origin.y + direction.y * distance,
    origin.z + direction.z * distance,
  );
  const normal = _tempSphereNormal.set(point.x - cx, point.y - cy, point.z - cz).normalize();

  return { id, zone, point: point.clone(), normal: normal.clone(), distance };
}

function raycastAabbPart(
  id: string,
  zone: TargetHitZone,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number,
): TargetRaycastHit | null {
  let tMin = -Infinity;
  let tMax = Infinity;
  _tempAabbNearNormal.set(0, 0, 0);
  _tempAabbFarNormal.set(0, 0, 0);

  const hitAxis = (
    originCoord: number,
    dirCoord: number,
    min: number,
    max: number,
    minNormal: [number, number, number],
    maxNormal: [number, number, number],
  ): boolean => {
    if (Math.abs(dirCoord) < 1e-8) {
      return originCoord >= min && originCoord <= max;
    }

    let t1 = (min - originCoord) / dirCoord;
    let t2 = (max - originCoord) / dirCoord;
    let n1 = minNormal;
    let n2 = maxNormal;

    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      [n1, n2] = [n2, n1];
    }

    if (t1 > tMin) {
      tMin = t1;
      _tempAabbNearNormal.set(n1[0], n1[1], n1[2]);
    }
    if (t2 < tMax) {
      tMax = t2;
      _tempAabbFarNormal.set(n2[0], n2[1], n2[2]);
    }

    return tMin <= tMax;
  };

  if (
    !hitAxis(origin.x, direction.x, cx - hx, cx + hx, [-1, 0, 0], [1, 0, 0]) ||
    !hitAxis(origin.y, direction.y, cy - hy, cy + hy, [0, -1, 0], [0, 1, 0]) ||
    !hitAxis(origin.z, direction.z, cz - hz, cz + hz, [0, 0, -1], [0, 0, 1])
  ) {
    return null;
  }

  const distance = tMin > 0 ? tMin : tMax > 0 ? tMax : -1;
  if (distance <= 0) {
    return null;
  }

  const point = _tempAabbPoint.set(
    origin.x + direction.x * distance,
    origin.y + direction.y * distance,
    origin.z + direction.z * distance,
  );
  const normal = tMin > 0 ? _tempAabbNearNormal : _tempAabbFarNormal;

  return { id, zone, point: point.clone(), normal: normal.clone(), distance };
}

function normalizeBoneName(name: string): string {
  return name
    .replace(/^mixamorig:/, "")
    .replace(/^characters3d\.?com___/, "")
    .replace(/^mixamorig_/, "");
}

function splitTrackName(trackName: string): { nodeName: string; property: string } {
  const dotIdx = trackName.lastIndexOf(".");
  if (dotIdx <= 0) {
    return { nodeName: trackName, property: "" };
  }
  return {
    nodeName: trackName.substring(0, dotIdx),
    property: trackName.substring(dotIdx),
  };
}

function remapAnimationClip(
  clip: THREE.AnimationClip,
  modelBoneNames: Set<string>,
): THREE.AnimationClip {
  const firstTrack = clip.tracks[0];
  if (!firstTrack) return clip;

  const firstBone = splitTrackName(firstTrack.name).nodeName;
  if (modelBoneNames.has(firstBone)) return clip;

  const normalizedModelMap = new Map<string, string>();
  for (const bone of modelBoneNames) {
    normalizedModelMap.set(normalizeBoneName(bone).toLowerCase(), bone);
  }

  const remapped = clip.clone();
  for (const track of remapped.tracks) {
    const { nodeName, property } = splitTrackName(track.name);
    const normalized = normalizeBoneName(nodeName).toLowerCase();
    const mapped = modelBoneNames.has(nodeName)
      ? nodeName
      : normalizedModelMap.get(normalized);
    if (mapped && property) {
      track.name = mapped + property;
    }
  }

  return remapped;
}

function removeRootMotion(clip: THREE.AnimationClip): void {
  for (const track of clip.tracks) {
    const { nodeName, property } = splitTrackName(track.name);
    if (property !== ".position") continue;
    if (!normalizeBoneName(nodeName).toLowerCase().includes("hips")) continue;

    const values = track.values;
    if (values.length < 3) continue;
    const baseX = values[0];
    const baseZ = values[2];
    for (let i = 0; i < values.length; i += 3) {
      values[i] = baseX;
      values[i + 2] = baseZ;
    }
  }
}

function prepareTargetCharacterModel(model: THREE.Group): void {
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const scale = size.y > 0 ? TARGET_CHARACTER_HEIGHT / size.y : 1;
  model.scale.setScalar(scale);

  const scaledBox = new THREE.Box3().setFromObject(model);
  model.position.y = -scaledBox.min.y;
  model.rotation.y = Math.PI;

  model.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Convert FBX default MeshPhongMaterial to MeshStandardMaterial for PBR lighting
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const newMats = mats.map((mat) => {
      const phong = mat as THREE.MeshPhongMaterial;
      const stdMat = new THREE.MeshStandardMaterial({
        name: phong.name,
        color: phong.color ?? new THREE.Color(0xaaaaaa),
        map: phong.map ?? null,
        normalMap: phong.normalMap ?? null,
        roughness: 0.75,
        metalness: 0.05,
      });
      return stdMat;
    });
    mesh.material = newMats.length === 1 ? newMats[0] : newMats;
  });
}

function useTargetCharacterAsset(): TargetCharacterAsset {
  const [asset, setAsset] = useState<TargetCharacterAsset>({
    model: null,
    idleClip: null,
  });

  useEffect(() => {
    let disposed = false;

    (async () => {
      const [modelSource, idleSource] = await Promise.all([
        loadFbxAsset(TARGET_CHARACTER_MODEL_URL),
        loadFbxAnimation(TARGET_CHARACTER_IDLE_ANIM_URL, "idle"),
      ]);
      if (disposed || !modelSource || !idleSource) return;

      const preparedModel = SkeletonUtils.clone(modelSource) as THREE.Group;
      prepareTargetCharacterModel(preparedModel);

      const modelBoneNames = new Set<string>();
      preparedModel.traverse((child) => {
        if ((child as THREE.Bone).isBone || (child as THREE.SkinnedMesh).isSkinnedMesh) {
          modelBoneNames.add(child.name);
        }
      });

      const remappedIdle = remapAnimationClip(idleSource, modelBoneNames).clone();
      removeRootMotion(remappedIdle);
      remappedIdle.tracks = remappedIdle.tracks.filter((track) => {
        const boneName = splitTrackName(track.name).nodeName;
        return modelBoneNames.has(boneName);
      });

      setAsset({
        model: preparedModel,
        idleClip: remappedIdle,
      });
    })();

    return () => {
      disposed = true;
    };
  }, []);

  return asset;
}

const HPBar = memo(function HPBar({ hp, maxHp }: { hp: number; maxHp: number }) {
  const camera = useThree((state) => state.camera);
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.quaternion.copy(camera.quaternion);
    }
  });

  const ratio = Math.max(0, hp / maxHp);
  const barWidth = 1.0;
  const barHeight = 0.12;
  const fillWidth = barWidth * ratio;
  const fillColor = ratio > 0.5 ? "#4ade80" : ratio > 0.25 ? "#facc15" : "#ef4444";

  return (
    <group ref={groupRef} position={[0, 2.4, 0]}>
      <mesh position={[0, 0, -0.005]}>
        <planeGeometry args={[barWidth + 0.06, barHeight + 0.06]} />
        <meshBasicMaterial color="#000000" opacity={0.6} transparent />
      </mesh>
      <mesh position={[0, 0, -0.003]}>
        <planeGeometry args={[barWidth, barHeight]} />
        <meshBasicMaterial color="#1a1a1a" />
      </mesh>
      {fillWidth > 0.001 ? (
        <mesh position={[(fillWidth - barWidth) / 2, 0, 0]}>
          <planeGeometry args={[fillWidth, barHeight]} />
          <meshBasicMaterial color={fillColor} />
        </mesh>
      ) : null}
    </group>
  );
});

const TargetDummy = memo(function TargetDummy({
  target,
  shadows,
  reveal,
  characterAsset,
}: {
  target: TargetState;
  shadows: boolean;
  reveal: number;
  characterAsset: TargetCharacterAsset;
}) {
  const [x, baseY, z] = target.position;
  const now = performance.now();
  const isHit = target.hitUntil > now;
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const characterInstance = useMemo(
    () => (characterAsset.model ? (SkeletonUtils.clone(characterAsset.model) as THREE.Group) : null),
    [characterAsset.model],
  );
  const facingYaw = useMemo(() => {
    const hash = target.id.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    return ((hash % 12) / 12) * Math.PI * 2;
  }, [target.id]);

  useEffect(() => {
    if (!characterInstance || !characterAsset.idleClip) {
      return;
    }

    const mixer = new THREE.AnimationMixer(characterInstance);
    const action = mixer.clipAction(characterAsset.idleClip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
    mixerRef.current = mixer;

    return () => {
      mixer.stopAllAction();
      mixerRef.current = null;
    };
  }, [characterAsset.idleClip, characterInstance]);

  useEffect(() => {
    if (!characterInstance) return;
    characterInstance.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const litMaterial = material as THREE.MeshStandardMaterial;
        litMaterial.transparent = reveal < 0.999;
        litMaterial.opacity = reveal;
        if ("emissive" in litMaterial) {
          litMaterial.emissive.set(isHit ? "#5a1111" : "#000000");
          litMaterial.emissiveIntensity = isHit ? 0.85 : 0;
        }
      }
    });
  }, [characterInstance, isHit, reveal, shadows]);

  useFrame((_, delta) => {
    mixerRef.current?.update(delta);
  });

  if (target.disabled || reveal <= 0.01) {
    return null;
  }

  const scale = 0.82 + reveal * 0.18;

  return (
    <group position={[x, baseY, z]} rotation={[0, facingYaw, 0]} scale={scale}>
      {characterInstance ? (
        <primitive object={characterInstance} />
      ) : (
        <mesh position={[0, 1.6, 0]} castShadow={shadows} receiveShadow={shadows}>
          <sphereGeometry args={[0.22, 12, 12]} />
          <meshStandardMaterial
            color={isHit ? "#ff5555" : "#e8d5b7"}
            transparent={reveal < 0.999}
            opacity={reveal}
          />
        </mesh>
      )}
      {reveal >= 0.55 ? <HPBar hp={target.hp} maxHp={target.maxHp} /> : null}
    </group>
  );
});

export function Targets({ targets, shadows, reveal }: TargetsProps) {
  const characterAsset = useTargetCharacterAsset();

  return (
    <group>
      {targets.map((target) => (
        <TargetDummy
          key={target.id}
          target={target}
          shadows={shadows}
          reveal={reveal}
          characterAsset={characterAsset}
        />
      ))}
    </group>
  );
}
