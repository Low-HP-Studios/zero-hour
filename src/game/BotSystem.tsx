import {
  memo,
  type MutableRefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { loadFbxAnimation, loadFbxAsset } from "./AssetLoader";
import {
  TARGET_CHARACTER_MODEL_URL,
  TARGET_DEATH_ANIMATION_URL,
  TARGET_IDLE_ANIMATION_URL,
  TDM_BOT_WALK_ANIMATION_URL,
} from "./boot-assets";
import type { BotState } from "./types";
import type { BlockingVolume } from "./map-layout";
import {
  type CharacterModelOverride,
  applyCharacterTextures,
  normalizeBoneName,
  remapAnimationClip,
  removeRootMotion,
} from "./scene/CharacterModel";
import { PRACTICE_TARGET_HEIGHT } from "./scene/scene-constants";
import type { TargetVisualHandle, TargetVisualRegistryRef } from "./Targets";
import {
  updateBotAI,
  checkBotLineOfSight,
  botShouldFire,
  resolveBotDamageToPlayer,
  LOS_CHECK_INTERVAL_MS,
} from "./BotAI";

const T = PRACTICE_TARGET_HEIGHT;

// ── Asset loading ─────────────────────────────────────────

type BotCharacterAsset = {
  model: THREE.Group | null;
  idleClip: THREE.AnimationClip | null;
  deathClip: THREE.AnimationClip | null;
  walkClip: THREE.AnimationClip | null;
  ready: boolean;
};

function getTrackNodeName(trackName: string) {
  const dotIdx = trackName.lastIndexOf(".");
  return dotIdx <= 0 ? trackName : trackName.slice(0, dotIdx);
}

function getTrackProperty(trackName: string) {
  const dotIdx = trackName.lastIndexOf(".");
  return dotIdx <= 0 ? "" : trackName.slice(dotIdx);
}

function sanitizeBotAnimationClip(
  clip: THREE.AnimationClip | null,
  modelBoneNames: Set<string>,
  options?: { preserveHipsPosition?: boolean },
): THREE.AnimationClip | null {
  if (!clip) return null;
  const remapped = remapAnimationClip(clip, modelBoneNames).clone();
  removeRootMotion(remapped);
  remapped.tracks = remapped.tracks.filter((track) => {
    const nodeName = getTrackNodeName(track.name);
    if (!modelBoneNames.has(nodeName)) return false;
    const property = getTrackProperty(track.name);
    if (property !== ".position") return true;
    if (!options?.preserveHipsPosition) return false;
    return normalizeBoneName(nodeName).toLowerCase().includes("hips");
  });
  return remapped;
}

function prepareBotModel(model: THREE.Group): void {
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const scale = size.y > 0 ? T / size.y : 1;
  model.scale.setScalar(scale);
  const scaledBox = new THREE.Box3().setFromObject(model);
  model.position.y = -scaledBox.min.y;
  model.rotation.y = Math.PI;
  model.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    (child as THREE.Mesh).castShadow = true;
    (child as THREE.Mesh).receiveShadow = true;
  });
}

