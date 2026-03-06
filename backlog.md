# Backlog

Items are ordered by priority. Work top to bottom — each phase builds on the previous.

---

## Phase 1 — Foundation

- [ ] Fix the game architecture
  - Settings state is duplicated: `MainMenu.tsx` has its own localStorage settings, `GameRoot.tsx` has separate settings state — they don't share the same object. Lift to `App.tsx`.
  - `GameRoot.tsx` is ~1878 lines. Split into HUD, PauseMenu, and CanvasHost components.

- [ ] Find a way to run the game with uncapped FPS and without input lag
  - Electron has GPU flags but r3f Canvas uses default `frameloop` (capped to monitor refresh via rAF).
  - Try `frameloop="never"` with a manual render loop for true uncapped desktop FPS.
  - Confirm pointer lock mouse delta has no frame delay.

- [ ] Identify the memory leaks and fix them
  - `cloneWeaponModel()` in `Scene.tsx` — cloned Three.js geometries/materials never disposed on unmount.
  - `SkeletonUtils.clone()` in `Targets.tsx` — cloned skeleton not cleaned up.
  - `AudioContext.close()` in `Audio.ts` — called with `void`, should be awaited.
  - AnimationMixer actions not explicitly stopped before `uncacheRoot()` in `useCharacterModel`.

---

## Phase 2 — Core Gameplay Loop

- [ ] Redo the current movement mix of PUBG and APEX
  - Current movement is instant start/stop (no momentum). Add acceleration/deceleration curves.
  - Add slide on sprint+crouch (APEX feel).
  - Tune gravity curve for more weight (PUBG feel).

- [ ] Add/modify shooting
  - Recoil is hardcoded to `0` in `Weapon.ts` (lines 129-130) despite `addRecoil()` existing in `PlayerController`. Wire it up with a proper spray pattern.
  - Hitscan doesn't check world occlusion — targets can be hit through walls. Fix before the real map is built.

- [ ] Create HP for current character like PUBG/APEX
  - No player HP exists yet. Add: 100 HP base, armor/shield tier system, damage popups, death + respawn flow.

- [ ] Add/modify SFX for shooting and other actions
  - Tune after shooting and movement are finalized so audio matches the final feel.
  - The synth fallback system is in place — just need real asset files in `/public/assets/audio/`.

---

## Phase 3 — Content

- [ ] Create map for the game
  - Current map is flat 160x160 units with one building. Design with elevation, multiple buildings, and sightlines tuned to weapon ranges (rifle ~50u, sniper ~200u+).

- [ ] Add/modify animations for the character
  - Wait until movement is finalized (slides, crouches) so animation set matches the mechanic set.
  - Loading pipeline (`AssetLoader.ts`) already supports swapping FBX animation clips.

---

## Phase 4 — Polish

- [x] Re-design the current menu and settings
  - Do after all core mechanics are locked so the redesign doesn't need to change again (new HP display, new bindings, etc.).

- [ ] Add more characters to the game
  - Skeleton/texture loading pipeline already supports model swapping — just build a character selection flow.

---

## Phase 5 — Anytime

- [x] Change the name — from "0H" to something unique and short
  - Touches: `package.json`, `index.html`, `electron/main.js`, `README.md`. ~10-minute task. Not blocking anything.
