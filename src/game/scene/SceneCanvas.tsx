import {
  forwardRef,
  startTransition,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas } from "@react-three/fiber";
import { Perf } from "r3f-perf";
import * as THREE from "three";
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
  ScenePresentation,
  StressModeCount,
  TargetState,
} from "../types";
import type { SniperRechamberState, WeaponKind } from "../Weapon";
import {
  GameplayRuntime,
  type GameplayRuntimeHandle,
  type HitMarkerKind,
  type AimingState,
} from "./GameplayRuntime";
import { MapEnvironment, StressBoxes } from "./MapEnvironment";
import {
  CANVAS_CAMERA,
  CANVAS_GL,
  STATIC_COLLIDERS,
  TARGET_FLASH_MS,
  WORLD_BOUNDS,
} from "./scene-constants";

export type { HitMarkerKind, AimingState };

const VOID_BG = new THREE.Color("#0a1628");
const LIVE_BG = new THREE.Color("#86c8ff");
const VOID_FOG = new THREE.Color("#0a1628");
const LIVE_FOG = new THREE.Color("#f2c39b");
const VOID_SKY_LIGHT = new THREE.Color("#1a2a4a");
const LIVE_SKY_LIGHT = new THREE.Color("#a7d6ff");
const VOID_GROUND_LIGHT = new THREE.Color("#141820");
const LIVE_GROUND_LIGHT = new THREE.Color("#c49c6d");
const MENU_KEY_LIGHT = new THREE.Color("#c0d0f0");

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function blendColor(from: THREE.Color, to: THREE.Color, amount: number) {
  return new THREE.Color().copy(from).lerp(to, clamp01(amount));
}

export type SceneHandle = {
  requestPointerLock: () => void;
  releasePointerLock: () => void;
  dropWeaponForReturn: () => void;
  resetForMenu: () => void;
};

type SceneProps = {
  settings: GameSettings;
  audioVolumes: AudioVolumeSettings;
  stressCount: StressModeCount;
  presentation: ScenePresentation;
  onPlayerSnapshot: (snapshot: PlayerSnapshot) => void;
  onPerfMetrics: (metrics: PerfMetrics) => void;
  onHitMarker: (kind: HitMarkerKind) => void;
  onWeaponEquippedChange: (equipped: boolean) => void;
  onActiveWeaponChange: (weapon: WeaponKind) => void;
  onSniperRechamberChange: (state: SniperRechamberState) => void;
  onAimingStateChange: (state: AimingState) => void;
};

