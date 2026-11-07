# P1.E10.T08 source-author preparedness report

Parent: `/Users/andreyyurlov/.t3/worktrees/space/t3-909360ab` at `c3c82e0fdf6ec342645c9c30f0800bc5104ffcb9`. Inspection date: 2026-11-07. Prepared read-only for the parent; no author or capture admission.

## Conclusion

The full done-line is **six asset identities: three capital anchors plus three site monolith variants**. It does not require six newly sculpted landmarks. The three city branches already supply the landmark geometry, four LODs and markers. Reuse them as exact inputs; their recorded SOURCE PASS is not a native/visual grade or a completed T08.

Sarelun already applies canonical `sarelun` glyph strokes and has cut-face/core geometry in its retained export. Quavel intentionally has no canonical inscription following its correction. Belost has an authored 48 m basalt blade in its root-island assembly, with decorative incisions and T08 semantics deferred. **Recommend serialized saved-source glyph edits in Quavel and Belost, preservation of Sarelun unless a future actual conformance audit finds a specific issue, and three new monolith sources.** Do not recreate the anchors or ship a second 24-sign alphabet.

The attached C.1 brief is concrete but **not dispatch authorization**. Before its complete source unit can be assigned, the parent must release the exact Quavel/Belost source/export pairs from the existing city owners/reviews and admit author capacity. The ownership conflict is real; missing gameplay loaders are not a blocker. The three new monolith pairs are disjoint from props and dens, but authoring only those would be a partial T08 deliverable and must not be presented as the complete task.

## Authority and prior continuation

- `docs/IMPLEMENTATION_PLAN.md:310`: verbatim T08 done-line; only formal dependency is E14.T02, `[x]` at line 345. Section 0.1 makes eligible art its own track. Sections 0.3, 0.4, 0.10 and Appendix C define source/verification/visual gates.
- `docs/DESIGN.md:91,107,117-123`: each capital grew around an anchor; Sarelun shoals, Quavel summit, Belost root island. Section 19.3 (`:799,801`) separately lists three city anchor landmarks and three site monoliths.
- `docs/art-bible.md:37-41,102-131,201-214,220-226,260-305`: sizes, axes, canonical alphabet, incisions, palettes/library, density, class/LOD/map contracts.
- `docs/DECISIONS.md:1379-1382` explicitly rejects the earlier props audit's premise that no gameplay consumer prevents source art. Review already consumes exported art; E14.T07 owns later adoption/removal. This same source-art reasoning applies to T08. `/private/tmp/space-nextbatch-t08-audit.md` is a historical audit about **E14.T08 Props**, not this E10 task; its no-gameplay-loader premise was superseded.
- `docs/DECISIONS.md:1390-1394` expressly reserves canonical glyph application on anchors/monoliths for E10.T08 and requires Ixari substitute ribbons to be removed. This is not permission to rewrite already reviewed city sources concurrently.
- `docs/IMPLEMENTATION_PLAN.md:300-302` leaves renderer/traversal/streaming to E10.T01 and capital services/Recall/safe-zone routing to T02. `:354` leaves demo generator/fallback removal to E14.T07, after Phase 1 art. No runtime integration is invented in this brief.

## Existing anchor evidence

All three pinned worktrees still had the requested heads. The parent has only `.gitkeep` under `assets/blend/cities/` and `assets/blend/sites/`, and neither corresponding exported family is present there. No matching E10.T08 branch was found, and no history exists for the four examined `sites/monolith*.blend` candidate paths. This is a bounded search, not an exhaustive assertion about every arbitrary historical filename.

| Anchor | Current source/export stem | Actual GLB root and sole variant | Current GLB LOD0/1/2/3 index triangle counts | Metric extent / context |
|---|---|---|---|---|
| Sarelun | cities/thalune_anchor | anchor_sarelun | 79,587 / 23,875 / 7,957 / 2,784 | 49 m anchor; shoal ground origin, approach by wading; no bridge |
| Quavel | cities/ixari_anchor | anchor_quavel | 76,876 / 23,062 / 7,617 / 2,576 | 52 m anchor; independent summit/plaza placement |
| Belost | cities/ulgani_anchor | ulgani_root_island_landmark | 108,800 / 32,640 / 10,880 / 3,808 | blade 48 m (z 0.18 to 48.18); whole island extends below ground and about 156 m across |

These counts were independently summed from existing GLB JSON index accessors under the LOD nodes without decoding geometry. All three roots have `asset_class: hero`. This verifies declared hierarchy/counts, not topology, cut depths, density, collision fit or appearance.

