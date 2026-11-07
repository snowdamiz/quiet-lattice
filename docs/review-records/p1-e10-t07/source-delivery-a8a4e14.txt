# Appendix C.2 worker report — P1.E10.T07

TASK: P1.E10.T07 (art) Ulgani kit and Belost landmarks · deps: E14.T02 · done: the lattice and cap language kit. → [R].

STATUS: FAILED for strict full art-bible compliance; the complete inventory and CPU/source/export candidate are committed. The measured texel-density shortfall below is unresolved. Native acceptance is separately NOT RUN by instruction. Do not mark the full task accepted from these CPU passes.

SUMMARY: Authored 39 independent Ulgani assets in eight editable saved Blender sources: four low, four mid and four tall residential variants; plaza, market, skill house, Compact office, listening house, shipyard and salvage yard; twelve wall/gate/bridge/cap/ring/shore/light modules; six props; great cap and root-island anchor. The saved lattice, membrane, cap, gill, root and repair components remain selectable through vertex groups. Four saved LODs per asset, packed PBR maps, separate COL meshes and actual Interact/Light empties are exported by the unmodified stock wrapper. No authoring regeneration occurred after the interruption. Targeted saved-data revisions corrected the over-budget tall mesh, actual route/collider defects and a detached bench back rail. CPU validation passes; full visual/material acceptance does not follow from those passes.

## Provenance

- Verified worktree: `/Users/andreyyurlov/.t3/worktrees/space/t3-6f0e842d`; branch `task/P1-E10-T07-ulgani-belost`.
- Requested and actual initial base: `f9d9cbe2e4b629a14063c9a933c331f213826906`.
- Base tree: `4bd792cd9d7cffb9ac6bc8a86dce3781ed502efd`. Initial working tree was clean.
- Exact artifact head: `538f91188082df4db70f7a47139194146a9c0e31`.
- Exact artifact tree: `6e487ddf6ba60481f1b2d53daa13f7eab0481cbe`.
- The report-only companion commit adds this report, the file list and delivery pin. Its final head/tree are returned in the final worker response, avoiding a self-referential commit hash.
- Preserved interruption record: `interrupted-checkpoint-01.json` and its detailed sibling. Saved-data changes are individually hash-bound in `revisions/`. No source was recreated from `author.py` after resume.
- Shared library verified against its LFS size/hash: 233,709 bytes, SHA-256 `33cdd8b1be446e6a1c5dc7f908090b27701d99c3248770ad337e3a7f7cd5210c`. No broad fetch/hydration.

FILES CHANGED: exact 521 artifact paths, expanded-byte hashes and sizes are in [artifact-file-list.json](artifact-file-list.json); it also names the three report companions. Ownership is exclusively the eight flat `ulgani_*.blend`, eight `ulgani_*.glb`, Ulgani metadata/tools and the three Ulgani CPU render directories. No pre-existing tracked file was modified; shared exporters, artlib, families, library, runtime, other artists' assets and orchestration documents remain untouched.

## VERIFY

The authoritative current index is [delivery-manifest-r02.json](delivery-manifest-r02.json). `delivery-manifest.json` is the preserved earlier candidate. Each process attempt records exact argv, exit, tool hashes, admission and cleanup evidence; failed attempts retain their final 20 lines in the manifest and full immutable `output.log`.

