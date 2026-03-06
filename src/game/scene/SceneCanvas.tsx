import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas } from "@react-three/fiber";
import { Perf } from "r3f-perf";
import type { AudioVolumeSettings } from "../Audio";
import {
  Targets,
  createDefaultTargets,
  resetTargets,
  RESPAWN_DELAY_MS,
} from "../Targets";
import type {
  GameSettings,
  PerfMetrics,
  PlayerSnapshot,
  StressModeCount,
  TargetState,
} from "../types";
import type { SniperRechamberState, WeaponKind } from "../Weapon";
import { GameplayRuntime, type HitMarkerKind, type AimingState } from "./GameplayRuntime";
import { MapEnvironment, StressBoxes } from "./MapEnvironment";
import {
  CANVAS_CAMERA,
  CANVAS_GL,
  STATIC_COLLIDERS,
  TARGET_FLASH_MS,
  WORLD_BOUNDS,
} from "./scene-constants";

export type { HitMarkerKind, AimingState };

type SceneProps = {
  settings: GameSettings;
  audioVolumes: AudioVolumeSettings;
  stressCount: StressModeCount;
  resumePointerLockRequestId: number;
  onPlayerSnapshot: (snapshot: PlayerSnapshot) => void;
  onPerfMetrics: (metrics: PerfMetrics) => void;
  onHitMarker: (kind: HitMarkerKind) => void;
  onWeaponEquippedChange: (equipped: boolean) => void;
  onActiveWeaponChange: (weapon: WeaponKind) => void;
  onSniperRechamberChange: (state: SniperRechamberState) => void;
  onAimingStateChange: (state: AimingState) => void;
};

export function Scene({
  settings,
  audioVolumes,
  stressCount,
  resumePointerLockRequestId,
  onPlayerSnapshot,
  onPerfMetrics,
  onHitMarker,
  onWeaponEquippedChange,
  onActiveWeaponChange,
  onSniperRechamberChange,
  onAimingStateChange,
}: SceneProps) {
  const [targets, setTargets] = useState<TargetState[]>(() => createDefaultTargets());
  const sceneTargetsRef = useRef(targets);
  sceneTargetsRef.current = targets;
  const resetTimeoutsRef = useRef<Map<string, number>>(new Map());

  const dpr = useMemo(() => {
    const devicePixelRatio =
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    return Math.min(2, Math.max(0.5, devicePixelRatio * settings.pixelRatioScale));
  }, [settings.pixelRatioScale]);

  const handleTargetHit = useCallback((targetId: string, damage: number, nowMs: number) => {
    startTransition(() => {
      setTargets((previousTargets) =>
        previousTargets.map((target) => {
          if (target.id !== targetId) return target;
          const newHp = Math.max(0, target.hp - damage);
          return {
            ...target,
            hp: newHp,
            disabled: newHp <= 0,
            hitUntil: nowMs + TARGET_FLASH_MS,
          };
        }),
      );
    });

    const currentTarget = sceneTargetsRef.current.find((t: TargetState) => t.id === targetId);
    if (currentTarget && currentTarget.hp - damage <= 0) {
      const existing = resetTimeoutsRef.current.get(targetId);
      if (existing !== undefined) {
        window.clearTimeout(existing);
      }
      const timeoutId = window.setTimeout(() => {
        resetTimeoutsRef.current.delete(targetId);
        startTransition(() => {
          setTargets((previousTargets) =>
            previousTargets.map((t) =>
              t.id === targetId ? { ...t, disabled: false, hp: t.maxHp } : t,
            ),
          );
        });
      }, RESPAWN_DELAY_MS);
      resetTimeoutsRef.current.set(targetId, timeoutId);
    }
  }, []);

  const handleResetTargets = useCallback(() => {
    for (const timeoutId of resetTimeoutsRef.current.values()) {
      window.clearTimeout(timeoutId);
    }
    resetTimeoutsRef.current.clear();
    startTransition(() => {
      setTargets((previousTargets) => resetTargets(previousTargets));
    });
  }, []);

  useEffect(() => {
    const timeoutMap = resetTimeoutsRef.current;
    return () => {
      for (const timeoutId of timeoutMap.values()) {
        window.clearTimeout(timeoutId);
      }
      timeoutMap.clear();
    };
  }, []);

  return (
    <Canvas
      className="game-canvas"
      shadows={settings.shadows ? "percentage" : false}
      dpr={dpr}
      camera={CANVAS_CAMERA}
      gl={CANVAS_GL}
    >
      <color attach="background" args={["#86c8ff"]} />
      <fog attach="fog" args={["#f2c39b", 110, 620]} />
      <hemisphereLight args={["#a7d6ff", "#c49c6d", 0.95]} />
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[106, 34, -118]}
        intensity={1.95}
        color="#ffd2a2"
        castShadow={settings.shadows}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={220}
        shadow-camera-left={-90}
        shadow-camera-right={90}
        shadow-camera-top={90}
        shadow-camera-bottom={-90}
      />
      <MapEnvironment shadows={settings.shadows} />
      <Targets targets={targets} shadows={settings.shadows} />
      <StressBoxes count={stressCount} shadows={settings.shadows} />
      <GameplayRuntime
        collisionRects={STATIC_COLLIDERS}
        worldBounds={WORLD_BOUNDS}
        audioVolumes={audioVolumes}
        resumePointerLockRequestId={resumePointerLockRequestId}
        sensitivity={settings.sensitivity}
        keybinds={settings.keybinds}
        fov={settings.fov}
        weaponAlignment={settings.weaponAlignment}
        targets={targets}
        onTargetHit={handleTargetHit}
        onResetTargets={handleResetTargets}
        onPlayerSnapshot={onPlayerSnapshot}
        onPerfMetrics={onPerfMetrics}
        onHitMarker={onHitMarker}
        onWeaponEquippedChange={onWeaponEquippedChange}
        onActiveWeaponChange={onActiveWeaponChange}
        onSniperRechamberChange={onSniperRechamberChange}
        onAimingStateChange={onAimingStateChange}
      />
      {settings.showR3fPerf ? <Perf position="top-left" minimal /> : null}
    </Canvas>
  );
}
