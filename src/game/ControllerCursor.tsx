import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { playControllerRumble } from "./GamepadHaptics";
import { findCompatibleGamepad } from "./GamepadManager";

const CURSOR_SIZE = 26;
const CURSOR_SPEED_PX_PER_SECOND = 900;
const CURSOR_EDGE_SCROLL_THRESHOLD = 56;
const CURSOR_SCROLL_SPEED_PX_PER_SECOND = 1040;
const RANGE_EDIT_AXIS_THRESHOLD = 0.35;
const RANGE_EDIT_INITIAL_MS = 260;
const RANGE_EDIT_REPEAT_MS = 110;
const UI_PRESS_RUMBLE = {
  durationMs: 28,
  weakMagnitude: 0.12,
  strongMagnitude: 0.18,
  throttleMs: 60,
} as const;

type ControllerCursorProps = {
  enabled: boolean;
  scopeRef: RefObject<HTMLElement | null>;
  moveDeadzone: number;
  inputSuspended?: boolean;
  vibrationEnabled?: boolean;
  onBack?: () => void;
};

type CursorPosition = {
  x: number;
  y: number;
};

type RangeEditDirection = "left" | "right";

export let controllerCursorActive = false;
export let controllerCursorInputSuspended = false;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampToViewport(position: CursorPosition): CursorPosition {
  return {
    x: clamp(position.x, 0, window.innerWidth),
    y: clamp(position.y, 0, window.innerHeight),
  };
}

function normalizeStickAxis(raw: number, deadzone: number) {
  const magnitude = Math.abs(raw);
  if (!Number.isFinite(raw) || magnitude <= deadzone) {
    return 0;
  }

  const normalized = (magnitude - deadzone) / Math.max(1e-6, 1 - deadzone);
  return Math.sign(raw) * Math.min(1, normalized);
}

function hasInvertedMoveYAxisQuirk(gamepad: Gamepad) {
  return /evofox/i.test(gamepad.id);
}

function resolveCursorMoveY(gamepad: Gamepad, deadzone: number) {
  const moveYBase = normalizeStickAxis(-(gamepad.axes[1] ?? 0), deadzone);
  const moveY = hasInvertedMoveYAxisQuirk(gamepad) ? -moveYBase : moveYBase;
  return moveY;
}

