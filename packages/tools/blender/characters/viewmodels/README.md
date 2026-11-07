# P1.E05.T03 first-person viewmodels

CPU candidate only. Independent code review, GPU captures, blind visual grading,
and merged checks remain the parent's gates. These assets are not visually accepted.

The editable sources are `assets/blend/characters/viewmodels/fp_{thalune,ixari,ulgani}.blend`.
Their compressed exports are `packages/client/public/models/characters/viewmodels/fp_*.glb`.
Each contains two skinned arms, a fitted tool, 35 deform joints, one LOD, packed 2k
PBR maps, and `Muzzle`, `Grip_R`, and `Grip_L` markers. The six accepted T01 body
files and their review packets remain unchanged.

Thalune retains the accepted webbed, colour-cell anatomy with a lapped nacre shell,
sea-green inlays and rounded return. Ixari retains long digits and living forearm
crystals with a stepped, socket-grown prism tool. Ulgani retains porous pale skin
with an open chitin cage, membrane sails, breathing gills and spore points.
Skin and biological maps derive from the verified local accepted sources. The tool
atlases contain part-local growth, fracture or vein relief, contact polish and joint
occlusion. No HDR or other external material download is needed.

## Runtime and animation contract

`Multitool.js` reads the existing `game.build.people`; its undefined offline default
is Thalune. It clears the previous people immediately, discards obsolete asynchronous
loads, reports load errors, and disposes owned geometry, materials, maps and skeletons.
There is no demo fallback. The old `multitool.glb` is deleted. Heat and mining authority
are unchanged. The beam and its light follow the actual `Muzzle` node after view sway.
The world beam also compensates for the view pass's different field of view, keeping
the projected muzzle aligned at both 16:9 and 21:9.
Authored material maps and each people's emissive colour remain intact.
Before attachment, every required Skin/Bio/tool material must have its complete
2k PBR maps and twelve decoded mip levels. A GLTFLoader success callback with a
failed individual texture is rejected through the existing error/toast path;
its geometry, maps, materials and skeletons are disposed. The engine-owned KTX2
loader remains available to other loads. Obsolete completions are retired before
validation and cannot change the active model's error state.

The source is in metres, camera at the origin, Blender +Y forward (+Y up and -Z
forward after glTF conversion). The view group has no scale or initial offset.
The authoring camera matches the engine's 66-degree vertical field of view.

The viewmodel skeleton is a separate 35-joint `vm_` hierarchy. Joint origins preserve
each people's anatomy; joint axes match `bind_axes.json`. Bone tails are editing
handles; child origins are the articulation pivots. The existing `sharedRig.js`
implements the bind-relative TRS contract for these profiles too. The CPU tests
load the real compressed files and exercise all nine source/target pairs. They
preserve neutral sampled skin vertices and apply the intended wrist translation.
Individual wrist and digit channels also deform actual exported vertices.

No animation clips or gameplay state machine are added here. T04 owns playback.
Capture the profile immediately after loading `tool.viewModel`, before posing it,
with an ID that includes the export SHA from the evidence inventory. Author clips
against that full viewmodel profile, and pass them through `adaptSharedRigClip`.
The body and viewmodel hierarchies are different; the adapter correctly refuses to
apply a full-body clip directly to a viewmodel. T04 must select the matching clip
profile, rather than copying body-local translations or bypassing the adapter.

## CPU validation and export

`export.py` opens the saved source, checks the arm/hand/digit hierarchy, weights,
common axes, scale, camera clearance, packed maps and budget, then uses the unchanged
`artlib.export.export_one` pipeline. It runs the same five checks as `validate.py`
on source and compressed export. It rejects all bake and LOD-generation attempts.
It never imports authoring scripts, saves a source, or rebuilds geometry. Nested
sources are passed explicitly so the three accepted body exports are not touched.

Use an existing local KTX 4.4.2 binary. One Blender process at a time; two threads,
one codec job, a finite deadline and process-group cleanup are enforced by the runner:

```sh
KTX=/absolute/path/to/ktx ART_KTX_JOBS=1 python3 packages/tools/blender/characters/viewmodels/run_cpu.py \
  .claude/pause/P1-E05-T03/export.log 600 \
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 2 --python-exit-code 1 \
  -P packages/tools/blender/characters/viewmodels/export.py
```

An optional `-- thalune` (or other people) exports only that source. Missing sources,
invalid assets, or missing local codecs fail; no fetch or placeholder is performed.
The `characters__fp_*.blend.json`, `characters__fp_*.glb.json`, and `*-rig.json`
reports live in `assets/renders/characters/viewmodels/validation/`.

Use `-- --validate-only` to validate the exact existing source/export pairs without
regenerating exports. Successful validation writes a `*-receipt.json` binding
both file SHA256 values, lengths and paths to the hashes of all three reports.
`inventory.py` requires that receipt and rejects changed source/export bytes,
changed reports or a missing/failed receipt. It does not infer validation from an
old PASS plus a newly computed export hash.

