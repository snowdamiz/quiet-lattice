# P1.E10.T06 — Ixari and Quavel

Current qualification is exclusively [reports/CURRENT.json](reports/CURRENT.json).
Accept only `PASS` and verify the three report hashes it names. Any other status
is unqualified. The original root `manifest.json`, `APPENDIX-C2.json` and
`SHA256SUMS` are preserved historical evidence for commit `2d23ecb3c`; they do
not qualify later source edits. Each new report set has an exclusive directory.

This is the complete CPU/source handoff: 33 assets, eight editable Blender files,
eight compressed GLBs, four saved LODs per asset, and retained CPU evidence.
GPU Review, performance qualification, blind visual grading, and city runtime
integration remain with the parent. CPU images are iteration evidence only.

## Authoritative inputs

The flat `assets/blend/cities/ixari_*.blend` files are authoritative. They contain
editable mesh parts, named vertex groups, packed PBR atlas maps, colliders,
interaction/light markers, and the metric reference collection. The stock
exporter consumes these saved files; it does not import the authoring scripts.

The scripts in `packages/tools/blender/cities/ixari/` retain the authoring and
refinement history. **Do not rerun `author.py` to export:** it records the initial
sculpt session and predates subsequent saved-source corrections. Edit the saved
meshes, regenerate their reduced LODs when necessary, and refresh their audits.

`manifest.json` contains every asset name, role, class, dimension, footprint,
triangle count, marker, route, source/export hash, and final CPU image.
`SHA256SUMS` provides the source/export/image digests directly.
`APPENDIX-C2.json` records full commands, results, interpretation decisions,
integration boundaries, and retained last-20-line failure tails. `attempts.jsonl`
and `receipts/` preserve the complete run history, including failed attempts.

Revision R1 removes the noncanonical box ribbons from the anchor, terminal and
board. Its replacement surfaces are Ixari fault colonies and tactile crystal
pressure facets, using violet/lilac and biolume cyan. They are decorative growth
and controls, not Cartographer writing. Complete canonical alphabet application,
2–4 cm V-cuts, stroke/orientation rules and exclusive network light remain with
E10.T08. The anchor's stone architecture is retained for that future application.

## Inventory

| File stem | Assets | Content |
| --- | ---: | --- |
| `ixari_low` | 4 | Low residences, variants 0–3 |
| `ixari_mid` | 4 | Mid residences, variants 0–3 |
| `ixari_tall` | 4 | Tall residences, variants 0–3 |
| `ixari_civic` | 7 | Plaza, market, skill house, Compact office, listening house, 36 m shipyard pad, 24 m salvage pad |
| `ixari_kit` | 6 | Gate, straight/corner walls, grown bridge, climbing street, bioluminescent light |
| `ixari_props` | 5 | Memory lectern, board, stall, seat, basin |
| `ixari_landmarks` | 2 | Hollow spire hall, four-turn climb and summit plaza |
| `ixari_anchor` | 1 | Quavel cleft-stone anchor |

## Verification and reuse

Run from the checkout root. The task-local `run_cpu.py` sets thread limits,
enforces one process group in this lane, bounds wall time/RSS/output, and reaps
processes before releasing its lock. Every run needs a new `--attempt` name;
receipt and render paths cannot be reused. The receipts contain exact commands
for stock export/validation, source and decoded-export audits, real consumer
tests, negative controls, and CPU previews.

The stock export command is `packages/tools/blender/export_cities.py` with
`--only ixari_low,ixari_mid,ixari_tall,ixari_civic,ixari_kit,ixari_props,ixari_landmarks,ixari_anchor`.
Invoke Blender through the supervisor with `-b -t 2 --factory-startup
--python-exit-code 1 -P`, followed by the script and its `--` arguments. The
task-local KTX adapter only caps threads; stock codec, quality and mip settings
remain authoritative. Dependency installation used the offline frozen lockfile;
the KTX executable and library source came from verified local objects.

Preserve metre scale and all four residence variants. T01 must reserve the
measured footprint, connect bridge and summit elevations, consume named markers,
and replace the current three-model city renderer path. The current Structures
consumer uses transformed AABBs: straight doorway routes pass, but curved and
sloping traversal requires T01 integration. The CPU geometry audits establish
actual support and clearance, not that legacy AABB traversal is suitable.

`GPU_HANDOFF.json` enumerates the future 399 capture files and proposed resource
bounds. Its payload is unexecuted and requires the parent's ready caller and
execution authorization. The CPU lane does not authorize GPU work.
