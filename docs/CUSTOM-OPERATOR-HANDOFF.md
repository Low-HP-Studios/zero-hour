# Custom Operator Handoff

Date: 2026-03-27

This document is the current working memory for the custom GLB character pipeline, the embedded animation integration work, and the asset-side blockers that still need to be resolved.

## Goal

Move the project from the old FBX-driven character/animation pipeline to a custom GLB-driven `custom-operator` flow while keeping the game playable during the transition.

Current target:

- Use `public/assets/models/player_with_animations.glb` as the custom operator source
- Use embedded `_IPC` animation clips as the runtime animation source for that character
- Keep gameplay movement controller-driven
- Keep the existing rifle gameplay logic underneath
- Avoid deleting the old FBX pipeline until the GLB path is actually stable

## Files Touched So Far

- `src/game/characters.ts`
- `src/game/PlayerController.ts`
- `src/game/scene/CharacterModel.ts`
- `src/game/scene/GameplayRuntime.tsx`
- `src/game/scene/scene-constants.ts`
- `src/screens/LobbyCharacter.tsx`
- `public/assets/models/player_with_animations.glb`

## Current Runtime Status

### Implemented

- Added a new `custom-operator` character entry backed by the GLB
- Added support for `assetType: "glb"` and `animationMode: "embedded-glb"`
- Added embedded clip aliasing for the custom operator
- Added runtime clip-name override support for embedded GLB clips
- Added `singleWeaponMode` support for the custom operator path
- Added jump animation states:
  - `rifleJumpStart`
  - `rifleJumpAir`
  - `rifleJumpLand`
- Added jump state handling in gameplay runtime using:
  - grounded transitions
  - vertical velocity
  - landing clip duration lookup
- Standing and crouch firing can now use explicit embedded fire clip overrides
- Lobby preview was switched to use `W2_Stand_Aim_Idle_v2_IPC`

### Important Constraint

The code is written to support the embedded GLB path, but the current exported `player_with_animations.glb` is not healthy enough to replace the old FBX pipeline yet.

## Current GLB Reality Check

The latest `public/assets/models/player_with_animations.glb` was inspected directly.

Current parse result:

- `34` animations
- `1` skin
- `74` nodes
- `0` meshes

That means the file currently contains animation and skeleton data, but no visible character mesh. This is why the character disappears in-game.

The latest runtime log also showed:

- `[Character] Embedded weapon setup failed M4 hand_r_wep`

This matches the asset inspection:

- the socket bone `hand_r_wep` exists
- there is no exported mesh named `M4`
- there are currently no mesh or skinned-mesh nodes at all

Conclusion:

- the current issue is asset-side, not just runtime-side
- do not remove the old FBX pipeline yet
- do not assume the current GLB is ready for production integration

## Current Embedded Animation Inventory

The current GLB exports these relevant clips:

- `W2_Stand_Relaxed_Idle_v2_IPC`
- `W2_Stand_Aim_Idle_v2_IPC`
- `W2_Crouch_Idle_v2_IPC`
- `W2_Crouch_Aim_Idle_v2_IPC`
- `W2_Walk_Aim_F_Loop_IPC`
- `W2_Jog_Aim_F_Loop_IPC`
- `W2_CrouchWalk_Aim_F_Loop_IPC`
- `W2_Stand_Fire_Single_IPC`
- `W2_Crouch_Fire_Single_IPC`
- `W2_Stand_Aim_Jump_Start_IPC`
- `W2_Stand_Aim_Jump_Air_IPC`
- `W2_Stand_Aim_Jump_End_IPC`
- `W2_Walk_Aim_F_Jump_RU_End_IPC`
- `W2_Jog_Aim_F_Jump_RU_End_IPC`
- `W2_Stand_Aim_Turn_In_Place_L_Loop_IPC`
- `W2_Stand_Aim_Turn_In_Place_R_Loop_IPC`
- `W2_Stand_Aim_Point_Center`
- `W2_Stand_Aim_Point_D90`
- `W2_Stand_Aim_Point_U90`
- `W2_Crouch_Aim_Point_Center`
- `W2_Crouch_Aim_Point_D90`
- `W2_Crouch_Aim_Point_U90`

Also present:

- root-motion versions of the locomotion clips
- `MotusManv55 T Pose`

Current integration intentionally uses `_IPC` clips only.

## Current State Mapping

The custom operator currently maps gameplay states to embedded clips roughly like this:

- `idle` -> `W2_Stand_Relaxed_Idle_v2_IPC`
- `rifleIdle`, `rifleAimHold` -> `W2_Stand_Aim_Idle_v2_IPC`
- `crouchIdle` -> `W2_Crouch_Idle_v2_IPC`
- `rifleCrouchIdle` -> `W2_Crouch_Aim_Idle_v2_IPC`
- rifle walk states -> `W2_Walk_Aim_F_Loop_IPC`
- rifle jog states -> `W2_Jog_Aim_F_Loop_IPC`
- rifle crouch locomotion -> `W2_CrouchWalk_Aim_F_Loop_IPC`
- standing fire -> `W2_Stand_Fire_Single_IPC`
- crouch fire -> `W2_Crouch_Fire_Single_IPC`
- jump start -> `W2_Stand_Aim_Jump_Start_IPC`
- jump air -> `W2_Stand_Aim_Jump_Air_IPC`
- jump land -> `W2_Stand_Aim_Jump_End_IPC`
- walk landing override -> `W2_Walk_Aim_F_Jump_RU_End_IPC`
- jog/run/sprint landing override -> `W2_Jog_Aim_F_Jump_RU_End_IPC`

