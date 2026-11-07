# P1.E10.T06 source/CPU review — REVISE

Verdict: **REVISE**. Two source defects block acceptance. The measured kit otherwise meets the geometry, LOD, material, door, collider, and Quavel support contracts checked here. This is not a visual grade, not a runtime-traversal pass, and not a merge.

Checkout `/Users/andreyyurlov/.t3/worktrees/space/t3-9050cf78`, branch `task/P1-E10-T06-ixari-quavel`.

| | |
|---|---|
| HEAD | `2d23ecb3cbf2b78a54b949a5e3bb9c70ebb4ff00` |
| tree | `30ac4e907dbaebb537b9b87fa83aa40424c370e8` |
| merge-base / baseHEAD | `0c4396a9194a5f7c99352f630ea7e66514b61115` |
| porcelain after the review | empty |
| blend/GLB mtimes | unchanged (`blender-r3-mtime-changed.json` is `[]`) |

No source, asset, doc, commit, push, PR, or merge. No `pnpm` / `npm` / `corepack`. Scratch tests used the pinned Vitest 5.0.5 file `node_modules/vitest/vitest.mjs` with `npm_config_verify_deps_before_run=false` and `cacheDir` under `/tmp`. Compared with `deps-before.json`, the review worktree's `.bin/vitest`, `vitest/package.json`, `vitest.mjs`, and the foreign `ktx` binary mtime/size are unchanged. No ignored dependency write was observed, and none was repaired.

## Findings

### 1. Exclusive glyph light is used on non-alphabet ribbons — REVISE (0.9.5)

`docs/art-bible.md:125-131` (section 3.4): glyphs on anchor stones are incised 2–4 cm with a V-section, stroke weight 8% of the sign diameter, and lit by `LIB_GlyphLight`. Glyph light is core `#D8F6FF` and halo `#7FD8FF`, and "nothing else may use it." The alphabet itself is the seven-node lattice in section 3.1–3.2. `docs/IMPLEMENTATION_PLAN.md:288` gives "glyph alphabet applied" to P1.E10.T08. T06's done line (`IMPLEMENTATION_PLAN.md:286`) is only "the crystal language kit," and that box is still `[ ]`.

Saved source, measured in Blender 5.2.3 on the evaluated meshes, contains box ribbons rather than those signs:

- `anchor_quavel`: vertex groups `GlyphStem*` 110 groups, 660 faces; `GlyphFork*` 75 groups, 450 faces. Every sampled face has UV tile key `2:1` (u in [0.5, 0.75), v in [0.5, 1.0)). That cell is palette index 6.
- `prop_ixari_terminal` and `prop_ixari_board`: `RecordedStroke*` 8 groups and 48 faces each, same tile. One group world size is about 0.09 × 0.025 × 0.315 m.
- LOD0 tile-6 triangle area is small faces only: anchor 3.564 m², each of those two props 0.194 m², large tile-6 area 0 on every asset. The exported anchor GLB still has 3.569 m² of small tile-6 area. Export node names `GlyphStem` / `GlyphFork` / `RecordedStroke` are 0 because the ribbons are vertex groups on the joined facet mesh, not separate glTF nodes.

`author.py:25` sets palette index 6 to `D8F6FF`. `author.py:71-72` emits that color on tiles 4 and 6. `author.py:282-288` `ribbon()` builds an 8-vertex box. Calls at `author.py:508` (`RecordedStroke`, tile 6), `author.py:544` (`GlyphStem`, tile 6), and `author.py:545` (`GlyphFork`, tile 6) paint these boxes with that cell. A transcoded tile-6 mean near `[157, 180, 186]` is the tone-modulated fill from `paint_atlas` (`author.py:33-82`), not evidence that the cell is unused. `nearD8F6FF` of 0 is expected for that darkened fill.

`build_report.py:149` logs "Library reuse → append existing … LIB_GlyphLight" and does not say these marks are not the alphabet, and does not defer them to T08. That is an unlogged spec interpretation. Crystal-facet style is not this finding.

### 2. `build_report.py` can leave a current PASS after a failed run — REVISE

`packages/tools/blender/cities/ixari/build_report.py:106` writes `manifest.json` with `qualification.*.PASS` before the final receipt asserts at `build_report.py:115`. `APPENDIX-C2.json` and `SHA256SUMS` are written only after those asserts (`build_report.py:162-165`).

Reproduced only under `/tmp` (real `manifest.json`, `APPENDIX-C2.json`, and `SHA256SUMS` mtimes unchanged):

- Early: one inventory `sourceSha256` set to 64 zeros. `python3` exit 1, `AssertionError` at line 44. A preseeded manifest containing `"source":"PASS"` and `"sentinel":"EARLY"` was byte-for-byte unchanged.
- Late: fixture `eslint-final/process.json` `exitCode` set to 1, every earlier input symlinked read-only to the real artifacts. Exit 1, `AssertionError` at line 115. The fixture manifest already contained `qualification.source/stockSourcesAndExports/compressedArtifactGeometry = PASS` and `actualCpuConsumers = "68 tests PASS"`. `APPENDIX-C2.json` was not written.

