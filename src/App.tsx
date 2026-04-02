import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { Toaster } from "./components/ui/sonner";
import { runPreloadManifest } from "./game/AssetLoader";
import { sharedAudioManager } from "./game/Audio";
import { createDeferredBootPreloadManifest } from "./game/boot-assets";
import { markBootEvent } from "./game/boot-trace";
import { GameRoot } from "./game/GameRoot";
import { useOnlineState } from "./game/online/useOnlineState";
import { loadPersistedSettings } from "./game/settings";
import { LoadingScreen } from "./screens/LoadingScreen";
import { StartupGate } from "./screens/StartupGate";

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
  const [initialLoadingVisible, setInitialLoadingVisible] = useState(true);
  const [launchLoadingVisible, setLaunchLoadingVisible] = useState(false);
  const [startupGateVisible, setStartupGateVisible] = useState(false);
  const [sceneMounted, setSceneMounted] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [initialMainPhaseStarted, setInitialMainPhaseStarted] = useState(false);
  const deferredWarmupStartedRef = useRef(false);
  const persistedSettings = useMemo(loadPersistedSettings, []);
  const deferredManifest = useMemo(
    () => createDeferredBootPreloadManifest(sharedAudioManager),
    [],
  );
  const online = useOnlineState({
    pollEnabled: sceneMounted && !startupGateVisible,
  });
  const autoLaunchEligible =
    online.bootstrapComplete &&
    online.backendStatus === "connected" &&
    online.authStatus === "authenticated";
  const initialCanDismiss = online.bootstrapComplete && (!autoLaunchEligible || sceneReady);

  const requestSceneLaunch = useCallback(() => {
    setStartupGateVisible(false);

    if (!sceneMounted) {
      markBootEvent("boot:scene-mount-start");
      setSceneMounted(true);
      if (!sceneReady) {
        setLaunchLoadingVisible(true);
      }
      return;
    }

    if (!sceneReady) {
      setLaunchLoadingVisible(true);
      return;
    }

    setBooting(false);
  }, [sceneMounted, sceneReady]);

  const handleInitialMainPhaseStart = useCallback(() => {
    setInitialMainPhaseStarted(true);
  }, []);

  const handleSceneReady = useCallback(() => {
    setSceneReady((previous) => {
      if (!previous) {
        markBootEvent("boot:scene-ready");
      }
      return true;
    });
  }, []);

  const handleInitialFadeOutStart = useCallback(() => {
    markBootEvent("boot:overlay-fade-start");
    if (autoLaunchEligible) {
      setBooting(false);
    }
  }, [autoLaunchEligible]);

  const handleLaunchFadeOutStart = useCallback(() => {
    setBooting(false);
  }, []);

  const handleInitialOverlayComplete = useCallback(() => {
    markBootEvent("boot:overlay-complete");
    setInitialLoadingVisible(false);
    if (!autoLaunchEligible) {
      setStartupGateVisible(true);
    }
  }, [autoLaunchEligible]);

  const handleLaunchOverlayComplete = useCallback(() => {
    setLaunchLoadingVisible(false);
  }, []);

  useEffect(() => {
    if (
      !initialLoadingVisible ||
      !initialMainPhaseStarted ||
      !autoLaunchEligible ||
      sceneMounted
    ) {
      return;
    }

    markBootEvent("boot:scene-mount-start");
    setSceneMounted(true);
  }, [autoLaunchEligible, initialLoadingVisible, initialMainPhaseStarted, sceneMounted]);

  useEffect(() => {
    if (initialLoadingVisible || launchLoadingVisible || startupGateVisible) {
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
  }, [deferredManifest, initialLoadingVisible, launchLoadingVisible, startupGateVisible]);

  const loadingStatusLabel = online.backendStatus === "checking"
    ? "Checking backend connection"
    : online.backendStatus === "unavailable"
    ? "Backend unavailable"
    : online.authStatus === "checking"
    ? "Validating session"
    : online.authStatus === "authenticated"
    ? "Session restored"
    : "Backend connected";

  const loadingStatusDetail = online.backendStatus === "checking"
    ? "Verifying the Greytrace backend before we hand you the keys to the lobby."
    : online.backendStatus === "unavailable"
    ? "The backend is not answering right now. We will hand off to the startup gate so you can retry or continue offline."
    : online.authStatus === "checking"
    ? "Stored credentials found. Confirming they still belong to someone the server remembers."
    : online.authStatus === "authenticated"
    ? "Backend is online and the token checked out. Preparing the lobby."
    : "Backend is online, but there is no valid session. Login will happen outside the game.";

  return (
    <>
      {sceneMounted ? (
        <GameRoot
          booting={booting}
          deferredAssetsEnabled={!initialLoadingVisible && !launchLoadingVisible}
          onSceneBootReady={handleSceneReady}
          online={online}
          onOpenStartupGate={() => setStartupGateVisible(true)}
        />
      ) : null}

      {initialLoadingVisible ? (
        <LoadingScreen
          canDismiss={initialCanDismiss}
          musicVolume={persistedSettings.audioVolumes.music}
          onMainPhaseStart={handleInitialMainPhaseStart}
          onFadeOutStart={handleInitialFadeOutStart}
          onComplete={handleInitialOverlayComplete}
          statusLabel={loadingStatusLabel}
          statusDetail={loadingStatusDetail}
        />
      ) : null}

      {launchLoadingVisible ? (
        <LoadingScreen
          canDismiss={sceneReady}
          musicVolume={persistedSettings.audioVolumes.music}
          onFadeOutStart={handleLaunchFadeOutStart}
          onComplete={handleLaunchOverlayComplete}
          introEnabled={false}
          statusLabel="Preparing lobby"
          statusDetail="Warming the scene after the startup gate did its paperwork."
        />
      ) : null}

      {startupGateVisible ? (
        <StartupGate
          online={online}
          onContinueOffline={requestSceneLaunch}
          onContinueToLobby={requestSceneLaunch}
        />
      ) : null}

      <Toaster />
    </>
  );
}

export default App;
