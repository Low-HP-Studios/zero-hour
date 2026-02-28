import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Perf } from "r3f-perf";
import * as THREE from "three";
import { AudioManager, type AudioVolumeSettings } from "./Audio";
import { loadFbxAsset, loadFbxAnimation } from "./AssetLoader";
import { usePlayerController, type PlayerControllerApi } from "./PlayerController";
import {
  Targets,
  createDefaultTargets,
  raycastTargets,
  resetTargets,
  RESPAWN_DELAY_MS,
  type TargetRaycastHit,
} from "./Targets";
import {
  WeaponSystem,
  type SniperRechamberState,
  type WeaponKind,
  type WeaponShotEvent,
  type WeaponSwitchState,
} from "./Weapon";
import type {
  CollisionRect,
  GameSettings,
  PerfMetrics,
  PlayerSnapshot,
  StressModeCount,
  TargetState,
  WorldBounds,
} from "./types";

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

export type HitMarkerKind = "body" | "head" | "kill";
export type AimingState = {
  ads: boolean;
  firstPerson: boolean;
};

const WORLD_BOUNDS: WorldBounds = {
  minX: -80,
  maxX: 80,
  minZ: -80,
  maxZ: 80,
};
const WALKABLE_CENTER_X = (WORLD_BOUNDS.minX + WORLD_BOUNDS.maxX) / 2;
const WALKABLE_CENTER_Z = (WORLD_BOUNDS.minZ + WORLD_BOUNDS.maxZ) / 2;
const WALKABLE_SIZE_X = WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX;
const WALKABLE_SIZE_Z = WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ;
const SHORE_SHELF_PADDING = 28;
const SHORE_SHELF_Y = -0.42;
const SHORE_FOAM_RING_PADDING = 10;
const OCEAN_LEVEL_Y = -2.7;
const OCEAN_SIZE = 1600;
const CLIFF_HEIGHT = 0.7;
const CLIFF_THICKNESS = 1.15;

const BUILDING_CENTER = new THREE.Vector3(8, 0, -4);
const BUILDING_WIDTH = 10;
const BUILDING_DEPTH = 8;
const BUILDING_HEIGHT = 3.2;
const WALL_THICKNESS = 0.35;
const DOOR_GAP_WIDTH = 2.2;
const DOOR_HEIGHT = 2.2;
const TRACER_DISTANCE = 260;
const TRACER_CAMERA_START_OFFSET = 0.32;
const TRACER_MUZZLE_FORWARD_OFFSET = 0.09;
const MIN_TRACER_DISTANCE = 10;
const TARGET_FLASH_MS = 180;
const MAX_BULLET_IMPACT_MARKS = 160;
const BULLET_IMPACT_LIFETIME_MS = 5000;
const BULLET_IMPACT_CLEANUP_INTERVAL_MS = 250;
const BULLET_IMPACT_MARK_RADIUS = 0.05;
const BULLET_IMPACT_MARK_SURFACE_OFFSET = 0.01;
const MAX_BLOOD_SPLAT_MARKS = 280;
const BLOOD_SPLAT_LIFETIME_MS = 1100;
const BLOOD_SPLAT_SURFACE_OFFSET = 0.014;
const BULLET_HIT_EPSILON = 0.0001;

type BulletImpactMark = {
  id: number;
  expiresAt: number;
  position: [number, number, number];
  quaternion: [number, number, number, number];
};

type BloodSplatMark = {
  id: number;
  expiresAt: number;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  radius: number;
  opacity: number;
};

type WorldRaycastHit = {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
};