Every attempt retires prior reports, receipts and inventory into a unique
`validation/history/` directory and writes a RUNNING receipt. An export attempt
also preserves the previous export there. After a successfully opened source
fails validation or export, only that people's exact destination is removed;
the failure receipt records why and where history lives. A different destination
produced during the failed attempt is archived separately as `failed-fp_*.glb`.
If the source could not be opened, its prior export stays on disk but has no current
PASS receipt or inventory. Other peoples' files and accepted bodies are untouched.

The runner keeps its lock through SIGINT, SIGTERM, deadline and natural-exit
cleanup, including remaining descendants. TERM and KILL each have a two-second
grace; the direct child is reaped before success. The child inherits the lock too.
If cleanup cannot be confirmed, `blender.unclean` prevents another invocation.
Inspect that marker and the recorded owned group before removing it manually;
the next runner never kills a PID from an old marker.

```sh
pnpm exec vitest run packages/client/src/entities packages/client/src/exosuit.test.js packages/client/src/Game.test.js --maxWorkers=2 --no-file-parallelism
pnpm typecheck
pnpm exec eslint packages/client/src/entities/Multitool.js packages/client/src/entities/Multitool.viewmodels.test.js packages/client/src/entities/Multitool.materials.test.js packages/client/test/characters/viewmodelConsumer.mjs
pnpm exec prettier --ignore-path /dev/null --check packages/client/src/entities/Multitool.viewmodels.test.js packages/client/src/entities/Multitool.materials.test.js packages/client/test/characters/viewmodelConsumer.mjs packages/tools/blender/characters/viewmodels/README.md
python3 packages/tools/blender/characters/viewmodels/test_pipeline.py
python3 packages/tools/blender/characters/viewmodels/test_inventory.py
python3 -m compileall -q packages/tools/blender/characters/viewmodels
```

`loadActualRig` decodes the actual GLBs through Three's GLTFLoader and MeshoptDecoder.
Only material/texture loading is omitted in RAM, with geometry, skins, nodes,
compression metadata and binary bytes asserted unchanged. Separate checks inspect
KTX2 and material metadata. `viewmodelConsumer.mjs` additionally uses the production
Engine loader, actual Meshopt geometry and shipped Basis JS/WASM in one CPU Worker.
It covers individual texture failures, Basis HTTP 503, positive decoding of all
three assets, stale loads and resource ownership. Geometry-only stripped fixtures
cannot pass the production material boundary. These are CPU consumer checks, not
GPU rendering proof.

`test_pipeline.py` uses harmless process stand-ins and isolated file fixtures.
`test_inventory.py` runs the actual inventory entry point over read-only real
inputs and scratch substitutions. For a real saved-source/codec failure check,
run `test_saved_failures.py` through `run_cpu.py` with the usual Blender flags and
`-- /absolute/new/scratch-directory` outside the repository. It saves a changed
source only in that scratch directory, never over a production source. The
revision's commands, failure tails and evidence archives are in `REVISION-R1.md`.

## Authoring history and inspection

The `.blend` files are the source of truth for further art edits. `author.py` records
the initial derivation from SHA-pinned body sources and refuses to overwrite an
existing viewmodel. The authoring passes were `refine.py` (support grip and shell
return), `finish.py` (budget, weights, camera clearance), `paint.py` (localized tool
relief), `calibrate.py` (palette and emitter), `grip.py` (contact/pivots), and
`align_axes.py` (common axes with unchanged neutral geometry). These are authoring
operations, never export dependencies. `bind_axes.json` records the final axes.

`preview.py` explicitly uses Cycles CPU, two threads, 24 samples and one still per
invocation. It only writes PNGs into the fresh `assets/renders/characters/viewmodels/cpu/`
directory and caps retained images/bytes. Run it through `run_cpu.py` with a 180-second
deadline, a source `.blend`, and `-- <output.png> camera` or `detail`. The retained
six images are camera and side-detail views for each people; older development
images were overwritten. No per-frame sequence, GPU render/bake, browser, Vite,
service or database was launched in this lane.

## Next review inventory

The existing review URL resolver accepts `characters/viewmodels/fp_thalune`,
`characters/viewmodels/fp_ixari`, and `characters/viewmodels/fp_ulgani`.
After the parent allocates the GPU slot, capture each exported asset under noon-lush,
night-exotic and open-space lighting, with wireframe and rig/marker overlays. These
viewmodels have one LOD by the art-bible budget; label any requested LOD2 comparison
as the same LOD0, rather than claiming an extra LOD exists.

The grader still needs eight-angle turntable/material sheets, first-person 16:9 and
21:9 captures, neutral and extreme sway/raise/fire/overheat/underwater transitions,
all three people switches including delayed loads, grip articulation close-ups, and
paired shown/hidden performance measurements. Review the actual view pass as well
as the generic asset scene. T04's body/animation state machine and T01 body polish
remain outside this task. No review-scene or gameplay integration hook outside
`Multitool.js` was changed.
