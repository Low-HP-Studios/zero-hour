import { useEffect, useRef, type RefObject } from "react";
import { findCompatibleGamepad } from "./GamepadManager";

const UI_AXIS_THRESHOLD = 0.55;
const UI_REPEAT_INITIAL_MS = 260;
const UI_REPEAT_MS = 120;

type UiDirection = "up" | "down" | "left" | "right";

type ControllerUiNavigationOptions = {
  active: boolean;
  rootRef: RefObject<HTMLElement | null>;
  onBack?: () => void;
};

type DirectionState = Record<UiDirection, boolean>;
type DirectionRepeatMap = Record<UiDirection, number>;

const DIRECTION_KEYS: UiDirection[] = ["up", "down", "left", "right"];
const DIRECTION_BUTTON_INDEX: Record<UiDirection, number> = {
  up: 12,
  down: 13,
  left: 14,
  right: 15,
};
const CONFIRM_BUTTON_INDEX = 0;
const BACK_BUTTON_INDEX = 1;

const EMPTY_DIRECTION_STATE: DirectionState = {
  up: false,
  down: false,
  left: false,
  right: false,
};

const EMPTY_DIRECTION_REPEAT: DirectionRepeatMap = {
  up: 0,
  down: 0,
  left: 0,
  right: 0,
};

function isButtonPressed(gamepad: Gamepad | null, index: number) {
  if (!gamepad) {
    return false;
  }
  const button = gamepad.buttons[index];
  return Boolean(button && (button.pressed || button.value >= 0.5));
}

function isElementVisible(element: HTMLElement) {
  if (element.hidden) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }
  return element.getClientRects().length > 0;
}

function getFocusableElements(root: HTMLElement) {
  const selector = [
    "button:not([disabled])",
    "input:not([disabled]):not([type='hidden'])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(", ");
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (element) =>
      isElementVisible(element) &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.getAttribute("aria-disabled") !== "true",
  );
}

function resolveDefaultFocus(root: HTMLElement) {
  const focusable = getFocusableElements(root);
  if (focusable.length === 0) {
    return null;
  }
  return focusable.find((element) =>
    element.dataset.controllerDefaultFocus === "true"
  ) ??
    focusable.find((element) => element.getAttribute("aria-selected") === "true") ??
    focusable.find((element) => element.classList.contains("active")) ??
    focusable[0];
}

function getActiveElementWithin(root: HTMLElement) {
  const active = document.activeElement;
  return active instanceof HTMLElement && root.contains(active) ? active : null;
}

function focusElement(element: HTMLElement | null) {
  if (!element) {
    return;
  }
  element.focus({ preventScroll: true });
  element.scrollIntoView({
    block: "nearest",
    inline: "nearest",
  });
}

function activateElement(element: HTMLElement) {
  if (
    element instanceof HTMLInputElement &&
    element.type === "range"
  ) {
    return;
  }
  if (
    element instanceof HTMLButtonElement ||
    element instanceof HTMLInputElement
  ) {
    element.click();
  }
  if (
    element instanceof HTMLButtonElement &&
    element.closest(".inventory-overlay")
  ) {
    element.dispatchEvent(
      new MouseEvent("dblclick", {
        bubbles: true,
      }),
    );
  }
}