function useBotCharacterAsset(
  enabled: boolean,
  characterOverride?: CharacterModelOverride,
): BotCharacterAsset {
  const [asset, setAsset] = useState<BotCharacterAsset>({
    model: null,
    idleClip: null,
    deathClip: null,
    walkClip: null,
    ready: false,
  });

  const modelUrl = characterOverride?.modelUrl ?? TARGET_CHARACTER_MODEL_URL;

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;

    (async () => {
      try {
        const [fbxModel, idleClip, deathClip, walkClip] = await Promise.all([
          loadFbxAsset(modelUrl),
          loadFbxAnimation(TARGET_IDLE_ANIMATION_URL, "idle"),
          loadFbxAnimation(TARGET_DEATH_ANIMATION_URL, "death"),
          loadFbxAnimation(TDM_BOT_WALK_ANIMATION_URL, "walk"),
        ]);
        if (disposed) return;
        if (!fbxModel) {
          setAsset({ model: null, idleClip: null, deathClip: null, walkClip: null, ready: true });
          return;
        }

        const prepared = SkeletonUtils.clone(fbxModel) as THREE.Group;
        prepareBotModel(prepared);

        await applyCharacterTextures(
          prepared,
          characterOverride?.textureBasePath,
          characterOverride?.textures,
        );

        const boneNames = new Set<string>();
        prepared.traverse((child) => {
          if ((child as THREE.Bone).isBone || (child as THREE.SkinnedMesh).isSkinnedMesh) {
            boneNames.add(child.name);
          }
        });

        const remappedIdle = sanitizeBotAnimationClip(idleClip, boneNames);
        const remappedDeath = sanitizeBotAnimationClip(deathClip, boneNames, {
          preserveHipsPosition: true,
        });
        const remappedWalk = sanitizeBotAnimationClip(walkClip, boneNames);

        if (!disposed) {
          setAsset({
            model: prepared,
            idleClip: remappedIdle,
            deathClip: remappedDeath,
            walkClip: remappedWalk,
            ready: true,
          });
        }
      } catch (error) {
        console.warn("[BotSystem] Asset load failed", error);
        if (!disposed) {
          setAsset({ model: null, idleClip: null, deathClip: null, walkClip: null, ready: true });
        }
      }
    })();

    return () => { disposed = true; };
  }, [enabled, modelUrl, characterOverride?.textureBasePath, characterOverride?.textures]);

  return asset;
}

// ── Visual handle resolution (same as Targets.tsx) ────────

type BotLandmarks = {
  head: THREE.Bone;
  neck: THREE.Bone;
  hips: THREE.Bone;
  leftUpperLeg: THREE.Bone;
  rightUpperLeg: THREE.Bone;
};

function resolveLandmarkKey(name: string): keyof BotLandmarks | null {
  const n = normalizeBoneName(name).toLowerCase();
  if (n === "head") return "head";
  if (n === "neck") return "neck";
  if (n === "hips" || n === "pelvis") return "hips";
  if (
    n === "l_upper_leg" || n === "leftupleg" || n === "left_upper_leg" ||
    n === "upleg_l" || n === "thigh_l" || n === "lthigh"
  ) return "leftUpperLeg";
  if (
    n === "r_upper_leg" || n === "rightupleg" || n === "right_upper_leg" ||
    n === "upleg_r" || n === "thigh_r" || n === "rthigh"
  ) return "rightUpperLeg";
  return null;
}

function resolveBotVisualHandle(
  botId: string,
  root: THREE.Group,
  charInstance: THREE.Group,
): TargetVisualHandle | null {
  const meshes: THREE.Mesh[] = [];
  const landmarks: Partial<BotLandmarks> = {};

  root.updateWorldMatrix(true, true);
  charInstance.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
        const sm = mesh as THREE.SkinnedMesh;
        sm.frustumCulled = false;
        const geo = sm.geometry;
        if (!geo.boundingBox) geo.computeBoundingBox();
        if (geo.boundingBox) {
          if (!sm.boundingSphere) sm.boundingSphere = new THREE.Sphere();
          geo.boundingBox.getCenter(sm.boundingSphere.center);
          const s = new THREE.Vector3();
          geo.boundingBox.getSize(s);
          sm.boundingSphere.radius = s.length();
        }
      }
      meshes.push(mesh);
    }
    if ((child as THREE.Bone).isBone) {
      const key = resolveLandmarkKey(child.name);
      if (key && !landmarks[key]) landmarks[key] = child as THREE.Bone;
    }
  });

  if (meshes.length === 0) return null;
  const full = !!(landmarks.head && landmarks.neck && landmarks.hips &&
    landmarks.leftUpperLeg && landmarks.rightUpperLeg);

  return {
    targetId: botId,
    root,
    shootableMeshes: meshes,
    landmarks: full ? landmarks as BotLandmarks : null,
  };
}

// ── HP Bar (camera-facing) ────────────────────────────────

const _hpBarQuat = new THREE.Quaternion();
const HP_BAR_Y = 1.32 * T;

