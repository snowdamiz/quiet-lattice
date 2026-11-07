TASK: P1.E14.T04 (art) Flora rebuild: trees

STATUS: DONE — the assigned full CPU authorship/source/export unit. Overall T04 visual acceptance remains pending with the parent. Source/test PASS is not native visual PASS.

SUMMARY: Authored all 19 required tree/cactus variants in eight editable, packed Blender bundles, with 76 explicit LOD meshes. Inspected compact CPU sheets and revised crown density, conifer boughs, palm attachment scars, mushroom curvature, coral attachment points, and cactus grounding. The current eight compressed exports pass unchanged stock validation, use FLOAT positions/normals/UVs/RGBA masks, and match the source position/mask clouds through the actual client consumer. No runtime adoption was made.

Identity:
- Workspace: `/Users/andreyyurlov/.t3/worktrees/space/t3-9dcc2975`
- Branch: `task/P1-E14-T04-trees`
- Base: `55a8d58c27db35782b89142fc8a4f8d25f52f379`
- Reviewed shared pin: `515ba1f00810a50b499970b5468ef7bf0af84c32`
- Exact three-file cherry-pick: `60aa8bfb5a771e14944b6a130c96cd9a2cb83228`
- Payload HEAD: `c7af2f4a2feb220afbfa4ef0b87b46f46319e61e`
- Payload tree: `e60d9758f2c1fb16f32ced1e86c16fd76c98d320`
- The following report commit adds metadata only. Its delivery HEAD/tree are reported in the thread handoff; an embedded report cannot contain its own commit hash.

FILES CHANGED:

- Eight new `assets/blend/flora/tree_<kind>_t04.blend` bundles and eight corresponding `packages/client/public/models/flora/tree_<kind>_t04.glb` files. The exact pairs and SHA-256 values follow.
- `packages/tools/blender/flora_trees/`: `author.py`, `seal.py`, `export_saved.py`, `promote_masks.mjs`, `audit.py`, `preview.py`, `packet.py`, `manifest.py`, `run.py`, `ktx_one.py`, `test_codec.py`.
- `packages/client/src/gameplay/floraTreesT04.test.js`: focused tests against current bytes and production consumers.
- `assets/blend/flora/trees/`: candidate identity, current/historical preview selection, exact receipts, run ledger, paired historical bytes, and this report. `historical-bytes.json` explicitly excludes archived bytes from current identity.
- `assets/renders/flora/t04/`: 46 compact PNGs including revisions and the sibling overview, 54,805,448 bytes (52.27 MiB).
- Authorized shared exception only: the three unchanged files in reviewed commit 515ba1f (`artlib/checks.py`, `artlib/materials.py`, `material_mask_selftest.py`). No local validator override.

Current source/export pairs (SHA-256):

`round`
- Source: `assets/blend/flora/tree_round_t04.blend` — 3,082,848 bytes
  SHA-256: `0289add6071aac144763fd8a3c67efaa3cfe03192b4ba4f44405043129aeb087`
- Export: `packages/client/public/models/flora/tree_round_t04.glb` — 2,028,080 bytes
  SHA-256: `8257c5423566e6f9a62bc1cadf3ec1bd940ef20184a54d73f886afd903dabb45`

`conifer`
- Source: `assets/blend/flora/tree_conifer_t04.blend` — 3,371,313 bytes
  SHA-256: `6abb31b8763acc0a6bc44c7d1f63892b3929f9420f283058e409d4aee7ee5c82`
- Export: `packages/client/public/models/flora/tree_conifer_t04.glb` — 2,593,984 bytes
  SHA-256: `ea9c889438779fd3af192d2476967fd7fb67cd655d1111bb5901ec3fdd48fbd2`

`palm`
- Source: `assets/blend/flora/tree_palm_t04.blend` — 2,103,475 bytes
  SHA-256: `0de3633cd22ca4208d64eda410a8eb87a83ad44d3798aeebaa10b4473b68f898`
- Export: `packages/client/public/models/flora/tree_palm_t04.glb` — 1,347,020 bytes
  SHA-256: `b7fbcdc72b7f1581c0db7d1ae1d53632fb3e5992ff1b81c5542a2ce07d164b28`