### Sarelun

Owner `83eec91beca01e454794017ce95a0e744eb395ab`, tree `38da70cc3e65d0025485b79e1b50773185395a67`, worktree `../t3-07044f6e`. Current `assets/blend/cities/thalune/manifest.json` binds the exact source/export. `authoring/author_kit.py:419-465` reads the shared glyph table, spells `sarelun`, constructs Boolean V-channel cuts, light cores and an orientation notch. Existing GLB JSON contains `IncisedGlyphCore` meshes and `LIB_GlyphLight_Sarelun`. This is evidence of pre-existing canonical work, not a fresh measurement of saved channel depth/weight/LOD fidelity. Retain byte-for-byte by default.

Recorded independent result: `docs/review-records/p1-e10-t05/advisory-review-02-83eec91.txt`, source/CPU PASS only. It reports preserved geometry/materials and `engineCapturesRun=0`. Neither that result nor this research relabels the asset.

### Quavel

Owner `ec2857d0cf112d77c54b2b10ad871248b4c38340`, tree `b7401a8afbff113bd27daf1e11090e1bd3f9c199`, worktree `../t3-9050cf78`. **Use `assets/blend/cities/ixari/reports/revision-r1-publication-01/manifest.json`**, not the deliberately historical root manifest. Its anchor source/export hashes equal the committed pointers below. Current marker light is lilac `#B9A6FF`, not glyph white-cyan. `packages/tools/blender/cities/ixari/revise_surfaces.py:107-173` and the independent R2 report explain removal of the reserved ribbons/cells and replacement with actual crystal growth. The old `author.py` is sculpt history and must not regenerate these surfaces.

Recorded independent result: `docs/review-records/p1-e10-t06/source-review-02-ec2857d.txt`, SOURCE PASS. No canonical glyph meshes/material remain in the corrected anchor export. T08 must actually cut/apply canonical glyphs in this saved source (or a final serialized equivalent), preserving crystal growth, collision and placement.

### Belost

Owner `7d738a0f6eb1b71275bed05da3bb31a2bbc52b0a`, worktree `../t3-6f0e842d`. **Use `assets/blend/cities/ulgani/density-revision/delivery-manifest-d01.json` and `density-revision/WORKER_REPORT.md`**, not root README/WORKER_REPORT/delivery-manifest historical density failure and obsolete hashes. Current GLB material set is the corrected `UlganiMetric_4096_*` set, including Basalt and Spore. The retained author source `packages/tools/blender/cities/ulgani/author.py:1316-1407` creates two split basalt blades, decorative `Incision*` tubes, an interaction point and root-island approach, and expressly leaves glyph semantics to T08. No canonical table consumer exists in that anchor authoring function.

Recorded result: `docs/review-records/p1-e10-t07/density-review-01-7d738a0.txt`, SOURCE PASS within its read-only evidence boundary. It does not freshly recompute density or grade topology. Preserve the disclosed quantization-degenerate counts and visual questions; they are neither regraded nor excused here. Current whole-island root/variant stays `ulgani_root_island_landmark`; do not rename it to a speculative `anchor_belost`.

## Exact minimal restoration pointers (future only)

No restoration was performed. Parent already contains the needed shared pipeline/alphabet. It needs only the six existing anchor source/export payloads as read-only or serialized inputs, plus the selected manifests/reports for provenance. Do not cherry-pick whole city branches or copy their captures, infrastructure or unrelated kits merely to obtain an anchor.

