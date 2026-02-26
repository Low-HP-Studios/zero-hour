# Architecture

## Purpose

Practice-only TPS (third-person shooter) prototype focused on movement feel, camera systems, and performance testing.
Not a full game. No backend. No networking.

Originally started as an FPS prototype, converted to TPS for visible character feedback.

## High-Level Stack

- UI shell: React 19 + TypeScript
- Rendering: Three.js via `@react-three/fiber` v9
- Desktop wrapper: Tauri v2
- Build/dev: Vite + pnpm
- Audio: WebAudio (buffer loading + synth fallbacks)

## Runtime Structure (Current)

- `src/App.tsx`
  - Mounts `GameRoot`
- `src/game/GameRoot.tsx`
  - Top-level UI overlay state (settings, HUD, pause UI, hit marker)
  - HUD visibility toggle (show/hide all corner panels)
  - Passes settings + callbacks into scene runtime
- `src/game/Scene.tsx`
  - R3F `Canvas`
  - Environment/map geometry (ground, cover blocks, building shell)
  - Visible player character model (box-based humanoid with weapon)
  - Runtime systems orchestration (player controller, weapon, targets, audio, perf sampling)
  - Tracer origin calculation from character weapon position
- `src/game/PlayerController.ts`
  - Mouse look, WASD/sprint/jump, lightweight collision resolution
  - Over-the-shoulder TPS camera (PUBG-style shoulder offset)
  - ADS zoom on right-click (shorter arm, tighter shoulder offset)
  - Pointer lock with Tauri WKWebView fallback capture mode
  - Asymmetric gravity (Valorant-style jump physics)
- `src/game/Weapon.ts`
  - Rifle state, pickup/drop, auto fire cadence, recoil pattern, muzzle/tracer timing
- `src/game/Targets.tsx`
  - Destructible humanoid target dummies with HP system
  - Floating HP bars (billboard toward camera)
  - Ray-hit helpers, respawn after destruction
- `src/game/Audio.ts`
  - Audio manager (WebAudio), pooled gunshots, footsteps, hit sounds, file/synth fallback
- `src/game/PerfHUD.tsx`
  - Overlay metrics presentation
- `src/game/AssetLoader.ts`
  - GLB/audio loading helpers with graceful failure

## Data Flow (Typical Frame)

1. Player input updates in `PlayerController`
2. TPS camera position calculated (orbit behind player + shoulder offset + ADS interpolation)
3. Weapon system advances fire timer if trigger is held
4. Shot direction from `camera.getWorldDirection()` (crosshair aim)
5. Hitscan raycasts against target hit spheres, applies HP damage
6. Tracer origin computed from character weapon position toward hit point
7. Target state mutates (HP reduction, hit flash, disable at 0 HP, respawn timer)
8. Audio manager plays gunshot/hit/footsteps
9. Player character model position/rotation synced to controller state
10. Perf metrics sampled from `gl.info`
11. `GameRoot` updates HTML overlay/HUD state

## Rendering Layers

- 3D world (R3F canvas)
- Visible player character with attached weapon (3D, world-space)
- Destructible target dummies with HP bars (3D, world-space, billboard)
- HTML overlay (HUD, settings, pause menu)

## Camera System

- PUBG-style over-the-shoulder: camera orbits behind player with a right-side offset
- LookAt point is offset by shoulder amount so camera looks PAST the character
- Crosshair at screen center represents the actual aim direction
- ADS (right-click hold): camera moves closer, shoulder offset tightens, smooth interpolation
- Pitch controls elevation angle (clamped), yaw controls orbit rotation

## Collision / Physics Strategy (Current)

- Custom 2D XZ circle-vs-AABB collision for player locomotion
- Asymmetric gravity on Y axis (lighter rise, floaty peak, faster fall)
- Hitscan directly ray-tests target hit spheres (not full world occlusion)

### Why this approach

Fast to iterate and stable for a prototype.

### Trade-off

Less realistic and less extensible than a full physics stack (`rapier`), especially for slopes, dynamic rigid bodies, and robust character movement.

## Extension Points

- Swap placeholder map props with GLB assets via `AssetLoader`
- Add world hit/occlusion ray tests before target checks
- Replace custom collisions with `@react-three/rapier` if needed
- Add configurable weapon presets (fire rate, recoil profile, audio)
- Add more target types (moving, armored, different HP)