const STATIC_COLLIDERS: CollisionRect[] = [];

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
          const destroyed = newHp <= 0;
          return {
            ...target,
            hp: newHp,
            disabled: destroyed,
            hitUntil: nowMs + TARGET_FLASH_MS,
          };
        }),
      );
    });

    setTargets((prev) => {
      const target = prev.find((t) => t.id === targetId);
      if (target && target.hp - damage <= 0) {
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
      return prev;
    });
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
      camera={{ fov: 65, near: 0.1, far: 650, position: [0, 3.5, 12] }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
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

const CHARACTER_MODEL_URL = "/assets/models/character/Trooper/tactical guy.fbx";
const CHARACTER_TARGET_HEIGHT = 1.65;
const CHARACTER_YAW_OFFSET = Math.PI;
const CHARACTER_TEXTURE_BASE = "/assets/models/character/Trooper/tactical guy.fbm/";
const CHARACTER_TEXTURE_MAP: Record<string, { base: string; normal: string }> = {
  Body: { base: "Body_baseColor_0.png", normal: "Body_normal_1.png" },
  Bottom: { base: "Bottom_baseColor_2.png", normal: "Bottom_normal_3.png" },
  Glove: { base: "Glove_baseColor_4.png", normal: "Glove_normal_5.png" },
  material: { base: "material_baseColor_6.png", normal: "material_normal_7.png" },
  Mask: { base: "Mask_baseColor_8.png", normal: "Mask_normal_9.png" },
  Shoes: { base: "Shoes_baseColor_10.png", normal: "Shoes_normal_11.png" },
  material_6: { base: "material_6_baseColor_12.png", normal: "material_6_normal_13.png" },
};

const ANIM_CLIPS: { name: string; url: string }[] = [
  { name: "idle", url: "/assets/animations/walking/Idle.fbx" },
  { name: "walk", url: "/assets/animations/walking/Walk Forward.fbx" },
  { name: "walkBack", url: "/assets/animations/walking/Walk Backward.fbx" },
  { name: "walkLeft", url: "/assets/animations/walking/Walk Left.fbx" },
  { name: "walkRight", url: "/assets/animations/walking/Walk Right.fbx" },
  { name: "rifleIdle", url: "/assets/animations/walking with gun/Rifle Aim Idle.fbx" },
  { name: "rifleWalk", url: "/assets/animations/walking with gun/Rifle Aim Walk Forward Loop.fbx" },
  { name: "rifleWalkBack", url: "/assets/animations/walking with gun/Rifle Aim Walk Backward Loop.fbx" },
  { name: "rifleWalkLeft", url: "/assets/animations/walking with gun/Rifle Aim Walk Left Loop.fbx" },
  { name: "rifleWalkRight", url: "/assets/animations/walking with gun/Rifle Aim Walk Right Loop.fbx" },
];

const WEAPON_MODEL_URLS: Record<WeaponKind, string> = {
  rifle: "/assets/weapons/pack/FBX/AssaultRifle_01.fbx",
  sniper: "/assets/weapons/pack/FBX/SniperRifle_01.fbx",
};

type WeaponModelTransform = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
};

const WEAPON_MODEL_TRANSFORMS: {
  character: Record<WeaponKind, WeaponModelTransform>;
  firstPerson: Record<WeaponKind, WeaponModelTransform>;
  world: Record<WeaponKind, WeaponModelTransform>;
} = {
  character: {
    rifle: {
      position: [0.02, -0.03, 0],
      rotation: [0, -Math.PI / 2, 0],
      scale: 0.00145,
    },
    sniper: {
      position: [0.02, -0.04, 0],
      rotation: [0, -Math.PI / 2, 0],
      scale: 0.0016,
    },
  },
  firstPerson: {
    rifle: {
      position: [0.08, -0.04, 0.02],
      rotation: [0, -Math.PI / 2, 0],
      scale: 0.0015,
    },
    sniper: {
      position: [0.08, -0.05, 0.02],
      rotation: [0, -Math.PI / 2, 0],
      scale: 0.00175,
    },
  },
  world: {
    rifle: {
      position: [0, 0.02, 0],
      rotation: [0, -Math.PI / 2, 0],
      scale: 0.00145,
    },
    sniper: {
      position: [0, 0.02, 0],
      rotation: [0, -Math.PI / 2, 0],
      scale: 0.0016,
    },
  },
};

type CharacterAnimState =
  | "idle"
  | "walk"
  | "walkBack"
  | "walkLeft"
  | "walkRight"
  | "rifleIdle"
  | "rifleWalk"
  | "rifleWalkBack"
  | "rifleWalkLeft"
  | "rifleWalkRight"
  | "sprint";

type CharacterModelResult = {
  model: THREE.Group | null;
  setAnimState: (state: CharacterAnimState) => void;
};

type WeaponModelResult = {
  rifle: THREE.Group | null;
  sniper: THREE.Group | null;
};

const WALK_ANIM_TIME_SCALE = 1.18;
const SPRINT_ANIM_TIME_SCALE = 1.9;
const BASE_FOOTSTEP_INTERVAL_SECONDS = 0.566;

function resolveCharacterAnimTimeScale(state: CharacterAnimState): number {
  if (state === "sprint") {
    return SPRINT_ANIM_TIME_SCALE;
  }
  if (state === "idle" || state === "rifleIdle") {
    return 1;
  }
  return WALK_ANIM_TIME_SCALE;
}

function resolveFootstepIntervalSeconds(state: CharacterAnimState): number {
  const animTimeScale = resolveCharacterAnimTimeScale(state);
  return BASE_FOOTSTEP_INTERVAL_SECONDS / Math.max(0.1, animTimeScale);
}

function resolveFootstepPlaybackRate(state: CharacterAnimState): number {
  if (state === "sprint") {
    return 1.22;
  }
  if (state === "walkBack" || state === "rifleWalkBack") {
    return 0.92;
  }
  if (
    state === "walkLeft" ||
    state === "walkRight" ||
    state === "rifleWalkLeft" ||
    state === "rifleWalkRight"
  ) {
    return 1.06;
  }
  return 1;
}

function useCharacterModel(): CharacterModelResult {
  const [model, setModel] = useState<THREE.Group | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Map<string, THREE.AnimationAction>>(new Map());
  const currentAnimRef = useRef<string>("");

  useEffect(() => {
    let disposed = false;

    (async () => {
      const [fbxModel, SkeletonUtils, ...clips] = await Promise.all([
        loadFbxAsset(CHARACTER_MODEL_URL),
        import("three/examples/jsm/utils/SkeletonUtils.js"),
        ...ANIM_CLIPS.map((a) => loadFbxAnimation(a.url, a.name)),
      ]);

      if (disposed || !fbxModel) return;

      const clone = SkeletonUtils.clone(fbxModel) as THREE.Group;

      const box = new THREE.Box3().setFromObject(clone);
      const size = new THREE.Vector3();
      box.getSize(size);
      const scale = size.y > 0 ? CHARACTER_TARGET_HEIGHT / size.y : 1;
      clone.scale.setScalar(scale);

      const scaledBox = new THREE.Box3().setFromObject(clone);
      clone.position.y = -scaledBox.min.y;

      clone.traverse((child) => {
        if (!(child as THREE.Mesh).isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
      });

      await applyCharacterTextures(clone);

      const modelBoneNames = new Set<string>();
      clone.traverse((child) => {
        if ((child as THREE.Bone).isBone || (child as THREE.SkinnedMesh).isSkinnedMesh) {
          modelBoneNames.add(child.name);
        }
      });

      const mixer = new THREE.AnimationMixer(clone);
      mixerRef.current = mixer;
      clone.userData.__mixer = mixer;

      const actions = new Map<string, THREE.AnimationAction>();
      for (let i = 0; i < ANIM_CLIPS.length; i++) {
        const clip = clips[i];
        if (!clip) continue;
        const remapped = remapAnimationClip(clip, modelBoneNames).clone();
        removeRootMotion(remapped);
        const totalTracks = remapped.tracks.length;
        remapped.tracks = remapped.tracks.filter((track) => {
          const boneName = splitTrackName(track.name).nodeName;
          return modelBoneNames.has(boneName);
        });
        console.log(
          `[Character] ${ANIM_CLIPS[i].name}: dur=${remapped.duration.toFixed(3)}s, ${totalTracks} tracks -> ${remapped.tracks.length} matched`,
        );
        const action = mixer.clipAction(remapped);
        action.setLoop(THREE.LoopRepeat, Infinity);
        actions.set(ANIM_CLIPS[i].name, action);
      }
      actionsRef.current = actions;

      const idleAction = actions.get("idle");
      if (idleAction) {
        idleAction.play();
        currentAnimRef.current = "idle";
      }

      console.log("[Character] Model bones:", [...modelBoneNames]);
      console.log("[Character] Loaded animations:", [...actions.keys()]);
      if (clips[0]) {
        console.log("[Character] Sample track names:", clips[0].tracks.slice(0, 3).map((t) => t.name));
      }

      setModel(clone);
    })();

    return () => {
      disposed = true;
      mixerRef.current?.stopAllAction();
    };
  }, []);

  const setAnimState = useCallback((state: CharacterAnimState) => {
    const targetName = state === "sprint" ? "walk" : state;
    const targetSpeed = resolveCharacterAnimTimeScale(state);
    const stateKey = state;

    if (currentAnimRef.current === stateKey) return;

    const actions = actionsRef.current;
    const target = actions.get(targetName);
    if (!target) return;

    const prevKey = currentAnimRef.current;
    const prevName = prevKey === "sprint" ? "walk" : prevKey;
    const prev = actions.get(prevName);

    if (prev && prev !== target) {
      prev.fadeOut(0.25);
    }

    target.timeScale = targetSpeed;
    if (prev !== target) {
      target.reset().fadeIn(0.25).play();
    } else {
      target.timeScale = targetSpeed;
    }
    currentAnimRef.current = stateKey;
  }, []);

  return { model, setAnimState };
}

function useWeaponModels(): WeaponModelResult {
  const [models, setModels] = useState<WeaponModelResult>({
    rifle: null,
    sniper: null,
  });

  useEffect(() => {
    let disposed = false;

    (async () => {
      const [rifle, sniper] = await Promise.all([
        loadFbxAsset(WEAPON_MODEL_URLS.rifle),
        loadFbxAsset(WEAPON_MODEL_URLS.sniper),
      ]);
      if (disposed) return;

      setModels({
        rifle,
        sniper,
      });
    })();

    return () => {
      disposed = true;
    };
  }, []);

  return models;
}

function cloneWeaponModel(source: THREE.Group | null): THREE.Group | null {
  if (!source) return null;

  const clone = source.clone(true);
  clone.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mesh.material = materials.map((material) => material.clone());
  });
  return clone;
}

type WeaponModelInstanceProps = {
  source: THREE.Group | null;
  transform: WeaponModelTransform;
};

function WeaponModelInstance({ source, transform }: WeaponModelInstanceProps) {
  const instance = useMemo(() => cloneWeaponModel(source), [source]);
  if (!instance) return null;

  return (
    <group
      position={transform.position}
      rotation={transform.rotation}
      scale={[transform.scale, transform.scale, transform.scale]}
    >
      <primitive object={instance} />
    </group>
  );
}

function normalizeBoneName(name: string): string {
  return name
    .replace(/^mixamorig:/, "")
    .replace(/^characters3d\.?com___/, "")
    .replace(/^mixamorig_/, "");
}

function splitTrackName(trackName: string): { nodeName: string; property: string } {
  // FBX rigs can include "." inside bone names (e.g. characters3d.com___Hips).
  // Track bindings still use the final "." to separate node path from property.
  const dotIdx = trackName.lastIndexOf(".");
  if (dotIdx <= 0) {
    return { nodeName: trackName, property: "" };
  }
  return {
    nodeName: trackName.substring(0, dotIdx),
    property: trackName.substring(dotIdx),
  };
}

function remapAnimationClip(
  clip: THREE.AnimationClip,
  modelBoneNames: Set<string>,
): THREE.AnimationClip {
  const firstTrack = clip.tracks[0];
  if (!firstTrack) return clip;

  const firstBone = splitTrackName(firstTrack.name).nodeName;
  if (modelBoneNames.has(firstBone)) return clip;

  const normalizedModelMap = new Map<string, string>();
  for (const bone of modelBoneNames) {
    normalizedModelMap.set(normalizeBoneName(bone).toLowerCase(), bone);
  }

  const buildMapping = (): Map<string, string> | null => {
    const mapping = new Map<string, string>();

    const clipBones = new Set<string>();
    for (const track of clip.tracks) {
      clipBones.add(splitTrackName(track.name).nodeName);
    }

    for (const clipBone of clipBones) {
      if (modelBoneNames.has(clipBone)) {
        mapping.set(clipBone, clipBone);
        continue;
      }

      const normalized = normalizeBoneName(clipBone).toLowerCase();
      const normalMatch = normalizedModelMap.get(normalized);
      if (normalMatch) {
        mapping.set(clipBone, normalMatch);
        continue;
      }

      for (const modelBone of modelBoneNames) {
        if (modelBone.toLowerCase() === clipBone.toLowerCase()) {
          mapping.set(clipBone, modelBone);
          break;
        }
      }
    }

    return mapping.size > 0 ? mapping : null;
  };

  const mapping = buildMapping();
  if (!mapping) {
    console.warn("[Character] Could not remap clip:", clip.name);
    return clip;
  }

  const remapped = clip.clone();
  for (const track of remapped.tracks) {
    const { nodeName: boneName, property } = splitTrackName(track.name);
    const mapped = mapping.get(boneName);
    if (mapped && property) {
      track.name = mapped + property;
    }
  }
  return remapped;
}

