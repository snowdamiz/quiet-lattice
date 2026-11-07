TASK: P1.E12.T02 — Lark density correction (CPU private candidate)

STATUS: BLOCKED (canonical promote held for parent; private stock gates PASS)

SUMMARY: Built a private single-4096 force-fit density candidate from the unchanged RED canonical Lark source. Layout v11 packs all three states into one stock-legal 4096 atlas (~246–314 px/m layout targets). Private apply/transfer/LOD-UV/promote-UV and stock export+validate all passed. Measured private LOD0 min median density is 347.7 px/m (≫ ~35 RED, below art-bible 512 under the stock one-atlas rule). Canonical blend/glb hashes are unchanged. No GPU, shared exporter, meshopt, families, or library edits.

FILES CHANGED:
* `packages/tools/blender/hulls/lark-round3/density_*.py` — density lane tools (layout, private apply/transfer/export, guardian/run).
* `assets/renders/hulls/lark-round3-current/density-20261107/` — receipts, private candidate, status/checkpoint.

VERIFY:
* Private stock export `20261107T134751892541Z-private-export-v11b`: exit 0; RESULT PASS 5/5 (naming, tris, LODs, materials, scale).
* Canonical SHA-256 unchanged: blend `bc08c784ef37413cd3b51c593c4109a340a8d99edc15f5da30e3dcfaba04ff75`; glb `7f11e2bd2818045c1a861d4e959f2a985828bdcc9b60d44ed2fda8ff41300bad`.
* Private GLB `be929af4a1fb3c3f45324f1960dc9b88617453affb0627e760661b1448214604` (25104364 bytes); private blend `aac0c049b3f37a0b8945d93f6b81819d07814389af5ab095e1a6be5eb8e1dfd6` (53578274 bytes).
* Density measure `20261107T134209207914Z-private-density-v11`: min_median=347.7, median_of_medians=1033.6, atlas=4096.
* Bounds: Blender `-t 2`, thread env 2, codec 1, RSS≤8192 MiB, growth≤6 GiB, wall≤2700 s, fauna reserve 0, Node 22.23.3 short TMPDIR; cleanup STOPPED.

DECISIONS:
* 512 px/m vs stock hero max 4096 → force-fit v10 charts into one 4096 rather than UDIM/multi-page → UDIM failed naming/engine_name/tri/uniform; force-fit remains stock-legal and ≫ RED density.
* Multi-UV Dark engine_name collision on skinned meshes → collapse UVDensity onto single UVMap before export → matches canonical one-TEXCOORD contract; stock naming PASS.
* Canonical promote → hold for parent (accept force-fit vs further unique-paint shrink vs multi-atlas waiver).

OUT OF SCOPE FOUND: Parent owns source/visual/GPU review, canonical promotion, gameplay/performance, other hulls. Shared exporter/meshopt/families/library untouched.

ARTIFACTS:
* `assets/renders/hulls/lark-round3-current/density-20261107/DENSITY-PROGRESS-CHECKPOINT.md`
* `assets/renders/hulls/lark-round3-current/density-20261107/*-DENSITY-STATUS.json` (latest)
* `assets/renders/hulls/lark-round3-current/density-20261107/private-candidate/lark.blend`
* `assets/renders/hulls/lark-round3-current/density-20261107/private-candidate/hulls/lark.glb`
* Layout `20261107T133652436368Z-layout-preflight-v11-single4096-layout.json`
* Export report dir `20261107T134751892541Z-private-export-v11b-private-export/`
