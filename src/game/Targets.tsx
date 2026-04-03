import {
  memo,
  type MutableRefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { loadFbxAnimation, loadModelAsset } from "./AssetLoader";
import {
  TARGET_CHARACTER_MODEL_URL,
  TARGET_DEATH_ANIMATION_URL,
  TARGET_IDLE_ANIMATION_URL,
} from "./boot-assets";
import type { TargetState } from "./types";
import {
  type CharacterModelOverride,
  applyCharacterTextures,
  normalizeBoneName,
  remapAnimationClip,
  removeRootMotion,
} from "./scene/CharacterModel";
import { PRACTICE_TARGET_HEIGHT } from "./scene/scene-constants";

type TargetsProps = {
  targets: TargetState[];
  shadows: boolean;
  reveal: number;
  loadCharacterAsset?: boolean;
  onReadyChange?: (ready: boolean) => void;
  characterOverride?: CharacterModelOverride;
  visualRegistryRef?: TargetVisualRegistryRef;
};

export type TargetRaycastHit = {
  id: string;
  zone: TargetHitZone;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
};

export type TargetHitZone = "head" | "body" | "leg";

export type TargetLandmarks = {
  head: THREE.Bone;
  neck: THREE.Bone;
  hips: THREE.Bone;
  leftUpperLeg: THREE.Bone;
  rightUpperLeg: THREE.Bone;
};

export type TargetVisualHandle = {
  targetId: string;
  root: THREE.Group;
  shootableMeshes: THREE.Mesh[];
  landmarks: TargetLandmarks | null;
};

export type TargetVisualRegistryRef = MutableRefObject<
  Map<string, TargetVisualHandle>
>;

const DAMAGE_PER_SHOT = 25;
const RESPAWN_DELAY_MS = 2000;
const T = PRACTICE_TARGET_HEIGHT;
const TARGET_HP_BAR_Y = 1.32 * T;
export const TARGET_DUMMY_GROUP_SCALE_MIN = 0.82;
export const TARGET_DUMMY_GROUP_SCALE_REVEAL = 0.18;
export function targetDummyGroupScale(reveal: number) {
  return TARGET_DUMMY_GROUP_SCALE_MIN + reveal * TARGET_DUMMY_GROUP_SCALE_REVEAL;
}
const TARGET_COLLISION_RADIUS = 0.35;

function resolveTargetFacingYaw(id: string) {
  const hash = id.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return ((hash % 12) / 12) * Math.PI * 2;
}

function getTrackNodeName(trackName: string) {
  const dotIdx = trackName.lastIndexOf(".");
  return dotIdx <= 0 ? trackName : trackName.slice(0, dotIdx);
}

function getTrackProperty(trackName: string) {
  const dotIdx = trackName.lastIndexOf(".");
  return dotIdx <= 0 ? "" : trackName.slice(dotIdx);
}

function resolveTargetLandmarkKey(
  normalizedBoneName: string,
): keyof TargetLandmarks | null {
  switch (normalizedBoneName) {
    case "head":
      return "head";
    case "neck":
      return "neck";
    case "hips":
    case "pelvis":
      return "hips";
    case "l_upper_leg":
    case "leftupleg":
    case "left_upper_leg":
    case "upleg_l":
    case "thigh_l":
    case "lthigh":
      return "leftUpperLeg";
    case "r_upper_leg":
    case "rightupleg":
    case "right_upper_leg":
    case "upleg_r":
    case "thigh_r":
    case "rthigh":
      return "rightUpperLeg";
    default:
      return null;
  }
}

function resolveTargetVisualHandle(
  targetId: string,
  root: THREE.Group,
  characterInstance: THREE.Group,
): TargetVisualHandle | null {
  const shootableMeshes: THREE.Mesh[] = [];
  const landmarks: Partial<TargetLandmarks> = {};

  root.updateWorldMatrix(true, true);
  characterInstance.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
        const skinnedMesh = mesh as THREE.SkinnedMesh;
        skinnedMesh.frustumCulled = false;
        // Use geometry AABB diagonal for the bounding sphere radius instead of
        // computeBoundingSphere(), which relies on bone transforms that may not
        // be in their final animated pose when this runs (before useFrame/mixer).
        const geo = skinnedMesh.geometry;
        if (!geo.boundingBox) geo.computeBoundingBox();
        if (geo.boundingBox) {
          if (!skinnedMesh.boundingSphere) skinnedMesh.boundingSphere = new THREE.Sphere();
          geo.boundingBox.getCenter(skinnedMesh.boundingSphere.center);
          const _bboxSize = new THREE.Vector3();
          geo.boundingBox.getSize(_bboxSize);
          skinnedMesh.boundingSphere.radius = _bboxSize.length();
        }
      }
      shootableMeshes.push(mesh);
    }

    if (!(child as THREE.Bone).isBone) {
      return;
    }

    const key = resolveTargetLandmarkKey(
      normalizeBoneName((child as THREE.Bone).name).toLowerCase(),
    );
    if (!key || landmarks[key]) {
      return;
    }
    landmarks[key] = child as THREE.Bone;
  });

  if (shootableMeshes.length === 0) {
    console.warn(`[Targets] resolveTargetVisualHandle: no meshes for target ${targetId}`);
    return null;
  }

  const hasAllLandmarks = !!(
    landmarks.head &&
    landmarks.neck &&
    landmarks.hips &&
    landmarks.leftUpperLeg &&
    landmarks.rightUpperLeg
  );

  return {
    targetId,
    root,
    shootableMeshes,
    landmarks: hasAllLandmarks
      ? {
          head: landmarks.head!,
          neck: landmarks.neck!,
          hips: landmarks.hips!,
          leftUpperLeg: landmarks.leftUpperLeg!,
          rightUpperLeg: landmarks.rightUpperLeg!,
        }
      : null,
  };
}