The committed tree does contain `APPENDIX-C2.json` and `SHA256SUMS`, so this review does not claim the current manifest was produced by a failed process. A later failed run of this script would still publish PASS. The current file is not a trustworthy gate until the write moves behind the asserts.

## Measured contracts that held

These are source and decoded-artifact checks. A BVH or ray hit is geometric support. It is not `resolveBoxes` traversal, and it does not qualify curved runtime walking.

- 33 assets, 8 blends, 8 GLBs. Decoder: 33 distinct shape keys, 0 collisions, 0 failures. Source and export LOD triangle counts match the inventory on all 66 variant sides (`visualMatchesDecoded` 66/66). Counts are strictly descending. LOD3/LOD0 is 0.02136 (`kit_ixari_spiral`) to 0.03307 (`prop_ixari_seat`), all under 0.05.
- Stock `validate_path` on the 16 real files, family `cities`, reports under `/tmp/p1-e10-t06-r1-2d23ecb3/stock-validate/`: 16 PASS, fail 0, warn 0. Blender 5.2.3 LTS.
- Required extensions on every GLB: `EXT_meshopt_compression`, `KHR_mesh_quantization`, `KHR_texture_basisu`. Position component type is SHORT only. One material per file: `IxariAtlas1024` (props), `IxariAtlas2048` (kit, low, mid, tall, civic), `IxariAtlas4096` (anchor, landmarks). Four KTX2 images each; occlusion shares the metallic-roughness image. Unique GPU sizes 5.33 / 21.33 / 85.33 MiB, under the prop 32 / kit-or-building 128 / hero 512 MiB class caps. ORM metallic max 0.008–0.02, no texel ≥ 0.5, min roughness about 0.13–0.14. No bronze.
- Missing marker names: none. Multiple `Interact_*` names are preserved, including `Interact_Ascent`, `Interact_Plaza`, and `Interact_Summit` on the summit. `wall_ixari_straight` and `wall_ixari_corner` have no interact marker.
- Doors, source BVH and collider BVH: residence/civic/spire openings declared 3.6 × 3.42 m measure about 3.85 m wide at 0.2–2.2 m and 3.42 m overhead; collider openings match within a few centimetres; `firstBlockedHeight` is null with a 0.38 m lateral offset. `gate_ixari` measures about 5.68–5.97 m wide and 4.52 m overhead. All clear 2.4 × 1.4 m and the 3.0 × 2.0 m service opening.
- Collider samples vs visual BVH: source max distance 0 on the sampled vertices (including 14,648 on the summit). Export max distance 0.0012–0.0059 m, none over 25 cm. Samples are strided, not every vertex. `COL_` meshes are siblings of `_LODn`, which is why the first GLB walk stored 0 collider triangles; the Blender pass measured those siblings.
- Quavel, source BVH, 40 m upward rays (the GLB walk capped overhead at 8 m and must not be read as a soffit distance):
  - Summit analytic 4-turn, 48 m, 769 samples: 0 support misses, support dz mean −0.005 m, both endpoints supported `(0, −15, 0.18)` and `(0, −15, 48.18)`. Soffit hits on 579 samples, 11.413–11.600 m, none under 3.2 m; 190 samples open at the top. Lateral clearance 1.908 m each side (about 3.82 m between rails). Outer rail 65/65 hits at 1.050 m. Inner rail 65/65 hits, mean 1.032 m, one sample at −0.122 m. That low sample matches the intentional opening of `SpiralRail0_254` and `SpiralRail0_255` in `refine_sources.py:104-109`, and the walk surface at the exit is still supported.
  - Summit exit `(0, −15, 48.18)` to `(0, −9, 48.18)`: 0 support misses, overhead open, lateral minimum 3.000 m, end support dz +0.005 m. The −0.122 m dip is the sloped landing, not a hole.
  - Kit spiral, 1 turn: 0 support misses, rails 65/65 at 1.050 m both sides, lateral 1.908 m, the only soffit hits are 5.77–5.82 m.
  - Bridge analytic arch: 0 support misses, deck within 0 on the arch samples, lateral minimum 2.12 m, rails at 1.050 m except one positive-side hit of 1.560 m and one miss at the y=12 endpoint on each side.
