import { loadAudioBuffer } from "./AssetLoader";
import type { WeaponKind } from "./Weapon";

export type AudioVolumeSettings = {
  master: number;
  gunshot: number;
  footsteps: number;
  hit: number;
};

type LoadedBuffers = {
  rifleShot: AudioBuffer | null;
  sniperShot: AudioBuffer | null;
  sniperShell: AudioBuffer | null;
  rifleReload: AudioBuffer | null;
  sniperReload: AudioBuffer | null;
  footstep: AudioBuffer | null;
  kill: AudioBuffer | null;
  hit: AudioBuffer | null;
};

type BufferSourceUrls = {
  rifleShot: string | null;
  sniperShot: string | null;
  sniperShell: string | null;
  rifleReload: string | null;
  sniperReload: string | null;
  footstep: string | null;
  kill: string | null;
  hit: string | null;
};

type LoadedAudioBuffer = {
  buffer: AudioBuffer | null;
  url: string | null;
};

export type AudioBufferKey = keyof LoadedBuffers;

const AUDIO_DEBUG = import.meta.env.DEV;
const TARGET_FOOTSTEP_PEAK = 0.12;
const MAX_FOOTSTEP_FILE_GAIN = 12;
const RIFLE_SHOT_MAX_SECONDS = 0.45;
const SNIPER_SHOT_FADE_TAIL_SECONDS = 0.18;
const AUDIO_BUFFER_KEYS: AudioBufferKey[] = [
  "rifleShot",
  "sniperShot",
  "sniperShell",
  "rifleReload",
  "sniperReload",
  "footstep",
  "kill",
  "hit",
];

const AUDIO_URL_CANDIDATES = {
  rifleShot: [
    "/assets/audio/improved/gun-sound.wav",
  ],
  sniperShot: [
    "/assets/audio/improved/sniper/sniper-shot.mp3",
    "/assets/audio/sniper-shooting.mp3",
    "/assets/audio/sniper-shooting.ogg",
    "/assets/audio/sniper-shooting.wav",
    "/assets/audio/sniper-shoot.mp3",
    "/assets/audio/sniper-shoot.ogg",
    "/assets/audio/sniper-shoot.wav",
  ],
  sniperShell: [
    "/assets/audio/improved/sniper/sniper-shelling.mp3",
    "/assets/audio/sniper-shelling.mp3",
    "/assets/audio/sniper-shelling.ogg",
    "/assets/audio/sniper-shelling.wav",
  ],
  rifleReload: [
    "/assets/audio/improved/rifle/rifle-reloading.mp3",
  ],
  sniperReload: [
    "/assets/audio/improved/sniper/sniper-reloading.mp3",
  ],
  footstep: [
    "/assets/audio/footstep.wav",
  ],
  kill: [
    "/assets/audio/improved/kill-sound.wav",
  ],
  hit: [
    "/assets/audio/hit.mp3",
    "/assets/audio/hit.ogg",
    "/assets/audio/hit.wav",
    "/audio/hit.mp3",
    "/audio/hit.ogg",
    "/audio/hit.wav",
  ],
} as const;

export const DEFAULT_AUDIO_VOLUMES: AudioVolumeSettings = {
  master: 0.5,
  gunshot: 1,
  footsteps: 1,
  hit: 1,
};

export class AudioManager {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private gunGain: GainNode | null = null;
  private footstepGain: GainNode | null = null;
  private hitGain: GainNode | null = null;
  private gunVoicePool: GainNode[] = [];
  private nextGunVoiceIndex = 0;
  private buffers: LoadedBuffers = {
    rifleShot: null,
    sniperShot: null,
    sniperShell: null,
    rifleReload: null,
    sniperReload: null,
    footstep: null,
    kill: null,
    hit: null,
  };
  private sourceUrls: BufferSourceUrls = {
    rifleShot: null,
    sniperShot: null,
    sniperShell: null,
    rifleReload: null,
    sniperReload: null,
    footstep: null,
    kill: null,
    hit: null,
  };
  private volumes: AudioVolumeSettings = { ...DEFAULT_AUDIO_VOLUMES };
  private whiteNoiseBuffer: AudioBuffer | null = null;
  private footstepFileGain = 1;
  private footstepDebugCounter = 0;
  private gunshotDebugCounter = 0;
  private reloadDebugCounter = 0;
  private shellingDebugCounter = 0;
  private reloadSource: AudioBufferSourceNode | null = null;
  private reloadGain: GainNode | null = null;
  private shellingSource: AudioBufferSourceNode | null = null;
  private shellingGain: GainNode | null = null;
  private bufferLoadPromises = new Map<AudioBufferKey, Promise<boolean>>();

