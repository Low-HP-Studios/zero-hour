import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { loadFbxAsset, preloadTextureAsset } from "../game/AssetLoader";
import { MapEnvironment } from "../game/scene/MapEnvironment";
import type {
  CharacterDefinition,
  CharacterTextureEntry,
} from "../game/characters";

const CHARACTER_TARGET_HEIGHT = 1.65;

async function applyTextures(
  model: THREE.Group,
  textureBasePath: string,
  textures: CharacterTextureEntry[] | null,
) {
  if (!textures || textures.length === 0) return;

  const tasks: Promise<void>[] = [];

  model.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    const task = (async () => {
      const newMats = await Promise.all(
        mats.map(async (mat) => {
          const name = mat.name || mesh.name;
          const entry = textures.find(
            (t) => t.match === "" || name.includes(t.match),
          );

          const phong = mat as THREE.MeshPhongMaterial;

          let baseTex: THREE.Texture | null = null;
          let normalTex: THREE.Texture | null = null;
          if (entry) {
            const loads: Promise<THREE.Texture | null>[] = [
              preloadTextureAsset(textureBasePath + entry.base),
            ];
            if (entry.normal) {
              loads.push(preloadTextureAsset(textureBasePath + entry.normal));
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
  modelUrl: string;
  textureBasePath: string;
  textures: CharacterTextureEntry[] | null;
};

function LobbyModel({ modelUrl, textureBasePath, textures }: LobbyModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [model, setModel] = useState<THREE.Group | null>(null);

  useEffect(() => {
    let disposed = false;
    setModel(null);

    (async () => {
      const [fbx, SkeletonUtils] = await Promise.all([
        loadFbxAsset(modelUrl),
        import("three/examples/jsm/utils/SkeletonUtils.js"),
      ]);
      if (disposed || !fbx) return;

      const clone = SkeletonUtils.clone(fbx) as THREE.Group;

      const box = new THREE.Box3().setFromObject(clone);
      const size = new THREE.Vector3();
      box.getSize(size);
      const scale = size.y > 0 ? CHARACTER_TARGET_HEIGHT / size.y : 1;
      clone.scale.setScalar(scale);

      const scaledBox = new THREE.Box3().setFromObject(clone);
      clone.position.y = -scaledBox.min.y;

      clone.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      await applyTextures(clone, textureBasePath, textures);

      setModel(clone);
    })();
    return () => {
      disposed = true;
      if (model) disposeModel(model);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl]);

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
          modelUrl={characterDef.modelUrl}
          textureBasePath={characterDef.textureBasePath}
          textures={characterDef.textures}
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
          modelUrl={characterDef.modelUrl}
          textureBasePath={characterDef.textureBasePath}
          textures={characterDef.textures}
        />
        <PreviewCamera />
        <LobbyFramePacer />
      </Canvas>
    </div>
  );
}
