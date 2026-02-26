# Decisions Log

Record notable technical or product decisions here.
Short entries are fine.

---

## 2026-02-26 - Use custom collisions instead of Rapier (for now)

### Decision

Use lightweight custom player collision (circle vs AABB) and simple jump/gravity logic.

### Why

- Faster to implement for a prototype
- Easier to tune movement feel immediately
- Lower integration complexity while validating controls/perf loop

### Trade-off

- Less robust than a physics-based controller
- Harder to extend to dynamic collisions / advanced movement

### Revisit when

- We need rigid bodies, slopes, moving objects, or proper world occlusion logic

---

## 2026-02-26 - Keep audio synth fallbacks enabled by default

### Decision

Allow prototype to function without bundled audio files.

### Why

- Keeps repo runnable immediately
- Avoids blocking on asset sourcing

### Trade-off

- Audio feel is less realistic until proper files are added

---

## 2026-02-26 - Desktop app starts fullscreen by default (Tauri)

### Decision

Launch Tauri window in fullscreen for better prototype feel.

### Why

- Windowed mode looked poor and reduced usability for first-person testing

### Trade-off

- Slightly less convenient for debugging side-by-side with devtools/logs

---

## 2026-02-26 - Convert from FPS to TPS (third-person shooter)

### Decision

Switch from first-person to third-person perspective with visible character model.

### Why

- Player wanted to see their own character
- TPS provides better spatial awareness for testing movement feel
- More aligned with games like PUBG for the target experience

### What changed

- Added visible box-based humanoid character model
- Moved weapon rendering from camera-attached to character-attached
- Camera changed from first-person to orbit behind player
- Player ground position changed from eye-height to ground level (Y=0)

---

## 2026-02-26 - PUBG-style over-the-shoulder camera with ADS

### Decision

Camera offset to the right (shoulder offset) instead of centered behind character. Right-click ADS zooms closer with tighter offset.

### Why

- Centered camera has crosshair pointing at the character's back
- Shoulder offset lets camera look PAST the character so crosshair represents actual aim direction
- ADS provides precision aiming without switching to first-person

### Technical detail

- LookAt point offset by the same shoulder amount as camera
- This eliminates angular error between crosshair and bullet direction
- Without this fix, bullets were angled ~11° left at distance

---

## 2026-02-26 - Asymmetric gravity for Valorant-style jumping

### Decision

Replace single gravity constant with three-phase gravity: lighter rise, floaty peak, faster fall.

### Why

- Single gravity felt flat and unrealistic
- Valorant-style jump has snappy upward, hang-time at peak, fast landing
- Feels more responsive and gamey

### Constants

- Rise: -22, Peak (|vy| < 2.0): -10, Fall: -38
- Jump speed: 11.5

---

## 2026-02-26 - Tauri WKWebView pointer lock fallback

### Decision

Bypass the Pointer Lock API entirely in Tauri and use a manual capture mode.

### Why

- WKWebView on macOS rejects `requestPointerLock()` with `WrongDocumentError` even when `document.hasFocus()` is `true`
- Multiple approaches tried: setTimeout delay, focus event retry, synchronous focus -- all fail
- This is a WKWebView/Tauri limitation, not a fixable JS timing issue

### How it works

- Detect Tauri via `__TAURI_INTERNALS__` global
- When `requestPointerLock()` fails in Tauri, activate fallback: set locked state manually
- CSS `cursor: none` hides cursor (already done by `.playing` class)
- `mousemove` events provide `movementX/movementY` without pointer lock
- Escape key exits fallback mode (pause)
- Browser environments still use real Pointer Lock API

### Trade-off

- Cursor can hit screen edges during fast mouse movement in Tauri
- Acceptable in fullscreen mode where the window spans the entire screen

---

## 2026-02-26 - HP-based destructible targets

### Decision

Replace instant-disable targets with HP system. Targets have 100 HP, take 25 damage per shot, and respawn 2 seconds after destruction.

### Why

- Gives more gameplay feedback (HP bars, progressive damage)
- Tests ADS precision at range
- More engaging than one-shot disable

### Target design

- Humanoid dummy shape (head, torso, arms, legs)
- Billboard HP bar (green > yellow > red)
- Hit flash (red body) on damage
- Auto-respawn at full HP after 2 seconds
