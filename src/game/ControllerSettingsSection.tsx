import { memo } from "react";
import { RangeField, MenuSection, SwitchRow } from "./SettingsPanels";
import type { ControllerSettings } from "./types";

type ControllerSettingsSectionProps = {
  settings: ControllerSettings;
  onChange: (next: ControllerSettings) => void;
};

export const ControllerSettingsSection = memo(
  function ControllerSettingsSection({
    settings,
    onChange,
  }: ControllerSettingsSectionProps) {
    return (
      <MenuSection
        title="Controller"
        blurb="Uses the first compatible gamepad it finds. Full remapping can keep waiting in the parking lot."
      >
        <SwitchRow
          label="Enable Controller Input"
          hint="Allows gameplay input from the first detected compatible gamepad."
          checked={settings.enabled}
          onChange={(enabled) => onChange({ ...settings, enabled })}
        />
        <RangeField
          label="Move Deadzone"
          value={settings.moveDeadzone}
          min={0}
          max={0.4}
          step={0.01}
          onChange={(moveDeadzone) => onChange({ ...settings, moveDeadzone })}
        />
        <RangeField
          label="Look Deadzone"
          value={settings.lookDeadzone}
          min={0}
          max={0.35}
          step={0.01}
          onChange={(lookDeadzone) => onChange({ ...settings, lookDeadzone })}
        />
        <RangeField
          label="Look Sensitivity X"
          value={settings.lookSensitivityX}
          min={0.2}
          max={3}
          step={0.05}
          onChange={(lookSensitivityX) =>
            onChange({ ...settings, lookSensitivityX })}
        />
        <RangeField
          label="Look Sensitivity Y"
          value={settings.lookSensitivityY}
          min={0.2}
          max={3}
          step={0.05}
          onChange={(lookSensitivityY) =>
            onChange({ ...settings, lookSensitivityY })}
        />
        <SwitchRow
          label="L3 Toggle Sprint"
          hint="One press turns sprint on, another turns it off. Holding is for the old gods."
          checked={settings.toggleSprint}
          onChange={(toggleSprint) => onChange({ ...settings, toggleSprint })}
        />
        <SwitchRow
          label="Invert Move Y"
          hint="Flips forward/back on the left stick for controllers with cursed axis reporting."
          checked={settings.invertMoveY}
          onChange={(invertMoveY) => onChange({ ...settings, invertMoveY })}
        />
        <SwitchRow
          label="Invert Look Y"
          hint="Turns stick-up into camera-down, for people who enjoy aviation trauma."
          checked={settings.invertY}
          onChange={(invertY) => onChange({ ...settings, invertY })}
        />
      </MenuSection>
    );
  },
);