- `REF_Biped` Z extent is 1.85 m on every source file. `REF_Grid` bounds are 20 × 20 × 0 m and this pass found no triangle edges, so the 1 m cell pitch was not measured.
- Consumer tests: 68 passed, 0 failed, 0 pending (`vitest.json` `success: true`). Curved bridge/spiral cases warn and state that AABB `resolveBoxes` is not traversal qualification. Current client still emits variants `rng.int(0, 3)` (`packages/shared/src/world/cities.ts:204`) and indexes `b[6] % 3` (`packages/client/src/gameplay/Cities.js:409`). `Structures.js:138` still overwrites one `interact` per structure. The task text does not claim those paths already consume this kit. No T01/T02 file is in the diff.
- 19 protected hashes match `provenance-start.json` after the probe (0 mismatches), including `families.json` `2670f60f2323d303a79abc2dfada1a12c66ca0afcd476ddbea6f1cf875f9e28d`. Session-start diff was 306 ixari paths, 0 outside that tree (`static-more.json`). Final porcelain is empty, so that diff was not edited here.
- Local LFS receipt: 39 objects, 0 pointers, byte sizes matched at session start. Not re-fetched.
- 23 compact PNGs, 68,151,800 bytes, 0 `scratch.png`. Four sheets are inside the 48-file / 512 MiB cap but omitted from `SHA256SUMS`, because `build_report.py:71-82` checksums only the final source/material/export sheets: `anchor-shape-r2/sheet.png`, `landmarks-shape-r2/sheet.png`, `low-shape-r1/sheet.png`, `low-shape-r2/sheet.png`. Documentation gap, not a geometry failure.

## Runner controls

| Check | Result |
|---|---|
| Child ignores SIGINT and SIGTERM | Exit 124, signals `SIGINT`, `SIGTERM`, `SIGKILL`, `reaped` true, lock acquirable afterwards |
| Lock loser vs holder | Loser exit 124, `BlockingIOError`, loser `output.txt` absent, holder `output.txt` unchanged |
| Reused attempt name | Exit 1, `FileExistsError`, previous `process.json` unchanged |
| `resource_controls.py` copy with `parents[5]` = `/tmp/t06-adv-cpu` | Exit 0, printed `PASS: timeout, lane lock, scratch churn, exclusive receipt` |
| `setsid` grandchild | Advisory. Lane returned reaped while pid 49003 was still alive. This test killed it. A grandchild that leaves the group is not reaped by `run_cpu.py:36-53` |
| `ktx_cpu.py:12` `os.execv` on import | Advisory. Not imported by the Vitest run. Stock validate called `artlib/ktx.py` `binary()`, which reads the existing ktx cache |

`run_cpu.py` sets `KTX` to the wrapper path as a string (`run_cpu.py:62`). It does not import it.

## GPU inventory — not executed

From `assets/blend/cities/ixari/GPU_HANDOFF.json`: `plannedOnly: true`, `gpuExecutionAuthorized: false`, `noGPUClaim: true`, `expectedFiles: 399`, `expectedPngs: 366`, `expectedPerfJsons: 33`, `boundsRequiredFromParent.wallSeconds: 21720` (6 h 2 min), `retainedOutputCapBytes: 4294967296` (4 GiB), `temporaryAndLogCapBytes: 1073741824` (1 GiB). Per-job `status` is `NOT_EXECUTED`. The 399 paths were not created by this review. Blind grade, native performance, and merge stay pending.

## Commands

- Pin, start and end: `git -C …/t3-9050cf78 rev-parse HEAD`, `git rev-parse HEAD^{tree}`, `git status --porcelain`. Exit 0, porcelain empty, hashes above.
- GLB decode: `node /tmp/p1-e10-t06-r1-2d23ecb3/decode.mjs`. Exit 0. 33 assets, 0 shape collisions, 0 failures. Log `decode.log`.
- Digest: `python3 /tmp/p1-e10-t06-r1-2d23ecb3/digest.py`. Exit 0. 33 assets, 0 flagged LOD/marker/class rows, 18 openings.
- Vitest 5.0.5: `node …/t3-9050cf78/node_modules/vitest/vitest.mjs run --config /tmp/p1-e10-t06-r1-2d23ecb3/vitest.config.mjs --maxWorkers=1 --no-file-parallelism --reporter=json --outputFile=/tmp/p1-e10-t06-r1-2d23ecb3/vitest.json` with `npm_config_verify_deps_before_run=false`. Exit 0. 68/68.
- Adversarial: `python3 /tmp/p1-e10-t06-r1-2d23ecb3/adv.py`. Exit 0 as a harness. Inner exits are in the table above. Detail `adversarial.json`.
- Blender, successful pass: `/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 2 --python-exit-code 1 -P /tmp/p1-e10-t06-r1-2d23ecb3/probe.py`. Threads and `ART_KTX_JOBS=1`. User config and `TMPDIR` under `/tmp/p1-e10-t06-r1-2d23ecb3/`. Exit 0. `PROBE_DONE validations 16 failures 0 errors 0`. Log `blender-r3.log`. Two earlier launches exited 1 on reviewer-script faults (`Mesh.vertex_groups`, then `int64` JSON) before any save; blend mtimes stayed unchanged.

## Limits

- No GPU, browser, native capture, preview, bake, export regeneration, or LFS pull.
- Source/export ray support is not legacy AABB traversal and is not a T01 integration pass.
- `REF_Grid` cell pitch was not recovered.
- Collider distance is a stride sample.
- Group face area in the glyph tally counts one triangle of each quad; the tile-6 histogram is the full triangle area and matches about twice that tally.
- Dequantized GLB faces under 1e-8 m² are more numerous than source evaluated degenerates (anchor 5,346 vs 896). Stock validation did not warn. Not filed as a separate defect.
- Whole-task visual, performance, and merge acceptance remain pending.
