import type {
  ControlBindings,
  HudOverlayToggles,
  PixelRatioScale,
  StressModeCount,
} from "../types";

export type PauseMenuTab =
  | "practice"
  | "gameplay"
  | "audio"
  | "controls"
  | "graphics"
  | "hud";

export type BindingKey = keyof ControlBindings;

export type MenuTabOption = {
  id: PauseMenuTab;
  label: string;
  hint: string;
};

export type BindingDefinition = {
  key: BindingKey;
  label: string;
  hint: string;
};

export const STRESS_STEPS: StressModeCount[] = [0, 50, 100, 200];

export const PIXEL_RATIO_OPTIONS: Array<{ value: PixelRatioScale; label: string }> = [
  { value: 0.5, label: "Low" },
  { value: 0.75, label: "Normal" },
  { value: 1, label: "High" },
];

export const MENU_TABS: MenuTabOption[] = [
  { id: "practice", label: "Practice", hint: "Range presets" },
  { id: "gameplay", label: "Gameplay", hint: "Look & ADS" },
  { id: "audio", label: "Audio", hint: "Mix levels" },
  { id: "controls", label: "Controls", hint: "Keybinds" },
  { id: "graphics", label: "Graphics", hint: "Render" },
  { id: "hud", label: "HUD", hint: "Panels" },
];

export const BINDING_ROWS: BindingDefinition[] = [
  { key: "moveForward", label: "Move Forward", hint: "Walk forward" },
  { key: "moveBackward", label: "Move Backward", hint: "Backpedal" },
  { key: "moveLeft", label: "Move Left", hint: "Strafe left" },
  { key: "moveRight", label: "Move Right", hint: "Strafe right" },
  { key: "sprint", label: "Run Modifier", hint: "Hold to run" },
  { key: "walkModifier", label: "Walk Modifier", hint: "Hold to walk" },
  { key: "crouch", label: "Crouch", hint: "Hold / toggle stance" },
  { key: "jump", label: "Jump", hint: "Hop" },
  { key: "toggleView", label: "Toggle View", hint: "FPP / TPP" },
  { key: "peekLeft", label: "Peek Left", hint: "Lean left" },
  { key: "peekRight", label: "Peek Right", hint: "Lean right" },
  { key: "equipRifle", label: "Equip Rifle", hint: "Weapon slot" },
  { key: "equipSniper", label: "Equip Sniper", hint: "Weapon slot" },
  { key: "reset", label: "Reset Targets", hint: "Practice reset" },
  { key: "pickup", label: "Pickup", hint: "Pickup weapon" },
  { key: "drop", label: "Drop", hint: "Drop weapon" },
];

export const OVERLAY_ROWS: Array<
  { key: keyof HudOverlayToggles; label: string; hint: string }
> = [
  { key: "practice", label: "Practice panel", hint: "Top-left range status" },
  {
    key: "controls",
    label: "Controls panel",
    hint: "Bottom-left shortcut list",
  },
  {
    key: "settings",
    label: "Settings panel",
    hint: "Bottom-right quick settings",
  },
  {
    key: "performance",
    label: "Performance panel",
    hint: "Top-right perf HUD",
  },
];
