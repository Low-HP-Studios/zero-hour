import { memo } from "react";

type MenuSectionProps = {
  title: string;
  blurb?: string;
  children: React.ReactNode;
};

export const MenuSection = memo(function MenuSection({
  title,
  blurb,
  children,
}: MenuSectionProps) {
  return (
    <section className="menu-section">
      <header className="menu-section-header">
        <h3>{title}</h3>
        {blurb ? <p className="muted">{blurb}</p> : null}
      </header>
      <div className="menu-section-body">{children}</div>
    </section>
  );
});

type MetricCardProps = {
  label: string;
  value: string;
};

export const MetricCard = memo(function MetricCard({
  label,
  value,
}: MetricCardProps) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
});

type SwitchRowProps = {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

export const SwitchRow = memo(function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: SwitchRowProps) {
  return (
    <label className="switch-row">
      <span>
        <span className="field-label">{label}</span>
        <span className="field-hint">{hint}</span>
      </span>
      <span className="switch-shell">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span className="switch-track" aria-hidden="true">
          <span className="switch-thumb" />
        </span>
      </span>
    </label>
  );
});

type RangeFieldProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
};

export const RangeField = memo(function RangeField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: RangeFieldProps) {
  const decimals = step < 1 ? Math.max(0, Math.ceil(-Math.log10(step))) : 0;
  const display = decimals > 0 ? value.toFixed(decimals) : String(value);

  return (
    <div className="range-field">
      <div className="range-label-row">
        <span className="field-label">{label}</span>
        <span className="range-value">
          {display}
          {suffix ?? ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </div>
  );
});

type VolumeSliderProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
};

export const VolumeSlider = memo(function VolumeSlider({
  label,
  value,
  onChange,
}: VolumeSliderProps) {
  return (
    <div className="range-field volume-field">
      <div className="range-label-row">
        <span className="field-label">{label}</span>
        <span className="range-value">{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </div>
  );
});

export type { PauseMenuTab } from "./settings";

export function menuTitle(tab: import("./settings").PauseMenuTab) {
  switch (tab) {
    case "practice":
      return "Practice Menu";
    case "gameplay":
      return "Gameplay Settings";
    case "audio":
      return "Audio Settings";
    case "controls":
      return "Control Settings";
    case "graphics":
      return "Graphics Settings";
    case "hud":
      return "HUD Settings";
    case "updates":
      return "Updates & Repair";
    default:
      return "Settings";
  }
}

export function formatKeyCode(code: string) {
  if (code.startsWith("Key")) return code.slice(3).toUpperCase();
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "Space") return "Space";
  if (code === "ShiftLeft") return "L-Shift";
  if (code === "ShiftRight") return "R-Shift";
  if (code === "ControlLeft") return "L-Ctrl";
  if (code === "ControlRight") return "R-Ctrl";
  if (code === "AltLeft") return "L-Alt";
  if (code === "AltRight") return "R-Alt";
  if (code.startsWith("Arrow")) return code.slice(5);
  return code;
}
