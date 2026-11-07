# Appendix C.2 — P1.E10.T07 density correction

TASK: P1.E10.T07 (art) Ulgani kit and Belost landmarks · deps: E14.T02 · done: the lattice and cap language kit. → [R].

STATUS: DONE for the requested CPU texel-density correction. Full T07 art acceptance is still pending independent source-art review, native captures and blind grading. The preserved compressed-position degeneracy and visual concerns below are not waived.

SUMMARY: Revised the eight saved Blender sources and their eight compressed exports while retaining all 39 assets. The correction replaces the low-density macro atlas with class-resolution periodic growth maps, metric UV charts and semantic constant-tint materials. Existing repair geometry and purposefully placed material assignments carry macro wear. Every source triangle and every measurable compressed-export triangle at all four LODs now meets the 256 px/m or 512 px/m target. Geometry, corner normals, vertex groups, transforms, collection membership, object properties, collider contracts and marker contracts match the previous committed sources exactly. No author.py regeneration or shared pipeline change was used.

## Provenance and ownership

- Worktree: `/Users/andreyyurlov/.t3/worktrees/space/t3-6f0e842d`; branch `task/P1-E10-T07-ulgani-belost`.
- Original requested and recorded actual parent base: `f9d9cbe2e4b629a14063c9a933c331f213826906`, tree `4bd792cd9d7cffb9ac6bc8a86dce3781ed502efd`.
- This correction began clean at `a8a4e142828de25fff9235e49d25e17b50d1f047`, tree `efdc9c74d703ab0c3e2740fb129cdb1dbd102868`.
- Exact artifact head: `fdc456bf9057102099dcfde2bfbbce056f6ef801`.
- Exact artifact tree: `0925e7fe48d0a99806341d4a5fbbe83e457ef5b6`.
- A separate report-only companion commit contains this report, file list and delivery pin. Its final head/tree are returned to the parent in the worker response; this avoids a self-referential hash.
- Pinned launchers and original image hashes: [launchers-and-base.json](launchers-and-base.json). Base LFS sources were read only after exact hash/size verification; no broad fetch or hydration.

FILES CHANGED: [artifact-file-list.json](artifact-file-list.json) lists all **742 artifact paths**, actual expanded-byte hashes and sizes, plus the three report companions. Nineteen pre-existing paths changed: eight flat Ulgani blends, eight flat Ulgani GLBs and three task-local tools. All other additions are owned Ulgani metadata/tools or `assets/renders/cities/ulgani-density/`. The original reports, failure evidence and all 48 original images remain unchanged. Shared export_cities.py, artlib, families.json, _library.blend, runtime, other cities, plan, PROGRESS, DECISIONS and VISUAL-REVIEW were not changed.

## VERIFY

The authoritative index is [delivery-manifest-d01.json](delivery-manifest-d01.json), with exact source/export hashes, every asset/LOD density row, source/export geometry counts, routes, bounds, collisions, markers, map hashes, process commands/exits/failure tails and preview hashes. Earlier revision reports are immutable historical evidence, not current-art proofs.

All launch commands use pinned Python `/opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14`. Each heavy child has the exact argv and launcher/tool hashes in its process receipt. Blender arguments are `-b --factory-startup -t 2 --python-exit-code 1`; the unmodified stock exporter is selected with `--only ulgani_<group>`.

| Command / boundary | Actual result |
|---|---|
| Stock `export_cities.py --only ulgani_<group> --report-dir <fresh directory> --quiet` | Six current saved sources exported, exit 0 each. Current unchanged props/landmarks exports are d07, exit 0 each. Exact dispatched argv is in `attempts/export-*-d09/` and the two d07 receipts. |
| `verify_density_revision.py --attempt d10` | Exit 0; launches preservation, all-source/export density, material-route fidelity and density/material adverse controls. All four child receipts exit 0. |
| `pipeline.py --stage audit --attempt d10` | Eight groups exit 0; all 8 stock source and 8 stock export validations PASS with zero warnings, plus actual decoded geometry/UV/normal/map/collider/marker checks PASS. |
| `negative_controls.py --out assets/blend/cities/ulgani/negatives/d03` through bounded launcher | Exit 0; 15/15 stock/custom adverse controls detected on actual private copies. Originals unchanged. |
| `density_controls.py --attempt d10` through bounded launcher | Exit 0; 9/9 density/material controls detected, including undersampled visible faces, anisotropic stretch, unused-UV padding, all-degenerate geometry and actual exported factor/UV-route mutations. |
| `final_metric_sheet.py` through `preview-full-final-d01` | Exit 0; one final CPU composite, 132 views of 39 saved assets plus 5 decoded assets. |
| `summarize_density.py` | Exit 0: 39 assets, 312 density rows, 16 new images. Verifies current hashes, historic image retention, all attempt cleanup and serial codecs. |
| Pinned Ruff `check` and `format --check packages/tools/blender/cities/ulgani` | Both exit 0; 35 Python files formatted. |
| Pinned Python `-m unittest discover -s packages/tools/blender/cities/ulgani -p 'test_*.py'` | Exit 0; 3 tests, including a real owned descendant process forced through TERM/KILL/reap. |
| Pinned Node `--check packages/tools/blender/cities/ulgani/decode_meshopt.mjs`; Python AST | Exit 0 / PASS. |
| Strict new JSON parsing, ownership, source/export/image hashes and lock probes | PASS; [precommit-checks-d01.json](precommit-checks-d01.json). |
| Staged LFS and scoped whitespace check | PASS: all 32 revised binaries match staged pointers and shared LFS objects by SHA-256 and size; [staged-checks-d01.json](staged-checks-d01.json). Only immutable raw output.log files are excluded from whitespace checks. |

