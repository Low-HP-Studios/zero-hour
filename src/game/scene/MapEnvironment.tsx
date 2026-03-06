import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { StressModeCount } from "../types";
import {
  BUILDING_CENTER,
  BUILDING_DEPTH,
  BUILDING_HEIGHT,
  BUILDING_WIDTH,
  CLIFF_HEIGHT,
  CLIFF_THICKNESS,
  DOOR_GAP_WIDTH,
  DOOR_HEIGHT,
  OCEAN_LEVEL_Y,
  OCEAN_SIZE,
  SHORE_FOAM_RING_PADDING,
  SHORE_SHELF_PADDING,
  SHORE_SHELF_Y,
  WALKABLE_CENTER_X,
  WALKABLE_CENTER_Z,
  WALKABLE_SIZE_X,
  WALKABLE_SIZE_Z,
  WALL_THICKNESS,
  WORLD_BOUNDS,
} from "./scene-constants";
import { createSandTexture, createOceanTexture, createSkyTexture } from "./Textures";

const BUILDING_FLOOR_MATERIAL = new THREE.MeshStandardMaterial({ color: "#a6a295", roughness: 0.98, metalness: 0 });
const BUILDING_WALL_MATERIAL = new THREE.MeshStandardMaterial({ color: "#ddd0b7", roughness: 0.82, metalness: 0.03 });
const BUILDING_ROOF_MATERIAL = new THREE.MeshStandardMaterial({ color: "#af8868", roughness: 0.86, metalness: 0.04 });
const BUILDING_DOOR_MATERIAL = new THREE.MeshStandardMaterial({ color: "#8a7a66", roughness: 0.7, metalness: 0.12, transparent: true, opacity: 0.45 });

function BuildingShell({ shadows }: { shadows: boolean }) {
  const leftSouthWidth = (BUILDING_WIDTH - DOOR_GAP_WIDTH) / 2;
  const rightSouthWidth = leftSouthWidth;

  return (
    <group position={[BUILDING_CENTER.x, 0, BUILDING_CENTER.z]}>
      <mesh position={[0, 0.01, 0]} receiveShadow={shadows} userData={{ bulletHittable: true }} material={BUILDING_FLOOR_MATERIAL}>
        <boxGeometry args={[BUILDING_WIDTH, 0.02, BUILDING_DEPTH]} />
      </mesh>

      <mesh
        position={[-BUILDING_WIDTH / 2 + WALL_THICKNESS / 2, BUILDING_HEIGHT / 2, 0]}
        castShadow={shadows}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
        material={BUILDING_WALL_MATERIAL}
      >
        <boxGeometry args={[WALL_THICKNESS, BUILDING_HEIGHT, BUILDING_DEPTH]} />
      </mesh>
      <mesh
        position={[BUILDING_WIDTH / 2 - WALL_THICKNESS / 2, BUILDING_HEIGHT / 2, 0]}
        castShadow={shadows}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
        material={BUILDING_WALL_MATERIAL}
      >
        <boxGeometry args={[WALL_THICKNESS, BUILDING_HEIGHT, BUILDING_DEPTH]} />
      </mesh>
      <mesh
        position={[0, BUILDING_HEIGHT / 2, -BUILDING_DEPTH / 2 + WALL_THICKNESS / 2]}
        castShadow={shadows}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
        material={BUILDING_WALL_MATERIAL}
      >
        <boxGeometry args={[BUILDING_WIDTH, BUILDING_HEIGHT, WALL_THICKNESS]} />
      </mesh>
      <mesh
        position={[
          -DOOR_GAP_WIDTH / 2 - leftSouthWidth / 2,
          BUILDING_HEIGHT / 2,
          BUILDING_DEPTH / 2 - WALL_THICKNESS / 2,
        ]}
        castShadow={shadows}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
        material={BUILDING_WALL_MATERIAL}
      >
        <boxGeometry args={[leftSouthWidth, BUILDING_HEIGHT, WALL_THICKNESS]} />
      </mesh>
      <mesh
        position={[
          DOOR_GAP_WIDTH / 2 + rightSouthWidth / 2,
          BUILDING_HEIGHT / 2,
          BUILDING_DEPTH / 2 - WALL_THICKNESS / 2,
        ]}
        castShadow={shadows}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
        material={BUILDING_WALL_MATERIAL}
      >
        <boxGeometry args={[rightSouthWidth, BUILDING_HEIGHT, WALL_THICKNESS]} />
      </mesh>

      <mesh
        position={[0, BUILDING_HEIGHT + 0.1, 0]}
        castShadow={shadows}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
        material={BUILDING_ROOF_MATERIAL}
      >
        <boxGeometry args={[BUILDING_WIDTH + 0.5, 0.2, BUILDING_DEPTH + 0.5]} />
      </mesh>

      <mesh
        position={[0, DOOR_HEIGHT / 2, BUILDING_DEPTH / 2 - 0.03]}
        castShadow={shadows}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
        material={BUILDING_DOOR_MATERIAL}
      >
        <boxGeometry args={[DOOR_GAP_WIDTH - 0.15, DOOR_HEIGHT, 0.05]} />
      </mesh>
    </group>
  );
}
void BuildingShell;

export type MapEnvironmentProps = {
  shadows: boolean;
};