function removeRootMotion(clip: THREE.AnimationClip): void {
  for (const track of clip.tracks) {
    const { nodeName, property } = splitTrackName(track.name);
    if (property !== ".position") continue;

    const normalized = normalizeBoneName(nodeName).toLowerCase();
    if (!normalized.includes("hips")) continue;

    const values = track.values;
    if (values.length < 3) continue;

    const baseX = values[0];
    const baseZ = values[2];
    for (let i = 0; i < values.length; i += 3) {
      values[i] = baseX;
      values[i + 2] = baseZ;
    }
  }
}

async function applyCharacterTextures(model: THREE.Group): Promise<void> {
  const textureLoader = new THREE.TextureLoader();
  const loadTex = (url: string): Promise<THREE.Texture | null> =>
    new Promise((resolve) => {
      const encoded = encodeURI(url);
      textureLoader.load(encoded, resolve, undefined, () => {
        console.warn("[Character] Texture load failed:", encoded);
        resolve(null);
      });
    });

  const uniqueMaterials = new Map<string, THREE.Material>();
  model.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      uniqueMaterials.set(mat.uuid, mat);
    }
  });

  await Promise.all(
    [...uniqueMaterials.values()].map(async (mat) => {
      const mappable = mat as THREE.MeshPhongMaterial;
      if (!("map" in mappable)) return;

      const entry = findTextureEntry(mat.name);
      if (!entry) return;

      const [baseTex, normalTex] = await Promise.all([
        mappable.map ? null : loadTex(CHARACTER_TEXTURE_BASE + entry.base),
        mappable.normalMap ? null : loadTex(CHARACTER_TEXTURE_BASE + entry.normal),
      ]);

      if (baseTex) {
        baseTex.colorSpace = THREE.SRGBColorSpace;
        mappable.map = baseTex;
      }
      if (normalTex) {
        mappable.normalMap = normalTex;
      }
      mappable.needsUpdate = true;
    }),
  );
}

function findTextureEntry(materialName: string): { base: string; normal: string } | null {
  if (CHARACTER_TEXTURE_MAP[materialName]) return CHARACTER_TEXTURE_MAP[materialName];
  const lower = materialName.toLowerCase();
  for (const [key, value] of Object.entries(CHARACTER_TEXTURE_MAP)) {
    if (key.toLowerCase() === lower) return value;
    if (lower.includes(key.toLowerCase())) return value;
  }
  return null;
}

type GameplayRuntimeProps = {
  collisionRects: CollisionRect[];
  worldBounds: WorldBounds;
  audioVolumes: AudioVolumeSettings;
  resumePointerLockRequestId: number;
  sensitivity: GameSettings["sensitivity"];
  keybinds: GameSettings["keybinds"];
  targets: TargetState[];
  onTargetHit: (targetId: string, damage: number, nowMs: number) => void;
  onResetTargets: () => void;
  onPlayerSnapshot: (snapshot: PlayerSnapshot) => void;
  onPerfMetrics: (metrics: PerfMetrics) => void;
  onHitMarker: (kind: HitMarkerKind) => void;
  onWeaponEquippedChange: (equipped: boolean) => void;
  onActiveWeaponChange: (weapon: WeaponKind) => void;
  onSniperRechamberChange: (state: SniperRechamberState) => void;
  onAimingStateChange: (state: AimingState) => void;
};

