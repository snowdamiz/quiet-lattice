# P1.E14.T16 exact RGBA regression

The production adapter surrounds the synchronous stock `_write` call only for
`colorMask` families with effective `geometry.quantize=false` (creatures/flora).
It changes the extracted `COLOR_0` descriptor before Blender 5.2's UINT16 packing,
leaves the mapped Float32 array intact, and restores the packer in `finally`.
Other attributes and families use their original writer. Stock exported-geometry
validation checks the actual accessor, rather than the imported Blender type.
It rejects integer, normalized, RGB-only and absent masks on every render
primitive; compression opt-outs and legacy names do not waive this contract.

The installed `gather_attributes_change` hook precedes colour extraction, and
`gather_attribute_change` follows the lossy conversion. Neither supports this
correction. No installed Blender code or preferences are changed. The adapter
rejects an unfamiliar/non-Float32 boundary instead of casting rounded values.

## CPU checks (authorized source phase)

```sh
/Applications/Blender.app/Contents/Resources/5.2/python/bin/python3.13 -B \
  packages/tools/blender/exact_mask/cpu_test.py \
  --backend /Applications/Blender.app/Contents/Resources/5.2/scripts/addons_core/io_scene_gltf2
```

This uses Blender's bundled **Python interpreter**, NumPy and installed pure
Python accessor packer; it never starts Blender or loads a codec. Add `--baseline`
to reproduce the original `5123 != 5126` failure. The add-on registration entry
point is skipped; Accessor, BinaryData and packing code are real installed modules.
These tests prove packing, restoration, family scope and JSON format validation.
They do not prove source mesh extraction, material/loop mapping or compression.

The fixture's Node resolver has a separate pure CPU import regression:

```sh
EXACT_MASK_DEPS=/absolute/existing/dependency-checkout \
  /absolute/pinned/node packages/tools/blender/exact_mask/dependencies.test.mjs
```

This imports the actual shared `sites.ts` module that contains parameter
properties. Node 26.12.1 cannot execute those in strip-only mode. The resolver
transpiles TypeScript in memory with the explicitly selected checkout's installed
compiler; it writes no compiled files or dependency cache. The test does not load
the consumer, Blender or meshopt. An optional positional loader path lets the
same test demonstrate the old resolver's failure.

## Real boundary (requires parent resource assignment)

```sh
EXACT_MASK_NODE=/absolute/pinned/node \
EXACT_MASK_DEPS=/absolute/existing/dependency-checkout \
  bash packages/tools/blender/exact_mask/run_boundary.sh /tmp/new-exclusive-e14t16-boundary
```

The script stops on the first failure and keeps all output. It does not install,
retry, download, modify dependency directories, or regenerate project assets.
The dependency resolver uses the task checkout's source and an explicit existing
checkout's dependencies without creating `node_modules` links. Run serially in
the assigned lane (Blender at two threads, NumPy at one), with <=256 MiB scratch.
Snapshot dependency/ignored state before and after execution, as for CPU checks.
The shell script does not own supervision: the parent must supply an independent
bounded supervisor before dispatch and hold the lane until all children are
proven terminated. A failed native attempt requires a new capacity assignment.

`fixture.py export` saves and reopens a small real `.blend`, records every saved
Float32 triangle corner, then retains the unadapted raw RED and runs stock
`export_one` for creatures, flora and a quantizing props control. The fixture has
POINT and CORNER colour variants, four handmade LODs each (160/64/16/4 triangles),
UV/material splits, two materials per variant, different AO alpha, rig attributes
and marker transforms. It uses the existing `flora` class override and exempt
Glass profiles; no budgets are relaxed and no baking/textures are needed.

`consumer.mjs` runs the actual stock `compressGeometry`, actual client
`Engine.gltfLoader()` with its MeshoptDecoder, and `maskColors`/`recolor`. For both
exact families it compares oriented triangle multisets including all RGBA bits,
positions, UVs, normals and rig attributes against the reopened source, before
and after compression. It checks marker transforms, material definitions and
separate variant material instances. An alpha=1 control must change consumer
output. Props retains its ordinary UINT16 raw colours and quantizing compression.
`fixture.py validate` then invokes stock validation on all three compressed GLBs.
Format negatives also invoke stock `checks.geometry` (UINT8/UINT16, normalized
Float32, RGB-only); CPU tests additionally cover missing accessors and every LOD.

