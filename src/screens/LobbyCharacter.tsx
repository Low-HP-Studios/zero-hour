import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { loadFbxAsset, loadFbxAnimation } from "../game/AssetLoader";
import { MapEnvironment } from "../game/scene/MapEnvironment";

const CHARACTER_MODEL_URL =
  "/assets/models/character/Trooper/tactical guy.fbx";
const IDLE_ANIM_URL = "/assets/animations/walking/Idle.fbx";
const CHARACTER_TARGET_HEIGHT = 1.65;
const TEXTURE_BASE =
  "/assets/models/character/Trooper/tactical guy.fbm/";

const TEXTURE_MAP: Record<string, { base: string; normal: string }> = {
  Body: { base: "Body_baseColor_0.png", normal: "Body_normal_1.png" },
  Bottom: { base: "Bottom_baseColor_2.png", normal: "Bottom_normal_3.png" },
  Glove: { base: "Glove_baseColor_4.png", normal: "Glove_normal_5.png" },
  material: {
    base: "material_baseColor_6.png",
    normal: "material_normal_7.png",
  },
  Mask: { base: "Mask_baseColor_8.png", normal: "Mask_normal_9.png" },
  Shoes: { base: "Shoes_baseColor_10.png", normal: "Shoes_normal_11.png" },
  material_6: {
    base: "material_6_baseColor_12.png",
    normal: "material_6_normal_13.png",
  },
};

async function applyTextures(model: THREE.Group) {
  const loader = new THREE.TextureLoader();
  const load = (file: string) =>
    new Promise<THREE.Texture>((resolve) => {
      loader.load(TEXTURE_BASE + file, resolve, undefined, () =>
        resolve(new THREE.Texture()),
      );
    });

  model.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const name = mat.name || mesh.name;
    const entry = Object.entries(TEXTURE_MAP).find(([key]) =>
      name.includes(key),
    );
    if (!entry) return;
    const [, files] = entry;
    load(files.base).then((tex) => {
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      mat.map = tex;
      mat.needsUpdate = true;
    });
    load(files.normal).then((tex) => {
      tex.flipY = false;
      mat.normalMap = tex;
      mat.needsUpdate = true;
    });
  });
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

function LobbyModel() {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const [model, setModel] = useState<THREE.Group | null>(null);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const [fbx, idleClip, SkeletonUtils] = await Promise.all([
        loadFbxAsset(CHARACTER_MODEL_URL),
        loadFbxAnimation(IDLE_ANIM_URL, "idle"),
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

      await applyTextures(clone);

      const mixer = new THREE.AnimationMixer(clone);
      mixerRef.current = mixer;

      if (idleClip) {
        const action = mixer.clipAction(idleClip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
      }

      setModel(clone);
    })();
    return () => {
      disposed = true;
    };
  }, []);

  useFrame((_, delta) => {
    mixerRef.current?.update(delta);
  });

  if (!model) return null;

  return (
    <group ref={groupRef} rotation={[0, 0, 0]}>
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

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function LobbySceneContent({
  transitioning,
  onTransitionComplete,
}: LobbySceneProps) {
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
        <LobbyModel />
      </SlowOrbit>
      <LobbyCamera
        transitioning={transitioning}
        onTransitionComplete={onTransitionComplete}
      />
    </>
  );
}

export function LobbyScene({
  transitioning,
  onTransitionComplete,
}: LobbySceneProps) {
  return (
    <div className="lobby-scene-viewport">
      <Canvas
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: 40, near: 0.1, far: 650 }}
        dpr={Math.min(1.5, window.devicePixelRatio)}
      >
        <LobbySceneContent
          transitioning={transitioning}
          onTransitionComplete={onTransitionComplete}
        />
      </Canvas>
    </div>
  );
}
