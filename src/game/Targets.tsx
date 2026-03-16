import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { loadFbxAnimation, loadGlbWithAnimations } from "./AssetLoader";
import {
  TARGET_CHARACTER_MODEL_URL,
  TARGET_IDLE_ANIMATION_URL,
} from "./boot-assets";
import type {
  EnemyOutlineColor,
  EnemyOutlineSettings,
  TargetState,
} from "./types";
import { remapAnimationClip, removeRootMotion } from "./scene/CharacterModel";
import { CHARACTER_TARGET_HEIGHT } from "./scene/scene-constants";

type TargetsProps = {
  targets: TargetState[];
  shadows: boolean;
  reveal: number;
  outline: EnemyOutlineSettings;
  loadCharacterAsset?: boolean;
  onReadyChange?: (ready: boolean) => void;
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
const TARGET_VISUAL_SCALE = 0.9;
const TARGET_CHARACTER_HEIGHT = CHARACTER_TARGET_HEIGHT * TARGET_VISUAL_SCALE;
const TARGET_HP_BAR_Y = 2.4 * TARGET_VISUAL_SCALE;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const ENEMY_OUTLINE_COLOR_HEX: Record<EnemyOutlineColor, string> = {
  red: "#ff4d4d",
  yellow: "#facc15",
  cyan: "#38d9ff",
  magenta: "#ff4dc4",
};

type TargetSphereHitbox = {
  zone: TargetHitZone;
  center: [number, number, number];
  radius: number;
};

type TargetBoxHitbox = {
  zone: TargetHitZone;
  center: [number, number, number];
  halfSize: [number, number, number];
};

type TargetHitboxPart =
  | { kind: "sphere"; hitbox: TargetSphereHitbox }
  | { kind: "box"; hitbox: TargetBoxHitbox };

const TARGET_COLLISION_RADIUS = 0.35;

const TARGET_HITBOX_PARTS: TargetHitboxPart[] = [
  // Skull — raised and sized so it doesn't extend into the chest
  {
    kind: "sphere",
    hitbox: {
      zone: "head",
      center: [0, 1.66 * TARGET_VISUAL_SCALE, 0.01 * TARGET_VISUAL_SCALE],
      radius: 0.26 * TARGET_VISUAL_SCALE,
    },
  },
  // Face / jaw area
  {
    kind: "box",
    hitbox: {
      zone: "head",
      center: [0, 1.46 * TARGET_VISUAL_SCALE, 0.02 * TARGET_VISUAL_SCALE],
      halfSize: [
        0.16 * TARGET_VISUAL_SCALE,
        0.1 * TARGET_VISUAL_SCALE,
        0.14 * TARGET_VISUAL_SCALE,
      ],
    },
  },
  // Neck
  {
    kind: "box",
    hitbox: {
      zone: "head",
      center: [0, 1.34 * TARGET_VISUAL_SCALE, 0],
      halfSize: [
        0.1 * TARGET_VISUAL_SCALE,
        0.06 * TARGET_VISUAL_SCALE,
        0.1 * TARGET_VISUAL_SCALE,
      ],
    },
  },
  // Upper torso
  {
    kind: "box",
    hitbox: {
      zone: "body",
      center: [0, 1.15 * TARGET_VISUAL_SCALE, 0],
      halfSize: [
        0.33 * TARGET_VISUAL_SCALE,
        0.28 * TARGET_VISUAL_SCALE,
        0.2 * TARGET_VISUAL_SCALE,
      ],
    },
  },
  {
    kind: "box",
    hitbox: {
      zone: "body",
      center: [0, 0.78 * TARGET_VISUAL_SCALE, 0],
      halfSize: [
        0.3 * TARGET_VISUAL_SCALE,
        0.24 * TARGET_VISUAL_SCALE,
        0.2 * TARGET_VISUAL_SCALE,
      ],
    },
  },
  {
    kind: "box",
    hitbox: {
      zone: "body",
      center: [-0.39 * TARGET_VISUAL_SCALE, 1.04 * TARGET_VISUAL_SCALE, 0],
      halfSize: [
        0.12 * TARGET_VISUAL_SCALE,
        0.2 * TARGET_VISUAL_SCALE,
        0.13 * TARGET_VISUAL_SCALE,
      ],
    },
  },
  {
    kind: "box",
    hitbox: {
      zone: "body",
      center: [0.39 * TARGET_VISUAL_SCALE, 1.04 * TARGET_VISUAL_SCALE, 0],
      halfSize: [
        0.12 * TARGET_VISUAL_SCALE,
        0.2 * TARGET_VISUAL_SCALE,
        0.13 * TARGET_VISUAL_SCALE,
      ],
    },
  },
  {
    kind: "box",
    hitbox: {
      zone: "body",
      center: [-0.47 * TARGET_VISUAL_SCALE, 0.73 * TARGET_VISUAL_SCALE, 0],
      halfSize: [
        0.11 * TARGET_VISUAL_SCALE,
        0.2 * TARGET_VISUAL_SCALE,
        0.12 * TARGET_VISUAL_SCALE,
      ],
    },
  },
  {
    kind: "box",
    hitbox: {
      zone: "body",
      center: [0.47 * TARGET_VISUAL_SCALE, 0.73 * TARGET_VISUAL_SCALE, 0],
      halfSize: [
        0.11 * TARGET_VISUAL_SCALE,
        0.2 * TARGET_VISUAL_SCALE,
        0.12 * TARGET_VISUAL_SCALE,
      ],
    },
  },
  {
    kind: "box",
    hitbox: {
      zone: "leg",
      center: [-0.14 * TARGET_VISUAL_SCALE, 0.26 * TARGET_VISUAL_SCALE, 0],
      halfSize: [
        0.14 * TARGET_VISUAL_SCALE,
        0.36 * TARGET_VISUAL_SCALE,
        0.15 * TARGET_VISUAL_SCALE,
      ],
    },
  },
  {
    kind: "box",
    hitbox: {
      zone: "leg",
      center: [0.14 * TARGET_VISUAL_SCALE, 0.26 * TARGET_VISUAL_SCALE, 0],
      halfSize: [
        0.14 * TARGET_VISUAL_SCALE,
        0.36 * TARGET_VISUAL_SCALE,
        0.15 * TARGET_VISUAL_SCALE,
      ],
    },
  },
  {
    kind: "sphere",
    hitbox: {
      zone: "leg",
      center: [-0.14 * TARGET_VISUAL_SCALE, 0.02 * TARGET_VISUAL_SCALE, 0],
      radius: 0.13 * TARGET_VISUAL_SCALE,
    },
  },
  {
    kind: "sphere",
    hitbox: {
      zone: "leg",
      center: [0.14 * TARGET_VISUAL_SCALE, 0.02 * TARGET_VISUAL_SCALE, 0],
      radius: 0.13 * TARGET_VISUAL_SCALE,
    },
  },
];

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

type TargetCharacterAsset = {
  model: THREE.Group | null;
  idleClip: THREE.AnimationClip | null;
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

const _tempSpherePoint = new THREE.Vector3();
const _tempSphereNormal = new THREE.Vector3();
const _tempAabbNearNormal = new THREE.Vector3();
const _tempAabbFarNormal = new THREE.Vector3();
const _tempAabbPoint = new THREE.Vector3();
const _tempTargetLocalOrigin = new THREE.Vector3();
const _tempTargetLocalDirection = new THREE.Vector3();

function transformTargetHit(
  hit: TargetRaycastHit,
  target: TargetState,
): TargetRaycastHit {
  const [x, baseY, z] = target.position;
  const point = hit.point
    .clone()
    .applyAxisAngle(Y_AXIS, target.facingYaw)
    .add(new THREE.Vector3(x, baseY, z));
  const normal = hit.normal
    .clone()
    .applyAxisAngle(Y_AXIS, target.facingYaw)
    .normalize();

  return {
    ...hit,
    point,
    normal,
  };
}

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
    const localOrigin = _tempTargetLocalOrigin
      .set(origin.x - x, origin.y - baseY, origin.z - z)
      .applyAxisAngle(Y_AXIS, -target.facingYaw);
    const localDirection = _tempTargetLocalDirection
      .copy(direction)
      .applyAxisAngle(Y_AXIS, -target.facingYaw)
      .normalize();

    let targetClosestHit: TargetRaycastHit | null = null;
    for (const part of TARGET_HITBOX_PARTS) {
      const partHit = part.kind === "sphere"
        ? raycastSpherePart(
          target.id,
          part.hitbox.zone,
          localOrigin,
          localDirection,
          ...part.hitbox.center,
          part.hitbox.radius,
        )
        : raycastAabbPart(
          target.id,
          part.hitbox.zone,
          localOrigin,
          localDirection,
          ...part.hitbox.center,
          ...part.hitbox.halfSize,
        );
      if (!partHit) {
        continue;
      }
      const worldPartHit = transformTargetHit(partHit, target);
      if (worldPartHit.distance > maxDistance) {
        continue;
      }
      if (
        !targetClosestHit || worldPartHit.distance < targetClosestHit.distance
      ) {
        targetClosestHit = worldPartHit;
      }
    }

    if (
      targetClosestHit &&
      (!closestHit || targetClosestHit.distance < closestHit.distance)
    ) {
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
  const normal = _tempSphereNormal.set(point.x - cx, point.y - cy, point.z - cz)
    .normalize();

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
  });
}

