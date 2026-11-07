# C2 — SOURCE/CPU PASS

Pinned HEAD 8b6c3604bb842019c899956a1b57d6a01385d6f3, tree 765b8b28265d0da6af0a16a568c33a365178d748. On-disk asset hashes and sizes match the brief. Prior asset verified against its Git LFS oid.

Independent density: blend UVMap 590.645927493 px/m; MeshoptDecoder GLB normalized accessor elements 590.640337088 px/m. 139 render primitives have TEXCOORD_0 only. Blend UV exceptions are five collision meshes, not render meshes. One 4096 atlas layout per state/map channel; no extra UV atlas set. force_fit_scale=1.0 is documented in committed task scripts, not stored as a blend custom property.

Stock validate independently rerun: PASS 5/5 on each asset. Initial GLB attempt lacked KTX; retry supplied the existing KTX binary and passed. Stock Python sources match committed blobs.

Husk albedo is wired to the husked atlas and has zero purple-classified pixels; packed emissive contains 575 near-#9FE8DA pixels. Damaged Glass has zero white-classified pixels. Base albedo and ORM decoded float pixels are exactly identical to prior promote despite changed PNG packed hashes. Normal map changes are intentional task-local microdetail. These are CPU facts, not a visual grade.

LOD2 totals base/damaged/husked: 21406/22368/22546, approximately 20% of LOD0. LOD3: 3.49%/3.50%/3.88%, below 5%. Body LOD2 boundary-edge fractions improve from .427/.503/.587 to .315/.328/.302; no >2-face nonmanifold edges. Open plate geometry prevents interpreting boundary counts alone as holes; visual silhouette confirmation remains required.

BAY_1 exists as an empty in blend at (0,.027865,-1.317500), exported at (0,-1.317500,-.027865). Canopy variants move from (0,-.465000,2.095527) to (0,-1.120094,1.804318), exported with Blender-to-glTF axis conversion. Full matrices retained in marker receipt. CPU verifies aft relocation, not animated clearance.

Commit diff is confined to Lark assets, render receipts, and task-local scripts. Shared exporters, meshopt, validate.py, and families.json are untouched.

All Blender calls used -b -t 2, private TMPDIR, and monitored 8 GiB RSS / 12 GiB free-floor guards. Peak sampled RSS 2,795,824 KiB. No author assets were written; no GPU capture, grade, push, PR, merge, or Trunk action occurred. Prior scratch preserved; new temporary intermediates removed.

Visual/GPU recapture and blind grade remain parent-owned. This PASS does not authorize merging or Trunk.
