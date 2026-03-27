import type {
  ControlBindings,
  ControllerBindingKey,
  HudOverlayToggles,
  PixelRatioScale,
  StressModeCount,
} from "../types";

export type SettingsTabId =
  | "sensitivity"
  | "audio"
  | "controls"
  | "graphics"
  | "crosshair"
  | "imports"
  | "system";

export type BindingKey = keyof ControlBindings;

export type MenuTabOption = {
  id: SettingsTabId;
  label: string;
  hint: string;
};

export type BindingDefinition = {
  key: BindingKey;
  label: string;
  hint: string;
};

export type ControllerBindingDefinition = {
  key: ControllerBindingKey;
  label: string;
  hint: string;
};

export type ControllerBindingGroup = {
  title: string;
  blurb: string;
  bindings: ControllerBindingDefinition[];
};

export const STRESS_STEPS: StressModeCount[] = [0, 50, 100, 200];

export const PIXEL_RATIO_OPTIONS: Array<{ value: PixelRatioScale; label: string }> = [
  { value: 0.5, label: "Low" },
  { value: 0.75, label: "Normal" },
  { value: 1, label: "High" },
];


export const MENU_TABS: MenuTabOption[] = [
  { id: "sensitivity", label: "Sensitivity", hint: "Mouse and controller aim" },
  { id: "audio", label: "Audio", hint: "Mix levels" },
  { id: "controls", label: "Controls", hint: "Bindings and behavior" },
  { id: "graphics", label: "Graphics", hint: "Render and performance" },
  { id: "crosshair", label: "Crosshair", hint: "Preview and tuning" },
  { id: "imports", label: "Imports", hint: "Profiles and presets" },
  { id: "system", label: "System", hint: "Maintenance" },
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
  { key: "unarm", label: "Holster Weapons", hint: "Put weapons on back" },
  { key: "reload", label: "Reload", hint: "Manual reload" },
  { key: "tab", label: "Inventory Panel", hint: "Open tactical inventory" },
  { key: "reset", label: "Reset Targets", hint: "Practice reset" },
  { key: "pickup", label: "Pickup", hint: "Pickup weapon" },
  { key: "drop", label: "Drop", hint: "Drop weapon" },
];

export const OVERLAY_ROWS: Array<
  { key: keyof HudOverlayToggles; label: string; hint: string }
> = [
  {
    key: "statsBar",
    label: "Stats bar",
    hint: "Ping, FPS, CPU, GPU (top-right)",
  },
];

export const CONTROLLER_BINDING_GROUPS: ControllerBindingGroup[] = [
  {
    title: "Combat",
    blurb: "Choose which buttons handle shooting, aiming, and weapon actions.",
    bindings: [
      { key: "fire", label: "Fire Weapon", hint: "Shoot the active weapon" },
      { key: "ads", label: "Aim Down Sights", hint: "Aim with the active weapon" },
      { key: "reload", label: "Reload", hint: "Reload the active weapon" },
      { key: "pickup", label: "Pick Up Item", hint: "Pick up nearby gear" },
      { key: "drop", label: "Drop Weapon", hint: "Drop the current weapon" },
    ],
  },
  {
    title: "Movement",
    blurb: "Set the buttons used for movement actions and stance changes.",
    bindings: [
      { key: "jump", label: "Jump", hint: "Jump or vault" },
      { key: "crouch", label: "Crouch", hint: "Crouch or stand" },
      { key: "sprint", label: "Sprint", hint: "Sprint modifier or toggle" },
      { key: "peekLeft", label: "Peek Left", hint: "Lean left while held" },
      { key: "peekRight", label: "Peek Right", hint: "Lean right while held" },
    ],
  },
  {
    title: "Menus and equipment",
    blurb: "Configure inventory, pause, view, and quick weapon actions.",
    bindings: [
      { key: "inventory", label: "Inventory", hint: "Open the inventory panel" },
      { key: "pause", label: "Pause Menu", hint: "Open the pause menu" },
      { key: "toggleView", label: "Toggle View", hint: "Switch first or third person" },
      { key: "equipRifle", label: "Equip Rifle", hint: "Raise the primary weapon" },
      { key: "equipSniper", label: "Equip Sniper", hint: "Raise the secondary weapon" },
    ],
  },
];

const CONTROLLER_BUTTON_LABELS: Record<number, string> = {
  0: "A / Cross",
  1: "B / Circle",
  2: "X / Square",
  3: "Y / Triangle",
  4: "Left Bumper",
  5: "Right Bumper",
  6: "Left Trigger",
  7: "Right Trigger",
  8: "View / Share",
  9: "Menu / Options",
  10: "Left Stick Press",
  11: "Right Stick Press",
  12: "D-pad Up",
  13: "D-pad Down",
  14: "D-pad Left",
  15: "D-pad Right",
};

export function formatControllerButtonIndex(index: number) {
  return CONTROLLER_BUTTON_LABELS[index] ?? `Button ${index}`;
}