  async prepare(): Promise<void> {
    const context = this.ensureContext();
    if (!context) {
      return;
    }

    await Promise.all(AUDIO_BUFFER_KEYS.map((key) => this.prepareBuffer(key)));
  }

  async prepareBuffer(key: AudioBufferKey): Promise<boolean> {
    const context = this.ensureContext();
    if (!context) {
      return false;
    }

    if (this.buffers[key]) {
      return true;
    }

    const existing = this.bufferLoadPromises.get(key);
    if (existing) {
      return existing;
    }

    const request = (async () => {
      const loaded = await loadFirstAudioBuffer(
        context,
        AUDIO_URL_CANDIDATES[key],
      );
      this.buffers[key] = loaded.buffer;
      this.sourceUrls[key] = loaded.url;

      if (key === "footstep") {
        this.handleFootstepBufferLoaded(loaded);
      } else if (AUDIO_DEBUG && loaded.url) {
        console.info("[Audio] Buffer loaded", {
          key,
          url: loaded.url,
        });
      }

      return loaded.buffer !== null;
    })().catch((error: unknown) => {
      if (AUDIO_DEBUG) {
        console.warn(`[Audio] Failed to prepare ${key}`, error);
      }
      return false;
    }).finally(() => {
      if (!this.buffers[key]) {
        this.bufferLoadPromises.delete(key);
      }
    });

    this.bufferLoadPromises.set(key, request);
    return request;
  }

  ensureStarted() {
    const context = this.ensureContext();
    if (!context) {
      return;
    }

    void this.prepare();

    if (context.state !== "running") {
      void context.resume().catch((error: unknown) => {
        if (AUDIO_DEBUG) {
          console.warn("[Audio] Resume failed", error);
        }
      });
    }
  }

  setVolumes(next: Partial<AudioVolumeSettings>) {
    this.volumes = {
      ...this.volumes,
      ...next,
    };
    this.applyVolumeSettings();
  }

  playFootstep(filePlaybackRate?: number) {
    if (!this.context || this.context.state !== "running") {
      return;
    }
    this.playFootstepInternal(filePlaybackRate);
  }

