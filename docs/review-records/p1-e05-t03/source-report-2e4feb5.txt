TASK: P1.E05.T03 (art) First-person arms and tools per people

STATUS: BLOCKED — CPU implementation candidate complete; parent-owned GPU review,
independent code review, blind visual grade and merged checks remain pending.

SUMMARY: Authored three editable per-people arm/tool sources and compressed exports.
Each is 48,000 triangles, one LOD, 35 weighted joints, and packed 2k material maps.
Anatomy and local skin maps derive from the verified accepted bodies. Distinct shell,
crystal and lattice tools have grip/muzzle markers and contact-aware materials.
The loader uses the selected-character people contract, disposes stale loads, preserves
material colour, and aligns the world beam with the view-pass muzzle across FOVs.
The retired demo model is deleted. Existing sharedRig.js passes all nine viewmodel
source/target pair tests; no shared gameplay state machine is introduced.

FILES CHANGED:

- `assets/blend/characters/viewmodels/fp_{thalune,ixari,ulgani}.blend`
- `packages/client/public/models/characters/viewmodels/fp_*.glb`
- `packages/client/src/entities/Multitool.js`
- `packages/client/src/entities/Multitool.viewmodels.test.js`
- `packages/tools/blender/characters/viewmodels/` — authoring history, saved-source
  exporter, validation, CPU runner/preview, common axes and documentation.
- `assets/renders/characters/viewmodels/` — six final CPU stills, nine validator
  reports, exact inventory and final command logs.
- Deleted `packages/client/public/models/multitool.glb`.

VERIFY:

- `pnpm install --offline --frozen-lockfile`: exit 0; dependencies reused locally,
  zero package downloads.
- Blender authoring/refinement/CPU preview commands documented in README.md: final
  invocations exit 0; at most two threads, one owned Blender process at a time.
- `KTX=/Users/andreyyurlov/Documents/dev/space/node_modules/.cache/ktx-software-4.4.2/bin/ktx ART_KTX_JOBS=1 python3 packages/tools/blender/characters/viewmodels/run_cpu.py .claude/pause/P1-E05-T03/export-final.log 600 /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 2 --python-exit-code 1 -P packages/tools/blender/characters/viewmodels/export.py`:
  exit 0; all three saved sources and exports PASS all five art gates, plus rig,
  weight, axes, packed-map and camera-clearance checks. No baking or geometry
  generation occurred in export. Full log: `validation/export-cpu.txt`.
- `pnpm exec vitest run packages/client/src/entities packages/client/src/exosuit.test.js packages/client/src/Game.test.js --maxWorkers=2 --no-file-parallelism`:
  exit 0, 7 files / 91 tests. Includes real GLTFLoader/Meshopt consumers, all wrist
  and digit articulation, shared adapter neutral/motion checks for all nine pairs,
  stale-load disposal, loader failures, actual demo retirement and FOV projection.
  Full log: `validation/consumer-units.txt`.
- `pnpm typecheck`: exit 0 for shared, tools, client and server.
  Full log: `validation/typecheck.txt`.
- `pnpm exec eslint packages/client/src/entities/Multitool.js packages/client/src/entities/Multitool.viewmodels.test.js`: exit 0.
- `pnpm exec prettier --ignore-path /dev/null --check packages/client/src/entities/Multitool.viewmodels.test.js packages/tools/blender/characters/viewmodels/README.md packages/tools/blender/characters/viewmodels/bind_axes.json`: exit 0.
  Existing Multitool.js layout remains under the repository's explicit demo-JS
  formatting exemption; `git diff --check` passes.
- `python3 -m compileall -q packages/tools/blender/characters/viewmodels`: exit 0.
- `python3 packages/tools/blender/characters/viewmodels/inventory.py`: exit 0;
  all six accepted T01 body hashes match base, accepted review packet diff empty;
  six final CPU PNGs total 3,148,150 bytes. Own `.blend1` development backups removed.
- Full smoke / GPU browser / GPU render / GPU bake / services / DB: NOT RUN, per
  the assigned CPU-only lane. Source correctness and CPU previews are not visual
  acceptance. No CI, push, PR, main edit or merge performed.

DECISIONS:

- Existing people API → `game.build.people` → no Game/HUD/shared state change needed.
- First-person skinning → dedicated matching 35-joint viewmodel profiles using
  `sharedRig.js` → species proportions survive, with no parallel adapter or state
  machine. Full-body profiles intentionally cannot be applied directly.
- New sources → derive accepted anatomy/maps in memory and save only new files →
  preserve all six accepted bodies and their review evidence byte-for-byte.
- One LOD → the art-bible viewmodel exception → do not claim a distinct LOD2.
- Error/loading state → no model until its real export loads → no generic fallback.
- Review staging → six bounded CPU stills → parent schedules the GPU inventory.

OUT OF SCOPE FOUND:

T04 owns full-body/viewmodel clip selection, playback and gameplay animation state.
Parent owns the review scene, GPU slot, blind grade, PROGRESS/DECISIONS/VISUAL-REVIEW,
T16 live eligibility, T10 persistence fixture, full smoke and merged verification.
No outside loader hook was required. The old demo authoring script remains under
E14.T07's explicit generator-retirement scope; the runtime model and load path are gone.

ARTIFACTS:

- `assets/renders/characters/viewmodels/inventory.json`: exact source/export SHA256,
  six accepted body SHA256 values and final CPU preview hashes.
- `assets/renders/characters/viewmodels/cpu/{thalune,ixari,ulgani}-{camera,detail}.png`.
- `assets/renders/characters/viewmodels/validation/characters__fp_*.{blend,glb}.json`
  and `{thalune,ixari,ulgani}-rig.json`.
- `assets/renders/characters/viewmodels/validation/shared-axes.txt`: axis alignment
  preserved neutral source vertices within 1.8e-7 m.
- README.md's next-review inventory names the three review resolver targets,
  lighting/overlay/wireframe/turntable/material/performance requirements and
  first-person 16:9/21:9 gameplay transitions. None has a GPU acceptance claim.

Base: `45c172a102f1944ff00be0b6e5006eef13fd793b`.
Branch: `task/P1-E05-T03`. Final commit and tree are provided in the worker handoff.

| Asset          | SHA256                                                             |    Bytes |
| -------------- | ------------------------------------------------------------------ | -------: |
| thalune source | `46d483c8cc0b10f555dc35f60008d64f7b883d392daa4bf4e87abb91da97b1db` | 24733334 |
| thalune export | `b4859735bd2f203bd30ca41705a156858cc362dd6de1000d308bd1e12b53e76f` |  3891516 |
| ixari source   | `44c408a64b59353810119640471b2faf9506da57250bdb47e7ce067445f2c4b5` | 18934076 |
| ixari export   | `78f90acfc0087b63e97c3ae50cb7c1f5e045e447e12975b6ec21a0dd5f038abc` |  3248228 |
| ulgani source  | `aabb32cb139c544d7a57f2fe22c34931fe720d2215e02936876f2dd02dd1aa3b` | 10586540 |
| ulgani export  | `8319097e97e3ccf2f9fdcbbe114742ea45f1f24eb8ba98420f12678d3511e954` |  1593132 |
