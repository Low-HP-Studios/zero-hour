import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  loadFbxAsset,
  loadFbxAnimation,
  preloadTextureAsset,
} from "../AssetLoader";
import {
  ANIM_CLIPS,
  CHARACTER_MODEL_URL,
  CHARACTER_TARGET_HEIGHT,
  CHARACTER_TEXTURE_BASE,
  CHARACTER_TEXTURE_MAP,
  CROUCH_ANIM_TIME_SCALE,
  RIFLE_CROUCH_ANIM_TIME_SCALE,
  RIFLE_HOLD_JOG_TIME_SCALE,
  RIFLE_HOLD_RUN_START_TIME_SCALE,
  RIFLE_HOLD_RUN_STOP_TIME_SCALE,
  RIFLE_HOLD_RUN_TIME_SCALE,
  RIFLE_HOLD_WALK_TIME_SCALE,
  SPRINT_ANIM_TIME_SCALE,
  WALK_ANIM_TIME_SCALE,
  BASE_FOOTSTEP_INTERVAL_SECONDS,
  type CharacterAnimState,
} from "./scene-constants";

export type CharacterModelResult = {
  model: THREE.Group | null;
  ready: boolean;
  setAnimState: (
    state: CharacterAnimState,
    options?: CharacterAnimPlaybackOptions,
  ) => void;
};

export type CharacterAnimPlaybackOptions = {
  locomotionScale?: number;
};

function isRifleLocomotionState(state: CharacterAnimState): boolean {
  return state.startsWith("rifleWalk") ||
    state.startsWith("rifleJog") ||
    state === "rifleRun" ||
    state === "rifleRunStart" ||
    state === "rifleRunStop";
}

function resolveCharacterAnimTimeScale(
  state: CharacterAnimState,
  options?: CharacterAnimPlaybackOptions,
): number {
  const locomotionScale = THREE.MathUtils.clamp(
    options?.locomotionScale ?? 1,
    0.5,
    2,
  );
  let baseScale = WALK_ANIM_TIME_SCALE;
  if (state === "sprint") {
    baseScale = SPRINT_ANIM_TIME_SCALE;
  } else if (
    state === "idle" ||
    state === "rifleIdle" ||
    state === "rifleAimHold" ||
    state === "crouchEnter" ||
    state === "crouchExit" ||
    state === "rifleCrouchEnter" ||
    state === "rifleCrouchExit"
  ) {
    baseScale = 1;
  } else if (
    state === "crouchIdle" ||
    state === "crouchForward" ||
    state === "crouchBack" ||
    state === "crouchLeft" ||
    state === "crouchRight"
  ) {
    baseScale = CROUCH_ANIM_TIME_SCALE;
  } else if (state === "rifleCrouchIdle" || state === "rifleCrouchWalk") {
    baseScale = RIFLE_CROUCH_ANIM_TIME_SCALE;
  } else if (state.startsWith("rifleWalk")) {
    baseScale = RIFLE_HOLD_WALK_TIME_SCALE;
  } else if (state.startsWith("rifleJog")) {
    baseScale = RIFLE_HOLD_JOG_TIME_SCALE;
  } else if (state === "rifleRunStart") {
    baseScale = RIFLE_HOLD_RUN_START_TIME_SCALE;
  } else if (state === "rifleRunStop") {
    baseScale = RIFLE_HOLD_RUN_STOP_TIME_SCALE;
  } else if (state === "rifleRun") {
    baseScale = RIFLE_HOLD_RUN_TIME_SCALE;
  }
  return isRifleLocomotionState(state) ? baseScale * locomotionScale : baseScale;
}

export function resolveFootstepIntervalSeconds(
  state: CharacterAnimState,
  options?: CharacterAnimPlaybackOptions,
): number {
  const animTimeScale = resolveCharacterAnimTimeScale(state, options);
  return BASE_FOOTSTEP_INTERVAL_SECONDS / Math.max(0.1, animTimeScale);
}

export function resolveFootstepPlaybackRate(
  state: CharacterAnimState,
  options?: CharacterAnimPlaybackOptions,
): number {
  const locomotionScale = THREE.MathUtils.clamp(
    options?.locomotionScale ?? 1,
    0.5,
    2,
  );
  let baseRate = 1;
  if (state === "sprint") {
    baseRate = 1.22;
  } else if (
    state === "crouchIdle" ||
    state === "crouchForward" ||
    state === "crouchBack" ||
    state === "crouchLeft" ||
    state === "crouchRight" ||
    state === "rifleCrouchIdle" ||
    state === "rifleCrouchWalk"
  ) {
    baseRate = 0.84;
  } else if (state === "walkBack" || state === "rifleWalkBack") {
    baseRate = 0.92;
  } else if (
    state === "walkLeft" ||
    state === "walkRight" ||
    state === "walkForwardLeft" ||
    state === "walkForwardRight" ||
    state === "rifleWalkLeft" ||
    state === "rifleWalkRight" ||
    state === "rifleWalkForwardLeft" ||
    state === "rifleWalkForwardRight" ||
    state === "rifleJogLeft" ||
    state === "rifleJogRight" ||
    state === "rifleJogForwardLeft" ||
    state === "rifleJogForwardRight"
  ) {
    baseRate = 1.06;
  } else if (
    state === "walkBackwardLeft" ||
    state === "walkBackwardRight" ||
    state === "rifleWalkBackwardLeft" ||
    state === "rifleWalkBackwardRight" ||
    state === "rifleJogBackwardLeft" ||
    state === "rifleJogBackwardRight"
  ) {
    baseRate = 0.98;
  } else if (
    state === "rifleJog" ||
    state === "rifleJogBack" ||
    state === "rifleRun" ||
    state === "rifleRunStart" ||
    state === "rifleRunStop"
  ) {
    baseRate = 1.12;
  }
  return isRifleLocomotionState(state) ? baseRate * locomotionScale : baseRate;
}

