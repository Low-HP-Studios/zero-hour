import { useEffect, useRef, useState } from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { markBootEvent } from "../game/boot-trace";

type LoadingScreenProps = {
  canDismiss: boolean;
  musicVolume: number;
  onMainPhaseStart?: () => void;
  onFadeOutStart: () => void;
  onComplete: () => void;
  introEnabled?: boolean;
  statusLabel?: string;
  statusDetail?: string;
  title?: string;
};

const INTRO_WORDMARK = "LOW HP STUDIOS";
const MAIN_STATUS_LABEL = "Alpha Preview Build";
const INTRO_BLACK_MS = 60;
const INTRO_FADE_IN_MS = 500;
const INTRO_HOLD_MS = 2_000;
const INTRO_FADE_OUT_MS = 900;
const INTRO_ENTER_AT_MS = INTRO_BLACK_MS;
const INTRO_HOLD_AT_MS = INTRO_ENTER_AT_MS + INTRO_FADE_IN_MS;
const INTRO_EXIT_AT_MS = INTRO_HOLD_AT_MS + INTRO_HOLD_MS;
const INTRO_TOTAL_MS = INTRO_EXIT_AT_MS + INTRO_FADE_OUT_MS;
const MIN_LOADING_SCREEN_MS = INTRO_TOTAL_MS + 400;
const FADE_OUT_MS = 600;

type LoadingPhase = "black" | "intro-enter" | "intro-hold" | "intro-exit" | "main";

type WindowWithPassiveListener = Window & typeof globalThis;

let introAudioSingleton: HTMLAudioElement | null = null;
let introAudioPlayableMarked = false;
let introAudioRetryArmed = false;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function retryIntroAudioPlayback() {
  detachIntroAudioRetryListeners();
  void playIntroAudio();
}

function detachIntroAudioRetryListeners() {
  if (!introAudioRetryArmed || typeof window === "undefined") {
    return;
  }

  introAudioRetryArmed = false;
  const retryWindow = window as WindowWithPassiveListener;
  retryWindow.removeEventListener("pointerdown", retryIntroAudioPlayback);
  retryWindow.removeEventListener("keydown", retryIntroAudioPlayback);
}

function attachIntroAudioRetryListeners() {
  if (introAudioRetryArmed || typeof window === "undefined") {
    return;
  }

  introAudioRetryArmed = true;
  const retryWindow = window as WindowWithPassiveListener;
  retryWindow.addEventListener("pointerdown", retryIntroAudioPlayback, {
    passive: true,
  });
  retryWindow.addEventListener("keydown", retryIntroAudioPlayback);
}

function getIntroAudio(): HTMLAudioElement {
  if (!introAudioSingleton) {
    const audio = new Audio("/assets/branding/Intro.mp3");
    audio.preload = "auto";
    audio.addEventListener("canplaythrough", () => {
      if (!introAudioPlayableMarked) {
        introAudioPlayableMarked = true;
        markBootEvent("boot:intro-audio-playable");
      }
    });
    introAudioSingleton = audio;
  }

  return introAudioSingleton;
}

function primeIntroAudio() {
  const audio = getIntroAudio();
  markBootEvent("boot:intro-audio-requested");
  audio.load();
}

async function playIntroAudio() {
  const audio = getIntroAudio();
  markBootEvent("boot:intro-audio-play-attempted", {
    paused: audio.paused,
    readyState: audio.readyState,
  });

  if (!audio.paused) {
    detachIntroAudioRetryListeners();
    return;
  }

  try {
    await audio.play();
    detachIntroAudioRetryListeners();
  } catch {
    attachIntroAudioRetryListeners();
  }
}

export function LoadingScreen({
  canDismiss,
  musicVolume,
  onMainPhaseStart,
  onFadeOutStart,
  onComplete,
  introEnabled = true,
  statusLabel = MAIN_STATUS_LABEL,
  statusDetail = "GreyTrace is currently in alpha stage. Please report issues.",
  title = "GreyTrace",
}: LoadingScreenProps) {
  const [phase, setPhase] = useState<LoadingPhase>(introEnabled ? "black" : "main");
  const [fadingOut, setFadingOut] = useState(false);
  const mountTimeRef = useRef(performance.now());
  const fadeStartedRef = useRef(false);
  const mainPhaseStartedRef = useRef(false);
  const minimumVisibleMs = introEnabled ? MIN_LOADING_SCREEN_MS : 450;

  useEffect(() => {
    getIntroAudio().volume = clamp01(musicVolume);
  }, [musicVolume]);

  useEffect(() => {
    if (!introEnabled) {
      return;
    }

    primeIntroAudio();

    const enterTimer = window.setTimeout(() => {
      setPhase("intro-enter");
      void playIntroAudio();
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
  }, [introEnabled]);

  useEffect(() => {
    if (introEnabled) {
      return;
    }

    setPhase("main");
  }, [introEnabled]);

  useEffect(() => {
    if (phase !== "main" || mainPhaseStartedRef.current) {
      return;
    }

    mainPhaseStartedRef.current = true;
    onMainPhaseStart?.();
  }, [onMainPhaseStart, phase]);

  useEffect(() => {
    if (
      phase !== "main" ||
      !canDismiss ||
      fadeStartedRef.current
    ) {
      return;
    }

    fadeStartedRef.current = true;
    const elapsed = performance.now() - mountTimeRef.current;
    const remaining = Math.max(0, minimumVisibleMs - elapsed);
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
  }, [canDismiss, minimumVisibleMs, onComplete, onFadeOutStart, phase]);

  useEffect(() => {
    return () => {
      detachIntroAudioRetryListeners();
    };
  }, []);

  return (
    <div
      className={`loading-screen ${
        phase === "main" ? "loading-screen--main" : "loading-screen--intro"
      } loading-screen--${phase} ${fadingOut ? "fade-out" : ""}`}
    >
      <div className="loading-main-backdrop" aria-hidden="true" />
      {phase === "main" ? null : (
        <div className="loading-intro">
          <h1 className="loading-intro-wordmark">{INTRO_WORDMARK}</h1>
        </div>
      )}
      <div className="loading-main">
        <div className="loading-content">
          <div className="loading-hero">
            <h1 className="loading-logo-text">{title}</h1>
          </div>
        </div>
        <div className="loading-bottom-left">
          <div className="loading-bottom-left-brand">{statusLabel}</div>
          <p className="loading-alpha-note">
            {statusDetail}
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
