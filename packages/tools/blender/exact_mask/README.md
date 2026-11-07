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

## Deferred real boundary (requires parent resource assignment)

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

No native/consumer PASS exists until this launcher actually succeeds. Existing
`meshopt.test.ts`, Blender pipeline selftests, material-mask regressions,
independent review and parent integration remain separate gates. KTX2/baking,
full production-class geometry, skinned/morph export and visual equivalence are
outside the tiny fixture; the existing pipeline regressions cover those paths.

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