`mushroom`
- Source: `assets/blend/flora/tree_mushroom_t04.blend` — 2,500,631 bytes
  SHA-256: `ae59e3ea97159464fabb08cf467ae1751f1767248c23e2290312ae1799e22f85`
- Export: `packages/client/public/models/flora/tree_mushroom_t04.glb` — 1,352,588 bytes
  SHA-256: `becd7124703a6ded9349635d2be8ada54f0ae937b3e996508d79081c5c84be21`

`spiral`
- Source: `assets/blend/flora/tree_spiral_t04.blend` — 1,840,309 bytes
  SHA-256: `79049b427c1166ff53aab3b7a7389cf730d0403f4c7785f833b1986c8b52a3b0`
- Export: `packages/client/public/models/flora/tree_spiral_t04.glb` — 938,100 bytes
  SHA-256: `24662149bd3330bd004145f8d86550c129c9841045d6145c191decf2a48796af`

`coral`
- Source: `assets/blend/flora/tree_coral_t04.blend` — 2,316,485 bytes
  SHA-256: `12ad278e604c6c17cad26b2f6b8f5f10c957847a9fa4e7c1db4d36425c885a8a`
- Export: `packages/client/public/models/flora/tree_coral_t04.glb` — 1,201,080 bytes
  SHA-256: `2a0b52856aa05e2e293ad452bb5ea50ed0ea7832cce80055ee8f77d04ec51c3b`

`blob`
- Source: `assets/blend/flora/tree_blob_t04.blend` — 1,634,261 bytes
  SHA-256: `2f7697de399e4ae1d1689d2be7e5817bc35fd985154682f2e2a85971a1e877b2`
- Export: `packages/client/public/models/flora/tree_blob_t04.glb` — 838,472 bytes
  SHA-256: `5c490c1931e440ac58d78420c95b7198babf650fe88f93f16bf017b935401b93`

`cactus`
- Source: `assets/blend/flora/tree_cactus_t04.blend` — 1,399,737 bytes
  SHA-256: `79a6283447a23c35062865a5779a8469665dbb15183cf1e2107c69c9e63aa062`
- Export: `packages/client/public/models/flora/tree_cactus_t04.glb` — 696,724 bytes
  SHA-256: `3b55320d464a6494efcfcd62966624a62b2e7aa66279acf2201edc35e01917f6`

Exact current 19 × 4 LOD inventory. LOD0 mesh uses the consumer name; LOD1–3 append lowercase `_lod1`, `_lod2`, `_lod3`. The structural nodes use uppercase `_LOD0`–`_LOD3` under the distinct internal `<prefix>_form_<index>` variant. This avoids a name collision with exporter-created empties while keeping the consumer lookup unchanged.

| Consumer | LOD0 | LOD1 | LOD2 | LOD3 | LOD3/0 |
|---|---:|---:|---:|---:|---:|
| tree_round_0 | 14000 | 6719 | 2379 | 326 | 2.33% |
| tree_round_1 | 12174 | 5842 | 2069 | 286 | 2.35% |
| tree_round_2 | 13999 | 6718 | 2378 | 356 | 2.54% |
| tree_conifer_0 | 14000 | 6720 | 2380 | 330 | 2.36% |
| tree_conifer_1 | 14000 | 6720 | 2380 | 252 | 1.80% |
| tree_conifer_2 | 13999 | 6719 | 2379 | 304 | 2.17% |
| tree_palm_0 | 14000 | 6719 | 2380 | 532 | 3.80% |
| tree_palm_1 | 10480 | 5030 | 1781 | 397 | 3.79% |
| tree_mushroom_0 | 7992 | 3836 | 1358 | 302 | 3.78% |
| tree_mushroom_1 | 7992 | 3835 | 1358 | 303 | 3.79% |
| tree_mushroom_2 | 14000 | 6719 | 2379 | 532 | 3.80% |
| tree_spiral_0 | 6888 | 3305 | 1170 | 261 | 3.79% |
| tree_spiral_1 | 10724 | 5147 | 1823 | 406 | 3.79% |
| tree_coral_0 | 13356 | 6410 | 2269 | 506 | 3.79% |
| tree_coral_1 | 13999 | 6719 | 2378 | 530 | 3.79% |
| tree_blob_0 | 5252 | 2520 | 891 | 198 | 3.77% |
| tree_blob_1 | 8772 | 4210 | 1490 | 333 | 3.80% |
| cactus_0 | 5599 | 2686 | 951 | 211 | 3.77% |
| cactus_1 | 3004 | 1441 | 510 | 114 | 3.79% |

