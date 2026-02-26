# Roadmap

## Current Focus

Stabilize TPS feel, camera, and Tauri compatibility for the practice prototype.

## Completed

- FPS to TPS conversion with visible character model
- PUBG-style over-the-shoulder camera
- Right-click ADS with smooth zoom
- Valorant-style jump physics (asymmetric gravity)
- Destructible targets with HP, HP bars, 2s respawn
- Movement direction bug fix (sine/cosine correction)
- Audio synth fallback gain fix (gunshot sound was silent)
- HUD visibility toggle from pause menu
- Tauri pointer lock fallback (manual capture mode for WKWebView)
- Bullet trace direction fix (tracers go toward crosshair, not backward)

## Near-Term

- Add world occlusion checks for hitscan (no shooting through walls)
- Add score tracking + target timer drill mode
- Moving targets / varied HP targets
- Add proper web fullscreen button (user-gesture compliant)
- Improve Tauri cursor handling (investigate native cursor grab API)

## Mid-Term

- Swap placeholder audio with CC0 assets
- Swap placeholder character/gun/map with GLB models
- Add surface-based footsteps (concrete/grass)
- Add simple session metrics export
- Optional frame cap setting

## Long-Term (Only if prototype proves useful)

- Physics integration (`@react-three/rapier`) for richer interactions
- Modular weapon config system (rifle, smg, dmr presets)
- Replayable drills / presets

## Backlog Notes

Keep this practical. If a task doesn't improve feel, observability, or iteration speed, it probably belongs later.
