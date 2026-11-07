# P1.E08.T08 CPU source unit

Start with [C2-report.txt](C2-report.txt). The seven saved `.blend` files are the
editable deliverable. Stock export reads those files; it never runs `author.py`.
No runtime, exporter, validator, library, or orchestration file was changed.

The CPU checks cover 38 selectable variants and 152 saved/exported LODs. The
consumer test loads the compressed files with the actual Three GLTFLoader and
Meshopt decoder, then exercises stock Review selection and mask look. KTX image
metadata is proxied in that test to avoid WebGL; stock validation separately
transcodes the real textures. No native visual or performance result is implied.

The open acceptance discrepancy is documented in
[reports/export-mask-limit.json](reports/export-mask-limit.json): pinned Blender
exports four-channel colors as normalized uint16 even from float source masks.
The test measures this rounding bound; it does not treat it as exact float
preservation. The parent/exporter owner must resolve the brief's stricter wording.

## Evidence

- [Asset hashes and resources](reports/asset-hash-inventory.json)
- [Saved-source contract](reports/source-contract.json)
- [Decoded consumer contract](reports/consumer-contract.json)
- [Remaining native inventory](reports/native-pending.json)
- `reports/validate-final/`: fourteen current stock source/export results
- `reports/export-final/`: stock export results
- `reports/*.log` and stage JSONs: commands, failures, process samples, exit/reap evidence
- `reports/history/`: prior sources, exports, and the preserved incidental bytecode archive

## Authorship and reproduction

`author.py` records the anatomical sections, joint rings, mask regions, packed
paint atlas, and machine panels used in the saved meshes. Parts remain editable
vertex groups. This script replaces a source and is not a routine verification
command. Its last argument is a single stem, for example `-- quad_heavy`.

`save_lods.py` creates the saved lower LODs with stock `artlib.lods.generate`, then
removes duplicate collapsed faces while proving point data unchanged.
`snap_lod_attributes.py` subsequently restores only sub-1e-5 floating-point drift
in discrete limb IDs and pose joints; all geometry and LOD0 stay unchanged.
Those are authoring operations and must run before a fresh source audit/export.
The one-time library-link and portable-path repair scripts remain as history;
the current authoring script already writes persistent relative library links.

Run commands through `stage.py <unique-stage-name> <command...>` only after CPU
admission. It admits one lane, samples owned descendants across process groups,
enforces the task budgets, and refuses to overwrite a stage log. `bin/blender`
forces `-t 2`; `bin/ktx` serializes the pinned local codec and forces one encode
thread. It does not alter encoder quality or format options. The pinned tool
paths and dependency symlinks are recorded in the hash inventory; no installation
is performed.

The exact successful stock commands and all failure tails are in C.2. The focused
consumer command is:

```sh
python3 packages/tools/blender/e08t08/stage.py consumer-new \
  node node_modules/vitest/vitest.mjs run \
  --config packages/tools/blender/e08t08/vitest.config.mjs
```

`preview.py` is a compact CPU-only look check. Its preserved revisions are not a
native grader packet. Do not run capture, turntable, or live performance from this
unit; the exact parent-owned inventory is listed separately.