All `tree_*` variants retain stock `flora_tree` classification (3,000–15,000 triangles, 1K maps, 1–60 m); `cactus_*` retains stock `flora` classification (150–6,000 triangles, 1K maps, 0.05–15 m). No class alias or threshold changes. The lowest/current tree LOD0 is 5,252 triangles; cactus LOD0s are 5,599 and 3,004. Sources use metres, +Z up, applied geometry, and ground origins; glTF uses +Y up. Buttresses enter the soil as authored. The source/export AABBs and exact float data are in each audit.

Authored distinctions:

- round: 0: Tidal oak / low buttressed crown; 1: Forked upland alder / upright twin crown; 2: Storm oak / swept crown and broken leader.
- conifer: 0: Spire fir / descending feather boughs; 1: Coastal cedar / open umbrella whorls; 2: Weeping spruce / asymmetric hanging skirts.
- palm: 0: Tidal feather palm / leaning scarred stem; 1: Bottle fan palm / radial pleated fans.
- mushroom: 0: Moor parasol / rolled lip and radial gills; 1: Bellcap / tall folded bell and collar; 2: Shelf crown / three attached offset caps.
- spiral: 0: Ascending crozier / open helical stem with pinnae; 1: Twin fiddlehead / bifurcating unfurling crowns.
- coral: 0: Antler coral / broad planar branching fan; 1: Cup coral / ascending hollow growth mouths.
- blob: 0: Bladder grove / fused lobed fluted column; 1: Lantern bole / forked hanging seed chambers.
- cactus: 0: Ribbed candelabrum / unequal elbow branches; 1: Paddle cactus / jointed flattened pads and fruit.

VERIFY:

`run-ledger.tsv` contains every retained receipt with the exact shell-escaped Blender command, exit, source-before/source-after SHA-256, export SHA-256, and remaining owned children. Each receipt records absolute cwd, resource snapshot, thread environment, finite deadline, RSS/log limits, and (for later jobs) tool hashes. Logs and reports are exclusive per attempt; earlier PASS records are historical and are never used as current identity. `candidate.json` binds the selected eight current pairs to matching export/audit/canonical-validation receipts.

