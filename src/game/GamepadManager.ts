import {
  DEFAULT_CONTROLLER_BINDINGS,
  type ControllerBindingKey,
  type ControllerBindings,
  type ControllerSettings,
} from "./types";

const STANDARD_GAMEPAD_MAPPING = "standard";
const LOOK_RESPONSE_EXPONENT = 1.6;
const TRIGGER_PRESS_THRESHOLD = 0.2;
const MIN_FALLBACK_AXES = 4;
const MIN_FALLBACK_BUTTONS = 16;

type ButtonState = Record<ControllerBindingKey, boolean>;

export type GamepadFrameState = {
  connected: boolean;
  moveX: number;
  moveY: number;
  moveMagnitude: number;
  lookX: number;
  lookY: number;
  lookMagnitude: number;
  fireHeld: boolean;
  adsHeld: boolean;
  sprintHeld: boolean;
  crouchHeld: boolean;
  peekLeftHeld: boolean;
  peekRightHeld: boolean;
  inventoryHeld: boolean;
  jumpPressed: boolean;
  sprintPressed: boolean;
  crouchPressed: boolean;
  reloadPressed: boolean;
  toggleViewPressed: boolean;
  equipRiflePressed: boolean;
  equipSniperPressed: boolean;
  pickupPressed: boolean;
  dropPressed: boolean;
  inventoryPressed: boolean;
  pausePressed: boolean;
};

const EMPTY_BUTTON_STATE: ButtonState = {
  jump: false,
  crouch: false,
  peekLeft: false,
  peekRight: false,
  reload: false,
  inventory: false,
  pause: false,
  sprint: false,
  toggleView: false,
  pickup: false,
  drop: false,
  equipRifle: false,
  equipSniper: false,
  ads: false,
  fire: false,
};

const DISCONNECTED_GAMEPAD_STATE: GamepadFrameState = {
  connected: false,
  moveX: 0,
  moveY: 0,
  moveMagnitude: 0,
  lookX: 0,
  lookY: 0,
  lookMagnitude: 0,
  fireHeld: false,
  adsHeld: false,
  sprintHeld: false,
  crouchHeld: false,
  peekLeftHeld: false,
  peekRightHeld: false,
  inventoryHeld: false,
  jumpPressed: false,
  sprintPressed: false,
  crouchPressed: false,
  reloadPressed: false,
  toggleViewPressed: false,
  equipRiflePressed: false,
  equipSniperPressed: false,
  pickupPressed: false,
  dropPressed: false,
  inventoryPressed: false,
  pausePressed: false,
};

function normalizeStickAxis(raw: number, deadzone: number) {
  const magnitude = Math.abs(raw);
  if (!Number.isFinite(raw) || magnitude <= deadzone) {
    return 0;
  }

  const normalized = (magnitude - deadzone) / Math.max(1e-6, 1 - deadzone);
  return Math.sign(raw) * Math.min(1, normalized);
}

function applyLookCurve(value: number) {
  const magnitude = Math.abs(value);
  if (magnitude <= 0) {
    return 0;
  }
  return Math.sign(value) * Math.pow(magnitude, LOOK_RESPONSE_EXPONENT);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function hasInvertedMoveYAxisQuirk(gamepad: Gamepad) {
  return /evofox/i.test(gamepad.id);
}

function isFallbackCompatible(gamepad: Gamepad) {
  return gamepad.axes.length >= MIN_FALLBACK_AXES &&
    gamepad.buttons.length >= MIN_FALLBACK_BUTTONS;
}

export function findCompatibleGamepad() {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.getGamepads !== "function"
  ) {
    return null;
  }

  const gamepads = navigator.getGamepads();
  let fallback: Gamepad | null = null;
  for (const gamepad of gamepads) {
    if (!gamepad || !gamepad.connected) {
      continue;
    }
    if (gamepad.mapping === STANDARD_GAMEPAD_MAPPING) {
      return gamepad;
    }
    if (fallback === null && isFallbackCompatible(gamepad)) {
      fallback = gamepad;
    }
  }

  return fallback;
}

function isButtonDown(
  gamepad: Gamepad,
  index: number,
  threshold = 0.5,
) {
  const button = gamepad.buttons[index];
  return Boolean(button && (button.pressed || button.value >= threshold));
}