const BotHPBar = memo(function BotHPBar({ hp, maxHp }: { hp: number; maxHp: number }) {
  const camera = useThree((s) => s.camera);
  const ref = useRef<THREE.Group>(null);

  useFrame(() => {
    const g = ref.current;
    if (!g || !g.parent) return;
    g.parent.getWorldQuaternion(_hpBarQuat);
    _hpBarQuat.invert();
    g.quaternion.copy(camera.quaternion).premultiply(_hpBarQuat);
  });

  const ratio = Math.max(0, hp / maxHp);
  const barW = 1.0;
  const barH = 0.12;
  const fillW = barW * ratio;
  const fillColor = ratio > 0.5 ? "#4ade80" : ratio > 0.25 ? "#facc15" : "#ef4444";

  return (
    <group ref={ref} position={[0, HP_BAR_Y, 0]}>
      <mesh position={[0, 0, -0.005]}>
        <planeGeometry args={[barW + 0.06, barH + 0.06]} />
        <meshBasicMaterial color="#000000" opacity={0.6} transparent />
      </mesh>
      <mesh position={[0, 0, -0.003]}>
        <planeGeometry args={[barW, barH]} />
        <meshBasicMaterial color="#1a1a1a" />
      </mesh>
      {fillW > 0.001 ? (
        <mesh position={[(fillW - barW) / 2, 0, 0]}>
          <planeGeometry args={[fillW, barH]} />
          <meshBasicMaterial color={fillColor} />
        </mesh>
      ) : null}
    </group>
  );
});

// ── Single bot entity ─────────────────────────────────────

