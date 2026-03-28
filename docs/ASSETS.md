# Assets

## Current State

- **Character model**: Stylish Man FBX (`public/assets/models/character/Stylish Man/undercover cop.fbx`) with manual texture loading from `.fbm` folder
- **Animations**: Mixamo FBX files grouped by movement mode and rifle stance
- **Practice maps**: selectable procedural `Range` plus a code-built `School` blockout
- **School gameplay**: traversal-only blockout for now, with no targets, no loot spawns, and authored floor/blocker data for multi-level movement
- Placeholder geometry still used for weapon pickups and target dummies
- Audio uses WebAudio synth fallback unless files are added

## Asset Locations

- Practice maps: `public/assets/map/`
- Models: `public/assets/models/`
- Character textures: `public/assets/models/character/Stylish Man/undercover cop.fbm/`
- Animations: `public/assets/animations/` (`movement/standing`, `movement/crouch`, `rifle/aim`, `rifle/ready`)
- Audio: `public/assets/audio/`
- Attribution file: `public/assets/ATTRIBUTION.md`

## Rules

- Use only free assets with commercial-friendly licenses (`CC0`, `CC BY`, or similarly permissive)
- Record source + license in `public/assets/ATTRIBUTION.md`
- If the license requires attribution, ship the credit text with the build instead of pretending QA will remember it later
- Prefer keeping originals and documenting edits/conversions

## Import Pipeline

### Practice Maps

- `Range` remains procedural and keeps the existing stress-box test path
- `School` is authored directly in `src/game/scene/practice-maps.ts` and rendered procedurally in `src/game/scene/MapEnvironment.tsx`
- `School` uses authored walkable surfaces, ramps, and blocking volumes instead of imported GLB mesh probing
- Export an editable GLB for Blender with `pnpm export:school-map` (default output: `build/school-blockout/school-blockout-v1.glb`)
- Imported `.glb` practice maps are still pipeline-ready, but the current runtime does not depend on them
- Stress mode stays range-only for now, because one performance fire at a time is enough

### Character Model (FBX)

- Model: `undercover cop.fbx` loaded via `loadFbxAsset()` with `SkeletonUtils.clone()`
- Textures: mixed baseColor materials with selective normal maps, manually applied from the model's `.fbm` directory
- FBXLoader can't auto-apply textures (unsupported map channel type) — `applyCharacterTextures()` manually loads them via `TextureLoader` with `encodeURI()` for space-safe URLs
- Texture map fallback is defined in `src/game/scene/scene-constants.ts`

### Animations (FBX)

- Mixamo FBX files in `public/assets/animations/`, renamed to kebab-case and grouped by gameplay context
- Each FBX contains a full rig but only `fbx.animations[0]` is extracted
- Bone names normalized via `normalizeBoneName()` (strips `mixamorig:`, `characters3dcom___` prefixes)
- Tracks for bones absent from the model (finger detail) are filtered out before creating actions
- Current clips: movement locomotion, crouch, rifle aim, and rifle ready states
- Unused legacy FBX files were removed to keep the animation set leaner

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
- Gameplay bounds and collision authored if the asset is decorative scenery
- Fallback still works if file is missing

## Trade-off

Code-built blockouts are easier to make playable than arbitrary scene imports, but they are still blockouts.
That buys faster iteration on movement and layout, while the art pass gets to wait its turn like everyone else.