| Command / boundary | Result |
|---|---|
| `python3 packages/tools/blender/cities/ulgani/pipeline.py --stage export --attempt r02` | Eight saved sources stock-exported and stock-validated, exit 0. Props superseded by `--groups props --attempt r03` after the bench correction, also exit 0. |
| `pipeline.py --stage audit --attempt r04` (seven groups; civic run separately with the same attempt ID) | Current saved source and compressed export stock checks pass; direct-buffer, map, collider and route audit PASS. Props current command is `--stage audit --groups props --attempt r05`, PASS. |
| `negative_controls.py --out assets/blend/cities/ulgani/negatives/r01` through `run.py` | Exit 0; 15/15 actual adverse controls detected; original low source/export hashes unchanged. |
| `pipeline.py --stage preview --attempt r01`; three saved-export LOD2 previews; `context_sheets.py` | Exit 0 for each CPU job. Props refreshed with `preview.py --replace-current` into the same six current draft paths and fresh `props-r02.json`; prior reports retained and replaced hashes recorded. |
| `source_contracts.py`, attempt `source-contracts-r04` | Exit 0; 39 scale-normalized point hashes unique, actual world-area-weighted UV density measured. Density is measurement, **not PASS against the art-bible target**. |
| `uvx --offline ruff check packages/tools/blender/cities/ulgani` | Exit 0. |
| `uvx --offline ruff format --check packages/tools/blender/cities/ulgani` | Exit 0. |
| `python3 -m unittest discover -s packages/tools/blender/cities/ulgani -p 'test_*.py'` | Exit 0; three focused tests, including real descendant process TERM/KILL/reap. |
| `node --check packages/tools/blender/cities/ulgani/decode_meshopt.mjs` and Python AST parsing | Exit 0 / PASS. All retained JSON parsed. |
| Staged scoped diff/ownership and LFS identity | PASS: all 64 binary pointers match actual SHA-256 and size; no modified/deleted/renamed pre-existing tracked files. See `checks/staged-r02.json`. |

Final scoped outputs: `checks/scoped-r03.json` and sibling text files. The raw-output diff initially returned 2 for trailing whitespace in the preserved partial failed JSON serialization fragment; the corrected scope excludes only raw tool outputs and that immutable failed fragment. `checks/staged-r01.json` retains the failure; no evidence was whitespace-cleaned to manufacture a pass. Early ad-hoc lint found unused imports and a successive-pair `zip`; those were corrected before the final scoped exit-0 run.

Meaningful failures retained and corrected: source grid/route failures; tall LOD0 60,713 triangles over the 60,000 ceiling (saved correction to 59,800); Blender ID-property iteration; real plaza/cap/turning-bridge/salvage collision defects; macOS long TMPDIR socket failure; an early preview receipt path error after its image saved; source-contract JSON serialization of a NumPy scalar. Capacity refusals produced no Blender job. The importer-based UV/normal failure is retained: direct Meshopt accessors prove the actual exported data, while Blender's reconstructed tiny faces change some imported normals. Missing source vertices were unused decimation remnants, not missing render surfaces. Diagnostics preserve the measured sub-millimetre collider seams; support uses a documented 5 mm footprint.

### Actual geometry and compression

39 assets, 156 saved LODs; 1,340 collider objects, each below the stock 512-triangle ceiling; 84 point markers (12 Interact and 72 Light). Source LOD3 ratios span approximately 3.474–3.5%, below 5%. Residential heights remain within 6–14 / 20–60 / 170–340 m. References are the actual stock-validated 1 m grid and 1.85 m biped. Service openings are 3.4 × 3.4 m, route widths at least 3 m and headroom at least 3.2 m; bridge rail metadata is 1.05 m and pads 24/36 m. The anchor blade is 48 m.

| LOD | Source triangles | Actual exported triangles | Source vertices | Exported vertices | Unused source vertices |
|---|---:|---:|---:|---:|---:|
| 0 | 980,765 | 980,765 | 559,601 | 570,553 | 0 |
| 1 | 294,188 | 294,188 | 189,930 | 199,730 | 1 |
| 2 | 98,042 | 98,042 | 75,343 | 82,779 | 495 |
| 3 | 34,289 | 34,279 | 37,552 | 41,836 | 2,698 |

Meshopt may split vertices at attribute seams, discard unused vertices and collapse degenerate triangles; LOD3 loses ten triangles. The report does not call those counts identical. Direct normalized accessor reads include node/world transforms and the Y-up/Z-up conversion. Every exported corner is jointly matched to source position/UV/normal. Worst per-asset UV P99 is under 0.000055 and normal-vector P99 under 0.017; largest position deviation is about 0.0196 m on the large assets, within the documented 14-bit quantization bound. Marker positions and every custom property survive.

