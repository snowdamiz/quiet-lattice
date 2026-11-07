Swift ROUND4 CPU/source lane

Scope: assets/blend/hulls/swift.blend, packages/client/public/models/hulls/swift.glb,
this tool directory, and assets/renders/hulls/swift-round4-current/ only.
The saved .blend is authoritative. Do not recover R3 over a revised source.
Export never imports the authoring scripts. CPU images are diagnostics, not an
engine grade or a whole-scene performance result.

Every invocation needs a new, unused attempt label. lane.py acquires its exclusive
lock before creating logs. It checks capacity, runs one process group, bounds wall,
RSS, log/output and image totals, and terminates/reaps the group before unlocking.
Thread environment values are 2; KTX jobs are serial. guardian.py independently
terminates the command group if the lane runner disappears. A hard loss of the
runner leaves a stale ownership lock for explicit verified recovery; never remove
that lock while its command group is alive.

A typical check (run from the worktree root):
python3 packages/tools/blender/hulls/swift-round4/lane.py --label UNIQUE --timeout 180 --rss-mib 10000 -- /Applications/Blender.app/Contents/MacOS/Blender -b -t 2 --factory-startup --python-exit-code 1 -P packages/tools/blender/hulls/swift-round4/audit_source.py

Use the same wrapper for display_fit.py (120s), export_saved.py (3000s), and
identity.py (300s; after -- pass the candidate GLB path). The stock exporter writes
only inside its attempt directory, validates source and export, and pins the source
hash. Its only local bake adaptation releases decoded caches of already-packed
images; check_packed_release.py proves exact float texel identity after reload.

promote.py takes export, identity, source-audit, and display-fit attempt names.
It requires PASS and matching current source hashes from all four, a matching
candidate GLB hash and stock validation reports. It copies only that GLB into the
canonical path. A failed attempt cannot overwrite a previous passing receipt or
promote a stale export.

preview.py creates one compact CPU image from source or the specified GLB.
cpu_sheets.py invokes the stock turntable/material-sheet logic with the entire GPU
discovery block removed in memory. It does not edit the shared tool. Use samples 12
and scale .6. Temporary composition tiles are deleted by the stock composer;
finished or earlier evidence screenshots are never removed by this lane.

Source history: author.py is a one-time operation requiring the exact recovered R3
SHA. fracture_cleanup.py, finish_slate.py, fit_markers.py and face_display_insets.py
record the subsequent source corrections. They are not export dependencies. The
current saved source already contains these changes; do not run them again.

Evidence interpretation: attempt names are labels, not verdicts. Read each JSON
status, input SHA and command exit. In particular 03 produced a rejected LOD budget,
17 and 19 failed display fit, 16/20 were cancelled for source corrections, 23 hit a
monitor race, and 27 was interrupted. 28 intentionally kills the runner to prove
orphan cleanup; 29 repeats cancellation and exclusive-ownership checks. Preserve
all these records. The R3 packet is read in place and remains byte-identical.

finalize.py writes Appendix C.2 and an inventory after validation and visual
inspection. handoff.json supplies the human observations and remaining parent
engine work. It preserves all images and interrupted Cycles tile buffers under the explicit
cleanup hold, recording their hashes and sizes after process-group-empty proof. The final HEAD/tree belong in the
accompanying handoff because a commit cannot contain its own hash.

Continuation findings: 33 encoded all 59 textures but failed at tsx IPC socket
creation (overlong TMPDIR); 34 proves the short alias fix, 35 proves cleanup on
runner loss. The alias points into the owned evidence scratch and is removed only
after process-group cleanup. 36/37 expose duplicate lower-LOD faces; 38 removes
only duplicates from the source, with unique triangle coverage unchanged. 39/40
are the refreshed source/fit checks. Export now preserves an encoded intermediate
before geometry compression, explicitly not validated or eligible for promotion.

Material finish: 41 exposed five nearly uniform normal maps despite procedural
source graphs. 42 records the insufficient first fine-etch bake. 43 authors and
packs five actual 4k maps, retains the editable procedural detail nodes, and checks
actual UV samples after stock UASTC compression before saving the source. 44/45
refresh source/fit checks; 46 is the inspected pre-canopy-correction cockpit close-up (LOD0 geometry unchanged).

