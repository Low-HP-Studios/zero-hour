import { memo, useCallback, useEffect, useMemo, useState } from "react";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function countDecimals(step: number) {
  return step < 1 ? Math.max(0, Math.ceil(-Math.log10(step))) : 0;
}

function roundToStep(value: number, min: number, max: number, step: number) {
  const next = clamp(value, min, max);
  const steps = Math.round((next - min) / step);
  return clamp(min + steps * step, min, max);
}

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
    <label className="switch-row" data-controller-cursor-target="switch-row">
      <span className="field-copy">
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
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
};

export const RangeField = memo(function RangeField({
  label,
  hint,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: RangeFieldProps) {
  const decimals = useMemo(() => countDecimals(step), [step]);
  const formatValue = useCallback(
    (next: number) => decimals > 0 ? next.toFixed(decimals) : String(next),
    [decimals],
  );
  const [draftValue, setDraftValue] = useState(() => formatValue(value));

  useEffect(() => {
    setDraftValue(formatValue(value));
  }, [formatValue, value]);

  const display = formatValue(value);

  const applyValue = (next: number) => {
    const rounded = roundToStep(next, min, max, step);
    if (Math.abs(rounded - value) > Number.EPSILON) {
      onChange(rounded);
    }
    setDraftValue(formatValue(rounded));
  };

  const commitDraftValue = () => {
    const parsed = Number(draftValue);
    if (!Number.isFinite(parsed)) {
      setDraftValue(formatValue(value));
      return;
    }
    applyValue(parsed);
  };

  return (
    <div
      className="range-field"
      data-controller-cursor-target="range-row"
      data-controller-range-row="true"
    >
      <div className="range-label-row">
        <div className="field-copy">
          <span className="field-label">{label}</span>
          {hint ? <span className="field-hint">{hint}</span> : null}
        </div>
        <span className="range-value">
          {display}
          {suffix ?? ""}
        </span>
      </div>
      <div className="range-control-row">
        <button
          type="button"
          className="range-step-btn"
          onClick={() => applyValue(value - step)}
          aria-label={`Decrease ${label}`}
        >
          -
        </button>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
        <div className="range-number-shell">
          <input
            type="number"
            className="range-number-input"
            min={min}
            max={max}
            step={step}
            inputMode="decimal"
            value={draftValue}
            onChange={(event) => setDraftValue(event.currentTarget.value)}
            onBlur={commitDraftValue}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitDraftValue();
              }
              if (event.key === "Escape") {
                setDraftValue(formatValue(value));
                event.currentTarget.blur();
              }
            }}
            aria-label={`${label} value`}
          />
          {suffix ? <span className="range-number-suffix">{suffix}</span> : null}
        </div>
        <button
          type="button"
          className="range-step-btn"
          onClick={() => applyValue(value + step)}
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
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
    <div
      className="range-field volume-field"
      data-controller-cursor-target="range-row"
      data-controller-range-row="true"
    >
      <div className="range-label-row">
        <div className="field-copy">
          <span className="field-label">{label}</span>
          <span className="field-hint">Adjust the {label.toLowerCase()} mix level.</span>
        </div>
        <span className="range-value">{Math.round(value * 100)}%</span>
      </div>
      <div className="range-control-row">
        <button
          type="button"
          className="range-step-btn"
          onClick={() => onChange(clamp(value - 0.01, 0, 1))}
          aria-label={`Decrease ${label}`}
        >
          -
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={value}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
        <div className="range-number-shell">
          <input
            type="number"
            className="range-number-input"
            min={0}
            max={100}
            step={1}
            inputMode="numeric"
            value={Math.round(value * 100)}
            onChange={(event) => {
              const parsed = Number(event.currentTarget.value);
              if (!Number.isFinite(parsed)) {
                return;
              }
              onChange(clamp(parsed / 100, 0, 1));
            }}
            aria-label={`${label} percentage`}
          />
          <span className="range-number-suffix">%</span>
        </div>
        <button
          type="button"
          className="range-step-btn"
          onClick={() => onChange(clamp(value + 0.01, 0, 1))}
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
});

export type { SettingsTabId } from "./settings";

export function menuTitle(tab: import("./settings").SettingsTabId) {
  switch (tab) {
    case "sensitivity":
      return "Sensitivity";
    case "audio":
      return "Audio";
    case "controls":
      return "Controls";
    case "graphics":
      return "Graphics";
    case "crosshair":
      return "Crosshair";
    case "imports":
      return "Imports";
    case "system":
      return "System";
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