| Path | Commit | Git pointer-blob SHA-1 | LFS content SHA-256 | Bytes |
|---|---|---|---|---|
| `assets/blend/cities/thalune_anchor.blend` | `83eec91beca01e454794017ce95a0e744eb395ab` | `3c415eb9c650e629a251980469de206945b10fb0` | `7739c6429bcc93d7b9f8738002a3e6cd6431d65c9d19d32dd99e24f3fda5198a` | 6248687 |
| `packages/client/public/models/cities/thalune_anchor.glb` | `83eec91beca01e454794017ce95a0e744eb395ab` | `616d7035bb1e09247d4273facff867bbb2eabe15` | `71ad323fde521208e0cb9096b49a275e2c2d2f30f8ad572a8f72f5c557a3b7c3` | 1187080 |
| `assets/blend/cities/ixari_anchor.blend` | `ec2857d0cf112d77c54b2b10ad871248b4c38340` | `88989561af8e55907517a1c204ab5c3cc1ed888d` | `d72c741e6cce0ac4591c561889e07b4a060a6a952b19dded0f512357ac5bc77a` | 7675535 |
| `packages/client/public/models/cities/ixari_anchor.glb` | `ec2857d0cf112d77c54b2b10ad871248b4c38340` | `657f3ff71b4727f8444bbd0ee295b4203e5da7a8` | `5df8fb4a90efbb68b476ce481bfd569e74d0b61eb1706d05fc5dde3b8c2db35b` | 3323312 |
| `assets/blend/cities/ulgani_anchor.blend` | `7d738a0f6eb1b71275bed05da3bb31a2bbc52b0a` | `f1424b3d6988ff7f3b7168c28df02b93cfb0cbb8` | `f2248ffc0e2c562cc7a9b5ae41778954e53a5f885c75817f0bd3e381e0edce37` | 31161651 |
| `packages/client/public/models/cities/ulgani_anchor.glb` | `7d738a0f6eb1b71275bed05da3bb31a2bbc52b0a` | `5fa49f6faa7cb5c04a9ee3cd7e95876a8108cb8a` | `7cdf23f63429e7c2545d082665f747cc50d3fd3c329fe344a98d6787b93ad5d8` | 12220848 |

Each payload is currently present in its named owner worktree, with matching pointer-declared file size. Each corresponding local LFS object also exists with that size under `/Users/andreyyurlov/Documents/dev/space/.git/lfs/objects/<oid[0:2]>/<oid[2:4]>/<oid>`. This pass read pointer blobs, GLB JSON and file metadata; it did not freshly hash entire binary payloads. At future admission, verify full SHA-256 before copying the selected local payloads into the new isolated author checkout. No network/LFS fetch is needed if those objects remain intact. Keep owner worktrees unchanged. If a local payload is missing or mismatched, report that specific dependency; do not silently hydrate or regenerate it.

`git show <commit>:<path>` returns the LFS pointer, **not** the payload. A future `git restore` can invoke smudge; do not mistake pointer checkout for verified source restoration. Restore only the named local objects after the parent releases the paths. For an input not intended to change (Sarelun), retain its exact six-field provenance in the new task manifest and avoid re-exporting it for convenience.

The following Git blobs are identical in the parent and all six examined city/effects/props/den pins (the SVG is parent-pinned only). No shared-pipeline restoration is needed:

- `packages/shared/src/art/glyphs.ts`: Git blob `35018f3099134ae1124faa7a051e4f930755f02b`.
- `docs/art/glyph-alphabet.svg`: Git blob `c055d5eef634ade0fe9023167465166724cf98b6`.
- `packages/tools/blender/export_sites.py`: Git blob `b7651e73932273dbff09f1990b06073148eb7923`.
- `packages/tools/blender/export_cities.py`: Git blob `e7485fd7da5fa8a101b5052eb3f151e61b18f3d1`.
- `packages/tools/blender/artlib/export.py`: Git blob `1527f984a32c3d5db20de7cfd7029cb7aeda4997`.
- `packages/tools/blender/families.json`: Git blob `51cdabb86b6fb9e25b7359290b193109a8c24f24`.
- `assets/blend/_library.blend`: Git blob `14daac0191da2ac3a974492ac0227eb0add3d6f9`.

The shared library LFS content is `33cdd8b1be446e6a1c5dc7f908090b27701d99c3248770ad337e3a7f7cd5210c`, 233,709 bytes. Canonical glyph source SHA-256 is `8f4ad4410689222515b56039555e775aad9869cb22f6fcaff35351a0f4ac0bac`; glyph reference SVG SHA-256 is `b6b2109d6662bfbb6aa1134b59ef2a7d2194a0af813e7d8ba769e213ace069a0`.

## Glyph reuse and actual consumers

`packages/shared/src/art/glyphs.ts` is the authority, already in the parent. It defines 23 letters plus divider, seven lattice nodes, stroke endpoints, orientation and `transliterate` (c/q→k, x→ks, spaces→divider). Shared table identity is unchanged across all examined pins.

