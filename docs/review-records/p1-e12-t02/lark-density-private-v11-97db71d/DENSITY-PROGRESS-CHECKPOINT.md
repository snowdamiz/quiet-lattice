# Lark density correction progress

Status: **private v11 single-4096 candidate stock-valid; canonical unchanged; parent review for promote**.

## Assets (byte-identical to RED / prior CPU unit)

| Asset | Bytes | SHA256 |
|---|---:|---|
| `assets/blend/hulls/lark.blend` | 65357176 | `bc08c784ef37413cd3b51c593c4109a340a8d99edc15f5da30e3dcfaba04ff75` |
| `packages/client/public/models/hulls/lark.glb` | 25633924 | `7f11e2bd2818045c1a861d4e959f2a985828bdcc9b60d44ed2fda8ff41300bad` |

HEAD: `a89dd7f8a2d9375ed5df94f77e6c83d972f42f73`

## Proven this continuation

1. Layout v11 force-fits all states into **one 4096** page (scales base 0.557 / damaged 0.481 / husked 0.614 → layout targets ~285 / ~246 / ~314 px/m).
2. Private apply + map transfer (all three states) + LOD UV transfer completed; canonical untouched.
3. Private density measure (4096): min median **347.7** px/m, median-of-medians **1033.6** (≫ ~35 RED; below art-bible 512 under stock single-atlas rule).
4. First private export failed glTF naming: Dark duplicated on skinned vs rigid meshes when two UV layers present. Promote UVDensity→single UVMap fixed it.
5. Private stock export+validate **PASS 5/5**. Private GLB `be929af4a1fb3c3f45324f1960dc9b88617453affb0627e760661b1448214604` (25104364 bytes) under `private-candidate/` only.

## Binding constraint (unchanged)

Physical 512 px/m for unique paint needs ~3–4 pages. Stock allows one ≤4096 image per map slot. UDIM multi-page incompatible with hull material contract.

## Parent decision

1. Accept force-fit (~250–350 px/m) and authorize canonical promote of private candidate; or
2. Continue unique/scorch localization toward true 512 in one 4096; or
3. Contract waiver for multi-atlas heroes.

Cleanup STOPPED. No GPU. No shared exporter/library edits. Source/visual/GPU closure: parent.

Status receipt: `20261107T135157817706Z-DENSITY-STATUS.json`
