import { loadAudioBuffer } from "./AssetLoader";

export type AudioVolumeSettings = {
  master: number;
  gunshot: number;
  footsteps: number;
  hit: number;
};

type LoadedBuffers = {
  gunshot: AudioBuffer | null;
  footstep: AudioBuffer | null;
  hit: AudioBuffer | null;
};

export const DEFAULT_AUDIO_VOLUMES: AudioVolumeSettings = {
  master: 0.8,
  gunshot: 0.85,
  footsteps: 0.32,
  hit: 0.42,
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
    gunshot: null,
    footstep: null,
    hit: null,
  };
  private volumes: AudioVolumeSettings = { ...DEFAULT_AUDIO_VOLUMES };
  private nextFootstepAtSeconds = 0;
  private whiteNoiseBuffer: AudioBuffer | null = null;

  ensureStarted() {
    if (!this.context) {
      const ContextCtor = getAudioContextConstructor();
      if (!ContextCtor) {
        return;
      }

      this.context = new ContextCtor();
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
      void this.preloadBuffers();
    }

    if (this.context.state !== "running") {
      void this.context.resume();
    }
  }

  setVolumes(next: Partial<AudioVolumeSettings>) {
    this.volumes = {
      ...this.volumes,
      ...next,
    };
    this.applyVolumeSettings();
  }

  update(nowSeconds: number, moving: boolean, sprinting: boolean) {
    if (!this.context || this.context.state !== "running") {
      return;
    }

    if (!moving) {
      this.nextFootstepAtSeconds = 0;
      return;
    }

    if (this.nextFootstepAtSeconds <= 0) {
      this.nextFootstepAtSeconds = nowSeconds;
    }

    const stepInterval = sprinting ? 0.27 : 0.4;
    if (nowSeconds >= this.nextFootstepAtSeconds) {
      this.playFootstepInternal(sprinting);
      this.nextFootstepAtSeconds = nowSeconds + stepInterval;
    }
  }

  playGunshot() {
    if (!this.context || this.context.state !== "running" || !this.gunGain) {
      return;
    }

    const now = this.context.currentTime;
    const voice = this.gunVoicePool[this.nextGunVoiceIndex];
    this.nextGunVoiceIndex = (this.nextGunVoiceIndex + 1) % this.gunVoicePool.length;

    voice.gain.cancelScheduledValues(now);
    voice.gain.setValueAtTime(0, now);

    if (this.buffers.gunshot) {
      const source = this.context.createBufferSource();
      source.buffer = this.buffers.gunshot;
      source.playbackRate.value = 0.96 + Math.random() * 0.1;
      source.connect(voice);
      voice.gain.setValueAtTime(1, now);
      voice.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      source.start(now);
      source.stop(now + Math.min(0.35, source.buffer.duration));
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

  playHit() {
    if (!this.context || this.context.state !== "running" || !this.hitGain) {
      return;
    }

    const now = this.context.currentTime;

    if (this.buffers.hit) {
      const source = this.context.createBufferSource();
      source.buffer = this.buffers.hit;
      source.playbackRate.value = 0.95 + Math.random() * 0.15;
      const gain = this.context.createGain();
      gain.gain.value = 0.9;
      source.connect(gain);
      gain.connect(this.hitGain);
      source.start(now);
      source.stop(now + Math.min(0.2, source.buffer.duration));
      return;
    }

    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(720, now);
    osc.frequency.exponentialRampToValueAtTime(480, now + 0.05);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(gain);
    gain.connect(this.hitGain);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  dispose() {
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
    this.nextFootstepAtSeconds = 0;
  }

  private async preloadBuffers() {
    if (!this.context) {
      return;
    }

    const [gunshot, footstep, hit] = await Promise.all([
      loadAudioBuffer(this.context, "/assets/audio/gunshot.wav"),
      loadAudioBuffer(this.context, "/assets/audio/footstep.wav"),
      loadAudioBuffer(this.context, "/assets/audio/hit.wav"),
    ]);

    this.buffers = {
      gunshot,
      footstep,
      hit,
    };
  }

  private playFootstepInternal(sprinting: boolean) {
    if (!this.context || this.context.state !== "running" || !this.footstepGain) {
      return;
    }

    const now = this.context.currentTime;

    if (this.buffers.footstep) {
      const source = this.context.createBufferSource();
      source.buffer = this.buffers.footstep;
      source.playbackRate.value = sprinting ? 1.22 : 0.95;
      const gain = this.context.createGain();
      gain.gain.value = sprinting ? 0.7 : 0.5;
      source.connect(gain);
      gain.connect(this.footstepGain);
      source.start(now);
      source.stop(now + Math.min(0.14, source.buffer.duration));
      return;
    }

    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    osc.type = "sine";
    osc.frequency.setValueAtTime(sprinting ? 88 : 74, now);
    osc.frequency.exponentialRampToValueAtTime(44, now + 0.06);
    filter.type = "lowpass";
    filter.frequency.value = 220;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(sprinting ? 0.12 : 0.08, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.footstepGain);
    osc.start(now);
    osc.stop(now + 0.08);
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
