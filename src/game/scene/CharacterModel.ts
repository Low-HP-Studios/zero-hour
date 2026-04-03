import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import {
  loadFbxAnimation,
  loadModelAsset,
  preloadTextureAsset,
} from "../AssetLoader";
import type { CharacterTextureEntry } from "../characters";
import {
  ANIM_CLIPS,
  CHARACTER_MODEL_URL,
  CHARACTER_TARGET_HEIGHT,
  CHARACTER_TEXTURE_BASE,
  CHARACTER_TEXTURE_MAP,
  CROUCH_ANIM_TIME_SCALE,
  RIFLE_HOLD_JOG_TIME_SCALE,
  RIFLE_HOLD_RUN_START_TIME_SCALE,
  RIFLE_HOLD_RUN_STOP_TIME_SCALE,
  RIFLE_HOLD_RUN_TIME_SCALE,
  RIFLE_HOLD_WALK_TIME_SCALE,
  SPRINT_ANIM_TIME_SCALE,
  WALK_ANIM_TIME_SCALE,
  type CharacterAnimState,
} from "./scene-constants";

export type CharacterFootstepSample = {
  state: CharacterAnimState;
  normalizedTime: number;
};

export type CharacterModelResult = {
  model: THREE.Group | null;
  ready: boolean;
  setAnimState: (
    state: CharacterAnimState,
    options?: CharacterAnimPlaybackOptions,
  ) => void;
  getFootstepSample: () => CharacterFootstepSample | null;
  getCurrentAnimState: () => CharacterAnimState | null;
};

export type CharacterAnimPlaybackOptions = {
  locomotionScale?: number;
  seekNormalizedTime?: number;
  desiredDurationSeconds?: number;
  fadeDurationSeconds?: number;
  lowerBodyState?: CharacterAnimState | null;
  lowerBodyLocomotionScale?: number;
  lowerBodySeekNormalizedTime?: number;
  lowerBodyDesiredDurationSeconds?: number;
  lowerBodyFadeDurationSeconds?: number;
  upperBodyState?: CharacterAnimState | null;
  upperBodyLocomotionScale?: number;
  upperBodySeekNormalizedTime?: number;
  upperBodyDesiredDurationSeconds?: number;
  upperBodyFadeDurationSeconds?: number;
};

function isUnarmedSharedLocomotionState(state: CharacterAnimState): boolean {
  return state === "walk" ||
    state === "walkBack" ||
    state === "walkLeft" ||
    state === "walkRight" ||
    state === "walkForwardLeft" ||
    state === "walkForwardRight" ||
    state === "walkBackwardLeft" ||
    state === "walkBackwardRight";
}

function isScaledLocomotionState(state: CharacterAnimState): boolean {
  return state.startsWith("rifleWalk") ||
    state.startsWith("rifleAimWalk") ||
    state.startsWith("rifleJog") ||
    isUnarmedSharedLocomotionState(state) ||
    state === "rifleRun" ||
    state === "rifleRunStart" ||
    state === "rifleRunStop";
}

function isFootstepLocomotionState(state: CharacterAnimState): boolean {
  return state === "sprint" ||
    state === "crouchForward" ||
    state === "crouchBack" ||
    state === "crouchLeft" ||
    state === "crouchRight" ||
    state === "rifleCrouchWalk" ||
    isScaledLocomotionState(state);
}

const PHASE_SYNC_ELIGIBLE: ReadonlySet<CharacterAnimState> = new Set([
  // Unarmed walk
  "walk", "walkBack", "walkLeft", "walkRight",
  "walkForwardLeft", "walkForwardRight", "walkBackwardLeft", "walkBackwardRight",
  "sprint",
  // Rifle walk
  "rifleWalk", "rifleWalkBack", "rifleWalkLeft", "rifleWalkRight",
  "rifleWalkForwardLeft", "rifleWalkForwardRight", "rifleWalkBackwardLeft", "rifleWalkBackwardRight",
  // Rifle jog
  "rifleJog", "rifleJogBack", "rifleJogLeft", "rifleJogRight",
  "rifleJogForwardLeft", "rifleJogForwardRight", "rifleJogBackwardLeft", "rifleJogBackwardRight",
  // Rifle run (loop only, NOT start/stop)
  "rifleRun",
  // Rifle aim walk
  "rifleAimWalk", "rifleAimWalkBack", "rifleAimWalkLeft", "rifleAimWalkRight",
  // Crouch locomotion
  "crouchForward", "crouchBack", "crouchLeft", "crouchRight",
  "rifleCrouchWalk",
]);

