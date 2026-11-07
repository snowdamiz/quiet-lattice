TASK: P1.E12.T02 — Lark density correction (CPU private candidate)

STATUS: READY FOR PARENT (canonical promote still HELD; private stock gates PASS; min_median ≥512)

SUMMARY: Unique-paint shrink under one stock 4096 atlas reached measured min median **618.8 px/m** (was 347.7 on rejected force-fit v11). Layout `shrink512-v12j` packs all three states at true 512 px/m (`force_fit_scale=1.0`) via near-palette snap (Δ≤0.20), Cockpit share, finish merges, and area-preserving strip reshape of oversized finish squares (husked Dark 2784² left only 1312 px free for Trim 1314). Private apply/transfer/LOD-UV/promote-UV and stock export+validate all passed. Canonical blend/glb hashes unchanged. No GPU, shared exporter, meshopt, families, or library edits.

FILES CHANGED:
* `packages/tools/blender/hulls/lark-round3/density_layout_shrink512.py` — shrink layout with strip reshape.
* `packages/tools/blender/hulls/lark-round3/density_private_apply.py` / `density_private_transfer.py` — LAYOUT_ID → v12j.
* `assets/renders/hulls/lark-round3-current/density-20261107/` — receipts, private candidate, status.

VERIFY:
* Layout `20261107T141425710088Z-layout-shrink512-v12j`: `layout_fits=true`; all three states FAILED 0; achieved 512.0.
* Density measure `20261107T142340151034Z-private-density-v12j`: min_median=618.8, median_of_medians=2484.5, atlas=4096; worst role `lark_damaged_LOD0/Body_dmg/Accent`.
* Private stock export `20261107T142359128282Z-private-export-v12j`: exit 0; RESULT PASS 5/5 (naming, tris, LODs, materials, scale) for blend and glb.
* Canonical SHA-256 unchanged: blend `bc08c784ef37413cd3b51c593c4109a340a8d99edc15f5da30e3dcfaba04ff75`; glb `7f11e2bd2818045c1a861d4e959f2a985828bdcc9b60d44ed2fda8ff41300bad`.
* Private GLB `e377daea38886af8065006bb5c53fb8e43211a9b55f44681018cf294ad7159e7` (13792612 bytes); private blend `68a327711238d437666fb5f76f04f8f4d519c67e44e820c0d7b3199097e825e1` (35650695 bytes).
* Bounds: Blender `-t 2`, thread env 2, codec 1, RSS≤8192 MiB, growth≤6 GiB, wall≤2700 s, fauna reserve 0, Node 22.23.3 short TMPDIR; cleanup STOPPED; no push/PR/merge/Trunk.

DECISIONS:
* Force-fit (~347.7) and multi-atlas/UDIM remain REJECTED per parent; this candidate is true-512 chart packing + unique shrink, not force-fit promote.
* Husked packer residual Trim 1314 was an L-strip geometry issue after placing Dark as a square; strip reshape preserves a_max·512² texels.
* Canonical promote remains HELD for parent source/visual review.

OUT OF SCOPE FOUND: Parent owns canonical promotion, GPU/visual review, gameplay/performance, other hulls. Shared exporter/meshopt/families/library untouched.

ARTIFACTS:
* `assets/renders/hulls/lark-round3-current/density-20261107/DENSITY-PROGRESS-CHECKPOINT.md`
* `assets/renders/hulls/lark-round3-current/density-20261107/20261107T142625991187Z-DENSITY-STATUS.json`
* `assets/renders/hulls/lark-round3-current/density-20261107/private-candidate/lark.blend`
* `assets/renders/hulls/lark-round3-current/density-20261107/private-candidate/hulls/lark.glb`
* Layout `20261107T141425710088Z-layout-shrink512-v12j-layout.json` (+ `.npz`)
* Export report dir `20261107T142359128282Z-private-export-v12j-private-export/`
