# Shared motion authoring and CPU handoff

P1.E05.T02 has 42 saved actions in `assets/blend/characters/animations/shared_motion.blend`.
This directory is a CPU authoring/export/validation unit. Independent code review,
rendered motion review, the scheduled GPU capture unit and visual grading remain
required before the art task can be accepted.

The source contains a copied Thalune armature and a hidden `REF` collection with
the original 1 m grid and 1.85 m biped. It contains no replacement body geometry.
All six accepted T01 body source/export hashes remain frozen. Animation editing
must never save to any of those body paths or overwrite their review packets.

`author.py` is an authoring tool, separate from export. Its explicit pose boards
define anticipation, contact, hold and recovery events. Two-link limb solutions
are baked as ordinary 60 Hz Blender pose keys. Each action also retains its pose
board in `authored_pose_events` for editing. The initial authoring command refuses
to replace an existing source. `--refine-saved` edits from the boards already
saved inside the `.blend`; it detaches old curves before rekeying them.

`export_saved.py` never imports the authoring tool. It opens the saved `.blend`,
validates all named actions, source identity, supported channels, finite keys,
timings, reference objects and canonical bind axes, evaluates those saved curves
and writes the animation-only GLB and manifest. It has no render, mesh generation,
material bake or LOD generation stage. `--validate-only` validates the source;
`--selftest` adds reversible RAM-only negative controls without saving the source
or writing export artifacts.
Those controls call the actual export boundary with a private output directory
and require rejection before any file is written. They cover invalid component
indices, missing/duplicate location and quaternion components, object channels
and source identity. Blender clamps a negative FCurve index assignment to zero;
the receipt records that clamp and rejection of the resulting duplicate.
`component-validation.json` retains that export-boundary control receipt when a
later valid export refreshes `source-validation.json`.
The saved source format requires all 69 bones' complete location (0–2) and
quaternion (0–3) components. The shared clip contract still permits partial bone
or property animation, and exported clips omit unchanged tracks.
Use this animation-specific validator: the generic model validator requires
mesh/material/LOD collections that an animation-only asset intentionally lacks.

The GLB contains a complete neutral node hierarchy and bone-local animation
channels, without meshes, materials or skins. The frozen character GLBs supply
the bodies. `capture_bind.mjs` captures all 70 bones from the exact canonical
Thalune export through GLTFLoader before any mixer or pose exists. The authored
rig has 69 bones; the export-only `neutral_bone` helper remains neutral. Both each
manifest entry and each glTF animation's extras identify this source profile.
T04 should load the library and the versioned canonical source body, capture
fresh source/target profiles before posing, check the source against this saved
manifest and call the existing shared-rig adapter with that descriptor. The JSON
profile is an identity receipt, not an adapter-accepted live profile. No runtime
loader or animation state machine is implemented here.

The independent clip fixture lists exact names, durations and loop policy:

| Family | Saved clips |
| --- | --- |
| Idle (2) | breathe, alert |
| Locomotion (9) | walk forward/backward/left/right; run forward/backward; sprint forward; turn left/right |
| Jump (3) | takeoff, air, land |
| Jet (5) | ignite, hover, forward, brake, land |
| Swim (5) | idle, forward, fast, dive, surface |
| Mining (3) | start, loop, end |
| Cast (3) | bilateral gravitic lift, single-arm thermal lance, brow-to-radial resonance pulse |
| Hit (4) | front, back, left, right |
| Recall (2) | dissolve body pose, reform from kneeling |
| Emote (6) | wave, point, agree, disagree, celebrate, rest |

Turn clips rotate the root by 90 degrees without translating it. All locomotion is in place: T04 owns
world displacement, turn extraction and speed matching. Stance foot travel is
opposite the manifest's glTF-space virtual direction. The CPU proof checks source
stance height and records residual ground error after adaptation to every people;
the adapter preserves bind-relative motion, not species-specific foot IK.

Recall clips provide body poses only. Glyph ignition, dissolve/flash, visibility,
anchor placement and the server lifecycle remain E07.T14/E06.T03/T04. The three
casts are motion archetypes, rather than new ability or gameplay implementations.

Run from the task worktree root, with at most two Blender threads:

```sh
node packages/tools/blender/characters/animations/capture_bind.mjs
OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 /Applications/Blender.app/Contents/MacOS/Blender -b -t 2 --factory-startup --python-exit-code 1 -P packages/tools/blender/characters/animations/export_saved.py
OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 /Applications/Blender.app/Contents/MacOS/Blender -b -t 2 --factory-startup --python-exit-code 1 -P packages/tools/blender/characters/animations/export_saved.py -- --validate-only --selftest
ANIMATION_PROOF_PATH=packages/tools/blender/characters/animations/cpu-proof.json OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 pnpm exec vitest run packages/client/src/characters/animationLibrary.test.js packages/client/src/characters/sharedRig.test.js --maxWorkers=1 --no-file-parallelism
```

The CPU proof loads unchanged geometry/skin/morph/BIN inputs, omitting only texture
loading in RAM. Each body has 96 glTF mesh nodes across four LODs. GLTFLoader
expands material primitives into 216 Thalune, 216 Ixari and 176 Ulgani Three
SkinnedMesh objects. The proof retains both inventories, samples every primitive
and checks all 126 clip/people playback pairs. These measurements establish finite,
nonzero deformation and compatibility; they do not establish rendered quality,
material appearance, game integration or performance.

## Scheduled visual unit: capture plan only

No image, video, renderer, browser or game was launched in this CPU unit. Before
the visual unit, freeze the source/GLB/manifest hashes and rerun the CPU checks.
Keep all new evidence under a fresh `assets/renders/characters/animations/<freeze>/`
packet; retain accepted body packets unchanged.

1. Capture a labelled 60 fps motion reel of every clip on all three frozen bodies
   at LOD0 under noon lush lighting. Show full bodies with ground grid, contact
   markers and virtual travel direction; repeat loops three times and hold the
   first/final poses of one-shots. Include the exact clip ID, source profile and
   time in the evidence metadata. Keep silhouettes separated for comparison.
2. Capture every clip at LOD2 under noon lighting and a 100 m distance motion
   lineup. Include close views of foot plants, knees, shoulders, wrists/fingers,
   crest/frills and suit deformation for sprint, jump, swim, mining, all casts,
   hit and Recall. Inspect adaptation contact residuals on Ixari and Ulgani.
3. Capture idle, sprint, jump, jet hover/forward, swim fast, mining, the three
   casts, hit, both Recall clips and wave/celebrate under **all three** lighting
   cases (noon lush, night exotic, open space), at LOD0 and LOD2. Export contact
   sheets of anticipation/action/recovery and wireframes of the extreme poses.
4. Include an eight-angle posed turntable and material close-up sheet of each
   people using a temporary review scene, with the motion library applied through
   the existing adapter. Do not resave any accepted body `.blend` or `.glb`.
5. Collect paired scene/asset performance evidence with qualified frame timing in
   that GPU session. Check 60 fps playback, loop seams, contact and slide, clipping,
   hand/tool alignment, pose readability, joint pinching, crest/frill motion,
   kneeling/rising contact and compatibility of the three casts' silhouettes.
6. Give a fresh grader the task/spec/art bible, all motion reels and sheets,
   lighting/LOD/wireframe/distance evidence, validator/CPU proof and input hashes.
   Keep independent code review and visual PASS separate from this CPU handoff.