type TargetCharacterAsset = {
  model: THREE.Group | null;
  idleClip: THREE.AnimationClip | null;
  deathClip: THREE.AnimationClip | null;
  ready: boolean;
};

export function createDefaultTargets(): TargetState[] {
  const layout: Array<[number, number]> = [
    [-54, -22],
    [-36, -20],
    [-18, -24],
    [0, -22],
    [18, -24],
    [36, -20],
    [54, -22],
    [-48, -34],
    [-30, -36],
    [-12, -34],
    [6, -36],
    [24, -34],
    [42, -36],
    [-52, -48],
    [-34, -50],
    [-16, -52],
    [2, -50],
    [20, -52],
    [38, -50],
    [56, -48],
    [-44, -64],
    [-22, -68],
    [0, -66],
    [22, -68],
    [44, -64],
  ];

  return layout.map(([x, z], index) => {
    const id = `t${index + 1}`;
    return {
      id,
      facingYaw: resolveTargetFacingYaw(id),
      position: [x, 0, z],
      radius: TARGET_COLLISION_RADIUS,
      hitUntil: 0,
      disabled: false,
      hp: 100,
      maxHp: 100,
    };
  });
}

export function resetTargets(targets: TargetState[]): TargetState[] {
  return targets.map((target) => ({
    ...target,
    hitUntil: 0,
    disabled: false,
    hp: target.maxHp,
  }));
}

export { DAMAGE_PER_SHOT, RESPAWN_DELAY_MS, TARGET_COLLISION_RADIUS };

const _tempVisualPointLocal = new THREE.Vector3();
const _tempVisualHeadLocal = new THREE.Vector3();
const _tempVisualNeckLocal = new THREE.Vector3();
const _tempVisualHipsLocal = new THREE.Vector3();
const _tempVisualLeftUpperLegLocal = new THREE.Vector3();
const _tempVisualRightUpperLegLocal = new THREE.Vector3();
const _tempVisualHitNormal = new THREE.Vector3();
const _tempVisualHitNormalMatrix = new THREE.Matrix3();


function classifyTargetVisualZone(
  handle: TargetVisualHandle,
  pointWorld: THREE.Vector3,
): TargetHitZone {
  handle.root.updateWorldMatrix(true, true);
  const pointLocal = handle.root.worldToLocal(_tempVisualPointLocal.copy(pointWorld));

  if (handle.landmarks) {
    const headLocal = handle.root.worldToLocal(
      handle.landmarks.head.getWorldPosition(_tempVisualHeadLocal),
    );
    const neckLocal = handle.root.worldToLocal(
      handle.landmarks.neck.getWorldPosition(_tempVisualNeckLocal),
    );
    const hipsLocal = handle.root.worldToLocal(
      handle.landmarks.hips.getWorldPosition(_tempVisualHipsLocal),
    );
    const leftUpperLegLocal = handle.root.worldToLocal(
      handle.landmarks.leftUpperLeg.getWorldPosition(_tempVisualLeftUpperLegLocal),
    );
    const rightUpperLegLocal = handle.root.worldToLocal(
      handle.landmarks.rightUpperLeg.getWorldPosition(_tempVisualRightUpperLegLocal),
    );
    const headThresholdY = (neckLocal.y + headLocal.y) * 0.5;
    const upperLegAverageY = (leftUpperLegLocal.y + rightUpperLegLocal.y) * 0.5;
    const legThresholdY = (hipsLocal.y + upperLegAverageY) * 0.5;
    if (pointLocal.y >= headThresholdY) return "head";
    if (pointLocal.y <= legThresholdY) return "leg";
    return "body";
  }

  // Fallback: classify by Y-height fraction when landmark bones aren't resolved.
  // pointLocal.y is in the group's local space where feet ≈ 0 and head ≈ T.
  if (pointLocal.y > T * 0.78) return "head";
  if (pointLocal.y < T * 0.40) return "leg";
  return "body";
}