  playGunshot(kind: WeaponKind = "rifle") {
    if (!this.context || this.context.state !== "running" || !this.gunGain) {
      return;
    }

    const now = this.context.currentTime;
    const voice = this.gunVoicePool[this.nextGunVoiceIndex];
    this.nextGunVoiceIndex = (this.nextGunVoiceIndex + 1) % this.gunVoicePool.length;

    voice.gain.cancelScheduledValues(now);
    voice.gain.setValueAtTime(0, now);

    const shotBuffer =
      kind === "sniper"
        ? this.buffers.sniperShot ?? this.buffers.rifleShot
        : this.buffers.rifleShot ?? this.buffers.sniperShot;
    const shotSourceUrl =
      kind === "sniper"
        ? this.sourceUrls.sniperShot ?? this.sourceUrls.rifleShot
        : this.sourceUrls.rifleShot ?? this.sourceUrls.sniperShot;

    if (shotBuffer) {
      const source = this.context.createBufferSource();
      source.buffer = shotBuffer;
      source.playbackRate.value =
        kind === "sniper"
          ? 1
          : 0.96 + Math.random() * 0.1;
      source.connect(voice);
      const playbackSeconds = kind === "sniper"
        ? source.buffer.duration
        : Math.min(RIFLE_SHOT_MAX_SECONDS, source.buffer.duration);
      voice.gain.setValueAtTime(1, now);
      if (kind === "sniper") {
        voice.gain.setValueAtTime(
          1,
          now + Math.max(0, playbackSeconds - SNIPER_SHOT_FADE_TAIL_SECONDS),
        );
        voice.gain.exponentialRampToValueAtTime(
          0.0001,
          now + playbackSeconds,
        );
      } else {
        voice.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
      }
      source.start(now);
      source.stop(now + playbackSeconds);
      if (AUDIO_DEBUG) {
        this.gunshotDebugCounter += 1;
        if (this.gunshotDebugCounter % 8 === 0) {
          console.debug("[Audio] Gunshot trigger", {
            kind,
            source: shotSourceUrl,
          });
        }
      }
      return;
    }

    if (kind === "sniper") {
      voice.gain.setValueAtTime(1, now);
      voice.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

      const thump = this.context.createOscillator();
      const thumpGain = this.context.createGain();
      thump.type = "triangle";
      thump.frequency.setValueAtTime(130 + Math.random() * 18, now);
      thump.frequency.exponentialRampToValueAtTime(42, now + 0.14);
      thumpGain.gain.setValueAtTime(0.001, now);
      thumpGain.gain.exponentialRampToValueAtTime(0.5, now + 0.004);
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      thump.connect(thumpGain);
      thumpGain.connect(voice);
      thump.start(now);
      thump.stop(now + 0.18);

      const crack = this.context.createOscillator();
      const crackGain = this.context.createGain();
      crack.type = "square";
      crack.frequency.setValueAtTime(880 + Math.random() * 110, now);
      crack.frequency.exponentialRampToValueAtTime(220, now + 0.045);
      crackGain.gain.setValueAtTime(0.001, now);
      crackGain.gain.exponentialRampToValueAtTime(0.22, now + 0.002);
      crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      crack.connect(crackGain);
      crackGain.connect(voice);
      crack.start(now);
      crack.stop(now + 0.06);

      if (this.whiteNoiseBuffer) {
        const noiseSource = this.context.createBufferSource();
        noiseSource.buffer = this.whiteNoiseBuffer;
        const highpass = this.context.createBiquadFilter();
        const noiseGain = this.context.createGain();
        highpass.type = "highpass";
        highpass.frequency.value = 1400;
        noiseGain.gain.setValueAtTime(0.001, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.38, now + 0.003);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
        noiseSource.connect(highpass);
        highpass.connect(noiseGain);
        noiseGain.connect(voice);
        noiseSource.start(now);
        noiseSource.stop(now + 0.09);
      }
      return;
    }

    voice.gain.setValueAtTime(1, now);
    voice.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

    const osc = this.context.createOscillator();
    const oscGain = this.context.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(160 + Math.random() * 40, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.07);
    oscGain.gain.setValueAtTime(0.001, now);
    oscGain.gain.exponentialRampToValueAtTime(0.35, now + 0.005);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    osc.connect(oscGain);
    oscGain.connect(voice);

    if (this.whiteNoiseBuffer) {
      const noiseSource = this.context.createBufferSource();
      noiseSource.buffer = this.whiteNoiseBuffer;
      const bandpass = this.context.createBiquadFilter();
      const noiseGain = this.context.createGain();
      bandpass.type = "bandpass";
      bandpass.frequency.value = 1600 + Math.random() * 600;
      bandpass.Q.value = 0.6;
      noiseGain.gain.setValueAtTime(0.001, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.55, now + 0.003);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
      noiseSource.connect(bandpass);
      bandpass.connect(noiseGain);
      noiseGain.connect(voice);
      noiseSource.start(now);
      noiseSource.stop(now + 0.07);
    }

    osc.start(now);
    osc.stop(now + 0.09);
  }

  cancelReload() {
    if (this.reloadSource) {
      try {
        this.reloadSource.stop();
      } catch {
        // Source may already be stopped by the browser.
      }
      this.reloadSource = null;
    }
    if (this.reloadGain && this.context) {
      const now = this.context.currentTime;
      this.reloadGain.gain.cancelScheduledValues(now);
      this.reloadGain.gain.setValueAtTime(0, now);
      this.reloadGain = null;
    }
  }

