# Movement Overhaul Plan

This document captures the full direction for improving character movement mechanics in Zero Hour. Each phase is independent and buildable in order. The goal is to go from "functional prototype" to "polished tactical shooter feel."

---

## Issues Identified

| # | Issue | Status | Target Phase |
|---|-------|--------|--------------|
| 1 | Movement feels too quick/snappy | TODO | Phase 1 |
| 2 | Animation transitions feel like teleporting | TODO | Phase 1 + 2 |
| 3 | Character faces crosshair unnaturally during movement | TODO | Phase 3 |
| 4 | Peek/lean moves arms and upper body | TODO | Phase 3 |
| 5 | Gun points at wrong angle vs bullet direction | TODO | Phase 4 |
| 6 | Crouch posture has bad back arc | TODO | Phase 3 |
| 7 | No stopping animation on sharp direction change | TODO | Phase 2 |

---

## Phase 1: Momentum & Inertia — TODO

**Goal**: Character velocity lags behind input. Movement has weight.

### What to change

- Lowered `GROUND_ACCEL_RATE` from 18 → 10 (walk/jog reaches 90% speed in ~230ms)
- Lowered `GROUND_DECEL_RATE` from 22 → 16 (stops in ~144ms)
- Lowered `DIRECTION_REVERSAL_DECEL_RATE` from 30 → 20 (visible slowdown on 180° reversal)
- Added `SPRINT_ACCEL_RATE = 7.5` (sprint ramp ~307ms — feels committed)
- Added `SPRINT_DECEL_RATE = 11` (sprint wind-down ~209ms — carries momentum)
- Added `VELOCITY_SNAP_THRESHOLD = 0.08` (prevents micro-velocity sliding)
- Sprint-aware dampRate selection with `isSprintMomentum` for sprint→jog carry-through
- Widened `RIFLE_LOCOMOTION_SCALE_MIN` from 0.9 → 0.55 (animations slow during accel ramp)
- Widened `RIFLE_LOCOMOTION_SCALE_MAX` from 1.2 → 1.25
- Lowered `LOCOMOTION_VISUAL_INPUT_DAMP` from 12 → 8 (direction blend matches momentum)

### Files to touch

- `src/game/PlayerController.ts` — constants + velocity update logic
- `src/game/scene/GameplayRuntime.tsx` — animation locomotion scale + visual input damp

---

## Phase 2: Animation State Machine — Direction Change Pause — TODO

**Goal**: Transitions between movement states feel natural. Sharp direction changes blend through neutral instead of instant flipping.

### What to change

- Added direction change detection in local input space using `computeInputAngleDelta()`
- When input direction changes >90°, a 180ms pause damps visual locomotion input toward zero
- During pause: animation resolves to forward jog at reduced locomotion scale (deceleration visible)
- After pause: visual input smoothly blends toward new direction (no snap)
- Added `skipSnapFromZero` to `updateVisualLocomotionInput` to prevent instant snap after pause ends
- Sprint stop → jog transition: 80ms recovery window prevents spurious pause triggering
- Direction tracking clears on ADS/crouch/weapon-unequip state transitions
- No new animation assets — works with existing directional clips + crossfading

### Constants to add

| Constant | Value | Purpose |
|----------|-------|---------|
| `DIRECTION_CHANGE_THRESHOLD_RAD` | π/2 (90°) | Angle delta that triggers pause |
| `DIRECTION_CHANGE_PAUSE_MS` | 180 | Pause duration |
| `DIRECTION_CHANGE_DAMP_RATE` | 18 | How fast visual input damps to zero |
| `DIRECTION_CHANGE_MIN_INPUT_LENGTH` | 0.3 | Min input magnitude to track |
| `SPRINT_STOP_RECOVERY_MS` | 80 | Grace window after sprint-stop |

### Scope

- Only rifle jog/walk when standing (not ADS, not crouched, not sprinting)
- ADS and crouch remain fully responsive

### Files to touch

- `src/game/scene/GameplayRuntime.tsx` — all changes in this single file

---

## Phase 3: Upper/Lower Body Split — TODO

**Goal**: Decouple upper and lower body for natural movement. Upper body handles aiming, lower body handles locomotion independently.

**Impact**: Fixes issues 3, 4, and 6.

### What to change

#### 3A: Body orientation — movement vs aim direction

- **Lower body faces movement direction**, not crosshair direction. If pressing forward-left, the legs and hips face that direction.
- **Upper body follows crosshair via IK**. The spine, arms, and head rotate toward the aim point independently.
- **Body only snaps to aim direction when firing**. This prevents the "teleporting toward crosshair" feel during movement.
- Increase `HEAD_TURN_DEAD_ZONE` from 45 to 60-70 degrees. Reduce `BODY_YAW_DAMP` from 14 to 6-8.

#### 3B: Crouch — lower body only

- Use the existing animation layering system more aggressively.
- **Lower body layer**: Play crouch locomotion animations (knees bend, hips drop).
- **Upper body layer**: Keep standing upper body animations (same spine posture, same arm position).
- The bone-split system already exists (finds `spine1` as split point). Apply it specifically for crouch states so only bones below the split change.
- Remove the back-arc from crouch by overriding upper body with standing posture.