Current intentional fallback:

- `rifleRun`, `rifleRunStart`, `rifleRunStop`, `sprint` visually fall back to jog
- `rifleReload` still falls back because no dedicated reload clip exists in the exported set

## Missing Or Still Needed For Full Visual Parity

These are still missing if the current game state machine should have dedicated clips instead of fallbacks:

- dedicated `rifleReload`
- dedicated `rifleRun`
- dedicated `rifleRunStart`
- dedicated `rifleRunStop`
- dedicated `sprint`
- `crouchEnter`
- `crouchExit`
- `rifleCrouchEnter`
- `rifleCrouchExit`
- real directional rifle strafes:
  - left
  - right
  - backward
  - diagonals
- real directional rifle jog strafes/backpedal
- unarmed locomotion set if non-rifle characters remain important

## Blender-Side Procedural Animation Plan

Not every missing clip needs hand-authoring immediately.

Good candidates for Blender script generation:

1. `rifle crouch enter`
2. `rifle crouch exit`
3. run/sprint fallback from jog
4. left/right strafe variants from forward locomotion
5. backward locomotion variants, with expected cleanup

Bad candidates for pure scripting unless quality expectations are low:

- reload
- equip / unequip
- hit reaction
- death
- anything with complex hand/weapon contact changes

### First Successful Script Experiment

A Blender script was prepared to generate:

- `W2_Crouch_Aim_Enter_IPC`

by blending:

- `W2_Stand_Aim_Idle_v2_IPC`
- into `W2_Crouch_Aim_Idle_v2_IPC`

That approach worked after switching from exact action-name matching to partial action-name matching.

Recommended next generated clip:

- `W2_Crouch_Aim_Exit_IPC`

## Parallel Work Candidates

These can be split across multiple agents or contributors safely.

### Track A: Asset Export Repair

Goal:

- restore visible character mesh export in `player_with_animations.glb`
- restore or confirm exported weapon mesh if the character should still include embedded weapon geometry

Checks:

- GLB must contain meshes or skinned meshes
- weapon mesh naming must match runtime expectations, or runtime expectations must be updated
- socket bone naming must stay stable

Definition of done:

- GLB parses with visible mesh data
- character appears in game
- embedded weapon lookup no longer fails

### Track B: Runtime Attachment Contract

Goal:

- reconcile runtime expectations with the latest export shape

Current problem:

- code expects `meshName: "M4"` plus `socketName: "hand_r_wep"`
- latest GLB export has no `M4` object and currently no meshes at all

Potential outcomes:

- keep embedded weapon attach, but rename/export objects correctly
- remove runtime weapon reattachment and trust exported hierarchy
- stop expecting embedded weapon geometry if the export should be character-only

### Track C: Blender Script Toolkit

Goal:

- create repeatable Blender scripts for missing transition/fallback clips

Priority order:

1. `W2_Crouch_Aim_Exit_IPC`
2. run/sprint fallback from jog
3. left/right strafe variants
4. backward locomotion variants

### Track D: Asset Cleanup

Goal:

- remove obviously unused assets without deleting still-active fallback systems

Safe cleanup candidates already identified:

- `public/assets/models/character/Allison`
- `public/assets/models/character/robot`
- `public/assets/models/character/skeleton`
- `public/assets/models/character/Skeleton Model.glb`
- `public/assets/models/preview`
- `.DS_Store` files under `public/assets`

Do not do yet:

- delete the FBX character roster
- delete the FBX animation pipeline

Reason:

- the current GLB is not yet sufficient to replace them

## Commands Used To Validate The Current GLB

These one-off checks were useful during investigation:

List scene hierarchy with `GLTFLoader`:

```sh
node --input-type=module -e "import fs from 'node:fs'; import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'; const loader = new GLTFLoader(); const buf = fs.readFileSync('public/assets/models/player_with_animations.glb'); loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', (gltf) => { const walk=(obj,depth=0)=>{ console.log(' '.repeat(depth*2)+obj.name+' ['+obj.type+']'); for (const child of obj.children) walk(child, depth+1); }; walk(gltf.scene); }, (err)=>{ console.error(err); process.exit(1); });"
```

Check raw GLB JSON counts:

```sh
node --input-type=module -e "import fs from 'node:fs'; const buf=fs.readFileSync('public/assets/models/player_with_animations.glb'); let offset=12; let json=null; while (offset<buf.length) { const len=buf.readUInt32LE(offset); const type=buf.toString('utf8', offset+4, offset+8); const data=buf.slice(offset+8, offset+8+len); if (type==='JSON') { json=JSON.parse(data.toString('utf8')); break; } offset += 8 + len; } console.log(JSON.stringify({nodes:json.nodes?.length||0, meshes:json.meshes?.length||0, skins:json.skins?.length||0, animations:json.animations?.length||0}, null, 2));"
```

## Recommended Next Step

Do this next, in order:

1. Fix the GLB export so the file actually contains the character mesh again
2. Re-verify whether the weapon should be exported inside the GLB
3. Once the asset is healthy, continue generating missing transition/fallback animations in Blender
4. Only after the GLB path is stable, consider removing old FBX assets

## Trade-off

The project now has a much better animation integration path than before, but the asset itself is temporarily the weakest link.

That is annoying, but it is still better than deleting the old fallback system and discovering too late that the new file exported a beautifully animated invisible person.
