import { findCompatibleGamepad } from "./GamepadManager";

export type ControllerRumbleEffect = {
  durationMs: number;
  weakMagnitude: number;
  strongMagnitude: number;
  throttleMs?: number;
};

type DualRumbleParams = {
  startDelay: number;
  duration: number;
  weakMagnitude: number;
  strongMagnitude: number;
};

type HapticActuatorLike = {
  playEffect?: (type: string, params: DualRumbleParams) => Promise<unknown>;
  pulse?: (value: number, duration: number) => Promise<unknown>;
};

type ExtendedGamepad = Gamepad & {
  vibrationActuator?: HapticActuatorLike | null;
  hapticActuators?: HapticActuatorLike[];
};

const lastRumbleAtByChannel = new Map<string, number>();

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function getHapticActuator(gamepad: Gamepad) {
  const extended = gamepad as ExtendedGamepad;
  return extended.vibrationActuator ??
    extended.hapticActuators?.[0] ??
    null;
}

export function playControllerRumble(
  effect: ControllerRumbleEffect,
  options: {
    enabled?: boolean;
    channel?: string;
  } = {},
) {
  if (options.enabled === false) {
    return;
  }

  const channel = options.channel ?? "default";
  const now = performance.now();
  const throttleMs = effect.throttleMs ?? 0;
  const lastPlayedAt = lastRumbleAtByChannel.get(channel) ?? -Infinity;
  if (now - lastPlayedAt < throttleMs) {
    return;
  }

  const gamepad = findCompatibleGamepad();
  if (!gamepad) {
    return;
  }

  const actuator = getHapticActuator(gamepad);
  if (!actuator) {
    return;
  }

  lastRumbleAtByChannel.set(channel, now);

  const duration = Math.max(0, Math.round(effect.durationMs));
  const weakMagnitude = clamp01(effect.weakMagnitude);
  const strongMagnitude = clamp01(effect.strongMagnitude);

  if (typeof actuator.playEffect === "function") {
    void actuator.playEffect("dual-rumble", {
      startDelay: 0,
      duration,
      weakMagnitude,
      strongMagnitude,
    }).catch(() => {
      // Ignore unsupported runtimes and disconnected controllers.
    });
    return;
  }

  if (typeof actuator.pulse === "function") {
    void actuator.pulse(
      Math.max(weakMagnitude, strongMagnitude),
      duration,
    ).catch(() => {
      // Ignore unsupported runtimes and disconnected controllers.
    });
  }
}