function GameplayRuntime({
  collisionRects,
  worldBounds,
  audioVolumes,
  resumePointerLockRequestId,
  sensitivity,
  keybinds,
  targets,
  onTargetHit,
  onResetTargets,
  onPlayerSnapshot,
  onPerfMetrics,
  onHitMarker,
  onWeaponEquippedChange,
  onActiveWeaponChange,
  onSniperRechamberChange,
  onAimingStateChange,
}: GameplayRuntimeProps) {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);

  const { model: characterModel, setAnimState: setCharacterAnim } = useCharacterModel();
  const weaponModels = useWeaponModels();
  const weaponRef = useRef<WeaponSystem>(new WeaponSystem());
  const audioRef = useRef<AudioManager>(new AudioManager());
  const controllerRef = useRef<PlayerControllerApi | null>(null);
  const targetsRef = useRef(targets);
  const [impactMarks, setImpactMarks] = useState<BulletImpactMark[]>([]);
  const [bloodSplats, setBloodSplats] = useState<BloodSplatMark[]>([]);

  const playerSnapshotCallbackRef = useRef(onPlayerSnapshot);
  const perfCallbackRef = useRef(onPerfMetrics);
  const targetHitCallbackRef = useRef(onTargetHit);
  const resetTargetsCallbackRef = useRef(onResetTargets);
  const hitMarkerCallbackRef = useRef(onHitMarker);
  const weaponEquippedCallbackRef = useRef(onWeaponEquippedChange);
  const activeWeaponCallbackRef = useRef(onActiveWeaponChange);
  const sniperRechamberCallbackRef = useRef(onSniperRechamberChange);
  const aimingStateCallbackRef = useRef(onAimingStateChange);

  const perfAccumulatorRef = useRef(0);
  const fpsFrameCountRef = useRef(0);
  const fpsTimeRef = useRef(0);
  const lastWeaponEquippedRef = useRef<boolean | null>(null);
  const lastActiveWeaponRef = useRef<WeaponKind | null>(null);
  const lastADSRef = useRef<boolean | null>(null);
  const lastFirstPersonRef = useRef<boolean | null>(null);

  const worldGunRef = useRef<THREE.Group>(null);
  const worldRifleModelRef = useRef<THREE.Group>(null);
  const worldSniperModelRef = useRef<THREE.Group>(null);
  const playerCharacterRef = useRef<THREE.Group>(null);
  const characterWeaponRef = useRef<THREE.Group>(null);
  const characterRifleModelRef = useRef<THREE.Group>(null);
  const characterSniperModelRef = useRef<THREE.Group>(null);
  const characterMuzzleRef = useRef<THREE.Mesh>(null);
  const firstPersonWeaponRef = useRef<THREE.Group>(null);
  const firstPersonRifleModelRef = useRef<THREE.Group>(null);
  const firstPersonSniperModelRef = useRef<THREE.Group>(null);
  const firstPersonMuzzleRef = useRef<THREE.Mesh>(null);
  const tracerRef = useRef<THREE.Mesh>(null);

  const tempEndRef = useRef(new THREE.Vector3());
  const tempMidRef = useRef(new THREE.Vector3());
  const tempTracerDirRef = useRef(new THREE.Vector3());
  const tempLookDirRef = useRef(new THREE.Vector3());
  const tempTracerOriginRef = useRef(new THREE.Vector3());
  const tempImpactNormalRef = useRef(new THREE.Vector3());
  const tempImpactNormalMatrixRef = useRef(new THREE.Matrix3());
  const tempImpactQuaternionRef = useRef(new THREE.Quaternion());
  const tempImpactPositionRef = useRef(new THREE.Vector3());
  const tempBloodTangentRef = useRef(new THREE.Vector3());
  const tempBloodBitangentRef = useRef(new THREE.Vector3());
  const tempBloodSpreadOffsetRef = useRef(new THREE.Vector3());
  const tempBloodRollQuaternionRef = useRef(new THREE.Quaternion());
  const tempCameraForwardRef = useRef(new THREE.Vector3());
  const tempCameraRightRef = useRef(new THREE.Vector3());
  const tempCameraUpRef = useRef(new THREE.Vector3());
  const raycasterRef = useRef(new THREE.Raycaster());
  const impactIdRef = useRef(0);
  const bloodSplatIdRef = useRef(0);
  const lastImpactCleanupAtRef = useRef(0);
  const lastSniperRechamberActiveRef = useRef<boolean | null>(null);
  const lastSniperRechamberProgressStepRef = useRef(-1);
  const characterWeaponAttachBoneRef = useRef<THREE.Bone | null>(null);
  const tempCharacterWeaponAnchorWorldRef = useRef(new THREE.Vector3());
  const tempCharacterWeaponAnchorLocalRef = useRef(new THREE.Vector3());

  useEffect(() => {
    targetsRef.current = targets;
  }, [targets]);

  useEffect(() => {
    playerSnapshotCallbackRef.current = onPlayerSnapshot;
  }, [onPlayerSnapshot]);

  useEffect(() => {
    perfCallbackRef.current = onPerfMetrics;
  }, [onPerfMetrics]);

  useEffect(() => {
    targetHitCallbackRef.current = onTargetHit;
  }, [onTargetHit]);

  useEffect(() => {
    resetTargetsCallbackRef.current = onResetTargets;
  }, [onResetTargets]);

  useEffect(() => {
    hitMarkerCallbackRef.current = onHitMarker;
  }, [onHitMarker]);

  useEffect(() => {
    weaponEquippedCallbackRef.current = onWeaponEquippedChange;
  }, [onWeaponEquippedChange]);

  useEffect(() => {
    activeWeaponCallbackRef.current = onActiveWeaponChange;
  }, [onActiveWeaponChange]);

  useEffect(() => {
    sniperRechamberCallbackRef.current = onSniperRechamberChange;
  }, [onSniperRechamberChange]);

  useEffect(() => {
    aimingStateCallbackRef.current = onAimingStateChange;
  }, [onAimingStateChange]);

  useEffect(() => {
    if (!characterModel) {
      characterWeaponAttachBoneRef.current = null;
      return;
    }

    let rightHandBone: THREE.Bone | null = null;
    characterModel.traverse((child) => {
      if (rightHandBone || !(child as THREE.Bone).isBone) return;
      const bone = child as THREE.Bone;
      const normalized = normalizeBoneName(bone.name).toLowerCase();
      if (
        normalized === "r_hand" ||
        normalized.includes("r_hand") ||
        normalized.includes("right_hand") ||
        normalized.includes("righthand")
      ) {
        rightHandBone = bone;
      }
    });

    characterWeaponAttachBoneRef.current = rightHandBone;
    if (!rightHandBone) {
      console.warn("[Character] Could not find right-hand bone for weapon attach");
    }
  }, [characterModel]);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio.dispose();
    };
  }, []);

  useEffect(() => {
    audioRef.current.setVolumes(audioVolumes);
  }, [audioVolumes]);

  const pushImpactMark = useCallback((point: THREE.Vector3, normal: THREE.Vector3) => {
    const safeNormal = tempImpactNormalRef.current;
    safeNormal.copy(normal);
    if (safeNormal.lengthSq() < 1e-6) {
      safeNormal.set(0, 1, 0);
    } else {
      safeNormal.normalize();
    }

    const position = tempImpactPositionRef.current
      .copy(point)
      .addScaledVector(safeNormal, BULLET_IMPACT_MARK_SURFACE_OFFSET);
    const quaternion = tempImpactQuaternionRef.current.setFromUnitVectors(Z_AXIS, safeNormal);
    const nowMs = performance.now();
    const nextMark: BulletImpactMark = {
      id: impactIdRef.current,
      expiresAt: nowMs + BULLET_IMPACT_LIFETIME_MS,
      position: [position.x, position.y, position.z],
      quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    };
    impactIdRef.current += 1;

    startTransition(() => {
      setImpactMarks((previous) => {
        const alive = previous.filter((mark) => mark.expiresAt > nowMs);
        if (alive.length >= MAX_BULLET_IMPACT_MARKS) {
          return [...alive.slice(1), nextMark];
        }
        return [...alive, nextMark];
      });
    });
  }, []);

  const pushBloodSpray = useCallback((point: THREE.Vector3, normal: THREE.Vector3, hitType: "body" | "head") => {
    const safeNormal = tempImpactNormalRef.current;
    safeNormal.copy(normal);
    if (safeNormal.lengthSq() < 1e-6) {
      safeNormal.set(0, 1, 0);
    } else {
      safeNormal.normalize();
    }

    const tangent = tempBloodTangentRef.current;
    tangent.set(Math.abs(safeNormal.y) > 0.9 ? 1 : 0, Math.abs(safeNormal.y) > 0.9 ? 0 : 1, 0);
    tangent.cross(safeNormal).normalize();
    const bitangent = tempBloodBitangentRef.current.copy(safeNormal).cross(tangent).normalize();

    const nowMs = performance.now();
    const splatCount = hitType === "head" ? 9 : 6;
    const spread = hitType === "head" ? 0.2 : 0.13;
    const lifetimeMs = hitType === "head" ? BLOOD_SPLAT_LIFETIME_MS + 220 : BLOOD_SPLAT_LIFETIME_MS;
    const nextSplats: BloodSplatMark[] = [];

    for (let i = 0; i < splatCount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radial = (0.018 + Math.random() * spread) * (0.55 + Math.random() * 0.65);
      const offset = tempBloodSpreadOffsetRef.current
        .copy(tangent)
        .multiplyScalar(Math.cos(angle) * radial)
        .addScaledVector(bitangent, Math.sin(angle) * radial)
        .addScaledVector(safeNormal, BLOOD_SPLAT_SURFACE_OFFSET + Math.random() * 0.012);

      const position = tempImpactPositionRef.current.copy(point).add(offset);
      const quaternion = tempImpactQuaternionRef.current.setFromUnitVectors(Z_AXIS, safeNormal);
      tempBloodRollQuaternionRef.current.setFromAxisAngle(safeNormal, (Math.random() - 0.5) * Math.PI);
      quaternion.multiply(tempBloodRollQuaternionRef.current);

      nextSplats.push({
        id: bloodSplatIdRef.current,
        expiresAt: nowMs + lifetimeMs + Math.random() * 140,
        position: [position.x, position.y, position.z],
        quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
        radius: (hitType === "head" ? 0.065 : 0.05) * (0.5 + Math.random() * 0.9),
        opacity: hitType === "head" ? 0.92 - Math.random() * 0.2 : 0.8 - Math.random() * 0.2,
      });
      bloodSplatIdRef.current += 1;
    }

    startTransition(() => {
      setBloodSplats((previous) => {
        const alive = previous.filter((splat) => splat.expiresAt > nowMs);
        const merged = [...alive, ...nextSplats];
        if (merged.length > MAX_BLOOD_SPLAT_MARKS) {
          return merged.slice(merged.length - MAX_BLOOD_SPLAT_MARKS);
        }
        return merged;
      });
    });
  }, []);

  const controller = usePlayerController({
    collisionRects,
    worldBounds,
    sensitivity,
    keybinds,
    onAction: (action) => {
      const weapon = weaponRef.current;
      if (action === "equipRifle") {
        weapon.switchWeapon("rifle", performance.now());
        return;
      }
      if (action === "equipSniper") {
        weapon.switchWeapon("sniper", performance.now());
        return;
      }
      if (action === "reset") {
        resetTargetsCallbackRef.current();
        return;
      }

      const playerPosition = controllerRef.current?.getPosition();
      if (!playerPosition) {
        return;
      }

      if (action === "pickup") {
        if (weapon.tryPickup(playerPosition)) {
          weaponEquippedCallbackRef.current(true);
        }
        return;
      }

      if (action === "drop") {
        camera.getWorldDirection(tempLookDirRef.current);
        if (weapon.drop(playerPosition, tempLookDirRef.current)) {
          weaponEquippedCallbackRef.current(false);
        }
        return;
      }

    },
    onPlayerSnapshot: (snapshot) => {
      const playerPosition = controllerRef.current?.getPosition();
      const canInteract = playerPosition
        ? weaponRef.current.canPickup(playerPosition)
        : false;
      playerSnapshotCallbackRef.current({
        ...snapshot,
        canInteract,
      });
    },
    onTriggerChange: (firing) => {
      weaponRef.current.setTriggerHeld(firing);
    },
    onUserGesture: () => {
      audioRef.current.ensureStarted();
    },
    getActiveWeapon: () => weaponRef.current.getActiveWeapon(),
  });

  controllerRef.current = controller;

  useEffect(() => {
    if (resumePointerLockRequestId <= 0) {
      return;
    }
    controllerRef.current?.requestPointerLock();
  }, [resumePointerLockRequestId]);

  useFrame((_, delta) => {
    const clampedDelta = Math.min(delta, 1 / 20);
    const nowMs = performance.now();
    const weapon = weaponRef.current;
    const audio = audioRef.current;

    if (nowMs - lastImpactCleanupAtRef.current >= BULLET_IMPACT_CLEANUP_INTERVAL_MS) {
      lastImpactCleanupAtRef.current = nowMs;
      setImpactMarks((previous) => {
        const alive = previous.filter((mark) => mark.expiresAt > nowMs);
        return alive.length === previous.length ? previous : alive;
      });
      setBloodSplats((previous) => {
        const alive = previous.filter((splat) => splat.expiresAt > nowMs);
        return alive.length === previous.length ? previous : alive;
      });
    }

    const sniperRechamber = weapon.getSniperRechamberState(nowMs);
    const sniperRechamberProgressStep = Math.floor(sniperRechamber.progress * 100);
    const previousSniperRechamberActive = lastSniperRechamberActiveRef.current;
    if (
      previousSniperRechamberActive !== sniperRechamber.active ||
      lastSniperRechamberProgressStepRef.current !== sniperRechamberProgressStep
    ) {
      lastSniperRechamberActiveRef.current = sniperRechamber.active;
      lastSniperRechamberProgressStepRef.current = sniperRechamberProgressStep;
      sniperRechamberCallbackRef.current(sniperRechamber);
      if (!previousSniperRechamberActive && sniperRechamber.active && weapon.getActiveWeapon() === "sniper") {
        audio.playSniperShelling();
      }
    }

    const moving = controller.isMoving() && controller.isGrounded();
    const sprinting = controller.isSprinting();
    const weaponEquipped = weapon.isEquipped();
    const moveInput = controller.getMoveInput();
    const moveX = moveInput.x;
    const moveY = moveInput.y;
    const hasDirectionalInput = Math.abs(moveX) > 0.05 || Math.abs(moveY) > 0.05;
    const movementActive = moving && hasDirectionalInput;

    let nextAnimState: CharacterAnimState = weaponEquipped ? "rifleIdle" : "idle";
    if (movementActive) {
      if (!weaponEquipped && sprinting && moveY > 0.2 && Math.abs(moveX) < 0.35) {
        nextAnimState = "sprint";
      } else if (Math.abs(moveY) >= Math.abs(moveX)) {
        if (moveY >= 0) {
          nextAnimState = weaponEquipped ? "rifleWalk" : "walk";
        } else {
          nextAnimState = weaponEquipped ? "rifleWalkBack" : "walkBack";
        }
      } else if (moveX >= 0) {
        nextAnimState = weaponEquipped ? "rifleWalkRight" : "walkRight";
      } else {
        nextAnimState = weaponEquipped ? "rifleWalkLeft" : "walkLeft";
      }
    }

    setCharacterAnim(nextAnimState);
    audio.update(nowMs / 1000, movementActive, nextAnimState === "sprint", {
      stepIntervalSeconds: resolveFootstepIntervalSeconds(nextAnimState),
      filePlaybackRate: resolveFootstepPlaybackRate(nextAnimState),
    });

    const firstPerson = controller.isFirstPerson();
    const adsActive = controller.isADS();
    if (
      lastADSRef.current !== adsActive ||
      lastFirstPersonRef.current !== firstPerson
    ) {
      lastADSRef.current = adsActive;
      lastFirstPersonRef.current = firstPerson;
      aimingStateCallbackRef.current({
        ads: adsActive,
        firstPerson,
      });
    }

    const playerChar = playerCharacterRef.current;
    if (playerChar) {
      const pos = controller.getPosition();
      playerChar.position.set(pos.x, pos.y, pos.z);
      playerChar.rotation.y = controller.getYaw() + CHARACTER_YAW_OFFSET;
      playerChar.visible = !firstPerson;
      playerChar.updateMatrixWorld(true);
    }

    if (characterModel) {
      const mixer = characterModel.userData.__mixer as THREE.AnimationMixer | undefined;
      if (mixer) {
        mixer.update(clampedDelta);
      }
    }

    const switchState = weapon.getSwitchState(nowMs);
    const characterWeaponAnchor = (() => {
      const player = playerCharacterRef.current;
      const handBone = characterWeaponAttachBoneRef.current;
      if (!player || !handBone) return null;
      handBone.getWorldPosition(tempCharacterWeaponAnchorWorldRef.current);
      tempCharacterWeaponAnchorLocalRef.current.copy(tempCharacterWeaponAnchorWorldRef.current);
      player.worldToLocal(tempCharacterWeaponAnchorLocalRef.current);
      return tempCharacterWeaponAnchorLocalRef.current;
    })();
    updateCharacterWeaponMesh(
      characterWeaponRef.current,
      characterRifleModelRef.current,
      characterSniperModelRef.current,
      characterMuzzleRef.current,
      weapon,
      nowMs,
      switchState,
      characterWeaponAnchor,
    );
    updateFirstPersonWeaponMesh(
      firstPersonWeaponRef.current,
      firstPersonRifleModelRef.current,
      firstPersonSniperModelRef.current,
      firstPersonMuzzleRef.current,
      weapon,
      nowMs,
      camera,
      firstPerson,
      adsActive,
      switchState,
      tempCameraForwardRef.current,
      tempCameraRightRef.current,
      tempCameraUpRef.current,
    );

    const shots = weapon.update(clampedDelta, nowMs, camera);
    for (const shot of shots) {
      audio.playGunshot(shot.weaponType);
      // Keep hit-registration debugging deterministic for now (no recoil kick applied to camera).
      if (shot.recoilPitchRadians !== 0 || shot.recoilYawRadians !== 0) {
        controller.addRecoil(shot.recoilPitchRadians, shot.recoilYawRadians);
      }

      const targetHit = raycastTargets(shot.origin, shot.direction, targetsRef.current);
      const worldHit = raycastBulletWorld(
        scene,
        shot.origin,
        shot.direction,
        raycasterRef.current,
        tempImpactNormalRef.current,
        tempImpactNormalMatrixRef.current,
      );

      const targetVisible =
        !!targetHit &&
        (!worldHit || targetHit.distance <= worldHit.distance + BULLET_HIT_EPSILON);

      const tracerOrigin = tempTracerOriginRef.current;
      const firstPersonMuzzle = firstPersonMuzzleRef.current;
      const thirdPersonMuzzle = characterMuzzleRef.current;
      const useFirstPersonMuzzle = firstPerson && !!firstPersonMuzzle && firstPersonWeaponRef.current?.visible;
      const useThirdPersonMuzzle = !firstPerson && !!thirdPersonMuzzle && playerChar?.visible;
      if (useFirstPersonMuzzle && firstPersonMuzzle) {
        firstPersonMuzzle.getWorldPosition(tracerOrigin);
        tracerOrigin.addScaledVector(shot.direction, TRACER_MUZZLE_FORWARD_OFFSET);
      } else if (useThirdPersonMuzzle && thirdPersonMuzzle) {
        thirdPersonMuzzle.getWorldPosition(tracerOrigin);
        tracerOrigin.addScaledVector(shot.direction, TRACER_MUZZLE_FORWARD_OFFSET);
      } else {
        tracerOrigin.copy(shot.origin);
      }

      if (targetHit && targetVisible) {
        tempEndRef.current.copy(targetHit.point);
        const resolvedDamage = resolveShotDamage(shot, targetHit);
        const targetBeforeHit = targetsRef.current.find((target) => target.id === targetHit.id);
        const killed = targetBeforeHit ? targetBeforeHit.hp - resolvedDamage <= 0 : false;
        const hitType = targetHit.zone === "head" ? "head" : "body";

        pushBloodSpray(targetHit.point, targetHit.normal, hitType);
        targetHitCallbackRef.current(targetHit.id, resolvedDamage, nowMs);
        hitMarkerCallbackRef.current(killed ? "kill" : hitType);
        if (killed) {
          audio.playKill();
        }
      } else if (worldHit) {
        tempEndRef.current.copy(worldHit.point);
        pushImpactMark(worldHit.point, worldHit.normal);
      } else {
        tempEndRef.current
          .copy(shot.origin)
          .addScaledVector(shot.direction, TRACER_DISTANCE);
      }

      if (
        !useFirstPersonMuzzle &&
        !useThirdPersonMuzzle &&
        tracerOrigin.distanceToSquared(tempEndRef.current) > (TRACER_CAMERA_START_OFFSET + 0.04) ** 2
      ) {
        tracerOrigin.addScaledVector(shot.direction, TRACER_CAMERA_START_OFFSET);
      }

      const tracerDistance = tracerOrigin.distanceTo(tempEndRef.current);
      if (tracerDistance < MIN_TRACER_DISTANCE) {
        weapon.clearTracer();
        continue;
      }

      weapon.setTracer(tracerOrigin, tempEndRef.current, nowMs);
    }

    updateWorldGunMesh(
      worldGunRef.current,
      worldRifleModelRef.current,
      worldSniperModelRef.current,
      weapon,
      nowMs,
      switchState,
    );
    updateTracerMesh(tracerRef.current, weapon, nowMs, tempMidRef.current, tempTracerDirRef.current);

    const equipped = weapon.isEquipped();
    if (lastWeaponEquippedRef.current !== equipped) {
      lastWeaponEquippedRef.current = equipped;
      weaponEquippedCallbackRef.current(equipped);
    }

    const activeWeapon = weapon.getActiveWeapon();
    if (lastActiveWeaponRef.current !== activeWeapon) {
      lastActiveWeaponRef.current = activeWeapon;
      activeWeaponCallbackRef.current(activeWeapon);
    }

    perfAccumulatorRef.current += clampedDelta;
    fpsTimeRef.current += clampedDelta;
    fpsFrameCountRef.current += 1;

    if (perfAccumulatorRef.current >= 0.2) {
      const fps = fpsTimeRef.current > 0 ? fpsFrameCountRef.current / fpsTimeRef.current : 0;
      perfCallbackRef.current({
        fps,
        frameMs: clampedDelta * 1000,
        drawCalls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
      });
      perfAccumulatorRef.current = 0;
      fpsTimeRef.current = 0;
      fpsFrameCountRef.current = 0;
    }
  });

  return (
    <>
      <group ref={playerCharacterRef}>
        {characterModel ? (
          <primitive object={characterModel} />
        ) : (
          <>
            <mesh position={[0, 1.0, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.4, 0.55, 0.25]} />
              <meshStandardMaterial color="#4a6b82" roughness={0.7} metalness={0.1} />
            </mesh>
            <mesh position={[0, 1.48, 0]} castShadow receiveShadow>
              <sphereGeometry args={[0.14, 12, 12]} />
              <meshStandardMaterial color="#e8c9a4" roughness={0.85} metalness={0} />
            </mesh>
            <mesh position={[-0.1, 0.3, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.14, 0.6, 0.16]} />
              <meshStandardMaterial color="#3a4d5c" roughness={0.8} metalness={0.05} />
            </mesh>
            <mesh position={[0.1, 0.3, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.14, 0.6, 0.16]} />
              <meshStandardMaterial color="#3a4d5c" roughness={0.8} metalness={0.05} />
            </mesh>
            <mesh position={[-0.28, 0.92, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.12, 0.48, 0.12]} />
              <meshStandardMaterial color="#4a6b82" roughness={0.7} metalness={0.1} />
            </mesh>
            <mesh position={[0.28, 0.92, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.12, 0.48, 0.12]} />
              <meshStandardMaterial color="#4a6b82" roughness={0.7} metalness={0.1} />
            </mesh>
          </>
        )}

        {/* Character-held weapon */}
        <group ref={characterWeaponRef} position={[0.34, 0.82, -0.2]} visible={false}>
          <group ref={characterRifleModelRef}>
            {weaponModels.rifle ? (
              <WeaponModelInstance
                source={weaponModels.rifle}
                transform={WEAPON_MODEL_TRANSFORMS.character.rifle}
              />
            ) : (
              <>
                <mesh castShadow receiveShadow>
                  <boxGeometry args={[0.55, 0.09, 0.13]} />
                  <meshStandardMaterial color="#30363c" roughness={0.55} metalness={0.4} />
                </mesh>
                <mesh position={[0.16, -0.08, 0.01]} rotation={[0.15, 0, -0.2]}>
                  <boxGeometry args={[0.18, 0.17, 0.05]} />
                  <meshStandardMaterial color="#4d463f" roughness={0.85} metalness={0.1} />
                </mesh>
                <mesh position={[-0.24, 0.015, 0]} rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[0.015, 0.015, 0.42, 8]} />
                  <meshStandardMaterial color="#20262b" roughness={0.4} metalness={0.6} />
                </mesh>
              </>
            )}
          </group>
          <group ref={characterSniperModelRef}>
            {weaponModels.sniper ? (
              <WeaponModelInstance
                source={weaponModels.sniper}
                transform={WEAPON_MODEL_TRANSFORMS.character.sniper}
              />
            ) : (
              <>
                <mesh castShadow receiveShadow>
                  <boxGeometry args={[0.72, 0.08, 0.11]} />
                  <meshStandardMaterial color="#2a3036" roughness={0.53} metalness={0.42} />
                </mesh>
                <mesh position={[0.2, -0.07, 0.01]} rotation={[0.14, 0, -0.2]}>
                  <boxGeometry args={[0.2, 0.16, 0.05]} />
                  <meshStandardMaterial color="#4a4139" roughness={0.86} metalness={0.08} />
                </mesh>
                <mesh position={[-0.08, 0.07, 0]}>
                  <cylinderGeometry args={[0.03, 0.03, 0.28, 12]} />
                  <meshStandardMaterial color="#1d2227" roughness={0.42} metalness={0.58} />
                </mesh>
                <mesh position={[-0.34, 0.01, 0]} rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[0.014, 0.014, 0.68, 10]} />
                  <meshStandardMaterial color="#1b2025" roughness={0.45} metalness={0.62} />
                </mesh>
              </>
            )}
          </group>
          <mesh ref={characterMuzzleRef} position={[-0.44, 0.02, 0]} visible={false}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshBasicMaterial color="#ffd085" transparent opacity={0.9} />
          </mesh>
        </group>
      </group>

      {/* FPP weapon + hands */}
      <group ref={firstPersonWeaponRef} visible={false}>
        <group ref={firstPersonRifleModelRef}>
          {weaponModels.rifle ? (
            <WeaponModelInstance
              source={weaponModels.rifle}
              transform={WEAPON_MODEL_TRANSFORMS.firstPerson.rifle}
            />
          ) : (
            <>
              <mesh>
                <boxGeometry args={[0.6, 0.08, 0.1]} />
                <meshStandardMaterial color="#2e353b" roughness={0.5} metalness={0.46} />
              </mesh>
              <mesh position={[0.19, -0.08, 0.01]} rotation={[0.1, 0, -0.2]}>
                <boxGeometry args={[0.18, 0.16, 0.05]} />
                <meshStandardMaterial color="#52483f" roughness={0.84} metalness={0.1} />
              </mesh>
              <mesh position={[-0.27, 0.01, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.013, 0.013, 0.45, 8]} />
                <meshStandardMaterial color="#1f252b" roughness={0.38} metalness={0.62} />
              </mesh>
            </>
          )}
        </group>
        <group ref={firstPersonSniperModelRef}>
          {weaponModels.sniper ? (
            <WeaponModelInstance
              source={weaponModels.sniper}
              transform={WEAPON_MODEL_TRANSFORMS.firstPerson.sniper}
            />
          ) : (
            <>
              <mesh>
                <boxGeometry args={[0.82, 0.085, 0.095]} />
                <meshStandardMaterial color="#2a2f34" roughness={0.5} metalness={0.48} />
              </mesh>
              <mesh position={[0.22, -0.08, 0.01]} rotation={[0.12, 0, -0.22]}>
                <boxGeometry args={[0.2, 0.17, 0.05]} />
                <meshStandardMaterial color="#4f453a" roughness={0.86} metalness={0.09} />
              </mesh>
              <mesh position={[-0.06, 0.07, 0]}>
                <cylinderGeometry args={[0.032, 0.032, 0.3, 12]} />
                <meshStandardMaterial color="#1a2025" roughness={0.4} metalness={0.6} />
              </mesh>
              <mesh position={[-0.38, 0.01, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.013, 0.013, 0.72, 10]} />
                <meshStandardMaterial color="#1b2025" roughness={0.42} metalness={0.62} />
              </mesh>
            </>
          )}
        </group>
        <mesh ref={firstPersonMuzzleRef} position={[-0.5, 0.01, 0]} visible={false}>
          <sphereGeometry args={[0.045, 8, 8]} />
          <meshBasicMaterial color="#ffd085" transparent opacity={0.95} />
        </mesh>
      </group>

      {/* World gun (dropped state) */}
      <group ref={worldGunRef} visible>
        <group ref={worldRifleModelRef}>
          {weaponModels.rifle ? (
            <WeaponModelInstance
              source={weaponModels.rifle}
              transform={WEAPON_MODEL_TRANSFORMS.world.rifle}
            />
          ) : (
            <>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[0.7, 0.12, 0.18]} />
                <meshStandardMaterial color="#30363c" roughness={0.6} metalness={0.35} />
              </mesh>
              <mesh position={[0.22, -0.08, 0]} castShadow receiveShadow>
                <boxGeometry args={[0.22, 0.18, 0.06]} />
                <meshStandardMaterial color="#514942" roughness={0.85} metalness={0.1} />
              </mesh>
              <mesh position={[-0.22, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
                <cylinderGeometry args={[0.02, 0.02, 0.55, 10]} />
                <meshStandardMaterial color="#1e2328" roughness={0.5} metalness={0.55} />
              </mesh>
            </>
          )}
        </group>
        <group ref={worldSniperModelRef}>
          {weaponModels.sniper ? (
            <WeaponModelInstance
              source={weaponModels.sniper}
              transform={WEAPON_MODEL_TRANSFORMS.world.sniper}
            />
          ) : null}
        </group>
      </group>

      <mesh ref={tracerRef} visible={false} frustumCulled={false} renderOrder={8}>
        <boxGeometry args={[0.008, 0.008, 1]} />
        <meshBasicMaterial
          color="#ffd95f"
          transparent
          opacity={0.95}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <BloodImpactMarks impacts={bloodSplats} />
      <BulletImpactMarks impacts={impactMarks} />
    </>
  );
}

