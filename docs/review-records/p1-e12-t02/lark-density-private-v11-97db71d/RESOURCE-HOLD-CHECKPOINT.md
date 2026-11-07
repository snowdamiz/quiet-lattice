# Lark R3 density correction: resource-hold checkpoint

Recorded 2026-11-07T09:12:37Z. **Task incomplete; source REVISE remains open.** This is a scheduling checkpoint, not an Appendix C.2 completion packet or a visual grade.

## Parent coordination and terminal evidence

The parent requested that the active bounded stage finish, then prohibited new Blender, codec, bake, render, build, and full-suite admissions pending explicit release for the T13 controlled native comparison. No active process was interrupted for this request. No T13 process was launched here. Screenshot cleanup remains stopped.

The active stage was `layout-preflight-v3-authoring`. Its supervisor PID was 171 and Blender/process-group ID was 183. It terminated naturally with exit 1 after **223.624 seconds**, against a 600-second bound. The failure was `Physical 512 px/m layout did not fit; source untouched, no bake started.` Peak sampled owned RSS was **1,336,544 KiB**, codec count zero. The watchdog records no termination reason and `remaining_members: []`. A fresh process inventory at 09:12:37Z also found no owned processes.

Receipts, preserved without overwrite:

- `20261107T085919532465Z-layout-preflight-v3-authoring.json`
- `20261107T085919532465Z-layout-preflight-v3-authoring.log`
- `20261107T085919532465Z-layout-preflight-v3-authoring.watchdog.json`
- `20261107T085919532465Z-layout-preflight-v3-authoring.input-0.py`
- `resource-controls/current-stage-terminal-quiesced.json`
- `resource-controls/20261107T090152129629Z-hold.json`
- `resource-controls/hold-enforcement-verified.json`

The light admission-guard correction distinguishes append-only timestamped hold/release directives from other process evidence. Previously, sorting all JSON files could select the terminal proof, which has no `state` field. A real invocation of the corrected runner returned **125**, `child_started: false`, before acquiring the lane or launching a child:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 packages/tools/blender/hulls/lark-round3/density_run.py --seconds 5 --rss-mib 64 --growth-mib 1 parent-hold-negative-control -- -P packages/tools/blender/hulls/lark-round3/density_layout.py
```

Its exclusive receipt is `20261107T091237777100Z-parent-hold-negative-control.admission-denied.json`. No new heavy job has been admitted after the hold. The runner also now counts positive canonical-output/replacement-save growth in its disk monitor and samples short Node processes every 0.1 seconds. Those monitor changes have passed syntax parsing only; their runtime/resource behavior has not been exercised while held.

## Saved artifacts and provenance

Worktree: `/Users/andreyyurlov/.t3/worktrees/space/t3-46f90470`, branch `task/P1-E12-T02-lark-r3`.

HEAD remains `a89dd7f8a2d9375ed5df94f77e6c83d972f42f73`; committed tree remains `2354e2c110975902183ccde1103fc78495f9bf83`. All density work remains uncommitted in the task-owned tools and this exclusive evidence directory. There is no completed density-revision commit yet.

Both canonical artifacts were freshly hashed after the terminal receipt and guard check. They match the source-review RED inputs exactly:

| Artifact | Bytes | SHA256 |
|---|---:|---|
| `assets/blend/hulls/lark.blend` | 65,357,176 | `bc08c784ef37413cd3b51c593c4109a340a8d99edc15f5da30e3dcfaba04ff75` |
| `packages/client/public/models/hulls/lark.glb` | 25,633,924 | `7f11e2bd2818045c1a861d4e959f2a985828bdcc9b60d44ed2fda8ff41300bad` |

Thus the original 17 packed maps, geometry, LODs, rigs, colliders, markers, liveries and export are still unchanged. No new source save, bake or export has occurred in this density correction. The earlier source review's approximately 35 px/m finding remains applicable.

The original R3 pre-bake paint controls were recovered read-only from already-local LFS object `f73327b3755418a816f18738b94345b68766d92416582e794af90fee5ba5d690` (17,638,521 bytes), verified against the retained authoring/bake provenance. `original-paint-controls.json` and `.npz` retain the correspondence. This was data extraction into evidence; no original geometry was restored and `author.py` was not run.

## What the completed layout experiment establishes

Each chart was assigned a nominal area-based target of 512 px/m. This is **not** a measurement of the final saved source or consumer, and does not establish 512 in both tangent directions. The base fit mentioned in the early terminal proof is only the candidate packer's rectangle result. It is not a source/visual PASS or verified paint-sharing equivalence.

| State | Physical area m² | Kept-unique candidate area m² | Rectangular demand incl. padding, pixels | Failed pack items |
|---|---:|---:|---:|---:|
| Base | 553.736 | 117.076 | 52,721,777 | 0 |
| Damaged | 645.380 | 241.085 | 88,950,656 | 1,273 |
| Husked | 665.230 | 226.113 | 88,305,791 | 2,502 |

Four 4096² pages provide 67,108,864 pixels before packing loss. The candidate preserves marked roughness/metallic regions, cockpit detail and sampled husk glyphs as unique islands. Its proposed sharing of unmarked finish regions has **not** proved compatibility of the full authored colour, every livery, normal and AO fields. It must not be promoted directly into the saved source. Damaged and husked also exceed the current rectangular allocation. These results do not prove that every possible legitimate outline/trim/template allocation is impossible.

The next useful investigation is a measured compatibility budget for physical-size templates and localized registered damage regions, including full colour/ORM/livery correspondence and geometry-dependent normal/AO constraints. Any overlapping damage projection must preserve physical placement and continuous scale, and must not transfer scorch to another location. It remains a hypothesis, not implemented or validated. No density threshold, object scale, UV padding or hidden-surface exemption has been changed to turn this failure green.

## Remaining authorized work after explicit parent release

1. Recheck live disk and cohort RSS before each heavy admission; do not reuse earlier free-space readings.
2. Establish a feasible, compatible UV/material allocation at the actual density target and within four PBR body draws, 4K maps, and per-variant memory budgets. Preserve localized paint/damage. Outline packing and legitimate template reuse remain options; raw rectangle demand is not an impossibility proof.
3. Apply the feasible layout to the saved source, transfer its authored fields, and bake actual LOD0-derived maps on CPU with non-overlapping receivers. Preserve the original maps and all prior receipts as history. Do not regenerate the model.
4. Transfer layouts through existing lower LODs with any UV-required seam geometry changes explicitly bounded and explained. Preserve rigs, source dimensions, markers, colliders, hardpoints and semantic signals.
5. Run stock source/export checks and actual normalized/dequantized consumer density, anisotropy and texel coverage measurements, plus meaningful negative controls. Reconcile source/export world-area differences rather than relying on raw meshopt integers.
6. Produce the final exact Appendix C.2 packet and scoped clean commit. Parent still owns independent source/visual review, new standard GPU captures, gameplay/performance evidence, and full task closure.

No new diagnostic images have been produced. Historical `qualified-front.png`, `qualified-aft.png` and `qualified-damaged.png` were viewed in place earlier; they are not views of a density-corrected source. The new diagnostic cap remains 12 images / 128 MiB, without historical image overwrites or cleanup. The eventual GPU inventory must include all states/LODs/liveries, cockpit, canopy/gear animation poses, boarding access, hardpoint mounts, collision/scale views and localized wear/damage close-ups.

No protected shared modules, runtime, other hulls, old reviews, or existing evidence were edited. No GPU/render/browser/native/service/DB action, push, PR, merge or cleanup was performed.
