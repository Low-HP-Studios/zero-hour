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
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Perf } from "r3f-perf";
import * as THREE from "three";
import type { AudioVolumeSettings } from "../Audio";
import { markBootEvent } from "../boot-trace";
import type {
  OnlineFireIntent,
  OnlineMatchInputFrame,
  OnlineMatchPlayerState,
  OnlineRealtimePlayerState,
  OnlineShotFiredEvent,
} from "../online/types";
import {
  getSkyById,
  type SceneLightingPreset,
  type SkyId,
} from "../sky-registry";
import {
  Targets,
  resetTargets,
  RESPAWN_DELAY_MS,
  type TargetVisualHandle,
} from "../Targets";
import type {
  GameSettings,
  InventoryMoveLocation,
  InventoryMoveRequest,
  InventoryMoveResult,
  PerfMetrics,
  PlayerSnapshot,
  ScenePresentation,
  StressModeCount,
  TargetState,
  WeaponAlignmentOffset,
} from "../types";
import type { SniperRechamberState, WeaponKind } from "../Weapon";
import {
  GameplayRuntime,
  type GameplayRuntimeHandle,
  type HitMarkerKind,
  type AimingState,
  type ShotFiredState,
} from "./GameplayRuntime";
import type { BlockingVolume } from "../map-layout";
import {
  type CharacterModelOverride,
  normalizeBoneName,
  useCharacterModel,
} from "./CharacterModel";
import { PracticeMapEnvironment, StressBoxes } from "./MapEnvironment";
import {
  clonePracticeMapTargets,
  RANGE_PRACTICE_MAP,
  type PracticeMapDefinition,
} from "./practice-maps";
import { useWeaponModels } from "./WeaponModels";
import {
  CANVAS_CAMERA,
  CHARACTER_YAW_OFFSET,
  CANVAS_GL,
  TARGET_FLASH_MS,
  WEAPON_MODEL_TRANSFORMS,
} from "./scene-constants";

export type { HitMarkerKind, AimingState, ShotFiredState };

const VOID_BG = new THREE.Color("#050506");
const LIVE_BG = new THREE.Color("#b8d4e8");
const VOID_FOG = new THREE.Color("#090909");
const LIVE_FOG = new THREE.Color("#e8c88a");
const VOID_SKY_LIGHT = new THREE.Color("#111114");
const LIVE_SKY_LIGHT = new THREE.Color("#c8dce8");
const VOID_GROUND_LIGHT = new THREE.Color("#080808");
const LIVE_GROUND_LIGHT = new THREE.Color("#d4a862");
const MENU_KEY_LIGHT = new THREE.Color("#f6e8d6");
const MENU_FRAME_RATE = 30;
const TRANSITION_FRAME_RATE = 60;
const MENU_FRAME_INTERVAL_MS = 1000 / MENU_FRAME_RATE;
const TRANSITION_FRAME_INTERVAL_MS = 1000 / TRANSITION_FRAME_RATE;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function blendColor(from: THREE.Color, to: THREE.Color, amount: number) {
  return new THREE.Color().copy(from).lerp(to, clamp01(amount));
}

function blendNumber(from: number, to: number, amount: number) {
  return THREE.MathUtils.lerp(from, to, clamp01(amount));
}