#### 3C: Lean — lateral translate, not rotation

- Current: Spine Z-axis rotation tilts whole torso including arms.
- Target: **Translate hips laterally** (sideways shift) while keeping upper body upright.
- Arms and weapon stay in same relative position to camera.
- The camera offset (`LEAN_CAMERA_OFFSET_X = 0.54`) and tilt (`LEAN_CAMERA_TILT = 14.4 deg`) are fine — the issue is purely the character visual.
- Apply hip bone translation instead of spine rotation for the character model.

### Key constants to tune

| Constant | Current | Target Range | Notes |
|----------|---------|-------------|-------|
| `BODY_YAW_DAMP` | 14 | 6-8 | Slower body follow |
| `HEAD_TURN_DEAD_ZONE` | 45 deg | 60-70 deg | Wider free-look before body rotates |
| `UPPER_TORSO_LEAN_ANGLE` | current | 0 | Remove rotation, use translation |
| `LOWER_TORSO_LEAN_ANGLE` | current | 0 | Remove rotation, use translation |
| Lean hip translate (new) | N/A | 0.3-0.5 units | Lateral hip shift for lean |

### Files touched

- `src/game/GameplayRuntime.tsx` — body orientation logic, lean IK, crouch layering
- `src/game/PlayerController.ts` — body yaw calculation
- `src/game/CharacterModel.ts` — animation layer usage for crouch
- `src/game/scene-constants.ts` — constants

### Success criteria

- Moving diagonally: legs face movement direction, upper body independently aims at crosshair
- Crouching: upper body posture identical to standing, only legs fold
- Leaning: character shifts sideways, upper body stays upright, arms don't tilt

---

## Phase 4: Weapon Alignment & Feel — TODO

**Goal**: Gun visually points where bullets go. Weapon feels attached to the character naturally.

**Impact**: Fixes issue 5.

### What to change

- **Muzzle-to-ray alignment**: IK-align the weapon so the muzzle direction matches the camera-to-crosshair ray. Currently `DEFAULT_WEAPON_ALIGNMENT` rotation is a static offset that doesn't guarantee barrel alignment with the raycast.
- **Hand bone attachment**: Adjust the right hand attachment so the weapon grip naturally positions the barrel forward. May need per-weapon offsets.
- **ADS alignment**: When ADS is active, the sight reticle must sit exactly on the camera ray center. Current ADS position blending may drift slightly.
- **Procedural weapon sway** (optional, differentiator): Add subtle weapon bob responding to movement changes, landing impacts, and direction shifts. Adds perceived weight without new animations.

### Key constants to tune

| Constant | Current | Target Range | Notes |
|----------|---------|-------------|-------|
| `DEFAULT_WEAPON_ALIGNMENT` position | (0.15, 0.24, 0.04) | Per-weapon tuning | Barrel must point at camera ray |
| `DEFAULT_WEAPON_ALIGNMENT` rotation | (-2.96, 0.13, -1.23) | Per-weapon tuning | Muzzle direction = camera forward |
| Weapon sway amplitude (new) | N/A | 0.002-0.005 | Subtle positional bob |
| Weapon sway frequency (new) | N/A | Tied to footstep rate | Syncs with movement cadence |

### Files touched

- `src/game/Weapon.ts` — weapon positioning, ADS blend, sway
- `src/game/WeaponModels.tsx` — model offsets per weapon type
- `src/game/scene-constants.ts` — weapon constants

### Success criteria

- Hip-fire: barrel visually points at crosshair
- ADS: sight reticle is perfectly centered on screen
- Walking: subtle weapon bob that syncs with footsteps
- Direction changes: weapon slightly leads or lags the turn (adds weight feel)

---

## Differentiator Ideas (Post-Phase 4)

These are optional features that could make Zero Hour's movement feel unique rather than just "correct":

| Feature | Description | Complexity |
|---------|-------------|------------|
| **Weight-based movement** | Heavier loadout (sniper) = slower accel, wider turn radius. Rifle = snappier. | Medium |
| **Stance-based accuracy** | Standing still 0.5s tightens spread. Crouch tightens further. Rewards positioning. | Low |
| **Contextual lean** | Auto-lean when near cover edges. Detect wall proximity + aim direction (Rainbow Six Siege style). | High |
| **Momentum slide** | Sprint + crouch = slide with decaying velocity. Very popular in modern shooters. | Medium |
| **Procedural weapon sway** | Covered in Phase 4 as optional. Weapon responds to all movement dynamically. | Medium |
| **Landing impact** | Hard landings from jumps cause brief speed penalty + camera dip + weapon dip. | Low |

---

## Implementation Order

```
Phase 1 (Momentum)  -->  Phase 2 (Anim State Machine)  -->  Phase 3 (Body Split)  -->  Phase 4 (Weapon)
     TODO                    TODO                           TODO                      TODO
```

All phases are currently reset to TODO after the movement changes were reverted. Start from Phase 1 again, then continue in order. Phase 4 remains largely independent once Phase 1 is back in place.