KTX2/Basis and Meshopt required extensions, actual material routes, full mip chains, packed image hashes, channel resolution and GPU texture budgets are in each audit. Maps are 2k building/kit, 1k props and 4k heroes. Surface-sampled map errors have worst mean below 0.007 and P99 below 0.036. ORM uses painted occlusion/roughness and zero metallic; source and exported routes are compared rather than inferred from filenames.

### Resource and cleanup evidence

101 bounded attempts, each with fresh logs/reports. One owned Blender process at a time, background/factory `-t 2`, library limits two, CPU Cycles and GPU denoising disabled. Admission checks load ≤19, memory free ≥25%, disk ≥8 GiB on each heavy launch. Capacity waits/refusals are retained. Largest recorded process-group RSS was 2,856,864 KiB. 168 journalled codec calls were serialized without overlap; explicit encoder threads are two. Every process receipt reports an empty remaining group before lock release; owned scratch is removed after TERM/KILL/reap. Final lock probes and resource snapshot are in `checks/scoped-r03.json`. No other workers' processes/data were cleaned.

## DECISIONS for parent logging

- Unspecified modular counts → 39 total assets with twelve street/cap/ring modules and six props → covers actual planner and service openings while keeping each family independently placeable.
- `ulgani_` names do not match generic `wall*` class patterns → explicit collection `asset_class` → actual families.json budgets apply.
- Belost's documented grid versus lake rings → independent ring shelves, root bridges, large caps and island assembly at metric dimensions → supports grid-under-caps without changing planner/terrain behavior.
- Cap overhang versus residential footprint → separate canopy modules and explicit bounds/clearance metadata → T01 must reserve coverage; do not stretch houses, doorways or caps to arbitrary slots.
- LOD target → saved ~30%/10%/3.5% meshes and direct exported-buffer comparison → obey strict <5% LOD3 while reporting codec topology changes honestly.
- Service semantics → legitimate point markers with existing role IDs where available and `T01_T02_pending` metadata → authoring does not claim runtime dispatch or authority.
- Material palette → shared-library-derived amber/ivory/chitin-brown with restrained green spores, nonmetallic PBR → no reflective metal-truss language or imported Thalune/Ixari geometry.
- **Unapproved density deviation** → current trim atlas spreads macro wear over large surfaces; measured cap/deck/island medians around 9–18 px/m and prop medians around 131–448 px/m → below art-bible 256/512 targets. This remains a T07 source-art revision issue, not a T01 shader workaround or an approved relaxation. Full task acceptance remains open.
- CPU inspection → revised the existing bench Back ends into the seat, preserving topology, UVs, other meshes and packed map bytes → fixes a concrete visible join defect without regenerating the source.

## OUT OF SCOPE FOUND

T01 must consume all four variants (current renderer selects three with `% 3`), preserve metric authored scale (current renderer stretches buildings), replace full-height cylinder collision with authored COL geometry, preserve every service/light marker, implement streaming/LOD/night lights and reserve cap coverage. Planner class thresholds 34/95 m need explicit mapping to authored bands. The current dry level paved plain and generic central tower do not implement Belost's lake, ring decks, bridges or root island; terrain, water, traversal and raised-deck grounding require coordinated T01 work. Service placement must account for local marker offsets: market at 0.62 × plaza radius east, apothecary 14 m north, usable stall at authored deck elevation. T02 owns services and server 5 km safe zone; T03 city life; T04 salvage quest; T08 shared anchor/glyph semantics. No runtime behavior is claimed or changed.

Parent owns native review, independent/blind grading, renderer integration, full smoke and merged checks. No services, DB, browser, Metal/GPU/native capture, grant, push, PR or merge was run.

## ARTIFACTS