- `pnpm install --offline --frozen-lockfile --ignore-scripts` — exit 0, 239 cached packages, zero downloads. No LFS fetch/hydration or mass install.
- `python3 packages/tools/blender/flora_trees/run.py author <kind> --deadline 300` (initial whole inventory), followed by recorded revisions — all completed author receipts exit 0. Sources are written only by explicit authorship/sealing commands.
- `python3 packages/tools/blender/flora_trees/run.py seal <kind> --deadline 600` — eight final source cleanup/carrier saves, all exit 0. Removes face-unreferenced decimation remnants and preserves exact per-vertex masks in custom FLOAT carriers.
- `python3 packages/tools/blender/flora_trees/run.py export <kind> --deadline 600` — eight final exports, all exit 0. `export_saved.py` calls unchanged stock `artlib.export.main("flora", ["--only", source.stem, "--report-dir", fresh_reports])`, then promotes exact float carriers and reruns unchanged stock validation on final bytes before publication. It never imports or invokes the author. All eight source hashes stayed unchanged.
- `python3 packages/tools/blender/flora_trees/run.py audit <kind> --deadline 300` — eight final audits, all exit 0. Reads actual source meshes, actual Meshopt accessors, actual KTX2 headers/full mips, and 28 actual decoded maps (8 normal UASTC maps, 20 ETC1S base/ORM/emissive maps). No PNG fallbacks, no KHR_mesh_quantization, no helper mask carriers remain in final GLBs. Packed-map pixels, decoded-pixel hashes/ranges/std, names, counts, bounds, full unique position/mask-cloud hashes and source identity are recorded.
- `python3 packages/tools/blender/flora_trees/run.py validate <kind> --deadline 300` — eight final canonical-path runs, all exit 0, 16/16 actual source/export files PASS. Each invokes `/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 2 --python-exit-code 1 --python packages/tools/blender/validate.py -- --family flora --report-dir <fresh>/reports <absolute-source> <absolute-canonical-glb>`; exact absolute argument vectors are in the ledger. Naming, triangle budget, LODs, materials/compression and scale all pass.
- `python3 packages/tools/blender/flora_trees/run.py preview <kind> --deadline 600` — final selected CPU sheets; all selected attempts exit 0. Cycles CPU, 12 samples, 320 px cells, 960×640 sheets; four LOD0 directions, one LOD2 comparison, one detail view. No raw frames remain.
- `python3 packages/tools/blender/flora_trees/run.py packet round --deadline 300` — exit 0. Binds selection, proves six pre-cleanup preview sources have identical rendered polygon topology/winding/coordinates/UVs/masks/smooth flags and packed image pixels, and emits one 1600×1280 sibling overview. The two final revised bundles have exact preview/source byte matches.
- `pnpm exec vitest run packages/client/src/gameplay/floraTreesT04.test.js packages/client/src/gameplay/modelLibrary.test.js --maxWorkers=1` — exit 0, 2 files / 29 tests passed; final logged run `evidence/tests_20261107T014339/`.
- `pnpm -r --workspace-concurrency=1 typecheck` — exit 0, all four workspace packages.
- `pnpm exec eslint packages/client/src/gameplay/floraTreesT04.test.js packages/tools/blender/flora_trees/promote_masks.mjs` — exit 0.
- Python `compile()` over task-local `.py` sources — exit 0.
- `git diff --cached --check` — exit 0. Captured stdout keeps terminal blank lines via a task-local `.gitattributes` whitespace rule; code whitespace rules are unchanged.
- `git diff 515ba1f00810a50b499970b5468ef7bf0af84c32 -- packages/tools/blender/artlib/checks.py packages/tools/blender/artlib/materials.py packages/tools/blender/material_mask_selftest.py` — exit 0, empty diff.

- `python3 packages/tools/blender/flora_trees/test_codec.py` — exit0: actual exec arguments changed from99 to1 threads, and two concurrent callers executed serially through the inherited process lock. Receipt: `evidence/codec-test_20261107T014507/receipt.json`.

Failure history retained:

1. The initial round export passed the stock validator but payload inspection found normalized ushort COLOR_0. It was rejected as a task candidate, its superseded unpaired bytes were removed, and its hash/status are retained in `evidence/initial-round-export-disposition.json`. No old stock PASS is claimed as full task PASS. Blender 5.2 explicitly selects BYTE_COLOR for four-component export in `primitive_extract.py`; source FLOAT_COLOR alone does not prevent this.
2. The first CPU preview launcher was interrupted by the user turn. Its three sheets are historical, its receipt is incomplete, and `interrupted-recovery.json` explicitly claims no PASS. Recovery observed no owned runner/Blender process.
3. First consumer test command (exit 1): 17/23 passed, 6 failed. Four source point clouds included unused vertices left by decimation; a cactus audit was still pending; and the test incorrectly applied giant-only scatter scale to cactus. Exact notes/tail are in `evidence/first-consumer-test-failure.txt`.
4. Second combined consumer command (exit 1): 28/29 passed. A new test assumed all roots stopped at −0.2 m; the authored storm-oak LOD retained soil anchoring at −0.225526 m. The test now checks the actual saved-source Y-up extent exactly, and the real scatter scale by kind. No stock validation threshold or art was changed to hide this mismatch.