function blendLightingPresets(
  from: SceneLightingPreset,
  to: SceneLightingPreset,
  amount: number,
) {
  return {
    background: blendColor(
      new THREE.Color(from.background),
      new THREE.Color(to.background),
      amount,
    ),
    fog: blendColor(
      new THREE.Color(from.fog),
      new THREE.Color(to.fog),
      amount,
    ),
    skyLight: blendColor(
      new THREE.Color(from.skyLight),
      new THREE.Color(to.skyLight),
      amount,
    ),
    groundLight: blendColor(
      new THREE.Color(from.groundLight),
      new THREE.Color(to.groundLight),
      amount,
    ),
    hemisphereIntensity: blendNumber(
      from.hemisphereIntensity,
      to.hemisphereIntensity,
      amount,
    ),
    ambientIntensity: blendNumber(
      from.ambientIntensity,
      to.ambientIntensity,
      amount,
    ),
    sunIntensity: blendNumber(from.sunIntensity, to.sunIntensity, amount),
    sunColor: blendColor(
      new THREE.Color(from.sunColor),
      new THREE.Color(to.sunColor),
      amount,
    ),
    fillIntensity: blendNumber(from.fillIntensity, to.fillIntensity, amount),
    fillColor: blendColor(
      new THREE.Color(from.fillColor),
      new THREE.Color(to.fillColor),
      amount,
    ),
    menuKeyIntensity: blendNumber(
      from.menuKeyIntensity,
      to.menuKeyIntensity,
      amount,
    ),
    menuKeyColor: blendColor(
      new THREE.Color(from.menuKeyColor),
      new THREE.Color(to.menuKeyColor),
      amount,
    ),
    fogNear: blendNumber(from.fogNear, to.fogNear, amount),
    fogFar: blendNumber(from.fogFar, to.fogFar, amount),
  };
}

export type SceneHandle = {
  requestPointerLock: () => void;
  releasePointerLock: () => void;
  dropWeaponForReturn: () => void;
  moveInventoryItem: (request: InventoryMoveRequest) => InventoryMoveResult;
  quickMoveInventoryItem: (location: InventoryMoveLocation) => InventoryMoveResult;
  resetForMenu: () => void;
};

type SceneProps = {
  settings: GameSettings;
  audioVolumes: AudioVolumeSettings;
  stressCount: StressModeCount;
  practiceMap: PracticeMapDefinition;
  selectedSkyId: SkyId;
  booting: boolean;
  deferredAssetsEnabled: boolean;
  presentation: ScenePresentation;
  gameplayInputEnabled: boolean;
  onPlayerSnapshot: (snapshot: PlayerSnapshot) => void;
  onPerfMetrics: (metrics: PerfMetrics) => void;
  onHitMarker: (kind: HitMarkerKind, damage: number, targetId: string) => void;
  onShotFired: (state: ShotFiredState) => void;
  onWeaponEquippedChange: (equipped: boolean) => void;
  onActiveWeaponChange: (weapon: WeaponKind) => void;
  onSniperRechamberChange: (state: SniperRechamberState) => void;
  onAimingStateChange: (state: AimingState) => void;
  onBootReady: () => void;
  characterOverride?: CharacterModelOverride;
  playerSpawnOverride?: PracticeMapDefinition["playerSpawn"];
  remotePlayers?: Array<{
    state: OnlineRealtimePlayerState;
    characterOverride: CharacterModelOverride;
  }>;
  multiplayerEnabled?: boolean;
  multiplayerLocalState?: OnlineMatchPlayerState | null;
  multiplayerLocalPose?: OnlineRealtimePlayerState | null;
  confirmedShotEvent?: OnlineShotFiredEvent | null;
  onMatchInputFrame?: (state: OnlineMatchInputFrame) => void;
  onFireIntent?: (intent: OnlineFireIntent) => void;
  onReloadIntent?: (requestId: string) => void;
  onPauseMenuToggle?: () => void;
};

function isRightHandBoneName(name: string) {
  const normalized = normalizeBoneName(name).toLowerCase();
  return normalized === "r_hand" ||
    normalized === "righthand" ||
    normalized === "right_hand" ||
    normalized === "hand_r" ||
    normalized === "hand.r" ||
    normalized.includes("r_hand") ||
    normalized.includes("right_hand") ||
    normalized.includes("righthand") ||
    normalized.includes("hand_r");
}

function clearObjectChildren(group: THREE.Group) {
  while (group.children.length > 0) {
    group.remove(group.children[0]!);
  }
}

