# Performance

## What We Measure (Current)

- FPS (sampled in runtime)
- Frame time (ms)
- Draw calls
- Triangles
- Geometry count
- Texture count

## Built-in Tools

- In-app `Perf HUD`
- Optional `r3f-perf` overlay
- Stress mode button (spawns 50/100/200 boxes)

## Test Procedure (Manual)

1. Start with stress mode `Off`
2. Capture baseline FPS / frame time
3. Toggle shadows on/off and compare
4. Test pixel ratio scales (`0.75`, `1`, `1.25`)
5. Increase stress mode to `50`, `100`, `200`
6. Move, sprint, jump, fire continuously to test combined load
7. Repeat in both:
   - web (`pnpm dev`)
   - tauri (`pnpm tauri dev`)

## Performance Log Template

Use this format for notes:

```md
## YYYY-MM-DD - Machine / OS
- Build: web|tauri
- Resolution / fullscreen:
- Shadows: on|off
- Pixel ratio:
- Stress mode:
- FPS range:
- Frame time range:
- Notes:
```

## Common Bottlenecks (Likely)

- Shadows (directional light + shadow map)
- High DPR / retina displays
- Overdraw from effects / transparent materials
- Too many unique meshes/materials (draw-call pressure)

## Trade-off Reminder

Prototype feel matters more than synthetic FPS bragging.
A perfectly optimized bad-feeling controller is still a bad prototype.