Effects branch `task/P1-E07-T14-effects` at `d16b7e41b1c662cc4005a9322f60a8d3522dd219` owns the complete Recall font-like mesh set: `assets/blend/effects/recall.blend` content `19ed201b201b175aff621e7a0cde4eae6e03da1b5a0f5c97d197dc8591b22cc4` (530,671 bytes), `packages/client/public/models/effects/recall.glb` content `f138cba75959be8dda6c7a532745fd99ed4f35449998550a8ddf8faca640beb5` (231,960 bytes). Its manifest has exactly 24 `role=glyph` entries (`recall_glyph_<letter>`, `recall_glyph_divider`). `effects/catalog.py:112-114` reads the canonical source, and `effects/author.py:333-346,393-404` constructs round-capped one-LOD effect meshes from it. This is effects art, not a pre-cut stone face or a four-LOD anchor. Consume the shared definition and use the Recall set as read-only consistency reference; do not duplicate, rename, edit or import the effects capture program into T08.

A detached glyph-only GLB would not finish the anchors. `Review.load` loads one URL and removes its previous content (`packages/client/src/dev/review.js:560-570`). It has no manifest-based anchor-plus-overlay assembly. A new external glyph file neither cuts the existing basalt nor automatically appears on it. Inset glyph faces can be separate editable objects **inside** each canonical saved anchor, but then their integration is still a serialized city source/export edit. Do not invent a compositing loader to avoid file ownership.

Real art consumer: `#review:cities/ixari_anchor:anchor_quavel` parses to `/models/cities/ixari_anchor.glb`; `#review:sites/monolith_0:monolith_0` parses to `/models/sites/monolith_0.glb`. `parseSpec` at review.js:450-455 → `gltfLoader().loadAsync` at :562 → `collectLods` → `select`/`showLod`; `targets()` enumerates asset/variant pairs. `core/Engine.js` supplies Meshopt/Basis loading. CPU artifact tests can decode the actual GLB with NodeIO/Meshopt and pass its actual hierarchy/geometry into the real `collectLods`/`showLod`, as the retained Ixari consumer tests do. That is bounded CPU consumer evidence, not WebGL rendering or shader/material acceptance.

Gameplay remains on `/models/structures.glb` (`Game.js:761`) and `libraryRootVariants('structures', type)` (`Structures.js:115`, `modelLibrary.js:86-88`). Its actual retained GLB has only `monolith_0` and `monolith_1`; legacy builder lines 1732/1882 label an obelisk and pointed arch. DESIGN requires three; a third must be newly authored. No asset-server registry, planet planner, renderer or gameplay loader edits are required for Review source-art acceptance.

## Ownership proof

- City T05/T06/T07 own their existing canonical anchor pairs and task evidence. Parent must explicitly serialize/reassign Quavel and Belost pairs before T08 writes them. Do not rewrite their original manifests/reports; T08 writes its own manifest referring to inputs and recording new outputs.
- Props `bd4f8c3c34357a28ceb4c8f475b5b5d7f15807b4` owns `sites/beacon_0`, `beacon_1`, `outpost_0`, `outpost_1`, `outpost_2` and seven props bundles. Diff against its merge-base proves those exact files; no monolith pair is included.
- Dens `ea58f40198e0d8ad9871075acd42825247a98bc7` owns `sites/den_apex_lair_0`, `den_burrow_0/1`, `den_nest_0/1`, `den_roost_0/1` and `Structures.js`, `modelLibrary.js`, `universe/Planet.js`, shared `world/ground.ts` plus tests. Those paths are excluded from T08.
- Shared exporters, `artlib`, `families.json`, library, glyph source/SVG, Review, capture implementation and all parent orchestration docs remain read-only. Use `--only monolith_0,monolith_1,monolith_2` and exact city anchor stems so an export cannot select another owner's family contents.

## Real specification choices, with simplest recommendations

1. **File packing:** six semantic identities does not specify six files. Recommend three existing anchor bundles plus three one-asset `sites/monolith_0/1/2` bundles, matching the existing outpost/beacon naming and stock `--only` behavior. Six sources/exports, six roots/variants, 24 LODs total; no extra asset family or schema.
2. **Third monolith form:** only two legacy examples exist. Recommend an original split/cleft upright stone for `monolith_2`, distinct from rebuilt obelisk `monolith_0` and pointed arch `monolith_1`, all Cartographer basalt. Suggested heights 22/24/20 m are author choices within the specified 18–26 m band, not new lore. No five-branch or three-people gameplay mapping is specified or needed.
3. **Inscription content:** the spec fixes alphabet/construction, not a sentence per stone or a requirement to display all 24 signs on each. Recommend Sarelun unchanged, `kuavel` and `belost` vertically on their anchors, and the existing DESIGN 2 creed “the stars belong to no one” on each monolith in top-to-bottom columns with divider signs. Use canonical transliteration. Do not fabricate story text or a second alphabet task.
4. **Anchor density:** buildings explicitly target 256 px/m; capital landmarks are hero/4k but have no separate numeric px/m target. Follow the retained Ulgani decision: architecture/stone surfaces at 256 px/m using trims, hero texture/class limits. Do not import the hull-specific 512 target. For new/changed surfaces measure saved and decoded export density; retained earlier assets stay historical evidence, never retroactively declared passing by this brief. Any demonstrated old noncompliance needing broad revision returns to that asset owner, not silently accepted or enlarged here.
5. **Cut representation:** choose mesh V-cuts 2–4 cm deep, simplest to inspect and avoids adding a height-map/displacement runtime. Bible also allows baked normal+height; choosing that requires actual retained source height maps and decoded normal/material proof, not a flat painted/emissive sticker. No loader extension is implicit.