export function raycastVisibleTargets(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  targets: TargetState[],
  visualRegistry: Map<string, TargetVisualHandle>,
  raycaster: THREE.Raycaster,
  maxDistance = Number.POSITIVE_INFINITY,
): TargetRaycastHit | null {
  if (maxDistance <= 0) {
    return null;
  }

  const shootableMeshes: THREE.Object3D[] = [];
  const handleByMesh = new Map<THREE.Object3D, TargetVisualHandle>();

  for (const target of targets) {
    if (target.disabled) {
      continue;
    }

    const handle = visualRegistry.get(target.id);
    if (!handle || !handle.root.visible) {
      continue;
    }

    handle.root.updateWorldMatrix(true, true);
    for (const mesh of handle.shootableMeshes) {
      if (!mesh.visible) {
        continue;
      }
      shootableMeshes.push(mesh);
      handleByMesh.set(mesh, handle);
    }
  }

  let visualHit: TargetRaycastHit | null = null;
  if (shootableMeshes.length > 0) {
    raycaster.near = 0;
    raycaster.far = maxDistance;
    raycaster.set(origin, direction);
    const intersections = raycaster.intersectObjects(shootableMeshes, false);

    for (const intersection of intersections) {
      if (intersection.distance <= 0 || intersection.distance > maxDistance) {
        continue;
      }

      const handle = handleByMesh.get(intersection.object);
      if (!handle) {
        continue;
      }

      if (intersection.face) {
        _tempVisualHitNormal.copy(intersection.face.normal);
        _tempVisualHitNormalMatrix.getNormalMatrix(intersection.object.matrixWorld);
        _tempVisualHitNormal.applyMatrix3(_tempVisualHitNormalMatrix).normalize();
      } else {
        _tempVisualHitNormal.set(0, 1, 0);
      }

      visualHit = {
        id: handle.targetId,
        zone: classifyTargetVisualZone(handle, intersection.point),
        point: intersection.point.clone(),
        normal: _tempVisualHitNormal.clone(),
        distance: intersection.distance,
      };
      break;
    }
  }

  return visualHit;
}