function isPhaseSyncEligible(state: CharacterAnimState): boolean {
  return PHASE_SYNC_ELIGIBLE.has(state);
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
    state === "rifleAimHold"
  ) {
    baseScale = 1;
  } else if (
    state === "crouchEnter" ||
    state === "crouchExit" ||
    state === "rifleCrouchEnter" ||
    state === "rifleCrouchExit"
  ) {
    baseScale = CROUCH_ANIM_TIME_SCALE;
  } else if (
    state === "crouchIdle" ||
    state === "crouchForward" ||
    state === "crouchBack" ||
    state === "crouchLeft" ||
    state === "crouchRight" ||
    state === "rifleCrouchIdle" ||
    state === "rifleCrouchWalk"
  ) {
    baseScale = CROUCH_ANIM_TIME_SCALE;
  } else if (state.startsWith("rifleAimWalk")) {
    baseScale = RIFLE_HOLD_WALK_TIME_SCALE;
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
  return isScaledLocomotionState(state) ? baseScale * locomotionScale : baseScale;
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
  } else if (
    state === "walkBack" ||
    state === "rifleWalkBack" ||
    state === "rifleAimWalkBack"
  ) {
    baseRate = 0.92;
  } else if (
    state === "walkLeft" ||
    state === "walkRight" ||
    state === "walkForwardLeft" ||
    state === "walkForwardRight" ||
    state === "rifleAimWalkLeft" ||
    state === "rifleAimWalkRight" ||
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
  } else if (state === "rifleAimWalk") {
    baseRate = 1;
  } else if (
    state === "rifleJog" ||
    state === "rifleJogBack" ||
    state === "rifleRun" ||
    state === "rifleRunStart" ||
    state === "rifleRunStop"
  ) {
    baseRate = 1.12;
  }
  return isScaledLocomotionState(state) ? baseRate * locomotionScale : baseRate;
}

export function normalizeBoneName(name: string): string {
  return name
    .replace(/^mixamorig:/, "")
    .replace(/^characters3d\.?com___/, "")
    .replace(/^mixamorig_/, "");
}

export function splitTrackName(trackName: string): { nodeName: string; property: string } {
  const dotIdx = trackName.lastIndexOf(".");
  if (dotIdx <= 0) {
    return { nodeName: trackName, property: "" };
  }
  return {
    nodeName: trackName.substring(0, dotIdx),
    property: trackName.substring(dotIdx),
  };
}

// Lower split point = more bones in the upper body set, so the upper body overlay
// fully masks jog animation shoulder/arm sway. spine1 captures everything from the
// mid-torso up; runtime IK in GameplayRuntime uses its own bone lookup for chest.
function resolveUpperBodyBonePriority(normalizedBoneName: string): number {
  if (
    normalizedBoneName === "spine1" ||
    normalizedBoneName === "spine_01"
  ) {
    return 0;
  }
  if (
    normalizedBoneName === "spine2" ||
    normalizedBoneName === "spine_02"
  ) {
    return 1;
  }
  if (normalizedBoneName === "chest") {
    return 2;
  }
  if (
    normalizedBoneName === "upper_chest" ||
    normalizedBoneName === "upperchest"
  ) {
    return 3;
  }
  if (normalizedBoneName === "spine") {
    return 4;
  }
  return Number.POSITIVE_INFINITY;
}

function collectUpperBodyBoneNames(model: THREE.Group): Set<string> {
  const bones: THREE.Bone[] = [];
  model.traverse((child) => {
    if ((child as THREE.Bone).isBone) {
      bones.push(child as THREE.Bone);
    }
  });

  let upperBodyRoot: THREE.Bone | null = null;
  let upperBodyPriority = Number.POSITIVE_INFINITY;
  for (const bone of bones) {
    const priority = resolveUpperBodyBonePriority(
      normalizeBoneName(bone.name).toLowerCase(),
    );
    if (priority < upperBodyPriority) {
      upperBodyRoot = bone;
      upperBodyPriority = priority;
    }
  }

  if (!upperBodyRoot) {
    return new Set<string>();
  }

  const upperBodyBoneNames = new Set<string>();
  upperBodyRoot.traverse((child: THREE.Object3D) => {
    if ((child as THREE.Bone).isBone) {
      upperBodyBoneNames.add(child.name);
    }
  });
  return upperBodyBoneNames;
}

