import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { loadFbxAnimation, loadGlbWithAnimations } from "./AssetLoader";
import { TARGET_CHARACTER_MODEL_URL } from "./boot-assets";
import type { TargetState } from "./types";
import {
  remapAnimationClip,
  removeRootMotion,
} from "./scene/CharacterModel";
import { CHARACTER_TARGET_HEIGHT } from "./scene/scene-constants";

type TargetsProps = {
  targets: TargetState[];
  shadows: boolean;
  reveal: number;
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
const TARGET_IDLE_ANIMATION_URL = "/assets/animations/walking/Idle.fbx";
const TARGET_HP_BAR_Y = 2.4 * TARGET_VISUAL_SCALE;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

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
  {
    kind: "sphere",
    hitbox: {
      zone: "head",
      center: [0, 1.58 * TARGET_VISUAL_SCALE, 0.01 * TARGET_VISUAL_SCALE],
      radius: 0.28 * TARGET_VISUAL_SCALE,
    },
  },
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
    [-54, -22], [-36, -20], [-18, -24], [0, -22], [18, -24], [36, -20], [54, -22],
    [-48, -34], [-30, -36], [-12, -34], [6, -36], [24, -34], [42, -36],
    [-52, -48], [-34, -50], [-16, -52], [2, -50], [20, -52], [38, -50], [56, -48],
    [-44, -64], [-22, -68], [0, -66], [22, -68], [44, -64],
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
      if (!targetClosestHit || worldPartHit.distance < targetClosestHit.distance) {
        targetClosestHit = worldPartHit;
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

function useTargetCharacterAsset(): TargetCharacterAsset {
  const [asset, setAsset] = useState<TargetCharacterAsset>({
    model: null,
    idleClip: null,
    ready: false,
  });

  useEffect(() => {
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
    <group ref={groupRef} position={[0, TARGET_HP_BAR_Y, 0]}>
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
  const groupRef = useRef<THREE.Group>(null);
  const characterInstance = useMemo(
    () => (characterAsset.model ? (SkeletonUtils.clone(characterAsset.model) as THREE.Group) : null),
    [characterAsset.model],
  );

  useEffect(() => {
    if (!characterInstance) return;

    if (characterAsset.idleClip) {
      const mixer = new THREE.AnimationMixer(characterInstance);
      const action = mixer.clipAction(characterAsset.idleClip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.play();
      mixerRef.current = mixer;

      return () => {
        mixer.stopAllAction();
        mixerRef.current = null;
      };
    }

    return undefined;
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
    if (reveal <= 0.01 || target.disabled) return;
    mixerRef.current?.update(delta);
  });

  const scale = 0.82 + reveal * 0.18;
  const visible = !target.disabled && reveal > 0.01;

  return (
    <group
      ref={groupRef}
      position={[x, baseY, z]}
      rotation={[0, target.facingYaw, 0]}
      scale={scale}
      visible={visible}
    >
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

export function Targets({
  targets,
  shadows,
  reveal,
  onReadyChange,
}: TargetsProps) {
  const characterAsset = useTargetCharacterAsset();
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
        />
      ))}
    </group>
  );
}
