# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install          # install dependencies
pnpm dev              # start Vite dev server + launch Electron
pnpm dev:electron     # same as above (alias)
pnpm build            # TypeScript check + Vite web build
pnpm build:electron   # web build + package as Electron app
pnpm build:mac        # macOS DMG
pnpm build:win        # Windows NSIS installer
pnpm build:linux      # Linux AppImage
pnpm typecheck        # tsc --noEmit (no tests exist)
pnpm lint             # eslint .
pnpm preview          # preview the Vite web build
```

Package manager is `pnpm`. There are no automated tests.

## Architecture

This is a first-person shooter prototype built with React + Three.js (via `@react-three/fiber`) packaged as an Electron desktop app.

### Screen flow (`src/App.tsx`)

```
LoadingScreen -> MainMenu -> GameRoot
```

`App.tsx` manages a `Screen` state (`"loading" | "lobby" | "playing"`) and renders the corresponding component. Navigation is passed via callbacks (`onComplete`, `onStartGame`, `onReturnToLobby`).

### Game layer (`src/game/`)

- **`GameRoot.tsx`** — Top-level game component. Owns all React state for settings, HUD overlays, pause menu, and perf metrics. Renders the `<Canvas>` (r3f) containing `<Scene>`, plus all DOM overlays (crosshair, hitmarker, ammo HUD, pause menu tabs via `SettingsPanels`).
- **`Scene.tsx`** — The r3f scene graph. Owns the Three.js render loop. Composes `PlayerController`, `WeaponSystem`, `Targets`, `AudioManager`, and all geometry (map, building, cover, ocean). Fires callbacks to `GameRoot` for HUD updates.
- **`PlayerController.ts`** — `usePlayerController` hook. Handles pointer lock, WASD movement, sprinting, jumping, mouse look, ADS, first/third-person toggle, and AABB collision against `CollisionRect[]`. Returns a `PlayerControllerApi` (imperative handle used by `Scene` to apply recoil and read state each frame).
- **`Weapon.ts`** — `WeaponSystem` r3f component. Manages fire rate, recoil generation, tracer rendering, muzzle flash, weapon switch animation, and sniper rechamber. Emits `WeaponShotEvent` to `Scene` which then raycasts targets.
- **`Targets.tsx`** — `Targets` r3f component + pure helpers (`createDefaultTargets`, `raycastTargets`, `resetTargets`). Manages 3 shootable targets with HP, hit flash, respawn timer.
- **`Audio.ts`** — `AudioManager` class (Web Audio API). Manages footstep, gunshot, hit, and ambient audio with voice pooling. Gracefully falls back to synthesized audio if asset files are missing.
- **`AssetLoader.ts`** — Helpers for loading FBX models and animations (`loadFbxAsset`, `loadFbxAnimation`).
- **`PerfHUD.tsx`** — Overlay reading `PerfMetrics` from `GameRoot` state.
- **`SettingsPanels.tsx`** — Pause menu tabs (Practice, Gameplay, Audio, Controls, Graphics, HUD, Updates).
- **`types.ts`** — Shared TypeScript types and defaults: `GameSettings`, `ControlBindings`, `PlayerSnapshot`, `TargetState`, `CollisionRect`, `WorldBounds`, `PerfMetrics`, etc.

### Screens (`src/screens/`)

- **`LoadingScreen.tsx`** — Fake progress bar, transitions to lobby on complete.
- **`MainMenu.tsx`** — Lobby/main menu with character preview and play button.
- **`LobbyCharacter.tsx`** — 3D character viewer used inside `MainMenu`.

### Electron (`electron/`)

- **`main.js`** — Electron main process. Creates `BrowserWindow`, loads Vite dev server or built `dist/index.html`.
- **`preload.cjs`** — Context bridge (minimal).
- **`updater.cjs`** — `electron-updater` integration for auto-updates via GitHub releases.

### Key patterns

- All game state that drives the DOM HUD lives in `GameRoot` as React state; the r3f scene communicates upward via callbacks.
- `PlayerController` and `Weapon` use the r3f `useFrame` loop — avoid heavy allocations inside `useFrame`.
- Collision is custom AABB/circle — no physics engine. `CollisionRect[]` is built in `Scene` and passed to `PlayerController`.
- Assets live in `public/assets/` (models as `.glb`/`.fbx`, audio as files). The audio system synthesizes fallbacks if files are absent.
- Vite dev server runs on port `1420` (referenced in `dev:electron` script and Electron `main.js`).