function cloneFilteredClip(
  clip: THREE.AnimationClip,
  includeBone: (boneName: string) => boolean,
): THREE.AnimationClip | null {
  const filteredTracks = clip.tracks.filter((track) =>
    includeBone(splitTrackName(track.name).nodeName)
  );

  if (filteredTracks.length === 0) {
    return null;
  }

  const filteredClip = clip.clone();
  filteredClip.tracks = filteredTracks.map((track) => track.clone());
  return filteredClip;
}

function configureActionLooping(
  clipName: string,
  action: THREE.AnimationAction,
): void {
  if (
    clipName === "walkStart" ||
    clipName === "walkStop" ||
    clipName === "crouchEnter" ||
    clipName === "crouchExit" ||
    clipName === "rifleCrouchEnter" ||
    clipName === "rifleCrouchExit" ||
    clipName === "rifleRunStart" ||
    clipName === "rifleRunStop" ||
    clipName === "rifleReload"
  ) {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  } else {
    action.setLoop(THREE.LoopRepeat, Infinity);
  }
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

export async function applyCharacterTextures(
  model: THREE.Group,
  textureBase?: string,
  dynamicTextures?: CharacterTextureEntry[] | null,
): Promise<void> {
  if (dynamicTextures === null) {
    return;
  }

  const useBase = textureBase ?? CHARACTER_TEXTURE_BASE;
  const tasks: Promise<void>[] = [];

  model.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    const task = (async () => {
      const newMats = await Promise.all(
        mats.map(async (mat) => {
          const entry = Array.isArray(dynamicTextures)
            ? findDynamicTextureEntry(mat.name || mesh.name, dynamicTextures)
            : findTextureEntry(mat.name);
          const phong = mat as THREE.MeshPhongMaterial;

          let baseTex: THREE.Texture | null = null;
          let normalTex: THREE.Texture | null = null;
          if (entry) {
            const loads: Promise<THREE.Texture | null>[] = [
              preloadTextureAsset(useBase + entry.base),
            ];
            if (entry.normal) {
              loads.push(preloadTextureAsset(useBase + entry.normal));
            }
            const [b, n] = await Promise.all(loads);
            baseTex = b;
            normalTex = n ?? null;
          }

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

function findTextureEntry(
  materialName: string,
): { base: string; normal?: string } | null {
  if (CHARACTER_TEXTURE_MAP[materialName]) return CHARACTER_TEXTURE_MAP[materialName];
  const lower = materialName.toLowerCase();
  for (const [key, value] of Object.entries(CHARACTER_TEXTURE_MAP)) {
    if (key.toLowerCase() === lower) return value;
    if (lower.includes(key.toLowerCase())) return value;
  }
  return null;
}

function findDynamicTextureEntry(
  name: string,
  textures: CharacterTextureEntry[],
): CharacterTextureEntry | null {
  return textures.find((t) => t.match === "" || name.includes(t.match)) ?? null;
}

export type CharacterModelOverride = {
  modelUrl: string;
  textureBasePath: string;
  textures: CharacterTextureEntry[] | null;
};

export function useCharacterModel(
  override?: CharacterModelOverride,
): CharacterModelResult {
  const [model, setModel] = useState<THREE.Group | null>(null);
  const [ready, setReady] = useState(false);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const fullActionsRef = useRef<Map<string, THREE.AnimationAction>>(new Map());
  const lowerBodyBaseActionsRef = useRef<Map<string, THREE.AnimationAction>>(
    new Map(),
  );
  const lowerBodyOverlayActionsRef = useRef<Map<string, THREE.AnimationAction>>(
    new Map(),
  );
  const upperBodyActionsRef = useRef<Map<string, THREE.AnimationAction>>(
    new Map(),
  );
  const currentBaseActionRef = useRef<THREE.AnimationAction | null>(null);
  const currentLowerBodyActionRef = useRef<THREE.AnimationAction | null>(null);
  const currentUpperBodyActionRef = useRef<THREE.AnimationAction | null>(null);
  const currentBaseStateRef = useRef<CharacterAnimState | null>(null);
  const currentLowerBodyStateRef = useRef<CharacterAnimState | null>(null);
  const currentUpperBodyStateRef = useRef<CharacterAnimState | null>(null);

  useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        const modelUrl = override?.modelUrl ?? CHARACTER_MODEL_URL;
        const [characterModel, SkeletonUtils, ...clips] = await Promise.all([
          loadModelAsset(modelUrl),
          import("three/examples/jsm/utils/SkeletonUtils.js"),
          ...ANIM_CLIPS.map((a) => loadFbxAnimation(a.url, a.name)),
        ]);

        if (disposed) return;
        if (!characterModel) {
          setReady(true);
          return;
        }

        const clone = SkeletonUtils.clone(characterModel) as THREE.Group;

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
          if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
            child.frustumCulled = false;
          }
        });

        await applyCharacterTextures(
          clone,
          override?.textureBasePath,
          override?.textures,
        );

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

        const upperBodyBoneNames = collectUpperBodyBoneNames(clone);
        const fullActions = new Map<string, THREE.AnimationAction>();
        const lowerBodyBaseActions = new Map<string, THREE.AnimationAction>();
        const lowerBodyOverlayActions = new Map<string, THREE.AnimationAction>();
        const upperBodyActions = new Map<string, THREE.AnimationAction>();
        for (let i = 0; i < ANIM_CLIPS.length; i++) {
          const clip = clips[i];
          if (!clip) continue;
          const clipName = ANIM_CLIPS[i].name;
          const remapped = remapAnimationClip(clip, modelBoneNames).clone();
          removeRootMotion(remapped);
          remapped.tracks = remapped.tracks.filter((track) => {
            const boneName = splitTrackName(track.name).nodeName;
            return modelBoneNames.has(boneName);
          });
          const fullAction = mixer.clipAction(remapped);
          configureActionLooping(clipName, fullAction);
          fullActions.set(clipName, fullAction);

          const lowerBodyClip = cloneFilteredClip(
            remapped,
            (boneName) => !upperBodyBoneNames.has(boneName),
          );
          if (lowerBodyClip) {
            const lowerBodyBaseAction = mixer.clipAction(lowerBodyClip);
            configureActionLooping(clipName, lowerBodyBaseAction);
            lowerBodyBaseActions.set(clipName, lowerBodyBaseAction);

            const lowerBodyOverlayAction = mixer.clipAction(lowerBodyClip.clone());
            configureActionLooping(clipName, lowerBodyOverlayAction);
            lowerBodyOverlayActions.set(clipName, lowerBodyOverlayAction);
          }

          const upperBodyClip = cloneFilteredClip(
            remapped,
            (boneName) => upperBodyBoneNames.has(boneName),
          );
          if (upperBodyClip) {
            const upperBodyAction = mixer.clipAction(upperBodyClip);
            configureActionLooping(clipName, upperBodyAction);
            upperBodyActions.set(clipName, upperBodyAction);
          }
        }
        fullActionsRef.current = fullActions;
        lowerBodyBaseActionsRef.current = lowerBodyBaseActions;
        lowerBodyOverlayActionsRef.current = lowerBodyOverlayActions;
        upperBodyActionsRef.current = upperBodyActions;

        const idleAction = fullActions.get("idle");
        if (idleAction) {
          idleAction.play();
          currentBaseActionRef.current = idleAction;
          currentBaseStateRef.current = "idle";
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [override?.modelUrl, override?.textureBasePath, override?.textures]);

  const setAnimState = useCallback((
    state: CharacterAnimState,
    options?: CharacterAnimPlaybackOptions,
  ) => {
    const fadeDuration = Math.max(0, options?.fadeDurationSeconds ?? 0.25);
    const playLayer = (
      currentActionRef: MutableRefObject<THREE.AnimationAction | null>,
      currentStateRef: MutableRefObject<CharacterAnimState | null>,
      target: THREE.AnimationAction | null,
      targetState: CharacterAnimState | null,
      layerOptions: {
        desiredDurationSeconds?: number;
        fadeDurationSeconds: number;
        locomotionScale?: number;
        seekNormalizedTime?: number;
      },
    ) => {
      const currentAction = currentActionRef.current;
      if (!target || !targetState) {
        if (currentAction) {
          currentAction.fadeOut(layerOptions.fadeDurationSeconds);
          currentActionRef.current = null;
        }
        currentStateRef.current = null;
        return;
      }

      const seekNormalizedTime = layerOptions.seekNormalizedTime == null
        ? null
        : THREE.MathUtils.clamp(layerOptions.seekNormalizedTime, 0, 0.999);
      const targetSpeed =
        layerOptions.desiredDurationSeconds &&
          layerOptions.desiredDurationSeconds > 0
          ? target.getClip().duration / layerOptions.desiredDurationSeconds
          : resolveCharacterAnimTimeScale(targetState, {
            locomotionScale: layerOptions.locomotionScale,
          });

      if (currentAction && currentAction !== target) {
        // Phase sync: carry over gait cycle position between looping locomotion states
        const shouldPhaseSync =
          seekNormalizedTime === null &&
          currentStateRef.current !== null &&
          isPhaseSyncEligible(currentStateRef.current) &&
          isPhaseSyncEligible(targetState);

        target.reset();

        if (shouldPhaseSync) {
          const srcDur = currentAction.getClip().duration;
          if (srcDur > 0) {
            const normalizedPhase = (currentAction.time / srcDur) % 1;
            target.time = normalizedPhase * target.getClip().duration;
          }
        } else if (seekNormalizedTime !== null) {
          target.time = target.getClip().duration * seekNormalizedTime;
        }

        target.setEffectiveWeight(1);
        target.setEffectiveTimeScale(targetSpeed);
        target.timeScale = targetSpeed;
        target.play();

        // crossFadeFrom: synchronized weight interpolation (weights sum to 1.0)
        // warp=false: we control timeScale ourselves via locomotionScale
        target.crossFadeFrom(currentAction, layerOptions.fadeDurationSeconds, false);
      } else if (currentAction !== target) {
        // No current action — just fade in from scratch
        target.reset();
        if (seekNormalizedTime !== null) {
          target.time = target.getClip().duration * seekNormalizedTime;
        }
        target.setEffectiveWeight(1);
        target.setEffectiveTimeScale(targetSpeed);
        target.timeScale = targetSpeed;
        target.fadeIn(layerOptions.fadeDurationSeconds).play();
      } else {
        // Same action — just update speed and optionally seek
        target.setEffectiveTimeScale(targetSpeed);
        target.timeScale = targetSpeed;
        if (seekNormalizedTime !== null) {
          target.time = target.getClip().duration * seekNormalizedTime;
          target.play();
        }
      }

      currentActionRef.current = target;
      currentStateRef.current = targetState;
    };

    const lowerOverlayState = options?.lowerBodyState ?? null;
    const upperOverlayState = options?.upperBodyState ?? null;
    const useLowerBodyBase = upperOverlayState && !lowerOverlayState;
    const baseAction = useLowerBodyBase
      ? lowerBodyBaseActionsRef.current.get(state) ??
        fullActionsRef.current.get(state) ??
        null
      : fullActionsRef.current.get(state) ?? null;

    playLayer(currentBaseActionRef, currentBaseStateRef, baseAction, state, {
      desiredDurationSeconds: options?.desiredDurationSeconds,
      fadeDurationSeconds: fadeDuration,
      locomotionScale: options?.locomotionScale,
      seekNormalizedTime: options?.seekNormalizedTime,
    });

    playLayer(
      currentLowerBodyActionRef,
      currentLowerBodyStateRef,
      lowerOverlayState
        ? lowerBodyOverlayActionsRef.current.get(lowerOverlayState) ?? null
        : null,
      lowerOverlayState,
      {
        desiredDurationSeconds: options?.lowerBodyDesiredDurationSeconds,
        fadeDurationSeconds: Math.max(
          0,
          options?.lowerBodyFadeDurationSeconds ?? fadeDuration,
        ),
        locomotionScale: options?.lowerBodyLocomotionScale,
        seekNormalizedTime: options?.lowerBodySeekNormalizedTime,
      },
    );

    playLayer(
      currentUpperBodyActionRef,
      currentUpperBodyStateRef,
      upperOverlayState
        ? upperBodyActionsRef.current.get(upperOverlayState) ?? null
        : null,
      upperOverlayState,
      {
        desiredDurationSeconds: options?.upperBodyDesiredDurationSeconds,
        fadeDurationSeconds: Math.max(
          0,
          options?.upperBodyFadeDurationSeconds ?? fadeDuration,
        ),
        locomotionScale: options?.upperBodyLocomotionScale,
        seekNormalizedTime: options?.upperBodySeekNormalizedTime,
      },
    );
  }, []);

  const getFootstepSample = useCallback((): CharacterFootstepSample | null => {
    const sampleFrom = (
      action: THREE.AnimationAction | null,
      state: CharacterAnimState | null,
    ): CharacterFootstepSample | null => {
      if (!action || !state || !isFootstepLocomotionState(state)) {
        return null;
      }
      const duration = action.getClip().duration;
      if (!(duration > 0)) {
        return null;
      }
      return {
        state,
        normalizedTime: THREE.MathUtils.euclideanModulo(action.time, duration) /
          duration,
      };
    };

    return sampleFrom(
      currentLowerBodyActionRef.current,
      currentLowerBodyStateRef.current,
    ) ?? sampleFrom(currentBaseActionRef.current, currentBaseStateRef.current);
  }, []);

  const getCurrentAnimState = useCallback(
    (): CharacterAnimState | null => currentBaseStateRef.current,
    [],
  );

  return { model, ready, setAnimState, getFootstepSample, getCurrentAnimState };
}