function createRemoteRifleModel(source: THREE.Group | null) {
  const rifleGroup = new THREE.Group();
  rifleGroup.name = "remote-rifle-model";

  if (source) {
    const transform = WEAPON_MODEL_TRANSFORMS.character.rifle;
    const clone = source.clone(true);
    clone.position.set(...transform.position);
    clone.rotation.set(...transform.rotation);
    clone.scale.setScalar(transform.scale);
    rifleGroup.add(clone);
    return rifleGroup;
  }

  const rifleBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.09, 0.13),
    new THREE.MeshStandardMaterial({
      color: "#30363c",
      roughness: 0.55,
      metalness: 0.4,
    }),
  );
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.17, 0.05),
    new THREE.MeshStandardMaterial({
      color: "#4d463f",
      roughness: 0.85,
      metalness: 0.1,
    }),
  );
  grip.position.set(0.16, -0.08, 0.01);
  grip.rotation.set(0.15, 0, -0.2);
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 0.42, 8),
    new THREE.MeshStandardMaterial({
      color: "#20262b",
      roughness: 0.4,
      metalness: 0.6,
    }),
  );
  barrel.position.set(-0.24, 0.015, 0);
  barrel.rotation.set(0, 0, Math.PI / 2);

  rifleGroup.add(rifleBody, grip, barrel);
  return rifleGroup;
}

function dampAngle(current: number, target: number, blend: number) {
  const delta = Math.atan2(
    Math.sin(target - current),
    Math.cos(target - current),
  );
  return current + delta * blend;
}

function RemotePlayerAvatar({
  state,
  characterOverride,
  weaponAlignment,
}: {
  state: OnlineRealtimePlayerState;
  characterOverride: CharacterModelOverride;
  weaponAlignment: WeaponAlignmentOffset;
}) {
  const { model, setAnimState } = useCharacterModel(characterOverride);
  const weaponModels = useWeaponModels();
  const positionRef = useRef(
    new THREE.Vector3(state.x, state.y, state.z),
  );
  const targetPositionRef = useRef(
    new THREE.Vector3(state.x, state.y, state.z),
  );
  const bodyYawRef = useRef(state.bodyYaw);
  const targetBodyYawRef = useRef(state.bodyYaw);
  const rightHandBoneRef = useRef<THREE.Bone | null>(null);
  const weaponGroupRef = useRef(new THREE.Group());
  const weaponWorldPositionRef = useRef(new THREE.Vector3());
  const weaponWorldQuaternionRef = useRef(new THREE.Quaternion());

  useEffect(() => {
    targetPositionRef.current.set(state.x, state.y, state.z);
    targetBodyYawRef.current = state.bodyYaw;
    setAnimState(state.animState, {
      locomotionScale: state.locomotionScale,
      lowerBodyState: state.lowerBodyState,
      lowerBodyLocomotionScale: state.lowerBodyLocomotionScale,
      upperBodyState: state.upperBodyState,
      upperBodyLocomotionScale: state.locomotionScale,
    });
  }, [
    setAnimState,
    state.animState,
    state.bodyYaw,
    state.locomotionScale,
    state.lowerBodyLocomotionScale,
    state.lowerBodyState,
    state.upperBodyState,
    state.x,
    state.y,
    state.z,
  ]);

  useEffect(() => {
    if (!model) {
      rightHandBoneRef.current = null;
      return;
    }

    let resolved: THREE.Bone | null = null;
    model.traverse((child) => {
      if (resolved || !(child as THREE.Bone).isBone) {
        return;
      }
      const bone = child as THREE.Bone;
      if (isRightHandBoneName(bone.name)) {
        resolved = bone;
      }
    });
    rightHandBoneRef.current = resolved;
  }, [model]);

  useEffect(() => {
    const weaponGroup = weaponGroupRef.current;
    clearObjectChildren(weaponGroup);
    weaponGroup.add(createRemoteRifleModel(weaponModels.rifle));
  }, [weaponModels.rifle]);

  useFrame((_state, delta) => {
    const mixer = model?.userData.__mixer as THREE.AnimationMixer | undefined;
    if (mixer) {
      mixer.update(Math.min(delta, 1 / 20));
    }

    positionRef.current.lerp(
      targetPositionRef.current,
      1 - Math.exp(-Math.min(delta, 1 / 15) * 14),
    );
    bodyYawRef.current = dampAngle(
      bodyYawRef.current,
      targetBodyYawRef.current,
      1 - Math.exp(-Math.min(delta, 1 / 15) * 16),
    );

    if (model) {
      model.position.copy(positionRef.current);
      model.rotation.set(0, bodyYawRef.current + CHARACTER_YAW_OFFSET, 0);
      model.updateMatrixWorld(true);
    }

    const weaponGroup = weaponGroupRef.current;
    const rightHandBone = rightHandBoneRef.current;
    weaponGroup.visible = Boolean(model && state.alive && rightHandBone);
    if (!model || !state.alive || !rightHandBone) {
      return;
    }

    rightHandBone.getWorldPosition(weaponWorldPositionRef.current);
    rightHandBone.getWorldQuaternion(weaponWorldQuaternionRef.current);
    weaponGroup.position.copy(weaponWorldPositionRef.current);
    weaponGroup.quaternion.copy(weaponWorldQuaternionRef.current);
    weaponGroup.translateX(weaponAlignment.posX);
    weaponGroup.translateY(weaponAlignment.posY);
    weaponGroup.translateZ(weaponAlignment.posZ);
    weaponGroup.rotateX(weaponAlignment.rotX);
    weaponGroup.rotateY(weaponAlignment.rotY);
    weaponGroup.rotateZ(weaponAlignment.rotZ);
  });

  if (!model || !state.alive) {
    return null;
  }

  return (
    <>
      <primitive object={model} />
      <primitive object={weaponGroupRef.current} />
    </>
  );
}

function waitForAnimationFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function SceneBootCompiler({
  enabled,
  onReady,
}: {
  enabled: boolean;
  onReady: () => void;
}) {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!enabled || startedRef.current) {
      return;
    }

    let cancelled = false;
    startedRef.current = true;

    void (async () => {
      await waitForAnimationFrame();
      await waitForAnimationFrame();
      if (cancelled) {
        return;
      }

      try {
        markBootEvent("boot:scene-compile-start");
        const renderer = gl as THREE.WebGLRenderer & {
          compileAsync?: (
            scene: THREE.Scene,
            camera: THREE.Camera,
          ) => Promise<void>;
        };
        if (typeof renderer.compileAsync === "function") {
          await renderer.compileAsync(scene, camera);
        } else {
          renderer.compile(scene, camera);
        }
        markBootEvent("boot:scene-compile-end");
      } catch (error) {
        console.warn("[Scene] Warm-up compile failed", error);
        markBootEvent("boot:scene-compile-end", {
          failed: true,
        });
      }

      await waitForAnimationFrame();
      if (!cancelled) {
        onReady();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [camera, enabled, gl, onReady, scene]);

  return null;
}

function SceneFramePacer({
  lobbyCapEnabled,
  frameIntervalMs,
}: {
  lobbyCapEnabled: boolean;
  frameIntervalMs: number;
}) {
  const advance = useThree((state) => state.advance);

  useEffect(() => {
    if (!lobbyCapEnabled) return;
    let rafId: number;
    let lastTime = 0;
    const loop = (time: number) => {
      if (time - lastTime >= frameIntervalMs) {
        lastTime = time - ((time - lastTime) % frameIntervalMs);
        advance(time);
      }
      rafId = window.requestAnimationFrame(loop);
    };
    rafId = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [advance, frameIntervalMs, lobbyCapEnabled]);

  return null;
}

function SceneContextRecoveryWatcher({
  onContextLost,
}: {
  onContextLost: () => void;
}) {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const canvas = gl.domElement;
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      onContextLost();
    };

    canvas.addEventListener("webglcontextlost", handleContextLost as EventListener, {
      passive: false,
    });

    return () => {
      canvas.removeEventListener(
        "webglcontextlost",
        handleContextLost as EventListener,
      );
    };
  }, [gl, onContextLost]);

  return null;
}

