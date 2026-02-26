import type { TargetState } from "./types";

type TargetsProps = {
  targets: TargetState[];
  now: number;
  shadows: boolean;
};

export function Targets({ targets, now, shadows }: TargetsProps) {
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
              <meshBasicMaterial color="#23313b" side={2} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
