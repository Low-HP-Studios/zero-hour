# Systems

## Player Controller

### Responsibilities

- Mouse look (yaw/pitch with damping)
- WASD movement + sprint
- Jump with asymmetric gravity (Valorant-style: snappy rise, floaty peak, fast fall)
- Collision resolution (XZ plane, circle vs AABB)
- TPS camera orbit (over-the-shoulder, PUBG-style)
- ADS zoom (right-click hold, smooth interpolation)
- Action keys (`F` pickup, `G` drop, `R` reset targets)
- Trigger state for firing (left-click)
- Pointer lock management (standard Chromium API)

### Inputs

- Keyboard events (WASD, Shift, Space, Escape, F, G, R)
- Mouse move/down/up (left-click fire, right-click ADS)
- Pointer lock change events

### Outputs

- `PlayerSnapshot` (position, speed, state flags)
- `PlayerControllerApi` (addRecoil, getPosition, getYaw, isADS, isSprinting, isMoving, isGrounded)
- Action/trigger/snapshot callbacks
- Camera transform updates each frame

### Camera details

- Arm length: 6 (normal) / 3 (ADS)
- Shoulder offset: 1.2 right (normal) / 0.5 right (ADS)
- LookAt point offset by shoulder so camera aims past the character
- Elevation from pitch, clamped between min/max angles

### Current limitations

- Flat-ground jump only
- No crouch, no slope handling, no step-up logic
- Electron pointer lock works natively via Chromium (no fallback needed)

## Character Model

### Responsibilities

- Load the default character FBX with `SkeletonUtils.clone()` for correct skinned mesh handling
- Manually apply textures (FBXLoader can't resolve the channel types in this FBX)
- Scale model to `CHARACTER_TARGET_HEIGHT` (1.65m) and ground it
- Drive `AnimationMixer` with the curated locomotion and rifle animation set
- Switch animation state based on player movement: idle / walk / sprint

### Animation pipeline

- FBX animations loaded via `loadFbxAnimation()` — extracts first clip from each FBX
- `remapAnimationClip()` normalizes bone names across different prefix conventions
- Unmatched tracks (finger bones) filtered before creating actions
- Crossfade transitions (0.25s) between animation states
- Sprint uses walk animation at 1.55x timeScale

### Current limitations

- No directional walk blending (walkLeft/walkRight/walkBack clips loaded but not used for directional blending)
- No rifle-specific animations during combat (rifleIdle/rifleWalk loaded but not triggered)
- The fallback texture map is tied to the default character model — changing that fallback requires updating `CHARACTER_TEXTURE_MAP`

## Weapon System

### Responsibilities

- Equip/drop world state with pickup/drop mechanics
- Auto-fire cadence (rifle: 78ms, sniper: 700ms)
- Muzzle flash timing (rifle: 45ms, sniper: 70ms)
- Tracer timing (70ms)
- Weapon switching (rifle/sniper, 180ms transition)
- Sniper rechamber (980ms)

### Pickup / Drop

- Player spawns empty-handed, weapon floats at a world position
- Press **F** to pick up within 2.5 unit range
- Press **G** to drop — weapon placed 1.8 units forward in look direction
- `canPickup()` drives interaction prompt in HUD

### Shot processing

- Shot origin and direction from camera (`getWorldPosition` + `getWorldDirection`)
- Raycasts against target hit spheres + world geometry
- Tracer visual originates from muzzle position toward hit/miss endpoint
- Damage zones: head (up to 125 rifle / 200 sniper), body (25 rifle / 90 sniper), leg (reduced)

### Current behavior

- Two weapons: rifle (auto) and sniper (semi-auto with rechamber)
- Switch with 1/2 keys
- No ammo/reload

### Future ideas

- Weapon presets (`smg`, `dmr`)
- Recoil pattern debug graph
- Spread bloom vs recoil split

## Targets

### Responsibilities

- Render destructible humanoid target dummies
- HP system (100 HP per target, 25 damage per shot = 4 shots to kill)
- Floating HP bars that billboard toward camera (green > yellow > red)
- Ray hit tests against target hit spheres (center at chest height)
- Hit flash (red body flash for 180ms)
- Destruction: disabled at 0 HP, respawn at full HP after 2 seconds
- Manual reset via `R` key (all targets back to full HP)

### Target layout

- 5 humanoid dummies spread across the map
- Each has head, torso, arms, legs geometry
- Hit sphere radius: 0.6, centered at body height

### Current limitations

- Direct target raycast (no wall occlusion checks yet)
- No score tracking / timer mode
- Static positions only (no moving targets)

## Audio

### Responsibilities

- Create/resume WebAudio context on user gesture
- Pooled gunshot playback for rapid fire
- Footstep cadence by movement/sprint state
- Hit confirmation sound
- File load fallback to synth sounds

### Current limitations

- Placeholder/synth fallback sounds by default
- No surface-dependent footsteps
- No spatial audio positioning

## Perf HUD / Stress Mode

### Responsibilities

- FPS + frame time display
- `gl.info` stats (draw calls, tris, memory)
- Spawn render stress boxes (50/100/200)

### Current limitations

- Stress mode is mostly render load, not true physics load
- No CSV/session export yet

## UI Overlay

### Layout

- 4 corner panels: info (top-left), perf HUD (top-right), controls (bottom-left), settings (bottom-right)
- Center: crosshair + hit marker (playing), pause info (paused)
- Toggleable HUD visibility from pause menu
- Pause menu is pointer-events transparent (clicks pass through to canvas)

### Controls displayed

- WASD move, Mouse look, Left Click fire, Right Click ADS, Shift sprint, Space jump
- F pickup, G drop, R reset targets, Esc pause, P toggle perf HUD