  playReload(kind: WeaponKind = "rifle", maxDurationSeconds?: number) {
    if (!this.context || this.context.state !== "running" || !this.gunGain) {
      return;
    }

    this.cancelReload();

    const now = this.context.currentTime;
    const reloadBuffer =
      kind === "sniper"
        ? this.buffers.sniperReload ?? this.buffers.rifleReload
        : this.buffers.rifleReload ?? this.buffers.sniperReload;
    const reloadSourceUrl =
      kind === "sniper"
        ? this.sourceUrls.sniperReload ?? this.sourceUrls.rifleReload
        : this.sourceUrls.rifleReload ?? this.sourceUrls.sniperReload;

    if (reloadBuffer) {
      const source = this.context.createBufferSource();
      source.buffer = reloadBuffer;
      source.playbackRate.value = 1;
      const gain = this.context.createGain();
      gain.gain.value = kind === "sniper" ? 0.86 : 0.82;
      source.connect(gain);
      gain.connect(this.gunGain);
      source.start(now);

      const resolvedStopDuration =
        typeof maxDurationSeconds === "number" && Number.isFinite(maxDurationSeconds)
          ? Math.max(0, maxDurationSeconds)
          : null;
      if (resolvedStopDuration !== null) {
        source.stop(now + Math.min(resolvedStopDuration, source.buffer.duration));
      }

      this.reloadSource = source;
      this.reloadGain = gain;
      source.onended = () => {
        if (this.reloadSource === source) {
          this.reloadSource = null;
          this.reloadGain = null;
        }
      };
      if (AUDIO_DEBUG) {
        this.reloadDebugCounter += 1;
        if (this.reloadDebugCounter % 4 === 0) {
          console.debug("[Audio] Reload trigger", {
            kind,
            source: reloadSourceUrl,
          });
        }
      }
      return;
    }

    void this.prepareBuffer(kind === "sniper" ? "sniperReload" : "rifleReload");
  }

  cancelSniperShelling() {
    if (this.shellingSource) {
      try { this.shellingSource.stop(); } catch { /* already stopped */ }
      this.shellingSource = null;
    }
    if (this.shellingGain && this.context) {
      const now = this.context.currentTime;
      this.shellingGain.gain.cancelScheduledValues(now);
      this.shellingGain.gain.setValueAtTime(0, now);
      this.shellingGain = null;
    }
  }

  playSniperShelling() {
    if (!this.context || this.context.state !== "running" || !this.gunGain) {
      return;
    }

    this.cancelSniperShelling();

    const now = this.context.currentTime;
    if (this.buffers.sniperShell) {
      const source = this.context.createBufferSource();
      source.buffer = this.buffers.sniperShell;
      source.playbackRate.value = 1;
      const gain = this.context.createGain();
      gain.gain.value = 0.8;
      source.connect(gain);
      gain.connect(this.gunGain);
      source.start(now);
      this.shellingSource = source;
      this.shellingGain = gain;
      source.onended = () => {
        if (this.shellingSource === source) {
          this.shellingSource = null;
          this.shellingGain = null;
        }
      };
      if (AUDIO_DEBUG) {
        this.shellingDebugCounter += 1;
        if (this.shellingDebugCounter % 4 === 0) {
          console.debug("[Audio] Sniper shelling trigger", {
            source: this.sourceUrls.sniperShell,
          });
        }
      }
      return;
    }

    const click = this.context.createOscillator();
    const clickGain = this.context.createGain();
    click.type = "square";
    click.frequency.setValueAtTime(2100, now);
    click.frequency.exponentialRampToValueAtTime(1200, now + 0.06);
    clickGain.gain.setValueAtTime(0.001, now);
    clickGain.gain.exponentialRampToValueAtTime(0.1, now + 0.003);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    click.connect(clickGain);
    clickGain.connect(this.gunGain);
    click.start(now);
    click.stop(now + 0.08);
  }