export const Scene = forwardRef<SceneHandle, SceneProps>(function Scene({
  settings,
  audioVolumes,
  stressCount,
  practiceMap,
  selectedSkyId,
  booting,
  deferredAssetsEnabled,
  presentation,
  gameplayInputEnabled,
  onPlayerSnapshot,
  onPerfMetrics,
  onHitMarker,
  onShotFired,
  onWeaponEquippedChange,
  onActiveWeaponChange,
  onSniperRechamberChange,
  onAimingStateChange,
  onBootReady,
  characterOverride,
  playerSpawnOverride,
  remotePlayers = [],
  multiplayerEnabled = false,
  multiplayerLocalState,
  multiplayerLocalPose,
  confirmedShotEvent,
  onMatchInputFrame,
  onFireIntent,
  onReloadIntent,
  onPauseMenuToggle,
}: SceneProps, ref) {
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const [targets, setTargets] = useState<TargetState[]>(() =>
    clonePracticeMapTargets(practiceMap.targets),
  );
  const targetVisualRegistryRef = useRef<Map<string, TargetVisualHandle>>(
    new Map(),
  );
  const sceneTargetsRef = useRef(targets);
  const runtimeRef = useRef<GameplayRuntimeHandle | null>(null);
  const recoveringContextRef = useRef(false);
  const [runtimeAssetsReady, setRuntimeAssetsReady] = useState(false);
  sceneTargetsRef.current = targets;
  const resetTimeoutsRef = useRef<Map<string, number>>(new Map());
  const compileReady = booting && runtimeAssetsReady;
  const lobbyFrameCapEnabled = presentation.phase !== "playing";
  const frameIntervalMs = presentation.phase === "menu"
    ? MENU_FRAME_INTERVAL_MS
    : TRANSITION_FRAME_INTERVAL_MS;
  const [glbCollisionVolumes, setGlbCollisionVolumes] = useState<readonly BlockingVolume[]>([]);

  const handleCollisionReady = useCallback((volumes: readonly BlockingVolume[]) => {
    setGlbCollisionVolumes(volumes);
  }, []);

  useEffect(() => {
    setGlbCollisionVolumes([]);
  }, [practiceMap.id]);

  const runtimePracticeMap = useMemo<PracticeMapDefinition>(() => {
    if (
      practiceMap.environment.kind !== "school-glb" ||
      glbCollisionVolumes.length === 0
    ) {
      return practiceMap;
    }
    return {
      ...practiceMap,
      blockingVolumes: [
        ...(practiceMap.blockingVolumes ?? []),
        ...glbCollisionVolumes,
      ],
    };
  }, [practiceMap, glbCollisionVolumes]);

  const renderedPracticeMap = !booting && presentation.phase === "playing"
    ? practiceMap
    : RANGE_PRACTICE_MAP;
  const paceEnabled = lobbyFrameCapEnabled;
  const showSkyBackdrop = true;
  const selectedSky = useMemo(() => getSkyById(selectedSkyId), [selectedSkyId]);
  const selectedSkyAssetUrl = selectedSky.assetUrl;
  const selectedSkyTheme = selectedSky.environmentTheme;
  const useRangeTheme = renderedPracticeMap.id === RANGE_PRACTICE_MAP.id;

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
  const rangeThemeBlend = clamp01(presentation.worldTheme);
  const floorGridOpacity = presentation.phase === "menu"
    ? 0
    : presentation.phase === "entering"
    ? 0.14 * (1 - clamp01(phaseProgress / 0.28))
    : presentation.phase === "returning"
    ? 0.14 * clamp01((phaseProgress - 0.72) / 0.16)
    : 0;
  const rangeLighting = useMemo(
    () =>
      blendLightingPresets(
        selectedSkyTheme.lighting.menu,
        selectedSkyTheme.lighting.gameplay,
        rangeThemeBlend,
      ),
    [rangeThemeBlend, selectedSkyTheme],
  );
  const backgroundColor = useRangeTheme
    ? rangeLighting.background
    : blendColor(VOID_BG, LIVE_BG, worldTheme);
  const fogColor = useRangeTheme
    ? rangeLighting.fog
    : blendColor(VOID_FOG, LIVE_FOG, worldTheme);
  const fogNear = useRangeTheme ? rangeLighting.fogNear : 60;
  const fogFar = useRangeTheme ? rangeLighting.fogFar : 420;
  const skyLightColor = useRangeTheme
    ? rangeLighting.skyLight
    : blendColor(VOID_SKY_LIGHT, LIVE_SKY_LIGHT, worldTheme);
  const groundLightColor = useRangeTheme
    ? rangeLighting.groundLight
    : blendColor(VOID_GROUND_LIGHT, LIVE_GROUND_LIGHT, worldTheme);
  const ambientIntensity = useRangeTheme
    ? rangeLighting.ambientIntensity
    : THREE.MathUtils.lerp(0.14, 0.5, worldTheme);
  const hemisphereIntensity = useRangeTheme
    ? rangeLighting.hemisphereIntensity
    : THREE.MathUtils.lerp(0.22, 0.95, worldTheme);
  const sunIntensity = useRangeTheme
    ? rangeLighting.sunIntensity
    : THREE.MathUtils.lerp(0.05, 0.8, worldTheme);
  const sunColor = useRangeTheme ? rangeLighting.sunColor : "#ffd2a2";
  const fillIntensity = useRangeTheme
    ? rangeLighting.fillIntensity
    : THREE.MathUtils.lerp(0.12, 0.6, worldTheme);
  const fillColor = useRangeTheme ? rangeLighting.fillColor : "#5ab8ff";
  const voidCharacterLightIntensity = useRangeTheme
    ? rangeLighting.menuKeyIntensity
    : THREE.MathUtils.lerp(4.4, 0.16, worldTheme);
  const menuKeyLightColor = useRangeTheme
    ? rangeLighting.menuKeyColor
    : MENU_KEY_LIGHT;

  const handleTargetHit = useCallback(
    (targetId: string, damage: number, nowMs: number) => {
      // No startTransition — kills must render immediately
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
          setTargets((previousTargets) =>
            previousTargets.map((target) =>
              target.id === targetId
                ? { ...target, disabled: false, hp: target.maxHp }
                : target
            ),
          );
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

  useEffect(() => {
    for (const timeoutId of resetTimeoutsRef.current.values()) {
      window.clearTimeout(timeoutId);
    }
    resetTimeoutsRef.current.clear();
    startTransition(() => {
      setTargets(clonePracticeMapTargets(practiceMap.targets));
    });
  }, [practiceMap]);

  const handleSceneContextLost = useCallback(() => {
    if (recoveringContextRef.current) {
      return;
    }
    recoveringContextRef.current = true;
    console.warn("[Scene] WebGL context lost. Rebuilding canvas.");
    window.setTimeout(() => {
      startTransition(() => {
        setCanvasEpoch((value) => value + 1);
      });
      recoveringContextRef.current = false;
    }, 120);
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
    moveInventoryItem: (request) => {
      return runtimeRef.current?.moveInventoryItem(request) ?? {
        ok: false,
        message: "Runtime unavailable.",
      };
    },
    quickMoveInventoryItem: (location) => {
      return runtimeRef.current?.quickMoveInventoryItem(location) ?? {
        ok: false,
        message: "Runtime unavailable.",
      };
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
      key={canvasEpoch}
      className="game-canvas"
      shadows={settings.shadows && worldTheme > 0.6 ? "percentage" : false}
      dpr={dpr}
      camera={CANVAS_CAMERA}
      gl={CANVAS_GL}
      frameloop={lobbyFrameCapEnabled ? "never" : "always"}
    >
      <SceneContextRecoveryWatcher onContextLost={handleSceneContextLost} />
      <SceneFramePacer
        lobbyCapEnabled={paceEnabled}
        frameIntervalMs={frameIntervalMs}
      />
      <color attach="background" args={[backgroundColor]} />
      <fog attach="fog" args={[fogColor, fogNear, fogFar]} />
      <hemisphereLight
        args={[skyLightColor, groundLightColor, hemisphereIntensity]}
      />
      <ambientLight intensity={ambientIntensity} />
      <directionalLight
        position={[24, 430, -32]}
        intensity={sunIntensity}
        color={sunColor}
        castShadow={settings.shadows && worldTheme > 0.6}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={260}
        shadow-camera-left={-90}
        shadow-camera-right={90}
        shadow-camera-top={90}
        shadow-camera-bottom={-90}
      />
      <directionalLight
        position={[-2, 3, 2]}
        intensity={fillIntensity}
        color={fillColor}
      />
      <pointLight
        position={[0.3, 2.4, 3.6]}
        intensity={voidCharacterLightIntensity}
        distance={11}
        decay={1.7}
        color={menuKeyLightColor}
      />
      <PracticeMapEnvironment
        practiceMap={renderedPracticeMap}
        shadows={settings.shadows}
        theme={worldTheme}
        floorGridOpacity={floorGridOpacity}
        onCollisionReady={handleCollisionReady}
        showSkyBackdrop={showSkyBackdrop}
        skyAssetUrl={selectedSkyAssetUrl}
        skyTheme={selectedSkyTheme}
        surfaceBlend={rangeThemeBlend}
      />
      <Targets
        targets={targets}
        shadows={settings.shadows && worldTheme > 0.6}
        reveal={presentation.targetReveal}
        loadCharacterAsset={deferredAssetsEnabled}
        characterOverride={characterOverride}
        visualRegistryRef={targetVisualRegistryRef}
      />
      <StressBoxes
        count={practiceMap.supportsStressMode ? stressCount : 0}
        shadows={settings.shadows}
      />
      {remotePlayers.map((remotePlayer) => (
        <RemotePlayerAvatar
          key={remotePlayer.state.userId}
          state={remotePlayer.state}
          characterOverride={remotePlayer.characterOverride}
          weaponAlignment={settings.weaponAlignment}
        />
      ))}
      <GameplayRuntime
        ref={runtimeRef}
        practiceMap={runtimePracticeMap}
        audioVolumes={audioVolumes}
        presentation={presentation}
        gameplayInputEnabled={gameplayInputEnabled}
        sensitivity={settings.sensitivity}
        controllerSettings={settings.controller}
        controllerBindings={settings.controllerBindings}
        keybinds={settings.keybinds}
        crouchMode={settings.crouchMode}
        inventoryOpenMode={settings.inventoryOpenMode}
        fov={settings.fov}
        weaponAlignment={settings.weaponAlignment}
        movement={settings.movement}
        weaponRecoilProfiles={settings.weaponRecoilProfiles}
        targets={targets}
        targetVisualRegistryRef={targetVisualRegistryRef}
        onTargetHit={handleTargetHit}
        onResetTargets={handleResetTargets}
        onPlayerSnapshot={onPlayerSnapshot}
        onPerfMetrics={onPerfMetrics}
        onHitMarker={onHitMarker}
        onShotFired={onShotFired}
        onWeaponEquippedChange={onWeaponEquippedChange}
        onActiveWeaponChange={onActiveWeaponChange}
        onSniperRechamberChange={onSniperRechamberChange}
        onAimingStateChange={onAimingStateChange}
        deferredAssetsEnabled={deferredAssetsEnabled}
        onCriticalAssetsReadyChange={setRuntimeAssetsReady}
        characterOverride={characterOverride}
        playerSpawnOverride={playerSpawnOverride}
        multiplayerEnabled={multiplayerEnabled}
        multiplayerLocalState={multiplayerLocalState}
        multiplayerLocalPose={multiplayerLocalPose}
        confirmedShotEvent={confirmedShotEvent}
        onMatchInputFrame={onMatchInputFrame}
        onFireIntent={onFireIntent}
        onReloadIntent={onReloadIntent}
        onPauseMenuToggle={onPauseMenuToggle}
      />
      <SceneBootCompiler enabled={compileReady} onReady={onBootReady} />
      {settings.showR3fPerf ? <Perf position="top-left" minimal /> : null}
    </Canvas>
  );
});