Native/consumer qualification requires this launcher to succeed. Existing
`meshopt.test.ts`, Blender pipeline selftests, material-mask regressions,
independent review and parent integration remain separate gates. KTX2/baking,
full production-class geometry, skinned/morph export and visual equivalence are
outside the tiny fixture; the existing pipeline regressions cover those paths.

The first admitted attempt at source `75cf76f` completed the saved-source exports
and five format negatives for both exact families, then failed at Node's
parameter-property import before compression or GLTFLoader ran. Read-only raw
GLB analysis matched each exact family's 488 triangles (5,856 RGBA channel values)
to the reopened source across both variants, four LODs and two materials. Props
and the unadapted RED retained normalized UINT16. The resolver correction passed
the pure CPU regression above; this attempt did not reach the actual consumer.
See `native-attempt1.json` for the retained evidence and resource-release record.

The second separately admitted attempt at `2156fe6` passed the full tiny boundary:
four serial stock meshopt encodes, actual `Engine.gltfLoader()` decoding, exact
source triangle comparisons for creatures/flora before and after compression,
`maskColors`/`recolor` and alpha controls, material/marker preservation, quantizing
props and compressed stock validation. The unadapted compressed RED still failed
the Float32 assertion as expected. The slot and all children were released.
Fifteen packer/format tests, the resolver regression and sixteen existing exporter
target tests also passed without another Blender or codec invocation. This proves
the tiny boundary; broader native regressions, independent review and parent
integration remain pending. See `native-attempt2.json` for the pin and evidence.

## Retained asset adoption

Read-only header audit at the source checkpoint:

- E08.T08 `f9294a466d6223f695f102dc1a13ed526f155e67`: all five creature files
  (`biped`, `flyer`, `quad_grazer`, `quad_heavy`, `quad_small`) use normalized
  UINT16/VEC4 across 136 primitives/LOD selections. Their owner must re-export
  after separate capacity admission. The two constructs have no colour mask and
  remain on their ordinary quantizing family path.
- E14.T04 `70f8a164614ad9cf370e448a081603bfc4fa1cf4`: `tree_blob_t04`,
  `tree_cactus_t04`, `tree_conifer_t04`, `tree_coral_t04`, `tree_mushroom_t04`,
  `tree_palm_t04`, `tree_round_t04`, `tree_spiral_t04` already contain Float32/VEC4
  (76 primitive/LOD selections). Their owner uses temporary source-float carriers
  and `promote_masks.mjs`. Header compatibility is not a new source-value proof.
- E14.T05 `a46e7c4d444befd6efe6e06b9134b3a41abcb639`: `non_tree_foliage`,
  `non_tree_resources`, `non_tree_stone` already contain Float32/VEC4 (124
  primitive/LOD selections), restored by task-local `write_exact`. Its two-argument
  `_write` wrapper remains compatible. Owners can assess retiring these local
  carriers only after adopting and validating the shared route.
- T06 resource formations and future creature/flora exports inherit this contract;
  no retained T06 artifact was identified in this checkpoint's candidate inventory.
  Legacy `flora.glb`/`creatures.glb` are also subject to exact accessor validation;
  compression exemptions are unchanged. Other families' contracts are unchanged.

No candidate, asset, historical receipt, material-validation rule from 515ba1f,
manifest, plan, or parent checkout is modified by this patch.

## Remaining pipeline regressions

Sealed SOURCE/CPU C2/C4 at `e11acd393` / tree `3ffe09045`. Tiny boundary and the
15/16 CPU suites are reused by hash (`native-attempt2.json`). Light non-codec
rechecks are recorded in `regression-prep.json`.

One proposed serial native unit (parent admission required; Lark owns heavy CPU):

1. `modelLibrary.test.js` (6) against the three committed fixtures (8,700 bytes)
2. `meshopt.test.ts` (4) including `compressGeometry` encode

Pinned Node `v26.12.1`, DEPS `t3-909360ab`, vitest from that checkout via
`NODE_PATH` (client+tools+root). No task `node_modules`, installs or cache
writes. Independent guardian before dispatch; stop on first failure.

Follow-on Blender units (separate grants): `material_mask_selftest.py` with T05
flora read-only inputs and exclusive `--report-dir`; `selftest.py` and
`turntable_selftest.py` with `-t 2`, exclusive `TMPDIR`, `--keep`, and an
existing `KTX` binary (no downloads). Production creature re-export remains
owner-owned after integration.