Bounded split export: 47 finished all source bakes and serialized the complete
80.6 MB GLB, then reached the 10000 MiB RSS cap as KTX overlapped Blender memory.
The group was reaped and canonical GLB unchanged. 48 resumes only that exact
SHA-pinned current-source intermediate using stock KTX/meshopt in plain Python.
finish_export.py validate runs stock source/export checks in a fresh factory
Blender process; no failed or rejected asset is imported into source.

For a new saved-source export, run serialize_saved.py in factory Blender under
lane.py (3000s), then finish_export.py compress SERIALIZATION_ATTEMPT using plain
Python (1500s), then finish_export.py validate COMPRESSION_ATTEMPT in fresh factory
Blender (600s). Each stage needs a new lane label and fresh capacity admission.
The serialization stage requires four authored LODs; stock _make_lods therefore
has no geometry to generate. The former monolithic export_saved.py is retained
for historical commands, but the split path avoids its retained-memory overlap.

Actual source/export identity, beyond the stock PASS: 50 detected collapsed
position/UV triangles after default quantization; 52 also rejects a 16-bit grid.
56 uses compress_precision.mjs: float positions and UVs, 16-bit normalized normal
attributes and lossless meshopt streams. Both compression extensions are required
and actual accessor types are checked. 57 passes the unchanged identity gate with
zero collapsed triangles/UVs, zero position drift and every marker preserved.
58 is the refreshed unmodified stock source/export validation for that candidate.
This is Swift-only export precision, not source simplification or a shared-rule edit.
The split finish_export.py uses this precision policy for future saved-source runs.
The direct refine_compression.py command records the final equivalent run on the
already-completed KTX stage; no repeated bake was necessary.

53/55 preserve failures from glTF-Transform's normal-only extension detection
omission. The scoped codec explicitly declares the extension required by its real
normal accessors. 54 records a missing-candidate check started before inspecting
53's failure; no model was promoted. Every later stage checks upstream completion.

Cross-LOD world transforms: the 61/62 rear comparison exposed a canopy offset
that local-mesh identity could not catch. 64 finds nine missing parent inverses
on the authored lower-LOD canopy copies. 65 fixes only those inverses in source,
proves every mesh/packed image and all other world transforms unchanged, and
archives the preceding source. author.py now preserves parent inverses when
copying hierarchy; audit_source.py checks protected world transforms as well as
local vertices, faces and corner normals. 66/67 refresh audit/display fit. 68
regenerates serialization with the full stock source bake; none of the earlier
candidates is promoted after this source change. Old preview bytes are retained.

69 uses finish_export.py compress-cache 68-corrected-source-serialization: all
59 freshly baked PNG byte streams and material/texture bindings exactly match
those behind the completed KTX stage in 48. texture_cache.py reuses only those
encodings, proves every fresh non-image buffer and node unchanged, and refuses
any cache mismatch. It never imports cached geometry into source. The fresh
serialized hierarchy includes the corrected canopy inverses. Normal compress
mode remains available for a new bake whose pixels differ.

Final artifact chain: 70 stock source/export validation, 71 actual decoded
source/export identity, 66 source topology/UV/normal/world-transform audit, and
67 runtime-dimension display fit all refer to source7627b0c3 and GLB5873c5ca.
72 plus 74–83 contain inspected final CPU diagnostics. Stage72 was never rerun.
73 preserves the parent resource hold; only the explicit 09:34:21Z Swift release
allowed new CPU admissions. 84 atomically promotes the validated candidate;
85 reconfirms recovery and R3 packet integrity. 86 contains Appendix C.2 and
its complete hash inventory. No further Blender/codec work remains in this lane.
The finalizer excludes its own attempt to avoid a self-referential inventory;
its launch, terminal receipt, guardian receipt and log are preserved alongside it.

All 31 retained CPU scene images were viewed. Three texture-probe PNGs and two
old interrupted internal EXR tile buffers are separately counted and preserved;
no screenshot cleanup was performed. Parent engine captures, temporal LOD
transitions, full smoke, whole-scene performance and a fresh blind grade remain
required. CPU images and a clean source/export validation are not those gates.
