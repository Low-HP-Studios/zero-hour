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
- Small walkable map with cover and an enterable building (door opening)
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

Current build uses placeholder geometry and synthesized fallback audio by default.

Asset pipeline is ready for free assets:
- Models: `/public/assets/models/*.glb`
- Audio: `/public/assets/audio/*`

If you add downloadable assets, document source/license in:
- `/public/assets/ATTRIBUTION.md`

## Notes / Trade-offs

- Collision is custom and lightweight (good for prototype speed, less robust than a real character controller/physics stack).
- Hitscan currently ray-tests targets directly (cheap and stable, but not full world occlusion/penetration logic).
- Audio defaults to synth placeholders if files are missing (great for iteration, less realistic than sampled assets).
