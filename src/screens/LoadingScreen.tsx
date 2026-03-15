import { useEffect, useMemo, useRef, useState } from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { runPreloadManifest } from "../game/AssetLoader";
import { sharedAudioManager } from "../game/Audio";
import { createBootPreloadManifest } from "../game/boot-assets";

type LoadingScreenProps = {
  bootComplete: boolean;
  onAssetsReady: () => void;
  onFadeOutStart: () => void;
  onComplete: () => void;
};

const INTRO_WORDMARK = "LOW HP STUDIOS";
const INTRO_BLACK_MS = 60;
const INTRO_FADE_IN_MS = 500;
const INTRO_HOLD_MS = 2_000;
const INTRO_FADE_OUT_MS = 900;
const INTRO_ENTER_AT_MS = INTRO_BLACK_MS;
const INTRO_HOLD_AT_MS = INTRO_ENTER_AT_MS + INTRO_FADE_IN_MS;
const INTRO_EXIT_AT_MS = INTRO_HOLD_AT_MS + INTRO_HOLD_MS;
const INTRO_TOTAL_MS = INTRO_EXIT_AT_MS + INTRO_FADE_OUT_MS;
const MIN_LOADING_SCREEN_MS = 10_000;
const FADE_OUT_MS = 600;

type LoadingPhase = "black" | "intro-enter" | "intro-hold" | "intro-exit" | "main";

let introAudioSingleton: HTMLAudioElement | null = null;

function playIntroAudio() {
  if (!introAudioSingleton) {
    const audio = new Audio("/assets/branding/Intro.mp3");
    audio.preload = "auto";
    audio.volume = 0.72;
    audio.addEventListener(
      "ended",
      () => {
        introAudioSingleton = null;
      },
      { once: true },
    );
    introAudioSingleton = audio;
  }

  if (introAudioSingleton.paused) {
    void introAudioSingleton.play().catch(() => {
      // Autoplay can be blocked outside Electron; boot should continue anyway.
    });
  }
}

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
  const [phase, setPhase] = useState<LoadingPhase>("black");
  const [assetsReady, setAssetsReady] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const mountTimeRef = useRef(performance.now());
  const fadeStartedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void runPreloadManifest(manifest, {
      concurrency: {
        asset: 3,
        audio: 2,
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
    playIntroAudio();

    const enterTimer = window.setTimeout(() => {
      setPhase("intro-enter");
    }, INTRO_ENTER_AT_MS);
    const holdTimer = window.setTimeout(() => {
      setPhase("intro-hold");
    }, INTRO_HOLD_AT_MS);
    const exitTimer = window.setTimeout(() => {
      setPhase("intro-exit");
    }, INTRO_EXIT_AT_MS);
    const showMainTimer = window.setTimeout(() => {
      setPhase("main");
    }, INTRO_TOTAL_MS);

    return () => {
      window.clearTimeout(enterTimer);
      window.clearTimeout(holdTimer);
      window.clearTimeout(exitTimer);
      window.clearTimeout(showMainTimer);
    };
  }, []);

  useEffect(() => {
    if (
      phase !== "main" ||
      !assetsReady ||
      !bootComplete ||
      fadeStartedRef.current
    ) {
      return;
    }

    fadeStartedRef.current = true;
    const elapsed = performance.now() - mountTimeRef.current;
    const remaining = Math.max(0, MIN_LOADING_SCREEN_MS - elapsed);
    let finishTimer = 0;

    const startTimer = window.setTimeout(() => {
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
  }, [assetsReady, bootComplete, onComplete, onFadeOutStart, phase]);

  return (
    <div
      className={`loading-screen ${
        phase === "main" ? "loading-screen--main" : "loading-screen--intro"
      } loading-screen--${phase} ${fadingOut ? "fade-out" : ""}`}
    >
      <div className="loading-main-backdrop" aria-hidden="true" />
      <div className="loading-intro">
        <h1 className="loading-intro-wordmark">
          {INTRO_WORDMARK.split("").map((char, i) => (
            <span
              key={i}
              className="loading-intro-char"
              style={{ "--char-i": i } as React.CSSProperties}
            >
              {char === " " ? "\u00A0" : char}
            </span>
          ))}
        </h1>
      </div>
      <div className="loading-main">
        <div className="loading-content">
          <div className="loading-hero">
            <h1 className="loading-logo-text">GreyTrace</h1>
          </div>
        </div>
        <div className="loading-bottom-left">
          <div className="loading-bottom-left-brand">Low HP Studios</div>
          <p className="loading-alpha-note">
            GreyTrace is currently in alpha stage. Please report issues.
          </p>
        </div>
        <div className="loading-bottom-right" aria-hidden="true">
          <DotLottieReact
            className="loading-lottie-animation"
            src="/assets/branding/Loading Hand Animation.lottie"
            autoplay
            loop
          />
        </div>
      </div>
    </div>
  );
}
