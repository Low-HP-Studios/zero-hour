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
  point: THREE.Vector3;
  distance: number;
};

const DAMAGE_PER_SHOT = 25;
const RESPAWN_DELAY_MS = 2000;

export function createDefaultTargets(): TargetState[] {
  return [
    { id: "t1", position: [-8, 0, -12], radius: 0.6, hitUntil: 0, disabled: false, hp: 100, maxHp: 100 },
    { id: "t2", position: [1, 0, -15], radius: 0.6, hitUntil: 0, disabled: false, hp: 100, maxHp: 100 },
    { id: "t3", position: [14, 0, -7], radius: 0.6, hitUntil: 0, disabled: false, hp: 100, maxHp: 100 },
    { id: "t4", position: [-4, 0, -5], radius: 0.6, hitUntil: 0, disabled: false, hp: 100, maxHp: 100 },
    { id: "t5", position: [6, 0, -18], radius: 0.6, hitUntil: 0, disabled: false, hp: 100, maxHp: 100 },
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

    const cx = target.position[0];
    const cy = target.position[1] + 1.0;
    const cz = target.position[2];

    const ox = origin.x - cx;
    const oy = origin.y - cy;
    const oz = origin.z - cz;

    const b = ox * direction.x + oy * direction.y + oz * direction.z;
    const c = ox * ox + oy * oy + oz * oz - target.radius * target.radius;
    const discriminant = b * b - c;

    if (discriminant < 0) {
      continue;
    }

    const sqrtDisc = Math.sqrt(discriminant);
    const nearT = -b - sqrtDisc;
    const farT = -b + sqrtDisc;
    const distance = nearT > 0 ? nearT : farT > 0 ? farT : -1;

    if (distance <= 0) {
      continue;
    }

    if (!closestHit || distance < closestHit.distance) {
      closestHit = {
        id: target.id,
        point: new THREE.Vector3(
          origin.x + direction.x * distance,
          origin.y + direction.y * distance,
          origin.z + direction.z * distance,
        ),
        distance,
      };
    }
  }

  return closestHit;
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
