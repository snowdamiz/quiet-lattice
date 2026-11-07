# Lark pinned geometry evidence — 2026-11-07

Geometry decoding, full pane-perimeter measurements and source correspondence have advanced from tooling to actual evidence. Intentional seat clearance, the complete outer-plate denominator and structural hull-frame exposure remain **UNQUALIFIED**. No repair, asset save, export, render, visual grade, runtime/capture/performance pass, PR, push or merge was performed.

Source toolkit `eed0d0f28e57f0645d6377a0e9519b22dc1e93a3` was recovered alone as `0c84ae2bd`. Every change is under this directory. The original `EXECUTION.md`, independent geometry report and Mule/Lark report were read in full; the subsequently admitted density report was also read. Existing density/stock-validation results are not a geometry or visual acceptance transfer.

## Byte and coordinate identity

- Candidate: `6445c7ec07aa2a08b722aeca22d56132154ea32c`, read-only author checkout `/Users/andreyyurlov/.t3/worktrees/space/t3-7d211d96`.
- Blend: `d48d83e9c6a76b0214028a80389a77d6dfd19f65704c73ffc9f47dca58b244ba`, 48,962,870 bytes.
- GLB: `7cd5fed2661f96dd67b50c0a5f6d7df995be43d4adc57d327d35479d894a5e78`, 19,791,628 bytes.
- The decoder hashes the bytes it passes to NodeIO. It rejects external buffers/images, unsupported morphs/non-triangle primitives, missing/nonfinite render attributes, and render meshes without an owning variant/LOD. Five outside-LOD COL meshes are collision-only exclusions. All 151 render primitives participate in their owning scene.
- Meshopt decoding precedes `Accessor.getElement()` normalization. Full ancestor matrices apply exactly once. The explicit ancestor product is checked against NodeIO's world matrix. A second decode matrix is rejected. Thirty skinned primitives across 24 skins use `sum(weight * jointWorld * inverseBind * normalizedPosition)` in the saved pose; mesh node world must not be applied again. This is saved geometry, not procedural-motion qualification.
- All 24 source canopy object world matrices are identity, with source units METRIC, scale 1.0. Lower-LOD frames have `LOD_xfer` data-transfer modifiers; evaluated positions and polygon topology match saved geometry exactly. Thus different exported frame/glass node scales are decode transforms, not evidence that the pinned source objects were misaligned.

Fresh totals exactly reproduce the independently reviewed decoder's totals:

| Variant | LOD0 | LOD1 | LOD2 | LOD3 |
|---|---:|---:|---:|---:|
| base | 108746 | 73947 | 59938 | 4015 |
| damaged | 113554 | 79329 | 65756 | 3907 |
| husked | 110379 | 77952 | 66039 | 3484 |

## Actual construction and unsigned perimeter distances

Primary receipts are `receipts/glazing-v2.json`, `receipts/source-glazing-v2.json` and `receipts/source-comparison-v3.json` (large JSON receipts may be losslessly packed as `.json.gz`; the archive manifest retains original byte hashes).

Saved source geometry verifies all 159 eight-vertex ring cycles in each LOD0 frame: four groups of 21 arch rings and three groups of 25 rail rings. Their measured world radii range from 0.029999894 to 0.045000102 m. The explicit historical frame probe's 1,392 local coordinates exactly match the current saved LOD0 frame. This correspondence is now checked against saved topology, not accepted from a generator's length assertion.

Every source pane's quad grid topology is verified. Each variant/LOD contains six separate panes. LOD0–2 have 42 boundary edges per pane (252 total), and LOD3 has 30 per pane (180 total). The arch-boundary vertices are 0.005999804–0.006000280 m below the frame centre curves; maximum deviation from source-local `(0,0,-0.006)` is 0.000000282 m. This measures the centre-curve construction offset. It does **not** specify a 6 mm distance to the outside of a 30–45 mm radius frame tube, acceptable exposure, or intentional overlap.

Actual decoded LOD0 dimensions are frame `(2.085171842, 1.385254021, 4.826222062)` m and glazing `(1.864423518, 1.308489421, 4.651760101)` m in glTF world XYZ. All LOD dimensions, bounds, world matrices and source rings are retained. The signed int16 storage half-cell is about 0.06 mm, but the effective quantizer is 14 bits with MSB replication. Its construction-derived per-position bound is about 0.338–0.351 mm, and the frame+pane bound is about 0.681–0.689 mm. The final comparison checks the actual export against that exact quantizer's integer codebook and maps all glazing vertices and triangles to saved source identities. This is stronger than proximity welding. Export/source boundary edge identity hashes agree for all twelve glazing instances.

The numerical sampling resolution was fixed at 1 mm before distance evaluation, without an acceptance tolerance. Each reported interval bounds the **maximum unsigned distance** from the full pane perimeter to nondegenerate frame surface triangles: sampled maximum is the lower endpoint; the upper endpoint adds half each edge sample interval, by the 1-Lipschitz distance property. This is a spatial sampling bound in ordinary floating-point arithmetic, not a formal floating-point error certificate.