const BotEntity = memo(function BotEntity({
  bot,
  shadows,
  reveal,
  asset,
  visualRegistryRef,
}: {
  bot: BotState;
  shadows: boolean;
  reveal: number;
  asset: BotCharacterAsset;
  visualRegistryRef?: TargetVisualRegistryRef;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const idleActionRef = useRef<THREE.AnimationAction | null>(null);
  const walkActionRef = useRef<THREE.AnimationAction | null>(null);
  const deathActionRef = useRef<THREE.AnimationAction | null>(null);
  const prevDisabledRef = useRef(bot.disabled);
  const prevMovingRef = useRef(false);
  const [showDeathPose, setShowDeathPose] = useState(false);

  const charInstance = useMemo(
    () => (asset.model ? (SkeletonUtils.clone(asset.model) as THREE.Group) : null),
    [asset.model],
  );

  // Set up mixer and actions
  useEffect(() => {
    if (!charInstance || !asset.idleClip) return;

    const mixer = new THREE.AnimationMixer(charInstance);
    const idleAction = mixer.clipAction(asset.idleClip);
    idleAction.setLoop(THREE.LoopRepeat, Infinity);
    idleAction.play();
    idleActionRef.current = idleAction;

    if (asset.walkClip) {
      const walkAction = mixer.clipAction(asset.walkClip);
      walkAction.setLoop(THREE.LoopRepeat, Infinity);
      walkAction.enabled = true;
      walkAction.setEffectiveWeight(0);
      walkAction.play();
      walkActionRef.current = walkAction;
    }

    if (asset.deathClip) {
      const deathAction = mixer.clipAction(asset.deathClip);
      deathAction.setLoop(THREE.LoopOnce, 1);
      deathAction.clampWhenFinished = true;
      deathAction.enabled = true;
      deathActionRef.current = deathAction;
    }

    mixerRef.current = mixer;

    return () => {
      mixer.stopAllAction();
      mixerRef.current = null;
      idleActionRef.current = null;
      walkActionRef.current = null;
      deathActionRef.current = null;
    };
  }, [asset.idleClip, asset.walkClip, asset.deathClip, charInstance]);

  // Handle death / respawn transitions
  useEffect(() => {
    const wasDisabled = prevDisabledRef.current;
    prevDisabledRef.current = bot.disabled;

    if (bot.disabled && !wasDisabled) {
      const deathAction = deathActionRef.current;
      if (deathAction) {
        idleActionRef.current?.fadeOut(0.08);
        walkActionRef.current?.fadeOut(0.08);
        deathAction.reset();
        deathAction.paused = false;
        deathAction.timeScale = 1;
        deathAction.play();
        setShowDeathPose(true);
      }
    } else if (!bot.disabled && wasDisabled) {
      deathActionRef.current?.stop();
      const idleAction = idleActionRef.current;
      if (idleAction) {
        idleAction.reset();
        idleAction.enabled = true;
        idleAction.setEffectiveTimeScale(1);
        idleAction.setEffectiveWeight(1);
        idleAction.fadeIn(0.08);
        idleAction.play();
      }
      if (walkActionRef.current) {
        walkActionRef.current.setEffectiveWeight(0);
      }
      setShowDeathPose(false);
    }
  }, [bot.disabled]);

  // Shadow and opacity
  useEffect(() => {
    if (!charInstance) return;
    charInstance.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        const std = mat as THREE.MeshStandardMaterial;
        std.transparent = reveal < 0.999;
        std.opacity = reveal;
        if ("emissive" in std) {
          std.emissive.set("#000000");
          std.emissiveIntensity = 0;
        }
      }
    });
  }, [charInstance, reveal, shadows]);

  // Register in visual registry for hit detection
  useEffect(() => {
    const registry = visualRegistryRef?.current;
    const root = groupRef.current;
    if (!registry) return;

    if (!root || !charInstance) {
      registry.delete(bot.id);
      return;
    }

    const handle = resolveBotVisualHandle(bot.id, root, charInstance);
    if (handle) {
      registry.set(bot.id, handle);
    } else {
      registry.delete(bot.id);
    }

    return () => {
      const current = registry.get(bot.id);
      if (current?.root === root) {
        registry.delete(bot.id);
      }
    };
  }, [charInstance, bot.id, visualRegistryRef]);

  // Per-frame: update position, rotation, animation blend
  useFrame((_, delta) => {
    if (reveal <= 0.01) return;

    const group = groupRef.current;
    if (group) {
      group.position.set(bot.position[0], bot.position[1], bot.position[2]);
      group.rotation.y = bot.facingYaw;
    }

    // Animation blending: walk vs idle
    const isMoving = bot.moveSpeed > 0.5 && !bot.disabled;
    const wasMoving = prevMovingRef.current;
    prevMovingRef.current = isMoving;

    if (isMoving !== wasMoving && !bot.disabled) {
      const walkAction = walkActionRef.current;
      const idleAction = idleActionRef.current;
      if (isMoving && walkAction && idleAction) {
        idleAction.fadeOut(0.2);
        walkAction.reset();
        walkAction.setEffectiveWeight(1);
        walkAction.fadeIn(0.2);
        walkAction.play();
      } else if (!isMoving && walkAction && idleAction) {
        walkAction.fadeOut(0.2);
        idleAction.reset();
        idleAction.setEffectiveWeight(1);
        idleAction.fadeIn(0.2);
        idleAction.play();
      }
    }

    // Adjust walk speed
    if (walkActionRef.current && isMoving) {
      walkActionRef.current.timeScale = bot.moveSpeed / 2.5; // normalize to base walk speed
    }

    if (bot.disabled && !showDeathPose) return;
    mixerRef.current?.update(delta);
  });

  const scale = 0.82 + reveal * 0.18;
  const visible = reveal > 0.01 && (!bot.disabled || showDeathPose);

  return (
    <group
      ref={groupRef}
      position={[bot.position[0], bot.position[1], bot.position[2]]}
      rotation={[0, bot.facingYaw, 0]}
      scale={scale}
      visible={visible}
    >
      {charInstance ? (
        <primitive object={charInstance} renderOrder={0} />
      ) : (
        <mesh position={[0, 0.95 * T, 0]} castShadow={shadows} receiveShadow={shadows}>
          <sphereGeometry args={[0.085 * T, 12, 12]} />
          <meshStandardMaterial color="#e8d5b7" transparent={reveal < 0.999} opacity={reveal} />
        </mesh>
      )}
      {!bot.disabled && reveal >= 0.55 && bot.hp < bot.maxHp ? (
        <BotHPBar hp={bot.hp} maxHp={bot.maxHp} />
      ) : null}
    </group>
  );
});

// ── Main BotSystem component ──────────────────────────────

export type BotSystemProps = {
  bots: BotState[];
  playerPositionRef: MutableRefObject<[number, number, number]>;
  playerDead: boolean;
  blockingVolumes: readonly BlockingVolume[];
  waypoints: readonly [number, number, number][];
  shadows: boolean;
  reveal: number;
  visualRegistryRef?: TargetVisualRegistryRef;
  characterOverride?: CharacterModelOverride;
  onBotStateUpdate: (bots: BotState[]) => void;
  onBotFiredAtPlayer: (damage: number) => void;
};

