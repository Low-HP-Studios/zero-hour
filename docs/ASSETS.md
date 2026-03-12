# Assets

## Current State

- **Character model**: Trooper FBX (`public/assets/models/character/Trooper/tactical guy.fbx`) with manual texture loading from `.fbm` folder
- **Animations**: Mixamo FBX files grouped by movement mode and rifle stance
- Placeholder geometry still used for map, gun, and targets
- Audio uses WebAudio synth fallback unless files are added

## Asset Locations

- Models: `public/assets/models/`
- Character textures: `public/assets/models/character/Trooper/tactical guy.fbm/`
- Animations: `public/assets/animations/` (`movement/standing`, `movement/crouch`, `rifle/aim`, `rifle/ready`)
- Audio: `public/assets/audio/`
- Attribution file: `public/assets/ATTRIBUTION.md`

## Rules

- Use only free assets (CC0 or similarly permissive)
- Record source + license in `public/assets/ATTRIBUTION.md`
- Prefer keeping originals and documenting edits/conversions

## Import Pipeline

### Character Model (FBX)

- Model: `tactical guy.fbx` loaded via `loadFbxAsset()` with `SkeletonUtils.clone()`
- Textures: 7 materials (Body, Bottom, Glove, material/vest, Mask, Shoes, material_6) — each with baseColor + normal map
- FBXLoader can't auto-apply textures (unsupported map channel type) — `applyCharacterTextures()` manually loads them via `TextureLoader` with `encodeURI()` for space-safe URLs
- Texture map defined in `CHARACTER_TEXTURE_MAP` in `Scene.tsx`

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
- Fallback still works if file is missing

## Trade-off

Using placeholders keeps iteration speed high, but delays “real feel” evaluation for audio/visual feedback.
That is acceptable early, as long as the pipeline is ready (it is).