Full command output for scoped checks is in [scoped-checks-d02.json](scoped-checks-d02.json). A newly generated TSV initially used CRLF and failed the whitespace check (exit 2); [diff-check-failure-d01.json](diff-check-failure-d01.json) preserves that output and last 20 lines. Only that new summary table's line endings were normalized; audit reports and logs were not rewritten.

### Density, actual sampling and preservation

Density is the minimum singular value of the triangle's world-metre-to-texture-pixel Jacobian, using the actual image dimensions and per-polygon material. Source modifiers/shape keys are rejected; decoded accessors include normalization and world matrices. Texture routes must use UV0 without transforms, with REPEAT. Source/export coverage must match all 39 assets × four LODs; empty/missing coverage cannot pass. All-degenerate rows explicitly fail.

| Visible-surface class | Required px/m | Source minimum | Compressed export minimum | Undersampled visible triangles |
|---|---:|---:|---:|---:|
| Building / kit / hero | 256 | 304.495028817 | 268.808136532 | 0 / 0 |
| Prop | 512 | 612.754961991 | 540.215579569 | 0 / 0 |

[Density per asset](density-per-asset.tsv) gives separate source and export minima at LOD0/1/2/3 for all 39 assets, failing counts and zero-area counts. [density-all-d10.json](density-all-d10.json) retains full-precision minima, area-weighted P1/P5/P50/P95/P99, triangle histograms, anisotropy, UV bounds and failing-face details. Zero undersampled area is measured, not inferred from metadata or unused UV area.

All **1,407,284 source triangles are nondegenerate**. The exports contain **1,407,274 triangles**, of which **4,649 have zero measured world area** under the disclosed ≤1e-14 m² criterion: 4,559 non-prop and 90 prop. The same 4,649 were present in the original compressed baseline. They are not counted as sampled visible area. Unchanged stock 14-bit position quantization can collapse thin geometry; exact source geometry preservation does not imply nondegenerate or identical compressed topology. Resolving this would require a separately reviewed geometry-grouping or codec change, outside this UV/material correction. No threshold was loosened to hide undersampling.

Saved geometry, all original corner normals, vertex groups, object transforms/properties and collection memberships match the hash/size-verified base in [preservation-d10.json](preservation-d10.json); maximum source normal component error is **0.0**. All 39 LOD0 geometry hashes are unique. All 1,340 COL objects and 84 point markers (12 Interact, 72 Light) retain their original contracts; exported marker properties match sources. Service openings, walking routes, bridge support/headroom, reference scale and collider fit pass the fresh d10 audits.

| LOD | Source triangles | Export triangles | Source vertices | Export vertices | Unused source vertices |
|---|---:|---:|---:|---:|---:|
| 0 | 980,765 | 980,765 | 559,601 | 928,276 | 0 |
| 1 | 294,188 | 294,188 | 189,930 | 814,217 | 1 |
| 2 | 98,042 | 98,042 | 75,343 | 275,304 | 495 |
| 3 | 34,289 | 34,279 | 37,552 | 89,439 | 2,698 |

UV seams and material boundaries increase exported vertex counts substantially, particularly at LOD1; these counts are reported rather than presented as identical. LOD3 triangle ratios remain 3.474–3.5% of LOD0. Direct Meshopt reads pair each exported corner's position/UV/normal together with a source corner. Worst asset/LOD UV P99 is 5.960464477539063e-8 and normal-vector P99 is 0.016593784754608362; maximum position deviation is 0.019507844001054764 m, within the unchanged stock quantization bounds. Runtime draw/streaming performance is not established by this CPU audit.