function readButtonState(
  gamepad: Gamepad,
  bindings: ControllerBindings,
): ButtonState {
  return {
    jump: isButtonDown(gamepad, bindings.jump),
    crouch: isButtonDown(gamepad, bindings.crouch),
    peekLeft: isButtonDown(gamepad, bindings.peekLeft),
    peekRight: isButtonDown(gamepad, bindings.peekRight),
    reload: isButtonDown(gamepad, bindings.reload),
    inventory: isButtonDown(gamepad, bindings.inventory),
    pause: isButtonDown(gamepad, bindings.pause),
    sprint: isButtonDown(gamepad, bindings.sprint),
    toggleView: isButtonDown(gamepad, bindings.toggleView),
    pickup: isButtonDown(gamepad, bindings.pickup),
    drop: isButtonDown(gamepad, bindings.drop),
    equipRifle: isButtonDown(gamepad, bindings.equipRifle),
    equipSniper: isButtonDown(gamepad, bindings.equipSniper),
    ads: isButtonDown(gamepad, bindings.ads, TRIGGER_PRESS_THRESHOLD),
    fire: isButtonDown(gamepad, bindings.fire, TRIGGER_PRESS_THRESHOLD),
  };
}

export class GamepadManager {
  private previousButtons: ButtonState = { ...EMPTY_BUTTON_STATE };

  poll(
    settings: ControllerSettings,
    bindings: ControllerBindings = DEFAULT_CONTROLLER_BINDINGS,
  ): GamepadFrameState {
    if (!settings.enabled) {
      this.previousButtons = { ...EMPTY_BUTTON_STATE };
      return DISCONNECTED_GAMEPAD_STATE;
    }

    const gamepad = findCompatibleGamepad();
    if (!gamepad) {
      this.previousButtons = { ...EMPTY_BUTTON_STATE };
      return DISCONNECTED_GAMEPAD_STATE;
    }

    const buttonState = readButtonState(gamepad, bindings);
    const moveX = normalizeStickAxis(gamepad.axes[0] ?? 0, settings.moveDeadzone);
    const invertMoveY =
      hasInvertedMoveYAxisQuirk(gamepad) !== settings.invertMoveY;
    const moveYBase = normalizeStickAxis(
      -(gamepad.axes[1] ?? 0),
      settings.moveDeadzone,
    );
    const moveY = invertMoveY ? -moveYBase : moveYBase;
    const moveMagnitude = clamp01(Math.hypot(moveX, moveY));
    const lookRawX = normalizeStickAxis(
      gamepad.axes[2] ?? 0,
      settings.lookDeadzone,
    );
    const lookRawY = normalizeStickAxis(
      -(gamepad.axes[3] ?? 0),
      settings.lookDeadzone,
    );
    const lookX = applyLookCurve(lookRawX);
    const lookY = applyLookCurve(lookRawY);
    const lookMagnitude = clamp01(Math.hypot(lookX, lookY));

    const frameState: GamepadFrameState = {
      connected: true,
      moveX,
      moveY,
      moveMagnitude,
      lookX,
      lookY,
      lookMagnitude,
      fireHeld: buttonState.fire,
      adsHeld: buttonState.ads,
      sprintHeld: buttonState.sprint,
      crouchHeld: buttonState.crouch,
      peekLeftHeld: buttonState.peekLeft,
      peekRightHeld: buttonState.peekRight,
      inventoryHeld: buttonState.inventory,
      jumpPressed: buttonState.jump && !this.previousButtons.jump,
      sprintPressed: buttonState.sprint && !this.previousButtons.sprint,
      crouchPressed: buttonState.crouch && !this.previousButtons.crouch,
      reloadPressed: buttonState.reload && !this.previousButtons.reload,
      toggleViewPressed:
        buttonState.toggleView && !this.previousButtons.toggleView,
      equipRiflePressed:
        buttonState.equipRifle && !this.previousButtons.equipRifle,
      equipSniperPressed:
        buttonState.equipSniper && !this.previousButtons.equipSniper,
      pickupPressed: buttonState.pickup && !this.previousButtons.pickup,
      dropPressed: buttonState.drop && !this.previousButtons.drop,
      inventoryPressed: buttonState.inventory && !this.previousButtons.inventory,
      pausePressed: buttonState.pause && !this.previousButtons.pause,
    };

    this.previousButtons = buttonState;
    return frameState;
  }
}
