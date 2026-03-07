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
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { sharedAudioManager, type AudioVolumeSettings } from "../Audio";
import {
  usePlayerController,
  type PlayerControllerApi,
} from "../PlayerController";
import {
  raycastTargets,
  type TargetRaycastHit,
} from "../Targets";
import {
  WeaponSystem,
  type SniperRechamberState,
  type WeaponKind,
  type WeaponShotEvent,
  type WeaponSwitchState,
} from "../Weapon";
import type {
  CollisionRect,
  GameSettings,
  PerfMetrics,
  PlayerSnapshot,
  ScenePresentation,
  TargetState,
  WeaponAlignmentOffset,
  WorldBounds,
} from "../types";
import {
  normalizeBoneName,
  resolveFootstepIntervalSeconds,
  resolveFootstepPlaybackRate,
  useCharacterModel,
} from "./CharacterModel";
import { PATH_POINTS } from "./DesertProps";
import { BloodImpactMarks, BulletImpactMarks } from "./ImpactMarks";
import {
  computeWeaponMuzzleOffset,
  WeaponModelInstance,
  useWeaponModels,
} from "./WeaponModels";
import {
  BLOOD_SPLAT_LIFETIME_MS,
  BLOOD_SPLAT_SURFACE_OFFSET,
  BULLET_HIT_EPSILON,
  BULLET_IMPACT_CLEANUP_INTERVAL_MS,
  BULLET_IMPACT_LIFETIME_MS,
  BULLET_IMPACT_MARK_SURFACE_OFFSET,
  CHARACTER_YAW_OFFSET,
  MAX_BLOOD_SPLAT_MARKS,
  MAX_BULLET_IMPACT_MARKS,
  MIN_TRACER_DISTANCE,
  PLAYER_SPAWN_PITCH,
  PLAYER_SPAWN_POSITION,
  PLAYER_SPAWN_YAW,
  TRACER_CAMERA_START_OFFSET,
  TRACER_DISTANCE,
  TRACER_MUZZLE_FORWARD_OFFSET,
  WEAPON_MODEL_TRANSFORMS,
  Z_AXIS,
  type BloodSplatMark,
  type BulletImpactMark,
  type CharacterAnimState,
  type WorldRaycastHit,
} from "./scene-constants";

export type HitMarkerKind = "body" | "head" | "kill";
export type AimingState = {
  ads: boolean;
  firstPerson: boolean;
};

export type GameplayRuntimeHandle = {
  requestPointerLock: () => void;
  releasePointerLock: () => void;
  dropWeaponForReturn: () => void;
  resetForMenu: () => void;
};

type GameplayRuntimeProps = {
  collisionRects: CollisionRect[];
  worldBounds: WorldBounds;
  audioVolumes: AudioVolumeSettings;
  presentation: ScenePresentation;
  sensitivity: GameSettings["sensitivity"];
  keybinds: GameSettings["keybinds"];
  fov: number;
  weaponAlignment: WeaponAlignmentOffset;
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
  onCriticalAssetsReadyChange?: (ready: boolean) => void;
};

const MENU_LOOK_HEIGHT = 1.06;
const MENU_FRONT_DISTANCE = 2.9;
const MENU_FRONT_HEIGHT = 1.2;
const MENU_SIDE_DRIFT = 0.16;
const MENU_VERTICAL_DRIFT = 0.04;
const MENU_LOOK_DRIFT = 0.08;
// Aligned with PlayerController: CAMERA_ARM_LENGTH=2.25, CAMERA_DEFAULT_ELEVATION=0.35
// horizontalDist = 2.25 * cos(0.35) ≈ 2.11, verticalDist = 2.25 * sin(0.35) ≈ 0.77
// camera.y = LOOK_AT_HEIGHT(1.2) + verticalDist(0.77) ≈ 1.97
const TRANSITION_BACK_DISTANCE = 2.11;
const TRANSITION_BACK_HEIGHT = 1.97;
const TRANSITION_SHOULDER = 0.5;
const TRANSITION_LOOK_DISTANCE = 14;