First consumer failure (retained tail):
```text
    120|         expect(result.geo.boundingBox.min.y).toBeGreaterThan(-1);
       |                                              ^
    121|         result.geo.dispose();
    122|       }

 Test Files  1 failed (1)
      Tests  6 failed | 17 passed (23)
   Start at  01:28:20
   Duration  860ms (tests 45%, transform 43%, import 12%, worker 1%)

Other failure identities:
tree_round_0_lod2 unique position/mask rows: source3066 vs exported2911
tree_conifer_0_lod1: source7702 vs exported7688
tree_palm_0_lod1: source5732 vs exported5731
tree_mushroom_0_lod2: source891 vs exported890
cactus audit undefined while its sequential audit job was still pending.

An optional local Pillow availability probe before this command exited1 with
ModuleNotFoundError: No module named 'PIL'. No package was installed; Blender's
image API remains the CPU preview path.
```

Second consumer failure (retained tail):
```text
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |@astra/client| src/gameplay/floraTreesT04.test.js > T04 current compressed tree inventory > round: exact names, 4 LODs, source positions and FLOAT mask bits survive compression
AssertionError: expected -0.22552642226219177 to be greater than -0.2
 ❯ src/gameplay/floraTreesT04.test.js:97:41
     95|           const geo = recolor(mesh, palette);
     96|           expect(geo.boundingBox.max.y).toBeGreaterThan(1);
     97|           expect(geo.boundingBox.min.y).toBeGreaterThan(-.2);
       |                                         ^
     98|           geo.dispose();
     99|         }

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 28 passed (29)
   Start at  01:32:37
   Duration  653ms (tests 70%, import 19%, transform 10%, worker 1%)

```

5. Final resource audit found stock `ktx.py` uses host CPU count for an encoder when ART_KTX_JOBS=1 and always starts at least two decoder workers. Historical runs therefore did not satisfy the intended codec thread/process cap. An owned executable boundary now forces `ktx create --threads 1` and holds a file lock across exec to serialize actual codec processes. Re-encoded all eight current GLBs at one thread, reran all audits and canonical source/export validation with decoder serialization, and reran 29 consumer tests. Earlier bytes/receipts remain historical with exact paired sources; none is selected as current validation. No shared codec code or validation thresholds changed.

An optional Pillow import probe exited 1 (`ModuleNotFoundError: No module named PIL`). Nothing was installed; the compositor uses Blender image pixels.

DECISIONS:

- How to preserve consumer names with stock hierarchy? → Keep exact mesh names, give structural variants `<prefix>_form_<index>` names → stock reserved-name checks and real mesh lookup both pass. Cactus remains `cactus`/`cactus_form_*` inside the tree-owned filename.
- How to preserve FLOAT RGBA masks with Blender’s ushort RGBA path? → Save `_T04_MASK_RGB` FLOAT_VECTOR and `_T04_MASK_AO` FLOAT carriers, export them through the stock exporter, promote their exact values to FLOAT COLOR_0 using glTF-Transform, remove carriers, Meshopt-compress without quantization, then validate final bytes with stock code → exact source position/mask clouds survive the actual loader. This is an export representation step, not a validator override or reconstruction from quantized colors.
- How to use the reviewed correction? → Cherry-pick exactly the supplied three-file commit; compare its files byte-for-byte → no local widening, outer non-white baseColorFactor graphs remain unsupported. Authored material baseColor factors are 1.
- Material authorship → Append/derive `LIB_ShellRib`, `LIB_Chitin` and `LIB_CapFlesh`; keep packed 1K organ trim maps with bark growth/scars, veins and margins, gill ridges, roughness/occlusion separation, normal relief and warranted low spore emission → neutral botanical palette documented in source; actual planetary colors remain R/G/B masks. Repeated organ trims intentionally share UV regions; no geometry AO bake depends on overlapping UV islands. Geometry-specific soil occlusion is authored in mask alpha.
- Source editability → Saved mesh control topology, named organ vertex groups, explicit four LOD collections, editable image maps and shared REF grid/biped are the deliverable → author scripts are not imported by export.
- Preserve demo mixed library? → Yes, per explicit T07 ownership → this task adds CPU candidates, not live adoption.
- Resource admission → Deferred Blender while observed load was ~34, then used a fresh resource read for every job. One owned Blender process, two math/render threads, codec concurrency1 with one encoder thread and a process lock serializing stock decoder calls, 300–600s final-job deadlines, 6GiB sampled group RSS ceiling and 32MiB log ceiling. Every completed Blender receipt has zero remaining owned child processes. CPU jobs use no Metal/CUDA render device.

