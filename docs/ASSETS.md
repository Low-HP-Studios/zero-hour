# Assets

## Current State

- Placeholder geometry is used for map, gun, and targets
- Audio uses WebAudio synth fallback unless files are added

## Asset Locations

- Models: `public/assets/models/`
- Audio: `public/assets/audio/`
- Attribution file: `public/assets/ATTRIBUTION.md`

## Rules

- Use only free assets (CC0 or similarly permissive)
- Record source + license in `public/assets/ATTRIBUTION.md`
- Prefer keeping originals and documenting edits/conversions

## Import Pipeline (Planned / Partial)

### Models (GLB)

- Drop `.glb` into `public/assets/models/`
- Load via `src/game/AssetLoader.ts`
- Fallback to placeholder mesh if load fails

### Audio

- Drop audio files into `public/assets/audio/`
- `AudioManager` attempts file load first
- Synth fallback runs if decode/load fails

## Asset Review Checklist

- License checked
- Attribution added
- File size reasonable
- Format works in web + desktop builds
- Fallback still works if file is missing

## Trade-off

Using placeholders keeps iteration speed high, but delays “real feel” evaluation for audio/visual feedback.
That is acceptable early, as long as the pipeline is ready (it is).
