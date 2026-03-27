import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { MapEnvironment } from "../game/scene/MapEnvironment";
import type { CharacterDefinition } from "../game/characters";
import {
  loadPreparedCharacterModel,
  type CharacterModelOverride,
} from "../game/scene/CharacterModel";

function disposeModel(model: THREE.Group) {
  model.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry) mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const mat of materials) {
      const stdMat = mat as THREE.MeshStandardMaterial;
      stdMat.map?.dispose();
      stdMat.normalMap?.dispose();
      stdMat.dispose();
    }
  });
}

type LobbyModelProps = {
  characterDef: CharacterDefinition;
};

function LobbyModel({ characterDef }: LobbyModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [model, setModel] = useState<THREE.Group | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  useEffect(() => {
    let disposed = false;
    let loadedModel: THREE.Group | null = null;
    let idleMixer: THREE.AnimationMixer | null = null;
    setModel(null);

    (async () => {
      const override: CharacterModelOverride = {
        modelUrl: characterDef.modelUrl,
        assetType: characterDef.assetType,
        animationMode: characterDef.animationMode,
        textureBasePath: characterDef.textureBasePath,
        textures: characterDef.textures,
        embeddedWeapon: characterDef.embeddedWeapon,
      };
      const prepared = await loadPreparedCharacterModel(override);
      if (disposed || !prepared) return;

      loadedModel = prepared.model;
      const idleClip = characterDef.animationMode === "embedded-glb"
        ? prepared.animations.find((clip) =>
          clip.name === "W2_Stand_Aim_Idle_v2_IPC"
        ) ?? null
        : null;
      if (idleClip) {
        idleMixer = new THREE.AnimationMixer(prepared.model);
        const action = idleMixer.clipAction(idleClip.clone());
        action.play();
        mixerRef.current = idleMixer;
      } else {
        mixerRef.current = null;
      }

      setModel(prepared.model);
    })();

    return () => {
      disposed = true;
      mixerRef.current?.stopAllAction();
      if (idleMixer) {
        idleMixer.uncacheRoot(idleMixer.getRoot());
      }
      mixerRef.current = null;
      if (loadedModel) {
        disposeModel(loadedModel);
      }
    };
  }, [characterDef]);

  useFrame((_, delta) => {
    mixerRef.current?.update(delta);
  });

  if (!model) return null;

  return (
    <group ref={groupRef}>
      <primitive object={model} />
    </group>
  );
}

function SlowOrbit({ children }: { children: React.ReactNode }) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (groupRef.current) {
      const t = clock.getElapsedTime() * 0.08;
      groupRef.current.rotation.y = Math.sin(t) * 0.1;
    }
  });

  return <group ref={groupRef}>{children}</group>;
}

type LobbySceneProps = {
  transitioning: boolean;
  onTransitionComplete: () => void;
};

const LOBBY_CAM_POS = new THREE.Vector3(0, 1.1, 3.8);
const LOBBY_CAM_TARGET = new THREE.Vector3(0, 0.85, 0);

const GAME_CAM_POS = new THREE.Vector3(0, 3.5, 12);
const GAME_CAM_TARGET = new THREE.Vector3(0, 1, -5);

const TRANSITION_DURATION = 1.8;

function LobbyCamera({
  transitioning,
  onTransitionComplete,
}: {
  transitioning: boolean;
  onTransitionComplete: () => void;
}) {
  const { camera } = useThree();
  const transitionStartRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const startPosRef = useRef(new THREE.Vector3());
  const startTargetRef = useRef(new THREE.Vector3());
  const currentTargetRef = useRef(LOBBY_CAM_TARGET.clone());

  useEffect(() => {
    camera.position.copy(LOBBY_CAM_POS);
    camera.lookAt(LOBBY_CAM_TARGET);
    currentTargetRef.current.copy(LOBBY_CAM_TARGET);
  }, [camera]);

  useEffect(() => {
    if (transitioning && !completedRef.current) {
      transitionStartRef.current = null;
      startPosRef.current.copy(camera.position);
      startTargetRef.current.copy(currentTargetRef.current);
    }
  }, [transitioning, camera]);

  useFrame(() => {
    if (!transitioning || completedRef.current) return;

    if (transitionStartRef.current === null) {
      transitionStartRef.current = performance.now();
    }

    const elapsed =
      (performance.now() - transitionStartRef.current) / 1000;
    const rawT = Math.min(1, elapsed / TRANSITION_DURATION);
    const t = easeInOutCubic(rawT);

    camera.position.lerpVectors(startPosRef.current, GAME_CAM_POS, t);
    currentTargetRef.current.lerpVectors(
      startTargetRef.current,
      GAME_CAM_TARGET,
      t,
    );
    camera.lookAt(currentTargetRef.current);

    if (rawT >= 1 && !completedRef.current) {
      completedRef.current = true;
      onTransitionComplete();
    }
  });

  return null;
}

