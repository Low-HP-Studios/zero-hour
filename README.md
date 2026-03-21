# Greytrace (React + Three.js + Electron)

Minimal first-person prototype focused on movement feel and performance testing.
This is **not** a full game. No backend, no progression, no networking.

Stack:
- React 19 + TypeScript + Vite
- Three.js via `@react-three/fiber` (v9)
- Electron (desktop packaging, bundled Chromium for uncapped FPS + reliable pointer lock)
- `pnpm` for JS package management

## What is implemented

- First-person camera + pointer lock
- WASD movement + sprint
- Selectable practice maps: procedural `Range` and traversal-only `School`
- Simple collision blocking (custom AABB/circle collision, no physics engine)
- Pickup/drop rifle (`F` / `G`)
- Automatic fire with recoil climb + horizontal drift (spray feel)
- Hitscan shooting
- 3 shootable targets with hit flash + reset (`R`)
- Muzzle flash + tracers
- WebAudio-based footsteps / gunshots / hit sounds
  - audio pooling for rapid fire (bounded voice pool)
  - graceful synth fallback if no sound files exist
- Perf HUD + `r3f-perf` toggle
- Settings panel: shadows, pixel ratio, audio volumes, stress mode (0/50/100/200 boxes)

## Prerequisites

### All platforms
- Node.js 20+
- `pnpm` 10+

## Setup

```bash
pnpm install
```

## Run (Electron Desktop)

```bash
pnpm dev
```

This starts Vite and launches the Electron desktop app.

## Run (Web Only)

```bash
pnpm dev:web
```

Open `http://localhost:1420/` in your browser.

## Build (Web)

```bash
pnpm build
```

## Build (Electron Desktop)

```bash
pnpm build:electron
```

## Controls

- `WASD` move
- `Mouse` look (after pointer lock)
- `Left Click` fire (hold for auto)
- `Shift` sprint
- `Space` jump
- `F` pickup gun (when near)
- `G` drop gun
- `R` reset targets
- `Esc` pause menu / show cursor
- `P` toggle perf HUD

## Assets

Current build ships with:

- A procedural `Range` practice map
- A code-built `School` blockout in the second practice-map slot
- Synthesized fallback audio unless sound files are added

Asset pipeline is ready for free assets:
- Practice maps: `/public/assets/map/*.glb` for future experiments
- Models: `/public/assets/models/*.glb`
- Audio: `/public/assets/audio/*`

If you add downloadable assets, document source/license in:
- `/public/assets/ATTRIBUTION.md`

## Notes / Trade-offs

- Collision is custom and lightweight (good for prototype speed, less robust than a real character controller/physics stack).
- The School map is authored as a movement-first blockout with multi-level floors and coarse blocker volumes: playable enough to iterate, still not a full physics-grade level.
- Audio defaults to synth placeholders if files are missing (great for iteration, less realistic than sampled assets).