type MapEnvironmentProps = {
  shadows: boolean;
};

function MapEnvironment({ shadows }: MapEnvironmentProps) {
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

function createSkyTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }

  const width = 512;
  const height = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#7ec2ff");
  gradient.addColorStop(0.42, "#a8d7ff");
  gradient.addColorStop(0.66, "#f6b894");
  gradient.addColorStop(0.86, "#dd8b67");
  gradient.addColorStop(1, "#b7654c");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const haze = ctx.createLinearGradient(0, height * 0.62, 0, height);
  haze.addColorStop(0, "rgba(255, 228, 193, 0)");
  haze.addColorStop(1, "rgba(255, 170, 122, 0.36)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, height * 0.62, width, height * 0.38);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createSandTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  const rng = createSeededRandom(90210);
  ctx.fillStyle = "#e4cf9f";
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 2600; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const radius = 0.35 + rng() * 1.1;
    const alpha = 0.08 + rng() * 0.18;
    const tone = rng();
    const r = tone > 0.7 ? 249 : tone > 0.35 ? 232 : 196;
    const g = tone > 0.7 ? 237 : tone > 0.35 ? 212 : 175;
    const b = tone > 0.7 ? 203 : tone > 0.35 ? 178 : 141;
    ctx.beginPath();
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 42; i += 1) {
    const y = rng() * size;
    const amplitude = 2 + rng() * 4;
    const wavelength = 20 + rng() * 28;
    const phase = rng() * Math.PI * 2;
    ctx.beginPath();
    ctx.lineWidth = 1 + rng() * 1.5;
    ctx.strokeStyle = `rgba(255, 247, 225, ${0.035 + rng() * 0.05})`;

    for (let x = -8; x <= size + 8; x += 6) {
      const rippleY = y + Math.sin(x / wavelength + phase) * amplitude;
      if (x <= -8) {
        ctx.moveTo(x, rippleY);
      } else {
        ctx.lineTo(x, rippleY);
      }
    }

    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 8);
  texture.needsUpdate = true;
  return texture;
}

function createOceanTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  const rng = createSeededRandom(404);
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, "#2a5f76");
  gradient.addColorStop(0.5, "#326e84");
  gradient.addColorStop(1, "#1e4a61");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 64; i += 1) {
    const y = rng() * size;
    const amplitude = 1.5 + rng() * 4;
    const wavelength = 10 + rng() * 22;
    const phase = rng() * Math.PI * 2;
    ctx.beginPath();
    ctx.lineWidth = 1 + rng() * 1.2;
    ctx.strokeStyle = `rgba(184, 233, 246, ${0.035 + rng() * 0.05})`;

    for (let x = -8; x <= size + 8; x += 5) {
      const waveY = y + Math.sin(x / wavelength + phase) * amplitude;
      if (x <= -8) {
        ctx.moveTo(x, waveY);
      } else {
        ctx.lineTo(x, waveY);
      }
    }

    ctx.stroke();
  }

  for (let i = 0; i < 850; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const alpha = 0.02 + rng() * 0.05;
    ctx.fillStyle = `rgba(220, 250, 255, ${alpha})`;
    ctx.fillRect(x, y, 1 + rng() * 1.5, 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(16, 16);
  texture.needsUpdate = true;
  return texture;
}

function createSeededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

type CoverBlockProps = {
  position: [number, number, number];
  size: [number, number, number];
  shadows: boolean;
  color: string;
};

function CoverBlock({ position, size, shadows, color }: CoverBlockProps) {
  return (
    <mesh position={position} castShadow={shadows} receiveShadow={shadows} userData={{ bulletHittable: true }}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.86} metalness={0.08} />
    </mesh>
  );
}
void CoverBlock;