function useTargetCharacterAsset(enabled: boolean): TargetCharacterAsset {
  const [asset, setAsset] = useState<TargetCharacterAsset>({
    model: null,
    idleClip: null,
    ready: false,
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let disposed = false;

    (async () => {
      try {
        const [result, idleClip] = await Promise.all([
          loadGlbWithAnimations(TARGET_CHARACTER_MODEL_URL),
          loadFbxAnimation(TARGET_IDLE_ANIMATION_URL, "idle"),
        ]);
        if (disposed) return;
        if (!result) {
          setAsset({ model: null, idleClip: null, ready: true });
          return;
        }

        const preparedModel = SkeletonUtils.clone(result.scene) as THREE.Group;
        prepareTargetCharacterModel(preparedModel);

        const modelBoneNames = new Set<string>();
        preparedModel.traverse((child) => {
          if (
            (child as THREE.Bone).isBone ||
            (child as THREE.SkinnedMesh).isSkinnedMesh
          ) {
            modelBoneNames.add(child.name);
          }
        });

        const remappedIdle = idleClip
          ? remapAnimationClip(idleClip, modelBoneNames).clone()
          : null;
        if (remappedIdle) {
          removeRootMotion(remappedIdle);
          remappedIdle.tracks = remappedIdle.tracks.filter((track) =>
            modelBoneNames.has(getTrackNodeName(track.name)) &&
            getTrackProperty(track.name) !== ".position"
          );
        }

        setAsset({ model: preparedModel, idleClip: remappedIdle, ready: true });
      } catch (error) {
        console.warn("[Targets] Target asset warm-up failed", error);
        if (!disposed) {
          setAsset({ model: null, idleClip: null, ready: true });
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [enabled]);

  return asset;
}

const HPBar = memo(
  function HPBar({ hp, maxHp }: { hp: number; maxHp: number }) {
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
  outline,
  characterAsset,
}: {
  target: TargetState;
  shadows: boolean;
  reveal: number;
  outline: EnemyOutlineSettings;
  characterAsset: TargetCharacterAsset;
}) {
  const [x, baseY, z] = target.position;
  const now = performance.now();
  const isHit = target.hitUntil > now;
  const characterMixerRef = useRef<THREE.AnimationMixer | null>(null);
  const outlineMixerRef = useRef<THREE.AnimationMixer | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const characterInstance = useMemo(
    () => (characterAsset.model
      ? (SkeletonUtils.clone(characterAsset.model) as THREE.Group)
      : null),
    [characterAsset.model],
  );
  const outlineInstance = useMemo(
    () =>
      outline.enabled && characterAsset.model
        ? (SkeletonUtils.clone(characterAsset.model) as THREE.Group)
        : null,
    [characterAsset.model, outline.enabled],
  );
  const outlineColor = ENEMY_OUTLINE_COLOR_HEX[outline.color];
  const outlineOpacity = outline.opacity * reveal;
  // Keep silhouette tight to the target mesh; large boosts look like a ghost clone.
  const outlineScaleBoost = 1 + outline.thickness * 0.000000001 - 0.1;

  useEffect(() => {
    if (!characterInstance) return;

    if (characterAsset.idleClip) {
      const mixer = new THREE.AnimationMixer(characterInstance);
      const action = mixer.clipAction(characterAsset.idleClip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.play();
      characterMixerRef.current = mixer;

      return () => {
        mixer.stopAllAction();
        characterMixerRef.current = null;
      };
    }

    return undefined;
  }, [characterAsset.idleClip, characterInstance]);

  useEffect(() => {
    if (!outlineInstance) return;
    if (characterAsset.idleClip) {
      const mixer = new THREE.AnimationMixer(outlineInstance);
      const action = mixer.clipAction(characterAsset.idleClip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.play();
      outlineMixerRef.current = mixer;

      return () => {
        mixer.stopAllAction();
        outlineMixerRef.current = null;
      };
    }

    return undefined;
  }, [characterAsset.idleClip, outlineInstance]);

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
          litMaterial.emissive.set(isHit ? "#5a1111" : "#000000");
          litMaterial.emissiveIntensity = isHit ? 0.85 : 0;
        }
      }
    });
  }, [characterInstance, isHit, reveal, shadows]);

  useEffect(() => {
    if (!outlineInstance) return;
    outlineInstance.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      const data = mesh.userData as {
        __outlineMaterials?: THREE.MeshBasicMaterial[];
      };
      if (!data.__outlineMaterials) {
        const sourceMaterials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        data.__outlineMaterials = sourceMaterials.map(() => {
          const material = new THREE.MeshBasicMaterial({
            toneMapped: false,
          });
          if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
            (
              material as THREE.MeshBasicMaterial & {
                skinning?: boolean;
              }
            ).skinning = true;
          }
          return material;
        });
        mesh.material = Array.isArray(mesh.material)
          ? data.__outlineMaterials
          : data.__outlineMaterials[0];
      }
      for (const material of data.__outlineMaterials) {
        material.color.set(outlineColor);
        material.opacity = outlineOpacity;
        material.transparent = outlineOpacity < 0.999;
        material.side = THREE.BackSide;
        material.depthWrite = false;
        material.depthTest = true;
        material.needsUpdate = true;
      }
    });
  }, [outlineColor, outlineInstance, outlineOpacity]);

  useEffect(() => {
    return () => {
      if (!outlineInstance) return;
      outlineInstance.traverse((child) => {
        if (!(child as THREE.Mesh).isMesh) return;
        const mesh = child as THREE.Mesh;
        const data = mesh.userData as {
          __outlineMaterials?: THREE.MeshBasicMaterial[];
        };
        if (!data.__outlineMaterials) return;
        for (const material of data.__outlineMaterials) {
          material.dispose();
        }
        delete data.__outlineMaterials;
      });
    };
  }, [outlineInstance]);

  useFrame((_, delta) => {
    if (reveal <= 0.01 || target.disabled) return;
    characterMixerRef.current?.update(delta);
    outlineMixerRef.current?.update(delta);
  });

  const scale = 0.82 + reveal * 0.18;
  const visible = !target.disabled && reveal > 0.01;
  const outlineVisible = outline.enabled && outlineOpacity > 0.01 && visible;

  return (
    <group
      ref={groupRef}
      position={[x, baseY, z]}
      rotation={[0, target.facingYaw, 0]}
      scale={scale}
      visible={visible}
    >
      {outlineVisible && outlineInstance
        ? (
          <primitive
            object={outlineInstance}
            scale={[outlineScaleBoost, outlineScaleBoost, outlineScaleBoost]}
            renderOrder={1}
          />
        )
        : null}
      {characterInstance
        ? <primitive object={characterInstance} renderOrder={2} />
        : (
          <>
            {outlineVisible
              ? (
                <mesh position={[0, 1.6, 0]} renderOrder={1}>
                  <sphereGeometry args={[0.22 * outlineScaleBoost, 12, 12]} />
                  <meshBasicMaterial
                    color={outlineColor}
                    side={THREE.BackSide}
                    transparent={outlineOpacity < 0.999}
                    opacity={outlineOpacity}
                    depthWrite={false}
                    toneMapped={false}
                  />
                </mesh>
              )
              : null}
            <mesh
              position={[0, 1.6, 0]}
              castShadow={shadows}
              receiveShadow={shadows}
              renderOrder={2}
            >
              <sphereGeometry args={[0.22, 12, 12]} />
              <meshStandardMaterial
                color={isHit ? "#ff5555" : "#e8d5b7"}
                transparent={reveal < 0.999}
                opacity={reveal}
              />
            </mesh>
          </>
        )}
      {reveal >= 0.55 ? <HPBar hp={target.hp} maxHp={target.maxHp} /> : null}
    </group>
  );
});

export function Targets({
  targets,
  shadows,
  reveal,
  outline,
  loadCharacterAsset = true,
  onReadyChange,
}: TargetsProps) {
  const characterAsset = useTargetCharacterAsset(loadCharacterAsset);
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
          outline={outline}
          characterAsset={characterAsset}
        />
      ))}
    </group>
  );
}