OUT OF SCOPE FOUND:

- `packages/client/src/gameplay/modelLibrary.js` recolors and transforms geometry but replaces UVs with zeros; `floraModels.js` scales to procedural reference height and chooses `_lod1` for its far mesh. Authored PBR maps and LOD2/3 are present in the new exports but are not thereby adopted in the current runtime. T07/runtime owner decides that integration. No `Flora`, `Engine`, `Review`, capture or model-library code was edited.
- Crystal growths belong to T05 and were not authored or copied. No non-tree assets/tooling, shared library/family rules, generator or orchestration docs were edited.
- Native GPU capture, standard turntables/material sheets, blind grading and independent review of this candidate are parent-owned gates. No browser/native capture grant, services/DB, native smoke, push, PR or merge was requested or performed.

ARTIFACTS:

- `candidate.json`: authoritative eight source/export pairs, all hashes, 19×4 mesh inventory/bounds, exact selected validation/audit receipts, and 19 native capture command vectors.
- `run-ledger.tsv`: exact command/exit/hash ledger; `evidence/`: immutable per-job receipts, resource observations and stock reports.
- `historical-bytes.json`: archived source/export byte identities explicitly excluded from current candidate.
- `assets/blend/flora/trees/evidence/20261107T013236_packet_round_787bc5a6/preview-manifest.json`: 19 selected vs26 historical sheet paths/hashes; six exact rendered-surface equivalence proofs; exact-source matches for the latest cactus/coral previews.
- `assets/renders/flora/t04/siblings_20261107T013236_packet_round_787bc5a6.png`: one compact overview, read left-to-right/top-to-bottom in the exact inventory order above. Inspected for kind readability, all19 forms, anchoring and major attachment defects. No independent grade is claimed.

Parent’s remaining native inventory and cost envelope (not run, not authorized by this report):

- Each of 19 variants: `noon-lush_lod0.png`, `noon-lush_lod2.png`, `night-exotic_lod0.png`, `night-exotic_lod2.png`, `open-space_lod0.png`, `open-space_lod2.png`, `wireframe_lod0.png`, `wireframe_lod2.png`, `overlay.png`, `far_lod2.png` (100m), native `sheet.png`, and `perf.json`. Exact asset/internal-variant selectors are in `candidate.json`.
- Standard command shape: `pnpm capture -- --review flora/tree_round_t04 --asset tree_round --variant tree_round_form_0`. Repeat only the 19 explicit selector records; the parent must choose its authorized native lane.
- Totals: 190 native raw stills +19 contact sheets =209 native PNGs and19 perf JSONs. 3 lights×120 paired perf samples×19 variants =6,840 pairs / at least13,680 shown/hidden measurement frames, plus settle/capture overhead. These are inventory counts, not measured runtime or GPU performance.
- Standard art sheets still required: 19 eight-angle turntable sheets +19 material close-up sheets +8 bundle sibling sheets =46 additional PNGs. Combined new parent gate inventory:255 PNGs; material region text/manifests accompany them. Standard `turntable.py` forces Metal here and was deliberately not run.
- Suggested parent limits: one GPU lane, one selected variant at a time, native1920×1080, turntable800×600 cells/material480×360 cells (stock sizes, no4096 frames), finite300s per variant initially, stop on timeout/failure and clean all owned children before reuse; at least12GiB free disk and a fresh1GiB parent packet ceiling. Keep no videos or raw-frame directories. These proposed ceilings require parent admission and are separate from this task’s already-used46/48 compact CPU image allowance.
- Standard native capture, blind independent visual grading, independent code/source review and live/runtime integration remain unpassed.
