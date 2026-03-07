import { useEffect, useMemo, useRef, useState } from "react";
import { runPreloadManifest } from "../game/AssetLoader";
import { sharedAudioManager } from "../game/Audio";
import { createBootPreloadManifest } from "../game/boot-assets";

type LoadingScreenProps = {
  bootComplete: boolean;
  onAssetsReady: () => void;
  onFadeOutStart: () => void;
  onComplete: () => void;
};

const MIN_DISPLAY_MS = 800;
const FADE_OUT_MS = 600;
const FINAL_WARMUP_RATIO = 0.98;

export function LoadingScreen({
  bootComplete,
  onAssetsReady,
  onFadeOutStart,
  onComplete,
}: LoadingScreenProps) {
  const manifest = useMemo(
    () => createBootPreloadManifest(sharedAudioManager),
    [],
  );
  const [assetsReady, setAssetsReady] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentLabel, setCurrentLabel] = useState(
    manifest[0]?.label ?? "Initializing...",
  );
  const mountTimeRef = useRef(performance.now());
  const fadeStartedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void runPreloadManifest(manifest, {
      concurrency: {
        asset: 3,
        audio: 2,
      },
      onProgress: (next) => {
        if (cancelled) {
          return;
        }
        setProgress(next.ratio);
        setCurrentLabel(next.currentLabel);
      },
    }).then(() => {
      if (cancelled) {
        return;
      }
      setAssetsReady(true);
      onAssetsReady();
    });

    return () => {
      cancelled = true;
    };
  }, [manifest, onAssetsReady]);

  useEffect(() => {
    if (!assetsReady || !bootComplete || fadeStartedRef.current) {
      return;
    }

    fadeStartedRef.current = true;
    const elapsed = performance.now() - mountTimeRef.current;
    const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);
    let finishTimer = 0;

    const startTimer = window.setTimeout(() => {
      setProgress(1);
      setCurrentLabel("Ready");
      onFadeOutStart();
      setFadingOut(true);
      finishTimer = window.setTimeout(onComplete, FADE_OUT_MS);
    }, remaining);

    return () => {
      window.clearTimeout(startTimer);
      if (finishTimer) {
        window.clearTimeout(finishTimer);
      }
    };
  }, [assetsReady, bootComplete, onComplete, onFadeOutStart]);

  const displayedProgress = bootComplete
    ? 1
    : assetsReady
    ? FINAL_WARMUP_RATIO
    : progress * FINAL_WARMUP_RATIO;
  const displayedLabel = assetsReady && !bootComplete
    ? "Warming shaders..."
    : currentLabel;

  return (
    <div className={`loading-screen ${fadingOut ? "fade-out" : ""}`}>
      <div className="loading-top-right">{displayedLabel}</div>
      <div className="loading-center">
        <h1 className="loading-logo-text">GreyTrace</h1>
      </div>
      <div className="loading-bottom-section">
        <div className="loading-bottom-left">Low Hp Studio</div>
        <div className="loading-progress-wrap">
          <div className="loading-progress-bar">
            <div
              className="loading-progress-fill"
              style={{ width: `${Math.round(displayedProgress * 100)}%` }}
            />
          </div>
          <div className="loading-progress-text">
            {Math.round(displayedProgress * 100)}%
          </div>
        </div>
      </div>
    </div>
  );
}
