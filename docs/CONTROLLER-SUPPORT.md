# Controller Support

Plan for adding gamepad/controller support to Zero Hour using the browser Gamepad API.

## Overview

The browser's built-in Gamepad API (`navigator.getGamepad()`) works in both web and Electron — no native plugins required. Controller input needs to be integrated into the existing `PlayerController` and `WeaponSystem` loops.

## Components

### 1. Gamepad Input Layer

- New module (e.g., `GamepadManager.ts`) to poll the Gamepad API each frame
- Handle controller connect/disconnect events (`gamepadconnected`, `gamepaddisconnected`)
- Provide normalized axis/button state to consuming systems

### 2. Control Mapping

Default FPS layout:

| Action         | Keyboard/Mouse | Controller          |
| -------------- | -------------- | ------------------- |
| Move           | WASD           | Left Stick          |
| Look           | Mouse          | Right Stick         |
| Shoot          | Left Click     | Right Trigger (RT)  |
| ADS            | Right Click    | Left Trigger (LT)   |
| Jump           | Space          | A / Cross           |
| Sprint         | Shift          | L3 (left stick click) |
| Reload         | R              | X / Square          |
| Weapon Switch  | 1/2/3          | Y / Triangle        |
| Pause          | Esc            | Start / Options     |

### 3. Stick Handling

- **Deadzone**: ignore small stick deflections (configurable, default ~0.15)
- **Sensitivity curves**: non-linear response for finer aim control
- **Analog movement**: left stick gives -1 to 1 float values, enabling variable walk speed

### 4. Aim Assist (Optional)

- **Aim slowdown**: reduce look sensitivity when crosshair is near a target
- **Sticky aim**: slight magnetism pulling toward nearby targets
- Configurable strength or toggle in settings

### 5. Settings UI

Add to `SettingsPanels.tsx`:

- Controller sensitivity sliders (look X/Y)
- Deadzone slider
- Invert Y-axis toggle
- Aim assist strength
- Button remapping (stretch goal)

### 6. HUD Adaptation

- Detect last-used input method (keyboard vs controller)
- Show appropriate button icons/prompts based on active input
- Seamless switching — user can swap between controller and keyboard at any time

### 7. Type Changes

Extend `ControlBindings` in `types.ts` to include gamepad mappings alongside existing keyboard bindings.

## Implementation Approach

**Recommended: Minimal-first (Option A)**

Poll the Gamepad API directly inside `useFrame` in `PlayerController.ts`, translate stick/button values into the same movement and look logic that keyboard/mouse use. Minimal new files, fast to get working.

A full input abstraction layer (Option B) can be done as a follow-up refactor if needed.

## Files to Modify

- `src/game/PlayerController.ts` — add gamepad polling for movement + look
- `src/game/Weapon.ts` — add gamepad trigger for shoot/ADS/reload/switch
- `src/game/types.ts` — extend `ControlBindings` with gamepad fields
- `src/game/SettingsPanels.tsx` — add controller settings tab
- `src/game/GameRoot.tsx` — wire up controller settings state

## New Files

- `src/game/GamepadManager.ts` — gamepad polling, state normalization, connect/disconnect

## References

- [Gamepad API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API)
- [Using the Gamepad API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API)