- Current exact index: `delivery-manifest-r02.json`; hashes below and all asset-level bounds/LOD/map/material/collision/marker values therein.
- CPU images: `assets/renders/cities/ulgani-cpu/` plus two earlier iteration directories. **48 compact images, 26,045,250 bytes** total: 39 current source LOD0 eight-angle sheets, three decoded-export LOD2 sheets, three atlas sheets, one metric assembly study and two earlier iteration images. No raw frame sequences retained.
- Worker inspection evidence: `cpu-visual-inspection.json`. The first historic preview is explicitly not current-source evidence. The context's props material atlas predates the bench geometry-only correction; `bench-join-r03.json` proves identical packed maps, recorded as an exception in the current manifest.
- Exact future native inventory: `native-output-inventory.json`: 432 PNGs and 78 JSONs, **510 outputs**, three lighting cases at LOD0/2, wireframe, overlay, 100 m far, additional 200 m hero views, turntable/material/family sheets and paired performance/provenance. Status NOT_RUN, grant null. Proposed batches of four assets retain at most 47 images and 512 MiB; parent must first account for/archive the existing 48 CPU images. This proposal authorizes no capture or cleanup.
- Current stock and custom reports: seven `audits/*-audit-r04/` plus `audits/props-audit-r05/`; `negatives/r01/`; `checks/`; every prior failed/successful attempt preserved.

### All current source/export hashes

| Path | Bytes | SHA-256 of actual file |
|---|---:|---|
| `assets/blend/cities/ulgani_low.blend` | 5,367,800 | `f2ef844735f9fed2457879c1a1f9662b1d3d829761adba69db4b419dff7065b1` |
| `packages/client/public/models/cities/ulgani_low.glb` | 1,766,204 | `3dc6c37853cc2c65f77ba3718d8c4d86d18df12f42a499650c15d99feb12aa1a` |
| `assets/blend/cities/ulgani_mid.blend` | 6,939,170 | `dd0513776b5261faccf93792056305525e80c943fcc3c40ce9137e21239c2204` |
| `packages/client/public/models/cities/ulgani_mid.glb` | 2,342,668 | `37c8ca97b2213bb94631a357f075613da4c36f06fd8f6500661bc49325298f61` |
| `assets/blend/cities/ulgani_tall.blend` | 10,296,029 | `9959d0c7397d5eb58571f47056f31525c086b0968185762ed3268dea964efc33` |
| `packages/client/public/models/cities/ulgani_tall.glb` | 3,412,164 | `d25b68a5aefbd25c16a48d05c51faf6e78c8f00efd33385edc61ecce1bc96876` |
| `assets/blend/cities/ulgani_civic.blend` | 8,602,851 | `9a1d4056428142a0ab01dde166a6ef60381a024b17e07dc213da1eb3343d18de` |
| `packages/client/public/models/cities/ulgani_civic.glb` | 3,028,284 | `b990e9b889011cb448d50492c8f191e66cc67c808e8fbaca091dbb2accc3b011` |
| `assets/blend/cities/ulgani_kit.blend` | 5,966,989 | `00743f8ac3b48e5bbd1784fa16cc96c71b6a3c592d1df17cab6a72781aeee05a` |
| `packages/client/public/models/cities/ulgani_kit.glb` | 1,749,572 | `5532150f6572a4d216eaea3aff2110c79d1412cd62430d0e35c08d04a648ef61` |
| `assets/blend/cities/ulgani_props.blend` | 2,016,109 | `f717a0ed46f34454b84006abeed44df74629a23d8f8ea97341d66e788c73f98c` |
| `packages/client/public/models/cities/ulgani_props.glb` | 623,576 | `8634270aaedb9a100560fc8dfa3baaa4d3dcf738aac29bb106c3c73342ad33e0` |
| `assets/blend/cities/ulgani_landmarks.blend` | 8,783,408 | `60b76c3b183cb6988f86cbd99b1c3176bb0db623baa30e695fc423f7359c3934` |
| `packages/client/public/models/cities/ulgani_landmarks.glb` | 2,099,760 | `50df784c753042e6963f645cf52efcdaf175df6b4b4ed3cc5cf6c92a21e49592` |
| `assets/blend/cities/ulgani_anchor.blend` | 9,754,336 | `eafc062e422cfa96ac8488f53b7d2083d9091c91a552a13bc6498d5b284ca5e3` |
| `packages/client/public/models/cities/ulgani_anchor.glb` | 2,466,044 | `acc3f4f97c754ef55bb27f69045937d54413f5100d8425f157b213b0f7f8f4b3` |