function isGamepadButtonPressed(
  gamepad: Gamepad,
  index: number,
  threshold = 0.5,
) {
  const button = gamepad.buttons[index];
  return Boolean(button && (button.pressed || button.value >= threshold));
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

function isInteractiveElement(element: HTMLElement) {
  if (!isElementVisible(element)) {
    return false;
  }
  if (
    element.getAttribute("aria-hidden") === "true" ||
    element.getAttribute("aria-disabled") === "true"
  ) {
    return false;
  }
  if (element.hasAttribute("data-controller-cursor-target")) {
    return true;
  }
  if (
    element instanceof HTMLButtonElement ||
    element instanceof HTMLTextAreaElement
  ) {
    return !element.disabled;
  }
  if (element instanceof HTMLInputElement) {
    return !element.disabled && element.type !== "hidden";
  }
  const tabIndex = element.getAttribute("tabindex");
  return tabIndex !== null && tabIndex !== "-1";
}

function resolveInteractiveTarget(
  target: Element | null,
  scope: HTMLElement | null,
) {
  if (!target || !scope || !scope.contains(target)) {
    return null;
  }

  let current: Element | null = target;
  while (current && scope.contains(current)) {
    if (
      current instanceof HTMLElement &&
      current.hasAttribute("data-controller-cursor-target") &&
      isInteractiveElement(current)
    ) {
      return current;
    }
    current = current.parentElement;
  }

  current = target;
  while (current && scope.contains(current)) {
    if (current instanceof HTMLElement && isInteractiveElement(current)) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function resolveScrollContainer(scope: HTMLElement | null) {
  if (!scope) {
    return null;
  }
  if (scope.dataset.controllerScrollContainer === "true") {
    return scope;
  }
  return scope.querySelector<HTMLElement>(
    "[data-controller-scroll-container='true']",
  );
}

function focusElement(element: HTMLElement) {
  element.focus?.({ preventScroll: true });
  element.scrollIntoView({
    block: "nearest",
    inline: "nearest",
  });
}

function syncRangeValueFromPosition(
  input: HTMLInputElement,
  clientX: number,
) {
  const rect = input.getBoundingClientRect();
  if (rect.width <= 0) {
    return;
  }

  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const step = Number(input.step || 1) || 1;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return;
  }

  const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
  const rawValue = min + (max - min) * ratio;
  const steps = Math.round((rawValue - min) / step);
  const nextValue = clamp(min + steps * step, min, max);
  const normalized = String(nextValue);
  if (normalized === input.value) {
    return;
  }

  input.value = normalized;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function dispatchPointerSequence(
  element: HTMLElement,
  position: CursorPosition,
) {
  const eventInit = {
    bubbles: true,
    cancelable: true,
    clientX: position.x,
    clientY: position.y,
    button: 0,
  };

  element.dispatchEvent(
    new PointerEvent("pointerdown", {
      ...eventInit,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    }),
  );
  element.dispatchEvent(new MouseEvent("mousedown", eventInit));
  element.dispatchEvent(
    new PointerEvent("pointerup", {
      ...eventInit,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    }),
  );
  element.dispatchEvent(new MouseEvent("mouseup", eventInit));
  element.dispatchEvent(new MouseEvent("click", eventInit));
}

function stepRangeRow(
  row: HTMLElement,
  direction: RangeEditDirection,
) {
  const input = row.querySelector<HTMLInputElement>("input[type='range']");
  if (!input) {
    return;
  }

  const before = input.value;
  if (direction === "right") {
    input.stepUp(1);
  } else {
    input.stepDown(1);
  }
  if (before === input.value) {
    return;
  }

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function ControllerCursor({
  enabled,
  scopeRef,
  moveDeadzone,
  inputSuspended = false,
  vibrationEnabled = true,
  onBack,
}: ControllerCursorProps) {
  const [visible, setVisible] = useState(false);
  const [overInteractive, setOverInteractive] = useState(false);
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const positionRef = useRef<CursorPosition>({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  });
  const visibleRef = useRef(false);
  const hoveredRef = useRef<HTMLElement | null>(null);
  const editingRangeRowRef = useRef<HTMLElement | null>(null);
  const lastFrameRef = useRef(0);
  const prevConfirmPressedRef = useRef(false);
  const prevBackPressedRef = useRef(false);
  const rangeDirectionRef = useRef<RangeEditDirection | null>(null);
  const rangeNextRepeatAtRef = useRef(0);
  const scopeValueRef = useRef(scopeRef);
  const onBackRef = useRef(onBack);
  const moveDeadzoneRef = useRef(moveDeadzone);
  const inputSuspendedRef = useRef(inputSuspended);
  const vibrationEnabledRef = useRef(vibrationEnabled);

  useEffect(() => {
    scopeValueRef.current = scopeRef;
  }, [scopeRef]);

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    moveDeadzoneRef.current = moveDeadzone;
  }, [moveDeadzone]);

  useEffect(() => {
    inputSuspendedRef.current = inputSuspended;
    controllerCursorInputSuspended = inputSuspended;
    return () => {
      controllerCursorInputSuspended = false;
    };
  }, [inputSuspended]);

  useEffect(() => {
    vibrationEnabledRef.current = vibrationEnabled;
  }, [vibrationEnabled]);

  useEffect(() => {
    const setHoveredElement = (nextHovered: HTMLElement | null) => {
      if (hoveredRef.current === nextHovered) {
        return;
      }

      hoveredRef.current?.removeAttribute("data-controller-cursor-hover");
      if (nextHovered) {
        nextHovered.setAttribute("data-controller-cursor-hover", "true");
        nextHovered.dispatchEvent(
          new PointerEvent("pointerover", {
            bubbles: true,
            pointerType: "mouse",
            clientX: positionRef.current.x,
            clientY: positionRef.current.y,
          }),
        );
      }
      hoveredRef.current = nextHovered;
      setOverInteractive(Boolean(nextHovered));
    };

    const clearRangeEditing = () => {
      editingRangeRowRef.current?.removeAttribute("data-controller-cursor-editing");
      editingRangeRowRef.current = null;
      rangeDirectionRef.current = null;
      rangeNextRepeatAtRef.current = 0;
    };

    const clearHovered = () => {
      hoveredRef.current?.removeAttribute("data-controller-cursor-hover");
      hoveredRef.current = null;
      setOverInteractive(false);
    };

    const setCursorVisible = (nextVisible: boolean) => {
      if (visibleRef.current === nextVisible) {
        return;
      }

      visibleRef.current = nextVisible;
      controllerCursorActive = nextVisible;
      setVisible(nextVisible);
      if (!nextVisible) {
        clearRangeEditing();
        clearHovered();
      }
    };

    const enterRangeEditing = (row: HTMLElement) => {
      clearRangeEditing();
      editingRangeRowRef.current = row;
      row.setAttribute("data-controller-cursor-editing", "true");
      setHoveredElement(row);
    };

    if (!enabled) {
      controllerCursorActive = false;
      visibleRef.current = false;
      prevConfirmPressedRef.current = false;
      prevBackPressedRef.current = false;
      lastFrameRef.current = 0;
      clearRangeEditing();
      setVisible(false);
      clearHovered();
      return;
    }

    let frameId = 0;

    const hideCursor = () => {
      setCursorVisible(false);
    };

    const handleMouseMove = () => {
      hideCursor();
    };

    const tick = (now: number) => {
      const gamepad = findCompatibleGamepad();
      if (!gamepad || document.pointerLockElement !== null) {
        prevConfirmPressedRef.current = false;
        prevBackPressedRef.current = false;
        hideCursor();
        frameId = window.requestAnimationFrame(tick);
        return;
      }

      const dt = lastFrameRef.current === 0
        ? 0
        : Math.min(0.05, (now - lastFrameRef.current) / 1000);
      lastFrameRef.current = now;

      const moveX = normalizeStickAxis(
        gamepad.axes[0] ?? 0,
        moveDeadzoneRef.current,
      );
      const moveY = resolveCursorMoveY(gamepad, moveDeadzoneRef.current);
      const movedByStick = Math.abs(moveX) > 0 || Math.abs(moveY) > 0;
      const scrollContainer = resolveScrollContainer(scopeValueRef.current.current);

      if (movedByStick && !editingRangeRowRef.current) {
        const nextPosition = clampToViewport({
          x: positionRef.current.x + moveX * CURSOR_SPEED_PX_PER_SECOND * dt,
          y: positionRef.current.y + moveY * CURSOR_SPEED_PX_PER_SECOND * dt,
        });
        positionRef.current = nextPosition;
        const cursor = cursorRef.current;
        if (cursor) {
          cursor.style.setProperty("--controller-cursor-x", `${nextPosition.x}px`);
          cursor.style.setProperty("--controller-cursor-y", `${nextPosition.y}px`);
        }
        setCursorVisible(true);
      }

      if (scrollContainer && !editingRangeRowRef.current) {
        const rightStickScroll = normalizeStickAxis(gamepad.axes[3] ?? 0, 0.2);
        const dpadScroll = isGamepadButtonPressed(gamepad, 13)
          ? 1
          : isGamepadButtonPressed(gamepad, 12)
          ? -1
          : 0;
        const edgeScroll = movedByStick
          ? (() => {
            const rect = scrollContainer.getBoundingClientRect();
            const canScrollDown =
              positionRef.current.y >= rect.bottom - CURSOR_EDGE_SCROLL_THRESHOLD &&
              moveY > 0;
            const canScrollUp =
              positionRef.current.y <= rect.top + CURSOR_EDGE_SCROLL_THRESHOLD &&
              moveY < 0;
            if (canScrollDown || canScrollUp) {
              return moveY;
            }
            return 0;
          })()
          : 0;
        const scrollInput = dpadScroll !== 0
          ? dpadScroll
          : Math.abs(rightStickScroll) > 0
          ? rightStickScroll
          : edgeScroll;

        if (scrollInput !== 0) {
          const maxScroll = Math.max(
            0,
            scrollContainer.scrollHeight - scrollContainer.clientHeight,
          );
          scrollContainer.scrollTop = clamp(
            scrollContainer.scrollTop +
              scrollInput * CURSOR_SCROLL_SPEED_PX_PER_SECOND * dt,
            0,
            maxScroll,
          );
        }
      }

      if (!visibleRef.current) {
        prevConfirmPressedRef.current = isGamepadButtonPressed(gamepad, 0);
        prevBackPressedRef.current = isGamepadButtonPressed(gamepad, 1);
        frameId = window.requestAnimationFrame(tick);
        return;
      }

      if (
        editingRangeRowRef.current &&
        (!editingRangeRowRef.current.isConnected ||
          !scopeValueRef.current.current?.contains(editingRangeRowRef.current))
      ) {
        clearRangeEditing();
      }

      const hovered = editingRangeRowRef.current ??
        resolveInteractiveTarget(
          document.elementFromPoint(positionRef.current.x, positionRef.current.y),
          scopeValueRef.current.current,
        );
      setHoveredElement(hovered);

      const confirmPressed = isGamepadButtonPressed(gamepad, 0);
      const backPressed = isGamepadButtonPressed(gamepad, 1);

      if (inputSuspendedRef.current) {
        clearRangeEditing();
        prevConfirmPressedRef.current = confirmPressed;
        prevBackPressedRef.current = backPressed;
        frameId = window.requestAnimationFrame(tick);
        return;
      }

      if (editingRangeRowRef.current) {
        const leftPressed =
          isGamepadButtonPressed(gamepad, 14) ||
          (gamepad.axes[0] ?? 0) <= -RANGE_EDIT_AXIS_THRESHOLD;
        const rightPressed =
          isGamepadButtonPressed(gamepad, 15) ||
          (gamepad.axes[0] ?? 0) >= RANGE_EDIT_AXIS_THRESHOLD;
        const direction = leftPressed && !rightPressed
          ? "left"
          : rightPressed && !leftPressed
          ? "right"
          : null;

        if (!direction) {
          rangeDirectionRef.current = null;
          rangeNextRepeatAtRef.current = 0;
        } else {
          const wasHeld = rangeDirectionRef.current === direction &&
            rangeNextRepeatAtRef.current > 0;
          if (!wasHeld || now >= rangeNextRepeatAtRef.current) {
            stepRangeRow(editingRangeRowRef.current, direction);
            rangeDirectionRef.current = direction;
            rangeNextRepeatAtRef.current = now +
              (wasHeld ? RANGE_EDIT_REPEAT_MS : RANGE_EDIT_INITIAL_MS);
          }
        }

        if (
          (confirmPressed && !prevConfirmPressedRef.current) ||
          (backPressed && !prevBackPressedRef.current)
        ) {
          clearRangeEditing();
        }

        prevConfirmPressedRef.current = confirmPressed;
        prevBackPressedRef.current = backPressed;
        frameId = window.requestAnimationFrame(tick);
        return;
      }

      if (confirmPressed && !prevConfirmPressedRef.current && hovered) {
        if (hovered.dataset.controllerRangeRow === "true") {
          enterRangeEditing(hovered);
        } else {
          focusElement(hovered);
          playControllerRumble(UI_PRESS_RUMBLE, {
            enabled: vibrationEnabledRef.current,
            channel: "ui",
          });

          const previousRangeValue =
            hovered instanceof HTMLInputElement && hovered.type === "range"
              ? hovered.value
              : null;

          dispatchPointerSequence(hovered, positionRef.current);

          if (
            hovered instanceof HTMLInputElement &&
            hovered.type === "range" &&
            previousRangeValue === hovered.value
          ) {
            syncRangeValueFromPosition(hovered, positionRef.current.x);
          }

          if (
            hovered instanceof HTMLButtonElement &&
            hovered.closest(".inventory-overlay")
          ) {
            hovered.dispatchEvent(
              new MouseEvent("dblclick", {
                bubbles: true,
                cancelable: true,
                clientX: positionRef.current.x,
                clientY: positionRef.current.y,
                button: 0,
              }),
            );
          }
        }
      }
      prevConfirmPressedRef.current = confirmPressed;

      if (backPressed && !prevBackPressedRef.current) {
        playControllerRumble(UI_PRESS_RUMBLE, {
          enabled: vibrationEnabledRef.current,
          channel: "ui",
        });
        onBackRef.current?.();
      }
      prevBackPressedRef.current = backPressed;

      frameId = window.requestAnimationFrame(tick);
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    frameId = window.requestAnimationFrame((now) => {
      lastFrameRef.current = now;
      tick(now);
    });

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.cancelAnimationFrame(frameId);
      lastFrameRef.current = 0;
      prevConfirmPressedRef.current = false;
      prevBackPressedRef.current = false;
      controllerCursorActive = false;
      visibleRef.current = false;
      clearRangeEditing();
      clearHovered();
    };
  }, [enabled]);

  const cursorStyle = {
    ["--controller-cursor-x" as string]: `${positionRef.current.x}px`,
    ["--controller-cursor-y" as string]: `${positionRef.current.y}px`,
    position: "fixed",
    left: 0,
    top: 0,
    width: `${CURSOR_SIZE}px`,
    height: `${CURSOR_SIZE}px`,
    borderRadius: "999px",
    pointerEvents: "none",
    zIndex: 99999,
    opacity: visible ? 1 : 0,
    transform:
      `translate3d(calc(var(--controller-cursor-x, 0px) - 50%), calc(var(--controller-cursor-y, 0px) - 50%), 0) scale(${overInteractive ? 1.2 : 1})`,
    border: `2px solid ${overInteractive ? "rgba(255, 255, 255, 1)" : "rgba(255, 255, 255, 0.75)"}`,
    background: overInteractive
      ? "rgba(255, 255, 255, 0.25)"
      : "rgba(255, 255, 255, 0.1)",
    boxShadow:
      "0 0 0 1px rgba(0, 0, 0, 0.35), 0 0 14px rgba(0, 0, 0, 0.48)",
    transition:
      "opacity 120ms ease, background 120ms ease, border-color 120ms ease",
  } as CSSProperties;

  return <div ref={cursorRef} aria-hidden="true" style={cursorStyle} />;
}