### Actual maps, materials and budgets

Each source contains four packed maps, shared by local semantic materials: BaseColor, ORM (R=occlusion/G=roughness/B=zero metallic), tangent Normal and Emissive. ShaderNodeMix RGBA MULTIPLY with factor one carries positive linear-space tint constants into glTF. Exact tint/emission/normal strength, roughness/metallic/AO factors, channel selection, image sharing, all texture-info UV routes and REPEAT samplers are checked by [material-all-d10.json](material-all-d10.json). There are 12 local source material definitions; only used definitions export.

| Group | Map side px | Used exported materials | Render primitives across all assets/LODs | Stock per-asset GPU map MiB |
|---|---:|---:|---:|---:|
| low | 2048 | 11 | 171 | 21.3–21.3 |
| mid | 2048 | 11 | 171 | 21.3–21.3 |
| tall | 2048 | 11 | 172 | 21.3–21.3 |
| civic | 2048 | 11 | 251 | 21.3–21.3 |
| kit | 2048 | 11 | 241 | 16–21.3 |
| props | 1024 | 11 | 154 | 4–5.3 |
| landmarks | 4096 | 4 | 16 | 85.3–85.3 |
| anchor | 4096 | 6 | 23 | 85.3–85.3 |

Actual families.json limits remain unchanged: buildings 8–60k triangles / 2k / 128 MiB, kits 0.5–15k / 2k / 128 MiB, props 2–10k / 1k / 32 MiB, heroes 60–150k / 4k / 512 MiB. The stock validator passes those class limits. Each class's four images remain shared by its materials; repeated references do not create additional map allocations within a GLB. Cross-file deduplication and actual residency are T01 integration/performance concerns.

All exported images are KTX2: UASTC+Zstandard normals, ETC1S/BasisLZ BaseColor/ORM/Emissive, with 11/12/13 mip levels for 1k/2k/4k. Source packed-image SHA-256 values and **every actual embedded KTX2 byte hash** are in the manifest's eight `audits` entries. Material slots route to those actual image indices. Meshopt is required. UV accessors are FLOAT (5126), unnormalized; compact REPEAT charts stay bounded (maximum absolute source UV 27.943769454956055). An integer shift of a whole polygon preserves sampling; no per-corner fract or metadata density inflation was used.

### Failures retained and corrected

The original [worker report](../WORKER_REPORT.md), baseline candidate and 48 images remain intact. [baseline-d01.json](baseline-d01.json) reproduces the actual low-density failure: 1,275,456 source and 1,271,588 export undersampled measurable triangles. Subsequent failures were not overwritten:

| Bounded attempt | Exit | Exact command, last 20 failure lines and cleanup |
|---|---:|---|
| `audit-tall-d04` | 1 | [audit-tall-d04](../attempts/audit-tall-d04/process.json) |
| `density-all-d03` | 1 | [density-all-d03](../attempts/density-all-d03/process.json) |
| `density-all-d07` | 1 | [density-all-d07](../attempts/density-all-d07/process.json) |
| `density-baseline-d01` | 1 | [density-baseline-d01](../attempts/density-baseline-d01/process.json) |
| `material-props-d01` | 1 | [material-props-d01](../attempts/material-props-d01/process.json) |
| `preservation-density-d01` | 1 | [preservation-density-d01](../attempts/preservation-density-d01/process.json) |
| `preservation-density-d02` | 1 | [preservation-density-d02](../attempts/preservation-density-d02/process.json) |
| `trim-props-d01` | 1 | [trim-props-d01](../attempts/trim-props-d01/process.json) |

The process receipts and manifest `processAttempts` retain failure tails; sibling output.log files retain complete raw output. Corrections addressed vertex-group restoration, Blender ID/empty-reference inspection, lost legacy MixRGB tint/emission, intermediate triangulation changing corner normals, and excessive UV coordinates causing V-flip float precision loss. Source-PASS/export-FAIL runs found 732 and then 4,226 undersampled exported triangles; only measured affected saved polygons received codec margin. The final d10 proof is fresh after the last material assignment correction. The read-only implementation-tool review's five P2 findings and responses are in [tool-review-response-d01.json](tool-review-response-d01.json); this is not source-art acceptance.

### Resource and cleanup evidence