export const BotSystem = memo(function BotSystem({
  bots,
  playerPositionRef,
  playerDead,
  blockingVolumes,
  waypoints,
  shadows,
  reveal,
  visualRegistryRef,
  characterOverride,
  onBotStateUpdate,
  onBotFiredAtPlayer,
}: BotSystemProps) {
  const asset = useBotCharacterAsset(true, characterOverride);

  // Refs to avoid stale closures in useFrame
  const botsRef = useRef(bots);
  botsRef.current = bots;
  const playerDeadRef = useRef(playerDead);
  playerDeadRef.current = playerDead;
  const blockingRef = useRef(blockingVolumes);
  blockingRef.current = blockingVolumes;
  const waypointsRef = useRef(waypoints);
  waypointsRef.current = waypoints;
  const onUpdateRef = useRef(onBotStateUpdate);
  onUpdateRef.current = onBotStateUpdate;
  const onFireRef = useRef(onBotFiredAtPlayer);
  onFireRef.current = onBotFiredAtPlayer;

  // Staggered LOS check timestamps per bot
  const losTimestampsRef = useRef<number[]>([]);
  const losResultsRef = useRef<boolean[]>([]);

  function botChanged(previous: BotState, next: BotState) {
    return previous.position[0] !== next.position[0] ||
      previous.position[1] !== next.position[1] ||
      previous.position[2] !== next.position[2] ||
      previous.facingYaw !== next.facingYaw ||
      previous.hp !== next.hp ||
      previous.disabled !== next.disabled ||
      previous.hitUntil !== next.hitUntil ||
      previous.aiState !== next.aiState ||
      previous.currentWaypointIndex !== next.currentWaypointIndex ||
      previous.lastShotTime !== next.lastShotTime ||
      previous.respawnAt !== next.respawnAt ||
      previous.targetVisible !== next.targetVisible ||
      previous.moveSpeed !== next.moveSpeed ||
      previous.lostSightTime !== next.lostSightTime ||
      previous.coverEnteredAt !== next.coverEnteredAt;
  }

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05); // cap to prevent large jumps
    const nowMs = performance.now();
    const currentBots = botsRef.current;
    const pp = playerPositionRef.current;
    const bv = blockingRef.current;
    const wp = waypointsRef.current;
    const pDead = playerDeadRef.current;

    // Initialize LOS arrays if needed
    if (losTimestampsRef.current.length !== currentBots.length) {
      losTimestampsRef.current = currentBots.map((_, i) => nowMs - i * 40);
      losResultsRef.current = currentBots.map(() => false);
    }

    let changed = false;
    const updated: BotState[] = [];

    for (let i = 0; i < currentBots.length; i++) {
      const bot = currentBots[i];

      // Staggered LOS check
      let canSee = losResultsRef.current[i];
      if (nowMs - losTimestampsRef.current[i] >= LOS_CHECK_INTERVAL_MS) {
        canSee = !pDead && !bot.disabled && checkBotLineOfSight(bot.position, pp, bv);
        losResultsRef.current[i] = canSee;
        losTimestampsRef.current[i] = nowMs;
      }

      // Update AI
      let next = updateBotAI(bot, pp, delta, nowMs, bv, wp, canSee);

      // Check firing
      if (!pDead && botShouldFire(next, pp, nowMs)) {
        const dx = pp[0] - next.position[0];
        const dz = pp[2] - next.position[2];
        const dist = Math.sqrt(dx * dx + dz * dz);
        const dmg = resolveBotDamageToPlayer(next, dist);
        next = { ...next, lastShotTime: nowMs };
        if (dmg > 0) {
          onFireRef.current(dmg);
        }
      }

      const nextChanged = botChanged(bot, next);
      if (nextChanged) {
        changed = true;
      }
      updated.push(nextChanged ? next : bot);
    }

    if (changed) {
      onUpdateRef.current(updated);
    }
  });

  if (!asset.ready) return null;

  return (
    <group>
      {bots.map((bot) => (
        <BotEntity
          key={bot.id}
          bot={bot}
          shadows={shadows}
          reveal={reveal}
          asset={asset}
          visualRegistryRef={visualRegistryRef}
        />
      ))}
    </group>
  );
});
