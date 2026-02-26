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

export function createDefaultTargets(): TargetState[] {
  return [
    { id: "t1", position: [-8, 1.5, -12], radius: 0.45, hitUntil: 0, disabled: false },
    { id: "t2", position: [1, 1.5, -15], radius: 0.45, hitUntil: 0, disabled: false },
    { id: "t3", position: [14, 1.5, -7], radius: 0.45, hitUntil: 0, disabled: false },
  ];
}

export function resetTargets(targets: TargetState[]): TargetState[] {
  return targets.map((target) => ({
    ...target,
    hitUntil: 0,
    disabled: false,
  }));
}

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

    const center = target.position;
    const ox = origin.x - center[0];
    const oy = origin.y - center[1];
    const oz = origin.z - center[2];

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

export function Targets({ targets, shadows }: TargetsProps) {
  const now = performance.now();

  return (
    <group>
      {targets.map((target) => {
        const [x, y, z] = target.position;
        const isHit = target.hitUntil > now;
        const plateColor = target.disabled ? "#4a5158" : isHit ? "#ff7070" : "#d4dee7";

        return (
          <group key={target.id} position={[x, y, z]}>
            <mesh position={[0, -0.7, 0]} castShadow={shadows} receiveShadow={shadows}>
              <cylinderGeometry args={[0.05, 0.05, 1.4, 8]} />
              <meshStandardMaterial color="#6a747d" metalness={0.2} roughness={0.7} />
            </mesh>
            <mesh rotation={[0, 0, 0]} castShadow={shadows} receiveShadow={shadows}>
              <cylinderGeometry args={[0.45, 0.45, 0.08, 24]} />
              <meshStandardMaterial color={plateColor} metalness={0.15} roughness={0.5} />
            </mesh>
            <mesh position={[0, 0, -0.02]}>
              <ringGeometry args={[0.15, 0.2, 24]} />
              <meshBasicMaterial color="#23313b" side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
