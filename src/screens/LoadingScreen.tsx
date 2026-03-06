import { useCallback, useEffect, useRef, useState } from "react";
import { loadFbxAsset, loadFbxAnimation, fetchBinaryAsset } from "../game/AssetLoader";

type LoadingScreenProps = {
  onComplete: () => void;
};

function preloadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

const TEXTURE_BASE = "/assets/models/character/Trooper/tactical guy.fbm/";
const TEXTURE_FILES = [
  "Body_baseColor_0.png", "Body_normal_1.png",
  "Bottom_baseColor_2.png", "Bottom_normal_3.png",
  "Glove_baseColor_4.png", "Glove_normal_5.png",
  "material_baseColor_6.png", "material_normal_7.png",
  "Mask_baseColor_8.png", "Mask_normal_9.png",
  "Shoes_baseColor_10.png", "Shoes_normal_11.png",
  "material_6_baseColor_12.png", "material_6_normal_13.png",
];

const PRELOAD_TASKS: { label: string; load: () => Promise<unknown> }[] = [
  {
    label: "Character model",
    load: () =>
      loadFbxAsset("/assets/models/character/Trooper/tactical guy.fbx"),
  },
  {
    label: "Idle animation",
    load: () => loadFbxAnimation("/assets/animations/walking/Idle.fbx", "idle"),
  },
  {
    label: "Walk animation",
    load: () =>
      loadFbxAnimation("/assets/animations/walking/Walk Forward.fbx", "walk"),
  },
  {
    label: "Walk backward",
    load: () =>
      loadFbxAnimation("/assets/animations/walking/Walk Backward.fbx", "walkBack"),
  },
  {
    label: "Walk left",
    load: () =>
      loadFbxAnimation("/assets/animations/walking/Walk Left.fbx", "walkLeft"),
  },
  {
    label: "Walk right",
    load: () =>
      loadFbxAnimation("/assets/animations/walking/Walk Right.fbx", "walkRight"),
  },
  {
    label: "Rifle idle",
    load: () =>
      loadFbxAnimation(
        "/assets/animations/walking with gun/Rifle Aim Idle.fbx",
        "rifleIdle",
      ),
  },
  {
    label: "Rifle walk",
    load: () =>
      loadFbxAnimation(
        "/assets/animations/walking with gun/Rifle Aim Walk Forward Loop.fbx",
        "rifleWalk",
      ),
  },
  {
    label: "Rifle walk backward",
    load: () =>
      loadFbxAnimation(
        "/assets/animations/walking with gun/Rifle Aim Walk Backward Loop.fbx",
        "rifleWalkBack",
      ),
  },
  {
    label: "Rifle walk left",
    load: () =>
      loadFbxAnimation(
        "/assets/animations/walking with gun/Rifle Aim Walk Left Loop.fbx",
        "rifleWalkLeft",
      ),
  },
  {
    label: "Rifle walk right",
    load: () =>
      loadFbxAnimation(
        "/assets/animations/walking with gun/Rifle Aim Walk Right Loop.fbx",
        "rifleWalkRight",
      ),
  },
  {
    label: "Rifle",
    load: () => loadFbxAsset("/assets/weapons/pack/FBX/AssaultRifle_01.fbx"),
  },
  {
    label: "Sniper",
    load: () => loadFbxAsset("/assets/weapons/pack/FBX/SniperRifle_01.fbx"),
  },
  {
    label: "Character textures",
    load: () =>
      Promise.all(
        TEXTURE_FILES.map((file) => preloadImage(TEXTURE_BASE + file)),
      ),
  },
  {
    label: "Rifle audio",
    load: () => fetchBinaryAsset("/assets/audio/rifle-shoot.mp3"),
  },
  {
    label: "Sniper audio",
    load: () => fetchBinaryAsset("/assets/audio/sniper-shooting.mp3"),
  },
  {
    label: "Sniper shelling",
    load: () => fetchBinaryAsset("/assets/audio/sniper-shelling.mp3"),
  },
  {
    label: "Footstep audio",
    load: () => fetchBinaryAsset("/assets/audio/dirt-steps.ogg"),
  },
  {
    label: "Kill sound",
    load: () => fetchBinaryAsset("/assets/audio/kill-sound.mp3"),
  },
];

const MIN_DISPLAY_MS = 3000;

export function LoadingScreen({ onComplete }: LoadingScreenProps) {
  const [fadingOut, setFadingOut] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentLabel, setCurrentLabel] = useState("Initializing...");
  const mountTime = useRef(performance.now());
  const done = useRef(false);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    setFadingOut(true);
    setTimeout(onComplete, 600);
  }, [onComplete]);

  useEffect(() => {
    let cancelled = false;
    let completed = 0;
    const total = PRELOAD_TASKS.length;

    (async () => {
      const promises = PRELOAD_TASKS.map(async (task) => {
        await task.load();
        if (cancelled) return;
        completed++;
        setProgress(completed / total);
        setCurrentLabel(
          completed < total
            ? PRELOAD_TASKS[completed]?.label ?? "Finishing..."
            : "Ready",
        );
      });

      await Promise.all(promises);
      if (cancelled) return;

      const elapsed = performance.now() - mountTime.current;
      const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);
      setTimeout(() => {
        if (!cancelled) finish();
      }, remaining);
    })();

    return () => {
      cancelled = true;
    };
  }, [finish]);

  return (
    <div className={`loading-screen ${fadingOut ? "fade-out" : ""}`}>
      <div className="loading-top-right">
        {currentLabel}
      </div>
      <div className="loading-center">
        <h1 className="loading-logo-text">GreyTrace</h1>
      </div>
      <div className="loading-bottom-section">
        <div className="loading-bottom-left">
          Low Hp Studio
        </div>
        <div className="loading-progress-wrap">
          <div className="loading-progress-bar">
            <div
              className="loading-progress-fill"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <div className="loading-progress-text">
            {Math.round(progress * 100)}%
          </div>
        </div>
      </div>
    </div>
  );
}