export function normalizeBoneName(name: string): string {
  return name
    .replace(/^mixamorig:/, "")
    .replace(/^characters3d\.?com___/, "")
    .replace(/^mixamorig_/, "");
}

function splitTrackName(trackName: string): { nodeName: string; property: string } {
  const dotIdx = trackName.lastIndexOf(".");
  if (dotIdx <= 0) {
    return { nodeName: trackName, property: "" };
  }
  return {
    nodeName: trackName.substring(0, dotIdx),
    property: trackName.substring(dotIdx),
  };
}

export function remapAnimationClip(
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

export function removeRootMotion(clip: THREE.AnimationClip): void {
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
  // Collect all meshes and their material conversion work
  const tasks: Promise<void>[] = [];

  model.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    const task = (async () => {
      const newMats = await Promise.all(
        mats.map(async (mat) => {
          const entry = findTextureEntry(mat.name);
          const phong = mat as THREE.MeshPhongMaterial;

          // Load textures first (awaited)
          let baseTex: THREE.Texture | null = null;
          let normalTex: THREE.Texture | null = null;
          if (entry) {
            [baseTex, normalTex] = await Promise.all([
              preloadTextureAsset(CHARACTER_TEXTURE_BASE + entry.base),
              preloadTextureAsset(CHARACTER_TEXTURE_BASE + entry.normal),
            ]);
          }

          // Convert to MeshStandardMaterial for proper PBR lighting
          const stdMat = new THREE.MeshStandardMaterial({
            name: mat.name,
            color: phong.color ?? new THREE.Color(0xffffff),
            roughness: 0.75,
            metalness: 0.05,
          });

          if (baseTex) {
            baseTex.colorSpace = THREE.SRGBColorSpace;
            stdMat.map = baseTex;
          }
          if (normalTex) {
            stdMat.normalMap = normalTex;
          }

          mat.dispose();
          return stdMat;
        }),
      );
      mesh.material = newMats.length === 1 ? newMats[0] : newMats;
    })();

    tasks.push(task);
  });

  await Promise.all(tasks);
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

export function useCharacterModel(): CharacterModelResult {
  const [model, setModel] = useState<THREE.Group | null>(null);
  const [ready, setReady] = useState(false);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Map<string, THREE.AnimationAction>>(new Map());
  const currentAnimRef = useRef<string>("");

  useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        const [fbxModel, SkeletonUtils, ...clips] = await Promise.all([
          loadFbxAsset(CHARACTER_MODEL_URL),
          import("three/examples/jsm/utils/SkeletonUtils.js"),
          ...ANIM_CLIPS.map((a) => loadFbxAnimation(a.url, a.name)),
        ]);

        if (disposed) return;
        if (!fbxModel) {
          setReady(true);
          return;
        }

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
          if (
            (child as THREE.Bone).isBone ||
            (child as THREE.SkinnedMesh).isSkinnedMesh
          ) {
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
          remapped.tracks = remapped.tracks.filter((track) => {
            const boneName = splitTrackName(track.name).nodeName;
            return modelBoneNames.has(boneName);
          });
      const action = mixer.clipAction(remapped);
      const clipName = ANIM_CLIPS[i].name;
      if (
        clipName === "walkStart" ||
        clipName === "walkStop" ||
        clipName === "crouchEnter" ||
        clipName === "crouchExit" ||
        clipName === "rifleCrouchEnter" ||
        clipName === "rifleCrouchExit" ||
        clipName === "rifleRunStart" ||
        clipName === "rifleRunStop"
      ) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
      }
          actions.set(ANIM_CLIPS[i].name, action);
        }
        actionsRef.current = actions;

        const idleAction = actions.get("idle");
        if (idleAction) {
          idleAction.play();
          currentAnimRef.current = "idle";
        }

        setModel(clone);
      } catch (error) {
        console.warn("[Character] Model warm-up failed", error);
      } finally {
        if (!disposed) {
          setReady(true);
        }
      }
    })();

    return () => {
      disposed = true;
      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
        mixerRef.current.uncacheRoot(mixerRef.current.getRoot());
        mixerRef.current = null;
      }
    };
  }, []);

  const setAnimState = useCallback((
    state: CharacterAnimState,
    options?: CharacterAnimPlaybackOptions,
  ) => {
    const targetName = state === "sprint" ? "walk" : state;
    const targetSpeed = resolveCharacterAnimTimeScale(state, options);
    const stateKey = state;

    const actions = actionsRef.current;
    const target = actions.get(targetName);
    if (!target) return;

    const prevKey = currentAnimRef.current;
    const prevName = prevKey === "sprint" ? "walk" : prevKey;
    const prev = actions.get(prevName);
    if (currentAnimRef.current === stateKey && prev === target) {
      target.timeScale = targetSpeed;
      return;
    }

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

  return { model, ready, setAnimState };
}