export const Scene = forwardRef<SceneHandle, SceneProps>(function Scene({
  settings,
  audioVolumes,
  stressCount,
  presentation,
  onPlayerSnapshot,
  onPerfMetrics,
  onHitMarker,
  onWeaponEquippedChange,
  onActiveWeaponChange,
  onSniperRechamberChange,
  onAimingStateChange,
}: SceneProps, ref) {
  const [targets, setTargets] = useState<TargetState[]>(() =>
    createDefaultTargets()
  );
  const sceneTargetsRef = useRef(targets);
  const runtimeRef = useRef<GameplayRuntimeHandle | null>(null);
  sceneTargetsRef.current = targets;
  const resetTimeoutsRef = useRef<Map<string, number>>(new Map());

  const dpr = useMemo(() => {
    const devicePixelRatio =
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    return Math.min(
      2,
      Math.max(0.5, devicePixelRatio * settings.pixelRatioScale),
    );
  }, [settings.pixelRatioScale]);

  const phaseProgress = clamp01(presentation.phaseProgress);
  const worldTheme = clamp01(
    presentation.worldTheme - presentation.killPulse * 0.08,
  );
  const floorGridOpacity = presentation.phase === "menu"
    ? 0.82
    : presentation.phase === "entering"
    ? 0.82 * (1 - clamp01(phaseProgress / 0.38))
    : presentation.phase === "returning"
    ? 0.82 * clamp01((phaseProgress - 0.62) / 0.24)
    : 0;
  const backgroundColor = blendColor(VOID_BG, LIVE_BG, worldTheme);
  const fogColor = blendColor(VOID_FOG, LIVE_FOG, worldTheme);
  const skyLightColor = blendColor(VOID_SKY_LIGHT, LIVE_SKY_LIGHT, worldTheme);
  const groundLightColor = blendColor(
    VOID_GROUND_LIGHT,
    LIVE_GROUND_LIGHT,
    worldTheme,
  );
  const ambientIntensity = THREE.MathUtils.lerp(0.35, 0.5, worldTheme);
  const hemisphereIntensity = THREE.MathUtils.lerp(0.45, 0.95, worldTheme);
  const sunIntensity = THREE.MathUtils.lerp(0.18, 1.95, worldTheme);
  const fillIntensity = THREE.MathUtils.lerp(0.25, 0.6, worldTheme);
  const voidCharacterLightIntensity = THREE.MathUtils.lerp(3.0, 0.16, worldTheme);

  const handleTargetHit = useCallback(
    (targetId: string, damage: number, nowMs: number) => {
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

      const currentTarget = sceneTargetsRef.current.find(
        (target: TargetState) => target.id === targetId,
      );
      if (currentTarget && currentTarget.hp - damage <= 0) {
        const existing = resetTimeoutsRef.current.get(targetId);
        if (existing !== undefined) {
          window.clearTimeout(existing);
        }
        const timeoutId = window.setTimeout(() => {
          resetTimeoutsRef.current.delete(targetId);
          startTransition(() => {
            setTargets((previousTargets) =>
              previousTargets.map((target) =>
                target.id === targetId
                  ? { ...target, disabled: false, hp: target.maxHp }
                  : target
              ),
            );
          });
        }, RESPAWN_DELAY_MS);
        resetTimeoutsRef.current.set(targetId, timeoutId);
      }
    },
    [],
  );

  const handleResetTargets = useCallback(() => {
    for (const timeoutId of resetTimeoutsRef.current.values()) {
      window.clearTimeout(timeoutId);
    }
    resetTimeoutsRef.current.clear();
    startTransition(() => {
      setTargets((previousTargets) => resetTargets(previousTargets));
    });
  }, []);

  useImperativeHandle(ref, () => ({
    requestPointerLock: () => {
      runtimeRef.current?.requestPointerLock();
    },
    releasePointerLock: () => {
      runtimeRef.current?.releasePointerLock();
    },
    dropWeaponForReturn: () => {
      runtimeRef.current?.dropWeaponForReturn();
    },
    resetForMenu: () => {
      handleResetTargets();
      runtimeRef.current?.resetForMenu();
    },
  }), [handleResetTargets]);

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
      shadows={settings.shadows && worldTheme > 0.6 ? "percentage" : false}
      dpr={dpr}
      camera={CANVAS_CAMERA}
      gl={CANVAS_GL}
    >
      <color attach="background" args={[backgroundColor]} />
      <fog attach="fog" args={[fogColor, 90, 620]} />
      <hemisphereLight
        args={[skyLightColor, groundLightColor, hemisphereIntensity]}
      />
      <ambientLight intensity={ambientIntensity} />
      <directionalLight
        position={[106, 34, -118]}
        intensity={sunIntensity}
        color="#ffd2a2"
        castShadow={settings.shadows && worldTheme > 0.6}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={220}
        shadow-camera-left={-90}
        shadow-camera-right={90}
        shadow-camera-top={90}
        shadow-camera-bottom={-90}
      />
      <directionalLight
        position={[-2, 3, 2]}
        intensity={fillIntensity}
        color="#5ab8ff"
      />
      <pointLight
        position={[0.3, 2.4, 3.6]}
        intensity={voidCharacterLightIntensity}
        distance={11}
        decay={1.7}
        color={MENU_KEY_LIGHT}
      />
      <MapEnvironment
        shadows={settings.shadows}
        theme={worldTheme}
        floorGridOpacity={floorGridOpacity}
      />
      <Targets
        targets={targets}
        shadows={settings.shadows && worldTheme > 0.6}
        reveal={presentation.targetReveal}
      />
      <StressBoxes count={stressCount} shadows={settings.shadows} />
      <GameplayRuntime
        ref={runtimeRef}
        collisionRects={STATIC_COLLIDERS}
        worldBounds={WORLD_BOUNDS}
        audioVolumes={audioVolumes}
        presentation={presentation}
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
});
