import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { TargetState } from "./types";

type TargetsProps = {
  targets: TargetState[];
  shadows: boolean;
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

export function createDefaultTargets(): TargetState[] {
  return [
    { id: "t1", position: [-8, 0, -18], radius: 0.6, hitUntil: 0, disabled: false, hp: 100, maxHp: 100 },
    { id: "t2", position: [6, 0, -26], radius: 0.6, hitUntil: 0, disabled: false, hp: 100, maxHp: 100 },
    { id: "t3", position: [-18, 0, -34], radius: 0.6, hitUntil: 0, disabled: false, hp: 100, maxHp: 100 },
    { id: "t4", position: [22, 0, -44], radius: 0.6, hitUntil: 0, disabled: false, hp: 100, maxHp: 100 },
    { id: "t5", position: [-30, 0, -52], radius: 0.6, hitUntil: 0, disabled: false, hp: 100, maxHp: 100 },
    { id: "t6", position: [0, 0, -62], radius: 0.6, hitUntil: 0, disabled: false, hp: 100, maxHp: 100 },
    { id: "t7", position: [34, 0, -72], radius: 0.6, hitUntil: 0, disabled: false, hp: 100, maxHp: 100 },
    { id: "t8", position: [-42, 0, -66], radius: 0.6, hitUntil: 0, disabled: false, hp: 100, maxHp: 100 },
    { id: "t9", position: [48, 0, -34], radius: 0.6, hitUntil: 0, disabled: false, hp: 100, maxHp: 100 },
    { id: "t10", position: [-54, 0, -28], radius: 0.6, hitUntil: 0, disabled: false, hp: 100, maxHp: 100 },
  ];
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

export function raycastTargets(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  targets: TargetState[],
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

  const point = new THREE.Vector3(
    origin.x + direction.x * distance,
    origin.y + direction.y * distance,
    origin.z + direction.z * distance,
  );
  const normal = new THREE.Vector3(point.x - cx, point.y - cy, point.z - cz).normalize();

  return { id, zone, point, normal, distance };
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
  const nearNormal = new THREE.Vector3();
  const farNormal = new THREE.Vector3();

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
      nearNormal.set(n1[0], n1[1], n1[2]);
    }
    if (t2 < tMax) {
      tMax = t2;
      farNormal.set(n2[0], n2[1], n2[2]);
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

  const point = new THREE.Vector3(
    origin.x + direction.x * distance,
    origin.y + direction.y * distance,
    origin.z + direction.z * distance,
  );
  const normal = (tMin > 0 ? nearNormal : farNormal).clone();

  return { id, zone, point, normal, distance };
}

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
}

function TargetDummy({ target, shadows }: { target: TargetState; shadows: boolean }) {
  const [x, baseY, z] = target.position;
  const now = performance.now();
  const isHit = target.hitUntil > now;

  if (target.disabled) {
    return null;
  }

  const bodyColor = isHit ? "#ff5555" : "#e8d5b7";
  const shirtColor = isHit ? "#cc3333" : "#4a6fa5";
  const pantsColor = isHit ? "#aa2222" : "#2d3a4a";

  return (
    <group position={[x, baseY, z]}>
      <mesh position={[0, 1.6, 0]} castShadow={shadows} receiveShadow={shadows}>
        <sphereGeometry args={[0.22, 12, 12]} />
        <meshStandardMaterial color={bodyColor} />
      </mesh>

      <mesh position={[0, 1.05, 0]} castShadow={shadows} receiveShadow={shadows}>
        <boxGeometry args={[0.5, 0.7, 0.3]} />
        <meshStandardMaterial color={shirtColor} />
      </mesh>

      <mesh position={[-0.2, 0.35, 0]} castShadow={shadows} receiveShadow={shadows}>
        <boxGeometry args={[0.16, 0.7, 0.16]} />
        <meshStandardMaterial color={pantsColor} />
      </mesh>
      <mesh position={[0.2, 0.35, 0]} castShadow={shadows} receiveShadow={shadows}>
        <boxGeometry args={[0.16, 0.7, 0.16]} />
        <meshStandardMaterial color={pantsColor} />
      </mesh>

      <HPBar hp={target.hp} maxHp={target.maxHp} />
    </group>
  );
}

export function Targets({ targets, shadows }: TargetsProps) {
  return (
    <group>
      {targets.map((target) => (
        <TargetDummy key={target.id} target={target} shadows={shadows} />
      ))}
    </group>
  );
}
