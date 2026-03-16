import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { Toaster } from "./components/ui/sonner";
import { runPreloadManifest } from "./game/AssetLoader";
import { sharedAudioManager } from "./game/Audio";
import { createDeferredBootPreloadManifest } from "./game/boot-assets";
import { markBootEvent } from "./game/boot-trace";
import { GameRoot } from "./game/GameRoot";
import { LoadingScreen } from "./screens/LoadingScreen";

type IdleDeadlineLike = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type IdleRequestOptionsLike = {
  timeout?: number;
};

type WindowWithIdleCallback = Window & {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadlineLike) => void,
    options?: IdleRequestOptionsLike,
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function scheduleIdleTask(task: () => void): () => void {
  const idleWindow = window as WindowWithIdleCallback;
  if (typeof idleWindow.requestIdleCallback === "function") {
    const handle = idleWindow.requestIdleCallback(
      () => {
        task();
      },
      { timeout: 1_200 },
    );
    return () => {
      idleWindow.cancelIdleCallback?.(handle);
    };
  }

  const handle = window.setTimeout(task, 120);
  return () => {
    window.clearTimeout(handle);
  };
}

function App() {
  const [booting, setBooting] = useState(true);
  const [loadingOverlayVisible, setLoadingOverlayVisible] = useState(true);
  const [sceneMounted, setSceneMounted] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const mainPhaseStartedRef = useRef(false);
  const deferredWarmupStartedRef = useRef(false);
  const deferredManifest = useMemo(
    () => createDeferredBootPreloadManifest(sharedAudioManager),
    [],
  );
  const canDismiss = sceneReady;

  const handleMainPhaseStart = useCallback(() => {
    if (mainPhaseStartedRef.current) {
      return;
    }

    mainPhaseStartedRef.current = true;
    markBootEvent("boot:scene-mount-start");
    setSceneMounted(true);
  }, []);

  const handleSceneReady = useCallback(() => {
    setSceneReady((previous) => {
      if (!previous) {
        markBootEvent("boot:scene-ready");
      }
      return true;
    });
  }, []);

  const handleFadeOutStart = useCallback(() => {
    markBootEvent("boot:overlay-fade-start");
    setBooting(false);
  }, []);

  const handleOverlayComplete = useCallback(() => {
    markBootEvent("boot:overlay-complete");
    setLoadingOverlayVisible(false);
  }, []);

  useEffect(() => {
    if (loadingOverlayVisible) {
      return;
    }

    let cancelled = false;
    const cancelIdleTask = scheduleIdleTask(() => {
      if (cancelled || deferredWarmupStartedRef.current) {
        return;
      }

      deferredWarmupStartedRef.current = true;
      markBootEvent("boot:deferred-warmup-start");

      void runPreloadManifest(deferredManifest, {
        concurrency: {
          asset: 2,
          audio: 1,
        },
      }).then(({ errors }) => {
        markBootEvent("boot:deferred-warmup-end", {
          errors: errors.length,
        });
      }).catch((error: unknown) => {
        markBootEvent("boot:deferred-warmup-end", {
          failed: true,
        });
        if (import.meta.env.DEV) {
          console.warn("[Boot] Deferred warm-up failed", error);
        }
      });
    });

    return () => {
      cancelled = true;
      cancelIdleTask();
    };
  }, [deferredManifest, loadingOverlayVisible]);

  return (
    <>
      {sceneMounted ? (
        <GameRoot
          booting={booting}
          deferredAssetsEnabled={!loadingOverlayVisible}
          onSceneBootReady={handleSceneReady}
        />
      ) : null}
      {loadingOverlayVisible ? (
        <LoadingScreen
          canDismiss={canDismiss}
          onMainPhaseStart={handleMainPhaseStart}
          onFadeOutStart={handleFadeOutStart}
          onComplete={handleOverlayComplete}
        />
      ) : null}
      <Toaster />
    </>
  );
}

export default App;