  playHit(kind: "body" | "head" = "body") {
    if (!this.context || this.context.state !== "running" || !this.hitGain) {
      return;
    }

    const now = this.context.currentTime;

    if (this.buffers.hit) {
      const source = this.context.createBufferSource();
      source.buffer = this.buffers.hit;
      source.playbackRate.value =
        kind === "head"
          ? 1.2 + Math.random() * 0.08
          : 0.95 + Math.random() * 0.15;
      const gain = this.context.createGain();
      gain.gain.value = kind === "head" ? 1.05 : 0.9;
      source.connect(gain);
      gain.connect(this.hitGain);
      source.start(now);
      source.stop(now + Math.min(0.2, source.buffer.duration));
      return;
    }

    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(kind === "head" ? 1120 : 720, now);
    osc.frequency.exponentialRampToValueAtTime(kind === "head" ? 620 : 480, now + 0.05);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(kind === "head" ? 0.32 : 0.25, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(gain);
    gain.connect(this.hitGain);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  playKill() {
    if (!this.context || this.context.state !== "running" || !this.hitGain) {
      return;
    }

    const now = this.context.currentTime;

    if (this.buffers.kill) {
      const source = this.context.createBufferSource();
      source.buffer = this.buffers.kill;
      source.playbackRate.value = 0.98 + Math.random() * 0.04;
      const gain = this.context.createGain();
      gain.gain.value = 1;
      source.connect(gain);
      gain.connect(this.hitGain);
      source.start(now);
      source.stop(now + Math.min(0.7, source.buffer.duration));
      return;
    }

    const gain = this.context.createGain();
    gain.gain.value = 0.55;
    gain.connect(this.hitGain);

    const low = this.context.createOscillator();
    low.type = "triangle";
    low.frequency.setValueAtTime(420, now);
    low.frequency.exponentialRampToValueAtTime(520, now + 0.05);
    const lowGain = this.context.createGain();
    lowGain.gain.setValueAtTime(0.001, now);
    lowGain.gain.exponentialRampToValueAtTime(0.16, now + 0.006);
    lowGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    low.connect(lowGain);
    lowGain.connect(gain);

    const high = this.context.createOscillator();
    high.type = "sine";
    high.frequency.setValueAtTime(980, now + 0.028);
    high.frequency.exponentialRampToValueAtTime(1240, now + 0.085);
    const highGain = this.context.createGain();
    highGain.gain.setValueAtTime(0.001, now + 0.02);
    highGain.gain.exponentialRampToValueAtTime(0.2, now + 0.03);
    highGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    high.connect(highGain);
    highGain.connect(gain);

    low.start(now);
    low.stop(now + 0.1);
    high.start(now + 0.018);
    high.stop(now + 0.13);
  }

  dispose() {
    this.bufferLoadPromises.clear();
    this.cancelReload();
    this.cancelSniperShelling();
    this.gunVoicePool = [];
    if (this.context) {
      void this.context.close();
      this.context = null;
    }
    this.masterGain = null;
    this.gunGain = null;
    this.footstepGain = null;
    this.hitGain = null;
    this.whiteNoiseBuffer = null;
  }

  private ensureContext(): AudioContext | null {
    if (this.context) {
      return this.context;
    }

    const ContextCtor = getAudioContextConstructor();
    if (!ContextCtor) {
      return null;
    }

    try {
      this.context = new ContextCtor();
    } catch (error) {
      if (AUDIO_DEBUG) {
        console.warn("[Audio] Context creation failed", error);
      }
      return null;
    }

    this.masterGain = this.context.createGain();
    this.gunGain = this.context.createGain();
    this.footstepGain = this.context.createGain();
    this.hitGain = this.context.createGain();

    this.masterGain.connect(this.context.destination);
    this.gunGain.connect(this.masterGain);
    this.footstepGain.connect(this.masterGain);
    this.hitGain.connect(this.masterGain);

    this.gunVoicePool = Array.from({ length: 8 }, () => {
      const voiceGain = this.context!.createGain();
      voiceGain.gain.value = 0;
      voiceGain.connect(this.gunGain!);
      return voiceGain;
    });

    this.applyVolumeSettings();
    this.whiteNoiseBuffer = createWhiteNoiseBuffer(this.context, 0.2);
    return this.context;
  }

  private handleFootstepBufferLoaded(footstep: LoadedAudioBuffer) {
    if (footstep.buffer) {
      const analysis = analyzeBuffer(footstep.buffer);
      this.footstepFileGain = clamp(
        TARGET_FOOTSTEP_PEAK / Math.max(analysis.peak, 0.001),
        1,
        MAX_FOOTSTEP_FILE_GAIN,
      );
      if (AUDIO_DEBUG) {
        console.info("[Audio] Footstep loaded", {
          url: footstep.url,
          duration: Number(footstep.buffer.duration.toFixed(3)),
          peak: Number(analysis.peak.toFixed(4)),
          rms: Number(analysis.rms.toFixed(4)),
          appliedFileGain: Number(this.footstepFileGain.toFixed(2)),
        });
      }
    } else if (AUDIO_DEBUG) {
      console.warn("[Audio] Footstep file not found.");
    }

    if (AUDIO_DEBUG) {
      console.info("[Audio] Weapon buffers", {
        rifleShot: this.sourceUrls.rifleShot,
        sniperShot: this.sourceUrls.sniperShot,
        sniperShell: this.sourceUrls.sniperShell,
        kill: this.sourceUrls.kill,
      });
      console.info("[Audio] Buffer sources", this.sourceUrls);
    }
  }

  private playFootstepInternal(filePlaybackRate?: number) {
    if (!this.context || this.context.state !== "running" || !this.footstepGain) {
      return;
    }

    const now = this.context.currentTime;

    if (this.buffers.footstep) {
      const source = this.context.createBufferSource();
      source.buffer = this.buffers.footstep;
      const fileRate = clamp(filePlaybackRate ?? 1, 0.72, 1.8);
      const rateMix = clamp((fileRate - 0.72) / 1.08, 0, 1);
      source.playbackRate.value = fileRate;
      const gain = this.context.createGain();
      const tone = this.context.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 2100 + rateMix * 1100;
      gain.gain.value = (0.88 + rateMix * 0.2) * this.footstepFileGain;
      source.connect(tone);
      tone.connect(gain);
      gain.connect(this.footstepGain);
      source.start(now);
      source.stop(now + Math.min(0.32, source.buffer.duration));
      if (AUDIO_DEBUG) {
        this.footstepDebugCounter += 1;
        if (this.footstepDebugCounter % 8 === 0) {
          console.debug("[Audio] Footstep trigger", {
            source: this.sourceUrls.footstep,
            fileGain: Number(this.footstepFileGain.toFixed(2)),
            fileRate: Number(fileRate.toFixed(2)),
            mixVolume: Number(this.volumes.footsteps.toFixed(2)),
          });
        }
      }
      return;
    }
    if (AUDIO_DEBUG) {
      console.warn("[Audio] Footstep file buffer unavailable.");
    }
  }

  private applyVolumeSettings() {
    if (!this.masterGain || !this.gunGain || !this.footstepGain || !this.hitGain) {
      return;
    }

    this.masterGain.gain.value = this.volumes.master;
    this.gunGain.gain.value = this.volumes.gunshot;
    this.footstepGain.gain.value = this.volumes.footsteps;
    this.hitGain.gain.value = this.volumes.hit;
  }
}

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }

  const maybeWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
  return globalThis.AudioContext ?? maybeWindow.webkitAudioContext ?? null;
}

function createWhiteNoiseBuffer(context: AudioContext, lengthSeconds: number): AudioBuffer {
  const frameCount = Math.max(1, Math.floor(context.sampleRate * lengthSeconds));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < frameCount; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frameCount);
  }

  return buffer;
}

async function loadFirstAudioBuffer(
  context: BaseAudioContext,
  urls: readonly string[],
): Promise<LoadedAudioBuffer> {
  for (const url of urls) {
    const buffer = await loadAudioBuffer(context, url);
    if (buffer) {
      return { buffer, url };
    }
  }
  return { buffer: null, url: null };
}

function analyzeBuffer(buffer: AudioBuffer): { peak: number; rms: number } {
  let peak = 0;
  let powerSum = 0;
  let sampleCount = 0;
  const stride = 16;

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += stride) {
      const value = Math.abs(data[i]);
      if (value > peak) {
        peak = value;
      }
      powerSum += value * value;
      sampleCount += 1;
    }
  }

  const rms = sampleCount > 0 ? Math.sqrt(powerSum / sampleCount) : 0;
  return { peak, rms };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export const sharedAudioManager = new AudioManager();
