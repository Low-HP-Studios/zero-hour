# Greytrace (React + Three.js + Electron)

A minimal first-person prototype focused on movement feel and performance testing.

> ⚠️ This is not a full game.
> No backend, no progression, no networking — just pure mechanics and rendering experiments.

---

## Tech Stack

- React 19 + TypeScript + Vite
- Three.js via @react-three/fiber (v9)
- Electron (desktop packaging with bundled Chromium for uncapped FPS and stable pointer lock)
- pnpm for package management

---

## Features

### Core Gameplay
- First-person camera with pointer lock
- WASD movement with sprint and jump
- Hitscan shooting system
- Automatic fire with recoil (vertical climb + horizontal drift)
- Pickup (`F`) and drop (`G`) weapon system

### Maps
- Procedural **Range** (practice shooting)
- Traversal-focused **School** (movement testing)

### Targets & Effects
- 3 interactive targets with:
  - Hit flash feedback
  - Reset functionality (`R`)
- Muzzle flash and bullet tracers

### Audio
- WebAudio-based system:
  - Footsteps, gunshots, hit sounds
  - Audio pooling for rapid fire
  - Synth fallback if no assets are provided

### Performance & Settings
- Performance HUD (`P`)
- r3f-perf integration
- Adjustable settings:
  - Shadows
  - Pixel ratio
  - Audio volume
  - Stress mode (spawn 0 / 50 / 100 / 200 boxes)

### Physics / Collision
- Lightweight custom collision system (AABB / circle-based)
- No physics engine (intentional for performance testing)

---

## Prerequisites

- Node.js 20+
- pnpm 10+

---

## Setup

```bash
pnpm install