**151 bounded revision attempts**, exclusive immutable logs/reports. All report empty remaining process groups and absent private scratch after cleanup. Maximum observed process-group RSS **3,120,544 KiB**. **464 codec calls**, no temporal overlap, explicit encoder threads two. One owned Blender at a time; CPU Cycles, GPU denoising disabled; all library limits two and ART_KTX_JOBS=1. Every heavy launch checks real load/memory/disk; admission uses load ≤19, free memory ≥25%, disk ≥8 GiB. Jobs have finite wall time, 7,000 MiB RSS and 24 MiB output limits, short private /tmp directories, owned group TERM/KILL/reap before lock release. Pinned Python/Node/Blender/tsx/KTX hashes are checked without implicit installation or scratch dependency links.

Final precommit snapshot: load 12.188 / 10.295 / 9.326, 80% memory free, 30,151,290,880 bytes free; both owned lane/codec locks unlocked. The index binds actual per-job admission/postflight samples and cleanup receipts. No other worker's process/data was cleaned; screenshot cleanup remained stopped.

## DECISIONS for parent logging

- Low-density macro atlas versus fixed map budgets → periodic directional microtexture plus metric trims and existing repair geometry/semantic tints → actual density without larger maps, repeated large weather motifs or runtime shader workarounds.
- Density averaged by area → use the weakest directional density of every triangle, all four LODs, source and actual decoded export → collapsed/stretched UVs cannot hide behind averages.
- Legacy MixRGB lost exported tint → modern RGBA Mix multiply with exact factor audits → actual source/export material fidelity.
- Intermediate triangulation changed normals → restore the original saved polygon mesh and transfer corrected UVs → exact source geometry and normal preservation.
- Huge UVs damaged float precision → compact world-metric charts aligned with original growth directions, one whole-chart integer shift → bounded FLOAT UVs with unchanged REPEAT sampling.
- Position quantization changed small triangle metrics → margin only on source polygons matched to actual undersampled decoded triangles → independent export PASS with no unused-face padding.
- Floor-wear selected by centroid → require polygons wholly within the central 2.8 m walking band → limits oversized wear wedges; polygon-shaped boundaries still need visual assessment.
- Stock position collapse / extra seam vertices → disclose exact counts and preserve the authorized geometry/codec boundary → no false exact-topology or performance claim.

Detailed decisions: [decisions-d01.json](decisions-d01.json) and [decisions-d02.json](decisions-d02.json). Parent may transfer them; orchestration documents were not edited.

## OUT OF SCOPE FOUND / remaining gates

T01 must consume all four residential variants (current renderer uses three and `% 3`), preserve authored metric scale (current footprint/height stretching destroys openings and density), map planner 34/95 m thresholds to authored 6–14 / 20–60 / 170–340 m bands, consume authored COL openings instead of full-height cylinders, retain every Interact/Light marker, and implement streaming/LOD/night lights/cap clearance. Use the standard exported material factors, FLOAT UV0, REPEAT and full mip chains; source density must not be replaced by a runtime detail shader. Measure the reported vertex/primitive/residency costs during integration.

Belost remains a **grid under caps with ring shelves, root bridges, glowing-lake composition and a root-island anchor assembly**. Current dry-plain terrain/planner, paving and generic central tower do not implement that composition. Terrain/water/traversal and raised-deck actor grounding need coordinated T01 work; this deliverable does not claim runtime implementation. Market is 0.62×plaza radius east and the apothecary is 14 m north of that anchor; service standing areas must be grounded to the authored deck and reached within actual interaction distance. T02 owns services/server 5 km safe zone; T03 city life; T04 salvage quest; T08 shared anchor/glyph semantics.

Independent source-art review and native visual grading are still required. CPU inspection found remaining angular floor-wear boundaries and inherited LOD2 cap faceting/slits. Fine periodic growth is visible in closeups; native filtering, seams and repetition need grading. Some automatic closeups frame shaded undersides poorly, so they do not establish quality everywhere. The 4,649 baseline compressed zero-area triangles remain a disclosed geometry/codec concern. These are genuine limits, not accepted deviations or T01 shader fixes.

No services/DB, GPU/Metal/browser/native capture, capture grant, main checkout mutation, push, PR or merge occurred. Parent owns fresh independent review, native capture/grading, renderer integration, smoke and merged checks.

## ARTIFACTS