None of these needs a gameplay dependency. The only readiness decisions outside routine author judgment are the exact city-file ownership release and resource admission.

## Native inventory and capture boundary

Capture work is already queued per the task instruction. This preparation does not schedule, run or create a capture framework. The exact candidate hashes must be handed to the existing capture owner after source review; changed anchors need new evidence, while prior reports/captures keep their old identities. Sarelun may reuse only artifacts whose content/scene identities are actually sufficient, not merely the old SOURCE PASS.

Existing planning evidence: Ixari `revision-r1/preparation-r2/GPU_HANDOFF.json` is planned-only, disabled, eight unexecuted jobs and 399 expected paths. Ulgani `density-revision/native-output-inventory.json` is `NOT_RUN_CPU_ONLY`, with exact current anchor hashes. Its text “after T01 renderer integration” is an old scheduling note, not a technical Review dependency: the read load path above requires no T01. Sarelun reviewer records zero engine captures. Do not rewrite or relabel these inventories or their results.

For each of the six final targets, stock `captureReview` writes 6 lighting/LOD PNGs (`noon-lush`, `night-exotic`, `open-space` × LOD0/2), `wireframe_lod0.png`, `wireframe_lod2.png`, `overlay.png`, `far_lod2.png` at 100 m, `sheet.png`, and `perf.json`. Heroes also get `far200_lod2.png`. That is **69 PNGs + six perf JSONs** for the recommended six one-target files (3×12 + 3×11 images), before source turntables/material sheets or per-run provenance. This is a source-derived planned count, not a runtime result or storage admission. CPU turntable/material sheets add twelve images; extra glyph closeups and sibling composition must be explicitly inventoried and admitted. Artifact size is unknown until produced.

Target output directories under stock capture defaults are `assets/renders/review/cities/thalune_anchor`, `cities/ixari_anchor`, `cities/ulgani_anchor`, `sites/monolith_0`, `sites/monolith_1`, `sites/monolith_2`. Pass exact asset and variant selectors. The stock CLI has no `--out-dir`; an existing admitted caller can use `captureReview(..., {outDir})` for immutable revision directories. Do not invent CLI flags or overwrite old captures. New per-run provenance should bind source/export SHA256, app head/tree, current caller, native backend/device, viewport, camera/light/LOD and all output hashes. Standard `perf.json` is evidence to inspect, not automatic qualification of 60 fps.

## Inspection limits and final state

Only cheap Git/ref/blob, text, JSON and file-metadata reads occurred. GLB JSON was read from retained files without decompression. No Blender, codec, rendering, browser/native/GPU, service/DB, installation, LFS fetch/hydration, archive cleanup, commit, push, PR, merge or child worker was run. No prior asset was graded or reclassified. A scratch read script initially had an indentation error and was corrected; it wrote no file. Parent head and clean status were checked before these two new report files were created. A final read observed concurrent parent activity: HEAD then remained c3c82e0fdf6ec342645c9c30f0800bc5104ffcb9, while IMPLEMENTATION_PLAN.md and PROGRESS.md were modified and new review-record paths appeared (companion live pass, animation correction, companion/effects/fauna runtime records, Swift review and T13 samples). Those were not written by this research task and were left untouched. All specification citations and restoration choices are pinned to the requested commit. The subsequent HEAD check observed the parent advance to 0ed859cde0f02e051e7046be844d5bf9b5255d33. That advancement is external to this research; this brief remains based on the explicitly requested c3c82e0 pin. This task made no repository edits.

Deliverables: this report and `AUTHOR_BRIEF.md` in `/private/tmp/p1-e10-t08-prepared-te47n6ix`. All author/capture commands in the brief are future instructions only, behind the parent's existing admission and ownership gates.