| Variant / LOD | Saved source maximum interval (mm) | Decoded GLB maximum interval (mm) |
|---|---:|---:|
| all, LOD0 | 32.8502–33.3451 | 32.8498–33.3469 |
| all, LOD1 | 32.9478–33.4452 | 33.0612–33.5584 |
| all, LOD2 | 32.3228–32.8206 | 32.3954–32.8930 |
| base/damaged, LOD3 | 46.6516–47.1503 | 46.6974–47.1963 |
| husked, LOD3 | 280.8515–281.3502 | 280.8715–281.3699 |

The largest sampled source/export maximum difference is about 0.1135 mm. Source/export correspondence and similar perimeter maxima do not certify all surface interiors, shading, overlap or continuity. The large husked LOD3 distance is present in the saved source as well as the export; it is not a visual failure finding or an instruction to repair it.

The original conservative decoder-only seam reconstruction rejoins exact duplicates within existing indexed connectivity and keeps disconnected coincident boundaries separate. The subsequent source bridge resolves every pane boundary to its distinct saved pane identity. Frame UV splits are also mapped where unique; quantization-collapsed source identities are retained as ambiguous. The final source comparison includes every unresolved vertex and source candidate. Base/damaged LOD3 have 92 source frame triangles versus 91 exported; husked LOD3 has 22 versus 15. Some frame triangles remain ambiguous or unmatched; no blanket surface-equivalence claim is made.

No saved requirement establishes acceptable frame seating or exposure. Therefore there is no `PASS`/`FAIL` clearance threshold. Zero-area exported triangles are excluded from nearest render-surface distance; no positive area cutoff is used. Their counts are in the final glazing receipt.

## Sampled visibility and semantic limits

`survey.mjs` uses the complete decoded render scene for each of the twelve variant/LOD targets. The reference is the complete base scene at the same LOD, including its glass, mechanisms and other meshes; it is deliberately not a material-selected plate denominator. Source triangles receive equal-area deterministic 3, 12 and 48 barycentric strata. World edge cross products determine normals and areas. Each sample is traced from beyond the union scene bounds, first against the base reference and then, when the exact source triangle is first visible, against the complete target scene.

Three direction families are retained separately: world winding normal, and plus/minus 45 degrees around a reproducible world-axis tangent. This is directional sensitivity, not exhaustive directions or a statistical confidence interval. Geometric intersections are double-sided and treat every mesh as an occluder, including glass. Material alpha/transmission, texture alpha tests and lighting are not evaluated. No whole face is assigned a centroid's classification. Zero-area reference triangles are counted and excluded; numerical ray tolerances and coincident first-hit tie counts are explicit.

Each `survey-<scene>.json.gz` retains the source/target node and primitive identity ranges, topology hashes, all first-hit triangle histograms, per-source-triangle visible sample counts, representative source sample/target hit positions and distances for every object transition, and a SHA-256 stream digest over every accepted source sample/first-hit/distance record. Histograms resolve global triangle IDs to exact node/primitive/local triangle identity. Area weights are **reference source sample weights**, not the areas of the target triangles hit. Summary JSON files retain directional and sampling sensitivity. `visibility-semantic.json.gz` applies only the source identities that are supported; hull structural-frame hits remain null/UNQUALIFIED.

The exact source bridge maps 630,318 of 634,406 Body export triangles uniquely to saved source polygon IDs. The remaining 4,088 triangles retain empty or multiple candidate identities, including coincident surfaces and quantization/tessellation uncertainty. Mapping does not silently choose one. All source modifier geometry used for Body mapping was also verified unchanged by evaluation.

The partial semantic inventory now contains 185 authored positive-`pid` plate groups on base Hull/Accent, grounded in saved `pid`/`plate` attributes and the historical construction routine that uses those attributes for seam-aligned plate removal. This evidence is more specific than a connected-component proxy. It is still incomplete: 3,688 base Hull/Accent polygons have `pid=0`, 100 other positive-ID groups are on Dark, and lower LODs lose many IDs during simplification. A missing ID does not prove a removed plate. The inventory keeps every plate's removal state unknown. Dark and Trim hits are never called frame merely because of their material. There is no established hull structural-member/load-path inventory.

`inventory.json` binds source bytes, GLB bytes, every inspected source object topology hash and every decoded primitive topology hash. Its denominator-complete field remains false. `plate_count` now rejects missing/stale bindings and requires an explicit reviewed denominator before counting. The 15–30% plate-count requirement is neither passed nor failed by area, hit frequencies, missing ID counts or connected components.

## Remaining source-only gates

1. Resolve the exact 3,688 base `pid=0` Hull/Accent polygon IDs in `inventory.json:missing_identities.base_pid0_hull_accent_polygons` into authored seams/plate ancestry, including added surfaces and any surfaces that are not plates. Review the listed 100 other positive IDs for outer-shell membership.
2. Identify actual hull ribs, longerons and backing by saved object/polygon group and load-path role. `source-semantic-facts` retains all current source polygon/material/pid groups; `inventory.json` lists every decoded primitive's exact triangle range and hash. Classification requires construction evidence, not a material or connected-component shortcut.
3. Resolve the exact 4,088 Body export triangle identities listed in `body-mapping.json.gz` / inventory, and establish per-plate presence/removal and LOD3 correspondence independent of ID survival. Bind those mappings before converting geometric first hits into structural exposure evidence.
4. Establish intended pane seating and acceptable overlap/exposure from authored construction. Saved ring cycles, source transforms, grid topology, 6 mm centre-curve offset and unsigned perimeter intervals are now measured; they do not supply a seat specification.