function resolveShotDamage(
  shot: WeaponShotEvent,
  targetHit: TargetRaycastHit,
): number {
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
    const t = clamp01(
      (targetHit.distance - oneShotRange) / (falloffEndRange - oneShotRange),
    );
    const headDamage = THREE.MathUtils.lerp(125, 62, t);
    return Math.round(headDamage);
  }

  if (targetHit.zone === "leg") {
    return Math.max(1, Math.round(shot.damage * 0.84));
  }

  return shot.damage;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function easeInOutCubic(value: number) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function updateWorldGunMesh(
  mesh: THREE.Group | null,
  rifleModel: THREE.Group | null,
  sniperModel: THREE.Group | null,
  weapon: WeaponSystem,
  nowMs: number,
  switchState: WeaponSwitchState,
  reveal: number,
) {
  if (!mesh) {
    return;
  }

  const visible = !weapon.isEquipped() && reveal > 0.02;
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
  mesh.scale.setScalar(0.82 + reveal * 0.18);
  mesh.position.set(
    droppedPosition.x,
    droppedPosition.y + Math.sin(nowMs * 0.006) * 0.04 + (1 - reveal) * 0.18,
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
  anchor: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null,
  alignment: WeaponAlignmentOffset,
  rifleMuzzleOffset: THREE.Vector3,
  sniperMuzzleOffset: THREE.Vector3,
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
  const switchBlend = switchState.active
    ? Math.sin(Math.PI * switchState.progress)
    : 0;
  if (anchor) {
    weaponGroup.position.copy(anchor.position);
    weaponGroup.quaternion.copy(anchor.quaternion);
    weaponGroup.translateX(alignment.posX);
    weaponGroup.translateY(alignment.posY);
    weaponGroup.translateZ(alignment.posZ);
    weaponGroup.rotateX(alignment.rotX);
    weaponGroup.rotateY(alignment.rotY);
    weaponGroup.rotateZ(alignment.rotZ);
    if (switchBlend > 0) {
      weaponGroup.translateY(-switchBlend * 0.06);
      weaponGroup.rotateX(-switchBlend * 0.35);
    }
  } else {
    weaponGroup.position.set(
      0.34,
      0.82 - switchBlend * 0.18,
      -0.2 + switchBlend * 0.06,
    );
    weaponGroup.rotation.set(
      -switchBlend * 0.42,
      switchBlend * 0.05,
      -switchBlend * 0.12,
    );
  }

  if (rifleModel) {
    rifleModel.visible = displayedWeapon === "rifle";
  }
  if (sniperModel) {
    sniperModel.visible = displayedWeapon === "sniper";
  }

  if (muzzleFlashMesh) {
    if (displayedWeapon === "sniper") {
      muzzleFlashMesh.position.copy(sniperMuzzleOffset);
      muzzleFlashMesh.scale.setScalar(1.15);
    } else {
      muzzleFlashMesh.position.copy(rifleMuzzleOffset);
      muzzleFlashMesh.scale.setScalar(1);
    }
    muzzleFlashMesh.visible = weapon.hasMuzzleFlash(nowMs);
  }
}

function resolveDisplayedWeapon(
  weapon: WeaponSystem,
  switchState: WeaponSwitchState,
): WeaponKind {
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
  hittables: THREE.Object3D[],
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  raycaster: THREE.Raycaster,
  tempNormal: THREE.Vector3,
  tempNormalMatrix: THREE.Matrix3,
  maxDistance = Number.POSITIVE_INFINITY,
): WorldRaycastHit | null {
  if (maxDistance <= 0 || hittables.length === 0) {
    return null;
  }

  raycaster.near = 0;
  raycaster.far = maxDistance;
  raycaster.set(origin, direction);
  const intersections = raycaster.intersectObjects(hittables, false);

  for (const intersection of intersections) {
    if (intersection.distance <= 0 || intersection.distance > maxDistance) {
      continue;
    }

    const object = intersection.object;
    if (intersection.face) {
      tempNormal.copy(intersection.face.normal);
      tempNormalMatrix.getNormalMatrix(object.matrixWorld);
      tempNormal.applyMatrix3(tempNormalMatrix).normalize();
    } else {
      tempNormal.set(0, 1, 0);
    }

    return {
      point: intersection.point,
      normal: tempNormal,
      distance: intersection.distance,
    };
  }

  return null;
}

export const GameplayRuntime = forwardRef<
  GameplayRuntimeHandle,
  GameplayRuntimeProps
>(function GameplayRuntime({
  collisionRects,
  worldBounds,
  audioVolumes,
  presentation,
  sensitivity,
  keybinds,
  fov,
  weaponAlignment,
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
  onCriticalAssetsReadyChange,
}: GameplayRuntimeProps, ref) {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);

  const {
    model: characterModel,
    ready: characterReady,
    setAnimState: setCharacterAnim,
  } = useCharacterModel();
  const weaponModels = useWeaponModels();
  const rifleMuzzleOffsetRef = useRef(new THREE.Vector3(-0.44, 0.02, 0));
  const sniperMuzzleOffsetRef = useRef(new THREE.Vector3(-0.66, 0.02, 0));

  useEffect(() => {
    if (weaponModels.rifle) {
      rifleMuzzleOffsetRef.current = computeWeaponMuzzleOffset(
        weaponModels.rifle,
        WEAPON_MODEL_TRANSFORMS.character.rifle,
      );
    }
    if (weaponModels.sniper) {
      sniperMuzzleOffsetRef.current = computeWeaponMuzzleOffset(
        weaponModels.sniper,
        WEAPON_MODEL_TRANSFORMS.character.sniper,
      );
    }
  }, [weaponModels]);

  const weaponRef = useRef<WeaponSystem>(new WeaponSystem());
  const audioRef = useRef(sharedAudioManager);
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
  const menuCharacterKeyLightRef = useRef<THREE.PointLight>(null);
  const menuCharacterRimLightRef = useRef<THREE.PointLight>(null);
  const playerCharacterRef = useRef<THREE.Group>(null);
  const characterWeaponRef = useRef<THREE.Group>(null);
  const characterRifleModelRef = useRef<THREE.Group>(null);
  const characterSniperModelRef = useRef<THREE.Group>(null);
  const characterMuzzleRef = useRef<THREE.Mesh>(null);
  const tracerRef = useRef<THREE.Mesh>(null);

  const tempEndRef = useRef(new THREE.Vector3());
  const tempMidRef = useRef(new THREE.Vector3());
  const tempTracerDirRef = useRef(new THREE.Vector3());
  const tempLookDirRef = useRef(new THREE.Vector3());
  const tempAimPointRef = useRef(new THREE.Vector3());
  const tempFireDirectionRef = useRef(new THREE.Vector3());
  const tempTracerOriginRef = useRef(new THREE.Vector3());
  const tempImpactNormalRef = useRef(new THREE.Vector3());
  const tempImpactNormalMatrixRef = useRef(new THREE.Matrix3());
  const tempImpactQuaternionRef = useRef(new THREE.Quaternion());
  const tempImpactPositionRef = useRef(new THREE.Vector3());
  const tempBloodTangentRef = useRef(new THREE.Vector3());
  const tempBloodBitangentRef = useRef(new THREE.Vector3());
  const tempBloodSpreadOffsetRef = useRef(new THREE.Vector3());
  const tempBloodRollQuaternionRef = useRef(new THREE.Quaternion());
  const raycasterRef = useRef(new THREE.Raycaster());
  const bulletHittableMeshesRef = useRef<THREE.Object3D[]>([]);
  const bulletHittableMeshesDirtyRef = useRef(true);
  const impactIdRef = useRef(0);
  const bloodSplatIdRef = useRef(0);
  const lastImpactCleanupAtRef = useRef(0);
  const lastSniperRechamberActiveRef = useRef<boolean | null>(null);
  const lastSniperRechamberProgressStepRef = useRef(-1);
  const characterWeaponAttachBoneRef = useRef<THREE.Bone | null>(null);
  const characterHeadBoneRef = useRef<THREE.Bone | null>(null);
  const tempCharacterWeaponAnchorWorldRef = useRef(new THREE.Vector3());
  const tempBoneWorldQuatRef = useRef(new THREE.Quaternion());
  const characterWeaponAnchorRef = useRef<{
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
  } | null>(null);
  const audioUpdateOptionsRef = useRef({
    stepIntervalSeconds: 0,
    filePlaybackRate: 1,
    surface: "dirt" as "rock" | "dirt",
  });
  const returningFreezePosRef = useRef(new THREE.Vector3());
  const returningFreezeLookRef = useRef(new THREE.Vector3());
  const lastPhaseRef = useRef(presentation.phase);
  const transitionForwardRef = useRef(new THREE.Vector3());
  const transitionRightRef = useRef(new THREE.Vector3());
  const transitionFrontPosRef = useRef(new THREE.Vector3());
  const transitionFrontLookRef = useRef(new THREE.Vector3());
  const transitionBackPosRef = useRef(new THREE.Vector3());
  const transitionBackLookRef = useRef(new THREE.Vector3());

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
      characterHeadBoneRef.current = null;
      return;
    }

    let rightHandBone: THREE.Bone | null = null;
    let headBone: THREE.Bone | null = null;
    characterModel.traverse((child) => {
      if (!(child as THREE.Bone).isBone) return;
      const bone = child as THREE.Bone;
      const normalized = normalizeBoneName(bone.name).toLowerCase();
      if (
        !rightHandBone &&
        (normalized === "r_hand" ||
          normalized === "righthand" ||
          normalized === "right_hand" ||
          normalized === "hand_r" ||
          normalized === "hand.r" ||
          normalized.includes("r_hand") ||
          normalized.includes("right_hand") ||
          normalized.includes("righthand") ||
          normalized.includes("hand_r"))
      ) {
        rightHandBone = bone;
      }
      if (
        !headBone &&
        (normalized === "head" ||
          normalized === "head_end" ||
          normalized.includes("head"))
      ) {
        if (normalized === "head") {
          headBone = bone;
        } else if (!headBone) {
          headBone = bone;
        }
      }
    });

    characterWeaponAttachBoneRef.current = rightHandBone;
    characterHeadBoneRef.current = headBone;
    if (!rightHandBone) {
      console.warn("[Character] Could not find right-hand bone for weapon attach");
    }
  }, [characterModel]);

  useEffect(() => {
    audioRef.current.setVolumes(audioVolumes);
  }, [audioVolumes]);

  useEffect(() => {
    onCriticalAssetsReadyChange?.(characterReady && weaponModels.ready);
  }, [characterReady, onCriticalAssetsReadyChange, weaponModels.ready]);

  const pushImpactMark = useCallback(
    (point: THREE.Vector3, normal: THREE.Vector3) => {
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
      const quaternion = tempImpactQuaternionRef.current.setFromUnitVectors(
        Z_AXIS,
        safeNormal,
      );
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
    },
    [],
  );

  const pushBloodSpray = useCallback(
    (point: THREE.Vector3, normal: THREE.Vector3, hitType: "body" | "head") => {
      const safeNormal = tempImpactNormalRef.current;
      safeNormal.copy(normal);
      if (safeNormal.lengthSq() < 1e-6) {
        safeNormal.set(0, 1, 0);
      } else {
        safeNormal.normalize();
      }

      const tangent = tempBloodTangentRef.current;
      tangent.set(
        Math.abs(safeNormal.y) > 0.9 ? 1 : 0,
        Math.abs(safeNormal.y) > 0.9 ? 0 : 1,
        0,
      );
      tangent.cross(safeNormal).normalize();
      const bitangent = tempBloodBitangentRef.current
        .copy(safeNormal)
        .cross(tangent)
        .normalize();

      const nowMs = performance.now();
      const splatCount = hitType === "head" ? 9 : 6;
      const spread = hitType === "head" ? 0.2 : 0.13;
      const lifetimeMs = hitType === "head"
        ? BLOOD_SPLAT_LIFETIME_MS + 220
        : BLOOD_SPLAT_LIFETIME_MS;
      const nextSplats: BloodSplatMark[] = [];

      for (let i = 0; i < splatCount; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const radial =
          (0.018 + Math.random() * spread) * (0.55 + Math.random() * 0.65);
        const offset = tempBloodSpreadOffsetRef.current
          .copy(tangent)
          .multiplyScalar(Math.cos(angle) * radial)
          .addScaledVector(bitangent, Math.sin(angle) * radial)
          .addScaledVector(
            safeNormal,
            BLOOD_SPLAT_SURFACE_OFFSET + Math.random() * 0.012,
          );

        const position = tempImpactPositionRef.current.copy(point).add(offset);
        const quaternion = tempImpactQuaternionRef.current.setFromUnitVectors(
          Z_AXIS,
          safeNormal,
        );
        tempBloodRollQuaternionRef.current.setFromAxisAngle(
          safeNormal,
          (Math.random() - 0.5) * Math.PI,
        );
        quaternion.multiply(tempBloodRollQuaternionRef.current);

        nextSplats.push({
          id: bloodSplatIdRef.current,
          expiresAt: nowMs + lifetimeMs + Math.random() * 140,
          position: [position.x, position.y, position.z],
          quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
          radius: (hitType === "head" ? 0.065 : 0.05) *
            (0.5 + Math.random() * 0.9),
          opacity: hitType === "head"
            ? 0.92 - Math.random() * 0.2
            : 0.8 - Math.random() * 0.2,
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
    },
    [],
  );

  const handleAction = useCallback(
    (action: string) => {
      const weapon = weaponRef.current;
      if (action === "equipRifle") {
        audioRef.current.cancelSniperShelling();
        weapon.switchWeapon("rifle", performance.now());
        return;
      }
      if (action === "equipSniper") {
        audioRef.current.cancelSniperShelling();
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
      }
    },
    [camera],
  );

  const handlePlayerSnapshot = useCallback((snapshot: PlayerSnapshot) => {
    const playerPosition = controllerRef.current?.getPosition();
    const canInteract = playerPosition && presentation.inputEnabled
      ? weaponRef.current.canPickup(playerPosition)
      : false;
    playerSnapshotCallbackRef.current({
      ...snapshot,
      canInteract,
    });
  }, [presentation.inputEnabled]);

  const handleTriggerChange = useCallback((firing: boolean) => {
    weaponRef.current.setTriggerHeld(firing);
  }, []);

  const handleUserGesture = useCallback(() => {
    audioRef.current.ensureStarted();
  }, []);

  const handleGetActiveWeapon = useCallback(() => {
    return weaponRef.current.getActiveWeapon();
  }, []);

  const targetCollisionCircles = useMemo(
    () =>
      targets
        .filter((target) => !target.disabled)
        .map((target) => {
          const [x, , z] = target.position;
          return {
            x,
            z,
            radius: target.radius,
          };
        }),
    [targets],
  );

  const controller = usePlayerController({
    collisionRects,
    collisionCircles: targetCollisionCircles,
    worldBounds,
    sensitivity,
    keybinds,
    fov,
    inputEnabled: presentation.inputEnabled,
    cameraEnabled: presentation.phase === "playing",
    onAction: handleAction,
    onPlayerSnapshot: handlePlayerSnapshot,
    onTriggerChange: handleTriggerChange,
    onUserGesture: handleUserGesture,
    getActiveWeapon: handleGetActiveWeapon,
  });

  controllerRef.current = controller;

  const resetForMenu = useCallback(() => {
    audioRef.current.cancelSniperShelling();
    weaponRef.current.reset();
    controllerRef.current?.setPose(
      PLAYER_SPAWN_POSITION,
      PLAYER_SPAWN_YAW,
      PLAYER_SPAWN_PITCH,
    );
    setImpactMarks([]);
    setBloodSplats([]);
    impactIdRef.current = 0;
    bloodSplatIdRef.current = 0;
    lastImpactCleanupAtRef.current = performance.now();
    lastWeaponEquippedRef.current = false;
    lastActiveWeaponRef.current = "rifle";
    lastADSRef.current = false;
    lastFirstPersonRef.current = false;
    lastSniperRechamberActiveRef.current = false;
    lastSniperRechamberProgressStepRef.current = 100;
    weaponEquippedCallbackRef.current(false);
    activeWeaponCallbackRef.current("rifle");
    sniperRechamberCallbackRef.current({
      active: false,
      progress: 1,
      remainingMs: 0,
    });
    aimingStateCallbackRef.current({
      ads: false,
      firstPerson: false,
    });
  }, []);

  useImperativeHandle(ref, () => ({
    requestPointerLock: () => {
      controllerRef.current?.requestPointerLock();
    },
    releasePointerLock: () => {
      controllerRef.current?.releasePointerLock();
    },
    dropWeaponForReturn: () => {
      const playerPosition = controllerRef.current?.getPosition();
      if (!playerPosition) {
        return;
      }
      camera.getWorldDirection(tempLookDirRef.current);
      if (weaponRef.current.drop(playerPosition, tempLookDirRef.current)) {
        weaponEquippedCallbackRef.current(false);
      }
    },
    resetForMenu,
  }), [camera, resetForMenu]);

  useEffect(() => {
    if (lastPhaseRef.current === presentation.phase) {
      return;
    }
    if (presentation.phase === "returning") {
      returningFreezePosRef.current.copy(camera.position);
      camera.getWorldDirection(tempLookDirRef.current);
      returningFreezeLookRef.current
        .copy(camera.position)
        .addScaledVector(tempLookDirRef.current, 24);
    }
    lastPhaseRef.current = presentation.phase;
  }, [camera, presentation.phase]);

  useFrame((_, delta) => {
    const clampedDelta = Math.min(delta, 1 / 20);
    const nowMs = performance.now();
    const weapon = weaponRef.current;
    const audio = audioRef.current;

    if (
      nowMs - lastImpactCleanupAtRef.current >=
      BULLET_IMPACT_CLEANUP_INTERVAL_MS
    ) {
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
    const sniperRechamberProgressStep = Math.floor(
      sniperRechamber.progress * 100,
    );
    const previousSniperRechamberActive = lastSniperRechamberActiveRef.current;
    if (
      previousSniperRechamberActive !== sniperRechamber.active ||
      lastSniperRechamberProgressStepRef.current !==
        sniperRechamberProgressStep
    ) {
      lastSniperRechamberActiveRef.current = sniperRechamber.active;
      lastSniperRechamberProgressStepRef.current = sniperRechamberProgressStep;
      sniperRechamberCallbackRef.current(sniperRechamber);
      if (
        !previousSniperRechamberActive &&
        sniperRechamber.active &&
        weapon.getActiveWeapon() === "sniper"
      ) {
        audio.playSniperShelling();
      }
    }

    const moving = controller.isMoving() && controller.isGrounded();
    const sprinting = controller.isSprinting();
    const weaponEquipped = weapon.isEquipped();
    const moveInput = controller.getMoveInput();
    const moveX = moveInput.x;
    const moveY = moveInput.y;
    const hasDirectionalInput =
      Math.abs(moveX) > 0.05 || Math.abs(moveY) > 0.05;
    const movementActive = moving && hasDirectionalInput;

    let nextAnimState: CharacterAnimState = weaponEquipped
      ? "rifleIdle"
      : "idle";
    if (movementActive) {
      if (
        !weaponEquipped &&
        sprinting &&
        moveY > 0.2 &&
        Math.abs(moveX) < 0.35
      ) {
        nextAnimState = "sprint";
      } else if (Math.abs(moveY) >= Math.abs(moveX)) {
        nextAnimState = moveY >= 0
          ? (weaponEquipped ? "rifleWalk" : "walk")
          : (weaponEquipped ? "rifleWalkBack" : "walkBack");
      } else if (moveX >= 0) {
        nextAnimState = weaponEquipped ? "rifleWalkRight" : "walkRight";
      } else {
        nextAnimState = weaponEquipped ? "rifleWalkLeft" : "walkLeft";
      }
    }

    setCharacterAnim(nextAnimState);
    const audioOpts = audioUpdateOptionsRef.current;
    audioOpts.stepIntervalSeconds = resolveFootstepIntervalSeconds(
      nextAnimState,
    );
    audioOpts.filePlaybackRate = resolveFootstepPlaybackRate(nextAnimState);

    const playerPos = controller.getPosition();
    let onRock = false;
    const rockRadius = 6;
    for (const [px, pz] of PATH_POINTS) {
      const dx = playerPos.x - px;
      const dz = playerPos.z - pz;
      if (dx * dx + dz * dz < rockRadius * rockRadius) {
        onRock = true;
        break;
      }
    }
    audioOpts.surface = onRock ? "rock" : "dirt";

    audio.update(
      nowMs / 1000,
      movementActive,
      nextAnimState === "sprint",
      audioOpts,
    );

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
      const position = controller.getPosition();
      playerChar.position.set(position.x, position.y, position.z);
      playerChar.rotation.y = controller.getYaw() + CHARACTER_YAW_OFFSET;
      playerChar.visible = true;
      playerChar.updateMatrixWorld(true);
    }

    const headBone = characterHeadBoneRef.current;
    if (headBone) {
      headBone.scale.setScalar(
        presentation.phase === "playing" && firstPerson ? 0 : 1,
      );
    }

    if (characterModel) {
      const mixer = characterModel.userData.__mixer as
        | THREE.AnimationMixer
        | undefined;
      if (mixer) {
        mixer.update(clampedDelta);
      }
    }

    const switchState = weapon.getSwitchState(nowMs);
    const handBone = characterWeaponAttachBoneRef.current;
    let characterWeaponAnchor = characterWeaponAnchorRef.current;
    if (handBone) {
      handBone.getWorldPosition(tempCharacterWeaponAnchorWorldRef.current);
      handBone.getWorldQuaternion(tempBoneWorldQuatRef.current);
      if (!characterWeaponAnchor) {
        characterWeaponAnchor = {
          position: tempCharacterWeaponAnchorWorldRef.current,
          quaternion: tempBoneWorldQuatRef.current,
        };
        characterWeaponAnchorRef.current = characterWeaponAnchor;
      }
    } else {
      characterWeaponAnchor = null;
    }
    updateCharacterWeaponMesh(
      characterWeaponRef.current,
      characterRifleModelRef.current,
      characterSniperModelRef.current,
      characterMuzzleRef.current,
      weapon,
      nowMs,
      switchState,
      characterWeaponAnchor,
      weaponAlignment,
      rifleMuzzleOffsetRef.current,
      sniperMuzzleOffsetRef.current,
    );

    const shots = weapon.update(clampedDelta, nowMs, camera);
    if (shots.length > 0 && bulletHittableMeshesDirtyRef.current) {
      const meshes: THREE.Object3D[] = [];
      scene.traverse((child) => {
        if (
          (child as THREE.Mesh).isMesh &&
          child.userData?.bulletHittable === true
        ) {
          meshes.push(child);
        }
      });
      bulletHittableMeshesRef.current = meshes;
      bulletHittableMeshesDirtyRef.current = false;
    }

    for (const shot of shots) {
      audio.playGunshot(shot.weaponType);
      if (shot.recoilPitchRadians !== 0 || shot.recoilYawRadians !== 0) {
        controller.addRecoil(shot.recoilPitchRadians, shot.recoilYawRadians);
      }

      const cameraTargetHit = raycastTargets(
        shot.origin,
        shot.direction,
        targetsRef.current,
      );
      const cameraWorldHit = raycastBulletWorld(
        bulletHittableMeshesRef.current,
        shot.origin,
        shot.direction,
        raycasterRef.current,
        tempImpactNormalRef.current,
        tempImpactNormalMatrixRef.current,
      );

      const tracerOrigin = tempTracerOriginRef.current;
      const muzzle = characterMuzzleRef.current;
      const usedMuzzle = !!muzzle && !!playerChar?.visible;
      if (usedMuzzle) {
        muzzle.getWorldPosition(tracerOrigin);
      } else {
        tracerOrigin.copy(shot.origin);
      }

      const cameraTargetVisible =
        !!cameraTargetHit &&
        (!cameraWorldHit ||
          cameraTargetHit.distance <=
            cameraWorldHit.distance + BULLET_HIT_EPSILON);

      const aimPoint = tempAimPointRef.current;
      if (cameraTargetHit && cameraTargetVisible) {
        aimPoint.copy(cameraTargetHit.point);
      } else if (cameraWorldHit) {
        aimPoint.copy(cameraWorldHit.point);
      } else {
        aimPoint.copy(shot.origin).addScaledVector(shot.direction, TRACER_DISTANCE);
      }

      const fireDirection = tempFireDirectionRef.current;
      fireDirection.copy(aimPoint).sub(tracerOrigin);
      let fireDistance = fireDirection.length();
      if (fireDistance > BULLET_HIT_EPSILON) {
        fireDirection.multiplyScalar(1 / fireDistance);
      } else {
        fireDirection.copy(shot.direction);
        fireDistance = TRACER_DISTANCE;
      }

      if (usedMuzzle) {
        tracerOrigin.addScaledVector(
          fireDirection,
          TRACER_MUZZLE_FORWARD_OFFSET,
        );
        fireDirection.copy(aimPoint).sub(tracerOrigin);
        fireDistance = fireDirection.length();
        if (fireDistance > BULLET_HIT_EPSILON) {
          fireDirection.multiplyScalar(1 / fireDistance);
        } else {
          fireDirection.copy(shot.direction);
          fireDistance = TRACER_DISTANCE;
        }
      }

      const maxFireDistance = fireDistance + BULLET_HIT_EPSILON;
      const targetHit = raycastTargets(
        tracerOrigin,
        fireDirection,
        targetsRef.current,
        maxFireDistance,
      );
      const worldHit = raycastBulletWorld(
        bulletHittableMeshesRef.current,
        tracerOrigin,
        fireDirection,
        raycasterRef.current,
        tempImpactNormalRef.current,
        tempImpactNormalMatrixRef.current,
        maxFireDistance,
      );
      const targetVisible =
        !!targetHit &&
        (!worldHit ||
          targetHit.distance <= worldHit.distance + BULLET_HIT_EPSILON);
      const cameraTargetDistanceFromMuzzle = cameraTargetHit
        ? tracerOrigin.distanceTo(cameraTargetHit.point)
        : Number.POSITIVE_INFINITY;
      const cameraTargetReachableFromMuzzle =
        !!cameraTargetHit &&
        (!worldHit ||
          cameraTargetDistanceFromMuzzle <=
            worldHit.distance + BULLET_HIT_EPSILON);
      const preferCameraTarget =
        !!cameraTargetHit &&
        cameraTargetVisible &&
        cameraTargetReachableFromMuzzle &&
        (!targetHit || targetHit.id === cameraTargetHit.id);
      const resolvedTargetHit = preferCameraTarget
        ? {
            ...cameraTargetHit,
            distance: cameraTargetDistanceFromMuzzle,
          }
        : targetVisible
        ? targetHit
        : null;

      if (resolvedTargetHit) {
        tempEndRef.current.copy(resolvedTargetHit.point);
        const resolvedDamage = resolveShotDamage(shot, resolvedTargetHit);
        const targetBeforeHit = targetsRef.current.find((target) =>
          target.id === resolvedTargetHit.id
        );
        const killed = targetBeforeHit
          ? targetBeforeHit.hp - resolvedDamage <= 0
          : false;
        const hitType = resolvedTargetHit.zone === "head" ? "head" : "body";

        pushBloodSpray(resolvedTargetHit.point, resolvedTargetHit.normal, hitType);
        targetHitCallbackRef.current(resolvedTargetHit.id, resolvedDamage, nowMs);
        hitMarkerCallbackRef.current(killed ? "kill" : hitType);
        if (killed) {
          audio.playKill();
        }
      } else if (worldHit) {
        tempEndRef.current.copy(worldHit.point);
        pushImpactMark(worldHit.point, worldHit.normal);
      } else {
        tempEndRef.current.copy(aimPoint);
      }

      if (
        !usedMuzzle &&
        tracerOrigin.distanceToSquared(tempEndRef.current) >
          (TRACER_CAMERA_START_OFFSET + 0.04) ** 2
      ) {
        tracerOrigin.addScaledVector(fireDirection, TRACER_CAMERA_START_OFFSET);
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
      presentation.pickupReveal,
    );
    updateTracerMesh(
      tracerRef.current,
      weapon,
      nowMs,
      tempMidRef.current,
      tempTracerDirRef.current,
    );

    if (presentation.phase !== "playing") {
      const position = controller.getPosition();
      const yaw = controller.getYaw();
      const phaseProgress = clamp01(presentation.phaseProgress);
      const forward = transitionForwardRef.current.set(
        -Math.sin(yaw),
        0,
        -Math.cos(yaw),
      );
      const right = transitionRightRef.current.set(
        Math.cos(yaw),
        0,
        -Math.sin(yaw),
      );
      const swayX = Math.sin(nowMs * 0.00075);
      const swayY = Math.sin(nowMs * 0.00105);
      const frontPos = transitionFrontPosRef.current
        .copy(position)
        .addScaledVector(forward, MENU_FRONT_DISTANCE)
        .addScaledVector(right, swayX * MENU_SIDE_DRIFT);
      frontPos.y = position.y + MENU_FRONT_HEIGHT + swayY * MENU_VERTICAL_DRIFT;
      const frontLook = transitionFrontLookRef.current.copy(position);
      frontLook.y = position.y + MENU_LOOK_HEIGHT;
      frontLook.addScaledVector(right, swayX * MENU_LOOK_DRIFT);
      const backPos = transitionBackPosRef.current
        .copy(position)
        .addScaledVector(forward, -TRANSITION_BACK_DISTANCE)
        .addScaledVector(right, TRANSITION_SHOULDER);
      backPos.y = position.y + TRANSITION_BACK_HEIGHT;
      const backLook = transitionBackLookRef.current.copy(position);
      backLook.y = position.y + 1.16;
      backLook
        .addScaledVector(forward, TRANSITION_LOOK_DISTANCE)
        .addScaledVector(right, TRANSITION_SHOULDER * 0.9);
      const menuLightBlend = presentation.phase === "menu"
        ? 1
        : presentation.phase === "entering"
        ? 1 - clamp01(phaseProgress / 0.72)
        : phaseProgress < 0.52
        ? 0
        : clamp01((phaseProgress - 0.52) / 0.22);

      const keyLight = menuCharacterKeyLightRef.current;
      if (keyLight) {
        keyLight.visible = menuLightBlend > 0.001;
        keyLight.intensity = 5.0 * menuLightBlend;
        keyLight.position.copy(frontPos);
        keyLight.position.y += 0.34;
        keyLight.position.addScaledVector(right, 0.14);
      }

      const rimLight = menuCharacterRimLightRef.current;
      if (rimLight) {
        rimLight.visible = menuLightBlend > 0.001;
        rimLight.intensity = 0.85 * menuLightBlend;
        rimLight.position.copy(position);
        rimLight.position.addScaledVector(forward, -1.55);
        rimLight.position.addScaledVector(right, -0.8);
        rimLight.position.y = position.y + 1.86;
      }

      if (presentation.phase === "menu") {
        camera.position.copy(frontPos);
        camera.lookAt(frontLook);
      } else if (presentation.phase === "entering") {
        const blend = easeInOutCubic(phaseProgress);
        camera.position.lerpVectors(frontPos, backPos, blend);
        tempAimPointRef.current.lerpVectors(frontLook, backLook, blend);
        camera.lookAt(tempAimPointRef.current);
      } else if (presentation.phase === "returning") {
        if (phaseProgress < 0.52) {
          camera.position.copy(returningFreezePosRef.current);
          camera.lookAt(returningFreezeLookRef.current);
        } else {
          camera.position.copy(frontPos);
          camera.lookAt(frontLook);
        }
      }

      if ("isPerspectiveCamera" in camera && camera.isPerspectiveCamera) {
        const perspectiveCamera = camera as THREE.PerspectiveCamera;
        const phaseFov = presentation.phase === "entering"
          ? THREE.MathUtils.lerp(40, fov, easeInOutCubic(phaseProgress))
          : presentation.phase === "returning"
          ? THREE.MathUtils.lerp(fov, 40, easeInOutCubic(phaseProgress))
          : 40;
        const nextFov = THREE.MathUtils.damp(
          perspectiveCamera.fov,
          phaseFov,
          10,
          clampedDelta,
        );
        if (Math.abs(nextFov - perspectiveCamera.fov) > 0.01) {
          perspectiveCamera.fov = nextFov;
          perspectiveCamera.updateProjectionMatrix();
        }
      }
    } else {
      const keyLight = menuCharacterKeyLightRef.current;
      if (keyLight) {
        keyLight.visible = false;
        keyLight.intensity = 0;
      }
      const rimLight = menuCharacterRimLightRef.current;
      if (rimLight) {
        rimLight.visible = false;
        rimLight.intensity = 0;
      }
    }

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
      const fps = fpsTimeRef.current > 0
        ? fpsFrameCountRef.current / fpsTimeRef.current
        : 0;
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
      <pointLight
        ref={menuCharacterKeyLightRef}
        position={[0, 0, 0]}
        intensity={0}
        distance={9}
        decay={1.55}
        color="#ffe7c8"
      />
      <pointLight
        ref={menuCharacterRimLightRef}
        position={[0, 0, 0]}
        intensity={0}
        distance={12}
        decay={2}
        color="#8eb5ff"
      />
      <group ref={playerCharacterRef}>
        {characterModel ? (
          <primitive object={characterModel} />
        ) : (
          <>
            <mesh position={[0, 1.0, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.4, 0.55, 0.25]} />
              <meshStandardMaterial
                color="#4a6b82"
                roughness={0.7}
                metalness={0.1}
              />
            </mesh>
            <mesh position={[0, 1.48, 0]} castShadow receiveShadow>
              <sphereGeometry args={[0.14, 12, 12]} />
              <meshStandardMaterial
                color="#e8c9a4"
                roughness={0.85}
                metalness={0}
              />
            </mesh>
            <mesh position={[-0.1, 0.3, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.14, 0.6, 0.16]} />
              <meshStandardMaterial
                color="#3a4d5c"
                roughness={0.8}
                metalness={0.05}
              />
            </mesh>
            <mesh position={[0.1, 0.3, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.14, 0.6, 0.16]} />
              <meshStandardMaterial
                color="#3a4d5c"
                roughness={0.8}
                metalness={0.05}
              />
            </mesh>
            <mesh position={[-0.28, 0.92, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.12, 0.48, 0.12]} />
              <meshStandardMaterial
                color="#4a6b82"
                roughness={0.7}
                metalness={0.1}
              />
            </mesh>
            <mesh position={[0.28, 0.92, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.12, 0.48, 0.12]} />
              <meshStandardMaterial
                color="#4a6b82"
                roughness={0.7}
                metalness={0.1}
              />
            </mesh>
          </>
        )}
      </group>

      <group ref={characterWeaponRef} visible={false}>
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
                <meshStandardMaterial
                  color="#30363c"
                  roughness={0.55}
                  metalness={0.4}
                />
              </mesh>
              <mesh
                position={[0.16, -0.08, 0.01]}
                rotation={[0.15, 0, -0.2]}
              >
                <boxGeometry args={[0.18, 0.17, 0.05]} />
                <meshStandardMaterial
                  color="#4d463f"
                  roughness={0.85}
                  metalness={0.1}
                />
              </mesh>
              <mesh
                position={[-0.24, 0.015, 0]}
                rotation={[0, 0, Math.PI / 2]}
              >
                <cylinderGeometry args={[0.015, 0.015, 0.42, 8]} />
                <meshStandardMaterial
                  color="#20262b"
                  roughness={0.4}
                  metalness={0.6}
                />
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
                <meshStandardMaterial
                  color="#2a3036"
                  roughness={0.53}
                  metalness={0.42}
                />
              </mesh>
              <mesh
                position={[0.2, -0.07, 0.01]}
                rotation={[0.14, 0, -0.2]}
              >
                <boxGeometry args={[0.2, 0.16, 0.05]} />
                <meshStandardMaterial
                  color="#4a4139"
                  roughness={0.86}
                  metalness={0.08}
                />
              </mesh>
              <mesh position={[-0.08, 0.07, 0]}>
                <cylinderGeometry args={[0.03, 0.03, 0.28, 12]} />
                <meshStandardMaterial
                  color="#1d2227"
                  roughness={0.42}
                  metalness={0.58}
                />
              </mesh>
              <mesh
                position={[-0.34, 0.01, 0]}
                rotation={[0, 0, Math.PI / 2]}
              >
                <cylinderGeometry args={[0.014, 0.014, 0.68, 10]} />
                <meshStandardMaterial
                  color="#1b2025"
                  roughness={0.45}
                  metalness={0.62}
                />
              </mesh>
            </>
          )}
        </group>
        <mesh ref={characterMuzzleRef} position={[0, 0, 0]} visible={false}>
          <sphereGeometry args={[0.05, 8, 8]} />
          <meshBasicMaterial color="#ffd085" transparent opacity={0.9} />
        </mesh>
      </group>

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
                <meshStandardMaterial
                  color="#30363c"
                  roughness={0.6}
                  metalness={0.35}
                />
              </mesh>
              <mesh position={[0.22, -0.08, 0]} castShadow receiveShadow>
                <boxGeometry args={[0.22, 0.18, 0.06]} />
                <meshStandardMaterial
                  color="#514942"
                  roughness={0.85}
                  metalness={0.1}
                />
              </mesh>
              <mesh
                position={[-0.22, 0, 0]}
                rotation={[0, 0, Math.PI / 2]}
                castShadow
                receiveShadow
              >
                <cylinderGeometry args={[0.02, 0.02, 0.55, 10]} />
                <meshStandardMaterial
                  color="#1e2328"
                  roughness={0.5}
                  metalness={0.55}
                />
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

      <mesh
        ref={tracerRef}
        visible={false}
        frustumCulled={false}
        renderOrder={8}
      >
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
});