export function MapEnvironment({ shadows }: MapEnvironmentProps) {
  const sandTexture = useMemo(() => createSandTexture(), []);
  const oceanTexture = useMemo(() => createOceanTexture(), []);
  const skyTexture = useMemo(() => createSkyTexture(), []);

  useEffect(() => {
    return () => {
      skyTexture?.dispose();
      sandTexture?.dispose();
      oceanTexture?.dispose();
    };
  }, [oceanTexture, sandTexture, skyTexture]);

  useFrame((_, delta) => {
    if (!oceanTexture) {
      return;
    }
    oceanTexture.offset.x = (oceanTexture.offset.x + delta * 0.012) % 1;
    oceanTexture.offset.y = (oceanTexture.offset.y + delta * 0.006) % 1;
  });

  const shelfSizeX = WALKABLE_SIZE_X + SHORE_SHELF_PADDING * 2;
  const shelfSizeZ = WALKABLE_SIZE_Z + SHORE_SHELF_PADDING * 2;
  const foamRingSizeX = WALKABLE_SIZE_X + SHORE_FOAM_RING_PADDING * 2;
  const foamRingSizeZ = WALKABLE_SIZE_Z + SHORE_FOAM_RING_PADDING * 2;
  const cliffY = 0 - CLIFF_HEIGHT / 2;

  return (
    <group>
      <mesh>
        <sphereGeometry args={[560, 48, 32]} />
        <meshBasicMaterial map={skyTexture ?? undefined} side={THREE.BackSide} depthWrite={false} fog={false} />
      </mesh>

      <group position={[124, 24, -174]}>
        <mesh>
          <sphereGeometry args={[5.2, 28, 28]} />
          <meshBasicMaterial color="#ffe0b0" />
        </mesh>
        <mesh>
          <sphereGeometry args={[8.4, 26, 26]} />
          <meshBasicMaterial color="#ffc78f" transparent opacity={0.24} depthWrite={false} />
        </mesh>
        <mesh>
          <sphereGeometry args={[11.8, 24, 24]} />
          <meshBasicMaterial color="#ffad78" transparent opacity={0.11} depthWrite={false} />
        </mesh>
      </group>

      <mesh
        position={[WALKABLE_CENTER_X, OCEAN_LEVEL_Y, WALKABLE_CENTER_Z]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[OCEAN_SIZE, OCEAN_SIZE]} />
        <meshStandardMaterial
          color="#2b5f77"
          map={oceanTexture ?? undefined}
          roughness={0.28}
          metalness={0.1}
        />
      </mesh>
      <mesh
        position={[WALKABLE_CENTER_X, OCEAN_LEVEL_Y + 0.06, WALKABLE_CENTER_Z]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[OCEAN_SIZE, OCEAN_SIZE]} />
        <meshBasicMaterial color="#80cae4" transparent opacity={0.07} depthWrite={false} />
      </mesh>

      <mesh
        position={[WALKABLE_CENTER_X, SHORE_SHELF_Y, WALKABLE_CENTER_Z]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
      >
        <planeGeometry args={[shelfSizeX, shelfSizeZ]} />
        <meshStandardMaterial color="#b79059" roughness={0.98} metalness={0.01} />
      </mesh>

      <mesh
        position={[WALKABLE_CENTER_X, SHORE_SHELF_Y + 0.03, WALKABLE_CENTER_Z]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[foamRingSizeX, foamRingSizeZ]} />
        <meshBasicMaterial color="#f7dcb8" transparent opacity={0.08} depthWrite={false} />
      </mesh>

      <mesh
        position={[WALKABLE_CENTER_X, 0, WALKABLE_CENTER_Z]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
      >
        <planeGeometry args={[WALKABLE_SIZE_X, WALKABLE_SIZE_Z]} />
        <meshStandardMaterial
          color="#ebd6a8"
          map={sandTexture ?? undefined}
          roughness={0.97}
          metalness={0}
        />
      </mesh>

      <mesh
        position={[WALKABLE_CENTER_X, cliffY, WORLD_BOUNDS.maxZ + CLIFF_THICKNESS / 2]}
        castShadow={shadows}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
      >
        <boxGeometry args={[WALKABLE_SIZE_X + CLIFF_THICKNESS, CLIFF_HEIGHT, CLIFF_THICKNESS]} />
        <meshStandardMaterial color="#7d6445" roughness={0.93} metalness={0.02} />
      </mesh>
      <mesh
        position={[WALKABLE_CENTER_X, cliffY, WORLD_BOUNDS.minZ - CLIFF_THICKNESS / 2]}
        castShadow={shadows}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
      >
        <boxGeometry args={[WALKABLE_SIZE_X + CLIFF_THICKNESS, CLIFF_HEIGHT, CLIFF_THICKNESS]} />
        <meshStandardMaterial color="#775f42" roughness={0.93} metalness={0.02} />
      </mesh>
      <mesh
        position={[WORLD_BOUNDS.maxX + CLIFF_THICKNESS / 2, cliffY, WALKABLE_CENTER_Z]}
        castShadow={shadows}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
      >
        <boxGeometry args={[CLIFF_THICKNESS, CLIFF_HEIGHT, WALKABLE_SIZE_Z + CLIFF_THICKNESS * 2]} />
        <meshStandardMaterial color="#7a6245" roughness={0.93} metalness={0.02} />
      </mesh>
      <mesh
        position={[WORLD_BOUNDS.minX - CLIFF_THICKNESS / 2, cliffY, WALKABLE_CENTER_Z]}
        castShadow={shadows}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
      >
        <boxGeometry args={[CLIFF_THICKNESS, CLIFF_HEIGHT, WALKABLE_SIZE_Z + CLIFF_THICKNESS * 2]} />
        <meshStandardMaterial color="#6f593f" roughness={0.93} metalness={0.02} />
      </mesh>

    </group>
  );
}

export function StressBoxes({ count, shadows }: { count: StressModeCount; shadows: boolean }) {
  void count;
  void shadows;
  return null;
}