- [Delivery manifest](delivery-manifest-d01.json), [per-asset density table](density-per-asset.tsv), eight `../audits/*-audit-d10/` directories and `../negatives/d03/` bind all current evidence.
- CPU inspection: [cpu-visual-inspection-d01.json](cpu-visual-inspection-d01.json). Final image: [full-kit-final-d01.png](../../../../renders/cities/ulgani-density/full-kit-final-d01.png). Each triplet is LOD0 whole / two-metre material closeup / LOD2 whole, four triplets per row; the final five triplets are decoded exports. Receipt [preview-final-d01.json](preview-final-d01.json) identifies every tile and exact source hash.
- **16 new compact images / 56,958,210 bytes; 64 combined / 83,003,460 bytes.** New allowance ≤16 /128 MiB and combined ≤64 /512 MiB satisfied. Original 48 preserved. Manifest labels older revision snapshots as historical, props/landmarks snapshots as current where their hashes match, and map sheets as current map pixels despite an older material-assignment-only source snapshot. No raw frame sequences retained.
- [Exact future native output inventory](native-output-inventory.json): **510 named outputs = 432 PNG + 78 JSON**, three lighting cases at LOD0/2, wireframe, overlay/far/performance, turntable/material/family sheets. Current source/export hashes bound; NOT_RUN and no grant. Proposed four-asset batches need a **separate parent storage budget/location** because the retained CPU evidence already uses all 64 image slots. Estimated full native PNG volume at 2 MiB/image is 864 MiB. This proposal authorizes no capture, archival, deletion or limit expansion.

### All current source/export hashes

| Actual file | Bytes | SHA-256 |
|---|---:|---|
| `assets/blend/cities/ulgani_low.blend` | 12,513,596 | `d19021db8285c2726c8979f40f963fb4c3b133b9c6ec618eec3d03863a34cb6f` |
| `packages/client/public/models/cities/ulgani_low.glb` | 5,484,260 | `165b56af669ee5dea7c41a0ac0ad92348d9d44590e0d416bfbd80e9200f93e50` |
| `assets/blend/cities/ulgani_mid.blend` | 14,470,834 | `187423630552ec9b06210ba6b7600022f144f6cacc7da80a59a97935a3582954` |
| `packages/client/public/models/cities/ulgani_mid.glb` | 6,884,344 | `d63331a9551adf640dee1eaf50ba2060e57acac0ae13de4ace9f5f8ca8b2f894` |
| `assets/blend/cities/ulgani_tall.blend` | 18,685,605 | `928a7dd1922050aceafadce863bf93e04a22bb8c483c8a631c45de538176b553` |
| `packages/client/public/models/cities/ulgani_tall.glb` | 10,099,232 | `f71ac27e651e907bf6757e26c06e65b64a21bb98889357fd79b4315d0014c167` |
| `assets/blend/cities/ulgani_civic.blend` | 16,273,994 | `5aa69c0ad3e749593e22ca41f991b25bdb25cf24ca59ffba02b4e8187ed294de` |
| `packages/client/public/models/cities/ulgani_civic.glb` | 8,718,280 | `f962112baed9e9590682e099b6f78d89f6b8f610c60b3fd09122d98b9f3a7cd1` |
| `assets/blend/cities/ulgani_kit.blend` | 12,993,525 | `c57392d053b13177c80327e479d0637e6afdcb2dc7d5f9f2679b3e42848f626b` |
| `packages/client/public/models/cities/ulgani_kit.glb` | 6,096,272 | `e62913d2b377f554167e52a329e20a8f9de68eab02a2a41eecf82c2b9c6fd4ca` |
| `assets/blend/cities/ulgani_props.blend` | 4,309,571 | `091f13f6539ac5bc91fca4226cdcf3db36296fb946378f293fec4180dac5a638` |
| `packages/client/public/models/cities/ulgani_props.glb` | 1,876,340 | `113fc5fadf0ae14a577b1b1dde20d3d4cb0f539b84f7dc04dcac58a8f2450499` |
| `assets/blend/cities/ulgani_landmarks.blend` | 30,052,191 | `32a632aa09eb11b2615b0dd71d4be1936601f8a62e933fdb1434421ba6e0206b` |
| `packages/client/public/models/cities/ulgani_landmarks.glb` | 11,319,580 | `7fec7c4aa40f6d1ded00b871e2026c9fff0cd425ae103267095ef07267df2ee9` |
| `assets/blend/cities/ulgani_anchor.blend` | 31,161,651 | `f2248ffc0e2c562cc7a9b5ae41778954e53a5f885c75817f0bd3e381e0edce37` |
| `packages/client/public/models/cities/ulgani_anchor.glb` | 12,220,848 | `7cdf23f63429e7c2545d082665f747cc50d3fd3c329fe344a98d6787b93ad5d8` |