function prepareTargetCharacterModel(model: THREE.Group): void {
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const scale = size.y > 0 ? PRACTICE_TARGET_HEIGHT / size.y : 1;
  model.scale.setScalar(scale);

  const scaledBox = new THREE.Box3().setFromObject(model);
  model.position.y = -scaledBox.min.y;
  model.rotation.y = Math.PI;

  model.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

function sanitizeTargetAnimationClip(
  clip: THREE.AnimationClip | null,
  modelBoneNames: Set<string>,
  options?: {
    preserveHipsPosition?: boolean;
  },
): THREE.AnimationClip | null {
  if (!clip) {
    return null;
  }

  const remappedClip = remapAnimationClip(clip, modelBoneNames).clone();
  removeRootMotion(remappedClip);
  remappedClip.tracks = remappedClip.tracks.filter((track) => {
    const nodeName = getTrackNodeName(track.name);
    if (!modelBoneNames.has(nodeName)) {
      return false;
    }

    const property = getTrackProperty(track.name);
    if (property !== ".position") {
      return true;
    }

    if (!options?.preserveHipsPosition) {
      return false;
    }

    return normalizeBoneName(nodeName).toLowerCase().includes("hips");
  });
  return remappedClip;
}

function useTargetCharacterAsset(
  enabled: boolean,
  characterOverride?: CharacterModelOverride,
): TargetCharacterAsset {
  const [asset, setAsset] = useState<TargetCharacterAsset>({
    model: null,
    idleClip: null,
    deathClip: null,
    ready: false,
  });

  const modelUrl = characterOverride?.modelUrl ?? TARGET_CHARACTER_MODEL_URL;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let disposed = false;

    (async () => {
      try {
        const [characterModel, idleClip, deathClip] = await Promise.all([
          loadModelAsset(modelUrl),
          loadFbxAnimation(TARGET_IDLE_ANIMATION_URL, "idle"),
          loadFbxAnimation(TARGET_DEATH_ANIMATION_URL, "death"),
        ]);
        if (disposed) return;
        if (!characterModel) {
          console.warn("[Targets] Character model is null for URL:", modelUrl);
          setAsset({ model: null, idleClip: null, deathClip: null, ready: true });
          return;
        }

        const preparedModel = SkeletonUtils.clone(characterModel) as THREE.Group;
        prepareTargetCharacterModel(preparedModel);

        await applyCharacterTextures(
          preparedModel,
          characterOverride?.textureBasePath,
          characterOverride?.textures,
        );

        const modelBoneNames = new Set<string>();
        preparedModel.traverse((child) => {
          if (
            (child as THREE.Bone).isBone ||
            (child as THREE.SkinnedMesh).isSkinnedMesh
          ) {
            modelBoneNames.add(child.name);
          }
        });

        const remappedIdle = sanitizeTargetAnimationClip(idleClip, modelBoneNames);
        const remappedDeath = sanitizeTargetAnimationClip(
          deathClip,
          modelBoneNames,
          { preserveHipsPosition: true },
        );

        if (!disposed) {
          setAsset({
            model: preparedModel,
            idleClip: remappedIdle,
            deathClip: remappedDeath,
            ready: true,
          });
        }
      } catch (error) {
        console.warn("[Targets] Target asset warm-up failed", error);
        if (!disposed) {
          setAsset({ model: null, idleClip: null, deathClip: null, ready: true });
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [enabled, modelUrl, characterOverride?.textureBasePath, characterOverride?.textures]);

  return asset;
}

const _hpBarParentQuat = new THREE.Quaternion();

const HPBar = memo(
  function HPBar({ hp, maxHp }: { hp: number; maxHp: number }) {
    const camera = useThree((state) => state.camera);
    const groupRef = useRef<THREE.Group>(null);

    useFrame(() => {
      const group = groupRef.current;
      if (!group || !group.parent) return;
      // Compensate for parent rotation so the bar always truly faces the camera
      // localQuat = inverse(parentWorldQuat) * cameraQuat
      group.parent.getWorldQuaternion(_hpBarParentQuat);
      _hpBarParentQuat.invert();
      group.quaternion.copy(camera.quaternion).premultiply(_hpBarParentQuat);
    });

    const ratio = Math.max(0, hp / maxHp);
    const barWidth = 1.0;
    const barHeight = 0.12;
    const fillWidth = barWidth * ratio;
    const fillColor = ratio > 0.5
      ? "#4ade80"
      : ratio > 0.25
      ? "#facc15"
      : "#ef4444";

    return (
      <group ref={groupRef} position={[0, TARGET_HP_BAR_Y, 0]}>
        <mesh position={[0, 0, -0.005]}>
          <planeGeometry args={[barWidth + 0.06, barHeight + 0.06]} />
          <meshBasicMaterial color="#000000" opacity={0.6} transparent />
        </mesh>
        <mesh position={[0, 0, -0.003]}>
          <planeGeometry args={[barWidth, barHeight]} />
          <meshBasicMaterial color="#1a1a1a" />
        </mesh>
        {fillWidth > 0.001
          ? (
            <mesh position={[(fillWidth - barWidth) / 2, 0, 0]}>
              <planeGeometry args={[fillWidth, barHeight]} />
              <meshBasicMaterial color={fillColor} />
            </mesh>
          )
          : null}
      </group>
    );
  },
);

const TargetDummy = memo(function TargetDummy({
  target,
  shadows,
  reveal,
  characterAsset,
  visualRegistryRef,
}: {
  target: TargetState;
  shadows: boolean;
  reveal: number;
  characterAsset: TargetCharacterAsset;
  visualRegistryRef?: TargetVisualRegistryRef;
}) {
  const [x, baseY, z] = target.position;
  const characterMixerRef = useRef<THREE.AnimationMixer | null>(null);
  const idleActionRef = useRef<THREE.AnimationAction | null>(null);
  const deathActionRef = useRef<THREE.AnimationAction | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const previousDisabledRef = useRef(target.disabled);
  const [showDeathPose, setShowDeathPose] = useState(false);
  const characterInstance = useMemo(
    () => (characterAsset.model
      ? (SkeletonUtils.clone(characterAsset.model) as THREE.Group)
      : null),
    [characterAsset.model],
  );

  useEffect(() => {
    if (!characterInstance) return;

    if (characterAsset.idleClip) {
      const mixer = new THREE.AnimationMixer(characterInstance);
      const idleAction = mixer.clipAction(characterAsset.idleClip);
      idleAction.setLoop(THREE.LoopRepeat, Infinity);
      idleAction.play();
      idleActionRef.current = idleAction;

      if (characterAsset.deathClip) {
        const deathAction = mixer.clipAction(characterAsset.deathClip);
        deathAction.setLoop(THREE.LoopOnce, 1);
        deathAction.clampWhenFinished = true;
        deathAction.enabled = true;
        deathActionRef.current = deathAction;
      }

      characterMixerRef.current = mixer;

      return () => {
        mixer.stopAllAction();
        characterMixerRef.current = null;
        idleActionRef.current = null;
        deathActionRef.current = null;
      };
    }

    return undefined;
  }, [characterAsset.deathClip, characterAsset.idleClip, characterInstance]);

  useEffect(() => {
    const wasDisabled = previousDisabledRef.current;
    previousDisabledRef.current = target.disabled;

    if (target.disabled) {
      if (!wasDisabled) {
        const deathAction = deathActionRef.current;
        if (deathAction) {
          idleActionRef.current?.fadeOut(0.08);
          deathAction.reset();
          deathAction.paused = false;
          deathAction.timeScale = 1;
          deathAction.play();
          setShowDeathPose(true);
        }
      }
      return;
    }

    if (wasDisabled) {
      const deathAction = deathActionRef.current;
      if (deathAction) {
        deathAction.stop();
      }
      const idleAction = idleActionRef.current;
      if (idleAction) {
        idleAction.reset();
        idleAction.enabled = true;
        idleAction.setEffectiveTimeScale(1);
        idleAction.setEffectiveWeight(1);
        idleAction.fadeIn(0.08);
        idleAction.play();
      }
      setShowDeathPose(false);
    }
  }, [target.disabled]);

  useEffect(() => {
    if (!characterInstance) return;
    characterInstance.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of materials) {
        const litMaterial = material as THREE.MeshStandardMaterial;
        litMaterial.transparent = reveal < 0.999;
        litMaterial.opacity = reveal;
        if ("emissive" in litMaterial) {
          litMaterial.emissive.set("#000000");
          litMaterial.emissiveIntensity = 0;
        }
      }
    });
  }, [characterInstance, reveal, shadows]);

  useEffect(() => {
    const registry = visualRegistryRef?.current;
    const root = groupRef.current;
    if (!registry) {
      return;
    }

    if (!root || !characterInstance) {
      registry.delete(target.id);
      return;
    }

    const handle = resolveTargetVisualHandle(target.id, root, characterInstance);
    if (handle) {
      registry.set(target.id, handle);
    } else {
      registry.delete(target.id);
    }

    return () => {
      const current = registry.get(target.id);
      if (current?.root === root) {
        registry.delete(target.id);
      }
    };
  }, [characterInstance, target.id, visualRegistryRef]);

  useFrame((_, delta) => {
    if (reveal <= 0.01 || (target.disabled && !showDeathPose)) return;
    characterMixerRef.current?.update(delta);
  });

  const scale = targetDummyGroupScale(reveal);
  const visible = reveal > 0.01 && (!target.disabled || showDeathPose);

  return (
    <group
      ref={groupRef}
      position={[x, baseY, z]}
      rotation={[0, target.facingYaw, 0]}
      scale={scale}
      visible={visible}
    >
      {characterInstance
        ? <primitive object={characterInstance} renderOrder={0} />
        : (
          <mesh
            position={[0, 0.95 * T, 0]}
            castShadow={shadows}
            receiveShadow={shadows}
            renderOrder={0}
          >
            <sphereGeometry args={[0.085 * T, 12, 12]} />
            <meshStandardMaterial
              color="#e8d5b7"
              transparent={reveal < 0.999}
              opacity={reveal}
            />
          </mesh>
        )}
      {!target.disabled && reveal >= 0.55 && target.hp < target.maxHp
        ? <HPBar hp={target.hp} maxHp={target.maxHp} />
        : null}
    </group>
  );
});

export function Targets({
  targets,
  shadows,
  reveal,
  loadCharacterAsset = true,
  onReadyChange,
  characterOverride,
  visualRegistryRef,
}: TargetsProps) {
  const characterAsset = useTargetCharacterAsset(loadCharacterAsset, characterOverride);
  const assetReady = characterAsset.ready;

  useEffect(() => {
    onReadyChange?.(assetReady);
  }, [assetReady, onReadyChange]);

  return (
    <group>
      {targets.map((target) => (
        <TargetDummy
          key={target.id}
          target={target}
          shadows={shadows}
          reveal={reveal}
          characterAsset={characterAsset}
          visualRegistryRef={visualRegistryRef}
        />
      ))}
    </group>
  );
}