function BuildingShell({ shadows }: { shadows: boolean }) {
  const leftSouthWidth = (BUILDING_WIDTH - DOOR_GAP_WIDTH) / 2;
  const rightSouthWidth = leftSouthWidth;

  return (
    <group position={[BUILDING_CENTER.x, 0, BUILDING_CENTER.z]}>
      <mesh position={[0, 0.01, 0]} receiveShadow={shadows} userData={{ bulletHittable: true }}>
        <boxGeometry args={[BUILDING_WIDTH, 0.02, BUILDING_DEPTH]} />
        <meshStandardMaterial color="#a6a295" roughness={0.98} metalness={0} />
      </mesh>

      <mesh
        position={[-BUILDING_WIDTH / 2 + WALL_THICKNESS / 2, BUILDING_HEIGHT / 2, 0]}
        castShadow={shadows}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
      >
        <boxGeometry args={[WALL_THICKNESS, BUILDING_HEIGHT, BUILDING_DEPTH]} />
        <meshStandardMaterial color="#ddd0b7" roughness={0.82} metalness={0.03} />
      </mesh>
      <mesh
        position={[BUILDING_WIDTH / 2 - WALL_THICKNESS / 2, BUILDING_HEIGHT / 2, 0]}
        castShadow={shadows}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
      >
        <boxGeometry args={[WALL_THICKNESS, BUILDING_HEIGHT, BUILDING_DEPTH]} />
        <meshStandardMaterial color="#ddd0b7" roughness={0.82} metalness={0.03} />
      </mesh>
      <mesh
        position={[0, BUILDING_HEIGHT / 2, -BUILDING_DEPTH / 2 + WALL_THICKNESS / 2]}
        castShadow={shadows}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
      >
        <boxGeometry args={[BUILDING_WIDTH, BUILDING_HEIGHT, WALL_THICKNESS]} />
        <meshStandardMaterial color="#ddd0b7" roughness={0.82} metalness={0.03} />
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
      >
        <boxGeometry args={[leftSouthWidth, BUILDING_HEIGHT, WALL_THICKNESS]} />
        <meshStandardMaterial color="#ddd0b7" roughness={0.82} metalness={0.03} />
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
      >
        <boxGeometry args={[rightSouthWidth, BUILDING_HEIGHT, WALL_THICKNESS]} />
        <meshStandardMaterial color="#ddd0b7" roughness={0.82} metalness={0.03} />
      </mesh>

      <mesh
        position={[0, BUILDING_HEIGHT + 0.1, 0]}
        castShadow={shadows}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
      >
        <boxGeometry args={[BUILDING_WIDTH + 0.5, 0.2, BUILDING_DEPTH + 0.5]} />
        <meshStandardMaterial color="#af8868" roughness={0.86} metalness={0.04} />
      </mesh>

      <mesh
        position={[0, DOOR_HEIGHT / 2, BUILDING_DEPTH / 2 - 0.03]}
        castShadow={shadows}
        receiveShadow={shadows}
        userData={{ bulletHittable: true }}
      >
        <boxGeometry args={[DOOR_GAP_WIDTH - 0.15, DOOR_HEIGHT, 0.05]} />
        <meshStandardMaterial
          color="#8a7a66"
          roughness={0.7}
          metalness={0.12}
          transparent
          opacity={0.45}
        />
      </mesh>
    </group>
  );
}
void BuildingShell;

function StressBoxes({ count, shadows }: { count: StressModeCount; shadows: boolean }) {
  void count;
  void shadows;
  return null;
}