function adjustRangeValue(
  element: HTMLInputElement,
  direction: "left" | "right",
) {
  if (element.type !== "range") {
    return false;
  }
  const current = Number(element.value);
  const min = Number(element.min || 0);
  const max = Number(element.max || 100);
  const step = Number(element.step || 1) || 1;
  const next = Math.min(
    max,
    Math.max(min, current + step * (direction === "right" ? 1 : -1)),
  );
  if (!Number.isFinite(next) || next === current) {
    return true;
  }
  element.value = String(next);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function moveFocus(root: HTMLElement, direction: UiDirection) {
  const focusable = getFocusableElements(root);
  if (focusable.length === 0) {
    return;
  }

  const active = getActiveElementWithin(root) ?? resolveDefaultFocus(root);
  if (!active) {
    return;
  }

  if (
    (direction === "left" || direction === "right") &&
    active instanceof HTMLInputElement &&
    adjustRangeValue(active, direction)
  ) {
    return;
  }

  const activeRect = active.getBoundingClientRect();
  const activeX = activeRect.left + activeRect.width / 2;
  const activeY = activeRect.top + activeRect.height / 2;

  let bestCandidate: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of focusable) {
    if (candidate === active) {
      continue;
    }
    const rect = candidate.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = centerX - activeX;
    const dy = centerY - activeY;
    const major = direction === "left" || direction === "right"
      ? Math.abs(dx)
      : Math.abs(dy);
    const minor = direction === "left" || direction === "right"
      ? Math.abs(dy)
      : Math.abs(dx);

    const isValid = direction === "up"
      ? dy < -4
      : direction === "down"
      ? dy > 4
      : direction === "left"
      ? dx < -4
      : dx > 4;
    if (!isValid) {
      continue;
    }

    const score = major * 1000 + minor;
    if (score < bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate) {
    return;
  }
  focusElement(bestCandidate);
}

export function useControllerUiNavigation({
  active,
  rootRef,
  onBack,
}: ControllerUiNavigationOptions) {
  const directionStateRef = useRef<DirectionState>({ ...EMPTY_DIRECTION_STATE });
  const directionRepeatRef = useRef<DirectionRepeatMap>({
    ...EMPTY_DIRECTION_REPEAT,
  });
  const confirmHeldRef = useRef(false);
  const backHeldRef = useRef(false);
  const autoFocusedRef = useRef(false);

  useEffect(() => {
    if (!active) {
      directionStateRef.current = { ...EMPTY_DIRECTION_STATE };
      directionRepeatRef.current = { ...EMPTY_DIRECTION_REPEAT };
      confirmHeldRef.current = false;
      backHeldRef.current = false;
      autoFocusedRef.current = false;
      return;
    }

    let frameId = 0;

    const tick = () => {
      const root = rootRef.current;
      if (!root) {
        frameId = window.requestAnimationFrame(tick);
        return;
      }

      const focusable = getFocusableElements(root);
      if (
        !autoFocusedRef.current &&
        focusable.length > 0 &&
        getActiveElementWithin(root) === null
      ) {
        focusElement(resolveDefaultFocus(root));
        autoFocusedRef.current = true;
      }

      const gamepad = findCompatibleGamepad();
      if (!gamepad) {
        directionStateRef.current = { ...EMPTY_DIRECTION_STATE };
        directionRepeatRef.current = { ...EMPTY_DIRECTION_REPEAT };
        confirmHeldRef.current = false;
        backHeldRef.current = false;
        frameId = window.requestAnimationFrame(tick);
        return;
      }

      const axesX = gamepad.axes[0] ?? 0;
      const axesY = gamepad.axes[1] ?? 0;
      const directionPressed: DirectionState = {
        up: isButtonPressed(gamepad, DIRECTION_BUTTON_INDEX.up) ||
          axesY <= -UI_AXIS_THRESHOLD,
        down: isButtonPressed(gamepad, DIRECTION_BUTTON_INDEX.down) ||
          axesY >= UI_AXIS_THRESHOLD,
        left: isButtonPressed(gamepad, DIRECTION_BUTTON_INDEX.left) ||
          axesX <= -UI_AXIS_THRESHOLD,
        right: isButtonPressed(gamepad, DIRECTION_BUTTON_INDEX.right) ||
          axesX >= UI_AXIS_THRESHOLD,
      };

      const now = performance.now();
      for (const direction of DIRECTION_KEYS) {
        const wasHeld = directionStateRef.current[direction];
        const isHeld = directionPressed[direction];
        if (!isHeld) {
          directionRepeatRef.current[direction] = 0;
          directionStateRef.current[direction] = false;
          continue;
        }

        const nextRepeatAt = directionRepeatRef.current[direction];
        if (!wasHeld || now >= nextRepeatAt) {
          moveFocus(root, direction);
          directionRepeatRef.current[direction] = now +
            (wasHeld ? UI_REPEAT_MS : UI_REPEAT_INITIAL_MS);
        }
        directionStateRef.current[direction] = true;
      }

      const confirmHeld = isButtonPressed(gamepad, CONFIRM_BUTTON_INDEX);
      if (confirmHeld && !confirmHeldRef.current) {
        const activeElement = getActiveElementWithin(root) ?? resolveDefaultFocus(root);
        if (activeElement) {
          focusElement(activeElement);
          activateElement(activeElement);
        }
      }
      confirmHeldRef.current = confirmHeld;

      const backHeld = isButtonPressed(gamepad, BACK_BUTTON_INDEX);
      if (backHeld && !backHeldRef.current) {
        onBack?.();
      }
      backHeldRef.current = backHeld;

      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [active, onBack, rootRef]);
}