function PreviewCamera() {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.copy(LOBBY_CAM_POS);
    camera.lookAt(LOBBY_CAM_TARGET);
  }, [camera]);

  return null;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const LOBBY_FRAME_RATE = 60;
const LOBBY_FRAME_INTERVAL_MS = 1000 / LOBBY_FRAME_RATE;

function LobbyFramePacer() {
  const advance = useThree((state) => state.advance);

  useEffect(() => {
    let rafId: number;
    let lastTime = 0;
    const loop = (time: number) => {
      if (time - lastTime >= LOBBY_FRAME_INTERVAL_MS) {
        lastTime = time - ((time - lastTime) % LOBBY_FRAME_INTERVAL_MS);
        advance(time);
      }
      rafId = window.requestAnimationFrame(loop);
    };
    rafId = window.requestAnimationFrame(loop);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [advance]);

  return null;
}

function LobbySceneContent({
  transitioning,
  onTransitionComplete,
  characterDef,
}: LobbySceneProps & { characterDef: CharacterDefinition }) {
  return (
    <>
      <color attach="background" args={["#86c8ff"]} />
      <fog attach="fog" args={["#f2c39b", 110, 620]} />
      <hemisphereLight args={["#a7d6ff", "#c49c6d", 0.95]} />
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[106, 34, -118]}
        intensity={1.95}
        color="#ffd2a2"
        castShadow={false}
      />
      <directionalLight
        position={[-2, 3, 2]}
        intensity={0.6}
        color="#5ab8ff"
      />
      <pointLight position={[0, 1.5, 4]} intensity={0.8} color="#ffab42" />
      <MapEnvironment shadows={false} theme={1} floorGridOpacity={0} />
      <SlowOrbit>
        <LobbyModel
          characterDef={characterDef}
        />
      </SlowOrbit>
      <LobbyCamera
        transitioning={transitioning}
        onTransitionComplete={onTransitionComplete}
      />
      <LobbyFramePacer />
    </>
  );
}

export function LobbyScene({
  transitioning,
  onTransitionComplete,
  characterDef,
}: LobbySceneProps & { characterDef: CharacterDefinition }) {
  return (
    <div className="lobby-scene-viewport">
      <Canvas
        gl={{ antialias: false, powerPreference: "high-performance" }}
        camera={{ fov: 40, near: 0.1, far: 650 }}
        dpr={1}
        frameloop="never"
      >
        <LobbySceneContent
          transitioning={transitioning}
          onTransitionComplete={onTransitionComplete}
          characterDef={characterDef}
        />
      </Canvas>
    </div>
  );
}

export function CharacterPreviewCanvas({
  characterDef,
  transparent,
}: {
  characterDef: CharacterDefinition;
  transparent?: boolean;
}) {
  return (
    <div className="character-preview-viewport">
      <Canvas
        gl={{
          antialias: false,
          powerPreference: "high-performance",
          alpha: transparent,
        }}
        camera={{ fov: 40, near: 0.1, far: 650 }}
        dpr={1}
        frameloop="never"
        style={transparent ? { background: "transparent" } : undefined}
      >
        {transparent ? null : <color attach="background" args={["#0a0a0f"]} />}
        <ambientLight intensity={0.4} />
        <directionalLight
          position={[3, 4, 5]}
          intensity={1.6}
          color="#ffd2a2"
        />
        <directionalLight
          position={[-2, 3, 2]}
          intensity={0.5}
          color="#5ab8ff"
        />
        <pointLight position={[0, 1.5, 4]} intensity={0.6} color="#ffab42" />
        <LobbyModel
          characterDef={characterDef}
        />
        <PreviewCamera />
        <LobbyFramePacer />
      </Canvas>
    </div>
  );
}