function BloodImpactMarks({ impacts }: { impacts: BloodSplatMark[] }) {
  if (impacts.length === 0) {
    return null;
  }

  return (
    <group>
      {impacts.map((impact) => (
        <mesh
          key={impact.id}
          position={impact.position}
          quaternion={impact.quaternion}
          renderOrder={4}
        >
          <circleGeometry args={[impact.radius, 10]} />
          <meshBasicMaterial
            color="#7c0c0c"
            transparent
            opacity={impact.opacity}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

function BulletImpactMarks({ impacts }: { impacts: BulletImpactMark[] }) {
  if (impacts.length === 0) {
    return null;
  }

  return (
    <group>
      {impacts.map((impact) => (
        <mesh
          key={impact.id}
          position={impact.position}
          quaternion={impact.quaternion}
          renderOrder={3}
        >
          <circleGeometry args={[BULLET_IMPACT_MARK_RADIUS, 10]} />
          <meshBasicMaterial color="#1f1f1f" transparent opacity={0.82} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function resolveShotDamage(shot: WeaponShotEvent, targetHit: TargetRaycastHit): number {
  if (shot.weaponType === "sniper") {
    if (targetHit.zone === "head") {
      return 200;
    }
    if (targetHit.zone === "leg") {
      return 70;
    }
    return shot.damage;
  }

  if (targetHit.zone === "head") {
    const oneShotRange = 16;
    const falloffEndRange = 58;
    const t = clamp01((targetHit.distance - oneShotRange) / (falloffEndRange - oneShotRange));
    const headDamage = THREE.MathUtils.lerp(125, 62, t);
    return Math.round(headDamage);
  }

  if (targetHit.zone === "leg") {
    return Math.max(1, Math.round(shot.damage * 0.84));
  }

  return shot.damage;
}

function updateWorldGunMesh(
  mesh: THREE.Group | null,
  rifleModel: THREE.Group | null,
  sniperModel: THREE.Group | null,
  weapon: WeaponSystem,
  nowMs: number,
  switchState: WeaponSwitchState,
) {
  if (!mesh) {
    return;
  }

  const visible = !weapon.isEquipped();
  mesh.visible = visible;
  if (!visible) {
    if (rifleModel) {
      rifleModel.visible = false;
    }
    if (sniperModel) {
      sniperModel.visible = false;
    }
    return;
  }

  const displayedWeapon = resolveDisplayedWeapon(weapon, switchState);
  if (rifleModel) {
    rifleModel.visible = displayedWeapon === "rifle";
  }
  if (sniperModel) {
    sniperModel.visible = displayedWeapon === "sniper";
  }

  const droppedPosition = weapon.getDroppedPosition();
  mesh.position.set(
    droppedPosition.x,
    droppedPosition.y + Math.sin(nowMs * 0.006) * 0.04,
    droppedPosition.z,
  );
  mesh.rotation.set(0.2, nowMs * 0.0016, 0);
}

function updateCharacterWeaponMesh(
  weaponGroup: THREE.Group | null,
  rifleModel: THREE.Group | null,
  sniperModel: THREE.Group | null,
  muzzleFlashMesh: THREE.Mesh | null,
  weapon: WeaponSystem,
  nowMs: number,
  switchState: WeaponSwitchState,
  anchorPosition: THREE.Vector3 | null,
) {
  if (!weaponGroup) {
    return;
  }

  const equipped = weapon.isEquipped();
  weaponGroup.visible = equipped;
  if (!equipped) {
    if (rifleModel) {
      rifleModel.visible = false;
    }
    if (sniperModel) {
      sniperModel.visible = false;
    }
    if (muzzleFlashMesh) {
      muzzleFlashMesh.visible = false;
    }
    return;
  }

  const displayedWeapon = resolveDisplayedWeapon(weapon, switchState);
  const switchBlend = switchState.active ? Math.sin(Math.PI * switchState.progress) : 0;
  if (anchorPosition) {
    weaponGroup.position.copy(anchorPosition);
    weaponGroup.position.x += 0.08;
    weaponGroup.position.y -= 0.05 + switchBlend * 0.08;
    weaponGroup.position.z += 0.02 + switchBlend * 0.04;
    weaponGroup.rotation.set(0.15 - switchBlend * 0.42, Math.PI * 0.45 + switchBlend * 0.05, -0.25);
  } else {
    weaponGroup.position.set(0.34, 0.82 - switchBlend * 0.18, -0.2 + switchBlend * 0.06);
    weaponGroup.rotation.set(-switchBlend * 0.42, switchBlend * 0.05, -switchBlend * 0.12);
  }

  if (rifleModel) {
    rifleModel.visible = displayedWeapon === "rifle";
  }
  if (sniperModel) {
    sniperModel.visible = displayedWeapon === "sniper";
  }

  if (muzzleFlashMesh) {
    if (displayedWeapon === "sniper") {
      muzzleFlashMesh.position.set(-0.66, 0.02, 0);
      muzzleFlashMesh.scale.setScalar(1.15);
    } else {
      muzzleFlashMesh.position.set(-0.44, 0.02, 0);
      muzzleFlashMesh.scale.setScalar(1);
    }
    muzzleFlashMesh.visible = weapon.hasMuzzleFlash(nowMs);
  }
}

function updateFirstPersonWeaponMesh(
  weaponGroup: THREE.Group | null,
  rifleModel: THREE.Group | null,
  sniperModel: THREE.Group | null,
  muzzleFlashMesh: THREE.Mesh | null,
  weapon: WeaponSystem,
  nowMs: number,
  camera: THREE.Camera,
  firstPerson: boolean,
  adsActive: boolean,
  switchState: WeaponSwitchState,
  tempForward: THREE.Vector3,
  tempRight: THREE.Vector3,
  tempUp: THREE.Vector3,
) {
  if (!weaponGroup) {
    return;
  }

  const equipped = weapon.isEquipped();
  const visible = equipped && firstPerson;
  weaponGroup.visible = visible;
  if (!visible) {
    if (rifleModel) {
      rifleModel.visible = false;
    }
    if (sniperModel) {
      sniperModel.visible = false;
    }
    if (muzzleFlashMesh) {
      muzzleFlashMesh.visible = false;
    }
    return;
  }

  const displayedWeapon = resolveDisplayedWeapon(weapon, switchState);
  const switchBlend = switchState.active ? Math.sin(Math.PI * switchState.progress) : 0;
  const adsT = adsActive ? 1 : 0;

  if (rifleModel) {
    rifleModel.visible = displayedWeapon === "rifle";
  }
  if (sniperModel) {
    sniperModel.visible = displayedWeapon === "sniper";
  }

  tempForward.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  tempUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  tempRight.crossVectors(tempForward, tempUp).normalize();

  weaponGroup.position.copy(camera.position);
  weaponGroup.position.addScaledVector(tempForward, 0.46 - adsT * 0.16);
  weaponGroup.position.addScaledVector(tempRight, 0.2 - adsT * 0.15);
  weaponGroup.position.addScaledVector(tempUp, -0.2 - adsT * 0.08 - switchBlend * 0.12);
  weaponGroup.quaternion.copy(camera.quaternion);
  weaponGroup.rotateY(Math.PI / 2);
  weaponGroup.rotateX(-0.05 - switchBlend * 0.22);
  weaponGroup.rotateZ(-0.08 + switchBlend * 0.12);
  weaponGroup.updateMatrixWorld(true);

  if (muzzleFlashMesh) {
    if (displayedWeapon === "sniper") {
      muzzleFlashMesh.position.set(-0.62, 0.02, 0);
      muzzleFlashMesh.scale.setScalar(1.2);
    } else {
      muzzleFlashMesh.position.set(-0.5, 0.01, 0);
      muzzleFlashMesh.scale.setScalar(1);
    }
    muzzleFlashMesh.visible = weapon.hasMuzzleFlash(nowMs);
  }
}

function resolveDisplayedWeapon(weapon: WeaponSystem, switchState: WeaponSwitchState): WeaponKind {
  if (!switchState.active) {
    return weapon.getActiveWeapon();
  }
  return switchState.progress < 0.5 ? switchState.from : switchState.to;
}

function updateTracerMesh(
  tracerMesh: THREE.Mesh | null,
  weapon: WeaponSystem,
  nowMs: number,
  tempMid: THREE.Vector3,
  tempDir: THREE.Vector3,
) {
  if (!tracerMesh) {
    return;
  }

  const tracer = weapon.getActiveTracer(nowMs);
  if (!tracer) {
    tracerMesh.visible = false;
    return;
  }

  tempDir.copy(tracer.to).sub(tracer.from);
  const length = tempDir.length();
  if (length <= 0.0001) {
    tracerMesh.visible = false;
    return;
  }

  tracerMesh.visible = true;
  tempMid.copy(tracer.from).lerp(tracer.to, 0.5);
  tracerMesh.position.copy(tempMid);
  tracerMesh.scale.set(1, 1, length);
  tracerMesh.quaternion.setFromUnitVectors(Z_AXIS, tempDir.normalize());
}

function raycastBulletWorld(
  scene: THREE.Scene,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  raycaster: THREE.Raycaster,
  tempNormal: THREE.Vector3,
  tempNormalMatrix: THREE.Matrix3,
): WorldRaycastHit | null {
  raycaster.set(origin, direction);
  const intersections = raycaster.intersectObjects(scene.children, true);

  for (const intersection of intersections) {
    const object = intersection.object;
    if (!(object instanceof THREE.Mesh)) {
      continue;
    }
    if (object.userData?.bulletHittable !== true) {
      continue;
    }
    if (intersection.distance <= 0) {
      continue;
    }

    if (intersection.face) {
      tempNormal.copy(intersection.face.normal);
      tempNormalMatrix.getNormalMatrix(object.matrixWorld);
      tempNormal.applyMatrix3(tempNormalMatrix).normalize();
    } else {
      tempNormal.set(0, 1, 0);
    }

    return {
      point: intersection.point.clone(),
      normal: tempNormal.clone(),
      distance: intersection.distance,
    };
  }

  return null;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);