The next Blender admission can therefore be narrowly targeted to those listed source identities and author lineage. Repeating a broad decoder or density audit will not supply the missing semantic intent. Visual review, lit/glyph/readability review, procedural articulation/collision and runtime/performance remain separate gates.

## Checks, attempts and resource evidence

- Node analytical controls: 10 passing, including a real Meshopt binary round-trip, normalized accessors, ancestor/decode transforms, rejection of second decode, nonuniform/sheared transforms, saved-pose skinning, UV split connectivity and coincident panes, unrelated occluder first-hit identity, world areas/normals, effective quantizer precision, nondegenerate nearest surfaces, and deterministic 3/12/48 strata.
- Python controls: 6 passing, including transform false-pass rejection, inter-sample maxima, unknown-clearance refusal, stale semantic bindings, count/area separation and unrelated occluder classification.
- Pinned asset receipts retain all twelve fresh decoded counts, all twelve complete pane perimeters, source/evaluated geometry equality and source/export identity matches. Source hashes are checked before and after each Blender stage; copies are read-only. Stock validators were not rerun or rebranded as geometry acceptance.
- One source perimeter attempt failed its no-modifier assertion. The complete log, resource receipt and unchanged-byte/process-release seal remain under `source-glazing.json.*`. The corrected `source-glazing-v2` evaluates and verifies geometry before measuring. Earlier decoder rejection of skins and an overly strict float-equality analytical assertion are recorded in `failed-attempts.json`; neither was bypassed in the final controls.
- Preliminary ring matching at int16 storage precision failed and remains in the earlier receipts. The final effective-quantizer/source-topology bridge supersedes it. Early comparison duplicate metadata counted ambiguous vertices; v2/v3 correct that counter without merging them. Final glazing v2 excludes zero-area triangles; initial measurements are retained.
- Every measurement command and observed wall/RSS limit is recorded. Blender used `-b -t 2 --factory-startup --disable-autoexec`, thread environment 2, private TMP, an 8 GiB process-tree RSS ceiling, 45-minute stage ceiling, 6 GiB scratch ceiling and 12 GiB free-disk floor. Node used a 1 GiB JS heap limit within the admitted 2 GiB process RSS / 10-minute / 512 MiB output bounds. `SEAL.json` records final hashes, artifact manifests and process release. Resource receipts are execution bounds, not a performance qualification.

## Reproduction

Run from this directory, with `ASSET_ROOT` set to the pinned author checkout and `DEPS` to an existing tools `package.json` resolving glTF-Transform 4.5.1 / meshoptimizer 1.3.0. All source reads must retain the pins above. Use fresh output names; keep failures. `run_source.py` enforces the private-copy/read-only Blender workflow and must only be used under an active parent Blender admission.

```sh
node --test test_geometry.mjs
python3 -m unittest discover -s . -v
python3 bounded.py --receipt receipts/decode-resource.json --output-dir receipts -- node --max-old-space-size=1024 inspect.mjs "$ASSET_ROOT/packages/client/public/models/hulls/lark.glb" "$DEPS" receipts/decoded.json
python3 bounded.py --receipt receipts/glazing-resource.json --output-dir receipts -- node --max-old-space-size=1024 measure.mjs "$ASSET_ROOT/packages/client/public/models/hulls/lark.glb" "$DEPS" "$ASSET_ROOT/packages/tools/blender/hulls/lark-round5/fit-probe.json" receipts/glazing.json
python3 run_source.py --source "$ASSET_ROOT/assets/blend/hulls/lark.blend" --glb "$ASSET_ROOT/packages/client/public/models/hulls/lark.glb" --script inspect_source.py --output receipts/source-facts.json
python3 run_source.py --source "$ASSET_ROOT/assets/blend/hulls/lark.blend" --glb "$ASSET_ROOT/packages/client/public/models/hulls/lark.glb" --script measure_glazing.py --output receipts/source-glazing.json -- --spacing-m .001
python3 run_source.py --source "$ASSET_ROOT/assets/blend/hulls/lark.blend" --glb "$ASSET_ROOT/packages/client/public/models/hulls/lark.glb" --script source_body.py --output receipts/source-body.json.gz
```

`source_compare.mjs` takes GLB, dependency manifest, saved-source facts, decoded glazing receipt, source glazing receipt, output. It accepts plain or gzipped JSON inputs. `map_body.mjs` takes GLB, dependency manifest, gzipped Body source geometry, gzipped output. Use `bounded.py` for both. Run `survey.mjs` once per target scene, serially, under `bounded.py`; arguments are GLB, dependency manifest, scene name, output prefix. The per-scene resource receipts preserve the exact executed commands. `build_inventory.py` and `summarize_visibility.py` bind and classify the resulting identities without granting acceptance.
