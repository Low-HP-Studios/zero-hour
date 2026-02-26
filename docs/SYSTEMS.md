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
- Pointer lock management with Tauri fallback

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
- Tauri fallback mode: cursor can hit screen edges (acceptable in fullscreen)

## Weapon System

### Responsibilities

- Equip/drop world state
- Auto-fire cadence (78ms interval)
- Recoil + spray drift (progressive per shot)
- Muzzle flash timing (45ms)
- Tracer timing (55ms)

### Shot processing

- Shot origin and direction from camera (`getWorldPosition` + `getWorldDirection`)
- Raycasts against target hit spheres
- Tracer visual originates from character weapon position toward hit/miss endpoint

### Current behavior

- Hitscan rifle only
- No ammo/reload
- No multiple weapon slots

### Future ideas

- Weapon presets (`rifle`, `smg`, `dmr`)
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
- Pause menu is pointer-events transparent (clicks pass through to canvas for Tauri compatibility)

### Controls displayed

- WASD move, Mouse look, Left Click fire, Right Click ADS, Shift sprint, Space jump
- F pickup, G drop, R reset targets, Esc pause, P toggle perf HUD
